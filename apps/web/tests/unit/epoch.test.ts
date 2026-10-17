import { SECONDS_PER_DAY } from "@repo/core";
import { describe, expect, it } from "vitest";
import {
  acceptEpoch,
  DEFAULT_EPOCH_S,
  describeEpoch,
  MAX_EPOCH_S,
  readEpoch,
} from "../../lib/epoch";

/**
 * Two parsers, two contracts.
 *
 * `readEpoch` clamps because a rendered surface must never show an error card
 * for a hand-typed query string. `acceptEpoch` rejects because the API ships
 * `Cache-Control: immutable`, and an API that silently clamps would hand the
 * same bytes to two different cache keys.
 *
 * Every test below exists to keep those two from drifting into each other.
 */

describe("acceptEpoch", () => {
  it("defaults when the epoch is absent", () => {
    const result = acceptEpoch(new URLSearchParams("volcano=kilauea"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.epochS).toBe(DEFAULT_EPOCH_S);
  });

  it("defaults when the epoch is an empty string", () => {
    expect(acceptEpoch(new URLSearchParams("epoch=")).ok).toBe(true);
  });

  it("accepts the exact horizon", () => {
    const result = acceptEpoch(new URLSearchParams(`epoch=${MAX_EPOCH_S}`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.epochS).toBe(MAX_EPOCH_S);
  });

  it("accepts zero", () => {
    const result = acceptEpoch(new URLSearchParams("epoch=0"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.epochS).toBe(0);
  });

  // The bug this replaced: the API clamped and then claimed `immutable`.
  it("rejects an epoch past the horizon rather than clamping it", () => {
    const result = acceptEpoch(new URLSearchParams(`epoch=${MAX_EPOCH_S + 1}`));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("exceeds the seeded horizon");
  });

  it.each([
    ["99999999999", "a plain out-of-range integer"],
    ["1e3", "scientific notation"],
    ["0x1f", "hexadecimal"],
    ["-1", "a negative epoch"],
    ["1.5", "a fractional epoch"],
    ["abc", "a non-numeric epoch"],
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
    [" 12 34 ", "two numbers separated by spaces"],
  ])("rejects %s (%s)", (value) => {
    expect(acceptEpoch(new URLSearchParams(`epoch=${value}`)).ok).toBe(false);
  });

  it("accepts a padded integer, because a URLSearchParams value is user input", () => {
    const result = acceptEpoch(new URLSearchParams("epoch=%2012%20"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.epochS).toBe(12);
  });

  it("rejects an integer beyond safe precision", () => {
    expect(acceptEpoch(new URLSearchParams("epoch=99999999999999999999")).ok).toBe(false);
  });

  it("keeps distinct epochs distinct, which is what an immutable cache requires", () => {
    // Under the old clamping parser these two URLs produced byte-identical
    // responses while both advertising `immutable`, so a CDN was entitled to
    // serve one under the other's key. One accepted and one rejected is the
    // only way the claim survives.
    const one = acceptEpoch(new URLSearchParams("epoch=1"));
    const big = acceptEpoch(new URLSearchParams("epoch=99999999999"));
    expect(one.ok).toBe(true);
    expect(big.ok).toBe(false);
  });

  it("never maps two accepted epochs onto the same value", () => {
    const seen = new Set<number>();
    for (let day = 0; day <= 365; day++) {
      const result = acceptEpoch(new URLSearchParams(`epoch=${day * SECONDS_PER_DAY}`));
      if (!result.ok) throw new Error(`day ${day} should be accepted`);
      expect(seen.has(result.epochS)).toBe(false);
      seen.add(result.epochS);
    }
    expect(seen.size).toBe(366);
  });
});

describe("readEpoch", () => {
  it("clamps above the horizon so a page never shows an error card", () => {
    expect(readEpoch(new URLSearchParams(`epoch=${MAX_EPOCH_S + 1}`)).epochS).toBe(MAX_EPOCH_S);
  });

  it("clamps below zero", () => {
    expect(readEpoch(new URLSearchParams("epoch=-500")).epochS).toBe(0);
  });

  it("falls back to the default for garbage", () => {
    expect(readEpoch(new URLSearchParams("epoch=banana")).epochS).toBe(DEFAULT_EPOCH_S);
  });

  it("agrees with acceptEpoch on every epoch it accepts", () => {
    for (const value of ["0", "1", "86400", String(MAX_EPOCH_S)]) {
      const strict = acceptEpoch(new URLSearchParams(`epoch=${value}`));
      const loose = readEpoch(new URLSearchParams(`epoch=${value}`));
      expect(strict.ok).toBe(true);
      if (!strict.ok) return;
      expect(loose.epochS).toBe(strict.epochS);
      expect(loose.timestampIso).toBe(strict.timestampIso);
    }
  });

  it("reads a Record as well as a URLSearchParams", () => {
    expect(readEpoch({ epoch: "120" }).epochS).toBe(120);
    expect(readEpoch({ epoch: ["120", "240"] }).epochS).toBe(120);
  });
});

describe("describeEpoch", () => {
  it("counts days in the seeded world", () => {
    expect(describeEpoch(45 * SECONDS_PER_DAY)).toBe("day 45 of the seeded world");
    expect(describeEpoch(0)).toBe("day 0 of the seeded world");
  });
});
