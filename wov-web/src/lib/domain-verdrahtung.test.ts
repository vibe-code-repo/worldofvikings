/**
 * Karte D1, Angriffsbefunde C2/C3 (Opus-Prüfung c2c2765): `Kopfdaten.svelte`
 * und die Sitemap-Route sind Svelte-/Route-Dateien, keine reinen .ts-Module —
 * `basisDomains.test.ts` prüft nur die PURE Funktionen, nicht ihre
 * VERDRAHTUNG. Ein Mutant, der `Kopfdaten.svelte`s canonical fest auf `'en'`
 * dreht oder der Sitemap `<loc>` fest auf `.com`, überlebte deshalb, obwohl
 * die Funktionen selbst korrekt bleiben.
 *
 * Textnachweis auf dem Quelltext (wie `client/test/direct-handoff.ts`):
 * kein Svelte-Compiler/-Renderer nötig, wov-web/vitest.config.ts lädt das
 * SvelteKit-Plugin ohnehin nicht (reine .ts-Module, s. dort).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const kopfdaten = readFileSync(resolve(HERE, 'Kopfdaten.svelte'), 'utf-8');
const sitemap = readFileSync(resolve(HERE, '../routes/sitemap.xml/+server.ts'), 'utf-8');

describe('Kopfdaten.svelte: canonical/hreflang folgen der VARIABLEN Sprache', () => {
  it('der Ursprung kommt aus CANONICAL_HOME[lang] (oder der Überschreibung), nicht aus einer festen Sprache', () => {
    expect(kopfdaten).toMatch(/ursprungUeberschreiben\s*\?\?\s*CANONICAL_HOME\[lang\]/);
    expect(kopfdaten).not.toMatch(/CANONICAL_HOME\[?['"]?en['"]?\]?\s*\+/);
    expect(kopfdaten).not.toMatch(/CANONICAL_HOME\.en/);
    expect(kopfdaten).not.toMatch(/CANONICAL_HOME\.de/);
  });

  it('hreflang ruft hreflangAdresse mit der Schleifenvariable auf, nicht mit einer festen Sprache', () => {
    expect(kopfdaten).toMatch(/hreflangAdresse\(l,/);
    expect(kopfdaten).not.toMatch(/hreflangAdresse\(\s*['"](en|de)['"]/);
  });

  it('x-default ist die eine Konstante X_DEFAULT_ADRESSE, kein Funktionsaufruf mit einem Pfad', () => {
    expect(kopfdaten).toMatch(/hreflang="x-default"\s+href=\{X_DEFAULT_ADRESSE\}/);
  });
});

describe('Sitemap-Route: <loc> und x-default folgen derselben Regel', () => {
  it('<loc> und hreflang kommen aus sitemapAdresse(l, pfad), nicht aus einer festen Sprache', () => {
    expect(sitemap).toMatch(/<loc>\$\{sitemapAdresse\(l, pfad\)\}<\/loc>/);
    expect(sitemap).not.toMatch(/sitemapAdresse\(\s*['"](en|de)['"]/);
  });

  it('x-default ist X_DEFAULT_ADRESSE, keine je-Seite lokalisierte Fassung', () => {
    expect(sitemap).toMatch(/hreflang="x-default"\s+href="\$\{X_DEFAULT_ADRESSE\}"/);
  });
});
