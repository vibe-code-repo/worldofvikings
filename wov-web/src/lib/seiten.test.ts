import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { kanonischerPfad, LOCALES, localizedPath, SLUGS } from './i18n';
import { FAHRT, HAUPTNAV, RECHTSNAV } from './seiten';

const SEITEN = [...HAUPTNAV.map((s) => s.pfad), ...RECHTSNAV.map((s) => s.pfad), FAHRT];
const TABELLE: Record<string, Record<string, string> | undefined> = SLUGS;

describe('seiten.ts und Adress-Tabelle', () => {
  it('jede Seite hat in beiden Sprachen einen Slug und findet zurueck', () => {
    for (const pfad of SEITEN) {
      for (const l of LOCALES) {
        const adresse = localizedPath(l, pfad);
        if (pfad === '/') {
          expect(adresse).toBe(`/${l}`);
          continue;
        }
        const slug = TABELLE[pfad]?.[l];
        expect(slug, `${pfad} hat keinen ${l}-Slug`).toBeTruthy();
        expect(adresse).toBe(`/${l}/${slug}`);
        expect(kanonischerPfad(l, slug ?? '')).toBe(pfad);
      }
    }
  });

  it('die Slugs sind je Sprache eindeutig', () => {
    for (const l of LOCALES) {
      const slugs = Object.values(SLUGS).map((e) => e[l]);
      const doppelt = slugs.filter((s, i) => slugs.indexOf(s) !== i);
      expect(doppelt, `doppelte ${l}-Slugs`).toEqual([]);
    }
  });

  it('die Pfade in HAUPTNAV, RECHTSNAV und FAHRT sind eindeutig', () => {
    const doppelt = SEITEN.filter((s, i) => SEITEN.indexOf(s) !== i);
    expect(doppelt).toEqual([]);
  });

  it('jeder Seiten-Ordner unter [lang=lang] steht in SLUGS', () => {
    const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes', '[lang=lang]');
    const ordner: string[] = [];
    const gehe = (dir: string, pfad: string) => {
      for (const name of readdirSync(dir)) {
        const voll = join(dir, name);
        if (!statSync(voll).isDirectory() || name.includes('[')) continue;
        ordner.push(`${pfad}/${name}`);
        gehe(voll, `${pfad}/${name}`);
      }
    };
    gehe(wurzel, '');
    // Ordner ohne eigene Seite (nur dynamische Kinder) stehen trotzdem in
    // SLUGS; darum reicht die Richtung Ordner -> Tabelle.
    expect(ordner.filter((p) => !(p in SLUGS))).toEqual([]);
  });
});
