import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseSgf } from "./sgf";
import type {
  Account,
  AnalysisPosition,
  GameAnalysis,
  GameSummary,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "go-replay.db");
const SEED_DIR = path.join(DATA_DIR, "seed-sgf");

// If a worker hasn't reported for this long, the job can be handed out again.
const STALE_RUNNING_MS = 15 * 60 * 1000;

declare global {
  var __goReplayDb: Database.Database | undefined;
}

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE,
      sgf TEXT NOT NULL,
      black TEXT NOT NULL DEFAULT '',
      white TEXT NOT NULL DEFAULT '',
      black_rank TEXT NOT NULL DEFAULT '',
      white_rank TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      winner TEXT NOT NULL DEFAULT '',
      board_size INTEGER NOT NULL DEFAULT 19,
      handicap INTEGER NOT NULL DEFAULT 0,
      komi REAL,
      date_played TEXT NOT NULL DEFAULT '',
      event TEXT NOT NULL DEFAULT '',
      move_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      tags TEXT NOT NULL DEFAULT '[]',
      added_at TEXT NOT NULL,
      last_viewed_move INTEGER NOT NULL DEFAULT 0,
      watched_to_end INTEGER NOT NULL DEFAULT 0,
      analysis_state TEXT NOT NULL DEFAULT 'none',
      analysis_progress INTEGER NOT NULL DEFAULT 0,
      analysis_json TEXT,
      analysis_engine TEXT NOT NULL DEFAULT '',
      analysis_updated_at TEXT,
      analysis_visits INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server TEXT NOT NULL,
      username TEXT NOT NULL,
      person TEXT NOT NULL,
      added_at TEXT NOT NULL,
      last_fetch_at TEXT,
      last_fetch_note TEXT,
      UNIQUE(server, username)
    );
  `);
}

export interface IngestResult {
  added: boolean;
  id: number | null;
  reason?: string;
}

export function ingestSgf(
  db: Database.Database,
  content: string,
  source: string,
  sourceKey: string
): IngestResult {
  const existing = db
    .prepare("SELECT id FROM games WHERE source_key = ?")
    .get(sourceKey) as { id: number } | undefined;
  if (existing) return { added: false, id: existing.id, reason: "already in library" };

  let parsed;
  try {
    parsed = parseSgf(content);
  } catch (err) {
    return { added: false, id: null, reason: `unparseable SGF: ${String(err)}` };
  }
  if (parsed.moves.length === 0) {
    return { added: false, id: null, reason: "no moves in game" };
  }

  const info = db
    .prepare(
      `INSERT INTO games
        (source, source_key, sgf, black, white, black_rank, white_rank, result, winner,
         board_size, handicap, komi, date_played, event, move_count, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      source,
      sourceKey,
      content,
      parsed.black,
      parsed.white,
      parsed.blackRank,
      parsed.whiteRank,
      parsed.result,
      parsed.winner,
      parsed.boardSize,
      parsed.handicap,
      parsed.komi,
      parsed.datePlayed,
      parsed.event,
      parsed.moves.length,
      new Date().toISOString()
    );
  return { added: true, id: Number(info.lastInsertRowid) };
}

export function uploadSourceKey(content: string): string {
  return "upload:" + crypto.createHash("sha1").update(content).digest("hex");
}

function seedIfEmpty(db: Database.Database) {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number }).n;
  if (count === 0 && fs.existsSync(SEED_DIR)) {
    for (const file of fs.readdirSync(SEED_DIR).sort()) {
      if (!file.endsWith(".sgf")) continue;
      const content = fs.readFileSync(path.join(SEED_DIR, file), "utf8");
      ingestSgf(db, content, "seed", `seed:${file}`);
    }
  }

  const accountCount = (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
  const accountsFile = path.join(DATA_DIR, "seed-accounts.json");
  if (accountCount === 0 && fs.existsSync(accountsFile)) {
    try {
      const seedAccounts = JSON.parse(fs.readFileSync(accountsFile, "utf8")) as {
        server: string;
        username: string;
        person: string;
      }[];
      const stmt = db.prepare(
        "INSERT OR IGNORE INTO accounts (server, username, person, added_at) VALUES (?, ?, ?, ?)"
      );
      for (const a of seedAccounts) {
        stmt.run(a.server, a.username, a.person, new Date().toISOString());
      }
    } catch {
      // malformed seed file: skip silently, accounts can be added in the UI
    }
  }
}

/**
 * Columns added after the first release. `analysis_visits` is the visits per
 * position of the last complete analysis, so the worker can find games to
 * analyse again more deeply.
 */
function migrate(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(games)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "analysis_visits")) {
    db.exec("ALTER TABLE games ADD COLUMN analysis_visits INTEGER NOT NULL DEFAULT 0");
    db.exec(
      `UPDATE games SET analysis_visits = COALESCE(json_extract(analysis_json, '$.maxVisits'), 0)
       WHERE analysis_state = 'done'`
    );
  }
}

// The dev server keeps its database handle across reloads, so migrations are
// checked once per load of this module rather than only when the file opens.
let migrated = false;

export function getDb(): Database.Database {
  let db = globalThis.__goReplayDb;
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    createSchema(db);
    seedIfEmpty(db);
    globalThis.__goReplayDb = db;
  }
  if (!migrated) {
    migrate(db);
    migrated = true;
  }
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameRow = Record<string, any>;

export function rowToSummary(row: GameRow, accounts?: Account[]): GameSummary {
  // DGS writes players as "Real Name (handle)", so also match on "(handle)".
  const personOf = (player: string) => {
    const p = String(player).toLowerCase();
    const u = (a: Account) => a.username.toLowerCase();
    return accounts?.find((a) => p === u(a) || p.includes(`(${u(a)})`))?.person ?? "";
  };
  const whitePerson = personOf(row.white);
  const blackPerson = personOf(row.black);
  const people = [...new Set([whitePerson, blackPerson].filter(Boolean))];
  return {
    id: row.id,
    source: row.source,
    black: row.black,
    white: row.white,
    blackRank: row.black_rank,
    whiteRank: row.white_rank,
    result: row.result,
    winner: row.winner,
    boardSize: row.board_size,
    handicap: row.handicap,
    komi: row.komi,
    datePlayed: row.date_played,
    event: row.event,
    moveCount: row.move_count,
    status: row.status,
    tags: JSON.parse(row.tags || "[]"),
    addedAt: row.added_at,
    lastViewedMove: row.last_viewed_move,
    watchedToEnd: !!row.watched_to_end,
    analysisState: row.analysis_state,
    analysisProgress: row.analysis_progress,
    analysisTotal: row.move_count + 1,
    analysisEngine: row.analysis_engine,
    people,
    whitePerson,
    blackPerson,
  };
}

export function listAccounts(db: Database.Database): Account[] {
  const rows = db.prepare("SELECT * FROM accounts ORDER BY person, server").all() as GameRow[];
  return rows.map((r) => ({
    id: r.id,
    server: r.server,
    username: r.username,
    person: r.person,
    addedAt: r.added_at,
    lastFetchAt: r.last_fetch_at,
    lastFetchNote: r.last_fetch_note,
  }));
}

export function getAnalysis(row: GameRow): GameAnalysis | null {
  if (!row.analysis_json) return null;
  try {
    return JSON.parse(row.analysis_json) as GameAnalysis;
  } catch {
    return null;
  }
}

export interface AnalysisResultPayload {
  engine?: string;
  model?: string;
  maxVisits?: number;
  positions?: AnalysisPosition[];
  done?: boolean;
  error?: string;
}

export function mergeAnalysisResults(
  db: Database.Database,
  gameId: number,
  payload: AnalysisResultPayload
): { ok: boolean; progress: number } {
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
    | GameRow
    | undefined;
  if (!row) return { ok: false, progress: 0 };

  const previous = getAnalysis(row);
  const existing: GameAnalysis = previous ?? {
    engine: payload.engine ?? "",
    model: payload.model ?? "",
    maxVisits: payload.maxVisits ?? 0,
    updatedAt: new Date().toISOString(),
    positions: {},
  };
  if (payload.engine) existing.engine = payload.engine;
  if (payload.model) existing.model = payload.model;
  // A deeper run replaces positions as they arrive; the game is only credited
  // with the new visits once every position has them.
  const complete = !!payload.done && !payload.error;
  if (payload.maxVisits && (complete || !previous)) existing.maxVisits = payload.maxVisits;
  existing.updatedAt = new Date().toISOString();
  for (const pos of payload.positions ?? []) {
    existing.positions[String(pos.turn)] = pos;
  }
  const progress = Object.keys(existing.positions).length;

  // A game analysed again stays "done" throughout, and after a failed run,
  // so it never leaves the library's "analysis done" filter.
  const deepening = row.analysis_state === "done";
  let state: string;
  if (payload.error) state = deepening ? "done" : "error";
  else if (payload.done || deepening) state = "done";
  else state = "running";
  const visits = complete && payload.maxVisits ? payload.maxVisits : row.analysis_visits;

  db.prepare(
    `UPDATE games SET analysis_json = ?, analysis_progress = ?, analysis_state = ?,
       analysis_engine = ?, analysis_updated_at = ?, analysis_visits = ? WHERE id = ?`
  ).run(
    JSON.stringify(existing),
    progress,
    state,
    existing.engine,
    new Date().toISOString(),
    visits,
    gameId
  );
  return { ok: true, progress };
}

export function queueGames(
  db: Database.Database,
  opts: { gameIds?: number[]; scope?: "unanalyzed" | "all" }
): number {
  const now = new Date().toISOString();
  if (opts.gameIds && opts.gameIds.length > 0) {
    const stmt = db.prepare(
      `UPDATE games SET analysis_state = 'queued', analysis_updated_at = ?
       WHERE id = ? AND analysis_state != 'done'`
    );
    let n = 0;
    for (const id of opts.gameIds) n += stmt.run(now, id).changes;
    return n;
  }
  if (opts.scope === "all") {
    return db
      .prepare(`UPDATE games SET analysis_state = 'queued', analysis_updated_at = ?`)
      .run(now).changes;
  }
  // Default: everything not yet analyzed, plus stalled runs and errors.
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  return db
    .prepare(
      `UPDATE games SET analysis_state = 'queued', analysis_updated_at = ?
       WHERE analysis_state = 'none' OR analysis_state = 'error'
          OR (analysis_state = 'running' AND (analysis_updated_at IS NULL OR analysis_updated_at < ?))`
    )
    .run(now, staleCutoff).changes;
}

/**
 * The next game for the worker: the oldest queued game, or else, when the
 * worker asks with `deepenBelow`, the newest analysed game whose analysis has
 * fewer visits per position. The returned row keeps its state from before
 * the hand-out, so "done" marks a game being analysed again.
 */
export function takeNextQueuedGame(db: Database.Database, deepenBelow = 0): GameRow | null {
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const row = db
    .prepare(
      `SELECT * FROM games
       WHERE analysis_state = 'queued'
          OR (analysis_state = 'running' AND (analysis_updated_at IS NULL OR analysis_updated_at < ?))
       ORDER BY analysis_updated_at ASC LIMIT 1`
    )
    .get(staleCutoff) as GameRow | undefined;
  if (row) {
    db.prepare(`UPDATE games SET analysis_state = 'running', analysis_updated_at = ? WHERE id = ?`).run(now, row.id);
    return row;
  }
  if (deepenBelow <= 0) return null;
  // Touching analysis_updated_at keeps the same game from being handed out
  // again for STALE_RUNNING_MS while its state stays "done".
  const shallow = db
    .prepare(
      `SELECT * FROM games
       WHERE analysis_state = 'done' AND analysis_visits < ?
         AND (analysis_updated_at IS NULL OR analysis_updated_at < ?)
       ORDER BY id DESC LIMIT 1`
    )
    .get(deepenBelow, staleCutoff) as GameRow | undefined;
  if (!shallow) return null;
  db.prepare(`UPDATE games SET analysis_updated_at = ? WHERE id = ?`).run(now, shallow.id);
  return shallow;
}

export function analysisQueueStatus(db: Database.Database) {
  const rows = db
    .prepare(`SELECT analysis_state AS s, COUNT(*) AS n FROM games GROUP BY analysis_state`)
    .all() as { s: string; n: number }[];
  const counts: Record<string, number> = { none: 0, queued: 0, running: 0, done: 0, error: 0 };
  for (const r of rows) counts[r.s] = r.n;
  return counts;
}
