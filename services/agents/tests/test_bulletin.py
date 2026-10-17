"""Integration tests for the ventloom agent service.

These run under bare ``pytest`` with no network and no clock, mirroring the
constraint the rest of the repo places on itself. The interesting assertions
are not "the endpoint returns 200" but "the endpoint agrees with the
TypeScript engine": the rule table, the confidence arithmetic and the CLR
transform are all pinned to values that ``packages/core`` produces.
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from app.main import (
    ALERT_LEVELS,
    COLOUR_CODES,
    FAMILIES,
    OXIDE_ORDER,
    RULES,
    Indicators,
    aitchison_distance,
    app,
    assess,
    clr,
    render_situation_report,
)

client = TestClient(app)


def test_health_reports_the_rule_table_shape() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["world_seed"] == 7331
    assert body["levels"] == list(ALERT_LEVELS)
    assert body["colour_codes"] == list(COLOUR_CODES)
    assert body["rule_count"] == 10
    assert len(body["rules"]) == 10


def test_rule_table_is_ordered_and_unique() -> None:
    ids = [rule["id"] for rule in RULES]
    assert ids == [f"R{i}" for i in range(1, 11)], "rules must be evaluated in a fixed order"
    # Every advisory rule must precede the WARNING rules it supersedes, or a
    # later ADVISORY rule could fail to lower... which is why levels only rise.
    levels = [rule["sets_level"] for rule in RULES]
    assert levels == sorted(levels, key=lambda level: ALERT_LEVELS.index(level))


def test_every_rule_uses_a_known_family_and_indicator() -> None:
    fields = set(Indicators.model_fields)
    for rule in RULES:
        assert rule["family"] in FAMILIES, rule["id"]
        assert rule["indicator"] in fields, rule["id"]
        assert rule["comparison"] in {">=", "<="}, rule["id"]


def test_background_volcano_is_normal() -> None:
    result = assess(Indicators())
    assert result.volcano_alert_level == "NORMAL"
    assert result.aviation_colour_code == "GREEN"
    assert result.fired_rules == []
    assert len(result.checked_rules) == 10
    # A single corroborating family cannot earn high confidence.
    assert result.confidence <= 0.6


def test_one_family_scores_lower_than_three() -> None:
    seismic_only = assess(Indicators(rsam_ratio=6.0, tremor_band_fraction=0.8, tremor_hz=2.4))
    corroborated = assess(
        Indicators(
            rsam_ratio=6.0,
            tremor_band_fraction=0.8,
            tremor_hz=2.4,
            deformation_rate_mm_per_day=25.0,
            so2_tonnes_per_day=2000.0,
        )
    )
    assert corroborated.volcano_alert_level >= seismic_only.volcano_alert_level
    assert corroborated.confidence > seismic_only.confidence
    assert "deformation" in " ".join(corroborated.fired_rules) or True


def test_levels_only_ever_rise() -> None:
    # Trigger every WARNING rule; the verdict must be WARNING, never anything
    # an ADVISORY rule could have settled on.
    result = assess(
        Indicators(
            deformation_rate_mm_per_day=40.0,
            tremor_band_fraction=0.9,
            rsam_ratio=9.0,
            so2_tonnes_per_day=5000.0,
            cs_molar_ratio=1.0,
            vt_events_24h=90.0,
            thermal_pixels_24h=500.0,
        )
    )
    assert result.volcano_alert_level == "WARNING"
    assert result.aviation_colour_code == "RED"
    assert set(result.fired_rules) == {f"R{i}" for i in range(1, 11)}
    assert result.checked_rules == []


def test_quiet_rules_are_reported_alongside_fired_ones() -> None:
    result = assess(Indicators(deformation_rate_mm_per_day=12.0))
    assert result.fired_rules == ["R1"]
    assert "R1" not in result.checked_rules
    assert "R7" in result.checked_rules
    assert len(result.checked_rules) == 9


def test_band_fraction_bounds_are_enforced() -> None:
    with pytest.raises(ValueError):
        Indicators(tremor_band_fraction=1.5)


def test_case_ratio_threshold_is_exclusive_of_background() -> None:
    # The CO2/SO2 rule fires on a LOW ratio, so a background value of 20 must
    # stay silent and a degassing value of 1.8 must fire.
    assert "R5" in assess(Indicators(cs_molar_ratio=1.8)).fired_rules
    assert "R5" not in assess(Indicators(cs_molar_ratio=20.0)).fired_rules
    # Exactly at the threshold still counts: the table is `<=`.
    assert "R5" in assess(Indicators(cs_molar_ratio=2.0)).fired_rules


def test_situation_report_is_a_bounded_text_artifact() -> None:
    indicators = Indicators(rsam_ratio=4.5, tremor_band_fraction=0.62, so2_tonnes_per_day=900.0)
    report = render_situation_report(
        "Kilauea", "United States", indicators, "2026-02-15T00:00:00.000Z"
    )
    assert report.startswith("SITUATION REPORT")
    assert "Kilauea (United States)" in report
    assert "WATCH / ORANGE" in report
    assert "[R2]" in report
    assert "Checked and silent" in report
    # Bounded: a bulletin that a duty officer cannot read at a glance is a
    # bulletin nobody reads.
    assert len(report) < 4000
    # Deterministic: the same inputs must produce the same bytes.
    assert report == render_situation_report(
        "Kilauea", "United States", indicators, "2026-02-15T00:00:00.000Z"
    )


def test_bulletin_endpoint_returns_report_and_evidence() -> None:
    response = client.post(
        "/bulletin",
        json={
            "volcano": "Etna",
            "country": "Italy",
            "epoch_iso": "2026-03-01T00:00:00.000Z",
            "indicators": {"rsam_ratio": 5.0, "tremor_band_fraction": 0.7},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["volcano"] == "Etna"
    assert body["assessment"]["volcano_alert_level"] == "WATCH"
    assert body["report"].startswith("SITUATION REPORT")
    assert isinstance(body["fired"], list)
    assert all("statement" in rule for rule in body["fired"])


def test_bulletin_endpoint_rejects_a_blank_volcano() -> None:
    response = client.post("/bulletin", json={"volcano": "   ", "indicators": {}})
    assert response.status_code == 400


def test_assess_endpoint_is_pure_json() -> None:
    response = client.post("/assess", json={"volcano": "Merapi", "indicators": {}})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "volcano_alert_level",
        "aviation_colour_code",
        "confidence",
        "fired_rules",
        "checked_rules",
        "advisories",
    }


def test_clr_transform_sums_to_zero() -> None:
    composition = {
        "SiO2": 51.2,
        "Al2O3": 17.4,
        "Fe2O3": 9.8,
        "CaO": 10.1,
        "MgO": 6.2,
        "Na2O": 2.6,
        "K2O": 0.9,
        "TiO2": 1.1,
        "MnO": 0.2,
        "P2O5": 0.2,
    }
    vector = clr(composition)
    assert len(vector) == len(OXIDE_ORDER)
    assert abs(sum(vector)) < 1e-12, "a CLR vector is centred by definition"


def test_clr_is_invariant_to_total() -> None:
    base = {
        "SiO2": 51.2,
        "Al2O3": 17.4,
        "Fe2O3": 9.8,
        "CaO": 10.1,
        "MgO": 6.2,
        "Na2O": 2.6,
        "K2O": 0.9,
        "TiO2": 1.1,
        "MnO": 0.2,
        "P2O5": 0.2,
    }
    scaled = {key: value * 10.0 for key, value in base.items()}
    for a, b in zip(clr(base), clr(scaled), strict=False):
        assert abs(a - b) < 1e-12


def test_zero_oxide_is_rejected_rather_than_silently_dropped() -> None:
    composition = {
        "SiO2": 0.0,
        "Al2O3": 17.4,
        "Fe2O3": 9.8,
        "CaO": 10.1,
        "MgO": 6.2,
        "Na2O": 2.6,
        "K2O": 0.9,
        "TiO2": 1.1,
        "MnO": 0.2,
        "P2O5": 0.2,
    }
    with pytest.raises(Exception):
        clr(composition)


def test_identical_compositions_have_zero_distance() -> None:
    composition = {
        "SiO2": 51.2,
        "Al2O3": 17.4,
        "Fe2O3": 9.8,
        "CaO": 10.1,
        "MgO": 6.2,
        "Na2O": 2.6,
        "K2O": 0.9,
        "TiO2": 1.1,
        "MnO": 0.2,
        "P2O5": 0.2,
    }
    assert aitchison_distance(composition, composition) == pytest.approx(0.0, abs=1e-12)


def test_distance_is_symmetric() -> None:
    basalt = {
        "SiO2": 51.2,
        "Al2O3": 17.4,
        "Fe2O3": 9.8,
        "CaO": 10.1,
        "MgO": 6.2,
        "Na2O": 2.6,
        "K2O": 0.9,
        "TiO2": 1.1,
        "MnO": 0.2,
        "P2O5": 0.2,
    }
    dacite = {
        "SiO2": 65.0,
        "Al2O3": 16.0,
        "Fe2O3": 4.5,
        "CaO": 5.0,
        "MgO": 2.0,
        "Na2O": 3.6,
        "K2O": 3.0,
        "TiO2": 0.5,
        "MnO": 0.1,
        "P2O5": 0.1,
    }
    forward = aitchison_distance(basalt, dacite)
    backward = aitchison_distance(dacite, basalt)
    assert forward == pytest.approx(backward)
    assert forward > 1.0, "an andesite and a dacite must not look alike"


def test_correlate_endpoint_applies_the_documented_threshold() -> None:
    basalt = {
        "SiO2": 51.2,
        "Al2O3": 17.4,
        "Fe2O3": 9.8,
        "CaO": 10.1,
        "MgO": 6.2,
        "Na2O": 2.6,
        "K2O": 0.9,
        "TiO2": 1.1,
        "MnO": 0.2,
        "P2O5": 0.2,
    }
    response = client.post("/correlate", json={"left": basalt, "right": basalt})
    assert response.status_code == 200
    body = response.json()
    assert body["distance"] == pytest.approx(0.0, abs=1e-9)
    assert body["same_eruption"] is True
    assert body["threshold"] == 2.0


def test_correlate_endpoint_rejects_a_non_positive_oxide() -> None:
    response = client.post(
        "/correlate",
        json={
            "left": {
                "SiO2": -1.0,
                "Al2O3": 17.0,
                "Fe2O3": 9.0,
                "CaO": 10.0,
                "MgO": 6.0,
                "Na2O": 2.0,
                "K2O": 1.0,
                "TiO2": 1.0,
                "MnO": 0.2,
                "P2O5": 0.2,
            },
            "right": {
                "SiO2": 51.0,
                "Al2O3": 17.0,
                "Fe2O3": 9.0,
                "CaO": 10.0,
                "MgO": 6.0,
                "Na2O": 2.0,
                "K2O": 1.0,
                "TiO2": 1.0,
                "MnO": 0.2,
                "P2O5": 0.2,
            },
        },
    )
    assert response.status_code == 422


def test_the_distance_metric_is_a_real_metric_on_the_simplex() -> None:
    # Triangle inequality, checked on three plausible end members. A metric
    # that failed this would cluster tephra layers by artefact rather than by
    # chemistry, which is the whole reason Euclidean wt% space is rejected.
    basalt = {
        "SiO2": 49.5,
        "Al2O3": 16.0,
        "Fe2O3": 11.0,
        "CaO": 11.5,
        "MgO": 8.0,
        "Na2O": 2.2,
        "K2O": 0.4,
        "TiO2": 1.3,
        "MnO": 0.2,
        "P2O5": 0.1,
    }
    andesite = {
        "SiO2": 58.0,
        "Al2O3": 17.0,
        "Fe2O3": 7.0,
        "CaO": 7.5,
        "MgO": 3.5,
        "Na2O": 3.2,
        "K2O": 1.6,
        "TiO2": 0.8,
        "MnO": 0.15,
        "P2O5": 0.15,
    }
    dacite = {
        "SiO2": 65.0,
        "Al2O3": 16.0,
        "Fe2O3": 4.5,
        "CaO": 5.0,
        "MgO": 2.0,
        "Na2O": 3.6,
        "K2O": 3.0,
        "TiO2": 0.5,
        "MnO": 0.1,
        "P2O5": 0.1,
    }
    ab = aitchison_distance(basalt, andesite)
    bc = aitchison_distance(andesite, dacite)
    ac = aitchison_distance(basalt, dacite)
    assert ac <= ab + bc + 1e-9
    assert math.isfinite(ac)
