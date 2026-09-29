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
 * Lauf: npx tsx client/test/grundskala-live-wirkung.ts
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { sendeGrundskalaGeaendert } from '../src/editor/testflug/grundskalaLive';

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

function strukturWaechter(): void {
  const testflug = readFileSync(new URL('../src/editor/testflug/Testflug.ts', import.meta.url), 'utf-8');
  const katalog = readFileSync(new URL('../src/editor/GegenstandsKatalog.ts', import.meta.url), 'utf-8');

  pruefe(
    (testflug.match(/\bverdrahteGrundskalaLive\(/g) ?? []).length === 1,
    'Testflug.ts ruft verdrahteGrundskalaLive(...) genau einmal auf (N1-1 — „Aufruf fehlt")'
  );
  const handlerMatch = /verdrahteGrundskalaLive\(\{([\s\S]*?)\}\);/.exec(testflug);
  pruefe(!!handlerMatch, 'Testflug.ts ruft verdrahteGrundskalaLive(...) mit einem Abhängigkeiten-Objekt auf');
  const handlerBody = handlerMatch?.[1] ?? '';
  pruefe(
    /ladeRegistry:\s*\(\)\s*=>\s*ladeHochgeladeneRegistrierung\(\)/.test(handlerBody),
    'ladeRegistry ist an ladeHochgeladeneRegistrierung DIESES Fensters gebunden (B1)'
  );
  pruefe(
    /aktualisiereGrundskala:\s*\(model\)\s*=>\s*ent\.aktualisiereGrundskala\(model\)/.test(handlerBody),
    'aktualisiereGrundskala ist an ent.aktualisiereGrundskala gebunden'
  );
  pruefe(/flush:\s*\(\)\s*=>\s*ent\.flush\(\)/.test(handlerBody), 'flush ist an ent.flush gebunden');
  pruefe(
    testflug.includes('scene.onDisposeObservable.add(grundskalaAbmelden)'),
    'Testflug.ts meldet den Kanal beim Verwerfen der Szene wieder ab (kein Leck)'
  );

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
  pruefe(
    (katalog.match(/sendeGrundskalaGeaendert\(/g) ?? []).length === 1,
    'genau eine Sendestelle im ganzen Katalog (keine zweite, unkontrollierte)'
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

async function haupt(): Promise<void> {
  strukturWaechter();
  await realmLauf();
  console.log(fehler === 0 ? 'OK — grundskala-live-wirkung' : `${fehler} ABWEICHUNGEN`);
  process.exit(fehler > 0 ? 1 : 0);
}

void haupt();
