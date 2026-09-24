"use client";

const MIN = 0.5;
const MAX = 5;
const STEP = 0.5;

interface SpeedSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function SpeedSlider({ value, onChange }: SpeedSliderProps) {
  const notches: number[] = [];
  for (let v = MIN; v <= MAX + 1e-9; v += STEP) notches.push(Math.round(v * 2) / 2);
  const pct = (v: number) => ((v - MIN) / (MAX - MIN)) * 100;

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold">Autoplay speed</span>
        <span className="text-lg font-bold font-mono">{value.toFixed(1)} s/move</span>
      </div>
      <div className="px-[8px]">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full accent-[#e0b872]"
          aria-label="Autoplay speed in seconds per move"
        />
        <div className="relative h-6">
          {notches.map((v) => (
            <div
              key={v}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${pct(v)}%`, transform: "translateX(-50%)" }}
            >
              <div className="w-px h-1.5 bg-white" />
              {Number.isInteger(v) || v === MIN || v === MAX ? (
                <span className="text-xs font-semibold font-mono leading-4">
                  {v % 1 === 0 ? v : v.toFixed(1)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
