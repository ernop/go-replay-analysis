import { NextRequest, NextResponse } from "next/server";
import { getDb, listAccounts } from "@/lib/db";

export function GET() {
  return NextResponse.json({ accounts: listAccounts(getDb()) });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = (await req.json()) as {
    server: string;
    username: string;
    person: string;
  };
  if (!body.server || !body.username?.trim() || !body.person?.trim()) {
    return NextResponse.json(
      { error: "server, username and person are all required" },
      { status: 400 }
    );
  }
  try {
    db.prepare(
      "INSERT INTO accounts (server, username, person, added_at) VALUES (?, ?, ?, ?)"
    ).run(body.server, body.username.trim(), body.person.trim(), new Date().toISOString());
  } catch {
    return NextResponse.json(
      { error: "that username is already registered for this server" },
      { status: 409 }
    );
  }
  return NextResponse.json({ accounts: listAccounts(db) });
}
