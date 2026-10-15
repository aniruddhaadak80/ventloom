/**
 * The URL-derived epoch.
 *
 * Every page in the observatory is a pure function of the epoch carried in the
 * query string, which is what makes the replay surface honest: scrubbing the
 * clock changes the URL, and the same URL always renders the same observatory.
 * Nothing here reads `Date.now()`.
 */

import { SECONDS_PER_DAY, WORLD_EPOCH_MS } from "@repo/core";

/** The default observatory epoch: 45 days after the world epoch. */
export const DEFAULT_EPOCH_S = 45 * SECONDS_PER_DAY;

/** The widest epoch the replay surface will accept, one seeded year. */
export const MAX_EPOCH_S = 365 * SECONDS_PER_DAY;

export interface EpochRange {
  /** The epoch in seconds, validated and clamped. */
  epochS: number;
  /** The ISO timestamp the epoch resolves to. */
  timestampIso: string;
}

/** Parse, validate and clamp an epoch out of a URLSearchParams-like input. */
export function readEpoch(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): EpochRange {
  const raw = params instanceof URLSearchParams ? params.get("epoch") : params.epoch;
  const text = Array.isArray(raw) ? raw[0] : raw;
  const parsed = text === undefined || text === null || text === "" ? Number.NaN : Number(text);
  const safe = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.round(parsed), 0), MAX_EPOCH_S)
    : DEFAULT_EPOCH_S;
  return {
    epochS: safe,
    timestampIso: new Date(WORLD_EPOCH_MS + safe * 1000).toISOString(),
  };
}

/** A human description of where in the seeded world an epoch sits. */
export function describeEpoch(epochS: number): string {
  return `day ${Math.floor(epochS / SECONDS_PER_DAY)} of the seeded world`;
}
