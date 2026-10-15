#!/usr/bin/env node
/**
 * loc-count.mjs — zero-dependency line-of-code counter for the amazing-repo scale engine.
 *
 * Usage:
 *   node scripts/loc-count.mjs [rootDir] [--min-lines N] [--json]
 *
 * - Walks rootDir (default: cwd), skipping vendor/build dirs.
 * - Counts every line of every file with a recognized extension.
 * - Splits "code lines" (source) from "total lines" (source + docs/config/assets).
 * - Exits 1 when --min-lines is set and total lines fall short (good as a CI guardrail).
 */
import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".pl",
  ".pm",
  ".rake",
  ".gemspec",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".cs",
  ".php",
  ".lua",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".scala",
  ".clj",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".psm1",
  ".bat",
  ".cmd",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".vue",
  ".svelte",
  ".astro",
]);

const NON_CODE_EXTS = new Set([
  ".md",
  ".mdx",
  ".rst",
  ".txt",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".ini",
  ".cfg",
  ".svg",
  ".mmd",
  ".mermaid",
  ".csv",
  ".tsv",
  ".graphql",
  ".gql",
  ".proto",
  ".lock",
  ".env",
  ".example",
  ".gitignore",
  ".editorconfig",
  ".dockerignore",
]);

const ALL_EXTS = new Set([...CODE_EXTS, ...NON_CODE_EXTS]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".git",
  ".hg",
  ".svn",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".cache",
  "tmp",
  ".vercel",
  ".output",
  ".netlify",
  ".parcel-cache",
  ".pnp",
  ".yarn",
  ".gradle",
  ".idea",
  ".vscode",
]);

const args = process.argv.slice(2);
let root = process.cwd();
let minLines = 0;
let jsonOut = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--min-lines") minLines = Number(args[++i] ?? 0);
  else if (a === "--json") jsonOut = true;
  else if (!a.startsWith("--")) root = a;
}
root = resolve(root);

/** Count lines by scanning 0x0A bytes in a stream (fast on huge trees). */
function countLines(file) {
  return new Promise((res, rej) => {
    let n = 0;
    let lastByte = -1;
    const stream = createReadStream(file);
    stream.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) n++;
        else lastByte = chunk[i];
      }
    });
    stream.on("end", () => res(n + (lastByte === -1 ? 0 : 1))); // trailing newline-safe
    stream.on("error", rej);
  });
}

async function walk(dir, agg) {
  let handle;
  try {
    handle = await opendir(dir);
  } catch {
    return;
  }
  for await (const entry of handle) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, agg);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    const specialNoExtNames = [
      ".gitignore",
      ".editorconfig",
      ".dockerignore",
      ".gitattributes",
      ".npmrc",
    ];
    if (!ALL_EXTS.has(ext) && !specialNoExtNames.includes(entry.name.toLowerCase())) continue;
    const bytes = await countLines(full);
    const st = await stat(full);
    agg.files++;
    agg.lines += bytes;
    agg.bytes += st.size;
    const key = ext || entry.name.toLowerCase();
    if (!agg.byExt.has(key)) agg.byExt.set(key, { lines: 0, files: 0 });
    const bucket = agg.byExt.get(key);
    bucket.lines += bytes;
    bucket.files += 1;
  }
}

const agg = { files: 0, lines: 0, bytes: 0, byExt: new Map() };
await walk(root, agg);

let codeLines = 0;
let codeFiles = 0;
for (const [ext, v] of agg.byExt) {
  if (CODE_EXTS.has(ext)) {
    codeLines += v.lines;
    codeFiles += v.files;
  }
}

if (jsonOut) {
  console.log(
    JSON.stringify(
      {
        root,
        files: agg.files,
        codeLines,
        codeFiles,
        totalLines: agg.lines,
        totalBytes: agg.bytes,
        byExt: Object.fromEntries([...agg.byExt].sort((a, b) => b[1].lines - a[1].lines)),
      },
      null,
      2,
    ),
  );
} else {
  const rows = [...agg.byExt].sort((a, b) => b[1].lines - a[1].lines);
  const w = Math.max(...rows.map(([e]) => e.length), 8);
  console.log(`\n  LOC report — ${root}`);
  console.log(`  ${"ext".padEnd(w)}  ${"files".padStart(7)}  ${"lines".padStart(10)}`);
  console.log(`  ${"-".repeat(w)}  ${"-".repeat(7)}  ${"-".repeat(10)}`);
  for (const [ext, v] of rows) {
    console.log(
      `  ${ext.padEnd(w)}  ${String(v.files).padStart(7)}  ${v.lines.toLocaleString("en-US").padStart(10)}`,
    );
  }
  console.log(`  ${"-".repeat(w)}  ${"-".repeat(7)}  ${"-".repeat(10)}`);
  console.log(
    `  ${"TOTAL".padEnd(w)}  ${String(agg.files).padStart(7)}  ${agg.lines.toLocaleString("en-US").padStart(10)}`,
  );
  console.log(
    `\n  code lines (source only): ${codeLines.toLocaleString("en-US")} in ${codeFiles.toLocaleString("en-US")} files`,
  );
  console.log(`  total lines (with docs/config/assets): ${agg.lines.toLocaleString("en-US")}\n`);
}

if (minLines > 0 && agg.lines < minLines) {
  console.error(
    `FAIL: total lines ${agg.lines.toLocaleString("en-US")} < required ${minLines.toLocaleString("en-US")}`,
  );
  process.exit(1);
}
