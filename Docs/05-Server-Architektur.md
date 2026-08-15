# 05 — Server-Architektur (C++ → TypeScript)

Der Server ist der 1:1-Port des C++-Servers aus `valheim.community` (Valhalla2.0). Er wurde in `valheim-browser` weitgehend umgesetzt und wird **unverändert übernommen** — die Engine-Migration berührt ihn nicht.

---

## C++ → TypeScript Mapping

| C++ (`valheim.community/library/src`) | TypeScript (`valheim-babylon/server/src`) | Status in valheim-browser |
|---|---|---|
| `Main.cpp` (core) | `main.ts` | ✅ vorhanden |
| `ValhallaServer.cpp` | `ValhallaServer.ts` | ✅ vorhanden |
| `ZDO.cpp / ZDOManager.cpp` | `zdo/ZDO.ts, ZDOManager.ts` | ✅ vorhanden |
| `ZDOID.cpp` | `zdo/ZDOID.ts` | ✅ vorhanden |
| `Prefab.cpp / PrefabManager.cpp` | `prefab/Prefab.ts, PrefabManager.ts` | ✅ vorhanden |
| `ZoneManager.cpp` | `world/ZoneManager.ts` | ✅ vorhanden |
| `Heightmap*.cpp, GeoManager.cpp, FastNoise.cpp` | `shared/src/worldgen/*` | ✅ **gegen C++ verifiziert** (Analyse: Phase B–D abgeschlossen, Weltkarten-Diff vorhanden) |
| `WorldManager.cpp` | `world/WorldManager.ts` | ✅ vorhanden |
| `NetManager.cpp / Peer.cpp / NetSocket*.cpp` | `net/NetManager.ts, Peer.ts, WebSocketAcceptor.ts` | ✅ WebSocket statt Steam Sockets |
| `Rpc.h` | `net/Rpc.ts` | ✅ vorhanden |
| `Reader/Writer/Stream.cpp` | `io/Reader.ts, Writer.ts, Stream.ts` | ✅ vorhanden |
| Spawn-Logik | `world/SpawnSystem.ts` | ✅ vorhanden |
| — (eigen) | `world/RoutenLaeufer.ts` | ✅ NPCs laufen die Wegpunkte des WorldLayouts ab (Docs/10) |
| `Vector/Quaternion/Types/BitPack` | `util/*` | ✅ vorhanden |
| `DungeonGenerator/DungeonManager.cpp` | — | ⬜ offen (Phase 6) |
| `RandomEventManager.cpp` | — | ⬜ offen (Phase 6) |
| `RouteManager.cpp` | — | ⬜ offen (Phase 6, Pfadsuche) |
| `IWCManager.cpp` (Inter-World-Chat?) | — | ⬜ optional |
| `HousingRegistry.cpp / APIHousing.cpp` | — | ⬜ später (Community-Feature) |
| `DiscordManager.cpp, RestApiManager.cpp` | — | ⬜ optional (Admin/Integration) |
| `ModManager.cpp` (Lua) | — | ⬜ bewusst später — Lua-Modding API |

> Hinweis: Die Tabelle ist der Auszug aus dem Mapping in valheim-browser/PLAN.md plus Datei-Abgleich mit `valheim.community/library/src`. Beim Import (Phase 0) wird jede Datei verifiziert und der Status hier final eingetragen.

---

## Datenfluss ZDO-Sync (unverändert)

```
Server (autoritativ)
  ZDOManager ──Delta (50 ms)──▶ NetManager ──WS/Binary──▶ Client
      ▲                                                      │
      └──────────── Input (20 Hz) / RPC ◀────────────────────┘
```

- Sektor-basierte ZDO-Speicherung (`objectsBySector`), Delta-Sync an Peers nach Sichtradius
- Flags: Persistent, Distant, Type1, Type2; Member: float, Vector3, Quaternion, int32, int64, string, bytes
- Persistenz: World-Meta + ZDO-Snapshot (SQLite/zstd), Save-Interval konfigurierbar

## Offene Server-Themen für die Babylon-Phase

1. **Spawn-Daten komplettieren**: Scale/Rotation (Vegetation min/max-Scale) in die Spawn-Pakete — Voraussetzung für korrekte Proportionen im neuen Client (P0, siehe [02](02-Migration-von-valheim-browser.md)).
2. **Vegetationssystem serverseitig** (Analyse Phase E): vollständige PopulateFoliage-Portierung prüfen/vervollständigen.
3. **Locations** (Analyse Phase F): features.pkg-Platzierung (146 Locations) — kommt vor Dungeons.
4. **Tests**: `server/test`, `shared/test` müssen nach dem Import grün bleiben; Weltgen-Diff-Tool (Weltkarten-Vergleich TS vs. C++, liegt in valheim-browser/Docs) weiter nutzbar halten.
