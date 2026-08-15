# Analyse-Bericht: Modell-Proportionen & Weltgenerierung

**Datum:** 22.07.2026
**Quellen:** `valheim-browser` (Browser-Game), `valheim_browser_assets` (Assets), `valheim.community` (Valhalla2.0 C++-Server, Referenz)

---

## TL;DR

1. **Die GLB-Modelle sind maßstabs-korrekt** — der Fehler entsteht im Client: Jeder Baum wird per hardcodiertem "Hint" auf eine geratene Höhe gestaucht (Buche: 30,5 m → 8 m, Faktor 0,26!). Dadurch sind alle Bäume ~8–10 m hoch und die Proportionen zwischen den Arten sind zerstört.
2. **Die Tannen-Form** leidet zusätzlich an fehlendem Alpha-Cutout (Nadel-Planes werden opak gerendert) und fehlendem DoubleSided (Äste von einer Seite unsichtbar).
3. **Die Original-Skalierung fehlt komplett**: Im echten Valheim bekommt jeder Baum einen Zufalls-Scale (Tanne im Schwarzwald: **2,0–2,5×** → 22–27 m hoch!). Der Browser-Server spawnt Bäume ohne Rotation und ohne Scale.
4. **Es gibt noch keine Weltgenerierung**: Der Server spawnt nur eine statische Demo-Welt (~50 Objekte im Ring), der Client generiert eigenes sin/cos-Placeholder-Terrain. ZoneManager, Heightmap, GeoManager sind nicht portiert.
5. **Die gute Nachricht**: Der C++-Server enthält die komplette Original-Weltgenerierung (1:1-Port des Valheim-WorldGenerator, Game-Version 0.221.10, WorldGen-Version 2) — inklusive aller Zahlenwerte, Unity-exaktem Perlin, RNG und geparsten Datenpaketen (vegetation.pkg, features.pkg, prefabs.pkg). Das ist eine vollständige Port-Blaupause.

---

# Teil 1: Browser-Client & Assets (Ist-Zustand)

## 1.1 Client-Stand allgemein

Früher MVP mit Vite + Three.js (**WebGL2**, nicht WebGPU):

- **Renderer** (`client/src/engine/Renderer.ts`): WebGLRenderer mit ACES-Tone-Mapping, PCFSoft-Schatten (Z. 51–61), DirectionalLight-Sonne mit Shadow-Follow (Z. 67–77), Sky-Dome als Shader-Gradient (Z. 80–110), FogExp2 (Z. 44). Tag/Nacht-Zyklus via `updateDayNight()` (Z. 338–367).
- **Terrain**: rein clientseitiger Placeholder — eine einzelne Plane 512×512 m (Z. 146–177), Höhen aus 3 Oktaven `sin*cos`-Noise + Basis-Höhe 30 (Z. 184–191). Kein Chunk-System, keine Server-Heightmap, kein Wasser, keine Biome.
- **Bewegung**: WASD + PointerLock, Third-Person-Kamera mit Lerp, Client-Prediction (Walk 4,5 m/s, Run 7,5 m/s), Input mit 20 Hz an Server. Spieler klebt an **Client**-Terrainhöhe.
- **HUD**: Connect-Screen, Health/Stamina, FPS, Player-Count, Weltzeit. Kein Inventar/Crafting/Bauen.
- **Netzwerk**: WebSocket mit eigenem Binär-Framing, Handshake (Version → PeerInfo → Passwort), ZDOSync-Handler.
- **Assets**: `AssetManager` lädt `/assets/models/<name>.glb` (GLTFLoader) + PNG-Sprites, mit Canvas-Platzhaltern bei Fehlschlag. Vite serviert den externen Ordner `valheim_browser_assets` unter `/assets` und proxyt `/ws` → Port 2456.
- **Nicht vorhanden**: Entitätssystem jenseits statischer Meshes, Animationen, Audio, LOD, Instancing, KTX2/Draco. **FPS aktuell ~6** (laut Screenshot) — Rendering braucht später zwingend Instancing.

## 1.2 Asset-Pipeline (wie die GLBs entstanden sind)

Das in PLAN.md beschriebene `tools/asset-extractor` ist **nicht** die echte Pipeline — es katalogisiert nur Bundles (`bundles.json`); das referenzierte `convert.ts` existiert nicht. Es gab **keinen** gltf-transform/Draco/KTX2-Lauf.

Die tatsächliche Pipeline (dokumentiert in `tools/assetripper/ripper.log`):

- **AssetRipper 1.3.14.0** (GUI), zwei Läufe am 22.07.2026.
- Quelle: `Valheim_Client/Valheim/valheim_Data` (Linux-Client 0.221.12).
- Einstellungen: PNG-Export, DirectExport, Dummy-Shader, StaticMeshSeparation. **Kein Skalierungs-Setting — AssetRipper exportiert in Unity-Metern mit Original-Prefab-Hierarchie als glTF-Node-Baum.**
- **Weder 0,01 (FBX File Scale) noch 100× wird irgendwo angewendet.** Prefab-Kind-Transforms (inkl. Scale) stehen als glTF-Nodes in der Datei.
- Verifiziert: `valheim_browser_assets/models/` (7463 GLBs) ist eine 1:1-Kopie von `tools/assetripper/export/Assets/PrefabHierarchyObject/` (MD5-geprüft bei FirTree.glb).

## 1.3 Asset-Bestand (`valheim_browser_assets`)

| Inhalt | Details |
|---|---|
| `models/` | **7463 GLB (glTF 2.0), 4,8 GB**, Texturen eingebettet (PNG) |
| `textures/` | 18 MB, aber **~2674 von ~2719 PNGs sind 0 Byte leer** — nur 75 nutzbar (unkritisch, da GLBs Texturen einbetten) |
| `sprites/` | 21 MB, 1595 Item-Icons (vollständig) |
| `audio/` | nur eigenes Material (MP3); die 3318 .ogg des Exports sind gelöscht — keine Valheim-Aufnahmen |
| `manifest.json` | 786 KB Index (4687 Einträge), Vertex-/Face-Zahlen, **keine Bounding-Boxen, keine Skalen** |
| Formate | Nur GLB + PNG. **Kein KTX2, kein Draco** |

**Gemessene Weltmaße der Baum-GLBs** (Node-Hierarchie inkl. Scale ausgewertet, Einheiten = Meter):

| Modell | Node-Skalen | B × H × T (m) |
|---|---|---|
| FirTree.glb | `Pine_tree` + `viewblock`: [2,2,2] | 6,25 × **10,89** × 7,18 |
| Pinetree_01.glb | keine | 8,40 × **24,43** × 8,54 |
| PineTree.glb (alt) | `trunk` [0,1], `stub` [1,6;0,57;1,6] | 9,44 × **21,30** × 8,96 |
| Beech1.glb | keine | 22,46 × **30,54** × 23,36 |
| Birch1.glb | keine | 14,16 × **25,34** × 19,64 |
| Oak1.glb | keine | 30,58 × **25,52** × 35,86 |
| SwampTree1.glb | — | 12,28 × **21,73** × 6,99 |
| Beech_small1.glb | — | 2,54 × 3,78 × 2,31 |

Referenzen: Werkbank 3,72×1,85×2,10 m, Holzportal 4,23×3,29×1,18 m, Truhe 1,64×0,79×1,13 m — alles plausible Valheim-Meter-Maße.

**→ Die GLBs selbst sind maßstabs-korrekt. Die Tanne ist in der Datei 10,9 m hoch (Prefab-Scale 1).**

## 1.4 ⚠️ Die Skalierungsfalle: Höhen-Normalisierung im Client

Ladeweg: `main.ts` ZDOSync → `Renderer.updateZDOEntity()` (Z. 235–253) → `createZDOObject()` (Z. 255–300) → `AssetManager.loadModel()` → GLTFLoader + `SkeletonUtils.clone()`.

Der Scale kommt **nicht** aus ZDO-Daten und nicht aus den GLBs, sondern aus **hardcodierten "render hints"** in `shared/src/prefabs.ts`:

- `HINT_DEFS` (Z. 63–146), Bäume Z. 78–82: `Beech1` h=8,0, `FirTree` h=9,0, `Pinetree_01` h=10,0, `Oak1` h=9,0, `Birch1` h=8,0. Fallback: `localScale` aus `prefabData.json` — dort steht für **alle** Bäume 1,1,1.
- Die kritische Normalisierung in `Renderer.ts` Z. 283–293:

```ts
const box = new THREE.Box3().setFromObject(instance);
const size = box.getSize(new THREE.Vector3());
if (size.y > 0) instance.scale.setScalar(scale.h / size.y);
```

Jedes Modell wird **uniform auf die geratene Hint-Höhe gestaucht/gestreckt** und danach auf XZ zentriert, Basis auf y=0.

**Konsequenz** (natürliche Höhe → erzwungene Höhe):

| Baum | natürlich | erzwungen | Faktor |
|---|---|---|---|
| FirTree | 10,89 m | 9,0 m | 0,83 |
| Pinetree_01 | 24,43 m | 10,0 m | **0,41** |
| Beech1 | 30,54 m | 8,0 m | **0,26** |
| Oak1 | 25,52 m | 9,0 m | 0,35 |
| Birch1 | 25,34 m | 8,0 m | 0,32 |

Im Original ist eine Buche ~3× so hoch wie eine Tanne — im Browser sind alle Bäume ~8–10 m. **Die Proportionen zwischen den Arten sind zerstört; der Wald wirkt wie Bonsai.**

## 1.5 ⚠️ Die "falsche Form" der Tanne — 3 zusammenwirkende Ursachen

1. **Fehlendes Alpha-Cutout**: `FirTree.glb`-Material hat kein `alphaMode: MASK` / `alphaCutoff`, und der Client setzt es auch nicht (`AssetManager.ts` Z. 63–70 setzt nur Schatten-Flags). Three.js rendert die Nadel-/Ast-Planes **opak** → Silhouette aus sichtbaren Vielecken statt feiner Nadeln. (Gilt auch für `Beech1.glb`: `beech_leaf`/`beech_bark`.)
2. **Fehlendes DoubleSided**: Leaf-Cards werden backface-gecullt; von einer Seite fehlen Äste → Baum wirkt "zersplittert".
3. **Falsche Zielgröße**: 9,0 m statt 10,89 m — im Verhältnis zu den ebenfalls verkleinerten Nachbarbäumen wirkt die Tanne gedrungen.

Zusätzlich:

- **Keine pro-Instanz-Zufallsskalierung**: Im echten Valheim bekommt Vegetation über das ZoneSystem einen Zufalls-Scale (ZDO-Vec3-Member `"scale"`). Hier spawnt `ValhallaServer.spawnDemoWorld()` mit Identitäts-Rotation und ohne Scale-Member (`server/src/ValhallaServer.ts` Z. 137–146). Das Flag `SYNC_INITIAL_SCALE` existiert (`shared/src/types.ts` Z. 28), wird aber nirgends benutzt.
- **Vertex-Farben fehlen**: Die GLBs haben kein `COLOR_0` — im Original steuern Vertex-Farben Wind/Saisonalität. Wind-Shader wäre damit vorerst nicht 1:1 machbar.

## 1.6 Terrain/Weltgenerierung im Browser (Ist)

- **Serverseitig: keine Weltgenerierung.** Kein `server/src/world/`-Verzeichnis. Stattdessen `ValhallaServer.spawnDemoWorld()` (Z. 137–189): ~50 feste ZDOs um den Ursprung — Basis-Camp, **24 Bäume im Ring** (Rotation über 5 Arten, Abstand 25–49 m), Felsen, Pickables, Items, 4 Kreaturen. Alle auf y=0, Identitäts-Rotation. Der Seed `KxSYuZquuw` aus `server/data/server.yml` wird nirgends ausgewertet.
- **Clientseitig**: eigenes Placeholder-Terrain (`generateTerrain(0,0,8)`), **Server-Y wird ignoriert** — ZDOs werden auf Client-Terrainhöhe gesnappt (Z. 247–249, Kommentar: "Server has no terrain yet"). Server-Bewegung ebenfalls ohne Terrain/Gravitation (TODO Z. 440).

## 1.7 Server-Port-Stand (gegen PLAN.md)

**Vorhanden** (~3060 LOC unter `server/src/`):

| Modul | Stand |
|---|---|
| ZDOManager (301 Z.) | weitgehend vollständig: Sektor-Storage, Indizes, Destroy-Liste |
| ZDO (342 Z.) / ZDOID (131 Z.) | Member-Typen, Revisionen (23/9-bit), Flags |
| PrefabManager (82 Z.) | Registry über 3447 Prefabs aus `prefabData.json` |
| NetManager (265 Z.) | WebSocket, Peer-Lifecycle, Passwort-Auth, PlayerList |
| Peer (197 Z.) | ZDO-Revision-Tracking (`isOutdatedZDO`) |
| Reader/Writer | Varint/ZigZag, Vector3/Quaternion |
| ValhallaServer (528 Z.) | 30-Hz-Tick, Weltzeit, ZDO-Delta-Sync (50 ms, viewRadius 3 Zonen), Chat, server-autoritative Bewegung |
| Hash.ts | `getStableHash` — gegen pkg-Hashes verifiziert |

**Nicht vorhanden** (PLAN.md Phase 2): **ZoneManager** (Biome/Features/GlobalKeys), **Heightmap/HeightmapBuilder**, **WorldManager** (Persistenz, `saveWorld()` ist Stub), **GeoManager**, **DungeonGenerator**, **RandomEventManager**, RouteManager, **FastNoise** (`util/FastNoise.ts` fehlt).

Konstanten sind bereits angelegt in `shared/src/constants.ts` (Z. 14–45: `ZONE_SIZE=64`, `WORLD_INNER_ZDIAMETER=200`, …).

---

# Teil 2: C++-Weltgenerierung (Referenz aus Valhalla2.0)

Analysiertes Repo: `valheim.community` — C++-Port des original Valheim-WorldGenerator, Ziel-Game-Version **0.221.10** (`library/include/CompileSettings.h:362-363`), WorldGen-Version **2** (Z. 372). Die `.pkg`-Daten wurden vollständig binär geparst.

## 2.1 Weltgeometrie / Grundkonstanten

| Konstante | Wert | Quelle |
|---|---|---|
| Zone-Größe | **64 m × 64 m** (`UNITS_PER_ZONE = 64`) | `ZoneManager.h:185` |
| Heightmap-Vertices pro Zone | **65 × 65** | `HeightMap.h:66` |
| **Wasser-Level (Ozean-Y)** | **30.0** (`WATER_LEVEL = 30`) | `ZoneManager.h:186` |
| Welt-Radius (Logik) | 10000 m | `GeoManager.h:212` |
| Weltrand (Wasserkante) | 10500 m | `GeoManager.h:214` |
| Zonenradius der Welt | 164 Zonen (Durchmesser 328) | `ZoneManager.h:190-191` |
| Aktiver Generierungsradius um Spieler | je 2 Zonen (NEAR/DISTANT) | `ZoneManager.h:183-184` |

**Einheiten-System**: Alle Biom-Höhenfunktionen liefern ~0..0,5 und werden in `GetBiomeHeight` mit **× 200** skaliert (`GeoManager.cpp:1055-1091`). Basishöhe 0,15 entspricht also exakt dem Wasser-Level 30 m. Ocean = Basishöhe ≤ 0,02.

Zone-Koordinaten: `WorldToZonePos` = `floor((p + 32)/64)`, `ZoneToWorldPos` = `zone*64` (Zonenzentrum), `ZoneManager.cpp:1472-1485`.

## 2.2 Heightmap-Generierung

### Pro-Zone-Aufbau (`HeightmapBuilder.cpp:146-239`)
- Die 4 **Eckbiome** der Zone werden an den Weltpositionen Zentrum−32, +64x, +64z, +64xz bestimmt.
- Pro Vertex (65×65): Weltposition `baseWorldPos + (rx, ry)`.
- Alle 4 Eckbiome gleich → direkt `GetBiomeHeight`; sonst **bi-lineares Blending der 4 Eckhöhen**, `tx = rx/64`, `ty = ry/64`, bei aktivem `worldBlendBiomesSmoothStep` (Default **true**) durch `SmoothStep(0,1,t)` (`HeightmapBuilder.cpp:176-219`). Mistlands-Maske wird in `m_vegMask` (64×64) gespeichert.

### Perlin-Noise (Unity-exakt)
`VUtilsMath.cpp:202-233`: klassischer Perlin mit **fester Permutationstabelle** (2×256 Einträge, beginnt `151,160,137,91,90,15,...`), Fade `6t⁵−15t⁴+10t³`, 16-Gradienten, Rückgabe **`(res + 0.69) / 1.483`** → [0,1]. Validierungswerte gegen Unity: `data/tests/perlin_values.txt`. Hilfsfunktionen: `LerpStep`, `SmoothStep`, `MathfLikeSmoothStep` (`t = −2t³+3t²`), `Fbm`, `Remap`, `BlendOverlay`.

### Seed-Offsets (`GeoManager.cpp:35-69`)
Aus `World.m_seed = get_stable_hash(seedName)` (djb2-Variante: 5381-Start, `num = (num<<5)+num ^ c`, Ergebnis `num + num2*1566083941`, `Hashes.h:16-41`) wird ein Unity-kompatibler **xorshift-RNG** (`VUtilsRandom.cpp:53-112`, Multiplikator `0x6c078965`, `next_float = (next_int() & 0x7FFFFF) * 1.192093e-7f`) gezogen: `m_offset0..m_offset4` je ∈ [−10000, +10000], plus `m_riverSeed`, `m_streamSeed`. Alle Noise-Felder addieren **+100000** auf die Koordinaten (Perlin nutzt `abs()`).

### GetBaseHeight (`GeoManager.cpp:481-524`)
Eingang `dwx = wx + 100000 + m_offset0`, `dwy = wy + 100000 + m_offset1`:
```
h  = P(x·0.001, y·0.001)·P(x·0.0015, y·0.0015)
h += P(x·0.002, y·0.002)·P(x·0.003, y·0.003) · h · 0.9
h += P(x·0.005, y·0.005)·P(x·0.010, y·0.010) · 0.5 · h
h -= 0.07
v  = |P(x·0.0005+0.123, y·0.0005+0.15123) − P(x·0.0005+0.321, y·0.0005+0.231)|
n6 = (1 − LerpStep(0.02, 0.12, v)) · SmoothStep(744, 1000, dist)   // "Kanal"-Zerre
h *= (1 − n6)
// Weltrand: dist>10000 → Lerp(h, −0.2, ...); dist>10490 → Lerp(→ −2.0)
// Berg-Deckel nahe Zentrum: dist < minMountainDistance && h>0.28 → Lerp(0.28..0.38)
```

### Biom-Höhenformeln (jeweils +100000 + `m_offset3`; Ergebnis ×200) — `GeoManager.cpp`

- **Meadows** (`GetMeadowsHeight`, 603-636): `n = P(0.01)·P(0.02) + P(0.05)·P(0.1)·n·0.5`; `h = base + n·0.1`; Absenkung über 0,15: `h -= (h−0.15)·(1−Clamp01(base/0.4))·0.75`; dann `AddRivers`; `+ P(0.1)·0.01 + P(0.4)·0.003`.
- **Plains** (688-712): identisch zu Meadows.
- **BlackForest** (`GetForestHeight`, 638-655): `h = base + n·0.1` (**ohne** die 0,15-Absenkung); `AddRivers`; `+ P(0.1)·0.01 + P(0.4)·0.003`.
- **Swamp** (`GetMarshHeight`, 586-601): Start **0,137**; `+ P(0.04)·P(0.08)·0.03` (hier +100000 **ohne** offset3!); `AddRivers`; Feinschliff wie oben.
- **Mountain** (`GetSnowMountainHeight`, 865-886): `h = base + (base−0.4) + n·0.2`; `AddRivers`; `+ P(0.1)·0.01 + P(0.4)·0.003 + P(0.2)·2.0·BaseHeightTilt` (Tilt = Summe |Δh| über 4 Nachbarn ±1 m).
- **DeepNorth** (888-908): `h = base + max(0, base−0.4) + n·0.2`; **`h *= 1.2`**; `AddRivers`; Feinschliff.
- **Mistlands** (657-686): `n2 = P(0.014)·P(0.028) + P(0.021)·P(0.035)·n2·0.5`; `n2>0 → pow(n2,1.5)`; `h = base + n2·0.4`; `AddRivers`; Terrassierung `h = Lerp(h + P(0.4)·0.002, ceil(h·400)/400, n3)` mit `n3 = Clamp01(n2·7)`.
- **Ocean** (844-852): nur `GetBaseHeight` (kein AddRivers, da `worldRiverAffectsOcean=false`).
- **Ashlands** (715-826): komplexester Modus — **aktiv ist "modern noise"** (`worldAshlandsModernNoise=true`) mit **FastNoise** (seed=0, FBM, Cellular Euclidean, Jitter 0,45; Port aus `FastNoise.h/cpp`), 5 Cellular-Oktaven, Overlay-Blends, Lava-Maske, Senken. Legacy-Modus existiert für alte Welten.

### Flüsse & Seen (`GeoManager.cpp:92-474`)
- **Seen**: Punktraster 128 m; `GetBaseHeight < 0.05` → Merge mit Radius 800.
- **Flüsse** (219-252): verbinden Seen, maxDistance 2000 (Fallback 5000); Breite 60–100 m; `curveWidth = Länge/15`, `curveWavelength = Länge/20`; Kurvenoffset `d = sin(t)·sin(t·0.63412)·sin(t·0.33412)·curveWidth`.
- **Bäche** (151-179): 3000 Versuche; Start 26–31 m, Ende 36–44 m Höhe, Länge 80–200 m, Breite 20 m.
- **AddRivers** (528-584): Gewicht `w = max(1 − dist/width)`; Zielhöhen `Lerp(0.14,0.12,t)` / `Lerp(0.139,0.128,t)` mit `t = LerpStep(20,60,width)`; schneidet Flussbetten in die Höhe.

### Finale Höhenabfrage
- `Heightmap::Regenerate` kopiert Base-Heights 1:1; Ozeantiefe an Ecken = `max(0, 30 − cornerHeight)` bilinear (`Heightmap.cpp:72-127`).
- `GetWorldHeight`: bei `worldBilinearHeightSampling=false` (**aktiv**) **nearest vertex**; sonst Triangle-baryzentrisch.
- Vegetation nutzt **`GetWorldHeightRaycast`** (Möller-Trumbore auf 2-Triangle-Quads, `Heightmap.cpp:598-697`) via `GetGroundData` (`ZoneManager.cpp:1399-1425`).

## 2.3 Biom-System

**Enum** (`Types.h:117-139`): Meadows=1, Swamp=2, Mountain=4, BlackForest=8, Plains=16, AshLands=32, DeepNorth=64, (128 unbenutzt), Ocean=256, Mistlands=512. BiomeArea: Edge=1, Median=2, Everything=3.

**Entscheidungslogik** `GetBiome(wx, wy)` (`GeoManager.cpp:958-1006`), strikt in dieser Reihenfolge, mit `num = WorldAngle·100`, `WorldAngle = sin(atan2(wx,wy)·20)`:

| # | Biom | Bedingung |
|---|---|---|
| 1 | AshLands | `magnitude(x, y−4000) > 12000 + num` |
| 2 | Ocean | `baseHeight ≤ 0.02` |
| 3 | Mountain/DeepNorth | `magnitude(x, y+4000) > 12000 + num`: base>0,4 → Mountain, sonst DeepNorth |
| 4 | Mountain | `baseHeight > 0.4` |
| 5 | Swamp | `P(0.001 + offset0) > 0.6` ∧ `2000 < dist < 6000` ∧ `0.05 < base < 0.25` |
| 6 | Mistlands | `P(0.001 + offset4) > 0.4` ∧ `6000+num < dist < 10000` |
| 7 | Plains | `P(0.001 + offset1) > 0.4` ∧ `3000+num < dist < 8000` |
| 8 | BlackForest | `P(0.001 + offset2) > 0.4` ∧ `600+num < dist < 6000` |
| 9 | BlackForest | `dist > 5000 + num` |
| 10 | Meadows | Fallback |

Versionsabhängig (WorldGen=2, aktuell): `minMountainDistance=1000`, `minDarklandNoise=0.4`, `maxMarshDistance=6000`.

**BiomeArea**: 9 Punkte im ±64-m-Raster; alle gleich → Median, sonst Edge (`GeoManager.cpp:929-949`).

**Wald-Faktor** (1098-1108): `GetForestFactor = Fbm(pos·0.004, 3 Oktaven, Lacunarity 1.6, Gain 0.7)`; `InForest` ⇔ Faktor < 1,15.

## 2.4 Vegetation / Feature-Platzierung

### Vegetation-Loop (`ZoneManager.cpp:625-819`, `PopulateFoliage`)
Pro Zone und Vegetations-Eintrag (nur wenn Zone das Biom hat):
- **Seed**: `worldSeed + zoneID.x·4271 + zoneID.y·9187 + prefab->m_hash` (Z. 644) → deterministisch pro Zone+Prefab.
- **Anzahl**: `m_max < 1` → Chance; sonst `range(min, max+1)`. **Versuche**: `forcePlacement ? n·50 : n`.
- **Gruppen**: `groupCount = range(groupSizeMin, groupSizeMax+1)`, Folgepunkte im `groupRadius`.
- **Pro Instanz**: `rot_y = range(0,360)`, **`scale = range(m_scaleMin, m_scaleMax)`**, `rot_x/z = range(±randTilt)` (Z. 683-688).
- **Checks**: Biom-Bitmaske + BiomeArea, **Altitude relativ zu Wasser 30** (`m_minAltitude/maxAltitude`), Mistlands-VegMask, Ozeantiefe, Neigung (`cos(tilt)`), TerrainDelta (10 Stichproben), ForestFactor, ClearAreas + `m_radius`-Abstand zu bereits Platziertem.
- **Platzierung**: `snapToWater → y=30`; `y += groundOffset`; GroundTilt-Rotation; **Scale nur setzen wenn ≠ Prefab-Default** (Z. 800-802).

### Konkrete Vegetations-Werte (aus `data/vegetation.pkg`, 120 Einträge) — Bäume-Auswahl

| Prefab | Biom | Stück/Zone | **ScaleMin–Max** | Altitude | Radius |
|---|---|---|---|---|---|
| **Beech1** | Meadows | 40 | **0,8 – 1,5** | 0,2 – 1000 | 0,95 |
| Birch1 | Meadows | 5 | 0,5 – 1 | 0,2 – 1000 | 0,95 |
| Birch1_aut / Birch2_aut | Plains | 30 / 10 | 0,5–1 / 1–1,5 | 0,1 – 1000 | 0,95 |
| Oak1 | Meadows | 0–1 | 0,8 – 1 | 0,5 – 1000 | 2,2 |
| **FirTree** | BlackForest | 40 (+5) | **2,0 – 2,5** | 0,1 – 1000 | 1,1 |
| FirTree | Mountain | 5–20 | 1,5 – 3 | 2 – 280 | 1,1 |
| **Pinetree_01** | BlackForest | 60 | **1,0 – 2,5** | 0,1 – 1000 | 0,95 |
| FirTree_small | BlackForest | 30–60 | 0,3 – 0,7 | 0,5 – 1000 | 1,1 |
| FirTree_small_dead | Swamp | 60 | 0,3 – 0,8 | 0,5 – 1000 | 1,1 |
| SwampTree1 | Swamp | 40 | 0,7 – 1,3 | −0,5 – 1000 | 1,1 |
| SwampTree2 | Swamp | 10–20 | 1,5 – 2 | −0,5 – 1000 | 2,2 |
| Beech_small1/2 | Meadows | 80–100 | 1 – 1,5/2 | 1 – 1000 | 0,7 |
| Bush01 | Meadows | 60–80 | 1 – 1,5 | 1 – 1000 | 0,7 |
| shrub_2 | BlackForest | 100 | 0,5 – 1 | 1 – 1000 | 0,7 |
| AshlandsTree1-6 | Ashlands | 2–10 | 0,7 – 2,5 | 1 – 12 | 0 |

**→ Die entscheidende Erkenntnis: Eine Schwarzwald-Tanne ist im Original 10,89 m × (2,0–2,5) = 22–27 m hoch; eine Kiefer 24–61 m; eine Buche 24–46 m.** Die Browser-Hints (8–10 m) liegen um Faktor ~3–6 daneben.

Felsen (Auswahl): rock4_coast (Küsten-Biome, 3 St., 0,6–1,2, Alt −2..−0,5, Gruppen R=20), MineRock_Tin (BF, 20 St., Alt −0,6..1,5), Rock_4 (Swamp/Meadows/BF, 0–40 St., Scale 1–3), Rock_3 (Scale 2–6!), silvervein (Mountain, Alt 120+).

### Locations (`ZoneManager.cpp:977-1155`, `data/features.pkg` — 146 Locations)
- **Seed pro Feature**: `worldSeed + feature.m_hash`; Zonen-Ziehung uniform in [−range/64, range/64), verworfen ab 10000 m; range inkrementiert bei `centerFirst`.
- Bis zu **20 Punktversuche** pro Zone im ±(32 − locationRadius)-Quadrat.
- Checks: min/maxDistance, Biom, **Altitude relativ Wasser 30**, inForest, TerrainDelta über `exteriorRadius`, `minDistanceFromSimilar`.
- Beispiele: StartTemple (Meadows, Qty 1, centerFirst), Eikthyrnir (3, maxDist 1000), Vendor_BlackForest (10, unique), SunkenCrypt4 (Swamp, **175 Stück**, minSim 64), TarPit1-3 (Plains, je 100), ShipWreck01-04 (je 25, snapToWater).
- ClearArea für Vegetation = `exteriorRadius` oder `level_radius` aus **`data/terrain_modifiers.yml`**.

## 2.5 Prefab-Skalierung (`data/prefabs.pkg`, 3447 Prefabs)

Format: `name` + `hash` + `localScale`(3×float) + `flags`(int64). Relevante Werte:

- **1,1,1**: FirTree, Pinetree_01, PineTree, Beech1, Birch1/2, Oak1, SwampTree1, Beech_small, Bush01…
- **Abweichend**: SwampTree2 = **1,5**, FirTree_small = **0,5**, Rock_3/Rock_4 = **2**, AshlandsTree6 = 1,5, AshlandsTree6_big = 2, SwampTree2_log = 2
- **Effektive Weltgröße** = GLB-Naturgröße (enthält Prefab-Kind-Transforms) × gezogener Zufalls-Scale aus vegetation.pkg (ZDO-Key `"scale"`).

## 2.6 Datenquellen im C++-Server

| Datei | Inhalt | Status |
|---|---|---|
| `data/vegetation.pkg` (14,8 KB) | **120** Vegetations-Definitionen, Version 0.221.6 | aktiv |
| `data/prefabs.pkg` (147 KB) | **3447** Prefabs (Name/Hash/LocalScale/Flags) | aktiv (bereits als `prefabData.json` portiert ✓) |
| `data/features.pkg` (1,4 MB) | **146** Locations inkl. Pieces + RandomSpawns | aktiv |
| `data/dungeons.pkg` | Dungeon-Räume | aktiv |
| `data/randomEvents.pkg` | Random Events | aktiv |
| `data/randomspawn.pkg` (167 KB) | — | **ungenutzt** (Altbestand) |
| `data/terrain_modifiers.yml` | level_radius/offset/smooth pro Location | aktiv |
| `data/location-overrides.yml` | Altitude-/Terrain-Overrides | aktiv |
| `data/tests/perlin_values.txt` | Unity-Perlin-Referenzwerte | **ideal als Port-Test!** |
| Hardcoded | Alle Weltgeometrie-/Biom-/Höhen-Parameter in `GeoManager.h:44-112` + Formeln in `GeoManager.cpp` | — |
| `data/server.yml` | Seed `KxSYuZquuw`, biome-blend-smoothstep=**true**, bilinear-height-sampling=**false**, ashlands-modern-noise=**true**, river-affects-ocean=false | aktiv |

---

# Teil 3: Umsetzungsplan (Vorschlag)

## Leitprinzipien

1. **Worldgen-Code in `shared/` legen** — Client und Server nutzen denselben deterministischen Generator (wie im Original: der Client generiert Terrain selbst, der Server nur für Platzierung/Physik). Kein Heightmap-Streaming nötig.
2. **Exaktheit durch Tests**: `perlin_values.txt` als Golden-Master; zusätzlich Referenz-Höhen/Biome-Grids aus dem C++-Server exportieren und gegen den TS-Port testen (gleicher Seed `KxSYuZquuw` → identische Welt).
3. **Reihenfolge: erst Mathe, dann Höhen, dann Platzierung** — jede Phase ist einzeln testbar.

## Phase A — Sofort-Fix: Modell-Darstellung (P0, klein) 🌲

*Behebt das sichtbare Tannen-/Proportions-Problem ohne Weltgenerierung.*

| # | Aufgabe | Datei | Aufwand |
|---|---|---|---|
| A1 | **Höhen-Normalisierung entfernen** — Modelle mit natürlicher GLB-Größe rendern; `HINT_DEFS`-Höhen nicht mehr als Scale-Quelle nutzen; Fallback = `prefabData.localScale` | `client/src/engine/Renderer.ts` Z. 283–293, `shared/src/prefabs.ts` | S |
| A2 | **Material-Fix für Laub**: beim Laden `alphaTest ≈ 0.5` (Alpha-Cutout) + `side = DoubleSide` auf Materialien mit Alpha-Textur (Pine_tree, beech_leaf, …) | `client/src/engine/AssetManager.ts` Z. 63–70 | S |
| A3 | **Zufalls-Rotation + Scale vom Server**: Demo-Spawn mit zufälliger Y-Rotation und Scale (vorläufige Tabelle aus vegetation.pkg-Werten: FirTree 2,0–2,5, Pinetree_01 1,0–2,5, Beech1 0,8–1,5), als ZDO-Member `"scale"` speichern (Flag `SYNC_INITIAL_SCALE` nutzen) | `server/src/ValhallaServer.ts` Z. 137–189 | S |
| A4 | **Client wendet ZDO-Scale + Rotation an** (statt Hints) | `client/src/engine/Renderer.ts` | S |

**Erwartetes Ergebnis**: Tannen 22–27 m hoch mit korrekter Silhouette (Cutout-Nadeln), Buchen 24–46 m — Wald sieht aus wie Valheim.

**Status: ✅ umgesetzt (22.07.2026)** — A1–A4 implementiert und gebaut. Bekannter Restfehler, siehe "Bekannte Einschränkungen" unten (Cutout-Schatten).

## Phase B — Mathe-Fundament portieren (P0) 🧮 ✅ **erledigt (2026-07-23)**

| # | Aufgabe | C++-Referenz | Aufwand |
|---|---|---|---|
| B1 | `util/Random.ts` — Unity-xorshift-RNG (Multiplikator `0x6c078965`, `next_float = (next_int() & 0x7FFFFF) · 1.192093e-7f`), inkl. exakter `range()`-Semantik | `VUtilsRandom.cpp:53-145` | S |
| B2 | `util/Perlin.ts` — Unity-exakter Perlin: feste Permutationstabelle, Fade `6t⁵−15t⁴+10t³`, Normierung `(res+0.69)/1.483`. **Test gegen `data/tests/perlin_values.txt`** | `VUtilsMath.cpp:202-233` | S |
| B3 | `util/Mathf.ts` — LerpStep, SmoothStep, MathfLikeSmoothStep, Fbm, Remap, BlendOverlay | `VUtilsMath.cpp:56-125, 267-281` | S |
| B4 | Seed-Hash prüfen: `getStableHash` ist bereits verifiziert — sicherstellen, dass derselbe djb2-Algorithmus für den Welt-Seed genutzt wird | `Hashes.h:16-41` | XS |
| B5 ✅ | `util/FastNoise.ts` — Port (seed=0, Cellular/FBM) — nur für Ashlands; **erledigt (2026-07-24)**, s. Status-Update unten | `FastNoise.h/cpp` | M |

## Phase C — GeoManager portieren (P0) 🌍 ✅ **erledigt (2026-07-23)**

| # | Aufgabe | C++-Referenz | Aufwand |
|---|---|---|---|
| C1 | `shared/src/worldgen/GeoManager.ts`: Konstanten (`GeoManager.h:44-112, 212-214`), Seed-Offsets (offset0–4, river/stream-Seed), WorldAngle | `GeoManager.cpp:35-69, 476-479` | S |
| C2 | `GetBaseHeight` inkl. Kanal-Zerre, Weltrand, Berg-Deckel | `GeoManager.cpp:481-524` | M |
| C3 | Biom-Höhenformeln ×200: Meadows/Plains, BlackForest, Swamp, Mountain, DeepNorth, Mistlands, Ocean (Ashlands zunächst Legacy oder Stub) | `GeoManager.cpp:586-908` | M |
| C4 | `GetBiome` — Entscheidungslogik in exakter Reihenfolge + BiomeArea | `GeoManager.cpp:929-1006` | M |
| C5 | Seen/Flüsse/Bäche-Generierung + AddRivers | `GeoManager.cpp:92-474, 528-584` | L |
| C6 | **Test-Harness**: C++-Server um Debug-Export erweitern (Grid von (x,z) → Höhe/Biom für Seed `KxSYuZquuw`) → TS-Test bis auf Float-Epsilon identisch | — | M |

## Phase D — Terrain: Server + Client (P0) 🏔️ ✅ **erledigt (2026-07-23)**

| # | Aufgabe | Referenz | Aufwand |
|---|---|---|---|
| D1 ✅ | `shared/src/worldgen/Heightmap.ts`: 65×65-Grid pro Zone, Eckbiom-Blending mit SmoothStep auf tx/ty, vegMask | `HeightmapBuilder.cpp:146-239` | M |
| D2 ✅ | Höhen-Abfrage: nearest-vertex (bilinear=false ist aktiv) + Triangle-Raycast (Möller-Trumbore) für GroundData | `Heightmap.cpp:514-697` | M |
| D3 ✅ | **Client-Terrain durch echte Worldgen ersetzt**: `client/src/engine/Terrain.ts` — Chunk-Mesh pro Zone (65² Vertices, C++-Dreiecksteilung), distanzsortierte Bau-Queue (≤1 Chunk/Frame), Radius 4 Zonen, LRU über den geteilten HeightmapProvider | ersetzt `Renderer.ts` Z. 146–191 | L |
| D4 ✅ | **Wasser**: transparente Ebene bei y=30, folgt dem Spieler auf dem 64-m-Raster, dezente CPU-Sinus-Wellen (phasenstabil über Weltkoordinaten) | `ZoneManager.h:186` | S |
| D5 ✅ | Biom-Färbung: Vertex-Farben aus echtem `getBiome` pro Vertex + Strand-Sand an der Wasserlinie, Fels an steilen Hängen (Normal.y), Schnee über 80 m, Tiefen-Tönung unter Wasser | — | M |
| D6 ✅ | Server: GeoManager+HeightmapProvider in `init()` (~1,3 s), **ServerConfig-Paket** (Typ 52: worldName, seed, genVersion, Flags-Byte) bei Auth, Spawn y=Bodenhöhe, Gravitation (Fall 15 m/s, Boden-Snap) in `handlePlayerInput`, Demo-Welt auf echter Höhe; Client baut aus dem Paket den identischen GeoManager | `ValhallaServer.ts` | M |

## Phase E — Vegetationssystem (P1) 🌳

**Status: ✅ umgesetzt (2026-07-23)** — E1–E5 implementiert, Server-Determinismus getestet (bit-identisch), Browser-Test siehe Status-Update unten.

| # | Aufgabe | Referenz | Aufwand |
|---|---|---|---|
| E1 ✅ | **vegetation.pkg → JSON** exportiert: `tools/prefab-parser/parse-vegetation.ts` → `shared/src/vegetationData.json` (120 Einträge, Kommentar „01.04.2026", Version 0.221.6); Registry `shared/src/vegetation.ts` (`FOLIAGE` in pkg-Reihenfolge — wichtig für die placedAreas-Overlap-Reihenfolge —, `FOLIAGE_HASHES` für Client-Instancing) | `data/vegetation.pkg`, `ZoneManager.cpp:166-227` | S |
| E2 ✅ | `server/src/world/ZoneManager.ts`: PopulateFoliage-Port — Seeds (`(seed + zx·4271 + zy·9187 + prefabHash)\|0`, int32-Wrap), Gruppen, alle Checks (Biom/BiomArea über **Zonen-Ecken-Gewichtung** der Heightmap, Altitude rel. Wasser 30, vegMask, OceanDepth, Tilt via `GetWorldNormal`, TerrainDelta via **rohem** `geo.getHeight`, ForestFactor, ClearAreas/Overlap), rng-Ziehreihenfolge vor den Checks, `rot_y` als **int**-Range, ZDO mit Quaternion-Rotation (Euler bzw. GroundTilt-LookRotation) + `scaleScalar` nur bei Abweichung vom Prefab-Default, SYNC_INITIAL_SCALE-Pfad | `ZoneManager.cpp:625-819`, `1399-1425` | L |
| E3 ✅ | Zonen-Generierung um Spieler — C++-Wahrheit ist **Radius NEAR+DISTANT = 4** (9×9 = 81 Zonen, Zentrum zuerst; der Plan-Eintrag „Radius 2" war zu knapp), `is_inside_world_radius` (164), Queue mit 12-ms-Zeitbudget/Tick statt C++-Blocking; ZDO-Registrierung über ZDOManager (Sync-Radius 3 deckt Versand ab) | `ZoneManager.cpp:538-590`, `ZoneManager.h:183-184` | M |
| E4 ✅ | **Client: Instancing** — `client/src/engine/Vegetation.ts`: Vegetations-ZDOs (`FOLIAGE_HASHES`) als **InstancedMesh global pro Prefab** (nicht pro Zone — Zonen-Batches wären wieder tausende Draw Calls), eine InstancedMesh je GLB-Quellmesh, Matrix = T·R·S × meshLokal; Placeholder-Box bis GLB geladen; Dirty-Rebuild gedrosselt (250 ms, ≤3/Frame), Kapazität in 64er-Schritten; y kommt jetzt autoritativ vom Server (kein Client-Terrain-Resampling mehr) | — | M |
| E5 ✅ | `spawnDemoWorld` entfernt (Aufruf + Methode) — die Welt wird jetzt ausschließlich vom Vegetationssystem bevölkert | — | XS |

## Phase F — Locations & Co. (P2) 🏛️

| # | Aufgabe | Referenz | Aufwand |
|---|---|---|---|
| F1 ✅ | features.pkg → JSON: `tools/prefab-parser/parse-features.ts` → `shared/src/featuresData.json` (**146 Features, 23 228 Pieces**, 12 054 mit RandomSpawn-Block — RandomSpawns per uint16-Index in Pieces gemergt, C++-Semantik); Registry `shared/src/features.ts` (`FEATURES` **in pkg-Reihenfolge** — Platzierungsreihenfolge ist determinismus-relevant) | `ZoneManager.cpp:48-157` | M |
| F2 ✅ | Location-Platzierung in `server/src/world/ZoneManager.ts`: `prepareFeatures()` (PostGeoInit-Port, einmalig beim Start: pro Feature `State((seed+hash)\|0)`, GetRandomZone mit int-Division `(int)range/64`, 20 Punkt-Versuche, Checks in C++-Reihenfolge: Distanz → Biom (GeoManager, nicht Heightmap!) → Altitude (Override-aware) → Forest → **unbedingter** GetTerrainDelta (10 rng-Züge auch bei 0/0-Limits!) → Surrounding-Check → DistanceFromSimilar), `tryGenerateFeature` (ClearAreas: `m_clearArea`→exteriorRadius, sonst `terrain_modifiers.yml` level_radius; **randomRotation ist in C++ zeit-geseedet → absichtlich nicht welt-deterministisch**, gespiegelt), `generateFeature` (alle Pieces spawnen — chanceToSpawn wird in C++ nie ausgewertet; DUNGEON-Pieces gezählt+übersprungen bis Phase G; `pos + quat·piece.pos` f32; snapToTerrain-Override; LocationProxy-ZDO mit `location`/`seed`-Ints), `removeUngeneratedFeatures` (unique); PopulateZone-Reihenfolge Features→Foliage mit ClearAreas. Configs: `parse-yml-configs.ts` → `terrainModifiers.json` (35) / `locationOverrides.json` (ShipSetting01), `locationConfig.ts` (hash-keyed wie C++) | `ZoneManager.cpp:856-1360`, `TerrainModifier.cpp` | L |
| F3 ✅ | StartTemple + Runestones sichtbar: Pieces laufen über den normalen ZDO→GLB-Pfad; `LocationProxy` in `isRenderable` als unsichtbar markiert (Unity generiert daraus clientseitig Modelle — unser Server schickt die Pieces direkt) | — | S |

## Phase G — Danach (P2+)

- **WorldManager**: Persistenz (Save/Load, zstd) ✅ **G1 erledigt (2026-07-24)** — GlobalKeys noch offen (mit RandomEvents)
- ~~**Ashlands modern noise** (FastNoise B5) + Lava-Maske~~ ✅ **B5 erledigt (2026-07-24)** — golden verifiziert, s. Status-Update unten
- ~~**Terrain-Texturierung** (Original-Tiles + Splat-Shader)~~ ✅ **G-TEX erledigt (2026-07-24)** — s. Status-Update unten
- ~~**Streaming/Pop-in** (Fern-Terrain-Ring, Nebel, Queue-Priorisierung, Preload)~~ ✅ **G-POP erledigt (2026-07-24)** — s. Status-Update unten
- **RandomEvents, Dungeons**
- ~~**Kreaturen-Spawner**~~ ✅ **G2 erledigt (2026-07-25)** — server-seitiges Spawn-System + Wander/Flucht, s. Status-Update unten
- ~~**Boden-Vegetation (Gras-Clutter)** + **Wasser-Textur**~~ ✅ **G-VEG/G-WAT erledigt (2026-07-25)** — prozedurales Gras-System + Wasser-Normal-Map, s. Status-Update unten
- **Asset-Optimierung**: Draco/KTX2-Kompression (4,8 GB GLBs → streamingtauglich), Audio-Export (3318 .ogg liegen bereit), LODs nutzen (vorhandene `*_lod_02`-Modelle)
- **Wind-/Vertex-Color-Shader** (COLOR_0 fehlt in GLBs — ggf. aus AssetRipper-Export nachrüsten)

## Abhängigkeits-Graph

```
A (Modell-Fix)        ── sofort, unabhängig
B (Mathe) ──► C (Geo) ──► D (Terrain) ──► E (Vegetation) ──► F (Locations)
                                        ──► E4 Instancing (FPS!)
```

**Empfohlener Start**: Phase A (1 Session, sofort sichtbare Besserung) → B+C mit Test-Harness (Kern der 1:1-Treue) → D (erste echte Welt im Browser) → E (Wald wie im Original).

## Status-Update (2026-07-23): Phase B+C abgeschlossen und gegen C++ verifiziert ✅

**Phase B** (B1–B4): `shared/src/worldgen/Random.ts` (Unity-xorshift, Golden-Test bit-exakt), `Perlin.ts` (Unity-exakt, max. Abw. 2,3e-7), `Mathf.ts` (LerpStep/SmoothStep/Fbm/Remap/BlendOverlay), `getStableHash` gegen C++ `get_stable_hash` verifiziert.

**Phase C** (C1–C6): `shared/src/worldgen/GeoManager.ts` — vollständiger 1:1-Port von `IGeoManager` inkl. Float32-Emulation (`Math.fround` pro Operation) und aller C++-Eigenheiten (int-Offsets, `float min()`-Init in GetTerrainDelta, f32-Literal-Vergleiche, Legacy-Ashlands-Branch in float32).

**C6-Verifikation** (Seed `KxSYuZquuw`, WorldGen v2, server.yml-Flags): Neues, rein additives Export-Tool `valhalla_geo_export` im C++-Repo (`library/test/geo/`, **keine Änderung an Server-Sourcen**) schreibt `geo_structure.csv` / `geo_riverpoints.csv` / `geo_samples.csv`; TS-Harness `shared/test/geo-compare.ts` vergleicht bitgenau (ULP-Distanz auf f32-Bitmustern):

| Kategorie | Ergebnis |
|---|---|
| Offsets / riverSeed / streamSeed | **bit-exakt** |
| 118 Seen, 148 Flüsse, 2044 Bäche (Positionen, Breiten, Kurven) | **bit-exakt** (23 038 Werte) |
| 689 278 Flusspunkte in 23 954 Grids (Reihenfolge inkl.) | 689 230 bit-exakt, **48 Punkte 1 ULP** (6 eindeutige Weltpositionen × Fan-out — `sinf/cosf` vs. `Math.sin/cos` Rundungsdifferenz im letzten Bit) |
| 963 259 Samples: biome / biomes / biomeArea | **bit-exakt** |
| baseHeight / genHeight / height / mask | bit-exakt, je **≤1 Sample 1 ULP** (Perlin) |
| riverWeight / riverWidth | bit-exakt bis auf **4 Samples**, alle nachweislich Propagation der 1-ULP-Punkte (`geo-correlate.ts`), Verstärkung durch ÷w bei schmalen Bächen (w=20) |
| forestFactor / inForest | **bit-exakt** |

Fazit: gleiche Seed → **identische Welt** (Abweichungen ≤1 ULP an 7 Weltpositionen, physikalisch ≈0,2 mm). ~~AshLands-Höhe (moderner FastNoise-Pfad) bleibt Phase B5 — 91 307 AshLands-Zellen werden bei height/mask übersprungen~~ **seit B5 (2026-07-24) werden auch die 91 307 AshLands-Zellen bei height/mask verglichen** — bit-exakt bis auf das dokumentierte libm-Band an der Lava-Schwelle (max Diff 1,81e-5 m); biome/baseHeight/genHeight dort waren schon vorher bit-exakt.

**⚠️ Nebenbefund — vermuteter Bug im C++-Server (`GeoManager.cpp` `GetBiomes`):** `Biome(to_underlying(GetBiome(...)) || ...)` nutzt logisches `||` statt bitweisem `|` → Rückgabe ist immer nur `None(0)` oder `Meadows(1)`, nie eine Bitmaske. Im Original-Unity-Code war es `|`. Wir haben den Fehler 1:1 portiert (mit Warnkommentar); die korrekte Variante liegt als `getBiomesMask()` daneben. Falls der C++-Server `GetBiomes` irgendwo produktiv nutzt (z. B. Vegetations-Checks), entscheiden, ob dort gefixt wird — der Browser-Port folgt dann nach.

## Status-Update (2026-07-23): Phase D1/D2 abgeschlossen und gegen C++ verifiziert ✅

**D1/D2**: `shared/src/worldgen/Heightmap.ts` — 1:1-Port von `IHeightmapBuilder::Build` (65×65 Vertices/Zone, Eckbiome, SmoothStep-tx/ty, Double-Lerp-Ketten, f32-Store) plus `HeightmapProvider` (LRU 512 Zonen) mit `GetWorldHeight` (nearest-vertex, bilinear=false) und Möller-Trumbore-Raycast.

Das Export-Tool schreibt jetzt zusätzlich `geo_zones.csv` (16 Zonen × [4 Eckbiome + 4225 Heights + 4096 vegMask] über den echten C++ `IHeightmapBuilder::Build`); `shared/test/heightmap-compare.ts` vergleicht:

| Kategorie | Ergebnis |
|---|---|
| Eckbiome (4 × 16 Zonen) | **bit-exakt** |
| baseHeights (67 600 Vertices, 16 Zonen) | **bit-exakt (4225/4225 in jeder Zone)** |
| vegMask, 4 Multi-Biom-Zonen (16 384 Werte) | **bit-exakt** |
| vegMask, 12 Single-Biom-Zonen | übersprungen — siehe C++-Bug #2 unten |
| Sanity `getGroundHeight(0,0)` | = Zonen-Vertex [32,32] ✓ |

**⚠️ Nebenbefund #2 — zweiter vermuteter Bug im C++-Server (`HeightmapBuilder.cpp:195`):** Der Single-Biom-Fastpath deklariert `float mask;` **uninitialisiert** und speichert den Wert danach als `mistlandsMask`/vegMask. `GetBiomeHeight` schreibt die Maske aber nur für Mistlands/AshLands — für alle anderen Biome landet nicht-deterministischer Stack-Müll in `BaseHeightmap::m_vegMask` (Undefined Behavior). Der Multi-Biom-Pfad initialisiert korrekt `float mask1 = 0, …, mask4 = 0`. → TS folgt dem initialisierten Verhalten (Mask=0); der Harness vergleicht vegMask nur auf Multi-Biom-Zonen. Praktisch folgenlos, solange die Maske nur für Mistlands-Features gelesen wird, aber im C++-Server fixenswert (`float mask = 0.f;`).

## Status-Update (2026-07-23, später): Phase D komplett ✅

**D3–D6 umgesetzt und getestet:** Der Client rendert jetzt die **echte Welt** statt der sin/cos-Plane — pro Zone ein 65×65-Chunk aus dem D1-verifizierten Heightmap-Port, mit Wasser (y=30) und Biom-Färbung. Der Server betreibt denselben GeoManager/HeightmapProvider als Boden-Wahrheit: Spawn auf echter Bodenhöhe, Gravitation (15 m/s Fall, Boden-Snap), Demo-Objekte auf Terrain. Beim Login schickt der Server das neue **ServerConfig-Paket** (Typ 52: worldName, seed, worldGenVersion, Worldgen-Flags) — der Client baut daraus bit-identisch dieselbe Welt.

**Tests:** `tsc --noEmit` in shared/server/client sauber · geo-smoke Determinismus OK · **C6 geo-compare: ALL CHECKS PASSED** · **D1 heightmap-compare: ALL ZONES PASSED** · **D6-Smoke (`server/test/d6-smoke.ts`): ALL PASSED** (init ohne Port-Bind, ground(0,0)=36,052, Gravitation konvergiert) · `vite build` erfolgreich.

## Status-Update (2026-07-23, abends): Phase E komplett ✅

**E1–E5 umgesetzt.** Der Server bevölkert die Welt jetzt exakt wie der C++-Server: `ZoneManager.ts` portiert `PopulateFoliage` 1:1 (alle 120 vegetation.pkg-Einträge in pkg-Reihenfolge, pro-Eintrag-RNG mit `(seed + zx·4271 + zy·9187 + prefabHash)|0`, rng-Ziehreihenfolge **vor** den Platzierungs-Checks, `rot_y` als int-Range `[0,360)`, TerrainDelta gegen das rohe `geo.getHeight` mit `float::min()`-Init, Biom-Check über die Zonen-Ecken-Gewichtung der Heightmap — nicht das GeoManager-Biom). Spieler getriebene Zonen-Generierung mit Radius NEAR+DISTANT=4 (81 Zonen, Zentrum zuerst), `is_inside_world_radius` (164²), Queue mit 12-ms-Budget/Tick. Der Client rendert Vegetation als InstancedMesh pro Prefab (~1 Draw Call pro Art statt ~1 pro Objekt).

**Tests:** `tsc --noEmit` shared/server/client sauber · **E2/E3-Smoke (`server/test/e2-vegetation.ts`): ALL PASSED** — 81 Zonen um Spawn in ~2,4 s, **9 112 ZDOs** (3 805 Bäume), Neuaufbau der Welt **bit-identisch** (voller ZDO-Dump: Prefab, Position, Rotation, Members), Platzierungs-Sanity (endliche Positionen, plausible Skalen), Zonen-Tracking (Radius-4-Grenzen, Welt-Radius-Reject, Idempotenz, +9 Zonen bei Spieler-Bewegung eine Zone ostwärts) · D6-Smoke weiterhin grün · `vite build` erfolgreich.

**Verifikations-Lücke (bewusst offen):** Die Platzierung ist deterministisch und algorithmisch 1:1, aber noch **nicht golden gegen den C++-Server getestet** (anders als C6/D1). Für einen Bit-Vergleich müsste das Export-Tool die vom C++-Server tatsächlich gespawnten Vegetations-ZDOs (Prefab, Position, Rotation, Scale) für ein Zonen-Set dumpen. Kandidat für eine spätere E-Verifikation.

## Status-Update (2026-07-24): Phase F komplett ✅ (F1–F3)

**Locations sind da.** Der Server bucht beim Start einmalig **11 397 Feature-Instanzen** (C++ `PostGeoInit`/`PrepareFeatures`: pro Feature ein eigener RNG-Strom `(seed+hash)|0`, Zone-via-int-Division, 20 Punkt-Versuche mit exakter C++-Check-Reihenfolge inkl. des **unbedingten** GetTerrainDelta-rng-Konsums pro Kandidat) und materialisiert sie zonenweise (`TryGenerateFeature` → Pieces + LocationProxy → ClearAreas → Vegetation). StartTemple steht in Zone (0,0) bei (6,9 / 37,0 / 6,9) — mit 23 Pieces (5 BossSteine + Deko), Runestones/WoodHouses/Eikthyrnir-Altäre in den umliegenden Zonen.

**Drei C++-Erkenntnisse, die den Port prägen:** (a) Location-`randomRotation` nutzt einen **zeit-geseedeten** Default-RNG — die Rotation (und damit die Piece-Transforms rotierbarer Locations) ist in C++ absichtlich **nicht** welt-deterministisch; wir spiegeln das. (b) `randomSpawn.chanceToSpawn` wird in C++ zwar geparst, aber **nie ausgewertet** — alle Pieces spawnen immer. (c) `PrepareFeatures` läuft global **vor** jeder Zonen-Generierung; ClearAreas (features.pkg `clearArea`→exteriorRadius, sonst `terrain_modifiers.yml` level_radius) unterdrücken Vegetation in den Lichtungen.

**Tests:** `tsc --noEmit` shared/server/client sauber · **F2-Smoke (`server/test/f2-locations.ts`): ALL PASSED (19 Checks)** — 11 397 Instanzen **bit-identisch** über zwei frische Welten; StartTemple Zone/Position/Altitude; 23 Pieces + LocationProxy mit `location`/`seed`-Ints; Piece-Positionen matchen pkg-Offsets exakt (rotationsfreie Location); Vegetation außerhalb von Location-Footprints bit-identisch; Proxies bit-identisch; Piece-Prefab-Multimenge identisch; **keine echte Vegetation im 16-m-Radius um den Tempel** (ClearArea wirkt: 9 112 → 8 686 Vegetations-ZDOs) · E2/E3-Regression weiterhin grün (9 112 — der E2-Test fährt bewusst ohne prepareFeatures) · `vite build` erfolgreich.

**Verifikations-Lücke (wie bei E):** Platzierung deterministisch + algorithmisch 1:1, aber nicht golden gegen C++-ZDO-Dumps getestet. ~~AshLands-Locations nutzen Legacy-Höhen (B5-Lücke) und weichen dort vom C++-Server ab~~ **seit B5 (2026-07-24) laufen die Altitude-/TerrainDelta-Checks in AshLands auf den C++-exakten modernen Höhen.**

## Status-Update (2026-07-24): F4-Nachbesserung — Terrain-Leveling + statisches Instancing ✅

**Zwei vom Nutzer gemeldete Phase-F-Regressionen behoben.**

**(a) Schwebende Location-Pieces (bis ~4,9 m an Hängen) — Ursache: fehlendes Terrain-Leveling.** Im Original ebnest die Unity-Client-Komponente `TerrainModifier` den Boden unter Locations auf ein Plateau (Zentrumshöhe + `levelOffset`); der C++-Referenzserver implementiert das **nicht** (sein `TerrainModifier.cpp` liefert nur ClearArea-Parameter) und die Diagnose (`debug-float.ts`) wies exakt dieses Muster nach: Feature-Zentren perfekt (±0,1 m), Pieces bis 4,89 m über Grund. Neu: `Heightmap.heights` = `baseHeights` + beim Zonen-Build **gebackenes** Leveling (Unity-Formel: Plateau im `levelRadius`, Blend-Band `t=((dist−r)/smoothRadius)^smoothPower`, `square`-Norm als Chebyshev-Distanz), mit identischer shared-Mathe auf Server (Ground Truth: Spieler-Physik, Vegetations-Raycast) und Client (Chunk-Meshes). `baseHeights` bleibt pristine (D1-Goldentests, oceanDepth, C++-Parität). Parameter-Regel (`getTerrainLeveling`): `terrain_modifiers.yml` (35 Features) → yml-Werte; sonst `clearArea` ⇒ levelRadius=exteriorRadius + C++-Defaults (−0,2 / 7 / 3 / square). Registrierung beim Generieren (`tryGenerateFeature`, Zielhöhe = gebuchte Geo-Höhe + levelOffset); der Client leitet denselben Modifier aus dem LocationProxy-ZDO (`location`-Int-Member) ab und baut betroffene Chunks neu. **Tempel-Messung: alle 23 Pieces exakt auf pkg-Offset über dem Plateau (Invarianten-Verletzung 0,0000 m; max |piece−ground| = 0,200 m = der designede Einbett-Offset, vorher 2,40 m Hang-Fehler).**

**(b) FPS 200+ → 40 im Stehen — Ursache: ~800 Location-Pieces als Einzel-`THREE.Group` mit SkeletonUtils-GLB-Klonen (Multi-Mesh) → tausende Draw Calls + Shadow-Pass.** Der E4-VegetationInstancer wurde zum generellen **`StaticInstancer`** verallgemeinert: alles Statische (Vegetation **und** Location-/Bau-Pieces — die Prefab-Mengen überlappen, z. B. Pickable_Stone als Tempel-Deko und Foliage) landet in globalen per-Prefab-InstancedMesh-Buckets (~1 Draw Call pro Art × GLB-Teil-Mesh). Legacy-Einzelpfad nur noch für Player, Kreaturen (MONSTER_AI/ANIMAL_AI), Schiffe, Türen und nicht-renderbare Prefabs.

**Tests:** `tsc --noEmit` shared/server/client sauber · **F4-Smoke (`server/test/f3-leveling.ts`): ALL PASSED** — Leveling-Regel (yml / clearArea / keins), synthetischer Modifier (Plateau exakt, Band monoton, Fernfeld unverändert, square- vs. Radial-Norm), Tempel-Integration (Spawn-Plateau f32-exakt, 23 Pieces ohne Hang-Fehler) · **F2-Regression: ALL PASSED (19/19)** mit aktivem Leveling — 9 499 ZDOs (8 675 Vegetation, 798 Pieces, 26 Proxies), Vegetation außerhalb der Footprints weiterhin **bit-identisch** über zwei frische Welten (Leveling ist deterministisch) · E2/E3 (9 112 Baseline) + D6 grün — D6 läuft jetzt mit `worldFeatures:false` (1,5 s statt ~76 s; dort generiert keine Zone, daher greift kein Leveling und der D1-Goldenwert 36,052 bleibt gültig) · `vite build` erfolgreich.

## Status-Update (2026-07-24): MMORPG-Kamera + Admin-Modus (Fly) + Weltkarte ✅

**Drei Komfort-Features vor Phase G — zum Anschauen und Bewerten der Welt.**

**(1) Kamera mit Pitch + Zoom.** Die Third-Person-Kamera ist jetzt ein sphärischer MMORPG-Orbit um den Kopf: yaw aus Maus-X, Pitch (Elevation, ±~80°) aus Maus-Y (`consumeMouseDelta().dy` existierte bereits ungenutzt), Distanz über das Mausrad (2–16 m). Die Kamera kollidiert mit dem Terrain (`cam.y ≥ getTerrainHeight(cam) + 0,5`). Bewegung bleibt yaw-relativ (MMORPG-üblich).

**(2) Admin-Modus als erweiterbares Konzept, erste Funktion: Fly (Taste Z).** Neues Packet-Paar `AdminCommand` (Client→Server, eine Kommandozeile wie `"fly"` — später `"teleport x y z"`, `"god"`, …) und `AdminEvent` (Server→Client: command/active/message, damit der HUD exakt den Server-Zustand spiegelt). Serverseitig dispatcht eine **`AdminCommandRegistry`** (`server/src/admin/AdminCommands.ts`) auf registrierte Handler; die **einzige Permission-Stelle** ist `canUseAdminCommands(peer)` → `peer.isAdmin` — das Flag setzt der NetManager bereits aus `players.everyone-admin` (steht auf `true`, also faktisch ungeschützt wie gewünscht; zum Schärfen genügt später die Config + Admin-Liste). **Fly ist server-autoritativ** (`peer.flying`): `handlePlayerInput` schaltet dann auf freien Flug ohne Gravitation/Ground-Clamp (horizontal + vertikal via neuem `moveY`-Feld, 12 m/s, mit Shift 30 m/s, Sicherheits-Clamp y ∈ [−100, 2000]) — weil Zonen-Generierung und ZDO-Streaming spielerpositions-getrieben sind, folgen sie dem fliegenden Admin automatisch. Fly aus ⇒ Gravitation greift sofort wieder. Clientseitig: Z togglet, HUD-Badge „🕊 FLY“, Space hoch / Ctrl/C runter, Toast mit der Server-Meldung.

**(3) Weltkarte auf Taste M.** Reines Client-Feature: der Client besitzt seit D6 denselben deterministischen GeoManager wie der Server (ServerConfig-Seed) — `geo.getBiome(wx, wz)` liefert also für **jede** Weltposition das echte Biom, ohne Server-Roundtrip. Das Overlay rendert progressiv (halbe Auflösung im Offscreen-Canvas, ~12 Zeilen/Frame aus dem GameLoop, danach hochskaliert geblittet ⇒ kein Frame-Hitch) ein 4096-m-Fenster um die Spielerposition in den Terrain-Biomfarben (`BIOME_COLORS` aus Terrain.ts), Norden oben (= −Z), mit yaw-rotiertem Spieler-Pfeil (pro Frame aus dem gecachten ImageData neu gezeichnet). Öffnen verlässt den Pointer-Lock; M/Esc schließt. Kein Fog-of-War, kein Pan/Zoom (v1).

**Protokoll:** Das PlayerInput-Wire-Format wurde um `lookPitch(f32)`, `moveY(f32)` und `jumping(bool)` erweitert (das Interface kannte die Felder schon; lookPitch/jumping werden serverseitig vorerst nur gelesen) — Client und Server müssen versionsgleich sein (gleiches Repo, kein Kompatibilitätslayer).

**Tests:** `tsc --noEmit` shared/server/client sauber · **G1-Smoke (`server/test/g1-admin-fly.ts`): ALL PASSED (15 Checks)** — Registry (Toggle an/aus, unbekannter Command, Permission-Gate admin/nicht-admin), Gravitations-Pfad (Fallen mit 15 m/s, Landung f32-exakt auf dem D1-Goldenwert 36,052), Fly-Pfad (Schweben ohne Gravitation, ±30/12 m/s vertikal, kein Ground-Clamp unter Terrain, 30 m/s horizontal mit Shift, Sicherheits-Clamp 2000, Gravitation nach Fly-Off) · D6- und F4-Regression grün · `vite build` erfolgreich.

## Status-Update (2026-07-24): Phase G1 — Persistenz (WorldManager) ✅

**Die Welt überlebt jetzt Server-Neustarts.** Der `saveWorld()`-Stub ist eine echte Implementierung nach dem C++-Vorbild (`WorldManager.cpp::WriteFileDB/LoadFileDB`): periodisch alle 30 min (`save-interval`), beim Shutdown — und beim Start wird der Save wieder geladen.

**Format.** Eigenes JSON-Envelope, zstd-komprimiert über `node:zlib` (nativ seit Node 22.15, keine neue Dependency) als `server/data/worlds/<world>.db.zst`. Inhalt spiegelt die C++-Dateien: `meta` ≙ `.fwl` (worldName, seed, worldGenVersion), `worldTime`, `zones` (generierte Zonen ≙ `ZoneManager::Save`), `players[]` (Positionen/Fly-Status per Name), `zdos[]` (persistente ZDO-Snapshots ≙ `ZDOManager::Save`). Schreiben ist atomar (tmp + rename), der vorherige Stand rotiert nach `.prev` (C++: `.db-<ts>.zstd`-Backups). Fehlende/korrupte Datei oder Seed-/Versions-Mismatch ⇒ frische Welt (geloggt).

**Persistenz-Filter nach C++-Semantik.** Der Kniff: das `ZDOFlags.PERSISTENT`-Instanz-Flag setzt bei uns nie jemand — in C++ liefert `ZDO::IsPersistent()` deshalb auch nicht das Flag, sondern `GetPrefab().IsPersistent()` (ZDO.h:1146). Also filtert `saveWorld()` über den **Prefab** (`prefabs.getByHash(z.prefabHash)?.isPersistent()`): Bäume, Felsen, Büsche, Pieces, Schiffe, StartTemple, BossSteine, Schatztruhen etc. überleben; vergängliche Proxies je nach Flag. **Charakter-ZDOs von Spielern sind explizit ausgenommen** (Ghost-Schutz): ihre Owner-Session endet mit dem Shutdown, ein geladener Charakter-ZDO läge nach dem Restart als Geist neben dem frischen, den jeder Peer beim Connect bekommt. Positionen + Fly-Status leben stattdessen in `players[]` und werden beim Authentifizieren per Name zugeordnet (Spawn am letzten Standort statt am Starttempel); `onPeerQuit` merkt den Stand auch schon innerhalb einer Session.

**Die Load-Falle: F4-Terrain-Leveling.** Geladene Zonen werden als generiert markiert (kein Re-Generate ⇒ keine Duplikate — die Objekte kommen aus dem Save), aber damit läuft `tryGenerateFeature` nie — und genau dort wurden die Terrain-Modifier registriert. Ohne Gegenmaßnahme stünden nach jedem Restart die Location-Pieces wieder schwebend auf dem ungeebneten Hang. `ZoneManager.restoreGeneratedZones()` replayt deshalb die zwei Generierungs-Seiteneffekte, die außerhalb der ZDO-Menge leben: (1) Terrain-Modifier für gebuchte Feature-Instanzen in den geladenen Zonen (Block in `registerTerrainModifier` refaktoriert, von beiden Pfaden genutzt) und (2) Unique-Buchhaltung (Haldor): `prepareFeatures` bucht beim Boot deterministisch alle Instanzen neu, die bei der Erst-Generierung entfernten müssen wieder entfernt werden — sonst könnte ein zweiter Haldor spawnen. **Nebeneffekt: `randomRotation` ist jetzt über Restarts stabil** (C++-Parität, s. Einschränkung 13/22).

**Tests:** `tsc --noEmit` shared/server/client sauber · **G1-Smoke (`server/test/g2-persistence.ts`): ALL PASSED (20 Checks)** — Server A generiert Zone (0,0) (Tempel + Foliage), setzt worldTime, injiziert Spieler ⇒ Save-Envelope exakt (meta/worldTime/zones/players/zdos, 216 persistente ZDOs, kein Player-ZDO, .prev-Rotation); frischer Server B lädt: worldTime (Tag 6), Zone als generiert, alle 216 ZDOs, **Spawn-Plateau f32-exakt wieder geebnet** (36,7898 — Modifier-Replay), Spieler-Position/Fly-Status; `zones.update` im geladenen Zentrum erzeugt **kein** Duplikat (63→63 ZDOs, 1→1 Proxy); Seed-Mismatch und korrupte Datei ⇒ jeweils sauber frische Welt · g1/d6/f3-Regression grün · `vite build` erfolgreich.

## Status-Update (2026-07-24): Phase B5 — Ashlands FastNoise + Lava-Maske ✅

**Der letzte Worldgen-Blindflug ist geschlossen.** `shared/src/worldgen/FastNoise.ts` ist ein 1:1-Port des **originalen** FastNoise aus dem Valheim-Client (kein FastNoiseLite): 2D-Simplex (F2/G2, ×50) und Cellular (Euclidean-Distance, **quadriert** — ohne sqrt, jitter `f32(0,45)`), FBM mit `++seed` pro Oktave und lacunarity 2 / gain 0,5, der C++-Hash mit int32-Überlauf über `Math.imul`, `fastFloor` ≠ `Math.floor` (abweichend bei negativen Ganzzahlen). Die 256 Einträge der CELL_2D-Tabelle wurden maschinell gegen den C++-Header diffiert (**identisch**). Konstruktion exakt wie GeoManager.cpp:62-91: seed=0 (nicht Welt-Seed), `setFrequency(f32(0,01))`, 2 Oktaven. (3D-Tabellen weggelassen — keine Aufrufer.)

`GeoManager.getAshlandsHeightModern` portiert GeoManager.cpp:736-825 Zeile für Zeile mit f32/f64-Disziplin an jeder C++-Cast-Stelle: value-Rim-Kurve (12 000-m-Rand, magnitudeF-Args als f32), 10 150-m-Band, Shift `+= f32(100000 + offset3)`, zwei Cellular-Oktavenschleifen (5× ab 0,33·2ⁱ, 3× ab 8·2ʲ), blendOverlay/mathfLerp/smoothStep-Kette, Simplex-Fraktal-Multiplikator, fbm-Plateau, die **Lava-Maske** `blendOverlay(num18, num14) · clamp01((num12−0,17)/0,01)` (fließt über den bestehenden vegMask-Kanal wie die Mistlands-Maske) und den Boden-Absenker nahe der Baseline. `getBiomeHeight` nutzt im modernen Modus diesen Pfad (×200 als f32); die **Fluss-Generierung** (`preGeneration=true`) bleibt wie in C++ immer Legacy — als identisch in beiden Modi verifiziert.

**Flag mit C++-Parität an:** `experimental-ashlands-modern-noise: true` ist C++-Default (ValhallaServer.cpp:415 + C++ server.yml:35) — jetzt auch bei uns (DEFAULT_CONFIG true, main.ts `?? true`, server.yml-Schlüssel ergänzt); der bisherige Start-Downgrade auf Legacy ist entfernt.

**B5-Verifikation.** Zwei Harness-Fixes waren nötig, keiner im Port: (a) der geo-compare-Header-Parser verwarf die Mehrfach-`k=v`-Zeile `# riverAffectsOcean=0 ashlandsModernNoise=1 disableDistantRivers=0` und fuhr **stumm im Legacy-Modus** (jetzt whitespace-tokenisiert + Flags-Echo); (b) die Smoke-Testgrids mussten auf `Biome.AshLands` filtern — die Mistlands-vegMask ist vorzeichenbehaftet (−0,2) und teilt sich den Kanal. Endergebnis `geo-compare` über **963 259 Samples: ALL CHECKS PASSED** — `height[Ash]` 91 307 Zellen (75 bit-exakt, 91 232 im Band, **max Diff 1,81e-5 m**), `mask[Ash]` 91 307 (88 412 bit-exakt, max 5,14e-7); alle anderen Spalten unverändert bit-exakt. Das neue Absolut-Band (`AbsCol`, ±1e-3 m / ±1e-4) trennt libm-Rauschen sauber von echten Port-Bugs: die Schwellen-Verstärkung `clamp01((num12−0,17)/0,01)` multipliziert unvermeidliches ±1-f32-ulp-Toolchain-Rauschen (MSVC sinf/pow vs. V8 Math.sin/pow) an Schwellenzellen ×100 — ein echter Bug läge meterweit daneben (Legacy vs. Modern: ~250 m).

**Tests:** `tsc --noEmit` shared/server/client sauber · **B5-Smoke (`shared/test/b5-ashlands-modern.ts`): ALL PASSED** — Flag-Dispatch (Legacy-Maske 0 / modern endlich), Maske ∈ [0,1] variierend, Relief > 5 m, preGeneration modus-identisch, modern ≠ legacy · geo-smoke, math-golden, d6, f3, g1, g2, e2, f2 alle grün · `vite build` erfolgreich.

**⚠️ Deployment-Hinweis:** ein im Legacy-Modus gestarteter Server (bestehender G1-Save) rendert AshLands erst nach einem **Neustart** modern. Terrain wird regeneriert, nicht gespeichert — der Save bleibt gültig; die AshLands-Topographie (und Location-Platzierungen dort) ändern sich beim Flag-Wechsel aber.

## Status-Update (2026-07-24): G-TEX (Original-Terrain-Texturen) + G-POP (Streaming/Pop-in) ✅

**Zwei Bausteine aus Phase G auf einen Schlag: die Welt sieht jetzt nach Valheim aus — und baut sich beim Überflug nicht mehr sichtbar „hinterher" auf.**

**(1) G-TEX — Original-Terrain-Texturen mit Splat-Shader.** Der AssetRipper-Export enthält die Original-Assets des Unity-Heightmap-Shaders: `terrain_d_array.png` (256×4096 = 16 gestapelte 256×256-Diffuse-Tiles = `_DiffuseArrayTex`) und `TerrainVarietyNoise.png` (512², = `_NoiseTex`) — jetzt unter `valheim_browser_assets/textures/`. Die 16 Tiles wurden über Durchschnittsfarben (Abgleich gegen die benannten `old/*.png`-Texturen) und Sichtprüfung identifiziert: 0 Gras, 1 Waldboden, 2 Erde, 3 gerodete Erde, 4 Fels, 5 Klippe, 6 Lava-Glut, 7 Asche, 8 Heide, 9 Sand, 10 Sumpfschlamm, 11 Moos, 12 Pflaster, 13 dunkler Sumpf, 14 Basalt, 15 Lava-Kruste; die Layer-Reihenfolge im Array ist numerisch verifiziert. Der Alpha-Kanal ist Unity-**Smoothness**, kein Maskenkanal — deshalb scheidet der DataArrayTexture-Weg aus (canvas-getImageData prämultipliziert und vernichtet bei niedrigem Alpha die RGB-Präzision); stattdessen **ein** 256×4096-`sampler2D` plus In-Shader-Layer-UV-Mathe mit 0,02-Inset gegen Mipmap-Bleeding. Der decompilierte `Heightmap.json`-Shader (900 KB) hat keine pro-Biom-Tile-Properties — die Biom→Tile-Zuordnung ist rekonstruiert (s. Einschränkung 5); Schnee/Fels sind im Original shader-prozedural (`_SnowNormal`/`_RockNormal`), `_UVScale` 0,5.

**Implementierung** (`client/src/engine/Terrain.ts`, Voll-Rewrite): Splat-Shader per `onBeforeCompile` auf dem bestehenden MeshStandardMaterial — Nebel, Schatten und ACES-Tonemapping bleiben erhalten. Die Splat-Gewichte kommen aus denselben **Zonen-Eckbiomen** wie der Heightmap-Blend (`cornerBiomes` × Smoothstep-tx/ty) ⇒ weiche Biomübergänge statt 1-m-Farbkanten. Vertex-Attribute: aTiles/aWeights (4 Eck-Tiles), aLava (B5-Lava-Maske aus der vegMask, AshLands-gegatet), aSnow, aRockTile. Im Fragment: Variety-Noise rotiert die Tile-UVs (`ang = nz.r·2π`) und moduliert die Helligkeit (`0,85+0,3·nz.g` — Original-Mechanik gegen Kachel-Sichtbarkeit), Sand-Band am Wasser, Fels-Blend auf steilen Flanken (`normal.y`), flachstellenabhängiger Schnee (Mountain > 80 m, DeepNorth) und **Lava**: Krusten-Tile 15 abgedunkelt + Emissive `pow(lk,3)·smoothstep(0,22;0,65;crust.r)·2,5` ⇒ die Risse glühen (Tile 15 ist die Graustufen-Emissionsmaske). Die bisherige CPU-Vertexfärbung bleibt als Fallback gebacken (`uSplatReady` blendet 0→1, sobald die Texturen geladen sind).

**(2) G-POP — Diagnose des „Welt baut sich merkwürdig auf".** Fünf zusammenwirkende Ursachen: (a) ZDO-`viewRadius` 3 (= 192 m) < Terrain-Radius 256 m ⇒ permanent ein objektfreier Ring am Rand; (b) die serverseitige Generierungs-Queue war FIFO und wurde nie neu sortiert oder gecullt — beim Flug sammelten sich hunderte Zonen hinter dem Spieler (~1 Zone/Tick bei ~30 ms/Zone), die Landschaft „holte auf" statt voranzugehen; (c) der StaticInstancer baute max. 3 Buckets/Frame mit 250-ms-Sperre ⇒ sichtbare Wellen; (d) Placeholder-Box→GLB-Doppel-Pop (GLBs wurden erst bei Bedarf geladen); (e) FogExp2 0,0015 ⇒ erst ~17 % Dämpfung an der 288-m-Kante — jedes Pop-in passierte praktisch unverhüllt, und jenseits der Terrain-Kante war nacktes Void sichtbar.

**Fixes.** ① **Fern-Terrain-Ring** (Valheim-`_IsDistantLod`-Analogon): 2×2-Zonen-Chunks, 4-m-Stride, Radius 10 (= 640 m), mit `FAR_BIAS = −0,35 m` unter das Detail-Mesh gelegt (kein Z-Fighting in der Überlappung); Hintergrund-Queue baut max. 1 Chunk/Frame und nur, wenn die Nah-Queue leer ist; kein Schattenwurf; gleicher Splat-Shader. Dazu **Fern-Wasser**: 2048-m-Plane knapp unter Wasserlevel, folgt dem Spieler auf einem 64-m-Raster. ② **Nebel dichter**: 0,0015 → 0,0028 Tag / 0,0032 Dämmerung / 0,0042 Nacht ⇒ ≈40 % Dämpfung an der 256-m-Nahkante, ≈96 % am 640-m-Ring. ③ **ZDO-viewRadius 3→4** (256 m = Terrain-Radius — der objektfreie Randring ist weg). ④ **Generierungs-Queue cullen + sortieren** (`ZoneManager.update`): Zonen mehr als 5 Zonen (Chebyshev) von allen Peers entfernt fliegen aus Queue+Pending, der Rest wird nach Distanz² zum nächsten Peer sortiert (in-place-Splice — `queue` ist `private readonly`); Zoneninhalte sind reihenfolge-unabhängig (Per-Zonen-Seeds), die Sortierung also sicher. ⑤ **Instancer-Throttle gelockert**: 250→150 ms, 3→6 Rebuilds/Frame. ⑥ **GLB-Preload**: ~43 häufige Vegetations-Prefabs (Bäume/Büsche/Felsen/Pickables der Startbiome) werden direkt nach dem ServerConfig-Packet geladen (0,1–0,7 MB/GLB, `AssetManager.preloadModels`) ⇒ der Placeholder→GLB-Doppel-Pop entfällt im Normalfall.

**Tests:** `tsc --noEmit` shared/server/client sauber · **G3-Smoke neu (`server/test/g3-streaming.ts`): ALL PASSED** — 81 Zonen enqueued (Budget 0), Teleport 10 Zonen ostwärts ⇒ Cull ≤5 Chebyshev + 81 neu enqueued + nächste Zone zuerst + pending konsistent, budgetierte Generierung (60 ms ⇒ 1 Zone, Queue 81→80) · **g2-persistence angepasst**: die strikte ZDO-Zähl-Gleichheit (63→63) gilt seit der Nearest-first-Sortierung nicht mehr — die zuerst generierten **Nachbar**zonen lassen Vegetation mit groupRadius legitim in die ZDO-Zone (0,0) hineinlaufen (63→191; C++-treu, halbzonen-versetzter ZDO-Raum, s. e2-vegetation). Die echte Invariante bleibt und wird jetzt als Multiset-Teilmengen-Check geprüft: alle geladenen ZDOs unverändert erhalten, keine Re-Generierung der restaurierten Zone (Proxies 1→1) · e2-vegetation, f2-locations, g1, d6, f3, geo-smoke, math-golden, b5 alle grün · `vite build` erfolgreich.

**⚠️ Deployment-Hinweis:** die serverseitigen G-POP-Änderungen (viewRadius 4, Queue-Cull/Sort) greifen erst nach einem **Server-Neustart**; die Client-Seite (Fern-Ring, Nebel, Texturen, Preload) läuft über den normalen Vite-Build/Reload.

## Status-Update (2026-07-24): G-TEX/G-POP-Regressionen behoben (3 kritische Client-Fixes) ✅

**Nach dem G-TEX/G-POP-Rollout meldete der Praxistest drei schwere Symptome: „Ich laufe in den Boden", „Bäume schweben/stecken falsch", „Texturen passen nicht zu den Biomen / Texturen fehlen". Alle drei auf Client-Seite lokalisiert (Server-Code geprüft, unverändert korrekt), per Headless-Playwright (SwiftShader) mit Vorher/Nachher-Screenshots verifiziert:**

**(1) Terrain-Mesh um 32 m gegen das Gameplay versetzt** (Ursache für „in den Boden laufen" + schwebende/versunkene Bäume + Textur-Biom-Mismatch an Geländekanten): `buildGridGeometry` setzte den Chunk-Ursprung auf `zone·64`, aber das Heightmap-Raster beginnt bei `zone·64 − 32` (C++: `baseWorldPos = ZoneToWorldPos(zone) + (−32,0,−32)`; Heightmap-Zone (zx,zy) spannt Welt [zx·64−32, zx·64+32] mit 65×65 Vertices, `worldToZone(w)=⌊(w+32)/64⌋`). Render-Mesh und `getGroundHeight` (Gravitation, Boden-Clamp, Vegetations-Snap) liefen also eine halbe Zone auseinander. Fix: Ursprung `zx0·64 − 32` (in beiden Achsen), Dokumentations-Kommentar im Code.

**(2) Fern-Ring-Chunks wurden im Nahbereich nie abgeräumt** (gleiche Symptome beim Laufen/Fliegen in die Distanz): `refreshFarChunks` verhinderte nur das *Einreihen* vollständig vom Nah-Quadrat abgedeckter Fern-Chunks — ein einmal in der Ferne gebauter Chunk (grob, 4-m-Stride, −0,35-m-Bias) blieb bestehen, wenn der Spieler hineinlief, und übermalte das Detail-Terrain. Fix: bestehende Fern-Chunks werden disposed, sobald sie vollständig nah-abgedeckt sind (alle 4 Zonen im Nah-Radius) **oder** außer Reichweite (Intervall-Distanz > FAR_RADIUS+1).

**(3) `flipY` spiegelte den 16-Layer-Tile-Stack** (Ursache für „alle Texturen falsch/fehlen"): `THREE.TextureLoader` lädt mit `flipY=true` — PNG-Zeile 0 (oben = Layer 0 Gras des 256×4096-Stacks) landete auf V=1 ⇒ der ganze Stack kehrte sich um und jedes Biom sampelte das gespiegelte Tile (Meadows → Layer 15 Lava-Kruste, daher „dunkler Boden überall" = die vermeintlich fehlenden Texturen). Fix: `array.flipY = false` beim Laden der Splat-Texturen. Screenshot-Beweis vorher/nachher: Spawn-Wiese Lava-Kruste → Gras.

**Verifikation (Headless-Playwright, SwiftShader-Flags `--enable-unsafe-swiftshader --use-angle=swiftshader`, ~1 FPS):** 4 Screenshots (Spawn/Luft/2× Hoch) — Meadows-Boden **grasgrün** statt Lava-Kruste, Spieler-Kapsel steht **auf** dem Boden, Luftaufnahme zeigt dichten Wald mit echten Tree-GLBs, der kohärent auf dem Terrain steht, Berge am Horizont + Fern-Ring intakt; **0 Konsolen-Fehler, 0 HTTP-4xx, 0 failed requests** (die im SwiftShader-Lauf sichtbaren „ston"-Placeholder-Boxen sind ein Rein-1-FPS-Artefakt — alle referenzierten GLBs existieren (7 463 Dateien geprüft) und werden per G-POP-Preload gewärmt; auf echter Hardware tritt der Box-Zustand nicht auf). Regressionssuite komplett grün: g2-persistence, g3-streaming, e2-vegetation, f2-locations (+ g1/d6/f3/geo/math/b5 unverändert) · `tsc --noEmit` ×3 sauber · `vite build` ok. **Die Fixes sind rein clientseitig — kein Server-Neustart nötig, Browser-Reload genügt.**

**Nebenbefund Referenz-Check (decompilierter Original-Client, `Heightmap.cs`):** die Original-Biom-Verdrahtung bestätigt unsere Splat-Architektur — die Vertex-`Color32` ist eine **Biom-Maske**, keine Farbe (Swamp=R, Mountain=G, BlackForest=B, Plains=A, AshLands=R+A, DeepNorth=G, Mistlands=B+A, Meadows/Ocean/None=(0,0,0,0)), geblendet via `Color32.Lerp` mit Smoothstep-Gewichten über die Zonen-Eckbiome — strukturell identisch zu unseren cornerBiomes×smoothstep-Gewichten in aTiles/aWeights. `s_biomeToIndex` dient im Original nur der Dominant-Biom-Abfrage, nicht den Tiles.

## Status-Update (2026-07-25): AssetLog — clientseitiges Lade-Fehler-Log + „Stat“-Würfel diagnostiziert ✅

**Anlass:** Am Eikthyrnir-Altar nahe dem Startkreis standen zwei große Placeholder-Würfel mit der Aufschrift „Stat“. Diagnose: **StatueDeer**-Prefabs (Altar-Statuen, `oldHash 222646934`). Das GLB (`StatueDeer.glb`, 0,7×2,5×2,3 m, 1 Mesh, eingebettete PNG) ist vorhanden, valide und lädt im Browser über den AssetManager einwandfrei (Live-Probe: `loadModel('StatueDeer')` → OK; frische Probe-Session rendert die Statue mit echtem Mesh, `sourceMeshes: 1`). Die betroffene Spielsitzung hatte den Ladeversuch also vermutlich einmalig fehlschlagen lassen — und der **Negative-Cache hielt den Fehlschlag dann für den Rest der Sitzung fest**: `loadModel` cached das Promise, ein `null`-Resultat blieb dauerhaft bestehen ⇒ permanenter Placeholder.

**Gegenmaßnahmen (rein clientseitig):**

1. **AssetLog-Modul** (`client/src/engine/AssetLog.ts`): zentraler Ring-Buffer (500 Einträge) für Asset-Ladefehler mit Dedupe (`kind|name|error|context`), Konsolen-Spiegelung (`console.warn('[AssetLog] …')`) und gebatchtem Versand (alle 5 s) per `POST /__asset-log`. Eintrag: `{t, kind: 'model'|'sprite'|'texture'|'prefab'|'other', name, url?, error?, context?}`.
2. **Vite-Datei-Senke** (`assetLogSink`-Plugin in `client/vite.config.ts`): hängt die Batches als **JSONL an `logs/client-assets.log`** an (eine Zeile pro Eintrag, `mkdirSync` angelegt). Dev-Server only; ohne Plugin (Production) bleiben die Einträge im clientseitigen Ring-Buffer.
3. **Verdrahtung an 4 Stellen:** `AssetManager.loadModel` + `loadSprite` (Fetch-/Parse-Fehler, mit URL), `Renderer.updateZDOEntity` (unbekannter Prefab-Hash — kein Registry-Eintrag), `Renderer.createZDOObject` + `StaticInstancer.setInstance` (Prefab ohne `model` in der Registry ⇒ permanenter Placeholder, wird jetzt sichtbar statt still).
4. **Negative-Cache-TTL** (`AssetManager.loadModel`): ein fehlgeschlagener Load wirft seinen Cache-Eintrag nach 30 s selbst weg — transiente Fehler (z. B. 404 während Asset-Austausch, Netzwerk-Flapper) heilen sich beim nächsten Zone-Stream von selbst statt die Sitzung zu vergiften.
5. **Debug-Handles:** `window.__renderer` und `window.__assetLog` (in `main.ts`) für Playwright-Probes und Devtools-Inspektion (`TS-private` Felder sind zur Laufzeit erreichbar).
6. **Placeholder zeigen jetzt den vollen Prefab-Namen** (Nutzerwunsch — vorher `name.slice(0,4)`, daher las man nur „Stat"): `getPlaceholder` passt die Schriftgröße automatisch an (64→26 px), bricht lange Namen an der besten camelCase-/Ziffer-/Trennzeichen-Grenze in zwei Zeilen um (`splitName`: „StatueDeer" einzeilig, „Pickable_Mushroom" → „Pickable"/„Mushroom", „BlueberryBush" → „Blueberry"/„Bush"), Canvas 128→256 px für schärfere Schrift, dunkler Text-Outline für Kontrast. Die deterministische Farbe pro Name bleibt.
7. **Placeholder-Retry (2026-07-25, nachgeliefert):** die TTL allein heilte nur *künftige* Loads — ein bereits als Würfel gerendertes Entity blieb sitzen, bis es zufällig neu streamte. Jetzt wiederholen beide Render-Pfade fehlgeschlagene Modell-Loads gebunden: `Renderer.createZDOObject` (pro Entity, Abbruch wenn entfernt) und `StaticInstancer.loadBucketModel` (pro Bucket, Abbruch wenn leer), je 10 Versuche × 35 s (`MODEL_RETRY_COUNT`/`MODEL_RETRY_DELAY_MS` aus AssetManager, > 30-s-TTL ⇒ echter Re-Fetch). End-to-End bewiesen per Playwright-Probe (`tools/pw-retry-probe.mjs`): erster `StatueDeer.glb`-Fetch forciert abgebrochen ⇒ Würfel + AssetLog-Eintrag; nach ~35 s tauscht der Retry den Würfel **in place** gegen das Statuen-Mesh, ohne Reload. Am GLB selbst lag es nicht: served-Datei und AssetRipper-Export sind byte-identisch (md5), strukturvalid (1 Mesh, eingebettete PNG) und HTTP 200 vollständig ausgeliefert — eine Neu-Extraktion war nicht nötig.

**Verifikation:** `tsc --noEmit` (client) sauber; Senke End-to-End getestet (POST → 204 → JSONL-Zeile in `logs/client-assets.log`); Kamera-Override-Probe (Playwright, Kamera manuell an den Statuen-Positionen platziert) liefert Vor-Ort-Screenshots + `__assetLog`-Auszug einer gesunden Session.

**Nebenbefund (betrifft nur Playwright-Screenshots):** beim SwiftShader-Lauf mit ~1 FPS hinkt die Orbit-Kamera (Lerp 0,1/Frame) einem fliegenden Spieler minutenlang hinterher — Fly-Screenshots zeigen dann nur Himmel. Für Vor-Ort-Aufnahmen `updatePlayer` per `__renderer` stilllegen und die Kamera direkt setzen (`tools/pw-cam-override.mjs`).

## Status-Update (2026-07-25): Phase G2 — Kreaturen-Spawner ✅

**Kontext/Entscheid:** Die C++-Referenz enthält **kein** server-seitiges Spawn-System — im Original spawnt der besitzende Unity-Client (Regeln in `ZoneSystem.m_spawnLists`, in keinem der beiden Repos vorhanden), der C++-Server repliziert nur die resultierenden ZDOs. Da unsere Browser-Architektur keinen privilegierten Client hat, läuft das Spawnen bei uns server-seitig — mit einer **autorierten** (nicht portierten) Tabelle, weil keine Referenzdaten existieren (Einschränkung #26).

**Was gebaut wurde:**

1. **Spawn-Tabelle** (`shared/src/spawnData.ts`): `SpawnEntry`-Schema + `SPAWN_TABLE` mit Deer (Meadows, flieht <10 m, beruhigt >40 m), Boar (Meadows, passiv), Greydwarf (BlackForest, passiv) — Ring-Spawn um Spieler (35–85 m), Gruppen 1–2 im groupRadius, Biom-Maske, Höhen-Gate (≥ 30,5 m = über WATER_LEVEL), Wander-/Flucht-Parameter; Konstanten Despawn 130 m / Sim 160 m / Sync 0,25 s. Tests injizieren Overrides per `SpawnSystemOptions`.
2. **SpawnSystem** (`server/src/world/SpawnSystem.ts`): pro Server-Tick (a) **Despawn** ohne Peer < 130 m (`destroyZDO` → Auto-Broadcast beim nächsten ZDO-Sync), (b) **Spawn-Würfe** pro Eintrag+Peer (Intervall-Akkumulator → Chance → Kappen maxPerPlayer/globalMax → Ring-Anker → Gates: Zone generiert (**HeightmapProvider.worldToZone-Konvention**), Biom-Schnittmenge, Boden ≥ minAltitude → Gruppen-Scatter mit Boden-Re-Check je Mitglied → `createZDO` mit Zufalls-Yaw), (c) **Wander-Simulation** (idle→walk zu Ziel im wanderRadius um den Home-Anker, Wasser-Ziele verworfen; Wasser-Deflexion erst X- dann Z-Komponente, sonst Halt; Deer-Flucht: direkt vom nächsten Peer weg mit runSpeed). Aktiv nur mit Peer < 160 m — sonst bit-genau ruhend (Positions-erhaltend).
3. **4-Hz-Sync-Drossel:** Positionen integrieren jeden Tick (30 TPS), `reviseData()` + dirty nur alle 0,25 s — der Revisions-Vergleich in `syncZDOs` (`peer.isOutdatedZDO`) ist das autoritative Wiederversand-Gate, dirty wird dort nicht konsultiert ⇒ flüssige Server-Simulation bei gedrosselter Bandbreite (~50–60 B/Update/Kreatur, ≈8–10 kB/s/Peer bei 40 Kreaturen).
4. **Persistenz/Adoption:** Kreaturen-Prefabs tragen PERSISTENT im pkg ⇒ fließen automatisch durch den G1-Prefab-Filter in den Save; `adoptPersisted()` nach `loadWorld()` registriert Bestands-ZDOs wieder (Spawn-Position = neuer Wander-Anker) — Kreaturen überleben Restarts und despawnen danach korrekt statt sich zu akkumulieren.
5. **Config:** `world.creatures` (server.yml, default true; `ServerConfig.worldCreatures`, `spawns === null` wenn aus).
6. **Client:** HINT_DEFS-Overrides — Boar→`Boar_0.glb`, Greydwarf→`greydwarf@Idle.glb` (die namensgleichen GLBs sind mesh-lose Bone-Rigs, Einschränkung #27); **Netz-Interpolation** im Legacy-Pfad (`zdoTargets`: Updates steuern nur das Ziel, `render()` gleitet mit exp. Glättung τ≈80 ms + `slerp` dahinterher, Snap >15 m gegen Teleport-Zucken) ⇒ weiche Kreatur-Bewegung trotz 4-Hz-Updates — Remote-Spieler profitieren mit (gleicher Pfad); Preload der 3 Kreatur-GLBs in `COMMON_PREFAB_MODELS`.

**Verifikation:** neuer Smoke-Test `server/test/g4-creatures.ts` — 12 Checks grün (Zone-Gate, Ring+Biom, kein Wasser, Biom-Gate Schwarzwald [4 Greydwarfs, 0 Deer/Boar], Kappen maxPerPlayer/globalMax, Despawn, Flucht 5→23 m + Beruhigung, Sim-Guard bit-genau [auch mit 0 Peers], Sync-Drossel Δ=12/30 Ticks aktiv / 0 ruhend, Determinismus 2× identische Welt+Dumps, Persistenz-Adoption 2/2 über Restart + Despawn der Adoptierten, Config-Gate) · Vollregression g1/g2/g3/d6/e2/f2/f3 grün · `tsc --noEmit` ×3 sauber · `vite build` ok.

**Live-Verifikation (2026-07-25, nach Server-Neustart):** Playwright-Probe gegen den laufenden Server (`tools/pw-creature-probe.mjs`) — **Deer- und Boar-ZDOs streamen innerhalb von Sekunden** nach dem Login (erste Sichtung: Deer auf (−39,4 / 47,7 / 56,1), ~68 m Ring-Distanz vom Spawn; Greydwarf korrekterweise 0 in den Meadows). Ein Zwischenbefund „keine Kreaturen" entpuppte sich als Bug im ersten Probe-Skript (Hook-Argumentreihenfolge von `updateZDOEntity(key, position, prefabHash, …)` verwechselt), nicht am Server — die Offline-Reproduktion mit dem echten Save (2 202 Zonen, 209 k ZDOs) spawnte sofort, alle Gates (Zone/Biom/Höhe) am Spawn-Ring verifiziert.

## Status-Update (2026-07-25): TimeSync-Bug — HUD-Uhr & Tag/Nacht-Beleuchtung froren beim Connect ein ✅

**Befund (via Daylight-Probe entdeckt):** die HUD-Uhr eines Clients blieb 30 Echt-Minuten exakt auf dem Connect-Zeitwert stehen. Ursache server-seitig: `update()` kommentierte „Send time sync every second", der Versand war aber **nie implementiert** — `PacketType.TimeSync` ging nur zweimal raus: beim Connect (initial) und bei `setTimeOfDay` (Broadcast). Die Client-Variablen `serverTimeOfDay`/`serverDay` behielten dadurch sitzungslang ihre Connect-Werte — und da `main.ts` jeden Frame `renderer.updateDayNight(serverTimeOfDay, …)` aufruft, fror nicht nur die Uhr, sondern die **gesamte Tag/Nacht-Beleuchtung** auf dem Connect-Zeitpunkt ein (wer nachts einloggte, spielte bis zum Reload in permanenter Nacht). Die Server-Weltzeit selbst lief korrekt weiter (`worldTime += deltaSec`, unabhängig von Peers) — die Clients erfuhren nur nichts davon.

**Fix:** `sendTimeSync(peer)`-Helper in `ValhallaServer.ts` (ersetzt die drei duplizierten Paket-Bausteine Connect/setTimeOfDay/neu) + **1-Hz-Broadcast am Ende von `update()`** (~20 B/s/Peer — vernachlässigbar; HUD-Auflösung ist ohnehin minütlich, Beleuchtungs-Schritte von 1 s sind unmerklich). `tsc --noEmit` sauber.

**Deployment/Verifikation:** Beim Wiederanlauf nach einem unerwarteten Prozess-Ende beider Dienste (s. unten) ging der Fix mit dem Server-Neustart **live** und ist in-session verifiziert (`tools/pw-clock-check.mjs`: HUD-Uhr läuft innerhalb einer Session weiter; Raten-Messungen sind auf dem live-Server nicht aussagekräftig, weil ein zweiter Spieler parallel per setTimeOfDay die Zeit stellt — Sprünge in beide Richtungen beobachtet). Die Daylight-Screenshots (Statue/Reh) wurden vor dem Neustart noch client-seitig erzwungen: die Probe wrappt `renderer.updateDayNight` mit fixem 10:00-Zeitwert (`tools/pw-daylight-shots.mjs`) — rein visuell, ohne Server-Eingriff.

## Status-Update (2026-07-25): „Permanente" Placeholder-Boxen aufgelöst — Logic-Prefabs sind jetzt unsichtbar ✅

**Befund (via Daylight-Proben):** in den Screenshots blieben ~10 % der StaticInstancer-Buckets dauerhaft als beschriftete Placeholder-Boxen stehen (allein um den Spawn-Meadows ~46 Boxen). Die Bucket-Diagnose (`tools/pw-deer-diag.mjs`) zeigte: **kein einziges Welt-Modell fehlt** — die roten „stonerock"-/„FirTree_oldLog"-Boxen der frühen Proben waren transiente Ladezustände der frischen SwiftShader-Session (heilen spätestens über den 35-s-Retry). Die sechs *wirklich* permanenten Placeholder sind ausschließlich **Logic-/Marker-Prefabs**, die auch in Valheim unsichtbar sind: `Music_MeadowsVillageFarm` (13×), `Spawner_Boar` (18×), `Spawner_Skeleton_night_noarcher` (4×), `BlackForestLocationMusic` (4×), `Flies` (1×) — plus `Pickable_DolmenTreasure` (6×, s. Einschränkung #31). Ursachen: vier haben **keine GLB im Export** (404 → Placeholder), zwei (`BlackForestLocationMusic`, `Flies`) haben **0-Mesh-GLBs** (leere Hierarchie-Exporte — Klasse wie Einschränkung #27, nur ohne Knochen).

**Fix:** `isRenderable()` in `shared/src/prefabs.ts` um die Namensmuster `Music_*`, `*LocationMusic`, `Spawner_*` (nur Präfix — sichtbare Prefabs wie `BonePileSpawner`/`CharredStone_Spawner` treffen nicht) und `Flies` erweitert ⇒ solche ZDOs bekommen gar keinen Bucket/Placeholder mehr. Live-verifiziert: Session-Buckets 60 → 55, permanente Placeholder 6 → 1 (nur noch DolmenTreasure). **Client-Reload (F5) nötig**, server-seitig keine Änderung.

**Visuelle Nachweise (Daylight-Proben, Lighting-Override 10:00):** `tools/out/day-statue.png` — die **geheilte StatueDeer** am Eikthyr-Altar als echtes GLB-Mesh (Hirschfigur mit Geweih, kein Würfel; Bucket `sourceMeshes: 1`); `tools/out/deer-E.png` — **G2-Reh mit geladenem `Deer.glb`** (Geweih-Modell, 5 Meshes) frei auf der Wiese. Probe-Details: das Reh wandert zwischen Kamera-Platzierung und Auslöser aus dem engeren Bildausschnitt (SwiftShader ~1 FPS) — die Probe friert das Reh-Objekt daher render-seitig ein (`matrixAutoUpdate=false`) und zielt auf die Live-Weltposition; frische Sessions zeigen Felsen/Logs noch einige Sekunden als Placeholder-Boxen (transient, heilt über Load/Retry — in den Reh-Aufnahmen teilsichtbar).

## Status-Update (2026-07-25): Letzte permanente Placeholder-Box (DolmenTreasure) behoben + doppelter Server-Prozess als Ursache für sporadische „StatueDeer"-Sichtungen gefunden ✅

**Auslöser:** Nutzer meldete live wieder eine große „StatueDeer"-Placeholder-Box am Spawn, obwohl der Bug laut Doku bereits gefixt war. Playwright-Live-Diagnose (verbunden, Buckets gedumpt, Kamera an die dokumentierte StatueDeer-Position gesetzt):

1. **StatueDeer selbst lädt einwandfrei** (Bucket `sourceMeshes: 1`) — kein Regressions-Bug an diesem Prefab. Ein Zwischen-Screenshot zeigte kurzzeitig große rote „stonerock"-Boxen (Rock_3/Rock_4 mitten im Ladevorgang direkt nach Connect) — transient, wenige Sekunden später `sourceMeshes: 1`, deckt sich mit der bekannten Pop-in-Klasse (Einschränkung #4/#9).
2. **Echter Befund: doppelter Server-Prozess.** Neben der offiziellen `dev:server`-Kette (`npm run dev:server` → `tsx watch src/main.ts`) lief ein verwaister zweiter Prozess `npm start` → `tsx src/main.ts` (ohne watch, `server/package.json`s `start`-Script) — beide auf demselben WS-Port. Das erklärt einen live beobachteten spontanen Disconnect während dieser Session (Buckets/ZDOs müssen nach Reconnect neu aufgebaut werden ⇒ kurzzeitig wieder sichtbare Placeholder-Boxen, u. a. potenziell StatueDeer, bis Preload/Retry erneut greifen). Fix: verwaisten Prozessbaum beendet, nur die offizielle Kette bleibt aktiv. Der Vite-Client-Prozess war ebenfalls bereits beendet (vermutlich beim selben Vorfall) und wurde neu gestartet.
3. **Letzte permanente Placeholder-Box:** `Pickable_DolmenTreasure` (Einschränkung #31) — 30 s nach Connect + Bucket-Scan bestätigte: einziger verbleibender Bucket mit `sourceMeshes: 0` (6 Instanzen). GLB-Inspektion (`tools/glb-inspect.js`) bestätigte einen 0-Mesh-Export (kein Material/Mesh, nur ein leerer Root-Node) — dieselbe Klasse wie die bereits gefilterten Logic-Prefabs. Da der Nutzer nun explizit **alle** nicht ladenden Prefabs gefixt haben wollte (nicht mehr „bewusst akzeptiert" wie zuvor entschieden), wurde `isRenderable()` in `shared/src/prefabs.ts` um `Pickable_DolmenTreasure` erweitert — konsistent mit der bestehenden Logic-Prefab-Filterung, und tatsächlich korrekter als vorher: in Vanilla Valheim ist dieser Pickup-Trigger ebenfalls unsichtbar (das sichtbare Loot ist die separate `treasure_pile`-Dekoration).
4. **Vollständigkeits-Audit:** neues Diagnose-Skript `tools/scan-missing-models.mts` (statischer Abgleich **aller** 3451 renderbaren Prefab-Definitionen gegen den Asset-Export: Datei fehlt vs. 0-Mesh-Export). Ergebnis: nur 2 echte 404s und 1458 0-Mesh-Exporte insgesamt — die überwiegende Mehrheit betrifft aber Prefabs, die vom aktuellen Server **nie als ZDO instanziert werden** (Waffen, Ragdolls, Partikel-Effekte, Kreaturen nicht-implementierter Biome, Dungeon-Loot-Container für noch nicht gebaute Locations wie SunkenCrypt/MountainCave/ForestCrypt — grep im Server-Code bestätigt: keine dieser Location-Typen ist implementiert). Diese sind daher **keine aktuell sichtbaren Bugs**, sondern vorgemerkt für die jeweilige Content-Phase (Einschränkung #14/#27/#29).

**Live-Verifikation nach Fix:** frischer Connect, 15 s Wartezeit, Bucket-Scan → **0 permanente Placeholder-Buckets** (vorher 1), 54 Buckets gesamt (Player: `Pickable_DolmenTreasure` fliegt jetzt komplett aus der Bucket-Liste statt als Box zu erscheinen). Keine AssetLog-Einträge in der Session.

## Status-Update (2026-07-25): Echter StatueDeer-Bug gefunden — `rebuildBucket()` tauschte die Placeholder-Box bei 1-Mesh-GLBs nie gegen das echte Modell ✅

**Nutzer meldete erneut:** „StatueDeer zeigt weiterhin die Box". Die vorigen zwei Fixes (doppelter Server-Prozess, DolmenTreasure-Filter) waren zwar echte Bugs, aber **nicht die Ursache** — Live-Diagnose direkt am StatueDeer-Bucket zeigte einen Widerspruch: `bucket.sourceMeshes.length === 1` (GLB **ist** korrekt geladen!), aber `bucket.meshes[0].geometry.type === 'BoxGeometry'` (der gerenderte Mesh ist **immer noch die Placeholder-Box**).

**Root Cause** (`client/src/engine/StaticInstancer.ts`, `rebuildBucket()`): die Bedingung, wann die Placeholder-Box durch die echten GLB-Meshes ersetzt wird, war
```
if (bucket.capacity < count || bucket.meshes.length !== bucket.sourceMeshes.length) { …neu aufbauen… }
```
Die Placeholder-Box besteht immer aus **genau 1** `InstancedMesh`. Hat das echte GLB ebenfalls **genau 1 Mesh** (wie `StatueDeer.glb`) und ist `capacity` bereits ≥ `count` (praktisch immer, weil die Placeholder-Phase die Kapazität schon hochgerundet hat), sind **beide Bedingungen falsch** ⇒ der Rebuild überspringt die Neuerstellung komplett und ruft nur `fillMatrices()` auf der **alten Box-Instanced-Mesh** auf. Damit bleibt die Box für jedes 1-Mesh-Prefab **für immer** stehen, sobald Kapazität + Mesh-Count zufällig übereinstimmen — unabhängig davon, ob das echte Modell erfolgreich geladen wurde. Multi-Mesh-Prefabs (Bäume mit 4–6 Meshes) waren nicht betroffen, weil `meshes.length` (1, Box) dort fast nie mit `sourceMeshes.length` übereinstimmt.

**Fix:** zusätzliche Prüfung `isPlaceholder = bucket.meshes[0]?.userData.disposable`, die bei jedem Rebuild erzwingt, dass eine noch als Placeholder geflaggte Instanced-Mesh durch die echten `sourceMeshes` ersetzt wird, sobald diese verfügbar sind — unabhängig von Kapazitäts-/Count-Zufällen.

**Live-Verifikation:** frischer Connect, Bucket-Dump zeigt `sourceMeshes: 1` **und** `meshInfo[0].geometryType: 'BufferGeometry'` (statt `BoxGeometry`); Screenshot am Eikthyr-Altar zeigt die echte Hirschfigur mit Geweih statt der Box. **Client-Reload (F5) nötig**, kein Server-Neustart.

**Reichweite:** dieser Bug betraf potenziell **jedes** statische Prefab mit genau 1 GLB-Mesh, dessen Bucket schon vor dem Laden Kapazität aufgebaut hatte (z. B. via Placeholder) — nicht nur StatueDeer. Der Fix behebt die Klasse, nicht nur den Einzelfall.

## Status-Update (2026-07-25): G-TEX2 — Biom→Tile-Zuordnung gegen Ground-Truth verifiziert + Normal-Map-Bump-Detail ✅

**Auftrag des Nutzers:** die eigene Engine soll sich „so nah wie möglich wie die Unity Engine" verhalten, „damit Texturen usw. dann auch richtig ausstehen". Ausgangspunkt war ein Audit des Terrain-Texturier-Pipelines gegen den C++-Server und den decompilierten Unity-Client.

**(1) Ground-Truth-Fund.** Der `Heightmap.json`-Shader-Blob (`Custom/Heightmap`, kompilierter `m_CompressedBlob`) ist nicht praktikabel zu HLSL zurückzuübersetzen — dieser Weg wurde verworfen. Der AssetRipper-Export enthält aber unter `tools/assetripper/export/Assets/world/terrain/array generation/` zusätzlich zum gestapelten `terrain_d_array.png` auch **einzeln benannte Slices** (`terraintile_0.png`…`terraintile_15.png`), die exakte, unabhängige Kopien der 16 Array-Layer sind. Sichtprüfung aller 16 Dateien gegen die bestehende `TILE`/`BIOME_TILE`-Zuordnung in `Terrain.ts`: **16/16 Treffer, 0 Abweichungen** — die zuvor als „hand-rekonstruiert, ggf. vertauscht" dokumentierte Zuordnung war die ganze Zeit korrekt und ist jetzt als verifiziert dokumentiert (Einschränkung 5).

**(2) G-TEX2 — Normal-Map-Bump-Detail.** Der Export enthält außerdem 3 Normal-Map-Tiles (`terraintile_n_0/1/2.png`, kein 16-Layer-Array wie beim Diffuse). Implementiert in `Terrain.ts`/`injectSplatShader()`: pro Eck-Tile wird eine von 3 Gruppen (flach/mittel/rau) über `tileNormalGroup()` bestimmt (Näherung — der Rip enthält keine Pro-Tile-Gruppenzuordnung), die 3 Gruppen-Samples werden mit denselben Eckgewichten wie der Diffuse-Pass geblendet und über eine tangentenfreie Screen-Space-Derivative-Technik (`dFdx`/`dFdy`, Christian Schülers Verfahren — dasselbe, das three.js intern für `USE_BUMPMAP` nutzt) auf die geometrische Normale aufmoduliert, da die Terrain-Chunks kein Tangent-Attribut führen. Eigenes `uNormalReady`-Gate (unabhängig von `uSplatReady`): ein Ladefehler bei den Normal-Tiles darf die kritische Diffuse-Splat-Aktivierung nie blockieren.

**(3) Geprüft und verworfen: Alpha-Kanal als Smoothness.** Der ursprüngliche Plan sah vor, den Alpha-Kanal von `terrain_d_array.png` (dokumentiert als Unity-Smoothness) für PBR-Roughness zu nutzen. Messung mit Pillow (`min/max/avg` je Tile) ergab: Gras/Fels/Lavakruste liegen bei ~254–255 (praktisch flach/opak) — als Smoothness interpretiert würde das gesamte Terrain unplausibel glänzend/plastikartig wirken. Feature verworfen, Roughness bleibt bei der statischen `0.95` des Materials. Der Property-Namen-Leak aus `Heightmap.json` (`Metallic`, `Glossiness` — ohne `Tex`-Suffix, anders als `NoiseTex`/`ClearedMaskTex`) stützt die Vermutung, dass dies im Original-Shader Uniform-Skalare sind, keine Pro-Pixel-Maps.

**(4) Datenintegrität gefunden und repariert.** Die in `valheim_browser_assets/textures/` (die vom Dev-Server unter `/assets/` ausgelieferte Ordnerkopie) liegenden `terraintile_*.png`-Dateien waren **0 Byte** (stub/leer) — 2672 von 2749 Dateien in diesem Ordner sind das, nur ein Teil der Assets wurde tatsächlich vollständig exportiert. Die echten Daten lagen nur unter `tools/assetripper/export/Assets/world/terrain/array generation/` (17–193 KB je Datei). Alle 19 benötigten Dateien (16 Diffuse-Slices + 3 Normal-Tiles) wurden dorthin kopiert, damit `loader.loadAsync('/assets/textures/terraintile_n_*.png')` echten Inhalt statt eines Decode-Fehlers liefert.

**Tests:** `npx tsc --noEmit -p client` sauber. Live-Verifikation per Playwright: Connect, Konsole zeigt `[Terrain] splat textures loaded (16 tiles + variety noise)` **und** `[Terrain] splat normal maps loaded (3 bump groups)` ohne WebGL-/Shader-Compile-Fehler; Screenshot bestätigt unverändert korrekte Gras-Diffuse-Darstellung (keine Regression durch die Shader-Erweiterung).

## Status-Update (2026-07-25): G-VEG (Gras-Clutter) + G-WAT (Wasser-Normal-Map) ✅

**Nutzer-Meldung:** „die Oberfläche sieht noch nicht richtig aus, es fehlt Gras, das Wasser hat scheinbar keine Texturen". Beide Symptome bestätigt und behoben — es handelte sich nicht um Rendering-Bugs in bestehendem Code, sondern um zwei **komplett fehlende Features**: ein Gras-/Boden-Vegetationssystem existierte im Client bisher überhaupt nicht (`search_subagent`-Suche nach `*grass*`/`*clutter*`/`*veget*` ⇒ 0 Treffer), und das Wasser-Material war eine reine Flächenfarbe (`MeshStandardMaterial({ color: 0x2a5a7a })`) ohne jede Textur.

**(1) G-VEG — neues `client/src/engine/GrassClutter.ts`.** Prozedurales, rein clientseitiges Boden-Deko-System (Analogon zu Unitys Terrain-„Detail"/Vegetations-Layer — im Original wie hier nie ZDO-getrackt, reine Optik). Zonen-gechunkt wie `TerrainManager` (Build/Dispose-Queue, Distanz-Hysterese), pro 64-m-Zone werden bis zu `DENSITY=220` Kandidatenpunkte über eine deterministische Integer-Hash-Funktion gestreut, gefiltert nach `TerrainManager.getBiomeAt()` (nur Meadows/Plains) und `getHeightAt()` (min. 0,3 m über Wasserlevel), und als `InstancedMesh` gebaut (Geometrie: `grasscross.glb`, ein gekreuztes Quad-Paar, 48 Vertices, per Node-Skript gegen den rohen glTF-Binärchunk verifiziert — kein eingebettetes Material, Texturen müssen im Code gesetzt werden). Wind-Sway per `onBeforeCompile`-Hook (`uTime`-Uniform, Offset auf `transformed.x/z` via `sin/cos`, Phase aus der Instanz-Matrix abgeleitet, `#ifdef USE_INSTANCING`-gated) — mirrored von der bestehenden Splat-Shader-Technik.

**(2) G-WAT — `Terrain.ts`: `loadWaterTexture()`.** Lädt `water_normals.png`, `RepeatWrapping`, `repeat(24,24)`, animierter UV-Offset (`offset.set(elapsed·0,015, elapsed·0,011)`) für Kräuseln ohne Custom-Shader (einfacher als der 4-Ecken-Splat-Blend des Terrains, da Wasser nur eine Textur-Lage braucht). Wird explizit auf **beide** Wassermaterialien (Nah- und Fern-Wasser) gesetzt, da `farWater.material` bereits vor Abschluss des async Ladevorgangs per `.clone()` erzeugt wurde — ein Clone kopiert nur zum Klon-Zeitpunkt vorhandene Referenzen, ein nachträglich gesetztes `map` muss also separat zugewiesen werden.

**(3) Datenintegrität — gleiche Bug-Klasse wie bei G-TEX2.** Die benötigten Texturen in `valheim_browser_assets/textures/` waren wieder 0-Byte-Stubs (`grass_meadows.png`, `grass_heath.png`, `water_normals.png`); echte Kopien lagen unter `tools/assetripper/export/Assets/world/Props/ground_clutter/models/textures/` bzw. `Assets/world/water/`. Nur diese 3 konkret benötigten Dateien wurden kopiert (bewusst nicht das gesamte Textur-Verzeichnis — 2672+ leere Dateien laut G-TEX2-Messung sind ein separates, viel größeres Aufräum-Thema).

**(4) Bug gefunden und behoben: Gras war weiß/marineblau statt grün.** Nach dem ersten Rollout zeigte eine gezielte Nahaufnahme (Kamera per `page.evaluate()` exakt neben eine reale Gras-Instanz teleportiert) korrekt geformte, korrekt platzierte Gras-Büschel — aber in Weiß (Sonnenseite) und dunklem Marineblau (Schattenseite/Ambient) statt Grün. Ursache per Pixel-Analyse (Pillow, `min/max` je Kanal + Kompositierung auf dunklem Hintergrund) gefunden: `grass_meadows.png` ist in Unity eine reine **weiße Alpha-Masken-Silhouette** (RGB fast durchgehend 255/255/255, die eigentliche Grünfärbung kommt im Original über eine separate Terrain-Colormap, die wir nicht mitgenommen haben) — unser `MeshStandardMaterial` hatte keine `color`-Tönung gesetzt und rendert einen reinen weißen Diffuse-Wert direkt beleuchtet. `grass_heath.png` dagegen hat bereits ein echtes Tan/Khaki in den RGB-Kanälen gebacken (verifiziert: R bis 153, G bis 143, B bis 90) und brauchte keine Korrektur. Fix in `GrassClutter.ts`: `make(map, tint)` bekommt jetzt einen zweiten Parameter, `meadows` wird mit `color: 0x5c8a3a` (Wiesengrün) getönt, `heath` bleibt bei `0xffffff` (neutral, da die Farbe schon in der Textur steckt).

**Tests/Verifikation:** `npx tsc --noEmit -p client` sauber, `get_errors` sauber auf allen 3 geänderten Dateien. Live per Playwright: Konsole zeigt `[GrassClutter] grass clutter loaded (meadows + heath)` und `[Terrain] water normal map loaded` ohne Fehler; Szenengraph-Introspektion bestätigt 19 reale Gras-`InstancedMesh`-Chunks mit korrekter Textur-URL und gesunden Instanzzahlen (77–220 pro Chunk, `visible: true`); Nahaufnahme-Screenshot nach dem Farb-Fix zeigt korrekt grüne, alpha-geschnittene Gras-Büschel auf dem Boden. **Debugging-Hinweis:** die serverseitige Spielerposition wird jedes Frame aus dem Netzwerk-/Bewegungs-Loop neu gesetzt — ein einmaliger `page.evaluate()`-Teleport wird sofort zurücküberschrieben; für Verifikations-Screenshots musste `renderer.updatePlayer` temporär zu einem No-op überschrieben werden, damit eine manuell gesetzte Kamera-Position für den Screenshot erhalten bleibt.

## Status-Update (2026-07-25): NPC-Texturen repariert — Kreaturen-GLBs hatten keine/fehlerhafte Körper ✅

**Nutzer-Meldung:** „Es sieht aber noch so aus, als wenn die NPC keine richtigen Texturen haben." Die Prüfung (Playwright-Nahaufnahmen auf einer Sky-Plattform mit Fill-Light, `tools/pw-texture-check.mjs`) bestätigte das — und fand gleich **drei voneinander unabhängige Ursachen**, alle im AssetRipper-Export begründet, nicht im Renderer:

**(1) Alle Kreatur-GLBs sind texturlos.** Im Gegensatz zu den Vegetations-GLBs haben sämtliche Kreaturen-Exports nur ein „Default-Material" ohne eingebettete Texturen (AssetRipper bindet bei PrefabHierarchyObject-Exports keine Materialien). Die Original-Texturen liegen aber vollständig im Export (`tools/assetripper/export/Assets/...`).

**(2) Boar/Greydwarf: der Körper fehlte komplett.** `Boar_0.glb` enthielt nur die 46-Vertex-Fangzähne, `greydwarf@Idle.glb` nur 2 Quads — die eigentlichen SkinnedMesh-Körper wurden von AssetRipper gedroppt (die Rig-GLBs haben keine `skins`/Inverse-Bind-Matrices, Bind-Pose-Rettung nur aus den Rohdaten möglich). Fix: `tools/fix-creature-models.js` baut aus den Bind-Space-Quellmeshes (`Malbers .../Boar/Models/Poly Art Boar_0.glb`, `Characters/GreyDwarf/newmodel/Kakari.glb`) neue statische GLBs — Z-up→Y-up gebacken `(x,y,z)→(s·x, s·z, −s·y)` auf Positionen/Normalen/Tangenten, Skalierung gebacken (Boar 1:1, Kakari ×60), JOINTS/WEIGHTS entfernt, Diffuse+Normal-Texturen injiziert → `Boar_fixed.glb` (0,54×0,98×1,67 m), `greydwarf_fixed.glb` (0,85×1,24 m, T-Pose).

**(3) Deer: das gesamte GLB war NUR das Geweih.** `Deer.glb` enthält 5 Geweih-Meshes („Antlers 01–05", die Prefab-Attach-Varianten) und **keinen Körper** — was im Spiel als frei schwebendes Geweih sichtbar war (die vermeintlichen „dünnen Beine" auf frühen Screenshots waren Geweih-Zacken). Fix in zwei Schritten: Körper aus `Deer/Models/Deer 003.glb` (3680 Verts, Z-up, 1:1, **ohne** Geweih) → `Deer_fixed.glb`; danach Geweih-Variante „Antlers 01" gemergt — die korrekte Kopf-Position liefert der Node-Tree des originalen `Deer.glb.bak` (Welt-Transform T=[0, 1,697, 1,148] über dem Head-Bone bei [0, 1,537, 1,059], verifiziert: Geweih-Welt-BBox y 1,65..2,26 über der Kopf-Oberkante 1,78), Mesh-Daten mit dieser Matrix transformiert und als zweites Mesh mit geteiltem „deer"-Material angehängt (`mergeAntlers()` im selben Skript).

**Verdrahtung:** `shared/src/prefabs.ts` HINT_DEFS Model-Overrides: `Boar→Boar_fixed`, `Deer→Deer_fixed`, `Greydwarf→greydwarf_fixed`. Die ursprüngliche `Deer.glb`-Textur-Injektion (Job 1 des Skripts, Backup `Deer.glb.bak`) bleibt bestehen, ist aber für die Spawns nicht mehr relevant.

**Verifikation:** `node tools/pw-texture-check.mjs` — drei Nahaufnahmen mit World-BBox-Auto-Framing (`tools/out/tex-{Deer_fixed,Boar_fixed,greydwarf_fixed}.png`): Hirsch mit korrekt sitzendem Geweih und braunem Fell, Wildschwein texturiert, Greydwarf als texturierter Humanoide in T-Pose. Zwei Probe-Robustheits-Erkenntnisse: bei ~1 FPS (SwiftShader) können `page.screenshot()`-Timeouts auftreten (Retry hilft), und die Modell-Platzierung auf `cam.y+40` kann im Baumbestand landen — für Silhouetten-Shots Kamera höher legen.

**Offen geblieben (bewusst):** Neck/Greyling/Troll/Skeleton haben weiterhin keine meshed-Varianten im Export gefunden (nicht spawnbar, s. Einschränkung 27) und Kreaturen haben keine Animationen (Bind-/T-Pose, s. Einschränkung 28) — der Greydwarf steht deshalb in T-Pose. Beides ist kein Textur-, sondern ein Rig-/Animations-Thema für Phase G+.

## Status-Update (2026-07-26): G-VEG2/G-WAT2 — Gras unsichtbar gemacht & Wasser-Rippen sichtbar ✅

**Nutzer-Meldung (2×):** „ich sehe leider keine Gras oder Wasser Texturen", danach „an manchen Stellen sieht man vereinzelt Gras, das ist aber nicht vollflächig — prüfe das Spawnsystem für Gras und auch die Geometrie". Die Live-Diagnose (Probe `tools/pw-grass-water-check.mjs` + Instanz-Introspektion `pw-grass-instance-diag.mjs`) ergab, dass GrasClutter und die Wasser-Normal-Map zwar **geladen und aktiv** waren (19 Chunks, Normal-Map gesetzt), aber **vier getrennte Defekte** das Gras praktisch unsichtbar bzw. das Wasser flach wirken ließen:

**(1) G-WAT2 — Wasser-Rippen zu grob und zu schwach.** `repeat 24` auf der 512-m-Nah-Wasserebene ergab ~21-m-Kacheln — von der Küste aus nicht als Welle lesbar — und `normalScale 0,35` war zu subtil. Jetzt `repeat 48` (~10,7 m) + `normalScale 0,7` ([Terrain.ts](../../../valheim-browser/client/src/engine/Terrain.ts) `loadWaterTexture`): deutlich sichtbare, scrollende Wellenstruktur.

**(2) G-VEG2 — Spawn-Gras war unter dem Location-Plateau begraben.** GrassClutter backt Bodenhöhen in die Instanz-Matrizen; `TerrainManager.addTerrainModifier` (F4-Location-Leveling) baute bisher nur Terrain-Chunks neu — Gras-Chunks behielten die alte Höhe. Rund um den Start-Tempel lagen alle Halme ~0,6 m **unter** dem angehobenen Plateau (Instanz y=36,19 vs. Terrain 36,79 gemessen). Fix: `addTerrainModifier` gibt die betroffenen Zonen zurück, `Renderer.addLocationModifier` ruft `grass.dropZones(zones)` → Rebuild mit neuer Höhe.

**(3) G-VEG2 — die gerippten Gras-Texturen passen nicht zum Mesh (Hauptbefund).** `grass_meadows.png`/`grass_heath.png` haben nur **9,5 % Alpha-Deckung in einem schmalen Streifen am unteren Bildrand** (Terrain-Detail-Sprites bzw. kleinste Mip-Stufe), aber `grasscross.glb` sampelt per UV **drei Spalten über die volle Textur** (u 0,01–0,37/0,37–0,66/0,66–0,97, v 0,03–0,99). Folge: ~90 % aller Fragmente fallen durch den `alphaTest` → nur Staubkorngroße Rest-Specks sichtbar. Beweis per A/B-Probe (`pw-grass-render-test.mjs`): gleiche Instanzen mit knallrotem Basic-Material = viele große Büschel, mit Textur = fast nichts. Der ganze AssetRipper-Export enthält **keine** passende Cross-Atlas-Textur (alle Kandidaten ≤12 % Alpha bzw. Heidekraut-Busch). Fix: **prozeduraler Atlas** (`tools/gen-grass-texture.py`, PIL): 3 Halmbüschel-Spalten exakt im UV-Layout, zulaufende Halme, Farbverlauf dunkle Basis→helle Spitze, **Alpha-Bleed** (Hintergrund-RGB = mittleres Halmgrün statt transparentem Schwarz, sonst schwarze Mip-Ränder) → `grass_meadows_gen.png`/`grass_heath_gen.png` (60 %/54 % Deckung).

**(4) G-VEG2 — zwei Render-Fixes am generierten Atlas.** (a) `TextureLoader` lädt mit `flipY=true`, GLB-UVs folgen aber der glTF-Konvention → Textur stand auf dem Kopf (Halme hingen wie Schlafbänder, dunkle Basis oben): `flipY=false`. (b) `DoubleSide` flippt für Rückseiten die Normale — die grasscross-Normalen zeigen **alle** +Y (48/48, per Dump geprüft), Rückseiten wurden also mit −Y beleuchtet = **schwarze Flecken** in den Büscheln: im `onBeforeCompile`-Hook wird `normal` nach `normal_fragment_begin` hart auf `+Y` gepinnt (Unity-„Up-Normals"-Technik, Gras wird exakt wie das Terrain beleuchtet).

**(5) Dichte/Geometrie (Nutzer-Rückmeldung „nicht vollflächig").** `DENSITY` 220→**1200** Kandidaten/Zone (~1 Büschel pro 3,4 m² statt 19 m²), Scale 0,75–1,35 → **1,1–1,8** (0,45-m-Cross war knöcheltief), Platzierung +0,1 m (das Mesh hängt 0,16 m unter den Pivot — ein Drittel der Halmhöhe steckte im Boden). ~16,6k Instanzen in 19 Chunks um den Spieler, weiterhin 1 Draw-Call pro Variante+Zone.

**Verifikation:** Probe-Bericht: `[GrassClutter] loaded`, 19 Chunks/16.587 Instanzen, Wasser Normal-Map 0,7 auf beiden Ebenen. Screenshots [gw-ground.png](../../../valheim-browser/tools/out/gw-ground.png)/[gw-water.png](../../../valheim-browser/tools/out/gw-water.png): vollflächige grüne Wiese ohne schwarze Flecken, Wasser mit klar lesbarer Wellenstruktur. `npx tsc --noEmit -p client` sauber.

## Status-Update (2026-07-26): valheim-babylon — Bäume zu groß + Texturen falsch — Root-Causes aus Code-Analyse ✅

**Kontext:** Dieses Dokument gilt bisher für das three.js-Referenzprojekt `valheim-browser`. Das Schwesterprojekt **`valheim-babylon`** (Babylon.js 8, WebGPU/WebGL, Thin-Instances statt InstancedMesh) zeigte nach Phase-2-„Fertigmeldung" zwei Nutzer-Beanstandungen: **(a) Bäume zu groß / Proportionen falsch**, **(b) Texturen passen nicht** (Bäume als solide Blöcke, Rinde mit Lochfraß, Blätter opak). Beide wurden **von der Code-Seite** analysiert (Babylon-Quelltext in `node_modules` + GLB-Binärparse) statt nur per Screenshot-Gerate.

### Befund 1 — „Zu große Bäume": ZWEI verschiedene Dinge liefen falsch

1. **Erwartung vs. Datenlage.** Die GLB-Naturgrößen sind korrekt (Messung via neues Tool `tools/glb-size-check.mjs`, parst glTF-JSON+BIN direkt, wendet die Node-Hierarchie-Matrizen an): **Beech1 30,5 m**, Birch1 19,5 m, Oak1 24,8 m, FirTree 12,7 m (inkl. `Pine_tree`-Node-Scale ×2), Pinetree_01 25,1 m. Vegetations-Skalen aus vegetation.pkg: Beech1 **0,8–1,5** → Weltbuche **24–46 m**. Das ist Valheim-Original und **kein** Bug — im three.js-Projekt stand derselbe Wald; ein subjektiv „zu großer" Eindruck entsteht nur, weil der Babylon-Client aktuell ohne dichten Nebel rendert und die Kamera-FOV eng ist. Der Analyse-Befund aus §1.3/§2.4 gilt unverändert: **Skala = GLB-Naturgröße × scaleScalar-Zufall**, keine Höhen-Normalisierung — der Babylon-Client hatte diese Falle von Anfang an nicht (gut).

2. **Echter Bug (behoben, 2026-07-26 früher): Doppelanwendung der GLB-Node-Transforms.** `AssetManager.getMasters()` backt die volle GLB-Hierarchie-Matrix in `localMatrix` und `EntityManager.rebuildBucketInstances` setzt sie als Thin-Instance-Matrix — aber der Master-Mesh selbst hing noch mit derselben Hierarchie in der Szene, sodass Babylon die Transform **zweimal** anwendete (Master-World × Thin-Matrix). Sichtbar u. a. bei FirTree (Node-Scale 2 → 4× zu groß) und allen Meshes mit Parent-Translation (schwebende Objekte). Fix: Master nach dem Capture **detachen und auf Identität zurücksetzen** (position/rotation/scaling/Pivot) — Thin-Instance-Matrizen sind Weltmatrizen, der Master darf selbst keine Transform mehr tragen. (Verifiziert: alle Master parentlos + Identity, Instanzmatrizen korrekt.)

### Befund 2 — „Texturen falsch": Die Alpha-Cutout-Kette war an drei Stellen gebrochen

Der Babylon-Port von `fixupMaterial` (Pendant zu three.js `applyAlphaCutoutIfNeeded`, §1.5) setzte `forceAlphaTest = true` — **der Alpha-Discard lief trotzdem nie**. Code-Verifikation gegen den Babylon-8-Quelltext (`node_modules/@babylonjs/core`):

| Schicht | Datei | Erkenntnis |
|---|---|---|
| Shader | `Shaders/ShadersInclude/pbrBlockAlbedoOpacity.js` | `alpha *= albedoTexture.a` nur bei `#if defined(ALPHAFROMALBEDO) \|\| defined(ALPHATEST)`; Discard nur bei `#ifdef ALPHATEST`: `if (alpha < ALPHATESTVALUE) discard;` |
| Define-Setzung | `Materials/materialHelper.functions.js` `PrepareDefinesForMisc` | `defines.ALPHATEST = alphaTest` — kommt ausschließlich aus `material.needAlphaTestingForMesh(mesh)` |
| needAlphaTesting | `Materials/material.js` + `PBR/pbrBaseMaterial.js` | Short-Circuit **nur** über `transparencyMode` (`_transparencyModeIsTest`). Ohne expliziten `transparencyMode` greift die Legacy-Heuristik — und sobald `useAlphaFromAlbedoTexture=true` (nötig für den Alpha-Sample!) gleichzeitig `needAlphaBlending()=true` liefert, wird der Test **blockiert** (`!needAlphaBlending && needAlphaTesting`). Genau das war der Deadlock: Alpha-Sample an ⇒ Blend an ⇒ Test aus ⇒ volle Quads. |
| Alphatest-Wert | `pbrBaseMaterial.js` Z. 1415 | `defines.ALPHATESTVALUE` kommt aus `material.alphaCutOff` — der GLTF-Loader lässt es auf 0 (Test bestünde immer, nichts wird verworfen). |

**Fix (`client/src/engine/AssetManager.ts`):** statt `forceAlphaTest` jetzt `material.transparencyMode = Material.MATERIAL_ALPHATEST` + `alphaCutOff = 0.5` + `useAlphaFromAlbedoTexture = true` + `tex.hasAlpha = true` (AssetRipper schreibt RGBA mit `hasAlpha=false`, obwohl echte Alpha-Daten vorhanden sind). Laufzeit-Verifikation: Shader-Defines zeigen jetzt `#define ALPHATEST`, `#define ALPHAFROMALBEDO`, `#define ALPHATESTVALUE 0.5` — der Discard ist damit **garantiert** aktiv (nicht nur „sieht besser aus").

**Bark-Bug (Lochfraß in Stämmen/Felsen) — Messung statt Schwelle:** die AssetRipper-Texturen führen im Alpha-Kanal nicht nur Transparenz: `beech_bark` 7,6 % / `birch_bark` 45 % transluzente Pixel (Smoothness/Masken-Kanal), echte Laub-Cards `beech_leaf` 85 % / `birch_leaf` 82 %. Fix: Cutout nur bei **> 50 %** transluzenten Pixeln — Rinde bleibt opak, Laub bekommt den Cutout (vorher griff jede Textur mit *irgendeinem* Alpha-Pixel, inkl. `needDepthPrePass`-Nebeneffekt „invertierte Helligkeit", der mitentfernt wurde).

**Master-Mesh-Reset:** nach dem Capture der Hierarchie-Matrix wird der Master parentlos, position/rotation/quaternion/scaling auf Identität, Pivot auf Identity — und bleibt deaktiviert, bis Instanzen existieren.

**Tests:** `npx tsc --noEmit -p client` sauber · Vegetations-Smoke (`server/test/e2-vegetation.ts`) grün (9 112 ZDOs, bit-identisch) · Laufzeit-Probe: 9 544 statische / 8 dynamische ZDOs, 0 Asset-Fehler, Master-Transforms Identity, Buchen-Instanzskalen 1,0–1,5 (= 30,5 m × 0,8–1,5, exakt vegetation.pkg).

**Babylon-spezifische Merkposten (für Phase 3+):**
- **Thin-Instance-Matrizen sind Weltmatrizen** — ein Master mit eigener Hierarchie-Transform wendet sie zusätzlich an (Bug-Klasse „Doppeltransform"). Immer `localMatrix` capturen **und** Master neutralisieren.
- **`forceAlphaTest` allein reicht bei PBRMaterial nicht** — maßgeblich ist `transparencyMode` (Short-Circuit in `needAlphaTestingForMesh`); die Legacy-Heuristik kippt in Blend, sobald `useAlphaFromAlbedoTexture` an ist.
- **AssetRipper-Texturen:** `hasAlpha=false` trotz echtem Alpha-Kanal; Alpha ist bei Rinde/Felsen ein Smoothness-/Masken-Kanal (Messung statt Fixpunkt-Schwelle).
- **Cutout-Schatten** (Einschränkung 1) gilt auch hier: Babylon wirft Schatten über den Depth-Renderer ohne ALPHATEST ⇒ Blatt-Schatten bleiben blockig (separater Fix: `ShadowGenerator` mit `transparencyShadow` bzw. Custom-Depth).
- **GLB-Diagnose ohne Renderer:** `tools/glb-size-check.mjs` (neu) misst Welt-BBox + Node-Skalen direkt aus der Datei — ersetzt die bisherigen Browser-Probe-Runden für Größenfragen.

## Bekannte Einschränkungen (nach Phase A–F + Kamera/Admin/Karte + G1 + B5 + G-TEX/G-POP + Regressions-Fixes + AssetLog + G2 + TimeSync-Fix + Logic-Prefab-Filter + G-VEG/G-WAT + NPC-Textur-Fix + G-VEG2/G-WAT2)



| # | Einschränkung | Geplante Behebung |
|---|---|---|
| 1 | **Cutout-Schatten sind blockig**: `alphaTest` greift nur im Forward-Pass — der Shadow-Depth-Pass nutzt das Standard-Depth-Material ohne Alpha-Test, also werfen Blätter die Schatten ihrer vollen Polygone statt der Nadel-Silhouette. Gilt jetzt auch für die InstancedMesh-Vegetation | `customDepthMaterial` (MeshDepthMaterial mit `alphaTest` + `map`) pro Cutout-Material, zusammen mit dem Wind-Shader in Phase G |
| 2 | **Keine Vertex-Farben (COLOR_0) in den GLBs** → kein Wind-/Jahreszeiten-Shader wie im Original möglich | Ggf. aus dem AssetRipper-Export nachrüsten (Phase G) |
| 3 | **Skinned Meshes** (Boar, Troll, Player) haben keine POSITION-min/max-Accessoren → automatische BBox-Messung liefert fragwürdige Werte (betrifft aktuell nur Diagnose-Werkzeuge, nach A1 kein Rendering-Problem mehr) | Bei Bedarf: BBox aus Skeleton-Pose berechnen |
| 4 | **Placeholder-Boxen** (nun auch als InstancedMesh im StaticInstancer) nutzen weiterhin die Hint-Größen (`renderScale`) × ZDO-Scale und sind bei Bäumen kurz ~2× zu groß sichtbar, bis das GLB geladen ist. **G-POP: deutlich entschärft** — ~43 häufige Vegetations-Prefabs werden direkt nach dem Login preloaded (0,1–0,7 MB/GLB); der Box→GLB-Pop betrifft nur noch seltene Prefabs bei Erstsichtung | Rest: kompletter Prefab-Preload bzw. Draco-Kompression (Asset-Optimierung) |
| 5 | ~~Client-Terrain ist Placeholder~~ **erledigt (Phase D)**: echte Worldgen-Chunks + Wasser + Server-Gravitation. ~~Terrain-Texturierung vorerst einfache Vertex-Färbung~~ **erledigt (G-TEX, 2026-07-24)**: Original-Tiles (`terrain_d_array.png`, 16 Layer) + `TerrainVarietyNoise.png` als Splat-Shader via `onBeforeCompile` (Nebel/Schatten/ACES bleiben), Biom-Gewichte aus den Zonen-Eckbiomen ⇒ weiche Übergänge, Lava-Risse glühen emissive (B5-Maske), CPU-Vertexfarbe bleibt als Fallback bis die Texturen geladen sind. ~~Residual: die Biom→Tile-Zuordnung ist hand-rekonstruiert~~ **erledigt (G-TEX2, 2026-07-25)**: die Zuordnung wurde 16/16 gegen die einzeln exportierten `terraintile_0.png`…`terraintile_15.png`-AssetRipper-Slices verifiziert (echte Ground Truth, keine Rekonstruktion mehr) — 0/16 Abweichungen. **Normal-Maps jetzt genutzt**: nur 3 Normal-Tile-Varianten existieren im Rip (`terraintile_n_0/1/2.png`, kein 16-Layer-Array), tangentenfreies Bump-Mapping via Screen-Space-Derivative-Technik (`dFdx`/`dFdy`), Tile→Gruppen-Zuordnung ist eine begründete Näherung (gleiche Güteklasse wie zuvor die Tile-Zuordnung). **Geprüft und verworfen**: Alpha-Kanal von `terrain_d_array.png` als Unity-Smoothness — Messung (Pillow) ergibt ~254–255 (praktisch flach/opak) auf Gras/Fels/Lavakruste-Tiles, würde das Terrain unplausibel glänzend machen; PBR-Roughness bleibt bei der statischen 0.95 des Materials. Property-Leak aus `Heightmap.json` (`Metallic`, `Glossiness`, ohne `Tex`-Suffix) deutet ohnehin auf Uniform-Skalare im Original-Shader hin, nicht auf eine Pro-Pixel-Map | Optional: `_BumpScale`/`_Metallic`/`_Glossiness`-Werte aus dem Shader-Blob extrahieren, falls doch möglich; Tile→Normalgruppen-Zuordnung gegen Original-Screenshots feintunen |
| 6 | ~~**AshLands-Höhe nutzt den Legacy-Pfad**~~ **erledigt (B5, 2026-07-24)**: FastNoise 1:1 portiert, moderner Pfad + Lava-Maske golden verifiziert (91 307 Zellen, max Diff 1,81e-5 m — Restabweichung = ±1-f32-ulp-Toolchain-Rauschen MSVC sinf/pow vs. V8, an der Lava-Schwelle ×100 verstärkt, als Absolut-Band im Harness dokumentiert). **Deployment-Hinweis:** ein im Legacy-Modus gestarteter Server muss neu gestartet werden, damit AshLands modern wird — Terrain wird regeneriert (nicht gespeichert), der G1-Save bleibt gültig, aber die AshLands-Topographie und damit Location-Platzierungen dort ändern sich beim Flag-Wechsel | — (erledigt); Neustart-Hinweis beachten |
| 7 | **7 Flusspunkt-Positionen weichen um 1 ULP ab** (`sinf/cosf` vs. `Math.sin/cos`) → lokal bis zu ~165 ULP in riverWeight bei schmalen Bächen; keine sichtbare Auswirkung. Dieselbe 1-ULP-Klasse gilt für `GetRandomPointInRadius`/`inside_unit_circle` in der Vegetation | Bewusst akzeptiert (plattformabhängige Transzendental-Rundung); Harness klassifiziert solche Fälle als „explained" |
| 8 | **vegMask des C++-Servers ist auf Single-Biom-Zonen UB-Müll** (uninitialisiertes `float mask;`, HeightmapBuilder.cpp:195 — s. Status-Update D1). TS liefert dort das beabsichtigte Verhalten (0), weicht also bewusst vom C++-Ist ab. Praktisch folgenlos: Die Maske wird nur gelesen, wenn `minVegetation != maxVegetation` (Mistlands-Einträge), und Mistlands-Zonen sind nie Single-Biom-Fastpath-Fälle mit unkritischer Maske | Fix im C++-Server (`float mask = 0.f;`) — danach Export neu fahren und Harness-Skip entfernen |
| 9 | **Zonen-Generierung läuft auf dem Server-Hauptthread** (~30 ms/Zone, 12-ms-Budget/Tick ⇒ ~1 Zone/Tick). **G-POP: entschärft** — die Queue wird jetzt gecullt (Zonen > 5 Zonen Chebyshev von allen Peers fliegen raus) und nearest-first sortiert: beim Flug entsteht die Landschaft **vor** dem Spieler zuerst, das „Aufholen hinter einem" ist weg. Übrig bleibt die rohe Generierungsrate (~3 s für die 81 Zonen beim Login; Bäume poppen nacheinander rein — wie im Original beim ersten Betreten, nur langsamer). C++ lagert Heightmaps in einen Thread-Pool aus | Worker-Thread für Heightmap+Populate (Phase G) |
| 10 | **Statik-Instancing ist global pro Prefab** (seit F4 Vegetation + Location-Pieces im selben StaticInstancer) — keine Frustum-Culling-Granularität unter der ganzen Art und keine Modell-LODs (volle Dreieckszahl aller ~9k Objekte im Interessensradius). **G-POP: Terrain-LOD erledigt** — der Fern-Ring (2×2 Zonen, 4-m-Stride, bis 640 m, −0,35 m Bias) ist das `_IsDistantLod`-Analogon; Modell-LODs bleiben offen | LOD-Stufen über vorhandene `*_lod_02`-Modelle + Distanz-Culling (Phase G) |
| 11 | **ZDO-Rotation wird im TS-Protokoll als Quaternion übertragen**, der C++-Server speichert/synct Euler-Winkel (`ZDO::SetRotation` → `euler_angles()`). Visuell gleichwertig; relevant erst bei Save-File-Binärkompatibilität | Phase G (Persistenz-Format an C++ anlehnen) |
| 12 | **`prepareFeatures()` braucht ~75 s beim Server-Start** (einmalig, Hauptthread): die ~2–4 Mio. verworfenen Kandidatenpunkte (Biom-/Altitude-Checks über Noise) kosten in JS spürbar mehr als nativ (C++: wenige Sekunden). Determinismus bleibt unberührt | Biom-Prefilter oder Worker für die Platzierung (Phase G), ggf. getBiome-Cache |
| 13 | **Location-`randomRotation` ist absichtlich nicht welt-deterministisch** — C++ nutzt dafür einen zeit-geseedeten Default-RNG (`VUtilsRandom.cpp:53-55`); Rotation + Piece-Transforms rotierbarer Locations unterscheiden sich pro Server-Start (auch in C++!). Wir spiegeln das Verhalten statt es „zu fixen" | Bewusst akzeptiert (C++-Parität); für Golden-Tests nur Positionen/Prefab-Multimengen vergleichen |
| 14 | **DUNGEON-Pieces werden übersprungen** (dungeons.enabled=true ⇒ C++ routet sie an den DungeonManager) — Dungeon-Locations (SunkenCrypt, MountainCave, …) haben noch keinerlei sichtbare Struktur; Zähler wird pro Location geloggt | Phase G (Dungeon-Generierung) |
| 15 | **Terrain-Leveling (F4) weicht bewusst von der C++-Heightmap ab** — der C++-Server ebnet den Boden unter Locations nicht (sein `TerrainModifier.cpp` liefert nur ClearArea-Parameter); im Original ist das Unity-Client-Verhalten. Unsere Höhen-Abfragen (`getGroundHeight*`, Normalen) liefern nahe Locations das geebnete Plateau — Server und Client bleiben über die identische shared-Mathe konsistent, weichen aber dort vom C++-Server ab. Parameter: `terrain_modifiers.yml` (35 Features), sonst clearArea⇒exteriorRadius + C++-Defaults; die echten Unity-Prefab-Einzelparameter sind unbekannt (Annäherung) | Bewusst akzeptiert (Unity-Parität); bei künftigen Golden-Dumps Höhen in Location-Nähe gesondert klassifizieren |
| 16 | **Vegetation im Smooth-Band bereits generierter Nachbarzonen behält ihre alte Höhe** — registriert eine Location nachträglich einen Modifier, dessen Blend-Band in eine schon generierte Zone hineinreicht, wird deren Heightmap zwar neu gebaut (Server+Client), die dort bereits platzierten Bäume/Sträucher stehen aber auf der alten Höhe (kleine Rand-Abweichung, glattes Band ⇒ ≤ Dezimeter). Im Original heilt sich das clientseitig (Clutter rendert gegen die aktuelle Heightmap) | Phase G: bei Modifier-Registrierung betroffene Vegetations-ZDOs im Band neu snappen (oder clientseitiges Clutter-System) |
| 17 | **Admin-Modus ist faktisch ungeschützt** — by design (Projektentscheidung, wird später erweitert): die Permission-Stelle `canUseAdminCommands` prüft `peer.isAdmin`, und der Server läuft mit `players.everyone-admin: true`, also darf jeder Client AdminCommands senden (fly, künftig teleport/god/…) | Zum Schärfen: `everyone-admin: false` + `peer.isAdmin` aus der Admin-Liste; der Hook ist dafür bereits die einzige Prüfstelle |
| 18 | **Weltkarte (M) zeigt reine Worldgen-Biome** aus dem clientseitigen GeoManager — ohne Terrain-Leveling unter Locations, ohne Fog-of-War (die ganze Welt ist sichtbar, auch unbetretene), ohne Pan/Zoom, Fenster fix 4096 m um den Spieler | Später: Fog-of-War/Exploration-Tracking, Pan/Zoom, Location-Marker (Phase G+) |
| 19 | **PlayerInput-Wire-Format ohne Versionskompatibilität** — um lookPitch/moveY/jumping erweitert; Client und Server müssen versionsgleich sein (gleiches Repo). Ein alter Client gegen einen neuen Server (oder umgekehrt) liest verschobene Bytes | Bewusst akzeptiert; bei Bedarf Protokoll-Version im VersionCheck erhöhen und hart ablehnen |
| 20 | **Save-Format ist ein eigenes JSON+zstd-Envelope** (`<world>.db.zst` via `node:zlib`), nicht binärkompatibel zum C++-`.db`/`.fwl` (DataWriter-Layout). Die Inhalte spiegeln C++ (meta ≙ .fwl, worldTime, Zonen, persistente ZDOs, Spieler), aber Saves sind nicht zwischen C++- und TS-Server austauschbar; RandomEventManager/GlobalKeys fehlen beidseitig noch | Falls Save-Austausch je gewünscht: C++-DataWriter-Layout nachziehen; GlobalKeys mit RandomEvents (Phase G) |
| 21 | **Charakter-ZDOs von Spielern werden nicht als ZDOs gespeichert** (Ghost-Schutz, s. G1-Update) — Position/Fly-Status leben in der `players[]`-Sektion und werden beim Connect **per Name** zugeordnet. Folge: Name = Identität; ein Namenswechsel bedeutet ein „neuer" Charakter (Spawn am Starttempel). C++ speichert Charakter-ZDOs und gleicht sie über die Session ab | Langfristig: stabile Charakter-ID beim ersten Connect vergeben (vorerst bewusst einfach) |
| 22 | **`randomRotation` ist seit G1 über Restarts stabil** (Verbesserung, keine Lücke): erzeugte Location-Pieces werden als ZDOs persistiert — eine geladene Location rotiert nicht erneut. Einschränkung 13 gilt damit nur noch für die **erste** Generierung einer Zone (frische Welt / neu betretene Zonen) | — (C++-Parität erreicht) |
| 23 | **Der Fern-Terrain-Ring (256–640 m) zeigt nur Terrain + Wasser, keine Vegetation/Objekte** — ZDOs streamen nur bis viewRadius 4 (256 m). Im Original verschwindet Vegetation in der Ferne ebenfalls (Clutter-Limit); der Übergang ist durch den dichteren Nebel (≈40 % @256 m) verhüllt. Der 4-m-Stride glättet kleine Kuppen/Grate in der Ferne leicht | Optional: Fern-Vegetation als Billboards/Impostor oder viewRadius weiter erhöhen (kostet Bandbreite/RAM) |
| 24 | **Nebel ist seit G-POP deutlich dichter** (0,0028/0,0032/0,0042 Tag/Dämmerung/Nacht statt pauschal 0,0015) — bewusste Stil-Entscheidung: Valheim-typisch verhangene Fernsicht, die Ring-Rand (640 m) und verbleibende Pop-in-Reste kaschiert; im Original wäre bei klarem Wetter weiter sichtbar | Optional: Nebeldichte an Wetter/Tageszeit koppeln (Wetter-System mit RandomEvents, Phase G) |
| 25 | **AssetLog-Datei-Senke existiert nur im Dev-Server** (vite-Plugin `assetLogSink` → `logs/client-assets.log`). In Production (`vite build` + statisches Hosting) schlagen die Client-POSTs ins Leere (still gefangen); Fehler bleiben dann nur im clientseitigen Ring-Buffer (`window.__assetLog`, 500 Einträge) + Browser-Konsole | Bei Bedarf: gleiche Route im Production-Static-Server nachziehen (Ein-Zeilen-Middleware) |
| 26 | **Kreaturen-Spawn-Regeln sind autoriert, nicht portiert** — die C++-Referenz hat kein server-seitiges Spawn-System (im Original spawnt der besitzende Unity-Client; dessen `ZoneSystem.m_spawnLists`-Daten liegen in keinem Repo). Tabelle/Intervalle/Chancen/Radien/Geschwindigkeiten in `shared/src/spawnData.ts` sind nach Vanilla-Gefühl gesetzt, nicht 1:1 | Bei Bedarf Werte aus dem dekompilierten Unity-Client extrahieren und angleichen |
| 27 | **Mehrere Kreatur-GLBs sind mesh-lose Bone-Rigs** (0 Meshes, unsichtbar): `Neck.glb`, `Greyling.glb`, `Troll.glb`. ~~`Boar.glb`, `greydwarf.glb`/`Greydwarf_0.glb`~~ **teilweise erledigt (NPC-Textur-Fix, 2026-07-25)**: Boar/Deer/Greydwarf laufen jetzt über `*_fixed.glb` (aus Bind-Space-Quellmeshes gebacken, Texturen injiziert, s. Status-Update oben); Neck/Greyling/Troll bleiben nicht spawnbar, Skeleton/Eikthyr vorerst nicht in der Tabelle | Meshed-Varianten für Neck/Greyling/Troll im Asset-Bestand suchen/nach exportieren; danach Tabelle erweitern |
| 28 | **Kreaturen haben keine Animationen** — weder Skins noch AnimClips im GLB-Bestand, kein AnimationMixer im Client; sie gleiten in Bind-/Idle-Pose über den Boden (Bewegung selbst ist weich interpoliert, G2). **Nachgemessen 2026-07-27:** die Lücke ist total — **keine einzige der 7.471 GLB-Dateien** in `assets/models/` hat einen `animations`- oder `skins`-Eintrag (direkt aus dem glTF-JSON-Chunk geprüft) | Animationen exportieren (AssetRipper) + AnimationMixer im Renderer (Phase G+) |
| 28b | **Es gibt kein Spielermodell** (2026-07-27, direkt aus den GLBs nachgemessen): `Player.glb` = 0 Meshes (reiner Bone-Rig, wie Einschränkung 27); `PlayerUnarmed.glb` = 1 Mesh, 149 Vertices, **0,14 m hoch**, Material `"woodwall"`, eingebettete Textur **0 Byte** — also ein fehlbenanntes Wand-/Prop-Fragment, keine Spielfigur. Die animiert wirkenden Dateien (`player_idle.glb`, `player@Walking.glb`, `player_Standard_Run_New.glb`) enthalten **ausschließlich** eine Knochen-Hierarchie (44–58 Nodes), kein Mesh, keinen Skin, keine Keyframes. Ohne Skin + Keyframes ist Skelett-Animation technisch unmöglich. **Zwischenlösung:** `client/src/player/AvatarRig.ts` baut eine Figur aus Grundkörpern mit echten Gelenk-Pivots (Hüfte/Knie/Schulter/Ellbogen) und animiert sie prozedural (Laufzyklus streckengekoppelt, Armgegenschwung, Kniebeugung, Rumpf-Vorlage, Atmung im Stand) | Client neu rippen mit einem Setup, das Skins **und** AnimClips erhält; danach `AvatarRig` durch das echte Modell ersetzen (Schnittstelle `update(dt, speed, maxSpeed)` bleibt) |
| 29 | **Kein Kampf-/Gesundheitssystem** — Greydwarfs/Boars sind vollständig passiv (im Original würden sie angreifen), Rehe fliehen nur; keine Treffer, kein Tod, kein Loot, keine Taming/Procreation trotz gesetzter Prefab-Flags | Combat-Phase (Health-ZDO-Members, Angriffe, Drops; danach RandomEvents-Wellen) |
| 30 | **`@` in GLB-Dateinamen ist nur dev-verifiziert** — `greydwarf@Idle.glb` wird per `encodeURIComponent` angefragt (`greydwarf%40Idle.glb`) und vom vite-Asset-Plugin vor dem Resolve dekodiert; ein Production-Static-Server muss `%40` ebenfalls korrekt auflösen (gängige Server tun es, bei uns ungetestet) | Beim Production-Deployment prüfen; notfalls Datei umbenennen + Override anpassen |
| 31 | ~~`Pickable_DolmenTreasure` hat keine GLB im Asset-Export~~ **erledigt (2026-07-25, s. Status-Update unten)**: die Datei existiert, ist aber ein 0-Mesh-Export (kein MeshRenderer in Unity — das Prefab ist der reine Pickup-Trigger, das sichtbare Loot ist die separate `treasure_pile`-Deko). `isRenderable()` schließt es jetzt aus, wie die anderen Logic-Prefabs | — (erledigt) |
| 32 | ~~**Boden-Vegetation (Gras) fehlte komplett, Wasser ohne Textur**~~ **erledigt (G-VEG/G-WAT 2026-07-25, Nachbesserung G-VEG2/G-WAT2 2026-07-26)**: `GrassClutter.ts` (prozedurales, zonen-gechunktes Gras via `InstancedMesh`, Wind-Sway-Shader) + Wasser-Normal-Map mit Scroll-Animation. G-VEG2: die gerippten Gras-Texturen erwiesen sich als unbrauchbar (9,5 % Alpha im unteren Streifen, kein Cross-Atlas im Export) → prozedurale Atlanten `grass_meadows_gen.png`/`grass_heath_gen.png` (`tools/gen-grass-texture.py`), dazu flipY-Korrektur, Up-Normals-Pinning gegen schwarze Rückseiten, Dichte 1200/Zone, Leveling-Rebuild per `dropZones`. **Deckt weiterhin nur Meadows/Plains ab** — mit den generierten Texturen wären weitere Biom-Varianten jetzt aber einfach einfaerbbar. Kein Custom-Depth-Material für Schatten (s. Einschränkung 1) | Weitere Biom-Varianten (Tint-Varianten der gen-Textur), Fern-Ring-Gras (aktuell nur im Nah-Terrain-Radius) |

| 33 | **95 % der Texturen im Asset-Ordner sind 0-Byte-Stubs** (2.639 von 2.763 PNGs, gemessen 2026-07-27). Der Export hat die Dateinamen geschrieben, aber nicht die Bilddaten. Ein Shader, der so eine Datei sampelt, bekommt Schwarz oder Müll — das war z. B. die Ursache dafür, dass der Wasser-Schaum unbrauchbar aussah (`foam.png`, `foam_highres.png`, `random_foam.png`, `water_foam.png` alle 0 Byte). **Die Daten sind aber nicht verloren:** unter `Valheim_Client/extracted_assets/Texture2D/` liegen 1.605 echte PNGs, nur nach Unity-PathID benannt statt nach Klarnamen. Die Zuordnung liefern die Material-Assets (`extracted_assets/Material/`, 1.800 Stück), die BEIDES enthalten — `m_Name` im Klartext und die PathIDs ihrer Textur-Slots. **Werkzeug dafür: `tools/recover-textures.mjs`** (`--list <Material>` zeigt die Slots, ohne Flag kopiert es sie). Damit wurden die echten Wasser-Texturen zurückgeholt (`_FoamTex`, `_RandomFoamTex`, `_Normal`, `_NormalFine`; `_CurlTex`/`_FoamHighTex`/`_BubbleTexture` fehlen im Export). ⚠️ **Fallstrick:** PathIDs sind vorzeichenbehaftete 64-Bit-Ganzzahlen — `JSON.parse` macht daraus Doubles und verliert Stellen (`…61620` → `…61630`), wodurch jede Textur fälschlich als "nicht vorhanden" gilt. Das Werkzeug liest sie deshalb per Regex als Zeichenkette aus dem Rohtext | Restliche Slots bei Bedarf über dasselbe Werkzeug nachziehen (NPCs, Props, Gebäude) |

## Offene Entscheidungen

| Frage | Optionen | Empfehlung |
|---|---|---|
| Worldgen-Ausführung | shared-Modul (Client+Server identisch) vs. Server-streamt Heightmaps | **shared-Modul** — wie Original, spart Bandbreite |
| Ashlands | jetzt mit FastNoise-Port vs. später | ~~später~~ **erledigt (B5, 2026-07-24)** — moderner Pfad ist Default (C++-Parität) und golden verifiziert |
| Terrain-Texturierung | Original-Terrain-Shader nachbauen vs. einfache Biom-Färbung | ~~einfach starten, Original-Texturen in Phase G~~ **erledigt (G-TEX, 2026-07-24)** — Original-Tiles als Splat-Shader umgesetzt, Vertex-Färbung bleibt als Fallback |
| Skinned Meshes | Boar/Troll/Player haben keine BBox-Accessoren — beim Entfernen der Höhen-Normalisierung Sonderfall prüfen | in A1 mittesten |
