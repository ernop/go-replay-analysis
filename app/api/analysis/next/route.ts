import { NextResponse } from "next/server";
import { getDb, takeNextQueuedGame } from "@/lib/db";
import { parseSgf, vertexToGtp } from "@/lib/sgf";

/**
 * Called by the local analysis worker (scripts/analyzer.mjs).
 * Hands out the oldest queued game as a KataGo-ready job and marks it running.
 */
export function GET() {
  const db = getDb();
  const row = takeNextQueuedGame(db);
  if (!row) return NextResponse.json({ job: null });

  let parsed;
  try {
    parsed = parseSgf(row.sgf);
  } catch (err) {
    db.prepare(
      "UPDATE games SET analysis_state = 'error', analysis_updated_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), row.id);
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
