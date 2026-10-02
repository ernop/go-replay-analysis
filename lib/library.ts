import type { GameSummary } from "@/lib/types";

/** What /data/library.json holds: every game and the tracked people's names. */
export interface LibraryData {
  games: GameSummary[];
  people: string[];
}

export interface LibraryFilters {
  analysis: string;
  status: string;
  person: string;
  winner: string;
  source: string;
  size: string;
  kind: string;
  q: string;
  sort: string;
}

/** Game pages take the id as a query parameter, so the public copy needs one page. */
export function gameHref(id: number): string {
  return `/game?id=${id}`;
}

/** DGS names players "Real Name (handle)"; the app shows the handle. */
export function handleOf(player: string): string {
  return /\(([^()]+)\)\s*$/.exec(player)?.[1].trim() || player;
}

/** DGS stores "start,end" and SGF allows "start..end"; the start date is what "Date played" sorts by. */
export function playedOn(g: GameSummary): string {
  return g.datePlayed.split(/,|\.\./)[0] || "—";
}

/**
 * When a game played over more than one day ended, and how many days after
 * it began; null for a one-day game. SGF shortens later dates to "MM-DD" or
 * "DD" ("1855-04-22,24,05-05").
 */
export function finishedOn(g: GameSummary): { date: string; days: number } | null {
  const dates: string[] = [];
  let full = "";
  for (const part of g.datePlayed.split(/,|\.\./).map((p) => p.trim())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) full = part;
    else if (full && /^\d{2}-\d{2}$/.test(part)) full = `${full.slice(0, 4)}-${part}`;
    else if (full && /^\d{2}$/.test(part)) full = `${full.slice(0, 7)}-${part}`;
    else continue;
    dates.push(full);
  }
  if (dates.length < 2) return null;
  const last = dates[dates.length - 1];
  const days = Math.round((Date.parse(last) - Date.parse(dates[0])) / 86_400_000);
  return days > 0 ? { date: last, days } : null;
}

/** The library's filters and sort, applied in the browser to every game. */
export function filterGames(games: GameSummary[], f: LibraryFilters): GameSummary[] {
  const q = f.q.trim().toLowerCase();
  const kept = games.filter(
    (g) =>
      (f.status === "all" || g.status === f.status) &&
      (f.winner === "any" || g.winner === f.winner) &&
      (f.source === "all" || g.source === f.source) &&
      (f.size === "all" || g.boardSize === Number(f.size)) &&
      (f.analysis !== "done" || g.analysisState === "done") &&
      (f.kind !== "even" || g.handicap === 0) &&
      (f.kind !== "handicap" || g.handicap > 0) &&
      (f.person === "all" || g.people.includes(f.person)) &&
      (!q ||
        [g.black, g.white, g.event, ...g.tags].some((text) => text.toLowerCase().includes(q)))
  );
  const order =
    f.sort === "date"
      ? (a: GameSummary, b: GameSummary) => b.datePlayed.localeCompare(a.datePlayed) || b.id - a.id
      : f.sort === "moves"
        ? (a: GameSummary, b: GameSummary) => b.moveCount - a.moveCount || b.id - a.id
        : (a: GameSummary, b: GameSummary) => b.id - a.id;
  return kept.sort(order);
}
