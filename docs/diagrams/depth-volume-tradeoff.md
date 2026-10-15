# The depth / volume trade-off

The single most important thing this repo tries to communicate: a one-epoch
geodetic inversion **cannot** separate source depth from volume change.

```mermaid
flowchart LR
    FIELD["same surface<br/>displacement field"]

    FIELD --> A["deep + large ΔV<br/>d = 8 km, ΔV = 12 Mm3"]
    FIELD --> B["medium + medium ΔV<br/>d = 5 km, ΔV = 2.9 Mm3"]
    FIELD --> C["shallow + small ΔV<br/>d = 3 km, ΔV = 0.6 Mm3"]

    A --> FIT1["misfit 3.9 mm"]
    B --> FIT2["misfit 4.1 mm"]
    C --> FIT3["misfit 4.4 mm"]

    FIT1 --> RIDGE["the solution ridge:<br/>Delta V proportional to d cubed"]
    FIT2 --> RIDGE
    FIT3 --> RIDGE

    RIDGE --> COV["covariance ellipse<br/>rho about -0.98"]
    COV --> REPORT["what the page prints:<br/>depth, sigma_depth, rho,<br/>and the sentence explaining it"]

    classDef opt fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef fit fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef out fill:#3f1d1d,stroke:#f87171,color:#fef2f2

    class FIELD,A,B,C opt
    class FIT1,FIT2,FIT3,RIDGE fit
    class COV,REPORT out
```

## What the math actually says

For a Mogi source, the vertical displacement at horizontal distance `r` is

```
w(r) = C · d / (r² + d²)^(3/2)        where C = ΔV(1 − ν)/π
```

Substitute `d → kd` and `ΔV → k³ΔV`. The factor is `k³·d / (r² + k²d²)^(3/2)`,
which is **not** exactly invariant — but over the range of `r` a real network
covers, it is invariant to within the noise floor for `k` between about 0.7 and
1.4. That near-degeneracy is the ridge. Its signature in the output is a
depth-volume correlation coefficient near −1, and the geodesy page prints that
number rather than burying it.

## Why this is the point of the whole repo

It would be easy to print a depth of `4 217 m` with a green checkmark and call
the inversion solved. That number is not known to 17 metres. A network of
eight GNSS benches constrains the *combination* of depth and volume far better
than it constrains either alone, and an observatory that reports a
high-precision depth from a single epoch is reporting a precision it has not
earned.

So the page prints:

- the recovered depth, rounded to metres,
- its one-sigma uncertainty, which is the honest width,
- the depth-volume correlation, which tells you how much of that uncertainty is
  borrowed from the other parameter,
- and a sentence saying that resolving the two requires a **time series**, which
  is exactly what the replay surface is for.
