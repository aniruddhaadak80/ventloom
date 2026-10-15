import { assessUnrest, networkSnapshot, unrestIndicators } from "@repo/core";
import { STATION_NETWORK, VOLCANO_CATALOGUE } from "@repo/seed";
import { NextResponse } from "next/server";
import { MAX_EPOCH_S, readEpoch } from "../../../lib/epoch";

/**
 * Dynamic: the epoch is a query parameter, so the answer is not fixed at
 * build time. See `app/api/displacement/route.ts` for why `force-static` on a
 * parameterised route is worse than no directive at all.
 */
export const dynamic = "force-dynamic";

/**
 * `GET /api/network?epoch=<seconds>` — the whole observatory at one epoch.
 *
 * This is the payload the SDK is written against, so it is the de facto
 * contract of the repo: any field removed here is a breaking change for
 * `packages/sdk` and for anything else that has pinned it.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { epochS, timestampIso } = readEpoch(searchParams);
  const snapshot = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, epochS);

  return NextResponse.json(
    {
      epochS,
      timestampIso,
      maxEpochS: MAX_EPOCH_S,
      seed: 7331,
      volcanoes: snapshot.volcanoes.map((state) => {
        const indicators = unrestIndicators(state.volcano, epochS);
        return {
          id: state.volcano.id,
          name: state.volcano.name,
          country: state.volcano.country,
          latitudeDeg: state.volcano.latitudeDeg,
          longitudeDeg: state.volcano.longitudeDeg,
          elevationM: state.volcano.elevationM,
          volcanoType: state.volcano.volcanoType,
          unrestProfile: state.volcano.unrestProfile,
          unrest: state.unrest,
          tremorLabel: state.tremorLabel,
          source: state.source,
          indicators,
          assessment: assessUnrest(indicators),
          stations: state.stations.map((observation) => ({
            code: observation.station.code,
            instrument: observation.station.instrument,
            eastOffsetM: observation.station.eastOffsetM,
            northOffsetM: observation.station.northOffsetM,
            elevationM: observation.station.elevationM,
            displacement: observation.displacement,
            traceSamples: observation.traceSamples,
          })),
        };
      }),
    },
    // Safe to hold forever: the full URL, query string included, is the whole
    // of the state, so two different epochs are two different cache entries.
    { headers: { "cache-control": "public, max-age=31536000, immutable" } },
  );
}
