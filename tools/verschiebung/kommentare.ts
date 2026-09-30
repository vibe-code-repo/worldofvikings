/**
 * Move proof, rule B6: comments.
 *
 * All comments of both states are read, whole files. Comments inside a moved declaration must be
 * the same in the target. With form k the indentation may drop: every further line of a block
 * comment loses exactly as many leading blanks as the start of the comment moved to the left, or
 * the comment is unchanged.
 *
 * Directive comments (`@ts-ignore`, `eslint-disable`, `@vite-ignore` and the like) change what the
 * type checker, the linter or the bundler do. In the new state they may stand only where they stood
 * in the old one, at the same declaration. In glue, at the head of a target file and in a forwarder
 * they are a finding.
 */
import ts from 'typescript';
import { blaetter } from './stuecke';
import { kurz, ortVon, type Datei, type Protokoll } from './typen';

const K = ts.SyntaxKind;

export interface Kommentar {
  von: number;
  bis: number;
  text: string;
  /** Column of the first character of the comment, 0-based. */
  spalte: number;
  /** The directive the comment carries, or `null`. */
  wirkung: string | null;
}

/** Directives: the list of the task card and what else changes the work of a tool. */
const WIRKUNGEN: readonly RegExp[] = [
  /@ts-(?:ignore|expect-error|nocheck|check)\b/,
  /\beslint-(?:disable|enable|env)\b[\w-]*/,
  /\bprettier-ignore\b[\w-]*/,
  /@vite-ignore\b/,
  /\bistanbul\b/,
  /\bc8\b/,
  /\bv8 ignore\b/,
  /\bwebpack\w*/,
  /[@#]?__(?:PURE|NO_SIDE_EFFECTS)__/,
  /^\/\/\/\s*<(?:reference|amd-)[^>]*/,
  /@jsx\w*/,
  /[#@]\s*sourceMappingURL/,
  /\bbiome-ignore\b/,
];

export function wirkungVon(text: string): string | null {
  for (const w of WIRKUNGEN) {
    const m = w.exec(text);
    if (m) return m[0];
  }
  return null;
}

const KOMMENTAR = /\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g;

const zwischenspeicher = new WeakMap<ts.SourceFile, Kommentar[]>();

/** All comments of a file in order. Read from the gaps between the tokens, so text inside strings is never taken for a comment. */
export function kommentareVon(datei: Datei): Kommentar[] {
  const bekannt = zwischenspeicher.get(datei.sf);
  if (bekannt) return bekannt;
  const aus: Kommentar[] = [];
  let ende = 0;
  for (const b of blaetter(datei.sf, datei.sf)) {
    if (b.end === b.pos && b.kind !== K.EndOfFileToken) continue; // empty lists have no text of their own
    const start = b.kind === K.EndOfFileToken ? b.end : b.getStart(datei.sf);
    if (start > ende) {
      const luecke = datei.text.slice(ende, start);
      for (const m of luecke.matchAll(KOMMENTAR)) {
        const von = ende + m.index;
        const zeilenStart = Math.max(datei.text.lastIndexOf('\n', von - 1), datei.text.lastIndexOf('\r', von - 1)) + 1;
        aus.push({ von, bis: von + m[0].length, text: m[0], spalte: von - zeilenStart, wirkung: wirkungVon(m[0]) });
      }
    }
    ende = Math.max(ende, b.end);
  }
  zwischenspeicher.set(datei.sf, aus);
  return aus;
}

export function kommentareIn(datei: Datei, von: number, bis: number): Kommentar[] {
  return kommentareVon(datei).filter((k) => k.von >= von && k.bis <= bis);
}

const RAND = /^[ \t]*/;

/**
 * Is `neu` the comment `alt`, moved to the left by the columns its start moved?
 * Returns `null` if so, otherwise what differs.
 */
export function vergleicheKommentar(alt: Kommentar, neu: Kommentar): string | null {
  if (alt.text === neu.text) return null;
  const a = alt.text.split(/\r\n|\n|\r/);
  const n = neu.text.split(/\r\n|\n|\r/);
  if (a.length !== n.length) return `comment has ${a.length} lines in the old state and ${n.length} in the new one`;
  if (a[0] !== n[0]) return `first line differs: "${kurz(a[0]!, 50)}" against "${kurz(n[0]!, 50)}"`;
  const d = alt.spalte - neu.spalte;
  if (d <= 0) return 'text differs although the comment did not move to the left';
  for (let i = 1; i < a.length; i++) {
    const za = a[i]!;
    const zn = n[i]!;
    if (za === zn && za.trim() === '') continue; // an empty line stays an empty line
    const rand = RAND.exec(za)![0].length;
    if (rand < d) return `line ${i + 1} of the comment has ${rand} leading blanks, fewer than the ${d} columns the comment moved: its text would change, it must stay as it is`;
    if (za.slice(d) !== zn) return `line ${i + 1} of the comment differs by more than ${d} leading blanks: "${kurz(za, 50)}" against "${kurz(zn, 50)}"`;
  }
  return null;
}

export type BereichArt = 'klebstoff' | 'kopf' | 'weiterleitung' | 'schluss' | 'kontexttyp';

export interface KlebstoffBereich {
  datei: Datei;
  von: number;
  bis: number;
  art: BereichArt;
  was: string;
}

/** Directive comments in glue are a finding. A forwarder carries no comment at all. */
export function pruefeKlebstoffKommentare(bereiche: readonly KlebstoffBereich[], p: Protokoll): void {
  for (const b of bereiche) {
    for (const k of kommentareIn(b.datei, b.von, b.bis)) {
      p.zaehle('B6');
      if (k.wirkung !== null) {
        p.melde({ regel: 'B6', teil: `wirkung-${b.art}`, ort: ortVon(b.datei, k.von), text: `directive comment "${k.wirkung}" in ${b.was}: "${kurz(k.text, 60)}"` });
      } else if (b.art === 'weiterleitung') {
        p.melde({ regel: 'B6', teil: 'kommentar-weiterleitung', ort: ortVon(b.datei, k.von), text: `comment in ${b.was}: "${kurz(k.text, 60)}" (the comments of the method moved with it; only a section line that stood there may stay)` });
      }
    }
  }
}

/**
 * Comments of a moved declaration: the same comments in the same order.
 * `wortgleich` is true for form 0 (byte-identical), false for form k (indentation may drop).
 */
export function pruefeVerschobeneKommentare(name: string, alt: { datei: Datei; von: number; bis: number }, neu: { datei: Datei; von: number; bis: number }, wortgleich: boolean, p: Protokoll): void {
  const ka = kommentareIn(alt.datei, alt.von, alt.bis);
  const kn = kommentareIn(neu.datei, neu.von, neu.bis);
  p.zaehle('B6', Math.max(ka.length, kn.length));
  const n = Math.min(ka.length, kn.length);
  for (let i = 0; i < n; i++) {
    const a = ka[i]!;
    const b = kn[i]!;
    const u = wortgleich ? (a.text === b.text ? null : `text differs: "${kurz(a.text, 50)}" against "${kurz(b.text, 50)}"`) : vergleicheKommentar(a, b);
    if (u !== null) {
      const teil = a.wirkung !== null || b.wirkung !== null ? 'wirkung-verschoben' : 'kommentar';
      p.melde({ regel: 'B6', teil, ort: ortVon(neu.datei, b.von), text: `"${name}": comment ${i + 1} of the declaration is not the comment of the old state (old line ${ortVon(alt.datei, a.von).zeile}): ${u}` });
      return;
    }
  }
  if (ka.length !== kn.length) {
    const mehr = ka.length > kn.length ? ka[n]! : kn[n]!;
    const seite = ka.length > kn.length ? alt.datei : neu.datei;
    const teil = mehr.wirkung !== null ? 'wirkung-verschoben' : 'kommentar';
    p.melde({
      regel: 'B6',
      teil,
      ort: ortVon(seite, mehr.von),
      text: `"${name}": the declaration has ${ka.length} comments in the old state and ${kn.length} in the new one; first surplus comment${mehr.wirkung !== null ? ` (directive "${mehr.wirkung}")` : ''}: "${kurz(mehr.text, 60)}"`,
    });
  }
}
