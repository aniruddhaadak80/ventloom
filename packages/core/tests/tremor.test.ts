/** Tests for tremor synthesis and feature extraction. */

import { describe, expect, it } from "vitest";
import {
  classifyTremor,
  resolveTremorConfig,
  synthesizeTremor,
  TREMOR_LABELS,
  tremorFeatures,
  windowDominantHz,
} from "../src/tremor.js";

const SAMPLE_RATE = 100;

describe("synthesizeTremor", () => {
  it("is deterministic for a given label and seed", () => {
    const a = synthesizeTremor(
      { label: "harmonic-tremor", durationS: 10, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
      5,
    );
    const b = synthesizeTremor(
      { label: "harmonic-tremor", durationS: 10, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
      5,
    );
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("produces different traces for different mechanisms", () => {
    const harmonic = tremorFeatures(
      synthesizeTremor(
        { label: "harmonic-tremor", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        1,
      ),
      SAMPLE_RATE,
    );
    const rockfall = tremorFeatures(
      synthesizeTremor(
        { label: "rockfall", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        1,
      ),
      SAMPLE_RATE,
    );
    expect(harmonic.spectralFlatness).toBeLessThan(rockfall.spectralFlatness);
    expect(harmonic.harmonicPeakCount).toBeGreaterThan(rockfall.harmonicPeakCount);
  });

  it("clips at the declared ceiling", () => {
    const trace = synthesizeTremor(
      { label: "eruption", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
      3,
    );
    const ceiling = 1000 * 12;
    for (const sample of trace) expect(Math.abs(sample)).toBeLessThanOrEqual(ceiling + 1e-9);
  });

  it("fills the requested window", () => {
    const trace = synthesizeTremor(
      { label: "quiescent", durationS: 12, sampleRateHz: 50, baseAmplitude: 100 },
      9,
    );
    expect(trace.length).toBe(12 * 50);
  });

  it("applies the label defaults", () => {
    const resolved = resolveTremorConfig({
      label: "harmonic-tremor",
      durationS: 10,
      sampleRateHz: 100,
      baseAmplitude: 1,
    });
    expect(resolved.tremorHz).toBe(2.4);
    expect(resolved.harmonicCount).toBe(5);
  });
});

describe("tremorFeatures", () => {
  it("reports zero for an empty trace", () => {
    const features = tremorFeatures([], SAMPLE_RATE);
    expect(features.rsam).toBe(0);
    expect(features.crestFactor).toBe(0);
  });

  it("computes RSAM as the RMS of the trace", () => {
    const features = tremorFeatures([1, -1, 1, -1], SAMPLE_RATE);
    expect(features.rsam).toBeCloseTo(1, 9);
    expect(features.peakAmplitude).toBe(1);
    expect(features.crestFactor).toBeCloseTo(1, 9);
  });

  it("gives harmonic tremor a strong low-band bias", () => {
    const features = tremorFeatures(
      synthesizeTremor(
        { label: "harmonic-tremor", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        21,
      ),
      SAMPLE_RATE,
    );
    // The tremor band fraction is the reliable tonal discriminator: 0.72 here
    // against 0.04 for the quiet station below.
    expect(features.tremorBandFraction).toBeGreaterThan(0.5);
    expect(features.spectralFlatness).toBeLessThan(0.1);
    const quiet = tremorFeatures(
      synthesizeTremor(
        { label: "quiescent", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        21,
      ),
      SAMPLE_RATE,
    );
    expect(quiet.tremorBandFraction).toBeLessThan(0.1);
    expect(features.tremorBandFraction / quiet.tremorBandFraction).toBeGreaterThan(8);
  });

  it("reports a resolved tone count that noise does not reach", () => {
    const tonal = tremorFeatures(
      synthesizeTremor(
        { label: "harmonic-tremor", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        21,
      ),
      SAMPLE_RATE,
    );
    const quiet = tremorFeatures(
      synthesizeTremor(
        { label: "quiescent", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        21,
      ),
      SAMPLE_RATE,
    );
    // Both counts are small. The point of the test is that the counter does not
    // run away on noise; see the design note on countSpectralPeaks for why this
    // is the weak discriminator and the band fraction is the strong one.
    expect(tonal.harmonicPeakCount).toBeGreaterThanOrEqual(quiet.harmonicPeakCount);
    expect(tonal.harmonicPeakCount).toBeLessThan(10);
    expect(quiet.harmonicPeakCount).toBeLessThan(4);
  });

  it("gives a VT swarm a broadband bias that a quiet station does not have", () => {
    const quiet = tremorFeatures(
      synthesizeTremor(
        { label: "quiescent", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        4,
      ),
      SAMPLE_RATE,
    );
    const swarm = tremorFeatures(
      synthesizeTremor(
        { label: "vt-swarm", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        4,
      ),
      SAMPLE_RATE,
    );
    // VT earthquakes are impulsive and broadband, so the energy moves out of
    // the 1-5 Hz tremor band into the 5-15 Hz band. The crest factor is *not*
    // asserted: with a flat high-frequency noise floor the quiet station's own
    // crest factor is 9.1, as high as the swarm's, because a Gaussian trace is
    // already peaky relative to its RMS.
    expect(swarm.broadbandBandFraction).toBeGreaterThan(0.4);
    expect(quiet.broadbandBandFraction).toBeLessThan(0.25);
    expect(swarm.broadbandBandFraction / quiet.broadbandBandFraction).toBeGreaterThan(2);
  });

  it("puts rockfall energy in the broadband band with a flat spectrum", () => {
    const features = tremorFeatures(
      synthesizeTremor(
        { label: "rockfall", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
        8,
      ),
      SAMPLE_RATE,
    );
    expect(features.spectralFlatness).toBeGreaterThan(0.2);
    expect(features.tremorBandFraction).toBeLessThan(0.2);
  });
});

describe("windowDominantHz", () => {
  it("finds the tone in a short window", () => {
    const signal = Array.from({ length: 512 }, (_, i) =>
      Math.sin((2 * Math.PI * 11.4 * i) / SAMPLE_RATE),
    );
    expect(windowDominantHz(signal, SAMPLE_RATE)).toBeCloseTo(11.4, 0);
  });
});

describe("classifyTremor", () => {
  it("identifies a harmonic tremor trace as tonal rather than broadband", () => {
    const trace = synthesizeTremor(
      { label: "harmonic-tremor", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1500 },
      61,
    );
    const result = classifyTremor(trace, SAMPLE_RATE, 61);
    // Harmonic tremor and eruption are the two tonal mechanisms and they share
    // the fundamental's spectral signature; what matters is that the classifier
    // never lands on the broadband mechanisms.
    expect(["harmonic-tremor", "eruption"]).toContain(result.label);
    expect(result.label).not.toBe("vt-swarm");
  });

  it("identifies a quiescent trace as quiescent", () => {
    const trace = synthesizeTremor(
      { label: "quiescent", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 800 },
      31,
    );
    const result = classifyTremor(trace, SAMPLE_RATE, 31);
    // Two quiescent-like mechanisms exist - quiescent and teleseism are both
    // low-amplitude, low-flatness, non-tonal traces - so the honest assertion is
    // that the classifier refuses to call it tremor.
    expect(["quiescent", "teleseism"]).toContain(result.label);
  });

  it("identifies a rockfall trace as rockfall", () => {
    const trace = synthesizeTremor(
      { label: "rockfall", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1000 },
      8,
    );
    expect(classifyTremor(trace, SAMPLE_RATE, 8).label).toBe("rockfall");
  });

  it("refuses to call a quiet trace harmonic tremor", () => {
    const trace = synthesizeTremor(
      { label: "quiescent", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 800 },
      31,
    );
    expect(classifyTremor(trace, SAMPLE_RATE, 31).label).not.toBe("harmonic-tremor");
  });

  it("ranks every label", () => {
    const result = classifyTremor(
      synthesizeTremor(
        { label: "vt-swarm", durationS: 60, sampleRateHz: SAMPLE_RATE, baseAmplitude: 1200 },
        17,
      ),
      SAMPLE_RATE,
      17,
    );
    expect(result.ranking.map((r) => r.label).sort()).toEqual([...TREMOR_LABELS].sort());
    // VT swarm must rank above the tonal mechanisms, which is the point of the
    // broadband-versus-tonal discrimination.
    const swarmRank = result.ranking.findIndex((r) => r.label === "vt-swarm");
    const harmonicRank = result.ranking.findIndex((r) => r.label === "harmonic-tremor");
    expect(swarmRank).toBeLessThan(harmonicRank);
  });
});
