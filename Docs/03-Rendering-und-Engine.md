# 03 — Rendering & Engine (Babylon.js)

Konzept für den neuen Client. Zielbild: offene Valheim-Welt mit verifiziertem Terrain, dichter Vegetation, vielen dynamischen Lichtern und stimmungsvoller Atmosphäre — bei stabilen 60 FPS auf Mittelklasse-Hardware.

---

## 1. Engine-Basis

```ts
// engine/Engine.ts
const engine = await (async () => {
  if (await BABYLON.WebGPUEngine.IsSupportedAsync) {
    const e = new BABYLON.WebGPUEngine(canvas);
    await e.initAsync();
    return e;
  }
  return new BABYLON.Engine(canvas, true, { stencil: true }); // WebGL2-Fallback
})();
```

- **Ein Szenen-Codepfad** für beide Backends; Backend-Wechsel nur zur Laufzeit-Config (Schatten-Auflösung, Cluster-Anzahl).
- `engine.runRenderLoop(() => scene.render())`; Spiellogik in `scene.onBeforeRenderObservable` mit `engine.getDeltaTime()`.

## 2. Beleuchtung (das Herzstück)

### 2.1 Sonne + Himmel — Valheims EnvSetup/EnvMan-Modell

**Grundsatz:** Valheim leitet die Beleuchtung *nicht* aus einer generischen
Sonnenstands-Formel ab. Jedes Wetter ist ein `EnvSetup`-ScriptableObject mit
**Keyframes für vier Tageszeiten**, zwischen denen `EnvMan` anhand der
Tagesfraktion interpoliert. Den Look nachzubilden heißt daher, *dieses
Datenmodell* nachzubilden — implementiert in `shared/src/environment.ts`.

**Verifiziertes Feldset** (1:1 die EnvSetup-Oberfläche, die Expand World Data
aus Vanilla-Objekten nach YAML schreibt):

| Feld | Keys | Default |
|---|---|---|
| `fogColor{Morning,Day,Evening,Night}` | 4 | — |
| `fogColorSun{Morning,Day,Evening,Night}` | 4 | — |
| `fogDensity{Morning,Day,Evening,Night}` | 4 | 0.01 |
| `sunColor{Morning,Day,Evening,Night}` | 4 | — |
| `ambColor{Day,Night}` | **2** | — |
| `lightIntensityDay` / `lightIntensityNight` | — | 1.2 / 0 |
| `sunAngle` | — | 60 (max. Elevation in Grad) |
| `alwaysDark` | — | false (Höhlen/Krypten) |

Zwei Konsequenzen für den Renderer:

1. **Nebel hat ZWEI Farben pro Keyframe.** `fogColorSun*` gilt in
   Blickrichtung *zur* Sonne, `fogColor*` *weg* von ihr. Dieser gerichtete,
   sonnengetönte Dunst ist der wiedererkennbarste Teil von Valheims Optik —
   eine einzelne flache Nebelfarbe wirkt nie „nach Valheim", egal wie gut
   abgestimmt.
2. **Ambient hat nur 2 Keys**, Nebel/Sonne aber 4 → beide laufen auf
   **unterschiedlichen Kurven**.

**Verifiziertes Timing** — die Phasenanker lagen bereits im Repo, 1:1 aus dem
C++-Server portiert (`shared/src/constants.ts`, `ValhallaServer.h`):

```
WORLD_TIME_LENGTH = 1800 s  → Fraktion 1.0     voller Zyklus (30 min)
TIME_MORNING      =  240 s  → Fraktion 0.1333  Sonnenaufgang
TIME_DAY          =  270 s  → Fraktion 0.15    volles Tageslicht
TIME_AFTERNOON    =  900 s  → Fraktion 0.5     Mittag
TIME_NIGHT        = 1530 s  → Fraktion 0.85    Sonnenuntergang / Nachtbeginn
```

Nacht spannt also 0.85 → 1.1333 = **0.283 des Zyklus ≈ 510 s**, Tag ≈ 1290 s.
Das ist exakt der dokumentierte Vanilla-Split „21 min Tag / 9 min Nacht" und
bestätigt unabhängig die Nachtfraktion 0.3, die Tageslängen-Mods offenlegen.
**Wichtig:** Die vier Segmente sind dadurch *unterschiedlich lang* — vier
gleiche Viertel anzunehmen ist der naheliegende Fehler und legt Dämmerung auf
die falsche Uhrzeit. Ebenso bewegt sich die Sonne nachts ~2,5× schneller;
der Knick in der Winkelgeschwindigkeit am Horizont ist Valheim-eigen, kein
Bug (Werte bleiben stetig, per Halbierungstest nachgewiesen).

**Umsetzung.** `DirectionalLight` (Sonne *und* Mond — Valheim hat ein
Hauptlicht, das nachts zu Mondlicht wird; `lightDir.y` nutzt `|height|`,
damit es nie von unten durchs Terrain scheint), `HemisphericLight` für
Ambient, `SkyMaterial` mit der *echten* Sonnenposition (nachts unter dem
Horizont, damit die Kuppel von selbst abdunkelt), Turbidity an die
Nebeldichte gekoppelt. Wetter folgt dem Biom unter dem Spieler
(`EnvMan.m_biomeEnvironments`) und blendet über ~4 s über.

**Nebel-Status.** `FOGMODE_EXP2` (identisch zu Unitys Exponential-Squared).
Babylons Nebelfarbe ist ein *szenenweites* Uniform (`vFogColor`,
`ShadersInclude/fogFragmentDeclaration.js`), also wird der Sonnen-/Blick-Term
**einmal pro Frame auf der CPU** aus dem Kamera-Forward berechnet und in
`scene.fogColor` geschrieben. Vorteil: gilt einheitlich für *alle* Materialien
(StandardMaterial-Clutter, PBR-Bäume und das Terrain-NodeMaterial lesen
dieselbe Quelle bzw. `NodeMaterialSystemValues.FogColor`), kein
Shader-Eingriff, identisch auf WebGL2 und WebGPU. Nachteil: der Ton ist pro
Frame konstant statt ein Verlauf pro Pixel — Richtung Sonnenuntergang drehen
wärmt das *ganze* Bild, statt nur um die Sonne zu glühen.
**Nächster Schritt (offen):** derselbe Blend pro Pixel. Rezept steht:
`vPositionW` + `vEyePosition` liefern die Blickrichtung im Fragment-Shader
ohne neue Varyings, `mix(fogColor, fogColorSun, pow(max(dot(viewDirW,
-lightDir),0), exp))` bei `CUSTOM_FRAGMENT_BEFORE_FOG` mit
`material.fogEnabled = false`. Bewusst *nicht* mitgeliefert, weil es in drei
Shader-Pfaden (Standard/PBR/Node) konsistent umgesetzt werden muss —
inkonsistenter Nebel zwischen Materialien sieht schlechter aus als
einheitlicher Pro-Frame-Nebel.

**Farbwerte.** Struktur und Timing sind verifiziert; die konkreten
Farb-Zahlen in `ENVIRONMENTS` waren handabgestimmte Annäherungen. Ground truth
holte `node tools/dump-envsetup.mjs <assetripper-export>` aus dem lokalen
Export nach `shared/src/envData.json` — die Datei wurde leer ausgeliefert und
überschrieb nach dem Lauf feldweise die Defaults (gleiches Muster wie
`prefabData.json`), inklusive neuer Namen wie `Crypt`.

⚠️ **Der Lauf ist seit dem 16.08.2026 nicht wiederholbar** — der AssetRipper-Export ist
gelöscht (siehe [04-Asset-Pipeline.md](04-Asset-Pipeline.md)). Das ist folgenlos, weil
`envData.json` gefüllt im Repo liegt: 39 Wetter mit echten Werten, und Zahlen in einer
Quelldatei brauchen die Quelle nicht mehr. Es heißt aber, dass eine spätere Korrektur
dieser Werte von Hand erfolgen muss statt aus dem Export.

### 2.1b Himmel — `ValheimSky.ts`

**Babylons `SkyMaterial` war hier falsch, nicht nur suboptimal.**
`@babylonjs/materials/sky` implementiert das **Preetham-Tageslichtmodell**:
Es leitet die Himmelsfarbe *physikalisch* aus Turbidity und Sonnenstand ab und
kennt die EnvSetup-Farben überhaupt nicht. Der Horizont, den es malt, **kann**
`scene.fogColor` nicht treffen — Himmel und Nebel widersprechen sich genau
dort, wo sie sich berühren. In Valheim stimmen sie per Konstruktion: **der
Horizont *ist* die Nebelfarbe.** Genau deshalb wirkt die Welt wie eine
Atmosphäre statt wie eine Kulisse hinter einer nebligen Szene.

Valheims Himmel ist ohnehin nicht physikalisch, sondern ein stilisierter
Vertikalgradient mit Sonnen-/Mondscheibe, Sternen und driftenden Wolken.
Die Kuppel wird daher aus demselben `EnvState` gespeist:

| Element | Quelle |
|---|---|
| Horizont | `state.fogColor` → **identisch** mit dem Szenennebel |
| Zenit | Horizont abgedunkelt/gebläut (abgeleitet, nicht autoriert) |
| Sonnen-Glow | `state.fogColorSun` → gleiche Keyframes wie der Nebel |
| Sonne/Mond | Scheibe an der *echten* Sonnenrichtung (nachts untergegangen) |
| Sterne | blenden mit der Nacht ein, von Wolken maskiert |
| Wolken | prozedurales FBM, Deckung aus `EnvSetup.rainCloudAlpha` |

Alles prozedural — **braucht nichts aus dem 4,9-GB-Export**. (Rückblickend die
folgenreichste Entscheidung dieses Kapitels: Als der Export im August gelöscht wurde,
war die Kuppel der einzige große Renderblock, an dem gar nichts zu tun war.) Der Satz
„die echten Wolken-/Sterntexturen später einzusetzen ist ein Texture-Bind" gilt
technisch weiter, ist aber gegenstandslos — es gibt sie nicht mehr, und
[07-Grafik-Konzept.md](07-Grafik-Konzept.md) rät ohnehin davon ab.

**Verifikation: `node tools/pw-sky-verify.mjs`.** Roher GLSL lässt sich nicht
von `tsc` prüfen, also bündelt das Skript den echten `ValheimSky` samt
Shared-Modell, rendert ihn in Chromium (SwiftShader) und misst statt zu
schauen — 10 Assertions, u. a.:

- Shader kompiliert fehlerfrei, Material wird ready, keine NaN-Pixel
- **Horizont == `scene.fogColor`, Abstand 0.002** (der Existenzgrund der Kuppel)
- Zenit dunkler als Horizont (Gradient-Vorzeichen)
- keine harte Naht im Vertikalscan (0.0118/Pixelreihe)
- Sterne nachts sichtbar, Nacht deutlich dunkler als Tag, Sonnenuntergang wärmer als Mittag

Screenshots landen in `tools/out/sky-*.png`.

**Drei Bugs, die erst diese Messungen aufgedeckt haben** (alle behoben):

1. **`pow(up, 0.45)` als Gradient** hat bei `up=0` *unendliche* Steigung und
   erzeugte eine sichtbar harte Kante genau auf dem Horizont (gemessen
   0.035/Pixelreihe). Ersetzt durch `1 - exp(-3.2·up)`: endliche Steigung,
   aber immer noch exakt 0 am Horizont — und `t(0)=0` ist genau das, was den
   Horizont gleich `fogColor` macht.
2. **Unterhorizont-Abdunklung** wirkte sinnvoll, brach aber genau diese
   Eigenschaft (Nebel-Match 0.002 → 0.155). Bewusst entfernt: `max(up, 0)`
   lässt die gesamte untere Hemisphäre exakt auf `fogColor`, also auf der
   Farbe, zu der der Nebel konvergiert — es gibt keine Naht zu verstecken.
3. **Sternenfeld war komplett leer** (gemessen: 0 helle Pixel). Der
   `sin(dot(p,…))·43758`-Hash verliert bei den Sternzell-Koordinaten
   (~±220) in float32 jede Präzision und degeneriert. Ersetzt durch den
   sinusfreien Integer-Hash → 235 Sternpixel.

Zwei Fallen steckten auch im *Messskript* selbst und sind dort dokumentiert:
`readPixels` liefert Zeilen von unten nach oben (Doppelnegation spiegelte das
Bild und ließ einen korrekten Gradienten invertiert aussehen), und der
Naht-Scan muss abseits der Sonne laufen **und** einen 3-Tap-Median benutzen —
Sonnenscheibe und Sterne sind absichtlich scharfe 1–2-px-Spitzen und wurden
sonst als 0.2–0.9-„Naht" gemeldet.

### 2.2 Cascaded Shadow Maps
- `CascadedShadowGenerator(1024/2048, sunLight)` — 4 Kaskaden, Schatten bis ~150 m scharf, danach weich/ausgeblendet.
- Nur Meshes in der Nähe als Shadow-Caster registrieren (`shadowGenerator.addShadowCaster` pro Chunk beim Laden, entfernen beim Entladen).

### 2.3 Clustered Lighting — viele Fackeln
- `ClusteredLightingContainer` für alle Punktlichter (Fackeln, Feuer, Portale, Workbench-Glühen).
- Lichter als **datengetriebene Pools**: Jede Basis/Fackel registriert Licht-Daten (Position, Farbe, Reichweite, Flicker-Phase); der Container verteilt sie auf Sichtkacheln.
- Flicker via `light.intensity`-Noise im Render-Observable (billig, kein Re-Setup).
- Budget-Strategie: unbegrenzt viele registrierte Lichter, Cluster-Container kümmert sich um die Auswertung; SceneOptimizer reduziert Reichweiten auf schwachen Geräten.

### 2.4 Volumetrics & Postprocesses — `PostProcessing.ts` ✅

Umgesetzt mit den **echten Werten des Originals**. Quelle: das Ingame-Post-Process-Profil (Unity PostProcessing-Stack v2) aus dem entpackten Client, `extracted_assets/MonoBehaviour/unnamed_-5654458244375810705.json`.

| Effekt | Original | Bei uns |
|---|---|---|
| Bloom | an — intensity 0.3, threshold 0.7, softKnee 0.7, radius 5.0 | an — `bloomWeight` 0.3, `bloomThreshold` 0.7, `bloomKernel` 64 px |
| Motion Blur | an — shutterAngle 150°, 10 Samples | an — `motionStrength` 150/360, 10 Samples |
| Chromatic Aberration | an — intensity 0.15 | an — `aberrationAmount` 4.5 px (0.15 × Babylon-Default 30) |
| Color Grading | an — Tonemapper *Neutral*, contrast 1.2, exposure 1.0 | an — `TONEMAPPING_KHR_PBR_NEUTRAL`, contrast 1.2, exposure 1.0 |
| Depth of Field | **aus** (`m_Enabled = 0`) | aus |
| Anti-Aliasing | aus (wäre TAA) | **FXAA an** — Abweichung, s. u. |
| Ambient Occlusion | an — intensity 1.0, radius 0.15 | **nicht umgesetzt** — s. u. |
| Vignette / Grain / LUT / SSR / EyeAdaptation | aus | aus |

Das erklärt den vom Nutzer gemeldeten Unterschied („unser Bild wirkt hart, das Original weich"): es fehlte der komplette Post-Stack, nicht ein Detail am Gras.

**Bewusste Abweichungen**
- *FXAA statt TAA:* Babylons `DefaultRenderingPipeline` hat kein TAA. Ohne jedes AA flimmern unsere Alpha-Cutout-Grashalme deutlich stärker als im Original, das TAA-Historie hat.
- *Kein SSAO:* Babylons SSAO2 braucht einen zusätzlichen Pass über die gesamte (bereits schwere) Terrain- und Clutter-Geometrie. Bei radius 0.15 ist der Effekt sehr kleinräumig — der schwächste Beitrag zum Gesamtbild, bewusst zurückgestellt.
- *`temperature -8` weggelassen:* Babylons `ImageProcessingConfiguration` kennt keine Kelvin-Temperatur (nur Hue/Density/Saturation/Exposure). Weggelassen statt schlecht approximiert; der Farbton kommt bei uns ohnehin aus dem EnvSetup-Modell.

**Zwei Babylon-Fallstricke beim Motion Blur** (beide in `PostProcessing.ts` behandelt):
1. Der Default-Pfad ruft `scene.enablePrePassRenderer()` — diese Methode **existiert bei den granularen Babylon-Imports dieses Projekts nicht** und bricht zur Laufzeit mit „is not a function" ab. Lösung: `forceGeometryBuffer = true` (letztes ctor-Argument); dessen Scene-Component importiert `motionBlurPostProcess.js` selbst.
2. `isObjectBased = false` liest der Konstruktor **vor** unserer Zuweisung, und der Setter zieht `enableVelocity` nicht nach. Ohne explizites Abschalten schreibt der Geometry-Buffer weiter Velocity-Daten für jede Terrain- und Clutter-Instanz.

Alle vier Effekte sind — wie im Original (`GraphicsSettingBool`) — einzeln über das Einstellungsmenü schaltbar. Motion Blur ist der teuerste (zusätzlicher Geometrie-Pass) und damit der erste Kandidat bei Framerate-Problemen.

- Offen: `VolumetricLightScatteringPostProcess` (God Rays), Screen-Space Reflections für Wasser-Nähe (teuer).

## 3. Terrain

- **Datenquelle:** `shared/worldgen` (Heightmap, GeoManager — gegen C++ verifiziert). **Kein Placeholder-Terrain** wie im Three.js-Client.
- **Chunk-Mesh:** pro Zone (64×64 m, Valheim-Sektor) ein Mesh via `VertexData`: Positionen + Normalen aus Heightmap, UVs für Splat-Mapping.
- **Texturierung:** Custom-`NodeMaterial` mit Biom-Splatting (Wiese/Wald/Sumpf/Berg/Planes-Texturen + Neigung → Fels, Höhe → Schnee). Splat-Gewichte serverseitig/shared berechenbar (Biom-Blend existiert bereits im shared Code).
- **LOD/Streaming:** Ring-Puffer um den Spieler (z. B. Radius 5 Zonen voll, 6–10 vereinfacht). Höhen per Heightmap-Downsample für Fern-Chunks.
- **UV-Rotation aus der Variety-Noise (`TerrainSplat.ts`):** Die Tile-UVs werden pro Pixel um `noise.r · 2π` gedreht (three.js-Referenz: `vec2 uv = mat2(ca,sa,-sa,ca) * wuv`). Ohne diese Drehung wiederholt sich jede Tile-Textur stur im 2-m-Raster — genau der gleichförmig gekachelte Boden, den der Nutzer als „Boden braucht noch Texturen" gemeldet hat. War hier mit dem Vermerk „erzeugt harte Nähte" abgeschaltet; die Referenz fährt dieselbe Rotation auf denselben absoluten Welt-UVs ohne das Problem (der Winkel ändert sich durch die bilineare Filterung stetig, `fract()` + 0.02-Inset in `sampleLayer()` fangen den Rest ab — beides bei uns identisch vorhanden).
- **Fels an Hängen:** `rockK = clamp((0.87 − ny)/0.15, 0, 1) · 0.85` — die Rampe beginnt bei **30°** Hangneigung und ist bei **44°** voll ausgefahren.
  - ⚠️ **Korrektur 16.08.2026 (Roadmap E4).** Hier stand bis heute die Referenzformel `clamp((0.72 − ny)/0.25, 0, 1) · 0.85` als aktueller Stand. Das war seit der Nachmessung überholt — der Code führt die Werte oben. Damit sind **drei** Stände auseinanderzuhalten:
    1. `0.72 / 0.25` — die three.js-Referenz. Ihre Rampe *beginnt* erst bei 44°.
    2. `0.85` + schmale, rauschverschobene Rampe — eine **frei erfundene** Variante, die den gesprenkelten Fels/Moos-Rand eines Screenshots nachbauen sollte. Zurückgenommen und nicht wieder aufzunehmen: Der körnige Eindruck im Original entsteht nicht im Blend, sondern aus der Tile-Textur, der UV-Rotation und den Tile-Normal-Maps.
    3. `0.87 / 0.15` — **der heutige Stand, abgestimmt statt rekonstruiert.** Grundlage ist die Auszählung der Vertex-Normalen über 40 Chunks: 80,7 % des Geländes liegen unter 26°, 12,4 % bei 26–35°, 4,7 % bei 35–44°, **2,2 % über 44°**. Mit der Referenzschwelle konnte Fels also auf 2 % der Fläche überhaupt erscheinen und war erst ab 62° voll ausgefahren — auf 0,03 % der Vertices. Genau das war die Meldung „Berghänge ohne Steintextur". Die heutige Rampe trifft die ~13 % Hangfläche und lässt die 80 % Flachland unberührt.
  - Der Original-Shader führt die Schwelle selbst, liegt im Export aber nur als 0-Byte-Datei vor (die Materialdaten nennen keine). Eine bit-genaue Rekonstruktion ist damit nicht möglich — deshalb abgestimmt, und deshalb steht die Herleitung hier.
- **Tile-Normal-Maps (G-TEX2) ✅:** Blend über dieselben Eckgewichte wie die Diffuse-Tiles, dann tangentenfreie Störung nach Schüler (Basis pro Pixel aus `dFdx/dFdy` von Weltposition und UV) — unsere Terrain-Geometrie führt keine Tangenten mit. Umgesetzt als `CustomBlock` im NodeMaterial (echtes GLSL statt Blockgraph). **Ohne diese Ebene ist das Terrain nur eine flach beleuchtete Farbfläche** — genau der vom Nutzer gemeldete „wir sehen immer noch das Standard-Terrain als Untergrund"-Eindruck. Wichtig: beleuchtet wird mit der gestörten Normalen, die Fels-/Schnee-Schwellen benutzen weiter die **geometrische** (sonst flackern Fels- und Schneegrenzen mit dem Texturdetail).
  - ⚠️ **Korrektur 16.08.2026 — es sind sieben Karten, nicht drei.** Hier stand: „`terraintile_n_0/1/2.png`; der Rip enthält kein 16-Ebenen-Normal-Array, nur drei Rauheitsgruppen; die Zuordnung Tile→Gruppe ist 1:1 aus der Referenz gespiegelt." Das beschrieb die Grenze des Exports, nicht die des Materials: `Heightmap_basematerial` führt neben dem Array **fünf eigene** Normal-Maps mit sprechenden Slots (`_CliffNormal`, `_ForestNormal`, `_SnowNormal`, `_PavedNormal`, `_CultivatedNormal`), und die drei „Rauheitsgruppen" waren nichts als die entpackten Layer 0–2 desselben Arrays — Fels bekam damit dieselbe Körnung wie Sumpfschlamm. `normalTexs` in `TerrainSplat.ts` hat heute sieben Einträge (`terraintile_n_0`, `forest_n`, `terraintile_n_1`, `cultivated_n`, `gouacherock_big_n`, `paved_n`, `snow_normal`). `terraintile_n_2` gibt es nicht mehr.

**Asset-Stand (2026-07-27, überholt):** Alle 16 Tiles in `terrain_d_array.png` sind gefüllt (per `tools/png-stats.mjs --slices 16` mit korrekter Rückrechnung der PNG-Zeilenfilter gemessen — eine frühere Prüfung ohne Filter-Rückrechnung war nur indikativ). Der damalige Abgleich gegen `/root/valheim_browser_assets` ergab: von den Texturen **und** Modellen, die die three.js-Referenz benutzt, fehlt keine einzige.

⚠️ **Diese Prüfung ist seit dem 16.08.2026 hinfällig** — und zwar nicht, weil sie falsch war, sondern weil ihre Bezugsgröße weg ist. `/root/valheim_browser_assets` und der AssetRipper-Export existieren auf keinem Container mehr; `terrain_d_array.png` und alle Normal-Maps erzeugt `tools/terrain-texturen.py` selbst, mit den vom Shader vorgegebenen Maßen und der Tile-Reihenfolge aus dem `TILE`-Enum. Die Frage „fehlt uns etwas gegenüber der Referenz?" hat sich damit erledigt; an ihre Stelle tritt „stimmen unsere erzeugten Karten mit dem überein, was der Shader erwartet?" — siehe [04-Asset-Pipeline.md](04-Asset-Pipeline.md).

### 3.2 Warum der Boden trotzdem flach aussieht — gemessen, nicht geraten

Der Nutzer meldete „wir sehen immer noch das Standard-Terrain als Untergrund". Der Verdacht lag zuerst bei unserem Shader; die Messungen zeigen etwas anderes:

| Tile | Streuung (sd) | Nachbardifferenz |
|---|---|---|
| #0 Gras | 4.3 | **0.91** |
| #9 Sand | 5.6 | 3.82 |
| #4 Fels | 15.9 | 3.82 |
| #12 Gepflastert | 21.8 | 7.64 |
| #15 LavaKruste | 56.6 | 14.61 |

**Die Gras-Kachel hat praktisch keine Binnenstruktur** (0,91 Helligkeitsunterschied zwischen Nachbarpixeln). Im Render messen wir im Sand 2,0 — das passt exakt zur Quelltextur. Wir geben also korrekt wieder, was da ist; die Quelltexturen sind bei 256² schlicht fast strukturlos. Die Einzeldateien `terraintile_*.png` sind statistisch identisch zu den Atlas-Schnitten, die Verpackung ist ebenfalls in Ordnung.

**Drei Hypothesen getestet und widerlegt** (jeweils A/B-Render mit Messung der Nachbardifferenz im Sand):
- UV-Rotation zerstört die Mip-Auswahl → 2.00 (mit) vs 2.10 (ohne) — **kein Unterschied**
- Bloom strahlt den Kontrast weg → 1.98 (an) vs 2.07 (aus) — **kein Unterschied**
- Falsches Material/fehlende Texturen → Laufzeit-Probe: Material ist `terrainSplat` (NodeMaterial, nicht der Vertexfarben-Fallback), alle Texturen geladen, `terrainNormalPerturb` und `dFdx` stehen im kompilierten Fragment-Shader, die drei Normal-Maps sind gebunden — **alles korrekt**

**Der Alpha-Kanal trägt Struktur — aber wofür, ist ungeklärt.** Nachbardifferenz je Tile, RGB → Alpha:

| Tile | RGB | Alpha |
|---|---|---|
| Erde | 2.37 | **18.50** |
| Klippe | 4.92 | **19.84** |
| Sumpfschlamm | 2.39 | **18.28** |
| Sand | 3.82 | **13.90** |
| Gepflastert | 7.64 | **7.78** |
| Gras | 0.91 | 0.18 |

Beim Sand ist RGB nahezu weiß — das gesamte Korn liegt im Alpha. Ein Versuch, das als Smoothness für einen Glanzterm zu nutzen, war jedoch **nachweislich falsch**: `Heightmap_basematerial` setzt `_SmoothnessTextureChannel: 0` (Unity liest Smoothness aus der Metallic-Map, nicht aus dem Albedo-Alpha) und `_Glossiness: 0.1` (matt). Der Term brachte im Render auch keine messbare Änderung (2.00 → 1.99) und wurde wieder entfernt.

### 3.4 Die eigentliche Ursache: doppelte Gamma-Kodierung (2026-07-28) ✅

Nach der Klarstellung „es geht um das Terrain, nicht das Gras" wurde erstmals das **nackte Terrain** betrachtet — Gras per Playwright zur Laufzeit ausgeblendet (`m.name.startsWith('clutter_')` → `setEnabled(false)`). Bis dahin wurde über einen Boden diskutiert, den niemand je gesehen hatte: unser Clutter deckt ihn vollständig ab.

**Befund sofort sichtbar und quantifizierbar:**

| | RGB |
|---|---|
| Tile 0 in der Datei | (81, 112, 64) |
| Render (vorher) | (162, 185, 138) |
| Vorhersage bei Doppel-Gamma | 0.333^(1/2.2) = 0.61 → **156** |
| Render (nach Fix) | **(75, 112, 44)** |
| valheim-browser | (55, 84, 40) |

Die Tile-Werte sind **sRGB**, wurden aber als lineare Werte beleuchtet — und das ImageProcessing hängt am Ende nochmal die Gamma-Kurve an. Der Boden kam dadurch doppelt so hell heraus wie die Quelldatei; bei ohnehin kontrastarmen Kacheln bleibt ein ausgewaschener Pastellteppich, in dem die Textur faktisch unsichtbar ist. Sättigung 26 % → **61 %** (VB: 53 %).

**Fix:** `TextureBlock.convertToLinearSpace = true` auf den Diffuse-Tiles — das direkte Gegenstück zu `array.colorSpace = THREE.SRGBColorSpace` in der Referenz. Bewusst **nur** dort: Noise- und Normal-Maps sind Daten, keine Farben, und bleiben linear.

**UV-Rotation endgültig deaktiviert.** Der A/B am nackten Terrain zeigt mit Rotation großflächig verschmierte Wirbel statt Grasstruktur, ohne Rotation eine saubere gefleckte Oberfläche. ⚠️ **Methodenlehre:** Die Nachbardifferenz-Metrik erfasst das *nicht* (1.00 mit vs. 1.20 ohne) — großflächige Verzerrung ist für sie unsichtbar. Frühere Runden hatten die Rotation allein anhand dieser Zahl freigesprochen; erst der Blick aufs Bild entschied. Der ursprüngliche Projektkommentar („erzeugt Artefakte") war korrekt, die Rotation der Referenz ist hier nicht übertragbar.

### 3.3 Direkter Vergleich mit valheim-browser (2026-07-27, zweite Runde)

Auf erneute Meldung „Texturen immer noch nicht sichtbar" wurde valheim-browser lokal gestartet und **bei Mittagslicht** gerendert (dessen Default-Weltzeit 270 ist dort noch dunkel; für den Vergleichsshot temporär auf 900 gesetzt, danach zurück). Ergebnis der Regionsmessung:

| | RGB (Boden) | Varianz (sd) | Nachbardiff | Sättigung |
|---|---|---|---|---|
| valheim-browser | (55, 84, 40) | 10.0 | 4.41 | 53 % |
| wir (vorher) | (26, 61, **2**) | 3.9 | 1.64 | **98 %** |

**Kernbefund: eine Farb-Pipeline-Differenz, keine Asset- oder Splat-Differenz.** Der Blaukanal war bei uns auf 2 zerquetscht — hyper-gesättigtes Neongrün, halbierte Tonwert-Varianz. Geclippte Kanäle löschen genau die Textur-Tonwerte aus, die als „man sieht die Texturen nicht" wahrgenommen werden. VB rendert linear + `ACESFilmicToneMapping`; wir renderten Gamma + KHR-Neutral (hue-erhaltend, entsättigt nicht).

Der echte Terrain-Shader (`Heightmap.json`-Dump, `m_PropInfo` lesbar) lieferte nebenbei die vollständige Slot-Liste: u. a. `_ColorVarietyNoise` („Color Variation" — Farbfleckigkeit des Bodens, Textur nicht im Export), getrennte Normal-Maps je Untergrundtyp, `_Tess`/`_Displacement`. Kompilierter Fragment-Code ist im Dump **nicht** enthalten (nur GPU-Programm-Referenzen) — die Referenz bleibt daher valheim-browser.

**Änderungen** (jeweils einzeln per A/B-Render geprüft):
1. **Anisotrope Filterung** auf Maximum für alle Terrain-Texturen (`TerrainSplat.ts`; VB: `getMaxAnisotropy()`, wir vorher Babylon-Default 4). Headless nicht messbar (SwiftShader meldet 16×, ignoriert es aber praktisch); auf echter GPU der Standard-Fix gegen matschigen Boden im flachen Blickwinkel.
2. **Kontrast 1.2 → 1.0** (`PostProcessing.ts`): Unity wendet die 1.2 in linearem HDR an, bei uns traf sie das fertige LDR/Gamma-Bild. Messung: praktisch wirkungslos auf die Sättigungskrise (Blau blieb 2) — der Crush kam nicht aus dem Post-Processing; trotzdem korrekt, den falsch übertragenen Wert zu neutralisieren.
3. **ACES-Experiment VERWORFEN**: Tonemapping testweise auf ACES (wie VB) — machte es messbar schlechter (RGB(26,61,2) → (6,37,0)), weil Babylons ACES hier auf Gamma-LDR-Input trifft und doppelt abdunkelt. Zurück auf KHR-Neutral.
4. **Die eigentliche Ursache — doppelte Grün-Multiplikation im Gras** (`GrassClutter.ts`): Der Meadows-Tint multipliziert die Terrainfarbe (`grass_terrain_color.png`, ø(89,119,66)) auf die Halme. Das Original-Design erwartet dafür eine WEISSE Halm-Textur — unsere generierten Atlanten sind aber bereits voll grün (ø(81,122,46)). Grün × Grün = Neonteppich mit zerquetschtem Blaukanal. **Der Beweis über die Referenz:** in valheim-browser ist `grass_terrain_color.png` ein 0-Byte-Stub — der Tint-Load schlägt dort fehl, Fallback Weiß, einfache Färbung, korrekter Look. Fix: Tönung neutralisiert (Referenz-Parität), wieder aktivierbar sobald ein echter weißer Halm-Atlas existiert.

Plausibler ist **Höhe/Parallax**: dasselbe Material setzt `_Parallax: 0.02`, `_Displacement: 0.05` und `_Tess: 4.0` — das Original tesselliert und verschiebt den Boden anhand einer Höhenkarte. Solange nicht belegt ist, dass diese Höhenkarte der Albedo-Alpha ist, bleibt der Kanal ungenutzt statt geraten.

**Offen (bis 08/2026):** Eine höher aufgelöste Fassung des Tile-Arrays existiert im Client-Export nicht (`_DiffuseArrayTex` ist dort nicht enthalten, und es gibt keine gestapelte Array-Textur im `Texture2D`-Dump). Für **Wiesenboden** war in den Daten schlicht kein Detail vorhanden (Gras: RGB 0.91, Alpha 0.18) — dort hülfe nur eine zusätzliche, erfundene Detail-Ebene im Shader.

✅ **Diese Sackgasse ist seit dem 16.08.2026 keine mehr.** `terrain_d_array.png` kommt nicht mehr aus dem Export, sondern aus `tools/terrain-texturen.py`. Damit ist „im Original ist kein Detail vorhanden" kein Argument mehr: Die Binnenstruktur der Wiesenkachel ist jetzt eine Zahl in einem Skript, kein gegebener Befund. Die Maße bleiben vorgegeben (256×4096, 16 Tiles à 256²), weil der Shader sie so liest — eine höhere Auflösung wäre eine Shader-Änderung, keine Texturänderung. Der Rest dieses Abschnitts bleibt als Messprotokoll gültig; er beschreibt, *warum* die Kacheln so aussahen, und liefert die Zielwerte, an denen sich die erzeugten messen lassen.

### 3.1 Wasser — `WaterPlugin.ts` ✅

Vorlage ist der echte Water-Shader. Shader-Quellcode ließ sich aus dem Export nicht gewinnen, wohl aber die Property-Deklarationen (`m_PropInfo.m_Props`) — daraus ist die Struktur eindeutig: `_Normal` + `_NormalFine` (zwei Normal-Ebenen), `_ColorTop`/`_ColorBottom`/`_ColorBottomShallow` (Tiefen-Farbverlauf), `_FoamTex`/`_FoamHighTex`/`_RandomFoamTex`/`_CurlTex` sowie `_FoamDepth`/`_ShoreFade`/`_DepthFade`/`_WaterEdge` (Schaum als Funktion der Wassertiefe = klassischer Ufer-Schaum, **keine** gemalte Maske). Die passenden Texturen liegen bereits im Projekt und heißen exakt wie die Shader-Slots (`foam.png`, `foam_highres.png`, `random_foam.png`).

**Wellen: die ECHTE Formel.** Aus dem dekompilierten `WaterVolume.cs` portiert (`GetWaterSurface`/`CalcWave`/`CreateWave`/`TrochSin`) — zehn trochoidale Oktaven (spitze Kämme, flache Täler), Amplitude skaliert mit `mix(0, windIntensity, depth01)`, `depth01 = clamp01(tiefe/10)`. Läuft im **Vertex-Shader**; auf der CPU wären zehn Oktaven × zwei TrochSin je Vertex (~330k Trigonometrie-Aufrufe bei 16,6k Vertices) pro Frame nicht bezahlbar.

⚠️ **Behobener Fehler:** Eine frühere Eigenbau-Variante dämpfte die Wellen mit `× (1 − 0.65·shore)` ausgerechnet am Ufer auf 35 % — und verhinderte damit genau das Überspülen des Strands, das das Original zeigt (vom Nutzer gemeldet: „das Wasser überflutet den Strand nicht, Pfützen heben und senken sich nicht"). Das Original dämpft zwar auch zum Ufer hin, aber über **10 m** statt 2,5 m und mit einer Rohamplitude, die selbst bei 1 m Tiefe noch Dezimeter- bis Meterhub übrig lässt. Die three.js-Referenz dämpft überhaupt nicht — dort ist genau das der Grund, warum ihr Strand sichtbar überspült wird.

Weiter umgesetzt als `MaterialPluginBase` auf dem StandardMaterial (Muster wie `ClutterWindPlugin`), damit Beleuchtung und Nebel erhalten bleiben:
- **Ufer-Schaum** aus `_FoamTex` + `_RandomFoamTex`, gegenseitig per UV-Versatz verzerrt (Ersatz für die nicht exportierte `_CurlTex`). Stärke aus der **effektiven** Tiefe (Grundtiefe + aktueller Wellenhub) ⇒ der Saum wandert mit der Brandung.
- **Tiefen-Farbverlauf** flach → tief.
- **Feines Wellen-Detail** über die echte `_NormalFine`-Map.

⚠️ **Zweiter behobener Fehler:** Der Schaum sampelte **leere Dateien**. Die gerippten Schaumtexturen waren 0 Byte — siehe Einschränkung 33 in [Analyse-Modelle-und-Weltgenerierung.md](Analyse-Modelle-und-Weltgenerierung.md): 2.639 von 2.763 PNGs im Asset-Ordner waren leere Stubs. Die Bilddaten waren aber nur namenlos, nicht verloren; sie wurden über `tools/recover-textures.mjs` aus dem PathID-benannten Texture2D-Dump zurückgeholt. Nicht im Export enthalten: `_CurlTex`, `_FoamHighTex`, `_BubbleTexture`.

**Zahlenwerte aus dem echten `water`-Material** (`m_Floats`/`m_Colors` des Materials mit `m_Name: "water"`) — vorher standen hier durchweg Schätzwerte, die teils deutlich danebenlagen:

| Eigenschaft | vorher (geschätzt) | echt |
|---|---|---|
| `_FoamDepth` | 0.55 m | **0.20 m** |
| `_FoamColor` | ~Weiß | **0.838 neutralgrau** |
| `_DepthFade` | 6 m | **15 m** |
| `_ColorBottomShallow` | (0.24,0.42,0.42) geraten | **(0.196,0.176,0.106)** olivsandig |
| `_ColorBottom` | — | **(0.098,0.196,0.169)** |
| Deckkraft | fest 0.82 über die ganze Fläche | **tiefenabhängig 0.16 → 0.88** |

Die feste Deckkraft war ein echter Fehler: im Original ist flaches Wasser fast durchsichtig (man sieht den Grund) und wird erst mit der Tiefe blickdicht — deshalb wirkte auch die Wasserkante hart und falsch. Der Schaumsaum ist mit 0,2 m sehr schmal; das `line²` von zuvor entfiel dadurch (es hätte ihn fast weggekürzt).

> **Einrichtungsschritt (Stand 16.08.2026):** `assets/` ist gitignored, die Texturen liegen
> also nicht im Repo. Nach einem frischen Checkout einmal ausführen:
> ```
> python3 tools/wasser-texturen.py
> ```
> Das erzeugt `water_foam_real.png`, `water_randomfoam_real.png`, `water_normals_real.png`,
> `water_normals_fine.png` und `grass_terrain_color.png` — mit denselben Dateinamen und
> denselben Kanalbelegungen wie zuvor, aber gerechnet statt gerippt. Die Namen sind
> Schnittstellen zum Shader, kein Hinweis auf die Herkunft.
>
> Bis dahin stand hier `node tools/recover-textures.mjs water _FoamTex=… _Normal=…`, das die
> echten Bilddaten über die PathIDs der Material-Assets aus dem Client-Export zurückholte.
> Voraussetzung war der Export unter `/root/Valheim_Client`; den gibt es auf keinem
> Container mehr, das Skript läuft ins Leere. Die **Helligkeiten sind dabei Teil der
> Rechnung**, nicht Geschmack: Der Shader teilt den Schaum durch feste Werte
> (`r / 0.65`, `r / 0.52`) und zieht für den Curl 0,33 ab — deshalb schreibt
> `wasser-texturen.py` die Zielmittelwerte der alten Dateien fest.

**Abweichung zur Originaltechnik:** Das Original bestimmt die Wassertiefe pro Pixel aus dem Tiefenpuffer (Screen-Space). Wir lesen sie stattdessen aus einer **Grundhöhen-Textur** (`WaterDepthMap.ts`, R32F, 512², 1 m je Texel), die zonenweise direkt aus `Heightmap.heights` gefüllt wird. Das Vertex-Attribut `aDepth` (4-m-Raster) bleibt daneben bestehen, steuert aber nur noch die Wellenamplitude im Vertex-Shader — dort reichen 4 m, weil die Amplitude ohnehin über 10 m hochläuft.

Warum nicht doch ein Tiefenpuffer: der GeometryBuffer (DOF/Motion-Blur) enthält das Wasser selbst, existiert nur bei eingeschalteten Postprocessing-Effekten und zeigt mangels Plugin-Injektion in `geometry.vertex.fx` ohnehin die unverschobene Ebene. Das Refraktions-RTT wiederum gibt es bei „Wasserqualität: Aus" gar nicht — also genau dort nicht, wo die Durchsicht am dringendsten stimmen muss.

### 3.1.1 Umbau 2026-07-31

Ausgelöst durch die Meldung „merkwürdige braune Spiegelungen, ein Wellenlayer der darüber liegt und auch im Flachwasser ankommt, wo dann die Transparenz kaputt ist". Acht Punkte, alle im Bild verifiziert:

1. **Fernwasser ist jetzt ein RING** (`buildWaterRing` in `Terrain.ts`) mit exaktem Loch für die Nahfläche, auf gleicher Höhe und mit **demselben Material**. Vorher lag dort eine 2048-m-**Vollfläche** bei `WATER_LEVEL − 0.05`, also unter dem gesamten Nahwasser und über jedem Strandgrund darunter — ohne Plugin, ohne Tiefenlogik, ohne Schaum, opak. Sie war der „Wellenlayer"; bei Qualität 0 standen zusätzlich zwei Lagen à 0.82 übereinander (effektiv 0.97 Deckkraft = die „kaputte Transparenz"). Damit entfiel auch der 5-cm-Höhenversatz, der die Sortierung beim Untertauchen kippen ließ.
2. **Ein Glanzpfad statt vier.** `specularColor` des StandardMaterials auf Schwarz; Fresnel-Sockel (0.10) und der energetisch falsche `× 0.75`-Deckel entfernt; die Mikroneigung steckt jetzt in einem `sheen`-Term an der echten Wellensteilheit. Sonnenglitzern mit demselben Fresnel-Gewicht, echter Sonnenfarbe und Nachtsperre.
3. **UBO** von 16 auf 9 Einträge, nach std140 sortiert (erst vec4/vec3, dann vec2, dann float). Reine Modulkonstanten stehen als GLSL-`const` im Shader.
4. **Himmelsspiegelung richtungsabhängig.** `SKY_GRADIENT_GLSL` aus `ValheimSky.ts` wird von Kuppel *und* Wasser benutzt, im Wasser an `reflect(-viewDir, normal)` ausgewertet. Vorher las das Wasser stumpf `fogColorSun`, also den Sonnenton unabhängig von der Blickrichtung — mit bis zu 75 % Mischanteil ergab das ein flächendeckendes Braun. **Das war die Hauptursache der gemeldeten braunen Spiegelungen.**
5. **Normal-Maps im Plugin statt als `bumpTexture`.** Nur so lassen sie sich tiefen- und distanzabhängig dämpfen (`wShore`/`wFar`) und auf **Weltkoordinaten** kacheln. Über die Mesh-UV ergab `uScale = 48` je nach Fläche 10,7 m bzw. 42,7 m Kachelung — dieselbe Textur in zwei Größen mit sichtbarem Bruch an der Grenze.
6. **Render-Order explizit**: Wasser in Gruppe 1 mit `setRenderingAutoClearDepthStencil(1, false, …)`, `transparencyMode` wird beim Qualitätswechsel mitgeschaltet statt aus der Deckkraft geraten.
7. **Tiefe per Pixel** (siehe oben) — Uferlinie und Schaumsaum folgen der Küste statt dem 4-m-Gitter.
8. **Sky-Only-`ReflectionProbe`** (128², alle 15 Frames, Renderliste = nur die Kuppel) bringt Wolken, Sterne und Sonnenscheibe ins Spiegelbild. Der analytische Verlauf bleibt Fallback, bis ihr erster Durchlauf steht.

⚠️ **`water_normals_real.png` ist DXT5nm-gepackt** — `(1, y, y, x)`, X liegt im **Alpha**-Kanal. Gemessen über alle 262.144 Pixel der gerippten Fassung: `max|G−B| = 0`, und `x²+y² ≤ 1` gilt für `(A,G)` in 2000/2000 Proben, für `(R,G)` nur in 760. Als `bumpTexture` liest Babylon `(1, y, y)` und damit Unsinn; nur deshalb hing dort vorher die generische `water_normals.png`. Das Plugin entpackt selbst. **Seit die Datei selbst erzeugt wird** (`tools/wasser-texturen.py`), ist diese Packung keine Fremdvorgabe mehr, sondern eine Selbstverpflichtung: Das Werkzeug setzt B exakt gleich G und R auf 1, weil `WaterPlugin.ts` die Steigung als `vec2(wN0.a, wN0.g)` liest. Eine gewöhnlich gepackte Karte an dieser Stelle liefert `(1, y)` — das Wasser kippt dann dauerhaft in eine Richtung. `water_normals_fine` ist dagegen normal gepackt und wird als `.xyz * 2 − 1` gelesen.

⚠️ **`ReflectionProbe` braucht `scene.customRenderTargets.push(probe.cubeTexture)`.** Ohne das wird die Würfelkarte nie gezeichnet und bleibt schwarz (nachgemessen: Mittelwert der +Y-Fläche exakt 0,0,0) — ein Material-Plugin, das sie per `setTexture` bindet, zählt für Babylon nicht als Referenz. Symptom war ein durchgehend dunkles Meer.

ℹ️ **Nicht vom Wasser:** die Konsolenwarnung „used but unbound uniform buffer" tritt einmal je Ladevorgang auf und stammt **nicht** aus dem Wassershader. Nachgemessen durch Stummschalten einzelner Meshgruppen mit `gl.getError()` je Frame: im eingeschwungenen Zustand tritt sie nie auf. Zwei Hypothesen wurden geprüft und widerlegt (zu große UBOs; Plugin-Anhängen bei gesetztem `blockMaterialDirtyMechanism`).

**Sichtbarkeit:** Das Wasser bleibt komplett ausgeblendet, bis der Nah-Ring des Geländes steht (`TerrainManager.ready`). Sonst liegt beim Einloggen die 512-m-Wasserfläche über noch ungebautem Gelände und man sieht Wasser samt Schaum mitten auf dem Land. Die Zeit überbrückt `ui/LoadingScreen.ts`.

**Injektionspunkt:** Der Schaum hängt an `CUSTOM_FRAGMENT_BEFORE_FOG`, **nicht** an `..._BEFORE_FRAGCOLOR` — in `default.fragment` steht `#include<fogFragment>` vor BEFORE_FRAGCOLOR (Zeile 305 vs. 317). Danach addierter Schaum bekäme keinen Nebel ab und würde in der Ferne hell durch die Nebelwand stechen.

## 4. Vegetation & Props — Thin Instances

```ts
// Pro (Chunk × Prefab-Typ): ein Master-Mesh + Thin-Instance-Buffer
mesh.thinInstanceSetBuffer("matrix", matrixData, 16, false);
```

- **Datenfluss:** Server-SpawnSystem (vegetationData) → ZDO/Spawn-Pakete → Client gruppiert nach (Zone, Prefab) → Matrix-Arrays (Position, Rotation Y zufällig, **Scale zufällig aus min/max der Vegetationsdaten** — siehe Fallstricke in [02](02-Migration-von-valheim-browser.md#4-bekannte-fallstricke-aus-dem-analyse-bericht-p0--im-neuaufbau-von-anfang-an-richtig-machen)).
- **Foliage-Material:** `alphaMode = ALPHATEST`, `backFaceCulling = false`, Wind-Vertex-Animation via `NodeMaterial` (Zeit + Weltposition → Sinus-Verschiebung, stärker an Blatt-Vertices via Vertexfarbe/UV2).
- **Gras:** dichtes Gras als Thin Instances in reduziertem Radius (~40 m), weiter entfernt nur Terrain-Färbung.
- **Zerstörbares:** Baum fällen ⇒ Thin-Instance-Matrix entfernen (Buffer-Update) + fallendes Animations-Mesh kurz einblenden.

### 4.1 Clutter-Texturen — ausschließlich selbst gebaut

Es gibt **genau einen** Texturweg für den Bodenbewuchs, und er ist der eigene.
Jeder Name in `GrassClutter.ENTRIES.texture` liegt flach unter
`assets/textures/`, erzeugt von:

| Werkzeug | erzeugt |
|---|---|
| `tools/gen-grass-texture.py` | die drei Gras-Atlanten `grass_meadows_gen`, `grass_heath_gen`, `grass_toon1_yellow_gen` |
| `tools/clutter-texturen.py` | die übrigen acht Karten (Waldboden grün/braun, Farnwedel grün/Sumpf, Strauch, Heideblume, Schilf, Seerosenblatt) |
| `tools/wasser-texturen.py` | `grass_terrain_color.png` (die Terrainfarbe, die die Wiesentönung liefern soll — siehe unten) |
| `tools/clutter-meshes.py` | die Halm-Meshes `clutter_default/plane/fern/vass/lily` und `grasscross` unter `assets/models/` |

`applyTexture()` kennt deshalb keinen Zweig mehr, der auf eine fehlende Datei
zeigen könnte, und damit auch keine 404, die Babylon mit seiner
magenta-schwarzen Ersatzkachel beantworten würde.

**Entfallen am 2026-08-16: der HD-Clutter-Schalter.** Bis dahin ließen sich die
Gras- und Farnkarten gegen Vorlagen aus *Willybach's HD Textures* tauschen
(`Settings.hdClutter`, aufbereitet von einem inzwischen gelöschten
`tools/make-hd-clutter.py` nach `assets/textures/hd-clutter/`). Zwei Gründe für
die Entfernung, und der zweite wiegt schwerer als der erste:

1. **Fremdmaterial.** Der Codekommentar sagte „ausliefern dürfen wir sie
   nicht" — der Live-Server tat es trotzdem, die Dateien waren unter
   `/assets/textures/hd-clutter/` öffentlich abrufbar. Die Vorgabe aus
   [07-Grafik-Konzept.md](07-Grafik-Konzept.md) („streng originalgetreu, kein
   HD-Mod-Material") stand ohnehin dagegen.
2. **Eine Konstante, die auf beiden Containern verschieden stehen musste.**
   Das Paket lag nur dort, wo es jemand gebaut hatte; der Schalter war
   deshalb auf dev und live zwangsläufig unterschiedlich gesetzt — einer der
   Gründe, warum die Bäume nach jedem Abgleich auseinanderliefen.

Weggefallen ist damit auch der Sicherheitsmechanismus `hdFehlt`: Er fing die
erste 404 einer HD-Karte ab und schaltete die ganze Sitzung auf die eigenen
Karten zurück. Ohne zweiten Pfad hat er nichts mehr zu tun.

⚠️ **Was der Schalter offen zurücklässt: die Farbe der Wiese.** Gemessen
erreichte die HD-Vorlage 30 % Sättigung und traf damit den Wert des Originals
(31 %); unser `grass_meadows_gen` liegt bei 62 %. Die Wiese ist ohne den
Schalter also wieder zu grell. Der Weg dorthin ist nicht das Mod-Paket, sondern
der Originalmechanismus — weiße Maske × `grass_terrain_color`, dazu
coverage-erhaltende Mipmaps; siehe [07-Grafik-Konzept.md](07-Grafik-Konzept.md),
Stufe 3.

📌 **Lehre aus dem HD-Pfad, die für unsere eigenen Werkzeuge weiter gilt:**
Cutout-Texturen verkleinert man in 32-bit-Float ohne uint8-Zwischenschritt.
Liegt zwischen Premultiply und Division ein Byte-Schritt, wird der
Quantisierungsfehler bei dünnen Halmen mit kleinem Alpha von der Division
wieder hochmultipliziert — die halbtransparenten Ränder kamen so mit
RGB(109,144,107) statt RGB(73,104,72) heraus, bei 23 % halbtransparenten Pixeln
und Alpha-Cutout ein sichtbar ausgebleichter Grasteppich. Und vollständig
transparente Pixel bekommen die mittlere Motivfarbe, nicht Weiß: „die Farbe ist
dort beliebig" gilt nur, solange niemand sie mittelt — genau das tut die GPU
beim Mipmapping. Wer an einem Texturwerkzeug etwas ändert, sollte die
Randfarben danach gegen die Quelle messen.

## 5. Entities (ZDO → Szene)

- `EntityManager` mappt ZDOID → `TransformNode`. Statische Prefabs (Gebäudeteile!) als Thin Instances wo möglich; interaktive/animierte (Türen, Truhen, Kreaturen, Spieler) als echte Meshes mit `AssetContainer.instantiateModelsToScene()`.
- **Animation:** GLBs bringen `AnimationGroup`s mit (Idle/Walk/Run/Attack) — Mapping-Tabelle Zustand → AnimationGroup, Crossfade.
- **Interpolation:** Remote-Entities puffern 100–150 ms Server-Zustände, interpolieren Position/Rotation.
- **Kreaturen: die Bühne ist leer** (Stand 16.08.2026). Bis dahin stand hier „Kreaturen ohne Meshes (Neck, Greyling, Troll): nicht spawnbar, bis Assets gefixt sind" — das beschrieb einen Sonderfall von dreien. Heute ist es die Regel: `SPAWN_TABLE` (`shared/src/spawnData.ts`) läuft gegen `istEigenesModell()`, und Deer, Boar und Greydwarf sind Valheim-Modelle. Von drei Einträgen bleiben null; es spawnt **kein Wesen mehr**. Auch der Eikthyr-Altar verweigert die Beschwörung, statt eine unsichtbare Hülle in den Spielstand zu schreiben. Eigene Figuren (`Furloc*`, `Surtr`, `Voelva`, `PlayerAvatar`) existieren und werden über gesetzte Platzierungen bzw. injizierte Einträge in die Welt gebracht, nicht über die Streutabelle. **Folge, die dazugehört: Ohne Kreaturen wird nicht gekämpft.** Das ist der beschlossene Zwischenzustand, siehe [04-Asset-Pipeline.md](04-Asset-Pipeline.md).

## 6. Physik (Havok)

```ts
const havok = await HavokPhysics();
scene.enablePhysics(gravity, new HavokPlugin(true, havok));
```

- Terrain-Chunks als `PhysicsShapeType.MESH` (statisch) — nur für Chunks im Nahbereich.
- Spieler: **Havok Character Controller** (`PhysicsCharacterController`) — Kapsel, Slope-Limit, Steps. Ersetzt das "an Terrainhöhe kleben" des alten Clients.
- Bau-Teile: statische Bodies; Raycasts für Bau-Snapping und Interaktion via `physicsEngine.raycast`.

⚠️ **Der Bau-Zweig ist derzeit fast leer** (16.08.2026): `PieceTable` filtert gegen
`istEigenesModell()`, von neun Bau-Pieces bleiben zwei. Bis eigene Bau-Modelle vorliegen,
kann im Spiel **nicht gebaut** werden. Der Code ist unverändert vorhanden — es fehlen die
Modelle, nicht die Physik.

## 7. Performance-Budget & Werkzeuge

| Posten | Ziel |
|---|---|
| Draw Calls | < 500 im Dorf, < 300 in der Wildnis |
| FPS | 60 @ 1080p Mittelklasse-GPU, 30 @ integrierte GPU (SceneOptimizer-Stufen) |
| Vegetation | 20–50k Thin Instances sichtbar |
| Lichter | unbegrenzt registriert, Clustered-Auswertung |

- **Freeze-Politik:** Chunks nach dem Aufbau `freezeWorldMatrix()`, `material.freeze()`, `scene.freezeActiveMeshes()` für statische Layer; Entities bleiben ungefroren.
- **Inspector:** `@babylonjs/inspector` per Hotkey (`#DEBUG` im Build) — Draw Calls, Texturen-Speicher, Shader live prüfen.
- **Playwright-Shots:** Das bewährte `tools/pw-*.mjs`-Muster übernehmen (Headless-Screenshots für Regressionstests der Optik).

## 8. Tag/Nacht & Wetter (Server-getrieben)

- Weltzeit kommt vom Server (wie bisher). Client leitet ab: Sonnenwinkel, Himmelsfarbe, Nebeldichte, Mond, God-Ray-Intensität.
- Später: Regen/Schnee als GPU-Partikel + Postprocess-Anpassung; RandomEvents (z. B. "The forest is moving") dunkeln Szene ab + Fog enger.

## 9. Weltkarte (Taste M)

Die Ingame-Karte ist keine 2D-Minimap, sondern ein eigenes kleines 3D-Modell der ganzen Welt — Vorbild ist der Babylon-Playground [XKPVRC#3](https://playground.babylonjs.com/#XKPVRC#3): orthografische Kamera mit festgenageltem Alpha (Norden bleibt oben), die beim Herauszoomen in die Draufsicht kippt und beim Hineinzoomen schräg wird, mattes Licht, transparente Wasserfläche über dem Relief, runder Kartenrand.

| Datei | Aufgabe |
|---|---|
| `client/src/ui/WorldMap.ts` | Panel, eigene Engine/Szene, Kamera, Marker, Legende, Auskunftszeile |
| `client/src/ui/worldmap/mapWorker.ts` | rastert die Welt (Relief, Kartenbild, Flüsse, Baumsignaturen) |
| `client/src/ui/worldmap/MapPalette.ts` | Biome-Farben, Waldtypen, Biome-Inhalt — von Worker **und** Panel genutzt |
| `client/src/ui/worldmap/mapTypes.ts` | Maßstab (`MAP_UNIT`, `HEIGHT_EXAG`, Auflösungen) und Worker-Protokoll |
| `client/karte.html` + `client/src/mapPreview.ts` | Prüfstand: Karte allein, ohne Spielwelt |

- **Eigene Engine auf eigenem Canvas.** Die Kartenszene hat eine andere Kamera, kein Pointer-Lock und ein anderes Post-Processing; ein separater Canvas fängt seine Mausereignisse selbst ab, ohne dem `InputManager` der Spielszene dazwischenzufunken. Preis: bei offener Karte rendern beide Szenen (~30 fps statt ~50 im Prüflauf) — dafür läuft die Spiellogik ungestört weiter.
- **Worker statt Hauptthread.** 21 × 21 km Welt, ~1 Mio. `getBiome`/`getHeight`-Proben plus 263k Reliefpunkte. Der Worker baut dafür eine **eigene** `GeoManager`-Instanz aus demselben Seed und denselben Worldgen-Flags wie die Spielwelt (Instanzen lassen sich nicht über `postMessage` teilen). Die Berechnung startet direkt nach `buildWorld()`, ist nach ~10 s fertig und meldet Zwischenstände, sodass sich das Kartenbild sichtbar aufbaut.
- **Grob rechnen, fein zeichnen.** Biome/Höhe werden auf `SAMPLE_N` (1024², ≈20 m) geprobt und bilinear auf die `TEX_N`-Textur (2048², ≈10 m) hochgezogen; Flüsse werden danach aus `geo.riverPointMap` in voller Texturauflösung nachgezogen, weil sie mit 60–100 m Breite sonst stellenweise verschwinden. Das Reliefgitter liegt bei `GRID_N` (513², ≈41 m), Höhen überhöht (`HEIGHT_EXAG`).
- **"Welcher Wald" kommt aus den echten Vegetationsdaten.** `treeKindAt()` bildet `Biome` + `BiomeArea` + `getForestFactor()` auf eine Signatur ab, die der Foliage-Tabelle folgt: Laubkronen in den Wiesen (Beech/Birch/Oak), Fichten am Schwarzwaldrand und Kiefern im Kern (`Pinetree_01` hat `biomeArea = Median`, der dichte `FirTree`-Eintrag `Edge`), kahle Sumpfbäume, Herbstbirken der Ebenen, Yggdrasil-Triebe im Nebelland, Aschebäume, Eiszacken, Fels über der Baumgrenze. Gezeichnet werden sie als Thin Instances, zwei Draw-Calls je Waldtyp.
- **Prüfen:** `http://localhost:5274/karte.html?seed=<seed>` gegen das Offline-Referenzbild aus `node_modules/.bin/tsx shared/test/geo-map.ts <seed> 700` halten — beide benutzen dieselbe Farbtabelle, Norden oben, +X nach rechts.
  - Der Vite-Port ist **5274** (`client/vite.config.ts`), nicht 5273 wie hier bis 08/2026 stand.
  - `npx tsx` ist ebenfalls überholt: `tsx` stand in `devDependencies`, wurde aber zum Starten des Live-Servers gebraucht — ein sauberes `npm ci --omit=dev` hätte den Server nicht mehr hochbekommen. Seit 16.08.2026 steht es in den `dependencies` von `server/` und `admin/`, und aufgerufen wird direkt `node_modules/.bin/tsx`. `npx` löste bei **jedem** Testlauf neu auf; `scripts/run-tests.mjs` ruft die Binärdatei deshalb heute unmittelbar auf.
