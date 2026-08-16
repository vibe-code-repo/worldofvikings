# World of Vikings — Master Plan

*(Das Projekt hieß beim Verfassen dieses Plans `valheim-babylon`. Der Name steht in älteren
Absätzen weiter da, wo er den damaligen Stand bezeichnet.)*

> **Zwei Annahmen dieses Plans gelten nicht mehr.** Sie stehen unten in den betroffenen
> Abschnitten richtiggestellt; hier zusammengefasst, weil sie das Zielbild verschieben:
>
> 1. **Original-Assets** (überholt am 16.08.2026). Das Projekt benutzt keine aus Valheim
>    extrahierten Modelle und Texturen mehr. Alles ist Eigenbau.
> 2. **Radiale Welt** (überholt am 03.08.2026). Die Welt kommt nicht mehr aus Valheims
>    Seed-Kreis, sondern aus einem WorldLayout-Dokument.
>
> Beides steht im Abschnitt „Was 08/2026 anders kam".
>
> Was unverändert gilt: der authoritative TypeScript-Server als 1:1-Port der C++-Logik, die
> geteilte Weltgenerierung in `shared/`, Babylon.js im Client.

## Ziel

Den Valheim-Server (`valheim.community`, C++ / Valhalla2.0) als **Browsergame auf Basis von Babylon.js** portieren — mit einem authoritativen TypeScript-Server (1:1-Nachbau der C++-Logik).

> Bis 08/2026 stand hier „mit Original-Assets aus dem Dedicated Server". Das war der
> ursprüngliche Weg: Der entpackte Client lieferte Modelle, Texturen und Zahlenwerte frei
> Haus, und ohne ihn wäre der Prototyp nie so weit gekommen. Geändert am 16.08.2026, weil ein
> öffentlich spielbares Spiel keine fremden Assets ausliefern kann. Näheres unten.

Dieses Projekt ist der Nachfolger von [`valheim-browser`](../valheim-browser) (Three.js). Der Three.js-Prototyp hat die Machbarkeit bewiesen, stößt aber an Engine-Grenzen (siehe [01-Warum-Babylon.md](01-Warum-Babylon.md)).

---

## Ausgangslage

| Projekt | Rolle | Stand |
|---|---|---|
| `valheim.community` | C++ Referenz-Server (Valhalla2.0), 126 Quelldateien: ZDO, Prefabs, Weltgen, Dungeons, Netzwerk | Referenz, bleibt unverändert |
| `valheim-browser` | Three.js-Prototyp: Server + Shared + Tools + Assets weitgehend fertig, Client früh (Terrain, Grass, Instancing, WorldMap) | Wird als Code-Spender und Referenz genutzt |
| `valheim-babylon` | **Dieses Projekt** — Babylon.js-Client + wiederverwendeter Server | Neu |

**Zentrale Erkenntnis:** Der Server (`server/`) und die geteilte Weltgenerierung (`shared/`) in `valheim-browser` sind **engine-unabhängiges TypeScript**. Sie werden nahezu 1:1 übernommen. Nur der Client (Rendering) wird mit Babylon.js neu gebaut.

*(Die Erkenntnis hat getragen: Der Import lief am 26.07.2026, Server und Shared kamen unverändert durch. Was danach am Server gewachsen ist — Layout-Welt, Routen, Dungeons —, hat im C++-Vorbild keine Entsprechung; siehe [05](05-Server-Architektur.md).)*

---

## Was 08/2026 anders kam

### Assets: Eigenbau statt Original-Export *(16.08.2026)*

Der Plan ging von den Original-Assets des Dedicated Servers aus: 4,9 GB entpackter Export, aus dem sich Modelle, Texturen und Zahlenwerte bedienen ließen. Am **16.08.2026** ist dieser Bestand von live gelöscht worden — 11.869 Dateien, 5,1 GB. Übrig sind 212 Dateien / 158 MB, alles selbst gebaut (Blender/Python, Werkzeuge in `tools/`).

Der Grund ist nicht technisch: Ein Browserspiel liefert seine Assets an jeden Besucher aus. Was im Prototyp eine Abkürzung war, wäre im Betrieb eine Veröffentlichung fremder Inhalte.

Die Whitelist ist `EIGENE_MODELLE` in `shared/src/prefabs.ts`, der Test heißt `istEigenesModell()`. Gefiltert wird an der Quelle, nicht im Renderer — die Tabellen `FEATURES`, `SPAWN_TABLE`, `FOLIAGE`, die Bauteile des Hammers und die `model`-Felder der Gegenstände laufen alle dagegen. Bewusst die Liste und nicht der Dateibestand unter `assets/`: Der Server kennt die Platte des Clients nicht, und ein Modell, das nur auf einem Container liegt, wäre genau die Drift, die das Betriebsmodell beseitigt hat.

> **Folge, solange die eigenen Modelle fehlen: Im Spiel kann nicht gebaut und nicht gekämpft
> werden.** Von neun Bauteilen haben zwei ein Modell, Kreaturen und Locations keines, und die
> Werkzeuge sind unsichtbar in der Hand. Das ist ein bewusst gewählter Zwischenzustand, kein
> Defekt. Die Welt selbst steht und ist begehbar.

Auch `hdClutter` und die HD-Mod-Texturen sind restlos entfernt — dieselbe Frage, dieselbe Antwort.

### Weltmodell: Layout statt radialem Seed-Kreis *(03.08.2026)*

Der Plan übernahm Valheims Weltmodell mitsamt seiner Form: eine radiale Insel um den Ursprung, alles aus einem Seed, Progression über die Distanz zum Weltzentrum. Das ist portiert, verifiziert und läuft — als `world.mode: valheim`, dem eingefrorenen Übergangspfad.

Die Welt des Projekts entsteht heute aus einem **WorldLayout-Dokument** (`world.mode: layout`): Regionen als Polygone und Kreise mit Biom und Terrainparametern auf unbegrenzter Karte, alles außerhalb ist Ozean; der Server kompiliert das Dokument zu einem Distanzfeld. Das Perlin-Detail *innerhalb* einer Region stammt weiterhin aus den Original-Biomhöhenfunktionen — der Port ist also nicht verworfen, sondern umgehängt. Näheres in [10-Weltbau-Layout-und-Editor.md](10-Weltbau-Layout-und-Editor.md).

Der Grund: Ein MMORPG mit gesetzten Fraktionen, Startpunkten und einer erzählten Geographie lässt sich nicht auswürfeln. Was in der Radialwelt die Distanz zum Zentrum leistete, leistet jetzt `progressionTier` je Region.

Die **Live-Welt** ist am 16.08.2026 neu entstanden (Weltschnitt): 17 Regionen, 159 Platzierungen, alle 17 Regionen kuratiert, 0 unbekannte Prefabs.

---

## Architektur

```
┌──────────────────────────────────────────────────────────────┐
│                    BROWSER CLIENT (NEU)                       │
│  Babylon.js (WebGPUEngine, Fallback WebGL2)                  │
│  - Clustered Lighting (viele dynamische Lichter: Fackeln)    │
│  - Cascaded Shadow Maps (CSM)                                │
│  - Volumetric Light Scattering (God Rays)                    │
│  - Thin Instances (Vegetation, Props)                        │
│  - Havok Physics (WASM)                                      │
│  - Babylon GUI (HUD, Inventar)                               │
│  - Asset-Streaming: glTF/GLB + KTX2 (BasisU)                 │
└────────────────────────┬─────────────────────────────────────┘
                         │ WebSocket (Binary / MessagePack)
┌────────────────────────┴─────────────────────────────────────┐
│              AUTHORITATIVE SERVER (ÜBERNOMMEN)                │
│  Node.js + TypeScript (1:1 Port von Valhalla2.0 C++)         │
│                                                              │
│  ZDOManager │ PrefabManager │ ZoneManager │ Heightmap        │
│  WorldManager (Persistenz) │ NetManager (Peers, RPC)         │
│  DungeonGenerator │ RandomEventManager │ RouteManager        │
└──────────────────────────────────────────────────────────────┘
```

---

## Projektstruktur (Zielbild von 07/2026)

> Der Ist-Aufbau steht in der README. Abweichungen, die man kennen sollte: `admin/`
> (Betriebsdienst) und `deploy/` (systemd, nginx) kamen später dazu; `assets/` ist keine
> Kopie des Valheim-Exports mehr, sondern der eigene Bestand; das Weltdokument liegt unter
> `server/data/welten/<instanz>.json`.

```
worldofvikings/
├── Docs/                      # Diese Dokumentation
├── package.json               # npm-Workspace (client, server, shared)
├── shared/                    # ÜBERNOMMEN aus valheim-browser/shared
│   └── src/
│       ├── worldgen/          # FastNoise, Heightmap, GeoManager, Perlin
│       ├── prefabs.ts / prefabData.json
│       ├── vegetation.ts / vegetationData.json
│       ├── features.ts / featuresData.json
│       ├── spawnData.ts, locationOverrides.json, terrainModifiers.json
│       ├── protocol.ts, types.ts, constants.ts, hash.ts
│       └── index.ts
├── server/                    # ÜBERNOMMEN aus valheim-browser/server
│   └── src/
│       ├── main.ts, ValhallaServer.ts
│       ├── net/               # NetManager, Peer, Rpc, WebSocketAcceptor
│       ├── zdo/               # ZDO, ZDOID, ZDOManager
│       ├── world/             # WorldManager, ZoneManager, SpawnSystem
│       ├── prefab/            # Prefab, PrefabManager
│       ├── io/                # Reader, Writer, Stream
│       └── util/              # Vector3, Quaternion, Hash, BitPack
├── client/                    # NEU: Babylon.js-Client
│   └── src/
│       ├── main.ts
│       ├── engine/
│       │   ├── Engine.ts          # WebGPUEngine + WebGL2-Fallback
│       │   ├── SceneManager.ts    # Scene, Lighting, PostProcesses
│       │   ├── Lighting.ts        # Clustered Lighting, CSM, God Rays
│       │   ├── Terrain.ts         # Chunk-Meshes aus shared/worldgen
│       │   ├── Vegetation.ts      # Thin Instances + Wind (NodeMaterial)
│       │   ├── AssetManager.ts    # glTF/KTX2-Streaming, Cache
│       │   ├── InputManager.ts
│       │   └── Physics.ts         # Havok-Plugin
│       ├── net/
│       │   ├── GameSocket.ts
│       │   └── ClientPrediction.ts
│       ├── entities/
│       │   ├── EntityManager.ts   # ZDO → TransformNode/Mesh
│       │   ├── Player.ts
│       │   └── Interpolation.ts
│       └── ui/
│           ├── HUD.ts             # Babylon GUI
│           ├── WorldMap.ts        # Port aus valheim-browser
│           └── Inventory.ts
├── tools/                     # ÜBERNOMMEN aus valheim-browser/tools
│   ├── assetripper/
│   ├── prefab-parser/
│   └── *.mjs / *.ts           # GLB-Inspektions- & Playwright-Tools
└── assets/                    # Symlink/Kopie von valheim_browser_assets
    ├── models/  (GLB)
    ├── textures/ (KTX2)
    ├── audio/
    ├── sprites/
    └── manifest.json
```

Dazugekommen sind seither:

```
admin/                         # Betriebsdienst (Port 2468): Weltdokument, Server-Konsole, Dienste
deploy/                        # systemd-Units, nginx, Installationsskript
scripts/                       # dev.mjs, run-tests.mjs
server/data/welten/<instanz>.json   # das Weltdokument, in Git
```

---

## Migrationsstrategie

1. **Übernehmen** (Copy + Anpassen): `shared/`, `server/`, `tools/`, Assets — ca. 80 % der bisherigen Arbeit bleibt erhalten.
2. **Neu bauen**: `client/` komplett auf Babylon.js. Die Three.js-Client-Dateien (`Renderer.ts`, `Terrain.ts`, `StaticInstancer.ts`, `GrassClutter.ts`, `AssetManager.ts`, `InputManager.ts`, `WorldMap.ts`) dienen als fachliche Referenz, nicht als Code-Basis.
3. **Protokoll stabil halten**: `shared/protocol.ts` ändert sich nicht — alter und neuer Client können zeitweise parallel gegen denselben Server laufen.

Details: [02-Migration-von-valheim-browser.md](02-Migration-von-valheim-browser.md)

---

## Phasen-Übersicht

| Phase | Inhalt | Dokument |
|---|---|---|
| 0 | Workspace-Setup, Übernahme shared/server/tools, Build läuft | [06-Roadmap.md](06-Roadmap.md) |
| 1 | Babylon-Grundgerüst: Engine, Szene, Kamera, Terrain-Chunks | [03-Rendering-und-Engine.md](03-Rendering-und-Engine.md) |
| 2 | Vegetation & Props (Thin Instances), Asset-Streaming | [04-Asset-Pipeline.md](04-Asset-Pipeline.md) |
| 3 | Beleuchtung: Clustered Lighting, CSM, God Rays, Tag/Nacht | [03-Rendering-und-Engine.md](03-Rendering-und-Engine.md) |
| 4 | Netzwerk-Integration: ZDO-Sync, Entities, Prediction | [05-Server-Architektur.md](05-Server-Architektur.md) |
| 5 | Gameplay: Spieler, Physik, Bauen, Inventar | [06-Roadmap.md](06-Roadmap.md) |
| 6 | Content & Polish: KI, Events, Dungeons, Audio | [06-Roadmap.md](06-Roadmap.md) |

Alle sieben Phasen sind angefangen, 0 und 1 abgeschlossen, die übrigen mit offenen Punkten;
was in jeder entstanden ist, hält [06-Roadmap.md](06-Roadmap.md) fest. Die führende Aufgabenliste wird inzwischen außerhalb
des Repos geführt — die Roadmap ist ihr Vorgänger und bleibt als Historie stehen.

---

## Technische Entscheidungen

| Entscheidung | Wahl | Begründung |
|---|---|---|
| Client-Engine | **Babylon.js 7+/8+** | Clustered Lighting, CSM, Volumetrics, Havok, GUI, Inspector — alles eingebaut |
| Rendering-Backend | WebGPU (Fallback WebGL2) | `WebGPUEngine`, identischer Szenen-Code |
| Server-Sprache | TypeScript (Node.js) | Wie gehabt; 1:1-Mapping der C++-Klassen |
| Netzwerk | WebSocket + Binary (bisheriges Protokoll), **Port 2467** | Client-Unabhängigkeit bewahren; eigener Port, damit die Vorgängerprojekte parallel laufen können (geplant war 2466, s. Port-Tabelle) |
| Asset-Format | glTF/GLB + KTX2 | Babylon lädt beides nativ (`KhronosTextureBasisU`, Draco) |
| Assets | **Eigenbau**, Whitelist `EIGENE_MODELLE` | Abweichung 16.08.2026: ein Browserspiel liefert seine Assets an jeden Besucher aus — siehe oben |
| Weltmodell | **WorldLayout-Dokument** statt radialem Seed-Kreis | Gesetzte Fraktionen, Startpunkte und Geographie lassen sich nicht auswürfeln; der radiale Port bleibt als `world.mode: valheim` eingefroren |
| Physik | Havok (WASM) via `@babylonjs/havok` | Offizielles Plugin, performant |
| Persistenz | ~~SQLite~~ **JSON+zstd-Envelope** (`WorldManager.ts`) | Bewusste Abweichung (2026-08): ein Save pro Welt, atomar (tmp+rename), `.prev`-Rotation — SQLite brächte hier nur Abhängigkeiten, keine Vorteile |
| Build | Vite (Client, **Dev-Port 5274**), tsx (Server), npm-Workspaces | Bewährt im Vorgänger; eigener Dev-Port. Der Server hat **keinen** Build — die Unit startet `node_modules/.bin/tsx` direkt aus dem Quellbaum |
| Umgebung | `WOV_INSTANZ` aus `/etc/wov.env` | Dazugekommen 16.08.2026: eine Codebasis, zwei Container. Keine Quelldatei darf sich zwischen dev und live unterscheiden — siehe [05](05-Server-Architektur.md) |

## Port-Belegung

| Dienst | World of Vikings | geplant (07/2026) |
|---|---|---|
| Game-Server (WebSocket) | **2467** | 2466 |
| Vite Dev-Server (nur dev) | **5274** | 5273 |
| Betriebsdienst `admin/` | **2468** | — (gab es noch nicht) |
| Vite-Proxy `/ws` | → 2467 | → 2466 |

Die geplanten Nummern waren mit Blick auf `valheim-browser` (2456/5173) gewählt, damit beide
Projekte parallel laufen können. Die tatsächlichen liegen um eins höher; **warum**, ist aus
dem Code nicht mehr ablesbar — vermutlich, weil `valheim-babylon` 2466/5273 belegt hielt.
