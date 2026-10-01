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
 * The data behind this block (`LATEIN_BIS`, `LATEIN_AUSGENOMMEN`,
 * `SATZZEICHEN`, `PIKTO_ABGELEHNT`, `FALTUNG`) is exported below, and a test
 * compares every list in this block with it.
 *
 *   - Latin letters A-Z, a-z and U+00C0-U+017F (Latin-1 Supplement and Latin
 *     Extended-A, so umlauts, ß and é), without × and ÷. Not allowed below
 *     U+00C0: U+00AA U+00B5 U+00BA (ª µ º). Latin Extended-B (U+0180-U+024F)
 *     is not allowed at all. No other script, no IPA or phonetic letters, no
 *     combining marks (write precomposed letters).
 *     Left out of that range: U+013F U+0140 U+0149 (they fold to punctuation).
 *   - Digits 0-9 and the space U+0020 (no other space, no tab, no line break).
 *   - Punctuation: . , ! ? : ; ' " „ “ ” ‚ ‘ ’ ( ) - – — % + & €
 *   - Emoji (Extended_Pictographic, assigned code points only) as a sequence.
 *     U+FE0F and a skin-tone modifier are accepted only directly after an
 *     emoji (one of each at most); anywhere else they are rejected. Regional
 *     indicators are accepted in pairs only (a flag); a single one is
 *     rejected. No zero-width joiner, so joined emoji such as a farmer are
 *     rejected; keycap and tag sequences are rejected, too.
 *     Emoji rejected although pictographic: U+2122 U+2139 U+24C2 (they fold to letters).
 *
 * Rejected on purpose: / \ # @ _ = < > ~ ` | * [ ] { } $ ^, all Cc and Cf
 * characters (zero-width joiner, bidi marks, soft hyphen), other dashes and
 * hyphens than - – —, other spaces. Consequences the writer must follow:
 * "Client und Server" instead of "Client/Server", "Platz 1" instead of
 * "Platz #1", no chat commands such as "/heim".
 *
 * Folding for the pattern and blocklist checks (letters without a
 * decomposition): ø→o ł→l đ→d ħ→h ŧ→t ð→d ĸ→k ŋ→n ı→i æ→ae œ→oe þ→th ß→ss
 *
 * On top of the list the tool rejects a few patterns on the normalised text
 * (NFKC, diacritics removed, the folding above, lower case, – and — as -):
 *
 * Hash rules: a run of 7 or more of 0-9 a-f that contains digits and letters
 * is rejected, also inside a word such as "Fix1a2b3c4d"; so is a run of 10 or
 * more characters from a-f only.
 * Free hash forms: "Facade2026" "30Dec2026" "1Feb2026" "2026Dec" "6bcbdac".
 * These are word + year, day + word + year, year + word and day + word
 * without a year. The last form frees real commit abbreviations: of the 1616
 * commits of this repository it frees 6 of the 7-character, 5 of the
 * 8-character and 1 of the 9-character abbreviations, none from 10 on.
 * Hashes rejected on purpose: "abc1234" "Bad1234" "Dead1337" "30Dec26"
 * "2026Dec30" "Feb282026". That is: a name plus a short number, a two-digit
 * year, and the orders year-word-day and word-day-year; the rule stays as it
 * is because every widening frees more real abbreviations.
 *
 * Other patterns: "pr|pull request|issue|commit|gh" followed by a number of
 * 3+ digits; domains (`word.tld` or `word . tld` or `word dot tld` for common
 * TLDs, `localhost`, `www.`, `github`); IPv4 addresses (four parts of 1-3
 * digits with value 0-255, leading zeros included, so "192.168.001.001" is
 * rejected; "Update 1.2.3.4" and "10.000.000.000 Gold" are rejected on
 * purpose, write big numbers in words; "127.1", "2130706433" and
 * "0177.0.0.1" stay free because they are not the four-part form and are
 * hopeless to tell from versions and gold amounts); IPv6 (a `::` with at
 * least one hex group that has a digit, such as "fe80::1" or "::1", also
 * after a colon as in "IP:fe80::1"; or 6 to 8 hex groups of 1-4 characters;
 * times such as 20:00:30 and words such as "Bad::" stay free); server names
 * (`wov` + any separator + dev|host|lab|live); `port` + number; hex numbers
 * (`0x` followed by 6 or more hex characters, such as "0x7f000001"); and
 * every line of the blocklist file kept outside the repository.
 * TLDs: com de org net io dev app gg eu info xyz me co uk us ru cn tv (others
 * such as ".fr" are not caught).
 * File endings: ts tsx mjs js jsx json svelte yml yaml md py sh css html glb
 * blend conf png jpg jpeg webp svg gif txt log exe dll so cpp c h hpp rs go rb
 * lua sql csv xml ini toml zip gz tar gltf fbx wav ogg mp3 ktx2 bin java.
 */
/** Last code point of the allowed Latin range (Latin Extended-A ends at U+017F). */
export const LATEIN_BIS = 0x17f;
/** Code points inside the Latin range that are left out (they fold to punctuation). */
export const LATEIN_AUSGENOMMEN: readonly number[] = [0x13f, 0x140, 0x149];
/** The allowed punctuation besides the ASCII letters, digits and the space. */
export const SATZZEICHEN = '.,!?:;\'"„“”‚‘’()-–—%+&€';
/** Pictographic code points that are rejected (NFKC turns them into letters). */
export const PIKTO_ABGELEHNT: readonly number[] = [0x2122, 0x2139, 0x24c2];
/** Letters without a decomposition and their folding for the pattern and blocklist checks. */
export const FALTUNG: Readonly<Record<string, string>> = {
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ħ: 'h',
  ŧ: 't',
  ð: 'd',
  ĸ: 'k',
  ŋ: 'n',
  ı: 'i',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
  ß: 'ss',
};

const PIKTO = /^\p{Extended_Pictographic}$/u;
const UNBELEGT = /^\p{Cn}$/u;
const HAUTTON = /^\p{Emoji_Modifier}$/u;
const FLAGGE = /^\p{Regional_Indicator}$/u;
const VARIANTE = '\uFE0F';

function istBasis(z: string): boolean {
  return /^[A-Za-z0-9 ]$/.test(z) || (z.length === 1 && SATZZEICHEN.includes(z));
}

function istLatein(z: string): boolean {
  const cp = z.codePointAt(0) as number;
  return (
    cp >= 0xc0 &&
    cp <= LATEIN_BIS &&
    cp !== 0xd7 &&
    cp !== 0xf7 &&
    !LATEIN_AUSGENOMMEN.includes(cp) &&
    /^\p{L}$/u.test(z)
  );
}

function istPikto(z: string | undefined): boolean {
  return (
    z !== undefined &&
    PIKTO.test(z) &&
    !PIKTO_ABGELEHNT.includes(z.codePointAt(0) as number) &&
    !UNBELEGT.test(z)
  );
}

/** Characters of `text` outside the allowed list, each once, as `U+XXXX` (in order of first use). */
export function unerlaubteZeichen(text: string): string[] {
  const aus: string[] = [];
  const zs = [...text];
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    let ok: boolean;
    if (istBasis(z)) ok = true;
    else if (istLatein(z)) ok = true;
    else if (istPikto(z)) ok = true;
    else if (z === VARIANTE || HAUTTON.test(z)) ok = istPikto(zs[i - 1]);
    else if (FLAGGE.test(z)) {
      // Nur paarweise: Länge der Folge und Stelle in ihr bestimmen, ein Rest am Ende fällt raus.
      let von = i;
      while (von > 0 && FLAGGE.test(zs[von - 1])) von--;
      let bis = i;
      while (bis + 1 < zs.length && FLAGGE.test(zs[bis + 1])) bis++;
      ok = (bis - von + 1) % 2 === 0 || i < bis;
    } else ok = false;
    if (ok) continue;
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
