/**
 * U1 — Verdrahtung des Modell-Uploads im Betriebsdienst, geprüft am
 * Syntaxbaum statt am Text (überlebt `npm run format`).
 *
 * ── Warum dieser Test nötig ist, obwohl das Prüftor selbst schon
 *    ausführlich geprüft ist ─────────────────────────────────────────
 * `server/test/modell-upload-pruefung.ts` ruft `pruefeUndSpeichereUpload`
 * direkt auf — das beweist das TOR, aber nicht, dass der Betriebsdienst
 * es überhaupt ERREICHT. Zwei Dinge sind hier scharf, weil PR #59 (Welt
 * zurücksetzen) GENAU an dieser Stelle im selben Zug eine neue, globale
 * Klemme eingezogen hat: Jede zustandsändernde Anfrage (POST/PUT/PATCH/
 * DELETE) OHNE `Content-Type: application/json` bekommt seit #59 ein
 * pauschales 415. Ein Upload schickt aber die REINEN Bytes einer `.glb`
 * (`application/octet-stream`) — ohne eine bewusste, eng gefasste
 * Ausnahme wäre der Upload-Endpunkt durch #59 lautlos tot, und ein Test,
 * der nur das Tor selbst ruft, sähe das NIE (er ruft nie über HTTP).
 *
 *   (1) Die Ausnahme ist eng: Sie gilt NUR für `POST /api/modell-hochladen`,
 *       nicht für jede beliebige Anfrage — sonst wäre die #59-Klemme für
 *       jeden Pfad umgehbar, sobald er nur den richtigen Namen träfe.
 *   (2) Die Herkunftsprüfung (`fremdeHerkunft`, Sec-Fetch-Site/Origin)
 *       bleibt für den Upload-Pfad SCHARF — die Ausnahme betrifft
 *       ausdrücklich nur die Content-Type-Klemme, nicht die Zeile davor.
 *
 * Ein echter Prozess-Test (Upload per HTTP gegen einen laufenden
 * Betriebsdienst) wäre der schärfere Beweis, bräuchte hier aber ein
 * WOV_WURZEL-Gerüst UND den echten `assets/hochgeladen`-Ordner am
 * Dateisystem-Pfad des Quelltexts (der Ordner ist NICHT über WOV_WURZEL
 * umlenkbar — er hängt an `import.meta.url` in `shared/src/
 * uploadedModelUpload.ts`, wie `ASSET_WURZEL` in `KollisionsFormen.ts`).
 * Der Durchstich-Nachweis im Bericht deckt das über einen echten Lauf
 * gegen die Slot-Dienste ab; dieser Test hier prüft die WIRING-Frage
 * ohne einen Prozess zu starten.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const HAUPT_PFAD = resolve(ADMIN, 'src/main.ts');
const TEXT = readFileSync(HAUPT_PFAD, 'utf8');
const SF = ts.createSourceFile(HAUPT_PFAD, TEXT, ts.ScriptTarget.Latest, true);

let failures = 0;
function check(bedingung: boolean, was: string): void {
  if (bedingung) console.log(`  ok   ${was}`);
  else {
    console.log(`  FAIL ${was}`);
    failures++;
  }
}

/** Text eines Knotens ohne Kommentare/Whitespace-Rauschen. */
function knotenText(n: ts.Node): string {
  return n.getText(SF);
}

console.log("\n1. Die Ausnahme ist eng gefasst: nur POST /api/modell-hochladen\n");

// `const istModellUpload = pfad === '/api/modell-hochladen' && req.method === 'POST';`
let istUploadDeklaration: ts.VariableDeclaration | undefined;
const suche = (n: ts.Node): void => {
  if (
    ts.isVariableDeclaration(n) &&
    ts.isIdentifier(n.name) &&
    n.name.text === 'istModellUpload' &&
    n.initializer
  ) {
    istUploadDeklaration = n;
  }
  ts.forEachChild(n, suche);
};
suche(SF);

check(istUploadDeklaration !== undefined, "Konstante 'istModellUpload' existiert");
if (istUploadDeklaration?.initializer) {
  const init = knotenText(istUploadDeklaration.initializer);
  check(init.includes("'/api/modell-hochladen'"), 'istModellUpload prüft den exakten Pfad /api/modell-hochladen');
  check(/req\.method\s*===\s*'POST'/.test(init), "istModellUpload verlangt genau die Methode 'POST'");
  check(!/PUT|PATCH|DELETE/.test(init), 'istModellUpload lässt PUT/PATCH/DELETE NICHT pauschal durch');
}

console.log('\n2. Die Content-Type-Klemme (#59) überspringt NUR diese eine Ausnahme\n');

// Das if, das 415 zurückgibt: seine Bedingung muss "!istModellUpload" enthalten,
// UND der 415-Rumpf muss im selben if-Zweig stehen (nicht in einem unabhängigen).
let contentTypeIf: ts.IfStatement | undefined;
const sucheIf = (n: ts.Node): void => {
  if (ts.isIfStatement(n) && knotenText(n.expression).includes('content-type')) {
    contentTypeIf = n;
  }
  ts.forEachChild(n, sucheIf);
};
sucheIf(SF);

check(contentTypeIf !== undefined, 'if-Anweisung über Content-Type gefunden');
if (contentTypeIf) {
  const bedingung = knotenText(contentTypeIf.expression);
  check(bedingung.includes('!istModellUpload'), 'Bedingung enthält !istModellUpload (die Ausnahme)');
  check(/application\\\/json/.test(bedingung), 'Bedingung prüft weiterhin gegen application/json für alle anderen Pfade');
  const rumpf = knotenText(contentTypeIf.thenStatement);
  check(rumpf.includes('415'), 'bei einer Ablehnung antwortet dieser Zweig weiterhin mit 415');
}

console.log('\n3. Die Herkunftsprüfung steht VOR der Content-Type-Klemme und bleibt für den Upload scharf\n');

// Der Aufruf `fremdeHerkunft(...)` muss lexikalisch VOR der Content-Type-if stehen
// (Reihenfolge im Text = Reihenfolge der Ausführung in synchronem Code).
const herkunftIndex = TEXT.indexOf('fremdeHerkunft(');
const contentTypeIndex = contentTypeIf ? contentTypeIf.getStart(SF) : -1;
check(herkunftIndex >= 0, 'fremdeHerkunft(...) wird aufgerufen');
check(herkunftIndex >= 0 && contentTypeIndex >= 0 && herkunftIndex < contentTypeIndex, 'fremdeHerkunft(...) läuft VOR der Content-Type-Klemme — Upload-Anfragen durchlaufen sie unverändert');

console.log('\n4. Die eigentliche Route: POST lädt hoch, DELETE entfernt\n');

check(TEXT.includes("pfad === '/api/modell-hochladen' && req.method === 'POST'"), 'ein früher Sonderpfad für POST /api/modell-hochladen existiert (vor der JSON-Weiche, wie /api/serverlog)');
check(/modellHochladenBehandeln\s*\(/.test(TEXT), 'er ruft modellHochladenBehandeln(...)');
check(TEXT.includes("pfad === '/api/modell-hochladen' && methode === 'DELETE'"), 'ein DELETE-Zweig für /api/modell-hochladen existiert in behandeln()');
check(/entferneUpload\s*\(/.test(TEXT), 'er ruft entferneUpload(...)');

// modellHochladenBehandeln selbst muss den Content-Type der Anfrage aktiv prüfen
// (die #59-Klemme ist ja übersprungen -- ohne eigene Prüfung käme JEDER Content-Type durch).
let modellHochladenFn: ts.FunctionDeclaration | undefined;
const sucheFn = (n: ts.Node): void => {
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'modellHochladenBehandeln') modellHochladenFn = n;
  ts.forEachChild(n, sucheFn);
};
sucheFn(SF);
check(modellHochladenFn !== undefined, 'Funktion modellHochladenBehandeln ist deklariert');
if (modellHochladenFn) {
  const rumpf = knotenText(modellHochladenFn);
  check(rumpf.includes('application/octet-stream'), 'modellHochladenBehandeln verlangt selbst application/octet-stream (kein content-type-freier Durchgang)');
  check(rumpf.includes('415'), 'ein falscher Content-Type führt weiterhin zu 415, nur mit einer anderen Meldung');
  check(rumpf.includes('uploadsErlaubt()'), 'die Instanz-/Schaltersperre (auf live gesperrt, server.yml) wird abgefragt');
}

console.log('\n5. Der Schalter ist eine eigene Zeile in server.yml, nicht dungeons.modulbau\n');
check(TEXT.includes("ymlLesen()['uploads.modell-hochladen']"), "uploadsErlaubt() liest 'uploads.modell-hochladen', nicht dungeons.modulbau");

console.log('\n6. N1 (Angriff, Befund B2) — der Aufruf wird AWAITED, nicht nur zurückgegeben\n');
// `return modellHochladenBehandeln(...)` OHNE `await` gäbe das Promise selbst
// zurück; eine Ablehnung darin landete NIE im `catch` der umgebenden
// IIFE, sondern als unbehandelte Ablehnung auf Prozessebene — Node
// beendet den Dienst dafür. Am Syntaxbaum: der Aufruf muss in einem
// `AwaitExpression` stecken, nicht nur im Text danebenstehen (das
// überlebt auch eine Umformatierung durch `npm run format`).
let awaitedAufruf = false;
const sucheAwait = (n: ts.Node): void => {
  if (
    ts.isAwaitExpression(n) &&
    ts.isCallExpression(n.expression) &&
    ts.isIdentifier(n.expression.expression) &&
    n.expression.expression.text === 'modellHochladenBehandeln'
  ) {
    awaitedAufruf = true;
  }
  ts.forEachChild(n, sucheAwait);
};
sucheAwait(SF);
check(awaitedAufruf, 'der Aufruf von modellHochladenBehandeln(...) steckt in einem await-Ausdruck');

console.log('\n7. N1 (Befund B6) — die Kopfzeile wird dekodiert, nicht roh übernommen\n');
if (modellHochladenFn) {
  const rumpf = knotenText(modellHochladenFn);
  check(rumpf.includes('decodeURIComponent'), "modellHochladenBehandeln dekodiert x-wov-modellname mit decodeURIComponent (encodeURIComponent auf der Gegenseite)");
  check(/catch[^}]*name-ungueltig-kodiert/.test(rumpf), 'eine fehlgeschlagene Dekodierung bekommt eine eigene, verständliche Ablehnung statt eines rohen Absturzes');
}

console.log('\n8. N1 (Befund B7, „auf live wird der Körper trotzdem gelesen") — uploadsErlaubt() wird VOR dem Körperlesen geprüft\n');
if (modellHochladenFn) {
  const rumpf = knotenText(modellHochladenFn);
  // '(' nach dem Namen, damit ein blosser Kommentar-Verweis auf
  // 'leibBinaerLesen' (ohne Klammer) den eigentlichen AUFRUF nicht vortäuscht.
  const posErlaubt = rumpf.indexOf('uploadsErlaubt()');
  const posLesen = rumpf.indexOf('leibBinaerLesen(');
  check(posErlaubt >= 0 && posLesen >= 0 && posErlaubt < posLesen, 'die erste uploadsErlaubt()-Prüfung im Funktionsrumpf steht VOR dem Aufruf von leibBinaerLesen(...) — auf live/ausgeschaltet wird der Körper gar nicht erst gelesen');
}

console.log('\n9. N2 (Nachangriff, Befund N-1) — der Upload-Zweig gleicht Module UND Uploads selbst ab, statt sich auf behandeln() zu verlassen\n');
// `modellHochladenBehandeln` läuft VOR `behandeln()` (Abschnitt 4) und damit
// auch vor dessen `moduleAbgleichen()`/`hochgeladenAbgleichen()` (Zeile
// ~1336/1340 in behandeln selbst) — ohne einen EIGENEN Aufruf hier sähe der
// allererste Upload nach einem Neustart einen leeren Speicher (weder
// Gen_-Module noch schon auf der Platte stehende Uploads bekannt), und die
// Gross-/Klein-Sperre (B7) sowie die Hash-Prüfung (B1) liefen gegen einen
// unvollständigen Stand.
if (modellHochladenFn) {
  const rumpf = knotenText(modellHochladenFn);
  check(rumpf.includes('moduleAbgleichen()'), 'modellHochladenBehandeln ruft moduleAbgleichen() selbst auf');
  check(rumpf.includes('hochgeladenAbgleichen()'), 'modellHochladenBehandeln ruft hochgeladenAbgleichen() selbst auf');
  const posAbgleich1 = rumpf.indexOf('moduleAbgleichen()');
  const posAbgleich2 = rumpf.indexOf('hochgeladenAbgleichen()');
  const posLesen = rumpf.indexOf('leibBinaerLesen(');
  check(
    posAbgleich1 >= 0 && posAbgleich2 >= 0 && posLesen >= 0 && posAbgleich1 < posLesen && posAbgleich2 < posLesen,
    'beide Abgleiche laufen VOR dem Lesen des Körpers — die Prüfungen weiter unten (Name, Hash) sehen damit den frischen Stand'
  );
}

console.log('\n10. U1-N3 — der Sammel-catch gibt für /api/modell-hochladen nie eine rohe Error.message an den Browser\n');
// Am Syntaxbaum: Im catch-Block der Anfrage-IIFE steht ein `if`, dessen
// Bedingung den Pfad '/api/modell-hochladen' nennt und dessen Rumpf KEIN
// `.message` eines gefangenen Fehlers liest. Die allgemeine Zeile
// `const meldung = (fehler as Error).message` steht dahinter.
{
  let sammelCatch: ts.CatchClause | undefined;
  const sucheCatch = (n: ts.Node): void => {
    if (ts.isCatchClause(n) && n.variableDeclaration?.name.getText(SF) === 'fehler' && knotenText(n).includes('AnfrageZuGross')) {
      sammelCatch = n;
    }
    ts.forEachChild(n, sucheCatch);
  };
  sucheCatch(SF);
  check(sammelCatch !== undefined, 'der Sammel-catch der Anfrage-Behandlung ist gefunden');
  if (sammelCatch) {
    let uploadZweig: ts.IfStatement | undefined;
    let meldungPos = -1;
    for (const st of sammelCatch.block.statements) {
      if (ts.isIfStatement(st) && st.expression.getText(SF).includes("'/api/modell-hochladen'")) uploadZweig = st;
      if (ts.isVariableStatement(st) && st.getText(SF).includes('(fehler as Error).message')) meldungPos = st.getStart(SF);
    }
    check(uploadZweig !== undefined, "im Sammel-catch steht ein eigener Zweig für pfad === '/api/modell-hochladen'");
    if (uploadZweig) {
      const zweig = knotenText(uploadZweig.thenStatement);
      check(!/\.message/.test(zweig), 'dieser Zweig liest keine .message eines Fehlers (nur feste Texte)');
      check(/json\(\s*res\s*,/.test(zweig) && zweig.includes('interner-fehler'), "er antwortet selbst mit einer festen Kennung 'interner-fehler'");
      check(meldungPos < 0 || uploadZweig.getStart(SF) < meldungPos, 'er steht VOR der allgemeinen Zeile, die die rohe message übernimmt');
    }
  }
}

console.log(failures === 0 ? '\nU1-Verdrahtung: alles grün.\n' : `\nU1-Verdrahtung: ${failures} FEHLGESCHLAGEN.\n`);
process.exit(failures > 0 ? 1 : 0);
