/**
 * Shared helpers for shaping the seed world into numbers the UI can print.
 *
 * All of these are pure functions; the app never computes a value that is not
 * reproducible from `(volcano, epoch)`.
 */

import { SECONDS_PER_DAY } from "@repo/core";

/** Fixed-point formatting with a unit, for a value in metres. */
export function metres(value: number, digits = 2): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(digits)} km`;
  return `${value.toFixed(digits)} m`;
}

/** Format a volume in the most readable unit. */
export function volume(m3: number): string {
  const abs = Math.abs(m3);
  if (abs >= 1e9) return `${(m3 / 1e9).toFixed(2)} km³`;
  if (abs >= 1e6) return `${(m3 / 1e6).toFixed(2)} Mm³`;
  return `${m3.toFixed(0)} m³`;
}

/** Format a rate in m³/day. */
export function rate(m3PerDay: number): string {
  return `${(m3PerDay / 1e6).toFixed(3)} Mm³/day`;
}

/** Format a displacement in millimetres, which is how geodesy is reported. */
export function millimetres(value: number): string {
  return `${(value * 1000).toFixed(1)} mm`;
}

/** Format a frequency in hertz. */
export function hertz(value: number): string {
  return `${value.toFixed(2)} Hz`;
}

/** Format a dimensionless ratio. */
export function ratio(value: number): string {
  return `${value.toFixed(2)}×`;
}

/** Days since the world epoch, for display. */
export function daysIn(epochS: number): number {
  return Math.floor(epochS / SECONDS_PER_DAY);
}

/** A bar of the alert level, as a confidence fraction in [0, 1]. */
export function levelFraction(level: "NORMAL" | "ADVISORY" | "WATCH" | "WARNING"): number {
  return { NORMAL: 0.25, ADVISORY: 0.5, WATCH: 0.75, WARNING: 1 }[level];
}
