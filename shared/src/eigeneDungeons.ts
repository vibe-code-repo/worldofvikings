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
  /** Abweichungen von DEFAULT_GENERATOR_SETTINGS — s. `DungeonDef`. */
  readonly generatorEinstellungen?: Partial<DungeonGeneratorSettings>;
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
    generatorEinstellungen: { endcapsCollision: true, endcapsFallbackByPrio: true },
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
];
