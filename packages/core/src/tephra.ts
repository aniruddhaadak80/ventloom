/**
 * Tephra geochemistry: composition-aware distance and thinning-law fits.
 *
 * Tephra layers are correlated between ice cores, sediment cores and soil
 * profiles by their major-oxide chemistry, and each correlation is a
 * compositional-data problem: oxides are parts of a whole that sum to 100 %,
 * so Euclidean distance on raw wt% is wrong — a rise in SiO₂ must drag every
 * other oxide down. ventloom therefore works in the Aitchison geometry and
 * measures genuine distances on the simplex.
 *
 * The other half is the thinning problem. Pyle (1989) showed tephra thickness
 * decays exponentially with the square root of the area enclosed by an isopach,
 * which makes the source volume a closed-form integral: V = 2π T₀ / k².
 */

import { dot, norm, solveLinearSystem } from "./linalg.js";

/** Major oxides tracked for a tephra fingerprint, in conventional order. */
export const OXIDE_ORDER = [
  "SiO2",
  "TiO2",
  "Al2O3",
  "Fe2O3",
  "MnO",
  "MgO",
  "CaO",
  "Na2O",
  "K2O",
  "P2O5",
] as const;
export type Oxide = (typeof OXIDE_ORDER)[number];

export type Composition = Readonly<Record<Oxide, number>>;

/** A tephra sample: where it was taken from and what it is made of. */
export interface TephraSample {
  readonly id: string;
  /** Core or profile it came from. */
  readonly coreId: string;
  /** Depth in the core, metres. */
  readonly depthM: number;
  /** Measured major-oxide composition, wt%. Must sum to ~100. */
  readonly composition: Composition;
  /** Free-text provenance for the evidence pack. */
  readonly note?: string;
}

/** An isopach contour: thickness at a point, and the area it encloses. */
export interface Isopach {
  /** Measured thickness, metres. */
  thicknessM: number;
  /** Area enclosed by this contour, m². */
  enclosedAreaM2: number;
  /** Optional label, e.g. "10 cm isopach". */
  label?: string;
}

export interface PyleThinningFit {
  /** Extrapolated thickness at the vent, metres. */
  thicknessAtVentM: number;
  /** Decay constant, 1/m. Larger = thinner fall. */
  decayConstantPerM: number;
  /** Distance at which thickness halves, metres. */
  halfThicknessM: number;
  /** Total deposit volume from the closed-form integral, m³. */
  volumeM3: number;
  /** Root-mean-square misfit of the fit in log space, dimensionless. */
  rmsResidual: number;
  /** Number of contours used. */
  contours: number;
  /** Coefficient of determination in log space. */
  rSquared: number;
}

/**
 * Replaces non-positive components before a log-ratio transform.
 *
 * A zero oxide is a measurement limit, not a true zero, and `log(0)` destroys
 * the transform. Multiplicative replacement (Martín-Fernández et al. 2003)
 * subtracts a small share from every other component so the composition stays
 * closed and the affected rows stay in the analysis instead of being dropped.
 */
export function closeComposition(
  composition: Composition,
  replacementFraction = 0.01,
): Record<Oxide, number> {
  const raw = OXIDE_ORDER.map((oxide) => composition[oxide]);
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new RangeError("composition must have a positive sum");
  const closed = raw.map((v) => v / total);
  const zeros = closed.filter((v) => v <= 0).length;
  if (zeros === 0) {
    return Object.fromEntries(OXIDE_ORDER.map((o, i) => [o, closed[i] as number])) as Record<
      Oxide,
      number
    >;
  }
  // Each zero receives `replacementFraction` of the closed total; the non-zero
  // components share whatever is left, in proportion to their magnitude, so the
  // composition still sums to exactly 1.
  const delta = replacementFraction;
  const scale = 1 - zeros * delta;
  const adjusted = closed.map((v) => (v > 0 ? v * scale : delta));
  return Object.fromEntries(OXIDE_ORDER.map((o, i) => [o, adjusted[i] as number])) as Record<
    Oxide,
    number
  >;
}

/**
 * Centered log-ratio transform: `clr(x)_i = ln(x_i) − mean(ln(x))`.
 */
export function clrTransform(composition: Composition): number[] {
  const closed = closeComposition(composition);
  const inUnit = OXIDE_ORDER.map((oxide) => closed[oxide]);
  const logs = inUnit.map((v) => Math.log(v));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  return logs.map((l) => l - mean);
}

/** Euclidean norm of the CLR difference — the Aitchison distance. */
export function aitchisonDistance(a: Composition, b: Composition): number {
  const ca = clrTransform(a);
  const cb = clrTransform(b);
  return Math.sqrt(ca.reduce((sum, v, i) => sum + (v - (cb[i] as number)) ** 2, 0));
}

export interface DistanceMatrix {
  ids: string[];
  /** Row-major Aitchison distances. */
  distances: number[][];
  /** Distance below which two layers are treated as the same eruption. */
  correlationThreshold: number;
}

/**
 * Full pairwise distance matrix over a set of tephra samples.
 *
 * The threshold defaults to 2.0, which sits above the intra-eruption scatter
 * reported for well-mixed fall units and below the separation between
 * neighbouring units of different compositions.
 */
export function distanceMatrix(
  samples: readonly TephraSample[],
  correlationThreshold = 2,
): DistanceMatrix {
  const ids = samples.map((s) => s.id);
  const distances = samples.map((row) =>
    samples.map((col) => (row === col ? 0 : aitchisonDistance(row.composition, col.composition))),
  );
  return { ids, distances, correlationThreshold };
}

export interface CorrelationGroup {
  /** Representative sample: the member closest to the group centroid. */
  readonly representativeId: string;
  readonly memberIds: readonly string[];
  /** Mean within-group Aitchison distance. */
  readonly meanWithinGroupDistance: number;
}

/**
 * Single-linkage clustering of tephra layers by composition.
 *
 * Single linkage is chosen over complete or Ward because a tephra layer can
 * split into two sub-facies — a coarse proximal lens and a fine distal drape —
 * that must still group; single linkage never splits a continuous unit.
 */
export function clusterTephra(
  samples: readonly TephraSample[],
  maxDistance = 2,
): CorrelationGroup[] {
  if (samples.length === 0) return [];
  const matrix = distanceMatrix(samples, maxDistance);
  const parent = samples.map((_, i) => i);
  // Path-halving union-find. Written as a loop rather than the recursive
  // form, which reads worse and blows the stack on long chains.
  const find = (i: number): number => {
    let root = i;
    while ((parent[root] as number) !== root) root = parent[root] as number;
    let walk = i;
    while ((parent[walk] as number) !== root) {
      const next = parent[walk] as number;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      if ((matrix.distances[i]?.[j] ?? Number.POSITIVE_INFINITY) <= maxDistance) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < samples.length; i++) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(i);
    else groups.set(root, [i]);
  }
  const out: CorrelationGroup[] = [];
  for (const members of groups.values()) {
    let best = members[0] as number;
    let bestMean = Number.POSITIVE_INFINITY;
    for (const candidate of members) {
      let total = 0;
      for (const other of members) {
        total += matrix.distances[candidate]?.[other] ?? 0;
      }
      const mean = total / members.length;
      if (mean < bestMean) {
        bestMean = mean;
        best = candidate;
      }
    }
    out.push({
      representativeId: (samples[best] as TephraSample).id,
      memberIds: members.map((i) => (samples[i] as TephraSample).id),
      meanWithinGroupDistance: bestMean,
    });
  }
  return out.sort((a, b) => a.representativeId.localeCompare(b.representativeId));
}

/**
 * Fits Pyle's exponential thinning law to a set of isopach contours.
 *
 * `T(x) = T₀ · exp(−k·x)` with `x = sqrt(A / π)`, fitted by ordinary least
 * squares on `ln T` against `x`. The deposit volume follows in closed form,
 * since with `A = πx²`,
 *
 *   V = ∫ T dA = ∫₀^∞ T₀ e^{−kx} · 2πx dx = 2π T₀ / k².
 *
 * The fit rejects contours of zero thickness (they are the survey edge, not a
 * measurement) and refuses to return a negative decay constant.
 */
export function fitPyleThinning(isopachs: readonly Isopach[]): PyleThinningFit {
  const usable = isopachs.filter((iso) => iso.thicknessM > 0 && iso.enclosedAreaM2 > 0);
  if (usable.length < 2) {
    throw new RangeError("Pyle thinning needs at least two isopach contours with positive area");
  }
  const points = usable.map((iso) => {
    const x = Math.sqrt(iso.enclosedAreaM2 / Math.PI);
    return { x, y: Math.log(iso.thicknessM) };
  });
  const n = points.length;
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  const sxx = points.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = points.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0)
    throw new RangeError("isopach contours are collinear; cannot fit a decay constant");
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const decay = -slope;
  if (decay <= 0) {
    throw new RangeError(
      `thickness increases with distance (slope ${slope.toExponential(3)}); the exponential law does not apply`,
    );
  }
  const thicknessAtVent = Math.exp(intercept);
  const meanY = sy / n;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const predicted = intercept + slope * p.x;
    ssRes += (p.y - predicted) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  return {
    thicknessAtVentM: thicknessAtVent,
    decayConstantPerM: decay,
    halfThicknessM: Math.log(2) / decay,
    volumeM3: (2 * Math.PI * thicknessAtVent) / (decay * decay),
    rmsResidual: Math.sqrt(ssRes / n),
    contours: n,
    rSquared: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
  };
}

/** Evaluates the fitted law at a distance from the vent. */
export function pyleThicknessAt(fit: PyleThinningFit, distanceM: number): number {
  return fit.thicknessAtVentM * Math.exp(-fit.decayConstantPerM * distanceM);
}

/**
 * Numeric deposit volume by annular integration, used as an independent check
 * on the closed form in `fitPyleThinning`.
 *
 * Integrates `T(x) · 2πx` over the surveyed radii with the innermost disc
 * treated as uniform at the first isopach's thickness. Beyond the outermost
 * isopach the thickness is taken as zero, which is what a survey that stops
 * there is assuming. The two estimates agree to a few percent for a well
 * sampled deposit, and disagreeing badly is the signal that the isopachs are
 * too sparse to trust.
 */
export function pyleVolumeNumeric(isopachs: readonly Isopach[]): number {
  const nodes = isopachs
    .filter((iso) => iso.thicknessM > 0 && iso.enclosedAreaM2 > 0)
    .map((iso) => ({ x: Math.sqrt(iso.enclosedAreaM2 / Math.PI), thickness: iso.thicknessM }))
    .sort((a, b) => a.x - b.x);
  if (nodes.length < 2) throw new RangeError("need at least two isopachs");
  const innermost = nodes[0] as { x: number; thickness: number };
  // The disc inside the innermost isopach.
  let volume = Math.PI * innermost.x ** 2 * innermost.thickness;
  // Annuli between consecutive isopach radii.
  for (let i = 1; i < nodes.length; i++) {
    const inner = nodes[i - 1] as { x: number; thickness: number };
    const outer = nodes[i] as { x: number; thickness: number };
    const gInner = 2 * Math.PI * inner.x * inner.thickness;
    const gOuter = 2 * Math.PI * outer.x * outer.thickness;
    volume += ((outer.x - inner.x) * (gInner + gOuter)) / 2;
  }
  return volume;
}

/** Cosine similarity between two compositions — used as a secondary ranking. */
export function compositionSimilarity(a: Composition, b: Composition): number {
  const closed = closeComposition(a);
  const other = closeComposition(b);
  const va = OXIDE_ORDER.map((o) => closed[o]);
  const vb = OXIDE_ORDER.map((o) => other[o]);
  const denominator = norm(va) * norm(vb);
  if (denominator === 0) return 0;
  return dot(va, vb) / denominator;
}

/**
 * Least-squares mixing fraction: how far along the two-member edge from
 * `endMemberA` to `endMemberB` the `mixture` sits.
 *
 * Perturbation mixing is linear in the log-ratio geometry, not in wt%, so the
 * fraction is the orthogonal projection of `clr(mixture) − clr(A)` onto the
 * edge direction `clr(B) − clr(A)`.
 */
export function mixingFraction(
  mixture: Composition,
  endMemberA: Composition,
  endMemberB: Composition,
): number {
  const a = clrTransform(endMemberA);
  const b = clrTransform(endMemberB);
  const m = clrTransform(mixture);
  const edge = b.map((value, i) => value - (a[i] as number));
  const offset = m.map((value, i) => value - (a[i] as number));
  const denominator = dot(edge, edge);
  if (denominator === 0) return 0.5;
  const f = dot(offset, edge) / denominator;
  return Math.min(1, Math.max(0, f));
}

export { solveLinearSystem as _solveLinearSystemForTests };
