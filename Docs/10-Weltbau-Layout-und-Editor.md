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
    "biome": "meadows",               // meadows|blackforest|swamp|mountain|plains|mistlands|ashlands|deepnorth
    "shape": { "kind": "polygon", "points": [[x, z], …] },  // oder circle{x,z,radius}
    "edgeFalloff": 450,               // Küsten-Falloff in m
    "baseLevel": 0.3,                 // Basis-Plateau (0.15 ⇔ Wasserlinie; ×200 = m)
    "heightScale": 1,                 // Amplitude des Perlin-Details
    "forestDensity": 1,               // 0 kahl … 2 dicht
    "vegetation": ["Beech1"],        // KURATIERUNG: exklusive Listen je Region
    "locations": [], "spawns": []     // (fehlt ein Feld → Biom-Standardtabellen)
  }],
  "placements": [{                     // Editor-Spawn: handplatzierte Objekte
    "prefab": "Beech1", "x": 20, "z": 12, "yaw": 0.5, "scale": 1.2
  }],
  "rivers": [{ "id": "fluss-1", "points": [[x, z], …], "width": 50, "depth": 8 }],
  "lakes":  [{ "id": "see-1", "x": 0, "z": 0, "radius": 420, "depth": 12 }],
  "defaultSpawn": [0, 0]              // neutraler Welt-Start; je Fraktion
}                                      // zusätzlich continent.spawn
```

Grenzen (sanitize): Bbox ±40 km (Dungeon-Band + float32), ≤512 Regionen,
≤512 Polygonpunkte, ≤2000 Placements. Höhen der Placements werden NIE
gespeichert — sie folgen beim Spawnen dem Boden.

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
  Rechtsklick bricht ab bzw. gibt die Maus frei.
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
  `server/test/h1-layout.ts` — Teil von `npm test` (Runner, Docs/09 P26).

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
