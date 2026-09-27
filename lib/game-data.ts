import type Database from "better-sqlite3";
import { getAnalysis, listAccounts, rowToSummary, type GameRow } from "@/lib/db";
import type { LibraryData } from "@/lib/library";
import { parseSgf } from "@/lib/sgf";
import { SITE_MODE } from "@/lib/site-mode";
import type { GameDetail, GameSummary } from "@/lib/types";

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
    games: rows.map((row) => forThisSite(rowToSummary(row, accounts))),
    people: [...new Set(accounts.map((a) => a.person))],
  };
}

export function gameIds(db: Database.Database): number[] {
  return (db.prepare("SELECT id FROM games ORDER BY id").all() as { id: number }[]).map((r) => r.id);
}

export function gameDetail(db: Database.Database, id: number): GameDetail | null {
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(id) as GameRow | undefined;
  if (!row) return null;
  const parsed = parseSgf(row.sgf);
  return {
    game: forThisSite(rowToSummary(row, listAccounts(db))),
    moves: parsed.moves,
    initialStones: parsed.initialStones,
    rules: parsed.rules,
    analysis: getAnalysis(row),
  };
}
