import {
  type Displacement,
  hashSeed,
  type MogiSource,
  mogiForward,
  mogiInvert,
  mulberry32,
  type StationOffset,
  volcanoSource,
  volumeRateM3PerDay,
} from "@repo/core";
import { findVolcano, gnssStationsFor, VOLCANO_CATALOGUE } from "@repo/seed";
import { Callout, Cell, DataTable, Num, Panel, Quiver, Stat, StatGrid } from "@repo/ui";
import type { Metadata } from "next";
import { ObservatoryNav } from "../../components/observatory-nav";
import { readEpoch } from "../../lib/epoch";
import { millimetres, rate, volume } from "../../lib/format";

export const metadata: Metadata = {
  title: "Geodesy â€” Mogi inversion",
  description:
    "Invert a GPS deformation field for a buried pressure source, and read the depth/volume trade-off off the parameter covariance.",
};

/** Measurement noise per component, metres. A good GNSS campaign. */
const SIGMA_M = 0.004;

/**
 * The synthetic "observation" for a volcano.
 *
 * A real campaign hands us a GNSS vector field. Here it is produced by the
 * same forward model the inversion solves, plus noise drawn from a seeded
 * stream. That is not circular: it is how geodetic inversion is validated, and
 * it is why the recovered depth lands near truth rather than matching it.
 */
function observeField(
  stations: readonly StationOffset[],
  truth: MogiSource,
  seed: number,
): Displacement[] {
  const exact = mogiForward(stations, truth);
  const rng = mulberry32(seed);
  return exact.map((d) => ({
    eastM: d.eastM + rng.gaussian(0, SIGMA_M),
    northM: d.northM + rng.gaussian(0, SIGMA_M),
    upM: d.upM + rng.gaussian(0, SIGMA_M),
  }));
}

export default function GeodesyPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const { epochS, timestampIso } = readEpoch(searchParams);
  const requested = searchParams.volcano ?? "kilauea";
  const volcano = findVolcano(requested) ?? findVolcano("kilauea");
  if (!volcano) throw new Error("volcano catalogue is empty");

  const stations = gnssStationsFor(volcano.id);
  const truth = volcanoSource(volcano, epochS);
  const observed = observeField(stations, truth, hashSeed(`${volcano.id}:${epochS}`));
  // Start deliberately far from the answer: the solver has to earn the result.
  const result = mogiInvert(stations, observed, {
    sigmaM: SIGMA_M,
    initial: { eastOffsetM: 2500, northOffsetM: -2500, depthM: 12000, volumeChangeM3: 1e7 },
    maxIterations: 120,
  });

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--color-lava)]">
              geodesy
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
              Mogi source inversion
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ash-muted)]">
              A buried point pressure source in an elastic half-space, solved from {stations.length}{" "}
              GNSS three-component vectors with a Levenberg-Marquardt solve and the analytic
              Jacobian. Runs in your browser, in one render.
            </p>
          </div>
          <ObservatoryNav epoch={epochS} />
        </div>
        <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-ash-dim)]">
          {volcano.name} Â· {timestampIso} Â· Ïƒ = {(SIGMA_M * 1000).toFixed(0)} mm per component Â·
          solver started 12 km deep
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel
          title="Observed deformation field"
          subtitle="Horizontal displacement arrows, scaled to the largest magnitude. Vertical displacement is the colour: amber for subsidence, teal for uplift."
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
            <Quiver
              vectors={observed}
              labels={stations.map((s) => s.code)}
              label={`Horizontal displacement field at ${volcano.name}`}
            />
            <div className="space-y-2 text-xs">
              <p className="text-[var(--color-ash-muted)]">
                The pattern is the fingerprint of a point source. Horizontal displacement reaches
                further from the chamber than vertical, because <em>u</em> decays as 1/RÂ² while{" "}
                <em>w</em> decays as 1/RÂ³, so a GNSS campaign constrains source position far better
                than levelling alone.
              </p>
              <p className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-ash-dim)]">
                u = CÂ·(sâˆ’e)/RÂ³, w = CÂ·d/RÂ³, C = Î”V(1âˆ’Î½)/Ï€
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Inverted source" subtitle="Four parameters from 3N observations.">
          <StatGrid columns={2}>
            <Stat label="East offset" value={Math.round(result.source.eastOffsetM)} unit="m" />
            <Stat label="North offset" value={Math.round(result.source.northOffsetM)} unit="m" />
            <Stat label="Depth" value={Math.round(result.source.depthM)} unit="m" tone="lava" />
            <Stat
              label="Volume change"
              value={volume(result.source.volumeChangeM3)}
              tone={result.source.volumeChangeM3 < 0 ? "alert" : "seismic"}
            />
          </StatGrid>
          <dl className="mt-4 space-y-1.5 border-t border-[var(--color-slag)] pt-3 text-xs">
            <Row label="RMS misfit" value={`${(result.rmsMisfitM * 1000).toFixed(2)} mm`} />
            <Row
              label="Ï‡Â² / dof"
              value={`${result.chiSquared.toFixed(1)} / ${result.degreesOfFreedom}`}
            />
            <Row label="Iterations" value={String(result.iterations)} />
            <Row label="Termination" value={result.terminationReason} />
            <Row label="Converged" value={result.converged ? "yes" : "no"} />
            <Row
              label="Variance reduced"
              value={`${(result.varianceReduction * 100).toFixed(1)} %`}
            />
          </dl>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="The depth / volume trade-off"
          subtitle="The honest limit of a single-epoch geodetic inversion."
          aside={
            <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-lava)]">
              rho = {result.depthVolumeTradeOff.toFixed(3)}
            </span>
          }
        >
          <p className="text-xs leading-relaxed text-[var(--color-ash-muted)]">
            A Mogi source produces the same surface field for a deep chamber that gained a little
            volume and a shallow one that gained a lot. The parameter covariance puts a number on
            that: the depth/volume correlation here is{" "}
            <strong className="text-[var(--color-ash)]">
              {result.depthVolumeTradeOff.toFixed(3)}
            </strong>
            , and the 1Ïƒ uncertainties below widen in the same proportion. Only a time series of
            epochs, or a network with real aperture, separates them.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Row label="Ïƒ depth" value={`${Math.round(result.parameterSigmas.depthM)} m`} />
            <Row label="Ïƒ volume" value={volume(result.parameterSigmas.volumeChangeM3)} />
            <Row label="Ïƒ east" value={`${Math.round(result.parameterSigmas.eastOffsetM)} m`} />
            <Row label="Ïƒ north" value={`${Math.round(result.parameterSigmas.northOffsetM)} m`} />
          </div>
        </Panel>

        <Panel title="Residuals by station" subtitle="Observed minus modelled, in millimetres.">
          <DataTable columns={["Station", "E", "N", "U", "Instrument"]}>
            {stations.map((station, i) => {
              const residual = result.residuals[i];
              if (!residual) return null;
              return (
                <tr key={station.id}>
                  <Cell strong>{station.code}</Cell>
                  <Num>{millimetres(residual.eastM)}</Num>
                  <Num>{millimetres(residual.northM)}</Num>
                  <Num tone={Math.abs(residual.upM) > 0.02 ? "alert" : undefined}>
                    {millimetres(residual.upM)}
                  </Num>
                  <Cell>{station.instrument}</Cell>
                </tr>
              );
            })}
          </DataTable>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Callout tone="lava" title="Try another volcano">
          {VOLCANO_CATALOGUE.map((v) => (
            <a
              key={v.id}
              href={`/geodesy?epoch=${epochS}&volcano=${v.id}`}
              className="mr-3 underline"
            >
              {v.name}
            </a>
          ))}
        </Callout>
        <Callout tone="seismic" title="The formulation">
          Mogi (1958), a small pressurised sphere in a homogeneous isotropic elastic half-space,
          expressed in volume change. Validated against the 1914 TaishÅ Sakurajima case, which it
          reproduces to <span className="font-[family-name:var(--font-mono)]">âˆ’1.5625 m</span> of
          epicentral subsidence and{" "}
          <span className="font-[family-name:var(--font-mono)]">0.98 kmÂ³</span> of deflation from
          Omori&apos;s levelling lines.
        </Callout>
        <Callout tone="normal" title="Why noise is in the field">
          A noiseless field inverts to machine precision and proves nothing. The seeded 4 mm noise
          puts the recovered depth a few percent away from truth, which is the number that tells you
          whether an inversion on real data is behaving.
        </Callout>
      </div>

      <footer className="mt-6 text-xs text-[var(--color-ash-dim)]">
        Truth at this epoch: Î”V {volume(truth.volumeChangeM3)} Â· rate{" "}
        {rate(volumeRateM3PerDay(volcano, epochS))} Â· depth {Math.round(truth.depthM)} m Â· offset
        ({Math.round(truth.eastOffsetM)}, {Math.round(truth.northOffsetM)}) m.
      </footer>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[var(--color-ash-dim)]">{label}</dt>
      <dd className="font-[family-name:var(--font-mono)] tabular-nums text-[var(--color-ash-muted)]">
        {value}
      </dd>
    </div>
  );
}
