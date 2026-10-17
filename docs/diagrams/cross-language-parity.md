# Cross-language parity

Three implementations of the same maths, and the tests that keep them honest.

```mermaid
flowchart TB
    SPEC["the formulation<br/>documented in docs/models.md"] --> TS["packages/core<br/>TypeScript<br/>the product"]
    SPEC --> RS["crates/engine<br/>Rust<br/>the reference oracle"]
    SPEC --> PY["services/agents<br/>Python<br/>the bulletin layer"]

    TS --> TST["vitest<br/>134 unit tests"]
    RS --> RST["cargo test<br/>10 integration tests"]
    PY --> PST["pytest<br/>21 tests"]

    TST --> PARITY["parity assertions"]
    RST --> PARITY
    PST --> PARITY

    TS -->|"mogiForward / mogiInvert<br/>same seeded field"| PARITY
    RS -->|"mogi_forward / mogi_invert<br/>same seeded field"| PARITY
    PY -.->|"rule table thresholds<br/>same indicator values"| PARITY

    PARITY -->|"< 1e-6 relative on<br/>depth, volume, RMS"| AGREE["the three agree"]
    PARITY -->|"disagreement"| FAIL["CI fails:<br/>a silent divergence<br/>has become a loud one"]

    AGREE --> TRUST["a depth printed by the UI<br/>can be reproduced<br/>independently of JavaScript"]

    classDef spec fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef impl fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef test fill:#14532d,stroke:#22c55e,color:#ecfdf5
    classDef out fill:#3f1d1d,stroke:#f87171,color:#fef2f2

    class SPEC spec
    class TS,RS,PY impl
    class TST,RST,PST,PARITY test
    class AGREE,TRUST,FAIL out
```

## Why write it three times

An inversion that only exists in one language is an inversion that cannot be
cross-checked. If `mogi.ts` has an algebra slip in its Jacobian, every test in
the repo passes - the tests assert against the same formulas, so a consistent
error is invisible. Reimplementing the same closed forms in Rust from the
documentation, without looking at the TypeScript, produces a second opinion
that disagrees whenever the first is wrong.

This is not hypothetical. Writing the Rust version surfaced a genuine
precedence bug in the degrees-of-freedom expression: `n * 3 - 4` written as
`n * (3 - 4)` compiles, passes a smoke test, and silently inflates every χ² in
the output. It was found by a parity assertion, not by reading the code.

## What is NOT cross-checked

The FFT is verified in Rust against known analytic properties - a pure tone
recovered to sub-bin accuracy, unit amplitude preserved through the window
correction, an exact bin-centred tone showing no leakage - rather than against
the TypeScript output. That is a weaker guarantee, and it is deliberate: the
two implementations agree on bin ordering, normalisation and windowing, so a
numeric diff would be dominated by round-off ordering rather than by
meaningful disagreement. The analytic tests are the sharper instrument here.

## What each language is actually for

| Language | Role | Why it exists |
| -------- | ---- | ------------- |
| TypeScript | The product | Runs in the browser and in Next.js; it is what a reader sees |
| Rust | The check | No React, no HTTP, no seed catalogue: numbers in, numbers out |
| Python | The bulletin | Text rendering and compositional statistics, in the language that does both well |
| Go | The relay | A long-running daemon with bounded memory and no dependency graph |
