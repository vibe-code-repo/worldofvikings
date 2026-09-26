import { defineConfig } from 'vitest/config';

// Eigene Konfiguration, ohne das SvelteKit-Plugin: die Tests laufen auf reinen
// .ts-Modulen (Katalog, Navigation, Markdown) und brauchen weder $app noch
// einen Browser.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
