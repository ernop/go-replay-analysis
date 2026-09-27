/**
 * Copy the live library from tvnik into this machine's database.
 * Skips seed games (already ingested here). Source key is tvnik:<id>.
 *
 *   node scripts/pull-tvnik-library.mjs
 */
import Database from "better-sqlite3";
import sgf from "@sabaki/sgf";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TVNIK = "http://192.168.1.140:4517";
const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/go-replay.db");

function esc(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function sgfPoint(vertex) {
  return String.fromCharCode(97 + vertex[0]) + String.fromCharCode(97 + vertex[1]);
}

function winnerOf(result) {
  const m = /^(B|W)\+/i.exec(String(result ?? "").trim());
  return m ? m[1].toUpperCase() : "";
}

function toSgf(detail) {
  const g = detail.game;
  const props = ["FF[4]", "GM[1]", "CA[UTF-8]", `SZ[${g.boardSize}]`];
  const add = (key, value) => {
    if (value !== undefined && value !== null && String(value) !== "") {
      props.push(`${key}[${esc(value)}]`);
    }
  };
  add("PB", g.black);
  add("PW", g.white);
  add("BR", g.blackRank);
  add("WR", g.whiteRank);
  add("RE", g.result);
  add("DT", g.datePlayed);
  add("EV", g.event);
  add("RU", detail.rules);
  if (g.komi !== null && g.komi !== undefined) props.push(`KM[${g.komi}]`);
  if (g.handicap) props.push(`HA[${g.handicap}]`);
  const black = (detail.initialStones ?? []).filter((s) => s.sign === 1);
  const white = (detail.initialStones ?? []).filter((s) => s.sign === -1);
  if (black.length) props.push("AB" + black.map((s) => `[${sgfPoint(s.vertex)}]`).join(""));
  if (white.length) props.push("AW" + white.map((s) => `[${sgfPoint(s.vertex)}]`).join(""));
  const moves = detail.moves
    .map((m) => `;${m.color}[${m.vertex ? sgfPoint(m.vertex) : ""}]`)
    .join("");
  return `(;${props.join("")}${moves})`;
}

function countMainlineMoves(sgfText) {
  const roots = sgf.parse(sgfText);
  if (roots.length === 0) throw new Error("SGF parsed to an empty tree");
  let n = 0;
  let node = roots[0];
  while (node) {
    if (node.data.B !== undefined || node.data.W !== undefined) n++;
    node = node.children[0];
  }
  return n;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const insert = db.prepare(
  `INSERT INTO games
    (source, source_key, sgf, black, white, black_rank, white_rank, result, winner,
     board_size, handicap, komi, date_played, event, move_count, added_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const existingKey = db.prepare("SELECT id FROM games WHERE source_key = ?");

const listed = await getJson(`${TVNIK}/api/games?sort=added`);
const games = listed.games.filter((g) => g.source !== "seed");
console.log(`tvnik has ${listed.games.length} games; copying ${games.length}`);

let added = 0;
let skipped = 0;
const failures = [];

await mapPool(games, 8, async (game, index) => {
  const key = `tvnik:${game.id}`;
  if (existingKey.get(key)) {
    skipped++;
    return;
  }
  try {
    const detail = await getJson(`${TVNIK}/api/games/${game.id}`);
    const sgf = toSgf(detail);
    const moves = countMainlineMoves(sgf);
    if (moves !== detail.moves.length) {
      throw new Error(`rebuilt ${moves} moves, source has ${detail.moves.length}`);
    }
    const g = detail.game;
    insert.run(
      game.source,
      key,
      sgf,
      g.black,
      g.white,
      g.blackRank ?? "",
      g.whiteRank ?? "",
      g.result ?? "",
      winnerOf(g.result),
      g.boardSize,
      g.handicap ?? 0,
      g.komi,
      g.datePlayed ?? "",
      g.event ?? "",
      moves,
      new Date().toISOString()
    );
    added++;
  } catch (err) {
    failures.push(`${game.id}: ${err.message}`);
  }
  if ((index + 1) % 100 === 0) console.log(`  ${index + 1}/${games.length}`);
});

const review = db
  .prepare("SELECT id, move_count, black, white FROM games WHERE source_key = ?")
  .get("tvnik:11");
console.log(`added ${added}, already present ${skipped}, failed ${failures.length}`);
for (const line of failures) console.error(line);
if (!review) {
  console.error("tvnik game 11 was not stored");
  process.exit(1);
}
console.log(`REVIEW_LOCAL_ID ${review.id} ${review.move_count} ${review.black} vs ${review.white}`);
if (failures.length) process.exit(1);
