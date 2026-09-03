---
tags: [wov, dungeon-generator-2, legacy]
status: laufend
erstellt: 2026-08-30
---

# LEGACY-Liste — Dungeon Generator 2.0

**Regel: markieren, nicht löschen.** Diese Liste wird ab Arbeitspaket 0
(AP0) laufend gefüllt, sobald ein Altbestandteil durch sein Gegenstück in
`shared/src/dungeon2/` (oder die zugehörigen Client-/Server-/Tool-Module)
ersetzt ist. **Ein** Lösch-Commit erfolgt erst nach Mikes Abnahme von
Meilenstein 1 (`design/ARCHITECTURE.md` §4/§5).

Quelle: `design/ARCHITECTURE.md` §5 (dort ausführlich begründet). Diese
Datei ist die kompakte, laufend geführte Fassung derselben Liste — bei
Widerspruch gilt `ARCHITECTURE.md`.

Jede betroffene Datei trägt zusätzlich einen Kopf- bzw. Blockkommentar
("LEGACY — wird nach Erfolg von Dungeon Generator 2.0 geloescht / will be
deleted once Dungeon Generator 2.0 succeeds"), damit der Status auch ohne
diese Liste sichtbar ist.

---

## Vorher teilen — sonst stempelt man die Oberwelt mit

`shared/src/dungeonGenerator.ts` enthält `generateCampLayout`/`CampGround`
— **Oberweltinhalt für Dörfer, Höfe und Goblinlager, der weiterlebt.**
Diese Datei trägt deshalb **keinen** Ganzdatei-Kopfkommentar, sondern
gezielte Markierungen um die betroffenen Symbole; der Camp-Teil ist
ausdrücklich als „bleibt aktiv" gekennzeichnet. Die eigentliche Trennung
in `shared/src/campGenerator.ts` ist ein separater AP0-Arbeitsschritt und
mit dieser LEGACY-Markierung noch nicht erledigt.

## Die Liste

| Datei / Symbol | Status | Grund |
|---|---|---|
| `shared/src/dungeonGenerator.ts` (ohne Camps) | **BLEIBT** — Grundlage des Connector-Modul-Kits (`DG_StoneVault`), Entscheidung 03.09.2026, s. Vault-Notiz „Workflow — Connector-Modul-Kit" | das Kit benutzt den Saat-Generator; der Saat-Vertrag bleibt (`server/test/m3-stonevault-seeds.ts` prüft 40 Seeds von `DG_StoneVault`) |
| ↳ `generateDungeonLayout`, `DungeonGeneratorSettings`, `DEFAULT_GENERATOR_SETTINGS` | **BLEIBT** — Grundlage des Connector-Modul-Kits (`DG_StoneVault`), Entscheidung 03.09.2026 | der Saat-Vertrag des Kits: aus Basis + Seed fällt derselbe Grundriss. `endcaps*`, `roomsFlipped`, `roomsInsetSize`, `roomBodyFromFloor` bleiben als seine Stellschrauben mit |
| ↳ `attachRoom`, `removeRoom`, `computeOpenConnections`, `OpenConnection` | **BLEIBT** — Grundlage des Connector-Modul-Kits (`DG_StoneVault`), Entscheidung 03.09.2026, s. Vault-Notiz „Workflow — Connector-Modul-Kit" | die Handbau-Operationen des Editors; `stempelSetzen`/`stempelEntfernen` ersetzen sie **nicht**, sie stehen daneben |
| ↳ `generateCampLayout`, `CampGround` | **bleibt** → wandert nach `shared/src/campGenerator.ts` (Trennung noch offen) | Oberwelt |
| `shared/src/dungeonFlatten.ts` | **LEGACY** | Layout → Raum-GLB-Instanzen; Architektur ist keine Prefabliste mehr |
| `shared/src/dungeonRaster.ts` | **LEGACY** | prüft GLB-Bauteile, die es nicht mehr gibt. Konstanten und Herleitung sind bereits in `shared/src/dungeon2/layout.ts` (`ZELLE_M`, `EBENE_M`, `MIN_LICHTE_STUFEN`) |
| `shared/src/eigeneDungeons.ts` (`DG_Steingrab`, `DG_StoneVault`) | **BLEIBT** — Grundlage des Connector-Modul-Kits (`DG_StoneVault`), Entscheidung 03.09.2026, s. Vault-Notiz „Workflow — Connector-Modul-Kit" | die Datei ist der Ort, an dem eigene Kits stehen; `DG_StoneVault` wird hier auf 1.0 gebaut |
| `shared/src/dungeons.ts` — `RoomDef`, `RoomConnectionDef`, `PlacedRoom`, `PlacedDoor`, `PlacedProp`, `DungeonLayout`, `DungeonPropDef`, `sanitizeDungeonDocument`, `MAX_DUNGEON_*`, `DUNGEON_DOCUMENT_VERSION` | **BLEIBT** — Grundlage des Connector-Modul-Kits (`DG_StoneVault`), Entscheidung 03.09.2026, s. Vault-Notiz „Workflow — Connector-Modul-Kit" | das Dokumentformat, in dem ein handgebautes Kit-Layout gespeichert wird. Ohnehin schon in Benutzung durch `campGenerator.ts` (Oberwelt) für `RoomDef`/`RoomConnectionDef` |
| `shared/src/roomPieces.ts`, `roomPiecesData.json` (4,9 MB, ausserhalb dieser Markierung unangetastet, da JSON keine Kommentare kennt) | **LEGACY für Dungeons** | wird nur noch von Camps gelesen; nach dem Umbau prüfen, ob Camps wirklich alle 289 Räume brauchen |
| `shared/test/dungeon-generator.ts`, `shared/test/dungeon-raster.ts` | **LEGACY** | ersetzt durch `dungeon2-determinismus.ts`, `-invarianten.ts`, `-builder.ts`, `-paritaet.ts`, `-schichten.ts` (alle bereits vorhanden und grün) |
| `server/src/world/dungeon/DungeonManager.ts` — `materialize()`, `dekoAngleichen()`, die Herleitung in `getSpawnPoint()`, `documents`/`getDocument`/`upsertDocument`/`createGenerated` | **ersetzt, Gegenstück steht** (AP13, 31.08.2026) | Daneben stehen `materialisiere2()` (`Materialisierung2.ts`), `ankerAngleichen()`, der ausdrückliche `BauErgebnis.spawnPunkt` und die zweite Dokumentenkarte `dokumente2`. Beide Wege leben nebeneinander, bis kein Altdokument mehr auf einer Platte liegt; die Weiche ist `dungeon2.istDokument2()` (nur `version >= 10`). Rest der Klasse unverändert |
| `client/src/ui/DungeonEditor.ts` (F4) | **BLEIBT** — Grundlage des Connector-Modul-Kits (`DG_StoneVault`), Entscheidung 03.09.2026, s. Vault-Notiz „Workflow — Connector-Modul-Kit" | das Werkzeug, mit dem ein Kit von Hand zusammengesetzt wird (seit 03.09. mit Feld „Ausrichtung") |
| `client/src/ui/DekoPlatzierung.ts` | **LEGACY** | setzt `PlacedProp` mit `roomIndex` |
| `client/src/editor/DungeonGrundriss.ts`, `DungeonKatalog.ts`, `DungeonDokument.ts`, `DungeonSpeichern.ts` | **BLEIBT** — Grundlage des Connector-Modul-Kits (`DG_StoneVault`), Entscheidung 03.09.2026, s. Vault-Notiz „Workflow — Connector-Modul-Kit" | Raumbibliothek, Connector-Grundriss und der Speicherweg des F4-Editors; `client/src/editor/dungeon2/` tritt daneben, nicht an ihre Stelle |
| `client/src/engine/Physics.ts` — Mesh-Collider-Zweig für Dungeon-Räume (`kind: 'mesh'`, `ColliderSpec.mesh`, `buildMeshCollider()`, beide Aufrufstellen) | **LEGACY-Zweig** | Kollision kommt aus `BauErgebnis.kollision`, nicht aus dem Mesh |
| `tools/steingrab-erzeugen.py`, `tools/dungeon-zusammensetzen.py` | **LEGACY** | erzeugen Architektur-GLBs |
| `assets/models/Steingrab*.glb` (außerhalb des Repos, nicht per Kommentar markierbar) | **LEGACY** | Mike sichert `assets/` selbst — **nicht löschen**, nur aus `EIGENE_MODELLE` nehmen |
| `shared/src/prefabs.ts` — Steingrab-Einträge in `EIGENE_MODELLE` (`SteingrabGang` … `CryptWallTorch`) | **LEGACY-Einträge** | müssen mit dem Kit fallen, sonst zeigt die Registry auf Modelle ohne Verwender |

## Entscheidung 03.09.2026 — der Connector-Weg wird nicht abgerissen

Ursprünglich war der gesamte Connector-Weg (Kit → `attachRoom` → F4-Editor
→ `DungeonDocument`) als Abriss geführt: Dungeon Generator 2.0 erzeugt
seine Architektur zur Laufzeit aus Zellen und braucht weder RoomDefs noch
Connectors. Mike hat entschieden, **beides nebeneinander laufen zu
lassen**: `DG_StoneVault` wird als **Connector-Modul-Kit** auf 1.0
gebaut — ein von Hand zusammengesetztes Baukastensystem, dessen Reiz
gerade darin liegt, dass ein Mensch Stück für Stück setzt, statt einen
Seed zu würfeln. Der Weg dorthin steht in der Vault-Notiz
„Workflow — Connector-Modul-Kit".

Die betroffenen Zeilen oben tragen deshalb **BLEIBT** statt LEGACY.
Was das *nicht* heisst: Dungeon Generator 2.0 (`shared/src/dungeon2/`)
wird dadurch nicht in Frage gestellt — `stempelSetzen`/`stempelEntfernen`
ersetzen `attachRoom`/`removeRoom` nicht mehr, sie stehen daneben, und
die beiden Betriebsarten trennt weiterhin `dungeon2.istDokument2()`
(`version >= 10`).

**Nachgezogen (M5b):** die beiden Zeilen
`shared/src/dungeonGenerator.ts (ohne Camps)` und `generateDungeonLayout`
/ `DungeonGeneratorSettings` / `DEFAULT_GENERATOR_SETTINGS` tragen jetzt
ebenfalls **BLEIBT**. Das Kit benutzt den Saat-Generator tatsächlich
(`server/test/m3-stonevault-seeds.ts` prüft 40 Seeds von `DG_StoneVault`),
und der Eingangsmodus `regen` (`dungeon entrance-mode … regen`) würfelt bei
jedem Betreten genau über diesen Weg neu — der Saat-Vertrag „Basis + Seed →
derselbe Grundriss" ist damit keine Altlast, sondern eine Zusage im Betrieb.

## Namensabweichung zur ARCHITECTURE.md-Tabelle

`ARCHITECTURE.md` §1.2/§5 nennt für die Editor-Dateien englische Zielnamen
(`DungeonFloorplan.ts`, `DungeonCatalog.ts`, `DungeonDocument.ts`). Diese
Umbenennung ist im Repo noch nicht erfolgt — die tatsächlichen, hier
markierten Dateien heißen weiterhin `DungeonGrundriss.ts`,
`DungeonKatalog.ts`, `DungeonDokument.ts`. Ebenso ist `DecorPlacement.ts`
im Repo `client/src/ui/DekoPlatzierung.ts`. Wer umbenennt, muss diese
Tabelle mit anpassen.

## Nicht LEGACY, obwohl es danach aussieht

Die Eingangshüllen (`ENTRANCE_HULL_MODELS`, `spawnEntranceHull`) sind
Oberweltmodelle und haben mit dem Dungeoninneren nichts zu tun. Tripo
bleibt für Deko und Unikate (Altäre, Statuen, Türen, Truhen) — nur Flächen
sind Vergangenheit. `RoomTheme`, `DungeonAlgorithm`, `getDungeonByHash`,
`isValidDungeonId`, `interiorEnvironment` und der übrige Katalogteil von
`shared/src/dungeons.ts` bleiben ebenfalls unverändert (siehe LEGACY-Block
oben).

## Offener Schritt aus AP0, nicht Teil dieser Markierung

Die Trennung von `shared/src/dungeonGenerator.ts` in Dungeon-Teil (bleibt
in der Datei, wird LEGACY) und Camp-Teil (wandert nach
`shared/src/campGenerator.ts`) ist **nicht** Teil dieses
Markierungs-Durchgangs — reine Kommentare/Doku ändern nichts Funktionales,
eine Dateiteilung wäre das aber. Bis zur Teilung stempelt der
Ganzdatei-Kopfkommentar in `dungeonGenerator.ts` bewusst nicht die ganze
Datei, sondern verweist auf die Ausnahme.
