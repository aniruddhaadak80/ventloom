import {
  aitchisonDistance,
  type Composition,
  clrTransform,
  clusterTephra,
  OXIDE_ORDER,
} from "@repo/core";
import { CORES, END_MEMBER_LIST, nearestEndMemberId, TEPHRA_LAYERS } from "@repo/seed";
import { Callout, Cell, DataTable, Num, Panel, ProgressMeter } from "@repo/ui";
import type { Metadata } from "next";
import { ObservatoryNav } from "../../components/observatory-nav";
import { readEpoch } from "../../lib/epoch";

export const metadata: Metadata = {
  title: "Tephra â€” geochemical fingerprints",
  description:
    "Correlate tephra layers between cores with Aitchison distance on the compositional simplex, and read the correlation off the resulting clusters.",
};

/**
 * Render a composition as a horizontal stacked bar.
 *
 * Oxides are parts of a whole, so the only honest picture is a 100 % bar; a
 * grouped bar chart of wt% invites the reader to compare totals that are
 * meaningless.
 */
const OXIDE_COLOUR: Record<string, string> = {
  SiO2: "var(--color-lava)",
  TiO2: "var(--color-lava-hot)",
  Al2O3: "var(--color-seismic)",
  Fe2O3: "var(--color-vent)",
  MnO: "var(--color-cinder)",
  MgO: "var(--color-seismic-dim)",
  CaO: "var(--color-normal)",
  Na2O: "var(--color-watch)",
  K2O: "var(--color-ash-dim)",
  P2O5: "var(--color-advisory)",
};

export default function TephraPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const { epochS, timestampIso } = readEpoch(searchParams);
  const groups = clusterTephra(TEPHRA_LAYERS, 2);
  const matrix = TEPHRA_LAYERS.map((row) => ({
    layer: row,
    distances: TEPHRA_LAYERS.map((col) =>
      row === col ? 0 : aitchisonDistance(row.composition, col.composition),
    ),
  }));

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--color-lava)]">
              tephra
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
              Geochemical fingerprints
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ash-muted)]">
              Tephra layers are matched between cores by their major-oxide chemistry. Because oxides
              sum to 100 %, the distance is measured on the compositional simplex with the Aitchison
              metric, not in wt% space where a rise in SiOâ‚‚ drags every other oxide down and
              Euclidean distance quietly lies.
            </p>
          </div>
          <ObservatoryNav epoch={epochS} />
        </div>
        <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-ash-dim)]">
          {TEPHRA_LAYERS.length} layers across {CORES.length} cores Â· {groups.length} correlated
          groups Â· {timestampIso}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel
          title="Correlated layers"
          subtitle="Single-linkage clustering at an Aitchison distance of 2.0. Single linkage is used because a tephra unit can split into a coarse proximal lens and a fine distal drape that must still group."
        >
          <ol className="space-y-3">
            {groups.map((group) => {
              const representative = TEPHRA_LAYERS.find((l) => l.id === group.representativeId);
              const match = representative ? nearestEndMemberId(representative) : null;
              return (
                <li
                  key={group.representativeId}
                  className="rounded-[var(--radius-md)] border border-[var(--color-slag)] p-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-[family-name:var(--font-display)] text-sm text-[var(--color-ash)]">
                      Group of {group.memberIds.length}
                    </h3>
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-ash-dim)]">
                      mean within-group d = {group.meanWithinGroupDistance.toFixed(3)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-ash-dim)]">
                    {match
                      ? `Resembles ${match.id} (d = ${match.distance.toFixed(3)})`
                      : "unresolved"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {group.memberIds.map((id) => (
                      <a
                        key={id}
                        href={`#${id}`}
                        className="rounded-[var(--radius-sm)] border border-[var(--color-slag)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-ash-muted)]"
                      >
                        {id}
                      </a>
                    ))}
                  </div>
                  {representative ? (
                    <div className="mt-3">
                      <CompositionBar
                        composition={representative.composition}
                        label={representative.id}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Panel>

        <div className="grid content-start gap-4">
          <Panel
            title="End members"
            subtitle="The four eruptive units the recovered layers are drawn from."
          >
            <ul className="space-y-3">
              {END_MEMBER_LIST.map((member) => (
                <li key={member.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-[family-name:var(--font-display)] text-xs text-[var(--color-ash)]">
                      {member.name}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-ash-dim)]">
                      VEI {member.vei} Â· {member.ageYearsAgo} a Â· {member.sourceVolcano}
                    </span>
                  </div>
                  <div className="mt-1">
                    <CompositionBar composition={member.composition} label={member.name} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Why not Euclidean distance" subtitle="The same layers, two metrics.">
            <p className="text-xs leading-relaxed text-[var(--color-ash-muted)]">
              On a closed composition, a raw wt% distance is not invariant to whether a lab reports
              a sample as wt% or as a fraction, and it treats a rise in SiOâ‚‚ and a matching fall
              everywhere else as movement when the composition has barely changed. The centered
              log-ratio transform{" "}
              <code className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-seismic)]">
                clr(x) = ln(x) âˆ’ mean(ln x)
              </code>{" "}
              fixes both: its output sums to zero and its Euclidean distance is the Aitchison
              distance.
            </p>
            <div className="mt-3">
              <ClrTrail composition={END_MEMBER_LIST[0]?.composition} />
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-4">
        <Panel
          title="Distance matrix"
          subtitle="Aitchison distances between every pair of recovered layers, across cores. Lower is a stronger match."
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 font-[family-name:var(--font-display)] text-[10px] uppercase tracking-wider text-[var(--color-ash-dim)]">
                    layer
                  </th>
                  {TEPHRA_LAYERS.map((layer) => (
                    <th
                      key={layer.id}
                      scope="col"
                      className="px-1 py-1.5 text-center font-[family-name:var(--font-mono)] text-[9px] text-[var(--color-ash-dim)]"
                      title={layer.id}
                    >
                      {layer.coreId.split("-")[0]?.slice(0, 4) ?? layer.coreId}-L{layer.depthM}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.layer.id} className="border-t border-[var(--color-slag)]/70">
                    <th
                      scope="row"
                      className="px-2 py-1 text-left font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-ash-muted)]"
                    >
                      {row.layer.id}
                    </th>
                    {row.distances.map((d, j) => (
                      <td
                        key={TEPHRA_LAYERS[j]?.id ?? j}
                        className="px-1 py-1 text-center font-[family-name:var(--font-mono)] tabular-nums"
                        style={{
                          color:
                            d === 0
                              ? "var(--color-ash)"
                              : d < 2
                                ? "var(--color-lava)"
                                : "var(--color-ash-dim)",
                          opacity: d === 0 ? 0.4 : 1,
                        }}
                      >
                        {d === 0 ? "Â·" : d.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <DataTable
          columns={["Layer", "Core", "Depth", "Nearest end member", "Distance", "SiOâ‚‚ (wt%)"]}
        >
          {TEPHRA_LAYERS.map((layer) => {
            const match = nearestEndMemberId(layer);
            return (
              <tr key={layer.id} id={layer.id}>
                <Cell strong>{layer.id}</Cell>
                <Cell>{CORES.find((c) => c.id === layer.coreId)?.name ?? layer.coreId}</Cell>
                <Num>{layer.depthM.toFixed(2)} m</Num>
                <Cell>{match.id}</Cell>
                <Num tone={match.distance < 1 ? "lava" : undefined}>
                  {match.distance.toFixed(3)}
                </Num>
                <Num>{layer.composition.SiO2.toFixed(2)}</Num>
              </tr>
            );
          })}
        </DataTable>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Callout tone="seismic" title="Pyle thinning, the other half of tephra">
          Once the isopach map is surveyed, thickness decays exponentially with the square root of
          the area enclosed:{" "}
          <code className="font-[family-name:var(--font-mono)] text-[11px]">
            T = Tâ‚€Â·exp(âˆ’kÂ·x)
          </code>{" "}
          with{" "}
          <code className="font-[family-name:var(--font-mono)] text-[11px]">x = âˆš(A/Ï€)</code>.
          The deposit volume then follows in closed form,{" "}
          <code className="font-[family-name:var(--font-mono)] text-[11px]">V = 2Ï€Tâ‚€/kÂ²</code>,
          and the model surface reports it alongside the half-thickness distance ln2/k.
        </Callout>
        <Callout tone="normal" title="Synthetic chemistry">
          Every oxide value here is a seeded perturbation of a nominal end-member composition. The
          compositions are plausible, the clustering behaviour is what the metric really produces,
          and nothing in this repo is data about a real volcanic system.
        </Callout>
      </div>
    </main>
  );
}

function CompositionBar({ composition, label }: { composition: Composition; label: string }) {
  const total = OXIDE_ORDER.reduce((sum, oxide) => sum + composition[oxide], 0);
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-slag)]"
      role="img"
      aria-label={`${label} major-oxide composition`}
    >
      {OXIDE_ORDER.map((oxide) => {
        const fraction = composition[oxide] / total;
        if (fraction <= 0) return null;
        return (
          <div
            key={oxide}
            style={{ width: `${fraction * 100}%`, background: OXIDE_COLOUR[oxide] }}
            title={`${oxide}: ${composition[oxide].toFixed(2)} wt%`}
          />
        );
      })}
    </div>
  );
}

/** A small trail showing the CLR components of one end member. */
function ClrTrail({ composition }: { composition: Composition | undefined }) {
  if (!composition) return null;
  const clr = clrTransform(composition);
  const maxAbs = Math.max(...clr.map(Math.abs), 1e-9);
  return (
    <ul className="space-y-1">
      {OXIDE_ORDER.map((oxide, i) => {
        const value = clr[i] ?? 0;
        return (
          <li key={oxide} className="grid grid-cols-[52px_1fr_64px] items-center gap-2">
            <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-ash-dim)]">
              {oxide}
            </span>
            <ProgressMeter
              value={(value + maxAbs) / (2 * maxAbs)}
              label={`${oxide} clr component`}
              tone="seismic"
            />
            <span className="text-right font-[family-name:var(--font-mono)] text-[10px] tabular-nums text-[var(--color-ash-muted)]">
              {value.toFixed(3)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
