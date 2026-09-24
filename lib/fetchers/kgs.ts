import type Database from "better-sqlite3";
import { ingestSgf } from "../db";

const MAX_GAMES = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function archiveUrl(username: string, year: number, month: number): string {
  return `https://www.gokgs.com/gameArchives.jsp?user=${encodeURIComponent(
    username
  )}&year=${year}&month=${month}`;
}

/**
 * KGS publishes per-user monthly archive pages with direct links to SGF files
 * on files.gokgs.com. We scrape the current and previous month.
 */
export async function fetchKgsGames(
  db: Database.Database,
  username: string
): Promise<{ added: number; skipped: number; note: string }> {
  const now = new Date();
  const months: [number, number][] = [
    [now.getUTCFullYear(), now.getUTCMonth() + 1],
    now.getUTCMonth() === 0
      ? [now.getUTCFullYear() - 1, 12]
      : [now.getUTCFullYear(), now.getUTCMonth()],
  ];

  const sgfUrls: string[] = [];
  for (const [year, month] of months) {
    const res = await fetch(archiveUrl(username, year, month));
    if (!res.ok) continue;
    const html = await res.text();
    for (const m of html.matchAll(
      /href="(https?:\/\/files\.gokgs\.com\/games\/[^"]+\.sgf)"/g
    )) {
      if (!sgfUrls.includes(m[1])) sgfUrls.push(m[1]);
    }
    await sleep(500);
  }

  if (sgfUrls.length === 0) {
    return {
      added: 0,
      skipped: 0,
      note: "no games found in the current or previous month (archives may be private or empty)",
    };
  }

  let added = 0;
  let skipped = 0;
  for (const url of sgfUrls.slice(0, MAX_GAMES)) {
    const sourceKey = `kgs:${new URL(url).pathname}`;
    const exists = db.prepare("SELECT id FROM games WHERE source_key = ?").get(sourceKey);
    if (exists) {
      skipped++;
      continue;
    }
    const res = await fetch(url);
    if (!res.ok) {
      skipped++;
      continue;
    }
    const sgf = await res.text();
    const result = ingestSgf(db, sgf, "kgs", sourceKey);
    if (result.added) added++;
    else skipped++;
    await sleep(500); // KGS rate-limits aggressively
  }
  return { added, skipped, note: `found ${sgfUrls.length} archive games for ${username}` };
}
