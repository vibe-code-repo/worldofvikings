/**
 * Move proof, rule B3: two syntax trees are equal node by node.
 *
 * Compared is the full tree the parser built, with every token: kind of each node, number and
 * order of its children, text of each leaf as written (identifier, number, string, template text,
 * regular expression, keyword, punctuation). Comments and blanks are not part of the tree; rule B6
 * compares the comments.
 *
 * A sequence of tokens is not enough: `return X;` and `return<newline>X;` have the same tokens and are
 * two different programs. In the tree the second one is a return without a value followed by an
 * expression statement, so the number of children differs.
 *
 * The walk also records which old node corresponds to which new node. Rule B7 needs that to say
 * "the same local declaration".
 */
import ts from 'typescript';
import { kurz, type Datei, type KnotenBezug } from './typen';

const K = ts.SyntaxKind;

/** Old node (by position in the old source file) to new node. */
export class KnotenPaare {
  private readonly nachNeu = new Map<string, KnotenBezug>();

  static schluessel(pos: number, end: number, kind: ts.SyntaxKind): string {
    return `${pos}:${end}:${kind}`;
  }

  setze(alt: ts.Node, neu: ts.Node, neuDatei: Datei): void {
    this.nachNeu.set(KnotenPaare.schluessel(alt.pos, alt.end, alt.kind), { datei: neuDatei.pfad, pos: neu.pos, end: neu.end, kind: neu.kind });
  }

  /** Overrides the kind of the partner: a method of the old class corresponds to its forwarder. */
  setzeBezug(pos: number, end: number, kind: ts.SyntaxKind, bezug: KnotenBezug): void {
    this.nachNeu.set(KnotenPaare.schluessel(pos, end, kind), bezug);
  }

  hole(pos: number, end: number, kind: ts.SyntaxKind): KnotenBezug | undefined {
    return this.nachNeu.get(KnotenPaare.schluessel(pos, end, kind));
  }

  get groesse(): number {
    return this.nachNeu.size;
  }
}

export interface BaumUnterschied {
  alt: ts.Node | null;
  neu: ts.Node | null;
  grund: string;
}

export interface BaumOptionen {
  /**
   * Form k: a `this` of this set (the ones bound to the moved method) corresponds to the
   * identifier `kontext` in the new tree. Every other `this` stays `this`.
   */
  thisZuKontext?: { kontext: string; gebunden: ReadonlySet<ts.Node> };
  /** Counts the compared nodes. */
  zaehler?: { knoten: number };
  /** Identifier pairs in document order, for rule B7. */
  bezeichner?: { alt: ts.Node; neu: ts.Node }[];
}

function istJsDoc(n: ts.Node): boolean {
  return n.kind >= K.FirstJSDocNode && n.kind <= K.LastJSDocNode;
}

function kinder(n: ts.Node, sf: ts.SourceFile): ts.Node[] {
  return n.getChildren(sf).filter((k) => !istJsDoc(k));
}

function beschreibe(n: ts.Node, datei: Datei): string {
  return `${K[n.kind]} "${kurz(n.getText(datei.sf), 50)}"`;
}

/**
 * Compares two trees. Returns the first difference in document order or `null`.
 * `paare`, if given, receives every pair of corresponding nodes up to the first difference.
 */
export function vergleicheBaum(alt: ts.Node, neu: ts.Node, altDatei: Datei, neuDatei: Datei, opt: BaumOptionen, paare: KnotenPaare | null): BaumUnterschied | null {
  if (opt.zaehler) opt.zaehler.knoten++;
  const ka = kinder(alt, altDatei.sf);
  const kn = kinder(neu, neuDatei.sf);
  if (ka.length === 0 || kn.length === 0) {
    if (ka.length !== kn.length) return { alt, neu, grund: `${beschreibe(alt, altDatei)} against ${beschreibe(neu, neuDatei)}: one is a leaf, the other has children` };
    if (opt.thisZuKontext && opt.thisZuKontext.gebunden.has(alt)) {
      if (neu.kind !== K.Identifier || (neu as ts.Identifier).text !== opt.thisZuKontext.kontext || neu.getText(neuDatei.sf) !== opt.thisZuKontext.kontext) {
        return { alt, neu, grund: `\`this\` of the method must become \`${opt.thisZuKontext.kontext}\`, found ${beschreibe(neu, neuDatei)}` };
      }
      paare?.setze(alt, neu, neuDatei);
      opt.bezeichner?.push({ alt, neu });
      return null;
    }
    if (alt.kind !== neu.kind) return { alt, neu, grund: `kind of node differs: ${beschreibe(alt, altDatei)} against ${beschreibe(neu, neuDatei)}` };
    const ta = alt.getText(altDatei.sf);
    const tn = neu.getText(neuDatei.sf);
    if (ta !== tn) return { alt, neu, grund: `text of ${K[alt.kind]} differs: "${kurz(ta, 50)}" against "${kurz(tn, 50)}"` };
    paare?.setze(alt, neu, neuDatei);
    if (opt.bezeichner && (alt.kind === K.Identifier || alt.kind === K.PrivateIdentifier || alt.kind === K.ThisKeyword)) opt.bezeichner.push({ alt, neu });
    return null;
  }
  if (alt.kind !== neu.kind) return { alt, neu, grund: `kind of node differs: ${beschreibe(alt, altDatei)} against ${beschreibe(neu, neuDatei)}` };
  const n = Math.min(ka.length, kn.length);
  for (let i = 0; i < n; i++) {
    const u = vergleicheBaum(ka[i]!, kn[i]!, altDatei, neuDatei, opt, paare);
    if (u) return u;
  }
  if (ka.length !== kn.length) {
    const mehr = ka.length > kn.length ? ka[n]! : kn[n]!;
    const wo = ka.length > kn.length ? altDatei : neuDatei;
    return {
      alt: ka.length > kn.length ? mehr : alt,
      neu: ka.length > kn.length ? neu : mehr,
      grund: `${K[alt.kind]} has ${ka.length} children in the old state and ${kn.length} in the new one; first surplus child: ${beschreibe(mehr, wo)}`,
    };
  }
  paare?.setze(alt, neu, neuDatei);
  return null;
}

/** Compares two lists of sibling nodes. */
export function vergleicheListe(alt: readonly ts.Node[], neu: readonly ts.Node[], altDatei: Datei, neuDatei: Datei, opt: BaumOptionen, paare: KnotenPaare | null, was: string): BaumUnterschied | null {
  const n = Math.min(alt.length, neu.length);
  for (let i = 0; i < n; i++) {
    const u = vergleicheBaum(alt[i]!, neu[i]!, altDatei, neuDatei, opt, paare);
    if (u) return u;
  }
  if (alt.length !== neu.length) {
    return { alt: alt[n] ?? null, neu: neu[n] ?? null, grund: `${was}: ${alt.length} in the old state, ${neu.length} in the new one` };
  }
  return null;
}

/** Compares two optional nodes (a return type, a type parameter list). */
export function vergleicheWahlweise(alt: ts.Node | undefined, neu: ts.Node | undefined, altDatei: Datei, neuDatei: Datei, opt: BaumOptionen, paare: KnotenPaare | null, was: string): BaumUnterschied | null {
  if (!alt && !neu) return null;
  if (!alt || !neu) return { alt: alt ?? null, neu: neu ?? null, grund: `${was}: ${alt ? 'present' : 'absent'} in the old state, ${neu ? 'present' : 'absent'} in the new one` };
  return vergleicheBaum(alt, neu, altDatei, neuDatei, opt, paare);
}
