"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface BoardMark {
  vertex: [number, number];
  fill: string;
  /** Text lines: a circle's Delta and Visits, or a badge's points lost and, when asked for, visits. */
  lines: string[];
}

/** A move already on the board, rated like a candidate, in a badge at a corner of its stone. */
export interface PlayedMark {
  vertex: [number, number];
  fill: string;
  lines: string[];
}

interface GobanProps {
  size: number;
  signMap: number[][];
  lastMove: [number, number] | null;
  /** Candidate marks and the played move's badge sit on their own layer above the stones. Where badges overlap, earlier marks are on top. */
  marks: BoardMark[];
  played?: PlayedMark | null;
  /**
   * Guess mode's style: each candidate is a badge in its colour centred on
   * its point, and the played move gets a larger badge at a corner of its
   * stone. Otherwise candidates are stone-sized circles holding their lines.
   */
  badges?: boolean;
  /** Badge sizes as multiples of the default: the candidates', and the played move's. */
  markScale?: number;
  playedScale?: number;
  /** A new key starts a fresh marks layer, restarting any animation in `marksClassName`. */
  marksKey?: string | number;
  marksClassName?: string;
  onBoardClick?: () => void;
  /** Drawn over the board, positioned against its edges. */
  children?: ReactNode;
}

// Matches ogatak-clear's board (board_drawer.js, gridlines.js and the owner's
// config): wood #d0ad75, 1px black grid, 3px star points, no coordinates,
// candidate circles the size of a stone with black text in the page's font.
// The last-move mark and guess mode's badges are this app's.
const WOOD = "#d0ad75";
const GRID = "#000000";
/** The last move's mark fills the lower-right half of its square in this blue, over the stone. */
const LAST_MOVE = "#5cb8ff";
/** Stone radius, in squares. */
const STONE = 0.48;
/**
 * Badges: the text is BADGE_FONT of a square tall and never under
 * BADGE_MIN_PX, times the viewer's size setting. The played move's badge
 * sits PLAYED_INSET of a square out from the stone's centre and is
 * PLAYED_SCALE times larger with a heavier edge. The visits line, when
 * shown, is VISITS_FONT of the first line's size.
 */
const BADGE_FONT = 0.4;
const BADGE_MIN_PX = 12;
const PLAYED_INSET = 0.15;
const PLAYED_SCALE = 1.15;
const VISITS_FONT = 0.8;
/** How far a candidate's badge may be pushed off its point's centre, as a share of its width or height. */
const BADGE_NUDGE = 0.3;
const BADGE_EDGE = "rgba(0, 0, 0, 0.6)";
const PLAYED_EDGE = "rgba(0, 0, 0, 0.9)";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Overlap area; edges that touch or cross by a pixel don't count. */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - 1;
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - 1;
  return w > 0 && h > 0 ? w * h : 0;
}

function coversCircle(r: Rect, cx: number, cy: number, radius: number): boolean {
  const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < radius ** 2;
}

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

/** The largest font (in `font`, a "{size}px family" template) at which every text in `samples` fits in `width`. */
function fitFontPx(ctx: CanvasRenderingContext2D, font: (px: number) => string, width: number, samples: string[]): number {
  ctx.font = font(100);
  const per100 = Math.max(1, ...samples.map((s) => ctx.measureText(s).width));
  return Math.max(6, Math.floor((width * 100) / per100));
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
  badges = false,
  markScale = 1,
  playedScale = 1,
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

      const r = square * STONE;
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
        // Cut from the square's upper-right corner to its lower-left.
        const left = lastMove[0] * square;
        const top = lastMove[1] * square;
        ctx.beginPath();
        ctx.moveTo(left + square, top);
        ctx.lineTo(left + square, top + square);
        ctx.lineTo(left, top + square);
        ctx.closePath();
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
      const { ctx, square, px, centre } = board;
      const family = getComputedStyle(canvas).fontFamily;
      const onEmpty = (m: { vertex: [number, number] }) => (signMap[m.vertex[1]]?.[m.vertex[0]] ?? 0) === 0;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (!badges) {
        // ogatak board_font_chooser: "999" fills 59% of a square.
        const font = (n: number) => `${n}px ${family}`;
        ctx.font = font(fitFontPx(ctx, font, 0.59 * square, ["999"]));
        for (const m of marks.filter(onEmpty)) {
          const cx = centre(m.vertex[0]);
          const cy = centre(m.vertex[1]);
          ctx.beginPath();
          ctx.arc(cx, cy, square / 2, 0, Math.PI * 2);
          ctx.fillStyle = m.fill;
          ctx.fill();
          ctx.fillStyle = "#000000";
          if (m.lines.length >= 2) {
            ctx.fillText(m.lines[0], cx, cy - square / 6 + 0.5);
            ctx.fillText(m.lines[1], cx, cy + square / 6 + 1.5);
          } else if (m.lines.length === 1) {
            ctx.fillText(m.lines[0], cx, cy + 2);
          }
        }
        return;
      }

      const base = Math.max(BADGE_MIN_PX, BADGE_FONT * square);
      const markFont = Math.max(6, Math.round(base * markScale));
      const shown = marks.filter(onEmpty);
      const playedStone = played && !onEmpty(played) ? played : null;
      // The pixel row or column a point's gridline covers (see `line` above).
      const gridPixel = (v: number) => Math.floor(centre(v) + (square % 2 === 0 ? 0.5 : 0));
      const odd = (n: number) => (n % 2 === 0 ? n + 1 : n);

      // The first line is bold; the visits line, when shown, sits below it,
      // smaller. Odd sizes let a badge centre exactly on a 1px gridline.
      const measure = (lines: string[], font: number) => {
        const sub = Math.max(6, Math.round(font * VISITS_FONT));
        ctx.font = `bold ${font}px ${family}`;
        let text = ctx.measureText(lines[0] ?? "").width;
        let h = font * 1.25;
        if (lines.length > 1) {
          ctx.font = `${sub}px ${family}`;
          text = Math.max(text, ctx.measureText(lines[1]).width);
          h = font * 1.125 + sub * 1.15;
        }
        const w = Math.max(Math.round(font * 1.25), Math.ceil(text + font * 0.5));
        return { w: odd(w), h: odd(Math.round(h)), r: Math.round(font * 0.375), sub };
      };
      type Badge = Rect & { radii: number[]; fill: string; lines: string[]; font: number; sub: number; edge: string; line: number };

      // A candidate's badge is centred on its point. Badges that would
      // overlap each other are pushed apart along the line between their
      // points, and those right of or below the played stone are pushed off
      // its square, which holds the last-move mark; never by more than
      // BADGE_NUDGE of their size, so each still sits on its own point. The
      // board's edge holds them in.
      const cands = shown.map((m) => {
        const { w, h, r, sub } = measure(m.lines, markFont);
        const homeX = gridPixel(m.vertex[0]) - (w - 1) / 2;
        const homeY = gridPixel(m.vertex[1]) - (h - 1) / 2;
        return { m, w, h, r, sub, homeX, homeY, x: homeX, y: homeY };
      });
      type Cand = (typeof cands)[number];
      const place = (c: Cand, x: number, y: number) => {
        const dx = BADGE_NUDGE * c.w;
        const dy = BADGE_NUDGE * c.h;
        c.x = Math.max(0, Math.min(px - c.w, Math.max(c.homeX - dx, Math.min(c.homeX + dx, x))));
        c.y = Math.max(0, Math.min(px - c.h, Math.max(c.homeY - dy, Math.min(c.homeY + dy, y))));
      };
      // Moves `c` away from `other` along one axis, the two sharing the move; with no `other`, off the played stone's square, which stays.
      const separate = (c: Cand, other: Cand | null, towardX: number, towardY: number, ox: number, oy: number) => {
        const share = other ? 0.5 : 1;
        if (towardY === 0 || (towardX !== 0 && ox <= oy)) {
          place(c, c.x - towardX * ox * share, c.y);
          if (other) place(other, other.x + towardX * ox * share, other.y);
        } else {
          place(c, c.x, c.y - towardY * oy * share);
          if (other) place(other, other.x, other.y + towardY * oy * share);
        }
      };
      cands.forEach((c) => place(c, c.x, c.y));
      const markSquare = playedStone && {
        x: playedStone.vertex[0] * square,
        y: playedStone.vertex[1] * square,
        w: square,
        h: square,
      };
      const overlap = (a: Rect, b: Rect) => [
        Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - 1,
        Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - 1,
      ];
      const positions = () => cands.map((c) => `${c.x},${c.y}`).join(" ");
      for (let pass = 0; pass < 12; pass++) {
        const before = positions();
        for (let i = 0; i < cands.length; i++) {
          const a = cands[i];
          for (let j = i + 1; j < cands.length; j++) {
            const b = cands[j];
            const [ox, oy] = overlap(a, b);
            if (ox > 0 && oy > 0) {
              separate(a, b, Math.sign(b.m.vertex[0] - a.m.vertex[0]), Math.sign(b.m.vertex[1] - a.m.vertex[1]), ox, oy);
            }
          }
          if (markSquare && playedStone) {
            const sx = Math.sign(a.m.vertex[0] - playedStone.vertex[0]);
            const sy = Math.sign(a.m.vertex[1] - playedStone.vertex[1]);
            const [ox, oy] = overlap(a, markSquare);
            if (sx >= 0 && sy >= 0 && ox > 0 && oy > 0) separate(a, null, -sx, -sy, ox, oy);
          }
        }
        if (positions() === before) break;
      }
      // Drawn last mark first, so where badges still overlap the first mark's is on top.
      const badgeList: Badge[] = [...cands].reverse().map((c) => ({
        x: Math.round(c.x),
        y: Math.round(c.y),
        w: c.w,
        h: c.h,
        radii: [c.r, c.r, c.r, c.r],
        fill: c.m.fill,
        lines: c.m.lines,
        font: markFont,
        sub: c.sub,
        edge: BADGE_EDGE,
        line: 1,
      }));

      // The played stone is unmistakable, so its badge may take whichever
      // corner of the stone hides least of the candidates' badges and points.
      // It is drawn last, above them.
      if (playedStone) {
        const font = Math.max(6, Math.round(base * PLAYED_SCALE * playedScale));
        const { w, h, r, sub } = measure(playedStone.lines, font);
        const d = Math.round(PLAYED_INSET * square);
        const gx = gridPixel(playedStone.vertex[0]);
        const gy = gridPixel(playedStone.vertex[1]);
        const corners = [
          { x: gx + d, y: gy + d, w, h, radii: [0, r, r, r] },
          { x: gx + d, y: gy + 1 - d - h, w, h, radii: [r, r, r, 0] },
          { x: gx + 1 - d - w, y: gy + d, w, h, radii: [r, 0, r, r] },
          { x: gx + 1 - d - w, y: gy + 1 - d - h, w, h, radii: [r, r, 0, r] },
        ].filter((c) => c.x >= 0 && c.y >= 0 && c.x + w <= px && c.y + h <= px);
        let best = corners[0];
        let least = Infinity;
        for (const c of corners) {
          let cost = 0;
          for (const b of badgeList) cost += overlapArea(c, b) / (h * h);
          for (const m of shown) {
            if (coversCircle(c, centre(m.vertex[0]), centre(m.vertex[1]), 0.12 * square)) cost += 1;
          }
          if (cost < least) {
            least = cost;
            best = c;
          }
        }
        if (best) {
          badgeList.push({ ...best, fill: playedStone.fill, lines: playedStone.lines, font, sub, edge: PLAYED_EDGE, line: 2 });
        }
      }

      // "middle" sets digits a little high, by an amount that grows with the font.
      const lift = (font: number) => Math.max(1, Math.round(font * 0.05));
      for (const b of badgeList) {
        ctx.beginPath();
        ctx.roundRect(b.x + b.line / 2, b.y + b.line / 2, b.w - b.line, b.h - b.line, b.radii);
        ctx.fillStyle = b.fill;
        ctx.fill();
        ctx.lineWidth = b.line;
        ctx.strokeStyle = b.edge;
        ctx.stroke();
        ctx.fillStyle = "#000000";
        ctx.font = `bold ${b.font}px ${family}`;
        const mid = b.x + b.w / 2;
        if (b.lines.length > 1) {
          ctx.fillText(b.lines[0], mid, b.y + b.font * 0.625 + lift(b.font));
          ctx.font = `${b.sub}px ${family}`;
          ctx.fillText(b.lines[1], mid, b.y + b.font * 1.125 + b.sub * 0.5 + lift(b.sub));
        } else {
          ctx.fillText(b.lines[0] ?? "", mid, b.y + b.h / 2 + lift(b.font));
        }
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [size, signMap, marks, played, badges, markScale, playedScale, marksKey]);

  // Fills a positioned parent, which must have its own size.
  return (
    <div ref={containerRef} className="absolute inset-0 flex items-start justify-center">
      <div className={`relative ${onBoardClick ? "cursor-pointer touch-manipulation select-none" : ""}`} onClick={onBoardClick}>
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
