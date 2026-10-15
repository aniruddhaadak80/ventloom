/**
 * The ventloom design system primitives.
 *
 * Every surface in the observatory is composed from these. Server Components
 * by default: anything that holds state, listens to the DOM or animates is a
 * `"use client"` leaf and nothing else, which keeps the route payloads small
 * and the server render meaningful.
 */

import type { ReactNode } from "react";

/** Merge class names without pulling in a dependency. */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

export interface PanelProps {
  children: ReactNode;
  /** Panel heading; rendered in display type. */
  title?: string;
  /** Sub-line under the title, muted. */
  subtitle?: string;
  /** Right-aligned slot for a badge, a value or an action. */
  aside?: ReactNode;
  className?: string;
}

/** A bordered surface. The basic container of the whole app. */
export function Panel({ children, title, subtitle, aside, className }: PanelProps) {
  return (
    <section
      className={cx(
        "rounded-[var(--radius-lg)] border border-[var(--color-slag)] bg-[var(--color-obsidian)] shadow-[var(--shadow-panel)]",
        className,
      )}
    >
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-slag)] px-4 py-3">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-sm tracking-tight text-[var(--color-ash)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ash-dim)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export type AlertLevel = "NORMAL" | "ADVISORY" | "WATCH" | "WARNING";
export type ColourCode = "GREEN" | "YELLOW" | "ORANGE" | "RED";

const LEVEL_TONE: Record<AlertLevel, string> = {
  NORMAL: "border-[var(--color-normal)]/40 text-[var(--color-normal)]",
  ADVISORY: "border-[var(--color-advisory)]/40 text-[var(--color-advisory)]",
  WATCH: "border-[var(--color-watch)]/40 text-[var(--color-watch)]",
  WARNING: "border-[var(--color-alert)]/50 text-[var(--color-alert)]",
};

/** The alert-level badge. Colour is the level, so the badge never lies. */
export function AlertBadge({ level, colour }: { level: AlertLevel; colour?: ColourCode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] font-medium uppercase tracking-wider",
        LEVEL_TONE[level],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {level}
      {colour ? <span className="opacity-70">/ {colour}</span> : null}
    </span>
  );
}

/** A labelled value. The unit is always shown, never assumed. */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: "default" | "lava" | "seismic" | "alert";
}) {
  const toneClass =
    tone === "lava"
      ? "text-[var(--color-lava)]"
      : tone === "seismic"
        ? "text-[var(--color-seismic)]"
        : tone === "alert"
          ? "text-[var(--color-alert)]"
          : "text-[var(--color-ash)]";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-[var(--color-ash-dim)]">{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-mono)] text-lg leading-none tabular-nums">
        <span className={toneClass}>{value}</span>
        {unit ? <span className="ml-1 text-xs text-[var(--color-ash-dim)]">{unit}</span> : null}
      </dd>
      {hint ? (
        <p className="mt-1 text-[11px] leading-snug text-[var(--color-ash-dim)]">{hint}</p>
      ) : null}
    </div>
  );
}

/** A definition list of stats laid out on a grid. */
export function StatGrid({
  children,
  columns = 4,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 6;
}) {
  return (
    <dl
      className={cx(
        "grid gap-4",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-2 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-4",
        columns === 6 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
      )}
    >
      {children}
    </dl>
  );
}

export type Tone = "neutral" | "lava" | "seismic" | "alert" | "normal";

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-[var(--color-slag)]",
  lava: "border-[var(--color-lava)]/40",
  seismic: "border-[var(--color-seismic)]/40",
  alert: "border-[var(--color-alert)]/50",
  normal: "border-[var(--color-normal)]/40",
};

/** A tinted callout. Use it for anything a reader might otherwise miss. */
export interface CalloutProps {
  children: ReactNode;
  tone?: Tone | undefined;
  title?: string | undefined;
}

/** A tinted callout. Use it for anything a reader might otherwise miss. */
export function Callout({ children, tone = "neutral", title }: CalloutProps) {
  return (
    <div
      className={cx(
        "rounded-[var(--radius-md)] border bg-[var(--color-basalt)]/60 p-3",
        TONE_BORDER[tone],
      )}
    >
      {title ? (
        <p className="mb-1 font-[family-name:var(--font-display)] text-xs text-[var(--color-ash)]">
          {title}
        </p>
      ) : null}
      <div className="text-xs leading-relaxed text-[var(--color-ash-muted)]">{children}</div>
    </div>
  );
}

/**
 * A table that stays readable on a phone. Rows are cards below the `md`
 * breakpoint, which is the only way a nine-column geodetic table survives.
 */
export function DataTable({
  columns,
  children,
  caption,
}: {
  columns: string[];
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-[var(--color-slag)]">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="whitespace-nowrap px-3 py-2 font-[family-name:var(--font-display)] text-[11px] font-medium uppercase tracking-wider text-[var(--color-ash-dim)]"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-slag)]/70">{children}</tbody>
      </table>
    </div>
  );
}

/** A monospaced numeric cell. Right-aligned so the digits line up. */
export function Num({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "lava" | "seismic" | "alert" | undefined;
}) {
  const toneClass = tone
    ? tone === "lava"
      ? "text-[var(--color-lava)]"
      : tone === "seismic"
        ? "text-[var(--color-seismic)]"
        : "text-[var(--color-alert)]"
    : "text-[var(--color-ash-muted)]";
  return (
    <td
      className={cx(
        "px-3 py-2 text-right font-[family-name:var(--font-mono)] tabular-nums",
        toneClass,
      )}
    >
      {children}
    </td>
  );
}

/** A text cell in a data table. */
export function Cell({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <td
      className={cx(
        "px-3 py-2 text-[var(--color-ash-muted)]",
        strong && "font-medium text-[var(--color-ash)]",
      )}
    >
      {children}
    </td>
  );
}

export { cx as classNames };
