export type GameStatus = "new" | "skipped" | "played" | "done";
export type AnalysisState = "none" | "queued" | "running" | "done" | "error";

export interface GameSummary {
  id: number;
  source: string;
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
  moveCount: number;
  status: GameStatus;
  tags: string[];
  addedAt: string;
  lastViewedMove: number;
  watchedToEnd: boolean;
  analysisState: AnalysisState;
  analysisProgress: number;
  analysisTotal: number;
  analysisEngine: string;
  /** Tracked people appearing in this game, e.g. ["Me", "Carl"] */
  people: string[];
  /** The tracked person playing each side, e.g. "Adam"; empty when that player is not tracked. */
  whitePerson: string;
  blackPerson: string;
}

export interface ParsedMove {
  color: "B" | "W";
  /** null = pass */
  vertex: [number, number] | null;
}

export interface SetupStone {
  sign: 1 | -1;
  vertex: [number, number];
}

export interface AnalysisCandidate {
  move: string; // GTP coordinate like "Q16" or "pass"
  winrate: number; // black perspective, 0..1
  scoreLead: number; // black perspective
  visits: number;
  pv: string[];
  /**
   * "continuation" means KataGo did not report this move and the value is the
   * root of the position after it was played. Absent means KataGo reported it.
   */
  source?: "continuation";
}

export interface AnalysisPosition {
  /** Position after `turn` moves have been played (0 = empty/setup board). */
  turn: number;
  winrate: number;
  scoreLead: number;
  visits: number;
  /** Every move KataGo reported, best first, plus the played move when missing. */
  candidates?: AnalysisCandidate[];
  /** Earlier analyses stored a capped list under this name. */
  top?: AnalysisCandidate[];
}

export interface GameAnalysis {
  engine: string;
  model: string;
  maxVisits: number;
  updatedAt: string;
  /** keyed by turn number as string */
  positions: Record<string, AnalysisPosition>;
}

export interface GameDetail {
  game: GameSummary;
  moves: ParsedMove[];
  initialStones: SetupStone[];
  rules: string;
  analysis: GameAnalysis | null;
}

export interface Account {
  id: number;
  server: string;
  username: string;
  person: string;
  addedAt: string;
  lastFetchAt: string | null;
  lastFetchNote: string | null;
}

export const KNOWN_PEOPLE = ["Me", "Carl", "Adam", "Gary"] as const;

export const SERVERS = [
  "OGS",
  "KGS",
  "DGS",
  "IGS/PandaNet",
  "Fox",
  "Tygem",
  "Other",
] as const;

/** Servers we can automatically fetch game archives from. */
export const FETCHABLE_SERVERS = ["OGS", "KGS", "DGS"] as const;
