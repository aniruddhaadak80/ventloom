/**
 * Tephra geochemistry seed world.
 *
 * Three end-member compositions - rhyolitic, andesitic, basaltic - plus a set of
 * recovered layers in four cores. Layers are drawn from an end member and then
 * perturbed with a seeded, small, closed perturbation, which reproduces the two
 * properties that make real tephra correlation hard: two layers from the same
 * eruption can look different, while two different eruptions can look alike.
 */

import {
  aitchisonDistance,
  type Composition,
  hashSeed,
  mulberry32,
  OXIDE_ORDER,
  type TephraSample,
} from "@repo/core";

interface EndMember {
  readonly id: string;
  readonly name: string;
  readonly composition: Composition;
  /** Volcanic explosivity index of the unit. */
  readonly vei: number;
  readonly ageYearsAgo: number;
  readonly sourceVolcano: string;
}

const END_MEMBERS: readonly EndMember[] = [
  {
    id: "rhyolite-a",
    name: "Unit R-1 (rhyolitic)",
    vei: 6,
    ageYearsAgo: 2320,
    sourceVolcano: "taupo",
    composition: {
      SiO2: 75.4,
      TiO2: 0.31,
      Al2O3: 12.8,
      Fe2O3: 3.1,
      MnO: 0.09,
      MgO: 0.34,
      CaO: 1.42,
      Na2O: 3.68,
      K2O: 2.74,
      P2O5: 0.11,
    },
  },
  {
    id: "andesite-b",
    name: "Unit A-3 (andesitic)",
    vei: 4,
    ageYearsAgo: 1140,
    sourceVolcano: "popocatepetl",
    composition: {
      SiO2: 59.6,
      TiO2: 0.72,
      Al2O3: 17.4,
      Fe2O3: 7.2,
      MnO: 0.16,
      MgO: 3.1,
      CaO: 6.4,
      Na2O: 3.9,
      K2O: 1.42,
      P2O5: 0.1,
    },
  },
  {
    id: "basalt-c",
    name: "Unit B-2 (basaltic)",
    vei: 3,
    ageYearsAgo: 640,
    sourceVolcano: "kilauea",
    composition: {
      SiO2: 48.9,
      TiO2: 2.4,
      Al2O3: 13.1,
      Fe2O3: 12.6,
      MnO: 0.2,
      MgO: 8.4,
      CaO: 10.6,
      Na2O: 2.3,
      K2O: 0.42,
      P2O5: 0.28,
    },
  },
  {
    id: "dacite-d",
    name: "Unit D-4 (dacitic)",
    vei: 5,
    ageYearsAgo: 3890,
    sourceVolcano: "bezymianny",
    composition: {
      SiO2: 66.2,
      TiO2: 0.55,
      Al2O3: 15.3,
      Fe2O3: 5.6,
      MnO: 0.13,
      MgO: 2.1,
      CaO: 4.6,
      Na2O: 3.4,
      K2O: 2.06,
      P2O5: 0.16,
    },
  },
];

export const END_MEMBER_LIST = END_MEMBERS;

/**
 * Perturbs an end member into a recovered layer composition.
 *
 * Perturbations are multiplicative and then re-closed to 100 %, so a layer
 * never drifts off the simplex. The magnitude is drawn from a log-normal
 * distribution scaled by `scatter` - a couple of percent for proximal cores,
 * more for distal ones where the fine fraction is enriched in SiO₂.
 */
export function perturbComposition(base: Composition, scatter: number, seed: number): Composition {
  const rng = mulberry32(seed);
  const factors = OXIDE_ORDER.map(() => Math.exp(rng.gaussian(0, scatter)));
  const raw = OXIDE_ORDER.map((oxide, i) => base[oxide] * (factors[i] as number));
  const total = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    OXIDE_ORDER.map((oxide, i) => [oxide, (raw[i] as number) * (100 / total)]),
  ) as Composition;
}

export interface CoreSeed {
  readonly id: string;
  readonly name: string;
  readonly kind: "ice" | "marine-sediment" | "lacustrine-sediment" | "soil-profile";
  readonly depthM: number;
  readonly note: string;
}

export const CORES: readonly CoreSeed[] = [
  {
    id: "ice-core-north",
    name: "North Dome ice core ND-1",
    kind: "ice",
    depthM: 412.6,
    note: "High-accumulation dome. Layers are thin but the chemistry is pristine.",
  },
  {
    id: "marine-core-west",
    name: "West Basin marine core WB-7",
    kind: "marine-sediment",
    depthM: 28.4,
    note: "Marine record. Distal tephra is fine-grained, so SiO₂ is enriched.",
  },
  {
    id: "lake-core-east",
    name: "East Lake core EL-3",
    kind: "lacustrine-sediment",
    depthM: 9.1,
    note: "Varved lake sediment giving an independent age model.",
  },
  {
    id: "soil-profile-south",
    name: "South Ridge soil profile SR-2",
    kind: "soil-profile",
    depthM: 1.8,
    note: "Soil profile. The shallowest units are weathered and less distinctive.",
  },
];

/** Per-core scatter and layer spacing, by core kind. */
const CORE_SETTINGS: Readonly<
  Record<CoreSeed["kind"], { scatter: number; spacingM: number; layers: number }>
> = {
  ice: { scatter: 0.035, spacingM: 14.2, layers: 5 },
  "marine-sediment": { scatter: 0.085, spacingM: 3.6, layers: 5 },
  "lacustrine-sediment": { scatter: 0.05, spacingM: 1.4, layers: 5 },
  "soil-profile": { scatter: 0.12, spacingM: 0.33, layers: 5 },
};

/**
 * The recovered tephra layers across all cores.
 *
 * Each core touches a subset of the four end members, in the same relative
 * order, so a correct correlation engine recovers the four groups while a naive
 * one merges the two silica-rich end members.
 */
export const TEPHRA_LAYERS: readonly TephraSample[] = CORES.flatMap((core) => {
  const settings = CORE_SETTINGS[core.kind];
  // Each core sees the end members in age order, but each misses at least one.
  const seen = END_MEMBERS.filter((_, index) => (hashSeed(core.id) + index) % 5 !== 2);
  return seen.slice(0, settings.layers).map((member, layer) => {
    const id = `${core.id}-L${layer + 1}`;
    return {
      id,
      coreId: core.id,
      depthM: Math.round((layer * settings.spacingM + 1.1) * 100) / 100,
      composition: perturbComposition(member.composition, settings.scatter, hashSeed(id)),
      note: `${member.name} candidate, ${core.name}`,
    } satisfies TephraSample;
  });
});

/** Helper for the UI: which end member a layer most resembles. */
export function nearestEndMemberId(sample: TephraSample): { id: string; distance: number } {
  let best = END_MEMBERS[0] as (typeof END_MEMBERS)[number];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const member of END_MEMBERS) {
    const distance = aitchisonDistance(sample.composition, member.composition);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = member;
    }
  }
  return { id: best.id, distance: bestDistance };
}

/** The seed this world was generated from. */
export const SEED = 7331;
