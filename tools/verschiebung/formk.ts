/**
 * Move proof, form k: a method of a class becomes a function with a context parameter.
 *
 * This module answers three questions about the OLD method and compares it with the NEW function:
 *  - which `this` belong to the method (they become the context parameter),
 *  - which constructs the form does not support (rule B12),
 *  - is the function the method, apart from the declared replacements (rule B3).
 */
import ts from 'typescript';
import { KnotenPaare, vergleicheBaum, vergleicheListe, vergleicheWahlweise, type BaumOptionen, type BaumUnterschied } from './baum';
import { dekoratoren, hatModifikator, modifikatoren } from './stuecke';
import { kurz, ortVonKnoten, type Datei, type KontextAngabe, type Protokoll } from './typen';
import type { FormkPaar } from './zerlegung';

const K = ts.SyntaxKind;

/** Nodes that give `this`, `arguments` and `new.target` a new meaning. Arrow functions do not. */
export function bindetThisNeu(n: ts.Node): boolean {
  return (
    ts.isFunctionExpression(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isClassLike(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isClassStaticBlockDeclaration(n) ||
    ts.isModuleDeclaration(n)
  );
}

/** The parts of a method in which its own `this` can occur. */
function teile(m: ts.MethodDeclaration): ts.Node[] {
  return [...(m.typeParameters ?? []), ...m.parameters, ...(m.type ? [m.type] : []), ...(m.body ? [m.body] : [])];
}

/**
 * Walks the parts of a method without entering nodes that bind `this` anew. What such a node
 * evaluates in the scope around it (computed names, decorators, `extends`) still belongs to the method.
 */
function eigeneKnoten(m: ts.MethodDeclaration, besuch: (n: ts.Node) => void): void {
  const geh = (n: ts.Node): void => {
    besuch(n);
    if (!bindetThisNeu(n)) {
      ts.forEachChild(n, geh);
      return;
    }
    // The parts that are evaluated around the binder are walked, the rest is not.
    if (ts.isClassLike(n)) {
      for (const h of n.heritageClauses ?? []) if (h.token === K.ExtendsKeyword) geh(h);
      for (const d of ts.getDecorators(n) ?? []) geh(d);
      for (const mem of n.members) {
        for (const d of ts.getDecorators(mem as ts.HasDecorators) ?? []) geh(d);
        const name = (mem as ts.NamedDeclaration).name;
        if (name && ts.isComputedPropertyName(name)) geh(name);
      }
    } else if (ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) {
      for (const d of ts.getDecorators(n) ?? []) geh(d);
      if (ts.isComputedPropertyName(n.name)) geh(n.name);
    }
  };
  for (const t of teile(m)) geh(t);
}

/** True for `this` as an expression and for the `this` of `typeof this.x`, which the parser keeps as an identifier. */
export function istThis(n: ts.Node): boolean {
  return n.kind === K.ThisKeyword || (ts.isIdentifier(n) && n.text === 'this');
}

/**
 * True if the node `kind` (a child of `a`) is evaluated in the scope AROUND `a`, not in the one `a` opens:
 * the computed name of a member, a decorator, the `extends` clause of a class (rule 2.2 of form k).
 */
function istAeussererTeil(a: ts.Node, kind: ts.Node): boolean {
  if (ts.isClassLike(a)) return ts.isDecorator(kind) || (ts.isHeritageClause(kind) && kind.token === K.ExtendsKeyword);
  if (ts.isMethodDeclaration(a) || ts.isGetAccessorDeclaration(a) || ts.isSetAccessorDeclaration(a) || ts.isPropertyDeclaration(a) || ts.isConstructorDeclaration(a)) {
    return ts.isDecorator(kind) || (ts.isComputedPropertyName(kind) && (a as ts.NamedDeclaration).name === kind);
  }
  return false;
}

/**
 * Walks up from a node to the border and answers whether a node that binds `this` anew stands on the
 * way. A part that is evaluated around a binder (computed name, decorator, `extends`) does not count,
 * and neither does the class whose member the part belongs to. `aussen` is set when the way led through
 * such a part of a member: the next class is then not passed as a binder either.
 */
function bindetAufDemWeg(n: ts.Node, grenzen: ReadonlySet<ts.Node>): boolean {
  let aussen = false;
  for (let k: ts.Node = n, a: ts.Node | undefined = n.parent; a && !grenzen.has(k); k = a, a = a.parent) {
    if (istAeussererTeil(a, k)) {
      aussen = ts.isClassElement(a) || ts.isObjectLiteralElement(a);
      continue;
    }
    if (aussen && ts.isClassLike(a)) {
      aussen = false;
      continue;
    }
    aussen = false;
    if (bindetThisNeu(a)) return true;
  }
  return false;
}

/** Every `this` that belongs to the method: found by walking UP from each `this` of the text. */
export function gebundenesThis(m: ts.MethodDeclaration): Set<ts.Node> {
  const aus = new Set<ts.Node>();
  const grenzen = new Set<ts.Node>(teile(m));
  const geh = (n: ts.Node): void => {
    if (istThis(n) && !bindetAufDemWeg(n, grenzen)) aus.add(n);
    ts.forEachChild(n, geh);
  };
  for (const t of teile(m)) geh(t);
  return aus;
}

/** Role of an identifier: does it name a variable, or is it a label or the name of a member? */
export function istVariablenname(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === id) return false;
  if ((ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === id) return false;
  if (ts.isEnumMember(p) && p.name === id) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isJsxAttribute(p) && p.name === id) return false;
  if (ts.isNamedTupleMember(p) && p.name === id) return false;
  if (ts.isMetaProperty(p)) return false;
  return true;
}

/** True if the node stands in a type, so that it needs no value at run time. */
export function stehtImTyp(n: ts.Node, bis: ts.Node): boolean {
  for (let a: ts.Node | undefined = n.parent; a && a !== bis; a = a.parent) {
    if (ts.isTypeNode(a)) return true;
    if (ts.isHeritageClause(a) && a.token === K.ImplementsKeyword) return true;
    if (ts.isTypeParameterDeclaration(a) || ts.isInterfaceDeclaration(a) || ts.isTypeAliasDeclaration(a)) return true;
  }
  return false;
}

const WIRKUNG_ZUWEISUNG = new Set<ts.SyntaxKind>([
  K.EqualsToken, K.PlusEqualsToken, K.MinusEqualsToken, K.AsteriskEqualsToken, K.AsteriskAsteriskEqualsToken, K.SlashEqualsToken, K.PercentEqualsToken,
  K.LessThanLessThanEqualsToken, K.GreaterThanGreaterThanEqualsToken, K.GreaterThanGreaterThanGreaterThanEqualsToken, K.AmpersandEqualsToken, K.BarEqualsToken,
  K.CaretEqualsToken, K.BarBarEqualsToken, K.AmpersandAmpersandEqualsToken, K.QuestionQuestionEqualsToken,
]);

/**
 * First thing in an expression that acts when the expression is evaluated, or `null`. A function
 * is a value: neither its body nor the default values of its parameters run when it is written down.
 */
export function ersteWirkung(ausdruck: ts.Node): { knoten: ts.Node; was: string } | null {
  let fund: { knoten: ts.Node; was: string } | null = null;
  const geh = (n: ts.Node): void => {
    if (fund) return;
    if (ts.isFunctionLike(n)) return;
    if (ts.isClassLike(n)) {
      fund = { knoten: n, was: 'a class' };
      return;
    }
    if (ts.isCallExpression(n)) fund = { knoten: n, was: 'a call' };
    else if (ts.isNewExpression(n)) fund = { knoten: n, was: '`new`' };
    else if (ts.isTaggedTemplateExpression(n)) fund = { knoten: n, was: 'a tagged template (a call)' };
    else if (ts.isAwaitExpression(n)) fund = { knoten: n, was: '`await`' };
    else if (ts.isYieldExpression(n)) fund = { knoten: n, was: '`yield`' };
    else if (ts.isDeleteExpression(n)) fund = { knoten: n, was: '`delete`' };
    else if (ts.isBinaryExpression(n) && WIRKUNG_ZUWEISUNG.has(n.operatorToken.kind)) fund = { knoten: n, was: 'an assignment' };
    else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken)) fund = { knoten: n, was: '`++` or `--`' };
    if (!fund) ts.forEachChild(n, geh);
  };
  geh(ausdruck);
  return fund;
}

/** What the default value of a parameter does that a forwarder cannot pass on: read `this` or yield `undefined`. `null` if nothing. */
export function vorgabeProblem(ausdruck: ts.Node): { knoten: ts.Node; was: string } | null {
  let fund: { knoten: ts.Node; was: string } | null = null;
  const geh = (n: ts.Node): void => {
    if (fund || ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    if (istThis(n)) fund = { knoten: n, was: 'reads `this`' };
    else ts.forEachChild(n, geh);
  };
  geh(ausdruck);
  if (fund) return fund;
  const undef = (e: ts.Expression): ts.Node | null => {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) return undef(e.expression);
    if (ts.isIdentifier(e) && e.text === 'undefined') return e;
    if (ts.isVoidExpression(e)) return e;
    if (ts.isConditionalExpression(e)) return undef(e.whenTrue) ?? undef(e.whenFalse);
    if (ts.isBinaryExpression(e)) {
      const t = e.operatorToken.kind;
      if (t === K.QuestionQuestionToken || t === K.BarBarToken || t === K.AmpersandAmpersandToken) return undef(e.left) ?? undef(e.right);
      if (t === K.CommaToken) return undef(e.right);
    }
    return null;
  };
  const u = ausdruck as ts.Expression;
  const k = undef(u);
  return k ? { knoten: k, was: 'can yield `undefined`' } : null;
}

/** True if `this` stands in a part that a nested class or member evaluates around itself (computed name, decorator, `extends`). */
function thisImAeusserenTeil(n: ts.Node, m: ts.MethodDeclaration): boolean {
  for (let k: ts.Node = n, a: ts.Node | undefined = n.parent; a && a !== m; k = a, a = a.parent) {
    if (ts.isComputedPropertyName(k) && (ts.isMethodDeclaration(a) || ts.isGetAccessorDeclaration(a) || ts.isSetAccessorDeclaration(a) || ts.isPropertyDeclaration(a))) return true;
    if (ts.isHeritageClause(k) && ts.isClassLike(a) && k.token === K.ExtendsKeyword) return true;
    if (ts.isDecorator(k)) return true;
  }
  return false;
}

/** True if `this` (the keyword) is not the receiver of a member access: `return this`, `f(this)`, `o === this`. */
function thisAlsWert(n: ts.Node): boolean {
  if (n.kind !== K.ThisKeyword) return false;
  let k: ts.Node = n;
  while (k.parent && (ts.isParenthesizedExpression(k.parent) || ts.isNonNullExpression(k.parent))) k = k.parent;
  const p = k.parent;
  return !(p && (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === k);
}

/** Rule B12 for form k: constructs of the old method the form does not support. */
export function pruefeUnterstuetzt(paar: { name: string; alt: { knoten: ts.Node } }, alt: Datei, klasse: string, kontext: KontextAngabe, p: Protokoll): void {
  const m = paar.alt.knoten;
  const melde = (teil: string, knoten: ts.Node, text: string, freigabe?: string): void => {
    p.melde({ regel: 'B12', teil, ort: ortVonKnoten(alt, knoten), text: `method "${paar.name}": ${text}`, ...(freigabe ? { freigabe } : {}) });
  };
  p.zaehle('B12');
  if (!ts.isMethodDeclaration(m)) {
    const was = ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m) ? 'an accessor' : ts.isPropertyDeclaration(m) ? 'a field (a field with an arrow function is not a method)' : ts.isConstructorDeclaration(m) ? 'the constructor' : K[m.kind];
    melde('keine-methode', m, `is ${was}: form k moves methods only`);
    return;
  }
  if (!m.body) melde('ueberladung', m, 'has no body (overload signature): not supported');
  if (m.asteriskToken) melde('generator', m, 'is a generator: not supported');
  if (m.questionToken) melde('optional', m, 'is an optional method: not supported');
  if (!ts.isIdentifier(m.name)) melde('name', m.name, `has the name ${kurz(m.name.getText(alt.sf))}: private names with # and computed names are not supported`);
  for (const mod of modifikatoren(m)) {
    if (mod.kind === K.StaticKeyword) melde('static', mod, 'is static: not supported');
    else if (mod.kind !== K.PrivateKeyword && mod.kind !== K.ProtectedKeyword && mod.kind !== K.PublicKeyword && mod.kind !== K.AsyncKeyword) {
      melde('modifikator', mod, `carries \`${mod.getText(alt.sf)}\`: not supported`);
    }
  }
  for (const d of dekoratoren(m)) melde('dekorator', d, 'carries a decorator: not supported');
  for (const par of m.parameters) {
    if (!ts.isIdentifier(par.name)) melde('parametermuster', par, `parameter ${kurz(par.name.getText(alt.sf), 30)} is a pattern: a forwarder cannot pass it on unchanged`);
    else if (par.name.text === 'this') melde('this-parameter', par, 'declares a `this` parameter: not supported');
    if (par.initializer) {
      const w = ersteWirkung(par.initializer);
      const pn = ts.isIdentifier(par.name) ? par.name.text : '?';
      if (w) melde('vorgabe', w.knoten, `default value of parameter "${pn}" contains ${w.was}: it would be evaluated in the forwarder and in the function`, `vorgabe:${paar.name}.${pn}`);
      const v = vorgabeProblem(par.initializer);
      if (v) melde('vorgabe-this-undefined', v.knoten, `default value of parameter "${pn}" ${v.was}: if the forwarder passes \`undefined\` on, the function evaluates its own default value a second time`);
    }
  }
  eigeneKnoten(m, (n) => {
    if (n.kind === K.SuperKeyword) melde('super', n, 'uses `super`: not supported');
    else if (ts.isMetaProperty(n) && n.keywordToken === K.NewKeyword) melde('new-target', n, 'uses `new.target`: not supported');
    else if (ts.isThisTypeNode(n)) melde('this-typ', n, 'uses the type `this`: a function has none');
    else if (istThis(n) && thisImAeusserenTeil(n, m)) melde('this-im-namen', n, 'uses `this` in a computed name, a decorator or an `extends` clause of a nested class or member: it belongs to the method, and form k does not support it');
    else if (thisAlsWert(n)) melde('this-wert', n, 'uses `this` as a value (not as the receiver of a member access): the context type cannot stand for it');
    else if (ts.isPrivateIdentifier(n)) melde('privater-name', n, `uses the private name ${n.text}: it cannot be reached from outside the class`);
    else if (ts.isIdentifier(n) && n.text === kontext.parameter) melde('kontextname', n, `the name "${kontext.parameter}" of the context parameter already occurs in the method (as a variable, a member or a label): choose another one in the manifest`);
    else if (ts.isIdentifier(n) && n.text !== 'this' && istVariablenname(n)) {
      if (n.text === 'arguments' && !ts.isParameter(n.parent) && !ts.isVariableDeclaration(n.parent)) melde('arguments', n, 'uses `arguments`: in the function the context parameter counts as well');
      else if (n.text === klasse && !stehtImTyp(n, m)) melde('klassenbezug', n, `refers to the class "${klasse}" as a value (static member or constructor): the target file must not import the source file as a value`);
    }
  });
  // A private name or the context name inside a nested function or class is still a finding: look there too.
  const tief = (n: ts.Node): void => {
    if (bindetThisNeu(n)) {
      const innen = (x: ts.Node): void => {
        if (ts.isIdentifier(x) && x.text === kontext.parameter) melde('kontextname', x, `the name "${kontext.parameter}" of the context parameter already occurs in the method (as a variable, a member or a label): choose another one in the manifest`);
        else if (ts.isIdentifier(x) && istVariablenname(x) && x.text === klasse && !stehtImTyp(x, m)) melde('klassenbezug', x, `refers to the class "${klasse}" as a value: the target file must not import the source file as a value`);
        else if (ts.isPrivateIdentifier(x)) melde('privater-name', x, `uses the private name ${x.text}: it cannot be reached from outside the class`);
        ts.forEachChild(x, innen);
      };
      ts.forEachChild(n, innen);
      return;
    }
    ts.forEachChild(n, tief);
  };
  for (const t of teile(m)) tief(t);
}

export interface FormkVergleich {
  unterschied: BaumUnterschied | null;
  knoten: number;
  /** Number of `this` that became the context parameter. */
  ersetzt: number;
}

/**
 * Rule B3 for form k: the function is the method with `this` replaced, the context parameter in
 * front, visibility dropped and `export` allowed. Everything else is compared node by node.
 */
export function vergleicheFormK(paar: FormkPaar, alt: Datei, ziel: Datei, kontext: KontextAngabe, paare: KnotenPaare | null, bezeichner: { alt: ts.Node; neu: ts.Node }[] | undefined): FormkVergleich {
  const m = paar.alt.knoten;
  const f = paar.neu.knoten;
  const zaehler = { knoten: 0 };
  const fertig = (u: BaumUnterschied | null, ersetzt = 0): FormkVergleich => ({ unterschied: u, knoten: zaehler.knoten, ersetzt });
  if (!ts.isMethodDeclaration(m) || !ts.isFunctionDeclaration(f)) return fertig({ alt: m, neu: f, grund: 'form k needs a method in the old state and a function declaration in the target file' });
  const gebunden = gebundenesThis(m);
  const opt: BaumOptionen = { thisZuKontext: { kontext: kontext.parameter, gebunden }, zaehler, ...(bezeichner ? { bezeichner } : {}) };

  // Modifiers: visibility is dropped, everything else stays (in practice: `async`). No `export` in
  // front of the function: what other files need stands in the export list at the end of the file.
  const modAlt = modifikatoren(m).filter((x) => x.kind !== K.PrivateKeyword && x.kind !== K.ProtectedKeyword && x.kind !== K.PublicKeyword).map((x) => x.kind);
  const modNeu = modifikatoren(f).map((x) => x.kind);
  zaehler.knoten += modAlt.length + 1;
  if (modAlt.join() !== modNeu.join()) {
    return fertig({ alt: m, neu: f, grund: `modifiers differ: method [${modAlt.map((k) => K[k]).join(', ')}] (visibility left out) against function [${modNeu.map((k) => K[k]).join(', ')}]` });
  }
  if (dekoratoren(f).length > 0) return fertig({ alt: m, neu: f, grund: 'the function carries a decorator' });
  if (hatModifikator(f, K.DefaultKeyword)) return fertig({ alt: m, neu: f, grund: 'the function is a default export' });
  if (!!m.asteriskToken !== !!f.asteriskToken) return fertig({ alt: m, neu: f, grund: 'generator star differs' });
  if (!f.name || !ts.isIdentifier(m.name) || f.name.text !== m.name.text || f.name.getText(ziel.sf) !== m.name.getText(alt.sf)) {
    return fertig({ alt: m.name, neu: f.name ?? f, grund: 'name of the function is not the name of the method' });
  }
  // The name of the method is NOT paired with the name of the function: as a member of the class
  // the method corresponds to its forwarder (`weiterleitung.ts`).
  let u = vergleicheListe(m.typeParameters ?? [], f.typeParameters ?? [], alt, ziel, opt, paare, 'number of type parameters');
  if (u) return fertig(u);

  const k = f.parameters[0];
  if (!k || !ts.isIdentifier(k.name) || k.name.text !== kontext.parameter) {
    return fertig({ alt: m, neu: k ?? f, grund: `first parameter of the function is not the context parameter "${kontext.parameter}"` });
  }
  if (k.initializer || k.questionToken || k.dotDotDotToken || modifikatoren(k).length > 0 || dekoratoren(k).length > 0) {
    return fertig({ alt: m, neu: k, grund: 'the context parameter carries a default value, `?`, `...`, a modifier or a decorator' });
  }
  if (!k.type || !ts.isTypeReferenceNode(k.type) || !ts.isIdentifier(k.type.typeName) || k.type.typeName.text !== kontext.typ) {
    return fertig({ alt: m, neu: k, grund: `the context parameter is not typed with the context type "${kontext.typ}" named in the manifest (found ${k.type ? `"${kurz(k.type.getText(ziel.sf), 40)}"` : 'no type'})` });
  }
  u = vergleicheListe(m.parameters, f.parameters.slice(1), alt, ziel, opt, paare, 'number of parameters after the context parameter');
  if (u) return fertig(u);
  u = vergleicheWahlweise(m.type, f.type, alt, ziel, opt, paare, 'return type');
  if (u) return fertig(u);
  u = vergleicheWahlweise(m.body, f.body, alt, ziel, opt, paare, 'body');
  if (u) return fertig(u);
  return fertig(null, gebunden.size);
}

/** Rule B3 for a piece that is byte-identical or moved verbatim: the trees are compared as they are. */
export function vergleicheWoertlich(alt: ts.Node, neu: ts.Node, altDatei: Datei, neuDatei: Datei, paare: KnotenPaare | null, bezeichner: { alt: ts.Node; neu: ts.Node }[] | undefined): { unterschied: BaumUnterschied | null; knoten: number } {
  const zaehler = { knoten: 0 };
  const unterschied = vergleicheBaum(alt, neu, altDatei, neuDatei, { zaehler, ...(bezeichner ? { bezeichner } : {}) }, paare);
  return { unterschied, knoten: zaehler.knoten };
}
