/**
 * Move proof, pieces: parsing a file and cutting it into statements and class members, each with
 * its extent.
 *
 * The extent of a piece starts where the extent of the sibling before it ends and reaches to the
 * end of its own last line, if only blanks and comments follow there. So the comments and blank
 * lines BEFORE a declaration belong to it, a comment at the end of its last line too. The extents
 * of all siblings together with the text after the last one cover their container without a gap.
 */
import ts from 'typescript';
import type { Datei, StandSeite, Stueck } from './typen';

const K = ts.SyntaxKind;

export function skriptArt(pfad: string): ts.ScriptKind {
  return pfad.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function liesDatei(seite: StandSeite, pfad: string, text: string): Datei {
  const sf = ts.createSourceFile(pfad, text, ts.ScriptTarget.Latest, true, skriptArt(pfad));
  return { seite, pfad, text, sf };
}

/** Syntax errors the parser reported for a file. */
export function syntaxFehler(datei: Datei): readonly ts.DiagnosticWithLocation[] {
  // `parseDiagnostics` is what `Program.getSyntacticDiagnostics` returns; it is set by the parser.
  const d = (datei.sf as unknown as { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics;
  return d ?? [];
}

/**
 * End of the extent of a node that ends at `pos`: blanks and comments that stay on the same line
 * belong to it, and the line break after them. If another token follows on the line, or a comment
 * that runs over the line break, the extent ends at `pos`.
 */
export function nachlaufEnde(text: string, pos: number, grenze: number): number {
  let p = pos;
  while (p < grenze) {
    const c = text.charCodeAt(p);
    if (c === 0x20 || c === 0x09 || c === 0x0b || c === 0x0c || c === 0xa0 || c === 0xfeff) {
      p++;
    } else if (c === 0x0a) {
      return p + 1;
    } else if (c === 0x0d) {
      return text.charCodeAt(p + 1) === 0x0a ? p + 2 : p + 1;
    } else if (c === 0x2f && text.charCodeAt(p + 1) === 0x2f) {
      while (p < grenze && text.charCodeAt(p) !== 0x0a && text.charCodeAt(p) !== 0x0d) p++;
    } else if (c === 0x2f && text.charCodeAt(p + 1) === 0x2a) {
      const zu = text.indexOf('*/', p + 2);
      if (zu < 0 || zu + 2 > grenze) return pos;
      const kommentar = text.slice(p, zu + 2);
      if (kommentar.includes('\n') || kommentar.includes('\r')) return pos;
      p = zu + 2;
    } else {
      return pos;
    }
  }
  return grenze;
}

export interface Schnitt {
  stuecke: Stueck[];
  /** Text between the extent of the last piece and the end of the container. */
  schluss: string;
  schlussVon: number;
}

/** Cuts the range `start` to `ende` of a file into the extents of `knoten`, which are siblings in order. */
export function schneide(datei: Datei, knoten: readonly ts.Node[], start: number, ende: number): Schnitt {
  const stuecke: Stueck[] = [];
  let zeiger = start;
  knoten.forEach((k, i) => {
    const naechster = knoten[i + 1];
    const grenze = naechster ? naechster.getStart(datei.sf) : ende;
    const bis = Math.max(k.end, Math.min(nachlaufEnde(datei.text, k.end, grenze), grenze));
    stuecke.push({ datei, knoten: k, von: zeiger, bis, text: datei.text.slice(zeiger, bis) });
    zeiger = bis;
  });
  return { stuecke, schluss: datei.text.slice(zeiger, ende), schlussVon: zeiger };
}

/** The statements of a file as pieces. */
export function anweisungen(datei: Datei): Schnitt {
  return schneide(datei, datei.sf.statements, 0, datei.text.length);
}

export interface KlassenSchnitt {
  /** Text from the start of the extent of the class to the end of the line with the opening brace. */
  kopf: string;
  kopfBis: number;
  mitglieder: Stueck[];
  /** Text from the extent of the last member to the end of the extent of the class. */
  schluss: string;
  schlussVon: number;
}

/** Cuts a class into head, members and tail. `stueck` is the extent of the class as a statement. */
export function schneideKlasse(stueck: Stueck): KlassenSchnitt {
  const datei = stueck.datei;
  const klasse = stueck.knoten as ts.ClassDeclaration;
  const innenVon = klasse.members.pos;
  const erstes = klasse.members[0];
  const innenEnde = klasse.end - 1; // position of the closing brace
  const kopfBis = Math.min(nachlaufEnde(datei.text, innenVon, erstes ? erstes.getStart(datei.sf) : innenEnde), innenEnde);
  const schnitt = schneide(datei, klasse.members, kopfBis, innenEnde);
  return {
    kopf: datei.text.slice(stueck.von, kopfBis),
    kopfBis,
    mitglieder: schnitt.stuecke,
    schluss: datei.text.slice(schnitt.schlussVon, stueck.bis),
    schlussVon: schnitt.schlussVon,
  };
}

function musterNamen(n: ts.BindingName, aus: string[]): void {
  if (ts.isIdentifier(n)) aus.push(n.text);
  else for (const e of n.elements) if (ts.isBindingElement(e)) musterNamen(e.name, aus);
}

/** Names a binding declares: the identifier itself or the identifiers of a pattern. */
export function bindungsNamen(n: ts.BindingName): string[] {
  const aus: string[] = [];
  musterNamen(n, aus);
  return aus;
}

/** Names a statement declares on module level. Empty for statements that declare nothing. */
export function deklarierteNamen(st: ts.Node): string[] {
  const aus: string[] = [];
  if (ts.isVariableStatement(st)) {
    for (const d of st.declarationList.declarations) musterNamen(d.name, aus);
  } else if (
    (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) &&
    st.name
  ) {
    aus.push(st.name.text);
  } else if (ts.isModuleDeclaration(st) && ts.isIdentifier(st.name)) {
    aus.push(st.name.text);
  } else if (ts.isImportEqualsDeclaration(st)) {
    aus.push(st.name.text);
  }
  return aus;
}

/** Name of a class member, if it has a plain one. */
export function mitgliedName(m: ts.Node): string | null {
  if (ts.isConstructorDeclaration(m)) return 'constructor';
  const n = (m as ts.NamedDeclaration).name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return null;
}

export function modifikatoren(n: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : [];
}

export function hatModifikator(n: ts.Node, art: ts.SyntaxKind): boolean {
  return modifikatoren(n).some((m) => m.kind === art);
}

export function dekoratoren(n: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(n) ? (ts.getDecorators(n) ?? []) : [];
}

/** What kind of module level declaration a statement is, in the words of the form 0. */
export function deklarationsArt(st: ts.Node): 'konstante' | 'funktion' | 'klasse' | 'interface' | 'type' | 'enum' | null {
  if (ts.isVariableStatement(st)) return 'konstante';
  if (ts.isFunctionDeclaration(st)) return 'funktion';
  if (ts.isClassDeclaration(st)) return 'klasse';
  if (ts.isInterfaceDeclaration(st)) return 'interface';
  if (ts.isTypeAliasDeclaration(st)) return 'type';
  if (ts.isEnumDeclaration(st)) return 'enum';
  return null;
}

/** True for a declaration that exists for the type checker only. */
export function istNurTyp(st: ts.Node): boolean {
  if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) return true;
  if (hatModifikator(st, K.DeclareKeyword)) return true;
  if (ts.isEnumDeclaration(st) && hatModifikator(st, K.ConstKeyword)) return true;
  return false;
}

/** All leaf tokens of a node in order, JSDoc nodes left out. */
export function blaetter(knoten: ts.Node, sf: ts.SourceFile, aus: ts.Node[] = []): ts.Node[] {
  if (knoten.kind >= K.FirstJSDocNode && knoten.kind <= K.LastJSDocNode) return aus;
  const kinder = knoten.getChildren(sf);
  if (kinder.length === 0) {
    aus.push(knoten);
    return aus;
  }
  for (const k of kinder) blaetter(k, sf, aus);
  return aus;
}
