/**
 * Stone material of the 1.0 dungeon kits: the three functions that pick the
 * material of a kit piece, re-paint every loaded piece when the document
 * changes, and cache one material per configuration. They were methods of
 * EntityManager and moved here as functions with a context: `k` is the
 * instance itself, `this` became `k`, nothing else changed. The class keeps
 * the three fields (`steinMaterials`, `steinMasters`, `dokumentSteinKit`),
 * the scene and one forwarding method per function. Calls between the three
 * go through `k`, so a stub set on the instance stays in effect.
 */

import { getRoomByHash, getKitByPrefabHash } from '@wov/shared';
import { erzeugeSteinKitMaterial, mergeSteinKit } from '../engine/DungeonSteinMaterial.js';
import type { SteinKitConfig } from '@wov/shared';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { EntityKontext } from './kontext';
import type { StaticBucket } from './typen';

/** What this module uses of the class: three fields, the scene and two of its own functions, 6 members. */
type SteinMaterialKontext = EntityKontext<
  'steinMasters' | 'dokumentSteinKit' | 'steinMaterials' | 'holeSteinMaterial' | 'weiseSteinMaterialZu' | 'scene'
>;

/**
 * 1.0-Steingrab-Kit: das gebackene GLB-Material durch das konfigurierte
 * KI-Steinmaterial ersetzen. Nur Teile eines Kits mit `steinKit` — Bäume,
 * Requisiten und Räume anderer Kits bleiben unberührt. Das Material wird
 * beim PBRMaterial-Ctor automatisch vom Fackel-Pool erfasst.
 *
 * MISCHREIHENFOLGE (unten gewinnt): Kit-Vorgabe → Dokument → RoomDef →
 * PLATZIERTER Raum. Das Dokument steht in der Mitte, weil es „dieses Grab
 * sieht anders aus" sagt, der Raumtyp aber „diese Kammer sieht anders aus
 * als der Gang" — und das Feinere darf das Gröbere nicht verlieren. Zuunterst
 * die einzelne Platzierung: Sie meint GENAU DIESE Kammer, nicht ihren Typ.
 * Merge order (last wins): kit default → document → RoomDef → placed room.
 */
function weiseSteinMaterialZu(
  k: SteinMaterialKontext,
  bucket: StaticBucket,
  masters: readonly import('@babylonjs/core/Meshes/mesh').Mesh[]
): void {
  const kitCfg = getKitByPrefabHash(bucket.prefabHash)?.steinKit;
  if (!kitCfg) return;
  // Für den Dokumentwechsel merken — `prepareMasters` kommt nie wieder.
  k.steinMasters.set(bucket.schluessel, { bucket, masters: [...masters] });
  // Türen sind keine Räume → getRoomByHash undefined → kein Raum-Override.
  const merged = mergeSteinKit(
    mergeSteinKit(
      mergeSteinKit(kitCfg, k.dokumentSteinKit ?? undefined),
      getRoomByHash(bucket.prefabHash)?.steinKit
    ),
    bucket.steinKitCfg
  );
  const mat = k.holeSteinMaterial(merged);
  for (const m of masters) m.material = mat;
}

/**
 * Das Steinmaterial des betretenen Dokuments setzen (null = zurück auf die
 * Kit-Vorgabe) und ALLE schon geladenen Steinteile neu bemalen.
 *
 * Ohne dieses Nachziehen sähe das zweite Grab einer Sitzung aus wie das
 * erste: Die Master werden je prefabHash nur EINMAL geladen und bemalt,
 * und ein zweiter Ladevorgang kommt nie (`pending` wird nie geleert).
 * Without this re-paint the second barrow of a session would look like the
 * first — masters are loaded and painted exactly once per hash.
 */
function setzeDokumentSteinKit(k: SteinMaterialKontext, cfg: Partial<SteinKitConfig> | null): void {
  const neu = cfg && Object.keys(cfg).length > 0 ? cfg : null;
  if (JSON.stringify(k.dokumentSteinKit) === JSON.stringify(neu)) return;
  k.dokumentSteinKit = neu;
  // ALLE Buckets, auch die mit Raum-Override und deren eigenen Klonen —
  // sonst bliebe die zweite Kammer desselben Prefabs beim Dokumentwechsel
  // auf ihrem alten Material stehen.
  for (const { bucket, masters } of k.steinMasters.values()) {
    k.weiseSteinMaterialZu(bucket, masters);
  }
}

/** Ein Steinmaterial je Konfiguration (Master sind sitzungs-gecacht). */
function holeSteinMaterial(k: SteinMaterialKontext, cfg: SteinKitConfig): PBRMaterial {
  const key = JSON.stringify(cfg);
  let mat = k.steinMaterials.get(key);
  if (!mat) {
    mat = erzeugeSteinKitMaterial(k.scene, `steinKit_${k.steinMaterials.size}`, cfg);
    k.steinMaterials.set(key, mat);
  }
  return mat;
}

export { weiseSteinMaterialZu, setzeDokumentSteinKit, holeSteinMaterial };
