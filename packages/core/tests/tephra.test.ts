/** Tests for tephra compositional distance and the Pyle thinning fit. */

import { describe, expect, it } from "vitest";
import {
  aitchisonDistance,
  type Composition,
  closeComposition,
  clrTransform,
  clusterTephra,
  compositionSimilarity,
  distanceMatrix,
  fitPyleThinning,
  type Isopach,
  mixingFraction,
  OXIDE_ORDER,
  pyleThicknessAt,
  pyleVolumeNumeric,
  type TephraSample,
} from "../src/tephra.js";

const BASALT: Composition = {
  SiO2: 48.9,
  TiO2: 2.4,
  Al2O3: 13.1,
  Fe2O3: 12.6,
  MnO: 0.2,
  MgO: 8.4,
  CaO: 10.6,
  Na2O: 2.3,
  K2O: 0.42,
  P2O5: 0.28,
};
const RHYOLITE: Composition = {
  SiO2: 75.4,
  TiO2: 0.31,
  Al2O3: 12.8,
  Fe2O3: 3.1,
  MnO: 0.09,
  MgO: 0.34,
  CaO: 1.42,
  Na2O: 3.68,
  K2O: 2.74,
  P2O5: 0.11,
};

describe("closeComposition", () => {
  it("normalises any total to a unit simplex", () => {
    const doubled = Object.fromEntries(OXIDE_ORDER.map((o) => [o, BASALT[o] * 2])) as Composition;
    const closed = closeComposition(doubled);
    const total = OXIDE_ORDER.reduce((sum, o) => sum + closed[o], 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it("replaces zeros without dropping the composition", () => {
    const withZero = { ...BASALT, MgO: 0 };
    const closed = closeComposition(withZero, 0.01);
    expect(closed.MgO).toBeGreaterThan(0);
    const total = OXIDE_ORDER.reduce((sum, o) => sum + closed[o], 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it("refuses an all-zero composition", () => {
    const zeroed = Object.fromEntries(OXIDE_ORDER.map((o) => [o, 0])) as Composition;
    expect(() => closeComposition(zeroed)).toThrow(RangeError);
  });
});

describe("clrTransform", () => {
  it("sums to zero, as a centered transform must", () => {
    const clr = clrTransform(BASALT);
    expect(clr.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
  });

  it("is invariant to the total, since composition is a ratio", () => {
    const halved = Object.fromEntries(OXIDE_ORDER.map((o) => [o, BASALT[o] / 10])) as Composition;
    const a = clrTransform(BASALT);
    const b = clrTransform(halved);
    a.forEach((value, i) => {
      expect(value).toBeCloseTo(b[i] ?? 0, 9);
    });
  });
});

describe("aitchisonDistance", () => {
  it("is zero for a composition against itself", () => {
    expect(aitchisonDistance(BASALT, BASALT)).toBe(0);
  });

  it("separates a basalt from a rhyolite strongly", () => {
    // Basalt-to-rhyolite is roughly the largest distance in a major-oxide
    // simplex; anything much below this means the transform is not separating.
    expect(aitchisonDistance(BASALT, RHYOLITE)).toBeGreaterThan(4);
  });

  it("is invariant to the total, unlike Euclidean distance on wt%", () => {
    const scaled = Object.fromEntries(OXIDE_ORDER.map((o) => [o, BASALT[o] * 3])) as Composition;
    expect(aitchisonDistance(BASALT, scaled)).toBeCloseTo(0, 9);
  });

  it("is symmetric", () => {
    const mid = Object.fromEntries(
      OXIDE_ORDER.map((o) => [o, (BASALT[o] + RHYOLITE[o]) / 2]),
    ) as Composition;
    expect(aitchisonDistance(BASALT, mid)).toBeCloseTo(aitchisonDistance(mid, BASALT), 9);
  });
});

describe("distanceMatrix", () => {
  it("has a zero diagonal and is symmetric", () => {
    const matrix = distanceMatrix([
      { id: "a", coreId: "c", depthM: 1, composition: BASALT },
      { id: "b", coreId: "c", depthM: 2, composition: RHYOLITE },
    ]);
    expect(matrix.distances[0]?.[0]).toBe(0);
    expect(matrix.distances[1]?.[1]).toBe(0);
    expect(matrix.distances[0]?.[1]).toBeCloseTo(matrix.distances[1]?.[0] as number, 12);
  });
});

describe("clusterTephra", () => {
  const samples: TephraSample[] = [
    { id: "a1", coreId: "ice", depthM: 1, composition: BASALT, note: "proximal basalt" },
    {
      id: "a2",
      coreId: "lake",
      depthM: 3,
      composition: perturb(BASALT, 0.02, 1),
      note: "distal basalt",
    },
    { id: "r1", coreId: "ice", depthM: 9, composition: RHYOLITE, note: "proximal rhyolite" },
    {
      id: "r2",
      coreId: "lake",
      depthM: 11,
      composition: perturb(RHYOLITE, 0.02, 2),
      note: "distal rhyolite",
    },
  ];

  it("groups layers from the same eruption across cores", () => {
    const groups = clusterTephra(samples, 2.5);
    const basaltGroup = groups.find((g) => g.memberIds.includes("a1"));
    expect([...(basaltGroup?.memberIds ?? [])].sort()).toEqual(["a1", "a2"]);
  });

  it("keeps different eruptions apart", () => {
    const groups = clusterTephra(samples, 2.5);
    const basaltGroup = groups.find((g) => g.memberIds.includes("a1"));
    expect(basaltGroup?.memberIds.includes("r1")).toBe(false);
  });

  it("returns nothing for no samples", () => {
    expect(clusterTephra([], 2)).toEqual([]);
  });
});

describe("Pyle thinning", () => {
  /** Builds isopachs from a known exponential law, as a survey would report. */
  function isopachsFrom(t0: number, k: number, radii: readonly number[]): Isopach[] {
    return radii.map((r, i) => ({
      thicknessM: t0 * Math.exp(-k * r),
      enclosedAreaM2: Math.PI * r * r,
      label: `I${i + 1}`,
    }));
  }

  it("recovers the vent thickness and decay constant exactly", () => {
    const truth = { t0: 1.6, k: 0.00095 };
    const fit = fitPyleThinning(isopachsFrom(truth.t0, truth.k, [500, 1500, 3500, 7000, 12000]));
    expect(fit.thicknessAtVentM).toBeCloseTo(truth.t0, 6);
    expect(fit.decayConstantPerM).toBeCloseTo(truth.k, 9);
    expect(fit.rSquared).toBeCloseTo(1, 9);
    expect(fit.rmsResidual).toBeLessThan(1e-9);
  });

  it("matches the closed-form volume V = 2 pi T0 / k^2", () => {
    const truth = { t0: 1.6, k: 0.00095 };
    const fit = fitPyleThinning(isopachsFrom(truth.t0, truth.k, [500, 1500, 3500, 7000, 12000]));
    const closedForm = (2 * Math.PI * truth.t0) / truth.k ** 2;
    expect(fit.volumeM3).toBeCloseTo(closedForm, 3);
  });

  it("reports the half-thickness distance as ln2 / k", () => {
    const fit = fitPyleThinning(isopachsFrom(2, 0.001, [400, 900, 1800, 3600]));
    expect(fit.halfThicknessM).toBeCloseTo(Math.log(2) / 0.001, 6);
    // ...and the fitted law halves at that distance.
    expect(pyleThicknessAt(fit, fit.halfThicknessM)).toBeCloseTo(fit.thicknessAtVentM / 2, 9);
  });

  it("integrates a plausible volume numerically as an independent check", () => {
    const isos = isopachsFrom(2, 0.0008, [300, 900, 2200, 5000, 9000]);
    const fit = fitPyleThinning(isos);
    const numeric = pyleVolumeNumeric(isos);
    // Annular trapezoids and the closed form agree to a few percent for a
    // well-sampled deposit.
    expect(numeric).toBeGreaterThan(0);
    expect(numeric).toBeGreaterThanOrEqual(fit.volumeM3 * 0.9);
    expect(numeric).toBeLessThanOrEqual(fit.volumeM3 * 1.1);
  });

  it("refuses fewer than two contours", () => {
    expect(() => fitPyleThinning([{ thicknessM: 1, enclosedAreaM2: 4 }])).toThrow(RangeError);
  });

  it("refuses contours with zero thickness", () => {
    expect(() =>
      fitPyleThinning([
        { thicknessM: 0, enclosedAreaM2: 100 },
        { thicknessM: 0.5, enclosedAreaM2: 900 },
      ]),
    ).toThrow(RangeError);
  });

  it("refuses a thickness that grows with distance", () => {
    expect(() =>
      fitPyleThinning([
        { thicknessM: 0.1, enclosedAreaM2: 100 },
        { thicknessM: 2, enclosedAreaM2: 900 },
      ]),
    ).toThrow(/increases with distance/);
  });
});

describe("compositionSimilarity", () => {
  it("is 1 for a composition against itself", () => {
    expect(compositionSimilarity(BASALT, BASALT)).toBeCloseTo(1, 12);
  });

  it("is scale-invariant", () => {
    const scaled = Object.fromEntries(OXIDE_ORDER.map((o) => [o, BASALT[o] * 5])) as Composition;
    expect(compositionSimilarity(BASALT, scaled)).toBeCloseTo(
      compositionSimilarity(BASALT, BASALT),
      6,
    );
  });

  it("is lower between basalt and rhyolite", () => {
    expect(compositionSimilarity(BASALT, RHYOLITE)).toBeLessThan(0.99);
  });
});

describe("mixingFraction", () => {
  it("returns 0 for the pure end member A", () => {
    expect(mixingFraction(BASALT, BASALT, RHYOLITE)).toBeCloseTo(0, 6);
  });

  it("returns 1 for the pure end member B", () => {
    expect(mixingFraction(RHYOLITE, BASALT, RHYOLITE)).toBeCloseTo(1, 6);
  });

  it("returns 0.5 for the geodesic midpoint between two end members", () => {
    // The Aitchison midpoint is the geometric mean, not the arithmetic mean.
    const mid = Object.fromEntries(
      OXIDE_ORDER.map((o) => [o, Math.sqrt(BASALT[o] * RHYOLITE[o])]),
    ) as Composition;
    const f = mixingFraction(mid, BASALT, RHYOLITE);
    expect(f).toBeCloseTo(0.5, 6);
  });

  it("returns something in [0, 1] for the arithmetic mean", () => {
    const mid = Object.fromEntries(
      OXIDE_ORDER.map((o) => [o, (BASALT[o] + RHYOLITE[o]) / 2]),
    ) as Composition;
    const f = mixingFraction(mid, BASALT, RHYOLITE);
    expect(f).toBeGreaterThan(0.3);
    expect(f).toBeLessThan(0.7);
  });

  it("stays inside [0, 1] for nonsense input", () => {
    const f = mixingFraction(BASALT, BASALT, BASALT);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(1);
  });
});

function perturb(base: Composition, scatter: number, seed: number): Composition {
  // Local deterministic multiplicative perturbation, re-closed to 100 %.
  const factors = OXIDE_ORDER.map(
    (_, i) => Math.exp(((seed * (i + 3) * 2654435761) % 1000) / 1000 - 0.5) * scatter * 4,
  );
  const raw = OXIDE_ORDER.map((o, i) => base[o] * (factors[i] as number));
  const total = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    OXIDE_ORDER.map((o, i) => [o, (raw[i] as number) * (100 / total)]),
  ) as Composition;
}
