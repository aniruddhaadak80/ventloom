# Seed 7331 to a full world

Every random number in ventloom descends from one 32-bit integer. Nothing calls
`Math.random`, so the world is reproducible across machines, runs and
languages.

```mermaid
flowchart TB
    SEED["WORLD_SEED = 7331"] --> ROOT["root rng stream"]

    ROOT -->|"stream 1"| UNREST["per-volcano unrest phase<br/>+ amplitude"]
    ROOT -->|"stream 2"| DEPTH["source depth + offset"]
    ROOT -->|"stream 3"| NOISE["measurement noise<br/>(mm-scale)"]
    ROOT -->|"stream 4"| TRACE["ground-motion samples<br/>60 s @ 16 Hz"]
    ROOT -->|"stream 5"| GEOCHEM["tephra layer selection<br/>+ analytic fractionation"]

    UNREST --> PROFILE{"unrest profile"}
    PROFILE -->|"inflation"| INFLATE["positive dV/dt"]
    PROFILE -->|"deflation"| DEFLATE["negative dV/dt"]
    PROFILE -->|"oscillation"| OSCILLATE["sine + drift"]
    PROFILE -->|"quiet"| QUIET["background only"]

    INFLATE --> SOURCE["Mogi source at epoch"]
    DEFLATE --> SOURCE
    OSCILLATE --> SOURCE
    QUIET --> SOURCE

    DEPTH --> SOURCE

    TRACE --> MECH{"tremor mechanism"}
    MECH -->|"harmonic"| HARMONIC["1.5 Hz + overtones"]
    MECH -->|"spasmodic"| SPASMODIC["broadband bursts"]
    MECH -->|"quiet"| BROWN["1/f<sup>2</sup> noise"]

    HARMONIC --> SAMPLES["stationTrace()"]
    SPASMODIC --> SAMPLES
    BROWN --> SAMPLES

    NOISE --> SAMPLES
    SOURCE --> SAMPLES

    GEOCHEM --> LAYERS["tephra layers across 3 cores"]
    LAYERS --> CLR["closed composition<br/>sums to 100 %"]

    SAMPLES --> SNAPSHOT["networkSnapshot(epoch)"]
    SOURCE --> SNAPSHOT
    LAYERS --> SNAPSHOT

    SNAPSHOT --> WORLD["the rendered observatory"]

    classDef seed fill:#14532d,stroke:#22c55e,color:#ecfdf5
    classDef derive fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef branch fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef out fill:#3f1d1d,stroke:#f87171,color:#fef2f2

    class SEED seed
    class ROOT,UNREST,DEPTH,NOISE,TRACE,GEOCHEM derive
    class PROFILE,MECH,INFLATE,DEFLATE,OSCILLATE,QUIET,HARMONIC,SPASMODIC,BROWN branch
    class WORLD,SAMPLES,SNAPSHOT,LAYERS,CLR,SOURCE out
```

## Why independent streams rather than one shared generator

A single stream means that adding one random number early in the pipeline
shifts **every** number after it, so a one-line change to the plume width would
silently alter the recovered source depth on every volcano. Deriving named
sub-streams from the root seed isolates them: the deformation stream can change
without touching the geochemistry stream, and both stay reproducible.

## Why `mulberry32`

It is four lines, has a 2<sup>32</sup>-1 period, and — the property that
matters here — is trivially reimplementable in Rust and Python. A cross-language
parity test is only meaningful if all three implementations can be *provably*
drawing from the same sequence, and a well-specified 32-bit integer hash is the
only kind of generator for which that is true. A PCG or xoshiro would also
work; a Mersenne Twister would not, because its state is 2.5 kB and its
reimplementation is easy to get subtly wrong.
