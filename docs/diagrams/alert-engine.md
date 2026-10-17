# Alert engine

The ordered rule table that turns frozen indicators into a level a person is
expected to act on. Implemented twice, in TypeScript and Python, and pinned
between them by tests.

```mermaid
flowchart TB
    subgraph inputs["Indicator families"]
        DEF["deformation<br/>rate mm/day, dV"]
        SEI["seismic<br/>RSAM ratio, band fraction"]
        GAS["gas<br/>SO2 t/d, CO2/SO2 ratio"]
        THM["thermal<br/>anomaly pixels / 24 h"]
        CAT["catalogue<br/>VT events / 24 h"]
    end

    DEF --> R1{"R1 rate >= 10<br/>ADVISORY"}
    DEF --> R7{"R7 rate >= 30<br/>WARNING"}
    SEI --> R2{"R2 band >= 0.55<br/>WATCH"}
    SEI --> R3{"R3 RSAM >= 3x<br/>WATCH"}
    SEI --> R8{"R8 band >= 0.78<br/>WARNING"}
    GAS --> R4{"R4 SO2 >= 1500<br/>WATCH"}
    GAS --> R5{"R5 CO2/SO2 <= 2.0<br/>WATCH"}
    GAS --> R9{"R9 SO2 >= 4000<br/>WARNING"}
    CAT --> R6{"R6 VT >= 50<br/>WATCH"}
    THM --> R10{"R10 pixels >= 400<br/>WARNING"}

    R1 --> VERDICT
    R2 --> VERDICT
    R3 --> VERDICT
    R4 --> VERDICT
    R5 --> VERDICT
    R6 --> VERDICT
    R7 --> VERDICT
    R8 --> VERDICT
    R9 --> VERDICT
    R10 --> VERDICT

    VERDICT["levels only ever rise<br/>start NORMAL, take the max"] --> LEVEL{"highest level fired"}
    LEVEL -->|"none"| NORMAL["NORMAL / GREEN"]
    LEVEL -->|"R1 only"| ADVISORY["ADVISORY / YELLOW"]
    LEVEL -->|"any WATCH"| WATCH["WATCH / ORANGE"]
    LEVEL -->|"any WARNING"| WARNING["WARNING / RED"]

    NORMAL --> CONF
    ADVISORY --> CONF
    WATCH --> CONF
    WARNING --> CONF

    CONF["confidence = f(families corroborating)<br/>not f(rules fired)"] --> REPORT["situation report<br/>fired rules + silent rules<br/>+ advisory commentary"]

    classDef fam fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef rule fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef lvl fill:#3f1d1d,stroke:#f87171,color:#fef2f2
    classDef out fill:#14532d,stroke:#22c55e,color:#ecfdf5

    class DEF,SEI,GAS,THM,CAT fam
    class R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,VERDICT,LEVEL,CONF rule
    class NORMAL,ADVISORY,WATCH,WARNING lvl
    class REPORT out
```

## Why confidence counts families, not rules

It is tempting to score confidence as "how many rules fired". Ten rules firing
would then read as near-certainty, and that is a dangerous reading: all ten
could be driven by a single malfunctioning GNSS bench whose monument has
started to tilt. Ten alarms from one instrument are still one instrument.

So confidence is driven by how many *independent families* corroborate. A
deformation signal plus a seismic signal plus a gas signal is three lines of
evidence from three physically separate measurement chains, and that is what
earns a high score. This is also why the verdict reports the silent rules
alongside the fired ones: a bulletin that lists only its evidence is not
auditable, because the reader cannot see what was checked and passed.

## Why the levels only ever rise

The table is evaluated in order and each firing can only *raise* the level.
Two reasons. Operationally, an observatory that oscillates between WATCH and
ADVISORY as a single indicator wanders across a threshold generates alarm
fatigue, which is how people stop reading bulletins. Formally, the thresholds
are not a partition of indicator space - R1 and R7 both test the deformation
rate, at different levels - so the natural reading of "the last rule that
fired" would give a *lower* answer for a more severe signal.

## The CO2/SO2 rule fires downward

Every other threshold is `>=`. R5 is `<=`, because a *falling* CO2/SO2 ratio is
the signal: CO2 exsolves at depth and SO2 higher up, so a ratio dropping toward
2.0 means magma has arrived in the shallow conduit where it can actually
erupt. A reader scanning the table for `>=` will misread it, which is why the
rule's statement text says so in words.
