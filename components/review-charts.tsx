"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { pointsLabel } from "@/lib/review";
import { useStoredString } from "@/lib/use-stored";

// Port of ogatak-clear's MOVE QUALITY and GAME STATUS charts (move_report.js:
// chart_pads, chart_x_scale, symmetric_y_scale, draw_quality, draw_status).
// Both show only positions already reached: never the rest of the game.

type YScale = "linear" | "log2";

interface ChartView {
  open: boolean;
  yscale: YScale;
  windowed: boolean;
  windowN: number;
}

interface XMap {
  x0: number;
  slotW: number;
  domainStart: number;
  start: number;
  end: number;
}

const CAPTION_PX = 14;
const PAD = {
  left: CAPTION_PX * 4,
  right: Math.round(CAPTION_PX * 0.9),
  top: Math.round(CAPTION_PX * 1.3),
  bottom: Math.round(CAPTION_PX * 1.8),
};
const CHART_MIN_DEPTH = 20;
const LABEL = "#ffffff";
const MARKER = "#ffff99";

interface ChartsProps {
  /** Black's score lead after each turn (index 0 = start); null where not analyzed. */
  scoreLead: (number | null)[];
  /** movers[d - 1] played move d. */
  movers: ("B" | "W")[];
  /** Moves played so far. The charts end here. */
  current: number;
  onSeek: (turn: number) => void;
}

export function ReviewCharts({ scoreLead, movers, current, onSeek }: ChartsProps) {
  const [qualityView, setQualityView] = useChartView("quality");
  const [statusView, setStatusView] = useChartView("status");
  return (
    <>
      <ChartCard title="Move quality" view={qualityView} onView={setQualityView}>
        <ChartCanvas
          draw={(ctx, w, h, font) => drawQuality(ctx, w, h, font, scoreLead, movers, current, qualityView)}
          pick={(map, x) => clamp(Math.ceil(map.domainStart + (x - map.x0) / map.slotW), map.start, map.end)}
          describe={(map, x) => {
            const d = clamp(Math.ceil(map.domainStart + (x - map.x0) / map.slotW), map.start, map.end);
            const a = scoreLead[d - 1];
            const b = scoreLead[d];
            return a == null || b == null ? `#${d}: move quality unavailable` : `#${d}: ${pointsLabel(Math.abs(a - b))} points`;
          }}
          onSeek={onSeek}
        />
      </ChartCard>
      <ChartCard title="Game status" view={statusView} onView={setStatusView}>
        <ChartCanvas
          draw={(ctx, w, h, font) => drawStatus(ctx, w, h, font, scoreLead, current, statusView)}
          pick={(map, x) => clamp(Math.round(map.domainStart + (x - map.x0) / map.slotW), map.domainStart, map.end)}
          describe={(map, x) => {
            const d = clamp(Math.round(map.domainStart + (x - map.x0) / map.slotW), map.domainStart, map.end);
            const lead = scoreLead[d];
            if (lead == null) return `#${d}`;
            const size = pointsLabel(Math.abs(lead));
            return size === "0" ? `#${d}: 0` : `#${d}: ${lead > 0 ? "B" : "W"}+${size}`;
          }}
          onSeek={onSeek}
        />
      </ChartCard>
    </>
  );
}

function useChartView(id: "quality" | "status"): [ChartView, (patch: Partial<ChartView>) => void] {
  const [open, setOpen] = useStoredString(`replay.${id}.open`, "1");
  const [yscale, setYscale] = useStoredString(`replay.${id}.yscale`, "log2");
  const [windowed, setWindowed] = useStoredString(`replay.${id}.windowed`, "0");
  const [windowN, setWindowN] = useStoredString(`replay.${id}.window_n`, "40");
  const n = parseInt(windowN, 10);
  const view: ChartView = {
    open: open !== "0",
    yscale: yscale === "linear" ? "linear" : "log2",
    windowed: windowed === "1",
    windowN: Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 40,
  };
  const update = (patch: Partial<ChartView>) => {
    if (patch.open !== undefined) setOpen(patch.open ? "1" : "0");
    if (patch.yscale) setYscale(patch.yscale);
    if (patch.windowed !== undefined) setWindowed(patch.windowed ? "1" : "0");
    if (patch.windowN !== undefined) setWindowN(String(patch.windowN));
  };
  return [view, update];
}

function ChartCard({
  title,
  view,
  onView,
  children,
}: {
  title: string;
  view: ChartView;
  onView: (patch: Partial<ChartView>) => void;
  children: ReactNode;
}) {
  const Chevron = view.open ? ChevronDown : ChevronRight;
  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 className="fs-body font-bold">
          <button
            type="button"
            className="ctl -ml-2 flex items-center gap-1 whitespace-nowrap py-1 pl-1"
            aria-expanded={view.open}
            title={view.open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}
            onClick={() => onView({ open: !view.open })}
          >
            <Chevron size={20} />
            {title}
          </button>
        </h2>
        {view.open && (
          <div className="fs-caption flex items-center whitespace-nowrap">
            <button
              type="button"
              className="ctl"
              title="Toggle linear / log2 y scale"
              onClick={() => onView({ yscale: view.yscale === "log2" ? "linear" : "log2" })}
            >
              {view.yscale === "log2" ? "log₂" : "lin"}
            </button>
            <button
              type="button"
              className="ctl"
              title="Toggle full history / sliding window"
              onClick={() => onView({ windowed: !view.windowed })}
            >
              {view.windowed ? "window" : "full"}
            </button>
            <label className="flex items-center gap-1 px-2" title="Moves shown when the sliding window is on">
              last
              <input
                type="number"
                min={1}
                max={1000}
                value={view.windowN}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isInteger(n) && n >= 1 && n <= 1000) onView({ windowN: n });
                }}
                className="field fs-ui w-[4.5em]"
              />
            </label>
          </div>
        )}
      </div>
      {view.open && <div className="mt-1">{children}</div>}
    </section>
  );
}

function chartHeight(width: number): number {
  return Math.round(Math.min(250, Math.max(160, width * 0.42)));
}

function ChartCanvas({
  draw,
  pick,
  describe,
  onSeek,
}: {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, font: string) => XMap | null;
  pick: (map: XMap, x: number) => number;
  describe: (map: XMap, x: number) => string;
  onSeek: (turn: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<XMap | null>(null);
  const drawRef = useRef(draw);

  // Measures on every paint instead of waiting for a ResizeObserver callback,
  // which never arrives while the tab is in the background.
  const paint = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const width = Math.floor(wrap.clientWidth);
    if (width <= 0) return;
    const height = chartHeight(width);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    mapRef.current = drawRef.current(ctx, width, height, `${CAPTION_PX}px ${getComputedStyle(canvas).fontFamily}`);
  }, []);

  useEffect(() => {
    drawRef.current = draw;
    paint();
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => paint());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [paint]);

  const pointerX = (e: React.MouseEvent<HTMLCanvasElement>) =>
    e.clientX - e.currentTarget.getBoundingClientRect().left;

  return (
    <div ref={wrapRef} className="w-full min-w-0">
      <canvas
        ref={canvasRef}
        className="block w-full cursor-pointer"
        onClick={(e) => {
          const map = mapRef.current;
          if (map && map.end >= map.start) onSeek(pick(map, pointerX(e)));
        }}
        onMouseMove={(e) => {
          const map = mapRef.current;
          e.currentTarget.title = map && map.end >= map.start ? describe(map, pointerX(e)) : "";
        }}
      />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function crisp(v: number): number {
  return Math.round(v) + 0.5;
}

function yScale(absMax: number, mode: YScale, linearStep: (max: number) => number) {
  const log = mode === "log2";
  const ticks: number[] = [];
  let yMax: number;
  if (log) {
    yMax = Math.pow(2, Math.ceil(Math.log2(Math.max(2, absMax))));
    for (let v = 1; v <= yMax; v *= 2) ticks.push(v);
  } else {
    const step = linearStep(absMax);
    yMax = Math.ceil(absMax / step) * step;
    for (let v = step; v <= yMax; v += step) ticks.push(v);
  }
  const transform = (v: number) => (log ? Math.sign(v) * Math.log2(1 + Math.abs(v)) : v);
  return { yMax, ticks, transform };
}

/** A move is the interval (d-1, d]; the position after it is the point x(d). */
function xScale(x0: number, x1: number, end: number, view: ChartView) {
  const firstMove = view.windowed ? Math.max(1, end - view.windowN + 1) : 1;
  const domainStart = firstMove - 1;
  const span =
    view.windowed && end >= view.windowN ? view.windowN : Math.max(CHART_MIN_DEPTH, end - domainStart);
  const slotW = (x1 - x0) / span;
  return { firstMove, domainStart, slotW, xOf: (d: number) => x0 + slotW * (d - domainStart) };
}

function positionMarker(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number) {
  ctx.strokeStyle = MARKER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(crisp(x), y0);
  ctx.lineTo(crisp(x), y1);
  ctx.stroke();
}

function horizontalGrid(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  ticks: number[],
  yOf: (v: number) => number,
  label: (signed: number) => string
) {
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  // Every gridline is drawn; a label is skipped when it would overlap the
  // previous one on its side (log2 ticks bunch up near zero on short charts).
  const lastLabelY = { up: yOf(0), down: yOf(0) };
  for (const v of [0, ...ticks]) {
    for (const sv of v === 0 ? [0] : [v, -v]) {
      const y = crisp(yOf(sv));
      ctx.strokeStyle = sv === 0 ? "#555555" : "#2c2c2c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      const side = y < yOf(0) ? "up" : "down";
      if (sv !== 0 && Math.abs(y - lastLabelY[side]) < CAPTION_PX + 1) continue;
      lastLabelY[side] = y;
      ctx.fillStyle = LABEL;
      ctx.fillText(label(sv), x0 - 5, y);
    }
  }
}

function drawQuality(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  font: string,
  leads: (number | null)[],
  movers: ("B" | "W")[],
  end: number,
  view: ChartView
): XMap | null {
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const y0 = PAD.top;
  const y1 = h - PAD.bottom;
  if (x1 - x0 < 40) return null;

  ctx.fillStyle = "#181818";
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  const xs = xScale(x0, x1, end, view);
  const start = xs.firstMove;

  // Up is White gaining: Black's score lead fell during the move.
  const gains = new Map<number, number>();
  let absMax = 3;
  for (let d = start; d <= end; d++) {
    const a = leads[d - 1];
    const b = leads[d];
    if (a == null || b == null) continue;
    gains.set(d, a - b);
    absMax = Math.max(absMax, Math.abs(a - b));
  }

  const scale = yScale(absMax, view.yscale, (m) => (m <= 3 ? 1 : m <= 6 ? 2 : m <= 15 ? 5 : 10));
  const tMax = scale.transform(scale.yMax);
  const yOf = (v: number) => y0 + (y1 - y0) * (1 - (scale.transform(v) + tMax) / (2 * tMax));
  const yZero = yOf(0);

  ctx.font = font;
  horizontalGrid(ctx, x0, x1, scale.ticks, yOf, (sv) => String(Math.abs(sv)));

  // Bars fill their whole move slot; a gap would suggest a missing move.
  for (const [d, wg] of gains) {
    const left = xs.xOf(d - 1);
    const right = xs.xOf(d);
    const yv = yOf(wg);
    ctx.fillStyle = movers[d - 1] === "B" ? "#888888" : "rgba(255, 255, 255, 0.93)";
    ctx.fillRect(left, Math.min(yZero, yv), right - left, Math.max(1, Math.abs(yv - yZero)));
  }

  ctx.fillStyle = LABEL;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = Math.max(1, Math.ceil((ctx.measureText(String(end)).width + 4) / xs.slotW));
  for (let d = end; d >= start; d -= step) ctx.fillText(String(d), xs.xOf(d - 0.5), y1 + 5);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("white gains", x0 + 6, y0 + 8);
  ctx.fillText("black gains", x0 + 6, y1 - 8);

  positionMarker(ctx, xs.xOf(end), y0, y1);
  return { x0, slotW: xs.slotW, domainStart: xs.domainStart, start, end };
}

function drawStatus(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  font: string,
  leads: (number | null)[],
  end: number,
  view: ChartView
): XMap | null {
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const y0 = PAD.top;
  const y1 = h - PAD.bottom;
  if (x1 - x0 < 40) return null;

  ctx.fillStyle = "#181818";
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  const xs = xScale(x0, x1, end, view);
  const lineStart = xs.domainStart;

  let absMax = 5;
  for (let d = lineStart; d <= end; d++) {
    const s = leads[d];
    if (s != null) absMax = Math.max(absMax, Math.abs(s));
  }
  const scale = yScale(absMax, view.yscale, (m) => (m <= 10 ? 5 : m <= 20 ? 10 : m <= 60 ? 20 : 50));
  const tMax = scale.transform(scale.yMax);
  // White ahead (negative Black-POV lead) is the upper half.
  const yOf = (s: number) => y0 + ((y1 - y0) * (scale.transform(s) + tMax)) / (2 * tMax);

  ctx.font = font;
  horizontalGrid(ctx, x0, x1, scale.ticks, yOf, (sv) => (sv === 0 ? "0" : sv > 0 ? `B+${sv}` : `W+${-sv}`));

  const widest = ctx.measureText(String(Math.max(lineStart, end))).width;
  const step = Math.max(1, Math.ceil((widest + 12) / xs.slotW));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let d = end; d >= lineStart; d -= step) {
    const x = crisp(xs.xOf(d));
    ctx.strokeStyle = "#2c2c2c";
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    ctx.fillStyle = LABEL;
    ctx.fillText(String(d), x, y1 + 5);
  }

  const yZero = yOf(0);
  const points: [number, number][] = [];
  for (let d = lineStart; d <= end; d++) {
    const s = leads[d];
    if (s != null) points.push([xs.xOf(d), yOf(s)]);
  }

  if (points.length > 0) {
    // Who is ahead reads as a shape: White's lead fills white, Black's grey.
    ctx.beginPath();
    ctx.moveTo(points[0][0], yZero);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(xs.xOf(end), yZero);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "rgba(255, 255, 255, 0.33)";
    ctx.fillRect(x0, y0, x1 - x0, yZero - y0);
    ctx.fillStyle = "rgba(102, 102, 102, 0.67)";
    ctx.fillRect(x0, yZero, x1 - x0, y1 - yZero);
    ctx.restore();

    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }

  // Ogatak puts these at the right, where they collide with the "#move" label
  // once the current move reaches the right edge.
  ctx.fillStyle = LABEL;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("W ahead", x0 + 6, y0 + 8);
  ctx.fillText("B ahead", x0 + 6, y1 - 8);

  const cx = xs.xOf(end);
  positionMarker(ctx, cx, y0, y1);
  const now = leads[end];
  if (now != null) {
    ctx.fillStyle = MARKER;
    ctx.beginPath();
    ctx.arc(cx, yOf(now), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const right = cx > (x0 + x1) / 2;
  ctx.fillStyle = MARKER;
  ctx.textAlign = right ? "right" : "left";
  ctx.textBaseline = "top";
  ctx.fillText(`#${end}`, cx + (right ? -4 : 4), y0 + 2);

  return { x0, slotW: xs.slotW, domainStart: xs.domainStart, start: lineStart, end };
}
