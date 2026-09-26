/**
 * WovServer — central server orchestrator.
 * Structural port of the reference server's central orchestrator.
 *
 * The comparison project's counterpart type holds the same state this class
 * does: server settings, a task list, the server ID, start/previous/current
 * update timestamps, the world time and its multiplier, a run-state flag and
 * the blacklist, admin and whitelist sets.
 */

import { LAYOUT_ID_MEMBER, decodeArmor, encodeArmor, validArmorParts, ruestungZu, canWearArmor, IRONWARD_PARTS, WILDWARDEN_PARTS, Inventory, BOARD_SLUGS } from '@wov/shared';
import { grantStarterSet } from './konto/StarterSet.js';
import {
  EVENT_CHANCE,
  EVENT_INTERVAL_MS,
  WORLD_TIME_LENGTH,
  TIME_DAY,
  SAVE_INTERVAL_MS,
  WETTER_VORGABE_AUS,
  type WetterVorgabe,
  ZDO_SEND_INTERVAL_MS,
  ZDO_MAX_SEND_THRESHOLD,
  ZDO_MIN_SEND_THRESHOLD,
  PacketType,
  createGeo,
  sanitizeWorldLayout,
  sanitizeWorldLayoutMitBericht,
  pruefeLayout,
  HEALTH_MEMBER,
  maxLeben,
  type IGeo,
  HeightmapProvider,
  getStableHash,
  kodiereTerrainComp,
  terrainCompNachBase64,
  terrainCompAusBase64,
  istEigenesModell,
  SPAWN_TABLE,
  type SpawnEntry,
  GlobalKey,
  FIGUR_MEMBER,
  FIGUR_VORGABE,
  istFigur,
  istFrisur,
  istHaarfarbe,
  istAugenfarbe,
  istRuestung,
  FRISUR_MEMBER,
  HAARFARBE_MEMBER,
  AUGENFARBE_MEMBER,
  RUESTUNG_MEMBER,
  FRISUR_VORGABE,
  HAARFARBE_VORGABE,
  AUGENFARBE_VORGABE,
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
  STEIN_TEXTUREN,
  WATER_LEVEL,
  findPrefabByHash,
  sanitizeSteinKit,
  steinTexturAufloesen,
  ambientLichtVon,
  MAX_DUNGEON_AMBIENT,
  interiorEnvironment,
  isInDungeonBand,
  dungeon2,
  serverConfigFlags,
} from '@wov/shared';
import type { SteinKitConfig } from '@wov/shared';
// Serverseitige Weltdaten: NICHT ueber den Barrel, sondern ueber den
// expliziten Pfad — sie tragen die Rohdaten der Weltvorlagen (Pieces bzw.
// Raum-Einrichtung) und haetten im Barrel jedes Client-Bundle aufgeblaeht.
import { getFeaturePieces } from '@wov/shared/src/featurePieces.js';
import { ZDOManager, worldToZone } from './zdo/ZDOManager.js';
import { DungeonManager } from './world/dungeon/DungeonManager.js';
import {
  GENERIERT_DIR,
  baueModul,
  deleteModule,
  registryChecksum,
  registryPruefsumme,
} from './world/dungeon/ModuleBuild.js';
import { ZDO } from './zdo/ZDO.js';
import { ZDOID } from './zdo/ZDOID.js';
import { PrefabManager } from './prefab/PrefabManager.js';
import type { Prefab } from './prefab/Prefab.js';
import { ZoneManager } from './world/ZoneManager.js';
import { setzeZonenZurueck } from './world/zonenRuecksetzer.js';
import { SpawnSystem } from './world/SpawnSystem.js';
import { RoutenLaeufer } from './world/RoutenLaeufer.js';
import { befreieSpielerbauten, istSpielerbau, layoutAbgleich } from './world/layoutAbgleich.js';
import { AggroSystem } from './world/AggroSystem.js';
import { WorldManager, type SavedPlayer, type WorldSaveData } from './world/WorldManager.js';
import { WeltMarken, globalKeyVonName } from './world/WeltMarken.js';
import { HAUPTWELT_ID, Welt, type WeltUmgebung } from './world/Welt.js';
import { Kollisionswelt } from './world/Kollisionswelt.js';
import { Spielerbewegung } from './world/Spielerbewegung.js';
// Ueber den expliziten Pfad, nicht ueber den Barrel: eine Geo ohne
// Landmasse braucht nur der Server, und der Client-Bundle-Schnitt soll
// nicht daran wachsen.
import { LeereGeo } from '@wov/shared/src/worldgen/LeereGeo.js';
import { NetManager, NetManagerConfig } from './net/NetManager.js';
import { Kontendatenbank, type BannArt } from './konto/Kontendatenbank.js';
import { KontoApi } from './konto/KontoApi.js';
import { ForumDatabase } from './forum/ForumDatabase.js';
import { ForumApi } from './forum/ForumApi.js';
import {
  ADMINKONTO_PASSWORT_ENV,
  standardKontoSicherstellen,
  type StandardKontoVorgabe,
} from './konto/StandardKonto.js';
import { Peer } from './net/Peer.js';
import { Reader } from './io/Reader.js';
import { Writer } from './io/Writer.js';
import { AdminCommandRegistry } from './admin/AdminCommands.js';
import { AdminListe } from './admin/AdminListe.js';
import { geheimnisAusEnv, istSpielerId, type SpielerId } from './net/Identitaet.js';
import {
  ZONE_SIZE,
  findItem, ITEM_DEFS,
  REZEPTE,
  packContainer,
  unpackContainer,
  TRUHE_INHALT_MEMBER,
  TRUHE_LOOTED_MEMBER,
} from '@wov/shared';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { waehleChatEmpfaenger, kuerzeChatText } from './spiel/ChatReichweite.js';
// G12: Betriebsmetriken (Tick-Dauer, ZDO-Anzahl, Sync-Bytes/s, Peers) --
// eigenes schmales Modul, s. dessen Kopfkommentar fuer die Abgrenzung zu
// Zeitmessung.ts.
import { erfasseTick, schliesseSekundeAb, MetrikSchreiber } from './Metriken.js';
import type { MetrikSchnappschuss } from '@wov/shared/src/metrik.js';
// G12 Schritt 1: strukturierte Logs hinter einem Schalter, s. Kopfkommentar.
import { strukturLog } from './util/StrukturLog.js';
// Die Ausdauerregel liegt seit dem Ausdauer-Abgleich in `shared`, damit der
// Client sie MITRECHNEN kann — vorher kannte nur diese Datei sie, der Client
// rannte weiter, und der Abgleich zog die Figur staendig zurueck.
import {
  ausdauerAbzug,
  ausdauerSchritt,
  AUSDAUER_REGEL,
} from '@wov/shared/src/bewegung/ausdauer.js';

export interface ServerConfig {
  name: string;
  password: string;
  port: number;
  maxPlayers: number;
  everyoneAdmin: boolean;
  worldName: string;
  worldSeed: string;
  saveIntervalMs: number;
  // Worldgen (D6) — the world* flags (server.yml world section)
  worldGenVersion: number;
  worldBlendSmoothStep: boolean;
  worldBilinearHeight: boolean;
  worldRiverAffectsOcean: boolean;
  worldAshlandsModernNoise: boolean;
  worldDisableDistantRivers: boolean;
  // Phase E/F — zone population flags (world.features/vegetation/creatures)
  worldFeatures: boolean;
  worldVegetation: boolean;
  worldLocationOverrides: boolean;
  dungeonsEnabled: boolean;
  /**
   * E5: Saal-Bau aus dem Dungeon-Editor (server.yml `dungeons.modulbau`).
   * Vorgabe FALSE. Zweites Tor neben `peer.isAdmin`. Bis Paket 0.1 war es
   * das einzige, das wirklich schloss (`everyone-admin: true` machte jeden
   * verbundenen Client zum Admin); seither schliesst `peer.isAdmin`
   * ebenfalls, und dieser Schalter bleibt die zusaetzliche Sperre gegen
   * einen Admin, der versehentlich Dateien nach assets/generiert/ schreibt.
   */
  dungeonsModulbau: boolean;
  /**
   * Zielordner der gebauten Module (`assets/generiert/`). Als Feld und
   * nicht als Konstante im Bauweg, damit ein Test nicht in den Ordner
   * des laufenden Servers schreibt — dieselbe Überlegung wie bei
   * `worldsDir` und `metrikenDatei`.
   *
   * Anders als dort ist die Vorgabe hier trotzdem der ECHTE Ordner: Ohne
   * `dungeonsModulbau` schreibt dieser Weg nie, und ein Test, der bauen
   * will, muss den Schalter ohnehin selbst setzen — dann sieht er auch
   * dieses Feld.
   */
  generiertDir: string;
  /** G2: server-side creature spawning/wander (world.creatures flag). */
  worldCreatures: boolean;
  /** G1: directory holding <worldName>.db.zst saves. */
  worldsDir: string;
  /**
   * Ordner der Kontendatenbanken (`<kontenDir>/<worldName>.db`). War bis
   * 12.09.2026 keine eigene Konfiguration, sondern fest aus `worldsDir`
   * abgeleitet (`resolve(worldsDir, '..', 'konten')`) -- fuer den echten
   * Betrieb richtig (`server/data/worlds` und `server/data/konten` sind
   * Geschwister unter `server/data`), fuer Tests aber ein stiller Fehler:
   * Ein Test, der `worldsDir` wie ueblich auf `server/test/tmp-xyz`
   * umbiegt, landete ueber das `..` doch wieder in `server/test/konten/`
   * -- demselben getrackten Ordner wie jeder andere Test, und mit dem
   * Klarnamen der Welt als Dateiname. Deckte sich der Weltname mit einer
   * eingecheckten Fixture, ueberschrieb der Testlauf sie und hinterliess
   * WAL/SHM-Dateien; `git status` war danach schmutzig und der naechste
   * `tools/wov-update.sh` verweigerte die Arbeit.
   *
   * Jetzt ein eigenes Feld, genau wie `worldsDir` selbst: main.ts setzt es
   * auf den echten Ordner, jeder Test, der `worldsDir` umbiegt, muss
   * `kontenDir` genauso mitgeben (ueblicherweise als Unterordner desselben
   * Testverzeichnisses) -- sonst faellt es sofort auf, statt erst beim
   * naechsten Update.
   *
   * Ports the same story to English: previously derived from `worldsDir`
   * via `..`, which silently escaped a test's own tmp directory back into
   * the tracked `server/test/konten/` whenever worldsDir lived under
   * `server/test/`. Now a first-class field a test must set explicitly.
   */
  kontenDir: string;
  /**
   * Ordner der Forendatenbank (`<forumDir>/<worldName>.db`). Eigene Datei
   * je Gestade und bewusst NICHT in `kontenDir`: Foren- und Kontendaten
   * wachsen unabhaengig, und ein Forum darf neu aufgebaut werden, ohne ein
   * Passwort zu beruehren. Ein Test, der `worldsDir`/`kontenDir` umbiegt,
   * braucht `forumDir` NICHT mehr mitzugeben: Fehlt es, leitet der
   * Konstruktor es als Geschwister von `kontenDir` ab — so landet auch
   * der aelteste Test nicht im echten Ordner (s. Konstruktor).
   *
   * Why a field of its own instead of deriving it from kontenDir via '..':
   * same reason kontenDir is not derived from worldsDir. A test that
   * redirects its data dirs no longer has to redirect this one too; the
   * constructor fills it in as a sibling of kontenDir when it is missing.
   */
  forumDir: string;
  /**
   * G12: Pfad, unter dem einmal je Sekunde ein Betriebsmetriken-
   * Schnappschuss abgelegt wird (der Betriebsdienst admin/ liest ihn,
   * s. dessen GET /metriken). OPTIONAL und standardmaessig UNGESETZT:
   * Tests, die start() rufen, sollen nicht versehentlich in die echte
   * server/data/metriken.json des laufenden Servers schreiben, nur weil
   * sie worldsDir wie ueblich auf ein Testverzeichnis umbiegen, dieses
   * Feld aber vergessen. main.ts setzt ihn fuer den echten Betrieb.
   */
  metrikenDatei?: string;
  /**
   * Festgenageltes Wetter und feste Nebeldichte (server.yml `wetter:`).
   * Der Server RECHNET damit nicht — Wetter und Licht sind reine
   * Clientsache —, er reicht die Vorgabe beim Anmelden durch, damit alle
   * Spieler dieselbe Stimmung sehen. Siehe shared/wetterVorgabe.ts.
   */
  wetterVorgabe: WetterVorgabe;
  /**
   * Ausprobieren ohne Registrierung (server.yml `standard-konto:`).
   * Leer oder `undefined` = kein Standardkonto — der Betreiber hat den
   * Block entfernt oder er stand nie in der Datei. Siehe StandardKonto.ts.
   *
   * Eine LISTE, weil die Webseite zweisprachig ist: `gast` fuer die
   * deutsche Anmeldeseite, `guest` fuer die englische. server.yml darf
   * weiterhin einen einzelnen Block enthalten, `ServerKonfig` macht
   * daraus eine einelementige Liste.
   */
  standardKonten?: StandardKontoVorgabe[];
  /** Kartengenerierungs-Umbau: 'layout' = designer-definierte Welt. */
  worldMode: 'radial' | 'layout';
  /** Pfad des WorldLayout-Dokuments (nur worldMode 'layout'). */
  worldLayoutPath: string;
  /**
   * F3 (Security-Review): Servergeheimnis fuer die SessionToken-Signatur.
   * NUR fuer Tests (deterministischer Lauf, zwei Server-Instanzen mit
   * gemeinsamem Geheimnis pruefen). Im echten Betrieb NIEMALS setzen —
   * der Konstruktor erzeugt bei Fehlen automatisch ein frisches,
   * fluechtiges Geheimnis; siehe die ausfuehrliche Begruendung dort.
   */
  sessionSecret?: Buffer;
}

/** Parade: Fenster (ms), in dem ein Treffer abgewehrt wird (Clip 0,45 s + Nachlauf). */
const PARADE_FENSTER_MS = 600;
/** Parade: Ausdauerkosten (ein Schlag kostet 8). */
const PARADE_AUSDAUER = 4;
/**
 * Schlag: Ausdauerkosten.
 *
 * Stand frueher als blanke 8 zweimal in `handleAttack`. Sie gehoert
 * NICHT in die gemeinsame Ausdauerregel: Was ein Schlag kostet, ist eine
 * Kampfzahl, und `ausdauerAbzug` nimmt die Kosten deshalb als Parameter.
 */
const SCHLAG_AUSDAUER = 8;
const DEFAULT_CONFIG: ServerConfig = {
  name: 'World of Vikings Server',
  password: '',
  port: 2456,
  maxPlayers: 10,
  /*
    FALSE, wie server.yml seit Paket 0.1 (13.09.2026).

    Diese Vorgabe steht fuer ein `new WovServer()` OHNE Konfiguration.
    Das ist im Betrieb nie der Fall -- ein echter Start liest server.yml
    --, mit EINER Ausnahme: `leseServerKonfig` faengt einen
    YAML-Syntaxfehler ab und faehrt mit vollstaendigen Vorgabewerten
    weiter. Stuende hier `true`, machte ein verrutschter Doppelpunkt in
    server.yml jeden Besucher zum Admin, und zwar leise: die eine
    Logzeile dazu geht in einem Startlog unter, und der Server laeuft
    ansonsten. Ein Rueckfall darf Rechte entziehen, nicht vergeben.

    Der Preis steht in den Tests: rund achtzig `createWovServer(...)` in
    server/test/ schicken Admin-Pakete und verliessen sich auf die alte
    Vorgabe. Die betroffenen Dateien setzen `everyoneAdmin: true` jetzt
    ausdruecklich -- was sie ohnehin ehrlicher macht, denn sie pruefen
    Admin-Funktionen, nicht die Rechtevergabe.
  */
  everyoneAdmin: false,
  worldName: 'world',
  worldSeed: 'KxSYuZquuw',
  wetterVorgabe: WETTER_VORGABE_AUS,
  saveIntervalMs: SAVE_INTERVAL_MS,
  worldGenVersion: 2,
  worldBlendSmoothStep: true,
  worldBilinearHeight: false,
  worldRiverAffectsOcean: false,
  // The reference default is true; modern FastNoise AshLands
  // ported in Phase B5 — same terrain as the reference server and the client
  worldAshlandsModernNoise: true,
  worldDisableDistantRivers: false,
  worldFeatures: true,
  worldVegetation: true,
  // Experimental location overrides (server.yml world section)
  worldLocationOverrides: false,
  dungeonsEnabled: true,
  dungeonsModulbau: false,
  generiertDir: GENERIERT_DIR,
  worldCreatures: true,
  worldMode: 'radial',
  worldLayoutPath: 'data/welten/dev.json',
  // main.ts pins this to <server>/data/worlds; cwd-relative fallback so a
  // bare createWovServer() (tests, tools) still has a sane default.
  worldsDir: resolve(process.cwd(), 'data', 'worlds'),
  // Sibling of worldsDir's default, matching the production layout
  // (server/data/worlds and server/data/konten under server/data) --
  // see ServerConfig.kontenDir for why this is no longer derived via '..'.
  kontenDir: resolve(process.cwd(), 'data', 'konten'),
  // Sibling of kontenDir, matching the production layout (server/data/forum
  // next to server/data/konten) -- own field for the same reason.
  forumDir: resolve(process.cwd(), 'data', 'forum'),
};

export class WovServer {
  readonly config: ServerConfig;

  // ── Subsystems ─────────────────────────────────────────────────
  readonly zdos: ZDOManager;
  readonly prefabs: PrefabManager;
  /** Hindernisse der Oberwelt — Formquelle einhaengen: `setzeFormQuelle`. */
  readonly kollisionswelt: Kollisionswelt;
  private readonly spielerbewegung: Spielerbewegung;
  readonly net: NetManager;
  /** Konten und Charaktere. Eigene Datei je Instanz, wie die Welt. */
  private readonly kontenDb: Kontendatenbank;
  /** Das Thing: Forendaten. Eigene Datei je Instanz, getrennt von den Konten. */
  private readonly forumDb: ForumDatabase;
  /** Extensible admin command concept (fly, later teleport/god/...). */
  readonly adminCommands: AdminCommandRegistry;
  /** F5: gesetzte Fortschrittsmarken (GlobalKey) — s. WeltMarken.ts Kopfkommentar. */
  readonly weltMarken = new WeltMarken();

  // ── Worldgen (D6) — built in init(), ground truth for terrain ──
  /**
   * Die Hauptwelt. Entsteht in `init()` und ist von da an die einzige
   * Quelle für Geo, Gelände, Zonen und die weltgebundenen Systeme.
   *
   * Die Zugriffe darunter (`geo`, `heightmaps`, `zones`, `spawns`,
   * `aggro`, `routen`) zeigen ausdrücklich HIERHER und nicht „auf die
   * Welt". Jede Stelle, die sie benutzt, sagt damit: „gilt nur für die
   * Hauptwelt". Was für jede Welt gelten soll, gehört in `Welt` und wird
   * über `welt(peer)` erreicht.
   */
  hauptwelt!: Welt;
  /** Alle Welten dieses Prozesses: die Hauptwelt und je eine je Instanz. */
  readonly welten = new Map<string, Welt>();

  /**
   * Was JEDE Welt vom Server braucht — und nur das.
   *
   * Bewusst zwei schmale Rückrufe statt einer Server-Referenz: Eine Welt,
   * die den Server hält, könnte alles, und dann wandert beim nächsten
   * Umbau wieder Weltlogik hierher zurück, weil es so bequem ist.
   */
  private readonly weltUmgebung: WeltUmgebung = {
    prefabName: (hash) => this.prefabs.getByHash(hash)?.name,
    kreaturTrifft: (pos, dmg, r, weltId) => this.applyCreatureAttack(pos, dmg, r, weltId),
  };

  /**
   * Die Geo aller Instanzen ohne Landmasse — EINE für alle.
   *
   * Sie ist nach dem Bauen unveränderlich (Höhen und Biome sind reine
   * Funktionen des Ortes), teilen ist deshalb gefahrlos. Was NICHT geteilt
   * werden darf, ist der `HeightmapProvider`: Der hält die Geländeeingriffe
   * (`mods`, `comps`) einer Welt, und geteilt trüge eine Instanz die
   * Grabungen einer anderen.
   */
  private readonly leereGeo = new LeereGeo();

  /**
   * Eine Instanzwelt anlegen — dieselbe Bauform wie die Hauptwelt.
   *
   * Der Unterschied steckt in den WERTEN, nicht im Code: eine Geo ohne
   * Landmasse, keine Vegetation, keine Locations, und eine LEERE
   * Spawn-Tabelle. Das Spawnsystem selbst ist da — sonst wanderten und
   * kämpften die Skelette aus der Raum-Einrichtung nicht. Es soll nur
   * nichts von sich aus setzen: Ein Steingrab, in dem Wiesen-Kreaturen
   * nachwachsen, wäre kein Steingrab.
   */
  instanzWeltAnlegen(weltId: string): Welt {
    const vorhanden = this.welten.get(weltId);
    if (vorhanden) return vorhanden;
    const welt = new Welt(
      {
        id: weltId,
        geo: this.leereGeo,
        heightmaps: new HeightmapProvider(this.leereGeo, {
          blendSmoothStep: this.config.worldBlendSmoothStep,
          bilinearSampling: this.config.worldBilinearHeight,
        }),
        zonenSeed: getStableHash(weltId),
        zonenOptionen: {
          worldFeatures: false,
          worldVegetation: false,
          locationOverrides: false,
          dungeonsEnabled: false,
        },
        mitKreaturen: this.config.worldCreatures,
        spawnOptionen: { table: [] },
        mitZonengenerierung: false,
        serverUserId: this.serverUserId,
      },
      this.weltUmgebung
    );
    this.welten.set(weltId, welt);
    return welt;
  }

  /**
   * Eine Instanzwelt wegwerfen.
   *
   * Die Hauptwelt ist ausdrücklich ausgenommen. Ein Tippfehler in einer
   * Dungeon-Kennung soll nicht den Boden unter allen Spielern entfernen.
   */
  instanzWeltEntfernen(weltId: string): void {
    if (weltId === HAUPTWELT_ID) return;
    this.welten.delete(weltId);
  }

  /**
   * Die Welt, in der dieser Peer gerade steht.
   *
   * Bis hierher war „die Welt" immer die Hauptwelt, und jeder ZDO-Zugriff
   * griff ueber `this.zdos` direkt dorthin. Dungeon-Instanzen behalfen
   * sich deshalb mit einem Koordinatenband ab x = 100.000 im SELBEN
   * ZDO-Raum — mit dem Preis, den float32 dort verlangt: Der Abstand
   * zweier darstellbarer Werte betraegt bei 100.000 ganze 7,8 mm.
   *
   * Diese Funktion ist die Naht, an der daraus echte Welten werden. Solange
   * jeder Peer in `HAUPTWELT_ID` steht, liefert sie genau das, was vorher
   * fest verdrahtet war; das ist Absicht, damit der Umbau selbst nichts
   * aendert und die Tests ihn tragen.
   *
   * Unbekannte `worldId` faellt auf die Hauptwelt zurueck statt zu werfen:
   * Ein Peer ohne Welt waere ein Spieler ohne Boden, und ein stiller
   * Rueckfall ist hier das kleinere Uebel als ein Absturz mitten im Tick.
   */
  private welt(peer: Peer): Welt {
    return this.welten.get(peer.worldId) ?? this.welten.get(HAUPTWELT_ID)!;
  }

  /** Kurzform fuer den ZDO-Raum eines Peers — s. `welt()`. */
  private zdosVon(peer: Peer): ZDOManager {
    return this.welt(peer).zdos;
  }
  /** Roh-JSON des WorldLayouts (Layout-Modus) — geht in Phase 4 an Clients. */
  worldLayoutRaw: unknown = null;
  get geo(): IGeo {
    return this.hauptwelt.geo;
  }

  get heightmaps(): HeightmapProvider {
    return this.hauptwelt.heightmaps;
  }

  get zones(): ZoneManager {
    return this.hauptwelt.zones;
  }

  get spawns(): SpawnSystem | null {
    return this.hauptwelt.spawns;
  }

  get routen(): RoutenLaeufer {
    return this.hauptwelt.routen;
  }

  get aggro(): AggroSystem {
    return this.hauptwelt.aggro;
  }
  /** G1: world persistence — created in init(). */
  worldManager!: WorldManager;
  /** Phase G: dungeon documents, entrances and instances. */
  readonly dungeons: DungeonManager;
  /**
   * Last-known player state (G1) — restored positions survive relog and
   * feed the players[] save section.
   *
   * F3 (Security-Review): geschluesselt ueber die stabile spielerId eines
   * Peers, NICHT mehr ueber peer.name — ein frei getippter Anzeigename
   * ist keine Identitaet. Datensaetze aus der Zeit VOR diesem Umbau (und
   * jeder Datensatz, dem eine gueltige spielerId fehlt) liegen weiterhin
   * unter ihrem NAMEN — ermittleGespeichertenStand() findet und migriert
   * sie beim naechsten Login des betreffenden Spielers automatisch auf
   * die neue spielerId (siehe dort). Das ist auch der Normalfall NACH
   * jedem Serverneustart: das Sitzungsgeheimnis lebt absichtlich nur im
   * Arbeitsspeicher (siehe `sessionSecret` im Konstruktor), jedes Token
   * wird beim Neustart ungueltig, und jeder Spieler bekommt beim naechsten
   * Connect eine frische spielerId zugewiesen — ohne den Namens-Fallback
   * wuerde das Position/Inventar bei JEDEM Neustart verlieren.
   */
  private readonly savedPlayers = new Map<string, SavedPlayer>();
  /** S6 (Security-Review): dauerhafte Admin-Liste ueber stabile Spieler-
   *  IDs — ueberlebt Neustart UND Deploy (Begruendung: AdminListe.ts). */
  readonly adminListe: AdminListe;
  /**
   * Was der Konstruktor ueber die als `admin: true` markierten
   * Standardkonten herausgefunden hat. Gesammelt statt sofort gewarnt,
   * weil die Warnung nach `init()` gehoert: dort steht schon der
   * everyone-admin-Kasten, und beide zusammen sind das, was ein Betreiber
   * beim Start ueber die Rechtelage lesen soll.
   */
  private readonly adminkontoHinweise: {
    name: string;
    neuAngelegt: boolean;
    standardpasswortInKonfig: boolean;
  }[] = [];

  // ── Time (world time, start time, etc.) ───────────────────────
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
    /*
      `forumDir` nachziehen, wenn nur `kontenDir` gesetzt wurde.

      Die meisten Tests und Werkzeuge biegen `worldsDir`/`kontenDir` auf
      ein eigenes tmp-Verzeichnis um — `forumDir` entstand aber erst mit
      „Das Thing" (16.09.2026), also NACH diesen Aufrufen. Ohne diese
      Zeile faellt jeder von ihnen auf die Vorgabe von `DEFAULT_CONFIG`
      zurueck und legt seine Forendatenbank in den ECHTEN Ordner
      `server/data/forum/` — genau das ist beim ersten vollen Testlauf
      passiert und hinterliess Laufzeitdateien im Arbeitsbaum.

      Die Ableitung ist dieselbe wie in `ServerKonfig`: `forum` als
      Geschwister von `konten` unter dem Datenverzeichnis. main.ts setzt
      `forumDir` weiterhin ausdruecklich; diese Zeile greift nur, wenn es
      fehlt UND ein anderes Datenverzeichnis bekannt ist.
    */
    const ergaenzt: Partial<ServerConfig> =
      config.forumDir === undefined && config.kontenDir !== undefined
        ? { ...config, forumDir: resolve(config.kontenDir, '..', 'forum') }
        : config;
    this.config = { ...DEFAULT_CONFIG, ...ergaenzt };
    this.serverUserId = 1n; // Server is always user 1

    // Initialize subsystems
    this.zdos = new ZDOManager(this.serverUserId);
    this.prefabs = new PrefabManager();
    // Ohne Formquelle ist die Kollisionswelt leer und der Bewegungsschritt
    // rechnet wie vor dem Umbau (s. Kollisionswelt.ts).
    this.kollisionswelt = new Kollisionswelt(this.zdos, this.prefabs, (x, z) =>
      this.getGroundHeight(x, z)
    );
    this.spielerbewegung = new Spielerbewegung(this.kollisionswelt);
    // Die Höhenabfrage als Closure: `this.heightmaps` entsteht erst in
    // `init()`, der Aufruf erfolgt aber immer später (bei einem Befehl).
    this.adminCommands = new AdminCommandRegistry({
      bodenHoehe: (x, z) => this.getGroundHeight(x, z),
      zonenRuecksetzen: (zx, zy, radius, alt) =>
        setzeZonenZurueck(
          { zdos: this.zdos, heightmaps: this.heightmaps, zones: this.zones },
          zx,
          zy,
          radius,
          { alt }
        ),
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
      resolve(this.dungeonsWurzel(), this.config.worldName),
      (weltId) => this.instanzWeltAnlegen(weltId),
      (weltId) => this.instanzWeltEntfernen(weltId)
    );
    // S6 (Security-Review): dauerhafte Admin-Liste — Pfad und Begruendung
    // (warum server/data/worlds/ statt server.yml) stehen in AdminListe.ts.
    this.adminListe = new AdminListe(
      resolve(this.config.worldsDir, `admins.${this.config.worldName}.json`)
    );
    this.registerDungeonCommands();
    this.registerSpawnCommand();
    this.registerAbbauCommand();
    this.registerAdminListeCommands();
    this.registerBannCommands();
    this.registerMarkeCommand();
    // Karten-Marker: Eingangs-Änderungen an alle Peers verteilen.
    this.dungeons.onEntrancesChanged = () => {
      for (const peer of this.net.getPeers()) this.sendDungeonEntrances(peer);
    };

    // F3 (Security-Review): Servergeheimnis fuer die SessionToken-Signatur.
    //
    // Bewusst NUR im Arbeitsspeicher (crypto.randomBytes) — NICHT auf
    // Platte und NICHT in einer Umgebungsvariable (kein neues /etc/wov.env,
    // keine neue Datei irgendwo). Das Anlegen einer DAUERHAFTEN
    // Zugangsinformation ist eine bewusste Entscheidung, die Mike nicht
    // getroffen hat — ein Vorschlag dazu (WOV_SESSION_SECRET_HEX in
    // /etc/wov.env) liegt im Kopfkommentar von net/Identitaet.ts
    // (Abschnitt 4) bereit, ist aber NICHT umgesetzt.
    //
    // Kosten dieser Wahl: bei JEDEM Serverneustart entsteht ein NEUES
    // Geheimnis. Jedes bis dahin ausgestellte SessionToken wird damit
    // augenblicklich ungueltig (tokenPruefen liefert 'gefaelscht'), und
    // jeder Spieler durchlaeuft beim naechsten Connect wieder die
    // Erst-Anmeldung — neue spielerId, neu abgeleitete Altlast-userId
    // (ZDO-Besitz an bereits gebauten eigenen Pieces geht dabei genauso
    // verloren, wie es HEUTE schon bei jedem einzelnen Reconnect passiert,
    // siehe Identitaet.ts Kopfkommentar — hier passiert es nur noch beim
    // Neustart statt bei jeder Verbindung, das ist eine Verbesserung,
    // keine Verschlechterung). Position/Inventar ueberleben trotzdem: der
    // Migrationspfad ueber den Anzeigenamen greift automatisch (siehe
    // savedPlayers/ermittleGespeichertenStand).
    //
    // Fuer den jetzigen Betrieb hinnehmbar: der Server laeuft tagelang
    // durch, und es ist ohnehin kein Passwort gesetzt.
    // Lab (2026-09-08): a fixed secret from WOV_SESSION_SECRET_HEX in
    // /etc/wov.env lets tools/lab-ticket.ts sign tickets that survive a
    // server restart. Without the variable the old behaviour stays.
    // Labor: festes Geheimnis aus /etc/wov.env, damit tools/lab-ticket.ts
    // Tickets signieren kann, die einen Neustart ueberleben.
    const sessionSecret = this.config.sessionSecret ?? geheimnisAusEnv() ?? randomBytes(32);

    // ── Konten ─────────────────
    // Eigene Datei je Instanz, wie die Welt und wie die Dungeons darueber:
    // Auf dem Testgestade wird absichtlich zurueckgesetzt, dort haben
    // echte Zugangsdaten nichts zu suchen.
    //
    // Die API haengt am SPIELPORT statt an einem eigenen -- dann greift die
    // vorhandene Proxy-Regel fuer play(.dev).world-of-vikings.com.
    // Begruendung ausfuehrlich in KontoApi.ts.
    this.kontenDb = new Kontendatenbank(
      resolve(this.config.kontenDir, `${this.config.worldName}.db`),
    );
    // Das Thing. Eigene Datei je Gestade (s. ForumDatabase.ts); die sechs
    // Bretter legt der Konstruktor idempotent aus BOARD_SLUGS an.
    this.forumDb = new ForumDatabase(
      resolve(this.config.forumDir, `${this.config.worldName}.db`),
    );
    // Ausprobieren ohne Registrierung (server.yml `standard-konto:`).
    // Direkt hier, wo die Kontendatenbank geoeffnet wird -- Begruendung
    // (Idempotenz, Passwort-Handling, warum kein AdminListe-Zugriff) in
    // StandardKonto.ts.
    // Jeder Eintrag einzeln: die Konten sind voneinander unabhaengig,
    // und `standardKontoSicherstellen` bricht auch dann nicht ab, wenn
    // eines davon nicht angelegt werden kann.
    const standardKonten = this.config.standardKonten ?? [];
    for (const vorgabe of standardKonten) {
      const bericht = standardKontoSicherstellen(
        this.kontenDb,
        vorgabe,
        this.config.everyoneAdmin,
      );
      /*
        Rechte vergibt der Aufrufer, nicht StandardKonto.ts -- die
        strukturelle Garantie fuer die NICHT markierten Konten (`gast`,
        `guest`) bleibt damit erhalten, siehe Kopfkommentar dort.
        `bericht.adminCharaktere` ist fuer sie IMMER leer, diese Schleife
        laeuft dann null Mal.

        Warum bei JEDEM Start und nicht nur beim Anlegen des Kontos: Die
        AdminListe liegt in server/data/worlds/ und ist nicht getrackt --
        eine Neuinstallation, ein geloeschtes Datenverzeichnis oder eine
        von Hand entfernte Datei laesst das Konto bestehen und die Liste
        verschwinden. Ohne diesen Abgleich waere die Instanz dann OHNE
        jeden Admin, und zwar dauerhaft: everyone-admin steht auf false,
        also koennte niemand mehr `admin add` aufrufen. `hinzufuegen`
        selbst ist idempotent und schreibt nur bei echter Aenderung.
      */
      for (const c of bericht.adminCharaktere) {
        if (this.adminListe.hinzufuegen(c.spielerId, c.name)) {
          console.log(
            `[Konto] Adminkonto "${vorgabe.name}": Charakter "${c.name}" auf die Admin-Liste gesetzt`,
          );
        }
      }
      if (vorgabe.admin) {
        // An `vorgabe.admin` und NICHT an der Laenge der Charakterliste:
        // Ein markiertes Konto ganz OHNE Charakter (das Anlegen ist
        // fehlgeschlagen, s. die Fehlermeldung aus StandardKonto.ts) ist
        // der schlimmste Fall -- die Instanz hat dann keinen Admin. Genau
        // dann darf die Startmeldung nicht auch noch schweigen.
        if (bericht.adminCharaktere.length === 0) {
          console.error(
            `[Konto] Adminkonto "${vorgabe.name}" hat KEINEN Charakter — diese Instanz hat damit ` +
              'keinen Admin. Ursache steht in den Zeilen darueber.',
          );
        }
        // Fuer die Startwarnung in init() -- dort steht auch, warum
        // "bestehendes Konto" und "frisch angelegt" verschieden lauten.
        this.adminkontoHinweise.push({
          name: vorgabe.name,
          neuAngelegt: bericht.neuAngelegt,
          standardpasswortInKonfig: bericht.standardpasswortInKonfig,
        });
      }
    }
    // Der dritte Parameter beantwortet `/accounts/status` fuer die
    // Webseite. Er wird als Funktion uebergeben und nicht als Wert: `this.net`
    // entsteht erst in der naechsten Anweisung, und die Spielerzahl aendert
    // sich danach staendig, ohne dass die KontoApi davon erfaehrt.
    const kontoApi = new KontoApi(this.kontenDb, sessionSecret, () => ({
      spieler: this.net.peerCount,
      plaetze: this.config.maxPlayers,
      tag: this.getDay(),
      welt: this.config.worldName,
      /*
        OHNE die als `admin: true` markierten Konten. `/accounts/status`
        ist die Liste, die die Anmeldeseite als "Ausprobieren ohne
        Registrierung" ANBIETET — dort das Adminkonto zu nennen hiesse,
        jedem Besucher zu sagen, welchen Benutzernamen er raten soll.
        Sein Passwort steht ohnehin im oeffentlichen Repo; einen Grund,
        auch noch den Namen aktiv zu bewerben, gibt es nicht.
      */
    }), standardKonten.filter((k) => !k.admin).map((k) => k.name));

    // Das Thing haengt am SELBEN Port wie die Konten: erst die Konten,
    // dann das Forum. `behandle` gibt `false` zurueck, wenn der Pfad nicht
    // ihm gehoert — so bleibt die 426-Gesundheitspruefung fuer alles andere.
    //
    // Schreiben prueft dasselbe Kontotoken wie die Konten-API
    // (`kontoApi.kontoIdAus`) und loest den genannten Charakter ueber die
    // Kontendatenbank auf — ein Client kann sich keinen fremden Namen und
    // keinen fremden Charakter aneignen.
    const forumApi = new ForumApi(
      this.forumDb,
      (req) => kontoApi.kontoIdAus(req),
      (kontoId, charakterId) => {
        const c = this.kontenDb.charakterVonKonto(kontoId, charakterId);
        return c ? { id: c.id, name: c.name } : null;
      },
      // Moderator = Admin, und zwar ueber dieselbe Liste wie im Spiel: Ein
      // Konto ist Moderator, wenn EINER seiner Charaktere auf der
      // Admin-Liste steht. `everyoneAdmin` gilt auch hier — auf dem
      // Testgestade ist ohnehin jeder Admin.
      (kontoId) => {
        if (this.config.everyoneAdmin) return true;
        return this.kontenDb.charaktereVonKonto(kontoId).some((c) => this.adminListe.enthaelt(c.spielerId));
      },
      // `@Name` aufloesen: derselbe Weg wie der Adminbefehl, der einen
      // Charakter zu einem Namen sucht (`charakterNachName`).
      (name) => this.kontenDb.charakterNachName(name)?.kontoId ?? null,
    );

    this.net = new NetManager({
      port: this.config.port,
      httpBehandler: (req, res) => kontoApi.behandle(req, res) || forumApi.behandle(req, res),
      password: this.config.password,
      serverName: this.config.name,
      maxPlayers: this.config.maxPlayers,
      everyoneAdmin: this.config.everyoneAdmin,
      sessionSecret,
      istAdminId: (id) => this.adminListe.enthaelt(id),
      // Der Name kommt aus dem Konto, nicht aus der Behauptung des
      // Browsers -- Begruendung in NetManager.handlePasswordAuth.
      charakterZuSpielerId: (id) => this.kontenDb.charakterZuSpielerId(id),
      /*
        Die Bannliste, angeschlossen (Pakete 0.5 und 0.1 zusammengefuehrt).
        Ohne dieses eine Feld bleibt `bannPruefen` im NetManager undefined
        und die ganze Liste ist wirkungslos: Banns stuenden in der
        Datenbank, `bann liste` zaehlte sie auf, und trotzdem kaeme jeder
        herein. Ein Fehler ohne Symptom — deshalb steht er hier als
        Kommentar UND als Pruefung (server/test/adminbefehle-bann.ts).

        Die Pruefung laeuft VOR der Admin-Entscheidung (Reihenfolge in
        handlePasswordAuth): ein Bann gilt auch fuer einen Admin. Dass
        sich dabei niemand versehentlich selbst oder den letzten Admin
        aussperrt, regelt der Befehl, nicht diese Zeile — s.
        registerBannCommands().
      */
      bannPruefen: (zugang) => this.kontenDb.bannFuerZugang(zugang),
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

  // ── Lifecycle (init/update/uninit, Start/Stop) ─────────────────

  init(): void {
    console.log('[WoV] Initializing...');

    // S6 (Security-Review): deutliche Warnung, solange everyone-admin
    // aktiv ist — bewusst NICHT abgeschaltet (Mikes Handgriff), aber wer
    // das Log liest, soll nicht raten muessen, dass JEDER verbundene
    // Spieler heute Admin-Rechte hat.
    if (this.config.everyoneAdmin) {
      console.warn('╔══════════════════════════════════════════════════════════════════╗');
      console.warn('║ ACHTUNG: players.everyone-admin ist AKTIV.                        ║');
      console.warn('║ JEDER verbundene Spieler hat Admin-Rechte (fly, teleport, admin-  ║');
      console.warn('║ Liste aendern, Weltzeit, ...). Fuer einen oeffentlich erreich-    ║');
      console.warn('║ baren Server ist das NICHT sicher.                                ║');
      console.warn('║ Abschalten: players.everyone-admin: false in server.yml — danach  ║');
      console.warn('║ gewaehrt nur noch die dauerhafte Admin-Liste Rechte (Befehl        ║');
      console.warn('║ "admin liste" / "admin add <Name>").                              ║');
      console.warn('╚══════════════════════════════════════════════════════════════════╝');
    }

    /*
      Paket 0.1: Das Adminkonto. Mikes Vorgabe vom 13.09.2026 ist ein
      Konto `admin` mit dem Passwort `admin` als ANFANGSZUSTAND einer
      frischen Installation ("es ist ja nur der initiale Zustand"). Fuer
      einen Laptop ist das genau richtig, fuer den oeffentlich
      erreichbaren Server ist es eine offene Tuer -- und der Unterschied
      zwischen beiden ist genau dieser Kasten. Muster: die
      everyone-admin-Warnung darueber.

      DREI Texte, weil der Server drei verschiedene Dinge WEISS -- und
      der Unterschied zwischen "weiss" und "vermutet" gehoert in die
      Meldung, sonst ist sie irgendwann Rauschen:

        (a) frisch angelegt, dokumentiertes Passwort -> GEWISSHEIT. Der
            Server hat genau dieses Passwort gerade eingelagert.
        (b) bestehendes Konto, dokumentiertes Passwort in der Konfig ->
            VERMUTUNG. Gespeichert ist ein scrypt-Hash, und
            `standardKontoSicherstellen` fasst ihn nie an; der Server kann
            also nicht sagen, ob das Konto den Vorgabewert noch traegt.
            Aufgefallen beim Nachstellen: Wer WOV_ADMINKONTO_PASSWORT
            setzt, startet, und die Variable spaeter wieder entfernt, hat
            ein Konto mit eigenem Passwort und eine Konfig, die den
            Vorgabewert nennt. Ein Text, der hier "steht auf dem
            dokumentierten Passwort" behauptet, waere schlicht falsch.
        (c) bestehendes Konto, eigenes Passwort in der Konfig -> die
            umgekehrte Falle: die Konfig wirkt NICHT mehr. Das ist keine
            Warnung wert, aber eine Zeile, damit niemand glaubt, ein
            spaeter gesetztes WOV_ADMINKONTO_PASSWORT haette gewirkt.
    */
    for (const hinweis of this.adminkontoHinweise) {
      if (hinweis.standardpasswortInKonfig && hinweis.neuAngelegt) {
        console.warn('╔══════════════════════════════════════════════════════════════════╗');
        console.warn('║ ACHTUNG: Das Adminkonto wurde MIT dem dokumentierten Passwort     ║');
        console.warn('║ angelegt.                                                         ║');
        console.warn(`║ Konto "${hinweis.name}" hat volle Weltgewalt (fly, teleport, spawn, item,`);
        console.warn('║ Admin-Liste aendern), und dieses Passwort steht in server.yml, im ║');
        console.warn('║ README und in docs/server-setup.md — also im oeffentlichen Repo.  ║');
        console.warn('║ Fuer einen erreichbaren Server ZWINGEND aendern:                  ║');
        console.warn('║   WOV_ADMINKONTO_PASSWORT=<eigenes> in /etc/wov.env, dann das     ║');
        console.warn('║   Konto neu anlegen — ein bestehendes Konto behaelt sein          ║');
        console.warn('║   Passwort (docs/server-setup.md, Abschnitt "Adminkonto").        ║');
        console.warn('╚══════════════════════════════════════════════════════════════════╝');
      } else if (hinweis.standardpasswortInKonfig) {
        console.warn('╔══════════════════════════════════════════════════════════════════╗');
        console.warn('║ ACHTUNG: server.yml nennt fuer das Adminkonto weiterhin das       ║');
        console.warn('║ dokumentierte Passwort aus dem oeffentlichen Repo.                ║');
        console.warn(`║ Konto "${hinweis.name}" bestand schon, gespeichert ist nur ein Hash — ob`);
        console.warn('║ es den Vorgabewert noch traegt, kann der Server nicht sagen.      ║');
        console.warn('║ Wurde es damit angelegt, steht die Tuer offen. Pruefen und ggf.   ║');
        console.warn('║ neu anlegen: docs/server-setup.md, Abschnitt "Adminkonto".        ║');
        console.warn('╚══════════════════════════════════════════════════════════════════╝');
      } else if (!hinweis.neuAngelegt) {
        console.log(
          `[Konto] Adminkonto "${hinweis.name}" bestand bereits — sein gespeichertes Passwort ` +
            `bleibt unveraendert, auch wenn ${ADMINKONTO_PASSWORT_ENV} oder server.yml inzwischen ` +
            'etwas anderes sagen (docs/server-setup.md, Abschnitt "Adminkonto").',
        );
      } else {
        console.log(`[Konto] Adminkonto "${hinweis.name}" mit eigenem Passwort angelegt`);
      }
    }

    // Load prefabs
    this.prefabs.registerDefaults();

    // D6: world generation (lakes/rivers/streams + heightmap provider).
    // This is the same GeoManager the reference server and the client run —
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
    const geo = createGeo({
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
    const heightmaps = new HeightmapProvider(geo, {
      blendSmoothStep: this.config.worldBlendSmoothStep,
      bilinearSampling: this.config.worldBilinearHeight,
    });
    // Die Hauptwelt — gebaut wie jede andere Welt auch (s. `Welt`). Sie
    // reicht ihren ZDO-Raum herein, weil der schon im Konstruktor
    // entsteht: Der Dungeon-Manager und die Admin-Befehle hängen daran,
    // lange bevor es eine Geo gibt.
    this.hauptwelt = new Welt(
      {
        id: HAUPTWELT_ID,
        geo,
        heightmaps,
        zonenSeed: getStableHash(this.config.worldSeed),
        zonenOptionen: {
          worldFeatures: this.config.worldFeatures,
          worldVegetation: this.config.worldVegetation,
          locationOverrides: this.config.worldLocationOverrides,
          dungeonsEnabled: this.config.dungeonsEnabled,
          platzierungenFreihalten: true,
        },
        mitKreaturen: this.config.worldCreatures,
        zdos: this.zdos,
        serverUserId: this.serverUserId,
      },
      this.weltUmgebung
    );
    this.welten.set(HAUPTWELT_ID, this.hauptwelt);
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

    // F2: post-geo init — book ALL feature instances globally, once,
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

    // G1: load the save file — restore worldTime, generated
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
    if (this.spawns) {
      // Das System selbst gehört der Welt (s. `Welt`); hier wird nur noch
      // übernommen, was aus dem Spielstand zurückkam — und das kann erst
      // NACH loadWorld passieren.
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

    // Routen-NPCs und Aggro gehören der Welt und stehen längst (s.
    // `Welt`). `spawnLayoutPlacements` meldet nur noch die Platzierungen
    // mit `route` beim RoutenLaeufer an — und MUSS deshalb hier stehen,
    // nach dem Aufbau der Welt.
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
   * dupliziert, sondern an das Dokument angeglichen, soweit der Designer
   * etwas geändert hat (Soll-Stempel: Drehung, Skalierung, Position).
   * Gelöschte Platzierungen nehmen ihr ZDO mit. Die Einzelheiten stehen in
   * `world/layoutAbgleich.ts`.
   *
   * Hier werden auch die Routen verdrahtet: Trägt eine Platzierung eine
   * `route`, übernimmt der RoutenLaeufer die ZDO (s. dort).
   */
  private spawnLayoutPlacements(): void {
    if (this.config.worldMode !== 'layout') return;
    const bericht = sanitizeWorldLayoutMitBericht(this.worldLayoutRaw);
    const layout = bericht?.layout ?? null;
    // Ein Dokument ohne Platzierungen ist gültig und heißt „keine": Der
    // Abgleich räumt dann die Layout-ZDOs ab, die sonst für immer stünden.
    // „Bewusst leer" heißt aber nur: das Feld `placements` fehlt oder ist ein
    // Array (auch ein leeres). Steht dort etwas anderes (null, Objekt, Text,
    // Zahl), hat der Sanitizer es stillschweigend zu „fehlt" gemacht — und ein
    // Tippfehler in der Datei würde die ganze Welt abräumen. Dann bleibt alles
    // stehen. Ein unlesbares Dokument (null) lässt die Welt ebenfalls in Ruhe.
    //
    // Was dieser frühe Rücksprung mitnimmt: Der Abgleich läuft gar nicht, also
    // werden in diesem Boot auch Routen-NPCs NICHT beim Läufer angemeldet (sie
    // wandern als gewöhnliche Kreaturen um ihren Platz) und `pruefeLayout`
    // schweigt. Einzige Ausnahme: Spielerbauten von einer veralteten Kennung
    // zu befreien ist kein Löschen und läuft trotzdem.
    // (`layout` ist hier nie null: lehnt der Sanitizer das ganze Dokument ab,
    // bricht der Boot schon beim Laden ab, s. init(). Der Zweig steht für den
    // Typ.)
    if (!layout) return;
    const rohPlacements = (this.worldLayoutRaw as { placements?: unknown } | null)?.placements;
    if (rohPlacements !== undefined && !Array.isArray(rohPlacements)) {
      this.meldeUnlesbar(
        `placements unlesbar (${rohPlacements === null ? 'null' : typeof rohPlacements}) – Layout-Objekte bleiben unangetastet`
      );
      return;
    }
    // Dasselbe Loch in anderer Form: Ein Array mit Einträgen, von dem der
    // Sanitizer ALLE verwirft (Text, leere Objekte, kaputte Koordinaten), ist
    // nicht „bewusst leer" — die Welt bliebe ohne einen einzigen Eintrag
    // zurück und alle Layout-ZDOs gingen mit. Werden nur einige verworfen,
    // löscht dieser Boot ebenfalls nichts (s. `layoutAbgleich`, `ohneLoeschen`).
    const rohAnzahl = Array.isArray(rohPlacements) ? rohPlacements.length : 0;
    const gueltigeAnzahl = layout.placements?.length ?? 0;
    if (rohAnzahl > 0 && gueltigeAnzahl === 0) {
      this.meldeUnlesbar(`placements: alle ${rohAnzahl} Einträge verworfen – Layout-Objekte bleiben unangetastet`);
      return;
    }
    const ergebnis = layoutAbgleich(
      {
        zdos: this.zdos,
        prefabs: this.prefabs,
        bodenHoehe: (x, z) => this.getGroundHeight(x, z),
        bodenAbstand: (hash) => this.foliageOffset.get(hash) ?? 0,
        anRoute: (zdo, route) => {
          // Der NPC gehört jetzt der Route: Aus der Kreatur-Simulation
          // nehmen, sonst zerren Wander-KI und Route an derselben Position
          // (NPC_1-ZDOs werden beim Boot adoptiert, s. init()).
          this.spawns?.entlasse(zdo);
          this.routen?.registriere(zdo, route);
        },
        wirdBewegt: (zdo) => this.wanderEintrag(zdo.prefabHash) !== null,
        verankere: (zdo) => {
          // Neu adoptieren: Der Wander-Anker ist die Position beim Adoptieren.
          const entry = this.wanderEintrag(zdo.prefabHash);
          if (!entry) return;
          this.spawns?.entlasse(zdo);
          this.spawns?.adoptSingle(zdo, entry);
        },
      },
      layout,
      // Zusammengefasste exakte Duplikate sind nichts Verworfenes (dieselbe Zahl wie im Schreibweg).
      { verworfen: Math.max(0, rohAnzahl - gueltigeAnzahl), zusammengefasst: bericht?.zusammengefasst.length ?? 0 }
    );
    if (ergebnis.aufRoute > 0) console.log(`[WoV] Layout-Routen: ${ergebnis.aufRoute} NPC(s) laufen eine Route`);
    console.log(
      `[WoV] Layout-Abgleich: ${ergebnis.gespawnt} gespawnt, ${ergebnis.aktualisiert} aktualisiert, ` +
        `${ergebnis.unveraendert} unverändert, ${ergebnis.entfernt} entfernt` +
        (ergebnis.ueberzaehlig > 0 ? ` (davon ${ergebnis.ueberzaehlig} überzählig)` : '') +
        (ergebnis.umgestempelt > 0 ? `, davon ${ergebnis.umgestempelt} auf die Platzierungs-id umgestempelt` : '') +
        `, ${ergebnis.unbekannt} unbekannt (Prefab übersprungen)`
    );
    if (ergebnis.ohneLoeschen) {
      console.warn(
        `[WoV] Layout-Abgleich ohne Löschen: ${ergebnis.ohneLoeschen.verworfen} Einträge verworfen – ` +
          `${ergebnis.ohneLoeschen.stehenGeblieben} verwaiste Layout-Objekte bleiben bis zum nächsten sauberen Dokument stehen`
      );
    }
    if (!layout.placements?.length && ergebnis.entfernt > 0) {
      console.warn(`[WoV] Layout-Abgleich: Dokument ohne Platzierungen — ${ergebnis.entfernt} verwaiste ZDO(s) entfernt`);
    }
    if (ergebnis.ueberzaehlig > 0) {
      console.warn(`[WoV] Layout-Abgleich: ${ergebnis.ueberzaehlig} überzählige Layout-ZDOs mit gleicher Kennung entfernt`);
      for (const u of ergebnis.ueberzaehligeZdos) {
        console.warn(`[WoV] Layout-Abgleich: überzähliges ZDO ${u.id} (${u.kennung}) mit ${u.member} Zustands-Member(n) entfernt`);
      }
    }
    for (const u of ergebnis.unbekanntePrefabs) {
      console.warn(
        `[WoV] Layout-Hinweis: Platzierung ${u.kennung}: Prefab '${u.prefab}' unbekannt — erzeugt kein ZDO` +
          (u.geschont > 0
            ? `; ${u.geschont} ZDO(s) mit dieser Kennung oder im Umkreis von 1 m bleiben unangetastet`
            : '; kein ZDO betroffen')
      );
    }
    if (ergebnis.freigegeben > 0) {
      console.log(`[WoV] Layout-Abgleich: ${ergebnis.freigegeben} Spielerbau(ten) von einer veralteten Layout-Kennung befreit`);
    }
    for (const k of ergebnis.ueberSpielerbau) {
      console.warn(`[WoV] Layout-Hinweis: Platzierung ${k} steht genau über einem Spielerbau — beide Objekte bleiben`);
    }
    // Inhaltlicher Bericht (Review-Punkt 32): unbekannte Namen und ein
    // fehlender Startpunkt stehen jetzt im Boot-Log statt still zu bleiben.
    for (const b of pruefeLayout(layout)) {
      console.warn(`[WoV] Layout-Hinweis (${b.wo}): ${b.text}`);
    }
  }

  /**
   * Frühe Rückkehr des Layout-Abgleichs (Dokument nicht lesbar): Warnzeile mit
   * dem Hinweis auf die Nebenwirkung, und die Spielerbauten trotzdem von
   * veralteten Kennungen befreien (kein Löschen).
   */
  private meldeUnlesbar(grund: string): void {
    console.warn(
      `[WoV] Layout-Abgleich: ${grund} (in diesem Boot werden Routen-NPCs nicht beim Läufer angemeldet)`
    );
    const frei = befreieSpielerbauten(this.zdos);
    if (frei > 0) {
      console.log(`[WoV] Layout-Abgleich: ${frei} Spielerbau(ten) von einer veralteten Layout-Kennung befreit`);
    }
  }

  /**
   * Der Wander-Eintrag, mit dem das SpawnSystem dieses Prefab führt (NPC,
   * Boss, Kreatur der Tabelle) — oder null, wenn es nichts bewegt und der
   * Layout-Abgleich das Objekt als ruhend behandelt. Dieselbe Auswahl wie
   * bei der Adoption in init(), inklusive der Prüfung auf ein eigenes Modell.
   */
  private wanderEintrag(prefabHash: number): SpawnEntry | null {
    if (!this.spawns) return null;
    const entry: SpawnEntry | undefined =
      prefabHash === getStableHash('NPC_1')
        ? NPC_ENTRY
        : prefabHash === EIKTHYR_HASH
          ? BOSS_ENTRY
          : SPAWN_TABLE.find((e) => getStableHash(e.prefab) === prefabHash);
    return entry && istEigenesModell(entry.prefab) ? entry : null;
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

  /**
   * Geländehöhe der HAUPTWELT (D6 server ground truth).
   *
   * Wer die Höhe für einen Peer braucht, fragt `welt(peer).bodenHoehe()` —
   * in einer Instanz ohne Landmasse antwortet diese Funktion hier sonst
   * mit dem Gelände der Oberwelt, und das ist an x = 0 ein Ozeanboden.
   */
  getGroundHeight(x: number, z: number): number {
    return this.hauptwelt.bodenHoehe(x, z);
  }

  /**
   * Everything except the network runs synchronously, as before. The promise
   * settles with the network bind: it resolves with the bound port, and
   * rejects (EADDRINUSE, EACCES, ...) when the port cannot be had, so the
   * caller sees the failure instead of a server that never listens.
   */
  start(): Promise<number> {
    this.init();

    // A second start() without stop() must not stack timers.
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);

    this.running = true;
    this.startTime = Date.now();
    this.prevUpdateTime = this.startTime;

    // Start network
    const gebunden = this.net.start();

    // Main update loop (~60fps server tick)
    const TICK_MS = 1000 / 30; // 30 ticks per second
    this.updateTimer = setInterval(() => {
      // G12: EIN Zeitstempelpaar je Tick, kein Profiling im Inneren von
      // update() -- billig genug, um immer zu laufen (s. Metriken.ts).
      // Die zwei Phasen (Welten, Sync) stempelt update() selbst und legt
      // sie in tickWeltenMs/tickSyncMs ab; "Rest" ist die Differenz.
      const t0 = performance.now();
      this.update();
      erfasseTick(performance.now() - t0, this.tickWeltenMs, this.tickSyncMs);
    }, TICK_MS);

    // Periodic world save — D8: asynchron, damit die 30-Minuten-Sicherung
    // nicht jedes Mal den Sync-Takt aussetzen lässt. Beim Herunterfahren
    // bleibt es beim synchronen Weg (s. stop()).
    this.saveTimer = setInterval(() => {
      void this.saveWorldAsync();
    }, this.config.saveIntervalMs);

    return gebunden.then(
      (port) => {
        console.log(`[WoV] Server started: "${this.config.name}" on port ${port}`);
        console.log(`[WoV] World: ${this.config.worldName} (seed: ${this.config.worldSeed})`);
        return port;
      },
      (err: unknown) => {
        // The bind failed: no orphaned tick, no double timers on a retry.
        // No save here: a server without a port must not write the world.
        this.running = false;
        if (this.updateTimer) clearInterval(this.updateTimer);
        if (this.saveTimer) clearInterval(this.saveTimer);
        this.updateTimer = null;
        this.saveTimer = null;
        throw err;
      },
    );
  }

  /**
   * Stoppt den Server und schreibt den Endstand. Liefert `true`, wenn der
   * Endstand auf der Platte liegt, `false`, wenn das Speichern gescheitert
   * ist. Wirft nie: Ein Stopp, der an seinem eigenen Speichern haengen
   * bleibt, laesst den Prozess leben und den Port offen (Befund K4.0,
   * 20.09.2026) -- dann killt systemd nach TimeoutStopSec ohne Speichern.
   */
  stop(): boolean {
    this.running = false;

    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);

    // Netz zuerst zu, aber nur die ANNAHME: Die verbundenen Peers muessen
    // fuer den Save noch in der Liste stehen (momentaufnahme() liest ihre
    // Positionen, Inventare, Rüstung). Sie fliegen erst danach raus.
    this.net.schliesseAnnahme();

    // Beim Herunterfahren bewusst SYNCHRON: `stop()` läuft im Signal-Handler,
    // und ein Prozess, der gleich beendet wird, arbeitet keine Promises mehr
    // ab — ein asynchroner Save käme nie bis zum `rename`.
    let gespeichert = true;
    try {
      this.saveWorld();
    } catch (err) {
      gespeichert = false;
      // Feste Kennung, damit ein Betriebsdienst oder das Ausrollskript die
      // Zeile im Journal findet (tools/wov-update.sh sucht danach).
      console.error(
        `[WoV] SAVE_FAILED_ON_STOP: Endstand NICHT gespeichert, Stand der letzten Sicherung bleibt: ${
          err instanceof Error ? (err.stack ?? err.message) : String(err)
        }`
      );
      strukturLog('world_save_failed_on_stop', { fehler: String(err) });
    }

    try {
      this.net.stop();
    } catch (err) {
      console.error(`[WoV] net.stop fehlgeschlagen: ${err}`);
    }

    console.log(`[WoV] Server stopped${gespeichert ? '' : ' (OHNE Endstand)'}`);
    return gespeichert;
  }

  // ── Main update loop (update()) ────────────────────────────────

  /** Letzter Timeout-Prüflauf (alle ~5 s reicht). */
  private letzteTimeoutPruefung = 0;

  /**
   * Durations of the two measured tick phases, written by update() and read
   * by the tick timer right after it returns. Plain numbers on the instance:
   * nothing is allocated per tick.
   */
  private tickWeltenMs = 0;
  private tickSyncMs = 0;

  private update(): void {
    this.tickWeltenMs = 0;
    this.tickSyncMs = 0;
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

    // E3: generate vegetation zones around players (nearby-zone generation
    // per peer; budgeted drain instead of blocking inline generation)
    const peers = this.net.getPeers();
    if (peers.length > 0) {
      // JEDE Welt tickt, nicht nur die Hauptwelt — und jede mit den
      // Spielern, die IN IHR stehen. Vorher stand hier ein Filter, der
      // Spieler im Dungeon-Band von den Oberweltsystemen fernhielt; das
      // war die Krücke, die nötig war, solange alles einen ZDO-Raum
      // teilte. Jetzt trennen die Welten selbst.
      //
      // Eine Welt ohne Spieler bekommt eine leere Liste und rechnet
      // deshalb fast nichts: Vegetation, Kreaturen und Routen hängen alle
      // am Umkreis der Spieler. Eine leerstehende Instanz kostet nichts.
      const positionenJeWelt = new Map<string, Vector3[]>();
      for (const p of peers) {
        const liste = positionenJeWelt.get(p.worldId);
        if (liste) liste.push(p.position);
        else positionenJeWelt.set(p.worldId, [p.position]);
      }
      const weltenStart = performance.now();
      for (const welt of this.welten.values()) {
        const positionen = positionenJeWelt.get(welt.id);
        if (!positionen?.length) continue;
        const { neueZonen } = welt.tick(deltaSec, positionen);
        if (neueZonen > 0) {
          console.log(
            `[WoV] Vegetation (${welt.id}): +${neueZonen} zone(s) ` +
              `(${welt.zones.generatedZoneCount} total, ${welt.zdoAnzahl} ZDOs)`
          );
        }
      }
      this.tickWeltenMs = performance.now() - weltenStart;
    }

    // ZDO sync at fixed interval (ZDO send interval: 50ms)
    this.zdoSyncAccumulator += deltaMs;
    if (this.zdoSyncAccumulator >= ZDO_SEND_INTERVAL_MS) {
      this.zdoSyncAccumulator -= ZDO_SEND_INTERVAL_MS;
      const syncStart = performance.now();
      this.syncZDOs();
      this.tickSyncMs = performance.now() - syncStart;
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
      // Adminrechte offener Sitzungen an die Liste angleichen. Im
      // selben 1-Sekunden-Takt und nicht in einem eigenen Timer, aus
      // demselben Grund wie der Rest dieses Blocks. Warum ueberhaupt
      // getaktet und nicht nur beim Befehl: s. gleicheAdminrechteAb().
      this.gleicheAdminrechteAb();
      // Dungeon-Regeneration: leere Instanzen nach Ablauf abreißen.
      this.dungeons.tick(now);
      this.eventTick(now);

      // G12: Betriebsmetriken im selben 1-Sekunden-Takt abschliessen --
      // kein zusaetzlicher Timer, derselbe Grund wie beim Rest dieses
      // Blocks. `peers` ist die oben in update() bereits geholte Liste.
      const metrikSchnappschuss = schliesseSekundeAb(
        this.zdos.totalZDOCount,
        peers.length,
        now,
        this.ohneWeltVerworfen
      );
      this.schreibeMetriken(metrikSchnappschuss);
    }
  }

  /** G12: writes snapshot and daily log (`MetrikSchreiber`); created on first use. */
  private metrikSchreiber?: MetrikSchreiber;

  /**
   * G12: Schnappschuss fuer den Betriebsdienst rausschreiben und als Zeile an
   * das Tageslog haengen. Optional (s. `metrikenDatei` in ServerConfig) --
   * ohne Pfad passiert nichts, die Akkumulatoren wurden in
   * schliesseSekundeAb() trotzdem schon geleert. Fehler schluckt und meldet
   * (gedrosselt) der Schreiber selbst, s. Metriken.ts.
   */
  private schreibeMetriken(schnappschuss: MetrikSchnappschuss): void {
    const pfad = this.config.metrikenDatei;
    if (!pfad) return;
    this.metrikSchreiber ??= new MetrikSchreiber(pfad);
    this.metrikSchreiber.schreibe(schnappschuss);
  }

  /** The world clock is sent periodically; see update() for why. */
  private sendTimeSync(peer: Peer): void {
    peer.sendPacketWith(PacketType.TimeSync, (w) => {
      w.writeFloat64(this.worldTime);
      w.writeFloat64(this.getTimeOfDay());
      w.writeInt32(this.getDay());
    });
  }

  // ── ZDO Sync (sending ZDOs) ────────────────────────────────────

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
   *  2. Ein Bandbreitenbudget je Peer (wie im Original): Was in diesem
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
    //
    // JE WELT abholen und nur an die Peers DIESER Welt verteilen. Vorher
    // gab es eine Liste, weil es einen ZDO-Raum gab; jetzt hat jede Welt
    // ihre eigene. Ein Peer, der die Zerstörungen einer fremden Welt
    // bekäme, entfernte Objekte, die er nie gesehen hat — die IDs sind je
    // ZDO-Raum vergeben und kollidieren zwangsläufig.
    //
    // Auch ohne Spieler geleert, sonst wächst die Liste unbegrenzt
    // (Review-Punkt 29) — und gerade eine leerstehende Instanz, die
    // gerade abgerissen wurde, hat eine volle.
    for (const welt of this.welten.values()) {
      const destroyList = welt.zdos.consumeDestroyList();
      if (destroyList.length === 0) continue;
      for (const peer of peers) {
        if (peer.worldId === welt.id) peer.stelleZerstoerungenEin(destroyList);
      }
    }
    if (peers.length === 0) return;

    const tick = Math.floor(this.worldTime * 1000);

    for (const peer of peers) {
      // Bandbreitenbudget (wie im Original: 10240 minus Sendewarteschlange;
      // unter 2048 wird in diesem Tick nichts gesendet).
      // Der Socket-Rückstau ist das Maß dafür, wie viel die Leitung des
      // Peers gerade wirklich abnimmt. Wer schon zusteht, bekommt nichts
      // obendrauf — genau das verhindert, dass ein einziger langsamer
      // Client den Server-Speicher mit ungesendeten Puffern füllt.
      const budget = ZDO_MAX_SEND_THRESHOLD - peer.sendeRueckstau;
      if (budget < ZDO_MIN_SEND_THRESHOLD) continue;

      const peerZone = worldToZone(peer.position);
      const fenster = peer.fenster.hole(
        this.zdosVon(peer),
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
        this.writeZDO(writer, zdo, stand?.dataRevision, peer);
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
  private writeZDO(w: Writer, zdo: ZDO, peerRev: number | undefined, peer: Peer): void {
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
    // Der Truheninhalt geht nur an den, der die Truhe benutzen darf. Der
    // Client liest ihn gar nicht aus dem Sync (er bekommt ihn per
    // ContainerSync beim Oeffnen), fuer alle anderen war er nur mitgereist.
    const verdeckt = this.verdeckterMember(zdo, peer);
    if (voll) {
      let anzahlVoll = members.size;
      if (verdeckt !== undefined && members.has(verdeckt)) anzahlVoll--;
      w.writeInt32(anzahlVoll);
      for (const [hash, member] of members) {
        if (hash === verdeckt) continue;
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
    for (const [hash, member] of members) if (member.rev > peerRev! && hash !== verdeckt) neue++;
    w.writeInt32(neue);
    if (neue === 0) return;
    for (const [hash, member] of members) {
      if (member.rev <= peerRev! || hash === verdeckt) continue;
      w.writeInt32(hash);
      w.writeUInt8(member.type);
      w.writeByTypeTag(member.type, member.value);
    }
  }

  private static readonly TRUHE_INHALT_HASH = getStableHash(TRUHE_INHALT_MEMBER);

  /**
   * Hash des Members, den `peer` von diesem ZDO NICHT bekommt (sonst
   * `undefined`). Heute nur der Truheninhalt fremder Truhen; die Regel ist
   * `darfBenutzen`, keine zweite daneben.
   */
  private verdeckterMember(zdo: ZDO, peer: Peer): number | undefined {
    if (!zdo.hasMember(WovServer.TRUHE_INHALT_HASH)) return undefined;
    return this.darfBenutzen(zdo, peer) ? undefined : WovServer.TRUHE_INHALT_HASH;
  }

  // ── Peer lifecycle ─────────────────────────────────────────────

  private onPeerAuthenticated(peer: Peer): void {
    // Das autoritative Aussehen muss VOR ServerConfig zum eigenen Client:
    // dessen Handler baut unmittelbar die Spielfigur. Das Ticket selbst
    // traegt bewusst nur die Identitaet und keine veraenderlichen Werte.
    let saved: SavedPlayer | undefined;
    if (!peer.nurEditor) {
      saved = this.ermittleGespeichertenStand(peer);
      const ausKonto = this.kontenDb.charakterZuSpielerId(peer.spielerId);
      peer.klasse = ausKonto?.klasse || saved?.klasse || '';
      peer.starterSetGranted = saved?.starterSetGranted ?? '';
      peer.figur = saved?.figur && istFigur(saved.figur)
        ? saved.figur : ausKonto && istFigur(ausKonto.figur) ? ausKonto.figur : FIGUR_VORGABE;
      peer.frisur = saved?.frisur && istFrisur(saved.frisur)
        ? saved.frisur : ausKonto && istFrisur(ausKonto.frisur) ? ausKonto.frisur : FRISUR_VORGABE;
      peer.haarfarbe = saved?.haarfarbe && istHaarfarbe(saved.haarfarbe)
        ? saved.haarfarbe : ausKonto && istHaarfarbe(ausKonto.haarfarbe)
          ? ausKonto.haarfarbe : HAARFARBE_VORGABE;
      peer.augenfarbe = saved?.augenfarbe && istAugenfarbe(saved.augenfarbe)
        ? saved.augenfarbe : ausKonto && istAugenfarbe(ausKonto.augenfarbe)
          ? ausKonto.augenfarbe : AUGENFARBE_VORGABE;
      peer.ruestung = typeof saved?.ruestung === 'string'
        ? saved.ruestung : ausKonto ? `${ausKonto.ober}|${ausKonto.beine}` : '|';
      const [ober = '', beine = ''] = peer.ruestung.split('|');
      peer.sendPacketWith(PacketType.EigenesAussehen, (w) => {
        w.writeString(peer.figur);
        w.writeString(peer.frisur);
        w.writeString(peer.haarfarbe);
        w.writeString(peer.augenfarbe);
        w.writeString(ober);
        w.writeString(beine);
      });
    }
    // D6: Weltinfo direkt nach dem eigenen Aussehen — der Client baut
    // daraus seinen GeoManager und tauscht das Platzhalterterrain (D3).
    //
    // ── Warum das VOR dem Editor-Zweig steht (E8) ──────────────────
    // Bis E8 stand es dahinter, und damit bekam eine Editor-Verbindung
    // NIE eine ServerConfig. Das war folgenlos, solange das Paket bloss
    // Weltdaten trug — der Editor baut keine Welt. Mit dem siebten
    // Flagbit trägt es aber die einzige Auskunft, die der Editor beim
    // Anmelden über die `server.yml` bekommen kann, und ohne sie wüsste
    // das Formular „Neuer Saal" nie, ob es dastehen darf. Nach unten
    // gewandert ist deshalb nur der Zweig; alles Weltbezogene
    // (Wettervorgabe, Weltdokument, Charakter-ZDO) bleibt darunter und
    // erreicht einen Editor-Peer weiterhin nicht.
    peer.sendPacketWith(PacketType.ServerConfig, (w) => {
      w.writeString(this.config.worldName);
      w.writeString(this.config.worldSeed);
      w.writeInt32(this.config.worldGenVersion);
      w.writeUInt8(
        serverConfigFlags({
          blendSmoothStep: this.config.worldBlendSmoothStep,
          bilinearHeight: this.config.worldBilinearHeight,
          ashlandsModernNoise: this.config.worldAshlandsModernNoise,
          riverAffectsOcean: this.config.worldRiverAffectsOcean,
          disableDistantRivers: this.config.worldDisableDistantRivers,
          layoutMode: this.config.worldMode === 'layout',
          // BEIDE Tore, nicht nur der Schalter: Ein Nicht-Admin bekäme
          // sonst ein Formular, das bei jedem Klick absagt. Geprüft wird
          // trotzdem noch einmal in `baueModul` — dieses Bit ist eine
          // Auskunft, kein Recht.
          moduleBuild: this.config.dungeonsModulbau && peer.isAdmin,
        })
      );
    });

    // Editor-Verbindungen betreten die Welt NICHT.
    //
    // Gemessen am 28.08.2026, bevor es diesen Zweig gab: Jeder Klick auf
    // „Speichern" im Karteneditor legte einen Charakter „Editor" an —
    // Charakter-ZDO, Startausruestung, 12,3 KB Terraforming, ein
    // 15k-ZDO-Scan fuers Baubudget — und meldete ihn eine Sekunde spaeter
    // wieder ab. Ein Phantom-Wikinger je Speichervorgang, sichtbar fuer
    // alle anderen.
    //
    // Was so ein Peer noch kann, steht unveraendert: Er ist
    // authentifiziert, `isAdmin` gilt wie fuer jeden anderen, und die
    // Editor-Pakete gehen ihren Weg. Er bekommt nur nichts von der Welt —
    // und die Welt nichts von ihm.
    if (peer.nurEditor) {
      console.log(`[WoV] Editor-Verbindung "${peer.name}" (betritt die Welt nicht)`);
      return;
    }
    // Wettervorgabe direkt hinterher, VOR dem Weltdokument: Der Client
    // baut daraus seine Beleuchtung, bevor die erste Zone steht — sonst
    // sähe man beim Anmelden kurz das gewürfelte Wetter und erst danach
    // das eingestellte.
    peer.sendPacketWith(PacketType.WeltWetter, (w) => {
      w.writeString(this.config.wetterVorgabe.umgebung);
      w.writeFloat32(this.config.wetterVorgabe.nebelDichte);
      // Der `look:`-Block reist mit: dieselbe Reise (einmal beim
      // Anmelden, vor dem Weltdokument), derselbe Grund. Angehaengt und
      // nicht davorgestellt, damit ein Client ohne Look-Kenntnis die
      // beiden alten Felder unveraendert liest — der Leser drueben
      // fragt `remaining > 0`, bevor er zugreift.
      w.writeString(JSON.stringify(this.config.wetterVorgabe.look ?? {}));
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
    // Nie in einer Instanz wieder einsteigen. Sie überlebt keinen
    // Neustart, und ihre Koordinaten bedeuten in der Oberwelt nichts.
    // `onPeerQuit` legt die Rückkehrposition ab; das hier ist der Gurt für
    // Abstürze — und für Spielstände aus der Zeit des Koordinatenbandes,
    // in denen noch Positionen ab x = 100.000 stehen können. Genau dafür
    // bleibt `isInDungeonBand`: als Lesehilfe für alte Daten, nicht mehr
    // als Weltgrenze.
    const savedPos =
      saved && !isInDungeonBand(saved.position.x) ? { ...saved.position } : null;
    const spawnPos: Vector3 = savedPos ?? this.weltSpawn();
    peer.flying = saved?.flying ?? false;
    peer.spawnPoint = saved?.spawnPoint ? { ...saved.spawnPoint } : null;
    peer.spawnBettId = peer.spawnPoint ? (saved?.spawnBettId ?? '') : '';
    peer.spawnBettBesitzer = peer.spawnPoint && typeof saved?.spawnBettBesitzer === 'string' ? saved.spawnBettBesitzer : null;

    const characterZDO = this.zdosVon(peer).createZDO(
      playerPrefab?.hash ?? 0,
      spawnPos,
      { x: 0, y: 0, z: 0, w: 1 }
    );
    characterZDO.setOwner(new ZDOID(peer.userId, 0));
    peer.characterID = characterZDO.zdoid;
    peer.position = spawnPos;

    // Gewaehlte Figur aus dem Spielstand wiederherstellen und an das
    // Charakter-ZDO haengen. Ueber den ZDO-Member sehen ALLE anderen
    // Spieler dieselbe Figur — ohne ihn saehe jeder nur sich selbst
    // richtig. Der Client schickt seine Wahl direkt nach dem Anmelden
    // per SetFigur; bis dahin gilt der gespeicherte Stand.
    // Erstanmeldung eines Charakters: Es gibt noch keinen Spielstand, aber
    // sehr wohl eine getroffene Wahl -- sie steht in der Kontendatenbank,
    // seit die Charaktererstellung auf world-of-vikings.com dorthin
    // schreibt. Ohne diese Zeile bekaeme ein frisch angelegter Recke die
    // Vorgabe und nicht das, was der Spieler ausgesucht hat.
    //
    // Reihenfolge: Spielstand SCHLAEGT Konto. Das Aussehen laesst sich im
    // Spiel aendern (Charakterfenster, sendAussehen), und dann ist der
    // Spielstand die lebende Wahrheit -- die Kontendatenbank haelt nur
    // den Anlegestand.
    characterZDO.setString(FIGUR_MEMBER, peer.figur);

    // Aussehen aus dem Spielstand — gleiche Begruendung wie bei der Figur:
    // Ueber die ZDO-Member sehen ALLE anderen Spieler dieselbe Frisur.
    characterZDO.setString(FRISUR_MEMBER, peer.frisur);
    characterZDO.setString(HAARFARBE_MEMBER, peer.haarfarbe);
    characterZDO.setString(AUGENFARBE_MEMBER, peer.augenfarbe);
    characterZDO.setString(RUESTUNG_MEMBER, peer.ruestung);

    // Server-Inventar (Review-Punkt 8): aus dem Save wiederherstellen,
    // Neulinge bekommen die Startausrüstung SERVERSEITIG (der Client
    // startet mit leerem Inventar und lebt vom InventorySync).
    if (saved?.inventar) {
      peer.inventar.load(saved.inventar);
    } else {
      const START: Array<[string, number]> = [
        ['Hammer', 1], ['AxeFlint', 1], ['Hoe', 1], ['PickaxeAntler', 1],
        ['Cultivator', 1], ['Wood', 12], ['Stone', 30],
        // Das Nordschwert, damit der Schwerthieb des Wikingers von Anfang
        // an eine Klinge hat (10.09.2026).
        ['SwordNorth', 1],
        // Class armor is delivered separately after restoring the inventory.
      ];
      for (const [name, menge] of START) {
        const def = findItem(name);
        if (def) peer.inventar.addItem(def, menge);
      }
    }
    peer.starterSetGranted = grantStarterSet(peer.inventar, peer.klasse, peer.figur, peer.starterSetGranted);
    this.inventarSync(peer);
    // Piece-Budget: eigene Bauten einmalig zählen (15k-ZDO-Scan, nur Login).
    const meineId = peer.userId.toString();
    peer.bautenAnzahl = this.zdosVon(peer)
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
    // Gegenstueck zum Zweig in onPeerAuthenticated — und hier waere das
    // Vergessen TEUER gewesen: `savedPlayers` ist ueber die spielerId
    // geschluesselt, und eine Editor-Verbindung mit Mikes Sitzungstoken
    // traegt Mikes spielerId. Ohne diese Zeilen ueberschriebe jedes
    // Speichern im Karteneditor seinen gemerkten Standort, sein Fliegen
    // und seinen Spawnpunkt mit dem Nichts einer Verbindung, die nie in
    // der Welt war. Kein Fehler, keine Meldung — man stuende beim
    // naechsten Anmelden woanders.
    if (peer.nurEditor) return;

    // Phase G: quitting inside a dungeon counts as leaving it — the saved
    // position is the overworld return point, never the instance band.
    if (peer.dungeonId) {
      this.dungeons.getInstance(peer.dungeonId)?.players.delete(peer.name);
      if (peer.dungeonReturn) peer.position = { ...peer.dungeonReturn };
      peer.dungeonId = null;
    }

    // G1: keep the last-known state — a same-session relog respawns here,
    // and the next world save writes it to the players[] section.
    // F3 (Security-Review): geschluesselt ueber die stabile spielerId,
    // nicht mehr ueber den Namen — siehe Kopfkommentar von savedPlayers.
    this.savedPlayers.set(peer.spielerId, {
      name: peer.name,
      spielerId: peer.spielerId,
      position: { ...peer.position },
      flying: peer.flying,
      spawnPoint: peer.spawnPoint ?? undefined,
      spawnBettId: peer.spawnBettId || undefined,
      spawnBettBesitzer: peer.spawnBettBesitzer ?? undefined,
      figur: peer.figur,
      frisur: peer.frisur,
      haarfarbe: peer.haarfarbe,
      augenfarbe: peer.augenfarbe,
      klasse: peer.klasse,
      starterSetGranted: peer.starterSetGranted,
      ruestung: peer.ruestung,
      inventar: peer.inventar.serialize(),
    });
    // Destroy player character ZDO
    if (!peer.characterID.isNone()) {
      this.zdosVon(peer).destroyZDO(peer.characterID);
    }
    console.log(`[WoV] Player "${peer.name}" left`);
  }

  /**
   * F3 (Security-Review): den gespeicherten Zustand fuer einen frisch
   * authentifizierten Peer ermitteln — und falls noetig, einen alten,
   * NAMENTLICH abgelegten Datensatz auf die stabile spielerId migrieren.
   *
   * Ablauf:
   *  1. Direkter Treffer unter der spielerId (schneller Normalfall:
   *     derselbe Serverlauf, gueltiges Token — die meiste Zeit).
   *  2. Kein Treffer → Suche nach einem Datensatz mit demselben
   *     ANZEIGENAMEN (das ist der Fall nach jedem Serverneustart, weil
   *     das SessionToken absichtlich nicht ueberlebt, siehe Konstruktor —
   *     UND der Fall bei geleertem localStorage/altem Client ohne Token
   *     innerhalb eines laufenden Serverprozesses). Gefunden → auf die
   *     NEUE spielerId umschluesseln (alten Namens-Schluessel entfernen,
   *     sonst waechst savedPlayers bei jedem Neustart um einen weiteren
   *     Eintrag PRO SPIELER, statt konstant zu bleiben).
   *
   * Bewusste Grenze: exakter Namensabgleich, kein Identitaetsnachweis.
   * Wer zufaellig (oder absichtlich) denselben Anzeigenamen waehlt wie
   * ein zuvor gesehener, gerade abwesender Spieler, erbt dessen
   * Position/Inventar — GENAU dieselbe Grenze wie im bisherigen System
   * (dort war der Name selbst der einzige Schluessel, IMMER, ohne jede
   * Pruefung). Sicherheitsrelevant ist das NICHT: ZDO-Besitz (wer welche
   * Bauten abreissen, Betten und Truhen benutzen darf) haengt
   * ausschliesslich an der frisch bzw. aus einem gueltigen Token
   * abgeleiteten altlastUserId, nie an diesem Namensabgleich — dieser Pfad
   * ist reine Komfort-Wiederherstellung von Position/Inventar, keine
   * Berechtigung.
   *
   * GRENZE DIESER TRENNUNG: Position und Inventar kommen ueber den Namen
   * zurueck, der Besitz nicht. Die altlastUserId ist nur stabil, solange
   * der Client sein Token wieder vorlegt (bzw. fuer Konten, die sie in der
   * Kontendatenbank tragen). Ein Gast ohne Token bekommt beim naechsten
   * Verbinden eine frisch gewuerfelte — seine Truhen, Betten und Bauten
   * melden dann „gehoert einem anderen Spieler", obwohl er unter demselben
   * Namen wieder da ist. Ob Gaeste dauerhaften Besitz haben sollen, ist
   * offen (Produktentscheidung), nicht hier geloest.
   */
  private ermittleGespeichertenStand(peer: Peer): SavedPlayer | undefined {
    const direkt = this.savedPlayers.get(peer.spielerId);
    if (direkt) return direkt;

    // Werte durchsuchen statt per Schluessel nachzuschlagen: ein Alt-
    // datensatz kann unter dem NAMEN liegen (aus einem Save vor diesem
    // Umbau — siehe loadWorld), aber genauso unter einer FRUEHEREN
    // spielerId desselben Spielers aus DIESEM Serverlauf (onPeerQuit
    // schluesselt seit F3 immer ueber spielerId, nie mehr ueber den
    // Namen — ein reiner Schluessel-Lookup mit peer.name wuerde diesen
    // zweiten, im Alltag haeufigeren Fall nie finden).
    for (const [schluessel, kandidat] of this.savedPlayers) {
      if (kandidat.name !== peer.name) continue;
      this.savedPlayers.delete(schluessel);
      const migriert: SavedPlayer = { ...kandidat, spielerId: peer.spielerId };
      this.savedPlayers.set(peer.spielerId, migriert);
      return migriert;
    }
    return undefined;
  }

  /**
   * S6 (Security-Review): Name → stabile spielerId auflösen, fuer den
   * `admin`-Befehl. Erst unter den ONLINE-Peers gesucht (aktuellster,
   * zuverlaessigster Stand), dann in savedPlayers (auch fuer gerade
   * abwesende Spieler, die schon einmal verbunden waren).
   */
  private spielerIdFuerName(name: string): SpielerId | undefined {
    const online = this.net.getPeers().find((p) => p.name === name);
    if (online) return online.spielerId;
    for (const eintrag of this.savedPlayers.values()) {
      if (eintrag.name === name && eintrag.spielerId && istSpielerId(eintrag.spielerId)) {
        return eintrag.spielerId;
      }
    }
    return undefined;
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
      case PacketType.Parry:
        this.handleParry(peer);
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
      case PacketType.ContainerAction:
        this.handleContainerAction(peer, reader);
        break;
      case PacketType.SetFigur:
        this.handleSetFigur(peer, reader);
        break;
      case PacketType.SetAussehen:
        this.handleSetAussehen(peer, reader);
        break;
      case PacketType.DungeonEditRequest:
        this.handleDungeonEditRequest(peer, reader);
        break;
      case PacketType.DungeonEditSave:
        this.handleDungeonEditSave(peer, reader);
        break;
      case PacketType.DungeonModulBau:
        this.handleDungeonModulBau(peer, reader);
        break;
      case PacketType.DungeonModulLoeschen:
        this.handleDungeonModulLoeschen(peer, reader);
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
    // AP13: Beide Formate reisen als JSON durch DASSELBE Paket. Der Editor
    // erkennt an `version >= 10`, welches er vor sich hat — dieselbe Weiche
    // wie im Sanitizer, und deshalb braucht es kein zweites Paket.
    // AP13: both formats travel as JSON through THE SAME packet.
    const doc2 = id ? this.dungeons.getDokument2(id) : undefined;
    if (doc2) return sendData(true, doc2.id, JSON.stringify(doc2));
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
    // E6: Die Registry-Prüfsumme reist HINTER dem Dokument — ein Feld, das
    // ein Client von vor E6 gar nicht schickt. `isValidOffset(1)` fragt
    // deshalb erst, ob überhaupt noch Bytes da sind (dasselbe Muster wie
    // beim nachträglich angehängten `seq` in PlayerState); ein blindes
    // `readString()` liefe über das Ende des Puffers und beendete die
    // Verbindung mit einer RangeError-Meldung, die nichts erklärt.
    const gesendeteSumme = reader.isValidOffset(1) ? reader.readString() : '';
    const sendData = (ok: boolean, message: string, docJson = '') => {
      peer.sendPacketWith(PacketType.DungeonEditData, (w) => {
        w.writeBool(ok);
        w.writeString(message);
        w.writeString(docJson);
      });
    };
    if (!peer.isAdmin) return sendData(false, 'Keine Berechtigung');
    if (json.length > 2_000_000) return sendData(false, 'Dokument zu groß (max 2 MB)');

    // ── E6: Kennen beide Seiten dieselben Module? ──────────────────────
    //
    // Diese Frage MUSS vor `sanitizeDungeonDocument` stehen, denn dieser
    // verwirft unbekannte Räume STILL (`shared/src/dungeons.ts`, Kopf:
    // „Unknown rooms are dropped"). Für eine Datei von der Platte ist das
    // richtig; für ein Dokument aus dem Editor ist es der teuerste aller
    // Fehler — der Nutzer bekommt ein Häkchen und ein Grab mit einem
    // Loch, und das Loch fällt erst beim Betreten auf.
    //
    // Ein FEHLENDES Feld ist kein Sonderfall, sondern die wörtliche
    // Wahrheit über den Absender: Ein Bündel von vor E6 registriert keine
    // generierten Module, seine Registry IST leer. Kennt der Server auch
    // keine, sind sich beide einig und das Speichern geht durch; kennt er
    // welche, ist die Seite im Browser älter als er — und genau dann darf
    // sie nicht speichern.
    const eigeneSumme = registryChecksum();
    const clientSumme = gesendeteSumme || registryPruefsumme([]);
    if (clientSumme !== eigeneSumme) {
      console.warn(
        `[Dungeon] '${peer.name}' hat eine veraltete Modulregistry ` +
          `(Client ${clientSumme}, Server ${eigeneSumme}) — Speichern abgelehnt.`
      );
      return sendData(
        false,
        `Registry veraltet — Seite neu laden (Client ${clientSumme}, Server ${eigeneSumme})`
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return sendData(false, 'Ungültiges JSON');
    }
    // Die Weiche, ein zweites Mal (AP13). Sie steht hier und nicht in
    // `upsertDocument`, weil die beiden Rückgabetypen verschieden sind —
    // und weil ein 2.0-Dokument im Alt-Sanitizer als „ungültig" gemeldet
    // würde statt als „falscher Weg".
    // The switch, a second time.
    if (dungeon2.istDokument2(raw)) {
      const erg2 = this.dungeons.upsertDokument2(raw);
      if (!erg2) return sendData(false, 'Dokument 2.0 abgelehnt (Thema/ID/Seeds ungültig)');
      const { doc: d2, instanzErhalten: erhalten2 } = erg2;
      if (peer.dungeonId === d2.id && !erhalten2) this.enterDungeon(peer, d2.id);
      sendData(
        true,
        `Gespeichert: ${d2.id} (2.0, Thema ${d2.thema}, Prüfsumme ${d2.pruefsumme})`,
        JSON.stringify(d2)
      );
      console.log(
        `[Dungeon] '${peer.name}' saved 2.0 document '${d2.id}' ` +
          `(${d2.thema}, ${d2.pruefsumme}${erhalten2 ? ', instance kept' : ''})`
      );
      return;
    }
    const ergebnis = this.dungeons.upsertDocument(raw);
    if (!ergebnis) return sendData(false, 'Dokument abgelehnt (Basis/ID/Räume ungültig)');
    const { doc, instanzErhalten } = ergebnis;

    // Zurückteleportieren NUR, wenn die Instanz abgerissen wurde. Hat sich
    // bloss die Deko geändert, steht sie noch — und der Spieler soll dort
    // bleiben, wo er gerade eine Fackel gesetzt hat, statt am Eingang
    // aufzuwachen. Genau das machte das Setzen vorher unbenutzbar.
    if (peer.dungeonId === doc.id && !instanzErhalten) {
      this.enterDungeon(peer, doc.id);
    }
    sendData(
      true,
      `Gespeichert: ${doc.id} (${doc.layout.rooms.length} Räume, ${doc.layout.props.length} Deko)`,
      JSON.stringify(doc)
    );
    console.log(
      `[Dungeon] '${peer.name}' saved document '${doc.id}' ` +
        `(${doc.layout.rooms.length} rooms, ${doc.layout.props.length} props` +
        `${instanzErhalten ? ', instance kept' : ''})`
    );
  }

  /**
   * Editor: einen Saal bauen (E5). Der Client schickt VIER ZAHLEN —
   * Breite, Tiefe, Pfeilerraster, Gewicht —, sonst nichts. Namen,
   * Pfade und jede Klemme liegen in `ModuleBuild.baueModul`; dieser
   * Handler übersetzt nur zwischen Paket und Funktion.
   *
   * Warum hier KEINE zweite Prüfung steht: Zwei Klemmenlisten für
   * dieselbe Sache laufen auseinander, sobald eine von beiden angefasst
   * wird — und die im Socket-Handler wäre die, die kein Test fährt.
   */
  private handleDungeonModulBau(peer: Peer, reader: Reader): void {
    const cellsX = reader.readInt32();
    const cellsZ = reader.readInt32();
    const raster = reader.readInt32();
    const weight = reader.readFloat32();

    const antwort = baueModul(
      {
        istAdmin: peer.isAdmin,
        modulbauErlaubt: this.config.dungeonsModulbau,
        verzeichnis: this.config.generiertDir,
      },
      { cellsX, cellsZ, raster, weight }
    );

    peer.sendPacketWith(PacketType.DungeonModulBauErgebnis, (w) => {
      w.writeBool(antwort.ok);
      w.writeString(
        antwort.ok
          ? `Gebaut: ${antwort.ergebnis.name} — ${antwort.ergebnis.tris} Dreiecke, ` +
              `${antwort.ergebnis.sizeX} x ${antwort.ergebnis.sizeZ} m`
          : antwort.meldung
      );
      // Die Zahlen als JSON und nicht als Einzelfelder: Das Formular
      // zeigt sie an, und ein zusaetzliches Feld spaeter verschoebe
      // sonst den Aufbau eines Pakets, das ein offener Tab noch kennt.
      w.writeString(antwort.ok ? JSON.stringify(antwort.ergebnis) : '');
    });

    console.log(
      antwort.ok
        ? `[Dungeon] '${peer.name}' built module '${antwort.ergebnis.name}' ` +
            `(${antwort.ergebnis.tris} tris, registry ${antwort.ergebnis.pruefsumme})`
        : `[Dungeon] '${peer.name}' — Modulbau abgelehnt: ${antwort.meldung}`
    );
  }


  /**
   * Wo die Dungeon-Dokumente ALLER Welten dieser Maschine liegen
   * (`server/data/dungeons`) — nicht die einer einzelnen.
   *
   * Der Unterschied ist der ganze Grund für diese Methode. Der
   * DungeonManager bekommt den Unterordner SEINER Welt; der Löschweg (E9)
   * muss eine Ebene höher fragen, weil GLB-Datei und Registry sich alle
   * Welten teilen. Ein Server auf `dev`, der nur `dev` durchsähe, löschte
   * ein Modell weg, das `world` benutzt — und erführe davon nie.
   */
  private dungeonsWurzel(): string {
    return resolve(this.config.worldsDir, '..', 'dungeons');
  }

  /**
   * Editor: einen gebauten Saal wieder entfernen (E9).
   *
   * Wie beim Bauen steht hier KEINE eigene Prüfung: Tore, Namensform,
   * Bestandsfrage und Reihenfolge des Entfernens liegen vollständig in
   * `ModuleBuild.deleteModule`. Der Handler übersetzt zwischen Paket und
   * Funktion und reicht die Dokumentwurzel herein — das Einzige, was der
   * Bauweg nicht schon kennt.
   */
  private handleDungeonModulLoeschen(peer: Peer, reader: Reader): void {
    const name = reader.readString();

    const antwort = deleteModule(
      {
        istAdmin: peer.isAdmin,
        modulbauErlaubt: this.config.dungeonsModulbau,
        verzeichnis: this.config.generiertDir,
        dungeonsWurzel: this.dungeonsWurzel(),
      },
      name
    );

    peer.sendPacketWith(PacketType.DungeonModulLoeschErgebnis, (w) => {
      w.writeBool(antwort.ok);
      w.writeString(
        antwort.ok
          ? `Entfernt: ${antwort.ergebnis.name}` +
              `${antwort.ergebnis.dateiEntfernt ? '' : ' (die GLB-Datei fehlte bereits)'} — ` +
              `${antwort.ergebnis.verbleibend} Modul(e) verbleiben`
          : antwort.meldung
      );
      // Die Zahlen als JSON, aus demselben Grund wie beim Bauergebnis: ein
      // spaeteres Feld verschoebe sonst den Aufbau eines Pakets, das ein
      // offener Tab noch kennt.
      w.writeString(antwort.ok ? JSON.stringify(antwort.ergebnis) : '');
    });

    console.log(
      antwort.ok
        ? `[Dungeon] '${peer.name}' deleted module '${antwort.ergebnis.name}' ` +
            `(registry ${antwort.ergebnis.pruefsumme}, ${antwort.ergebnis.verbleibend} left)`
        : `[Dungeon] '${peer.name}' — Modul löschen abgelehnt: ${antwort.meldung}`
    );
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
   * Client requested a new time of day (angeboten auf dem Verbindungsbildschirm,
   * client/src/main.ts — dort für JEDEN Spieler, nicht nur Admins). Ändert
   * die Zeit für ALLE Peers, deshalb wie die anderen Admin-Pfade gegated
   * (Zeile 1142/1164 DungeonEdit*, Zeile 1200 AdminCommand). Anders als bei
   * denen gibt es hier noch kein eigenes Antwortpaket — der Client kennt
   * InteractResult bereits (nur message wird angezeigt, s. main.ts), das
   * reicht für die Ablehnung, ohne ein neues Paket einzuführen.
   *
   * Kein Sonderfall beim ERSTEN Verbinden: Der Client schickt dieses Paket
   * nur, wenn auf dem Verbindungsbildschirm aktiv eine Uhrzeit gewählt wurde
   * (main.ts `zeitWunsch`) — bei "Serverzeit übernehmen" (Default) bleibt es
   * ganz aus. Die Sperre kann den normalen Verbindungsaufbau also nicht
   * brechen.
   */
  private handleSetTimeOfDay(peer: Peer, reader: Reader): void {
    let timeOfDay = reader.readFloat64();
    if (!Number.isFinite(timeOfDay)) return;

    if (!peer.isAdmin) {
      console.log(`[Admin] "${peer.name}" — SetTimeOfDay abgelehnt: keine Berechtigung`);
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(false);
        w.writeString('Keine Berechtigung, die Weltzeit zu ändern');
        w.writeString('');
        w.writeInt32(0);
      });
      return;
    }

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
    // lookPitch/jumping are read for protocol completeness but not used
    // server-side yet (jump physics — later).

    peer.lastInputSeq = seq;

    // Server-authoritative movement
    const now = Date.now();
    // `lookYaw` wurde bis heute gelesen und weggeworfen — genau daran
    // hing der Nahkampf-Kegel in der Luft (s. handleAttack). Der 20-Hz-
    // Eingabestrom ist die dichteste Blickmeldung, die es gibt; sie
    // fuehrt `peer.blickYaw`, gegen den der Kegel dann rechnet.
    this.fuehreBlickNach(peer, lookYaw, now);
    // real elapsed time between input packets (fall speed needs wall time)
    const deltaSec = peer.lastInputTime > 0 ? Math.min((now - peer.lastInputTime) / 1000, 0.5) : 1 / 30;
    peer.lastInputTime = now;

    // Ausdauer und Vitals-Sync gelten in JEDEM Bewegungszweig. Der Sync
    // stand früher nur im Oberwelt-Zweig — im Dungeon-Band bekam der Client
    // dadurch nie ein frisches PlayerState, seine Reconciliation hielt an
    // der letzten OBERWELT-Position fest und zog den Spieler immer wieder
    // neben den Eingang zurück (Nutzerbericht 2026-08-03).
    // Die Regel selbst steht in `shared/src/bewegung/ausdauer.ts` — dieselbe
    // Funktion rechnet der Client je Bild mit. Die Zahlen und die Reihenfolge
    // sind unveraendert; hier bleibt nur die Frage stehen, ob sie ueberhaupt
    // gilt (im Admin-Flug gilt sie nicht).
    const bewegt = moveX !== 0 || moveZ !== 0;
    const aus = ausdauerSchritt(
      { wert: peer.stamina, zuletztVerbraucht: peer.staminaZuletztVerbraucht },
      { rennWunsch: !peer.flying && running, bewegt, dt: deltaSec, jetzt: now }
    );
    const rennt = !peer.flying && aus.rennt;
    if (!peer.flying) {
      peer.stamina = aus.wert;
      peer.staminaZuletztVerbraucht = aus.zuletztVerbraucht;
    }
    // Der Versand steht NICHT hier, sondern am Ende dieser Methode —
    // s. den Kommentar dort. Hier laeuft nur die Uhr weiter.
    peer.staminaSyncAkku = (peer.staminaSyncAkku ?? 0) + deltaSec;

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
    } else if (peer.worldId !== HAUPTWELT_ID) {
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
      // Oberwelt: feste Schritte gegen Gelände UND Hindernisse
      // (server/src/world/Spielerbewegung.ts). Tempi, Schwerkraft und
      // Stufenregel stehen in shared/src/bewegung/masse.ts — dieselbe
      // Quelle, aus der auch der Client-Controller lesen kann.
      newPos = this.spielerbewegung.schritt(peer, moveX, moveZ, rennt, deltaSec);
    }

    peer.position = newPos;

    // Update character ZDO position
    const charZDO = this.zdosVon(peer).getZDO(peer.characterID);
    if (charZDO) {
      this.zdosVon(peer).updateZDOZone(charZDO, newPos);
      charZDO.revision.reviseData();
      charZDO.dirty = true;
    }

    /*
      Vitals- und Positionsmeldung — NACH der Bewegung, nicht davor.
      ------------------------------------------------------------------
      Bis heute stand dieser Aufruf oben, direkt hinter der Ausdauer. Das
      Paket meldete damit `peer.position` aus dem VORIGEN Takt, trug aber
      `peer.lastInputSeq` aus dem AKTUELLEN — die beiden Felder gehörten
      nicht zusammen. Der Client, der seine eigene Position zu genau
      dieser Sequenznummer nachschlägt (client/src/net/Positionsverlauf.ts),
      verglich dann zwei verschiedene Zeitpunkte und maß einen Versatz von
      einem ganzen Bewegungsschritt, den es nicht gab. Hier unten gehört
      der gemeldete `seq` zur gemeldeten Stelle.

      TAKT: 0,1 s statt 0,25 s.
      Bandbreite: die Nutzlast ist 24 Byte (health f32, stamina f32,
      Vector3 3×f32, seq i32), mit Pakettyp-Byte und WebSocket-Rahmen
      (2 Byte, unmaskiert, Nutzlast < 126) rund 27 Byte auf der Leitung.
      4 Hz waren 108 B/s je Spieler, 10 Hz sind 270 B/s — ein Zuwachs von
      162 B/s ≈ 1,3 kbit/s je Spieler. Bei 100 gleichzeitigen Spielern
      sind das 27 kB/s ≈ 216 kbit/s ausgehend für den ganzen Server; das
      ZDO-Streaming derselben Spieler bewegt ein Vielfaches davon. Der
      Takt ist bewusst nicht an den Eingabetakt (20 Hz) gekoppelt: 10 Hz
      halten das Alter der Meldung unter der Zeitkonstante des weichen
      Nachziehens (τ 0,4 s), mehr bringt für den Abgleich nichts.

      Andere Aufrufer von sendPlayerState (Schaden, Respawn, Essen …)
      bleiben unberührt — sie melden ohnehin außer der Reihe.
    */
    if (peer.staminaSyncAkku >= 0.1) {
      peer.staminaSyncAkku = 0;
      this.sendPlayerState(peer);
    }
  }

  private handleChatMessage(peer: Peer, reader: Reader): void {
    const chatType = reader.readInt32();
    // Serverseitige Längengrenze (F14) — eine rein clientseitige Grenze
    // hält einen manipulierten/zweiten Client nie auf. kuerzeChatText
    // statt eines nackten .slice(), damit der Test dieselbe Funktion
    // ruft wie hier.
    const text = kuerzeChatText(reader.readString());
    // Frequenzlimit (vormals hier als fester 300-ms-Cooldown, Review-Punkt
    // 11): A4 (Security-Review) ersetzt das durch die Token-Bucket-
    // Drosselung in NetManager.handlePacket, VOR diesem Handler — ein zu
    // schnelles ChatMessage-Paket kommt hier gar nicht mehr an.

    // Broadcast — aber nur an Empfänger in Reichweite (F14). Herleitung
    // der drei Reichweiten (Whisper/Normal/Shout) im Kopfkommentar von
    // ChatReichweite.ts. Der Absender ist über waehleChatEmpfaenger IMMER
    // dabei, auch ohne Empfänger in der Nähe — sonst wirkt der Chat für
    // ihn kaputt.
    const writer = new Writer();
    writer.writeString(peer.userId.toString());
    writer.writeString(peer.name);
    writer.writeInt32(chatType);
    writer.writeString(text);
    writer.writeVector3(peer.position);
    const payload = writer.toBuffer();

    const senderId = peer.userId.toString();
    const kandidaten = this.net
      .getPeers()
      .map((p) => ({ id: p.userId.toString(), worldId: p.worldId, position: p.position, peer: p }));
    for (const empfaenger of waehleChatEmpfaenger(kandidaten, senderId, peer.worldId, peer.position, chatType)) {
      empfaenger.peer.sendPacket(PacketType.ChatMessage, payload);
    }

    console.log(`[Chat] ${peer.name}: ${text}`);
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

    const zdo = this.zdosVon(peer).createZDO(prefabHash, pos, rot);
    zdo.setInt('spieler', 1);
    // Besitzer festhalten — nur der Erbauer darf abreißen (Review-Punkt 4).
    zdo.setString('besitzer', peer.userId.toString());
    zdo.revision.reviseData();
    zdo.dirty = true;
    antwort(true, `${def.name} gebaut`);
  }

  /**
   * Darf `peer` dieses Bauteil benutzen (Bett, Truhe, Abriss)? Ein ZDO mit
   * gesetztem `besitzer` gehoert diesem Spieler und nur ihm; ohne Besitzer
   * (Weltcontainer, Grabtruhe, Altbestand) steht es allen offen. Die EINE
   * Stelle dieser Regel: Soll jeder in jede Truhe duerfen, aendert sich nur
   * diese Funktion.
   *
   * GRENZE: `besitzer` ist die `userId` (altlastUserId) des Erbauers. Sie ist
   * stabil fuer Konten und fuer Clients, die ihr Session-Token wieder
   * vorlegen — nicht fuer einen Gast ohne Token: er bekommt bei jedem neuen
   * Verbinden eine frische und ist danach fuer seine eigenen Bauten ein
   * Fremder (s. `ermittleGespeichertenStand`). Ob Gaeste dauerhaften Besitz
   * haben sollen, ist eine offene Produktentscheidung.
   */
  private darfBenutzen(zdo: ZDO, peer: Peer): boolean {
    const besitzer = zdo.getString('besitzer');
    return !besitzer || besitzer === peer.userId.toString();
  }

  private static readonly FREMDER_BESITZ_MELDUNG = 'Das gehört einem anderen Spieler';

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
    for (const zdo of this.zdosVon(peer).getZDOsInRadius(pos, 4)) {
      if (zdo.getInt('spieler') !== 1) continue;
      // Nur eigene Bauten (Altbestand ohne 'besitzer' bleibt abreißbar,
      // sonst wären die vor diesem Patch gebauten Stücke für immer fest).
      if (!this.darfBenutzen(zdo, peer)) continue;
      const d = (zdo.position.x - pos.x) ** 2 + (zdo.position.z - pos.z) ** 2;
      if (d < best) {
        best = d;
        ziel = zdo;
      }
    }
    if (!ziel) return;
    const def = this.prefabs.getByHash(ziel.prefabHash);
    this.zdosVon(peer).destroyZDO(ziel.zdoid);
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

    // Gegraben wird nur in der Hauptwelt. Die Heightmap unten ist die der
    // Hauptwelt, und der Client wendet jede TerrainOpSync auf SEINE Hauptwelt-
    // Heightmap an; eine Instanz hat keine eigene, die er bekaeme. Ohne diese
    // Sperre senkte ein Spieler im Dungeon den Boden der Oberwelt.
    if (peer.worldId !== HAUPTWELT_ID) {
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(false);
        w.writeString('Im Dungeon kann man nicht graben');
        w.writeString('');
        w.writeInt32(0);
      });
      return;
    }

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
    this.broadcastTerrainOps([{ pos, settingsJson }], HAUPTWELT_ID);
    // Glättung reicht weiter als die Kernfläche — Rand großzügig mitnehmen.
    const smooth = Number(settings.smoothRadius ?? 0);
    this.objekteAufBodenNachsetzen(pos, Math.max(r, Number.isFinite(smooth) ? smooth : 0) + 1.5);
  }

  /** groundOffset je Vegetations-Prefab — Auswahlmenge des Nachsetzens. */
  private readonly foliageOffset: ReadonlyMap<number, number> = new Map(
    FOLIAGE.map((f) => [f.prefabHash, f.groundOffset])
  );

  /**
   * Statische Physik (Fallen und Anheben): Bäume, Felsen und Pickables sitzen
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

  /**
   * Geländeeingriffe an die Spieler der Welt, in der sie geschahen (`weltId`),
   * niemand sonst: Die Koordinaten zweier Welten sind nicht vergleichbar, und
   * ein Spieler in einer Instanz hat mit dem Gelände der Oberwelt nichts zu
   * tun. Was er dabei verpasst, holt `teleportPeer` bei der Rückkehr nach.
   */
  private broadcastTerrainOps(
    ops: ReadonlyArray<{ pos: Vector3; settingsJson: string }>,
    weltId: string,
    nur?: Peer
  ): void {
    const ziele = (nur ? [nur] : this.net.getPeers()).filter((p) => p.worldId === weltId);
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
   * RandomEvents (stark verschlankt): alle
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

    // Nur Spieler in der Oberwelt. Ein Weltereignis hängt an Weltzeit und
    // Weltgegend; in einer Instanz gibt es weder das eine noch das andere.
    const kandidaten = this.net.getPeers().filter((p) => p.worldId === HAUPTWELT_ID);
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
      // F6: letzte verarbeitete Eingabe-Sequenznummer, ANGEHÄNGT statt
      // zwischen die bestehenden Felder eingefügt — genau das Muster, das
      // der Client beim Lesen schon kennt (main.ts:
      // `if (reader.remaining >= 12) serverPos = reader.readVector3()`):
      // ein älterer Leser liest seine bekannten Felder und lässt den Rest
      // liegen, ein neuerer prüft `remaining`, bevor er zugreift. Deshalb
      // KEINE Protokollversion nötig für diese Änderung (s. Bericht,
      // Abschnitt Drahtformat).
      w.writeInt32(peer.lastInputSeq);
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
    const parts = decodeArmor(peer.ruestung);
    for (const [slot, id] of Object.entries(parts)) {
      const armor = ruestungZu(id);
      if (armor && !canWearArmor(armor, peer.figur)) { delete parts[slot]; continue; }
      if (ruestungZu(id)?.figure && !peer.inventar.all.some(i => i.shared.ruestungsteil === id)) delete parts[slot];
    }
    peer.ruestung = encodeArmor(parts);
    if (peer.characterID) this.zdosVon(peer).getZDO(peer.characterID)?.setString(RUESTUNG_MEMBER, peer.ruestung);
    const remaining = new Set(Object.values(parts));
    for (const item of peer.inventar.all) {
      if (!item.shared.ruestungsteil) continue;
      item.equipped = remaining.delete(item.shared.ruestungsteil);
    }
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
   * Nahkampfschlag: trifft die nächste Kreatur innerhalb von
   * NAHKAMPF_REICHWEITE vor dem Spieler — "vor" im Sinne des
   * Trefferkegels (NAHKAMPF_KEGEL_GRAD um die vom Server GEFUEHRTE
   * Blickrichtung, s. fuehreBlickNach).
   * Kreaturen-HP leben als ZDO-Member `HEALTH_MEMBER`; ihr Startwert
   * steht in shared/leben.ts und wird beim Spawn geschrieben (s.
   * SpawnSystem.stelleLebenSicher), damit der Client daraus einen
   * Lebensbalken zeichnen kann. Bei 0 stirbt die Kreatur (SpawnSystem
   * räumt den Zustand selbst auf).
   */
  /**
   * Reichweite eines Nahkampfschlags in m, gemessen in der XZ-Ebene von
   * der SERVER-Position zum Ziel-ZDO.
   *
   * Bis Paket 0.3 stand hier 8 — und diese eine Zahl war zugleich die
   * Reichweite UND die Toleranz fuer die vom Client gemeldete Stelle. Ein
   * Schlag traf damit auf acht Meter, in jede Richtung.
   *
   * 3,5 m ist ein ZWISCHENSTAND. Er misst vom Spieler zum ZDO-URSPRUNG
   * der Kreatur, nicht zu ihrem Koerper — ein Ur (Boar) mit rund 0,7 m
   * Rumpfradius wird also faktisch schon bei 2,8 m Abstand der Huellen
   * getroffen. Sobald Paket D2 die Trefferkugel bringt, wird hier gegen
   * die Kugel gerechnet und die Zahl fein eingestellt.
   *
   * Range of one melee swing (m), measured in XZ from the SERVER position.
   */
  private static readonly NAHKAMPF_REICHWEITE = 3.5;

  /**
   * Wie weit die vom Client GEMELDETE Schlagstelle von der Serverposition
   * abweichen darf (m). Plausibility radius for the client-reported spot.
   *
   * GEMESSEN, nicht geraten (13.09.2026): ein Spieler im Browser, ~150
   * Angriffspakete in Stand, Gehen, Rennen, Strafe, Rueckwaerts und
   * Springen; verglichen wurde je Paket die gemeldete Stelle mit
   * `peer.position` beim Empfang.
   *
   *   Stand      0,01 m
   *   in Bewegung  Median 0,43 m · p95 0,95 m · p99 1,09 m · max 1,42 m
   *
   * Das deckt sich mit der Zahl, die `client/src/net/Positionsverlauf.ts`
   * fuer den Abgleich nennt (0,3–0,6 m in Bewegung). Beide Seiten rechnen
   * dieselbe Bewegung, nur mit verschiedenen Mitteln — Havok-Kapsel gegen
   * feste Schritte auf der Heightmap; der Rest ist die halbe Netzrunde.
   *
   * ACHTUNG bei der Messung: Ein SICHTBARES Chromium-Fenster wird auf
   * der Messmaschine vom Compositor auf 1 rAF/s gedrosselt. Der Client
   * integriert dann gegen seinen dt-Deckel (0,1 s) und bleibt scheinbar
   * 5 m hinter dem Server zurueck. Dieselbe Messung headless: 0,43 m.
   * Wer hier eine grosse Zahl misst, misst zuerst seine Bildrate — s.
   * den Kopf von tools/pw-nahkampf-trefferquote.mjs.
   *
   * 4 m ist die 1,42 m aus der Messung plus Luft fuer eine schlechte
   * Leitung: Der Client meldet die Stelle, an der er beim ABSENDEN stand,
   * der Server vergleicht mit der Stelle beim EMPFANG — bei Lauftempo
   * 7,5 m/s sind 0,3 s einfache Laufzeit weitere 2,25 m. Enger zu gehen
   * hiesse, ehrliche Schlaege von Spielern mit Ping zu verwerfen; die
   * Zahl ist eine Absurditaetsschranke, keine Feinjustierung.
   */
  private static readonly SCHLAG_MELDUNG_TOLERANZ = 4;

  /**
   * Halber Oeffnungswinkel des Trefferkegels in Grad — ein Ziel muss
   * innerhalb von ±60° um die gefuehrte Blickrichtung liegen
   * (fuehreBlickNach; bis zum 13.09. war es die im Paket behauptete).
   *
   * 120° Gesamtoeffnung ist bewusst weit. Enger waere sauberer gegen
   * Rueckentreffer, wuergt aber die Dreierkombo ab: Waehrend der drei
   * Hiebe laeuft die Kreatur um den Spieler herum, und der Spieler dreht
   * mit der Maus nach. Trifft Hieb 2 nicht mehr, weil das Ziel inzwischen
   * 70° seitlich steht, bricht die Kette mitten im Schlag — genau das,
   * was sich "kaputt" anfuehlt. Gemessen mit
   * tools/pw-nahkampf-trefferquote.mjs: 60 von 60 ehrlichen Schlaegen
   * treffen (frontal, waehrend eines Schwenks von −55° bis +55° mit
   * laufender Kombo, und fest auf 45°), 0 von 20 aus dem Ruecken.
   */
  private static readonly NAHKAMPF_KEGEL_GRAD = 60;

  /**
   * Unterhalb dieses Abstands (m) gilt der Kegel NICHT.
   *
   * Steht die Kreatur praktisch im Spieler, ist die Richtung zu ihr
   * reines Rauschen — ein Vorzeichenwechsel um wenige Zentimeter wuerde
   * ueber Treffer oder Fehlschlag entscheiden. Ein Gegner, der einem im
   * Nacken klebt, muss getroffen werden koennen.
   */
  private static readonly NAHKAMPF_KEGEL_MINDESTABSTAND = 0.8;

  /**
   * Hoechste Drehgeschwindigkeit (rad/s), die der Server einer gemeldeten
   * Blickrichtung zwischen zwei Meldungen zugesteht. 15 rad/s sind rund
   * 860°/s — eine halbe Drehung in 0,21 s.
   *
   * ── WELCHE ZUSAGE HIER UEBERHAUPT DRINSTEHT ─────────────────────────
   * KEINE ueber die Wahrheit der Blickrichtung. Sie kommt vom Client,
   * jede einzelne Meldung, und der Server hat nichts, woran er sie
   * messen koennte (die Kamera steht im Browser). Was er messen kann,
   * ist die FOLGE der Meldungen gegen die Uhr: Eine Figur, die sich in
   * 50 ms um 180° dreht, hat sich nicht gedreht, sondern ist umgesprungen.
   * Die Zusage lautet deshalb: *Der Server schlaegt immer in die
   * Richtung, die der Client ueber einen zusammenhaengenden Verlauf
   * gemeldet hat — wer nach hinten treffen will, muss sich vorher
   * wirklich umdrehen und ist dabei fuer alle sichtbar abgewandt.*
   * Nicht mehr. Ein Client, der zwei Sekunden lang ehrlich nach hinten
   * blickt und dann zuschlaegt, trifft nach hinten; das ist der
   * Normalfall des Spiels und kein Angriff.
   *
   * ── WARUM 15 UND NICHT WENIGER ──────────────────────────────────────
   * Die Maus des Clients rechnet mit MOUSE_SENSITIVITY = 0,0022 rad je
   * Zaehlschritt (client/src/player/PlayerController.ts). Eine halbe
   * Drehung sind damit rund 1 430 Zaehlschritte — bei 800 dpi etwa 4,5 cm
   * Handweg, bei 1 600 dpi 2,3 cm. Ein Handriss von 1 m/s liefert das in
   * unter 50 ms, also mit weit ueber 60 rad/s. Eine Grenze, die ehrliche
   * Risser NIE einholt, gaebe es also nicht — sie muesste so hoch liegen,
   * dass sie nichts mehr bremst.
   *
   * Deshalb kostet ein Ueberschreiten hier auch keinen Fehlschlag,
   * sondern nur Nachlauf: Die gefuehrte Richtung wird an die Grenze
   * GEKLEMMT, nicht verworfen, und holt die echte binnen weniger
   * Meldungen ein (bei 20 Hz: 0,75 rad je Paket). Der Kegel ist ±60°
   * breit, ein Nachlauf unter 60° faellt also gar nicht auf. Nach einem
   * vollen Riss um 180° ist der Rueckstand nach 0,14 s wieder unter 60°,
   * nach 0,21 s bei null — kuerzer als die Schlagsperre der Drossel
   * (350 ms).
   *
   * GEMESSEN am laufenden Spiel (13.09.2026,
   * tools/pw-nahkampf-drehung.mjs — echte Mausereignisse durch den
   * InputManager, Gegner im Ruecken, herumreissen und schlagen):
   *   Riss 480–640°/s, sofort geklickt      10/10 Treffer
   *   Riss 480–640°/s, nach 200 ms geklickt 10/10 Treffer
   *   Blick springt in EINEM Bild um 180°, sofort geklickt   0/10
   *   dasselbe, nach 200 ms geklickt                        10/10
   * Nur der Sprung in einem einzigen Bild verliert Schlaege, und auch
   * der nur, wenn im selben Augenblick geklickt wird — eine Bewegung,
   * die keine Hand erzeugt. Der ehrliche Betrieb bleibt unberuehrt:
   * tools/pw-nahkampf-trefferquote.mjs meldet nach dieser Aenderung
   * unveraendert 60/60 ehrliche Treffer und 0/20 aus dem Ruecken.
   *
   * Maximum turn rate (rad/s) granted between two look reports.
   */
  private static readonly BLICK_DREHRATE_MAX = 15;

  /**
   * Hoechstalter (s) einer Blickmeldung, das beim Nachfuehren als
   * Drehzeit ANGERECHNET wird.
   *
   * Ohne diesen Deckel waere die Grenze wirkungslos: Wer seine
   * Eingabepakete zurueckhaelt, sammelt Drehguthaben und darf danach
   * springen — bei 350 ms Schlagtakt (Drossel) waeren das 5,2 rad, also
   * jede Richtung. Angerechnet wird deshalb hoechstens die Zeit, die
   * zwischen zwei Meldungen eines ehrlichen Clients ohnehin liegt; wer
   * nichts meldet, verdient auch kein Guthaben.
   *
   * 0,05 s ist genau der Sendetakt des Clients: PlayerInput geht fest
   * mit 20 Hz raus (client/src/main.ts, INPUT_SEND_RATE_MS = 50 ms),
   * ununterbrochen, auch im Stehen. Ein ehrlicher Spieler verliert
   * dadurch NICHTS — er schoepft den Deckel mit jedem Paket voll aus.
   * Verlorene oder verspaetete Eingabepakete kosten ihn nur Nachlauf
   * (0,75 rad je Paket statt mehr auf einen Schlag), keinen Schlag.
   *
   * Und das ist zugleich die Obergrenze dessen, was eine LUEGE im
   * Angriffspaket noch bewegen kann: 0,75 rad ≈ 43°. Zusammen mit dem
   * Kegel (±60°) reicht ein Schlag damit hoechstens ~103° zur Seite —
   * nach hinten (180°) kommt niemand mehr, ohne sich wirklich zu drehen.
   * Ein groesserer Deckel macht genau diese Zahl groesser: mit 0,1 s
   * waeren es 146°, und der Rundumschlag waere nur halb tot.
   */
  private static readonly BLICK_ALTERSDECKEL_S = 0.05;

  /**
   * Angriff/Ernte nur nah an der SERVER-Position — vorher wirkte ein
   * Schlag an jeder Weltposition (Review-Punkt 4). handleHarvest erbt die
   * Pruefung ueber handleAttack. Der frueher hier gefuehrte feste
   * 350-ms-Cooldown (SCHLAG_COOLDOWN_MS) ist entfallen: A4 (Security-
   * Review) drosselt PacketType.Attack schon in NetManager.handlePacket,
   * VOR diesem Handler.
   *
   * Seit Paket 0.3 prueft das nur noch die PLAUSIBILITAET der Meldung.
   * Gewirkt wird ausschliesslich um `peer.position` (s. handleAttack) —
   * die gemeldete Stelle waehlt kein Ziel mehr aus. Der Test bleibt
   * trotzdem stehen: Er ist die letzte Stelle, an der die Behauptung des
   * Clients ueberhaupt noch mit der Serverwahrheit abgeglichen wird, und
   * ein Paket, das sie um Kilometer verfehlt, ist kein Spielzug.
   */
  private schlagErlaubt(peer: Peer, pos: Vector3): boolean {
    const dx = pos.x - peer.position.x;
    const dz = pos.z - peer.position.z;
    const r = WovServer.SCHLAG_MELDUNG_TOLERANZ;
    return Number.isFinite(pos.x) && Number.isFinite(pos.z) && dx * dx + dz * dz <= r * r;
  }

  /**
   * Winkel auf (−π, π] bringen — sonst ist die Differenz zweier
   * Blickrichtungen einmal 0,1 rad und einmal 6,2 rad, je nachdem, wie
   * oft der Client schon herumgedreht hat.
   */
  private static normalisiereWinkel(w: number): number {
    const zwei = 2 * Math.PI;
    const r = ((w + Math.PI) % zwei + zwei) % zwei;
    return r - Math.PI;
  }

  /**
   * Eine gemeldete Blickrichtung in die gefuehrte einarbeiten und die
   * neue gefuehrte zurueckgeben (null, solange es gar keine gibt).
   *
   * Feed one reported look direction into the tracked one.
   *
   * Die Regel ist eine einzige: zwischen zwei Meldungen darf sich der
   * Blick um hoechstens BLICK_DREHRATE_MAX mal der (gedeckelten)
   * Zwischenzeit bewegen. Was darueber hinausgeht, wird GEKLEMMT, nicht
   * verworfen — die Begruendung steht bei BLICK_DREHRATE_MAX.
   *
   * PlayerInput und Attack laufen bewusst durch DIESELBE Funktion: Sonst
   * waere die Luecke nur umgezogen. Wer im Angriffspaket nicht mehr
   * springen darf, springt eben im Eingabepaket unmittelbar davor — es
   * kostete ihn ein Paket und keine Zeit. So gibt es je Peer genau EINEN
   * Blickverlauf, in den jede Meldung eingerechnet wird, egal aus
   * welchem Paket sie stammt.
   *
   * Die ERSTE brauchbare Meldung wird unbesehen uebernommen: Ein frisch
   * verbundener Peer hat keine Vorgeschichte, gegen die man sie halten
   * koennte, und "steht anfangs zwangsweise nach −Z" waere eine
   * erfundene Wahrheit. Gewonnen ist damit nichts fuer einen Angreifer —
   * eine einmalige freie Richtung hat auch, wer sich einfach hinstellt
   * und hinschaut.
   */
  private fuehreBlickNach(peer: Peer, gemeldet: number, jetzt: number): number | null {
    // NaN/Infinity gar nicht erst einarbeiten: Ein einziges NaN machte
    // `blickYaw` dauerhaft unbrauchbar, und der Kegel liesse danach
    // entweder alles oder nichts durch. Die vorige gefuehrte Richtung
    // bleibt stehen — sie ist die letzte, die Sinn ergab.
    if (!Number.isFinite(gemeldet)) return peer.blickYaw;
    const ziel = WovServer.normalisiereWinkel(gemeldet);

    if (peer.blickYaw === null) {
      peer.blickYaw = ziel;
      peer.blickYawZeit = jetzt;
      return ziel;
    }

    const dt = Math.min(
      Math.max((jetzt - peer.blickYawZeit) / 1000, 0),
      WovServer.BLICK_ALTERSDECKEL_S
    );
    const erlaubt = WovServer.BLICK_DREHRATE_MAX * dt;
    const differenz = WovServer.normalisiereWinkel(ziel - peer.blickYaw);
    peer.blickYaw =
      Math.abs(differenz) <= erlaubt
        ? ziel
        : WovServer.normalisiereWinkel(peer.blickYaw + Math.sign(differenz) * erlaubt);
    peer.blickYawZeit = jetzt;
    return peer.blickYaw;
  }

  /**
   * Liegt `ziel` im Trefferkegel um die Blickrichtung `yaw`, von `von` aus
   * gesehen? Is the target inside the swing cone?
   *
   * `yaw` ist die GEFUEHRTE Richtung aus fuehreBlickNach, nicht der Wert
   * aus dem Angriffspaket — der Unterschied ist der ganze Befund 1.
   *
   * Die Blickbasis ist die des Clients (PlayerController.update):
   * forward = (−sin yaw, −cos yaw). Yaw 0 schaut also nach −Z. Diese
   * Basis steht auch im Client so im Kommentar; weicht sie je ab, treffen
   * Spieler ins Leere, ohne dass ein Test das merkt — deshalb steht sie
   * hier ausgeschrieben und nicht als blosses Math.sin/Math.cos-Paar.
   */
  private imTrefferkegel(von: Vector3, yaw: number, ziel: Vector3): boolean {
    const dx = ziel.x - von.x;
    const dz = ziel.z - von.z;
    const abstand = Math.hypot(dx, dz);
    if (abstand < WovServer.NAHKAMPF_KEGEL_MINDESTABSTAND) return true;
    // Ein Client ohne Yaw-Feld (oder mit NaN) darf nicht heimlich alles
    // treffen — aber auch nicht heimlich nichts. NaN faellt hier durch,
    // und das ist die richtige Seite: ein Paket ohne brauchbare
    // Blickrichtung ist kein gezielter Schlag.
    if (!Number.isFinite(yaw)) return false;
    const vorX = -Math.sin(yaw);
    const vorZ = -Math.cos(yaw);
    const kosinus = (vorX * dx + vorZ * dz) / abstand;
    return kosinus >= Math.cos((WovServer.NAHKAMPF_KEGEL_GRAD * Math.PI) / 180);
  }

  private handleAttack(peer: Peer, reader: Reader): void {
    const pos = reader.readVector3();
    if (!this.schlagErlaubt(peer, pos)) return;
    /*
      Der im Paket BEHAUPTETE Blickwinkel. Bis heute war er die einzige
      Blickrichtung, die der Server kannte, und der Kegel rechnete
      ungeprueft gegen ihn — ein Angreifer-Skript hat damit bei
      unveraenderter, ehrlicher Position und ohne sich je zu drehen vier
      von sechs sternfoermig verteilten Zielen getroffen, darunter das im
      Ruecken (Befund 1, 13.09.2026).

      Jetzt ist er nur noch eine MELDUNG unter anderen: Er geht durch
      dieselbe Nachfuehrung wie der `lookYaw` der Eingabepakete und darf
      die gefuehrte Richtung nur um das bewegen, was seit der letzten
      Meldung drehbar war (fuehreBlickNach). Geschlagen wird danach mit
      der GEFUEHRTEN Richtung, nicht mit der behaupteten.

      Warum der behauptete Winkel trotzdem noch einfliesst, statt ihn
      einfach zu verwerfen: Er ist die FRISCHESTE Blickmeldung, die es zu
      diesem Schlag gibt — das Eingabepaket davor ist bis zu 50 ms alt,
      und in einer schnellen Drehung sind das bis zu 0,75 rad. Ihn
      wegzuwerfen hiesse, jeden Schlag waehrend einer Drehung um genau
      diesen Betrag daneben zu legen.
    */
    const behaupteterYaw = reader.readFloat32();
    // Kein gefuehrter Blick (kein einziges brauchbares Blickfeld bisher)
    // → NaN, und imTrefferkegel() faellt darueber auf "kein Ziel". Das
    // ist die richtige Seite: ein Schlag ohne jede Blickrichtung ist kein
    // gezielter Schlag. Der Weg zur Ernte bleibt offen (die kennt keinen
    // Kegel).
    const yaw = this.fuehreBlickNach(peer, behaupteterYaw, Date.now()) ?? NaN;
    let waffe = '';
    try {
      waffe = reader.readString();
    } catch {
      /* alter Client ohne Waffenfeld */
    }
    // Nur was tatsächlich im Server-Inventar liegt zählt (A2) — sonst
    // Faust. handleHarvest bekommt dieselbe geprüfte Waffe weitergereicht,
    // eine zweite Prüfung dort erübrigt sich.
    waffe = gepruefteWaffe(peer.inventar, waffe);
    const nachSchlag = ausdauerAbzug(
      { wert: peer.stamina, zuletztVerbraucht: peer.staminaZuletztVerbraucht },
      SCHLAG_AUSDAUER,
      Date.now()
    );
    if (!nachSchlag) return;
    peer.stamina = nachSchlag.wert;
    peer.staminaZuletztVerbraucht = nachSchlag.zuletztVerbraucht;
    this.sendPlayerState(peer);
    const schaden = WAFFEN_SCHADEN[waffe] ?? 4; // Faust
    /*
      Gesucht wird um die SERVER-Position, nicht um die gemeldete.

      Vorher stand hier `pos` — die Stelle, die der Client behauptet. Wer
      ein eigenes Paket schrieb, suchte sich damit den Punkt aus, an dem
      sein Schlag wirkt; die Reichweitenpruefung oben liess dafuer acht
      Meter Spielraum, und die gemeldete Stelle durfte am aeusseren Rand
      davon liegen. `peer.position` ist seit dem 11.09. selbst gerechnet
      (world/Spielerbewegung.ts, gegen Gelaende UND Hindernisse) und damit
      belastbar genug, um der Anker zu sein.

      Der Preis ist der Versatz zwischen beiden Wahrheiten. Er ist
      gemessen und klein (Median 0,43 m, max 1,42 m — s.
      SCHLAG_MELDUNG_TOLERANZ), also weit unter der Reichweite.
    */
    const von = peer.position;
    let ziel: import('./zdo/ZDO.js').ZDO | null = null;
    let best = WovServer.NAHKAMPF_REICHWEITE ** 2;
    for (const zdo of this.zdosVon(peer).getZDOsInRadius(von, WovServer.NAHKAMPF_REICHWEITE)) {
      const def = this.prefabs.getByHash(zdo.prefabHash);
      const flags = def?.flags ?? 0n;
      // ANGREIFBAR: die eigenen NPCs mit Kampfwerten (shared/npc.ts). Sie
      // tragen bewusst kein *_AI-Flag, sonst verwaltete das Spawnsystem sie.
      if ((flags & (PrefabFlag.ANIMAL_AI | PrefabFlag.MONSTER_AI | PrefabFlag.ANGREIFBAR)) === 0n) continue;
      // Ein sterbendes Wesen (Todesclip laeuft) ist nicht mehr zu treffen:
      // sein Leben steht auf 0, und der Schlag risse es als „frisch" hoch.
      if (this.spawns?.stirbt(zdo)) continue;
      const d = (zdo.position.x - von.x) ** 2 + (zdo.position.z - von.z) ** 2;
      if (d >= best) continue;
      // Der Kegel steht NACH dem Abstand, nicht davor: Er kostet einen
      // Wurzelzug je Kandidat, der Abstand nur zwei Multiplikationen.
      if (!this.imTrefferkegel(von, yaw, zdo.position)) continue;
      best = d;
      ziel = zdo;
    }
    /*
      Kein Wesen im Kegel → Ernte. Auch die faellt jetzt um die
      Serverposition aus, aus demselben Grund wie oben.

      OHNE Kegel, absichtlich: Ein Baum steht still, er umkreist niemanden,
      und ein Fehlschlag beim Faellen ist kein Kampfgefuehl, sondern nur
      Aerger. Die Ernte hat ihre eigenen, engeren Reichweiten (3,2 m).
    */
    if (!ziel) return this.handleHarvest(peer, von, waffe);
    const name = this.prefabs.getByHash(ziel.prefabHash)?.name ?? '?';
    this.sendeTrefferEffekt({ x: ziel.position.x, y: ziel.position.y + 1.0, z: ziel.position.z }, 1, peer.worldId);
    // Startwert aus shared/leben.ts statt aus einem Literal. Der
    // `||`-Zweig greift nur noch für Wesen aus Saves von VOR dieser
    // Änderung — seit `stelleLebenSicher` bringt jede Kreatur ihre Punkte
    // vom Spawn mit, und `adoptPersisted` trägt sie den alten nach.
    const hp = (ziel.getInt(HEALTH_MEMBER) || maxLeben(name)) - schaden;
    if (hp <= 0) {
      // Mit Todesclip bleibt der Koerper, bis der Clip gespielt ist — das
      // Spawnsystem raeumt ihn dann selbst weg. Ohne Clip wie bisher sofort.
      if (!this.spawns?.sterbe(ziel)) this.zdosVon(peer).destroyZDO(ziel.zdoid);
      // F5: einzige verdrahtete Anwendung der Fortschrittsmarken — Eikthyr
      // besiegt heisst defeated_eikthyr, unabhaengig davon wie oft er ueber
      // den Altar (StatueDeer-Zweig oben) erneut beschworen wird. setzen()
      // ist idempotent, ein erneuter Sieg setzt die Marke einfach nochmal.
      if (name === 'Eikthyr') {
        this.weltMarken.setzen(GlobalKey.defeated_eikthyr);
      }
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
      this.spawns?.treffer(ziel);
    }
  }

  /**
   * Ernte-Ziele: Bäume (Axt), Felsen (Spitzhacke), Büsche/Stümpfe (alles).
   * HP als ZDO-Member; beim Fällen wandert der Ertrag direkt ins Inventar
   * des Angreifers (konsistent mit den Kreaturen-Drops).
   *
   * `waffe` kommt bereits geprüft von handleAttack (gepruefteWaffe, A2) —
   * kein zweiter Abgleich hier nötig.
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
    for (const zdo of this.zdosVon(peer).getZDOsInRadius(pos, 4)) {
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
    this.sendeTrefferEffekt({ x: ziel.position.x, y: ziel.position.y + 1.0, z: ziel.position.z }, 0, peer.worldId);
    const hp = (ziel.getInt(HEALTH_MEMBER) || startHp) - schaden;
    if (hp > 0) {
      ziel.setInt(HEALTH_MEMBER, hp);
      ziel.revision.reviseData();
      ziel.dirty = true;
      return;
    }
    this.zdosVon(peer).destroyZDO(ziel.zdoid);
    const menge = art === 'weich' ? 2 : 6 + ((Math.random() * 5) | 0);
    const item = art === 'fels' ? 'Stone' : 'Wood';
    antwort(`${art === 'baum' ? 'Baum gefällt' : art === 'fels' ? 'Fels zerbrochen' : 'Zerlegt'} — ${menge}× ${item}`, item, menge);
  }

  /** Kreaturen-Treffer auf Spieler (vom SpawnSystem gemeldet). */
  /**
   * Parade (Rechtsklick mit Waffe): oeffnet PARADE_FENSTER_MS lang ein
   * Fenster, in dem Kreaturentreffer abgewehrt werden. Kostet Ausdauer wie
   * ein halber Schlag, damit man nicht dauerhaft parieren kann. Der Client
   * spielt die Geste sofort (AvatarRig.starteAktion), der Server
   * entscheidet nur ueber die Wirkung — wie beim Schlag.
   */
  /**
   * Treffereffekt an alle Spieler im Umkreis (Vorbild: MeleeImpact /
   * bloodSplash / MeleeSpark des Originals, hier als Ereignis, das der
   * Client in Partikel uebersetzt). `art`: 0 hart, 1 Fleisch, 2 Parade.
   *
   * Nur an Spieler DERSELBEN Welt (`weltId`). Alle Instanzen liegen am
   * Ursprung, die Koordinaten zweier Welten sagen also nichts darueber, wer
   * nebeneinander steht; ohne die Weltpruefung sah ein Spieler im Dungeon
   * den Treffer-Blitz eines Schlags aus der Oberwelt.
   */
  private sendeTrefferEffekt(pos: Vector3, art: number, weltId: string, umkreis = 40): void {
    if (!this.weltIdGueltig('sendeTrefferEffekt', weltId)) return;
    const r2 = umkreis * umkreis;
    for (const p of this.net.getPeers()) {
      if (p.worldId !== weltId) continue;
      const d = (p.position.x - pos.x) ** 2 + (p.position.z - pos.z) ** 2;
      if (d > r2) continue;
      p.sendPacketWith(PacketType.HitEffect, (w) => {
        w.writeVector3(pos);
        w.writeInt32(art);
      });
    }
  }

  /**
   * Aufrufe von applyCreatureAttack/sendeTrefferEffekt, die ohne (oder mit
   * leerer) Welt kamen und verworfen wurden. Im Betrieb bleibt der Zaehler
   * auf 0: alle echten Aufrufer sind typisiert und reichen eine Welt-id
   * durch. Er steht hier, damit ein Test — und ein Blick in den Debugger —
   * ihn lesen kann.
   */
  ohneWeltVerworfen = 0;
  private ohneWeltLetzteMeldung = 0;
  private static readonly OHNE_WELT_MELDUNG_INTERVALL_MS = 60_000;

  /**
   * Ist `weltId` eine brauchbare Welt-id? Sonst: zaehlen, hoechstens einmal
   * je Minute laut melden (Muster der Budget-Abbrueche in Metriken.ts) und
   * `false` liefern — der Aufrufer verwirft den Schlag. „Unbekannte Welt →
   * niemand getroffen“ ist die sichere Antwort; sie ist nur nicht mehr
   * stumm. Nimmt `unknown` an, weil der Aufruf im Fehlerfall nicht typisiert
   * war (das ist ja der Fall, um den es geht).
   */
  private weltIdGueltig(stelle: string, weltId: unknown): boolean {
    if (typeof weltId === 'string' && weltId !== '') return true;
    this.ohneWeltVerworfen++;
    const jetzt = Date.now();
    if (jetzt - this.ohneWeltLetzteMeldung >= WovServer.OHNE_WELT_MELDUNG_INTERVALL_MS) {
      this.ohneWeltLetzteMeldung = jetzt;
      // Die Meldung darf unter KEINEN Umstaenden werfen: Sie steht im
      // Server-Tick, und `weltId` ist ein Wert, dem man nichts zutrauen darf
      // (ein Welt-Objekt statt seiner id, BigInt, zyklisches Objekt, Proxy
      // mit werfendem Getter — JSON.stringify wirft bei allen). Deshalb
      // nur `typeof` und, bei einem String, dessen Laenge; alles unter try.
      try {
        console.error(
          `[WoV] ${stelle}: weltId fehlt oder ist leer (${WovServer.kennzeichne(weltId)}) — ` +
            `Schlag/Effekt verworfen (bisher ${this.ohneWeltVerworfen}x)`
        );
      } catch {
        /* eine Diagnose darf den Tick nicht kosten */
      }
    }
    return false;
  }

  /** Kurze, sichere Kennzeichnung eines unbrauchbaren Wertes — wirft nie. */
  private static kennzeichne(wert: unknown): string {
    try {
      if (typeof wert === 'string') return `String der Laenge ${wert.length}`;
      if (wert === null) return 'null';
      return typeof wert;
    } catch {
      return 'unlesbar';
    }
  }

  private handleParry(peer: Peer): void {
    const nachParade = ausdauerAbzug(
      { wert: peer.stamina, zuletztVerbraucht: peer.staminaZuletztVerbraucht },
      PARADE_AUSDAUER,
      Date.now()
    );
    if (!nachParade) return;
    peer.stamina = nachParade.wert;
    peer.staminaZuletztVerbraucht = nachParade.zuletztVerbraucht;
    peer.paradeBis = Date.now() + PARADE_FENSTER_MS;
    this.sendPlayerState(peer);
  }

  /**
   * Eine Kreatur oder ein NPC schlaegt zu — trifft nur Spieler in DERSELBEN
   * Welt (`weltId`, die des Schlaegers). Der Radius ist reine XZ-Rechnung,
   * und alle Instanzen liegen am Ursprung (DungeonManager.getOrCreateInstance):
   * Ohne die Weltpruefung traf eine Figur der Oberwelt den Spieler im
   * Dungeon an denselben Koordinaten — und er starb an einer Figur, die es
   * in seiner Welt nicht gibt.
   */
  private applyCreatureAttack(pos: Vector3, damage: number, radius: number, weltId: string): void {
    // Ein Test greift ueber `as unknown as` hierher, und dort sieht tsc einen
    // fehlenden Parameter nicht: Ohne diese Zeile uebersprang der Weltfilter
    // unten JEDEN Peer, und ein Aufruf mit drei Argumenten traf still niemanden
    // (b7-entsperren: kein Spieler starb mehr). Ein Aufrufer ohne Welt wird
    // gemeldet und der Schlag verworfen — nicht geworfen: Das steht im
    // Server-Tick, und ein Wurf kostet dort den ganzen Frame, jeder
    // Instanzwelt ihren Tick und ohne Prozess-Handler den Prozess.
    if (!this.weltIdGueltig('applyCreatureAttack', weltId)) return;
    const r2 = radius * radius;
    for (const peer of this.net.getPeers()) {
      if (peer.worldId !== weltId) continue;
      const d = (peer.position.x - pos.x) ** 2 + (peer.position.z - pos.z) ** 2;
      if (d > r2) continue;
      // Parade: Treffer im Fenster prallt ab. Kein Schaden, aber der
      // Spieler erfaehrt es — sonst sieht ein abgewehrter Treffer aus wie
      // ein Fehlschlag der Kreatur.
      if (peer.paradeBis > Date.now()) {
        peer.paradeBis = 0;
        this.sendeTrefferEffekt({ x: peer.position.x, y: peer.position.y + 1.1, z: peer.position.z }, 2, weltId);
        peer.sendPacketWith(PacketType.InteractResult, (w) => {
          w.writeBool(true);
          w.writeString('Pariert');
          w.writeString('');
          w.writeInt32(0);
        });
        continue;
      }
      this.sendeTrefferEffekt({ x: peer.position.x, y: peer.position.y + 1.2, z: peer.position.z }, 1, weltId);
      peer.health = Math.max(0, peer.health - damage);
      if (peer.health <= 0) {
        // Tod: zurück zum Weltspawn, volle HP — Betten/Gräber später.
        peer.health = 100;
        peer.stamina = AUSDAUER_REGEL.max;
        // EIN Teleport: aus einer Instanz geht es direkt an den Wiedereinstiegs-
        // punkt der Oberwelt, nicht erst an den Eingang und dann weiter.
        const hatteBett = peer.spawnPoint !== null;
        const wieder = this.wiedereinstiegspunkt(peer);
        // Ein gesetzter Punkt, der nicht mehr zu einem Bett fuehrt (abgerissen,
        // verschoben, Altbestand), wird verworfen UND gemeldet: still am
        // Weltspawn zu erwachen liesse den Spieler glauben, sein Schlafplatz
        // gelte noch.
        const bettVerloren = hatteBett && peer.spawnPoint === null;
        if (peer.dungeonId) this.leaveDungeon(peer, { ...wieder });
        else this.teleportPeer(peer, { ...wieder }, null);
        peer.sendPacketWith(PacketType.InteractResult, (w) => {
          w.writeBool(true);
          w.writeString(bettVerloren ? 'Du bist gestorben — dein Schlafplatz ist nicht mehr da' : 'Du bist gestorben');
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
    for (const zdo of this.zdosVon(peer).getZDOsInRadius(pos, 3)) {
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
      this.zdosVon(peer).destroyZDO(ziel.zdoid);
      const item = pickableItem(def?.name ?? '');
      return antwort(true, `Aufgesammelt: ${item?.name ?? def?.name ?? '?'}`, item?.name ?? '', item?.amount ?? 0);
    }

    if ((flags & F.DOOR) !== 0n) {
      // Gitter/Türen fahren nach oben (Krypta-Fallgitter-Stil) — Pivotdaten
      // fehlen im Export, Rotation sähe an der Mitte aufgehängt aus.
      const offen = ziel.getInt('state') === 1;
      ziel.setInt('state', offen ? 0 : 1);
      this.zdosVon(peer).updateZDOZone(ziel, {
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
      for (const p of this.zdosVon(peer).getZDOByPrefab(ziel.prefabHash)) {
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
      const schonDa = this.zdosVon(peer)
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
      const boss = this.zdosVon(peer).createZDO(EIKTHYR_HASH, {
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
      if (!this.darfBenutzen(ziel, peer)) return antwort(false, WovServer.FREMDER_BESITZ_MELDUNG);
      // Der Wiedereinstiegspunkt ist eine Koordinate der HAUPTWELT: nach dem
      // Tod steht der Spieler dort, egal aus welcher Welt er kam. Ein Bett in
      // einer Instanz haette Instanzkoordinaten — in der Oberwelt irgendwo im
      // Boden oder im Meer.
      if (peer.worldId !== HAUPTWELT_ID) {
        return antwort(false, 'In einem Dungeon kannst du keinen Schlafplatz setzen');
      }
      peer.spawnPoint = { x: ziel.position.x, y: ziel.position.y + 0.6, z: ziel.position.z };
      // Nur ein Layout-Bett wandert mit dem Gelaende: seine Kennung merken.
      peer.spawnBettId = istSpielerbau(ziel) ? '' : ziel.getString(LAYOUT_ID_MEMBER);
      peer.spawnBettBesitzer = ziel.getString('besitzer');
      return antwort(true, 'Schlafplatz gesetzt — hier wachst du künftig auf');
    }

    if ((flags & F.CONTAINER) !== 0n) {
      if (!this.darfBenutzen(ziel, peer)) return antwort(false, WovServer.FREMDER_BESITZ_MELDUNG);
      this.handleTruheOeffnen(peer, ziel, def);
      return;
    }

    return antwort(false, 'Damit kann man nichts machen');
  }

  /**
   * Truhe öffnen (F.CONTAINER, Roadmap F1) — ersetzt den früheren
   * Ein-Bit-Schalter samt direkt an den Spieler ausgezahlter
   * Zufallsbeute durch echten, entnehmbaren Inhalt (Container.ts).
   *
   * MIGRATION (Alt-Saves kennen nur TRUHE_LOOTED_MEMBER als Bit):
   *  - Bit noch nicht gesetzt → erste Berührung seit diesem Umbau.
   *    wuerfleTruhe() bleibt die EINZIGE Zufallsquelle (unverändert
   *    gegenüber vorher) und befüllt jetzt die Truhe statt den Spieler
   *    direkt zu beschenken. Das Bit wird SOFORT gesetzt — ein zweiter
   *    Login oder ein zweiter Öffner würfelt nie ein zweites Mal, exakt
   *    dieselbe Garantie wie vorher, nur eine Ebene tiefer (jetzt „hat
   *    ihre Erstbefüllung schon", vorher „wurde geplündert").
   *  - Bit bereits gesetzt (Alt-Save VOR diesem Umbau hatte die Truhe
   *    schon per Direktauszahlung geplündert) → sie startet leer. Ihr
   *    einziger Gegenstand ist damals schon beim Spieler gelandet, es
   *    gibt nichts nachzuholen.
   *
   * Jede weitere Öffnung liest nur noch den vorhandenen Inhalt — die
   * eigentliche Truhen-UI (nehmen/legen) läuft über ContainerAction
   * (handleContainerAction).
   */
  private handleTruheOeffnen(peer: Peer, ziel: ZDO, def: Prefab | undefined): void {
    if (ziel.getInt(TRUHE_LOOTED_MEMBER) !== 1) {
      ziel.setInt(TRUHE_LOOTED_MEMBER, 1);
      const inv = unpackContainer(ziel.getString(TRUHE_INHALT_MEMBER));
      const beute = wuerfleTruhe(def?.name ?? '');
      const beuteDef = findItem(beute.name);
      if (beuteDef) inv.addItem(beuteDef, beute.amount);
      ziel.setString(TRUHE_INHALT_MEMBER, packContainer(inv));
      ziel.revision.reviseData();
      ziel.dirty = true;
    }
    peer.sendPacketWith(PacketType.InteractResult, (w) => {
      w.writeBool(true);
      w.writeString('Truhe geöffnet');
      w.writeString('');
      w.writeInt32(0);
    });
    this.sendeTruheInhalt(peer, ziel);
  }

  /** Aktuellen Truheninhalt an GENAU diesen Peer schicken (s. PacketType.ContainerSync). */
  private sendeTruheInhalt(peer: Peer, ziel: ZDO): void {
    peer.sendPacketWith(PacketType.ContainerSync, (w) => {
      w.writeString(ziel.zdoid.userId.toString());
      w.writeInt32(ziel.zdoid.id);
      w.writeString(ziel.getString(TRUHE_INHALT_MEMBER));
    });
  }

  /**
   * Figurenwahl des Clients (Paket SetFigur).
   *
   * WAS HIER GEPRUEFT WIRD: Der Client schickt eine Kennung, und der
   * Server glaubt sie NICHT — `istFigur()` entscheidet, ob sie in der
   * gemeinsamen Liste steht. Ohne diese Pruefung landete ein beliebiger
   * String am ZDO, und jeder andere Client versuchte, ihn als
   * Modelldateinamen zu laden.
   *
   * WARUM DER WEG UEBER DAS ZDO: Der Member am Charakter-ZDO ist der
   * einzige Ort, an dem die Wahl AUTOMATISCH bei allen ankommt, die den
   * Spieler sehen — ZDOSync erledigt Verteilung und Nachzuegler. Ein
   * eigenes Broadcast-Paket muesste beides selbst loesen und wuerde bei
   * jemandem, der spaeter in Sichtweite kommt, schweigen.
   *
   * Ein Wechsel MITTEN IM SPIEL ist damit ebenfalls abgedeckt: Er
   * aendert denselben Member, und der Sync traegt ihn weiter.
   */
  /**
   * Frisur und Ruestung des Clients (Paket SetAussehen).
   *
   * Wie handleSetFigur: geprueft wird gegen die GEMEINSAME Liste
   * (shared/aussehen.ts), aus der auch die Charaktererstellung ihre
   * Auswahl baut — der Server glaubt dem Client nichts. Geschrieben wird
   * an ZDO-Member, weil ZDOSync Verteilung und Nachzuegler von selbst
   * loest; ein eigenes Broadcast-Paket muesste beides nachbauen und
   * schwiege bei jedem, der spaeter in Sichtweite kommt.
   *
   * Leerstring ist gueltig und heisst "nichts angezogen".
   */
  private handleSetAussehen(peer: Peer, reader: Reader): void {
    const frisur = reader.readString();
    const ober = reader.readString();
    const beine = reader.readString();
    // Vierter Wert, aber nur wenn er da ist: Ein Client von vor dem
    // 23.08.2026 sendet drei Strings. `readString()` auf einem leeren
    // Rest wuerfe und risse die Verbindung ab — fuer eine Haarfarbe.
    const haarfarbe = reader.remaining() > 0 ? reader.readString() : peer.haarfarbe;
    /*
     * Zwei additive Protokollstaende muessen sich hier ueberlappen:
     * Ruestungsclients von vor der Augenfarben-Auswahl schicken als
     * fuenften String bereits das JSON der Zusatz-Slots. Neue Clients
     * schicken erst die Augenfarbe und danach dieses JSON. Eine bekannte
     * Augenfarben-Kennung unterscheidet beide Formen eindeutig.
     */
    const fuenfterWert = reader.remaining() > 0 ? reader.readString() : '';
    const hatAugenfarbe = istAugenfarbe(fuenfterWert);
    const augenfarbe = hatAugenfarbe
      ? fuenfterWert
      : istAugenfarbe(peer.augenfarbe) ? peer.augenfarbe : AUGENFARBE_VORGABE;
    const ruestungsJson = hatAugenfarbe
      ? reader.remaining() > 0 ? reader.readString() : ''
      : fuenfterWert;
    let extra: unknown = {};
    try { if (ruestungsJson) extra = JSON.parse(ruestungsJson); }
    catch { this.inventarSync(peer); return; }
    if (!validArmorParts(extra, peer.figur)) { this.inventarSync(peer); return; }
    const parts = { ...extra, oberkoerper: ober, beine };
    if (!validArmorParts(parts, peer.figur) || Object.values(parts).some(id =>
      id && ruestungZu(id)?.figure && !peer.inventar.all.some(i => i.shared.ruestungsteil === id))) {
      this.inventarSync(peer); return;
    }
    if (
      !istFrisur(frisur) ||
      !istRuestung(ober) ||
      !istRuestung(beine) ||
      !istHaarfarbe(haarfarbe) ||
      !istAugenfarbe(augenfarbe)
    ) {
      console.warn(
        `[WoV] SetAussehen von "${peer.name}" abgelehnt: ` +
          `frisur="${frisur.slice(0, 24)}" ober="${ober.slice(0, 24)}" ` +
          `beine="${beine.slice(0, 24)}" haarfarbe="${haarfarbe.slice(0, 24)}" ` +
          `augenfarbe="${augenfarbe.slice(0, 24)}" ` +
          `— steht nicht in shared/aussehen.ts`
      );
      return;
    }
    peer.frisur = frisur;
    peer.haarfarbe = haarfarbe;
    peer.augenfarbe = augenfarbe;
    peer.ruestung = encodeArmor(parts);
    const remaining = new Set(Object.values(parts));
    for (const item of peer.inventar.all) {
      if (item.shared.ruestungsteil) item.equipped = remaining.delete(item.shared.ruestungsteil);
    }
    const charZDO = this.zdosVon(peer).getZDO(peer.characterID);
    if (charZDO) {
      charZDO.setString(FRISUR_MEMBER, frisur);
      charZDO.setString(HAARFARBE_MEMBER, haarfarbe);
      charZDO.setString(AUGENFARBE_MEMBER, augenfarbe);
      charZDO.setString(RUESTUNG_MEMBER, peer.ruestung);
    }
  }

  private handleSetFigur(peer: Peer, reader: Reader): void {
    const gewuenscht = reader.readString();
    if (!istFigur(gewuenscht)) {
      console.warn(
        `[WoV] SetFigur von "${peer.name}" abgelehnt: "${gewuenscht.slice(0, 40)}" ` +
          `steht nicht in FIGUREN (shared/figuren.ts)`
      );
      return;
    }
    if (peer.figur === gewuenscht) return;
    peer.figur = gewuenscht;
    const charZDO = this.zdosVon(peer).getZDO(peer.characterID);
    if (charZDO) charZDO.setString(FIGUR_MEMBER, gewuenscht);
    console.log(`[WoV] "${peer.name}" spielt jetzt als "${gewuenscht}"`);
  }

  /**
   * Umschichten zwischen Spieler-Inventar und einer Truhe (Roadmap F1,
   * Punkt 7: Pakete hinter die Drossel, Reichweite serverseitig
   * nachmessen — s. STANDARD_DROSSEL für ContainerAction).
   *
   * DUPLIKAT-SICHERHEIT (Punkt 5): Diese Methode läuft synchron zu Ende
   * (kein `await` zwischen Lesen und Zurückschreiben von `inv`/
   * `peer.inventar`) — Node verarbeitet ein Paket vollständig, bevor das
   * nächste an der Reihe ist. Zwei Spieler, die „gleichzeitig" in
   * dieselbe Truhe greifen, werden vom Server deshalb strikt
   * NACHEINANDER bedient, immer gegen den zu diesem Zeitpunkt echten
   * Inhalt — nie gegen einen Stand, den ein anderer Peer sich nur lokal
   * einbildet. Der zweite Zugriff sieht entweder noch genug (Erfolg) oder
   * zu wenig (Ablehnung mit Meldung) — nie eine Verdopplung.
   *
   * Bewusst NICHT gelöst: Hat ein zweiter Peer dieselbe Truhe ebenfalls
   * offen, aktualisiert sich sein Panel nicht von selbst (ContainerSync
   * geht nur an den HANDELNDEN Peer zurück, s. PacketType.ContainerSync).
   * Er merkt eine Änderung erst beim nächsten eigenen Öffnen/Zugriff —
   * dann aber garantiert korrekt, weil jede Aktion hier neu gegen den
   * echten ZDO-Member prüft statt gegen einen zwischengespeicherten
   * Client-Stand.
   */
  private handleContainerAction(peer: Peer, reader: Reader): void {
    const zdoUserId = reader.readString();
    const zdoId = reader.readInt32();
    const richtung = reader.readInt32(); // 0 = aus der Truhe nehmen, 1 = hineinlegen
    const itemName = reader.readString();
    const amount = reader.readInt32();

    const antwort = (ok: boolean, message: string) => {
      peer.sendPacketWith(PacketType.InteractResult, (w) => {
        w.writeBool(ok);
        w.writeString(message);
        w.writeString('');
        w.writeInt32(0);
      });
    };

    if (amount <= 0) return;
    const ziel = this.zdosVon(peer).getZDO(ZDOID.fromTuple(zdoUserId, zdoId));
    if (!ziel) return antwort(false, 'Truhe nicht mehr da');
    const def = this.prefabs.getByHash(ziel.prefabHash);
    if (((def?.flags ?? 0n) & PrefabFlag.CONTAINER) === 0n) return; // gefälschte ZDOID — kein Container
    // Ohne Oeffnen geht es sonst trotzdem: eine ContainerAction kennt nur die
    // ZDOID, nicht den Umweg ueber Interact.
    if (!this.darfBenutzen(ziel, peer)) return antwort(false, WovServer.FREMDER_BESITZ_MELDUNG);

    // Reichweite exakt wie handleInteract, aber gegen die ECHTE
    // ZDO-Position statt gegen einen vom Client behaupteten Punkt — ein
    // ContainerAction trägt (anders als Interact) gar keine Positionsangabe,
    // die der Client fälschen könnte (Punkt 7 der Vorgabe).
    const dx = ziel.position.x - peer.position.x;
    const dz = ziel.position.z - peer.position.z;
    if (dx * dx + dz * dz > 6 * 6) return antwort(false, 'Zu weit weg');

    const itemDef = findItem(itemName);
    if (!itemDef) return antwort(false, 'Unbekannter Gegenstand');

    const inv = unpackContainer(ziel.getString(TRUHE_INHALT_MEMBER));

    if (richtung === 0) {
      // Nehmen: aus der Truhe entfernen, dem Spieler geben. Passt nicht
      // alles ins Inventar (voll), bleibt der Rest in der Truhe — kein
      // Gegenstand geht verloren, nur die Bewegung ist teilweise
      // fehlgeschlagen.
      if (!inv.removeByName(itemName, amount)) return antwort(false, 'Nicht genug in der Truhe');
      const rest = peer.inventar.addItem(itemDef, amount);
      if (rest > 0) inv.addItem(itemDef, rest);
    } else {
      // Legen: umgekehrt — passt nicht alles in die Truhe (voll), bleibt
      // der Rest im Inventar.
      if (!peer.inventar.removeByName(itemName, amount)) return antwort(false, 'Nicht genug im Inventar');
      const rest = inv.addItem(itemDef, amount);
      if (rest > 0) peer.inventar.addItem(itemDef, rest);
    }

    ziel.setString(TRUHE_INHALT_MEMBER, packContainer(inv));
    ziel.revision.reviseData();
    ziel.dirty = true;
    this.inventarSync(peer);
    this.sendeTruheInhalt(peer, ziel);
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
  /**
   * Den Charakter eines Peers in eine andere Welt umhängen.
   *
   * Ein ZDO kann das nicht: Seine Kennung wird je ZDO-Raum vergeben, und
   * dieselbe Zahl bedeutet in zwei Welten zwei verschiedene Dinge. Der
   * Charakter bekommt deshalb in der Zielwelt ein NEUES ZDO und übernimmt
   * alle Mitglieder des alten (s. `ZDO.uebernehmeMitglieder`) — Figur,
   * Frisur, Haarfarbe, Rüstung, Name, und alles, was später dazukommt.
   *
   * Das alte wird zerstört, und zwar VOR dem Wechsel: Das füllt die
   * Zerstörungsliste der Herkunftswelt, und nur darüber erfahren die
   * Spieler, die dort zurückbleiben, dass der Mitspieler weg ist. Ohne das
   * stünde eine reglose Kopie von ihm in der Oberwelt, solange er im
   * Dungeon ist.
   */
  private charakterUmziehen(peer: Peer, ziel: Welt, pos: Vector3): void {
    const quelle = this.zdosVon(peer);
    const alt = quelle.getZDO(peer.characterID);
    const daten = alt?.toSnapshot();
    const prefabHash = alt?.prefabHash ?? 0;
    if (!peer.characterID.isNone()) quelle.destroyZDO(peer.characterID);

    peer.worldId = ziel.id;
    // A peer without a source character ZDO (an editor connection never
    // enters the world) has nothing to move: a ZDO created for it in the
    // target world would never be destroyed, because `onPeerQuit` returns
    // early for editors. `characterID` must then be cleared: ZDO ids are
    // numbered per world, so a stale id would address a foreign ZDO with the
    // same number in the next world (and get it destroyed and cloned).
    if (alt) {
      const neu = ziel.zdos.createZDO(prefabHash, pos, { x: 0, y: 0, z: 0, w: 1 });
      if (daten) neu.uebernehmeMitglieder(daten);
      neu.setOwner(new ZDOID(peer.userId, 0));
      peer.characterID = neu.zdoid;
    } else {
      peer.characterID = ZDOID.NONE;
    }

    // Das Sichtfenster gehört zur alten Welt: Es merkt sich, welche ZDOs
    // dieser Peer schon kennt, und diese Kennungen gelten drüben nicht.
    // Ohne Zurücksetzen bekäme er in der neuen Welt genau die Objekte
    // NICHT geschickt, deren Nummern er zufällig schon gesehen hat.
    peer.weltWechselVorbereiten();
  }

  private teleportPeer(
    peer: Peer,
    pos: Vector3,
    dungeonId: string | null,
    interiorEnv = '',
    worldId: string = HAUPTWELT_ID,
    /**
     * AP13: Der Layout-Deskriptor einer 2.0-Instanz — Thema, Seeds,
     * Prüfsumme, Layout-Formatversion. `null` heisst „Altbestand oder
     * Oberwelt"; der Client baut dann nichts selbst.
     *
     * ÜBER DIE LEITUNG REIST DER DESKRIPTOR, NIE GEOMETRIE. Ein Grab sind
     * hier vier Zahlen und zwei Zeichenketten statt einiger hundert
     * Kilobyte — und die Prüfsumme ist zugleich der Zeuge dafür, dass beide
     * Seiten dasselbe erzeugt haben.
     * AP13: the layout descriptor of a 2.0 instance. THE DESCRIPTOR TRAVELS
     * THE WIRE, NEVER GEOMETRY.
     */
    deskriptor: dungeon2.LayoutDeskriptor | null = null,
    /**
     * Das MITGELIEFERTE Layout eines HANDGEBAUTEN Grabs als JSON, sonst ''.
     *
     * Die Ausnahme zum Grundsatz „nie Geometrie": Ein `modus === 'gebaut'`
     * Grab traegt seine Stempel, Korrekturen, Tueren und Anker NUR im Dokument
     * — aus den Seeds ist es nicht wiederherstellbar. Reist es nicht mit, baut
     * der Client aus den Seeds das URSPRUENGLICHE Grab und wirft jede
     * Handarbeit weg (Befund 01.09.2026 — „nachtraeglich gesetzte Raeume
     * fehlen im Spiel"). Fuer erzeugte Graeber bleibt das Feld leer und die
     * Leitung so schlank wie zuvor.
     * The SHIPPED layout of a HAND-BUILT grave as JSON, else ''. The exception
     * to "never geometry": a built grave cannot be regenerated from seeds.
     */
    layoutJson = '',
    /**
     * Das dokumenteigene Steinmaterial (1.0-Dokumente) als JSON, sonst ''.
     *
     * Auch das sind reine Daten, keine Geometrie: ein paar Zahlen und drei
     * Texturnamen aus einer Erlaubnisliste. Es steht HINTER `layoutJson`,
     * weil die Reihenfolge der angehängten Felder für ältere Clients
     * unverändert bleiben muss — die hören einfach früher auf zu lesen.
     * The document's own stone material (1.0 documents) as JSON, else ''.
     * Appended BEHIND `layoutJson` so the field order stays unchanged for
     * older clients, which simply stop reading earlier.
     */
    steinKitJson = '',
    /**
     * Die Grundbeleuchtung, die in das (seit Fassung 11 bestehende) Float
     * geschrieben wird. `null` heisst „nimm die des Deskriptors" — also der
     * 2.0-Weg, unverändert.
     *
     * Ein EIGENER Parameter und KEIN zweites Feld auf der Leitung: Das Float
     * steht längst im Paket und wird für JEDES Teleport-Paket geschrieben,
     * auch für 1.0-Gräber. Ein 1.0-Grab hat nur keinen Deskriptor, aus dem
     * der Wert kommen könnte — hier reicht ihn die Aufrufstelle nach. Die
     * Reihenfolge der Felder auf der Leitung ändert sich dadurch NICHT.
     * The base brightness written into the (long existing) float. `null`
     * means "take the descriptor's" — the unchanged 2.0 path. A separate
     * parameter, not a second wire field: the float is already there, and
     * the wire order stays exactly as it was.
     */
    ambientLicht: number | null = null
  ): void {
    // Weltwechsel-Seam (Review 15): Die Signatur trägt die Zielwelt schon —
    // der eigentliche Kontext-Swap ist das Housing-Folgeprojekt.
    const weltGewechselt = worldId !== peer.worldId;
    if (weltGewechselt) {
      const ziel = this.welten.get(worldId);
      if (!ziel) {
        console.warn(`[WoV] teleportPeer: unbekannte Welt "${worldId}" — bleibe in "${peer.worldId}"`);
        return;
      }
      this.charakterUmziehen(peer, ziel, pos);
    }
    peer.position = { ...pos };
    const charZDO = this.zdosVon(peer).getZDO(peer.characterID);
    if (charZDO) {
      this.zdosVon(peer).updateZDOZone(charZDO, peer.position);
      charZDO.revision.reviseData();
      charZDO.dirty = true;
    }
    peer.sendPacketWith(PacketType.Teleport, (w) => {
      w.writeVector3(pos);
      w.writeBool(dungeonId !== null);
      w.writeString(dungeonId ?? '');
      w.writeString(interiorEnv);
      // ANGEHÄNGTE Felder (dasselbe Muster wie bei PlayerState): Ein
      // älterer Leser hört nach `interiorEnv` auf, ein neuerer liest
      // weiter. Leeres `thema` heisst „kein 2.0" — ein eigenes Flagbyte
      // wäre eine zweite Wahrheit über dieselbe Frage.
      // APPENDED fields: an empty `thema` means "not 2.0".
      w.writeString(deskriptor?.thema ?? '');
      // VORZEICHENLOS schreiben, nicht vorzeichenbehaftet.
      //
      // Die drei Seeds sind uint32 — `dungeon2.mische()` liefert sie so, und
      // `dungeon create2` erzeugt Material- und Deko-Seed genau damit. Jeder
      // zweite Seed liegt deshalb ueber 2^31-1, und `Buffer.writeInt32LE`
      // WIRFT dort, statt abzuschneiden. Die Ausnahme fliegt mitten im
      // Paketaufbau, `NetManager` wertet sie als Paketfehler und TRENNT die
      // Verbindung — der Spieler landet nach dem Auto-Reconnect wieder in der
      // Oberwelt und hat nie erfahren, warum.
      //
      // Am 29.08.2026 traf das `steingrab-2` (Deko-Seed 3333651121): Die
      // Instanz stand serverseitig fertig da (54 Stempel, 1154 Stuecke), und
      // genau das Paket, das den Client hineingeschickt haette, riss die
      // Leitung ab. Es gab keine einzige `[dungeon2]`-Zeile im Client, weil
      // dort nie etwas ankam.
      //
      // Die Leitung aendert sich dadurch NICHT: vier Bytes little-endian,
      // dieselben Bits. Der Client liest sie mit `readInt32()` und macht
      // `>>> 0` daraus (main.ts, PacketType.Teleport) — er wollte immer schon
      // uint32.
      //
      // Write UNSIGNED, not signed: the three seeds are uint32, and
      // `Buffer.writeInt32LE` THROWS above 2^31-1 rather than truncating. The
      // exception lands inside the packet build, `NetManager` reads it as a
      // packet error and DROPS the connection. Same four bytes on the wire;
      // the client already reads them as `readInt32() >>> 0`.
      w.writeUInt32(deskriptor?.seeds.architektur ?? 0);
      w.writeUInt32(deskriptor?.seeds.material ?? 0);
      w.writeUInt32(deskriptor?.seeds.deko ?? 0);
      w.writeString(deskriptor?.pruefsumme ?? '');
      w.writeInt32(deskriptor?.layoutVersion ?? 0);
      w.writeString(deskriptor?.name ?? '');
      // Grundhelligkeit (Dokumentfassung 11). Der Ersatzwert `1` bei fehlendem
      // Deskriptor ist bedeutungslos — der Client liest die angehaengten
      // Felder nur, wenn `thema` nicht leer ist —, aber er steht hier
      // ausdruecklich, damit an dieser Stelle nie eine `0` durchrutscht: `0`
      // ist im neuen Feld ein GUELTIGER Wert (stockdunkel) und damit ein
      // Ersatzwert, den man von einer Angabe nicht unterscheiden koennte.
      // Base brightness (document revision 11). The fallback is `1`, not `0`:
      // `0` is a VALID value in this field (pitch dark) and would therefore be
      // a fallback indistinguishable from a statement.
      //
      // NACHTRAG (1.0-Grundbeleuchtung, Dokumentversion 5): Der Parameter
      // `ambientLicht` schlägt den Deskriptor, denn NUR er kennt den Wert
      // eines 1.0-Dokuments — ein 1.0-Grab hat gar keinen Deskriptor. Bei
      // 2.0 gibt die Aufrufstelle `null` und alles bleibt wie zuvor.
      // ADDENDUM (1.0 base brightness): the `ambientLicht` parameter beats
      // the descriptor — only it knows a 1.0 document's value. For 2.0 the
      // caller passes `null` and nothing changes.
      w.writeFloat32(ambientLicht ?? deskriptor?.ambientLicht ?? 1);
      // ANGEHÄNGT hinter `ambientLicht` (Befund 01.09.2026): das Layout eines
      // handgebauten Grabs. Leer bei erzeugten Gräbern — dann liest der Client
      // nur einen Nullstring und baut wie bisher aus den Seeds. Ein älterer
      // Client hört nach `ambientLicht` auf; ihn stört das zusätzliche Feld
      // nicht (er liest es nie).
      // APPENDED after `ambientLicht`: the hand-built grave's layout, else ''.
      w.writeString(layoutJson);
      // ANGEHÄNGT hinter `layoutJson`: das dokumenteigene Steinmaterial eines
      // 1.0-Grabs. Leer bei 2.0-Dokumenten und bei jedem Dokument ohne das
      // Feld — dann gilt im Client wie bisher die Kit-Vorgabe. Die Stelle
      // ist bewusst die LETZTE: Alle bisherigen Felder stehen unverändert
      // davor, ein älterer Client liest dieses hier nie.
      // APPENDED after `layoutJson`: a 1.0 grave's own stone material, else
      // ''. Deliberately LAST — every previous field keeps its position.
      w.writeString(steinKitJson);
    });
    // Zurueck in der Oberwelt: Grabungen, die waehrend des Aufenthalts in der
    // Instanz geschahen, wurden ihm nicht geschickt (broadcastTerrainOps).
    // Der Endzustand ist idempotent — der Client setzt ihn, statt ihn
    // aufzuaddieren (s. sendeTerrainComps).
    if (weltGewechselt && worldId === HAUPTWELT_ID) this.sendeTerrainComps(peer);
  }

  /** Enter a dungeon instance (materializing it on first use). */
  enterDungeon(peer: Peer, dungeonId: string): { ok: boolean; message: string } {
    // VOR dem Materialisieren: Würfelt dieser Eingang bei jedem Betreten neu?
    // Die Reihenfolge ist der ganze Trick — `getOrCreateInstance` steigt bei
    // einer bestehenden Instanz sofort aus, ein Neuwürfeln danach käme also
    // nie beim Betretenden an.
    // BEFORE materialising — `getOrCreateInstance` returns early on an
    // existing instance, so a reroll after it would never reach the enterer.
    const wurf = this.dungeons.vorBetreten(dungeonId);
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
    // AP13: Bei 2.0 kommt die Innen-Umgebung aus dem THEMA statt aus dem
    // Kit — 2.0 hat keine Kits mehr. Die Aufrufstelle bleibt dieselbe, wie
    // data-model.md §4.2 es zusagt.
    // AP13: for 2.0 the interior environment comes from the THEME.
    const doc2 = this.dungeons.getDokument2(dungeonId);
    const deskriptor = doc2 ? dungeon2.deskriptorVon(doc2) : null;
    // Nur ein handgebautes Grab schickt seine Geometrie mit — ein erzeugtes
    // baut der Client deterministisch aus den Seeds. `layoutVonDokument2`
    // trifft dieselbe Fallunterscheidung server-seitig; hier reisst sie die
    // Handarbeit auf die Leitung.
    // Only a hand-built grave ships its geometry; a generated one is rebuilt
    // from seeds on the client.
    const layoutJson =
      doc2?.modus === 'gebaut' && doc2.layout ? JSON.stringify(doc2.layout) : '';
    // Das dokumenteigene Steinmaterial gehört zum 1.0-Format: 2.0 hat keine
    // Kits mehr und baut sein Material aus dem Thema. Fehlt das Feld, bleibt
    // der String leer — der Client hält dann an der Kit-Vorgabe fest.
    // The per-document stone material belongs to the 1.0 format only.
    const steinKitJson = !doc2 && doc?.steinKit ? JSON.stringify(doc.steinKit) : '';
    // Grundbeleuchtung: bei 2.0 wie bisher aus dem Deskriptor (`null` heisst
    // „nicht nachreichen"), bei 1.0 aus dem Dokument. `ambientLichtVon`
    // macht aus einem fehlenden Feld die 1 — genau EINMAL, hier.
    // Base brightness: 2.0 keeps taking it from the descriptor (`null` =
    // don't override), 1.0 takes it from the document.
    const ambientLicht = doc2 ? null : doc ? ambientLichtVon(doc) : null;
    const umgebung = doc2
      ? dungeon2.themaFinden(doc2.thema)?.innenUmgebung ?? 'Crypt'
      : doc
        ? interiorEnvironment(doc.base)
        : 'Crypt';
    this.teleportPeer(
      peer,
      this.dungeons.getSpawnPoint(instance),
      dungeonId,
      umgebung,
      // Die Welt der Instanz. Ab hier laeuft ALLES fuer diesen Peer dort:
      // ZDO-Sync, Bauen, Abbauen, Kaempfen, Gelaende — s. `welt(peer)`.
      instance.welt.id,
      deskriptor,
      layoutJson,
      steinKitJson,
      ambientLicht
    );
    // Kurze Rückmeldung, wenn wirklich neu gewürfelt wurde — sonst hielte der
    // Spieler den anderen Grundriss für einen Fehler. Der Fall 'besetzt' wird
    // ausdrücklich MITGESAGT: er erklärt, warum es diesmal derselbe Bau ist.
    const wurfHinweis = wurf.neuErzeugt
      ? ' — neu gewürfelt'
      : wurf.grund === 'besetzt'
        ? ' — unverändert, es ist noch jemand drin'
        : '';
    return {
      ok: true,
      message: `Dungeon betreten: ${doc2?.name ?? doc?.name ?? dungeonId}${wurfHinweis}`,
    };
  }

  /**
   * Wohin der Spieler nach dem Tod kommt: an sein Bett, wenn der gespeicherte
   * Punkt wirklich zu einem Bett der HAUPTWELT gehoert, sonst an den Weltspawn.
   *
   * Der Punkt ist eine nackte Koordinate ohne Welt. Zwei Wege fuehrten damit an
   * eine falsche Stelle der Oberwelt: ein Punkt im Koordinatenband der
   * Instanzen (Altbestand vor B8, `isInDungeonBand`) und ein Punkt aus einer
   * Instanz, die seit B8 am Ursprung liegt (Bett dort gesetzt, bevor es
   * verboten wurde) — beide waeren in der Oberwelt Boden oder Luft. Deshalb
   * gilt er nur, wenn im ZDO-Raum der Hauptwelt an genau dieser Stelle ein
   * Bett steht. Ein abgerissenes Bett gilt damit nicht mehr: der Spieler
   * erwacht am Weltspawn statt an einer leeren Stelle.
   */
  private wiedereinstiegspunkt(peer: Peer): Vector3 {
    const punkt = peer.spawnPoint;
    if (!punkt) return this.weltSpawn();
    if (isInDungeonBand(punkt.x)) {
      peer.spawnPoint = null;
      peer.spawnBettId = '';
      return this.weltSpawn();
    }
    const istBett = (zdo: ZDO): boolean =>
      ((this.prefabs.getByHash(zdo.prefabHash)?.flags ?? 0n) & PrefabFlag.BED) !== 0n;
    // Ein Layout-Bett zieht beim Start mit dem Gelaende mit (Abgleich, nur die
    // Hoehe). Damit der Punkt mitzieht, ohne fremde Betten zu oeffnen, merkt er
    // sich die Kennung dieses einen Bettes und sucht beim Tod genau dieses;
    // eine x/z-Saeule wird nicht durchsucht. Ist es nicht genau eines, gilt
    // der Punkt nicht (lieber verwerfen und melden als still tauschen).
    if (peer.spawnBettId) {
      const treffer = this.zdos
        .getZDOsInRadius(punkt, 2)
        .filter((z) => istBett(z) && !istSpielerbau(z) && z.getString(LAYOUT_ID_MEMBER) === peer.spawnBettId);
      const bett = treffer.length === 1 ? treffer[0]! : null;
      if (!bett) {
        peer.spawnPoint = null;
        peer.spawnBettId = '';
        return this.weltSpawn();
      }
      const ziel = { x: bett.position.x, y: bett.position.y + 0.6, z: bett.position.z };
      peer.spawnPoint = { ...ziel };
      return ziel;
    }
    // Ein Spielerbett wandert nie: der Punkt gilt nur, wenn an genau dieser
    // Stelle ein Bett des gemerkten Besitzers steht (wie vor dem Mitziehen,
    // dazu der Besitzer: ein fremdes Bett daneben zaehlt nicht). Verglichen wird
    // mit dem Besitzer, den das Bett beim Setzen trug, nicht mit der userId des
    // Toten. Ein Punkt aus einem Stand davor (null) gilt wie bisher.
    for (const zdo of this.zdos.getZDOsInRadius(punkt, 2)) {
      if (!istBett(zdo)) continue;
      if (peer.spawnBettBesitzer !== null && zdo.getString('besitzer') !== peer.spawnBettBesitzer) continue;
      if (
        Math.abs(zdo.position.x - punkt.x) < 0.05 &&
        Math.abs(zdo.position.z - punkt.z) < 0.05 &&
        Math.abs(zdo.position.y + 0.6 - punkt.y) < 0.05
      ) {
        return punkt;
      }
    }
    peer.spawnPoint = null;
    return this.weltSpawn();
  }

  /**
   * Leave the current dungeon back to the stored overworld position — or to
   * `ziel`, when the caller already knows where the player belongs (death).
   */
  leaveDungeon(peer: Peer, ziel?: Vector3): { ok: boolean; message: string } {
    if (!peer.dungeonId) {
      return { ok: false, message: 'Du bist in keinem Dungeon' };
    }
    this.dungeons.getInstance(peer.dungeonId)?.players.delete(peer.name);
    peer.dungeonId = null;
    const back = ziel ?? peer.dungeonReturn ?? { x: 0, y: this.getGroundHeight(0, 0), z: 0 };
    peer.dungeonReturn = null;
    this.teleportPeer(peer, back, null, '', HAUPTWELT_ID);
    return { ok: true, message: 'Dungeon verlassen' };
  }

  /**
   * `admin <sub> ...` — dauerhafte Admin-Liste ueber stabile Spieler-IDs
   * (Roadmap S6, Security-Review):
   *
   *   admin liste              alle dauerhaften Admins (Name + spielerId)
   *   admin add <Name>         Spieler dauerhaft zum Admin machen
   *   admin remove <Name>      Spieler wieder entfernen
   *
   * Laeuft wie jeder andere Admin-Befehl durch canUseAdminCommands()
   * (peer.isAdmin), ganz bewusst: das Recht, die Liste zu PFLEGEN, ist
   * selbst ein Admin-Recht. Seit Paket 0.1 (everyone-admin: false)
   * entscheidet ausschliesslich noch diese Liste, wer diesen Befehl (und
   * alle anderen) ueberhaupt nutzen darf — und ihr erster Eintrag kommt
   * vom Adminkonto aus `standard-konto:` (StandardKonto.ts), weil sich
   * eine leere Liste sonst nie fuellen liesse.
   *
   * Namensaufloesung ueber spielerIdFuerName(): der Zielspieler muss
   * schon einmal verbunden gewesen sein (online ODER in savedPlayers) —
   * ein rein erfundener Name kann nicht zum Admin gemacht werden, es gibt
   * dafuer keine spielerId zum Eintragen.
   */
  private registerAdminListeCommands(): void {
    this.adminCommands.register('admin', (peer, args) => {
      const sub = (args.shift() ?? '').toLowerCase();

      if (sub === 'liste' || sub === 'list') {
        const eintraege = this.adminListe.alle();
        if (eintraege.length === 0) {
          return { ok: true, active: false, message: 'Admin-Liste ist leer' };
        }
        const zeilen = eintraege.map((e) => `${e.name} [${e.spielerId}]`).join(', ');
        return { ok: true, active: false, message: `${eintraege.length} dauerhafte Admins: ${zeilen}` };
      }

      if (sub === 'add' || sub === 'hinzufuegen') {
        const name = args.join(' ').trim();
        if (!name) return { ok: false, active: false, message: 'Aufruf: admin add <Name>' };
        const id = this.spielerIdFuerName(name);
        if (!id) {
          return { ok: false, active: false,
            message: `Unbekannter Spieler: "${name}" (muss schon einmal verbunden gewesen sein)` };
        }
        const neu = this.adminListe.hinzufuegen(id, name);
        // Sofort an den offenen Sitzungen nachziehen — in BEIDE
        // Richtungen, Begruendung bei gleicheAdminrechteAb().
        if (neu) this.gleicheAdminrechteAb();
        return { ok: true, active: false,
          message: neu ? `${name} [${id}] ist jetzt dauerhaft Admin` : `${name} war schon Admin` };
      }

      if (sub === 'remove' || sub === 'entfernen') {
        const name = args.join(' ').trim();
        if (!name) return { ok: false, active: false, message: 'Aufruf: admin remove <Name>' };
        const id = this.spielerIdFuerName(name);
        if (!id) {
          return { ok: false, active: false, message: `Unbekannter Spieler: "${name}"` };
        }
        /*
          Der LETZTE Admin darf sich nicht selbst aussperren.

          Dieselbe Bremse steht schon beim `bann`-Befehl, und aus genau
          demselben Grund (dort ausfuehrlich begruendet): Seit
          `everyone-admin: false` ist diese Liste der einzige Weg zu
          Rechten, und `admin add` braucht einen Admin. Wer den letzten
          Eintrag entfernt, hat einen Server ohne jeden Admin — zurueck
          kommt man nur noch ueber die Datei auf der Platte oder die
          Adminroute des Betriebsdienstes, also nur mit Zugang zur
          Maschine. Das ist eine Huerde in der Bedienung, keine Ausnahme
          in der Berechtigung: Wer wirklich alle Admins loswerden will,
          traegt vorher einen zweiten ein und entfernt dann beide, oder
          er nimmt den Weg ueber den Betriebsdienst.
        */
        if (this.adminListe.enthaelt(id) && this.adminListe.anzahl <= 1) {
          return { ok: false, active: false,
            message: `${name} ist der letzte Admin. Erst "admin add <Name>" fuer jemand anderen, sonst steht der Server ohne Admin da.` };
        }
        const weg = this.adminListe.entfernen(id);
        // Wirkung SOFORT, nicht erst beim naechsten Anmelden: Ein
        // uebernommenes Adminkonto ist genau der Fall, in dem man nicht
        // warten kann, bis der andere von sich aus die Verbindung
        // beendet (Befund 3).
        if (weg) this.gleicheAdminrechteAb();
        return { ok: true, active: false,
          message: weg ? `${name} [${id}] ist kein dauerhafter Admin mehr` : `${name} war nicht in der Admin-Liste` };
      }

      return { ok: false, active: false,
        message: 'Aufruf: admin liste | admin add <Name> | admin remove <Name>' };
    });
  }

  /**
   * Die Rechte OFFENER Sitzungen an die Adminliste angleichen.
   * Re-check every open session against the admin list.
   *
   * ── Das Problem ─────────────────────────────────────────────────────
   * `peer.isAdmin` entstand bisher genau EINMAL, im Handshake
   * (NetManager.handlePasswordAuth), und wurde danach nie wieder gegen
   * die Liste gehalten. Ein Angreifer-Skript hat auf EINER offenen
   * Verbindung `admin remove Admin` ausgefuehrt — Liste danach
   * nachweislich leer — und unmittelbar danach, ohne neu zu verbinden,
   * `fly` benutzt: "Fly mode ON" (Befund 3, 13.09.2026). Ein
   * uebernommenes Adminkonto blieb also bis zum SELBSTGEWAEHLTEN
   * Verbindungsende voll handlungsfaehig, und das ist genau der Fall, in
   * dem man sofortige Wirkung braucht.
   *
   * ── Warum nachziehen und nicht trennen ──────────────────────────────
   * `bann` und `kick` trennen (net.trenneGebannte()), weil dort die
   * PERSON weg soll. Hier soll sie bleiben: `admin remove` nimmt Rechte,
   * kein Spielrecht — wer gerade in einem Dungeon steht, soll dafuer
   * nicht aus der Welt fliegen. Getrennt wird deshalb nicht; entzogen
   * wird sofort. Der Unterschied zu heute ist nicht die Haerte, sondern
   * dass der stille Zustand "Liste sagt nein, Sitzung sagt ja" nicht
   * mehr existiert.
   *
   * Der Flug hoert mit dem Recht auf: Er ist die einzige Adminwirkung,
   * die OHNE weiteren Befehl weiterlaeuft (handlePlayerInput fragt nur
   * `peer.flying` ab, nicht `peer.isAdmin`) — bliebe er stehen, koennte
   * ein Entzogener die Welt weiter ueberfliegen.
   *
   * ── Beide Richtungen ────────────────────────────────────────────────
   * Auch das Hinzufuegen wirkt sofort. Dieselbe Begruendung von der
   * anderen Seite: "Liste sagt ja, Sitzung sagt nein" ist genauso
   * unerklaerlich, und ein frisch ernannter Admin, der sich erst neu
   * verbinden muss, ist einfach nur kaputt.
   *
   * Aufgerufen von `admin add`/`admin remove` und im Sekundentakt aus
   * update(). Der Takt ist noetig, weil die Liste auch von AUSSEN
   * wandert (Adminroute des Betriebsdienstes, Handanlegen an der Datei —
   * AdminListe.abgleichen liest die Datei dann neu ein); ohne ihn
   * bliebe die Luecke fuer genau diese Wege offen. Er kostet eine
   * `alle()`-Abfrage je Sekunde, also ein statSync und im Regelfall
   * keinen einzigen Dateizugriff mehr.
   */
  private gleicheAdminrechteAb(): void {
    // Bei `everyone-admin: true` ist die Liste nicht das Tor (s.
    // NetManager.handlePasswordAuth: ODER-Verknuepfung). Dann darf ein
    // fehlender Listeneintrag auch keine Rechte wegnehmen.
    if (this.config.everyoneAdmin) return;
    const berechtigt = new Set(this.adminListe.alle().map((e) => e.spielerId));
    for (const peer of this.net.getPeers()) {
      // Ohne spielerId gibt es nichts abzugleichen (noch nicht
      // angemeldet) — und ein leerer String darf nie in der Menge
      // stehen, sonst haengte die Berechtigung an einer Leerstelle.
      if (!peer.spielerId) continue;
      const soll = berechtigt.has(peer.spielerId);
      if (soll === peer.isAdmin) continue;
      peer.isAdmin = soll;
      if (!soll && peer.flying) {
        peer.flying = false;
        peer.sendPacketWith(PacketType.AdminEvent, (w) => {
          w.writeString('fly');
          w.writeBool(false);
          w.writeString('Fly mode OFF (Adminrechte entzogen)');
        });
      }
      peer.sendPacketWith(PacketType.AdminEvent, (w) => {
        w.writeString('admin');
        w.writeBool(false);
        w.writeString(soll ? 'Du hast jetzt Adminrechte.' : 'Deine Adminrechte wurden entzogen.');
      });
      console.log(`[Admin] "${peer.name}" — Rechte an der Liste nachgezogen: isAdmin=${soll}`);
    }
  }

  /**
   * `kick` / `bann` / `entbann` — die Bedienoberflaeche der Bannliste
   * (Paket 0.5; die Datenhaltung steht in Kontendatenbank.ts, das
   * Hinauswerfen in NetManager.trenneGebannte()).
   *
   * Warum diese drei zusammen in einer Methode stehen: `kick` ohne `bann`
   * ist eine Bitte (der Geworfene verbindet sich sofort wieder), `bann`
   * ohne `kick` erwischt den nicht, der schon drin ist. Beide teilen sich
   * dieselbe Namensaufloesung, und die ist der eigentliche Inhalt.
   *
   * ── Namensaufloesung: Konto zuerst, spielerId als Rueckfall ──────────
   * Ein Admin tippt einen Namen. Gemeint ist fast immer die PERSON, nicht
   * die eine Figur — deshalb loest `bann` ueber die Kontendatenbank auf
   * und bannt das KONTO, was alle Charaktere dieser Person einschliesst,
   * auch die, die gerade nicht online sind. Nur wenn zu dem Namen gar
   * kein Konto gehoert (eine Verbindung ohne Anmeldung bekommt eine
   * gewuerfelte spielerId und keine Kontozeile), faellt der Befehl auf
   * einen Spielerbann zurueck. Beides findet auch Abwesende: die
   * Kontendatenbank ueber `charakterNachName`, der Rueckfall ueber
   * `spielerIdFuerName` (online ODER savedPlayers).
   *
   * ── Gilt ein Bann auch fuer einen Admin? JA ─────────────────────────
   * Strukturell: die Bannpruefung im Handshake laeuft VOR der Zeile, die
   * `peer.isAdmin` setzt (NetManager.handlePasswordAuth) — ein gebannter
   * Admin kommt nicht herein, und das soll auch so sein. Ein
   * uebernommenes Adminkonto ist genau der Fall, in dem man einen Bann
   * BRAUCHT, und eine Ausnahme waere die einzige Luecke, die niemand
   * schliessen koennte.
   *
   * Die Gegenprobe ist trotzdem noetig, denn seit `everyone-admin: false`
   * ist die Adminliste der einzige Weg zu Rechten: wer den letzten Admin
   * bannt, hat den Server dauerhaft ohne Admin, und `admin add` braucht
   * einen Admin. Deshalb LEHNT DER BEFEHL ab, wenn das Ziel auf der
   * Adminliste steht (oder man selbst ist) und verlangt vorher
   * `admin remove <Name>`. Das ist eine Huerde in der Bedienung, keine
   * Ausnahme in der Berechtigung — ein Bann, der auf anderem Weg in die
   * Datenbank kommt, wirkt gegen jeden.
   *
   * ── Herkunftsbann ───────────────────────────────────────────────────
   * `bann herkunft <Name> ...` bannt die Adresse einer GERADE OFFENEN
   * Verbindung (NetManager.herkunftVon). Nur online, absichtlich: eine
   * Adresse, die man nicht mehr sieht, ist geraten. Sie wird auch nicht
   * zurueckgemeldet — die Ablehnung nennt den Spielernamen, nicht die IP.
   */
  private registerBannCommands(): void {
    /** `30m`, `2h`, `7d`, `dauerhaft`/`permanent` → ms-Zeitpunkt oder null. */
    const fristLesen = (wort: string): { bis: number | null } | null => {
      const w = wort.toLowerCase();
      if (w === 'dauerhaft' || w === 'permanent' || w === 'immer') return { bis: null };
      const m = /^(\d+)(m|h|d|t)$/.exec(w);
      if (!m) return null;
      const zahl = Number(m[1]);
      if (zahl <= 0) return null;
      const faktor = m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000;
      return { bis: Date.now() + zahl * faktor };
    };

    const fristText = (bis: number | null): string =>
      bis === null ? 'dauerhaft' : `bis ${new Date(bis).toLocaleString('de-DE')}`;

    /**
     * Steht zu diesem Bannziel ein Eintrag auf der Adminliste? Bei einem
     * Kontobann werden ALLE Charaktere des Kontos geprueft — sonst
     * schuetzt die Huerde nur den einen Namen, der getippt wurde, und der
     * Zweitcharakter desselben Admins faellt still mit.
     */
    const trifftAdmin = (art: BannArt, wert: string, kontoId: number | null): boolean => {
      if (art === 'spieler') return this.adminListe.enthaelt(wert as SpielerId);
      if (art === 'konto' && kontoId !== null) {
        return this.kontenDb
          .charaktereVonKonto(kontoId)
          .some((c) => this.adminListe.enthaelt(c.spielerId));
      }
      return false;
    };

    this.adminCommands.register('kick', (peer, args) => {
      const name = args.join(' ').trim();
      if (!name) return { ok: false, active: false, message: 'Aufruf: kick <Name>' };
      if (name === peer.name) {
        return { ok: false, active: false, message: 'Dich selbst kannst du nicht werfen' };
      }
      const getroffen = this.net.kick(name);
      return getroffen
        ? { ok: true, active: false, message: `${name} wurde getrennt (kein Bann — er kann sofort wiederkommen)` }
        : { ok: false, active: false, message: `${name} ist nicht verbunden` };
    });

    this.adminCommands.register('bann', (peer, args) => {
      const sub = (args[0] ?? '').toLowerCase();

      if (sub === 'liste' || sub === 'list') {
        const banns = this.kontenDb.bannListe();
        if (banns.length === 0) return { ok: true, active: false, message: 'Keine wirksamen Banns' };
        // Der rohe Wert eines Kontobanns ist eine Zeilennummer ("konto 1")
        // — damit laesst sich `entbann` nicht bedienen. Wo es einen
        // Benutzernamen gibt, steht deshalb der.
        const zeilen = banns
          .map((b) => {
            const klar = b.art === 'konto'
              ? this.kontenDb.kontoNachId(Number(b.wert))?.benutzername ?? b.wert
              : b.wert;
            return `${b.art} ${klar} (${fristText(b.bis)}${b.grund ? `, ${b.grund}` : ''})`;
          })
          .join('; ');
        return { ok: true, active: false, message: `${banns.length} Banns: ${zeilen}` };
      }

      const aufHerkunft = sub === 'herkunft' || sub === 'ip';
      const rest = aufHerkunft ? args.slice(1) : args;
      const name = (rest.shift() ?? '').trim();
      if (!name) {
        return { ok: false, active: false,
          message: 'Aufruf: bann <Name> [30m|2h|7d|dauerhaft] [Grund] | bann herkunft <Name> ... | bann liste' };
      }
      if (name === peer.name) {
        return { ok: false, active: false, message: 'Dich selbst kannst du nicht bannen' };
      }

      // Frist ist optional und steht, wenn ueberhaupt, direkt hinter dem
      // Namen. Ist das naechste Wort keine Frist, gehoert es zum Grund —
      // sonst muesste jeder Bann eine Frist mitschleppen, nur damit ein
      // Grund dahinter passt.
      let bis: number | null = null;
      if (rest.length > 0) {
        const frist = fristLesen(rest[0]!);
        if (frist) { bis = frist.bis; rest.shift(); }
      }
      const grund = rest.join(' ').trim();

      let art: BannArt;
      let wert: string;
      let kontoId: number | null = null;
      if (aufHerkunft) {
        const ziel = this.net.getPeers().find((p) => p.name === name);
        if (!ziel) {
          return { ok: false, active: false,
            message: `${name} ist nicht verbunden — eine Herkunft laesst sich nur an einer offenen Verbindung ablesen` };
        }
        const herkunft = this.net.herkunftVon(ziel);
        if (!herkunft) {
          return { ok: false, active: false, message: `Herkunft von ${name} ist unbekannt` };
        }
        art = 'herkunft';
        wert = herkunft;
      } else {
        const charakter = this.kontenDb.charakterNachName(name);
        if (charakter) {
          art = 'konto';
          wert = String(charakter.kontoId);
          kontoId = charakter.kontoId;
        } else {
          const id = this.spielerIdFuerName(name);
          if (!id) {
            return { ok: false, active: false,
              message: `Unbekannter Spieler: "${name}" (kein Konto dieses Namens und nie verbunden gewesen)` };
          }
          art = 'spieler';
          wert = id;
        }
      }

      if (trifftAdmin(art, wert, kontoId)) {
        return { ok: false, active: false,
          message: `${name} steht auf der Admin-Liste. Erst "admin remove ${name}", dann bannen — sonst sperrt man sich womoeglich den letzten Admin aus.` };
      }

      this.kontenDb.bannSetzen(art, wert, { grund, gesetztVon: peer.name, bis });
      // NACH dem Eintrag: trenneGebannte() fragt dieselbe Funktion wie der
      // Handshake und erwischt damit auch den Zweitcharakter desselben
      // Kontos, der nebenher online ist.
      const getroffen = this.net.trenneGebannte();
      const wen = getroffen.length > 0 ? ` — getrennt: ${getroffen.map((p) => p.name).join(', ')}` : '';
      const wasText = art === 'herkunft' ? `Herkunft von ${name}` : art === 'konto' ? `Konto von ${name}` : name;
      return { ok: true, active: false,
        message: `${wasText} gebannt (${fristText(bis)}${grund ? `, ${grund}` : ''})${wen}` };
    });

    this.adminCommands.register('entbann', (_peer, args) => {
      const sub = (args[0] ?? '').toLowerCase();
      const aufHerkunft = sub === 'herkunft' || sub === 'ip';
      const rest = aufHerkunft ? args.slice(1) : args;
      const name = rest.join(' ').trim();
      if (!name) {
        return { ok: false, active: false,
          message: 'Aufruf: entbann <Name> | entbann herkunft <Adresse>' };
      }

      // Bei einer Herkunft ist der getippte Text schon der Wert — die
      // Adresse steht in `bann liste`, und der Gebannte ist ja gerade
      // NICHT verbunden, also gibt es nichts abzulesen.
      if (aufHerkunft) {
        const weg = this.kontenDb.bannAufheben('herkunft', name);
        return { ok: weg, active: false,
          message: weg ? `Herkunftsbann auf ${name} aufgehoben` : `Kein Herkunftsbann auf ${name}` };
      }

      // Beide Arten probieren, in derselben Reihenfolge, in der `bann`
      // sie vergibt — der Admin soll nicht wissen muessen, ob sein
      // Gegenueber damals ein Konto hatte.
      const charakter = this.kontenDb.charakterNachName(name);
      if (charakter && this.kontenDb.bannAufheben('konto', String(charakter.kontoId))) {
        return { ok: true, active: false, message: `Kontobann auf ${name} aufgehoben` };
      }
      const id = this.spielerIdFuerName(name);
      if (id && this.kontenDb.bannAufheben('spieler', id)) {
        return { ok: true, active: false, message: `Spielerbann auf ${name} aufgehoben` };
      }
      return { ok: false, active: false, message: `Kein Bann auf ${name} gefunden` };
    });
  }

  /**
   * `marke liste` / `marke setzen <Name>` — Fortschrittsmarken (F5) von
   * Hand setzen und anzeigen. Ueber peer.isAdmin gegated (der einzige Weg
   * zu dieser Methode ist AdminCommandRegistry.execute(), das jeden
   * Befehl schon vor dem Dispatch gegen canUseAdminCommands prueft) —
   * nicht jeder Spieler soll sich selbst die Boss-Progression schenken.
   *
   * Bewusst NUR die Fortschrittsmarken-Haelfte von GlobalKey bedient, s.
   * Kopfkommentar von shared/src/types.ts und WeltMarken.ts — die
   * Weltmodifikator-Haelfte (WorldLevel, PlayerDamage, ...) ist
   * Welterzeugungs-Konfiguration und gehoert nicht in einen
   * Laufzeit-Befehl.
   */
  private registerMarkeCommand(): void {
    this.adminCommands.register('marke', (_peer, args) => {
      const sub = (args.shift() ?? '').toLowerCase();

      if (sub === 'liste' || sub === 'list') {
        const namen = this.weltMarken.alsNamen();
        return {
          ok: true,
          active: false,
          message:
            namen.length > 0
              ? `${namen.length} gesetzte Marke(n): ${namen.join(', ')}`
              : 'Keine Marke gesetzt',
        };
      }

      if (sub === 'setzen' || sub === 'set') {
        const name = args[0];
        if (!name) {
          return { ok: false, active: false, message: 'Aufruf: marke setzen <Name>' };
        }
        const marke = globalKeyVonName(name);
        if (marke === undefined) {
          return { ok: false, active: false, message: `Unbekannte Marke: "${name}"` };
        }
        const neu = this.weltMarken.setzen(marke);
        return {
          ok: true,
          active: false,
          message: neu
            ? `Marke "${GlobalKey[marke]}" gesetzt`
            : `Marke "${GlobalKey[marke]}" war schon gesetzt`,
        };
      }

      return { ok: false, active: false, message: 'Aufruf: marke liste | marke setzen <Name>' };
    });
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
      for (const zdo of this.zdosVon(peer).getZDOsInRadius(peer.position, radius)) {
        if (zdo.prefabHash !== prefab.hash) continue;
        this.zdosVon(peer).destroyZDO(zdo.zdoid);
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
    // item give <Name> [Anzahl] — legt einen Gegenstand ins eigene
    // Inventar (10.09.2026). Gebaut, damit bestehende Charaktere, die die
    // Startausruestung laengst haben, neue Gegenstaende wie das Nordschwert
    // zum Ausprobieren bekommen, ohne dass man den Spielstand anfasst.
    this.adminCommands.register('item', (peer, args) => {
      const sub = (args.shift() ?? '').toLowerCase();
      // Explicit, idempotent test-set delivery, including offline characters.
      // Stage the whole inventory first: a full bag must never get half a set.
      if (sub === 'ironward' || sub === 'wildwarden') {
        const parts = sub === 'ironward' ? IRONWARD_PARTS : WILDWARDEN_PARTS;
        const label = sub === 'ironward' ? 'Ironward' : 'Waldhüter';
        if (this.speichertGerade) return { ok: false, active: false, message: 'Sicherung läuft; bitte gleich erneut versuchen. Nichts verändert.' };
        const name = args.join(' ').trim();
        if (!name) return { ok: false, active: false, message: `Aufruf: item ${sub} <Spielername>` };
        const online = this.net.getPeers().filter(p => !p.nurEditor && p.name.toLowerCase() === name.toLowerCase());
        const saved = [...this.savedPlayers.entries()].filter(([, p]) => p.name.toLowerCase() === name.toLowerCase());
        if (online.length > 1 || (!online.length && saved.length !== 1)) return { ok: false, active: false, message: 'Spieler nicht eindeutig gefunden' };
        const target = online[0]; const record = saved[0];
        if ((target?.figur ?? record?.[1].figur) !== 'wikinger') return { ok: false, active: false, message: `${label} benötigt den männlichen Wikinger-Körper` };
        const snapshot = target?.inventar.serialize() ?? record?.[1].inventar;
        if (!snapshot) return { ok: false, active: false, message: 'Kein gespeichertes Inventar vorhanden' };
        const staged = new Inventory(); staged.load(snapshot); let added = 0;
        for (const part of parts) {
          if (staged.countOf(part.item)) continue;
          if (staged.addItem(findItem(part.item)!, 1)) return { ok: false, active: false, message: 'Nicht genug Platz für das vollständige Set; nichts verändert' };
          added++;
        }
        if (target) { target.inventar.load(staged.serialize()); this.inventarSync(target); }
        else record![1].inventar = staged.serialize();
        void this.saveWorldAsync();
        return { ok: true, active: false, message: `${name}: ${label} vollständig (7/7), ${added} neue Gegenstände. Sicherung angefordert.` };
      }
      if (sub !== 'give' && sub !== 'gib') {
        return { ok: false, active: false, message: 'Aufruf: item give <Name> [Anzahl]' };
      }
      const name = args[0];
      if (!name) return { ok: false, active: false, message: 'Aufruf: item give <Name> [Anzahl]' };
      const def = findItem(name)
        ?? ITEM_DEFS.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (!def) return { ok: false, active: false, message: `Unbekannter Gegenstand: ${name}` };
      const menge = Math.max(1, Math.floor(Number(args[1]) || 1));
      const rest = peer.inventar.addItem(def, menge);
      this.inventarSync(peer);
      const drin = menge - rest;
      return { ok: drin > 0, active: false,
        message: drin > 0
          ? `${drin}× ${def.label} ins Inventar gelegt${rest > 0 ? ` (${rest} passten nicht)` : ''}`
          : `Kein Platz im Inventar für ${def.label}` };
    });

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
      // aber falsch: WATER_LEVEL ist die aus der radialen Weltgenerierung
      // übernommene Konstante 30, das Gelände dieser Welt liegt bei rund -55. Der Ausdruck
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

      const zdo = this.zdosVon(peer).createZDO(prefab.hash, { x, y, z });
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
   *   dungeon create2 <theme> [seed] [id] [ambient]
   *                                     generate + save a 2.0 document;
   *                                     `ambient` is the base brightness
   *                                     0..1 (0 = pitch dark, only the
   *                                     placed light sources). Omitted =
   *                                     the theme's default.
   *   dungeon enter [id]                enter by id, or the nearest entrance
   *   dungeon leave                     back to the overworld
   *   dungeon assign <id>               assign nearest entrance (≤16 m) to id
   *   dungeon entrance-mode <id> <fixed|regen>
   *                                     'regen' makes the entrance pointing at
   *                                     <id> reroll its layout on every enter
   *                                     (skipped while someone is inside);
   *                                     'fixed' restores the default. Needs a
   *                                     DG_* recipe — for an entrance wired by
   *                                     `assign` it is taken from the document.
   *   dungeon regen <id> [seed]         re-generate a 'generated' document
   *   dungeon steinkit <id> wand=<name> decke=<name> boden=<name>
   *                         moos=<0..4> frost=<0..4> nass=<0..4>
   *                                     set the 1.0 document's own stone
   *                                     material; texture NAMES (no paths)
   *                                     out of `STEIN_TEXTUREN`.
   *                                     `dungeon steinkit <id> reset` clears
   *                                     it (back to the kit default).
   *   dungeon licht <id> <0..3>         set the 1.0 document's base
   *                                     brightness — a FACTOR on the world
   *                                     lighting: 1 = as before, <1 darker,
   *                                     >1 brighter. `dungeon licht <id>
   *                                     reset` clears it (back to 1); with no
   *                                     value it just reports the current one.
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

    // ── Aufraeumen von Spieler-Datensaetzen (17.08.2026) ─────────────
    //
    // Anlass: Eine Nacht Grafik-Messreihen hat rund zehn Bot-Spieler in
    // der DEV-Welt hinterlassen (RieselBot, Kombi768, Fern601, Tex915 …).
    // `savedPlayers` waechst monoton — jeder Name, der sich je verbunden
    // hat, bleibt in der `players[]`-Sektion, bis ihn jemand entfernt.
    // Auf einer Entwicklungswelt, auf der Testverbindungen die Regel sind,
    // ist das kein Ausnahmefall, sondern der Normalbetrieb.
    //
    // `spieler liste` zeigt, was da ist. `spieler entfernen <name>…` nimmt
    // gezielt Namen heraus — bewusst NUR namentlich, kein Muster und kein
    // "alle ausser mir": Ein Tippfehler in einem Glob loescht sonst
    // Spielstaende, und fuer diese Welt gibt es kein Backup (Roadmap S2).
    // Verbundene Spieler werden uebersprungen; ihr Datensatz wuerde beim
    // naechsten Speichern ohnehin sofort neu geschrieben.
    //
    // F3 (Security-Review): `savedPlayers` ist mittlerweile ueber die
    // stabile spielerId geschluesselt, nicht mehr ueber den Namen — diese
    // Befehle bleiben trotzdem namentlich (so denkt Mike ueber Spieler)
    // und loesen intern ueber das `name`-Feld der Datensaetze auf.
    // `spieler online` zeigt zusaetzlich die spielerId JEDES verbundenen
    // Spielers (S6: Grundlage fuer `admin add <Name>`).
    this.adminCommands.register('spieler', (peer, args) => {
      const sub = (args.shift() ?? 'liste').toLowerCase();
      if (sub === 'liste') {
        const namen = [...this.savedPlayers.values()].map((p) => p.name).sort();
        return { ok: true, active: false,
          message: `${namen.length} Datensaetze: ${namen.join(', ')}` };
      }
      if (sub === 'online') {
        const zeilen = this.net.getPeers().map(
          (p) => `${p.name} [${p.spielerId}]${p.isAdmin ? ' (admin)' : ''}`
        );
        return { ok: true, active: false,
          message: zeilen.length ? zeilen.join(' | ') : 'Niemand online' };
      }
      if (sub === 'entfernen') {
        if (args.length === 0) {
          return { ok: false, active: false, message: 'Aufruf: spieler entfernen <name> [<name> …]' };
        }
        const verbunden = new Set(this.net.getPeers().map((p) => p.name));
        const weg: string[] = [];
        const uebersprungen: string[] = [];
        for (const name of args) {
          if (verbunden.has(name)) { uebersprungen.push(`${name} (verbunden)`); continue; }
          const treffer = [...this.savedPlayers.entries()].find(([, p]) => p.name === name);
          if (!treffer) { uebersprungen.push(`${name} (unbekannt)`); continue; }
          this.savedPlayers.delete(treffer[0]);
          weg.push(name);
        }
        const rest = this.savedPlayers.size;
        return { ok: true, active: false,
          message: `Entfernt: ${weg.length ? weg.join(', ') : '—'}` +
            (uebersprungen.length ? ` | Uebersprungen: ${uebersprungen.join(', ')}` : '') +
            ` | Noch ${rest} Datensaetze (wird beim naechsten Speichern geschrieben)` };
      }
      return { ok: false, active: false, message: 'Aufruf: spieler liste | spieler online | spieler entfernen <name> …' };
    });

    this.adminCommands.register('dungeon', (peer, args) => {
      const sub = (args.shift() ?? 'list').toLowerCase();

      switch (sub) {
        case 'list': {
          const docs = this.dungeons.listDocuments();
          const docs2 = this.dungeons.listDokumente2();
          if (docs.length === 0 && docs2.length === 0) {
            return { ok: true, active: false, message: 'Keine Dungeons vorhanden' };
          }
          const aktiv = (id: string): string => {
            const inst = this.dungeons.getInstance(id);
            return inst ? ` [aktiv, ${inst.players.size} Spieler]` : '';
          };
          const lines = [
            ...docs.map(
              (d) => `${d.id} (${d.base}, ${d.mode}, ${d.layout.rooms.length} Räume)${aktiv(d.id)}`
            ),
            // 2.0 zählt keine Räume, sondern Stempel — und das Dokument
            // kennt sie gar nicht, es kennt nur das Rezept. Was hier steht,
            // ist deshalb das Rezept, nicht sein Ergebnis.
            // 2.0 documents know the recipe, not its result.
            ...docs2.map(
              (d) =>
                `${d.id} (2.0, ${d.thema}, ${d.modus}, Seeds ` +
                `${d.seeds.architektur}/${d.seeds.material}/${d.seeds.deko}, ` +
                `Prüfsumme ${d.pruefsumme})${aktiv(d.id)}`
            ),
          ];
          return { ok: true, active: false, message: lines.join(' | ') };
        }

        // AP13: Ein 2.0-Dokument anlegen. Eigener Unterbefehl statt eines
        // Schalters an `create`: Die beiden Formate teilen sich kein
        // Argument — dort ein Kit, hier ein Thema — und ein Befehl, dessen
        // Argumente von einem Schalter abhängen, ist ein Befehl, den man
        // falsch aufruft.
        // AP13: create a 2.0 document. Its own sub-command, because the two
        // formats share no argument.
        case 'create2': {
          const thema = (args[0] ?? 'steingrab').toLowerCase();
          if (dungeon2.themaFinden(thema) === undefined) {
            const bekannt = dungeon2.THEMEN.map((t) => t.id).join(', ');
            return {
              ok: false,
              active: false,
              message: `Aufruf: dungeon create2 <thema> [seed] — bekannt: ${bekannt}`,
            };
          }
          const seed = Number.isFinite(Number(args[1]))
            ? Number(args[1]) | 0
            : (Math.random() * 0x7fffffff) | 0;
          // Drei Seeds aus einem: Wer nur eine Zahl nennt, will einen
          // reproduzierbaren Dungeon, keine Seed-Verwaltung. Gemischt statt
          // dreimal derselbe Wert — gleiche Seeds in drei Strömen wären drei
          // gleich laufende Ströme.
          // Three seeds from one — mixed, not the same value three times.
          const seeds: dungeon2.LayoutSeeds = {
            architektur: seed >>> 0,
            material: dungeon2.mische(seed, 1),
            deko: dungeon2.mische(seed, 2),
          };
          // Vierter Parameter: die Grundhelligkeit (0..1). Weggelassen heisst
          // „Vorgabe des Themas" — und `Number('')` ist 0, also wird
          // ausdrücklich auf „Argument da?" geprüft und nicht auf
          // `Number.isFinite` allein: `dungeon create2 steingrab 2 grab-2`
          // dürfte sonst ein stockdunkles Grab erzeugen, ohne dass jemand
          // eine Helligkeit genannt hätte.
          // Fourth argument: base brightness (0..1). Omitted means "theme
          // default" — checked on PRESENCE, because `Number('')` is 0 and 0 is
          // a valid brightness (pitch dark).
          const ambientRoh = args[3];
          const ambientLicht =
            ambientRoh !== undefined && Number.isFinite(Number(ambientRoh))
              ? Math.min(1, Math.max(0, Number(ambientRoh)))
              : undefined;
          const doc = this.dungeons.erzeugeDungeon2(thema, seeds, args[2], ambientLicht);
          if (!doc) {
            return { ok: false, active: false, message: `Erzeugung fehlgeschlagen (${thema})` };
          }
          return {
            ok: true,
            active: false,
            message:
              `Dungeon 2.0 erzeugt: ${doc.id} (Thema ${doc.thema}, Seed ${seed}, ` +
              `Prüfsumme ${doc.pruefsumme}, Grundhelligkeit ` +
              `${dungeon2.ambientLichtVon(doc).toFixed(2)}` +
              `${doc.ambientLicht === undefined ? ' aus dem Thema' : ' je Dokument'})`,
          };
        }

        case 'entrances': {
          const entries = this.dungeons.listEntrances();
          if (entries.length === 0) {
            return { ok: true, active: false, message: 'Keine Eingänge registriert' };
          }
          const lines = entries.map(
            (e) =>
              `${e.feature}@(${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)}) → ${e.dungeonId}` +
              // Der Modus steht ausdrücklich in JEDER Zeile, auch das 'fest'.
              // Ein Flag, das man nur an seiner Abwesenheit erkennt, liest
              // sich in einer Liste wie ein Anzeigefehler.
              ` [${e.regenerateOnEnter ? 'regen' : 'fest'}]`
          );
          return { ok: true, active: false, message: lines.join(' | ') };
        }

        case 'entrance-mode': {
          const id = args[0];
          const modus = args[1];
          if (!id || (modus !== 'fixed' && modus !== 'regen')) {
            return {
              ok: false,
              active: false,
              message: 'Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>',
            };
          }
          // Die beiden Fehlgründe werden hier getrennt, weil sie zwei ganz
          // verschiedene Fehler des Aufrufers sind: falsche Kennung gegen
          // „dieses Dokument kennt kein Kit-Rezept".
          const eingang = this.dungeons.eingangZuDungeon(id);
          if (!eingang) {
            return { ok: false, active: false, message: `Kein Eingang zeigt auf: ${id}` };
          }
          if (!this.dungeons.setzeEingangsModus(id, modus)) {
            return {
              ok: false,
              active: false,
              message:
                `Kein Rezept (base) für ${id} — nur erzeugte 1.0-Dungeons mit ` +
                'DG_*-Basis können bei jedem Betreten neu würfeln',
            };
          }
          return {
            ok: true,
            active: false,
            message:
              modus === 'regen'
                ? `${eingang.feature}@${eingang.zoneKey} → ${id}: würfelt bei jedem Betreten neu`
                : `${eingang.feature}@${eingang.zoneKey} → ${id}: fest`,
          };
        }

        case 'create': {
          const base = this.resolveDungeonBase(args[0]);
          if (!base) {
            return {
              ok: false,
              active: false,
              message:
                'Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. ' +
                'forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe',
            };
          }
          const seed = Number.isFinite(Number(args[1]))
            ? Number(args[1]) | 0
            : (Math.random() * 0x7fffffff) | 0;
          // Dieselben zwei Stellschrauben wie im Web-Editor. Geklemmt wird
          // NICHT hier, sondern in `createGenerated` — eine zweite Prüfung
          // derselben Grenzen driftet auseinander, und dieser Weg hier ist
          // der selten benutzte von beiden.
          const raeume = args[2] !== undefined && Number.isFinite(Number(args[2]))
            ? Number(args[2])
            : undefined;
          const zone = args[3] !== undefined && Number.isFinite(Number(args[3]))
            ? Number(args[3])
            : undefined;
          const einstellungen =
            raeume === undefined && zone === undefined
              ? undefined
              : {
                  ...(raeume !== undefined ? { maxRooms: raeume } : {}),
                  ...(zone !== undefined ? { zoneSize: zone } : {}),
                };
          const doc = this.dungeons.createGenerated(base, seed, undefined, einstellungen);
          if (!doc) {
            return { ok: false, active: false, message: `Erzeugung fehlgeschlagen (${base})` };
          }
          return {
            ok: true,
            active: false,
            message:
              `Dungeon erzeugt: ${doc.id} (${doc.layout.rooms.length} Räume, Seed ${seed}, ` +
              `Zone ${doc.zoneSize})`,
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
          // Beide Formate: Ein Eingang darf auf ein 2.0-Dokument zeigen.
          // Both formats: an entrance may point at a 2.0 document.
          if (!id || !this.dungeons.hatDokument(id)) {
            return { ok: false, active: false, message: `Unbekannter Dungeon: ${id ?? '?'}` };
          }
          const entrance = this.dungeons.findEntranceNear(peer.position, 16);
          if (!entrance) {
            return { ok: false, active: false, message: 'Kein Dungeon-Eingang in der Nähe (≤16 m)' };
          }
          // Den Rückgabewert AUSWERTEN. Er war hier verworfen, und weil
          // `assignEntrance` nur die 1.0-Karte befragt, meldete der Befehl bei
          // jeder 2.0-Kennung Erfolg, während der Eingang unverändert blieb.
          // Evaluate the return value — it was discarded, so a 2.0 id reported
          // success while the entrance stayed untouched.
          if (!this.dungeons.assignEntrance(entrance.zoneKey, id)) {
            return {
              ok: false,
              active: false,
              message:
                `Zuweisung fehlgeschlagen: kein 1.0-Dokument unter '${id}' — ` +
                '2.0-Dokumente lassen sich (noch) nicht zuweisen',
            };
          }
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
          // Handarbeit NICHT überwürfeln. `regen` erzeugt aus Basis und
          // Seed neu — bei einem `custom`-Dokument ist das Ergebnis nicht
          // das Grab, an dem jemand gebaut hat, sondern ein fremdes, und
          // das alte Layout ist danach weg. Es gibt hier absichtlich KEIN
          // `force`: Der Weg, ein gebautes Grab durch ein gewürfeltes zu
          // ersetzen, führt über den Editor, wo man vorher sieht, was man
          // wegwirft.
          if (doc.mode === 'custom') {
            return {
              ok: false,
              active: false,
              message:
                `${doc.id} ist von Hand gebaut (mode custom) — 'regen' würfelt aus Basis und ` +
                'Seed neu und die Handarbeit wäre verloren. Neu generieren geht im Editor ' +
                'über „Neu anlegen" mit „voll generieren".',
            };
          }
          const seed = Number.isFinite(Number(args[1]))
            ? Number(args[1]) | 0
            : (Math.random() * 0x7fffffff) | 0;
          // OHNE eigenes `einstellungen`-Argument: `createGenerated` nimmt
          // die im Dokument gespeicherten `generatorEinstellungen`, sonst
          // fiele das Grab hier still auf die Kit-Vorgabe zurück.
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

        case 'steinkit': {
          const doc = args[0] ? this.dungeons.getDocument(args[0]) : undefined;
          if (!doc) {
            return { ok: false, active: false, message: `Unbekannter 1.0-Dungeon: ${args[0] ?? '?'}` };
          }
          // ── `room=<i>`: dasselbe Kommando, eine Stufe tiefer ───────────
          //
          // Ohne `room=` gilt wie bisher das DOKUMENT. Mit `room=<i>` gilt
          // GENAU DIESE Platzierung (`PlacedRoom.steinKit`) — deshalb muss
          // die Angabe VOR der allgemeinen key=value-Schleife heraus, die
          // jedes unbekannte Token ablehnt.
          // With `room=<i>` the very same command edits ONE placed room
          // instead of the document; pulled out before the generic loop.
          const rest: string[] = [];
          let roomIndex: number | null = null;
          for (const arg of args.slice(1)) {
            if (!arg.startsWith('room=')) {
              rest.push(arg);
              continue;
            }
            const zahl = Number(arg.slice('room='.length));
            if (!Number.isFinite(zahl) || !Number.isInteger(zahl)) {
              return { ok: false, active: false, message: `Kein Raumindex: ${arg}` };
            }
            roomIndex = zahl;
          }
          if (roomIndex !== null && (roomIndex < 0 || roomIndex >= doc.layout.rooms.length)) {
            return {
              ok: false,
              active: false,
              message: `Raumindex ${roomIndex} liegt ausserhalb — ${doc.id} hat ${doc.layout.rooms.length} Räume (0..${doc.layout.rooms.length - 1})`,
            };
          }
          // Das Ziel der Änderung: das Dokument selbst oder ein Raum darin.
          // Ein Zeiger statt zweier Zweige — sonst driften Prüfung, Sanitizer
          // und Speichern zwischen beiden Wegen auseinander.
          const ziel: { steinKit?: Partial<SteinKitConfig> } =
            roomIndex === null ? doc : doc.layout.rooms[roomIndex]!;
          const wo = roomIndex === null ? doc.id : `${doc.id} Raum ${roomIndex}`;
          if (rest.length === 1 && rest[0] === 'reset') {
            delete ziel.steinKit;
            this.dungeons.saveDocument(doc);
            this.dungeons.destroyInstance(doc.id);
            return {
              ok: true,
              active: false,
              message:
                roomIndex === null
                  ? `${wo}: Steinmaterial gelöscht — es gilt wieder die Kit-Vorgabe`
                  : `${wo}: Steinmaterial gelöscht — es gilt wieder das des Dokuments`,
            };
          }
          // key=value in ein rohes Objekt legen und EINMAL durch denselben
          // Sanitizer schicken wie ein hochgeladenes Dokument. Der Befehl
          // hat damit keine eigene Prüfung, die von jener abweichen könnte.
          // Parsed into a raw object and run through the SAME sanitizer as an
          // uploaded document — no second, divergent check.
          const roh: Record<string, unknown> = { ...(ziel.steinKit ?? {}) };
          const verw: Record<string, unknown> = {
            ...((ziel.steinKit?.verwitterung ?? {}) as Record<string, unknown>),
          };
          const unbekannt: string[] = [];
          for (const arg of rest) {
            const [k, v] = arg.split('=', 2);
            if (!k || v === undefined) {
              unbekannt.push(arg);
              continue;
            }
            switch (k) {
              case 'wand':
              case 'decke':
              case 'boden': {
                const pfad = steinTexturAufloesen(v);
                if (!pfad) {
                  return {
                    ok: false,
                    active: false,
                    message:
                      `Unbekannte Textur "${v}" — erlaubt: ` +
                      STEIN_TEXTUREN.map((t) => t.split('/').pop()!.replace('.png', '')).join(', '),
                  };
                }
                roh[k === 'wand' ? 'wandTextur' : k === 'decke' ? 'deckeTextur' : 'bodenTextur'] =
                  pfad;
                break;
              }
              case 'moos':
              case 'frost':
              case 'nass':
                verw[k] = Number(v);
                break;
              case 'kachel':
                roh.kachelM = Number(v);
                break;
              case 'deckenkachel':
                roh.deckeKachelM = Number(v);
                break;
              default:
                unbekannt.push(arg);
            }
          }
          if (unbekannt.length > 0) {
            return {
              ok: false,
              active: false,
              message:
                `Unbekannte Angabe: ${unbekannt.join(' ')} — Aufruf: dungeon steinkit <id> ` +
                '[room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> ' +
                'nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset',
            };
          }
          if (Object.keys(verw).length > 0) roh.verwitterung = verw;
          const sauber = sanitizeSteinKit(roh);
          if (!sauber) {
            return {
              ok: false,
              active: false,
              message: 'Nichts Gültiges angegeben — nichts geändert',
            };
          }
          ziel.steinKit = sauber;
          this.dungeons.saveDocument(doc);
          // Die Instanz verwerfen wie bei `regen`: Wer drin steht, betritt
          // sie beim nächsten `dungeon enter` frisch — und erst dieses
          // Teleport-Paket trägt das neue Material zum Client.
          // Drop the instance as `regen` does; only the next teleport packet
          // carries the new material to a client.
          this.dungeons.destroyInstance(doc.id);
          return {
            ok: true,
            active: false,
            message: `${wo}: Steinmaterial gesetzt — ${JSON.stringify(sauber)}`,
          };
        }

        // ── Grundbeleuchtung je 1.0-Dokument ──────────────────────────
        //
        // Gleicher Aufbau wie `steinkit`: prüfen, ins Dokument schreiben,
        // `saveDocument`, `destroyInstance` — erst das nächste Teleport-Paket
        // trägt den neuen Wert zum Client, eine laufende Instanz weiss von
        // ihm nichts (Vault: „server.yml erreicht laufende Clients nicht").
        // Same shape as `steinkit`; only the next teleport packet carries the
        // new value to a client, so the live instance is dropped.
        case 'licht': {
          const doc = args[0] ? this.dungeons.getDocument(args[0]) : undefined;
          if (!doc) {
            return { ok: false, active: false, message: `Unbekannter 1.0-Dungeon: ${args[0] ?? '?'}` };
          }
          if (args[1] === undefined) {
            return {
              ok: false,
              active: false,
              message:
                `${doc.id}: Grundbeleuchtung ${ambientLichtVon(doc).toFixed(2)}` +
                `${doc.ambientLicht === undefined ? ' (Vorgabe, Feld nicht gesetzt)' : ''} — ` +
                `Aufruf: dungeon licht <id> <0..${MAX_DUNGEON_AMBIENT}> | dungeon licht <id> reset`,
            };
          }
          if (args[1] === 'reset') {
            delete doc.ambientLicht;
            this.dungeons.saveDocument(doc);
            this.dungeons.destroyInstance(doc.id);
            return {
              ok: true,
              active: false,
              message: `${doc.id}: Grundbeleuchtung gelöscht — es gilt wieder die Umgebung (1)`,
            };
          }
          const wert = Number(args[1]);
          // `Number('')` ist 0 und `Number('abc')` ist NaN — beides muss hier
          // heraus, sonst schriebe ein Vertipper stillschweigend „stockdunkel".
          // `Number('')` is 0, so an empty argument must be rejected here.
          if (args[1].trim() === '' || !Number.isFinite(wert)) {
            return { ok: false, active: false, message: `Keine Zahl: ${args[1]}` };
          }
          if (wert < 0 || wert > MAX_DUNGEON_AMBIENT) {
            return {
              ok: false,
              active: false,
              message: `Grundbeleuchtung muss zwischen 0 und ${MAX_DUNGEON_AMBIENT} liegen — ${wert} liegt ausserhalb`,
            };
          }
          doc.ambientLicht = wert;
          this.dungeons.saveDocument(doc);
          this.dungeons.destroyInstance(doc.id);
          return {
            ok: true,
            active: false,
            message:
              `${doc.id}: Grundbeleuchtung ${wert.toFixed(2)} gesetzt` +
              `${wert < 1 ? ' (dunkler als die Umgebung)' : wert > 1 ? ' (heller als die Umgebung)' : ' (wie die Umgebung)'}`,
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
              'Aufruf: dungeon list|entrances|entrance-mode|create|create2|enter|leave|assign|regen|steinkit|licht|reset|delete',
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

  // ── Time helpers (getDay, getTimeOfDay) ────────────────────────

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
   * Loads the save file (reference order preserved): worldTime →
   * generated zones → persistent ZDOs. Player positions load into savedPlayers and are applied in
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
    // F5: Fortschrittsmarken — ausListe() behandelt ein fehlendes Feld
    // (Altstand vor diesem Umbau) genau wie eine leere Liste als "keine
    // Marken gesetzt", s. WorldSaveData.globalKeys und WeltMarken.ts.
    this.weltMarken.ausListe(data.globalKeys);
    const restoredZDOs = this.zdos.restoreFromSnapshots(data.zdos);
    // F3 (Security-Review): unter der spielerId einlagern, WENN das
    // Save-Format schon eine gueltige mitbringt (Staende ab diesem
    // Umbau) — sonst unter dem NAMEN, exakt wie vor dem Umbau. Das ist
    // KEIN Praefix-Trick: ein Altstand ohne spielerId landet bit-genau
    // unter demselben Schluessel wie frueher, ermittleGespeichertenStand()
    // migriert ihn beim naechsten Login des betreffenden Spielers.
    for (const player of data.players) {
      const schluessel =
        player.spielerId && istSpielerId(player.spielerId) ? player.spielerId : player.name;
      this.savedPlayers.set(schluessel, player);
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
   * Writes the save file. Persistent ZDOs are filtered by the
   * PREFAB flag — the reference's persistence check returns the prefab's
   * persistent flag, the ZDO instance flag is never set. Player character ZDOs
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
    // G12 Schritt 1: dieselben Zahlen zusaetzlich maschinenlesbar, s.
    // util/StrukturLog.ts fuer Begruendung und Schalter.
    strukturLog('world_saved', {
      zdoAnzahl: aufnahme.zdos.length,
      zonenAnzahl: aufnahme.kopf.zones.length,
      spielerAnzahl: aufnahme.kopf.players.length,
      dauerMs: Date.now() - t0,
      asynchron: false,
    });
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
      strukturLog('world_saved', {
        zdoAnzahl: aufnahme.zdos.length - uebersprungen,
        zonenAnzahl: aufnahme.kopf.zones.length,
        spielerAnzahl: aufnahme.kopf.players.length,
        dauerMs: Date.now() - t0,
        asynchron: true,
      });
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
   * Persistente ZDOs werden über das PREFAB-Flag gefiltert — die
   * Persistenzprüfung der Referenz liefert das Persistent-Flag des Prefabs,
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
          // Gespeichert wird die HAUPTWELT. Instanz-ZDOs tauchen hier gar
          // nicht mehr auf: Die Quelle dieser Liste ist `this.zdos`, und
          // das ist der ZDO-Raum der Hauptwelt. Vorher stand hier ein
          // Koordinatenfilter, weil alles in einem Raum lag.
          //
          // Eine Instanz wird aus ihrem DungeonDocument neu materialisiert;
          // sie zu speichern hiesse, Geometrie auferstehen zu lassen, die
          // der Manager nicht mehr kennt.
          (this.prefabs.getByHash(z.prefabHash)?.isPersistent() ?? false)
      );

    const players = new Map(this.savedPlayers);
    for (const peer of this.net.getPeers()) {
      // Editor sessions have no character/inventory and may share a player ID.
      // They must never overwrite that character's saved state.
      if (peer.nurEditor) continue;
      // F3 (Security-Review): unter der spielerId, nicht mehr unter dem
      // Namen — ueberschreibt hier zuverlaessig einen evtl. noch unter
      // dem NAMEN liegenden Alteintrag desselben Spielers nicht (anderer
      // Schluessel), das erledigt ermittleGespeichertenStand() beim naechsten
      // Login. Was tatsaechlich auf die Platte geht, sind nur die WERTE
      // (players[] ist ein Array) — der Map-Schluessel selbst ist reiner
      // Laufzeitzustand.
      players.set(peer.spielerId, {
        name: peer.name,
        spielerId: peer.spielerId,
        // Phase G: for peers inside a dungeon save the overworld return
        // point — instances don't survive a restart.
        position:
          peer.dungeonId && peer.dungeonReturn
            ? { ...peer.dungeonReturn }
            : { ...peer.position },
        flying: peer.flying,
        spawnPoint: peer.spawnPoint ?? undefined,
        spawnBettId: peer.spawnBettId || undefined,
        spawnBettBesitzer: peer.spawnBettBesitzer ?? undefined,
        figur: peer.figur,
        frisur: peer.frisur,
        haarfarbe: peer.haarfarbe,
        augenfarbe: peer.augenfarbe,
        klasse: peer.klasse,
        starterSetGranted: peer.starterSetGranted,
        ruestung: peer.ruestung,
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
        // F5: gesetzte Fortschrittsmarken, s. WorldSaveData.globalKeys.
        globalKeys: this.weltMarken.alsNamen(),
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
  SwordNorth: 12,
  Staff: 10,
  Spear: 11,
  Club: 12,
  AxeFlint: 15,
  PickaxeAntler: 8,
  Hoe: 2,
  Cultivator: 2,
};

/**
 * Waffenname aus dem Angriffs-/Ernte-Paket nur übernehmen, wenn er
 * tatsächlich im Server-Inventar liegt (A2) — sonst Faust ('').
 *
 * Der Server kennt (noch) keinen Begriff einer "ausgerüsteten" Waffe: das
 * `equipped`-Feld auf ItemStack (shared/src/items/ItemData.ts) wird
 * ausschließlich client-seitig gesetzt (client/src/player/Equipment.ts)
 * und nie zum Server synchronisiert — es gibt kein Protokollpaket dafür.
 * peer.inventar (Peer.ts) ist die einzige serverseitige Quelle. Ohne diese
 * Prüfung schlug der Server den Schaden aus WAFFEN_SCHADEN[waffe] direkt
 * für den Paket-String nach, unabhängig vom Besitz — Axtschaden ohne Axt,
 * und weil handleAttack dieselbe Waffe an handleHarvest durchreicht, auch
 * Werkzeugpflicht-Umgehung beim Ernten. EIN Prüfpunkt für beide Pfade.
 *
 * Sollte der Server künftig ein echtes Ausrüstungskonzept bekommen (Review
 * A2, Schritt 2), gehört die schärfere Prüfung — nur die AUSGERÜSTETE
 * Waffe zählt, das Paketfeld wird ignoriert — hierher, an diese eine Stelle.
 */
export function gepruefteWaffe(inventar: Inventory, waffe: string): string {
  if (waffe === '') return waffe;
  return inventar.countOf(waffe) > 0 ? waffe : '';
}

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
  // B9: meat is the only animal drop the item table knows (no leather or pelt
  // item exists yet). The cow is the big animal (1.5 m at the shoulder, 2.9 m
  // long), so one more than the boar; the wolf drops what the boar drops.
  Kuh: [['RawMeat', 2, 3, 1]],
  Wolf: [['RawMeat', 1, 2, 1]],
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

// ── Singleton accessor ───────────────────────────────────────────

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
