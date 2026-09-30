/**
 * Move proof, manifest: reads and validates the description of one step.
 *
 * Everything that influences the proof stands in the manifest, not in command line switches, and
 * the manifest is printed into the output. An unknown key, a release without a reason, a release
 * key of an unknown kind or a name that is listed twice is an error of the call (exit 2): the
 * proof does not start.
 */
import { FREIGABE_ARTEN, type Freigabe, type Manifest, type ZielAngabe } from './typen';

export class ManifestFehler extends Error {
  constructor(text: string) {
    super(text);
    this.name = 'ManifestFehler';
  }
}

const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const QUELLENDUNG = /\.(ts|tsx|mts|cts)$/;
/** Shortest reason a release may carry, counted in visible characters. */
export const BEGRUENDUNG_MINDESTENS = 20;

function istObjekt(w: unknown): w is Record<string, unknown> {
  return typeof w === 'object' && w !== null && !Array.isArray(w);
}

function nurSchluessel(o: Record<string, unknown>, erlaubt: readonly string[], wo: string): void {
  for (const k of Object.keys(o)) {
    if (!erlaubt.includes(k)) throw new ManifestFehler(`${wo}: unknown key "${k}" (allowed: ${erlaubt.join(', ')})`);
  }
}

function text(w: unknown, wo: string): string {
  if (typeof w !== 'string' || w.trim() === '') throw new ManifestFehler(`${wo}: expected a non-empty string`);
  return w;
}

function liste(w: unknown, wo: string): unknown[] {
  if (!Array.isArray(w)) throw new ManifestFehler(`${wo}: expected a list`);
  return w;
}

/** Repository relative path in POSIX form, without `..`, `./` or a leading slash. */
export function pfad(w: unknown, wo: string): string {
  const p = text(w, wo);
  if (p.startsWith('/') || p.includes('\\') || p.split('/').some((t) => t === '' || t === '.' || t === '..')) {
    throw new ManifestFehler(`${wo}: "${p}" is not a canonical path relative to the repository root`);
  }
  if (!QUELLENDUNG.test(p)) throw new ManifestFehler(`${wo}: "${p}" is not a TypeScript source file`);
  return p;
}

function name(w: unknown, wo: string): string {
  const n = text(w, wo);
  if (!NAME.test(n)) throw new ManifestFehler(`${wo}: "${n}" is not an identifier`);
  return n;
}

function stand(w: unknown, wo: string, arbeitsbaumErlaubt: boolean): string {
  const s = text(w, wo);
  if (/^git:[^\s:]+$/.test(s) || /^probe:[^\s]+$/.test(s)) return s;
  if (arbeitsbaumErlaubt && s === 'arbeitsbaum') return s;
  throw new ManifestFehler(`${wo}: "${s}" is neither "git:<ref>"${arbeitsbaumErlaubt ? ' nor "arbeitsbaum"' : ''}`);
}

/** Characters that carry no visible text: whitespace, zero width and format characters. */
const UNSICHTBAR = /[\s\u00a0\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufeff\uffa0]/gu;

function freigabe(w: unknown, wo: string): Freigabe {
  if (!istObjekt(w)) throw new ManifestFehler(`${wo}: expected an object with "schluessel" and "begruendung"`);
  nurSchluessel(w, ['schluessel', 'begruendung'], wo);
  const schluessel = text(w.schluessel, `${wo}.schluessel`);
  const art = schluessel.slice(0, schluessel.indexOf(':'));
  const stelle = schluessel.slice(schluessel.indexOf(':') + 1);
  if (!schluessel.includes(':') || !(FREIGABE_ARTEN as readonly string[]).includes(art)) {
    throw new ManifestFehler(`${wo}.schluessel: "${schluessel}" has no known kind (${FREIGABE_ARTEN.join(', ')})`);
  }
  if (stelle.trim() === '' || /[*?\s]/.test(stelle)) {
    throw new ManifestFehler(`${wo}.schluessel: "${schluessel}" must name exactly one place or name, without blanks or wildcards`);
  }
  if (typeof w.begruendung !== 'string') throw new ManifestFehler(`${wo}.begruendung: a release needs a reason`);
  const sichtbar = w.begruendung.replace(UNSICHTBAR, '');
  if (sichtbar.length < BEGRUENDUNG_MINDESTENS) {
    throw new ManifestFehler(
      `${wo}.begruendung: a release needs a reason of at least ${BEGRUENDUNG_MINDESTENS} visible characters (found ${sichtbar.length})`,
    );
  }
  return { schluessel, begruendung: w.begruendung };
}

function ziel(w: unknown, wo: string): ZielAngabe {
  if (!istObjekt(w)) throw new ManifestFehler(`${wo}: expected an object`);
  nurSchluessel(w, ['datei', 'woertlich', 'methoden', 'kontext'], wo);
  const datei = pfad(w.datei, `${wo}.datei`);
  const woertlich = liste(w.woertlich ?? [], `${wo}.woertlich`).map((n, i) => name(n, `${wo}.woertlich[${i}]`));
  const methoden = liste(w.methoden ?? [], `${wo}.methoden`).map((n, i) => name(n, `${wo}.methoden[${i}]`));
  if (woertlich.length + methoden.length === 0) throw new ManifestFehler(`${wo}: names neither "woertlich" nor "methoden"`);
  const aus: ZielAngabe = { datei, woertlich, methoden };
  if (w.kontext !== undefined) {
    if (!istObjekt(w.kontext)) throw new ManifestFehler(`${wo}.kontext: expected an object`);
    nurSchluessel(w.kontext, ['parameter', 'typ'], `${wo}.kontext`);
    aus.kontext = {
      parameter: name(w.kontext.parameter ?? 'k', `${wo}.kontext.parameter`),
      typ: name(w.kontext.typ, `${wo}.kontext.typ`),
    };
  }
  if (methoden.length > 0 && !aus.kontext) throw new ManifestFehler(`${wo}: "methoden" needs "kontext" with the name of the context type`);
  if (methoden.length === 0 && aus.kontext) throw new ManifestFehler(`${wo}: "kontext" without "methoden" explains nothing`);
  return aus;
}

function ohneDoppelte(namen: readonly string[], wo: string): void {
  const gesehen = new Set<string>();
  for (const n of namen) {
    if (gesehen.has(n)) throw new ManifestFehler(`${wo}: "${n}" is listed twice`);
    gesehen.add(n);
  }
}

/** Validates the parsed JSON of a manifest. Throws `ManifestFehler`. */
export function pruefeManifest(roh: unknown): Manifest {
  if (!istObjekt(roh)) throw new ManifestFehler('manifest: expected a JSON object');
  nurSchluessel(roh, ['version', 'alt', 'neu', 'quelle', 'klasse', 'ziele', 'einstiege', 'freigaben'], 'manifest');
  if (roh.version !== 1) throw new ManifestFehler('manifest.version: expected 1');
  const quelle = pfad(roh.quelle, 'manifest.quelle');
  const ziele = liste(roh.ziele, 'manifest.ziele').map((z, i) => ziel(z, `manifest.ziele[${i}]`));
  if (ziele.length === 0) throw new ManifestFehler('manifest.ziele: a step needs at least one target file');
  ohneDoppelte(ziele.map((z) => z.datei), 'manifest.ziele (datei)');
  if (ziele.some((z) => z.datei === quelle)) throw new ManifestFehler('manifest.ziele: the source file cannot be a target file');
  ohneDoppelte(ziele.flatMap((z) => z.woertlich), 'manifest.ziele (woertlich)');
  ohneDoppelte(ziele.flatMap((z) => z.methoden), 'manifest.ziele (methoden)');
  // A method becomes a function of the module level: its name must not meet a moved declaration.
  ohneDoppelte(ziele.flatMap((z) => [...z.woertlich, ...z.methoden]), 'manifest.ziele (woertlich and methoden together)');
  const brauchtKlasse = ziele.some((z) => z.methoden.length > 0);
  const klasse = roh.klasse === undefined ? undefined : name(roh.klasse, 'manifest.klasse');
  if (brauchtKlasse && klasse === undefined) throw new ManifestFehler('manifest.klasse: "methoden" needs the name of the class');
  if (!brauchtKlasse && klasse !== undefined) throw new ManifestFehler('manifest.klasse: named, but no target lists "methoden"');
  const einstiege = liste(roh.einstiege, 'manifest.einstiege').map((e, i) => pfad(e, `manifest.einstiege[${i}]`));
  if (einstiege.length === 0) throw new ManifestFehler('manifest.einstiege: rule B10 needs at least one entry file');
  ohneDoppelte(einstiege, 'manifest.einstiege');
  const freigaben = liste(roh.freigaben ?? [], 'manifest.freigaben').map((f, i) => freigabe(f, `manifest.freigaben[${i}]`));
  ohneDoppelte(freigaben.map((f) => f.schluessel), 'manifest.freigaben (schluessel)');
  const manifest: Manifest = {
    version: 1,
    alt: stand(roh.alt, 'manifest.alt', false),
    neu: stand(roh.neu, 'manifest.neu', true),
    quelle,
    ziele,
    einstiege,
    freigaben,
  };
  if (klasse !== undefined) manifest.klasse = klasse;
  return manifest;
}

/** Reads a manifest from JSON text. Throws `ManifestFehler`. */
export function leseManifest(json: string): Manifest {
  let roh: unknown;
  try {
    roh = JSON.parse(json);
  } catch (e) {
    throw new ManifestFehler(`manifest: not valid JSON (${(e as Error).message})`);
  }
  return pruefeManifest(roh);
}
