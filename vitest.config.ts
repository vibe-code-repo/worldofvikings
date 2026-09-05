import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * One Vitest run for the whole workspace.
 *
 * `@wov/*` is aliased to the package sources so tests always exercise the
 * current source instead of a possibly stale `dist/`.
 *
 * `apps/*` is included because the device edge lives in the app, not in a
 * package: the keyboard/mouse adapter and the frame loop of `apps/game` are
 * testable logic (ADR-0008) and would otherwise be the only untested code in
 * the project.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@wov\/([^/]+)$/,
        replacement: resolve(import.meta.dirname, 'packages/$1/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'apps/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'services/*/src/**/*.test.ts',
      // The asset server's routing lives in tooling and is the one decision
      // there that fails silently rather than loudly (ADR-0015).
      'tooling/**/*.test.ts',
    ],
    reporters: ['default'],
  },
});
