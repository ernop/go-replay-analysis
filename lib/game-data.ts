import type Database from "better-sqlite3";
import { getAnalysis, listAccounts, rowToSummary, type GameRow } from "@/lib/db";
import type { LibraryData } from "@/lib/library";
import { parseSgf } from "@/lib/sgf";
import { SITE_MODE } from "@/lib/site-mode";
import type { GameDetail, GameSummary } from "@/lib/types";

/**
 * The public copy carries only games whose analysis is complete at this many
 * visits per position or more (PRODUCT.md "Public copy");
 * scripts/publish-on-change.mjs uses the same number.
 */
export const PUBLIC_MIN_VISITS = 10_000;

function onThisSite(row: GameRow): boolean {
  return SITE_MODE !== "public" || (row.analysis_state === "done" && row.analysis_visits >= PUBLIC_MIN_VISITS);
}

/**
 * The public copy publishes the games, not the owner's viewing progress; each
 * visitor starts every game new and keeps progress in their own browser.
 */
function forThisSite(summary: GameSummary): GameSummary {
  return SITE_MODE === "public"
    ? { ...summary, status: "new", lastViewedMove: 0, watchedToEnd: false }
    : summary;
}

export function libraryData(db: Database.Database): LibraryData {
  const accounts = listAccounts(db);
  const rows = db.prepare("SELECT * FROM games ORDER BY id DESC").all() as GameRow[];
  return {
    games: rows.filter(onThisSite).map((row) => forThisSite(rowToSummary(row, accounts))),
    people: [...new Set(accounts.map((a) => a.person))],
  };
}

export function gameIds(db: Database.Database): number[] {
  const rows = db.prepare("SELECT id, analysis_state, analysis_visits FROM games ORDER BY id").all() as GameRow[];
  return rows.filter(onThisSite).map((r) => r.id);
}

export function gameDetail(db: Database.Database, id: number): GameDetail | null {
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(id) as GameRow | undefined;
  if (!row || !onThisSite(row)) return null;
  const parsed = parseSgf(row.sgf);
  return {
    game: forThisSite(rowToSummary(row, listAccounts(db))),
    moves: parsed.moves,
    initialStones: parsed.initialStones,
    rules: parsed.rules,
    analysis: getAnalysis(row),
  };
}
