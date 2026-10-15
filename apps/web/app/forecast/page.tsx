import { ALERT_RULES, assessUnrest, renderSituationReport, unrestIndicators } from "@repo/core";
import { findVolcano, VOLCANO_CATALOGUE } from "@repo/seed";
import {
  AlertBadge,
  Callout,
  Cell,
  DataTable,
  Num,
  Panel,
  ProgressMeter,
  Stat,
  StatGrid,
} from "@repo/ui";
import type { Metadata } from "next";
import { ObservatoryNav } from "../../components/observatory-nav";
import { readEpoch } from "../../lib/epoch";
import { hertz, rate } from "../../lib/format";

export const metadata: Metadata = {
  title: "Forecast â€” the alert engine",
  description:
    "A volcanic alert level as an auditable argument: which indicators moved, by how much, against which thresholds.",
};

export default function ForecastPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const { epochS, timestampIso } = readEpoch(searchParams);
  const requested = searchParams.volcano ?? "kilauea";
  const volcano = findVolcano(requested) ?? findVolcano("kilauea");
  if (!volcano) throw new Error("volcano catalogue is empty");

  const indicators = unrestIndicators(volcano, epochS);
  const assessment = assessUnrest(indicators);
  const report = renderSituationReport(volcano.name, indicators, assessment);

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--color-lava)]">
              forecast
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
              Alert engine
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ash-muted)]">
              A volcanic alert level is not a number, it is an argument. This engine makes the
              argument explicit: every verdict carries the ordered list of rules that fired, the
              measured values, and the thresholds they crossed. A duty officer can defend it in a
              Situation Report without trusting a score.
            </p>
          </div>
          <ObservatoryNav epoch={epochS} />
        </div>
        <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-ash-dim)]">
          {volcano.name} Â· {timestampIso}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="grid content-start gap-4">
          <Panel title="Verdict" subtitle="Deterministic. No model, no sampling.">
            <div className="flex items-center gap-3">
              <AlertBadge
                level={assessment.volcanoAlertLevel}
                colour={assessment.aviationColourCode}
              />
              <span className="text-xs text-[var(--color-ash-dim)]">
                confidence {(assessment.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="mt-3">
              <ProgressMeter
                value={assessment.confidence}
                label="Confidence in the verdict"
                tone={assessment.volcanoAlertLevel === "WARNING" ? "alert" : "lava"}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-ash-muted)]">
              Confidence counts how many independent indicator families corroborate the level. A
              seismic-only signal scores lower than a signal backed by gas and deformation, which is
              the distinction that matters when a bulletin goes out.
            </p>
          </Panel>

          <Panel title="Indicators" subtitle="All derived from the epoch.">
            <StatGrid columns={2}>
              <Stat
                label="Deformation"
                value={rate(indicators.deformationRateM3PerDay)}
                tone="lava"
              />
              <Stat
                label="Î”V"
                value={`${(indicators.sourceVolumeChangeM3 / 1e6).toFixed(2)} MmÂ³`}
              />
              <Stat label="RSAM ratio" value={indicators.rsamRatio.toFixed(2)} unit="Ã—" />
              <Stat label="Tremor Hz" value={hertz(indicators.tremorHz)} />
              <Stat
                label="Tremor band"
                value={`${(indicators.tremorBandFraction * 100).toFixed(0)} %`}
              />
              <Stat label="C/S ratio" value={indicators.csMolarRatio.toFixed(1)} />
              <Stat label="SOâ‚‚" value={indicators.so2TonnesPerDay} unit="t/day" />
              <Stat label="VT / 24 h" value={indicators.vtEvents24h} />
            </StatGrid>
          </Panel>
        </div>

        <div className="grid content-start gap-4">
          <Panel
            title="Rules that fired"
            subtitle="Ordered by severity. The rules that did not fire are listed below, because a verdict is only defensible if you can also show what was checked."
          >
            <DataTable columns={["Rule", "Statement", "Observed", "Threshold", "Verdict"]}>
              {assessment.firedRules.map((rule) => (
                <tr key={rule.id}>
                  <Cell strong>{rule.id}</Cell>
                  <Cell>{rule.statement}</Cell>
                  <Num>{rule.value.toPrecision(4)}</Num>
                  <Cell>
                    {rule.comparison} {rule.threshold.toPrecision(4)}
                  </Cell>
                  <Cell>
                    <span className="text-[var(--color-alert)]">fired</span>
                  </Cell>
                </tr>
              ))}
            </DataTable>
            {assessment.firedRules.length === 0 ? (
              <p className="text-xs text-[var(--color-ash-dim)]">
                No rule fired; the volcano is at background.
              </p>
            ) : null}
          </Panel>

          <Panel
            title="Situation Report"
            subtitle="What a duty officer would paste into the bulletin."
          >
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-slag)] bg-[var(--color-abyss)] p-3 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--color-ash-muted)]">
              {report}
            </pre>
          </Panel>

          <Panel title="Checked but silent" subtitle="Evaluated and did not fire.">
            <ul className="space-y-1 text-xs text-[var(--color-ash-dim)]">
              {assessment.checkedRules.map((rule) => (
                <li key={rule.id} className="grid grid-cols-[1fr_auto] gap-2">
                  <span>{rule.statement}</span>
                  <span className="font-[family-name:var(--font-mono)] tabular-nums">
                    {rule.value.toPrecision(3)} / {rule.threshold.toPrecision(3)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-4">
        <Panel
          title="The rule table"
          subtitle={`${ALERT_RULES.length} rules. A level is only ever raised; the verdict starts at NORMAL and climbs.`}
        >
          <DataTable
            columns={["Id", "Indicator", "Threshold", "Sets level", "Sets colour", "Family"]}
          >
            {ALERT_RULES.map((rule) => (
              <tr key={rule.id}>
                <Cell strong>{rule.id}</Cell>
                <Cell>{rule.statement}</Cell>
                <Cell>
                  {rule.comparison} {rule.threshold.toPrecision(3)}
                </Cell>
                <Cell>{rule.setsLevel}</Cell>
                <Cell>{rule.setsColour}</Cell>
                <Cell>{rule.family}</Cell>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Callout tone="lava" title="Change volcano">
          {VOLCANO_CATALOGUE.map((v) => (
            <a
              key={v.id}
              href={`/forecast?epoch=${epochS}&volcano=${v.id}`}
              className="mr-3 underline"
            >
              {v.name}
            </a>
          ))}
        </Callout>
        <Callout tone="normal" title="What this is not">
          It is not a probability of eruption. It is a deterministic mapping from measured
          indicators to a published alert level, with every step of the mapping visible. That is
          what an observatory issues, and it is the honest form of the claim.
        </Callout>
      </div>
    </main>
  );
}
