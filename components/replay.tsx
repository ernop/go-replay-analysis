"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import GoBoard from "@sabaki/go-board";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Goban, type BoardMark } from "@/components/goban";
import { ReviewCharts } from "@/components/review-charts";
import { TagEditor } from "@/components/tag-editor";
import {
  costColour,
  deltaLabel,
  gtpToVertex,
  positionCandidates,
  selectCandidates,
  visitsLabel,
} from "@/lib/review";
import { useStoredString } from "@/lib/use-stored";
import type { GameAnalysis, GameDetail } from "@/lib/types";

interface Position {
  signMap: number[][];
  lastMove: [number, number] | null;
  capturedByBlack: number;
  capturedByWhite: number;
}

/** Seconds per move while playing. */
const SPEEDS = [1, 2, 3, 5, 8, 10, 15, 20, 30];
const DEFAULT_SPEED = 10;

function countStones(signMap: number[][], sign: number): number {
  let n = 0;
  for (const row of signMap) for (const v of row) if (v === sign) n++;
  return n;
}

export function Replay({ id }: { id: number }) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [error, setError] = useState("");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedSetting, setSpeedSetting] = useStoredString("replay.speed", String(DEFAULT_SPEED));
  const [candidatesSetting, setCandidatesSetting] = useStoredString("replay.candidates", "on");
  const [revealResult, setRevealResult] = useState(false);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState("none");
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const speed = SPEEDS.includes(Number(speedSetting)) ? Number(speedSetting) : DEFAULT_SPEED;
  const showCandidates = candidatesSetting !== "off";

  useEffect(() => {
    fetch(`/api/games/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`game ${id} not found`);
        return r.json();
      })
      .then((d: GameDetail) => {
        setDetail(d);
        setAnalysis(d.analysis);
        setAnalysisState(d.game.analysisState);
        setAnalysisProgress(d.game.analysisProgress);
        const n = d.moves.length;
        if (d.game.lastViewedMove > 0 && d.game.lastViewedMove < n) {
          setIdx(d.game.lastViewedMove);
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
      setIdx(clamped);
      if (clamped >= moveCount) setPlaying(false);
    },
    [moveCount]
  );

  const step = useCallback(
    (delta: number) => setIdx((i) => Math.max(0, Math.min(moveCount, i + delta))),
    [moveCount]
  );

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
      fetch(`/api/games/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastViewedMove: idx,
          watchedToEnd: idx === moveCount && moveCount > 0,
        }),
      }).catch(() => {});
    }, 1200);
    return () => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
    };
  }, [idx, id, detail, moveCount]);

  // poll analysis while it's being computed
  useEffect(() => {
    if (analysisState !== "queued" && analysisState !== "running") return;
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
    (status: string) => {
      if (!detail) return;
      setDetail({ ...detail, game: { ...detail.game, status: status as never } });
      fetch(`/api/games/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => {});
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

  const infos = positionCandidates(current);
  const bestLead = infos[0]?.scoreLead ?? 0;
  const { shown, scale } = selectCandidates(infos, sideToMove, current?.visits ?? 0);
  const marks: BoardMark[] = [];
  if (showCandidates) {
    for (const s of shown) {
      const vertex = gtpToVertex(s.candidate.move, size);
      if (!vertex) continue;
      marks.push({
        vertex,
        fill: costColour(s.cost, scale),
        lines: [deltaLabel(bestLead, s.candidate.scoreLead, sideToMove), visitsLabel(s.candidate.visits)],
      });
    }
  }

  const scoreLead = Array.from(
    { length: moveCount + 1 },
    (_, i) => analysis?.positions[String(i)]?.scoreLead ?? null
  );
  const hasAnalysis = analysisState === "done" || (analysis !== null && analysisProgress > 0);
  const isPlaying = playing && idx < moveCount;
  const analysisTotal = moveCount + 1;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh_-_5.5rem)] lg:flex-row lg:items-start lg:gap-4">
      {/* The board takes the height; the panel keeps at least about 430px. */}
      <div className="relative aspect-square w-full lg:w-[min(calc(100vh_-_5.5rem),calc(100vw_-_31rem))] lg:flex-none">
        <Goban size={size} signMap={pos.signMap} lastMove={pos.lastMove} marks={marks}>
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
          <div className="flex items-baseline gap-2">
            <span className="fs-caption text-gold">move</span>
            <span className="fs-emph font-bold tabular-nums">{idx}</span>
            <span className="tabular-nums">/ {moveCount}</span>
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
          <button
            type="button"
            className="ctl"
            title="Show or hide the engine's candidate moves"
            onClick={() => setCandidatesSetting(showCandidates ? "off" : "on")}
          >
            candidates {showCandidates ? "on" : "off"}
          </button>
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
            <p className="fs-body">
              {analysisState === "queued" ? "Queued for analysis" : "Analyzing"}: {analysisProgress}/{analysisTotal}{" "}
              positions. The worker runs on the GPU machine: <code className="text-gold">npm run analyze</code>
            </p>
          ) : analysisState === "error" ? (
            <p className="fs-body flex items-center gap-3">
              <span className="font-bold text-[#ff5555]">Analysis failed</span>
              <button type="button" className="ctl border border-[#555555]" onClick={queueAnalysis}>
                retry
              </button>
            </p>
          ) : (
            <p className="fs-body flex items-center gap-3">
              No analysis yet.
              <button type="button" className="ctl border border-[#555555]" onClick={queueAnalysis}>
                queue analysis
              </button>
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
          <TagEditor tags={g.tags} onChange={setTags} />
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
