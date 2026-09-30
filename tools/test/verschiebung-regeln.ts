/**
 * Self-test of the move proof (`tools/verschiebung/`), part 1: every rule bites.
 *
 * For each rule B1 to B12 there is at least one green fixture and one red fixture. A red fixture
 * names EXACTLY the rules that must report: a forgery that is caught by another rule than the one
 * it was built for would hide that the right rule is blind. Where a rule can only fire together
 * with another one (B4 is the second line behind B3), both are named.
 *
 * Fixtures are small source texts in memory. No git history, no assets, no installed packages:
 * the test runs in the CI.
 *
 * Run: npx tsx tools/test/verschiebung-regeln.ts   (from the repository root)
 */
import { Lauf, mit, muss, schnitt, type Eingabe } from '../verschiebung/pruefstand/probe';
import { statischeImporte } from '../verschiebung/reihenfolge';
import { AUFTRAG_BEIDE, AUFTRAG_FORM0, AUFTRAG_FORMK, AUFTRAG_KLEIN, BEUTE, KAMPF, QUELLE, SERVER, UMFELD, ZIEL_KLEIN, kleineKlasse } from '../verschiebung/pruefstand/vorlagen';

const lauf = new Lauf('verschiebung-regeln');
const GRUND = 'Reason written for the self-test: the effect is harmless here.';

const form0 = (): Eingabe => schnitt(SERVER, AUFTRAG_FORM0, { dateien: UMFELD });
const formk = (): Eingabe => schnitt(SERVER, AUFTRAG_FORMK, { dateien: UMFELD });
const beide = (): Eingabe => schnitt(SERVER, AUFTRAG_BEIDE, { dateien: UMFELD });
const ersetze = (von: string, nach: string) => (t: string): string => muss(t, t.replace(von, nach), von);

lauf.abschnitt('base lines');
lauf.fall({ id: 'G0', name: 'form 0: four declarations move verbatim', soll: [], eingabe: form0 });
lauf.fall({ id: 'Gk', name: 'form k: six methods become functions with a context', soll: [], eingabe: formk });
lauf.fall({ id: 'G0k', name: 'both forms in one step, two target files', soll: [], eingabe: beide });

lauf.abschnitt('B1 complete');
const MIT_UNBENUTZT = SERVER.replace('const PARADE_FENSTER_MS = 250;\n', 'const PARADE_FENSTER_MS = 250;\nconst UNBENUTZT = 7;\n');
lauf.fall({ id: 'B1a', name: 'an unmoved statement is missing in the rest', soll: ['B1'], teile: ['B1/fehlt-im-rest'], eingabe: () => mit(schnitt(MIT_UNBENUTZT, AUFTRAG_FORM0, { dateien: UMFELD }), { rest: ersetze('const UNBENUTZT = 7;\n', '') }) });
lauf.fall({ id: 'B1b', name: 'a statement stands in the rest that the old state does not have', soll: ['B1'], teile: ['B1/fremd-im-rest'], eingabe: () => mit(form0(), { rest: (t) => `${t}\nconst HEIMLICH = 1;\n` }) });
lauf.fall({ id: 'B1c', name: 'a statement stands in the target file that the old state does not have', soll: ['B1'], teile: ['B1/fremd-im-ziel'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: (t) => `${t}\nconst HEIMLICH = 1;\n` } }) });
lauf.fall({ id: 'B1d', name: 'a member stands in the class that the old state does not have', soll: ['B1'], teile: ['B1/mitglied-fremd'], eingabe: () => mit(formk(), { rest: ersetze('\n\n  zweite(): void {', '\n\n  dritte(): void {}\n\n  zweite(): void {') }) });
lauf.fall({ id: 'B1e', name: 'a name of the manifest does not exist in the source', soll: ['B1'], teile: ['B1/name-fehlt'], eingabe: () => mit(form0(), { manifest: (m) => ({ ...m, ziele: [{ ...m.ziele[0]!, woertlich: [...m.ziele[0]!.woertlich, 'GIBT_ES_NICHT'] }] }) }) });
lauf.fall({ id: 'B1f', name: 'moved declarations stand in the target file in another order than in the source', soll: ['B1'], teile: ['B1/reihenfolge-im-ziel'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: (t) => muss(t, t.replace('\n// Chests, by size.\nconst TRUHEN = [1, 2, 3];\n', '').replace('\nexport interface Eintrag', '\n// Chests, by size.\nconst TRUHEN = [1, 2, 3];\n\nexport interface Eintrag')) } }) });

lauf.abschnitt('B2 rest byte-identical');
lauf.fall({ id: 'B2a', name: 'a blank is added in an unmoved statement', soll: ['B2'], teile: ['B2/anweisung'], eingabe: () => mit(form0(), { rest: ersetze('const PARADE_AUSDAUER = 4;', 'const PARADE_AUSDAUER  = 4;') }) });
lauf.fall({ id: 'B2b', name: 'a number changes in an unmoved method', soll: ['B2'], teile: ['B2/mitglied'], eingabe: () => mit(formk(), { rest: ersetze('return 5 + this.zaehler', 'return 6 + this.zaehler') }) });
lauf.fall({ id: 'B2c', name: 'the last two statements of the constructor are swapped', soll: ['B2'], teile: ['B2/mitglied'], eingabe: () => mit(formk(), { rest: ersetze('    this.letzteTimeoutPruefung = 2;\n    instance = this;', '    instance = this;\n    this.letzteTimeoutPruefung = 2;') }) });
lauf.fall({ id: 'B2d', name: 'the comment in front of an unmoved statement changes', soll: ['B2'], teile: ['B2/anweisung'], eingabe: () => mit(form0(), { rest: ersetze('/** After the class. */', '/** After the class! */') }) });
lauf.fall({ id: 'B2e', name: 'the head of the class changes (implements added)', soll: ['B2'], teile: ['B2/klassenkopf'], eingabe: () => mit(formk(), { rest: ersetze('export class Server {', 'export class Server implements Object {') }) });
lauf.fall({ id: 'B2f', name: 'the head comment of the source file changes', soll: ['B2'], teile: ['B2/import'], eingabe: () => mit(form0(), { rest: ersetze(' * Head comment of the source file.', ' * Head comment of the source file, changed.') }) });
lauf.fall({ id: 'B2g', name: 'text is appended after the last statement', soll: ['B2'], teile: ['B2/dateiende'], eingabe: () => mit(form0(), { rest: (t) => `${t}// trailing\n` }) });

lauf.abschnitt('B3 tree equal (alone: a change only the types see)');
lauf.fall({ id: 'B3a', name: 'form 0: the return type of a moved function changes', soll: ['B3'], teile: ['B3/baum', 'B3/form0-bytes'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: ersetze('wuerfleTruhe(i: number): number {', 'wuerfleTruhe(i: number): number | undefined {') } }) });
lauf.fall({ id: 'B3b', name: 'form 0: a member of a moved interface becomes optional', soll: ['B3'], teile: ['B3/baum'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: ersetze('  menge: number;', '  menge?: number;') } }) });
lauf.fall({ id: 'B3c', name: 'form k: the type of a parameter changes', soll: ['B3'], teile: ['B3/baum'], eingabe: () => mit(formk(), { ziel: { [KAMPF]: ersetze('function weltAnlegen(k: KampfKontext, id: string)', 'function weltAnlegen(k: KampfKontext, id: string | number)') } }) });
lauf.fall({ id: 'B3d', name: 'form 0: only the indentation inside a moved declaration changes', soll: ['B3'], teile: ['B3/form0-bytes'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: ersetze('  return TRUHEN[i % 3]! * FAKTOR;', '    return TRUHEN[i % 3]! * FAKTOR;') } }) });

lauf.abschnitt('B4 second line (always together with B3)');
lauf.fall({ id: 'B4a', name: 'form 0: a number in a moved function changes', soll: ['B3', 'B4'], teile: ['B4/js'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: ersetze('TRUHEN[i % 3]!', 'TRUHEN[i % 4]!') } }) });
lauf.fall({ id: 'B4b', name: 'form k: `return X;` becomes `return<newline>X;`', soll: ['B3', 'B4'], teile: ['B4/js', 'B3/baum'], eingabe: () => mit(formk(), { ziel: { [KAMPF]: ersetze('  return k.zaehler + 1;', '  return\n  k.zaehler + 1;') } }) });
lauf.fall({ id: 'B4c', name: 'form k: a `this` that was replaced points to another member', soll: ['B3', 'B4'], eingabe: () => mit(formk(), { ziel: { [KAMPF]: ersetze('return k.zaehler + 1;', 'return k.config + 1;') } }) });

lauf.abschnitt('B5 glue');
lauf.fall({ id: 'B5a', name: 'the rest re-exports a name the source did not export', soll: ['B5'], teile: ['B5/weiterexport-oberflaeche'], eingabe: () => mit(form0(), { rest: ersetze("export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';", "export { KREATUR_DROPS, wuerfleTruhe, TRUHEN } from './spiel/Beute';") }) });
lauf.fall({ id: 'B5b', name: 'the forwarder of an async method keeps `async`', soll: ['B5'], teile: ['B5/weiterleitung-async'], eingabe: () => mit(formk(), { rest: ersetze('  speichern(): Promise<void> {', '  async speichern(): Promise<void> {') }) });
lauf.fall({ id: 'B5c', name: 'the forwarder passes a copy of the instance', soll: ['B5'], teile: ['B5/weiterleitung-kontext'], eingabe: () => mit(formk(), { rest: ersetze('return weltSpawn(this);', 'return weltSpawn({ ...this });') }) });
lauf.fall({ id: 'B5d', name: 'a target file imports a name that the source did not import', soll: ['B5'], teile: ['B5/import-fremd'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: ersetze("import { FAKTOR } from '../werte';", "import { FAKTOR } from '../werte';\nimport { ANDERER_FAKTOR } from '../werte';") } }) });
lauf.fall({ id: 'B5e', name: 'the re-export of a moved export is missing', soll: ['B5'], teile: ['B5/weiterexport-fehlt'], eingabe: () => mit(form0(), { rest: ersetze("export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';", "export { wuerfleTruhe } from './spiel/Beute';") }) });
lauf.fall({ id: 'B5f', name: 'a value is re-exported as a type only', soll: ['B5'], teile: ['B5/weiterexport-typ'], eingabe: () => mit(form0(), { rest: ersetze("export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';", "export type { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';") }) });
lauf.fall({ id: 'B5g', name: 'a member loses `private` although no context type names it', soll: ['B5'], teile: ['B5/gelockert-ohne-kontext'], eingabe: () => mit(formk(), { rest: ersetze('  private letzteTimeoutPruefung = 0;', '  letzteTimeoutPruefung = 0;') }) });
lauf.fall({ id: 'B5h', name: 'the context type is `any` behind an alias (the members cannot be bound either)', soll: ['B5', 'B7'], teile: ['B5/kontexttyp-any'], eingabe: () => mit(formk(), { ziel: { [KAMPF]: (t) => muss(t, t.replace(/type KampfKontext = [^;]+;/, 'type KampfKontext = ReturnType<typeof JSON.parse>;')) } }) });

lauf.abschnitt('B6 comments');
lauf.fall({ id: 'B6a', name: '`// @ts-nocheck` in the first line of a target file', soll: ['B6'], teile: ['B6/wirkung-klebstoff'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: (t) => `// @ts-nocheck\n${t}` } }) });
lauf.fall({ id: 'B6b', name: '`// @ts-ignore` in the body of a forwarder', soll: ['B6'], teile: ['B6/wirkung-weiterleitung'], eingabe: () => mit(formk(), { rest: ersetze('    return weltSpawn(this);', '    // @ts-ignore\n    return weltSpawn(this);') }) });
lauf.fall({ id: 'B6c', name: 'form k: a comment inside the moved body changes', soll: ['B6'], teile: ['B6/kommentar'], eingabe: () => mit(formk(), { ziel: { [KAMPF]: ersetze('// a comment inside', '// another comment inside') } }) });
lauf.fall({ id: 'B6d', name: 'form k: the comment in front of the moved method is lost', soll: ['B6'], teile: ['B6/kommentar'], eingabe: () => mit(formk(), { ziel: { [KAMPF]: ersetze('/**\n * Handles the first packet.\n * Second line of the comment.\n */\n', '') } }) });
lauf.fall({
  id: 'B6e',
  name: 'form k: a directive comment of the old method is lost in the target',
  soll: ['B6'],
  teile: ['B6/wirkung-verschoben'],
  eingabe: () => mit(schnitt(SERVER.replace('    // a comment inside', '    // eslint-disable-next-line eqeqeq'), AUFTRAG_FORMK, { dateien: UMFELD }), { ziel: { [KAMPF]: ersetze('  // eslint-disable-next-line eqeqeq\n', '') } }),
});
lauf.fall({ id: 'B6f', name: 'form k: a directive comment that moved along with its method stays green', soll: [], eingabe: () => schnitt(SERVER.replace('    // a comment inside', '    // eslint-disable-next-line eqeqeq'), AUFTRAG_FORMK, { dateien: UMFELD }) });

lauf.abschnitt('B7 binding');
lauf.fall({
  id: 'B7a',
  name: 'form 0: only the function moves, the table it reads stays in the rest',
  soll: ['B7'],
  teile: ['B7/bindung'],
  eingabe: () => {
    const e = schnitt(SERVER, { quelle: QUELLE, ziele: [{ datei: BEUTE, woertlich: ['wuerfleTruhe'] }] }, { dateien: UMFELD });
    return e;
  },
});
lauf.fall({
  id: 'B7b',
  name: 'form k: a method named like a global moves, another moved method calls the global',
  soll: ['B7'],
  teile: ['B7/bindung'],
  eingabe: () =>
    schnitt(
      'export class S {\n  n = 0;\n  parseInt(wert: string): number {\n    return this.n + wert.length;\n  }\n  kopie(wert: string): number {\n    this.n++;\n    return parseInt(wert);\n  }\n}\n',
      { quelle: 'src/S.ts', klasse: 'S', ziele: [{ datei: 'src/teil/Ziel.ts', methoden: ['parseInt', 'kopie'], kontext: { typ: 'Ktx' } }] },
    ),
});
lauf.fall({
  id: 'B7c',
  name: 'form k with another context name: a local `k` of the old method does not disturb',
  soll: [],
  eingabe: () => schnitt(kleineKlasse('const k = this.config;\n    void k;\n    void a;'), { ...AUFTRAG_KLEIN, ziele: [{ datei: ZIEL_KLEIN, methoden: ['m'], kontext: { parameter: 'ktx', typ: 'Ktx' } }] }),
});

lauf.abschnitt('B8 location');
const mitOrt = (): Eingabe => schnitt(SERVER.replace('  return TRUHEN[i % 3]! * FAKTOR;', '  void import.meta.url;\n  return TRUHEN[i % 3]! * FAKTOR;'), AUFTRAG_FORM0, { dateien: UMFELD });
lauf.fall({ id: 'B8a', name: 'a moved function reads `import.meta.url`', soll: ['B8'], teile: ['B8/ort'], eingabe: mitOrt });
lauf.fall({ id: 'B8b', name: 'the same, released for this one place', soll: [], freigegeben: ['ort:22:8'], eingabe: () => mit(mitOrt(), { freigaben: [{ schluessel: 'ort:22:8', begruendung: GRUND }] }) });
lauf.fall({ id: 'B8d', name: 'the same, released for another place: the release releases nothing', soll: ['B8', 'B11'], eingabe: () => mit(mitOrt(), { freigaben: [{ schluessel: 'ort:22:9', begruendung: GRUND }] }) });
lauf.fall({ id: 'B8c', name: '`import.meta.env` does not depend on the place of the file', soll: [], eingabe: () => schnitt(SERVER.replace('  return TRUHEN[i % 3]! * FAKTOR;', '  void import.meta.env;\n  return TRUHEN[i % 3]! * FAKTOR;'), AUFTRAG_FORM0, { dateien: UMFELD }) });

lauf.abschnitt('B9 loading');
const mitLaden = (): Eingabe => schnitt(SERVER.replace('const TRUHEN = [1, 2, 3];', 'const TRUHEN = new Array<number>(3).fill(1);'), AUFTRAG_FORM0, { dateien: UMFELD });
lauf.fall({ id: 'B9a', name: 'a moved constant calls `new` while its module loads', soll: ['B9'], teile: ['B9/laden'], eingabe: mitLaden });
lauf.fall({ id: 'B9b', name: 'the same, released for this one name', soll: [], freigegeben: ['laden:TRUHEN'], eingabe: () => mit(mitLaden(), { freigaben: [{ schluessel: 'laden:TRUHEN', begruendung: GRUND }] }) });

const PFEIL = SERVER.replace('const TRUHEN = [1, 2, 3];', 'const TRUHEN = [1, 2, 3];\nconst zufall = (r = Math.random()): number => messe() * r;').replace('* FAKTOR;', '* FAKTOR * zufall();');
lauf.fall({ id: 'B9c', name: 'an arrow function with a call in its body and in a default value is a value, not an effect', soll: [], eingabe: () => schnitt(PFEIL, { quelle: QUELLE, ziele: [{ datei: BEUTE, woertlich: ['KREATUR_DROPS', 'TRUHEN', 'zufall', 'wuerfleTruhe', 'Eintrag'] }] }, { dateien: UMFELD }) });
lauf.fall({ id: 'B9d', name: 'a moved constant reads a member of an imported name while its module loads', soll: ['B9'], teile: ['B9/laden'], eingabe: () => schnitt(SERVER.replace('const TRUHEN = [1, 2, 3];', 'const TRUHEN = [1, 2, Math.PI];'), AUFTRAG_FORM0, { dateien: UMFELD }) });
lauf.fall({ id: 'B9e', name: 'a moved constant refers to a name that stays in the rest', soll: ['B7', 'B9'], teile: ['B9/laden'], eingabe: () => schnitt(SERVER.replace('const TRUHEN = [1, 2, 3];', 'const TRUHEN = [1, 2, PARADE_AUSDAUER];'), AUFTRAG_FORM0, { dateien: UMFELD }) });

lauf.abschnitt('B10 order of evaluation');
lauf.fall({ id: 'B10a', name: 'two import lines of the old state are swapped in the rest', soll: ['B10'], teile: ['B10/importzeile-umgestellt', 'B10/umgestellt'], eingabe: () => mit(form0(), { rest: (t) => muss(t, t.replace("import { StarterSet } from './konto/StarterSet';\nimport { Inventory } from './items/Inventory';\nimport { messe } from './werte';", "import { messe } from './werte';\nimport { Inventory } from './items/Inventory';\nimport { StarterSet } from './konto/StarterSet';")) }) });
const WEITER = "export { KREATUR_DROPS, wuerfleTruhe } from './spiel/Beute';\n";
lauf.fall({ id: 'B10b', name: 'the re-export of the target file stands in front of all imports: what the target file imports is evaluated earlier', soll: ['B10'], teile: ['B10/umgestellt'], eingabe: () => mit(form0(), { rest: (t) => muss(t, `${WEITER}${t.replace(WEITER, '')}`) }) });
lauf.fall({ id: 'B10c', name: 'a target file loads a module for its effect that was not loaded before', soll: ['B5', 'B10'], teile: ['B10/neu-geladen', 'B5/import-wirkung'], eingabe: () => mit(form0(), { ziel: { [BEUTE]: ersetze("import { FAKTOR } from '../werte';", "import { FAKTOR } from '../werte';\nimport '../wirkung';") } }) });
lauf.fall({ id: 'B10d', name: 'an entry file of the manifest does not exist', soll: ['B10'], teile: ['B10/einstieg-fehlt'], eingabe: () => mit(form0(), { manifest: (m) => ({ ...m, einstiege: ['src/gibtEsNicht.ts'] }) }) });
lauf.fall({ id: 'B10e', name: 'seen from a second entry file that loads the source the order is the same', soll: [], eingabe: () => mit(schnitt(SERVER, AUFTRAG_BEIDE, { dateien: { ...UMFELD, 'src/main.ts': "import { messe } from './werte';\nimport { createServer } from './Server';\n\nvoid messe();\nvoid createServer();\n" }, einstiege: [QUELLE, 'src/main.ts'] }), {}) });

lauf.fall({
  id: 'B10f',
  name: 'a dynamic import is no part of the order: the module behind it is not evaluated while loading',
  soll: [],
  eingabe: () => {
    const e = schnitt(SERVER.replace('  void inv;\n', "  void inv;\n  void import('./wirkung');\n"), AUFTRAG_BEIDE, { dateien: UMFELD });
    return e;
  },
});

{
  const js = "import a from './a.js';\nimport './b.js';\nexport { c } from \"./c.js\";\nexport * from './d.js';\nconst x = import('./dyn.js');\nconst y = require('./req.js');\nvoid import(\n  './dyn2.js'\n);\nimport {\n  z }  from\n './e.js';\n";
  const ist = statischeImporte(js).join(' ');
  lauf.pruefe('B10g', 'static imports and re-exports count, dynamic imports and require do not', ist === './a.js ./b.js ./c.js ./d.js ./e.js', ist);
}

lauf.abschnitt('B13 section lines');
const ABSCHNITT = '// \u2500\u2500 Chests \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500';
const MIT_ABSCHNITT = SERVER.replace('\n// Chests, by size.\n', `\n${ABSCHNITT}\n// Chests, by size.\n`);
const mitAbschnitt = (): Eingabe => schnitt(MIT_ABSCHNITT, AUFTRAG_FORM0, { dateien: UMFELD });
lauf.pruefe('B13v', 'the mover leaves the section line in the rest', mitAbschnitt().neu[QUELLE]!.includes(ABSCHNITT) && !mitAbschnitt().neu[BEUTE]!.includes(ABSCHNITT), mitAbschnitt().neu[QUELLE]!.slice(0, 600));
lauf.fall({ id: 'B13a', name: 'form 0: a section line in front of a moved declaration stays in the rest', soll: [], eingabe: mitAbschnitt });
lauf.fall({
  id: 'B13b',
  name: 'form 0: the section line moves along with the declaration (also allowed)',
  soll: [],
  eingabe: () => mit(mitAbschnitt(), { rest: ersetze(`\n${ABSCHNITT}\n`, ''), ziel: { [BEUTE]: ersetze('\n\n// Chests, by size.\n', `\n\n${ABSCHNITT}\n// Chests, by size.\n`) } }),
});
lauf.fall({ id: 'B13c', name: 'form 0: the section line is lost: neither in the rest nor in the target file', soll: ['B3', 'B6'], teile: ['B3/form0-bytes', 'B6/kommentar'], eingabe: () => mit(mitAbschnitt(), { rest: ersetze(`\n${ABSCHNITT}\n`, '') }) });
lauf.fall({ id: 'B13d', name: 'form 0: a line that stays in the rest is no section line but a comment', soll: ['B2', 'B3', 'B6'], eingabe: () => mit(mitAbschnitt(), { rest: ersetze(ABSCHNITT, '// not a section line') }) });
const MIT_ABSCHNITT_K = SERVER.replace('\n  weltSpawn(): number {', `\n  ${ABSCHNITT}\n  /** Spawn. */\n  weltSpawn(): number {`);
const mitAbschnittK = (): Eingabe => schnitt(MIT_ABSCHNITT_K, AUFTRAG_FORMK, { dateien: UMFELD });
lauf.fall({ id: 'B13e', name: 'form k: a section line in front of a moved method stays in the class', soll: [], eingabe: mitAbschnittK });
lauf.fall({ id: 'B13f', name: 'form k: the comment of the method stays in front of the forwarder', soll: ['B6', 'B13'], teile: ['B13/vorlauf-weiterleitung'], eingabe: () => mit(mitAbschnittK(), { rest: ersetze(`  ${ABSCHNITT}\n  weltSpawn(): number {`, `  ${ABSCHNITT}\n  /** Spawn. */\n  weltSpawn(): number {`) }) });

lauf.abschnitt('B11 nothing unexplained');
lauf.fall({ id: 'B11a', name: 'a release that releases nothing', soll: ['B11'], teile: ['B11/freigabe-ungenutzt'], eingabe: () => mit(form0(), { freigaben: [{ schluessel: 'laden:TRUHEN', begruendung: GRUND }] }) });

lauf.ende();
