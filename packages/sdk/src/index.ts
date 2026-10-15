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

export interface StationObservation {
  code: string;
  instrument: string;
  displacement: Displacement;
  traceSamples: number;
}

export interface NetworkVolcano {
  id: string;
  name: string;
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
  stations: StationObservation[];
}

export interface NetworkSnapshotResponse {
  epochS: number;
  timestampIso: string;
  maxEpochS: number;
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
   * about the two-step protocol.
   */
  async invertVolcano(params: { volcano: string; epochS?: number; sigmaM?: number }) {
    const field = await this.displacement(params);
    return this.invert({
      stations: field.stations,
      observations: field.displacement,
      sigmaM: params.sigmaM ?? 0.004,
    });
  }
}

/**
 * The same inversion, computed locally from `@repo/core` with no HTTP at all.
 *
 * Exposed so a caller can verify the server against the client-side model —
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
