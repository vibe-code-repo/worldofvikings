/**
 * G1 N1 (Nachbesserung nach Angriff, Befunde B1/B2/B3/B6): `EntityManager.
 * aktualisiereGrundskala` ruft `assets.getMasters(model)` erneut auf und
 * markiert NUR die Buckets DIESES Modells `dirty` — ein anderes, schon
 * gesetztes Modell bleibt unberührt (M3). DOM-frei wie `entity-index.ts`:
 * kein Szene-Zugriff, weil `applyStatic()` mit `steinKitOverride === ''`
 * keine Master klont.
 *
 * Angriffsbefund zur VORHERIGEN Fassung: `fakeAssets().getMasters` lieferte
 * immer `Matrix.Identity()` und die Zusicherung zu B4/M4
 * (`calls.includes(modelA)`) war immer wahr, weil `modelA` schon vom
 * Aufbau in `calls` stand — ein entfernter erneuter Aufruf blieb dadurch
 * unentdeckt (M4). Diese Fassung zählt AB einem Rücksetzpunkt und prüft die
 * echten Nebenwirkungen von `aktualisiereGrundskala` (Collider-Cache,
 * `colliderless`, KEIN Ladeversuch für ein nie gesetztes Modell) statt nur
 * die Bucket-Markierung — eine echte Maßänderung am Loader selbst (die
 * Attrappe hier liefert weiterhin keine Geometrie) ist mit realer GLB-
 * Ersatzgeometrie in `client/test/upload-grundskala-neu-anwenden.ts` und mit
 * zwei echten Realms in `client/test/grundskala-live-wirkung.ts` belegt.
 *
 * Lauf: npx tsx client/test/entity-grundskala.ts
 */
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { getStableHash, uploadedModelRegistry } from '@wov/shared';
import { EntityManager } from '../src/entities/EntityManager';
import type { AssetManager, PrefabMaster } from '../src/engine/AssetManager';
import type { ZDOEntityUpdate } from '../src/net/ZDOSync';

let fehler = 0;
function pruefe(bedingung: boolean, text: string): void {
  if (!bedingung) {
    fehler++;
    console.log(`  ABWEICHUNG ${text}`);
  }
}

function eintrag(name: string): uploadedModelRegistry.UploadedModelEntry {
  return {
    name,
    anzeigename: name,
    bytes: 1000,
    dreiecke: 10,
    meshes: 1,
    materialien: 1,
    bilder: 0,
    fehlendeTexturen: false,
    breite: 1,
    hoehe: 1,
    tiefe: 1,
    kollisionsart: 'fest',
    hatKollisionsnetz: false,
    kollisionsnetzAbgelehnt: false,
    hochgeladenVon: 'test',
    zeitpunkt: new Date().toISOString(),
  };
}

// Zwei registrierte Uploads — A wird per aktualisiereGrundskala angestossen, B bleibt Kontrolle.
const eintragA = eintrag('U_G1TestA');
const eintragB = eintrag('U_G1TestB');
uploadedModelRegistry.registerUploadedPrefab(eintragA);
uploadedModelRegistry.registerUploadedPrefab(eintragB);
const modelA = `${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}${eintragA.name}`;
const modelB = `${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}${eintragB.name}`;
const hashA = getStableHash(eintragA.name);
const hashB = getStableHash(eintragB.name);

function fakeMaster(): PrefabMaster {
  return { mesh: {} as unknown as Mesh, localMatrix: Matrix.Identity(), nurKollision: false };
}

/**
 * `mastersSofort` bildet den ECHTEN `AssetManager`-Vertrag nach: `null`, bis
 * `getMasters` für den Namen mindestens einmal durchgelaufen ist — genau
 * die Unterscheidung, die die B3-Wache in `aktualisiereGrundskala` braucht
 * (Kopfkommentar dort). Ein Modell, das nie gesetzt wurde, ruft in diesem
 * Test niemals `getMasters` auf und bleibt deshalb auch nie `geladen`.
 */
function fakeAssets(): { calls: string[]; assets: AssetManager } {
  const calls: string[] = [];
  const geladen = new Set<string>();
  const assets = {
    getMasters: async (name: string): Promise<PrefabMaster[]> => {
      calls.push(name);
      geladen.add(name);
      return [fakeMaster()];
    },
    mastersSofort: (name: string): PrefabMaster[] | null => (geladen.has(name) ? [fakeMaster()] : null),
  } as unknown as AssetManager;
  return { calls, assets };
}

function setze(mgr: EntityManager, key: string, prefab: string, hash: number, model: string): void {
  const u: ZDOEntityUpdate = {
    key,
    prefabHash: hash,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    isOwnPlayer: false,
  };
  (
    mgr as unknown as {
      applyStatic: (u: ZDOEntityUpdate, p: string, m: string | null) => void;
    }
  ).applyStatic(u, prefab, model);
}

function bucketDirty(mgr: EntityManager, prefabName: string): boolean | undefined {
  const buckets = (mgr as unknown as { buckets: Map<string, { prefabName: string; dirty: boolean; mastersReady: boolean }> }).buckets;
  for (const b of buckets.values()) if (b.prefabName === prefabName) return b.dirty;
  return undefined;
}

function bucketMastersReady(mgr: EntityManager, prefabName: string): boolean {
  const buckets = (mgr as unknown as { buckets: Map<string, { prefabName: string; mastersReady: boolean }> }).buckets;
  for (const b of buckets.values()) if (b.prefabName === prefabName) return b.mastersReady;
  return false;
}

function bucketMasterKey(mgr: EntityManager, prefabName: string): string | undefined {
  const buckets = (mgr as unknown as { buckets: Map<string, { prefabName: string; masterKey: string }> }).buckets;
  for (const b of buckets.values()) if (b.prefabName === prefabName) return b.masterKey;
  return undefined;
}

/** Reflexion auf die privaten Caches, die aktualisiereGrundskala verwerfen muss (B1/B6). */
function privateCaches(mgr: EntityManager): {
  colliders: Map<string, { carrier: { dispose: () => void }; set: { dispose: () => void } }>;
  colliderSpecs: Map<string, unknown>;
  colliderless: Set<string>;
} {
  return mgr as unknown as {
    colliders: Map<string, { carrier: { dispose: () => void }; set: { dispose: () => void } }>;
    colliderSpecs: Map<string, unknown>;
    colliderless: Set<string>;
  };
}

function warteAufMasters(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));
}

async function haupt(): Promise<void> {
  const { calls, assets } = fakeAssets();
  const mgr = new EntityManager(null as never, null as never, assets, null as never);

  setze(mgr, 'a1', eintragA.name, hashA, modelA);
  setze(mgr, 'a2', eintragA.name, hashA, modelA);
  setze(mgr, 'b1', eintragB.name, hashB, modelB);
  await warteAufMasters();
  pruefe(bucketMastersReady(mgr, eintragA.name), 'Bucket A hat Master (Vorbedingung)');
  pruefe(bucketMastersReady(mgr, eintragB.name), 'Bucket B hat Master (Vorbedingung)');
  pruefe(calls.length === 2, `getMasters beim Aufbau für A und B je einmal gerufen (${calls.length})`);

  // Nach dem Aufbau ist frisch geladen — dirty steht (mastersReady setzt es), erst zurücksetzen.
  (mgr as unknown as { buckets: Map<string, { dirty: boolean }> }).buckets.forEach((b) => {
    b.dirty = false;
  });

  // ── B1/M4: der erneute getMasters()-Aufruf muss WIRKLICH stattfinden ──
  // Ein Zähler AB HIER, nicht `calls.includes(modelA)` — das wäre schon vom
  // Aufbau oben wahr und hätte einen entfernten erneuten Aufruf nie gemerkt
  // (Angriffsbefund an der Vorfassung dieses Tests).
  const rufeVorAktualisierung = calls.length;

  // ── B1 (Kopfkommentar `aktualisiereGrundskala`) / B6: veraltete Caches
  // müssen für Bucket A verworfen werden — ein Wächter, der nie eintritt,
  // wäre ein Test, der nur behauptet statt ausführt. Beide Einträge hier
  // sind ECHTE Einträge derselben Datenstruktur, die die Methode selbst
  // liest und löscht (Reflexion auf ein privates Feld, kein Ersatzobjekt
  // daneben).
  const caches = privateCaches(mgr);
  const masterKeyA = bucketMasterKey(mgr, eintragA.name)!;
  let carrierEntsorgt = 0;
  let setEntsorgt = 0;
  caches.colliders.set(masterKeyA, {
    carrier: { dispose: () => carrierEntsorgt++ },
    set: { dispose: () => setEntsorgt++ },
  });
  caches.colliderSpecs.set(masterKeyA, 'alte-form');
  caches.colliderless.add(eintragA.name);

  const ergebnis = await mgr.aktualisiereGrundskala(modelA);
  pruefe(ergebnis.buckets === 1, `aktualisiereGrundskala meldet einen betroffenen Bucket (${ergebnis.buckets})`);
  pruefe(bucketDirty(mgr, eintragA.name) === true, 'Bucket A (Modell A) wird dirty markiert');
  pruefe(bucketDirty(mgr, eintragB.name) === false, 'Bucket B (Modell B) bleibt unberührt (M3)');
  pruefe(
    calls.length === rufeVorAktualisierung + 1,
    `getMasters wird GENAU EINMAL erneut für Modell A gerufen (vorher ${rufeVorAktualisierung}, nachher ${calls.length})`
  );
  pruefe(carrierEntsorgt === 1, `veralteter Collider-Träger wird entsorgt (${carrierEntsorgt}x)`);
  pruefe(setEntsorgt === 1, `veraltetes Collider-Set wird entsorgt (${setEntsorgt}x)`);
  pruefe(!caches.colliders.has(masterKeyA), 'veralteter Collider-Cache-Eintrag verschwindet aus colliders');
  pruefe(!caches.colliderSpecs.has(masterKeyA), 'veralteter Eintrag verschwindet aus colliderSpecs');
  pruefe(!caches.colliderless.has(eintragA.name), 'colliderless für Modell A wird zurückgesetzt (B6)');

  // ── B3: ein Modell, das im Testflug NIE gesetzt (und nie geladen) wurde,
  // darf NICHTS laden — weder `getMasters` noch irgendeinen Bucket
  // betreffen. Vor der N1-Nachbesserung lief hier unbedingt ein
  // `getMasters()`-Aufruf, der eine echte GLB angefordert hätte
  // (Angriffsprobe B3: `loadContainer`-Aufrufe=1 für ein leeres Ergebnis).
  const unbekanntesModell = `${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}U_G1NieGesetzt`;
  const rufeVorUnbekannt = calls.length;
  const leer = await mgr.aktualisiereGrundskala(unbekanntesModell);
  pruefe(leer.buckets === 0, 'unbekanntes Modell: kein Bucket betroffen');
  pruefe(
    calls.length === rufeVorUnbekannt,
    `unbekanntes Modell: KEIN getMasters()-Aufruf (B3) — vorher ${rufeVorUnbekannt}, nachher ${calls.length}`
  );

  // Zurücksetzen und zweimal hintereinander für DASSELBE Modell aufrufen —
  // beide Male wieder genau der eine Bucket, kein doppelter/veralteter Rest.
  (mgr as unknown as { buckets: Map<string, { dirty: boolean }> }).buckets.forEach((b) => {
    b.dirty = false;
  });
  const rufeVorZweitemMal = calls.length;
  const zweitesMal = await mgr.aktualisiereGrundskala(modelA);
  pruefe(zweitesMal.buckets === 1, 'erneuter Aufruf für dasselbe Modell bleibt korrekt (kein Duplikat, kein Verlust)');
  pruefe(bucketDirty(mgr, eintragA.name) === true, 'Bucket A erneut dirty');
  pruefe(bucketDirty(mgr, eintragB.name) === false, 'Bucket B weiterhin unberührt');
  pruefe(calls.length === rufeVorZweitemMal + 1, 'auch der zweite Aufruf ruft getMasters genau einmal erneut');

  console.log(fehler === 0 ? 'OK — entity-grundskala' : `${fehler} ABWEICHUNGEN`);
  process.exit(fehler > 0 ? 1 : 0);
}

void haupt();
