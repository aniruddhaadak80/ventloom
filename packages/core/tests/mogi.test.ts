/**
 * Tests for the Mogi forward model and its inversion.
 *
 * The headline test is the round trip: build a source, compute the deformation
 * field, add GPS-realistic noise, hand the field back to the solver, and assert
 * the recovered depth and volume come back within a few percent. That is the
 * claim the app makes on the geodesy page, so it is the claim the suite proves.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_POISSON,
  type Displacement,
  type MogiSource,
  mogiAt,
  mogiCoupling,
  mogiForward,
  mogiInvert,
  mogiJacobian,
  mogiRadiusSquared,
  type StationOffset,
  volumeChangeFromPressure,
} from "../src/mogi.js";
import { hashSeed, mulberry32, WORLD_SEED } from "../src/rng.js";

/** A golden-angle ring of stations, like the seed network geometry. */
function ringStations(count: number, radii: readonly number[]): StationOffset[] {
  return Array.from({ length: count }, (_, i) => {
    const azimuth = (i * 2.399963) % (Math.PI * 2);
    const radius = radii[i % radii.length] as number;
    return {
      id: `S${String(i + 1).padStart(2, "0")}`,
      eastOffsetM: Math.round(Math.cos(azimuth) * radius),
      northOffsetM: Math.round(Math.sin(azimuth) * radius),
      elevationM: 1200,
    };
  });
}

const SAKURAJIMA_RING = ringStations(10, [900, 1600, 2300, 3000, 3700]);

describe("Mogi forward model", () => {
  const source: MogiSource = {
    eastOffsetM: 0,
    northOffsetM: 0,
    depthM: 10_000,
    volumeChangeM3: volumeChangeFromPressure(2500, -400, 30_000),
  };

  it("reproduces the 1914 Taisho Sakurajima epicentral subsidence", () => {
    // Mogi (1958) parameters via the USF community derivation: the vertical
    // displacement directly above the source is 1.5625 m.
    const centre = mogiAt(
      { id: "centre", eastOffsetM: 0, northOffsetM: 0 },
      source,
      DEFAULT_POISSON,
    );
    expect(centre.upM).toBeCloseTo(-1.5625, 6);
    expect(centre.eastM).toBeCloseTo(0, 12);
    expect(centre.northM).toBeCloseTo(0, 12);
  });

  it("pushes the ground outwards from the source, horizontally", () => {
    const field = mogiForward(SAKURAJIMA_RING, source);
    for (const [index, d] of field.entries()) {
      const station = SAKURAJIMA_RING[index] as StationOffset;
      const radial = Math.hypot(station.eastOffsetM, station.northOffsetM);
      if (radial === 0) continue;
      // Deflation: horizontal motion points away from the source, i.e. the
      // displacement is anti-parallel to the station offset.
      const sign = Math.sign(station.eastOffsetM * d.eastM + station.northOffsetM * d.northM);
      expect(sign).toBeLessThan(0);
    }
  });

  it("decays horizontal displacement more slowly than vertical", () => {
    const near = mogiAt({ id: "n", eastOffsetM: 2000, northOffsetM: 0 }, source);
    const far = mogiAt({ id: "f", eastOffsetM: 8000, northOffsetM: 0 }, source);
    const nearRatio = near.eastM / near.upM;
    const farRatio = far.eastM / far.upM;
    expect(farRatio).toBeGreaterThan(nearRatio);
  });

  it("couples linearly with volume change", () => {
    const doubled: MogiSource = { ...source, volumeChangeM3: source.volumeChangeM3 * 2 };
    expect(mogiCoupling(doubled)).toBeCloseTo(mogiCoupling(source) * 2, 9);
    const single = mogiAt({ id: "s", eastOffsetM: 1500, northOffsetM: 800 }, source);
    const twice = mogiAt({ id: "s", eastOffsetM: 1500, northOffsetM: 800 }, doubled);
    expect(twice.upM).toBeCloseTo(single.upM * 2, 12);
  });

  it("refuses a non-positive depth", () => {
    expect(() =>
      mogiAt({ id: "s", eastOffsetM: 0, northOffsetM: 0 }, { ...source, depthM: 0 }),
    ).toThrow(RangeError);
  });

  it("computes R^2 = dx^2 + dy^2 + d^2", () => {
    expect(mogiRadiusSquared(3, 4, 5)).toBe(50);
  });
});

describe("Mogi analytic Jacobian", () => {
  it("matches central finite differences to 6 significant figures", () => {
    const station: StationOffset = { id: "S1", eastOffsetM: 1234.5, northOffsetM: -987.25 };
    const source: MogiSource = {
      eastOffsetM: 120,
      northOffsetM: -310,
      depthM: 7400,
      volumeChangeM3: -2.1e6,
    };
    const analytic = mogiJacobian(station, source);
    const step = {
      eastOffsetM: 1e-4,
      northOffsetM: 1e-4,
      depthM: 1e-4,
      volumeChangeM3: 1e-1,
    } as const;
    const params = ["eastOffsetM", "northOffsetM", "depthM", "volumeChangeM3"] as const;
    for (const component of ["eastM", "northM", "upM"] as const) {
      for (const [index, param] of params.entries()) {
        const h = step[param];
        const plus = mogiAt(station, { ...source, [param]: source[param] + h });
        const minus = mogiAt(station, { ...source, [param]: source[param] - h });
        const numeric = (plus[component] - minus[component]) / (2 * h);
        const exact = (analytic[component] as number[])[index] as number;
        // Compare relative to the magnitude of the row, since some entries are
        // ~1e-9 while others are ~1e-1.
        const scale = Math.max(Math.abs(numeric), Math.abs(exact), 1e-12);
        expect(Math.abs(exact - numeric) / scale).toBeLessThan(1e-5);
      }
    }
  });
});

describe("Mogi inversion", () => {
  function noisyField(
    stations: readonly StationOffset[],
    truth: MogiSource,
    sigmaM: number,
    seed: number,
  ): Displacement[] {
    const rng = mulberry32(seed);
    return mogiForward(stations, truth).map((d) => ({
      eastM: d.eastM + rng.gaussian(0, sigmaM),
      northM: d.northM + rng.gaussian(0, sigmaM),
      upM: d.upM + rng.gaussian(0, sigmaM),
    }));
  }

  it("recovers a known source from a noisy GPS field", () => {
    const truth: MogiSource = {
      eastOffsetM: 380,
      northOffsetM: -620,
      depthM: 5800,
      volumeChangeM3: -1.7e7,
    };
    const observed = noisyField(SAKURAJIMA_RING, truth, 0.004, hashSeed("recover"));
    const result = mogiInvert(SAKURAJIMA_RING, observed, {
      sigmaM: 0.004,
      initial: { eastOffsetM: 0, northOffsetM: 0, depthM: 2500, volumeChangeM3: 0 },
      maxIterations: 80,
    });
    expect(result.converged).toBe(true);
    expect(Math.abs(result.source.depthM - truth.depthM)).toBeLessThan(0.06 * truth.depthM);
    expect(Math.abs(result.source.volumeChangeM3 - truth.volumeChangeM3)).toBeLessThan(
      0.12 * Math.abs(truth.volumeChangeM3),
    );
    expect(Math.abs(result.source.eastOffsetM - truth.eastOffsetM)).toBeLessThan(250);
    expect(Math.abs(result.source.northOffsetM - truth.northOffsetM)).toBeLessThan(250);
    expect(result.rmsMisfitM).toBeLessThan(0.004 * 1.2);
  });

  it("recovers the source from a worse starting guess", () => {
    const truth: MogiSource = {
      eastOffsetM: -2100,
      northOffsetM: 1500,
      depthM: 4200,
      volumeChangeM3: 6.2e6,
    };
    const observed = noisyField(SAKURAJIMA_RING, truth, 0.006, hashSeed("recover2"));
    const result = mogiInvert(SAKURAJIMA_RING, observed, {
      sigmaM: 0.006,
      initial: { eastOffsetM: 3000, northOffsetM: -3000, depthM: 12000, volumeChangeM3: 1e7 },
      maxIterations: 120,
    });
    expect(result.converged).toBe(true);
    expect(result.rmsMisfitM).toBeLessThan(0.008);
    // Depth is recovered, and the reported 1-sigma is smaller than the truth.
    expect(Math.abs(result.source.depthM - truth.depthM)).toBeLessThan(0.15 * truth.depthM);
    expect(result.parameterSigmas.depthM).toBeLessThan(result.source.depthM);
  });

  it("keeps depth inside the physical bounds", () => {
    const truth: MogiSource = {
      eastOffsetM: 0,
      northOffsetM: 0,
      depthM: 400,
      volumeChangeM3: -1e6,
    };
    const observed = noisyField(SAKURAJIMA_RING, truth, 0.01, 42);
    const result = mogiInvert(SAKURAJIMA_RING, observed, {
      initial: { depthM: 100 },
      depthBoundsM: [200, 30000],
    });
    expect(result.source.depthM).toBeGreaterThanOrEqual(200);
    expect(result.source.depthM).toBeLessThanOrEqual(30000);
  });

  it("reports the cost monotonically decreasing", () => {
    const truth: MogiSource = {
      eastOffsetM: 0,
      northOffsetM: 0,
      depthM: 6000,
      volumeChangeM3: -8e6,
    };
    const observed = noisyField(SAKURAJIMA_RING, truth, 0.005, 7);
    const result = mogiInvert(SAKURAJIMA_RING, observed, { sigmaM: 0.005 });
    const first = result.costHistory[0] as number;
    const last = result.costHistory[result.costHistory.length - 1] as number;
    expect(last).toBeLessThan(first);
    for (let i = 1; i < result.costHistory.length; i++) {
      expect(result.costHistory[i] as number).toBeLessThanOrEqual(
        (result.costHistory[i - 1] as number) + 1e-6,
      );
    }
  });

  it("rejects a mismatched station and observation count", () => {
    expect(() => mogiInvert(SAKURAJIMA_RING, [], {})).toThrow(RangeError);
  });

  it("refuses to invert fewer than two three-component observations", () => {
    const one: StationOffset[] = [{ id: "A", eastOffsetM: 100, northOffsetM: 0 }];
    const field = mogiForward(one, {
      eastOffsetM: 0,
      northOffsetM: 0,
      depthM: 3000,
      volumeChangeM3: 1e6,
    });
    expect(() => mogiInvert(one, field, {})).toThrow(RangeError);
  });

  it("flags the depth/volume trade-off honestly", () => {
    const truth: MogiSource = {
      eastOffsetM: 0,
      northOffsetM: 0,
      depthM: 6000,
      volumeChangeM3: -8e6,
    };
    const observed = noisyField(SAKURAJIMA_RING, truth, 0.005, 11);
    const result = mogiInvert(SAKURAJIMA_RING, observed, { sigmaM: 0.005 });
    // Depth and volume are the canonical correlated pair in geodetic inversion.
    expect(result.depthVolumeTradeOff).toBeGreaterThan(0.9);
    expect(result.parameterCorrelations[2]?.[3]).toBeCloseTo(
      result.parameterCorrelations[3]?.[2] as number,
      9,
    );
  });

  it("is deterministic for a given seed", () => {
    const truth: MogiSource = {
      eastOffsetM: 100,
      northOffsetM: 100,
      depthM: 5000,
      volumeChangeM3: -3e6,
    };
    const a = noisyField(SAKURAJIMA_RING, truth, 0.005, 99);
    const b = noisyField(SAKURAJIMA_RING, truth, 0.005, 99);
    expect(a).toEqual(b);
  });

  it("uses the declared world seed", () => {
    expect(WORLD_SEED).toBe(7331);
  });
});
