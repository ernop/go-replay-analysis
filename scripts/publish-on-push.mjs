#!/usr/bin/env node
// Publishes the public copy whenever GitHub's main moves. The
// go-replayer-publish systemd user timer on the PC runs this every minute
// (deploy/systemd/). It publishes exactly the commit on origin/main with this
// PC's database, so a push from any machine reaches the site, and it never
// touches the working tree. Quiet unless it publishes or fails.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
// Shared with `npm run publish:public`, so two builds never share .public-build.
const LOCK = path.join(REPO, ".public-build.lock");
// A commit that failed to publish is retried this often rather than every minute.
const RETRY_MS = 15 * 60 * 1000;

const git = (...args) => spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

const stateFile = path.resolve(REPO, git("rev-parse", "--git-path", "public-published.json").stdout.trim());
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};

const fetched = git("fetch", "--quiet", "origin", "main");
if (fetched.status !== 0) {
  log(`cannot fetch origin main, will try again: ${fetched.stderr.trim()}`);
  process.exit(0);
}
const commit = git("rev-parse", "origin/main").stdout.trim();
if (state.commit === commit && (state.ok || Date.now() - Date.parse(state.at) < RETRY_MS)) process.exit(0);

log(`publishing origin/main ${commit}`);
const result = spawnSync(
  "flock",
  [LOCK, process.execPath, path.join(REPO, "scripts", "publish-public.mjs"), "--ref", commit],
  { cwd: REPO, stdio: "inherit" }
);
const ok = result.status === 0;
fs.writeFileSync(stateFile, `${JSON.stringify({ commit, ok, at: new Date().toISOString() })}\n`);
log(ok ? `published ${commit}` : `publishing ${commit} failed (${result.status ?? result.signal}); retrying in 15 min`);
process.exit(ok ? 0 : 1);
