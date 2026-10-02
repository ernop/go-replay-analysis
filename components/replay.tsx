"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import GoBoard from "@sabaki/go-board";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Info, Minus, Pause, Play, Plus } from "lucide-react";
import { Popover } from "radix-ui";
import { Goban, SIDE_COLOUR, type BoardMark, type PlayedMark } from "@/components/goban";
import { ReviewCharts } from "@/components/review-charts";
import { TagEditor } from "@/components/tag-editor";
import { finishedOn, handleOf, playedOn } from "@/lib/library";
import { saveProgress, withViewerProgress } from "@/lib/progress";
import {
  costColour,
  deltaLabel,
  gtpToVertex,
  pointsLabel,
  positionCandidates,
  rateMove,
  selectCandidates,
  vertexToGtp,
  visitsLabel,
  type BoardCandidate,
} from "@/lib/review";
import { SITE_MODE } from "@/lib/site-mode";
import { useStoredString } from "@/lib/use-stored";
import type { GameAnalysis, GameDetail, GameStatus, GameSummary, ParsedMove } from "@/lib/types";

interface Position {
  signMap: number[][];
  lastMove: [number, number] | null;
  capturedByBlack: number;
  capturedByWhite: number;
}

/** Seconds per move while playing. */
const SPEEDS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 60];
const DEFAULT_SPEED = 10;
/**
 * "every" choices stored as "real:<factor>": each move waits as long as its
 * player took on the game's clock, times the factor. Only records from live
 * servers have a clock.
 */
const REAL_FACTORS = [0.5, 1, 1.5, 2, 3];
/** Real-time pacing never waits less, so a quick reply still shows before the next move. */
const REAL_MIN_SECONDS = 1;

/**
 * What the board shows. "analysis": the side to move's candidates. "guess":
 * nothing before a move; after it lands, its rating and the mover's other
 * options, for a while. "off": stones only.
 */
type BoardMode = "analysis" | "guess" | "off";
const MODES: BoardMode[] = ["analysis", "guess", "off"];

/**
 * How long guess mode shows a move's analysis: a number of seconds, "next"
 * (until the next move), or "accept" (until the viewer taps the board, with
 * autoplay waiting meanwhile).
 */
const REVEALS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20];
const DEFAULT_REVEAL = "3";
/** reveal-in in globals.css: a 200ms wait, then a 250ms fade. */
const REVEAL_FADE_IN_MS = 450;

/** Guess mode's badge sizes, in percent of the default; the middle one is the default. */
const BADGE_SIZES = [50, 70, 100, 140, 200];

/** The nearest size, so one saved by the old 50–200% slider still counts. */
function parseBadgeSize(setting: string): number {
  const n = Number(setting);
  if (!(n > 0)) return 100;
  const off = (s: number) => Math.abs(Math.log(s / n));
  return BADGE_SIZES.reduce((best, s) => (off(s) < off(best) ? s : best));
}

/** A shown rating: `idx` is the position after the rated move. */
interface Reveal {
  idx: number;
  serial: number;
  on: boolean;
  /** Shown because the move just landed, rather than on the viewer's tap. */
  landed: boolean;
}

const BIG_BUTTON =
  "flex w-full touch-manipulation items-center justify-center gap-2 rounded-sm border-2 bg-[#181818] hover:bg-[#222222] active:bg-[#2c2c2c]";

/** The wide-screen divider between board and panel: its width, the smallest board it gives, and the room it always leaves the panel. */
const DIVIDER_PX = 16;
const BOARD_MIN_PX = 320;
const PANEL_MIN_PX = 288;

/** The board's share of the row's width once the divider has been dragged; null for the default size. */
function parseBoardShare(setting: string): number | null {
  const n = Number(setting);
  return setting !== "" && n > 0.1 && n < 1 ? n : null;
}

function parseReveal(setting: string): string {
  // Settings saved as "hold" mean what is now "next".
  if (setting === "hold") return "next";
  return setting === "next" || setting === "accept" || REVEALS.includes(Number(setting)) ? setting : DEFAULT_REVEAL;
}

/** The median seconds per move on the game's clock; null unless most moves have a time. */
function typicalSeconds(moves: ParsedMove[]): number | null {
  const known = moves.flatMap((m) => (m.seconds === undefined ? [] : [m.seconds])).sort((a, b) => a - b);
  return known.length > 0 && known.length >= moves.length / 2 ? known[known.length >> 1] : null;
}

interface GameResult {
  winner: "B" | "W" | "draw";
  /** Shown in the winner's box: "+R", "+2.5", "+T"; "draw" shows in both. */
  tag: string;
  words: string;
}

function gameResult(re: string): GameResult | null {
  const r = re.trim();
  if (/^(0|draw|jigo)$/i.test(r)) return { winner: "draw", tag: "draw", words: "draw" };
  const m = /^([BW])\+(.*)$/i.exec(r);
  if (!m) return null;
  const how = m[2].trim();
  const [tag, words] =
    how === ""
      ? ["", "won"]
      : /^r(esign)?$/i.test(how)
        ? ["+R", "won by resignation"]
        : /^t(ime)?$/i.test(how)
          ? ["+T", "won on time"]
          : /^f(orfeit)?$/i.test(how)
            ? ["+F", "won by forfeit"]
            : Number.isFinite(Number(how))
              ? [`+${how}`, `won by ${how} points`]
              : [`+${how}`, `won (${how})`];
  return { winner: m[1].toUpperCase() as "B" | "W", tag, words };
}

function countStones(signMap: number[][], sign: number): number {
  let n = 0;
  for (const row of signMap) for (const v of row) if (v === sign) n++;
  return n;
}

function candidateMarks(
  shown: BoardCandidate[],
  scale: number,
  size: number,
  lines: (s: BoardCandidate) => string[]
): BoardMark[] {
  const marks: BoardMark[] = [];
  for (const s of shown) {
    const vertex = gtpToVertex(s.candidate.move, size);
    if (!vertex) continue;
    marks.push({ vertex, fill: costColour(s.cost, scale), lines: lines(s) });
  }
  return marks;
}

export function Replay({ id }: { id: number }) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [error, setError] = useState("");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedSetting, setSpeedSetting] = useStoredString("replay.speed", String(DEFAULT_SPEED));
  const [modeSetting, setModeSetting] = useStoredString("replay.mode", "analysis");
  const [revealSetting, setRevealSetting] = useStoredString("replay.reveal", DEFAULT_REVEAL);
  const [playedSizeSetting, setPlayedSizeSetting] = useStoredString("replay.playedBadge", "100");
  const [markSizeSetting, setMarkSizeSetting] = useStoredString("replay.otherBadges", "100");
  const [visitsSetting, setVisitsSetting] = useStoredString("replay.badgeVisits", "0");
  const [boardShareSetting, setBoardShareSetting] = useStoredString("replay.boardShare", "");
  const [resizingBoard, setResizingBoard] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  // Guess mode's "show analysis" button: while it is pressed, each move's
  // analysis stays up until the next move, whatever the setting beside it.
  const [forceAnalysis, setForceAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState("none");
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const moveCount = detail?.moves.length ?? 0;
  const size = detail?.game.boardSize ?? 19;
  const mode: BoardMode = MODES.includes(modeSetting as BoardMode) ? (modeSetting as BoardMode) : "analysis";
  const revealChoice = parseReveal(revealSetting);
  const revealRule = forceAnalysis ? "next" : revealChoice;
  const revealMs = REVEALS.includes(Number(revealRule)) ? Number(revealRule) * 1000 : null;
  const playedSize = parseBadgeSize(playedSizeSetting);
  const markSize = parseBadgeSize(markSizeSetting);
  const showVisits = visitsSetting === "1";
  const boardShare = parseBoardShare(boardShareSetting);

  const typical = useMemo(() => (detail ? typicalSeconds(detail.moves) : null), [detail]);
  const factor = speedSetting.startsWith("real:") ? Number(speedSetting.slice(5)) : NaN;
  const realTime = typical !== null && REAL_FACTORS.includes(factor);
  const speed = SPEEDS.includes(Number(speedSetting)) ? Number(speedSetting) : DEFAULT_SPEED;
  /** Seconds until autoplay plays the next move. */
  const delay = realTime
    ? Math.max(REAL_MIN_SECONDS, (detail?.moves[idx]?.seconds ?? typical ?? DEFAULT_SPEED) * factor)
    : speed;

  useEffect(() => {
    fetch(`/data/games/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`game ${id} not found`);
        return r.json();
      })
      .then((d: GameDetail) => {
        const game = withViewerProgress(d.game);
        setDetail({ ...d, game });
        setAnalysis(d.analysis);
        setAnalysisState(game.analysisState);
        setAnalysisProgress(game.analysisProgress);
        const n = d.moves.length;
        if (game.lastViewedMove > 0 && game.lastViewedMove < n) {
          setIdx(game.lastViewedMove);
        }
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  const positions: Position[] = useMemo(() => {
    if (!detail) return [];
    const empty: number[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => 0)
    );
    for (const s of detail.initialStones) {
      empty[s.vertex[1]][s.vertex[0]] = s.sign;
    }
    let board = new GoBoard(empty);
    const out: Position[] = [
      { signMap: board.signMap, lastMove: null, capturedByBlack: 0, capturedByWhite: 0 },
    ];
    let capB = 0;
    let capW = 0;
    for (const mv of detail.moves) {
      const sign = mv.color === "B" ? 1 : -1;
      if (mv.vertex) {
        const before = countStones(board.signMap, -sign);
        const beforeOwn = countStones(board.signMap, sign);
        board = board.makeMove(sign, mv.vertex);
        const after = countStones(board.signMap, -sign);
        const afterOwn = countStones(board.signMap, sign);
        const captured = before - after;
        const selfCaptured = beforeOwn + 1 - afterOwn;
        if (sign === 1) {
          capB += captured;
          capW += Math.max(0, selfCaptured);
        } else {
          capW += captured;
          capB += Math.max(0, selfCaptured);
        }
        out.push({
          signMap: board.signMap,
          lastMove: mv.vertex,
          capturedByBlack: capB,
          capturedByWhite: capW,
        });
      } else {
        out.push({
          signMap: board.signMap,
          lastMove: null,
          capturedByBlack: capB,
          capturedByWhite: capW,
        });
      }
    }
    return out;
  }, [detail, size]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(moveCount, next));
      if (clamped === idx) return;
      setIdx(clamped);
      // Whichever way the viewer moved, the move now on the board is treated
      // as just played, so guess mode shows its analysis.
      setReveal((r) => (clamped > 0 ? { idx: clamped, serial: (r?.serial ?? 0) + 1, on: true, landed: true } : null));
      if (clamped >= moveCount) setPlaying(false);
    },
    [idx, moveCount]
  );

  const step = useCallback((delta: number) => goTo(idx + delta), [goTo, idx]);

  const togglePlay = useCallback(() => {
    if (idx >= moveCount) return;
    setPlaying((p) => !p);
  }, [idx, moveCount]);

  const lastPlayed = detail && idx > 0 ? detail.moves[idx - 1] : null;
  const rating = useMemo(() => {
    if (mode !== "guess" || !lastPlayed) return null;
    const before = analysis?.positions[String(idx - 1)];
    const after = analysis?.positions[String(idx)];
    return rateMove(before, after, vertexToGtp(lastPlayed.vertex, size), lastPlayed.color);
  }, [mode, lastPlayed, analysis, idx, size]);
  const shownReveal = rating && reveal?.idx === idx ? reveal : null;
  // "hold till accepted": autoplay waits while a move's analysis shows.
  const holding = revealRule === "accept" && !!shownReveal?.on;

  // One timer per move, so the countdown bar and the move stay in step. A
  // held analysis stops the clock; hiding it starts a full interval.
  useEffect(() => {
    if (!playing || idx >= moveCount || holding) return;
    const timer = setTimeout(() => goTo(idx + 1), delay * 1000);
    return () => clearTimeout(timer);
  }, [playing, delay, idx, moveCount, goTo, holding]);

  // A timed analysis runs out only while autoplay runs: paused, the board
  // changes only when the viewer acts. Pressing play starts its time afresh.
  useEffect(() => {
    if (!reveal?.on || revealMs === null || !playing) return;
    const serial = reveal.serial;
    const timer = setTimeout(
      () => setReveal((r) => (r && r.serial === serial ? { ...r, on: false } : r)),
      revealMs + (reveal.landed ? REVEAL_FADE_IN_MS : 0)
    );
    return () => clearTimeout(timer);
  }, [reveal, revealMs, playing]);

  const toggleReveal = useCallback(() => {
    if (idx === 0) return;
    setReveal((r) =>
      r && r.idx === idx && r.on
        ? { ...r, on: false }
        : { idx, serial: (r?.serial ?? 0) + 1, on: true, landed: false }
    );
  }, [idx]);

  // Changing how the badges look shows the current move's, and keeps them up while it changes.
  const previewBadges = useCallback(() => {
    if (idx === 0) return;
    setReveal((r) =>
      r && r.idx === idx && r.on ? { ...r } : { idx, serial: (r?.serial ?? 0) + 1, on: true, landed: false }
    );
  }, [idx]);

  // Pressing it shows the current move's analysis at once; letting go hands it back to the setting's timing.
  const toggleForceAnalysis = useCallback(() => {
    if (!forceAnalysis) previewBadges();
    setForceAnalysis(!forceAnalysis);
  }, [forceAnalysis, previewBadges]);

  const changeMode = useCallback(
    (next: string) => {
      setModeSetting(next);
      setReveal(null);
    },
    [setModeSetting]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const deltas: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 10, ArrowDown: -10 };
      if (e.key in deltas) step(deltas[e.key]);
      else if (e.key === "Home") goTo(0);
      else if (e.key === "End") goTo(moveCount);
      else if (e.key === " ") togglePlay();
      else if (e.key === "Enter" && mode === "guess") toggleReveal();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveCount, goTo, step, togglePlay, toggleReveal, mode]);

  // progress tracking (throttled)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!detail) return;
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      saveProgress(id, {
        lastViewedMove: idx,
        watchedToEnd: idx === moveCount && moveCount > 0,
      }).catch(() => {});
    }, 1200);
    return () => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
    };
  }, [idx, id, detail, moveCount]);

  // poll analysis while it's being computed
  useEffect(() => {
    // The public copy is a snapshot: analysis never advances in place there.
    if (SITE_MODE === "public" || (analysisState !== "queued" && analysisState !== "running")) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/analysis/${id}`);
        const d = await r.json();
        setAnalysisState(d.state);
        setAnalysisProgress(d.progress);
        if (d.analysis) setAnalysis(d.analysis);
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [analysisState, id]);

  const setStatus = useCallback(
    (status: GameStatus) => {
      if (!detail) return;
      setDetail({ ...detail, game: { ...detail.game, status } });
      saveProgress(id, { status }).catch(() => {});
    },
    [detail, id]
  );

  const setTags = useCallback(
    (tags: string[]) => {
      if (!detail) return;
      setDetail({ ...detail, game: { ...detail.game, tags } });
      fetch(`/api/games/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      }).catch(() => {});
    },
    [detail, id]
  );

  const queueAnalysis = useCallback(() => {
    setAnalysisState("queued");
    fetch(`/api/analysis/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds: [id] }),
    }).catch(() => {});
  }, [id]);

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="fs-emph font-bold">{error}</p>
        <Link href="/" className="underline">
          Back to library
        </Link>
      </div>
    );
  }
  if (!detail) {
    return <p className="p-8 text-center fs-body">Loading game…</p>;
  }

  const g = detail.game;
  const pos = positions[Math.min(idx, positions.length - 1)];
  const current = analysis?.positions[String(idx)];
  const sideToMove: "B" | "W" =
    idx < moveCount
      ? detail.moves[idx].color
      : detail.moves[moveCount - 1]?.color === "B"
        ? "W"
        : "B";
  // The result stays hidden until the last move is on the board.
  const atEnd = moveCount > 0 && idx >= moveCount;
  const result = atEnd ? gameResult(g.result) : null;

  // Analysis mode's circles carry "Delta + Visits" (the owner's Ogatak
  // setting); guess mode's badges carry the points lost, and the visits when
  // the viewer asks for them.
  let marks: BoardMark[] = [];
  let played: PlayedMark | null = null;
  if (mode === "analysis") {
    const infos = positionCandidates(current);
    const { shown, scale } = selectCandidates(infos, sideToMove, current?.visits ?? 0);
    const bestLead = infos[0]?.scoreLead ?? 0;
    marks = candidateMarks(shown, scale, size, (s) => [
      deltaLabel(bestLead, s.candidate.scoreLead, sideToMove),
      visitsLabel(s.candidate.visits),
    ]);
  } else if (rating && shownReveal && lastPlayed) {
    const badgeLines = (cost: number, visits: number) =>
      showVisits ? [pointsLabel(cost), visitsLabel(visits)] : [pointsLabel(cost)];
    const bestFirst = [...rating.alternatives].sort((a, b) => a.cost - b.cost);
    marks = candidateMarks(bestFirst, rating.scale, size, (s) => badgeLines(s.cost, s.candidate.visits));
    if (lastPlayed.vertex) {
      played = {
        vertex: lastPlayed.vertex,
        fill: costColour(rating.playedCost, rating.scale),
        lines: badgeLines(rating.playedCost, rating.playedVisits),
      };
    }
  }
  const revealClass = !shownReveal
    ? ""
    : shownReveal.on
      ? shownReveal.landed
        ? "reveal-in"
        : "reveal-now"
      : "reveal-out";

  const scoreLead = Array.from(
    { length: moveCount + 1 },
    (_, i) => analysis?.positions[String(i)]?.scoreLead ?? null
  );
  const hasAnalysis = analysisState === "done" || (analysis !== null && analysisProgress > 0);
  const isPlaying = playing && idx < moveCount;
  const analysisTotal = moveCount + 1;
  const players = <Players game={g} toPlay={atEnd ? null : sideToMove} result={result} />;

  return (
    <div
      ref={rowRef}
      className="flex flex-col gap-2 lg:h-[calc(100vh_-_45px)] lg:flex-row lg:items-start lg:gap-0"
      style={boardShare === null ? undefined : ({ "--board-share": boardShare } as CSSProperties)}
    >
      {/* Phones show the players above the board; desktop at the top of the panel. */}
      <div className="lg:hidden">{players}</div>

      {/* The board takes the height (45px: the top bar and the page's vertical padding). By default the panel keeps at
          least about 430px; once the divider is dragged the board takes its share of the row, and 304px is
          PANEL_MIN_PX + DIVIDER_PX. */}
      <div
        className={`relative aspect-square w-full lg:flex-none ${
          boardShare !== null || resizingBoard
            ? "lg:w-[min(calc(100vh_-_45px),calc(var(--board-share)*100%),calc(100%_-_304px))]"
            : "lg:w-[min(calc(100vh_-_45px),calc(100vw_-_31rem))]"
        }`}
      >
        <Goban
          size={size}
          signMap={pos.signMap}
          lastMove={pos.lastMove}
          marks={marks}
          played={played}
          badges={mode === "guess"}
          markScale={markSize / 100}
          playedScale={playedSize / 100}
          markSide={mode === "guess" ? lastPlayed?.color : undefined}
          marksKey={mode === "guess" ? `reveal-${reveal?.serial ?? 0}` : mode}
          marksClassName={mode === "guess" ? revealClass : undefined}
          onBoardClick={mode === "guess" ? toggleReveal : undefined}
        >
          {isPlaying && !holding && (
            <div
              key={`${idx}-${delay}`}
              className="autoplay-progress absolute left-0 top-full mt-[3px] h-1 bg-gold"
              style={{ animationDuration: `${delay}s` }}
            />
          )}
        </Goban>
      </div>

      <BoardDivider
        rowRef={rowRef}
        onResizing={setResizingBoard}
        onChange={(share) => setBoardShareSetting(share === null ? "" : share.toFixed(4))}
      />

      <div className="@container flex min-w-0 flex-1 flex-col gap-4 bg-[#111111] px-3 py-3 lg:h-full lg:overflow-y-auto lg:px-4">
        <div className="hidden flex-col gap-2 lg:flex @min-[720px]:flex-row @min-[720px]:items-center @min-[720px]:gap-5">
          <div className="min-w-0 flex-1">{players}</div>
          <GameFacts game={g} pos={pos} />
        </div>

        <div className="flex select-none flex-col gap-2">
          <button
            type="button"
            onClick={togglePlay}
            title="Play / pause (space)"
            className={`${BIG_BUTTON} h-12 ${isPlaying ? "border-gold" : "border-[#9a9a9a]"}`}
          >
            {isPlaying ? <Pause size={22} /> : <Play size={22} />}
            <span className="fs-body font-bold">{isPlaying ? "pause" : "play"}</span>
            {isPlaying && holding && <span className="fs-caption">· tap the board to go on</span>}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              title="Previous move (←)"
              onClick={() => step(-1)}
              className={`${BIG_BUTTON} h-16 border-[#9a9a9a]`}
            >
              <ChevronLeft size={44} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              title="Next move (→)"
              onClick={() => step(1)}
              className={`${BIG_BUTTON} h-16 border-[#9a9a9a]`}
            >
              <ChevronRight size={44} strokeWidth={2.5} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <SmallButton title="First move (Home)" onClick={() => goTo(0)}>
              <ChevronFirst size={18} />
            </SmallButton>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-center gap-x-3">
              <span className="whitespace-nowrap">
                <span className="fs-caption">move </span>
                <span className="fs-emph font-bold tabular-nums">{idx}</span>
                <span className="fs-ui tabular-nums"> / {moveCount}</span>
              </span>
              {mode === "guess" && (
                // Kept even when empty, so nothing shifts when a rating appears.
                <span className="flex min-w-[6.5rem] items-baseline">
                  {rating && shownReveal && lastPlayed && (
                    <span key={shownReveal.serial} className={`flex items-baseline gap-2 whitespace-nowrap ${revealClass}`}>
                      <span className="fs-caption">{lastPlayed.vertex ? "lost" : "pass lost"}</span>
                      <span
                        className="fs-emph rounded-sm border-2 px-1.5 font-bold tabular-nums text-black"
                        style={{
                          background: costColour(rating.playedCost, rating.scale),
                          borderColor: SIDE_COLOUR[lastPlayed.color],
                          // A black border would vanish into the panel without a light line round it.
                          boxShadow: "0 0 0 1px #9a9a9a",
                        }}
                      >
                        {pointsLabel(rating.playedCost)}
                      </span>
                    </span>
                  )}
                </span>
              )}
            </div>
            <SmallButton title="Last move (End)" onClick={() => goTo(moveCount)}>
              <ChevronLast size={18} />
            </SmallButton>
          </div>
          <div className="fs-caption flex flex-wrap items-center gap-x-5 gap-y-2">
            <label
              className="flex items-center gap-2"
              title="Time between moves while playing. The real choices wait as long as the player took on the game's clock, times the factor; only records from live servers have a clock."
            >
              every
              <select
                value={realTime ? speedSetting : String(speed)}
                onChange={(e) => setSpeedSetting(e.target.value)}
                className="field fs-ui"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={String(s)}>
                    {s} s
                  </option>
                ))}
                <optgroup label={typical === null ? "as the players took (no clock in this record)" : "as the players took"}>
                  {REAL_FACTORS.map((f) => (
                    <option key={f} value={`real:${f}`} disabled={typical === null}>
                      real ×{f}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label
              className="flex items-center gap-2"
              title="analysis: the engine's candidates before each move. guess: a clean board before each move; after it, its rating and the other options. off: stones only."
            >
              mode
              <select value={mode} onChange={(e) => changeMode(e.target.value)} className="field fs-ui">
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {mode === "guess" && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={forceAnalysis}
                  onClick={toggleForceAnalysis}
                  title="Pressed: each move's analysis shows now and stays up until the next move is played, whatever the setting beside it says. Press again to go back to that setting."
                  className={`h-8 touch-manipulation whitespace-nowrap rounded-sm border-2 px-2 hover:bg-[#222222] ${forceAnalysis ? "border-gold" : "border-[#777777]"}`}
                >
                  show analysis
                </button>
                {forceAnalysis ? (
                  <span className="fs-ui font-bold">until next move</span>
                ) : (
                  <select
                    value={revealChoice}
                    onChange={(e) => setRevealSetting(e.target.value)}
                    className="field fs-ui"
                    aria-label="How long analysis shows"
                    title="How long a move's analysis shows during autoplay once the move is on the board, whether you stepped forward or back. While paused it stays until you act. 'hold till accepted' keeps it, and holds autoplay, until you tap the board. Tap the board (or press Enter) any time to show or hide it."
                  >
                    {REVEALS.map((s) => (
                      <option key={s} value={String(s)}>
                        {s} s
                      </option>
                    ))}
                    <option value="next">until next move</option>
                    <option value="accept">hold till accepted</option>
                  </select>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {hasAnalysis ? (
            <ReviewCharts
              scoreLead={scoreLead}
              movers={detail.moves.map((m) => m.color)}
              current={idx}
              onSeek={(t) => {
                setPlaying(false);
                goTo(t);
              }}
            />
          ) : analysisState === "queued" || analysisState === "running" ? (
            SITE_MODE === "lan" ? (
              <p className="fs-body">
                {analysisState === "queued" ? "Queued for analysis" : "Analyzing"}: {analysisProgress}/{analysisTotal}{" "}
                positions. The worker runs on the GPU machine: <code className="font-bold">npm run analyze</code>
              </p>
            ) : (
              <p className="fs-body">Analysis is in progress for this game; it appears here once published.</p>
            )
          ) : analysisState === "error" ? (
            <p className="fs-body flex items-center gap-3">
              <span className="font-bold text-[#ff5555]">Analysis failed</span>
              {SITE_MODE === "lan" && (
                <button type="button" className="ctl border border-[#555555]" onClick={queueAnalysis}>
                  retry
                </button>
              )}
            </p>
          ) : (
            <p className="fs-body flex items-center gap-3">
              No analysis yet.
              {SITE_MODE === "lan" && (
                <button type="button" className="ctl border border-[#555555]" onClick={queueAnalysis}>
                  queue analysis
                </button>
              )}
            </p>
          )}
        </div>

        <div className="lg:hidden">
          <GameFacts game={g} pos={pos} />
        </div>

        <div className="fs-ui flex flex-col gap-2 border-t border-[#333333] pt-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>status</span>
            <span className="font-bold">{g.status}</span>
            <button type="button" className="ctl ml-2 border border-[#555555]" onClick={() => setStatus("played")}>
              mark played
            </button>
            <button type="button" className="ctl border border-[#555555]" onClick={() => setStatus("done")}>
              move to done
            </button>
          </div>
          {SITE_MODE === "lan" ? (
            <TagEditor tags={g.tags} onChange={setTags} />
          ) : (
            g.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2">
                <span>tags</span>
                <span className="font-bold">{g.tags.join(", ")}</span>
              </div>
            )
          )}
          <div className="fs-caption flex flex-wrap items-center justify-between gap-2">
            <Link href="/" className="underline">
              ← library
            </Link>
            {analysis && (
              <span>
                {analysis.engine} · {analysis.maxVisits.toLocaleString("en-US")} visits per position ·{" "}
                {analysisProgress}/{analysisTotal} positions
              </span>
            )}
          </div>
        </div>

        {mode === "guess" && (
          <div className="fs-caption flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#333333] pt-3">
            <SizeStepper
              label="played"
              title="Size of the played move's badge, in percent of the default."
              value={playedSize}
              onChange={(v) => {
                setPlayedSizeSetting(String(v));
                previewBadges();
              }}
            />
            <SizeStepper
              label="others"
              title="Size of the other moves' badges, in percent of the default."
              value={markSize}
              onChange={(v) => {
                setMarkSizeSetting(String(v));
                previewBadges();
              }}
            />
            <label
              className="flex items-center gap-2"
              title="Also show, under each badge's points, how many visits the engine spent on that move."
            >
              <input
                type="checkbox"
                className="size-4 accent-gold"
                checked={showVisits}
                onChange={(e) => {
                  setVisitsSetting(e.target.checked ? "1" : "0");
                  previewBadges();
                }}
              />
              visits
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

/** One of guess mode's badge sizes, stepped through BADGE_SIZES; a step past either end has no button. */
function SizeStepper({
  label,
  title,
  value,
  onChange,
}: {
  label: string;
  title: string;
  value: number;
  onChange: (size: number) => void;
}) {
  const at = BADGE_SIZES.indexOf(value);
  const stepClass =
    "flex h-8 w-7 touch-manipulation items-center justify-center hover:bg-[#222222] disabled:invisible";
  return (
    <div className="flex items-center gap-1" title={title}>
      <span>{label}</span>
      <div className="flex items-center rounded-sm border border-[#777777]">
        <button
          type="button"
          aria-label={`${label} smaller`}
          disabled={at <= 0}
          onClick={() => onChange(BADGE_SIZES[at - 1])}
          className={stepClass}
        >
          <Minus size={16} />
        </button>
        <span className="fs-ui min-w-[2.75rem] text-center font-bold tabular-nums">{value}%</span>
        <button
          type="button"
          aria-label={`${label} larger`}
          disabled={at >= BADGE_SIZES.length - 1}
          onClick={() => onChange(BADGE_SIZES[at + 1])}
          className={stepClass}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * The divider between the board and the panel on wide screens. Dragging it
 * gives the board a share of the row: never taller than the row, never under
 * BOARD_MIN_PX, and always leaving the panel PANEL_MIN_PX. Double-clicking
 * goes back to the default size. It takes no focus, so the arrow keys keep
 * stepping moves.
 */
function BoardDivider({
  rowRef,
  onResizing,
  onChange,
}: {
  rowRef: RefObject<HTMLDivElement | null>;
  onResizing: (on: boolean) => void;
  onChange: (share: number | null) => void;
}) {
  const drag = useRef<{ startX: number; grab: number; share: number; moved: boolean } | null>(null);
  const [active, setActive] = useState(false);

  const shareAt = (clientX: number, grab: number): number | null => {
    const row = rowRef.current;
    if (!row) return null;
    const width = row.clientWidth;
    const most = Math.min(row.clientHeight, width - PANEL_MIN_PX - DIVIDER_PX);
    const least = Math.min(most, BOARD_MIN_PX);
    const board = clientX - grab - row.getBoundingClientRect().left;
    return Math.max(least, Math.min(most, board)) / width;
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    setActive(false);
    onResizing(false);
    onChange(d.share);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Board size"
      title="Drag to make the board bigger or smaller. Double-click for the default size."
      className="group relative hidden w-4 flex-none cursor-col-resize touch-none select-none items-center justify-center lg:flex lg:self-stretch"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const grab = e.clientX - e.currentTarget.getBoundingClientRect().left;
        drag.current = { startX: e.clientX, grab, share: 0, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || (!d.moved && Math.abs(e.clientX - d.startX) < 3)) return;
        const share = shareAt(e.clientX, d.grab);
        if (share === null) return;
        d.share = share;
        // Set before the board switches to the share rule, so its first frame already has a share.
        rowRef.current?.style.setProperty("--board-share", String(share));
        if (!d.moved) {
          d.moved = true;
          setActive(true);
          onResizing(true);
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(null)}
    >
      <div className={`absolute inset-y-0 w-px ${active ? "bg-gold" : "bg-[#333333] group-hover:bg-[#9a9a9a]"}`} />
      <div className={`relative h-12 w-1.5 rounded-full ${active ? "bg-gold" : "bg-[#777777] group-hover:bg-[#bbbbbb]"}`} />
    </div>
  );
}

function SmallButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-9 w-10 flex-none touch-manipulation items-center justify-center rounded-sm border border-[#777777] hover:bg-[#222222]"
    >
      {children}
    </button>
  );
}

/**
 * White, then Black, as in the library. Each box is its stone's colour and
 * holds only the handle and rank; a gold ring marks the side to move, and at
 * the last move the winner's box carries the result.
 */
function Players({
  game,
  toPlay,
  result,
}: {
  game: GameSummary;
  toPlay: "B" | "W" | null;
  result: GameResult | null;
}) {
  const tagFor = (colour: "B" | "W") =>
    result && (result.winner === colour || result.winner === "draw") ? result : null;
  return (
    // The padding leaves room for the ring, which is drawn outside the box.
    <div className="grid grid-cols-2 gap-3 p-[5px]">
      <PlayerBox colour="W" name={game.white} rank={game.whiteRank} toPlay={toPlay === "W"} result={tagFor("W")} />
      <PlayerBox colour="B" name={game.black} rank={game.blackRank} toPlay={toPlay === "B"} result={tagFor("B")} />
    </div>
  );
}

function PlayerBox({
  colour,
  name,
  rank,
  toPlay,
  result,
}: {
  colour: "B" | "W";
  name: string;
  rank: string;
  toPlay: boolean;
  result: GameResult | null;
}) {
  const white = colour === "W";
  return (
    <div
      title={[name, rank, result?.words].filter(Boolean).join(" · ")}
      className={`flex min-w-0 items-baseline gap-2 rounded-sm px-3 py-1 ${
        white ? "border border-white bg-white text-black" : "border border-white/60 bg-black text-white"
      } ${toPlay ? "outline-3 outline-offset-2 outline-gold" : ""}`}
    >
      <span className="fs-body sm:fs-emph min-w-0 truncate font-bold">{handleOf(name)}</span>
      {rank && <span className="fs-caption sm:fs-body flex-none">{rank}</span>}
      {result && (
        <span className="ml-auto flex flex-none items-baseline gap-1.5">
          {result.winner !== "draw" && <span className="fs-fine sm:fs-caption">won</span>}
          {result.tag && <span className="fs-body sm:fs-emph font-bold">{result.tag}</span>}
        </span>
      )}
    </div>
  );
}

function MiniStone({ colour }: { colour: "B" | "W" }) {
  return (
    <span
      className={`inline-block size-3.5 flex-none rounded-full ${
        colour === "W" ? "bg-white" : "border border-white/70 bg-black"
      }`}
    />
  );
}

/** Handicap and date, small, beside the players on a wide panel; komi and captures behind "info". */
function GameFacts({ game, pos }: { game: GameSummary; pos: Position }) {
  return (
    <div className="fs-caption flex flex-wrap items-center gap-x-4 gap-y-1 @min-[720px]:flex-col @min-[720px]:items-end">
      {game.handicap > 0 && <span>H{game.handicap}</span>}
      <span>{playedOn(game)}</span>
      <GameInfo game={game} pos={pos} />
    </div>
  );
}

/**
 * Komi, captures and the dates, in a card that shows while the mouse is over
 * "info". A click or tap keeps it open until the next one, or a click
 * elsewhere.
 */
function GameInfo({ game, pos }: { game: GameSummary; pos: Position }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const finished = finishedOn(game);
  return (
    <Popover.Root
      open={hover || pinned}
      onOpenChange={(open) => {
        if (open) return;
        setPinned(false);
        setHover(false);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Komi, captures and dates"
          className="flex touch-manipulation items-center gap-1 rounded-sm border border-[#777777] px-2 py-0.5 hover:bg-[#222222]"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") setHover(true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setHover(false);
          }}
          onClick={(e) => {
            e.preventDefault();
            if (pinned) setHover(false);
            setPinned(!pinned);
          }}
        >
          <Info size={15} />
          info
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="fs-caption z-50 grid grid-cols-[auto_auto] items-baseline gap-x-4 gap-y-1.5 rounded-sm border border-[#777777] bg-[#161616] px-3 py-2 text-white"
        >
          <span>komi</span>
          <span className="fs-ui font-bold tabular-nums">{game.komi ?? "none"}</span>
          <span>captures</span>
          <span className="fs-ui flex items-center gap-1.5 font-bold tabular-nums">
            <MiniStone colour="W" />
            {pos.capturedByWhite}
            <MiniStone colour="B" />
            {pos.capturedByBlack}
          </span>
          <span>{finished ? "started" : "played"}</span>
          <span className="fs-ui font-bold tabular-nums">{playedOn(game)}</span>
          {finished && (
            <>
              <span>finished</span>
              <span className="fs-ui whitespace-nowrap font-bold tabular-nums">
                {finished.date}{" "}
                <span className="fs-caption font-normal">
                  ({finished.days} {finished.days === 1 ? "day" : "days"})
                </span>
              </span>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
