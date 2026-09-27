#!/usr/bin/env node
// Keeps the public copy current. The go-replayer-publish systemd user timer on
// the PC runs this a minute after each run ends (deploy/systemd/):
//
// - when GitHub's main has moved, it publishes that commit at once, so a push
//   from any machine reaches the site;
// - when the database has changed in a way the site shows (new analysis, new
//   games, tags, accounts), it republishes at most every 30 minutes, so an
//   analysis run appears in steps rather than after every posted batch.
//
// It never touches the working tree and is quiet unless it publishes or fails.
//
//   node scripts/publish-on-change.mjs --dry-run   say what it would do, and why
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const REPO = path.resolve(import.meta.dirname, "..");
// Shared with `npm run publish:public`, so two builds never share .public-build.
const LOCK = path.join(REPO, ".public-build.lock");
const DATA_EVERY_MS = 30 * 60 * 1000;
// A publish that failed is retried this often rather than every minute.
const RETRY_MS = 15 * 60 * 1000;
const dryRun = process.argv.includes("--dry-run");

const git = (...args) => spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

/**
 * Changes whenever the site's data does, without reading the analysis or SGF
 * text: every analysis write sets analysis_updated_at. Viewing progress is
 * left out, because the public copy does not publish it.
 */
function dataFingerprint() {
  const db = new Database(path.join(REPO, "data", "go-replay.db"), { readonly: true, fileMustExist: true });
  try {
    const games = db
      .prepare(
        `SELECT count(*) AS n, max(id) AS newest, max(analysis_updated_at) AS analysed,
                total(analysis_progress) AS progress,
                (SELECT group_concat(item, ',') FROM
                  (SELECT id || ':' || analysis_state || ':' || tags AS item FROM games ORDER BY id)) AS items
         FROM games`
      )
      .get();
    const accounts = db
      .prepare(
        `SELECT group_concat(item, ',') AS list FROM
           (SELECT server || '/' || username || '/' || person AS item FROM accounts ORDER BY id)`
      )
      .get();
    return createHash("sha1").update(JSON.stringify([games, accounts])).digest("hex");
  } finally {
    db.close();
  }
}

const stateFile = path.resolve(REPO, git("rev-parse", "--git-path", "public-published.json").stdout.trim());
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};

const fetched = git("fetch", "--quiet", "origin", "main");
if (fetched.status !== 0) {
  log(`cannot fetch origin main, will try again: ${fetched.stderr.trim()}`);
  process.exit(0);
}
const commit = git("rev-parse", "origin/main").stdout.trim();
// Taken before publishing: data that lands during the build is caught next time.
const data = dataFingerprint();
const since = state.at ? Date.now() - Date.parse(state.at) : Infinity;
const minutes = (ms) => `${Math.ceil(ms / 60000)} min`;

let reason = null;
let waiting = null;
if (state.commit !== commit) reason = `origin/main moved to ${commit}`;
else if (state.ok === false) {
  if (since >= RETRY_MS) reason = "retrying the last failed publish";
  else waiting = `retrying the failed publish in ${minutes(RETRY_MS - since)}`;
} else if (state.data !== data) {
  if (since >= DATA_EVERY_MS) reason = "the site's data changed in the database";
  else waiting = `the data changed; publishing in ${minutes(DATA_EVERY_MS - since)}`;
}

if (dryRun) {
  console.log(`origin/main ${commit}, data ${data}; last publish ${JSON.stringify(state)}`);
  console.log(reason ? `would publish now: ${reason}` : waiting ? `would wait: ${waiting}` : "nothing to publish");
  process.exit(0);
}
if (!reason) process.exit(0);

log(`publishing: ${reason}`);
const result = spawnSync(
  "flock",
  [LOCK, process.execPath, path.join(REPO, "scripts", "publish-public.mjs"), "--ref", commit],
  { cwd: REPO, stdio: "inherit" }
);
const ok = result.status === 0;
fs.writeFileSync(stateFile, `${JSON.stringify({ commit, data, ok, at: new Date().toISOString() })}\n`);
log(ok ? `published ${commit}` : `publishing ${commit} failed (${result.status ?? result.signal}); retrying in 15 min`);
process.exit(ok ? 0 : 1);
