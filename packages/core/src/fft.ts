/**
 * A real-input fast Fourier transform and the spectral features derived from it.
 *
 * This is the "is the ground humming" engine. A bit-exact radix-2 Cooleyâ€“Tukey
 * transform lets the seismic surface distinguish a genuine harmonic tremor â€”
 * narrow, sustained, evenly spaced spectral peaks at 1â€“7 Hz â€” from broadband
 * rockfall noise or a single teleseism, entirely on-device.
 */

/** Smallest power of two that is >= `n` (and >= 1). */
export function nextPowerOfTwo(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * In-place iterative radix-2 complex FFT.
 *
 * The bit-reversal permutation is applied first, then `log2(n)` butterfly
 * stages run over the whole array. O(n log n), no recursion, no allocation per
 * stage â€” which matters because spectrograms run this thousands of times per
 * render.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length) throw new RangeError("fft(): real and imaginary lengths differ");
  if (n === 0) throw new RangeError("fft(): empty input");
  if ((n & (n - 1)) !== 0) throw new RangeError(`fft(): length ${n} is not a power of two`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      const ti = im[i] as number;
      re[i] = re[j] as number;
      im[i] = im[j] as number;
      re[j] = tr;
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k] as number;
        const uIm = im[i + k] as number;
        // Twiddle multiply: v = b Â· w with w = curRe + iÂ·curIm.
        const bRe = re[i + k + len / 2] as number;
        const bIm = im[i + k + len / 2] as number;
        const vRe = bRe * curRe - bIm * curIm;
        const vIm = bRe * curIm + bIm * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Inverse FFT, normalised so that `ifft(fft(x)) === x`. */
export function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -(im[i] as number);
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] = (re[i] as number) / n;
    im[i] = -(im[i] as number) / n;
  }
}

/** Naive O(nÂ²) DFT. The reference the FFT is tested against. */
export function dft(re: Float64Array, im: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      sr += (re[t] as number) * c - (im[t] as number) * s;
      si += (re[t] as number) * s + (im[t] as number) * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

/** Hann window of length `n`. */
export function hannWindow(n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = n === 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return out;
}

/** Amplitude spectrum of a real signal: one-sided, `n/2 + 1` bins. */
/**
 * Amplitude spectrum of a real signal: one-sided, `n/2 + 1` bins.
 */
export function amplitudeSpectrum(
  signal: TraceInput,
  sampleRateHz: number,
  window?: ArrayLike<number>,
): { magnitudes: number[]; frequenciesHz: number[] } {
  const n = nextPowerOfTwo(signal.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = window ?? hannWindow(signal.length);
  let wSum = 0;
  for (let i = 0; i < signal.length; i++) {
    re[i] = (signal[i] as number) * ((w[i] as number) ?? 0);
    wSum += (w[i] as number) ?? 0;
  }
  fft(re, im);
  const bins = n / 2 + 1;
  const magnitudes: number[] = [];
  const frequenciesHz: number[] = [];
  const scale = 2 / Math.max(wSum, 1e-12);
  for (let k = 0; k < bins; k++) {
    magnitudes.push(Math.hypot(re[k] as number, im[k] as number) * scale);
    frequenciesHz.push((k * sampleRateHz) / n);
  }
  return { magnitudes, frequenciesHz };
}

/** Power spectrum in linear units, one-sided. */
export function powerSpectrum(
  signal: TraceInput,
  sampleRateHz: number,
  window?: ArrayLike<number>,
): { powers: number[]; frequenciesHz: number[] } {
  const { magnitudes, frequenciesHz } = amplitudeSpectrum(signal, sampleRateHz, window);
  return { powers: magnitudes.map((m) => (m * m) / 2), frequenciesHz };
}

/**
 * A trace input: a plain number array or a typed array.
 *
 * The synthesis path produces `Float64Array`s and the analysis path accepts
 * arrays, so the public signatures take `ArrayLike<number>` rather than forcing
 * a conversion at every call site.
 */
export type TraceInput = ArrayLike<number>;

export interface SpectrogramFrame {
  /** Centre time of the frame, seconds from the start of the trace. */
  timeS: number;
  /** Power per bin, linear. */
  powers: number[];
}

export interface Spectrogram {
  frequenciesHz: number[];
  frameDurationS: number;
  frames: SpectrogramFrame[];
}

/**
 * Short-time Fourier transform of a real trace.
 *
 * Frame length and hop are both powers of two so the radix-2 transform applies
 * directly; a Hann window controls spectral leakage. This is the input to the
 * spectrogram view and to the harmonic-tremor detector.
 */
export function spectrogram(
  signal: TraceInput,
  sampleRateHz: number,
  options: { frameSize?: number; hopSize?: number; window?: ArrayLike<number> } = {},
): Spectrogram {
  const frameSize = options.frameSize ?? 1024;
  const hopSize = options.hopSize ?? Math.floor(frameSize / 2);
  if (hopSize < 1) throw new RangeError("hopSize must be at least 1 sample");
  const w = options.window ?? hannWindow(frameSize);
  const frames: SpectrogramFrame[] = [];
  const frequenciesHz: number[] = [];
  for (let k = 0; k <= frameSize / 2; k++) frequenciesHz.push((k * sampleRateHz) / frameSize);

  // Normalise once: the analysis path accepts a typed array, and slicing and
  // spreading a union of the two is what the callers want to be free of.
  const trace: readonly number[] = Array.from(signal);
  for (let start = 0; start + frameSize <= trace.length; start += hopSize) {
    const frame = trace.slice(start, start + frameSize);
    const { powers } = powerSpectrum(frame, sampleRateHz, w);
    frames.push({ timeS: (start + frameSize / 2) / sampleRateHz, powers });
  }
  if (frames.length === 0) {
    // A trace shorter than one frame still gets one frame, zero-padded.
    const padded = [...trace, ...new Array<number>(Math.max(0, frameSize - trace.length)).fill(0)];
    const { powers } = powerSpectrum(padded, sampleRateHz, w);
    frames.push({ timeS: trace.length / 2 / sampleRateHz, powers });
  }
  return { frequenciesHz, frameDurationS: frameSize / sampleRateHz, frames };
}

/**
 * Dominant frequency of a power spectrum with three-point parabolic refinement.
 *
 * Raw bin resolution is `sampleRate / frameSize` â€” 3.9 Hz for a 256-sample
 * frame at 1 kHz â€” which is too coarse to tell a 2.1 Hz tremor from a 2.5 Hz
 * one. Parabolic interpolation on the log-magnitude of the peak recovers
 * sub-bin accuracy.
 */
export function dominantFrequency(
  frequenciesHz: readonly number[],
  powers: readonly number[],
): number {
  if (powers.length === 0) return 0;
  let peak = 0;
  for (let k = 1; k < powers.length; k++) {
    if ((powers[k] as number) > (powers[peak] as number)) peak = k;
  }
  const lo = Math.max(0, peak - 1);
  const hi = Math.min(powers.length - 1, peak + 1);
  if (lo === peak || hi === peak) return frequenciesHz[peak] ?? 0;
  const y0 = powers[lo] as number;
  const y1 = powers[peak] as number;
  const y2 = powers[hi] as number;
  const denom = y0 - 2 * y1 + y2;
  if (denom === 0 || !Number.isFinite(denom)) return frequenciesHz[peak] ?? 0;
  const delta = (0.5 * (y0 - y2)) / denom;
  const binWidth = (frequenciesHz[1] ?? 0) - (frequenciesHz[0] ?? 0);
  const refined = (frequenciesHz[peak] ?? 0) + delta * binWidth;
  return Math.max(0, refined);
}

/** Spectral centroid â€” the "centre of mass" of the spectrum, in Hz. */
export function spectralCentroid(
  frequenciesHz: readonly number[],
  powers: readonly number[],
): number {
  let num = 0;
  let den = 0;
  for (let k = 0; k < powers.length; k++) {
    num += (frequenciesHz[k] as number) * (powers[k] as number);
    den += powers[k] as number;
  }
  return den === 0 ? 0 : num / den;
}

/** Geometric-mean spectral flatness: 0 for a tone, 1 for white noise. */
export function spectralFlatness(powers: readonly number[]): number {
  const values = powers.filter((p) => p > 0);
  if (values.length === 0) return 0;
  const logMean = values.reduce((a, b) => a + Math.log(b), 0) / values.length;
  const arithmeticMean = values.reduce((a, b) => a + b, 0) / values.length;
  if (arithmeticMean <= 0) return 0;
  return Math.exp(logMean) / arithmeticMean;
}

/** Fraction of total power inside `[loHz, hiHz)`. */
export function bandEnergyFraction(
  frequenciesHz: readonly number[],
  powers: readonly number[],
  loHz: number,
  hiHz: number,
): number {
  let inside = 0;
  let total = 0;
  for (let k = 0; k < powers.length; k++) {
    const f = frequenciesHz[k] as number;
    total += powers[k] as number;
    if (f >= loHz && f < hiHz) inside += powers[k] as number;
  }
  return total === 0 ? 0 : inside / total;
}

/**
 * Counts spectrally prominent peaks â€” narrow features standing above their local
 * background.
 *
 * Four designs were tried and rejected, and the numbers are worth recording
 * because each one fails in a way that looks fine in a unit test:
 *
 *  1. A fixed dB threshold below the global maximum. On 4097-bin station noise
 *     the maximum already sits 10^6 above the median, so the threshold catches
 *     hundreds of ripples.
 *  2. A rolling-median floor over Â±7 bins. Reported ~900 peaks on a quiet trace.
 *  3. Topographic prominence (peak height above the key col). Reported 319: on a
 *     spectrum with 70 dB of dynamic range, almost any ripple has a deep col
 *     beside it.
 *  4. Harmonic-series detection (find the fundamental, look for exact
 *     multiples). Reported 2 partials on a trace with no tremor in it at all,
 *     because the loosened per-partial threshold the series test needs also
 *     admits noise.
 *
 * What survives is the ratio of the peak to the mean of a wide window around it.
 * Measured on station background noise, that ratio has a median of about 1.3 and
 * a maximum of about 7 across roughly 900 local maxima. A threshold of 10x
 * therefore yields essentially zero false peaks while a tone sitting in a
 * spectral null clears it by orders of magnitude.
 *
 * Be aware of what this *cannot* do: on the station noise model, only the
 * fundamental of a tremor series rises above the noise. The higher partials sit
 * at about 7x background, which is indistinguishable from the 7x noise ceiling.
 * The reliable discriminators for tonal tremor are `tremorBandFraction` (0.72
 * for harmonic tremor against 0.04 for a quiet station) and `spectralFlatness`,
 * not this count. It is reported because it is honest, not because it decides.
 */
export function countSpectralPeaks(
  powers: readonly number[],
  minRatioDb = 20,
  averageBins = 64,
): number {
  if (powers.length < 3) return 0;
  const factor = 10 ** (minRatioDb / 20);
  const half = Math.max(1, Math.floor(averageBins / 2));
  let peaks = 0;
  for (let k = 1; k < powers.length - 1; k++) {
    const value = powers[k] as number;
    if (!(value > 0)) continue;
    // Local maximum, tolerating a plateau of equal bins (a tone that lands
    // exactly on a bin centre produces one).
    const left = powers[k - 1] as number;
    const right = powers[k + 1] as number;
    if (value < left || value < right || (value === left && value === right)) continue;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(powers.length - 1, k + half); j++) {
      if (j === k) continue;
      sum += powers[j] as number;
      count++;
    }
    if (count === 0) continue;
    const background = sum / count;
    if (background > 0 && value > factor * background) peaks++;
  }
  return peaks;
}
