/**
 * Editor card EG2: how the item mask is hooked into the editor, and that its modules do nothing on load.
 * Editor-Karte EG2: das Einhaengen in `editorMain.ts` und Ladezeit-Sauberkeit der neuen Module.
 *
 * On the syntax tree (TypeScript compiler API):
 *  [0] the probe bites: small sources that break each rule are found
 *  [1] `editorMain.ts` has exactly ONE import from `./gegenstaende/`, it is the LAST import, and the name it brings
 *      is called exactly once (nowhere else: no dynamic import, no second reference)
 *  [2] the modules in `client/src/editor/gegenstaende/` run nothing on load: outside function and class bodies no
 *      call, no `new`, no `await`, no registry name (`uploadedModelRegistry`, `ITEM_DEFS`, `ITEMS_BY_NAME`,
 *      `findItem`) and nothing that is imported is written to
 *  [3] the mask does not touch what the card forbids: no hook of the tool registry (`werkzeugKontext`, `WERKZEUGE`),
 *      and `GegenstandsKatalog.ts` / `katalog/**` are not imported
 *
 * `client/test/editor-module-grenze.ts` and `client/test/entwurfs-speicher.ts` are separate tests that stay green.
 *
 * Run: npx tsx test/editor-gegenstaende-einhaengen.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = resolve(CLIENT, 'src/editor/editorMain.ts');
const ORDNER = resolve(CLIENT, 'src/editor/gegenstaende');
const parse = (datei: string, code: string): ts.SourceFile => ts.createSourceFile(datei, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
function besuche(n: ts.Node, f: (x: ts.Node) => void): void {
  f(n);
  ts.forEachChild(n, (k) => besuche(k, f));
}

interface Einhaengen {
  importe: number;
  ausGegenstaende: string[];
  letzteImportZeileIstMeine: boolean;
  aufrufe: number;
  bezuege: number;
  dynamisch: number;
}
function einhaengen(sf: ts.SourceFile): Einhaengen {
  const importe = sf.statements.filter(ts.isImportDeclaration);
  const meine = importe.filter((i) => ts.isStringLiteral(i.moduleSpecifier) && /(^|\/)gegenstaende\//.test(i.moduleSpecifier.text));
  const namen: string[] = [];
  for (const i of meine) {
    const b = i.importClause?.namedBindings;
    if (b && ts.isNamedImports(b)) for (const e of b.elements) namen.push(e.name.text);
    if (i.importClause?.name) namen.push(i.importClause.name.text);
  }
  let aufrufe = 0;
  let bezuege = 0;
  let dynamisch = 0;
  besuche(sf, (n) => {
    if (ts.isIdentifier(n) && namen.includes(n.text) && !ts.isImportSpecifier(n.parent)) {
      bezuege++;
      if (ts.isCallExpression(n.parent) && n.parent.expression === n) aufrufe++;
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && /gegenstaende\//.test(n.arguments[0].text)) dynamisch++;
  });
  const letzte = importe[importe.length - 1];
  return { importe: meine.length, ausGegenstaende: namen, letzteImportZeileIstMeine: meine.length === 1 && letzte === meine[0], aufrufe, bezuege, dynamisch };
}

const REGISTER = new Set(['uploadedModelRegistry', 'ITEM_DEFS', 'ITEMS_BY_NAME', 'findItem']);
/** Problems that run while a module loads: statements outside function-like and class bodies. */
function ladezeit(sf: ts.SourceFile): string[] {
  const probleme: string[] = [];
  const eingefuehrt = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && s.importClause) {
      if (s.importClause.name) eingefuehrt.add(s.importClause.name.text);
      const b = s.importClause.namedBindings;
      if (b && ts.isNamedImports(b)) for (const e of b.elements) eingefuehrt.add(e.name.text);
      if (b && ts.isNamespaceImport(b)) eingefuehrt.add(b.name.text);
    }
  }
  const wurzelName = (n: ts.Expression): string | null => {
    let x: ts.Node = n;
    while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression;
    return ts.isIdentifier(x) ? x.text : null;
  };
  const geh = (n: ts.Node): void => {
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    if (ts.isAwaitExpression(n)) probleme.push('await');
    if (ts.isCallExpression(n)) probleme.push(`Aufruf ${n.expression.getText(sf).slice(0, 30)}`);
    if (ts.isNewExpression(n)) probleme.push('new');
    if (ts.isTaggedTemplateExpression(n)) probleme.push('getaggte Vorlage');
    if (ts.isIdentifier(n) && REGISTER.has(n.text) && !ts.isImportSpecifier(n.parent)) probleme.push(`Registry ${n.text}`);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const w = wurzelName(n.left);
      if (w !== null && eingefuehrt.has(w)) probleme.push(`Schreiben in Import ${w}`);
    }
    ts.forEachChild(n, geh);
  };
  for (const s of sf.statements) if (!ts.isImportDeclaration(s)) geh(s);
  return probleme;
}

console.log('\n[0] die Probe beisst:');
{
  const gut = einhaengen(parse('x.ts', "import { a } from './b';\nimport { gegenstandsKnopf } from './gegenstaende/seite';\nfoo(gegenstandsKnopf(v));"));
  check('richtig eingehaengt wird erkannt', gut.importe === 1 && gut.letzteImportZeileIstMeine && gut.aufrufe === 1 && gut.bezuege === 1);
  const zwei = einhaengen(parse('x.ts', "import { gegenstandsKnopf } from './gegenstaende/seite';\nimport { a } from './b';\nfoo(gegenstandsKnopf(v)); bar(gegenstandsKnopf(w));"));
  check('nicht letzter Import und zwei Aufrufe werden erkannt', !zwei.letzteImportZeileIstMeine && zwei.aufrufe === 2);
  const doppelt = einhaengen(parse('x.ts', "import { a } from './gegenstaende/seite';\nimport { b } from './gegenstaende/modell';"));
  check('zwei Importe werden erkannt', doppelt.importe === 2);
  const dyn = einhaengen(parse('x.ts', "void import('./gegenstaende/seite');"));
  check('dynamischer Import wird erkannt', dyn.dynamisch === 1);
  check('await auf Modulebene wird erkannt', ladezeit(parse('x.ts', 'await x;')).includes('await'));
  check('Aufruf auf Modulebene wird erkannt', ladezeit(parse('x.ts', 'const a = f();')).length === 1);
  check('Registry auf Modulebene wird erkannt', ladezeit(parse('x.ts', "import { ITEM_DEFS } from 'y';\nconst a = ITEM_DEFS;")).includes('Registry ITEM_DEFS'));
  check('Schreiben in einen Import wird erkannt', ladezeit(parse('x.ts', "import { M } from 'y';\nM.a = 1;")).includes('Schreiben in Import M'));
  check('Aufruf im Funktionsrumpf ist erlaubt', ladezeit(parse('x.ts', "import { ITEM_DEFS } from 'y';\nexport function f() { return g(ITEM_DEFS); }\nclass K { m() { return new Date(); } }")).length === 0);
}

console.log('\n[1] Einhaengen in editorMain.ts:');
{
  const e = einhaengen(parse(MAIN, readFileSync(MAIN, 'utf-8')));
  check('genau ein Import aus ./gegenstaende/', e.importe === 1, String(e.importe));
  check('der Import steht hinter der letzten bestehenden Importzeile', e.letzteImportZeileIstMeine);
  check('er bringt genau einen Namen', e.ausGegenstaende.length === 1, e.ausGegenstaende.join());
  check('genau ein Aufruf', e.aufrufe === 1, String(e.aufrufe));
  check('keine zweite Erwaehnung (kein Verweis ausser dem einen Aufruf)', e.bezuege === 1, String(e.bezuege));
  check('kein dynamischer Import der Maske', e.dynamisch === 0);
  const text = readFileSync(MAIN, 'utf-8');
  check('der Aufruf steht bei den Ansichts-Knoepfen der Werkzeugleiste', /ansicht\.appendChild\(gegenstandsKnopf\(shell\.viewport\)\);/.test(text));
}

console.log('\n[2] Nichts beim Laden:');
const DATEIEN = readdirSync(ORDNER).filter((d) => d.endsWith('.ts')).sort();
check('die sieben Module sind da (EG2 N4: dazu anzeige.ts und dom.ts)', DATEIEN.join() === 'ablauf.ts,anzeige.ts,api.ts,dom.ts,modell.ts,seite.ts,texte.ts', DATEIEN.join());
for (const d of DATEIEN) {
  const p = ladezeit(parse(d, readFileSync(resolve(ORDNER, d), 'utf-8')));
  check(`${d}: kein Aufruf, kein new, kein await, keine Registry, kein Schreiben in Importe`, p.length === 0, p.join('; '));
}

console.log('\n[3] Was die Karte verbietet:');
{
  for (const d of DATEIEN) {
    const sf = parse(d, readFileSync(resolve(ORDNER, d), 'utf-8'));
    const spezifikationen = sf.statements.filter(ts.isImportDeclaration).map((i) => (ts.isStringLiteral(i.moduleSpecifier) ? i.moduleSpecifier.text : ''));
    check(`${d}: importiert weder GegenstandsKatalog noch katalog/** noch werkzeuge/`, !spezifikationen.some((s) => /GegenstandsKatalog|\/katalog\/|werkzeuge/.test(s)), spezifikationen.join());
    let haken = 0;
    besuche(sf, (n) => {
      if (ts.isIdentifier(n) && (n.text === 'werkzeugKontext' || n.text === 'WERKZEUGE' || n.text === 'WerkzeugKontext')) haken++;
    });
    check(`${d}: kein Werkzeug-Haken`, haken === 0);
  }
}

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
