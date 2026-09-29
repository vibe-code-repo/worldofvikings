/**
 * G1 — Grundskala live im Testflug: `EntityManager.aktualisiereGrundskala`
 * ruft `assets.getMasters(model)` erneut auf und markiert NUR die Buckets
 * DIESES Modells `dirty` — ein anderes, schon gesetztes Modell bleibt
 * unberührt. DOM-frei wie `entity-index.ts`: kein Szene-Zugriff, weil
 * `applyStatic()` mit `steinKitOverride === ''` keine Master klont.
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

function fakeAssets(): { calls: string[]; assets: AssetManager } {
  const calls: string[] = [];
  const assets = {
    getMasters: async (name: string): Promise<PrefabMaster[]> => {
      calls.push(name);
      return [fakeMaster()];
    },
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

  const ergebnis = await mgr.aktualisiereGrundskala(modelA);
  pruefe(ergebnis.buckets === 1, `aktualisiereGrundskala meldet einen betroffenen Bucket (${ergebnis.buckets})`);
  pruefe(bucketDirty(mgr, eintragA.name) === true, 'Bucket A (Modell A) wird dirty markiert');
  pruefe(bucketDirty(mgr, eintragB.name) === false, 'Bucket B (Modell B) bleibt unberührt');
  pruefe(calls.includes(modelA), `getMasters erneut für Modell A gerufen (${calls.join(', ')})`);

  // Ein Modell, das NIE gesetzt wurde: kein Treffer, aber auch kein Fehler.
  const unbekanntesModell = `${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}U_G1NieGesetzt`;
  const leer = await mgr.aktualisiereGrundskala(unbekanntesModell);
  pruefe(leer.buckets === 0, 'unbekanntes Modell: kein Bucket betroffen');

  // Zurücksetzen und zweimal hintereinander für DASSELBE Modell aufrufen —
  // beide Male wieder genau der eine Bucket, kein doppelter/veralteter Rest.
  (mgr as unknown as { buckets: Map<string, { dirty: boolean }> }).buckets.forEach((b) => {
    b.dirty = false;
  });
  const zweitesMal = await mgr.aktualisiereGrundskala(modelA);
  pruefe(zweitesMal.buckets === 1, 'erneuter Aufruf für dasselbe Modell bleibt korrekt (kein Duplikat, kein Verlust)');
  pruefe(bucketDirty(mgr, eintragA.name) === true, 'Bucket A erneut dirty');
  pruefe(bucketDirty(mgr, eintragB.name) === false, 'Bucket B weiterhin unberührt');

  console.log(fehler === 0 ? 'OK — entity-grundskala' : `${fehler} ABWEICHUNGEN`);
  process.exit(fehler > 0 ? 1 : 0);
}

void haupt();
