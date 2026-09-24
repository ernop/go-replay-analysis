import { NextRequest, NextResponse } from "next/server";
import { analysisQueueStatus, getDb, queueGames } from "@/lib/db";

export function GET() {
  return NextResponse.json({ counts: analysisQueueStatus(getDb()) });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = (await req.json().catch(() => ({}))) as {
    gameIds?: number[];
    scope?: "unanalyzed" | "all";
  };
  const queued = queueGames(db, body);
  return NextResponse.json({ queued, counts: analysisQueueStatus(db) });
}
