import { NextRequest, NextResponse } from "next/server";
import { getDb, ingestSgf, listAccounts, rowToSummary, uploadSourceKey, type GameRow } from "@/lib/db";

export function GET(req: NextRequest) {
  const db = getDb();
  const accounts = listAccounts(db);
  const p = req.nextUrl.searchParams;

  const where: string[] = [];
  const args: (string | number)[] = [];
  const status = p.get("status");
  if (status && status !== "all") {
    where.push("status = ?");
    args.push(status);
  }
  const winner = p.get("winner");
  if (winner && winner !== "any") {
    where.push("winner = ?");
    args.push(winner);
  }
  const source = p.get("source");
  if (source && source !== "all") {
    where.push("source = ?");
    args.push(source);
  }
  const size = p.get("size");
  if (size && size !== "all") {
    where.push("board_size = ?");
    args.push(parseInt(size, 10));
  }
  if (p.get("analysis") === "done") where.push("analysis_state = 'done'");
  const kind = p.get("kind"); // even | handicap
  if (kind === "even") where.push("handicap = 0");
  if (kind === "handicap") where.push("handicap > 0");
  const q = p.get("q");
  if (q) {
    where.push("(black LIKE ? OR white LIKE ? OR event LIKE ? OR tags LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }

  const sort = p.get("sort") ?? "added";
  const orderBy =
    sort === "date"
      ? "date_played DESC, id DESC"
      : sort === "moves"
        ? "move_count DESC"
        : "id DESC";

  const sql = `SELECT * FROM games ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${orderBy}`;
  const rows = db.prepare(sql).all(...args) as GameRow[];

  let games = rows.map((r) => rowToSummary(r, accounts));
  const person = p.get("person");
  if (person && person !== "all") {
    games = games.filter((g) => g.people.includes(person));
  }
  return NextResponse.json({ games });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = (await req.json()) as { files: { name: string; content: string }[] };
  let added = 0;
  const skipped: string[] = [];
  for (const f of body.files ?? []) {
    const result = ingestSgf(db, f.content, "upload", uploadSourceKey(f.content));
    if (result.added) added++;
    else skipped.push(`${f.name}: ${result.reason}`);
  }
  return NextResponse.json({ added, skipped });
}
