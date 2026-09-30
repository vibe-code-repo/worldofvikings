/**
 * Self-test of the move proof (`tools/verschiebung/`), part 3: the forgeries the attacks on the
 * earlier proof tool found, each in its smallest form.
 *
 * The second attack (H1 to H4, M1 to M4, N1 to N7 and the groups T, K, W, I, Z, Y, S, X, P) worked
 * on the real files. Here every finding stands as a fixture on the small source texts of the test
 * bench, with the expectation the attack had (`herkunft`) and a reason where the result differs.
 * The groups of the first attack (A, W, R, F, N) stand in `verschiebung-altbestand.ts`: the
 * earlier self-test took them over one by one.
 *
 * Run: npx tsx tools/test/verschiebung-nachangriff.ts   (from the repository root)
 */
import { alsText } from '../verschiebung/ausgabe';
import { pruefeManifest } from '../verschiebung/manifest';
import { Lauf, laufe, mit, mitWeiterleitung, muss, schnitt, type Eingabe } from '../verschiebung/pruefstand/probe';
import type { Auftrag } from '../verschiebung/pruefstand/verschieber';
import { AUFTRAG_FORM0, AUFTRAG_FORMK, AUFTRAG_KLEIN, BEUTE, KAMPF, QUELLE, SERVER, UMFELD, ZIEL_KLEIN, kleineKlasse } from '../verschiebung/pruefstand/vorlagen';

const lauf = new Lauf('verschiebung-nachangriff');
const GRUND = 'Reason written for the self-test: the effect is harmless here.';
const ersetze = (von: string, nach: string) => (t: string): string => muss(t, t.replace(von, nach), von);
const ROT = { alt: 'rot' } as const;
const GRUEN = { alt: 'gruen' } as const;
const rotHierGruen = (grund: string) => ({ alt: 'rot', grund }) as const;
const gruenHierRot = (grund: string) => ({ alt: 'gruen', grund }) as const;

const formk = (text = SERVER): Eingabe => schnitt(text, AUFTRAG_FORMK, { dateien: UMFELD });
const form0 = (text = SERVER): Eingabe => schnitt(text, AUFTRAG_FORM0, { dateien: UMFELD });
/** The fixtures have no DOM library: `URL` is declared for the program. */
const MIT_URL = { ...UMFELD, 'src/umgebung.d.ts': 'declare class URL {\n  constructor(url: string, base?: string);\n  readonly pathname: string;\n}\n' };
const zielK = (f: (t: string) => string): { ziel: Record<string, (t: string) => string> } => ({ ziel: { [KAMPF]: f } });
const zielB = (f: (t: string) => string): { ziel: Record<string, (t: string) => string> } => ({ ziel: { [BEUTE]: f } });
const w = (name: string, f: (t: string) => string): (() => Eingabe) => () => mitWeiterleitung(formk(), name, f);
const klein = (rumpf: string, parameter = 'a: number'): Eingabe => schnitt(kleineKlasse(rumpf, parameter), AUFTRAG_KLEIN);
const VORSICHTIG = 'no change of the program, but the text differs: red on the safe side, as the attack itself judged';

lauf.abschnitt('H1: token sequence against syntax tree (T)');
lauf.fall({ id: 'T1', name: 'target: `return X;` becomes `return<newline>X;` (returns undefined)', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(formk(), zielK(ersetze('  return k.zaehler + 1;', '  return\n  k.zaehler + 1;'))) });
lauf.fall({ id: 'T2', name: 'rest: `return<newline>X;` in an unnamed method', soll: ['B2'], herkunft: ROT, eingabe: () => mit(formk(), { rest: ersetze('    return 5 + this.zaehler', '    return\n    5 + this.zaehler') }) });
lauf.fall({ id: 'F5', name: 'form 0: `return<newline>X;` in a verbatim function', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(form0(), zielB(ersetze('  return TRUHEN[i % 3]! * FAKTOR;', '  return\n  TRUHEN[i % 3]! * FAKTOR;'))) });
lauf.fall({ id: 'T3', name: 'rest: `get<newline>geo()` (same tree, text differs)', soll: ['B2'], herkunft: ROT, eingabe: () => mit(formk(), { rest: ersetze('  get geo(): number {', '  get\n  geo(): number {') }) });
lauf.fall({ id: 'T4', name: 'rest: `async<newline>schreiben()` (a field `async` and a method without async)', soll: ['B1', 'B2'], herkunft: ROT, eingabe: () => mit(formk(), { rest: ersetze('  async schreiben(): Promise<void> {', '  async\n  schreiben(): Promise<void> {') }) });
lauf.fall({ id: 'T6', name: 'target: number written as hex (same value)', soll: ['B3', 'B4'], herkunft: rotHierGruen(VORSICHTIG), eingabe: () => mit(formk(), zielK(ersetze('umkreis = 40): void {', 'umkreis = 0x28): void {'))) });
lauf.fall({ id: 'T7', name: 'target: string with a unicode escape (same value)', soll: ['B3', 'B4'], herkunft: rotHierGruen(VORSICHTIG), eingabe: () => mit(formk(), zielK(ersetze("k.log('s');", "k.log('\\u0073');"))) });
lauf.fall({ id: 'T8', name: 'target: identifier with a unicode escape (same name)', soll: ['B3', 'B4'], herkunft: rotHierGruen(VORSICHTIG), eingabe: () => mit(formk(), zielK(ersetze("k.log('s');", "k.\\u006cog('s');"))) });
lauf.fall({ id: 'T9', name: 'target: a blank inside a template literal', soll: ['B3', 'B4'], herkunft: ROT, eingabe: () => mit(formk(), zielK(ersetze('  mehrzeilig ${p.name}`', '   mehrzeilig ${p.name}`'))) });

lauf.abschnitt('H2: expressions whose value depends on the place of the file (P)');
const MIT_HIER = SERVER.replace('const TRUHEN = [1, 2, 3];', "const TRUHEN = [1, 2, 3];\nconst HIER = new URL('.', import.meta.url).pathname;");
lauf.fall({
  id: 'P1',
  name: 'form 0: a constant built from `import.meta.url` moves (it acts at load time too)',
  soll: ['B8', 'B9'],
  teile: ['B8/ort', 'B9/laden'],
  herkunft: ROT,
  eingabe: () => schnitt(MIT_HIER, { quelle: QUELLE, ziele: [{ datei: BEUTE, woertlich: ['KREATUR_DROPS', 'TRUHEN', 'HIER', 'wuerfleTruhe', 'Eintrag'] }] }, { dateien: MIT_URL }),
});
lauf.fall({ id: 'P2a', name: 'form 0: a function with `new URL(<relative>, import.meta.url)` moves', soll: ['B8'], teile: ['B8/ort'], herkunft: ROT, eingabe: () => schnitt(SERVER.replace('  return TRUHEN[i % 3]! * FAKTOR;', "  void new URL('../ui/worker.ts', import.meta.url);\n  return TRUHEN[i % 3]! * FAKTOR;"), AUFTRAG_FORM0, { dateien: MIT_URL }) });

lauf.abschnitt('H3: new imports of the rest are checked by name (I)');
const AUFTRAG_PARADE: Auftrag = { quelle: QUELLE, ziele: [{ datei: BEUTE, woertlich: ['PARADE_AUSDAUER', 'PARADE_FENSTER_MS'] }] };
lauf.fall({ id: 'F1', name: 'rest imports two moved constants with swapped aliases', soll: ['B5', 'B7'], teile: ['B5/import-alias'], herkunft: ROT, eingabe: () => mit(schnitt(SERVER, AUFTRAG_PARADE, { dateien: UMFELD }), { rest: ersetze("import { PARADE_AUSDAUER, PARADE_FENSTER_MS } from './spiel/Beute';", "import { PARADE_AUSDAUER as PARADE_FENSTER_MS, PARADE_FENSTER_MS as PARADE_AUSDAUER } from './spiel/Beute';") }) });
lauf.fall({ id: 'I7', name: 'rest: `import { wuerfleTruhe as structuredClone }` from the target (shadows a global)', soll: ['B5'], herkunft: ROT, eingabe: () => mit(form0(), { rest: ersetze("export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';", "export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';\nimport { wuerfleTruhe as structuredClone } from './spiel/Beute';") }) });
lauf.fall({ id: 'I6', name: 'rest: `import * as Math` from the target (shadows the global Math)', soll: ['B5'], herkunft: ROT, eingabe: () => mit(form0(), { rest: ersetze("export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';", "export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';\nimport * as Math from './spiel/Beute';") }) });

lauf.abschnitt('M1: directive comments in the target file and in the forwarder (K)');
lauf.fall({ id: 'K1', name: 'target: `// @ts-nocheck` in the first line', soll: ['B6'], herkunft: ROT, eingabe: () => mit(formk(), zielK((t) => `// @ts-nocheck\n${t}`)) });
lauf.fall({ id: 'K2', name: 'target: `/* eslint-disable */` in the first line', soll: ['B6'], herkunft: ROT, eingabe: () => mit(formk(), zielK((t) => `/* eslint-disable */\n${t}`)) });
lauf.fall({ id: 'K3', name: 'target: `// @ts-nocheck` between the imports and the first function', soll: ['B6'], herkunft: ROT, eingabe: () => mit(formk(), zielK(ersetze("import type { ServerKontext } from './Kontext';", "import type { ServerKontext } from './Kontext';\n// @ts-nocheck"))) });
lauf.fall({ id: 'K4', name: 'rest: `// @ts-ignore` in the body of a forwarder', soll: ['B6'], herkunft: ROT, eingabe: w('weltSpawn', ersetze('    return weltSpawn(this);', '    // @ts-ignore\n    return weltSpawn(this);')) });
lauf.fall({ id: 'K5', name: 'rest: `/* eslint-disable */` in the body of a forwarder (holds to the end of the file)', soll: ['B6'], herkunft: ROT, eingabe: w('weltSpawn', ersetze('    return weltSpawn(this);', '    /* eslint-disable */ return weltSpawn(this);')) });
lauf.fall({ id: 'K6', name: 'rest: `// @ts-nocheck` in the first line of the rest', soll: ['B2'], herkunft: ROT, eingabe: () => mit(formk(), { rest: (t) => `// @ts-nocheck\n${t}` }) });
const MIT_IGNORE = SERVER.replace('  zweite(): void {', '  // @ts-ignore alt\n  zweite(): void {');
lauf.fall({ id: 'K7', name: 'rest: a directive comment moved to another member', soll: ['B2'], herkunft: ROT, eingabe: () => mit(formk(MIT_IGNORE), { rest: (t) => muss(t, t.replace('  // @ts-ignore alt\n  zweite(): void {', '  zweite(): void {').replace('  andere(): number {', '  // @ts-ignore alt\n  andere(): number {')) }) });

lauf.abschnitt('M2: decorators and `?` at the forwarder, overloads, this parameter, class body (W)');
lauf.fall({ id: 'W1', name: 'rest: a decorator in front of the forwarder replaces the method', soll: ['B5'], teile: ['B5/weiterleitung-dekorator'], herkunft: ROT, eingabe: w('weltSpawn', (t) => `@((_m: unknown, _c: unknown) => function (this: unknown) { return undefined as never; })\n  ${t}`) });
lauf.fall({ id: 'W2', name: 'rest: the forwarder is an optional method `weltSpawn?()`', soll: ['B5'], teile: ['B5/weiterleitung-optional'], herkunft: ROT, eingabe: w('weltSpawn', ersetze('weltSpawn(): number {', 'weltSpawn?(): number {')) });
lauf.fall({ id: 'W5', name: 'rest: an overload signature in front of the forwarder (the signature is taken for the forwarder, the forwarder is a foreign member)', soll: ['B1', 'B5', 'B7'], herkunft: ROT, eingabe: w('weltSpawn', (t) => `weltSpawn(): number;\n  ${t}`) });
lauf.fall({ id: 'W6', name: 'rest: the forwarder gets a `this: Server` parameter', soll: ['B5'], teile: ['B5/weiterleitung-signatur'], herkunft: ROT, eingabe: w('weltSpawn', ersetze('weltSpawn(): number {', 'weltSpawn(this: Server): number {')) });
lauf.fall({ id: 'W7', name: 'rest: a static block in the class', soll: ['B1'], herkunft: ROT, eingabe: () => mit(formk(), { rest: ersetze('export class Server {\n', 'export class Server {\n  static {\n    process.exitCode = 3;\n  }\n') }) });
lauf.fall({ id: 'W8', name: 'rest: a setter next to the getter', soll: ['B1', 'B7'], herkunft: ROT, eingabe: () => mit(formk(), { rest: ersetze('  get geo(): number {', '  set geo(_v: unknown) {\n    process.exitCode = 3;\n  }\n\n  get geo(): number {') }) });

lauf.abschnitt('M3: the order of the imports counts (I)');
const MIT_WIRKUNG = SERVER.replace("import { FAKTOR, messe } from './werte';", "import { FAKTOR, messe } from './werte';\nimport './wirkung';");
const WIRKUNG = "import './wirkung';";
lauf.fall({ id: 'I0', name: 'a source file with an import for its effect: the cut keeps the order', soll: [], herkunft: GRUEN, eingabe: () => form0(MIT_WIRKUNG) });
lauf.fall({ id: 'I1', name: 'rest: the import for its effect is pulled to the top (in front of the first import, whose lines before it change too)', soll: ['B2', 'B10'], teile: ['B10/umgestellt', 'B10/importzeile-umgestellt'], herkunft: ROT, eingabe: () => mit(form0(MIT_WIRKUNG), { rest: (t) => muss(t, t.replace(`\n${WIRKUNG}`, '').replace("import { Peer } from './net/Peer';", `${WIRKUNG}\nimport { Peer } from './net/Peer';`)) }) });
lauf.fall({ id: 'I2', name: 'rest: the first and the last import swapped', soll: ['B2', 'B10'], teile: ['B10/umgestellt', 'B10/importzeile-umgestellt'], herkunft: ROT, eingabe: () => mit(form0(), { rest: (t) => muss(t, t.replace("import { Peer } from './net/Peer';", 'PLATZ').replace("import { messe } from './werte';", "import { Peer } from './net/Peer';").replace('PLATZ', "import { messe } from './werte';")) }) });
lauf.fall({ id: 'I10', name: 'rest: the import for its effect a second time at the end of the imports', soll: ['B5'], herkunft: rotHierGruen('a second import of the same module changes nothing at run time; it is new glue the manifest does not explain, so it stays red: the attack judged this case as no real change'), eingabe: () => mit(form0(MIT_WIRKUNG), { rest: ersetze("export type { Eintrag } from './spiel/Beute';", `export type { Eintrag } from './spiel/Beute';\n${WIRKUNG}`) }) });
lauf.fall({ id: 'I11', name: 'rest: the import for its effect removed', soll: ['B5', 'B10'], teile: ['B5/import-wirkung-entfernt', 'B10/nicht-mehr-geladen'], herkunft: ROT, eingabe: () => mit(form0(MIT_WIRKUNG), { rest: ersetze(`\n${WIRKUNG}`, '') }) });
lauf.fall({ id: 'I12', name: 'rest: the import for its effect made `import type {}` (loads nothing)', soll: ['B5', 'B10'], herkunft: ROT, eingabe: () => mit(form0(MIT_WIRKUNG), { rest: ersetze(WIRKUNG, "import type {} from './wirkung';") }) });
lauf.fall({ id: 'I3', name: 'rest: a new import for its effect of a foreign module', soll: ['B5', 'B10'], herkunft: ROT, eingabe: () => mit(form0(), { rest: ersetze("import { messe } from './werte';", "import { messe } from './werte';\nimport './wirkung';") }) });

lauf.abschnitt('M4: free names of verbatim declarations are bound (F)');
lauf.fall({ id: 'F3', name: 'form 0 only for wuerfleTruhe; the table TRUHEN it reads stays in the source', soll: ['B7'], teile: ['B7/bindung'], herkunft: ROT, eingabe: () => schnitt(SERVER, { quelle: QUELLE, ziele: [{ datei: BEUTE, woertlich: ['wuerfleTruhe'] }] }, { dateien: UMFELD }) });
lauf.fall({ id: 'F7', name: 'target: the import of a name the moved function uses is removed', soll: ['B7'], herkunft: ROT, eingabe: () => mit(form0(), zielB(ersetze("import { FAKTOR } from '../werte';\n", ''))) });
lauf.fall({ id: 'F6', name: 'target: the import is replaced by `type FAKTOR = never`', soll: ['B1', 'B7'], herkunft: ROT, eingabe: () => mit(form0(), zielB(ersetze("import { FAKTOR } from '../werte';", 'type FAKTOR = never;'))) });

lauf.abschnitt('N1, N2: releases in the output, kinds of releases');
{
  const mitLaden = schnitt(SERVER.replace('const TRUHEN = [1, 2, 3];', 'const TRUHEN = new Array<number>(3).fill(1);'), AUFTRAG_FORM0, { dateien: UMFELD, freigaben: [{ schluessel: 'laden:TRUHEN', begruendung: GRUND }] });
  const erg = laufe(mitLaden);
  const text = alsText(erg);
  lauf.pruefe('N1a', 'a used release stands in the output with its key and its reason', erg.exit === 0 && text.includes('laden:TRUHEN') && text.includes(GRUND), text.slice(0, 600));
  lauf.pruefe('N1b', 'the manifest and both states stand in the output', text.includes('"quelle": "src/Server.ts"') && text.includes('old state:') && text.includes('new state:'), text.slice(0, 600));
  lauf.pruefe('N1c', 'the limits of exit 0 stand in the output', text.includes('What exit 0 does not prove'), '');
  const wirft = (f: () => unknown): boolean => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  lauf.pruefe('N2', 'a release of a whole file (`import:<path>`) does not exist: manifest error', wirft(() => pruefeManifest({ ...form0().manifest, freigaben: [{ schluessel: 'import:src/spiel/Beute.ts', begruendung: GRUND }] })), 'the release import:<path> was accepted');
  lauf.pruefe('N2b', 'a release without a reason is a manifest error', wirft(() => pruefeManifest({ ...form0().manifest, freigaben: [{ schluessel: 'laden:TRUHEN', begruendung: '.' }] })), 'a release with the reason "." was accepted');
  lauf.pruefe('N2c', 'a release with a reason of zero-width characters is a manifest error', wirft(() => pruefeManifest({ ...form0().manifest, freigaben: [{ schluessel: 'laden:TRUHEN', begruendung: '​​​​​​​​​​​​​​​​​​​​​' }] })), 'a release with an invisible reason was accepted');
}

lauf.abschnitt('N3: context type without the word any');
const KONTEXTTYP = /type KampfKontext = [^;]+;/;
lauf.fall({ id: 'N3-1', name: 'target: `ReturnType<typeof JSON.parse>` (is any without the word)', soll: ['B5', 'B7'], teile: ['B5/kontexttyp-any'], herkunft: ROT, eingabe: () => mit(formk(), zielK((t) => muss(t, t.replace(KONTEXTTYP, 'type KampfKontext = ReturnType<typeof JSON.parse>;')))) });
lauf.fall({ id: 'N3-2', name: 'target: `{ [x: string]: any }`', soll: ['B5', 'B7'], herkunft: ROT, eingabe: () => mit(formk(), zielK((t) => muss(t, t.replace(KONTEXTTYP, 'type KampfKontext = { [x: string]: any };')))) });
lauf.fall({ id: 'N3-4', name: 'target: `Record<string, (...a: never[]) => never> & Record<string, never>`', soll: ['B5', 'B7'], herkunft: ROT, eingabe: () => mit(formk(), zielK((t) => muss(t, t.replace(KONTEXTTYP, 'type KampfKontext = Record<string, (...a: never[]) => never> & Record<string, never>;')))) });
lauf.fall({
  id: 'N3-5',
  name: 'target: the context type comes from a FOREIGN file named Kontext',
  soll: ['B5', 'B7'],
  herkunft: ROT,
  eingabe: () => mit(schnitt(SERVER, AUFTRAG_FORMK, { dateien: { ...UMFELD, 'src/boese/Kontext.ts': 'export type ServerKontext<K extends string> = Record<K, any>;\n' } }), zielK(ersetze("import type { ServerKontext } from './Kontext';", "import type { ServerKontext } from '../boese/Kontext';"))),
});

lauf.abschnitt('N4: import type against import');
lauf.fall({ id: 'I4', name: 'rest: `import type { Welt }` made `import { Welt }`', soll: ['B5'], herkunft: ROT, eingabe: () => mit(formk(), { rest: ersetze("import type { Welt } from './world/Welt';", "import { Welt } from './world/Welt';") }) });
lauf.fall({ id: 'I5', name: 'rest: `import { Inventory }` made `import type { Inventory }`', soll: ['B5'], herkunft: ROT, eingabe: () => mit(formk(), { rest: ersetze("import { Inventory } from './items/Inventory';", "import type { Inventory } from './items/Inventory';") }) });
lauf.fall({ id: 'I8', name: 'target: `import type { Welt }` of the old state written as a value import', soll: ['B5'], herkunft: ROT, eingabe: () => mit(formk(), zielK(ersetze("import type { Welt } from '../world/Welt';", "import { Welt } from '../world/Welt';"))) });
lauf.fall({ id: 'F2', name: 'rest: `export type { … } from` instead of `export { … } from` (values become types for importers)', soll: ['B5'], teile: ['B5/weiterexport-typ'], herkunft: ROT, eingabe: () => mit(form0(), { rest: ersetze("export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';", "export type { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';") }) });
lauf.fall({ id: 'I9', name: 'target: an additional import that the target does not use, with a counterpart in the old state', soll: [], herkunft: GRUEN, eingabe: () => mit(formk(), zielK(ersetze("import type { ServerKontext } from './Kontext';", "import { Inventory } from '../items/Inventory';\nimport type { ServerKontext } from './Kontext';"))) });

lauf.abschnitt('N6, N7: file extensions, super, inner function declaration');
lauf.fall({ id: 'W4', name: "rest: the forwarders import from './spiel/Kampf.mjs' (another file, same stem)", soll: ['B5', 'B10'], herkunft: ROT, eingabe: () => mit(formk(), { rest: ersetze("from './spiel/Kampf';", "from './spiel/Kampf.mjs';") }) });
lauf.fall({ id: 'S13', name: 'a method with `super.` moves', soll: ['B7', 'B12'], teile: ['B12/super'], herkunft: ROT, eingabe: () => schnitt('class Basis {\n  m(a: number): void {\n    void a;\n  }\n}\nexport class A extends Basis {\n  config = 1;\n  m(a: number): void {\n    void this.config;\n    super.m(a);\n  }\n}\n', AUFTRAG_KLEIN) });
lauf.fall({ id: 'S8', name: 'an inner function declaration with `this`: kept, right cut', soll: [], herkunft: rotHierGruen('the mover keeps the `this` of an inner function declaration, it binds differently; the earlier mover replaced it blindly, which stands here as its own forgery (S8b)'), eingabe: () => klein('void this.config; function f(this: { config: number }): number { return this.config; } void f; void a;') });
lauf.fall({ id: 'S8b', name: 'an inner function declaration with `this` replaced blindly in the target', soll: ['B3', 'B4'], eingabe: () => mit(klein('void this.config; function f(this: { config: number }): number { return this.config; } void f; void a;'), { ziel: { [ZIEL_KLEIN]: ersetze('return this.config;', 'return k.config;') } }) });

lauf.abschnitt('Z: what may stand in a target file');
const zz = (id: string, name: string, zusatz: string, soll: readonly ('B1' | 'B5' | 'B10' | 'B12')[], vorn = false, herkunft: { alt: 'gruen' | 'rot'; grund?: string } = ROT): void => {
  lauf.fall({ id, name: `target: ${name}`, soll, herkunft, eingabe: () => mit(formk(), zielK((t) => (vorn ? `${zusatz}\n${t}` : `${t}\n${zusatz}\n`))) });
};
zz('Z1', '`namespace N { export const x = process.exit(3); }`', 'namespace N {\n  export const x = process.exit(3);\n}', ['B1']);
zz('Z2', '`export default 5;`', 'export default 5;', ['B1']);
zz('Z3', '`declare global { … }`', 'declare global {\n  interface Array<T> {\n    boese: T;\n  }\n}', ['B1']);
zz('Z4', '`enum E { A = 1 }`', 'enum E {\n  A = 1,\n}', ['B1']);
zz('Z5', 'a class with a static block', 'class C {\n  static {\n    process.exitCode = 3;\n  }\n}', ['B1']);
zz('Z6', "`import boese = require('./boese');`", "import boese = require('./boese');", ['B1'], true);
zz('Z7', "`export * from '../wirkung';`", "export * from '../wirkung';", ['B1', 'B10']);
zz('Z8', '`declare function boese(): void;`', 'declare function boese(): void;', ['B1']);
zz('Z9', 'an immediately called function `(() => { … })();`', '(() => {\n  process.exitCode = 3;\n})();', ['B1']);
zz('Z10', '`export {};` (harmless: an empty export list exports nothing)', 'export {};', [], false, rotHierGruen('an empty export list has no effect; export lists are glue of the target file, this one names nothing') as never);
zz('Z11', 'an unused interface', 'interface UnbenutzterTyp {\n  a: number;\n}', ['B1'], false, rotHierGruen('an unused type has no effect at run time; it is a declaration the old state does not have, so it stays red here') as never);

lauf.abschnitt('Y: interface and type verbatim');
lauf.fall({ id: 'Y1', name: 'target: a member of the moved interface becomes optional', soll: ['B3'], herkunft: ROT, eingabe: () => mit(form0(), zielB(ersetze('  menge: number;', '  menge?: number;'))) });
lauf.fall({ id: 'Y2', name: 'target: a second interface of the same name widens the first (declaration merging)', soll: ['B1', 'B7'], herkunft: ROT, eingabe: () => mit(form0(), zielB((t) => `${t}\nexport interface Eintrag {\n  zusatz?: string;\n}\n`)) });
lauf.fall({ id: 'Y3', name: 'target: an additional interface under another name extends the moved one', soll: ['B1'], herkunft: gruenHierRot('a declaration the old state does not have is red (B1), even a type without effect at run time; the attack expected green'), eingabe: () => mit(form0(), zielB((t) => `${t}\nexport interface Zusatz extends Eintrag {\n  zusatz?: string;\n}\n`)) });
lauf.fall({ id: 'Y5', name: 'target: the interface made a type alias of the same shape', soll: ['B3'], herkunft: ROT, eingabe: () => mit(form0(), zielB(ersetze('export interface Eintrag {', 'export type Eintrag = {'))) });
lauf.fall({ id: 'Y6', name: 'target: the interface gets `extends Record<string, unknown>`', soll: ['B3'], herkunft: ROT, eingabe: () => mit(form0(), zielB(ersetze('export interface Eintrag {', 'export interface Eintrag extends Record<string, unknown> {'))) });
lauf.fall({ id: 'Y7', name: 'rest: a new interface', soll: ['B1'], herkunft: ROT, eingabe: () => mit(form0(), { rest: (t) => `${t}\ninterface Neu {\n  a: number;\n}\n` }) });

lauf.abschnitt('S: scopes and the context name');
lauf.fall({ id: 'S1', name: '`catch (k)` in the method: the context name occurs', soll: ['B12'], teile: ['B12/kontextname'], herkunft: ROT, eingabe: () => klein('try { void a; } catch (k) { void k; } void this.config;') });
lauf.fall({ id: 'S2', name: 'destructuring to `k`', soll: ['B7', 'B12'], teile: ['B12/kontextname'], herkunft: ROT, eingabe: () => klein('const { k } = { k: 1 }; void k; void this.config; void a;') });
lauf.fall({ id: 'S3', name: 'a label `k:` in the method', soll: ['B12'], teile: ['B12/kontextname'], herkunft: gruenHierRot('the rules of form k forbid the context name anywhere in the method, also as a label; the attack expected green'), eingabe: () => klein('k: for (let i = 0; i < 1; i++) { break k; } void this.config; void a;') });
lauf.fall({ id: 'S4', name: 'a field `k` of an inner class', soll: ['B12'], teile: ['B12/kontextname'], herkunft: gruenHierRot('the rules of form k forbid the context name anywhere in the method, also as a member name; the attack expected green'), eingabe: () => klein('const C = class { k = 1; }; void C; void this.config; void a;') });
lauf.fall({ id: 'S7', name: 'a local type in the method: green', soll: [], herkunft: GRUEN, eingabe: () => klein('type T = number; const t: T = 1; void t; void this.config; void a;') });
lauf.fall({ id: 'S9', name: '`keyof typeof` on a name that stays in the rest', soll: ['B7'], herkunft: ROT, eingabe: () => formk(SERVER.replace('    return this.zaehler + 1;', "    const x: keyof typeof KREATUR_DROPS = 'wolf';\n    void x;\n    return this.zaehler + 1;")) });
lauf.fall({ id: 'S15', name: '`typeof this.config` in a type position: `this` becomes `k` there too', soll: [], herkunft: GRUEN, eingabe: () => klein('const c: typeof this.config = 2; void c; void this.config; void a;') });

lauf.abschnitt('X, first attack group U: method named like a global, overloads, parameter patterns, naked this');
lauf.fall({ id: 'X1', name: 'a method named like a global moves, another moved method calls the global', soll: ['B7'], herkunft: ROT, eingabe: () => schnitt('export class S {\n  n = 0;\n  parseInt(wert: string): number {\n    return this.n + wert.length;\n  }\n  kopie(wert: string): number {\n    this.n++;\n    return parseInt(wert);\n  }\n}\n', { quelle: 'src/S.ts', klasse: 'S', ziele: [{ datei: 'src/teil/Ziel.ts', methoden: ['parseInt', 'kopie'], kontext: { typ: 'Ktx' } }] }) });
lauf.fall({ id: 'U1', name: 'a method with an overload signature moves (B12 catches it; the other rules follow, because the class has the name twice)', soll: ['B2', 'B3', 'B4', 'B5', 'B12'], teile: ['B12/ueberladung'], herkunft: ROT, eingabe: () => schnitt(kleineKlasse('void this.config; void a;').replace('  m(a: number): void {', '  m(a: number): void;\n  m(a: number | string): void;\n  m(a: number): void {'), AUFTRAG_KLEIN) });
lauf.fall({ id: 'U2', name: 'a method with a parameter pattern moves', soll: ['B12'], teile: ['B12/parametermuster'], herkunft: ROT, eingabe: () => klein('void this.config; void a;', '{ a }: { a: number }') });
lauf.fall({ id: 'U3', name: 'a naked `this` (not `this.x`) is a value: B12 since V2-A6 (the context type `Pick` cannot stand for the instance)', soll: ['B12'], teile: ['B12/this-wert'], herkunft: ROT, eingabe: () => klein('void this.config; const s = this; void s; void a;') });

lauf.ende();
