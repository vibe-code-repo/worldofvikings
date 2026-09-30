/**
 * Move proof, first phase: everything that is decided on the syntax trees of the old source file,
 * the rest and the target files, without a type checker (rules B1 to B6, B8, B9, B12).
 *
 * The phase also prepares the second one: it records which old node corresponds to which new
 * node and lists the pairs of identifiers rule B7 resolves.
 */
import ts from 'typescript';
import { KnotenPaare, vergleicheListe, type BaumUnterschied } from './baum';
import type { BezeichnerPaar } from './bindung';
import { gebundenesThis, istThis, pruefeUnterstuetzt, vergleicheFormK, vergleicheWoertlich } from './formk';
import { pruefeKlebstoff } from './klebstoff';
import { kommentareIn, pruefeKlebstoffKommentare, pruefeVerschobeneKommentare, type KlebstoffBereich } from './kommentare';
import { pruefeLaden, pruefeLesenVorDerStelle, sammleZuweisungenAusDemRest, type LadeUmgebung, type Zuweisung } from './laden';
import { pruefeOrt } from './ort';
import { deklarierteNamen, dekoratoren, mitgliedName, modifikatoren, syntaxFehler } from './stuecke';
import { kurz, ortVon, ortVonKnoten, type Datei, type KnotenBezug, type Manifest, type Protokoll, type Stueck } from './typen';
import { pruefeWeiterleitung } from './weiterleitung';
import { erwarteteFunktion, vergleicheJs } from './zweitlinie';
import { zerlege, type Zerlegung } from './zerlegung';

const K = ts.SyntaxKind;

export interface SyntaxErgebnis {
  zerlegung: Zerlegung;
  knotenPaare: KnotenPaare;
  bezeichner: BezeichnerPaar[];
  /** Forwarders whose body has the declared form: the called identifier and the function it must reach. */
  aufrufe: { name: string; aufgerufen: ts.Identifier; funktion: KnotenBezug }[];
  gelockert: { name: string; was: string; ort: { datei: Datei; pos: number } }[];
  /** Extents of old pieces that carry a finding of rule B2 or B3. */
  gestoert: { von: number; bis: number }[];
  /** Places where the rest assigns to a name equal to that of a moved `let`/`var`: rule B12 decides with the old program. */
  zuweisungen: Zuweisung[];
}

function bezug(datei: Datei, n: ts.Node): KnotenBezug {
  return { datei: datei.pfad, pos: n.pos, end: n.end, kind: n.kind };
}

function meldeBaum(p: Protokoll, teil: string, name: string, u: BaumUnterschied, alt: Datei, neu: Datei): void {
  const ort = u.neu ? ortVonKnoten(neu, u.neu) : u.alt ? ortVonKnoten(alt, u.alt) : ortVon(neu, 0);
  const altZeile = u.alt ? ` (old line ${ortVonKnoten(alt, u.alt).zeile})` : '';
  p.melde({ regel: 'B3', teil, ort, text: `"${name}": ${u.grund}${altZeile}` });
}

/** Children of a declaration without its modifiers and decorators. */
function ohneModifikatoren(n: ts.Node): ts.Node[] {
  const weg = new Set<ts.Node>([...modifikatoren(n), ...dekoratoren(n)]);
  const aus: ts.Node[] = [];
  n.forEachChild((k) => {
    if (!weg.has(k)) aus.push(k);
  });
  return aus;
}

export function syntaxPhase(manifest: Manifest, alt: Datei, rest: Datei, ziele: ReadonlyMap<string, Datei>, p: Protokoll): SyntaxErgebnis {
  for (const d of [alt, rest, ...ziele.values()]) {
    p.zaehle('B12');
    const f = syntaxFehler(d)[0];
    if (f) p.melde({ regel: 'B12', teil: 'syntax', ort: ortVon(d, f.start), text: `${d.pfad} does not parse: ${ts.flattenDiagnosticMessageText(f.messageText, ' ')}` });
  }
  const z = zerlege(manifest, alt, rest, ziele, p);
  const knotenPaare = new KnotenPaare();
  const roh: { alt: ts.Node; neu: ts.Node; neuDatei: Datei; eigenePaare?: KnotenPaare; erwartet?: KnotenBezug; ueberspringen?: boolean }[] = [];
  const sammle = (neuDatei: Datei, liste: { alt: ts.Node; neu: ts.Node }[], zusatz: { eigenePaare?: KnotenPaare } = {}): void => {
    for (const b of liste) roh.push({ ...b, neuDatei, ...zusatz });
  };
  const bereiche: KlebstoffBereich[] = [];
  const erg: SyntaxErgebnis = { zerlegung: z, knotenPaare, bezeichner: [], aufrufe: [], gelockert: [], gestoert: [], zuweisungen: [] };
  const stoere = (s: Stueck): void => {
    erg.gestoert.push({ von: s.von, bis: s.bis });
  };

  // -- unmoved statements: byte-identical, so the trees are equal; the walk records the partners --
  for (const u of z.unveraendert) {
    const b: { alt: ts.Node; neu: ts.Node }[] = [];
    const v = vergleicheWoertlich(u.alt.knoten, u.neu.knoten, alt, rest, knotenPaare, b);
    if (v.unterschied || u.alt.text !== u.neu.text) stoere(u.alt);
    sammle(rest, b);
  }
  for (const i of z.importe.paare) {
    if (i.entfernt.length > 0) continue;
    const b: { alt: ts.Node; neu: ts.Node }[] = [];
    vergleicheWoertlich(i.alt.knoten, i.neu.knoten, alt, rest, knotenPaare, b);
    sammle(rest, b);
  }

  // -- the class: head and members --
  if (z.klasse) {
    const ka = z.klasse.alt.knoten as ts.ClassDeclaration;
    const kn = z.klasse.neu.knoten as ts.ClassDeclaration;
    const b: { alt: ts.Node; neu: ts.Node }[] = [];
    const kopf = (k: ts.ClassDeclaration): ts.Node[] => [...modifikatoren(k), ...(k.name ? [k.name] : []), ...(k.typeParameters ?? []), ...(k.heritageClauses ?? [])];
    vergleicheListe(kopf(ka), kopf(kn), alt, rest, { bezeichner: b }, knotenPaare, 'head of the class');
    knotenPaare.setze(ka, kn, rest);
    for (const m of z.klasse.mitglieder) {
      if (m.gelockerteParameter) {
        // The constructor: parameters without `private`/`protected`, then the body.
        const teile = (c: ts.Node, d: Datei): ts.Node[] => [
          ...(c as ts.ConstructorDeclaration).parameters.flatMap((par) => par.getChildren(d.sf).flatMap((ch) => (ch.kind === K.SyntaxList ? ch.getChildren(d.sf).filter((x) => x.kind !== K.PrivateKeyword && x.kind !== K.ProtectedKeyword) : [ch]))),
          ...((c as ts.ConstructorDeclaration).body ? [(c as ts.ConstructorDeclaration).body!] : []),
        ];
        vergleicheListe(teile(m.alt.knoten, alt), teile(m.neu.knoten, rest), alt, rest, { bezeichner: b }, knotenPaare, 'parts of the constructor');
        knotenPaare.setze(m.alt.knoten, m.neu.knoten, rest);
        // The parameters themselves are declarations: their partners are the parameters of the rest.
        (m.alt.knoten as ts.ConstructorDeclaration).parameters.forEach((par, i) => {
          const np = (m.neu.knoten as ts.ConstructorDeclaration).parameters[i];
          if (np) knotenPaare.setze(par, np, rest);
        });
        for (const g of m.gelockerteParameter) erg.gelockert.push({ name: g.name, was: g.was, ort: { datei: rest, pos: g.pos } });
        continue;
      }
      if (m.gelockert === null) {
        const v = vergleicheWoertlich(m.alt.knoten, m.neu.knoten, alt, rest, knotenPaare, b);
        if (v.unterschied || m.alt.text !== m.neu.text) stoere(m.alt);
      } else {
        vergleicheListe(ohneModifikatoren(m.alt.knoten), ohneModifikatoren(m.neu.knoten), alt, rest, { bezeichner: b }, knotenPaare, 'parts of the member');
        knotenPaare.setze(m.alt.knoten, m.neu.knoten, rest);
        erg.gelockert.push({ name: mitgliedName(m.neu.knoten) ?? '?', was: m.gelockert, ort: { datei: rest, pos: m.neu.knoten.getStart(rest.sf) } });
      }
    }
    sammle(rest, b);
  }

  // -- form 0 --
  const ladeUmgebung: LadeUmgebung = {
    verschoben: new Set(manifest.ziele.flatMap((t) => t.woertlich)),
    bleibt: new Set(z.restAlt.flatMap((s) => deklarierteNamen(s.knoten))),
  };
  const alleAlt = [...z.restAlt, ...z.form0.map((f) => f.alt)];
  for (const f of z.form0) {
    const neu = f.neu.datei;
    p.zaehle('B3');
    // The moved text: the old extent without the section lines that stayed in the rest (rule B13).
    const altVon = f.alt.von + f.abschnitt.length;
    if (f.neu.text !== f.vorspann + f.alt.text.slice(f.abschnitt.length)) {
      const davor = f.neu.text.slice(f.vorspann.length, f.neu.knoten.getStart(neu.sf) - f.neu.von);
      const davorAlt = f.alt.text.slice(f.abschnitt.length, f.alt.knoten.getStart(alt.sf) - f.alt.von);
      const wo = davor !== davorAlt && f.neu.knoten.getText(neu.sf) === f.alt.knoten.getText(alt.sf) ? 'the lines before the declaration differ' : 'the text of the declaration differs';
      p.melde({ regel: 'B3', teil: 'form0-bytes', ort: ortVonKnoten(neu, f.neu.knoten), text: `"${f.name}" moved verbatim, but is not byte-identical: ${wo} (old line ${ortVonKnoten(alt, f.alt.knoten).zeile})` });
    }
    const b: { alt: ts.Node; neu: ts.Node }[] = [];
    const v = vergleicheWoertlich(f.alt.knoten, f.neu.knoten, alt, neu, knotenPaare, b);
    p.zaehle('B3', v.knoten);
    if (v.unterschied) {
      meldeBaum(p, 'baum', f.name, v.unterschied, alt, neu);
      stoere(f.alt);
    }
    sammle(neu, b);
    p.zaehle('B4');
    const js = vergleicheJs(f.alt.knoten.getText(alt.sf), f.neu.knoten.getText(neu.sf), alt.pfad, neu.pfad);
    if (js !== null) p.melde({ regel: 'B4', teil: 'js', ort: ortVonKnoten(neu, f.neu.knoten), text: `"${f.name}": ${js}` });
    pruefeVerschobeneKommentare(f.name, { datei: alt, von: altVon, bis: f.alt.bis }, { datei: neu, von: f.neu.von + f.vorspann.length, bis: f.neu.bis }, true, p);
    if (f.vorspann !== '') bereiche.push({ datei: neu, von: f.neu.von, bis: f.neu.von + f.vorspann.length, art: 'kopf', was: `the lines in front of the first declaration of ${neu.pfad}` });
    pruefeOrt(f.name, f.alt.knoten, alt, p);
    pruefeLaden(f.name, f.alt, alt, z.restAlt, ladeUmgebung, p);
    pruefeLesenVorDerStelle(f.name, f.alt, alt, alleAlt, z.restAlt, p);
    erg.zuweisungen.push(...sammleZuweisungenAusDemRest(f.name, f.alt, alt, z.restAlt, p));
  }

  // -- form k --
  for (const [name, stueck] of z.methodenAlt) {
    const ziel = manifest.ziele.find((t) => t.methoden.includes(name));
    if (ziel?.kontext && manifest.klasse !== undefined) pruefeUnterstuetzt({ name, alt: stueck }, alt, manifest.klasse, ziel.kontext, p);
    pruefeOrt(name, stueck.knoten, alt, p);
  }
  for (const f of z.formk) {
    const kontext = f.ziel.kontext;
    if (!kontext) continue;
    const neu = f.neu.datei;
    const b: { alt: ts.Node; neu: ts.Node }[] = [];
    const v = vergleicheFormK(f, alt, neu, kontext, knotenPaare, b);
    p.zaehle('B3', v.knoten);
    if (v.unterschied) {
      meldeBaum(p, 'baum', f.name, v.unterschied, alt, neu);
      stoere(f.alt);
    }
    const funktion = f.neu.knoten as ts.FunctionDeclaration;
    const kParameter = funktion.parameters?.[0];
    const gebunden = ts.isMethodDeclaration(f.alt.knoten) ? gebundenesThis(f.alt.knoten) : new Set<ts.Node>();
    for (const x of b) {
      if (gebunden.has(x.alt) && kParameter) roh.push({ ...x, neuDatei: neu, erwartet: bezug(neu, kParameter) });
      else if (istThis(x.alt)) roh.push({ ...x, neuDatei: neu, ueberspringen: true });
      else roh.push({ ...x, neuDatei: neu });
    }
    if (ts.isMethodDeclaration(f.alt.knoten)) {
      p.zaehle('B4');
      const erwartet = erwarteteFunktion(f.alt.knoten, alt, kontext);
      const js = vergleicheJs(erwartet, funktion.getText(neu.sf), alt.pfad, neu.pfad);
      if (js !== null) p.melde({ regel: 'B4', teil: 'js', ort: ortVonKnoten(neu, funktion), text: `"${f.name}": ${js}` });
    }
    // Comments: a function that opens its file carries the header comment of the file in front of its own.
    let von = f.neu.von;
    const erste = neu.sf.statements[0] === funktion;
    const altVon = f.alt.von + f.abschnitt.length;
    if (erste) {
      const alle = kommentareIn(neu, f.neu.von, funktion.getStart(neu.sf));
      const eigene = kommentareIn(alt, altVon, f.alt.knoten.getStart(alt.sf)).length;
      const kopf = alle.slice(0, Math.max(0, alle.length - eigene));
      if (kopf.length > 0) {
        von = kopf[kopf.length - 1]!.bis;
        bereiche.push({ datei: neu, von: f.neu.von, bis: von, art: 'kopf', was: `the header of ${neu.pfad}` });
      }
    }
    pruefeVerschobeneKommentare(f.name, { datei: alt, von: altVon, bis: f.alt.bis }, { datei: neu, von, bis: f.neu.bis }, false, p);

    const w = pruefeWeiterleitung(f, alt, rest, p);
    sammle(rest, w.bezeichner, { eigenePaare: w.paare });
    // As a member of the class the old method corresponds to its forwarder: `this.m()` anywhere
    // in the old file and `k.m()` or `this.m()` in the new state must both reach it.
    if (f.weiterleitung) knotenPaare.setze(f.alt.knoten, f.weiterleitung.knoten, rest);
    if (w.gelockert && f.weiterleitung) erg.gelockert.push({ name: f.name, was: w.gelockert, ort: { datei: rest, pos: f.weiterleitung.knoten.getStart(rest.sf) } });
    if (w.aufgerufen) erg.aufrufe.push({ name: f.name, aufgerufen: w.aufgerufen, funktion: bezug(neu, funktion) });
    // The lines in front of the forwarder are empty lines and section lines of the old state (B13); the rest is the forwarder.
    if (f.weiterleitung) bereiche.push({ datei: rest, von: f.weiterleitung.von + f.abschnitt.length, bis: f.weiterleitung.bis, art: 'weiterleitung', was: `the forwarder "${f.name}"` });
  }

  // -- glue --
  pruefeKlebstoff(manifest, z, p);
  const kleber = (s: Stueck, was: string): void => {
    bereiche.push({ datei: s.datei, von: s.von, bis: s.bis, art: 'klebstoff', was });
  };
  for (const s of z.importe.neu) kleber(s, 'a new import of the rest');
  for (const s of z.weiterExporte) kleber(s, 'a re-export of the rest');
  for (const i of [...z.importe.paare, ...z.importe.umgestellt]) {
    if (i.entfernt.length === 0) continue;
    // The lines before the import are byte-identical (B2); the import itself lost names and is glue.
    bereiche.push({ datei: rest, von: i.neu.knoten.getStart(rest.sf), bis: i.neu.bis, art: 'klebstoff', was: 'an import of the rest that lost names' });
  }
  for (const t of z.ziele) {
    for (const s of t.importe) kleber(s, `an import of ${t.datei.pfad}`);
    for (const s of t.exportlisten) kleber(s, `an export list of ${t.datei.pfad}`);
    for (const s of t.kontexttyp) bereiche.push({ datei: s.datei, von: s.von, bis: s.bis, art: 'kontexttyp', was: `the context type of ${t.datei.pfad}` });
    bereiche.push({ datei: t.datei, von: t.schlussVon, bis: t.datei.text.length, art: 'schluss', was: `the end of ${t.datei.pfad}` });
  }
  pruefeKlebstoffKommentare(bereiche, p);

  // -- identifier pairs for rule B7 --
  for (const r of roh) {
    const text = r.alt.kind === K.ThisKeyword ? 'this' : (r.alt as ts.Identifier).text;
    const paar: BezeichnerPaar = {
      alt: { pos: r.alt.pos, end: r.alt.end, start: r.alt.getStart(alt.sf) },
      neu: { datei: r.neuDatei.pfad, pos: r.neu.pos, end: r.neu.end, start: r.neu.getStart(r.neuDatei.sf) },
      text: kurz(text, 40),
    };
    if (r.erwartet) paar.erwartet = r.erwartet;
    if (r.eigenePaare) paar.eigenePaare = r.eigenePaare;
    if (r.ueberspringen || (istThis(r.alt) && !r.erwartet)) paar.ueberspringen = true;
    erg.bezeichner.push(paar);
  }
  return erg;
}
