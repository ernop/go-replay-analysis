"use client";

import { useEffect, useRef } from "react";

export interface Suggestion {
  vertex: [number, number];
  /** displayed winrate, already from the side-to-move's perspective, 0..1 */
  winrate: number;
  visits: number;
  order: number;
}

interface GobanProps {
  size: number;
  signMap: number[][];
  lastMove: [number, number] | null;
  /** the move actually played next in the game (shown while suggestions are on) */
  nextMove: [number, number] | null;
  suggestions: Suggestion[];
  showSuggestions: boolean;
}

const WOOD = "#dcb35c";
const WOOD_EDGE = "#c9a04e";
const LINE = "#3d2f10";
const TOP_COLOUR = "#77dddd"; // ogatak: best move
const OFF_COLOUR = "#99dd55"; // ogatak: other candidates
const NEXT_COLOUR = "#ff7777";

const GTP_COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

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

function compactVisits(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "m";
  if (n >= 10_000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function Goban({
  size,
  signMap,
  lastMove,
  nextMove,
  suggestions,
  showSuggestions,
}: GobanProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const px = Math.max(200, Math.floor(Math.min(rect.width, rect.height)));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = px * dpr;
      canvas.height = px * dpr;
      canvas.style.width = `${px}px`;
      canvas.style.height = `${px}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cell = px / (size + 1);
      const origin = cell;
      const gridW = cell * (size - 1);
      const at = (v: number) => origin + v * cell;

      // wood
      const grad = ctx.createRadialGradient(px / 2, px / 2, px * 0.1, px / 2, px / 2, px * 0.75);
      grad.addColorStop(0, WOOD);
      grad.addColorStop(1, WOOD_EDGE);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, px, px);

      // grid
      ctx.strokeStyle = LINE;
      ctx.lineWidth = Math.max(1, cell * 0.03);
      ctx.beginPath();
      for (let i = 0; i < size; i++) {
        ctx.moveTo(at(0), at(i));
        ctx.lineTo(at(size - 1), at(i));
        ctx.moveTo(at(i), at(0));
        ctx.lineTo(at(i), at(size - 1));
      }
      ctx.stroke();

      // hoshi
      ctx.fillStyle = LINE;
      for (const [hx, hy] of hoshiPoints(size)) {
        ctx.beginPath();
        ctx.arc(at(hx), at(hy), Math.max(2, cell * 0.09), 0, Math.PI * 2);
        ctx.fill();
      }

      // coordinates (black text on light wood)
      ctx.fillStyle = "#000000";
      ctx.font = `600 ${Math.max(8, cell * 0.38)}px var(--font-geist-mono), monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < size; i++) {
        const letter = GTP_COLS[i];
        ctx.fillText(letter, at(i), origin - cell * 0.62);
        ctx.fillText(letter, at(i), origin + gridW + cell * 0.62);
        const num = String(size - i);
        ctx.fillText(num, origin - cell * 0.62, at(i));
        ctx.fillText(num, origin + gridW + cell * 0.62, at(i));
      }

      // stones
      const r = cell * 0.47;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sign = signMap[y]?.[x] ?? 0;
          if (sign === 0) continue;
          const cx = at(x);
          const cy = at(y);
          const sg = ctx.createRadialGradient(
            cx - r * 0.35,
            cy - r * 0.35,
            r * 0.1,
            cx,
            cy,
            r * 1.05
          );
          if (sign === 1) {
            sg.addColorStop(0, "#666666");
            sg.addColorStop(1, "#000000");
          } else {
            sg.addColorStop(0, "#ffffff");
            sg.addColorStop(1, "#d4d4d4");
          }
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = sg;
          ctx.fill();
          if (sign === -1) {
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // last move marker
      if (lastMove) {
        const [lx, ly] = lastMove;
        const sign = signMap[ly]?.[lx] ?? 0;
        ctx.strokeStyle = sign === 1 ? "#ffffff" : "#000000";
        ctx.lineWidth = Math.max(1.5, cell * 0.06);
        ctx.beginPath();
        ctx.arc(at(lx), at(ly), r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }

      // engine suggestions
      if (showSuggestions) {
        for (const s of [...suggestions].reverse()) {
          const [sx, sy] = s.vertex;
          if ((signMap[sy]?.[sx] ?? 0) !== 0) continue;
          const cx = at(sx);
          const cy = at(sy);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = s.order === 0 ? TOP_COLOUR : OFF_COLOUR;
          ctx.globalAlpha = s.order === 0 ? 1 : 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#000000";
          if (cell >= 22) {
            ctx.font = `700 ${cell * 0.34}px var(--font-geist-mono), monospace`;
            ctx.fillText((s.winrate * 100).toFixed(1), cx, cy - cell * 0.16);
            ctx.font = `600 ${cell * 0.28}px var(--font-geist-mono), monospace`;
            ctx.fillText(compactVisits(s.visits), cx, cy + cell * 0.2);
          } else {
            ctx.font = `700 ${cell * 0.38}px var(--font-geist-mono), monospace`;
            ctx.fillText(String(Math.round(s.winrate * 100)), cx, cy);
          }
        }

        if (nextMove) {
          const [nx, ny] = nextMove;
          ctx.strokeStyle = NEXT_COLOUR;
          ctx.lineWidth = Math.max(2, cell * 0.08);
          ctx.beginPath();
          ctx.arc(at(nx), at(ny), r * 0.8, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [size, signMap, lastMove, nextMove, suggestions, showSuggestions]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center min-h-0"
    >
      <canvas ref={canvasRef} className="rounded shadow-lg" />
    </div>
  );
}
