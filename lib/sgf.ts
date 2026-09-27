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
    if (node.data.B !== undefined) {
      moves.push({ color: "B", vertex: sgfVertex(node.data.B[0] ?? "", boardSize) });
    } else if (node.data.W !== undefined) {
      moves.push({ color: "W", vertex: sgfVertex(node.data.W[0] ?? "", boardSize) });
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
