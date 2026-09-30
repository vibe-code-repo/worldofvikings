/**
 * Test bench of the move proof: fixtures in memory.
 *
 * A fixture is a small tree of source texts for the old state, a cut built by the mover, and
 * optionally a forgery laid on top. The self-tests state for every fixture exactly which rules
 * must report a finding. "Red" alone is not enough: a forgery that is caught by the wrong rule
 * would hide that the right rule is blind.
 */
import { beweise } from '../beweis';
import { pruefeManifest } from '../manifest';
import { SpeicherStand } from '../stand';
import type { Ergebnis, Freigabe, Manifest, RegelId } from '../typen';
import { verschiebe, type Auftrag, type Schnitt } from './verschieber';

/** Folder the states of a fixture appear under. Nothing exists there on disk. */
export const PROBE_WURZEL = '/verschiebung-probe';

export const TSCONFIG = JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022'], strict: true, noEmit: true, types: [], skipLibCheck: true },
  include: ['src/**/*.ts'],
});

export interface Eingabe {
  alt: Record<string, string>;
  neu: Record<string, string>;
  manifest: Manifest;
  schnitt: Schnitt;
  auftrag: Auftrag;
}

export interface Zusatz {
  /** Further files of the tree, the same in both states: modules the source imports. */
  dateien?: Record<string, string>;
  einstiege?: string[];
  freigaben?: Freigabe[];
}

/** Builds the fixture for a mechanically right cut. */
export function schnitt(altText: string, auftrag: Auftrag, zusatz: Zusatz = {}): Eingabe {
  const s = verschiebe(altText, auftrag);
  const gemeinsam: Record<string, string> = { 'tsconfig.json': TSCONFIG, ...(zusatz.dateien ?? {}) };
  const manifest = pruefeManifest({
    version: 1,
    alt: 'probe:alt',
    neu: 'probe:neu',
    quelle: auftrag.quelle,
    ...(auftrag.klasse !== undefined && auftrag.ziele.some((z) => (z.methoden ?? []).length > 0) ? { klasse: auftrag.klasse } : {}),
    ziele: auftrag.ziele.map((z) => ({
      datei: z.datei,
      woertlich: z.woertlich ?? [],
      methoden: z.methoden ?? [],
      ...((z.methoden ?? []).length > 0 ? { kontext: { parameter: z.kontext?.parameter ?? 'k', typ: z.kontext?.typ ?? 'Kontext' } } : {}),
    })),
    einstiege: zusatz.einstiege ?? [auftrag.quelle],
    freigaben: zusatz.freigaben ?? [],
  });
  return { alt: { ...gemeinsam, [auftrag.quelle]: altText }, neu: { ...gemeinsam, [auftrag.quelle]: s.rest, ...s.ziele, ...s.weitere }, manifest, schnitt: s, auftrag };
}

export interface Aenderung {
  /** Changes the rest. */
  rest?: (text: string) => string;
  /** Changes target files, by path. */
  ziel?: Record<string, (text: string) => string>;
  /** Changes the old source file. */
  alt?: (text: string) => string;
  /** Adds, replaces (text) or removes (`null`) files of the new state. */
  neu?: Record<string, string | null>;
  /** Adds or replaces files of the old state. */
  altDateien?: Record<string, string>;
  manifest?: (m: Manifest) => Manifest;
  freigaben?: Freigabe[];
}

/** Throws if a forgery changed nothing: a fixture that tests nothing must not pass. */
export function muss(vorher: string, nachher: string, was = ''): string {
  if (vorher === nachher) throw new Error(`forgery changed nothing${was ? `: ${was}` : ''}`);
  return nachher;
}

export function mit(e: Eingabe, a: Aenderung): Eingabe {
  const alt = { ...e.alt, ...(a.altDateien ?? {}) };
  const neu: Record<string, string> = { ...e.neu };
  const quelle = e.manifest.quelle;
  if (a.alt) alt[quelle] = muss(alt[quelle]!, a.alt(alt[quelle]!), 'old source');
  if (a.rest) neu[quelle] = muss(neu[quelle]!, a.rest(neu[quelle]!), 'rest');
  for (const [datei, f] of Object.entries(a.ziel ?? {})) {
    if (neu[datei] === undefined) throw new Error(`no target file ${datei} in the fixture`);
    neu[datei] = muss(neu[datei]!, f(neu[datei]!), datei);
  }
  for (const [datei, text] of Object.entries(a.neu ?? {})) {
    if (text === null) delete neu[datei];
    else neu[datei] = text;
  }
  let manifest = e.manifest;
  if (a.freigaben) manifest = { ...manifest, freigaben: [...manifest.freigaben, ...a.freigaben] };
  if (a.manifest) manifest = a.manifest(manifest);
  return { ...e, alt, neu, manifest };
}

export function laufe(e: Eingabe): Ergebnis {
  return beweise({ manifest: e.manifest, alt: new SpeicherStand('alt', e.alt), neu: new SpeicherStand('neu', e.neu), wurzel: PROBE_WURZEL });
}

export interface Fall {
  id: string;
  name: string;
  /** Rules that must report at least one open finding. Empty: the proof must be given. */
  soll: readonly RegelId[];
  eingabe: Eingabe | (() => Eingabe);
  /** Checks inside rules (`B5/weiterleitung-kontext`) that must be among the findings. */
  teile?: readonly string[];
  /** Release keys that must have been used. */
  freigegeben?: readonly string[];
}

export interface Ausgang {
  id: string;
  name: string;
  soll: readonly RegelId[];
  ist: RegelId[];
  ok: boolean;
  grund: string;
  ergebnis: Ergebnis | null;
}

export function pruefeFall(f: Fall): Ausgang {
  let ergebnis: Ergebnis | null = null;
  let ist: RegelId[] = [];
  let grund = '';
  try {
    ergebnis = laufe(typeof f.eingabe === 'function' ? f.eingabe() : f.eingabe);
    ist = [...new Set(ergebnis.befunde.map((b) => b.regel))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  } catch (e) {
    grund = `exception: ${(e as Error).stack ?? String(e)}`;
  }
  const soll = [...f.soll].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  let ok = grund === '' && soll.join() === ist.join();
  if (!ok && grund === '') grund = `rules with findings: expected [${soll.join(', ')}], found [${ist.join(', ')}]`;
  if (ok && ergebnis) {
    const vorhanden = new Set(ergebnis.befunde.map((b) => `${b.regel}/${b.teil}`));
    const fehlt = (f.teile ?? []).filter((t) => !vorhanden.has(t));
    if (fehlt.length > 0) {
      ok = false;
      grund = `missing checks: ${fehlt.join(', ')}; found: ${[...vorhanden].join(', ')}`;
    }
    const benutzt = new Set(ergebnis.freigegeben.map((x) => x.freigabe.schluessel));
    const ungenutzt = (f.freigegeben ?? []).filter((s) => !benutzt.has(s));
    if (ok && ungenutzt.length > 0) {
      ok = false;
      grund = `releases not used: ${ungenutzt.join(', ')}`;
    }
    if (ok && (ergebnis.exit === 0) !== (soll.length === 0)) {
      ok = false;
      grund = `exit ${ergebnis.exit} does not fit the findings`;
    }
  }
  return { id: f.id, name: f.name, soll, ist, ok, grund, ergebnis };
}

/** Runs the cases of one self-test, prints one line per case and returns the number of failures. */
export class Lauf {
  private faelle = 0;
  private rot = 0;
  readonly ausgaenge: Ausgang[] = [];

  constructor(private readonly titel: string) {}

  abschnitt(text: string): void {
    console.log(`\n-- ${text} --`);
  }

  fall(f: Fall): Ausgang {
    const a = pruefeFall(f);
    this.faelle++;
    this.ausgaenge.push(a);
    const zeichen = a.soll.length === 0 ? 'green' : `red [${a.soll.join(',')}]`;
    if (a.ok) {
      console.log(`ok    ${a.id.padEnd(8)} ${zeichen.padEnd(16)} ${a.name}`);
    } else {
      this.rot++;
      console.log(`FAIL  ${a.id.padEnd(8)} ${zeichen.padEnd(16)} ${a.name}\n        ${a.grund}`);
      for (const b of a.ergebnis?.befunde.slice(0, 6) ?? []) console.log(`        [${b.regel} ${b.teil}] ${b.ort.datei}:${b.ort.zeile}: ${b.text.slice(0, 220)}`);
    }
    return a;
  }

  /** A check that is not a proof run. */
  pruefe(id: string, name: string, bedingung: boolean, zeuge = ''): void {
    this.faelle++;
    if (bedingung) console.log(`ok    ${id.padEnd(8)} ${''.padEnd(16)} ${name}`);
    else {
      this.rot++;
      console.log(`FAIL  ${id.padEnd(8)} ${''.padEnd(16)} ${name}\n        ${zeuge}`);
    }
  }

  ende(): never {
    console.log(this.rot === 0 ? `\n${this.titel}: ${this.faelle} cases, all as expected.` : `\n${this.titel}: ${this.rot} of ${this.faelle} cases FAILED.`);
    process.exit(this.rot === 0 ? 0 : 1);
  }
}
