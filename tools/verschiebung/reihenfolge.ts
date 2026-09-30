/**
 * Move proof, rule B10: order of evaluation of the modules.
 *
 * A module that moves code out of a file is evaluated before that file. What it imports is
 * evaluated before it. So a step can change the order in which modules that existed before are
 * evaluated, and with it the order of everything they do while loading.
 *
 * From every entry file of the manifest the import graph of both states is walked the way the
 * module loader does it: depth first, imports in the order of the source, a module after
 * everything it imports. Only imports that remain after compilation count: an import whose names
 * are used as types only is dropped, an import that exists for its effect stays. So every file of
 * the repository is compiled on its own (`ts.transpileModule`) and the imports are read from the
 * result. Installed packages are walked too, as far as they are ES modules.
 *
 * The order of the modules that existed before must be the same. New modules may stand in
 * between; the output names their places.
 */
import { posix } from 'node:path';
import ts from 'typescript';
import { StandZugriff, type Umgebung } from './programm';
import type { ReihenfolgeBericht } from './typen';

/** Static imports of installed files, by absolute path: the same for both states. */
const plattenImporte = new Map<string, string[]>();
/** Static imports of compiled repository files, by content and settings. */
const standImporte = new Map<string, string[]>();

const QUELLTEXT = /\.(ts|tsx|mts|cts)$/;
const SKRIPT = /\.(js|mjs|jsx)$/;

/** Module specifiers of the static imports and re-exports of a piece of JavaScript, in order. */
export function statischeImporte(js: string): string[] {
  const aus: string[] = [];
  const info = ts.preProcessFile(js, true, true);
  for (const f of info.importedFiles) {
    // `pos` is the place of the opening quote. A static import has `from` or `import` before the
    // quote, a dynamic import or a `require` has an opening parenthesis there.
    let i = f.pos - 1;
    while (i >= 0 && /\s/.test(js[i]!)) i--;
    if (i >= 0 && js[i] === '(') continue;
    aus.push(f.fileName);
  }
  return aus;
}

export class ModulGraph {
  readonly zugriff: StandZugriff;
  private readonly optionenVon = new Map<string, ts.CompilerOptions>();
  private readonly aufloesung: ts.ModuleResolutionCache;
  private readonly kanten = new Map<string, string[]>();

  constructor(u: Umgebung) {
    this.zugriff = new StandZugriff(u);
    this.aufloesung = ts.createModuleResolutionCache(this.zugriff.wurzel, (f) => f);
  }

  private optionen(datei: string): ts.CompilerOptions {
    const tsconfig = this.zugriff.findeTsconfig(datei) ?? '';
    let o = this.optionenVon.get(tsconfig);
    if (!o) {
      const gelesen = tsconfig === '' ? {} : this.zugriff.liesTsconfig(tsconfig).options;
      o = { ...gelesen, moduleResolution: gelesen.moduleResolution ?? ts.ModuleResolutionKind.Bundler, allowJs: true, resolveJsonModule: true };
      this.optionenVon.set(tsconfig, o);
    }
    return o;
  }

  /** Identity of a module: path relative to the repository root, absolute path of an installed file, or `extern:<specifier>`. */
  private loese(spec: string, vonAbsolut: string, optionen: ts.CompilerOptions): string {
    const vonPlatte = this.zugriff.ort(vonAbsolut).wo === 'platte';
    if (vonPlatte && (spec.startsWith('./') || spec.startsWith('../')) && SKRIPT.test(spec)) {
      const ziel = posix.normalize(posix.join(posix.dirname(vonAbsolut), spec));
      if (ts.sys.fileExists(ziel)) return ziel;
    }
    const host: ts.ModuleResolutionHost = {
      fileExists: this.zugriff.gibtEsDatei,
      readFile: this.zugriff.liesDatei,
      directoryExists: this.zugriff.gibtEsVerzeichnis,
      getDirectories: this.zugriff.unterverzeichnisse,
      realpath: this.zugriff.echterPfad,
      getCurrentDirectory: () => this.zugriff.wurzel,
    };
    const r = ts.resolveModuleName(spec, vonAbsolut, optionen, host, this.aufloesung).resolvedModule;
    if (!r) return `extern:${spec}`;
    const o = this.zugriff.ort(r.resolvedFileName);
    if (o.wo === 'stand') return o.pfad;
    // Installed package: the declaration file stands next to the script it describes.
    const skript = r.resolvedFileName.replace(/\.d\.ts$/, '.js').replace(/\.d\.mts$/, '.mjs').replace(/\.d\.cts$/, '.cjs');
    if (skript !== r.resolvedFileName && ts.sys.fileExists(skript)) return skript;
    if (SKRIPT.test(r.resolvedFileName) || r.resolvedFileName.endsWith('.cjs')) return r.resolvedFileName;
    return `extern:${spec}`;
  }

  /** Modules a module imports statically, in the order of its source, each once. */
  importeVon(modul: string): string[] {
    const bekannt = this.kanten.get(modul);
    if (bekannt) return bekannt;
    let specs: string[] = [];
    let vonAbsolut = modul;
    let optionen: ts.CompilerOptions = {};
    if (modul.startsWith('extern:')) {
      specs = [];
    } else if (posix.isAbsolute(modul)) {
      optionen = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, resolveJsonModule: true };
      let s = plattenImporte.get(modul);
      if (!s) {
        const text = SKRIPT.test(modul) ? ts.sys.readFile(modul) : undefined;
        s = text === undefined ? [] : statischeImporte(text);
        plattenImporte.set(modul, s);
      }
      specs = s;
    } else {
      vonAbsolut = this.zugriff.absolut(modul);
      optionen = this.optionen(modul);
      const text = this.zugriff.stand.lies(modul);
      if (text !== undefined && (QUELLTEXT.test(modul) || SKRIPT.test(modul)) && !modul.endsWith('.d.ts')) {
        const schalter = `${optionen.verbatimModuleSyntax ?? ''}|${optionen.preserveValueImports ?? ''}|${optionen.importsNotUsedAsValues ?? ''}|${optionen.jsx ?? ''}|${optionen.experimentalDecorators ?? ''}`;
        const schluessel = `${modul}|${this.zugriff.stand.inhaltsHash(modul) ?? ''}|${schalter}`;
        let s = standImporte.get(schluessel);
        if (!s) {
          const js = ts.transpileModule(text, {
            fileName: modul,
            reportDiagnostics: false,
            compilerOptions: { ...optionen, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, noEmit: false, declaration: false, declarationMap: false, sourceMap: false, inlineSourceMap: false, composite: false, incremental: false, isolatedModules: true, noLib: true },
          }).outputText;
          s = statischeImporte(js);
          standImporte.set(schluessel, s);
        }
        specs = s;
      }
    }
    const aus: string[] = [];
    const gesehen = new Set<string>();
    for (const spec of specs) {
      const ziel = this.loese(spec, vonAbsolut, optionen);
      if (!gesehen.has(ziel) && ziel !== modul) {
        gesehen.add(ziel);
        aus.push(ziel);
      }
    }
    this.kanten.set(modul, aus);
    return aus;
  }

  /** Order in which the modules are evaluated when `einstieg` is loaded. */
  reihenfolge(einstieg: string): string[] {
    const ordnung: string[] = [];
    const besucht = new Set<string>([einstieg]);
    const stapel: { modul: string; importe: string[]; i: number }[] = [{ modul: einstieg, importe: this.importeVon(einstieg), i: 0 }];
    while (stapel.length > 0) {
      const oben = stapel[stapel.length - 1]!;
      if (oben.i < oben.importe.length) {
        const n = oben.importe[oben.i++]!;
        if (!besucht.has(n)) {
          besucht.add(n);
          stapel.push({ modul: n, importe: this.importeVon(n), i: 0 });
        }
      } else {
        ordnung.push(oben.modul);
        stapel.pop();
      }
    }
    return ordnung;
  }

  /** A cycle of static imports among the given modules, as a path, or `null`. */
  zyklus(module: readonly string[]): string[] | null {
    const menge = new Set(module);
    const farbe = new Map<string, 1 | 2>();
    const weg: string[] = [];
    const geh = (m: string): string[] | null => {
      farbe.set(m, 1);
      weg.push(m);
      for (const n of this.importeVon(m)) {
        if (!menge.has(n)) continue;
        if (farbe.get(n) === 1) return [...weg.slice(weg.indexOf(n)), n];
        if (farbe.get(n) === undefined) {
          const z = geh(n);
          if (z) return z;
        }
      }
      weg.pop();
      farbe.set(m, 2);
      return null;
    };
    for (const m of module) {
      if (farbe.get(m) === undefined) {
        const z = geh(m);
        if (z) return z;
      }
    }
    return null;
  }
}

/** Indices of a longest increasing subsequence. */
function laengsteSteigende(folge: readonly number[]): Set<number> {
  const enden: number[] = [];
  const vor: number[] = new Array<number>(folge.length).fill(-1);
  const stelle: number[] = [];
  folge.forEach((w, i) => {
    let lo = 0;
    let hi = enden.length;
    while (lo < hi) {
      const mitte = (lo + hi) >> 1;
      if (enden[mitte]! < w) lo = mitte + 1;
      else hi = mitte;
    }
    enden[lo] = w;
    stelle[lo] = i;
    vor[i] = lo > 0 ? stelle[lo - 1]! : -1;
  });
  const aus = new Set<number>();
  for (let i = enden.length > 0 ? stelle[enden.length - 1]! : -1; i >= 0; i = vor[i]!) aus.add(i);
  return aus;
}

export interface Abweichung {
  modul: string;
  art: 'umgestellt' | 'nicht-mehr-geladen' | 'neu-geladen';
  text: string;
}

export interface OrdnungsVergleich {
  bericht: ReihenfolgeBericht;
  abweichungen: Abweichung[];
}

/** Compares the order of evaluation of two states from one entry file. `ziele` are the target files of the step. */
export function vergleicheOrdnung(einstieg: string, alt: readonly string[], neu: readonly string[], ziele: ReadonlySet<string>): OrdnungsVergleich {
  const platzAlt = new Map(alt.map((m, i) => [m, i]));
  const platzNeu = new Map(neu.map((m, i) => [m, i]));
  const abweichungen: Abweichung[] = [];
  const nachbar = (liste: readonly string[], i: number): string => `after ${liste[i - 1] ?? '(start)'} and before ${liste[i + 1] ?? '(end)'}`;
  for (const m of alt) {
    if (!platzNeu.has(m)) abweichungen.push({ modul: m, art: 'nicht-mehr-geladen', text: `${m} was evaluated at place ${platzAlt.get(m)! + 1} of ${alt.length} and is not loaded any more` });
  }
  const gemeinsam = neu.filter((m) => platzAlt.has(m));
  const bleibt = laengsteSteigende(gemeinsam.map((m) => platzAlt.get(m)!));
  gemeinsam.forEach((m, i) => {
    if (bleibt.has(i)) return;
    const a = platzAlt.get(m)!;
    const n = platzNeu.get(m)!;
    abweichungen.push({ modul: m, art: 'umgestellt', text: `${m} was evaluated at place ${a + 1} (${nachbar(alt, a)}) and is evaluated at place ${n + 1} now (${nachbar(neu, n)})` });
  });
  const neueModule: ReihenfolgeBericht['neueModule'] = [];
  neu.forEach((m, i) => {
    if (platzAlt.has(m)) return;
    neueModule.push({ modul: m, platz: i + 1, davor: neu[i - 1] ?? null, danach: neu[i + 1] ?? null });
    if (!ziele.has(m)) abweichungen.push({ modul: m, art: 'neu-geladen', text: `${m} is loaded at place ${i + 1} of ${neu.length} and was not loaded before; it is no target file of this step` });
  });
  return { bericht: { einstieg, moduleAlt: alt.length, moduleNeu: neu.length, neueModule, gleich: abweichungen.length === 0 }, abweichungen };
}
