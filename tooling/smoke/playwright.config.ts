import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');

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
  use: { ...devices['Desktop Chrome'], headless: true },
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
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @wov/editor dev',
      url: 'http://localhost:5174',
      cwd: repoRoot,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @wov/api dev',
      url: 'http://localhost:3000/health',
      cwd: repoRoot,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm run dev:assets',
      url: 'http://localhost:9000/health',
      cwd: repoRoot,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
