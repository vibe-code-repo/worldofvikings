/**
 * Move proof, shared types.
 *
 * The move proof shows for one refactoring step that code was only moved and nothing else was
 * changed. A step is described by a manifest; the proof compares an old state with a new state
 * and reports findings per rule (B1 to B12). See `README.md` in this folder and the section
 * "Move proof" in `AGENTS.md`.
 *
 * German identifiers carry the terms of the task card: Befund (finding), Freigabe (release),
 * Stand (state of the tree), Stueck (a statement or class member with the lines before it).
 */
import type ts from 'typescript';

/**
 * Rule identifiers. B1 to B11 are the rules of the task card. B12 collects constructs a form does
 * not support, B13 is the exception for section lines.
 */
export type RegelId = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10' | 'B11' | 'B12' | 'B13';

export const REGELN: readonly RegelId[] = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13'];

/** What each rule promises, printed in the output. */
export const REGEL_TITEL: Readonly<Record<RegelId, string>> = {
  B1: 'complete: every statement and class member of the old source exists exactly once',
  B2: 'rest byte-identical: unmoved statements and members, with the lines before them',
  B3: 'tree equal: moved declarations match node by node after the declared form',
  B4: 'second line: generated JavaScript of expected and found declaration is equal',
  B5: 'glue: only imports, re-exports, export lists, forwarders, context type, header comment',
  B6: 'comments: equal in moved declarations, directive comments only where they were',
  B7: 'binding: every identifier points to the same declaration as before',
  B8: 'location: no location dependent expression moves silently',
  B9: 'loading: no moved declaration acts at load time without a release',
  B10: 'evaluation order: modules that existed before are evaluated in the same order',
  B11: 'nothing unexplained: every release and setting is printed and used',
  B12: 'form: the step uses only constructs the declared form supports',
  B13: 'section lines: a line `// -- title --` with the empty line before it may stay where it stood',
};

export type StandSeite = 'alt' | 'neu';

/** A place in a file of one of the two states. Lines and columns are 1-based. */
export interface Ort {
  seite: StandSeite;
  datei: string;
  zeile: number;
  spalte: number;
}

export interface Befund {
  regel: RegelId;
  /** Short key of the check inside the rule, stable, used by the self-test. */
  teil: string;
  text: string;
  ort: Ort;
  /** Release key that would release exactly this finding. Absent: not releasable. */
  freigabe?: string;
}

export interface Freigabe {
  schluessel: string;
  begruendung: string;
}

export interface FreigegebenerBefund {
  freigabe: Freigabe;
  befund: Befund;
}

/** Kinds of release keys this tool knows. A key has the form `<art>:<stelle>`. */
export const FREIGABE_ARTEN = ['laden', 'lesen', 'ort', 'vorgabe', 'bindung', 'reihenfolge'] as const;
export type FreigabeArt = (typeof FREIGABE_ARTEN)[number];

export interface KontextAngabe {
  /** Name of the context parameter, `k` by default. */
  parameter: string;
  /** Name of the context type as written at the parameter. */
  typ: string;
}

export interface ZielAngabe {
  datei: string;
  /** Form 0: names of module level declarations that move verbatim. */
  woertlich: string[];
  /** Form k: names of methods of the class that become functions with a context parameter. */
  methoden: string[];
  kontext?: KontextAngabe;
}

export interface Manifest {
  version: 1;
  /** `git:<ref>` */
  alt: string;
  /** `git:<ref>` or `arbeitsbaum` */
  neu: string;
  quelle: string;
  klasse?: string;
  ziele: ZielAngabe[];
  einstiege: string[];
  freigaben: Freigabe[];
}

/** A parsed source file of one state together with its text. */
export interface Datei {
  seite: StandSeite;
  pfad: string;
  text: string;
  sf: ts.SourceFile;
}

/** A statement or class member with its extent: the lines before it and the rest of its last line. */
export interface Stueck {
  datei: Datei;
  knoten: ts.Node;
  /** Start of the extent: end of the extent of the previous sibling. */
  von: number;
  /** End of the extent: after the line break that ends the last line, if only trivia follows. */
  bis: number;
  text: string;
}

export type PaarArt = 'unveraendert' | 'form0' | 'formk' | 'import' | 'klasse' | 'mitglied' | 'gelockert';

/** Reference to a node of the new state, by position, so that it survives a second parse. */
export interface KnotenBezug {
  datei: string;
  pos: number;
  end: number;
  kind: ts.SyntaxKind;
}

/** Counters per rule: how many places were checked. */
export type Zaehler = Record<RegelId, number>;

export function leererZaehler(): Zaehler {
  return { B1: 0, B2: 0, B3: 0, B4: 0, B5: 0, B6: 0, B7: 0, B8: 0, B9: 0, B10: 0, B11: 0, B12: 0, B13: 0 };
}

export interface Hinweis {
  regel: RegelId;
  text: string;
}

export interface Ergebnis {
  /** Version of the tool, see `VERSION` in `beweis.ts`. */
  werkzeug: string;
  manifest: Manifest;
  staende: { alt: string; neu: string };
  befunde: Befund[];
  freigegeben: FreigegebenerBefund[];
  hinweise: Hinweis[];
  zaehler: Zaehler;
  /** Members of the class that lost `private` or `protected`. */
  gelockert: string[];
  /** Per entry file: the evaluation order facts of B10. */
  reihenfolge: ReihenfolgeBericht[];
  /** Files outside the step that differ between the two states and are touched by a binding or the order. */
  fremdGeaendert: string[];
  /** What exit 0 does not prove. */
  grenzen: string[];
  /** 0 proof, 1 findings, 2 call or manifest wrong. */
  exit: 0 | 1 | 2;
}

export interface ReihenfolgeBericht {
  einstieg: string;
  moduleAlt: number;
  moduleNeu: number;
  /** New modules with their 1-based place in the new order and the module evaluated right after them. */
  neueModule: { modul: string; platz: number; davor: string | null; danach: string | null }[];
  gleich: boolean;
}

/** Collects findings and counts checked places. */
export class Protokoll {
  readonly befunde: Befund[] = [];
  readonly hinweise: Hinweis[] = [];
  readonly zaehler: Zaehler = leererZaehler();

  melde(befund: Befund): void {
    this.befunde.push(befund);
  }

  hinweis(regel: RegelId, text: string): void {
    this.hinweise.push({ regel, text });
  }

  zaehle(regel: RegelId, anzahl = 1): void {
    this.zaehler[regel] += anzahl;
  }
}

export function ortVon(datei: Datei, pos: number): Ort {
  const p = Math.max(0, Math.min(pos, datei.text.length));
  const lc = datei.sf.getLineAndCharacterOfPosition(p);
  return { seite: datei.seite, datei: datei.pfad, zeile: lc.line + 1, spalte: lc.character + 1 };
}

export function ortVonKnoten(datei: Datei, knoten: ts.Node): Ort {
  return ortVon(datei, knoten.getStart(datei.sf));
}

export function ortText(ort: Ort): string {
  return `${ort.seite === 'alt' ? 'old' : 'new'} ${ort.datei}:${ort.zeile}:${ort.spalte}`;
}

/** Shortens a piece of source text to one line for a message. */
export function kurz(text: string, laenge = 80): string {
  const eineZeile = text.replace(/\s+/g, ' ').trim();
  return eineZeile.length > laenge ? `${eineZeile.slice(0, laenge - 1)}...` : eineZeile;
}
