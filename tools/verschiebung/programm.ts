/**
 * Move proof: a TypeScript program for one state of the tree.
 *
 * The compiler reads every file of the repository from the state (old or new), never from the
 * working tree. Only the installed packages under `node_modules` and the library files of
 * TypeScript come from disk; they are the same for both states.
 *
 * The trap this module closes: `node_modules/@wov/*` are links into the working tree. A program of
 * the OLD state that followed them would read the NEW state of the workspace packages. So every
 * path under `node_modules/<name of a workspace package>` is answered from the state itself, at
 * the folder the root `package.json` OF THAT STATE names for the package.
 */
import { posix } from 'node:path';
import ts from 'typescript';
import { verzeichnisseVon, type Stand } from './stand';

export interface Umgebung {
  /** Absolute folder under which the files of the state appear. The real repository root, or any name for a state in memory. */
  wurzel: string;
  stand: Stand;
}

interface Eintraege {
  files: string[];
  directories: string[];
}

type MatchFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  getFileSystemEntries: (path: string) => Eintraege,
  realpath: (path: string) => string,
) => string[];

/** Parsed files that do not depend on the state: libraries and installed packages. Shared by all programs. */
const festeDateien = new Map<string, ts.SourceFile>();
/** Parsed files of states, by path and content: a file that is the same in both states is parsed once. */
const standDateien = new Map<string, ts.SourceFile>();

export class StandZugriff {
  readonly wurzel: string;
  readonly stand: Stand;
  private readonly verzeichnisse: Set<string>;
  private readonly kinder = new Map<string, Eintraege>();
  /** Name of a workspace package to its folder in the state. */
  readonly pakete = new Map<string, string>();

  constructor(u: Umgebung) {
    this.wurzel = u.wurzel.replace(/\/+$/, '');
    this.stand = u.stand;
    const dateien = u.stand.dateien();
    this.verzeichnisse = verzeichnisseVon(dateien);
    for (const d of dateien) {
      const i = d.lastIndexOf('/');
      this.eintraege(i < 0 ? '' : d.slice(0, i)).files.push(i < 0 ? d : d.slice(i + 1));
    }
    for (const v of this.verzeichnisse) {
      if (v === '') continue;
      const i = v.lastIndexOf('/');
      this.eintraege(i < 0 ? '' : v.slice(0, i)).directories.push(i < 0 ? v : v.slice(i + 1));
    }
    this.lesePakete();
  }

  private eintraege(verzeichnis: string): Eintraege {
    let e = this.kinder.get(verzeichnis);
    if (!e) {
      e = { files: [], directories: [] };
      this.kinder.set(verzeichnis, e);
    }
    return e;
  }

  private lesePakete(): void {
    const roh = this.stand.lies('package.json');
    if (roh === undefined) return;
    let arbeitsbereiche: unknown;
    try {
      arbeitsbereiche = (JSON.parse(roh) as { workspaces?: unknown }).workspaces;
    } catch {
      return;
    }
    const muster = Array.isArray(arbeitsbereiche) ? arbeitsbereiche.filter((x): x is string => typeof x === 'string') : [];
    const ordner: string[] = [];
    for (const m of muster) {
      const sauber = m.replace(/\/+$/, '');
      if (sauber.endsWith('/*')) ordner.push(...this.eintraege(sauber.slice(0, -2)).directories.map((d) => `${sauber.slice(0, -2)}/${d}`));
      else ordner.push(sauber);
    }
    for (const o of ordner) {
      const p = this.stand.lies(`${o}/package.json`);
      if (p === undefined) continue;
      try {
        const name = (JSON.parse(p) as { name?: unknown }).name;
        if (typeof name === 'string' && name !== '') this.pakete.set(name, o);
      } catch {
        // a package.json that does not parse names no package
      }
    }
  }

  absolut(pfad: string): string {
    return `${this.wurzel}/${pfad}`;
  }

  /**
   * Where a path of the compiler lives: `stand` with the path relative to the repository root, or
   * `platte` for a file that is read from disk (library, installed package).
   */
  ort(pfad: string): { wo: 'stand'; pfad: string } | { wo: 'platte' } {
    const p = posix.normalize(pfad.replaceAll('\\', '/'));
    if (p !== this.wurzel && !p.startsWith(`${this.wurzel}/`)) return { wo: 'platte' };
    const rel = p === this.wurzel ? '' : p.slice(this.wurzel.length + 1);
    const teile = rel.split('/');
    const nm = teile.lastIndexOf('node_modules');
    if (nm < 0) return { wo: 'stand', pfad: rel };
    const name = teile[nm + 1]?.startsWith('@') ? `${teile[nm + 1]}/${teile[nm + 2] ?? ''}` : (teile[nm + 1] ?? '');
    const ordner = this.pakete.get(name);
    if (ordner === undefined) return { wo: 'platte' };
    const restTeile = teile.slice(nm + 1 + name.split('/').length);
    return { wo: 'stand', pfad: [ordner, ...restTeile].join('/') };
  }

  /** Path relative to the repository root for a file of the state, the absolute path otherwise. */
  kurzPfad(pfad: string): string {
    const o = this.ort(pfad);
    return o.wo === 'stand' ? o.pfad : pfad;
  }

  gibtEsDatei = (pfad: string): boolean => {
    const o = this.ort(pfad);
    return o.wo === 'stand' ? this.stand.gibtEs(o.pfad) : ts.sys.fileExists(pfad);
  };

  liesDatei = (pfad: string): string | undefined => {
    const o = this.ort(pfad);
    return o.wo === 'stand' ? this.stand.lies(o.pfad) : ts.sys.readFile(pfad);
  };

  gibtEsVerzeichnis = (pfad: string): boolean => {
    const o = this.ort(pfad);
    return o.wo === 'stand' ? this.verzeichnisse.has(o.pfad) : ts.sys.directoryExists(pfad);
  };

  unterverzeichnisse = (pfad: string): string[] => {
    const o = this.ort(pfad);
    return o.wo === 'stand' ? [...(this.kinder.get(o.pfad)?.directories ?? [])] : ts.sys.getDirectories(pfad);
  };

  echterPfad = (pfad: string): string => {
    const o = this.ort(pfad);
    if (o.wo === 'stand') return this.absolut(o.pfad);
    return ts.sys.realpath ? ts.sys.realpath(pfad) : pfad;
  };

  /** Files of a folder of the state that match the patterns of a `tsconfig.json`. */
  liesVerzeichnis = (wurzelVerzeichnis: string, endungen?: readonly string[], aus?: readonly string[], ein?: readonly string[], tiefe?: number): string[] => {
    const matchFiles = (ts as unknown as { matchFiles?: MatchFiles }).matchFiles;
    if (!matchFiles) throw new Error('this version of TypeScript has no matchFiles: the include patterns of tsconfig.json cannot be read');
    return matchFiles(
      wurzelVerzeichnis,
      endungen,
      aus,
      ein,
      true,
      this.wurzel,
      tiefe,
      (pfad) => {
        const o = this.ort(pfad);
        if (o.wo !== 'stand') return { files: [], directories: [] };
        const e = this.kinder.get(o.pfad);
        return { files: [...(e?.files ?? [])], directories: [...(e?.directories ?? [])].filter((d) => d !== 'node_modules') };
      },
      (pfad) => pfad,
    );
  };

  /** The nearest `tsconfig.json` above a file of the state, or `null`. */
  findeTsconfig(datei: string): string | null {
    let v = posix.dirname(datei);
    for (;;) {
      const k = v === '.' ? 'tsconfig.json' : `${v}/tsconfig.json`;
      if (this.stand.gibtEs(k)) return k;
      if (v === '.' || v === '') return null;
      v = posix.dirname(v);
    }
  }

  /** Reads a `tsconfig.json` of the state, `extends` included. */
  liesTsconfig(tsconfig: string): ts.ParsedCommandLine {
    const abs = this.absolut(tsconfig);
    const roh = ts.readConfigFile(abs, this.liesDatei);
    if (roh.error) throw new Error(`cannot read ${tsconfig}: ${ts.flattenDiagnosticMessageText(roh.error.messageText, ' ')}`);
    return ts.parseJsonConfigFileContent(
      roh.config,
      { useCaseSensitiveFileNames: true, readDirectory: this.liesVerzeichnis, fileExists: this.gibtEsDatei, readFile: this.liesDatei },
      posix.dirname(abs),
      undefined,
      abs,
    );
  }

  compilerHost(optionen: ts.CompilerOptions): ts.CompilerHost {
    return {
      fileExists: this.gibtEsDatei,
      readFile: this.liesDatei,
      directoryExists: this.gibtEsVerzeichnis,
      getDirectories: this.unterverzeichnisse,
      realpath: this.echterPfad,
      getCurrentDirectory: () => this.wurzel,
      getCanonicalFileName: (f) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      writeFile: () => undefined,
      getSourceFile: (name, sprache) => {
        const o = this.ort(name);
        const version = typeof sprache === 'object' ? sprache.languageVersion : sprache;
        if (o.wo === 'platte') {
          const schluessel = `${version}|${name}`;
          let sf = festeDateien.get(schluessel);
          if (!sf) {
            const text = ts.sys.readFile(name);
            if (text === undefined) return undefined;
            sf = ts.createSourceFile(name, text, sprache, true);
            festeDateien.set(schluessel, sf);
          }
          return sf;
        }
        const text = this.stand.lies(o.pfad);
        if (text === undefined) return undefined;
        const schluessel = `${version}|${optionen.jsx ?? ''}|${name}|${this.stand.inhaltsHash(o.pfad) ?? ''}`;
        let sf = standDateien.get(schluessel);
        if (!sf) {
          sf = ts.createSourceFile(name, text, sprache, true);
          standDateien.set(schluessel, sf);
        }
        return sf;
      },
    };
  }
}

export interface Programm {
  zugriff: StandZugriff;
  programm: ts.Program;
  pruefer: ts.TypeChecker;
  optionen: ts.CompilerOptions;
  tsconfig: string | null;
  /** Number of files the program read. */
  dateien: number;
}

const OHNE_AUSGABE: ts.CompilerOptions = { noEmit: true, skipLibCheck: true, incremental: false, composite: false, declaration: false, declarationMap: false, sourceMap: false };

const VORGABE: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  lib: ['lib.es2022.d.ts'],
  types: [],
};

/**
 * Builds the program of the package that holds `quelle`: the files the `tsconfig.json` of the
 * package includes, test folders left out, and the files named in `dazu`.
 */
export function baueProgramm(u: Umgebung, quelle: string, dazu: readonly string[]): Programm {
  const zugriff = new StandZugriff(u);
  const tsconfig = zugriff.findeTsconfig(quelle);
  let optionen: ts.CompilerOptions = VORGABE;
  const wurzeln = new Set<string>();
  if (tsconfig !== null) {
    const gelesen = zugriff.liesTsconfig(tsconfig);
    optionen = gelesen.options;
    const imTest = (p: string): boolean => /(^|\/)(test|tests|__tests__)\//.test(zugriff.kurzPfad(p));
    for (const f of gelesen.fileNames) if (!imTest(f)) wurzeln.add(f);
  }
  for (const d of [quelle, ...dazu]) if (u.stand.gibtEs(d)) wurzeln.add(zugriff.absolut(d));
  optionen = { ...optionen, ...OHNE_AUSGABE };
  delete optionen.outDir;
  delete optionen.rootDir;
  const programm = ts.createProgram({ rootNames: [...wurzeln], options: optionen, host: zugriff.compilerHost(optionen) });
  return { zugriff, programm, pruefer: programm.getTypeChecker(), optionen, tsconfig, dateien: programm.getSourceFiles().length };
}

/** Forgets parsed files of states. The library files stay: they are the expensive ones. */
export function vergissStandDateien(): void {
  standDateien.clear();
}
