/**
 * `@repo/seed` - the offline ventloom world.
 *
 * Twelve volcanoes, ninety-odd stations and four cores' worth of tephra layers,
 * every value derived from the single seed in `src/tephra.ts`. Nothing here
 * reads the network, so the demo runs with no keys and no connectivity.
 */

export * from "./catalogue.js";
export * from "./stations.js";
export * from "./tephra.js";
