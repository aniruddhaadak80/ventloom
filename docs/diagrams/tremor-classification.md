# Tremor classification

How a raw waveform becomes a mechanism label, and why the *band ratios* do the
work rather than the amplitude.

```mermaid
flowchart TB
    SAMPLES["ground velocity<br/>1024 samples @ 16 Hz"] --> F["tremorFeatures()"]

    F --> AMPS["amplitude spectrum<br/>Hann-windowed, gain-corrected"]
    AMPS --> POW["power per bin"]

    POW --> TOT["total power<br/>0.05 - 8 Hz"]
    POW --> LOW["1-5 Hz tremor band"]
    POW --> HIGH["5-15 Hz broadband"]

    TOT --> FRAC["band fractions<br/>low / total, high / total"]
    LOW --> FRAC
    HIGH --> FRAC

    POW --> PEAKS["peak picking<br/>above 10 x local mean"]
    PEAKS --> FUND["fundamental Hz"]
    PEAKS --> HARM["harmonic series test<br/>f, 2f, 3f ..."]

    POW --> STAT["spectral statistics"]
    STAT --> FLAT["spectral flatness<br/>0 = tone, 1 = white noise"]
    STAT --> CENT["spectral centroid"]

    SAMPLES --> TIME["time-domain statistics"]
    TIME --> RSAM["RSAM"]
    TIME --> CREST["crest factor"]

    FRAC --> SCORE{"mechanism score"}
    FUND --> SCORE
    HARM --> SCORE
    FLAT --> SCORE
    CENT --> SCORE
    RSAM --> SCORE
    CREST --> SCORE

    SCORE -->|"band >= 0.55 and<br/>harmonic series present"| HARMONIC["harmonic<br/>sustained fluid motion"]
    SCORE -->|"broadband and<br/>crest factor high"| SPASMODIC["spasmodic<br/>fragmented conduit"]
    SCORE -->|"flat spectrum,<br/>low band fraction"| BROWN["volcano-tectonic / noise"]
    SCORE -->|"intermittent,<br/>moderate flatness"| QUIET["quiet / ambiguous"]

    HARMONIC --> LABEL["tremorLabelAt()<br/>drives trace synthesis<br/>and the alert rule table"]
    SPASMODIC --> LABEL
    BROWN --> LABEL
    QUIET --> LABEL

    classDef in fill:#3f1d1d,stroke:#f87171,color:#fef2f2
    classDef dsp fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef feat fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef out fill:#14532d,stroke:#22c55e,color:#ecfdf5

    class SAMPLES in
    class AMPS,POW,TOT,LOW,HIGH,FRAC,FUND,HARM,FLAT,CENT,RSAM,CREST,STAT,TIME,PEAKS dsp
    class F,SCORE feat
    class HARMONIC,SPASMODIC,BROWN,QUIET,LABEL out
```

## Why crest factor alone cannot classify tremor

The intuitive read is: tremor is a smooth oscillation, so its crest factor
should be near 1.4, and noise is spiky, so it should be high. That is true of
*white* noise, and completely false of the noise a real short-period station
records. Background seismic noise is roughly 1/f² below about a 1.5 Hz corner
and flat above it, and filtering a signal that way raises its crest factor to
around 9 without making it impulsive at all.

So a crest factor of 9 does not mean "earthquake". The observatory says so
explicitly on the seismic page rather than letting a reader infer the naive
reading, and the classifier leans on the band ratios instead, which separate
these cases cleanly: harmonic tremor puts 70 %+ of its power in 1-5 Hz, and
background noise puts almost none there.

## Why the fundamental is only sometimes detectable

A harmonic tremor's fundamental sits near 1.5 Hz. At 16 Hz sampling over 60
seconds, bin spacing is 0.056 Hz, which resolves 1.5 Hz comfortably in
principle. In practice the fundamental is the *weakest* member of the series
— conduit resonance radiates more efficiently at its overtones — so it often
sits within a few dB of the noise floor while the 3 Hz and 4.5 Hz harmonics
are unmistakable. The classifier therefore treats a missing fundamental as
weak evidence rather than as disproof, which is why the harmonic series test
is a separate input to the score rather than a gate.
