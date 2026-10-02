import type Database from "better-sqlite3";
import { ingestSgf } from "../db";
import { parseSgf, withGameTimes } from "../sgf";

const OGS = "https://online-go.com/api/v1";
const MAX_GAMES = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The parts of `/api/v1/games/<id>` used here. */
export interface OgsGame {
  started: string | null;
  ended: string | null;
  gamedata: {
    handicap: number;
    free_handicap_placement: boolean;
    /** [x, y, milliseconds the move took]; a pass is at [-1, -1]. */
    moves: [number, number, number, ...unknown[]][];
    time_control?: { speed?: string };
  };
}

/**
 * OGS's SGF plus what only its API has: the day the game ended as well as the
 * day it began (UTC days, like OGS's own DT), and each move's time. Times are
 * left out for correspondence games, where they are mostly the player being
 * away, and whenever the API's moves and the SGF's do not match one for one.
 */
export function ogsRecord(sgf: string, game: OgsGame): { sgf: string; timed: boolean } {
  const start = game.started?.slice(0, 10) ?? "";
  const end = game.ended?.slice(0, 10) ?? "";
  const dates = start && end && end !== start ? `${start},${end}` : start;

  const d = game.gamedata;
  const speed = d.time_control?.speed;
  const live = speed
    ? speed !== "correspondence"
    : Date.parse(game.ended ?? "") - Date.parse(game.started ?? "") < 86_400_000;
  // With free placement the API lists the handicap stones as Black's first
  // moves, while the SGF has them as setup stones.
  const played = d.moves.slice(d.free_handicap_placement && d.handicap > 1 ? d.handicap : 0);
  const moves = parseSgf(sgf).moves;
  const aligned =
    played.length === moves.length &&
    played.every(([x, y, ms], i) => {
      const v = moves[i].vertex;
      return Number.isFinite(ms) && (v ? v[0] === x && v[1] === y : x < 0);
    });
  const seconds = live && aligned ? played.map((m) => Math.round(m[2] / 100) / 10) : null;
  return { sgf: withGameTimes(sgf, dates, seconds), timed: seconds !== null };
}

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
  let timed = 0;
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
    let sgf = await sgfRes.text();
    let withTimes = false;
    await sleep(300); // be polite to the OGS API
    const gameRes = await fetch(`${OGS}/games/${g.id}`, { headers: { Accept: "application/json" } });
    if (gameRes.ok) {
      try {
        const record = ogsRecord(sgf, (await gameRes.json()) as OgsGame);
        sgf = record.sgf;
        withTimes = record.timed;
      } catch {
        // an SGF the parser rejects is reported by ingestSgf below
      }
    }
    const result = ingestSgf(db, sgf, "ogs", sourceKey);
    if (result.added) {
      added++;
      if (withTimes) timed++;
    } else skipped++;
    await sleep(300);
  }
  return {
    added,
    skipped,
    note: `checked ${games.results.length} most recent games for ${player.username}; ${timed} of those added have move times`,
  };
}
