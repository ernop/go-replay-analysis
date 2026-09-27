import { NextRequest, NextResponse } from "next/server";
import { getDb, listAccounts, rowToSummary, type GameRow } from "@/lib/db";
import { gameDetail } from "@/lib/game-data";

function getRow(id: string): GameRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(parseInt(id, 10)) as
    | GameRow
    | undefined;
  return row ?? null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const detail = gameDetail(getDb(), parseInt(id, 10));
  if (!detail) return NextResponse.json({ error: "game not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const row = getRow(id);
  if (!row) return NextResponse.json({ error: "game not found" }, { status: 404 });
  const db = getDb();
  const body = (await req.json()) as {
    status?: string;
    tags?: string[];
    lastViewedMove?: number;
    watchedToEnd?: boolean;
  };

  if (body.status !== undefined) {
    db.prepare("UPDATE games SET status = ? WHERE id = ?").run(body.status, row.id);
  }
  if (body.tags !== undefined) {
    db.prepare("UPDATE games SET tags = ? WHERE id = ?").run(
      JSON.stringify(body.tags),
      row.id
    );
  }
  if (body.lastViewedMove !== undefined) {
    db.prepare("UPDATE games SET last_viewed_move = ? WHERE id = ?").run(
      body.lastViewedMove,
      row.id
    );
  }
  if (body.watchedToEnd) {
    // Auto-tracking: reaching the final move marks the game as played.
    db.prepare(
      `UPDATE games SET watched_to_end = 1,
         status = CASE WHEN status IN ('new','skipped') THEN 'played' ELSE status END
       WHERE id = ?`
    ).run(row.id);
  }
  const updated = db.prepare("SELECT * FROM games WHERE id = ?").get(row.id) as GameRow;
  return NextResponse.json({ game: rowToSummary(updated, listAccounts(db)) });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const db = getDb();
  db.prepare("DELETE FROM games WHERE id = ?").run(parseInt(id, 10));
  return NextResponse.json({ ok: true });
}
