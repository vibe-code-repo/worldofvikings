import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import {
  DATEI_MAX_BYTES,
  FALTUNG,
  fuegeEin,
  fuerAnzeige,
  istDatum,
  LATEIN_AUSGENOMMEN,
  LATEIN_BIS,
  leseDevlog,
  PIKTO_ABGELEHNT,
  pruefeEintrag,
  pruefeWortLaenge,
  SATZZEICHEN,
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

  it('lässt Emoji-Zusätze nur in einer Emoji-Sequenz zu', () => {
    const ok = [
      '\u2764\uFE0F',
      '\u{1F44D}\u{1F3FD}',
      '\u{1F1E9}\u{1F1EA}',
      '\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}',
    ];
    for (const t of ok) expect(unerlaubteZeichen(t)).toEqual([]);
    const abgelehnt: [string, string][] = [
      ['a\uFE0Fb', 'U+FE0F'], // unsichtbar nach einem Buchstaben
      ['1\uFE0F', 'U+FE0F'],
      ['\u2764\uFE0F\uFE0F', 'U+FE0F'], // zweites FE0F
      ['a\u{1F3FD}', 'U+1F3FD'], // Hautton nach Buchstaben
      ['\u{1F3FD}', 'U+1F3FD'], // Hautton allein
      ['\u{1F44D}\u{1F3FD}\u{1F3FD}', 'U+1F3FD'], // zweiter Hautton
      ['\u{1F1E9}', 'U+1F1E9'], // einzelner Flaggen-Indikator
      ['a\u{1F1E9}b', 'U+1F1E9'],
      ['\u{1F1E9}\u{1F1EA}\u{1F1EB}', 'U+1F1EB'], // dritter bleibt ohne Partner
      ['\u{1F02C}', 'U+1F02C'], // unbelegter Codepunkt
      ['\u2139', 'U+2139'], // faltet zu i
      ['\u24C2', 'U+24C2'], // faltet zu M
      ['\u2122', 'U+2122'], // faltet zu TM
    ];
    for (const [t, code] of abgelehnt) expect(unerlaubteZeichen(t)).toEqual([code]);
    expect(/\p{Cn}/u.test('\u{1F02C}')).toBe(true);
  });

  it('lässt nur Latin bis U+017F zu (ohne Erweiterung B und ohne Lookalikes)', () => {
    for (const t of ['ł ø đ ħ ŧ ð ĸ æ œ þ ß', 'Ärger Straße café ŧ ł ø'])
      expect(unerlaubteZeichen(t.replaceAll(' ', ''))).toEqual([]);
    const raus = [
      0x13f, 0x140, 0x149, 0x180, 0x192, 0x257, 0x199, 0x1f1, 0x1a7, 0x1bb, 0x1c0, 0x1c3, 0x21c,
      0x241, 0x24f,
    ];
    for (const c of raus) {
      const z = String.fromCodePoint(c);
      expect(unerlaubteZeichen(z)).toEqual([`U+${c.toString(16).toUpperCase().padStart(4, '0')}`]);
    }
  });

  it('jede Liste der Dokumentation „Allowed text“ stimmt mit den exportierten Daten überein', () => {
    const quelle = readFileSync(join(HIER, 'devlog.ts'), 'utf8');
    const block = quelle.slice(
      quelle.indexOf('Allowed text'),
      quelle.indexOf('export const LATEIN_BIS'),
    );
    const text = block.replace(/\n \* ?/g, ' ').replace(/\s+/g, ' ');
    const hex = (t: string | undefined) =>
      [...(t ?? '').matchAll(/U\+([0-9A-F]{4})/g)].map((m) => Number.parseInt(m[1], 16));
    const zahlen = (l: readonly number[]) => [...l].sort((x, y) => x - y);
    const sortiert = (l: string[]) => [...l].sort().join(' ');

    // Satzzeichen
    const satz = /Punctuation: (.+?) - Emoji/.exec(text)?.[1].trim().split(' ') ?? [];
    expect(sortiert(satz)).toBe(sortiert([...SATZZEICHEN]));
    // abgelehnte ASCII-Zeichen: alles Sichtbare, was weder Buchstabe/Ziffer noch Satzzeichen ist
    const abgelehnt = /Rejected on purpose: (.+?), all Cc/.exec(text)?.[1].trim().split(' ') ?? [];
    const ascii: string[] = [];
    for (let c = 0x21; c <= 0x7e; c++) {
      const z = String.fromCharCode(c);
      if (!/[A-Za-z0-9]/.test(z) && !SATZZEICHEN.includes(z)) ascii.push(z);
    }
    expect(sortiert(abgelehnt)).toBe(sortiert(ascii));
    // Lateinbereich, Erweiterung B und Ausnahmen
    expect(hex(/Latin letters (U\+[0-9A-F]{4}-U\+[0-9A-F]{4})/.exec(text)?.[1])).toEqual([
      0x41,
      LATEIN_BIS,
    ]);
    expect(hex(/Extended-B \((U\+[0-9A-F]{4}-U\+[0-9A-F]{4})\)/.exec(text)?.[1])).toEqual([
      LATEIN_BIS + 1,
      0x24f,
    ]);
    expect(zahlen(hex(/Left out of that range: ((?:U\+[0-9A-F]{4} ?)+)/.exec(text)?.[1]))).toEqual(
      zahlen(LATEIN_AUSGENOMMEN),
    );
    // Emoji, die trotz Piktogramm abgelehnt werden
    expect(
      zahlen(hex(/Emoji rejected although pictographic: ((?:U\+[0-9A-F]{4} ?)+)/.exec(text)?.[1])),
    ).toEqual(zahlen(PIKTO_ABGELEHNT));
    // Faltung: Buchstaben und Ziele
    const faltText = /Folding [^:]*: (.+?) On top/.exec(text)?.[1] ?? '';
    const paare = [...faltText.matchAll(/(\S)→(\S+)/g)].map((m) => `${m[1]}→${m[2]}`);
    expect(sortiert(paare)).toBe(sortiert(Object.entries(FALTUNG).map(([k, v]) => `${k}→${v}`)));
    // Regeln in Worten: jede Aussage hängt an einem Verhaltenstest (Emoji-Test oben)
    expect(text).toContain('accepted in pairs only');
    expect(text).toContain('accepted only directly after an emoji');
    expect(text).toContain('keycap and tag sequences are rejected');
    expect(text).toContain('Latin Extended-B');

    // Verhalten gegen die Daten: jeder Codepunkt im Lateinbereich und darüber
    for (let c = 0xc0; c <= 0x24f; c++) {
      if (c === 0xd7 || c === 0xf7) continue;
      const erlaubt = c <= LATEIN_BIS && !LATEIN_AUSGENOMMEN.includes(c);
      expect(unerlaubteZeichen(String.fromCodePoint(c)).length === 0, `U+${c.toString(16)}`).toBe(
        erlaubt,
      );
    }
    for (const z of [...SATZZEICHEN, ...ascii]) {
      expect(unerlaubteZeichen(z).length === 0, `Zeichen ${z}`).toBe(SATZZEICHEN.includes(z));
    }
    for (const c of PIKTO_ABGELEHNT) {
      expect(unerlaubteZeichen(String.fromCodePoint(c))).toEqual([
        `U+${c.toString(16).toUpperCase().padStart(4, '0')}`,
      ]);
    }
    // Jedes Faltungsziel sind Kleinbuchstaben, jeder gefaltete Buchstabe ist erlaubt.
    for (const [k, v] of Object.entries(FALTUNG)) {
      expect(v, k).toMatch(/^[a-z]+$/);
      expect(unerlaubteZeichen(k), k).toEqual([]);
    }
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
