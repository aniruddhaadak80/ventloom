import {
  amplitudeSpectrum,
  SAMPLE_RATE_HZ,
  spectrogram,
  stationTrace,
  tremorFeatures,
} from "@repo/core";
import { findVolcano, stationsFor, VOLCANO_CATALOGUE } from "@repo/seed";
import {
  BarSeries,
  Panel,
  ProgressMeter,
  Sparkline,
  Spectrogram,
  Stat,
  StatGrid,
  Waveform,
} from "@repo/ui";
import type { Metadata } from "next";
import { ObservatoryNav } from "../../components/observatory-nav";
import { readEpoch } from "../../lib/epoch";
import { hertz } from "../../lib/format";

export const metadata: Metadata = {
  title: "Seismic â€” tremor spectra",
  description:
    "A real radix-2 FFT spectrogram of synthetic ground motion, with RSAM, spectral centroid and band-energy ratios.",
};

export default function SeismicPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const { epochS, timestampIso } = readEpoch(searchParams);
  const requested = searchParams.volcano ?? "kilauea";
  const volcano = findVolcano(requested) ?? findVolcano("kilauea");
  if (!volcano) throw new Error("volcano catalogue is empty");

  const stations = stationsFor(volcano.id);
  const seismic = stations.find((s) => s.instrument === "broadband-seismic") ?? stations[0];
  if (!seismic) throw new Error(`no stations for ${volcano.id}`);

  const { samples, label } = stationTrace(volcano, seismic, epochS);
  const features = tremorFeatures(samples, SAMPLE_RATE_HZ);
  const { magnitudes, frequenciesHz } = amplitudeSpectrum([...samples], SAMPLE_RATE_HZ);
  const sg = spectrogram([...samples], SAMPLE_RATE_HZ, { frameSize: 1024, hopSize: 512 });

  // An RSAM history: one window per 6 seconds across the trace.
  const windowSamples = Math.floor(SAMPLE_RATE_HZ * 6);
  const rsamHistory: number[] = [];
  for (let i = 0; i + windowSamples <= samples.length; i += windowSamples) {
    let sum = 0;
    for (let j = i; j < i + windowSamples; j++) sum += (samples[j] as number) ** 2;
    rsamHistory.push(Math.sqrt(sum / windowSamples));
  }

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--color-lava)]">
              seismic
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
              Tremor spectra
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ash-muted)]">
              Sixty seconds of synthetic ground velocity at {seismic.code}, transformed by a radix-2
              Cooley-Tukey FFT running on the server. The mechanism at this epoch is{" "}
              <strong className="text-[var(--color-ash)]">{label}</strong>, declared by{" "}
              <span className="font-[family-name:var(--font-mono)] text-xs">tremorLabelAt</span> and
              synthesised accordingly.
            </p>
          </div>
          <ObservatoryNav epoch={epochS} />
        </div>
        <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-ash-dim)]">
          {volcano.name} Â· {seismic.code} Â· {seismic.instrument} Â· {timestampIso} Â·{" "}
          {SAMPLE_RATE_HZ} Hz sampling
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel
          title="Ground velocity"
          subtitle="Down-sampled by min/max decimation per pixel, so every drawn bar is the true envelope."
        >
          <div className="h-28 w-full">
            <Waveform samples={[...samples]} label={`Ground velocity trace at ${seismic.code}`} />
          </div>
        </Panel>
        <Panel title="Signature" subtitle="What a duty seismologist reads off the screen.">
          <StatGrid columns={2}>
            <Stat label="RSAM" value={features.rsam.toFixed(1)} unit="DU" tone="lava" />
            <Stat label="Crest factor" value={features.crestFactor.toFixed(2)} />
            <Stat label="Dominant" value={hertz(features.dominantHz)} />
            <Stat label="Centroid" value={hertz(features.spectralCentroidHz)} />
          </StatGrid>
          <dl className="mt-4 space-y-3 border-t border-[var(--color-slag)] pt-3">
            <div>
              <dt className="flex items-baseline justify-between text-xs text-[var(--color-ash-dim)]">
                1-5 Hz tremor band{" "}
                <span className="font-[family-name:var(--font-mono)]">
                  {(features.tremorBandFraction * 100).toFixed(1)} %
                </span>
              </dt>
              <dd className="mt-1">
                <ProgressMeter
                  value={features.tremorBandFraction}
                  label="Fraction of power in the 1-5 Hz band"
                />
              </dd>
            </div>
            <div>
              <dt className="flex items-baseline justify-between text-xs text-[var(--color-ash-dim)]">
                5-15 Hz broadband{" "}
                <span className="font-[family-name:var(--font-mono)]">
                  {(features.broadbandBandFraction * 100).toFixed(1)} %
                </span>
              </dt>
              <dd className="mt-1">
                <ProgressMeter
                  value={features.broadbandBandFraction}
                  label="Fraction of power in the 5-15 Hz band"
                  tone="seismic"
                />
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Spectrogram"
          subtitle="1024-sample frames, 50 % overlap, Hann window. Teal lines mark 0, 5, 10 and 15 Hz."
        >
          <div className="h-48 w-full">
            <Spectrogram
              frames={sg.frames}
              frequenciesHz={sg.frequenciesHz}
              label={`Spectrogram at ${seismic.code}`}
            />
          </div>
        </Panel>
        <Panel
          title="Amplitude spectrum"
          subtitle="One-sided, Hann-corrected. Log-scale would hide the band ratios."
        >
          <div className="h-48 w-full">
            <BarSeries
              values={decimate(magnitudes, 220)}
              labels={decimate(frequenciesHz, 220).map((f) => `${f.toFixed(1)} Hz`)}
              label={`Amplitude spectrum at ${seismic.code}`}
            />
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="RSAM over the window"
          subtitle="Real-time seismic amplitude, 6-second windows."
        >
          <div className="h-24 w-full">
            <Sparkline values={rsamHistory} height={96} label="RSAM history" />
          </div>
          <p className="mt-2 text-xs text-[var(--color-ash-dim)]">
            Mean {features.rsam.toFixed(1)} DU, peak {features.peakAmplitude.toFixed(1)} DU. The
            crest factor {features.crestFactor.toFixed(2)} is the diagnosis: near 1.4 means Gaussian
            noise, above 3 means something impulsive.
          </p>
        </Panel>
        <Panel
          title="Spectral flatness"
          subtitle="Geometric mean over arithmetic mean: 0 for a tone, 1 for white noise."
        >
          <div className="flex items-baseline gap-3">
            <span className="font-[family-name:var(--font-mono)] text-3xl tabular-nums text-[var(--color-lava)]">
              {features.spectralFlatness.toFixed(4)}
            </span>
            <span className="text-xs text-[var(--color-ash-dim)]">
              {features.spectralFlatness < 0.05
                ? "highly tonal"
                : features.spectralFlatness < 0.2
                  ? "mixed"
                  : "broadband"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-ash-muted)]">
            Background noise here is 1/fÂ² below a 1.5 Hz corner and flat above it, which is what a
            quiet short-period station actually looks like. Its own crest factor is already about 9,
            so crest factor alone does not distinguish tremor from noise: the band ratios do.
          </p>
        </Panel>
      </div>

      <footer className="mt-6">
        <CalloutRow epoch={epochS} current={volcano.id} />
      </footer>
    </main>
  );
}

function CalloutRow({ epoch, current }: { epoch: number; current: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-ash-dim)]">
      <span>Change station:</span>
      {VOLCANO_CATALOGUE.map((v) => (
        <a
          key={v.id}
          href={`/seismic?epoch=${epoch}&volcano=${v.id}`}
          className={v.id === current ? "text-[var(--color-lava)]" : "underline"}
        >
          {v.name}
        </a>
      ))}
    </div>
  );
}

/** Keep every Nth element so a bar series stays readable. */
function decimate<T>(values: readonly T[], maxPoints: number): T[] {
  if (values.length <= maxPoints) return [...values];
  const stride = Math.ceil(values.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < values.length; i += stride) out.push(values[i] as T);
  return out;
}
