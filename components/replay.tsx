"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import GoBoard from "@sabaki/go-board";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Goban, type BoardMark, type PlayedMark } from "@/components/goban";
import { ReviewCharts } from "@/components/review-charts";
import { TagEditor } from "@/components/tag-editor";
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
  type MoveRating,
} from "@/lib/review";
import { saveProgress, withViewerProgress } from "@/lib/progress";
import { SITE_MODE } from "@/lib/site-mode";
import { useStoredString } from "@/lib/use-stored";
import type { GameAnalysis, GameDetail, GameStatus } from "@/lib/types";

interface Position {
  signMap: number[][];
  lastMove: [number, number] | null;
  capturedByBlack: number;
  capturedByWhite: number;
}

/** Seconds per move while playing. */
const SPEEDS = [1, 2, 3, 5, 8, 10, 15, 20, 30];
const DEFAULT_SPEED = 10;

/**
 * What the board shows. "analysis": the side to move's candidates. "guess":
 * nothing before a move; after it lands, its rating and the mover's other
 * options, for a while. "off": stones only.
 */
type BoardMode = "analysis" | "guess" | "off";
const MODES: BoardMode[] = ["analysis", "guess", "off"];

/** Seconds a move's rating stays in guess mode; "hold" keeps it until the next move. */
const REVEALS = [1, 2, 3, 5, 8];
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

function countStones(signMap: number[][], sign: number): number {
  let n = 0;
  for (const row of signMap) for (const v of row) if (v === sign) n++;
  return n;
}

function candidateMarks(
  shown: BoardCandidate[],
  bestLead: number,
  side: "B" | "W",
  scale: number,
  size: number
): BoardMark[] {
  const marks: BoardMark[] = [];
  for (const s of shown) {
    const vertex = gtpToVertex(s.candidate.move, size);
    if (!vertex) continue;
    marks.push({
      vertex,
      fill: costColour(s.cost, scale),
      lines: [deltaLabel(bestLead, s.candidate.scoreLead, side), visitsLabel(s.candidate.visits)],
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
  const [revealResult, setRevealResult] = useState(false);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState("none");
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const speed = SPEEDS.includes(Number(speedSetting)) ? Number(speedSetting) : DEFAULT_SPEED;
  const mode: BoardMode = MODES.includes(modeSetting as BoardMode) ? (modeSetting as BoardMode) : "analysis";
  const revealChoice =
    revealSetting === "hold" || REVEALS.includes(Number(revealSetting)) ? revealSetting : DEFAULT_REVEAL;
  const revealMs = revealChoice === "hold" ? null : Number(revealChoice) * 1000;

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

  const moveCount = detail?.moves.length ?? 0;
  const size = detail?.game.boardSize ?? 19;

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
      // A move that lands (stepping, playing, or jumping forward) gets its
      // rating shown in guess mode; going back leaves a clean board to guess on.
      setReveal((r) => (clamped > idx ? { idx: clamped, serial: (r?.serial ?? 0) + 1, on: true, landed: true } : null));
      if (clamped >= moveCount) setPlaying(false);
    },
    [idx, moveCount]
  );

  const step = useCallback((delta: number) => goTo(idx + delta), [goTo, idx]);

  const togglePlay = useCallback(() => {
    if (idx >= moveCount) return;
    setPlaying((p) => !p);
  }, [idx, moveCount]);

  // One timer per move, so the countdown bar and the move stay in step.
  useEffect(() => {
    if (!playing || idx >= moveCount) return;
    const timer = setTimeout(() => goTo(idx + 1), speed * 1000);
    return () => clearTimeout(timer);
  }, [playing, speed, idx, moveCount, goTo]);

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
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveCount, goTo, step, togglePlay]);

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

  // result is revealed manually, or automatically at the last move
  const resultRevealed = revealResult || (moveCount > 0 && idx >= moveCount);

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
        <Link href="/" className="text-gold underline">
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

  const lastPlayed = idx > 0 ? detail.moves[idx - 1] : null;
  let marks: BoardMark[] = [];
  let played: PlayedMark | null = null;
  let rating: MoveRating | null = null;
  if (mode === "analysis") {
    const infos = positionCandidates(current);
    const { shown, scale } = selectCandidates(infos, sideToMove, current?.visits ?? 0);
    marks = candidateMarks(shown, infos[0]?.scoreLead ?? 0, sideToMove, scale, size);
  } else if (mode === "guess" && lastPlayed && reveal?.idx === idx) {
    const before = analysis?.positions[String(idx - 1)];
    rating = rateMove(before, current, vertexToGtp(lastPlayed.vertex, size), lastPlayed.color);
    if (rating) {
      marks = candidateMarks(rating.alternatives, rating.bestLead, lastPlayed.color, rating.scale, size);
      if (lastPlayed.vertex) {
        played = {
          vertex: lastPlayed.vertex,
          fill: costColour(rating.playedCost, rating.scale),
          label: deltaLabel(rating.bestLead, rating.playedLead, lastPlayed.color),
        };
      }
    }
  }
  const revealClass = !reveal ? "" : reveal.on ? (reveal.landed ? "reveal-in" : "reveal-now") : "reveal-out";

  const scoreLead = Array.from(
    { length: moveCount + 1 },
    (_, i) => analysis?.positions[String(i)]?.scoreLead ?? null
  );
  const hasAnalysis = analysisState === "done" || (analysis !== null && analysisProgress > 0);
  const isPlaying = playing && idx < moveCount;
  const analysisTotal = moveCount + 1;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh_-_45px)] lg:flex-row lg:items-start lg:gap-4">
      {/* The board takes the height (45px: the top bar and the page's vertical padding); the panel keeps at least about 430px. */}
      <div className="relative aspect-square w-full lg:w-[min(calc(100vh_-_45px),calc(100vw_-_31rem))] lg:flex-none">
        <Goban
          size={size}
          signMap={pos.signMap}
          lastMove={pos.lastMove}
          marks={marks}
          played={played}
          marksKey={mode === "guess" ? `reveal-${reveal?.serial ?? 0}` : mode}
          marksClassName={mode === "guess" ? revealClass : undefined}
          onBoardClick={mode === "guess" ? toggleReveal : undefined}
        >
          {isPlaying && (
            <div
              key={`${idx}-${speed}`}
              className="autoplay-progress absolute left-0 top-full mt-[3px] h-1 bg-gold"
              style={{ animationDuration: `${speed}s` }}
            />
          )}
        </Goban>
      </div>

      {/* Phones show these in order-* order; desktop keeps DOM order. */}
      <div className="@container flex min-w-0 flex-1 flex-col gap-3 bg-[#111111] px-3 py-2 lg:h-full lg:overflow-y-auto lg:px-4">
        <div className="order-4 grid grid-cols-2 gap-3 border-b border-[#333333] pb-3 lg:order-none @min-[560px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <PlayerBox colour="B" name={g.black} rank={g.blackRank} caps={pos.capturedByBlack} toPlay={sideToMove === "B"} />
          <div className="fs-ui order-last col-span-2 flex flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center @min-[560px]:order-none @min-[560px]:col-span-1 @min-[560px]:flex-col">
            <span>{g.datePlayed.slice(0, 10)}</span>
            <span>
              {g.handicap > 0 ? `HA ${g.handicap} · ` : ""}
              {g.komi !== null ? `komi ${g.komi}` : ""}
            </span>
            {resultRevealed ? (
              <span className="fs-emph font-bold">{g.result || "?"}</span>
            ) : (
              <button type="button" className="ctl fs-emph font-bold" onClick={() => setRevealResult(true)} title="Reveal result">
                •••
              </button>
            )}
          </div>
          <PlayerBox colour="W" name={g.white} rank={g.whiteRank} caps={pos.capturedByWhite} toPlay={sideToMove === "W"} />
        </div>

        <div className="order-1 fs-ui flex flex-wrap items-center gap-x-5 gap-y-2 tracking-[1px] lg:order-none">
          <div className="flex items-center">
            <IconButton title="First move (Home)" onClick={() => goTo(0)}>
              <ChevronFirst />
            </IconButton>
            <IconButton title="Previous move (←)" onClick={() => step(-1)}>
              <ChevronLeft />
            </IconButton>
            <button
              type="button"
              onClick={togglePlay}
              title="Play / pause (space)"
              className={`ctl flex h-10 items-center gap-2 border ${isPlaying ? "border-gold text-gold" : "border-[#555555]"}`}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              {isPlaying ? "pause" : "play"}
            </button>
            <IconButton title="Next move (→)" onClick={() => step(1)}>
              <ChevronRight />
            </IconButton>
            <IconButton title="Last move (End)" onClick={() => goTo(moveCount)}>
              <ChevronLast />
            </IconButton>
          </div>
          <div className="flex items-baseline gap-x-5">
            <div className="flex items-baseline gap-2">
              <span className="fs-caption text-gold">move</span>
              <span className="fs-emph font-bold tabular-nums">{idx}</span>
              <span className="tabular-nums">/ {moveCount}</span>
            </div>
            {mode === "guess" && (
              // Kept even when empty, so nothing shifts when a rating appears.
              <div className="flex min-w-[8.5rem] items-baseline">
                {rating && (
                  <span key={reveal?.serial} className={`flex items-baseline gap-2 whitespace-nowrap ${revealClass}`}>
                    <span className="fs-caption text-gold">{lastPlayed?.vertex ? "lost" : "pass, lost"}</span>
                    <span
                      className="fs-emph rounded-sm px-1.5 font-bold tabular-nums text-black"
                      style={{ background: costColour(rating.playedCost, rating.scale) }}
                    >
                      {rating.playedCost.toFixed(2)}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2" title="Time between moves while playing">
            <span className="font-bold text-gold">every</span>
            <select value={speed} onChange={(e) => setSpeedSetting(e.target.value)} className="field">
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s} s
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex items-center gap-2"
            title="analysis: the engine's candidates before each move. guess: nothing until the move is played, then its rating and the other options for a while. off: stones only."
          >
            <span className="font-bold text-gold">mode</span>
            <select value={mode} onChange={(e) => changeMode(e.target.value)} className="field">
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
              title="How long a move's rating stays after it is played; hold keeps it until the next move. Tap the board to show it again or hide it."
            >
              <span className="font-bold text-gold">reveal</span>
              <select value={revealChoice} onChange={(e) => setRevealSetting(e.target.value)} className="field">
                {REVEALS.map((s) => (
                  <option key={s} value={s}>
                    {s} s
                  </option>
                ))}
                <option value="hold">hold</option>
              </select>
            </label>
          )}
        </div>

        <div className="order-2 flex flex-col gap-3 lg:order-none">
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
                positions. The worker runs on the GPU machine: <code className="text-gold">npm run analyze</code>
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

        <div className="order-5 fs-ui flex flex-col gap-2 border-t border-[#333333] pt-3 lg:order-none">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-bold">status</span>
            <span className="text-gold">{g.status}</span>
            <button type="button" className="ctl" onClick={() => setStatus("played")}>
              mark played
            </button>
            <button type="button" className="ctl" onClick={() => setStatus("done")}>
              move to done
            </button>
          </div>
          {SITE_MODE === "lan" ? (
            <TagEditor tags={g.tags} onChange={setTags} />
          ) : (
            g.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-bold">tags</span>
                <span className="text-gold">{g.tags.join(", ")}</span>
              </div>
            )
          )}
          <div className="fs-caption flex flex-wrap items-center justify-between gap-2">
            <Link href="/" className="text-gold underline">
              ← library
            </Link>
            {analysis && (
              <span>
                {analysis.engine} · {analysis.maxVisits} visits · {analysisProgress}/{analysisTotal} positions
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="ctl flex h-10 w-10 items-center justify-center p-0">
      {children}
    </button>
  );
}

function PlayerBox({
  colour,
  name,
  rank,
  caps,
  toPlay,
}: {
  colour: "B" | "W";
  name: string;
  rank: string;
  caps: number;
  toPlay: boolean;
}) {
  const white = colour === "W";
  return (
    <div
      className={`flex min-w-0 items-center gap-3 border px-3 py-2 ${white ? "flex-row-reverse text-right" : ""} ${
        toPlay ? "border-gold bg-[#262216]" : "border-[#333333] bg-[#181818]"
      }`}
    >
      <span
        className="inline-block size-8 flex-none rounded-full"
        style={{
          background: white
            ? "radial-gradient(circle at 35% 30%, #ffffff, #d2d2d2 75%)"
            : "radial-gradient(circle at 35% 30%, #5a5a5a, #0a0a0a 70%)",
        }}
      />
      <div className="min-w-0">
        <div className={`fs-caption flex flex-wrap gap-x-3 font-bold tracking-[0.14em] ${white ? "justify-end" : ""}`}>
          <span>{white ? "WHITE" : "BLACK"}</span>
          {toPlay && <span className="whitespace-nowrap text-gold">TO PLAY</span>}
        </div>
        <div className="fs-body font-bold [overflow-wrap:anywhere] @min-[560px]:fs-emph">
          {name}
          {rank && <span className="fs-caption ml-2 font-normal">{rank}</span>}
        </div>
        <div className="fs-caption">caps {caps}</div>
      </div>
    </div>
  );
}
