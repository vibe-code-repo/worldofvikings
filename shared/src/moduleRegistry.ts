/**
 * Laufzeit-Module des Kits `DG_StoneVault` — Meilenstein E3 der
 * Konzeptnotiz „Elemente aus dem Editor und Fels-Relief“.
 *
 * ── Wofür ────────────────────────────────────────────────────────────
 * E1 hat die Geometrie eines Saals geschlossen (`hallenGeometrie.ts`),
 * E2 schreibt sie als GLB (`server/src/world/dungeon/GlbWriter.ts`).
 * Damit steht das MODELL — aber ein Modell allein ist für den Generator
 * unsichtbar. Was er sieht, ist die `RoomDef`: Hülle, Connectors,
 * Kantenerklärung. Diese Datei baut sie, und zwar so, dass ein zur
 * Laufzeit erzeugter Saal von einem in `eigeneDungeons.ts` getippten
 * nicht zu unterscheiden ist.
 *
 * ── Warum die RoomDef eines Saals vollständig ableitbar ist ──────────
 * Ein Saal ist das einzige Modul des Kits OHNE eingebaute Wand: Boden und
 * Decke laufen durch, an allen vier Seiten ist offen. Daraus folgt jede
 * Zeile der Definition:
 *
 *  • `size` ist die volle Rasterhülle, `{2·cx, 3,5, 2·cz}`. Alle anderen
 *    Module lügen hier bewusst um 0,6 m je Achse mit eingebauter Wand
 *    (Begründung an `StoneVaultCorridor`); ein Saal hat keine, also steht
 *    hier das ehrliche Mass.
 *  • **Auf JEDER Randzelle sitzt ein Connector.** Nicht einer je Seite:
 *    Ein Connector in der Seitenmitte läge bei gerader Zellzahl auf
 *    KEINER Zellkante — die anschliessende 2-m-Zelle stünde dann um 1 m
 *    versetzt zum Raster, und ab da passte im ganzen Zweig nichts mehr
 *    zusammen. Das ist die Begründung, die schon bei `StoneVaultHall`
 *    steht, und sie ist der Grund für die 2·(cx+cz) Connectors.
 *  • **Kein `gridEdges`.** `gridModuleFromRoomDef` verlangt für jede
 *    waagerechte Aussenkante eine Aussage — Connector ODER Eintrag. Weil
 *    hier jede Randkante einen Connector trägt, vermisst sie nichts. Ein
 *    `gridEdges` daneben wäre eine zweite Aussage über dieselbe Kante.
 *
 * ── Warum die Drehungen importiert und nicht getippt sind ────────────
 * `KEINE_DREHUNG` … `VIERTEL_DREHUNG_ZURUECK` und `TYP_ZELLKANTE` kommen
 * aus `eigeneDungeons.ts`. Ein zweiter Satz derselben Quaternionen wäre
 * eine zweite Wahrheit über dieselbe Vierteldrehung, und ein
 * Vorzeichenfehler darin hätte kein Symptom in einer Zahl — er zeigte
 * sich als Zweig, der in die falsche Richtung wächst. Ebenso `GRID_M` und
 * `HEIGHT_M`: Die Hülle wird aus dem Kachelmass gerechnet, mit dem die
 * Geometrie wirklich gebaut wird, nicht aus einer wiederholten 2.
 *
 * ── Keine Nebenwirkung beim Import ───────────────────────────────────
 * `shared/package.json` verspricht `sideEffects: false` und nennt „keine
 * Registry-Einträge“ ausdrücklich. Diese Datei exportiert deshalb reine
 * Funktionen; das Eintragen in die Nachschlagewerke ist eine GERUFENE
 * Funktion und kommt in E4.
 *
 * Sprache: neue Bezeichner englisch, die importierten deutschen Namen
 * bleiben, wo sie stehen.
 */
import { GRID_M, HEIGHT_M, pillarPositions } from './hallenGeometrie.js';
import { fnv1a32 } from './dungeon2/layout.js';
import {
  HALBE_DREHUNG,
  KEINE_DREHUNG,
  NULL_PUNKT,
  TYP_ZELLKANTE,
  VIERTEL_DREHUNG,
  VIERTEL_DREHUNG_ZURUECK,
} from './eigeneDungeons.js';
import { MODULE_CELL_M, MODULE_LEVEL_M } from './dungeonRasterModul.js';
import { getStableHash } from './hash.js';
import type { DungeonDef, RoomConnectionDef, RoomDef } from './dungeons.js';
import {
  DUNGEONS_BY_NAME,
  KIT_BY_PREFAB_HASH,
  KIT_BY_ROOM_HASH,
  ROOMS_BY_HASH,
  RoomTheme,
} from './dungeons.js';
import {
  EIGENE_MODELLE,
  EIGENE_MODELLE_SET,
  PREFABS_BY_HASH,
  PREFABS_BY_NAME,
  PREFAB_DEFS,
  roomPrefabDef,
  type PrefabDef,
} from './prefabs.js';

/**
 * Die vier Seiten eines Saals in der Reihenfolge, in der die
 * ausgelieferten Säle ihre Connectors auflisten: Nord, Süd, Ost, West,
 * innerhalb einer Seite nach aufsteigender Querkoordinate.
 *
 * Die Reihenfolge ist NICHT Geschmackssache. `RoomConnectionDef` trägt
 * keinen Namen; ein Connector wird über seinen INDEX angesprochen
 * (`ModulePort.connector`, und im 1.0-Pfad die Türsetzung). Eine andere
 * Reihenfolge ergäbe dieselbe Geometrie mit anderen Indizes — und damit
 * eine RoomDef, die sich von einer gebauten unterscheidet, ohne dass ein
 * Mass abwiche.
 */
const SIDES = [
  { name: 'Nord (+z)', axis: 'z' as const, sign: 1, rot: KEINE_DREHUNG },
  { name: 'Süd (−z)', axis: 'z' as const, sign: -1, rot: HALBE_DREHUNG },
  { name: 'Ost (+x)', axis: 'x' as const, sign: 1, rot: VIERTEL_DREHUNG },
  { name: 'West (−x)', axis: 'x' as const, sign: -1, rot: VIERTEL_DREHUNG_ZURUECK },
] as const;

/**
 * Baut die `RoomDef` eines Saals aus seinen Zellzahlen.
 *
 * @param name    Prefabname und zugleich Dateiname des GLB. Unveränderlich —
 *                ein geänderter Saal ist ein NEUER Name (Konzept 1h: live
 *                liegt `/assets/` sieben Tage im Browsercache).
 * @param cellsX  Zellen in x-Richtung, ganzzahlig ≥ 1.
 * @param cellsZ  Zellen in z-Richtung, ganzzahlig ≥ 1.
 * @param weight  Gewicht des Raums für den 1.0-Pfad und den Editor. Auf den
 *                Rasterpfad wirkt es nicht: `nurManuell` hält den Saal aus
 *                der Stempelauswahl heraus.
 *
 * Die Klemmen des Editor-Formulars (2…8 Zellen, Pfeilerraster,
 * Dreiecksdeckel) sitzen im Server (E5) — sie sind eine Frage der
 * Bau-ERLAUBNIS. Hier wird nur zurückgewiesen, was gar keine Geometrie
 * hat: Ein halbzelliger oder leerer Fussabdruck ergäbe eine Hülle, die auf
 * keinem Raster liegt, und der Fehler fiele erst zwei Schritte später in
 * `gridModuleFromRoomDef` auf — mit einer Meldung über die Hülle statt
 * über das Argument.
 */
export function roomDefForHall(
  name: string,
  cellsX: number,
  cellsZ: number,
  weight: number
): RoomDef {
  if (!Number.isInteger(cellsX) || !Number.isInteger(cellsZ) || cellsX < 1 || cellsZ < 1) {
    throw new Error(
      `roomDefForHall('${name}'): Fussabdruck ${cellsX}×${cellsZ} ist keine ganze Zellzahl ≥ 1.`
    );
  }
  // Die Geometrie kachelt mit GRID_M, das Modulformat misst mit
  // MODULE_CELL_M. Solange beide gleich sind, ist die Hülle unten richtig;
  // gingen sie auseinander, wäre sie STILL falsch — der Generator läse
  // dann eine andere Zellzahl, als das GLB gebaut hat.
  if (GRID_M !== MODULE_CELL_M || HEIGHT_M !== MODULE_LEVEL_M) {
    throw new Error(
      `roomDefForHall: Saalraster ${GRID_M}×${HEIGHT_M} m weicht vom Modulraster ` +
        `${MODULE_CELL_M}×${MODULE_LEVEL_M} m ab — die Hülle liesse sich nicht mehr ableiten.`
    );
  }

  const halfX = (cellsX * GRID_M) / 2;
  const halfZ = (cellsZ * GRID_M) / 2;

  const connections: RoomConnectionDef[] = [];
  for (const side of SIDES) {
    // Auf der Nord/Süd-Seite läuft die Querkoordinate über x, auf der
    // Ost/West-Seite über z — und in beiden Fällen über die ZELLMITTEN
    // der Randzellen, nicht über die Zellkanten.
    const across = side.axis === 'z' ? cellsX : cellsZ;
    for (let i = 0; i < across; i++) {
      const offset = (i - (across - 1) / 2) * GRID_M;
      connections.push({
        type: TYP_ZELLKANTE,
        entrance: false,
        allowDoor: true,
        doorOnlyIfOtherAlsoAllowsDoor: false,
        // y = 0: Der Connector sitzt auf dem BODEN. Ein Connector auf
        // halber Höhe liesse Räume gegeneinander treppen (Bauteil-Vertrag
        // im Kopf von `eigeneDungeons.ts`).
        localPos:
          side.axis === 'z'
            ? { x: offset, y: 0, z: side.sign * halfZ }
            : { x: side.sign * halfX, y: 0, z: offset },
        localRot: side.rot,
      });
    }
  }

  return {
    name,
    // Derselbe Hash wie für jeden getippten Raum. Er ist die Netz- und
    // Persistenz-Kennung; wer ihn anders rechnete, verlöre den Raum beim
    // nächsten Laden des Dokuments.
    hash: getStableHash(name),
    divider: false,
    endCap: false,
    endCapPrio: 0,
    // Kein Eingangsraum: Der Eingang hängt den ganzen Grundriss auf, und
    // den setzt der Generator nie zweimal.
    entrance: false,
    faceCenter: false,
    minPlaceOrder: 0,
    perimeter: false,
    size: { x: cellsX * GRID_M, y: HEIGHT_M, z: cellsZ * GRID_M },
    theme: RoomTheme.Crypt,
    weight,
    pos: NULL_PUNKT,
    rot: KEINE_DREHUNG,
    connections,
    // Kein `gridEdges`: Jede Randkante trägt einen Connector, es gibt also
    // nichts zu erklären. Siehe Kopf dieser Datei.
    nurManuell: true,
  };
}

// ===========================================================================
// E4 — Das Eintragen
// ===========================================================================

/**
 * Trägt ein zur Laufzeit gebautes Modul in die Nachschlagewerke ein.
 *
 * ── Warum das eine GERUFENE Funktion ist und keine Import-Nebenwirkung ──
 * `shared/package.json` verspricht `sideEffects: false`, und der Kommentar
 * daneben nennt „keine Registry-Einträge“ ausdrücklich. Die Zusage ist
 * kein Stilhinweis: Sie erlaubt Rollup, aus dem Barrel wegzuwerfen, was
 * ein Einstieg nicht anfasst. Ein Modul, dessen ZWECK eine Mutation beim
 * Import wäre, dürfte also weggeworfen werden — und dann fehlte die
 * Registrierung ausgerechnet im ausgelieferten Bündel und in keinem Test.
 * Gerufen wird diese Funktion deshalb aus den Einstiegen (Client, Editor,
 * Server), sobald sie die Registry-Datei gelesen haben; der Wächter in
 * `shared/test/module-registry.ts` hält fest, dass unter `shared/src`
 * nichts beim Import mutiert.
 *
 * ── WANN gerufen werden muss: früh, und das ist keine Stilfrage ──────
 * Nachgesehen (E4, für E5/E6 aufgeschrieben): Zwei Stellen KOPIEREN die
 * Prefab-Registry, statt sie zu befragen. `PrefabManager` zieht beim Bauen
 * einmal über `PREFAB_DEFS` (`server/src/prefab/PrefabManager.ts`), und
 * `GegenstandsKatalog` leitet sein `MIT_MODELL` beim IMPORT daraus ab
 * (`client/src/editor/GegenstandsKatalog.ts`). Ein `registerModule` NACH
 * diesen beiden trägt in alle sechs Karten ein und bleibt trotzdem
 * unsichtbar — ohne Meldung, weil nichts fehlschlägt. Die Registrierung
 * gehört deshalb vor den Aufbau des Servers und vor den ersten Import des
 * Editor-Katalogs.
 *
 * ── Warum sechs Karten und nicht eine ────────────────────────────────
 * Ein Saal ist im Betrieb sechsmal eine andere Sache, und jede Stelle
 * fragt ein anderes Verzeichnis: der Generator und der Editor `kit.rooms`,
 * die Persistenz `ROOMS_BY_HASH`, das Steinmaterial `KIT_BY_ROOM_HASH`
 * bzw. `KIT_BY_PREFAB_HASH`, der Modell-Lader die Prefab-Registry, der
 * Spawn-Editor und die Welt-Whitelist `EIGENE_MODELLE`. Fehlt eine, ist
 * der Saal nicht halb da, sondern widersprüchlich: im Editor wählbar und
 * im Spiel unsichtbar, oder umgekehrt.
 *
 * ── Warum ALLE Prüfungen vor der ERSTEN Mutation stehen ──────────────
 * Eine Ablehnung, die den Zustand halb verändert zurücklässt, ist teurer
 * als gar keine: Ein Modul in `kit.rooms` ohne Prefab-Eintrag sähe der
 * Generator, und der Client fände kein Modell — die Meldung dazu käme aus
 * einer ganz anderen Ecke als der Fehler. Deshalb erst alle vier Prüfungen,
 * dann der Block Mutationen, der nicht mehr scheitern kann.
 *
 * @param kitName  Kit, zu dem das Modul gehört (heute nur `DG_StoneVault`).
 * @param room     Fertige RoomDef, z. B. aus {@link roomDefForHall}.
 * @throws wenn das Kit unbekannt ist, der Name oder der Hash schon vergeben
 *         ist, oder `nurManuell` fehlt.
 */
export function registerModule(kitName: string, room: RoomDef): void {
  const kit = DUNGEONS_BY_NAME.get(kitName);
  if (!kit) {
    throw new Error(`registerModule: Kit '${kitName}' gibt es nicht.`);
  }

  // (1) Name. Die Prefab-Registry führt JEDEN Raum jedes Kits (Schleife in
  // `buildRegistry`), sie ist deshalb die vollständige Namensliste — und
  // sie enthält zusätzlich alles andere, was ein GLB unter diesem Namen
  // lüde. Ein zweiter Saal gleichen Namens ist kein theoretischer Fall:
  // zwei Editor-Fenster, zweimal derselbe Zuschnitt.
  if (PREFABS_BY_NAME.has(room.name)) {
    throw new Error(
      `registerModule: Der Name '${room.name}' ist schon vergeben — ein Modulname ist ` +
        `unveränderlich (live liegt /assets/ sieben Tage im Browsercache).`
    );
  }

  // (2) Hash — und zwar VOR der Frage, ob er zum Namen passt. `getStableHash`
  // ist 32-bittig; zwei verschiedene Namen KÖNNEN denselben Hash tragen, und
  // dieser Saal überschriebe beim Laden still den fremden Raum, ohne dass
  // irgendein Name doppelt wäre. Geprüft werden alle drei Hash-Karten, denn
  // `KIT_BY_PREFAB_HASH` führt auch die TÜR-Prefabs — ein Zusammenstoss dort
  // hinge das falsche Kit an einen Türrahmen.
  const belegt =
    ROOMS_BY_HASH.has(room.hash) || PREFABS_BY_HASH.has(room.hash) || KIT_BY_PREFAB_HASH.has(room.hash);
  if (belegt) {
    const anderer = ROOMS_BY_HASH.get(room.hash)?.name ?? PREFABS_BY_HASH.get(room.hash)?.name ?? '?';
    throw new Error(
      `registerModule: Hash ${room.hash} von '${room.name}' ist schon von '${anderer}' belegt.`
    );
  }

  // (3) Der Hash MUSS der des Namens sein. Der Rest des Systems rechnet ihn
  // an jeder Stelle neu aus dem Namen aus (`PREFABS_BY_HASH` tut es zwei
  // Zeilen unter der Registry). Ein mitgebrachter Fantasiehash fiele
  // deshalb nirgends auf — bis ein persistiertes Dokument seinen Raum nicht
  // mehr findet.
  if (room.hash !== getStableHash(room.name)) {
    throw new Error(
      `registerModule: '${room.name}' bringt Hash ${room.hash} mit, sein Name ergibt ` +
        `${getStableHash(room.name)}.`
    );
  }

  // (4) `nurManuell` ist Pflicht, und das ist die teuerste der vier
  // Prüfungen — als einzige verhindert sie einen Fehler, der SONST NICHT
  // AUFFIELE. Ohne das Feld käme der Saal in die Stempelauswahl,
  // `pickStampOption` rechnete mit einer neuen Gewichtssumme, und jedes
  // noch nicht betretene Grab der Welt bekäme einen anderen Grundriss:
  // kein Absturz, keine Meldung, nur andere Gräber (Konzept 1i).
  if (room.nurManuell !== true) {
    throw new Error(
      `registerModule: '${room.name}' trägt kein nurManuell — ein registriertes Modul ` +
        `darf nie Generator-Material sein (Konzept 1i).`
    );
  }

  // ── Ab hier wird eingetragen, und nichts davon kann mehr scheitern ──
  //
  // Die Karten sind `ReadonlyMap`/`readonly` deklariert, weil sie für JEDEN
  // ANDEREN Leser unveränderlich sind — genau eine Stelle darf sie füllen,
  // und das ist diese. Die Umtypisierungen stehen deshalb hier und
  // nirgendwo sonst; sie sind die Kehrseite der Zusage, nicht ihr Bruch.
  (kit.rooms as RoomDef[]).push(room);
  (ROOMS_BY_HASH as Map<number, RoomDef>).set(room.hash, room);
  (KIT_BY_ROOM_HASH as Map<number, DungeonDef>).set(room.hash, kit);
  (KIT_BY_PREFAB_HASH as Map<number, DungeonDef>).set(room.hash, kit);

  // Der Prefab-Eintrag kommt aus derselben Funktion wie der von
  // `buildRegistry()` — nicht aus einer Kopie ihres Rumpfes.
  const prefab = roomPrefabDef(room);
  PREFAB_DEFS.push(prefab);
  (PREFABS_BY_HASH as Map<number, PrefabDef>).set(room.hash, prefab);
  (PREFABS_BY_NAME as Map<string, PrefabDef>).set(room.name, prefab);

  // LISTE und MENGE, nicht nur die Menge.
  //
  // Nachgesehen statt übernommen: Die Konzeptnotiz nennt an dieser Stelle
  // `EIGENE_MODELLE_SET.add` und begründet es damit, dass der Saal sonst
  // „im Spawn-Editor unauffindbar“ wäre. Der Spawn-Editor liest aber die
  // ARRAY-Fassung (`client/src/editor/SpawnPanel.ts`, `GegenstandsKatalog.ts`
  // — beide `EIGENE_MODELLE.filter(...)`); die MENGE fragen
  // `istEigenesModell` und `pruefeLayout`. Und die Menge entsteht EINMAL
  // beim Import aus dem Array: Ein späteres `add` erreicht das Array nicht,
  // ein späteres `push` nicht die Menge. Nur eines von beiden zu füllen
  // erfüllte also genau die Hälfte des Satzes, mit dem der Eintrag
  // begründet ist — und die andere Hälfte schwiege dazu.
  (EIGENE_MODELLE as string[]).push(room.name);
  (EIGENE_MODELLE_SET as Set<string>).add(room.name);
}

// ═══════════════════════════════════════════════════════════════════════
// E6 — Die Registry als Datei, und die eine Zahl, die beide Seiten
//      miteinander vergleichen.
// ═══════════════════════════════════════════════════════════════════════
//
// ── Warum das hier steht und nicht im Server ─────────────────────────
// Bis E5 lebten die Klemmen (Zellzahl, Raster, Gewicht, Namensform,
// Dreiecksdeckel) und die Prüfsumme in `server/src/world/dungeon/
// ModuleBuild.ts`, weil nur der Server baute. Ab E6 REGISTRIERT AUCH DER
// BROWSER: `client/src/main.ts` und `editorMain.ts` holen die
// Registry-Datei und tragen jeden Eintrag ein.
//
// Damit wird aus einer Bequemlichkeit eine Notwendigkeit. Verwürfe der
// Server einen Eintrag, den der Client annimmt, dann stimmten die
// Prüfsummen beider Seiten — und trotzdem böte der Editor einen Saal an,
// den der Server beim Speichern still fallen liesse. Das ist genau der
// Fehler, gegen den E6 antritt, nur eine Ebene tiefer. Deshalb gibt es
// die Klemmen genau EINMAL, und beide Seiten rufen dieselbe Funktion.
// `ModuleBuild.ts` reicht sie unverändert weiter, damit der Bauweg von
// E5 an einem Ort bleibt.
//
// ── Was die Prüfsumme beantwortet ────────────────────────────────────
// Genau eine Frage: „Kennen Client und Server dieselben Module?" Nicht
// „ist die Datei unverfälscht" — dafür wäre sie das falsche Werkzeug
// (dieselbe Überlegung wie bei den Dungeon-2.0-Dokumenten: ein Zeuge
// gegen Drift, keine Abwehr gegen einen Angreifer).
//
// The clamps and the checksum live HERE because from E6 on the browser
// registers modules too — a validation that differs between the two
// sides would produce matching checksums over differing room sets.

// ── Klemmen ─────────────────────────────────────────────────────────────
/** Kleinster Saal: ein einzelliger „Saal" wäre ein Korridorstück. */
export const CELLS_MIN = 2;
/** Grösster Saal: 8 Zellen sind 16 m — darüber trägt der Dreiecksdeckel ohnehin nicht mehr. */
export const CELLS_MAX = 8;
/** Erlaubte Pfeilerraster in Metern. Vielfache von `GRID_M`, sonst wirft `pillarPositions`. */
export const RASTER_ERLAUBT: readonly number[] = [2, 4, 6];
export const GEWICHT_MIN = 0.1;
export const GEWICHT_MAX = 2.0;
/**
 * Harter Deckel. Säle haben KEIN `_col`-Netz — das sichtbare Netz IST die
 * Havok-Form, jedes Dreieck ist begehbare Kollisionsgeometrie.
 * Nachgerechnet: 8×8 Zellen mit dem VORGABERASTER 2 ergeben
 * 12·(2 + 1024 + 3·49) = 14 076 und fallen durch; dieselben 8×8 mit
 * Raster 4 ergeben 12 636 und gehen durch.
 */
export const DREIECKS_DECKEL = 13_000;

/** Das Kit, zu dem gebaute Säle gehören. Heute gibt es genau eines. */
export const KIT_NAME = 'DG_StoneVault';
/** Namenspräfix — zugleich die Auskunft an den `AssetManager`, wo die Datei liegt (E7). */
export const NAME_PRAEFIX = 'Gen_StoneVaultHall';
/**
 * Die Form, die ein Modulname haben MUSS, bevor aus ihm ein Pfad wird.
 * Buchstaben und Ziffern, 1…16 Zeichen hinter dem Präfix — dieselbe
 * Bauart wie die Erlaubnisliste der Dungeon-ID im Betriebsdienst.
 */
export const NAME_MUSTER = /^Gen_StoneVaultHall[A-Za-z0-9]{1,16}$/;

/** Dateiname der Registry, neben den GLBs in `assets/generiert/`. */
export const REGISTRY_DATEI = 'modul-registry.json';
export const REGISTRY_VERSION = 1;

// ── Typen ───────────────────────────────────────────────────────────────
/** Was der Client beim Bauen schickt: vier Zahlen, kein Name, kein Pfad. */
export interface ModulBauWunsch {
  readonly cellsX: number;
  readonly cellsZ: number;
  readonly raster: number;
  readonly weight: number;
}

/** Ein Eintrag der Registry-Datei. Deutsche Schlüssel wie in der Konzeptnotiz. */
export interface RegistryModul {
  readonly kit: string;
  readonly name: string;
  readonly zellenX: number;
  readonly zellenZ: number;
  readonly pfeilerRaster: number;
  readonly gewicht: number;
  readonly tris: number;
  readonly erzeugt: string;
}

/** Die Registry-Datei, so wie sie auf der Platte liegt. */
export interface RegistryDatei {
  readonly version: number;
  readonly pruefsumme: string;
  readonly module: RegistryModul[];
}

// ── Rechnung ────────────────────────────────────────────────────────────
/**
 * Die Dreieckszahl eines Saals OHNE ihn zu bauen — die geschlossene
 * Formel aus der Konzeptnotiz: 12·(2 + 16·cx·cz + 3·P).
 *
 * Sie steht hier, weil der Deckel VOR dem Bau greifen muss: Ein Saal, den
 * man erst baut und dann verwirft, hat schon 14 000 Quader im Speicher
 * gehabt — und im Registry-Leser gibt es gar keine Geometrie, nur Zahlen
 * aus einer Textdatei.
 */
export function dreiecke(cellsX: number, cellsZ: number, raster: number): number {
  const pfeiler = pillarPositions(cellsX, cellsZ, raster).length;
  return 12 * (2 + 16 * cellsX * cellsZ + 3 * pfeiler);
}

/**
 * Das Raster, das im Namen steht — und das ist NICHT immer das gewünschte.
 *
 * Gemessen statt angenommen: Ein 2×2-Saal ist 4 m breit, liegt also unter
 * der Pfeilerspanne und bekommt unter JEDEM Raster null Pfeiler; bei 2×4
 * ergeben Raster 4 und 6 beide null. Hiesse der Name schlicht nach der
 * eingetippten Zahl, stünden zwei (oder drei) Namen für eine einzige,
 * byte-gleiche Geometrie: Der zweite Bau schriebe eine Kopie unter neuem
 * Namen, statt auf das vorhandene Modul zu zeigen — und der Editor böte
 * dieselbe Halle mehrfach an. Deshalb wird auf das KLEINSTE erlaubte
 * Raster zurückgeführt, das dieselben Pfeilerstellen ergibt.
 */
export function kanonischesRaster(cellsX: number, cellsZ: number, raster: number): number {
  const soll = JSON.stringify(pillarPositions(cellsX, cellsZ, raster));
  for (const r of RASTER_ERLAUBT) {
    if (JSON.stringify(pillarPositions(cellsX, cellsZ, r)) === soll) return r;
  }
  return raster;
}

/**
 * Der massabgeleitete Modulname. Das Raster steht nur im Namen, wenn es
 * von der Vorgabe abweicht — und nur, wenn diese Abweichung überhaupt
 * eine andere Geometrie ergibt (siehe `kanonischesRaster`).
 */
export function modulName(cellsX: number, cellsZ: number, raster: number): string {
  const kanon = kanonischesRaster(cellsX, cellsZ, raster);
  const anhang = kanon === GRID_M ? '' : `r${kanon}`;
  return `${NAME_PRAEFIX}${cellsX}x${cellsZ}${anhang}`;
}

// ── Prüfungen ───────────────────────────────────────────────────────────
/**
 * Die Masse. Gibt die Ablehnungsmeldung zurück oder `null`.
 *
 * Dieselbe Funktion läuft im Paketweg, im Registry-Leser des Servers UND
 * im Browser: Eine von Hand nachgetragene Zeile in der Registry ist
 * genauso eine Eingabe wie ein Paket aus dem Netz, nur eine, der man es
 * weniger ansieht.
 */
export function pruefeMasse(wunsch: ModulBauWunsch): string | null {
  const { cellsX, cellsZ, raster, weight } = wunsch;
  for (const [achse, wert] of [
    ['x', cellsX],
    ['z', cellsZ],
  ] as const) {
    if (!Number.isInteger(wert) || wert < CELLS_MIN || wert > CELLS_MAX) {
      return (
        `Zellzahl ${achse} = ${wert} liegt ausserhalb von ${CELLS_MIN}…${CELLS_MAX} ` +
        `(ganzzahlig).`
      );
    }
  }
  if (!RASTER_ERLAUBT.includes(raster)) {
    return `Pfeilerraster ${raster} ist nicht erlaubt — zulässig sind ${RASTER_ERLAUBT.join(', ')} m.`;
  }
  // Float32-Toleranz: Der Client schickt das Gewicht als Float32, und
  // 0,1 kommt dort als 0,10000000149 an. Ohne das Epsilon wäre die untere
  // Klemme genau am Randwert unerreichbar — ein Fehler, der aussieht wie
  // Willkür.
  if (!Number.isFinite(weight) || weight < GEWICHT_MIN - 1e-6 || weight > GEWICHT_MAX + 1e-6) {
    return `Gewicht ${weight} liegt ausserhalb von ${GEWICHT_MIN}…${GEWICHT_MAX}.`;
  }
  return null;
}

/** Der Dreiecksdeckel. Gibt die Ablehnungsmeldung zurück oder `null`. */
export function pruefeDreiecke(tris: number): string | null {
  if (tris > DREIECKS_DECKEL) {
    return (
      `${tris} Dreiecke überschreiten den Deckel von ${DREIECKS_DECKEL} — Säle haben kein ` +
      `Kollisionsnetz, das sichtbare Netz ist die Havok-Form.`
    );
  }
  return null;
}

/**
 * Die Form des Namens — geprüft, BEVOR aus ihm irgendwo ein Dateiname wird.
 *
 * Drei getrennte Meldungen statt einer: Ein Name mit einem Schrägstrich
 * ist ein anderer Vorfall als einer ohne Präfix. Wer nur „ungültiger
 * Name" liest, sucht an der falschen Stelle.
 *
 * Die Funktion kennt keinen Pfad. Den zusammenzusetzen bleibt Sache des
 * Servers (`ModuleBuild.glbPfad`) — im Browser gibt es keinen, und eine
 * Prüfung, die man nur mit `node:path` aufrufen kann, liefe dort nie.
 */
export function pruefeName(name: string): string | null {
  if (typeof name !== 'string' || /[^A-Za-z0-9_]/.test(name)) {
    return (
      `Modulname '${name}' enthält Zeichen, die kein Dateiname sein dürfen — erlaubt sind ` +
      `Buchstaben, Ziffern und Unterstrich.`
    );
  }
  if (!name.startsWith(NAME_PRAEFIX)) {
    return `Modulname '${name}' trägt nicht das Präfix ${NAME_PRAEFIX}.`;
  }
  if (!NAME_MUSTER.test(name)) {
    return `Modulname '${name}' hat nicht die Form ${NAME_PRAEFIX}<Kennung> mit 1…16 Zeichen.`;
  }
  return null;
}

/**
 * Ein Registry-Eintrag, vollständig geprüft — Gestalt, Masse, Name,
 * Deckel, und die Frage, ob die genannte Dreieckszahl zum Zuschnitt passt.
 *
 * Die letzte Prüfung ist die, die man weglassen möchte und nicht darf:
 * `tris` steht in der Datei, wird aber nirgends nachgerechnet, wenn ihn
 * niemand nachrechnet. Ein Eintrag, der 2 364 Dreiecke behauptet und
 * 14 076 meint, käme am Deckel vorbei — er ist ja nur ein Text.
 */
export function pruefeRegistryEintrag(m: RegistryModul): string | null {
  if (!m || typeof m !== 'object') return 'Registry-Eintrag ist kein Objekt.';
  if (typeof m.kit !== 'string' || m.kit.length === 0) return 'Registry-Eintrag ohne Kit.';
  const nameGrund = pruefeName(m.name);
  if (nameGrund) return nameGrund;
  const masse = pruefeMasse({
    cellsX: m.zellenX,
    cellsZ: m.zellenZ,
    raster: m.pfeilerRaster,
    weight: m.gewicht,
  });
  if (masse) return masse;
  const soll = dreiecke(m.zellenX, m.zellenZ, m.pfeilerRaster);
  const deckel = pruefeDreiecke(soll);
  if (deckel) return deckel;
  if (m.tris !== soll) {
    return `Registry nennt ${m.tris} Dreiecke, der Zuschnitt ergibt ${soll}.`;
  }
  return null;
}

// ── Die Prüfsumme ───────────────────────────────────────────────────────
/**
 * Die Prüfsumme über einen Modulstand — dieselbe Bauart wie bei den
 * Dungeon-2.0-Dokumenten (`fnv1a32`, acht Hexstellen).
 *
 * Sortiert, damit die REIHENFOLGE der Einträge nicht eingeht: Zwei
 * Server, die dieselben Säle in anderer Folge geladen haben, sind sich
 * einig, und eine Warnung, die das anders sähe, wäre falsch.
 *
 * Der ZEITSTEMPEL geht bewusst NICHT ein. Die Prüfsumme beantwortet genau
 * eine Frage: „Kennen Client und Server dieselben Module?" Ginge die
 * Bauzeit ein, meldete sie Drift zwischen zwei Seiten, die über jeden
 * Raum einig sind — und eine Warnung, die falsch anschlägt, wird nach dem
 * dritten Mal weggeklickt.
 */
export function registryPruefsumme(module: readonly RegistryModul[]): string {
  const kanonisch = [...module]
    .map(
      (m) =>
        `${m.kit}|${m.name}|${m.zellenX}|${m.zellenZ}|${m.pfeilerRaster}|${m.gewicht}|${m.tris}`
    )
    .sort()
    .join('\n');
  return (fnv1a32(`v${REGISTRY_VERSION}\n${kanonisch}`) >>> 0).toString(16).padStart(8, '0');
}

/** Der Stand „keine Module" — das, was eine fehlende Datei bedeutet. */
export function leereRegistry(): RegistryDatei {
  return { version: REGISTRY_VERSION, pruefsumme: registryPruefsumme([]), module: [] };
}

/**
 * Die Registry-Datei aus ihrem TEXT lesen — für den Server (Datei) und
 * den Browser (`fetch`) dieselbe Funktion.
 *
 * Zwei Entscheidungen stecken darin:
 *
 * (1) **Ein unlesbarer Text ist eine LEERE Registry, kein Absturz.** Die
 *     Datei liegt in `assets/generiert/`, reist per tar und lässt sich von
 *     Hand bearbeiten; sie fehlt auf jeder Maschine, die noch nie einen
 *     Saal gebaut hat. Ein Client, der daran stürbe, käme wegen einer
 *     Datei nicht ins Spiel, die es normalerweise gar nicht gibt.
 *
 * (2) **Das Feld `pruefsumme` IN der Datei wird nicht geglaubt, sondern
 *     nachgerechnet.** Es ist eine Bequemlichkeit für den Menschen, der
 *     hineinsieht. Übernähme man es, könnte eine von Hand geänderte Zeile
 *     die Zahl unverändert lassen — und dann sagten beide Seiten „einig",
 *     während sie es nicht sind. Die Prüfsumme muss aus dem STAND folgen,
 *     nicht neben ihm stehen.
 */
export function leseRegistryAusText(text: string): RegistryDatei {
  let roh: Partial<RegistryDatei> | null = null;
  try {
    roh = JSON.parse(text) as Partial<RegistryDatei>;
  } catch {
    return leereRegistry();
  }
  if (!roh || typeof roh !== 'object') return leereRegistry();
  const module = Array.isArray(roh.module) ? (roh.module as RegistryModul[]) : [];
  return {
    version: typeof roh.version === 'number' ? roh.version : REGISTRY_VERSION,
    pruefsumme: registryPruefsumme(module),
    module,
  };
}

// ── Was DIESE Seite kennt ───────────────────────────────────────────────
/**
 * Die Einträge, die in diesem Prozess wirklich registriert wurden.
 *
 * Nicht die Datei, sondern der ZUSTAND. Der Unterschied zählt genau dann,
 * wenn die Datei einen Eintrag trägt, den keine Seite registrieren kann:
 * Über die Datei gerechnet wären sich Client und Server dann „einig" über
 * ein Modul, das keiner von beiden hat. Über den Zustand gerechnet sind
 * sie es über das, was tatsächlich benutzbar ist — und das ist die Frage,
 * die beim Speichern eines Dokuments gestellt wird.
 *
 * Das Feld wird beim Import angelegt und NUR von `registerRegistryEntry`
 * gefüllt; keine Zeile ausserhalb einer Funktion fasst es an
 * (`sideEffects: false`, Wächter in `shared/test/module-registry.ts`).
 */
const REGISTRIERT: RegistryModul[] = [];

/** Die Module, die dieser Prozess kennt — Lesekopie, nicht die Liste selbst. */
export function registeredModules(): readonly RegistryModul[] {
  return REGISTRIERT.slice();
}

/**
 * Die Zahl, die mit jedem `DungeonEditSave` mitreist.
 *
 * Client und Server rechnen sie mit derselben Funktion über denselben
 * Zustand aus. Sind sie ungleich, ist die Seite im Browser älter oder
 * jünger als der Server — und ein Dokument, das sie jetzt schickte,
 * verlöre Räume, ohne dass jemand es merkte.
 */
export function registryChecksum(): string {
  return registryPruefsumme(REGISTRIERT);
}

/** Der kanonische Text eines Eintrags — nur für den Vergleich „schon da?". */
function eintragsSchluessel(m: RegistryModul): string {
  return `${m.kit}|${m.name}|${m.zellenX}|${m.zellenZ}|${m.pfeilerRaster}|${m.gewicht}|${m.tris}`;
}

/**
 * Einen Registry-Eintrag prüfen, eintragen und vermerken.
 *
 * Der Vermerk ist der Unterschied zu `registerModule`: Erst er macht den
 * Saal für {@link registryChecksum} sichtbar. Beide Seiten gehen deshalb
 * durch DIESE Tür — der Server beim Start und nach jedem Bau, der Browser
 * nach dem `fetch`.
 *
 * **Zweimal derselbe Eintrag ist KEIN Fehler.** Ein Client kann die
 * Registry ein zweites Mal holen (Editor und Spiel im selben Tab, ein
 * erneuter Aufruf nach einem Bau), und ein zweiter Durchlauf über
 * dieselbe Datei soll keine Meldung erzeugen. Ein Eintrag mit gleichem
 * NAMEN, aber anderem Zuschnitt fällt dagegen weiter durch — den fängt
 * `registerModule` mit seiner Namensprüfung ab, und das ist richtig so:
 * Modulnamen sind unveränderlich.
 *
 * @throws wenn der Eintrag eine Klemme reisst oder der Name schon anders
 *         belegt ist.
 */
export function registerRegistryEntry(m: RegistryModul): void {
  const schluessel = eintragsSchluessel(m);
  if (REGISTRIERT.some((v) => eintragsSchluessel(v) === schluessel)) return;
  const grund = pruefeRegistryEintrag(m);
  if (grund) throw new Error(grund);
  registerModule(m.kit, roomDefForHall(m.name, m.zellenX, m.zellenZ, m.gewicht));
  REGISTRIERT.push(m);
}

export interface RegistryLadeErgebnis {
  /** Einträge, die registriert wurden. */
  readonly geladen: number;
  /** Einträge, die NICHT registriert wurden — mit Grund. */
  readonly meldungen: string[];
}

/**
 * Einen gelesenen Registry-Stand vollständig eintragen.
 *
 * Ein abgelehnter Eintrag hält die anderen NICHT auf: Eine kaputte Zeile
 * soll nicht alle Säle mitnehmen. Gemeldet wird jeder einzeln, mit Namen —
 * eine Sammelmeldung „Registry fehlerhaft" schickte den Leser in eine
 * Datei mit womöglich dreissig Einträgen.
 */
export function applyModuleRegistry(datei: RegistryDatei): RegistryLadeErgebnis {
  const meldungen: string[] = [];
  let geladen = 0;
  for (const m of datei.module ?? []) {
    try {
      registerRegistryEntry(m);
      geladen++;
    } catch (e) {
      meldungen.push(`'${m?.name ?? '?'}': ${(e as Error).message}`);
    }
  }
  return { geladen, meldungen };
}
