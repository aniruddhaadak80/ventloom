/**
 * `@repo/ui` — the ventloom design system.
 *
 * Import from `@repo/ui` in the app. Nothing in here may import from the app or
 * from `@repo/core`: the design system knows about geometry and colour, not
 * about volcanoes.
 *
 * The re-exports are extensionless on purpose. With `moduleResolution:
 * "bundler"` TypeScript resolves both forms, while webpack's resolver has been
 * seen to decline the `.js` to `.tsx` alias across a workspace package
 * boundary, which is a class of failure that costs an hour to diagnose.
 */

export * from "./charts";
export * from "./primitives";
