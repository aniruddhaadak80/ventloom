//! Small dense linear algebra: Gaussian elimination with partial pivoting.
//!
//! The crate deliberately does not depend on a BLAS. Every system solved here
//! is at most 4×4, and a vendored Fortran toolchain would cost far more in
//! build complexity than it could ever return in speed.

/// Why a linear solve failed.
#[derive(Debug, Clone, PartialEq)]
pub enum MatrixError {
    /// The coefficient matrix is singular (or singular to working precision).
    Singular(String),
    /// The coefficient matrix and right-hand side disagree in size.
    DimensionMismatch {
        /// Rows the coefficient matrix claims to have.
        expected: usize,
        /// Length of the supplied right-hand side.
        got: usize,
    },
}

impl std::fmt::Display for MatrixError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MatrixError::Singular(why) => write!(f, "singular matrix: {why}"),
            MatrixError::DimensionMismatch { expected, got } => {
                write!(
                    f,
                    "dimension mismatch: matrix has {expected} rows, rhs has {got}"
                )
            }
        }
    }
}

impl std::error::Error for MatrixError {}

/// Solve `A x = b` for a square `A`, given as `n` row-major slices.
///
/// Partial pivoting is not optional here: the normal equations of a geodetic
/// inversion are notoriously ill-conditioned, and an unpivoted solve can return
/// a confident-looking answer that is wrong in the leading digit.
///
/// # Errors
///
/// Returns [`MatrixError::DimensionMismatch`] if `b` is not `n` long, and
/// [`MatrixError::Singular`] if a pivot underflows during elimination.
pub fn solve_linear(a: &[impl AsRef<[f64]>], b: &[f64]) -> Result<Vec<f64>, MatrixError> {
    let n = a.len();
    if n == 0 {
        return Err(MatrixError::Singular("empty system".into()));
    }
    if b.len() != n {
        return Err(MatrixError::DimensionMismatch {
            expected: n,
            got: b.len(),
        });
    }

    // Augmented working copy: rows are copied once so the caller's matrix is
    // never mutated, which matters when the same `JᵀJ` is reused for the
    // covariance after the solve.
    let mut m: Vec<Vec<f64>> = a.iter().map(|row| row.as_ref().to_vec()).collect();
    let mut x = b.to_vec();

    for col in 0..n {
        let mut pivot = col;
        for row in col + 1..n {
            if m[row][col].abs() > m[pivot][col].abs() {
                pivot = row;
            }
        }
        // 1e-300 rather than 0: the normal equations carry values spanning
        // many orders of magnitude, and a pivot that small relative to the
        // matrix norm is numerically zero anyway.
        if m[pivot][col].abs() < 1e-300 {
            return Err(MatrixError::Singular(format!("zero pivot in column {col}")));
        }
        if pivot != col {
            m.swap(pivot, col);
            x.swap(pivot, col);
        }

        let inv = 1.0 / m[col][col];
        // The inner loop indexes two different rows of `m` at once, so it
        // cannot be expressed as a single iterator without zip-walking two
        // mutable borrows - which Rust rejects. The range loop is the honest
        // form here.
        #[allow(clippy::needless_range_loop)]
        for row in col + 1..n {
            let factor = m[row][col] * inv;
            if factor == 0.0 {
                continue;
            }
            #[allow(clippy::needless_range_loop)]
            for k in col..n {
                m[row][k] -= factor * m[col][k];
            }
            x[row] -= factor * x[col];
        }
    }

    for row in (0..n).rev() {
        let mut acc = x[row];
        for k in row + 1..n {
            acc -= m[row][k] * x[k];
        }
        x[row] = acc / m[row][row];
    }
    Ok(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solves_a_diagonal_system() {
        let a = [[2.0, 0.0], [0.0, 4.0]];
        let x = solve_linear(&a, &[6.0, 8.0]).expect("solve");
        assert!((x[0] - 3.0).abs() < 1e-12);
        assert!((x[1] - 2.0).abs() < 1e-12);
    }

    #[test]
    fn solves_a_coupled_system() {
        let a = [[3.0, 2.0, -1.0], [1.0, -2.0, 3.0], [2.0, 1.0, 1.0]];
        let x = solve_linear(&a, &[8.0, -2.0, 9.0]).expect("solve");
        let expected = [-0.2, 6.0, 3.4];
        for (got, want) in x.iter().zip(&expected) {
            assert!((got - want).abs() < 1e-9, "got {got}, want {want}");
        }
    }

    #[test]
    fn pivots_when_the_leading_entry_is_zero() {
        let a = [[0.0, 1.0], [1.0, 0.0]];
        let x = solve_linear(&a, &[2.0, 5.0]).expect("solve");
        assert!((x[0] - 5.0).abs() < 1e-12);
        assert!((x[1] - 2.0).abs() < 1e-12);
    }

    #[test]
    fn reports_a_singular_matrix() {
        let a = [[1.0, 2.0], [2.0, 4.0]];
        assert!(matches!(
            solve_linear(&a, &[1.0, 2.0]),
            Err(MatrixError::Singular(_))
        ));
    }

    #[test]
    fn reports_a_dimension_mismatch() {
        let a = [[1.0, 0.0], [0.0, 1.0]];
        assert!(matches!(
            solve_linear(&a, &[1.0]),
            Err(MatrixError::DimensionMismatch {
                expected: 2,
                got: 1
            })
        ));
    }

    #[test]
    fn does_not_mutate_the_caller_matrix() {
        let a = [[2.0, 1.0], [1.0, 3.0]];
        let _ = solve_linear(&a, &[5.0, 10.0]);
        assert_eq!(a, [[2.0, 1.0], [1.0, 3.0]]);
    }
}
