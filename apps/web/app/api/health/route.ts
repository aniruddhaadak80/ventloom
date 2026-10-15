import { SECONDS_PER_DAY, WORLD_EPOCH_ISO } from "@repo/core";
import { instrumentCounts, STATION_NETWORK, VOLCANO_CATALOGUE } from "@repo/seed";
import { NextResponse } from "next/server";

export const dynamic = "force-static";

/**
 * Health and identity.
 *
 * Reports the shape of the seeded world rather than a liveness ping, so a
 * deploy that lost its seed data fails this route instead of silently serving
 * an empty observatory.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "ventloom-observatory",
    worldEpochIso: WORLD_EPOCH_ISO,
    secondsPerDay: SECONDS_PER_DAY,
    counts: {
      volcanoes: VOLCANO_CATALOGUE.length,
      stations: STATION_NETWORK.length,
      instruments: instrumentCounts(),
    },
  });
}
