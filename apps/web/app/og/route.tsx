import { assessUnrest, unrestIndicators } from "@repo/core";
import { findVolcano, VOLCANO_CATALOGUE } from "@repo/seed";
import { ImageResponse } from "next/og";
import { readEpoch } from "../../lib/epoch";

export const alt = "ventloom observatory - deterministic eruption forecast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The dynamic social card.
 *
 * Rendered per volcano and per epoch, so a shared link to `/geodesy?volcano=...`
 * carries the actual alert level in its preview. Nothing here touches the
 * clock or the network.
 *
 * Two constraints shaped this file, and both are load-bearing:
 *
 * 1. **A named `GET`, not a default export.** Next only honours a default
 *    export on the special `opengraph-image` filenames. On an ordinary
 *    `route.tsx` a default export registers no method at all, and the router
 *    answers every request with 405 Method Not Allowed. That failure is silent
 *    at build time.
 *
 * 2. **One text child per element, and ASCII only.** The `satori` renderer
 *    behind `ImageResponse` raises two errors that look unrelated but are both
 *    structural. It requires `display: flex` on any element with more than one
 *    child, so an interpolation like `{country} · {lat}°` splits into several
 *    text nodes and throws. And it resolves glyphs against the bundled Inter
 *    face, falling back to a *network* fetch of Noto Sans for anything Inter
 *    does not cover: Greek capital Delta, the superscript in "Mm3", the degree
 *    sign and the middle dot all trigger it. Offline, that fetch times out and
 *    the whole route fails with a closed connection. Every string below is
 *    therefore assembled with a template literal and kept to ASCII.
 *
 * The platform font stack is deliberate. Embedding a webfont would mean
 * shipping an asset into the route for kerning on a 1200x630 image that most
 * viewers first see at about 300 pixels wide.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { epochS, timestampIso } = readEpoch(Object.fromEntries(searchParams));
  const volcano = findVolcano(searchParams.get("volcano") ?? "") ?? VOLCANO_CATALOGUE[0];
  if (!volcano) throw new Error("volcano catalogue is empty");

  const indicators = unrestIndicators(volcano, epochS);
  const assessment = assessUnrest(indicators);

  const levelColour =
    assessment.volcanoAlertLevel === "WARNING"
      ? "#dc2626"
      : assessment.volcanoAlertLevel === "WATCH"
        ? "#c2410c"
        : assessment.volcanoAlertLevel === "ADVISORY"
          ? "#d97706"
          : "#22c55e";

  // Single strings, so each element has exactly one text child.
  const headline = "Weave volcanic signals";
  const headlineTail = "into an eruption forecast";
  const coordinates = `${volcano.country}  ${volcano.latitudeDeg.toFixed(2)} deg N, ${Math.abs(volcano.longitudeDeg).toFixed(2)} deg`;
  const volumeMm3 = (indicators.sourceVolumeChangeM3 / 1e6).toFixed(2);
  const indicatorsLine = `dV ${volumeMm3} Mm3   RSAM ${indicators.rsamRatio.toFixed(1)} x`;
  const footer = `${timestampIso}  seed 7331  deterministic, no API keys`;

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#0b0a09",
        backgroundImage:
          "radial-gradient(circle at 12% 18%, rgba(245,158,11,0.28), transparent 42%), radial-gradient(circle at 88% 82%, rgba(20,184,166,0.18), transparent 46%)",
        padding: "64px",
        fontFamily: "sans-serif",
        color: "#fafaf9",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            letterSpacing: "0.24em",
            color: "#f59e0b",
            textTransform: "uppercase",
          }}
        >
          {"ventloom observatory"}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 68,
            fontWeight: 700,
            lineHeight: 1.06,
            maxWidth: 900,
          }}
        >
          <div style={{ display: "flex" }}>{headline}</div>
          <div style={{ display: "flex", color: "#f59e0b" }}>{headlineTail}</div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 32,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600 }}>{volcano.name}</div>
          <div style={{ display: "flex", fontSize: 22, color: "#a8a29e" }}>{coordinates}</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: levelColour,
            }}
          >
            {`${assessment.volcanoAlertLevel} / ${assessment.aviationColourCode}`}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#a8a29e" }}>{indicatorsLine}</div>
        </div>
      </div>

      <div style={{ display: "flex", fontSize: 22, color: "#78716c" }}>{footer}</div>
    </div>,
    size,
  );
}
