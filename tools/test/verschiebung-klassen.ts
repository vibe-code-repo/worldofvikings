/**
 * Self-test of the move proof (`tools/verschiebung/`), part 6: classes instead of shapes (second fix round, V2N).
 *
 * The attack on the first fix round (Opus 5.5, report `2026-09-30 Refactoring V2 — Nachangriff`) found that the fixes
 * caught the shapes of the old fixtures, not the class behind them. The rules are now free lists: for a default value
 * only plain literals pass (V2N-1), for a read while loading every mention of a function counts as a possible call (V2N-2),
 * and an assignment target is found through every cast (V2N-3) and judged by its binding (V2N-6). Each fixture here is the
 * smallest form of a probe of that attack, or kills one of the 14 mutants that survived the first fix round (V2N-4).
 *
 * Run: npx tsx tools/test/verschiebung-klassen.ts   (from the repository root)
 */
import { alsText } from '../verschiebung/ausgabe';
import { Lauf, laufe, mit, muss, schnitt, type Eingabe } from '../verschiebung/pruefstand/probe';
import type { Auftrag } from '../verschiebung/pruefstand/verschieber';

const lauf = new Lauf('verschiebung-klassen');
const Z = 'src/teil/Ziel.ts';
const auftrag = (methoden: string[], klasse = 'A', quelle = 'src/A.ts'): Auftrag => ({ quelle, klasse, ziele: [{ datei: Z, methoden, kontext: { typ: 'Ktx' } }] });
const ersetze = (von: string, nach: string) => (t: string): string => muss(t, t.replace(von, nach), von);
const H = 'src/H.ts';
const GRUND = 'Reason written for the self-test: the read is harmless in this fixture.';

// ---- V2N-1: default values are a free list ------------------------------------------------------------------------
const LAGER = {
  'src/lager.ts': "export const LAGER = {\n  z: 0,\n  get puffer(): number | undefined {\n    this.z++;\n    return undefined;\n  },\n};\nexport const NIX: number | undefined = undefined;\nexport const LEER: number[] = [];\nexport const ZAHL = 3;\n",
};
const mitVorgabe = (parameter: string): string =>
  `import { LAGER, NIX, LEER, ZAHL } from './lager';\nexport class A {\n  zaehler = 0;\n  zahl = 1;\n  m(${parameter}): number {\n    void LAGER; void NIX; void LEER; void ZAHL;\n    return (x === undefined ? 0 : 1) + this.zaehler;\n  }\n}\n`;
const vg = (parameter: string): Eingabe => schnitt(mitVorgabe(parameter), auftrag(['m']), { dateien: LAGER });

lauf.abschnitt('V2N-1: a default value that is not a plain literal (B12), the probes of the attack');
for (const [id, p, was] of [
  ['V7', 'x = LAGER.puffer', 'a getter of a module constant that has an effect and yields undefined'],
  ['V8', 'x = NIX', 'an imported constant that is undefined'],
  ['V9', 'x = LEER[0]', 'an element of an empty list'],
  ['V11', 'x = ({} as { a?: number }).a', 'a member of a cast object literal'],
  ['V12', 'x = ZAHL', 'a bare name (an import)'],
  ['V13', 'x = `a${ZAHL}`', 'a template with a substitution'],
  ['V14', 'x = -ZAHL', 'a negated name, not a negated number'],
  ['V15', 'x = +5', 'a unary plus (not a negated number)'],
  ['V16', 'x = (5)', 'a literal in parentheses (conversions and parentheses are not literals)'],
  ['V17', 'x = 5 as number', 'a literal with a cast'],
  ['V18', 'x = [...LEER]', 'a spread in a list'],
  ['V19', 'x = [1, NIX]', 'a name inside a list'],
  ['V20', 'x = { a: undefined }', 'undefined inside an object literal'],
  ['V21', 'x = { ...LAGER }', 'a spread in an object literal'],
  ['V22', 'x = { ZAHL }', 'a shorthand property'],
  ['V23', "x = { [ZAHL]: 1 }", 'a computed property name'],
  ['V24', 'x = { get a() { return 1; } }', 'an accessor in an object literal'],
  ['V25', 'x = { a() { return 1; } }', 'a method in an object literal'],
  ['V26', 'x = [1, , 3]', 'a hole in a list'],
  ['V27', 'x = true ? 1 : 2', 'a conditional'],
  ['V28', 'x = 1 + 2', 'a binary operation'],
  ['V29', 'x = typeof 1', 'typeof'],
  ['V30', 'x = !1', 'a logical not'],
] as const) {
  lauf.fall({ id, name: `\`${p}\`: ${was}`, soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => vg(p) });
}
lauf.fall({ id: 'V31', name: 'the getter of V7 is not run twice by a cut that passes: the forwarder of V7 stays red even with a release for a call (there is none for a member access)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => vg('x = LAGER.puffer') });
lauf.fall({ id: 'V32', name: 'a call in a default value stays releasable under its own key, and the release covers it', soll: [], freigegeben: ['vorgabe:m.x'], eingabe: () => schnitt(mitVorgabe('x = Math.abs(1)'), auftrag(['m']), { dateien: LAGER, freigaben: [{ schluessel: 'vorgabe:m.x', begruendung: GRUND }] }) });
lauf.fall({ id: 'V33', name: 'a call that reads `this` is still a finding the release cannot cover (the `this` part)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt(mitVorgabe('x = Math.abs(this.zahl)'), auftrag(['m']), { dateien: LAGER, freigaben: [{ schluessel: 'vorgabe:m.x', begruendung: GRUND }] }), freigegeben: ['vorgabe:m.x'] });
lauf.fall({ id: 'V34', name: 'a `this` inside a function value in a call is not read when the default is evaluated: only the call (released) is a finding', soll: [], freigegeben: ['vorgabe:m.x'], eingabe: () => schnitt(mitVorgabe('x = Math.abs(((): number => this.zahl) as unknown as number)'), auftrag(['m']), { dateien: LAGER, freigaben: [{ schluessel: 'vorgabe:m.x', begruendung: GRUND }] }) });
for (const [id, p] of [
  ['V40', 'x = -5'],
  ['V41', "x = 's'"],
  ['V42', 'x = `text`'],
  ['V43', 'x = 7n'],
  ['V44', 'x = /ab+c/'],
  ['V45', 'x: number[] = []'],
  ['V46', 'x: object = {}'],
  ['V47', 'x: number[][] = [[1], [2, 3]]'],
  ['V48', "x: object = { a: { b: 's', c: [1, true, null] }, 'd': -2, 3: 4 }"],
  ['V49', 'x: null | number = null'],
] as const) {
  lauf.fall({ id, name: `green: \`${p}\` is a plain literal (or a function value) and stays allowed`, soll: [], eingabe: () => vg(p) });
}

// ---- V2N-2: a read while loading, conservative -----------------------------------------------------------------
const grenze = (t: string, freigaben?: { schluessel: string; begruendung: string }[]): Eingabe =>
  schnitt(t, { quelle: H, ziele: [{ datei: 'src/teil/Grenze.ts', woertlich: ['GRENZE'] }] }, freigaben ? { freigaben } : {});
const SPAET = '\n\nconst GRENZE = 5;\n';
const LIES = 'function lies(): number {\n  return GRENZE;\n}\n\n';
const teileB9 = ['B9/lesen-vor-der-stelle'];

lauf.abschnitt('V2N-2: the rest can read a moved name while loading, in front of its old place (B9)');
for (const [id, was, text] of [
  ['L10', 'an IIFE with an arrow function', 'export const START = (() => GRENZE)();'],
  ['L11', 'an IIFE with a function expression', 'export const START = (function (): number {\n  return GRENZE;\n})();'],
  ['L12', 'the function passed on as a value: `[1].map(lies)`', `${LIES}export const LISTE = [1].map(lies);`],
  ['L13', 'a getter of an object read while loading', 'const o = {\n  get g(): number {\n    return GRENZE;\n  },\n};\n\nexport const S = o.g;'],
  ['L14', '`export default lies()`', `${LIES}export default lies();`],
  ['L15b', '`class Kind extends mach() {}`, mach reads it', 'function mach(): typeof GRENZE {\n  return GRENZE;\n}\n\nexport class Kind extends mach() {}\n\nexport const PLATZ = 1;'],
  ['L16', '`lies.call(null)`', `${LIES}export const S = lies.call(null);`],
  ['L17', 'a method of an object literal: `api.lies()`', 'const api = {\n  lies(): number {\n    return GRENZE;\n  },\n};\n\nexport const S = api.lies();'],
  ['L18', 'a static method: `Hilfe.lies()`', 'class Hilfe {\n  static lies(): number {\n    return GRENZE;\n  }\n}\n\nexport const S = Hilfe.lies();'],
  ['L20', 'a parenthesised callee: `(lies)()`', `${LIES}export const S = (lies)();`],
  ['L21', 'a tagged template on a member: `api.tag`x``', 'const api = { tag: (): number => GRENZE };\n\nexport const S = api.tag`x`;'],
  ['L24', 'a default value of an arrow function that is called at once', `${LIES}export const S = ((a = lies()): number => a)();`],
  ['L25', '`new (class { w = GRENZE })()`', 'export const S = new (class {\n  w = GRENZE;\n})();'],
  ['L26', 'a spread of a generator call', 'function* gen(): Generator<number> {\n  yield GRENZE;\n}\n\nexport const S = [...gen()];'],
  ['L27', 'a function bound and called: `lies.bind(null)()`', `${LIES}export const S = lies.bind(null)();`],
  ['L28', 'a member through a string key: `api["lies"]()`', 'const api = {\n  lies(): number {\n    return GRENZE;\n  },\n};\n\nexport const S = api["lies"]();'],
  ['L29', 'a member through a computed key: `api[k]()`', 'const api = {\n  lies(): number {\n    return GRENZE;\n  },\n};\nconst k = "lies" as "lies";\n\nexport const S = api[k]();'],
  ['L30', 'a destructured member: `const { lies } = api`', 'const api = {\n  lies(): number {\n    return GRENZE;\n  },\n};\n\nexport const { lies: S } = api;\nexport const T = S();'],
  ['L31', 'a class field initial value read at `new K()`', 'class K {\n  wert = GRENZE;\n}\n\nexport const OBJ = new K();'],
  ['L32', 'a constructor that reads it, called by `new K()`', 'class K {\n  wert: number;\n  constructor() {\n    this.wert = GRENZE;\n  }\n}\n\nexport const OBJ = new K();'],
  ['L33', 'a static block of a class', 'export class K {\n  static w: number;\n  static {\n    K.w = GRENZE;\n  }\n}'],
  ['L34', 'a computed member name of a class', 'export class K {\n  static [String(GRENZE)] = 1;\n}'],
  ['L35', 'a decorator argument of a class', 'declare function dek(n: number): (c: unknown, x: unknown) => void;\n\n@dek(GRENZE)\nexport class K {}'],
  ['L36', 'a decorator argument of a member', 'declare function dek(n: number): (c: unknown, x: unknown) => void;\n\nexport class K {\n  @dek(GRENZE)\n  m(): void {}\n}'],
  ['L37', 'a read in an `extends` expression of an anonymous class', 'export const Kind = class extends (GRENZE as unknown as new () => object) {};'],
  ['L38', 'a chain of three functions', 'function c(): number {\n  return GRENZE;\n}\nfunction b(): number {\n  return c();\n}\nfunction a(): number {\n  return b();\n}\nexport const S = a();'],
  ['L39', 'a function value in a variable called through a member of another object', 'const f = (): number => GRENZE;\nconst o = { f };\n\nexport const S = o.f();'],
  ['L46', 'a class expression in a variable, instantiated: `new K()`', 'const K = class {\n  wert = GRENZE;\n};\n\nexport const OBJ = new K();'],
  ['L47', 'a static field with an arrow function: `Hilfe.lies()`', 'class Hilfe {\n  static lies = (): number => GRENZE;\n}\n\nexport const S = Hilfe.lies();'],
  ['L48', 'a method with a computed name, reached by a computed access', 'const nm = "lies" as string;\nconst api: Record<string, () => number> = {\n  [nm]() {\n    return GRENZE;\n  },\n};\n\nexport const S = api[nm]!();'],
  ['L49', 'a method with a computed name may carry any name: a touched member `api.lies` reaches it', 'const nm = "other" as string;\nconst api: Record<string, () => number> = {\n  [nm]() {\n    return GRENZE;\n  },\n};\n\nexport const S = api.lies!();'],
  ['L40', 'an `await`ed call in front of the constant', 'async function lies(): Promise<number> {\n  return GRENZE;\n}\n\nexport const S = await lies();'],
] as const) {
  lauf.fall({ id, name: `${was}: the rest reads the moved name while loading`, soll: ['B9'], teile: teileB9, eingabe: () => grenze(`${text}${SPAET}`) });
}
lauf.fall({ id: 'L41', name: 'a moved enum that the rest reads in front of it', soll: ['B9'], teile: teileB9, eingabe: () => schnitt('export const E0 = Farbe.Rot;\n\nenum Farbe {\n  Rot = 1,\n}\n', { quelle: H, ziele: [{ datei: 'src/teil/Farbe.ts', woertlich: ['Farbe'] }] }) });
lauf.fall({ id: 'L42', name: 'released for this name: the release covers every site, and the output lists them all', soll: [], freigegeben: ['lesen:GRENZE'], eingabe: () => grenze(`${LIES}export const A1 = lies();\n\nexport const A2 = GRENZE * 2;${SPAET}`, [{ schluessel: 'lesen:GRENZE', begruendung: GRUND }]) });
{
  const e = grenze(`${LIES}export const A1 = lies();\n\nexport const A2 = GRENZE * 2;${SPAET}`);
  const b = laufe(e).befunde.filter((x) => x.regel === 'B9' && x.teil === 'lesen-vor-der-stelle');
  lauf.pruefe('L43', 'V2N-5: every site the release would cover is named in the output (one finding per statement, both lines)', b.length === 2 && b.some((x) => x.text.includes('export const A1')) && b.some((x) => x.text.includes('export const A2')), b.map((x) => x.text.slice(0, 120)).join(' | '));
  const f = grenze('function lies(): number {\n  try {\n    return GRENZE;\n  } catch {\n    return 0;\n  }\n}\n\nexport const HARMLOS = lies();\n\nexport const DIREKT = GRENZE * 2;' + SPAET, [{ schluessel: 'lesen:GRENZE', begruendung: GRUND }]);
  const r = laufe(f);
  lauf.pruefe('L44', 'V2N-5: with a release two covered sites are both in the list of released findings', r.exit === 0 && r.freigegeben.filter((x) => x.freigabe.schluessel === 'lesen:GRENZE').length === 2, String(r.freigegeben.length));
}
lauf.fall({ id: 'L45', name: 'F10: a release `lesen:GRENZE` with no site is itself a finding (B11)', soll: ['B11'], eingabe: () => grenze('const GRENZE = 5;\n\nexport const S = GRENZE;\n', [{ schluessel: 'lesen:GRENZE', begruendung: GRUND }]) });

lauf.abschnitt('V2N-2: what stays green');
for (const [id, was, text] of [
  ['G30', 'a function that reads the moved name but is never mentioned in front of it', `${LIES}export const VOR = 1;`],
  ['G31', 'a function that is called after the constant', `${LIES.trimEnd()}\n\nconst GRENZE = 5;\n\nexport const START = lies();\n`],
  ['G32', 'a function that is called in front of the constant but does not read it', 'function lies(): number {\n  return 7;\n}\n\nexport const START = lies();\n\nexport const GRENZE = 5;\n'],
  ['G33', 'the moved name read after its old place', 'const GRENZE = 5;\n\nexport const START = GRENZE + 1;\n'],
  ['G34', 'an object with a method that reads it and is never mentioned in front', 'const api = {\n  lies(): number {\n    return GRENZE;\n  },\n};\nexport const VOR = 1;'],
  ['G38', 'a function value in a variable that is never mentioned in front', 'const lies = (): number => GRENZE;\nexport const VOR = 1;'],
  ['G39', 'an arrow function as the property of an object that is never mentioned in front', 'const api = { a: (): number => GRENZE };\nexport const VOR = 1;'],
  ['G40', 'a static field with an arrow function that is never mentioned in front (an arrow function of a class field is a unit, not run at the definition)', 'class K {\n  static f = (): number => GRENZE;\n}\nexport const VOR = 1;'],
  ['G41', 'a function declaration inside a block of the rest, never called, reads the name (a declaration runs nothing)', '{\n  function h(): number {\n    return GRENZE;\n  }\n}\nexport const VOR = 1;'],
  ['G35', 'a class with a method that reads it, never mentioned in front', 'class K {\n  lies(): number {\n    return GRENZE;\n  }\n}\n\nexport const VOR = 1;'],
] as const) {
  lauf.fall({ id, name: `green: ${was}`, soll: [], eingabe: () => grenze(text.includes('const GRENZE') ? text : `${text}${SPAET}`) });
}
lauf.fall({ id: 'G36', name: 'X12: a moved FUNCTION that the rest calls in front of its old place is hoisted, nothing changes (green)', soll: [], eingabe: () => schnitt('export const START = rechne();\n\nfunction rechne(): number {\n  return 1;\n}\n', { quelle: H, ziele: [{ datei: 'src/teil/Rechne.ts', woertlich: ['rechne'] }] }) });
lauf.fall({ id: 'G37', name: 'a moved type that the rest mentions in front of it (types are not run)', soll: [], eingabe: () => schnitt('export const START: Zahl = 1;\n\nexport type Zahl = number;\n', { quelle: H, ziele: [{ datei: 'src/teil/Zahl.ts', woertlich: ['Zahl'] }] }) });

// ---- V2N-3 / V2N-6: assignment targets, judged by the binding -------------------------------------------------------
const LET = 'export let zaehler = 0;\n\nexport function erhoehe(): number {\n  ZUW\n  return zaehler;\n}\n';
const ZIEL_ZAEHLER: Auftrag = { quelle: H, ziele: [{ datei: 'src/teil/Zaehler.ts', woertlich: ['zaehler'] }] };
const zl = (z: string, vorn = ''): Eingabe => schnitt(vorn + LET.replace('ZUW', z), ZIEL_ZAEHLER);
const teileZ = ['B12/veraenderliche-variable'];

lauf.abschnitt('V2N-3: an assignment to a moved `let` through casts, in every form (B12)');
for (const [id, z] of [
  ['Z3', '(zaehler as number) = 5;'],
  ['Z4', 'zaehler! += 1;'],
  ['Z9', '(<number>zaehler) = 5;'],
  ['Z10', '(zaehler satisfies number) = 5;'],
  ['Z11', '((zaehler as unknown) as number) = 5;'],
  ['Z12', '(zaehler as number)++;'],
  ['Z13', '--(zaehler as number);'],
  ['Z14', '(zaehler!)++;'],
  ['Z15', '(zaehler) = 5;'],
  ['Z16', '(zaehler as number) += 1;'],
  ['Z17', '(zaehler as number) ||= 1;'],
  ['Z18', 'for ((zaehler as number) of [1]) void 0;'],
  ['Z19', '[zaehler as number] = [1];'],
  ['Z20', '({ a: zaehler! } = { a: 1 });'],
  ['Z21', '({ zaehler } = { zaehler: 1 });'],
  ['Z22', '({ ...zaehler } = { a: 1 } as unknown as number);'],
  ['Z23', '[...(zaehler as unknown as number[])] = [1];'],
  ['Z24', '[zaehler = 2] = [];'],
  ['Z25', 'for (zaehler in { a: 1 }) void 0;'],
  ['Z26', '(() => { zaehler = 9; })();'],
  ['Z27', 'zaehler ??= 1;'],
  ['Z28', '[[zaehler]] = [[1]];'],
] as const) {
  lauf.fall({ id, name: `\`${z}\` in the rest`, soll: ['B12'], teile: teileZ, eingabe: () => zl(z) });
}

lauf.abschnitt('V2N-6: the assignment check rests on the binding, a local of the same name is another variable');
for (const [id, was, z, vorn] of [
  ['Z30', 'a block-local `let` of the same name', '{ let zaehler = 1; zaehler++; void zaehler; }', ''],
  ['Z31', 'a parameter of an inner function', 'const f = (zaehler: number): number => { zaehler = 2; return zaehler; }; void f;', ''],
  ['Z32', 'a catch variable', 'try { void 0; } catch (zaehler) { zaehler = 1; }', ''],
  ['Z33', 'a `var` of an inner function', 'const g = (): number => { var zaehler = 1; zaehler += 1; return zaehler; }; void g;', ''],
  ['Z34', 'a `for (let zaehler ...)` loop', 'for (let zaehler = 0; zaehler < 2; zaehler++) void zaehler;', ''],
  ['Z35', 'a destructured local', '{ const o = { a: 1 }; let zaehler: number; ({ a: zaehler } = o); void zaehler; }', ''],
] as const) {
  lauf.fall({ id, name: `green: ${was} is assigned, the moved variable is only read`, soll: [], eingabe: () => zl(z, vorn) });
}
lauf.fall({ id: 'Z37', name: 'a moved `const` that the rest assigns to is not this rule (the type checker refuses the old state already, TS2588): green here', soll: [], eingabe: () => schnitt(LET.replace('export let', 'export const').replace('ZUW', 'zaehler = 5;'), ZIEL_ZAEHLER) });
lauf.fall({ id: 'Z38', name: 'two assignments in the rest to the moved variable give ONE finding for the name', soll: ['B12'], teile: teileZ, eingabe: () => zl('zaehler = 5;\n  zaehler++;') });
{
  const n = laufe(zl('zaehler = 5;\n  zaehler++;')).befunde.filter((b) => b.regel === 'B12' && b.teil === 'veraenderliche-variable').length;
  lauf.pruefe('Z39', 'exactly one finding for two assignments to one name', n === 1, String(n));
}
lauf.fall({ id: 'Z36', name: 'a local of the same name next to an assignment to the moved variable: only the real one is a finding', soll: ['B12'], teile: teileZ, eingabe: () => zl('{ let zaehler = 1; zaehler++; void zaehler; }\n  zaehler = 3;') });

// ---- the mutants of the first fix round that survived (V2N-4): one fixture each, in addition to the above ---------------
lauf.abschnitt('V2N-4: fixtures of the mutants X01 to X18 that survived');
const N = (rumpf: string, extra = ''): string => `export class A {\n  key = 'x';\n  zahl = 2;${extra}\n  m(): unknown {\n    ${rumpf}\n  }\n}\n`;
// X06/X11: a decorator of a nested CLASS reads `this` of the method (computed in the scope around the class).
lauf.fall({ id: 'D01', name: 'X06/X11: `this` in the decorator of a nested class belongs to the method (B12 this-im-namen; the cut that leaves it is B3+B4 too)', soll: ['B3', 'B4', 'B12'], teile: ['B12/this-im-namen'], eingabe: () => schnitt(N('declare const dek: (n: number) => (c: unknown) => void;\n    @dek(this.zahl)\n    class Innen {}\n    return { Innen, z: this.zahl };'), auftrag(['m'])) });
lauf.fall({ id: 'D02', name: 'X06/X11: the same cut with `this` replaced by `k` in the decorator: only B12', soll: ['B12'], teile: ['B12/this-im-namen'], eingabe: () => mit(schnitt(N('declare const dek: (n: number) => (c: unknown) => void;\n    @dek(this.zahl)\n    class Innen {}\n    return { Innen, z: this.zahl };'), auftrag(['m'])), { ziel: { [Z]: (t) => ersetze('@dek(this.zahl)', '@dek(k.zahl)')(t) } }) });
// X07: `this!` is a value, not a receiver.
lauf.fall({ id: 'D03', name: 'X07: `this!` as a value (`return this!`) is a value like `this`', soll: ['B12'], teile: ['B12/this-wert'], eingabe: () => schnitt(N('const self = this!;\n    return self;'), auftrag(['m'])) });
lauf.fall({ id: 'D04', name: 'X07: `(this!).zahl` is a receiver: green', soll: [], eingabe: () => schnitt(N('return (this!).zahl;'), auftrag(['m'])) });
// X02/X03/X04: what a nested class evaluates around itself.
lauf.fall({ id: 'D05', name: 'X02: a computed METHOD name of an inner class reads `this`', soll: ['B3', 'B4', 'B12'], teile: ['B12/this-im-namen'], eingabe: () => schnitt(N('return { o: class { [this.key]() { return 1; } }, z: this.zahl };'), auftrag(['m'])) });
lauf.fall({ id: 'D06', name: 'X03: a decorator of an inner member reads `this`', soll: ['B3', 'B4', 'B12'], teile: ['B12/this-im-namen'], eingabe: () => schnitt(N('declare const dek: (n: number) => (a: unknown, b: unknown) => void;\n    return { o: class { @dek(this.zahl) w = 1; }, z: this.zahl };'), auftrag(['m'])) });
lauf.fall({ id: 'D07', name: 'X04: the body of a static block of an inner class binds `this` anew: green', soll: [], eingabe: () => schnitt(N('return { o: class { static w = 0; static { this.w = 1; } }, z: this.zahl };'), auftrag(['m'])) });
// X08/X09: what the default value free list sees through.
lauf.fall({ id: 'D08', name: 'X08: a comma expression in a default value', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt('export class A {\n  zahl = 1;\n  m(x = (1, 2)): number {\n    return x + this.zahl;\n  }\n}\n', auftrag(['m'])) });
lauf.fall({ id: 'D09', name: 'X09: `satisfies`, `!` and `<T>` around a default value', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => schnitt('export class A {\n  zahl = 1;\n  m(x = 1 satisfies number, y = <number>2, z = 3!): number {\n    return x + y + z + this.zahl;\n  }\n}\n', auftrag(['m'])) });
// X13: a chain that is not in the favourable order (the later function is found first).
lauf.fall({ id: 'D10', name: 'X13: a chain in the unfavourable order (the caller is written BEFORE the function that reads)', soll: ['B9'], teile: teileB9, eingabe: () => grenze(`function a(): number {\n  return b();\n}\nfunction b(): number {\n  return c();\n}\nfunction c(): number {\n  return GRENZE;\n}\nexport const S = a();${SPAET}`) });
// X15/X16: object rest and shorthand in assignment targets are covered by Z21/Z22 above. X18: a tagged template on a name.
lauf.fall({ id: 'D11', name: 'X18: a tagged template on a plain name: `lies`x``', soll: ['B9'], teile: teileB9, eingabe: () => grenze(`function lies(): number {\n  return GRENZE;\n}\n\nexport const S = lies\`x\`;${SPAET}`) });

// ---- V2N-2: the limits line tells the truth ---------------------------------------------------------------------
{
  const text = alsText(laufe(grenze(`${LIES}export const VOR = 1;`)));
  lauf.pruefe('T01', 'the limits list no longer says "never one too few for a call", and names the over-approximation and its blind spots', !/never one too few/.test(text) && /over-approximates/.test(text) && /eval/.test(text), text.split('\n').filter((z) => /B9 \(reads/.test(z)).join('\n'));
}

// ==== Third fix round (V2 N3): the second attack, `2026-09-30 Refactoring V2 — Nachangriff 2` ===========================
// V2N2A-1: a function value in a default value is created in the forwarder's parameter scope.
const HILFE = { 'src/hilfe.ts': 'export const z = { n: 0 };\nexport function gibNix(): number | undefined {\n  z.n++;\n  return undefined;\n}\nexport function mach(f: unknown): number {\n  void f;\n  return 1;\n}\n' };
const fk = (param: string, rumpf = 'return [x, this.zahl];', frei: string[] = []): Eingabe =>
  schnitt(`import { gibNix, mach, z } from './hilfe';\nexport class A {\n  zahl = 1;\n  m(${param}): unknown {\n    void gibNix; void mach; void z;\n    ${rumpf}\n  }\n}\n`, auftrag(['m']), { dateien: HILFE, freigaben: frei.map((schluessel) => ({ schluessel, begruendung: GRUND })) });
const teileFn = ['B12/vorgabe-funktion'];
const teileClosure = ['B12/vorgabe-funktion-closure'];

lauf.abschnitt('V2N2A-1: a function value as a default value is not free; a closure over a parameter is never releasable');
for (const [id, was, e] of [
  ['N301', 'A01: an arrow function closes over parameter `a`, the body assigns to `a`', () => fk('a: number, x = (): number => a', 'a = 5;\n    return [x(), this.zahl];')],
  ['N302', 'A02: an arrow function closes over the LATER parameter `b`', () => fk('x = (): number => b, b = 1', 'b = 7;\n    return [x(), this.zahl];')],
  ['N303', 'A03: a `function` expression closes over `a`', () => fk('a: number, x = function (): number { return a; }', 'a = 5;\n    return [x(), this.zahl];')],
  ['N304', 'A25: an arrow function that mentions the parameter it is the default of', () => fk('x = (): unknown => x', 'const f = x;\n    x = () => 2;\n    return [f(), this.zahl];')],
  ['N305', 'A09: the closure over `a` is red even if the body does not assign (the tool does not judge the body)', () => fk('a: number, x = (): number => a', 'return [x(), a, this.zahl];')],
  ['N306', 'a class expression that mentions a parameter', () => fk('a: number, x = class { w = a; }', 'return [x, a, this.zahl];')],
] as [string, string, () => Eingabe][]) {
  lauf.fall({ id, name: `${was}: B12 vorgabe-funktion-closure, no release exists`, soll: ['B12'], teile: teileClosure, eingabe: e });
}
lauf.fall({ id: 'N307', name: 'A24: a call with an arrow over parameter `a` stays red WITH the release `vorgabe:m.x` (the call is released, the closure is not)', soll: ['B12'], teile: teileClosure, freigegeben: ['vorgabe:m.x'], eingabe: () => fk('a: number, x = mach((): number => a)', 'a = 5;\n    return [x, this.zahl];', ['vorgabe:m.x']) });
for (const [id, p] of [
  ['N310', 'x = (): number => this.zahl'],
  ['N311', 'x = function (this: unknown): unknown { return this; }'],
  ['N312', 'x = async (): Promise<number> => this.zahl'],
  ['N313', 'x = (y: number = this.zahl): number => y'],
] as const) {
  lauf.fall({ id, name: `\`${p}\`: a function value is red without a release (B12 vorgabe-funktion)`, soll: ['B12'], teile: teileFn, eingabe: () => fk(p) });
  lauf.fall({ id: `${id}f`, name: `\`${p}\`: green with the release \`vorgabe:m.x\` (it mentions no parameter of the method)`, soll: [], freigegeben: ['vorgabe:m.x'], eingabe: () => fk(p, undefined, ['vorgabe:m.x']) });
}
lauf.fall({ id: 'N319', name: 'a property name that equals a parameter name is no mention of the parameter (`this.zahl` with a parameter `zahl`): green with the release', soll: [], freigegeben: ['vorgabe:m.x'], eingabe: () => fk('zahl: number, x = (): number => this.zahl', 'return [x(), zahl];', ['vorgabe:m.x']) });
lauf.fall({ id: 'N324', name: 'M01: a function inside a list or object literal is no plain literal (red, no release)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => fk('x = [(): number => 1]') });
lauf.fall({ id: 'N325', name: 'M01: a function as a property of an object literal is no plain literal (red, no release)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => fk('x = { f: (): number => 1 }') });
lauf.fall({ id: 'N326', name: 'M14: the release key names the method and the parameter (`vorgabe:m.y` for a parameter `y`)', soll: [], freigegeben: ['vorgabe:m.y'], eingabe: () => fk('y = (): number => this.zahl', 'return [y(), this.zahl];', ['vorgabe:m.y']) });
lauf.fall({ id: 'N314', name: 'A07/M06: a class expression as a default value is red without a release (B12 vorgabe)', soll: ['B12'], teile: ['B12/vorgabe'], eingabe: () => fk('x = class {}') });
lauf.fall({ id: 'N315', name: 'A07/M06: a class expression without a parameter mention is green with the release', soll: [], freigegeben: ['vorgabe:m.x'], eingabe: () => fk('x = class {}', undefined, ['vorgabe:m.x']) });
lauf.fall({ id: 'N316', name: 'a release for the wrong parameter does not cover a function value (and is itself a finding)', soll: ['B11', 'B12'], teile: teileFn, eingabe: () => fk('x = (): number => 1', undefined, ['vorgabe:m.y']) });
{
  const t = laufe(fk('x = (): number => this.zahl')).befunde.find((b) => b.teil === 'vorgabe-funktion')?.text ?? '';
  lauf.pruefe('N317', 'V2N2A-5: the text of the finding names the other scope (the parameters of the forwarder)', /scope of ITS parameters/.test(t) && /once/.test(t), t.slice(0, 200));
  const c = laufe(fk('x = mach(1)', undefined, [])).befunde.find((b) => b.teil === 'vorgabe')?.text ?? '';
  lauf.pruefe('N318', 'V2N2A-5: the text of the call release says: evaluated in the forwarder (scope of its parameters) and, only if that passes undefined, a second time', /scope of ITS parameters/.test(c) && /second time/.test(c), c.slice(0, 260));
}
// V2N2A-4 (M02, M04): the plain literals stay free, one bad member makes the object red.
lauf.fall({ id: 'N320', name: 'M02: `-1n` is a plain literal (a negated bigint) and stays green', soll: [], eingabe: () => vg('x = -1n') });
lauf.fall({ id: 'N321', name: 'M04: an object literal whose SECOND property is a name is red (every member is checked, not only the first)', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => vg('x = { a: 1, b: NIX }') });
lauf.fall({ id: 'N322', name: 'M04: a list whose second element is a name is red', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => vg('x = [1, NIX]') });
lauf.fall({ id: 'N323', name: 'M04: a nested object whose last member is a call-free name is red', soll: ['B12'], teile: ['B12/vorgabe-this-undefined'], eingabe: () => vg('x = { a: { b: 1, c: [2, ZAHL] } }') });

// V2N2A-2: implicit calls while loading, and objects that carry functions.
const OBJ_G = 'const o = {\n  get g(): number {\n    return GRENZE;\n  },\n};\n\n';
const OBJ_T = (n: string, r: string): string => `const o = {\n  ${n}(): ${r} {\n    return ${r === 'string' ? 'String(GRENZE)' : 'GRENZE'};\n  },\n};\n\n`;
lauf.abschnitt('V2N2A-2: implicit calls while loading (spread, template, +, await, for-of, Object.*, JSON, getters): a mention of a carrier is a read');
for (const [id, was, text] of [
  ['L50', 'a spread `{ ...o }` of an object with a getter', `${OBJ_G}export const S = { ...o };`],
  ['L51', '`JSON.stringify(o)` with `toJSON`', `${OBJ_T('toJSON', 'number')}export const S = JSON.stringify(o);`],
  ['L52', 'a template `${o}` with `toString`', `${OBJ_T('toString', 'string')}export const S = \`\${o}\`;`],
  ['L53', '`Object.values(api)[0]!()`', 'const api = {\n  lies(): number {\n    return GRENZE;\n  },\n};\n\nexport const S = Object.values(api)[0]!();'],
  ['L54', 'a destructuring over an iterator `const [S] = it`', 'const it = {\n  *[Symbol.iterator](): Generator<number> {\n    yield GRENZE;\n  },\n};\n\nexport const [S] = it;'],
  ['L55', '`+o` with `valueOf`', `${OBJ_T('valueOf', 'number')}export const S = +o;`],
  ['L56', 'a class instance in a template (`toString`)', 'class K {\n  toString(): string {\n    return String(GRENZE);\n  }\n}\n\nexport const S = `${new K()}`;'],
  ['L57', '`Object.assign({}, o)` with a getter', `${OBJ_G}export const S = Object.assign({}, o);`],
  ['L58', '`await o` with `then`', 'const o = {\n  then(r: (v: number) => void): void {\n    r(GRENZE);\n  },\n};\n\nexport const S = await o;'],
  ['L59', '`JSON.stringify(o)` with a getter', `${OBJ_G}export const S = JSON.stringify(o);`],
  ['L60', '`String(o)` with `toString`', `${OBJ_T('toString', 'string')}export const S = String(o);`],
  ['L61', '`for (const x of it)` over an iterator object', 'const it = {\n  *[Symbol.iterator](): Generator<number> {\n    yield GRENZE;\n  },\n};\n\nexport let S = 0;\nfor (const x of it) S = x;'],
  ['L62', '`Object.entries(o)` with a getter', `${OBJ_G}export const S = Object.entries(o);`],
  ['L63', 'a function that makes an object: `mache().lies()`', 'function mache(): { lies(): number } {\n  return {\n    lies(): number {\n      return GRENZE;\n    },\n  };\n}\n\nexport const S = mache().lies();'],
  ['L64', '`Symbol.toPrimitive` through a template', 'const o = {\n  [Symbol.toPrimitive](): number {\n    return GRENZE;\n  },\n};\n\nexport const S = `${o}`;'],
  ['L65', 'M14: a getter of a class: `new K().g`', 'class K {\n  get g(): number {\n    return GRENZE;\n  }\n}\n\nexport const S = new K().g;'],
  ['L66', '`Array.from(it)` over an iterator object', 'const it = {\n  *[Symbol.iterator](): Generator<number> {\n    yield GRENZE;\n  },\n};\n\nexport const S = Array.from(it);'],
  ['L67', 'a promise chain with top-level await', 'function lies(): number {\n  return GRENZE;\n}\n\nexport const S = await Promise.resolve().then(lies);'],
  ['L68', '`Number(o)` with `valueOf`', `${OBJ_T('valueOf', 'number')}export const S = Number(o);`],
  ['L69', 'a comparison `o < 1` with `valueOf`', `${OBJ_T('valueOf', 'number')}export const S = o < 1;`],
  ['L70', 'a sum `o + 1` with `valueOf`', `${OBJ_T('valueOf', 'number')}export const S = o + 1;`],
  ['L71', '`x instanceof K` with a static `Symbol.hasInstance`', 'class K {\n  static [Symbol.hasInstance](): boolean {\n    return GRENZE > 0;\n  }\n}\n\nexport const S = 1 instanceof K;'],
  ['L72', 'a destructured getter `const { g } = o`', `${OBJ_G}export const { g: S } = o;`],
  ['L73', '`Object.fromEntries(Object.entries(o))`', `${OBJ_G}export const S = Object.fromEntries(Object.entries(o));`],
  ['L74', '`Object.keys(o)` (the getter is not run by keys, but the carrier is mentioned: over-approximated)', `${OBJ_G}export const S = Object.keys(o);`],
  ['L75', 'an object literal that is used at once: `JSON.stringify({ toJSON() {} })`', 'export const S = JSON.stringify({\n  toJSON(): number {\n    return GRENZE;\n  },\n});'],
  ['L76', 'an inline getter: `Object.assign({}, { get g() {} })`', 'export const S = Object.assign({}, {\n  get g(): number {\n    return GRENZE;\n  },\n});'],
  ['L77', 'an inline `valueOf`: `+{ valueOf() {} }`', 'export const S = +{\n  valueOf(): number {\n    return GRENZE;\n  },\n};'],
  ['L78', 'an inline `then`: `await Promise.resolve({ then(r) {} })`', 'export const S = await Promise.resolve({\n  then(r: (v: number) => void): void {\n    r(GRENZE);\n  },\n});'],
  ['L79', 'a carrier held by another variable: `const p = o; ...${p}`', 'const o = {\n  toString(): string {\n    return String(GRENZE);\n  },\n};\nconst p = o;\n\nexport const S = `${p}`;'],
  ['L80', 'a carrier inside a call that makes a variable: `const h = mk({ get g() {} })`, then a spread of `h`', 'function mk<T>(x: T): T {\n  return x;\n}\nconst h = mk({\n  get g(): number {\n    return GRENZE;\n  },\n});\n\nexport const S = { ...h };'],
  ['L81', 'a nested literal `{ inner: { get g() {} } }` spread through its variable', 'const cfg = {\n  inner: {\n    get g(): number {\n      return GRENZE;\n    },\n  },\n};\n\nexport const S = JSON.stringify(cfg);'],
  ['L82', 'a class field that holds a carrier: `new K()` and a spread of its field', 'class K {\n  o = {\n    get g(): number {\n      return GRENZE;\n    },\n  };\n}\n\nexport const S = { ...new K().o };'],
  ['L85', 'a function-valued property of a literal that is an argument: `Object.values({ f: () => GRENZE })[0]()`', 'export const S = Object.values({ f: (): number => GRENZE })[0]!();'],
  ['L86', 'a class field with an arrow function, reached through `Object.values(new K())`', 'class K {\n  f = (): number => GRENZE;\n}\n\nexport const S = Object.values(new K())[0]!();'],
  ['L87', 'a variable that holds an instance of an anonymous class with a getter, spread', 'const inst = new (class {\n  get g(): number {\n    return GRENZE;\n  }\n})();\n\nexport const S = { ...inst };'],
  ['L88', 'a carrier bound through a destructuring pattern: `const { o } = { o: { get g() {} } }`, then spread', 'const { o } = {\n  o: {\n    get g(): number {\n      return GRENZE;\n    },\n  },\n};\n\nexport const S = { ...o };'],
  ['L83', 'M11: a computed method name of a bound literal reads the name while the literal is built', 'export const o = {\n  [String(GRENZE)]() {\n    return 1;\n  },\n};'],
  ['L84', 'M11: the same with an unbound literal: `Object.keys({ [GRENZE]() {} })`', 'export const S = Object.keys({\n  [String(GRENZE)]() {\n    return 1;\n  },\n});'],
] as const) {
  lauf.fall({ id, name: `${was}: the rest reads the moved name while loading`, soll: ['B9'], teile: teileB9, eingabe: () => grenze(`${text}${SPAET}`) });
}
lauf.abschnitt('V2N2A-2: what stays green');
for (const [id, was, text] of [
  ['G50', 'an object with `toString` that is used only AFTER the old place', 'const o = {\n  toString(): string {\n    return String(GRENZE);\n  },\n};\n\nconst GRENZE = 5;\n\nexport const S = `${o}`;\n'],
  ['G51', 'a bound literal in an `export default` that is not run while loading', 'export default {\n  get g(): number {\n    return GRENZE;\n  },\n};'],
  ['G52', 'a carrier that does not read the moved name may be mentioned', 'const o = {\n  toString(): string {\n    return "x";\n  },\n};\n\nexport const S = `${o}`;'],
  ['G53', 'a literal without a function or a getter that is spread', 'const o = { a: 1, b: [2, 3] };\n\nexport const S = { ...o };'],
  ['G55', 'a nested bound literal with a getter that is never mentioned in front', 'const cfg = {\n  inner: {\n    get g(): number {\n      return GRENZE;\n    },\n  },\n};\nexport const VOR = 1;'],
  ['G56', 'a list of literals with a getter, bound to a variable that is never mentioned in front', 'const liste = [\n  {\n    get g(): number {\n      return GRENZE;\n    },\n  },\n];\nexport const VOR = 1;'],
  ['G54', 'a class whose method reads the name, but the class is not mentioned in front', 'class K {\n  lies(): number {\n    return GRENZE;\n  }\n}\nexport const VOR = 1;'],
] as const) {
  lauf.fall({ id, name: `green: ${was}`, soll: [], eingabe: () => grenze(text.includes('const GRENZE') ? text : `${text}${SPAET}`) });
}
{
  const text = alsText(laufe(grenze(`${LIES}export const VOR = 1;`)));
  lauf.pruefe('T02', 'the limits line names the carriers and the implicit calls (spread, template, await, for of) and still names eval/Reflect', /carries a function, a method, a getter or a class/.test(text) && /await/.test(text) && /Reflect/.test(text), text.split('\n').filter((z) => /B9 \(reads/.test(z)).join('\n'));
}

// V2N2A-4 (M20): an assignment target that the type checker cannot resolve counts as the moved variable.
lauf.fall({ id: 'Z60', name: 'M20: a target that does not resolve (an `import x = Nope.y` alias of the same name in a namespace) counts (B12)', soll: ['B7', 'B12'], teile: teileZ, eingabe: () => zl('namespace Q {\n    import zaehler = Nope.X;\n    zaehler = 1;\n  }') });

// V2N2A-3: rule 4.6b of form k, a side-effect import behind the unchanged import of the same module.
lauf.abschnitt('V2N2A-3: `import \'<module>\';` directly behind the unchanged import of the same module (rule 4.6b of form k)');
const WERK = { 'src/werk.ts': 'export class Werk {}\n', 'src/anderes.ts': 'export const ANDERES = 1;\n', 'src/frei.ts': 'export const FREI = 2;\n' };
const seite = (kopf: string): Eingabe =>
  schnitt(`${kopf}export class A {\n  w?: Werk;\n  a = ANDERES;\n  m(): unknown {\n    return [new Werk(), ANDERES, this.a];\n  }\n}\n`, auftrag(['m']), { dateien: WERK });
const KOPF = "import { Werk } from './werk';\nimport { ANDERES } from './anderes';\n";
const glue = (nach: string, zeile = "import './werk';\n") => (t: string): string => muss(t, t.replace(nach, `${nach}${zeile}`), nach);
lauf.fall({ id: 'S01', name: 'without the glue the order changes (the moved code takes the value import along): B10 is red', soll: ['B10'], eingabe: () => seite(KOPF) });
lauf.fall({ id: 'S02', name: 'the glue directly behind the unchanged import: green (order as before)', soll: [], eingabe: () => mit(seite(KOPF), { rest: glue("import { Werk } from './werk';\n") }) });
lauf.fall({ id: 'S10', name: 'K07: the glue behind the import of the module that is NOT the first import of the file: green', soll: [], eingabe: () => mit(seite("import { ANDERES } from './anderes';\nimport { Werk } from './werk';\n"), { rest: glue("import { Werk } from './werk';\n") }) });
lauf.fall({ id: 'S03', name: 'the same line at another place (behind the other import) is no glue: B5 import-seiteneffekt, released only by `seiteneffekt:./werk`', soll: ['B5', 'B10'], teile: ['B5/import-seiteneffekt'], eingabe: () => mit(seite(KOPF), { rest: glue("import { ANDERES } from './anderes';\n") }) });
lauf.fall({ id: 'S04', name: 'a side-effect import of a module the old state never imported: B5 import-seiteneffekt', soll: ['B5', 'B10'], teile: ['B5/import-seiteneffekt'], eingabe: () => mit(seite(KOPF), { rest: glue("import { Werk } from './werk';\n", "import './frei';\n") }) });
lauf.fall({ id: 'S05', name: 'the same, released under `seiteneffekt:./frei`: only B10 stays (the order of evaluation changed)', soll: ['B10'], freigegeben: ['seiteneffekt:./frei'], eingabe: () => mit(seite(KOPF), { rest: glue("import { Werk } from './werk';\n", "import './frei';\n"), freigaben: [{ schluessel: 'seiteneffekt:./frei', begruendung: GRUND }] }) });
lauf.fall({ id: 'S06', name: 'a second side-effect import behind the first glue line is not glue', soll: ['B5'], teile: ['B5/import-seiteneffekt'], eingabe: () => mit(seite(KOPF), { rest: glue("import { Werk } from './werk';\n", "import './werk';\nimport './werk';\n") }) });
lauf.fall({ id: 'S07', name: 'the old import was only a type import: a side-effect import behind it adds a load, not glue', soll: ['B5', 'B10'], teile: ['B5/import-seiteneffekt'], eingabe: () => mit(schnitt("import type { Werk } from './werk';\nimport { ANDERES } from './anderes';\nexport class A {\n  w?: Werk;\n  a = ANDERES;\n  m(): unknown {\n    return [ANDERES, this.a];\n  }\n}\n", auftrag(['m']), { dateien: WERK }), { rest: glue("import type { Werk } from './werk';\n") }) });
lauf.fall({ id: 'S08', name: 'the import in front lost a name: a side-effect import behind it is no glue', soll: ['B5'], teile: ['B5/import-seiteneffekt'], eingabe: () => mit(schnitt("import { Werk, Ding } from './werk';\nimport { ANDERES } from './anderes';\nexport class A {\n  w?: Werk;\n  a = ANDERES;\n  m(): unknown {\n    return [new Werk(), ANDERES, Ding, this.a];\n  }\n}\n", auftrag(['m']), { dateien: { ...WERK, 'src/werk.ts': 'export class Werk {}\nexport const Ding = 3;\n' } }), { rest: glue("import { Werk } from './werk';\n") }) });
lauf.fall({ id: 'S09', name: 'a default import in the side-effect form with names is not the form (`import x from` behind is a new import)', soll: ['B5', 'B10'], teile: ['B5/import-neu-fremd'], eingabe: () => mit(seite(KOPF), { rest: glue("import { Werk } from './werk';\n", "import { FREI } from './frei';\n") }) });

lauf.ende();
