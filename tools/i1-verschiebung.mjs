#!/usr/bin/env node
/**
 * !! EINGESCHRÄNKT: Exit 0 ist noch kein Verschiebebeweis. Bekannte Lücken: siehe `Berichte/2026-09-30 I1 Schritt 0 N1 — Nachangriff.md` (H1–H4, M1–M4). Umbau folgt als eigene Karte.
 * !! RESTRICTED: exit 0 is not yet a proof of a mechanical move; known gaps are listed in the follow-up attack report
 * !! (H1-H4, M1-M4). The rebuild on the real syntax tree follows as its own card. Until then also check by hand.
 *
 * i1-verschiebung.mjs — check for a purely mechanical move (I1 step 0 + N1, plan section 5.1).
 * Verschiebebeweis: belegt, dass ein Schnitt nur verschoben und sonst NICHTS verändert hat.
 *
 * Leitsatz (N1): Die Prüfung soll zeigen „außer den erlaubten Ersetzungen ist nichts anders“. Verglichen wird deshalb
 * der GANZE Rest der Quelldatei und die GANZE Zieldatei, nicht nur Funktionsrümpfe. Was das Werkzeug nicht
 * beweisen kann, meldet es ROT; der Nutzer gibt es mit `--freigabe SCHLÜSSEL` ausdrücklich frei, und die
 * Freigabe erscheint in der Ausgabe (FREIGEGEBEN) und gehört in den PR-Text. Lieber ein falsches Rot als ein
 * falsches Grün.
 *
 * ── Anleitung / How to use ─────────────────────────────────────────────────────────────
 *
 *   node tools/i1-verschiebung.mjs \
 *        --alt   git:origin/main:server/src/WovServer.ts     # Stand VOR dem Schritt (Datei oder git:<ref>:<pfad>)
 *        --rest  server/src/WovServer.ts                      # dieselbe Datei NACH dem Schritt (mit Weiterleitungen)
 *        --ziel  server/src/spiel/Kampf.ts [--ziel …]         # Modul(e), in die verschoben wurde (ganze Datei wird geprüft)
 *        --namen handleAttack,handleParry                     # Methoden / freie Funktionen, die Weiterleitungen behalten
 *        [--woertlich-namen A,B]                              # Deklarationen der Modulebene, die OHNE Kontext und OHNE
 *                                                             # Weiterleitung wörtlich wandern (Tabellen, Konstanten, Funktionen
 *                                                             # ohne this, interface/type); der Rest führt sie per `export { … } from` weiter
 *        [--woertlich]                                        # alle --namen sind wörtlich (Kurzform, Form 0)
 *        [--liste namen.txt]                                  # oder: ein Name je Zeile (# = Kommentar)
 *        [--ersetzung tabelle.json] [--ersetze ALT=NEU …]     # zusätzliche Ersetzungen, s. u.
 *        [--kontext k]                                        # Name des Kontext-Parameters (Vorgabe k)
 *        [--klasse WovServer]                                 # Methoden nur aus dieser Klasse (sonst jede)
 *        [--max-zeilen 3]                                     # Zeilen des Rumpfs einer Weiterleitung (Vorgabe 3)
 *        [--alias ALT=NEU …]                                  # erlaubt `export { ALT as NEU } from` (Form 0)
 *        [--freigabe SCHLÜSSEL …]                             # Freigabe eines nicht beweisbaren Punkts, s. u.
 *        [--json]                                             # Ausgabe als JSON
 *   Der Selbsttest mit den Fixtures (echt, gefälscht, unvollständig je Form) ist `tools/test/i1-verschiebung.ts`.
 *
 * Exit 0 = keine Abweichung gefunden (EINGESCHRÄNKT, kein Beweis); 1 = mindestens ein Befund; 2 = Aufruf falsch.
 *
 * Was geprüft werden soll (Absicht; was davon noch nicht hält, steht im Satz oben und im Nachangriff):
 *   H1 Weiterleitung. Nur in der exakten Form `return <modul>.<gleicher Name>(this, <Parameter unverändert>)`
 *      (freie Funktionen: `(<umgebung>(), …)`), mit `return` auch bei void; `<modul>` ist ein Import auf genau die
 *      genannte Zieldatei (oder `import { name }` aus ihr). Kontextargument genau `this`, kein `?.`, keine Zusatzanweisung.
 *      Modifikatoren (`static`, `async`, Sichtbarkeit), Typparameter, Parameter samt Vorgabewerten und Rückgabetyp
 *      gleich wie im Original, Rumpf höchstens --max-zeilen Zeilen.
 *   H2 Rest der Quelldatei. Nach dem Herausnehmen der verschobenen Deklarationen (Alt) bzw. der Weiterleitungen (Rest)
 *      sind die Token der GANZEN Datei gleich: Konstruktor, Felder, Accessoren, Modulkonstanten, Anweisungen der
 *      Modulebene, Modifikatoren nicht genannter Methoden. Ausnahme sind Importzeilen: neue nur auf die Zieldateien,
 *      entfernte nur, wenn der Name im Rest nicht mehr vorkommt. Kommentare mit Wirkung (`@ts-expect-error`,
 *      `eslint-disable`, `prettier-ignore` …) bleiben erhalten (Rest und je verschobene Deklaration).
 *   H3 Form 0. Text bis auf `export` gleich, Deklaration im Rest weg, Rest unverändert (H2), Reexport nur als
 *      `export { name } from '<Ziel>'` ohne Alias (Alias nur mit --alias), nur für Namen, die schon exportiert waren.
 *   H4 Ziel. Die ganze Zieldatei: außer Importen, Typdeklarationen (interface/type), den verschobenen Deklarationen und
 *      Kommentaren steht dort nichts (keine Modulebene mit Nebenwirkung, keine zweite Funktion). Jeder Import im Ziel
 *      hat ein Gegenstück im Alt-Stand (gleiche aufgelöste Datei, gleicher Name) oder ist `import type` aus Kontext.
 *      Jeder freie Name eines verschobenen Rumpfs zeigt im Ziel auf DIESELBE Deklaration wie in der Quelle (derselbe
 *      Import aus derselben Datei); ein Name, der im Alt-Stand eine Deklaration der Quelldatei war, muss im selben
 *      Lauf wörtlich mitwandern (--woertlich-namen) oder über die Tabelle (`k.NAME`) laufen, sonst rot.
 *   H5 Kontextname. Kommt `k` im Rumpf des Originals schon vor (lokal, Parameter, frei) → rot; `--kontext` anders wählen.
 *   M1 `arguments` im Rumpf → rot. Vorgabewerte mit `this.` werden mit ersetzt und verglichen.
 *   M2 Ersetzungstabelle: nur `this.` → `<k>.` und `NAME` → `<k>.NAME` (derselbe Name). Alles andere rot, außer
 *      `--freigabe tabelle:SCHLÜSSEL=WERT`. Freie Funktionen: das Kontextargument der Weiterleitung ist `<fabrik>()`;
 *      sein Inhalt ist nicht beweisbar, also `--freigabe umgebung:<fabrik>` (steht dann in der Ausgabe).
 *   N1 Kommentare mit Wirkung (s. H2). N2 Kontext mit `any`/`unknown` oder ohne Typ → rot.
 *   Nichts doppelt, nichts fehlt: jeder Name genau 1× im Alt-Stand, 1× im Ziel, 1× (als Weiterleitung) im Rest; jeder
 *   Ersetzungseintrag trifft mindestens einmal; `this.` in verschachtelter function/Klasse, nacktes `this`, Kurzform
 *   `{ NAME }`, Schatten einer ersetzten Tabelle sind Befunde.
 *
 * Freigabe-Schlüssel: `umgebung:<fabrik>`, `tabelle:<schlüssel>=<wert>`, `import:<aufgelöster Pfad>`,
 * `bindung:<name>`. Jede Freigabe erscheint als Zeile „FREIGEGEBEN“ in der Ausgabe.
 *
 * Grenzen (dokumentiert, nicht gebaut):
 *   - Formen b) (veränderliche Modulvariable → Lesefunktion und Setzer) und c) (Anweisungen der Modulebene → Rumpf
 *     einer Funktion) fehlen. Statische Mitglieder `Klasse.X` im Rumpf laufen nur über die Tabelle oder rot.
 *   - N3: eine einzeln verschobene Methode ohne `this.` meldet „`this.` kam nie vor“ (falsch rot); im Paket mit anderen
 *     Methoden ist das unkritisch, sonst `--freigabe kein-this`.
 *   - N5: Das Werkzeug vergleicht Token, nicht Formatierung, aber Prettier ändert Anführungszeichen, Kommas und
 *     Klammern. Verschobenen Text NICHT formatieren.
 *   - N7: Zeichenketten und Vorlagen werden als ganze Token verglichen; ein Umbruch in einem Vorlagentext zählt.
 *   - Typdeklarationen im Ziel (interface/type) sind unbeweisbar, aber ohne Laufzeitwirkung; sie stehen als Hinweis.
 *   - Überladungssignaturen (Methoden ohne Rumpf) werden nicht unterstützt (0 Fälle in den fünf Zieldateien).
 *   - Der Beweis prüft Text und Bindung, nicht das Verhalten: `k` MUSS der Server selbst sein (`this`), Modulcode ruft
 *     andere verschobene Methoden über `k.` (Attrappen auf der Instanz, Fund 2 in Schritt 0).
 *
 * Ersetzungstabelle: Schlüssel = alter Name, Wert = neuer Ausdruck (JSON-Objekt oder --ersetze).
 *   "this."        → "k."              Vorgabe. `this.x` wird `k.x`. Ein `this` OHNE folgenden Punkt ist ein Befund.
 *   "ADMINS_DATEI" → "k.ADMINS_DATEI"  Form a): ein freier Name der Modulebene wird Feld des Kontexts (nur mit demselben Namen).
 *
 * Funktioniert für Klassenmethoden und freie Funktionen in jeder Datei (WovServer.ts, EntityManager.ts,
 * GegenstandsKatalog.ts, editorMain.ts, admin/src/main.ts): weder Dateiname noch Klasse sind festverdrahtet.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { posix, resolve as pfadAufloesen } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const K = ts.SyntaxKind;
export const EINGESCHRAENKT = 'EINGESCHRÄNKT: Exit 0 ist noch kein Verschiebebeweis. Bekannte Lücken: siehe `Berichte/2026-09-30 I1 Schritt 0 N1 — Nachangriff.md` (H1–H4, M1–M4). Umbau folgt als eigene Karte.';

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

/** Relativen Importpfad gegen die Datei auflösen; Endung `.js/.ts/.mjs/.mts` fällt weg. Pakete bleiben wie sie sind. */
function loese(spec, vonDatei) {
  if (!spec.startsWith('.')) return spec;
  const dir = posix.dirname(vonDatei.replaceAll('\\', '/'));
  return posix.normalize(posix.join(dir, spec)).replace(/\.(m?[jt]s|cjs)$/, '');
}
const dateiKern = (name) => posix.normalize(name.replaceAll('\\', '/')).replace(/\.(m?[jt]s|cjs)$/, '');

// ── Blätter als normalisierte Tokenfolge ────────────────────────────────────────────────

/**
 * Alle Blatt-Token eines Knotens (ohne Trivia, ohne JSDoc-Knoten). `ersetze` (Map Knoten → Text) ersetzt einen ganzen
 * Teilbaum durch einen Platzhalter-Token (Text '' = weglassen).
 */
function blaetter(knoten, sf, ersetze = null, aus = []) {
  if (ersetze?.has(knoten)) {
    const t = ersetze.get(knoten);
    if (t !== '') aus.push({ text: t, knoten });
    return aus;
  }
  if (knoten.kind >= K.FirstJSDocNode && knoten.kind <= K.LastJSDocNode) return aus;
  const kinder = knoten.getChildren(sf);
  if (kinder.length === 0) {
    aus.push({ text: knoten.getText(sf), knoten });
    return aus;
  }
  for (const k of kinder) blaetter(k, sf, ersetze, aus);
  return aus;
}
const tokenText = (n, sf) => (n ? blaetter(n, sf).map((b) => b.text) : []);

/** Bezeichner-Rolle: true = Verweis, 'kurzform' = `{ x }`, 'deklaration' = Name einer Deklaration, false = Property/Schlüssel/Label. */
function istVerweis(id) {
  const p = id.parent;
  if (!p) return true;
  if ((ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) && (p.name === id || p.right === id)) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if (ts.isShorthandPropertyAssignment(p)) return 'kurzform';
  if ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === id) return false;
  if (ts.isPropertySignature(p) && p.name === id) return false;
  if (ts.isMethodSignature(p) && p.name === id) return false;
  if (ts.isEnumMember(p) && p.name === id) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isNamespaceImport(p) || ts.isImportClause(p)) return false;
  if (
    (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) ||
      ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) ||
      ts.isEnumDeclaration(p) || ts.isTypeParameterDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) &&
    p.name === id
  ) return 'deklaration';
  return true;
}

/** Namen, die im Knoten irgendwo lokal deklariert werden (Parameter, var/let/const, Funktionen, Klassen, enum, Typparameter, Bindungen). */
function lokaleNamen(knoten) {
  const namen = new Set();
  const nimm = (n) => {
    if (!n) return;
    if (ts.isIdentifier(n)) namen.add(n.text);
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const e of n.elements) if (ts.isBindingElement(e)) nimm(e.name);
  };
  const geh = (n) => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) nimm(n.name);
    else if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isEnumDeclaration(n)) && n.name) namen.add(n.name.text);
    else if (ts.isTypeParameterDeclaration(n)) namen.add(n.name.text);
    else if (ts.isCatchClause(n) && n.variableDeclaration) nimm(n.variableDeclaration.name);
    ts.forEachChild(n, geh);
  };
  geh(knoten);
  return namen;
}

/** Namen einer Bindung (Bezeichner oder Muster). */
function musterNamen(n, aus = new Set()) {
  if (!n) return aus;
  if (ts.isIdentifier(n)) aus.add(n.text);
  else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const e of n.elements) if (ts.isBindingElement(e)) musterNamen(e.name, aus);
  return aus;
}
const istFunktion = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);

/** Deklariert ein `var` oder eine function-Deklaration im Rumpf (ohne in verschachtelte Funktionen zu gehen) den Namen? */
function hochgezogen(knoten, name) {
  let gefunden = false;
  const geh = (n) => {
    if (gefunden) return;
    if (n !== knoten && istFunktion(n)) {
      if (ts.isFunctionDeclaration(n) && n.name?.text === name) gefunden = true;
      return;
    }
    if (ts.isVariableDeclarationList(n) && (n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) for (const d of n.declarations) if (musterNamen(d.name).has(name)) gefunden = true;
    ts.forEachChild(n, geh);
  };
  geh(knoten);
  return gefunden;
}

/** Deklariert der Knoten `a` (als Geltungsbereich) den Namen `name`? */
function deklariertIn(a, name) {
  if (istFunktion(a)) {
    if ((a.typeParameters ?? []).some((t) => t.name.text === name)) return true;
    if (a.parameters.some((p) => musterNamen(p.name).has(name))) return true;
    if (ts.isFunctionExpression(a) && a.name?.text === name) return true;
    return !!a.body && hochgezogen(a.body, name);
  }
  if (ts.isBlock(a) || ts.isCaseBlock(a) || ts.isModuleBlock(a) || ts.isSourceFile(a)) {
    const stmts = ts.isCaseBlock(a) ? a.clauses.flatMap((c) => [...c.statements]) : [...a.statements];
    for (const st of stmts) {
      if (ts.isVariableStatement(st) && (st.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0 && st.declarationList.declarations.some((d) => musterNamen(d.name).has(name))) return true;
      if ((ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isFunctionDeclaration(st)) && st.name?.text === name) return true;
    }
    return false;
  }
  if (ts.isForStatement(a) || ts.isForInStatement(a) || ts.isForOfStatement(a)) {
    const i = a.initializer;
    return !!i && ts.isVariableDeclarationList(i) && i.declarations.some((d) => musterNamen(d.name).has(name));
  }
  if (ts.isCatchClause(a)) return !!a.variableDeclaration && musterNamen(a.variableDeclaration.name).has(name);
  if (ts.isClassExpression(a) || ts.isClassDeclaration(a)) return (a.typeParameters ?? []).some((t) => t.name.text === name) || (ts.isClassExpression(a) && a.name?.text === name);
  return false;
}

/** Bindet der Bezeichner `id` an eine Deklaration INNERHALB von `wurzel` (Parameter, lokale Variable, …)? */
function lokalGebunden(id, wurzel) {
  for (let a = id.parent; a; a = a.parent) {
    if (deklariertIn(a, id.text)) return true;
    if (a === wurzel) return false;
  }
  return false;
}

/** Alle Bezeichner eines Knotens mit ihrer Rolle. */
function bezeichner(knoten) {
  const aus = [];
  const geh = (n) => {
    if (ts.isIdentifier(n)) aus.push({ id: n, rolle: istVerweis(n) });
    ts.forEachChild(n, geh);
  };
  geh(knoten);
  return aus;
}

/**
 * Tokenfolge eines Knotens mit angewandter Ersetzung. `tabelle` = Map alt → neuer Ausdruck (Text) oder null.
 */
function tokens(knoten, sf, tabelle, treffer, befunde, lokal) {
  const aus = [];
  const bl = blaetter(knoten, sf);
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i].knoten;
    const t = bl[i].text;
    if (b.kind === K.ThisKeyword && tabelle) {
      const naechster = bl[i + 1] && bl[i + 1].text;
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
        aus.push(...tokenisiere(ersatz.replace(/\.$/, '')));
        continue;
      }
      if (b.parent && b.parent.kind !== K.ThisType) befunde.push(`nacktes this: "${zeile(b, sf)}" (keine mechanische Ersetzung)`);
      aus.push(t);
      continue;
    }
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

function tokenisiere(ausdruck) {
  const sf = parse(`(${ausdruck});`, 'ersatz.ts');
  return blaetter(sf, sf).map((b) => b.text).filter((t) => t !== '').slice(1, -2);
}

function zeile(knoten, sf) {
  const { line } = sf.getLineAndCharacterOfPosition(knoten.getStart(sf));
  return `${sf.fileName}:${line + 1}`;
}

const gleich = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function ersterUnterschied(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const um = (l) => l.slice(Math.max(0, i - 6), i + 8).join(' ');
  return `an Token ${i} (alt ${a.length}, neu ${b.length}): alt "… ${um(a)} …" / neu "… ${um(b)} …"`;
}

// ── Deklarationen ───────────────────────────────────────────────────────────────────────

/**
 * Funktionen einer Datei: Klassenmethoden ({ art:'methode', klasse, name }) und freie Funktionen der Modulebene
 * (`function name`). Pfeilfunktionen in `const` sind nicht unterstützt und werden als `pfeil` gemeldet.
 */
function deklarationen(sf) {
  const liste = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) liste.push({ art: 'frei', klasse: null, name: s.name.text, knoten: s });
    else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) liste.push({ art: 'pfeil', klasse: null, name: d.name.text, knoten: d.initializer });
      }
    } else if (ts.isClassDeclaration(s)) {
      const kn = s.name ? s.name.text : '(anonym)';
      for (const m of s.members) {
        if (ts.isMethodDeclaration(m) && m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name))) {
          liste.push({ art: 'methode', klasse: kn, name: m.name.text, knoten: m });
        }
      }
    }
  }
  return liste;
}

/** Deklarationen der Modulebene, die sich wörtlich verschieben lassen: function, const/let/var mit EINEM Namen, interface und type (ohne Laufzeitwirkung). */
function modulDeklarationen(sf) {
  const liste = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) liste.push({ name: st.name.text, art: 'function', st });
    else if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1 && ts.isIdentifier(st.declarationList.declarations[0].name)) {
      liste.push({ name: st.declarationList.declarations[0].name.text, art: 'variable', st });
    } else if (ts.isInterfaceDeclaration(st)) liste.push({ name: st.name.text, art: 'interface', st });
    else if (ts.isTypeAliasDeclaration(st)) liste.push({ name: st.name.text, art: 'typ', st });
  }
  return liste;
}

/** Alle Namen, die auf der Modulebene einer Datei deklariert sind (für die Bindungsprüfung). */
function modulNamen(sf) {
  const m = new Map(); // name → art
  for (const s of sf.statements) {
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isModuleDeclaration(s)) && s.name) m.set(s.name.text, ts.SyntaxKind[s.kind]);
    else if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) for (const n of lokaleNamen(d)) m.set(n, 'variable');
  }
  return m;
}

function hatModifikator(n, art) {
  return !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === art));
}
const modifikatoren = (n) => (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []).map((m) => m.getText()).sort() : []);

// ── Importe ─────────────────────────────────────────────────────────────────────────────

/** Jede Bindung eines Imports als eigener Eintrag { schluessel, lokal, art, imp, aufgeloest, typOnly, spec }. */
function importEintraege(sf, dateiName) {
  const aus = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const spec = s.moduleSpecifier.text;
    const aufgeloest = loese(spec, dateiName);
    const ic = s.importClause;
    const typOnly = !!ic?.isTypeOnly;
    const neu = (lokal, art, imp, typ) => aus.push({ lokal, art, imp, aufgeloest, spec, typOnly: typOnly || !!typ, schluessel: `${aufgeloest}|${art}|${imp}|${lokal}` });
    if (!ic) {
      neu('', 'seite', '', false);
      continue;
    }
    if (ic.name) neu(ic.name.text, 'default', 'default', false);
    if (ic.namedBindings) {
      if (ts.isNamespaceImport(ic.namedBindings)) neu(ic.namedBindings.name.text, 'namespace', '*', false);
      else for (const e of ic.namedBindings.elements) neu(e.name.text, 'named', (e.propertyName ?? e.name).text, e.isTypeOnly);
    }
  }
  return aus;
}

// ── Kommentare mit Wirkung (N1) ─────────────────────────────────────────────────────────

const WIRKUNG = /(@ts-(expect-error|ignore|nocheck|check)|eslint-(disable|enable)|prettier-ignore|@vite-ignore|__PURE__|istanbul ignore|c8 ignore)/;

/** Alle Kommentare mit Wirkung einer Datei: [{ text, pos }] in Dateireihenfolge. */
function wirkungsKommentare(sf, text) {
  const aus = [];
  for (const b of blaetter(sf, sf)) {
    const k = b.knoten;
    const trivia = text.slice(k.pos, k.getStart(sf));
    for (const m of trivia.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) {
      if (WIRKUNG.test(m[0])) aus.push({ text: m[0].trim(), pos: k.pos + m.index });
    }
  }
  return aus;
}

// ── Der Beweis ──────────────────────────────────────────────────────────────────────────

const istAny = (typ, ziel) => {
  if (!typ) return true;
  if (typ.kind === K.AnyKeyword || typ.kind === K.UnknownKeyword) return true;
  if (ts.isTypeReferenceNode(typ)) {
    if ((typ.typeArguments ?? []).some((a) => istAny(a, ziel))) return true;
    if (ts.isIdentifier(typ.typeName)) {
      const alias = ziel.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === typ.typeName.text);
      if (alias) return istAny(alias.type, ziel);
    }
    return false;
  }
  if (ts.isUnionTypeNode(typ) || ts.isIntersectionTypeNode(typ)) return typ.types.some((t) => istAny(t, ziel));
  if (ts.isParenthesizedTypeNode(typ)) return istAny(typ.type, ziel);
  return false;
};

/**
 * @param {object} o
 *   alt, rest: Quelltext; ziele: [{name, text}]; namen: string[]; woertlichNamen: string[]; tabelle: Map;
 *   kontext; klasse; maxZeilen; restName (Pfad der Quelldatei, für relative Importe); aliase: Map; freigaben: string[]
 * @returns {{befunde: string[], zeilen: string[], zaehler: object, freigegeben: string[], hinweise: string[]}}
 */
export function beweise(o) {
  const kontext = o.kontext ?? 'k';
  const maxZeilen = o.maxZeilen ?? 3;
  const restName = o.restName ?? 'rest.ts';
  const tabelle = new Map([['this.', `${kontext}.`], ...(o.tabelle ?? [])]);
  const freigaben = new Set(o.freigaben ?? []);
  const aliase = o.aliase ?? new Map();
  const namen = [...new Set(o.namen ?? [])];
  const woertlich = [...new Set(o.woertlichNamen ?? [])];
  const treffer = new Map();
  const befunde = [];
  const zeilen = [];
  const freigegeben = [];
  const hinweise = [];
  /** Befund, der mit `--freigabe schluessel` ausdrücklich freigegeben werden kann. */
  const freigebbar = (schluessel, text) => {
    if (freigaben.has(schluessel)) {
      freigegeben.push(`${schluessel}: ${text}`);
      return;
    }
    befunde.push(`${text} (nicht beweisbar; ausdrücklich freigeben mit --freigabe ${schluessel})`);
  };

  if ((o.namen ?? []).length !== namen.length || (o.woertlichNamen ?? []).length !== woertlich.length) befunde.push('Namensliste enthält einen Namen mehrfach');
  if (namen.length + woertlich.length === 0) befunde.push('Namensliste ist leer');
  const doppelt = namen.filter((n) => woertlich.includes(n));
  if (doppelt.length) befunde.push(`Name in beiden Listen: ${doppelt.join(', ')}`);

  // M2: Tabelle
  for (const [schluessel, wert] of tabelle) {
    const soll = schluessel === 'this.' ? `${kontext}.` : `${kontext}.${schluessel}`;
    if (wert !== soll) freigebbar(`tabelle:${schluessel}=${wert}`, `Ersetzungseintrag "${schluessel}" → "${wert}" ist nicht "${soll}"`);
  }

  const sfAlt = parse(o.alt, restName);
  const sfRest = parse(o.rest, restName);
  const ziele = o.ziele.map((z) => ({ name: z.name, kern: dateiKern(z.name), sf: parse(z.text, z.name), text: z.text }));
  const zielKerne = new Set(ziele.map((z) => z.kern));
  const dAlt = deklarationen(sfAlt);
  const dRest = deklarationen(sfRest);
  const dZiel = ziele.flatMap((z) => deklarationen(z.sf).map((d) => ({ ...d, zsf: z.sf, datei: z.name, kern: z.kern, text: z.text })));
  const mAlt = modulDeklarationen(sfAlt);
  const mRest = modulDeklarationen(sfRest);
  const mZiel = ziele.flatMap((z) => modulDeklarationen(z.sf).map((d) => ({ ...d, zsf: z.sf, datei: z.name, kern: z.kern })));
  const impAlt = importEintraege(sfAlt, restName);
  const impRest = importEintraege(sfRest, restName);
  const altModulNamen = modulNamen(sfAlt);
  const alleVerschoben = new Set([...namen, ...woertlich]);

  const restErsetze = new Map();
  const altErsetze = new Map();
  const regionenAlt = []; // [von,bis,name] der verschobenen Deklarationen im Alt-Stand
  const regionenRest = []; // Weiterleitungen / weggelassene Anweisungen im Rest
  const regionenZiel = new Map(); // name → [von,bis,zielDatei]
  const wirkAlt = wirkungsKommentare(sfAlt, o.alt);
  const wirkRest = wirkungsKommentare(sfRest, o.rest);

  let gleichZahl = 0;
  let weiterleitungen = 0;
  const kontextFabriken = new Set();
  const finde = (decls, name) => decls.filter((d) => (d.art !== 'methode' || !o.klasse || d.klasse === o.klasse) && d.name === name);

  // ── Funktionen mit Kontext und Weiterleitung ──
  for (const name of namen) {
    const fehler = [];
    const inAlt = finde(dAlt, name);
    const inRest = finde(dRest, name);
    const inZiel = dZiel.filter((d) => d.name === name && d.art === 'frei');
    if (inAlt.length !== 1) fehler.push(`im Alt-Stand ${inAlt.length}× gefunden (erwartet genau 1)`);
    if (inZiel.length !== 1) fehler.push(`in den Zielen ${inZiel.length}× gefunden (erwartet genau 1)${inZiel.length > 1 ? ' → doppelt' : ' → fehlt'}`);
    if (inRest.length !== 1) fehler.push(`im Rest ${inRest.length}× gefunden (erwartet genau 1 Weiterleitung)`);
    if (inAlt[0]?.art === 'pfeil') fehler.push('Pfeilfunktion in const: nicht unterstützt (function-Deklaration verwenden)');
    if (fehler.length === 0) {
      const a = inAlt[0];
      const z = inZiel[0];
      const r = inRest[0];
      const fa = a.knoten;
      const fz = z.knoten;
      const fr = r.knoten;
      const lokal = fa.body ? lokaleNamen(fa) : new Set();
      const eigen = [];
      const tk = (n) => (n ? tokens(n, sfAlt, tabelle, treffer, eigen, lokal) : []);
      if (!fa.body || !fz.body || !fr.body) fehler.push('Funktion ohne Rumpf (Überladungssignaturen sind nicht unterstützt)');
      else {
        regionenAlt.push({ von: fa.getFullStart(), bis: fa.end, name });
        regionenRest.push({ von: fr.getFullStart(), bis: fr.end, name });
        regionenZiel.set(name, { von: fz.getFullStart(), bis: fz.end, zsf: z.zsf, datei: z.datei });
        altErsetze.set(fa, `⟦${name}⟧`);
        restErsetze.set(fr, `⟦${name}⟧`);

        // H5 / M1
        for (const { id, rolle } of bezeichner(fa)) {
          if (id.text === kontext && rolle !== false) fehler.push(`Kontextname "${kontext}" kommt im Rumpf schon vor (${zeile(id, sfAlt)}): --kontext anders wählen`);
          if (id.text === 'arguments' && rolle !== false) fehler.push(`\`arguments\` im Rumpf (${zeile(id, sfAlt)}): im Ziel zählt der Kontext mit`);
        }
        // Ziel: Kontextparameter
        const p0 = fz.parameters[0];
        if (!p0 || !ts.isIdentifier(p0.name) || p0.name.text !== kontext) fehler.push(`erster Parameter des Ziels ist nicht "${kontext}"`);
        else {
          if (p0.initializer || p0.questionToken || p0.dotDotDotToken) fehler.push('Kontextparameter hat Vorgabewert, `?` oder `...`');
          if (istAny(p0.type, z.zsf)) fehler.push(`Kontextparameter "${kontext}" hat keinen echten Typ (any/unknown/fehlt): der Typprüfer sähe nichts mehr`);
        }
        // Parameter (mit Ersetzung), Modifikatoren, Signatur
        const paramsAlt = fa.parameters.map((p) => tk(p));
        const paramsZiel = fz.parameters.slice(1).map((p) => tokenText(p, z.zsf));
        if (fz.parameters.length !== fa.parameters.length + 1) fehler.push(`Ziel hat ${fz.parameters.length} Parameter, erwartet ${fa.parameters.length + 1} (Kontext + ${fa.parameters.length})`);
        else paramsAlt.forEach((p, i) => { if (!gleich(p, paramsZiel[i])) fehler.push(`Parameter ${i + 1} weicht ab: alt "${p.join(' ')}" / Ziel "${paramsZiel[i].join(' ')}"`); });
        const asyncA = hatModifikator(fa, K.AsyncKeyword);
        if (asyncA !== hatModifikator(fz, K.AsyncKeyword)) fehler.push(`async: alt ${asyncA} / Ziel ${hatModifikator(fz, K.AsyncKeyword)}`);
        if (!!fa.asteriskToken !== !!fz.asteriskToken) fehler.push('Generator-Stern weicht ab');
        if (!gleich((fa.typeParameters ?? []).flatMap((p) => tokenText(p, sfAlt)), (fz.typeParameters ?? []).flatMap((p) => tokenText(p, z.zsf)))) fehler.push('Typparameter weichen ab');
        if (!gleich(tokenText(fa.type, sfAlt), tokenText(fz.type, z.zsf))) fehler.push('Rückgabetyp weicht ab');
        if (!hatModifikator(fz, K.ExportKeyword)) fehler.push('Funktion im Ziel ist nicht exportiert');
        const tAlt = tk(fa.body);
        const tZiel = tokenText(fz.body, z.zsf);
        if (!gleich(tAlt, tZiel)) fehler.push(`Rumpf weicht ab ${ersterUnterschied(tAlt, tZiel)}`);
        fehler.push(...eigen);

        // N1: Kommentare mit Wirkung
        const kAlt = wirkAlt.filter((c) => c.pos >= fa.getFullStart() && c.pos <= fa.end).map((c) => c.text);
        const kZiel = wirkungsKommentare(z.zsf, z.text).filter((c) => c.pos >= fz.getFullStart() && c.pos <= fz.end).map((c) => c.text);
        if (!gleich(kAlt, kZiel)) fehler.push(`Kommentare mit Wirkung weichen ab: alt [${kAlt.join(' | ')}] / Ziel [${kZiel.join(' | ')}]`);

        // H4: freie Namen binden
        const ktypIds = new Set(p0?.type ? bezeichner(p0.type).map((x) => x.id) : []);
        const zielImp = importEintraege(z.zsf, z.datei);
        const zielTopNamen = modulNamen(z.zsf);
        const gemeldet = new Set();
        for (const { id, rolle } of bezeichner(fz)) {
          if (rolle !== true && rolle !== 'kurzform') continue;
          const n = id.text;
          if (n === kontext || gemeldet.has(n)) continue;
          if (lokalGebunden(id, fz)) continue;
          if (ktypIds.has(id)) continue; // Typname des Kontexts
          if (tabelle.has(n)) continue;
          const eAlt = impAlt.find((e) => e.lokal === n);
          const eZiel = zielImp.find((e) => e.lokal === n);
          if (eAlt) {
            if (!eZiel || eZiel.aufgeloest !== eAlt.aufgeloest || eZiel.imp !== eAlt.imp || eZiel.art !== eAlt.art) {
              gemeldet.add(n);
              fehler.push(`freier Name "${n}": im Alt-Stand Import ${eAlt.art === 'named' ? `{ ${eAlt.imp} }` : eAlt.art} aus ${eAlt.aufgeloest}, im Ziel ${eZiel ? `Import aus ${eZiel.aufgeloest}` : 'nicht gebunden'}`);
            }
          } else if (altModulNamen.has(n)) {
            if (!alleVerschoben.has(n)) {
              gemeldet.add(n);
              freigebbar(`bindung:${n}`, `freier Name "${n}": im Alt-Stand Deklaration der Quelldatei (${altModulNamen.get(n)}), im Ziel nicht gebunden (im selben Lauf wörtlich mitverschieben oder über die Tabelle \`${kontext}.${n}\` führen)`);
            } else if (!zielTopNamen.has(n) && !mZiel.some((d) => d.name === n)) {
              gemeldet.add(n);
              fehler.push(`freier Name "${n}": mit verschoben, aber im Ziel nicht deklariert`);
            }
          } else if (eZiel || (zielTopNamen.has(n) && !alleVerschoben.has(n))) {
            gemeldet.add(n);
            fehler.push(`freier Name "${n}": im Alt-Stand ungebunden (global), im Ziel ${eZiel ? `Import aus ${eZiel.aufgeloest}` : 'als Deklaration'} gebunden`);
          }
        }

        // H1: Weiterleitung
        fehler.push(...pruefeWeiterleitung({ fa, fr, sfAlt, sfRest, name, kontext, maxZeilen, impRest, zielKern: z.kern, freigebbar, kontextFabriken, art: a.art }));
      }
    }
    if (fehler.length === 0) {
      gleichZahl++;
      weiterleitungen++;
    }
    zeilen.push(fehler.length === 0 ? `OK      ${name}` : `FEHLER  ${name}`);
    for (const f of fehler) {
      zeilen.push(`          - ${f}`);
      befunde.push(`${name}: ${f}`);
    }
  }

  // ── Wörtlich verschobene Deklarationen (Form 0) ──
  const erlaubteReexporte = new Set();
  for (const name of woertlich) {
    const fehler = [];
    const a = mAlt.filter((d) => d.name === name);
    const z = mZiel.filter((d) => d.name === name);
    const r = mRest.filter((d) => d.name === name);
    if (a.length !== 1) fehler.push(`im Alt-Stand ${a.length}× gefunden (erwartet genau 1)`);
    if (z.length !== 1) fehler.push(`in den Zielen ${z.length}× gefunden (erwartet genau 1)${z.length > 1 ? ' → doppelt' : ' → fehlt'}`);
    if (r.length !== 0) fehler.push(`im Rest steht die Deklaration noch (${r.length}×): doppelt statt verschoben`);
    if (a.length === 1 && z.length === 1) {
      altErsetze.set(a[0].st, '');
      regionenAlt.push({ von: a[0].st.getFullStart(), bis: a[0].st.end, name });
      if (a[0].art !== z[0].art) fehler.push(`Art weicht ab: alt ${a[0].art}, Ziel ${z[0].art}`);
      const ta = tokenText(a[0].st, sfAlt).filter((t) => t !== 'export');
      const tz = tokenText(z[0].st, z[0].zsf).filter((t) => t !== 'export');
      if (!gleich(ta, tz)) fehler.push(`Text weicht ab ${ersterUnterschied(ta, tz)}`);
      const warExportiert = hatModifikator(a[0].st, K.ExportKeyword);
      if (warExportiert && !hatModifikator(z[0].st, K.ExportKeyword)) fehler.push('war im Alt-Stand exportiert, im Ziel nicht');
      if (a[0].art === 'variable' && a[0].st.declarationList.flags !== z[0].st.declarationList.flags) fehler.push('const/let/var weicht ab');
      regionenZiel.set(name, { von: z[0].st.getFullStart(), bis: z[0].st.end, zsf: z[0].zsf, datei: z[0].datei });
      const kAlt = wirkAlt.filter((c) => c.pos >= a[0].st.getFullStart() && c.pos <= a[0].st.end).map((c) => c.text);
      const kZiel = wirkungsKommentare(z[0].zsf, ziele.find((q) => q.name === z[0].datei).text).filter((c) => c.pos >= z[0].st.getFullStart() && c.pos <= z[0].st.end).map((c) => c.text);
      if (!gleich(kAlt, kZiel)) fehler.push(`Kommentare mit Wirkung weichen ab: alt [${kAlt.join(' | ')}] / Ziel [${kZiel.join(' | ')}]`);
      if (warExportiert) erlaubteReexporte.add(name);
      if (!hatModifikator(z[0].st, K.ExportKeyword)) fehler.push('Deklaration im Ziel ist nicht exportiert (der Rest kann sie nicht importieren)');
    }
    if (fehler.length === 0) gleichZahl++;
    zeilen.push(fehler.length === 0 ? `OK      ${name} (wörtlich)` : `FEHLER  ${name} (wörtlich)`);
    for (const f of fehler) {
      zeilen.push(`          - ${f}`);
      befunde.push(`${name}: ${f}`);
    }
  }

  // Reexporte im Rest (H3)
  const reexportStatements = new Set();
  const gesehenReexport = new Set();
  for (const s of sfRest.statements) {
    if (!ts.isExportDeclaration(s) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const ziel = loese(s.moduleSpecifier.text, restName);
    const nurVerschoben = s.exportClause && ts.isNamedExports(s.exportClause) && s.exportClause.elements.length > 0 && s.exportClause.elements.every((e) => woertlich.includes((e.propertyName ?? e.name).text));
    if (!nurVerschoben) continue; // alles andere gehört zum Rest und wird unten verglichen
    if (!zielKerne.has(ziel)) {
      befunde.push(`Reexport ${s.getText(sfRest).slice(0, 80)}: zeigt auf ${ziel}, nicht auf eine der Zieldateien`);
      continue;
    }
    for (const e of s.exportClause.elements) {
      const orig = (e.propertyName ?? e.name).text;
      if (e.propertyName && aliase.get(orig) !== e.name.text) befunde.push(`Reexport von ${orig} mit Alias "${e.name.text}": nicht erlaubt (nur mit --alias ${orig}=${e.name.text})`);
      if (!erlaubteReexporte.has(orig)) befunde.push(`Reexport von ${orig}: der Name war im Alt-Stand nicht exportiert (erweitert die Oberfläche)`);
      gesehenReexport.add(orig);
    }
    reexportStatements.add(s);
    restErsetze.set(s, '');
  }
  for (const n of erlaubteReexporte) {
    if (!gesehenReexport.has(n)) befunde.push(`${n}: war im Alt-Stand exportiert, der Rest führt es nicht mehr aus (\`export { ${n} } from '<Ziel>'\` fehlt): Importeure würden brechen`);
  }

  // ── H2: der ganze Rest ──
  {
    const streams = (sf, ersetze) => {
      const t = [];
      for (const s of sf.statements) {
        if (ts.isImportDeclaration(s)) continue;
        t.push(...blaetter(s, sf, ersetze).map((b) => b.text));
      }
      return t;
    };
    const tAlt = streams(sfAlt, altErsetze);
    const tRest = streams(sfRest, restErsetze);
    if (!gleich(tAlt, tRest)) befunde.push(`Rest der Quelldatei weicht ab (außerhalb der verschobenen Deklarationen und ihrer Weiterleitungen) ${ersterUnterschied(tAlt, tRest)}`);
    // Kommentare mit Wirkung außerhalb der verschobenen Bereiche
    const draussen = (liste, regionen) => liste.filter((c) => !regionen.some((r) => c.pos >= r.von && c.pos <= r.bis)).map((c) => c.text);
    const kA = draussen(wirkAlt, regionenAlt);
    const kR = draussen(wirkRest, regionenRest);
    if (!gleich(kA, kR)) befunde.push(`Kommentare mit Wirkung im Rest weichen ab: alt [${kA.join(' | ')}] / Rest [${kR.join(' | ')}]`);
    // Importe als Menge
    const schluesselAlt = new Set(impAlt.map((e) => e.schluessel));
    const schluesselRest = new Set(impRest.map((e) => e.schluessel));
    const restIds = new Set(tRest);
    for (const e of impRest) {
      if (schluesselAlt.has(e.schluessel)) continue;
      if (!zielKerne.has(e.aufgeloest)) befunde.push(`neuer Import im Rest: "${e.lokal}" aus ${e.spec} (${e.aufgeloest}) zeigt nicht auf eine Zieldatei`);
    }
    for (const e of impAlt) {
      if (schluesselRest.has(e.schluessel)) continue;
      if (e.art === 'seite') befunde.push(`Import mit Nebenwirkung entfernt: ${e.spec}`);
      else if (restIds.has(e.lokal)) befunde.push(`Import "${e.lokal}" aus ${e.spec} entfernt oder geändert, der Name kommt im Rest aber noch vor`);
    }
  }

  // ── H4: die ganzen Zieldateien ──
  for (const z of ziele) {
    const zielImp = importEintraege(z.sf, z.name);
    for (const s of z.sf.statements) {
      if (ts.isImportDeclaration(s)) continue;
      if (ts.isFunctionDeclaration(s) && s.name) {
        if (!alleVerschoben.has(s.name.text)) befunde.push(`Ziel ${z.name}: Funktion "${s.name.text}" ist nicht als verschoben genannt`);
        continue;
      }
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          const n = ts.isIdentifier(d.name) ? d.name.text : '(Muster)';
          if (!woertlich.includes(n)) befunde.push(`Ziel ${z.name}: Deklaration "${n}" ist nicht als wörtlich verschoben genannt (Modulebene mit möglicher Nebenwirkung)`);
        }
        continue;
      }
      if ((ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && woertlich.includes(s.name.text)) continue;
      if (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) {
        hinweise.push(`Ziel ${z.name}: Typdeklaration "${s.name.text}" (ohne Laufzeitwirkung, nicht beweisbar)`);
        continue;
      }
      befunde.push(`Ziel ${z.name}: ${ts.SyntaxKind[s.kind]} auf der Modulebene ist nicht erlaubt (${zeile(s, z.sf)}): ${s.getText(z.sf).slice(0, 60).replace(/\s+/g, ' ')}`);
    }
    for (const e of zielImp) {
      if (e.art === 'seite') {
        befunde.push(`Ziel ${z.name}: Import mit Nebenwirkung ${e.spec}`);
        continue;
      }
      const gegenstueck = impAlt.some((a) => a.aufgeloest === e.aufgeloest && a.art === e.art && a.imp === e.imp && a.lokal === e.lokal);
      const kontextImport = /(^|\/)Kontext$/.test(e.aufgeloest) && e.typOnly;
      const andereZiele = zielKerne.has(e.aufgeloest) && e.aufgeloest !== z.kern;
      if (!gegenstueck && !kontextImport && !andereZiele) freigebbar(`import:${e.aufgeloest}`, `Ziel ${z.name}: Import "${e.lokal}" aus ${e.spec} hat im Alt-Stand kein Gegenstück`);
    }
  }

  // Ersetzungseinträge ohne Treffer, this-Regel
  for (const k of tabelle.keys()) {
    if ((treffer.get(k) ?? 0) === 0 && k !== 'this.') befunde.push(`Ersetzungseintrag "${k}" hat keinen Treffer (Tabelle veraltet oder falsch)`);
  }
  if (namen.length > 0 && (treffer.get('this.') ?? 0) === 0 && o.tabelleOhneThisErlaubt !== true && !freigaben.has('kein-this') && namen.some((n) => finde(dAlt, n)[0]?.art === 'methode')) {
    befunde.push('Klassenmethoden verschoben, aber `this.` kam nie vor (N3: einzeln verschobene Methode ohne this.; sonst --freigabe kein-this)');
  }
  if (kontextFabriken.size > 1) befunde.push(`Weiterleitungen nutzen verschiedene Kontext-Fabriken: ${[...kontextFabriken].join(', ')}`);

  return {
    befunde,
    zeilen,
    freigegeben,
    hinweise,
    zaehler: { namen: namen.length + woertlich.length, gleich: gleichZahl, weiterleitungen, ersetzungen: Object.fromEntries(treffer), tabelle: Object.fromEntries(tabelle) },
  };
}

/** Form 0 (alle Namen wörtlich): Kurzform für ältere Aufrufer. */
export function beweiseWoertlich(o) {
  return beweise({ ...o, namen: [], woertlichNamen: o.namen });
}

/** H1: die Weiterleitung `fr` im Rest gegen das Original `fa`. Gibt eine Liste von Fehlern zurück. */
function pruefeWeiterleitung({ fa, fr, sfAlt, sfRest, name, kontext, maxZeilen, impRest, zielKern, freigebbar, kontextFabriken, art }) {
  const f = [];
  if (!fr.body) return ['Weiterleitung ohne Rumpf'];
  if (art === 'methode' && !ts.isMethodDeclaration(fr)) f.push('Weiterleitung ist keine Methode');
  if (art === 'frei' && !ts.isFunctionDeclaration(fr)) f.push('Weiterleitung ist keine function-Deklaration');
  // Modifikatoren, Signatur
  if (!gleich(modifikatoren(fa), modifikatoren(fr))) f.push(`Modifikatoren der Weiterleitung [${modifikatoren(fr).join(' ')}] ≠ Original [${modifikatoren(fa).join(' ')}]`);
  if (!!fa.asteriskToken !== !!fr.asteriskToken) f.push('Generator-Stern der Weiterleitung weicht ab');
  if (!gleich((fa.typeParameters ?? []).flatMap((p) => tokenText(p, sfAlt)), (fr.typeParameters ?? []).flatMap((p) => tokenText(p, sfRest)))) f.push('Typparameter der Weiterleitung weichen ab');
  const pa = fa.parameters.map((p) => tokenText(p, sfAlt));
  const pr = fr.parameters.map((p) => tokenText(p, sfRest));
  if (pa.length !== pr.length || !pa.every((p, i) => gleich(p, pr[i]))) f.push('Weiterleitung hat andere Parameter als das Original (Namen, Typen, Vorgabewerte)');
  if (!gleich(tokenText(fa.type, sfAlt), tokenText(fr.type, sfRest))) f.push('Weiterleitung hat anderen Rückgabetyp als das Original');
  // Rumpf
  const stmts = fr.body.statements;
  if (stmts.length !== 1) return [...f, `Weiterleitung hat ${stmts.length} Anweisungen statt 1`];
  const st = stmts[0];
  if (!ts.isReturnStatement(st) || !st.expression) return [...f, `Weiterleitung ist kein \`return <Aufruf>\` (${ts.SyntaxKind[st.kind]})`];
  const call = st.expression;
  if (!ts.isCallExpression(call)) return [...f, 'Weiterleitung gibt etwas anderes als den Aufruf zurück (Ergebnis verändert?)'];
  if (call.questionDotToken || (ts.isPropertyAccessExpression(call.expression) && call.expression.questionDotToken)) f.push('Aufruf mit `?.` ist keine gültige Weiterleitung');
  // Aufgerufener
  const callee = call.expression;
  let modul = null;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.name.text === name) {
    const e = impRest.find((x) => x.lokal === callee.expression.text && x.art === 'namespace');
    if (!e) f.push(`Weiterleitung ruft \`${callee.expression.text}.${name}\`, aber \`${callee.expression.text}\` ist kein \`import * as\` im Rest`);
    else modul = e.aufgeloest;
  } else if (ts.isIdentifier(callee) && callee.text === name) {
    const e = impRest.find((x) => x.lokal === name && x.art === 'named' && x.imp === name);
    if (!e) f.push(`Weiterleitung ruft \`${name}(…)\` ohne \`import { ${name} }\` aus der Zieldatei (Selbstaufruf?)`);
    else modul = e.aufgeloest;
  } else {
    f.push(`Weiterleitung ruft "${callee.getText(sfRest).slice(0, 50)}" statt \`<modul>.${name}\``);
  }
  if (modul !== null && modul !== zielKern) f.push(`Weiterleitung ruft ein Modul (${modul}), das nicht die Zieldatei ${zielKern} ist`);
  // Typargumente
  const tp = (fa.typeParameters ?? []).map((p) => p.name.text);
  const ta = (call.typeArguments ?? []).map((t) => t.getText(sfRest));
  if (ta.length && !gleich(ta, tp)) f.push('Typargumente der Weiterleitung sind nicht die Typparameter');
  // Argumente
  const args = call.arguments;
  const erwartet = fa.parameters.map((p) => (ts.isIdentifier(p.name) ? { text: p.name.text, spread: !!p.dotDotDotToken } : null));
  if (erwartet.some((e) => e === null)) f.push('Parameter mit Destrukturierung: Weiterleitung nicht möglich');
  const ersteArg = args[0];
  if (!ersteArg) f.push('Weiterleitung übergibt keinen Kontext');
  else if (art === 'methode') {
    if (ersteArg.kind !== K.ThisKeyword) f.push(`Kontextargument ist "${ersteArg.getText(sfRest).slice(0, 40)}" statt genau \`this\``);
  } else {
    if (ts.isCallExpression(ersteArg) && ts.isIdentifier(ersteArg.expression) && ersteArg.arguments.length === 0) {
      kontextFabriken.add(ersteArg.expression.text);
      freigebbar(`umgebung:${ersteArg.expression.text}`, `Kontext der Weiterleitung \`${ersteArg.expression.text}()\` (Inhalt nicht beweisbar)`);
    } else f.push(`Kontextargument "${ersteArg.getText(sfRest).slice(0, 50)}" ist keine Fabrik der Form \`<name>()\``);
  }
  const rest = [...args].slice(1);
  if (rest.length !== erwartet.length) f.push(`Weiterleitung übergibt ${rest.length} Argumente nach dem Kontext, erwartet ${erwartet.length}`);
  else {
    rest.forEach((a, i) => {
      const e = erwartet[i];
      if (!e) return;
      const ok = e.spread ? ts.isSpreadElement(a) && ts.isIdentifier(a.expression) && a.expression.text === e.text : ts.isIdentifier(a) && a.text === e.text;
      if (!ok) f.push(`Argument ${i + 1} der Weiterleitung ist "${a.getText(sfRest).slice(0, 40)}", erwartet "${e.spread ? '...' : ''}${e.text}" (Parameter unverändert, gleiche Reihenfolge)`);
    });
  }
  // Länge
  const zl = sfRest.getLineAndCharacterOfPosition(fr.body.getEnd()).line - sfRest.getLineAndCharacterOfPosition(fr.body.getStart(sfRest)).line + 1;
  if (zl > maxZeilen) f.push(`Rumpf der Weiterleitung ist ${zl} Zeilen lang (höchstens ${maxZeilen})`);
  return f;
}

// ── Aufruf von der Kommandozeile ────────────────────────────────────────────────────────

function argumente(argv) {
  const a = { ziele: [], ersetze: [], namen: [], woertlichNamen: [], freigaben: [], aliase: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const nimm = () => {
      if (i + 1 >= argv.length) throw new Error(`${k} braucht einen Wert`);
      return argv[++i];
    };
    const liste = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    switch (k) {
      case '--alt': a.alt = nimm(); break;
      case '--rest': a.rest = nimm(); break;
      case '--ziel': a.ziele.push(nimm()); break;
      case '--namen': a.namen.push(...liste(nimm())); break;
      case '--woertlich-namen': a.woertlichNamen.push(...liste(nimm())); break;
      case '--liste': a.liste = nimm(); break;
      case '--ersetzung': a.ersetzung = nimm(); break;
      case '--ersetze': a.ersetze.push(nimm()); break;
      case '--kontext': a.kontext = nimm(); break;
      case '--klasse': a.klasse = nimm(); break;
      case '--max-zeilen': a.maxZeilen = Number(nimm()); break;
      case '--freigabe': a.freigaben.push(nimm()); break;
      case '--alias': a.aliase.push(nimm()); break;
      case '--woertlich': a.woertlich = true; break;
      case '--json': a.json = true; break;
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

/** Aufruffehler: geordnete Meldung mit dem Satz „EINGESCHRÄNKT“, bei --json als JSON. */
function aufrufFehler(meldung, json) {
  if (json) console.log(JSON.stringify({ eingeschraenkt: EINGESCHRAENKT, fehler: meldung }, null, 2));
  else {
    console.error(meldung);
    console.error(EINGESCHRAENKT);
  }
  return 2;
}

function haupt(argv) {
  const json = argv.includes('--json');
  let a;
  try {
    a = argumente(argv);
  } catch (e) {
    return aufrufFehler(String(e.message ?? e), json);
  }
  if (!a.json && !a.hilfe) console.log(`${EINGESCHRAENKT}\n`);
  if (a.hilfe) {
    console.log(`${EINGESCHRAENKT}\n`);
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('*/')[0]);
    console.log(`\n${EINGESCHRAENKT}`);
    return 0;
  }
  if (!a.alt || !a.rest || a.ziele.length === 0) {
    return aufrufFehler('benötigt: --alt, --rest, mindestens ein --ziel und --namen/--woertlich-namen/--liste (siehe --help)', a.json);
  }
  if (a.liste) {
    try {
      for (const l of readFileSync(a.liste, 'utf-8').split('\n')) { const s = l.replace(/#.*$/, '').trim(); if (s) a.namen.push(s); }
    } catch (e) {
      return aufrufFehler(`--liste ${a.liste} nicht lesbar: ${e.code ?? e.message}`, a.json);
    }
  }
  if (a.woertlich) { a.woertlichNamen.push(...a.namen); a.namen = []; }
  let erg;
  try {
    const aliase = new Map(a.aliase.map((x) => x.split('=')));
    erg = beweise({
      alt: lies(a.alt),
      rest: lies(a.rest),
      restName: pfadAufloesen(a.rest).replaceAll('\\', '/'),
      ziele: a.ziele.map((z) => ({ name: pfadAufloesen(z).replaceAll('\\', '/'), text: lies(z) })),
      namen: a.namen,
      woertlichNamen: a.woertlichNamen,
      tabelle: tabelleAus(a),
      kontext: a.kontext,
      klasse: a.klasse,
      maxZeilen: a.maxZeilen,
      freigaben: a.freigaben,
      aliase,
    });
  } catch (e) {
    return aufrufFehler(`Lesefehler: ${e.message ?? e}`, a.json);
  }
  if (a.json) console.log(JSON.stringify({ eingeschraenkt: EINGESCHRAENKT, ...erg }, null, 2));
  else {
    console.log(erg.zeilen.join('\n'));
    const z = erg.zaehler;
    console.log(`\nNamen ${z.namen}, gleich ${z.gleich}, Weiterleitungen ${z.weiterleitungen}; Ersetzungen ${JSON.stringify(z.ersetzungen)}; Tabelle ${JSON.stringify(z.tabelle)}`);
    for (const h of erg.hinweise) console.log(`Hinweis: ${h}`);
    for (const f of erg.freigegeben) console.log(`FREIGEGEBEN (in den PR-Text): ${f}`);
    const rest = erg.befunde.filter((b) => !erg.zeilen.some((l) => l.includes(b.replace(/^[^:]+: /, ''))));
    if (rest.length) console.log(`\nWeitere Befunde:\n${rest.map((b) => `  - ${b}`).join('\n')}`);
    console.log(erg.befunde.length === 0 ? '\nKEINE ABWEICHUNG GEFUNDEN (eingeschränkt): das ist kein Beweis.' : `\nABWEICHUNG GEFUNDEN: ${erg.befunde.length} Befund(e).`);
    console.log(`\n${EINGESCHRAENKT}`);
  }
  return erg.befunde.length === 0 ? 0 : 1;
}

if (process.argv[1] && pfadAufloesen(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(haupt(process.argv.slice(2)));
