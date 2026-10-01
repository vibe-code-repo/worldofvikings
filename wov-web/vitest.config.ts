import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Eigene Konfiguration, ohne das SvelteKit-Plugin: die Tests laufen auf reinen
// .ts-Modulen (Katalog, Navigation, Markdown) und brauchen weder $app noch
// einen Browser. Für die Komponententests (`*.dom.test.ts`, jsdom; `*.ssr.test.ts`,
// Server-Kompilat) übersetzt das Svelte-Plugin die Komponenten; `$app/state` und
// das Vorschau-Bündel sind durch Attrappen ersetzt.
const hilfen = fileURLToPath(new URL('./src/lib/testhilfen/', import.meta.url));
export default defineConfig({
  plugins: [svelte({ configFile: false })],
  resolve: {
    conditions: ['browser'],
    alias: [
      { find: '$app/state', replacement: `${hilfen}app-state.stub.ts` },
      { find: /^\/assets\/js\/vorschau\.js.*$/, replacement: `${hilfen}fake-vorschau.ts` },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
