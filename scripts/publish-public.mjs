#!/usr/bin/env node
// Publishes the public read-only copy, https://go-replayer.fuseki.net/, from
// this PC. Code comes only from the committed HEAD; games come from a
// consistent snapshot of data/go-replay.db. The upload key
// (~/.ssh/fuseki-go-replayer) can only hand a release to Fuseki's receiver
// for this one site.
//
//   npm run publish:public                  build, upload, verify the live VERSION
//   npm run publish:public -- --first       first upload, before the site has HTTPS
//   npm run publish:public -- --build-only  build .public-build/out and stop
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const REPO = path.resolve(import.meta.dirname, "..");
const BUILD = path.join(REPO, ".public-build");
const OUT = path.join(BUILD, "out");
const TARGET = JSON.parse(fs.readFileSync(path.join(REPO, "deploy", "target.json"), "utf8"));
const KNOWN_HOSTS = path.join(REPO, "deploy", "known_hosts");
const DEPLOY_KEY = path.join(os.homedir(), ".ssh", "fuseki-go-replayer");
const LAN_MODE_LINE = 'export const SITE_MODE = "lan" as "lan" | "public";';
const PUBLIC_MODE_LINE = 'export const SITE_MODE = "public" as "lan" | "public";';
// Next.js writes its page data as inline scripts. The site's CSP allows only
// same-origin script files, so each one moves to /_scripts/<hash>.js; plain
// (non-async) external scripts run in the same order, blocking like inline ones.
const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/g;
const ANY_INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>/;

const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((a) => !["--first", "--build-only"].includes(a));
if (unknown.length) throw new Error(`Unknown option: ${unknown.join(" ")}`);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} exited with ${result.status ?? result.signal}`);
  }
  return result;
}

function output(command, commandArgs) {
  return run(command, commandArgs, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }).stdout.trim();
}

function filesUnder(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return filesUnder(path.join(directory, entry.name), relative);
    if (!entry.isFile()) throw new Error(`Export contains a non-file: ${relative}`);
    return [relative];
  });
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

const commit = output("git", ["-C", REPO, "rev-parse", "HEAD"]);
if (output("git", ["-C", REPO, "status", "--porcelain"])) {
  console.log(`Publishing commit ${commit}; uncommitted changes in the working tree are not included.`);
}

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(BUILD, "data"), { recursive: true });
run("git", ["-C", REPO, "archive", `--output=${path.join(BUILD, "source.tar")}`, "HEAD"]);
run("tar", ["-xf", path.join(BUILD, "source.tar"), "-C", BUILD]);
fs.rmSync(path.join(BUILD, "source.tar"));

const source = new Database(path.join(REPO, "data", "go-replay.db"), { readonly: true, fileMustExist: true });
await source.backup(path.join(BUILD, "data", "go-replay.db"));
source.close();

const modeFile = path.join(BUILD, "lib", "site-mode.ts");
const modeSource = fs.readFileSync(modeFile, "utf8");
if (modeSource.split(LAN_MODE_LINE).length !== 2) throw new Error(`${modeFile} lacks the line: ${LAN_MODE_LINE}`);
fs.writeFileSync(modeFile, modeSource.replace(LAN_MODE_LINE, PUBLIC_MODE_LINE));
// Writing routes and the accounts page exist only in the LAN app.
fs.rmSync(path.join(BUILD, "app", "api"), { recursive: true });
fs.rmSync(path.join(BUILD, "app", "accounts"), { recursive: true });
// Hard links: same files as the repo's install, inside the build root Turbopack requires.
run("cp", ["-al", path.join(REPO, "node_modules"), path.join(BUILD, "node_modules")]);
run(path.join(BUILD, "node_modules", ".bin", "next"), ["build"], { cwd: BUILD });

fs.mkdirSync(path.join(OUT, "_scripts"));
for (const page of filesUnder(OUT).filter((name) => name.endsWith(".html"))) {
  const file = path.join(OUT, page);
  const html = fs.readFileSync(file, "utf8").replace(INLINE_SCRIPT, (_whole, body) => {
    const name = `${sha256(body).slice(0, 24)}.js`;
    fs.writeFileSync(path.join(OUT, "_scripts", name), body);
    return `<script src="/_scripts/${name}"></script>`;
  });
  if (ANY_INLINE_SCRIPT.test(html)) throw new Error(`${page} still has an inline script`);
  fs.writeFileSync(file, html);
}

const content = Object.fromEntries(filesUnder(OUT).sort().map((name) => [name, sha256(fs.readFileSync(path.join(OUT, name)))]));
// Game data changes without code changes, so the release is named by its content.
const revision = createHash("sha1")
  .update(Object.entries(content).map(([name, hash]) => `${hash}  ${name}\n`).join(""))
  .digest("hex");
fs.writeFileSync(path.join(OUT, "VERSION"), `${revision}\n`);
content.VERSION = sha256(`${revision}\n`);
fs.writeFileSync(path.join(OUT, "release.json"), `${JSON.stringify({ revision, files: content })}\n`);
const games = JSON.parse(fs.readFileSync(path.join(OUT, "data", "library.json"), "utf8")).games.length;
console.log(`Built release ${revision}: commit ${commit}, ${games} games, ${Object.keys(content).length} files.`);
if (args.has("--build-only")) process.exit(0);

const archive = path.join(BUILD, "release.tar");
fs.writeFileSync(path.join(BUILD, "release-files.txt"), [...Object.keys(content), "release.json"].sort().join("\n") + "\n");
run("tar", ["--create", "--format=ustar", "--no-recursion", "--owner=0", "--group=0", "--numeric-owner",
  "--mtime=@0", "--mode=0644", "-C", OUT, "-f", archive, "-T", path.join(BUILD, "release-files.txt")]);
const upload = fs.openSync(archive, "r");
run("ssh", ["-T", "-i", DEPLOY_KEY, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${KNOWN_HOSTS}`,
  `${TARGET.user}@${TARGET.host}`, "publish"], { stdio: [upload, "inherit", "inherit"] });
fs.closeSync(upload);

if (!args.has("--first")) {
  const response = await fetch(`${TARGET.url}VERSION`, { redirect: "error", cache: "no-store" });
  const live = (await response.text()).trim();
  if (!response.ok || live !== revision) {
    throw new Error(`Live VERSION is ${live || `HTTP ${response.status}`}, expected ${revision}`);
  }
  console.log(`${TARGET.url} now serves ${revision}.`);
}
fs.rmSync(BUILD, { recursive: true });
