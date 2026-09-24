"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import GoBoard from "@sabaki/go-board";
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Goban, type Suggestion } from "@/components/goban";
import { WinrateGraph } from "@/components/winrate-graph";
import { SpeedSlider } from "@/components/speed-slider";
import { TagEditor } from "@/components/tag-editor";
import type { GameAnalysis, GameDetail } from "@/lib/types";

interface Position {
  signMap: number[][];
  lastMove: [number, number] | null;
  capturedByBlack: number;
  capturedByWhite: number;
}

const GTP_COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

function gtpToVertex(gtp: string, size: number): [number, number] | null {
  const s = gtp.trim().toUpperCase();
  if (s === "PASS" || s === "") return null;
  const col = GTP_COLS.indexOf(s[0]);
  const row = parseInt(s.slice(1), 10);
  if (col < 0 || !Number.isFinite(row)) return null;
  return [col, size - row];
}

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
  const [speed, setSpeed] = useState(1.5);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [revealResult, setRevealResult] = useState(false);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState("none");
  const [analysisProgress, setAnalysisProgress] = useState(0);

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

  // autoplay
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIdx((i) => {
        if (i >= moveCount) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, speed * 1000);
    return () => clearInterval(t);
  }, [playing, speed, moveCount]);

  // keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") setIdx((i) => Math.min(moveCount, i + 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowUp") setIdx((i) => Math.min(moveCount, i + 10));
      else if (e.key === "ArrowDown") setIdx((i) => Math.max(0, i - 10));
      else if (e.key === "Home") setIdx(0);
      else if (e.key === "End") setIdx(moveCount);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
      if (e.key !== " ") e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveCount]);

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
    }, 8000);
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
        <p className="text-xl font-bold">{error}</p>
        <Link href="/" className="text-gold font-semibold underline">
          Back to library
        </Link>
      </div>
    );
  }
  if (!detail) {
    return <p className="p-8 text-center text-lg font-semibold">Loading game…</p>;
  }

  const g = detail.game;
  const pos = positions[Math.min(idx, positions.length - 1)];
  const current = analysis?.positions[String(idx)];
  const prev = analysis?.positions[String(idx - 1)];

  // side to move at this position
  const sideToMove: "B" | "W" =
    idx < moveCount
      ? detail.moves[idx].color
      : detail.moves[moveCount - 1]?.color === "B"
        ? "W"
        : "B";

  const suggestions: Suggestion[] = (current?.top ?? [])
    .map((c, i) => {
      const v = gtpToVertex(c.move, size);
      if (!v) return null;
      return {
        vertex: v,
        winrate: sideToMove === "B" ? c.winrate : 1 - c.winrate,
        visits: c.visits,
        order: i,
      };
    })
    .filter((s): s is Suggestion => s !== null);

  const nextMove = idx < moveCount ? detail.moves[idx].vertex : null;

  // quality of the move that produced this position (mover's perspective)
  let moveDelta: number | null = null;
  if (idx > 0 && current && prev) {
    const mover = detail.moves[idx - 1].color;
    moveDelta = (current.winrate - prev.winrate) * (mover === "B" ? 1 : -1) * 100;
  }

  const winrates: (number | null)[] = [];
  const scores: (number | null)[] = [];
  for (let i = 0; i <= moveCount; i++) {
    const p = analysis?.positions[String(i)];
    winrates.push(p ? p.winrate : null);
    scores.push(p ? p.scoreLead : null);
  }

  const blackWr = current ? current.winrate * 100 : null;
  const analysisTotal = moveCount + 1;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,26%)] h-[calc(100vh-7.5rem)] min-h-[480px]">
      <div className="min-h-[320px] lg:h-full">
        <Goban
          size={size}
          signMap={pos.signMap}
          lastMove={pos.lastMove}
          nextMove={nextMove}
          suggestions={suggestions}
          showSuggestions={showSuggestions && !!current}
        />
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto pr-1">
        {/* players + result */}
        <div className="rounded bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 rounded-full bg-black border border-white" />
                {g.black} {g.blackRank && <span className="text-sm font-semibold">{g.blackRank}</span>}
              </div>
              <div className="text-lg font-bold flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 rounded-full bg-white" />
                {g.white} {g.whiteRank && <span className="text-sm font-semibold">{g.whiteRank}</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-gold uppercase">Result</div>
              {resultRevealed ? (
                <div className="text-xl font-bold font-mono">{g.result || "?"}</div>
              ) : (
                <button
                  onClick={() => setRevealResult(true)}
                  className="text-xl font-bold font-mono hover:text-gold"
                  title="Click to reveal result"
                >
                  •••
                </button>
              )}
            </div>
          </div>
          <div className="mt-1 text-sm font-semibold">
            {[g.event, g.datePlayed, `${g.boardSize}×${g.boardSize}`,
              g.handicap > 0 ? `HA ${g.handicap}` : "even",
              g.komi !== null ? `komi ${g.komi}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>

        {/* move counter + captures */}
        <div className="rounded bg-card p-3 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-gold uppercase">Move</div>
            <div className="text-3xl font-bold font-mono leading-none">
              {idx}
              <span className="text-lg font-semibold"> / {moveCount}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold text-gold uppercase">Captures</div>
            <div className="text-lg font-bold font-mono leading-tight">
              B {pos.capturedByBlack} · W {pos.capturedByWhite}
            </div>
          </div>
        </div>

        {/* controls */}
        <div className="rounded bg-card p-3 flex flex-col gap-3">
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" size="icon" onClick={() => setIdx(0)} title="First move (Home)">
              <ChevronFirst />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              title="Previous move (←)"
            >
              <ChevronLeft />
            </Button>
            <Button
              size="lg"
              onClick={() => setPlaying((p) => !p)}
              className="px-6 font-bold"
              title="Play/pause (space)"
            >
              {playing ? <Pause /> : <Play />}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setIdx((i) => Math.min(moveCount, i + 1))}
              title="Next move (→)"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setIdx(moveCount)}
              title="Last move (End)"
            >
              <ChevronLast />
            </Button>
          </div>
          <SpeedSlider value={speed} onChange={setSpeed} />
        </div>

        {/* analysis */}
        <div className="rounded bg-card p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold">Analysis</span>
            <label className="flex items-center gap-2 text-sm font-semibold">
              Show suggestions
              <Switch checked={showSuggestions} onCheckedChange={setShowSuggestions} />
            </label>
          </div>

          {analysisState === "done" || (analysis && analysisProgress > 0) ? (
            <>
              {blackWr !== null ? (
                <div>
                  <div className="flex w-full h-7 rounded overflow-hidden font-mono font-bold text-sm">
                    <div
                      className="bg-black text-white flex items-center pl-2 border border-white/40"
                      style={{ width: `${blackWr}%`, minWidth: 46 }}
                    >
                      {blackWr.toFixed(1)}%
                    </div>
                    <div
                      className="bg-white text-black flex items-center justify-end pr-2 flex-1"
                      style={{ minWidth: 46 }}
                    >
                      {(100 - blackWr).toFixed(1)}%
                    </div>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-sm font-semibold">Score lead</span>
                    <span className="text-2xl font-bold font-mono">
                      {current!.scoreLead >= 0
                        ? `B+${current!.scoreLead.toFixed(1)}`
                        : `W+${(-current!.scoreLead).toFixed(1)}`}
                    </span>
                  </div>
                  {moveDelta !== null && (
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold">Last move winrate Δ</span>
                      <span
                        className="text-xl font-bold font-mono"
                        style={{
                          color:
                            moveDelta >= -2 ? "#99dd55" : moveDelta >= -6 ? "#dddd55" : "#ff7777",
                        }}
                      >
                        {moveDelta >= 0 ? "+" : ""}
                        {moveDelta.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm font-semibold">
                  This position isn&apos;t analyzed yet
                  {analysisState === "running" ? " — analysis is still running." : "."}
                </p>
              )}
              <WinrateGraph
                winrates={winrates}
                scores={scores}
                current={idx}
                moveCount={moveCount}
                onSeek={(t) => {
                  setPlaying(false);
                  setIdx(t);
                }}
              />
              <p className="text-xs font-semibold">
                {analysis?.engine} · {analysisProgress}/{analysisTotal} positions
                {analysis?.maxVisits ? ` · ${analysis.maxVisits} visits` : ""}
              </p>
            </>
          ) : analysisState === "queued" || analysisState === "running" ? (
            <p className="text-sm font-semibold">
              {analysisState === "queued" ? "Queued for analysis" : "Analyzing"} —{" "}
              {analysisProgress}/{analysisTotal} positions done. Start the worker on the GPU
              machine: <code className="text-gold">npm run analyze</code>
            </p>
          ) : analysisState === "error" ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold" style={{ color: "#ff7777" }}>
                Analysis failed
              </span>
              <Button size="sm" variant="secondary" onClick={queueAnalysis}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">No analysis yet for this game.</span>
              <Button size="sm" onClick={queueAnalysis}>
                Queue analysis
              </Button>
            </div>
          )}
        </div>

        {/* library actions */}
        <div className="rounded bg-card p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold flex-1">Status: {g.status}</span>
            <Button
              size="sm"
              variant={g.status === "played" ? "default" : "secondary"}
              onClick={() => setStatus("played")}
            >
              Mark played
            </Button>
            <Button
              size="sm"
              variant={g.status === "done" ? "default" : "secondary"}
              onClick={() => setStatus("done")}
            >
              Move to done
            </Button>
          </div>
          <TagEditor tags={g.tags} onChange={setTags} />
          <Link href="/" className="text-sm font-semibold text-gold underline">
            ← Back to library
          </Link>
        </div>
      </div>
    </div>
  );
}
