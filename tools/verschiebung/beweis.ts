/**
 * Move proof: the proof itself.
 *
 * `beweise` takes a manifest and the two states and returns the findings, the releases that were
 * used and the facts the output prints. It writes nothing and changes nothing.
 *
 * Guiding sentence: better a false red than a false green. What cannot be proven is a finding.
 */
import { wendeFreigabenAn } from './freigaben';
import { semantikPhase } from './semantikphase';
import type { Stand } from './stand';
import { liesDatei } from './stuecke';
import { syntaxPhase } from './syntaxphase';
import { Protokoll, type Datei, type Ergebnis, type Manifest, type ReihenfolgeBericht } from './typen';

/** Version of the tool. Printed into every output; raise it with every change of a rule. */
export const VERSION = 'verschiebung 1.2 (stage 1: form 0 and form k)';

/** What exit 0 does NOT prove. Printed into every output. */
export const GRENZEN: readonly string[] = [
  'Exit 0 proves that the source file, its rest and the target files differ only by the declared move. It proves nothing about other files: tests, test lists and everything a merge brought in between the two states.',
  'Installed packages (node_modules) are read from disk for both states. A change of package-lock.json between the states is not seen.',
  'The order of evaluation is compared from the entry files of the manifest only, each from an empty start. A module that is first loaded by a dynamic import or a worker needs its own entry.',
  'Imports that remain after compilation are found per file (as the bundler and tsx do it). Installed packages are walked as far as they are ES modules with static imports; CommonJS packages count as one module.',
  'Program files under test folders are left out when the programs for rule B7 are built. A global name that only a test file declares is not seen.',
  'Rule B9 judges the initial value of a moved declaration by its form. It does not run code: whether a released effect is harmless stays the reason of the release.',
  'Rule B9 (reads in front of the old place) works on names and over-approximates: every mention of a function, class or variable of the old file, every member name that is touched and every computed member access counts as a possible call, and a local declaration that hides a name is not recognised, so it can give findings too many. It does not follow code that is reached through `eval`, `Reflect`, a name built from text, another file or a global registry: a finding too few is possible there.',
  'Form k: that the context is the instance is proven by the form of the forwarder (`this` as first argument). What other callers pass to the function is not checked: the function is new and has no other callers in a mechanical step.',
  'Whitespace between tokens outside comments, strings and templates is not compared for form k (form 0 and the rest are byte-identical).',
  'Behaviour is not executed. The proof replaces neither the type check nor the tests nor a review of the releases.',
];

export interface BeweisEingabe {
  manifest: Manifest;
  alt: Stand;
  neu: Stand;
  /** Absolute folder of the repository on disk (for installed packages), or any name for states in memory. */
  wurzel: string;
}

export function beweise(e: BeweisEingabe): Ergebnis {
  const { manifest } = e;
  const p = new Protokoll();
  let gelockert: string[] = [];
  let reihenfolge: ReihenfolgeBericht[] = [];
  let fremdGeaendert: string[] = [];

  const ortDatei = (seite: 'alt' | 'neu', datei: string) => ({ seite, datei, zeile: 1, spalte: 1 });
  const altText = e.alt.lies(manifest.quelle);
  const restText = e.neu.lies(manifest.quelle);
  p.zaehle('B1', 2);
  if (altText === undefined) p.melde({ regel: 'B1', teil: 'quelle-fehlt', ort: ortDatei('alt', manifest.quelle), text: `the source file ${manifest.quelle} does not exist in the old state` });
  if (restText === undefined) p.melde({ regel: 'B1', teil: 'quelle-fehlt', ort: ortDatei('neu', manifest.quelle), text: `the source file ${manifest.quelle} does not exist in the new state: the large file stays at its path` });
  const ziele = new Map<string, Datei>();
  for (const z of manifest.ziele) {
    p.zaehle('B1');
    const text = e.neu.lies(z.datei);
    if (text === undefined) {
      p.melde({ regel: 'B1', teil: 'ziel-fehlt', ort: ortDatei('neu', z.datei), text: `the target file ${z.datei} does not exist in the new state` });
      continue;
    }
    if (e.alt.gibtEs(z.datei)) {
      p.melde({ regel: 'B12', teil: 'ziel-bestand', ort: ortDatei('alt', z.datei), text: `the target file ${z.datei} exists in the old state already: stage 1 moves into new files only` });
    }
    ziele.set(z.datei, liesDatei('neu', z.datei, text));
  }

  if (altText !== undefined && restText !== undefined) {
    const alt = liesDatei('alt', manifest.quelle, altText);
    const rest = liesDatei('neu', manifest.quelle, restText);
    const syntax = syntaxPhase(manifest, alt, rest, ziele, p);
    const semantik = semantikPhase({ manifest, wurzel: e.wurzel, standAlt: e.alt, standNeu: e.neu, alt, rest, ziele, syntax }, p);
    gelockert = semantik.gelockert;
    reihenfolge = semantik.reihenfolge;
    fremdGeaendert = semantik.fremdGeaendert;
    p.hinweis('B7', `program of the old state: ${semantik.programme.alt.dateien} files (${semantik.programme.alt.tsconfig ?? 'no tsconfig.json'}); program of the new state: ${semantik.programme.neu.dateien} files`);
  }

  const { offen, freigegeben } = wendeFreigabenAn(manifest, p);
  return {
    werkzeug: VERSION,
    manifest,
    staende: { alt: e.alt.kennung, neu: e.neu.kennung },
    befunde: offen,
    freigegeben,
    hinweise: p.hinweise,
    zaehler: p.zaehler,
    gelockert,
    reihenfolge,
    fremdGeaendert,
    grenzen: [...GRENZEN],
    exit: offen.length === 0 ? 0 : 1,
  };
}
