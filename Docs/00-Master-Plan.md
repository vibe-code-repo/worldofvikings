# Valheim Babylon — Master Plan

## Ziel

Den Valheim-Server (`valheim.community`, C++ / Valhalla2.0) als **Browsergame auf Basis von Babylon.js** portieren — mit Original-Assets aus dem Dedicated Server und einem authoritativen TypeScript-Server (1:1-Nachbau der C++-Logik).

Dieses Projekt ist der Nachfolger von [`valheim-browser`](../valheim-browser) (Three.js). Der Three.js-Prototyp hat die Machbarkeit bewiesen, stößt aber an Engine-Grenzen (siehe [01-Warum-Babylon.md](01-Warum-Babylon.md)).

---

## Ausgangslage

| Projekt | Rolle | Stand |
|---|---|---|
| `valheim.community` | C++ Referenz-Server (Valhalla2.0), 126 Quelldateien: ZDO, Prefabs, Weltgen, Dungeons, Netzwerk | Referenz, bleibt unverändert |
| `valheim-browser` | Three.js-Prototyp: Server + Shared + Tools + Assets weitgehend fertig, Client früh (Terrain, Grass, Instancing, WorldMap) | Wird als Code-Spender und Referenz genutzt |
| `valheim-babylon` | **Dieses Projekt** — Babylon.js-Client + wiederverwendeter Server | Neu |

**Zentrale Erkenntnis:** Der Server (`server/`) und die geteilte Weltgenerierung (`shared/`) in `valheim-browser` sind **engine-unabhängiges TypeScript**. Sie werden nahezu 1:1 übernommen. Nur der Client (Rendering) wird mit Babylon.js neu gebaut.

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

## Projektstruktur (Ziel)

```
valheim-babylon/
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

---

## Technische Entscheidungen

| Entscheidung | Wahl | Begründung |
|---|---|---|
| Client-Engine | **Babylon.js 7+/8+** | Clustered Lighting, CSM, Volumetrics, Havok, GUI, Inspector — alles eingebaut |
| Rendering-Backend | WebGPU (Fallback WebGL2) | `WebGPUEngine`, identischer Szenen-Code |
| Server-Sprache | TypeScript (Node.js) | Wie gehabt; 1:1-Mapping der C++-Klassen |
| Netzwerk | WebSocket + Binary (bisheriges Protokoll), **Port 2466** | Client-Unabhängigkeit bewahren; eigener Port, damit valheim-browser (2456) parallel laufen kann |
| Asset-Format | glTF/GLB + KTX2 | Babylon lädt beides nativ (`KhronosTextureBasisU`, Draco) |
| Physik | Havok (WASM) via `@babylonjs/havok` | Offizielles Plugin, performant |
| Persistenz | ~~SQLite~~ **JSON+zstd-Envelope** (`WorldManager.ts`) | Bewusste Abweichung (2026-08): ein Save pro Welt, atomar (tmp+rename), `.prev`-Rotation — SQLite brächte hier nur Abhängigkeiten, keine Vorteile |
| Build | Vite (Client, **Dev-Port 5273**), tsx (Server), npm-Workspaces | Bewährt im Vorgänger; eigener Dev-Port (valheim-browser nutzt 5173) |

## Port-Belegung (eigenständig — Parallelbetrieb mit valheim-browser möglich)

| Dienst | valheim-babylon | valheim-browser (Referenz) |
|---|---|---|
| Game-Server (WebSocket) | **2466** | 2456 |
| Vite Dev-Server | **5273** | 5173 |
| Vite-Proxy `/ws` | → 2466 | → 2456 |
