import { mogiForward, volcanoSource } from "@repo/core";
import { findVolcano, gnssStationsFor } from "@repo/seed";
import { NextResponse } from "next/server";
import { readEpoch } from "../../../lib/epoch";

/**
 * Dynamic on purpose.
 *
 * `force-static` would evaluate this handler once at build time with an empty
 * query string and bake the resulting 400 "unknown volcano" into the output,
 * so every deployment would serve a route that rejects every volcano. A
 * handler whose answer depends on its query string cannot be static, and the
 * honest fix is to say so rather than to reach for a cache that hides it.
 *
 * The response is still immutable per URL: the world is a pure function of
 * `(volcano, epoch)`, so `Cache-Control` below is exactly right.
 */
export const dynamic = "force-dynamic";

/**
 * `GET /api/displacement?volcano=&epoch=` — the forward deformation field.
 *
 * A thin adapter over `@repo/core`: parse, validate, call, shape. No geophysics
 * lives in the route handler.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const volcano = findVolcano(searchParams.get("volcano") ?? "");
  if (!volcano) {
    return NextResponse.json(
      { error: "unknown volcano", hint: "list them with GET /api/network" },
      { status: 400 },
    );
  }
  const { epochS, timestampIso } = readEpoch(searchParams);
  const stations = gnssStationsFor(volcano.id);
  const source = volcanoSource(volcano, epochS);
  return NextResponse.json(
    {
      volcano: volcano.id,
      volcanoName: volcano.name,
      epochS,
      timestampIso,
      poisson: 0.25,
      source,
      stations,
      displacement: mogiForward(stations, source),
    },
    // The URL is the whole of the state, so any cache that keys on the full
    // URL is safe to hold the answer indefinitely.
    { headers: { "cache-control": "public, max-age=31536000, immutable" } },
  );
}
