import type { GameSummary } from "@/lib/types";

type Fields = Record<string, string | number | boolean>;

declare global {
  interface Window {
    /** Defined by public/fuseki-stats.js; absent until it loads, or when it is blocked. */
    FusekiStats?: { game(fields: Fields): void };
  }
}

/** The servers a game can be fetched from; seed and uploaded games have none. */
const SERVERS = ["dgs", "ogs", "kgs"];

/**
 * One replayer event for the site's usage statistics (PRODUCT.md "Usage
 * statistics"). public/fuseki-stats.js sends only on go-replayer.fuseki.net,
 * so the LAN app records nothing; statistics never break the page.
 */
export function recordReview(r: "opened" | "finished", game: GameSummary, moves: number): void {
  const fields: Fields = { m: "review", r, g: game.id, mv: moves };
  if (SERVERS.includes(game.source)) fields.src = game.source;
  try {
    window.FusekiStats?.game(fields);
  } catch {}
}
