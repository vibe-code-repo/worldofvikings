/**
 * Move proof, second phase: everything that needs the type checker or the import graph
 * (rule B7, the semantic part of rule B5, rule B10).
 *
 * The two programs are built one after the other. The answers of the old program are kept as
 * plain data, then the program is released before the new one is built, so that the two never
 * hold their type information at the same time.
 */
import { beschreibe, pruefeBindung, type Deskriptor } from './bindung';
import { pruefeZuweisungen } from './laden';
import { pruefeAufruf, pruefeKontexttyp, pruefeLockerung } from './kontexttyp';
import { baueProgramm, type Programm } from './programm';
import { ModulGraph, vergleicheOrdnung } from './reihenfolge';
import type { Stand } from './stand';
import type { SyntaxErgebnis } from './syntaxphase';
import { ortVon, ortVonKnoten, type Datei, type Manifest, type Protokoll, type ReihenfolgeBericht } from './typen';

export interface SemantikEingabe {
  manifest: Manifest;
  wurzel: string;
  standAlt: Stand;
  standNeu: Stand;
  alt: Datei;
  rest: Datei;
  ziele: ReadonlyMap<string, Datei>;
  syntax: SyntaxErgebnis;
}

export interface SemantikErgebnis {
  gelockert: string[];
  reihenfolge: ReihenfolgeBericht[];
  fremdGeaendert: string[];
  programme: { alt: { dateien: number; tsconfig: string | null }; neu: { dateien: number; tsconfig: string | null } };
}

export function reihenfolgeSchluessel(einstieg: string, modul: string): string {
  return `reihenfolge:${einstieg}:${modul}`;
}

export function semantikPhase(e: SemantikEingabe, p: Protokoll): SemantikErgebnis {
  const { manifest, syntax } = e;
  const zielPfade = manifest.ziele.map((z) => z.datei).filter((d) => e.ziele.has(d));
  const fremd = new Set<string>();

  // -- rule B7: the old program answers first and is released --
  let altProgramm: Programm | null = baueProgramm({ wurzel: e.wurzel, stand: e.standAlt }, manifest.quelle, []);
  const altInfo = { dateien: altProgramm.dateien, tsconfig: altProgramm.tsconfig };
  const altAntworten: Map<string, Deskriptor> = beschreibe(altProgramm, manifest.quelle, syntax.bezeichner.filter((b) => !b.ueberspringen && !b.erwartet).map((b) => b.alt));
  // Rule B12 (form 0): which assigned names are the moved variable itself, decided by the binding in the old program.
  pruefeZuweisungen(syntax.zuweisungen, beschreibe(altProgramm, manifest.quelle, syntax.zuweisungen.flatMap((z) => [z.ziel, ...z.deklariert])), e.alt, p);
  altProgramm = null;

  const neu = baueProgramm({ wurzel: e.wurzel, stand: e.standNeu }, manifest.quelle, zielPfade);
  const neuAntworten = new Map<string, Map<string, Deskriptor>>();
  for (const datei of [manifest.quelle, ...zielPfade]) {
    neuAntworten.set(datei, beschreibe(neu, datei, syntax.bezeichner.filter((b) => !b.ueberspringen && b.neu.datei === datei).map((b) => b.neu)));
  }
  const dateiVon = (pfad: string): Datei | undefined => (pfad === e.rest.pfad ? e.rest : e.ziele.get(pfad));
  const bindung = pruefeBindung(
    {
      quelle: manifest.quelle,
      paare: syntax.bezeichner,
      knotenPaare: syntax.knotenPaare,
      alt: altAntworten,
      neu: neuAntworten,
      standAlt: e.standAlt,
      standNeu: e.standNeu,
      schrittDateien: new Set([manifest.quelle, ...zielPfade]),
      ortAlt: (pos) => ortVon(e.alt, pos),
      ortNeu: (datei, pos) => {
        const d = dateiVon(datei);
        return d ? ortVon(d, pos) : { seite: 'neu', datei, zeile: 1, spalte: 1 };
      },
      gestoert: syntax.gestoert,
    },
    p,
  );
  for (const f of bindung.fremdGeaendert) fremd.add(f);
  if (bindung.inGestoertem > 0) p.hinweis('B7', `${bindung.inGestoertem} identifiers point into a piece that already carries a finding of rule B2 or B3: their binding was not judged`);
  if (bindung.ohneSymbol > 0) p.hinweis('B7', `${bindung.ohneSymbol} member names have no declaration the type checker knows, in both states (members of values without a known type)`);

  // -- rule B5 with the type checker --
  let gelockert: string[] = [];
  if (manifest.klasse !== undefined) {
    const kontext = pruefeKontexttyp(syntax.zerlegung, neu, manifest.klasse, p);
    for (const a of syntax.aufrufe) pruefeAufruf(a.name, a.aufgerufen, e.rest, a.funktion, neu, p);
    gelockert = pruefeLockerung(syntax.gelockert, kontext, p);
  }

  // -- rule B10 --
  const reihenfolge: ReihenfolgeBericht[] = [];
  const graphAlt = new ModulGraph({ wurzel: e.wurzel, stand: e.standAlt });
  const graphNeu = new ModulGraph({ wurzel: e.wurzel, stand: e.standNeu });
  const zielMenge = new Set(zielPfade);
  for (const u of syntax.zerlegung.importe.umgestellt) {
    p.zaehle('B10');
    p.melde({ regel: 'B10', teil: 'importzeile-umgestellt', ort: ortVonKnoten(e.rest, u.neu.knoten), text: `the import ${(u.neu.knoten as { moduleSpecifier?: { getText(): string } }).moduleSpecifier?.getText() ?? ''} stands at another place among the imports than in the old state (old line ${ortVonKnoten(e.alt, u.alt.knoten).zeile}): the import lines of the old state keep their order` });
  }
  for (const einstieg of manifest.einstiege) {
    p.zaehle('B10');
    const inAlt = e.standAlt.gibtEs(einstieg);
    const inNeu = e.standNeu.gibtEs(einstieg);
    if (!inAlt || !inNeu) {
      p.melde({ regel: 'B10', teil: 'einstieg-fehlt', ort: { seite: inAlt ? 'neu' : 'alt', datei: einstieg, zeile: 1, spalte: 1 }, text: `entry file ${einstieg} does not exist in the ${inAlt ? 'new' : 'old'} state` });
      continue;
    }
    const ordAlt = graphAlt.reihenfolge(einstieg);
    const ordNeu = graphNeu.reihenfolge(einstieg);
    if (!ordAlt.includes(manifest.quelle)) {
      p.melde({ regel: 'B10', teil: 'einstieg-ohne-quelle', ort: { seite: 'alt', datei: einstieg, zeile: 1, spalte: 1 }, text: `entry file ${einstieg} does not load the source file ${manifest.quelle} in the old state: it says nothing about this step` });
    }
    const v = vergleicheOrdnung(einstieg, ordAlt, ordNeu, zielMenge);
    reihenfolge.push(v.bericht);
    p.zaehle('B10', ordAlt.length);
    for (const a of v.abweichungen) {
      const stand = a.art === 'nicht-mehr-geladen' ? e.standAlt : e.standNeu;
      if (stand.gibtEs(a.modul) && e.standAlt.inhaltsHash(a.modul) !== e.standNeu.inhaltsHash(a.modul)) fremd.add(a.modul);
      p.melde({ regel: 'B10', teil: a.art, ort: { seite: a.art === 'nicht-mehr-geladen' ? 'alt' : 'neu', datei: einstieg, zeile: 1, spalte: 1 }, text: `from ${einstieg}: ${a.text}`, freigabe: reihenfolgeSchluessel(einstieg, a.modul) });
    }
  }
  p.zaehle('B10');
  const zyklus = graphNeu.zyklus([manifest.quelle, ...zielPfade]);
  if (zyklus) {
    p.melde({ regel: 'B10', teil: 'zyklus', ort: { seite: 'neu', datei: zyklus[0]!, zeile: 1, spalte: 1 }, text: `imports that remain after compilation form a cycle between the rest and the target files: ${zyklus.join(' -> ')}` });
  }
  for (const t of zielPfade) fremd.delete(t);
  fremd.delete(manifest.quelle);

  return { gelockert, reihenfolge, fremdGeaendert: [...fremd].sort(), programme: { alt: altInfo, neu: { dateien: neu.dateien, tsconfig: neu.tsconfig } } };
}
