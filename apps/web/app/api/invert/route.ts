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
 * `POST /api/invert` â€” run the Mogi inversion over a caller-supplied field.
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
