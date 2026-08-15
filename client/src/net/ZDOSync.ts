/**
 * ZDOSync wire parsing (Phase 2) — 1:1 the format WovServer.syncZDOs
 * writes. Separated from GameSocket so the entity layer stays testable.
 */
import { ANIM_MEMBER, HEALTH_MEMBER, LAYOUT_ID_MEMBER, getStableHash } from '@wov/shared';
import type { Vector3, Quaternion, NpcEinordnung } from '@wov/shared';
import type { BinaryReader } from './GameSocket';

const SCALE_SCALAR_HASH = getStableHash('scaleScalar');
const SCALE_HASH = getStableHash('scale');
const LOCATION_PROXY_HASH = getStableHash('LocationProxy');
const LOCATION_MEMBER_HASH = getStableHash('location');
const ANIM_HASH = getStableHash(ANIM_MEMBER);
const HEALTH_HASH = getStableHash(HEALTH_MEMBER);
const LAYOUT_ID_HASH = getStableHash(LAYOUT_ID_MEMBER);

export interface ZDOEntityUpdate {
  /** `${userId}:${id}` */
  key: string;
  prefabHash: number;
  position: Vector3;
  rotation: Quaternion;
  /** Uniform (scaleScalar) or non-uniform (scale) — undefined = prefab default. */
  scale?: number | Vector3;
  /** F4: LocationProxy feature hash → terrain leveling (Unity TerrainModifier). */
  locationFeatureHash?: number;
  /**
   * Bewegungszustand vom Server ('idle'/'walk', ZDO-Member `anim`) —
   * bestimmt die laufende Animationsgruppe der Instanz. Fehlt er, bleibt
   * es bei der Animation aus PrefabDef (alle Prefabs ohne Route).
   */
  anim?: string;
  /**
   * Trefferpunkte (ZDO-Member `health`) — ABSOLUT, nicht in Prozent.
   *
   * Der Maximalwert bleibt bewusst draussen: Er hängt am Prefab und nicht
   * am Exemplar, steht in shared/leben.ts und ist dem Client damit schon
   * bekannt. Ihn mitzuschicken wären vier Byte in jedem Positions-Tick
   * für eine Zahl, die sich nie ändert.
   *
   * Fehlt das Feld, ist es KEIN „null Leben", sondern „unbekannt": Der
   * Server schickt den Member erst, seit die Kreaturen ihn beim Spawn
   * bekommen — bei einem Objekt aus einem alten Save fehlt er weiterhin,
   * und dort gehört kein Balken hin statt ein leerer.
   */
  health?: number;
  /**
   * Herkunft aus dem WorldLayout (ZDO-Member `layoutId`, s.
   * LAYOUT_ID_MEMBER). Der Client hat das Dokument bereits (Paket
   * WorldLayoutData) und schlägt darüber die NPC-Einordnung nach — die
   * kostet so KEIN zusätzliches Byte im Positions-Tick.
   */
  layoutId?: string;
  /**
   * Fertige NPC-Einordnung — NUR der Offline-Weg (Editor-Testflug) setzt
   * sie, dort gibt es weder Server noch `layoutId`: Die Platzierung liegt
   * dem Zeichner unmittelbar vor. Online bleibt das Feld leer und die
   * Einordnung kommt über `layoutId` aus dem Layout-Dokument.
   */
  npc?: NpcEinordnung;
  /** True when this ZDO is owned by our own peer (own player character). */
  isOwnPlayer: boolean;
}

export interface ZDOSyncResult {
  tick: number;
  updates: ZDOEntityUpdate[];
  destroyed: string[];
}

export function parseZDOSync(reader: BinaryReader, ownUserId: string): ZDOSyncResult {
  const tick = reader.readInt32();
  const updates: ZDOEntityUpdate[] = [];

  const updateCount = reader.readInt32();
  for (let i = 0; i < updateCount; i++) {
    const userId = reader.readString();
    const id = reader.readInt32();
    const prefabHash = reader.readInt32();
    const position = reader.readVector3();
    const rotation = reader.readQuaternion();
    reader.readUInt32(); // revision — sync gate is server-side
    reader.readUInt8(); // flags

    const hasOwner = reader.readBool();
    let ownerUserId = '';
    if (hasOwner) {
      ownerUserId = reader.readString();
      reader.readInt32();
    }

    let scale: number | Vector3 | undefined;
    let locationFeatureHash: number | undefined;
    let anim: string | undefined;
    let health: number | undefined;
    let layoutId: string | undefined;
    const memberCount = reader.readInt32();
    for (let m = 0; m < memberCount; m++) {
      const memberHash = reader.readInt32();
      const memberType = reader.readUInt8();
      if (memberHash === SCALE_SCALAR_HASH && memberType === 0) {
        scale = reader.readFloat32();
      } else if (memberHash === SCALE_HASH && memberType === 1) {
        scale = reader.readVector3();
      } else if (memberHash === ANIM_HASH && memberType === 5) {
        anim = reader.readString();
      } else if (memberHash === HEALTH_HASH && memberType === 3) {
        health = reader.readInt32();
      } else if (memberHash === LAYOUT_ID_HASH && memberType === 5) {
        layoutId = reader.readString();
      } else if (prefabHash === LOCATION_PROXY_HASH && memberHash === LOCATION_MEMBER_HASH && memberType === 3) {
        locationFeatureHash = reader.readInt32();
      } else {
        skipMemberValue(reader, memberType);
      }
    }

    updates.push({
      key: `${userId}:${id}`,
      prefabHash,
      position,
      rotation,
      scale,
      locationFeatureHash,
      anim,
      health,
      layoutId,
      isOwnPlayer: hasOwner && ownerUserId === ownUserId,
    });
  }

  const destroyed: string[] = [];
  const destroyCount = reader.readInt32();
  for (let i = 0; i < destroyCount; i++) {
    destroyed.push(`${reader.readString()}:${reader.readInt32()}`);
  }

  return { tick, updates, destroyed };
}

function skipMemberValue(reader: BinaryReader, type: number): void {
  switch (type) {
    case 0: reader.readFloat32(); break; // Float
    case 1: reader.readVector3(); break; // Vec3
    case 2: reader.readQuaternion(); break; // Quat
    case 3: reader.readInt32(); break; // Int
    case 4: reader.readFloat64(); break; // Long
    case 5: reader.readString(); break; // String
    case 6: reader.skip(reader.readVarInt()); break; // ByteArray
  }
}
