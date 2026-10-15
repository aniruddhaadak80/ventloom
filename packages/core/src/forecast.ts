/**
 * The alert-level engine.
 *
 * A volcanic alert level is not a number, it is an argument: which indicators
 * moved, by how much, against which thresholds. This engine makes that argument
 * explicit. Every verdict carries the ordered list of rules that fired, the
 * observed values, and the thresholds they crossed — so a duty officer can
 * defend the call in a Situation Report instead of trusting a score.
 *
 * Levels follow the United States Geological Survey scheme
 * (NORMAL / ADVISORY / WATCH / WARNING) for volcano hazard and the parallel
 * aviation colour code (GREEN / YELLOW / ORANGE / RED) for ash risk to
 * aircraft. The two are published together and are computed independently here.
 */

export const VOLCANO_ALERT_LEVELS = ["NORMAL", "ADVISORY", "WATCH", "WARNING"] as const;
export type VolcanoAlertLevel = (typeof VOLCANO_ALERT_LEVELS)[number];

export const AVIATION_COLOUR_CODES = ["GREEN", "YELLOW", "ORANGE", "RED"] as const;
export type AviationColourCode = (typeof AVIATION_COLOUR_CODES)[number];

/** The measured indicators an alert level is derived from. */
export interface UnrestIndicators {
  /** Inflation rate, in m³/day of source volume change. */
  deformationRateM3PerDay: number;
  /** Current source volume change, m³. Positive = inflation. */
  sourceVolumeChangeM3: number;
  /** RSAM divided by the 30-day background median, dimensionless. */
  rsamRatio: number;
  /** Dominant tremor frequency, Hz. */
  tremorHz: number;
  /**
   * Fraction of seismic power in the 1-5 Hz band, where volcanic tremor lives.
   * 0.72 for harmonic tremor against 0.04 for a quiet station, which makes it
   * the most reliable single tonal indicator available.
   */
  tremorBandFraction: number;
  /** Count of resolved spectral peaks above the local noise floor. */
  harmonicPeakCount: number;
  /** SO₂ emission rate, tonnes per day. */
  so2TonnesPerDay: number;
  /** C/S molar ratio. Above ~10 suggests deep, gas-rich magma. */
  csMolarRatio: number;
  /** Thermal alert pixel count over 24 h. */
  thermalPixels24h: number;
  /** Number of volcano-tectonic earthquakes in the last 24 h. */
  vtEvents24h: number;
}

export const EMPTY_INDICATORS: UnrestIndicators = {
  deformationRateM3PerDay: 0,
  sourceVolumeChangeM3: 0,
  rsamRatio: 1,
  tremorHz: 0,
  tremorBandFraction: 0,
  harmonicPeakCount: 0,
  so2TonnesPerDay: 0,
  csMolarRatio: 0,
  thermalPixels24h: 0,
  vtEvents24h: 0,
};

export type RuleSeverity = "info" | "elevated" | "high" | "extreme";

export interface FiredRule {
  readonly id: string;
  /** What a human reads in the Situation Report. */
  readonly statement: string;
  /** The measured value that triggered or did not trigger it. */
  readonly value: number;
  /** The threshold in the rule, in the same units. */
  readonly threshold: number;
  readonly comparison: ">=" | "<=" | ">";
  readonly severity: RuleSeverity;
  fired: boolean;
}

export interface AlertAssessment {
  volcanoAlertLevel: VolcanoAlertLevel;
  aviationColourCode: AviationColourCode;
  /** Rules that fired, highest severity first. */
  firedRules: FiredRule[];
  /** Rules that did not fire, kept so the report can show what was checked. */
  checkedRules: FiredRule[];
  /** 0–1: how many independent indicator families corroborate the level. */
  confidence: number;
  /** One-line recommendation, never a prediction. */
  advisories: string[];
  /** STRONG: the level is set by the ground, not by a score. */
  determinism: "deterministic";
}

interface RuleSpec {
  id: string;
  statement: string;
  severity: RuleSeverity;
  select: (i: UnrestIndicators) => number;
  threshold: number;
  comparison: ">=" | "<=" | ">";
  /** Which alert level this rule can raise the verdict to. */
  setsLevel: VolcanoAlertLevel;
  /** Aviation colour this rule can raise the verdict to. */
  setsColour: AviationColourCode;
  advisory: string;
  /** Indicator family — used to compute corroboration. */
  family: "deformation" | "seismic" | "gas" | "thermal";
}

/**
 * The rule table, ordered from the most severe to the least.
 *
 * A level is only ever *raised* by a rule: the verdict starts at NORMAL/GREEN
 * and climbs. That mirrors how observatories actually work, and it means the
 * provenance list is exactly the set of rules that could have changed the
 * answer.
 */
export const ALERT_RULES: readonly RuleSpec[] = [
  {
    id: "R1-ERUPTION-CONFIRMED",
    statement: "Explosive eruption confirmed in progress",
    severity: "extreme",
    select: (i) => i.rsamRatio,
    threshold: 12,
    comparison: ">=",
    setsLevel: "WARNING",
    setsColour: "RED",
    family: "seismic",
    advisory:
      "Eruption under way: red aviation colour, notify ATC and the Volcanic Ash Advisory Centre.",
  },
  {
    id: "R2-IMMINENT-ERUPTION",
    statement: "Sustained harmonic tremor with accelerating inflation",
    severity: "extreme",
    // Deliberately not keyed on harmonicPeakCount: on the station noise model
    // only the fundamental of a tremor series clears the noise, so a partial
    // count cannot carry a decision. The tremor band fraction can — it runs
    // 0.72 for harmonic tremor against 0.04 for a quiet station.
    select: (i) => Math.min(i.rsamRatio * i.tremorBandFraction, i.deformationRateM3PerDay * 100),
    threshold: 8,
    comparison: ">=",
    setsLevel: "WARNING",
    setsColour: "RED",
    family: "seismic",
    advisory:
      "Escalating unrest: prepare for an eruption, pre-position observers, warn downstream drainages.",
  },
  {
    id: "R3-HIGH-TREMOR",
    statement: "RSAM at or above 4x the 30-day background",
    severity: "high",
    select: (i) => i.rsamRatio,
    threshold: 4,
    comparison: ">=",
    setsLevel: "WATCH",
    setsColour: "ORANGE",
    family: "seismic",
    advisory:
      "Raise to WATCH: increase sampling rate, deploy portable seismometers, brief the observatory director.",
  },
  {
    id: "R4-DEEP-GAS",
    statement: "C/S ratio at or above 10 with elevated SO2 flux",
    severity: "high",
    select: (i) => i.csMolarRatio,
    threshold: 10,
    comparison: ">=",
    setsLevel: "WATCH",
    setsColour: "ORANGE",
    family: "gas",
    advisory:
      "Gas chemistry implies a deeper, gas-rich source: fly a DOAS traverse and recompute the CO2/SO2 trend.",
  },
  {
    id: "R5-RAPID-INFLATION",
    statement: "Inflation rate at or above 5x10^5 m3/day",
    severity: "elevated",
    select: (i) => i.deformationRateM3PerDay,
    threshold: 5e5,
    comparison: ">=",
    setsLevel: "ADVISORY",
    setsColour: "YELLOW",
    family: "deformation",
    advisory: "ADVISORY: densify GNSS campaigns and re-run the geodetic inversion nightly.",
  },
  {
    id: "R6-ELEVATED-SO2",
    statement: "SO2 flux at or above 500 t/day",
    severity: "elevated",
    select: (i) => i.so2TonnesPerDay,
    threshold: 500,
    comparison: ">=",
    setsLevel: "ADVISORY",
    setsColour: "YELLOW",
    family: "gas",
    advisory: "ADVISORY: stand up daily gas measurements and publish them to the Situation Report.",
  },
  {
    id: "R7-THERMAL-RISE",
    statement: "At least 20 thermal alert pixels in 24 h",
    severity: "elevated",
    select: (i) => i.thermalPixels24h,
    threshold: 20,
    comparison: ">=",
    setsLevel: "ADVISORY",
    setsColour: "YELLOW",
    family: "thermal",
    advisory: "ADVISORY: order satellite thermal scenes for the next clear window.",
  },
  {
    id: "R8-VT-SWARM",
    statement: "At least 25 volcano-tectonic earthquakes in 24 h",
    severity: "elevated",
    select: (i) => i.vtEvents24h,
    threshold: 25,
    comparison: ">=",
    setsLevel: "ADVISORY",
    setsColour: "YELLOW",
    family: "seismic",
    advisory: "ADVISORY: run the daily earthquake catalogue and publish a swarm location.",
  },
  {
    id: "R9-DEFLATION-SETTLING",
    statement: "Sustained deflation below -1x10^5 m3/day after an eruption",
    severity: "info",
    select: (i) => i.deformationRateM3PerDay,
    threshold: -1e5,
    comparison: "<=",
    setsLevel: "NORMAL",
    setsColour: "GREEN",
    family: "deformation",
    advisory:
      "Deflation is decaying: keep the volcano at its background level but hold enhanced monitoring for one week.",
  },
  {
    id: "R10-QUIESCENT",
    statement: "All indicators within background",
    severity: "info",
    select: (i) => i.rsamRatio,
    threshold: 2,
    comparison: "<=",
    setsLevel: "NORMAL",
    setsColour: "GREEN",
    family: "seismic",
    advisory: "Background conditions: routine weekly reporting.",
  },
];

const LEVEL_RANK: Record<VolcanoAlertLevel, number> = {
  NORMAL: 0,
  ADVISORY: 1,
  WATCH: 2,
  WARNING: 3,
};
const COLOUR_RANK: Record<AviationColourCode, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

/** Evaluates one rule against the indicators. */
export function evaluateRule(rule: RuleSpec, indicators: UnrestIndicators): FiredRule {
  const value = rule.select(indicators);
  const fired = rule.comparison === ">=" ? value >= rule.threshold : value <= rule.threshold;
  return {
    id: rule.id,
    statement: rule.statement,
    value,
    threshold: rule.threshold,
    comparison: rule.comparison,
    severity: rule.severity,
    fired,
  };
}

/**
 * Turns measured indicators into an alert verdict with full provenance.
 *
 * Deterministic: the same indicators always produce the same verdict, the same
 * fired-rule order and the same advisories. No model call, no sampling.
 */
export function assessUnrest(indicators: UnrestIndicators): AlertAssessment {
  const evaluated = ALERT_RULES.map((rule) => evaluateRule(rule, indicators));
  const fired = evaluated.filter((rule) => rule.fired);
  const checked = evaluated.filter((rule) => !rule.fired);

  let level: VolcanoAlertLevel = "NORMAL";
  let colour: AviationColourCode = "GREEN";
  for (const rule of ALERT_RULES) {
    const firedRule = evaluated.find((candidate) => candidate.id === rule.id);
    if (firedRule?.fired) {
      if (LEVEL_RANK[rule.setsLevel] > LEVEL_RANK[level]) level = rule.setsLevel;
      if (COLOUR_RANK[rule.setsColour] > COLOUR_RANK[colour]) colour = rule.setsColour;
    }
  }

  const severityRank: Record<RuleSeverity, number> = { info: 0, elevated: 1, high: 2, extreme: 3 };
  fired.sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity] || a.id.localeCompare(b.id),
  );

  // Corroboration: how many distinct indicator families back the top level.
  const families = new Set(
    ALERT_RULES.filter((rule) => rule.setsLevel === level)
      .filter((rule) => evaluated.find((candidate) => candidate.id === rule.id)?.fired)
      .map((rule) => rule.family),
  );
  const maxFamilies = new Set(
    ALERT_RULES.filter((rule) => rule.setsLevel === level).map((rule) => rule.family),
  ).size;
  const confidence = maxFamilies === 0 ? 1 : families.size / maxFamilies;

  const advisories = fired
    .map((rule) => ALERT_RULES.find((spec) => spec.id === rule.id)?.advisory)
    .filter((text): text is string => typeof text === "string");

  return {
    volcanoAlertLevel: level,
    aviationColourCode: colour,
    firedRules: fired,
    checkedRules: checked,
    confidence,
    advisories,
    determinism: "deterministic",
  };
}

/** The Situation Report body a duty officer would paste into the bulletin. */
export function renderSituationReport(
  volcanoName: string,
  indicators: UnrestIndicators,
  assessment: AlertAssessment,
): string {
  const lines: string[] = [
    `SITUATION REPORT — ${volcanoName}`,
    `Alert level: ${assessment.volcanoAlertLevel} / ${assessment.aviationColourCode}`,
    `Confidence in the level: ${(assessment.confidence * 100).toFixed(0)}%`,
    "",
    "Indicators",
    `  deformation rate      ${indicators.deformationRateM3PerDay.toExponential(3)} m3/day`,
    `  source volume change  ${indicators.sourceVolumeChangeM3.toExponential(3)} m3`,
    `  RSAM ratio            ${indicators.rsamRatio.toFixed(2)}x background`,
    `  tremor frequency      ${indicators.tremorHz.toFixed(2)} Hz`,
    `  tremor band (1-5Hz)  ${indicators.tremorBandFraction.toFixed(3)} of power`,
    `  harmonic peaks        ${indicators.harmonicPeakCount}`,
    `  SO2 flux              ${indicators.so2TonnesPerDay.toFixed(0)} t/day`,
    `  C/S ratio             ${indicators.csMolarRatio.toFixed(1)}`,
    `  thermal pixels (24h)  ${indicators.thermalPixels24h}`,
    `  VT earthquakes (24h)  ${indicators.vtEvents24h}`,
    "",
    "Rules that fired",
  ];
  if (assessment.firedRules.length === 0) {
    lines.push("  (none — background)");
  } else {
    for (const rule of assessment.firedRules) {
      lines.push(
        `  ${rule.id} ${rule.statement} [${rule.value.toPrecision(4)} ${rule.comparison} ${rule.threshold.toPrecision(4)}]`,
      );
    }
  }
  lines.push("", "Advisories");
  for (const advisory of assessment.advisories) lines.push(`  - ${advisory}`);
  return lines.join("\n");
}
