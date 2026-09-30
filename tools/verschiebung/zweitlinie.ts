/**
 * Move proof, rule B4: the second line.
 *
 * Independent of the tree comparison of rule B3: the expected declaration is built as TEXT from
 * the old state, then TypeScript turns the expected and the found declaration into JavaScript
 * (`ts.transpileModule`, comments removed), and the two results must be the same text.
 *
 * Nothing here uses the comparison of `baum.ts` or the `this` analysis of `formk.ts`. The `this`
 * of a method is found a second time, top down, with its own list of nodes that give `this` a
 * new meaning. If the two lines disagree, one of them is wrong, and the proof is red.
 */
import ts from 'typescript';
import { skriptArt } from './stuecke';
import type { Datei, KontextAngabe } from './typen';

const K = ts.SyntaxKind;

const EINSTELLUNG: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  removeComments: true,
  verbatimModuleSyntax: true,
  jsx: ts.JsxEmit.Preserve,
  newLine: ts.NewLineKind.LineFeed,
  sourceMap: false,
};

/** JavaScript of a piece of TypeScript, comments removed. */
export function erzeugtesJs(text: string, pfad: string): string {
  const name = skriptArt(pfad) === ts.ScriptKind.TSX ? 'stueck.tsx' : 'stueck.ts';
  return ts.transpileModule(text, { compilerOptions: EINSTELLUNG, fileName: name, reportDiagnostics: false }).outputText;
}

interface Schritt {
  von: number;
  bis: number;
  neu: string;
}

function wendeAn(text: string, schritte: Schritt[]): string {
  let aus = text;
  for (const s of [...schritte].sort((a, b) => b.von - a.von || b.bis - a.bis)) aus = aus.slice(0, s.von) + s.neu + aus.slice(s.bis);
  return aus;
}

/** Second, independent search: every `this` of the method, found from the top down. */
function thisStellen(m: ts.MethodDeclaration): ts.Node[] {
  const aus: ts.Node[] = [];
  const abwaerts = (n: ts.Node): void => {
    switch (n.kind) {
      case K.FunctionExpression:
      case K.FunctionDeclaration:
      case K.ClassExpression:
      case K.ClassDeclaration:
      case K.MethodDeclaration:
      case K.GetAccessor:
      case K.SetAccessor:
      case K.Constructor:
      case K.ClassStaticBlockDeclaration:
      case K.ModuleDeclaration:
        return;
      case K.ThisKeyword:
        aus.push(n);
        return;
      case K.Identifier:
        if ((n as ts.Identifier).text === 'this') aus.push(n);
        return;
      default:
        n.forEachChild(abwaerts);
    }
  };
  m.typeParameters?.forEach(abwaerts);
  m.parameters.forEach(abwaerts);
  if (m.type) abwaerts(m.type);
  if (m.body) abwaerts(m.body);
  return aus;
}

/**
 * The function form k expects, as text: the method with its visibility dropped, `function` in
 * front of its name, the context parameter first and every `this` of the method replaced.
 */
export function erwarteteFunktion(m: ts.MethodDeclaration, alt: Datei, kontext: KontextAngabe): string {
  const basis = m.getStart(alt.sf);
  const text = alt.text.slice(basis, m.end);
  const schritte: Schritt[] = [];
  for (const mod of ts.getModifiers(m) ?? []) {
    if (mod.kind === K.PrivateKeyword || mod.kind === K.ProtectedKeyword || mod.kind === K.PublicKeyword) {
      let bis = mod.end;
      while (bis < m.end && /\s/.test(alt.text[bis]!)) bis++;
      schritte.push({ von: mod.getStart(alt.sf) - basis, bis: bis - basis, neu: '' });
    }
  }
  const nameVon = (m.asteriskToken ?? m.name).getStart(alt.sf) - basis;
  schritte.push({ von: nameVon, bis: nameVon, neu: 'function ' });
  const nachKlammer = m.parameters.pos - basis;
  schritte.push({ von: nachKlammer, bis: nachKlammer, neu: `${kontext.parameter}: ${kontext.typ}${m.parameters.length > 0 ? ', ' : ''}` });
  for (const t of thisStellen(m)) schritte.push({ von: t.getStart(alt.sf) - basis, bis: t.end - basis, neu: kontext.parameter });
  return wendeAn(text, schritte);
}

export interface ZweitErgebnis {
  gleich: boolean;
  erwartet: string;
  gefunden: string;
}

function ersteAbweichung(a: string, b: string): string {
  const za = a.split('\n');
  const zb = b.split('\n');
  let i = 0;
  while (i < za.length && i < zb.length && za[i] === zb[i]) i++;
  return `line ${i + 1} of the generated JavaScript: expected "${(za[i] ?? '(end)').trim().slice(0, 70)}" / found "${(zb[i] ?? '(end)').trim().slice(0, 70)}"`;
}

/** Compares the JavaScript of two pieces of text. Returns `null` if equal, otherwise where they differ. */
export function vergleicheJs(erwartet: string, gefunden: string, pfadAlt: string, pfadNeu: string): string | null {
  const a = erzeugtesJs(erwartet, pfadAlt);
  const b = erzeugtesJs(gefunden, pfadNeu);
  return a === b ? null : ersteAbweichung(a, b);
}
