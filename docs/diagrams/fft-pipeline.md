# FFT and spectrogram pipeline

From a 60-second ground-motion trace to the two plots on `/seismic`.

```mermaid
flowchart TB
    TRACE["stationTrace()<br/>1024 samples @ 16 Hz<br/>60 s window"] --> DETREND["remove the mean"]

    DETREND --> FRAME{"spectrogram?"}

    FRAME -->|"yes"| WINDOWED["Hann window per frame<br/>1024 samples, hop 512"]
    FRAME -->|"no"| WHOLE["Hann window over<br/>the whole trace"]

    WINDOWED --> FFT_W["radix-2 Cooley-Tukey<br/>in-place, bit-reversed"]
    WHOLE --> FFT_W

    FFT_W --> COMPLEX["complex bins<br/>n/2 + 1 retained"]

    COMPLEX --> AMPL["amplitude spectrum<br/>2 |X_k| / (n x coherent gain)"]
    COMPLEX --> POWER["power spectrum<br/>amplitude squared / 2"]

    AMPL --> SPEC["spectrogram frames<br/>dB-normalised per column"]
    POWER --> FEATURES["tremorFeatures()"]

    FEATURES --> RSAM["RSAM<br/>sqrt(mean(x squared))"]
    FEATURES --> CENTROID["spectral centroid<br/>Hz"]
    FEATURES --> FLATNESS["spectral flatness<br/>geometric / arithmetic mean"]
    FEATURES --> CREST["crest factor<br/>peak / rms"]
    FEATURES --> DOMINANT["dominant Hz<br/>+ parabolic refinement"]
    FEATURES --> BANDS["band fractions<br/>1-5 Hz, 5-15 Hz"]

    RSAM --> UI["Ground velocity + RSAM panels"]
    CENTROID --> UI
    FLATNESS --> UI
    CREST --> UI
    DOMINANT --> UI
    BANDS --> UI
    SPEC --> UI2["Spectrogram + spectrum panels"]

    classDef in fill:#3f1d1d,stroke:#f87171,color:#fef2f2
    classDef dsp fill:#1e3a5f,stroke:#38bdf8,color:#f0f9ff
    classDef feat fill:#3b2f0b,stroke:#f59e0b,color:#fffbeb
    classDef out fill:#14532d,stroke:#22c55e,color:#ecfdf5

    class TRACE in
    class DETREND,WINDOWED,WHOLE,FFT_W,COMPLEX,AMPL,POWER,SPEC dsp
    class RSAM,CENTROID,FLATNESS,CREST,DOMINANT,BANDS,FEATURES feat
    class UI,UI2 out
```

## Why a power-of-two length is mandatory

The radix-2 butterfly decomposition needs `n = 2^k`. Rather than zero-pad
silently — which would lengthen the window, smear a transient and change the
frequency resolution the reader is looking at — `fft.ts` **throws**. A caller
who passes 1000 samples has made a modelling decision, not a typo, and the
right response is to make them state it.

## Why the Hann window, and why the correction factor

A rectangular window convolves every tone with a sinc, whose sidelobes decay
only as 1/f. A 1.5 Hz tremor tone would then leak energy into every bin out to
Nyquist, and the 1-5 Hz band ratio — the number the alert engine actually
consumes — would be contaminated by energy that is not there.

Hann's sidelobes decay as 1/f³, at the cost of a wider main lobe and a coherent
gain of exactly 0.5. That 0.5 is why the amplitude formula divides by the
window's mean: without it, a unit sinusoid reports an amplitude of 0.5, and
every absolute level in the observatory would be 6 dB wrong.
`fft.test.ts` asserts a unit tone recovers to within 2 %, which is the test
that would catch a missing correction.

## Why parabolic interpolation on the peak

Bin spacing at 16 Hz over 1024 samples is 0.056 Hz, so an unrefined peak is
quantised to ±0.028 Hz. That is small, but the tremor band boundary is at 5 Hz
and a harmonic sitting near it can be pushed across by quantisation alone. Fitting
a parabola through the peak bin and its two neighbours recovers the true
frequency to a small fraction of a bin, using three numbers and no extra FFT.
