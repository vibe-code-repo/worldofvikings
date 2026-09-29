#!/usr/bin/env node
/**
 * i1-verschiebung.mjs — proof of a purely mechanical move (I1 step 0, plan section 5.1).
 * Verschiebebeweis: belegt, dass ein Schnitt nur verschoben und nichts verändert hat.
 *
 * ── Anleitung / How to use ─────────────────────────────────────────────────────────────
 *
 *   node tools/i1-verschiebung.mjs \
 *        --alt   git:origin/main:server/src/WovServer.ts     # Stand VOR dem Schritt (Datei oder git:<ref>:<pfad>)
 *        --rest  server/src/WovServer.ts                      # dieselbe Datei NACH dem Schritt (mit Weiterleitungen)
 *        --ziel  server/src/spiel/Kampf.ts [--ziel …]         # Modul(e), in die verschoben wurde
 *        --namen handleAttack,handleParry                     # verschobene Methoden / freie Funktionen
 *        [--liste namen.txt]                                  # oder: ein Name je Zeile (# = Kommentar)
 *        [--ersetzung tabelle.json]                           # zusätzliche Ersetzungen, s. u.
 *        [--ersetze ALT=NEU …]                                # dito, einzeln
 *        [--kontext k]                                        # Name des Kontext-Parameters (Vorgabe k)
 *        [--klasse WovServer]                                 # Methoden nur aus dieser Klasse (sonst jede)
 *        [--max-zeilen 3]                                     # Länge einer Weiterleitung (Plan 5.6, Vorgabe 3)
 *        [--woertlich]                                        # Form 0: Deklarationen der Modulebene OHNE Kontext und OHNE
 *                                                             # Weiterleitung (Tabellen, Konstanten, Funktionen ohne this)
 *        [--json]                                             # Ausgabe als JSON
 *   node tools/i1-verschiebung.mjs --selbsttest               # Fixtures: echt, gefälscht, unvollständig je Form
 *
 * Exit 0 = Beweis erbracht; 1 = mindestens ein Befund; 2 = Aufruf falsch.
 *
 * Was bewiesen wird (je Name, dazu die Summe):
 *   1. Der Text ist bis auf die erlaubte Ersetzung gleich. Verglichen werden Typparameter, Parameter
 *      (Namen, Typen, Optionalität, Vorgaben), Rückgabetyp, `async`/`*` und der Rumpf, jeweils als
 *      Folge der Syntaxbaum-Blätter. Kommentare und Leerraum zählen nicht, Modifikatoren wie
 *      `private`/`export`/`function` auch nicht. Anführungszeichen, Klammern, Semikolons zählen.
 *   2. Die verschobene Funktion nimmt den Kontext als zusätzlichen ERSTEN Parameter (Form a) bzw. bei
 *      Klassenmethoden statt `this`. Alle übrigen Parameter sind unverändert.
 *   3. Die Weiterleitung im Rest hat dieselbe Signatur (Name, Zugriffsmodifikator, Parameter, Rückgabetyp),
 *      ihr Rumpf ist EINE Anweisung, die den Namen mit [beliebigem Kontextausdruck, Parameter…] aufruft,
 *      und sie ist höchstens --max-zeilen Zeilen lang.
 *   4. Nichts doppelt, nichts fehlt: jeder Name steht genau einmal im Alt, genau einmal in den Zielen,
 *      genau einmal (als Weiterleitung, nicht als Original) im Rest; kein Name des Alt-Stands ist im Rest
 *      verschwunden, ohne verschoben zu sein; jeder Ersetzungseintrag trifft mindestens einmal.
 *
 * Form 0 (`--woertlich`): Der Text ist bis auf `export` gleich, die Deklaration steht im Rest nicht mehr,
 *   und war der Name exportiert, führt der Rest ihn per `export { name } from '…'` weiter (kein Importeur ändert sich).
 *   Gedacht für den frühen Schritt „Tabellen und Waffenhelfer“ (Zuarbeit Befund 4): kein `this`, kein Kontext.
 *   Es gibt hier weder Ersetzung noch Weiterleitung; --ersetze, --kontext und --max-zeilen werden ignoriert.
 *
 * Ersetzungstabelle: Schlüssel = alter Name, Wert = neuer Ausdruck (JSON-Objekt oder --ersetze).
 *   "this."        → "k."              Vorgabe. `this.x` wird `k.x`. Ein `this` OHNE folgenden Punkt ist
 *                                      ein Befund („nacktes this“), weil es keine mechanische Ersetzung gibt.
 *   "ADMINS_DATEI" → "k.ADMINS_DATEI"  Form a): ein freier Name der Modulebene wird Feld des Kontexts.
 *                                      Ersetzt werden nur ECHTE Verweise (nicht `x.ADMINS_DATEI`, nicht
 *                                      Objektschlüssel, nicht Deklarationsnamen). Kurzform `{ ADMINS_DATEI }`
 *                                      und ein lokal gleichnamig deklarierter Name sind Befunde.
 *   Das Format ist offen für Erweiterungen: ein Wert darf später ein Objekt sein
 *   ({ "nach": "k.layout()", … }); heute gilt nur der Text. Form b) (veränderliche Modulvariable →
 *   Lesefunktion `k.x()` und Setzer) und Form c) (Anweisungen der Modulebene → Rumpf einer Funktion)
 *   sind NICHT Teil von Schritt 0 und hier nicht gebaut.
 *
 * Funktioniert für Klassenmethoden und freie Funktionen in jeder Datei (WovServer.ts, EntityManager.ts,
 * GegenstandsKatalog.ts, editorMain.ts, admin/src/main.ts), weil weder Dateiname noch Klasse
 * festverdrahtet sind.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const K = ts.SyntaxKind;
const NACKTES_THIS = 'nacktes this';

// ── Einlesen ────────────────────────────────────────────────────────────────────────────

/** Datei oder `git:<ref>:<pfad>` → Text. */
function lies(quelle) {
  const m = /^git:([^:]+):(.+)$/.exec(quelle);
  if (m) return execFileSync('git', ['show', `${m[1]}:${m[2]}`], { encoding: 'utf-8', maxBuffer: 1 << 28 });
  return readFileSync(quelle, 'utf-8');
}

function parse(text, name) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

// ── Blätter als normalisierte Tokenfolge ────────────────────────────────────────────────

/** Alle Blatt-Token eines Knotens; JSDoc und Trivia gibt es hier nicht. */
function blaetter(knoten, sf, aus = []) {
  if (knoten.kind >= K.FirstJSDocNode && knoten.kind <= K.LastJSDocNode) return aus;
  const kinder = knoten.getChildren(sf);
  if (kinder.length === 0) {
    aus.push(knoten);
    return aus;
  }
  for (const k of kinder) blaetter(k, sf, aus);
  return aus;
}

const text = (b, sf) => b.getText(sf);

/** Ist der Bezeichner ein echter Verweis auf einen freien Namen (kein Property-Name, kein Schlüssel, keine Deklaration)? */
function istVerweis(id) {
  const p = id.parent;
  if (!p) return true;
  if ((ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) && (p.name === id || p.right === id)) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if (ts.isShorthandPropertyAssignment(p)) return 'kurzform';
  if ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === id) return false;
  if (ts.isPropertySignature(p) && p.name === id) return false;
  if (ts.isEnumMember(p) && p.name === id) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (
    (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) ||
      ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)) &&
    p.name === id
  ) return 'deklaration';
  return true;
}

/** Namen, die im Knoten lokal deklariert werden (Parameter, var/let/const, Funktionen, Bindungen). */
function lokaleNamen(knoten) {
  const namen = new Set();
  const nimm = (n) => {
    if (!n) return;
    if (ts.isIdentifier(n)) namen.add(n.text);
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const e of n.elements) if (ts.isBindingElement(e)) nimm(e.name);
  };
  const geh = (n) => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) nimm(n.name);
    else if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n)) && n.name) namen.add(n.name.text);
    else if (ts.isCatchClause(n) && n.variableDeclaration) nimm(n.variableDeclaration.name);
    ts.forEachChild(n, geh);
  };
  geh(knoten);
  return namen;
}

/**
 * Tokenfolge eines Knotens mit angewandter Ersetzung. `tabelle` = Map alt → neuer Ausdruck (Text).
 * `treffer` (Map alt → Anzahl) und `befunde` (Liste) werden ergänzt.
 */
function tokens(knoten, sf, tabelle, treffer, befunde, lokal) {
  const aus = [];
  const bl = blaetter(knoten, sf);
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i];
    const t = text(b, sf);
    // this. → …
    if (b.kind === K.ThisKeyword && tabelle) {
      const naechster = bl[i + 1] && text(bl[i + 1], sf);
      const ersatz = tabelle.get('this.');
      const istMitPunkt = naechster === '.' || naechster === '?.';
      if (ersatz !== undefined && istMitPunkt && b.parent && ts.isPropertyAccessExpression(b.parent) && b.parent.expression === b) {
        for (let a = b.parent; a && a !== knoten; a = a.parent) {
          if (ts.isFunctionExpression(a) || ts.isFunctionDeclaration(a) || ts.isMethodDeclaration(a) || ts.isClassLike(a) || ts.isAccessor(a)) {
            befunde.push(`\`this.\` in einer verschachtelten Funktion oder Klasse (${zeile(b, sf)}): bindet dort anders, keine mechanische Ersetzung`);
            break;
          }
        }
        treffer.set('this.', (treffer.get('this.') ?? 0) + 1);
        // `this.x` → `k.x`: der Ersatz steht ohne den Punkt (Schlüssel "this." hat den Punkt schon)
        aus.push(...tokenisiere(ersatz.replace(/\.$/, '')));
        continue;
      }
      if (b.parent && b.parent.kind !== K.ThisType) {
        befunde.push(`${NACKTES_THIS}: "${zeile(b, sf)}" (keine mechanische Ersetzung)`);
      }
      aus.push(t);
      continue;
    }
    // freier Name → Ausdruck
    if (b.kind === K.Identifier && tabelle && tabelle.has(t) && t !== 'this.') {
      const art = istVerweis(b);
      if (art === true) {
        if (lokal.has(t)) befunde.push(`Name "${t}" ist im Rumpf lokal deklariert und wird zugleich ersetzt (Schatten)`);
        treffer.set(t, (treffer.get(t) ?? 0) + 1);
        aus.push(...tokenisiere(tabelle.get(t)));
        continue;
      }
      if (art === 'kurzform') befunde.push(`Kurzform { ${t} } kann nicht mechanisch ersetzt werden (${zeile(b, sf)})`);
    }
    aus.push(t);
  }
  return aus;
}

/** Tokenfolge eines Ausdruckstexts (für die rechte Seite der Tabelle). */
function tokenisiere(ausdruck) {
  const sf = parse(`(${ausdruck});`, 'ersatz.ts');
  const bl = blaetter(sf, sf).map((b) => text(b, sf)).filter((t) => t !== '');
  // Klammern und Semikolon, die wir selbst zugefügt haben, wieder abziehen: ( … ) ;
  return bl.slice(1, -2);
}

function zeile(knoten, sf) {
  const { line } = sf.getLineAndCharacterOfPosition(knoten.getStart(sf));
  return `${sf.fileName}:${line + 1}`;
}

// ── Deklarationen finden ────────────────────────────────────────────────────────────────

/**
 * Alle benennbaren Funktionen einer Datei: Klassenmethoden ({ klasse, name }) und freie Funktionen der
 * Modulebene (function-Deklarationen und `const x = (…) => …`/`function`). Konstruktoren und Accessoren
 * zählen nicht.
 */
function deklarationen(sf) {
  const liste = [];
  const nimmFunktionswert = (name, init, stmt) => {
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) liste.push({ art: 'frei', klasse: null, name, knoten: init, stmt });
  };
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) liste.push({ art: 'frei', klasse: null, name: s.name.text, knoten: s, stmt: s });
    else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) nimmFunktionswert(d.name.text, d.initializer, s);
    } else if (ts.isClassDeclaration(s)) {
      const kn = s.name ? s.name.text : '(anonym)';
      for (const m of s.members) {
        if (ts.isMethodDeclaration(m) && m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name))) {
          liste.push({ art: 'methode', klasse: kn, name: m.name.text, knoten: m, stmt: m });
        }
      }
    }
  }
  return liste;
}

function finde(decls, name, klasse) {
  return decls.filter((d) => (d.art === 'frei' || !klasse || d.klasse === klasse) && d.name === name);
}

// ── Signatur und Rumpf ──────────────────────────────────────────────────────────────────

function hatModifikator(n, art) {
  return !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === art));
}

function zugriff(n) {
  if (hatModifikator(n, K.PrivateKeyword)) return 'private';
  if (hatModifikator(n, K.ProtectedKeyword)) return 'protected';
  return 'public';
}

const tokenText = (n, sf) => (n ? blaetter(n, sf).map((b) => text(b, sf)) : []);

/** Zerlegung einer Funktion in vergleichbare Teile (Token-Listen). */
function zerlege(d, sf, tabelle, treffer, befunde) {
  const f = d.knoten;
  const lokal = f.body ? lokaleNamen(f) : new Set();
  const tk = (n) => (n ? tokens(n, sf, tabelle, treffer, befunde, lokal) : []);
  return {
    async: hatModifikator(f, K.AsyncKeyword),
    stern: !!f.asteriskToken,
    typParams: (f.typeParameters ?? []).map((p) => tokenText(p, sf)),
    params: f.parameters.map((p) => tokenText(p, sf)),
    paramNamen: f.parameters.map((p) => text(p.name, sf)),
    rueckgabe: tokenText(f.type, sf),
    hatKoerper: !!f.body,
    koerper: f.body ? tk(f.body) : [],
    koerperKnoten: f.body,
    zugriff: zugriff(f),
    zeilen: sf.getLineAndCharacterOfPosition(f.getEnd()).line - sf.getLineAndCharacterOfPosition(f.getStart(sf)).line + 1,
    klasse: d.klasse,
    art: d.art,
  };
}

const gleich = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function ersterUnterschied(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const um = (l) => l.slice(Math.max(0, i - 6), i + 8).join(' ');
  return `an Token ${i} (alt ${a.length}, neu ${b.length}): alt "… ${um(a)} …" / neu "… ${um(b)} …"`;
}

// ── Der Beweis ──────────────────────────────────────────────────────────────────────────

/**
 * @param {object} o
 *   alt, rest: Quelltext; ziele: [{name, text}]; namen: string[]; tabelle: Map; kontext; klasse; maxZeilen
 * @returns {{befunde: string[], zeilen: string[], zaehler: object}}
 */
export function beweise(o) {
  const kontext = o.kontext ?? 'k';
  const maxZeilen = o.maxZeilen ?? 3;
  const tabelle = new Map([['this.', `${kontext}.`], ...(o.tabelle ?? [])]);
  const treffer = new Map();
  const befunde = [];
  const zeilen = [];

  const sfAlt = parse(o.alt, 'alt');
  const sfRest = parse(o.rest, 'rest');
  const ziele = o.ziele.map((z) => ({ name: z.name, sf: parse(z.text, z.name) }));
  const dAlt = deklarationen(sfAlt);
  const dRest = deklarationen(sfRest);
  const dZiel = ziele.flatMap((z) => deklarationen(z.sf).map((d) => ({ ...d, sf: z.sf, datei: z.name })));

  const listeEindeutig = new Set(o.namen);
  if (listeEindeutig.size !== o.namen.length) befunde.push('Namensliste enthält einen Namen mehrfach');
  if (o.namen.length === 0) befunde.push('Namensliste ist leer');

  let gleichZahl = 0;
  let weiterleitungen = 0;
  for (const name of listeEindeutig) {
    const fehler = [];
    const inAlt = finde(dAlt, name, o.klasse);
    const inRest = finde(dRest, name, o.klasse);
    const inZiel = finde(dZiel, name, null);

    if (inAlt.length !== 1) fehler.push(`im Alt-Stand ${inAlt.length}× gefunden (erwartet genau 1)`);
    if (inZiel.length !== 1) fehler.push(`in den Zielen ${inZiel.length}× gefunden (erwartet genau 1)${inZiel.length > 1 ? ' → doppelt' : inZiel.length === 0 ? ' → fehlt' : ''}`);
    if (inRest.length !== 1) fehler.push(`im Rest ${inRest.length}× gefunden (erwartet genau 1 Weiterleitung)`);

    if (fehler.length === 0) {
      const a = inAlt[0];
      const z = inZiel[0];
      const r = inRest[0];
      const eigen = [];
      const za = zerlege(a, sfAlt, tabelle, treffer, eigen);
      // Ziel wird nicht ersetzt: nur Token
      const zz = zerlege(z, z.sf, null, new Map(), []);
      const zr = zerlege(r, sfRest, null, new Map(), []);
      fehler.push(...eigen);

      // 1. Text gleich bis auf Ersetzung (Ziel: erster Parameter = Kontext)
      if (!zz.hatKoerper || !za.hatKoerper) fehler.push('Funktion ohne Rumpf');
      else {
        if (zz.params.length !== za.params.length + 1) fehler.push(`Ziel hat ${zz.params.length} Parameter, erwartet ${za.params.length + 1} (Kontext + ${za.params.length})`);
        else {
          if (zz.paramNamen[0] !== kontext) fehler.push(`erster Parameter des Ziels heißt "${zz.paramNamen[0]}", erwartet "${kontext}"`);
          const zuRest = zz.params.slice(1);
          za.params.forEach((p, i) => {
            if (!gleich(p, zuRest[i])) fehler.push(`Parameter ${i + 1} weicht ab: alt "${p.join(' ')}" / Ziel "${zuRest[i].join(' ')}"`);
          });
        }
        if (za.async !== zz.async) fehler.push(`async: alt ${za.async} / Ziel ${zz.async}`);
        if (za.stern !== zz.stern) fehler.push('Generator-Stern weicht ab');
        if (!gleich(za.typParams.flat(), zz.typParams.flat())) fehler.push('Typparameter weichen ab');
        if (!gleich(za.rueckgabe, zz.rueckgabe)) fehler.push(`Rückgabetyp weicht ab: alt "${za.rueckgabe.join(' ')}" / Ziel "${zz.rueckgabe.join(' ')}"`);
        if (!gleich(za.koerper, zz.koerper)) fehler.push(`Rumpf weicht ab ${ersterUnterschied(za.koerper, zz.koerper)}`);
      }

      // 3. Weiterleitung
      if (zr.zugriff !== za.zugriff && a.art === 'methode') fehler.push(`Zugriff der Weiterleitung "${zr.zugriff}", alt "${za.zugriff}"`);
      if (zr.art !== a.art) fehler.push(`Weiterleitung ist ${zr.art}, das Original war ${a.art}`);
      if (zr.params.length !== za.params.length || !za.params.every((p, i) => gleich(p, zr.params[i]))) fehler.push('Weiterleitung hat andere Parameter als das Original');
      if (!gleich(za.rueckgabe, zr.rueckgabe)) fehler.push('Weiterleitung hat anderen Rückgabetyp als das Original');
      if (!zr.hatKoerper) fehler.push('Weiterleitung ohne Rumpf');
      else {
        const stmts = zr.koerperKnoten.statements ?? [];
        if (stmts.length !== 1) fehler.push(`Weiterleitung hat ${stmts.length} Anweisungen statt 1 (Original noch da? Zusätze?)`);
        else fehler.push(...pruefeAufruf(stmts[0], name, zr.paramNamen, sfRest));
        if (zr.zeilen > maxZeilen) fehler.push(`Weiterleitung ist ${zr.zeilen} Zeilen lang (Höchstens ${maxZeilen})`);
      }
      if (fehler.length === 0) {
        gleichZahl++;
        weiterleitungen++;
      }
    }
    zeilen.push(fehler.length === 0 ? `OK      ${name}` : `FEHLER  ${name}`);
    for (const f of fehler) {
      zeilen.push(`          - ${f}`);
      befunde.push(`${name}: ${f}`);
    }
  }

  // Ersetzungseinträge ohne Treffer
  for (const k of tabelle.keys()) {
    if ((treffer.get(k) ?? 0) === 0 && k !== 'this.') befunde.push(`Ersetzungseintrag "${k}" hat keinen Treffer (Tabelle veraltet oder falsch)`);
  }
  if (o.namen.length > 0 && (treffer.get('this.') ?? 0) === 0 && o.tabelleOhneThisErlaubt !== true && [...listeEindeutig].some((n) => finde(dAlt, n, o.klasse)[0]?.art === 'methode')) {
    befunde.push('Klassenmethoden verschoben, aber `this.` kam nie vor');
  }

  // 4. Verlorenes: Namen des Alt-Stands, die weder im Rest noch verschoben sind
  const restNamen = new Set(dRest.map((d) => `${d.klasse ?? ''}.${d.name}`));
  for (const d of dAlt) {
    const schluessel = `${d.klasse ?? ''}.${d.name}`;
    if (!restNamen.has(schluessel) && !listeEindeutig.has(d.name)) befunde.push(`verloren: "${schluessel}" steht im Rest nicht mehr und wurde nicht als verschoben genannt`);
  }
  // Nicht genannte Funktionen müssen im Rest unverändert sein (sonst wurde etwas verschoben oder geändert, das nicht in der Liste steht)
  for (const d of dAlt) {
    if (listeEindeutig.has(d.name)) continue;
    const r = dRest.find((x) => x.name === d.name && x.klasse === d.klasse);
    if (!r) continue;
    const ta = zerlege(d, sfAlt, null, new Map(), []);
    const tr = zerlege(r, sfRest, null, new Map(), []);
    if (!gleich(ta.koerper, tr.koerper) || !gleich(ta.params.flat(), tr.params.flat()) || !gleich(ta.rueckgabe, tr.rueckgabe)) {
      befunde.push(`geändert, aber nicht als verschoben genannt: "${d.klasse ? `${d.klasse}.` : ''}${d.name}" (${ersterUnterschied(ta.koerper, tr.koerper)})`);
    }
  }
  // Neues im Rest, das es im Alt-Stand nicht gab
  const altNamen = new Set(dAlt.map((d) => `${d.klasse ?? ''}.${d.name}`));
  for (const d of dRest) {
    const schluessel = `${d.klasse ?? ''}.${d.name}`;
    if (!altNamen.has(schluessel)) befunde.push(`neu im Rest: "${schluessel}" gab es im Alt-Stand nicht`);
  }
  // Unbenannte Funktionen der Ziele (nur Hinweis, kein Befund)
  const hinweise = dZiel.filter((d) => !listeEindeutig.has(d.name)).map((d) => `${d.datei}:${d.name}`);

  return {
    befunde,
    zeilen,
    zaehler: { namen: o.namen.length, gleich: gleichZahl, weiterleitungen, ersetzungen: Object.fromEntries(treffer), weitereFunktionenImZiel: hinweise },
  };
}

/** Eine Anweisung, die `name(<ein Ausdruck>, …Parameter)` (oder `name(…Parameter)`) aufruft. */
function pruefeAufruf(stmt, name, paramNamen, sf) {
  const f = [];
  let ausdruck = null;
  if (ts.isExpressionStatement(stmt)) ausdruck = stmt.expression;
  else if (ts.isReturnStatement(stmt)) ausdruck = stmt.expression;
  else return [`Weiterleitung ist keine Aufruf-Anweisung (${ts.SyntaxKind[stmt.kind]})`];
  while (ausdruck && (ts.isAwaitExpression(ausdruck) || ts.isParenthesizedExpression(ausdruck))) ausdruck = ausdruck.expression;
  if (!ausdruck || !ts.isCallExpression(ausdruck)) return ['Weiterleitung ruft nichts auf'];
  const callee = ausdruck.expression;
  const nameGerufen = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
  if (nameGerufen !== name) f.push(`Weiterleitung ruft "${nameGerufen}" statt "${name}"`);
  const args = ausdruck.arguments.map((a) => a.getText(sf));
  const erwartet = paramNamen.map((n) => n.replace(/^\.\.\./, ''));
  // Original-Parameterobjekte (Destrukturierung) haben keinen einfachen Namen; dann Vergleich auslassen
  const spread = paramNamen.map((n) => n);
  const rest = args.slice(1);
  const ohne = args;
  const passt = (a) => a.length === erwartet.length && a.every((x, i) => x === erwartet[i] || x === `...${erwartet[i]}`);
  if (!passt(rest) && !passt(ohne)) f.push(`Weiterleitung reicht die Parameter nicht 1:1 weiter (Aufruf: ${args.join(', ')}; erwartet: [Kontext,] ${spread.join(', ')})`);
  else if (passt(ohne) && !passt(rest) && erwartet.length > 0 && args.length === erwartet.length) f.push('Weiterleitung übergibt keinen Kontext als ersten Argument');
  return f;
}

// ── Form 0: wörtlich verschieben (ohne Kontext) ─────────────────────────────────────────

/** Deklarationen der Modulebene, die sich wörtlich verschieben lassen: function und const/let mit EINEM Namen. */
function modulDeklarationen(sf) {
  const liste = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) liste.push({ name: st.name.text, art: 'function', st });
    else if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1 && ts.isIdentifier(st.declarationList.declarations[0].name)) {
      liste.push({ name: st.declarationList.declarations[0].name.text, art: 'variable', st });
    }
  }
  return liste;
}

/** Wird `name` im Rest wieder ausgeführt (Import, `export { name }`, `export … from`)? */
function reexportiert(sf, name) {
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause) && st.exportClause.elements.some((e) => e.name.text === name)) return true;
  }
  return false;
}

/**
 * Form 0: Deklarationen der Modulebene (Funktionen ohne `this`, Konstanten, Tabellen) wandern OHNE
 * Kontext und OHNE Weiterleitung in ein Modul (I1-Zuarbeit Befund 4: Beutetabellen und Waffenhelfer).
 * Der Text ist bis auf die Modifikatoren (`export`) gleich; im Rest gibt es die Deklaration nicht mehr; war der Name
 * im Alt-Stand exportiert, muss der Rest ihn weiter exportieren (`export { name } from …`), damit kein Importeur ändert.
 * Es gibt keine Ersetzung: ein `this` oder ein Verweis auf einen Namen, der im Alt-Stand lokal war, taucht im Ziel
 * unverändert auf; ein Ziel, das dort nicht übersetzt, meldet der TypeScript-Prüfer.
 */
export function beweiseWoertlich(o) {
  const befunde = [];
  const zeilen = [];
  const sfAlt = parse(o.alt, 'alt');
  const sfRest = parse(o.rest, 'rest');
  const ziele = o.ziele.map((z) => ({ name: z.name, sf: parse(z.text, z.name) }));
  const dAlt = modulDeklarationen(sfAlt);
  const dRest = modulDeklarationen(sfRest);
  const dZiel = ziele.flatMap((z) => modulDeklarationen(z.sf).map((d) => ({ ...d, sf: z.sf, datei: z.name })));
  const namen = [...new Set(o.namen)];
  if (namen.length !== o.namen.length) befunde.push('Namensliste enthält einen Namen mehrfach');
  if (namen.length === 0) befunde.push('Namensliste ist leer');
  const tk = (d, sf) => tokenText(d.st, sf).filter((t) => t !== 'export');
  let gleichZahl = 0;
  for (const name of namen) {
    const fehler = [];
    const a = dAlt.filter((d) => d.name === name);
    const z = dZiel.filter((d) => d.name === name);
    const r = dRest.filter((d) => d.name === name);
    if (a.length !== 1) fehler.push(`im Alt-Stand ${a.length}× gefunden (erwartet genau 1)`);
    if (z.length !== 1) fehler.push(`in den Zielen ${z.length}× gefunden (erwartet genau 1)${z.length > 1 ? ' → doppelt' : ' → fehlt'}`);
    if (r.length !== 0) fehler.push(`im Rest steht die Deklaration noch (${r.length}×): doppelt statt verschoben`);
    if (a.length === 1 && z.length === 1) {
      if (a[0].art !== z[0].art) fehler.push(`Art weicht ab: alt ${a[0].art}, Ziel ${z[0].art}`);
      const ta = tk(a[0], sfAlt);
      const tz = tk(z[0], z[0].sf);
      if (!gleich(ta, tz)) fehler.push(`Text weicht ab ${ersterUnterschied(ta, tz)}`);
      const warExportiert = hatModifikator(a[0].st, K.ExportKeyword);
      if (warExportiert && !hatModifikator(z[0].st, K.ExportKeyword)) fehler.push('war im Alt-Stand exportiert, im Ziel nicht');
      if (warExportiert && !reexportiert(sfRest, name)) fehler.push('war im Alt-Stand exportiert, der Rest führt es nicht mehr aus (`export { … } from` fehlt): Importeure würden brechen');
    }
    if (fehler.length === 0) gleichZahl++;
    zeilen.push(fehler.length === 0 ? `OK      ${name}` : `FEHLER  ${name}`);
    for (const f of fehler) {
      zeilen.push(`          - ${f}`);
      befunde.push(`${name}: ${f}`);
    }
  }
  // Nichts anderes darf sich im Rest geändert haben: jede nicht genannte Deklaration des Alt-Stands unverändert
  for (const d of dAlt) {
    if (namen.includes(d.name)) continue;
    const r = dRest.find((x) => x.name === d.name);
    if (!r) befunde.push(`verloren: "${d.name}" steht im Rest nicht mehr und wurde nicht als verschoben genannt`);
    else if (!gleich(tokenText(d.st, sfAlt), tokenText(r.st, sfRest))) befunde.push(`geändert, aber nicht als verschoben genannt: "${d.name}"`);
  }
  return { befunde, zeilen, zaehler: { namen: namen.length, gleich: gleichZahl, weiterleitungen: 0, ersetzungen: {}, weitereFunktionenImZiel: [] } };
}

// ── Aufruf von der Kommandozeile ────────────────────────────────────────────────────────

function argumente(argv) {
  const a = { ziele: [], ersetze: [], namen: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const nimm = () => {
      if (i + 1 >= argv.length) throw new Error(`${k} braucht einen Wert`);
      return argv[++i];
    };
    switch (k) {
      case '--alt': a.alt = nimm(); break;
      case '--rest': a.rest = nimm(); break;
      case '--ziel': a.ziele.push(nimm()); break;
      case '--namen': a.namen.push(...nimm().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--liste': a.liste = nimm(); break;
      case '--ersetzung': a.ersetzung = nimm(); break;
      case '--ersetze': a.ersetze.push(nimm()); break;
      case '--kontext': a.kontext = nimm(); break;
      case '--klasse': a.klasse = nimm(); break;
      case '--max-zeilen': a.maxZeilen = Number(nimm()); break;
      case '--woertlich': a.woertlich = true; break;
      case '--json': a.json = true; break;
      case '--selbsttest': a.selbsttest = true; break;
      case '-h': case '--help': a.hilfe = true; break;
      default: throw new Error(`unbekannter Schalter ${k}`);
    }
  }
  return a;
}

function tabelleAus(a) {
  const t = new Map();
  if (a.ersetzung) {
    const j = JSON.parse(readFileSync(a.ersetzung, 'utf-8'));
    for (const [alt, neu] of Object.entries(j)) t.set(alt, typeof neu === 'string' ? neu : neu.nach);
  }
  for (const e of a.ersetze) {
    const i = e.indexOf('=');
    if (i <= 0) throw new Error(`--ersetze erwartet ALT=NEU, bekam "${e}"`);
    t.set(e.slice(0, i), e.slice(i + 1));
  }
  return t;
}

function haupt(argv) {
  let a;
  try {
    a = argumente(argv);
  } catch (e) {
    console.error(String(e.message ?? e));
    return 2;
  }
  if (a.hilfe) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('*/')[0]);
    return 0;
  }
  if (a.selbsttest) return selbsttest();
  if (!a.alt || !a.rest || a.ziele.length === 0) {
    console.error('benötigt: --alt, --rest, mindestens ein --ziel und --namen/--liste (siehe --help)');
    return 2;
  }
  if (a.liste) for (const l of readFileSync(a.liste, 'utf-8').split('\n')) { const s = l.replace(/#.*$/, '').trim(); if (s) a.namen.push(s); }
  let erg;
  try {
    erg = (a.woertlich ? beweiseWoertlich : beweise)({
      alt: lies(a.alt),
      rest: lies(a.rest),
      ziele: a.ziele.map((z) => ({ name: z, text: lies(z) })),
      namen: a.namen,
      tabelle: tabelleAus(a),
      kontext: a.kontext,
      klasse: a.klasse,
      maxZeilen: a.maxZeilen,
    });
  } catch (e) {
    console.error(`Lesefehler: ${e.message ?? e}`);
    return 2;
  }
  if (a.json) console.log(JSON.stringify(erg, null, 2));
  else {
    console.log(erg.zeilen.join('\n'));
    const z = erg.zaehler;
    console.log(`\nNamen ${z.namen}, gleich ${z.gleich}, Weiterleitungen ${z.weiterleitungen}; Ersetzungen ${JSON.stringify(z.ersetzungen)}`);
    if (z.weitereFunktionenImZiel.length) console.log(`Weitere Funktionen im Ziel (nicht in der Liste, kein Befund): ${z.weitereFunktionenImZiel.join(', ')}`);
    const rest = erg.befunde.filter((b) => !erg.zeilen.some((l) => l.includes(b.replace(/^[^:]+: /, ''))));
    if (rest.length) console.log(`\nWeitere Befunde:\n${rest.map((b) => `  - ${b}`).join('\n')}`);
    console.log(erg.befunde.length === 0 ? '\nBEWEIS ERBRACHT: verschoben, nichts verändert.' : `\nBEWEIS GESCHEITERT: ${erg.befunde.length} Befund(e).`);
  }
  return erg.befunde.length === 0 ? 0 : 1;
}

// ── Selbsttest ──────────────────────────────────────────────────────────────────────────

/** Fixtures: je Form echt / gefälscht (mehrere Arten) / unvollständig. Jeder Fall nennt, ob der Beweis gelingen soll. */
function selbsttest() {
  const teile = [];
  const fall = (name, soll, o, erwarteterBefund) => teile.push({ name, soll, o, erwarteterBefund });

  // ── Form 1: Klassenmethode mit this. ──
  const altKlasse = `
class Server {
  private zaehler = 0;
  /** eine Doku */
  private handleA(p: Peer, r: number): void {
    // Kommentar
    if (this.zaehler > r) { this.log('viel'); return; }
    this.zaehler += r;
  }
  async handleB(p: Peer): Promise<number> {
    const x = await this.laden(p);
    return x + 1;
  }
  other(): number { return 1; }
}
`;
  const restKlasse = `
class Server {
  private zaehler = 0;
  private handleA(p: Peer, r: number): void { spielA.handleA(this, p, r); }
  async handleB(p: Peer): Promise<number> { return handleB(this, p); }
  other(): number { return 1; }
}
`;
  const zielKlasse = `
export function handleA(k: SpielKontext, p: Peer, r: number): void {
  if (k.zaehler > r) { k.log('viel'); return; }
  k.zaehler += r;
}
export async function handleB(k: SpielKontext, p: Peer): Promise<number> {
  const x = await k.laden(p);
  return x + 1;
}
`;
  const basisKl = { alt: altKlasse, rest: restKlasse, ziele: [{ name: 'ziel.ts', text: zielKlasse }], namen: ['handleA', 'handleB'], klasse: 'Server' };
  fall('Klassenmethode echt', true, basisKl);
  fall('Klassenmethode: Whitespace und Kommentare egal', true, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('  const x', '\n\n   // neu\n  const x') }] });
  fall('Klassenmethode gefälscht: Operator geändert', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('k.zaehler > r', 'k.zaehler >= r') }] }, 'Rumpf weicht ab');
  fall('Klassenmethode gefälscht: Anweisung vertauscht', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace("k.log('viel'); return;", "return; k.log('viel');") }] }, 'Rumpf weicht ab');
  fall('Klassenmethode gefälscht: this. nicht ersetzt', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('k.zaehler += r', 'this.zaehler += r') }] }, 'Rumpf weicht ab');
  fall('Klassenmethode gefälscht: Zeichenkette geändert', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace("'viel'", "'wenig'") }] }, 'Rumpf weicht ab');
  fall('Klassenmethode gefälscht: Await entfernt', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('await k.laden', 'k.laden') }] }, 'Rumpf weicht ab');
  fall('Klassenmethode gefälscht: Parametertyp', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('r: number', 'r: string') }] }, 'Parameter 2 weicht ab');
  fall('Klassenmethode gefälscht: Kontextparameter fehlt', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('handleA(k: SpielKontext, p: Peer', 'handleA(p: Peer') }] }, 'Parameter');
  fall('Klassenmethode unvollständig: Ziel fehlt', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace(/export async function handleB[\s\S]*$/, '') }] }, 'fehlt');
  fall('Klassenmethode doppelt: in zwei Zielen', false, { ...basisKl, ziele: [{ name: 'ziel.ts', text: zielKlasse }, { name: 'zwei.ts', text: 'export function handleA(k: SpielKontext, p: Peer, r: number): void {}' }] }, 'doppelt');
  fall('Klassenmethode unvollständig: Original bleibt im Rest', false, { ...basisKl, rest: restKlasse.replace('spielA.handleA(this, p, r);', 'if (this.zaehler > r) { this.log(\'viel\'); return; } this.zaehler += r;') }, 'Anweisungen');
  fall('Klassenmethode unvollständig: Weiterleitung fehlt', false, { ...basisKl, rest: restKlasse.replace(/  private handleA.*\n/, '') }, 'im Rest 0');
  fall('Klassenmethode: Weiterleitung mit anderer Signatur', false, { ...basisKl, rest: restKlasse.replace('handleA(p: Peer, r: number): void', 'handleA(p: Peer): void') }, 'Weiterleitung');
  fall('Klassenmethode: Weiterleitung gibt Parameter nicht weiter', false, { ...basisKl, rest: restKlasse.replace('spielA.handleA(this, p, r)', 'spielA.handleA(this, r, p)') }, 'nicht 1:1');
  fall('Klassenmethode: Weiterleitung ruft falschen Namen', false, { ...basisKl, rest: restKlasse.replace('spielA.handleA(this', 'spielA.handleX(this') }, 'statt');
  fall('Klassenmethode: Weiterleitung zu lang', false, { ...basisKl, rest: restKlasse.replace('{ spielA.handleA(this, p, r); }', '{\n // a\n // b\n\n spielA.handleA(this, p, r);\n }') }, 'Zeilen lang');
  fall('Klassenmethode verloren: Name nicht genannt', false, { ...basisKl, namen: ['handleA'], rest: restKlasse, ziele: [{ name: 'ziel.ts', text: zielKlasse }] }, 'geändert, aber nicht als verschoben genannt');
  fall('Klassenmethode: Zugriff der Weiterleitung geändert', false, { ...basisKl, rest: restKlasse.replace('private handleA', 'handleA') }, 'Zugriff');
  fall('Klassenmethode: nacktes this', false, { alt: altKlasse.replace('this.zaehler += r;', 'this.zaehler += r; reg(this);'), rest: restKlasse, ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('k.zaehler += r;', 'k.zaehler += r; reg(k);') }], namen: ['handleA'], klasse: 'Server' }, 'nacktes this');
  fall('Klassenmethode: this. in verschachtelter function ist Befund', false, {
    alt: altKlasse.replace('this.zaehler += r;', 'this.zaehler += r; arr.map(function (x) { return this.zaehler + x; });'),
    rest: restKlasse,
    ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('k.zaehler += r;', 'k.zaehler += r; arr.map(function (x) { return k.zaehler + x; });') }],
    namen: ['handleA', 'handleB'],
    klasse: 'Server',
  }, 'verschachtelten Funktion');
  fall('Klassenmethode: this. in Pfeilfunktion ist ok', true, {
    alt: altKlasse.replace('this.zaehler += r;', 'this.zaehler += r; arr.map((x) => this.zaehler + x);'),
    rest: restKlasse,
    ziele: [{ name: 'ziel.ts', text: zielKlasse.replace('k.zaehler += r;', 'k.zaehler += r; arr.map((x) => k.zaehler + x);') }],
    namen: ['handleA', 'handleB'],
    klasse: 'Server',
  });
  fall('Klassenmethode: doppelter Name in Liste', false, { ...basisKl, namen: ['handleA', 'handleA', 'handleB'] }, 'mehrfach');

  // ── Form 2: freie Funktion, Form a) ──
  const altFrei = `
const ADMINS_DATEI = 'admins.json';
function ymlLesen(): string { return ''; }
function adminsLaden(): string[] {
  const roh = readFileSync(ADMINS_DATEI, 'utf-8');
  const cfg = ymlLesen();
  return roh.split(cfg).map((s) => s.trim()).filter(Boolean);
}
function adminsSchreiben(liste: string[]): void {
  const meta = { ADMINS_DATEI: 1 };
  writeFileSync(ADMINS_DATEI, liste.join('\\n') + meta.ADMINS_DATEI);
}
`;
  const restFrei = `
const ADMINS_DATEI = 'admins.json';
function ymlLesen(): string { return ''; }
function adminsLaden(): string[] { return laden(umgebung()); }
function adminsSchreiben(liste: string[]): void { return schreiben(umgebung(), liste); }
`;
  const zielFrei = `
export function laden(k: Umgebung): string[] {
  const roh = readFileSync(k.ADMINS_DATEI, 'utf-8');
  const cfg = k.ymlLesen();
  return roh.split(cfg).map((s) => s.trim()).filter(Boolean);
}
export function schreiben(k: Umgebung, liste: string[]): void {
  const meta = { ADMINS_DATEI: 1 };
  writeFileSync(k.ADMINS_DATEI, liste.join('\\n') + meta.ADMINS_DATEI);
}
`;
  // Namen im Ziel weichen von den alten Namen ab? Nein: gleicher Name ist Pflicht (Plan 5.1). Fixture benennt gleich.
  const zielFreiGleich = zielFrei.replace('function laden', 'function adminsLaden').replace('function schreiben', 'function adminsSchreiben');
  const restFreiGleich = `
const ADMINS_DATEI = 'admins.json';
function ymlLesen(): string { return ''; }
function adminsLaden(): string[] { return laden.adminsLaden(umgebung()); }
function adminsSchreiben(liste: string[]): void { return laden.adminsSchreiben(umgebung(), liste); }
`;
  const tab = new Map([['ADMINS_DATEI', 'k.ADMINS_DATEI'], ['ymlLesen', 'k.ymlLesen']]);
  const basisFr = { alt: altFrei, rest: restFreiGleich, ziele: [{ name: 'admin.ts', text: zielFreiGleich }], namen: ['adminsLaden', 'adminsSchreiben'], tabelle: tab, tabelleOhneThisErlaubt: true };
  fall('Freie Funktion (Form a) echt', true, basisFr);
  fall('Freie Funktion gefälscht: Feld nicht ersetzt', false, { ...basisFr, ziele: [{ name: 'admin.ts', text: zielFreiGleich.replace('readFileSync(k.ADMINS_DATEI', 'readFileSync(ADMINS_DATEI') }] }, 'Rumpf weicht ab');
  fall('Freie Funktion gefälscht: falsches Feld', false, { ...basisFr, ziele: [{ name: 'admin.ts', text: zielFreiGleich.replace('k.ymlLesen()', 'k.ymlSchreiben()') }] }, 'Rumpf weicht ab');
  fall('Freie Funktion gefälscht: Zusatzanweisung', false, { ...basisFr, ziele: [{ name: 'admin.ts', text: zielFreiGleich.replace("const cfg = k.ymlLesen();", "const cfg = k.ymlLesen(); console.log(cfg);") }] }, 'Rumpf weicht ab');
  fall('Freie Funktion unvollständig: zweite fehlt im Ziel', false, { ...basisFr, ziele: [{ name: 'admin.ts', text: zielFreiGleich.replace(/export function adminsSchreiben[\s\S]*$/, '') }] }, 'fehlt');
  fall('Freie Funktion: Original bleibt im Rest (doppelt)', false, { ...basisFr, rest: restFreiGleich.replace('{ return laden.adminsLaden(umgebung()); }', altFrei.match(/function adminsLaden\(\): string\[\] (\{[\s\S]*?\n\})/)[1]) }, 'Anweisungen');
  fall('Freie Funktion: Signatur der Weiterleitung geändert (Kontext als Parameter statt behalten)', false, { ...basisFr, rest: restFreiGleich.replace('function adminsSchreiben(liste: string[])', 'function adminsSchreiben(k: Umgebung, liste: string[])') }, 'Parameter');
  fall('Freie Funktion: Tabelle ohne Treffer', false, { ...basisFr, tabelle: new Map([...tab, ['GIBTS_NICHT', 'k.GIBTS_NICHT']]) }, 'keinen Treffer');
  fall('Freie Funktion: Objektschlüssel/Property werden nicht ersetzt (echt)', true, basisFr); // meta = { ADMINS_DATEI: 1 } und meta.ADMINS_DATEI bleiben
  fall('Freie Funktion: Kurzform { ADMINS_DATEI } ist Befund', false, {
    ...basisFr,
    alt: altFrei.replace('const meta = { ADMINS_DATEI: 1 };', 'const meta = { ADMINS_DATEI };'),
    ziele: [{ name: 'admin.ts', text: zielFreiGleich.replace('const meta = { ADMINS_DATEI: 1 };', 'const meta = { ADMINS_DATEI };') }],
  }, 'Kurzform');
  fall('Freie Funktion: Schatten (lokal gleichnamig) ist Befund', false, {
    ...basisFr,
    alt: altFrei.replace('const meta = { ADMINS_DATEI: 1 };', 'const ADMINS_DATEI = 3; const meta = { x: ADMINS_DATEI };').replace('meta.ADMINS_DATEI', 'meta.x'),
    ziele: [{ name: 'admin.ts', text: zielFreiGleich.replace('const meta = { ADMINS_DATEI: 1 };', 'const ADMINS_DATEI = 3; const meta = { x: k.ADMINS_DATEI };').replace('meta.ADMINS_DATEI', 'meta.x') }],
  }, 'Schatten');

  // ── Form 0: wörtlich verschieben, ohne Kontext ──
  const altW = `
export function gepruefteWaffe(inventar: Inventory, waffe: string): string {
  return inventar.has(waffe) ? waffe : '';
}
export const KREATUR_DROPS: Record<string, number> = { wolf: 2, kuh: 1 };
const TRUHEN = [1, 2, 3];
export function wuerfleTruhe(i: number): number { return TRUHEN[i % 3]!; }
class Wov { go(): number { return 1; } }
`;
  const restW = `
export { gepruefteWaffe, KREATUR_DROPS } from './spiel/Beute.js';
import { TRUHEN, wuerfleTruhe } from './spiel/Beute.js';
export { wuerfleTruhe };
class Wov { go(): number { return 1; } }
`;
  const zielW = `
export function gepruefteWaffe(inventar: Inventory, waffe: string): string {
  return inventar.has(waffe) ? waffe : '';
}
export const KREATUR_DROPS: Record<string, number> = { wolf: 2, kuh: 1 };
export const TRUHEN = [1, 2, 3];
export function wuerfleTruhe(i: number): number { return TRUHEN[i % 3]!; }
`;
  const basisW = { alt: altW, rest: restW, ziele: [{ name: 'Beute.ts', text: zielW }], namen: ['gepruefteWaffe', 'KREATUR_DROPS', 'TRUHEN', 'wuerfleTruhe'], woertlich: true };
  fall('Form 0 echt (Funktionen, Tabelle, nicht exportierte Konstante)', true, basisW);
  fall('Form 0 gefälscht: Wert in der Tabelle', false, { ...basisW, ziele: [{ name: 'Beute.ts', text: zielW.replace('wolf: 2', 'wolf: 3') }] }, 'Text weicht ab');
  fall('Form 0 gefälscht: Bedingung in der Funktion', false, { ...basisW, ziele: [{ name: 'Beute.ts', text: zielW.replace('inventar.has(waffe) ? waffe', 'inventar.has(waffe) ? waffe + 1') }] }, 'Text weicht ab');
  fall('Form 0 unvollständig: Deklaration bleibt im Rest (doppelt)', false, { ...basisW, rest: restW + "export const KREATUR_DROPS: Record<string, number> = { wolf: 2, kuh: 1 };\n" }, 'Deklaration noch');
  fall('Form 0 unvollständig: Reexport fehlt', false, { ...basisW, rest: restW.replace("export { gepruefteWaffe, KREATUR_DROPS } from './spiel/Beute.js';", "export { gepruefteWaffe } from './spiel/Beute.js';") }, 'Importeure würden brechen');
  fall('Form 0 unvollständig: Ziel fehlt', false, { ...basisW, ziele: [{ name: 'Beute.ts', text: zielW.replace(/export const KREATUR_DROPS[^\n]*\n/, '') }] }, 'fehlt');
  fall('Form 0: Ziel exportiert nicht', false, { ...basisW, ziele: [{ name: 'Beute.ts', text: zielW.replace('export const KREATUR_DROPS', 'const KREATUR_DROPS') }] }, 'im Ziel nicht');
  fall('Form 0 verloren: nicht genannte Deklaration verschwindet', false, { ...basisW, namen: ['gepruefteWaffe', 'KREATUR_DROPS', 'TRUHEN'] }, 'wuerfleTruhe');
  fall('Form 0: nicht genannte Klasse bleibt unverändert (echt)', true, basisW);

  // ── Lauf ──
  let rot = 0;
  for (const t of teile) {
    let erg;
    try {
      erg = (t.o.woertlich ? beweiseWoertlich : beweise)(t.o);
    } catch (e) {
      erg = { befunde: [`Ausnahme: ${e.message}`] };
    }
    const gelungen = erg.befunde.length === 0;
    let ok = gelungen === t.soll;
    if (ok && !t.soll && t.erwarteterBefund && !erg.befunde.some((b) => b.includes(t.erwarteterBefund))) ok = false;
    console.log(`${ok ? 'ok  ' : 'ROT '} ${t.name}${!ok ? `\n      Befunde: ${JSON.stringify(erg.befunde)}` : ''}`);
    if (!ok) rot++;
  }
  // Ein Befund je Fall genügt nicht als Beweis; zusätzlich: die CLI selbst an echten Dateien.
  const tmp = mkdtempSync(join(tmpdir(), 'i1-verschiebung-'));
  try {
    writeFileSync(join(tmp, 'alt.ts'), altKlasse);
    writeFileSync(join(tmp, 'rest.ts'), restKlasse);
    writeFileSync(join(tmp, 'ziel.ts'), zielKlasse);
    const skript = fileURLToPath(import.meta.url);
    const lauf = (extra) => spawnSync(process.execPath, [skript, '--alt', join(tmp, 'alt.ts'), '--rest', join(tmp, 'rest.ts'), '--ziel', join(tmp, 'ziel.ts'), ...extra], { encoding: 'utf-8' });
    const gut = lauf(['--namen', 'handleA,handleB', '--klasse', 'Server']);
    const cliOk = gut.status === 0 && /BEWEIS ERBRACHT/.test(gut.stdout);
    console.log(`${cliOk ? 'ok  ' : 'ROT '} CLI: echter Lauf endet mit 0`);
    if (!cliOk) { rot++; console.log(gut.stdout + gut.stderr); }
    writeFileSync(join(tmp, 'ziel.ts'), zielKlasse.replace('k.zaehler > r', 'k.zaehler >= r'));
    const schlecht = lauf(['--namen', 'handleA,handleB', '--klasse', 'Server']);
    const cliRot = schlecht.status === 1 && /BEWEIS GESCHEITERT/.test(schlecht.stdout);
    console.log(`${cliRot ? 'ok  ' : 'ROT '} CLI: gefälschter Lauf endet mit 1`);
    if (!cliRot) { rot++; console.log(schlecht.stdout + schlecht.stderr); }
    const falsch = spawnSync(process.execPath, [skript, '--alt'], { encoding: 'utf-8' });
    const cliArg = falsch.status === 2;
    console.log(`${cliArg ? 'ok  ' : 'ROT '} CLI: falscher Aufruf endet mit 2`);
    if (!cliArg) rot++;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(rot === 0 ? `\nSelbsttest grün (${teile.length + 3} Fälle).` : `\nSelbsttest ROT: ${rot} Fall/Fälle.`);
  return rot === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(haupt(process.argv.slice(2)));
