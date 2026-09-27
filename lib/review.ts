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

/** ogatak "Delta": this move's score minus the best move's, for the side to move. */
export function deltaLabel(bestLead: number, lead: number, side: "B" | "W"): string {
  const val = side === "B" ? lead - bestLead : bestLead - lead;
  const text = (val < 0 ? "-" : "+") + Math.abs(val).toFixed(2);
  return text === "+0.00" || text === "-0.00" ? "0" : text;
}

/** ogatak "Visits". */
export function visitsLabel(visits: number): string {
  if (visits > 9950) return (visits / 1000).toFixed(0) + "k";
  if (visits > 999) return (visits / 1000).toFixed(1) + "k";
  return String(visits);
}

// ogatak-clear "green_red" palette. Its middle stops are pushed off the wood
// colour so a candidate never disappears into the board.
const GREEN_RED = ["#12b86a", "#6fbf44", "#d2c247", "#d47b42", "#b14c46"].map((hex) => [
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
