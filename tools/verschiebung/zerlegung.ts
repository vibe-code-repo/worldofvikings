/**
 * Move proof, rules B1, B2 and B13: the partition of both states.
 *
 * Every statement of the old source file and every member of the old class is assigned to
 * exactly one place of the new state: unchanged in the rest, moved verbatim into a target file
 * (form 0), or moved as a function with a forwarder left in the class (form k). Every statement
 * of the new rest and of the target files either comes from the old state or is a candidate for
 * glue, which `klebstoff.ts` judges.
 */
import ts from 'typescript';
import { abschnittsVorspann, abschnittszeilenIn, erklaereVorspann, nurLeerUndAbschnitt, nurLeerzeilen } from './abschnitt';
import { ordneImporteZu, type ImportZuordnung } from './importe';
import { anweisungen, deklarationsArt, deklarierteNamen, hatModifikator, mitgliedName, modifikatoren, schneideKlasse, type KlassenSchnitt } from './stuecke';
import { kurz, ortVon, ortVonKnoten, type Datei, type Manifest, type Protokoll, type Stueck, type ZielAngabe } from './typen';

const K = ts.SyntaxKind;

export interface Form0Paar {
  name: string;
  ziel: ZielAngabe;
  alt: Stueck;
  neu: Stueck;
  /** Text the new extent carries in front of the moved text: the header comment of the file, or empty lines. */
  vorspann: string;
  /** Start of the old extent that stayed in the rest (section lines, rule B13). Not part of the moved text. */
  abschnitt: string;
}

export interface FormkPaar {
  name: string;
  ziel: ZielAngabe;
  alt: Stueck;
  /** The function in the target file. */
  neu: Stueck;
  /** The forwarder in the class of the rest. `null` if it is missing. */
  weiterleitung: Stueck | null;
  /** Start of the old extent that stayed in front of the forwarder (empty lines and section lines). */
  abschnitt: string;
}

export interface MitgliedPaar {
  alt: Stueck;
  neu: Stueck;
  /** Name of the visibility modifier the member lost, or `null` if the member is byte-identical. */
  gelockert: 'private' | 'protected' | null;
  /** Parameter properties of a constructor that lost `private` or `protected`, with their place in the rest. */
  gelockerteParameter?: { name: string; was: 'private' | 'protected'; pos: number }[];
}

export interface ZielZerlegung {
  angabe: ZielAngabe;
  datei: Datei;
  importe: Stueck[];
  exportlisten: Stueck[];
  kontexttyp: Stueck[];
  /** Text after the last statement. */
  schluss: string;
  schlussVon: number;
}

export interface Zerlegung {
  alt: Datei;
  rest: Datei;
  ziele: ZielZerlegung[];
  unveraendert: { alt: Stueck; neu: Stueck }[];
  klasse: { alt: Stueck; neu: Stueck; altSchnitt: KlassenSchnitt; neuSchnitt: KlassenSchnitt; mitglieder: MitgliedPaar[] } | null;
  form0: Form0Paar[];
  formk: FormkPaar[];
  importe: ImportZuordnung;
  /** Methods of the old class the manifest names, found or not in a target file. */
  methodenAlt: Map<string, Stueck>;
  weiterExporte: Stueck[];
  /** Old statements that stay, in order, with the statements of the old state that were moved away left out. */
  restAlt: Stueck[];
}

function istImport(s: Stueck): boolean {
  return ts.isImportDeclaration(s.knoten);
}

function istWeiterExport(s: Stueck): boolean {
  return ts.isExportDeclaration(s.knoten) && s.knoten.moduleSpecifier !== undefined;
}

function istExportliste(s: Stueck): boolean {
  return ts.isExportDeclaration(s.knoten) && s.knoten.moduleSpecifier === undefined && s.knoten.exportClause !== undefined && ts.isNamedExports(s.knoten.exportClause);
}

/** First line in which two texts differ, for a message. */
export function ersterUnterschied(alt: string, neu: string): string {
  const a = alt.split('\n');
  const n = neu.split('\n');
  let i = 0;
  while (i < a.length && i < n.length && a[i] === n[i]) i++;
  return `line ${i + 1} of the piece: old "${kurz(a[i] ?? '(end)', 60)}" / new "${kurz(n[i] ?? '(end)', 60)}"`;
}

function vorlauf(s: Stueck): string {
  return s.datei.text.slice(s.von, s.knoten.getStart(s.datei.sf));
}

/** Whole lines of the extent in front of the line on which the node starts. */
function zeilenDavor(s: Stueck): string {
  const start = s.knoten.getStart(s.datei.sf);
  const zeilenStart = s.datei.text.lastIndexOf('\n', start - 1) + 1;
  return zeilenStart > s.von ? s.datei.text.slice(s.von, zeilenStart) : '';
}

/** Text of a member with the visibility modifier `welcher` and the blanks after it taken out. */
function ohneSichtbarkeit(s: Stueck, welcher: ts.SyntaxKind): string | null {
  const m = modifikatoren(s.knoten).find((x) => x.kind === welcher);
  if (!m) return null;
  const sf = s.datei.sf;
  const von = m.getStart(sf) - s.von;
  let bis = m.end - s.von;
  while (bis < s.text.length && (s.text[bis] === ' ' || s.text[bis] === '\t')) bis++;
  return s.text.slice(0, von) + s.text.slice(bis);
}

/**
 * Parameter properties of the old constructor whose `private` or `protected` is missing in the
 * rest, if that is the only difference between the two constructors. `null` otherwise.
 */
function parameterLockerung(e: Stueck, r: Stueck, alt: Datei): { name: string; was: 'private' | 'protected' }[] | null {
  const c = e.knoten as ts.ConstructorDeclaration;
  const kandidaten: { name: string; was: 'private' | 'protected'; von: number; bis: number }[] = [];
  for (const par of c.parameters) {
    const mod = modifikatoren(par).find((x) => x.kind === K.PrivateKeyword || x.kind === K.ProtectedKeyword);
    if (!mod || !ts.isIdentifier(par.name)) continue;
    let bis = mod.end;
    while (alt.text[bis] === ' ') bis++;
    kandidaten.push({ name: par.name.text, was: mod.kind === K.PrivateKeyword ? 'private' : 'protected', von: mod.getStart(alt.sf) - e.von, bis: bis - e.von });
  }
  if (kandidaten.length === 0 || kandidaten.length > 12) return null;
  for (let maske = 1; maske < 1 << kandidaten.length; maske++) {
    const gewaehlt = kandidaten.filter((_, i) => maske & (1 << i));
    let text = e.text;
    for (const g of [...gewaehlt].sort((x, y) => y.von - x.von)) text = text.slice(0, g.von) + text.slice(g.bis);
    if (text === r.text) return gewaehlt.map((g) => ({ name: g.name, was: g.was }));
  }
  return null;
}

function parameterStart(r: Stueck, name: string, datei: Datei): number {
  const par = (r.knoten as ts.ConstructorDeclaration).parameters.find((x) => ts.isIdentifier(x.name) && x.name.text === name);
  return par ? par.getStart(datei.sf) : r.knoten.getStart(datei.sf);
}

export function zerlege(manifest: Manifest, alt: Datei, rest: Datei, zielDateien: ReadonlyMap<string, Datei>, p: Protokoll): Zerlegung {
  const altSchnitt = anweisungen(alt);
  const restSchnitt = anweisungen(rest);
  const zielVon = new Map<string, ZielAngabe>();
  for (const z of manifest.ziele) for (const n of z.woertlich) zielVon.set(n, z);
  const methodeVon = new Map<string, ZielAngabe>();
  for (const z of manifest.ziele) for (const n of z.methoden) methodeVon.set(n, z);

  // -- old side: what is each statement --
  const importeAlt: Stueck[] = [];
  const restAlt: Stueck[] = [];
  const verschoben = new Map<Stueck, { name: string; ziel: ZielAngabe }>();
  const gefunden = new Map<string, number>();
  let klasseAlt: Stueck | null = null;
  for (const s of altSchnitt.stuecke) {
    p.zaehle('B1');
    if (istImport(s)) {
      importeAlt.push(s);
      continue;
    }
    const namen = deklarierteNamen(s.knoten);
    const genannt = namen.filter((n) => zielVon.has(n));
    if (genannt.length > 0) {
      for (const n of genannt) gefunden.set(n, (gefunden.get(n) ?? 0) + 1);
      const ziele = new Set(genannt.map((n) => zielVon.get(n)!.datei));
      if (genannt.length !== namen.length || ziele.size !== 1) {
        p.melde({ regel: 'B1', teil: 'geteilt', ort: ortVonKnoten(alt, s.knoten), text: `statement declares ${namen.join(', ')}, the manifest moves only ${genannt.join(', ')} or moves them into different files: a statement moves as a whole` });
        restAlt.push(s);
        continue;
      }
      if (deklarationsArt(s.knoten) === null) {
        p.melde({ regel: 'B12', teil: 'art', ort: ortVonKnoten(alt, s.knoten), text: `"${genannt[0]}" is a ${K[s.knoten.kind]}: form 0 moves constants, functions, classes, interfaces, types and enums` });
      }
      if (hatModifikator(s.knoten, K.DefaultKeyword)) {
        p.melde({ regel: 'B12', teil: 'default', ort: ortVonKnoten(alt, s.knoten), text: `"${genannt[0]}" is the default export of the source file: not supported` });
      }
      if (ts.isFunctionDeclaration(s.knoten) && !s.knoten.body && !hatModifikator(s.knoten, K.DeclareKeyword)) {
        p.melde({ regel: 'B12', teil: 'ueberladung', ort: ortVonKnoten(alt, s.knoten), text: `"${genannt[0]}" has overload signatures: not supported` });
      }
      verschoben.set(s, { name: genannt[0]!, ziel: zielVon.get(genannt[0]!)! });
      continue;
    }
    if (manifest.klasse !== undefined && ts.isClassDeclaration(s.knoten) && s.knoten.name?.text === manifest.klasse) {
      if (klasseAlt) p.melde({ regel: 'B1', teil: 'klasse-doppelt', ort: ortVonKnoten(alt, s.knoten), text: `class "${manifest.klasse}" is declared twice in the old source file` });
      else klasseAlt = s;
    }
    restAlt.push(s);
  }
  for (const n of zielVon.keys()) {
    const anzahl = gefunden.get(n) ?? 0;
    if (anzahl === 0) p.melde({ regel: 'B1', teil: 'name-fehlt', ort: ortVon(alt, 0), text: `"${n}" is named in the manifest, the old source file declares no such name on module level` });
    else if (anzahl > 1) p.melde({ regel: 'B12', teil: 'mehrfach', ort: ortVon(alt, 0), text: `"${n}" is declared ${anzahl} times on module level (overloads or merged declarations): not supported` });
  }
  if (manifest.klasse !== undefined && !klasseAlt) {
    p.melde({ regel: 'B1', teil: 'klasse-fehlt', ort: ortVon(alt, 0), text: `class "${manifest.klasse}" is named in the manifest, the old source file does not declare it on module level` });
  }

  // -- rule B13: section lines a moved declaration may leave behind --
  const geblieben = new Map<Stueck, string>();
  /** Moved declarations that stood between the unmoved statement before `e` and `e` itself (`null`: the end of the file). */
  const kandidatenVor = (e: Stueck | null): Stueck[] => {
    const i = e ? restAlt.indexOf(e) : restAlt.length;
    const von = i > 0 ? restAlt[i - 1]!.bis : 0;
    const bis = e ? e.von : alt.text.length;
    return [...verschoben.keys()].filter((m) => m.von >= von && m.bis <= bis);
  };
  /** Text in front of the old text is explained, if it consists of the section lines moved declarations left here. */
  const erklaere = (neuText: string, altText: string, e: Stueck | null): boolean => {
    if (neuText === altText) return true;
    if (!neuText.endsWith(altText)) return false;
    const kandidaten = kandidatenVor(e);
    const blieb = erklaereVorspann(neuText.slice(0, neuText.length - altText.length), kandidaten.map((m) => abschnittsVorspann(vorlauf(m))));
    if (!blieb) return false;
    kandidaten.forEach((m, i) => {
      if (!blieb[i]) return;
      const text = abschnittsVorspann(vorlauf(m));
      geblieben.set(m, text);
      p.zaehle('B13');
      p.hinweis('B13', `section line stays in the rest, the declaration "${verschoben.get(m)!.name}" behind it moved: ${abschnittszeilenIn(text).join(' | ')} (old line ${ortVon(alt, m.von + text.length - 1).zeile})`);
    });
    return true;
  };

  // -- new rest: statements in order --
  const importeRest: Stueck[] = [];
  const weiterExporte: Stueck[] = [];
  const unveraendert: { alt: Stueck; neu: Stueck }[] = [];
  let klasseNeu: Stueck | null = null;
  let i = 0;
  const gleicheDeklaration = (a: Stueck, n: Stueck): boolean => a.knoten.kind === n.knoten.kind && deklarierteNamen(a.knoten).join() === deklarierteNamen(n.knoten).join() && deklarierteNamen(a.knoten).length > 0;
  for (const r of restSchnitt.stuecke) {
    p.zaehle('B1');
    if (istImport(r)) {
      importeRest.push(r);
      continue;
    }
    const e = restAlt[i];
    if (e && e === klasseAlt && ts.isClassDeclaration(r.knoten) && r.knoten.name?.text === manifest.klasse) {
      klasseNeu = r;
      i++;
      continue;
    }
    if (e && e !== klasseAlt && erklaere(r.text, e.text, e)) {
      p.zaehle('B2');
      unveraendert.push({ alt: e, neu: r });
      i++;
      continue;
    }
    if (istWeiterExport(r) && !(e && istWeiterExport(e) && e.knoten.getText(alt.sf) === r.knoten.getText(rest.sf))) {
      weiterExporte.push(r);
      continue;
    }
    // Not identical and no glue: say what it is most likely.
    const spaeter = restAlt.findIndex((x, j) => j > i && x !== klasseAlt && x.text === r.text);
    if (e && e !== klasseAlt && (gleicheDeklaration(e, r) || e.knoten.getText(alt.sf) === r.knoten.getText(rest.sf))) {
      p.zaehle('B2');
      p.melde({ regel: 'B2', teil: 'anweisung', ort: ortVonKnoten(rest, r.knoten), text: `unmoved statement differs from the old state, ${ersterUnterschied(e.text, r.text)}` });
      unveraendert.push({ alt: e, neu: r });
      i++;
    } else if (spaeter >= 0) {
      for (let j = i; j < spaeter; j++) {
        const f = restAlt[j]!;
        p.melde({ regel: 'B1', teil: 'fehlt-im-rest', ort: ortVonKnoten(alt, f.knoten), text: `statement of the old source file is neither in the rest at its place nor declared as moved: ${kurz(f.knoten.getText(alt.sf))}` });
      }
      p.zaehle('B2');
      unveraendert.push({ alt: restAlt[spaeter]!, neu: r });
      i = spaeter + 1;
    } else {
      p.melde({ regel: 'B1', teil: 'fremd-im-rest', ort: ortVonKnoten(rest, r.knoten), text: `statement of the rest has no origin in the old state and is no glue: ${kurz(r.knoten.getText(rest.sf))}` });
    }
  }
  for (; i < restAlt.length; i++) {
    const f = restAlt[i]!;
    p.melde({ regel: 'B1', teil: 'fehlt-im-rest', ort: ortVonKnoten(alt, f.knoten), text: `statement of the old source file is neither in the rest at its place nor declared as moved: ${kurz(f.knoten.getText(alt.sf))}` });
  }
  p.zaehle('B2');
  if (!erklaere(restSchnitt.schluss, altSchnitt.schluss, null)) {
    p.melde({ regel: 'B2', teil: 'dateiende', ort: ortVon(rest, restSchnitt.schlussVon), text: `text after the last statement differs: old "${kurz(altSchnitt.schluss, 50)}" / new "${kurz(restSchnitt.schluss, 50)}"` });
  }

  // -- imports of the rest against the imports of the old state, in order --
  const importe = ordneImporteZu(importeAlt, importeRest);
  for (const paar of importe.paare) {
    p.zaehle('B2');
    if (paar.entfernt.length === 0 && paar.alt.text !== paar.neu.text) {
      p.melde({ regel: 'B2', teil: 'import', ort: ortVonKnoten(rest, paar.neu.knoten), text: `import that stays differs from the old state, ${ersterUnterschied(paar.alt.text, paar.neu.text)}` });
    } else if (paar.entfernt.length > 0 && vorlauf(paar.alt) !== vorlauf(paar.neu)) {
      p.melde({ regel: 'B2', teil: 'import-vorlauf', ort: ortVon(rest, paar.neu.von), text: `lines before an import that stays differ from the old state, ${ersterUnterschied(vorlauf(paar.alt), vorlauf(paar.neu))}` });
    }
  }

  // -- the class: head, members, tail --
  let klasse: Zerlegung['klasse'] = null;
  const formk: FormkPaar[] = [];
  const weiterleitungVon = new Map<string, Stueck>();
  const methodeAlt = new Map<string, Stueck>();
  if (klasseAlt) {
    const as = schneideKlasse(klasseAlt);
    for (const m of as.mitglieder) {
      const n = mitgliedName(m.knoten);
      if (n !== null && methodeVon.has(n)) {
        if (methodeAlt.has(n)) p.melde({ regel: 'B12', teil: 'ueberladung', ort: ortVonKnoten(alt, m.knoten), text: `member "${n}" exists more than once in the class (overloads or accessor pair): not supported` });
        else methodeAlt.set(n, m);
      }
    }
    for (const n of methodeVon.keys()) {
      if (!methodeAlt.has(n)) p.melde({ regel: 'B1', teil: 'name-fehlt', ort: ortVonKnoten(alt, klasseAlt.knoten), text: `method "${n}" is named in the manifest, class "${manifest.klasse}" has no such member` });
    }
    if (!klasseNeu) {
      p.melde({ regel: 'B1', teil: 'klasse-fehlt', ort: ortVon(rest, 0), text: `class "${manifest.klasse}" is not at its place in the rest` });
    } else {
      const ns = schneideKlasse(klasseNeu);
      const mitglieder: MitgliedPaar[] = [];
      p.zaehle('B2', 2);
      if (!erklaere(ns.kopf, as.kopf, klasseAlt)) p.melde({ regel: 'B2', teil: 'klassenkopf', ort: ortVonKnoten(rest, klasseNeu.knoten), text: `head of the class differs from the old state, ${ersterUnterschied(as.kopf, ns.kopf)}` });
      if (as.schluss !== ns.schluss) p.melde({ regel: 'B2', teil: 'klassenende', ort: ortVon(rest, ns.schlussVon), text: `text after the last member of the class differs: old "${kurz(as.schluss, 50)}" / new "${kurz(ns.schluss, 50)}"` });
      let a = 0;
      const istVerschoben = (m: Stueck): string | null => {
        const n = mitgliedName(m.knoten);
        return n !== null && methodeAlt.get(n) === m ? n : null;
      };
      for (const r of ns.mitglieder) {
        p.zaehle('B1');
        const e = as.mitglieder[a];
        const name = e ? istVerschoben(e) : null;
        if (e && name !== null && mitgliedName(r.knoten) === name) {
          weiterleitungVon.set(name, r);
          a++;
          continue;
        }
        if (e && name === null && e.text === r.text) {
          p.zaehle('B2');
          mitglieder.push({ alt: e, neu: r, gelockert: null });
          a++;
          continue;
        }
        if (e && name === null && ts.isConstructorDeclaration(e.knoten) && ts.isConstructorDeclaration(r.knoten)) {
          p.zaehle('B2');
          const lockerung = parameterLockerung(e, r, alt);
          if (lockerung !== null) {
            mitglieder.push({ alt: e, neu: r, gelockert: null, gelockerteParameter: lockerung.map((l) => ({ ...l, pos: parameterStart(r, l.name, rest) })) });
          } else {
            p.melde({ regel: 'B2', teil: 'mitglied', ort: ortVonKnoten(rest, r.knoten), text: `unmoved constructor differs from the old state, ${ersterUnterschied(e.text, r.text)}` });
            mitglieder.push({ alt: e, neu: r, gelockert: null });
          }
          a++;
          continue;
        }
        if (e && name === null && mitgliedName(e.knoten) !== null && mitgliedName(e.knoten) === mitgliedName(r.knoten) && e.knoten.kind === r.knoten.kind) {
          p.zaehle('B2');
          const lockerung = ([K.PrivateKeyword, K.ProtectedKeyword] as const).find((w) => ohneSichtbarkeit(e, w) === r.text);
          if (lockerung !== undefined) {
            mitglieder.push({ alt: e, neu: r, gelockert: lockerung === K.PrivateKeyword ? 'private' : 'protected' });
          } else {
            p.melde({ regel: 'B2', teil: 'mitglied', ort: ortVonKnoten(rest, r.knoten), text: `unmoved member "${mitgliedName(r.knoten)}" differs from the old state, ${ersterUnterschied(e.text, r.text)}` });
            mitglieder.push({ alt: e, neu: r, gelockert: null });
          }
          a++;
          continue;
        }
        const spaeter = as.mitglieder.findIndex((x, k) => k > a && istVerschoben(x) === null && x.text === r.text);
        if (spaeter >= 0) {
          for (let k = a; k < spaeter; k++) {
            const f = as.mitglieder[k]!;
            if (istVerschoben(f) !== null) continue; // the missing forwarder is reported below
            p.melde({ regel: 'B1', teil: 'mitglied-fehlt', ort: ortVonKnoten(alt, f.knoten), text: `member of the old class is not at its place in the rest: ${kurz(f.knoten.getText(alt.sf))}` });
          }
          p.zaehle('B2');
          mitglieder.push({ alt: as.mitglieder[spaeter]!, neu: r, gelockert: null });
          a = spaeter + 1;
        } else {
          p.melde({ regel: 'B1', teil: 'mitglied-fremd', ort: ortVonKnoten(rest, r.knoten), text: `member of the class has no origin in the old state and is no forwarder of a moved method: ${kurz(r.knoten.getText(rest.sf))}` });
        }
      }
      for (; a < as.mitglieder.length; a++) {
        const f = as.mitglieder[a]!;
        if (istVerschoben(f) !== null) continue; // the missing forwarder is reported below
        p.melde({ regel: 'B1', teil: 'mitglied-fehlt', ort: ortVonKnoten(alt, f.knoten), text: `member of the old class is not at its place in the rest: ${kurz(f.knoten.getText(alt.sf))}` });
      }
      klasse = { alt: klasseAlt, neu: klasseNeu, altSchnitt: as, neuSchnitt: ns, mitglieder };
    }
  }

  // -- lines in front of a forwarder: empty lines and section lines of the old method, nothing else --
  const abschnittVor = new Map<string, string>();
  for (const [name, w] of weiterleitungVon) {
    const m = methodeAlt.get(name)!;
    const davor = zeilenDavor(w);
    p.zaehle('B13');
    if (nurLeerUndAbschnitt(davor) && m.text.startsWith(davor)) {
      abschnittVor.set(name, davor);
      const zeilen = abschnittszeilenIn(davor);
      if (zeilen.length > 0) p.hinweis('B13', `section line stays in the class in front of the forwarder "${name}": ${zeilen.join(' | ')}`);
    } else {
      p.melde({ regel: 'B13', teil: 'vorlauf-weiterleitung', ort: ortVon(rest, w.von), text: `lines in front of the forwarder "${name}" are not the empty lines and section lines that stood in front of the method: "${kurz(davor, 60)}"` });
    }
  }

  // -- target files: statements in order --
  const form0: Form0Paar[] = [];
  const ziele: ZielZerlegung[] = [];
  for (const angabe of manifest.ziele) {
    const datei = zielDateien.get(angabe.datei);
    if (!datei) continue; // reported by the caller: the file does not exist
    const schnitt = anweisungen(datei);
    const erwartet: { stueck: Stueck; name: string; form: '0' | 'k' }[] = [];
    for (const [s, v] of verschoben) if (v.ziel === angabe) erwartet.push({ stueck: s, name: v.name, form: '0' });
    for (const [n, s] of methodeAlt) if (methodeVon.get(n) === angabe) erwartet.push({ stueck: s, name: n, form: 'k' });
    erwartet.sort((x, y) => x.stueck.von - y.stueck.von);
    const zz: ZielZerlegung = { angabe, datei, importe: [], exportlisten: [], kontexttyp: [], schluss: schnitt.schluss, schlussVon: schnitt.schlussVon };
    // Every expected piece is taken once. A piece that is found out of its order is paired all the
    // same, so that the other rules can judge it, and the wrong order is a finding of its own.
    const offen = new Set(erwartet);
    const nimm = (x: (typeof erwartet)[number], t: Stueck): void => {
      const vorn = erwartet.find((y) => offen.has(y));
      if (vorn !== x && vorn) {
        p.melde({ regel: 'B1', teil: 'reihenfolge-im-ziel', ort: ortVonKnoten(datei, t.knoten), text: `"${x.name}" stands before "${vorn.name}" in the target file, in the source it stood after it: moved declarations keep their order` });
      }
      offen.delete(x);
    };
    schnitt.stuecke.forEach((t, nr) => {
      p.zaehle('B1');
      if (istImport(t)) {
        zz.importe.push(t);
        return;
      }
      const namen = deklarierteNamen(t.knoten);
      const erw = erwartet.find((x) => offen.has(x) && (x.form === '0' ? namen.includes(x.name) : ts.isFunctionDeclaration(t.knoten) && t.knoten.name?.text === x.name));
      if (erw && erw.form === '0') {
        const abschnitt = geblieben.get(erw.stueck) ?? '';
        const soll = erw.stueck.text.slice(abschnitt.length);
        // In front of the moved text the new extent may carry the header comment of the file (first
        // statement) or, where section lines stayed behind, empty lines. Anything else is left to
        // B3, which compares the bytes and says where the texts and the trees differ.
        let vorspann = '';
        if (t.text !== soll && t.text.endsWith(soll)) {
          const davor = t.text.slice(0, t.text.length - soll.length);
          const nurVorlauf = t.knoten.getStart(datei.sf) - t.von >= davor.length;
          if (nurVorlauf && (nr === 0 || (abschnitt !== '' && nurLeerzeilen(davor)))) vorspann = davor;
        }
        form0.push({ name: erw.name, ziel: angabe, alt: erw.stueck, neu: t, vorspann, abschnitt });
        nimm(erw, t);
        return;
      }
      if (erw && erw.form === 'k') {
        formk.push({ name: erw.name, ziel: angabe, alt: erw.stueck, neu: t, weiterleitung: weiterleitungVon.get(erw.name) ?? null, abschnitt: abschnittVor.get(erw.name) ?? '' });
        nimm(erw, t);
        return;
      }
      if (angabe.kontext && (ts.isTypeAliasDeclaration(t.knoten) || ts.isInterfaceDeclaration(t.knoten)) && t.knoten.name.text === angabe.kontext.typ) {
        zz.kontexttyp.push(t);
        return;
      }
      if (istExportliste(t)) {
        zz.exportlisten.push(t);
        return;
      }
      const schonDa = erwartet.find((x) => !offen.has(x) && (namen.includes(x.name) || (ts.isFunctionDeclaration(t.knoten) && t.knoten.name?.text === x.name)));
      if (schonDa) {
        p.melde({ regel: 'B1', teil: 'doppelt-im-ziel', ort: ortVonKnoten(datei, t.knoten), text: `"${schonDa.name}" stands in the target file a second time` });
      } else {
        p.melde({ regel: 'B1', teil: 'fremd-im-ziel', ort: ortVonKnoten(datei, t.knoten), text: `statement of the target file has no origin in the old state and is no glue: ${kurz(t.knoten.getText(datei.sf))}` });
      }
    });
    for (const f of erwartet) {
      if (!offen.has(f)) continue;
      p.melde({ regel: 'B1', teil: 'fehlt-im-ziel', ort: ortVonKnoten(alt, f.stueck.knoten), text: `"${f.name}" is declared as moved into ${angabe.datei}, the target file does not contain it` });
    }
    ziele.push(zz);
  }
  for (const [n, s] of methodeAlt) {
    if (weiterleitungVon.has(n)) continue;
    p.melde({ regel: 'B1', teil: 'weiterleitung-fehlt', ort: ortVonKnoten(alt, s.knoten), text: `method "${n}" moved, the class of the rest has no member of this name at its place` });
  }

  return { alt, rest, ziele, unveraendert, klasse, form0, formk, importe, weiterExporte, restAlt, methodenAlt: methodeAlt };
}
