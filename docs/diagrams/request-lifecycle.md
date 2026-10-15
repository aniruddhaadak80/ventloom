# Request lifecycle

What happens between a click and a rendered panel, for both the static pages
and the JSON endpoints.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant N as Next.js router
    participant S as Server component
    participant C as @repo/core
    participant R as Route handler

    Note over B,N: Case 1: a page

    B->>N: GET /seismic?epoch=3888000&volcano=kilauea
    N->>S: render SeismicPage(searchParams)
    S->>C: stationTrace(volcano, station, epochS)
    C-->>S: Float64Array[1024]
    S->>C: tremorFeatures(samples, 16)
    C-->>S: rsam, dominantHz, band fractions
    S->>C: amplitudeSpectrum(samples, 16)
    C-->>S: magnitudes + frequenciesHz
    S->>C: spectrogram(samples, 16, opts)
    C-->>S: frames[] + frequenciesHz[]
    S-->>N: React tree
    N-->>B: 200 text/html + streamed chunks

    Note over B,R: Case 2: the JSON API

    B->>R: GET /api/displacement?volcano=etna&epoch=100000
    R->>R: validate volcano id
    alt unknown id
        R-->>B: 400 {"error":"unknown volcano"}
    end
    R->>C: mogiForward(stations, source)
    C-->>R: displacement[]
    R-->>B: 200 + cache-control: immutable

    Note over B,R: Case 3: an inversion

    B->>R: POST /api/invert {stations, observations}
    R->>R: validate shape, cap at 200 stations
    R->>C: mogiInvert(stations, obs, poisson, sigma)
    C->>C: Levenberg-Marquardt loop
    C-->>R: Fit{source, rms, rho, condition}
    R-->>B: 200 + diagnostics
```

## Why the pages compute on the server

Every panel on `/seismic` is derived from a 1024-sample trace and an FFT with
an O(n log n) cost, and the spectrogram is a 2-D array of frame energies. Doing
that in the browser would work, and would also mean the first paint depends on
a JavaScript download and parse. Rendering it on the server means the numbers
are in the HTML: the page is readable, linkable and screen-reader-accessible
before any script runs, and it degrades to text if the client bundle never
arrives.

## Why `cache-control: immutable`

The displacement and network responses are a pure function of the query string.
Two requests with the same `volcano` and `epoch` produce byte-identical bodies,
forever, so any cache that keys on the full URL can hold the answer
indefinitely without ever serving something wrong. That is a stronger guarantee
than most APIs can honestly make, and it is worth stating explicitly rather
than leaving a client to guess at a `max-age`.

Note the trap this avoids: these handlers are `force-dynamic`, not
`force-static`. A parameterised route marked `force-static` is evaluated once
at build time with an empty query string and its response — often a 400 — is
baked into the build output.
