import {
  ALERT_RULES,
  DEFAULT_POISSON,
  mogiCoupling,
  NOISE_CORNER_HZ,
  NOISE_SPECTRAL_EXPONENT,
  OXIDE_ORDER,
  SAMPLE_RATE_HZ,
  SECONDS_PER_DAY,
  VOLCANO_ALERT_LEVELS,
  volumeChangeFromPressure,
  WORLD_SEED,
} from "@repo/core";
import { END_MEMBER_LIST } from "@repo/seed";
import { Callout, Panel } from "@repo/ui";
import type { Metadata } from "next";
import { ObservatoryNav } from "../../components/observatory-nav";
import { readEpoch } from "../../lib/epoch";

export const metadata: Metadata = {
  title: "Models â€” the reference",
  description:
    "Every formulation ventloom implements, with its parameters, its domain of validity and where it lives in the code.",
};

export default function ModelsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const { epochS } = readEpoch(searchParams);
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--color-lava)]">
              models
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
              The reference
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ash-muted)]">
              Every formulation the app uses, its parameters, where it is valid and where it is not.
              The same table is generated from the source, so it cannot drift from the code.
            </p>
          </div>
          <ObservatoryNav epoch={epochS} />
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel
          title="Mogi (1958) point source"
          subtitle="Geodetic inversion. packages/core/src/mogi.ts"
        >
          <ModelBody
            equations={[
              "u = CÂ·(s âˆ’ e) / RÂ³",
              "w = CÂ·d / RÂ³",
              "RÂ² = (sâˆ’e)Â² + (nâˆ’f)Â² + dÂ²",
              "C = Î”V(1 âˆ’ Î½) / Ï€",
              "Î”V = Ï€ aÂ³ Î”P / G",
            ]}
            notes={[
              "Valid only when the source radius is much smaller than its depth; a â‰¤ d/3 is the usual rule.",
              "Assumes a homogeneous, isotropic, elastic half-space with a flat surface.",
              "Depth and volume are correlated; the parameter covariance reports the trade-off.",
              `Poisson ratio ${DEFAULT_POISSON} for basaltic to andesitic rock.`,
            ]}
          />
        </Panel>

        <Panel
          title="Radix-2 Cooley-Tukey FFT"
          subtitle="Spectral analysis. packages/core/src/fft.ts"
        >
          <ModelBody
            equations={[
              "X[k] = Î£ x[n] e^{âˆ’2Ï€ikn/N}",
              "bit-reversal permutation, then logâ‚‚N butterfly stages",
            ]}
            notes={[
              `Sampling rate ${SAMPLE_RATE_HZ} Hz, Nyquist ${SAMPLE_RATE_HZ / 2} Hz.`,
              "A Hann window controls spectral leakage; the amplitude spectrum is one-sided and window-corrected.",
              "Tone frequencies are refined between bins by three-point parabolic interpolation.",
            ]}
          />
        </Panel>

        <Panel
          title="Station background noise"
          subtitle="Tremor synthesis. packages/core/src/tremor.ts"
        >
          <ModelBody
            equations={["S(f) âˆ 1 + (f_corner / f)^Î²"]}
            notes={[
              `Î² = ${NOISE_SPECTRAL_EXPONENT} below the corner, flat above it.`,
              `Corner ${NOISE_CORNER_HZ} Hz.`,
              "A pure 1/fÂ² model puts nearly all its energy below 5 Hz, which is exactly where harmonic tremor lives, so every partial except the fundamental drowns.",
            ]}
          />
        </Panel>

        <Panel
          title="Aitchison distance"
          subtitle="Tephra correlation. packages/core/src/tephra.ts"
        >
          <ModelBody
            equations={["clr(x) = ln(x) âˆ’ mean(ln x)", "d(x, y) = â€–clr(x) âˆ’ clr(y)â€–"]}
            notes={[
              "The compositional simplex is the right geometry: oxides sum to 100 %.",
              "Zeros are handled by multiplicative replacement, not by dropping the row.",
              `Tracked oxides: ${OXIDE_ORDER.join(", ")}.`,
            ]}
          />
        </Panel>

        <Panel title="Pyle (1989) thinning" subtitle="Tephra volume. packages/core/src/tephra.ts">
          <ModelBody
            equations={[
              "T(x) = Tâ‚€Â·exp(âˆ’kÂ·x)",
              "x = âˆš(A/Ï€)",
              "V = 2Ï€Tâ‚€ / kÂ²",
              "half-thickness = ln2 / k",
            ]}
            notes={[
              "Fitted by ordinary least squares on ln T against x.",
              "The closed form is the exact integral of the exponential law, so the numeric annular integration is an independent check on it.",
            ]}
          />
        </Panel>

        <Panel title="Alert engine" subtitle="Forecast. packages/core/src/forecast.ts">
          <ModelBody
            equations={[`levels: ${VOLCANO_ALERT_LEVELS.join(" â†’ ")}`]}
            notes={[
              `${ALERT_RULES.length} rules, evaluated as an ordered table.`,
              "A level is only ever raised: the verdict starts at NORMAL and climbs.",
              "Rules that do not fire are reported alongside those that do, so the argument is one-sided only in its conclusion.",
              "Confidence counts the indicator families corroborating the level, not more firing rules.",
            ]}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Callout tone="seismic" title="Worked example: 1914 TaishÅ Sakurajima">
          With a = 2500 m, d = 10000 m, Î”P = âˆ’400 MPa, G = 30 GPa and Î½ = {DEFAULT_POISSON}, the
          volume-change form gives Î”V ={" "}
          {volumeChangeFromPressure(2500, -400, 30000).toExponential(4)} mÂ³ and a coupling constant
          C ={" "}
          {mogiCoupling({
            eastOffsetM: 0,
            northOffsetM: 0,
            depthM: 10000,
            volumeChangeM3: volumeChangeFromPressure(2500, -400, 30000),
          }).toExponential(4)}
          . The predicted epicentral subsidence is âˆ’1.5625 m against Omori&apos;s levelling lines,
          and the deflation volume integrates to 0.98 kmÂ³.
        </Callout>
        <Callout tone="lava" title="What is synthetic and what is not">
          Real: the coordinates, elevations and volcano types of{" "}
          {END_MEMBER_LIST.length > 0 ? "the twelve-catalogue volcanoes" : "the catalogue"}; every
          equation on this page. Synthetic: the unrest profiles, the station network, the tremor
          traces, the tephra chemistry, the gas ratios. World seed{" "}
          <span className="font-[family-name:var(--font-mono)]">{WORLD_SEED}</span>, sampling{" "}
          <span className="font-[family-name:var(--font-mono)]">{SAMPLE_RATE_HZ} Hz</span>, day
          length <span className="font-[family-name:var(--font-mono)]">{SECONDS_PER_DAY} s</span>.
        </Callout>
      </div>
    </main>
  );
}

function ModelBody({
  equations,
  notes,
}: {
  equations: readonly string[];
  notes: readonly string[];
}) {
  return (
    <div className="space-y-3">
      <ul className="space-y-1 rounded-[var(--radius-md)] border border-[var(--color-slag)] bg-[var(--color-abyss)] p-3">
        {equations.map((equation) => (
          <li
            key={equation}
            className="font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--color-seismic)]"
          >
            {equation}
          </li>
        ))}
      </ul>
      <ul className="space-y-1.5">
        {notes.map((note) => (
          <li
            key={note}
            className="flex gap-2 text-xs leading-relaxed text-[var(--color-ash-muted)]"
          >
            <span aria-hidden="true" className="text-[var(--color-lava)]">
              Â·
            </span>
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}
