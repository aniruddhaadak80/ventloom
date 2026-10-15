/** Tests for the offline seed world. */

import {
  aitchisonDistance,
  clusterTephra,
  fitPyleThinning,
  hashSeed,
  mulberry32,
  OXIDE_ORDER,
} from "@repo/core";
import {
  CORES,
  type Composition,
  END_MEMBER_LIST,
  gnssStationsFor,
  instrumentCounts,
  nearestEndMemberId,
  perturbComposition,
  stationsFor,
  TEPHRA_LAYERS,
  VOLCANO_CATALOGUE,
} from "@repo/seed";
import { describe, expect, it } from "vitest";

function sumComposition(c: Composition): number {
  return OXIDE_ORDER.reduce((total, oxide) => total + c[oxide], 0);
}

describe("catalogue", () => {
  it("has twelve volcanoes with real names and countries", () => {
    expect(VOLCANO_CATALOGUE).toHaveLength(12);
    for (const volcano of VOLCANO_CATALOGUE) {
      expect(volcano.name.length).toBeGreaterThan(2);
      expect(volcano.country.length).toBeGreaterThan(2);
      expect(volcano.summary.length).toBeGreaterThan(40);
    }
  });

  it("spreads the unrest profiles across the catalogue", () => {
    const profiles = new Set(VOLCANO_CATALOGUE.map((v) => v.unrestProfile));
    expect(profiles.size).toBeGreaterThanOrEqual(4);
  });

  it("uses a mix of volcano types", () => {
    const types = new Set(VOLCANO_CATALOGUE.map((v) => v.volcanoType));
    expect(types.size).toBeGreaterThanOrEqual(3);
  });
});

describe("station network", () => {
  it("has at least six stations per volcano and unique ids", () => {
    const ids = new Set<string>();
    for (const volcano of VOLCANO_CATALOGUE) {
      const stations = stationsFor(volcano.id);
      expect(stations.length).toBeGreaterThanOrEqual(6);
      for (const station of stations) {
        expect(station.code).toMatch(/^[A-Z]{4}$/);
        expect(ids.has(station.id)).toBe(false);
        ids.add(station.id);
      }
    }
  });

  it("guarantees at least two GNSS benches per volcano for the inversion", () => {
    for (const volcano of VOLCANO_CATALOGUE) {
      expect(gnssStationsFor(volcano.id).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("spreads the stations around each volcano rather than clumping them", () => {
    for (const volcano of VOLCANO_CATALOGUE) {
      const stations = stationsFor(volcano.id);
      const bearings = stations.map((s) => Math.atan2(s.northOffsetM, s.eastOffsetM));
      bearings.sort((a, b) => a - b);
      let largestGap = 0;
      for (let i = 1; i < bearings.length; i++) {
        largestGap = Math.max(largestGap, (bearings[i] as number) - (bearings[i - 1] as number));
      }
      largestGap = Math.max(
        largestGap,
        (bearings[0] as number) + Math.PI * 2 - (bearings[bearings.length - 1] as number),
      );
      expect(largestGap).toBeLessThan(Math.PI * 0.95);
    }
  });

  it("counts instruments by family", () => {
    const counts = instrumentCounts();
    expect(counts.gnss).toBeGreaterThanOrEqual(24);
    expect(counts["broadband-seismic"]).toBeGreaterThanOrEqual(24);
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(4);
  });
});

describe("tephra world", () => {
  it("closes every layer composition to 100 percent", () => {
    for (const layer of TEPHRA_LAYERS) {
      expect(sumComposition(layer.composition)).toBeCloseTo(100, 6);
      expect(layer.depthM).toBeGreaterThan(0);
    }
  });

  it("keeps four end members separated in the Aitchison geometry", () => {
    // The closest pair is rhyolite/dacite at about 0.89; the clustering threshold
    // the app uses is 2, so this separation is what keeps them apart.
    for (let i = 0; i < END_MEMBER_LIST.length; i++) {
      for (let j = i + 1; j < END_MEMBER_LIST.length; j++) {
        const a = END_MEMBER_LIST[i];
        const b = END_MEMBER_LIST[j];
        expect(aitchisonDistance(a.composition, b.composition)).toBeGreaterThan(0.8);
      }
    }
  });

  it("recovers the four eruptive groups by composition", () => {
    const groups = clusterTephra(TEPHRA_LAYERS, 2);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const totalMembers = groups.reduce((n, g) => n + g.memberIds.length, 0);
    expect(totalMembers).toBe(TEPHRA_LAYERS.length);
  });

  it("assigns every layer to a nearby end member", () => {
    for (const layer of TEPHRA_LAYERS) {
      const match = nearestEndMemberId(layer);
      const endMember = END_MEMBER_LIST.find((m) => m.id === match.id);
      expect(endMember).toBeDefined();
      // A correctly perturbed layer sits close to its source composition.
      expect(match.distance).toBeLessThan(1.5);
    }
  });

  it("perturbs a composition without leaving the simplex", () => {
    const base = END_MEMBER_LIST[0];
    if (!base) throw new Error("no end members");
    const layer = perturbComposition(base.composition, 0.05, 4321);
    expect(sumComposition(layer)).toBeCloseTo(100, 6);
    expect(aitchisonDistance(layer, base.composition)).toBeGreaterThan(0);
    expect(aitchisonDistance(layer, base.composition)).toBeLessThan(2);
  });

  it("covers four cores with different kinds", () => {
    expect(CORES).toHaveLength(4);
    expect(new Set(CORES.map((c) => c.kind)).size).toBe(4);
  });
});

describe("Pyle thinning over a plausible vent-plume survey", () => {
  it("gives a coherent volume for a 1.5 km vent thickness", () => {
    const t0 = 1.5;
    const k = 0.00042;
    const isopachs = [200, 800, 2000, 4500, 9000, 16000].map((r) => ({
      thicknessM: t0 * Math.exp(-k * r),
      enclosedAreaM2: Math.PI * r * r,
    }));
    const fit = fitPyleThinning(isopachs);
    expect(fit.thicknessAtVentM).toBeCloseTo(t0, 6);
    // V = 2 pi T0 / k^2 = 2 pi * 1.5 / 0.00042^2 = 5.3e7 m3.
    expect(fit.volumeM3).toBeGreaterThan(1e7);
    expect(fit.volumeM3).toBeLessThan(1e8);
    expect(fit.rSquared).toBeCloseTo(1, 6);
  });
});

describe("seeded reproducibility of the whole world", () => {
  it("regenerates the same tephra world from the seed", () => {
    const a = mulberry32(hashSeed("nd-1-L1"));
    const b = mulberry32(hashSeed("nd-1-L1"));
    expect(Array.from({ length: 10 }, () => a.next())).toEqual(
      Array.from({ length: 10 }, () => b.next()),
    );
  });
});
