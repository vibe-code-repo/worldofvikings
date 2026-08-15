# Weltbau: Layout-Welt, Editor und MCP

Stand: 04.08.2026. Beschreibt den Kartengenerierungs-Umbau (Phasen 0–5b):
die designer-definierte, wachsende Welt, ihre Werkzeuge und den Weg vom
Entwurf in die Live-Umgebung.

## Idee

Statt des radialen Valheim-Seeds (10-km-Kreis, Biom-Ringe) beschreibt ein
**WorldLayout-Dokument** die Welt: Regionen (Polygone/Kreise) mit Biom und
Terrainparametern auf einer unbegrenzten Karte. **Alles außerhalb von
Regionen ist offener Ozean.** Das Perlin-Detail INNERHALB einer Region
(Hügel, Wald, Küstenrauschen) liefern unverändert die Valheim-
Biomhöhenfunktionen — nur die radiale Basis ist ersetzt.

## Datenfluss

```
server/data/worldlayout.json           (Autorformat, JSON, klein)
  └─ sanitizeWorldLayout()             shared/src/worldlayout/sanitize.ts
      └─ RegionField (Distanzfeld)     shared/src/worldlayout/compile.ts
          └─ RegionGeo                 shared/src/worldgen/RegionGeo.ts
              ├─ Server: ZoneManager/SpawnSystem (Kuratierung je Region)
              ├─ Client: Terrain/Karte/Minimap (Paket 64 WorldLayoutData)
              └─ mapWorker (eigene Instanz, Maße im Request)
```

- `createGeo({mode})` (shared/src/worldgen/factory.ts) ist die Modus-Weiche:
  `valheim` (radialer Übergangspfad) oder `layout`.
- Im Layout-Modus ist der **detailSeed DES DOKUMENTS** maßgeblich — auf
  Server, Client und MCP-Probe identisch.
- Der Server kündigt das Layout per ServerConfig-Flag (Bit 5) an und sendet
  `WorldLayoutData` (64); der Client baut seine Welt erst danach.
- Save-Schutz: Der Layout-Hash steht in der Save-Meta; Drift wird beim Laden
  gewarnt. Inkompatible Saves werden als `.orphan-<ts>` beiseitegelegt.
- Placement-Cache: `worlds/<name>.locations.json` (Schlüssel: Seed,
  genVersion, Layout-Hash, Feature-Anzahl) — Boot ~6 s statt Minuten;
  Layout-Änderung würfelt automatisch neu.

## Schema (Kurzfassung)

```jsonc
{
  "version": 1,
  "name": "World of Vikings",
  "detailSeed": "wov-alpha",          // Seed NUR fürs Perlin-Detail
  "continents": [{ "id": "vikingr", "name": "Vikingr", "faction": "viking" }],
  "regions": [{                        // Reihenfolge = Z-Ordnung (später überdeckt)
    "id": "vikingr-land",
    "biome": "grassland",             // grassland|blackforest|swamp|mountain|plains|mistlands|ashlands|deepnorth
                                       // ("meadows" wird beim Laden auf "grassland" migriert)
    "shape": { "kind": "polygon", "points": [[x, z], …] },  // oder circle{x,z,radius}
    "edgeFalloff": 450,               // Küsten-Falloff in m
    "baseLevel": 0.3,                 // Basis-Plateau (0.15 ⇔ Wasserlinie; ×200 = m)
    "heightScale": 1,                 // Amplitude des Perlin-Details
    "forestDensity": 1,               // 0 kahl … 2 dicht
    "vegetation": ["Beech1"],        // KURATIERUNG: exklusive Listen je Region
                                       //   Feld fehlt  → Biom-Standardtabelle
                                       //   Liste voll  → exakt diese Arten
                                       //   Liste LEER  → gar kein Bewuchs (Gras bleibt)
    "locations": [], "spawns": []     // (fehlt ein Feld → Biom-Standardtabellen)
  }],
  "placements": [{                     // Editor-Spawn: handplatzierte Objekte
    "prefab": "Beech1", "x": 20, "z": 12, "yaw": 0.5, "scale": 1.2,
    "einebnen": 7,                     // optional: Sockel-Radius (m) — Terrain
    "route": "wache-hafen",            // wird dort auf Mittelpunkthöhe geebnet
    "npc": {                           // optional: NPC läuft diese Route
      "name": "Sigrun",                // nur die ABWEICHUNGEN von der
      "rolle": "quest",                // Prefab-Vorgabe (s. „NPC-Einordnung")
      "fraktion": "wikinger",
      "stufe": 12,
      "quest": "verfuegbar"
    }
  }],
  "rivers": [{ "id": "fluss-1", "points": [[x, z], …], "width": 50, "depth": 8 }],
  "lakes":  [{ "id": "see-1", "x": 0, "z": 0, "radius": 420, "depth": 12 }],
  "routes": [{                         // NPC-Routen (s. unten)
    "id": "wache-hafen",
    "points": [[x, z], [x, z, 5], …],  // [x,z] läuft durch, [x,z,pause] wartet
    "mode": "loop",                    // loop = im Kreis | pingpong = hin und zurück
    "speed": 1.5                       // m/s (Default 1.5)
  }],
  "defaultSpawn": [0, 0]              // neutraler Welt-Start; je Fraktion
}                                      // zusätzlich continent.spawn
```

Grenzen (sanitize): Bbox ±40 km (Dungeon-Band + float32), ≤512 Regionen,
≤512 Polygonpunkte, ≤2000 Placements, ≤256 Routen zu je ≤512 Wegpunkten,
`speed` geklemmt 0,2–10 m/s, Wegpunkt-`pause` geklemmt 0–600 s
(Unsinn → 0), unbekannter `mode` → `loop`, `npc.stufe` geklemmt 1–99,
`npc.name` auf 32 Zeichen gekürzt (leer → Feld weg), unbekannte
`rolle`/`fraktion`/`quest` werden WEGGELASSEN statt auf einen Standard
gezwungen — dann greift die Prefab-Vorgabe. Höhen der
Placements werden NIE gespeichert — sie folgen beim Spawnen dem Boden.

## Editor (client/editor.html)

Moderne Shell (`client/src/editor/Shell.ts`): Werkzeugleiste, einklappbare
Seitenleisten-Sektionen, Viewport, Statusleiste (Meldung ≠ Koordinaten) und
die **Server-Konsole** als Dock (Griff ziehbar; ▁/◫/⬒ = minimiert/Standard/
volle Höhe; speist sich aus `journalctl -fu wov-server` via Vite-SSE
`/api/serverlog`).

- **Formen-Menü:** Kreis, Oval, Langinsel, Halbmond, Zackenküste, Plateau —
  `FORMEN`-Registry in editorMain.ts, ein Eintrag = neue Form.
- **Polygon:** Punkte klicken; schließen per Startpunkt-Klick, ✓-Knopf oder
  Doppelklick; Esc bricht ab.
- **Regionen verformen:** Griffe der gewählten Region — Mittelpunkt
  verschiebt, Radius-Handle skaliert den Kreis, Polygonpunkte einzeln
  ziehen, Alt+Klick entfernt einen Punkt.
- **≈ Fluss zeichnen:** Verlauf klicken, Breite/Tiefe einstellen,
  Abschluss per ✓-Knopf oder Doppelklick. Seen und Flüsse stehen in der
  Gewässerliste und sind dort einzeln löschbar.
- **Undo/Redo:** Strg+Z / Strg+Y (50 Schritte).
- **Vorschau:** derselbe mapWorker wie im Spiel (RegionGeo) — keine Drift.
- **Testflug:** öffnet `/?offline=1&layout=editor` (Entwurf via localStorage
  `wov-editor-layout`) — echtes Terrain, begehbar.
- **Spawn-Editor im Testflug (Taste B):** durchsuchbare Prefab-Liste
  (Vegetation/Bauteile/alle), Drehung/Abstand/Größe, Geist-Vorschau an der
  Maus, Klick setzt, Ziehen verschiebt (Leuchtring), Entf löscht,
  Rechtsklick bricht ab bzw. gibt die Maus frei. „Untergrund einebnen"
  (rein manueller Haken, startet immer AUS) schreibt `einebnen` an die
  Platzierung (Radius = halbe Diagonale der Grundfläche + 1 m, damit auch
  Vorbauten und gedrehte Ecken auf der Platte stehen): RegionGeo zieht das
  Gelände im Radius auf die Mittelpunkthöhe, mit Böschung nach außen, und
  auf der ganzen Platte wächst kein Klutter-Gras. Das passiert LIVE —
  Setzen, Verschieben und Löschen planieren sofort (Sockel wird in die
  laufende Geo nachgerückt, betroffene Kacheln + Gras neu gebaut) und das
  Bauwerk snappt auf die Plattenhöhe; Neuladen/Server rechnen dieselbe
  Höhe.
  Bei einer gewählten FIGUR (Völva, Surtr, NPC_1) erscheint zusätzlich
  der Block „👤 Figur" mit Name, Rolle, Fraktion, Stufe und — nur bei
  Rolle `quest` — dem Quest-Zustand; siehe „NPC-Einordnung".
- **Routen-Editor im Testflug (Taste R):** NPC-Wegpunkte ins Gelände
  klicken statt Koordinaten zu tippen; die NPCs laufen die Route sofort
  als Vorschau ab — Bedienung siehe „NPC-Routen".
- **Publish:** JSON-Export → `server/data/worldlayout.json` + Neustart —
  oder per MCP (unten). Editor und MCP teilen dieselbe Datei; der Editor-
  Entwurf lebt bis zum Export nur im localStorage (bekannte Lücke, siehe
  Docs/09 Punkt 13).

## MCP-Server (tools/worldlayout-mcp)

In `.mcp.json` eingebunden; KI-gestützter Weltbau im Gespräch:
`layout_get`, `region_set`, `region_delete` (sanitize-gesichert),
`layout_probe` (Höhe/Biom/Region wie der Spielserver) und `layout_deploy`
(systemd-Neustart; dank Placement-Cache ~6 s). Vor jedem Schreiben entsteht
ein zeitgestempeltes Backup (`worldlayout.json.<ts>.bak`, letzte 10).

## Betrieb

- Modus: `server/data/server.yml` → `world.mode: layout`,
  `world.layout: worldlayout.json`, Save-Name `world.world` (aktuell
  `vikings`; der alte Radial-Save `world` liegt unangetastet daneben).
- Dienste: `systemctl start|stop wov.target` bzw. `npm run service:*`.
- Tests: `shared/test/worldlayout.ts`, `shared/test/region-geo.ts`,
  `server/test/h1-layout.ts`, `server/test/h2-routen.ts` — Teil von
  `npm test` (Runner, Docs/09 P26).

## NPC-Routen

> **Im Testflug laufen die NPCs sofort** — als Vorschau, siehe unten.
> **In der echten Welt** laufen sie erst, wenn der Entwurf in der
> Weltdatei steht und der Server neu gestartet ist: Gelaufen wird dort auf
> dem SERVER. Der Knopf „💾 In die Welt speichern" liegt sowohl im
> Karten-Editor als auch im Routen-Panel des Testflugs (Taste R); beide
> schreiben über `POST /api/worldlayout` dieselbe Datei.


Eine Route ist eine benannte Folge von Wegpunkten; eine Platzierung
verweist per `route` darauf und läuft sie dann ab. Sie steht bewusst IM
Layout-Dokument: Wegpunkte sind Weltdesign wie Flüsse und Platzierungen
und nehmen so Sanitisierung, Editor/MCP und Deploy mit.

- **Bewegt wird auf dem SERVER** (`server/src/world/RoutenLaeufer.ts`) —
  er ist autoritativ, der Client bekommt nur das Ergebnis über den
  normalen ZDO-Sync. Die Wegpunkte selbst gehen nie an den Client.
- **Die Wegmathematik steht in `shared`**
  (`shared/src/worldlayout/routenlauf.ts`, Klasse `RoutenLauf`): reine
  xz-Rechnung ohne ZDO, Welt oder Babylon — Fortschritt entlang der
  Punkte, Verteilen der Schrittweite über mehrere Wegpunkte, Umkehr,
  Rundlauf, Einstieg am nächstgelegenen Punkt, Blickrichtung. Server
  (`RoutenLaeufer`) und Testflug-Vorschau (`RoutenVorschau`) benutzen
  denselben Code; `server/test/h3-routen-vorschau.ts` vergleicht beide
  Frame für Frame. Eine Vorschau, die anders rechnet als der Server, wäre
  schlimmer als keine.
- **Höhe immer aus `getGroundHeight`**: Der NPC folgt dem Gelände, auch
  wenn sich das Layout später ändert. Deshalb steht in der Route (wie in
  den Platzierungen) kein Y.
- **`loop`** schließt vom letzten zum ersten Punkt, **`pingpong`** kehrt an
  den Enden um. Eine Route mit nur EINEM Wegpunkt ist der Standposten:
  Der NPC läuft hin und bleibt dort (`pruefeLayout` weist darauf hin).
- **Pause je Wegpunkt**: `[x, z]` läuft durch, `[x, z, pause]` hält dort
  `pause` Sekunden an (0–600, `ROUTE_MAX_PAUSE`). Die Zeit hängt am PUNKT
  statt in einem parallelen Feld — jede Editor-Operation verschiebt
  Wegpunkte, und ein zweites Array müsste bei jeder mitgezogen werden;
  genau dort entstehen Versätze. Alte Dokumente bleiben wörtlich gültig
  (kein drittes Element = keine Pause), und der Sanitizer schreibt einen
  Punkt ohne Pause auch wieder ohne drittes Element (stabiler
  Round-Trip); Unsinn und negative Werte werden zu 0, zu große geklemmt.
  Während der Pause läuft `idle`, und die **Blickrichtung friert ein** —
  ein NPC, der sich beim Warten schon zum nächsten Punkt dreht, wirkt
  nervös. Bei `pingpong` wartet der Umkehrpunkt genau EINMAL, obwohl Hin-
  und Rückweg ihn berühren: Das Weiterschalten auf den nächsten Wegpunkt
  hängt am ENDE der Pause, nicht an der Ankunft — der Punkt kann also gar
  nicht ein zweites Mal auslösen. Ein Tick darf beliebig lang sein: Er
  arbeitet Pausen und Wegstücke der Reihe nach ab (Zeitbudget statt
  Schrittweite), verschluckt also keine Pause und verdoppelt keine.
- **Simuliert wird nur mit Spieler in der Nähe** (`SPAWN_SIM_RADIUS`),
  die ZDO-Revision steigt gedrosselt mit 4 Hz — beides wie bei den
  Kreaturen. Ein Routen-NPC wird dabei aus der Kreatur-Simulation
  entlassen, sonst zöge die Wander-KI an derselben Position.
- **Wiedererkennung über die Kennung**: Platzierungen werden beim Boot
  über den ZDO-Member `layoutId` wiedergefunden, nicht mehr nur über die
  Nähe zum Eintrag — ein Routen-NPC steht beim nächsten Start ja irgendwo
  auf seiner Runde.
- **Animation**: Der Server schreibt den Bewegungszustand in den
  ZDO-Member `anim` (`idle`/`walk`, nur bei Wechsel). Der Client startet
  die gleichnamige AnimationGroup der Instanz
  (`AssetManager.wechsleAnimation`, Teiltreffer ohne Groß-/Kleinschreibung
  — `walk` trifft damit auch `Walking`). Fehlt die Gruppe im Modell,
  stoppt nur die laufende Animation; die Bewegung hängt nicht daran.

Ausprobieren ohne animiertes Modell: eine Platzierung `NPC_1` (Gruppe
`Walking`) auf eine Route setzen — sie läuft und wechselt beim Halt auf
`idle`, wo mangels Gruppe schlicht nichts mehr abgespielt wird.

### Routen zeichnen (Testflug, Taste R)

`client/src/editor/RoutenEditor.ts` — Wegpunkte werden ins Gelände
geklickt, nicht ins JSON getippt. Geschrieben wird in denselben
localStorage-Entwurf wie die Platzierungen (`wov-editor-layout`), Feld
`routes`, in genau dem Schema, das `sanitizeWorldLayout` durchlässt.

1. **V** (Baumodus) einschalten und hochsteigen — von oben zeichnet es
   sich am besten; die Kamera darf im Testflug bis 120 m heraus.
2. **R** öffnet das Panel (links; das Spawn-Panel liegt rechts, beide
   dürfen gleichzeitig offen sein). Die Maus wird dabei freigegeben.
3. **+ Neue Route** legt eine Route mit Vorgabe-Kennung `route-1`,
   `route-2` … an (ID-Muster der Sanitisierung) und schaltet das Setzen
   sofort scharf.
4. **Klick aufs Gelände** hängt einen Wegpunkt an — in Klickreihenfolge.
   Jeder Punkt bekommt einen Pfosten (erster Punkt grün), dazwischen
   läuft eine Linie, die alle 4 m auf die Geländehöhe gelegt wird; bei
   `loop` auch vom letzten zum ersten Punkt. Nicht gewählte Routen
   stehen blau daneben.
5. **Kennung/Modus/Tempo** im Panel einstellen. Umbenennen zieht die
   Zuweisungen der Platzierungen mit; eine ungültige oder doppelte
   Kennung wird abgelehnt statt stillschweigend zurechtgebogen.
6. **✎** schaltet das Setzen an/aus, **↩** nimmt den letzten Wegpunkt
   zurück, **🗑** löscht die Route (samt der Verweise darauf).
   Einen Wegpunkt der GEWÄHLTEN Route kann man anklicken und ziehen.
7. **Pausen:** Die Wegpunktliste im Panel zeigt jeden Punkt als
   „3 · 12/−4 · 5 s" — die Wartezeiten sind also ablesbar, ohne jeden
   Punkt einzeln anzuklicken. Ein Klick auf die Zeile (oder das Anfassen
   des Punkts in der Welt) wählt ihn; darunter trägt „Pause am gewählten
   Punkt (s)" die Wartezeit ein, 0 nimmt sie wieder weg. Haltepunkte
   stehen in der Welt als **dicke rote Pfosten** statt als schlanke gelbe,
   sind also schon aus der Übersicht zu erkennen. Verschieben behält die
   Pause.
8. **Zuweisen:** die Platzierung in der Welt anklicken (sie wird
   gegriffen, Leuchtring), dann im Routen-Panel **→ zuweisen**; **×
   lösen** nimmt die Zuweisung wieder weg. Ein NPC ohne Route steht.

### Vorschau: die Route im Testflug ablaufen sehen

`client/src/editor/RoutenVorschau.ts` — sobald eine Platzierung eine
Route hat, läuft sie sie **sofort im Testflug** ab, ohne Speichern und
ohne Serverneustart. Nur dort (`?offline=1&layout=editor`); online bewegt
ausschließlich der Server, im normalen Offline-Spiel gibt es keinen
Entwurf.

- **Gleiche Rechnung wie der Server** (`RoutenLauf` aus `shared`), Höhe je
  Schritt aus `getGroundHeight`, Blickrichtung aus der Bewegung, Gangart
  `idle`/`walk` über `AssetManager.wechsleAnimation` — also genau das
  Bild, das die gespeicherte Welt später zeigt.
- **Live**: Wegpunkt gesetzt oder gezogen, Route zugewiesen/gelöst, Tempo
  oder Modus geändert — die Vorschau übernimmt es innerhalb von 0,2 s
  (sie klopft den localStorage-Entwurf ab). Wird eine Route **gelöst**,
  bleibt der NPC stehen, wo er ist (`idle`).
- **Beim Verschieben eines Wegpunkts** behält der NPC sein Ziel und zieht
  zur neuen Stelle; kommt ein Wegpunkt dazu oder fällt einer weg, steigt
  er am nächstgelegenen Punkt neu ein.
- **Griff schlägt Vorschau**: Eine mit der Maus gegriffene Platzierung
  hält an und folgt dem Zeiger — man soll nicht an etwas ziehen, das sich
  unter der Hand fortbewegt. Beim Loslassen läuft sie an der neuen Stelle
  weiter.
- **▶ Vorschau: AN/AUS** im Routen-Panel (Vorgabe AN). Beim Ausschalten
  kehren alle NPCs auf ihren gespeicherten Platz zurück — dort greift der
  Editor sie an, und dort stehen sie in der Weltdatei.

Abgrenzung zum Spawn-Editor: Zeichnen und Prefab-Platzieren schließen
einander aus — wer ✎ drückt, beendet den Platzier-Modus (der Geist
verschwindet), und ein Klick in der Prefab-Liste beendet das Zeichnen.
**Esc** beendet das Zeichnen, **Rechtsklick** verwirft wie gewohnt
alles. Die Marker/Linien sind nur bei offenem Panel sichtbar.

## NPC-Einordnung: Fraktion, Rolle, Quest-Zustand

Datenmodell: `shared/src/npc.ts` — `Fraktion`, `NpcRolle`,
`QuestZustand`, `NpcDef` (was an der Platzierung steht),
`NpcEinordnung` (vollständig aufgelöst), `haltungZwischen()`,
`questZeichen()`.

- **Ob ein NPC angreift, steht nicht am NPC**, sondern ergibt sich aus dem
  Verhältnis der Fraktionen (`haltungZwischen`). Ein Feld „feindlich"
  am Exemplar müsste bei jeder Weltänderung überall nachgepflegt werden,
  und Sachse↔Wikinger ist nicht dasselbe wie Sachse↔Wolf.
- **Vorgaben je Prefab** stehen in `NPC_VORGABEN` (ebenfalls `npc.ts`):
  Surtr = `monster`/`muspel`, Völva = `quest`/`wikinger`, NPC_1 =
  `zivil`/`wikinger`. Bewusst NICHT in `prefabs.ts` — dort stehen
  Render-Hinweise (Sprite, GLB, Licht), und `npc.ts` bleibt so
  abhängigkeitsfrei (Sanitizer, Editor und Schild ziehen nicht die
  3.700-Einträge-Registry mit). Ein Eintrag hier ist zugleich die
  Antwort auf „ist das eine Figur?" (`istNpcPrefab`) — neue Modelle
  gehören dort ergänzt, sonst zeigt der Editor ihre Felder nicht.
- **Aufgelöst wird an genau einer Stelle**: `loeseNpcAuf(prefab, npc)` —
  Platzierung schlägt Vorgabe, Ungesetztes erbt, alles andere fällt auf
  „ziviler Neutraler, Stufe 1, keine Quest". Niemand sonst darf
  `?? 'zivil'` schreiben.
- **Im Dokument stehen nur die Abweichungen.** Ein Eintrag ohne `npc`
  behält keinen — der Round-Trip ist stabil und
  `server/data/worldlayout.json` (158 Platzierungen) geht bytegleich
  durch den Sanitizer (Test in `shared/test/worldlayout.ts`).

**Zum Client — ohne ein einziges zusätzliches Byte pro Tick:**

- *Online*: Der Server setzt beim Spawnen ohnehin den ZDO-Member
  `layoutId` (`LAYOUT_ID_MEMBER`, Wert `layoutKennung(p)` =
  `Prefab@x,z`); er wandert mit einem laufenden NPC mit. Der Client hat
  das Weltdokument ohnehin (Paket `WorldLayoutData`) und baut daraus die
  Tabelle Kennung → `NpcEinordnung` (`main.ts`, `buildWorld`) — der
  `EntityManager` verknüpft beides beim ZDO-Update
  (`setzeNpcQuelle`/`npcEinordnung`). Name, Rolle und Stufe ändern sich
  nie; sie in jeden Positions-Tick zu legen wäre der naheliegende, aber
  teure Weg.
- *Editor-Testflug* (`?offline=1&layout=editor`): Dort gibt es weder
  Server noch Kennung — `zeige()` löst die Einordnung direkt aus dem
  Entwurf auf und hängt sie ans Update. Damit sieht der Zeichner jede
  Änderung sofort am Schild. Der Vorschau-Geist an der Maus bekommt
  bewusst keines.

**Bedienung (Spawn-Panel, Taste B):** Der Block „👤 Figur" erscheint nur
für die GEWÄHLTE Platzierung und nur, wenn ihr Prefab eine Vorgabe hat —
für Bäume und Steine bleibt das Panel wie es war. Wählen = anklicken (der
Griff, mit dem man auch verschiebt und löscht); eine frisch gesetzte
Figur ist sofort gewählt. Felder: Name (leer = Vorgabe, als Platzhalter
sichtbar), Rolle, Fraktion, Stufe, und **nur bei Rolle `quest`** der
Quest-Zustand. Gespeichert wird ausschliesslich, was von der Vorgabe
abweicht; wer alles zurückstellt, verliert das `npc`-Feld wieder.

## Fortschritt & Progression

`region.tier` (0–5) ersetzt die Weltzentrums-Distanzen der Radialwelt:
In einer Region entstehen nur Locations bis zu ihrer Stufe
(`tierAusDistanz` übersetzt `feature.minDistance`). Führt eine Region
eigene `locations`, gilt ausschließlich diese Liste.

`pruefeLayout()` meldet unbekannte Vegetations-/Location-/Spawn-Namen und
fehlende Startpunkte — die Befunde stehen im Boot-Log.

## Bewusst offen

Karten-Zoomstufen ab ~40 km, Prefab-Vorschaubilder im Spawn-Panel,
Fraktions-Gameplay (Zugehörigkeit, PvP-Regeln) über die Startpunkte
hinaus. Siehe Docs/09-Verbesserungsvorschlaege.md.
