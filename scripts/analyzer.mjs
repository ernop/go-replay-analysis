#!/usr/bin/env node
/**
 * Local analysis worker for Go Game Replay.
 *
 * Runs on the machine with the GPU. Pulls queued games from the web app,
 * analyzes every position with KataGo's JSON analysis engine, and posts the
 * results back so any device (e.g. your phone) can view them.
 *
 * Usage:
 *   node scripts/analyzer.mjs --katago /path/to/katago --model /path/to/model.bin.gz
 *   node scripts/analyzer.mjs --mock            # demo data, no KataGo needed
 *
 * Options:
 *   --server  URL of the web app        (default http://127.0.0.1:4517)
 *   --katago  path to the katago binary (default "katago" on PATH)
 *   --model   path to a KataGo network  (required unless --mock)
 *   --config  analysis config           (default scripts/katago-analysis.cfg)
 *   --visits  visits per position       (default 400)
 *   --once    exit when the queue is empty instead of polling
 *   --mock    generate plausible fake analysis instead of running KataGo
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    server: "http://127.0.0.1:4517",
    katago: "katago",
    model: "",
    config: path.join(__dirname, "katago-analysis.cfg"),
    visits: 400,
    once: false,
    mock: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") args.once = true;
    else if (a === "--mock") args.mock = true;
    else if (a === "--server") args.server = argv[++i];
    else if (a === "--katago") args.katago = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--config") args.config = argv[++i];
    else if (a === "--visits") args.visits = parseInt(argv[++i], 10);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const POLL_MS = 5000;
const BATCH_SIZE = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJob() {
  const res = await fetch(`${args.server}/api/analysis/next`);
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  const data = await res.json();
  if (data.error) console.error(`server note: ${data.error}`);
  return data.job;
}

async function postResults(gameId, payload) {
  const res = await fetch(`${args.server}/api/analysis/${gameId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`posting results failed: ${res.status}`);
}

/* ------------------------------------------------------------------ */
/* Mock engine: plausible-looking data so the UI can be demoed         */
/* without a GPU. Clearly labeled in the UI via the engine name.       */
/* ------------------------------------------------------------------ */

const GTP_COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

function randomGtp(size) {
  const x = Math.floor(Math.random() * size);
  const y = Math.floor(Math.random() * size);
  return GTP_COLS[x] + String(y + 1);
}

function mockAnalyze(job) {
  const total = job.moves.length + 1;
  const positions = [];
  let wr = 0.5;
  for (let turn = 0; turn < total; turn++) {
    wr += (Math.random() - 0.5) * 0.06;
    if (Math.random() < 0.04) wr += (Math.random() - 0.5) * 0.25; // occasional blunder
    wr = Math.max(0.03, Math.min(0.97, wr));
    const scoreLead = (wr - 0.5) * 22 + (Math.random() - 0.5) * 2;
    const nTop = 3 + Math.floor(Math.random() * 3);
    const top = [];
    const used = new Set();
    for (let i = 0; i < nTop; i++) {
      let mv = randomGtp(job.boardSize);
      let guard = 0;
      while (used.has(mv) && guard++ < 20) mv = randomGtp(job.boardSize);
      used.add(mv);
      top.push({
        move: mv,
        winrate: Math.max(0.02, Math.min(0.98, wr + (Math.random() - 0.5) * 0.04 - i * 0.015)),
        scoreLead: scoreLead - i * 0.4,
        visits: Math.max(10, Math.round(args.visits * Math.pow(0.45, i))),
        pv: Array.from({ length: 5 }, () => randomGtp(job.boardSize)),
      });
    }
    positions.push({ turn, winrate: wr, scoreLead, visits: args.visits, top });
  }
  return positions;
}

async function runMockJob(job) {
  console.log(`[mock] analyzing game ${job.gameId}: ${job.black} vs ${job.white} (${job.moves.length} moves)`);
  const positions = mockAnalyze(job);
  for (let i = 0; i < positions.length; i += 50) {
    await postResults(job.gameId, {
      engine: "MockEngine (demo data)",
      model: "none",
      maxVisits: args.visits,
      positions: positions.slice(i, i + 50),
      done: i + 50 >= positions.length,
    });
    await sleep(150);
  }
  console.log(`[mock] game ${job.gameId} done (${positions.length} positions)`);
}

/* ------------------------------------------------------------------ */
/* Real engine: KataGo JSON analysis protocol                          */
/* ------------------------------------------------------------------ */

let katago = null;
let katagoLines = null;
const pending = new Map(); // query id -> { resolve, expected, received: [] }

function startKatago() {
  const kargs = ["analysis", "-config", args.config];
  if (args.model) kargs.push("-model", args.model);
  console.log(`starting: ${args.katago} ${kargs.join(" ")}`);
  katago = spawn(args.katago, kargs, { stdio: ["pipe", "pipe", "pipe"] });
  katago.stderr.on("data", (d) => {
    const s = d.toString().trim();
    if (s) console.error(`[katago] ${s}`);
  });
  katago.on("exit", (code) => {
    console.error(`KataGo exited with code ${code}`);
    process.exit(code ?? 1);
  });
  katagoLines = createInterface({ input: katago.stdout });
  katagoLines.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    if (msg.error) {
      entry.reject(new Error(`KataGo error: ${msg.error}`));
      pending.delete(msg.id);
      return;
    }
    if (typeof msg.turnNumber !== "number") return;
    entry.received.push(msg);
    entry.onResponse?.(msg);
    if (entry.received.length >= entry.expected) {
      entry.resolve(entry.received);
      pending.delete(msg.id);
    }
  });
}

function toPosition(msg) {
  // Config uses reportAnalysisWinratesAs = BLACK, so values are already
  // from Black's perspective.
  const root = msg.rootInfo ?? {};
  return {
    turn: msg.turnNumber,
    winrate: root.winrate ?? 0.5,
    scoreLead: root.scoreLead ?? 0,
    visits: root.visits ?? 0,
    top: (msg.moveInfos ?? []).slice(0, 6).map((mi) => ({
      move: mi.move,
      winrate: mi.winrate ?? 0.5,
      scoreLead: mi.scoreLead ?? 0,
      visits: mi.visits ?? 0,
      pv: (mi.pv ?? []).slice(0, 10),
    })),
  };
}

async function runKatagoJob(job) {
  const total = job.moves.length + 1;
  console.log(`analyzing game ${job.gameId}: ${job.black} vs ${job.white} (${job.moves.length} moves, ${args.visits} visits)`);
  const query = {
    id: `game-${job.gameId}`,
    moves: job.moves,
    initialStones: job.initialStones,
    rules: job.rules,
    komi: job.komi,
    boardXSize: job.boardSize,
    boardYSize: job.boardSize,
    analyzeTurns: Array.from({ length: total }, (_, i) => i),
    maxVisits: args.visits,
  };

  let buffer = [];
  let postedCount = 0;
  const flush = async (done) => {
    if (buffer.length === 0 && !done) return;
    const positions = buffer;
    buffer = [];
    postedCount += positions.length;
    await postResults(job.gameId, {
      engine: "KataGo",
      model: args.model ? path.basename(args.model) : "engine default",
      maxVisits: args.visits,
      positions,
      done,
    });
    process.stdout.write(`\r  posted ${postedCount}/${total} positions`);
  };

  await new Promise((resolve, reject) => {
    pending.set(query.id, {
      expected: total,
      received: [],
      resolve,
      reject,
      onResponse: (msg) => {
        buffer.push(toPosition(msg));
        if (buffer.length >= BATCH_SIZE) flush(false).catch(reject);
      },
    });
    katago.stdin.write(JSON.stringify(query) + "\n");
  });
  await flush(true);
  console.log(`\ngame ${job.gameId} done`);
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log(`Go Game Replay analysis worker`);
  console.log(`server: ${args.server}  mode: ${args.mock ? "MOCK" : "KataGo"}`);
  if (!args.mock) startKatago();

  for (;;) {
    let job;
    try {
      job = await getJob();
    } catch (err) {
      console.error(`cannot reach server (${err.message}), retrying in ${POLL_MS / 1000}s`);
      await sleep(POLL_MS);
      continue;
    }
    if (!job) {
      if (args.once) {
        console.log("queue empty, exiting (--once)");
        break;
      }
      await sleep(POLL_MS);
      continue;
    }
    try {
      if (args.mock) await runMockJob(job);
      else await runKatagoJob(job);
    } catch (err) {
      console.error(`game ${job.gameId} failed: ${err.message}`);
      await postResults(job.gameId, { error: String(err.message) }).catch(() => {});
    }
  }
  katago?.kill();
  process.exit(0);
}

main();
