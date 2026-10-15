# ventloom agents

The bulletin layer: it takes the same frozen indicators the TypeScript alert
engine consumes, runs the same ordered rule table, and renders the situation
report a duty officer pastes into the observatory log.

## Why a separate service

The split is deliberate and worth understanding before changing either half:

| Half | Lives in | Job |
| ---- | -------- | --- |
| Alert **decision** | `packages/core/src/forecast.ts` | Decide the level. Pure, auditable to the last threshold, runs in the browser. |
| Alert **bulletin** | `services/agents` | Render the artefact. Text, evidence, corroboration commentary. |

The Python service has **no network access and reads no clock**. It is a pure
function of `(volcano, indicators)`, exactly like the rest of the repo, so two
runs of the same request produce byte-identical reports.

## Run it

```bash
cd services/agents
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # POSIX
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then:

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/bulletin \
  -H "content-type: application/json" \
  -d '{"volcano":"Etna","country":"Italy","indicators":{"rsam_ratio":5.0,"tremor_band_fraction":0.7}}'
```

## Test it

```bash
pip install -e ".[dev]"
pytest
ruff check .
mypy
```

## Endpoints

| Method | Path          | Purpose                                                    |
| ------ | ------------- | ---------------------------------------------------------- |
| GET    | `/health`     | Liveness plus the shape of the rule table it knows about    |
| GET    | `/bulletins`  | The templates it can render, for client-side preview        |
| POST   | `/bulletin`   | Render a situation report from supplied indicators          |
| POST   | `/assess`     | The JSON verdict only, with no text rendering               |
| POST   | `/correlate`  | Aitchison distance between two major-oxide compositions     |

OpenAPI is served at `/docs` by FastAPI, generated from the pydantic models.

## The rule table

Ten rules, evaluated in order, and a level is only ever **raised**. Confidence
counts corroborating *families* (deformation, seismic, gas, thermal, catalogue)
rather than firing rules, because ten alarms from one instrument are still one
instrument.

| Rule | Family       | Indicator                       | Comparison | Threshold | Sets       |
| ---- | ------------ | ------------------------------- | ---------- | --------- | ---------- |
| R1   | deformation  | `deformation_rate_mm_per_day`   | `>=`       | 10.0      | ADVISORY   |
| R2   | seismic      | `tremor_band_fraction`          | `>=`       | 0.55      | WATCH      |
| R3   | seismic      | `rsam_ratio`                    | `>=`       | 3.0       | WATCH      |
| R4   | gas          | `so2_tonnes_per_day`            | `>=`       | 1500.0    | WATCH      |
| R5   | gas          | `cs_molar_ratio`                | `<=`       | 2.0       | WATCH      |
| R6   | catalogue    | `vt_events_24h`                 | `>=`       | 50.0      | WATCH      |
| R7   | deformation  | `deformation_rate_mm_per_day`   | `>=`       | 30.0      | WARNING    |
| R8   | seismic      | `tremor_band_fraction`          | `>=`       | 0.78      | WARNING    |
| R9   | gas          | `so2_tonnes_per_day`            | `>=`       | 4000.0    | WARNING    |
| R10   | thermal      | `thermal_pixels_24h`            | `>=`       | 400.0     | WARNING    |

The same table exists in TypeScript. `tests/test_bulletin.py` pins the values,
so drift between the two is a test failure rather than a quiet inconsistency.

## Compositional correlation

`POST /correlate` computes the **Aitchison distance** between two major-oxide
compositions. Euclidean distance in weight-percent space is rejected outright:
a composition is *closed* (the oxides sum to 100 %), so increasing one
silently decreases every other. The centered log-ratio transform removes that
artifact, and the documented threshold of `2.0` is reported alongside the
distance so a caller never re-derives it from a magic constant.
