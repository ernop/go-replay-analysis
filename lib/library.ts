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
