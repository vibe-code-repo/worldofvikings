# 02 — Migration von valheim-browser

Die wichtigste strategische Entscheidung: **Server, Shared-Code, Tools und Assets werden übernommen — nur der Client wird neu gebaut.** Der bestehende Three.js-Client ist früher MVP (laut [Analyse-Bericht](../../valheim-browser/Docs/Analyse-Modelle-und-Weltgenerierung.md): ~6 FPS, Placeholder-Terrain, keine Animation/Audio/LOD) — ein Rewrite auf Babylon kostet daher wenig, weil ohnehin fast alles neu entstehen musste.

---

## 1. Unverändert übernehmen (Copy)

| Quelle (`valheim-browser/`) | Ziel (`valheim-babylon/`) | Bemerkung |
|---|---|---|
| `shared/` (komplett) | `shared/` | **Kernstück.** Enthält die gegen C++ verifizierte Weltgenerierung (FastNoise, GeoManager, Heightmap, Perlin — Phasen B–D laut Analyse abgeschlossen), alle Datenpakete als JSON (vegetation, features, prefabs, spawn, terrainModifiers) und das Netzwerk-Protokoll |
| `server/` (komplett) | `server/` | Authoritativer Server: ZDO, Prefab, Zone, Spawn, Net, IO. Engine-unabhängig |
| `tools/` | `tools/` | GLB-Inspektion, Playwright-Shots, Prefab-Parser, AssetRipper-Export + Logs |
| `valheim_browser_assets/` | `assets/` (Verweis) | 7463 GLBs / 4,8 GB, Sprites, Manifest. Nicht kopieren — per Vite-`publicDir`/Symlink einbinden wie bisher |
| `server/data/` | `server/data/` | server.yml, Welten |

**Konsequenz:** Das Netzwerk-Protokoll (`shared/src/protocol.ts`) bleibt stabil. Der alte Three.js-Client und der neue Babylon-Client können parallel gegen denselben Server laufen — A/B-Vergleiche sind möglich.

## 2. Neu bauen (Babylon-Client)

| Alt (Three.js, `client/src/`) | Neu (Babylon) | Notiz |
|---|---|---|
| `engine/Renderer.ts` | `engine/Engine.ts` + `engine/SceneManager.ts` + `engine/Lighting.ts` | WebGPUEngine + WebGL2-Fallback; Sonne via CSM; God Rays; DefaultRenderingPipeline |
| `engine/Terrain.ts` (sin/cos-Placeholder!) | `engine/Terrain.ts` | **Auf Basis von `shared/worldgen` (Heightmap) — das verifizierte Terrain, kein Placeholder mehr** |
| `engine/StaticInstancer.ts` | `engine/Vegetation.ts` | Thin Instances; Skalen/Rotation aus vegetationData (s. Fallstricke unten) |
| `engine/GrassClutter.ts` | Teil von `Vegetation.ts` | Gras als Thin Instances + NodeMaterial-Wind |
| `engine/AssetManager.ts` | `engine/AssetManager.ts` | `SceneLoader.ImportMeshAsync`, GLB direkt; Container-Cache; Skeleton-Clone via `AssetContainer.instantiateModelsToScene()` |
| `engine/InputManager.ts` | `engine/InputManager.ts` | Konzept übernehmen (WASD + PointerLock), auf `scene.onPointerObservable`/DeviceSourceManager |
| `net/GameSocket.ts` | `net/GameSocket.ts` | Fast 1:1 übernehmbar — spricht nur Protokoll, kein Three.js |
| `ui/WorldMap.ts` | `ui/WorldMap.ts` | Canvas-basiert → weitgehend portierbar; Alternativ Babylon GUI |
| HUD (DOM) | `ui/HUD.ts` | Babylon GUI (AdvancedDynamicTexture) oder DOM beibehalten — Entscheidung in Phase 1 |
| `engine/AssetLog.ts` | optional | Nur Dev-Diagnose |

## 3. Three.js → Babylon.js API-Mapping (Referenz)

| Three.js | Babylon.js |
|---|---|
| `WebGLRenderer` / `WebGPURenderer` | `Engine` (WebGL2) / `WebGPUEngine` — gleiche Szenen-API |
| `Scene` | `Scene` |
| `Object3D` / `Group` | `TransformNode` (Mesh nur bei Geometrie) |
| `PerspectiveCamera` + manuelles Follow-Lerp | `FollowCamera` / `UniversalCamera` / `ArcRotateCamera` |
| `Mesh` + `BufferGeometry` | `Mesh` / `MeshBuilder` / `VertexData` |
| `InstancedMesh` | `Mesh.instancedBuffers` / **Thin Instances** (`mesh.thinInstanceSetBuffer`) |
| `DirectionalLight` + manueller Shadow-Follow | `DirectionalLight` + **CascadedShadowGenerator** |
| Punktlichter (teuer im Forward) | **ClusteredLightingContainer** |
| `FogExp2` | `scene.fogMode = FOGMODE_EXP2` |
| ACES Tone Mapping | `DefaultRenderingPipeline` (`imageProcessing.toneMapping = ACES`) |
| PCFSoft Shadow Map | `ShadowGenerator` mit Blur/PCF; CSM für Terrain |
| `GLTFLoader` + `SkeletonUtils.clone` | `SceneLoader.ImportMeshAsync` / `AssetContainer.instantiateModelsToScene` |
| KTX2Loader + Basis-Transcoder | eingebaut (`KhronosTextureBasisU`) |
| `PointerLockControls` | `camera.attachControl` + PointerLock via Engine |
| AnimationMixer | `AnimationGroup` (kommt im GLB mit) |
| requestAnimationFrame-Loop | `engine.runRenderLoop` / `scene.onBeforeRenderObservable` |
| Raycaster | `scene.pick` / Havok-Raycast |

## 4. Bekannte Fallstricke aus dem Analyse-Bericht (P0 — im Neuaufbau von Anfang an richtig machen)

Diese Fehler des Three.js-Clients **nicht mitportieren**:

1. **Keine Höhen-Normalisierung ("render hints")**: Modelle in Originalmaß laden (GLBs sind maßstabs-korrekt, AssetRipper-Export in Unity-Metern). Keine Stauchung auf geratene Zielhöhen.
2. **Zufalls-Scale + Rotation aus den Spawndaten anwenden**: z. B. Tanne Schwarzwald 2,0–2,5× (→ 22–27 m). Server liefert Scale/Rotation im ZDO/Spawn — Client wendet sie an. Aktuell spawnen Bäume ohne beides.
3. **Alpha-Cutout + DoubleSided für Nadel-/Laub-Planes**: `material.alphaMode = ALPHATEST`, `backFaceCulling = false` für Foliage — sonst "falsche Tannenform".
4. **Kreaturen-GLBs ohne Meshes**: `Neck.glb`, `Greyling.glb`, `Troll.glb` sind Bone-Rigs ohne Meshes (Stand 2026-07-25). Meshed-Varianten suchen/nach-exportieren (`tools/assetripper/export`); `*_fixed.glb`-Muster (Boar/Deer/Greydwarf) als Vorlage. Spawn-Tabellen erst erweitern, wenn Assets da sind.
5. **Instancing von Anfang an**: Der alte Client lief mit ~6 FPS ohne Instancing. Vegetation/Props kommen im Babylon-Client **nur** als Thin Instances, nie als Einzel-Meshes.
6. **Audio**: Valheim-Aufnahmen werden **nicht** übernommen. Die `.ogg` aus dem AssetRipper-Export sind gelöscht; `assets/audio/` enthält nur eigenes Material (siehe [04](04-Asset-Pipeline.md), Schritt 3).

## 5. Vorgehen beim Kopieren

```powershell
# Im neuen Workspace (valheim-babylon), nach dem Git-Init:
git checkout -b import/valheim-browser
robocopy ..\valheim-browser\shared shared /MIR /XD node_modules dist
robocopy ..\valheim-browser\server server /MIR /XD node_modules dist
robocopy ..\valheim-browser\tools tools /MIR /XD node_modules out
# package.json (Workspace), tsconfig, vite anpassen; Client NICHT kopieren
```

Danach: `npm install`, Server-Tests aus `server/test` und `shared/test` laufen lassen — sie müssen unverändert grün sein, bevor der Babylon-Client beginnt.
