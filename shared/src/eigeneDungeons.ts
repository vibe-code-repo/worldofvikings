/**
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
 * ── Warum zunächst genau EIN Bauteil ─────────────────────────────────
 * Das erste Teil beantwortet die Frage, die keine Liste beantwortet:
 * trägt die Kette vom Blender-Export bis zum begehbaren Raum? Klemmt es,
 * findet man die Stelle mit einem Teil und nicht mit sieben. Der
 * Generator baut aus diesem Kit deshalb einen Dungeon aus einem einzigen
 * Raum — er wählt Folgeräume ausdrücklich unter den NICHT-Eingangsräumen
 * aus (`dungeonGenerator.ts`), und andere gibt es hier noch nicht. Im
 * Karteneditor lässt sich der Gang trotzdem aneinanderreihen: `attachRoom`
 * kennt diese Einschränkung nicht.
 *
 * Die weiteren sechs Teile des Startsatzes (Ecke, Kreuzung, Raum,
 * Türöffnung, Treppe, Endkappe) kommen als eigene Einträge dazu, sobald
 * ihre Modelle stehen.
 */
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
 * Dieselbe Form wie ein Eintrag in `dungeonsData.json`: ohne `hash`, den
 * `dungeons.ts` für beide Quellen gleich berechnet, und mit `algorithm`
 * als Zahl.
 */
export interface EigenesKitJson {
  readonly name: string;
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
  }[];
}

/**
 * Das Steingrab — erstes eigenes Kit.
 *
 * `doorTypes` ist leer, solange kein Türmodell existiert: Ein Türtyp ohne
 * GLB setzte unsichtbare Türen in jeden Durchgang, und die stünden dann
 * als Hash im gespeicherten Dokument, wo sie später niemand mehr von
 * echten unterscheidet.
 *
 * `interiorPosition` bleibt null. Das Feld trägt in der Vorlage den
 * Versatz innerhalb eines Location-Prefabs; im Projekt liest es niemand
 * (geprüft), und die Instanz bekommt ihren Ursprung ohnehin vom
 * `DungeonManager` zugewiesen.
 */
export const EIGENE_KITS: readonly EigenesKitJson[] = [
  {
    name: 'DG_Steingrab',
    interiorPosition: null,
    originalPosition: null,
    algorithm: ALGORITHMUS_DUNGEON,
    alternativeFunctionality: false,
    campRadiusMax: 0,
    campRadiusMin: 0,
    doorChance: 0,
    doorTypes: [],
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
          Der Abschluss. EIN Durchgang, drei geschlossene Seiten.

          `endCap: true` ist hier kein Beiwerk, sondern der Zweck: Der
          Generator setzt Endkappen bevorzugt auf Connectors, die sonst
          offen blieben, und `attachRoom` laesst sie ohne
          Ueberschneidungspruefung zu — sie verschliessen per Entwurf.
          Ohne sie endet jeder erzeugte Dungeon in einem Loch ins Nichts.

          `endCapPrio` hoeher als 0, damit sie vor einem beliebigen
          anderen Raum genommen wird, wenn beides ginge.
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
];
