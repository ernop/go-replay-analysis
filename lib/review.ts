import type { AnalysisCandidate, AnalysisPosition } from "./types";
export { gtpToVertex, vertexToGtp } from "./gtp";

// Board candidates follow ogatak-clear's count mode (`candidate_filter:
// "count"`): the engine's first move plus the CANDIDATE_COUNT lowest-cost
// other moves with enough visits to have a settled value.
export const CANDIDATE_COUNT = 5;

/**
 * Ogatak's fixed minimum is 50 visits, sized for live searches of tens of
 * thousands. Stored analysis here is about 1,000 visits per position, where
 * 50 would hide most real alternatives, so the minimum is 1% of the position's
 * visits (10 at 1,000; 50 at 5,000).
 */
export function candidateMinVisits(rootVisits: number): number {
  return Math.max(5, Math.round(rootVisits * 0.01));
}

/** Moves KataGo reported for this position. Values the worker added for the move played are excluded. */
export function positionCandidates(pos: AnalysisPosition | undefined): AnalysisCandidate[] {
  if (!pos) return [];
  return (pos.candidates ?? pos.top ?? []).filter((c) => c.source !== "continuation");
}

/** Points worse than the best move for the side to move, clamped at 0 (ogatak `info_cost`). */
export function candidateCost(bestLead: number, lead: number, side: "B" | "W"): number {
  const delta = side === "B" ? bestLead - lead : lead - bestLead;
  return delta > 0 ? delta : 0;
}

export interface BoardCandidate {
  candidate: AnalysisCandidate;
  cost: number;
}

/**
 * ogatak `select_candidates` in count mode. The first move is always kept and
 * is the cost reference; ties keep engine order; passes are skipped. The game's
 * next move is never added, because a replay must not reveal the future.
 */
export function selectCandidates(
  infos: AnalysisCandidate[],
  side: "B" | "W",
  rootVisits: number
): { shown: BoardCandidate[]; scale: number } {
  if (infos.length === 0) return { shown: [], scale: 0.5 };
  const bestLead = infos[0].scoreLead;
  const costs = infos.map((c) => candidateCost(bestLead, c.scoreLead, side));
  const minVisits = candidateMinVisits(rootVisits);
  const rest: number[] = [];
  for (let i = 1; i < infos.length; i++) {
    if (infos[i].move.toLowerCase() !== "pass" && infos[i].visits >= minVisits) rest.push(i);
  }
  rest.sort((a, b) => costs[a] - costs[b] || a - b);
  const keep = new Set([0, ...rest.slice(0, CANDIDATE_COUNT)]);
  const shown: BoardCandidate[] = [];
  infos.forEach((candidate, i) => {
    if (keep.has(i)) shown.push({ candidate, cost: costs[i] });
  });
  return { shown, scale: Math.max(0.5, ...shown.map((s) => s.cost)) };
}

function sameMove(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * The played move's score (Black-POV), comparable with the other candidates
 * of the position it was played from, and the visits of the search that gave
 * it. KataGo's own value is used only when the move had the board's minimum
 * visits; below that it is unsettled, and the position after the move, which
 * had a full search of its own, values it instead (PRODUCT.md "Guess mode").
 */
export function playedMoveValue(
  parent: AnalysisPosition,
  child: AnalysisPosition | undefined,
  played: string
): { lead: number; visits: number } | null {
  const entry = (parent.candidates ?? parent.top ?? []).find((c) => sameMove(c.move, played));
  if (entry && entry.source !== "continuation" && entry.visits >= candidateMinVisits(parent.visits)) {
    return { lead: entry.scoreLead, visits: entry.visits };
  }
  if (child) return { lead: child.scoreLead, visits: child.visits };
  return entry ? { lead: entry.scoreLead, visits: entry.visits } : null;
}

export interface MoveRating {
  /** The mover's other options, as the board showed them before the move. */
  alternatives: BoardCandidate[];
  bestLead: number;
  playedLead: number;
  /** Visits behind `playedLead`: the move's own, or the following position's when that valued it. */
  playedVisits: number;
  /** Points the move threw away, >= 0. */
  playedCost: number;
  /** Gradient scale; includes the played move, so a move worse than every alternative ends up at the far end. */
  scale: number;
}

/** How a played move compares with the options the mover had; null without analysis. */
export function rateMove(
  parent: AnalysisPosition | undefined,
  child: AnalysisPosition | undefined,
  played: string,
  mover: "B" | "W"
): MoveRating | null {
  const infos = positionCandidates(parent);
  if (!parent || infos.length === 0) return null;
  const value = playedMoveValue(parent, child, played);
  if (value === null) return null;
  const { shown, scale } = selectCandidates(infos, mover, parent.visits);
  const bestLead = infos[0].scoreLead;
  const playedCost = candidateCost(bestLead, value.lead, mover);
  return {
    alternatives: shown.filter((s) => !sameMove(s.candidate.move, played)),
    bestLead,
    playedLead: value.lead,
    playedVisits: value.visits,
    playedCost,
    scale: Math.max(scale, playedCost),
  };
}

/** A number of points as the app writes it everywhere: one decimal without a leading zero (".3"), whole points from 10 up ("12"); "0" when it rounds to nothing. */
export function pointsLabel(points: number): string {
  const text = points.toFixed(points >= 9.95 ? 0 : 1);
  return Number(text) === 0 ? "0" : text.replace(/^0\./, ".");
}

/** ogatak "Delta": this move's score minus the best move's, for the side to move ("-.3", "+1.2"); "0" when it rounds to nothing. */
export function deltaLabel(bestLead: number, lead: number, side: "B" | "W"): string {
  const val = side === "B" ? lead - bestLead : bestLead - lead;
  const size = pointsLabel(Math.abs(val));
  return size === "0" ? "0" : (val < 0 ? "-" : "+") + size;
}

/** ogatak "Visits". */
export function visitsLabel(visits: number): string {
  if (visits > 9950) return (visits / 1000).toFixed(0) + "k";
  if (visits > 999) return (visits / 1000).toFixed(1) + "k";
  return String(visits);
}

// Best to worst: green through yellow and light orange to a soft red, with no
// brown on the way. Every stop is light enough to stand off the wood and to
// carry black text.
const GREEN_RED = ["#1fc46a", "#8fd957", "#ecea6a", "#fbb870", "#f47c7c"].map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

function toLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function toSrgb(x: number): number {
  const y = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(y * 255)));
}

/** Gradient colour for a cost; `scale` is the cost that reaches the last stop. */
export function costColour(cost: number, scale: number): string {
  const t = scale > 0 ? Math.min(1, Math.max(0, cost / scale)) : 0;
  const scaled = t * (GREEN_RED.length - 1);
  const i = Math.min(GREEN_RED.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const rgb = GREEN_RED[i].map((a, k) => {
    const b = GREEN_RED[i + 1][k];
    return toSrgb(toLinear(a) + (toLinear(b) - toLinear(a)) * f);
  });
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
