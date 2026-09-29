/**
 * Grundskala im Betriebsdienst (Karte „Editor Upload-Größe", Auftrag
 * Punkt 6) — Verdrahtung am Syntaxbaum geprüft, wie
 * `admin/test/modell-upload-verdrahtung.ts` (dortiger Kopfkommentar
 * erklärt, warum: ein echter Prozess-Test bräuchte ein WOV_WURZEL-Gerüst
 * und den `assets/hochgeladen`-Ordner am Dateisystem-Pfad des
 * Quelltexts). Die FUNKTIONALE Seite (Annahme, Grenzen 0,01…100,
 * Nachträglich-Weg) ist bereits an der echten Kette bewiesen —
 * `server/test/upload-grundskala-kollision.ts` ruft `pruefeUndSpeichereUpload`
 * und `aendereGrundskala` direkt, ohne HTTP. Ein Durchstich gegen den
 * ECHTEN, laufenden Betriebsdienst auf Port 0 (POST mit `X-Wov-Grundskala`,
 * danach PATCH) steht als manueller Nachweis im Bericht.
 *
 * Geprüft hier:
 *   1. `modellHochladenBehandeln` liest die Kopfzeile `x-wov-grundskala`,
 *      prüft sie mit `pruefeGrundskala` und antwortet bei einer ungültigen
 *      Zahl mit 422 (nicht 400 — semantisch ungültig, nicht syntaktisch).
 *   2. Die Kopfzeile fliesst als `grundskala` in den Aufruf von
 *      `pruefeUndSpeichereUpload` — sonst käme beim echten Upload nie
 *      etwas anderes als 1 an, egal was der Editor schickt.
 *   3. `behandeln()` hat einen PATCH-Zweig für `/api/modell-hochladen`,
 *      der `aendereGrundskala` ruft, `grundskala` mit `pruefeGrundskala`
 *      prüft (422 bei ungültig, 400 bei fehlendem Feld) und NICHT die
 *      Bestätigungslogik von DELETE mitschleppt (kein `bestaetigt`-Feld
 *      nötig — Auftrag Punkt 5: „genau das ist gewollt").
 *
 * Lauf:  npx tsx admin/test/upload-grundskala-dienst.ts
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

function knotenText(n: ts.Node): string {
  return n.getText(SF);
}

function findeFunktion(name: string): ts.FunctionDeclaration | undefined {
  let treffer: ts.FunctionDeclaration | undefined;
  const suche = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) treffer = n;
    ts.forEachChild(n, suche);
  };
  suche(SF);
  return treffer;
}

console.log('\n1. POST liest x-wov-grundskala, prüft mit pruefeGrundskala, 422 bei ungültig\n');
const modellHochladenFn = findeFunktion('modellHochladenBehandeln');
check(modellHochladenFn !== undefined, 'Funktion modellHochladenBehandeln ist deklariert');
if (modellHochladenFn) {
  const rumpf = knotenText(modellHochladenFn);
  check(rumpf.includes("req.headers['x-wov-grundskala']"), "liest die Kopfzeile 'x-wov-grundskala'");
  check(rumpf.includes('pruefeGrundskala('), 'prüft sie mit pruefeGrundskala(...)');
  check(/pruefeGrundskala\([^)]*\)[\s\S]{0,80}422/.test(rumpf), 'eine Ablehnung von pruefeGrundskala führt zu 422 (nicht 400)');
  check(rumpf.includes('grundskala-ungueltig'), "die 422-Antwort trägt die Kennung 'grundskala-ungueltig'");
}

console.log('\n2. Die geprüfte Grundskala fliesst in pruefeUndSpeichereUpload({..., grundskala})\n');
if (modellHochladenFn) {
  const rumpf = knotenText(modellHochladenFn);
  // Der Aufruf von pruefeUndSpeichereUpload muss im TEXT NACH der
  // grundskala-Deklaration stehen und `grundskala` als Kurzform-Property
  // ({ ..., grundskala }) mitgeben — sonst käme die geprüfte Kopfzeile nie
  // beim Upload-Tor an.
  const posDeklaration = rumpf.indexOf('let grundskala');
  const posAufruf = rumpf.indexOf('pruefeUndSpeichereUpload(');
  check(posDeklaration >= 0, "Variable 'grundskala' wird deklariert");
  check(posAufruf >= 0 && posDeklaration >= 0 && posDeklaration < posAufruf, 'die Deklaration steht VOR dem Aufruf von pruefeUndSpeichereUpload');
  const aufrufAusschnitt = rumpf.slice(posAufruf, posAufruf + 400);
  check(/\bgrundskala\b/.test(aufrufAusschnitt), 'der Aufruf von pruefeUndSpeichereUpload gibt grundskala mit');
}

console.log('\n3. behandeln() hat einen PATCH-Zweig für /api/modell-hochladen\n');
check(
  TEXT.includes("pfad === '/api/modell-hochladen' && methode === 'PATCH'"),
  "ein PATCH-Zweig für pfad === '/api/modell-hochladen' existiert in behandeln()"
);
check(/aendereGrundskala\s*\(/.test(TEXT), 'er ruft aendereGrundskala(...)');

// Den PATCH-Zweig als eigenen Textausschnitt isolieren: vom PATCH-if bis
// zum NÄCHSTEN top-level `if (pfad ===` danach (das DELETE-if steht
// unmittelbar DAVOR, s. modell-upload-verdrahtung.ts Abschnitt 4).
const patchStart = TEXT.indexOf("pfad === '/api/modell-hochladen' && methode === 'PATCH'");
const nachPatch = TEXT.indexOf("if (pfad ===", patchStart + 1);
const patchZweig = patchStart >= 0 ? TEXT.slice(patchStart, nachPatch >= 0 ? nachPatch : patchStart + 2000) : '';

console.log('\n4. Der PATCH-Zweig prüft Name UND Grundskala, meldet 422 bei ungültiger Grundskala\n');
check(patchZweig.length > 0, 'PATCH-Zweig gefunden und isoliert');
check(patchZweig.includes('name-fehlt'), "fehlender Name -> eigene Ablehnung ('name-fehlt')");
check(patchZweig.includes('grundskala-fehlt') || patchZweig.includes('typeof grundskalaRoh'), 'eine fehlende/falsch typisierte Grundskala wird eigens erkannt');
check(patchZweig.includes('pruefeGrundskala('), 'PATCH prüft die Grundskala mit derselben Funktion wie POST (pruefeGrundskala)');
check(/pruefeGrundskala\([^)]*\)[\s\S]{0,80}422/.test(patchZweig), 'eine ungültige Grundskala führt im PATCH-Zweig zu 422');
check(patchZweig.includes('grundskala-ungueltig'), "auch hier die Kennung 'grundskala-ungueltig'");

console.log('\n5. PATCH braucht KEINE Bestätigung (anders als DELETE) — Auftrag Punkt 5\n');
check(!patchZweig.includes('brauchtBestaetigung'), 'der PATCH-Zweig kennt kein brauchtBestaetigung (keine Nutzungs-Bestätigung nötig)');
check(!patchZweig.includes('409'), 'der PATCH-Zweig antwortet nie mit 409 (das ist DELETEs Bestätigungscode)');

console.log('\n6. PATCH steht NACH hochgeladenAbgleichen() — sieht denselben frischen Stand wie DELETE\n');
{
  const posAbgleich = TEXT.indexOf('hochgeladenAbgleichen();');
  check(posAbgleich >= 0 && posAbgleich < patchStart, 'hochgeladenAbgleichen() läuft vor dem PATCH-Zweig');
}

console.log(failures === 0 ? '\nGrundskala-Betriebsdienst: alles grün.\n' : `\nGrundskala-Betriebsdienst: ${failures} FEHLGESCHLAGEN.\n`);
process.exit(failures > 0 ? 1 : 0);
