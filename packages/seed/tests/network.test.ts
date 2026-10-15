/**
 * Tests for the network model and the seeded world.
 *
 * These live in `@repo/seed` rather than `@repo/core` because they exercise the
 * catalogue the core model is parameterised by — the dependency runs one way
 * only, seed → core, with no cycle.
 */

import {
  bearingToDeg,
  distanceToKm,
  mogiForward,
  networkSnapshot,
  SAMPLE_RATE_HZ,
  SECONDS_PER_DAY,
  unrestIndex,
  unrestIndicators,
  volcanoSource,
  WORLD_EPOCH_ISO,
  WORLD_SEED,
} from "@repo/core";
import {
  findVolcano,
  gnssStationsFor,
  STATION_NETWORK,
  stationsFor,
  VOLCANO_CATALOGUE,
} from "@repo/seed";
import { describe, expect, it } from "vitest";

describe("the seed world", () => {
  it("declares a twelve-volcano catalogue with unique ids", () => {
    expect(VOLCANO_CATALOGUE).toHaveLength(12);
    expect(new Set(VOLCANO_CATALOGUE.map((v) => v.id)).size).toBe(12);
  });

  it("keeps every coordinate and elevation in a plausible range", () => {
    for (const volcano of VOLCANO_CATALOGUE) {
      expect(Math.abs(volcano.latitudeDeg)).toBeLessThanOrEqual(90);
      expect(Math.abs(volcano.longitudeDeg)).toBeLessThanOrEqual(180);
      expect(volcano.elevationM).toBeGreaterThan(0);
      expect(volcano.elevationM).toBeLessThan(7000);
    }
  });

  it("gives every volcano a GNSS station so the inversion always has input", () => {
    for (const volcano of VOLCANO_CATALOGUE) {
      expect(gnssStationsFor(volcano.id).length).toBeGreaterThanOrEqual(2);
      expect(stationsFor(volcano.id).length).toBeGreaterThanOrEqual(6);
    }
  });

  it("resolves a volcano by id", () => {
    expect(findVolcano("merapi")?.name).toBe("Merapi");
    expect(findVolcano("atlantis")).toBeUndefined();
  });

  it("declares the world epoch and sampling constants", () => {
    expect(WORLD_EPOCH_ISO).toBe("2026-01-01T00:00:00.000Z");
    expect(SAMPLE_RATE_HZ).toBe(100);
    expect(SECONDS_PER_DAY).toBe(86400);
    expect(WORLD_SEED).toBe(7331);
  });
});

describe("network model", () => {
  const kilauea = findVolcano("kilauea");
  if (!kilauea) throw new Error("kilauea missing from the catalogue");

  it("keeps unrest inside [0, 1] for every epoch", () => {
    for (let epoch = 0; epoch < 60 * SECONDS_PER_DAY; epoch += SECONDS_PER_DAY / 4) {
      const value = unrestIndex(kilauea, epoch);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("is a pure function of the epoch — the time machine's contract", () => {
    const a = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, 5 * SECONDS_PER_DAY);
    const b = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, 5 * SECONDS_PER_DAY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a different observatory at a different epoch", () => {
    const early = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, 0);
    const later = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, 30 * SECONDS_PER_DAY);
    expect(JSON.stringify(early)).not.toBe(JSON.stringify(later));
  });

  it("keeps the Mogi source physical", () => {
    for (let epoch = 0; epoch < 90 * SECONDS_PER_DAY; epoch += SECONDS_PER_DAY) {
      const source = volcanoSource(kilauea, epoch);
      expect(source.depthM).toBeGreaterThan(0);
      expect(Number.isFinite(source.volumeChangeM3)).toBe(true);
      expect(Number.isFinite(source.eastOffsetM)).toBe(true);
      expect(Number.isFinite(source.northOffsetM)).toBe(true);
    }
  });

  it("derives indicators that stay finite and non-negative", () => {
    for (let epoch = 0; epoch < 120 * SECONDS_PER_DAY; epoch += SECONDS_PER_DAY) {
      const indicators = unrestIndicators(kilauea, epoch);
      for (const [key, value] of Object.entries(indicators)) {
        expect(Number.isFinite(value), `${key} at epoch ${epoch}`).toBe(true);
      }
      expect(indicators.so2TonnesPerDay).toBeGreaterThanOrEqual(0);
      expect(indicators.vtEvents24h).toBeGreaterThanOrEqual(0);
      expect(indicators.thermalPixels24h).toBeGreaterThanOrEqual(0);
      expect(indicators.rsamRatio).toBeGreaterThan(0);
    }
  });

  it("reports a GNSS displacement field with real signal in it", () => {
    const snapshot = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, 20 * SECONDS_PER_DAY);
    const volcano = snapshot.volcanoes.find((v) => v.volcano.id === "kilauea");
    if (!volcano) throw new Error("missing snapshot");
    const gnss = volcano.stations.filter((s) => s.station.instrument === "gnss");
    expect(gnss.length).toBeGreaterThan(1);
    const ups = gnss.map((s) => s.displacement.upM);
    expect(Math.max(...ups) - Math.min(...ups)).toBeGreaterThan(1e-4);
  });

  it("agrees with an independent Mogi forward evaluation", () => {
    const snapshot = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, 12 * SECONDS_PER_DAY);
    const volcano = snapshot.volcanoes[0];
    if (!volcano) throw new Error("missing snapshot");
    const expected = mogiForward(gnssStationsFor(volcano.volcano.id), volcano.source);
    const reported = volcano.stations
      .filter((s) => s.station.instrument === "gnss")
      .map((s) => s.displacement);
    reported.forEach((d, i) => {
      expect(d.upM).toBeCloseTo(expected[i]?.upM as number, 9);
      expect(d.eastM).toBeCloseTo(expected[i]?.eastM as number, 9);
      expect(d.northM).toBeCloseTo(expected[i]?.northM as number, 9);
    });
  });

  it("labels the timestamp from the world epoch", () => {
    const snapshot = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, SECONDS_PER_DAY);
    expect(snapshot.timestampIso).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("geodesy helpers", () => {
  const kilauea = findVolcano("kilauea");
  if (!kilauea) throw new Error("kilauea missing from the catalogue");

  it("measures a known great-circle distance", () => {
    expect(distanceToKm(kilauea, kilauea.latitudeDeg, kilauea.longitudeDeg)).toBeCloseTo(0, 6);
    const toSakurajima = distanceToKm(kilauea, 31.591, 130.657);
    expect(toSakurajima).toBeGreaterThan(7000);
    expect(toSakurajima).toBeLessThan(8000);
  });

  it("measures bearings from true north", () => {
    // Precision 0 in toBeCloseTo allows half a degree, which is the resolution
    // of a degree-scale input.
    expect(bearingToDeg(kilauea, kilauea.latitudeDeg, kilauea.longitudeDeg + 1)).toBeCloseTo(90, 0);
    expect(bearingToDeg(kilauea, kilauea.latitudeDeg + 1, kilauea.longitudeDeg)).toBeCloseTo(0, 0);
  });
});
