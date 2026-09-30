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
 *
 * Run: npx tsx test/editor-gegenstaende-texte.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { VERWERF_GRUENDE } from '@wov/shared/src/items/gegenstandsDaten.js';
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
  konfliktInhalt,
  quittungText,
  routeFehlerText,
  zugangText,
  type Uebersetzer,
} from '../src/editor/gegenstaende/texte';

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
  katalog(sprache)[key].replace(/\{([^}]+)\}/g, (tok, n: string) => (Object.hasOwn(vars, n) ? String(vars[n]) : tok));
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
const SENKE_AUFRUFE_ARG: Record<string, number[]> = { el: [2], knopf: [0], zierTitel: [0], marke: [0], confirm: [0], alert: [0], prompt: [0], meldung: [0], banner: [0], createTextNode: [0], zeile: [3], beschriftet: [0] };

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
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 't' || n.expression.text === 'uebersetze')) {
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
  for (const s of [401, 403, 502, 'netz'] as const) {
    check(`Zugangstext ${s}: nicht leer, ohne offenen Platzhalter, beide Sprachen`, [zugangText(s, uebersetzer('de')), zugangText(s, uebersetzer('en'))].every((x) => x.length > 10 && !x.includes('{')));
  }
  check('401/403 gehen vor dem freien Text der Vorschalter', fehlerErgebnisText({ status: 401, fehler: 'Token fehlt oder falsch' }, uebersetzer('de')) === zugangText(401, uebersetzer('de')) && fehlerErgebnisText({ status: 422, fehler: 'veraltet' }, uebersetzer('de')) === routeFehlerText('veraltet', uebersetzer('de')) && fehlerErgebnisText({ status: 502, fehler: null }, uebersetzer('en')).includes('502'));
}

// ── [4] no plain text in the mask ──
console.log('\n[4] Kein Klartext in seite.ts und texte.ts:');
for (const d of ['seite.ts', 'texte.ts']) {
  const sf = QUELLEN[dateien.indexOf(d)];
  const { funde, senken } = klartextFunde(sf);
  check(`${d}: ${senken} Senken geprueft, kein Klartext`, funde.length === 0 && senken >= (d === 'seite.ts' ? 40 : 0), funde.map((f) => `${f.senke}: ${f.text}`).join(' | '));
}
{
  const sf = QUELLEN[dateien.indexOf('seite.ts')];
  let tAufrufe = 0;
  besuche(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 't') tAufrufe++;
  });
  check('seite.ts benutzt t() reichlich', tAufrufe >= 40, String(tAufrufe));
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

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
