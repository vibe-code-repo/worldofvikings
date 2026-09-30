/**
 * Self-test of the move proof (`tools/verschiebung/`), part 5: the gaps of the third attack (V2).
 *
 * The attack on the tool (Opus 5.5, report `2026-09-30 Refactoring V2 — Angriff`) found changes of
 * behaviour that the syntax tree does not show and that the tool let through with exit 0 (V2-A1 to
 * A13), and nine mutants of the tool that survived the earlier self-tests. Every fixture here is
 * the smallest form of such a case. Each was green on the tool before the fix (`9e08384c`) where it
 * expects red now, and every mutant that survived is killed by at least one fixture named below.
 * The real witnesses (G1, E1, N1, N2, G2) run as commands and are not part of this file.
 *
 * Run: npx tsx tools/test/verschiebung-nachbesserung.ts   (from the repository root)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alsText } from '../verschiebung/ausgabe';
import { pruefeManifest } from '../verschiebung/manifest';
import { Lauf, laufe, mit, muss, schnitt, type Eingabe } from '../verschiebung/pruefstand/probe';
import type { Auftrag } from '../verschiebung/pruefstand/verschieber';
import { AUFTRAG_FORM0, AUFTRAG_FORMK, BEUTE, KAMPF, SERVER, UMFELD } from '../verschiebung/pruefstand/vorlagen';

const lauf = new Lauf('verschiebung-nachbesserung');
const Z = 'src/teil/Ziel.ts';
const auftrag = (methoden: string[], klasse = 'A', quelle = 'src/A.ts'): Auftrag => ({ quelle, klasse, ziele: [{ datei: Z, methoden, kontext: { typ: 'Ktx' } }] });
const ersetze = (von: string, nach: string) => (t: string): string => muss(t, t.replace(von, nach), von);
const form0 = (): Eingabe => schnitt(SERVER, AUFTRAG_FORM0, { dateien: UMFELD });
const formk = (): Eingabe => schnitt(SERVER, AUFTRAG_FORMK, { dateien: UMFELD });
const GRUND = 'Reason written for the self-test: the effect is harmless here.';

/** Class with a getter that has an effect and a method under test whose parameter list is given. */
const mitVorgabe = (parameter: string, rumpf = 'return (x === undefined ? 0 : 1) + this.zaehler;'): string =>
  `export class A {\n  zaehler = 0;\n  zahl = 1;\n  o = { a: { b: 1 } };\n  get puffer(): number[] | undefined {\n    this.zaehler++;\n    return undefined;\n  }\n  m(${parameter}): number {\n    ${rumpf}\n  }\n}\n`;

lauf.abschnitt('V2-A1 / A2: default values of a form k method that read `this` or yield `undefined` (B12)');
lauf.fall({ id: 'A1a', name: 'RD1: `x = this.puffer` (a getter with an effect that yields undefined: the function would run its own default a second time)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('x = this.puffer'), auftrag(['m'])) });
lauf.fall({ id: 'A1b', name: '`x = this.o.a.b` (nested member access on `this`)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('x = this.o.a.b'), auftrag(['m'])) });
lauf.fall({ id: 'A1c', name: "`x = this['puffer']` (element access on `this`)", soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe("x = this['puffer']"), auftrag(['m'])) });
lauf.fall({ id: 'A1d', name: '`x = [this.zahl]` (`this` deep inside an array literal)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('x = [this.zahl]'), auftrag(['m'])) });
lauf.fall({ id: 'A1e', name: '`x = flag ? this.zahl : 1` (`this` in one branch)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('flag = true, x = flag ? this.zahl : 1'), auftrag(['m'])) });
lauf.fall({ id: 'A2a', name: 'RD2: `x = undefined`', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('x: number | undefined = undefined'), auftrag(['m'])) });
lauf.fall({ id: 'A2b', name: '`x = void 0`', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('x: number | undefined = void 0'), auftrag(['m'])) });
lauf.fall({ id: 'A2c', name: '`x = (undefined as number | undefined)` (parentheses and a cast do not hide it)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('x = (undefined as number | undefined)'), auftrag(['m'])) });
lauf.fall({ id: 'A2d', name: '`x = flag ? undefined : 1` (undefined in one branch)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('flag = true, x = flag ? undefined : 1'), auftrag(['m'])) });
lauf.fall({ id: 'A2f', name: '`x = flag ? 1 : undefined` (undefined in the other branch)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('flag = true, x = flag ? 1 : undefined'), auftrag(['m'])) });
lauf.fall({ id: 'A2e', name: '`x = 1 ?? undefined` and `x = 0 || void 0` (undefined on the right of a logical operator)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('x = 1 ?? undefined, y = 0 || void 0'), auftrag(['m'])) });
for (const [id, vorgabe] of [
  ['A2g1', 'x: number[] = []'],
  ['A2g2', 'x: object = {}'],
  ['A2g3', 'x = 5'],
  ['A2g4', "x = 's'"],
  ['A2g5', 'x = true'],
  ['A2g6', 'x: null | number = null'],
  ['A2g7', 'x = () => this.zahl'],
] as const) {
  lauf.fall({ id, name: `green: the default value \`${vorgabe}\` is a literal or a function and stays allowed`, soll: [], eingabe: () => schnitt(mitVorgabe(vorgabe, 'void x;\n    return this.zaehler;'), auftrag(['m'])) });
}

lauf.abschnitt('V2-A4: `this` in a computed name or an `extends` clause belongs to the method (B12, and B3/B4 agree on the owner)');
const RA_OBJ = "export class A {\n  key = 'x';\n  zahl = 2;\n  m(): Record<string, unknown> {\n    return { [this.key]() { return 1; }, z: this.zahl };\n  }\n}\n";
const RA_EXT = 'export class A {\n  Basis = class { wert = 1; };\n  zahl = 2;\n  m(): object {\n    return { o: new (class extends this.Basis {})(), z: this.zahl };\n  }\n}\n';
const RA_FELD = "export class A {\n  key = 'x';\n  zahl = 2;\n  m(): object {\n    return { o: new (class { [this.key] = 1; })(), z: this.zahl };\n  }\n}\n";
const RA_WERT = 'export class A {\n  zahl = 2;\n  m(): Record<string, unknown> {\n    return { [String(this)]() { return 1; }, z: this.zahl };\n  }\n}\n';
lauf.fall({ id: 'A4a', name: 'RA1: `{ [this.key]() {} }`, the cut leaves `this` in the name (what the old tool demanded): B12, and B3/B4 now demand `k`', soll: ['B3', 'B4', 'B12'], teile: ['B12/this-im-namen', 'B4/js'], eingabe: () => schnitt(RA_OBJ, auftrag(['m'])) });
lauf.fall({ id: 'A4b', name: 'RA1k: the same cut as rule 2.2 asks (`this` in the name becomes `k`): only B12, no tree error', soll: ['B12'], teile: ['B12/this-im-namen'], eingabe: () => mit(schnitt(RA_OBJ, auftrag(['m'])), { ziel: { [Z]: (t) => ersetze("'zahl'>", "'key' | 'zahl'>")(ersetze('[this.key]', '[k.key]')(t)) } }) });
lauf.fall({ id: 'A4c', name: 'RA2: `class extends this.Basis {}`: B12', soll: ['B3', 'B4', 'B12'], teile: ['B12/this-im-namen'], eingabe: () => schnitt(RA_EXT, auftrag(['m'])) });
lauf.fall({ id: 'A4d', name: 'RA2k: the same with `this` replaced by `k`: only B12', soll: ['B12'], teile: ['B12/this-im-namen'], eingabe: () => mit(schnitt(RA_EXT, auftrag(['m'])), { ziel: { [Z]: (t) => ersetze("'zahl'>", "'Basis' | 'zahl'>")(ersetze('extends this.Basis', 'extends k.Basis')(t)) } }) });
lauf.fall({ id: 'A4e', name: 'RA3: `class { [this.key] = 1 }` (computed field name of an inner class)', soll: ['B3', 'B4', 'B12'], teile: ['B12/this-im-namen'], eingabe: () => schnitt(RA_FELD, auftrag(['m'])) });
lauf.fall({ id: 'A4f', name: 'RA3k: the same with `k` in the name: only B12', soll: ['B7', 'B12'], teile: ['B12/this-im-namen'], eingabe: () => mit(schnitt(RA_FELD, auftrag(['m'])), { ziel: { [Z]: (t) => ersetze("'zahl'>", "'key' | 'zahl'>")(ersetze('[this.key]', '[k.key]')(t)) } }) });
lauf.fall({ id: 'A4g', name: 'RA6: `{ [String(this)]() {} }`, `this` as a value in the name: B12 (found twice, as a name and as a value)', soll: ['B3', 'B4', 'B12'], teile: ['B12/this-im-namen'], eingabe: () => schnitt(RA_WERT, auftrag(['m'])) });
lauf.fall({ id: 'A4h', name: 'RA6k: the same with `k`: only B12', soll: ['B12'], teile: ['B12/this-im-namen'], eingabe: () => mit(schnitt(RA_WERT, auftrag(['m'])), { ziel: { [Z]: ersetze('[String(this)]', '[String(k)]') } }) });
lauf.fall({ id: 'A4i', name: 'green: `this` in the body of an inner method is the inner method, it stays `this`', soll: [], eingabe: () => schnitt("export class A {\n  zahl = 2;\n  m(): object {\n    const zahl = this.zahl;\n    return { f() { return this === undefined ? zahl : 1; } };\n  }\n}\n", auftrag(['m'])) });
lauf.fall({ id: 'A4j', name: 'green: `{ [this.key]: 1 }` (a property, not a method: no binder between)', soll: [], eingabe: () => schnitt("export class A {\n  key = 'x';\n  m(): object {\n    return { [this.key]: 1 };\n  }\n}\n", auftrag(['m'])) });

lauf.abschnitt('R-B / R-C / V2-A6: `this` as a type and `this` as a value (B12)');
lauf.fall({ id: 'B12t1', name: 'return type `this`', soll: ['B12'], teile: ['B12/this-typ'], eingabe: () => schnitt("export class A {\n  zahl = 2;\n  m(): this {\n    this.zahl++;\n    return this;\n  }\n}\n", auftrag(['m'])) });
lauf.fall({ id: 'B12t2', name: 'type predicate `this is X`', soll: ['B12'], teile: ['B12/this-typ'], eingabe: () => schnitt('export class A {\n  zahl = 2;\n  ist(): this is { zahl: 3 } {\n    return this.zahl === 3;\n  }\n}\n', auftrag(['ist'])) });
lauf.fall({ id: 'B12t3', name: 'a `this` parameter', soll: ['B5', 'B7', 'B12'], teile: ['B12/this-parameter'], eingabe: () => schnitt('export class A {\n  zahl = 2;\n  m(this: A, a: number): number {\n    return this.zahl + a;\n  }\n}\n', auftrag(['m'])) });
lauf.fall({ id: 'B12w1', name: 'RC2: `o === this`', soll: ['B12'], teile: ['B12/this-wert'], eingabe: () => schnitt('export class A {\n  zahl = 2;\n  g(o: object): boolean {\n    return this.zahl > 0 && o === this;\n  }\n}\n', auftrag(['g'])) });
lauf.fall({ id: 'B12w2', name: 'RC1: `liste.push(this)`', soll: ['B7', 'B12'], teile: ['B12/this-wert'], eingabe: () => schnitt('const liste: object[] = [];\nexport class A {\n  zahl = 2;\n  m(): void {\n    liste.push(this);\n  }\n}\n', auftrag(['m'])) });
lauf.fall({ id: 'B12w3', name: '`return this` and `f(this)`', soll: ['B12'], teile: ['B12/this-wert'], eingabe: () => schnitt('export class A {\n  zahl = 2;\n  m(f: (a: object) => void): object {\n    f(this);\n    return this;\n  }\n}\n', auftrag(['m'])) });
lauf.fall({ id: 'B12w4', name: '`[this]` in an array', soll: ['B12'], teile: ['B12/this-wert'], eingabe: () => schnitt('export class A {\n  zahl = 2;\n  m(): number {\n    return [this].length + this.zahl;\n  }\n}\n', auftrag(['m'])) });
lauf.fall({ id: 'B12w5', name: 'green: `this.x`, `this?.x`, `this[key]`, `(this).x`, `typeof this.x` are members of `this`, not values', soll: [], eingabe: () => schnitt("export class A {\n  zahl = 2;\n  m(key: 'zahl'): number {\n    const t: typeof this.zahl = this.zahl;\n    return t + this?.zahl + this[key] + (this).zahl;\n  }\n}\n", auftrag(['m'])) });

lauf.abschnitt('V2-A3: the rest reads a moved name while the module loads, in front of its old place (B9)');
const L2 = 'function lies(): number {\n  return GRENZE;\n}\n\nexport const START = lies();\n\nconst GRENZE = 5;\n';
const L3 = 'export const WERT = rechne();\n\nfunction rechne(): number {\n  return BASIS + 1;\n}\n\nconst BASIS = 2;\n';
lauf.fall({ id: 'A3a', name: 'L2: `const GRENZE` moves; the rest calls `lies()` while loading, which reads GRENZE (old: ReferenceError, new: 5)', soll: ['B9'], teile: ['B9/lesen-vor-der-stelle'], eingabe: () => schnitt(L2, { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3b', name: 'L3: the function and the constant move together, the rest calls the function in front of the constant', soll: ['B9'], teile: ['B9/lesen-vor-der-stelle'], eingabe: () => schnitt(L3, { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Rechne.ts', woertlich: ['rechne', 'BASIS'] }] }) });
lauf.fall({ id: 'A3c', name: 'a direct read: `export const A1 = GRENZE + 1` in front of `const GRENZE` (the type checker reports it too, the tool must as well)', soll: ['B9'], teile: ['B9/lesen-vor-der-stelle'], eingabe: () => schnitt('export const A1 = GRENZE + 1;\n\nconst GRENZE = 5;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3d', name: 'a chain: the rest calls `a()`, which calls `b()`, which reads the moved constant', soll: ['B9'], teile: ['B9/lesen-vor-der-stelle'], eingabe: () => schnitt('function b(): number {\n  return GRENZE;\n}\nfunction a(): number {\n  return b() + 1;\n}\nexport const START = a();\n\nconst GRENZE = 5;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3e', name: 'a function value: `const lies = () => GRENZE` is called while loading, in front of the constant', soll: ['B9'], teile: ['B9/lesen-vor-der-stelle'], eingabe: () => schnitt('const lies = (): number => GRENZE;\n\nexport const START = lies();\n\nconst GRENZE = 5;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3f', name: 'a class with a static initial value that reads the constant, in front of it', soll: ['B9'], teile: ['B9/lesen-vor-der-stelle'], eingabe: () => schnitt('export class K {\n  static WERT = GRENZE;\n}\n\nconst GRENZE = 5;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3g', name: 'released for this name (`lesen:GRENZE`): the release names the read', soll: [], freigegeben: ['lesen:GRENZE'], eingabe: () => schnitt(L2, { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }, { freigaben: [{ schluessel: 'lesen:GRENZE', begruendung: GRUND }] }) });
lauf.fall({ id: 'A3h', name: 'green: the function is only defined in front, not called while loading', soll: [], eingabe: () => schnitt('function lies(): number {\n  return GRENZE;\n}\n\nconst GRENZE = 5;\n\nexport const START = lies();\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3i', name: 'green: a function that is called in front but does not read the moved name', soll: [], eingabe: () => schnitt('function lies(): number {\n  return 7;\n}\n\nexport const START = lies();\n\nexport const GRENZE = 5;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3j', name: 'green: the moved name is read in the rest AFTER its old place while loading', soll: [], eingabe: () => schnitt('const GRENZE = 5;\n\nexport const START = GRENZE + 1;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3k', name: 'green: a function that reads the moved name is only passed on as a value (`{ lies }`), the statement does not call it', soll: [], eingabe: () => schnitt('function lies(): number {\n  return GRENZE;\n}\n\nexport const KERN = { lies };\n\nconst GRENZE = 5;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });
lauf.fall({ id: 'A3l', name: '`new K()` in front of the constant, the constructor of K reads it', soll: ['B9'], teile: ['B9/lesen-vor-der-stelle'], eingabe: () => schnitt('class K {\n  wert = GRENZE;\n}\n\nexport const OBJ = new K();\n\nconst GRENZE = 5;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }) });

lauf.abschnitt('V2-A5: a moved `let` or `var` that the rest assigns to (B12)');
const LET_ZUW = 'export let zaehler = 0;\n\nexport function erhoehe(): number {\n  zaehler += 1;\n  return zaehler;\n}\n';
const ZIEL_ZAEHLER: Auftrag = { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/Zaehler.ts', woertlich: ['zaehler'] }] };
lauf.fall({ id: 'A5a', name: 'L4: `zaehler += 1` in the rest', soll: ['B12'], teile: ['B12/veraenderliche-variable'], eingabe: () => schnitt(LET_ZUW, ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5b', name: '`zaehler++`', soll: ['B12'], teile: ['B12/veraenderliche-variable'], eingabe: () => schnitt(LET_ZUW.replace('zaehler += 1;', 'zaehler++;'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5c', name: '`--zaehler`', soll: ['B12'], teile: ['B12/veraenderliche-variable'], eingabe: () => schnitt(LET_ZUW.replace('zaehler += 1;', '--zaehler;'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5d', name: '`zaehler = 5`', soll: ['B12'], teile: ['B12/veraenderliche-variable'], eingabe: () => schnitt(LET_ZUW.replace('zaehler += 1;', 'zaehler = 5;'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5e', name: 'destructuring assignment `[zaehler] = [1]`', soll: ['B12'], teile: ['B12/veraenderliche-variable'], eingabe: () => schnitt(LET_ZUW.replace('zaehler += 1;', '[zaehler] = [1];'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5f', name: 'destructuring assignment `({ a: zaehler } = { a: 1 })`', soll: ['B12'], teile: ['B12/veraenderliche-variable'], eingabe: () => schnitt(LET_ZUW.replace('zaehler += 1;', '({ a: zaehler } = { a: 1 });'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5g', name: '`for (zaehler of [1])`', soll: ['B12'], teile: ['B12/veraenderliche-variable'], eingabe: () => schnitt(LET_ZUW.replace('zaehler += 1;', 'for (zaehler of [1]) void zaehler;'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5h', name: 'a `var` that the rest assigns to', soll: ['B12'], teile: ['B12/veraenderliche-variable'], eingabe: () => schnitt(LET_ZUW.replace('export let', 'export var'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5i', name: 'green: a moved `let` that the rest only reads', soll: [], eingabe: () => schnitt(LET_ZUW.replace('zaehler += 1;', 'void 0;'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'A5j', name: 'green: a moved `const` that the rest reads', soll: [], eingabe: () => schnitt(LET_ZUW.replace('export let', 'export const').replace('zaehler += 1;', 'void 0;'), ZIEL_ZAEHLER) });

lauf.abschnitt('V2-A8: import attributes of a target file');
lauf.fall({ id: 'A8a', name: 'G6: a target file imports a module of the old source with `with { type: "json" }`', soll: ['B5'], teile: ['B5/import-fremd'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: ersetze("import { FAKTOR } from '../werte';", "import { FAKTOR } from '../werte' with { type: 'json' };") } }) });
lauf.fall({ id: 'A8b', name: 'an import of the rest gets an attribute', soll: ['B5'], eingabe: () => mit(form0(), { rest: ersetze("import { Peer } from './net/Peer';", "import { Peer } from './net/Peer' with { type: 'json' };") }) });

lauf.abschnitt('V2-A9: names with umlauts in the manifest');
{
  const m = (name: string) => {
    try {
      pruefeManifest({ version: 1, alt: 'probe:alt', neu: 'probe:neu', quelle: 'src/A.ts', klasse: 'A', ziele: [{ datei: Z, woertlich: [], methoden: [name], kontext: { typ: 'Ktx' } }], einstiege: ['src/A.ts'], freigaben: [] });
      return 'ok';
    } catch (e) {
      return (e as Error).message;
    }
  };
  lauf.pruefe('A9a', 'a method with an umlaut (`mäß`) is a valid name in the manifest', m('mäß') === 'ok', m('mäß'));
  lauf.pruefe('A9b', 'a name that starts with a digit is still no identifier', m('1abc').includes('is not an identifier'), m('1abc'));
  lauf.pruefe('A9c', 'a name with a blank is still no identifier', m('a b').includes('is not an identifier'), m('a b'));
  lauf.fall({ id: 'A9d', name: 'form k with a method `mäß` and a field `größe`: the whole proof runs', soll: [], eingabe: () => schnitt('export class A {\n  größe = 2;\n  mäß(): number {\n    return this.größe;\n  }\n}\n', auftrag(['mäß'])) });
}

lauf.abschnitt('V2-A13: the reason of a release has words');
{
  const g = (begruendung: string) => {
    try {
      pruefeManifest({ version: 1, alt: 'probe:alt', neu: 'probe:neu', quelle: 'src/A.ts', ziele: [{ datei: Z, woertlich: ['x'] }], einstiege: ['src/A.ts'], freigaben: [{ schluessel: 'laden:x', begruendung }] });
      return 'ok';
    } catch (e) {
      return (e as Error).message;
    }
  };
  lauf.pruefe('A13a', 'a reason of one repeated letter is refused', g('xxxxxxxxxxxxxxxxxxxxxxxx').includes('in words'), g('xxxxxxxxxxxxxxxxxxxxxxxx'));
  lauf.pruefe('A13b', 'a reason of filler characters and few letters is refused', g('-------- ab ab ab -------').includes('in words'), g('-------- ab ab ab -------'));
  lauf.pruefe('A13e', 'the length floor of 20 visible characters holds for a reason that has words (19 characters: refused)', g('abcdefghij klmnopqrs').includes('at least 20 visible'), g('abcdefghij klmnopqrs'));
  lauf.pruefe('A13f', 'and 20 visible characters with several letters are accepted', g('abcdefghij klmnopqrst') === 'ok', g('abcdefghij klmnopqrst'));
  lauf.pruefe('A13c', 'a reason with words is accepted', g('the registry is filled while loading, nothing runs before') === 'ok', g('the registry is filled while loading, nothing runs before'));
  lauf.pruefe('A13d', 'a reason with umlauts counts letters, not bytes', g('Größe wird beim Laden gefüllt, davor läuft nichts') === 'ok', g('Größe wird beim Laden gefüllt, davor läuft nichts'));
}

lauf.abschnitt('V2-A11: a rule with 0 checked places says so');
{
  const e = mit(form0(), {});
  const text = alsTextAusEingabe(e);
  lauf.pruefe('A11a', 'the output marks a rule with 0 places checked', /B12\s+0\s+0\s+0\s+.*0 places checked/.test(text) || /0 places checked/.test(text), text.split('\n').filter((z) => /^ {2}B\d+ /.test(z)).join('\n'));
  lauf.pruefe('A11b', 'a rule with places checked is not marked', !/B3\s+\d+\s+\d+\s+\d+\s+.*0 places checked/.test(text), text.split('\n').filter((z) => /^ {2}B3 /.test(z)).join('\n'));
}

// The command line of the attack: the self-test of the command line leaves no temp folder after SIGINT (V2-A10).
async function interrupt(): Promise<void> {
  const aufruf = resolve(dirname(fileURLToPath(import.meta.url)), 'verschiebung-aufruf.ts');
  const wurzel = resolve(dirname(aufruf), '../..');
  const eigen = mkdtempSync(join(tmpdir(), 'verschiebung-nachbesserung-'));
  let rest: string[] = [];
  let status: string | number | null = '';
  try {
    const c = spawn(resolve(wurzel, 'node_modules/.bin/tsx'), [aufruf], { cwd: wurzel, env: { ...process.env, TMPDIR: eigen }, stdio: 'ignore' });
    const beendet = new Promise<void>((fertig) => c.on('close', (s, sig) => ((status = s ?? sig), fertig())));
    const frist = Date.now() + 60_000;
    while (Date.now() < frist && !readdirSync(eigen).some((n) => n.startsWith('verschiebung-aufruf-'))) await new Promise((r) => setTimeout(r, 100));
    const eigene = (): string[] => readdirSync(eigen).filter((n) => n.startsWith('verschiebung-aufruf-'));
    const angelegt = eigene().length;
    c.kill('SIGINT');
    await beendet;
    rest = eigene();
    lauf.pruefe('A10a', 'the command line self-test had created its temp folder before the signal', angelegt > 0, String(angelegt));
  } finally {
    rmSync(eigen, { recursive: true, force: true });
  }
  lauf.pruefe('A10b', 'after SIGINT no temp folder of the command line self-test is left', rest.length === 0, `left: ${rest.join(', ')}; status ${String(status)}`);
}

function alsTextAusEingabe(e: Eingabe): string {
  return alsText(laufe(e));
}

lauf.abschnitt('mutants of the second attack that survived: one fixture each');
// M04: an assignment is an effect (B9, B12 default value), on its own: no foreign name is involved.
lauf.fall({ id: 'M04a', name: 'M04: a moved constant assigns to another moved name as its initial value (`W = (Q = 5)`): the assignment is the only effect', soll: ['B9'], teile: ['B9/laden'], eingabe: () => schnitt('export let Q = 0;\n\nexport const W = (Q = 5);\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/W.ts', woertlich: ['Q', 'W'] }] }) });
lauf.fall({ id: 'M04b', name: 'M04: a default value with an assignment to a parameter (`x = (y = 3)`): the assignment is the only effect', soll: ['B12'], teile: ['B12/vorgabe'], eingabe: () => schnitt('export class A {\n  zahl = 2;\n  m(y = 0, x = (y = 3)): number {\n    return x + y + this.zahl;\n  }\n}\n', auftrag(['m'])) });
// M08: `@ts-expect-error` is a directive.
lauf.fall({ id: 'M08a', name: 'M08: `// @ts-expect-error` in front of an import of a target file', soll: ['B6'], teile: ['B6/wirkung-klebstoff'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: ersetze("import { FAKTOR } from '../werte';", "// @ts-expect-error\nimport { FAKTOR } from '../werte';") } }) });
lauf.fall({ id: 'M08b', name: 'M08: `// @ts-expect-error` inside a forwarder', soll: ['B6'], teile: ['B6/wirkung-weiterleitung'], eingabe: () => mit(formk(), { rest: ersetze('    return weltSpawn(this);', '    // @ts-expect-error\n    return weltSpawn(this);') }) });
// M10: a relative literal in `new URL(...)` depends on the place of the file.
const ORT = (x: string): string => `export class A {\n  zahl = 2;\n  m(): string {\n    return ${x} + this.zahl;\n  }\n}\n`;
const MIT_URL = { 'src/umgebung.d.ts': 'declare class URL {\n  constructor(url: string, base?: string);\n  readonly href: string;\n}\ndeclare const location: { href: string };\n' };
lauf.fall({ id: 'M10a', name: "M10: `new URL('./daten.json', location.href)` (a relative literal with a base that is not the file)", soll: ['B8'], teile: ['B8/ort'], eingabe: () => schnitt(ORT("new URL('./daten.json', location.href).href"), auftrag(['m']), { dateien: MIT_URL }) });
lauf.fall({ id: 'M10b', name: "M10: `new URL('../x')` without a base", soll: ['B8'], teile: ['B8/ort'], eingabe: () => schnitt(ORT("new URL('../x').href"), auftrag(['m']), { dateien: MIT_URL }) });
lauf.fall({ id: 'M10c', name: "M10: `new URL('https://example.invalid/x')` (an absolute literal does not depend on the place)", soll: [], eingabe: () => schnitt(ORT("new URL('https://example.invalid/x').href"), auftrag(['m']), { dateien: MIT_URL }) });
// M14: a cycle between two target files (the second line behind B5: it must report even so).
{
  const ZY: Auftrag = { quelle: 'src/Server.ts', ziele: [{ datei: 'src/spiel/Beute.ts', woertlich: ['KREATUR_DROPS', 'wuerfleTruhe', 'Eintrag'] }, { datei: 'src/spiel/Truhen.ts', woertlich: ['TRUHEN'] }] };
  lauf.fall({ id: 'M14a', name: 'M14: the second target file loads the first one for its effect while the first imports the second (a cycle)', soll: ['B3', 'B5', 'B6', 'B10'], teile: ['B10/zyklus'], eingabe: () => mit(schnitt(SERVER, ZY, { dateien: UMFELD }), { ziel: { 'src/spiel/Truhen.ts': (t) => `import './Beute';\n${t}` } }) });
}
// M15: a reference to a foreign name in the initial value.
lauf.fall({ id: 'M15a', name: 'M15: `const X = FAKTOR` (a reference to an imported name) acts while loading', soll: ['B9'], teile: ['B9/laden'], eingabe: () => schnitt("import { FAKTOR } from './werte';\n\nexport const X = FAKTOR;\n\nexport const Y = 1;\n", { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/X.ts', woertlich: ['X'] }] }, { dateien: UMFELD }) });
// M18: a multi-line block comment at the end of a line belongs to the next statement, not to the previous.
lauf.fall({ id: 'M18a', name: 'M18: a multi-line block comment behind the moved statement is not part of it (it stays in the rest)', soll: [], eingabe: () => schnitt('export const A1 = 1; /* first line\n  second line */\nexport const B1 = 2;\n', { quelle: 'src/H.ts', ziele: [{ datei: 'src/teil/B.ts', woertlich: ['A1'] }] }) });
// M19: an overload signature of a method. The class-wide check "member exists more than once" reports the same part name, so the text decides.
{
  const e = schnitt('export class A {\n  zahl = 2;\n  m(a: number): number;\n  m(a: string): string;\n  m(a: number | string): number | string {\n    return a;\n  }\n}\n', auftrag(['m']));
  const texte = laufe(e).befunde.filter((b) => b.regel === 'B12' && b.teil === 'ueberladung').map((b) => b.text);
  lauf.pruefe('M19a', 'M19: the overload signature itself is reported (a finding of the part "ueberladung" that says "has no body")', texte.some((t) => t.includes('has no body')), texte.join(' | '));
}
// M22: a member "in stock" in the context type.
lauf.fall({ id: 'M22a', name: 'M22: the context type names a member the method does not use', soll: ['B5'], teile: ['B5/kontexttyp-vorrat'], eingabe: () => mit(formk(), { ziel: { [KAMPF]: (t) => muss(t, t.replace(/type KampfKontext = ([^;]+);/, (_m, a: string) => `type KampfKontext = ${a.replace(/'\s*>$/, "' | 'andere'>")};`)) } }) });

void interrupt().then(() => lauf.ende());
