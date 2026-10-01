/**
 * Editor card EG2: every text of the item mask goes through the catalogue (`editor.gegenstand.*`, de + en).
 * Editor-Karte EG2: jeder Text der Gegenstands-Maske laeuft ueber den Katalog.
 *
 * All on the syntax tree (TypeScript compiler API, no text patterns), in the style of `testflug-texte-vollstaendig.ts`:
 *  [0] the scanner bites: small sources that break each rule are found
 *  [1] every `editor.gegenstand.*` key the code uses exists in de AND en; no such key in the catalogue is unused;
 *      a `t()` call passes exactly the placeholders its text names
 *  [2] every reason code of the reader (`VERWERF_GRUENDE`) has a text, in both languages
 *  [3] every `fehler` code of the route (read from `admin/src/routen/gegenstaende.ts`, not from a list here),
 *      every file error, every mask reason, every receipt status and the access texts have a text
 *  [4] `seite.ts` and `texte.ts` carry no German or English plain text into the DOM (only `t()` results)
 *  [5] N1: the four text errors and the conflict lines (field labels, both versions, "and N more") in both languages
 *  [6] N3: no raw id / name / code from server or file data reaches the screen without `sichtbarKuerzen` (syntax tree,
 *      with the scanner biting); invisible fillers by Unicode rule; the receipt's real upper bound; removed-entry rows
 *
 * Run: npx tsx test/editor-gegenstaende-texte.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { VERWERF_GRUENDE } from '@wov/shared/src/items/gegenstandsDaten.js';
import type { Anzeigetext } from '../src/editor/gegenstaende/anzeige';
import {
  DATEI_FEHLER_SCHLUESSEL,
  FELD_SCHLUESSEL,
  GRUND_SCHLUESSEL,
  LOKAL_SCHLUESSEL,
  QUITTUNG_SCHLUESSEL,
  ROUTE_FEHLER_SCHLUESSEL,
  fehlerErgebnisText,
  feldFehlerText,
  grundText,
  QUITTUNG_MAX_ZEICHEN,
  konfliktInhalt,
  quittungText,
  routeFehlerText,
  sichtbarKuerzen,
  verworfenZeile,
  zugangText,
  zusammengefuehrtText,
  type Uebersetzer,
} from '../src/editor/gegenstaende/texte';
import { DEFAULT_IGNORABLE, WEITERE_LEERE, kuerzeHart } from '../src/editor/gegenstaende/anzeige';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const HIER = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(HIER, '..');
const REPO = resolve(CLIENT, '..');
const ORDNER = resolve(CLIENT, 'src/editor/gegenstaende');
const de = JSON.parse(readFileSync(resolve(CLIENT, 'src/i18n/katalog/de.json'), 'utf-8')) as Record<string, string>;
const en = JSON.parse(readFileSync(resolve(CLIENT, 'src/i18n/katalog/en.json'), 'utf-8')) as Record<string, string>;
const PRAEFIX = 'editor.gegenstand.';

const quelle = (datei: string): ts.SourceFile => ts.createSourceFile(datei, readFileSync(datei, 'utf-8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
function besuche(n: ts.Node, f: (x: ts.Node) => void): void {
  f(n);
  ts.forEachChild(n, (k) => besuche(k, f));
}
const dateien = readdirSync(ORDNER).filter((d) => d.endsWith('.ts')).sort();
const QUELLEN = dateien.map((d) => quelle(resolve(ORDNER, d)));

function katalog(sprache: 'de' | 'en'): Record<string, string> {
  return sprache === 'de' ? de : en;
}
/** Translator that reads the catalogue of one language, like `t()` does (placeholders replaced). */
const uebersetzer = (sprache: 'de' | 'en'): Uebersetzer => (key, vars = {}) =>
  katalog(sprache)[key].replace(/\{([^}]+)\}/g, (tok, n: string) => (Object.hasOwn(vars, n) ? String(vars[n]) : tok)) as Anzeigetext;
const platzhalter = (s: string): string[] => [...s.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();

// ── the scanner ────────────────────────────────────────────────────────

/** Literal text parts of an expression that ends up as visible text: strings, templates, `+` chains, `?:`, arrays. */
function textTeile(n: ts.Node): string[] {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
  if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
  if (ts.isParenthesizedExpression(n)) return textTeile(n.expression);
  if (ts.isAsExpression(n) || ts.isNonNullExpression(n)) return textTeile(n.expression);
  if (ts.isConditionalExpression(n)) return [...textTeile(n.whenTrue), ...textTeile(n.whenFalse)];
  if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.PlusToken || n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return [...textTeile(n.left), ...textTeile(n.right)];
  }
  if (ts.isArrayLiteralExpression(n)) return n.elements.flatMap((e) => textTeile(e));
  return [];
}
const HAT_WORT = /\p{L}{2,}/u;
const SENKE_EIGENSCHAFTEN = new Set(['textContent', 'innerText', 'title', 'placeholder', 'alt', 'ariaLabel', 'innerHTML']);
const SENKE_AUFRUFE_ARG: Record<string, number[]> = { el: [2], elT: [2], knopf: [0], knopfT: [0], zierTitel: [0], zierTitelT: [0], setzeText: [1], frageBestaetigen: [0], marke: [0], confirm: [0], alert: [0], prompt: [0], meldung: [0], banner: [0], createTextNode: [0], zeile: [3], beschriftet: [0] };

interface Fund {
  senke: string;
  text: string;
}
function klartextFunde(sf: ts.SourceFile): { funde: Fund[]; senken: number } {
  const funde: Fund[] = [];
  let senken = 0;
  const pruefe = (senke: string, n: ts.Node | undefined): void => {
    if (!n) return;
    senken++;
    for (const teil of textTeile(n)) if (HAT_WORT.test(teil)) funde.push({ senke, text: teil });
  };
  besuche(sf, (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && SENKE_EIGENSCHAFTEN.has(n.left.name.text)) {
      pruefe(`.${n.left.name.text} =`, n.right);
    }
    if (ts.isCallExpression(n)) {
      const name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : null;
      if (name === null) return;
      for (const i of (Object.hasOwn(SENKE_AUFRUFE_ARG, name) ? SENKE_AUFRUFE_ARG[name] : [])) pruefe(`${name}()`, n.arguments[i]);
      if (name === 'knopf') {
        const opt = n.arguments[2];
        if (opt && ts.isObjectLiteralExpression(opt)) {
          for (const p of opt.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'titel') pruefe('knopf({titel})', p.initializer);
        }
      }
      if (name === 'setAttribute' && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && ['title', 'placeholder', 'aria-label', 'alt'].includes(n.arguments[0].text)) {
        pruefe('setAttribute()', n.arguments[1]);
      }
    }
  });
  return { funde, senken };
}

// ── [0] the scanner bites ──
console.log('\n[0] der Scanner beisst:');
{
  const probe = (code: string): Fund[] => klartextFunde(ts.createSourceFile('probe.ts', code, ts.ScriptTarget.ES2022, true)).funde;
  check('deutsches Literal in textContent', probe("x.textContent = 'Speichern';").length === 1);
  check('englisches Literal in title', probe("x.title = 'Save the item';").length === 1);
  check('Literal im dritten Argument von el()', probe("el('div', 'a:b', 'Hallo Welt');").length === 1);
  check('Literal als Knopfbeschriftung', probe("knopf('Cancel', () => 1);").length === 1);
  check('Literal im Titel-Optionsfeld von knopf()', probe("knopf(t('x'), f, { titel: 'Hinweis hier' });").length === 1);
  check('Literal in einer Vorlage', probe('x.textContent = `${a} und ${b}`;').length === 1);
  check('Literal hinter ?:', probe("x.textContent = ok ? t('a') : 'Nein';").length === 1);
  check('Literal in banner([...])', probe("this.banner(['Fehler beim Laden']);").length === 1);
  check('Literal in confirm()', probe("window.confirm('Wirklich?');").length === 1);
  check('t() und Zeichen ohne Wort sind erlaubt', probe("x.textContent = t('editor.gegenstand.a'); y.textContent = '·'; z.textContent = ' — ';").length === 0);
  check('leeres Literal (Leeren) ist erlaubt', probe("x.textContent = '';").length === 0);
  check('Schluessel in einer Tabelle sind keine Senke', probe("const T = { a: 'editor.gegenstand.x' }; el('div', 'display:flex', undefined);").length === 0);
}

// ── [1] keys used = keys present ──
console.log('\n[1] Schluessel im Code = Schluessel im Katalog:');
const benutzt = new Set<string>();
const aufrufe: Array<{ datei: string; key: string; vars: string[] | null }> = [];
for (const sf of QUELLEN) {
  besuche(sf, (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (n.text.startsWith(PRAEFIX) && n.text.length > PRAEFIX.length) benutzt.add(n.text);
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 't' || n.expression.text === 'tA' || n.expression.text === 'uebersetze')) {
      const keys = n.arguments[0] ? textTeile(n.arguments[0]) : [];
      const opt = n.arguments[1];
      let vars: string[] | null = [];
      if (opt) {
        if (ts.isObjectLiteralExpression(opt) && opt.properties.every((p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))) {
          vars = opt.properties.map((p) => (p.name as ts.Identifier).text).sort();
        } else vars = null;
      }
      for (const key of keys) if (key.startsWith(PRAEFIX)) aufrufe.push({ datei: sf.fileName, key, vars });
    }
  });
}
check('der Code benutzt viele Schluessel (Scanner ist nicht leer)', benutzt.size >= 120, String(benutzt.size));
const fehlenDe = [...benutzt].filter((k) => !Object.hasOwn(de, k));
const fehlenEn = [...benutzt].filter((k) => !Object.hasOwn(en, k));
check('jeder benutzte Schluessel steht in de.json', fehlenDe.length === 0, fehlenDe.join(', '));
check('jeder benutzte Schluessel steht in en.json', fehlenEn.length === 0, fehlenEn.join(', '));
const katalogSchluessel = Object.keys(de).filter((k) => k.startsWith(PRAEFIX));
const ungenutzt = katalogSchluessel.filter((k) => !benutzt.has(k));
check('kein editor.gegenstand.*-Schluessel im Katalog ist unbenutzt', ungenutzt.length === 0, ungenutzt.join(', '));
check('de und en haben dieselben editor.gegenstand.*-Schluessel', JSON.stringify(katalogSchluessel.sort()) === JSON.stringify(Object.keys(en).filter((k) => k.startsWith(PRAEFIX)).sort()));
check('kein Text ist leer', katalogSchluessel.every((k) => de[k].trim() !== '' && en[k].trim() !== ''));
{
  const schlecht = aufrufe.filter((a) => a.vars !== null && Object.hasOwn(de, a.key) && (JSON.stringify(a.vars) !== JSON.stringify(platzhalter(de[a.key])) || JSON.stringify(a.vars) !== JSON.stringify(platzhalter(en[a.key]))));
  check('ein t()-Aufruf mit Werten uebergibt genau die Platzhalter des Textes (de und en)', schlecht.length === 0, schlecht.map((a) => `${a.key} ${JSON.stringify(a.vars)}`).join('; '));
  check('es gibt Aufrufe mit Platzhaltern (Pruefung ist nicht leer)', aufrufe.filter((a) => a.vars && a.vars.length > 0).length >= 15);
  const ohneWerte = aufrufe.filter((a) => a.vars !== null && a.vars.length === 0 && Object.hasOwn(de, a.key) && platzhalter(de[a.key]).length > 0);
  check('ein Text mit Platzhalter wird nie ohne Werte aufgerufen', ohneWerte.length === 0, ohneWerte.map((a) => a.key).join(', '));
}

// ── [2] reader reasons ──
console.log('\n[2] Grund-Codes des Lesers (VERWERF_GRUENDE):');
{
  check('23 Grund-Codes', VERWERF_GRUENDE.length === 23);
  for (const code of VERWERF_GRUENDE) {
    const key = GRUND_SCHLUESSEL[code];
    check(`${code}: Schluessel ${key ?? '?'} in de und en`, typeof key === 'string' && Object.hasOwn(de, key) && Object.hasOwn(en, key));
    const dt = grundText(code, uebersetzer('de'));
    const et = grundText(code, uebersetzer('en'));
    check(`${code}: Text in beiden Sprachen, kein nackter Code, keine Ersatzmeldung`, dt === de[key] && et === en[key] && !dt.includes(code) && !et.includes(code));
  }
  check('Tabelle hat keine Ueberzaehligen', Object.keys(GRUND_SCHLUESSEL).length === VERWERF_GRUENDE.length);
  check('unbekannter Code: Ersatzmeldung nennt ihn', grundText('neuer-code', uebersetzer('de')).includes('neuer-code') && grundText('__proto__', uebersetzer('de')).includes('__proto__') && grundText('constructor', uebersetzer('en')).includes('constructor'));
  {
    const wild = grundText('x\u202E\uFFA0' + 'y'.repeat(500), uebersetzer('de'));
    check('N3: ein unbekannter Code mit Umkehr- und Fuellzeichen und 500 Zeichen wird sichtbar und gekuerzt gezeigt', !/[\u202E\uFFA0]/.test(wild) && wild.includes('<U+202E><U+FFA0>') && wild.length < 200, String(wild.length));
  }
}

// ── [3] route codes ──
console.log('\n[3] fehler-Codes der Route (am Syntaxbaum gelesen):');
{
  const routeDatei = quelle(resolve(REPO, 'admin/src/routen/gegenstaende.ts'));
  const daten = quelle(resolve(REPO, 'shared/src/items/gegenstandsDaten.ts'));
  const codes = new Set<string>();
  const sammle = (n: ts.Node | undefined): void => {
    if (!n) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) codes.add(n.text);
    else if (ts.isConditionalExpression(n)) {
      sammle(n.whenTrue);
      sammle(n.whenFalse);
    } else if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) sammle(n.expression);
    else if (ts.isLiteralTypeNode(n)) sammle(n.literal);
    else if (ts.isUnionTypeNode(n)) n.types.forEach(sammle);
  };
  {
    besuche(routeDatei, (n) => {
      // `fehler: 'x'` / `fehler: c ? 'a' : 'b'` in a response object, and `fehler: 'a' | 'b'` in a type
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'fehler') sammle(n.initializer);
      if (ts.isPropertySignature(n) && ts.isIdentifier(n.name) && n.name.text === 'fehler') sammle(n.type);
    });
  }
  // the file errors of the reader, passed on as `fehler` / `dateiFehler`, and the writer's own codes
  besuche(daten, (n) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === 'DateiFehler') sammle(n.type);
    if (ts.isClassDeclaration(n) && n.name?.text === 'GegenstandsSchreibFehler') {
      besuche(n, (k) => {
        if (ts.isParameter(k) && ts.isIdentifier(k.name) && k.name.text === 'code') sammle(k.type);
      });
    }
  });
  const liste = [...codes].sort();
  check('der Scanner findet viele Codes und die bekannten', liste.length >= 18 && ['veraltet', 'gesperrt', 'intern', 'basis-fehlt', 'basis-unbestimmt', 'brauchtBestaetigung', 'alter-stand-kaputt', 'eintraege-verworfen', 'datei-kein-json', 'repo-fehlt', 'repo-kaputt', 'anfrage-zu-gross', 'methode', 'unbekannter-endpunkt'].every((c) => codes.has(c)), liste.join(', '));
  for (const code of liste) {
    const key = ROUTE_FEHLER_SCHLUESSEL[code];
    check(`${code}: Schluessel in de und en, Text in beiden Sprachen`, typeof key === 'string' && Object.hasOwn(de, key) && Object.hasOwn(en, key) && routeFehlerText(code, uebersetzer('de')) === de[key] && routeFehlerText(code, uebersetzer('en')) === en[key], String(key));
  }
  check('die Tabelle hat keinen Code, den die Route nicht sendet', Object.keys(ROUTE_FEHLER_SCHLUESSEL).every((c) => codes.has(c)), Object.keys(ROUTE_FEHLER_SCHLUESSEL).filter((c) => !codes.has(c)).join(', '));
  check('die Dateifehler-Tabelle deckt genau die datei-*-Codes', Object.keys(DATEI_FEHLER_SCHLUESSEL).sort().join() === liste.filter((c) => c.startsWith('datei-')).join());
  check('unbekannter Route-Code: Ersatzmeldung nennt ihn', routeFehlerText('neu-und-fremd', uebersetzer('de')).includes('neu-und-fremd') && routeFehlerText(null, uebersetzer('en')).includes('?'));

  // mask reasons: read from the type in modell.ts
  const modell = quelle(resolve(ORDNER, 'modell.ts'));
  const lokal = new Set<string>();
  besuche(modell, (n) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === 'LokalerGrund' && ts.isUnionTypeNode(n.type)) for (const t of n.type.types) if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) lokal.add(t.literal.text);
  });
  check('Maskengruende: Tabelle deckt genau den Typ LokalerGrund', lokal.size === 11 && Object.keys(LOKAL_SCHLUESSEL).sort().join() === [...lokal].sort().join(), [...lokal].join());
  for (const code of lokal) {
    const key = (LOKAL_SCHLUESSEL as Record<string, string>)[code];
    check(`Maskengrund ${code}: Text in beiden Sprachen`, typeof key === 'string' && Object.hasOwn(de, key) && Object.hasOwn(en, key));
  }
  const bereich = { feld: 'skala', code: 'bereich', min: 0.05, max: 5 } as const;
  check('Bereichsmeldung nennt Grenzen in beiden Sprachen', feldFehlerText(bereich, uebersetzer('de')).includes('0.05') && feldFehlerText(bereich, uebersetzer('en')).includes('5') && !feldFehlerText(bereich, uebersetzer('en')).includes('{'));

  // receipt statuses and access texts
  for (const status of ['keine', 'unlesbar', 'angewendet', 'abgelehnt', 'verworfen', 'bestaetigung-noetig']) {
    const key = QUITTUNG_SCHLUESSEL[status];
    check(`Quittung ${status}: Text in beiden Sprachen`, typeof key === 'string' && Object.hasOwn(de, key) && Object.hasOwn(en, key) && quittungText({ status }, (id) => id, uebersetzer('de')) === de[key]);
  }
  check('Quittung mit Zaehlern nennt Namen und Anzahl', quittungText({ status: 'bestaetigung-noetig', gehalten: { Holzaxt: 3 } }, () => 'Holzaxt (Axt)', uebersetzer('de')).includes('3') && quittungText({ status: 'verworfen', verworfen: [{ id: 'X', grund: 'id-doppelt' }] }, (id) => id, uebersetzer('en')).includes(en[GRUND_SCHLUESSEL['id-doppelt']]));
  check('Quittung mit unbekanntem Zustand nennt ihn', quittungText({ status: 'seltsam' }, (id) => id, uebersetzer('de')).includes('seltsam'));
  {
    // EG2 N2, finding 3: a hand-written receipt must not flood the header; same helpers as the dialog
    const GRENZE = 3000; // ordinary ids and names; the real upper bound for hostile ones is QUITTUNG_MAX_ZEICHEN, checked in [6]
    const gross: Record<string, number> = {};
    for (let n = 0; n < 100000; n++) gross[`Eintrag${String(n).padStart(6, '0')}`] = n;
    const t1 = quittungText({ status: 'bestaetigung-noetig', gehalten: gross }, (id) => id, uebersetzer('de'));
    const viele = Array.from({ length: 100000 }, (_, n) => ({ id: `Kennung${n}`, grund: 'id-doppelt' }));
    const t2 = quittungText({ status: 'verworfen', verworfen: viele }, (id) => id, uebersetzer('de'));
    check(`Quittung mit 100000 gehaltenen Eintraegen bleibt unter ${GRENZE} Zeichen`, t1.length < GRENZE, String(t1.length));
    check(`Quittung mit 100000 verworfenen Eintraegen bleibt unter ${GRENZE} Zeichen`, t2.length < GRENZE, String(t2.length));
    check('... hoechstens 10 Zeilen, dann "und 99990 weitere"', t1.split('; ').length === 11 && t1.endsWith('… und 99990 weitere') && t2.split('; ').length === 11 && t2.endsWith('… und 99990 weitere'), t1.slice(-60));
    const rlo = '‮'.repeat(500);
    const t3 = quittungText({ status: rlo, gehalten: { [rlo]: 1 }, verworfen: [{ id: rlo, grund: rlo }] }, (id) => id, uebersetzer('de'));
    check('Umkehrzeichen sichtbar ersetzt, nichts davon roh, Laenge fest', !/[‪-‮⁦-⁩]/.test(t3) && t3.includes('<U+202E>') && t3.length < QUITTUNG_MAX_ZEICHEN, String(t3.length));
    const lang = 'x'.repeat(5000);
    const t4 = quittungText({ status: lang, gehalten: { [lang]: 2 } }, (id) => id, uebersetzer('en'));
    check('lange Kennungen und Namen werden gekuerzt', t4.length < GRENZE && !t4.includes('x'.repeat(200)), String(t4.length));
    check('kleine Quittung bleibt wie vorher (keine Kuerzung, kein "weitere")', quittungText({ status: 'bestaetigung-noetig', gehalten: { Holzaxt: 3 } }, () => 'Holzaxt', uebersetzer('de')) === `${de['editor.gegenstand.quittung.bestaetigung_noetig']} Holzaxt: 3 vorhanden.`);
  }
  for (const s of [401, 403, 502, 'netz', 'zeit'] as const) {
    check(`Zugangstext ${s}: nicht leer, ohne offenen Platzhalter, beide Sprachen`, [zugangText(s, uebersetzer('de')), zugangText(s, uebersetzer('en'))].every((x) => x.length > 10 && !x.includes('{')));
  }
  check('401/403 gehen vor dem freien Text der Vorschalter', fehlerErgebnisText({ status: 401, fehler: 'Token fehlt oder falsch' }, uebersetzer('de')) === zugangText(401, uebersetzer('de')) && fehlerErgebnisText({ status: 422, fehler: 'veraltet' }, uebersetzer('de')) === routeFehlerText('veraltet', uebersetzer('de')) && fehlerErgebnisText({ status: 502, fehler: null }, uebersetzer('en')).includes('502'));
}

// ── [4] no plain text in the mask ──
console.log('\n[4] Kein Klartext in seite.ts und texte.ts:');
for (const d of ['seite.ts', 'texte.ts']) {
  const sf = QUELLEN[dateien.indexOf(d)];
  const { funde, senken } = klartextFunde(sf);
  check(`${d}: ${senken} Senken geprueft, kein Klartext`, funde.length === 0 && senken >= (d === 'seite.ts' ? 30 : 0), funde.map((f) => `${f.senke}: ${f.text}`).join(' | '));
}
{
  const sf = QUELLEN[dateien.indexOf('seite.ts')];
  let tAufrufe = 0;
  besuche(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tA') tAufrufe++;
  });
  check('seite.ts benutzt tA() reichlich', tAufrufe >= 40, String(tAufrufe));
}

// ── [5] N1: text errors and conflict lines ──
console.log('\n[5] Textfehler und Konfliktzeilen (N1):');
{
  for (const code of ['text-zeilenumbruch', 'text-steuerzeichen', 'text-zu-lang', 'text-ohne-zeichen'] as const) {
    const dt = feldFehlerText({ feld: 'beschreibungDe', code, max: 200 }, uebersetzer('de'));
    const et = feldFehlerText({ feld: 'nameEn', code, max: 200 }, uebersetzer('en'));
    check(`${code}: Text in beiden Sprachen, ohne offenen Platzhalter`, dt.length > 10 && et.length > 10 && !dt.includes('{') && !et.includes('{') && dt !== et);
  }
  check('text-zeilenumbruch nennt den Zeilenumbruch, text-zu-lang die Grenze 200', /Zeilenumbruch/.test(feldFehlerText({ feld: 'nameDe', code: 'text-zeilenumbruch' }, uebersetzer('de'))) && /line break/.test(feldFehlerText({ feld: 'nameDe', code: 'text-zeilenumbruch' }, uebersetzer('en'))) && feldFehlerText({ feld: 'nameDe', code: 'text-zu-lang', max: 200 }, uebersetzer('de')).includes('200') && feldFehlerText({ feld: 'nameDe', code: 'text-zu-lang', max: 200 }, uebersetzer('en')).includes('200'));
  for (const [feld, key] of Object.entries(FELD_SCHLUESSEL)) {
    check(`Feldname ${feld}: Schluessel in de und en`, Object.hasOwn(de, key) && Object.hasOwn(en, key));
  }
  const unt = [{ feld: 'nameDe', eigen: 'Meine Axt', server: 'Serveraxt' }, { feld: 'wert.damage', eigen: '', server: '12' }, { feld: 'fremdfeld', eigen: 'a', server: 'b' }];
  for (const sprache of ['de', 'en'] as const) {
    const k = konfliktInhalt({ server: {}, unterschiede: unt }, uebersetzer(sprache));
    const alle = k.zeilen.join('\n');
    check(`${sprache}: eine Zeile je Unterschied, beide Fassungen und der Feldname stehen darin`, k.zeilen.length === 3 && alle.includes('Meine Axt') && alle.includes('Serveraxt') && alle.includes(katalog(sprache)['editor.gegenstand.feld.wert_damage']) && alle.includes('12'), alle);
    check(`${sprache}: leeres Feld heisst "${katalog(sprache)['editor.gegenstand.konflikt.leer']}", unbekanntes Feld nennt seine id`, alle.includes(katalog(sprache)['editor.gegenstand.konflikt.leer']) && alle.includes('fremdfeld'));
    check(`${sprache}: keine offenen Platzhalter, kein "und N weitere" bei 3 Zeilen`, !/\{[a-z]+\}/.test(alle + k.titel) && k.weitere === null);
    const viele = konfliktInhalt({ server: {}, unterschiede: Array.from({ length: 20 }, (_, i) => ({ feld: 'nameDe', eigen: String(i), server: 'x' })) }, uebersetzer(sprache));
    check(`${sprache}: 20 Unterschiede = 12 Zeilen + "und 8 weitere"`, viele.zeilen.length === 12 && viele.weitere !== null && viele.weitere.includes('8'));
    check(`${sprache}: Titel "geaendert" und Titel "entfernt" sind verschieden`, konfliktInhalt({ server: {}, unterschiede: [] }, uebersetzer(sprache)).titel !== konfliktInhalt({ server: null, unterschiede: [] }, uebersetzer(sprache)).titel);
    const wild = konfliktInhalt({ server: {}, unterschiede: [{ feld: 'nameDe', eigen: 'K'.repeat(5000) + '\u202E', server: 'a\u0000b' }] }, uebersetzer(sprache));
    check(`${sprache}: lange Werte werden gekuerzt, Steuer- und Umkehrzeichen sichtbar`, wild.zeilen[0].length < 400 && !/[\u202E\u0000]/.test(wild.zeilen[0]) && wild.zeilen[0].includes('<U+0000>'));
  }
}

// ── [6] N4: every text on its way to the screen is an `Anzeigetext` (syntax tree + type checker) ──
console.log('\n[6] Jeder Text auf dem Weg zum Bildschirm ist ein Anzeigetext (N4, Syntaxbaum + Typpruefer):');

/** Properties that put text (or markup) on the screen when assigned. `value` is checked against a short, justified list. */
const TEXT_EIGENSCHAFTEN = new Set(['textContent', 'innerText', 'outerText', 'innerHTML', 'outerHTML', 'title', 'placeholder', 'alt', 'ariaLabel', 'label', 'text', 'nodeValue', 'srcdoc', 'value']);
/** Assignments to `.value` that are allowed, by the written target. */
const VALUE_ERLAUBT: Record<string, string> = {
  'i.value': 'the text field of the form shows the author their own value to edit; it is no text of the page',
  's.value': 'the selected option of a drop-down (an id of our own tables)',
  'o.value': 'the value attribute of an option: an id of our own tables, or the id of an entry the reader has accepted (ID_MUSTER)',
};
/** Calls that put text on the screen or ask the author, by any receiver. */
const VERBOTENE_AUFRUFE = new Set(['alert', 'confirm', 'prompt', 'insertAdjacentHTML', 'insertAdjacentText', 'createTextNode', 'setHTMLUnsafe', 'writeln']);
const ERLAUBTE_ATTRIBUTE = new Set(['data-gegenstand-dialog', 'list']);
/** What a file other than `dom.ts` may import from the design module: nothing that takes a text. */
const DESIGN_ERLAUBT = new Set(['F', 'M', 'SCHRIFT', 'beschriftungStil', 'el', 'grundregelnEinhaengen', 'stil']);
const ZUWEISUNGEN = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

const nameDesAufrufs = (c: ts.CallExpression): string | null => {
  if (ts.isIdentifier(c.expression)) return c.expression.text;
  if (ts.isPropertyAccessExpression(c.expression)) return c.expression.name.text;
  if (ts.isElementAccessExpression(c.expression) && ts.isStringLiteralLike(c.expression.argumentExpression)) return c.expression.argumentExpression.text;
  return null;
};
const istTextArgument = (n: ts.Node): boolean => ts.isStringLiteralLike(n) || ts.isTemplateExpression(n) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken);

/**
 * Every way into the DOM that does not go through `dom.ts`, found on the syntax tree of ONE source (`istDom`: it imports
 * the design module, so it touches the DOM): a write to a text property (or to one by `['...']`), HTML, `alert` /
 * `confirm` / `prompt`, `document.write`, `setAttribute` of anything but a listed attribute, a call of the design helpers
 * that take a text, an import of one, `Object.assign` to anything but the form.
 */
function verboteneWege(sf: ts.SourceFile): string[] {
  const funde: string[] = [];
  const dom = istDomDatei(sf);
  const ort = (x: ts.Node): string => `${x.getText(sf).slice(0, 60)}@${sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1}`;
  besuche(sf, (n) => {
    if (ts.isBinaryExpression(n) && ZUWEISUNGEN.has(n.operatorToken.kind)) {
      const l = n.left;
      const eig = ts.isPropertyAccessExpression(l) ? l.name.text : ts.isElementAccessExpression(l) && ts.isStringLiteralLike(l.argumentExpression) ? l.argumentExpression.text : null;
      if (eig !== null && TEXT_EIGENSCHAFTEN.has(eig)) {
        if (eig === 'value' && Object.hasOwn(VALUE_ERLAUBT, l.getText(sf))) return;
        funde.push(`Zuweisung ${ort(n)}`);
      }
      if (dom && ts.isElementAccessExpression(l) && !ts.isStringLiteralLike(l.argumentExpression) && !ts.isNumericLiteral(l.argumentExpression) && !ts.isIdentifier(l.argumentExpression) && !ts.isBinaryExpression(l.argumentExpression)) funde.push(`dynamische Zuweisung ${ort(n)}`);
    }
    if (ts.isCallExpression(n)) {
      const name = nameDesAufrufs(n);
      if (name !== null && VERBOTENE_AUFRUFE.has(name)) funde.push(`Aufruf ${ort(n)}`);
      if (name === 'write' && ts.isPropertyAccessExpression(n.expression) && /document$/.test(n.expression.expression.getText(sf))) funde.push(`Aufruf ${ort(n)}`);
      if (name === 'setAttribute' && !(n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && ERLAUBTE_ATTRIBUTE.has(n.arguments[0].text))) funde.push(`setAttribute ${ort(n)}`);
      if (name === 'knopf' || name === 'zierTitel') funde.push(`Design-Helfer ${ort(n)}`);
      if (name === 'el' && n.arguments.length >= 3) funde.push(`el() mit Text ${ort(n)}`);
      if (name === 'Object' || (ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf) === 'Object' && ['assign', 'defineProperty', 'defineProperties'].includes(n.expression.name.text))) {
        if (n.getText(sf) !== 'Object.assign(f, setzeId(f, v))') funde.push(`Object.${nameDesAufrufs(n)} ${ort(n)}`);
      }
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf) === 'Reflect') funde.push(`Reflect ${ort(n)}`);
      if (name !== null && ['append', 'prepend', 'replaceChildren', 'before', 'after', 'appendChild', 'replaceWith'].includes(name) && n.arguments.some(istTextArgument)) funde.push(`Text als Kindknoten ${ort(n)}`);
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /\/design$/.test(n.moduleSpecifier.text)) {
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) for (const e of b.elements) if (!DESIGN_ERLAUBT.has((e.propertyName ?? e.name).text)) funde.push(`Design-Import ${(e.propertyName ?? e.name).text}`);
    }
  });
  return funde;
}
function istDomDatei(sf: ts.SourceFile): boolean {
  return sf.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && /\/design$/.test(s.moduleSpecifier.text));
}

/** What the type checker cannot see: a second brand, and switched-off checks. */
function textFaelschungen(sf: ts.SourceFile, anzeige = false): string[] {
  const funde: string[] = [];
  const ort = (x: ts.Node): string => `${x.getText(sf).slice(0, 60)}@${sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1}`;
  besuche(sf, (n) => {
    if (!anzeige && ts.isTypeAliasDeclaration(n) && /__anzeige/.test(n.getText(sf))) funde.push(`zweite Marke ${ort(n)}`);
  });
  if (/@ts-(ignore|expect-error|nocheck)/.test(sf.text)) funde.push('ts-Direktive');
  return funde;
}

/** Methods that put a child on the page; every argument must be a `Node` (never a string, which becomes a text node). */
const KIND_METHODEN = new Set(['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith']);
/** The mask's DOM files (they import the design module). */
const DOM_DATEIEN = new Set(['dom.ts', 'seite.ts']);

/**
 * N5 (Angriff N4, Befund 2): the rules below are asked of the TYPE CHECKER, not of the source text, so an alias, a
 * generic, a re-export or a helper from another file does not get past them:
 *  - a cast (`as`, `<T>`, `satisfies`) to a type that carries a brand of the mask (`Anzeigetext`, `Zierrat`, `Trenner` and
 *    every exported type of `anzeige.ts`: found by its resolved type, however it is named) is forbidden outside anzeige.ts;
 *  - `any` as a keyword, and every expression the checker types as `any`, is forbidden (a `JSON.parse` straight into a
 *    declared `unknown` is the one door: the value is `unknown` from then on);
 *  - every argument of `append`, `prepend`, `replaceChildren`, `before`, `after`, `replaceWith` of a DOM node must be a `Node`;
 *  - `new Text`, `new Option`, a write to a text property through a key whose type is that property, and, in the DOM files,
 *    a write through a computed key.
 */
function typFunde(programm: ts.Program, q: ts.SourceFile, o: { anzeige: boolean; dom: boolean; streng: boolean }): string[] {
  const pruefer = programm.getTypeChecker();
  const funde: string[] = [];
  const ort = (x: ts.Node): string => `${x.getText(q).slice(0, 60)}@${q.getLineAndCharacterOfPosition(x.getStart(q)).line + 1}`;
  const marken = markenWerte(programm);
  const istMarke = (ty: ts.Type, tiefe = 0, imUnion = false): boolean => {
    if (tiefe > 4) return false;
    if (ty.isUnion() && ty.types.every((x) => x.isStringLiteral() && marken.has(x.value))) return true; // a union of exactly the mask's punctuation
    if (ty.isUnion() || ty.isIntersection()) return ty.types.some((x) => istMarke(x, tiefe + 1, true));
    if (ty.getProperty('__anzeige') !== undefined) return true;
    if (!imUnion && ty.isStringLiteral() && marken.has(ty.value)) return true; // one literal of the mask's punctuation (a literal among others is no cast to it)
    const args = [...(ty.aliasTypeArguments ?? []), ...(ty.flags & ts.TypeFlags.Object && (ty as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference ? pruefer.getTypeArguments(ty as ts.TypeReference) : [])];
    return args.some((x) => istMarke(x, tiefe + 1));
  };
  const istKnoten = (ty: ts.Type): boolean => (ty.isUnion() ? ty.types.every(istKnoten) : (ty.flags & ts.TypeFlags.Any) === 0 && ty.getProperty('nodeType') !== undefined);
  const ohneKlammer = (n: ts.Node): ts.Node => {
    let p = n.parent;
    while (ts.isParenthesizedExpression(p)) p = p.parent;
    return p;
  };
  /** A real expression: not inside a type, an import / export, and not the name a declaration gives. */
  const inAusdruck = (n: ts.Node): boolean => {
    if (ts.isIdentifier(n) && (ts.isBindingElement(n.parent) || ((ts.isVariableDeclaration(n.parent) || ts.isParameter(n.parent) || ts.isPropertySignature(n.parent) || ts.isPropertyAssignment(n.parent) || ts.isFunctionDeclaration(n.parent) || ts.isMethodDeclaration(n.parent)) && n.parent.name === n))) return false;
    if (ts.isIdentifier(n) && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) return false; // the member name: the access itself is checked
    for (let p: ts.Node | undefined = n; p && !ts.isSourceFile(p); p = p.parent) if (ts.isTypeNode(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return false;
    return true;
  };
  besuche(q, (n) => {
    if (n.kind === ts.SyntaxKind.AnyKeyword) funde.push(`any ${ort(n)}`);
    if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n)) && !ts.isConstTypeReference(n.type)) {
      const ziel = pruefer.getTypeFromTypeNode(n.type);
      if (!o.anzeige && istMarke(ziel)) funde.push(`Umwandlung auf eine Marke ${ort(n)}`);
      if (o.streng && n.type.kind === ts.SyntaxKind.UnknownKeyword) funde.push(`Umwandlung auf unknown ${ort(n)}`);
    }
    if (ts.isExpression(n) && !ts.isOmittedExpression(n) && inAusdruck(n)) {
      const ty = pruefer.getTypeAtLocation(n);
      if (ty.flags & ts.TypeFlags.Any) {
        const eltern = ohneKlammer(n);
        const nachUnknown = (ts.isAsExpression(eltern) && eltern.type.kind === ts.SyntaxKind.UnknownKeyword) || (ts.isVariableDeclaration(eltern) && eltern.type?.kind === ts.SyntaxKind.UnknownKeyword);
        if (!nachUnknown) funde.push(`Ausdruck vom Typ any ${ort(n)}`);
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && KIND_METHODEN.has(n.expression.name.text) && istKnoten(pruefer.getTypeAtLocation(n.expression.expression)) !== false && pruefer.getTypeAtLocation(n.expression.expression).getProperty('nodeType') !== undefined) {
      for (const arg of n.arguments) {
        const ty = ts.isSpreadElement(arg) ? pruefer.getTypeAtLocation(arg.expression).getNumberIndexType() : pruefer.getTypeAtLocation(arg);
        if (ty === undefined || !istKnoten(ty)) funde.push(`${n.expression.name.text} mit etwas, das kein Node ist ${ort(arg)}`);
      }
    }
    if (ts.isNewExpression(n)) {
      const name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
      if (name === 'Text' || name === 'Option') funde.push(`new ${name} ${ort(n)}`);
    }
    if (ts.isBinaryExpression(n) && ZUWEISUNGEN.has(n.operatorToken.kind) && ts.isElementAccessExpression(n.left)) {
      const schluessel = pruefer.getTypeAtLocation(n.left.argumentExpression);
      const teile = schluessel.isUnion() ? schluessel.types : [schluessel];
      for (const t of teile) {
        if (t.isStringLiteral() && TEXT_EIGENSCHAFTEN.has(t.value)) funde.push(`Zuweisung an die Text-Eigenschaft ${t.value} ueber einen Schluessel ${ort(n)}`);
        else if (o.dom && !t.isStringLiteral() && (t.flags & ts.TypeFlags.NumberLike) === 0) funde.push(`Zuweisung mit berechnetem Schluessel ${ort(n)}`);
      }
    }
  });
  return funde;
}

/** Every string literal of the exported types of `anzeige.ts` (`Zierrat`, `Trenner`, ...): casting to them forges a mask text too. */
function markenWerte(programm: ts.Program): Set<string> {
  const pruefer = programm.getTypeChecker();
  const q = programm.getSourceFile(resolve(ORDNER, 'anzeige.ts'));
  const aus = new Set<string>();
  if (!q) return aus;
  const modul = pruefer.getSymbolAtLocation(q);
  for (const sym of modul ? pruefer.getExportsOfModule(modul) : []) {
    if (!(sym.flags & ts.SymbolFlags.TypeAlias)) continue;
    const ty = pruefer.getDeclaredTypeOfSymbol(sym);
    for (const t of ty.isUnion() ? ty.types : [ty]) if (t.isStringLiteral()) aus.add(t.value);
  }
  return aus;
}

/** A program over the real mask files, and optionally one virtual file `zz-probe.ts` next to them (for the scanner's own tests). */
function baueProgramm(probe?: string): ts.Program {
  const konfig = ts.readConfigFile(resolve(CLIENT, 'tsconfig.json'), ts.sys.readFile);
  const optionen = { ...ts.parseJsonConfigFileContent(konfig.config, ts.sys, CLIENT).options, noEmit: true };
  const wurzeln = dateien.map((d) => resolve(ORDNER, d));
  const probePfad = resolve(ORDNER, 'zz-probe.ts');
  const host = ts.createCompilerHost(optionen);
  if (probe !== undefined) {
    const echt = host.getSourceFile.bind(host);
    const echtLesen = host.readFile.bind(host);
    const echtDa = host.fileExists.bind(host);
    host.getSourceFile = (name, ziel, ...rest) => (name === probePfad ? ts.createSourceFile(name, probe, ziel, true, ts.ScriptKind.TS) : echt(name, ziel, ...rest));
    host.readFile = (name) => (name === probePfad ? probe : echtLesen(name));
    host.fileExists = (name) => name === probePfad || echtDa(name);
    wurzeln.push(probePfad);
  }
  return ts.createProgram({ rootNames: wurzeln, options: optionen, host });
}


{
  const probe = (code: string): string[] => verboteneWege(ts.createSourceFile('probe.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS));
  for (const [name, code] of [
    ['textContent', 'a.textContent = x;'], ['innerText', 'a.innerText = String(x);'], ['innerHTML', 'a.innerHTML = x;'], ['outerHTML', 'a.outerHTML = x;'], ['title', 'z.title = e.id;'], ['placeholder', 'i.placeholder = s;'],
    ['value (nicht gelistet)', 'k.value = e.id;'], ['textContent per [..]', "a['textContent'] = x;"], ['+=', 'a.textContent += x;'], ['window.confirm', 'window.confirm(`${x}`);'], ['alert', 'alert(x);'],
    ['prompt', 'prompt(x);'], ['insertAdjacentHTML', "a.insertAdjacentHTML('beforeend', x);"], ['document.write', 'document.write(x);'], ['createTextNode', 'document.createTextNode(x);'],
    ['setAttribute title', "a.setAttribute('title', x);"], ['setAttribute dynamisch', 'a.setAttribute(n, x);'], ['knopf()', "knopf('x', f);"], ['zierTitel()', 'zierTitel(x, 3);'], ['el() mit Text', "el('div', '', x);"],
    ['Object.assign an ein Element', 'Object.assign(a, { textContent: x });'], ['Reflect.set', "Reflect.set(a, 'textContent', x);"], ['append mit Text', 'a.append(`${x}`);'], ['Import von knopf', "import { knopf } from '../design';"],
    ['window["confirm"]', "window['confirm'](x);"],
  ] as const) check(`der Wege-Scanner beisst: ${name}`, probe(code).length >= 1, code);
  check('... und laesst durch: i.value / s.value / o.value, setAttribute("list"), el() ohne Text, Object.assign(f, setzeId(f, v)), ein Import ohne Textfunktion', probe("i.value = w; s.value = g; o.value = n; a.setAttribute('list', 'x'); el('div', css); Object.assign(f, setzeId(f, v)); import { F, M, el } from '../design'; a.append(b);").length === 0);
  const textProbe = (code: string): string[] => textFaelschungen(ts.createSourceFile('probe.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS));
  for (const [name, code] of [['@ts-ignore', '// @ts-ignore\nconst x = 1;'], ['zweite Marke', 'type A = string & { readonly __anzeige: true };']] as const) check(`der Text-Scanner beisst: ${name}`, textProbe(code).length >= 1, code);

  const hier = Object.fromEntries(dateien.map((d, i) => [d, QUELLEN[i]]));
  const domDateien = dateien.filter((d) => istDomDatei(hier[d])).sort();
  check('genau dom.ts und seite.ts beruehren das DOM (importieren den Design-Teil)', JSON.stringify(domDateien) === JSON.stringify(['dom.ts', 'seite.ts']), domDateien.join(','));
  for (const d of dateien) {
    if (d === 'dom.ts') continue;
    const funde = verboteneWege(hier[d]);
    check(`${d}: kein Weg ins DOM ausser dom.ts (Text-Zuweisung, HTML, confirm/alert/prompt, Design-Helfer mit Text)`, funde.length === 0, funde.join(' | '));
  }
  for (const d of dateien) {
    const funde = textFaelschungen(hier[d], d === 'anzeige.ts');
    check(`${d}: keine zweite Marke, keine ts-Direktive`, funde.length === 0, funde.join(' | '));
  }
  {
    // the places that may cast: exactly the producers of anzeige.ts; dom.ts has the one sink and the one question
    const marke: string[] = [];
    besuche(hier['anzeige.ts'], (n) => {
      if (ts.isAsExpression(n) && /Anzeigetext/.test(n.type.getText(hier['anzeige.ts']))) {
        let p: ts.Node | undefined = n;
        while (p && !ts.isFunctionDeclaration(p) && !ts.isVariableDeclaration(p)) p = p.parent;
        marke.push(p && (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) && p.name && ts.isIdentifier(p.name) ? p.name.text : '?');
      }
    });
    check('anzeige.ts: nur tA, zier, zahlText, fuege, kuerzeHart und sichtbarKuerzen machen einen Anzeigetext', JSON.stringify([...new Set(marke)].sort()) === JSON.stringify(['fuege', 'kuerzeHart', 'sichtbarKuerzen', 'tA', 'zahlText', 'zier']), marke.join(','));
    const dom = hier['dom.ts'];
    const zuweisungen: string[] = [];
    const bestaetigt: string[] = [];
    const typen = new Map<string, string>();
    besuche(dom, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name) {
        const erstes = n.parameters[0];
        typen.set(n.name.text, erstes?.type?.getText(dom) ?? '');
        besuche(n, (k) => {
          if (ts.isBinaryExpression(k) && ZUWEISUNGEN.has(k.operatorToken.kind) && ts.isPropertyAccessExpression(k.left) && TEXT_EIGENSCHAFTEN.has(k.left.name.text)) zuweisungen.push(`${n.name?.text}:${k.left.name.text}`);
          if (ts.isCallExpression(k) && nameDesAufrufs(k) === 'confirm') bestaetigt.push(n.name?.text ?? '?');
        });
      }
    });
    check('dom.ts: die einzige Text-Zuweisung steht in setzeText, die einzige Frage in frageBestaetigen', JSON.stringify(zuweisungen) === JSON.stringify(['setzeText:textContent']) && JSON.stringify(bestaetigt) === JSON.stringify(['frageBestaetigen']), zuweisungen.join() + '|' + bestaetigt.join());
    check('dom.ts: setzeText, elT, knopfT, zierTitelT, frageBestaetigen nehmen den Text als Anzeigetext (zweites bzw. drittes Argument von setzeText / elT)', typen.get('knopfT') === 'Anzeigetext' && typen.get('zierTitelT') === 'Anzeigetext' && typen.get('frageBestaetigen') === 'Anzeigetext' && /setzeText\(knoten: \{ textContent: string \| null \}, text: Anzeigetext\)/.test(dom.text) && /elT<.*text\?: Anzeigetext/.test(dom.text));
  }
}

// the type checker over the mask: no file has a type error, and every value of a text template is a number or an Anzeigetext
{
  const konfig = ts.readConfigFile(resolve(CLIENT, 'tsconfig.json'), ts.sys.readFile);
  const geparst = ts.parseJsonConfigFileContent(konfig.config, ts.sys, CLIENT);
  const wurzeln = dateien.map((d) => resolve(ORDNER, d));
  const programm = ts.createProgram({ rootNames: wurzeln, options: { ...geparst.options, noEmit: true } });
  const pruefer = programm.getTypeChecker();
  const meldungen: string[] = [];
  for (const w of wurzeln) {
    const q = programm.getSourceFile(w);
    if (!q) continue;
    for (const dg of [...programm.getSyntacticDiagnostics(q), ...programm.getSemanticDiagnostics(q)]) {
      const pos = dg.start === undefined ? '' : `@${q.getLineAndCharacterOfPosition(dg.start).line + 1}`;
      meldungen.push(`${q.fileName.split('/').pop()}${pos}: ${ts.flattenDiagnosticMessageText(dg.messageText, ' ').slice(0, 120)}`);
    }
  }
  check(`die Typpruefung der Maske meldet nichts (${wurzeln.length} Dateien): ein roher string, wo ein Anzeigetext verlangt ist, faellt hier auf`, meldungen.length === 0, meldungen.join(' | '));
  const istSicherer = (ty: ts.Type): boolean => (ty.isUnion() ? ty.types.every(istSicherer) : (ty.flags & ts.TypeFlags.NumberLike) !== 0 || ty.getProperty('__anzeige') !== undefined);
  let gepruefte = 0;
  const roh: string[] = [];
  for (const d of dateien) {
    const q = programm.getSourceFile(resolve(ORDNER, d));
    if (!q) continue;
    besuche(q, (n) => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || !['tA', 't', 'uebersetze'].includes(n.expression.text)) return;
      const opt = n.arguments[1];
      if (!opt) return;
      if (!ts.isObjectLiteralExpression(opt)) {
        if (d !== 'anzeige.ts') roh.push(`${d}: Werte nicht als Objektliteral @${q.getLineAndCharacterOfPosition(n.getStart(q)).line + 1}`);
        return;
      }
      for (const p of opt.properties) {
        let ty: ts.Type | undefined;
        if (ts.isShorthandPropertyAssignment(p)) {
          const sym = pruefer.getShorthandAssignmentValueSymbol(p);
          ty = pruefer.getTypeAtLocation(p.name);
          if (!istSicherer(ty) && sym) ty = pruefer.getTypeOfSymbolAtLocation(sym, p.name);
        } else if (ts.isPropertyAssignment(p)) ty = pruefer.getTypeAtLocation(p.initializer);
        gepruefte++;
        if (ty === undefined || !istSicherer(ty)) roh.push(`${d}: ${p.getText(q).slice(0, 50)}@${q.getLineAndCharacterOfPosition(p.getStart(q)).line + 1}`);
      }
    });
  }
  check(`jeder Wert, der in einen Katalogtext fliesst (${gepruefte} Platzhalter in tA / uebersetze), ist eine Zahl oder ein Anzeigetext (sichtbarKuerzen, Katalogtext ...)`, roh.length === 0 && gepruefte >= 30, roh.join(' | ') + ` (${gepruefte})`);
}

// N5 (Angriff N4, Befund 2): the typed scanner over the real files, and biting on every way round the old text patterns
{
  const programm = baueProgramm();
  for (const d of dateien) {
    const q = programm.getSourceFile(resolve(ORDNER, d));
    if (!q) continue;
    const funde = typFunde(programm, q, { anzeige: d === 'anzeige.ts', dom: DOM_DATEIEN.has(d), streng: d === 'seite.ts' || d === 'texte.ts' });
    check(`${d}: laut Typpruefer keine Umwandlung auf eine Marke, kein any, nur Nodes an append & Co, kein new Text / Option, kein berechneter Schluessel`, funde.length === 0, funde.join(' | '));
  }
  const kopf = [
    "import { type Anzeigetext, type Anzeigetext as AT, type Zierrat, type Trenner, zier, fuege, tA, sichtbarKuerzen } from './anzeige';",
    "declare const e: { id: string; name: string };",
    "declare const unten: HTMLElement;",
    "declare const zeile: HTMLDivElement;",
    "declare const kk: string;",
    "declare function anzeigeName(x: { id: string }): Anzeigetext;",
    "",
  ].join('\n');
  const probe = (code: string, dom = true): string[] => {
    const pg = baueProgramm(kopf + code);
    const q = pg.getSourceFile(resolve(ORDNER, 'zz-probe.ts'));
    return q ? [...typFunde(pg, q, { anzeige: false, dom, streng: true }), ...verboteneWege(q)] : ['keine Quelle'];
  };
  for (const [name, code] of [
    ['alias', 'const x = e.id as AT;'],
    ['Zierrat', 'const x = zier(e.id as Zierrat);'],
    ['Trenner', "const x = fuege(e.id as Trenner, zier('('));"],
    ['Umwandlung mit <T>', 'const x = <Anzeigetext>e.id;'],
    ['satisfies', 'const x = (e.id as string) satisfies Anzeigetext;'],
    ['ueber unknown', 'const x = e.id as unknown as Anzeigetext;'],
    ['Feld mit Marke', 'const x = [e.id] as Anzeigetext[];'],
    ['any-Ausdruck (JSON.parse als Wert)', 'const x = fuege(\' \', JSON.parse(e.id));'],
    ['any-Ausdruck als Argument von append', 'unten.append(JSON.parse(e.id));'],
    ['any als Schluesselwort', 'let y: any;'],
    ['append mit string', 'unten.append(e.id);'],
    ['append mit Anzeigetext', 'unten.append(anzeigeName(e));'],
    ['replaceChildren mit Anzeigetext', 'unten.replaceChildren(anzeigeName(e));'],
    ['prepend', 'unten.prepend(e.name);'],
    ['before', 'zeile.before(e.id);'],
    ['after', 'zeile.after(e.id);'],
    ['replaceWith', 'zeile.replaceWith(e.id);'],
    ['append mit Spread', 'unten.append(...[e.id]);'],
    ['Node oder string', 'unten.append(kk ? zeile : e.id);'],
    ['new Text', 'unten.appendChild(new Text(e.id));'],
    ['new Option', 'const o = new Option(e.id, e.id);'],
    ['createElement mit .text', "const o = document.createElement('option'); o.text = e.id;"],
    ['dynamischer Schluessel (const)', "const k = 'textContent'; unten[k] = e.id;"],
    ['dynamischer Schluessel (string)', 'unten[kk] = e.id;'],
    ['zusammengesetzter Schluessel', "unten['text' + 'Content'] = e.id;"],
  ] as const) {
    const funde = probe(code);
    check(`der Typ-Scanner beisst: ${name}`, funde.length >= 1, code);
  }
  const frei = probe("const a = sichtbarKuerzen(e.id); const b = zier('('); const c = fuege(' ', a, b); unten.append(zeile, document.createElement('p')); unten.replaceChildren(); const j: unknown = JSON.parse('1'); const z = [1, 2]; z[0] = 3; const s = e.id as string;");
  check('... und laesst durch: Nodes an append / replaceChildren, JSON.parse in ein unknown, ein Index, gewoehnliche Umwandlungen', frei.length === 0, frei.join(' | '));
  check('... ein Schluessel-Zugriff ausserhalb der DOM-Dateien (Wert-Tabelle) ist erlaubt, die Text-Eigenschaft ueber einen Schluessel nie', probe('const t: Record<string, number> = {}; t[kk] = 1;', false).length === 0 && probe("const k = 'innerHTML'; unten[k] = e.id;", false).length >= 1);
}

// invisible characters by rule
{
  const FUELLER = [0xffa0, 0x3164, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x034f, 0x180b, 0x180e, 0x2800, 0x00a0, 0x3000, 0x2007, 0x200b, 0x202e, 0xfe0f, 0x00ad, 0x2064, 0xe0041, 0x1d173, 0xfffe, 0xfdd0, 0x2028, 0x0085, 0x1680, 0x205f];
  const alle = FUELLER.map((c) => ({ c, aus: sichtbarKuerzen(`a${String.fromCodePoint(c)}b`) }));
  const roh = alle.filter((x) => !x.aus.includes(`<U+${x.c.toString(16).toUpperCase().padStart(4, '0')}>`));
  check(`die bekannten unsichtbaren Fuell- und Leerzeichen (${FUELLER.length}) werden alle als <U+XXXX> gezeigt`, roh.length === 0, roh.map((x) => x.c.toString(16)).join(','));
  check('Hangul-Filler U+FFA0, U+17B4 und U+034F ausdruecklich (N2-Angriff, Info 4)', sichtbarKuerzen('ﾠ') === '<U+FFA0>' && sichtbarKuerzen('឴') === '<U+17B4>' && sichtbarKuerzen('͏') === '<U+034F>');
  check('gewoehnlicher Text bleibt, wie er ist (Umlaute, CJK, Emoji, Leerzeichen, Bindestrich)', sichtbarKuerzen('Äxte aus Eisen – 日本語 🌾 x-1') === 'Äxte aus Eisen – 日本語 🌾 x-1');
  // by rule over the whole code space: nothing with one of these properties gets through
  const regeln: Array<[string, RegExp]> = [
    ['Default_Ignorable', /\p{Default_Ignorable_Code_Point}/u],
    ['Cf', /\p{Cf}/u],
    ['Cc', /\p{Cc}/u],
    ['Co', /\p{Co}/u],
    ['Zl/Zp', /[\p{Zl}\p{Zp}]/u],
    ['Noncharacter', /\p{Noncharacter_Code_Point}/u],
    ['Zs (ausser Leerzeichen)', /\p{Zs}/u],
  ];
  // N4 (Angriff N3, Befund 5b): the full list of Default_Ignorable_Code_Point ranges, at every border and throughout
  {
    const marke = (c: number): string => `<U+${c.toString(16).toUpperCase().padStart(4, '0')}>`;
    const rand: string[] = [];
    let anzahl = 0;
    for (const [von, bis] of DEFAULT_IGNORABLE) {
      for (const c of [von, bis]) if (sichtbarKuerzen(String.fromCodePoint(c)) !== marke(c)) rand.push(`rand ${c.toString(16)}`);
      for (let c = von; c <= bis; c++) {
        anzahl++;
        if (!sichtbarKuerzen(String.fromCodePoint(c)).startsWith('<U+')) rand.push(`in ${c.toString(16)}`);
      }
    }
    check(`alle ${DEFAULT_IGNORABLE.length} Bereiche der Default_Ignorable_Code_Point-Liste (${anzahl} Zeichen) werden gezeigt, an beiden Raendern und dazwischen`, rand.length === 0 && DEFAULT_IGNORABLE.length === 17, rand.slice(0, 5).join(','));
    check('die beiden Zeichen des N3-Angriffs, U+1D159 und U+13440, werden gezeigt', WEITERE_LEERE.every(([von, bis]) => [von, bis].every((c) => sichtbarKuerzen(String.fromCodePoint(c)) === marke(c))) && sichtbarKuerzen('\u{1D159}') === '<U+1D159>' && sichtbarKuerzen('\u{13440}') === '<U+13440>');
    // N5 (Angriff N4, Info 4): the three fillers of the attack, and the whole run of the Egyptian hieroglyph block after the format controls
    check('U+16FE4 (Khitan-Fueller), U+2D7F (Tifinagh-Verbinder) und U+13455 werden gezeigt', [0x16fe4, 0x2d7f, 0x13455].every((c) => sichtbarKuerzen(String.fromCodePoint(c)) === marke(c)));
    {
      const aegypt: string[] = [];
      for (let c = 0x13430; c <= 0x1345f; c++) if (sichtbarKuerzen(String.fromCodePoint(c)) !== marke(c)) aegypt.push(c.toString(16));
      check('U+13430 bis U+1345F (aegyptische Formatsteuerzeichen, Leerzeichen, Verlustzeichen, Modifikatoren): jedes wird gezeigt', aegypt.length === 0, aegypt.join(','));
    }
    // the list is the engine's property, no more and no less (the engine is Unicode 17.0; a newer engine only adds)
    const motor = /\p{Default_Ignorable_Code_Point}/u;
    let fehlt = 0;
    let zuviel = 0;
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const inListe = DEFAULT_IGNORABLE.some(([von, bis]) => c >= von && c <= bis);
      const imMotor = motor.test(String.fromCodePoint(c));
      if (imMotor && !inListe) fehlt++;
      if (inListe && !imMotor) zuviel++;
    }
    check(`die Konstante deckt sich mit der Unicode-Eigenschaft der Laufzeit (${process.versions.unicode}): nichts fehlt, nichts ist zuviel`, fehlt === 0 && zuviel === 0, `fehlt ${fehlt}, zuviel ${zuviel}`);
  }
  const durch: string[] = [];
  let pruefungen = 0;
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const z = String.fromCodePoint(c);
    for (const [name, re] of regeln) {
      if (!re.test(z) || (name.startsWith('Zs') && c === 0x20)) continue;
      pruefungen++;
      if (sichtbarKuerzen(z) === z && durch.length < 10) durch.push(`${name}:${c.toString(16)}`);
    }
  }
  check(`ueber den ganzen Zeichenraum: kein Zeichen dieser Kategorien (${pruefungen} Treffer) laeuft unveraendert durch`, durch.length === 0 && pruefungen > 3000, durch.join(','));
}

// the receipt's real upper bound (N4: enforced on the finished text, also for characters outside the BMP)
{
  const kaputt = (x: string): boolean => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(x);
  for (const [name, z] of [['U+202E', '\u202E'], ['U+10FFFF', '\u{10FFFF}'], ['U+E0001', '\u{E0001}'], ['U+F0000', '\u{F0000}']] as const) {
    const lang = z.repeat(200);
    const verworfen = Array.from({ length: 100000 }, () => ({ id: lang, grund: lang }));
    const gehalten: Record<string, number> = {};
    for (let n = 0; n < 100000; n++) gehalten[`${lang}${n}`] = n;
    for (const sprache of ['de', 'en'] as const) {
      const a = quittungText({ status: z.repeat(100000), verworfen }, (id) => id, uebersetzer(sprache));
      const b = quittungText({ status: 'seltsam', gehalten, verworfen }, (id) => id, uebersetzer(sprache));
      const c = quittungText({ status: 'verworfen', verworfen }, (id) => id, uebersetzer(sprache));
      const d = quittungText({ status: z.repeat(100000), gehalten }, (id) => id, uebersetzer(sprache));
      const alle = [a, b, c, d];
      const maximal = Math.max(...alle.map((x) => x.length));
      check(`${sprache}: Schlimmstfall mit 200 x ${name} in id, grund und status (100000 Eintraege) bleibt hart unter QUITTUNG_MAX_ZEICHEN (${QUITTUNG_MAX_ZEICHEN}): ${maximal}`, maximal <= QUITTUNG_MAX_ZEICHEN, String(maximal));
      check(`${sprache}: ${name}: kein zerschnittenes Surrogatpaar, kein Umkehrzeichen roh`, !alle.some(kaputt) && !alle.some((x) => /[‪-‮⁦-⁩]/.test(x)));
      if (name === 'U+10FFFF') check(`${sprache}: der astrale Schlimmstfall wird wirklich gekuerzt (laenger als die Grenze waere er) und endet auf die Endmarke`, maximal === QUITTUNG_MAX_ZEICHEN && alle.filter((x) => x.length === QUITTUNG_MAX_ZEICHEN).every((x) => x.endsWith('…')), alle.map((x) => x.length).join(','));
    }
  }
  // kuerzeHart on its own: the border cases around a surrogate pair
  {
    const k = (text: string, max: number): string => kuerzeHart(text as Anzeigetext, max);
    check('kuerzeHart: kurzer Text bleibt, genau die Grenze bleibt', k('abc', 5) === 'abc' && k('abcde', 5) === 'abcde');
    check('kuerzeHart: zu langer Text wird auf die Grenze gekuerzt, Endmarke eingerechnet', k('abcdefgh', 5) === 'abcd…' && k('abcdefgh', 5).length === 5);
    const paar = '\u{10FFFF}'; // two UTF-16 units
    check('kuerzeHart: der Schnitt liegt mitten im Surrogatpaar: das Paar faellt ganz weg', k('a' + paar.repeat(5), 3) === 'a…' && k(paar.repeat(5), 6) === paar + paar + '…');
    const zerschnitten: string[] = [];
    for (let max = 0; max <= 14; max++) for (const text of [paar.repeat(8), 'a' + paar.repeat(8), 'ab' + paar.repeat(8)]) {
      const r = k(text, max);
      if (kaputt(r) || r.length > max) zerschnitten.push(`${max}:${text.length}`);
    }
    check('kuerzeHart: bei jeder Grenze von 0 bis 14 und jeder Lage des Schnitts kein zerschnittenes Paar und nie laenger als die Grenze', zerschnitten.length === 0, zerschnitten.join(','));
    check('kuerzeHart (N5): Grenze 0 gibt den leeren Text, Grenze 1 nur die Endmarke; nie laenger als die Grenze', k('abc', 0) === '' && k('abc', 1) === '…' && k(paar, 0) === '' && k('', 0) === '');
    const ueber: string[] = [];
    for (let max = 0; max <= 20; max++) for (const text of ['', 'a', 'abc', 'x'.repeat(30), paar.repeat(15), 'a' + paar.repeat(15)]) if (k(text, max).length > max) ueber.push(`${max}:${text.length}`);
    check('kuerzeHart (N5): fuer jede Grenze 0 bis 20 und jeden Text nie laenger als die Grenze', ueber.length === 0, ueber.join(','));
  }
  check('die alte Zusage "unter 3000 Zeichen" steht nirgends mehr in texte.ts', !readFileSync(resolve(ORDNER, 'texte.ts'), 'utf-8').includes('under 3000'));
}

// the rows of a verworfen entry, a removed entry and a merge
{
  for (const sprache of ['de', 'en'] as const) {
    const u = uebersetzer(sprache);
    const z = verworfenZeile({ index: 2, id: '‮abcﾠ' + 'x'.repeat(100), grund: 'id-doppelt' }, u);
    check(`${sprache}: verworfenZeile: die Kennung ist sichtbar gemacht und gekuerzt, der Grund uebersetzt`, z.startsWith('<U+202E>abc<U+FFA0>') && !/[‮ﾠ]/.test(z) && z.includes(katalog(sprache)[GRUND_SCHLUESSEL['id-doppelt']]) && z.length < 200, z);
    check(`${sprache}: verworfenZeile ohne Kennung nennt die Position`, verworfenZeile({ index: 7, id: null, grund: 'id-doppelt' }, u).startsWith('#7: '));
    check(`${sprache}: verworfenZeile mit unbekanntem Grund mit Umkehrzeichen: sichtbar`, !/‮/.test(verworfenZeile({ index: 0, id: 'A', grund: 'neu‮' }, u)));
    const entf = konfliktInhalt({ server: null, unterschiede: [{ feld: 'nameDe', eigen: 'Meine Axt', server: '' }, { feld: 'gewicht', eigen: '9', server: '' }] }, u);
    check(`${sprache}: Konflikt bei entferntem Eintrag: eine Zeile je Feld des Entwurfs, mit Wert, ohne Server-Fassung`, entf.zeilen.length === 2 && entf.zeilen[0].includes('Meine Axt') && entf.zeilen[1].includes('9') && !entf.zeilen.join('').includes(katalog(sprache)['editor.gegenstand.konflikt.leer']) && entf.zeilen[0] !== konfliktInhalt({ server: {}, unterschiede: [{ feld: 'nameDe', eigen: 'Meine Axt', server: '' }] }, u).zeilen[0], entf.zeilen.join(' / '));
    check(`${sprache}: zusammengefuehrtText: nichts = null, sonst die Feldnamen`, zusammengefuehrtText([], u) === null && (zusammengefuehrtText(['gewicht', 'wert.damage'], u) ?? '').includes(katalog(sprache)['editor.gegenstand.feld.gewicht']) && !(zusammengefuehrtText(['gewicht'], u) ?? '').includes('{'));
    const viele = zusammengefuehrtText(Array.from({ length: 30 }, () => 'gewicht'), u) ?? '';
    check(`${sprache}: zusammengefuehrtText mit 30 Feldern nennt 12 und den Rest`, viele.includes('18') && (viele.match(new RegExp(katalog(sprache)['editor.gegenstand.feld.gewicht'], 'g')) ?? []).length === 12, viele);
    check(`${sprache}: zusammengefuehrtText: ein fremdes Feld mit Umkehrzeichen wird sichtbar`, !/‮/.test(zusammengefuehrtText(['x‮'], u) ?? ''));
  }
}

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
