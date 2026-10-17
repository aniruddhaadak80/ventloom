# 0003 - Rust exists as a parity oracle

Status: Accepted

## Context

A single-implementation inversion has no way to catch its own algebra. Tests
assert against the same formulas the code uses, so a consistently wrong Jacobian
passes every test it is run against.

## Decision

`crates/engine` reimplements the Mogi forward model, the analytic Jacobian and
the Levenberg-Marquardt solve from the documentation `docs/models.md`, without
referring to the TypeScript source. The same seeded field is fed to both and the
recovered depth, volume and RMS misfit are compared at `1e-6` relative in CI.

## Consequences

- Adding a feature to the solver means writing it twice. This is the cost.
- A divergence between the two is a loud, localised failure rather than a
  subtly wrong dashboard.
- Writing the Rust version has already found a real bug (operator precedence
  in the degrees-of-freedom expression) that survived TypeScript tests.
- Rust was chosen over Python for the reference because a Rust crate is a
  build artefact, not a dependency: it does not need to share a runtime with
  anything else in the repo and it builds offline.
