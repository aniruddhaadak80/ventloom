# ventloom diagrams

Sixteen Mermaid diagrams, each in its own file so it can be embedded, copied
or rendered in isolation. Every one describes the code as it is written, not
as it was planned.

| # | Diagram | File |
| - | ------- | ---- |
| 1 | System architecture and data flow | [`system-architecture.md`](./system-architecture.md) |
| 2 | Monorepo package dependency graph | [`monorepo-dependencies.md`](./monorepo-dependencies.md) |
| 3 | Seed 7331 to a full world | [`seed-pipeline.md`](./seed-pipeline.md) |
| 4 | Epoch resolution | [`epoch-resolution.md`](./epoch-resolution.md) |
| 5 | Request lifecycle | [`request-lifecycle.md`](./request-lifecycle.md) |
| 6 | Mogi source inversion loop | [`mogi-inversion.md`](./mogi-inversion.md) |
| 7 | Depth / volume trade-off | [`depth-volume-tradeoff.md`](./depth-volume-tradeoff.md) |
| 8 | FFT and spectrogram pipeline | [`fft-pipeline.md`](./fft-pipeline.md) |
| 9 | Tremor classification | [`tremor-classification.md`](./tremor-classification.md) |
| 10 | Tephra correlation | [`tephra-clustering.md`](./tephra-clustering.md) |
| 11 | Alert engine | [`alert-engine.md`](./alert-engine.md) |
| 12 | Station and instrument network | [`network-topology.md`](./network-topology.md) |
| 13 | Replay timeline | [`replay-timeline.md`](./replay-timeline.md) |
| 14 | Cross-language parity | [`cross-language-parity.md`](./cross-language-parity.md) |
| 15 | Relay daemon | [`relay-architecture.md`](./relay-architecture.md) |
| 16 | CI gate | [`ci-pipeline.md`](./ci-pipeline.md) |

## Reading order

If you are new to the repo, the useful path is **1, 3, 4, 6, 9, 11**. That
sequence answers, in order: what is here, where the numbers come from, why the
same URL always shows the same thing, how a deformation field becomes a buried
source, how a waveform becomes a tremor label, and how a label becomes an
alert level a person is expected to act on.

## Conventions

Every diagram uses the same four node classes, so the colours are learnable
once:

| Class | Meaning | Example |
| ----- | ------- | ------- |
| Deterministic core | Pure function, no I/O, unit-tested | `@repo/core` |
| Seeded catalogue | Static data derived from seed 7331 | `@repo/seed` |
| Surface | Rendering or transport | Next.js route, SDK client |
| Boundary | Leaves the process | HTTP, filesystem, clock |
