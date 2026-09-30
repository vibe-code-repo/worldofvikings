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
  ['V50', 'x = () => this.zahl'],
  ['V51', 'x = function (): number { return 1; }'],
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
  ['G34', 'an object with a method that reads it and is never touched in front', 'const api = {\n  lies(): number {\n    return GRENZE;\n  },\n};\nexport const VOR = 1;\nvoid api;'],
  ['G35', 'a class with a method that reads it, instantiated but the method not named in front', 'class K {\n  lies(): number {\n    return GRENZE;\n  }\n}\n\nexport const OBJ = new K();'],
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

lauf.ende();
