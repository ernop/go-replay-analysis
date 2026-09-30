"use client";

/** The thumb's width in px, as `.range` in globals.css draws it. */
const THUMB = 18;

interface NotchedSliderProps {
  label: string;
  title?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Values numbered under their notch, besides the two ends. */
  numbered?: number[];
  unit?: string;
  onChange: (value: number) => void;
}

/** A range input with a notch at every step, numbers under the ends and `numbered`, and the current value beside its label. */
export function NotchedSlider({ label, title, value, min, max, step, numbered = [], unit = "", onChange }: NotchedSliderProps) {
  const steps = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
  const numbers = new Set([min, ...numbered, max]);
  // The thumb's centre travels from half a thumb in from one end to half a thumb in from the other.
  const at = (v: number) => `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${(v - min) / (max - min)})`;
  return (
    <label className="flex items-start gap-3" title={title}>
      <span className="flex w-44 flex-none items-baseline justify-between gap-2 whitespace-nowrap leading-6">
        <span className="fs-caption">{label}</span>
        <span className="fs-ui font-bold tabular-nums">
          {value}
          {unit}
        </span>
      </span>
      <span className="relative block min-w-0 flex-1 px-2 pb-6">
        <input
          type="range"
          className="range block w-full"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span aria-hidden className="pointer-events-none absolute inset-x-2 top-6 block">
          {steps.map((v) => (
            <span
              key={v}
              className={`absolute top-0 w-0.5 -translate-x-1/2 bg-white ${numbers.has(v) ? "h-2" : "h-1"}`}
              style={{ left: at(v) }}
            />
          ))}
          {[...numbers].map((v) => (
            <span key={`n${v}`} className="fs-fine absolute top-2.5 -translate-x-1/2 leading-none tabular-nums" style={{ left: at(v) }}>
              {v}
            </span>
          ))}
        </span>
      </span>
    </label>
  );
}
