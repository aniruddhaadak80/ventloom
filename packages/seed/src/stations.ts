/**
 * The monitoring network.
 *
 * Six stations per volcano, placed deterministically from the volcano id so the
 * geometry is stable across runs and the geodetic inversion is reproducible.
 * The mix of instruments mirrors a real observatory: two or three GNSS benches
 * (the deformation channels the Mogi inversion needs), two or three seismometers,
 * and where the volcano justifies it an infrasound array and a multigas station.
 */

import type { StationRecord } from "@repo/core";
import { hashSeed, mulberry32 } from "@repo/core";
import { VOLCANO_CATALOGUE } from "./catalogue.js";

const INSTRUMENT_PATTERNS: readonly StationRecord["instrument"][] = [
  "gnss",
  "gnss",
  "broadband-seismic",
  "broadband-seismic",
  "short-period-seismic",
  "infrasound",
];

/** Extra stations for volcanoes with a gas or hazard mandate. */
const EXTENDED_PATTERNS: Readonly<Record<string, readonly StationRecord["instrument"][]>> = {
  kilauea: ["gnss", "short-period-seismic"],
  sakurajima: ["infrasound", "gas-multigas"],
  etna: ["gas-multigas", "short-period-seismic"],
  popocatepetl: ["gas-multigas"],
  fuego: ["short-period-seismic", "infrasound"],
  cotopaxi: ["infrasound"],
  shiveluch: ["infrasound", "gas-multigas"],
};

/**
 * Observatory codes follow the four-letter station convention: a network prefix
 * derived from the volcano plus a station letter.
 */
function stationCode(volcanoId: string, index: number): string {
  const prefix = volcanoId
    .replace(/[^a-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const letter = String.fromCharCode(65 + (index % 26));
  return `${prefix}${letter}`;
}

export const STATION_NETWORK: readonly StationRecord[] = VOLCANO_CATALOGUE.flatMap((volcano) => {
  const rng = mulberry32(hashSeed(`stations:${volcano.id}`));
  const instruments: StationRecord["instrument"][] = [
    ...INSTRUMENT_PATTERNS,
    ...(EXTENDED_PATTERNS[volcano.id] ?? []),
  ];
  return instruments.map((instrument, index) => {
    // Golden-angle spiral: well spread in azimuth, increasing radius, no clumping.
    const azimuth = index * 2.399963 + rng.uniform(-0.25, 0.25);
    const radius = 900 + index * 780 + rng.uniform(-220, 420);
    return {
      id: `${volcano.id}-${stationCode(volcano.id, index).toLowerCase()}`,
      volcanoId: volcano.id,
      code: stationCode(volcano.id, index),
      eastOffsetM: Math.round(Math.cos(azimuth) * radius),
      northOffsetM: Math.round(Math.sin(azimuth) * radius),
      elevationM: Math.round(volcano.elevationM + rng.uniform(-420, 60)),
      instrument,
    } satisfies StationRecord;
  });
});

/** Every station belonging to one volcano. */
export function stationsFor(volcanoId: string): StationRecord[] {
  return STATION_NETWORK.filter((station) => station.volcanoId === volcanoId);
}

/** Every GNSS station belonging to one volcano - the inversion's input. */
export function gnssStationsFor(volcanoId: string): StationRecord[] {
  return stationsFor(volcanoId).filter((station) => station.instrument === "gnss");
}

/** Counts instruments by family, for the network legend. */
export function instrumentCounts(
  stations: readonly StationRecord[] = STATION_NETWORK,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const station of stations) {
    counts[station.instrument] = (counts[station.instrument] ?? 0) + 1;
  }
  return counts;
}
