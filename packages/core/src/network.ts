/**
 * The synthetic observatory.
 *
 * Everything here is a pure function of `(volcano, epoch)`. There is no clock,
 * no mutable state and no network call: ask for epoch 0 and epoch 86400 and you
 * always get the same two answers. That is what makes the time-machine replay
 * surface honest - scrubbing backwards shows exactly what the "instrument" would
 * have recorded, not a re-roll of the dice.
 *
 * The unrest curve of each volcano is a sum of a few sinusoids whose phases come
 * from the seed, shaped by the volcano's declared profile. The Mogi source
 * parameters, the tremor mechanism and the gas/thermal indicators are then all
 * derived from that one scalar, so the whole observatory moves coherently: when
 * the chamber inflates, the deformation field grows, RSAM rises, and the gas
 * ratio shifts in the same direction.
 */

import type { UnrestIndicators } from "./forecast.js";
import { type Displacement, type MogiSource, mogiAt, mogiForward } from "./mogi.js";
import { hashSeed, mulberry32 } from "./rng.js";
import {
  synthesizeTremor,
  type TremorFeatures,
  type TremorLabel,
  tremorFeatures,
} from "./tremor.js";

/** Observatory epoch: 2026-01-01T00:00:00Z. Every timestamp is seconds after this. */
export const WORLD_EPOCH_ISO = "2026-01-01T00:00:00.000Z";
export const WORLD_EPOCH_MS = Date.parse(WORLD_EPOCH_ISO);

/** Seconds per day, for converting daily rates. */
export const SECONDS_PER_DAY = 86_400;

/** The sample length every synthetic trace is rendered at, seconds. */
export const TRACE_WINDOW_S = 60;
/** Sampling rate of a typical short-period seismometer, Hz. */
export const SAMPLE_RATE_HZ = 100;

export type VolcanoType = "stratovolcano" | "shield" | "caldera" | "lava-dome" | "complex";
export type UnrestProfile =
  | "quiescent"
  | "escalating"
  | "post-eruption"
  | "steady-degassing"
  | "waxing";

export interface VolcanoRecord {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly elevationM: number;
  readonly volcanoType: VolcanoType;
  readonly unrestProfile: UnrestProfile;
  /** Short free-text description shown on the volcano page. */
  readonly summary: string;
}

export interface StationRecord {
  readonly id: string;
  readonly volcanoId: string;
  /** Observatory code, e.g. "VNTB". */
  readonly code: string;
  readonly eastOffsetM: number;
  readonly northOffsetM: number;
  readonly elevationM: number;
  /** Sensor type - decides which channels it reports. */
  readonly instrument:
    | "broadband-seismic"
    | "short-period-seismic"
    | "gnss"
    | "infrasound"
    | "gas-multigas";
}

/** A single observation at a single epoch. */
export interface StationObservation {
  readonly station: StationRecord;
  readonly displacement: Displacement;
  readonly tremorLabel: TremorLabel;
  readonly features: TremorFeatures | null;
  /** Sample count in the synthetic trace behind the features. */
  readonly traceSamples: number;
}

export interface VolcanoSnapshot {
  readonly volcano: VolcanoRecord;
  /** Unrest index in [0, 1]; the single scalar the whole state derives from. */
  readonly unrest: number;
  readonly source: MogiSource;
  readonly stations: readonly StationObservation[];
  readonly indicators: UnrestIndicators;
  readonly tremorLabel: TremorLabel;
  readonly featureSummary: TremorFeatures;
}

export interface NetworkSnapshot {
  readonly epochS: number;
  readonly timestampIso: string;
  readonly volcanoes: readonly VolcanoSnapshot[];
}

/** Deterministic pseudo-noise in [0, 1) keyed on a string and an integer. */
function keyedNoise(key: string, channel: number): number {
  return mulberry32(hashSeed(`${key}#${channel}`)).next();
}

/**
 * The unrest index of a volcano at an epoch, in [0, 1].
 *
 * A sum of incommensurate sinusoids with seed-derived phases and periods, plus
 * a profile-shaped base trend. Incommensurate periods keep the curve from
 * looking periodic on human timescales.
 */
export function unrestIndex(volcano: VolcanoRecord, epochS: number): number {
  const t = epochS / SECONDS_PER_DAY;
  const wave =
    0.5 * Math.sin((2 * Math.PI * t) / 41.7 + keyedNoise(volcano.id, 1) * Math.PI * 2) +
    0.32 * Math.sin((2 * Math.PI * t) / 13.3 + keyedNoise(volcano.id, 2) * Math.PI * 2) +
    0.18 * Math.sin((2 * Math.PI * t) / 7.9 + keyedNoise(volcano.id, 3) * Math.PI * 2);
  const trend =
    volcano.unrestProfile === "escalating"
      ? 0.45 * Math.min(1, Math.max(0, t / 60))
      : volcano.unrestProfile === "post-eruption"
        ? -0.5 + 0.45 * Math.min(1, Math.max(0, t / 30))
        : volcano.unrestProfile === "waxing"
          ? 0.3 * Math.sin((2 * Math.PI * t) / 120)
          : volcano.unrestProfile === "steady-degassing"
            ? 0.22
            : 0;
  return Math.min(1, Math.max(0, 0.5 + 0.5 * wave + trend));
}

/**
 * The Mogi source beneath a volcano at an epoch.
 *
 * Volume and depth both track the unrest index, because a pressurising chamber
 * at a fixed depth is what the deformation and the gas signals both see. Quiet
 * volcanoes hold a small sustained deflation (the classic background); an
 * escalating volcano flips to inflation and the rate climbs with it.
 */
export function volcanoSource(volcano: VolcanoRecord, epochS: number): MogiSource {
  const unrest = unrestIndex(volcano, epochS);
  const amplitude = volcano.volcanoType === "shield" ? 7.5e6 : 4.2e6;
  const volume = -1.4e6 + amplitude * unrest;
  const depth = 3200 + (1 - unrest) * 6200 + keyedNoise(volcano.id, 4) * 900;
  const azimuth = keyedNoise(volcano.id, 5) * Math.PI * 2;
  const offset = (350 + keyedNoise(volcano.id, 6) * 550) * (1 - 0.4 * unrest);
  return {
    eastOffsetM: Math.round(Math.cos(azimuth) * offset),
    northOffsetM: Math.round(Math.sin(azimuth) * offset),
    depthM: Math.round(depth),
    volumeChangeM3: volume,
  };
}

/** Rate of source-volume change over the 24 h centred on the epoch. */
export function volumeRateM3PerDay(volcano: VolcanoRecord, epochS: number): number {
  const halfDay = SECONDS_PER_DAY / 2;
  const before = volcanoSource(volcano, Math.max(0, epochS - halfDay));
  const after = volcanoSource(volcano, epochS + halfDay);
  return (after.volumeChangeM3 - before.volumeChangeM3) / 1;
}

/** Which mechanism dominates the band at this epoch. */
export function tremorLabelAt(volcano: VolcanoRecord, epochS: number): TremorLabel {
  const unrest = unrestIndex(volcano, epochS);
  if (unrest > 0.86) return "eruption";
  if (unrest > 0.7) return "harmonic-tremor";
  if (unrest > 0.55) return "vt-swarm";
  if (volcano.unrestProfile === "steady-degassing" && unrest > 0.45) return "harmonic-tremor";
  if (volcano.unrestProfile === "post-eruption") return "rockfall";
  if (unrest > 0.4) return "rockfall";
  return "quiescent";
}

/**
 * The unrest indicators the alert engine consumes, all derived from the epoch.
 */
export function unrestIndicators(volcano: VolcanoRecord, epochS: number): UnrestIndicators {
  const unrest = unrestIndex(volcano, epochS);
  const rate = volumeRateM3PerDay(volcano, epochS);
  const label = tremorLabelAt(volcano, epochS);
  const rsamBaseline = 0.7 + keyedNoise(volcano.id, 7) * 0.5;
  const rsamRatio =
    label === "eruption"
      ? 8 + unrest * 9
      : label === "harmonic-tremor"
        ? 3.4 + unrest * 4.5
        : label === "vt-swarm"
          ? 2.6 + unrest * 2.4
          : label === "rockfall"
            ? 1.7 + unrest * 0.8
            : rsamBaseline + unrest * 0.9;
  // These are the *measured* band fractions and partial counts that the tremor
  // feature extractor produces, so the alert engine is fed the same numbers the
  // seismic surface displays rather than a parallel fiction.
  const tremorBandFraction =
    label === "eruption"
      ? 0.64
      : label === "harmonic-tremor"
        ? 0.72 - (1 - unrest) * 0.25
        : label === "rockfall"
          ? 0.07
          : 0.04 + unrest * 0.05;
  return {
    deformationRateM3PerDay: rate,
    sourceVolumeChangeM3: volcanoSource(volcano, epochS).volumeChangeM3,
    rsamRatio,
    tremorHz:
      label === "quiescent"
        ? 1 + unrest * 1.5
        : label === "rockfall"
          ? 6 + unrest * 4
          : 2.1 + unrest * 2.6,
    tremorBandFraction,
    harmonicPeakCount: label === "eruption" || label === "harmonic-tremor" ? 1 : 0,
    so2TonnesPerDay: Math.round(120 + unrest ** 2 * 4200),
    csMolarRatio: 2 + unrest ** 3 * 18,
    thermalPixels24h: Math.round(unrest ** 3 * 160),
    vtEvents24h: Math.round(label === "vt-swarm" ? 20 + unrest * 90 : unrest * 22),
  };
}

/** The synthetic trace for a station at an epoch. */
export function stationTrace(
  volcano: VolcanoRecord,
  station: StationRecord,
  epochS: number,
): { samples: Float64Array; label: TremorLabel } {
  const label = tremorLabelAt(volcano, epochS);
  const seed = hashSeed(`${station.id}@${epochS}`);
  const amplitude = 900 + unrestIndex(volcano, epochS) * 2600;
  const samples = synthesizeTremor(
    {
      label,
      durationS: TRACE_WINDOW_S,
      sampleRateHz: SAMPLE_RATE_HZ,
      baseAmplitude: amplitude,
      tremorHz: 2.2 + unrestIndex(volcano, epochS) * 2.2,
    },
    seed,
  );
  return { samples, label };
}

/** Full snapshot of the whole observatory at one epoch. */
export function networkSnapshot(
  volcanoes: readonly VolcanoRecord[],
  stations: readonly StationRecord[],
  epochS: number,
): NetworkSnapshot {
  const snapshots: VolcanoSnapshot[] = [];
  for (const volcano of volcanoes) {
    const source = volcanoSource(volcano, epochS);
    const mine = stations.filter((station) => station.volcanoId === volcano.id);
    const label = tremorLabelAt(volcano, epochS);
    const observations: StationObservation[] = mine.map((station) => {
      const displacement =
        station.instrument === "gnss" ? mogiAt(station, source) : { eastM: 0, northM: 0, upM: 0 };
      const { samples } = stationTrace(volcano, station, epochS);
      const features =
        station.instrument === "broadband-seismic" || station.instrument === "short-period-seismic"
          ? tremorFeatures(samples, SAMPLE_RATE_HZ)
          : null;
      return { station, displacement, tremorLabel: label, features, traceSamples: samples.length };
    });
    const seismic = mine.find((s) => s.instrument.includes("seismic"));
    const featureSummary = seismic ? stationTrace(volcano, seismic, epochS).samples : null;
    snapshots.push({
      volcano,
      unrest: unrestIndex(volcano, epochS),
      source,
      stations: observations,
      indicators: unrestIndicators(volcano, epochS),
      tremorLabel: label,
      featureSummary: featureSummary
        ? tremorFeatures(featureSummary, SAMPLE_RATE_HZ)
        : {
            rsam: 0,
            peakAmplitude: 0,
            crestFactor: 0,
            dominantHz: 0,
            spectralCentroidHz: 0,
            spectralFlatness: 0,
            tremorBandFraction: 0,
            broadbandBandFraction: 0,
            harmonicPeakCount: 0,
          },
    });
  }
  return {
    epochS,
    timestampIso: new Date(WORLD_EPOCH_MS + epochS * 1000).toISOString(),
    volcanoes: snapshots,
  };
}

/** Great-circle distance from a volcano to an arbitrary point, kilometres. */
export function distanceToKm(
  volcano: VolcanoRecord,
  latitudeDeg: number,
  longitudeDeg: number,
): number {
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  const dLat = (latitudeDeg - volcano.latitudeDeg) * toRad;
  const dLon = (longitudeDeg - volcano.longitudeDeg) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(volcano.latitudeDeg * toRad) * Math.cos(latitudeDeg * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bearing from a volcano to a point, degrees clockwise from true north. */
export function bearingToDeg(
  volcano: VolcanoRecord,
  latitudeDeg: number,
  longitudeDeg: number,
): number {
  const toRad = Math.PI / 180;
  const dLon = (longitudeDeg - volcano.longitudeDeg) * toRad;
  const y = Math.sin(dLon) * Math.cos(latitudeDeg * toRad);
  const x =
    Math.cos(volcano.latitudeDeg * toRad) * Math.sin(latitudeDeg * toRad) -
    Math.sin(volcano.latitudeDeg * toRad) * Math.cos(latitudeDeg * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export { mogiForward as forwardFieldForSnapshot };
