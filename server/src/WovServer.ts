/**
 * WovServer — central server orchestrator.
 * 1:1 port of WovServer.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class IValhalla {
 *     ServerSettings m_settings;
 *     list<unique_ptr<Task>> m_tasks;
 *     UserID m_serverID;
 *     steady_clock::time_point m_startTime, m_prevUpdate, m_nowUpdate;
 *     WorldTime m_worldTime;
 *     double m_worldTimeMultiplier;
 *     atomic_bool m_run_state;
 *     Set<string> m_blacklist, m_admin, m_whitelist;
 *     ...
 *   };
 */

import {
  EVENT_CHANCE,
  EVENT_INTERVAL_MS,
  WORLD_TIME_LENGTH,
  TIME_DAY,
  SAVE_INTERVAL_MS,
  ZDO_SEND_INTERVAL_MS,
  ZDO_MAX_SEND_THRESHOLD,
  ZDO_MIN_SEND_THRESHOLD,
  PacketType,
  createGeo,
  sanitizeWorldLayout,
  pruefeLayout,
  LAYOUT_ID_MEMBER,
  HEALTH_MEMBER,
  layoutKennung,
  istNpcPrefab,
  maxLeben,
  type IGeo,
  HeightmapProvider,
  getStableHash,
  kodiereTerrainComp,
  terrainCompNachBase64,
  terrainCompAusBase64,
  istEigenesModell,
} from '@wov/shared';
import type { Biome, Vector3, ZoneID } from '@wov/shared';
import {
  BAU_PREFABS,
  ESSEN,
  DUNGEONS,
  FEATURES,
  FOLIAGE,
  PIECES,
  PrefabFlag,
  WATER_LEVEL,
  findPrefabByHash,
  interiorEnvironment,
  isInDungeonBand,
} from '@wov/shared';
// Serverseitige Weltdaten: NICHT ueber den Barrel, sondern ueber den
// expliziten Pfad — sie tragen die Rohdaten der Weltvorlagen (Pieces bzw.
// Raum-Einrichtung) und haetten im Barrel jedes Client-Bundle aufgeblaeht.
import { getFeaturePieces } from '@wov/shared/src/featurePieces.js';
import { ZDOManager, worldToZone } from './zdo/ZDOManager.js';
import { DungeonManager } from './world/dungeon/DungeonManager.js';
import { ZDO } from './zdo/ZDO.js';
import { ZDOID } from './zdo/ZDOID.js';
import { PrefabManager } from './prefab/PrefabManager.js';
import { ZoneManager } from './world/ZoneManager.js';
import { SpawnSystem } from './world/SpawnSystem.js';
import { RoutenLaeufer } from './world/RoutenLaeufer.js';
import { AggroSystem } from './world/AggroSystem.js';
import { WorldManager, type SavedPlayer, type WorldSaveData } from './world/WorldManager.js';
import { HAUPTWELT_ID, type WorldContext } from './world/WorldContext.js';
import { NetManager, NetManagerConfig } from './net/NetManager.js';
import { Peer } from './net/Peer.js';
import { Reader } from './io/Reader.js';
import { Writer } from './io/Writer.js';
import { AdminCommandRegistry } from './admin/AdminCommands.js';
import { ZONE_SIZE, findItem, REZEPTE } from '@wov/shared';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface ServerConfig {
  name: string;
  password: string;
  port: number;
  maxPlayers: number;
  everyoneAdmin: boolean;
  worldName: string;
  worldSeed: string;
  saveIntervalMs: number;
  // Worldgen (D6) — C++ ServerSettings world* flags (server.yml world section)
  worldGenVersion: number;
  worldBlendSmoothStep: boolean;
  worldBilinearHeight: boolean;
  worldRiverAffectsOcean: boolean;
  worldAshlandsModernNoise: boolean;
  worldDisableDistantRivers: boolean;
  // Phase E/F — zone population flags (C++ world.features/vegetation/creatures)
  worldFeatures: boolean;
  worldVegetation: boolean;
  worldLocationOverrides: boolean;
  dungeonsEnabled: boolean;
  /** G2: server-side creature spawning/wander (C++ world.creatures flag). */
  worldCreatures: boolean;
  /** G1: directory holding <worldName>.db.zst saves (C++ ./worlds). */
  worldsDir: string;
  /** Kartengenerierungs-Umbau: 'layout' = designer-definierte Welt. */
  worldMode: 'valheim' | 'layout';
  /** Pfad des WorldLayout-Dokuments (nur worldMode 'layout'). */
  worldLayoutPath: string;
}

const DEFAULT_CONFIG: ServerConfig = {
  name: 'World of Vikings Server',
  password: '',
  port: 2456,
  maxPlayers: 10,
  everyoneAdmin: true,
  worldName: 'world',
  worldSeed: 'KxSYuZquuw',
  saveIntervalMs: SAVE_INTERVAL_MS,
  worldGenVersion: 2,
  worldBlendSmoothStep: true,
  worldBilinearHeight: false,
  worldRiverAffectsOcean: false,
  // C++ default is true (ValhallaServer.cpp:415); modern FastNoise AshLands
  // ported in Phase B5 — same terrain as the C++ server and the client
  worldAshlandsModernNoise: true,
  worldDisableDistantRivers: false,
  worldFeatures: true,
  worldVegetation: true,
  // C++ experimental-location-overrides (server.yml world section)
  worldLocationOverrides: false,
  dungeonsEnabled: true,
  worldCreatures: true,
  worldMode: 'valheim',
  worldLayoutPath: 'data/welten/dev.json',
  // main.ts pins this to <server>/data/worlds; cwd-relative fallback so a
  // bare createWovServer() (tests, tools) still has a sane default.
  worldsDir: resolve(process.cwd(), 'data', 'worlds'),
};

// ServerConfig packet flag bits (D6) — same order client-side
const FLAG_BLEND_SMOOTHSTEP = 1 << 0;
const FLAG_BILINEAR_HEIGHT = 1 << 1;
const FLAG_ASHLANDS_MODERN = 1 << 2;
const FLAG_RIVER_AFFECTS_OCEAN = 1 << 3;
const FLAG_DISABLE_DISTANT_RIVERS = 1 << 4;
/** Kündigt an, dass direkt nach ServerConfig ein WorldLayoutData folgt. */
const FLAG_LAYOUT_MODE = 1 << 5;

export class WovServer {
  readonly config: ServerConfig;

  // ── Subsystems ─────────────────────────────────────────────────
  readonly zdos: ZDOManager;
  readonly prefabs: PrefabManager;
  readonly net: NetManager;
  /** Extensible admin command concept (fly, later teleport/god/...). */
  readonly adminCommands: AdminCommandRegistry;

  // ── Worldgen (D6) — built in init(), ground truth for terrain ──
  geo!: IGeo;
  /** Alle Welten dieses Prozesses — heute genau die Hauptwelt (Review 15). */
  readonly welten = new Map<string, WorldContext>();
  /** Roh-JSON des WorldLayouts (Layout-Modus) — geht in Phase 4 an Clients. */
  worldLayoutRaw: unknown = null;
  heightmaps!: HeightmapProvider;
  /** Phase E — vegetation zone population around players. */
  zones!: ZoneManager;
  /** G2: creature spawning/wander — null when worldCreatures is off. */
  spawns: SpawnSystem | null = null;
  /** Routen-NPCs des Layouts (feste Wegpunkt-Folgen) — in init() gebaut. */
  routen: RoutenLaeufer | null = null;
  aggro: AggroSystem | null = null;
  /** G1: world persistence (C++ IWorldManager) — created in init(). */
  worldManager!: WorldManager;
  /** Phase G: dungeon documents, entrances and instances. */
  readonly dungeons: DungeonManager;
  /** Last-known player state by name (G1) — restored positions survive
   *  relog within a session and feed the players[] save section. */
  private readonly savedPlayers = new Map<string, SavedPlayer>();

  // ── Time (C++ m_worldTime, m_startTime, etc.) ─────────────────
  private startTime: number;
  private prevUpdateTime: number;
  private worldTime: number; // seconds
  private worldTimeMultiplier: number;

  // ── Run state ──────────────────────────────────────────────────
  private running: boolean;
  private updateTimer: ReturnType<typeof setInterval> | null;
  private saveTimer: ReturnType<typeof setInterval> | null;
  private zdoSyncAccumulator: number;
  private timeSyncAccumulator: number;

  // ── Server identity ────────────────────────────────────────────
  readonly serverUserId: bigint;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.serverUserId = 1n; // Server is always user 1

    // Initialize subsystems
    this.zdos = new ZDOManager(this.serverUserId);
    this.prefabs = new PrefabManager();
    // Die Höhenabfrage als Closure: `this.heightmaps` entsteht erst in
    // `init()`, der Aufruf erfolgt aber immer später (bei einem Befehl).
    this.adminCommands = new AdminCommandRegistry({
      bodenHoehe: (x, z) => this.getGroundHeight(x, z),
    });
    // Phase G: dungeon system — documents live next to the world saves.
    // Je Instanz ein eigener Unterordner: entrances.json bildet WELT-Eingänge
    // auf Dungeon-IDs ab und wird aus den gebuchten Feature-Instanzen des
    // Layouts gefüllt. Sobald welten/dev.json und welten/live.json
    // auseinanderlaufen, zeigten gemeinsame Einträge auf Locations, die es in
    // der anderen Instanz nicht gibt — der Eingang stünde im Nichts, und die
    // erste Zuweisung des einen Servers verböge die Karte des anderen.
    // Geschlüsselt über worldName, weil das bereits der Instanzname ist
    // (main.ts: worldName = WOV_INSTANZ) und Spielstand wie Placement-Cache
    // schon daran hängen. Verworfen: instanzName() direkt lesen — dann wären
    // Tests und Werkzeuge ohne gesetzte Variable in einem anderen Ordner
    // gelandet als der Server, der sie mit derselben Config startet.
    this.dungeons = new DungeonManager(
      this.zdos,
      resolve(this.config.worldsDir, '..', 'dungeons', this.config.worldName)
    );
    this.registerDungeonCommands();
    this.registerSpawnCommand();
    this.registerAbbauCommand();
    // Karten-Marker: Eingangs-Änderungen an alle Peers verteilen.
    this.dungeons.onEntrancesChanged = () => {
      for (const peer of this.net.getPeers()) this.sendDungeonEntrances(peer);
    };
    this.net = new NetManager({
      port: this.config.port,
      password: this.config.password,
      serverName: this.config.name,
      maxPlayers: this.config.maxPlayers,
      everyoneAdmin: this.config.everyoneAdmin,
    });

    // Time
    this.startTime = Date.now();
    this.prevUpdateTime = this.startTime;
    this.worldTime = TIME_DAY; // start at morning
    this.worldTimeMultiplier = 1;

    // State
    this.running = false;
    this.updateTimer = null;
    this.saveTimer = null;
    this.zdoSyncAccumulator = 0;
    this.timeSyncAccumulator = 0;

    // Wire up network callbacks
    this.net.onPeerAuthenticated = (peer) => this.onPeerAuthenticated(peer);
    this.net.onPeerQuit = (peer) => this.onPeerQuit(peer);
    this.net.onPacket = (peer, type, reader) => this.onPacket(peer, type, reader);
  }

  // ── Lifecycle (C++ init/update/uninit, Start/Stop) ─────────────

  init(): void {
    console.log('[WoV] Initializing...');

    // Load prefabs
    this.prefabs.registerDefaults();

    // D6: world generation (lakes/rivers/streams + heightmap provider).
    // This is the same GeoManager the C++ server and the client run —
    // identical seed ⇒ identical world.
    const t0 = Date.now();
    // Layout-Modus: das WorldLayout-Dokument von Platte lesen. Fehlt oder
    // ist es unbrauchbar, wird HART abgebrochen — ein stiller Rückfall auf
    // die Radialwelt würde eine völlig andere Welt über den Save legen.
    if (this.config.worldMode === 'layout') {
      const roh = readFileSync(this.config.worldLayoutPath, 'utf-8');
      this.worldLayoutRaw = JSON.parse(roh) as unknown;
    }
    // Layout-Modus: Der detailSeed des Dokuments ist maßgeblich — das
    // Dokument definiert die Welt VOLLSTÄNDIG (Editor, MCP-Probe, Server
    // und Client rechnen sonst mit verschiedenen Detail-Rauschen).
    const layoutSeed =
      this.config.worldMode === 'layout'
        ? (sanitizeWorldLayout(this.worldLayoutRaw)?.detailSeed ?? this.config.worldSeed)
        : this.config.worldSeed;
    this.geo = createGeo({
      mode: this.config.worldMode,
      worldSeed: getStableHash(layoutSeed),
      layout: this.worldLayoutRaw ?? undefined,
      settings: {
        worldGenVersion: this.config.worldGenVersion,
        disableDistantRivers: this.config.worldDisableDistantRivers,
        riverAffectsOcean: this.config.worldRiverAffectsOcean,
        ashlandsModernNoise: this.config.worldAshlandsModernNoise,
      },
    });
    if (this.config.worldMode === 'layout') {
      console.log(
        `[WoV] WorldLayout "${(this.worldLayoutRaw as { name?: string })?.name}" geladen (${this.config.worldLayoutPath})`
      );
    }
    this.heightmaps = new HeightmapProvider(this.geo, {
      blendSmoothStep: this.config.worldBlendSmoothStep,
      bilinearSampling: this.config.worldBilinearHeight,
    });
    // E2/E3: vegetation zone population (C++ IZoneManager)
    this.zones = new ZoneManager(
      this.geo,
      this.heightmaps,
      this.zdos,
      getStableHash(this.config.worldSeed),
      {
        worldFeatures: this.config.worldFeatures,
        worldVegetation: this.config.worldVegetation,
        locationOverrides: this.config.worldLocationOverrides,
        dungeonsEnabled: this.config.dungeonsEnabled,
      }
    );
    console.log(`[WoV] Worldgen ready in ${Date.now() - t0}ms (seed "${this.config.worldSeed}")`);

    // Phase G: dungeon documents/entrances from disk, then wire the
    // ZoneManager hook — a location materializing a DG_* piece registers a
    // world entrance with an auto-generated dungeon document.
    this.dungeons.load();
    this.zones.onDungeonPiece = (featureName, dgHash, zoneKey, pos, seed) => {
      const entrance = this.dungeons.registerEntrance(featureName, dgHash, zoneKey, pos, seed);
      // Sichtbare Hülle gleich mitspawnen (Set-dedupe im Manager) — greift
      // nur für Eingänge, die der Boot-Backfill noch nicht kannte.
      if (entrance) this.dungeons.spawnEntranceHull(entrance);
    };

    // F2: C++ PostGeoInit — book ALL feature instances globally, once,
    // before any zone generates (StartTemple existence enforced inside).
    // Placement-Cache: gültig für exakt (Seed, genVersion, Layout-Hash,
    // Feature-Anzahl) — sonst neu würfeln und Cache erneuern.
    const placementCachePfad = resolve(
      this.config.worldsDir,
      `${this.config.worldName}.locations.json`
    );
    const cacheSchluessel = JSON.stringify({
      seed: this.config.worldSeed,
      gen: this.config.worldGenVersion,
      layout: this.worldLayoutHash(),
      features: FEATURES.length,
    });
    let placementAusCache = false;
    try {
      if (existsSync(placementCachePfad)) {
        const roh = JSON.parse(readFileSync(placementCachePfad, 'utf-8')) as {
          schluessel: string;
          eintraege: Array<{ key: string; feature: string; pos: Vector3 }>;
        };
        if (roh.schluessel === cacheSchluessel) {
          placementAusCache = this.zones.importFeatures(roh.eintraege);
        }
      }
    } catch (err) {
      console.warn(`[WoV] Placement-Cache unlesbar (${err}) — würfle neu`);
    }
    this.zones.prepareFeatures();
    if (!placementAusCache) {
      try {
        writeFileSync(
          placementCachePfad,
          JSON.stringify({ schluessel: cacheSchluessel, eintraege: this.zones.exportFeatures() })
        );
      } catch (err) {
        console.warn(`[WoV] Placement-Cache nicht schreibbar: ${err}`);
      }
    }

    // Phase G: Eingänge aus den GEBUCHTEN Locations nachfüllen — auf einem
    // bestehenden Save laufen generierte Zonen nie wieder durch
    // generateFeature, die Weltkarte soll aber trotzdem jede Krypta/Höhle
    // zeigen. Dokumente entstehen weiterhin lazy beim ersten Betreten.
    //
    // Block A: nur wenn Dungeons überhaupt an sind. Der Zonen-Hook prüft die
    // Fahne längst (ZoneManager: dungeonsEnabled && DUNGEON-Flag), dieser
    // Nachfüllpfad lief bisher als einziger daran vorbei — mit
    // dungeons.enabled=false buchte er trotzdem 316 Eingänge, und der Client
    // bekam über sendDungeonEntrances 316 Kartenmarken auf Krypten, die weder
    // sichtbar noch betretbar sind. Die Hüllen-Sperre allein hätte nur die
    // ZDOs verhindert, nicht die Marken.
    if (this.config.dungeonsEnabled) {
      const dungeonPieceByFeature = new Map<string, number>();
      for (const f of FEATURES) {
        const piece = getFeaturePieces(f.name).find((p) => {
          const pf = findPrefabByHash(p.prefabHash);
          return pf !== undefined && (pf.flags & PrefabFlag.DUNGEON) !== 0n;
        });
        if (piece) dungeonPieceByFeature.set(f.name, piece.prefabHash);
      }
      const booked = this.zones
        .getFeatureInstances()
        .flatMap((b) => {
          const dgPrefabHash = dungeonPieceByFeature.get(b.name);
          if (!dgPrefabHash) return [];
          return [
            {
              zoneKey: `${b.zone.x},${b.zone.y}`,
              featureName: b.name,
              dgPrefabHash,
              pos: b.pos,
            },
          ];
        });
      this.dungeons.backfillFromFeatures(booked, getStableHash(this.config.worldSeed));
    }

    // G1: C++ WorldManager::LoadFileDB — restore worldTime, generated
    // zones and persistent ZDOs when a save exists (fresh world otherwise).
    // Must run AFTER prepareFeatures: restored zones skip generation, and
    // restoreGeneratedZones replays their terrain modifiers against the
    // freshly booked feature instances.
    this.worldManager = new WorldManager(
      this.config.worldsDir,
      this.config.worldName,
      this.config.worldSeed,
      this.config.worldGenVersion,
      this.worldLayoutHash()
    );
    this.loadWorld();

    // Multi-World-Fundament (Review 15): Die Hauptwelt als WorldContext —
    // die Felder oben ZEIGEN auf dieselben Bausteine; künftige Welten
    // (Housing) werden weitere Einträge dieser Map.
    this.welten.set(HAUPTWELT_ID, {
      id: HAUPTWELT_ID,
      geo: this.geo,
      heightmaps: this.heightmaps,
      zones: this.zones,
      zdos: this.zdos,
      worldManager: this.worldManager,
    });

    // Phase G: Camps (Dörfer, Farmen, GoblinCamps) in bereits generierten
    // Zonen nachziehen — vor dem Camp-Generator wurden sie übersprungen.
    this.zones.backfillCamps();

    // Phase G: sichtbare Eingangs-Hüllen (Crypt2-Steinbau …) für ALLE
    // bekannten Eingänge. Zwingend NACH loadWorld: createZDO vergibt IDs ab
    // nextUid, und der steht erst nach dem Restore hinter den gespeicherten
    // IDs — vorher gespawnte Hüllen würden mit restaurierten ZDOs
    // kollidieren. Hüllen sind nicht persistent und entstehen hier bei
    // jedem Boot neu.
    this.dungeons.spawnAllEntranceHulls();

    // G2: creature spawning — AFTER loadWorld so creatures restored from
    // the save can be adopted (their spawn position = wander anchor).
    if (this.config.worldCreatures) {
      this.spawns = new SpawnSystem(this.zdos, this.geo, this.heightmaps, this.zones);
      // Kampf: Kreaturen-Treffer auf Spieler routen (Chase-Modus).
      this.spawns.onCreatureAttack = (pos, dmg, r) => this.applyCreatureAttack(pos, dmg, r);
      this.spawns.adoptPersisted();
      // Eigene NPCs wandern passiv; gespeicherte Bosse behalten ihre KI.
      for (const zdo of this.zdos.getZDOByPrefab(getStableHash('NPC_1'))) {
        this.spawns.adoptSingle(zdo, NPC_ENTRY);
      }
      for (const zdo of this.zdos.getZDOByPrefab(EIKTHYR_HASH)) {
        this.spawns.adoptSingle(zdo, BOSS_ENTRY);
      }
      if (this.spawns.creatureCount > 0) {
        console.log(`[WoV] Creatures: adopted ${this.spawns.creatureCount} from save`);
      }
    }

    // TODO: Load prefabs.pkg

    // NOTE: spawnDemoWorld was removed in Phase E (E5) — the world is now
    // populated by the real vegetation system (ZoneManager).

    // Routen-NPCs: MUSS vor spawnLayoutPlacements stehen — dort werden die
    // Platzierungen mit `route` angemeldet. Die Höhe kommt bewusst über
    // getGroundHeight (dieselbe Quelle wie Spawn-Höhe und Kreaturen), damit
    // der NPC dem Gelände folgt, statt eine gespeicherte Höhe zu tragen.
    this.routen = new RoutenLaeufer(this.zdos, (x, z) => this.getGroundHeight(x, z));

    // Kampf: feindliche NPCs wenden sich dem Spieler zu und schlagen zu.
    // Braucht kein Register — es sucht selbst um die Spieler herum (s.
    // AggroSystem). Der RoutenLaeufer bekommt nur die Menge der NPCs, die
    // gerade kämpfen, damit er ihnen nicht ins Steuer greift.
    this.aggro = new AggroSystem(
      this.zdos,
      (hash) => this.prefabs.getByHash(hash)?.name,
      (x, z) => this.getGroundHeight(x, z)
    );
    this.routen.gesperrt = this.aggro.gesperrt;

    this.spawnLayoutPlacements();

    console.log('[WoV] Initialized');
  }

  /**
   * Handplatzierte Objekte des WorldLayouts (Editor-Spawn) materialisieren.
   *
   * Bewusst beim BOOT statt bei der Zonengenerierung: So erscheinen neue
   * Platzierungen auch in bereits generierten Zonen. Idempotent über eine
   * Kennung im ZDO-Member `layoutId`, ersatzweise eine Nähe-Prüfung
   * (gleiches Prefab < 0,5 m) — persistente ZDOs aus dem Save werden nicht
   * dupliziert. Entfernen einer Platzierung entfernt bereits gespawnte
   * Objekte NICHT (dafür Welt-Reset oder Admin-Abbau).
   *
   * Hier werden auch die Routen verdrahtet: Trägt eine Platzierung eine
   * `route`, übernimmt der RoutenLaeufer die ZDO (s. dort).
   */
  private spawnLayoutPlacements(): void {
    if (this.config.worldMode !== 'layout') return;
    const layout = sanitizeWorldLayout(this.worldLayoutRaw);
    if (!layout?.placements?.length) return;
    let neu = 0;
    let unbekannt = 0;
    // Kennung je Eintrag: Prefab + gerundete Position (layoutKennung in
    // shared). Damit lassen sich beim Boot ZDOs entfernen, deren Eintrag der
    // Designer gelöscht hat (vorher blieben sie für immer stehen,
    // Review-Punkt 13) — und der Client findet über denselben Member den
    // Layout-Eintrag zu einer Instanz wieder (Namensschild).
    const kennung = layoutKennung;
    const gewollt = new Set(layout.placements.map(kennung));
    let entfernt = 0;
    // Im selben Durchlauf einen Index über die Kennung aufbauen: Ein
    // Routen-NPC ist beim nächsten Boot IRGENDWO auf seiner Runde, die
    // Nähe-Prüfung unten fände ihn also nicht wieder und spawnte bei jedem
    // Start einen weiteren. Die Kennung wandert dagegen mit ihm mit.
    const nachKennung = new Map<string, ZDO>();
    for (const zdo of this.zdos.getAllZDOs()) {
      const id = zdo.getString(LAYOUT_ID_MEMBER);
      if (!id) continue;
      if (!gewollt.has(id)) {
        this.zdos.destroyZDO(zdo.zdoid);
        entfernt++;
        continue;
      }
      nachKennung.set(id, zdo);
    }
    const routen = new Map((layout.routes ?? []).map((r) => [r.id, r]));
    let aufRoute = 0;
    for (const p of layout.placements) {
      const prefab = this.prefabs.getByName(p.prefab);
      if (!prefab) {
        unbekannt++;
        continue;
      }
      const y = this.getGroundHeight(p.x, p.z);
      const pos = { x: p.x, y, z: p.z };
      let zdo = nachKennung.get(kennung(p));
      if (zdo && zdo.prefabHash !== prefab.hash) zdo = undefined;
      if (!zdo) {
        const vorhanden = this.zdos
          .getZDOsInRadius(pos, 1)
          .find((z) => z.prefabHash === prefab.hash && Math.hypot(z.position.x - p.x, z.position.z - p.z) < 0.5);
        zdo = vorhanden;
      }
      if (!zdo) {
        const yaw = p.yaw ?? 0;
        zdo = this.zdos.createZDO(prefab.hash, pos);
        zdo.rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
        if (p.scale !== undefined && Math.abs(p.scale - 1) > 1e-3) zdo.setFloat('scaleScalar', p.scale);
        zdo.setString(LAYOUT_ID_MEMBER, kennung(p));
        neu++;
      } else if (zdo.getString(LAYOUT_ID_MEMBER) !== kennung(p)) {
        // Über die NÄHE wiedergefunden (ZDO aus einem Save von vor der
        // Kennung): Member nachtragen. Sonst bliebe das Objekt für immer
        // ohne Herkunft — der Client könnte ihm kein Namensschild
        // zuordnen, und beim nächsten Löschen im Editor bliebe es stehen.
        zdo.setString(LAYOUT_ID_MEMBER, kennung(p));
      }
      // Trefferpunkte für alles, was eine FIGUR ist. Die Prüfung auf
      // `istNpcPrefab` ist nicht Zierde: In derselben Schleife entstehen
      // auch Häuser, Steine und Bäume, und die tragen `health` bereits mit
      // einer ganz anderen Bedeutung (handleHarvest zählt damit die
      // Axtschläge bis zum Fällen). Ein Lebensbalken über einer Fichte
      // wäre das kleinere Übel — ein Startwert aus der Figurentabelle in
      // ihrem Ernte-Zähler das größere.
      if (istNpcPrefab(p.prefab) && zdo.getInt(HEALTH_MEMBER) <= 0) {
        zdo.setInt(HEALTH_MEMBER, maxLeben(p.prefab));
        zdo.revision.reviseData();
        zdo.dirty = true;
      }
      // Route anhängen. Ein unbekannter Name lässt das Objekt schlicht
      // stehen (pruefeLayout meldet ihn unten) — eine halb gespawnte Welt
      // wäre der schlechtere Tausch.
      const route = p.route ? routen.get(p.route) : undefined;
      if (route) {
        // Der NPC gehört jetzt der Route: Aus der Kreatur-Simulation
        // nehmen, sonst zerren Wander-KI und Route an derselben Position
        // (NPC_1-ZDOs werden beim Boot adoptiert, s. init()).
        this.spawns?.entlasse(zdo);
        this.routen?.registriere(zdo, route);
        aufRoute++;
      }
    }
    if (aufRoute > 0) console.log(`[WoV] Layout-Routen: ${aufRoute} NPC(s) laufen eine Route`);
    if (neu > 0 || unbekannt > 0 || entfernt > 0) {
      console.log(
        `[WoV] Layout-Platzierungen: ${neu} gespawnt, ${entfernt} verwaiste entfernt, ${unbekannt} unbekannte Prefabs übersprungen`
      );
    }
    // Inhaltlicher Bericht (Review-Punkt 32): unbekannte Namen und ein
    // fehlender Startpunkt stehen jetzt im Boot-Log statt still zu bleiben.
    for (const b of pruefeLayout(layout)) {
      console.warn(`[WoV] Layout-Hinweis (${b.wo}): ${b.text}`);
    }
  }

  /**
   * Start-/Respawn-Punkt der Welt. Im Layout-Modus aus dem Dokument
   * (defaultSpawn, sonst der erste Kontinent mit eigenem Spawn) — der
   * Ursprung kann dort offener Ozean sein (Review-Punkt 32).
   */
  private weltSpawn(): Vector3 {
    const layout = this.config.worldMode === 'layout' ? sanitizeWorldLayout(this.worldLayoutRaw) : null;
    const punkt = layout?.defaultSpawn ?? layout?.continents.find((k) => k.spawn)?.spawn;
    const x = punkt ? punkt[0] : 0;
    const z = punkt ? punkt[1] : 0;
    // 1,5 m ueber dem Gelaende statt exakt darauf: Der Startpunkt kann in
    // einem Bauwerk mit eigenem Boden liegen (Grabhuegel-Kammer, Steinboden
    // 1 m ueber Gelaende gegen durchwoelbendes Terrain). Wer exakt auf
    // Gelaendehoehe erscheint, steckt dort IN der Bodenplatte — die
    // Havok-Depenetration drueckt dann unvorhersehbar nach oben oder
    // unten. Aus 1,5 m faellt man dagegen ueberall nur kurz und landet
    // auf dem, was tatsaechlich da ist (Bett-Respawns setzen aus
    // demselben Grund schon immer +0,6 m drauf).
    return { x, y: this.getGroundHeight(x, z) + 1.5, z };
  }

  /** Hash des aktiven WorldLayouts (Layout-Modus, sonst null) — Save-Meta. */
  worldLayoutHash(): number | null {
    if (this.config.worldMode !== 'layout' || !this.worldLayoutRaw) return null;
    const sauber = sanitizeWorldLayout(this.worldLayoutRaw);
    return sauber ? getStableHash(JSON.stringify(sauber)) : null;
  }

  /** Ground height via the shared heightmap (D6 server ground truth). */
  getGroundHeight(x: number, z: number): number {
    return this.heightmaps.getGroundHeight(x, z);
  }

  start(): void {
    this.init();

    this.running = true;
    this.startTime = Date.now();
    this.prevUpdateTime = this.startTime;

    // Start network
    this.net.start();

    // Main update loop (~60fps server tick)
    const TICK_MS = 1000 / 30; // 30 ticks per second
    this.updateTimer = setInterval(() => {
      this.update();
    }, TICK_MS);

    // Periodic world save — D8: asynchron, damit die 30-Minuten-Sicherung
    // nicht jedes Mal den Sync-Takt aussetzen lässt. Beim Herunterfahren
    // bleibt es beim synchronen Weg (s. stop()).
    this.saveTimer = setInterval(() => {
      void this.saveWorldAsync();
    }, this.config.saveIntervalMs);

    console.log(`[WoV] Server started: "${this.config.name}" on port ${this.config.port}`);
    console.log(`[WoV] World: ${this.config.worldName} (seed: ${this.config.worldSeed})`);
  }

  stop(): void {
    this.running = false;

    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);

    // Beim Herunterfahren bewusst SYNCHRON: `stop()` läuft im Signal-Handler,
    // und ein Prozess, der gleich beendet wird, arbeitet keine Promises mehr
    // ab — ein asynchroner Save käme nie bis zum `rename`.
    this.saveWorld();
    this.net.stop();

    console.log('[WoV] Server stopped');
  }

  // ── Main update loop (C++ update()) ────────────────────────────

  /** Letzter Timeout-Prüflauf (alle ~5 s reicht). */
  private letzteTimeoutPruefung = 0;

  private update(): void {
    const timeoutJetzt = Date.now();
    if (timeoutJetzt - this.letzteTimeoutPruefung > 5000) {
      this.letzteTimeoutPruefung = timeoutJetzt;
      this.net?.pruefeTimeouts();
    }
    const now = Date.now();
    const deltaMs = now - this.prevUpdateTime;
    const deltaSec = deltaMs / 1000;
    this.prevUpdateTime = now;

    // Advance world time
    this.worldTime += deltaSec * this.worldTimeMultiplier;

    // Update network (player list, etc.)
    this.net.update(deltaMs);

    // E3: generate vegetation zones around players (C++ TryGenerateNearbyZones
    // per peer; budgeted drain instead of C++'s blocking inline generation)
    const peers = this.net.getPeers();
    if (peers.length > 0) {
      // Phase G: peers inside dungeon instances don't drive overworld
      // systems — no vegetation zones or creature spawning in the band.
      const peerPositions = peers
        .filter((p) => !isInDungeonBand(p.position.x))
        .map((p) => p.position);
      if (peerPositions.length > 0) {
        const generatedNow = this.zones.update(peerPositions);
        if (generatedNow > 0) {
          console.log(
            `[WoV] Vegetation: +${generatedNow} zone(s) (${this.zones.generatedZoneCount} total, ${this.zdos.totalZDOCount} ZDOs)`
          );
        }

        // G2: creature spawn/despawn + wander simulation around players
        this.spawns?.update(deltaSec, peerPositions);

        // Routen-NPCs laufen ihre Wegpunkte ab (autoritativ wie die
        // Kreaturen; die Position geht über den normalen ZDO-Sync raus).
        this.routen?.update(deltaSec, peerPositions);

        // Kampf NACH den Routen: Das AggroSystem darf das letzte Wort
        // haben. Läuft ein NPC gerade und bekommt in diesem Tick Aggro,
        // überschreibt es das eben gesetzte 'walk' mit 'attack' — nicht
        // umgekehrt.
        this.aggro?.update(deltaSec, peerPositions);
      }
    }

    // ZDO sync at fixed interval (C++ ZDO send-interval: 50ms)
    this.zdoSyncAccumulator += deltaMs;
    if (this.zdoSyncAccumulator >= ZDO_SEND_INTERVAL_MS) {
      this.zdoSyncAccumulator -= ZDO_SEND_INTERVAL_MS;
      this.syncZDOs();
    }

    // Send time sync every second. Previously TimeSync was only sent at
    // connect and on setTimeOfDay, so the client's HUD clock and day/night
    // lighting stayed frozen at their connect-time value for the whole
    // session (worldTime itself advances above, clients just never learned).
    this.timeSyncAccumulator += deltaMs;
    if (this.timeSyncAccumulator >= 1000) {
      this.timeSyncAccumulator -= 1000;
      for (const peer of this.net.getPeers()) {
        this.sendTimeSync(peer);
      }
      // Essens-Regeneration: 2 HP/s solange ein Buff wirkt.
      for (const peer of this.net.getPeers()) {
        if (now < peer.foodBis && peer.health < this.maxHealth(peer)) {
          peer.health = Math.min(this.maxHealth(peer), peer.health + 2);
          this.sendPlayerState(peer);
        } else if (peer.foodBis !== 0 && now >= peer.foodBis) {
          // Buff ausgelaufen: Obergrenze faellt zurueck, HP kappen.
          peer.foodBis = 0;
          peer.foodBonus = 0;
          peer.health = Math.min(100, peer.health);
          this.sendPlayerState(peer);
        }
      }
      // Dungeon-Regeneration: leere Instanzen nach Ablauf abreißen.
      this.dungeons.tick(now);
      this.eventTick(now);
    }
  }

  /** C++ sends the world clock periodically; see update() for why. */
  private sendTimeSync(peer: Peer): void {
    peer.sendPacketWith(PacketType.TimeSync, (w) => {
      w.writeFloat64(this.worldTime);
      w.writeFloat64(this.getTimeOfDay());
      w.writeInt32(this.getDay());
    });
  }

  // ── ZDO Sync (C++ IZDOManager::SendZDOs) ───────────────────────

  /**
   * G-POP: 4 Zonen = 256 m, wie der Terrain-Radius des Clients — bei 192 m
   * blieb am sichtbaren Rand ein dauerhaft objektfreier Ring stehen.
   */
  private static readonly SICHT_RADIUS_ZONEN = 4;

  /**
   * Wiederverwendete Merkliste der in diesem Tick geschriebenen ZDOs. Als
   * lokale Variable wäre sie eine Allokation je Peer und Tick — bei 20 Hz
   * genau das Kleinvieh, das den GC beschäftigt.
   */
  private readonly sendePuffer: ZDO[] = [];

  /**
   * D6 — ZDO-Sync mit Bandbreitenbudget, Nahpriorität und Member-Deltas.
   *
   * Drei Bremsen gegen den alten O(Peers × 81 Zonen × ZDOs)-Durchlauf alle
   * 50 ms:
   *
   *  1. Das Sichtfenster kommt aus dem Cache (D7, `ZonenFenster`) und ist
   *     bereits ringweise nach Entfernung sortiert.
   *  2. Ein Bandbreitenbudget je Peer (C# ZDOMan.SendZDOs): Was in diesem
   *     Tick nicht mehr hineinpasst, bleibt schmutzig und geht im nächsten
   *     raus. Weil die Liste nah-zuerst läuft, verliert dabei immer das
   *     Entfernteste — genau richtig.
   *  3. Nur GEÄNDERTE Member statt des vollen Satzes (s. writeZDO).
   */
  private syncZDOs(): void {
    const peers = this.net.getPeers();
    // Zerstörungen einmal je Tick abholen und je Peer anstauen: Ein Peer
    // kann wegen des Budgets einen Tick auslassen, und eine global
    // verbrauchte Liste wäre für ihn dann für immer weg (Leiche in der
    // Welt). Ohne Spieler trotzdem leeren, sonst wächst sie unbegrenzt
    // (Review-Punkt 29).
    const destroyList = this.zdos.consumeDestroyList();
    if (peers.length === 0) return;
    if (destroyList.length > 0) {
      for (const peer of peers) peer.stelleZerstoerungenEin(destroyList);
    }

    const tick = Math.floor(this.worldTime * 1000);

    for (const peer of peers) {
      // Bandbreitenbudget (C# ZDOMan.SendZDOs:
      //   num = 10240 - sendQueueSize; if (num < 2048) return;).
      // Der Socket-Rückstau ist das Maß dafür, wie viel die Leitung des
      // Peers gerade wirklich abnimmt. Wer schon zusteht, bekommt nichts
      // obendrauf — genau das verhindert, dass ein einziger langsamer
      // Client den Server-Speicher mit ungesendeten Puffern füllt.
      const budget = ZDO_MAX_SEND_THRESHOLD - peer.sendeRueckstau;
      if (budget < ZDO_MIN_SEND_THRESHOLD) continue;

      const peerZone = worldToZone(peer.position);
      const fenster = peer.fenster.hole(
        this.zdos,
        peerZone.x,
        peerZone.y,
        WovServer.SICHT_RADIUS_ZONEN
      );
      const zerstoerungen = peer.offeneZerstoerungen;
      if (fenster.length === 0 && zerstoerungen.length === 0) continue;

      // Wie viele Sätze ins Budget passen, weiß man erst hinterher — also
      // Platzhalter schreiben und die Zahl am Ende nachtragen. Das spart
      // gegenüber einem zweiten Writer eine Vollkopie des Pakets je Peer
      // und Tick.
      const writer = new Writer(2048);
      writer.writeInt32(tick); // Tick number for reconciliation
      const zaehlerStelle = writer.geschrieben;
      writer.writeInt32(0);

      let anzahl = 0;
      const gesendet = this.sendePuffer;
      gesendet.length = 0;
      for (const zdo of fenster) {
        const stand = peer.syncStand(zdo.zdoid);
        if (
          stand &&
          stand.dataRevision === zdo.revision.dataRevision &&
          stand.ownerRevision === zdo.revision.ownerRevision
        ) {
          continue; // Peer ist auf Stand
        }
        this.writeZDO(writer, zdo, stand?.dataRevision);
        anzahl++;
        gesendet.push(zdo);
        if (writer.geschrieben >= budget) break;
      }

      if (anzahl === 0 && zerstoerungen.length === 0) continue;
      writer.patchInt32(zaehlerStelle, anzahl);

      // Zerstörungen: gehen IMMER mit raus, sie sind winzig und ihr Verlust
      // wäre dauerhaft sichtbar.
      writer.writeInt32(zerstoerungen.length);
      for (const zdoid of zerstoerungen) {
        writer.writeString(zdoid.userId.toString());
        writer.writeInt32(zdoid.id);
        peer.removeKnownZDO(zdoid);
      }
      peer.quittiereZerstoerungen();

      peer.sendPacket(PacketType.ZDOSync, writer.toBuffer());
      // Erst nach dem Absenden buchen — sonst gilt ein ZDO als zugestellt,
      // das wegen des Budgets gar nicht mehr im Paket war.
      for (const zdo of gesendet) {
        peer.markZDOSent(zdo.zdoid, zdo.revision.dataRevision, zdo.revision.ownerRevision);
      }
      gesendet.length = 0;
    }
  }

  /**
   * Ein ZDO-Satz. `peerRev` ist die Datenrevision, die der Peer zuletzt
   * bekommen hat; `undefined` heißt „kennt das ZDO nicht" → Vollstand.
   *
   * Drahtformat (Bit 0 von `satzFlags` unterscheidet die beiden Fälle):
   *
   *   uint8   satzFlags   Bit0 = Vollstand, Bit1 = Besitzer folgt
   *   string  userId
   *   int32   id
   *   int32   prefabHash  NUR im Vollstand (ändert sich nie)
   *   vec3    position
   *   quat    rotation
   *   uint32  revision
   *   uint8   flags       NUR im Vollstand (wird nur beim Anlegen gesetzt)
   *   string  ownerUserId }
   *   int32   ownerId     } nur bei Bit1
   *   int32   memberCount
   *   memberCount × { int32 hash, uint8 type, wert }
   *
   * Im Delta stehen nur die Member, die seit `peerRev` geschrieben wurden
   * (s. ZDOMember.rev). Eine laufende Kreatur schickte bisher 4×/s ihren
   * kompletten Member-Satz an jeden Peer in Reichweite, obwohl sich daran
   * nichts geändert hatte — jetzt sind es null Member.
   *
   * Die Erstübertragung ist immer vollständig: Ohne Eintrag in `knownZDOs`
   * hat der Peer nichts, worauf ein Delta aufsetzen könnte. Dasselbe gilt
   * nach einer Member-Entfernung (die ein Delta nicht ausdrücken kann) und
   * nach dem Überlauf der 23-Bit-Datenrevision — dann ist `peerRev` größer
   * als die aktuelle Revision, und der Vergleich wäre wertlos.
   */
  private writeZDO(w: Writer, zdo: ZDO, peerRev: number | undefined): void {
    const datenRev = zdo.revision.dataRevision;
    const voll =
      peerRev === undefined || peerRev > datenRev || zdo.entfernungsRevision > peerRev;
    const hatBesitzer = !zdo.owner.isNone();

    w.writeUInt8((voll ? 1 : 0) | (hatBesitzer ? 2 : 0));
    w.writeString(zdo.zdoid.userId.toString());
    w.writeInt32(zdo.zdoid.id);
    if (voll) w.writeInt32(zdo.prefabHash);
    w.writeVector3(zdo.position);
    w.writeQuaternion(zdo.rotation);
    w.writeUInt32(zdo.revision.raw);
    if (voll) w.writeUInt8(zdo.flags);
    if (hatBesitzer) {
      w.writeString(zdo.owner.userId.toString());
      w.writeInt32(zdo.owner.id);
    }

    const members = zdo.getMembers();
    if (voll) {
      w.writeInt32(members.size);
      for (const [hash, member] of members) {
        w.writeInt32(hash);
        w.writeUInt8(member.type);
        w.writeByTypeTag(member.type, member.value);
      }
      return;
    }

    // Zweimal durchzählen statt einer Zwischenliste: Der Satz hat selten
    // mehr als eine Handvoll Member, und eine Allokation je ZDO und Tick
    // ist bei 20 Hz teurer als die zweite Schleife.
    let neue = 0;
    for (const member of members.values()) if (member.rev > peerRev!) neue++;
    w.writeInt32(neue);
    if (neue === 0) return;
    for (const [hash, member] of members) {
      if (member.rev <= peerRev!) continue;
      w.writeInt32(hash);
      w.writeUInt8(member.type);
      w.writeByTypeTag(member.type, member.value);
    }
  }

  // ── Peer lifecycle ─────────────────────────────────────────────

  private onPeerAuthenticated(peer: Peer): void {
    // D6: world info first — the client builds its GeoManager from this
    // and swaps the placeholder terrain for the real world (D3).
    peer.sendPacketWith(PacketType.ServerConfig, (w) => {
      w.writeString(this.config.worldName);
      w.writeString(this.config.worldSeed);
      w.writeInt32(this.config.worldGenVersion);
      let flags = 0;
      if (this.config.worldBlendSmoothStep) flags |= FLAG_BLEND_SMOOTHSTEP;
      if (this.config.worldBilinearHeight) flags |= FLAG_BILINEAR_HEIGHT;
      if (this.config.worldAshlandsModernNoise) flags |= FLAG_ASHLANDS_MODERN;
      if (this.config.worldRiverAffectsOcean) flags |= FLAG_RIVER_AFFECTS_OCEAN;
      if (this.config.worldDisableDistantRivers) flags |= FLAG_DISABLE_DISTANT_RIVERS;
      if (this.config.worldMode === 'layout') flags |= FLAG_LAYOUT_MODE;
      w.writeUInt8(flags);
    });
    // Layout-Modus: Das Weltdokument folgt SOFORT auf die ServerConfig —
    // der Client wartet darauf, bevor er seine Welt baut (Flag Bit 5).
    if (this.config.worldMode === 'layout' && this.worldLayoutRaw) {
      peer.sendPacketWith(PacketType.WorldLayoutData, (w) => {
        w.writeString(JSON.stringify(this.worldLayoutRaw));
      });
    }

    // Create player character ZDO — spawn at the saved position (G1) or on
    // the real ground at the world spawn (D6)
    const playerPrefab = this.prefabs.getByName('Player');
    const saved = this.savedPlayers.get(peer.name);
    // Phase G: never respawn inside the dungeon band — the instance the
    // player was in may no longer exist (onPeerQuit stores the return
    // position, this is only the belt for crashes/old saves).
    const savedPos =
      saved && !isInDungeonBand(saved.position.x) ? { ...saved.position } : null;
    const spawnPos: Vector3 = savedPos ?? this.weltSpawn();
    peer.flying = saved?.flying ?? false;
    peer.spawnPoint = saved?.spawnPoint ? { ...saved.spawnPoint } : null;

    const characterZDO = this.zdos.createZDO(
      playerPrefab?.hash ?? 0,
      spawnPos,
      { x: 0, y: 0, z: 0, w: 1 }
    );
    characterZDO.setOwner(new ZDOID(peer.userId, 0));
    peer.characterID = characterZDO.zdoid;
    peer.position = spawnPos;

    // Server-Inventar (Review-Punkt 8): aus dem Save wiederherstellen,
    // Neulinge bekommen die Startausrüstung SERVERSEITIG (der Client
    // startet mit leerem Inventar und lebt vom InventorySync).
    if (saved?.inventar) {
      peer.inventar.load(saved.inventar);
    } else {
      const START: Array<[string, number]> = [
        ['Hammer', 1], ['AxeFlint', 1], ['Hoe', 1], ['PickaxeAntler', 1],
        ['Cultivator', 1], ['Wood', 12], ['Stone', 30],
      ];
      for (const [name, menge] of START) {
        const def = findItem(name);
        if (def) peer.inventar.addItem(def, menge);
      }
    }
    this.inventarSync(peer);
    // Piece-Budget: eigene Bauten einmalig zählen (15k-ZDO-Scan, nur Login).
    const meineId = peer.userId.toString();
    peer.bautenAnzahl = this.zdos
      .getAllZDOs()
      .filter((z) => z.getInt('spieler') === 1 && z.getString('besitzer') === meineId).length;

    // Send initial time sync
    this.sendTimeSync(peer);
    this.sendPlayerState(peer);

    // Phase G: Dungeon-Eingänge für die Weltkarten-Marker
    this.sendDungeonEntrances(peer);
    // Terraforming: der frisch verbundene Client baut sein Terrain aus der
    // Weltgen — die Spieler-Grabungen muss er nachziehen. D9 schickt dafür
    // den ENDZUSTAND je bearbeiteter Zone statt jeder je ausgeführten
    // Operation; sonst wüchse die Join-Dauer linear mit der Spielzeit.
    this.sendeTerrainComps(peer);

    console.log(
      `[WoV] Player "${peer.name}" spawned at (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)}, ${spawnPos.z.toFixed(1)})${saved ? ' (restored)' : ''}`
    );
  }

  private onPeerQuit(peer: Peer): void {
    // Phase G: quitting inside a dungeon counts as leaving it — the saved
    // position is the overworld return point, never the instance band.
    if (peer.dungeonId) {
      this.dungeons.getInstance(peer.dungeonId)?.players.delete(peer.name);
      if (peer.dungeonReturn) peer.position = { ...peer.dungeonReturn };
      peer.dungeonId = null;
    }

    // G1: keep the last-known state — a same-session relog respawns here,
    // and the next world save writes it to the players[] section.
    this.savedPlayers.set(peer.name, {
      name: peer.name,
      position: { ...peer.position },
      flying: peer.flying,
      spawnPoint: peer.spawnPoint ?? undefined,
    });
    // Destroy player character ZDO
    if (!peer.characterID.isNone()) {
      this.zdos.destroyZDO(peer.characterID);
    }
    console.log(`[WoV] Player "${peer.name}" left`);
  }

  // ── Packet handling ────────────────────────────────────────────

  private onPacket(peer: Peer, type: PacketType, reader: Reader): void {
    switch (type) {
      case PacketType.PlayerInput:
        this.handlePlayerInput(peer, reader);
        break;
      case PacketType.ChatMessage:
        this.handleChatMessage(peer, reader);
        break;
      case PacketType.RpcCall:
        this.handleRpcCall(peer, reader);
        break;
      case PacketType.SetTimeOfDay:
        this.handleSetTimeOfDay(peer, reader);
        break;
      case PacketType.AdminCommand:
        this.handleAdminCommand(peer, reader);
        break;
      case PacketType.Interact:
        this.handleInteract(peer, reader);
        break;
      case PacketType.Attack:
        this.handleAttack(peer, reader);
        break;
      case PacketType.TerrainOp:
        this.handleTerrainOp(peer, reader);
        break;
      case PacketType.PlacePiece:
        this.handlePlacePiece(peer, reader);
        break;
      case PacketType.RemovePiece:
        this.handleRemovePiece(peer, reader);
        break;
      case PacketType.Craft:
        this.handleCraft(peer, reader);
        break;
      case PacketType.Eat:
        this.handleEat(peer, reader);
        break;
      case PacketType.DungeonEditRequest:
        this.handleDungeonEditRequest(peer, reader);
        break;
      case PacketType.DungeonEditSave:
        this.handleDungeonEditSave(peer, reader);
        break;
    }
  }

  /** Editor: aktuelles Dungeon-Dokument als JSON ausliefern (admin-gated). */
  private handleDungeonEditRequest(peer: Peer, reader: Reader): void {
    const requested = reader.readString();
    const sendData = (ok: boolean, message: string, json = '') => {
      peer.sendPacketWith(PacketType.DungeonEditData, (w) => {
        w.writeBool(ok);
        w.writeString(message);
        w.writeString(json);
      });
    };
    if (!peer.isAdmin) return sendData(false, 'Keine Berechtigung');
    const id = requested || peer.dungeonId || '';
    const doc = id ? this.dungeons.getDocument(id) : undefined;
    if (!doc) return sendData(false, `Unbekannter Dungeon: ${id || '(keiner)'}`);
    sendData(true, doc.id, JSON.stringify(doc));
  }

  /**
   * Editor: hochgeladenes Dokument sanitisieren, speichern und — wenn der
   * Peer gerade in diesem Dungeon steht — die Instanz neu materialisieren
   * und ihn wieder hineinteleportieren, damit die Änderung sofort sichtbar
   * ist (upsertDocument reisst die alte Instanz ab).
   */
  private handleDungeonEditSave(peer: Peer, reader: Reader): void {
    const json = reader.readString();
    const sendData = (ok: boolean, message: string, docJson = '') => {
      peer.sendPacketWith(PacketType.DungeonEditData, (w) => {
        w.writeBool(ok);
        w.writeString(message);
        w.writeString(docJson);
      });
    };
    if (!peer.isAdmin) return sendData(false, 'Keine Berechtigung');
    if (json.length > 2_000_000) return sendData(false, 'Dokument zu groß (max 2 MB)');

    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return sendData(false, 'Ungültiges JSON');
    }
    const doc = this.dungeons.upsertDocument(raw);
    if (!doc) return sendData(false, 'Dokument abgelehnt (Basis/ID/Räume ungültig)');

    if (peer.dungeonId === doc.id) {
      this.enterDungeon(peer, doc.id);
    }
    sendData(true, `Gespeichert: ${doc.id} (${doc.layout.rooms.length} Räume)`, JSON.stringify(doc));
    console.log(`[Dungeon] '${peer.name}' saved document '${doc.id}' (${doc.layout.rooms.length} rooms)`);
  }

  /**
   * Client sent an admin command line (e.g. "fly"). Dispatched to the
   * AdminCommandRegistry; the result goes back to the requesting peer as
   * AdminEvent (command / active / message) so the client HUD mirrors the
   * server state. Permission gate lives in AdminCommands.canUseAdminCommands.
   */
  private handleAdminCommand(peer: Peer, reader: Reader): void {
    const line = reader.readString();
    const result = this.adminCommands.execute(peer, line);

    const command = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    peer.sendPacketWith(PacketType.AdminEvent, (w) => {
      w.writeString(command);
      w.writeBool(result.active);
      w.writeString(result.message);
    });

    console.log(`[Admin] "${peer.name}" ran "${line}" → ${result.message}`);
  }

  /**
   * Client requested a new time of day (chosen on the connect screen).
   * Keeps the current day, sets the time within it, and broadcasts the
   * new time to all peers.
   */
  private handleSetTimeOfDay(peer: Peer, reader: Reader): void {
    let timeOfDay = reader.readFloat64();
    if (!Number.isFinite(timeOfDay)) return;

    // Wrap into [0, WORLD_TIME_LENGTH)
    timeOfDay = ((timeOfDay % WORLD_TIME_LENGTH) + WORLD_TIME_LENGTH) % WORLD_TIME_LENGTH;

    this.worldTime += timeOfDay - this.getTimeOfDay();

    console.log(`[WoV] "${peer.name}" set time of day to ${timeOfDay.toFixed(0)}s (day ${this.getDay()})`);

    // Broadcast the new time to all peers
    for (const p of this.net.getPeers()) {
      this.sendTimeSync(p);
    }
  }

  private handlePlayerInput(peer: Peer, reader: Reader): void {
    const seq = reader.readInt32();
    // Client-Werte HART klemmen: NaN/±1e9 in moveX vergiftete sonst
    // peer.position → Zonen-Schlüssel "NaN,NaN" → Save (Review-Punkt 4).
    const klemm1 = (v: number): number =>
      Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    const moveX = klemm1(reader.readFloat32());
    const moveZ = klemm1(reader.readFloat32());
    const lookYaw = reader.readFloat32();
    const lookPitch = reader.readFloat32();
    const moveY = reader.readFloat32();
    const running = reader.readBool();
    const jumping = reader.readBool();
    // lookYaw/lookPitch/jumping are read for protocol completeness but not
    // used server-side yet (character rotation, jump physics — later).

    peer.lastInputSeq = seq;

    // Server-authoritative movement
    const now = Date.now();
    // real elapsed time between input packets (fall speed needs wall time)
    const deltaSec = peer.lastInputTime > 0 ? Math.min((now - peer.lastInputTime) / 1000, 0.5) : 1 / 30;
    peer.lastInputTime = now;

    // Ausdauer und Vitals-Sync gelten in JEDEM Bewegungszweig. Der Sync
    // stand früher nur im Oberwelt-Zweig — im Dungeon-Band bekam der Client
    // dadurch nie ein frisches PlayerState, seine Reconciliation hielt an
    // der letzten OBERWELT-Position fest und zog den Spieler immer wieder
    // neben den Eingang zurück (Nutzerbericht 2026-08-03).
    const bewegt = moveX !== 0 || moveZ !== 0;
    const rennt = !peer.flying && running && bewegt && peer.stamina > 0;
    if (!peer.flying) {
      if (rennt) {
        peer.stamina = Math.max(0, peer.stamina - 10 * deltaSec);
        peer.staminaZuletztVerbraucht = now;
      } else if (now - peer.staminaZuletztVerbraucht > 1500 && peer.stamina < 100) {
        peer.stamina = Math.min(100, peer.stamina + 14 * deltaSec);
      }
    }
    peer.staminaSyncAkku = (peer.staminaSyncAkku ?? 0) + deltaSec;
    if (peer.staminaSyncAkku >= 0.25) {
      peer.staminaSyncAkku = 0;
      this.sendPlayerState(peer);
    }

    let newPos: Vector3;

    if (peer.flying) {
      // Admin fly mode: no gravity, no ground clamp — vertical intent from
      // moveY (-1..+1). Server-side so zone generation / ZDO streaming
      // (driven by peer positions) keep following the flying player.
      const flySpeed = running ? 30 : 12; // m/s
      const newX = peer.position.x + moveX * flySpeed * deltaSec;
      const newZ = peer.position.z + moveZ * flySpeed * deltaSec;
      // safety clamp against endless vertical drift
      const y = Math.min(2000, Math.max(-100, peer.position.y + moveY * flySpeed * deltaSec));
      newPos = { x: newX, y, z: newZ };
    } else if (isInDungeonBand(peer.position.x)) {
      // Phase G: inside a dungeon instance there is no terrain heightmap —
      // floors/stairs are room colliders that only the client simulates
      // (EntityManager/Havok). The client reports its physics-resolved
      // absolute height via the moveY field; clamp it to the instance
      // volume so a rogue client cannot leave the band vertically.
      const speed = rennt ? 7.5 : 4.5;
      const newX = peer.position.x + moveX * speed * deltaSec;
      const newZ = peer.position.z + moveZ * speed * deltaSec;
      const y =
        Number.isFinite(moveY) && moveY !== 0
          ? Math.min(300, Math.max(-100, moveY))
          : peer.position.y;
      newPos = { x: newX, y, z: newZ };
    } else {
      const speed = rennt ? 7.5 : 4.5; // m/s (Valheim walk/run speeds)
      const newX = peer.position.x + moveX * speed * deltaSec;
      const newZ = peer.position.z + moveZ * speed * deltaSec;

      // D6: terrain height + gravity — walk up/down slopes, fall at 15 m/s
      const ground = this.getGroundHeight(newX, newZ);
      let y = peer.position.y;
      if (y > ground) {
        y = Math.max(ground, y - 15 * deltaSec);
      } else {
        y = ground;
      }

      newPos = { x: newX, y, z: newZ };
    }

    peer.position = newPos;

    // Update character ZDO position
    const charZDO = this.zdos.getZDO(peer.characterID);
    if (charZDO) {
      this.zdos.updateZDOZone(charZDO, newPos);
      charZDO.revision.reviseData();
      charZDO.dirty = true;
    }
  }

  private handleChatMessage(peer: Peer, reader: Reader): void {
    const chatType = reader.readInt32();
    const text = reader.readString().slice(0, 256);
    // Frequenzlimit: max. ~3 Nachrichten je Sekunde (Review-Punkt 11).
    const jetzt = Date.now();
    if (jetzt - peer.letzterChat < 300) return;
    peer.letzterChat = jetzt;

    // Broadcast to all peers
    const writer = new Writer();
    writer.writeString(peer.userId.toString());
    writer.writeString(peer.name);
    writer.writeInt32(chatType);
    writer.writeString(text);
    writer.writeVector3(peer.position);
    const payload = writer.toBuffer();

    for (const p of this.net.getPeers()) {
      p.sendPacket(PacketType.ChatMessage, payload);
    }

    console.log(`[Chat] ${peer.name}: ${text}`);
  }

  private handleRpcCall(peer: Peer, reader: Reader): void {
    const methodHash = reader.readInt32();
    const hasTarget = reader.readBool();

    if (hasTarget) {
      const targetUserId = reader.readString();
      const targetId = reader.readInt32();
      // TODO: route to target ZDO
    }

    // Invoke RPC on peer
    peer.rpc.invoke(peer, methodHash, reader);
  }

  /**
   * Hammer: Bau-Piece setzen. Whitelist aus der Hammer-Tabelle, Distanz-
   * Check; das ZDO ist persistent und traegt 'spieler'=1 — nur solche
   * Pieces darf RemovePiece wieder abreissen (Ruinen bleiben unantastbar).
   * Materialkosten zieht der Client ab (Inventar lebt clientseitig —
   * dokumentierte Grenze wie beim Crafting).
   */
  private handlePlacePiece(peer: Peer, reader: Reader): void {
    const prefabHash = reader.readInt32();
    const pos = reader.readVector3();
    const rot = reader.readQuaternion();
    const antwort = (ok: boolean, message: string) => {
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(ok);
        w.writeString(message);
        w.writeString('');
        w.writeInt32(0);
      });
    };
    const def = this.prefabs.getByHash(prefabHash);
    if (!def || !BAU_PREFABS.has(def.name)) return antwort(false, 'Kein baubares Teil');
    const dx = pos.x - peer.position.x;
    const dz = pos.z - peer.position.z;
    if (dx * dx + dz * dz > 8 * 8) return antwort(false, 'Zu weit weg');
    // Piece-Budget: unbegrenztes Bauen war ZDO-Spam frei Haus (Review 8).
    if (peer.bautenAnzahl >= 500) return antwort(false, 'Baulimit erreicht (500)');
    // Materialkosten SERVERSEITIG: erst prüfen, dann abziehen.
    const piece = Object.values(PIECES).find((p) => p.bauPrefab === def.name);
    for (const r of piece?.resources ?? []) {
      if (peer.inventar.countOf(r.item) < r.amount) {
        return antwort(false, `Material fehlt: ${r.amount}× ${r.item}`);
      }
    }
    for (const r of piece?.resources ?? []) peer.inventar.removeByName(r.item, r.amount);
    this.inventarSync(peer);
    peer.bautenAnzahl++;

    const zdo = this.zdos.createZDO(prefabHash, pos, rot);
    zdo.setInt('spieler', 1);
    // Besitzer festhalten — nur der Erbauer darf abreißen (Review-Punkt 4).
    zdo.setString('besitzer', peer.userId.toString());
    zdo.revision.reviseData();
    zdo.dirty = true;
    antwort(true, `${def.name} gebaut`);
  }

  /** Hammer (mittlere Maustaste): eigenes Piece abreissen, halbe Kosten zurueck. */
  private handleRemovePiece(peer: Peer, reader: Reader): void {
    const pos = reader.readVector3();
    // Abriss nur in Hammer-Reichweite der SERVER-Position — vorher ließ
    // sich jedes Spielerbauwerk weltweit entfernen (Review-Punkt 4).
    {
      const dx = pos.x - peer.position.x;
      const dz = pos.z - peer.position.z;
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z) || dx * dx + dz * dz > 8 * 8) return;
    }
    let ziel: ZDO | null = null;
    let best = 3 * 3;
    for (const zdo of this.zdos.getZDOsInRadius(pos, 4)) {
      if (zdo.getInt('spieler') !== 1) continue;
      // Nur eigene Bauten (Altbestand ohne 'besitzer' bleibt abreißbar,
      // sonst wären die vor diesem Patch gebauten Stücke für immer fest).
      const besitzer = zdo.getString('besitzer');
      if (besitzer && besitzer !== peer.userId.toString()) continue;
      const d = (zdo.position.x - pos.x) ** 2 + (zdo.position.z - pos.z) ** 2;
      if (d < best) {
        best = d;
        ziel = zdo;
      }
    }
    if (!ziel) return;
    const def = this.prefabs.getByHash(ziel.prefabHash);
    this.zdos.destroyZDO(ziel.zdoid);
    // Halbe Materialkosten zurueck (je Zutat eine Meldung).
    if (peer.bautenAnzahl > 0) peer.bautenAnzahl--;
    const piece = Object.values(PIECES).find((p) => p.bauPrefab === def?.name);
    for (const r of piece?.resources ?? []) {
      const menge = Math.floor(r.amount / 2);
      if (menge <= 0) continue;
      this.gebeItem(peer, r.item, menge);
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(true);
        w.writeString(`Abgerissen — ${menge}× ${r.item} zurueck`);
        w.writeString(r.item);
        w.writeInt32(menge);
      });
    }
  }

  /**
   * Terrain-Werkzeug server-autoritativ: validieren, auf die Server-
   * Heightmap anwenden (Bewegungs-Clamp!) und an ALLE Peers senden — auch
   * an den Absender, der lokal nichts mehr anfasst. Damit sehen Mitspieler
   * jede Grabung.
   *
   * D9: Die Operation wird NICHT mehr in einer Liste aufbewahrt. Ihr
   * Ergebnis steht bereits im TerrainComp der Zone, und der ist der
   * vollständige Endzustand — die Liste war eine zweite Buchführung
   * derselben Sache, nur unbegrenzt wachsend.
   */
  private handleTerrainOp(peer: Peer, reader: Reader): void {
    const pos = reader.readVector3();
    const settingsJson = reader.readString();
    if (settingsJson.length > 2000) return;

    const dx = pos.x - peer.position.x;
    const dz = pos.z - peer.position.z;
    if (dx * dx + dz * dz > 10 * 10) return;

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(settingsJson) as Record<string, unknown>;
    } catch {
      return;
    }
    // Grenzen gegen Amok-Clients: Radius und Hub gedeckelt.
    const r = Number(settings.levelRadius ?? settings.smoothRadius ?? 0);
    const off = Number(settings.levelOffset ?? 0);
    if (!Number.isFinite(r) || r > 8 || !Number.isFinite(off) || Math.abs(off) > 8) return;

    const wirkung = this.heightmaps.applyTerrainOp(pos.x, pos.y, pos.z, settings as never);
    // Wirkungslose Operation gar nicht erst verteilen: Wer mit der Hacke
    // auf bereits planierten Boden schlägt, ändert nichts — das an alle
    // Peers zu schicken kostet Bandbreite für ein Nichts.
    if (wirkung.heights.length === 0 && wirkung.paint.length === 0) return;
    this.broadcastTerrainOps([{ pos, settingsJson }]);
    // Glättung reicht weiter als die Kernfläche — Rand großzügig mitnehmen.
    const smooth = Number(settings.smoothRadius ?? 0);
    this.objekteAufBodenNachsetzen(pos, Math.max(r, Number.isFinite(smooth) ? smooth : 0) + 1.5);
  }

  /** groundOffset je Vegetations-Prefab — Auswahlmenge des Nachsetzens. */
  private readonly foliageOffset: ReadonlyMap<number, number> = new Map(
    FOLIAGE.map((f) => [f.prefabHash, f.groundOffset])
  );

  /**
   * C# StaticPhysics (m_fall/m_pushUp): Bäume, Felsen und Pickables sitzen
   * auf dem Boden — wird der unter ihnen weggegraben, fallen sie nach,
   * wird er aufgeschüttet, hebt es sie an. Das Original prüft dafür träge
   * pro Objekt (SlowUpdate) und lässt den Besitzer die ZDO-Position
   * schreiben; bei uns ist der Server Besitzer und stößt die Prüfung
   * direkt nach jedem TerrainOp an — billiger und ohne Verzug. Der Fall
   * ist ein hartes Setzen statt der 4 m/s des Originals: pro Grabungshieb
   * sinkt der Boden nur wenige Dezimeter, da ist kein Unterschied sichtbar.
   * Bauwerke (Pieces) bleiben bewusst unangetastet — die FOLIAGE-Menge
   * enthält sie nicht.
   */
  private objekteAufBodenNachsetzen(pos: Vector3, radius: number): void {
    for (const zdo of this.zdos.getZDOsInRadius(pos, radius)) {
      const offset = this.foliageOffset.get(zdo.prefabHash);
      if (offset === undefined) continue;
      const soll = this.getGroundHeight(zdo.position.x, zdo.position.z) + offset;
      if (Math.abs(zdo.position.y - soll) <= 0.05) continue;
      zdo.position = { x: zdo.position.x, y: soll, z: zdo.position.z };
      zdo.revision.reviseData();
      zdo.dirty = true;
    }
  }

  private broadcastTerrainOps(
    ops: ReadonlyArray<{ pos: Vector3; settingsJson: string }>,
    nur?: Peer
  ): void {
    const ziele = nur ? [nur] : this.net.getPeers();
    for (const p of ziele) {
      p.sendPacketWith(PacketType.TerrainOpSync, (w) => {
        w.writeInt32(ops.length);
        for (const op of ops) {
          w.writeVector3(op.pos);
          w.writeString(op.settingsJson);
        }
      });
    }
  }

  /**
   * D9: Endzustand des Spieler-Terraformings an einen frisch verbundenen
   * Peer. Eine Zone kostet hier höchstens ihre 65×65 Vertices, egal ob
   * darin einmal oder zehntausendmal gegraben wurde.
   */
  private sendeTerrainComps(peer: Peer): void {
    const comps = [...this.heightmaps.listTerrainComps()].filter((c) => !c.isEmpty);
    if (comps.length === 0) return;
    let bytes = 0;
    peer.sendPacketWith(PacketType.TerrainCompSync, (w) => {
      w.writeInt32(comps.length);
      for (const comp of comps) {
        const roh = kodiereTerrainComp(comp);
        bytes += roh.length;
        w.writeBytes(Buffer.from(roh.buffer, roh.byteOffset, roh.byteLength));
      }
    });
    console.log(
      `[WoV] Terraforming an "${peer.name}": ${comps.length} Zone(n), ${(bytes / 1024).toFixed(1)} KB`
    );
  }

  private naechstesEvent = 0;

  /**
   * RandomEvents (C++ RandomEventManager, stark verschlankt): alle
   * EVENT_INTERVAL_MS mit EVENT_CHANCE ein Überfall auf einen zufälligen
   * Spieler in der Oberwelt — "Der Wald bewegt sich": Greydwarf-Rudel
   * spawnt im Ring um den Spieler. Die Kreaturen übernimmt danach das
   * SpawnSystem (adoptPersisted) für Chase/Despawn.
   */
  private eventTick(now: number): void {
    if (this.naechstesEvent === 0) this.naechstesEvent = now + EVENT_INTERVAL_MS;
    if (now < this.naechstesEvent) return;
    this.naechstesEvent = now + EVENT_INTERVAL_MS;
    if (Math.random() >= EVENT_CHANCE) return;

    const kandidaten = this.net.getPeers().filter((p) => !isInDungeonBand(p.position.x));
    if (kandidaten.length === 0) return;
    const ziel = kandidaten[(Math.random() * kandidaten.length) | 0]!;

    const hash = getStableHash('Greydwarf');
    for (let i = 0; i < 4; i++) {
      const winkel = Math.random() * Math.PI * 2;
      const dist = 18 + Math.random() * 14;
      const x = ziel.position.x + Math.cos(winkel) * dist;
      const z = ziel.position.z + Math.sin(winkel) * dist;
      const y = this.getGroundHeight(x, z);
      if (y < WATER_LEVEL) continue;
      this.zdos.createZDO(hash, { x, y, z });
    }
    this.spawns?.adoptPersisted();

    for (const peer of this.net.getPeers()) {
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(true);
        w.writeString('Der Wald bewegt sich …');
        w.writeString('');
        w.writeInt32(0);
      });
    }
    console.log(`[WoV] RandomEvent: Überfall bei "${ziel.name}"`);
  }

  /** Maximale HP inkl. aktivem Essens-Buff. */
  private maxHealth(peer: Peer): number {
    return 100 + (Date.now() < peer.foodBis ? peer.foodBonus : 0);
  }

  /** Health(%)/Stamina/Serverposition an den Client (PlayerState-Paket). */
  private sendPlayerState(peer: Peer): void {
    peer.sendPacketWith(PacketType.PlayerState, (w) => {
      // Prozent statt Absolutwert: der HUD-Balken bleibt 0..100, egal wie
      // hoch der Essens-Bonus die Obergrenze schiebt.
      w.writeFloat32((peer.health / this.maxHealth(peer)) * 100);
      w.writeFloat32(peer.stamina);
      w.writeVector3(peer.position);
    });
  }

  /**
   * Essen (Taste F): Client zieht das Item ab (Inventar lebt clientseitig)
   * und meldet es; der Server setzt den Buff — maxHP steigt, dazu leichte
   * Regeneration solange das Essen wirkt (eventTick-Sekundenschleife).
   */
  /** Craften server-autoritativ: Rezept + Zutaten prüfen, abziehen, geben. */
  private handleCraft(peer: Peer, reader: Reader): void {
    const ergebnis = reader.readString();
    const rezept = REZEPTE.find((r) => r.ergebnis === ergebnis);
    const antwort = (ok: boolean, message: string) => {
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(ok);
        w.writeString(message);
        w.writeString('');
        w.writeInt32(0);
      });
    };
    if (!rezept) return antwort(false, 'Unbekanntes Rezept');
    for (const z of rezept.zutaten) {
      if (peer.inventar.countOf(z.item) < z.menge) {
        return antwort(false, `Zutat fehlt: ${z.menge}× ${z.item}`);
      }
    }
    for (const z of rezept.zutaten) peer.inventar.removeByName(z.item, z.menge);
    const def = findItem(rezept.ergebnis);
    if (def) peer.inventar.addItem(def, rezept.menge);
    this.inventarSync(peer);
    antwort(true, `Hergestellt: ${rezept.ergebnis}`);
  }

  /** Autoritativen Inventarstand an den Client schicken. */
  private inventarSync(peer: Peer): void {
    peer.sendPacketWith(PacketType.InventorySync, (w) => {
      w.writeString(JSON.stringify(peer.inventar.serialize()));
    });
  }

  /**
   * Items vergeben — der EINZIGE Weg, auf dem Beute/Refunds ins Spiel
   * kommen (Review-Punkt 8): erst ins Server-Inventar, dann Sync. Der
   * Client addiert selbst nichts mehr.
   */
  private gebeItem(peer: Peer, name: string, amount: number): void {
    if (amount <= 0) return;
    const def = findItem(name);
    if (!def) return;
    peer.inventar.addItem(def, amount);
    this.inventarSync(peer);
  }

  private handleEat(peer: Peer, reader: Reader): void {
    // (Bestandsprüfung unten — Name erst lesen.)
    const item = reader.readString();
    const essen = ESSEN[item];
    if (!essen) return;
    // Nur essen, was man serverseitig auch besitzt (Review-Punkt 8).
    if (!peer.inventar.removeByName(item, 1)) return;
    this.inventarSync(peer);
    peer.foodBonus = essen.bonus;
    peer.foodBis = Date.now() + essen.dauerSec * 1000;
    peer.health = Math.min(this.maxHealth(peer), peer.health + 10);
    this.sendPlayerState(peer);
    peer.sendPacketWith(PacketType.InteractResult, (w) => {
      w.writeBool(true);
      w.writeString(`Gegessen: +${essen.bonus} max. Leben (${Math.round(essen.dauerSec / 60)} min)`);
      w.writeString('');
      w.writeInt32(0);
    });
  }

  /**
   * Nahkampfschlag: trifft die nächste Kreatur ≤2,8 m vor dem Spieler.
   * Kreaturen-HP leben als ZDO-Member `HEALTH_MEMBER`; ihr Startwert
   * steht in shared/leben.ts und wird beim Spawn geschrieben (s.
   * SpawnSystem.stelleLebenSicher), damit der Client daraus einen
   * Lebensbalken zeichnen kann. Bei 0 stirbt die Kreatur (SpawnSystem
   * räumt den Zustand selbst auf).
   */
  /** Maximale Wirk-Distanz von Angriff/Ernte zur SERVER-Position (m). */
  private static readonly NAHKAMPF_REICHWEITE = 8;
  /** Mindestabstand zweier Schläge (ms) — Client-Klickraten zählen nicht. */
  private static readonly SCHLAG_COOLDOWN_MS = 350;

  /**
   * Angriff/Ernte nur nah an der SERVER-Position und außerhalb des
   * Cooldowns — vorher wirkte ein Schlag an jeder Weltposition
   * (Review-Punkt 4). handleHarvest erbt die Prüfung über handleAttack.
   */
  private schlagErlaubt(peer: Peer, pos: Vector3): boolean {
    const dx = pos.x - peer.position.x;
    const dz = pos.z - peer.position.z;
    const r = WovServer.NAHKAMPF_REICHWEITE;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z) || dx * dx + dz * dz > r * r) {
      return false;
    }
    const jetzt = Date.now();
    if (jetzt - peer.letzterSchlag < WovServer.SCHLAG_COOLDOWN_MS) return false;
    peer.letzterSchlag = jetzt;
    return true;
  }

  private handleAttack(peer: Peer, reader: Reader): void {
    const pos = reader.readVector3();
    if (!this.schlagErlaubt(peer, pos)) return;
    reader.readFloat32(); // yaw — später für Trefferwinkel
    let waffe = '';
    try {
      waffe = reader.readString();
    } catch {
      /* alter Client ohne Waffenfeld */
    }
    if (peer.stamina < 8) return;
    peer.stamina -= 8;
    peer.staminaZuletztVerbraucht = Date.now();
    this.sendPlayerState(peer);
    const schaden = WAFFEN_SCHADEN[waffe] ?? 4; // Faust
    let ziel: import('./zdo/ZDO.js').ZDO | null = null;
    let best = 2.8 * 2.8;
    for (const zdo of this.zdos.getZDOsInRadius(pos, 3.5)) {
      const def = this.prefabs.getByHash(zdo.prefabHash);
      const flags = def?.flags ?? 0n;
      if ((flags & (PrefabFlag.ANIMAL_AI | PrefabFlag.MONSTER_AI)) === 0n) continue;
      const d = (zdo.position.x - pos.x) ** 2 + (zdo.position.z - pos.z) ** 2;
      if (d < best) {
        best = d;
        ziel = zdo;
      }
    }
    if (!ziel) return this.handleHarvest(peer, pos, waffe);
    const name = this.prefabs.getByHash(ziel.prefabHash)?.name ?? '?';
    // Startwert aus shared/leben.ts statt aus einem Literal. Der
    // `||`-Zweig greift nur noch für Wesen aus Saves von VOR dieser
    // Änderung — seit `stelleLebenSicher` bringt jede Kreatur ihre Punkte
    // vom Spawn mit, und `adoptPersisted` trägt sie den alten nach.
    const hp = (ziel.getInt(HEALTH_MEMBER) || maxLeben(name)) - schaden;
    if (hp <= 0) {
      this.zdos.destroyZDO(ziel.zdoid);
      const beute = wuerfleDrop(name);
      if (beute) this.gebeItem(peer, beute.name, beute.amount);
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(true);
        w.writeString(beute ? `${name} besiegt — ${beute.amount}× ${beute.name}` : `${name} besiegt`);
        w.writeString(beute?.name ?? '');
        w.writeInt32(beute?.amount ?? 0);
      });
      const zweit = ZWEIT_DROPS[name];
      if (zweit) {
        this.gebeItem(peer, zweit[0], zweit[1]);
        peer.sendPacketWith(PacketType.InteractResult, (w) => {
          w.writeBool(true);
          w.writeString(`Trophäe erbeutet: ${zweit[0]}`);
          w.writeString(zweit[0]);
          w.writeInt32(zweit[1]);
        });
      }
    } else {
      ziel.setInt(HEALTH_MEMBER, hp);
      ziel.revision.reviseData();
      ziel.dirty = true;
    }
  }

  /**
   * Ernte-Ziele: Bäume (Axt), Felsen (Spitzhacke), Büsche/Stümpfe (alles).
   * HP als ZDO-Member; beim Fällen wandert der Ertrag direkt ins Inventar
   * des Angreifers (konsistent mit den Kreaturen-Drops).
   */
  private handleHarvest(peer: Peer, pos: Vector3, waffe: string): void {
    const antwort = (message: string, itemName = '', amount = 0) => {
      this.gebeItem(peer, itemName, amount);
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(true);
        w.writeString(message);
        w.writeString(itemName);
        w.writeInt32(amount);
      });
    };
    const F = PrefabFlag;
    let ziel: ZDO | null = null;
    let art: 'baum' | 'fels' | 'weich' | null = null;
    let best = 3.2 * 3.2;
    for (const zdo of this.zdos.getZDOsInRadius(pos, 4)) {
      const def = this.prefabs.getByHash(zdo.prefabHash);
      if (!def) continue;
      const flags = def.flags;
      const name = def.name;
      let a: 'baum' | 'fels' | 'weich' | null = null;
      if ((flags & (F.TREE_BASE | F.TREE_LOG)) !== 0n || /beech|birch|^oak|firtree|pinetree|stubbe|swamptree/i.test(name)) {
        a = 'baum';
      } else if ((flags & F.MINE_ROCK_5) !== 0n || /^rock|^minerock|silvervein/i.test(name)) {
        a = 'fels';
      } else if ((flags & F.DESTRUCTIBLE) !== 0n && /bush|shrub|branch/i.test(name)) {
        a = 'weich';
      }
      if (!a) continue;
      const d = (zdo.position.x - pos.x) ** 2 + (zdo.position.z - pos.z) ** 2;
      if (d < best) {
        best = d;
        ziel = zdo;
        art = a;
      }
    }
    if (!ziel || !art) return;

    // Werkzeug-Pflicht wie im Original: Holz braucht die Axt, Stein die Spitzhacke.
    if (art === 'baum' && waffe !== 'AxeFlint') {
      return antwort('Zu hart — dafür braucht es eine Axt');
    }
    if (art === 'fels' && waffe !== 'PickaxeAntler') {
      return antwort('Zu hart — dafür braucht es eine Spitzhacke');
    }

    const startHp = art === 'baum' ? 60 : art === 'fels' ? 90 : 15;
    const schaden = WAFFEN_SCHADEN[waffe] ?? 4;
    const hp = (ziel.getInt(HEALTH_MEMBER) || startHp) - schaden;
    if (hp > 0) {
      ziel.setInt(HEALTH_MEMBER, hp);
      ziel.revision.reviseData();
      ziel.dirty = true;
      return;
    }
    this.zdos.destroyZDO(ziel.zdoid);
    const menge = art === 'weich' ? 2 : 6 + ((Math.random() * 5) | 0);
    const item = art === 'fels' ? 'Stone' : 'Wood';
    antwort(`${art === 'baum' ? 'Baum gefällt' : art === 'fels' ? 'Fels zerbrochen' : 'Zerlegt'} — ${menge}× ${item}`, item, menge);
  }

  /** Kreaturen-Treffer auf Spieler (vom SpawnSystem gemeldet). */
  private applyCreatureAttack(pos: Vector3, damage: number, radius: number): void {
    const r2 = radius * radius;
    for (const peer of this.net.getPeers()) {
      const d = (peer.position.x - pos.x) ** 2 + (peer.position.z - pos.z) ** 2;
      if (d > r2) continue;
      peer.health = Math.max(0, peer.health - damage);
      if (peer.health <= 0) {
        // Tod: zurück zum Weltspawn, volle HP — Betten/Gräber später.
        peer.health = 100;
        peer.stamina = 100;
        if (peer.dungeonId) this.leaveDungeon(peer);
        const wieder = peer.spawnPoint ?? this.weltSpawn();
        this.teleportPeer(peer, { ...wieder }, null);
        peer.sendPacketWith(PacketType.InteractResult, (w) => {
          w.writeBool(true);
          w.writeString('Du bist gestorben');
          w.writeString('');
          w.writeInt32(0);
        });
      }
      this.sendPlayerState(peer);
    }
  }

  /**
   * Interaktion (E-Taste): Aufsammeln, Türen, Truhen. Der Client schickt
   * Position + Prefab-Hash des anvisierten Objekts; der Server löst das
   * nächste passende ZDO im 2,5-m-Umkreis auf und entscheidet nach
   * Prefab-Flags — kein ZDOID-Roundtrip nötig.
   */
  private handleInteract(peer: Peer, reader: Reader): void {
    const pos = reader.readVector3();
    const prefabHash = reader.readInt32();
    const antwort = (ok: boolean, message: string, itemName = '', amount = 0) => {
      if (ok) this.gebeItem(peer, itemName, amount);
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(ok);
        w.writeString(message);
        w.writeString(itemName);
        w.writeInt32(amount);
      });
    };

    // Reichweiten-Check gegen die Serverposition des Spielers (Anti-Cheat light).
    const dx = pos.x - peer.position.x;
    const dz = pos.z - peer.position.z;
    if (dx * dx + dz * dz > 6 * 6) return antwort(false, 'Zu weit weg');

    let ziel = null as import('./zdo/ZDO.js').ZDO | null;
    let best = 2.5 * 2.5;
    for (const zdo of this.zdos.getZDOsInRadius(pos, 3)) {
      if (zdo.prefabHash !== prefabHash) continue;
      const ddx = zdo.position.x - pos.x;
      const ddz = zdo.position.z - pos.z;
      const d = ddx * ddx + ddz * ddz;
      if (d < best) {
        best = d;
        ziel = zdo;
      }
    }
    if (!ziel) return antwort(false, 'Nichts in Reichweite');

    const def = this.prefabs.getByHash(ziel.prefabHash);
    const flags = def?.flags ?? 0n;
    const F = PrefabFlag;

    if ((flags & (F.PICKABLE | F.PICKABLE_ITEM | F.ITEM_DROP)) !== 0n) {
      this.zdos.destroyZDO(ziel.zdoid);
      const item = pickableItem(def?.name ?? '');
      return antwort(true, `Aufgesammelt: ${item?.name ?? def?.name ?? '?'}`, item?.name ?? '', item?.amount ?? 0);
    }

    if ((flags & F.DOOR) !== 0n) {
      // Gitter/Türen fahren nach oben (Krypta-Fallgitter-Stil) — Pivotdaten
      // fehlen im Export, Rotation sähe an der Mitte aufgehängt aus.
      const offen = ziel.getInt('state') === 1;
      ziel.setInt('state', offen ? 0 : 1);
      this.zdos.updateZDOZone(ziel, {
        x: ziel.position.x,
        y: ziel.position.y + (offen ? -2.1 : 2.1),
        z: ziel.position.z,
      });
      ziel.revision.reviseData();
      ziel.dirty = true;
      return antwort(true, offen ? 'Tür geschlossen' : 'Tür geöffnet');
    }

    // Portal: zum nächstgelegenen ANDEREN Portal reisen (Auto-Paarung —
    // Tag-System wie im Original folgt, sobald es eine Text-UI gibt).
    if (def?.name === 'portal_wood') {
      let anderes: ZDO | null = null;
      let bestD = Infinity;
      for (const p of this.zdos.getZDOByPrefab(ziel.prefabHash)) {
        if (p.zdoid.toString() === ziel.zdoid.toString()) continue;
        const d = (p.position.x - ziel.position.x) ** 2 + (p.position.z - ziel.position.z) ** 2;
        if (d < bestD) {
          bestD = d;
          anderes = p;
        }
      }
      if (!anderes) return antwort(false, 'Kein zweites Portal vorhanden');
      this.teleportPeer(peer, {
        x: anderes.position.x + 1.2,
        y: anderes.position.y + 0.3,
        z: anderes.position.z + 1.2,
      }, null);
      return antwort(true, 'Durch das Portal gereist');
    }

    // Boss-Altar: die Hirsch-Statue am Eikthyr-Altar beschwört den Boss.
    if (def?.name === 'StatueDeer') {
      const schonDa = this.zdos
        .getZDOsInRadius(ziel.position, 60)
        .some((z) => z.prefabHash === EIKTHYR_HASH);
      if (schonDa) return antwort(true, 'Eikthyr ist bereits erwacht!');
      // Kein eigenes Modell, keine Beschwörung — und zwar VOR dem Abzug.
      // Sonst zahlt der Spieler zwei Trophäen für eine unsichtbare Hülle:
      // SpawnSystem.adoptSingle() weist Eikthyr seit der Umstellung auf
      // eigene Modelle ab, die ZDO entstünde aber trotzdem und bliebe als
      // toter Eintrag im Spielstand stehen.
      if (!istEigenesModell('Eikthyr')) {
        return antwort(false, 'Der Altar schweigt — für Eikthyr fehlt noch ein Modell');
      }
      // Opfergabe SERVERSEITIG: 2 Hirschtrophäen aus dem Inventar.
      if (peer.inventar.countOf('TrophyDeer') < 2) {
        return antwort(false, 'Der Altar verlangt 2 Hirschtrophäen');
      }
      peer.inventar.removeByName('TrophyDeer', 2);
      this.inventarSync(peer);
      const boss = this.zdos.createZDO(EIKTHYR_HASH, {
        x: ziel.position.x + 4,
        y: ziel.position.y + 0.5,
        z: ziel.position.z + 4,
      });
      boss.setInt(HEALTH_MEMBER, maxLeben('Eikthyr'));
      boss.revision.reviseData();
      boss.dirty = true;
      this.spawns?.adoptSingle(boss, BOSS_ENTRY);
      for (const p of this.net.getPeers()) {
        p.sendPacketWith(PacketType.InteractResult, (w) => {
          w.writeBool(true);
          w.writeString('EIKTHYR erwacht — die Erde bebt!');
          w.writeString('');
          w.writeInt32(0);
        });
      }
      return;
    }

    // Feuerstelle brät: 1× RawMeat → 1× CookedMeat (server-autoritativ —
    // vorher tauschte der Client lokal, Review-Punkt 8).
    if ((flags & F.FIREPLACE) !== 0n) {
      if (!peer.inventar.removeByName('RawMeat', 1)) {
        return antwort(false, 'Kein rohes Fleisch dabei');
      }
      this.inventarSync(peer);
      return antwort(true, 'Fleisch gebraten — 1× CookedMeat', 'CookedMeat', 1);
    }

    if ((flags & F.BED) !== 0n) {
      peer.spawnPoint = { x: ziel.position.x, y: ziel.position.y + 0.6, z: ziel.position.z };
      return antwort(true, 'Schlafplatz gesetzt — hier wachst du künftig auf');
    }

    if ((flags & F.CONTAINER) !== 0n) {
      if (ziel.getInt('looted') === 1) return antwort(true, 'Die Truhe ist leer');
      ziel.setInt('looted', 1);
      ziel.revision.reviseData();
      ziel.dirty = true;
      const beute = wuerfleTruhe(def?.name ?? '');
      return antwort(true, `Gefunden: ${beute.amount}× ${beute.name}`, beute.name, beute.amount);
    }

    return antwort(false, 'Damit kann man nichts machen');
  }

  // ── Dungeons (Phase G) ─────────────────────────────────────────

  /** Alle bekannten Dungeon-Eingänge an einen Peer (Weltkarten-Marker). */
  private sendDungeonEntrances(peer: Peer): void {
    const entrances = this.dungeons.listEntrances();
    peer.sendPacketWith(PacketType.DungeonEntrances, (w) => {
      w.writeInt32(entrances.length);
      for (const e of entrances) {
        w.writeString(e.feature);
        w.writeString(e.dungeonId);
        w.writeVector3(e.pos);
      }
    });
  }

  /**
   * Hard server-side position set + Teleport packet so the client snaps
   * its camera/physics immediately (position is server-authoritative;
   * without the packet the client would lerp through 100 km of nothing).
   */
  private teleportPeer(
    peer: Peer,
    pos: Vector3,
    dungeonId: string | null,
    interiorEnv = '',
    worldId: string = HAUPTWELT_ID
  ): void {
    // Weltwechsel-Seam (Review 15): Die Signatur trägt die Zielwelt schon —
    // der eigentliche Kontext-Swap ist das Housing-Folgeprojekt.
    if (worldId !== peer.worldId) {
      if (!this.welten.has(worldId)) {
        console.warn(`[WoV] teleportPeer: unbekannte Welt "${worldId}" — bleibe in "${peer.worldId}"`);
        return;
      }
      peer.worldId = worldId;
    }
    peer.position = { ...pos };
    const charZDO = this.zdos.getZDO(peer.characterID);
    if (charZDO) {
      this.zdos.updateZDOZone(charZDO, peer.position);
      charZDO.revision.reviseData();
      charZDO.dirty = true;
    }
    peer.sendPacketWith(PacketType.Teleport, (w) => {
      w.writeVector3(pos);
      w.writeBool(dungeonId !== null);
      w.writeString(dungeonId ?? '');
      w.writeString(interiorEnv);
    });
  }

  /** Enter a dungeon instance (materializing it on first use). */
  enterDungeon(peer: Peer, dungeonId: string): { ok: boolean; message: string } {
    const instance = this.dungeons.getOrCreateInstance(dungeonId);
    if (!instance) {
      return { ok: false, message: `Unbekannter Dungeon: ${dungeonId}` };
    }
    if (!peer.dungeonId) {
      peer.dungeonReturn = { ...peer.position };
    }
    peer.dungeonId = dungeonId;
    instance.players.add(peer.name);
    const doc = this.dungeons.getDocument(dungeonId);
    this.teleportPeer(
      peer,
      this.dungeons.getSpawnPoint(instance),
      dungeonId,
      doc ? interiorEnvironment(doc.base) : 'Crypt'
    );
    return { ok: true, message: `Dungeon betreten: ${doc?.name ?? dungeonId}` };
  }

  /** Leave the current dungeon back to the stored overworld position. */
  leaveDungeon(peer: Peer): { ok: boolean; message: string } {
    if (!peer.dungeonId) {
      return { ok: false, message: 'Du bist in keinem Dungeon' };
    }
    this.dungeons.getInstance(peer.dungeonId)?.players.delete(peer.name);
    peer.dungeonId = null;
    const back = peer.dungeonReturn ?? { x: 0, y: this.getGroundHeight(0, 0), z: 0 };
    peer.dungeonReturn = null;
    this.teleportPeer(peer, back, null);
    return { ok: true, message: 'Dungeon verlassen' };
  }

  /**
   * `abbau <prefab> [radius]` — gespawnte Prefabs wieder entfernen.
   *
   * Das Gegenstück zu `spawn`, und es hat bis jetzt gefehlt: Wer sich
   * beim Testen einen NPC an die falsche Stelle gesetzt hat, bekam ihn
   * nur über einen Welt-Reset wieder weg (der Kommentar an
   * spawnLayoutPlacements verweist bereits auf einen "Admin-Abbau", den
   * es nie gab). Persistente Prefabs überleben den Save, ein Fehlgriff
   * bleibt also für immer stehen.
   *
   * Der Radius ist bewusst klein vorbelegt (10 m) und gedeckelt (200 m):
   * `abbau Beech1 5000` würde sonst einen halben Wald abräumen, und
   * zerstörte ZDOs kommen nicht zurück.
   */
  private registerAbbauCommand(): void {
    this.adminCommands.register('abbau', (peer, args) => {
      const name = args[0];
      if (!name) {
        return { ok: false, active: false, message: 'Aufruf: abbau <prefab> [radius]' };
      }
      const prefab =
        this.prefabs.getByName(name) ??
        this.prefabs.getAll().find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!prefab) {
        return { ok: false, active: false, message: `Unbekanntes Prefab: ${name}` };
      }
      const radius = Math.min(200, Math.max(1, Number(args[1]) || 10));
      let weg = 0;
      for (const zdo of this.zdos.getZDOsInRadius(peer.position, radius)) {
        if (zdo.prefabHash !== prefab.hash) continue;
        this.zdos.destroyZDO(zdo.zdoid);
        weg++;
      }
      return {
        ok: true,
        active: false,
        message: `${weg}× ${prefab.name} im Umkreis von ${radius} m entfernt`,
      };
    });
  }

  /**
   * `spawn <prefab> [x z]` — ein Prefab in die Welt setzen (Standard: 2 m
   * vor dem Spieler). Trägt das Prefab das PERSISTENT-Flag, überlebt es
   * den Welt-Save — so kommen eigene NPCs dauerhaft in die Welt.
   */
  private registerSpawnCommand(): void {
    this.adminCommands.register('spawn', (peer, args) => {
      const name = args[0];
      if (!name) {
        return { ok: false, active: false, message: 'Aufruf: spawn <prefab> [x z]' };
      }
      // Exakter Name zuerst, sonst case-insensitiv über die Registry.
      let prefab = this.prefabs.getByName(name);
      if (!prefab) {
        const norm = name.toLowerCase();
        for (const p of this.prefabs.getAll()) {
          if (p.name.toLowerCase() === norm) {
            prefab = p;
            break;
          }
        }
      }
      if (!prefab) {
        return { ok: false, active: false, message: `Unbekanntes Prefab: ${name}` };
      }

      const hatKoordinaten = Number.isFinite(Number(args[1])) && Number.isFinite(Number(args[2]));
      const x = hatKoordinaten ? Number(args[1]) : peer.position.x + 2;
      const z = hatKoordinaten ? Number(args[2]) : peer.position.z + 2;
      // Auf den BODEN, nicht auf den Wasserspiegel.
      //
      // Hier stand `Math.max(getGroundHeight(x, z), WATER_LEVEL)`, damit
      // nichts auf dem Meeresgrund landet. In den Layout-Welten ist das
      // aber falsch: WATER_LEVEL ist die aus Valheim übernommene Konstante
      // 30, das Gelände dieser Welt liegt bei rund -55. Der Ausdruck
      // lieferte deshalb IMMER 30 — jedes gespawnte Prefab hing 85 m über
      // dem Boden.
      //
      // Nachgemessen im laufenden Client (__vb.dynPose/__vb.groundAt):
      // `spawn FurlocFischer` ergab y = 30 bei Geländehöhe -55,5, und
      // `spawn NPC_1` genauso. Es lag also nie am Modell — die
      // gemeldete "im Boden versunkene" Figur war eine, die 85 m daneben
      // stand. Layout-Platzierungen waren nie betroffen, die nehmen
      // getGroundHeight direkt (s. spawnLayoutPlacements).
      const y = this.getGroundHeight(x, z);

      const zdo = this.zdos.createZDO(prefab.hash, { x, y, z });
      // Blick Richtung Spieler, damit ein NPC einen ansieht statt wegzuschauen.
      const dx = peer.position.x - x;
      const dz = peer.position.z - z;
      const yaw = Math.atan2(dx, dz);
      zdo.rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };

      return {
        ok: true,
        active: false,
        message: `${prefab.name} gespawnt bei ${x.toFixed(1)}, ${z.toFixed(1)} (Höhe ${y.toFixed(1)})${
          prefab.isPersistent() ? '' : ' — NICHT persistent'
        }`,
      };
    });
  }

  /**
   * Admin command family `dungeon <sub> ...` — the management interface
   * for dungeon documents, entrances and instances:
   *
   *   dungeon list                      documents + live instances
   *   dungeon entrances                 world entrances + assignments
   *   dungeon create <base> [seed]      generate + save a new document
   *   dungeon enter [id]                enter by id, or the nearest entrance
   *   dungeon leave                     back to the overworld
   *   dungeon assign <id>               assign nearest entrance (≤16 m) to id
   *   dungeon regen <id> [seed]         re-generate a 'generated' document
   *   dungeon reset <id>                tear down the live instance
   *   dungeon delete <id>               delete document + assignments
   */
  private registerDungeonCommands(): void {
    // Den Basis-`teleport` dungeon-bewusst überschreiben: Strg+Klick auf
    // die Weltkarte aus einer Instanz heraus soll den Dungeon sauber
    // verlassen (Buchführung!) statt nur die Koordinaten zu wechseln.
    this.adminCommands.register('teleport', (peer, args) => {
      const x = Number(args[0]);
      const z = Number(args[1]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return { ok: false, active: false, message: 'Aufruf: teleport <x> <z>' };
      }
      if (peer.dungeonId) {
        this.dungeons.getInstance(peer.dungeonId)?.players.delete(peer.name);
        peer.dungeonId = null;
        peer.dungeonReturn = null;
      }
      // Ebenfalls auf den Boden statt auf WATER_LEVEL — siehe die
      // ausführliche Begründung beim `spawn`-Kommando. Beim Teleport
      // wirkte derselbe Fehler noch unangenehmer: Der Spieler landete
      // 85 m über dem Ziel und fiel die Strecke herunter.
      const y = this.getGroundHeight(x, z);
      this.teleportPeer(peer, { x, y, z }, null);
      return {
        ok: true,
        active: false,
        message: `Teleportiert nach ${x.toFixed(0)}, ${z.toFixed(0)} (Höhe ${y.toFixed(1)})`,
      };
    });

    this.adminCommands.register('dungeon', (peer, args) => {
      const sub = (args.shift() ?? 'list').toLowerCase();

      switch (sub) {
        case 'list': {
          const docs = this.dungeons.listDocuments();
          if (docs.length === 0) {
            return { ok: true, active: false, message: 'Keine Dungeons vorhanden' };
          }
          const lines = docs.map((d) => {
            const inst = this.dungeons.getInstance(d.id);
            const live = inst ? ` [aktiv, ${inst.players.size} Spieler]` : '';
            return `${d.id} (${d.base}, ${d.mode}, ${d.layout.rooms.length} Räume)${live}`;
          });
          return { ok: true, active: false, message: lines.join(' | ') };
        }

        case 'entrances': {
          const entries = this.dungeons.listEntrances();
          if (entries.length === 0) {
            return { ok: true, active: false, message: 'Keine Eingänge registriert' };
          }
          const lines = entries.map(
            (e) =>
              `${e.feature}@(${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)}) → ${e.dungeonId}`
          );
          return { ok: true, active: false, message: lines.join(' | ') };
        }

        case 'create': {
          const base = this.resolveDungeonBase(args[0]);
          if (!base) {
            return {
              ok: false,
              active: false,
              message:
                'Aufruf: dungeon create <basis> [seed] — Basis z. B. forestcrypt, sunkencrypt, cave',
            };
          }
          const seed = Number.isFinite(Number(args[1]))
            ? Number(args[1]) | 0
            : (Math.random() * 0x7fffffff) | 0;
          const doc = this.dungeons.createGenerated(base, seed);
          if (!doc) {
            return { ok: false, active: false, message: `Erzeugung fehlgeschlagen (${base})` };
          }
          return {
            ok: true,
            active: false,
            message: `Dungeon erzeugt: ${doc.id} (${doc.layout.rooms.length} Räume, Seed ${seed})`,
          };
        }

        case 'enter': {
          let id = args[0];
          if (!id) {
            const entrance = this.dungeons.findEntranceNear(peer.position, 16);
            if (!entrance) {
              return { ok: false, active: false, message: 'Kein Dungeon-Eingang in der Nähe' };
            }
            id = entrance.dungeonId;
          }
          const result = this.enterDungeon(peer, id);
          return { ok: result.ok, active: result.ok, message: result.message };
        }

        case 'leave': {
          const result = this.leaveDungeon(peer);
          return { ok: result.ok, active: false, message: result.message };
        }

        case 'assign': {
          const id = args[0];
          if (!id || !this.dungeons.getDocument(id)) {
            return { ok: false, active: false, message: `Unbekannter Dungeon: ${id ?? '?'}` };
          }
          const entrance = this.dungeons.findEntranceNear(peer.position, 16);
          if (!entrance) {
            return { ok: false, active: false, message: 'Kein Dungeon-Eingang in der Nähe (≤16 m)' };
          }
          this.dungeons.assignEntrance(entrance.zoneKey, id);
          return {
            ok: true,
            active: false,
            message: `Eingang ${entrance.feature}@${entrance.zoneKey} → ${id}`,
          };
        }

        case 'regen': {
          const doc = args[0] ? this.dungeons.getDocument(args[0]) : undefined;
          if (!doc) {
            return { ok: false, active: false, message: `Unbekannter Dungeon: ${args[0] ?? '?'}` };
          }
          const seed = Number.isFinite(Number(args[1]))
            ? Number(args[1]) | 0
            : (Math.random() * 0x7fffffff) | 0;
          const fresh = this.dungeons.createGenerated(doc.base, seed, doc.id);
          if (!fresh) {
            return { ok: false, active: false, message: 'Neugenerierung fehlgeschlagen' };
          }
          this.dungeons.destroyInstance(doc.id);
          return {
            ok: true,
            active: false,
            message: `${doc.id} neu generiert (Seed ${seed}, ${fresh.layout.rooms.length} Räume)`,
          };
        }

        case 'reset': {
          const ok = args[0] ? this.dungeons.destroyInstance(args[0]) : false;
          return {
            ok,
            active: false,
            message: ok ? `Instanz ${args[0]} zurückgesetzt` : `Keine aktive Instanz: ${args[0] ?? '?'}`,
          };
        }

        case 'delete': {
          const ok = args[0] ? this.dungeons.deleteDocument(args[0]) : false;
          return {
            ok,
            active: false,
            message: ok ? `Dungeon ${args[0]} gelöscht` : `Unbekannter Dungeon: ${args[0] ?? '?'}`,
          };
        }

        default:
          return {
            ok: false,
            active: false,
            message:
              'Aufruf: dungeon list|entrances|create|enter|leave|assign|regen|reset|delete',
          };
      }
    });
  }

  /** 'forestcrypt' | 'DG_ForestCrypt' | 'ForestCrypt' → 'DG_ForestCrypt'. */
  private resolveDungeonBase(input: string | undefined): string | null {
    if (!input) return null;
    const norm = input.toLowerCase().replace(/^dg_/, '');
    for (const d of DUNGEONS) {
      if (d.algorithm !== 0) continue;
      if (d.name.toLowerCase().replace(/^dg_/, '') === norm) return d.name;
    }
    return null;
  }

  // ── Time helpers (C++ GetDay, GetTimeOfDay) ────────────────────

  getDay(): number {
    return Math.floor((this.worldTime - TIME_DAY) / WORLD_TIME_LENGTH);
  }

  getTimeOfDay(): number {
    let wrapped = this.worldTime % WORLD_TIME_LENGTH;
    if (wrapped < 0) wrapped += WORLD_TIME_LENGTH;
    return wrapped;
  }

  getWorldTime(): number {
    return this.worldTime;
  }

  // ── Persistence ────────────────────────────────────────────────

  /**
   * C++ WorldManager::LoadFileDB (order preserved): worldTime →
   * ZoneManager::Load (generated zones) → ZDOManager::Load (persistent
   * ZDOs). Player positions load into savedPlayers and are applied in
   * onPeerAuthenticated. No save file / mismatch → fresh world.
   */
  private loadWorld(): void {
    const data = this.worldManager.load();
    if (!data) {
      console.log('[WoV] No saved world found — starting fresh');
      return;
    }

    this.worldTime = data.worldTime;
    this.zones.restoreGeneratedZones(data.zones);
    // Spieler-Terraforming VOR den ZDOs herstellen (Vegetations-Nachsetzen
    // unten misst gegen den fertigen Boden).
    //
    // D9: v3-Stände bringen den Endzustand je Zone mit — der wird direkt
    // eingesetzt, ohne irgendetwas nachzurechnen. Ältere Stände führen die
    // Operationsliste; die wird ein letztes Mal abgespielt und beim
    // nächsten Save als Endzustand geschrieben.
    let terrainZonen = 0;
    for (const text of data.terrainComps ?? []) {
      try {
        this.heightmaps.restoreTerrainComp(terrainCompAusBase64(text));
        terrainZonen++;
      } catch (err) {
        console.error(`[WoV] TerrainComp im Save unlesbar, übersprungen: ${err}`);
      }
    }
    let altOps = 0;
    for (const op of data.terrainOps ?? []) {
      try {
        this.heightmaps.applyTerrainOp(op.pos.x, op.pos.y, op.pos.z, JSON.parse(op.settingsJson));
        altOps++;
      } catch {
        /* kaputte Eintraege still verwerfen */
      }
    }
    if (altOps > 0) {
      console.log(
        `[WoV] Terraforming: ${altOps} Operation(en) aus einem v${data.version}-Save abgespielt ` +
          `— der nächste Save schreibt sie verdichtet als Endzustand`
      );
    }
    if (terrainZonen > 0) {
      console.log(`[WoV] Terraforming: ${terrainZonen} Zone(n) aus dem Save übernommen`);
    }
    const restoredZDOs = this.zdos.restoreFromSnapshots(data.zdos);
    for (const player of data.players) {
      this.savedPlayers.set(player.name, player);
    }

    // Vegetation nachsetzen: gebackene y-Werte stammen aus dem Boden ZUM
    // GENERIERUNGSZEITPUNKT. Ändert sich der danach — Terrain-Modifier
    // einer Nachbarzone kam später dazu, oder die Leveling-Parameter wurden
    // weiterentwickelt (2026-08-02) — schweben Bäume und Felsen bzw.
    // versinken. Die Modifier sind hier bereits vollständig repliziert
    // (restoreGeneratedZones ↑), also ist getGroundHeight die Wahrheit:
    // jede Vegetations-ZDO wird wieder auf Boden + groundOffset gestellt.
    // Location-Pieces und Bauwerke bleiben unangetastet.
    {
      const offsetByHash = new Map<number, number>();
      for (const f of FOLIAGE) offsetByHash.set(f.prefabHash, f.groundOffset);
      let angepasst = 0;
      for (const zdo of this.zdos.getAllZDOs()) {
        const offset = offsetByHash.get(zdo.prefabHash);
        if (offset === undefined) continue;
        const soll = this.getGroundHeight(zdo.position.x, zdo.position.z) + offset;
        if (Math.abs(zdo.position.y - soll) > 0.05) {
          zdo.position = { x: zdo.position.x, y: soll, z: zdo.position.z };
          zdo.revision.reviseData();
          zdo.dirty = true;
          angepasst++;
        }
      }
      if (angepasst > 0) {
        console.log(`[WoV] Vegetation: ${angepasst} ZDO(s) auf aktuellen Boden nachgesetzt`);
      }
    }

    console.log(
      `[WoV] World "${data.meta.worldName}" loaded (saved ${data.meta.savedAt}): ` +
        `${restoredZDOs} ZDOs, ${data.zones.length} generated zones, ` +
        `${data.players.length} players, day ${this.getDay()}`
    );
  }

  /**
   * C++ WorldManager::WriteFileDB. Persistent ZDOs are filtered by the
   * PREFAB flag — C++ ZDO::IsPersistent() returns GetPrefab().IsPersistent()
   * (ZDO.h:1146), the ZDO instance flag is never set. Player character ZDOs
   * are excluded: their owner session ends at shutdown, so after a restart
   * they would linger as ghosts next to the fresh character ZDO every
   * reconnecting peer gets. Positions live in the players[] section instead
   * (connected peers win over last-known entries).
   */
  saveWorld(): void {
    if (!this.worldManager) return; // init() not run (unit tests)

    const aufnahme = this.momentaufnahme();
    const t0 = Date.now();
    this.worldManager.save({
      ...aufnahme.kopf,
      zdos: aufnahme.zdos.map((z) => z.toSnapshot()),
    });

    console.log(
      `[WoV] World saved: ${aufnahme.zdos.length} persistent ZDOs, ` +
        `${aufnahme.kopf.zones.length} zones, ${aufnahme.kopf.players.length} players ` +
        `(${Date.now() - t0}ms)`
    );
  }

  /** D8: Läuft gerade ein asynchroner Save? */
  private speichertGerade = false;

  /**
   * D8 — derselbe Save, ohne den Event-Loop zu blockieren.
   *
   * Die MOMENTAUFNAHME (welche ZDOs, welche Spieler, welche Zonen) entsteht
   * synchron in einem Stück: Nur so kann keine Änderung, die währenddessen
   * eintrifft, den Save halb erwischen. Was danach kommt — JSON und
   * Kompression — läuft schubweise (s. WorldManager.saveAsync).
   *
   * Ein ZDO, das während des Laufs zerstört wird, fällt heraus (`destroyed`
   * wird beim Zerstören gesetzt): Es später doch zu schreiben, hieße es beim
   * nächsten Start wiederzubeleben. Ein ZDO, das während des Laufs ENTSTEHT,
   * ist nicht dabei und wartet auf den nächsten Save — dasselbe Verhalten
   * wie bisher für alles, was nach dem Save-Beginn passiert.
   *
   * Zwei Läufe gleichzeitig darf es nicht geben: Sie würden sich dieselbe
   * `.tmp`-Datei gegenseitig unter den Händen wegziehen und im schlimmsten
   * Fall ein halbes Paket umbenennen.
   */
  async saveWorldAsync(): Promise<void> {
    if (!this.worldManager) return; // init() not run (unit tests)
    if (this.speichertGerade) {
      console.warn('[WoV] Save läuft noch — dieser Durchgang wird übersprungen');
      return;
    }
    this.speichertGerade = true;
    const t0 = Date.now();
    try {
      const aufnahme = this.momentaufnahme();
      let uebersprungen = 0;
      await this.worldManager.saveAsync(aufnahme.kopf, {
        laenge: aufnahme.zdos.length,
        json: (i) => {
          const zdo = aufnahme.zdos[i]!;
          if (zdo.destroyed) {
            uebersprungen++;
            return null;
          }
          return JSON.stringify(zdo.toSnapshot());
        },
      });
      console.log(
        `[WoV] World saved: ${aufnahme.zdos.length - uebersprungen} persistent ZDOs, ` +
          `${aufnahme.kopf.zones.length} zones, ${aufnahme.kopf.players.length} players ` +
          `(${Date.now() - t0}ms, asynchron)`
      );
    } catch (err) {
      // Kein erneuter Versuch: Die vorige Datei steht unangetastet da (die
      // `.tmp` wird erst am Ende umbenannt), also ist Nichtstun der sichere
      // Zustand. Der nächste Intervall-Save probiert es ohnehin wieder.
      console.error(`[WoV] Save fehlgeschlagen (${Date.now() - t0}ms): ${err}`);
    } finally {
      this.speichertGerade = false;
    }
  }

  /**
   * Der synchrone Teil beider Save-Wege: Welche ZDOs, Spieler und Zonen
   * gehören in diesen Save.
   *
   * Persistente ZDOs werden über das PREFAB-Flag gefiltert — C++
   * ZDO::IsPersistent() liefert GetPrefab().IsPersistent() (ZDO.h:1146),
   * das Instanz-Flag wird nie gesetzt. Spieler-ZDOs bleiben draußen: Ihre
   * Besitzer-Sitzung endet beim Herunterfahren, nach einem Neustart stünden
   * sie als Geister neben dem frischen Charakter-ZDO jedes zurückkehrenden
   * Peers. Ihre Positionen stehen stattdessen in players[] (verbundene
   * Peers schlagen den zuletzt bekannten Eintrag).
   */
  private momentaufnahme(): {
    kopf: Omit<WorldSaveData, 'version' | 'meta' | 'zdos'>;
    zdos: ZDO[];
  } {
    const playerHash = this.prefabs.getByName('Player')?.hash;
    const persistentZDOs = this.zdos
      .getAllZDOs()
      .filter(
        (z) =>
          z.prefabHash !== playerHash &&
          // Phase G: dungeon-instance ZDOs are never saved — instances are
          // re-materialized from their DungeonDocument on demand (saving
          // them would resurrect orphan geometry the manager doesn't know).
          !isInDungeonBand(z.position.x) &&
          (this.prefabs.getByHash(z.prefabHash)?.isPersistent() ?? false)
      );

    const players = new Map(this.savedPlayers);
    for (const peer of this.net.getPeers()) {
      players.set(peer.name, {
        name: peer.name,
        // Phase G: for peers inside a dungeon save the overworld return
        // point — instances don't survive a restart.
        position:
          peer.dungeonId && peer.dungeonReturn
            ? { ...peer.dungeonReturn }
            : { ...peer.position },
        flying: peer.flying,
        spawnPoint: peer.spawnPoint ?? undefined,
        inventar: peer.inventar.serialize(),
      });
    }

    return {
      kopf: {
        worldTime: this.worldTime,
        zones: this.zones.getGeneratedZones(),
        players: [...players.values()],
        // D9: der Endzustand je Zone, nicht mehr die Operationshistorie.
        // Leere Comps entstehen, wenn eine Operation eine Zone nur
        // gestreift hat — sie tragen nichts und gehören nicht in den Save.
        terrainComps: [...this.heightmaps.listTerrainComps()]
          .filter((c) => !c.isEmpty)
          .map((c) => terrainCompNachBase64(c)),
      },
      zdos: persistentZDOs,
    };
  }
}

/** Pickable-Prefab → Inventar-Item (Namen aus shared/items/itemDefs). */
function pickableItem(prefabName: string): { name: string; amount: number } | null {
  const MAP: Array<[RegExp, string, number]> = [
    [/branch/i, 'Wood', 1],
    [/^Pickable_Stone/i, 'Stone', 1],
    [/flint/i, 'Flint', 1],
    [/mushroom/i, 'Mushroom', 1],
    [/(raspberry|berry)/i, 'Raspberry', 1],
    [/blueberr/i, 'Blueberries', 1],
    [/thistle/i, 'Thistle', 1],
    [/dandelion/i, 'Dandelion', 1],
    [/seedcarrot|carrot/i, 'Carrot', 1],
    [/wood/i, 'Wood', 1],
  ];
  for (const [re, name, amount] of MAP) {
    if (re.test(prefabName)) return { name, amount };
  }
  // Fallback: Prefabname direkt versuchen (ItemDrop-Prefabs heißen wie ihr Item).
  return { name: prefabName, amount: 1 };
}

/**
 * Kreaturen-Drops (nah am Original, beschränkt auf existierende itemDefs).
 * Format: [Item, min, max, Chance 0..1].
 */
/** Nahkampfschaden je Waffe ('' = Faust). */
const WAFFEN_SCHADEN: Record<string, number> = {
  '': 4,
  Club: 12,
  AxeFlint: 15,
  PickaxeAntler: 8,
  Hoe: 2,
  Cultivator: 2,
};

const EIKTHYR_HASH = getStableHash('Eikthyr');

/** Synthetischer SpawnEntry für Eikthyr (adoptSingle — nie in der Tabelle). */
const BOSS_ENTRY = {
  prefab: 'Eikthyr',
  biomes: 0xffff as Biome,
  maxPerPlayer: 1,
  countRadius: 64,
  globalMax: 1,
  spawnIntervalSec: 999999,
  spawnChance: 0,
  groupSizeMin: 1,
  groupSizeMax: 1,
  groupRadius: 0,
  ringMin: 0,
  ringMax: 0,
  minAltitude: 25,
  walkSpeed: 2,
  runSpeed: 5,
  wanderRadius: 20,
  idleMinSec: 1,
  idleMaxSec: 3,
  flees: false,
  fleeDistance: 0,
  calmDistance: 0,
  despawns: false,
} as const satisfies import('@wov/shared').SpawnEntry;

/** Passiver Entry für eigene NPCs: wandert, kämpft nie, despawnt nie. */
const NPC_ENTRY = {
  ...BOSS_ENTRY,
  prefab: 'NPC_1',
  walkSpeed: 1.2,
  runSpeed: 1.2,
  wanderRadius: 8,
  idleMinSec: 3,
  idleMaxSec: 9,
  aggro: false,
} as const;

const KREATUR_DROPS: Record<string, Array<[string, number, number, number]>> = {
  Eikthyr: [['HardAntler', 3, 3, 1]],
  Greyling: [['Resin', 1, 1, 1]],
  Greydwarf: [['Wood', 1, 2, 1], ['Resin', 1, 1, 0.5], ['Stone', 1, 1, 0.5]],
  Boar: [['RawMeat', 1, 2, 1]],
  Deer: [['RawMeat', 1, 2, 1], ['TrophyDeer', 1, 1, 0.5]],
  Neck: [['NeckTail', 1, 1, 0.75]],
  Skeleton: [['Coins', 2, 5, 0.6]],
  Draugr: [['Entrails', 1, 2, 1]],
};

/** Zweit-Drop mit fester Chance (Trophäen). */
const ZWEIT_DROPS: Record<string, [string, number]> = {
  Eikthyr: ['TrophyEikthyr', 1],
};

function wuerfleDrop(kreatur: string): { name: string; amount: number } | null {
  const tabelle = KREATUR_DROPS[kreatur];
  if (!tabelle) return null;
  for (const [item, min, max, chance] of tabelle) {
    if (Math.random() <= chance) {
      return { name: item, amount: min + ((Math.random() * (max - min + 1)) | 0) };
    }
  }
  return null;
}

/** Truhen-Beute nach Truhentyp (Prefabname), sonst Meadows-Basis. */
const TRUHEN: Array<[RegExp, Array<[string, number, number]>]> = [
  [/forestcrypt/i, [['Coins', 5, 20], ['Amber', 1, 3], ['Flint', 2, 4]]],
  [/sunkencrypt/i, [['Coins', 10, 30], ['Amber', 2, 4], ['Entrails', 1, 2]]],
  [/trollcave/i, [['Coins', 10, 30], ['Amber', 1, 4], ['Wood', 5, 10]]],
  [/mountaincave/i, [['Coins', 10, 25], ['Amber', 2, 5]]],
  [/./, [['Coins', 2, 10], ['Flint', 1, 3], ['Wood', 3, 8], ['Raspberry', 3, 6]]],
];

function wuerfleTruhe(prefabName: string): { name: string; amount: number } {
  const tabelle = TRUHEN.find(([re]) => re.test(prefabName))![1];
  const [item, min, max] = tabelle[(Math.random() * tabelle.length) | 0]!;
  return { name: item, amount: min + ((Math.random() * (max - min + 1)) | 0) };
}

// ── Singleton accessor (C++ Valhalla()) ──────────────────────────

let instance: WovServer | null = null;

export function Wov(): WovServer {
  if (!instance) {
    instance = new WovServer();
  }
  return instance;
}

export function createWovServer(config?: Partial<ServerConfig>): WovServer {
  instance = new WovServer(config);
  return instance;
}
