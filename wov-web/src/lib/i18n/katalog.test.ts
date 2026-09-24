import { describe, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';

// `Messages` prueft das schon zur Uebersetzungszeit, aber nur in
// `svelte-check`. Dieser Test haelt es auch fuer `vitest` fest und faengt den
// Fall, dass jemand `en` mit einem Cast am Typ vorbeischiebt.
describe('i18n-Katalog', () => {
  it('de und en haben dieselben Schluessel', () => {
    const deKeys = Object.keys(de).sort();
    const enKeys = Object.keys(en).sort();
    expect(deKeys.filter((k) => !(k in en))).toEqual([]);
    expect(enKeys.filter((k) => !(k in de))).toEqual([]);
    expect(enKeys).toEqual(deKeys);
  });

  it('kein Eintrag ist leer', () => {
    for (const [name, katalog] of [
      ['de', de],
      ['en', en],
    ] as const) {
      const leer = Object.entries(katalog).filter(([, v]) => String(v).trim() === '');
      expect(leer.map(([k]) => `${name}:${k}`)).toEqual([]);
    }
  });
});
