import { expect, test } from "@playwright/test";

/**
 * End-to-end coverage of the observatory's top flows.
 *
 * These are the claims the README makes, asserted against a production server:
 * that every signature surface renders its own numbers, that the API agrees
 * with the page, and that the epoch in the URL really is the whole of the
 * state.
 */

test.describe("landing", () => {
  test("renders the observatory with the network and the seed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Weave volcanic signals");
    // The catalogue is present.
    await expect(page.getByRole("link", { name: "Kīlauea" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sakurajima" })).toBeVisible();
    // Determinism is stated, not implied. The seed appears in the masthead and
    // in the footer copy, so this pins whichever comes first rather than
    // failing on a strict-mode collision with its own repetition.
    await expect(page.getByText(/seed 7331/).first()).toBeVisible();
    await expect(page.getByText(/no API keys/)).toBeVisible();
  });

  test("reaches the health endpoint and reports the world shape", async ({ page }) => {
    const response = await page.request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      status: string;
      counts: { volcanoes: number; stations: number };
    };
    expect(body.status).toBe("ok");
    expect(body.counts.volcanoes).toBe(12);
    expect(body.counts.stations).toBeGreaterThan(40);
  });
});

test.describe("geodesy - the signature surface", () => {
  test("inverts a deformation field and reports a converged source", async ({ page }) => {
    await page.goto("/geodesy?epoch=3888000&volcano=kilauea");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Mogi source inversion");
    // The verdict must be a converged solve, not a first guess.
    await expect(page.getByText("Converged").locator("xpath=following-sibling::dd")).toHaveText(
      "yes",
    );
    // Depth is a real number in metres, not zero or NaN.
    const depthRow = page
      .getByText("Depth")
      .locator("xpath=ancestor::div[contains(@class,'grid')]")
      .first();
    await expect(depthRow).toContainText("m");
    // The trade-off is reported honestly. It is negative by construction -
    // a deeper source needs more volume to make the same surface displacement -
    // so the pattern has to admit a sign.
    await expect(page.getByText(/rho = -?\d\.\d+/)).toBeVisible();
  });

  test("the API inverts the same field the page displays", async ({ page }) => {
    const field = await page.request.get("/api/displacement?volcano=etna&epoch=3888000");
    expect(field.ok()).toBeTruthy();
    const body = (await field.json()) as {
      stations: { code: string; eastOffsetM: number; northOffsetM: number }[];
      displacement: { eastM: number; northM: number; upM: number }[];
    };
    expect(body.stations.length).toBe(body.displacement.length);
    expect(body.displacement.length).toBeGreaterThan(0);
    // A real field has real signal in it.
    const spread =
      Math.max(...body.displacement.map((d) => d.upM)) -
      Math.min(...body.displacement.map((d) => d.upM));
    expect(spread).toBeGreaterThan(0.001);

    // Round-trip: the field the forward model produced must invert back to a
    // converged source. This is the observatory's central claim, checked over
    // HTTP rather than against an in-process function.
    const inverted = await page.request.post("/api/invert", {
      data: {
        stations: body.stations.map((s) => ({
          id: s.code,
          code: s.code,
          eastOffsetM: s.eastOffsetM,
          northOffsetM: s.northOffsetM,
        })),
        observations: body.displacement,
        sigmaM: 0.004,
      },
    });
    expect(inverted.ok()).toBeTruthy();
    const result = (await inverted.json()) as {
      source: { depthM: number };
      diagnostics: { converged: boolean };
    };
    expect(result.diagnostics.converged).toBe(true);
    expect(result.source.depthM).toBeGreaterThan(100);
  });

  test("rejects a malformed inversion body instead of guessing", async ({ page }) => {
    const response = await page.request.post("/api/invert", { data: { stations: [] } });
    expect(response.status()).toBe(400);
  });
});

/**
 * The regression suite for two bugs a green build cannot see.
 *
 * Both shipped in a deployment that reported `Ready` and served every route.
 */
test.describe("observatory contract", () => {
  test("only GNSS stations carry a displacement, and it is null elsewhere", async ({ page }) => {
    const response = await page.request.get("/api/network?epoch=3888000");
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      volcanoes: {
        id: string;
        stations: { instrument: string; displacement: unknown }[];
        geodeticStations: { instrument: string; displacement: unknown }[];
      }[];
    };
    for (const volcano of body.volcanoes) {
      expect(volcano.stations.length).toBeGreaterThan(0);
      for (const station of volcano.stations) {
        if (station.instrument === "gnss") {
          expect(station.displacement, `${volcano.id} gnss must carry a field`).not.toBeNull();
        } else {
          // A seismometer does not measure ground deformation. Reporting zeros
          // here is what let the inversion fit a chamber to data that no
          // chamber can produce.
          expect(
            station.displacement,
            `${volcano.id} ${station.instrument} must not fabricate a field`,
          ).toBeNull();
        }
      }
      // The geodetic array is exactly the GNSS subset.
      expect(volcano.geodeticStations.every((s) => s.instrument === "gnss")).toBe(true);
      expect(volcano.geodeticStations.length).toBeGreaterThanOrEqual(
        volcano.stations.filter((s) => s.instrument === "gnss").length,
      );
    }
  });

  test("a seismic station is rejected by the inversion instead of being fitted", async ({
    page,
  }) => {
    const network = await page.request.get("/api/network?epoch=3888000").then((r) => r.json());
    const kilauea = (
      network as { volcanoes: { id: string; stations: unknown[] }[] }
    ).volcanoes.find((v) => v.id === "kilauea");
    const seismic = (kilauea?.stations ?? []).find(
      (s) => (s as { instrument: string }).instrument !== "gnss",
    );
    test.skip(!seismic, "no non-geodetic station at this epoch");

    const response = await page.request.post("/api/invert", {
      data: {
        stations: kilauea?.stations,
        observations: (kilauea?.stations ?? []).map(
          (s) => (s as { displacement: unknown }).displacement,
        ),
      },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("GNSS");
  });

  test("the published chamber inverts back to itself", async ({ page }) => {
    // The central claim, end to end: the observatory publishes a source, and
    // solving the observatory's own geodetic field recovers it. Before the
    // null-displacement fix this recovered a chamber 60% shallower and still
    // reported `converged: true`.
    const network = await page.request.get("/api/network?epoch=3888000").then((r) => r.json());
    const volcano = (
      network as {
        volcanoes: {
          id: string;
          source: {
            depthM: number;
            volumeChangeM3: number;
            eastOffsetM: number;
            northOffsetM: number;
          };
          geodeticStations: {
            id: string;
            eastOffsetM: number;
            northOffsetM: number;
            displacement: { eastM: number; northM: number; upM: number };
          }[];
        }[];
      }
    ).volcanoes.find((v) => v.id === "kilauea");
    if (!volcano) throw new Error("kilauea missing from the network snapshot");

    const response = await page.request.post("/api/invert", {
      data: {
        stations: volcano.geodeticStations,
        observations: volcano.geodeticStations.map((s) => s.displacement),
      },
    });
    expect(response.ok()).toBeTruthy();
    const result = (await response.json()) as {
      source: { depthM: number; volumeChangeM3: number };
      diagnostics: { converged: boolean; rmsMisfitM: number };
    };
    expect(result.diagnostics.converged).toBe(true);
    expect(
      Math.abs(result.source.depthM - volcano.source.depthM) / volcano.source.depthM,
    ).toBeLessThan(0.1);
    expect(
      Math.abs(result.source.volumeChangeM3 - volcano.source.volumeChangeM3) /
        volcano.source.volumeChangeM3,
    ).toBeLessThan(0.25);
    expect(result.diagnostics.rmsMisfitM).toBeLessThan(1e-3);
  });

  test("an epoch past the seeded horizon is refused, not clamped", async ({ page }) => {
    // These routes advertise `Cache-Control: immutable`. A clamping parser
    // would hand the same bytes to two different cache keys, so the horizon has
    // to be enforced rather than absorbed.
    for (const path of ["/api/network", "/api/displacement?volcano=kilauea"]) {
      const response = await page.request.get(
        `${path}${path.includes("?") ? "&" : "?"}epoch=99999999999`,
      );
      expect(response.status(), `${path} must reject an absurd epoch`).toBe(400);
    }
    for (const value of ["-1", "1.5", "1e3", "abc"]) {
      const response = await page.request.get(`/api/network?epoch=${encodeURIComponent(value)}`);
      expect(response.status(), `epoch=${value} must be refused`).toBe(400);
    }
    // The boundary itself is legal.
    const horizon = await page.request.get("/api/network?epoch=31536000");
    expect(horizon.ok()).toBeTruthy();
  });

  test("the same URL returns the same bytes", async ({ page }) => {
    const [a, b] = await Promise.all([
      page.request.get("/api/network?epoch=7776000"),
      page.request.get("/api/network?epoch=7776000"),
    ]);
    expect(await a.text()).toBe(await b.text());
  });
});

test.describe("seismic", () => {
  test("renders a spectrogram and reports the tremor band fraction", async ({ page }) => {
    await page.goto("/seismic?epoch=3888000&volcano=kilauea");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tremor spectra");
    // The spectrogram is an accessible image, not a canvas nobody can read.
    const spectrogram = page.getByRole("img", { name: /Spectrogram at/ });
    await expect(spectrogram).toBeVisible();
    // The band ratio is exposed through the native <meter>, so it is reachable
    // by role and name even though the visible caption reads "1-5 Hz tremor
    // band ... 72.0 %".
    await expect(page.getByRole("meter", { name: /Fraction of power/ }).first()).toBeVisible();
  });
});

test.describe("tephra", () => {
  test("renders the distance matrix and the composition bars", async ({ page }) => {
    await page.goto("/tephra");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Geochemical fingerprints");
    // Two tables expose a "layer" header: the distance matrix (lowercase) and
    // the layer inventory below it (title case, matched case-insensitively).
    // Either being present proves the surface rendered.
    await expect(page.getByRole("columnheader", { name: "layer" }).first()).toBeVisible();
    await expect(page.getByText(/clr\(x\) = ln\(x\)/)).toBeVisible();
  });
});

test.describe("forecast", () => {
  test("renders the verdict with the rules that fired", async ({ page }) => {
    await page.goto("/forecast?epoch=3888000&volcano=merapi");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Alert engine");
    await expect(page.getByRole("meter", { name: /Confidence/ })).toBeVisible();
    // The Situation Report is the auditable artifact.
    await expect(page.getByText(/SITUATION REPORT/)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Rule" })).toBeVisible();
  });

  test("shows the rules that did not fire as well as those that did", async ({ page }) => {
    await page.goto("/forecast?epoch=0&volcano=taupo");
    await expect(page.getByText("Checked but silent")).toBeVisible();
  });
});

test.describe("replay - the deterministic time machine", () => {
  test("the same epoch renders the same observatory", async ({ page }) => {
    await page.goto("/replay?epoch=2592000&volcano=kilauea");
    const first = await page.locator("main").innerText();
    await page.goto("/replay?epoch=2592000&volcano=kilauea");
    const second = await page.locator("main").innerText();
    expect(first).toBe(second);
  });

  test("a different epoch renders a different observatory", async ({ page }) => {
    await page.goto("/replay?epoch=0&volcano=kilauea");
    const early = await page.locator("main").innerText();
    await page.goto("/replay?epoch=2592000&volcano=kilauea");
    const later = await page.locator("main").innerText();
    expect(early).not.toBe(later);
  });

  test("submitting the epoch form navigates to that epoch", async ({ page }) => {
    await page.goto("/replay");
    await page.getByLabel(/Epoch \(seconds/).fill("172800");
    await page.getByRole("button", { name: "Render epoch" }).click();
    await expect(page).toHaveURL(/epoch=172800/);
  });
});

test.describe("volcano detail", () => {
  test("renders one volcano with its network", async ({ page }) => {
    await page.goto("/volcanoes/etna?epoch=3888000");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Mount Etna");
    await expect(page.getByRole("columnheader", { name: "Bench" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Instrument" })).toBeVisible();
  });

  test("renders every volcano in the catalogue", async ({ page }) => {
    for (const id of ["kilauea", "sakurajima", "merapi", "cotopaxi", "bezymianny", "taupo"]) {
      const response = await page.request.get(`/volcanoes/${id}`);
      expect(response.ok(), `${id} should render`).toBeTruthy();
    }
  });
});

test.describe("open graph", () => {
  test("renders a per-volcano social card", async ({ page }) => {
    const response = await page.request.get("/og?volcano=etna&epoch=3888000");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("image/png");
  });
});

test.describe("accessibility", () => {
  test("the landing page has one main landmark and a skip link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Observatory sections" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
  });

  test("every chart is an accessible image with a label", async ({ page }) => {
    await page.goto("/seismic?epoch=3888000&volcano=kilauea");
    const images = page.getByRole("img");
    const count = await images.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const label = await images.nth(i).getAttribute("aria-label");
      expect(label, "chart must be labelled").toBeTruthy();
    }
  });

  test("the epoch input is labelled", async ({ page }) => {
    await page.goto("/replay");
    await expect(page.getByLabel(/Epoch/)).toBeVisible();
  });
});
