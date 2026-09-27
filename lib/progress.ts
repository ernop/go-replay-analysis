import { SITE_MODE } from "@/lib/site-mode";
import type { GameStatus, GameSummary } from "@/lib/types";

/** What a viewer has done with one game. */
export interface Progress {
  status: GameStatus;
  lastViewedMove: number;
  watchedToEnd: boolean;
}

/** On the public copy: game id -> Progress, for this browser only. */
const STORAGE_KEY = "go-replayer.progress";
const UNSEEN: Progress = { status: "new", lastViewedMove: 0, watchedToEnd: false };

function readAll(): Record<string, Progress> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
}

/** The LAN app's summaries already carry progress; the public copy's come from this browser. */
export function withViewerProgress(game: GameSummary): GameSummary {
  return SITE_MODE === "public" ? { ...game, ...readAll()[String(game.id)] } : game;
}

/**
 * Saves progress: the LAN app writes the library database, the public copy
 * this browser. Reaching the final move marks a new or skipped game played in
 * both.
 */
export async function saveProgress(
  id: number,
  change: { status?: GameStatus; lastViewedMove?: number; watchedToEnd?: boolean }
): Promise<void> {
  if (SITE_MODE === "lan") {
    const response = await fetch(`/api/games/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    if (!response.ok) throw new Error(`Saving game ${id} failed: HTTP ${response.status}`);
    return;
  }
  const all = readAll();
  const current = all[String(id)] ?? UNSEEN;
  const next: Progress = {
    status: change.status ?? current.status,
    lastViewedMove: change.lastViewedMove ?? current.lastViewedMove,
    watchedToEnd: current.watchedToEnd || change.watchedToEnd === true,
  };
  if (change.watchedToEnd && (next.status === "new" || next.status === "skipped")) next.status = "played";
  all[String(id)] = next;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
