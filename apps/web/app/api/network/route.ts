import { assessUnrest, networkSnapshot, unrestIndicators } from "@repo/core";
import { STATION_NETWORK, VOLCANO_CATALOGUE } from "@repo/seed";
import { NextResponse } from "next/server";
import { acceptEpoch, MAX_EPOCH_S } from "../../../lib/epoch";

/**
 * Dynamic: the epoch is a query parameter, so the answer is not fixed at
 * build time. See `app/api/displacement/route.ts` for why `force-static` on a
 * parameterised route is worse than no directive at all.
 */
export const dynamic = "force-dynamic";

/**
 * `GET /api/network?epoch=<seconds>` - the whole observatory at one epoch.
 *
 * This is the payload the SDK is written against, so it is the de facto
 * contract of the repo: any field removed here is a breaking change for
 * `packages/sdk` and for anything else that has pinned it.
 *
 * The epoch is validated strictly rather than clamped, because this route
 * ships `Cache-Control: immutable`. See `lib/epoch.ts` for why clamping and an
 * immutable cache header cannot coexist.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const epoch = acceptEpoch(searchParams);
  if (!epoch.ok) {
    return NextResponse.json(
      { error: epoch.error, hint: `valid epochs are 0 to ${MAX_EPOCH_S} seconds` },
      { status: 400 },
    );
  }
  const { epochS, timestampIso } = epoch;
  const snapshot = networkSnapshot(VOLCANO_CATALOGUE, STATION_NETWORK, epochS);

  return NextResponse.json(
    {
      epochS,
      timestampIso,
      maxEpochS: MAX_EPOCH_S,
      seed: 7331,
      volcanoes: snapshot.volcanoes.map((state) => {
        const indicators = unrestIndicators(state.volcano, epochS);
        // Only a GNSS measures ground deformation. A seismometer measures ground
        // acceleration and an infrasound array measures air pressure, so for
        // those the honest answer is `null`, not a vector of zeros.
        //
        // Zeros were the original choice and they were wrong in a way that only
        // surfaced downstream: `POST /api/invert` cannot tell a genuinely still
        // station from a seismometer, so it was handed five fabricated
        // zero-vectors alongside three real ones. The fit still converged, just
        // to a different chamber - depth came out 60% shallow and the misfit
        // was 7 mm - because the solver was dutifully explaining zeros that no
        // underground source can produce. `null` makes the mistake hard to
        // make by accident.
        const describe = (observation: (typeof state.stations)[number]) => ({
          // `id` is the stable identity `@repo/core` keys its `StationOffset` on,
          // so the network payload has to carry it: without it the only handle a
          // caller had on a station was the display code, and the geodetic array
          // below was not type-compatible with the thing it feeds.
          id: observation.station.id,
          code: observation.station.code,
          instrument: observation.station.instrument,
          eastOffsetM: observation.station.eastOffsetM,
          northOffsetM: observation.station.northOffsetM,
          elevationM: observation.station.elevationM,
          displacement: observation.station.instrument === "gnss" ? observation.displacement : null,
          traceSamples: observation.traceSamples,
        });
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
          stations: state.stations.map(describe),
          // The geodetic subset, already in the shape `POST /api/invert` wants.
          // A caller that forwards the whole `stations` array instead gets a 400
          // that points here, rather than a plausible-looking wrong chamber.
          geodeticStations: state.stations
            .filter((observation) => observation.station.instrument === "gnss")
            .map(describe),
        };
      }),
    },
    // Safe to hold forever: the full URL, query string included, is the whole
    // of the state, so two different epochs are two different cache entries.
    { headers: { "cache-control": "public, max-age=31536000, immutable" } },
  );
}
