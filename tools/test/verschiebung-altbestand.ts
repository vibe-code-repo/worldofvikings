/**
 * Self-test of the move proof (`tools/verschiebung/`), part 2: the fixtures of the earlier proof
 * tool, transferred.
 *
 * The earlier tool (the former one from I1 step 0) had 151 fixtures: real cuts, forgeries and
 * incomplete cuts, most of them from the two attacks on it. Every one of them stands here with the
 * expectation it had there (`herkunft`). Where the result here differs, a reason is given, and the
 * run prints a table of all transferred fixtures. A fixture that was red there and is green here
 * without a reason fails.
 *
 * Differences by design:
 *  - Form k follows the rules of the task card: the forwarder has no `async`, the function in the
 *    target has no `export` (export list at the end), the context type is a `Pick` of the class,
 *    and the mover keeps the `this` of an inner function, object literal method or class
 *    expression, because it binds differently. The earlier mover replaced every `this` blindly;
 *    the blind replacement stands here as its own forgery (`…b`).
 *  - Releases are keys with a reason. `bindung:<name>` and `kein-this` of the earlier tool do not
 *    exist; a fixture that was green there only through such a release is red here.
 *  - Form a (a free function that gets its environment from a factory) is stage 2. Its fixtures
 *    run as far as stage 1 can express them: verbatim (form 0) where the fixture has a form 0
 *    meaning, and as the form a cut itself where it has none. The tool must refuse that cut.
 *  - The four command line cases stand in `verschiebung-aufruf.ts`.
 *
 * Run: npx tsx tools/test/verschiebung-altbestand.ts   (from the repository root)
 */
import ts from 'typescript';
import { ManifestFehler, leseManifest, pruefeManifest } from '../verschiebung/manifest';
import { Lauf, mit, mitWeiterleitung, muss, schnitt, type Eingabe } from '../verschiebung/pruefstand/probe';
import type { Auftrag } from '../verschiebung/pruefstand/verschieber';
import { AUFTRAG_KLEIN, UMFELD, ZIEL_KLEIN, kleineKlasse } from '../verschiebung/pruefstand/vorlagen';
import type { Freigabe, RegelId } from '../verschiebung/typen';

const lauf = new Lauf('verschiebung-altbestand');
const GRUND = 'Reason written for the self-test: the effect is harmless here.';
const ersetze = (von: string, nach: string) => (t: string): string => muss(t, t.replace(von, nach), von);
const ROT = { alt: 'rot' } as const;
const GRUEN = { alt: 'gruen' } as const;
const rotHierGruen = (grund: string) => ({ alt: 'rot', grund }) as const;
const gruenHierRot = (grund: string) => ({ alt: 'gruen', grund }) as const;

/** Line and column (1-based) of the first occurrence of `wort` in the line that contains `zeile`. */
function ort(text: string, zeile: string, wort: string): string {
  const zeilen = text.split('\n');
  const i = zeilen.findIndex((l) => l.includes(zeile));
  if (i < 0) throw new Error(`no line with "${zeile}"`);
  return `${i + 1}:${zeilen[i]!.indexOf(wort) + 1}`;
}

function wirftManifestFehler(f: () => unknown): string {
  try {
    f();
    return 'no error';
  } catch (e) {
    return e instanceof ManifestFehler ? '' : `other error: ${(e as Error).message}`;
  }
}

// ── The class of the earlier test (imports without extension, no node:fs) ─────────────────────

const KLASSE = `import { Peer } from './net/Peer';
import type { Welt } from './world/Welt';
import { StarterSet } from './konto/StarterSet';

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
const QUELLE = 'src/Server.ts';
const ZIEL = 'src/spiel/Ziel.ts';
const KONTEXT = { datei: 'src/spiel/Kontext.ts', typ: 'ServerKontext' };
const NAMEN = ['handleA', 'speichern', 'weltAnlegen', 'weltSpawn', 'sendeEffekt', 'starter'];
const AUFTRAG_B: Auftrag = { quelle: QUELLE, klasse: 'Server', kontextDatei: KONTEXT, ziele: [{ datei: ZIEL, methoden: NAMEN, kontext: { typ: 'Ktx' } }] };
const AUFTRAG_BP: Auftrag = { quelle: QUELLE, klasse: 'Server', kontextDatei: KONTEXT, ziele: [{ datei: ZIEL, methoden: [...NAMEN, 'handleParry'], woertlich: ['PARADE_AUSDAUER'], kontext: { typ: 'Ktx' } }] };
const AUFTRAG_BOHNE: Auftrag = { quelle: QUELLE, klasse: 'Server', kontextDatei: KONTEXT, ziele: [{ datei: ZIEL, methoden: [...NAMEN, 'handleParry'], kontext: { typ: 'Ktx' } }] };
const B = (text = KLASSE): Eingabe => schnitt(text, AUFTRAG_B, { dateien: UMFELD });
const BP = (): Eingabe => schnitt(KLASSE, AUFTRAG_BP, { dateien: UMFELD });
const ziel = (f: (t: string) => string): { ziel: Record<string, (t: string) => string> } => ({ ziel: { [ZIEL]: f } });
const IMPORT_ZIEL = "import { handleA, speichern, weltAnlegen, weltSpawn, sendeEffekt, starter } from './spiel/Ziel';";

lauf.abschnitt('base lines and forgeries in the moved body (A)');
lauf.fall({ id: 'G0', name: 'mechanically right cut of 6 methods', soll: [], herkunft: GRUEN, eingabe: () => B() });
lauf.fall({ id: 'G1', name: 'with the constant PARADE_AUSDAUER moved verbatim (free name)', soll: [], herkunft: GRUEN, eingabe: BP });
lauf.fall({ id: 'A1', name: 'number in the body raised by 1', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(B(), ziel(ersetze('a + umkreis', 'a + umkreis + 1'))) });
lauf.fall({ id: 'A2', name: 'condition negated', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(B(), ziel(ersetze('if (k.zaehler > r)', 'if (!(k.zaehler > r))'))) });
lauf.fall({ id: 'A3', name: 'await removed', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(B(), ziel(ersetze('await k.schreiben()', 'k.schreiben()'))) });
lauf.fall({ id: 'A4', name: 'async removed at the target', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(B(), ziel(ersetze('async function speichern', 'function speichern'))) });
lauf.fall({ id: 'A5', name: 'default value of a parameter removed in the target', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(B(), ziel(ersetze('function sendeEffekt(k: Ktx, a: number, umkreis = 40)', 'function sendeEffekt(k: Ktx, a: number, umkreis: number)'))) });
lauf.fall({ id: 'A6', name: 'default value of a parameter removed in the forwarder', soll: ['B5'], herkunft: ROT, eingabe: () => mitWeiterleitung(B(), 'sendeEffekt', ersetze('umkreis = 40', 'umkreis: number')) });
lauf.fall({ id: 'A7', name: 'free name: target declares PARADE_AUSDAUER = 41 (text of the verbatim constant changed)', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(BP(), ziel(ersetze('PARADE_AUSDAUER = 4', 'PARADE_AUSDAUER = 41'))) });
lauf.fall({ id: 'A7a', name: 'free name: the same constant as a second, unnamed declaration in the target', soll: ['B1'], herkunft: ROT, eingabe: () => mit(B(), ziel((t) => `${t}\nconst PARADE_AUSDAUER = 41;\n`)) });
lauf.fall({ id: 'A7c', name: 'free name: constant of the source, neither moved verbatim nor in the target', soll: ['B7'], herkunft: ROT, eingabe: () => schnitt(KLASSE, AUFTRAG_BOHNE, { dateien: UMFELD }) });
lauf.fall({
  id: 'A7d',
  name: 'the same binding, released: a binding that changes is not releasable here',
  soll: ['B7', 'B11'],
  herkunft: gruenHierRot('the earlier tool had `bindung:<name>`; here `bindung:<line>:<col>` releases only an identifier that is unresolvable in BOTH states, a changed binding is never releasable'),
  eingabe: () => mit(schnitt(KLASSE, AUFTRAG_BOHNE, { dateien: UMFELD }), { freigaben: [{ schluessel: `bindung:${ort(KLASSE, 'return PARADE_AUSDAUER + this.zaehler', 'PARADE_AUSDAUER')}`, begruendung: GRUND }] }),
});
lauf.fall({ id: 'A7b', name: 'free name: target imports PARADE_AUSDAUER from another file (the local constant wins, so the import is elided and B10 sees no new module)', soll: ['B5', 'B7'], herkunft: ROT, eingabe: () => mit(BP(), ziel((t) => `import { PARADE_AUSDAUER } from '../GanzAndereWerte';\n${t}`)) });
lauf.fall({ id: 'A7e', name: 'free name: imported name in the target from another file than in the old state (StarterSet)', soll: ['B5', 'B7', 'B10'], herkunft: ROT, eingabe: () => mit(B(), ziel(ersetze("'../konto/StarterSet'", "'../boese/StarterSet'"))) });
lauf.fall({ id: 'A7f', name: 'free name: imported name in the target not imported at all (its module is not loaded any more)', soll: ['B7', 'B10'], herkunft: ROT, eingabe: () => mit(B(), ziel(ersetze("import { StarterSet } from '../konto/StarterSet';\n", ''))) });

// H5: a local `k` in the method (the three real forms and a synthetic one)
function kFall(id: string, name: string, alt: string, methode: string): void {
  const auftrag = (parameter: string): Auftrag => ({ quelle: 'src/A.ts', klasse: 'A', ziele: [{ datei: ZIEL_KLEIN, methoden: [methode], kontext: { parameter, typ: 'Ktx' } }] });
  lauf.fall({ id, name: `${name} (this → k would mean the local variable)`, soll: ['B7', 'B12'], teile: ['B12/kontextname'], herkunft: ROT, eingabe: () => schnitt(alt, auftrag('k')) });
  lauf.fall({ id: `${id}g`, name: `${name}: with the context name ktx green`, soll: [], herkunft: GRUEN, eingabe: () => schnitt(alt, auftrag('ktx')) });
}
kFall('H5a', 'koppleClipTempo: const k = dyn.clipTempo!', 'export class A {\n  koppleClipTempo(dyn: { clipTempo?: number }): void {\n    const k = dyn.clipTempo!;\n    this.assets.setzeAnimationsTempo(k);\n  }\n  assets = { setzeAnimationsTempo(x: number): void { void x; } };\n}\n', 'koppleClipTempo');
kFall('H5b', 'kameraRahmen: const k = this.kamera', 'export class A {\n  kamera = 1;\n  kameraRahmen(): number {\n    const k = this.kamera;\n    return k + 1;\n  }\n}\n', 'kameraRahmen');
kFall('H5c', 'listeFuellen: (k, i) => { this.markenZeile… }', 'export class A {\n  markenZeile: number[] = [];\n  listeFuellen(): void {\n    [1, 2].forEach((k, i) => {\n      this.markenZeile.push(k + i);\n    });\n  }\n}\n', 'listeFuellen');
kFall('H5d', 'synthetic: [this.config].forEach((k) => { void this.config; })', 'export class A {\n  config = 1;\n  m(): void {\n    [this.config].forEach((k) => {\n      void this.config;\n      void k;\n    });\n  }\n}\n', 'm');

// nested `this`, default values, context type, target file
const klein = (rumpf: string, parameter = 'a: number'): Eingabe => schnitt(kleineKlasse(rumpf, parameter), AUFTRAG_KLEIN);
const zielKlein = (f: (t: string) => string): { ziel: Record<string, (t: string) => string> } => ({ ziel: { [ZIEL_KLEIN]: f } });
const INNER_THIS = 'the mover keeps the `this` of an inner function, object literal method or class expression, because it binds differently there; the earlier mover replaced it blindly, which stands here as its own forgery';
lauf.fall({ id: 'A10', name: 'this. in an inner function (binds differently): kept, right cut', soll: [], herkunft: rotHierGruen(INNER_THIS), eingabe: () => klein('void this.config; [1].map(function (x: number) { return this.config + x; }); void a;') });
lauf.fall({ id: 'A10b', name: 'this. in an inner function replaced blindly in the target', soll: ['B3', 'B4'], eingabe: () => mit(klein('void this.config; [1].map(function (x: number) { return this.config + x; }); void a;'), zielKlein(ersetze('return this.config + x', 'return k.config + x'))) });
lauf.fall({ id: 'A11', name: 'this. in getter/method of an object literal: kept, right cut', soll: [], herkunft: rotHierGruen(INNER_THIS), eingabe: () => klein('void this.config; const o = { get a() { return this.config; }, b() { return this.config; } }; void o; void a;') });
lauf.fall({ id: 'A11b', name: 'this. in getter/method of an object literal replaced blindly in the target', soll: ['B3', 'B4'], eingabe: () => mit(klein('void this.config; const o = { get a() { return this.config; }, b() { return this.config; } }; void o; void a;'), zielKlein(ersetze('get a() { return this.config; }', 'get a() { return k.config; }'))) });
lauf.fall({ id: 'A12', name: 'this. in field/static block of an inner class: kept, right cut', soll: [], herkunft: rotHierGruen(INNER_THIS), eingabe: () => klein('void this.config; const C = class { x = this.config; static { void this.name; } }; void C; void a;') });
lauf.fall({ id: 'A12b', name: 'this. in field of an inner class replaced blindly in the target', soll: ['B3', 'B4'], eingabe: () => mit(klein('void this.config; const C = class { x = this.config; static { void this.name; } }; void C; void a;'), zielKlein(ersetze('x = this.config', 'x = k.config'))) });
const bP = (): Eingabe => klein('[1].map((x) => this.config + x); void a;');
lauf.fall({ id: 'A13', name: 'this. in an arrow function (same this, moved right)', soll: [], herkunft: GRUEN, eingabe: bP });
lauf.fall({ id: 'A14', name: 'arrow function made a function in the target', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(bP(), zielKlein(ersetze('(x) => k.config + x', 'function (x: number) { return k.config + x; }'))) });
lauf.fall({ id: 'A15', name: 'arguments in the body', soll: ['B12'], teile: ['B12/arguments'], herkunft: ROT, eingabe: () => klein('void this.config; if (arguments.length > 1) return; void arguments[0]; void a;') });
const bV = (): Eingabe => klein('void extra; void this.config; void a;', 'extra = this.config, a: number');
lauf.fall({ id: 'A16', name: 'default value with this. made k. correctly: B12 since V2-A1 (the forwarder reads `this`, and if it yields undefined the function evaluates its own default a second time)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], herkunft: { alt: 'gruen', grund: 'V2-A1: a default value that reads `this` is not supported by form k (rule 5)' }, eingabe: bV });
lauf.fall({ id: 'A16b', name: 'default value with this. left in the target', soll: ['B3', 'B4', 'B12'], herkunft: { alt: 'rot', grund: 'the value that reads `this` is a finding of its own since V2-A1' }, eingabe: () => mit(bV(), zielKlein(ersetze('extra = k.config', 'extra = this.config'))) });
const bA = (): Eingabe => klein('void this.config; void a;');
lauf.fall({ id: 'A17', name: 'target: context as "k: any"', soll: ['B3', 'B5'], teile: ['B5/kontexttyp-any'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein(ersetze('(k: Ktx,', '(k: any,'))) });
lauf.fall({ id: 'A17b', name: 'target: context as "k: unknown"', soll: ['B3', 'B5'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein(ersetze('(k: Ktx,', '(k: unknown,'))) });
lauf.fall({ id: 'A17c', name: 'target: context as SpielKontext<any> (unknown type)', soll: ['B3', 'B5'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein(ersetze('(k: Ktx,', '(k: SpielKontext<any>,'))) });
lauf.fall({ id: 'A17d', name: 'target: context through a second alias on any', soll: ['B5', 'B7'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein((t) => `type Ktx = any;\n${t}`)) });
lauf.fall({ id: 'A17e', name: 'target: context without type', soll: ['B3', 'B5'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein(ersetze('(k: Ktx,', '(k,'))) });
lauf.fall({ id: 'A17f', name: 'target: context with a real type alias is green', soll: [], herkunft: GRUEN, eingabe: bA });
lauf.fall({ id: 'A18', name: 'target: statement on module level with an effect', soll: ['B1'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein((t) => `setInterval(() => process.exit(1), 1000);\n${t}`)) });
lauf.fall({ id: 'A18b', name: 'target: import for its effect', soll: ['B5', 'B10'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein((t) => `import '../boese';\n${t}`)) });
lauf.fall({ id: 'A18c', name: 'target: an additional class on module level', soll: ['B1'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein((t) => `${t}\nclass X { static a = process.exit(1); }\n`)) });
lauf.fall({
  id: 'A19',
  name: 'target: the function twice on module level (the call of the forwarder reaches two declarations)',
  soll: ['B1', 'B5'],
  herkunft: ROT,
  eingabe: () =>
    mit(bA(), zielKlein((t) => {
      const f = /\nfunction m\([\s\S]*?\n\}\n/.exec(t);
      if (!f) throw new Error('function m not found in the target');
      return `${t}${f[0]}`;
    })),
});
lauf.fall({ id: 'A19b', name: 'target: a second, unnamed function', soll: ['B1'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein((t) => `${t}\nexport function heimlich(): void {}\n`)) });
lauf.fall({ id: 'A20', name: 'target: function not exported (export list empty)', soll: ['B5'], herkunft: ROT, eingabe: () => mit(bA(), zielKlein(ersetze('export { m };', 'export {};'))) });
const bC = (): Eingabe => klein('// @ts-expect-error absichtlich\n    // eslint-disable-next-line no-console\n    void this.config; void a;');
lauf.fall({ id: 'A21', name: 'directive comments kept in the target: green', soll: [], herkunft: GRUEN, eingabe: bC });
lauf.fall({ id: 'A21b', name: '// @ts-expect-error lost in the target', soll: ['B6'], herkunft: ROT, eingabe: () => mit(bC(), zielKlein(ersetze('// @ts-expect-error absichtlich\n', ''))) });
lauf.fall({ id: 'A21c', name: '// eslint-disable-next-line lost in the target', soll: ['B6'], herkunft: ROT, eingabe: () => mit(bC(), zielKlein((t) => muss(t, t.replace(/ *\/\/ eslint-disable-next-line[^\n]*\n/, '')))) });

lauf.abschnitt('W: the forwarder');
const w = (name: string, f: (t: string) => string): (() => Eingabe) => () => mitWeiterleitung(B(), name, f);
lauf.fall({ id: 'W1', name: 'arguments swapped', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('(this, p, r)', '(this, r, p)')) });
lauf.fall({ id: 'W2', name: 'return missing, return type Welt', soll: ['B5'], herkunft: ROT, eingabe: w('weltAnlegen', ersetze('return weltAnlegen(', 'weltAnlegen(')) });
lauf.fall({ id: 'W3', name: 'return missing, void', soll: ['B5'], herkunft: ROT, eingabe: w('sendeEffekt', ersetze('return sendeEffekt(', 'sendeEffekt(')) });
lauf.fall({ id: 'W4', name: 'return missing at async Promise<void>', soll: ['B5'], herkunft: ROT, eingabe: w('speichern', ersetze('return speichern(', 'speichern(')) });
lauf.fall({ id: 'W5', name: 'forwarder without async: that is the right form here', soll: [], herkunft: rotHierGruen('by the rules of form k the forwarder has no `async` (it returns the promise of the function); the earlier tool demanded the modifiers of the method. A forwarder WITH async is the forgery here (W5b).'), eingabe: () => B() });
lauf.fall({ id: 'W5b', name: 'async added to the forwarder', soll: ['B5'], teile: ['B5/weiterleitung-async'], eingabe: w('speichern', ersetze('speichern(): Promise<void> {', 'async speichern(): Promise<void> {')) });
lauf.fall({ id: 'W6', name: 'effect in the context expression: (this.zaehler = 0, this)', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('(this, p, r)', '((this.zaehler = 0, this), p, r)')) });
lauf.fall({ id: 'W7', name: 'context is a copy: {...this}', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('(this, p, r)', '({ ...this }, p, r)')) });
lauf.fall({ id: 'W8', name: 'context is another object: this.config', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('(this, p, r)', '(this.config, p, r)')) });
lauf.fall({ id: 'W9', name: 'call to another module of the same function name', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('return handleA(this', 'return falschesModul.handleA(this')) });
lauf.fall({
  id: 'W9b',
  name: 'call to another, imported module of the same function name',
  soll: ['B5', 'B10'],
  herkunft: ROT,
  eingabe: () => mit(B(), { rest: (t) => muss(t, t.replace("from './spiel/Ziel';", "from './spiel/Ziel';\nimport * as anders from './spiel/Anders';").replace('return handleA(this, p, r)', 'return anders.handleA(this, p, r)')) }),
});
lauf.fall({ id: 'W10', name: 'self call: weltSpawn() { return this.weltSpawn(); }', soll: ['B5'], herkunft: ROT, eingabe: w('weltSpawn', ersetze('return weltSpawn(this)', 'return this.weltSpawn()')) });
lauf.fall({ id: 'W10b', name: 'call without import: weltSpawn removed from the import of the target', soll: ['B5'], herkunft: ROT, eingabe: () => mit(B(), { rest: ersetze(IMPORT_ZIEL, "import { handleA, speichern, weltAnlegen, sendeEffekt, starter } from './spiel/Ziel';") }) });
lauf.fall({ id: 'W11', name: 'second statement in the forwarder', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('return handleA(this, p, r);', 'this.zaehler = 0;\n    return handleA(this, p, r);')) });
lauf.fall({ id: 'W12', name: 'effect as default value of an additional parameter', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('r: number): void {', 'r: number, _x = (this.zaehler = 0)): void {')) });
lauf.fall({ id: 'W13', name: 'forwarder made static', soll: ['B5'], herkunft: ROT, eingabe: w('weltSpawn', ersetze('weltSpawn(): number {', 'static weltSpawn(): number {')) });
lauf.fall({ id: 'W14', name: 'call wrapped in a condition (cond && f())', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('return handleA(this, p, r)', 'return this.zaehler > 0 && handleA(this, p, r)')) });
lauf.fall({ id: 'W15', name: 'call with ?.', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('handleA(this, p, r)', 'handleA?.(this, p, r)')) });
lauf.fall({ id: 'W15b', name: 'callee is an expression: (0, handleA)(…)', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('return handleA(this, p, r)', 'return (0, handleA)(this, p, r)')) });
lauf.fall({ id: 'W16', name: 'result changed (|| undefined)', soll: ['B5'], herkunft: ROT, eingabe: w('weltAnlegen', ersetze('return weltAnlegen(this, id);', 'return weltAnlegen(this, id) || undefined;')) });
lauf.fall({ id: 'W17', name: 'method twice in the rest (forwarder twice)', soll: ['B1', 'B7'], herkunft: ROT, eingabe: w('handleA', (t) => `${t}\n  ${t}`) });
lauf.fall({ id: 'W18', name: 'forwarder as a class field with an arrow function', soll: ['B5'], herkunft: ROT, eingabe: w('weltSpawn', () => 'weltSpawn = (): number => weltSpawn(this);') });
lauf.fall({ id: 'W19', name: 'forwarder with await instead of return', soll: ['B5'], herkunft: ROT, eingabe: w('speichern', ersetze('return speichern(this);', 'await speichern(this);')) });
lauf.fall({ id: 'W20', name: 'visibility of the forwarder changed (private → public)', soll: ['B5'], herkunft: ROT, eingabe: w('handleA', ersetze('private handleA(', 'handleA(')) });
lauf.fall({ id: 'W21', name: 'return type of the forwarder changed', soll: ['B5'], herkunft: ROT, eingabe: w('weltSpawn', ersetze('weltSpawn(): number {', 'weltSpawn(): number | undefined {')) });
lauf.fall({ id: 'W22', name: 'forwarder with a multi-line signature is green', soll: [], herkunft: GRUEN, eingabe: w('sendeEffekt', ersetze('sendeEffekt(a: number, umkreis = 40): void {', 'sendeEffekt(\n    a: number,\n    umkreis = 40,\n  ): void {')) });
lauf.fall({ id: 'W23', name: 'body of the forwarder with comments (over 3 lines)', soll: ['B6'], herkunft: ROT, eingabe: w('handleA', ersetze('{\n    return handleA(this, p, r);\n  }', '{\n    // a\n    // b\n\n    return handleA(this, p, r);\n  }')) });

lauf.abschnitt('R: the rest of the source file');
const r = (f: (t: string) => string): (() => Eingabe) => () => mit(B(), { rest: f });
lauf.fall({ id: 'R1', name: 'unnamed method changed (number +1)', soll: ['B2'], herkunft: ROT, eingabe: r(ersetze('return 5 + this.zaehler', 'return 6 + this.zaehler')) });
lauf.fall({ id: 'R2', name: 'constructor: statement inserted at the start', soll: ['B2'], herkunft: ROT, eingabe: r(ersetze('constructor() {\n    this.zaehler = 1;', 'constructor() {\n    process.exitCode = 3;\n    this.zaehler = 1;')) });
lauf.fall({ id: 'R3', name: 'constructor: the last two statements swapped', soll: ['B2'], herkunft: ROT, eingabe: r(ersetze('    this.letzteTimeoutPruefung = 2;\n    instance = this;', '    instance = this;\n    this.letzteTimeoutPruefung = 2;')) });
lauf.fall({ id: 'R4', name: 'field letzteTimeoutPruefung: initial value changed', soll: ['B2'], herkunft: ROT, eingabe: r(ersetze('letzteTimeoutPruefung = 0', 'letzteTimeoutPruefung = 1')) });
lauf.fall({ id: 'R5', name: 'accessor geo changed', soll: ['B2'], herkunft: ROT, eingabe: r(ersetze('get geo(): number {\n    return this.zaehler;', 'get geo(): number {\n    return this.zaehler + 1;')) });
lauf.fall({ id: 'R6', name: 'module constant PARADE_FENSTER_MS changed in the rest', soll: ['B2'], herkunft: ROT, eingabe: r(ersetze('PARADE_FENSTER_MS = 250', 'PARADE_FENSTER_MS = 251')) });
lauf.fall({
  id: 'R7',
  name: "import redirected: './net/Peer' → './boese/Peer'",
  soll: ['B5', 'B7'],
  herkunft: ROT,
  eingabe: () => mit(schnitt(KLASSE, AUFTRAG_B, { dateien: { ...UMFELD, 'src/boese/Peer.ts': "export class Peer {\n  name = 'y';\n  istAdmin = true;\n}\n" } }), { rest: ersetze("import { Peer } from './net/Peer';", "import { Peer } from './boese/Peer';") }),
});
lauf.fall({ id: 'R8', name: 'statement on module level appended to the rest', soll: ['B1'], herkunft: ROT, eingabe: r((t) => `${t}\nprocess.on('exit', () => {});\n`) });
lauf.fall({ id: 'R9', name: 'unnamed method log loses private: it is named by the context type, so that is the right cut', soll: [], herkunft: rotHierGruen('the moved methods call `this.log`, so the context type names `log` and the member must lose `private` (form k rules); the earlier tool demanded byte equality of every unnamed member. A member that loses `private` without being in a context type is red (R9c).'), eingabe: () => B() });
lauf.fall({ id: 'R9c', name: 'a member not named by any context type loses private', soll: ['B5'], teile: ['B5/gelockert-ohne-kontext'], eingabe: r(ersetze('  private letzteTimeoutPruefung = 0;', '  letzteTimeoutPruefung = 0;')) });
lauf.fall({ id: 'R9b', name: 'unnamed method: static put in front', soll: ['B2'], herkunft: ROT, eingabe: r(ersetze('  zweite(): void {', '  static zweite(): void {')) });
lauf.fall({ id: 'R10', name: 'unnamed method a second time further down with another body', soll: ['B1', 'B7'], herkunft: ROT, eingabe: r(ersetze("  zweite(): void {\n    this.log('z');\n  }", "  zweite(): void {\n    this.log('z');\n  }\n  zweite(): void { process.exitCode = 3; }")) });
lauf.fall({ id: 'R11', name: 'import removed although the rest still uses the name', soll: ['B5', 'B7'], herkunft: ROT, eingabe: r(ersetze("import { Peer } from './net/Peer';\n", '')) });
lauf.fall({ id: 'R12', name: 'new import in the rest from a file that is no target (the name is unused, so the import is elided and B10 sees no new module)', soll: ['B5'], herkunft: ROT, eingabe: r((t) => `import { x } from './neu';\n${t}`) });
lauf.fall({ id: 'R13', name: 'new import for its effect in the rest', soll: ['B5', 'B10'], herkunft: ROT, eingabe: r((t) => `import './boese';\n${t}`) });
lauf.pruefe('R14v', 'the mover removes the import whose name the rest does not use any more (StarterSet)', !B().neu[QUELLE]!.includes('StarterSet') && B().neu[ZIEL]!.includes("import { StarterSet } from '../konto/StarterSet';"), B().neu[QUELLE]!.slice(0, 300));
lauf.fall({ id: 'R14', name: 'import whose name does not occur in the rest any more removed: green', soll: [], herkunft: GRUEN, eingabe: () => B() });
lauf.fall({
  id: 'R15',
  name: 'directive comment lost in the rest (the rest is byte-identical, so B2 catches it)',
  soll: ['B2'],
  herkunft: ROT,
  eingabe: () => mit(B(KLASSE.replace('  zweite(): void {', '  // @ts-ignore alt\n  zweite(): void {')), { rest: ersetze('  // @ts-ignore alt\n', '') }),
});

lauf.abschnitt('S: scopes (a locally declared name is local only inside its scope)');
const altS = (rumpf: string, param = ''): string => `const LIMIT = 4;\nexport class A {\n  zaehler = 0;\n  m(${param}): number {\n    ${rumpf}\n  }\n}\n`;
const AUFTRAG_S: Auftrag = { quelle: 'src/A.ts', klasse: 'A', ziele: [{ datei: ZIEL_KLEIN, methoden: ['m'], kontext: { typ: 'Ktx' } }] };
const mitWoertlich = (a: Auftrag, woertlich: string[]): Auftrag => ({ ...a, ziele: [{ ...a.ziele[0]!, woertlich }] });
lauf.fall({ id: 'S1', name: 'free name of the source (LIMIT) not moved: red', soll: ['B7'], herkunft: ROT, eingabe: () => schnitt(altS('return LIMIT + this.zaehler;'), AUFTRAG_S) });
lauf.fall({ id: 'S2', name: 'the same constant moved verbatim: green', soll: [], herkunft: GRUEN, eingabe: () => schnitt(altS('return LIMIT + this.zaehler;'), mitWoertlich(AUFTRAG_S, ['LIMIT'])) });
lauf.fall({ id: 'S3', name: 'a parameter of the same name hides the constant everywhere: green', soll: [], herkunft: GRUEN, eingabe: () => schnitt(altS('return LIMIT + this.zaehler;', 'LIMIT: number'), AUFTRAG_S) });
lauf.fall({ id: 'S4', name: 'local const in a block, but a reference outside binds to the module constant: red', soll: ['B7'], herkunft: ROT, eingabe: () => schnitt(altS('{ const LIMIT = 9; void LIMIT; } return LIMIT + this.zaehler;'), AUFTRAG_S) });
lauf.fall({ id: 'S5', name: 'local const in the whole body: green', soll: [], herkunft: GRUEN, eingabe: () => schnitt(altS('const LIMIT = 9; return LIMIT + this.zaehler;'), AUFTRAG_S) });
lauf.fall({ id: 'S6', name: 'catch variable hides the constant only in the catch: green', soll: [], herkunft: GRUEN, eingabe: () => schnitt(altS('try { return this.zaehler; } catch (LIMIT) { return LIMIT as number; }'), AUFTRAG_S) });
lauf.fall({ id: 'S7', name: 'for-of variable hides only the loop, after it LIMIT binds to the module constant: red', soll: ['B7'], herkunft: ROT, eingabe: () => schnitt(altS('for (const LIMIT of [1]) { void LIMIT; } return LIMIT + this.zaehler;'), AUFTRAG_S) });
const EINTRAG = 'export interface Eintrag {\n  a: number;\n}\nexport class A {\n  m(e: Eintrag): number {\n    return e.a + this.n;\n  }\n  n = 1;\n}\n';
lauf.fall({ id: 'S8', name: 'type of the source in the signature, not moved: red', soll: ['B7'], herkunft: ROT, eingabe: () => schnitt(EINTRAG, AUFTRAG_S) });
lauf.fall({ id: 'S9', name: 'type moved verbatim (interface): green', soll: [], herkunft: GRUEN, eingabe: () => schnitt(EINTRAG, mitWoertlich(AUFTRAG_S, ['Eintrag'])) });
const STATISCH = 'export class Server {\n  static readonly SICHT = 4;\n  zaehler = 0;\n  m(): number {\n    return Server.SICHT + this.zaehler;\n  }\n}\n';
const AUFTRAG_STATISCH: Auftrag = { quelle: QUELLE, klasse: 'Server', ziele: [{ datei: ZIEL, methoden: ['m'], kontext: { typ: 'Ktx' } }] };
lauf.fall({ id: 'S10', name: 'static member Server.SICHT in the body: the class as a value is not supported', soll: ['B12'], teile: ['B12/klassenbezug'], herkunft: ROT, eingabe: () => schnitt(STATISCH, AUFTRAG_STATISCH) });
lauf.fall({
  id: 'S11',
  name: 'the same, released: not releasable here',
  soll: ['B11', 'B12'],
  herkunft: gruenHierRot('a reference to the class as a value is unsupported by form k (B12) and has no release; the earlier tool released the binding of the name `Server`'),
  eingabe: () => mit(schnitt(STATISCH, AUFTRAG_STATISCH), { freigaben: [{ schluessel: `bindung:${ort(STATISCH, 'return Server.SICHT', 'Server')}`, begruendung: GRUND }] }),
});

lauf.abschnitt('F: form a (free functions with an environment) is stage 2');
const FS = { 'src/fs.ts': 'export function readFileSync(p: string, enc: string): string {\n  return p + enc;\n}\nexport function writeFileSync(p: string, t: string): void {\n  void p;\n  void t;\n}\n' };
const ADM = `import { readFileSync, writeFileSync } from './fs';

const ADMINS_DATEI = 'admins.json';
const KONTEN_DB = 'konten.db';
function sichern(datei: string): void {
  void datei;
}
function spielerIdGueltig(w: unknown): w is string {
  return typeof w === 'string';
}
export function adminsLesen(): string[] {
  const roh = readFileSync(ADMINS_DATEI, 'utf-8');
  return roh.split('\\n').filter(spielerIdGueltig);
}
export function adminsSchreiben(liste: string[]): void {
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
const QUELLE_F = 'src/main.ts';
/** Form 0 of the same move: the functions and their environment move verbatim. */
const AUFTRAG_F0 = (woertlich: string[] = [...FT, ...FN]): Auftrag => ({ quelle: QUELLE_F, ziele: [{ datei: ZIEL, woertlich }] });
const f0 = (alt = ADM, woertlich?: string[]): Eingabe => schnitt(alt, AUFTRAG_F0(woertlich), { dateien: { ...UMFELD, ...FS } });

/**
 * A form a cut as the earlier test built it: the functions get `k: Ktx` in front, every free name
 * of the table becomes `k.<name>` (blindly), the rest keeps forwarders that call through a
 * factory. Stage 1 has no manifest for that: the nearest one names the functions as verbatim.
 */
function formA(alt: string, namen: string[], tabelle: string[], fabrik: string): Eingabe {
  const sf = ts.createSourceFile('x.ts', alt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fns: string[] = [];
  const ersatz: { von: number; bis: number; neu: string }[] = [];
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name || !namen.includes(s.name.text) || !s.body) continue;
    const stellen: { von: number; bis: number; neu: string }[] = [];
    const geh = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && tabelle.includes(n.text)) {
        const p = n.parent;
        const istName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isEnumDeclaration(p) || ts.isFunctionExpression(p)) && p.name === n);
        if (!istName) stellen.push({ von: n.getStart(sf), bis: n.end, neu: `k.${n.text}` });
      }
      ts.forEachChild(n, geh);
    };
    geh(s.body);
    const basis = s.body.getStart(sf);
    let rumpf = s.body.getText(sf);
    for (const st of [...stellen].sort((a, b) => b.von - a.von)) rumpf = rumpf.slice(0, st.von - basis) + st.neu + rumpf.slice(st.bis - basis);
    const params = s.parameters.map((p) => p.getText(sf));
    const args = s.parameters.map((p) => p.name.getText(sf));
    const ret = s.type ? `: ${s.type.getText(sf)}` : '';
    fns.push(`export function ${s.name.text}(${['k: Ktx', ...params].join(', ')})${ret} ${rumpf}`);
    ersatz.push({ von: s.getStart(sf), bis: s.end, neu: `function ${s.name.text}(${params.join(', ')})${ret} {\n  return ziel.${s.name.text}(${[`${fabrik}()`, ...args].join(', ')});\n}` });
  }
  let rest = alt;
  for (const e of [...ersatz].sort((a, b) => b.von - a.von)) rest = rest.slice(0, e.von) + e.neu + rest.slice(e.bis);
  const imps = sf.statements.filter(ts.isImportDeclaration);
  const letzter = imps[imps.length - 1]!;
  rest = `${rest.slice(0, letzter.end)}\nimport * as ziel from './spiel/Ziel';${rest.slice(letzter.end)}\nfunction ${fabrik}() {\n  return { ${tabelle.join(', ')} };\n}\n`;
  const zielText = `import { readFileSync, writeFileSync } from '../fs';\n\ntype Ktx = { ADMINS_DATEI: string; sichern: (datei: string) => void; spielerIdGueltig: (w: unknown) => w is string };\n\n${fns.join('\n')}\n`;
  const e = f0(alt, namen);
  return { ...e, neu: { ...e.neu, [QUELLE_F]: rest, [ZIEL]: zielText } };
}
const FORM_A = 'form a is stage 2: stage 1 has no manifest for it, the nearest one (the functions as verbatim) is refused, which is the safe side';
const FORM_A_ROT: RegelId[] = ['B1', 'B3', 'B4', 'B5'];
const fA = (): Eingabe => formA(ADM, FN, FT, 'kontenUmgebung');
lauf.fall({ id: 'F0', name: 'base line form a: adminsLesen, adminsSchreiben through a factory: refused', soll: FORM_A_ROT, herkunft: gruenHierRot(FORM_A), eingabe: fA });
lauf.fall({ id: 'F0b', name: 'the same without the release of the environment: refused as well', soll: FORM_A_ROT, herkunft: ROT, eingabe: fA });
lauf.fall({ id: 'F0v', name: 'the same move as form 0: functions and environment verbatim, green', soll: [], eingabe: () => f0() });
const schatten: Record<string, string> = {
  'inner block const': '{ const ADMINS_DATEI = "x"; void ADMINS_DATEI; }',
  'arrow parameter': '[1].map((ADMINS_DATEI) => ADMINS_DATEI);',
  'catch variable': 'try { void 0; } catch (ADMINS_DATEI) { void ADMINS_DATEI; }',
  'for-of variable': 'for (const ADMINS_DATEI of [1]) void ADMINS_DATEI;',
  destructuring: 'const { ADMINS_DATEI } = { ADMINS_DATEI: 1 }; void ADMINS_DATEI;',
  'destructuring with rename': 'const { x: ADMINS_DATEI } = { x: 1 }; void ADMINS_DATEI;',
  'inner function of the same name': 'function ADMINS_DATEI() {} void ADMINS_DATEI;',
  'class expression with name': 'const C = class ADMINS_DATEI { m() { return ADMINS_DATEI; } }; void C;',
  'local enum': 'enum ADMINS_DATEI { A } void ADMINS_DATEI.A;',
  'local class': 'class ADMINS_DATEI {} void ADMINS_DATEI;',
  'parameter of an inner function': '(function (ADMINS_DATEI: number) { return ADMINS_DATEI; })(1);',
};
{
  let i = 1;
  for (const [was, code] of Object.entries(schatten)) {
    const altS2 = ADM.replace('function adminsLesen(): string[] {\n', `function adminsLesen(): string[] {\n  ${code}\n`);
    lauf.fall({ id: `F${i++}`, name: `shadow (${was}): moved verbatim, nothing is replaced`, soll: [], herkunft: rotHierGruen('form 0 replaces no name, so a local name cannot be replaced blindly; the form a cut (with the blind replacement) is refused, see F0'), eingabe: () => f0(altS2) });
  }
}
lauf.fall({ id: 'F20', name: 'table maps to ANOTHER field: ADMINS_DATEI = k.KONTEN_DB (form a, refused)', soll: FORM_A_ROT, herkunft: ROT, eingabe: () => mit(fA(), ziel((t) => muss(t, t.replaceAll('k.ADMINS_DATEI', 'k.KONTEN_DB')))) });
lauf.fall({ id: 'F20b', name: 'the same, released in the earlier tool: no such release here (form a, refused)', soll: FORM_A_ROT, herkunft: gruenHierRot(FORM_A), eingabe: () => mit(fA(), ziel((t) => muss(t, t.replaceAll('k.ADMINS_DATEI', 'k.KONTEN_DB')))) });
lauf.fall({ id: 'F21', name: "table maps to a fixed value: ADMINS_DATEI = '/etc/passwd' (form a, refused)", soll: FORM_A_ROT, herkunft: ROT, eingabe: () => mit(fA(), ziel((t) => muss(t, t.replaceAll('k.ADMINS_DATEI', "'/etc/passwd'")))) });
lauf.fall({ id: 'F22', name: 'sichern not moved; the target brings its own empty sichern()', soll: ['B1', 'B7'], herkunft: ROT, eingabe: () => mit(f0(ADM, ['ADMINS_DATEI', 'spielerIdGueltig', ...FN]), ziel((t) => `function sichern(..._a: unknown[]): void {}\n${t}`)) });
lauf.fall({ id: 'F22b', name: 'sichern not moved, nothing else in the target: free name unbound', soll: ['B7'], herkunft: ROT, eingabe: () => f0(ADM, ['ADMINS_DATEI', 'spielerIdGueltig', ...FN]) });
lauf.fall({ id: 'F23', name: 'forwarder builds the environment with other values (form a, refused)', soll: FORM_A_ROT, herkunft: ROT, eingabe: () => mit(fA(), { rest: ersetze('ziel.adminsLesen(kontenUmgebung()', 'ziel.adminsLesen({ ...kontenUmgebung(), ADMINS_DATEI: "/tmp/x" }') }) });
lauf.fall({ id: 'F24', name: 'forwarder passes another factory in the second function (form a, refused)', soll: FORM_A_ROT, herkunft: ROT, eingabe: () => mit(fA(), { rest: ersetze('ziel.adminsSchreiben(kontenUmgebung()', 'ziel.adminsSchreiben(andereUmgebung()') }) });
lauf.fall({ id: 'F25', name: 'rest: daneben() (unnamed function) changed', soll: ['B2'], herkunft: ROT, eingabe: () => mit(f0(), { rest: ersetze('return KONTEN_DB', 'return "x"') }) });
lauf.fall({ id: 'F26', name: 'table: entry without a hit (a name of the manifest that does not exist)', soll: ['B1'], teile: ['B1/name-fehlt'], herkunft: ROT, eingabe: () => f0(ADM, [...FT, ...FN, 'GIBTS_NICHT']) });
lauf.fall({ id: 'F27', name: 'object key and property ADMINS_DATEI are not replaced (green)', soll: [], herkunft: GRUEN, eingabe: () => f0() });
lauf.fall({ id: 'F28', name: 'shorthand { ADMINS_DATEI }: moved verbatim, nothing is replaced', soll: [], herkunft: rotHierGruen('form 0 replaces no name; the shorthand moves as it is'), eingabe: () => f0(ADM.replace('const meta = { ADMINS_DATEI: 1 };', 'const meta = { ADMINS_DATEI };')) });

lauf.abschnitt('N: form 0 (verbatim) and re-exports');
const WAFFE = `import { Inventory } from './items/Inventory';

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
const QUELLE_N = 'src/Wov.ts';
const WN = ['gepruefteWaffe', 'waffeTragbar', 'KREATUR_DROPS', 'TRUHEN', 'wuerfleTruhe'];
const AUFTRAG_N: Auftrag = { quelle: QUELLE_N, ziele: [{ datei: ZIEL, woertlich: WN }] };
const N = (): Eingabe => schnitt(WAFFE, AUFTRAG_N, { dateien: UMFELD });
const WEITER = "export { gepruefteWaffe, waffeTragbar, KREATUR_DROPS, wuerfleTruhe } from './spiel/Ziel';";
const rn = (f: (t: string) => string): (() => Eingabe) => () => mit(N(), { rest: f });
const zn = (f: (t: string) => string): (() => Eingabe) => () => mit(N(), ziel(f));
lauf.fall({ id: 'N0', name: 'base line form 0: 5 names (3 exported, 2 not)', soll: [], herkunft: GRUEN, eingabe: N });
lauf.fall({ id: 'N0b', name: 'base line with the manifest read from JSON (the way of the command line)', soll: [], herkunft: GRUEN, eingabe: () => mit(N(), { manifest: (m) => leseManifest(JSON.stringify(m)) }) });
lauf.fall({ id: 'N1', name: 're-export points to ANOTHER file', soll: ['B5', 'B10'], herkunft: ROT, eingabe: rn(ersetze(WEITER, "export { gepruefteWaffe, waffeTragbar, KREATUR_DROPS, wuerfleTruhe } from './spiel/GanzAnders';")) });
lauf.fall({ id: 'N2', name: 're-export with alias: export { waffeTragbar as gepruefteWaffe }', soll: ['B5'], herkunft: ROT, eingabe: rn(ersetze('export { gepruefteWaffe, waffeTragbar,', 'export { waffeTragbar as gepruefteWaffe, waffeTragbar,')) });
lauf.fall({ id: 'N3', name: 'import of the unexported names from another file (unused, so elided: no new module for B10)', soll: ['B5'], herkunft: ROT, eingabe: rn((t) => `import { TRUHEN } from './spiel/GanzAnders';\n${t}`) });
lauf.fall({ id: 'N4', name: 'class changed in the same step (method init, number +1)', soll: ['B2'], herkunft: ROT, eingabe: rn(ersetze('return this.zaehler + 1;', 'return this.zaehler + 2;')) });
lauf.fall({ id: 'N5', name: 'statement on module level appended to the rest', soll: ['B1'], herkunft: ROT, eingabe: rn((t) => `${t}\nprocess.exitCode = 3;\n`) });
lauf.fall({ id: 'N6', name: 'target has an additional statement with an effect', soll: ['B1'], herkunft: ROT, eingabe: zn((t) => `${t}\nKREATUR_DROPS['x' as never] = [] as never;\n`) });
lauf.fall({ id: 'N6b', name: 'target: additional constant with an effect in its initial value', soll: ['B1'], herkunft: ROT, eingabe: zn((t) => `${t}\nexport const HEIMLICH = process.exit(1);\n`) });
lauf.fall({ id: 'N7', name: 'target: const made let', soll: ['B3', 'B4'], herkunft: ROT, eingabe: zn(ersetze('export const KREATUR_DROPS', 'export let KREATUR_DROPS')) });
lauf.fall({ id: 'N8', name: 'target: value in the table changed', soll: ['B3', 'B4'], herkunft: ROT, eingabe: zn(ersetze('wolf: 2', 'wolf: 3')) });
lauf.fall({ id: 'N9', name: 're-export missing', soll: ['B5'], herkunft: ROT, eingabe: rn(ersetze(`${WEITER}\n`, '')) });
lauf.fall({ id: 'N10', name: 're-export widens the surface by an unexported name (TRUHEN)', soll: ['B5'], herkunft: ROT, eingabe: rn(ersetze('wuerfleTruhe } from', 'wuerfleTruhe, TRUHEN } from')) });
lauf.fall({ id: 'N11', name: 'declaration stays in the rest (twice)', soll: ['B1'], herkunft: ROT, eingabe: rn((t) => `${t}\nexport const KREATUR_DROPS: Record<string, number> = { wolf: 2, kuh: 1 };\n`) });
lauf.fall({ id: 'N12', name: 'target does not export the constant', soll: ['B3', 'B4'], herkunft: ROT, eingabe: zn(ersetze('export const KREATUR_DROPS', 'const KREATUR_DROPS')) });
lauf.fall({ id: 'N13', name: 'target lacks one name (the re-export of the rest points to nothing)', soll: ['B1', 'B5'], herkunft: ROT, eingabe: zn((t) => muss(t, t.replace(/export const KREATUR_DROPS[^\n]*\n/, ''))) });
lauf.fall({ id: 'N14', name: 'unnamed function of the rest (createWov) changed', soll: ['B2'], herkunft: ROT, eingabe: rn(ersetze('return new Wov();', 'return new Wov() as Wov;')) });
lauf.fall({ id: 'N15', name: 'import removed although the rest still uses the name', soll: ['B5', 'B7'], herkunft: ROT, eingabe: rn(ersetze("import { Inventory } from './items/Inventory';\n", '')) });
lauf.fall({ id: 'N16', name: 'target: import without a counterpart in the source (secret; unused, so elided)', soll: ['B5'], herkunft: ROT, eingabe: zn((t) => `import { x } from '../heimlich';\n${t}`) });
lauf.fall({ id: 'N17', name: 'the rest has no re-export for unexported names: green (see N0)', soll: [], herkunft: GRUEN, eingabe: N });
lauf.pruefe('N18', 'name list empty: manifest error', wirftManifestFehler(() => pruefeManifest({ ...N().manifest, ziele: [{ datei: ZIEL, woertlich: [], methoden: [] }] })) === '', 'a target without names was accepted');
lauf.pruefe('N19', 'name in both lists: manifest error', wirftManifestFehler(() => pruefeManifest({ ...N().manifest, klasse: 'Wov', ziele: [{ datei: ZIEL, woertlich: WN, methoden: ['gepruefteWaffe'], kontext: { parameter: 'k', typ: 'Ktx' } }] })) === '', 'a name in both lists was accepted');

lauf.abschnitt('L: a single method without this');
const OHNE_THIS = 'export class A {\n  m(): number {\n    return 1;\n  }\n  n(): number {\n    return 2;\n  }\n}\n';
lauf.fall({
  id: 'L1',
  name: 'a single method without this. moved as form k: the context type would be empty',
  soll: ['B5'],
  teile: ['B5/kontexttyp-leer'],
  herkunft: ROT,
  eingabe: () => schnitt(OHNE_THIS, AUFTRAG_S),
});
lauf.pruefe('L2', 'the release `kein-this` of the earlier tool does not exist: manifest error', wirftManifestFehler(() => pruefeManifest({ ...schnitt(OHNE_THIS, AUFTRAG_S).manifest, freigaben: [{ schluessel: 'kein-this', begruendung: GRUND } as Freigabe] })) === '', 'the release kein-this was accepted');

lauf.ende();
