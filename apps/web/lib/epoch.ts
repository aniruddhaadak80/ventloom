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

/** A rejected epoch, carrying the reason so an API can explain itself. */
export type EpochRejection = { ok: false; error: string; received: string };

/** An accepted epoch. */
export type EpochAcceptance = { ok: true; epochS: number; timestampIso: string };

/** Resolve an epoch to the ISO timestamp it names. */
export function epochToIso(epochS: number): string {
  return new Date(WORLD_EPOCH_MS + epochS * 1000).toISOString();
}

/** Pull the raw `epoch` parameter out of a URLSearchParams-like input. */
function rawEpochOf(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = params instanceof URLSearchParams ? params.get("epoch") : params.epoch;
  const text = Array.isArray(raw) ? raw[0] : raw;
  return text === undefined || text === null || text === "" ? undefined : text;
}

/**
 * Parse, validate and clamp an epoch out of a URLSearchParams-like input.
 *
 * Clamping rather than rejecting is the right behaviour for a rendered
 * surface: a hand-typed `?epoch=99999999999` should still show a volcano
 * rather than an error card. It is the wrong behaviour for an API, which is
 * why `acceptEpoch` exists alongside this.
 */
export function readEpoch(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): EpochRange {
  const text = rawEpochOf(params);
  const parsed = text === undefined ? Number.NaN : Number(text);
  const safe = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.round(parsed), 0), MAX_EPOCH_S)
    : DEFAULT_EPOCH_S;
  return { epochS: safe, timestampIso: epochToIso(safe) };
}

/**
 * Strict epoch validation for the API surface.
 *
 * The difference from `readEpoch` is not cosmetic. An API that silently clamps
 * hands back the same bytes for `/network?epoch=1` and `/network?epoch=99999999999`,
 * and those two routes both ship `Cache-Control: immutable`. A CDN is then
 * entitled to serve one URL's answer under the other's key, and the promise
 * that "the URL is the whole of the state" quietly stops being true. Rejecting
 * keeps the cache honest; clamping does not.
 *
 * A missing epoch is still not an error. The default is part of the contract,
 * not a user mistake.
 */
export function acceptEpoch(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): EpochAcceptance | EpochRejection {
  const text = rawEpochOf(params);
  if (text === undefined) {
    return { ok: true, epochS: DEFAULT_EPOCH_S, timestampIso: epochToIso(DEFAULT_EPOCH_S) };
  }

  // `Number` accepts "0x1f", "1e3", " 12 " and "Infinity". Only a plain
  // non-negative integer is a well-formed epoch, so the syntax is checked
  // before the value is.
  if (!/^\d+$/.test(text.trim())) {
    return {
      ok: false,
      error: `epoch must be a whole number of seconds, received "${text}"`,
      received: text,
    };
  }

  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, error: "epoch is too large to represent exactly", received: text };
  }
  if (parsed > MAX_EPOCH_S) {
    return {
      ok: false,
      error: `epoch ${parsed}s exceeds the seeded horizon of ${MAX_EPOCH_S}s (${MAX_EPOCH_S / SECONDS_PER_DAY} days)`,
      received: text,
    };
  }

  return { ok: true, epochS: parsed, timestampIso: epochToIso(parsed) };
}

/** A human description of where in the seeded world an epoch sits. */
export function describeEpoch(epochS: number): string {
  return `day ${Math.floor(epochS / SECONDS_PER_DAY)} of the seeded world`;
}
