/**
 * G1 N1 (Nachbesserung nach Angriff `2026-09-29 Editor G1 Grundskala live —
 * Angriff.md`, URTEIL BLOCKIEREN): der volle Weg über ZWEI GETRENNTE Realms —
 * Katalog (dieser Prozess, Hauptthread) und Testflug (ein `worker_thread`,
 * wie ein zweites Browserfenster: eigene Modulinstanzen, eigene
 * Upload-Registry, `main.ts` lädt sie nur einmal beim Start). Beide Realms
 * sind nur über einen ECHTEN, globalen `BroadcastChannel` (laut
 * Node-Dokumentation prozessweit über Worker-Grenzen hinweg wirksam) und
 * eine ECHTE HTTP-Antwort verbunden — eine Attrappe des Betriebsdienstes,
 * die nach der simulierten PATCH-Antwort den neuen Wert liefert, genauso
 * wie `client/src/net/UploadedModelRegistryLoad.ts` es beim echten
 * Betriebsdienst tut.
 *
 * Gemessen wird die EFFEKTIVE Weltskala eines im Testflug-Realm GESETZTEN
 * Exemplars: `localMatrix × ZDO-Weltmatrix`, genau die Rechnung, mit der
 * `EntityManager` seine Instanzmatrizen baut (Kopfkommentar `AssetManager.
 * getMasters`, „instance matrices are localMatrix × zdoWorld"), an einer
 * ECHTEN, wenn auch synthetischen Geometrie (Muster aus `client/test/
 * upload-grundskala-neu-anwenden.ts`) — keine Attrappe mit Identity-Matrix,
 * die jede Grundskala gleich aussehen liesse.
 *
 * Angriffsbefund B1 (an der VORHERIGEN Fassung): Genau dieser Ablauf blieb
 * bei der Skala 1 stehen, weil der Testflug-Empfänger seine eigene Registry
 * nie neu lud (Probe des Angreifers: `client/test/_angriff_realm*.ts`,
 * inzwischen gelöscht, Muster hier wiederaufgenommen). Diese Fassung prüft
 * genau das: `Testflug.ts`s WIRKLICHE Verdrahtung (Abschnitt 1, Quelltext)
 * UND das WIRKLICHE Ergebnis im zweiten Realm (Abschnitt 2, gemessen).
 *
 * Ein voller `starteTestflug()` mit echtem DOM/Szene/HUD ist für einen
 * DOM-freien Lauf unverhältnismässig (`testflug-modul.ts` behandelt andere
 * Eigenschaften des Moduls deshalb schon rein textuell) — Abschnitt 1 prüft
 * daher die WIRKLICHE Verdrahtung in `Testflug.ts`/`GegenstandsKatalog.ts`
 * am Quelltext (wie `testflug-modul.ts` es für andere Eigenschaften schon
 * tut), Abschnitt 2 führt den DAHINTERLIEGENDEN Mechanismus (Registry-Reload,
 * `EntityManager.aktualisiereGrundskala`, `grundskalaLive.ts`) vollständig
 * UND real aus, mit einer echten zweiten Instanz (nicht demselben Modul im
 * selben Prozess), einem echten Kontroll-Exemplar (bleibt unberührt) und
 * einem dritten, im Testflug NIE gesetzten Modell (B3: kein Ladeversuch).
 *
 * N3 (Karte G1 N3, Nachbesserung nach Nachangriff N2):
 *
 *   - **N2-3** — der bisherige Struktur-Wächter (Abschnitt 1) war reine
 *     Textsuche per Regex: Ein Aufruf von `verdrahteGrundskalaLive` in
 *     einem toten Zweig (`if (Date.now() < 0) …`) blieb grün, weil die
 *     Suche nur ZÄHLT, ob der Text `verdrahteGrundskalaLive(` irgendwo
 *     vorkommt, egal ob der Code je läuft. Ein `ladeRegistry`, das den
 *     alten, falschen Wert in einem KOMMENTAR neben einem neuen, falschen
 *     Lambda stehen hatte, bestand die Regex-Prüfung ebenfalls, weil sie
 *     auf reinem Text sucht und Kommentare nicht unterscheidet. Abschnitt 1
 *     läuft jetzt auf dem TypeScript-Syntaxbaum (`typescript`-Paket, Muster
 *     wie `client/test/editor-serversteuerung.ts`): Der Aufruf muss auf
 *     OBERSTER EBENE von `starteTestflug` stehen (eine `const … =
 *     verdrahteGrundskalaLive(...)`-Anweisung direkt im Funktionskörper,
 *     nicht in einem `if`/Zweig), und `ladeRegistry` muss ein Pfeil mit
 *     KONZISEM Rumpf sein, dessen Rumpf GENAU der Aufruf
 *     `ladeHochgeladeneRegistrierung()` ist — ein Kommentar daneben ändert
 *     am Syntaxbaum nichts. (N4 unten: seit `signal?: AbortSignal` prüft
 *     dieselbe Stelle `ladeHochgeladeneRegistrierung(undefined, signal)`.)
 *   - **N2-1/N2-2** — Abschnitt 3 unten: der ECHTE `ladeHochgeladeneRegistrierung`
 *     gegen eine steuerbare HTTP-Attrappe (kein werfender Ersatz für
 *     `uebernehmen`, anders als die vorherige Fassung von
 *     `client/test/grundskala-live.ts`, die einen Fehlschlag nur nachbaute,
 *     ohne dass der echte Lader je scheitern konnte). Gemessen wird die
 *     TATSÄCHLICH übernommene Grundskala über
 *     `uploadedModelRegistry.grundskalaFuerModell` — denselben Weg, den
 *     auch `AssetManager` benutzt.
 *
 * N4 (Karte G1 N4, Nachbesserung nach Nachangriff N3, Befund N3-1): die
 * G1-Verdrahtung bricht einen zu langsamen/hängenden Registry-Abruf jetzt
 * über einen `AbortController` wirklich ab (`grundskalaLive.ts`,
 * `ladeHochgeladeneRegistrierung` bekommt dafür ein optionales
 * `signal?: AbortSignal`). Abschnitt 1 prüft deshalb den neuen Aufruf
 * `ladeHochgeladeneRegistrierung(undefined, signal)` (statt ohne
 * Argumente). Abschnitt 3 bekommt zwei weitere Durchläufe gegen dieselbe
 * Attrappe, die jetzt zusätzlich Verbindungsabbrüche zählt
 * (`zustand.abbrueche`, `req.on('close', …)` VOR einer fertigen Antwort):
 * `zeitlimitUeberschreibtNichtSpaeterDurchlauf` (S4b — eine hängende
 * Meldung darf einen inzwischen neueren, schon angewendeten Stand NICHT
 * später still mit ihrem veralteten Anfrage-Snapshot überschreiben) und
 * `zeitlimitEinzelnerLangsamerAbrufDurchlauf` (S4d — ein einzelner, nur
 * langsamer Abruf darf seine eigentlich neue Skala nicht unbemerkt, ohne
 * erneute Anwendung, 200 ms später in die Registry schreiben).
 *
 * Lauf: npx tsx client/test/grundskala-live-wirkung.ts
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import * as ts from 'typescript';
import { uploadedModelRegistry } from '@wov/shared';
import { ladeHochgeladeneRegistrierung } from '../src/net/UploadedModelRegistryLoad';
import { sendeGrundskalaGeaendert, verdrahteGrundskalaLive } from '../src/editor/testflug/grundskalaLive';

let fehler = 0;
function pruefe(bedingung: boolean, text: string): void {
  if (!bedingung) {
    fehler++;
    console.log(`  ABWEICHUNG ${text}`);
  } else {
    console.log(`  ok   ${text}`);
  }
}
function nah(ist: number, soll: number, was: string, eps = 1e-3): void {
  pruefe(Math.abs(ist - soll) < eps, `${was}: ${ist.toFixed(4)} (erwartet ${soll})`);
}

// ── 1) Struktur-Wächter: die WIRKLICHE Verdrahtung in Testflug.ts und
//    GegenstandsKatalog.ts am Quelltext (wie testflug-modul.ts es für andere
//    Eigenschaften der Datei schon tut) — ein voller DOM-Testflug ist für
//    einen DOM-freien Lauf unverhältnismässig, ein stiller Wegfall der
//    Verdrahtung (M2/M5/M6 aus dem Angriffsbericht) darf aber nicht
//    unbemerkt bleiben.
//
//    N1-1 (Nachangriff): Der eigentliche Handler (Registry neu laden,
//    `await`en, `aktualisiereGrundskala`, `flush`) lebt seit dieser Fassung
//    DOM-frei in `verdrahteGrundskalaLive` (`grundskalaLive.ts`) — Abschnitt
//    2 unten importiert und benutzt GENAU diese Funktion, misst die T1/T2-
//    Mutationen also an der echten Wirkung. Was Abschnitt 2 NICHT sehen
//    kann, weil sein eigener Realm-Quelltext `verdrahteGrundskalaLive`
//    unabhängig vom Aufruf in `Testflug.ts` importiert, ist ein fehlender
//    AUFRUF in `Testflug.ts` selbst — das prüft dieser Wächter. ─────────

/** Erstes `ts.FunctionDeclaration` mit diesem Namen, irgendwo im Baum (Tiefensuche). */
function funktion(sf: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
  let treffer: ts.FunctionDeclaration | undefined;
  const geh = (n: ts.Node): void => {
    if (treffer) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      treffer = n;
      return;
    }
    ts.forEachChild(n, geh);
  };
  geh(sf);
  return treffer;
}

/** Alle Knoten unter `wurzel`, die `passt` erfüllen (Tiefensuche, kein Abbruch). */
function alle<T extends ts.Node>(wurzel: ts.Node, passt: (n: ts.Node) => n is T): T[] {
  const treffer: T[] = [];
  const geh = (n: ts.Node): void => {
    if (passt(n)) treffer.push(n);
    ts.forEachChild(n, geh);
  };
  geh(wurzel);
  return treffer;
}

/** Ob ein Pfeil-Ausdruck einen KONZISEN Rumpf hat, der GENAU `<empfaenger>.<name>(<args>)` aufruft. */
function konziserAufrufAn(
  initializer: ts.Expression | undefined,
  empfaenger: string,
  parameterName: string | undefined
): ts.CallExpression | undefined {
  if (!initializer || !ts.isArrowFunction(initializer) || ts.isBlock(initializer.body)) return undefined;
  const rumpf = initializer.body;
  if (!ts.isCallExpression(rumpf) || rumpf.expression.getText() !== empfaenger) return undefined;
  if (parameterName === undefined) return rumpf.arguments.length === 0 ? rumpf : undefined;
  return rumpf.arguments.length === 1 && rumpf.arguments[0]!.getText() === parameterName ? rumpf : undefined;
}

/**
 * N4/N3-1: wie `konziserAufrufAn`, aber für einen Aufruf mit MEHREREN
 * Argumenten, deren Text der Reihe nach GENAU `argTexte` entsprechen muss —
 * für `ladeRegistry: (signal) => ladeHochgeladeneRegistrierung(undefined, signal)`.
 */
function konziserAufrufMitArgumenten(
  initializer: ts.Expression | undefined,
  empfaenger: string,
  argTexte: readonly string[]
): ts.CallExpression | undefined {
  if (!initializer || !ts.isArrowFunction(initializer) || ts.isBlock(initializer.body)) return undefined;
  const rumpf = initializer.body;
  if (!ts.isCallExpression(rumpf) || rumpf.expression.getText() !== empfaenger) return undefined;
  if (rumpf.arguments.length !== argTexte.length) return undefined;
  return rumpf.arguments.every((a, i) => a.getText() === argTexte[i]) ? rumpf : undefined;
}

/** Die nächste Anweisung, in der `n` steckt (Elternkette bis zum ersten `ts.Statement`). */
function umschliessendeAnweisung(n: ts.Node): ts.Statement {
  let s: ts.Node = n;
  while (!ts.isStatement(s)) s = s.parent;
  return s;
}

/**
 * Testflug.ts (N2-3, Syntaxbaum statt Regex — Kopfkommentar): der Aufruf
 * von `verdrahteGrundskalaLive` steht als `const <x> = verdrahteGrundskalaLive(…)`
 * (eine DEKLARATION, keine spätere Zuweisung) und die zugehörige Abmeldung
 * `scene.onDisposeObservable.add(<x>)` steht im SELBEN Block — beides
 * GESCHWISTER-Anweisungen, nicht eine in einem tieferen, eigenen Zweig
 * (Mb: `let x = noop; if (…) x = verdrahteGrundskalaLive(…);` wäre keine
 * Deklaration mit diesem Aufruf als Initializer mehr, sondern eine spätere
 * Zuweisung — fällt schon durch die erste Prüfung unten). Die reale
 * Verdrahtung liegt selbst innerhalb eines `if (testflug && ent)`, das ist
 * ein normaler Laufzeit-Wächter, keine tote Bedingung — deshalb wird HIER
 * nicht auf die oberste Ebene der ganzen Funktion geprüft, sondern auf
 * gemeinsame Geschwisterschaft der beiden Anweisungen.
 */
function strukturWaechterTestflug(): void {
  const pfad = fileURLToPath(new URL('../src/editor/testflug/Testflug.ts', import.meta.url));
  const sf = ts.createSourceFile(pfad, readFileSync(pfad, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const starteTestflugFn = funktion(sf, 'starteTestflug');
  pruefe(!!starteTestflugFn, 'Testflug.ts enthält starteTestflug');
  if (!starteTestflugFn?.body) return;
  const body = starteTestflugFn.body;

  const istVerdrahtungsAufruf = (e: ts.Expression | undefined): e is ts.CallExpression =>
    !!e && ts.isCallExpression(e) && e.expression.getText() === 'verdrahteGrundskalaLive';

  const deklarationen = alle(
    body,
    (n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && istVerdrahtungsAufruf(n.initializer)
  );
  pruefe(
    deklarationen.length === 1,
    `genau eine Deklaration \`const … = verdrahteGrundskalaLive(...)\` (keine spätere Zuweisung, kein toter Zweig — N1-1/N2-3), n=${deklarationen.length}`
  );
  if (deklarationen.length !== 1) return;

  const decl = deklarationen[0]!;
  const call = decl.initializer as ts.CallExpression;
  const abmeldeVar = decl.name.getText();
  const deklarationsBlock = umschliessendeAnweisung(decl).parent;
  const arg = call.arguments[0];
  pruefe(!!arg && ts.isObjectLiteralExpression(arg), 'verdrahteGrundskalaLive wird mit einem Abhängigkeiten-Objekt aufgerufen');
  if (!arg || !ts.isObjectLiteralExpression(arg)) return;

  const prop = (name: string): ts.PropertyAssignment | undefined =>
    arg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name);

  const ladeRegistryProp = prop('ladeRegistry');
  const ladeRegistryArrow =
    ladeRegistryProp && ts.isArrowFunction(ladeRegistryProp.initializer) ? ladeRegistryProp.initializer : undefined;
  const signalParam = ladeRegistryArrow?.parameters[0]?.name.getText();
  pruefe(
    !!signalParam &&
      !!konziserAufrufMitArgumenten(ladeRegistryProp?.initializer, 'ladeHochgeladeneRegistrierung', [
        'undefined',
        signalParam,
      ]),
    'ladeRegistry ist DIREKT an ladeHochgeladeneRegistrierung(undefined, signal) DIESES Fensters gebunden, kein Ersatz-Lambda, das Zeitlimit-/Abmelde-Signal wird durchgereicht (B1/N2-3/N3-1)'
  );

  const aktualisiereProp = prop('aktualisiereGrundskala');
  const aktualisiereArrow =
    aktualisiereProp && ts.isArrowFunction(aktualisiereProp.initializer) ? aktualisiereProp.initializer : undefined;
  const aktualisiereParam = aktualisiereArrow?.parameters[0]?.name.getText();
  pruefe(
    !!konziserAufrufAn(aktualisiereProp?.initializer, 'ent.aktualisiereGrundskala', aktualisiereParam),
    'aktualisiereGrundskala ist an ent.aktualisiereGrundskala gebunden, mit demselben Parameter durchgereicht'
  );

  const flushProp = prop('flush');
  pruefe(!!konziserAufrufAn(flushProp?.initializer, 'ent.flush', undefined), 'flush ist an ent.flush gebunden');

  const abmeldeAufrufe = alle(
    body,
    (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText() === 'scene.onDisposeObservable.add'
  ).filter((c) => c.arguments.length === 1 && c.arguments[0]!.getText() === abmeldeVar);
  pruefe(
    abmeldeAufrufe.length === 1,
    `genau eine Abmeldung scene.onDisposeObservable.add(${abmeldeVar}) im ganzen Testflug-Aufbau (kein Leck)`
  );
  if (abmeldeAufrufe.length === 1) {
    const abmeldeBlock = umschliessendeAnweisung(abmeldeAufrufe[0]!).parent;
    pruefe(
      abmeldeBlock === deklarationsBlock,
      'die Abmeldung steht im SELBEN Block wie die Deklaration (Geschwister-Anweisungen, kein toter Zweig — N2-3)'
    );
  }
}

/** Every source file under `dir`, subfolders included (TypeScript and JavaScript, every module flavour). */
function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFilesUnder(path));
    else if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(path);
  }
  return out.sort();
}

function strukturWaechter(): void {
  strukturWaechterTestflug();
  const katalog = readFileSync(new URL('../src/editor/GegenstandsKatalog.ts', import.meta.url), 'utf-8');

  const fnMatch = /private async grundskalaAendernAusfuehren\([\s\S]*?\n {2}\}/.exec(katalog);
  pruefe(!!fnMatch, 'GegenstandsKatalog.ts enthält grundskalaAendernAusfuehren unverändert auffindbar');
  const fnBody = fnMatch?.[0] ?? '';
  const iGuard = fnBody.indexOf('if (!antwort.ok || !rumpf?.ok)');
  const iSend = fnBody.indexOf('sendeGrundskalaGeaendert(');
  pruefe(iGuard >= 0, 'die PATCH-Antwort wird auf Erfolg geprüft, bevor irgendetwas weiter passiert');
  pruefe(iSend >= 0, 'ein Erfolg wird über den Kanal gemeldet (M6 — „Katalog sendet nie")');
  pruefe(
    iGuard >= 0 && iSend >= 0 && iGuard < iSend,
    'gesendet wird ERST NACH der Erfolgsprüfung, nie vorher (M5 — „Senden auch bei fehlgeschlagenem PATCH")'
  );
  // Scope since refactoring step G1: the catalogue is GegenstandsKatalog.ts AND every source file
  // under client/src/editor/katalog/, subfolders included. What the check demands is unchanged:
  // one send call in all of them together. A missing folder throws, it does not pass.
  const catalogueDir = fileURLToPath(new URL('../src/editor/katalog/', import.meta.url));
  const sendCalls = [
    ['GegenstandsKatalog.ts', katalog] as const,
    ...sourceFilesUnder(catalogueDir).map(
      (file) => [`katalog/${relative(catalogueDir, file).split(sep).join('/')}`, readFileSync(file, 'utf-8')] as const
    ),
  ].map(([name, text]) => [name, (text.match(/sendeGrundskalaGeaendert\(/g) ?? []).length] as const);
  const sendCallsFound = sendCalls.filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`);
  pruefe(
    sendCalls.reduce((sum, [, count]) => sum + count, 0) === 1,
    `genau eine Sendestelle im ganzen Katalog, das sind GegenstandsKatalog.ts und jede Quelldatei unter katalog/ (keine zweite, unkontrollierte): ${sendCallsFound.join(', ') || 'keine'}, gelesen ${sendCalls.length} Dateien`
  );
}

// ── 2) Zwei echte Realms: die Wirkung selbst, gemessen ──────────────────

interface RohMass {
  readonly breite: number;
  readonly hoehe: number;
  readonly tiefe: number;
}
const ROH: RohMass = { breite: 1.0, hoehe: 0.72, tiefe: 0.6 };
const MODEL_NAME = 'U_G1Wirkung';
const KONTROLL_NAME = 'U_G1Kontrolle';
const NIE_GESETZT_NAME = 'U_G1NieGesetzt';

interface RegistryEintrag {
  name: string;
  anzeigename: string;
  bytes: number;
  dreiecke: number;
  meshes: number;
  materialien: number;
  bilder: number;
  fehlendeTexturen: boolean;
  breite: number;
  hoehe: number;
  tiefe: number;
  kollisionsart: 'fest' | 'durchlaessig';
  hatKollisionsnetz: boolean;
  kollisionsnetzAbgelehnt: boolean;
  hochgeladenVon: string;
  zeitpunkt: string;
  grundskala: number;
}
function registryEintrag(name: string, grundskala: number): RegistryEintrag {
  return {
    name,
    anzeigename: name,
    bytes: 1000,
    dreiecke: 12,
    meshes: 1,
    materialien: 1,
    bilder: 0,
    fehlendeTexturen: false,
    breite: ROH.breite,
    hoehe: ROH.hoehe,
    tiefe: ROH.tiefe,
    kollisionsart: 'fest',
    hatKollisionsnetz: false,
    kollisionsnetzAbgelehnt: false,
    hochgeladenVon: 'test',
    zeitpunkt: new Date().toISOString(),
    grundskala,
  };
}

interface HuelleMass {
  readonly breite: number;
  readonly hoehe: number;
  readonly tiefe: number;
}
interface WorkerNachricht {
  readonly typ: 'bereit' | 'nach-aenderung' | 'fehler';
  readonly name?: string;
  readonly ergebnis?: { buckets: number };
  readonly anfangModel?: HuelleMass | null;
  readonly anfangKontroll?: HuelleMass | null;
  readonly nachModel?: HuelleMass | null;
  readonly nachKontroll?: HuelleMass | null;
  readonly nachricht?: string;
}

/**
 * Die "Testflug"-Seite als eigener `worker_thread` — ein eigenes Browser-
 * fenster mit eigenen Modulinstanzen. `eval: true` mit dynamischem
 * `import()`: ein `eval: true`-Worker bootet OHNE Datei-Einstiegspunkt,
 * deshalb wendet Node `--import`/`--require` aus `execArgv` beim Start
 * NICHT an (geprüft: mit `execArgv: process.execArgv` allein blieb
 * `import('@wov/shared')` an `shared/src/index.ts`s eigenem `./constants.js`
 * mit `ERR_MODULE_NOT_FOUND` hängen — der tsx-Loader war nicht aktiv, s.
 * Bericht Nachtrag N1). Der Worker registriert den tsx-ESM-Loader deshalb
 * IN SEINEM EIGENEN Code (`require('tsx/esm/api').register()`, dieselbe
 * Loader-Registrierung wie `--import tsx/dist/loader.mjs`, nur programmatisch
 * und im Worker selbst statt vom Hauptprozess vererbt) — danach geht ein
 * dynamischer `import()` einer `.ts`-Datei durch dieselbe Transformation wie
 * im Hauptthread. Die `@babylonjs/core`-Unterpfade brauchen zusätzlich die
 * `.js`-Endung: Node löst einen bloßen Unterpfad-Bezeichner über den
 * PAKET-eigenen Exports auf, bevor der tsx-Loader greift, und das Paket
 * selbst exportiert nur die `.js`-Dateien. Reine, statische Text-Quelle —
 * alle veränderlichen Werte kommen über `workerData`, damit hier keine
 * Werte in Quelltext eingesetzt werden müssen (keine Interpolation, kein
 * `${`).
 */
const TESTFLUG_REALM = `
const { parentPort, workerData } = require('node:worker_threads');
require('tsx/esm/api').register();

async function haupt() {
  const wd = workerData;
  const [
    { NullEngine },
    { Scene },
    { Mesh },
    { VertexData },
    { TransformNode },
    { AssetContainer },
    { PBRMaterial },
    { Matrix, Vector3 },
  ] = await Promise.all([
    import('@babylonjs/core/Engines/nullEngine.js'),
    import('@babylonjs/core/scene.js'),
    import('@babylonjs/core/Meshes/mesh.js'),
    import('@babylonjs/core/Meshes/mesh.vertexData.js'),
    import('@babylonjs/core/Meshes/transformNode.js'),
    import('@babylonjs/core/assetContainer.js'),
    import('@babylonjs/core/Materials/PBR/pbrMaterial.js'),
    import('@babylonjs/core/Maths/math.vector.js'),
  ]);
  await import('@babylonjs/core/Meshes/thinInstanceMesh.js');

  const shared = await import('@wov/shared');
  const uploadedModelRegistry = shared.uploadedModelRegistry;
  const getStableHash = shared.getStableHash;
  const AssetManager = (await import(wd.assetManagerUrl)).AssetManager;
  const EntityManager = (await import(wd.entityManagerUrl)).EntityManager;
  const ladeHochgeladeneRegistrierung = (await import(wd.registryLoadUrl)).ladeHochgeladeneRegistrierung;
  const verdrahteGrundskalaLive = (await import(wd.grundskalaLiveUrl)).verdrahteGrundskalaLive;

  const engine = new NullEngine();
  const scene = new Scene(engine);
  const roh = wd.roh;

  function baueContainer(name) {
    const wurzel = new TransformNode(name + '_root', scene);
    const mesh = new Mesh('Sicht_' + name, scene);
    const d = new VertexData();
    const p = [];
    for (const x of [0, roh.breite]) for (const y of [0, roh.hoehe]) for (const z of [0, roh.tiefe]) p.push(x, y, z);
    d.positions = p;
    d.indices = [
      0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
      2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
    ];
    d.applyToMesh(mesh);
    mesh.material = new PBRMaterial(name + '_mat', scene);
    mesh.parent = wurzel;
    const container = new AssetContainer(scene);
    container.meshes.push(mesh);
    container.transformNodes.push(wurzel);
    container.removeAllFromScene();
    return container;
  }

  function huelle(localMatrix, world) {
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    const kombiniert = localMatrix.multiply(world);
    for (const x of [0, roh.breite]) for (const y of [0, roh.hoehe]) for (const z of [0, roh.tiefe]) {
      const t = Vector3.TransformCoordinates(new Vector3(x, y, z), kombiniert);
      min = Vector3.Minimize(min, t);
      max = Vector3.Maximize(max, t);
    }
    return { breite: max.x - min.x, hoehe: max.y - min.y, tiefe: max.z - min.z };
  }

  function bucketVon(mgr, prefabName) {
    for (const b of mgr.buckets.values()) if (b.prefabName === prefabName) return b;
    return undefined;
  }

  function messeHuelle(mgr, prefabName, masterKey) {
    const bucket = bucketVon(mgr, prefabName);
    if (!bucket || bucket.matrices.length < 16) return null;
    const locals = mgr.masterLocals.get(masterKey);
    if (!locals || locals.length === 0) return null;
    const world = Matrix.FromArray(bucket.matrices, 0);
    return huelle(locals[0], world);
  }

  function wartenBis(bedingung, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const schleife = () => {
        if (bedingung()) return resolve(undefined);
        if (Date.now() - start > timeoutMs) return reject(new Error('Zeitüberschreitung beim Warten'));
        setTimeout(schleife, 5);
      };
      schleife();
    });
  }

  // ── Erstes Laden: wie main.ts vor dem ersten Katalogaufbau ───────────
  await ladeHochgeladeneRegistrierung(wd.registryUrl);

  const assets = new AssetManager(scene);
  const modelPfad = uploadedModelRegistry.UPLOAD_MODEL_PREFIX + wd.modelName;
  const kontrollPfad = uploadedModelRegistry.UPLOAD_MODEL_PREFIX + wd.kontrollName;
  assets.containers.set(modelPfad, Promise.resolve(baueContainer(wd.modelName)));
  assets.containers.set(kontrollPfad, Promise.resolve(baueContainer(wd.kontrollName)));

  const ent = new EntityManager(null, null, assets, null);
  const hashModel = getStableHash(wd.modelName);
  const hashKontroll = getStableHash(wd.kontrollName);

  ent.applyStatic(
    { key: 'a1', prefabHash: hashModel, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, isOwnPlayer: false },
    wd.modelName,
    modelPfad
  );
  ent.applyStatic(
    { key: 'b1', prefabHash: hashKontroll, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, isOwnPlayer: false },
    wd.kontrollName,
    kontrollPfad
  );

  await wartenBis(() => {
    const bA = bucketVon(ent, wd.modelName);
    const bB = bucketVon(ent, wd.kontrollName);
    return !!(bA && bA.mastersReady) && !!(bB && bB.mastersReady);
  }, 5000);

  const anfangModel = messeHuelle(ent, wd.modelName, wd.modelName);
  const anfangKontroll = messeHuelle(ent, wd.kontrollName, wd.kontrollName);
  parentPort.postMessage({ typ: 'bereit', anfangModel: anfangModel, anfangKontroll: anfangKontroll });

  // ── N1-1: DIESELBE Funktion wie Testflug.ts, nicht nachgebaut — eine
  // Mutation in verdrahteGrundskalaLive (T1: await/Kette weggelassen, T2:
  // Praefix weggelassen) wirkt hier genauso wie im echten Testflug. Die
  // Abhaengigkeiten binden wie in Testflug.ts an die Realm-eigene Registry
  // und den Realm-eigenen EntityManager; flush misst und meldet, weil es
  // hier (anders als bei ent.flush() im echten Fenster) auch der Punkt
  // ist, an dem die Wirkung sichtbar wird. Keine Backticks in diesem
  // Abschnitt (Kopfkommentar der Datei: reine, statische Text-Quelle,
  // ein Backtick wuerde das umgebende Template-Literal vorzeitig
  // schliessen). ──────────────────────────────────────────────────────
  let letzterModelPfad = '';
  let letztesErgebnis;
  verdrahteGrundskalaLive({
    ladeRegistry: () => ladeHochgeladeneRegistrierung(wd.registryUrl),
    aktualisiereGrundskala: async (model) => {
      letzterModelPfad = model;
      letztesErgebnis = await ent.aktualisiereGrundskala(model);
      return letztesErgebnis;
    },
    flush: () => {
      const name = letzterModelPfad.slice(uploadedModelRegistry.UPLOAD_MODEL_PREFIX.length);
      const nachModel = messeHuelle(ent, wd.modelName, wd.modelName);
      const nachKontroll = messeHuelle(ent, wd.kontrollName, wd.kontrollName);
      parentPort.postMessage({ typ: 'nach-aenderung', name: name, ergebnis: letztesErgebnis, nachModel: nachModel, nachKontroll: nachKontroll });
    },
  });
}

haupt().catch((e) => {
  parentPort.postMessage({ typ: 'fehler', nachricht: String((e && e.stack) || e) });
});
`;

/** Genau eine Nachricht vom Worker abwarten, die `passt` erfüllt — mit Zeitlimit und Fehlerweiterleitung. */
function warteAufNachricht(
  worker: Worker,
  passt: (m: WorkerNachricht) => boolean,
  timeoutMs = 15_000
): Promise<WorkerNachricht> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off('message', hoerer);
      reject(new Error('Zeitüberschreitung beim Warten auf eine Nachricht vom Testflug-Realm'));
    }, timeoutMs);
    const hoerer = (m: WorkerNachricht): void => {
      if (m.typ === 'fehler') {
        clearTimeout(timeout);
        worker.off('message', hoerer);
        reject(new Error(`Testflug-Realm meldet Fehler: ${m.nachricht}`));
        return;
      }
      if (!passt(m)) return;
      clearTimeout(timeout);
      worker.off('message', hoerer);
      resolve(m);
    };
    worker.on('message', hoerer);
  });
}

async function realmLauf(): Promise<void> {
  const registry: RegistryEintrag[] = [registryEintrag(MODEL_NAME, 1), registryEintrag(KONTROLL_NAME, 1)];
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: 1, modelle: registry }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const registryUrl = `http://127.0.0.1:${port}/registry.json`;

  const workerData = {
    registryUrl,
    modelName: MODEL_NAME,
    kontrollName: KONTROLL_NAME,
    roh: ROH,
    assetManagerUrl: new URL('../src/engine/AssetManager.ts', import.meta.url).href,
    entityManagerUrl: new URL('../src/entities/EntityManager.ts', import.meta.url).href,
    registryLoadUrl: new URL('../src/net/UploadedModelRegistryLoad.ts', import.meta.url).href,
    grundskalaLiveUrl: new URL('../src/editor/testflug/grundskalaLive.ts', import.meta.url).href,
  };

  const worker = new Worker(TESTFLUG_REALM, { eval: true, workerData, execArgv: process.execArgv });
  worker.on('error', (e) => console.error('  [worker error]', e));

  try {
    const bereit = await warteAufNachricht(worker, (m) => m.typ === 'bereit');
    pruefe(!!bereit.anfangModel, 'Zielmodell im Testflug-Realm gesetzt und geladen (Vorbedingung)');
    pruefe(!!bereit.anfangKontroll, 'Kontrollmodell im Testflug-Realm gesetzt und geladen (Vorbedingung)');
    if (bereit.anfangModel) {
      nah(bereit.anfangModel.breite, ROH.breite, 'Zielmodell vor der Änderung — Breite (Grundskala 1)');
      nah(bereit.anfangModel.hoehe, ROH.hoehe, 'Zielmodell vor der Änderung — Höhe (Grundskala 1)');
      nah(bereit.anfangModel.tiefe, ROH.tiefe, 'Zielmodell vor der Änderung — Tiefe (Grundskala 1)');
    }

    // ── Die "Katalog"-Seite (dieser Prozess): PATCH simulieren — den
    // Betriebsdienst-Stand ändern UND über den ECHTEN Kanal melden, exakt
    // wie GegenstandsKatalog.grundskalaAendernAusfuehren es nach einer
    // erfolgreichen Antwort tut. ─────────────────────────────────────
    const NEUE_GRUNDSKALA = 4;
    registry[0] = registryEintrag(MODEL_NAME, NEUE_GRUNDSKALA);
    sendeGrundskalaGeaendert(MODEL_NAME, NEUE_GRUNDSKALA);

    const nachA = await warteAufNachricht(worker, (m) => m.typ === 'nach-aenderung' && m.name === MODEL_NAME);
    pruefe(nachA.ergebnis?.buckets === 1, `aktualisiereGrundskala meldet einen betroffenen Bucket (${nachA.ergebnis?.buckets})`);
    pruefe(!!nachA.nachModel, 'Zielmodell nach der Änderung weiterhin messbar');
    pruefe(!!nachA.nachKontroll, 'Kontrollmodell nach der Änderung weiterhin messbar');
    if (nachA.nachModel) {
      nah(nachA.nachModel.breite, ROH.breite * NEUE_GRUNDSKALA, 'Zielmodell NACH der Änderung — Breite (B1: wirkt im zweiten Realm)');
      nah(nachA.nachModel.hoehe, ROH.hoehe * NEUE_GRUNDSKALA, 'Zielmodell NACH der Änderung — Höhe');
      nah(nachA.nachModel.tiefe, ROH.tiefe * NEUE_GRUNDSKALA, 'Zielmodell NACH der Änderung — Tiefe');
    }
    if (nachA.nachKontroll && bereit.anfangKontroll) {
      nah(nachA.nachKontroll.breite, bereit.anfangKontroll.breite, 'Kontrollmodell UNBERÜHRT (nur der gemeldete Bucket ändert sich, M3)');
    }

    // ── B3: eine Meldung für ein im Testflug NIE gesetztes Modell darf
    // nichts laden und keinen Bucket betreffen — nur die Registry wird
    // aktualisiert. `NIE_GESETZT_NAME` wurde in DIESEM Realm nie platziert
    // UND steht auch gar nicht in der (frei erfundenen) Registry-Antwort —
    // ein fehlgeschlagener B3-Wächter würde hier versuchen, eine echte GLB
    // für ein unbekanntes Modell zu laden. ─────────────────────────────
    sendeGrundskalaGeaendert(NIE_GESETZT_NAME, 2);
    const nachC = await warteAufNachricht(worker, (m) => m.typ === 'nach-aenderung' && m.name === NIE_GESETZT_NAME);
    pruefe(nachC.ergebnis?.buckets === 0, `nie gesetztes Modell: kein Bucket betroffen (B3), Ergebnis ${JSON.stringify(nachC.ergebnis)}`);
  } finally {
    await worker.terminate().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ── 3) N3 (Karte G1 N3, Auftrag 2): der ECHTE `ladeHochgeladeneRegistrierung`
//    gegen eine STEUERBARE HTTP-Attrappe (kein werfender Ersatz für
//    `uebernehmen` — der echte Lader wirft nie, ein Test, der das
//    voraussetzt, prüft ein Verhalten, das es im Produkt nicht gibt, N2-1).
//    Beide Realms hier sind derselbe Prozess (kein `worker_thread` nötig —
//    anders als Abschnitt 2 geht es nicht um zwei getrennte Browser-Tabs,
//    sondern um den echten Netzweg). Gemessen wird die TATSÄCHLICH
//    angewendete Grundskala über `uploadedModelRegistry.grundskalaFuerModell`
//    — denselben Weg, den auch `AssetManager` benutzt. ───────────────────

interface RegistryAttrappe {
  readonly url: string;
  readonly zustand: {
    registry: RegistryEintrag[];
    verzoegerungMs: number;
    antwort500: number;
    anfragen: number;
    /** N4/N3-1 (S4b): wie oft eine Anfrage endete, WEIL der Client die Verbindung abgebrochen hat, bevor eine Antwort geschrieben war. */
    abbrueche: number;
  };
  close(): Promise<void>;
}

/** Eine steuerbare HTTP-Attrappe für `registry.json`: Wert, Verzögerung und ein einmaliger 500 lassen sich je Anfrage vorgeben. */
function starteRegistryAttrappe(anfangsEintraege: RegistryEintrag[]): Promise<RegistryAttrappe> {
  const zustand = { registry: anfangsEintraege, verzoegerungMs: 0, antwort500: 0, anfragen: 0, abbrueche: 0 };
  const server = createServer((req, res) => {
    zustand.anfragen++;
    // N4/N3-1: der Server sieht den Verbindungsabbruch eines abgebrochenen
    // `fetch` als `req`-„close" VOR einer fertig geschriebenen Antwort —
    // genau das zählt die Attrappe hier (Probe S4b: „die Attrappe zählt
    // den Abbruch").
    res.on('error', () => {}); // ein Schreibversuch nach dem Abbruch darf den Prozess nicht mit einer unbehandelten Ausnahme beenden
    req.on('close', () => {
      if (!res.writableEnded) zustand.abbrueche++;
    });
    // Momentaufnahme JETZT (Anfrageeingang), nicht erst beim Antworten —
    // wie ein echter Server, der die Datei beim Eintreffen der Anfrage
    // liest: eine VERZÖGERTE Antwort liefert sonst den WERT einer später
    // eingetroffenen Anfrage, sobald `zustand.registry` inzwischen
    // weitergeschaltet wurde, und würde damit genau den Race, den Test B
    // (N2-2) prüfen soll, verdecken statt ihn nachzustellen.
    const istFehler = zustand.antwort500 > 0;
    if (istFehler) zustand.antwort500--;
    const koerper = istFehler ? null : JSON.stringify({ version: 1, modelle: zustand.registry });
    const antworten = (): void => {
      // N4/N3-1: die Verbindung kann inzwischen (Client-Abbruch) schon zu
      // sein — dann NICHT mehr schreiben, sonst wirft `res.end` in einen
      // bereits geschlossenen Socket.
      if (res.writableEnded || res.destroyed) return;
      if (istFehler) {
        res.writeHead(500);
        res.end('simulierter Serverfehler');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(koerper!);
    };
    if (zustand.verzoegerungMs > 0) {
      const ms = zustand.verzoegerungMs;
      zustand.verzoegerungMs = 0;
      setTimeout(antworten, ms);
    } else {
      antworten();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/registry.json`,
        zustand,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Wartet, bis `bedingung` zutrifft oder `timeoutMs` um sind — bricht NIE mit einem Fehler ab (die Prüfung danach zeigt einen Zeitablauf als Abweichung, nicht als Absturz). */
async function warteOderZeitlimit(bedingung: () => boolean, timeoutMs: number, schrittMs = 5): Promise<void> {
  const start = Date.now();
  while (!bedingung() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, schrittMs));
  }
}

/**
 * N2-1: HTTP 500, danach dieselbe Meldung erneut — muss ZWEI Abrufe
 * auslösen und am Ende die richtige Grundskala stehen haben. Der
 * fehlgeschlagene erste Abruf darf den Wert nicht dauerhaft sperren.
 */
async function fehlschlagUndWiederholungDurchlauf(): Promise<void> {
  const NAME = 'U_G1N3Retry';
  const modelPfad = uploadedModelRegistry.UPLOAD_MODEL_PREFIX + NAME;
  const attrappe = await starteRegistryAttrappe([registryEintrag(NAME, 1)]);
  try {
    await ladeHochgeladeneRegistrierung(attrappe.url); // Erstregistrierung, wie main.ts vor dem ersten Katalogaufbau
    const anfragenVorMeldung = attrappe.zustand.anfragen;

    const abmelden = verdrahteGrundskalaLive({
      ladeRegistry: () => ladeHochgeladeneRegistrierung(attrappe.url),
      aktualisiereGrundskala: async () => {},
      flush: () => {},
    });
    try {
      // Der Katalog hat den Server schon auf 5 gepatcht und meldet es —
      // der ERSTE Abruf danach scheitert (Server kurz nicht erreichbar).
      attrappe.zustand.registry = [registryEintrag(NAME, 5)];
      attrappe.zustand.antwort500 = 1;
      sendeGrundskalaGeaendert(NAME, 5);
      await warteOderZeitlimit(() => attrappe.zustand.anfragen >= anfragenVorMeldung + 1, 2000);
      await new Promise((r) => setTimeout(r, 50));
      pruefe(
        uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 1,
        `nach dem HTTP 500 bleibt die alte Grundskala stehen (${uploadedModelRegistry.grundskalaFuerModell(modelPfad)})`
      );

      // Dieselbe Meldung erneut (Katalog-Wiederholung oder zweiter Tab) —
      // MUSS einen neuen Abruf auslösen: kein Wert-Duplikatfilter mehr
      // (N2-1 — der erste, fehlgeschlagene Abruf darf denselben Wert nicht
      // für immer sperren; der echte Lader wirft dabei nie, s. Kopfkommentar).
      sendeGrundskalaGeaendert(NAME, 5);
      await warteOderZeitlimit(() => attrappe.zustand.anfragen >= anfragenVorMeldung + 2, 2000);
      await new Promise((r) => setTimeout(r, 50));

      pruefe(
        attrappe.zustand.anfragen === anfragenVorMeldung + 2,
        `genau 2 Abrufe nach der Meldung (500, dann Erfolg), N2-1: ${attrappe.zustand.anfragen - anfragenVorMeldung}`
      );
      pruefe(
        uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 5,
        `nach der Wiederholung stimmt die Grundskala (N2-1): ${uploadedModelRegistry.grundskalaFuerModell(modelPfad)}`
      );
    } finally {
      abmelden();
    }
  } finally {
    await attrappe.close();
    if (uploadedModelRegistry.uploadedModelEntry(NAME)) uploadedModelRegistry.unregisterUploadedPrefab(NAME);
  }
}

/**
 * N2-2: 4 wird erfolgreich übernommen, dann kommt 1 mit einem LANGSAMEN
 * Abruf, und während der noch läuft, meldet der Katalog erneut 4 — muss
 * bei 4 enden (der vorherige Duplikatfilter verglich beim EMPFANG gegen
 * einen Stand, der erst nach Abarbeitung galt, und verwarf die zweite 4
 * fälschlich als Duplikat der ERSTEN).
 */
async function reihenfolgeMitLangsamemAbrufDurchlauf(): Promise<void> {
  const NAME = 'U_G1N3Order';
  const modelPfad = uploadedModelRegistry.UPLOAD_MODEL_PREFIX + NAME;
  const attrappe = await starteRegistryAttrappe([registryEintrag(NAME, 1)]);
  try {
    await ladeHochgeladeneRegistrierung(attrappe.url); // Erstregistrierung

    const abmelden = verdrahteGrundskalaLive({
      ladeRegistry: () => ladeHochgeladeneRegistrierung(attrappe.url),
      aktualisiereGrundskala: async () => {},
      flush: () => {},
    });
    try {
      attrappe.zustand.registry = [registryEintrag(NAME, 4)];
      sendeGrundskalaGeaendert(NAME, 4);
      await warteOderZeitlimit(() => uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 4, 1000);
      pruefe(
        uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 4,
        `erste Meldung (4) angewendet, bevor die zweite beginnt (${uploadedModelRegistry.grundskalaFuerModell(modelPfad)})`
      );

      const VERZOEGERUNG_MS = 150;
      attrappe.zustand.registry = [registryEintrag(NAME, 1)];
      attrappe.zustand.verzoegerungMs = VERZOEGERUNG_MS;
      sendeGrundskalaGeaendert(NAME, 1);
      // Während der Abruf zu "1" noch läuft (Verzögerung), meldet der
      // Katalog erneut 4 — genau der Angriffsfall N2-2.
      await new Promise((r) => setTimeout(r, 20));
      attrappe.zustand.registry = [registryEintrag(NAME, 4)];
      sendeGrundskalaGeaendert(NAME, 4);

      // FESTE Wartezeit statt Polling auf "=== 4": die Grundskala steht
      // zwischenzeitlich schon auf 4 (Rest von der ersten Meldung, noch
      // nicht durch die zweite auf 1 überschrieben) — ein Polling auf
      // "=== 4" würde deshalb sofort (fälschlich) anschlagen, BEVOR der
      // langsame Abruf überhaupt fertig ist. Reserve: die Verzögerung
      // plus genug Zeit für den dritten, schnellen Abruf danach.
      await new Promise((r) => setTimeout(r, VERZOEGERUNG_MS + 150));
      pruefe(
        uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 4,
        `4 übernommen, dann 1 mit langsamem Abruf, dann 4 (N2-2) — endet bei 4: ${uploadedModelRegistry.grundskalaFuerModell(modelPfad)}`
      );
    } finally {
      abmelden();
    }
  } finally {
    await attrappe.close();
    if (uploadedModelRegistry.uploadedModelEntry(NAME)) uploadedModelRegistry.unregisterUploadedPrefab(NAME);
  }
}

/**
 * N4 (Karte G1 N4, Auftrag 1, Probe S4b): eine Meldung hängt über das
 * Zeitlimit hinaus (der Server verzögert die Antwort länger als das
 * Zeitlimit), eine ZWEITE, schnelle Meldung kommt kurz danach — muss den
 * aktuellen Stand übernehmen. Kommt die LÄNGST ÜBERHOLTE Antwort auf die
 * erste Meldung dann doch noch an (Angriffsbefund N3-1: ohne Abbruch lief
 * der `fetch` im Hintergrund weiter und überschrieb den neueren Stand
 * später mit dem beim Anfrageeingang eingefrorenen, VERALTETEN Wert), darf
 * sie den Stand NICHT mehr überschreiben — der Abruf ist abgebrochen, die
 * Attrappe zählt den Abbruch.
 */
async function zeitlimitUeberschreibtNichtSpaeterDurchlauf(): Promise<void> {
  const NAME = 'U_G1N4Timeout';
  const modelPfad = uploadedModelRegistry.UPLOAD_MODEL_PREFIX + NAME;
  const attrappe = await starteRegistryAttrappe([registryEintrag(NAME, 1)]);
  const ZEITLIMIT_MS = 80;
  try {
    await ladeHochgeladeneRegistrierung(attrappe.url); // Erstregistrierung, wie main.ts vor dem ersten Katalogaufbau

    const abmelden = verdrahteGrundskalaLive(
      {
        ladeRegistry: (signal) => ladeHochgeladeneRegistrierung(attrappe.url, signal),
        aktualisiereGrundskala: async () => {},
        flush: () => {},
      },
      ZEITLIMIT_MS
    );
    try {
      // Meldung 2: der Server verzögert die Antwort deutlich über das
      // Zeitlimit hinaus (500 ms) — muss beim Zeitlimit abgebrochen werden.
      attrappe.zustand.registry = [registryEintrag(NAME, 2)];
      attrappe.zustand.verzoegerungMs = 500;
      sendeGrundskalaGeaendert(NAME, 2);
      await new Promise((r) => setTimeout(r, ZEITLIMIT_MS + 50));

      // Meldung 3, kurz danach: schnelle Antwort, MUSS den aktuellen Stand
      // (3) übernehmen — die hängende Meldung 2 darf die Kette nicht
      // blockiert haben.
      attrappe.zustand.registry = [registryEintrag(NAME, 3)];
      sendeGrundskalaGeaendert(NAME, 3);
      await warteOderZeitlimit(() => uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 3, 1000);
      pruefe(
        uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 3,
        `Meldung 3 (schnell) wird trotz hängender Meldung 2 übernommen (${uploadedModelRegistry.grundskalaFuerModell(modelPfad)})`
      );

      // Die längst überholte Antwort auf Meldung 2 (Server schreibt sie
      // nach 500 ms) darf jetzt NICHT mehr eintreffen und den Stand 3 mit
      // dem veralteten Stand 2 überschreiben (N3-1, S4b).
      await new Promise((r) => setTimeout(r, 550));
      pruefe(
        uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 3,
        `die späte, abgebrochene Antwort auf Meldung 2 überschreibt den neueren Stand 3 NICHT mit dem veralteten Stand 2 (N3-1, S4b): ${uploadedModelRegistry.grundskalaFuerModell(modelPfad)}`
      );
      pruefe(
        attrappe.zustand.abbrueche >= 1,
        `die Attrappe sieht den Verbindungsabbruch der Meldung-2-Anfrage (N3-1, S4b): abbrueche=${attrappe.zustand.abbrueche}`
      );
    } finally {
      abmelden();
    }
  } finally {
    await attrappe.close();
    if (uploadedModelRegistry.uploadedModelEntry(NAME)) uploadedModelRegistry.unregisterUploadedPrefab(NAME);
  }
}

/**
 * N4 (Karte G1 N4, Auftrag 1, Probe S4d): EIN einzelner Abruf über dem
 * Zeitlimit (nicht hängend, nur langsam — 500 ms bei 300 ms Limit). Beim
 * Zeitlimit macht die Kette mit dem zu diesem Zeitpunkt bekannten
 * (alten) Stand weiter (N2-4, unverändert). Die eigentlich neue Skala darf
 * aber NICHT 200 ms später still, ohne dass sie je angewendet wird, in der
 * Registry landen (Angriffsbefund N3-1: vorher endete die Registry bei 2,
 * ohne dass `aktualisiereGrundskala` je mit diesem Stand lief — Registry
 * und Szene liefen auseinander).
 */
async function zeitlimitEinzelnerLangsamerAbrufDurchlauf(): Promise<void> {
  const NAME = 'U_G1N4Einzel';
  const modelPfad = uploadedModelRegistry.UPLOAD_MODEL_PREFIX + NAME;
  const attrappe = await starteRegistryAttrappe([registryEintrag(NAME, 1)]);
  const ZEITLIMIT_MS = 300;
  try {
    await ladeHochgeladeneRegistrierung(attrappe.url); // Erstregistrierung (Stand 1)
    const aktualisiereAufrufe: string[] = [];
    const abmelden = verdrahteGrundskalaLive(
      {
        ladeRegistry: (signal) => ladeHochgeladeneRegistrierung(attrappe.url, signal),
        aktualisiereGrundskala: async (model) => {
          aktualisiereAufrufe.push(model);
        },
        flush: () => {},
      },
      ZEITLIMIT_MS
    );
    try {
      attrappe.zustand.registry = [registryEintrag(NAME, 2)];
      attrappe.zustand.verzoegerungMs = 500; // > ZEITLIMIT_MS
      sendeGrundskalaGeaendert(NAME, 2);
      await new Promise((r) => setTimeout(r, ZEITLIMIT_MS + 50));
      pruefe(
        aktualisiereAufrufe.length === 1 && aktualisiereAufrufe[0] === modelPfad,
        `beim Zeitlimit macht die Kette mit dem bekannten Stand weiter, N2-4 unverändert (S4d): ${JSON.stringify(aktualisiereAufrufe)}`
      );
      pruefe(
        uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 1,
        `beim Zeitlimit steht die Registry noch auf dem alten Stand (S4d): ${uploadedModelRegistry.grundskalaFuerModell(modelPfad)}`
      );

      // Die eigentliche Antwort (200 ms später als das Zeitlimit) darf
      // jetzt NICHT mehr eintreffen und still, unbemerkt, in der Registry
      // landen (N3-1, S4d).
      await new Promise((r) => setTimeout(r, 250));
      pruefe(
        uploadedModelRegistry.grundskalaFuerModell(modelPfad) === 1,
        `die verspätete Antwort landet nicht mehr still, ohne erneute Anwendung, in der Registry (N3-1, S4d): ${uploadedModelRegistry.grundskalaFuerModell(modelPfad)}`
      );
      pruefe(
        attrappe.zustand.abbrueche >= 1,
        `die Attrappe sieht den Verbindungsabbruch (N3-1, S4d): abbrueche=${attrappe.zustand.abbrueche}`
      );
    } finally {
      abmelden();
    }
  } finally {
    await attrappe.close();
    if (uploadedModelRegistry.uploadedModelEntry(NAME)) uploadedModelRegistry.unregisterUploadedPrefab(NAME);
  }
}

async function haupt(): Promise<void> {
  strukturWaechter();
  await realmLauf();
  await fehlschlagUndWiederholungDurchlauf();
  await reihenfolgeMitLangsamemAbrufDurchlauf();
  await zeitlimitUeberschreibtNichtSpaeterDurchlauf();
  await zeitlimitEinzelnerLangsamerAbrufDurchlauf();
  console.log(fehler === 0 ? 'OK — grundskala-live-wirkung' : `${fehler} ABWEICHUNGEN`);
  process.exit(fehler > 0 ? 1 : 0);
}

void haupt();
