/**
 * The volcano catalogue.
 *
 * Coordinates, elevations and types are taken from public volcano references
 * (Smithsonian Global Volcanism Program "Volcanoes of the World", national
 * observatory pages). The unrest profile and the monitoring network are
 * ventloom's own synthetic construction - nothing here is a live feed. The
 * catalogue exists so the demo runs against recognisable, real geography while
 * every number the app shows is deterministic and offline.
 */

import type { VolcanoRecord } from "@repo/core";

export const VOLCANO_CATALOGUE: readonly VolcanoRecord[] = [
  {
    id: "kilauea",
    name: "Kīlauea",
    country: "United States (Hawaii)",
    latitudeDeg: 19.421,
    longitudeDeg: -155.287,
    elevationM: 1222,
    volcanoType: "shield",
    unrestProfile: "escalating",
    summary:
      "Hawaiian shield volcano with a summit caldera and an active east rift zone. Effusive eruptions alternate with summit inflation, and the rift geometry dominates the deformation field.",
  },
  {
    id: "sakurajima",
    name: "Sakurajima",
    country: "Japan",
    latitudeDeg: 31.591,
    longitudeDeg: 130.657,
    elevationM: 1117,
    volcanoType: "stratovolcano",
    unrestProfile: "steady-degassing",
    summary:
      "One of the most active stratovolcanoes on Earth, in a near-continuous Vulcanian state. The 1914 Taisho eruption produced the subsidence field Mogi fitted his model to.",
  },
  {
    id: "etna",
    name: "Mount Etna",
    country: "Italy",
    latitudeDeg: 37.751,
    longitudeDeg: 14.993,
    elevationM: 3357,
    volcanoType: "stratovolcano",
    unrestProfile: "waxing",
    summary:
      "Basaltic stratovolcano on Sicily with persistent summit activity and frequent flank eruptions. Gas flux and tremor move together on multi-week cycles.",
  },
  {
    id: "merapi",
    name: "Merapi",
    country: "Indonesia",
    latitudeDeg: -7.54,
    longitudeDeg: 110.446,
    elevationM: 2968,
    volcanoType: "stratovolcano",
    unrestProfile: "escalating",
    summary:
      "Andesitic stratovolcano in central Java whose dome growth and collapse cycles produce repeated volcanic earthquakes and pyroclastic flows.",
  },
  {
    id: "popocatepetl",
    name: "Popocatepetl",
    country: "Mexico",
    latitudeDeg: 19.023,
    longitudeDeg: -98.622,
    elevationM: 5426,
    volcanoType: "stratovolcano",
    unrestProfile: "steady-degassing",
    summary:
      "Glacier-capped andesitic stratovolcano southeast of Mexico City, with a long record of dome extrusion, ash emission and persistent degassing.",
  },
  {
    id: "st-helens",
    name: "Mount St. Helens",
    country: "United States (Washington)",
    latitudeDeg: 46.2,
    longitudeDeg: -122.18,
    elevationM: 2549,
    volcanoType: "stratovolcano",
    unrestProfile: "quiescent",
    summary:
      "Rebuilt lava dome inside the 1980 collapse scar, monitored by a dense GNSS and seismic network. A long-lived example of a post-eruption volcano settling.",
  },
  {
    id: "fuego",
    name: "Fuego",
    country: "Guatemala",
    latitudeDeg: 14.474,
    longitudeDeg: -90.88,
    elevationM: 3763,
    volcanoType: "stratovolcano",
    unrestProfile: "escalating",
    summary:
      "Highly active andesitic stratovolcano with frequent paroxysmal eruptions and block-and-ash flows down its ravines.",
  },
  {
    id: "cotopaxi",
    name: "Cotopaxi",
    country: "Ecuador",
    latitudeDeg: -0.677,
    longitudeDeg: -78.436,
    elevationM: 5897,
    volcanoType: "stratovolcano",
    unrestProfile: "post-eruption",
    summary:
      "Glacier-clad andesitic stratovolcano in the Andes, prone to lahars that travel far beyond the edifice, which makes the hazard surface the primary product.",
  },
  {
    id: "shiveluch",
    name: "Shiveluch",
    country: "Russia (Kamchatka)",
    latitudeDeg: 56.653,
    longitudeDeg: 161.36,
    elevationM: 3283,
    volcanoType: "stratovolcano",
    unrestProfile: "steady-degassing",
    summary:
      "Kamchatkan stratovolcano with frequent dome extrusion and large Vulcanian eruptions; a strong infrasound and gas candidate.",
  },
  {
    id: "bezymianny",
    name: "Bezymianny",
    country: "Russia (Kamchatka)",
    latitudeDeg: 55.972,
    longitudeDeg: 160.595,
    elevationM: 2882,
    volcanoType: "stratovolcano",
    unrestProfile: "post-eruption",
    summary:
      "Resurgent dome inside the 1956 directed-blast crater. The classic case for Mogi inversion: concentric deformation around a buried source.",
  },
  {
    id: "taupo",
    name: "Taupo",
    country: "New Zealand",
    latitudeDeg: -38.82,
    longitudeDeg: 175.995,
    elevationM: 760,
    volcanoType: "caldera",
    unrestProfile: "quiescent",
    summary:
      "Rhyolitic caldera system beneath Lake Taupo. Caldeira-wide inflation is slow but the hazard footprint is enormous, so small unrest indices matter.",
  },
  {
    id: "augustine",
    name: "Augustine",
    country: "United States (Alaska)",
    latitudeDeg: 59.363,
    longitudeDeg: -153.43,
    elevationM: 1252,
    volcanoType: "lava-dome",
    unrestProfile: "waxing",
    summary:
      "Island lava dome in Cook Inlet with short, well-observed precursory sequences: a canonical test case for deformation-then-tremor escalation.",
  },
];

/** Looks up a volcano by its slug. */
export function findVolcano(id: string): VolcanoRecord | undefined {
  return VOLCANO_CATALOGUE.find((volcano) => volcano.id === id);
}

/** The declared unrest profile of a volcano, for the profile legend. */
export const UNREST_PROFILES = [
  "quiescent",
  "escalating",
  "post-eruption",
  "steady-degassing",
  "waxing",
] as const;
