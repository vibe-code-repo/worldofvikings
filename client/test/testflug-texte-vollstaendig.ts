/**
 * T0a Vollstaendigkeitstest: Testflug, SpawnPanel und der Upload-Dialog
 * (GegenstandsKatalog.ts) sollen KEINE deutschen Klartext-Literale mehr
 * enthalten, die ins DOM gehen (textContent, title, placeholder, Meldungen)
 * -- alles davon laeuft seit T0a ueber `client/src/editor/i18n.ts` (`t()`).
 *
 * N1 (Angriff "Editor T0a", Befund B3): der Scanner arbeitet jetzt auf dem
 * Syntaxbaum (TypeScript-Compiler-API, wie `editor-serversteuerung.ts`)
 * statt auf Text/Regex allein -- das behebt vier Luecken des Vorgaengers:
 *  - Ein `//` INNERHALB eines String-Literals (z. B. eine URL) wurde vorher
 *    als Zeilenkommentar gelesen und schnitt den Rest der Zeile ab.
 *  - Einzelne deutsche Woerter ohne Umlaut in einer Senke (`textContent`,
 *    `title`, `placeholder`, `meldung(`/`alert(`/`confirm(`-Argument)
 *    kamen durch, weil die Bezeichner-Ausnahme sie wie einen Katalogschluessel
 *    behandelte. In diesen fuenf Senken zaehlt jetzt JEDES nicht-leere
 *    Literal, unabhaengig von Umlaut/Wortliste -- im Geltungsbereich geht
 *    dort ohnehin ausschliesslich `t(...)` hinein (nachgesehen: keine
 *    Ausnahme im Bestand ausser dem bewussten `= ''` zum Leeren).
 *  - Die Dateiliste von `testflug/` kommt jetzt aus `readdirSync`, eine neue
 *    Datei im Verzeichnis wird also automatisch erfasst.
 *  - `console.debug` zaehlt jetzt wie log/warn/error/info nicht (Log-Zeilen
 *    duerfen deutsch bleiben, s. Karte).
 *
 * Zwei Pruefungen:
 *  1. Der Scanner findet String-/Template-Literale mit deutschen Markern
 *     (Umlaute/ß oder typische deutsche Woerter) ausserhalb von
 *     Kommentaren und console.*-Aufrufen, dazu JEDES Literal in einer der
 *     fuenf DOM-Senken. Der Upload-Dialog in GegenstandsKatalog.ts ist nur
 *     der Abschnitt zwischen den Markern "U1: Modell-Upload" und "private
 *     get speicherArt" -- der Rest der Datei ist T0b.
 *  2. Jeder verwendete Uebersetzungsschluessel (Literal, ob als `t('...')`-
 *     Aufruf oder als Tabellenwert wie in `BewuchsStufe.ts`s
 *     `STUFE_NAME_SCHLUESSEL`) muss in de.json UND en.json existieren --
 *     ein Tippfehler im Schluessel faellt damit auf (Mutationsnachweis im
 *     Bericht, nicht als bleibender Testcode: ein `testflug.spawn.title`
 *     statt `testflug.spawn.titel` in SpawnPanel.ts machte Pruefung 2 rot).
 *
 * Run: npx tsx client/test/testflug-texte-vollstaendig.ts   (aus client/)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(CLIENT_ROOT, '..');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

// ── 1. Geltungsbereich (Karte T0a) ─────────────────────────────────────

const TESTFLUG_DIR = resolve(CLIENT_ROOT, 'src/editor/testflug');
// N1: aus dem Verzeichnis gelesen statt fest verdrahtet -- eine neue Datei
// unter testflug/ landet automatisch im Geltungsbereich (Angriffsbefund B3).
const TESTFLUG_DATEINAMEN = readdirSync(TESTFLUG_DIR)
  .filter((n) => n.endsWith('.ts'))
  .sort();
const SPAWN_PANEL = resolve(CLIENT_ROOT, 'src/editor/SpawnPanel.ts');
const GEGENSTANDS_KATALOG = resolve(CLIENT_ROOT, 'src/editor/GegenstandsKatalog.ts');
const DE_KATALOG = resolve(CLIENT_ROOT, 'src/i18n/katalog/de.json');
const EN_KATALOG = resolve(CLIENT_ROOT, 'src/i18n/katalog/en.json');

type Bereich = readonly [start: number, ende: number];

/** Position der Marke `marke` in `text`, ab `ab` gesucht -- wirft, wenn sie fehlt. */
function markenPosition(text: string, marke: string, ab = 0): number {
  const i = text.indexOf(marke, ab);
  if (i < 0) {
    throw new Error(`Marke nicht gefunden ("${marke}") — GegenstandsKatalog.ts umgebaut?`);
  }
  return i;
}

/**
 * Nur der Upload-Dialog: zwei Abschnitte, keiner durchgehend — dazwischen
 * liegt "Hauptteil: Liste links, Vorschau rechts", der allgemeine Katalog
 * (T0b), den derselbe Bauabschnitt der Klasse mit aufbaut.
 *  A. die Zeile "U1: Modell-Upload" bis "Hauptteil: Liste links" (Formular).
 *  B. "hochladenStatusSchreiben" bis "private get speicherArt" (Vorschau,
 *     Hochladen, Grundskala-PATCH).
 * Gibt Zeichen-BEREICHE zurueck (nicht Text-Ausschnitte) -- der Syntaxbaum
 * wird ueber die GANZE Datei gebaut (nur so bleibt er gueltig), gefiltert
 * wird ueber die Position jedes Knotens.
 */
function uploadDialogBereiche(text: string): Bereich[] {
  const aStart = markenPosition(text, 'U1: Modell-Upload');
  const aEnde = markenPosition(text, 'Hauptteil: Liste links, Vorschau rechts', aStart);
  const bStart = markenPosition(text, 'private hochladenStatusSchreiben', aEnde);
  const bEnde = markenPosition(text, 'private get speicherArt', bStart);
  if (aEnde <= aStart || bEnde <= bStart) {
    throw new Error('Marken in falscher Reihenfolge — GegenstandsKatalog.ts umgebaut?');
  }
  return [
    [aStart, aEnde],
    [bStart, bEnde],
  ];
}

/** `null` heisst "ganze Datei im Geltungsbereich". */
function innerhalb(pos: number, bereiche: Bereich[] | null): boolean {
  if (!bereiche) return true;
  return bereiche.some(([a, b]) => pos >= a && pos < b);
}

// ── 2. Scanner: deutsche Literale, auf dem Syntaxbaum ──────────────────

const DEUTSCHE_MARKER = /[äöüÄÖÜß]/;
const DEUTSCHE_WOERTER =
  /\b(der|die|das|und|nicht|ist|wird|kein|keine|bei|für|mit|auf|zum|zur|eine|einen|einer|noch|schon|über|unter|oder|als|wenn|bitte|gewählt|ausgewählt|gespeichert|geladen|hinzugefügt|entfernt|abgesetzt|gegriffen|platziert|sichtbar)\b/i;
/** Reine Bezeichner (Katalogschluessel wie 'testflug.platziert', Aufzaehlungswerte wie 'fehler', CSS-Werte): keine Prosa. Gilt NICHT in einer DOM-Senke (s. u.). */
const NUR_BEZEICHNER = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

/** console.log/warn/error/info/debug -- Log-Zeilen duerfen deutsch bleiben. */
const KONSOLEN_METHODEN = new Set(['log', 'warn', 'error', 'info', 'debug']);
/** Eigenschaften, deren literale Zuweisung immer sichtbarer Text ist. */
const SINK_EIGENSCHAFTEN = new Set(['textContent', 'title', 'placeholder']);
/** Aufrufe, deren literales Argument immer sichtbarer Text ist (`hud.meldung(...)`, `alert(...)`, `window.confirm(...)`, …). */
const SINK_AUFRUFE = new Set(['meldung', 'alert', 'confirm']);

/** Text eines String- oder Template-Literals OHNE `${…}`-Einsetzungen (Code, oft mit deutschen Bezeichnernamen -- keine Prosa). */
function literalText(node: ts.StringLiteralLike | ts.TemplateExpression): string {
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += span.literal.text;
    return text;
  }
  return node.text;
}

function istVermutlichDeutsch(text: string): boolean {
  return DEUTSCHE_MARKER.test(text) || DEUTSCHE_WOERTER.test(text);
}

/** Direkter (nicht nur irgendein aeusserer) `console.log/…`-Aufruf, dessen Argument der Knoten ist. */
function inKonsolenAufruf(node: ts.Node): boolean {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression;
      return (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'console' &&
        KONSOLEN_METHODEN.has(callee.name.text)
      );
    }
    p = p.parent;
  }
  return false;
}

/** `x.textContent = '…'` / `x.title = '…'` / `x.placeholder = '…'` / `hud.meldung('…')` / `alert('…')` / `window.confirm('…')`. */
function istSinkLiteral(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === node &&
    ts.isPropertyAccessExpression(parent.left) &&
    SINK_EIGENSCHAFTEN.has(parent.left.name.text)
  ) {
    return true;
  }
  if (ts.isCallExpression(parent) && (parent.arguments as readonly ts.Node[]).includes(node)) {
    const callee = parent.expression;
    const name = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isIdentifier(callee)
        ? callee.text
        : null;
    if (name && SINK_AUFRUFE.has(name)) return true;
  }
  return false;
}

function findeDeutscheLiterale(pfad: string, bereiche: Bereich[] | null): string[] {
  const quelltext = readFileSync(pfad, 'utf-8');
  const sourceFile = ts.createSourceFile(pfad, quelltext, ts.ScriptTarget.Latest, true);
  const funde: string[] = [];
  function besuch(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      if (innerhalb(node.getStart(sourceFile), bereiche) && !inKonsolenAufruf(node)) {
        const text = literalText(node);
        const zaehlt = istSinkLiteral(node)
          ? text.length > 0 // in einer DOM-Senke zaehlt jedes nicht-leere Literal (Leeren mit '' ist erlaubt)
          : !NUR_BEZEICHNER.test(text) && istVermutlichDeutsch(text);
        if (zaehlt) funde.push(text);
      }
    }
    ts.forEachChild(node, besuch);
  }
  besuch(sourceFile);
  return funde;
}

interface Quelle {
  readonly label: string;
  readonly pfad: string;
  readonly bereiche: Bereich[] | null;
}

const GEGENSTANDS_KATALOG_TEXT = readFileSync(GEGENSTANDS_KATALOG, 'utf-8');
const QUELLEN: Quelle[] = [
  ...TESTFLUG_DATEINAMEN.map((name) => ({
    label: relative(REPO_ROOT, resolve(TESTFLUG_DIR, name)),
    pfad: resolve(TESTFLUG_DIR, name),
    bereiche: null,
  })),
  { label: relative(REPO_ROOT, SPAWN_PANEL), pfad: SPAWN_PANEL, bereiche: null },
  {
    label: `${relative(REPO_ROOT, GEGENSTANDS_KATALOG)} (Upload-Dialog)`,
    pfad: GEGENSTANDS_KATALOG,
    bereiche: uploadDialogBereiche(GEGENSTANDS_KATALOG_TEXT),
  },
];

console.log('── 1. Deutsche Literale im T0a-Geltungsbereich ──');
let gesamtFunde = 0;
for (const quelle of QUELLEN) {
  const funde = findeDeutscheLiterale(quelle.pfad, quelle.bereiche);
  gesamtFunde += funde.length;
  check(`${quelle.label}: keine deutschen Literale`, funde.length === 0, funde.slice(0, 5).join(' | '));
}
console.log(`  (${gesamtFunde} Fund(e) insgesamt)`);

// ── 3. Jeder verwendete Schluessel existiert in de UND en ──────────────

function katalogSchluessel(pfad: string): Set<string> {
  return new Set(Object.keys(JSON.parse(readFileSync(pfad, 'utf-8')) as Record<string, string>));
}
const deSchluessel = katalogSchluessel(DE_KATALOG);
const enSchluessel = katalogSchluessel(EN_KATALOG);

const SCHLUESSEL_MUSTER = /^(?:testflug|editor)\.[a-zA-Z0-9_.]+$/;

/** Schluesselartige Literale im Namensraum testflug./editor. -- Argument von `t('...')` oder Tabellenwert (z. B. BewuchsStufe.ts). */
function verwendeteSchluessel(pfad: string, bereiche: Bereich[] | null): string[] {
  const quelltext = readFileSync(pfad, 'utf-8');
  const sourceFile = ts.createSourceFile(pfad, quelltext, ts.ScriptTarget.Latest, true);
  const treffer = new Set<string>();
  function besuch(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) && innerhalb(node.getStart(sourceFile), bereiche) && SCHLUESSEL_MUSTER.test(node.text)) {
      treffer.add(node.text);
    }
    ts.forEachChild(node, besuch);
  }
  besuch(sourceFile);
  return [...treffer];
}

console.log('\n── 2. Verwendete Schluessel existieren in de und en ──');
const alleVerwendeten = new Set<string>();
for (const quelle of QUELLEN) {
  for (const s of verwendeteSchluessel(quelle.pfad, quelle.bereiche)) alleVerwendeten.add(s);
}

const fehlendInDe = [...alleVerwendeten].filter((s) => !deSchluessel.has(s)).sort();
const fehlendInEn = [...alleVerwendeten].filter((s) => !enSchluessel.has(s)).sort();
check(`${alleVerwendeten.size} verwendete Schluessel existieren alle in de.json`, fehlendInDe.length === 0, fehlendInDe.join(', '));
check(`${alleVerwendeten.size} verwendete Schluessel existieren alle in en.json`, fehlendInEn.length === 0, fehlendInEn.join(', '));

console.log('');
if (failures === 0) {
  console.log('=== ALLE T0A-TEXT-PRUEFUNGEN BESTANDEN ===');
} else {
  console.error(`=== ${failures} T0A-TEXT-PRUEFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
