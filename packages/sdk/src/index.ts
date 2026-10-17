/**
 * The typed client for the ventloom observatory API.
 *
 * It mirrors the route handlers in `apps/web/app/api/*` and is the documented
 * way to embed the observatory in something else. Every method is a pure
 * `fetch` against the same deterministic endpoints the app serves, so a caller
 * gets the same numbers the UI shows.
 *
 * The client is deliberately dependency-free and works in Node, Bun and the
 * browser. There is no retry logic and no cache: the endpoints are immutable
 * functions of their query string, so caching is the HTTP layer's job.
 */

import {
  type Displacement,
  type MogiInversionResult,
  type MogiSource,
  mogiInvert,
  type StationOffset,
  type UnrestIndicators,
} from "@repo/core";

export interface ObservatoryClientOptions {
  /** Base URL of the observatory, e.g. `https://ventloom.vercel.app`. */
  baseUrl: string;
  /** Optional fetch implementation, for Node without global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * One station as `GET /api/network` reports it.
 *
 * `displacement` is `null` for every instrument that does not measure ground
 * deformation. A seismometer and a GNSS both have coordinates; only one of them
 * has a displacement. `null` says which.
 */
export interface StationObservation {
  id: string;
  code: string;
  instrument: string;
  eastOffsetM: number;
  northOffsetM: number;
  elevationM: number;
  displacement: Displacement | null;
  traceSamples: number;
}

/** A station that definitely carries a deformation field. */
export interface GeodeticStation extends Omit<StationObservation, "displacement"> {
  displacement: Displacement;
}

export interface NetworkVolcano {
  id: string;
  name: string;
  country: string;
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM: number;
  volcanoType: string;
  unrestProfile: string;
  unrest: number;
  tremorLabel: string;
  source: MogiSource;
  indicators: UnrestIndicators;
  assessment: {
    volcanoAlertLevel: "NORMAL" | "ADVISORY" | "WATCH" | "WARNING";
    aviationColourCode: "GREEN" | "YELLOW" | "ORANGE" | "RED";
    confidence: number;
    advisories: string[];
  };
  /** Every station watching this volcano, geodetic and non-geodetic alike. */
  stations: StationObservation[];
  /**
   * The GNSS subset, in exactly the shape `POST /api/invert` accepts. Use this
   * rather than `stations`: forwarding the whole array gets a 400 that names
   * the offending stations, which is better than a plausible wrong chamber.
   */
  geodeticStations: GeodeticStation[];
}

export interface NetworkSnapshotResponse {
  epochS: number;
  timestampIso: string;
  maxEpochS: number;
  seed: number;
  volcanoes: NetworkVolcano[];
}

export interface DisplacementResponse {
  volcano: string;
  volcanoName: string;
  epochS: number;
  timestampIso: string;
  poisson: number;
  source: MogiSource;
  stations: StationOffset[];
  displacement: Displacement[];
}

export interface InvertRequest {
  stations: StationOffset[];
  observations: Displacement[];
  poisson?: number;
  sigmaM?: number;
}

/** A typed client for the observatory. */
export class ObservatoryClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ObservatoryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private url(path: string, params: Record<string, string | number | undefined> = {}): string {
    const target = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) target.searchParams.set(key, String(value));
    }
    return target.toString();
  }

  private async get<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const response = await this.fetchImpl(this.url(path, params));
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GET ${path} failed with ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  /** Health, identity and the shape of the seeded world. */
  health(): Promise<{
    status: string;
    service: string;
    worldEpochIso: string;
    secondsPerDay: number;
    counts: { volcanoes: number; stations: number; instruments: Record<string, number> };
  }> {
    return this.get("/api/health");
  }

  /** The whole observatory at one epoch. */
  network(params: { epochS?: number; volcano?: string } = {}): Promise<NetworkSnapshotResponse> {
    return this.get("/api/network", { epoch: params.epochS, volcano: params.volcano });
  }

  /** The forward deformation field for one volcano at one epoch. */
  displacement(params: { volcano: string; epochS?: number }): Promise<DisplacementResponse> {
    return this.get("/api/displacement", { volcano: params.volcano, epoch: params.epochS });
  }

  /** Run the Mogi inversion over a caller-supplied field. */
  async invert(request: InvertRequest): Promise<MogiInversionResult> {
    const response = await this.fetchImpl(this.url("/api/invert"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`POST /api/invert failed with ${response.status}: ${text}`);
    }
    const body = (await response.json()) as {
      source: MogiSource;
      diagnostics: Omit<MogiInversionResult, "source" | "residuals" | "predicted">;
      residuals: Displacement[];
      predicted: Displacement[];
    };
    return {
      source: body.source,
      ...body.diagnostics,
      residuals: body.residuals,
      predicted: body.predicted,
    };
  }

  /**
   * Convenience: fetch a volcano's field and invert it in one call.
   *
   * Useful for a notebook or a script that wants the answer without thinking
   * about the two-step protocol. `GET /api/displacement` only ever reports GNSS
   * sites, so this is safe to call with the full network.
   */
  async invertVolcano(params: { volcano: string; epochS?: number; sigmaM?: number }) {
    const field = await this.displacement(params);
    return this.invert({
      stations: field.stations,
      observations: field.displacement,
      sigmaM: params.sigmaM ?? 0.004,
    });
  }

  /**
   * The geodetic field for one volcano, lifted out of the network snapshot.
   *
   * `GET /api/network` reports every instrument watching a volcano, and only
   * the GNSS subset carries a displacement. This is the method that hands back
   * only the stations an inversion may legitimately use, so the caller cannot
   * accidentally fit a seismometer's zero vector.
   */
  async geodeticField(params: {
    volcano: string;
    epochS?: number;
  }): Promise<{ stations: GeodeticStation[]; observations: Displacement[]; source: MogiSource }> {
    const snapshot = await this.network(
      params.epochS === undefined ? {} : { epochS: params.epochS },
    );
    const volcano = snapshot.volcanoes.find((v) => v.id === params.volcano);
    if (!volcano) {
      throw new Error(`unknown volcano "${params.volcano}"`);
    }
    const stations = volcano.geodeticStations ?? [];
    return {
      stations,
      observations: stations.map((s) => s.displacement),
      source: volcano.source,
    };
  }

  /**
   * Invert the network snapshot's own geodetic field for one volcano.
   *
   * The honest round trip: the observatory publishes a chamber, the observatory
   * solves for it back, and the two agree. Any drift between the forward model
   * and the solver shows up here rather than in a downstream analysis.
   */
  async invertFromNetwork(params: {
    volcano: string;
    epochS?: number;
    sigmaM?: number;
  }): Promise<MogiInversionResult & { truth: MogiSource }> {
    const field = await this.geodeticField(params);
    const result = await this.invert({
      stations: field.stations,
      observations: field.observations,
      sigmaM: params.sigmaM ?? 0.004,
    });
    return { ...result, truth: field.source };
  }
}

/**
 * The same inversion, computed locally from `@repo/core` with no HTTP at all.
 *
 * Exposed so a caller can verify the server against the client-side model -
 * the two are the same code, which is the point of shipping the core as a
 * workspace dependency.
 */
export function invertLocally(
  stations: readonly StationOffset[],
  observations: readonly Displacement[],
  options: { sigmaM?: number } = {},
): MogiInversionResult {
  return mogiInvert(stations, observations, options);
}

export type { Displacement, MogiInversionResult, MogiSource, StationOffset };
export { mogiInvert as _mogiInvert };
