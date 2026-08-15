/**
 * ZDOSync wire parsing (Phase 2) — 1:1 the format WovServer.syncZDOs
 * writes. Separated from GameSocket so the entity layer stays testable.
 *
 * Seit D6 kommen ZDO-Sätze in zwei Ausführungen: VOLLSTAND (alles) und
 * DELTA (nur Position/Drehung plus die Member, die sich seit dem letzten
 * Satz an DIESEN Client geändert haben). Eine laufende Kreatur schickte
 * bisher 4×/s ihren kompletten Member-Satz mit, obwohl sich daran nichts
 * änderte.
 *
 * Damit ein Delta oben in EntityManager wie bisher aussieht, führt der
 * `ZDOSpiegel` den letzten vollständigen Stand je ZDO mit und ergänzt die
 * fehlenden Felder. Das ist keine Bequemlichkeit, sondern nötig: Ein
 * fehlendes `scale` bedeutet dort „Prefab-Standard", ein fehlendes `anim`
 * „zurück zur Prefab-Animation" — als „unverändert" würde beides falsch
 * gelesen und die Kreatur bei jedem Schritt zusammenschrumpfen.
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

/** Satzflags des ZDO-Drahtformats (s. WovServer.writeZDO). */
const SATZ_VOLLSTAND = 1;
const SATZ_BESITZER = 2;

/**
 * Letzter vollständiger Stand je ZDO — die Grundlage, auf die Deltas
 * aufsetzen. Lebt genau so lange wie eine Verbindung: Nach einem
 * Neuaufbau schickt der Server jedes ZDO wieder als Vollstand, weil er
 * seinerseits nichts mehr über den Peer weiß.
 */
export class ZDOSpiegel {
  private readonly stand = new Map<string, ZDOEntityUpdate>();

  hole(key: string): ZDOEntityUpdate | undefined {
    return this.stand.get(key);
  }

  merke(u: ZDOEntityUpdate): void {
    this.stand.set(u.key, u);
  }

  vergiss(key: string): void {
    this.stand.delete(key);
  }

  get anzahl(): number {
    return this.stand.size;
  }
}

/**
 * Ein Delta zu einem ZDO, das der Spiegel nicht kennt, darf es nicht
 * geben — der Server schickt die Erstübertragung immer vollständig.
 * Sollte es doch passieren, ist das Verwerfen die einzig richtige
 * Antwort: Ohne prefabHash liesse sich die Instanz gar nicht bauen, und
 * ein geratener Wert stellt das falsche Modell in die Welt. Einmal
 * warnen, nicht bei jedem Tick.
 */
let deltaLueckeGemeldet = false;

export function parseZDOSync(
  reader: BinaryReader,
  ownUserId: string,
  spiegel: ZDOSpiegel
): ZDOSyncResult {
  const tick = reader.readInt32();
  const updates: ZDOEntityUpdate[] = [];

  const updateCount = reader.readInt32();
  for (let i = 0; i < updateCount; i++) {
    const satzFlags = reader.readUInt8();
    const voll = (satzFlags & SATZ_VOLLSTAND) !== 0;
    const hasOwner = (satzFlags & SATZ_BESITZER) !== 0;

    const userId = reader.readString();
    const id = reader.readInt32();
    const key = `${userId}:${id}`;
    // Beim Vollstand bewusst NICHT auf den alten Stand zurückgreifen: Er
    // ersetzt ihn vollständig, auch wenn dabei Member verschwinden.
    const basis = voll ? undefined : spiegel.hole(key);

    const prefabHash = voll ? reader.readInt32() : (basis?.prefabHash ?? 0);
    const position = reader.readVector3();
    const rotation = reader.readQuaternion();
    reader.readUInt32(); // revision — sync gate is server-side
    if (voll) reader.readUInt8(); // flags

    let ownerUserId = '';
    if (hasOwner) {
      ownerUserId = reader.readString();
      reader.readInt32();
    }

    // Im Delta fehlende Member heissen „unverändert", nicht „nicht da".
    let scale: number | Vector3 | undefined = basis?.scale;
    let locationFeatureHash: number | undefined = basis?.locationFeatureHash;
    let anim: string | undefined = basis?.anim;
    let health: number | undefined = basis?.health;
    let layoutId: string | undefined = basis?.layoutId;
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

    // Erst NACH dem vollständigen Lesen verwerfen — der Reader steht sonst
    // mitten im nächsten Satz und der ganze Rest des Pakets ist Müll.
    if (!voll && !basis) {
      if (!deltaLueckeGemeldet) {
        deltaLueckeGemeldet = true;
        console.warn(`[ZDOSync] Delta ohne Vollstand für ${key} — verworfen`);
      }
      continue;
    }

    const update: ZDOEntityUpdate = {
      key,
      prefabHash,
      position,
      rotation,
      scale,
      locationFeatureHash,
      anim,
      health,
      layoutId,
      isOwnPlayer: hasOwner && ownerUserId === ownUserId,
    };
    spiegel.merke(update);
    updates.push(update);
  }

  const destroyed: string[] = [];
  const destroyCount = reader.readInt32();
  for (let i = 0; i < destroyCount; i++) {
    const key = `${reader.readString()}:${reader.readInt32()}`;
    // Der Server vergisst das ZDO im selben Moment für diesen Peer, also
    // muss der Spiegel es auch — sonst hinge hier ein Stand, auf den nie
    // wieder ein Delta kommt, und beim nächsten Anlegen desselben Objekts
    // stünden alte Member drin.
    spiegel.vergiss(key);
    destroyed.push(key);
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
