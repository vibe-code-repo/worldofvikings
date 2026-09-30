/**
 * Move proof, states: read access to the tree of the old and of the new state.
 *
 * The old state comes from git without touching the working tree: the tree is listed once with
 * `git ls-tree`, file contents are read from the object store (`git cat-file`). No temporary
 * directory is written, so there is nothing to clean up after an error.
 *
 * Paths are relative to the repository root and written with `/`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Stand {
  /** What this state is, for the output: `git:<full hash>`, `arbeitsbaum:<hash>+<n changed>`, `probe:<name>`. */
  readonly kennung: string;
  lies(pfad: string): string | undefined;
  gibtEs(pfad: string): boolean;
  /** Every file of the state. */
  dateien(): readonly string[];
  /** Hash of the content in the form git uses for blobs, to compare a file across two states. */
  inhaltsHash(pfad: string): string | undefined;
}

export function blobHash(inhalt: Buffer): string {
  return createHash('sha1').update(`blob ${inhalt.length}\0`).update(inhalt).digest('hex');
}

/** Directories of a state, derived from its files. */
export function verzeichnisseVon(dateien: readonly string[]): Set<string> {
  const aus = new Set<string>(['']);
  for (const d of dateien) {
    let i = d.lastIndexOf('/');
    while (i > 0) {
      const v = d.slice(0, i);
      if (aus.has(v)) break;
      aus.add(v);
      i = v.lastIndexOf('/');
    }
  }
  return aus;
}

/** A state held in memory: for the self-test. */
export class SpeicherStand implements Stand {
  readonly kennung: string;
  private readonly inhalt: Map<string, string>;

  constructor(name: string, dateien: Readonly<Record<string, string>>) {
    this.kennung = `probe:${name}`;
    this.inhalt = new Map(Object.entries(dateien));
  }

  lies(pfad: string): string | undefined {
    return this.inhalt.get(pfad);
  }

  gibtEs(pfad: string): boolean {
    return this.inhalt.has(pfad);
  }

  dateien(): readonly string[] {
    return [...this.inhalt.keys()];
  }

  inhaltsHash(pfad: string): string | undefined {
    const t = this.inhalt.get(pfad);
    return t === undefined ? undefined : blobHash(Buffer.from(t, 'utf8'));
  }
}

/** A state that is another state with some files replaced, added (text) or removed (`null`). */
export class UeberlagerterStand implements Stand {
  readonly kennung: string;
  private liste: string[] | null = null;

  constructor(
    private readonly basis: Stand,
    private readonly aenderung: ReadonlyMap<string, string | null>,
    name: string,
  ) {
    this.kennung = `${basis.kennung}+${name}`;
  }

  lies(pfad: string): string | undefined {
    if (this.aenderung.has(pfad)) return this.aenderung.get(pfad) ?? undefined;
    return this.basis.lies(pfad);
  }

  gibtEs(pfad: string): boolean {
    if (this.aenderung.has(pfad)) return this.aenderung.get(pfad) !== null;
    return this.basis.gibtEs(pfad);
  }

  dateien(): readonly string[] {
    if (!this.liste) {
      const alle = new Set(this.basis.dateien());
      for (const [p, t] of this.aenderung) {
        if (t === null) alle.delete(p);
        else alle.add(p);
      }
      this.liste = [...alle];
    }
    return this.liste;
  }

  inhaltsHash(pfad: string): string | undefined {
    if (this.aenderung.has(pfad)) {
      const t = this.aenderung.get(pfad);
      return t === null || t === undefined ? undefined : blobHash(Buffer.from(t, 'utf8'));
    }
    return this.basis.inhaltsHash(pfad);
  }
}

const GIT_PUFFER = 1 << 30;

function git(verzeichnis: string, argumente: string[]): string {
  return execFileSync('git', argumente, { cwd: verzeichnis, encoding: 'utf8', maxBuffer: GIT_PUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The tree of one commit, read from the object store. */
export class GitStand implements Stand {
  readonly kennung: string;
  readonly commit: string;
  private readonly blobs = new Map<string, string>();
  private readonly texte = new Map<string, string>();

  constructor(
    private readonly verzeichnis: string,
    ref: string,
  ) {
    this.commit = git(verzeichnis, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
    if (!/^[0-9a-f]{40,64}$/.test(this.commit)) throw new Error(`git reference "${ref}" does not name a commit`);
    this.kennung = `git:${this.commit}`;
    const roh = git(verzeichnis, ['ls-tree', '-r', '-z', '--full-tree', this.commit]);
    for (const eintrag of roh.split('\0')) {
      if (eintrag === '') continue;
      const tab = eintrag.indexOf('\t');
      const [modus, art, sha] = eintrag.slice(0, tab).split(' ');
      // Regular files only: a symbolic link (120000) or a submodule (160000) is not source text.
      if (art === 'blob' && (modus === '100644' || modus === '100755') && sha) this.blobs.set(eintrag.slice(tab + 1), sha);
    }
  }

  lies(pfad: string): string | undefined {
    const sha = this.blobs.get(pfad);
    if (sha === undefined) return undefined;
    let t = this.texte.get(sha);
    if (t === undefined) {
      t = git(this.verzeichnis, ['cat-file', 'blob', sha]);
      this.texte.set(sha, t);
    }
    return t;
  }

  /** Reads many files with one git process. Worth it before a TypeScript program reads a package. */
  ladeVorab(auswahl: (pfad: string) => boolean): number {
    const shas = [...new Set([...this.blobs].filter(([p, s]) => auswahl(p) && !this.texte.has(s)).map(([, s]) => s))];
    if (shas.length === 0) return 0;
    const r = spawnSync('git', ['cat-file', '--batch'], { cwd: this.verzeichnis, input: `${shas.join('\n')}\n`, maxBuffer: GIT_PUFFER });
    if (r.status !== 0) throw new Error(`git cat-file --batch failed: ${r.stderr.toString('utf8')}`);
    const aus = r.stdout;
    let p = 0;
    for (const sha of shas) {
      const zeilenEnde = aus.indexOf(0x0a, p);
      const kopf = aus.subarray(p, zeilenEnde).toString('utf8').split(' ');
      if (kopf[0] !== sha || kopf[1] !== 'blob') throw new Error(`git cat-file --batch: unexpected header "${kopf.join(' ')}"`);
      const laenge = Number(kopf[2]);
      this.texte.set(sha, aus.subarray(zeilenEnde + 1, zeilenEnde + 1 + laenge).toString('utf8'));
      p = zeilenEnde + 1 + laenge + 1;
    }
    return shas.length;
  }

  gibtEs(pfad: string): boolean {
    return this.blobs.has(pfad);
  }

  dateien(): readonly string[] {
    return [...this.blobs.keys()];
  }

  inhaltsHash(pfad: string): string | undefined {
    return this.blobs.get(pfad);
  }
}

/** The working tree: tracked files and untracked files that are not ignored, read from disk. */
export class ArbeitsbaumStand implements Stand {
  readonly kennung: string;
  private readonly liste: string[];
  private readonly menge: Set<string>;
  private readonly texte = new Map<string, string>();

  constructor(private readonly verzeichnis: string) {
    const kopf = git(verzeichnis, ['rev-parse', 'HEAD']).trim();
    const geaendert = git(verzeichnis, ['status', '--porcelain', '-z']).split('\0').filter((z) => z !== '').length;
    this.kennung = `arbeitsbaum:${kopf}+${geaendert}`;
    const roh = git(verzeichnis, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    this.liste = [...new Set(roh.split('\0').filter((p) => p !== ''))].filter((p) => {
      try {
        return statSync(join(verzeichnis, p)).isFile();
      } catch {
        return false; // listed in the index, deleted on disk
      }
    });
    this.menge = new Set(this.liste);
  }

  lies(pfad: string): string | undefined {
    if (!this.menge.has(pfad)) return undefined;
    let t = this.texte.get(pfad);
    if (t === undefined) {
      t = readFileSync(join(this.verzeichnis, pfad), 'utf8');
      this.texte.set(pfad, t);
    }
    return t;
  }

  gibtEs(pfad: string): boolean {
    return this.menge.has(pfad);
  }

  dateien(): readonly string[] {
    return this.liste;
  }

  inhaltsHash(pfad: string): string | undefined {
    if (!this.menge.has(pfad)) return undefined;
    return blobHash(readFileSync(join(this.verzeichnis, pfad)));
  }
}

/** Root of the git repository that contains `verzeichnis`. */
export function repoWurzel(verzeichnis: string): string {
  return git(verzeichnis, ['rev-parse', '--show-toplevel']).trim();
}
