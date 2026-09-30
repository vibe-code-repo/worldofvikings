/**
 * Move proof, rule B8: expressions whose value depends on where the file lies.
 *
 * `import.meta.url`, `new URL('../x', import.meta.url)`, `import('./x')`, `__dirname` and their
 * relatives keep their text when code moves and change their meaning. The type checker stays
 * silent and a byte comparison cannot see it. Every such place in a moved declaration is a
 * finding, also when the target file lies in the same folder; it is released place by place.
 */
import ts from 'typescript';
import { istVariablenname } from './formk';
import { kurz, ortVonKnoten, type Datei, type Protokoll } from './typen';

const K = ts.SyntaxKind;

function textLiteral(n: ts.Node | undefined): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

const istRelativ = (pfad: string): boolean => pfad.startsWith('.');
const hatSchema = (pfad: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(pfad) || pfad.startsWith('/');

export interface OrtsFund {
  knoten: ts.Node;
  was: string;
}

/** Location dependent expressions inside a node, in document order. */
export function ortsabhaengig(wurzel: ts.Node): OrtsFund[] {
  const aus: OrtsFund[] = [];
  const geh = (n: ts.Node): void => {
    if (ts.isMetaProperty(n) && n.keywordToken === K.ImportKeyword) {
      const p = n.parent;
      const istEnv = ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === 'env';
      if (!istEnv) aus.push({ knoten: n, was: '`import.meta` (its `url`, `dirname` and `filename` name the file the code stands in)' });
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      if (name === 'Worker' || name === 'SharedWorker') {
        aus.push({ knoten: n, was: `\`new ${name}(...)\` (the address of the worker is resolved against the file)` });
      } else if (name === 'URL') {
        const erstes = n.arguments?.[0];
        const lit = textLiteral(erstes);
        const mitBasis = (n.arguments?.length ?? 0) > 1;
        if (lit !== null ? istRelativ(lit) || (mitBasis && !hatSchema(lit)) : mitBasis) {
          aus.push({ knoten: n, was: `\`new URL(${kurz(erstes?.getText() ?? '', 30)}, ...)\` with a relative or unknown path` });
        }
      }
    } else if (ts.isCallExpression(n) && n.expression.kind === K.ImportKeyword) {
      const lit = textLiteral(n.arguments[0]);
      if (lit === null || istRelativ(lit)) aus.push({ knoten: n, was: `\`import(${kurz(n.arguments[0]?.getText() ?? '', 30)})\` with a relative or unknown path` });
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require') {
      const lit = textLiteral(n.arguments[0]);
      if (lit === null || istRelativ(lit)) aus.push({ knoten: n, was: `\`require(${kurz(n.arguments[0]?.getText() ?? '', 30)})\` with a relative or unknown path` });
    } else if (ts.isImportTypeNode(n)) {
      const arg = n.argument;
      const lit = ts.isLiteralTypeNode(arg) ? textLiteral(arg.literal) : null;
      if (lit === null || istRelativ(lit)) aus.push({ knoten: n, was: `the type \`import(${kurz(arg.getText(), 30)})\` with a relative or unknown path` });
    } else if (ts.isIdentifier(n) && istVariablenname(n) && !ts.isParameter(n.parent) && !ts.isVariableDeclaration(n.parent) && !ts.isBindingElement(n.parent)) {
      if (n.text === '__dirname' || n.text === '__filename') aus.push({ knoten: n, was: `\`${n.text}\`` });
      else if (n.text === 'fileURLToPath') aus.push({ knoten: n, was: '`fileURLToPath` (turns the address of a file into its path)' });
    }
    ts.forEachChild(n, geh);
  };
  geh(wurzel);
  return aus;
}

/** Release key of one place: line and column in the OLD source file, which is a fixed state. */
export function ortsSchluessel(alt: Datei, knoten: ts.Node): string {
  const o = ortVonKnoten(alt, knoten);
  return `ort:${o.zeile}:${o.spalte}`;
}

export function pruefeOrt(name: string, knoten: ts.Node, alt: Datei, p: Protokoll): void {
  p.zaehle('B8');
  for (const f of ortsabhaengig(knoten)) {
    p.melde({
      regel: 'B8',
      teil: 'ort',
      ort: ortVonKnoten(alt, f.knoten),
      text: `"${name}" moves ${f.was}: its value depends on the place of the file`,
      freigabe: ortsSchluessel(alt, f.knoten),
    });
  }
}
