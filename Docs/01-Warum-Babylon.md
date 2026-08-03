# 01 — Warum Babylon.js statt Three.js?

Der Three.js-Prototyp (`valheim-browser`) hat Server, Weltgenerierung und Asset-Pipeline validiert. Beim Client zeigten sich jedoch strukturelle Grenzen, die mit wachsendem Inhalt (viele Lichter, dichte Vegetation, große Sichtweiten) immer teurer zu umschiffen sind. Babylon.js bringt genau die fehlenden Bausteine **ab Werk** mit.

---

## Grenzen des Three.js-Ansatzes

| Problem | Auswirkung im Prototyp |
|---|---|
| **Forward-Renderer mit festem Licht-Budget** | Fackeln, Lagerfeuer, Workbench-Glühen: Jede zusätzliche Punktlichtquelle verteuert jeden Draw Call. Viele Lichter ⇒ drastischer FPS-Einbruch. |
| **Kein eingebautes Cascaded Shadow Mapping** | Sonnenschatten über eine große offene Welt sind ohne CSM entweder unscharf oder aufwendig per Hand zu bauen. |
| **Kein eingebautes Volumetric Lighting** | God Rays durch Bäume / Nebelstimmung müssten als Custom-Postprocess geschrieben und gewartet werden. |
| **Instancing-Verwaltung von Hand** | `StaticInstancer.ts` / `GrassClutter.ts` mussten InstancedMesh-Verwaltung, Chunking und Frustum-Verhalten selbst implementieren. |
| **WebGPURenderer noch in Bewegung** | API-Unterschiede WebGPU/WebGL ziehen Sonderwege und Workarounds nach sich. |
| **Keine eingebaute Physik / GUI** | Charakter-Controller, Kollision und HUD wären komplett Eigenbau bzw. Drittbibliotheken. |
| **Kein eingebauter Profiler/Inspector** | Debugging der Szene erfordert externe Werkzeuge. |

---

## Was Babylon.js mitbringt

### Beleuchtung & Schatten
- **Clustered Lighting** (`ClusteredLightingContainer`, seit Babylon 6): Dutzende bis hunderte Punktlichter pro Sichtkachel; ideal für Basen mit vielen Fackeln/Feuern. Funktioniert unter WebGPU und WebGL2.
- **CascadedShadowGenerator (CSM)**: Abgestufte Sonnenschatten über große Distanzen — Standard für Open-World-Terrain.
- **VolumetricLightScatteringPostProcess (God Rays)**: Fertiger Postprocess für Lichtstrahlen durch Vegetation; kombinierbar mit `Fog`/`FogExp2` und Screen-Space-Effekten für Mistlands-Atmosphäre.
- **DefaultRenderingPipeline**: Bloom, Tonemapping (ACES), FXAA/MSAA, SSAO2, SSR, Depth of Field — konfigurierbar statt selbst gebaut.

### Performance
- **Thin Instances**: Sehr schlanke Instanz-Datenstruktur (Matrix-Buffer), ideal für Gras/Bäume/Felsen in Zehntausender-Stückzahl; Chunk-Buffer direkt aus der Weltgenerierung beschreibbar.
- **`scene.freezeActiveMeshes()`**, `mesh.freezeWorldMatrix()`, `material.freeze()`: Draw-Call- und State-Overhead massiv reduzierbar für statische Chunk-Inhalte.
- **Octree-Subdivision** für statische Szenen (Frustum-/Occlusion-nahe Auswahl).
- **SceneOptimizer**: Automatische Qualitätsstufen (Auflösung, Partikel, Schatten) für schwächere Geräte.
- **GPU-Partikel** (Feuer, Rauch, Schnee) ohne CPU-Last.

### Engine & Tooling
- **WebGPUEngine** mit **WebGL2-Fallback**: derselbe Szenen-Code, einmal geschrieben.
- **Inspector / Debug Layer** (`@babylonjs/inspector`): Szene, Materialien, Draw Calls, Speicher live im Browser inspizieren — ersetzt einen Großteil der bisherigen Playwright-Diagnose-Skripte beim Rendering-Debugging.
- **NodeMaterial**: Shader (z. B. Gras-Wind, Wasser) per Node-Editor oder Code, ohne GLSL von Hand.
- **WaterMaterial, SkyMaterial** aus `@babylonjs/materials` als Startpunkt für Ozean/Himmel.

### Physik, Assets, UI
- **Havok Physics** (`@babylonjs/havok`, WASM, offiziell): Character-Controller, Raycasts, Kollision für Bauen/Terrain.
- **glTF/GLB + KTX2 (BasisU) + Draco**: nativ unterstützt — die bestehende Asset-Pipeline bleibt unverändert nutzbar.
- **Babylon GUI**: HUD, Inventar, Karten-Overlay direkt in der Engine (2D) — kein separates DOM/CSS-Layer nötig (optional auch Mischbetrieb).

---

## Erwartete konkrete Gewinne für dieses Projekt

1. **Basis-Beleuchtung skaliert**: Clustered Lighting löst das Fackel-Problem strukturell statt per Licht-Budget-Hack.
2. **Weniger Client-Eigenbau**: CSM, God Rays, GUI, Physik, Inspector entfallen als Entwicklungsaufgaben.
3. **Server/Shared/Tools bleiben**: ~80 % der bisherigen Arbeit (siehe [02](02-Migration-von-valheim-browser.md)) wandert unverändert weiter.
4. **Besseres Debugging**: Inspector ersetzt ratenbasiertes Debugging; reproduzierbare Render-Zustände sind schneller auffindbar.

---

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Lernkurve Babylon-API (Node/TransformNode statt Object3D, Observables statt Events) | Mapping-Tabelle in [02](02-Migration-von-valheim-browser.md); kleine Spikes pro Feature |
| Bundle-Größe (Babylon ist groß) | ES6-Packages (`@babylonjs/core`) + Tree-Shaking; gezielte Imports |
| WebGPU-Reife in Browsern | WebGL2-Fallback bleibt dauerhaft eingerichtet und im CI getestet |
| Clustered-Lighting-Kosten auf schwacher Hardware | SceneOptimizer-Stufen; Licht-Reichweiten/Dichte begrenzen; Fallback auf wenige Lichter |
