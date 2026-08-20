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
import { copyFile, mkdir, open, rename } from 'node:fs/promises';
import { join } from 'path';
import { createZstdCompress, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import type { Vector3, SavedItemStack } from '@wov/shared';

/**
 * Zeitbudget je Serialisierungsschub des asynchronen Saves (D8).
 *
 * Projektmuster: Zeitbudget statt fester Stückzahl — ein ZDO mit 30 Membern
 * kostet ein Vielfaches eines Baumstumpfs, „alle 500 Stück einmal Luft
 * holen" wäre also je nach Weltinhalt mal zu grob und mal zu fein. 8 ms
 * liegen unter einem Server-Tick (33 ms), der Sync merkt davon nichts.
 */
const SAVE_CHUNK_BUDGET_MS = 8;

/**
 * Ab dieser Textmenge geht ein Block in den Kompressionsstrom.
 *
 * Jedes ZDO einzeln hineinzuschreiben kostete das Vierfache an Laufzeit:
 * `write()` je Aufruf ist Strom-Buchhaltung, und davon gäbe es 48.000. Die
 * 256 KB sind KEIN Zeitbudget, sondern eine Puffergröße — die Pause, die
 * der Event-Loop davon abbekommt, regelt weiterhin SAVE_CHUNK_BUDGET_MS.
 */
const SAVE_BLOCK_ZEICHEN = 256 * 1024;

/**
 * Bump when the envelope layout changes (C++ WORLD version constant).
 *
 * v3 (D9): `terrainOps` (unbegrenzt wachsende Operationsliste) ist durch
 * `terrainComps` (Endzustand je Zone) ersetzt. v1/v2 werden weiter GELESEN
 * und beim ersten Save nach v3 überführt — die Operationsliste einfach
 * fallenzulassen hiesse, jede Spielergrabung der letzten Monate zu
 * verlieren.
 */
export const SAVE_FORMAT_VERSION = 3;

/** Last-known state of a player (position restored on next connect). */
export interface SavedPlayer {
  name: string;
  position: Vector3;
  flying: boolean;
  /** Bett-Respawn-Punkt (optional, v2). */
  spawnPoint?: Vector3;
  /** Server-Inventar (SavedItemStack[], optional — Altstände haben keins). */
  inventar?: SavedItemStack[];
  /**
   * Stabile Spieler-ID (F3, Security-Review; optional — Altstände vor
   * diesem Umbau haben keine). Als schlichter `string` statt eines
   * importierten `SpielerId`-Typs, damit world/ nicht von net/ abhängt —
   * die Form wird beim Lesen ueber Identitaet.istSpielerId geprueft, nicht
   * hier ueber den Typ erzwungen. Fehlt sie, bleibt der Datensatz unter
   * seinem NAMEN abgelegt (siehe WovServer.loadWorld /
   * ermittleGespeichertenStand).
   */
  spielerId?: string;
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
  /**
   * v2: Spieler-Terraforming als Operationsliste. Wird nur noch GELESEN
   * (Altstände) — geschrieben wird `terrainComps`, s. SAVE_FORMAT_VERSION.
   */
  terrainOps?: Array<{ pos: Vector3; settingsJson: string }>;
  /**
   * v3: Endzustand des Spieler-Terraformings je bearbeiteter Zone,
   * base64-kodiert (shared/worldgen/terrainCompCodec). Gedeckelt auf
   * 65×65 Vertices je Zone statt linear mit der Spielzeit wachsend.
   */
  terrainComps?: string[];
}

/**
 * Momentaufnahme der persistenten ZDOs für den asynchronen Save (D8).
 *
 * Bewusst ein Index-Zugriff und keine fertige Liste: Die Objekte werden
 * erst beim Schreiben in JSON übersetzt, sonst läge die komplette
 * Serialisierung von 48.000 ZDOs wieder in einem einzigen Block auf dem
 * Event-Loop — genau das, was D8 loswerden soll.
 */
export interface ZdoQuelle {
  readonly laenge: number;
  /** JSON-Text eines ZDOs; `null` = seit dem Save-Beginn zerstört, weglassen. */
  json(index: number): string | null;
}

/**
 * In den Kompressionsstrom schreiben und nur dann warten, wenn sein Puffer
 * wirklich voll ist. Ein bedingungsloses `await` je ZDO wären 48.000
 * Microtask-Sprünge — teurer als das, was D8 einspart.
 */
async function schreibe(strom: Writable, text: string): Promise<void> {
  if (!strom.write(text, 'utf-8')) await once(strom, 'drain');
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

  /** Kopfteil des Umschlags (alles außer `zdos`) — gemeinsam für beide Wege. */
  private umschlagKopf(data: Omit<WorldSaveData, 'version' | 'meta' | 'zdos'>): string {
    const kopf = {
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
    const text = JSON.stringify(kopf);
    if (!text.endsWith('}')) throw new Error('Umschlagkopf ist kein JSON-Objekt');
    return text;
  }

  /**
   * D8 — dieselbe Datei, ohne den Event-Loop zu blockieren.
   *
   * `JSON.stringify` über zehntausende ZDOs plus `zstdCompressSync` standen
   * alle 30 Minuten am Stück im Weg; bei 48.000 ZDOs sind das mehrere
   * hundert Millisekunden, in denen kein ZDO-Sync und kein Paket
   * durchkommt. Stattdessen:
   *
   *  - Der ZDO-Block wird Stück für Stück in einen zstd-STROM geschrieben.
   *    Der unkomprimierte Umschlag existiert damit nie am Stück im
   *    Speicher, und die Kompression selbst läuft im Threadpool.
   *  - Zwischen den Schüben gibt ein `setImmediate` die Schleife frei
   *    (Zeitbudget, s. SAVE_CHUNK_BUDGET_MS).
   *
   * Die Sicherheitsmechanik bleibt Zeichen für Zeichen dieselbe wie im
   * synchronen Weg: erst `.prev`-Rotation, dann tmp schreiben, dann
   * umbenennen. Neu ist nur ein `fsync` vor dem Umbenennen — ohne das
   * garantiert `rename` zwar Atomizität gegen einen Prozessabbruch, aber
   * nicht gegen einen Stromausfall, bei dem der Verzeichniseintrag schon
   * auf der Platte steht und der Inhalt noch im Cache hängt. Für diese
   * Welt gibt es keine Sicherungskopien.
   */
  async saveAsync(
    data: Omit<WorldSaveData, 'version' | 'meta' | 'zdos'>,
    zdos: ZdoQuelle
  ): Promise<void> {
    await mkdir(this.worldsDir, { recursive: true });

    const packer = createZstdCompress();
    const teile: Buffer[] = [];
    packer.on('data', (c: Buffer) => teile.push(c));
    const stromFertig = once(packer, 'end');

    const kopf = this.umschlagKopf(data);
    let block = `${kopf.slice(0, -1)},"zdos":[`;
    let erstes = true;
    let takt = Date.now();
    for (let i = 0; i < zdos.laenge; i++) {
      const json = zdos.json(i);
      if (json === null) continue;
      block += erstes ? json : `,${json}`;
      erstes = false;
      if (block.length >= SAVE_BLOCK_ZEICHEN) {
        await schreibe(packer, block);
        block = '';
      }
      if (Date.now() - takt >= SAVE_CHUNK_BUDGET_MS) {
        await new Promise<void>((r) => setImmediate(r));
        takt = Date.now();
      }
    }
    await schreibe(packer, `${block}]}`);
    packer.end();
    await stromFertig;

    const compressed = Buffer.concat(teile);

    if (existsSync(this.savePath)) {
      await copyFile(this.savePath, `${this.savePath}.prev`);
    }
    const tmpPath = `${this.savePath}.tmp`;
    const datei = await open(tmpPath, 'w');
    try {
      await datei.writeFile(compressed);
      await datei.sync();
    } finally {
      await datei.close();
    }
    await rename(tmpPath, this.savePath);
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

    // Aeltere Staende sind vorwaerts-kompatibel: v1 fehlt terrainOps ganz,
    // v2 fuehrt sie als Operationsliste (D9 spielt sie beim Laden ab und
    // schreibt beim naechsten Save terrainComps).
    if (envelope.version !== SAVE_FORMAT_VERSION && envelope.version !== 1 && envelope.version !== 2) {
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
