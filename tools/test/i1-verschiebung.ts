/**
 * Selbsttest von `tools/i1-verschiebung.mjs` (I1 step 0, N1): Fixtures, die ECHT verschieben, FÄLSCHEN oder
 * UNVOLLSTÄNDIG verschieben, je Form (Klassenmethode mit `this.`, freie Funktion mit Form a, Form 0 wörtlich).
 * Selftest of the move proof tool: real, forged and incomplete moves for each form.
 *
 * Herkunft der Fälschungen: die 78 Fälle des Angriffs auf #155 (Berichte/2026-09-30 I1 Schritt 0 — Angriff.md,
 * Proben a1 bis a10). Jede dort durchgerutschte Fälschung steht hier als Fixture und ist rot; auf dem Kopf 872eaa36
 * (vor N1) waren 41 von 78 grün. Der falsch rote Fall (A16, Vorgabewert mit `this.`) ist grün. Die drei echten
 * Treffer für ein lokales `k` (EntityManager.koppleClipTempo, GegenstandsKatalog.kameraRahmen und listeFuellen) stehen
 * in ihrer Form als Fixtures H5a bis H5c.
 *
 * Die Fixtures sind synthetisch (kein Zugriff auf die echten Dateien), damit der Test nach dem Aufteilen von
 * `WovServer.ts` nicht verwaist. Der Verschieber unten baut Rest und Ziel wie ein Bauer es täte, in der Form,
 * die das Werkzeug verlangt (`return modul.name(this, …)` und `import * as modul`).
 *
 * Run: npx tsx tools/test/i1-verschiebung.ts   (from the repo root)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { beweise, beweiseWoertlich } from '../i1-verschiebung.mjs';

const K = ts.SyntaxKind;
const parse = (t: string): ts.SourceFile => ts.createSourceFile('x.ts', t, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

// ── Ein Bauer-Verschieber ───────────────────────────────────────────────────────────────────

interface Stelle {
  von: number;
  bis: number;
  neu: string;
}
const ersetzeStellen = (text: string, stellen: Stelle[]): string => {
  let aus = text;
  for (const s of [...stellen].sort((a, b) => b.von - a.von)) aus = aus.slice(0, s.von) + s.neu + aus.slice(s.bis);
  return aus;
};

interface Schnitt {
  namen: string[];
  woertlich?: string[];
  kontext?: string;
  tabelle?: string[];
  fabrik?: string;
  ktyp?: string;
}
interface Ergebnis {
  alt: string;
  rest: string;
  ziel: string;
  eingabe: Record<string, unknown>;
}

/** Baut aus `alt` einen mechanisch richtigen Schnitt. */
function schnitt(alt: string, o: Schnitt): Ergebnis {
  const kontext = o.kontext ?? 'k';
  const ktyp = o.ktyp ?? 'Ktx';
  const tabelle = o.tabelle ?? [];
  const sf = parse(alt);
  const restStellen: Stelle[] = [];
  const zielTeile: string[] = [];
  const benutzte = new Set<string>();
  const modulName = 'ziel';
  const funde = new Map<string, { knoten: ts.FunctionLikeDeclaration & { body?: ts.Block }; methode: boolean }>();
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) funde.set(s.name.text, { knoten: s, methode: false });
    else if (ts.isClassDeclaration(s)) for (const m of s.members) if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) funde.set(m.name.text, { knoten: m, methode: true });
  }
  for (const name of o.namen) {
    const f = funde.get(name);
    if (!f) throw new Error(`Funktion ${name} nicht gefunden`);
    const n = f.knoten;
    const body = n.body as ts.Block;
    const basis = body.getStart(sf);
    const stellen: Stelle[] = [];
    const laufe = (x: ts.Node): void => {
      if (x.kind === K.ThisKeyword && ts.isPropertyAccessExpression(x.parent) && x.parent.expression === x) stellen.push({ von: x.getStart(sf) - basis, bis: x.end - basis, neu: kontext });
      if (ts.isIdentifier(x) && tabelle.includes(x.text)) {
        const p = x.parent;
        const istName = (ts.isPropertyAccessExpression(p) && p.name === x) || (ts.isPropertyAssignment(p) && p.name === x) || ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isEnumDeclaration(p) || ts.isFunctionExpression(p)) && p.name === x);
        if (!istName) stellen.push({ von: x.getStart(sf) - basis, bis: x.end - basis, neu: `${kontext}.${x.text}` });
      }
      if (ts.isIdentifier(x)) benutzte.add(x.text);
      ts.forEachChild(x, laufe);
    };
    laufe(body);
    ts.forEachChild(n, function alle(x: ts.Node): void {
      if (ts.isIdentifier(x)) benutzte.add(x.text);
      ts.forEachChild(x, alle);
    });
    const rumpf = ersetzeStellen(body.getText(sf), stellen);
    const mods = (ts.getModifiers(n) ?? []).map((m) => m.getText(sf));
    const async = mods.includes('async') ? 'async ' : '';
    const stern = n.asteriskToken ? '*' : '';
    const tp = n.typeParameters ? `<${n.typeParameters.map((p) => p.getText(sf)).join(', ')}>` : '';
    const params = n.parameters.map((p) => {
      const pst: Stelle[] = [];
      const pb = p.getStart(sf);
      const pl = (x: ts.Node): void => {
        if (x.kind === K.ThisKeyword && ts.isPropertyAccessExpression(x.parent) && x.parent.expression === x) pst.push({ von: x.getStart(sf) - pb, bis: x.end - pb, neu: kontext });
        ts.forEachChild(x, pl);
      };
      pl(p);
      return ersetzeStellen(p.getText(sf), pst);
    });
    const paramsRoh = n.parameters.map((p) => p.getText(sf));
    const args = n.parameters.map((p) => (p.dotDotDotToken ? '...' : '') + p.name.getText(sf));
    const ret = n.type ? `: ${n.type.getText(sf)}` : '';
    zielTeile.push(`export ${async}function${stern} ${name}${tp}(${[`${kontext}: ${ktyp}`, ...params].join(', ')})${ret} ${rumpf}`);
    const kopfMods = mods.length ? `${mods.join(' ')} ` : '';
    const ktx = f.methode ? 'this' : (o.fabrik ?? 'umgebung') + '()';
    const weiter = `${kopfMods}${f.methode ? '' : 'function '}${name}${tp}(${paramsRoh.join(', ')})${ret} { return ${modulName}.${name}(${[ktx, ...args].join(', ')}); }`;
    const kopfStart = n.getStart(sf);
    restStellen.push({ von: kopfStart, bis: n.end, neu: weiter });
  }
  // wörtliche Deklarationen
  const exportiert: string[] = [];
  for (const s of sf.statements) {
    const name = (ts.isFunctionDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name ? s.name.text : ts.isVariableStatement(s) && s.declarationList.declarations.length === 1 ? s.declarationList.declarations[0]!.name.getText(sf) : null;
    if (!name || !(o.woertlich ?? []).includes(name)) continue;
    const ex = !!ts.getModifiers(s)?.some((m) => m.kind === K.ExportKeyword);
    if (ex) exportiert.push(name);
    zielTeile.push(ex ? s.getText(sf) : `export ${s.getText(sf)}`);
    const t = s.getText(sf);
    ts.forEachChild(s, (x) => { const r = (y: ts.Node): void => { if (ts.isIdentifier(y)) benutzte.add(y.text); ts.forEachChild(y, r); }; r(x); });
    void t;
    restStellen.push({ von: s.getFullStart(), bis: s.end, neu: '' });
  }
  // Importe
  const imports: ts.ImportDeclaration[] = sf.statements.filter(ts.isImportDeclaration);
  const zielImports: string[] = [];
  for (const im of imports) {
    const ic = im.importClause;
    const namen: string[] = [];
    if (ic?.name) namen.push(ic.name.text);
    if (ic?.namedBindings) {
      if (ts.isNamespaceImport(ic.namedBindings)) namen.push(ic.namedBindings.name.text);
      else for (const e of ic.namedBindings.elements) namen.push(e.name.text);
    }
    if (!namen.some((x) => benutzte.has(x))) continue;
    const spec = (im.moduleSpecifier as ts.StringLiteral).text;
    const neuSpec = spec.startsWith('./') ? `.${spec}` : spec;
    zielImports.push(im.getText(sf).replace(spec, neuSpec));
  }
  let rest = ersetzeStellen(alt, restStellen);
  const letzterImport = imports.length ? imports[imports.length - 1]! : null;
  const zusatz = `import * as ${modulName} from './spiel/Ziel.js';\n${exportiert.length ? `export { ${exportiert.join(', ')} } from './spiel/Ziel.js';\n` : ''}`;
  if (letzterImport) {
    // die Stelle im NEUEN Rest suchen: Ende des letzten Imports ändert sich nicht (Importe liegen vor allen Stellen)
    rest = rest.slice(0, letzterImport.end) + `\n${zusatz.trimEnd()}` + rest.slice(letzterImport.end);
  } else rest = zusatz + rest;
  const ziel = `${[...zielImports, `import type { ${ktyp} } from './Kontext.js';`].join('\n')}\n\n${zielTeile.join('\n\n')}\n`;
  const eingabe: Record<string, unknown> = { alt, rest, ziele: [{ name: 'spiel/Ziel.ts', text: ziel }], namen: o.namen, woertlichNamen: o.woertlich ?? [], kontext: o.kontext, tabelle: new Map(tabelle.map((t) => [t, `${kontext}.${t}`])) };
  return { alt, rest, ziel, eingabe };
}

// ── Lauf eines Falls ────────────────────────────────────────────────────────────────────────

let rot = 0;
let faelle = 0;
const durchgerutscht: string[] = [];

interface Fall {
  id: string;
  name: string;
  soll: 'gruen' | 'rot';
  eingabe: Record<string, unknown>;
  /** Teilstring, den ein Befund enthalten muss (nur bei soll = rot). */
  erwartet?: string;
  freigegeben?: boolean;
  /** Aufruf über beweiseWoertlich (Kurzform). */
  kurz?: boolean;
}

function fall(f: Fall): void {
  faelle++;
  let erg: { befunde: string[]; freigegeben: string[] };
  try {
    erg = (f.kurz ? beweiseWoertlich : beweise)(f.eingabe);
  } catch (e) {
    erg = { befunde: [`AUSNAHME ${(e as Error).message}`], freigegeben: [] };
  }
  const ist = erg.befunde.length === 0 ? 'gruen' : 'rot';
  let ok = ist === f.soll;
  let grund = '';
  if (ok && f.soll === 'rot' && f.erwartet && !erg.befunde.some((b) => b.includes(f.erwartet!))) {
    ok = false;
    grund = `rot, aber kein Befund enthält "${f.erwartet}"`;
  }
  if (ok && f.freigegeben && erg.freigegeben.length === 0) {
    ok = false;
    grund = 'grün, aber die Freigabe steht nicht in der Ausgabe';
  }
  if (!ok) {
    rot++;
    if (f.soll === 'rot' && ist === 'gruen') durchgerutscht.push(f.id);
    console.log(`ROT  ${f.id} ${f.name}\n      soll ${f.soll}, ist ${ist}${grund ? `; ${grund}` : ''}\n      Befunde: ${JSON.stringify(erg.befunde.slice(0, 4))}`);
  } else console.log(`ok   ${f.id} ${f.name}`);
}

/** Kurzform: Eingabe mit Änderungen. */
const mit = (b: Ergebnis, aend: Record<string, unknown>): Record<string, unknown> => ({ ...b.eingabe, ...aend });
const zielMit = (b: Ergebnis, f: (z: string) => string): Record<string, unknown> => mit(b, { ziele: [{ name: 'spiel/Ziel.ts', text: f(b.ziel) }] });
const restMit = (b: Ergebnis, f: (r: string) => string): Record<string, unknown> => mit(b, { rest: f(b.rest) });
const muss = (alt: string, neu: string): string => {
  if (alt === neu) throw new Error('Fälschung hat nichts geändert');
  return neu;
};

// ── Ausgangsklasse (Klassenmethoden) ───────────────────────────────────────────────────────

const KLASSE = `import { readFileSync } from 'node:fs';
import { Peer } from './net/Peer.js';
import type { Welt } from './world/Welt.js';
import { StarterSet } from './konto/StarterSet.js';

const PARADE_AUSDAUER = 4;
const PARADE_FENSTER_MS = 250;
let instance: Server | null = null;

export class Server {
  private letzteTimeoutPruefung = 0;
  private zaehler = 0;
  readonly config = { name: 'x' };
  readonly welten = new Map<string, Welt>();
  constructor() {
    this.zaehler = 1;
    this.letzteTimeoutPruefung = 2;
    instance = this;
  }
  get geo(): number {
    return this.zaehler;
  }
  private handleA(p: Peer, r: number): void {
    // Kommentar
    if (this.zaehler > r) {
      this.log('viel');
      return;
    }
    this.zaehler += r;
  }
  async speichern(): Promise<void> {
    await this.schreiben();
  }
  weltAnlegen(id: string): Welt {
    return this.welten.get(id)!;
  }
  weltSpawn(): number {
    return this.zaehler + 1;
  }
  sendeEffekt(a: number, umkreis = 40): void {
    this.log(String(a + umkreis));
  }
  starter(p: Peer): void {
    StarterSet.gib(p);
    readFileSync('x');
    this.log('s');
  }
  handleParry(p: Peer): number {
    return PARADE_AUSDAUER + this.zaehler;
  }
  andere(): number {
    return 5 + this.zaehler * PARADE_FENSTER_MS;
  }
  zweite(): void {
    this.log('z');
  }
  private log(s: string): void {
    void s;
  }
  private async schreiben(): Promise<void> {
    void instance;
  }
}
`;
const NAMEN = ['handleA', 'speichern', 'weltAnlegen', 'weltSpawn', 'sendeEffekt', 'starter'];
const B = schnitt(KLASSE, { namen: NAMEN });
// Mit der Konstante PARADE_AUSDAUER (freier Name): sie wandert wörtlich im selben Lauf mit.
const BP = schnitt(KLASSE, { namen: [...NAMEN, 'handleParry'], woertlich: ['PARADE_AUSDAUER'] });

/** Ersetzt in der Funktion `name` einer Klasse (Rest) bzw. eines Ziels den Text per Funktion. */
function inFunktion(text: string, name: string, f: (t: string) => string, klasseMethode: boolean): string {
  const sf = parse(text);
  let knoten: ts.Node | undefined;
  if (klasseMethode) {
    for (const s of sf.statements) if (ts.isClassDeclaration(s)) for (const m of s.members) if ((ts.isMethodDeclaration(m) || ts.isGetAccessor(m)) && m.name.getText(sf) === name) knoten = m;
      else if (ts.isConstructorDeclaration(m) && name === 'constructor') knoten = m;
  } else knoten = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!knoten) throw new Error(`${name} nicht gefunden`);
  const alt = knoten.getText(sf);
  return text.slice(0, knoten.getStart(sf)) + muss(alt, f(alt)) + text.slice(knoten.end);
}

console.log('── Grundlinie und Fälschungen im verschobenen Rumpf ──');
fall({ id: 'G0', name: 'mechanisch richtiger Schnitt von 6 Methoden', soll: 'gruen', eingabe: B.eingabe });
fall({ id: 'G1', name: 'mit wörtlich mitgenommener Konstante PARADE_AUSDAUER (freier Name)', soll: 'gruen', eingabe: BP.eingabe });
fall({ id: 'A1', name: 'Zahl im Rumpf um 1 erhöht', soll: 'rot', eingabe: zielMit(B, (z) => inFunktion(z, 'sendeEffekt', (t) => t.replace('a + umkreis', 'a + umkreis + 1'), false)), erwartet: 'Rumpf weicht ab' });
fall({ id: 'A2', name: 'Bedingung verneint', soll: 'rot', eingabe: zielMit(B, (z) => muss(z, z.replace('if (k.zaehler > r)', 'if (!(k.zaehler > r))'))), erwartet: 'Rumpf weicht ab' });
fall({ id: 'A3', name: 'await entfernt', soll: 'rot', eingabe: zielMit(B, (z) => muss(z, z.replace('await k.schreiben()', 'k.schreiben()'))), erwartet: 'Rumpf weicht ab' });
fall({ id: 'A4', name: 'async am Ziel entfernt', soll: 'rot', eingabe: zielMit(B, (z) => muss(z, z.replace('export async function speichern', 'export function speichern'))), erwartet: 'async' });
fall({ id: 'A5', name: 'Vorgabewert eines Parameters im Ziel entfernt', soll: 'rot', eingabe: zielMit(B, (z) => muss(z, z.replace('umkreis = 40', 'umkreis'))), erwartet: 'Parameter' });
fall({ id: 'A6', name: 'Vorgabewert eines Parameters in der Weiterleitung entfernt', soll: 'rot', eingabe: restMit(B, (r) => muss(r, r.replace('umkreis = 40', 'umkreis'))), erwartet: 'andere Parameter' });
fall({ id: 'A7', name: 'freier Name: Zielmodul legt PARADE_AUSDAUER = 41 an (Wortlaut der wörtlichen Konstante geändert)', soll: 'rot', eingabe: zielMit(BP, (z) => muss(z, z.replace('PARADE_AUSDAUER = 4', 'PARADE_AUSDAUER = 41'))), erwartet: 'Text weicht ab' });
fall({ id: 'A7a', name: 'freier Name: dieselbe Konstante als zweite, nicht genannte Deklaration im Ziel', soll: 'rot', eingabe: zielMit(B, (z) => `${z}\nconst PARADE_AUSDAUER = 41;\n`), erwartet: 'nicht als' });
{
  const b2 = schnitt(KLASSE, { namen: [...NAMEN, 'handleParry'] }); // ohne die Konstante mitzunehmen
  fall({ id: 'A7c', name: 'freier Name: Konstante der Quelldatei, im Ziel weder wörtlich mitverschoben noch über die Tabelle', soll: 'rot', eingabe: b2.eingabe, erwartet: 'PARADE_AUSDAUER' });
  fall({ id: 'A7d', name: 'dieselbe Bindung, ausdrücklich freigegeben (--freigabe bindung:…): grün und in der Ausgabe', soll: 'gruen', freigegeben: true, eingabe: mit(b2, { freigaben: ['bindung:PARADE_AUSDAUER'] }) });
}
fall({ id: 'A7b', name: 'freier Name: Ziel importiert PARADE_AUSDAUER aus einer anderen Datei', soll: 'rot', eingabe: zielMit(BP, (z) => `import { PARADE_AUSDAUER } from './GanzAndereWerte.js';\n${z}`), erwartet: 'GanzAndereWerte' });
fall({ id: 'A7e', name: 'freier Name: importierter Name im Ziel aus anderer Datei als im Alt-Stand (StarterSet)', soll: 'rot', eingabe: zielMit(B, (z) => muss(z, z.replace("'../konto/StarterSet.js'", "'../boese/StarterSet.js'"))), erwartet: 'StarterSet' });
fall({ id: 'A7f', name: 'freier Name: importierter Name im Ziel gar nicht importiert', soll: 'rot', eingabe: zielMit(B, (z) => muss(z, z.replace("import { StarterSet } from '../konto/StarterSet.js';\n", ''))), erwartet: 'StarterSet' });

// H5: lokales k (die drei echten Formen und die synthetische)
function kFall(id: string, name: string, alt: string, methode: string): void {
  const b = schnitt(alt, { namen: [methode] });
  fall({ id, name: `${name} (this.→k. meint k sonst die lokale Variable)`, soll: 'rot', eingabe: mit(b, { freigaben: ['kein-this'] }), erwartet: 'Kontextname' });
  const g = schnitt(alt, { namen: [methode], kontext: 'ktx' });
  fall({ id: `${id}g`, name: `${name}: mit --kontext ktx grün`, soll: 'gruen', eingabe: mit(g, { freigaben: ['kein-this'] }) });
}
kFall('H5a', 'koppleClipTempo: const k = dyn.clipTempo!', `export class A {\n  koppleClipTempo(dyn: { clipTempo?: number }): void {\n    const k = dyn.clipTempo!;\n    this.assets.setzeAnimationsTempo(k);\n  }\n  assets = { setzeAnimationsTempo(x: number): void { void x; } };\n}\n`, 'koppleClipTempo');
kFall('H5b', 'kameraRahmen: const k = this.kamera', `export class A {\n  kamera = 1;\n  kameraRahmen(): number {\n    const k = this.kamera;\n    return k + 1;\n  }\n}\n`, 'kameraRahmen');
kFall('H5c', 'listeFuellen: (k, i) => { this.markenZeile… }', `export class A {\n  markenZeile: number[] = [];\n  listeFuellen(): void {\n    [1, 2].forEach((k, i) => {\n      this.markenZeile.push(k + i);\n    });\n  }\n}\n`, 'listeFuellen');
kFall('H5d', 'synthetisch: [this.config].forEach((k) => { void this.config; })', `export class A {\n  config = 1;\n  m(): void {\n    [this.config].forEach((k) => {\n      void this.config;\n      void k;\n    });\n  }\n}\n`, 'm');

// M1, N2 und Verschachtelung
{
  const ALT = (rumpf: string): string => `export class A {\n  config = 1;\n  m(a: number): void {\n    ${rumpf}\n  }\n}\n`;
  const mk = (rumpf: string, opt: Partial<Schnitt> = {}): Ergebnis => schnitt(ALT(rumpf), { namen: ['m'], ...opt });
  const bA = mk('void this.config; void a;');
  fall({ id: 'A10', name: 'this. in innerer function (bindet anders)', soll: 'rot', eingabe: mk('[1].map(function (x) { return this.config + x; });').eingabe, erwartet: 'verschachtelten' });
  fall({ id: 'A11', name: 'this. in Getter/Methode eines Objektliterals', soll: 'rot', eingabe: mk('const o = { get a() { return this.config; }, b() { return this.config; } }; void o;').eingabe, erwartet: 'verschachtelten' });
  fall({ id: 'A12', name: 'this. in Feld/static-Block einer inneren Klasse', soll: 'rot', eingabe: mk('const C = class { x = this.config; static { void this.name; } }; void C;').eingabe, erwartet: 'verschachtelten' });
  const bP = mk('[1].map((x) => this.config + x);');
  fall({ id: 'A13', name: 'this. in Pfeilfunktion (gleiches this, richtig verschoben)', soll: 'gruen', eingabe: bP.eingabe });
  fall({ id: 'A14', name: 'Pfeilfunktion im Ziel zu function gemacht', soll: 'rot', eingabe: zielMit(bP, (z) => muss(z, z.replace('(x) => k.config + x', 'function (x) { return k.config + x; }'))), erwartet: 'Rumpf weicht ab' });
  fall({ id: 'A15', name: 'arguments im Rumpf', soll: 'rot', eingabe: mk('if (arguments.length > 1) return; void arguments[0];').eingabe, erwartet: 'arguments' });
  const altV = `export class A {\n  config = 1;\n  m(extra = this.config, a: number): void {\n    void extra; void a;\n  }\n}\n`;
  const bV = schnitt(altV, { namen: ['m'] });
  fall({ id: 'A16', name: 'Vorgabewert mit this. richtig zu k. gemacht: grün (früher falsch rot)', soll: 'gruen', eingabe: bV.eingabe });
  fall({ id: 'A16b', name: 'Vorgabewert mit this. im Ziel stehen gelassen', soll: 'rot', eingabe: zielMit(bV, (z) => muss(z, z.replace('extra = k.config', 'extra = this.config'))), erwartet: 'Parameter' });
  fall({ id: 'A17', name: 'Ziel: Kontext als "k: any"', soll: 'rot', eingabe: zielMit(bA, (z) => muss(z, z.replace('(k: Ktx', '(k: any'))), erwartet: 'echten Typ' });
  fall({ id: 'A17b', name: 'Ziel: Kontext als "k: unknown"', soll: 'rot', eingabe: zielMit(bA, (z) => muss(z, z.replace('(k: Ktx', '(k: unknown'))), erwartet: 'echten Typ' });
  fall({ id: 'A17c', name: 'Ziel: Kontext als SpielKontext<any>', soll: 'rot', eingabe: zielMit(bA, (z) => muss(z, z.replace('(k: Ktx', '(k: SpielKontext<any>'))), erwartet: 'echten Typ' });
  fall({ id: 'A17d', name: 'Ziel: Kontext über lokales Alias auf any', soll: 'rot', eingabe: zielMit(bA, (z) => muss(z, `type Ktx = any;\n${z}`)), erwartet: 'echten Typ' });
  fall({ id: 'A17e', name: 'Ziel: Kontext ohne Typ', soll: 'rot', eingabe: zielMit(bA, (z) => muss(z, z.replace('(k: Ktx', '(k'))), erwartet: 'echten Typ' });
  fall({ id: 'A17f', name: 'Ziel: Kontext mit echtem Typalias ist grün (Hinweis, kein Befund)', soll: 'gruen', eingabe: zielMit(bA, (z) => `type Ktx = Pick<Server, 'config'>;\n${z}`) });
  fall({ id: 'A18', name: 'Ziel: Anweisung auf Modulebene mit Nebenwirkung', soll: 'rot', eingabe: zielMit(bA, (z) => `setInterval(() => process.exit(1), 1000);\n${z}`), erwartet: 'nicht erlaubt' });
  fall({ id: 'A18b', name: 'Ziel: Import mit Nebenwirkung', soll: 'rot', eingabe: zielMit(bA, (z) => `import './boese.js';\n${z}`), erwartet: 'Nebenwirkung' });
  fall({ id: 'A18c', name: 'Ziel: zusätzliche Klasse auf der Modulebene', soll: 'rot', eingabe: zielMit(bA, (z) => `${z}\nclass X { static a = process.exit(1); }\n`), erwartet: 'nicht erlaubt' });
  fall({ id: 'A19', name: 'Ziel: Funktion doppelt auf der Modulebene', soll: 'rot', eingabe: zielMit(bA, (z) => `${z}\n${z.split('\n\n')[1]}`), erwartet: 'doppelt' });
  fall({ id: 'A19b', name: 'Ziel: zweite, nicht genannte Funktion', soll: 'rot', eingabe: zielMit(bA, (z) => `${z}\nexport function heimlich(): void {}\n`), erwartet: 'nicht als verschoben genannt' });
  fall({ id: 'A20', name: 'Ziel: Funktion nicht exportiert', soll: 'rot', eingabe: zielMit(bA, (z) => muss(z, z.replace('export function m', 'function m'))), erwartet: 'nicht exportiert' });
  // N1: Kommentare mit Wirkung
  const altC = `export class A {\n  config = 1;\n  m(a: number): void {\n    // @ts-expect-error absichtlich\n    // eslint-disable-next-line no-console\n    console.log(this.config, a);\n  }\n}\n`;
  const bC = schnitt(altC, { namen: ['m'] });
  fall({ id: 'A21', name: 'Kommentare mit Wirkung im Ziel erhalten: grün', soll: 'gruen', eingabe: bC.eingabe });
  fall({ id: 'A21b', name: '// @ts-expect-error im Ziel verloren', soll: 'rot', eingabe: zielMit(bC, (z) => muss(z, z.replace('// @ts-expect-error absichtlich\n', ''))), erwartet: 'Kommentare mit Wirkung' });
  fall({ id: 'A21c', name: '// eslint-disable-next-line im Ziel verloren', soll: 'rot', eingabe: zielMit(bC, (z) => muss(z, z.replace(/\/\/ eslint-disable-next-line[^\n]*\n/, ''))), erwartet: 'Kommentare mit Wirkung' });
}

console.log('── W: Weiterleitung (H1) ──');
const rf = (name: string, f: (t: string) => string) => restMit(B, (r) => inFunktion(r, name, f, true));
fall({ id: 'W1', name: 'Argumente vertauscht', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('(this, p, r)', '(this, r, p)')), erwartet: 'Argument' });
fall({ id: 'W2', name: 'return fehlt, Rückgabetyp Welt', soll: 'rot', eingabe: rf('weltAnlegen', (t) => t.replace('{ return ', '{ ')), erwartet: 'return' });
fall({ id: 'W3', name: 'return fehlt, void', soll: 'rot', eingabe: rf('sendeEffekt', (t) => t.replace('{ return ', '{ ')), erwartet: 'return' });
fall({ id: 'W4', name: 'return fehlt bei async Promise<void>', soll: 'rot', eingabe: rf('speichern', (t) => t.replace('{ return ', '{ ')), erwartet: 'return' });
fall({ id: 'W5', name: 'async an der Weiterleitung entfernt', soll: 'rot', eingabe: rf('speichern', (t) => t.replace(/\basync /, '')), erwartet: 'Modifikatoren' });
fall({ id: 'W6', name: 'Nebenwirkung im Kontextausdruck: (this.zaehler = 0, this)', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('(this, p', '((this.zaehler = 0, this), p')), erwartet: 'statt genau `this`' });
fall({ id: 'W7', name: 'Kontext ist eine Kopie: {...this}', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('(this, p', '({ ...this }, p')), erwartet: 'statt genau `this`' });
fall({ id: 'W8', name: 'Kontext ist ein anderes Objekt: this.config', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('(this, p', '(this.config, p')), erwartet: 'statt genau `this`' });
fall({ id: 'W9', name: 'Aufruf an ein anderes Modul gleichen Funktionsnamens', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('ziel.handleA', 'falschesModul.handleA')), erwartet: 'kein `import * as`' });
fall({ id: 'W9b', name: 'Aufruf an ein anderes, importiertes Modul gleichen Funktionsnamens', soll: 'rot', eingabe: mit(B, { rest: B.rest.replace("import * as ziel from './spiel/Ziel.js';", "import * as ziel from './spiel/Ziel.js';\nimport * as anders from './spiel/Anders.js';").replace('return ziel.handleA', 'return anders.handleA') }), erwartet: 'nicht die Zieldatei' });
fall({ id: 'W10', name: 'Selbstaufruf: weltSpawn() { return this.weltSpawn(); }', soll: 'rot', eingabe: rf('weltSpawn', (t) => t.replace('return ziel.weltSpawn(this)', 'return this.weltSpawn()')), erwartet: 'statt `<modul>' });
fall({ id: 'W10b', name: 'Selbstaufruf ohne Import: return weltSpawn(this)', soll: 'rot', eingabe: rf('weltSpawn', (t) => t.replace('ziel.weltSpawn(this)', 'weltSpawn(this)')), erwartet: 'ohne `import' });
fall({ id: 'W11', name: 'zweite Anweisung in der Weiterleitung', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('{ return ', '{ this.zaehler = 0; return ')), erwartet: 'Anweisungen statt 1' });
fall({ id: 'W12', name: 'Nebenwirkung als Vorgabewert eines zusätzlichen Parameters', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('r: number)', 'r: number, _x = (this.zaehler = 0))')), erwartet: 'andere Parameter' });
fall({ id: 'W13', name: 'Weiterleitung static gemacht', soll: 'rot', eingabe: rf('weltSpawn', (t) => `static ${t}`), erwartet: 'Modifikatoren' });
fall({ id: 'W14', name: 'Aufruf in Bedingung verpackt (cond && f())', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('return ziel', 'return this.zaehler > 0 && ziel')), erwartet: 'etwas anderes' });
fall({ id: 'W15', name: 'Aufruf mit ?.', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('ziel.handleA(', 'ziel.handleA?.(')), erwartet: '?.' });
fall({ id: 'W15b', name: 'Aufruf ziel?.handleA(…)', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('ziel.handleA(', 'ziel?.handleA(')), erwartet: '?.' });
fall({ id: 'W16', name: 'Ergebnis verändert (|| undefined)', soll: 'rot', eingabe: rf('weltAnlegen', (t) => t.replace(/\); \}$/, ') || undefined; }')), erwartet: 'etwas anderes' });
fall({ id: 'W17', name: 'Methode doppelt im Rest (Weiterleitung zweimal)', soll: 'rot', eingabe: rf('handleA', (t) => `${t}\n  ${t}`), erwartet: '2× gefunden' });
fall({ id: 'W18', name: 'Weiterleitung als Klassenfeld mit Pfeilfunktion', soll: 'rot', eingabe: rf('weltSpawn', (t) => t.replace(/^(.*?)weltSpawn\(\): number \{ return ([^;]+); \}$/s, '$1weltSpawn = (): number => $2;')), erwartet: '0× gefunden' });
fall({ id: 'W19', name: 'Weiterleitung mit await statt return', soll: 'rot', eingabe: rf('speichern', (t) => t.replace('{ return ', '{ await ')), erwartet: 'return' });
fall({ id: 'W20', name: 'Sichtbarkeit der Weiterleitung geändert (private → öffentlich)', soll: 'rot', eingabe: rf('handleA', (t) => muss(t, t.replace(/^private /, ''))), erwartet: 'Modifikatoren' });
fall({ id: 'W21', name: 'Rückgabetyp der Weiterleitung geändert', soll: 'rot', eingabe: rf('weltSpawn', (t) => t.replace(': number {', ': number | undefined {')), erwartet: 'Rückgabetyp' });
fall({ id: 'W22', name: 'Weiterleitung mit Mehrzeilen-Signatur (Rumpf 3 Zeilen) ist grün', soll: 'gruen', eingabe: (() => { const alt = `export class A {\n  zaehler = 0;\n  lang(\n    a: number,\n    b: number,\n    c: string,\n  ): void {\n    this.zaehler += a + b + c.length;\n  }\n}\n`; const b = schnitt(alt, { namen: ['lang'] }); return mit(b, { rest: b.rest.replace(/lang\(([^)]*)\): void \{ return ziel\.lang\(this, a, b, c\); \}/s, 'lang(\n    a: number,\n    b: number,\n    c: string,\n  ): void {\n    return ziel.lang(this, a, b, c);\n  }') }); })() });
fall({ id: 'W23', name: 'Rumpf der Weiterleitung über 3 Zeilen', soll: 'rot', eingabe: rf('handleA', (t) => t.replace('{ return ziel.handleA(this, p, r); }', '{\n    // a\n    // b\n\n    return ziel.handleA(this, p, r);\n  }')), erwartet: 'Zeilen lang' });

console.log('── R: der Rest der Quelldatei (H2) ──');
const rr = (aend: (r: string) => string): Record<string, unknown> => restMit(B, aend);
fall({ id: 'R1', name: 'nicht genannte Methode verändert (Zahl +1)', soll: 'rot', eingabe: rr((r) => inFunktion(r, 'andere', (t) => t.replace('return 5', 'return 6'), true)), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R2', name: 'Konstruktor: Anweisung am Anfang eingefügt', soll: 'rot', eingabe: rr((r) => inFunktion(r, 'constructor', (t) => t.replace('{', '{ process.exitCode = 3;'), true)), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R3', name: 'Konstruktor: die letzten zwei Anweisungen vertauscht', soll: 'rot', eingabe: rr((r) => muss(r, r.replace('    this.letzteTimeoutPruefung = 2;\n    instance = this;', '    instance = this;\n    this.letzteTimeoutPruefung = 2;'))), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R4', name: 'Feld letzteTimeoutPruefung: Anfangswert geändert', soll: 'rot', eingabe: rr((r) => muss(r, r.replace('letzteTimeoutPruefung = 0', 'letzteTimeoutPruefung = 1'))), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R5', name: 'Accessor geo verändert', soll: 'rot', eingabe: rr((r) => inFunktion(r, 'geo', (t) => t.replace('return this.zaehler', 'return this.zaehler + 1'), true)), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R6', name: 'Modul-Konstante PARADE_FENSTER_MS im Rest geändert', soll: 'rot', eingabe: rr((r) => muss(r, r.replace('PARADE_FENSTER_MS = 250', 'PARADE_FENSTER_MS = 251'))), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R7', name: "Import umgebogen: './konto/StarterSet.js' → './boese.js'", soll: 'rot', eingabe: rr((r) => muss(r, r.replace("'./konto/StarterSet.js'", "'./boese.js'"))), erwartet: 'boese' });
fall({ id: 'R8', name: 'Anweisung auf Modulebene im Rest angehängt', soll: 'rot', eingabe: rr((r) => `${r}\nprocess.on('exit', () => {});\n`), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R9', name: 'nicht genannte Methode: private → öffentlich (Modifikator)', soll: 'rot', eingabe: rr((r) => inFunktion(r, 'log', (t) => t.replace(/^private /, ''), true)), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R9b', name: 'nicht genannte Methode: static davorgesetzt', soll: 'rot', eingabe: rr((r) => inFunktion(r, 'zweite', (t) => `static ${t}`, true)), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R10', name: 'nicht genannte Methode ein zweites Mal weiter unten mit anderem Rumpf', soll: 'rot', eingabe: rr((r) => inFunktion(r, 'zweite', (t) => `${t}\n  zweite(): void { process.exitCode = 3; }`, true)), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'R11', name: 'Import entfernt, obwohl der Name im Rest noch gebraucht wird', soll: 'rot', eingabe: rr((r) => muss(r, r.replace("import { Peer } from './net/Peer.js';\n", ''))), erwartet: 'Peer' });
fall({ id: 'R12', name: 'neuer Import im Rest aus einer Nicht-Zieldatei', soll: 'rot', eingabe: rr((r) => `import { x } from './neu.js';\n${r}`), erwartet: 'Zieldatei' });
fall({ id: 'R13', name: 'Import mit Nebenwirkung im Rest neu', soll: 'rot', eingabe: rr((r) => `import './boese.js';\n${r}`), erwartet: 'Zieldatei' });
fall({ id: 'R14', name: 'Import, dessen Name im Rest nicht mehr vorkommt, entfernt: grün', soll: 'gruen', eingabe: rr((r) => muss(r, r.replace("import { StarterSet } from './konto/StarterSet.js';\n", ''))) });
fall({ id: 'R15', name: 'Kommentar mit Wirkung im Rest verloren', soll: 'rot', eingabe: (() => { const alt = KLASSE.replace('  zweite(): void {', '  // @ts-ignore alt\n  zweite(): void {'); const b = schnitt(alt, { namen: NAMEN }); return mit(b, { rest: muss(b.rest, b.rest.replace('  // @ts-ignore alt\n', '')) }); })(), erwartet: 'Kommentare mit Wirkung im Rest' });


// Geltungsbereiche: ein lokal deklarierter Name ist nur innerhalb seines Bereichs lokal
{
  const alt = (rumpf: string, param = ''): string => `const LIMIT = 4;\nexport class A {\n  zaehler = 0;\n  m(${param}): number {\n    ${rumpf}\n  }\n}\n`;
  const b1 = schnitt(alt('return LIMIT + this.zaehler;'), { namen: ['m'] });
  fall({ id: 'S1', name: 'freier Name der Quelldatei (LIMIT), nicht mitverschoben: rot', soll: 'rot', eingabe: b1.eingabe, erwartet: 'LIMIT' });
  const b2 = schnitt(alt('return LIMIT + this.zaehler;'), { namen: ['m'], woertlich: ['LIMIT'] });
  fall({ id: 'S2', name: 'dieselbe Konstante wörtlich mitverschoben: grün', soll: 'gruen', eingabe: b2.eingabe });
  const b3 = schnitt(alt('return LIMIT + this.zaehler;', 'LIMIT: number'), { namen: ['m'] });
  fall({ id: 'S3', name: 'Parameter gleichen Namens verdeckt die Konstante überall: grün', soll: 'gruen', eingabe: b3.eingabe });
  const b4 = schnitt(alt('{ const LIMIT = 9; void LIMIT; } return LIMIT + this.zaehler;'), { namen: ['m'] });
  fall({ id: 'S4', name: 'lokales const im Block, aber ein Verweis außerhalb bindet an die Modulkonstante: rot', soll: 'rot', eingabe: b4.eingabe, erwartet: 'LIMIT' });
  const b5 = schnitt(alt('const LIMIT = 9; return LIMIT + this.zaehler;'), { namen: ['m'] });
  fall({ id: 'S5', name: 'lokales const im ganzen Rumpf: grün', soll: 'gruen', eingabe: b5.eingabe });
  const b6 = schnitt(alt('try { return this.zaehler; } catch (LIMIT) { return LIMIT; }'), { namen: ['m'] });
  fall({ id: 'S6', name: 'catch-Variable verdeckt die Konstante nur im catch: grün', soll: 'gruen', eingabe: b6.eingabe });
  const b7 = schnitt(alt('for (const LIMIT of [1]) { void LIMIT; } return LIMIT;'), { namen: ['m'] });
  fall({ id: 'S7', name: 'for-of-Variable verdeckt nur die Schleife, danach bindet LIMIT an die Modulkonstante: rot', soll: 'rot', eingabe: b7.eingabe, erwartet: 'LIMIT' });
  const b8 = schnitt(`export interface Eintrag {\n  a: number;\n}\nexport class A {\n  m(e: Eintrag): number {\n    return e.a + this.n;\n  }\n  n = 1;\n}\n`, { namen: ['m'] });
  fall({ id: 'S8', name: 'Typ der Quelle in der Signatur, nicht mitverschoben: rot', soll: 'rot', eingabe: b8.eingabe, erwartet: 'Eintrag' });
  const b9 = schnitt(`export interface Eintrag {\n  a: number;\n}\nexport class A {\n  m(e: Eintrag): number {\n    return e.a + this.n;\n  }\n  n = 1;\n}\n`, { namen: ['m'], woertlich: ['Eintrag'] });
  fall({ id: 'S9', name: 'Typ wörtlich mitverschoben (interface): grün', soll: 'gruen', eingabe: mit(b9, {}) });
}

console.log('── F: Form a (freie Funktion) und Ersetzungstabelle (M2) ──');
const ADM = `import { readFileSync, writeFileSync } from 'node:fs';

const ADMINS_DATEI = 'admins.json';
const KONTEN_DB = 'konten.db';
function sichern(datei: string): void {
  void datei;
}
function spielerIdGueltig(w: unknown): w is string {
  return typeof w === 'string';
}
function adminsLesen(): string[] {
  const roh = readFileSync(ADMINS_DATEI, 'utf-8');
  return roh.split('\\n').filter(spielerIdGueltig);
}
function adminsSchreiben(liste: string[]): void {
  sichern(ADMINS_DATEI);
  const meta = { ADMINS_DATEI: 1 };
  writeFileSync(ADMINS_DATEI, liste.join('\\n') + meta.ADMINS_DATEI);
}
function daneben(): string {
  return KONTEN_DB;
}
`;
const FN = ['adminsLesen', 'adminsSchreiben'];
const FT = ['ADMINS_DATEI', 'sichern', 'spielerIdGueltig'];
const BF = schnitt(ADM, { namen: FN, tabelle: FT, fabrik: 'kontenUmgebung' });
const FREI = { freigaben: ['umgebung:kontenUmgebung'] };
fall({ id: 'F0', name: 'Grundlinie Form a: adminsLesen, adminsSchreiben (Umgebung ausdrücklich freigegeben)', soll: 'gruen', freigegeben: true, eingabe: mit(BF, FREI) });
fall({ id: 'F0b', name: 'dieselbe Verschiebung OHNE Freigabe der Umgebung: rot (Inhalt der Fabrik nicht beweisbar)', soll: 'rot', eingabe: BF.eingabe, erwartet: 'umgebung:kontenUmgebung' });
const schatten: Record<string, string> = {
  'innerer Block const': '{ const ADMINS_DATEI = "x"; void ADMINS_DATEI; }',
  'Pfeil-Parameter': '[1].map((ADMINS_DATEI) => ADMINS_DATEI);',
  'catch-Variable': 'try { void 0; } catch (ADMINS_DATEI) { void ADMINS_DATEI; }',
  'for-of-Variable': 'for (const ADMINS_DATEI of [1]) void ADMINS_DATEI;',
  Destrukturierung: 'const { ADMINS_DATEI } = { ADMINS_DATEI: 1 }; void ADMINS_DATEI;',
  'Destrukturierung mit Umbenennung': 'const { x: ADMINS_DATEI } = { x: 1 }; void ADMINS_DATEI;',
  'innere function gleichen Namens': 'function ADMINS_DATEI() {} void ADMINS_DATEI;',
  'Klassenausdruck mit Namen': 'const C = class ADMINS_DATEI { m() { return ADMINS_DATEI; } }; void C;',
  'lokales enum': 'enum ADMINS_DATEI { A } void ADMINS_DATEI.A;',
  'lokale Klasse': 'class ADMINS_DATEI {} void ADMINS_DATEI;',
  'Parameter innerer function': '(function (ADMINS_DATEI: number) { return ADMINS_DATEI; })(1);',
};
{
  let i = 1;
  for (const [was, code] of Object.entries(schatten)) {
    const altS = ADM.replace("function adminsLesen(): string[] {\n", `function adminsLesen(): string[] {\n  ${code}\n`);
    const bS = schnitt(altS, { namen: FN, tabelle: FT, fabrik: 'kontenUmgebung' });
    fall({ id: `F${i++}`, name: `Schatten (${was}): lokaler Name wird blind mit ersetzt`, soll: 'rot', eingabe: mit(bS, FREI) });
  }
}
fall({ id: 'F20', name: 'Tabelle bildet auf ein ANDERES Feld ab: ADMINS_DATEI=k.KONTEN_DB', soll: 'rot', eingabe: mit(BF, { ...FREI, tabelle: new Map([...FT.map((t) => [t, `k.${t}`]), ['ADMINS_DATEI', 'k.KONTEN_DB']]), ziele: [{ name: 'spiel/Ziel.ts', text: BF.ziel.replaceAll('k.ADMINS_DATEI', 'k.KONTEN_DB') }] }), erwartet: 'Ersetzungseintrag' });
fall({ id: 'F20b', name: 'dieselbe Abweichung ausdrücklich freigegeben (--freigabe tabelle:…): grün und in der Ausgabe', soll: 'gruen', freigegeben: true, eingabe: mit(BF, { freigaben: ['umgebung:kontenUmgebung', 'tabelle:ADMINS_DATEI=k.KONTEN_DB'], tabelle: new Map([...FT.map((t) => [t, `k.${t}`]), ['ADMINS_DATEI', 'k.KONTEN_DB']]), ziele: [{ name: 'spiel/Ziel.ts', text: BF.ziel.replaceAll('k.ADMINS_DATEI', 'k.KONTEN_DB') }] }) });
fall({ id: 'F21', name: "Tabelle bildet auf einen festen Wert ab: ADMINS_DATEI='/etc/passwd'", soll: 'rot', eingabe: mit(BF, { ...FREI, tabelle: new Map([...FT.map((t) => [t, `k.${t}`]), ['ADMINS_DATEI', "'/etc/passwd'"]]), ziele: [{ name: 'spiel/Ziel.ts', text: BF.ziel.replaceAll('k.ADMINS_DATEI', "'/etc/passwd'") }] }), erwartet: 'Ersetzungseintrag' });
{
  const b2 = schnitt(ADM, { namen: FN, tabelle: ['ADMINS_DATEI', 'spielerIdGueltig'], fabrik: 'kontenUmgebung' });
  fall({ id: 'F22', name: 'Name "sichern" NICHT in der Tabelle; Zielmodul bringt ein eigenes leeres sichern() mit', soll: 'rot', eingabe: mit(b2, { ...FREI, ziele: [{ name: 'spiel/Ziel.ts', text: `function sichern(..._a: unknown[]): void {}\n${b2.ziel}` }] }), erwartet: 'sichern' });
  fall({ id: 'F22b', name: 'Name "sichern" nicht in der Tabelle, sonst nichts im Ziel: freier Name der Quelle ungebunden', soll: 'rot', eingabe: mit(b2, FREI), erwartet: 'sichern' });
}
fall({ id: 'F23', name: 'Weiterleitung baut die Umgebung mit anderen Werten: { ...kontenUmgebung(), ADMINS_DATEI: "/tmp/x" }', soll: 'rot', eingabe: mit(BF, { ...FREI, rest: muss(BF.rest, BF.rest.replace('ziel.adminsLesen(kontenUmgebung()', 'ziel.adminsLesen({ ...kontenUmgebung(), ADMINS_DATEI: "/tmp/x" }')) }), erwartet: 'keine Fabrik' });
fall({ id: 'F24', name: 'Weiterleitung übergibt eine andere Fabrik in der zweiten Funktion', soll: 'rot', eingabe: mit(BF, { ...FREI, rest: muss(BF.rest, BF.rest.replace('ziel.adminsSchreiben(kontenUmgebung()', 'ziel.adminsSchreiben(andereUmgebung()')) }), erwartet: 'verschiedene Kontext-Fabriken' });
fall({ id: 'F25', name: 'Rest: daneben() (nicht genannte Funktion) verändert', soll: 'rot', eingabe: mit(BF, { ...FREI, rest: muss(BF.rest, BF.rest.replace('return KONTEN_DB', 'return "x"')) }), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'F26', name: 'Tabelle: Eintrag ohne Treffer', soll: 'rot', eingabe: mit(BF, { ...FREI, tabelle: new Map([...FT.map((t) => [t, `k.${t}`]), ['GIBTS_NICHT', 'k.GIBTS_NICHT']]) }), erwartet: 'keinen Treffer' });
fall({ id: 'F27', name: 'Objektschlüssel und Property ADMINS_DATEI werden nicht ersetzt (grün)', soll: 'gruen', eingabe: mit(BF, FREI) });
fall({ id: 'F28', name: 'Kurzform { ADMINS_DATEI } ist Befund', soll: 'rot', eingabe: (() => { const alt = ADM.replace('const meta = { ADMINS_DATEI: 1 };', 'const meta = { ADMINS_DATEI };').replace('meta.ADMINS_DATEI', 'meta.ADMINS_DATEI'); const b = schnitt(alt, { namen: FN, tabelle: FT, fabrik: 'kontenUmgebung' }); return mit(b, FREI); })(), erwartet: 'Kurzform' });

console.log('── N: Form 0 (wörtlich, ohne Kontext) und Reexporte (H3) ──');
const WAFFE = `import { Inventory } from './items/Inventory.js';

export class Wov {
  private zaehler = 0;
  init(): number {
    return this.zaehler + 1;
  }
}

export function gepruefteWaffe(inventar: Inventory, waffe: string): string {
  return inventar.has(waffe) ? waffe : '';
}
export function waffeTragbar(inventar: Inventory, name: string): boolean {
  return inventar.has(name);
}
export const KREATUR_DROPS: Record<string, number> = { wolf: 2, kuh: 1 };
const TRUHEN = [1, 2, 3];
export function wuerfleTruhe(i: number): number {
  return TRUHEN[i % 3]!;
}
export function createWov(inv: Inventory | null = null): Wov {
  void inv;
  return new Wov();
}
`;
const WN = ['gepruefteWaffe', 'waffeTragbar', 'KREATUR_DROPS', 'TRUHEN', 'wuerfleTruhe'];
const BN = schnitt(WAFFE, { namen: [], woertlich: WN });
const w = (e: Record<string, unknown>): Record<string, unknown> => e;
fall({ id: 'N0', name: 'Grundlinie Form 0: 5 Namen (3 exportiert, 2 nicht)', soll: 'gruen', eingabe: BN.eingabe });
fall({ id: 'N0b', name: 'Grundlinie über beweiseWoertlich (Kurzform) ist gleich', soll: 'gruen', kurz: true, eingabe: { ...BN.eingabe, namen: WN, woertlichNamen: [] } });
fall({ id: 'N1', name: 'Reexport zeigt auf eine ANDERE Datei', soll: 'rot', eingabe: w(restMit(BN, (r) => muss(r, r.replace("export { gepruefteWaffe, waffeTragbar, KREATUR_DROPS, wuerfleTruhe } from './spiel/Ziel.js'", "export { gepruefteWaffe, waffeTragbar, KREATUR_DROPS, wuerfleTruhe } from './spiel/GanzAnders.js'")))), erwartet: 'GanzAnders' });
fall({ id: 'N2', name: 'Reexport mit Alias: export { waffeTragbar as gepruefteWaffe }', soll: 'rot', eingabe: w(restMit(BN, (r) => muss(r, r.replace('export { gepruefteWaffe, waffeTragbar,', 'export { waffeTragbar as gepruefteWaffe, waffeTragbar,')))), erwartet: 'Alias' });
fall({ id: 'N3', name: 'Import der nicht exportierten Namen aus einer anderen Datei', soll: 'rot', eingabe: w(restMit(BN, (r) => `import { TRUHEN } from './spiel/GanzAnders.js';\n${r}`)), erwartet: 'Zieldatei' });
fall({ id: 'N4', name: 'Klasse im selben Schritt verändert (Methode init, Zahl +1)', soll: 'rot', eingabe: w(restMit(BN, (r) => inFunktion(r, 'init', (t) => t.replace('+ 1', '+ 2'), true))), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'N5', name: 'Anweisung auf Modulebene im Rest angehängt', soll: 'rot', eingabe: w(restMit(BN, (r) => `${r}\nprocess.exitCode = 3;\n`)), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'N6', name: 'Ziel hat zusätzlich eine Anweisung mit Nebenwirkung', soll: 'rot', eingabe: w(zielMit(BN, (z) => `${z}\nKREATUR_DROPS['x' as never] = [] as never;\n`)), erwartet: 'nicht erlaubt' });
fall({ id: 'N6b', name: 'Ziel: zusätzliche Konstante mit Nebenwirkung im Initialisierer', soll: 'rot', eingabe: w(zielMit(BN, (z) => `${z}\nexport const HEIMLICH = process.exit(1);\n`)), erwartet: 'nicht als wörtlich' });
fall({ id: 'N7', name: 'Ziel: const zu let gemacht', soll: 'rot', eingabe: w(zielMit(BN, (z) => muss(z, z.replace('export const KREATUR_DROPS', 'export let KREATUR_DROPS')))), erwartet: 'Text weicht ab' });
fall({ id: 'N8', name: 'Ziel: Wert in der Tabelle geändert', soll: 'rot', eingabe: w(zielMit(BN, (z) => muss(z, z.replace('wolf: 2', 'wolf: 3')))), erwartet: 'Text weicht ab' });
fall({ id: 'N9', name: 'Reexport fehlt', soll: 'rot', eingabe: w(restMit(BN, (r) => r.replace(/export \{[^}]*\} from '\.\/spiel\/Ziel\.js';\n/, ''))), erwartet: 'fehlt' });
fall({ id: 'N10', name: 'Reexport erweitert die Oberfläche um einen nicht exportierten Namen (TRUHEN)', soll: 'rot', eingabe: w(restMit(BN, (r) => muss(r, r.replace('wuerfleTruhe } from', 'wuerfleTruhe, TRUHEN } from')))), erwartet: 'nicht exportiert' });
fall({ id: 'N11', name: 'Deklaration bleibt im Rest (doppelt)', soll: 'rot', eingabe: w(restMit(BN, (r) => `${r}\nexport const KREATUR_DROPS: Record<string, number> = { wolf: 2, kuh: 1 };\n`)), erwartet: 'noch' });
fall({ id: 'N12', name: 'Ziel exportiert die Konstante nicht', soll: 'rot', eingabe: w(zielMit(BN, (z) => muss(z, z.replace('export const KREATUR_DROPS', 'const KREATUR_DROPS')))), erwartet: 'nicht exportiert' });
fall({ id: 'N13', name: 'Ziel fehlt für einen Namen', soll: 'rot', eingabe: w(zielMit(BN, (z) => z.replace(/export const KREATUR_DROPS[^\n]*\n/, ''))), erwartet: 'fehlt' });
fall({ id: 'N14', name: 'nicht genannte Funktion des Rests (createWov) verändert', soll: 'rot', eingabe: w(restMit(BN, (r) => muss(r, r.replace('return new Wov()', 'return new Wov() as Wov')))), erwartet: 'Rest der Quelldatei weicht ab' });
fall({ id: 'N15', name: 'Import entfernt, obwohl der Name im Rest noch gebraucht wird', soll: 'rot', eingabe: w(restMit(BN, (r) => r.replace("import { Inventory } from './items/Inventory.js';\n", ''))), erwartet: 'Inventory' });
fall({ id: 'N16', name: 'Ziel: Import der Quelle ohne Gegenstück (heimlich)', soll: 'rot', eingabe: w(zielMit(BN, (z) => `import { x } from '../heimlich.js';\n${z}`)), erwartet: 'kein Gegenstück' });
fall({ id: 'N17', name: 'der Rest hat keinen Reexport für nicht exportierte Namen: grün (siehe N0)', soll: 'gruen', eingabe: BN.eingabe });
fall({ id: 'N18', name: 'Namensliste leer', soll: 'rot', eingabe: mit(BN, { namen: [], woertlichNamen: [] }), erwartet: 'leer' });
fall({ id: 'N19', name: 'Name in beiden Listen', soll: 'rot', eingabe: mit(BN, { namen: ['gepruefteWaffe'] }), erwartet: 'beiden Listen' });

console.log('── Grenzen: N3 (falsch rot bei Einzelschnitt ohne this.) ──');
{
  const alt = `export class A {\n  m(): number {\n    return 1;\n  }\n  n(): number {\n    return 2;\n  }\n}\n`;
  const b = schnitt(alt, { namen: ['m'] });
  fall({ id: 'L1', name: 'N3: einzeln verschobene Methode ohne this. → rot mit Hinweis', soll: 'rot', eingabe: b.eingabe, erwartet: 'kein-this' });
  fall({ id: 'L2', name: 'N3: dieselbe Methode mit --freigabe kein-this → grün', soll: 'gruen', eingabe: mit(b, { freigaben: ['kein-this'] }) });
}

// ── Kommandozeile ───────────────────────────────────────────────────────────────────────────
{
  const werkzeug = resolve(import.meta.dirname, '../i1-verschiebung.mjs');
  const tmp = mkdtempSync(join(tmpdir(), 'i1-verschiebung-'));
  try {
    const dir = join(tmp, 'server', 'src');
    const spiel = join(dir, 'spiel');
    ts.sys.createDirectory(join(tmp, 'server'));
    ts.sys.createDirectory(dir);
    ts.sys.createDirectory(spiel);
    writeFileSync(join(dir, 'alt.ts'), B.alt);
    writeFileSync(join(dir, 'rest.ts'), B.rest);
    writeFileSync(join(spiel, 'Ziel.ts'), B.ziel);
    const lauf = (extra: string[]): { status: number | null; out: string } => {
      const r = spawnSync(process.execPath, [werkzeug, '--alt', join(dir, 'alt.ts'), '--rest', join(dir, 'rest.ts'), '--ziel', join(spiel, 'Ziel.ts'), ...extra], { encoding: 'utf-8' });
      return { status: r.status, out: r.stdout + r.stderr };
    };
    const gut = lauf(['--namen', NAMEN.join(','), '--klasse', 'Server']);
    faelle++;
    if (gut.status === 0 && /BEWEIS ERBRACHT/.test(gut.out)) console.log('ok   CLI: echter Lauf endet mit 0');
    else { rot++; console.log(`ROT  CLI: echter Lauf endet nicht mit 0\n${gut.out}`); }
    writeFileSync(join(spiel, 'Ziel.ts'), B.ziel.replace('k.zaehler > r', 'k.zaehler >= r'));
    const schlecht = lauf(['--namen', NAMEN.join(','), '--klasse', 'Server']);
    faelle++;
    if (schlecht.status === 1 && /BEWEIS GESCHEITERT/.test(schlecht.out)) console.log('ok   CLI: gefälschter Lauf endet mit 1');
    else { rot++; console.log(`ROT  CLI: gefälschter Lauf endet nicht mit 1\n${schlecht.out}`); }
    const falsch = spawnSync(process.execPath, [werkzeug, '--alt'], { encoding: 'utf-8' });
    faelle++;
    if (falsch.status === 2) console.log('ok   CLI: falscher Aufruf endet mit 2');
    else { rot++; console.log('ROT  CLI: falscher Aufruf endet nicht mit 2'); }
    const unbekannt = spawnSync(process.execPath, [werkzeug, '--gibtsnicht'], { encoding: 'utf-8' });
    faelle++;
    if (unbekannt.status === 2) console.log('ok   CLI: unbekannter Schalter endet mit 2');
    else { rot++; console.log('ROT  CLI: unbekannter Schalter endet nicht mit 2'); }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (durchgerutscht.length) console.log(`\nDurchgerutschte Fälschungen: ${durchgerutscht.join(', ')}`);
console.log(rot === 0 ? `\ni1-verschiebung: ${faelle} Fälle, alle wie erwartet.` : `\ni1-verschiebung: ${rot} von ${faelle} Fällen ROT.`);
process.exit(rot === 0 ? 0 : 1);
