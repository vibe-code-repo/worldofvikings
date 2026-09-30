/**
 * Move proof, rule B5 for the forwarder: what stays in the class when a method moves.
 *
 * The forwarder stands at the place of the method, has its name and its signature, and its body is
 * exactly `return <name>(this, <parameters in their order>);`. The first argument is `this`
 * itself: not a copy, not another object, not an expression that does something on the way.
 *
 * The forwarder of an `async` method carries no `async`: it hands the promise of the function on
 * unchanged. `async m() { return f(this); }` would settle its promise some microtask steps later
 * than the method did, and that is a change of behaviour.
 */
import ts from 'typescript';
import { KnotenPaare, vergleicheListe, vergleicheWahlweise, type BaumOptionen } from './baum';
import { dekoratoren, modifikatoren } from './stuecke';
import { kurz, ortVonKnoten, type Datei, type Protokoll } from './typen';
import type { FormkPaar } from './zerlegung';

const K = ts.SyntaxKind;

export interface WeiterleitungsErgebnis {
  /** Visibility the forwarder lost against the method, or `null`. */
  gelockert: 'private' | 'protected' | null;
  /** Identifier pairs of the signature (old method against forwarder) and the map of their declarations. */
  bezeichner: { alt: ts.Node; neu: ts.Node }[];
  paare: KnotenPaare;
  /** The identifier the forwarder calls, if the body has the declared form. */
  aufgerufen: ts.Identifier | null;
}

export function pruefeWeiterleitung(paar: FormkPaar, alt: Datei, rest: Datei, p: Protokoll): WeiterleitungsErgebnis {
  const aus: WeiterleitungsErgebnis = { gelockert: null, bezeichner: [], paare: new KnotenPaare(), aufgerufen: null };
  const m = paar.alt.knoten;
  const w = paar.weiterleitung?.knoten;
  if (!w || !ts.isMethodDeclaration(m)) return aus;
  p.zaehle('B5');
  const melde = (teil: string, knoten: ts.Node, text: string): void => {
    p.melde({ regel: 'B5', teil: `weiterleitung-${teil}`, ort: ortVonKnoten(rest, knoten), text: `forwarder "${paar.name}": ${text}` });
  };
  if (!ts.isMethodDeclaration(w)) {
    melde('art', w, `is a ${K[w.kind]}, not a method (a field with an arrow function hangs on the instance, not on the prototype)`);
    return aus;
  }
  for (const d of dekoratoren(w)) melde('dekorator', d, 'carries a decorator: a decorator can replace the method');
  if (w.questionToken) melde('optional', w.questionToken, 'is declared optional with `?`');
  if (w.asteriskToken) melde('generator', w.asteriskToken, 'is a generator');

  // Modifiers: those of the method without `async`; `private` or `protected` may be dropped (judged with the context type).
  const altMod = modifikatoren(m).filter((x) => x.kind !== K.AsyncKeyword).map((x) => x.kind);
  const neuMod = modifikatoren(w).map((x) => x.kind);
  if (neuMod.includes(K.AsyncKeyword)) {
    melde('async', w, 'carries `async`: it must hand on the promise of the function unchanged');
  }
  const neuOhneAsync = neuMod.filter((k) => k !== K.AsyncKeyword);
  if (altMod.join() !== neuOhneAsync.join()) {
    const sichtbar = altMod.find((k) => k === K.PrivateKeyword || k === K.ProtectedKeyword);
    if (sichtbar !== undefined && altMod.filter((k) => k !== sichtbar).join() === neuOhneAsync.join()) {
      aus.gelockert = sichtbar === K.PrivateKeyword ? 'private' : 'protected';
    } else {
      melde('modifikator', w, `modifiers [${neuOhneAsync.map((k) => K[k]).join(', ')}] are not those of the method [${altMod.map((k) => K[k]).join(', ')}]`);
    }
  }

  if (!ts.isIdentifier(w.name) || !ts.isIdentifier(m.name) || w.name.getText(rest.sf) !== m.name.getText(alt.sf)) {
    melde('name', w.name, 'does not carry the name of the method as written');
    return aus;
  }
  aus.paare.setze(m.name, w.name, rest);
  aus.paare.setze(m, w, rest);
  aus.bezeichner.push({ alt: m.name, neu: w.name });

  const opt: BaumOptionen = { bezeichner: aus.bezeichner };
  const u =
    vergleicheListe(m.typeParameters ?? [], w.typeParameters ?? [], alt, rest, opt, aus.paare, 'number of type parameters') ??
    vergleicheListe(m.parameters, w.parameters, alt, rest, opt, aus.paare, 'number of parameters') ??
    vergleicheWahlweise(m.type, w.type, alt, rest, opt, aus.paare, 'return type');
  if (u) melde('signatur', u.neu ?? w, `signature is not that of the method: ${u.grund}`);

  // Body: exactly `return <name>(this, <parameters>);`
  if (!w.body) {
    melde('rumpf', w, 'has no body');
    return aus;
  }
  if (w.body.statements.length !== 1) {
    melde('rumpf', w.body, `has ${w.body.statements.length} statements instead of exactly one`);
    return aus;
  }
  const st = w.body.statements[0]!;
  if (!ts.isReturnStatement(st) || !st.expression) {
    melde('rumpf', st, `body is not \`return <call>;\` but ${K[st.kind]} "${kurz(st.getText(rest.sf), 50)}"`);
    return aus;
  }
  const ruf = st.expression;
  if (!ts.isCallExpression(ruf)) {
    melde('rumpf', ruf, `returns something else than the call of the function: "${kurz(ruf.getText(rest.sf), 50)}"`);
    return aus;
  }
  if (ruf.questionDotToken) melde('aufruf', ruf, 'calls with `?.`');
  if (!ts.isIdentifier(ruf.expression) || ruf.expression.getText(rest.sf) !== paar.name) {
    melde('aufruf', ruf.expression, `calls "${kurz(ruf.expression.getText(rest.sf), 50)}" instead of the function "${paar.name}" under its own name`);
  } else {
    aus.aufgerufen = ruf.expression;
  }
  if (ruf.typeArguments) {
    const soll = (m.typeParameters ?? []).map((t) => t.name.text);
    const ist = ruf.typeArguments.map((t) => t.getText(rest.sf));
    if (soll.join() !== ist.join()) melde('aufruf', ruf, `type arguments <${ist.join(', ')}> are not the type parameters <${soll.join(', ')}>`);
  }
  const argumente = ruf.arguments;
  const erstes = argumente[0];
  if (!erstes || erstes.kind !== K.ThisKeyword) {
    melde('kontext', erstes ?? ruf, `first argument is ${erstes ? `"${kurz(erstes.getText(rest.sf), 40)}"` : 'missing'} instead of exactly \`this\``);
  }
  const weitere = argumente.slice(1);
  if (weitere.length !== m.parameters.length) {
    melde('argumente', ruf, `passes ${weitere.length} arguments after \`this\`, the method has ${m.parameters.length} parameters`);
  } else {
    m.parameters.forEach((par, i) => {
      const a = weitere[i]!;
      if (!ts.isIdentifier(par.name)) return; // reported as unsupported (B12)
      const soll = par.name.text;
      const passt = par.dotDotDotToken
        ? ts.isSpreadElement(a) && ts.isIdentifier(a.expression) && a.expression.getText(rest.sf) === soll
        : ts.isIdentifier(a) && a.getText(rest.sf) === soll;
      if (!passt) melde('argumente', a, `argument ${i + 1} is "${kurz(a.getText(rest.sf), 40)}", expected "${par.dotDotDotToken ? '...' : ''}${soll}" (parameters unchanged, in their order)`);
    });
  }
  return aus;
}
