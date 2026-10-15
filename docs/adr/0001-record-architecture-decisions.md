# 0001 — Record architecture decisions as numbered files

Date: 2026-04-14
Status: Accepted

## Context

ventloom is going to be read far more often than it is modified, and the
decisions in it are not obvious from reading the source. Why is the epoch in the
URL? Why is `force-static` forbidden on parameterised routes? Why does the Rust
solver exist if the TypeScript one already runs? Without a record, the answer
to these is either folklore or lost.

## Decision

Architecture decisions are recorded as short, immutable, numbered files in
`docs/adr/`, following Michael Nygard's lightweight template:

- `## Context` — what situation made the decision necessary,
- `## Decision` — what was decided, in the imperative,
- `## Consequences` — what follows, including the costs.

## Consequences

- Decisions can be read individually without re-reading the source.
- A reader who disagrees with a decision must argue against a written record,
  which makes the conversation more productive.
- Reversing a decision is done by adding a new numbered ADR with status
  "Supersedes 000N", not by editing 000N. History stays intact.

## Index

- 0001 — Record architecture decisions
- 0002 — epoch is the whole state
- 0003 — Rust exists as a parity oracle
- 0004 — no wall clock anywhere
- 0005 — Aitchison, not Euclidean, for tephra
