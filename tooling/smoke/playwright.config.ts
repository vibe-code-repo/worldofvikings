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
const API_PORT = 3100;
const EDITOR_PORT = 5184;

/**
 * The asset server the smoke run points the apps at.
 *
 * Overridable because two people — or two agents — running the suite at once
 * would otherwise share one asset server, and they may have different stores
 * mounted: `WOV_ASSET_STORE` belongs to whoever started the process, and
 * `reuseExistingServer` cannot see that. `SMOKE_ASSET_PORT` gives a run its own.
 */
const ASSET_PORT = Number(process.env['SMOKE_ASSET_PORT'] ?? 9000);
const apiUrl = `http://localhost:${String(API_PORT)}`;
const editorUrl = `http://localhost:${String(EDITOR_PORT)}`;
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
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    // The tests read these instead of hard-coding a port twice.
    baseURL: editorUrl,
  },
  metadata: { apiUrl, editorUrl, assetUrl, contentDir },
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      command: 'pnpm --filter @wov/website dev',
      url: 'http://localhost:5172',
      cwd: repoRoot,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @wov/game dev',
      url: 'http://localhost:5173',
      cwd: repoRoot,
      env: { VITE_ASSET_URL: assetUrl },
      reuseExistingServer: !process.env['CI'],
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
        API_CORS_ORIGINS: editorUrl,
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
      // starts; never on a port a run asked for itself.
      reuseExistingServer: ASSET_PORT === 9000 && !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
