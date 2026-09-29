"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import GoBoard from "@sabaki/go-board";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Goban, type BoardMark, type PlayedMark } from "@/components/goban";
import { ReviewCharts } from "@/components/review-charts";
import { TagEditor } from "@/components/tag-editor";
import { handleOf, playedOn } from "@/lib/library";
import { saveProgress, withViewerProgress } from "@/lib/progress";
import {
  costColour,
  deltaLabel,
  gtpToVertex,
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

/** Analysis mode labels circles "Delta + Visits" (the owner's Ogatak setting); guess mode only the Delta. */
function candidateMarks(
  shown: BoardCandidate[],
  bestLead: number,
  side: "B" | "W",
  scale: number,
  size: number,
  withVisits: boolean
): BoardMark[] {
  const marks: BoardMark[] = [];
  for (const s of shown) {
    const vertex = gtpToVertex(s.candidate.move, size);
    if (!vertex) continue;
    marks.push({
      vertex,
      fill: costColour(s.cost, scale),
      lines: withVisits
        ? [deltaLabel(bestLead, s.candidate.scoreLead, side), visitsLabel(s.candidate.visits)]
        : [deltaLabel(bestLead, s.candidate.scoreLead, side, 1)],
    });
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
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState("none");
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const moveCount = detail?.moves.length ?? 0;
  const size = detail?.game.boardSize ?? 19;
  const mode: BoardMode = MODES.includes(modeSetting as BoardMode) ? (modeSetting as BoardMode) : "analysis";
  const revealChoice = parseReveal(revealSetting);
  const revealMs = REVEALS.includes(Number(revealChoice)) ? Number(revealChoice) * 1000 : null;

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
  const holding = revealChoice === "accept" && !!shownReveal?.on;

  // One timer per move, so the countdown bar and the move stay in step. A
  // held analysis stops the clock; hiding it starts a full interval.
  useEffect(() => {
    if (!playing || idx >= moveCount || holding) return;
    const timer = setTimeout(() => goTo(idx + 1), delay * 1000);
    return () => clearTimeout(timer);
  }, [playing, delay, idx, moveCount, goTo, holding]);

  useEffect(() => {
    if (!reveal?.on || revealMs === null) return;
    const serial = reveal.serial;
    const timer = setTimeout(
      () => setReveal((r) => (r && r.serial === serial ? { ...r, on: false } : r)),
      revealMs + (reveal.landed ? REVEAL_FADE_IN_MS : 0)
    );
    return () => clearTimeout(timer);
  }, [reveal, revealMs]);

  const toggleReveal = useCallback(() => {
    if (idx === 0) return;
    setReveal((r) =>
      r && r.idx === idx && r.on
        ? { ...r, on: false }
        : { idx, serial: (r?.serial ?? 0) + 1, on: true, landed: false }
    );
  }, [idx]);

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

  let marks: BoardMark[] = [];
  let played: PlayedMark | null = null;
  if (mode === "analysis") {
    const infos = positionCandidates(current);
    const { shown, scale } = selectCandidates(infos, sideToMove, current?.visits ?? 0);
    marks = candidateMarks(shown, infos[0]?.scoreLead ?? 0, sideToMove, scale, size, true);
  } else if (rating && shownReveal && lastPlayed) {
    marks = candidateMarks(rating.alternatives, rating.bestLead, lastPlayed.color, rating.scale, size, false);
    if (lastPlayed.vertex) {
      played = {
        vertex: lastPlayed.vertex,
        fill: costColour(rating.playedCost, rating.scale),
        label: deltaLabel(rating.bestLead, rating.playedLead, lastPlayed.color, 1),
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
    <div className="flex flex-col gap-2 lg:h-[calc(100vh_-_45px)] lg:flex-row lg:items-start lg:gap-4">
      {/* Phones show the players above the board; desktop at the top of the panel. */}
      <div className="lg:hidden">{players}</div>

      {/* The board takes the height (45px: the top bar and the page's vertical padding); the panel keeps at least about 430px. */}
      <div className="relative aspect-square w-full lg:w-[min(calc(100vh_-_45px),calc(100vw_-_31rem))] lg:flex-none">
        <Goban
          size={size}
          signMap={pos.signMap}
          lastMove={pos.lastMove}
          marks={marks}
          played={played}
          smallMarks={mode === "guess"}
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
                        className="fs-emph rounded-sm px-1.5 font-bold tabular-nums text-black"
                        style={{ background: costColour(rating.playedCost, rating.scale) }}
                      >
                        {rating.playedCost.toFixed(2)}
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
              <label
                className="flex items-center gap-2"
                title="How long a move's analysis shows once it is on the board, whether you stepped forward or back. 'hold till accepted' keeps it, and holds autoplay, until you tap the board. Tap the board (or press Enter) any time to show or hide it."
              >
                show analysis
                <select value={revealChoice} onChange={(e) => setRevealSetting(e.target.value)} className="field fs-ui">
                  {REVEALS.map((s) => (
                    <option key={s} value={String(s)}>
                      {s} s
                    </option>
                  ))}
                  <option value="next">until next move</option>
                  <option value="accept">hold till accepted</option>
                </select>
              </label>
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
      </div>
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

/** Handicap, komi, date and captures: small, beside the players on a wide panel. */
function GameFacts({ game, pos }: { game: GameSummary; pos: Position }) {
  return (
    <div className="fs-caption flex flex-wrap items-center gap-x-4 gap-y-0.5 @min-[720px]:flex-col @min-[720px]:items-end">
      {game.handicap > 0 && <span>H{game.handicap}</span>}
      {game.komi !== null && <span>komi {game.komi}</span>}
      <span>{playedOn(game)}</span>
      <span className="flex items-center gap-1.5 whitespace-nowrap" title="Stones each side has captured">
        captures <MiniStone colour="W" />
        <span className="tabular-nums">{pos.capturedByWhite}</span>
        <MiniStone colour="B" />
        <span className="tabular-nums">{pos.capturedByBlack}</span>
      </span>
    </div>
  );
}
