import { describe, expect, it } from 'vitest';
import type { Recke, Stueck } from './recken';
import {
  ausruestungsZeilen,
  fertigkeitenListe,
  figurStuecke,
  glyphe,
  klassenName,
  listenAdresse,
  optionaleFelder,
  profilAdresse,
  reckenIdAus,
  seltenheitStufe,
  spielzeitText,
  stueckName,
  stueckWerte,
  symbolAnzeige,
  zaehlerText,
  zahlText,
} from './reckenAnzeige';

const STUECK: Stueck = {
  kennung: 'IronwardHelmet',
  name: 'Eisenwacht-Helm',
  seltenheit: 'rare',
  itemStufe: 3,
  qualitaet: 0,
  werte: { armor: 4, agility: 0 },
  symbol: '/assets/sprites/helm.png',
};

const RECKE: Recke = {
  id: 1,
  name: 'Ragnar',
  klasse: 'krieger',
  aussehen: { figur: 'wikinger', frisur: 'H_01', haarfarbe: 'braun', augenfarbe: 'blau' },
  erstellt: 1,
  zuletztGespielt: null,
  ausruestung: { kopf: STUECK },
  waffe: null,
  werte: {
    damage: 0,
    armor: 4,
    strength: 0,
    vitality: 0,
    agility: 0,
    lebenMax: 100,
    nahkampfSchaden: 3,
  },
};

describe('Symbol und Rückfall', () => {
  it('mit Symbol ein Bild, dessen Ersatztext die Glyphe des Platzes ist (Rückfall ohne JS)', () => {
    expect(symbolAnzeige('kopf', STUECK)).toEqual({
      art: 'bild',
      src: '/assets/sprites/helm.png',
      alt: glyphe('kopf'),
    });
  });

  it('ohne Symbol steht die Glyphe selbst da', () => {
    expect(symbolAnzeige('waffe', { symbol: null })).toEqual({
      art: 'glyphe',
      zeichen: glyphe('waffe'),
    });
  });

  it('jeder Platz hat eine eigene, nicht leere Glyphe', () => {
    for (const z of ausruestungsZeilen(RECKE)) expect(glyphe(z.platz).length).toBeGreaterThan(0);
  });
});

describe('Name', () => {
  it('der Katalog gewinnt, wenn er den Schlüssel kennt', () => {
    expect(
      stueckName({ name: 'Eisenwacht-Helm', textKey: 'inhalt.item.x' }, (k) =>
        k === 'inhalt.item.x' ? 'Iron Helm' : undefined,
      ),
    ).toBe('Iron Helm');
  });
  it('sonst gilt der Name — auch bei leerem Katalogtext oder ohne Schlüssel', () => {
    expect(stueckName({ name: 'Sax', textKey: 'inhalt.item.fehlt' }, () => undefined)).toBe('Sax');
    expect(stueckName({ name: 'Sax', textKey: 'inhalt.item.leer' }, () => '  ')).toBe('Sax');
    expect(stueckName({ name: 'Sax' }, () => 'egal')).toBe('Sax');
  });
});

describe('optionale Felder erscheinen nur, wenn vorhanden', () => {
  it('ohne Felder: keine Zeile, kein „0“', () => {
    expect(optionaleFelder(RECKE)).toEqual([]);
    expect(fertigkeitenListe(RECKE)).toEqual([]);
  });

  it('mit Feldern: genau diese Zeilen, die 0 bleibt eine Aussage', () => {
    const felder = optionaleFelder({ ...RECKE, stufe: 4, tode: 0, spielzeitMinuten: 125 });
    expect(felder).toEqual([
      { schluessel: 'stufe', wert: '4' },
      { schluessel: 'tode', wert: '0' },
      { schluessel: 'spielzeit', wert: '2 h 5 min' },
    ]);
  });

  it('Fertigkeiten: höchste zuerst, leere Liste = keine Tafel', () => {
    expect(
      fertigkeitenListe({
        ...RECKE,
        fertigkeiten: [
          { name: 'a', stufe: 2 },
          { name: 'b', stufe: 9 },
        ],
      }).map((f) => f.name),
    ).toEqual(['b', 'a']);
    expect(fertigkeitenListe({ ...RECKE, fertigkeiten: [] })).toEqual([]);
  });

  it('Spielzeit', () => {
    expect(spielzeitText(0)).toBe('0 min');
    expect(spielzeitText(59)).toBe('59 min');
    expect(spielzeitText(60)).toBe('1 h 0 min');
  });
});

describe('Ausrüstung', () => {
  it('Zeilen: Waffe zuerst, dann elf Körperplätze; leere Plätze bleiben als Zeile', () => {
    const zeilen = ausruestungsZeilen(RECKE);
    expect(zeilen).toHaveLength(12);
    expect(zeilen[0]).toEqual({ platz: 'waffe', stueck: null });
    expect(zeilen.find((z) => z.platz === 'kopf')?.stueck).toBe(STUECK);
    expect(zeilen.find((z) => z.platz === 'schuhe')?.stueck).toBeNull();
  });

  it('Werte eines Stücks ohne Nullen', () => {
    expect(stueckWerte(STUECK)).toEqual([['armor', 4]]);
  });

  it('die Figur bekommt die Kennungen der angelegten Stücke, auch der Waffe', () => {
    const waffe: Stueck = { ...STUECK, kennung: 'Sax', name: 'Sax' };
    expect(figurStuecke({ ...RECKE, waffe })).toEqual([
      { kennung: 'Sax' },
      { kennung: 'IronwardHelmet' },
    ]);
  });

  it('Seltenheit wird zu einem Rahmen 1…4', () => {
    expect(
      ['common', 'uncommon', 'rare', 'epic', 'legendary'].map((s) =>
        seltenheitStufe(s as Stueck['seltenheit']),
      ),
    ).toEqual([1, 2, 3, 4, 4]);
  });
});

describe('Adressen', () => {
  it('Liste: Standardwerte bleiben weg, Suche wird kodiert', () => {
    expect(listenAdresse('/de/ruestkammer', '', 1)).toBe('/de/ruestkammer');
    expect(listenAdresse('/de/ruestkammer', 'Thór', 3)).toBe('/de/ruestkammer?q=Th%C3%B3r&seite=3');
    expect(listenAdresse('/de/ruestkammer', '', 2)).toBe('/de/ruestkammer?seite=2');
  });
  it('Profil und Id', () => {
    expect(profilAdresse('/en/armory', 12)).toBe('/en/armory?reck=12');
    expect(reckenIdAus('12')).toBe(12);
    for (const schlecht of [null, '', '0', '-1', '1.5', '1e3', 'abc', '12abc', '9'.repeat(30)])
      expect(reckenIdAus(schlecht)).toBeNull();
  });
});

describe('Klasse, Zähler, Zahlen', () => {
  const KATALOG = {
    'armory.klasse.krieger': 'Warrior',
    'armory.list.count_one': '{n} hero',
    'armory.list.count_other': '{n} heroes',
  };
  it('der Klassenname kommt aus dem Katalog; unbekannt bleibt die Kennung, leer bleibt leer', () => {
    expect(klassenName('krieger', KATALOG)).toBe('Warrior');
    expect(klassenName('zauberer', KATALOG)).toBe('zauberer');
    expect(klassenName('', KATALOG)).toBe('');
    expect(klassenName('constructor', KATALOG)).toBe('constructor');
  });
  it('Plural: 1 Recke, sonst Recken', () => {
    expect(zaehlerText(1, KATALOG, 'en')).toBe('1 hero');
    expect(zaehlerText(0, KATALOG, 'en')).toBe('0 heroes');
    expect(zaehlerText(1234, KATALOG, 'en')).toBe('1,234 heroes');
  });
  it('Zahlen tragen die Trenner der Sprache', () => {
    expect(zahlText(1234567, 'de')).toBe('1.234.567');
    expect(zahlText(1234567, 'en')).toBe('1,234,567');
  });
});

describe('leerer Zustand', () => {
  it('eine leere Liste hat keine Zeilen zu zeigen', () => {
    // Die Seite zeigt bei `eintraege.length === 0` den ehrlichen Leertext; hier nur,
    // dass Adressen für Seite 1 ohne Suche die Kammer selbst sind (Zurück-Ziel).
    expect(listenAdresse('/de/ruestkammer', '', 1)).toBe('/de/ruestkammer');
  });
});
