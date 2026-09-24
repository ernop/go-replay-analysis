"use client";

import { useCallback, useRef } from "react";

interface WinrateGraphProps {
  /** black winrate (0..1) indexed by turn, null where not yet analyzed */
  winrates: (number | null)[];
  /** black score lead indexed by turn, null where not yet analyzed */
  scores: (number | null)[];
  current: number;
  moveCount: number;
  onSeek: (turn: number) => void;
}

const W = 1000;
const H = 240;
const SCORE_RANGE = 20; // +/- points mapped onto graph height

function buildPath(
  values: (number | null)[],
  moveCount: number,
  map: (v: number) => number
): string {
  let d = "";
  let pen = false;
  for (let i = 0; i <= moveCount; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    const x = (i / Math.max(1, moveCount)) * W;
    const y = map(v);
    d += pen ? ` L ${x.toFixed(1)} ${y.toFixed(1)}` : ` M ${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

export function WinrateGraph({
  winrates,
  scores,
  current,
  moveCount,
  onSeek,
}: WinrateGraphProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const seekFromEvent = useCallback(
    (e: React.PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      onSeek(Math.round(frac * moveCount));
    },
    [moveCount, onSeek]
  );

  const winratePath = buildPath(winrates, moveCount, (v) => (1 - v) * H);
  const scorePath = buildPath(scores, moveCount, (v) => {
    const clamped = Math.max(-SCORE_RANGE, Math.min(SCORE_RANGE, v));
    return (1 - (clamped / SCORE_RANGE + 1) / 2) * H;
  });
  const cursorX = (current / Math.max(1, moveCount)) * W;

  const tickStep = moveCount > 250 ? 100 : 50;
  const ticks: number[] = [];
  for (let t = tickStep; t < moveCount; t += tickStep) ticks.push(t);

  return (
    <div className="w-full select-none">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold">Winrate graph</span>
        <span className="text-sm font-semibold">
          <span style={{ color: "#ffffff" }}>— B winrate</span>{" "}
          <span style={{ color: "#99dd55" }}>— B score lead</span>
        </span>
      </div>
      <div
        ref={ref}
        className="relative w-full cursor-crosshair touch-none"
        style={{ height: 110, background: "#101010", borderRadius: 4 }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && seekFromEvent(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#555555" strokeWidth={2} strokeDasharray="8 8" />
          {ticks.map((t) => {
            const x = (t / moveCount) * W;
            return <line key={t} x1={x} y1={0} x2={x} y2={H} stroke="#333333" strokeWidth={1.5} />;
          })}
          {scorePath && (
            <path d={scorePath} fill="none" stroke="#99dd55" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          )}
          {winratePath && (
            <path d={winratePath} fill="none" stroke="#ffffff" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          )}
          <line x1={cursorX} y1={0} x2={cursorX} y2={H} stroke="#e0b872" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute left-1 top-0 text-xs font-bold" style={{ color: "#ffffff" }}>
          B 100%
        </span>
        <span className="absolute left-1 bottom-0 text-xs font-bold" style={{ color: "#ffffff" }}>
          B 0%
        </span>
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute bottom-0 text-xs font-bold font-mono"
            style={{ left: `${(t / moveCount) * 100}%`, transform: "translateX(-50%)", color: "#ffffff" }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
