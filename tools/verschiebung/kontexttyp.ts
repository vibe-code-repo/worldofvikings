/**
 * Move proof, rule B5 with the type checker: the context type, the call of the forwarder and the
 * loosened modifiers.
 *
 * The context `k` is the instance itself. Its type is a `Pick` on the class or the class. `any`,
 * `unknown`, `object`, a type with an index signature or a type whose members are not declared
 * by the class is a finding: the type checker would no longer see what the moved code touches.
 * This is decided by the type checker on the type of the parameter, not by the name of a file.
 */
import ts from 'typescript';
import type { Programm } from './programm';
import { kurz, ortVon, type Datei, type KnotenBezug, type Protokoll } from './typen';
import type { Zerlegung } from './zerlegung';

const K = ts.SyntaxKind;
const F = ts.TypeFlags;
/** Types that are no object: strings, numbers, `undefined`, `null` and their relatives. */
const EINFACH = F.StringLike | F.NumberLike | F.BigIntLike | F.BooleanLike | F.EnumLike | F.ESSymbolLike | F.VoidLike | F.Null;

function knotenBei(sf: ts.SourceFile, pos: number, end: number, kind: ts.SyntaxKind): ts.Node | null {
  let fund: ts.Node | null = null;
  const geh = (n: ts.Node): void => {
    if (fund || n.pos > pos || n.end < end) return;
    if (n.pos === pos && n.end === end && n.kind === kind) {
      fund = n;
      return;
    }
    ts.forEachChild(n, geh);
  };
  geh(sf);
  return fund;
}

export interface KontextErgebnis {
  /** Per target file: names of the members the context type gives access to. */
  schluessel: Map<string, Set<string>>;
}

/** Names reached as `k.<name>` in a function. `nackt`: the context is also used as a whole. */
function zugriffeUeber(f: ts.FunctionDeclaration, kontext: string): { namen: Set<string>; nackt: boolean } {
  const namen = new Set<string>();
  let nackt = false;
  const geh = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === kontext && !(ts.isParameter(n.parent) && n.parent.name === n)) {
      const p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === n) namen.add(p.name.text);
      else if (ts.isQualifiedName(p) && p.left === n) namen.add(p.right.text);
      else if (!(ts.isPropertyAccessExpression(p) && p.name === n)) nackt = true;
    }
    ts.forEachChild(n, geh);
  };
  geh(f);
  return { namen, nackt };
}

export function pruefeKontexttyp(z: Zerlegung, neu: Programm, klasse: string, p: Protokoll): KontextErgebnis {
  const erg: KontextErgebnis = { schluessel: new Map() };
  /** Per target file: what its functions reach through the context, and one place to report at. */
  const benutzt = new Map<string, { namen: Set<string>; nackt: boolean; datei: Datei; pos: number; glieder: Set<string> }>();
  const restSf = neu.programm.getSourceFile(neu.zugriff.absolut(z.rest.pfad));
  const klassenKnoten = restSf?.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === klasse) ?? null;
  const pruefer = neu.pruefer;
  for (const paar of z.formk) {
    const kontext = paar.ziel.kontext;
    if (!kontext) continue;
    const datei: Datei = paar.neu.datei;
    const sf = neu.programm.getSourceFile(neu.zugriff.absolut(datei.pfad));
    const fAst = paar.neu.knoten;
    const f = sf ? knotenBei(sf, fAst.pos, fAst.end, fAst.kind) : null;
    p.zaehle('B5');
    const melde = (teil: string, pos: number, text: string): void => p.melde({ regel: 'B5', teil, ort: ortVon(datei, pos), text: `context of "${paar.name}": ${text}` });
    if (!f || !ts.isFunctionDeclaration(f) || !klassenKnoten) {
      melde('kontexttyp-unbekannt', fAst.getStart(datei.sf), 'the function or the class is not part of the program of the new state');
      continue;
    }
    const k = f.parameters[0];
    if (!k || !ts.isIdentifier(k.name) || k.name.text !== kontext.parameter) continue; // reported by B3
    const typ = pruefer.getTypeAtLocation(k);
    const wo = k.getStart(sf);
    const text = kurz(pruefer.typeToString(typ), 60);
    const schluessel = erg.schluessel.get(datei.pfad) ?? new Set<string>();
    erg.schluessel.set(datei.pfad, schluessel);
    if (typ.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.NonPrimitive | ts.TypeFlags.TypeParameter | EINFACH)) {
      melde('kontexttyp-any', wo, `its type is \`${text}\`: the type checker would see nothing of what the code touches`);
      continue;
    }
    const klassenTyp = pruefer.getDeclaredTypeOfSymbol(pruefer.getSymbolAtLocation(klassenKnoten.name!)!);
    const zugriffe = zugriffeUeber(f, kontext.parameter);
    const b = benutzt.get(datei.pfad) ?? { namen: new Set<string>(), nackt: false, datei, pos: wo, glieder: new Set<string>() };
    benutzt.set(datei.pfad, b);
    for (const n of zugriffe.namen) b.namen.add(n);
    if (zugriffe.nackt) b.nackt = true;
    if (typ === klassenTyp) {
      for (const n of zugriffe.namen) schluessel.add(n);
      b.nackt = true; // the class itself names every member: nothing to count
      continue;
    }
    if (typ.flags & (ts.TypeFlags.Union | ts.TypeFlags.Index | ts.TypeFlags.IndexedAccess | ts.TypeFlags.Conditional)) {
      melde('kontexttyp-form', wo, `its type \`${text}\` is neither the class nor a \`Pick\` on it`);
      continue;
    }
    if (pruefer.getIndexInfosOfType(typ).length > 0) {
      melde('kontexttyp-index', wo, `its type \`${text}\` has an index signature: every name would be accepted`);
      continue;
    }
    if (typ.getCallSignatures().length > 0 || typ.getConstructSignatures().length > 0) {
      melde('kontexttyp-form', wo, `its type \`${text}\` can be called: it is not a view of the class`);
      continue;
    }
    const glieder = pruefer.getPropertiesOfType(typ);
    const fremd: string[] = [];
    for (const g of glieder) {
      const dekl = g.declarations ?? [];
      // A member is declared in the class body, or as a parameter property of its constructor.
      const ausKlasse = dekl.length > 0 && dekl.every((d) => d.parent === klassenKnoten || (ts.isParameter(d) && ts.isConstructorDeclaration(d.parent) && d.parent.parent === klassenKnoten));
      if (!ausKlasse) fremd.push(g.name);
      else {
        schluessel.add(g.name);
        b.glieder.add(g.name);
        const dort = pruefer.getPropertyOfType(klassenTyp, g.name);
        if (dort && !!(g.flags & ts.SymbolFlags.Optional) !== !!(dort.flags & ts.SymbolFlags.Optional)) fremd.push(`${g.name} (optional in the context, not in the class)`);
      }
    }
    if (fremd.length > 0) {
      melde('kontexttyp-fremd', wo, `its type \`${text}\` has members the class "${klasse}" does not declare that way: ${fremd.slice(0, 6).join(', ')}${fremd.length > 6 ? ', ...' : ''}`);
      continue;
    }
    if (glieder.length === 0) {
      const alias = typ.aliasSymbol;
      const erstes = typ.aliasTypeArguments?.[0];
      const istPick = alias?.name === 'Pick' && erstes === klassenTyp;
      if (!istPick) melde('kontexttyp-leer', wo, `its type \`${text}\` has no members and is no \`Pick\` on the class "${klasse}"`);
    }
  }
  // One context type per module, with exactly the members the module uses: no member in reserve.
  for (const [pfad, b] of benutzt) {
    if (b.nackt) continue;
    p.zaehle('B5');
    const vorrat = [...b.glieder].filter((g) => !b.namen.has(g));
    if (vorrat.length > 0) {
      p.melde({ regel: 'B5', teil: 'kontexttyp-vorrat', ort: ortVon(b.datei, b.pos), text: `the context type of ${pfad} names members no moved function of the file uses: ${vorrat.join(', ')}` });
    }
  }
  return erg;
}

/** The identifier a forwarder calls must be the function in the target file. */
export function pruefeAufruf(name: string, aufgerufen: ts.Identifier, rest: Datei, funktion: KnotenBezug, neu: Programm, p: Protokoll): void {
  p.zaehle('B5');
  const sf = neu.programm.getSourceFile(neu.zugriff.absolut(rest.pfad));
  const knoten = sf ? knotenBei(sf, aufgerufen.pos, aufgerufen.end, aufgerufen.kind) : null;
  const melde = (text: string): void => p.melde({ regel: 'B5', teil: 'weiterleitung-bindung', ort: ortVon(rest, aufgerufen.getStart(rest.sf)), text: `forwarder "${name}": ${text}` });
  if (!knoten) {
    melde('the call is not part of the program of the new state');
    return;
  }
  let sym = neu.pruefer.getSymbolAtLocation(knoten);
  const istImport = !!sym && !!(sym.flags & ts.SymbolFlags.Alias) && (sym.declarations ?? []).every((d) => ts.isImportSpecifier(d) && !d.propertyName);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = neu.pruefer.getAliasedSymbol(sym);
  const dekl = sym?.declarations ?? [];
  const trifft = dekl.length === 1 && neu.zugriff.kurzPfad(dekl[0]!.getSourceFile().fileName) === funktion.datei && dekl[0]!.pos === funktion.pos && dekl[0]!.end === funktion.end;
  if (!trifft) {
    const wohin = dekl.map((d) => `${neu.zugriff.kurzPfad(d.getSourceFile().fileName)} (${K[d.kind]})`).join(', ') || 'nothing';
    melde(`the call does not reach the function in ${funktion.datei}, it points to ${wohin}`);
  } else if (!istImport) {
    melde('the function is not imported under its own name with a named import');
  }
}

/** A member may lose `private` or `protected` only if a context type of this step names it. */
export function pruefeLockerung(gelockert: readonly { name: string; was: string; ort: { datei: Datei; pos: number } }[], kontext: KontextErgebnis, p: Protokoll): string[] {
  const alle = new Set<string>();
  for (const s of kontext.schluessel.values()) for (const n of s) alle.add(n);
  const aus: string[] = [];
  for (const g of gelockert) {
    p.zaehle('B5');
    aus.push(`${g.name} (was ${g.was})`);
    if (!alle.has(g.name)) {
      p.melde({ regel: 'B5', teil: 'gelockert-ohne-kontext', ort: ortVon(g.ort.datei, g.ort.pos), text: `member "${g.name}" lost \`${g.was}\`, but no context type of this step names it` });
    }
  }
  return aus;
}
