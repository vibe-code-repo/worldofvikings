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
import { GRID_M, HEIGHT_M } from './hallenGeometrie.js';
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
