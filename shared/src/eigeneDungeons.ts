/**
 * BLEIBT — Grundlage des Connector-Modul-Kits (`DG_StoneVault`),
 * Entscheidung 03.09.2026, s. Vault-Notiz „Workflow — Connector-Modul-Kit"
 * und `LEGACY.md`. Diese Datei war bis dahin als Abriss-Kandidat gefuehrt
 * („wird nach Erfolg von Dungeon Generator 2.0 geloescht"); sie ist es
 * NICHT mehr. Der zellbasierte Weg (`shared/src/dungeon2/`) und der
 * Connector-Weg laufen nebeneinander: jener wuerfelt, dieser wird von Hand
 * gesetzt.
 * STAYS — foundation of the connector module kit (`DG_StoneVault`),
 * decision 2026-09-03, see the vault note "Workflow — Connector-Modul-Kit"
 * and `LEGACY.md`. Previously listed for deletion; no longer. The
 * cell-based path (`shared/src/dungeon2/`) and the connector path run side
 * by side.
 *
 * Eigene Dungeon-Kits — der Gegenentwurf zu `dungeonsData.json`.
 *
 * ── Warum das eine eigene Datei ist ──────────────────────────────────
 * `dungeonsData.json` ist ERZEUGT: `tools/prefab-parser/parse-dungeons.ts`
 * schreibt sie aus der Fremdvorlage neu. Ein eigenes Kit, das dort hinein
 * geschrieben würde, verschwände beim nächsten Parserlauf — lautlos, und
 * bemerkt würde es erst, wenn jemand einen Dungeon öffnet, den es nicht
 * mehr gibt. Also steht es hier, in einer Datei, die der Parser nicht
 * anfasst, und `dungeons.ts` hängt beide Quellen aneinander.
 *
 * ── Der Bauteil-Vertrag ──────────────────────────────────────────────
 * Wer hier ein Teil einträgt, verspricht, dass die GLB dazu passt. Was
 * genau versprochen wird, prüft `dungeonRaster.ts` (Raster 4 m, Herleitung
 * im Kopf dort). In Blender heisst das:
 *
 *  • **Ursprung** liegt auf dem BODEN und in der Mitte der Grundfläche.
 *    Der Boden ist y = 0, die Decke y = `size.y`. `size` ist die volle
 *    Kantenlänge der Hüllbox, nicht die halbe.
 *  • **Grundfläche** ist ein Vielfaches von 4 m in x und z.
 *  • **Connectors** sitzen auf einer der vier senkrechten Hüllflächen,
 *    also bei x = ±size.x/2 oder z = ±size.z/2, immer auf **y = 0**.
 *    Ein Connector auf halber Höhe lässt Räume gegeneinander treppen.
 *  • **Connector-Drehung** ist ein Vielfaches von 90° um die Hochachse
 *    und zeigt aus dem Raum HINAUS. `attachRoom` dreht den Gegenraum um
 *    180° dagegen — zeigt ein Connector nach innen, sitzt der Nachbar im
 *    Raum statt daneben.
 *  • **Dateiname** ist der Prefabname: `assets/models/<name>.glb`. Die
 *    Registry legt den Eintrag selbst an (`prefabs.ts`, Schleife über
 *    `DUNGEONS`), der Name muss zusätzlich in `EIGENE_MODELLE` stehen.
 *
 * ── Stand des Startsatzes ────────────────────────────────────────────
 * Gebaut sind Gang, Ecke, Endkappe, Kreuzung, Türöffnung und Grabkammer. Es
 * fehlt allein die **Treppe**; sie kommt als eigener Eintrag dazu,
 * sobald ihr Modell steht.
 *
 * `SteingrabGang` und `SteingrabGangDurch` sind DASSELBE Modell in zwei
 * Rollen — der Generator wählt Folgeräume ausdrücklich unter den
 * NICHT-Eingangsräumen aus, und ohne die zweite Rolle könnte der einzige
 * gerade Gang nie ein zweites Mal gesetzt werden. Die Datei dahinter
 * teilen sie über `MODELL_ALIAS`.
 */
import type { DungeonGeneratorSettings } from './dungeonGenerator.js';
import { getStableHash } from './hash.js';
import type { DungeonPropDef, GridGenerationDef, SteinKitConfig } from './dungeons.js';
import { MODULE_CELL_M, MODULE_LEVEL_M, type GridEdgeDef } from './dungeonRasterModul.js';
import type { Quaternion, Vector3 } from './types.js';

/*
  Zahlen statt Aufzählungstypen, und zwar mit Absicht: `RoomTheme` und
  `DungeonAlgorithm` stehen in `dungeons.ts`, und `dungeons.ts` liest
  diese Datei. Ein Import zurück wäre ein Ringschluss — bei Typen
  harmlos, bei Aufzählungen ein Wert, der zur Ladezeit noch nicht da
  ist. Deshalb hier die Zahl mit dem Namen daneben.
*/
/** `RoomTheme.Crypt` — das Thema des ersten eigenen Kits. */
const THEMA_KRYPTA = 1;
/** `DungeonAlgorithm.Dungeon` — Räume über Connectors, keine Camp-Streuung. */
const ALGORITHMUS_DUNGEON = 0;

const NULL_PUNKT: Vector3 = { x: 0, y: 0, z: 0 };
const KEINE_DREHUNG: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
/** 180° um die Hochachse — der Connector zeigt nach −z statt nach +z. */
const HALBE_DREHUNG: Quaternion = { x: 0, y: 1, z: 0, w: 0 };
/** 90° um die Hochachse — aus „nach +z“ wird „nach +x“. */
const VIERTEL_DREHUNG: Quaternion = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
/** −90° um die Hochachse — aus „nach +z“ wird „nach −x“. */
const VIERTEL_DREHUNG_ZURUECK: Quaternion = {
  x: 0,
  y: -Math.SQRT1_2,
  z: 0,
  w: Math.SQRT1_2,
};

/**
 * Kopplungstyp der Zellkanten im Modul-Kit `DG_StoneVault`.
 *
 * Der Generator koppelt Räume nur an Connectors GLEICHEN Typs
 * (`haveConnection`), und `placeDoors` sucht Türtypen ebenso über
 * Typgleichheit. Alle Fremdkits und das Steingrab tragen den LEEREN Typ —
 * ein eigener String hier hält das 2-m-Raster für sich, statt sich an
 * einen 4-m-Gang zu hängen, sobald jemand Kits mischt.
 */
const TYP_ZELLKANTE = 'cellEdge';

/**
 * Dieselbe Form wie ein Eintrag in `dungeonsData.json`: ohne `hash`, den
 * `dungeons.ts` für beide Quellen gleich berechnet, und mit `algorithm`
 * als Zahl.
 */
export interface EigenesKitJson {
  readonly name: string;
  /** Abweichungen von DEFAULT_GENERATOR_SETTINGS — s. `DungeonDef`. */
  readonly generatorEinstellungen?: Partial<DungeonGeneratorSettings>;
  /** Setzbare Deko dieses Kits — s. `DungeonPropDef`. */
  readonly propTypes?: readonly DungeonPropDef[];
  /** KI-Steinmaterial (Wand/Decke/Boden + Verwitterung) — s. `SteinKitConfig`. */
  readonly steinKit?: SteinKitConfig;
  /** Schalter auf den Rasterpfad — s. `DungeonDef.gridGeneration`. */
  readonly gridGeneration?: GridGenerationDef;
  readonly interiorPosition: Vector3 | null;
  readonly originalPosition: Vector3 | null;
  readonly algorithm: number;
  readonly alternativeFunctionality: boolean;
  readonly campRadiusMax: number;
  readonly campRadiusMin: number;
  readonly doorChance: number;
  readonly doorTypes: readonly {
    readonly prefabName: string;
    readonly prefabHash: number;
    readonly connectionType: string;
    readonly chance: number;
  }[];
  readonly gridSize: number;
  readonly maxRooms: number;
  readonly maxTilt: number;
  readonly minAltitude: number;
  readonly minRequiredRooms: number;
  readonly minRooms: number;
  readonly perimeterBuffer: number;
  readonly perimeterSections: number;
  readonly requiredRooms: readonly string[];
  readonly spawnChance: number;
  readonly themes: number;
  readonly tileWidth: number;
  readonly rooms: readonly {
    readonly name: string;
    readonly divider: boolean;
    readonly endCap: boolean;
    readonly endCapPrio: number;
    readonly entrance: boolean;
    readonly faceCenter: boolean;
    readonly minPlaceOrder: number;
    readonly perimeter: boolean;
    readonly size: Vector3;
    readonly theme: number;
    readonly weight: number;
    readonly pos: Vector3;
    readonly rot: Quaternion;
    readonly connections: readonly {
      readonly type: string;
      readonly entrance: boolean;
      readonly allowDoor: boolean;
      readonly doorOnlyIfOtherAlsoAllowsDoor: boolean;
      readonly localPos: Vector3;
      readonly localRot: Quaternion;
    }[];
    /** Raum-Override des Steinmaterials — s. `RoomDef.steinKit`. */
    readonly steinKit?: Partial<SteinKitConfig>;
    /** Kantenerklärung des Rastergenerators — s. `RoomDef.gridEdges`. */
    readonly gridEdges?: readonly GridEdgeDef[];
  }[];
}

/**
 * Das Steingrab — erstes eigenes Kit.
 *
 * `doorTypes` trägt seit dem 26.08.2026 die Türöffnung. Vorher war es
 * bewusst leer: Ein Türtyp ohne GLB setzte unsichtbare Türen in jeden
 * Durchgang, und die stünden als Hash im gespeicherten Dokument, wo sie
 * später niemand mehr von echten unterscheidet.
 *
 * `interiorPosition` bleibt null. Das Feld trägt in der Vorlage den
 * Versatz innerhalb eines Location-Prefabs; im Projekt liest es niemand
 * (geprüft), und die Instanz bekommt ihren Ursprung ohnehin vom
 * `DungeonManager` zugewiesen.
 */
export const EIGENE_KITS: readonly EigenesKitJson[] = [
  {
    name: 'DG_Steingrab',
    /*
      Abschlüsse prüfen sich hier gegen die schon gesetzten Räume — anders
      als in der Vorlage, wo sie ausgenommen sind.

      Der Vorgabewert `false` bildet das Original ab: Dort sind Abschlüsse
      dünne Verschlussstücke, deren Überschneidung folgenlos bleibt. Dieses
      Kit hat mit `SteingrabEndkappe` aber eine begehbare Grabnische von
      4 × 4 × 4 m an dieser Stelle, und die verschwand damit reihenweise im
      Stein ihres Nachbarn: Über 40 Seeds gemessen 268 von 553 Abschlüssen,
      340 Überschneidungen gegen 0 ohne Abschlüsse.

      WICHTIG — der Schalter allein reicht NICHT, es braucht alle drei
      Teile zusammen:

        1. `SteingrabAbschluss` als Ausweichteil. Mit nur EINEM
           Abschlusstyp landet jede abgelehnte Nische sofort im
           Notfallzweig, und die Messung ist auf die Überschneidung genau
           dieselbe — nachgeprüft, nicht vermutet.
        2. `endcapsCollision`, damit die Nische überhaupt geprüft wird.
        3. `endcapsFallbackByPrio`, damit der Notfallzweig den ANSPRUCHS-
           LOSESTEN nimmt. Ohne ihn greift er auf `endCaps[0]` zu — und
           `findEndCaps` MISCHT die Liste, der Zugriff trifft also einen
           beliebigen. Gemessen: 163 Notfallsetzungen über 40 Seeds,
           ausnahmslos die Nische.

      Die Reihenfolge der Räume in diesem Kit spielt dabei KEINE Rolle.
      Wer sich darauf verlässt, verlässt sich auf eine Liste, die vorher
      durchgemischt wird.
    */
    generatorEinstellungen: { endcapsCollision: true, endcapsFallbackByPrio: true, roomBodyFromFloor: true },
    // KI-Steinmaterial: Wand/Boden heller Bruchstein, Decke Wikinger-Holz, dazu
    // elementübergreifend eingestreutes Moos/Frost/Nass. Der Client (EntityManager
    // → DungeonSteinMaterial) legt daraus ein PBRMaterial auf die Kit-Master.
    // Texturen liegen unter assets/models/. Werte = die im Prüfstand bestätigten.
    steinKit: {
      wandTextur: '/assets/models/stein_clean.png',
      deckeTextur: '/assets/models/stein_decke.png',
      bodenTextur: '/assets/models/stein_clean.png',
      verwitterung: { moos: 1.0, frost: 0.9, nass: 0.9 },
      kachelM: 2,
      deckeKachelM: 4,
      moosSkala: 9,
      frostSkala: 11,
      nassSkala: 8,
      deckeSchwelle: 0.45,
    },
    interiorPosition: null,
    originalPosition: null,
    algorithm: ALGORITHMUS_DUNGEON,
    alternativeFunctionality: false,
    campRadiusMax: 0,
    campRadiusMin: 0,
    /*
      Wie oft eine Verbindung eine Tuer bekommt, wenn der Tuertyp selbst
      keine eigene Wahrscheinlichkeit mitbringt. Nicht jede: Ein Grab, in
      dem hinter jedem Durchgang ein Sturz steht, liest sich wie ein
      Buerogang.
    */
    doorChance: 0.35,
    doorTypes: [
      {
        /*
          Die Tueroeffnung. Sie ist KEIN Raum und steht deshalb hier statt
          in `rooms`: `placeDoors` im Generator setzt sie auf
          `connection.pos` mit `connection.rot`, also genau in die
          Kopplungsebene zwischen zwei Raeumen.

          `chance: 0` heisst nicht "nie", sondern "keine eigene
          Wahrscheinlichkeit" — dann entscheidet `doorChance` des Kits.
          So liest der Generator es (`doorDef.chance <= 0 || ...`).

          Der leere `connectionType` passt auf die Connectors aller
          eigenen Raeume; die tragen ebenfalls den leeren Typ.
        */
        prefabName: 'SteingrabTuer',
        prefabHash: getStableHash('SteingrabTuer'),
        connectionType: '',
        chance: 0,
      },
    ],
    /*
      Was in diesem Grab gesetzt werden darf.

      Die Liste steht am KIT und nicht an „allen eigenen Modellen": Der
      Sanitizer prueft gegen sie, und der Editor liest sie als Katalog.
      Beides aus einer Quelle — sonst zeigt der Katalog irgendwann etwas
      an, das der Server danach wegwirft, und niemand versteht, warum die
      gesetzte Fackel nach dem Speichern fehlt.

      Es ist auch die richtige Aussage: nicht „jedes eigene Modell darf in
      jeden Dungeon", sondern „dieses Kit kennt diese Teile".
    */
    propTypes: [
      {
        prefabName: 'CryptWallTorch',
        prefabHash: getStableHash('CryptWallTorch'),
        label: 'Wandfackel',
      },
    ],
    gridSize: 4,
    // Zahl der VERSUCHE, nicht der Räume — so heisst das Feld in der
    // Vorlage, und so wertet der Generator es aus.
    maxRooms: 32,
    maxTilt: 10,
    minAltitude: 0,
    minRequiredRooms: 0,
    minRooms: 1,
    perimeterBuffer: 0,
    perimeterSections: 0,
    requiredRooms: [],
    spawnChance: 0,
    themes: THEMA_KRYPTA,
    tileWidth: 0,
    rooms: [
      {
        // 4 m breit, 4 m hoch, 8 m lang. Zwei Spieler passen
        // nebeneinander, die Figur ist 1,8 m hoch.
        name: 'SteingrabGang',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        // Der eine Eingangsraum des Kits: Der Generator setzt ihn so,
        // dass sein Eingangs-Connector auf (0,0,0) landet.
        entrance: true,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 4, y: 4, z: 8 },
        theme: THEMA_KRYPTA,
        weight: 1,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            // Der Eingang. Liegt auf der hinteren Hüllfläche und zeigt
            // nach draussen (−z).
            type: '',
            entrance: true,
            allowDoor: false,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -4 },
            localRot: HALBE_DREHUNG,
          },
          {
            // Das andere Ende, an das weitergebaut wird.
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 4 },
            localRot: KEINE_DREHUNG,
          },
        ],
      },
      {
        /*
          Die Treppe — das erste Bauteil, das zwei Ebenen verbindet.

          ── Warum 8 m und nicht 4 ────────────────────────────────────
          Ausfuehrlich bei `DUNGEON_EBENE_M` in dungeonRaster.ts. Kurz:
          Bei 4 m Stufenhoehe laegen die Bodenplatte des oberen Gangs
          (3,64 … 4,00) und die Decke des unteren (3,60 … 4,00)
          ineinander, und zwei deckungsgleiche, nach oben zeigende
          Flaechen bei genau 4,00 ergaeben Z-Fighting auf einer
          BEGEHBAREN Flaeche. 8 m lassen 3,64 m Fels dazwischen.

          ── Warum 12 m lang ──────────────────────────────────────────
          8 m Steigung auf 12 m Lauf sind 33,7° — steil genug fuer eine
          Krypta, flach genug zum Gehen. Die Stufe misst damit rund
          0,40 m hoch bei 0,60 m Auftritt. 16 m waeren bequemer (26,6°),
          fuellen aber vier Rastereinheiten fuer einen Gang, in dem
          nichts passiert.

          ── Warum size.y 12 ist ──────────────────────────────────────
          Der obere Ausgang liegt auf 8 m und braucht dort Kopfraum:
          8 + 4 = 12. Genau das verlangt die Regel `ebenensprung-hoehe`
          — sie ist die Gegenprobe dazu, dass die gelockerte
          Hoehenregel kein Freibrief wird.

          KEIN Eingangsraum und KEIN Abschluss: Eine Treppe, die im
          Nichts beginnt, ist ein Loch im Boden.
        */
        name: 'SteingrabTreppe',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 4, y: 12, z: 12 },
        theme: THEMA_KRYPTA,
        // Seltener als ein Gang. Eine Krypta, in der jeder dritte Raum
        // eine Treppe ist, liest sich als Treppenhaus.
        weight: 0.4,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            // Unten. Zeigt nach draussen (−z), wie bei jedem Gang.
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -6 },
            localRot: HALBE_DREHUNG,
          },
          {
            // Oben, ein volles Stockwerk hoeher. Der einzige Connector
            // des Kits mit y != 0 — bis zum 28.08.2026 verbot die
            // Rasterpruefung genau das.
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 8, z: 6 },
            localRot: KEINE_DREHUNG,
          },
        ],
      },
      {
        /*
          Derselbe Gang noch einmal — ohne die Eingangsrolle.

          Der Generator waehlt Folgeraeume ausdruecklich unter den
          NICHT-Eingangsraeumen aus. Solange `SteingrabGang` der einzige
          gerade Gang war UND der Eingangsraum, konnte er kein zweites
          Mal gesetzt werden: Aus Seed 7 entstanden 54 Raeume mit 25
          Ecken, 19 Endkappen, 9 Kreuzungen und genau EINEM Gang. Ein
          Gewirr aus Ecken, keine Krypta mit Gaengen.

          Kein zweites Modell: `MODELL_ALIAS` in
          `client/src/engine/AssetManager.ts` zeigt diesen Namen auf
          `SteingrabGang.glb`. Die Geometrie IST dieselbe, nur die Rolle
          im Kit ist eine andere — und Rollen unterscheidet das
          Datenmodell ueber den Raumnamen, nicht ueber die Datei.

          Wenn spaeter ein eigenes Eingangsteil dazukommt (eine
          Vorkammer, an der das Portal sitzt), verliert `SteingrabGang`
          seine Sonderrolle und die beiden Eintraege fallen wieder zu
          einem zusammen.

          Hoeheres Gewicht als Ecke und Kreuzung: Gerade Strecke ist das
          Ruhige zwischen den Wendungen. Ohne Uebergewicht bleibt es bei
          jeder zweiten Abbiegung.
        */
        name: 'SteingrabGangDurch',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 4, y: 4, z: 8 },
        theme: THEMA_KRYPTA,
        weight: 2.5,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -4 },
            localRot: HALBE_DREHUNG,
          },
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 4 },
            localRot: KEINE_DREHUNG,
          },
        ],
      },
      {
        /*
          Die Vierteldrehung. 4 x 4 m, zwei Durchgaenge auf
          ANEINANDERGRENZENDEN Seiten: einer nach +z, einer nach +x.

          Diese beiden Richtungen sind keine freie Wahl, sondern das
          Ergebnis der Achsdrehung beim Export: In Blender sind Sued
          (−y) und Ost (+x) offen, und `export_yup` macht aus −y ein
          +z. Wer `tools/steingrab-erzeugen.py` dort aendert, muss diese
          zwei Connectors mitaendern — sonst koppelt der Editor an eine
          Wand, und im Grundriss sieht alles richtig aus.

          Kein Eingangsraum: Der Eingang des Kits ist der Gang. Erst
          dieser Raum hier macht das Kit ueberhaupt wachsend — der
          Generator waehlt Folgeraeume ausdruecklich unter den
          NICHT-Eingangsraeumen aus.
        */
        name: 'SteingrabEcke',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 4, y: 4, z: 4 },
        theme: THEMA_KRYPTA,
        weight: 1,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 2 },
            localRot: KEINE_DREHUNG,
          },
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 2, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG,
          },
        ],
      },
      {
        /*
          Die Grabkammer. 8 x 12 m Grundflaeche — und 6,40 m hoch statt
          4,00 m wie alles andere.

          Die Hoehe ist der Zweck des Teils: Ein Raum, der so hoch ist
          wie der Gang davor, ist ein breiter Gang. Man tritt aus 3,60 m
          in 6,00 m lichte Hoehe, und das merkt man ohne ein einziges
          Ausstattungsstueck. Die Oeffnungen bleiben trotzdem auf
          Ganghoehe (3,50 x 3,60 m), sonst liefe die Decke des Gangs ins
          Leere.

          `size.y` = 6,4 stoert das Raster nicht: `dungeonRaster.ts`
          prueft die GRUNDFLAECHE auf Vielfache von 4 m und die Hoehe nur
          gegen einen Mindestwert.

          Drei Durchgaenge, Sued und Nord gegenueber, Ost quer dazu — so
          liegt die Kammer in einem Weg statt an seinem Ende, und der
          Generator kann hinter ihr weiterbauen.

          Kleines Gewicht: Eine Krypta, die zur Haelfte aus Grabkammern
          besteht, hat keine mehr.
        */
        name: 'SteingrabKammer',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 8, y: 6.4, z: 12 },
        theme: THEMA_KRYPTA,
        weight: 0.3,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 6 },
            localRot: KEINE_DREHUNG,
          },
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -6 },
            localRot: HALBE_DREHUNG,
          },
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 4, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG,
          },
        ],
        // BEISPIEL für Pro-Raum-Texturen: die Grabkammer ist feuchter/bemooster
        // als die Gänge. Nur die gesetzten Felder überschreiben die Kit-Vorgabe.
        // Frei anpassbar (auch wandTextur/deckeTextur/bodenTextur je Raum).
        steinKit: { verwitterung: { moos: 1.6, frost: 0.2, nass: 1.3 } },
      },
      {
        /*
          Die zugemauerte Sackgasse — Abschluss ohne Raum dahinter.

          ── Warum sie VOR der Grabnische steht ────────────────────
          Diese Reihenfolge ist kein Geschmack, sie ist die Absicherung
          gegen den Notfallzweig von `placeEndCaps`: Passt kein Abschluss,
          nimmt der Generator `endCaps[0]` und setzt ihn ohne Prüfung.
          `endCaps[0]` ist der erste Treffer aus `findEndCaps` — und das
          ist die UNSORTIERTE Reihenfolge dieser Liste hier, NICHT die
          nach `endCapPrio`. Wer das Teil hinter die Nische schiebt, dreht
          damit still den Notfall um: Dann wird wieder eine 4-m-Nische
          hineingezwungen, wo 25 cm gepasst hätten, und nichts meldet es.

          `endCapPrio: 0` gegen 10 bei der Nische heißt: Wo Platz ist,
          gewinnt die Nische. Nur wo keiner ist, wird gemauert. Über
          40 Seeds ist das ungefähr halbe-halbe — für ein Steingrab die
          richtigere Mischung als ein Kit, in dem jeder Gang in einer
          Kammer endet.

          `allowDoor: false`: Ein Türsturz vor einer zugemauerten Wand
          wäre eine Tür, die nirgendwohin führt.

          Die Hülle ist 0,25 m tief und damit KEIN Rastervielfaches. Das
          ist der Zweck des Teils und in `dungeonRaster.ts` als eng
          gefasste Ausnahme geführt (`verschlussAchse`) — nicht als
          Freibrief für dünne Räume.
        */
        name: 'SteingrabAbschluss',
        divider: false,
        endCap: true,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 4, y: 4, z: 0.25 },
        theme: THEMA_KRYPTA,
        weight: 1,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            type: '',
            entrance: false,
            allowDoor: false,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -0.125 },
            localRot: HALBE_DREHUNG,
          },
        ],
      },
      {
        /*
          Der Abschluss mit Raum dahinter: die Grabnische. EIN Durchgang,
          drei geschlossene Seiten.

          `endCap: true` ist hier kein Beiwerk, sondern der Zweck: Der
          Generator setzt Endkappen bevorzugt auf Connectors, die sonst
          offen blieben. Ohne sie endet jeder erzeugte Dungeon in einem
          Loch ins Nichts.

          Die Vorlage laesst Endkappen dabei OHNE Ueberschneidungspruefung
          zu — sie verschliessen dort per Entwurf. Fuer dieses Kit ist das
          abgeschaltet (`generatorEinstellungen` oben), weil diese Kappe
          eine begehbare Nische ist und keine Blende: Sie darf nur
          gesetzt werden, wo sie wirklich hinpasst.

          `endCapPrio: 10` gegen 0 beim `SteingrabAbschluss` heisst: Wo
          Platz ist, gewinnt die Nische; sonst wird zugemauert.
        */
        name: 'SteingrabEndkappe',
        divider: false,
        endCap: true,
        endCapPrio: 10,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 4, y: 4, z: 4 },
        theme: THEMA_KRYPTA,
        weight: 1,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 2 },
            localRot: KEINE_DREHUNG,
          },
        ],
      },
      {
        /*
          Die Vierwegkreuzung, 8 x 8 m — zwei Rastereinheiten.

          Warum nicht 4 x 4: Bei vier offenen Seiten bliebe von den
          Waenden nichts als vier Pfosten von 25 x 25 cm unter einer
          Steindecke. Die Herleitung steht bei `baue_kreuzung` in
          `tools/steingrab-erzeugen.py`; hier zaehlt die Folge fuer das
          Datenmodell: Die Huellbox ist doppelt so gross wie beim Gang,
          und die vier Connectors sitzen entsprechend bei ±4 statt ±2.

          Erst dieses Teil laesst den Grundriss verzweigen. Mit Gang,
          Ecke und Endkappe kann der Generator nur eine Kette bauen —
          eine Kreuzung macht daraus ein Netz.
        */
        name: 'SteingrabKreuzung',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 8, y: 4, z: 8 },
        theme: THEMA_KRYPTA,
        // Seltener als Gang und Ecke: Eine Krypta aus lauter Kreuzungen
        // ist ein Gitter, kein Grab.
        weight: 0.4,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 4 },
            localRot: KEINE_DREHUNG,
          },
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -4 },
            localRot: HALBE_DREHUNG,
          },
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 4, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG,
          },
          {
            type: '',
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -4, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG_ZURUECK,
          },
        ],
      },
    ],
  },
  /**
   * Das StoneVault — erstes Kit nach dem MODUL-Format.
   *
   * Der Unterschied zum Steingrab darüber ist nicht der Stil, sondern die
   * Bauweise. Das Steingrab besteht aus fertigen Räumen: Gang, Ecke,
   * Kreuzung, Kammer — jedes Teil trägt seine Wände schon in sich, und wo
   * ein Durchgang sein soll, ist er in die GLB gebaut. Das StoneVault
   * setzt stattdessen aus dem 2-m-Raster von `modulFormat.md` zusammen:
   *
   *   • **Zelle = Raum.** Grundfläche 2 × 2 m, lichte Höhe 3,5 m. Was der
   *     Generator platziert, ist immer dieselbe Zelle; die Form des
   *     Grundrisses entsteht allein daraus, WIE VIELE nebeneinander
   *     liegen. Ein Gang ist eine Kette von Zellen, eine Halle ein Feld.
   *   • **Wand = endCap.** Eine Zellkante, die offen bliebe, bekommt kein
   *     Zimmer dahinter, sondern ein 0,3 m dünnes Wandmodul. Das ist die
   *     `SteingrabAbschluss`-Rolle — hier aber die einzige, weil eine
   *     begehbare Nische im Modulformat schlicht wieder eine Zelle wäre.
   *   • **Torbogen = doorType.** Öffnungen werden nicht in die Wand
   *     geschnitten, sie sind ein eigenes Modul, das `placeDoors` in die
   *     Kopplungsebene zwischen zwei Zellen setzt.
   *
   * Verbindlich ist dabei `/home/mike/wov-ai/elements/modulFormat.md`
   * (Modul-Format v0): Raster 2,0 m, Zellmitte bei `(ci*2, 0, cj*2)`,
   * y = 0 ist die Bodenoberkante, Wand/Torbogen sitzen auf der Zellkante
   * und zeigen mit ihrer lokalen +Z-Fläche in die Zelle. Wer die Modelle
   * ändert, ändert dort zuerst.
   *
   * ACHTUNG — dies ist NICHT das 4-m-Raster von `dungeonRaster.ts`. Dessen
   * Regeln (Grundfläche als Vielfaches von 4 m, Mindesthöhe 4 m) bilden das
   * Steingrab und die Fremdkits ab; ein Modulkit auf 2 m hält sie
   * absichtlich nicht. `pruefeRaumRaster` nimmt das Rastermaß deshalb als
   * Parameter — geprüft wird dieses Kit gegen 2, nicht gegen 4.
   *
   * Der Connector-Typ ist ein eigener String (`cellEdge`) statt des leeren
   * Typs, den das Steingrab benutzt: Der Generator koppelt Räume nur an
   * Connectors GLEICHEN Typs, und mit dem leeren Typ würde eine 2-m-Zelle
   * an einen 4-m-Gang des Steingrabs andocken, sobald jemand die Kits
   * mischt. Ein eigener Typ macht das unmöglich, ohne dass es jemand
   * bemerken muss.
   */
  {
    name: 'DG_StoneVault',
    /*
      DER SCHALTER auf den Rasterpfad (G8). Seine Anwesenheit entscheidet,
      nicht sein Inhalt — `erzeugeLayoutFuerKit` fragt nur, ob das Feld da
      ist. Es steht an genau EINEM Kit; das Steingrab und die dreizehn
      geparsten bleiben auf dem 1.0-Pfad, und dass sie sich dabei nicht um
      ein Byte bewegen, belegt `server/test/golden-kits.ts`.

      Achtung, hier wechselt `maxRooms` die BEDEUTUNG: 60 heisst ab jetzt
      60 ZELLEN und nicht mehr 60 Wachstumsversuche. Der Wert bleibt
      trotzdem stehen — 60 Zellen ergeben eine Krypta in derselben
      Grössenordnung wie die 60 Versuche davor, und eine Zahl zu ändern,
      während sich ihre Bedeutung ändert, machte jeden Vorher/Nachher-
      Vergleich unlesbar.
    */
    gridGeneration: { cellM: MODULE_CELL_M, levelM: MODULE_LEVEL_M },
    /*
      Wie beim Steingrab und aus demselben Grund: Der Abschluss dieses Kits
      ist zwar eine dünne Wand (0,3 m) und damit der harmlose Fall, aber
      `endcapsCollision` sorgt dafür, dass sie nicht in einem Nachbarn
      steckt, und `endcapsFallbackByPrio` hält den Notfallzweig
      vorhersagbar, falls das Kit später einen zweiten Abschlusstyp
      bekommt. `roomBodyFromFloor` ist Pflicht: Die Modelle haben ihren
      Ursprung auf dem BODEN (Modul-Format, Pivot = Bodenmitte), nicht in
      der Mitte der Hülle.
    */
    generatorEinstellungen: {
      endcapsCollision: true,
      endcapsFallbackByPrio: true,
      roomBodyFromFloor: true,
      // Kleiner als die Vorgabe 64: Zellen sind 2 m, und 60 Versuche
      // füllen selbst im Idealfall keine 48-m-Kante. Ein zu grosser
      // Wachstumsraum streut die Kette nur weiter auseinander.
      zoneSize: 48,
    },
    // Startwert: dieselben Texturen wie das Steingrab. Das Modulkit soll
    // sich zuerst im GRUNDRISS beweisen; ein eigenes Material daneben
    // vermischte zwei Fragen in einer Messung.
    steinKit: {
      wandTextur: '/assets/models/stein_clean.png',
      deckeTextur: '/assets/models/stein_decke.png',
      bodenTextur: '/assets/models/stein_clean.png',
      verwitterung: { moos: 1.0, frost: 0.9, nass: 0.9 },
      kachelM: 2,
      deckeKachelM: 4,
      moosSkala: 9,
      frostSkala: 11,
      nassSkala: 8,
      deckeSchwelle: 0.45,
    },
    interiorPosition: null,
    originalPosition: null,
    algorithm: ALGORITHMUS_DUNGEON,
    alternativeFunctionality: false,
    campRadiusMax: 0,
    campRadiusMin: 0,
    /*
      Setzbare Deko wie beim Steingrab: die Wandfackel. Der 1.0-Generator
      setzt KEINE Props von sich aus — `propTypes` ist das Angebot an den
      Editor. Ohne diesen Eintrag liesse sich im StoneVault keine Fackel
      setzen, und ein Modulkit ohne eigene Lichtquelle bleibt in der
      Innen-Umgebung so dunkel, wie der Spielprobe-Befund vom 03.09.2026
      es zeigte (Crypt: Sonne 0, Fackeln 0/16 — stockdunkel).
    */
    propTypes: [
      {
        prefabName: 'CryptWallTorch',
        prefabHash: getStableHash('CryptWallTorch'),
        label: 'Wandfackel',
      },
    ],
    /*
      Ohne Wirkung, solange der einzige Türtyp eine EIGENE Wahrscheinlichkeit
      mitbringt (s. `doorTypes` gleich darunter) — `placeDoors` fragt
      `doorChance` nur, wenn `doorDef.chance <= 0`. Der Wert steht
      trotzdem hier und nicht auf 0, damit ein zweiter Torbogen ohne
      eigene Zahl später nicht stumm nie gesetzt wird.
    */
    doorChance: 0.35,
    doorTypes: [
      {
        /*
          Der Torbogen. KEIN Raum: `placeDoors` setzt ihn auf
          `connection.pos` mit `connection.rot`, also genau in die
          Kopplungsebene zwischen zwei Zellen — dorthin, wo im Modulformat
          sonst ein Wandmodul stünde.

          `chance: 0.5` ist hier eine EIGENE Wahrscheinlichkeit, anders als
          beim Steingrab (`chance: 0`, dort entscheidet `doorChance`). So
          liest der Generator es: `doorDef.chance <= 0 || rnd <= chance`
          und `doorDef.chance > 0 || rnd <= doorChance` — ein Wert > 0
          schaltet `doorChance` für diesen Typ ab. Jede zweite Öffnung
          bekommt damit einen Rahmen, die andere bleibt ein blosser
          Durchbruch; beides nebeneinander liest sich als gebaut statt
          als generiert.

          `connectionType` ist `cellEdge` und NICHT leer: Die Connectors
          dieses Kits tragen denselben Typ, und `placeDoors` filtert auf
          Gleichheit. Ein leerer Typ hier fände keine einzige Verbindung.
        */
        prefabName: 'StoneVaultArch',
        prefabHash: getStableHash('StoneVaultArch'),
        connectionType: TYP_ZELLKANTE,
        chance: 0.5,
      },
    ],
    // Das Rastermass des Kits. Der Generator liest das Feld nicht (er
    // schnappt über Connectors, s. Kopf von `dungeonRaster.ts`); es steht
    // hier als Aussage über die Modelle — 2 m, nicht die 4 m der
    // Fremdkits.
    gridSize: 2,
    // Zahl der VERSUCHE, nicht der Räume. Höher als beim Steingrab (32),
    // weil eine Zelle nur ein Viertel der Grundfläche eines Steingrab-
    // Gangs belegt: Bei gleicher Versuchszahl entstünde ein Grundriss von
    // einem Viertel der Ausdehnung.
    maxRooms: 60,
    maxTilt: 10,
    minAltitude: 0,
    minRequiredRooms: 0,
    minRooms: 1,
    perimeterBuffer: 0,
    perimeterSections: 0,
    requiredRooms: [],
    spawnChance: 0,
    themes: THEMA_KRYPTA,
    tileWidth: 0,
    rooms: [
      {
        /*
          Die Eingangszelle. Geometrisch dieselbe Zelle wie
          `StoneVaultCell` — die Datei dahinter teilen sie über
          `MODELL_ALIAS`, wie `SteingrabGang`/`SteingrabGangDurch`.

          Sie muss getrennt stehen, weil `entrance` eine ROLLE ist und
          keine Form: `placeStartRoom` wählt unter den Räumen mit
          `entrance: true`, `candidateRooms` wählt Folgeräume ausdrücklich
          unter den NICHT-Eingangsräumen. Wäre die Zelle beides, könnte
          der Generator sie nach dem Start kein zweites Mal setzen — und
          das Kit hätte genau einen Raum.
        */
        name: 'StoneVaultEntry',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: true,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 2, y: 3.5, z: 2 },
        theme: THEMA_KRYPTA,
        weight: 1,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        /*
          Vier Kantenconnectors, einer je Himmelsrichtung. Sie sitzen auf
          der senkrechten Hüllfläche (x oder z = ±size/2 = ±1) und auf
          y = 0 — dieselbe Konvention wie `SteingrabKreuzung`, nur bei ±1
          statt ±4, weil die Zelle 2 m misst statt 8. Die Drehung zeigt
          aus der Zelle HINAUS; `attachRoom` dreht den Nachbarn um 180°
          dagegen.
        */
        connections: [
          {
            // Nord (+z).
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 1 },
            localRot: KEINE_DREHUNG,
          },
          {
            // Süd (−z) — der Eingang des Kits. Der Generator setzt die
            // Zelle so, dass dieser Connector auf (0,0,0) landet.
            type: TYP_ZELLKANTE,
            entrance: true,
            allowDoor: false,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -1 },
            localRot: HALBE_DREHUNG,
          },
          {
            // Ost (+x).
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 1, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG,
          },
          {
            // West (−x).
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -1, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG_ZURUECK,
          },
        ],
      },
      {
        /*
          Die Zelle — der offene Füller des Kits: vier freie Kanten, keine
          eingebaute Wand.

          Sie war bis zum 03.09.2026 der EINZIGE Raum, den
          `candidateRooms` auswählen konnte (Entry ist Eingangsraum, Wall
          ist endCap) — daher das hohe Gewicht 3. Mit den vier
          Zellvarianten darunter (Corridor, Corner, Junction, Hall) ist
          das Gewicht kein Formalismus mehr, sondern die Mischung: Auf 2
          gesenkt bleibt die offene Zelle das häufigste Teil und füllt
          weiter die Flächen zwischen den Gängen, ohne dass der Grundriss
          wieder zu einem einzigen Feld gleicher Quadrate wird.
        */
        name: 'StoneVaultCell',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 2, y: 3.5, z: 2 },
        theme: THEMA_KRYPTA,
        weight: 2,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 1 },
            localRot: KEINE_DREHUNG,
          },
          {
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -1 },
            localRot: HALBE_DREHUNG,
          },
          {
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 1, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG,
          },
          {
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -1, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG_ZURUECK,
          },
        ],
      },
      {
        /*
          Der Korridor — dieselbe Zelle, aber mit EINGEBAUTEN Seitenwänden
          nach Ost und West. Offen bleiben Nord und Süd; eine Kette
          solcher Zellen ist ein Gang mit durchlaufenden Wänden statt
          einer Reihe von Quadraten, die erst der endCap zumauert.

          ── Warum die Hülle 1,4 misst und nicht 2 ──────────────────────
          Die Wände liegen INNERHALB der Zelle, im Streifen 0,7 … 1,0 von
          der Mitte aus — also AUSSERHALB dieser Hülle. Das ist Absicht
          und der Kern des Teils:

          Der Wandabschluss (`StoneVaultWall`) einer offenen Nachbarzelle
          ragt von der gemeinsamen Kante aus 0,3 m in die Nachbarzelle
          hinein, sein Körper liegt also bei 1,0 … 1,3 von deren Mitte
          gemessen. Läge unsere Hülle bei 2 (± 1,0), stiesse jeder solche
          Abschluss dagegen: `endcapsCollision` lehnte ihn ab, und der
          Generator setzte ihn über den Notfallzweig von `placeEndCaps`
          trotzdem — eine dokumentierte Krücke, die man nicht zum
          Regelfall machen darf (s. `endcapsFallbackByPrio` im Generator
          und den Fund in `server/test/m3-stonevault-seeds.ts`).

          Mit 1,4 (± 0,7) stehen Abschluss und Innenwand Rücken an
          Rücken, jede mit ihrem Relief in ihre eigene Zelle. Der Streifen
          0,7 … 1,0 kann dabei nie anders belegt werden: Alle
          Platzierungen dieses Kits liegen auf dem 2-m-Raster, dort steht
          also entweder unsere Wand oder gar nichts.

          Die Connectors bleiben deshalb auf ± 1 — auf der RASTERKANTE,
          nicht auf der Hüllfläche. `dungeonRaster.ts` führt genau diesen
          Fall als benannte Ausnahme (`innenmassAchsen`, „Innenmass bei
          eingebauten Wänden").
        */
        name: 'StoneVaultCorridor',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        // x = 1,4: Innenmass zwischen den beiden eingebauten Wänden.
        // z = 2: in Laufrichtung ist nichts eingebaut, hier gilt das
        // volle Rastermass.
        size: { x: 1.4, y: 3.5, z: 2 },
        theme: THEMA_KRYPTA,
        // Das höchste Gewicht der Varianten: Gänge sind das, wovon eine
        // Krypta am meisten hat.
        weight: 5,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        /*
          Die beiden eingebauten Seitenwände, als Aussage für den
          Rastergenerator. Sie laufen über die VOLLE Ebenenhöhe
          (−0,25 … 3,75, `make-stonevault.py:56-59`) — deshalb `wall` und
          nicht `wallPartial`, und deshalb setzt die Versiegelungstafel
          gegen diese Kante keine Platte. Das sind, zusammen mit Ecke und
          Abzweig, die 531 Platten, die heute im Stein des Nachbarn
          stehen.

          Nord und Süd stehen hier NICHT: Sie tragen Connectors und sind
          damit ableitbar offen. Was hier steht, ist genau das, was in der
          GLB steckt und an keiner Datenstruktur hängt.
        */
        gridEdges: [{ edges: ['e', 'w'], state: 'wall' }],
        connections: [
          {
            // Nord (+z).
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 1 },
            localRot: KEINE_DREHUNG,
          },
          {
            // Süd (−z).
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -1 },
            localRot: HALBE_DREHUNG,
          },
        ],
      },
      {
        /*
          Die Ecke — Wände nach Süd und OST, offen nach Nord und West.
          Sie ist das Teil, das eine Gangkette um 90° umlenkt, ohne dass
          an der Innenseite der Kurve ein Abschluss eingesetzt werden
          muss.

          Die beiden Wände treffen sich in der SO-Ecke stumpf: Die
          Ostwand läuft durch (z = −1 … 1), die Südwand setzt bündig
          daran an. Weder ein Loch noch zwei Körper im selben Raum —
          die Begründung steht beim Modell (`make-stonevault.py`, `ecke`).

          ── Warum OST und nicht West (G11, 04.09.2026) ───────────────
          `make-stonevault.py` baut in Blender-Achsen und legt im Kopf
          fest: „Ost = blender −x, West = blender +x" — genau umgekehrt
          zur Weltkonvention dieses Kits (`w` = −x). Dazu kommt eine
          DOPPELTE Negation: Das Skript negiert am Ende jedes Moduls x
          (negatives Signed Volume), und der Client dreht das über
          Babylons `__root__` (scale.x = −1) wieder zurück. Beides hebt
          sich auf, die Geometrie steht in der Szene also so wie in
          Blender — und damit seitenverkehrt zur alten Erklärung. Die
          Sonde `tools/stonevault-kantensonde.ts` misst das am echten
          GLB: erklärt war Süd + West, gebaut ist Süd + Ost.
          Gespiegelt wird die ERKLÄRUNG, nicht das Modell — die GLBs
          bleiben unverändert, damit gespeicherte Gräber weiter so
          aussehen wie bisher.

          Hülle 1,4 auf BEIDEN Achsen, aus demselben Grund wie beim
          Korridor darüber: Hier ist auf jeder Achse eine Wand eingebaut.
        */
        name: 'StoneVaultCorner',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 1.4, y: 3.5, z: 1.4 },
        theme: THEMA_KRYPTA,
        weight: 3,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        // Süd- und Ostwand, volle Ebenenhöhe — s. `StoneVaultCorridor`.
        gridEdges: [{ edges: ['s', 'e'], state: 'wall' }],
        connections: [
          {
            // Nord (+z).
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 1 },
            localRot: KEINE_DREHUNG,
          },
          {
            // West (−x) — die freie Seite, s. Begründung oben.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -1, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG_ZURUECK,
          },
        ],
      },
      {
        /*
          Der Abzweig — nur die OSTwand ist eingebaut, offen sind Nord,
          West und Süd. Das T-Stück des Kits: Ein Gang läuft weiter und
          gibt zur Seite hin einen Ausgang frei.

          Hülle 1,4 nur auf x (dort steht die Wand), 2 auf z — s.
          Korridor.

          Ost statt West aus demselben Grund wie bei `StoneVaultCorner`
          darüber (G11, 04.09.2026): Blender-Ost ist −x, und die
          doppelte x-Negation (Skript + Babylon `__root__`) hebt sich
          auf, also steht die Wand in der Szene auf der Ostseite. Am GLB
          gemessen von `tools/stonevault-kantensonde.ts`.
        */
        name: 'StoneVaultJunction',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 1.4, y: 3.5, z: 2 },
        theme: THEMA_KRYPTA,
        // Seltener als Korridor und Ecke: Ein Abzweig an jeder zweiten
        // Zelle liest sich als Labyrinth, nicht als gebaute Anlage.
        weight: 2,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        // Nur die Ostwand, volle Ebenenhöhe — s. `StoneVaultCorridor`.
        gridEdges: [{ edges: ['e'], state: 'wall' }],
        connections: [
          {
            // Nord (+z).
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 1 },
            localRot: KEINE_DREHUNG,
          },
          {
            // West (−x) — die freie Seite, s. Begründung oben.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -1, y: 0, z: 0 },
            localRot: VIERTEL_DREHUNG_ZURUECK,
          },
          {
            // Süd (−z).
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -1 },
            localRot: HALBE_DREHUNG,
          },
        ],
      },
      {
        /*
          Die Halle — vier Zellen als EIN Teil: 4 × 4 m Boden und Decke
          ohne jede Wand, Plattenmuster durchlaufend, Pivot in der
          Bodenmitte.

          Sie ist die einzige Variante, deren Hülle das volle Rastermass
          hat (4 = 2 × 2 m), denn sie hat keine eingebaute Wand. Dafür
          trägt sie ACHT Connectors: je zwei auf jeder Seite, auf den
          Zellkanten bei ± 1 der jeweils anderen Achse. Ein einzelner
          Connector in der Seitenmitte läge bei 0 und damit auf keiner
          Zellkante — die anschliessende 2-m-Zelle stünde dann um 1 m
          versetzt zum Raster, und ab da passte im ganzen Zweig nichts
          mehr zusammen.

          `weight: 1` ist das kleinste Gewicht des Kits: Die Halle belegt
          die vierfache Fläche einer Zelle, bei gleichem Gewicht wäre der
          Grundriss aus Sälen statt aus Gängen mit Sälen.
        */
        name: 'StoneVaultHall',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 4, y: 3.5, z: 4 },
        theme: THEMA_KRYPTA,
        weight: 1,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            // Nord (+z), westliche Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -1, y: 0, z: 2 },
            localRot: KEINE_DREHUNG,
          },
          {
            // Nord (+z), östliche Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 1, y: 0, z: 2 },
            localRot: KEINE_DREHUNG,
          },
          {
            // Süd (−z), westliche Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -1, y: 0, z: -2 },
            localRot: HALBE_DREHUNG,
          },
          {
            // Süd (−z), östliche Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 1, y: 0, z: -2 },
            localRot: HALBE_DREHUNG,
          },
          {
            // Ost (+x), südliche Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 2, y: 0, z: -1 },
            localRot: VIERTEL_DREHUNG,
          },
          {
            // Ost (+x), nördliche Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 2, y: 0, z: 1 },
            localRot: VIERTEL_DREHUNG,
          },
          {
            // West (−x), südliche Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -2, y: 0, z: -1 },
            localRot: VIERTEL_DREHUNG_ZURUECK,
          },
          {
            // West (−x), nördliche Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: -2, y: 0, z: 1 },
            localRot: VIERTEL_DREHUNG_ZURUECK,
          },
        ],
      },
      {
        /*
          Die Treppe — das erste Modul dieses Kits, das zwei Ebenen
          verbindet. Sie steigt über drei Zellen Lauf (z = −3 … +3) um
          genau eine Zellhöhe: Süd-Ende auf y = 0, Nord-Ende auf y = 3,5.

          ── Warum 3,5 und nicht 8 wie beim Steingrab ──────────────────
          Der Ebenensprung des Steingrabs ist 8 m, weil dort zwei
          getrennte Modelle an der Naht deckungsgleiche, nach oben
          zeigende Flächen bekämen (Rechnung bei `DUNGEON_EBENE_M`). Hier
          gibt es diese Naht nicht: Die Treppe trägt Boden UND schräge
          Decke selbst, unten wie oben, und reicht von y = 0 bis y = 7.
          Eine Ebene ist im Modulformat schlicht eine Zellhöhe.

          ── Die Stufen, und warum der Lauf 6 m ist ───────────────────
          14 Stufen à 0,25 m Steigung auf 6 m Lauf, also 6/14 = 0,4286 m
          Auftritt — 30,3°.

          Bis zum 3.9.2026 war der Lauf 4 m (0,286 m Auftritt, 41,2°),
          und genau daran ist die Treppe im Spiel gescheitert: Der
          Charaktercontroller der Figur lässt höchstens
          `STEIGUNGS_GRENZE_GRAD` = 40° zu
          (`client/src/player/PlayerController.ts`, dort `maxSlopeCosine`);
          darüber trägt ihn die Fläche nicht mehr, die Figur rutscht ab.
          41,2° liegt einen Grad daneben — die Treppe sah in jedem
          Rendering richtig aus und war trotzdem unbegehbar.
          Zum Vergleich: `SteingrabTreppe` hat 33,7° und funktioniert.

          Der Lauf ist deshalb auf drei Zellen gestreckt. Weiter zu
          strecken hat einen Preis: Je länger die Hülle, desto seltener
          findet der Generator einen Platz dafür (s. Anteilsstatistik in
          `server/test/m3-stonevault-seeds.ts`). Gegen ein Wiederholen
          des Fehlers steht der Wächter in `shared/test/dungeon-raster.ts`
          („Treppen dürfen nicht steiler sein…"): Er rechnet die Steigung
          aus den Connectors JEDES eigenen Bauteils gegen dieselbe Grenze.

          ── Warum size.y 7 ist ───────────────────────────────────────
          Der obere Ausgang liegt auf 3,5 und braucht dort dieselbe
          lichte Höhe wie jede andere Zelle: 3,5 + 3,5 = 7. Genau das
          verlangt die Regel `ebenensprung-hoehe` in `dungeonRaster.ts`
          — sie ist die Gegenprobe dazu, dass die Höhenausnahme
          (`ebenenMasse`) kein Freibrief wird. `roomBodyFromFloor` ist
          für dieses Kit gesetzt, die Hülle liegt also 0 … 7 über dem
          Boden und umfasst beide Ebenen.

          ── Warum die Hülle in x 1,4 misst ───────────────────────────
          Wie beim Korridor: Die seitlichen Innenwände liegen im Streifen
          0,7 … 1,0 und damit AUSSERHALB der Hülle, damit der Abschluss
          einer offenen Nachbarzelle nicht dagegenstösst. Die Connectors
          bleiben trotzdem auf der Rasterkante — sie sitzen auf ± z, nicht
          auf der schmalen Innenfläche, und `innenmassAchsen` erkennt den
          Fall deshalb weiter (`dungeonRaster.ts`, „Innenmass bei
          eingebauten Wänden"). In z ist nichts eingebaut: dort gilt mit
          6 m das volle Rastermass dreier Zellen.

          KEIN Eingangsraum und KEIN Abschluss — aus demselben Grund wie
          bei `SteingrabTreppe`: Eine Treppe, die im Nichts beginnt, ist
          ein Loch im Boden.
        */
        name: 'StoneVaultStairs',
        divider: false,
        endCap: false,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 1.4, y: 7, z: 6 },
        theme: THEMA_KRYPTA,
        // So selten wie die Halle: Eine Krypta, in der jede dritte Zelle
        // eine Treppe ist, liest sich als Treppenhaus. Gemessen an der
        // Verteilung über 40 Seeds — s. Befund zum 03.09.2026.
        weight: 1,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        /*
          Die Treppe erklärt als einziges Modul zwei Ebenen — und als
          einziges etwas anderes als `wall` oder `open`.

          ── Warum die Flanken `wallPartial` sind ──────────────────────
          Sie sind Keile, die mit dem Lauf steigen
          (`make-stonevault.py:483-491`). Über eine Ebenenhöhe gerechnet
          deckt so ein Keil die Zellkante nur zum Teil: Am Fuss der
          Treppe steht er knietief, an ihrem Kopf reicht er hinauf. Eine
          offene Nachbarzelle braucht dort also weiter ihre eigene
          Platte — das sind die 414 Platten gegen die Treppe, die im
          Befund vom 04.09.2026 als NÖTIG geführt werden, im Unterschied
          zu den 531 gegen volle Wände.

          Bewusst grob: Auch die drei Zellen der oberen Ebene über dem
          flachen Teil des Laufs tragen `wallPartial`, obwohl dort
          streckenweise gar nichts steht. Die Tafel setzt damit eine
          Platte zu viel statt eine zu wenig — ein Loch in der Wand ist
          der teurere Fehler. Eine feine Erklärung je Ebene wäre erst
          etwas wert, wenn es ein eigenes Abschlussmodul für die
          Treppenflanke gibt (s. Risiken der Konzeptnotiz).

          ── Die beiden Enden ─────────────────────────────────────────
          Süd auf Ebene 1 und Nord auf Ebene 0 sind Lauf- bzw. Luftraum
          hinter dem Modulrand, keine gebaute Wand — auch sie deshalb
          `wallPartial`. Die beiden ECHTEN Ausgänge (Süd unten, Nord
          oben) tragen Connectors und stehen hier nicht.

          ── Die senkrechte Kante ─────────────────────────────────────
          Der Lauf überschreitet y = 3,5 genau an seinem Nordende: Wer
          hinaufgeht, wechselt in der Nordzelle die Ebene. Genau dort —
          und nur dort — ist die Decke der unteren Zelle offen und der
          Boden der oberen ebenso. Ohne diese beiden Zeilen hinge die
          Treppenspitze im Graphen an nichts, und das fiele in keiner
          Zählung auf, sondern erst, wenn eine Figur oben in der
          Sackgasse steht.
        */
        gridEdges: [
          { edges: ['n', 'e', 's', 'w'], state: 'wallPartial' },
          { cell: { ix: 0, iz: 2, level: 0 }, edges: ['up'], state: 'open' },
          { cell: { ix: 0, iz: 2, level: 1 }, edges: ['down'], state: 'open' },
        ],
        connections: [
          {
            // Unten, Süd (−z). Zeigt nach draussen, wie jede Zellkante.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: -3 },
            localRot: HALBE_DREHUNG,
          },
          {
            // Oben, Nord (+z), eine Zellhöhe höher. Der einzige
            // Connector dieses Kits mit y != 0 — die Konvention ist von
            // `SteingrabTreppe` übernommen (dort y = 8 = ein Stockwerk),
            // nur mit dem Ebenenmass des Modulformats.
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: true,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 3.5, z: 3 },
            localRot: KEINE_DREHUNG,
          },
        ],
      },
      {
        /*
          Das Wandmodul — der Abschluss dieses Kits, und im Modulformat
          das Gegenstück zum Torbogen: Eine Zellkante ist entweder Wand
          oder Durchgang.

          `endCap: true` markiert es für `placeEndCaps`: Der Generator
          setzt es auf jeden Connector, der sonst offen ins Nichts zeigt.
          Ohne dieses Teil endete jede Zellkette in einem Loch.

          `allowDoor: false` — ein Torbogen vor einer geschlossenen Wand
          wäre ein Rahmen um Stein.

          Die 0,3 m Tiefe sind KEIN Vielfaches des 2-m-Rasters. Genau so
          steht es im Modul-Format (Wand: 2 × 3,5 × 0,3), und in
          `dungeonRaster.ts` fängt `verschlussAchse` diesen Fall als eng
          gefasste Ausnahme ab — nicht als Freibrief für dünne Räume.
        */
        name: 'StoneVaultWall',
        divider: false,
        endCap: true,
        endCapPrio: 0,
        entrance: false,
        faceCenter: false,
        minPlaceOrder: 0,
        perimeter: false,
        size: { x: 2, y: 3.5, z: 0.3 },
        theme: THEMA_KRYPTA,
        weight: 1,
        pos: NULL_PUNKT,
        rot: KEINE_DREHUNG,
        connections: [
          {
            /*
              Auf der VORDERFLÄCHE der Platte (+size.z/2), nicht auf der
              Rückfläche wie bei `SteingrabAbschluss`. Der Grund ist die
              Kopplungsmathematik: `calculateRoomPosRot` dreht den Anbau
              so, dass sein Connector dem der Zelle ENTGEGEN zeigt. Sitzt
              der Connector hinten und zeigt nach hinten, bleibt die Wand
              ungedreht — und ihre Reliefseite (+z) zeigt von der Zelle
              weg. Nachgerechnet am Layout von Seed 7: 48 von 49 Wänden
              standen mit der glatten Rückseite zum Spieler.

              Vorn und nach vorn zeigend wird die Wand um 180° gedreht:
              +z zeigt in die Zelle, der Körper liegt wie zuvor 0,3 m
              hinter der Zellkante (ausserhalb der Zellfläche), die
              Kollisionsprüfung bleibt dieselbe.
            */
            type: TYP_ZELLKANTE,
            entrance: false,
            allowDoor: false,
            doorOnlyIfOtherAlsoAllowsDoor: false,
            localPos: { x: 0, y: 0, z: 0.15 },
            localRot: KEINE_DREHUNG,
          },
        ],
      },
    ],
  },
];
