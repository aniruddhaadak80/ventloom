# Security policy

## Supported versions

Only the latest `main` branch and the latest tagged release are supported.
The skill-ledger era of this repo has no long-term supported branches: a bug
is fixed on `main` and the fix goes out with the next deploy.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Report it
privately with:

- **GitHub**: use the repository's "Report a vulnerability" button
  (Security tab, then "Advisories" then "New draft security advisory").
- **Email**: `aniruddha.adak@email.com`

Include, where you can, a reproduction, the affected path and whether the
problem is reachable from the network. We aim to acknowledge every report
within 48 hours. Please give at least 30 days before public disclosure. You
will be credited in the advisory and in the release notes.

## Threat model

ventloom is deliberately a small, stateless, read-only observatory. Before
reporting, consider whether your finding falls inside these boundaries:

### In scope

- **A route or API that trusts unvalidated input.** The inversion endpoint
  accepts up to 200 stations and caps the body size, but any path that
  performs work proportional to user input without a bound is in scope.
- **A cache that serves the wrong body.** `cache-control: immutable` is set on
  routes whose answers depend on the full query string, so a stale or shared
  cache hit would be a real bug.
- **A cross-language parity failure.** If the Rust solver and the TypeScript
  solver disagree on a seeded field, published depths are wrong.
- **A secret in the repository.** Even though ventloom uses no API keys, a
  leaked token is still a leaked token.
- **Client-side XSS or a dependency with a known vulnerability.**

### Out of scope

- Denial of service by a single client against a public, read-only endpoint.
  ventloom is not a real-time service.
- The synthetically generated data. It describes no real unrest, and will
  never be presented as if it did.
- Issues in forked or modified copies of the repository.

## Disclosure policy

Confirmed vulnerabilities are patched in a new release on `main`, announced in
the changelog, and credited to the researcher. Security updates are **not**
backported; the supported release is always the tip of `main`.

## No bug bounty

This is a personal project and carries no reward program. Please report
anyway - responsible disclosure is appreciated regardless.
