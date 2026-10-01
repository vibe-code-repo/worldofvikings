/**
 * Collision carriers of the static buckets: `enablePhysics` switches the
 * collision on and marks every bucket for a rebuild, `rebuildBucketColliders`
 * mirrors the nearby instances of one bucket onto an invisible carrier with a
 * StaticColliderSet. They were methods of EntityManager and moved here as
 * functions with a context: `ctx` is the instance itself, `this` became
 * `ctx`, nothing else changed. The class keeps the fields, the scene and one
 * forwarding method per function.
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import {
  PrefabFlag,
  findPrefabByHash,
  getRoomByHash,
  BEGEHBAR_NAME,
  formUebersteuerung,
  istFesterKoerperImSpiel,
  kollisionsForm,
  storeKollision,
} from '@wov/shared';
import { StaticColliderSet } from '../engine/Physics';
import { COLLIDER_RANGE, SHOW_COLLIDERS } from './konstanten';
import { netzAusMastern, alsOrtsfestEinfrieren } from './zellMesh';
import type { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { KollisionsForm } from '@wov/shared';
import type { EntityKontext } from './kontext';
import type { StaticBucket } from './typen';

/** What this module uses of the class: eleven fields and the scene, 12 members. */
type KollisionsEimerKontext = EntityKontext<
  | 'physicsEnabled'
  | 'buckets'
  | 'colliderless'
  | 'masterMeshes'
  | 'kollisionsMasters'
  | 'colliders'
  | 'kollisionsLocals'
  | 'masterLocals'
  | 'colliderSpecs'
  | 'colliderCenterX'
  | 'colliderCenterZ'
  | 'scene'
>;

/** Enable collision once initPhysics() resolved; catches existing buckets up. */
function enablePhysics(ctx: KollisionsEimerKontext): void {
  if (ctx.physicsEnabled) return;
  ctx.physicsEnabled = true;
  for (const bucket of ctx.buckets.values()) bucket.dirty = true;
}

/**
 * Mirror a bucket's NEARBY instances onto an invisible collision carrier.
 *
 * The carrier takes the RAW zdo matrices, not the per-master products: the
 * visible masters are one per GLB submesh with their own local offsets,
 * while collision wants a single simple shape at the prefab's origin.
 */
function rebuildBucketColliders(ctx: KollisionsEimerKontext, bucket: StaticBucket, zdoMats: readonly Matrix[]): void {
  if (!ctx.physicsEnabled) return;
  if (ctx.colliderless.has(bucket.prefabName)) return;
  // Dungeon-Räume (Phase G) sind IMMER solide — ihre Flags sind 0n, weil
  // sie keine Netzwerk-Prefabs des Originals sind; das Flag-Gate unten griffe nicht.
  const dungeonRoom = getRoomByHash(bucket.prefabHash) !== undefined;
  // Begehbare Bauwerke umgehen das Flag-Gatter aus DEMSELBEN Grund wie
  // Dungeon-Räume: Sie tragen nur PERSISTENT, und das steht nicht in
  // KOLLIDIERENDE_FLAGS. Ohne diese Ausnahme landeten sie in
  // `colliderless`, noch bevor die Netz-Zweige weiter unten je
  // erreicht wurden — gemessen am laufenden Client hatte deshalb auch
  // der Steinkreis gar keine Kollision, man lief mitten hindurch.
  const begehbar = BEGEHBAR_NAME.test(bucket.prefabName);
  // Nur solide Klassen bekommen überhaupt einen Körper. Die Regel steht
  // in `shared` und nicht mehr hier: Der Server muss dieselbe Menge
  // „fest" haben, sonst zieht seine Korrektur den Spieler durch etwas
  // hindurch, vor dem er im Bild steht.
  if (!istFesterKoerperImSpiel(findPrefabByHash(bucket.prefabHash), bucket.prefabName, {
    dungeonRaum: dungeonRoom,
    begehbar,
  })) {
    ctx.colliderless.add(bucket.prefabName);
    return;
  }
  const masters = ctx.masterMeshes.get(bucket.masterKey);
  // Ein eigenes Kollisionsnetz aus der GLB (`_col`) ERSETZT die
  // Kollision des Prefabs vollständig — s. AssetManager-Kopf. Deshalb
  // reicht es auch allein: ein Prefab, das NUR aus `_col` besteht, hat
  // keine sichtbaren Master und trotzdem Kollision.
  const kollMasters = ctx.kollisionsMasters.get(bucket.masterKey);
  /*
    Eine Form aus der HANDTABELLE (`shared/src/kollision/
    formUebersteuerung.ts`) braucht überhaupt keine Geometrie — sie
    steht in der Zeile. Sie wird deshalb hier abgefragt und nicht erst
    unten in `kollisionsForm()`: Die grossen Büsche haben 4 426 bis
    8 133 Dreiecke, und `netzAusMastern()` kopierte davon bei jedem
    ersten Aufbau eines Buckets sämtliche Vertexpositionen zusammen,
    nur um sie an eine Funktion zu geben, die sie wegwirft.

    Sie steht auch VOR der Master-Abfrage: Ein Bucket, dessen Master
    noch nicht geladen sind, bekäme sonst keinen Körper, obwohl seine
    Form von keinem Master abhängt.
  */
  const handform = formUebersteuerung(bucket.prefabName);
  if (
    handform === null &&
    (!masters || masters.length === 0) &&
    (!kollMasters || kollMasters.length === 0)
  )
    return;

  // Kollisionseintrag je BUCKET (masterKey), nicht je Prefabname: Zwei
  // Buckets desselben Prefabs teilten sich sonst Träger UND Signatur und
  // bauten sich gegenseitig die Nah-Auswahl ab. Die Form ist dieselbe —
  // geteilt wird trotzdem nichts, weil `signature` je Auswahl gilt.
  let entry = ctx.colliders.get(bucket.masterKey);
  if (!entry) {
    const def = findPrefabByHash(bucket.prefabHash);
    /*
      Die FORM entscheidet `shared/src/kollision/formen.ts` — dieselbe
      Funktion, die der Server aufruft. Hier wird nur noch geliefert,
      was sie nicht selbst wissen kann: die zusammengelegte Geometrie,
      das Baum-Flag, der Dungeon-Raum und ob ein EIGENES Kollisionsnetz
      vorliegt.

      Ein eigenes Netz (`_col` aus der GLB oder die `…-collision.glb`
      des Speichers) ERSETZT die Kollision vollständig: gebacken wird
      nur aus ihm, die sichtbaren Master kollidieren dann nicht mehr.
      Genau das ist sein Zweck — eine Treppe, deren Kollision aus den
      gerenderten Stufen kommt, ist für die 0,4-m-Kapsel unbegehbar
      (Herleitung im AssetManager-Kopf), das `_col`-Netz legt die
      glatte Rampe darunter.

      Kommt daraus keine Geometrie zusammen, gilt der normale Weg mit
      den sichtbaren Mastern — deshalb das `??` und nicht ein `if`.
    */
    const stammartig = def ? (def.flags & PrefabFlag.TREE_BASE) !== 0n : false;
    const katalog = storeKollision(bucket.prefabName);
    const optionen = { stammartig, dungeonRaum: dungeonRoom };
    let form: KollisionsForm | null = handform;
    if (form === null) {
      const eigen = netzAusMastern(
        kollMasters ?? [],
        ctx.kollisionsLocals.get(bucket.masterKey) ?? []
      );
      const sicht = netzAusMastern(masters ?? [], ctx.masterLocals.get(bucket.masterKey) ?? []);
      form =
        (eigen
          ? kollisionsForm(eigen.positionen, eigen.indizes, bucket.prefabName, katalog, {
              ...optionen,
              eigenesNetz: true,
            })
          : null) ??
        (sicht
          ? kollisionsForm(sicht.positionen, sicht.indizes, bucket.prefabName, katalog, optionen)
          : null);
    }
    if (!form) {
      ctx.colliderless.add(bucket.prefabName);
      return;
    }
    const carrier = new Mesh(`col_${bucket.masterKey}`, ctx.scene);
    carrier.isVisible = false;
    carrier.isPickable = false;
    // Ortsfest, aus demselben Grund wie der Zell-Master: Der Träger
    // steht im Ursprung, die Auswahl der nahen Kollisionskörper kommt
    // ausschliesslich über seinen Thin-Instance-Puffer weiter unten.
    alsOrtsfestEinfrieren(carrier);
    entry = { carrier, set: new StaticColliderSet(carrier, form, ctx.scene), signature: '' };
    ctx.colliders.set(bucket.masterKey, entry);
    ctx.colliderSpecs.set(bucket.masterKey, form);
  }

  // Keep only what is close enough to walk into. Translation lives at
  // matrix elements 12/13/14.
  const near: number[] = [];
  const r2 = COLLIDER_RANGE * COLLIDER_RANGE;
  for (let i = 0; i < zdoMats.length; i++) {
    const m = zdoMats[i]!.m;
    const dx = m[12]! - ctx.colliderCenterX;
    const dz = m[14]! - ctx.colliderCenterZ;
    if (dx * dx + dz * dz <= r2) near.push(i);
  }
  // Signatur der Auswahl: nur bei echter Änderung neu bauen.
  //
  // sync() verwirft die Havok-Bodies und legt sie neu an. Bei jedem
  // dirty-Bucket auszuführen hiess: Solange ZDO-Updates hereinkamen,
  // wurden die Kollisionskörper laufend zerstört und neu erzeugt — und
  // in genau diesen Lücken lief der Spieler durch Bäume hindurch
  // (gemessen: 0,37 m Abstand zu einem Stamm mit 0,79 m Radius). Das
  // HUD zeigte es als auseinanderlaufende Zähler "36 inst / 84 havok".
  let sig = `${near.length}`;
  for (let k = 0; k < near.length; k++) {
    const m = zdoMats[near[k]!]!.m;
    sig += `|${m[12]!.toFixed(2)},${m[14]!.toFixed(2)}`;
  }
  if (sig === entry.signature) return;
  entry.signature = sig;

  const data = new Float32Array(near.length * 16);
  for (let k = 0; k < near.length; k++) zdoMats[near[k]!]!.toArray(data, k * 16);
  entry.carrier.thinInstanceSetBuffer('matrix', data, 16, false);
  entry.set.sync();
  if (SHOW_COLLIDERS) entry.set.showDebug();
}

export { enablePhysics, rebuildBucketColliders };
