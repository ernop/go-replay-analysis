import { NextRequest, NextResponse } from "next/server";
import { getDb, listAccounts } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const db = getDb();
  db.prepare("DELETE FROM accounts WHERE id = ?").run(parseInt(id, 10));
  return NextResponse.json({ accounts: listAccounts(db) });
}
