/**
 * WorldManager — world persistence (save/load).
 * 1:1 concept port of WorldManager.cpp from Valhalla2.0 C++.
 *
 * C++ reference:
 *   IWorldManager::WriteFileDB  — .db: WORLD version, worldTime (double),
 *     ZDOManager::Save (persistent ZDOs), ZoneManager::Save (generated
 *     zones, globalKeys, features), RandomEventManager::Save
 *   IWorldManager::LoadFileDB   — same order on the way back
 *   IWorldManager::WriteFileMeta — .fwl: name, seedName, seed, uid,
 *     worldGenVersion, startingGlobalKeys
 *   backups: .db-<timestamp>.zstd (zstd-compressed copies)
 *
 * Container format is OUR OWN (JSON envelope, zstd-compressed via
 * node:zlib) — not binary-compatible with the C++ .db DataWriter layout.
 * The content mirrors the C++ save exactly: meta (= .fwl) + worldTime +
 * generated zones (= ZoneManager::Save) + player positions + persistent
 * ZDO snapshots (= ZDOManager::Save). RandomEvents are a later Phase-G
 * item (not yet implemented on either side of the port).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'fs';
import { join } from 'path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import type { Vector3, SavedItemStack } from '@wov/shared';

/** Bump when the envelope layout changes (C++ WORLD version constant). */
export const SAVE_FORMAT_VERSION = 2;

/** Last-known state of a player (position restored on next connect). */
export interface SavedPlayer {
  name: string;
  position: Vector3;
  flying: boolean;
  /** Bett-Respawn-Punkt (optional, v2). */
  spawnPoint?: Vector3;
  /** Server-Inventar (SavedItemStack[], optional — Altstände haben keins). */
  inventar?: SavedItemStack[];
}

export interface WorldSaveData {
  version: number;
  /** C++ .fwl meta (name/seed/uid/worldGenVersion) folded into the envelope. */
  meta: {
    worldName: string;
    worldSeed: string;
    worldGenVersion: number;
    /** ISO timestamp — diagnostics only (C++ encodes it in backup filenames). */
    savedAt: string;
    /** Hash des WorldLayout-Dokuments (Layout-Modus) — Warnung bei Drift. */
    layoutHash?: number;
  };
  /** C++ m_worldTime (double, seconds). */
  worldTime: number;
  /** C++ ZoneManager::Save generated-zone list (x, y pairs). */
  zones: Array<[number, number]>;
  /** Player positions by name — see WovServer.saveWorld for why these
   *  are not saved as ZDOs (C++ reconciles character ZDOs by session; we
   *  exclude them and restore positions by name instead). */
  players: SavedPlayer[];
  /** C++ ZDOManager::Save — persistent ZDOs only (prefab-flag filtered). */
  zdos: Array<Record<string, unknown>>;
  /** v2: Spieler-Terraforming (Hacke/Pflug/Spitzhacke), beim Laden ersetzt. */
  terrainOps?: Array<{ pos: Vector3; settingsJson: string }>;
}

export class WorldManager {
  constructor(
    private readonly worldsDir: string,
    private readonly worldName: string,
    private readonly worldSeed: string,
    private readonly worldGenVersion: number,
    /** Layout-Modus: Hash des aktiven Weltdokuments (sonst null). */
    private readonly layoutHash: number | null = null
  ) {}

  /** C++ GetWorldPath(..., ".db") — one save per world name. */
  get savePath(): string {
    return join(this.worldsDir, `${this.worldName}.db.zst`);
  }

  /**
   * C++ WriteFileDB + CopyCompressDB backup: rotate the current save to
   * `.prev` (simplified single rotation; C++ keeps timestamped backups),
   * then write atomically (tmp + rename — a crash mid-write can never
   * truncate the good save).
   */
  save(data: Omit<WorldSaveData, 'version' | 'meta'>): void {
    mkdirSync(this.worldsDir, { recursive: true });

    const envelope: WorldSaveData = {
      version: SAVE_FORMAT_VERSION,
      meta: {
        worldName: this.worldName,
        worldSeed: this.worldSeed,
        worldGenVersion: this.worldGenVersion,
        savedAt: new Date().toISOString(),
        ...(this.layoutHash !== null ? { layoutHash: this.layoutHash } : {}),
      },
      ...data,
    };

    const compressed = zstdCompressSync(Buffer.from(JSON.stringify(envelope), 'utf-8'));

    if (existsSync(this.savePath)) {
      copyFileSync(this.savePath, `${this.savePath}.prev`);
    }
    const tmpPath = `${this.savePath}.tmp`;
    writeFileSync(tmpPath, compressed);
    renameSync(tmpPath, this.savePath);
  }

  /**
   * C++ LoadFileDB. Returns null (→ fresh world) when the save is missing,
   * corrupt, from a format version we don't understand, or from a different
   * seed (the C++ server refuses seed mismatches the same way — loading
   * ZDOs into the wrong world would strand objects in a changed terrain).
   */
  load(): WorldSaveData | null {
    if (!existsSync(this.savePath)) return null;

    let envelope: WorldSaveData;
    try {
      const compressed = readFileSync(this.savePath);
      envelope = JSON.parse(zstdDecompressSync(compressed).toString('utf-8')) as WorldSaveData;
    } catch (err) {
      console.error(`[WorldManager] Failed to read save "${this.savePath}": ${err}`);
      return null;
    }

    // v1-Saves sind vorwaerts-kompatibel: ihnen fehlt nur terrainOps.
    if (envelope.version !== SAVE_FORMAT_VERSION && envelope.version !== 1) {
      this.verwaise(`Save version ${envelope.version} != ${SAVE_FORMAT_VERSION}`);
      return null;
    }
    if (envelope.meta.worldSeed !== this.worldSeed) {
      this.verwaise(`Save seed "${envelope.meta.worldSeed}" != configured "${this.worldSeed}"`);
      return null;
    }
    if (envelope.meta.worldGenVersion !== this.worldGenVersion) {
      this.verwaise(`Save worldGenVersion ${envelope.meta.worldGenVersion} != ${this.worldGenVersion}`);
      return null;
    }
    // Layout-Drift ist KEIN Abbruch (Layout-Iteration ist der normale
    // Arbeitsmodus, der Vegetations-Healer setzt Bestand nach) — aber sie
    // soll unübersehbar im Log stehen: Terrain kann sich unter gebauten
    // Dingen verschoben haben (Review-Punkt 7).
    if (
      this.layoutHash !== null &&
      envelope.meta.layoutHash !== undefined &&
      envelope.meta.layoutHash !== this.layoutHash
    ) {
      console.warn(
        `[WorldManager] ⚠ WorldLayout hat sich seit dem Save geändert (Hash ${envelope.meta.layoutHash} → ${this.layoutHash}) — Terrain kann unter Bestand verschoben sein`
      );
    }
    return envelope;
  }

  /**
   * Inkompatiblen Save BEISEITE legen statt ihn zum Überschreiben
   * freizugeben: Vorher zerstörte der nächste Autosave nach einem
   * versehentlichen Seed-/Versionswechsel den alten Spielstand endgültig
   * (Review-Punkt 7). Die .orphan-Datei bleibt liegen, bis jemand sie
   * bewusst löscht oder zurückbenennt.
   */
  private verwaise(grund: string): void {
    const ziel = `${this.savePath}.orphan-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      renameSync(this.savePath, ziel);
      console.warn(`[WorldManager] ${grund} — Save beiseitegelegt: ${ziel}`);
    } catch (err) {
      console.error(`[WorldManager] ${grund} — Beiseitelegen fehlgeschlagen: ${err}`);
    }
  }
}
