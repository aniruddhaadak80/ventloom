import {
  assessUnrest,
  mogiForward,
  networkSnapshot,
  unrestIndicators,
  volcanoSource,
  volumeRateM3PerDay,
} from "@repo/core";
import { findVolcano, gnssStationsFor, stationsFor, VOLCANO_CATALOGUE } from "@repo/seed";
import { AlertBadge, Callout, Cell, DataTable, Num, Panel, Stat, StatGrid } from "@repo/ui";
import type { Metadata } from "next";
import { ObservatoryNav } from "../../../components/observatory-nav";
import { readEpoch } from "../../../lib/epoch";
import { hertz, millimetres, rate, volume } from "../../../lib/format";

export function generateStaticParams() {
  return VOLCANO_CATALOGUE.map((volcano) => ({ id: volcano.id }));
}

export const metadata: Metadata = {
  title: "Volcano",
  description:
    "One volcano in the seeded network: geography, instruments, deformation and alert state.",
};

export default function VolcanoPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | undefined>;
}) {
  const { epochS, timestampIso } = readEpoch(searchParams);
  const volcano = findVolcano(params.id) ?? VOLCANO_CATALOGUE[0];
  if (!volcano) throw new Error("volcano catalogue is empty");

  const stations = stationsFor(volcano.id);
  const gnss = gnssStationsFor(volcano.id);
  const source = volcanoSource(volcano, epochS);
  const field = mogiForward(gnss, source);
  const indicators = unrestIndicators(volcano, epochS);
  const assessment = assessUnrest(indicators);
  const snapshot = networkSnapshot([volcano], stations, epochS).volcanoes[0];
  if (!snapshot) throw new Error("snapshot missing");

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--color-lava)]">
              {volcano.volcanoType} · {volcano.country}
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
              {volcano.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ash-muted)]">
              {volcano.summary}
            </p>
          </div>
          <ObservatoryNav epoch={epochS} />
        </div>
        <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-ash-dim)]">
          {volcano.latitudeDeg.toFixed(3)}°, {volcano.longitudeDeg.toFixed(3)}° ·{" "}
          {volcano.elevationM} m · {timestampIso} · {snapshot.tremorLabel}
        </p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <AlertBadge level={assessment.volcanoAlertLevel} colour={assessment.aviationColourCode} />
        <span className="text-xs text-[var(--color-ash-dim)]">
          {assessment.firedRules.length} rule{assessment.firedRules.length === 1 ? "" : "s"} fired ·
          confidence {(assessment.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Source at this epoch"
          subtitle="The Mogi parameters as the world declares them."
        >
          <StatGrid columns={2}>
            <Stat label="Depth" value={Math.round(source.depthM)} unit="m" tone="lava" />
            <Stat label="ΔV" value={volume(source.volumeChangeM3)} />
            <Stat label="Rate" value={rate(volumeRateM3PerDay(volcano, epochS))} />
            <Stat label="Unrest" value={snapshot.unrest.toFixed(3)} />
          </StatGrid>
        </Panel>
        <Panel
          title="Deformation at the GNSS benches"
          subtitle="Forward model only: no inversion, no noise."
        >
          <DataTable columns={["Bench", "East", "North", "Up"]}>
            {gnss.map((station, i) => {
              const d = field[i];
              if (!d) return null;
              return (
                <tr key={station.id}>
                  <Cell strong>{station.code}</Cell>
                  <Num>{millimetres(d.eastM)}</Num>
                  <Num>{millimetres(d.northM)}</Num>
                  <Num tone={d.upM < 0 ? "lava" : "seismic"}>{millimetres(d.upM)}</Num>
                </tr>
              );
            })}
          </DataTable>
        </Panel>
        <Panel title="Indicators" subtitle="What the alert engine consumes.">
          <StatGrid columns={2}>
            <Stat label="RSAM" value={indicators.rsamRatio.toFixed(2)} unit="×" tone="lava" />
            <Stat label="Tremor" value={hertz(indicators.tremorHz)} />
            <Stat label="SO₂" value={indicators.so2TonnesPerDay} unit="t/day" />
            <Stat label="C/S" value={indicators.csMolarRatio.toFixed(1)} />
            <Stat label="Thermal px" value={indicators.thermalPixels24h} />
            <Stat label="VT / 24 h" value={indicators.vtEvents24h} />
          </StatGrid>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Station network"
          subtitle={`${stations.length} instruments on ${volcano.name}.`}
        >
          <DataTable columns={["Code", "Id", "Instrument", "East", "North", "Elevation"]}>
            {stations.map((station) => (
              <tr key={station.id}>
                <Cell strong>{station.code}</Cell>
                <Cell>{station.id}</Cell>
                <Cell>{station.instrument}</Cell>
                <Num>{station.eastOffsetM} m</Num>
                <Num>{station.northOffsetM} m</Num>
                <Num>{station.elevationM} m</Num>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Callout tone="seismic" title="Coordinates">
          Latitude, longitude and elevation are drawn from public volcano references. The station
          geometry is generated by a golden-angle spiral from the volcano id, which spreads the
          benches in azimuth without clumping them.
        </Callout>
        <Callout tone="normal" title="Unrest profile">
          <strong className="text-[var(--color-ash)]">{volcano.unrestProfile}</strong>. The profile
          sets the base trend of the unrest index; the oscillation on top of it comes from the seed.
          That is the whole of the world model.
        </Callout>
      </div>
    </main>
  );
}
