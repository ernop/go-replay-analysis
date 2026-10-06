import type Database from "better-sqlite3";
import { getAnalysis, listAccounts, rowToSummary, type GameRow } from "@/lib/db";
import type { LibraryData } from "@/lib/library";
import { candidateMinVisits } from "@/lib/review";
import { parseSgf } from "@/lib/sgf";
import { SITE_MODE } from "@/lib/site-mode";
import type { GameAnalysis, GameDetail, GameSummary } from "@/lib/types";

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

/**
 * The public copy sends each position's moves only as far as the review
 * screen can show them: the engine's first move and the moves with
 * `candidateMinVisits`, without principal variations. A played move below the
 * minimum is valued from the following position (`playedMoveValue`), which
 * every published game has. A game reviewed at 10,000 visits drops from about
 * 1.6 MB to 0.23 MB, which keeps the site under its 512 MiB release limit
 * (PRODUCT.md "Public copy").
 */
function analysisForThisSite(analysis: GameAnalysis | null): GameAnalysis | null {
  if (SITE_MODE !== "public" || !analysis) return analysis;
  const positions: GameAnalysis["positions"] = {};
  for (const [turn, pos] of Object.entries(analysis.positions)) {
    const min = candidateMinVisits(pos.visits);
    positions[turn] = {
      turn: pos.turn,
      winrate: pos.winrate,
      scoreLead: pos.scoreLead,
      visits: pos.visits,
      candidates: (pos.candidates ?? pos.top ?? [])
        .filter((c, i) => c.source !== "continuation" && (i === 0 || c.visits >= min))
        .map((c) => ({ move: c.move, winrate: c.winrate, scoreLead: c.scoreLead, visits: c.visits })),
    };
  }
  return { ...analysis, positions };
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
    analysis: analysisForThisSite(getAnalysis(row)),
  };
}
