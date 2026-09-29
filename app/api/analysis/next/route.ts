import { NextRequest, NextResponse } from "next/server";
import { getDb, takeNextQueuedGame } from "@/lib/db";
import { parseSgf, vertexToGtp } from "@/lib/sgf";

/**
 * Called by the local analysis worker (scripts/analyzer.mjs).
 * Hands out the oldest queued game as a KataGo-ready job and marks it running.
 * With `?deepenBelow=N` and nothing queued, it hands out an analysed game
 * whose analysis has fewer than N visits per position; that game stays "done"
 * while the worker replaces its analysis.
 */
export function GET(req: NextRequest) {
  const db = getDb();
  const deepenBelow = Number(req.nextUrl.searchParams.get("deepenBelow")) || 0;
  const row = takeNextQueuedGame(db, deepenBelow);
  if (!row) return NextResponse.json({ job: null });

  let parsed;
  try {
    parsed = parseSgf(row.sgf);
  } catch (err) {
    if (row.analysis_state !== "done") {
      db.prepare(
        "UPDATE games SET analysis_state = 'error', analysis_updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), row.id);
    }
    return NextResponse.json({ job: null, error: `game ${row.id}: ${String(err)}` });
  }

  const size = parsed.boardSize;
  return NextResponse.json({
    job: {
      gameId: row.id,
      black: parsed.black,
      white: parsed.white,
      boardSize: size,
      komi: parsed.komi ?? 6.5,
      rules: normalizeRules(parsed.rules),
      initialStones: parsed.initialStones.map((s) => [
        s.sign === 1 ? "B" : "W",
        vertexToGtp(s.vertex, size),
      ]),
      moves: parsed.moves.map((m) => [m.color, vertexToGtp(m.vertex, size)]),
      /** Visits per position of the analysis being replaced; 0 for a first analysis. */
      deepenFrom: row.analysis_state === "done" ? row.analysis_visits : 0,
    },
  });
}

function normalizeRules(rules: string): string {
  const r = rules.toLowerCase();
  if (r.includes("chinese")) return "chinese";
  if (r.includes("aga")) return "aga";
  if (r.includes("new zealand")) return "new-zealand";
  if (r.includes("korean")) return "korean";
  return "japanese";
}
