import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '../..');

/**
 * The editor can save, so the smoke run must not write into the repository.
 *
 * `CONTENT_DIR` points the API at a throwaway copy of `content/`: the tests see
 * the real worlds and the real prefab catalogues, and `git status` is clean
 * afterwards whatever they do. A fresh directory per run also means the suite
 * is repeatable — the second run does not start from the first one's edits.
 */
const contentDir = mkdtempSync(join(tmpdir(), 'wov-smoke-content-'));
for (const folder of ['worlds', 'prefabs']) {
  mkdirSync(join(contentDir, folder), { recursive: true });
  cpSync(join(repoRoot, 'content', folder), join(contentDir, folder), { recursive: true });
}

/**
 * Ports of their own, so `pnpm smoke` can run while `pnpm dev` is up.
 *
 * The API and the editor are the two servers the tests *change* — the API
 * writes files and the editor has to point at that API — and reusing a
 * developer's already-running pair would have written the test's worlds into
 * the repository through it (`reuseExistingServer` cannot tell two differently
 * configured servers apart, it only probes the URL).
 */
/**
 * Every port is overridable, so two checkouts can run the suite at the same
 * time.
 *
 * The defaults are the ones a single developer expects. Parallel work — two
 * agents on two worktrees — collides on all five otherwise, and the collision is
 * not a clean failure: `reuseExistingServer` cannot tell two differently
 * configured servers apart, so one run's test can be answered by the other run's
 * API against the other checkout's content.
 */
function port(name: string, fallback: number): number {
  const configured = process.env[name]?.trim() ?? '';
  if (configured === '') {
    return fallback;
  }
  const parsed = Number.parseInt(configured, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${name} must be a TCP port, got: ${configured}`);
  }
  return parsed;
}

const WEBSITE_PORT = port('SMOKE_WEBSITE_PORT', 5172);
const GAME_PORT = port('SMOKE_GAME_PORT', 5173);
const ASSET_PORT = port('SMOKE_ASSET_PORT', 9000);
const API_PORT = port('SMOKE_API_PORT', 3100);
const EDITOR_PORT = port('SMOKE_EDITOR_PORT', 5184);
const apiUrl = `http://localhost:${String(API_PORT)}`;
const editorUrl = `http://localhost:${String(EDITOR_PORT)}`;
const websiteUrl = `http://localhost:${String(WEBSITE_PORT)}`;
const gameUrl = `http://localhost:${String(GAME_PORT)}`;
const assetUrl = `http://localhost:${String(ASSET_PORT)}`;

/**
 * Smoke tests (agent principle: prove "it runs", do not claim it).
 *
 * Playwright starts the real development servers and each test asserts one
 * visible marker per app plus the API health endpoint. Chromium only — this is
 * a liveness check, not a cross-browser suite.
 *
 * Requires the browser binary once: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: import.meta.dirname,
  /*
   * Ninety seconds, because the village is what most of these tests open and
   * the client needs about ten of them before a measurement means anything:
   * terrain ready at roughly four seconds, the zone's 5248 entities placed six
   * seconds after that (ADR-0025). A test that starts measuring earlier is
   * measuring a tab that is still loading — `groundSettled` waits for both, and
   * this budget is what leaves the test room to do its own work afterwards.
   */
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    /*
     * Headless Chromium picks SwiftShader — a software rasteriser — unless it is
     * told otherwise, and these tests are about a 3D client. Measured on the
     * village after the scatter runs (1.76 M triangles): with the default flags
     * the render loop drops to roughly 0.2 frames per second, so a test that
     * holds a key for half a second sees the capsule move 18 cm and a camera
     * gesture never lands. With ANGLE on the machine's own driver it runs at
     * 50-60. The flags are a request, not an assertion: where no GPU answers,
     * Chromium falls back to SwiftShader exactly as before.
     */
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=vulkan', '--ignore-gpu-blocklist'],
    },
    // The tests read these instead of hard-coding a port twice.
    baseURL: editorUrl,
  },
  metadata: { apiUrl, editorUrl, websiteUrl, gameUrl, assetUrl, contentDir },
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      command: `pnpm --filter @wov/website dev --port ${String(WEBSITE_PORT)} --strictPort`,
      url: websiteUrl,
      cwd: repoRoot,
      env: { VITE_GAME_URL: gameUrl },
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @wov/game dev --port ${String(GAME_PORT)} --strictPort`,
      url: gameUrl,
      cwd: repoRoot,
      env: { VITE_API_URL: apiUrl, VITE_ASSET_URL: assetUrl },
      // Never reuse, for the same reason as the editor below: the game now
      // reads its world from the API (ADR-0022), and a server started by
      // `pnpm dev` points at a different one.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @wov/editor dev --port ${String(EDITOR_PORT)}`,
      url: editorUrl,
      cwd: repoRoot,
      env: { VITE_API_URL: apiUrl, VITE_ASSET_URL: assetUrl },
      // Never reuse: a server started by `pnpm dev` points at the API in
      // `content/`, and the save test would edit the repository through it.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @wov/api dev',
      url: `${apiUrl}/health`,
      cwd: repoRoot,
      env: {
        API_PORT: String(API_PORT),
        CONTENT_DIR: contentDir,
        // Both browser clients call it now (ADR-0022).
        API_CORS_ORIGINS: `${editorUrl},${gameUrl}`,
        // The one directory the editor's *World → Import scene bundle…* may
        // read from (ADR-0033). Without it the action answers 501, which is
        // the correct answer for a deployment that has no bundles — and would
        // make the parity test's import step untestable, so the suite points
        // it at the committed fixture bundle.
        WOV_IMPORT_DIR: join(repoRoot, 'tooling', 'fixtures', 'scenes'),
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm run dev:assets',
      url: `${assetUrl}/health`,
      cwd: repoRoot,
      env: { ASSET_PORT: String(ASSET_PORT) },
      // Reused on the default port, where it is the same server `pnpm dev`
      // starts; never on a port a run asked for itself, because the store a
      // running asset server has mounted is invisible from the outside.
      reuseExistingServer: ASSET_PORT === 9000 && !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
