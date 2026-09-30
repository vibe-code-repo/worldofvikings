/**
 * Move proof, rule B9: what a moved declaration does while its module loads.
 *
 * In the old state a declaration of the module level was evaluated at its place in the source
 * file, after the statements above it. In the new state it is evaluated when its module is
 * imported, that is before every statement of the rest. For a pure declaration that makes no
 * difference. A declaration whose initial value DOES something is a finding that needs a release
 * `laden:<name>`: a call, `new`, `await`, access to a member of a foreign name, a reference to a
 * foreign name or to a name that stays in the rest. The output names the statements of the rest
 * that ran before it and now run after it.
 *
 * Free are: functions, classes without static initial values, types, and constants built from
 * literals, function expressions and other declarations of this step.
 */
import ts from 'typescript';
import { ersteWirkung, istVariablenname } from './formk';
import { bindungsNamen, dekoratoren, hatModifikator, istNurTyp } from './stuecke';
import { kurz, ortVonKnoten, type Datei, type Protokoll, type Stueck } from './typen';

const K = ts.SyntaxKind;
const FESTE_NAMEN = new Set(['undefined', 'NaN', 'Infinity']);

export interface LadeUmgebung {
  /** Names of all declarations that move in this step. */
  verschoben: ReadonlySet<string>;
  /** Names declared on module level of the old source file that stay in the rest. */
  bleibt: ReadonlySet<string>;
}

export interface LadeFund {
  knoten: ts.Node;
  was: string;
}

function istLiteralWurzel(n: ts.Expression): boolean {
  let a: ts.Expression = n;
  while (ts.isParenthesizedExpression(a) || ts.isAsExpression(a) || ts.isSatisfiesExpression(a) || ts.isNonNullExpression(a) || ts.isTypeAssertionExpression(a)) a = a.expression;
  return ts.isStringLiteral(a) || ts.isNumericLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isArrayLiteralExpression(a) || ts.isObjectLiteralExpression(a) || ts.isRegularExpressionLiteral(a) || ts.isBigIntLiteral(a);
}

/** What evaluating an expression does at load time. Function bodies and types are not entered. */
export function wirkungenImAusdruck(ausdruck: ts.Node, lokal: ReadonlySet<string>, u: LadeUmgebung): LadeFund[] {
  const aus: LadeFund[] = [];
  const w = ersteWirkung(ausdruck);
  if (w) aus.push({ knoten: w.knoten, was: `${w.was} (${kurz(w.knoten.getText(), 50)})` });
  const geh = (n: ts.Node): void => {
    if (ts.isTypeNode(n)) return;
    if (ts.isFunctionLike(n)) return;
    if (ts.isClassLike(n)) return; // reported as an effect above
    const istInnen = (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.expression === n;
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && !istInnen && !istLiteralWurzel(n.expression)) {
      let wurzel: ts.Expression = n;
      while (ts.isPropertyAccessExpression(wurzel) || ts.isElementAccessExpression(wurzel) || ts.isNonNullExpression(wurzel) || ts.isParenthesizedExpression(wurzel)) wurzel = wurzel.expression;
      const wn = ts.isIdentifier(wurzel) ? wurzel.text : null;
      if (wn === null || (!lokal.has(wn) && !u.verschoben.has(wn))) {
        aus.push({ knoten: n, was: `access to a member of a foreign name (${kurz(n.getText(), 50)})` });
      }
    }
    if (ts.isIdentifier(n) && istVariablenname(n) && !FESTE_NAMEN.has(n.text) && !lokal.has(n.text)) {
      const p = n.parent;
      const istDeklaration = (ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isParameter(p)) && p.name === n;
      const istGliedWurzel = (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n;
      if (!istDeklaration && !istGliedWurzel) {
        if (u.bleibt.has(n.text)) aus.push({ knoten: n, was: `reference to "${n.text}", which stays in the rest` });
        else if (!u.verschoben.has(n.text)) aus.push({ knoten: n, was: `reference to the foreign name "${n.text}"` });
      } else if (istGliedWurzel && u.bleibt.has(n.text)) {
        aus.push({ knoten: n, was: `reference to "${n.text}", which stays in the rest` });
      }
    }
    ts.forEachChild(n, geh);
  };
  geh(ausdruck);
  return aus;
}

function wirkungenDerKlasse(k: ts.ClassLikeDeclaration, u: LadeUmgebung): LadeFund[] {
  const aus: LadeFund[] = [];
  for (const d of dekoratoren(k)) aus.push({ knoten: d, was: 'a decorator of the class' });
  for (const h of k.heritageClauses ?? []) {
    if (h.token !== K.ExtendsKeyword) continue;
    for (const t of h.types) {
      aus.push(...wirkungenImAusdruck(t.expression, new Set(), u).map((f) => ({ knoten: f.knoten, was: `\`extends\`: ${f.was}` })));
    }
  }
  for (const m of k.members) {
    if (ts.isClassStaticBlockDeclaration(m)) aus.push({ knoten: m, was: 'a static block' });
    else if (ts.isPropertyDeclaration(m) && hatModifikator(m, K.StaticKeyword) && m.initializer) aus.push({ knoten: m, was: `a static initial value (${kurz(m.getText(), 50)})` });
    for (const d of dekoratoren(m)) aus.push({ knoten: d, was: 'a decorator of a member' });
    const n = (m as ts.NamedDeclaration).name;
    if (n && ts.isComputedPropertyName(n)) aus.push({ knoten: n, was: `a computed member name (${kurz(n.getText(), 40)})` });
  }
  return aus;
}

/** What a statement of the module level does while the module loads. Empty for a pure declaration. */
export function wirkungenBeimLaden(st: ts.Node, u: LadeUmgebung): LadeFund[] {
  if (istNurTyp(st) || ts.isFunctionDeclaration(st)) return [];
  if (ts.isClassDeclaration(st)) return wirkungenDerKlasse(st, u);
  if (ts.isEnumDeclaration(st)) {
    const eigene = new Set(st.members.map((m) => (ts.isIdentifier(m.name) ? m.name.text : '')));
    return st.members.flatMap((m) => (m.initializer ? wirkungenImAusdruck(m.initializer, eigene, u) : []));
  }
  if (ts.isVariableStatement(st)) {
    const aus: LadeFund[] = [];
    const lokal = new Set<string>();
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) aus.push({ knoten: d.name, was: 'a pattern on the left side (reads members of the value)' });
      if (d.initializer) {
        if (ts.isClassExpression(d.initializer)) aus.push(...wirkungenDerKlasse(d.initializer, u));
        else aus.push(...wirkungenImAusdruck(d.initializer, lokal, u));
      }
      for (const n of bindungsNamen(d.name)) lokal.add(n);
    }
    return aus;
  }
  return [{ knoten: st, was: `a ${K[st.kind]} that runs while the module loads` }];
}

/** True for a statement of the rest that runs while the module loads. */
export function laeuftBeimLaden(st: ts.Node): boolean {
  if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st) || ts.isExportDeclaration(st)) return false;
  if (istNurTyp(st) || ts.isFunctionDeclaration(st)) return false;
  if (ts.isEmptyStatement(st)) return false;
  return true;
}

export function ladeSchluessel(name: string): string {
  return `laden:${name}`;
}

export function pruefeLaden(name: string, stueck: Stueck, alt: Datei, restAlt: readonly Stueck[], u: LadeUmgebung, p: Protokoll): void {
  p.zaehle('B9');
  const funde = wirkungenBeimLaden(stueck.knoten, u);
  if (funde.length === 0) return;
  // Only statements that act themselves can notice the new order: a constant built from literals cannot.
  const davor = restAlt.filter((s) => s.knoten.end <= stueck.knoten.getStart(alt.sf) && laeuftBeimLaden(s.knoten) && wirkungenBeimLaden(s.knoten, u).length > 0);
  const liste = davor.map((s) => `${ortVonKnoten(alt, s.knoten).zeile}: ${kurz(s.knoten.getText(alt.sf), 60)}`);
  const gruende = [...new Set(funde.map((f) => f.was))];
  p.melde({
    regel: 'B9',
    teil: 'laden',
    ort: ortVonKnoten(alt, funde[0]!.knoten),
    text:
      `"${name}" acts while its module loads: ${gruende.slice(0, 4).join('; ')}${gruende.length > 4 ? `; and ${gruende.length - 4} more` : ''}. ` +
      (liste.length === 0
        ? 'No statement of the rest that acts while loading ran before it in the old state.'
        : `${liste.length} statement(s) of the rest that act while loading ran BEFORE it in the old state and run AFTER it now (old line: text): ${liste.join(' | ')}`),
    freigabe: ladeSchluessel(name),
  });
}
