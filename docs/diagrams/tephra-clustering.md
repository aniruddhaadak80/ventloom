# Tephra correlation

Matching tephra layers between cores by chemistry rather than by depth, using
the metric that compositional data actually requires.

```mermaid
flowchart TB
    LAYERS["recovered tephra layers<br/>3 cores, 12 layers"] --> RAW["major-oxide analyses<br/>10 oxides, weight %"]

    RAW --> CLOSE["the closure problem:<br/>oxides sum to 100 %"]
    CLOSE --> REJECT["Euclidean distance in wt %<br/>is rejected"]

    REJECT --> CLR["centered log-ratio transform<br/>clr(x)_i = ln(x_i) - mean(ln x)"]

    CLR --> CHECK{"any oxide = 0?"}
    CHECK -->|"yes"| FAIL["reject the analysis<br/>log(0) is undefined"]
    CHECK -->|"no"| OK["CLR vector, sums to zero"]

    OK --> DIST["Aitchison distance<br/>euclidean distance between CLR vectors"]
    DIST --> MATRIX["pairwise distance matrix"]

    MATRIX --> UNION["union-find clustering<br/>single-linkage at threshold 2.0"]
    UNION --> GROUPS["correlated groups"]

    GROUPS --> REP["representative layer<br/>medoid of each group"]

    RAW --> NEAREST["nearest end member<br/>from 4 reference compositions"]
    NEAREST --> CLASSIFY["basalt / basaltic andesite /<br/>andesite / dacite"]

    MATRIX --> UI1["distance matrix table"]
    GROUPS --> UI2["correlated layer cards"]
    CLASSIFY --> UI3["layer inventory"]

    UI1 --> READ["the reader's conclusion:<br/>which layers came from<br/>the same eruption"]
    UI2 --> READ
    UI3 --> READ

    classDef in fill:#3f1d1d,stroke:#f87171,color:#fef2f2
    classDef proc fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef branch fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef out fill:#14532d,stroke:#22c55e,color:#ecfdf5

    class LAYERS,RAW in
    class CLR,DIST,MATRIX,UNION,REP,NEAREST proc
    class CLOSE,CHECK,REJECT,FAIL branch
    class GROUPS,CLASSIFY,UI1,UI2,UI3,READ,OK out
```

## Why Euclidean distance is wrong here

A major-oxide analysis is a **composition**: the ten oxides are not independent
measurements, they are parts of a whole that sums to 100 %. That closure makes
Euclidean distance meaningless, in a specific and provable way.

Take a basalt measured as 50 % SiO₂ with everything else fixed. Now imagine
the lab reports it after a unit change that doubles every value and renormalises
- the same rock. Euclidean distance between the two reports is large, and the
rock is identical. Any metric that can be moved by renormalising the same
sample is not measuring the sample.

The centered log-ratio transform removes this. Taking logs turns multiplicative
closure into additive closure, and subtracting the mean log makes the result
independent of the total. `clr(x)` always sums to zero, which is asserted in
`tephra.test.ts` and in the Python service's test suite - the two implementations
agree on the transform and on the resulting distances.

## Why single-linkage union-find

Correlation of tephra layers is genuinely transitive in the way single-linkage
captures: layer A may differ from layer B by analytical scatter and B from C
similarly, while A and C sit at opposite ends of the tolerance. Complete linkage
would split that chain into two units and assert an eruption happened twice.
Single linkage says what a field geologist says - these are the same unit,
contaminated differently - and it needs only the distance matrix that has
already been computed.

The threshold of 2.0 is reported alongside every decision rather than held as a
magic constant, in both the UI and the Python service's `/correlate` response,
so a caller never has to go looking for it.
