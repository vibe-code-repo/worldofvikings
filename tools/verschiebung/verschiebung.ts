/**
 * Move proof, command line.
 *
 *   node_modules/.bin/tsx tools/verschiebung/verschiebung.ts <manifest.json> [--json]
 *
 * The manifest describes the step (see `README.md` in this folder). Exit 0: proof given.
 * Exit 1: at least one finding. Exit 2: call or manifest wrong.
 *
 * A run on a real file builds two TypeScript programs and is a heavy run. On the build host it
 * belongs under the lock: `tools/sperre.sh build -- node_modules/.bin/tsx tools/verschiebung/verschiebung.ts <manifest>`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alsJson, alsText } from './ausgabe';
import { VERSION, beweise } from './beweis';
import { ManifestFehler, leseManifest } from './manifest';
import { ArbeitsbaumStand, GitStand, repoWurzel, type Stand } from './stand';
import type { Manifest } from './typen';

const HILFE = `${VERSION}

usage: tsx tools/verschiebung/verschiebung.ts <manifest.json> [--json]

  <manifest.json>  description of the step: states, source file, target files, entry files, releases
  --json           print the result as JSON instead of text

exit 0: proof given   exit 1: findings   exit 2: call or manifest wrong
`;

export interface Aufruf {
  manifestPfad: string;
  json: boolean;
}

export function leseAufruf(argv: readonly string[]): Aufruf | 'hilfe' {
  let manifestPfad: string | null = null;
  let json = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') return 'hilfe';
    else if (a.startsWith('-')) throw new ManifestFehler(`unknown switch ${a}: everything that influences the proof stands in the manifest`);
    else if (manifestPfad !== null) throw new ManifestFehler(`more than one manifest: ${manifestPfad} and ${a}`);
    else manifestPfad = a;
  }
  if (manifestPfad === null) throw new ManifestFehler('no manifest given');
  return { manifestPfad, json };
}

function oeffne(angabe: string, wurzel: string, was: string): Stand {
  if (angabe === 'arbeitsbaum') return new ArbeitsbaumStand(wurzel);
  if (angabe.startsWith('git:')) {
    try {
      return new GitStand(wurzel, angabe.slice(4));
    } catch (e) {
      throw new ManifestFehler(`${was}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  throw new ManifestFehler(`${was}: "${angabe}" cannot be opened from the command line`);
}

/** Packages of the repository that one git process reads ahead for a TypeScript program. */
function ladeVorab(stand: Stand, manifest: Manifest): void {
  if (!(stand instanceof GitStand)) return;
  const paket = manifest.quelle.split('/')[0] ?? '';
  stand.ladeVorab((p) => (p.startsWith(`${paket}/`) || p.startsWith('shared/')) && /\.(ts|tsx|mts|cts|json)$/.test(p) && !/(^|\/)(test|tests)\//.test(p));
}

export function haupt(argv: readonly string[], schreibe: (text: string) => void, fehler: (text: string) => void): number {
  try {
    const aufruf = leseAufruf(argv);
    if (aufruf === 'hilfe') {
      schreibe(HILFE);
      return 0;
    }
    let json: string;
    try {
      json = readFileSync(resolve(aufruf.manifestPfad), 'utf8');
    } catch (e) {
      throw new ManifestFehler(`cannot read ${aufruf.manifestPfad}: ${(e as Error).message}`);
    }
    const manifest = leseManifest(json);
    const wurzel = repoWurzel(process.cwd());
    const alt = oeffne(manifest.alt, wurzel, 'manifest.alt');
    const neu = oeffne(manifest.neu, wurzel, 'manifest.neu');
    ladeVorab(alt, manifest);
    ladeVorab(neu, manifest);
    const ergebnis = beweise({ manifest, alt, neu, wurzel });
    schreibe(aufruf.json ? alsJson(ergebnis) : alsText(ergebnis));
    return ergebnis.exit;
  } catch (e) {
    if (e instanceof ManifestFehler) {
      fehler(`verschiebung: ${e.message}\n`);
      return 2;
    }
    fehler(`verschiebung: the proof broke off: ${(e as Error).stack ?? String(e)}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = haupt(process.argv.slice(2), (t) => process.stdout.write(t), (t) => process.stderr.write(t));
}
