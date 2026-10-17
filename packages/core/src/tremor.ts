/**
 * Tremor synthesis and feature extraction.
 *
 * Real-time seismic amplitude (RSAM) and spectral shape are the two most-used
 * volcano-seismology discriminators. This module generates deterministic
 * synthetic traces by physical mechanism - harmonic tremor, volcano-tectonic
 * bursts, rockfall, teleseisms - and then measures them with the same features
 * an observatory would, so the classifier is never inventing signal.
 */

import type { TraceInput } from "./fft.js";
import {
  amplitudeSpectrum,
  bandEnergyFraction,
  countSpectralPeaks,
  dominantFrequency,
  fft,
  ifft,
  nextPowerOfTwo,
  powerSpectrum,
  spectralCentroid,
  spectralFlatness,
} from "./fft.js";
import { hashSeed, mulberry32 } from "./rng.js";

/**
 * Margin, in dB, that a spectral peak must clear above its local background to
 * count as a resolved tone. Matched to the measured statistics of the station
 * background noise - see `countSpectralPeaks`.
 */
export const HARMONIC_PEAK_MARGIN_DB = 20;

/**
 * Spectral exponent of the synthetic background noise below the corner.
 */
export const NOISE_SPECTRAL_EXPONENT = 2;

/**
 * Corner frequency of the background-noise roll-off, Hz.
 *
 * Below this the noise falls as 1/f²; above it the spectrum is flat. A pure
 * 1/f² model was tried first and it is badly wrong for tremor work: essentially
 * all of its energy lands below a few hertz, which is exactly the band harmonic
 * tremor lives in, and every partial except the fundamental drowns. Real seismic
 * background has a broadband floor set by site conditions with a low-frequency
 * roll-off beneath it, which is what this corner reproduces.
 */
export const NOISE_CORNER_HZ = 1.5;

/**
 * RMS of the background noise, as a fraction of the station's nominal amplitude.
 *
 * This is the signal-to-noise ratio, and it is the single most consequential
 * constant in the tremor synthesis. Raise it and every partial except the
 * fundamental drowns: with 0.55 the measured peak-to-background ratio for the
 * second harmonic is 7.4, which is indistinguishable from the 7.1 maximum ratio
 * that pure noise produces. Lower it to 0.3 and the same harmonic sits at 25
 * while the noise ceiling stays where it was, because scaling the noise scales
 * both the peak and its background equally.
 */
export const BACKGROUND_RELATIVE_RMS = 0.3;

/**
 * Station background noise with a 1/f² roll-off below a corner and a flat floor
 * above it.
 *
 * White noise is transformed, each bin's amplitude scaled by
 * `sqrt(1 + (f_corner / f)^β)`, and transformed back. The DC bin is zeroed so
 * the trace does not wander. Deterministic in the RNG state, so the same seed
 * gives the same background.
 */
export function shapeNoisePink(
  length: number,
  beta: number,
  rng: { normal(): number },
  options: { cornerHz?: number; sampleRateHz?: number } = {},
): Float64Array {
  const n = nextPowerOfTwo(length);
  const cornerHz = options.cornerHz ?? 1.5;
  const sampleRateHz = options.sampleRateHz ?? 100;
  const binWidthHz = sampleRateHz / n;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < length; i++) re[i] = rng.normal();
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const bin = k === 0 ? 0 : Math.min(k, n - k);
    if (bin === 0) {
      re[k] = 0;
      im[k] = 0;
      continue;
    }
    const freqHz = bin * binWidthHz;
    const amplitudeScale = Math.sqrt(1 + (cornerHz / Math.max(freqHz, binWidthHz)) ** beta);
    re[k] = (re[k] as number) * amplitudeScale;
    im[k] = (im[k] as number) * amplitudeScale;
  }
  ifft(re, im);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = re[i] as number;
  return out;
}

/** The mechanisms ventloom can synthesise, ordered by escalating severity. */
export const TREMOR_LABELS = [
  "quiescent",
  "harmonic-tremor",
  "vt-swarm",
  "rockfall",
  "teleseism",
  "eruption",
] as const;
export type TremorLabel = (typeof TREMOR_LABELS)[number];

export interface TremorConfig {
  label: TremorLabel;
  durationS: number;
  sampleRateHz: number;
  /** Baseline amplitude in digital units. */
  baseAmplitude: number;
  /** Continuous-tremor corner frequency, Hz. */
  tremorHz?: number;
  /** Linear drift of the tremor frequency across the window, Hz total. */
  tremorDriftHz?: number;
  /** Number of harmonic tremor partials above the fundamental. */
  harmonicCount?: number;
  /** Times of discrete volcano-tectonic earthquakes, seconds. */
  eventTimesS?: readonly number[];
  /** Amplitude of discrete events relative to the baseline. */
  eventAmplitude?: number;
  /** Carrier frequency of the discrete-event wavelet, Hz. */
  eventCarrierHz?: number;
}

/**
 * Event carrier frequencies by mechanism.
 *
 * A volcano-tectonic earthquake is a brittle-failure wavelet with its energy
 * near 5–15 Hz; a teleseism is long-period energy below 2 Hz. Using one carrier
 * for both would make the two indistinguishable to the very spectral
 * discriminator the feature set claims to provide.
 */
const EVENT_CARRIER: Record<TremorLabel, number> = {
  quiescent: 9,
  "harmonic-tremor": 4,
  "vt-swarm": 11,
  rockfall: 7,
  teleseism: 1.6,
  eruption: 3.4,
};

const LABEL_DEFAULTS: Record<TremorLabel, Partial<TremorConfig>> = {
  quiescent: { tremorHz: 0, harmonicCount: 0 },
  // The drift is deliberately small: over a 60 s window a 0.4 Hz glide smears
  // each partial across 33 bins of an 8192-point spectrum, which is as wide as
  // the local-background window the peak counter averages over, and the smeared
  // partials stop clearing the threshold. Real gliding tremor migrates on a
  // timescale of minutes, not seconds.
  "harmonic-tremor": { tremorHz: 2.4, harmonicCount: 5, tremorDriftHz: 0.08 },
  "vt-swarm": { eventAmplitude: 4.5, eventTimesS: "auto" as never },
  rockfall: { tremorHz: 8, harmonicCount: 0 },
  teleseism: { eventAmplitude: 3, eventTimesS: "auto" as never },
  eruption: { tremorHz: 3.1, harmonicCount: 8, tremorDriftHz: 0.18, eventAmplitude: 3 },
};

/** Resolves a config against the label defaults. */
export function resolveTremorConfig(
  config: TremorConfig,
): Required<Pick<TremorConfig, "sampleRateHz" | "durationS" | "baseAmplitude">> & TremorConfig {
  return { ...LABEL_DEFAULTS[config.label], ...config };
}

/**
 * Synthesises a ground-velocity trace for a labelled mechanism.
 *
 * Deterministic in `(label, seed)`: the same pair yields a bit-identical trace,
 * which is what lets the replay surface scrub backwards through time and lets
 * the test suite assert on exact sample values.
 */
export function synthesizeTremor(config: TremorConfig, seed: number): Float64Array {
  const resolved = resolveTremorConfig(config);
  const { durationS, sampleRateHz, baseAmplitude } = resolved;
  const n = Math.max(1, Math.round(durationS * sampleRateHz));
  const out = new Float64Array(n);
  const rng = mulberry32(seed);

  // 1/f^β shaped background - the standing "ground noise" floor of any station.
  //
  // Shaped in the frequency domain rather than by cascaded one-pole filters: a
  // filter cascade can only approximate the slope over a limited band, and what
  // survives above the highest corner is nearly white. Real seismic background
  // noise is strongly red, and the tremor's separability depends on it being
  // correctly modelled - with white noise the background's own centroid lands
  // in the 1-5 Hz band and buries the signal it is supposed to sit under.
  const background = shapeNoisePink(n, NOISE_SPECTRAL_EXPONENT, rng, {
    cornerHz: NOISE_CORNER_HZ,
    sampleRateHz,
  });
  let backgroundRms = 0;
  for (const value of background) backgroundRms += value * value;
  backgroundRms = Math.sqrt(backgroundRms / Math.max(1, n));
  const backgroundScale =
    backgroundRms > 0 ? (baseAmplitude * BACKGROUND_RELATIVE_RMS) / backgroundRms : 0;
  for (let i = 0; i < n; i++) {
    out[i] = (background[i] as number) * backgroundScale;
  }

  // Continuous tremor: a fundamental plus harmonics, with a slow frequency drift.
  const tremorHz = resolved.tremorHz ?? 0;
  const harmonics = resolved.harmonicCount ?? 0;
  if (tremorHz > 0 && harmonics > 0) {
    const nyquist = sampleRateHz / 2;
    // Phases are drawn once per harmonic, not per sample: a phase redrawn every
    // sample turns a tone into noise and destroys the harmonic structure the
    // classifier depends on.
    const partials: { harmonic: number; weight: number; phase: number }[] = [];
    for (let h = 1; h <= harmonics; h++) {
      partials.push({
        harmonic: h,
        weight: (1 / h) * Math.exp(-0.15 * h),
        phase: rng.uniform(0, 2 * Math.PI),
      });
    }
    for (let i = 0; i < n; i++) {
      const t = i / sampleRateHz;
      const progress = durationS > 0 ? t / durationS : 0;
      const fundamental = tremorHz + (resolved.tremorDriftHz ?? 0) * progress;
      let value = 0;
      for (const partial of partials) {
        const freq = fundamental * partial.harmonic;
        if (freq >= nyquist) break;
        // Slow amplitude breathing. Its rate matters more than it looks: a
        // modulation at 0.1 Hz puts sidebands every 9 bins, which is wide enough
        // to break each partial into a comb of comparable teeth and destroy the
        // narrow-peak structure the harmonic counter depends on. Real tremor
        // envelopes change over minutes, so 0.02 Hz is both physical and what
        // the feature extractor needs.
        const modulation = 0.9 + 0.1 * Math.sin(2 * Math.PI * 0.02 * t + partial.phase);
        value += partial.weight * modulation * Math.sin(2 * Math.PI * freq * t + partial.phase);
      }
      out[i] = (out[i] ?? 0) + value * baseAmplitude * 0.8;
    }
  }

  // Block-and-ash flow noise: gated white noise, distinct from the standing
  // ground-noise floor and from the tonal continuous tremor above.
  if (resolved.label === "rockfall") {
    const gatePhase = rng.uniform(0, 2 * Math.PI);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRateHz;
      const gate = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.037 * t + gatePhase);
      out[i] = (out[i] ?? 0) + rng.normal() * baseAmplitude * 0.9 * (0.1 + 0.9 * gate * gate);
    }
  }

  // Discrete events: volcano-tectonic bursts and teleseisms are both impulsive.
  // `eventTimesS` carries the literal string "auto" for the generated schedules
  // and an explicit array when a caller supplies one.
  let eventTimes: number[] = [];
  const schedule: "auto" | readonly number[] | undefined = resolved.eventTimesS as
    | "auto"
    | readonly number[]
    | undefined;
  if (schedule === "auto" || schedule === undefined) {
    const count = resolved.label === "vt-swarm" ? 14 : resolved.label === "teleseism" ? 1 : 2;
    eventTimes = Array.from(
      { length: count },
      (_, k) => rng.uniform(0.02, 0.96) * durationS + k * 0.0001,
    ).sort((a, b) => a - b);
  } else {
    eventTimes = [...schedule];
  }
  const eventAmp = resolved.eventAmplitude ?? 3;
  const carrierHz = resolved.eventCarrierHz ?? EVENT_CARRIER[resolved.label] ?? 8;
  for (const start of eventTimes) {
    if (start >= durationS) continue;
    const startIndex = Math.floor(start * sampleRateHz);
    const length = Math.min(n - startIndex, Math.round(sampleRateHz * 1.4));
    for (let k = 0; k < length; k++) {
      if (startIndex + k >= n) break;
      const index = startIndex + k;
      if (index >= n || index < 0) break;
      const t = k / sampleRateHz;
      const envelope = Math.exp(-t * 6) * (1 - Math.exp(-t * 220));
      const carrier = Math.sin(2 * Math.PI * carrierHz * t);
      out[index] = (out[index] ?? 0) + carrier * envelope * baseAmplitude * eventAmp;
    }
  }

  // Sensor saturation clip - a real three-component seismometer clips too.
  const ceiling = baseAmplitude * 12;
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(-ceiling, Math.min(ceiling, out[i] as number));
  }
  return out;
}

export interface TremorFeatures {
  /** Real-time seismic amplitude: RMS over the window, in input units. */
  rsam: number;
  /** Largest absolute sample. */
  peakAmplitude: number;
  /** `peak / rms`. High for impulsive events, ~1.4 for Gaussian noise. */
  crestFactor: number;
  /** Refined peak frequency, Hz. */
  dominantHz: number;
  /** "Centre of mass" of the spectrum, Hz. */
  spectralCentroidHz: number;
  /** 0 = pure tone, 1 = white noise. */
  spectralFlatness: number;
  /** Fraction of power in the 1–5 Hz band where volcanic tremor lives. */
  tremorBandFraction: number;
  /** Fraction of power in the 5–15 Hz band where rockfall and VT events live. */
  broadbandBandFraction: number;
  /** Number of resolved spectral peaks standing above their local background. */
  harmonicPeakCount: number;
}

/** Extracts the features a duty seismologist would read off the screen. */
export function tremorFeatures(signal: TraceInput, sampleRateHz: number): TremorFeatures {
  if (signal.length === 0) {
    return {
      rsam: 0,
      peakAmplitude: 0,
      crestFactor: 0,
      dominantHz: 0,
      spectralCentroidHz: 0,
      spectralFlatness: 0,
      tremorBandFraction: 0,
      broadbandBandFraction: 0,
      harmonicPeakCount: 0,
    };
  }
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < signal.length; i++) {
    const v = signal[i] ?? 0;
    sumSquares += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const rsam = Math.sqrt(sumSquares / signal.length);
  const { magnitudes, frequenciesHz } = amplitudeSpectrum(signal, sampleRateHz, undefined);
  const powers = magnitudes.map((m) => (m * m) / 2);
  return {
    rsam,
    peakAmplitude: peak,
    crestFactor: rsam > 0 ? peak / rsam : 0,
    dominantHz: dominantFrequency(frequenciesHz, powers),
    spectralCentroidHz: spectralCentroid(frequenciesHz, powers),
    spectralFlatness: spectralFlatness(powers),
    tremorBandFraction: bandEnergyFraction(frequenciesHz, powers, 1, 5),
    broadbandBandFraction: bandEnergyFraction(frequenciesHz, powers, 5, 15),
    harmonicPeakCount: countSpectralPeaks(powers, HARMONIC_PEAK_MARGIN_DB),
  };
}

/**
 * Dominant frequency of a single window, as a standalone helper for the
 * spectrogram crosshair.
 */
export function windowDominantHz(signal: TraceInput, sampleRateHz: number): number {
  const { powers, frequenciesHz } = powerSpectrum(signal, sampleRateHz);
  return dominantFrequency(frequenciesHz, powers);
}

/**
 * Chooses the mechanism label whose measured features best match an observed
 * trace.
 *
 * Scoring runs on *shape* features only - spectral flatness, crest factor, band
 * fractions and resolved peak count. Amplitude is deliberately excluded: the
 * candidate traces are synthesised at an arbitrary unit amplitude, so an
 * amplitude term would dominate the score with nothing but the mismatch in
 * absolute level and the classifier would rank by loudness rather than by
 * mechanism.
 */
export function classifyTremor(
  signal: TraceInput,
  sampleRateHz: number,
  seed = 7331,
): { label: TremorLabel; score: number; ranking: { label: TremorLabel; score: number }[] } {
  const observed = tremorFeatures(signal, sampleRateHz);
  const shape = (f: TremorFeatures): number[] => [
    f.spectralFlatness,
    Math.log(Math.max(f.crestFactor, 1)),
    f.tremorBandFraction,
    f.broadbandBandFraction,
    f.harmonicPeakCount / 10,
  ];
  const observedShape = shape(observed);
  const ranking = TREMOR_LABELS.map((label) => {
    const candidate = tremorFeatures(
      synthesizeTremor(
        { label, durationS: 60, sampleRateHz, baseAmplitude: 1 },
        hashSeed(`${label}:${seed}`),
      ),
      sampleRateHz,
    );
    const candidateShape = shape(candidate);
    const score = candidateShape.reduce(
      (sum, value, i) => sum + Math.abs(value - (observedShape[i] as number)),
      0,
    );
    return { label, score };
  }).sort((a, b) => a.score - b.score);
  return { label: ranking[0]?.label ?? "quiescent", score: ranking[0]?.score ?? 0, ranking };
}
