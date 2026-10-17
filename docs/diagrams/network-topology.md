# Station and instrument network

The 84 instruments across 12 volcanic systems, and what each one is for.

```mermaid
graph TB
    subgraph VOLC["One volcanic system"]
        SUMMIT["summit / crater"]
        FLANK["upper flank"]
        FAR["distal reference"]

        SUMMIT --> GNSS_S["GNSS bench<br/>3-component"]
        SUMMIT --> BB["broadband seismometer<br/>0.033 - 50 Hz"]
        SUMMIT --> INF["infrasound array<br/>0.5 - 20 Hz"]
        SUMMIT --> GAS["multi-gas station<br/>SO2, CO2, H2S"]

        FLANK --> GNSS_F["GNSS bench"]
        FLANK --> SP["short-period seismometer<br/>1 - 20 Hz"]
        FLANK --> THERM["thermal camera<br/>anomaly pixels"]

        FAR --> GNSS_D["distal GNSS<br/>assumed stable"]
        FAR --> SP_D["short-period<br/>noise reference"]
    end

    GNSS_S --> DEFORMATION["deformation family"]
    GNSS_F --> DEFORMATION
    GNSS_D --> DEFORMATION

    BB --> SEISMIC["seismic family"]
    SP --> SEISMIC
    SP_D --> SEISMIC
    INF --> SEISMIC

    GAS --> GASFAM["gas family"]
    THERM --> THERMAL["thermal family"]

    DEFORMATION --> IND["unrestIndicators()"]
    SEISMIC --> IND
    GASFAM --> IND
    THERMAL --> IND

    IND --> ENGINE["alert engine"]

    classDef inst fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef geom fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef fam fill:#14532d,stroke:#22c55e,color:#ecfdf5
    classDef out fill:#3f1d1d,stroke:#f87171,color:#fef2f2

    class GNSS_S,GNSS_F,GNSS_D,BB,SP,SP_D,INF,GAS,THERM,SUMMIT,FLANK,FAR geom
    class DEFORMATION,SEISMIC,GASFAM,THERMAL,IND fam
    class ENGINE out
```

## The composition, by instrument

| Instrument | Count | What it constrains |
| ---------- | ----- | ------------------ |
| GNSS | 25 | Three-component displacement; the deformation family |
| Broadband seismic | 24 | Low-frequency tremor, VT locations, the noise floor |
| Short-period seismic | 15 | Higher-frequency content, and the distal noise reference |
| Infrasound | 16 | Explosive activity; acoustic energy that seismic alone cannot separate |
| Multi-gas | 4 | SO2 and CO2 flux; the gas family |

## Why a distal reference station matters

Every measurement needs something to be measured *against*, and the distal
station is that: sited on bedrock far enough away that volcanic deformation
falls below the noise, it gives the network a stable frame. Without it, a slow
regional tilt would be indistinguishable from inflation of the edifice, because
there would be nothing on the map that was known not to be moving.

It also serves a second purpose that is easy to overlook: the distal
short-period station is the **noise reference**. Background seismic noise is
not a constant - it is 1/f² below roughly 1.5 Hz and flat above, and it varies
by site. Measuring the RSAM ratio against a 30-day background *at the same
station* is what makes "3x background" mean something. Comparing a flank
station's raw amplitude against a different station's background would report
site effects as unrest.

## Why only 4 gas stations

Gas flux is the measurement that scales worst. SO2 needs either COSPEC, which
is being retired almost everywhere, or DOAS traverse work, which needs a person
in the field on the right wind. A realistic network has far fewer gas
instruments than seismometers, and the alert engine is built so that the gas
family is *corroborating* rather than required. A WATCH level that fired on
seismic and deformation alone is still a WATCH level.
