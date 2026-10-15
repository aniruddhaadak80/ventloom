#!/usr/bin/env node
/**
 * gen-assets.mjs - deterministic SVG identity for ventloom.
 *
 * The mark is a stratovolcano cone crossed by horizontal signal "weft" threads
 * with a rising plume of "warp" threads above the crater. The name is the
 * design: a vent, and a loom that weaves what it emits into a forecast.
 *
 * Why generate the assets rather than commit hand-drawn files?
 *
 *   1. Determinism. Every coordinate is derived from the same seeded PRNG
 *      (seed 7331) the rest of the repo uses, so `bun run assets` is a pure
 *      function and regenerating produces byte-identical output. A CI job can
 *      therefore diff the committed SVGs against freshly generated ones and
 *      fail if they have drifted.
 *   2. One source of truth. The favicon, the wordmark, the social banner and
 *      the 512px icon are the same geometry at different scales and weights.
 *      Hand-maintaining four of them guarantees they eventually disagree.
 *   3. No design toolchain. Nothing here needs Figma, Inkscape or a raster
 *      pipeline, so a contributor can regenerate the identity on a bare
 *      machine with the runtime they already have.
 *
 * Usage:
 *   node scripts/gen-assets.mjs           # write public/*.svg
 *   node scripts/gen-assets.mjs --check   # verify committed files match
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");
const SEED = 7331;

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

/**
 * mulberry32: a small, fast, well-distributed 32-bit PRNG.
 *
 * Seeded from 7331 so the jitter in the weave is stable across runs and
 * machines. `Math.random` would make every regeneration produce a different
 * logo, which defeats the point of generating it in the first place.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

const C = {
  ash: "#0b0a09",
  ashRaised: "#1c1917",
  stone: "#292524",
  slag: "#44403c",
  muted: "#a8a29e",
  bone: "#fafaf9",
  lava: "#f59e0b",
  lavaDeep: "#c2410c",
  ember: "#dc2626",
  teal: "#14b8a6",
  tealDim: "#0f766e",
};

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Round to two decimals so regenerated files are byte-stable. */
const r = (n) => Number(n.toFixed(2));

/**
 * A polyline sampled from a sine wave.
 *
 * Sampled at `stepsPerWave` points rather than approximated with a cubic: a
 * polyline is exact at every sample, needs no control-point algebra, and
 * renders identically in every SVG engine including the satori renderer that
 * draws the social card.
 */
function wave({ x0, x1, y, amplitude, wavelength, phase = 0, stepsPerWave = 24 }) {
  const span = x1 - x0;
  const count = Math.max(2, Math.ceil((span / wavelength) * stepsPerWave));
  const points = [];
  for (let i = 0; i <= count; i++) {
    const x = x0 + (span * i) / count;
    const yy = y + amplitude * Math.sin((2 * Math.PI * (x - x0)) / wavelength + phase);
    points.push(`${r(x)},${r(yy)}`);
  }
  return points.join(" ");
}

/**
 * The cone silhouette as a closed path.
 *
 * The summit is a crater rather than a point: a real stratovolcano's eruptive
 * vent is a notch, and the notch is where the plume threads are anchored, so
 * the geometry has to carry it.
 */
function conePath({ left, right, base, craterWidth, craterDepth, notch }) {
  const cx = (left + right) / 2;
  const half = craterWidth / 2;
  const rimY = base - notch;

  return [
    `M ${r(left)} ${r(base)}`,
    `L ${r(cx - half)} ${r(rimY + craterDepth)}`,
    `L ${r(cx - half * 0.55)} ${r(rimY + craterDepth * 0.35)}`,
    `L ${r(cx)} ${r(rimY + craterDepth)}`,
    `L ${r(cx + half * 0.55)} ${r(rimY + craterDepth * 0.35)}`,
    `L ${r(cx + half)} ${r(rimY + craterDepth)}`,
    `L ${r(right)} ${r(base)}`,
    "Z",
  ].join(" ");
}

/**
 * Rising plume threads.
 *
 * Each thread drifts sideways as it climbs, because a convective plume
 * bends in the wind and a perfectly vertical column reads as smoke from a
 * chimney. The drift direction and amplitude are seeded, so the bend is the
 * same in every regeneration.
 */
function plumeThreads({ cx, rimY, top, count, spread }) {
  const random = mulberry32(SEED + 91);
  const threads = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const startX = cx + (t - 0.5) * spread * 0.34;
    const drift = (t - 0.5) * spread + (random() - 0.5) * spread * 0.3;
    const rise = top + random() * (rimY - top) * 0.18;
    const height = rimY - rise;
    // The control points are offset in *opposite* horizontal directions near
    // the base and near the top, which gives each thread an S-bend. Straight
    // threads read as antennae; a convective plume leans, wanders and fans.
    const c1x = startX + drift * 0.34 + (random() - 0.5) * spread * 0.16;
    const c1y = rimY - height * 0.38;
    const c2x = startX + drift * 0.86 - (random() - 0.5) * spread * 0.16;
    const c2y = rimY - height * 0.76;
    threads.push(
      `M ${r(startX)} ${r(rimY)} C ${r(c1x)} ${r(c1y)}, ${r(c2x)} ${r(c2y)}, ${r(startX + drift)} ${r(rise)}`,
    );
  }
  return threads;
}

/* -------------------------------------------------------------------------- */
/* The mark                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The core emblem, drawn once and reused at every size.
 *
 * `weight` scales strokes so the 16px favicon keeps its threads visible: a
 * hairline that reads as precise at 240px disappears entirely at 16px, and a
 * favicon that renders as a brown triangle has failed at its only job.
 */
function emblem({ size = 240, weight = 1, threads = 5, plume = 5, showPlume = true }) {
  const s = size / 240;
  const stroke = (w) => r(w * s * weight);
  const id = (n) => `${n}`;

  const cone = conePath({
    left: 16 * s,
    right: 224 * s,
    base: 202 * s,
    craterWidth: 34 * s,
    craterDepth: 9 * s,
    notch: 128 * s,
  });

  const cx = 120 * s;
  const rimY = (202 - 128 + 9) * s;

  // Weft: the ground signal, woven through the cone. Amplitude swells toward
  // the summit because deformation is largest directly above the source, which
  // is the physical fact the geodesy page is built around.
  const weft = [];
  for (let i = 0; i < threads; i++) {
    const t = i / (threads - 1 || 1);
    const y = (112 + t * 74) * s;
    const swell = 1 - Math.abs(t - 0.34) * 0.9;
    weft.push(
      wave({
        x0: 16 * s,
        x1: 224 * s,
        y,
        amplitude: (1.6 + swell * 3.2) * s * weight,
        wavelength: (26 + t * 12) * s,
        phase: t * 1.7,
      }),
    );
  }

  const plumePaths = showPlume
    ? plumeThreads({ cx, rimY, top: 18 * s, count: plume, spread: 54 * s })
    : [];

  return { cone, weft, plumePaths, s, stroke, id, cx, rimY };
}

/** Wrap emblem parts in a standalone SVG document. */
function svgDocument({ width, height, body, title }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${title}">
  <title>${title}</title>
${body
  .split("\n")
  .map((line) => (line ? `  ${line}` : ""))
  .join("\n")}
</svg>
`;
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

/** The square emblem alone: logo, icon and favicon all derive from this. */
function buildMark(size, { weight = 1, threads = 5, plume = 5, background = true } = {}) {
  const e = emblem({ size, weight, threads, plume });
  const body = [];

  if (background) {
    body.push(`<rect width="${size}" height="${size}" rx="${r(size * 0.22)}" fill="${C.ash}"/>`);
    body.push(
      `<circle cx="${r(size * 0.5)}" cy="${r(size * 0.36)}" r="${r(size * 0.42)}" fill="url(#glow)" opacity="0.5"/>`,
    );
  }

  body.push(
    `<defs>`,
    `<radialGradient id="glow" cx="50%" cy="42%" r="60%">
      <stop offset="0%" stop-color="${C.lavaDeep}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${C.lavaDeep}" stop-opacity="0"/>
    </radialGradient>`,
    `<linearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.stone}"/>
      <stop offset="100%" stop-color="${C.ashRaised}"/>
    </linearGradient>`,
    `</defs>`,
  );

  // Cone body with a lit crater floor.
  body.push(
    `<path d="${e.cone}" fill="url(#cone)" stroke="${C.slag}" stroke-width="${e.stroke(1.4)}" stroke-linejoin="round"/>`,
  );
  body.push(
    `<path d="${e.cone}" fill="none" stroke="${C.lavaDeep}" stroke-width="${e.stroke(2.2)}" stroke-linejoin="round" opacity="0.9" clip-path="url(#craterClip)"/>`,
  );

  body.push(
    `<defs><clipPath id="craterClip"><rect x="0" y="0" width="${size}" height="${r(e.rimY + e.s * 1)}"/></clipPath></defs>`,
  );

  // Weft threads, clipped to the cone so they read as woven *through* it.
  body.push(`<defs><clipPath id="coneClip"><path d="${e.cone}"/></clipPath></defs>`);
  body.push(`<g clip-path="url(#coneClip)" fill="none" stroke-linecap="round">`);
  e.weft.forEach((points, i) => {
    const opacity = r(0.42 + (i / Math.max(1, e.weft.length - 1)) * 0.5);
    body.push(
      `<polyline points="${points}" stroke="${i % 2 === 0 ? C.lava : C.teal}" stroke-width="${e.stroke(1.7)}" opacity="${opacity}"/>`,
    );
  });
  body.push(`</g>`);

  // The same threads, faint, continuing past the flanks: the signal does not
  // stop at the mountain.
  body.push(`<g fill="none" stroke-linecap="round" opacity="0.22">`);
  e.weft.forEach((points, i) => {
    body.push(
      `<polyline points="${points}" stroke="${i % 2 === 0 ? C.lava : C.teal}" stroke-width="${e.stroke(1.1)}"/>`,
    );
  });
  body.push(`</g>`);

  if (e.plumePaths.length > 0) {
    body.push(`<g fill="none" stroke-linecap="round">`);
    e.plumePaths.forEach((d, i) => {
      const opacity = r(0.85 - i * 0.11);
      body.push(
        `<path d="${d}" stroke="${i % 2 === 0 ? C.teal : C.lava}" stroke-width="${e.stroke(1.9)}" opacity="${opacity}"/>`,
      );
    });
    body.push(`</g>`);
    // The vent itself.
    body.push(
      `<ellipse cx="${r(e.cx)}" cy="${r(e.rimY)}" rx="${r(9 * e.s)}" ry="${r(3.4 * e.s)}" fill="${C.ember}" opacity="0.95"/>`,
    );
  }

  return svgDocument({
    width: size,
    height: size,
    body: body.join("\n"),
    title: "ventloom",
  });
}

/** Horizontal lockup: emblem plus the wordmark. */
function buildWordmark() {
  const W = 760;
  const H = 200;
  const mark = buildMark(160, { threads: 4, plume: 4 }).replace(/^[^\n]*\n/, "");

  const body = [];
  body.push(mark.trimEnd().replace(/<\/svg>\s*$/, ""));
  body.push(
    `<text x="192" y="104" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="62" font-weight="700" letter-spacing="-1.5" fill="${C.bone}">ventloom</text>`,
  );
  body.push(
    `<text x="194" y="140" font-family="ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', monospace" font-size="19" letter-spacing="4.6" fill="${C.muted}">DETERMINISTIC VOLCANO OBSERVATORY</text>`,
  );
  body.push(`<rect x="192" y="60" width="4" height="88" rx="2" fill="${C.lava}"/>`);

  return svgDocument({
    width: W,
    height: H,
    body: body.join("\n"),
    title: "ventloom - deterministic volcano observatory",
  });
}

/** The 1200x630 social card, matching what /og renders at request time. */
function buildBanner() {
  const W = 1200;
  const H = 630;
  const e = emblem({ size: 300, weight: 1.5, threads: 6, plume: 6 });
  const mark = buildMark(300, { threads: 6, plume: 6, background: false })
    .replace(/^[^\n]*\n/, "")
    .replace(/<\/svg>\s*$/, "");

  const body = [];
  body.push(`<defs>`);
  body.push(
    `<radialGradient id="bgGlowA" cx="14%" cy="18%" r="52%">
      <stop offset="0%" stop-color="${C.lavaDeep}" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="${C.lavaDeep}" stop-opacity="0"/>
    </radialGradient>`,
  );
  body.push(
    `<radialGradient id="bgGlowB" cx="86%" cy="84%" r="54%">
      <stop offset="0%" stop-color="${C.tealDim}" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="${C.tealDim}" stop-opacity="0"/>
    </radialGradient>`,
  );
  body.push(`</defs>`);
  body.push(`<rect width="${W}" height="${H}" fill="${C.ash}"/>`);
  body.push(`<rect width="${W}" height="${H}" fill="url(#bgGlowA)"/>`);
  body.push(`<rect width="${W}" height="${H}" fill="url(#bgGlowB)"/>`);

  // The emblem sits large and faint on the right, bleeding toward the edge.
  // Drawn before the text so the headline stays on top, and faded enough that
  // it reads as a watermark rather than as a collision with "forecast".
  body.push(`<g transform="translate(846 132)" opacity="0.42">${mark.trim()}</g>`);

  body.push(
    `<text x="72" y="118" font-family="ui-monospace, 'Cascadia Mono', monospace" font-size="22" letter-spacing="7" fill="${C.lava}">VENTLOOM OBSERVATORY</text>`,
  );
  body.push(
    `<text x="72" y="232" font-family="ui-sans-serif, system-ui, sans-serif" font-size="76" font-weight="700" letter-spacing="-2.2" fill="${C.bone}">Weave volcanic signals</text>`,
  );
  body.push(
    `<text x="72" y="318" font-family="ui-sans-serif, system-ui, sans-serif" font-size="76" font-weight="700" letter-spacing="-2.2" fill="${C.lava}">into an eruption forecast</text>`,
  );
  body.push(
    `<text x="72" y="382" font-family="ui-sans-serif, system-ui, sans-serif" font-size="25" fill="${C.muted}">Mogi inversion, radix-2 tremor spectra, Aitchison tephra correlation,</text>`,
  );
  body.push(
    `<text x="72" y="416" font-family="ui-sans-serif, system-ui, sans-serif" font-size="25" fill="${C.muted}">and an auditable alert engine, from one seeded world.</text>`,
  );

  // Stat strip.
  const stats = [
    ["12", "volcanoes"],
    ["84", "stations"],
    ["60 s", "trace"],
    ["4 km", "typical depth"],
    ["7331", "seed"],
  ];
  stats.forEach(([value, label], i) => {
    const x = 72 + i * 168;
    body.push(
      `<text x="${x}" y="512" font-family="ui-sans-serif, system-ui, sans-serif" font-size="38" font-weight="700" fill="${C.bone}">${value}</text>`,
    );
    body.push(
      `<text x="${x}" y="540" font-family="ui-monospace, 'Cascadia Mono', monospace" font-size="15" letter-spacing="2.4" fill="${C.muted}">${label.toUpperCase()}</text>`,
    );
  });

  body.push(`<rect x="72" y="568" width="${W - 144}" height="2" fill="${C.stone}"/>`);
  // The footer is the least important line on the card, but "least important"
  // is not "invisible": C.slag against C.ash is under 2:1, which is unreadable
  // at the sizes a link preview is actually shown at.
  body.push(
    `<text x="72" y="600" font-family="ui-monospace, 'Cascadia Mono', monospace" font-size="17" letter-spacing="1.6" fill="${C.muted}">deterministic, no API keys, runs in your browser</text>`,
  );
  body.push(
    `<text x="${W - 72}" y="600" text-anchor="end" font-family="ui-monospace, 'Cascadia Mono', monospace" font-size="17" letter-spacing="1.6" fill="${C.muted}">github.com/aniruddhaadak80/ventloom</text>`,
  );

  void e;
  return svgDocument({ width: W, height: H, body: body.join("\n"), title: "ventloom" });
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

const ASSETS = [
  { name: "logo.svg", build: () => buildMark(256, { threads: 5, plume: 5 }) },
  { name: "icon.svg", build: () => buildMark(512, { threads: 6, plume: 6 }) },
  {
    // A favicon is allowed fewer threads and a heavier stroke, because at
    // 16px those are the only settings that survive the downscale.
    name: "favicon.svg",
    build: () => buildMark(64, { weight: 2.6, threads: 3, plume: 3 }),
  },
  { name: "logo-wordmark.svg", build: buildWordmark },
  { name: "banner.svg", build: buildBanner },
];

function main() {
  const check = process.argv.includes("--check");
  mkdirSync(OUT, { recursive: true });

  let drift = 0;
  for (const asset of ASSETS) {
    const path = join(OUT, asset.name);
    const generated = asset.build();

    if (check) {
      let existing = null;
      try {
        existing = readFileSync(path, "utf8");
      } catch {
        console.error(`  missing   ${asset.name}`);
        drift++;
        continue;
      }
      if (existing !== generated) {
        console.error(`  drifted   ${asset.name}`);
        drift++;
        continue;
      }
      console.log(`  ok        ${asset.name}`);
      continue;
    }

    writeFileSync(path, generated, "utf8");
    console.log(
      `  wrote     public/${asset.name}  (${generated.length.toLocaleString("en-US")} bytes)`,
    );
  }

  if (check) {
    if (drift > 0) {
      console.error(`\n  ${drift} asset(s) differ from a fresh generation. Run: bun run assets\n`);
      process.exit(1);
    }
    console.log(`\n  all ${ASSETS.length} assets match a fresh generation.\n`);
    return;
  }

  console.log(`\n  ${ASSETS.length} assets generated deterministically from seed ${SEED}.\n`);
}

main();
