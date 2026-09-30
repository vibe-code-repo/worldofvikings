/**
 * Move proof: the imports of the old source file against the imports of the rest.
 *
 * An import of the old state is in the rest unchanged, in the rest with some names taken out, or
 * gone. What stands in the rest and is none of these is a new import. The imports of the old
 * state are looked for in their order: an import that is found at another place was moved within
 * the list, and that is reported by rule B10.
 */
import ts from 'typescript';
import type { Stueck } from './typen';

export interface ImportForm {
  quelle: string;
  nurTyp: boolean;
  standard: string | null;
  namensraum: string | null;
  namen: { schluessel: string; lokal: string }[];
  attribute: string;
}

export interface ImportPaar {
  alt: Stueck;
  neu: Stueck;
  /** Local names the import lost. */
  entfernt: string[];
}

export interface ImportZuordnung {
  paare: ImportPaar[];
  /** Imports of the old state that are not in the rest. */
  entfernt: Stueck[];
  /** Imports of the rest that the old state does not have. */
  neu: Stueck[];
  /** Imports of the old state that stand in the rest at another place in the order of the imports. */
  umgestellt: ImportPaar[];
}

export function importForm(s: Stueck): ImportForm {
  const d = s.knoten as ts.ImportDeclaration;
  const sf = s.datei.sf;
  const ic = d.importClause;
  const namen: ImportForm['namen'] = [];
  let namensraum: string | null = null;
  if (ic?.namedBindings) {
    if (ts.isNamespaceImport(ic.namedBindings)) namensraum = ic.namedBindings.name.text;
    else {
      for (const e of ic.namedBindings.elements) {
        namen.push({ schluessel: `${e.isTypeOnly ? 'type ' : ''}${e.propertyName ? `${e.propertyName.text} as ` : ''}${e.name.text}`, lokal: e.name.text });
      }
    }
  }
  return {
    quelle: d.moduleSpecifier.getText(sf),
    nurTyp: !!ic?.isTypeOnly,
    standard: ic?.name ? ic.name.text : null,
    namensraum,
    namen,
    attribute: d.attributes ? d.attributes.getText(sf) : '',
  };
}

/** Names of the old import that the new one lost, or `null` if the new one is not the old one with names removed. */
export function verlust(alt: ImportForm, neu: ImportForm): string[] | null {
  if (alt.quelle !== neu.quelle || alt.nurTyp !== neu.nurTyp || alt.standard !== neu.standard || alt.namensraum !== neu.namensraum || alt.attribute !== neu.attribute) return null;
  if (alt.namen.length > 0 && neu.namen.length === 0 && alt.standard === null) return null; // `import {} from` loads, but binds nothing: not the same import
  let j = 0;
  const entfernt: string[] = [];
  for (const a of alt.namen) {
    if (j < neu.namen.length && neu.namen[j]!.schluessel === a.schluessel) j++;
    else entfernt.push(a.lokal);
  }
  return j === neu.namen.length ? entfernt : null;
}

export function ordneImporteZu(importeAlt: readonly Stueck[], importeRest: readonly Stueck[]): ImportZuordnung {
  const paare: ImportPaar[] = [];
  const entfernt: Stueck[] = [];
  const neu: Stueck[] = [];
  let j = 0;
  for (const a of importeAlt) {
    const fa = importForm(a);
    let treffer = -1;
    let verloren: string[] = [];
    for (let k = j; k < importeRest.length; k++) {
      const v = verlust(fa, importForm(importeRest[k]!));
      if (v) {
        treffer = k;
        verloren = v;
        break;
      }
    }
    if (treffer < 0) {
      entfernt.push(a);
      continue;
    }
    for (let k = j; k < treffer; k++) neu.push(importeRest[k]!);
    paare.push({ alt: a, neu: importeRest[treffer]!, entfernt: verloren });
    j = treffer + 1;
  }
  for (let k = j; k < importeRest.length; k++) neu.push(importeRest[k]!);
  // An import of the old state that is in the rest, only at another place, was moved within the list of imports.
  const umgestellt: ImportPaar[] = [];
  for (const a of [...entfernt]) {
    const fa = importForm(a);
    let verloren: string[] | null = null;
    const r = neu.find((x) => (verloren = verlust(fa, importForm(x))) !== null);
    if (!r || verloren === null) continue;
    umgestellt.push({ alt: a, neu: r, entfernt: verloren });
    entfernt.splice(entfernt.indexOf(a), 1);
    neu.splice(neu.indexOf(r), 1);
  }
  return { paare, entfernt, neu, umgestellt };
}
