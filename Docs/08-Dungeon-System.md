# Dungeon-System (Phase G)

> ## ⛔ Stand 16.08.2026: abgeschaltet, nicht abgebaut
>
> `server/data/server.yml` setzt `dungeons.enabled: false`. **Das ist keine Änderung an
> diesem System** — alles, was unten steht, ist unverändert vorhanden, getestet und
> lauffähig. Abgeschaltet ist es aus einem Materialgrund: Sämtliche Raumteile und alle zehn
> Eingangshüllen-Modelle sind Valheim-Exporte, und seit Block A steht ausschließlich
> eigener Bau in der Welt (`EIGENE_MODELLE` / `istEigenesModell()`,
> siehe [04-Asset-Pipeline.md](04-Asset-Pipeline.md)).
>
> Die Fahne folgt zwingend aus `world.features: false`: Dungeons hängen an Locations. Ohne
> gebuchte Krypta gibt es keinen Eingang — und selbst wenn es einen gäbe, wäre die
> betretbare Instanz ein leerer Raum aus unsichtbaren Wänden.
>
> **Verworfen wurde**, die Eingänge weiter zu buchen und nur clientseitig auszublenden. Dann
> stünden Geister-ZDOs im Spielstand, die später nicht mehr zu der Buchung passen, die mit
> eigenen Modellen entsteht. Ebenso verworfen: Platzhalter-Würfel als Hülle spawnen — das
> hätte die Welt mit Kisten gepflastert, die niemand betreten kann.
>
> Was das konkret heißt, Weg für Weg:
>
> | Weg | Verhalten heute |
> |---|---|
> | `ZoneManager.generateFeature` → `onDungeonPiece` | läuft nicht, weil keine Location gebucht wird |
> | Boot-Backfill in `WovServer` | prüft neuerdings `dungeonsEnabled` und läuft leer — er war der einzige Pfad, der an der Fahne vorbeilief und trotzdem Eingänge buchte, samt Kartenmarken auf unsichtbare Krypten |
> | `spawnEntranceHull()` | prüft `istEigenesModell(entrance.feature)` und erzeugt **kein ZDO**; die übersprungenen Hüllen werden gezählt und geloggt, weil eine stille Null offenließe, ob die Registrierung leer ist oder die Hüllen mit Absicht ausbleiben |
> | Instanzen, Generator, Editor, Admin-Kommandos | unverändert; ohne Eingang nur nicht erreichbar |
>
> **Das System kommt zurück, sobald es eigene Raum- und Eingangsmodelle gibt.** Bis dahin
> ist dieses Dokument die Beschreibung eines schlafenden, nicht eines abgeschafften Systems.
> Zu ändern ist dann eine Zeile in `server.yml` plus die Einträge in `EIGENE_MODELLE`.

Dungeons sind bei uns **eigenständige Instanzen** — anders als im Original,
das Innenräume 5 km über den Eingang in dieselbe Zone legt (`y + 5000`,
`Character.InInterior() => y > 3000`). Jeder Dungeon hat eine **eigene ID**,
ist **generierbar**, im **Editor baubar/anpassbar** und **Eingängen in der
Welt zuweisbar**.

## Instanz-Modell: Koordinaten-Bänder

Instanzen liegen im selben Weltkoordinatensystem, aber weit außerhalb der
spielbaren Welt (Außenkante ±8 192 m):

- Basis `DUNGEON_INSTANCE_X_BASE = 100 000`, ein Slot alle
  `DUNGEON_INSTANCE_SPACING = 640 m` entlang +z (`shared/src/constants.ts`).
- `x > DUNGEON_INSTANCE_BAND_MIN (50 000)` ⇔ „in einer Instanz“
  (`isInDungeonBand()`).
- Der Slot-Abstand übersteigt den ZDO-Interest-Radius (4 Zonen = 256 m) —
  Instanzen sehen weder die Oberwelt noch einander; Betreten/Verlassen ist
  ein Teleport. Das `objectsBySectorOuter`-Lager des ZDOManagers trägt die
  Koordinaten nativ, **keine Protokolländerung am ZDO-Sync nötig**.
- Idee nach dem Vorbild von world-of-claudecraft (`instanceOrigin`-Muster).

Konsequenzen im Server (`ValhallaServer.ts`):
- `update()`: Peers im Band treiben weder Vegetations-Zonen noch Spawns an.
- `saveWorld()`: Band-ZDOs werden **nie** gespeichert — Instanzen werden aus
  ihrem Dokument re-materialisiert (Loot-Reset beim Neustart, wie Valheims
  eigene Dungeon-Regeneration).
- `handlePlayerInput()`: im Band gibt es keine Heightmap; der Client meldet
  seine Physik-Höhe über das `moveY`-Feld (geclampt auf −100…300).
- `onPeerQuit`/Save: Wer im Dungeon ausloggt, kehrt an die gemerkte
  Oberwelt-Position zurück (`peer.dungeonReturn`).

## Datenfluss

```
dungeons.pkg (valheim.community)
  └─ tools/prefab-parser/parse-dungeons.ts        (Format: DungeonManager.cpp:19-201)
      ├─ shared/src/dungeonsData.json             13 DG_*-Generatoren, 392 Räume (Kopf)
      │   └─ shared/src/dungeons.ts               DungeonDef/RoomDef/Connection-Registry
      │       ├─ shared/src/dungeonGenerator.ts   Generator + Editor-Helfer
      │       ├─ server/src/world/dungeon/DungeonManager.ts
      │       └─ client/src/ui/DungeonEditor.ts
      └─ shared/src/roomPiecesData.json           Raum-EINRICHTUNG, 289 Prefabs (nur Server)
          └─ shared/src/roomPieces.ts
              └─ shared/src/dungeonFlatten.ts     flattenLayout → konkrete Prefab-Instanzen
```

**Warum zwei Dateien** (Bundle-Schnitt): netViews und randomSpawns machen
~5,2 MB aus und werden nur beim Materialisieren gebraucht — also
serverseitig. Der Raum-Kopf dagegen hängt über `prefabs.ts` am
shared-Barrel und damit an jedem Client-Modul; die Einrichtung lag dadurch
komplett im Browser-Bundle. `roomPieces.ts` und `dungeonFlatten.ts` stehen
deshalb NICHT im Barrel, sondern werden über ihren expliziten Pfad
importiert (`@wov/shared/src/dungeonFlatten.js`). Geschlüsselt wird die
Einrichtung nach RAUMNAME: 103 der 392 Einträge sind Mehrfachverwendungen
desselben Prefabs in mehreren Kits und im pkg identisch (der Parser bricht
ab, falls das je nicht mehr gilt). Die Naht zwischen beiden Dateien prüft
`shared/test/weltdaten-schnitt.ts` aus der Kern-Testliste.

Die pkg liefert, was den GLB-Exporten fehlt: Raumgrößen (OBB), Connector-
Transforms (`RoomConnection`), Themes, Gewichte, Endcap-Prios und die
**netViews** (Truhen, Spawner, Fackeln … je Raum). Raum-Prefabs sind keine
ZNetView-Prefabs — `shared/src/prefabs.ts` hängt sie mit `flags = 0n` an die
Registry (renderbar, statisch, nicht persistent).

⚠️ **Hier stand: „Alle 392 Raumnamen haben ein GLB unter `assets/models/`."** Das galt,
solange dort der AssetRipper-Export lag. Seit dem 16.08.2026 stehen in `assets/models/`
119 selbst gebaute GLBs, und **keine einzige** davon ist ein Dungeon-Raum. Die
Datengrundlage — `dungeonsData.json`, `roomPiecesData.json`, die Naht dazwischen — ist
davon unberührt und wird von `shared/test/weltdaten-schnitt.ts` weiter geprüft; es fehlt
die Geometrie, nicht die Beschreibung. Wer eigene Räume baut, braucht deshalb nicht die
392 Namen nachzubauen, sondern ein eigenes Kit mit eigenen Connector-Transforms.

## Generator

`generateDungeonLayout(def, seed, settings?)` in
`shared/src/dungeonGenerator.ts` — 1:1-Port des C++-Algorithmus
(DungeonGenerator.cpp), aber in **lokalem Raum um den Ursprung** (der
Entrance-Connector des Startraums landet exakt auf (0,0,0)):

1. `PlaceStartRoom` — zufälliger Entrance-Raum.
2. `PlaceRooms` — Random-Growth über offene Connectors
   (`maxRooms × 2` Versuche, 10 Kandidaten je Versuch, `minPlaceOrder`-
   Gating, gewichtete Auswahl bei `alternativeFunctionality`).
3. `PlaceEndCaps` — Zyklen per 0,1-m-Kontakt erkennen, sonst Endcaps nach
   Prio, notfalls Force-Place (Loch zu > Überlappung).
4. `PlaceDoors` — je Tür-Connection ein Wurf gegen `doorChance`.

RNG ist `XorShiftRandom` (Unity-kompatibel, ein Stream — **Ziehreihenfolge
ist Vertrag**). Ergebnis: `DungeonLayout { rooms, doors }`. Kollisionstest =
rotierte AABBs, Wachstumsgrenze `zoneSize` (64 m-Würfel) um den Ursprung.
Nur `algorithm = Dungeon` wird instanziert; Camps (GoblinCamp,
MeadowsVillage …) bleiben Oberwelt. Tests: `shared/test/dungeon-generator.ts`.

## Dokumente & IDs

`DungeonDocument` (`shared/src/dungeons.ts`): `{ version, id, name, base,
mode: generated|custom, seed, zoneSize, layout }` — liegt als
`server/data/dungeons/<id>.json`. Auch generierte Dungeons werden
**materialisiert gespeichert**, damit sie editierbar sind.
`sanitizeDungeonDocument()` ist der einzige Weg hinein (Editor-Upload,
Disk-Load): clampt alles, wirft nie, kappt bei 256 Räumen/Türen, verwirft
Räume außerhalb des Basis-Kits.

## Server: DungeonManager

`server/src/world/dungeon/DungeonManager.ts`:
- **Dokumente**: `load()/saveDocument()/upsertDocument()/createGenerated()`.
- **Eingänge**: `ZoneManager.generateFeature` überspringt DUNGEON-Pieces
  weiterhin, meldet sie aber über den Hook `onDungeonPiece` →
  `registerEntrance()` erzeugt beim ersten Kontakt deterministisch ein
  generiertes Dokument (`<slug>-<zone>`, Seed aus der Location) und merkt
  sich Zone→Dungeon-ID in `data/dungeons/<instanz>/entrances.json`. Zuweisung per
  `dungeon assign` überschreibbar. (Achtung: bereits generierte Zonen eines
  alten Saves laufen nicht erneut durch `generateFeature` — Eingänge
  entstehen dort erst bei neuen Zonen oder frischer Welt.)
  - **Sichtbare Hülle**: `spawnEntranceHull()` legt für jeden bekannten Eingang ein
    gewöhnliches statisches ZDO an (im Original ist die Hülle Location-Prefab-Geometrie
    ohne ZNetView). Bewusst **nicht persistent** — der Aufruf läuft bei jedem Serverstart
    für alle Eingänge erneut (`spawnAllEntranceHulls`), gespeicherte Hüllen würden sich
    sonst bei jedem Boot verdoppeln.
  - ⛔ **Seit Block A entsteht dabei kein ZDO mehr.** Alle zehn Namen in
    `ENTRANCE_HULL_MODELS` sind Valheim-Exporte; die Prüfung sitzt in
    `spawnEntranceHull()` und nicht beim Aufrufer, weil dort drei Wege durchlaufen
    (Zonen-Hook, Boot-Backfill, Admin-Befehl). Registrierte Eingänge bleiben damit
    Buchhaltung ohne Weltwirkung — keine Hülle, keine Kartenmarke, kein betretbarer
    Zugang. Der Zähler „*n* Eingangshülle(n) übersprungen — kein eigenes Modell" im
    Serverlog ist die einzige Spur.
  - Da `world.features: false` ohnehin keine Location mehr bucht, steht die
    Eingangstabelle auf dev derzeit auf 0 Einträgen; auf einem älteren Spielstand
    bleiben die früher registrierten Einträge stehen und laufen ins Leere.
- **Instanzen**: `getOrCreateInstance()` materialisiert `flattenLayout()`
  (Raum-Hüllen + netViews + Türen) als normale ZDOs im Slot;
  `destroyInstance()` räumt ab und gibt den Slot frei.

## Admin-Kommandos

`dungeon list | entrances | create <basis> [seed] | enter [id] | leave |
assign <id> | regen <id> [seed] | reset <id> | delete <id>` — registriert in
`ValhallaServer.registerDungeonCommands()`. `teleport` ist dungeon-bewusst
überschrieben (Strg+Klick auf die Karte verlässt die Instanz sauber).
Serverantworten erscheinen als HUD-Meldung (AdminEvent-Handler im Client).

## Client

- **E-Taste**: Oberwelt → `dungeon enter` (Server findet den nächsten
  Eingang ≤ 16 m); in der Instanz nahe dem Einstiegspunkt (≤ 6 m) →
  `dungeon leave`.
- **Teleport-Paket** (`PacketType.Teleport`): Position hart setzen
  (`PlayerController.teleportTo`), `dungeonMode` schalten, Terrain/Wasser/
  Gras/Niederschlag pausieren (`TerrainManager.setInstanzModus`), Interior-
  Environment erzwingen (`interiorEnvironment(base)` → 'Crypt',
  'SunkenCrypt', 'Caves' … — alwaysDark aus envData).
- **Kollision**: Dungeon-Räume bekommen **exakte Mesh-Collider**
  (`buildMeshCollider` in `engine/Physics.ts`, `PhysicsShapeMesh` aus
  Positionen+Indizes — MergeMeshes scheitert an gemischten
  Attributsätzen, und eine Box würde das begehbare Innere massiv machen).
  Rettungsanker: fällt die Figur > 80 m unter den Einstieg, geht es zurück
  zum Spawn.
- **PlayerController.dungeonMode**: Heightmap-Klemmen (Boden, Kamera,
  Havok-Fallback) sind im Band abgeschaltet.

## Dungeon-Editor (F4)

`client/src/ui/DungeonEditor.ts` — DOM-Panel im SettingsPanel-Stil, nur in
einer Instanz (Admin). Dokument kommt per `DungeonEditRequest/Data`;
Operationen laufen lokal über die Shared-Helfer:
- `computeOpenConnections()` — Connectors ohne Gegenstück (0,1 m).
- `attachRoom()` — Raum 180°-geflippt andocken, Typ-Match + AABB-
  Kollisionstest (Endcaps ausgenommen). Dieselben Regeln wie der Generator:
  wo nur ein Endcap passte, passt auch im Editor nur ein Endcap.
- `removeRoom()` — nie Index 0; Türen auf den freigelegten Connectors
  verschwinden mit.

„Speichern“ (`DungeonEditSave`) sanitisiert + persistiert serverseitig,
reißt die Instanz ab, baut sie neu und teleportiert den Spieler wieder
hinein — **die Instanz selbst ist die Vorschau**. Dazu: „Speichern als“
(Fork mit neuer ID), „Neu generieren“ (Seed).

## Tests

- `shared/test/dungeon-generator.ts` — Determinismus, Kollisionmfreiheit,
  Ursprungs-Anker, Sanitizer.
- `server/test/g5-dungeons.ts` — Dokumente, Instanzen/Slots, Teardown,
  Editor-Upsert, Eingänge.
- `server/test/g6-dungeon-e2e.ts` — Wire-Roundtrip create/enter/ZDO-Sync/
  leave über echten WebSocket.
