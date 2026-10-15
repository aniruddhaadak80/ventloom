# CI pipeline

Four gates and a deploy, in order, none of which depend on anything that has
not already passed.

```mermaid
flowchart TB
    PR["pull request or push"] --> TYPE["typecheck<br/>tsc --noEmit per package"]
    TYPE --> LINT["lint<br/>biome check ."]
    LINT --> UNIT["unit tests<br/>vitest (134 tests)"]
    UNIT --> BUILD["build<br/>next build (24 routes)"]

    BUILD --> E2E["e2e<br/>playwright (18 assertions)<br/>against the built app"]

    E2E --> POLY["polyglot gates (parallel)"]
    POLY --> RUST["cargo check + cargo test"]
    POLY --> GO["go vet + go test -race"]
    POLY --> PY["ruff + mypy + pytest"]

    RUST --> ASSETS["asset check<br/>bun run assets --check"]
    GO --> ASSETS
    PY --> ASSETS

    ASSETS --> DEPLOY{"branch == main?"}
    DEPLOY -->|"no"| DONE1["done, waiting for merge"]
    DEPLOY -->|"yes"| VERCEL["vercel deploy --prod"]

    VERCEL --> SMOKE["smoke: curl /api/health<br/>on the live URL"]
    SMOKE --> LEDGER["append entry<br/>to the skill ledger"]

    classDef gate fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef pass fill:#14532d,stroke:#22c55e,color:#ecfdf5
    classDef branch fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef fail fill:#3f1d1d,stroke:#f87171,color:#fef2f2

    class TYPE,LINT,UNIT,BUILD,E2E,POLY,RUST,GO,PY,ASSETS gate
    class VERCEL,SMOKE,LEDGER pass
    class DEPLOY branch
    class DONE1 pass
```

## What each gate actually checks

| Gate | What would pass silently if it did not run | What a failure looks like |
| ---- | ----------------------------------------- | ------------------------- |
| `tsc --noEmit` | A renamed field in `@repo/core` breaking the SDK | red squiggles in CI logs |
| `biome check .` | An unused import, a `any`, an unhandled promise | a diff of the offending lines |
| `vitest` | The Mogi Jacobian off by a factor, silently | a specific assertion + the tolerance |
| `next build` | A missing `generateStaticParams`, a broken import | a stack trace in the build phase |
| `playwright` | A regression in the rendered page | screenshots + trace in artifacts |
| `cargo check` / `test` | A drift between Rust and TypeScript solvers | a named assertion + diff |
| `go vet` / `test -race` | A data race in the ring buffer | a stack trace + goroutine dump |
| `ruff` + `mypy` + `pytest` | A typo in the rule table, a broken bullet | FastAPI's validation errors |
| `assets --check` | A hand-edited SVG drifting from the generator | the list of mismatched files |

## Why `verify-before-completion` is a gate and not a suggestion

The habit this repo is built to enforce: evidence before assertions. Every "done" claim in the skill entries comes with the command that produced the green output, not with a reader's impression that it probably works. The workflow file makes running the gates cheaper than not running them, so that the default path is the correct one.
