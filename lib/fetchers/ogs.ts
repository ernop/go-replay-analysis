import type Database from "better-sqlite3";
import { ingestSgf } from "../db";

const OGS = "https://online-go.com/api/v1";
const MAX_GAMES = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchOgsGames(
  db: Database.Database,
  username: string
): Promise<{ added: number; skipped: number; note: string }> {
  const searchRes = await fetch(
    `${OGS}/players/?username=${encodeURIComponent(username)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!searchRes.ok) {
    return { added: 0, skipped: 0, note: `OGS player search failed (${searchRes.status})` };
  }
  const search = (await searchRes.json()) as {
    results: { id: number; username: string }[];
  };
  const player =
    search.results.find((p) => p.username.toLowerCase() === username.toLowerCase()) ??
    search.results[0];
  if (!player) return { added: 0, skipped: 0, note: "player not found on OGS" };

  const gamesRes = await fetch(
    `${OGS}/players/${player.id}/games/?ordering=-ended&ended__isnull=false&page_size=${MAX_GAMES}`,
    { headers: { Accept: "application/json" } }
  );
  if (!gamesRes.ok) {
    return { added: 0, skipped: 0, note: `OGS game list failed (${gamesRes.status})` };
  }
  const games = (await gamesRes.json()) as {
    results: { id: number; ended: string | null; annulled?: boolean }[];
  };

  let added = 0;
  let skipped = 0;
  for (const g of games.results) {
    if (!g.ended) {
      skipped++;
      continue;
    }
    const sourceKey = `ogs:${g.id}`;
    const exists = db.prepare("SELECT id FROM games WHERE source_key = ?").get(sourceKey);
    if (exists) {
      skipped++;
      continue;
    }
    const sgfRes = await fetch(`${OGS}/games/${g.id}/sgf/`);
    if (!sgfRes.ok) {
      skipped++;
      continue;
    }
    const sgf = await sgfRes.text();
    const result = ingestSgf(db, sgf, "ogs", sourceKey);
    if (result.added) added++;
    else skipped++;
    await sleep(300); // be polite to the OGS API
  }
  return {
    added,
    skipped,
    note: `checked ${games.results.length} most recent games for ${player.username}`,
  };
}
