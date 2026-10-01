import { describe, expect, it } from 'vitest';
import {
  normalisiereEintrag,
  normalisiereListe,
  normalisiereRecke,
  pruefeSymbol,
  TAFELN,
  tafelZeilen,
} from './recken';

const AUSSEHEN = { figur: 'wikinger', frisur: 'H_01', haarfarbe: 'braun', augenfarbe: 'blau' };
const BASIS = {
  id: 5,
  name: 'Ragnar',
  klasse: 'krieger',
  aussehen: AUSSEHEN,
  erstellt: 1_700_000_000_000,
  zuletztGespielt: null,
};
const WERTE = {
  damage: 1,
  armor: 2,
  strength: 3,
  vitality: 4,
  agility: 5,
  lebenMax: 120,
  nahkampfSchaden: 9,
};

/** Alle Zeichenketten und Schlüssel eines Wertes, für „kommt irgendwo vor“-Prüfungen. */
function alles(v: unknown): string {
  return JSON.stringify(v);
}

describe('Positivliste: nichts Fremdes erreicht die Seite', () => {
  const FREMD = {
    kontoname: 'geheimes-konto',
    konto: 'geheimes-konto',
    kontoId: 77,
    email: 'a@b.c',
    spielerId: 'sp-1',
    position: { x: 10, y: 20, z: 30 },
    spawnPoint: { x: 1, y: 2, z: 3 },
    welt: 'midgard',
    inventar: [{ name: 'Geheimschatz' }],
  };

  it('Eintrag: Kontoname, Position und Inventar werden nicht durchgereicht', () => {
    const e = normalisiereEintrag({ ...BASIS, ...FREMD });
    expect(e).not.toBeNull();
    const text = alles(e);
    for (const wort of [
      'geheimes-konto',
      'a@b.c',
      'sp-1',
      'position',
      'spawnPoint',
      'midgard',
      'Geheimschatz',
      '"x":10',
    ]) {
      expect(text).not.toContain(wort);
    }
    expect(Object.keys(e as object).sort()).toEqual([
      'aussehen',
      'erstellt',
      'id',
      'klasse',
      'name',
      'zuletztGespielt',
    ]);
  });

  it('Profil: dasselbe, auch in verschachtelten Stücken', () => {
    const r = normalisiereRecke({
      ...BASIS,
      ...FREMD,
      ausruestung: {
        kopf: {
          kennung: 'H',
          name: 'Helm',
          seltenheit: 'common',
          itemStufe: 1,
          qualitaet: 0,
          werte: {},
          symbol: null,
          besitzer: 'geheimes-konto',
          position: { x: 1 },
        },
      },
      waffe: null,
      werte: { ...WERTE, kontoname: 'geheimes-konto' },
    });
    expect(r).not.toBeNull();
    const text = alles(r);
    for (const wort of [
      'geheimes-konto',
      'a@b.c',
      'sp-1',
      'position',
      'spawnPoint',
      'midgard',
      'Geheimschatz',
      'besitzer',
      'kontoname',
    ]) {
      expect(text).not.toContain(wort);
    }
  });

  it('Liste: Einträge laufen durch dieselbe Positivliste', () => {
    const l = normalisiereListe({
      eintraege: [{ ...BASIS, ...FREMD }],
      seite: 1,
      seitenGroesse: 24,
      gesamt: 1,
      seiten: 1,
      kontoname: 'geheimes-konto',
    });
    expect(alles(l)).not.toContain('geheimes-konto');
    expect(alles(l)).not.toContain('position');
  });

  it('Ausrüstung in einem unbekannten Platz wird verworfen', () => {
    const r = normalisiereRecke({
      ...BASIS,
      ausruestung: {
        schatztruhe: {
          kennung: 'X',
          name: 'X',
          seltenheit: 'common',
          itemStufe: 1,
          qualitaet: 0,
          werte: {},
          symbol: null,
        },
      },
      waffe: null,
      werte: WERTE,
    });
    expect(r?.ausruestung).toEqual({});
  });
});

describe('optionale Felder', () => {
  it('fehlen sie in der Antwort, fehlen sie im Recken (kein 0)', () => {
    const r = normalisiereRecke({ ...BASIS, ausruestung: {}, waffe: null, werte: WERTE });
    for (const feld of [
      'stufe',
      'erfahrung',
      'tode',
      'spielzeitMinuten',
      'fertigkeiten',
      'profil',
    ]) {
      expect(r).not.toHaveProperty(feld);
    }
  });

  it('sind sie da, bleiben sie, auch die echte 0', () => {
    const r = normalisiereRecke({
      ...BASIS,
      ausruestung: {},
      waffe: null,
      werte: WERTE,
      stufe: 7,
      erfahrung: 0,
      tode: 0,
      spielzeitMinuten: 90,
      fertigkeiten: [
        { name: 'Schmieden', stufe: 12 },
        { name: '', stufe: 1 },
        { name: 'Kaputt', stufe: -3 },
      ],
    });
    expect(r).toMatchObject({ stufe: 7, erfahrung: 0, tode: 0, spielzeitMinuten: 90 });
    expect(r?.fertigkeiten).toEqual([{ name: 'Schmieden', stufe: 12 }]);
  });

  it('Unsinn (Text, negativ, NaN) zählt als fehlend', () => {
    const r = normalisiereRecke({
      ...BASIS,
      ausruestung: {},
      waffe: null,
      werte: WERTE,
      stufe: 'sieben',
      tode: -1,
      erfahrung: Number.NaN,
    });
    expect(r).not.toHaveProperty('stufe');
    expect(r).not.toHaveProperty('tode');
    expect(r).not.toHaveProperty('erfahrung');
  });
});

describe('Pflichtfelder und Symbol', () => {
  it('Eintrag ohne Name, Id oder Aussehen wird verworfen; unlesbare Zeit auch', () => {
    expect(normalisiereEintrag({ ...BASIS, name: '' })).toBeNull();
    expect(normalisiereEintrag({ ...BASIS, id: 0 })).toBeNull();
    expect(normalisiereEintrag({ ...BASIS, id: 1.5 })).toBeNull();
    expect(normalisiereEintrag({ ...BASIS, aussehen: null })).toBeNull();
    expect(normalisiereEintrag({ ...BASIS, erstellt: 1e300 })).toBeNull();
    expect(normalisiereEintrag('Ragnar')).toBeNull();
  });

  it('Symbol nur als /assets/sprites/<name>.png; alles andere wird null', () => {
    expect(pruefeSymbol('/assets/sprites/helm_1.png')).toBe('/assets/sprites/helm_1.png');
    for (const schlecht of [
      'https://boese.example/x.png',
      '/assets/sprites/../../etc.png',
      '/assets/sprites/a b.png',
      '/assets/sprites/x.svg',
      'javascript:alert(1)',
      '',
      null,
      5,
    ]) {
      expect(pruefeSymbol(schlecht)).toBeNull();
    }
  });

  it('ein unbekannte Seltenheit fällt auf common', () => {
    const r = normalisiereRecke({
      ...BASIS,
      ausruestung: {
        kopf: {
          kennung: 'H',
          name: 'Helm',
          seltenheit: 'mythisch',
          itemStufe: 1,
          qualitaet: 0,
          werte: {},
          symbol: null,
        },
      },
      waffe: null,
      werte: WERTE,
    });
    expect(r?.ausruestung.kopf?.seltenheit).toBe('common');
  });
});

describe('Ruhmeshalle', () => {
  const e = (id: number, zuletzt: number | null) => ({
    ...BASIS,
    id,
    name: `R${id}`,
    zuletztGespielt: zuletzt,
  });

  it('es gibt nur Tafeln mit echter Quelle', () => {
    expect(TAFELN.map((t) => t.id)).toEqual(['aktiv']);
  });

  it('„zuletzt aktiv“ sortiert absteigend und lässt nie Gespielte weg', () => {
    const zeilen = tafelZeilen(TAFELN[0], [e(1, 100), e(2, null), e(3, 300), e(4, 200)]);
    expect(zeilen.map((z) => z.eintrag.id)).toEqual([3, 4, 1]);
  });
});
