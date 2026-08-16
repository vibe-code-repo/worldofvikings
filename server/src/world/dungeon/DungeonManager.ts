/**
 * DungeonManager (Phase G) — dungeons as standalone instances.
 *
 * Concept (deliberately different from Valheim's "+5000 m sky" hack):
 * every dungeon lives in its own instance slot in the dungeon band — the
 * same world coordinate system, but far outside the playable world
 * (x = DUNGEON_INSTANCE_X_BASE, one slot every DUNGEON_INSTANCE_SPACING
 * meters along z). Slot spacing far exceeds the ZDO interest radius, so
 * instances are invisible to the overworld and to each other; entering and
 * leaving is a plain teleport. The ZDOManager's outer-sector storage
 * handles these coordinates natively.
 *
 * Three layers:
 *   DungeonDocument (persistent, has the ID) — data/dungeons/<id>.json.
 *     Either 'generated' (reproducible from base+seed, stored materialized
 *     so it can be edited) or 'custom' (hand-built in the editor).
 *   Entrance registry (persistent) — data/dungeons/entrances.json maps a
 *     world entrance (zone of the location) to a dungeon ID. Auto-filled
 *     when the ZoneManager materializes a location containing a DG_* piece;
 *     reassignable via admin command.
 *   DungeonInstance (ephemeral) — materialized ZDOs of one document in an
 *     instance slot. Never saved with the world (loot state resets on
 *     server restart, like Valheim's own dungeon regeneration).
 *
 * C++ reference: DungeonManager.cpp / DungeonGenerator.cpp (the generation
 * itself lives in shared/src/dungeonGenerator.ts).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  DUNGEON_REGEN_INTERVAL_MS,
  DUNGEON_INSTANCE_SPACING,
  DUNGEON_INSTANCE_X_BASE,
  DUNGEON_INSTANCE_Y_BASE,
  DungeonDocument,
  DungeonLayout,
  ENTRANCE_HULL_MODELS,
  generateDungeonLayout,
  findPrefabByName,
  getDungeonByHash,
  getDungeonByName,
  getStableHash,
  isInstanceableDungeon,
  isValidDungeonId,
  istEigenesModell,
  sanitizeDungeonDocument,
} from '@wov/shared';
// Serverseitige Weltdaten: NICHT ueber den Barrel, sondern ueber den
// expliziten Pfad — sie tragen die Rohdaten der Weltvorlagen (Pieces bzw.
// Raum-Einrichtung) und haetten im Barrel jedes Client-Bundle aufgeblaeht.
import { flattenLayout } from '@wov/shared/src/dungeonFlatten.js';
import type { Vector3 } from '@wov/shared';
import type { ZDOManager } from '../../zdo/ZDOManager.js';
import type { ZDOID } from '../../zdo/ZDOID.js';

/** A live, materialized dungeon (one per document at a time). */
export interface DungeonInstance {
  dungeonId: string;
  slot: number;
  origin: Vector3;
  zdoids: ZDOID[];
  /** Peer names currently inside. */
  players: Set<string>;
  /** Für die Regeneration: letzter Zeitpunkt mit Spielern (ms epoch). */
  zuletztBetreten?: number;
}

/** 'Spawner_Skeleton_respawn_30' → 'Skeleton'; 'BonePileSpawner' → 'Skeleton'. */
function spawnerCreature(prefabName: string): string | null {
  if (prefabName === 'BonePileSpawner') return 'Skeleton';
  const m = /^Spawner_([A-Za-z]+)/.exec(prefabName);
  if (!m) return null;
  return findPrefabByName(m[1]!) ? m[1]! : null;
}

/** A world entrance mapped to a dungeon ID. */
export interface DungeonEntrance {
  /** Zone key "zx,zy" of the location (1 dungeon entrance per zone). */
  zoneKey: string;
  /** World position of the DG_* piece (≈ the visible entrance). */
  pos: Vector3;
  /** Feature (location) name, e.g. 'Crypt2' — diagnostics/UI. */
  feature: string;
  /** Assigned dungeon document. */
  dungeonId: string;
  /**
   * Recipe for the lazy auto-document: DG_* base + seed. Documents are NOT
   * created eagerly (a fresh world books 1000+ dungeon locations — that
   * would flood data/dungeons/ at startup); getOrCreateInstance builds the
   * document from this on first enter. Absent for admin-assigned custom
   * dungeons whose document already exists.
   */
  base?: string;
  seed?: number;
}

interface EntranceFile {
  version: number;
  entries: DungeonEntrance[];
}

export class DungeonManager {
  private readonly documents = new Map<string, DungeonDocument>();
  private readonly instances = new Map<string, DungeonInstance>();
  private readonly entrances = new Map<string, DungeonEntrance>();
  private readonly freeSlots: number[] = [];
  private nextSlot = 0;

  /** Fired whenever the entrance registry changes (map markers re-broadcast). */
  onEntrancesChanged: (() => void) | null = null;

  constructor(
    private readonly zdos: ZDOManager,
    private readonly dungeonsDir: string
  ) {}

  // ── Documents ────────────────────────────────────────────────────

  /** Load all dungeon documents + the entrance registry from disk. */
  load(): void {
    mkdirSync(this.dungeonsDir, { recursive: true });

    for (const file of readdirSync(this.dungeonsDir)) {
      if (!file.endsWith('.json') || file === 'entrances.json') continue;
      try {
        const raw = JSON.parse(readFileSync(join(this.dungeonsDir, file), 'utf-8'));
        const doc = sanitizeDungeonDocument(raw);
        if (doc) {
          this.documents.set(doc.id, doc);
        } else {
          console.warn(`[Dungeon] ${file}: invalid document — skipped`);
        }
      } catch (err) {
        console.warn(`[Dungeon] ${file}: unreadable (${err}) — skipped`);
      }
    }

    const entrancePath = join(this.dungeonsDir, 'entrances.json');
    if (existsSync(entrancePath)) {
      try {
        const raw = JSON.parse(readFileSync(entrancePath, 'utf-8')) as EntranceFile;
        for (const e of raw.entries ?? []) {
          if (typeof e?.zoneKey === 'string' && typeof e?.dungeonId === 'string') {
            this.entrances.set(e.zoneKey, e);
          }
        }
      } catch (err) {
        console.warn(`[Dungeon] entrances.json unreadable (${err})`);
      }
    }

    if (this.documents.size > 0 || this.entrances.size > 0) {
      console.log(
        `[Dungeon] Loaded ${this.documents.size} document(s), ${this.entrances.size} entrance(s)`
      );
    }
  }

  getDocument(id: string): DungeonDocument | undefined {
    return this.documents.get(id);
  }

  listDocuments(): DungeonDocument[] {
    return [...this.documents.values()];
  }

  /** Persist a (sanitized) document and register it. */
  saveDocument(doc: DungeonDocument): void {
    this.documents.set(doc.id, doc);
    mkdirSync(this.dungeonsDir, { recursive: true });
    const path = join(this.dungeonsDir, `${doc.id}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 1));
    renameSync(tmp, path);
  }

  /**
   * Accept an untrusted document (editor upload). Returns the sanitized
   * document or null. Existing instance is torn down so the next enter
   * materializes the new state.
   */
  upsertDocument(raw: unknown): DungeonDocument | null {
    const doc = sanitizeDungeonDocument(raw);
    if (!doc) return null;
    this.saveDocument(doc);
    this.destroyInstance(doc.id);
    return doc;
  }

  deleteDocument(id: string): boolean {
    if (!this.documents.delete(id)) return false;
    this.destroyInstance(id);
    // Drop entrance assignments pointing at the deleted dungeon.
    for (const [key, e] of this.entrances) {
      if (e.dungeonId === id) this.entrances.delete(key);
    }
    this.saveEntrances();
    this.onEntrancesChanged?.();
    const path = join(this.dungeonsDir, `${id}.json`);
    try {
      if (existsSync(path)) renameSync(path, `${path}.deleted`);
    } catch {
      /* Datei weg = Ziel erreicht */
    }
    return true;
  }

  /**
   * Create (and persist) a generated dungeon document.
   * The layout is stored materialized so the editor can modify it later.
   */
  createGenerated(baseName: string, seed: number, id?: string): DungeonDocument | null {
    const def = getDungeonByName(baseName);
    if (!def || !isInstanceableDungeon(def)) return null;

    const slug = baseName.replace(/^DG_/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const finalId = id ?? `${slug}-${(seed >>> 0).toString(16)}`;
    if (!isValidDungeonId(finalId)) return null;

    const layout = generateDungeonLayout(def, seed);
    const doc: DungeonDocument = {
      version: 1,
      id: finalId,
      name: `${baseName.replace(/^DG_/, '')} #${(seed >>> 0).toString(16)}`,
      base: baseName,
      mode: 'generated',
      seed,
      zoneSize: 64,
      layout,
    };
    this.saveDocument(doc);
    return doc;
  }

  // ── Entrances ────────────────────────────────────────────────────

  /**
   * Called by the ZoneManager when a location materializes a DG_* piece,
   * and by the startup backfill for every booked dungeon location. First
   * contact books the entrance with a deterministic auto-document recipe
   * (base+seed — the document itself is created lazily on first enter);
   * later contacts keep whatever assignment exists (admin overrides win).
   */
  registerEntrance(
    featureName: string,
    dgPrefabHash: number,
    zoneKey: string,
    pos: Vector3,
    seed: number,
    quiet = false
  ): DungeonEntrance | null {
    const existing = this.entrances.get(zoneKey);
    if (existing) return existing;
    // Backfill bucht mit der FEATURE-Position, der Generierungs-Hook später
    // mit der (rotierten) PIECE-Position — liegt die auf der Nachbarzone,
    // entstünde ein Duplikat. Nähe schlägt deshalb den Zonenschlüssel.
    const near = this.findEntranceNear(pos, 40);
    if (near) return near;

    const def = getDungeonByHash(dgPrefabHash);
    // Camps bleiben Oberwelt, PlainsFortress ist gesperrt (8k-Räume-Monster).
    if (!def || !isInstanceableDungeon(def)) return null;

    const slug = def.name.replace(/^DG_/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const id = `${slug}-${zoneKey.replace(',', 'x').replace(/-/g, 'm')}`;

    const entrance: DungeonEntrance = {
      zoneKey,
      pos: { ...pos },
      feature: featureName,
      dungeonId: id,
      base: def.name,
      seed: seed | 0,
    };
    this.entrances.set(zoneKey, entrance);
    if (!quiet) {
      this.saveEntrances();
      this.onEntrancesChanged?.();
      console.log(`[Dungeon] Entrance '${featureName}' @ ${zoneKey} → ${id}`);
    }
    return entrance;
  }

  /**
   * Startup backfill: book entrances for every dungeon-bearing location the
   * ZoneManager has PREPARED (booked), not just the generated ones — on an
   * existing save the already-generated zones never run generateFeature
   * again, and the world map should still show every crypt/cave. Seed is
   * derived position-based like C++ DungeonGenerator::GetSeed.
   */
  backfillFromFeatures(
    instances: ReadonlyArray<{ zoneKey: string; featureName: string; dgPrefabHash: number; pos: Vector3 }>,
    worldSeed: number
  ): number {
    let added = 0;
    for (const inst of instances) {
      if (this.entrances.has(inst.zoneKey)) continue;
      const seed =
        (worldSeed +
          Math.imul(Math.trunc(inst.pos.x), -4271) +
          Math.imul(Math.trunc(inst.pos.y), 9187) +
          Math.imul(Math.trunc(inst.pos.z), -2134)) |
        0;
      if (this.registerEntrance(inst.featureName, inst.dgPrefabHash, inst.zoneKey, inst.pos, seed, true)) {
        added++;
      }
    }
    if (added > 0) {
      this.saveEntrances();
      this.onEntrancesChanged?.();
      console.log(`[Dungeon] Backfilled ${added} entrance(s) from booked locations`);
    }
    return added;
  }

  /** Reassign an entrance to another dungeon document. */
  assignEntrance(zoneKey: string, dungeonId: string): boolean {
    const entrance = this.entrances.get(zoneKey);
    if (!entrance || !this.documents.has(dungeonId)) return false;
    entrance.dungeonId = dungeonId;
    // Das Auto-Rezept löschen: die Zuweisung zeigt jetzt auf ein
    // existierendes Dokument, nicht mehr auf einen lazy zu erzeugenden.
    delete entrance.base;
    delete entrance.seed;
    this.saveEntrances();
    this.onEntrancesChanged?.();
    return true;
  }

  /** Nearest entrance within `radius` meters (horizontal). */
  findEntranceNear(pos: Vector3, radius: number): DungeonEntrance | null {
    let best: DungeonEntrance | null = null;
    let bestD = radius * radius;
    for (const e of this.entrances.values()) {
      const dx = e.pos.x - pos.x;
      const dz = e.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d <= bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  listEntrances(): DungeonEntrance[] {
    return [...this.entrances.values()];
  }

  private saveEntrances(): void {
    mkdirSync(this.dungeonsDir, { recursive: true });
    const path = join(this.dungeonsDir, 'entrances.json');
    const tmp = `${path}.tmp`;
    const data: EntranceFile = { version: 1, entries: [...this.entrances.values()] };
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, path);
  }

  // ── Entrance hulls ───────────────────────────────────────────────

  /** Zonen, deren Hüllen-ZDO diese Session schon steht (nicht persistent). */
  private readonly hullSpawned = new Set<string>();

  /**
   * Sichtbare Eingangs-Hülle spawnen (Crypt2-Steinbau, Höhleneingang …).
   * Die Hülle ist im Original statische Location-Prefab-Geometrie, kein
   * ZNetView — hier wird sie ein gewöhnliches statisches ZDO. Bewusst
   * NICHT persistent: dieser Aufruf läuft bei jedem Serverstart für alle
   * Eingänge erneut (spawnAllEntranceHulls), gespeicherte Hüllen würden
   * sich sonst bei jedem Boot verdoppeln.
   */
  spawnEntranceHull(entrance: DungeonEntrance): boolean {
    if (this.hullSpawned.has(entrance.zoneKey)) return false;
    if (!ENTRANCE_HULL_MODELS.has(entrance.feature)) return false;
    // Block A: alle zehn Hüllennamen sind Valheim-Exporte, keiner steht in
    // EIGENE_MODELLE. Ein ZDO dafür wäre ein Geist — der Client bekäme es
    // zugestellt, fände kein Modell und zeichnete nichts, während die
    // Weltkarte weiter eine Marke auf eine unsichtbare Krypta setzte.
    // Verworfen: einen Platzhalter-Würfel spawnen. Das hätte die Welt mit
    // Kisten gepflastert, die niemand betreten kann.
    // Die Prüfung sitzt hier und nicht beim Aufrufer, weil beide Wege
    // (Zonen-Hook und Boot-Backfill) sowie der Admin-Befehl hier durchlaufen.
    if (!istEigenesModell(entrance.feature)) return false;
    this.hullSpawned.add(entrance.zoneKey);
    this.zdos.createZDO(getStableHash(entrance.feature), { ...entrance.pos });
    return true;
  }

  /** Hüllen für alle bekannten Eingänge (Serverstart, nach dem Weltladen). */
  spawnAllEntranceHulls(): number {
    let n = 0;
    let ohneModell = 0;
    for (const e of this.entrances.values()) {
      if (this.spawnEntranceHull(e)) n++;
      else if (!istEigenesModell(e.feature)) ohneModell++;
    }
    if (n > 0) console.log(`[Dungeon] ${n} entrance hull(s) spawned`);
    // Eine stille Null wäre hier die schlechtere Meldung: sie ließe offen,
    // ob die Registrierung leer ist oder die Hüllen mit Absicht ausbleiben.
    if (ohneModell > 0) {
      console.log(`[Dungeon] ${ohneModell} Eingangshülle(n) übersprungen — kein eigenes Modell`);
    }
    return n;
  }

  // ── Instances ────────────────────────────────────────────────────

  getInstance(dungeonId: string): DungeonInstance | undefined {
    return this.instances.get(dungeonId);
  }

  listInstances(): DungeonInstance[] {
    return [...this.instances.values()];
  }

  /** Get the live instance for a dungeon, materializing it on first use. */
  getOrCreateInstance(dungeonId: string): DungeonInstance | null {
    const existing = this.instances.get(dungeonId);
    if (existing) return existing;

    let doc = this.documents.get(dungeonId);
    if (!doc) {
      // Lazy auto-document: an entrance carries the recipe (base+seed),
      // the document materializes on first enter.
      const entrance = [...this.entrances.values()].find((e) => e.dungeonId === dungeonId);
      if (entrance?.base) {
        const created = this.createGenerated(entrance.base, entrance.seed ?? 0, dungeonId);
        if (created) {
          created.name = `${entrance.feature} (${entrance.zoneKey})`;
          this.saveDocument(created);
          doc = created;
        }
      }
    }
    if (!doc) return null;

    const slot = this.freeSlots.pop() ?? this.nextSlot++;
    const origin: Vector3 = {
      x: DUNGEON_INSTANCE_X_BASE,
      y: DUNGEON_INSTANCE_Y_BASE,
      z: slot * DUNGEON_INSTANCE_SPACING,
    };

    const zdoids = this.materialize(doc.layout, doc, origin);
    const instance: DungeonInstance = { dungeonId, slot, origin, zdoids, players: new Set() };
    this.instances.set(dungeonId, instance);
    console.log(
      `[Dungeon] Instance '${dungeonId}' materialized in slot ${slot}: ` +
        `${doc.layout.rooms.length} rooms, ${zdoids.length} ZDOs`
    );
    return instance;
  }

  /** Tear down a live instance (ZDOs destroyed, slot freed). */
  destroyInstance(dungeonId: string): boolean {
    const instance = this.instances.get(dungeonId);
    if (!instance) return false;
    for (const zdoid of instance.zdoids) {
      this.zdos.destroyZDO(zdoid);
    }
    this.instances.delete(dungeonId);
    this.freeSlots.push(instance.slot);
    console.log(`[Dungeon] Instance '${dungeonId}' destroyed (${instance.zdoids.length} ZDOs)`);
    return true;
  }

  /**
   * Spawn point inside an instance: 2 m from the entrance connector
   * (= instance origin) toward the start room center — independent of
   * connector orientation conventions.
   */
  getSpawnPoint(instance: DungeonInstance): Vector3 {
    const doc = this.documents.get(instance.dungeonId);
    const start = doc?.layout.rooms[0];
    let dir = { x: 0, y: 0, z: 1 };
    if (start) {
      const len = Math.hypot(start.pos.x, start.pos.z);
      if (len > 0.01) dir = { x: start.pos.x / len, y: 0, z: start.pos.z / len };
    }
    return {
      x: instance.origin.x + dir.x * 2,
      y: instance.origin.y + 0.5,
      z: instance.origin.z + dir.z * 2,
    };
  }

  /**
   * Materialize a layout at an origin: one static ZDO per room shell
   * (geometry + colliders come from the room GLB client-side), one ZDO per
   * net view (chests, spawners, torches, …) and per door.
   */
  private materialize(layout: DungeonLayout, doc: DungeonDocument, origin: Vector3): ZDOID[] {
    const zdoids: ZDOID[] = [];
    const spawned = flattenLayout(layout, doc.base);

    for (const item of spawned) {
      const pos = { x: origin.x + item.pos.x, y: origin.y + item.pos.y, z: origin.z + item.pos.z };
      const zdo = this.zdos.createZDO(item.prefabHash, pos, item.rot);
      zdoids.push(zdo.zdoid);

      // Spawner erwachen: aus 'Spawner_Skeleton(_respawn_30)' wird beim
      // Materialisieren EINE Kreatur an Ort und Stelle (das Spawner-Piece
      // selbst bleibt als unsichtbarer Marker). Respawn-Zyklen später.
      if (item.kind === 'netView') {
        const kreatur = spawnerCreature(item.prefabName);
        if (kreatur !== null) {
          const c = this.zdos.createZDO(getStableHash(kreatur), { ...pos, y: pos.y + 0.2 }, item.rot);
          zdoids.push(c.zdoid);
        }
      }
    }
    return zdoids;
  }

  /**
   * Regeneration (C++ TryRegenerateDungeon-Idee): leere Instanzen werden
   * nach DUNGEON_REGEN_INTERVAL_MS abgerissen — der nächste Besuch
   * materialisiert frisch (Loot/Kreaturen zurück). Periodisch aufrufen.
   */
  tick(now: number): void {
    for (const inst of [...this.instances.values()]) {
      if (inst.players.size > 0) {
        inst.zuletztBetreten = now;
        continue;
      }
      const alter = now - (inst.zuletztBetreten ?? now);
      if (alter > DUNGEON_REGEN_INTERVAL_MS) {
        this.destroyInstance(inst.dungeonId);
      }
    }
  }
}
