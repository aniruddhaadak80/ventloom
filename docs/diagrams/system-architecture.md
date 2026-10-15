# System architecture

```mermaid
flowchart TB
    subgraph seeded["Seeded catalogue (static, seed 7331)"]
        direction LR
        CATALOGUE["volcano catalogue<br/>12 systems"]
        STATIONS["station network<br/>84 instruments"]
        TEPHRA_SEED["tephra layers + cores"]
        ENDMEMBERS["end-member compositions"]
    end

    subgraph core["Deterministic core (@repo/core)"]
        direction TB
        RNG["rng.ts<br/>mulberry32"]
        MOGI["mogi.ts<br/>forward + invert"]
        FFT["fft.ts<br/>radix-2 transform"]
        TREMOR["tremor.ts<br/>band features"]
        TEPHRA["tephra.ts<br/>CLR + Aitchison"]
        FORECAST["forecast.ts<br/>rule table"]
        NET["network.ts<br/>snapshot assembly"]
        LINALG["linalg.ts<br/>dense solve"]
    end

    subgraph surface["Surfaces"]
        direction TB
        PAGES["Next.js pages<br/>7 sections + 12 volcano pages"]
        ROUTES["Route handlers<br/>/api/health /network /displacement /invert"]
        OG["/og<br/>social card"]
        SDK["@repo/sdk<br/>typed client"]
    end

    subgraph external["Outside the process"]
        direction TB
        BROWSER["Browser"]
        RELAY["relay daemon<br/>(Go)"]
        AGENTS["agents service<br/>(Python)"]
        ENGINE["ventloom-engine<br/>(Rust oracle)"]
    end

    CATALOGUE --> NET
    STATIONS --> NET
    RNG --> MOGI
    RNG --> TREMOR
    RNG --> TEPHRA
    LINALG --> MOGI
    NET --> MOGI
    NET --> FFT
    FFT --> TREMOR
    TEPHRA_SEED --> TEPHRA
    ENDMEMBERS --> TEPHRA
    MOGI --> FORECAST
    TREMOR --> FORECAST
    TEPHRA --> FORECAST

    NET --> ROUTES
    MOGI --> ROUTES
    MOGI --> PAGES
    FFT --> PAGES
    TEPHRA --> PAGES
    FORECAST --> PAGES
    FORECAST --> OG

    PAGES --> BROWSER
    ROUTES --> SDK
    SDK --> BROWSER
    ROUTES --> RELAY

    MOGI -.->|"same formulas,<br/>cross-checked in CI"| ENGINE
    FORECAST -.->|"same rule table"| AGENTS

    classDef seeded fill:#14532d,stroke:#22c55e,color:#ecfdf5
    classDef core fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef surface fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef external fill:#3f1d1d,stroke:#f87171,color:#fef2f2

    class CATALOGUE,STATIONS,TEPHRA_SEED,ENDMEMBERS seeded
    class RNG,MOGI,FFT,TREMOR,TEPHRA,FORECAST,NET,LINALG core
    class PAGES,ROUTES,OG,SDK surface
    class BROWSER,RELAY,AGENTS,ENGINE external
```

## The one rule this shape encodes

Arrows never point **into** the core from a surface. `@repo/core` imports
nothing from `@repo/ui`, `@repo/sdk` or `apps/web`, and it reads no clock, no
environment variable and no network. That is what makes "the same epoch renders
the same observatory" a testable claim rather than a hope: the entire world is
a pure function of `(catalogue, seed, epoch)`.

The dashed arrows are the ones worth arguing about. They cross a language
boundary on purpose, so that a bug in the TypeScript Mogi solver shows up as a
disagreement with the Rust implementation rather than as a subtly wrong depth
on a dashboard.
