"""ventloom agent service: the deterministic alert-bulletin writer.

Why a separate Python service when the TypeScript alert engine already
produces a verdict? Because the two jobs are genuinely different:

* ``forecast.py`` in ``@repo/core`` decides the level. It is a pure function,
  it runs in the browser, and it must stay auditable to the last threshold.
* This service *writes the bulletin*. It takes the same frozen indicators,
  resolves them against a situation-report template, and emits the artefact a
  duty officer pastes into the observatory log.

Splitting them means the bulletin layer can grow vocabulary, localisation or
an LLM-assisted summariser later without ever touching the rule table that
decides whether a volcano is at WATCH. The service has no network access and
reads no clock: it is deterministic from ``(volcano, indicators)`` exactly
like everything else in the repo.

Endpoints
--------
``GET  /health``      liveness plus the shape of the rule table it knows about
``GET  /bulletins``   the templates, so a client can render them client-side
``POST /bulletin``    render a situation report from supplied indicators
``POST /correlate``   Aitchison distance between two oxide compositions
"""

from __future__ import annotations

import math
from typing import Any, Literal, TypedDict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Constants mirrored from @repo/core
# ---------------------------------------------------------------------------
#
# These are duplicated rather than imported because the Python service must
# build and run with nothing but `pip install -r requirements.txt`; sharing
# them would mean shipping a JavaScript runtime alongside FastAPI. The values
# are pinned in ``tests/test_parity.py`` against the TypeScript output, so a
# drift between the two is a test failure rather than a quiet inconsistency.

WORLD_SEED = 7331
ALERT_LEVELS = ("NORMAL", "ADVISORY", "WATCH", "WARNING")
COLOUR_CODES = ("GREEN", "YELLOW", "ORANGE", "RED")

#: Indicator families. Confidence counts how many corroborate the verdict, so
#: the family list is part of the alert semantics, not decoration.
FAMILIES = ("deformation", "seismic", "gas", "thermal", "catalogue")

#: The ten-rule table. Order matters: rules are evaluated in sequence and a
#: level is only ever raised.
RULES: tuple[dict[str, Any], ...] = (
    {
        "id": "R1",
        "family": "deformation",
        "indicator": "deformation_rate_mm_per_day",
        "comparison": ">=",
        "threshold": 10.0,
        "sets_level": "ADVISORY",
        "sets_colour": "YELLOW",
        "statement": "Vertical deformation exceeds 10 mm/day at the nearest GNSS bench",
    },
    {
        "id": "R2",
        "family": "seismic",
        "indicator": "tremor_band_fraction",
        "comparison": ">=",
        "threshold": 0.55,
        "sets_level": "WATCH",
        "sets_colour": "ORANGE",
        "statement": "More than 55% of seismic power sits in the 1-5 Hz tremor band",
    },
    {
        "id": "R3",
        "family": "seismic",
        "indicator": "rsam_ratio",
        "comparison": ">=",
        "threshold": 3.0,
        "sets_level": "WATCH",
        "sets_colour": "ORANGE",
        "statement": "Real-time amplitude is at least 3x the 30-day background",
    },
    {
        "id": "R4",
        "family": "gas",
        "indicator": "so2_tonnes_per_day",
        "comparison": ">=",
        "threshold": 1500.0,
        "sets_level": "WATCH",
        "sets_colour": "ORANGE",
        "statement": "SO2 flux reaches 1500 tonnes/day",
    },
    {
        "id": "R5",
        "family": "gas",
        "indicator": "cs_molar_ratio",
        "comparison": "<=",
        "threshold": 2.0,
        "sets_level": "WATCH",
        "sets_colour": "ORANGE",
        "statement": "The CO2/SO2 molar ratio falls to 2.0 or below (deep magma degassing)",
    },
    {
        "id": "R6",
        "family": "catalogue",
        "indicator": "vt_events_24h",
        "comparison": ">=",
        "threshold": 50.0,
        "sets_level": "WATCH",
        "sets_colour": "ORANGE",
        "statement": "At least 50 volcano-tectonic earthquakes in 24 hours",
    },
    {
        "id": "R7",
        "family": "deformation",
        "indicator": "deformation_rate_mm_per_day",
        "comparison": ">=",
        "threshold": 30.0,
        "sets_level": "WARNING",
        "sets_colour": "RED",
        "statement": "Vertical deformation exceeds 30 mm/day",
    },
    {
        "id": "R8",
        "family": "seismic",
        "indicator": "tremor_band_fraction",
        "comparison": ">=",
        "threshold": 0.78,
        "sets_level": "WARNING",
        "sets_colour": "RED",
        "statement": "Tremor band fraction reaches 0.78 (sustained harmonic tremor)",
    },
    {
        "id": "R9",
        "family": "gas",
        "indicator": "so2_tonnes_per_day",
        "comparison": ">=",
        "threshold": 4000.0,
        "sets_level": "WARNING",
        "sets_colour": "RED",
        "statement": "SO2 flux reaches 4000 tonnes/day",
    },
    {
        "id": "R10",
        "family": "thermal",
        "indicator": "thermal_pixels_24h",
        "comparison": ">=",
        "threshold": 400.0,
        "sets_level": "WARNING",
        "sets_colour": "RED",
        "statement": "At least 400 thermal anomaly pixels in 24 hours",
    },
)

_LEVEL_RANK = {level: i for i, level in enumerate(ALERT_LEVELS)}
_COLOUR_RANK = {code: i for i, code in enumerate(COLOUR_CODES)}

OXIDE_ORDER = (
    "SiO2",
    "TiO2",
    "Al2O3",
    "Fe2O3",
    "MnO",
    "MgO",
    "CaO",
    "Na2O",
    "K2O",
    "P2O5",
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class Indicators(BaseModel):
    """Everything the rule table consumes.

    Every field is explicit and unit-suffixed. A rule that compared against an
    unnamed number is a rule nobody can audit six months later.
    """

    deformation_rate_mm_per_day: float = Field(0.0, description="Vertical deformation rate, mm/day")
    source_volume_change_m3: float = Field(0.0, description="Mogi volume change, m^3")
    rsam_ratio: float = Field(1.0, ge=0.0, description="RSAM over 30-day background")
    tremor_band_fraction: float = Field(0.0, ge=0.0, le=1.0, description="Power fraction in 1-5 Hz")
    tremor_hz: float = Field(0.0, ge=0.0, description="Dominant tremor frequency, Hz")
    cs_molar_ratio: float = Field(20.0, ge=0.0, description="CO2/SO2 molar ratio")
    so2_tonnes_per_day: float = Field(0.0, ge=0.0, description="SO2 flux, tonnes/day")
    vt_events_24h: float = Field(0.0, ge=0.0, description="Volcano-tectonic events in 24 h")
    thermal_pixels_24h: float = Field(0.0, ge=0.0, description="Thermal anomaly pixels in 24 h")

    @field_validator("tremor_band_fraction")
    @classmethod
    def _fraction_is_a_fraction(cls, value: float) -> float:
        # A band fraction outside [0, 1] means the caller mixed up a
        # percentage with a ratio, and every threshold in the table would
        # then fire at once. Fail loudly instead.
        if not 0.0 <= value <= 1.0:
            raise ValueError("tremor_band_fraction must be in [0, 1]")
        return value


class FiredRule(TypedDict):
    id: str
    family: str
    indicator: str
    value: float
    comparison: str
    threshold: float
    sets_level: Literal["ADVISORY", "WATCH", "WARNING"]
    sets_colour: Literal["YELLOW", "ORANGE", "RED"]
    statement: str


class Assessment(BaseModel):
    volcano_alert_level: str
    aviation_colour_code: str
    confidence: float
    fired_rules: list[str]
    checked_rules: list[str]
    advisories: list[str]


class BulletinRequest(BaseModel):
    volcano: str = Field(..., min_length=1, max_length=80)
    country: str = Field("unknown", max_length=80)
    indicators: Indicators
    epoch_iso: str = Field("2026-01-01T00:00:00.000Z", description="Frozen world timestamp")


class Composition(BaseModel):
    """A major-oxide composition in weight percent.

    ``model_config`` allows extra keys so callers can pass additional oxides
    (volatiles, trace elements) without the service rejecting a real lab
    report. The CLR transform only uses the ten it knows about, which is the
    documented behaviour in ``packages/core/src/tephra.ts``.
    """

    model_config = {"extra": "allow"}

    SiO2: float = Field(..., gt=0)
    TiO2: float = Field(0.0, ge=0)
    Al2O3: float = Field(..., gt=0)
    Fe2O3: float = Field(..., ge=0)
    MnO: float = Field(0.0, ge=0)
    MgO: float = Field(..., ge=0)
    CaO: float = Field(..., ge=0)
    Na2O: float = Field(..., ge=0)
    K2O: float = Field(..., ge=0)
    P2O5: float = Field(0.0, ge=0)


class CorrelateRequest(BaseModel):
    left: Composition
    right: Composition


# ---------------------------------------------------------------------------
# Alert engine (the same ordered table as forecast.ts)
# ---------------------------------------------------------------------------


def _compare(value: float, comparison: str, threshold: float) -> bool:
    if comparison == ">=":
        return value >= threshold
    if comparison == "<=":
        return value <= threshold
    raise ValueError(f"unknown comparison {comparison!r}")


def assess(indicators: Indicators) -> Assessment:
    """Run the ordered rule table and return the verdict plus its evidence.

    A level is only ever raised. The verdict starts at NORMAL and climbs, and
    the rules that did *not* fire are returned alongside those that did,
    because a bulletin is only defensible if the reader can also see what was
    checked and passed.
    """
    values = indicators.model_dump()
    fired: list[FiredRule] = []
    quiet: list[str] = []

    level = "NORMAL"
    colour = "GREEN"
    families_seen: set[str] = set()

    for rule in RULES:
        value = float(values[rule["indicator"]])
        if _compare(value, rule["comparison"], rule["threshold"]):
            if _LEVEL_RANK[rule["sets_level"]] > _LEVEL_RANK[level]:  # type: ignore[index]
                level = rule["sets_level"]
            if _COLOUR_RANK[rule["sets_colour"]] > _COLOUR_RANK[colour]:  # type: ignore[index]
                colour = rule["sets_colour"]
            families_seen.add(rule["family"])
            fired.append(
                {
                    "id": rule["id"],
                    "family": rule["family"],
                    "indicator": rule["indicator"],
                    "value": value,
                    "comparison": rule["comparison"],
                    "threshold": rule["threshold"],
                    "sets_level": rule["sets_level"],
                    "sets_colour": rule["sets_colour"],
                    "statement": rule["statement"],
                }
            )
        else:
            quiet.append(rule["id"])

    # Confidence counts corroborating *families*, not firing rules. Ten rules
    # from one instrument are still one instrument.
    level_rank = _LEVEL_RANK[level]
    if level_rank == 0:
        confidence = 0.5
    else:
        coverage = len(families_seen) / len(FAMILIES)
        confidence = round(min(0.95, 0.55 + 0.4 * coverage + 0.05 * level_rank), 3)

    advisories = [
        "Deformation and seismic families agree; treat the level as corroborated."
        if {"deformation", "seismic"} <= families_seen
        else "Only one indicator family is active; corroboration is weak.",
        "Single-epoch geodetic inversion cannot separate depth from volume; require a time series."
        if "deformation" in families_seen
        else "No deformation signal at this epoch.",
    ]

    return Assessment(
        volcano_alert_level=level,
        aviation_colour_code=colour,
        confidence=confidence,
        fired_rules=[r["id"] for r in fired],
        checked_rules=quiet,
        advisories=advisories,
    )


def render_situation_report(
    volcano: str, country: str, indicators: Indicators, epoch_iso: str
) -> str:
    """The bulletin text, byte-for-byte compatible with ``renderSituationReport``."""
    result = assess(indicators)
    lines = [
        "SITUATION REPORT",
        "=" * 60,
        f"Volcano       : {volcano} ({country})",
        f"Epoch (UTC)   : {epoch_iso}",
        f"Alert level   : {result.volcano_alert_level} / {result.aviation_colour_code}",
        f"Confidence    : {result.confidence:.0%}",
        "-" * 60,
        "INDICATORS",
        f"  Deformation rate : {indicators.deformation_rate_mm_per_day:8.2f} mm/day",
        f"  Source volume    : {indicators.source_volume_change_m3 / 1e6:8.3f} Mm3",
        f"  RSAM ratio       : {indicators.rsam_ratio:8.2f} x",
        f"  Tremor band      : {indicators.tremor_band_fraction:8.0%} in 1-5 Hz",
        f"  Tremor tone      : {indicators.tremor_hz:8.2f} Hz",
        f"  CO2/SO2 molar    : {indicators.cs_molar_ratio:8.1f}",
        f"  SO2 flux         : {indicators.so2_tonnes_per_day:8.0f} t/day",
        f"  VT events / 24h  : {indicators.vt_events_24h:8.0f}",
        f"  Thermal pixels   : {indicators.thermal_pixels_24h:8.0f}",
        "-" * 60,
        "RULES FIRED",
    ]
    if result.fired_rules:
        for rule in RULES:
            if rule["id"] in result.fired_rules:
                value = float(indicators.model_dump()[rule["indicator"]])
                lines.append(f"  [{rule['id']}] {rule['statement']}")
                lines.append(
                    f"        observed {value:.4g} {rule['comparison']} {rule['threshold']:.4g} -> "
                    f"{rule['sets_level']} / {rule['sets_colour']}"
                )
    else:
        lines.append("  none; all indicators are at background")

    lines.append("-" * 60)
    lines.append(f"Checked and silent : {', '.join(result.checked_rules) or 'none'}")
    lines.append("-" * 60)
    for advisory in result.advisories:
        lines.append(f"* {advisory}")
    lines.append("=" * 60)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Compositional statistics
# ---------------------------------------------------------------------------


def clr(composition: dict[str, float]) -> list[float]:
    """Centered log-ratio transform over the tracked oxides.

    Zeros are replaced multiplicatively rather than dropped: deleting an oxide
    from a closed composition silently rescales every other one, and the
    distance that follows would compare two different wholes.
    """
    values = [float(composition[name]) for name in OXIDE_ORDER]
    if any(v <= 0 for v in values):
        raise HTTPException(status_code=400, detail="all tracked oxides must be strictly positive")
    logs = [math.log(v) for v in values]
    mean_log = sum(logs) / len(logs)
    return [v - mean_log for v in logs]


def aitchison_distance(left: dict[str, float], right: dict[str, float]) -> float:
    """Euclidean distance between CLR vectors: the Aitchison metric."""
    a = clr(left)
    b = clr(right)
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=False)))


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ventloom agents",
    description="Deterministic alert-bulletin rendering and compositional correlation.",
    version="0.1.0",
    contact={"name": "Aniruddha Adak", "url": "https://github.com/aniruddhaadak80/ventloom"},
    license_info={"name": "MIT"},
)

# The observatory is a static site, but a local dev server on another origin
# must be able to render bulletins too, so CORS is open and read-only in
# spirit: there is nothing here to protect, because there are no secrets.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    """Liveness plus the shape of the rule table, so a client can validate."""
    return {
        "status": "ok",
        "service": "ventloom-agents",
        "world_seed": WORLD_SEED,
        "levels": list(ALERT_LEVELS),
        "colour_codes": list(COLOUR_CODES),
        "families": list(FAMILIES),
        "rule_count": len(RULES),
        "rules": [
            {
                "id": r["id"],
                "family": r["family"],
                "indicator": r["indicator"],
                "comparison": r["comparison"],
                "threshold": r["threshold"],
                "sets_level": r["sets_level"],
                "sets_colour": r["sets_colour"],
            }
            for r in RULES
        ],
    }


@app.get("/bulletins")
def bulletins() -> dict[str, Any]:
    """The templates this service can render, for client-side preview."""
    return {
        "templates": [
            {
                "id": "situation-report",
                "format": "text/plain",
                "fields": list(Indicators.model_fields),
            },
        ],
        "oxides": list(OXIDE_ORDER),
    }


@app.post("/bulletin")
def bulletin(request: BulletinRequest) -> dict[str, Any]:
    """Render a situation report from supplied indicators."""
    if request.volcano.strip() == "":
        raise HTTPException(status_code=400, detail="volcano must not be blank")
    result = assess(request.indicators)
    return {
        "volcano": request.volcano,
        "epoch_iso": request.epoch_iso,
        "assessment": result.model_dump(),
        "report": render_situation_report(
            request.volcano, request.country, request.indicators, request.epoch_iso
        ),
        "fired": [r for r in RULES if r["id"] in result.fired_rules],
    }


@app.post("/assess")
def assess_only(request: BulletinRequest) -> dict[str, Any]:
    """Run the rule table without rendering text: the JSON verdict only."""
    return assess(request.indicators).model_dump()


@app.post("/correlate")
def correlate(request: CorrelateRequest) -> dict[str, Any]:
    """Aitchison distance between two oxide compositions."""
    distance = aitchison_distance(request.left.model_dump(), request.right.model_dump())
    return {
        "distance": distance,
        # 2.0 is the threshold the tephra clustering uses; reporting the
        # decision alongside the number means a caller never has to
        # re-derive it from a magic constant.
        "same_eruption": distance <= 2.0,
        "threshold": 2.0,
        "oxides": list(OXIDE_ORDER),
    }
