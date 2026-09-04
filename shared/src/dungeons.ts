/**
 * Dungeon registry (Phase G) — the 13 DG_* dungeon generators with their
 * complete room kits, parsed 1:1 from the C++ server's dungeons.pkg
 * (tools/prefab-parser/parse-dungeons.ts). This is the Unity
 * Room/RoomConnection component data that the GLB exports lack: room sizes,
 * connector transforms, themes, weights and the interactive net views
 * contained in each room.
 *
 * BUNDLE-SCHNITT: Die Einrichtung der Raeume (netViews + randomSpawns, gut
 * 4,9 MB JSON) liegt getrennt in roomPiecesData.json hinter
 * `roomPieces.ts`. Sie wird nur beim Materialisieren eines Dungeons
 * gebraucht — also serverseitig — waehrend `dungeons.ts` ueber prefabs.ts
 * am Barrel und damit an jedem Client-Modul haengt. Was hier bleibt (Raum-
 * Kopf, Groesse, Connectors) braucht der Client wirklich: der Raum-Katalog
 * fuer die Prefab-Registry und der Dungeon-Editor.
 *
 * C++ reference: DungeonManager.cpp:19-201 (pkg read), Dungeon.h,
 * DungeonRoom.h, DungeonRoomConnection.h.
 */

import dungeonsData from './dungeonsData.json';
import { EIGENE_KITS } from './eigeneDungeons.js';
// Nur der Typ — zur Laufzeit entsteht daraus kein Import und damit
// auch kein Ringschluss mit `dungeonGenerator.ts`, das hier einliest.
import type { DungeonGeneratorSettings } from './dungeonGenerator.js';
// Ebenfalls nur der Typ: `dungeonRasterModul.ts` liest `RoomDef` von hier,
// ein Laufzeitimport machte daraus einen Ringschluss.
import type { GridEdgeDef } from './dungeonRasterModul.js';
import { getStableHash } from './hash.js';
import type { Quaternion, Vector3 } from './types.js';

/** C++ Room::Theme (DungeonRoom.h) — bitmask. */
export enum RoomTheme {
  Crypt = 1,
  SunkenCrypt = 2,
  Cave = 4,
  ForestCrypt = 8,
  GoblinCamp = 16,
  MeadowsVillage = 32,
  MeadowsFarm = 64,
  DvergerTown = 128,
  DvergerBoss = 256,
  ForestCryptHildir = 512,
  CaveHildir = 1024,
  PlainsFortHildir = 2048,
  AshlandRuins = 4096,
  FortressRuins = 8192,
}

/** C++ Dungeon::Algorithm. */
export enum DungeonAlgorithm {
  Dungeon = 0,
  CampGrid = 1,
  CampRadial = 2,
}

/**
 * LEGACY fuer Dungeons (s. `LEGACY.md`) — wird nach Erfolg von Dungeon
 * Generator 2.0 fuer Dungeons geloescht / LEGACY for dungeons (see
 * `LEGACY.md`) — will be deleted for dungeons once Dungeon Generator 2.0
 * succeeds.
 *
 * ACHTUNG: `campGenerator.ts` (Oberwelt, bleibt aktiv) importiert denselben
 * Typ fuer Camp-Raeume weiter — nicht loeschen, bevor Camps umgezogen sind.
 * NOTE: `campGenerator.ts` (overworld, stays active) keeps importing this
 * same type for camp rooms — do not delete before camps have moved off it.
 *
 * C++ RoomConnection — a connector transform inside a room prefab.
 */
export interface RoomConnectionDef {
  /** Coupling type; rooms only attach to connectors of the same type ('' is common). */
  readonly type: string;
  readonly entrance: boolean;
  readonly allowDoor: boolean;
  readonly doorOnlyIfOtherAlsoAllowsDoor: boolean;
  readonly localPos: Vector3;
  readonly localRot: Quaternion;
}

/**
 * LEGACY fuer Dungeons (s. `LEGACY.md`), gleiche Ausnahme wie bei
 * `RoomConnectionDef` oben (Camps benutzen `RoomDef` weiter) / LEGACY for
 * dungeons (see `LEGACY.md`), same exception as `RoomConnectionDef` above
 * (camps keep using `RoomDef`).
 *
 * C++ Room (DungeonRoom.h) — one placeable room prefab.
 */
export interface RoomDef {
  /** Prefab name — also the GLB model name under assets/models/. */
  readonly name: string;
  /** getStableHash(name) — network/persistence ID of the room. */
  readonly hash: number;
  readonly divider: boolean;
  readonly endCap: boolean;
  readonly endCapPrio: number;
  readonly entrance: boolean;
  readonly faceCenter: boolean;
  readonly minPlaceOrder: number;
  readonly perimeter: boolean;
  /** OBB size for the collision test (Vector3Int in Unity). */
  readonly size: Vector3;
  readonly theme: number;
  readonly weight: number;
  /** Room offset inside the source dungeon prefab (start-room dummy anchor). */
  readonly pos: Vector3;
  readonly rot: Quaternion;
  readonly connections: readonly RoomConnectionDef[];
  /**
   * Raum-spezifische Überschreibung des Kit-Steinmaterials (Wand/Decke/Boden +
   * Verwitterung). Wird über die Kit-Vorgabe (`DungeonDef.steinKit`) gelegt —
   * nur gesetzte Felder gewinnen. Fehlt es, gilt die Kit-Vorgabe. So kann eine
   * Kammer anders aussehen als ein Gang.
   * Per-room override of the kit stone material; only set fields win over the
   * kit default. Lets a chamber look different from a corridor.
   */
  readonly steinKit?: Partial<SteinKitConfig>;
  /**
   * Kantenerklärung für den Rastergenerator (Konzept „Modul-Generierung
   * 2.0-Logik“, S0) — nur für Module eines Rasterkits gesetzt.
   *
   * ── Warum additiv und nicht abgeleitet ─────────────────────────────
   * Ableitbar ist nur `open`: Dort sitzt ein Connector, und der steht in
   * dieser Datei. `wall` und `wallPartial` stecken dagegen im GLB — an
   * einer eingebauten Korridorwand gibt es nichts, woran eine Datenstruktur
   * sie bemerken könnte. Genau diese Blindheit ist die Ursache dafür, dass
   * heute jede dritte Abschlussplatte im Körper des Nachbarmoduls steht.
   *
   * Der Preis ist eine zweite Wahrheit über dieselbe Wand: Wer
   * `make-stonevault.py` ändert und diese Zeilen vergisst, hat ab da eine
   * Erklärung, die nicht mehr stimmt. Dagegen steht
   * `shared/test/dungeon-rastermodul.ts`.
   *
   * Fehlt das Feld, muss jede waagerechte Aussenkante einen Connector
   * tragen — `gridModuleFromRoomDef` meldet jede Lücke.
   */
  readonly gridEdges?: readonly GridEdgeDef[];
}

/** C++ Dungeon::DoorDef. */
export interface DungeonDoorDef {
  readonly prefabName: string;
  readonly prefabHash: number;
  readonly connectionType: string;
  readonly chance: number;
}

/** C++ Dungeon (Dungeon.h) — a DG_* generator with its room kit. */
/**
 * Konfiguration des KI-Steinmaterials eines 1.0-Kits: je Fläche (Wand, Decke,
 * Boden) eine Textur plus elementübergreifend eingestreute Verwitterung
 * (Moos/Frost/Nass). Reine Daten (Texturpfade + Zahlen) — der Client baut daraus
 * in `client/src/engine/DungeonSteinMaterial.ts` ein `PBRMaterial`. Fehlt das
 * Feld am Kit, behalten die Räume ihr gebackenes GLB-Material.
 * Config of a 1.0 kit's AI stone material: per-surface texture (wall/ceiling/
 * floor) plus cross-piece weathering. Pure data; the client turns it into a
 * PBRMaterial. Absent → rooms keep their baked GLB material.
 */
export interface SteinKitConfig {
  readonly wandTextur: string;
  readonly deckeTextur: string;
  readonly bodenTextur: string;
  readonly moosTextur?: string;
  readonly frostTextur?: string;
  readonly nassTextur?: string;
  readonly verwitterung: { readonly moos: number; readonly frost: number; readonly nass: number };
  /** Kachelgröße Wand/Boden in Weltmetern. / Wall/floor tile size in metres. */
  readonly kachelM: number;
  /** Kachelgröße der Decke (planar) in Weltmetern. */
  readonly deckeKachelM: number;
  /** Weltraum-Fleckengröße je Verwitterung (größer = größere, seltenere Flecken). */
  readonly moosSkala: number;
  readonly frostSkala: number;
  readonly nassSkala: number;
  /** Normalenschwelle n.y für „Decke". Vorgabe 0.45. */
  readonly deckeSchwelle?: number;
}

/**
 * Erlaubnisliste der Steintexturen — die EINZIGEN Pfade, die aus einem
 * Dokument in ein Material gelangen dürfen.
 *
 * WARUM EINE LISTE UND KEINE PRÜFUNG AUF „/assets/models/…": Das Dokument
 * kommt vom Client (F4-Editor, Admin-Befehl, Datei auf der Platte). Ein
 * freier Pfad wäre eine Zeichenkette, die der Client als URL lädt — ein
 * Verzeichnis-Ausbruch, eine fremde Herkunft oder schlicht ein Tippfehler
 * ergäbe eine schwarze Wand ohne Fehlermeldung. Eine Liste hat genau die
 * Dateien, die es wirklich gibt.
 * Allow-list of stone textures — the ONLY paths a document may put into a
 * material. Documents come from the client, so a free path would be a
 * client-loaded URL (directory escape, foreign origin, or just a typo).
 */
export const STEIN_TEXTUREN: readonly string[] = [
  '/assets/models/stein_clean.png',
  '/assets/models/stein_decke.png',
  '/assets/models/stein_moos.png',
  '/assets/models/stein_frost.png',
  '/assets/models/stein_wet.png',
];

/** Obergrenze der Verwitterungszahlen — Bereich des Konsolenbefehls. */
export const STEIN_VERWITTERUNG_MAX = 4;

/**
 * Name des ZDO-Members, der das Steinmaterial EINES platzierten Raums zum
 * Client trägt (JSON eines `Partial<SteinKitConfig>`, s. `PlacedRoom.steinKit`).
 *
 * Hier und nicht je einmal auf Server- und Clientseite, weil beide Seiten
 * denselben `getStableHash()` darüber bilden müssen — zwei Schreibweisen
 * ergäben zwei Hashes und einen Member, den niemand je liest.
 * Name of the ZDO member carrying ONE placed room's stone material to the
 * client; shared so both sides hash the identical string.
 */
export const STEIN_KIT_MEMBER = 'steinKit';

/**
 * Einen Texturnamen ODER -pfad gegen {@link STEIN_TEXTUREN} auflösen.
 * `stein_moos`, `stein_moos.png` und der volle Pfad ergeben dasselbe;
 * alles andere ergibt `undefined`.
 * Resolve a texture name or path against the allow-list; anything else
 * yields `undefined`.
 */
export function steinTexturAufloesen(roh: unknown): string | undefined {
  if (typeof roh !== 'string') return undefined;
  const s = roh.trim();
  if (s.length === 0) return undefined;
  if (STEIN_TEXTUREN.includes(s)) return s;
  const kurz = s.endsWith('.png') ? s : `${s}.png`;
  return STEIN_TEXTUREN.find((t) => t.endsWith(`/${kurz}`));
}

export interface DungeonDef {
  /** DG_* prefab name. */
  readonly name: string;
  /** getStableHash(name). */
  readonly hash: number;
  /** Interior offset in the location prefab ((0,5000,0) for real dungeons). */
  readonly interiorPosition: Vector3 | null;
  readonly originalPosition: Vector3 | null;
  readonly algorithm: DungeonAlgorithm;
  readonly alternativeFunctionality: boolean;
  readonly campRadiusMax: number;
  readonly campRadiusMin: number;
  readonly doorChance: number;
  readonly doorTypes: readonly DungeonDoorDef[];
  readonly gridSize: number;
  /** Number of placement ATTEMPTS, not rooms (original naming). */
  readonly maxRooms: number;
  readonly maxTilt: number;
  readonly minAltitude: number;
  readonly minRequiredRooms: number;
  readonly minRooms: number;
  readonly perimeterBuffer: number;
  readonly perimeterSections: number;
  readonly requiredRooms: readonly string[];
  readonly spawnChance: number;
  /** RoomTheme bitmask. */
  readonly themes: number;
  readonly tileWidth: number;
  readonly rooms: readonly RoomDef[];
  /**
   * Deko, die in diesem Kit gesetzt werden darf. Fehlt das Feld (alle
   * geparsten Kits), ist nichts erlaubt — Fremdkits haben keine eigenen
   * Modelle, und ohne Modell ist eine gesetzte Deko ein unsichtbarer Hash.
   */
  readonly propTypes?: readonly DungeonPropDef[];
  /**
   * Abweichungen dieses Kits von `DEFAULT_GENERATOR_SETTINGS`.
   *
   * WARUM AM KIT UND NICHT AM AUFRUFER: Die Vorgabewerte bilden das
   * Verhalten der Vorlage ab, und die dreizehn geparsten Kits müssen
   * genau dabei bleiben — sonst erzeugt derselbe Seed ab heute einen
   * anderen Dungeon als gestern. Ein eigenes Kit darf abweichen, aber
   * die Abweichung gehört neben seine Räume und nicht in jeden
   * einzelnen Aufrufer von `generateDungeonLayout` (Server, F4-Editor,
   * Tests) — vergessen wird sie sonst genau dort, wo niemand hinsieht.
   *
   * Fehlt das Feld, gilt der Vorgabewert. Alle Fremdkits lassen es leer.
   */
  readonly generatorEinstellungen?: Partial<DungeonGeneratorSettings>;
  /**
   * KI-Steinmaterial dieses Kits (Wand/Decke/Boden + Verwitterung). Fehlt das
   * Feld (alle geparsten Kits), behalten die Räume ihr gebackenes GLB-Material.
   * Client-seitig aufgelöst über {@link getKitByRoomHash}; nichts wird über die
   * Leitung geschickt.
   */
  readonly steinKit?: SteinKitConfig;
}

interface DungeonJson extends Omit<DungeonDef, 'hash' | 'rooms' | 'algorithm'> {
  readonly algorithm: number;
  readonly rooms: readonly Omit<RoomDef, 'hash'>[];
}

/**
 * Alle Kits: die 13 geparsten aus `dungeons.pkg` in pkg-Reihenfolge, dahinter
 * die eigenen aus `eigeneDungeons.ts`.
 *
 * Zwei Quellen und keine dritte: `dungeonsData.json` ist erzeugt und wird vom
 * Parser überschrieben, die eigenen Kits stehen deshalb in einer Datei, die er
 * nicht anfasst. Zusammengeführt wird genau hier, damit alles Weitere —
 * `DUNGEONS_BY_NAME`, die Raum-Registry in `prefabs.ts`, der Generator, der
 * Editor — nur EINE Liste kennt und eigene Räume nirgends nachgetragen werden
 * müssen.
 */
export const DUNGEONS: readonly DungeonDef[] = [
  ...(dungeonsData as unknown as { dungeons: DungeonJson[] }).dungeons,
  ...(EIGENE_KITS as unknown as DungeonJson[]),
].map((d) => ({
  ...d,
  hash: getStableHash(d.name),
  algorithm: d.algorithm as DungeonAlgorithm,
  rooms: d.rooms.map((r) => ({ ...r, hash: getStableHash(r.name) })),
}));

export const DUNGEONS_BY_NAME: ReadonlyMap<string, DungeonDef> = new Map(
  DUNGEONS.map((d) => [d.name, d])
);

export const DUNGEONS_BY_HASH: ReadonlyMap<number, DungeonDef> = new Map(
  DUNGEONS.map((d) => [d.hash, d])
);

/** Room lookup across all dungeons (room names are globally unique). */
export const ROOMS_BY_HASH: ReadonlyMap<number, RoomDef> = new Map(
  DUNGEONS.flatMap((d) => d.rooms.map((r) => [r.hash, r] as const))
);

/**
 * Kit-Lookup über einen seiner Raum-Hashes. Der Client braucht zu einem
 * platzierten Raum-Prefab das KIT (für `steinKit`), und `RoomDef` trägt keinen
 * Rückverweis auf sein Kit.
 * Kit lookup by any of its room hashes — the client needs a placed room's KIT
 * (for `steinKit`), and `RoomDef` has no back-reference to its kit.
 */
export const KIT_BY_ROOM_HASH: ReadonlyMap<number, DungeonDef> = new Map(
  DUNGEONS.flatMap((d) => d.rooms.map((r) => [r.hash, d] as const))
);

export function getKitByRoomHash(hash: number): DungeonDef | undefined {
  return KIT_BY_ROOM_HASH.get(hash);
}

/**
 * Wie {@link getKitByRoomHash}, aber auch über die TÜR-Prefabs eines Kits
 * (`doorTypes`) — Türen sind keine Räume, sollen aber dasselbe Material tragen,
 * sonst behält der Türrahmen im Grab sein altes Material.
 * Like {@link getKitByRoomHash} but also over a kit's DOOR prefabs — doors are
 * not rooms yet must share the material, or the door frame keeps its old look.
 */
export const KIT_BY_PREFAB_HASH: ReadonlyMap<number, DungeonDef> = new Map(
  DUNGEONS.flatMap((d) => [
    ...d.rooms.map((r) => [r.hash, d] as const),
    ...d.doorTypes.map((dt) => [dt.prefabHash, d] as const),
  ])
);

export function getKitByPrefabHash(hash: number): DungeonDef | undefined {
  return KIT_BY_PREFAB_HASH.get(hash);
}

export function getDungeonByName(name: string): DungeonDef | undefined {
  return DUNGEONS_BY_NAME.get(name);
}

export function getDungeonByHash(hash: number): DungeonDef | undefined {
  return DUNGEONS_BY_HASH.get(hash);
}

export function getRoomByHash(hash: number): RoomDef | undefined {
  return ROOMS_BY_HASH.get(hash);
}

// ---------------------------------------------------------------------------
// Layout & document — our own instance-based dungeon format
//
// LEGACY-Block (s. `LEGACY.md`) — wird nach Erfolg von Dungeon Generator 2.0
// geloescht: `PlacedRoom`, `DungeonPropDef`, `PlacedDoor`, `PlacedProp`,
// `DungeonLayout`, `DUNGEON_DOCUMENT_VERSION`, `MAX_DUNGEON_*` und weiter
// unten `sanitizeDungeonDocument`. Altformat, ersetzt durch
// `shared/src/dungeon2/layout.ts` (`DungeonLayout2`) und dessen
// Kanonisierung/Prüfsumme. Der Rest dieser Datei (Raum-Katalog,
// `getDungeonByHash` usw.) bleibt.
// LEGACY block (see `LEGACY.md`) — will be deleted once Dungeon Generator
// 2.0 succeeds: `PlacedRoom`, `DungeonPropDef`, `PlacedDoor`, `PlacedProp`,
// `DungeonLayout`, `DUNGEON_DOCUMENT_VERSION`, `MAX_DUNGEON_*`, and further
// below `sanitizeDungeonDocument`. Old format, replaced by
// `shared/src/dungeon2/layout.ts` (`DungeonLayout2`) and its
// canonicalization/checksum. The rest of this file (room catalog,
// `getDungeonByHash`, etc.) stays.
// ---------------------------------------------------------------------------

/** One placed room in a dungeon layout (local dungeon space, origin = entrance connector). */
export interface PlacedRoom {
  /** RoomDef name (must exist in the base dungeon's room kit). */
  room: string;
  pos: Vector3;
  rot: Quaternion;
  /** Depth in the growth tree (0 = start room). */
  placeOrder: number;
  /** Position-derived seed for random decoration variants. */
  seed: number;
  /**
   * Steinmaterial DIESER Platzierung (Dokumentversion 4, additiv). Unterste
   * Stufe der Mischkette Kit → Dokument → `RoomDef` → HIER: Es hängt an der
   * einzelnen Kammer statt am Raumtyp, und darum können zwei Räume DESSELBEN
   * Prefabs im selben Grab verschieden aussehen. Fehlt das Feld, ändert sich
   * nichts — der Sanitizer erfindet es nicht.
   * Per-PLACED-ROOM stone material (document version 4, additive) — the lowest
   * step of kit → document → RoomDef → this, so two rooms of the SAME prefab
   * in one dungeon can look different.
   */
  steinKit?: Partial<SteinKitConfig>;
}

/**
 * Ein Deko-Teil, das in diesem Kit gesetzt werden darf.
 *
 * WARUM AM KIT: Der Sanitizer muss „ist das ein erlaubtes Prefab?"
 * beantworten, ohne die Prefab-Registry zu kennen — `prefabs.ts` liest
 * seinerseits `DUNGEONS`, ein Import zurück wäre ein Ringschluss. Türen
 * lösen dasselbe Problem seit jeher über `doorTypes`; Deko geht denselben
 * Weg.
 *
 * Es ist auch die bessere Aussage: Nicht „jedes eigene Modell darf in jeden
 * Dungeon", sondern „dieses Kit kennt diese Teile". Ein Steingrab mit
 * Bienenstöcken wäre sonst nur eine Frage der Zeit.
 */
export interface DungeonPropDef {
  prefabName: string;
  prefabHash: number;
  /** Beschriftung im Editor-Katalog; fehlt sie, steht dort der Prefabname. */
  label?: string;
}

/** One placed door in a dungeon layout (local dungeon space). */
export interface PlacedDoor {
  prefabName: string;
  prefabHash: number;
  pos: Vector3;
  rot: Quaternion;
}

/**
 * Ein einzeln gesetztes Deko-Teil (lokaler Dungeon-Raum).
 *
 * Der Unterschied zur Raum-EINRICHTUNG (`roomPieces.ts`): Die hängt fest am
 * Raum-Prefab und kommt aus Fremddaten. Ein `PlacedProp` steht im Dokument,
 * hat jemand von Hand dorthin gestellt, und überlebt deshalb `dungeon regen`
 * und den Serverneustart.
 */
export interface PlacedProp {
  prefabName: string;
  prefabHash: number;
  pos: Vector3;
  rot: Quaternion;
  /**
   * Raum, zu dem dieses Teil gehört — Index in `layout.rooms`, oder -1 für
   * „gehört zu keinem".
   *
   * Er entscheidet, was beim Entfernen eines Raums mitgeht: Ohne ihn bliebe
   * eine Fackel in der Luft stehen, wo eben noch eine Wand war. Beim
   * Entfernen rutschen die Indizes der nachfolgenden Räume nach — s.
   * `removeRoom`.
   */
  roomIndex: number;
}

/** The complete geometry of one dungeon — rooms + doors in local space. */
export interface DungeonLayout {
  rooms: PlacedRoom[];
  doors: PlacedDoor[];
  /**
   * Von Hand gesetzte Deko. Additiv eingeführt (Dokumentversion 2): Ein
   * Dokument ohne dieses Feld lädt unverändert weiter, `props` wird dann
   * zur leeren Liste.
   */
  props: PlacedProp[];
}

/**
 * 1 → 2: `layout.props` dazugekommen (von Hand gesetzte Deko).
 * 2 → 3: `steinKit` dazugekommen (dokumenteigenes Steinmaterial). Ebenfalls
 * ADDITIV: Ein Dokument ohne das Feld lädt unverändert weiter, der Sanitizer
 * erfindet es nicht, und im Spiel gilt dann wie bisher die Kit-Vorgabe.
 *
 * Die Zahl steht im gespeicherten Dokument und ist rein informativ — der
 * Sanitizer schreibt sie beim Laden ohnehin auf den aktuellen Stand. Sie
 * dient dem Menschen, der sich eine Datei ansieht, und dem Fall, dass eine
 * künftige Änderung NICHT mehr additiv ist.
 *
 * 3 → 4: `PlacedRoom.steinKit` dazugekommen (Steinmaterial je PLATZIERTEM
 * Raum). Wieder ADDITIV wie `props` und das Dokument-`steinKit`: Räume ohne
 * das Feld laden unverändert weiter, der Sanitizer legt es nicht an, und im
 * Spiel gilt dann wie bisher Kit → Dokument → `RoomDef`.
 *
 * 4 → 5: `ambientLicht` dazugekommen (Grundbeleuchtung je Dokument, 0..3).
 * Wieder ADDITIV: Fehlt das Feld, erfindet der Sanitizer es nicht, und im
 * Spiel liegt wie bisher die unveränderte Umgebungsbeleuchtung an (Wirkung
 * 1). Das Vorbild ist `DungeonDokument2.ambientLicht` (Fassung 11) — hier
 * aber bis 3 statt bis 1: Ein 1.0-Grab hat keine gesetzten Lichtquellen wie
 * ein 2.0-Grab, es kann also auch HELLER als die Umgebung gebraucht werden.
 * 4 → 5: `ambientLicht` added (per-document base brightness, 0..3). Additive
 * as before; modeled on `DungeonDokument2.ambientLicht`, but up to 3 — a 1.0
 * barrow has no placed light sources and may need to be BRIGHTER, not only
 * darker, than the environment.
 *
 * 5 → 6: `generatorEinstellungen` dazugekommen (Raumzahl und Zonengrösse,
 * mit denen dieses Grab erzeugt wurde). Wieder ADDITIV: Fehlt das Feld,
 * erfindet der Sanitizer es nicht, und erzeugt wird wie bisher mit der
 * Kit-Vorgabe. Es steht IM DOKUMENT und nicht nur im Formular, weil
 * `dungeon regen` und das Neuwürfeln beim Betreten (M5b) sonst still auf
 * die Kit-Vorgabe zurückfielen — was als 6-Raum-Grab angelegt wurde, wäre
 * nach dem ersten Neuwürfeln ein 50-Raum-Grab, und niemand sähe, warum.
 * 5 → 6: `generatorEinstellungen` added (the room count and zone size this
 * barrow was generated with). Additive as before; stored in the DOCUMENT so
 * `dungeon regen` and regenerate-on-enter reuse them instead of silently
 * falling back to the kit default.
 */
export const DUNGEON_DOCUMENT_VERSION = 6;

/** Hard cap on rooms in a (user-editable) dungeon document. */
export const MAX_DUNGEON_ROOMS = 256;
export const MAX_DUNGEON_DOORS = 256;
/**
 * Obergrenze für gesetzte Deko.
 *
 * Grosszügiger als Räume und Türen, weil Deko das ist, wovon man viel
 * setzt: Eine Fackel alle acht Meter ergibt in einem 50-Raum-Grab schon
 * gut hundert. Eine Grenze braucht es trotzdem — das Dokument kommt vom
 * Client, und ohne sie wäre eine Datei beliebiger Grösse einladbar.
 */
export const MAX_DUNGEON_PROPS = 512;

/**
 * A saved dungeon with its own ID — either generated (reproducible from
 * base+seed, but stored materialized so it can be edited) or hand-built.
 */
export interface DungeonDocument {
  version: number;
  /** Unique dungeon ID, e.g. 'forestcrypt-a3f19c' — assignable to entrances. */
  id: string;
  /** Display name. */
  name: string;
  /** DG_* base — provides room kit, door types and interior environment. */
  base: string;
  mode: 'generated' | 'custom';
  /** Generation seed (also reused for decoration variants). */
  seed: number;
  /** Growth bounds used at generation time (informational for the editor). */
  zoneSize: number;
  layout: DungeonLayout;
  /**
   * Dokumenteigenes Steinmaterial (Dokumentversion 3, additiv). Liegt ÜBER
   * der Kit-Vorgabe (`DungeonDef.steinKit`) und UNTER dem Raum-Override
   * (`RoomDef.steinKit`) — so sehen zwei Gräber derselben Basis in einer
   * Sitzung verschieden aus, ohne dass das Kit angefasst wird. Fehlt es,
   * bleibt alles wie bisher.
   * Per-DOCUMENT stone material (document version 3, additive). Sits above
   * the kit default and below the per-room override.
   */
  steinKit?: Partial<SteinKitConfig>;
  /**
   * Grundbeleuchtung dieses Grabs (Dokumentversion 5, additiv), 0..3.
   *
   * Ein FAKTOR auf die Weltbeleuchtung, keine eigene Lichtquelle: 1 = wie
   * bisher (Umgebung unverändert), <1 dunkler, >1 heller. Fehlt das Feld,
   * bleibt alles wie zuvor — deshalb `?` und deshalb legt der Sanitizer es
   * nicht an. Wer den Ersatzwert braucht, nimmt {@link ambientLichtVon}.
   *
   * 0 ist ein GÜLTIGER Wert (stockdunkel) und ausdrücklich etwas anderes
   * als „fehlt": Ein Grab, das nur von seinen Fackeln lebt, sagt das hier,
   * und es darf beim Speichern nicht auf 1 zurückfallen.
   * Per-document base brightness (document version 5, additive), 0..3. A
   * FACTOR on the world lighting, not a light of its own: 1 = unchanged.
   * Absent means unchanged; 0 is a VALID value (pitch dark), not "absent".
   */
  ambientLicht?: number;
  /**
   * Womit dieses Grab erzeugt wurde (Dokumentversion 6, additiv).
   *
   * NUR die beiden Stellschrauben, die der Editor anbietet: `maxRooms` ist
   * die Zahl der WACHSTUMSVERSUCHE (ein Kit-Wert, deshalb als Kopie des
   * `def` übergeben, nicht als Generator-Einstellung), `zoneSize` der
   * Wachstumsraum (eine echte Generator-Einstellung, deshalb als
   * `settingsIn`). Fehlt das Feld, gilt wie bisher die Kit-Vorgabe.
   *
   * Es steht hier und nicht nur im Formular, weil das Dokument die einzige
   * Stelle ist, die ein späteres `dungeon regen` noch lesen kann — das
   * Formular ist dann längst zu. Ein Grab, das dabei stillschweigend auf
   * die Kit-Vorgabe zurückfiele, wäre ein anderes Grab.
   * How this barrow was generated (document version 6, additive): the two
   * knobs the editor offers. `maxRooms` is a kit value (passed as a copy of
   * the `def`), `zoneSize` a generator setting (passed as `settingsIn`).
   * Absent means the kit default, as before.
   */
  generatorEinstellungen?: DokumentGeneratorEinstellungen;
}

/**
 * Die im Dokument gespeicherten Generator-Stellschrauben.
 *
 * Absichtlich NICHT `Partial<DungeonGeneratorSettings>`: Von den vielen
 * Einstellungen des Generators sind nur diese im Editor bedienbar und
 * geprüft. Ein offenes `Partial` hier hiesse, dass ein Dokument vom
 * Client jeden Generator-Schalter umlegen dürfte — und für die meisten
 * gibt es weder ein Feld noch eine Grenze.
 */
export interface DokumentGeneratorEinstellungen {
  /** Wachstumsversuche (Kit-`maxRooms`), geklemmt auf [1, MAX_DUNGEON_ROOMS]. */
  maxRooms?: number;
  /** Wachstumsraum in Metern, geklemmt auf [MIN_DUNGEON_ZONE, MAX_DUNGEON_ZONE]. */
  zoneSize?: number;
  /**
   * Anteil der Rasternachbarschaften ohne Baumkante, die zum Durchgang
   * werden (Rasterpfad, additiv, 0…1). In der Konzeptnotiz heisst der
   * Regler `schleifenAnteil`, im Formular „Schleifen"; der Bezeichner ist
   * englisch wie alles Neue seit dem 27.08. — dieselbe Übersetzung, die
   * `rasterKanten` zu `RoomDef.gridEdges` gemacht hat.
   *
   * Er ist Mikes Regler gegen „zu verwinkelt": Jede Nachbarschaft, die
   * zur Kante wird, ist ein Durchgang STATT einer Doppelwand.
   * Fraction of grid adjacencies without a tree edge that become passages.
   */
  loopFraction?: number;
  /**
   * Anteil der Verbindungen, die einen Torbogen bekommen (Rasterpfad,
   * additiv, 0…1). Konzeptnotiz: `torbogenAnteil`, Formular „Torbögen".
   *
   * Zwischen zwei GANGzellen entsteht nie ein Bogen, an Raumübergängen
   * bevorzugt — die Zahl ist die Wahrscheinlichkeit am Übergang, nicht
   * über alle Kanten gemittelt.
   * Fraction of graph edges that get an archway.
   */
  archwayFraction?: number;
}

/** Grenzen des Wachstumsraums für `generatorEinstellungen.zoneSize`. */
export const MIN_DUNGEON_ZONE = 8;
export const MAX_DUNGEON_ZONE = 256;

/**
 * Unbeglaubigte `generatorEinstellungen` säubern — dasselbe Muster wie
 * {@link sanitizeSteinKit}: Was sich nicht als endliche Zahl lesen lässt,
 * FÄLLT WEG, statt das ganze Dokument abzulehnen. Bleibt nichts übrig,
 * kommt `undefined` zurück und das Dokument trägt das Feld gar nicht.
 *
 * Eigene Funktion, weil sie zwei Aufrufer bekommt: den Dokument-Sanitizer
 * und den Weg über `DungeonManager.createGenerated` — zwei Prüfungen
 * derselben Sache driften auseinander.
 * Sanitize untrusted `generatorEinstellungen`; unreadable fields drop out
 * instead of rejecting the document.
 */
export function sanitizeGeneratorEinstellungen(
  roh: unknown
): DokumentGeneratorEinstellungen | undefined {
  if (!roh || typeof roh !== 'object') return undefined;
  const o = roh as Record<string, unknown>;
  const ganzzahl = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(min, Math.min(max, Math.trunc(v)))
      : undefined;
  // Die beiden Regler des Rasterpfads sind ANTEILE, keine Zählungen: Sie
  // dürfen NICHT durch `Math.trunc` — das machte aus jedem Wert unter 1
  // eine 0, und der Regler wäre lautlos ein Schalter.
  const anteil = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined;
  const maxRooms = ganzzahl(o.maxRooms, 1, MAX_DUNGEON_ROOMS);
  const zoneSize = ganzzahl(o.zoneSize, MIN_DUNGEON_ZONE, MAX_DUNGEON_ZONE);
  const loopFraction = anteil(o.loopFraction);
  const archwayFraction = anteil(o.archwayFraction);
  if (
    maxRooms === undefined &&
    zoneSize === undefined &&
    loopFraction === undefined &&
    archwayFraction === undefined
  ) {
    return undefined;
  }
  return {
    ...(maxRooms !== undefined ? { maxRooms } : {}),
    ...(zoneSize !== undefined ? { zoneSize } : {}),
    ...(loopFraction !== undefined ? { loopFraction } : {}),
    ...(archwayFraction !== undefined ? { archwayFraction } : {}),
  };
}

/**
 * Die Grundbeleuchtung eines 1.0-Dokuments — fehlendes Feld heisst 1
 * („Umgebung wie bisher").
 *
 * Die EINE Stelle, an der aus „fehlt" eine Zahl wird. Stünde der Ersatzwert
 * an jeder Aufrufstelle neu, driftete er dort auseinander, wo ihn niemand
 * ansieht — und ausgerechnet die 0 (stockdunkel) sähe dann aus wie ein
 * fehlendes Feld.
 * The base brightness of a 1.0 document; absent means 1. The ONE place where
 * "absent" turns into a number.
 */
export function ambientLichtVon(doc: DungeonDocument): number {
  return doc.ambientLicht ?? 1;
}

/** Obergrenze der Grundbeleuchtung (0 = stockdunkel, 1 = wie die Umgebung). */
export const MAX_DUNGEON_AMBIENT = 3;

/**
 * Interior lighting environment per dungeon base (Unity
 * Location.m_interiorEnvironment — the EnvZone the location prefab forces
 * inside its interior box). Names must exist in envData.json.
 */
const INTERIOR_ENV: ReadonlyMap<string, string> = new Map([
  ['DG_ForestCrypt', 'Crypt'],
  ['DG_Hildir_ForestCrypt', 'CryptHildir'],
  ['DG_SunkenCrypt', 'SunkenCrypt'],
  ['DG_Cave', 'Caves'],
  ['DG_Hildir_Cave', 'CavesHildir'],
  ['DG_DvergrBoss', 'Darklands_dark'],
  ['DG_DvergrTown', 'Darklands_dark'],
  // Modul-Kit ohne eigene Lichtquellen (der 1.0-Generator setzt keine
  // Props): `Crypt` hat lightIntensity 0 und ist ohne Fackeln stockdunkel
  // (Spielprobe 03.09.2026). `Caves` bringt 0,1 Grundlicht mit — genug,
  // um Geometrie zu sehen, dunkel genug, dass gesetzte Fackeln wirken.
  ['DG_StoneVault', 'Caves'],
]);

/** Lighting environment for a dungeon base ('Crypt' as always-dark fallback). */
export function interiorEnvironment(base: string): string {
  return INTERIOR_ENV.get(base) ?? 'Crypt';
}

/**
 * DG_* bases that must NOT become standalone instances. PlainsFortress is
 * algorithm=Dungeon on paper, but it is an above-ground fortress whose
 * generation fills every wall slot with endcaps (measured: ~8 000 rooms
 * per run) — materializing that as an instance would create 60k+ ZDOs.
 */
const NOT_INSTANCEABLE = new Set(['DG_Hildir_PlainsFortress']);

/** Whether a DG_* base may be materialized as a standalone instance. */
export function isInstanceableDungeon(def: DungeonDef): boolean {
  return def.algorithm === DungeonAlgorithm.Dungeon && !NOT_INSTANCEABLE.has(def.name);
}

/**
 * Visible entrance hulls (Phase G): the exterior model of a dungeon
 * location is NOT a ZNetView piece — in Unity it is static geometry of the
 * location prefab, reconstructed client-side via LocationProxy. We spawn
 * it as a plain static ZDO instead; these are the location-hull GLBs from
 * the asset export (feature name = model name, all verified present).
 */
export const ENTRANCE_HULL_MODELS: ReadonlySet<string> = new Set([
  'Crypt2',
  'Crypt3',
  'Crypt4',
  'SunkenCrypt4',
  'MountainCave02',
  'Hildir_cave',
  'Hildir_crypt',
  'Mistlands_DvergrTownEntrance1',
  'Mistlands_DvergrTownEntrance2',
  'Mistlands_DvergrBossEntrance1',
]);

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export function isValidDungeonId(id: string): boolean {
  return ID_RE.test(id);
}

function sanitizeVec3(v: unknown): Vector3 {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { x: n(o.x), y: n(o.y), z: n(o.z) };
}

function sanitizeQuat(q: unknown): Quaternion {
  const o = (q ?? {}) as Record<string, unknown>;
  const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const raw = { x: n(o.x, 0), y: n(o.y, 0), z: n(o.z, 0), w: n(o.w, 1) };
  const m = Math.sqrt(raw.x * raw.x + raw.y * raw.y + raw.z * raw.z + raw.w * raw.w);
  if (m < 1e-6) return { x: 0, y: 0, z: 0, w: 1 };
  // Only repair truly degenerate quaternions — normalizing healthy ones
  // would shift f32-precision generator output on every save/load cycle.
  if (Math.abs(m - 1) < 1e-3) return raw;
  return { x: raw.x / m, y: raw.y / m, z: raw.z / m, w: raw.w / m };
}

/**
 * Ein unbeglaubigtes `steinKit` säubern — Texturen NUR aus
 * {@link STEIN_TEXTUREN}, Zahlen geklemmt. `undefined`, wenn nichts
 * Brauchbares übrig bleibt (dann trägt das Dokument das Feld gar nicht,
 * und es gilt wie bisher die Kit-Vorgabe).
 *
 * Eigene Funktion, weil sie ZWEI Aufrufer hat: den Dokument-Sanitizer und
 * den Konsolenbefehl `dungeon steinkit …`. Zwei Prüfungen derselben Sache
 * driften auseinander, und das Loch entsteht dann im selten benutzten Weg.
 * Sanitize an untrusted `steinKit`; shared by the document sanitizer and the
 * `dungeon steinkit` console command so both can never drift apart.
 */
export function sanitizeSteinKit(roh: unknown): Partial<SteinKitConfig> | undefined {
  if (!roh || typeof roh !== 'object') return undefined;
  const o = roh as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const feld of ['wandTextur', 'deckeTextur', 'bodenTextur', 'moosTextur', 'frostTextur', 'nassTextur'] as const) {
    if (o[feld] === undefined) continue;
    // Ein Pfad AUSSERHALB der Liste wird verworfen, nicht ersetzt: Ein
    // stiller Ersatzwert sähe im Spiel aus wie eine Angabe.
    const pfad = steinTexturAufloesen(o[feld]);
    if (pfad) out[feld] = pfad;
  }

  const klemme = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : undefined;

  const vRoh = (o.verwitterung ?? undefined) as Record<string, unknown> | undefined;
  if (vRoh && typeof vRoh === 'object') {
    const v: Record<string, number> = {};
    for (const k of ['moos', 'frost', 'nass'] as const) {
      const z = klemme(vRoh[k], 0, STEIN_VERWITTERUNG_MAX);
      if (z !== undefined) v[k] = z;
    }
    if (Object.keys(v).length > 0) out.verwitterung = v;
  }

  for (const [feld, min, max] of [
    ['kachelM', 0.05, 64],
    ['deckeKachelM', 0.05, 64],
    ['moosSkala', 0.1, 256],
    ['frostSkala', 0.1, 256],
    ['nassSkala', 0.1, 256],
    ['deckeSchwelle', 0, 1],
  ] as const) {
    const z = klemme(o[feld], min, max);
    if (z !== undefined) out[feld] = z;
  }

  return Object.keys(out).length > 0 ? (out as Partial<SteinKitConfig>) : undefined;
}

/**
 * Validate/clamp an untrusted dungeon document (editor upload, disk file).
 * Never throws; returns null only when the document is beyond repair
 * (unknown base dungeon or unusable ID). Unknown rooms are dropped.
 */
export function sanitizeDungeonDocument(input: unknown): DungeonDocument | null {
  const o = (input ?? {}) as Record<string, unknown>;

  const id = typeof o.id === 'string' ? o.id.toLowerCase() : '';
  if (!isValidDungeonId(id)) return null;

  const base = typeof o.base === 'string' ? o.base : '';
  const def = DUNGEONS_BY_NAME.get(base);
  if (!def) return null;

  const roomsByName = new Map(def.rooms.map((r) => [r.name, r]));
  const doorHashes = new Set(def.doorTypes.map((d) => d.prefabHash));

  const propHashes = new Map((def.propTypes ?? []).map((p) => [p.prefabHash, p]));

  const layoutIn = (o.layout ?? {}) as Record<string, unknown>;
  const roomsIn = Array.isArray(layoutIn.rooms) ? layoutIn.rooms : [];
  const doorsIn = Array.isArray(layoutIn.doors) ? layoutIn.doors : [];
  // Fehlt `props` ganz, ist das ein Dokument der Version 1 — es laedt
  // unveraendert weiter und bekommt eine leere Liste.
  const propsIn = Array.isArray(layoutIn.props) ? layoutIn.props : [];

  const rooms: PlacedRoom[] = [];
  for (const r of roomsIn.slice(0, MAX_DUNGEON_ROOMS)) {
    const ro = (r ?? {}) as Record<string, unknown>;
    const name = typeof ro.room === 'string' ? ro.room : '';
    if (!roomsByName.has(name)) continue;
    // Raum-Override (Version 4) durch DENSELBEN Sanitizer wie das Dokument —
    // gleiche Erlaubnisliste, gleiche Klemmung. Bleibt nichts Gültiges übrig,
    // trägt der Raum das Feld gar nicht erst (additiv wie `props`).
    // Per-placed-room override (version 4) through the SAME sanitizer as the
    // document; nothing valid left → the field is not created at all.
    const raumSteinKit = sanitizeSteinKit(ro.steinKit);
    rooms.push({
      room: name,
      pos: sanitizeVec3(ro.pos),
      rot: sanitizeQuat(ro.rot),
      placeOrder:
        typeof ro.placeOrder === 'number' && Number.isFinite(ro.placeOrder)
          ? Math.max(0, Math.min(1024, Math.trunc(ro.placeOrder)))
          : 0,
      seed: typeof ro.seed === 'number' && Number.isFinite(ro.seed) ? ro.seed | 0 : 0,
      ...(raumSteinKit ? { steinKit: raumSteinKit } : {}),
    });
  }
  if (rooms.length === 0) return null;

  const doors: PlacedDoor[] = [];
  for (const d of doorsIn.slice(0, MAX_DUNGEON_DOORS)) {
    const doorObj = (d ?? {}) as Record<string, unknown>;
    const hash =
      typeof doorObj.prefabHash === 'number' && Number.isFinite(doorObj.prefabHash)
        ? doorObj.prefabHash | 0
        : 0;
    if (!doorHashes.has(hash)) continue;
    const doorDef = def.doorTypes.find((t) => t.prefabHash === hash)!;
    doors.push({
      prefabName: doorDef.prefabName,
      prefabHash: hash,
      pos: sanitizeVec3(doorObj.pos),
      rot: sanitizeQuat(doorObj.rot),
    });
  }

  // ── Deko ─────────────────────────────────────────────────────────
  //
  // Geprueft wird gegen die `propTypes` DIESES Kits, nicht gegen „alle
  // eigenen Modelle". Das Dokument kommt vom Client; ein beliebiger Hash
  // von aussen wuerde sonst zu einem ZDO, zu dem niemand ein Modell hat —
  // unsichtbar, unloeschbar, und in keiner Fehlermeldung.
  //
  // Der Name kommt aus dem Kit und nicht aus dem Dokument: Sonst stuende
  // im Dokument ein Name, der zum Hash nicht passt, und der Server baute
  // daraus zwei verschiedene Wahrheiten.
  const props: PlacedProp[] = [];
  for (const p of propsIn.slice(0, MAX_DUNGEON_PROPS)) {
    const po = (p ?? {}) as Record<string, unknown>;
    const hash =
      typeof po.prefabHash === 'number' && Number.isFinite(po.prefabHash)
        ? po.prefabHash | 0
        : 0;
    const propDef = propHashes.get(hash);
    if (!propDef) continue;
    const roh =
      typeof po.roomIndex === 'number' && Number.isFinite(po.roomIndex)
        ? Math.trunc(po.roomIndex)
        : -1;
    props.push({
      prefabName: propDef.prefabName,
      prefabHash: hash,
      pos: sanitizeVec3(po.pos),
      rot: sanitizeQuat(po.rot),
      // Auf die Raeume begrenzen, die es nach dem Saeubern WIRKLICH gibt.
      // Ein Verweis ins Leere waere kein Absturz, aber `removeRoom` raeumte
      // dann fuer immer am falschen Ende auf.
      roomIndex: roh >= 0 && roh < rooms.length ? roh : -1,
    });
  }

  // Dokumenteigenes Steinmaterial (Version 3) — additiv wie `props`: Fehlt
  // es, wird das Feld NICHT angelegt, und das Dokument sieht aus wie zuvor.
  const steinKit = sanitizeSteinKit(o.steinKit);

  // Grundbeleuchtung (Version 5) — dasselbe additive Muster: NUR endliche
  // Zahlen, auf [0, MAX_DUNGEON_AMBIENT] geklemmt; alles andere (Text, NaN,
  // Unendlich, fehlend) lässt das Feld ungesetzt, statt das Dokument
  // ungültig zu machen. Ein Grab wegen einer unlesbaren Helligkeit gar nicht
  // mehr laden zu können wäre der schlechtere Tausch.
  // Base brightness (version 5) — finite numbers only, clamped; anything else
  // leaves the field unset rather than rejecting the whole document.
  const ambientLicht =
    typeof o.ambientLicht === 'number' && Number.isFinite(o.ambientLicht)
      ? Math.max(0, Math.min(MAX_DUNGEON_AMBIENT, o.ambientLicht))
      : undefined;

  // Generator-Stellschrauben (Version 6) — wieder additiv: Bleibt nach dem
  // Klemmen nichts uebrig, traegt das Dokument das Feld gar nicht, und es
  // gilt wie bisher die Kit-Vorgabe.
  const generatorEinstellungen = sanitizeGeneratorEinstellungen(o.generatorEinstellungen);

  return {
    version: DUNGEON_DOCUMENT_VERSION,
    ...(steinKit ? { steinKit } : {}),
    ...(generatorEinstellungen ? { generatorEinstellungen } : {}),
    // `!== undefined` und nicht `? :` — 0 ist ein gültiger Wert und fiele
    // sonst still weg (dann wäre stockdunkel nicht speicherbar).
    // `!== undefined`, not truthiness: 0 is a valid value.
    ...(ambientLicht !== undefined ? { ambientLicht } : {}),
    id,
    name:
      typeof o.name === 'string' && o.name.trim().length > 0
        ? o.name.trim().slice(0, 64)
        : id,
    base,
    mode: o.mode === 'custom' ? 'custom' : 'generated',
    seed: typeof o.seed === 'number' && Number.isFinite(o.seed) ? o.seed | 0 : 0,
    zoneSize:
      typeof o.zoneSize === 'number' && Number.isFinite(o.zoneSize)
        ? Math.max(16, Math.min(512, o.zoneSize))
        : 64,
    layout: { rooms, doors, props },
  };
}
