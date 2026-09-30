/**
 * Move proof, rule B7: binding.
 *
 * The dangerous mistake of a move is not the text but where a name points afterwards: a name that
 * pointed to an import can point to another declaration or to a global of the same name in the
 * new module, and neither the type checker nor a byte comparison says a word.
 *
 * So two TypeScript programs are built, one per state, and every occurrence of an identifier of
 * the WHOLE old source file is resolved to its declaration, through aliases down to the source.
 * Its partner in the new state must resolve to the same declaration:
 *  - the same place of a file that is the same in both states,
 *  - the declaration that moved along (the partner the tree walk recorded),
 *  - the corresponding local declaration,
 *  - for `this.x` that became `k.x`: the same member of the class.
 */
import ts from 'typescript';
import type { KnotenPaare } from './baum';
import type { Programm } from './programm';
import type { Stand } from './stand';
import { type KnotenBezug, type Ort, type Protokoll, type StandSeite } from './typen';

const K = ts.SyntaxKind;

export interface BezeichnerPaar {
  /** `start` is where the text of the identifier begins, `pos` where the blanks before it begin. */
  alt: { pos: number; end: number; start: number };
  neu: { datei: string; pos: number; end: number; start: number };
  text: string;
  /** Set for a `this` of a moved method: its partner must be the context parameter of the function. */
  erwartet?: KnotenBezug;
  /** Partners of declarations that hold for this pair only (signature of a forwarder). */
  eigenePaare?: KnotenPaare;
  /** True for a `this` that stays `this`: nothing to resolve. */
  ueberspringen?: boolean;
}

export interface DeklOrt {
  datei: string;
  pos: number;
  end: number;
  kind: ts.SyntaxKind;
  /** Names of the enclosing declarations down to this one: identity in a file that changed. */
  namenspfad: string;
  zeile: number;
}

export interface Deskriptor {
  art: 'symbol' | 'kein-symbol' | 'unaufgeloest';
  name: string;
  dekl: DeklOrt[];
  /** True if the identifier names a member or a label, so that no symbol is no surprise. */
  gliedname: boolean;
}

function nameVon(n: ts.Node): string {
  const name = (n as ts.NamedDeclaration).name;
  if (name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) return name.text;
  if (ts.isConstructorDeclaration(n)) return 'constructor';
  return '';
}

function namenspfad(n: ts.Node): string {
  const teile: string[] = [];
  for (let a: ts.Node | undefined = n; a && !ts.isSourceFile(a); a = a.parent) {
    const name = nameVon(a);
    if (name !== '' || a === n) teile.unshift(`${K[a.kind]}:${name}`);
  }
  return teile.join('/');
}

function istGliedname(id: ts.Node): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isQualifiedName(p) && p.right === id) return true;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === id && ts.isObjectLiteralExpression(p.parent)) return true;
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  if (ts.isJsxAttribute(p)) return true;
  return false;
}

function symbolVon(pruefer: ts.TypeChecker, n: ts.Node): ts.Symbol | undefined {
  const p = n.parent;
  if (p && ts.isShorthandPropertyAssignment(p) && p.name === n) return pruefer.getShorthandAssignmentValueSymbol(p);
  if (p && ts.isExportSpecifier(p)) return pruefer.getExportSpecifierLocalTargetSymbol(p) ?? pruefer.getSymbolAtLocation(n);
  return pruefer.getSymbolAtLocation(n);
}

/** Index of the identifiers and `this` of a file by position. */
function bezeichnerIndex(sf: ts.SourceFile): Map<string, ts.Node> {
  const aus = new Map<string, ts.Node>();
  const geh = (n: ts.Node): void => {
    if (n.kind === K.Identifier || n.kind === K.PrivateIdentifier || n.kind === K.ThisKeyword) aus.set(`${n.pos}:${n.end}`, n);
    ts.forEachChild(n, geh);
  };
  geh(sf);
  return aus;
}

/** Resolves the identifiers at the given positions of one file. */
export function beschreibe(prog: Programm, datei: string, stellen: readonly { pos: number; end: number }[]): Map<string, Deskriptor> {
  const aus = new Map<string, Deskriptor>();
  const sf = prog.programm.getSourceFile(prog.zugriff.absolut(datei));
  if (!sf) return aus;
  const index = bezeichnerIndex(sf);
  for (const s of stellen) {
    const schluessel = `${s.pos}:${s.end}`;
    const n = index.get(schluessel);
    if (!n) continue;
    const name = n.kind === K.ThisKeyword ? 'this' : (n as ts.Identifier).text;
    const gliedname = istGliedname(n);
    let sym = symbolVon(prog.pruefer, n);
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      const ziel = prog.pruefer.getAliasedSymbol(sym);
      if (prog.pruefer.isUnknownSymbol(ziel)) {
        aus.set(schluessel, { art: 'unaufgeloest', name, dekl: [], gliedname });
        continue;
      }
      sym = ziel;
    }
    if (!sym) {
      aus.set(schluessel, { art: 'kein-symbol', name, dekl: [], gliedname });
      continue;
    }
    const dekl = (sym.declarations ?? []).map((d): DeklOrt => {
      const dsf = d.getSourceFile();
      return { datei: prog.zugriff.kurzPfad(dsf.fileName), pos: d.pos, end: d.end, kind: d.kind, namenspfad: namenspfad(d), zeile: dsf.getLineAndCharacterOfPosition(d.getStart(dsf)).line + 1 };
    });
    aus.set(schluessel, { art: 'symbol', name: sym.name, dekl, gliedname });
  }
  return aus;
}

export interface BindungsEingabe {
  quelle: string;
  paare: readonly BezeichnerPaar[];
  knotenPaare: KnotenPaare;
  alt: Map<string, Deskriptor>;
  /** Per file of the new state. */
  neu: Map<string, Map<string, Deskriptor>>;
  standAlt: Stand;
  standNeu: Stand;
  /** Files of the step: the source file and the target files. Declarations there are compared through their partners. */
  schrittDateien: ReadonlySet<string>;
  ortAlt: (pos: number) => Ort;
  ortNeu: (datei: string, pos: number) => Ort;
  /**
   * Ranges of the old source file whose piece already carries a finding of rule B2 or B3. The tree
   * walk stopped there, so declarations inside have no partner. That is a consequence of the
   * finding, not a second one.
   */
  gestoert: readonly { von: number; bis: number }[];
}

export interface BindungsErgebnis {
  geprueft: number;
  ohneSymbol: number;
  /** Identifiers that point into a piece with a finding of rule B2 or B3: not judged. */
  inGestoertem: number;
  /** Files outside the step that differ between the states and hold a declaration an identifier points to. */
  fremdGeaendert: Set<string>;
}

function zeige(d: DeklOrt | KnotenBezug): string {
  return `${d.datei}${'zeile' in d ? `:${d.zeile}` : ` @${d.pos}`} (${K[d.kind]})`;
}

export function pruefeBindung(e: BindungsEingabe, p: Protokoll): BindungsErgebnis {
  const erg: BindungsErgebnis = { geprueft: 0, ohneSymbol: 0, inGestoertem: 0, fremdGeaendert: new Set() };
  const gestoert = (pos: number): boolean => e.gestoert.some((g) => pos >= g.von && pos < g.bis);
  const gemeldet = new Map<string, number>();
  const gleicheDatei = new Map<string, boolean>();
  const unveraendert = (datei: string): boolean => {
    let g = gleicheDatei.get(datei);
    if (g === undefined) {
      const a = e.standAlt.inhaltsHash(datei);
      const n = e.standNeu.inhaltsHash(datei);
      // A file outside both states (library, installed package) is read from the same disk for both.
      g = a === undefined && n === undefined ? true : a !== undefined && a === n;
      gleicheDatei.set(datei, g);
    }
    return g;
  };
  const melde = (paar: BezeichnerPaar, teil: string, text: string, seite: StandSeite, freigabe?: string): void => {
    const schluessel = `${teil}|${text}`;
    const bisher = gemeldet.get(schluessel) ?? 0;
    gemeldet.set(schluessel, bisher + 1);
    if (bisher > 0 && freigabe === undefined) return;
    p.melde({ regel: 'B7', teil, text, ort: seite === 'alt' ? e.ortAlt(paar.alt.start) : e.ortNeu(paar.neu.datei, paar.neu.start), ...(freigabe ? { freigabe } : {}) });
  };

  for (const paar of e.paare) {
    if (paar.ueberspringen) continue;
    erg.geprueft++;
    p.zaehle('B7');
    const n = e.neu.get(paar.neu.datei)?.get(`${paar.neu.pos}:${paar.neu.end}`);
    if (!n) {
      melde(paar, 'ohne-partner', `"${paar.text}": its partner in ${paar.neu.datei} is not part of the program of the new state`, 'neu');
      continue;
    }
    if (paar.erwartet) {
      const w = paar.erwartet;
      const passt = n.art === 'symbol' && n.dekl.length === 1 && n.dekl[0]!.datei === w.datei && n.dekl[0]!.pos === w.pos && n.dekl[0]!.end === w.end;
      if (!passt) {
        melde(paar, 'kontext', `"${n.name}" stands for \`this\` of the moved method, but does not point to the context parameter of its function: it points to ${n.dekl.length > 0 ? n.dekl.map(zeige).join(', ') : 'nothing'} (a local declaration of the same name hides the parameter)`, 'neu');
      }
      continue;
    }
    const a = e.alt.get(`${paar.alt.pos}:${paar.alt.end}`);
    if (!a) {
      melde(paar, 'ohne-partner', `"${paar.text}" of the old source file is not part of the program of the old state`, 'alt');
      continue;
    }
    if (a.art !== 'symbol' || n.art !== 'symbol') {
      if (a.art === n.art && a.art === 'kein-symbol' && a.gliedname && n.gliedname) {
        erg.ohneSymbol++; // member of a value without a known type: nothing to bind, in both states
        continue;
      }
      const wort = (d: Deskriptor): string => (d.art === 'symbol' ? `points to ${d.dekl.map(zeige).join(', ') || 'a symbol without declaration'}` : d.art === 'unaufgeloest' ? 'is an import that cannot be resolved' : 'has no declaration the type checker knows');
      if (a.art === n.art) {
        const o = e.ortAlt(paar.alt.start);
        melde(paar, 'unaufloesbar', `"${paar.text}" ${wort(a)} in both states: the binding cannot be proven`, 'alt', `bindung:${o.zeile}:${o.spalte}`);
      } else {
        melde(paar, 'bindung', `"${paar.text}" ${wort(a)} in the old state and ${wort(n)} in the new one`, 'neu');
      }
      continue;
    }
    // Expected declarations of the new state, one per declaration of the old state.
    const erwartet: string[] = [];
    let offen = false;
    for (const d of a.dekl) {
      if (d.datei === e.quelle) {
        const partner = paar.eigenePaare?.hole(d.pos, d.end, d.kind) ?? e.knotenPaare.hole(d.pos, d.end, d.kind);
        if (!partner && gestoert(d.end - 1)) {
          erg.inGestoertem++;
          offen = true;
          break;
        }
        if (!partner) {
          melde(paar, 'ohne-gegenstueck', `"${paar.text}" points to ${zeige(d)} of the old source file, which has no partner in the new state`, 'alt');
          offen = true;
          break;
        }
        erwartet.push(`${partner.datei}|${partner.pos}:${partner.end}|${partner.kind}`);
      } else if (unveraendert(d.datei)) {
        erwartet.push(`${d.datei}|${d.pos}:${d.end}|${d.kind}`);
      } else {
        erg.fremdGeaendert.add(d.datei);
        erwartet.push(`${d.datei}|name|${d.namenspfad}`);
      }
    }
    if (offen) continue;
    const gefunden = n.dekl.map((d) => (e.schrittDateien.has(d.datei) || unveraendert(d.datei) ? `${d.datei}|${d.pos}:${d.end}|${d.kind}` : `${d.datei}|name|${d.namenspfad}`));
    const soll = [...erwartet].sort().join('\n');
    const ist = [...gefunden].sort().join('\n');
    if (soll !== ist) {
      melde(paar, 'bindung', `"${paar.text}" pointed to ${a.dekl.map(zeige).join(', ') || 'a symbol without declaration'} and points to ${n.dekl.map(zeige).join(', ') || 'a symbol without declaration'} now`, 'neu');
    }
  }
  for (const [schluessel, anzahl] of gemeldet) {
    if (anzahl > 1 && !schluessel.startsWith('unaufloesbar|')) p.hinweis('B7', `${anzahl} occurrences share one finding: ${schluessel.slice(schluessel.indexOf('|') + 1, 160)}`);
  }
  return erg;
}
