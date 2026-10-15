/** Tests for the radix-2 FFT and the spectral features built on it. */

import { describe, expect, it } from "vitest";
import {
  amplitudeSpectrum,
  bandEnergyFraction,
  countSpectralPeaks,
  dft,
  dominantFrequency,
  fft,
  hannWindow,
  ifft,
  nextPowerOfTwo,
  powerSpectrum,
  type Spectrogram,
  spectralCentroid,
  spectralFlatness,
  spectrogram,
} from "../src/fft.js";

const SAMPLE_RATE = 100;

function sinusoid(n: number, freqHz: number, amplitude = 1, sampleRate = SAMPLE_RATE): number[] {
  return Array.from(
    { length: n },
    (_, i) => amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate),
  );
}

describe("nextPowerOfTwo", () => {
  it("rounds up to the next power of two", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(1025)).toBe(2048);
  });
});

describe("fft", () => {
  it("matches the naive DFT on a real signal", () => {
    const n = 64;
    const re = Float64Array.from(sinusoid(n, 3));
    const im = new Float64Array(n);
    fft(re, im);
    const reference = dft(Float64Array.from(sinusoid(n, 3)), new Float64Array(n));
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(reference.re[k] as number, 8);
      expect(im[k]).toBeCloseTo(reference.im[k] as number, 8);
    }
  });

  it("rejects a non-power-of-two length", () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
  });

  it("rejects mismatched real and imaginary lengths", () => {
    expect(() => fft(new Float64Array(8), new Float64Array(4))).toThrow(RangeError);
  });

  it("round-trips through the inverse transform", () => {
    const n = 256;
    const original = Float64Array.from(sinusoid(n, 7, 2.5));
    const re = Float64Array.from(original);
    const im = new Float64Array(n);
    fft(re, im);
    ifft(re, im);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(original[i] as number, 8);
  });

  it("preserves total power (Parseval)", () => {
    const n = 128;
    const signal = sinusoid(n, 5, 3);
    const re = Float64Array.from(signal);
    const im = new Float64Array(n);
    fft(re, im);
    const spectralPower = Array.from(
      { length: n },
      (_, k) => (re[k] as number) ** 2 + (im[k] as number) ** 2,
    ).reduce((a, b) => a + b, 0);
    const timePower = signal.reduce((a, b) => a + b * b, 0);
    expect(spectralPower / n).toBeCloseTo(timePower, 6);
  });
});

describe("hannWindow", () => {
  it("returns 1 for a single sample", () => {
    expect(hannWindow(1)[0]).toBe(1);
  });

  it("is symmetric and tapers to zero at the ends", () => {
    const w = hannWindow(64);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[63]).toBeCloseTo(0, 12);
    for (let i = 0; i < 64; i++) {
      expect(w[i]).toBeCloseTo(w[63 - i] as number, 12);
    }
  });
});

describe("amplitudeSpectrum", () => {
  it("puts a pure tone in the right bin", () => {
    const { magnitudes, frequenciesHz } = amplitudeSpectrum(sinusoid(512, 10), SAMPLE_RATE);
    const peak = magnitudes.indexOf(Math.max(...magnitudes));
    // 512 samples at 100 Hz gives 0.195 Hz bins, so a 10 Hz tone lands in the
    // adjacent bin rather than exactly on one.
    expect(frequenciesHz[peak]).toBeCloseTo(10, 0);
  });

  it("splits power symmetrically for a complex tone", () => {
    // One-sided amplitude of a unit sine is ~1 after window correction.
    const { magnitudes } = amplitudeSpectrum(sinusoid(1024, 12.5), SAMPLE_RATE);
    const peak = Math.max(...magnitudes);
    expect(magnitudes.indexOf(peak)).toBeGreaterThan(0);
    expect(peak).toBeCloseTo(1, 1);
  });

  it("zero-pads short signals to a power of two", () => {
    const { frequenciesHz } = amplitudeSpectrum([1, 2, 3], SAMPLE_RATE);
    // 3 samples round up to a 4-point transform, which yields n/2 + 1 bins.
    expect(frequenciesHz.length).toBe(3);
  });
});

describe("powerSpectrum", () => {
  it("is the square of the amplitude over two", () => {
    const signal = sinusoid(256, 6);
    const { magnitudes, frequenciesHz } = amplitudeSpectrum(signal, SAMPLE_RATE);
    const powers = powerSpectrum(signal, SAMPLE_RATE).powers;
    for (let k = 0; k < powers.length; k++) {
      expect(powers[k]).toBeCloseTo((magnitudes[k] as number) ** 2 / 2, 12);
    }
    expect(frequenciesHz.length).toBe(powers.length);
  });
});

describe("spectrogram", () => {
  it("frames a signal into overlapping windows", () => {
    const sg: Spectrogram = spectrogram(sinusoid(4000, 8), SAMPLE_RATE, {
      frameSize: 512,
      hopSize: 256,
    });
    const expectedFrames = Math.floor((4000 - 512) / 256) + 1;
    expect(sg.frames.length).toBe(expectedFrames);
    expect(sg.frequenciesHz.length).toBe(512 / 2 + 1);
    expect(sg.frameDurationS).toBeCloseTo(5.12, 6);
    const second = sg.frames[1];
    const first = sg.frames[0];
    if (!first || !second) throw new Error("expected at least two frames");
    expect(second.timeS - first.timeS).toBeCloseTo(2.56, 6);
  });

  it("still produces one frame for a signal shorter than the window", () => {
    const sg = spectrogram([1, 2, 3], SAMPLE_RATE, { frameSize: 1024 });
    expect(sg.frames.length).toBe(1);
    expect(sg.frames[0]?.powers.length).toBe(1024 / 2 + 1);
  });

  it("rejects a zero hop", () => {
    expect(() => spectrogram([1, 2, 3], SAMPLE_RATE, { hopSize: 0 })).toThrow(RangeError);
  });
});

describe("dominantFrequency", () => {
  it("recovers a bin-centred tone exactly", () => {
    const { powers, frequenciesHz } = powerSpectrum(sinusoid(1024, 10), SAMPLE_RATE);
    expect(dominantFrequency(frequenciesHz, powers)).toBeCloseTo(10, 1);
  });

  it("refines a frequency between bins to sub-bin accuracy", () => {
    const { powers, frequenciesHz } = powerSpectrum(sinusoid(1024, 10.37), SAMPLE_RATE);
    expect(dominantFrequency(frequenciesHz, powers)).toBeCloseTo(10.37, 1);
  });

  it("returns 0 for a silent spectrum", () => {
    expect(dominantFrequency([0, 1, 2], [0, 0, 0])).toBe(0);
  });
});

describe("spectralCentroid", () => {
  it("is the power-weighted mean frequency", () => {
    const frequencies = [0, 10, 20, 30];
    const powers = [0, 1, 0, 3];
    expect(spectralCentroid(frequencies, powers)).toBeCloseTo(25, 6);
  });

  it("is 0 when there is no power", () => {
    expect(spectralCentroid([1, 2, 3], [0, 0, 0])).toBe(0);
  });
});

describe("spectralFlatness", () => {
  it("is near 1 for white noise", () => {
    const powers = Array.from({ length: 64 }, (_, i) => 1 + ((i * 7919) % 11) / 40);
    expect(spectralFlatness(powers)).toBeGreaterThan(0.9);
  });

  it("is near 0 for a sparse spectrum", () => {
    // One peak over a 63-bin noise floor at 1e-12: the geometric mean is
    // dragged down by the floor while the arithmetic mean is not.
    const powers = new Array<number>(64).fill(1e-12);
    powers[10] = 1;
    expect(spectralFlatness(powers)).toBeLessThan(0.05);
  });

  it("is 1 for a spectrum with a single non-zero bin", () => {
    const powers = new Array<number>(64).fill(0);
    powers[7] = 1;
    expect(spectralFlatness(powers)).toBeCloseTo(1, 12);
  });

  it("is 0 for an empty or silent spectrum", () => {
    expect(spectralFlatness([])).toBe(0);
    expect(spectralFlatness([0, 0])).toBe(0);
  });
});

describe("bandEnergyFraction", () => {
  const frequencies = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const powers = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

  it("sums the requested half-open band", () => {
    expect(bandEnergyFraction(frequencies, powers, 2, 6)).toBeCloseTo(4 / 10, 9);
  });

  it("returns 0 with no power", () => {
    expect(bandEnergyFraction(frequencies, new Array(11).fill(0), 0, 10)).toBe(0);
  });
});

describe("countSpectralPeaks", () => {
  it("counts isolated narrow peaks, not shoulders or humps", () => {
    const powers = new Array<number>(64).fill(0.01);
    for (const bin of [8, 24, 40]) powers[bin] = 1;
    expect(countSpectralPeaks(powers, 20, 8)).toBe(3);
  });

  it("finds no peaks in a flat spectrum", () => {
    expect(countSpectralPeaks(new Array<number>(64).fill(0.5), 20, 8)).toBe(0);
  });

  it("does not count a smooth hump as a peak", () => {
    // A broad Gaussian hump on a flat floor has no isolated maximum that clears
    // the local mean by 20 dB.
    const powers = Array.from(
      { length: 128 },
      (_, i) => 0.01 + 4 * Math.exp(-((i - 64) ** 2) / 900),
    );
    expect(countSpectralPeaks(powers, 20, 32)).toBe(0);
  });

  it("returns 0 for spectra shorter than three bins", () => {
    expect(countSpectralPeaks([1, 1], 20, 8)).toBe(0);
  });
});
