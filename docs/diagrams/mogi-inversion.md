# Mogi source inversion loop

Levenberg-Marquardt on four parameters `(e, f, d, ΔV)`, with the analytic
Jacobian. This is the signature surface of the repo.

```mermaid
flowchart TB
    OBS["observed displacement<br/>3n vector, metres"] --> GUESS{"initial guess supplied?"}
    GUESS -->|"no"| SEED_GUESS["initialSourceGuess()<br/>anchor at max |w|<br/>d ~ 0.6 x network aperture"]
    GUESS -->|"yes"| USE_GUESS["use as supplied"]
    SEED_GUESS --> CLAMP["clamp depth into<br/>[200 m, 30 km]"]
    USE_GUESS --> CLAMP

    CLAMP --> LOOP{"Levenberg-Marquardt loop"}

    LOOP --> J["analytic Jacobian J<br/>3n x 4, written by hand"]
    J --> NORM["normal equations<br/>(J<sup>T</sup>J + lambda diag(J<sup>T</sup>J)) d = J<sup>T</sup>r"]

    NORM --> SOLVE{"solve_linear()<br/>Gauss-Jordan + partial pivoting"}
    SOLVE -->|"singular"| SINGULAR["report MatrixError<br/>network cannot constrain source"]
    SOLVE -->|"ok"| TRIAL["trial source<br/>params + step"]

    TRIAL --> EVAL["residual vector<br/>observed - modelled"]
    EVAL --> ACCEPT{"trial cost < current?"}

    ACCEPT -->|"yes"| UPDATE["accept step<br/>lambda x 0.3 (min 1e-12)"]
    ACCEPT -->|"no"| REJECT["reject step<br/>lambda x 8 (max 1e12)"]

    UPDATE --> CONVERGED{"relative reduction<br/>< tolerance?"}
    REJECT --> SATURATED{"lambda saturated?"}

    CONVERGED -->|"yes"| DONE["converged = true"]
    CONVERGED -->|"no"| LOOP
    SATURATED -->|"yes"| DONE2["termination reason recorded"]
    SATURATED -->|"no"| LOOP
    LOOP -->|"max iterations"| DONE3["termination reason recorded"]

    DONE --> COV["covariance from final normal equations<br/>sigma^2 (J^T J) inverse"]
    DONE2 --> COV
    DONE3 --> COV

    COV --> FIT["Fit{}<br/>source, residuals, rms, chi-squared,<br/>parameter sigmas, correlations,<br/>condition number, cost history"]

    classDef in fill:#3f1d1d,stroke:#f87171,color:#fef2f2
    classDef step fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef branch fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef out fill:#14532d,stroke:#22c55e,color:#ecfdf5

    class OBS in
    class SEED_GUESS,USE_GUESS,CLAMP,J,NORM,TRIAL,EVAL,UPDATE,REJECT,COV step
    class GUESS,LOOP,SOLVE,ACCEPT,CONVERGED,SATURATED branch
    class FIT,_DONE,DONE2,DONE3,SINGULAR out
```

## Why a hand-written Jacobian

A centred finite difference has a truncation error of O(h²) and a round-off
error of O(ε/h). With a 4 mm measurement noise floor and ε ≈ 2.2e-16, the
optimal step is around 1e-5 m and the best achievable derivative accuracy is
roughly 1e-6 m/m. That sounds fine until you notice the solver would then be
spending its iterations chasing *differencing* error rather than misfit. Writing
the four partial derivatives out closes that off entirely, and
`mogi.test.ts` checks them against a finite difference at a tolerance of 1e-5,
so the algebra is verified rather than trusted.

## Why the damping is against the diagonal

Levenberg's `(JᵀJ + λ·diag(JᵀJ))` form scales each parameter's damping by its
own curvature. Marquardt's original `(JᵀJ + λI)` does not, which means a
parameter measured in cubic metres and one measured in metres get the same
additive damping even though their normal-equation diagonals differ by twelve
orders of magnitude. In geodetic inversions that mismatch is the difference
between a solver that converges and one that stalls on its first step.

## Why depth is bounded

The Mogi model has a genuine degeneracy: as `d → ∞` with `ΔV ∝ d³`, the surface
field is unchanged. An unbounded solver will happily walk toward infinity along
that ridge and report a deep, enormous source with an excellent misfit. The
bounds do not hide that degeneracy — the correlation matrix reports it — they
just stop the optimiser from leaving the region where the point-source
approximation means anything.
