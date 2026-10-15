/**
 * Minimal dense linear algebra for the geodetic inversion.
 *
 * Only what the Levenberg–Marquardt solver needs: a real LU factorisation with
 * partial pivoting, a symmetric-eigenvalue routine for the parameter
 * covariance, and condition-number estimation. Deliberately dependency-free
 * so `@repo/core` stays portable to wasm, workers and the Rust parity crate.
 */

export type Matrix = readonly (readonly number[])[];

/** A square matrix plus its LU factors, reusable for many right-hand sides. */
export class LuDecomposition {
  readonly size: number;
  private readonly lu: Float64Array;
  private readonly pivots: Int32Array;
  private sign = 1;

  constructor(input: Matrix) {
    const n = input.length;
    for (const row of input) {
      if (row.length !== n) {
        throw new RangeError(
          `expected a square ${n}x${n} matrix, got a row of length ${row.length}`,
        );
      }
    }
    this.size = n;
    this.lu = new Float64Array(n * n);
    this.pivots = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.pivots[i] = i;
      const row = input[i] as readonly number[];
      for (let j = 0; j < n; j++) this.lu[i * n + j] = row[j] as number;
    }

    for (let k = 0; k < n; k++) {
      let pivotRow = k;
      let pivotValue = Math.abs(this.lu[k * n + k] as number);
      for (let i = k + 1; i < n; i++) {
        const candidate = Math.abs(this.lu[i * n + k] as number);
        if (candidate > pivotValue) {
          pivotValue = candidate;
          pivotRow = i;
        }
      }
      if (pivotValue === 0) continue; // singular column; leave as-is
      if (pivotRow !== k) {
        for (let j = 0; j < n; j++) {
          const a = this.lu[k * n + j] as number;
          const b = this.lu[pivotRow * n + j] as number;
          this.lu[k * n + j] = b;
          this.lu[pivotRow * n + j] = a;
        }
        const p = this.pivots[k] as number;
        this.pivots[k] = this.pivots[pivotRow] as number;
        this.pivots[pivotRow] = p;
        this.sign = -this.sign;
      }
      const pivot = this.lu[k * n + k] as number;
      for (let i = k + 1; i < n; i++) {
        const factor = (this.lu[i * n + k] as number) / pivot;
        this.lu[i * n + k] = factor;
        if (factor !== 0) {
          for (let j = k + 1; j < n; j++) {
            this.lu[i * n + j] =
              (this.lu[i * n + j] as number) - factor * (this.lu[k * n + j] as number);
          }
        }
      }
    }
  }

  /** Solves `A · x = b` for a single right-hand side. */
  solve(b: readonly number[]): number[] {
    if (b.length !== this.size) {
      throw new RangeError(
        `right-hand side length ${b.length} does not match matrix size ${this.size}`,
      );
    }
    const n = this.size;
    const x = new Array<number>(n);
    for (let i = 0; i < n; i++) x[i] = b[this.pivots[i] as number] as number;
    for (let i = 1; i < n; i++) {
      let sum = x[i] as number;
      for (let j = 0; j < i; j++) sum -= (this.lu[i * n + j] as number) * (x[j] as number);
      x[i] = sum;
    }
    for (let i = n - 1; i >= 0; i--) {
      let sum = x[i] as number;
      for (let j = i + 1; j < n; j++) sum -= (this.lu[i * n + j] as number) * (x[j] as number);
      const diag = this.lu[i * n + i] as number;
      x[i] = diag === 0 ? 0 : sum / diag;
    }
    return x;
  }

  /** Determinant of the original matrix. */
  determinant(): number {
    let det = this.sign;
    for (let i = 0; i < this.size; i++) det *= this.lu[i * this.size + i] as number;
    return det;
  }

  /** Solves for every column of the identity — i.e. inverts the matrix. */
  inverse(): number[][] {
    const out: number[][] = [];
    for (let j = 0; j < this.size; j++) {
      const e = new Array<number>(this.size).fill(0);
      e[j] = 1;
      out.push(this.solve(e));
    }
    return out;
  }
}

/** Solves `A · x = b`, throwing if `A` is singular to machine precision. */
export function solveLinearSystem(a: Matrix, b: readonly number[]): number[] {
  const lu = new LuDecomposition(a);
  if (lu.determinant() === 0) throw new RangeError("matrix is singular");
  return lu.solve(b);
}

/** Transposes a matrix. */
export function transpose(m: Matrix): number[][] {
  const rows = m.length;
  const cols = (m[0] as readonly number[] | undefined)?.length ?? 0;
  const out: number[][] = Array.from({ length: cols }, () => new Array<number>(rows).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      (out[j] as number[])[i] = (m[i] as readonly number[])[j] as number;
    }
  }
  return out;
}

/** Matrix product `a · b`. */
export function multiply(a: Matrix, b: Matrix): number[][] {
  const inner = b.length;
  const cols = (b[0] as readonly number[] | undefined)?.length ?? 0;
  const out: number[][] = Array.from({ length: a.length }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < inner; k++) {
      const factor = (a[i] as readonly number[])[k] as number;
      if (factor === 0) continue;
      const row = out[i] as number[];
      const brow = b[k] as readonly number[];
      for (let j = 0; j < cols; j++) row[j] = (row[j] ?? 0) + factor * (brow[j] ?? 0);
    }
  }
  return out;
}

export function dot(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new RangeError("dot() length mismatch");
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number);
  return sum;
}

export function norm(a: readonly number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Eigen-decomposition of a small symmetric matrix by cyclic Jacobi rotations.
 *
 * Convergence is quadratic and 4x4 systems (the Mogi parameter covariance)
 * finish in a few dozen sweeps, so no fancy Lanczos is warranted.
 */
export function symmetricEigen(matrix: Matrix): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a: number[][] = matrix.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) off += (a[i]?.[j] ?? 0) ** 2;
    }
    if (off <= 1e-30) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = (a[p] as number[])[q] as number;
        if (Math.abs(apq) < 1e-30) continue;
        const app = (a[p] as number[])[p] as number;
        const aqq = (a[q] as number[])[q] as number;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = (a[k] as number[])[p] as number;
          const akq = (a[k] as number[])[q] as number;
          (a[k] as number[])[p] = c * akp - s * akq;
          (a[k] as number[])[q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = (a[p] as number[])[k] as number;
          const aqk = (a[q] as number[])[k] as number;
          (a[p] as number[])[k] = c * apk - s * aqk;
          (a[q] as number[])[k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = (v[k] as number[])[p] as number;
          const vkq = (v[k] as number[])[q] as number;
          (v[k] as number[])[p] = c * vkp - s * vkq;
          (v[k] as number[])[q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = Array.from({ length: n }, (_, i) => (a[i] as number[])[i] as number);
  const order = values
    .map((_, i) => i)
    .sort((x, y) => (values[y] as number) - (values[x] as number));
  return {
    values: order.map((i) => values[i] as number),
    vectors: order.map((col) =>
      Array.from({ length: n }, (_, r) => (v[r] as number[])[col] as number),
    ),
  };
}

/**
 * Spectral condition number of a symmetric positive-definite matrix.
 *
 * Reported with every inversion: a large `Springer`-grade condition number in
 * the depth × volume trade-off is the honest signal that the network geometry
 * cannot separate the two.
 */
export function conditionNumber(symmetric: Matrix): number {
  const { values } = symmetricEigen(symmetric);
  const lo = values[values.length - 1] ?? 0;
  const hi = values[0] ?? 0;
  if (lo <= 0) return Number.POSITIVE_INFINITY;
  return hi / lo;
}
