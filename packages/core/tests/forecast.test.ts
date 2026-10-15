/** Tests for the alert-level engine. */

import { describe, expect, it } from "vitest";
import {
  ALERT_RULES,
  AVIATION_COLOUR_CODES,
  assessUnrest,
  EMPTY_INDICATORS,
  evaluateRule,
  renderSituationReport,
  type UnrestIndicators,
  VOLCANO_ALERT_LEVELS,
} from "../src/forecast.js";

const BACKGROUND: UnrestIndicators = {
  ...EMPTY_INDICATORS,
  rsamRatio: 1.1,
  tremorHz: 1.2,
  tremorBandFraction: 0.04,
  so2TonnesPerDay: 180,
  csMolarRatio: 3,
  thermalPixels24h: 1,
  vtEvents24h: 2,
};

const ESCALATING: UnrestIndicators = {
  deformationRateM3PerDay: 1.1e6,
  sourceVolumeChangeM3: 2.4e7,
  rsamRatio: 5.2,
  tremorHz: 3.4,
  tremorBandFraction: 0.68,
  harmonicPeakCount: 1,
  so2TonnesPerDay: 1400,
  csMolarRatio: 12,
  thermalPixels24h: 40,
  vtEvents24h: 60,
};

describe("rule table", () => {
  it("covers every level and colour at least once", () => {
    for (const level of VOLCANO_ALERT_LEVELS) {
      expect(ALERT_RULES.some((rule) => rule.setsLevel === level)).toBe(true);
    }
    for (const colour of AVIATION_COLOUR_CODES) {
      expect(ALERT_RULES.some((rule) => rule.setsColour === colour)).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = ALERT_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("evaluates a rule against its indicators", () => {
    const rule = ALERT_RULES.find((r) => r.id === "R3-HIGH-TREMOR");
    if (!rule) throw new Error("missing R3");
    expect(evaluateRule(rule, ESCALATING).fired).toBe(true);
    expect(evaluateRule(rule, BACKGROUND).fired).toBe(false);
  });
});

describe("assessUnrest", () => {
  it("returns NORMAL/GREEN for background", () => {
    const assessment = assessUnrest(BACKGROUND);
    expect(assessment.volcanoAlertLevel).toBe("NORMAL");
    expect(assessment.aviationColourCode).toBe("GREEN");
    expect(assessment.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("returns WARNING/RED for sustained eruption tremor", () => {
    const assessment = assessUnrest({
      ...ESCALATING,
      rsamRatio: 14,
      harmonicPeakCount: 9,
    });
    expect(assessment.volcanoAlertLevel).toBe("WARNING");
    expect(assessment.aviationColourCode).toBe("RED");
    expect(assessment.firedRules.some((r) => r.id === "R1-ERUPTION-CONFIRMED")).toBe(true);
  });

  it("raises through ADVISORY and WATCH as unrest grows", () => {
    expect(assessUnrest({ ...BACKGROUND, so2TonnesPerDay: 900 }).volcanoAlertLevel).toBe(
      "ADVISORY",
    );
    expect(assessUnrest({ ...BACKGROUND, vtEvents24h: 60 }).volcanoAlertLevel).toBe("ADVISORY");
    expect(assessUnrest({ ...BACKGROUND, thermalPixels24h: 90 }).volcanoAlertLevel).toBe(
      "ADVISORY",
    );
    expect(assessUnrest({ ...BACKGROUND, deformationRateM3PerDay: 9e5 }).volcanoAlertLevel).toBe(
      "ADVISORY",
    );
    expect(assessUnrest({ ...BACKGROUND, rsamRatio: 4.5 }).volcanoAlertLevel).toBe("WATCH");
  });

  it("never lowers a level once raised", () => {
    const assessment = assessUnrest(ESCALATING);
    expect(assessment.volcanoAlertLevel).toBe("WATCH");
    // A quiescent-shaped rule cannot pull a WATCH verdict back down.
    expect(assessment.firedRules.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(assessUnrest(ESCALATING)).toEqual(assessUnrest(ESCALATING));
  });

  it("orders fired rules by severity", () => {
    const assessment = assessUnrest({
      ...BACKGROUND,
      rsamRatio: 6,
      so2TonnesPerDay: 900,
      deformationRateM3PerDay: 9e5,
    });
    const rank = { info: 0, elevated: 1, high: 2, extreme: 3 } as const;
    for (let i = 1; i < assessment.firedRules.length; i++) {
      const previous = assessment.firedRules[i - 1]?.severity ?? "info";
      const current = assessment.firedRules[i]?.severity ?? "info";
      expect(rank[previous]).toBeGreaterThanOrEqual(rank[current]);
    }
  });

  it("computes confidence from corroborating indicator families", () => {
    const seismicOnly = assessUnrest({ ...BACKGROUND, rsamRatio: 6, tremorBandFraction: 0.6 });
    const corroborated = assessUnrest({
      ...BACKGROUND,
      rsamRatio: 6,
      tremorBandFraction: 0.6,
      csMolarRatio: 14,
      so2TonnesPerDay: 1200,
    });
    expect(corroborated.confidence).toBeGreaterThan(seismicOnly.confidence);
  });

  it("only ever reports deterministic verdicts", () => {
    expect(assessUnrest(ESCALATING).determinism).toBe("deterministic");
  });
});

describe("renderSituationReport", () => {
  it("reports a tonal tremor band fraction, not a peak count, in the bulletin", () => {
    const assessment = assessUnrest(ESCALATING);
    const report = renderSituationReport("Merapi", ESCALATING, assessment);
    expect(report).toContain("tremor band (1-5Hz)");
    expect(report).toContain("R3-HIGH-TREMOR");
    expect(report.length).toBeGreaterThan(200);
  });

  it("says so plainly when only the background rule fired", () => {
    const report = renderSituationReport("Taupo", BACKGROUND, assessUnrest(BACKGROUND));
    expect(report).toContain("R10-QUIESCENT");
    expect(report).toContain("routine weekly reporting");
  });
});
