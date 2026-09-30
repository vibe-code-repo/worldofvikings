import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import {
  DATEI_MAX_BYTES,
  fuegeEin,
  fuerAnzeige,
  istDatum,
  leseDevlog,
  pruefeEintrag,
  pruefeWortLaenge,
  serialisiere,
  unerlaubteZeichen,
  WORT_MAX,
} from './devlog';
import { localizedPath } from './i18n';
import { HAUPTNAV, SITEMAP } from './seiten';

const HIER = dirname(fileURLToPath(import.meta.url));

const text = (titel: string) => ({ titel, punkte: ['Ein Punkt.'] });
const tag = (datum: string, titel = 'Titel') => ({
  datum,
  de: text(titel),
  en: text(`${titel} (en)`),
});

describe('devlog: Schema', () => {
  it('nimmt einen vollständigen Eintrag an', () => {
    expect(pruefeEintrag(tag('2026-09-30'), true)).toEqual([]);
  });

  it('prüft Datum als Kalendertag', () => {
    expect(istDatum('2026-09-30')).toBe(true);
    expect(istDatum('2026-02-31')).toBe(false);
    expect(istDatum('2026-9-30')).toBe(false);
    expect(istDatum(20260930)).toBe(false);
  });

  it('prüft Grenzen: Titel 1–80, 1–8 Punkte, Punkt 1–280 Zeichen', () => {
    const mit = (titel: string, punkte: string[]) =>
      pruefeEintrag({ datum: '2026-09-30', de: { titel, punkte } });
    expect(mit('x'.repeat(80), ['y'.repeat(280)])).toEqual([]);
    expect(mit('x'.repeat(81), ['y'])).not.toEqual([]);
    expect(mit('', ['y'])).not.toEqual([]);
    expect(mit('x', [])).not.toEqual([]);
    expect(mit('x', Array(9).fill('y'))).not.toEqual([]);
    expect(mit('x', Array(8).fill('y'))).toEqual([]);
    expect(mit('x', ['y'.repeat(281)])).not.toEqual([]);
    expect(mit('x', [' '])).not.toEqual([]);
    // Zeichen, nicht UTF-16-Einheiten: 80 Emoji sind erlaubt.
    expect(mit('😀'.repeat(80), ['y'])).toEqual([]);
  });

  it('verlangt je nach Schalter beide Sprachen oder mindestens eine', () => {
    const nurDe = { datum: '2026-09-30', de: text('T') };
    expect(pruefeEintrag(nurDe, true).join()).toContain('en: fehlt');
    expect(pruefeEintrag(nurDe)).toEqual([]);
    expect(pruefeEintrag({ datum: '2026-09-30' })).not.toEqual([]);
    // Ein vorhandener, aber ungültiger Block ist ein Fehler, keine fehlende Sprache.
    expect(pruefeEintrag({ datum: '2026-09-30', de: text('T'), en: { titel: '' } })).not.toEqual(
      [],
    );
  });
});

describe('devlog: Wortlänge (nur beim Eintragen)', () => {
  const langes = 'w'.repeat(WORT_MAX + 1);
  const mit = (titel: string, punkt: string) => ({
    datum: '2026-09-30',
    de: { titel, punkte: [punkt] },
    en: text('T'),
  });

  it('lehnt Wörter über 40 Zeichen in Titel und Punkten ab, 40 sind erlaubt', () => {
    expect(pruefeWortLaenge(mit('T', 'w'.repeat(WORT_MAX)))).toEqual([]);
    expect(pruefeWortLaenge(mit('T', `Ein ${langes} Wort`)).join()).toContain('de.punkte[0]');
    expect(pruefeWortLaenge(mit(langes, 'p')).join()).toContain('de.titel');
    // Mehrere Wörter, jedes kurz, dazu Emoji als ein Zeichen je Stück.
    expect(pruefeWortLaenge(mit('T', `${'ab '.repeat(90)}${'😀'.repeat(WORT_MAX)}`))).toEqual([]);
  });

  it('gehört nicht zum Schema: die Seite verwirft so einen Eintrag nicht', () => {
    const e = mit(langes, langes);
    expect(pruefeEintrag(e, true)).toEqual([]);
    const gelesen = leseDevlog({ devlogVersion: 1, eintraege: [e] });
    expect(gelesen.uebersprungen).toBe(0);
    expect(gelesen.eintraege).toHaveLength(1);
  });

  it('Seite bricht lange Wörter um (overflow-wrap: anywhere)', () => {
    const quelle = readFileSync(join(HIER, '../routes/[lang=lang]/devlog/+page.svelte'), 'utf8');
    expect(quelle).toMatch(/\.devlog-entry\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});

describe('devlog: Lesen (Seite)', () => {
  it('überspringt ungültige und doppelte Einträge und sortiert absteigend', () => {
    const r = leseDevlog({
      devlogVersion: 1,
      eintraege: [
        tag('2026-09-28'),
        { datum: 'kaputt', de: text('x') },
        tag('2026-09-30', 'Neu'),
        tag('2026-09-28', 'Doppelt'),
        null,
        { datum: '2026-09-29', de: { titel: 'x'.repeat(81), punkte: ['y'] } },
      ],
    });
    expect(r.eintraege.map((e) => e.datum)).toEqual(['2026-09-30', '2026-09-28']);
    expect(r.eintraege[1].de?.titel).toBe('Titel');
    expect(r.uebersprungen).toBe(4);
  });

  it('wirft bei einer Datei, die keine Devlog-Datei ist', () => {
    expect(() => leseDevlog(null)).toThrow();
    expect(() => leseDevlog([])).toThrow();
    expect(() => leseDevlog({ eintraege: [] })).toThrow(/devlogVersion/);
    expect(() => leseDevlog({ devlogVersion: 2, eintraege: [] })).toThrow();
    expect(() => leseDevlog({ devlogVersion: 1, eintraege: 'x' })).toThrow();
  });

  it('die Rückfall-Datei aus dem Build ist gültig und leer', () => {
    const roh = readFileSync(join(HIER, '../../static/api/devlog.json'), 'utf8');
    expect(leseDevlog(JSON.parse(roh))).toEqual({ eintraege: [], uebersprungen: 0 });
  });
});

describe('devlog: Anzeige', () => {
  it('zeigt die Seitensprache ohne Hinweis', () => {
    const [a] = fuerAnzeige(
      leseDevlog({ devlogVersion: 1, eintraege: [tag('2026-09-30')] }).eintraege,
      'en',
    );
    expect(a).toEqual({
      datum: '2026-09-30',
      titel: 'Titel (en)',
      punkte: ['Ein Punkt.'],
      ausweichsprache: null,
    });
  });

  it('fällt auf die andere Sprache zurück und markiert das', () => {
    const nurDe = { datum: '2026-09-30', de: text('Nur deutsch') };
    const liste = leseDevlog({ devlogVersion: 1, eintraege: [nurDe] }).eintraege;
    expect(fuerAnzeige(liste, 'en')[0]).toMatchObject({
      titel: 'Nur deutsch',
      ausweichsprache: 'de',
    });
    expect(fuerAnzeige(liste, 'de')[0]).toMatchObject({
      titel: 'Nur deutsch',
      ausweichsprache: null,
    });
  });

  it('lässt HTML im Titel unverändert als Text stehen (kein Filtern, kein Rendern)', () => {
    const boese = '<img src=x onerror=alert(1)>';
    const liste = leseDevlog({ devlogVersion: 1, eintraege: [tag('2026-09-30', boese)] }).eintraege;
    expect(fuerAnzeige(liste, 'de')[0].titel).toBe(boese);
  });

  it('die Seite setzt Inhalte nie als HTML ein ({@html} kommt nicht vor)', () => {
    const quelle = readFileSync(join(HIER, '../routes/[lang=lang]/devlog/+page.svelte'), 'utf8');
    const knoten: string[] = [];
    const gehe = (n: unknown): void => {
      if (Array.isArray(n)) {
        n.forEach(gehe);
        return;
      }
      if (n && typeof n === 'object') {
        const o = n as Record<string, unknown>;
        if (typeof o.type === 'string') knoten.push(o.type);
        for (const k of Object.keys(o)) if (k !== 'parent') gehe(o[k]);
      }
    };
    gehe(parse(quelle, { modern: true }).fragment);
    expect(knoten).toContain('ExpressionTag');
    expect(knoten).not.toContain('HtmlTag');
    expect(quelle).not.toMatch(/innerHTML|\{@html/);
  });
});

describe('devlog: Einfügen und Kürzen', () => {
  it('ersetzt denselben Tag, sortiert und ist beim zweiten Mal byte-gleich', () => {
    const erst = fuegeEin([], tag('2026-09-29'));
    const zwei = fuegeEin(erst.eintraege, tag('2026-09-30'));
    const ersetzt = fuegeEin(zwei.eintraege, tag('2026-09-29', 'Anders'));
    expect(ersetzt.ersetzt).toBe(true);
    expect(ersetzt.eintraege.map((e) => e.datum)).toEqual(['2026-09-30', '2026-09-29']);
    expect(fuegeEin(ersetzt.eintraege, tag('2026-09-29', 'Anders')).text).toBe(ersetzt.text);
    expect(ersetzt.text.endsWith('\n')).toBe(true);
    expect(serialisiere({ devlogVersion: 1, eintraege: ersetzt.eintraege })).toBe(ersetzt.text);
  });

  it('kürzt hinten auf die Obergrenze und behält den neuesten Eintrag', () => {
    const gross = (n: number) => ({
      datum: new Date(Date.UTC(2020, 0, 1) + n * 86400000).toISOString().slice(0, 10),
      de: { titel: `T${n}`, punkte: Array(8).fill('ä'.repeat(280)) },
      en: { titel: `T${n}`, punkte: Array(8).fill('e'.repeat(280)) },
    });
    const vorhanden = Array.from({ length: 200 }, (_, i) => gross(200 - i));
    const r = fuegeEin(vorhanden, gross(300));
    expect(Buffer.byteLength(r.text)).toBeLessThanOrEqual(DATEI_MAX_BYTES);
    expect(r.eintraege[0].datum).toBe(gross(300).datum);
    expect(r.abgeschnitten).toBeGreaterThan(0);
    expect(r.eintraege.length + r.abgeschnitten).toBe(201);
    // Ein Eintrag mehr hätte die Grenze gesprengt.
    const einMehr = serialisiere({
      devlogVersion: 1,
      eintraege: [gross(300), ...vorhanden].slice(0, r.eintraege.length + 1),
    });
    expect(Buffer.byteLength(einMehr)).toBeGreaterThan(DATEI_MAX_BYTES);
    // Mit kleiner Grenze bleibt mindestens der neueste Eintrag.
    expect(fuegeEin(vorhanden, gross(300), 10).eintraege).toHaveLength(1);
  });
});

describe('devlog: Zeichen-Positivliste (Allowed text)', () => {
  it('lässt Buchstaben mit Umlauten, Ziffern, die Satzzeichen der Liste und Emoji durch', () => {
    const ok = [
      'Ärger über Straße und Öl, ñ ł',
      'Mo, Di; Mi: frei! (ok?) 10 % + 5 € & mehr',
      '„Zitat“ ‚so‘ ’s "gerade" – Gedankenstrich — lang - kurz',
      '🐺 ⚔ ❤️ 👍🏽 🇩🇪',
    ];
    for (const t of ok) expect(unerlaubteZeichen(t)).toEqual([]);
  });

  it('nennt jedes andere Zeichen einmal als U+XXXX', () => {
    expect(unerlaubteZeichen('Client/Server')).toEqual(['U+002F']);
    expect(unerlaubteZeichen('Platz #1 und #2')).toEqual(['U+0023']);
    expect(unerlaubteZeichen('a/b\\c_d')).toEqual(['U+002F', 'U+005C', 'U+005F']);
  });

  it('lehnt Steuer-, Format-, Leerraum- und Fremdzeichen ab', () => {
    const abgelehnt: [string, string][] = [
      ['x\ty', 'U+0009'],
      ['x\ny', 'U+000A'],
      ['x\u00a0y', 'U+00A0'],
      ['x\u200dy', 'U+200D'],
      ['x\u202ey', 'U+202E'],
      ['x\u00ady', 'U+00AD'],
      ['a\u0308', 'U+0308'],
      ['\u043e', 'U+043E'],
      ['\u03b1', 'U+03B1'],
      ['x\u2010y', 'U+2010'],
      ['x\u2212y', 'U+2212'],
      ['10\u00d73', 'U+00D7'],
      ['\uff47', 'U+FF47'],
      ['\u0262', 'U+0262'],
    ];
    for (const [t, code] of abgelehnt) expect(unerlaubteZeichen(t)).toEqual([code]);
  });
});

describe('devlog: Navigation', () => {
  it('steht neben der Saga in der Hauptnavigation und in der Sitemap', () => {
    const pfade = HAUPTNAV.map((s) => s.pfad);
    expect(pfade.indexOf('/devlog')).toBe(pfade.indexOf('/saga') + 1);
    expect(SITEMAP).toContain('/devlog');
    expect(localizedPath('de', '/devlog')).toBe('/de/devlog');
    expect(localizedPath('en', '/devlog')).toBe('/en/devlog');
  });
});
