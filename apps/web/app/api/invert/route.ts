import { type Displacement, mogiInvert, type StationOffset } from "@repo/core";
import { NextResponse } from "next/server";

/**
 * Dynamic by definition: a POST whose answer depends on its body cannot be
 * prerendered. Stated rather than left implicit so the next reader does not
 * try to optimise it into a static route.
 */
export const dynamic = "force-dynamic";

/** Maximum stations accepted in one request. A real campaign is smaller. */
const MAX_STATIONS = 200;

interface InvertBody {
  stations?: unknown;
  observations?: unknown;
  poisson?: unknown;
  sigmaM?: unknown;
  initial?: unknown;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Reject a station that carries no deformation vector.
 *
 * A seismometer and an infrasound array sit at real coordinates and report
 * `{0, 0, 0}`, which is indistinguishable from a genuinely still GNSS site. The
 * solver cannot tell them apart either, and it will happily fit them, which
 * pulls the answer tens of percent away from the truth while still reporting
 * `converged: true`. Catching it at the boundary is the only place where the
 * instrument type is still known.
 */
function assertGeodetic(stations: readonly StationOffset[]): void {
  const offenders = stations
    .map((station, index) => ({ index, station }))
    .filter(({ station }) => {
      const instrument = (station as { instrument?: unknown }).instrument;
      return instrument !== undefined && instrument !== "gnss";
    })
    .map(({ index, station }) => `#${index} (${(station as { code?: string }).code ?? "?"})`);
  if (offenders.length > 0) {
    throw new RangeError(
      `only GNSS stations carry a deformation field; received ${offenders.join(", ")}. ` +
        "POST /api/invert with the `geodeticStations` array from GET /api/network instead.",
    );
  }
}

/** Reject a non-finite component before the solver turns it into a silent NaN. */
function assertFiniteDisplacements(
  observations: readonly Displacement[],
  stations: readonly StationOffset[],
): void {
  for (let i = 0; i < observations.length; i++) {
    const o = observations[i] as Displacement | undefined;
    const values = [o?.eastM, o?.northM, o?.upM];
    if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) {
      const code = (stations[i] as { code?: string } | undefined)?.code ?? `#${i}`;
      throw new RangeError(
        `observation ${code} must have finite eastM, northM and upM; a null displacement ` +
          "means the instrument does not measure ground deformation",
      );
    }
  }
}

/** Reject a station whose geometry is unusable. */
function assertFiniteGeometry(stations: readonly StationOffset[]): void {
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i] as StationOffset | undefined;
    if (
      typeof s?.eastOffsetM !== "number" ||
      !Number.isFinite(s.eastOffsetM) ||
      typeof s?.northOffsetM !== "number" ||
      !Number.isFinite(s.northOffsetM)
    ) {
      const code = (s as { code?: string } | undefined)?.code ?? `#${i}`;
      throw new RangeError(`station ${code} must have finite eastOffsetM and northOffsetM`);
    }
  }
}

/**
 * `POST /api/invert` - run the Mogi inversion over a caller-supplied field.
 *
 * The body is the same shape the geodesy surface renders, so a reader can copy
 * the network out of `/api/network`, perturb it, and post it back. Validation is
 * deliberately strict: a silently accepted malformed field would produce a
 * confident-looking wrong answer, which is the one failure mode this app cannot
 * have.
 */
export async function POST(request: Request) {
  let body: InvertBody;
  try {
    body = (await request.json()) as InvertBody;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.stations) || !Array.isArray(body.observations)) {
    return NextResponse.json(
      { error: "body must contain `stations` and `observations` arrays" },
      { status: 400 },
    );
  }
  if (body.stations.length !== body.observations.length) {
    return NextResponse.json(
      {
        error: `station count ${body.stations.length} does not match observation count ${body.observations.length}`,
      },
      { status: 400 },
    );
  }
  if (body.stations.length === 0) {
    return NextResponse.json(
      { error: "at least two three-component observations are required" },
      { status: 400 },
    );
  }
  if (body.stations.length > MAX_STATIONS) {
    return NextResponse.json(
      { error: `at most ${MAX_STATIONS} stations per request` },
      { status: 413 },
    );
  }

  try {
    const stations = body.stations as StationOffset[];
    const observations = body.observations as Displacement[];
    assertGeodetic(stations);
    assertFiniteGeometry(stations);
    assertFiniteDisplacements(observations, stations);
    const result = mogiInvert(stations, observations, {
      poisson: numberOr(body.poisson, 0.25),
      sigmaM: numberOr(body.sigmaM, 0.005),
    });
    return NextResponse.json(
      {
        source: result.source,
        diagnostics: {
          rmsMisfitM: result.rmsMisfitM,
          chiSquared: result.chiSquared,
          degreesOfFreedom: result.degreesOfFreedom,
          iterations: result.iterations,
          converged: result.converged,
          terminationReason: result.terminationReason,
          parameterSigmas: result.parameterSigmas,
          parameterCorrelations: result.parameterCorrelations,
          depthVolumeTradeOff: result.depthVolumeTradeOff,
          conditionNumber: result.conditionNumber,
          costHistory: result.costHistory,
          varianceReduction: result.varianceReduction,
        },
        residuals: result.residuals,
        predicted: result.predicted,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
