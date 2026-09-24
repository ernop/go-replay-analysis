import { NextRequest, NextResponse } from "next/server";
import { getDb, type GameRow } from "@/lib/db";
import { fetchOgsGames } from "@/lib/fetchers/ogs";
import { fetchKgsGames } from "@/lib/fetchers/kgs";
import { fetchDgsGames } from "@/lib/fetchers/dgs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const db = getDb();
  const account = db
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .get(parseInt(id, 10)) as GameRow | undefined;
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  let result: { added: number; skipped: number; note: string };
  try {
    if (account.server === "OGS") {
      result = await fetchOgsGames(db, account.username);
    } else if (account.server === "KGS") {
      result = await fetchKgsGames(db, account.username);
    } else if (account.server === "DGS") {
      result = await fetchDgsGames(db, account.username);
    } else {
      return NextResponse.json(
        { error: `automatic fetching from ${account.server} is not implemented yet` },
        { status: 400 }
      );
    }
  } catch (err) {
    result = { added: 0, skipped: 0, note: `fetch failed: ${String(err)}` };
  }

  const note = `+${result.added} new, ${result.skipped} skipped — ${result.note}`;
  db.prepare("UPDATE accounts SET last_fetch_at = ?, last_fetch_note = ? WHERE id = ?").run(
    new Date().toISOString(),
    note,
    account.id
  );
  return NextResponse.json({ ...result, note });
}
