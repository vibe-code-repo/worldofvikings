import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * One Vitest run for the whole workspace.
 *
 * `@wov/*` is aliased to the package sources so tests always exercise the
 * current source instead of a possibly stale `dist/`.
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
    include: ['packages/*/src/**/*.test.ts', 'services/*/src/**/*.test.ts'],
    reporters: ['default'],
  },
});
