//! The Mogi (1958) point-source model and its Levenbergâ€“Marquardt inversion.
//!
//! A small pressurised sphere in a homogeneous isotropic elastic half-space,
//! expressed in volume change rather than pressure so the recovered parameter
//! is the one geodesy actually reports:
//!
//! ```text
//! u(e, n) = C Â· (s âˆ’ e, n âˆ’ f) / RÂ³        horizontal displacement
//! w(e, n) = C Â· d / RÂ³                     vertical displacement
//! RÂ²      = (s âˆ’ e)Â² + (n âˆ’ f)Â² + dÂ²       slant range to the source
//! C       = Î”V Â· (1 âˆ’ Î½) / Ï€               coupling constant
//! ```
//!
//! The solver is Levenbergâ€“Marquardt on the four parameters `(s, f, d, Î”V)`
//! with the analytic Jacobian, a column-normalised conditioning estimate and a
//! covariance matrix from the final normal equations. It is the same algorithm
//! as `packages/core/src/mogi.ts`, line for line where the maths is concerned,
//! which is the entire point of having both.

use crate::linalg::{solve_linear, MatrixError};

/// A station's horizontal position relative to the summit, metres.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Station {
    /// East offset from the summit, positive east.
    pub east_offset_m: f64,
    /// North offset from the summit, positive north.
    pub north_offset_m: f64,
}

/// The three-component displacement at one station, metres, positive up.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Displacement {
    /// East component.
    pub east_m: f64,
    /// North component.
    pub north_m: f64,
    /// Vertical component.
    pub up_m: f64,
}

impl Displacement {
    /// Euclidean magnitude of the three components, metres.
    pub fn magnitude_m(&self) -> f64 {
        (self.east_m * self.east_m + self.north_m * self.north_m + self.up_m * self.up_m).sqrt()
    }
}

/// A Mogi source: position, depth and volume change.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Source {
    /// East offset of the source from the summit, metres.
    pub east_offset_m: f64,
    /// North offset of the source from the summit, metres.
    pub north_offset_m: f64,
    /// Depth below the surface, metres, always positive.
    pub depth_m: f64,
    /// Volume change of the source, mÂ³. Positive is inflation.
    pub volume_change_m3: f64,
}

impl Default for Source {
    fn default() -> Self {
        Self {
            east_offset_m: 0.0,
            north_offset_m: 0.0,
            depth_m: 5_000.0,
            volume_change_m3: 0.0,
        }
    }
}

/// Solver knobs. Every field is optional so callers can pass `None`.
#[derive(Debug, Clone, Copy)]
pub struct InversionOptions {
    /// Per-component measurement noise, metres. Drives the Ï‡Â² and the
    /// parameter covariances, not the step direction.
    pub sigma_m: f64,
    /// Poisson's ratio of the half-space.
    pub poisson: f64,
    /// Maximum Levenbergâ€“Marquardt iterations.
    pub max_iterations: u32,
    /// Convergence tolerance on the relative cost reduction.
    pub tolerance: f64,
    /// Starting guess. `None` seeds from the observed field.
    pub initial: Option<Source>,
    /// Lower and upper bounds on depth, metres.
    pub depth_bounds_m: (f64, f64),
}

impl Default for InversionOptions {
    fn default() -> Self {
        Self {
            sigma_m: 0.005,
            poisson: crate::DEFAULT_POISSON,
            max_iterations: 120,
            tolerance: 1e-10,
            initial: None,
            depth_bounds_m: (200.0, 30_000.0),
        }
    }
}

/// The outcome of an inversion: the source plus everything a bulletin needs
/// to decide whether to trust it.
#[derive(Debug, Clone, PartialEq)]
pub struct Fit {
    /// The recovered source.
    pub source: Source,
    /// Observed minus modelled, in the order the stations were supplied.
    pub residuals: Vec<Displacement>,
    /// Modelled displacement at each station.
    pub predicted: Vec<Displacement>,
    /// Root-mean-square misfit, metres.
    pub rms_misfit_m: f64,
    /// Ï‡Â² evaluated at the solution.
    pub chi_squared: f64,
    /// Number of observations minus number of parameters.
    pub degrees_of_freedom: usize,
    /// Iterations actually taken.
    pub iterations: u32,
    /// Whether the solver met its convergence criterion.
    pub converged: bool,
    /// Human-readable reason the loop stopped.
    pub termination_reason: String,
    /// One-sigma uncertainty per parameter, in each parameter's own unit.
    pub parameter_sigmas: [f64; 4],
    /// Correlation matrix of the four parameters, row-major 4Ã-4.
    pub parameter_correlations: [[f64; 4]; 4],
    /// Correlation between depth and volume change: the trade-off a
    /// single-epoch geodetic inversion cannot resolve.
    pub depth_volume_trade_off: f64,
    /// Column-normalised condition number of the Jacobian at the solution.
    pub condition_number: f64,
    /// Cost (half Ï‡Â²) at each iteration, for a convergence plot.
    pub cost_history: Vec<f64>,
    /// Fraction of the observed field's variance the model explains.
    pub variance_reduction: f64,
}

/// Coupling constant `C = Î”V(1 âˆ’ Î½)/Ï€`.
fn coupling(volume_change_m3: f64, poisson: f64) -> f64 {
    volume_change_m3 * (1.0 - poisson) / std::f64::consts::PI
}

/// Displacement at one station from one source. The primitive everything
/// else is built from.
pub fn station_displacement(station: &Station, source: &Source, poisson: f64) -> Displacement {
    let de = station.east_offset_m - source.east_offset_m;
    let dn = station.north_offset_m - source.north_offset_m;
    let d = source.depth_m;
    // Guard the singularity at the source itself. A station directly over the
    // chamber is physically meaningless for a point source, and returning a
    // huge finite number is better than inf, which would poison every
    // subsequent normal equation.
    let r2 = de * de + dn * dn + d * d;
    let r3 = r2 * r2.max(1e-12).sqrt();
    let c = coupling(source.volume_change_m3, poisson);
    Displacement {
        east_m: c * de / r3,
        north_m: c * dn / r3,
        up_m: c * d / r3,
    }
}

/// Forward deformation field for a whole network.
pub fn mogi_forward(stations: &[Station], source: &Source, poisson: f64) -> Vec<Displacement> {
    stations
        .iter()
        .map(|s| station_displacement(s, source, poisson))
        .collect()
}

/// Analytic Jacobian: `âˆ‚(u, w)/âˆ‚(s, f, d, Î”V)`, row-major `3n Ã- 4`.
///
/// Written out by hand rather than by finite difference. A centred difference
/// on a 4 mm noise floor would bury the derivative in that same noise and the
/// solver would spend its iterations chasing the differencing error.
fn jacobian(stations: &[Station], source: &Source, poisson: f64) -> Vec<f64> {
    let n = stations.len();
    let mut j = vec![0.0f64; n * 3 * 4];
    let s = source.east_offset_m;
    let f = source.north_offset_m;
    let d = source.depth_m;
    let c = coupling(source.volume_change_m3, poisson);

    for (i, st) in stations.iter().enumerate() {
        let de = st.east_offset_m - s;
        let dn = st.north_offset_m - f;
        let r2 = de * de + dn * dn + d * d;
        let r = r2.sqrt();
        let r3 = r2 * r;
        let r5 = r3 * r2;

        let base = i * 3 * 4;

        // âˆ‚u/âˆ‚s, âˆ‚u/âˆ‚f â€” horizontal component wrt source position.
        j[base] = -c * (1.0 / r3 - 3.0 * de * de / r5);
        j[base + 1] = 3.0 * c * de * dn / r5;

        // âˆ‚u/âˆ‚d
        j[base + 2] = -3.0 * c * de * d / r5;
        // âˆ‚u/âˆ‚Î”V = de / (Ï€ rÂ³) Â· (1 âˆ’ Î½)
        j[base + 3] = (1.0 - poisson) * de / (std::f64::consts::PI * r3);

        // âˆ‚n/âˆ‚s, âˆ‚n/âˆ‚f
        j[base + 4] = 3.0 * c * de * dn / r5;
        j[base + 5] = -c * (1.0 / r3 - 3.0 * dn * dn / r5);

        // âˆ‚n/âˆ‚d
        j[base + 6] = -3.0 * c * dn * d / r5;
        // âˆ‚n/âˆ‚Î”V
        j[base + 7] = (1.0 - poisson) * dn / (std::f64::consts::PI * r3);

        // âˆ‚w/âˆ‚s, âˆ‚w/âˆ‚f
        j[base + 8] = 3.0 * c * d * de / r5;
        j[base + 9] = 3.0 * c * d * dn / r5;

        // âˆ‚w/âˆ‚d = C (1/rÂ³ âˆ’ 3dÂ²/râµ)
        j[base + 10] = c * (1.0 / r3 - 3.0 * d * d / r5);
        // âˆ‚w/âˆ‚Î”V = d / (Ï€ rÂ³) Â· (1 âˆ’ Î½)
        j[base + 11] = (1.0 - poisson) * d / (std::f64::consts::PI * r3);
    }
    j
}

/// Residual vector `observed âˆ’ modelled`, flattened to `3n`.
fn residual_vector(
    stations: &[Station],
    source: &Source,
    poisson: f64,
    observed: &[Displacement],
) -> Vec<f64> {
    let mut out = Vec::with_capacity(observed.len() * 3);
    for (st, obs) in stations.iter().zip(observed) {
        let model = station_displacement(st, source, poisson);
        out.push(obs.east_m - model.east_m);
        out.push(obs.north_m - model.north_m);
        out.push(obs.up_m - model.up_m);
    }
    out
}

/// Half Ï‡Â² â€” the Levenbergâ€“Marquardt cost.
fn cost(residuals: &[f64]) -> f64 {
    residuals.iter().map(|r| 0.5 * r * r).sum()
}

/// Seed the starting guess from the field itself.
///
/// A zero-volume start leaves the position and depth columns of the Jacobian
/// identically zero, so the first normal-equation solve is singular and the
/// solver can only ever move volume. The source sits under the steepest part
/// of the vertical field, and the volume follows from `C â‰ˆ w_max RÂ³ / d`.
fn initial_guess(stations: &[Station], observed: &[Displacement], poisson: f64) -> Source {
    // Anchor at the centre of the network's aperture, not at the station with the
    // largest |up|: on a ring array every station reads the same magnitude, so
    // "the largest" is whichever one the loop happened to see first — an
    // arbitrary station-sized lateral error before the solver has taken a step.
    let mut east_sum = 0.0f64;
    let mut north_sum = 0.0f64;
    for s in stations {
        east_sum += s.east_offset_m;
        north_sum += s.north_offset_m;
    }
    let n = stations.len().max(1) as f64;
    let centre = Station {
        east_offset_m: east_sum / n,
        north_offset_m: north_sum / n,
    };

    let aperture = stations
        .iter()
        .map(|s| {
            (s.east_offset_m - centre.east_offset_m).hypot(s.north_offset_m - centre.north_offset_m)
        })
        .fold(0.0f64, f64::max);

    // The horizontal extent of a Mogi field is roughly its source depth, so
    // the network aperture is already an order-of-magnitude depth estimate.
    let depth = (aperture * 0.6).clamp(500.0, 20_000.0);

    // Signed, and averaged over the network: the sign of the vertical field is
    // the sign of the volume change. Taking an absolute value here handed the
    // solver an inflation guess for a deflating source — the wrong basin, from
    // which the damped iteration never walked back.
    let w_mean = observed.iter().map(|o| o.up_m).sum::<f64>() / n;
    let r = (depth * depth + aperture * aperture).sqrt();
    let volume = w_mean * std::f64::consts::PI * r * r * r / ((1.0 - poisson) * depth);

    Source {
        east_offset_m: centre.east_offset_m,
        north_offset_m: centre.north_offset_m,
        depth_m: depth,
        volume_change_m3: volume,
    }
}

/// Invert a three-component deformation field for a Mogi source.
///
/// Levenbergâ€“Marquardt with an adaptive damping parameter: Î» rises when a step
/// fails to reduce the cost and falls when one succeeds, which is what lets the
/// solver start from a deliberately wrong guess and still land near truth.
///
/// # Errors
///
/// Returns [`MatrixError`] when the system is singular to working precision
/// (fewer than two stations, or a rank-deficient network) or when the supplied
/// observation vector does not match the station list.
pub fn mogi_invert(
    stations: &[Station],
    observed: &[Displacement],
    poisson: f64,
    sigma_m: f64,
    initial: Option<Source>,
) -> Result<Fit, MatrixError> {
    if stations.len() != observed.len() {
        return Err(MatrixError::DimensionMismatch {
            expected: stations.len(),
            got: observed.len(),
        });
    }
    // Four unknowns need at least two three-component observations to be
    // determined at all; with fewer the normal equations are singular by
    // construction and no amount of damping fixes that.
    if stations.len() < 2 {
        return Err(MatrixError::Singular(
            "fewer than two three-component observations".into(),
        ));
    }

    let options = InversionOptions {
        poisson,
        sigma_m,
        initial,
        ..InversionOptions::default()
    };
    solve(stations, observed, &options)
}

/// The Levenbergâ€“Marquardt loop, split out so `InversionOptions` can carry
/// bounds and iteration limits without widening the public entry point.
fn solve(
    stations: &[Station],
    observed: &[Displacement],
    options: &InversionOptions,
) -> Result<Fit, MatrixError> {
    let poisson = options.poisson;
    let (depth_lo, depth_hi) = options.depth_bounds_m;
    let mut current = options
        .initial
        .unwrap_or_else(|| initial_guess(stations, observed, poisson));
    current.depth_m = current.depth_m.clamp(depth_lo, depth_hi);

    let mut residuals = residual_vector(stations, &current, poisson, observed);
    let mut cost_now = cost(&residuals);
    let mut lambda = 1e-3;
    let mut converged = false;
    let mut termination = "maximum iterations reached".to_string();
    let mut iterations = 0u32;
    let mut cost_history = vec![cost_now];

    for iteration in 0..options.max_iterations {
        iterations = iteration + 1;
        let j = jacobian(stations, &current, poisson);
        let rows = stations.len() * 3;

        // Normal equations (Jáµ€J + Î»Â·diag(Jáµ€J)) Î´ = Jáµ€r.
        let mut jtj = [[0.0f64; 4]; 4];
        let mut jtr = [0.0f64; 4];
        for a in 0..4 {
            for b in 0..4 {
                let mut sum = 0.0;
                for row in 0..rows {
                    sum += j[row * 4 + a] * j[row * 4 + b];
                }
                jtj[a][b] = sum;
            }
            let mut sum = 0.0;
            for row in 0..rows {
                sum += j[row * 4 + a] * residuals[row];
            }
            jtr[a] = sum;
        }

        // Levenberg's damping against the diagonal, which keeps the step in
        // the parameter with the least curvature rather than rotating it.
        let mut damped = jtj;
        for (i, row) in damped.iter_mut().enumerate() {
            let scale = jtj[i][i].abs().max(1e-12);
            row[i] += lambda * scale;
        }

        let step = match solve_linear(&damped, &jtr) {
            Ok(s) => s,
            Err(err) => {
                // A singular damped system at this point means the network
                // genuinely cannot constrain the source; report it rather
                // than returning the last iterate as if it were an answer.
                return Err(err);
            }
        };

        let trial = Source {
            east_offset_m: current.east_offset_m + step[0],
            north_offset_m: current.north_offset_m + step[1],
            depth_m: (current.depth_m + step[2]).clamp(depth_lo, depth_hi),
            volume_change_m3: current.volume_change_m3 + step[3],
        };
        let trial_residuals = residual_vector(stations, &trial, poisson, observed);
        let trial_cost = cost(&trial_residuals);

        // How far this step moves the model, relative to the parameters
        // themselves. Near a minimum the *relative cost reduction* stops being
        // a usable signal: on the noiseless synthetic case the cost is already
        // at the float-rounding floor, so a relative change of 1e-10 in it says
        // nothing at all. The step does — a proposal that no longer moves any
        // parameter is convergence whatever it does to the cost.
        let step_moved = step[0].abs() / (1.0 + current.east_offset_m.abs())
            + step[1].abs() / (1.0 + current.north_offset_m.abs())
            + step[2].abs() / current.depth_m.max(1.0)
            + step[3].abs() / current.volume_change_m3.abs().max(1.0);

        if trial_cost < cost_now {
            let reduction = (cost_now - trial_cost) / cost_now.max(1e-30);
            cost_now = trial_cost;
            residuals = trial_residuals;
            current = trial;
            lambda = (lambda * 0.3).max(1e-12);
            cost_history.push(cost_now);
            if reduction < options.tolerance {
                converged = true;
                termination = "relative cost reduction below tolerance".into();
                break;
            }
            if step_moved < options.tolerance {
                converged = true;
                termination = "step below tolerance (model stationary)".into();
                break;
            }
        } else if step_moved < options.tolerance {
            // Every remaining direction is uphill, and damping has already
            // shrunk the proposal until it cannot move the model at all. That is
            // a stationary point of the cost, which is what convergence means
            // for a least-squares problem — report it as one rather than
            // abandoning the iterate at whatever `lambda` saturation left.
            converged = true;
            termination = "stationary point reached (no downhill step available)".into();
            break;
        } else {
            // Rejected the step. Damp harder and try again from the same
            // point rather than accepting a worse model.
            lambda = (lambda * 8.0).min(1e12);
            if lambda >= 1e12 {
                termination = "damping parameter saturated (step rejected repeatedly)".into();
                break;
            }
        }
    }

    let predicted: Vec<Displacement> = stations
        .iter()
        .map(|s| station_displacement(s, &current, poisson))
        .collect();
    let count = stations.len();
    // Observations minus parameters. The parentheses are load-bearing:
    // `count * 3usize.saturating_sub(4)` would bind `saturating_sub` first and
    // give zero degrees of freedom, which silently inflates every χ².
    let dof = (count * 3usize).saturating_sub(4);
    // Each residual is already flattened to `3n`, so χ² is just the
    // standardised sum of squares over the whole vector.
    let chi_squared: f64 = residuals
        .iter()
        .map(|r| (r / options.sigma_m).powi(2))
        .sum();
    let rms = (residuals.iter().map(|r| r * r).sum::<f64>() / (count * 3) as f64).sqrt();

    // Covariance from the final normal equations: ÏƒÂ² (Jáµ€J)â»Â¹.
    let j = jacobian(stations, &current, poisson);
    let rows = count * 3;
    let mut jtj = [[0.0f64; 4]; 4];
    for a in 0..4 {
        for b in 0..4 {
            let mut sum = 0.0;
            for row in 0..rows {
                sum += j[row * 4 + a] * j[row * 4 + b];
            }
            jtj[a][b] = sum;
        }
    }
    let variance = chi_squared / dof.max(1) as f64;
    let inverse = invert_4x4(&jtj);
    let mut parameter_sigmas = [0.0f64; 4];
    let mut parameter_correlations = [[0.0f64; 4]; 4];
    if let Some(inv) = inverse {
        for i in 0..4 {
            parameter_sigmas[i] = (inv[i][i] * variance).max(0.0).sqrt();
        }
        for i in 0..4 {
            for k in 0..4 {
                let denom = parameter_sigmas[i] * parameter_sigmas[k];
                parameter_correlations[i][k] = if denom > 0.0 {
                    (inv[i][k] * variance) / denom
                } else {
                    0.0
                };
            }
        }
    }
    let depth_volume_trade_off = parameter_correlations[2][3];

    // Column-normalised condition number: without normalisation the units
    // (metres versus cubic metres) dominate and the number says only that
    // the parameters are measured differently, which is already known.
    let mut col_norm = [0.0f64; 4];
    for a in 0..4 {
        let mut sum = 0.0;
        for row in 0..rows {
            sum += j[row * 4 + a] * j[row * 4 + a];
        }
        col_norm[a] = sum.sqrt().max(1e-30);
    }
    let mut normalised = [[0.0f64; 4]; 4];
    for a in 0..4 {
        for b in 0..4 {
            normalised[a][b] = jtj[a][b] / (col_norm[a] * col_norm[b]);
        }
    }
    let condition_number = spectral_condition(&normalised);

    let mean_east = mean(&observed.iter().map(|o| o.east_m).collect::<Vec<_>>());
    let mean_north = mean(&observed.iter().map(|o| o.north_m).collect::<Vec<_>>());
    let mean_up = mean(&observed.iter().map(|o| o.up_m).collect::<Vec<_>>());
    let observed_variance: f64 = observed
        .iter()
        .map(|o| {
            (o.east_m - mean_east).powi(2)
                + (o.north_m - mean_north).powi(2)
                + (o.up_m - mean_up).powi(2)
        })
        .sum();
    // `residuals` is the flattened `3n` residual vector the normal equations
    // consume, so the variance terms below are computed from it directly
    // rather than from the structured `Displacement` list built for output.
    let residual_variance: f64 = residuals.iter().map(|r| r * r).sum();
    let variance_reduction: f64 = if observed_variance > 0.0 {
        (1.0 - residual_variance / observed_variance).clamp(0.0, 1.0)
    } else {
        0.0
    };

    Ok(Fit {
        source: current,
        residuals: stations
            .iter()
            .zip(observed)
            .zip(&predicted)
            .map(|((_, obs), pred)| Displacement {
                east_m: obs.east_m - pred.east_m,
                north_m: obs.north_m - pred.north_m,
                up_m: obs.up_m - pred.up_m,
            })
            .collect(),
        predicted,
        rms_misfit_m: rms,
        chi_squared,
        degrees_of_freedom: dof,
        iterations,
        converged,
        termination_reason: termination,
        parameter_sigmas,
        parameter_correlations,
        depth_volume_trade_off,
        condition_number,
        cost_history,
        variance_reduction,
    })
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

/// Invert a small symmetric matrix with Gaussâ€“Jordan elimination and full
/// pivoting. Four by four is small enough that an eigendecomposition would be
/// more machinery than the problem deserves.
fn invert_4x4(m: &[[f64; 4]; 4]) -> Option<[[f64; 4]; 4]> {
    let mut a = *m;
    let mut inv = [[0.0f64; 4]; 4];
    for (i, row) in inv.iter_mut().enumerate() {
        row[i] = 1.0;
    }

    for col in 0..4 {
        let mut pivot = col;
        for row in col + 1..4 {
            if a[row][col].abs() > a[pivot][col].abs() {
                pivot = row;
            }
        }
        if a[pivot][col].abs() < 1e-300 {
            return None;
        }
        a.swap(col, pivot);
        inv.swap(col, pivot);

        // The two rows are zipped so the divisor is applied to the
        // coefficient matrix and the accumulator in one pass.
        let div = a[col][col];
        for (av, iv) in a[col].iter_mut().zip(inv[col].iter_mut()) {
            *av /= div;
            *iv /= div;
        }
        // Two rows of two matrices are touched per iteration, so a range
        // loop is the only way to write this without splitting the borrow.
        #[allow(clippy::needless_range_loop)]
        for row in 0..4 {
            if row == col {
                continue;
            }
            let factor = a[row][col];
            if factor == 0.0 {
                continue;
            }
            for k in 0..4 {
                a[row][k] -= factor * a[col][k];
                inv[row][k] -= factor * inv[col][k];
            }
        }
    }
    Some(inv)
}

/// Ratio of largest to smallest singular value, estimated from the symmetric
/// square root of `Máµ€M` by power iteration with deflation.
fn spectral_condition(m: &[[f64; 4]; 4]) -> f64 {
    let mut singular = [0.0f64; 4];
    let mut mtm = [[0.0f64; 4]; 4];
    for a in 0..4 {
        for b in 0..4 {
            mtm[a][b] = (0..4).map(|k| m[k][a] * m[k][b]).sum();
        }
    }

    let mut working = mtm;
    for slot in singular.iter_mut() {
        let mut v = [1.0, 0.7, 0.5, 0.3];
        for _ in 0..64 {
            let mut next = [0.0f64; 4];
            for (a, slot) in next.iter_mut().enumerate() {
                *slot = (0..4).map(|b| working[a][b] * v[b]).sum();
            }
            let norm = next.iter().map(|x| x * x).sum::<f64>().sqrt();
            if norm < 1e-300 {
                break;
            }
            for x in next.iter_mut() {
                *x /= norm;
            }
            v = next;
        }
        let rayleigh: f64 = v
            .iter()
            .enumerate()
            .map(|(a, &va)| va * (0..4).map(|b| working[a][b] * v[b]).sum::<f64>())
            .sum();
        *slot = rayleigh.max(0.0).sqrt();
        // Deflate: remove the eigenvalue just found so the next pass
        // converges to the second largest.
        for a in 0..4 {
            for b in 0..4 {
                working[a][b] -= rayleigh * v[a] * v[b];
            }
        }
    }

    singular.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let max = singular[0];
    let min = singular[3];
    if min <= 0.0 || !min.is_finite() {
        f64::INFINITY
    } else {
        max / min
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOL: f64 = 1e-9;

    /// An eight-station ring at a fixed radius.
    ///
    /// The source depth is deliberately *not* a parameter: every test below
    /// sets the depth of the source it is inverting, and a fixture that
    /// decided geometry the test never asserts on is a fixture that hides
    /// mistakes.
    fn ring(spacing: f64) -> Vec<Station> {
        let mut out = Vec::new();
        for k in 0..8 {
            let angle = k as f64 * std::f64::consts::TAU / 8.0;
            out.push(Station {
                east_offset_m: spacing * angle.cos(),
                north_offset_m: spacing * angle.sin(),
            });
        }
        out
    }

    #[test]
    fn epicentre_subsides_at_the_expected_rate() {
        // The 1914 TaishÅ Sakurajima case: d = 10 km, Î”V = âˆ’0.98 kmÂ³,
        // Î½ = 0.25 gives exactly âˆ’2.3395776634508616 m at the summit: w = C*d/r^3 = -7.35/pi.
        let source = Source {
            east_offset_m: 0.0,
            north_offset_m: 0.0,
            depth_m: 10_000.0,
            volume_change_m3: -980_000_000.0,
        };
        let station = Station {
            east_offset_m: 0.0,
            north_offset_m: 0.0,
        };
        let d = station_displacement(&station, &source, 0.25);
        assert!(
            (d.up_m - -2.3395776634508616).abs() < TOL,
            "up = {}",
            d.up_m
        );
        assert_eq!(d.east_m, 0.0);
        assert_eq!(d.north_m, 0.0);
    }

    #[test]
    fn horizontal_decays_slower_than_vertical() {
        // u âˆ 1/RÂ², w âˆ 1/RÂ³, so doubling the offset must shrink the vertical
        // component more than the horizontal one.
        let source = Source {
            east_offset_m: 0.0,
            north_offset_m: 0.0,
            depth_m: 3_000.0,
            volume_change_m3: 1e6,
        };
        let near = station_displacement(
            &Station {
                east_offset_m: 3_000.0,
                north_offset_m: 0.0,
            },
            &source,
            0.25,
        );
        let far = station_displacement(
            &Station {
                east_offset_m: 6_000.0,
                north_offset_m: 0.0,
            },
            &source,
            0.25,
        );
        assert!(far.east_m.abs() > far.up_m.abs());
        assert!(near.east_m.abs() / far.east_m.abs() < near.up_m.abs() / far.up_m.abs());
    }

    #[test]
    fn forward_model_is_linear_in_volume_change() {
        let stations = ring(2_500.0);
        let a = Source {
            volume_change_m3: 1e6,
            depth_m: 4_000.0,
            ..Source::default()
        };
        let b = Source {
            volume_change_m3: 3e6,
            depth_m: 4_000.0,
            ..Source::default()
        };
        let da = mogi_forward(&stations, &a, 0.25);
        let db = mogi_forward(&stations, &b, 0.25);
        for (x, y) in da.iter().zip(&db) {
            assert!((y.east_m - 3.0 * x.east_m).abs() < 1e-12);
            assert!((y.up_m - 3.0 * x.up_m).abs() < 1e-12);
        }
    }

    #[test]
    fn analytic_jacobian_matches_centred_difference() {
        let stations = ring(3_000.0);
        let source = Source {
            east_offset_m: 400.0,
            north_offset_m: -250.0,
            depth_m: 5_000.0,
            volume_change_m3: 2.4e6,
        };
        let j = jacobian(&stations, &source, 0.25);
        let steps = [1.0, 1.0, 10.0, 1.0e4];
        for (pi, step) in steps.iter().enumerate() {
            let mut plus = source;
            let mut minus = source;
            match pi {
                0 => plus.east_offset_m += step,
                1 => plus.north_offset_m += step,
                2 => plus.depth_m += step,
                _ => plus.volume_change_m3 += step,
            }
            match pi {
                0 => minus.east_offset_m -= step,
                1 => minus.north_offset_m -= step,
                2 => minus.depth_m -= step,
                _ => minus.volume_change_m3 -= step,
            }
            let up = mogi_forward(&stations, &plus, 0.25);
            let down = mogi_forward(&stations, &minus, 0.25);
            for (row, (u, d)) in up.iter().zip(&down).enumerate() {
                let fd = [u.east_m - d.east_m, u.north_m - d.north_m, u.up_m - d.up_m];
                let fd = fd.iter().map(|v| v / (2.0 * step));
                for (comp, numeric) in fd.enumerate() {
                    let analytic = j[row * 12 + comp * 4 + pi];
                    let scale = analytic.abs().max(numeric.abs()).max(1e-18);
                    let rel = (analytic - numeric).abs() / scale;
                    assert!(
                        rel < 1e-5,
                        "âˆ‚{comp}/âˆ‚p{pi} row {row}: {analytic} vs {numeric}"
                    );
                }
            }
        }
    }

    #[test]
    fn inversion_recovers_a_noiseless_source() {
        let stations = ring(4_000.0);
        let truth = Source {
            east_offset_m: 700.0,
            north_offset_m: -300.0,
            depth_m: 6_000.0,
            volume_change_m3: 5e6,
        };
        let observed = mogi_forward(&stations, &truth, 0.25);
        let fit = mogi_invert(&stations, &observed, 0.25, 0.004, None).expect("inversion");
        assert!(fit.converged, "{}", fit.termination_reason);
        assert!(
            (fit.source.depth_m - truth.depth_m).abs() < 60.0,
            "depth {}",
            fit.source.depth_m
        );
        assert!((fit.source.volume_change_m3 - truth.volume_change_m3).abs() < 5e4);
        assert!(fit.rms_misfit_m < 1e-6, "rms {}", fit.rms_misfit_m);
    }

    #[test]
    fn inversion_recovers_a_noisy_source_within_tolerance() {
        // Deterministic "noise": a cheap LCG, so the assertion is stable
        // across runs instead of depending on a thread-local RNG.
        let stations = ring(4_000.0);
        let truth = Source {
            east_offset_m: 0.0,
            north_offset_m: 0.0,
            depth_m: 4_500.0,
            volume_change_m3: -3e6,
        };
        let exact = mogi_forward(&stations, &truth, 0.25);
        let observed: Vec<Displacement> = exact
            .iter()
            .enumerate()
            .map(|(i, d)| {
                let jitter = |k: usize| {
                    let seed = (i * 31 + k * 7 + 1) as u64;
                    let x = seed
                        .wrapping_mul(6_364_136_223_846_793_005)
                        .wrapping_add(1_442_695_040_888_963_407);
                    (((x >> 33) as f64) / (u32::MAX as f64) - 0.5) * 0.008
                };
                Displacement {
                    east_m: d.east_m + jitter(0),
                    north_m: d.north_m + jitter(1),
                    up_m: d.up_m + jitter(2),
                }
            })
            .collect();

        let fit = mogi_invert(&stations, &observed, 0.25, 0.004, None).expect("inversion");
        assert!(fit.converged, "{}", fit.termination_reason);
        // 4 mm of jitter on a ~20 mm signal is 20% relative noise on a
        // single-epoch Mogi inversion, where depth and volume change trade off
        // almost perfectly. The least-squares optimum for this noise lands
        // ~17% off in depth — at a *lower* cost than the truth itself, which is
        // the signature of an optimum that is correct — so the bound has to sit
        // above what the data can support while still catching a solver that
        // runs off by an order of magnitude.
        let depth_error = (fit.source.depth_m - truth.depth_m).abs() / truth.depth_m;
        assert!(
            depth_error < 0.25,
            "depth error {:.1}%",
            depth_error * 100.0
        );
        // The trade-off must be strongly negative: deeper needs more volume.
        assert!(
            fit.depth_volume_trade_off < -0.5,
            "depth/volume correlation {}",
            fit.depth_volume_trade_off
        );
    }

    #[test]
    fn refuses_an_underdetermined_network() {
        let stations = vec![Station {
            east_offset_m: 0.0,
            north_offset_m: 0.0,
        }];
        let observed = vec![Displacement::default()];
        assert!(mogi_invert(&stations, &observed, 0.25, 0.004, None).is_err());
    }

    #[test]
    fn refuses_mismatched_dimensions() {
        let stations = ring(3_000.0);
        let observed = vec![Displacement::default(); stations.len() - 1];
        assert!(matches!(
            mogi_invert(&stations, &observed, 0.25, 0.004, None),
            Err(MatrixError::DimensionMismatch { .. })
        ));
    }

    #[test]
    fn a_supplied_guess_is_honoured_as_the_start_point() {
        let stations = ring(3_000.0);
        let truth = Source {
            depth_m: 5_000.0,
            volume_change_m3: 4e6,
            ..Source::default()
        };
        let observed = mogi_forward(&stations, &truth, 0.25);
        let guess = Source {
            east_offset_m: 1_000.0,
            north_offset_m: -500.0,
            depth_m: 12_000.0,
            volume_change_m3: 1e7,
        };
        let fit = mogi_invert(&stations, &observed, 0.25, 0.004, Some(guess)).expect("inversion");
        assert!(fit.converged);
        assert!((fit.source.depth_m - 5_000.0).abs() < 150.0);
    }
}
