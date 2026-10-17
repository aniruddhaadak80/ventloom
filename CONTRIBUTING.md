# Contributing to ventloom

Thanks for showing up. ventloom is an `amazing-repo` skill deliverable, which
means it is simultaneously a piece of software and a teaching artefact: every
surface is wired so that the claims it makes can be checked by reading the
tests. That is the single most important thing to know before opening a pull
request.

## Before you write code

1. **Read the relevant files first.** The repo is small and deliberate. `packages/core/src/` is the engine, `apps/web/app/` is the rendering, and `docs/diagrams/` is how we explain what we just wrote. Guessing the API of `mogiForward` costs you a build.
2. **Match conventions.** TypeScript strict mode, ESM, Bun where the project already uses it. `biome check .` is not a suggestion.
3. **One logical change per commit.** A commit that touches both the solver and the README is two commits.

## The gates

Every change runs these before it can merge. They live in `.github/workflows/ci.yml` and also run locally with `bun run check`:

```bash
bun run typecheck         # tsc --noEmit on every package
bun run lint              # biome check .
bun run test:unit         # vitest, 134 tests
bun run build             # next build, 24 routes
bun run test:e2e          # playwright, 18 assertions
cd crates/engine && cargo test
cd services/relay && go vet ./... && go test -race ./...
cd services/agents && python -m pytest
bun scripts/gen-assets.mjs --check
```

If you can run them locally, you should. The CI runner has a network, but
your laptop does not always - a change that works offline is a change that is
testable.

## Cross-language changes

`@repo/core`, `crates/engine` and `services/agents` implement the same maths.
If you change a formula, a constant, or a threshold in one, you owe a passing
parity assertion in the others, or you owe an explicit comment in the commit
message saying why they are allowed to diverge.

In particular: the Mogi forward model is checked Rust against TypeScript on
depth, volume and RMS misfit at `1e-6` relative, and the alert rule table is
checked Python against TypeScript on every indicator's threshold.

## Documentation

Editing `docs/diagrams/` is not optional for a feature that adds a new
subsystem. A mermaid diagram beats a thousand docstring lines because it is the
only form a reviewer will actually read. The README's mermaid files are kept in
sync with the code by hand; there is no generator. That means the author of a
feature is also its documenter.

## Issues and pull requests

- Use the issue templates. A bug report without a reproduction is a
  suggestion, and suggestions are welcome but slower.
- PR descriptions follow **What changed / Why / How to test**. The `@pr-helper`
  agent produces exactly this shape and is available in the local OpenCode setup.
- Link the issue with `Fixes #<n>` so GitHub closes it on merge.

## Style

- No em-dashes in user-visible strings (lint does not catch this, reviewers do).
- Three.js comments are fine, essay-length comments are not: the code is the
  documentation, and sentences that only repeat the code are noise.
- Determinism is a design constraint, not a preference. No `Math.random`, no
  `Date.now`, no `process.env` reads outside the documented entry points.
- `force-static` on any route that reads a query parameter is forbidden - see
  the comment in `app/api/displacement/route.ts`.

## Getting help

The repo is maintained by [@aniruddhaadak80](https://github.com/aniruddhaadak80)
and the global OpenCode rules (which the contributors already share) are in
`~/.config/opencode/AGENTS.md`. Read them before asking whether a change is
in scope.
