import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright runs against a production build, not a dev server: the observatory
 * is server-rendered, and only a production build exercises the same code path
 * the deployment does.
 *
 * The host is `localhost` and not `127.0.0.1`. `next start` listens on `::` and
 * both resolve to the same socket, but the Windows system proxy applies its
 * loopback bypass to `localhost` only, so a request to `127.0.0.1` hangs until
 * the client times out while the identical request to `localhost` returns
 * immediately. That asymmetry is invisible until a web server poll waits on it.
 */
const HOST = process.env.PLAYWRIGHT_HOST ?? "localhost";
const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [["github"], ["line"]] : [["line"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Only the server is started here. The production build runs as its own
    // step (`bun run build` in CI, or `bun run test:e2e` at the repo root),
    // because Next's "Collecting build traces" phase stalls when it is spawned
    // from a Node child process with inherited stdio on Windows.
    //
    // `ignore` rather than `pipe`: the observatory logs on every request and a
    // full captured pipe makes the server abort mid-run.
    command: "bun run start",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: process.env.PLAYWRIGHT_SERVER_DEBUG ? "pipe" : "ignore",
    stderr: process.env.PLAYWRIGHT_SERVER_DEBUG ? "pipe" : "ignore",
  },
});
