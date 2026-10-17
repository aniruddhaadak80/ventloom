import { assessUnrest, networkSnapshot, unrestIndicators } from "@repo/core";
import { STATION_NETWORK, VOLCANO_CATALOGUE } from "@repo/seed";
import { AlertBadge, Callout, Panel } from "@repo/ui";
import type { Metadata } from "next";
import { ObservatoryNav } from "../components/observatory-nav";
import { describeEpoch, readEpoch } from "../lib/epoch";
import { rate, volume } from "../lib/format";

export const metadata: Metadata = {
  title: "ventloom - weave volcanic signals into an eruption forecast",
  description:
    "A deterministic volcano observatory over a seeded synthetic network, with a real Mogi geodetic inversion and an auditable alert-level engine.",
};

export default function ObservatoryPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const { epochS, timestampIso } = readEpoch(searchParams);
  const snapshot = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, epochS);
  const ranked = [...snapshot.volcanoes].sort((a, b) => b.unrest - a.unrest);

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--color-lava)]">
              ventloom observatory
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--color-ash)] sm:text-3xl">
              Weave volcanic signals into an eruption forecast
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ash-muted)]">
              {VOLCANO_CATALOGUE.length} volcanoes, {STATION_NETWORK.length} stations, one seeded
              world. Every number on this page is a pure function of the epoch in the URL, so the
              same link always shows the same observatory.
            </p>
          </div>
          <ObservatoryNav epoch={epochS} />
        </div>
        <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-ash-dim)]">
          {timestampIso} · {describeEpoch(epochS)} · seed 7331 · no API keys
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Network unrest"
          subtitle="Seeded unrest index in [0, 1]. This one scalar drives the deformation field, the tremor mechanism, the gas flux and the thermal pixels, so the observatory moves coherently rather than at random."
          aside={
            <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-ash-dim)]">
              {ranked.length} volcanoes
            </span>
          }
          className="lg:col-span-2"
        >
          <ol className="divide-y divide-[var(--color-slag)]/70">
            {ranked.map((state) => {
              const indicators = unrestIndicators(state.volcano, epochS);
              const assessment = assessUnrest(indicators);
              return (
                <li
                  key={state.volcano.id}
                  className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <a
                      href={`/volcanoes/${state.volcano.id}?epoch=${epochS}`}
                      className="font-[family-name:var(--font-display)] text-sm text-[var(--color-ash)] hover:text-[var(--color-lava)]"
                    >
                      {state.volcano.name}
                    </a>
                    <span className="ml-2 text-xs text-[var(--color-ash-dim)]">
                      {state.volcano.country}
                    </span>
                    <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-ash-dim)]">
                      {state.tremorLabel} · ΔV {rate(indicators.deformationRateM3PerDay)} · RSAM{" "}
                      {indicators.rsamRatio.toFixed(2)}× · C/S {indicators.csMolarRatio.toFixed(1)}{" "}
                      · SO₂ {indicators.so2TonnesPerDay} t/day
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <span className="font-[family-name:var(--font-mono)] text-sm tabular-nums text-[var(--color-lava)]">
                      {state.unrest.toFixed(3)}
                    </span>
                    <AlertBadge
                      level={assessment.volcanoAlertLevel}
                      colour={assessment.aviationColourCode}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>

        <div className="grid content-start gap-4">
          <Panel title="Seed world" subtitle="Determinism is the product.">
            <p className="text-xs leading-relaxed text-[var(--color-ash-muted)]">
              Twelve real volcanoes with their real coordinates and elevations. Everything else -
              the chamber geometry, the tremor mechanism, the gas ratios - is synthesised from
              integer seed 7331 by{" "}
              <code className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-seismic)]">
                mulberry32
              </code>
              . No clock, no network, no model call.
            </p>
          </Panel>
          <Panel title="Live deformation" subtitle="Source volume change at this epoch.">
            <ul className="space-y-2 text-xs">
              {ranked.slice(0, 4).map((state) => (
                <li key={state.volcano.id} className="flex items-baseline justify-between gap-2">
                  <span className="text-[var(--color-ash-muted)]">{state.volcano.name}</span>
                  <span className="font-[family-name:var(--font-mono)] tabular-nums text-[var(--color-lava)]">
                    {volume(state.source.volumeChangeM3)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Callout tone="lava" title="The claim this app makes">
          A magma chamber&apos;s depth and volume can be recovered from a GPS deformation field, and
          the app shows you the answer together with the correlation that limits it. Go to{" "}
          <a href={`/geodesy?epoch=${epochS}`} className="text-[var(--color-lava)] underline">
            Geodesy
          </a>{" "}
          and invert the field for any volcano.
        </Callout>
        <Callout tone="seismic" title="What is real and what is not">
          The coordinates, elevations and volcano types are from public volcano references. The
          unrest profiles, the station network and every measurement are synthetic. The{" "}
          <em>math</em> is real: the Mogi forward model, its analytic Jacobian, the
          Levenberg-Marquardt solver, the radix-2 FFT, the Aitchison distance and Pyle&apos;s
          thinning law are all the actual formulations.
        </Callout>
      </div>
    </main>
  );
}
