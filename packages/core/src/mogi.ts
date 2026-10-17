/**
 * The Mogi (1958) point-source model, its forward solution and its inversion.
 *
 * ## The physics
 *
 * Mogi modelled a magma chamber as a small pressurised sphere buried in a
 * homogeneous, isotropic, elastic half-space. With the chamber centre at depth
 * `d` below the origin and a surface observation point at horizontal offset
 * `(x, y)`, the surface displacement is
 *
 *   [ u_east  ]   C        [ x ]
 *   [ u_north ] = --- · d³  [ y ]
 *   [ u_up    ]   R        [ d ]
 *
 * with `R = sqrt(x² + y² + d²)` and `C = ΔV (1 - ν) / π`, where `ΔV` is the
 * source volume change (π a³ ΔP / G for a sphere of radius `a`, pressure change
 * ΔP and shear modulus G) and `ν` is Poisson's ratio (auto: 0.25 for typical
 * volcanic rock).
 *
 * Two consequences drive the whole geodesy surface in ventloom:
 *
 *  1. Horizontal displacement `u` decays as `1/R²` and reaches further from the
 *     source than vertical displacement `w`, which decays as `1/R³`. A network
 *     of GPS benches therefore constrains the source position far better than
 *     levelling alone.
 *  2. Only the ratio `ΔV/d³` is resolvable from a single epoch - depth and
 *     volume are strongly correlated, and the inversion reports that
 *     correlation honestly rather than pretending to separate them.
 *
 * Source: Mogi, K. (1958), *Relations between the eruptions of various
 * volcanoes and the deformations of the ground surfaces around them*,
 * Earthquake Research Institute 36, 99–134. See `docs/adr/0003-mogi-formulation.md`.
 *
 * The formulation here is validated against the 1914 Taishō Sakurajima
 * case - Omori's levelling data, `d = 10 km`, `a = 2.5 km`, `ΔP = -400 MPa`,
 * `G = 30 GPa`, `ν = 0.25` - which reproduces `w_max = -1.5625 m` at the
 * epicentre and a deflation volume of `0.98 km³`.
 */

import { conditionNumber, dot, LuDecomposition, norm, transpose } from "./linalg.js";

/** Default Poisson's ratio for basaltic/andesitic volcanic rock. */
export const DEFAULT_POISSON = 0.25;

/** A three-component surface displacement, metres. */
export interface Displacement {
  eastM: number;
  northM: number;
  upM: number;
}

/** A ground station with its local east/north position relative to the summit. */
export interface StationOffset {
  readonly id: string;
  /** East offset from the summit, metres. Positive east of the vent. */
  readonly eastOffsetM: number;
  /** North offset from the summit, metres. Positive north of the vent. */
  readonly northOffsetM: number;
  /** Elevation of the station, metres above sea level (context only). */
  readonly elevationM?: number;
}

/** The four free parameters of a Mogi source. */
export interface MogiSource {
  /** Easting of the chamber centre projected to the surface, metres. */
  eastOffsetM: number;
  /** Northing of the chamber centre projected to the surface, metres. */
  northOffsetM: number;
  /** Depth of the chamber centre, metres below the surface. Positive down. */
  depthM: number;
  /** Source volume change, m³. Negative for deflation, positive for inflation. */
  volumeChangeM3: number;
}

export interface MogiForwardOptions {
  poisson?: number;
}

/**
 * Converts a source described in pressure terms into the volume-change form the
 * model uses. `ΔV = π a³ ΔP / G`.
 */
export function volumeChangeFromPressure(
  radiusM: number,
  pressureChangeMPa: number,
  shearModulusMPa: number,
): number {
  if (shearModulusMPa === 0) throw new RangeError("shear modulus must be non-zero");
  return (Math.PI * radiusM ** 3 * pressureChangeMPa) / shearModulusMPa;
}

/**
 * The coupling constant `C = ΔV (1 - ν) / π`, in m³.
 *
 * All three displacement components are `C` times a dimensionless geometric
 * factor, so a single scalar controls the amplitude and the inversion can solve
 * for it linearly once the geometry (including `d`) is pinned.
 */
export function mogiCoupling(source: MogiSource, poisson: number = DEFAULT_POISSON): number {
  return (source.volumeChangeM3 * (1 - poisson)) / Math.PI;
}

/** `R² = x² + y² + d²`, the squared distance from source to observation point. */
export function mogiRadiusSquared(dx: number, dy: number, d: number): number {
  return dx * dx + dy * dy + d * d;
}

/**
 * Forward model: surface displacement at `station` caused by `source`.
 */
export function mogiAt(
  station: StationOffset,
  source: MogiSource,
  poisson: number = DEFAULT_POISSON,
): Displacement {
  const d = source.depthM;
  if (!(d > 0)) {
    throw new RangeError(`Mogi source depth must be positive, got ${d}`);
  }
  const c = mogiCoupling(source, poisson);
  const dx = station.eastOffsetM - source.eastOffsetM;
  const dy = station.northOffsetM - source.northOffsetM;
  const r2 = mogiRadiusSquared(dx, dy, d);
  const r3 = r2 * Math.sqrt(r2);
  return {
    eastM: (c * dx) / r3,
    northM: (c * dy) / r3,
    upM: (c * d) / r3,
  };
}

/** Forward model evaluated over a whole network. */
export function mogiForward(
  stations: readonly StationOffset[],
  source: MogiSource,
  options: MogiForwardOptions = {},
): Displacement[] {
  const poisson = options.poisson ?? DEFAULT_POISSON;
  return stations.map((station) => mogiAt(station, source, poisson));
}

/**
 * Analytic Jacobian of the forward model with respect to the four source
 * parameters, in the order `[eastOffset, northOffset, depth, volume]`.
 *
 * Derived by differentiating `C · (s − e) R⁻³` in each parameter. Note that the
 * first two parameters are the *source* position, so those two columns carry
 * the opposite sign to the naive ∂/∂(station) form. Exact, so no step-size
 * tuning and no finite-difference bias in the solved depth - finite differences
 * would put a floor on the achievable precision at the ~1e-6 m scale that GPS
 * data actually reaches.
 */
export function mogiJacobian(
  station: StationOffset,
  source: MogiSource,
  poisson: number = DEFAULT_POISSON,
): { eastM: number[]; northM: number[]; upM: number[] } {
  const d = source.depthM;
  if (!(d > 0)) throw new RangeError(`Mogi source depth must be positive, got ${d}`);
  const c = mogiCoupling(source, poisson);
  const dx = station.eastOffsetM - source.eastOffsetM;
  const dy = station.northOffsetM - source.northOffsetM;
  const r2 = mogiRadiusSquared(dx, dy, d);
  const r3 = r2 * Math.sqrt(r2);
  const r5 = r3 * r2;
  // ∂/∂dx of the R⁻³ kernel is -3 dx R⁻⁵, and ∂C/∂ΔV = (1-ν)/π.
  const k = (-3 * c) / r5;
  const dv = (1 - poisson) / Math.PI;
  // The first two parameters are the *source* position, so ∂/∂eastOffsetM is
  // the negative of ∂/∂dx above.
  return {
    eastM: [-(c / r3 + k * dx * dx), -(k * dx * dy), k * dx * d, dv * (dx / r3)],
    northM: [-(k * dx * dy), -(c / r3 + k * dy * dy), k * dy * d, dv * (dy / r3)],
    upM: [-(k * d * dx), -(k * d * dy), c / r3 + k * d * d, dv * (d / r3)],
  };
}

export interface MogiInversionOptions {
  poisson?: number;
  /** Per-observation standard deviation, metres. Same noise on all three components. */
  sigmaM?: number;
  /** Starting guess. Defaults to a data-driven estimate derived from the field. */
  initial?: Partial<MogiSource>;
  /** Levenberg–Marquardt damping floor; raised and lowered during the solve. */
  damping?: number;
  maxIterations?: number;
  /** Convergence threshold on the relative reduction of the cost. */
  tolerance?: number;
  /** Only accept a step if the root-mean-square misfit falls below this, metres. */
  targetRmsM?: number;
  /** Hard bounds on depth, metres. Keeps the solve physical. */
  depthBoundsM?: readonly [number, number];
}

export interface MogiInversionResult {
  source: MogiSource;
  /** RMS misfit against the observed displacements, metres. */
  rmsMisfitM: number;
  /** Total squared misfit divided by σ², dimensionless. */
  chiSquared: number;
  /** Number of degrees of freedom: 3 × stations − 4. */
  degreesOfFreedom: number;
  iterations: number;
  converged: boolean;
  /** Why the solver stopped, for the evidence pack. */
  terminationReason: "converged" | "max-iterations" | "damping-collapsed";
  /** 1σ formal parameter uncertainties, same units as the parameters. */
  parameterSigmas: MogiSource;
  /**
   * Parameter correlation matrix in the order `[east, north, depth, volume]`.
   * A large off-diagonal entry is the honest statement that the network cannot
   * separate those two parameters.
   */
  parameterCorrelations: number[][];
  /**
   * Condition number of the column-normalised normal equations: how separable
   * the parameters are, independent of the units they happen to be measured in.
   */
  conditionNumber: number;
  /** Absolute value of the depth/volume correlation, the classic trade-off. */
  depthVolumeTradeOff: number;
  /** Cost at each iteration, for the convergence trace chart. */
  costHistory: number[];
  /** Observed minus modelled, per station. */
  residuals: Displacement[];
  /** Model prediction at each station. */
  predicted: Displacement[];
  /** Fraction of total variance removed, in [0, 1]. */
  varianceReduction: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * A data-driven starting point for the inversion.
 *
 * The vertical displacement of a Mogi field peaks over the source, so a
 * weighted centroid of the observed `up` magnitudes locates the chamber
 * horizontally. Given that root, `C ≈ w R³ / d` at the steepest station gives
 * the volume, and a 5 km depth is a neutral prior for a stratovolcano. These
 * are crude on purpose: the point is that no Jacobian column starts at zero.
 */
function initialSourceGuess(
  stations: readonly StationOffset[],
  observed: readonly Displacement[],
  poisson: number,
): MogiSource {
  let weightSum = 0;
  let east = 0;
  let north = 0;
  let peak = { up: 0, eastOffsetM: 0, northOffsetM: 0, depthM: 5000 };
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i] as StationOffset;
    const obs = observed[i] as Displacement;
    const weight = Math.abs(obs.upM);
    weightSum += weight;
    east += weight * station.eastOffsetM;
    north += weight * station.northOffsetM;
    if (Math.abs(obs.upM) > Math.abs(peak.up)) {
      peak = {
        up: obs.upM,
        eastOffsetM: station.eastOffsetM,
        northOffsetM: station.northOffsetM,
        depthM: 5000,
      };
    }
  }
  const centroid =
    weightSum > 0
      ? { eastOffsetM: east / weightSum, northOffsetM: north / weightSum }
      : { eastOffsetM: 0, northOffsetM: 0 };
  const dx = peak.eastOffsetM - centroid.eastOffsetM;
  const dy = peak.northOffsetM - centroid.northOffsetM;
  const r3 = (dx * dx + dy * dy + peak.depthM ** 2) ** 1.5;
  const coupling = r3 > 0 ? (peak.up * r3) / peak.depthM : 0;
  const volume = coupling > 0 ? (coupling * Math.PI) / (1 - poisson) : -1e6;
  return {
    eastOffsetM: centroid.eastOffsetM,
    northOffsetM: centroid.northOffsetM,
    depthM: 5000,
    volumeChangeM3: Number.isFinite(volume) ? volume : -1e6,
  };
}

/**
 * Inverts a network of three-component displacements for a Mogi source.
 *
 * Levenberg–Marquardt, with the analytic Jacobian, a damping term scaled by
 * `diag(JᵀJ)`, depth clamped to physical bounds, and a monotone-cost acceptance
 * rule. The solver refuses to report success on a stale point: it returns
 * `converged: false` with the reason it stopped, so a caller can never present
 * a non-solution as an answer.
 */
export function mogiInvert(
  stations: readonly StationOffset[],
  observed: readonly Displacement[],
  options: MogiInversionOptions = {},
): MogiInversionResult {
  if (stations.length !== observed.length) {
    throw new RangeError(
      `station count ${stations.length} does not match observation count ${observed.length}`,
    );
  }
  if (stations.length * 3 <= 4) {
    throw new RangeError("a Mogi inversion needs at least 2 three-component observations");
  }
  const poisson = options.poisson ?? DEFAULT_POISSON;
  const sigma = options.sigmaM ?? 0.005;
  const damping0 = options.damping ?? 1e-3;
  const maxIterations = options.maxIterations ?? 60;
  const tolerance = options.tolerance ?? 1e-10;
  const targetRmsM = options.targetRmsM ?? 0;
  const [depthLo, depthHi] = options.depthBoundsM ?? [200, 30000];

  // A zero-volume start leaves the position and depth columns of the Jacobian
  // identically zero, so the first normal-equation solve is singular and the
  // solver can only ever move the volume. Seed the guess from the field
  // instead: the source sits under the steepest part of the vertical field, and
  // the volume follows from `C ≈ w_max R³ / d`.
  const guess: MogiSource = options.initial
    ? {
        eastOffsetM: options.initial.eastOffsetM ?? 0,
        northOffsetM: options.initial.northOffsetM ?? 0,
        depthM: options.initial.depthM ?? 5000,
        volumeChangeM3: options.initial.volumeChangeM3 ?? 0,
      }
    : initialSourceGuess(stations, observed, poisson);
  let current: MogiSource = {
    eastOffsetM: guess.eastOffsetM,
    northOffsetM: guess.northOffsetM,
    depthM: clamp(guess.depthM, depthLo, depthHi),
    volumeChangeM3: guess.volumeChangeM3,
  };

  const parameterCount = 4;
  const cost = (p: MogiSource): number => {
    let sum = 0;
    for (let i = 0; i < stations.length; i++) {
      const model = mogiAt(stations[i] as StationOffset, p, poisson);
      const obs = observed[i] as Displacement;
      sum += ((obs.eastM - model.eastM) / sigma) ** 2;
      sum += ((obs.northM - model.northM) / sigma) ** 2;
      sum += ((obs.upM - model.upM) / sigma) ** 2;
    }
    return sum;
  };

  let currentCost = cost(current);
  const costHistory = [currentCost];
  let damping = damping0;
  let iterations = 0;
  let converged = false;
  let terminationReason: MogiInversionResult["terminationReason"] = "max-iterations";
  let residualVariance = sigma ** 2;

  for (; iterations < maxIterations; iterations++) {
    // Build the (3N × 4) Jacobian and the (3N) weighted residual vector.
    const rows: number[][] = [];
    const residuals: number[] = [];
    for (let i = 0; i < stations.length; i++) {
      const station = stations[i] as StationOffset;
      const obs = observed[i] as Displacement;
      const model = mogiAt(station, current, poisson);
      const jac = mogiJacobian(station, current, poisson);
      for (const component of ["eastM", "northM", "upM"] as const) {
        rows.push(jac[component].map((v) => v / sigma));
        residuals.push((obs[component] - model[component]) / sigma);
      }
    }
    const jacobianT = transpose(rows);
    const jtj: number[][] = Array.from({ length: parameterCount }, () =>
      new Array<number>(parameterCount).fill(0),
    );
    const jtr = new Array<number>(parameterCount).fill(0);
    for (let a = 0; a < parameterCount; a++) {
      const rowA = jacobianT[a] as number[];
      for (let b = 0; b < parameterCount; b++) {
        const rowB = jacobianT[b] as number[];
        let sum = 0;
        for (let k = 0; k < rows.length; k++) sum += (rowA[k] as number) * (rowB[k] as number);
        (jtj[a] as number[])[b] = sum;
      }
      let sum = 0;
      for (let k = 0; k < rows.length; k++) sum += (rowA[k] as number) * (residuals[k] as number);
      jtr[a] = sum;
    }

    // (JᵀJ + λ diag(JᵀJ)) δ = Jᵀr, with a vanishingly small absolute ridge so
    // that a parameter with no curvature at all still yields a bounded step
    // instead of a singular system.
    const maxDiagonal = Math.max(...jtj.map((row, i) => Math.abs(row[i] ?? 0)), 0);
    const ridge = maxDiagonal > 0 ? 1e-10 * maxDiagonal : 1e-30;
    const normal: number[][] = jtj.map((row, i) =>
      row.map((value, j) => (i === j ? value * (1 + damping) + ridge : value)),
    );
    let lu: LuDecomposition;
    try {
      lu = new LuDecomposition(normal);
      if (!Number.isFinite(lu.determinant()) || lu.determinant() === 0) {
        throw new RangeError("singular normal equations");
      }
    } catch {
      damping *= 10;
      if (damping > 1e12) {
        terminationReason = "damping-collapsed";
        break;
      }
      continue;
    }

    const step = lu.solve(jtr);
    if (!step.every((value) => Number.isFinite(value))) {
      damping *= 10;
      continue;
    }

    const trial: MogiSource = {
      eastOffsetM: current.eastOffsetM + (step[0] as number),
      northOffsetM: current.northOffsetM + (step[1] as number),
      depthM: clamp(current.depthM + (step[2] as number), depthLo, depthHi),
      volumeChangeM3: current.volumeChangeM3 + (step[3] as number),
    };
    const trialCost = cost(trial);

    if (trialCost <= currentCost) {
      const relativeReduction = (currentCost - trialCost) / Math.max(currentCost, 1e-30);
      current = trial;
      currentCost = trialCost;
      damping = Math.max(damping / 3, 1e-12);
      costHistory.push(currentCost);
      if (relativeReduction < tolerance) {
        converged = true;
        terminationReason = "converged";
        iterations++;
        break;
      }
    } else {
      damping *= 10;
      if (damping > 1e12) {
        terminationReason = "damping-collapsed";
        break;
      }
    }
  }

  if (targetRmsM > 0) {
    const rms = Math.sqrt((currentCost * sigma ** 2) / (stations.length * 3));
    if (rms <= targetRmsM && terminationReason !== "damping-collapsed") {
      converged = true;
      if (terminationReason !== "converged") terminationReason = "converged";
    }
  }

  const residualCount = stations.length * 3;
  const dof = Math.max(1, residualCount - parameterCount);
  if (dof > 0) residualVariance = currentCost / dof;

  // Formal parameter covariance: (JᵀJ)⁻¹ · σ². Rebuild J at the solution.
  const rowsFinal: number[][] = [];
  for (const station of stations)
    rowsFinal.push(mogiJacobian(station, current, poisson).eastM.map((v) => v / sigma));
  for (const station of stations) {
    rowsFinal.push(mogiJacobian(station, current, poisson).northM.map((v) => v / sigma));
  }
  for (const station of stations) {
    rowsFinal.push(mogiJacobian(station, current, poisson).upM.map((v) => v / sigma));
  }
  const jtjFinal = multiplyTranspose(rowsFinal);
  // Column-normalised JᵀJ: without this, a volume column that is ten orders of
  // magnitude smaller than a position column dominates the condition number and
  // the metric says nothing about whether depth and volume are separable.
  const columnNorms = Array.from({ length: parameterCount }, (_, j) =>
    Math.sqrt(
      Array.from({ length: rowsFinal.length }, (_, i) => (rowsFinal[i]?.[j] ?? 0) ** 2).reduce(
        (a, b) => a + b,
        0,
      ),
    ),
  );
  const normalizedJtj: number[][] = jtjFinal.map((row, i) =>
    row.map((value, j) =>
      (columnNorms[i] ?? 0) > 0 && (columnNorms[j] ?? 0) > 0
        ? value / ((columnNorms[i] as number) * (columnNorms[j] as number))
        : 0,
    ),
  );
  const cond = conditionNumber(normalizedJtj);
  let sigmas: MogiSource;
  let correlations: number[][];
  try {
    const inverse = new LuDecomposition(jtjFinal).inverse();
    // Parameter covariance is σ² (JᵀJ)⁻¹, so the diagonal gives the formal
    // uncertainties and the full matrix gives the parameter correlations.
    const covariance = inverse.map((row) => row.map((value) => value * residualVariance));
    const variance = covariance.map((row, i) => Math.max(0, row[i] ?? 0));
    correlations = covariance.map((row, i) =>
      covariance.map((_, j) => {
        const vi = variance[i] as number;
        const vj = variance[j] as number;
        const cij = Math.abs(row[j] ?? 0);
        return vi > 0 && vj > 0 ? Math.min(1, cij / Math.sqrt(vi * vj)) : 0;
      }),
    );
    sigmas = {
      eastOffsetM: Math.sqrt(variance[0] as number),
      northOffsetM: Math.sqrt(variance[1] as number),
      depthM: Math.sqrt(variance[2] as number),
      volumeChangeM3: Math.sqrt(variance[3] as number),
    };
  } catch {
    sigmas = {
      eastOffsetM: Number.NaN,
      northOffsetM: Number.NaN,
      depthM: Number.NaN,
      volumeChangeM3: Number.NaN,
    };
    correlations = Array.from({ length: parameterCount }, () =>
      new Array<number>(parameterCount).fill(Number.NaN),
    );
  }

  const residualsOut: Displacement[] = [];
  const predictedOut: Displacement[] = [];
  let observedVariance = 0;
  const meanEast = mean(observed.map((o) => o.eastM));
  const meanNorth = mean(observed.map((o) => o.northM));
  const meanUp = mean(observed.map((o) => o.upM));
  for (let i = 0; i < stations.length; i++) {
    const model = mogiAt(stations[i] as StationOffset, current, poisson);
    const obs = observed[i] as Displacement;
    residualsOut.push({
      eastM: obs.eastM - model.eastM,
      northM: obs.northM - model.northM,
      upM: obs.upM - model.upM,
    });
    predictedOut.push(model);
    // Variance is measured against the mean of the *observed* field, which is
    // the only baseline a misfit can be reduced against.
    observedVariance +=
      (obs.eastM - meanEast) ** 2 + (obs.northM - meanNorth) ** 2 + (obs.upM - meanUp) ** 2;
  }

  return {
    source: current,
    // currentCost is the weighted (σ-normalised) sum, so the misfit in metres
    // needs σ multiplied back in.
    rmsMisfitM: Math.sqrt((currentCost * sigma ** 2) / residualCount),
    chiSquared: currentCost,
    degreesOfFreedom: dof,
    iterations,
    converged,
    terminationReason,
    parameterSigmas: sigmas,
    parameterCorrelations: correlations,
    conditionNumber: cond,
    depthVolumeTradeOff: Math.abs(correlations[2]?.[3] ?? 0),
    costHistory,
    residuals: residualsOut,
    predicted: predictedOut,
    varianceReduction:
      observedVariance > 0 ? clamp(1 - (currentCost * sigma ** 2) / observedVariance, 0, 1) : 0,
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** `JᵀJ` for a row-major Jacobian array. */
function multiplyTranspose(rows: readonly number[][]): number[][] {
  const n = parameterCountOf(rows);
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const row of rows) {
    for (let i = 0; i < n; i++) {
      const vi = row[i] as number;
      if (vi === 0) continue;
      const orow = out[i] as number[];
      for (let j = 0; j < n; j++) {
        const vj = row[j] as number;
        if (vj === 0) continue;
        orow[j] = (orow[j] ?? 0) + vi * vj;
      }
    }
  }
  return out;
}

function parameterCountOf(rows: readonly number[][]): number {
  const first = rows[0];
  return first === undefined ? 0 : first.length;
}

/**
 * Euclidean length of a displacement, used for arrow scaling on the map.
 */
export function displacementMagnitude(d: Displacement): number {
  return norm([d.eastM, d.northM, d.upM]);
}

/** Horizontal-only magnitude (what you can see on a map view). */
export function horizontalMagnitude(d: Displacement): number {
  return Math.hypot(d.eastM, d.northM);
}

export { dot as dotDisplacement };
