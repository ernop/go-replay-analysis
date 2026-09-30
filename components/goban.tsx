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
  /** Whose options the badges show: each gets a translucent rim in that stone's colour. */
  markSide?: "B" | "W";
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
/**
 * A candidate's badge is a superellipse of exponent BADGE_SHAPE (2 would be
 * an ellipse; larger is squarer), just big enough to keep its text INK_GAP of
 * the font size inside its edge. Round it runs a rim RIM_WIDTH of the font
 * size wide, never under 2px, in the colour of the stone that would have been
 * played there.
 */
const BADGE_SHAPE = 2.5;
const INK_GAP = 0.05;
const RIM_WIDTH = 0.12;
const RIM = { B: "rgba(0, 0, 0, 0.5)", W: "rgba(255, 255, 255, 0.7)" };

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

/** Adds the superellipse |x/rx|^n + |y/ry|^n = 1 round (cx, cy) to the current path. */
function superellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, n: number) {
  const steps = 72;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = cx + rx * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = cy + ry * Math.sign(s) * Math.abs(s) ** (2 / n);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
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
  markSide,
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

      // A badge's text: the first line bold and, when shown, the visits line
      // below it, smaller. `measure` gives the widest line, the height the
      // lines take, and each line's centre as an offset from their middle.
      const texts = (lines: string[]) => [lines[0] ?? "", ...lines.slice(1, 2)];
      const lineFont = (i: number, font: number, sub: number) => (i === 0 ? `bold ${font}px ${family}` : `${sub}px ${family}`);
      const measure = (lines: string[], font: number) => {
        const sub = Math.max(6, Math.round(font * VISITS_FONT));
        const width = Math.max(
          ...texts(lines).map((text, i) => {
            ctx.font = lineFont(i, font, sub);
            return ctx.measureText(text).width;
          }),
        );
        const two = lines.length > 1;
        const h = two ? font * 1.125 + sub * 1.15 : font * 1.25;
        const offsets = two ? [font * 0.625 - h / 2, font * 1.125 + sub * 0.5 - h / 2] : [0];
        return { width, h, sub, offsets };
      };
      // Where a line's ink falls: `dy` moves its middle onto the line's
      // centre, and `x` and `y` are its half-width and half-height.
      const ink = (text: string, font: string) => {
        ctx.font = font;
        const m = ctx.measureText(text);
        return {
          dy: (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
          x: Math.max(m.actualBoundingBoxLeft, m.actualBoundingBoxRight),
          y: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2,
        };
      };
      const writeLines = (lines: string[], cx: number, cy: number, font: number, sub: number, offsets: number[]) => {
        ctx.fillStyle = "#000000";
        texts(lines).forEach((text, i) => {
          ctx.fillText(text, cx, cy + offsets[i] + ink(text, lineFont(i, font, sub)).dy);
        });
      };

      // A candidate's badge is a superellipse shaped like the played badge's
      // rectangle, scaled up until every line's ink stays INK_GAP inside its
      // 1px edge (a and b are the semi-axes inside that edge). The rim is
      // translucent, so it goes under every badge and takes no room.
      const rim = markSide ? Math.max(2, Math.round(markFont * RIM_WIDTH)) : 0;
      const gap = INK_GAP * markFont;
      const optionShape = (lines: string[]) => {
        const t = measure(lines, markFont);
        const a = Math.max(markFont * 1.25, t.width + markFont * 0.5) / 2 - 1;
        const b = t.h / 2 - 1;
        let reach = 0;
        texts(lines).forEach((text, i) => {
          const k = ink(text, lineFont(i, markFont, t.sub));
          const x = k.x + gap;
          const y = Math.abs(t.offsets[i]) + k.y + gap;
          reach = Math.max(reach, (x / a) ** BADGE_SHAPE + (y / b) ** BADGE_SHAPE);
        });
        const grow = Math.max(1, reach ** (1 / BADGE_SHAPE));
        return { w: 2 * (a * grow + 1), h: 2 * (b * grow + 1), sub: t.sub, offsets: t.offsets };
      };

      // A candidate's badge is centred on its point. Badges that would
      // overlap each other are pushed apart along the line between their
      // points, and any reaching into the last-move mark are pushed back off
      // it; never by more than BADGE_NUDGE of their size, so each still sits
      // on its own point. The board's edge holds them in, rims and all.
      const cands = shown.map((m) => {
        const { w, h, sub, offsets } = optionShape(m.lines);
        // Centred on the middle of the point's gridline pixels.
        const homeX = gridPixel(m.vertex[0]) + 0.5 - w / 2;
        const homeY = gridPixel(m.vertex[1]) + 0.5 - h / 2;
        return { m, w, h, sub, offsets, homeX, homeY, x: homeX, y: homeY };
      });
      type Cand = (typeof cands)[number];
      const place = (c: Cand, x: number, y: number) => {
        const dx = BADGE_NUDGE * c.w;
        const dy = BADGE_NUDGE * c.h;
        c.x = Math.max(rim, Math.min(px - rim - c.w, Math.max(c.homeX - dx, Math.min(c.homeX + dx, x))));
        c.y = Math.max(rim, Math.min(px - rim - c.h, Math.max(c.homeY - dy, Math.min(c.homeY + dy, y))));
      };
      // Moves `c` away from `other` along one axis, the two sharing the move; with no `other`, off the last-move mark, which stays.
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
      // The last-move mark is the half of the played stone's square below its
      // diagonal from upper right to lower left. `pastMark` is how far a badge
      // reaches across that diagonal: its centre's distance along (1, 1) plus
      // the superellipse's extent that way.
      const markSquare = playedStone && {
        x: playedStone.vertex[0] * square,
        y: playedStone.vertex[1] * square,
        w: square,
        h: square,
      };
      const dual = BADGE_SHAPE / (BADGE_SHAPE - 1);
      const pastMark = (c: Cand, s: Rect) => {
        const rx = c.w / 2;
        const ry = c.h / 2;
        return c.x + rx - s.x + (c.y + ry - s.y) + (rx ** dual + ry ** dual) ** (1 / dual) - s.w;
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
            const [ox, oy] = overlap(a, markSquare);
            const past = pastMark(a, markSquare);
            if (ox > 0 && oy > 0 && past > 0) {
              const sx = Math.sign(a.m.vertex[0] - playedStone.vertex[0]);
              const sy = Math.sign(a.m.vertex[1] - playedStone.vertex[1]);
              // Moving left or up also clears the diagonal, often before the square.
              separate(a, null, -sx, -sy, sx < 0 ? Math.min(ox, past) : ox, sy < 0 ? Math.min(oy, past) : oy);
            }
          }
        }
        if (positions() === before) break;
      }
      if (markSide) {
        // One fill, so overlapping rims don't darken twice.
        ctx.beginPath();
        for (const c of cands) superellipse(ctx, c.x + c.w / 2, c.y + c.h / 2, c.w / 2 + rim, c.h / 2 + rim, BADGE_SHAPE);
        ctx.fillStyle = RIM[markSide];
        ctx.fill();
      }
      // Drawn last mark first, so where badges still overlap the first mark's is on top.
      for (const c of [...cands].reverse()) {
        const cx = c.x + c.w / 2;
        const cy = c.y + c.h / 2;
        ctx.beginPath();
        superellipse(ctx, cx, cy, c.w / 2 - 0.5, c.h / 2 - 0.5, BADGE_SHAPE);
        ctx.fillStyle = c.m.fill;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = BADGE_EDGE;
        ctx.stroke();
        writeLines(c.m.lines, cx, cy, markFont, c.sub, c.offsets);
      }

      // The played stone is unmistakable, so its badge may take whichever
      // corner of the stone hides least of the candidates' badges and points.
      // It is drawn last, above them.
      if (playedStone) {
        const font = Math.max(6, Math.round(base * PLAYED_SCALE * playedScale));
        const { width, h: textH, sub, offsets } = measure(playedStone.lines, font);
        const w = Math.max(Math.round(font * 1.25), Math.ceil(width + font * 0.5));
        const h = Math.round(textH);
        const r = Math.round(font * 0.375);
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
          for (const o of cands) cost += overlapArea(c, o) / (h * h);
          for (const m of shown) {
            if (coversCircle(c, centre(m.vertex[0]), centre(m.vertex[1]), 0.12 * square)) cost += 1;
          }
          if (cost < least) {
            least = cost;
            best = c;
          }
        }
        if (best) {
          ctx.beginPath();
          ctx.roundRect(best.x + 1, best.y + 1, w - 2, h - 2, best.radii);
          ctx.fillStyle = playedStone.fill;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = PLAYED_EDGE;
          ctx.stroke();
          writeLines(playedStone.lines, best.x + w / 2, best.y + h / 2, font, sub, offsets);
        }
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [size, signMap, marks, played, badges, markScale, playedScale, markSide, marksKey]);

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
