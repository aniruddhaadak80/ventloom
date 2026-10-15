# Monorepo package dependency graph

```mermaid
graph LR
    subgraph apps
        WEB["@repo/web<br/>Next.js 15 app"]
    end

    subgraph packages
        UI["@repo/ui<br/>primitives + charts"]
        SDK["@repo/sdk<br/>typed client"]
        CORE["@repo/core<br/>deterministic engine"]
        SEED["@repo/seed<br/>catalogue + network"]
    end

    subgraph polyglot["Siblings, not workspaces"]
        ENGINE["crates/engine<br/>Rust oracle"]
        AGENTS["services/agents<br/>FastAPI bulletins"]
        RELAY["services/relay<br/>Go telemetry daemon"]
    end

    WEB --> UI
    WEB --> SDK
    WEB --> CORE
    WEB --> SEED
    SDK --> CORE
    SEED --> CORE

    ENGINE -.->|"formulas mirrored,<br/>checked in CI"| CORE
    AGENTS -.->|"rule table mirrored"| CORE
    RELAY -->|"HTTP polling"| WEB

    classDef app fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef pkg fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef sib fill:#3f1d1d,stroke:#f87171,color:#fef2f2

    class WEB app
    class UI,SDK,CORE,SEED pkg
    class ENGINE,AGENTS,RELAY sib
```

## Why the polyglot services are siblings and not workspaces

`crates/`, `services/` and `packages/` look similar on disk and are not. The
Bun workspace globs are `apps/*` and `packages/*` only, so Cargo, pip and the
Go toolchain each manage their own dependency graph entirely independently.

That boundary is deliberate. A `cargo build` must not be able to break
`bun run typecheck`, and a Python transitive dependency bump must not appear
in `bun.lock`. Each toolchain owns its own lockfile, its own CI job and its own
failure mode. The only coupling between them is the *agreement* enforced by
tests: the Rust solver against the TypeScript one, and the Python rule table
against the TypeScript one.

## Acyclicity

The directed graph is acyclic and `@repo/core` is a leaf that nothing in
`packages/` depends on upward. `@repo/ui` imports nothing from this repo at
all, which is why it can be extracted into a standalone component library by
copying one directory.
