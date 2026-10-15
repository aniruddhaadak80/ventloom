## What changed

<!-- One or two sentences. -->

## Why

<!-- The motivation. Link the issue: Fixes # -->

## How to test

```bash
# paste the commands a reviewer should run
```

## Checklist

- [ ] `bun run typecheck` is clean
- [ ] `bun run lint` is clean
- [ ] `bun run test:unit` is green
- [ ] `bun run build` succeeds
- [ ] `bunx playwright test` is green (if a page or route changed)
- [ ] Docs updated where a behaviour changed
- [ ] No em-dashes introduced in user-visible strings
