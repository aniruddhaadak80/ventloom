# Quickstart

From a fresh clone to a rendered volcano in under five minutes.

## Prerequisites

- Bun 1.3 or newer (`curl -fsSL https://bun.sh/install | bash`)
- Everything else is optional. The Rust / Go / Python services run in their
  own toolchains and are not required to view the observatory.

## Run it

```bash
git clone https://github.com/aniruddhaadak80/ventloom.git
cd ventloom
bun install
bun run dev
```

Open `http://localhost:3000`. The landing page shows the full 12-volcano
network at the default epoch (45 days).

## The paths worth clicking first

1. `/geodesy?epoch=3888000&volcano=kilauea` - the Mogi inversion. Press
   "render" on the replay surface and watch the depth move.
2. `/seismic?epoch=3888000&volcano=kilauea` - the radix-2 spectrogram and
   the 1.5 Hz harmonic.
3. `/forecast?epoch=3888000&volcano=merapi` - the alert engine and its
   situation report.
4. `/tephra` - the Aitchison distance matrix and the correlated layers.
5. `/replay` - the time machine.

## The non-negotiable URL habit

Every link in ventloom carries `?epoch=seconds&volcano=id`. If you are sharing
a state, share the query string; it *is* the state. There is no session.

## Running the tests

```bash
# Gates (run from the repo root)
bun run typecheck
bun run lint
bun run test:unit
bun run build
bun run test:e2e

# Polyglot services, individually
cd crates/engine && cargo test
cd services/relay && go test -race ./...
cd services/agents && pytest
```

## Contributing

Read `CONTRIBUTING.md` first. The short version: one logical change per
commit, run the gates locally, and any change to a formula in one language
owes a parity assertion in the others.
