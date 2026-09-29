import { parse, type SgfNode } from "@sabaki/sgf";
import type { ParsedMove, SetupStone } from "./types";

export interface ParsedGame {
  black: string;
  white: string;
  blackRank: string;
  whiteRank: string;
  result: string;
  winner: "B" | "W" | "";
  boardSize: number;
  handicap: number;
  komi: number | null;
  datePlayed: string;
  event: string;
  rules: string;
  moves: ParsedMove[];
  initialStones: SetupStone[];
}

function prop(node: SgfNode, key: string): string {
  const v = node.data[key];
  return v && v.length > 0 ? v[0] : "";
}

function sgfVertex(value: string, size: number): [number, number] | null {
  if (value.length < 2) return null;
  const x = value.charCodeAt(0) - 97;
  const y = value.charCodeAt(1) - 97;
  if (x < 0 || y < 0 || x >= size || y >= size) return null; // "tt" on <=19 = pass
  return [x, y];
}

/** Expand SGF point lists which may contain compressed rectangles like "aa:cc". */
function expandPoints(values: string[], size: number): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) {
    if (v.includes(":")) {
      const [a, b] = v.split(":");
      const va = sgfVertex(a, size);
      const vb = sgfVertex(b, size);
      if (!va || !vb) continue;
      for (let x = Math.min(va[0], vb[0]); x <= Math.max(va[0], vb[0]); x++) {
        for (let y = Math.min(va[1], vb[1]); y <= Math.max(va[1], vb[1]); y++) {
          out.push([x, y]);
        }
      }
    } else {
      const vv = sgfVertex(v, size);
      if (vv) out.push(vv);
    }
  }
  return out;
}

interface Overtime {
  kind: "byoyomi" | "canadian" | "fischer" | "none";
  /** Byo-yomi periods, or Canadian stones per period. */
  count: number;
  /** Seconds per period, or the Fischer increment. */
  seconds: number;
}

/** SGF OT as written by KGS, OGS and CGoban: "5x30 byo-yomi", "25/600 Canadian", "30 Fischer". */
function parseOvertime(ot: string): Overtime {
  const byo = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*byo-?yomi/i.exec(ot);
  if (byo) return { kind: "byoyomi", count: Number(byo[1]), seconds: Number(byo[2]) };
  const can = /(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*canadian/i.exec(ot);
  if (can) return { kind: "canadian", count: Number(can[1]), seconds: Number(can[2]) };
  const fis = /fischer/i.test(ot) ? /(\d+(?:\.\d+)?)/.exec(ot) : null;
  if (fis) return { kind: "fischer", count: 0, seconds: Number(fis[1]) };
  return { kind: "none", count: 0, seconds: 0 };
}

/**
 * Times moves from the time left that live servers record after each move
 * (BL/WL, with OB/OW periods or stones left once in overtime). The returned
 * function gives a move's seconds, or null where the record cannot tell, such
 * as the move that starts a new Canadian period.
 */
function makeClock(mainTime: number | null, ot: Overtime) {
  const sides = {
    B: { left: mainTime, periods: null as number | null },
    W: { left: mainTime, periods: null as number | null },
  };
  return (color: "B" | "W", left: number, periods: number | null): number | null => {
    const s = sides[color];
    let used: number | null = null;
    if (ot.kind === "byoyomi" && periods !== null) {
      // Each move starts a fresh period; a move that overran spent whole periods.
      const mainLeft = s.periods === null ? (s.left ?? 0) : 0;
      used = mainLeft + ((s.periods ?? ot.count) - periods) * ot.seconds + (ot.seconds - left);
    } else if (ot.kind === "canadian" && periods !== null) {
      if (s.periods === null) used = (s.left ?? 0) + (ot.seconds - left);
      else if (periods < s.periods && s.left !== null) used = s.left - left;
    } else if (s.left !== null) {
      used = s.left - left + (ot.kind === "fischer" ? ot.seconds : 0);
    }
    s.left = left;
    s.periods = periods;
    return used !== null && Number.isFinite(used) && used >= 0 ? used : null;
  };
}

export function parseResult(re: string): "B" | "W" | "" {
  const m = /^(B|W)\+/i.exec(re.trim());
  if (m) return m[1].toUpperCase() as "B" | "W";
  return "";
}

export function parseSgf(content: string): ParsedGame {
  const roots = parse(content);
  if (roots.length === 0) throw new Error("No game tree found in SGF");
  const root = roots[0];

  const szRaw = prop(root, "SZ") || "19";
  const boardSize = parseInt(szRaw.split(":")[0], 10) || 19;

  const moves: ParsedMove[] = [];
  const initialStones: SetupStone[] = [];
  const mainTime = parseFloat(prop(root, "TM"));
  const clock = makeClock(Number.isFinite(mainTime) ? mainTime : null, parseOvertime(prop(root, "OT")));

  // Walk the mainline. Setup stones (AB/AW) count as initial stones only
  // while no move has been played yet; later board edits are rare and ignored.
  let node: SgfNode | undefined = root;
  while (node) {
    if (moves.length === 0) {
      if (node.data.AB) {
        for (const v of expandPoints(node.data.AB, boardSize)) {
          initialStones.push({ sign: 1, vertex: v });
        }
      }
      if (node.data.AW) {
        for (const v of expandPoints(node.data.AW, boardSize)) {
          initialStones.push({ sign: -1, vertex: v });
        }
      }
    }
    const color = node.data.B !== undefined ? "B" : node.data.W !== undefined ? "W" : null;
    if (color) {
      const move: ParsedMove = { color, vertex: sgfVertex(node.data[color]?.[0] ?? "", boardSize) };
      const left = parseFloat(prop(node, color === "B" ? "BL" : "WL"));
      if (Number.isFinite(left)) {
        const periods = parseInt(prop(node, color === "B" ? "OB" : "OW"), 10);
        const seconds = clock(color, left, Number.isFinite(periods) ? periods : null);
        if (seconds !== null) move.seconds = Math.round(seconds * 10) / 10;
      }
      moves.push(move);
    }
    node = node.children[0];
  }

  const result = prop(root, "RE");
  const komiRaw = prop(root, "KM");
  const komi = komiRaw === "" ? null : parseFloat(komiRaw);

  return {
    black: prop(root, "PB") || "Black",
    white: prop(root, "PW") || "White",
    blackRank: prop(root, "BR"),
    whiteRank: prop(root, "WR"),
    result,
    winner: parseResult(result),
    boardSize,
    handicap: parseInt(prop(root, "HA") || "0", 10) || 0,
    komi: komi !== null && Number.isFinite(komi) ? komi : null,
    datePlayed: prop(root, "DT"),
    event: prop(root, "EV") || prop(root, "GN"),
    rules: (prop(root, "RU") || "japanese").toLowerCase(),
    moves,
    initialStones,
  };
}

export { gtpToVertex, vertexToGtp } from "./gtp";
