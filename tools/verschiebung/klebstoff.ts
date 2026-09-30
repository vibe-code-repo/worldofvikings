/**
 * Move proof, rule B5: glue.
 *
 * Outside the moved and the unchanged parts a step may only contain: import lines, re-exports,
 * export lists, forwarders in the declared form, the context type, one header comment per target
 * file and the loosened modifiers. This module judges imports, re-exports and export lists on the
 * syntax tree; `weiterleitung.ts` judges the forwarders, `kontexttyp.ts` the context type.
 *
 *  - A new import of the rest points to a target file of this step, names declarations that moved
 *    there and has no `as`.
 *  - An import is only removed if the rest no longer uses the name. An import that exists for its
 *    effect (`import './x'`) is never removed.
 *  - An import of a target file has its origin in the old source file (same module, same names),
 *    points to another target file of this step, or brings a type from the source file.
 *  - A re-export keeps what the source file exported before, under the same name.
 */
import { posix } from 'node:path';
import ts from 'typescript';
import { istVariablenname } from './formk';
import { deklarierteNamen, hatModifikator, istNurTyp } from './stuecke';
import { kurz, ortVonKnoten, type Datei, type Manifest, type Protokoll, type Stueck } from './typen';
import { importForm } from './importe';
import type { Zerlegung } from './zerlegung';

const K = ts.SyntaxKind;

/** Files a relative module specifier can mean, seen from `von`. Empty for a package name. */
export function moeglicheDateien(von: string, spec: string): string[] {
  if (!spec.startsWith('./') && !spec.startsWith('../') && spec !== '.' && spec !== '..') return [];
  const basis = posix.normalize(posix.join(posix.dirname(von), spec));
  const m = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.exec(basis);
  if (!m) return [`${basis}.ts`, `${basis}.tsx`, `${basis}/index.ts`, `${basis}/index.tsx`];
  const stamm = basis.slice(0, -m[0].length);
  switch (m[1]) {
    case 'js':
      return [`${stamm}.ts`, `${stamm}.tsx`];
    case 'jsx':
      return [`${stamm}.tsx`];
    case 'mjs':
      return [`${stamm}.mts`];
    case 'cjs':
      return [`${stamm}.cts`];
    default:
      return [basis];
  }
}

/** Module identity for comparing an import of a target file with an import of the old source file. */
function modulKennung(von: string, spec: string): string {
  const d = moeglicheDateien(von, spec);
  return d.length > 0 ? `datei:${d[0]!.replace(/\.(ts|tsx|mts|cts)$/, '')}` : `paket:${spec}`;
}

function specText(d: ts.ImportDeclaration | ts.ExportDeclaration): string {
  const s = d.moduleSpecifier;
  return s && ts.isStringLiteral(s) ? s.text : '';
}

interface Einfuhr {
  modul: string;
  /** `default`, `*` or the imported name. */
  eingefuehrt: string;
  lokal: string;
  nurTyp: boolean;
  /** Import attributes (`with { type: 'json' }`) without blanks: another attribute is another module to the bundler. */
  attribute: string;
}

function einfuhren(s: Stueck, von: string): Einfuhr[] {
  const d = s.knoten as ts.ImportDeclaration;
  const ic = d.importClause;
  const modul = modulKennung(von, specText(d));
  const attribute = d.attributes ? d.attributes.getText(s.datei.sf).replace(/\s+/g, '') : '';
  if (!ic) return [];
  const aus: Einfuhr[] = [];
  const ganz = !!ic.isTypeOnly;
  if (ic.name) aus.push({ modul, eingefuehrt: 'default', lokal: ic.name.text, nurTyp: ganz, attribute });
  if (ic.namedBindings) {
    if (ts.isNamespaceImport(ic.namedBindings)) aus.push({ modul, eingefuehrt: '*', lokal: ic.namedBindings.name.text, nurTyp: ganz, attribute });
    else for (const e of ic.namedBindings.elements) aus.push({ modul, eingefuehrt: (e.propertyName ?? e.name).text, lokal: e.name.text, nurTyp: ganz || e.isTypeOnly, attribute });
  }
  return aus;
}

/** Identifiers of the rest that name a variable, outside import declarations. */
function benutzteNamen(datei: Datei): Set<string> {
  const aus = new Set<string>();
  const geh = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n) && istVariablenname(n)) aus.add(n.text);
    ts.forEachChild(n, geh);
  };
  geh(datei.sf);
  return aus;
}

export interface KlebstoffWissen {
  /** Per target file: names that moved there, with the old statement or member. */
  verschoben: Map<string, Map<string, { stueck: Stueck; form: '0' | 'k' }>>;
}

export function sammleWissen(z: Zerlegung): KlebstoffWissen {
  const verschoben = new Map<string, Map<string, { stueck: Stueck; form: '0' | 'k' }>>();
  const fuer = (datei: string): Map<string, { stueck: Stueck; form: '0' | 'k' }> => {
    let m = verschoben.get(datei);
    if (!m) {
      m = new Map();
      verschoben.set(datei, m);
    }
    return m;
  };
  for (const f of z.form0) for (const n of deklarierteNamen(f.alt.knoten)) fuer(f.ziel.datei).set(n, { stueck: f.alt, form: '0' });
  for (const f of z.formk) fuer(f.ziel.datei).set(f.name, { stueck: f.alt, form: 'k' });
  return { verschoben };
}

function zielVon(von: string, spec: string, manifest: Manifest): string | null {
  const d = moeglicheDateien(von, spec);
  return manifest.ziele.find((z) => d.includes(z.datei))?.datei ?? null;
}

/** New import of the rest or import of one target file from another: named, no `as`, names that moved there. */
function pruefeImportAufZiel(s: Stueck, ziel: string, wissen: KlebstoffWissen, p: Protokoll, wo: string): void {
  const datei = s.datei;
  const d = s.knoten as ts.ImportDeclaration;
  const ic = d.importClause;
  const melde = (teil: string, knoten: ts.Node, text: string): void => p.melde({ regel: 'B5', teil, ort: ortVonKnoten(datei, knoten), text: `${wo}: ${text}` });
  if (!ic) {
    melde('import-wirkung', d, `import without names of ${ziel}: an import that exists only for its effect is no glue`);
    return;
  }
  if (ic.name) melde('import-form', ic.name, `default import "${ic.name.text}" from ${ziel}: moved declarations are imported by their own name`);
  if (ic.namedBindings && ts.isNamespaceImport(ic.namedBindings)) {
    melde('import-form', ic.namedBindings, `namespace import "* as ${ic.namedBindings.name.text}" from ${ziel}: moved declarations are imported by their own name`);
    return;
  }
  const namen = wissen.verschoben.get(ziel) ?? new Map<string, { stueck: Stueck; form: '0' | 'k' }>();
  const elemente = ic.namedBindings && ts.isNamedImports(ic.namedBindings) ? ic.namedBindings.elements : [];
  if (elemente.length === 0 && !ic.name) melde('import-form', d, `import of ${ziel} names nothing`);
  for (const e of elemente) {
    if (e.propertyName) melde('import-alias', e, `"${e.propertyName.text} as ${e.name.text}" from ${ziel}: an import of a moved declaration has no \`as\``);
    const n = (e.propertyName ?? e.name).text;
    const v = namen.get(n);
    if (!v) melde('import-name', e, `"${n}" is no declaration that moved into ${ziel} in this step`);
    else if (!(ic.isTypeOnly || e.isTypeOnly) && istNurTyp(v.stueck.knoten)) melde('import-typ', e, `"${n}" is a type and is imported as a value: write \`type ${n}\``);
  }
}

/** The name a re-export or an export list gives to the outside, and the local name behind it. */
function ausfuhrElemente(d: ts.ExportDeclaration): ts.ExportSpecifier[] {
  return d.exportClause && ts.isNamedExports(d.exportClause) ? [...d.exportClause.elements] : [];
}

/**
 * Rule 4.6b of form k: when the last use of a value import goes away, the line stays byte-identical and a
 * side-effect import `import '<module>';` stands DIRECTLY behind it, so that the module keeps its place
 * in the order of evaluation (the compiler drops an import that is only used as a type). This is glue if
 * the statement in front of it in the rest is the unchanged import of the same module (specifier, names
 * and attributes as before, nothing taken out) and the old state imported at least one VALUE from it.
 * Returns `null` if it is, else the reason why not. That the order of evaluation stays the same is judged
 * by rule B10 on the two module graphs, not here.
 */
function seiteneffektHinterWertImport(n: Stueck, z: Zerlegung): string | null {
  const d = n.knoten as ts.ImportDeclaration;
  const spec = specText(d);
  const sf = z.rest.sf;
  const i = sf.statements.indexOf(d);
  const davor = i > 0 ? sf.statements[i - 1]! : undefined;
  if (!davor || !ts.isImportDeclaration(davor)) return 'no import of the same module stands directly in front of it';
  const paar = [...z.importe.paare, ...z.importe.umgestellt].find((x) => x.neu.knoten === davor);
  if (!paar) return 'the import directly in front of it is not an import of the old state';
  if (specText(davor) !== spec || (davor.attributes ? davor.attributes.getText(sf) : '') !== '') return 'the import directly in front of it is of another module';
  if (paar.entfernt.length > 0 || paar.alt.knoten.getText(paar.alt.datei.sf) !== davor.getText(sf)) return 'the import in front of it is not byte-identical to the old one';
  const wert = einfuhren(paar.alt, z.alt.pfad).some((e) => !e.nurTyp);
  if (!wert) return 'the old state imported no value from this module';
  return null;
}

export function pruefeKlebstoff(manifest: Manifest, z: Zerlegung, p: Protokoll): void {
  const wissen = sammleWissen(z);
  const rest = z.rest;

  // -- rest: imports that were removed or lost names --
  const benutzt = benutzteNamen(rest);
  for (const a of z.importe.entfernt) {
    p.zaehle('B5');
    const f = importForm(a);
    const d = a.knoten as ts.ImportDeclaration;
    if (!d.importClause) {
      p.melde({ regel: 'B5', teil: 'import-wirkung-entfernt', ort: ortVonKnoten(z.alt, d), text: `import ${f.quelle} exists for its effect and is no longer in the rest at its place` });
      continue;
    }
    for (const e of einfuhren(a, z.alt.pfad)) {
      if (benutzt.has(e.lokal)) p.melde({ regel: 'B5', teil: 'import-entfernt-benutzt', ort: ortVonKnoten(z.alt, d), text: `import of "${e.lokal}" from ${f.quelle} was removed or changed, the rest still uses the name` });
    }
  }
  for (const paar of [...z.importe.paare, ...z.importe.umgestellt]) {
    p.zaehle('B5');
    for (const n of paar.entfernt) {
      if (benutzt.has(n)) p.melde({ regel: 'B5', teil: 'import-entfernt-benutzt', ort: ortVonKnoten(rest, paar.neu.knoten), text: `"${n}" was taken out of the import of ${importForm(paar.alt).quelle}, the rest still uses the name` });
    }
  }

  // -- rest: new imports --
  for (const n of z.importe.neu) {
    p.zaehle('B5');
    const d = n.knoten as ts.ImportDeclaration;
    const ziel = zielVon(rest.pfad, specText(d), manifest);
    if (ziel === null) {
      if (!d.importClause && !d.attributes) {
        const grund = seiteneffektHinterWertImport(n, z);
        if (grund === null) continue; // rule 4.6b of form k: glue that keeps the order of evaluation
        p.melde({
          regel: 'B5',
          teil: 'import-seiteneffekt',
          ort: ortVonKnoten(rest, d),
          text: `new import in the rest: ${kurz(d.getText(rest.sf), 70)} loads a module for its effect and is not the glue of rule 4.6b of form k (${grund})`,
          freigabe: `seiteneffekt:${specText(d)}`,
        });
        continue;
      }
      p.melde({ regel: 'B5', teil: 'import-neu-fremd', ort: ortVonKnoten(rest, d), text: `new import in the rest: ${kurz(d.getText(rest.sf), 70)} does not point to a target file of this step` });
      continue;
    }
    pruefeImportAufZiel(n, ziel, wissen, p, 'new import in the rest');
  }

  // -- rest: re-exports --
  const exportiertAlt = new Map<string, Stueck>();
  for (const f of z.form0) if (hatModifikator(f.alt.knoten, K.ExportKeyword)) for (const n of deklarierteNamen(f.alt.knoten)) exportiertAlt.set(n, f.alt);
  const weiter = new Map<string, number>();
  for (const w of z.weiterExporte) {
    p.zaehle('B5');
    const d = w.knoten as ts.ExportDeclaration;
    const melde = (teil: string, knoten: ts.Node, text: string): void => p.melde({ regel: 'B5', teil, ort: ortVonKnoten(rest, knoten), text: `re-export in the rest: ${text}` });
    const ziel = zielVon(rest.pfad, specText(d), manifest);
    if (ziel === null) {
      melde('weiterexport-fremd', d, `${kurz(d.getText(rest.sf), 70)} does not point to a target file of this step`);
      continue;
    }
    if (!d.exportClause || !ts.isNamedExports(d.exportClause)) {
      melde('weiterexport-form', d, `${kurz(d.getText(rest.sf), 70)} exports everything of the target file: a re-export names what the source file exported before`);
      continue;
    }
    const namen = wissen.verschoben.get(ziel) ?? new Map<string, { stueck: Stueck; form: '0' | 'k' }>();
    for (const e of ausfuhrElemente(d)) {
      if (e.propertyName) melde('weiterexport-alias', e, `"${e.propertyName.text} as ${e.name.text}": a re-export has no \`as\``);
      const n = (e.propertyName ?? e.name).text;
      const v = namen.get(n);
      weiter.set(e.name.text, (weiter.get(e.name.text) ?? 0) + 1);
      if (!v || v.form !== '0') {
        melde('weiterexport-name', e, `"${n}" is no declaration that moved verbatim into ${ziel} in this step`);
        continue;
      }
      if (!exportiertAlt.has(n)) melde('weiterexport-oberflaeche', e, `"${n}" was not exported by the source file before: the re-export widens its surface`);
      const alsTyp = d.isTypeOnly || e.isTypeOnly;
      const istTyp = istNurTyp(v.stueck.knoten);
      if (alsTyp && !istTyp) melde('weiterexport-typ', e, `"${n}" is a value and is re-exported as a type only: importers would lose the value`);
      if (!alsTyp && istTyp) melde('weiterexport-typ', e, `"${n}" is a type and is re-exported as a value: write \`export type\``);
    }
  }
  for (const [n, s] of exportiertAlt) {
    p.zaehle('B5');
    const anzahl = weiter.get(n) ?? 0;
    if (anzahl === 0) p.melde({ regel: 'B5', teil: 'weiterexport-fehlt', ort: ortVonKnoten(z.alt, s.knoten), text: `"${n}" was exported by the source file and moved: the rest does not re-export it, importers would break` });
    else if (anzahl > 1) p.melde({ regel: 'B5', teil: 'weiterexport-doppelt', ort: ortVonKnoten(z.alt, s.knoten), text: `"${n}" is re-exported ${anzahl} times by the rest` });
  }

  // -- target files --
  const einfuhrenAlt = [...z.importe.paare.map((x) => x.alt), ...z.importe.umgestellt.map((x) => x.alt), ...z.importe.entfernt].flatMap((s) => einfuhren(s, z.alt.pfad));
  for (const ziel of z.ziele) {
    const datei = ziel.datei;
    const imKontexttyp = new Set<string>();
    for (const s of ziel.kontexttyp) {
      const sammle = (n: ts.Node): void => {
        if (ts.isIdentifier(n)) imKontexttyp.add(n.text);
        ts.forEachChild(n, sammle);
      };
      if (ts.isTypeAliasDeclaration(s.knoten)) sammle(s.knoten.type);
    }
    for (const s of ziel.importe) {
      p.zaehle('B5');
      const d = s.knoten as ts.ImportDeclaration;
      const spec = specText(d);
      const melde = (teil: string, knoten: ts.Node, text: string): void => p.melde({ regel: 'B5', teil, ort: ortVonKnoten(datei, knoten), text: `import in the target file: ${text}` });
      const anderes = zielVon(datei.pfad, spec, manifest);
      if (anderes !== null) {
        if (anderes === datei.pfad) melde('import-selbst', d, 'the target file imports itself');
        else pruefeImportAufZiel(s, anderes, wissen, p, 'import in the target file');
        continue;
      }
      if (!d.importClause) {
        melde('import-wirkung', d, `${kurz(d.getText(datei.sf), 70)} exists only for its effect: a target file loads nothing that the old state did not name for a moved declaration`);
        continue;
      }
      const ausQuelle = moeglicheDateien(datei.pfad, spec).includes(manifest.quelle);
      const liste = einfuhren(s, datei.pfad);
      if (ausQuelle) {
        for (const e of liste) {
          if (!e.nurTyp) melde('quelle-als-wert', d, `"${e.lokal}" is imported from the source file as a value: a target file imports the source file as a type at most`);
        }
        continue;
      }
      for (const e of liste) {
        // The context type or a type it is built from (`EntityKontext<...>` of the context file of the
        // class): a type import loads nothing, and what the context type IS is judged by the type checker.
        const fuerKontext = ziel.angabe.kontext !== undefined && e.eingefuehrt === e.lokal && (e.lokal === ziel.angabe.kontext.typ || imKontexttyp.has(e.lokal));
        if (fuerKontext) {
          if (!e.nurTyp) melde('kontexttyp-als-wert', d, `"${e.lokal}" serves the context type and is imported as a value: write \`import type\``);
          continue;
        }
        const herkunft = einfuhrenAlt.filter((a) => a.modul === e.modul && a.eingefuehrt === e.eingefuehrt && a.lokal === e.lokal && a.attribute === e.attribute);
        if (herkunft.length === 0) {
          melde('import-fremd', d, `"${e.eingefuehrt === e.lokal ? e.lokal : `${e.eingefuehrt} as ${e.lokal}`}" from ${spec} has no origin in the imports of the old source file (same module, same name)`);
        } else if (!e.nurTyp && herkunft.every((a) => a.nurTyp)) {
          melde('import-typ-zu-wert', d, `"${e.lokal}" from ${spec} was imported as a type in the old state and is imported as a value now`);
        }
      }
    }
    const namen = wissen.verschoben.get(datei.pfad) ?? new Map<string, { stueck: Stueck; form: '0' | 'k' }>();
    for (const s of ziel.exportlisten) {
      p.zaehle('B5');
      const d = s.knoten as ts.ExportDeclaration;
      for (const e of ausfuhrElemente(d)) {
        const melde = (teil: string, text: string): void => p.melde({ regel: 'B5', teil, ort: ortVonKnoten(datei, e), text: `export list of the target file: ${text}` });
        if (e.propertyName) melde('exportliste-alias', `"${e.propertyName.text} as ${e.name.text}": an export list has no \`as\``);
        const n = (e.propertyName ?? e.name).text;
        const v = namen.get(n);
        const istKontext = ziel.angabe.kontext?.typ === n && ziel.kontexttyp.length > 0;
        if (!v && !istKontext) {
          melde('exportliste-name', `"${n}" is no declaration that moved into this file in this step`);
          continue;
        }
        const alsTyp = d.isTypeOnly || e.isTypeOnly;
        const istTyp = istKontext || (v !== undefined && v.form === '0' && istNurTyp(v.stueck.knoten));
        if (alsTyp && !istTyp) melde('exportliste-typ', `"${n}" is a value and is exported as a type only`);
        if (!alsTyp && istTyp) melde('exportliste-typ', `"${n}" is a type and is exported as a value: write \`export type\``);
      }
    }
    if (ziel.kontexttyp.length > 1) {
      p.melde({ regel: 'B5', teil: 'kontexttyp-doppelt', ort: ortVonKnoten(datei, ziel.kontexttyp[1]!.knoten), text: `the context type "${ziel.angabe.kontext?.typ}" is declared ${ziel.kontexttyp.length} times in the target file` });
    }
    for (const s of ziel.kontexttyp) {
      p.zaehle('B5');
      if (!ts.isTypeAliasDeclaration(s.knoten)) {
        p.melde({ regel: 'B5', teil: 'kontexttyp-form', ort: ortVonKnoten(datei, s.knoten), text: `the context type is declared as ${K[s.knoten.kind]}: it must be a type alias for \`Pick\` on the class or for the class` });
      }
    }
  }
}
