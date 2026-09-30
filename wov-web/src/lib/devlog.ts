/**
 * Schema, Prüfung und Anzeige-Aufbereitung des Dev-Logs (`devlog.json`).
 *
 * Eine gemeinsame Quelle: Die Seite (`routes/[lang=lang]/devlog`) und das
 * Werkzeug `tools/devlog/eintragen.mjs` lesen beide diese Datei, damit „gültig“
 * an beiden Stellen dasselbe heisst. Deshalb hier keine Importe und nur
 * Syntax, die Node ohne Übersetzung lesen kann (keine Enums, keine
 * Parameter-Eigenschaften).
 *
 * Reiner Text: Nichts hier erzeugt HTML. Die Seite setzt Titel und Punkte als
 * Text ein; ein `<img …>` im Titel erscheint als Zeichen, nicht als Bild.
 *
 * Shared source for the page and the insert tool. Plain text only; no HTML
 * is produced or rendered.
 */

export type DevlogSprache = 'de' | 'en';

export const SPRACHEN: readonly DevlogSprache[] = ['de', 'en'];

export interface DevlogText {
  titel: string;
  punkte: string[];
}

export interface DevlogEintrag {
  /** `YYYY-MM-DD`, je Datei eindeutig. */
  datum: string;
  de?: DevlogText;
  en?: DevlogText;
}

export interface DevlogDatei {
  devlogVersion: 1;
  eintraege: DevlogEintrag[];
}

export const DEVLOG_VERSION = 1;
export const TITEL_MAX = 80;
export const PUNKTE_MAX = 8;
export const PUNKT_MAX = 280;
/**
 * Längstes Wort (Zeichen ohne Leerraum), das das Werkzeug beim Eintragen noch
 * annimmt. Gilt NUR dort (`pruefeWortLaenge`), nicht beim Lesen: Die Seite
 * überspringt keinen Eintrag wegen eines langen Worts, sie bricht es um.
 */
export const WORT_MAX = 40;
/** Obergrenze der Datei in Byte; ältere Einträge fallen beim Einfügen hinten weg. */
export const DATEI_MAX_BYTES = 512 * 1024;

function zeichen(s: string): number {
  return [...s].length;
}

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** `YYYY-MM-DD` und ein wirklich vorhandener Kalendertag (kein 2026-02-31). */
export function istDatum(x: unknown): x is string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

/*
 * Allowed text
 * ============
 * The insert tool accepts titles and points only from this character list.
 * Everything else is rejected and named as `U+XXXX`; this is deliberate and
 * over-filtering that follows from the list is documented here, not a defect.
 *
 *   - Latin letters (Basic Latin, Latin-1 Supplement, Latin Extended-A and -B,
 *     so umlauts and ß), without × and ÷. No other script, no IPA or
 *     phonetic letters, no combining marks (write precomposed letters).
 *   - Digits 0-9 and the space U+0020 (no other space, no tab, no line break).
 *   - Punctuation: . , ! ? : ; ' " „ “ ” ‚ ‘ ’ ( ) - – — % + & €
 *   - Emoji (Extended_Pictographic), optionally followed by U+FE0F, skin-tone
 *     modifiers and regional indicators (flags). No zero-width joiner, so
 *     joined emoji sequences such as a farmer are rejected.
 *
 * Rejected on purpose: / \ # @ _ = < > ~ ` | * [ ] { } $ ^, all Cc and Cf
 * characters (zero-width joiner, bidi marks, soft hyphen), other dashes and
 * hyphens than - – —, other spaces. Consequences the writer must follow:
 * "Client und Server" instead of "Client/Server", "Platz 1" instead of
 * "Platz #1", no chat commands such as "/heim".
 *
 * On top of the list the tool rejects a few patterns on the normalised text
 * (NFKC, diacritics and dotless i folded, lower case, – and — as -): hashes
 * (7+ hex characters with at least three digit/letter changes, or 10+
 * characters from a-f only), "pr|pull request|issue|commit|gh" followed by a
 * number of 3+ digits, domains (`word.tld` or `word . tld` or `word dot tld`
 * for common TLDs, `localhost`, `www.`, `github`), IPv4 addresses (four parts
 * 0-255 without leading zeros; "Update 1.2.3.4" is rejected, versions have at
 * most three parts), IPv6 (two or more colons with hex groups), server names
 * (`wov` + any separator + dev|host|lab|live), `port` + number, file
 * endings, and every line of the blocklist file kept outside the repository.
 */
const ERLAUBT_ZEICHEN =
  /^(?:[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F0-9 .,!?:;'"\u201E\u201C\u201D\u201A\u2018\u2019()\u002D\u2013\u2014%+&\u20AC\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]|\uFE0F)$/u;

/** Characters of `text` outside the allowed list, each once, as `U+XXXX` (in order of first use). */
export function unerlaubteZeichen(text: string): string[] {
  const aus: string[] = [];
  for (const z of text) {
    if (ERLAUBT_ZEICHEN.test(z)) continue;
    const code = `U+${(z.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`;
    if (!aus.includes(code)) aus.push(code);
  }
  return aus;
}

/** Fehlermeldungen zu einem Sprachblock; leer = gültig. */
export function pruefeText(x: unknown, name: string): string[] {
  if (!istObjekt(x)) return [`${name}: Objekt erwartet`];
  const fehler: string[] = [];
  const { titel, punkte } = x;
  if (typeof titel !== 'string' || titel.trim() === '' || zeichen(titel) > TITEL_MAX) {
    fehler.push(`${name}.titel: Text mit 1–${TITEL_MAX} Zeichen erwartet`);
  }
  if (!Array.isArray(punkte) || punkte.length < 1 || punkte.length > PUNKTE_MAX) {
    fehler.push(`${name}.punkte: Liste mit 1–${PUNKTE_MAX} Punkten erwartet`);
  } else {
    punkte.forEach((p, i) => {
      if (typeof p !== 'string' || p.trim() === '' || zeichen(p) > PUNKT_MAX) {
        fehler.push(`${name}.punkte[${i}]: Text mit 1–${PUNKT_MAX} Zeichen erwartet`);
      }
    });
  }
  return fehler;
}

/**
 * Meldungen zu Wörtern über `WORT_MAX` Zeichen in Titel und Punkten; leer =
 * in Ordnung. Nur fürs Eintragen gedacht und setzt einen schemagültigen
 * Eintrag voraus (erst `pruefeEintrag`). `pruefeEintrag` selbst kennt die
 * Grenze nicht, damit die Seite vorhandene Einträge nie deswegen verwirft.
 */
export function pruefeWortLaenge(e: DevlogEintrag): string[] {
  const fehler: string[] = [];
  const pruefe = (ort: string, text: string): void => {
    for (const wort of text.split(/\s+/)) {
      if (zeichen(wort) > WORT_MAX) {
        fehler.push(`${ort}: Wort mit mehr als ${WORT_MAX} Zeichen („${wort.slice(0, 20)}…“)`);
      }
    }
  };
  for (const s of SPRACHEN) {
    const t = e[s];
    if (!t) continue;
    pruefe(`${s}.titel`, t.titel);
    t.punkte.forEach((p, i) => {
      pruefe(`${s}.punkte[${i}]`, p);
    });
  }
  return fehler;
}

/**
 * Prüft einen Tageseintrag.
 *
 * `beide` verlangt beide Sprachen (das Werkzeug tut es), sonst genügt eine
 * gültige (die Seite zeigt dann die andere mit Hinweis). Ein Sprachblock,
 * der da ist, aber ungültig, zählt in beiden Fällen als Fehler des Eintrags.
 */
export function pruefeEintrag(x: unknown, beide = false): string[] {
  if (!istObjekt(x)) return ['Eintrag: Objekt erwartet'];
  const fehler: string[] = [];
  if (!istDatum(x.datum)) fehler.push('datum: Format YYYY-MM-DD mit gültigem Tag erwartet');
  let vorhanden = 0;
  for (const s of SPRACHEN) {
    if (x[s] === undefined) {
      if (beide) fehler.push(`${s}: fehlt`);
      continue;
    }
    vorhanden++;
    fehler.push(...pruefeText(x[s], s));
  }
  if (vorhanden === 0) fehler.push('Weder de noch en vorhanden');
  return fehler;
}

/** Schlüsselreihenfolge festlegen, damit gleiche Einträge gleiche Bytes ergeben. */
export function normalisiere(e: DevlogEintrag): DevlogEintrag {
  const aus: DevlogEintrag = { datum: e.datum };
  for (const s of SPRACHEN) {
    const t = e[s];
    if (t) aus[s] = { titel: t.titel, punkte: [...t.punkte] };
  }
  return aus;
}

/** Absteigend nach Datum (ISO-Strings sortieren als Text richtig). */
export function sortiere(liste: DevlogEintrag[]): DevlogEintrag[] {
  return [...liste].sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
}

export interface GelesenesDevlog {
  eintraege: DevlogEintrag[];
  /** Wie viele Einträge ungültig oder doppelt waren und übersprungen wurden. */
  uebersprungen: number;
}

/**
 * Liest eine geparste Datei tolerant: ungültige und doppelte Einträge werden
 * übersprungen (der erste je Datum gewinnt), das Ergebnis ist absteigend
 * sortiert. Wirft nur, wenn die Datei als Ganzes keine Devlog-Datei ist.
 */
export function leseDevlog(daten: unknown): GelesenesDevlog {
  if (!istObjekt(daten)) throw new Error('devlog: Objekt erwartet');
  if (daten.devlogVersion !== DEVLOG_VERSION) {
    throw new Error(`devlog: devlogVersion ${DEVLOG_VERSION} erwartet`);
  }
  if (!Array.isArray(daten.eintraege)) throw new Error('devlog: eintraege ist keine Liste');
  const gesehen = new Set<string>();
  const gut: DevlogEintrag[] = [];
  let uebersprungen = 0;
  for (const e of daten.eintraege) {
    if (pruefeEintrag(e).length > 0 || gesehen.has((e as DevlogEintrag).datum)) {
      uebersprungen++;
      continue;
    }
    gesehen.add((e as DevlogEintrag).datum);
    gut.push(normalisiere(e as DevlogEintrag));
  }
  return { eintraege: sortiere(gut), uebersprungen };
}

export interface AnzeigeEintrag {
  datum: string;
  titel: string;
  punkte: string[];
  /** Der Eintrag liegt nicht in der Seitensprache vor; gezeigt wird die andere. */
  ausweichsprache: DevlogSprache | null;
}

/** Wählt je Eintrag die Seitensprache, sonst die andere mit Markierung. */
export function fuerAnzeige(liste: DevlogEintrag[], sprache: DevlogSprache): AnzeigeEintrag[] {
  const andere: DevlogSprache = sprache === 'de' ? 'en' : 'de';
  return liste.map((e) => {
    const eigener = e[sprache];
    const text = eigener ?? (e[andere] as DevlogText);
    return {
      datum: e.datum,
      titel: text.titel,
      punkte: text.punkte,
      ausweichsprache: eigener ? null : andere,
    };
  });
}

/** Die Datei so, wie sie auf der Platte liegt: zwei Leerzeichen, Zeilenende am Schluss. */
export function serialisiere(datei: DevlogDatei): string {
  return `${JSON.stringify(
    { devlogVersion: DEVLOG_VERSION, eintraege: datei.eintraege.map(normalisiere) },
    null,
    2,
  )}\n`;
}

function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Fügt einen Tageseintrag ein (oder ersetzt den Eintrag desselben Tages),
 * sortiert und kürzt hinten, bis die Datei in `maxBytes` passt. Der neueste
 * Eintrag bleibt immer stehen. Gibt die fertige Dateifassung und die Zahl
 * der abgeschnittenen Einträge zurück.
 */
export function fuegeEin(
  vorhanden: DevlogEintrag[],
  neu: DevlogEintrag,
  maxBytes: number = DATEI_MAX_BYTES,
): { text: string; eintraege: DevlogEintrag[]; abgeschnitten: number; ersetzt: boolean } {
  const ersetzt = vorhanden.some((e) => e.datum === neu.datum);
  let liste = sortiere([...vorhanden.filter((e) => e.datum !== neu.datum), normalisiere(neu)]);
  let text = serialisiere({ devlogVersion: 1, eintraege: liste });
  let abgeschnitten = 0;
  if (bytes(text) > maxBytes && liste.length > 1) {
    // Größte Zahl n ≥ 1 suchen, für die die ersten n Einträge noch passen
    // (die Größe wächst mit n, also genügt eine Bisektion).
    let klein = 1;
    let gross = liste.length - 1;
    while (klein < gross) {
      const mitte = Math.ceil((klein + gross) / 2);
      const passt =
        bytes(serialisiere({ devlogVersion: 1, eintraege: liste.slice(0, mitte) })) <= maxBytes;
      if (passt) klein = mitte;
      else gross = mitte - 1;
    }
    abgeschnitten = liste.length - klein;
    liste = liste.slice(0, klein);
    text = serialisiere({ devlogVersion: 1, eintraege: liste });
  }
  return { text, eintraege: liste, abgeschnitten, ersetzt };
}
