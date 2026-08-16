# 06 — Roadmap & Meilensteine

> **Diese Datei ist Historie, keine Arbeitsliste.** Die führende Aufgabenliste des Projekts
> wird inzwischen außerhalb des Repos geführt; hier steht der Repo-interne Vorgänger. Er wird
> weiter fortgeschrieben, aber nur nach hinten: Erledigtes wird **mit Datum gekennzeichnet**
> statt gelöscht. Eine Roadmap, aus der Erledigtes verschwindet, verliert genau das, wofür
> man sie später aufschlägt — die Frage „wann kam das rein und was war der Grund?".
>
> Wer wissen will, was als Nächstes ansteht, schaut in die externe Liste. Wer wissen will,
> warum etwas so ist, wie es ist, ist hier richtig.

Reihenfolge beachtet die Abhängigkeiten aus dem Analyse-Bericht (Weltgen existiert und ist verifiziert → Client kann direkt auf echten Daten aufsetzen). P0-Fallstricke aus [02](02-Migration-von-valheim-browser.md) sind in den betreffenden Phasen eingeplant.

---

## Block A — Betriebsmodell und eigene Modelle *(16.08.2026)*

Ein Block quer zu allen Phasen. Er hat nichts hinzugefügt, was in der Phasenordnung stünde,
aber er verschiebt den Stand mehrerer Phasen — deshalb steht er vorne und nicht hinten.

- [x] **Eine Codebasis, zwei Container.** Ein Repo, ein Branch `main` (`master` gelöscht);
      `wov-dev` (CT 102, früher `wov-bau`) und `wov-live` (CT 101) fahren denselben Klon
      unter `/opt/worldofvikings` auf demselben Commit. **Keine Quelldatei unterscheidet sich
      mehr zwischen den Containern.**
- [x] **`WOV_INSTANZ` (dev|live) aus `/etc/wov.env`** bestimmt Weltdokument
      (`server/data/welten/<instanz>.json`, in Git), Spielstand
      (`server/data/worlds/<instanz>.db.zst`) und Placement-Cache. Auflöser:
      `shared/src/instanz.ts`, unbekannter Wert bricht den Start hart ab.
      `server/data/worldlayout.json` gibt es nicht mehr; `server.yml` ist umgebungsfrei
      (`world.world` und `world.layout` entfernt).
- [x] **Nur noch eigene Modelle.** Valheim-Export von live gelöscht (11.869 Dateien, 5,1 GB);
      übrig 212 Dateien / 158 MB Eigenbau. `EIGENE_MODELLE` in `shared/src/prefabs.ts` ist
      die Whitelist, `istEigenesModell()` der Test. Gefiltert werden FEATURES (146 → 0),
      SPAWN_TABLE (3 → 0), die Bauteile des Hammers (9 → 2), die `model`-Felder der
      Gegenstände (25 → 0) und FOLIAGE (aus `vegetation.pkg` bleibt nichts, es bleiben die
      73 eigenen Einträge aus `flora.ts`). `world.features` und `dungeons.enabled` stehen auf
      `false`. hdClutter und die HD-Mod-Texturen sind restlos entfernt.
- [x] **Der Editor läuft auf beiden Containern.** `POST`/`GET /api/worldlayout` und
      `GET /api/serverlog` liegen im Betriebsdienst `admin/` (Port 2468) statt als
      Vite-Middleware; auf dev proxyt Vite dorthin, auf live nginx. Der Editor hat seit dem
      einen **Ladeweg**: Dokument beim Start per GET, und weicht der localStorage-Entwurf ab,
      entscheidet der Nutzer informiert (Gegenüberstellung mit Regionen namentlich).
      Farbband zeigt die Instanz. Einziger Schreibweg:
      `shared/src/worldlayout/layoutDatei.ts`.
- [x] **Vier Domains**, Basic-Auth am Host statt am Pfad; eine `map $host`-Weiche in nginx
      sperrt `/editor.html` und `/api/` auf allem außer dem Editor-Host.
- [x] **Ausrollen:** `tools/wov-update.sh` ersetzt `tools/deploy.sh` (gelöscht). tsx steht in
      `dependencies`, aufgerufen wird `node_modules/.bin/tsx` statt `npx`. Drei systemd-Units
      (`wov-server`, `wov-client`, `wov-admin`), auf beiden Containern identisch.
      Betriebsteil ausführlich in [05](05-Server-Architektur.md).
- [x] **Neue Live-Welt** (Weltschnitt): 17 Regionen, 159 Platzierungen, alle 17 kuratiert,
      0 unbekannte Prefabs. Serverstart ~2 s statt ~37 s, weil keine Locations mehr
      platziert werden.
- [x] **Tests:** 23, Kernliste 20 — neu darin `admin/test/betriebsdienst.ts` und
      `client/test/welt-abgleich.ts`.

> **Was Block A dem Spiel genommen hat, und warum das so bleiben soll:** Bauen und Kämpfen
> sind aus, bis eigene Modelle vorliegen. Das ist keine Regression, sondern der Preis der
> Entscheidung — und er wird bewusst *im Datenbestand* bezahlt statt im Renderer. Die
> verworfene Alternative war, die Valheim-Prefabs nur clientseitig auszublenden: Dann
> stünden weiterhin Geister-ZDOs im Spielstand, die zu der Buchung, die später mit eigenen
> Modellen entsteht, nicht mehr passen. Welche Phasenpunkte davon betroffen sind, steht
> jeweils dort vermerkt.

---

## Phase 0 — Workspace & Import *(Fundament)* ✅ **erledigt (2026-07-26)**

- [x] Projektordner + Docs + Git-Repo angelegt
- [x] npm-Workspace aufsetzen (`client`, `server`, `shared`), tsconfig, Vite
- [x] Import aus `valheim-browser`: `shared/`, `server/`, `tools/` (ohne node_modules/dist) — Paket-Scope `@valheim-babylon/*`, eigenständiges Projekt
- [x] Assets **kopiert** nach `assets/` (4,9 GB, gitignored) — keine externe Referenz; Vite serviert `/assets` aus dem Projekt
      *(Überholt am 16.08.2026: Der Valheim-Export ist gelöscht, `assets/` trägt 212 eigene Dateien / 158 MB — siehe Block A.)*
- [x] **Eigene Ports:** Game-Server WS **2466**, Vite Dev **5273**, Proxy `/ws` → 2466 (valheim-browser bleibt auf 2456/5173 — Parallelbetrieb möglich)
      *(Heute: 2467 / 5274, dazu 2468 für den Betriebsdienst.)*
- [x] **Abnahme:** `shared/test/math-golden` + `geo-smoke` + `server/test/d6-smoke` grün; Server generiert Welt mit Seed `KxSYuZquuw` identisch (getGroundHeight(0,0) = 36,052001953125); Vite-Build läuft

## Phase 1 — Babylon-Grundgerüst *(Engine läuft)* ✅ **erledigt (2026-07-26)**

- [x] `Engine.ts`: WebGPUEngine + WebGL2-Fallback, Render-Loop (in `main.ts`, wird bei Wachstum extrahiert)
- [x] Kamera: Third-Person-Boom + PointerLock, WASD-Input (Walk 4,5 / Run 7,5 m/s wie Original)
- [x] `Terrain.ts`: Chunk-Meshes (64×64/Zone, 65×65 geteilte Kanten) aus `shared/worldgen` Heightmap — **echtes Terrain, kein Placeholder**; Vertexfarben (Biom/Neigung/Schnee/Sand) als Übergang bis zum Splat-Material (Phase 3); Budget-Build (2 Chunks/Frame), Ring-Puffer 9×9
- [x] Sonne + SkyMaterial + Exp-Fog, Tag/Nacht-Zyklus (30 min, `?t=0..1` pinnt die Zeit)
- [x] Babylon-Inspector per F9 (dynamischer Import)
- [x] **Abnahme:** Spawn am Welt-Ursprung auf h=36,052 (1:1 mit Server), Baseline-Shot `out/p1-baseline.png` (Playwright, `tools/pw-babylon-shot.mjs`). ⚠️ FPS im Headless-Shell nicht aussagekräftig (SwiftShader-Software-Rendering) — Messung auf echter GPU erfolgt mit Phase-3-Optimierer

## Phase 2 — Vegetation & Assets *(Welt wird lebendig)* 🟡 **Nacharbeit läuft**

- [x] Server: Spawn-Pakete um **Scale/Rotation** erweitern (P0) — *war bereits serverseitig vorhanden (Phase E aus valheim-browser mit-importiert: `ZoneManager` sendet `scaleScalar`-ZDO + Boden-Neigungs-Rotation)*
- [x] `EntityManager.ts` statt `Vegetation.ts`: Thin Instances pro **Prefab-Hash** (nicht Zone × Prefab — ein Buffer pro Prefab, Swap-Remove bei ZDO-Destroy), Matrix = `masterLocal × zdoWorld`; dynamische Entities (Kreaturen/Items/Schiffe) als Instanzen mit Placeholder-Fallback
- [x] Foliage-Material-Profil: Alpha-Test + DoubleSided + Wind — als `MaterialPluginBase` (`WindPlugin.ts`, Vertex-Sway ∝ Höhe) statt NodeMaterial; Alpha-Erkennung per Readback (`forceAlphaTest`, `backFaceCulling=false`)
- [ ] Gras-Thin-Instances (Nahbereich) — Nachfolger von GrassClutter → **Phase 3**
- [x] `AssetManager.ts`: AssetContainer-Cache, Lazy-Load pro Prefab, LOD-Filter (nur `Lod0`-Shells; Unity-GLBs tragen alle LOD-Stufen als Geschwister)
- [ ] Manifest erweitern (BBox, Animationen, Foliage-/Mesh-los-Flags) — [04](04-Asset-Pipeline.md) → **Phase 3/4**
- [x] Location-Terrain-Leveling (Unity-TerrainModifier-Parität): `LocationProxy`-ZDO → `addTerrainModifier` → `Terrain.rebuildZones`
- [x] Netzwerk-Grundgerüst: `GameSocket.ts` (Handshake, 20 Hz PlayerInput), `ZDOSync.ts` (Parser), TimeSync → Beleuchtung
- [x] **Technischer Zwischenstand:** Verbunden, rund **9500 statische ZDOs als Thin Instances sichtbar** (Buchen mit Scale/Rotation-Varianz, Felsen, Büsche), dynamische Entities aktiv, 0 Asset-Fehler
- [x] **Perf-Messung** (2026-08-03, echte GPU über Playwright): 55–58 fps eingependelt, 231 aktive Meshes (~13k ZDOs synchron, Thin Instances), 0 Asset-Fehler. Draw-Call-Zähler im HUD ist kumulativ — auf Basis aktiver Meshes liegt das Budget (<300) im Rahmen; SceneOptimizer-Profile bleiben Kür

**Gefundene & behobene Babylon-8-Fallen (Phase 2):**
- `instantiateModelsToScene` erzeugt nur `InstancedMesh`-Klone — die können **keine Thin Instances** tragen. Masters kommen daher per `container.addAllToScene()` als echte Meshes in die Szene (disabled).
- PBR hat kein `alphaMode = ALPHATEST` mehr — der Schalter heißt `material.forceAlphaTest = true`.
- MaterialPlugin-Uniforms: Typ-Strings heißen `float`/`vec4` (nicht `f32` — sonst WGSL-Syntax im GLSL → Shader-Fehler).
- `MaterialPluginBase.isReadyForSubMesh`/`bindForSubMesh` sind Methoden mit fester Signatur (keine Getter).
- 4 AssetRipper-GLBs hatten falsches `buffers[0].byteLength` im JSON-Chunk (Boar_fixed, Deer, Deer_fixed, greydwarf_fixed) — Babylon validiert das strenger als Three.js und lädt leere Buffer. Per Script auf BIN-Chunk-Länge korrigiert.
- Thin-Instance-Master müssen nach dem Erfassen ihrer vollständigen GLB-Weltmatrix auf Identität gesetzt und aus der Import-Hierarchie gelöst werden. Andernfalls wendet Babylon den Root-/Mesh-Transform einmal über `masterLocal × zdoWorld` und ein zweites Mal über die Master-World-Matrix an. Das verdoppelte unter anderem den eingebetteten `FirTree`-Scale 2 und den Y-Offset −0,33 m. Nach dem Fix sind alle geladenen Master parentlos/identisch; `FirTree.glb` misst 10,89 m und ergibt mit dem originalen ZDO-Scale 2,0–2,5 die vorgesehenen 21,8–27,2 m.
- **Folgefehler des vorigen Punkts:** Das Zurücksetzen des Masters auf Identität (Determinante immer +1) killt Babylons automatische Backface-Culling-Kompensation für Meshes mit einem gespiegelten Node irgendwo in der GLB-Hierarchie (z. B. AssetRipper-Unity→glTF-Händigkeitskonvertierung) — verifiziert in `Meshes/mesh.js` (`_getWorldMatrixDeterminant()` wird nur einmal pro Mesh aus der eigenen, jetzt identischen Weltmatrix gelesen, nie pro Thin Instance). Symptom: Steine/Baumstämme rendern von innen nach außen (man „schaut hinein" statt auf die Außenhülle). Fix: Determinante der eingefangenen `localMatrix` prüfen und bei negativem Vorzeichen `mesh.sideOrientation` einmal pro Master kompensierend umdrehen (`AssetManager.getMasters`). Betrifft nur Thin-Instance-Statik — dynamische Entities (`instantiate()`) behalten ihre reale Hierarchie und damit die korrekte automatische Kompensation.
- **GrassClutter (StandardMaterial) fehlte `useAlphaFromDiffuseTexture`:** `transparencyMode = MATERIAL_ALPHATEST` allein reicht bei `StandardMaterial` nicht (anders als bei PBR, wo `transparencyMode` den Test per Short-Circuit aktiviert). Verifiziert in `Shaders/default.fragment.js`: der späte Alphatest-Discard (`ALPHATEST_AFTERALLALPHACOMPUTATIONS`, aktiv sobald `transparencyMode` gesetzt ist) prüft die Variable `alpha`, die nur bei `#ifdef ALPHAFROMDIFFUSE` mit `baseColor.a` (Textur-Alpha) multipliziert wird — ohne das bleibt `alpha` bei `material.alpha` (=1), der Cutoff greift nie. Symptom: Gras-/Pflanzen-Karten rendern als volle opake Quads statt ausgeschnittener Blätter/Halme.
- **Mesh-lose Rigs (wie Boar/Greydwarf) sind jetzt generisch abgefangen:** `AssetManager.instantiate()` gibt `null` zurück, wenn die geladene Hierarchie 0 sichtbare Vertices hat (statt einer leeren, unsichtbaren TransformNode), damit bestehende Placeholder-Fallbacks greifen. `PlayerController` nutzt das für den Third-Person-Avatar: `PlayerUnarmed` vor `Player` versucht, sonst Kapsel-Platzhalter — in dieser Umgebung ohne Assets nicht gegen das echte `Player.glb` verifizierbar.
- **ClutterWindPlugin las die Instanz-Position falsch aus `world[3]`:** Bei Thin Instances ist die Uniform `world` die Weltmatrix der Basis-Mesh (bei GrassClutter immer Identität, da die Zellen-Mesh selbst nie bewegt wird — nur ihre Thin Instances). Die echte Instanz-Position steckt im rohen Attribut `world3` (Translations-Spalte); `finalWorld`/`world0..world3` werden erst in `#include<instancesVertex>` kombiniert, das an diesem Injection-Point (`CUSTOM_VERTEX_UPDATE_POSITION`, `default.vertex.js`) noch nicht gelaufen ist — verifiziert in `Shaders/ShadersInclude/instancesDeclaration.js` + `instancesVertex.js`. Folge: `iPos` war für **jeden** Grashalm `(0,0,0)`, der Fade/Dissolve maß also "Kamera ↔ Weltursprung" statt "Kamera ↔ Halm" — Gras verschwand isotrop ab ~20–35m Entfernung vom Startpunkt, unabhängig von Richtung oder tatsächlicher Nähe zum Spieler. Fix: `iPos = world3.xyz;` direkt aus dem Attribut lesen (per Node-Skript gegen `GeoManager`/`HeightmapProvider` als Nicht-Ursache verifiziert, bevor die Shader-Analyse den echten Fehler fand).

**Bekannte Einschränkungen (bewusst offen):**
- `?pos=x,z` ist ein reiner Client-Teleport: der Server simuliert den Spieler aus PlayerInput weiter am alten Ort → ZDO-Sektoren folgen nicht mit (Phase 4: Teleport/Positions-Paket).
- Blattwerk wirkt teils dunkel (Alpha-Dither-RGB + AssetRipper-PBR-Defaults) → Material-Tuning in Phase 3 (Biom-Splat, IBL, DefaultRenderingPipeline).
- FPS-/Draw-Call-Abnahme (≥ 20k Instances, 60 FPS, < 300 Draw Calls) auf echter GPU — zusammen mit Phase-3-SceneOptimizer; headless SwiftShader ist nicht aussagekräftig.

## Phase 3 — Beleuchtung & Atmosphäre *(der Babylon-Gewinn)* 🟡 **läuft**

- [x] **EnvSetup/EnvMan-Modell portiert** (`shared/src/environment.ts`): 4-Keyframe-Interpolation (Morning/Day/Evening/Night) für Nebelfarbe, Sonnen-Nebelfarbe, Nebeldichte und Sonnenfarbe, 2-Keyframe-Ambient, `lightIntensityDay/Night`, `sunAngle`, `alwaysDark` — Details und Quellenlage in [03 §2.1](03-Rendering-und-Engine.md)
- [x] **Tag/Nacht-Zyklus wie Valheim**: Phasenanker aus den bereits verifizierten C++-Konstanten (`TIME_MORNING/DAY/AFTERNOON/NIGHT` = Fraktion 0.1333 / 0.15 / 0.5 / 0.85) statt vier gleicher Viertel ⇒ 21 min Tag / 9 min Nacht, Dämmerung zur richtigen Uhrzeit; Sonne *und* Mond aus einem Hauptlicht; Sky-Dome an der echten (nachts untergegangenen) Sonnenposition
- [x] **Wetter folgt dem Biom** (`EnvMan.m_biomeEnvironments`) mit ~4 s Cross-Fade; `?env=<name>` pinnt eines (Konsolen-`env`-Äquivalent)
- [x] **Gerichteter Nebel** (`fogColor` ↔ `fogColorSun` nach Blickwinkel zur Sonne) — pro Frame auf der CPU, damit alle drei Material-Pfade dieselbe Nebelfarbe sehen
- [x] **Extraktions-Tool** `tools/dump-envsetup.mjs` → `shared/src/envData.json` überschreibt die handabgestimmten Farbwerte feldweise mit Ground truth aus dem lokalen AssetRipper-Export (leer ausgeliefert, gleiches Muster wie `prefabData.json`)
- [x] **Himmel nachgebildet** (`client/src/engine/ValheimSky.ts`): stilisierte Kuppel aus demselben `EnvState` — Horizont **ist** die Nebelfarbe, Zenitgradient, Sonnen-/Mondscheibe an der echten Sonnenrichtung, Sterne, prozedurale Wolken aus `rainCloudAlpha`. Ersetzt Babylons `SkyMaterial`, dessen Preetham-Modell die EnvSetup-Farben *nicht kennen kann* und daher am Horizont zwangsläufig gegen den Nebel arbeitet — Details in [03 §2.1b](03-Rendering-und-Engine.md). Komplett prozedural, braucht **keine** Assets
- [x] **GLSL-Verifikation** `tools/pw-sky-verify.mjs`: bündelt den echten Shader, rendert in Chromium (SwiftShader), 10 Messungen statt Augenschein — Horizont-Nebel-Abstand **0.002**, Naht 0.0118/Pixelreihe, Sterne 235 px; Screenshots in `tools/out/sky-*.png`
- [x] Gerichteter Nebel **pro Pixel** statt pro Frame (`engine/NebelRichtung.ts`) — in allen drei Pfaden zugleich: Standard und PBR über Regex-Ersetzung der Mischzeile in `fogFragment`, Terrain über einen `CustomBlock` in seiner eigenen Nebelkette. Nachgewiesen am übersetzten Shader je Pfad **und** an einer Messung, die nur die Nebel-Sonnenrichtung kippt: Das Wärmegefälle über die Bildbreite dreht sich von +1,43 auf −2,33, bei sonst Pixel für Pixel identischer Beleuchtung. `Lighting.directionalFogColorToRef()` ist ersatzlos entfallen — [07 Stufe 4a](07-Grafik-Konzept.md)
- [ ] **Höhennebel** (Stufe 4b): derselbe Injektionspunkt, analytisch über `vPositionW.y` integriert, damit der Dunst in Senken und über Wasser steht statt auf Bergkuppen
- [ ] CascadedShadowGenerator (4 Kaskaden) für die Sonne
- [ ] **ClusteredLightingContainer** + Licht-Pool (Fackeln/Feuer/Portale), Flicker-Noise
- [x] **Post-Process-Stack des Originals** (`client/src/engine/PostProcessing.ts`): das echte Ingame-Profil (Unity PostProcessing v2) aus dem entpackten Client übernommen — Bloom 0.3/0.7, Motion Blur 150°/10 Samples, Chromatic Aberration 0.15, *Neutral*-Tonemapping + Kontrast 1.2. DOF ist **im Original aus**. Das war die Ursache des „unser Bild wirkt hart"-Eindrucks. Werte-Tabelle und die zwei Babylon-Fallstricke beim Motion Blur in [03 §2.4](03-Rendering-und-Engine.md)
- [x] **Einstellungsmenü** (`client/src/ui/Settings.ts` + `SettingsPanel.ts`, Escape): Vegetationsqualität und Detailgrad (4 Stufen wie im Original, `GraphicsSettingInt.Vegetation`/`.LOD`) sowie Bloom/Bewegungsunschärfe/Chromatische Aberration/Kantenglättung (`GraphicsSettingBool`), persistiert in `localStorage`. Beschriftungen aus den echten Lokalisierungs-Strings des Clients
- [x] **Fels an Geländekanten** (`TerrainSplat.ts`): Die Rampe beginnt bei **30°** statt bei 44° (`clamp((0.87 − ny)/0.15, 0, 1) · 0.85`) ⇒ Hänge bekommen wieder Steintextur — [03 §3](03-Rendering-und-Engine.md)
      — *korrigiert am 16.08.2026 (E4): Hier stand „Schwelle 0.72 → 0.85 und rauschverschobene, schmale Übergangsrampe ⇒ gesprenkelter Moos/Fels-Rand wie im Original". Der gesprenkelte Rand war eine **frei erfundene** Variante und ist zurückgenommen worden — dieser Punkt feierte also ein Ergebnis, das nicht mehr im Code steht. Was blieb, ist die flachere Schwelle, und die ist ausgezählt statt geschätzt: nur 2,2 % des Geländes sind steiler als 44°*
- [x] **Wasser** (`client/src/engine/WaterPlugin.ts`): echte `WaterVolume.CalcWave`-Formel im Vertex-Shader (10 trochoidale Oktaven, Tiefe über 10 m normalisiert) ⇒ der Strand wird sichtbar überspült; Ufer-Schaum und Tiefen-Farbverlauf mit den **ausgelesenen** Materialwerten (`_FoamDepth` 0.2, `_FoamColor` 0.838, `_DepthFade` 15, `_ColorBottom[Shallow]`); tiefenabhängige Deckkraft 0.16→0.88 (flaches Wasser fast durchsichtig); echte Original-Texturen statt der 0-Byte-Stubs — [03 §3.1](03-Rendering-und-Engine.md)
- [x] **Tile-Normal-Maps (G-TEX2)** im Terrain-Splat: 3 Rauheitsgruppen, Eckgewichte-Blend, tangentenfreie Störung (`CustomBlock` mit echtem GLSL) — der Boden hat damit erstmals Oberflächenstruktur statt flacher Färbung
- [x] **Ladebildschirm** (`client/src/ui/LoadingScreen.ts`) über die Aufbauphase; Wasser bleibt bis `TerrainManager.ready` ausgeblendet (sonst Wasser + Schaum über noch ungebautem Gelände beim Login)
- [x] **Textur-Rückgewinnung** `tools/recover-textures.mjs` + Diagnose `tools/png-stats.mjs` — 95 % der Texturen im Asset-Ordner sind 0-Byte-Stubs, die echten Daten liegen PathID-benannt im Client-Export (Einschränkung 33)
      — *gegenstandslos seit 16.08.2026: Der Client-Export ist gelöscht, alle Texturen sind Eigenbau. Dasselbe gilt für `dump-envsetup.mjs` weiter oben — die Ground-truth-Quelle für `envData.json` existiert nicht mehr, die handabgestimmten Werte bleiben, was sie sind*
- [x] God Rays: waren bereits implementiert (`PostProcessing.setSunShafts`, Einstellung „Sonnenstrahlen“, bewusst default-aus — Kostenhinweis im Code) ✅ festgestellt 2026-08-03
- [ ] SSAO — bleibt bewusst zurückgestellt (dokumentierte Entscheidung in PostProcessing.ts: SSAO2 bräuchte einen Depth-Pass über Terrain+Clutter)
- [ ] SceneOptimizer-Profile (High/Medium/Low) + FPS-Ziel-Test
- [ ] **Abnahme:** Basis mit 50+ Fackeln bei Nacht ohne FPS-Einbruch; God Rays durch Baumkronen am Morgen; Playwright-Vergleichsserie Tag/Nacht

**Verifiziert (ohne Assets/Browser, per Node-Skript gegen den echten Shared-Code):**
- Sonnenaufgang/-untergang liegen exakt auf Fraktion 0.1333 / 0.85 (Elevation = 0), Mittagspeak bei 0.492 (Bogenmitte), Mitternacht −1
- Modell ist **stetig**: max. Änderung pro Schritt halbiert sich bei jeder Schrittweiten-Halbierung (Verhältnis 2.00 über 4k→64k Schritte) ⇒ kein Sprung, nur die steile Nachtflanke
- `alwaysDark` liefert über den ganzen Zyklus genau **einen** Zustand (Nebel *und* Licht auf Nacht-Keyframe gepinnt)
- Biom→Wetter-Mapping für alle 9 Biome inkl. Blend-Bitmasken
- Sichtweiten plausibel: Meadows ≈ 216–495 m, Black Forest ≈ 96–173 m, Swamp ≈ 49–69 m, **Mistlands ≈ 25–35 m**
- `dump-envsetup.mjs` gegen synthetische Fixtures beider Export-Formen (Unity-YAML mit `m_`-Prefix/`{r,g,b}` und JSON mit `{R,G,B}`): korrekte Werte, Decoys abgelehnt, unvollständige Assets als PARTIAL gemeldet, `alwaysDark: 1` → `true`
- Merge-Pfad: leerer Stub lässt Defaults unberührt; mit Fixture überschreiben extrahierte Werte feldweise und neue Namen (`Crypt`) erben fehlende Felder von `Clear`

**Vom Himmel-Shader aufgedeckte Bugs** (alle behoben, alle erst durch Messung sichtbar — Details in [03 §2.1b](03-Rendering-und-Engine.md)):
- `pow(up, 0.45)` als Gradient hat bei `up=0` unendliche Steigung → harte Kante auf dem Horizont (0.035/Pixelreihe); ersetzt durch `1 - exp(-3.2·up)`
- Unterhorizont-Abdunklung brach den Nebel-Match (0.002 → 0.155) und wurde wieder entfernt
- Sternenfeld war **leer** (0 helle Pixel): `sin()`-Hash degeneriert bei Koordinaten ~±220 in float32 → sinusfreier Integer-Hash, 235 Sternpixel

**Noch nicht visuell verifiziert:** wie das Ganze *in der echten Szene* aussieht (Terrain + Vegetation + Himmel zusammen, auf echter GPU) und die Farbwerte selbst, bis das Dump-Tool lokal gelaufen ist. Der Himmel-Shader selbst ist dagegen headless gerendert und gemessen.

## Phase 4 — Netzwerk & Entities *(Multiplayer-fähig)* 🟡 **weitgehend erledigt**

- [x] `GameSocket.ts` (Handshake, ZDOSync, 20-Hz-Input, AdminCommand, Teleport-Paket)
- [x] `EntityManager`: ZDOID → Thin Instances (statisch) / Hierarchien (dynamisch), Mesh-Collider für Räume + Felsen
- [x] Interpolation für Remote-Entities (exponentielles Gleiten, Teleport-Erkennung) ✅ 2026-08-02
- [x] Soft-Reconciliation: PlayerState trägt die Serverposition, Client zieht Drift >1,5 m weich nach (hart >8 m; im Dungeon nur x/z) ✅ 2026-08-03 — volles Rollback-Replay bewusst nicht nötig (beide Seiten rechnen dieselbe Bewegung)
- [ ] AnimationGroups-Mapping für Kreaturen (Spieler: AvatarRig; eigene NPCs: Autoplay via `PrefabDef.animation` ✅ 2026-08-02; Umschalten zur Laufzeit über den ZDO-Member `anim` — `idle`/`walk` bei Routen-NPCs, `AssetManager.wechsleAnimation` ✅ 2026-08-05)
- [x] **Abnahme bestanden** (2026-08-03): Zwei Clients („Erster“/„Zweiter“) sehen einander als Entity (Platzhalter-Kapsel — Player.glb ist mesh-los, Export-Lücke); Interpolation glättet

## Phase 5 — Gameplay *(spielbar)* 🟡 **Fundament steht, seit 16.08.2026 in Teilen stillgelegt**

> **Block A wirkt hier am stärksten.** Gebaut ist alles, was unten abgehakt steht; wirksam
> ist es nur, soweit ein eigenes Modell dahintersteht. Vom Hammer bleiben zwei von neun
> Bauteilen (KI-Kiefer und Menhir) — Boden, Wand, Tür, Dach, Werkbank, Bett und Portal sind
> Valheim-Prefabs und fallen weg. Die `model`-Felder aller Gegenstände sind auf `null`, das
> Symbol im Inventar bleibt: Der Wikinger hält nichts sichtbar in der Hand, behält aber
> Rezepte und Truheninhalte. Kreaturen spawnen keine mehr, also gibt es auch nichts zu
> bekämpfen. **Der Core-Loop ist damit vorübergehend nicht spielbar** — bewusst, und die
> Abnahme unten wartet darauf.

- [x] Havok: Terrain-Physik, `PhysicsCharacterController` (Kapsel, Sprung, Valheim-Gravitation −20), Kollisions-Fenster 48 m
- [x] Bau-Vorschau: `PlacementController` + `PieceSelection` (Hammer/Hoe/Cultivator, Ghost, Raster)
- [x] Inventar/Hotbar/Equipment (`shared/items`), WorldMap (M) mit Dungeon-Markern, Minimap mit Windzeiger (✅ 2026-08-02)
- [x] Interaktionen (Interact-Paket statt RPC-Routing): Aufsammeln → Inventar, Türen/Gitter, Truhen-Beute ✅ 2026-08-02 (Container-UI offen — bräuchte Server-Inventare)
- [x] **Hammer-Bausystem** ✅ 2026-08-03: Hammer-Item (Rezept), Piece-Tabelle (Boden/Wand/Tür/Dach/Werkbank/Bett/Portal), GLB-Ghost mit 0,5-m-Raster + 45°-Rotation (Mausrad), Materialkosten; Server: Whitelist + Distanz, persistente ZDOs mit `spieler`-Marke; mittlere Maustaste reißt nur Eigenes ab (halbe Kosten zurück)
- [x] **Ernte** ✅ 2026-08-03: Äxte fällen Bäume (60 HP → 6-10 Holz), Spitzhacken brechen Felsen (90 HP → 6-10 Stein), Büsche für alle; Waffenschaden differenziert (Faust 4 / Keule 12 / Axt 15)
- [x] **Essen** ✅ 2026-08-03: Feuerstellen braten Fleisch (E), Taste F isst → maxHP-Buff + 2 HP/s Regen (server-autoritativ, HUD in Prozent)
- [x] **Portale** ✅ 2026-08-03: baubar, E reist zum nächsten anderen Portal (Auto-Paarung; Tag-System braucht Text-UI)
- [x] Eikthyr-Opfergabe (2 Hirschtrophäen) + Mitspieler-Avatar (npc_1_walk mit Walking-Loop statt Kapsel) ✅ 2026-08-03
      — *seit 16.08.2026 antwortet der Altar „Der Altar schweigt — für Eikthyr fehlt noch ein Modell", und zwar **vor** dem Abzug der Trophäen: Sonst zahlte der Spieler für eine unsichtbare Hülle, deren ZDO als toter Eintrag im Spielstand bliebe*
- [ ] Bau-System serverseitig: Piece-Validierung + Sync
- [x] Kampf-Basis: Health im HUD, Nahkampf (Klick), Kreaturen-HP, Tod → Respawn am Weltspawn ✅ 2026-08-02 (Stamina, Betten, Crafting offen)
      — *ohne Kreaturen derzeit ohne Gegner*
- [ ] **Abnahme:** Loop "Holz sammeln → Werkbank → Basis bauen → Nacht überstehen" mit 2 Spielern
      — *nicht durchführbar, bis eigene Bauteil- und Kreaturenmodelle vorliegen (Block A)*

## Phase 6 — Content & Polish *(Valheim-Gefühl)* 🟡 **Dungeon-Block fertig, seit 16.08.2026 stillgelegt**

> Fast alles in dieser Phase hängt an Valheim-Exporten und ist seit Block A abgeschaltet —
> `world.features: false` und `dungeons.enabled: false` in `server/data/server.yml`. Der Code
> bleibt, die Buchung nicht: Locations und Dungeons würden ZDOs anlegen, die der Client nicht
> darstellen kann. Beides gilt für dev **und** live; der Verzicht auf Valheim-Modelle ist eine
> Projektentscheidung, kein Umgebungsunterschied.

- [x] Locations aus features.pkg (146, Phase F) inkl. Terrain-Leveling-Regeln (Piece-Grundfläche, Vegetations-Invariante ✅ 2026-08-02)
      — *stillgelegt 16.08.2026: alle 146 Einträge sind Valheim-Exporte, `FEATURES` ist damit leer*
- [x] **Dungeon-System** (✅ 2026-08-02, über Plan hinaus): dungeons.pkg-Parser (392 Räume), Generator-Port, **eigene Instanzen** im Koordinaten-Band x=100000, Dokumente mit eigener ID, Eingangs-Registry + Hüllen, E-Betreten/Verlassen, F4-Editor, Kartenmarker — [08-Dungeon-System.md](08-Dungeon-System.md)
      — *stillgelegt 16.08.2026: folgt zwingend aus `world.features` (ohne gebuchte Krypta kein Eingang), und die Raumteile selbst sind ebenfalls durchweg Valheim-Exporte — eine betretbare Instanz wäre ein leerer Raum aus unsichtbaren Wänden*
- [x] Kreaturen-Spawning + Wandern (G2), Wetter/Niederschlag, Kaskaden-Schatten (3 Kaskaden)
      — *Spawning stillgelegt 16.08.2026: `SPAWN_TABLE` ist auf 0 Einträge gefiltert. Wetter und Schatten laufen weiter*
- [x] **Camps in der Oberwelt** (CampRadial-Port + Boot-Backfill): Dörfer, Farmen, GoblinCamps, Ruinen-Cluster ✅ 2026-08-02
      — *stillgelegt 16.08.2026 zusammen mit den Locations*
- [x] Punktlicht-Pool (6 wandernde Lichter, Flicker, PrefabDef.light-Hints) ✅ 2026-08-02
- [x] Dungeon-Nacharbeiten: Türen/Truhen (Interact), Spawner erwachen, Regeneration leerer Instanzen ✅ 2026-08-02 (Editor-Ausbau, NPC-Wegfindung offen)
- [x] RandomEvents (verschlankt): "Der Wald bewegt sich"-Überfälle ✅ 2026-08-02
      — *ohne Kreaturen derzeit ohne Wirkung*
- [x] Kreaturen-KI: Chase + Angriff (Aggro 20 m) ✅ 2026-08-02 — Boss-Encounter offen
      — *dito: der Code läuft, es gibt niemanden, der angreift*
- [x] Audio-Grundgerüst (WebAudio) ✅ 2026-08-02 — auf eigene Hintergrundmusik zurückgebaut (2026-08-06): Valheim-Aufnahmen entfernt, Wind/Schritte/One-Shots brauchen neue, lizenzfreie Quellen
- [ ] Optional: RouteManager, Housing/Discord/REST, Lua-Modding, KTX2/Draco

**Bewusst nicht begonnen (eigene Projekte, nicht "Restpunkte"):**
- **Schiffe/Segeln**: braucht Wasser-Physik (Auftrieb auf den echten CalcWave-Wellen), Steuer-Interaktion, Mehrspieler-Sync eines bewegten Trägers — der Windzeiger auf der Minimap wartet darauf
- **Skill-System**: leveln von Laufen/Waffen — sinnvoll erst, wenn Kampf/Werkzeuge weiter ausdifferenziert sind
- **Container-UI mit Server-Inventaren**: Architekturwechsel (Inventar lebt heute clientseitig, Kosten/Loot laufen über dokumentiertes Client-Vertrauen)

**Bekannte Abweichungen vom Master-Plan:** Persistenz ist JSON+zstd statt SQLite (bewusst, `WorldManager.ts`); Assets sind Eigenbau statt Original-Export und die Welt kommt aus einem Layout-Dokument statt aus dem radialen Seed-Kreis (beides 16.08.2026, siehe [00](00-Master-Plan.md)). ~~vorbestehender tsc-Fehler in `TerrainSplat.ts:1238`~~ — behoben; `npm run typecheck` läuft über shared, server, client und admin und ist seit Block A das Tor im Ausrollskript.

---

## Meilenstein-Übersicht

| MS | Nach Phase | Definition |
|---|---|---|
| **M0** | 0 | Workspace steht, Tests grün |
| **M1** | 1 | Durch echte generierte Welt laufbar (Babylon) |
| **M2** | 3 | "Screenshot-Qualität": korrekte Wälder, Fackel-Basis bei Nacht, God Rays |
| **M3** | 4 | Multiplayer-Techdemo |
| **M4** | 5 | Spielbarer Core-Loop |
| **M5** | 6 | Feature-Parität mit dem C++-Server-Kern (ohne Mods) |

## Arbeitsregeln

- **Protokoll-Stabilität:** Änderungen an `shared/protocol.ts` nur mit Version-Bump + Abgleich beider Clients.
- **Verifikation gegen C++:** Bei jeder Portierung aus `valheim.community` Zahlenwerte 1:1 übernehmen und mit Test/Diff belegen (Vorbild: Weltkarten-Diff in valheim-browser/Docs).
- **Keine Client-Tricks für Datenfehler:** Skalen, Formen, Spawns werden in Daten/Server korrigiert, nicht im Renderer zurechtgenormt (Lehre aus der Höhen-Normalisierung).
- **Performance-Budgets aus [03](03-Rendering-und-Engine.md)** sind Abnahmekriterien, keine Empfehlungen.
