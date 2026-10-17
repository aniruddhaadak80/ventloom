/**
 * Charts, drawn as inline SVG.
 *
 * No charting library. Every visual in the observatory is one of a small family
 * of shapes - sparkline, bar series, spectrogram heat map, displacement quiver,
 * waveform - and each of them is a pure function of numbers. That keeps the
 * bundle small, the colours consistent, and the tests able to assert on
 * geometry rather than on pixels.
 */

import type { ReactNode } from "react";

const VIEW_W = 100;

/** Y range with `pad` of headroom at each end, for the sparkline and bar views. */
function scaleY(values: readonly number[], pad: number): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) {
    const c = lo;
    return [c - Math.abs(c || 1) * 0.5, c + Math.abs(c || 1) * 0.5];
  }
  const span = hi - lo;
  return [lo - span * pad, hi + span * pad];
}

export interface SparklineProps {
  values: readonly number[];
  /** Height in pixels. Width is fixed at 100 units and scales with CSS. */
  height?: number;
  /** Colour token, default lava. */
  tone?: "lava" | "seismic" | "ash" | "alert";
  /** Draw the area under the line. */
  area?: boolean;
  label: string;
}

const SPARK_TONE: Record<NonNullable<SparklineProps["tone"]>, string> = {
  lava: "var(--color-lava)",
  seismic: "var(--color-seismic)",
  ash: "var(--color-ash-dim)",
  alert: "var(--color-alert)",
};

export function Sparkline({
  values,
  height = 28,
  tone = "lava",
  area = true,
  label,
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label={label}
      />
    );
  }
  const [lo, hi] = scaleY(values, 0.1);
  const span = hi - lo || 1;
  const step = values.length === 1 ? 0 : VIEW_W / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - ((v - lo) / span) * height] as const);
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(3)},${y.toFixed(3)}`)
    .join(" ");
  const fill = `${line} L${VIEW_W},${height} L0,${height} Z`;
  const stroke = SPARK_TONE[tone];
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full overflow-visible"
      role="img"
      aria-label={label}
    >
      {area ? <path d={fill} fill={stroke} opacity={0.12} /> : null}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export interface BarSeriesProps {
  values: readonly number[];
  labels?: readonly string[];
  height?: number;
  tone?: keyof typeof SPARK_TONE;
  label: string;
  /** Highlight bars at or above this value, in the alert colour. */
  threshold?: number;
}

/** A vertical bar series. Used for RSAM history and band-energy ratios. */
export function BarSeries({
  values,
  labels,
  height = 80,
  tone = "lava",
  label,
  threshold,
}: BarSeriesProps) {
  if (values.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label={label}
      />
    );
  }
  const max = Math.max(...values, 1e-12);
  const gap = VIEW_W / values.length;
  const barW = gap * 0.7;
  const stroke = SPARK_TONE[tone];
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={label}
    >
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * height);
        const x = i * gap + (gap - barW) / 2;
        const hot = threshold !== undefined && v >= threshold;
        return (
          <rect
            key={labels?.[i] ?? i}
            x={x}
            y={height - h}
            width={barW}
            height={h}
            rx={0.6}
            fill={hot ? "var(--color-alert)" : stroke}
            opacity={hot ? 0.95 : 0.85}
          >
            <title>{`${labels?.[i] ?? i}: ${v.toPrecision(4)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export interface SpectrogramProps {
  /** frames[i].powers[k] is the power at frame i, bin k. */
  frames: readonly { timeS: number; powers: readonly number[] }[];
  frequenciesHz: readonly number[];
  height?: number;
  label: string;
}

/**
 * Spectrogram heat map: time on x, frequency on y, power as brightness.
 *
 * Rendered as one rectangle per frame column of stacked bins, which keeps the
 * SVG small enough to ship inline even for a 60-second, 8192-point transform.
 */
export function Spectrogram({ frames, frequenciesHz, height = 200, label }: SpectrogramProps) {
  if (frames.length === 0 || frequenciesHz.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label={label}
      />
    );
  }
  let max = 0;
  for (const frame of frames) for (const p of frame.powers) if (p > max) max = p;
  if (max <= 0) max = 1;
  const logMax = Math.log10(max + 1e-30);
  const logMin = logMax - 3; // a 30 dB window, the range a duty seismologist reads
  const colW = VIEW_W / frames.length;
  const binH = height / frequenciesHz.length;
  // Limit the bins drawn: anything above 15 Hz is noise for tremor work.
  const maxBin = Math.min(frequenciesHz.length - 1, Math.ceil(15 / (frequenciesHz[1] ?? 1) || 0));
  const cells: ReactNode[] = [];
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f] as { timeS: number; powers: readonly number[] };
    for (let b = 0; b <= maxBin; b++) {
      const p = frame.powers[b] ?? 0;
      const t = (Math.log10(p + 1e-30) - logMin) / (logMax - logMin);
      if (t <= 0) continue;
      const alpha = Math.min(1, t);
      cells.push(
        <rect
          key={`${f}-${b}`}
          x={f * colW}
          y={height - (b + 1) * binH}
          width={colW + 0.2}
          height={binH + 0.2}
          fill="var(--color-lava)"
          opacity={alpha}
        />,
      );
    }
  }
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={label}
    >
      <rect x={0} y={0} width={VIEW_W} height={height} fill="var(--color-abyss)" />
      {cells}
      {[0, 5, 10, 15].map((hz) => {
        const bin = Math.round(hz / (frequenciesHz[1] ?? 1));
        if (bin > maxBin) return null;
        return (
          <line
            key={hz}
            x1={0}
            x2={VIEW_W}
            y1={height - bin * binH}
            y2={height - bin * binH}
            stroke="var(--color-seismic)"
            strokeWidth={0.3}
            opacity={0.4}
          />
        );
      })}
    </svg>
  );
}

export interface WaveformProps {
  samples: readonly number[];
  height?: number;
  tone?: keyof typeof SPARK_TONE;
  label: string;
  /** Down-sample to at most this many drawn points. */
  maxPoints?: number;
}

/** A ground-velocity trace, down-sampled by min/max decimation per pixel. */
export function Waveform({
  samples,
  height = 90,
  tone = "seismic",
  label,
  maxPoints = 600,
}: WaveformProps) {
  if (samples.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label={label}
      />
    );
  }
  const stride = Math.max(1, Math.ceil(samples.length / maxPoints));
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < samples.length; i += stride) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let j = i; j < Math.min(i + stride, samples.length); j++) {
      const v = samples[j] as number;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    lo.push(min);
    hi.push(max);
  }
  const peak = Math.max(...hi.map(Math.abs), ...lo.map(Math.abs), 1e-12);
  const mid = height / 2;
  const scale = mid / peak;
  const colW = VIEW_W / lo.length;
  const stroke = SPARK_TONE[tone];
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={label}
    >
      <line x1={0} y1={mid} x2={VIEW_W} y2={mid} stroke="var(--color-slag)" strokeWidth={0.4} />
      {lo.map((l, i) => (
        <rect
          key={`wave-${i}-${l}`}
          x={i * colW}
          y={mid - (hi[i] ?? 0) * scale}
          width={Math.max(colW, 0.3)}
          height={Math.max(0.4, ((hi[i] ?? 0) - l) * scale)}
          fill={stroke}
          opacity={0.85}
        />
      ))}
    </svg>
  );
}

export interface QuiverProps {
  /** Displacement vectors in metres, one per station. */
  vectors: readonly { eastM: number; northM: number; upM: number }[];
  labels: readonly string[];
  size?: number;
  label: string;
}

/**
 * Displacement quiver: horizontal arrows scaled against the largest magnitude,
 * with vertical displacement as the arrow colour. This is the picture that makes
 * a Mogi inversion legible.
 */
export function Quiver({ vectors, labels, size = 200, label }: QuiverProps) {
  const maxH = Math.max(...vectors.map((v) => Math.hypot(v.eastM, v.northM)), 1e-12);
  const maxV = Math.max(...vectors.map((v) => Math.abs(v.upM)), 1e-12);
  const c = size / 2;
  const r = size * 0.06;
  return (
    <svg
      viewBox={`${-c} ${-c} ${size} ${size}`}
      className="h-full w-full"
      role="img"
      aria-label={label}
    >
      <circle
        r={size * 0.42}
        fill="var(--color-basalt)"
        stroke="var(--color-slag)"
        strokeWidth={1}
      />
      {vectors.map((v, i) => {
        const scale = (r * 3.4 * Math.hypot(v.eastM, v.northM)) / maxH;
        const ux = v.eastM / (maxH || 1);
        const uy = -v.northM / (maxH || 1);
        const len = Math.hypot(ux, uy) || 1;
        const ex = (ux / len) * scale;
        const ey = (uy / len) * scale;
        const upRatio = Math.abs(v.upM) / maxV;
        return (
          <g key={labels[i] ?? i}>
            <line
              x1={0}
              y1={0}
              x2={ex}
              y2={ey}
              stroke={v.upM < 0 ? "var(--color-lava)" : "var(--color-seismic)"}
              strokeWidth={1.6}
              opacity={0.35 + 0.65 * upRatio}
            />
            <circle
              cx={ex}
              cy={ey}
              r={1.8}
              fill={v.upM < 0 ? "var(--color-lava)" : "var(--color-seismic)"}
            />
            <text
              x={ex + 3}
              y={ey - 3}
              fontSize={6}
              fill="var(--color-ash-dim)"
              fontFamily="var(--font-mono)"
            >
              {labels[i]}
            </text>
          </g>
        );
      })}
      <circle r={2.5} fill="var(--color-ash)" />
      <text
        x={0}
        y={size * 0.44}
        fontSize={7}
        textAnchor="middle"
        fill="var(--color-ash-dim)"
        fontFamily="var(--font-display)"
      >
        summit
      </text>
    </svg>
  );
}

export interface ProgressMeterProps {
  /** Value in [0, 1]. */
  value: number;
  label: string;
  tone?: keyof typeof SPARK_TONE;
}

/** A thin horizontal meter. Uses the native element, so its role is real. */
export function ProgressMeter({ value, label, tone = "lava" }: ProgressMeterProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <meter
      value={Number(clamped.toFixed(4))}
      min={0}
      max={1}
      aria-label={label}
      className="h-1.5 w-full appearance-none overflow-hidden rounded-full bg-[var(--color-slag)] [&::-webkit-meter-bar]:bg-[var(--color-slag)]"
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${clamped * 100}%`, background: SPARK_TONE[tone] }}
      />
    </meter>
  );
}
