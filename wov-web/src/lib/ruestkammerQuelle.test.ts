import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Quelltext-Wächter: Die Demo-Daten dürfen nicht zurückkommen, und die
// Rüstkammer-Seiten bleiben serverseitig. Gelesen wird mit `node:fs` relativ
// zum Paket (vitest läuft mit cwd = wov-web).

const WURZEL = process.cwd();

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    return statSync(pfad).isDirectory() ? dateien(pfad) : [pfad];
  });
}

const QUELLEN = dateien(join(WURZEL, 'src')).filter(
  (p) => /\.(ts|svelte)$/.test(p) && !/\.test\.ts$/.test(p),
);

describe('keine Demo-Daten mehr', () => {
  it('die Demo-Datei static/api/recken.json ist weg', () => {
    expect(existsSync(join(WURZEL, 'static/api/recken.json'))).toBe(false);
  });

  it('kein Quelltext lädt /api/recken.json', () => {
    const treffer = QUELLEN.filter((p) => readFileSync(p, 'utf8').includes('recken.json'));
    expect(treffer).toEqual([]);
  });

  it('Rüstkammer und Ruhmeshalle laden nichts im Browser nach', () => {
    for (const seite of ['ruestkammer', 'ruhmeshalle']) {
      const svelte = readFileSync(
        join(WURZEL, `src/routes/[lang=lang]/${seite}/+page.svelte`),
        'utf8',
      );
      expect(svelte).not.toMatch(/holeJson|onMount|fetch\(/);
      const server = readFileSync(
        join(WURZEL, `src/routes/[lang=lang]/${seite}/+page.server.ts`),
        'utf8',
      );
      expect(server).toMatch(/export const prerender = false/);
    }
  });

  it('die Demo-Hinweise sind aus dem Katalog', () => {
    const katalog = readFileSync(join(WURZEL, 'src/lib/i18n/de.ts'), 'utf8');
    expect(katalog).not.toMatch(/armory\.hint\.|hall_of_fame\.hint\./);
  });
});

describe('Anzeige', () => {
  it('das Profil reicht Kontoname und Position nicht an die Seite (kein Feld dafür im Typ)', () => {
    const typen = readFileSync(join(WURZEL, 'src/lib/recken.ts'), 'utf8');
    const schnitt = typen.slice(
      typen.indexOf('export interface Recke extends'),
      typen.indexOf('export interface ReckenListe'),
    );
    expect(schnitt).not.toMatch(/kontoname|kontoId|email|position|spawn|spielerId|inventar/i);
  });
});
