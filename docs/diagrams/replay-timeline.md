# Replay timeline

The deterministic time machine: scrubbing an epoch and watching the whole
observatory move with it.

```mermaid
gantt
    title The seeded year, 0 to 31,536,000 seconds
    dateFormat X
    axisFormat %s

    section Epochs
    day 0    (background)      :done,    0,     3888000
    day 45   (default)         :active,  3888000, 7776000
    day 90                     :crit,    7776000, 15552000
    day 180                    :crit,    15552000, 23328000
    day 365 (world ends)       :done,    23328000, 31536000
```

```mermaid
flowchart LR
    SLIDER["epoch slider<br/>or URL ?epoch="] --> E["readEpoch()<br/>parse, clamp into [0, MAX]"]

    E --> CORE["@repo/core<br/>pure function of epoch"]

    CORE --> GEO["deformation field"]
    CORE --> SEIS["tremor trace + spectra"]
    CORE --> GAS["gas + thermal indicators"]
    CORE --> CAT["event catalogue"]

    GEO --> PANEL["every panel recomputes"]
    SEIS --> PANEL
    GAS --> PANEL
    CAT --> PANEL

    PANEL --> SAME["same epoch renders<br/>the identical page, always"]

    SAME --> SHARE["shareable URL:<br/>?epoch=2592000&volcano=merapi"]

    classDef in fill:#3f1d1d,stroke:#f87171,color:#fef2f2
    classDef core fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef out fill:#14532d,stroke:#22c55e,color:#ecfdf5

    class SLIDER in
    class E,CORE,GEO,SEIS,GAS,CAT,PANEL core
    class SAME,SHARE out
```

## What "deterministic" buys you here

Three properties that are usually impossible to have at once:

1. **Reproducibility.** Two people opening the same URL see the same numbers,
   on different machines, months apart.
2. **No state.** There is no session, no database and no "latest". The server
   can be restarted mid-scrub and the next request is identical.
3. **Bookmarks.** The entire observatory state fits in a query string.

These hold because nothing in the compute path reads a clock. The one place
time appears is `readEpoch`, which converts a URL parameter into a world
timestamp, and it is a pure conversion.

## Why the slider is not a form submission

Scrubbing an epoch is a continuous gesture, and a full page navigation per
position would make the control unusable. The replay surface updates the query
string with `history.replaceState` as you drag, so the URL always reflects what
is on screen and the back button still works — while every panel recomputes from
the same pure functions the server rendered.

## The honest limitation

Determinism is a property of *this* repo, not of volcanology. A real
observatory ingests data that arrives late, gets revised and is occasionally
wrong. ventloom sidesteps that entirely by generating its world from a seed,
which buys perfect reproducibility at the cost of being a simulation. The
README says so rather than implying the numbers describe real unrest at
Kilauea, and every volcano page labels its indicators as synthetic.
