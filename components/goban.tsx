"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface BoardMark {
  vertex: [number, number];
  fill: string;
  /** Text lines inside the circle, e.g. Delta and Visits. */
  lines: string[];
}

/** A move already on the board, rated like a candidate: a disc over its stone, which shows as a rim. */
export interface PlayedMark {
  vertex: [number, number];
  fill: string;
  label: string;
}

interface GobanProps {
  size: number;
  signMap: number[][];
  lastMove: [number, number] | null;
  /** Candidate circles and the played-move disc sit on their own layer above the stones. */
  marks: BoardMark[];
  played?: PlayedMark | null;
  /** A new key starts a fresh marks layer, restarting any animation in `marksClassName`. */
  marksKey?: string | number;
  marksClassName?: string;
  onBoardClick?: () => void;
  /** Drawn over the board, positioned against its edges. */
  children?: ReactNode;
}

// Matches ogatak-clear's board (board_drawer.js, gridlines.js and the owner's
// config): wood #d0ad75, 1px black grid, 3px star points, no coordinates,
// candidate circles the size of a stone with black Arial text, and a red dot
// on the last move.
const WOOD = "#d0ad75";
const GRID = "#000000";
const LAST_MOVE = "#ff6666";
const LABEL_FONT = "Arial, Helvetica, sans-serif";
/** Radius of the played-move disc in squares; its stone (0.48) shows around it as a rim, like Ogatak's next-move ring. */
const PLAYED_DISC = 0.38;

function hoshiPoints(size: number): [number, number][] {
  if (size === 19) {
    const p = [3, 9, 15];
    return p.flatMap((x) => p.map((y) => [x, y] as [number, number]));
  }
  if (size === 13) {
    return [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]];
  }
  if (size === 9) {
    return [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]];
  }
  return [];
}

/** ogatak board_font_chooser: the largest font whose `sample` fits in 59% of a square. */
function fitFontPx(ctx: CanvasRenderingContext2D, square: number, sample: string): number {
  ctx.font = `100px ${LABEL_FONT}`;
  const per100 = ctx.measureText(sample).width;
  return Math.max(6, Math.floor((0.59 * square * 100) / per100));
}

/** Sizes a canvas to the board and returns its context and square size; whole-pixel squares keep 1px lines sharp. */
function prepare(container: HTMLElement, canvas: HTMLCanvasElement, size: number) {
  const rect = container.getBoundingClientRect();
  const square = Math.max(8, Math.floor(Math.min(rect.width, rect.height) / size));
  const px = square * size;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(px * dpr);
  canvas.height = Math.round(px * dpr);
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, square, px, centre: (v: number) => v * square + square / 2 };
}

export function Goban({
  size,
  signMap,
  lastMove,
  marks,
  played,
  marksKey,
  marksClassName,
  onBoardClick,
  children,
}: GobanProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const draw = () => {
      const board = prepare(container, canvas, size);
      if (!board) return;
      const { ctx, square, px, centre } = board;
      const line = (v: number) => centre(v) + (square % 2 === 0 ? 0.5 : 0);

      ctx.fillStyle = WOOD;
      ctx.fillRect(0, 0, px, px);

      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < size; i++) {
        ctx.moveTo(line(0), line(i));
        ctx.lineTo(line(size - 1), line(i));
        ctx.moveTo(line(i), line(0));
        ctx.lineTo(line(i), line(size - 1));
      }
      ctx.stroke();

      ctx.fillStyle = GRID;
      for (const [hx, hy] of hoshiPoints(size)) {
        ctx.beginPath();
        ctx.arc(line(hx), line(hy), 3, 0, Math.PI * 2);
        ctx.fill();
      }

      const r = square * 0.48;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sign = signMap[y]?.[x] ?? 0;
          if (sign === 0) continue;
          const cx = centre(x);
          const cy = centre(y);
          const shade = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
          if (sign === 1) {
            shade.addColorStop(0, "#5a5a5a");
            shade.addColorStop(1, "#0a0a0a");
          } else {
            shade.addColorStop(0, "#ffffff");
            shade.addColorStop(1, "#d2d2d2");
          }
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = shade;
          ctx.fill();
        }
      }

      if (lastMove) {
        ctx.beginPath();
        ctx.arc(centre(lastMove[0]), centre(lastMove[1]), square * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = LAST_MOVE;
        ctx.fill();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [size, signMap, lastMove]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = marksRef.current;
    if (!container || !canvas) return;

    const draw = () => {
      const board = prepare(container, canvas, size);
      if (!board) return;
      const { ctx, square, centre } = board;

      const twoLines = marks.some((m) => m.lines.length >= 2);
      const fontPx = fitFontPx(ctx, square, twoLines ? "999" : "111");
      ctx.font = `${fontPx}px ${LABEL_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const m of marks) {
        const [mx, my] = m.vertex;
        if ((signMap[my]?.[mx] ?? 0) !== 0) continue;
        const left = mx * square;
        const top = my * square;
        ctx.beginPath();
        ctx.arc(centre(mx), centre(my), square / 2, 0, Math.PI * 2);
        ctx.fillStyle = m.fill;
        ctx.fill();
        ctx.fillStyle = "#000000";
        if (m.lines.length >= 2) {
          ctx.fillText(m.lines[0], left + square / 2, top + square / 3 + 0.5);
          ctx.fillText(m.lines[1], left + square / 2, top + (square * 2) / 3 + 1.5);
        } else if (m.lines.length === 1) {
          ctx.fillText(m.lines[0], left + square / 2, top + square / 2 + 2);
        }
      }

      if (played && (signMap[played.vertex[1]]?.[played.vertex[0]] ?? 0) !== 0) {
        const cx = centre(played.vertex[0]);
        const cy = centre(played.vertex[1]);
        ctx.beginPath();
        ctx.arc(cx, cy, square * PLAYED_DISC, 0, Math.PI * 2);
        ctx.fillStyle = played.fill;
        ctx.fill();
        // Same size as the candidates' text unless the label would spill onto the rim.
        const width = ctx.measureText(played.label).width;
        const room = 2 * square * PLAYED_DISC * 0.92;
        if (width > room) ctx.font = `${Math.max(6, Math.floor((fontPx * room) / width))}px ${LABEL_FONT}`;
        ctx.fillStyle = "#000000";
        ctx.fillText(played.label, cx, cy + 1);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [size, signMap, marks, played, marksKey]);

  // Fills a positioned parent, which must have its own size.
  return (
    <div ref={containerRef} className="absolute inset-0 flex items-start justify-center">
      <div className={`relative ${onBoardClick ? "cursor-pointer" : ""}`} onClick={onBoardClick}>
        <canvas ref={canvasRef} className="block" />
        <canvas
          key={marksKey}
          ref={marksRef}
          className={`pointer-events-none absolute left-0 top-0 ${marksClassName ?? ""}`}
        />
        {children}
      </div>
    </div>
  );
}
