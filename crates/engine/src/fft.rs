//! Radix-2 Cooley–Tukey FFT, one-sided spectra, and tone refinement.
//!
//! This exists so the Rust side can verify the TypeScript spectra rather than
//! merely re-derive them: `packages/core/src/fft.ts` and this module are run
//! over the same seeded traces in CI and their bin values compared. An FFT bug
//! that survived in one language would show up as a disagreement between the
//! two, which is far easier to notice than a subtly wrong spectrogram.
//!
//! The transform is iterative, in-place on a bit-reversed copy, and requires a
//! power-of-two length — the same restriction the TypeScript implementation
//! imposes, so the two cannot silently diverge on edge cases.

/// Why a transform could not run.
#[derive(Debug, Clone, PartialEq)]
pub enum FftError {
    /// The input length was not a power of two.
    NotPowerOfTwo(usize),
    /// The input was empty.
    Empty,
}

impl std::fmt::Display for FftError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FftError::NotPowerOfTwo(n) => write!(f, "length {n} is not a power of two"),
            FftError::Empty => write!(f, "empty input"),
        }
    }
}

impl std::error::Error for FftError {}

/// Is `n` a power of two and non-zero?
pub fn is_power_of_two(n: usize) -> bool {
    n != 0 && n & (n - 1) == 0
}

/// The Hann window, periodic form, as used by the spectrogram.
pub fn hann_window(len: usize) -> Vec<f64> {
    if len <= 1 {
        return vec![1.0; len];
    }
    (0..len)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / len as f64).cos())
        .collect()
}

/// In-place iterative radix-2 FFT on interleaved `[re, im, re, im, ...]`.
///
/// # Errors
///
/// [`FftError::Empty`] for a zero-length input and [`FftError::NotPowerOfTwo`]
/// otherwise when the length is not a power of two.
pub fn fft_in_place(data: &mut [f64], inverse: bool) -> Result<(), FftError> {
    let n = data.len() / 2;
    if n == 0 {
        return Err(FftError::Empty);
    }
    if !is_power_of_two(n) {
        return Err(FftError::NotPowerOfTwo(n));
    }

    // Bit-reversal permutation. Done first so the butterfly loops below can
    // walk contiguous pairs, which is what makes the inner loop vectorisable.
    for i in 0..n {
        let mut j = 0usize;
        let mut bits = i;
        let mut rev = 0usize;
        while (1 << rev) < n {
            rev += 1;
        }
        for _ in 0..rev {
            j = (j << 1) | (bits & 1);
            bits >>= 1;
        }
        if j > i {
            data.swap(i * 2, j * 2);
            data.swap(i * 2 + 1, j * 2 + 1);
        }
    }

    let sign = if inverse { 1.0 } else { -1.0 };
    let mut len = 2;
    while len <= n {
        let angle = sign * std::f64::consts::TAU / len as f64;
        let (wr, wi) = (angle.cos(), angle.sin());
        for start in (0..n).step_by(len) {
            // Twiddle carried by recurrence rather than recomputed per
            // butterfly: one cosine pair per stage instead of n/2.
            let (mut cur_r, mut cur_i) = (1.0f64, 0.0f64);
            for k in 0..len / 2 {
                let even = (start + k) * 2;
                let odd = (start + k + len / 2) * 2;
                let (or, oi) = (data[odd], data[odd + 1]);
                let tr = or * cur_r - oi * cur_i;
                let ti = or * cur_i + oi * cur_r;
                let (er, ei) = (data[even], data[even + 1]);
                data[even] = er + tr;
                data[even + 1] = ei + ti;
                data[odd] = er - tr;
                data[odd + 1] = ei - ti;
                let (nr, ni) = (cur_r * wr - cur_i * wi, cur_r * wi + cur_i * wr);
                cur_r = nr;
                cur_i = ni;
            }
        }
        len *= 2;
    }

    if inverse {
        for v in data.iter_mut().take(n * 2) {
            *v /= n as f64;
        }
    }
    Ok(())
}

/// One-sided amplitude spectrum of a real signal: `n/2 + 1` magnitudes.
///
/// A Hann window is applied by default because an unwindowed rectangular
/// transform leaks a tone across every bin, which destroys exactly the
/// band-energy ratios the tremor classifier reads.
pub fn amplitude_spectrum(signal: &[f64]) -> Result<Vec<f64>, FftError> {
    let n = signal.len();
    if n == 0 {
        return Err(FftError::Empty);
    }
    if !is_power_of_two(n) {
        return Err(FftError::NotPowerOfTwo(n));
    }
    let window = hann_window(n);
    // Coherent gain of a Hann window is 0.5, so the one-sided amplitude must
    // be doubled and then divided by that gain to recover the true tone
    // amplitude of 1.0 for a unit sinusoid.
    let gain: f64 = window.iter().sum::<f64>() / n as f64;

    let mut data = vec![0.0f64; n * 2];
    for (i, s) in signal.iter().enumerate() {
        data[i * 2] = s * window[i];
    }
    fft_in_place(&mut data, false)?;

    let half = n / 2;
    let mut mags = Vec::with_capacity(half + 1);
    for k in 0..=half {
        let re = data[k * 2];
        let im = data[k * 2 + 1];
        let mag = (re * re + im * im).sqrt() * 2.0 / (n as f64 * gain.max(1e-12));
        mags.push(if k == 0 || k == half { mag / 2.0 } else { mag });
    }
    Ok(mags)
}

/// One-sided power spectrum: `amplitude² / 2`.
pub fn power_spectrum(signal: &[f64]) -> Result<Vec<f64>, FftError> {
    Ok(amplitude_spectrum(signal)?
        .iter()
        .map(|m| m * m / 2.0)
        .collect())
}

/// Frequency bin centres for a given length and sample rate.
pub fn frequencies(n: usize, sample_rate_hz: f64) -> Vec<f64> {
    (0..=n / 2)
        .map(|k| k as f64 * sample_rate_hz / n as f64)
        .collect()
}

/// Dominant tone frequency with three-point parabolic refinement.
///
/// Bin resolution alone would quantise a 1.5 Hz harmonic to the nearest
/// `sampleRate / n`, and at 60 s / 8192 samples that is 1.17 Hz of avoidable
/// error — enough to move a signal across a band boundary.
pub fn dominant_frequency(freqs: &[f64], powers: &[f64]) -> f64 {
    if powers.is_empty() {
        return 0.0;
    }
    let mut peak = 0usize;
    for (i, p) in powers.iter().enumerate() {
        if *p > powers[peak] {
            peak = i;
        }
    }
    if peak == 0 || peak + 1 >= powers.len() {
        return freqs.get(peak).copied().unwrap_or(0.0);
    }
    let (a, b, c) = (powers[peak - 1], powers[peak], powers[peak + 1]);
    let denom = a - 2.0 * b + c;
    if denom.abs() < 1e-30 {
        return freqs[peak];
    }
    let delta = 0.5 * (a - c) / denom;
    let df = freqs.get(peak + 1).copied().unwrap_or(freqs[peak]) - freqs[peak];
    freqs[peak] + delta * df
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(n: usize, freq: f64, rate: f64) -> Vec<f64> {
        (0..n)
            .map(|i| (std::f64::consts::TAU * freq * i as f64 / rate).sin())
            .collect()
    }

    #[test]
    fn rejects_non_power_of_two_lengths() {
        assert_eq!(
            fft_in_place(&mut [0.0; 6], false),
            Err(FftError::NotPowerOfTwo(3))
        );
        assert!(amplitude_spectrum(&[0.0; 7]).is_err());
    }

    #[test]
    fn rejects_empty_input() {
        assert_eq!(fft_in_place(&mut [], false), Err(FftError::Empty));
        assert_eq!(amplitude_spectrum(&[]), Err(FftError::Empty));
    }

    #[test]
    fn round_trips_through_the_inverse() {
        let n = 256;
        let mut data: Vec<f64> = (0..n * 2)
            .map(|i| ((i as f64) * 0.07).sin() * 3.0 + (i as f64 * 0.31).cos())
            .collect();
        let original = data.clone();
        fft_in_place(&mut data, false).expect("forward");
        fft_in_place(&mut data, true).expect("inverse");
        for (got, want) in data.iter().zip(&original) {
            assert!((got - want).abs() < 1e-9, "got {got}, want {want}");
        }
    }

    #[test]
    fn finds_a_pure_tone_to_sub_bin_accuracy() {
        let n = 4096;
        let rate = 64.0;
        // 13.5 Hz sits between bins at this resolution, so the parabolic
        // refinement has real work to do.
        let freq = 13.5;
        let signal = sine(n, freq, rate);
        let mags = amplitude_spectrum(&signal).expect("spectrum");
        let freqs = frequencies(n, rate);
        let powers: Vec<f64> = mags.iter().map(|m| m * m / 2.0).collect();
        let found = dominant_frequency(&freqs, &powers);
        assert!((found - freq).abs() < 0.05, "found {found}, wanted {freq}");
    }

    #[test]
    fn recovers_unit_amplitude_after_window_correction() {
        let n = 2048;
        let mags = amplitude_spectrum(&sine(n, 25.0, 256.0)).expect("spectrum");
        let peak = mags.iter().cloned().fold(0.0f64, f64::max);
        assert!((peak - 1.0).abs() < 0.02, "peak amplitude {peak}");
    }

    #[test]
    fn hann_window_has_zero_endpoints_and_half_mean() {
        let w = hann_window(1024);
        assert_eq!(w[0], 0.0);
        assert!((w[512] - 1.0).abs() < 1e-12);
        let mean = w.iter().sum::<f64>() / w.len() as f64;
        assert!((mean - 0.5).abs() < 1e-3);
    }

    #[test]
    fn split_bin_tone_lands_in_its_own_bin() {
        // An exactly bin-centred tone must not leak: its neighbours should be
        // at least 60 dB down after the Hann window.
        let n = 1024;
        let rate = 1024.0;
        let bin = 64;
        let signal: Vec<f64> = (0..n)
            .map(|i| (std::f64::consts::TAU * bin as f64 * i as f64 / n as f64).sin())
            .collect();
        let mags = amplitude_spectrum(&signal).expect("spectrum");
        let peak = mags[bin];
        for (i, m) in mags.iter().enumerate() {
            if i == bin {
                continue;
            }
            assert!(*m < peak * 1e-3, "bin {i} leaked: {m} vs peak {peak}");
        }
        let _ = rate;
    }
}
