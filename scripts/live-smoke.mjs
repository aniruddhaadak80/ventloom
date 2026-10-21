#!/usr/bin/env node
/**
 * ventloom live smoke test.
 *
 * The one gate that cannot be satisfied by a green CI run: it exercises the
 * *deployed* observatory rather than a local build, and asserts the two
 * properties the whole repo rests on.
 *
 *   1. Determinism. The same URL must return the same bytes forever, because
 *      the world is a pure function of (volcano, epoch). A serverless cold
 *      start must not perturb a single digit.
 *   2. Epoch purity. Moving the epoch by one second must move the world, and
 *      nothing else may.
 *
 * A local `next start` cannot catch a bundle that shipped without its
 * workspace packages, a route that 405s in production, a seismometer's zero
 * vector being fitted as a displacement, or a cache header that lies. Only a
 * request against the live edge can.
 *
 * Usage:
 *   node scripts/live-smoke.mjs [baseUrl]
 *   VENTLOOM_URL=https://ventloom.vercel.app node scripts/live-smoke.mjs
 *
 * Exits non-zero on the first contract violation it can prove.
 */

// `||`, not `??`. An empty argument is an unset argument, not a base URL. CI
// passes "$VENTLOOM_URL" straight through, and an unset variable arrives as an
// empty string that `??` accepts as the base. Every request then becomes a
// relative URL and the gate dies on its first fetch with a URL error.
const BASE = (process.argv[2] || process.env.VENTLOOM_URL || "https://ventloom.vercel.app").replace(
  /\/$/,
  "",
);

if (!/^https?:\/\//.test(BASE)) {
  console.error(`live smoke needs an absolute base URL, got "${BASE}"`);
  process.exit(2);
}

let failures = 0;

const ok = (label, detail = "") => console.log(`  ok    ${label}${detail ? ` ${detail}` : ""}`);
const bad = (label, detail = "") => {
  failures += 1;
  console.error(`  FAIL  ${label} ${detail}`);
};
const check = (label, condition, detail = "") =>
  condition ? ok(label, detail) : bad(label, `${detail} (expected truthy)`);

const section = (name) => console.log(`\n${name}`);

/**
 * fetch with retries.
 *
 * This runs against a live edge, not localhost. A connect timeout on one
 * request says nothing about the contract being asserted, and a gate that
 * fails because a TCP handshake timed out is a gate people will delete. The
 * transport gets retried; assertions never do, because that is the part that
 * is actually under test.
 */
async function fetchWithRetry(path, init = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fetch(`${BASE}${path}`, init);
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

/** Fetch and parse JSON, surfacing the HTTP status in the error. */
async function getJson(path) {
  const res = await fetchWithRetry(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return { res, body: await res.json() };
}

/**
 * Determinism probe: two concurrent requests for the same URL must be byte
 * identical. Concurrency is deliberate. A cache bug that only shows up under
 * parallel load is exactly the class of defect this test exists to catch.
 */
async function assertStable(path, label) {
  const [a, b] = await Promise.all([fetchWithRetry(path), fetchWithRetry(path)]);
  const [ta, tb] = await Promise.all([a.text(), b.text()]);
  check(label, ta === tb, `HTTP ${a.status}/${b.status} len=${ta.length}`);
  return ta;
}

/** POST the same body twice, for routes that are not addressable by a URL. */
async function assertStablePost(buildBody, label) {
  const body = buildBody();
  const post = async () => {
    const r = await fetchWithRetry("/api/invert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return r.text();
  };
  const [ta, tb] = await Promise.all([post(), post()]);
  check(label, ta === tb, `len=${ta.length}`);
  return ta;
}

console.log(`ventloom live smoke against ${BASE}`);

// ------------------------------------------------------------------ health ---
section("health");
const { body: health } = await getJson("/api/health");
check("status ok", health.status === "ok", health.status);
check("service name", health.service === "ventloom-observatory", health.service);
check(
  "world epoch pinned",
  health.worldEpochIso === "2026-01-01T00:00:00.000Z",
  health.worldEpochIso,
);
check("catalogue size", health.counts?.volcanoes === 12, String(health.counts?.volcanoes));
check("network size", health.counts?.stations === 84, String(health.counts?.stations));
const census = Object.values(health.counts?.instruments ?? {});
check(
  "instrument census sums to the network size",
  census.reduce((a, b) => a + b, 0) === health.counts?.stations,
  `${census.reduce((a, b) => a + b, 0)} vs ${health.counts?.stations}`,
);

// ------------------------------------------------------------ determinism ---
section("determinism (same URL, same bytes, twice concurrently)");
await assertStable("/api/health", "health is stable");
await assertStable("/api/network?epoch=3888000", "network is stable");
await assertStable("/api/displacement?volcano=kilauea&epoch=3888000", "displacement is stable");

// The invert route is POST-only by design, so its determinism probe has to post
// the same body twice rather than hitting a query string. It has to post the
// geodetic subset too: the network snapshot reports every instrument, and only
// the GNSS ones carry a displacement.
{
  const net = (await getJson("/api/network?epoch=3888000")).body;
  const kilauea = net.volcanoes.find((v) => v.id === "kilauea");
  const geodetic = kilauea?.geodeticStations ?? [];
  check(
    "the network exposes a geodetic subset",
    geodetic.length > 0,
    `${geodetic.length} stations`,
  );
  await assertStablePost(
    () =>
      JSON.stringify({
        stations: geodetic,
        observations: geodetic.map((s) => s.displacement),
      }),
    "inversion is stable",
  );
}

// ------------------------------------------------------------ epoch purity ---
section("epoch is the whole state");
const e45 = (await getJson("/api/displacement?volcano=kilauea&epoch=3888000")).body;
const e90 = (await getJson("/api/displacement?volcano=kilauea&epoch=7776000")).body;
check("a later epoch gives a different field", JSON.stringify(e45) !== JSON.stringify(e90));
check(
  "source volume grows with epoch",
  e90.source.volumeChangeM3 > e45.source.volumeChangeM3,
  `${e45.source.volumeChangeM3.toExponential(3)} -> ${e90.source.volumeChangeM3.toExponential(3)} m3`,
);
check(
  "the summit swells faster than it widens",
  e90.displacement[0].upM > e45.displacement[0].upM,
  `up ${(e45.displacement[0].upM * 1000).toFixed(2)} -> ${(e90.displacement[0].upM * 1000).toFixed(2)} mm`,
);
check(
  "displacement decays with distance",
  Math.abs(e45.displacement.at(-1).upM) < Math.abs(e45.displacement[0].upM),
  `${(Math.abs(e45.displacement.at(-1).upM) * 1000).toFixed(3)} mm at the far station`,
);

const a45 = await fetchWithRetry("/api/network?epoch=3888000").then((r) => r.text());
const a46 = await fetchWithRetry("/api/network?epoch=3888001").then((r) => r.text());
check("one second apart is already a different world", a45 !== a46);

// ----------------------------------------------------------------- shape ---
section("the network reports instruments honestly");
{
  const net = (await getJson("/api/network?epoch=3888000")).body;
  for (const volcano of net.volcanoes) {
    if (volcano.stations.length === 0) continue;
    for (const station of volcano.stations) {
      if (station.instrument === "gnss") {
        check(`${volcano.id}/${station.code} carries a field`, station.displacement !== null);
      } else {
        // A seismometer does not measure ground deformation. Reporting zeros
        // is what let the inversion fit a chamber to data no chamber can
        // produce.
        check(
          `${volcano.id}/${station.code} (${station.instrument}) reports null`,
          station.displacement === null,
          JSON.stringify(station.displacement),
        );
      }
    }
    check(
      `${volcano.id} geodetic count matches its GNSS count`,
      volcano.geodeticStations.length ===
        volcano.stations.filter((s) => s.instrument === "gnss").length,
    );
  }
}

// -------------------------------------------------------------- inversion ---
section("inversion recovers the source it was seeded from");
{
  const net = (await getJson("/api/network?epoch=3888000")).body;
  const kilauea = net.volcanoes.find((v) => v.id === "kilauea");
  if (!kilauea) throw new Error("kilauea missing from the network snapshot");

  const r = await fetchWithRetry("/api/invert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stations: kilauea.geodeticStations,
      observations: kilauea.geodeticStations.map((s) => s.displacement),
    }),
  });
  // Check the status before parsing. A 400 here is the route refusing a
  // malformed field, and parsing its error object as a fit would read
  // `{error: "..."}` as a chamber with undefined parameters.
  check("inversion accepted", r.ok, `HTTP ${r.status}`);
  const inv = r.ok ? await r.json() : {};
  const truth = kilauea.source;
  check(
    "fit converged",
    inv.diagnostics?.converged === true,
    inv.diagnostics?.terminationReason ?? "",
  );
  const depthErr = Math.abs(inv.source.depthM - truth.depthM) / truth.depthM;
  const volErr = Math.abs(inv.source.volumeChangeM3 - truth.volumeChangeM3) / truth.volumeChangeM3;
  check("depth within 10% of truth", depthErr < 0.1, `${(depthErr * 100).toFixed(2)}%`);
  check("volume within 25% of truth", volErr < 0.25, `${(volErr * 100).toFixed(2)}%`);
  check(
    "rms misfit is sub-millimetre",
    inv.diagnostics?.rmsMisfitM < 1e-3,
    `${inv.diagnostics?.rmsMisfitM?.toExponential(2)} m`,
  );
  check(
    "residual count matches station count",
    inv.residuals?.length === kilauea.geodeticStations.length,
  );
}

// --------------------------------------------------------------- rest hooks ---
section("rest surface");
{
  const r = await fetchWithRetry("/api/invert", { method: "GET" });
  check("GET /api/invert is rejected", r.status === 405, `got ${r.status}`);
  const bad = await fetchWithRetry("/api/invert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stations: [], observations: [] }),
  });
  check("empty field is rejected", bad.status >= 400, `got ${bad.status}`);
  const mismatch = await fetchWithRetry("/api/invert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stations: [{}], observations: [] }),
  });
  check("mismatched lengths are rejected", mismatch.status === 400, `got ${mismatch.status}`);

  // The regression, stated as an assertion rather than a hope.
  const net = (await getJson("/api/network?epoch=3888000")).body;
  const kilauea = net.volcanoes.find((v) => v.id === "kilauea");
  const nonGeodetic = kilauea.stations.find((s) => s.instrument !== "gnss");
  if (nonGeodetic) {
    const rejected = await fetchWithRetry("/api/invert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stations: kilauea.stations,
        observations: kilauea.stations.map((s) => s.displacement),
      }),
    });
    check(
      "a non-geodetic station is refused by name",
      rejected.status === 400 && (await rejected.clone().text()).includes("GNSS"),
      `got ${rejected.status}`,
    );
  } else {
    ok("no non-geodetic station at this epoch; skipping");
  }

  const unknown = await fetchWithRetry("/api/displacement?volcano=not-a-volcano");
  check("unknown volcano is rejected", unknown.status >= 400, `got ${unknown.status}`);
  const huge = await fetchWithRetry("/api/network?epoch=99999999999");
  check("epoch past the ceiling is refused, not clamped", huge.status >= 400, `got ${huge.status}`);
  for (const value of ["-1", "1.5", "1e3", "abc"]) {
    const r = await fetchWithRetry(`/api/network?epoch=${encodeURIComponent(value)}`);
    check(`epoch=${value} is refused`, r.status >= 400, `got ${r.status}`);
  }
  const horizon = await fetchWithRetry("/api/network?epoch=31536000");
  check("the horizon itself is legal", horizon.ok, `got ${horizon.status}`);
}

// ------------------------------------------------------------------ caching ---
section("cache headers");
{
  const r = await fetchWithRetry("/api/network?epoch=3888000");
  const cc = r.headers.get("cache-control") ?? "";
  check("immutable cache header on a pure route", cc.includes("immutable"), cc);
}

// -------------------------------------------------------------------- pages ---
section("rendered surfaces");
for (const p of [
  "/",
  "/geodesy",
  "/seismic",
  "/tephra",
  "/forecast",
  "/replay",
  "/models",
  "/volcanoes/kilauea",
  "/volcanoes/etna",
  "/volcanoes/stromboli",
]) {
  const r = await fetchWithRetry(p);
  const html = await r.text();
  check(p, r.ok && html.includes("ventloom"), `HTTP ${r.status} len=${html.length}`);
}

section("open graph card");
{
  const r = await fetchWithRetry("/og");
  const buf = Buffer.from(await r.arrayBuffer());
  check(
    "og is a png",
    (r.headers.get("content-type") ?? "").includes("image/png"),
    r.headers.get("content-type") ?? "",
  );
  check("png magic bytes", buf.subarray(1, 4).toString() === "PNG");
  check("og carries real pixels", buf.length > 5_000, `${buf.length} bytes`);
}

section("unknown routes");
{
  const r = await fetchWithRetry("/this-route-does-not-exist");
  check("404 for an unknown page", r.status === 404, `got ${r.status}`);
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures} broken assertions)`}`);
process.exit(failures === 0 ? 0 : 1);
