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
import type { Deskriptor } from './bindung';
import { kurz, ortVon, ortVonKnoten, type Datei, type Protokoll, type Stueck } from './typen';

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

/** What a piece of code mentions: the names it reads, the member names it touches and whether it reaches members dynamically. */
interface Bereich {
  /** Names of variables the code mentions in any way (call, value, `.call`, `new`, ...): each may be a call. */
  bezuege: Set<string>;
  /** Names of members the code touches (`x.m`, `x['m']`, `{ m } = x`). */
  glieder: Set<string>;
  /** True after a member access with a computed name: every member may be reached. */
  alleGlieder: boolean;
}

const neuerBereich = (): Bereich => ({ bezuege: new Set(), glieder: new Set(), alleGlieder: false });

function auspacken(e: ts.Node): ts.Node {
  let a = e;
  while (ts.isParenthesizedExpression(a) || ts.isAsExpression(a) || ts.isSatisfiesExpression(a) || ts.isNonNullExpression(a) || ts.isTypeAssertionExpression(a)) a = a.expression;
  return a;
}

const istFunktionsWert = (e: ts.Node): boolean => ts.isArrowFunction(auspacken(e)) || ts.isFunctionExpression(auspacken(e));

/** The value of a variable (function or class), of an object property or of a class field: a unit of its own, not run by the statement that holds it. */
function istEinheitswert(f: ts.Node): boolean {
  let k: ts.Node = f;
  let p = k.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression(p))) {
    k = p;
    p = p.parent;
  }
  if (!p) return false;
  if (ts.isVariableDeclaration(p) && p.initializer === k && ts.isIdentifier(p.name)) return true;
  if (ts.isClassLike(f)) return false;
  return (ts.isPropertyAssignment(p) && p.initializer === k) || (ts.isPropertyDeclaration(p) && p.initializer === k);
}

/** Records what a node itself mentions (not its children). */
function erfasse(x: ts.Node, b: Bereich, liest?: Set<string>): void {
  if (ts.isIdentifier(x) && istVariablenname(x)) {
    const p = x.parent;
    const istDeklaration = (ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isParameter(p) || ts.isClassLike(p) || ts.isFunctionLike(p)) && (p as ts.NamedDeclaration).name === x;
    if (!istDeklaration) {
      b.bezuege.add(x.text);
      liest?.add(x.text);
    }
  }
  if (ts.isPropertyAccessExpression(x)) b.glieder.add(x.name.text);
  else if (ts.isElementAccessExpression(x)) {
    const a = x.argumentExpression;
    if (ts.isStringLiteralLike(a) || ts.isNumericLiteral(a)) b.glieder.add(a.text);
    else b.alleGlieder = true;
  } else if (ts.isBindingElement(x) && ts.isObjectBindingPattern(x.parent)) {
    const k = x.propertyName ?? x.name;
    if (ts.isIdentifier(k) || ts.isStringLiteralLike(k)) b.glieder.add(k.text);
    else b.alleGlieder = true;
  }
}

/** A unit: its code and the variable names it READS (the subset of `bezuege` that is not a declaration). */
interface Einheit extends Bereich {
  liest: Set<string>;
}

const neueEinheit = (): Einheit => ({ ...neuerBereich(), liest: new Set() });

/** The whole subtree, nested functions and classes included: what a call of the unit may do. */
function ganz(n: ts.Node, b: Einheit): void {
  const geh = (x: ts.Node): void => {
    if (ts.isTypeNode(x)) return;
    erfasse(x, b, b.liest);
    ts.forEachChild(x, geh);
  };
  geh(n);
}

/**
 * The code of a class that runs when the class is defined (`extends`, decorators, computed names, static
 * initial values and blocks), and with `voll` also what runs at `new` (constructor, instance fields).
 * Methods and accessors are units of their own, reached by their names.
 */
function klassenCode(k: ts.ClassLikeDeclaration, b: Einheit, voll: boolean): void {
  for (const d of dekoratoren(k)) ganz(d, b);
  for (const h of k.heritageClauses ?? []) if (h.token === K.ExtendsKeyword) for (const t of h.types) ganz(t.expression, b);
  for (const m of k.members) {
    for (const d of dekoratoren(m)) ganz(d, b);
    const name = (m as ts.NamedDeclaration).name;
    if (name && ts.isComputedPropertyName(name)) ganz(name, b);
    if (ts.isClassStaticBlockDeclaration(m)) ganz(m.body, b);
    else if (ts.isPropertyDeclaration(m) && m.initializer) {
      if (istFunktionsWert(m.initializer) && istEinheitswert(m.initializer)) continue;
      if (voll || hatModifikator(m, K.StaticKeyword)) ganz(m.initializer, b);
    } else if (voll && ts.isConstructorDeclaration(m)) ganz(m, b);
  }
}

const istGliedEinheit = (x: ts.Node): x is ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration =>
  ts.isMethodDeclaration(x) || ts.isGetAccessorDeclaration(x) || ts.isSetAccessorDeclaration(x);

function gliedSchluessel(name: ts.PropertyName | undefined): string {
  if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name))) return name.text;
  return '*';
}

/** What a statement of the module level does while the module loads: everything but the bodies of units. */
function ladeCode(st: ts.Node, b: Einheit): void {
  const geh = (x: ts.Node): void => {
    if (ts.isTypeNode(x)) return;
    if (ts.isFunctionDeclaration(x)) return;
    if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) {
      if (!istEinheitswert(x)) ganz(x, b); // an IIFE, a callback, an argument: it may run
      return;
    }
    if (istGliedEinheit(x) && ts.isObjectLiteralExpression(x.parent)) {
      if (ts.isComputedPropertyName(x.name)) ganz(x.name, b);
      return;
    }
    if (ts.isClassLike(x)) {
      const benannt = (ts.isClassDeclaration(x) && x.name !== undefined) || istEinheitswert(x);
      if (benannt) klassenCode(x, b, false);
      else ganz(x, b); // an anonymous class written inline may be instantiated at once
      return;
    }
    erfasse(x, b, b.liest);
    ts.forEachChild(x, geh);
  };
  geh(st);
}

interface Index {
  benannt: Map<string, Einheit>;
  glieder: Map<string, Einheit>;
}

const indexSpeicher = new WeakMap<readonly Stueck[], Index>();

/** Every function, class and member of the old file as a unit: by name, and by member name. Nested ones included. */
function baueIndex(alle: readonly Stueck[]): Index {
  const gemerkt = indexSpeicher.get(alle);
  if (gemerkt) return gemerkt;
  const index: Index = { benannt: new Map(), glieder: new Map() };
  const eintrag = (m: Map<string, Einheit>, key: string): Einheit => {
    let e = m.get(key);
    if (!e) m.set(key, (e = neueEinheit()));
    return e;
  };
  const geh = (x: ts.Node): void => {
    if (ts.isTypeNode(x)) return;
    if (ts.isFunctionDeclaration(x) && x.name) ganz(x, eintrag(index.benannt, x.name.text));
    else if (ts.isClassDeclaration(x) && x.name) klassenCode(x, eintrag(index.benannt, x.name.text), true);
    else if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer) {
      const i = auspacken(x.initializer);
      if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) ganz(i, eintrag(index.benannt, x.name.text));
      else if (ts.isClassExpression(i)) klassenCode(i, eintrag(index.benannt, x.name.text), true);
    } else if (istGliedEinheit(x)) ganz(x, eintrag(index.glieder, gliedSchluessel(x.name)));
    else if ((ts.isPropertyAssignment(x) || ts.isPropertyDeclaration(x)) && x.initializer && istFunktionsWert(x.initializer)) ganz(x.initializer, eintrag(index.glieder, gliedSchluessel(x.name)));
    ts.forEachChild(x, geh);
  };
  for (const s of alle) geh(s.knoten);
  indexSpeicher.set(alle, index);
  return index;
}

/**
 * Rule B9, part two: the REST can read a moved name while the module loads, at a place in front of the
 * old declaration. The proof is conservative and works on names, not on calls: it starts from what a
 * statement of the rest does while loading and follows EVERY mention of a function, class or variable
 * of the old file (a call, `.call`, parentheses, `new`, a value passed on), every member name that is
 * touched (`x.m()`, `x.m`, a getter, `{ m } = x`) and every computed member access (then all members),
 * `extends` expressions, static blocks, field initial values, default values and inline functions.
 * The old order failed there (`ReferenceError`) or saw an unset value; the new order sees the value.
 * It gives findings too many rather than one too few; a release `lesen:<name>` covers all sites listed.
 */
export function pruefeLesenVorDerStelle(name: string, stueck: Stueck, alt: Datei, alle: readonly Stueck[], restAlt: readonly Stueck[], p: Protokoll): void {
  const st = stueck.knoten;
  if (istNurTyp(st) || ts.isFunctionDeclaration(st)) return; // functions are hoisted: no change
  p.zaehle('B9');
  const start = st.getStart(alt.sf);
  const index = baueIndex(alle);
  for (const s of restAlt) {
    if (s.knoten.end > start || !laeuftBeimLaden(s.knoten)) continue;
    const wurzel = neueEinheit();
    ladeCode(s.knoten, wurzel);
    const leser: string[] = [];
    if (wurzel.liest.has(name)) leser.push('directly');
    // Breadth first over the units the statement can reach; `kette` remembers the way to each.
    const kette = new Map<Einheit, string>();
    const warte: Einheit[] = [wurzel];
    const erreiche = (e: Einheit | undefined, bezeichnung: string, von: Einheit): void => {
      if (!e || e === wurzel || kette.has(e)) return;
      const vorher = kette.get(von);
      kette.set(e, vorher === undefined ? bezeichnung : `${vorher} -> ${bezeichnung}`);
      warte.push(e);
      if (e.liest.has(name)) leser.push(`through ${kette.get(e)}`);
    };
    for (let i = 0; i < warte.length; i++) {
      const e = warte[i]!;
      for (const n of e.bezuege) erreiche(index.benannt.get(n), n, e);
      for (const g of e.glieder) erreiche(index.glieder.get(g), `.${g}`, e);
      // A member with a computed name may carry any name: every member access may reach it.
      if (e.glieder.size > 0) erreiche(index.glieder.get('*'), '.[computed]', e);
      if (e.alleGlieder) for (const [g, u] of index.glieder) erreiche(u, `.${g}`, e);
    }
    if (leser.length === 0) continue;
    p.melde({
      regel: 'B9',
      teil: 'lesen-vor-der-stelle',
      ort: ortVonKnoten(alt, s.knoten),
      text:
        `"${name}" moves, but the statement of the rest at old line ${ortVonKnoten(alt, s.knoten).zeile} (${kurz(s.knoten.getText(alt.sf), 50)}) can read it while the module loads ` +
        `(${leser.slice(0, 4).join('; ')}${leser.length > 4 ? `; and ${leser.length - 4} more` : ''}), before its old place (old line ${ortVonKnoten(alt, st).zeile}): ` +
        'the old order failed or saw an unset value there, the new order sees the value',
      freigabe: `lesen:${name}`,
    });
  }
}

/** A place where the rest assigns to a name that is also the name of a moved `let` or `var`: whether it is THE moved variable the binding decides. */
export interface Zuweisung {
  name: string;
  art: 'let' | 'var';
  /** The identifier that is assigned to. */
  ziel: { pos: number; end: number };
  zeile: number;
  /** The identifiers that declare the moved variable. */
  deklariert: { pos: number; end: number }[];
}

/** Takes `(x)`, `x as T`, `<T>x`, `x satisfies T` and `x!` off an assignment target. */
const zielKern = (e: ts.Node): ts.Node => auspacken(e);

/**
 * Rule B12 (form 0), first half: every place where the rest assigns to a name equal to that of a moved
 * `let` or `var`, through any cast, parentheses, `!`, compound assignment, `++`/`--`, destructuring or
 * `for-in/of`. Whether the name there is the moved variable is decided with the old program
 * (`pruefeZuweisungen`): a local variable of the same name is another binding.
 */
export function sammleZuweisungenAusDemRest(name: string, stueck: Stueck, alt: Datei, restAlt: readonly Stueck[], p: Protokoll): Zuweisung[] {
  const st = stueck.knoten;
  if (!ts.isVariableStatement(st) || (st.declarationList.flags & ts.NodeFlags.Const) !== 0) return [];
  p.zaehle('B12');
  const deklariert: ts.Identifier[] = [];
  const findeName = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === name && istVariablenname(n)) deklariert.push(n);
    else if (ts.isBindingElement(n)) findeName(n.name);
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) n.elements.forEach((x) => (ts.isOmittedExpression(x) ? undefined : findeName(x)));
  };
  for (const d of st.declarationList.declarations) findeName(d.name);
  const art = (st.declarationList.flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
  const aus: Zuweisung[] = [];
  const ziele = (e: ts.Node, gefunden: ts.Identifier[]): void => {
    const k = zielKern(e);
    if (ts.isIdentifier(k)) gefunden.push(k);
    else if (ts.isArrayLiteralExpression(k)) k.elements.forEach((x) => ziele(ts.isSpreadElement(x) ? x.expression : x, gefunden));
    else if (ts.isObjectLiteralExpression(k)) {
      for (const x of k.properties) {
        if (ts.isPropertyAssignment(x)) ziele(x.initializer, gefunden);
        else if (ts.isShorthandPropertyAssignment(x)) gefunden.push(x.name);
        else if (ts.isSpreadAssignment(x)) ziele(x.expression, gefunden);
      }
    }
  };
  const geh = (n: ts.Node): void => {
    const gefunden: ts.Identifier[] = [];
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= K.FirstAssignment && n.operatorToken.kind <= K.LastAssignment) ziele(n.left, gefunden);
    else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken)) ziele(n.operand, gefunden);
    else if ((ts.isForInStatement(n) || ts.isForOfStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) ziele(n.initializer, gefunden);
    for (const x of gefunden) {
      if (x.text === name) aus.push({ name, art, ziel: { pos: x.pos, end: x.end }, zeile: ortVonKnoten(alt, x).zeile, deklariert: deklariert.map((d) => ({ pos: d.pos, end: d.end })) });
    }
    ts.forEachChild(n, geh);
  };
  for (const s of restAlt) {
    if (istNurTyp(s.knoten)) continue;
    geh(s.knoten);
  }
  return aus;
}

/**
 * Rule B12 (form 0), second half: a place found by `sammleZuweisungenAusDemRest` is a finding if its name
 * is bound to the moved variable (same declaration in the old program). A name that cannot be resolved counts.
 */
export function pruefeZuweisungen(zuweisungen: readonly Zuweisung[], antworten: ReadonlyMap<string, Deskriptor>, alt: Datei, p: Protokoll): void {
  const gemeldet = new Set<string>();
  for (const z of zuweisungen) {
    if (gemeldet.has(z.name)) continue;
    const ziel = antworten.get(`${z.ziel.pos}:${z.ziel.end}`);
    const deklarationen = z.deklariert.map((d) => antworten.get(`${d.pos}:${d.end}`));
    const aufgeloest = ziel !== undefined && ziel.art === 'symbol' && deklarationen.length > 0 && deklarationen.every((d) => d !== undefined && d.art === 'symbol');
    const selbe = aufgeloest && deklarationen.some((d) => d!.dekl.some((x) => ziel.dekl.some((y) => y.pos === x.pos && y.end === x.end && y.datei === x.datei)));
    if (aufgeloest && !selbe) continue; // another binding of the same name (a local variable, a parameter)
    gemeldet.add(z.name);
    p.melde({
      regel: 'B12',
      teil: 'veraenderliche-variable',
      ort: ortVon(alt, z.ziel.pos),
      text: `"${z.name}" is a \`${z.art}\` that moves, and the rest assigns to it (old line ${z.zeile}): after the move the rest holds an import, which cannot be assigned`,
    });
  }
}
