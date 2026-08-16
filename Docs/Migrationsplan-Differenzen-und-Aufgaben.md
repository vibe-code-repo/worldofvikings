# Migrationsplan: valheim-babylon — Differenzen & Aufgaben zur Server-Parität

**Datum:** 26.07.2026
**Referenz-Projekt (Soll):** `valheim-browser` (Three.js, feature-vollständig)
**Ziel-Projekt (Ist):** `valheim-babylon` (Babylon.js 8, WebGPU/WebGL2)
**Grundlage:** `Docs/Analyse-Modelle-und-Weltgenerierung.md` (Umsetzungsplan Phase A–G)

---

> ## 📌 Momentaufnahme vom 26.07.2026 — überholt, aber nicht falsch
>
> Dieses Dokument ist eine **Bestandsaufnahme eines Tages** und wird nicht fortgeschrieben.
> Es hält fest, wie weit der Babylon-Client am 26.07.2026 hinter der Three.js-Referenz
> zurücklag und in welcher Reihenfolge die Lücken geschlossen werden sollten. Genau als
> solches ist es weiter wertvoll: Die Spalte „Wichtige Erkenntnisse aus der Referenz" ist
> eine Liste von Fallen, die man sonst ein zweites Mal baut.
>
> **Was seither anders gekommen ist, in Stichworten:**
>
> - **Die Namen stimmen nicht mehr.** Das Projekt heißt World of Vikings; das Shared-Paket
>   ist `@wov/shared`, der Server `WovServer.ts`. `valheim-babylon` und `valheim-browser`
>   sind hier Namen aus der Migrationszeit.
> - **Die Referenz ist keine mehr.** `valheim-browser` (Three.js) diente als Soll, bis der
>   Babylon-Client sie eingeholt hatte. Vergleiche gegen sie stehen nur noch als
>   historische Messungen in [03-Rendering-und-Engine.md](03-Rendering-und-Engine.md).
> - **Der Aufgabenplan M0–M3 ist weitgehend abgearbeitet und teils überholt.** Schatten,
>   Tag/Nacht-Nebel, Interpolation, Fern-Ring, Wasser, Weltkarte, HUD und Login existieren
>   — die Weltkarte inzwischen als eigenes 3D-Modell der Welt (Docs/03 §9), nicht als das
>   hier geplante 2D-Offscreen-Raster. Was heute offen ist, steht in
>   [07-Grafik-Konzept.md](07-Grafik-Konzept.md), nicht hier.
> - **Der Materialstand hat sich vollständig gedreht (16.08.2026).** Der Plan setzt
>   durchgängig voraus, dass der AssetRipper-Export vorliegt: `preloadModels` über ~43
>   Valheim-Prefabs, Placeholder→GLB-Swap, `loadSprite` auf 1595 Item-Icons. Der Export ist
>   gelöscht; die Welt besteht aus 119 eigenen Modellen, `EIGENE_MODELLE` in
>   `shared/src/prefabs.ts` ist die Whitelist. Siehe
>   [04-Asset-Pipeline.md](04-Asset-Pipeline.md).
> - **„Keine Aufgaben auf Server-/Shared-Ebene" gilt nicht mehr** (Teil 1). Der Satz war
>   zu seiner Zeit richtig — Server und Shared waren 1:1 portiert. Seither sind
>   Weltdokument/Editor, Instanzauflösung (`shared/src/instanz.ts`), Dungeons, Inventar,
>   Wetter und die eigene Flora dazugekommen. Aus den hier genannten 16 Testdateien sind 39
>   geworden; `scripts/run-tests.mjs` fährt davon eine kuratierte Liste aus 23 Läufen,
>   Kernliste 20 — neu darin `admin/test/betriebsdienst.ts` und
>   `client/test/welt-abgleich.ts`.
>
> **Nicht angefasst wurde der Inhalt unterhalb dieser Zeile.** Eine Analyse von damals
> nachträglich umzuschreiben, hieße den Erkenntnisstand zu fälschen, auf dem die
> Entscheidungen der Folgewochen beruhen.

---

## TL;DR

1. **Server & Shared sind bereits 1:1 portiert.** `server/src`, `shared/src` und alle Tests sind inhaltlich identisch mit der Three.js-Referenz (einzig Paketname `@valheim-babylon/shared` und CRLF-Zeilenenden weichen ab). Die gesamte Server-Logik (ZoneManager, PopulateFoliage, prepareFeatures, Persistenz, SpawnSystem, Admin-Fly, TimeSync, ServerConfig-Paket, Gravitation, viewRadius 4) **existiert bereits im Babylon-Repo**.
2. **Die eigentliche Arbeit liegt ausschließlich im Client.** Der Babylon-Client ist ein frischer Neuaufbau (~2 340 Zeilen in 15 Dateien) gegenüber dem reifen Three.js-Client (~4 300 Zeilen). Er rendert Welt + Gras + Entities bereits, aber ihm fehlen fast alle Produktiv-Features der Phasen D–G.
3. **Kritischster Blocker: der ServerConfig-Handshake fehlt.** Der Babylon-Client baut seinen GeoManager aus einem **hartkodierten Seed** (`world/World.ts`) statt aus dem ServerConfig-Paket (Typ 52). Läuft der Server mit anderem Seed/Flags, rendern Client und Server **verschiedene Welten**. Das ist die einzige Stelle, an der Client und Server faktisch auseinanderlaufen können.
4. **Vier Feature-Blöcke fehlen komplett** (AssetLog, Weltkarte, Fern-Terrain-Ring, Fly-Modus), ~15 weitere sind nur teilweise portiert (Schatten, Tag/Nacht-Fog, Interpolation, Placeholder/Retry/Throttle, Wasser, Kamera, HUD/Login).

---

## Teil 1: Vergleich Server & Shared (Ergebnis: ✅ vollständig)

| Bereich | Status | Detail |
|---|---|---|
| `shared/src/*` | ✅ identisch | worldgen (GeoManager, Heightmap, Perlin, FastNoise, Random, Mathf), vegetation/features/spawnData/prefabs/protocol/types/constants/hash/locationConfig + alle JSON-Daten |
| `server/src/*` | ✅ identisch | ValhallaServer, NetManager, Peer, ZDO/ZDOManager, ZoneManager, SpawnSystem, WorldManager, AdminCommands, io, util |
| `server/test` (9) + `shared/test` (7) | ✅ identisch | d6, e2, f2, f3, g1–g4, b5, geo-*, heightmap-compare, math-golden |

**→ Keine Aufgaben auf Server-/Shared-Ebene.** Der Server kann unverändert mit dem Babylon-Client betrieben werden (gleiches Wire-Protokoll, gleiche Paket-Typen).

---

## Teil 2: Differenzen Client (Three.js Soll → Babylon Ist)

### 2.1 Datei-Mapping & Umfang

| Three.js (`valheim-browser/client/src`) | Zeilen | Babylon (`valheim-babylon/client/src`) | Zeilen | Status |
|---|---|---|---|---|
| `main.ts` | 368 | `main.ts` | 163 | ⚠️ stark reduziert |
| `engine/Renderer.ts` | 541 | *(aufgeteilt)* `engine/Lighting.ts` 96 · `entities/EntityManager.ts` 277 · `player/PlayerController.ts` 99 | 472 | ⚠️ Features fehlen |
| `engine/Terrain.ts` | 896 | `engine/Terrain.ts` 284 + `engine/TerrainSplat.ts` 420 | 704 | ⚠️ Fern-Ring/Wasser/Bump fehlen |
| `engine/StaticInstancer.ts` | 315 | `entities/EntityManager.ts` (Buckets) | — | ⚠️ Placeholder/Retry/Throttle fehlen |
| `engine/AssetManager.ts` | 263 | `engine/AssetManager.ts` | 208 | ⚠️ Sprite/Placeholder/Cache/Preload fehlen |
| `engine/GrassClutter.ts` | 672 | `engine/GrassClutter.ts` 466 + `engine/ClutterWindPlugin.ts` 141 | 607 | ✅ nahezu 1:1 |
| `engine/AssetLog.ts` | 82 | — | — | ❌ **fehlt komplett** |
| `engine/InputManager.ts` | 106 | `engine/InputManager.ts` | 44 | ⚠️ Movement/Run/Jump/Wheel/Key-Handler fehlen |
| `ui/WorldMap.ts` | 155 | — | — | ❌ **fehlt komplett** |
| `net/GameSocket.ts` | 240 | `net/GameSocket.ts` 222 + `net/ZDOSync.ts` 102 | 324 | ✅ nahezu 1:1 (Protokoll ok) |
| — | — | `engine/WindPlugin.ts` 75 · `ui/Hud.ts` 31 · `world/World.ts` 41 | — | B-only |

### 2.2 Feature-Matrix (Soll → Ist)

| Feature | Three.js (A) | Babylon (B) | Prio |
|---|---|---|---|
| **ServerConfig-Paket (Typ 52)** | ✅ baut GeoManager live aus Server-Seed+Flags | ❌ **hartkodierter Seed** | **P0** |
| **StaticInstancer Placeholder→GLB-Swap** | ✅ Placeholder-Box, Swap bei 1-Mesh-GLBs (Fix 25.07) | ❌ Static ohne Modell **unsichtbar** | **P0** |
| **Asset-Retry (bounded, 10×/35 s)** | ✅ Statik + Renderer | ❌ einmaliger Fehlschlag = permanent weg | **P0** |
| **Negativ-Cache-TTL (30 s)** | ✅ | ❌ Fehler permanent gecacht | **P0** |
| **preloadModels (G-POP Cache-Warming)** | ✅ ~43 Prefabs nach ServerConfig | ❌ | **P0** |
| **AdminEvent-Empfang (fly-Flag, Toast)** | ✅ | ❌ (nur senden) | **P0** |
| **Fly-Modus (Z, getFlyVertical, HUD-Badge)** | ✅ | ❌ moveY/jumping hartkodiert 0/false | **P0** |
| **Schatten (PCFSoft 2048, sun-follow)** | ✅ | ❌ (Lighting ohne ShadowGenerator) | P1 |
| **ACES-Tone-Mapping** | ✅ | ❌ | P1 |
| **Tag/Nacht Fog-Farben + -Dichten** | ✅ updateDayNight (pro Tageszeit) | ⚠️ nur Density-Param | P1 |
| **G2-Interpolation (zdoTargets, Lerp, Snap>15 m)** | ✅ | ❌ Dynamics snappen direkt | P1 |
| **Remote-Player-Meshes (Capsule+Kopf)** | ✅ | ❌ | P1 |
| **Fern-Terrain-Ring (FAR_RADIUS 10, 2×2, FAR_BIAS)** | ✅ | ❌ endet bei 256 m | P1 |
| **Far-Water-Ebene (2048 m)** | ✅ | ❌ nur 4000-m-Near-Plane | P1 |
| **Wasser-Vertex-Sinus + Normal-Map-Scroll** | ✅ beides | ⚠️ nur Normal-Map-Scroll | P1 |
| **G-TEX2 Normal-Map-Bump (3 Gruppen)** | ✅ | ❌ bewusst ausgelassen | P2 |
| **Vertex-Color-Fallback (uSplatReady)** | ✅ | ❌ nur Splat | P2 |
| **Weltkarte (M, progressiv, Player-Pfeil)** | ✅ WorldMap.ts | ❌ | P2 |
| **Login/Connect-Screen (Name/PW/URL/Zeit)** | ✅ | ❌ startet sofort, URL-Params | P2 |
| **HUD: Health/Stamina/PlayerList/Chat/worldTime** | ✅ | ⚠️ minimal (FPS/pos/chunks/zeit) | P2 |
| **AssetLog (Ring-Buffer, POST-Batching, __assetLog)** | ✅ | ❌ nur `assets.failed`-Zähler | P2 |
| **Placeholder mit Namensschild (getPlaceholder)** | ✅ farbig + Text | ⚠️ einfarbige Box (nur Dynamik) | P2 |
| **loadSprite (Item-Icons)** | ✅ | ❌ | P3 |
| **Anisotropie-Setup** | ✅ | ❌ | P3 |
| **Kamera: Terrain-Kollision + Wheel-Zoom** | ✅ | ❌ fester Boom 4,5 m | P2 |
| **TimeSync: serverDay/worldTime-State** | ✅ | ⚠️ nur timeOfDay→lighting | P2 |
| **sendSetTimeOfDay / TimeSelect** | ✅ | ❌ | P3 |

### 2.3 Bereits korrekt / nicht erneut anfassen

- **Skalierung:** Babylon-Client nutzt GLB-Naturgröße × scaleScalar (die three.js-Höhen-Normalisierungs-Falle wurde nie eingebaut). ✅
- **Doppel-Transform-Fix:** Master-Meshes detachen + Identity nach Capture (26.07). ✅
- **Alpha-Cutout-Kette:** `transparencyMode = MATERIAL_ALPHATEST` + `alphaCutOff = 0.5` + `useAlphaFromAlbedoTexture` + `hasAlpha` (26.07). ✅
- **GrassClutter:** nahezu 1:1 inkl. Wind, Player-Push, Dither-Fade, dropZones. ✅ — aber (26.07) `grass_meadows`/`grass_meadows_short`/`grass_heath` sind kaputte AssetRipper-Exporte (Blatt-Kunst in einem schmalen Streifen statt über die 3 UV-Spalten des `grasscross`-Meshs verteilt, siehe `tools/gen-grass-texture.py`-Kommentar). Die generierten Ersatztexturen lagen bereits unter `valheim_browser_assets/textures/*_gen.png`, waren aber nirgendwo verdrahtet — jetzt in `GrassClutter.ts` als `texture: 'grass_meadows_gen'`/`'grass_heath_gen'` referenziert + Dateien nach `valheim-babylon/assets/textures/` kopiert. `grass_heath_redflower.png` war zusätzlich 0 Byte (kaputte Kopie) — von `valheim_browser_assets/textures/clutter/` nachkopiert. `grass_toon1_yellow.png` (swampGrass) hat dieselbe Alpha-Signatur wie das kaputte `grass_meadows_short.png` (statistisch identisch, per Spalten-Sampling verglichen), nur subtiler: Alpha über volle Höhe verteilt, aber nur 1px-Linien statt Blattfläche — bei Renderdistanz praktisch unsichtbar. Ergänzt in `gen-grass-texture.py` (dritte Palette, Sumpf-Gelbgrün) → `grass_toon1_yellow_gen.png`. **Gleicher Fix fehlt noch in valheim-browser** (three.js-Referenz hat dasselbe Problem, `_gen`-Dateien liegen dort ungenutzt daneben).
- **ClutterWindPlugin war komplett wirkungslos (26.07, gravierendster Fund):** `MaterialPluginBase`-Konstruktor hat `enable = false` als Default (6. Parameter) — der Aufruf `super(material, 'ClutterWind', 210, { CLUTTERWIND: true })` hat den Plugin nie in `_activePlugins` aufgenommen. Ohne das läuft `getUniforms()` zwar (Uniform-Deklarationen `clutterTime` etc. stehen im Shader), aber `getCustomCode()` (Wind-Sway, Distanz-Fade/Shrink, Player-Push) und `bindForSubMesh()` (die Uniform-Werte) laufen **nie** — die komplette Gras-Optik war seit Einführung des Plugins tot, nur die (nutzlosen, nie gesetzten) Uniform-Deklarationen waren sichtbar. Per Live-Shader-Dump (`effect.fragmentSourceCode`/`vertexSourceCode`) verifiziert, nicht nur vermutet. Zusätzlich zwei Folgefehler, die erst nach dem Enable-Fix auffielen (Shader-Compile-Fehler):
  - `scene.vEyePosition` existiert nicht — die UBO hat keinen Instanznamen, der Uniform heißt schlicht `vEyePosition` (wie im Babylon-Kern-Shader).
  - `varying float vClutterFade;` (+ die `clutterHash`-Funktion) standen am Injection-Point `CUSTOM_VERTEX_MAIN_BEGIN`/`CUSTOM_FRAGMENT_MAIN_BEGIN` — **innerhalb** von `main()`. Babylon übersetzt `varying`→`out`/`in` für WebGL2/GLSL300es; ein Storage-Qualifier auf einer lokalen Variable ist ein GLSL-Fehler. Verschoben nach `CUSTOM_VERTEX_DEFINITIONS`/`CUSTOM_FRAGMENT_DEFINITIONS` (vor `main()`).
  - Der Up-Normals-Pin (schwarze Rückseiten der Cross-Meshes vermeiden) schrieb zusätzlich in eine nicht existente Variable `normal` (der Shader kennt nur `normalW`) am Injection-Point `CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR` — der läuft aber *nach* der Lichtberechnung, der Schreibzugriff hatte so oder so nie Wirkung. Fix: `normalW = vec3(0,1,0)` am Injection-Point `CUSTOM_FRAGMENT_BEFORE_LIGHTS` (letzter Punkt vor der Lichtschleife).
  - Ergebnis: die früheren "kaputt aussehenden Pflanzen" (große schwarze Dreiecksflecken zwischen den Gras-Klumpen) waren **nicht** die Textur-Bugs, sondern fast vollständig dieser Plugin-Bug — unbeleuchtete Rückseiten der Cross-Meshes. Nach dem Fix (Playwright-Vergleich vorher/nachher) keine schwarzen Flecken mehr, Gras zeigt echte Blatt-Silhouetten mit Farbvarianz.
- **Splat-Shader:** NodeMaterial mit Sand/Rock/Snow/Lava/Depth + manuellem EXP2-Fog. ⚠️ Diese Einschätzung war falsch (nur Code-Review, nie im Browser getestet): die manuelle `world*view*projection`-Multiplikation über generische `MultiplyBlock`s hatte die falsche Reihenfolge/Konvention und machte das gesamte Terrain unsichtbar, sobald `?splat=1` (bzw. nach dem Default-Fix unten) aktiv war — deshalb lief der Client faktisch immer im `?flat=1`-Fallback. Fix (26.07): `clipPos` nutzt jetzt den System-Value `NodeMaterialSystemValues.WorldViewProjection` statt manueller Matrix-Multiplikation (`TerrainSplat.ts`). `Terrain.ts`: `flatMode` defaultete zusätzlich auf `true` (`!params.has('splat')`) — invertiert, jetzt nur noch bei `?flat=1`. ✅ jetzt tatsächlich verifiziert (Playwright-Screenshots Meadows + Mountain).
- **Netzwerk-Protokoll:** BinaryReader/Writer, Handshake, ZDOSync, PlayerInput-Signatur (lookPitch/moveY/jumping), sendAdminCommand. ✅

---

## Teil 3: Aufgabenplan (priorisiert)

### Phase M0 — Kritische Server-Kopplung & Sichtbarkeit (P0) 🔴

*Ohne diese Punkte kann Client ≠ Server-Welt rendern bzw. bleiben Objekte unsichtbar.*

| # | Aufgabe | Babylon-Datei | Referenz (Three.js) | Aufwand |
|---|---|---|---|---|
| M0.1 | **ServerConfig-Handshake (Typ 52)**: Paket in `GameSocket`/`main.ts` empfangen (worldName, seed, genVersion, Flags-Byte), `createWorld(seed, flags)` damit live bauen, erst danach Terrain/Gras/Entities initialisieren; Platzhalter-Terrain bis dahin. Hartkodierten Seed in `World.ts` ersetzen. | `main.ts`, `net/GameSocket.ts`, `world/World.ts` | `main.ts` (initTerrain-Swap), `GameSocket.ts` | M |
| M0.2 | **StaticInstancer Placeholder→GLB-Swap**: Placeholder-Box pro Bucket bis Modell geladen; Rebuild-Bedingung um `isPlaceholder`-Flag erweitern (1-Mesh-GLB-Bug aus three.js vermeiden!); Statik ohne Modell sichtbar statt unsichtbar. | `entities/EntityManager.ts` | `StaticInstancer.ts` (rebuildBucket, Fix 25.07) | M |
| M0.3 | **Asset-Retry + Negativ-Cache-TTL**: `NEGATIVE_CACHE_MS = 30 s` (Fehler-Eintrag wirft sich selbst weg), bounded Retry 10×/35 s pro Bucket (`loadBucketModel`) und pro Dynamic-Entity; Abbruch bei leerem Bucket/entferntem ZDO. | `engine/AssetManager.ts`, `entities/EntityManager.ts` | `AssetManager.ts` (NEGATIVE_CACHE_MS, MODEL_RETRY_*), `StaticInstancer.loadBucketModel`, `Renderer.createZDOObject` | M |
| M0.4 | **preloadModels**: nach ServerConfig ~43 häufige Vegetations-Prefabs (`COMMON_PREFAB_MODELS`) + 3 Kreaturen-GLBs vorladen → kein Placeholder→GLB-Doppel-Pop. | `engine/AssetManager.ts`, `main.ts` | `AssetManager.preloadModels`, G-POP | S |
| M0.5 | **AdminEvent-Empfang + Fly-Modus**: `PacketType.AdminEvent` in `main.ts` (command/active/message → HUD-Badge „🕊 FLY" + Toast); Z-Taste togglet `sendAdminCommand("fly")`; `InputManager.getFlyVertical()` (Space/Ctrl); `sendPlayerInput` mit echtem `moveY`/`jumping` statt 0/false. | `main.ts`, `net/GameSocket.ts`, `engine/InputManager.ts`, `player/PlayerController.ts`, `ui/Hud.ts` | `main.ts` (AdminEvent), `InputManager.getFlyVertical`, `Renderer` (flyIndicator) | M |

### Phase M1 — Visuelle Treue & Bewegung (P1) 🟠

*Bringt den Look und das Spielgefühl auf Referenz-Niveau.*

| # | Aufgabe | Babylon-Datei | Referenz | Aufwand |
|---|---|---|---|---|
| M1.1 | **Schatten**: ShadowGenerator (CSM oder 2048-Map), sun-follow auf Spieler, PCF-Filter; Entities/Terrain cast+receive. | `engine/Lighting.ts`, `entities/EntityManager.ts`, `engine/Terrain.ts` | `Renderer.ts` (PCFSoft, shadow-follow) | M |
| M1.2 | **ACES-Tone-Mapping** + ImageProcessing-Config (contrast/exposure passend zum Referenz-Look). | `engine/Lighting.ts` / Scene-Setup | `Renderer.ts` (ACESFilmicToneMapping) | S |
| M1.3 | **Tag/Nacht Fog-Farben + -Dichten**: `updateDayNight`-Logik portieren — Fog-Farbe/Dichte, Sun-Intensität/-Farbe, Ambient, Sky pro Tageszeit (Tag 0,0028 / Dämmerung 0,0032 / Nacht 0,0042 aus G-POP). | `engine/Lighting.ts`, `main.ts` (TimeSync→worldTime) | `Renderer.updateDayNight` | M |
| M1.4 | **G2-Interpolation**: Ziel-Position/Rotation pro dynamischem ZDO (`zdoTargets`), exp.-Glättung (τ≈80 ms) + Snap >15 m gegen Teleport-Zucken; Remote-Spieler einbezogen. | `entities/EntityManager.ts` | `Renderer.ts` (zdoTargets, ENTITY_LERP_RATE, ENTITY_SNAP_DIST) | M |
| M1.5 | **Remote-Player-Meshes**: Capsule+Kopf-Mesh pro Remote-Peer (`updateRemotePlayer`/`removeRemotePlayer`), eigene ZDOs des eigenen Spielers überspringen (`ownUserId`-Filter existiert in ZDOSync). | `entities/EntityManager.ts`, `player/` | `Renderer.updateRemotePlayer`, `createCharacterMesh` | M |
| M1.6 | **Fern-Terrain-Ring + Far-Water**: 2×2-Zonen-Chunks, 4-m-Stride, Radius 10 (640 m), `FAR_BIAS = −0,35 m`, Hintergrund-Queue (1 Chunk/Frame, nur wenn Nah-Queue leer), kein Schatten; Fern-Wasser 2048-m-Plane auf 64-m-Raster folgend. Chunks abräumen bei Nah-Abdeckung (G-POP-Regression #2 beachten!). | `engine/Terrain.ts` (+Splat) | `Terrain.ts` (refreshFarChunks, farQueue, FAR_RADIUS) | L |
| M1.7 | **Wasser-Vertex-Sinus**: CPU-Sinus-Wellen auf der Nah-Wasserebene (phasenstabil über Weltkoordinaten), zusätzlich zum bestehenden Normal-Map-Scroll; Wasser-Normal-Map async laden mit Fehler-Log. | `engine/Terrain.ts` | `Terrain.ts` (Wasser-Animation, loadWaterTexture) | M |

### Phase M2 — Vollständigkeit & Komfort (P2) 🟡

| # | Aufgabe | Babylon-Datei | Referenz | Aufwand |
|---|---|---|---|---|
| M2.1 | **Weltkarte (M)**: progressives Offscreen-Rendering (~12 Zeilen/Frame) aus `geo.getBiome`, 4096-m-Fenster, Biomfarben, yaw-rotierter Player-Pfeil, M/Esc-Toggle, Pointer-Lock-Handling. Benötigt M0.1 (live geo). | `ui/WorldMap.ts` (neu), `main.ts` | `ui/WorldMap.ts` | M |
| M2.2 | **Kamera**: Orbit mit Pitch (±~80°), Wheel-Zoom (2–16 m), Terrain-Kollision (`cam.y ≥ getTerrainHeight + 0,5`). | `player/PlayerController.ts`, `engine/InputManager.ts` (Wheel) | `Renderer.ts` (Kamera) | M |
| M2.3 | **Login/Connect-Screen**: Name/Passwort/Server-URL/Tageszeit; erst nach Auth die Welt aufbauen; `sendSetTimeOfDay`. | `ui/` (neu), `main.ts`, `net/GameSocket.ts` | `main.ts` (Connect-Screen) | M |
| M2.4 | **HUD vollständig**: Health/Stamina, Player-Count, PlayerList, Chat-Anzeige, worldTime/serverDay, FPS; AdminEvent-Toast. | `ui/Hud.ts`, `main.ts` | `main.ts` (HUD-DOM) | M |
| M2.5 | **AssetLog**: Ring-Buffer (500), Dedupe, `window.__assetLog`, POST-Batching `/__asset-log` (Vite-Plugin-Senke wie Referenz), Verdrahtung an loadModel/loadSprite/updateZDOEntity/setInstance. | `engine/AssetLog.ts` (neu), `vite.config.ts`, `AssetManager.ts`, `EntityManager.ts` | `AssetLog.ts`, `vite.config.ts` (assetLogSink) | M |
| M2.6 | **Placeholder mit Namensschild**: prozedurale Canvas-Textur (deterministische Farbe, 2-zeiliger Name, Font-Skalierung) für Dynamic + Static Placeholder. | `engine/AssetManager.ts`, `entities/EntityManager.ts` | `AssetManager.getPlaceholder` | S |
| M2.7 | **G-TEX2 Normal-Map-Bump**: 3 Normal-Tiles (`terraintile_n_0/1/2`), tileNormalGroup, tangentenfreie Screen-Space-Perturbation, eigenes Ready-Gate. | `engine/TerrainSplat.ts` | `Terrain.ts` (injectSplatShader Bump) | M |
| M2.8 | **Vertex-Color-Fallback**: D5-Bake als `uSplatReady=0`-Fallback bis Texturen geladen. | `engine/TerrainSplat.ts`, `engine/Terrain.ts` | `Terrain.ts` (CPU-Vertexfärbung) | M |

### Phase M3 — Nachzügler (P3) ⚪

| # | Aufgabe | Referenz | Aufwand |
|---|---|---|---|
| M3.1 | `loadSprite` + Item-Icon-Pfad (Sprite-Billboards für Pickables/Items) | `AssetManager.loadSprite`, `findPrefabByHash`-Sprite | M |
| M3.2 | Anisotropie-Setup (GPU-Max) für Terrain-Texturen | `Terrain.ts` (setAnisotropy) | XS |
| M3.3 | `sendSetTimeOfDay` / TimeSelect im Login | `main.ts` | XS |
| M3.4 | StaticInstancer-Throttle: Capacity-64er-Schritte, `REBUILD_INTERVAL_MS`, `MAX_REBUILDS_PER_FLUSH` (Rebuild-Stürme glätten) | `StaticInstancer.ts` | S |

---

## Abhängigkeits-Graph

```
M0.1 ServerConfig ──► M0.4 preload ──► M2.1 Weltkarte ──► (alles Weitere baut auf korrekter Welt auf)
M0.2 Placeholder-Swap ──► M0.3 Retry ──► M2.6 Namensschild
M0.5 AdminEvent/Fly ──► M1.4 Interpolation (Remote-Spieler sichtbar & weich)
M1.1 Schatten ──► M1.3 Tag/Nacht (Sonne treibt beides)
M1.6 Fern-Ring ──► M1.7 Wasser (Far-Water gehört zum Ring)
```

**Empfohlene Reihenfolge:** M0 komplett (Client rendert dann garantiert die Server-Welt, Objekte sichtbar, Admin-Fly zum Inspizieren) → M1.6+M1.7 (Welt sieht „fertig" aus bis zum Horizont) → M1.1–M1.3 (Look) → M1.4/M1.5 (Mitspieler) → M2 (Komfort) → M3 (Feinschliff).

---

## Wichtige Erkenntnisse aus der Referenz (nicht erneut falsch machen)

1. **1-Mesh-GLB-Placeholder-Bug (25.07):** Rebuild-Bedingung darf nicht nur auf `capacity`/`meshes.length === sourceMeshes.length` prüfen — sonst bleibt bei 1-Mesh-GLBs die Box für immer. Immer `isPlaceholder`-Flag prüfen.
2. **Fern-Ring-Abräumen (G-POP-Regression #2):** Fern-Chunks müssen disposed werden, sobald sie vollständig nah-abgedeckt sind — sonst übermalen grobe 4-m-Strides das Detail-Terrain.
3. **Heightmap-Zone-Offset (G-POP-Regression #1):** Chunk-Ursprung = `zone·64 − 32` (Heightmap-Raster beginnt bei Zonenzentrum −32), nicht `zone·64`.
4. **flipY:** GLB-UVs folgen glTF-Konvention → Terrain-/Gras-Texturen mit `flipY = false` laden, sonst steht der Tile-Stack auf dem Kopf.
5. **Alpha-Cutout-Deadlock:** Bei Babylon zwingend `transparencyMode = MATERIAL_ALPHATEST` setzen — die Legacy-Heuristik (`useAlphaFromAlbedoTexture` + `needAlphaBlending`) blockiert den Alpha-Test sonst.
6. **DoubleSide-Up-Normals:** Grass/Leaf-Cards mit DoubleSide → Normalen im Fragment hart auf +Y pinnen, sonst schwarze Rückseiten.
7. **Server hat kein Terrain-Wissen über y=50 hinaus — bei uns schon:** anders als im ursprünglichen Analyse-Stand kennt der Server (Phase D6) die echte Bodenhöhe (GeoManager+HeightmapProvider). Der Babylon-Client muss ZDO-Y **nicht** mehr clientseitig auf Terrain snappen — y kommt autoritativ vom Server.
8. **Keine Re-Arbeit am Server nötig:** Alle C++-Verifikationen (geo-compare bit-exakt, heightmap-compare, b5-ashlands) gelten für das Babylon-Repo unverändert, da `shared/` identisch ist.
