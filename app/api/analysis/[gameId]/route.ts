import { NextRequest, NextResponse } from "next/server";
import {
  getAnalysis,
  getDb,
  mergeAnalysisResults,
  type AnalysisResultPayload,
  type GameRow,
} from "@/lib/db";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await ctx.params;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM games WHERE id = ?")
    .get(parseInt(gameId, 10)) as GameRow | undefined;
  if (!row) return NextResponse.json({ error: "game not found" }, { status: 404 });
  return NextResponse.json({
    state: row.analysis_state,
    progress: row.analysis_progress,
    total: row.move_count + 1,
    analysis: getAnalysis(row),
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await ctx.params;
  const db = getDb();
  const payload = (await req.json()) as AnalysisResultPayload;
  const result = mergeAnalysisResults(db, parseInt(gameId, 10), payload);
  if (!result.ok) return NextResponse.json({ error: "game not found" }, { status: 404 });
  return NextResponse.json(result);
}
