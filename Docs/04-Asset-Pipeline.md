# 04 — Asset-Pipeline

Die Pipeline aus `valheim-browser` bleibt die Quelle. Babylon.js lädt GLB/glTF + KTX2 + Draco nativ — es ändert sich nichts am Format, nur der Client konsumiert sie über `SceneLoader`.

---

## Ist-Zustand (aus dem Analyse-Bericht, 22.07.2026)

| Schritt | Werkzeug | Ergebnis |
|---|---|---|
| Quelle | `Valheim_Client/Valheim/valheim_Data` (Linux-Client 0.221.12) | — |
| Extraktion | AssetRipper 1.3.14.0 (GUI), PNG-Export, DirectExport, StaticMeshSeparation | `tools/assetripper/export/` |
| Modelle | 1:1-Kopie der PrefabHierarchyObject-GLBs | `valheim_browser_assets/models/` — **7463 GLB, 4,8 GB**, Texturen eingebettet |
| Sprites | Item-Icons | `valheim_browser_assets/sprites/` — 1595 Icons |
| Audio | **entfällt** — Valheim-Aufnahmen werden nicht verwendet, die `.ogg` sind aus dem Export gelöscht | `assets/audio/` enthält nur eigene Musik |
| Index | `manifest.json` (4687 Einträge, Vertex/Face-Zahlen) | ⚠️ ohne Bounding-Boxen/Skalen |
| Kompression | **keine** (kein KTX2, kein Draco) | 4,8 GB Rohbestand |

**Maßstäbe:** GLBs sind maßstabs-korrekt (Unity-Meter, Prefab-Hierarchie als glTF-Nodes). Kein Rescaling in der Pipeline nötig — und im Client verboten (siehe Fallstricke, [02](02-Migration-von-valheim-browser.md)).

---

## Zielbild für valheim-babylon

```
assets/ (Extern: valheim_browser_assets — per Vite publicDir/Symlink eingebunden)
├── models/            GLB, unverändert
├── models-fixed/      *_fixed.glb (Kreaturen mit gebackenen Meshes, aus valheim-browser übernommen/erweitert)
├── sprites/           Item-Icons (Babylon GUI / Inventar)
├── audio/             eigene Musik/Sounds (MP3) — keine Valheim-Aufnahmen
├── env/               .env-Datei (IBL) für PBR — einmalig aus Himmel-Setup backen
└── manifest.json      erweitert: Bounding Boxes, Node-Skalen, Animationsliste, Foliage-Flag
```

### Schritt 1 — Manifest erweitern (Phase 2)
Einmal-Lauf (Node-Skript in `tools/`): alle GLBs parsen (bestehende `glb-dump.js`/`glb-bbox.js`-Tools nutzen) und `manifest.json` anreichern um:
- **Bounding Box** inkl. Node-Hierarchie-Scale (echte Weltmaße)
- **Animationsliste** (AnimationGroup-Namen pro Modell)
- **Foliage-Flag** (hat Alpha-Test-Texturen → Foliage-Material-Profil)
- **Mesh-los-Flag** (Bone-Rigs wie Neck/Greyling/Troll → nicht spawnbar markieren)

### Schritt 2 — Kreaturen-Fixes (Phase 2/6)
- `*_fixed.glb`-Verfahren aus `valheim-browser` übernehmen (Bind-Space-Bake + Textur-Injektion, dort für Boar/Deer/Greydwarf erledigt).
- Ausstehend: `Neck.glb`, `Greyling.glb`, `Troll.glb`, später Skeleton/Eikthyr — meshed Varianten aus dem Ripper-Export suchen oder nachbacken.

### Schritt 3 — Audio: eigene Quellen statt Ripper-Export
Der Ton kommt **nicht** aus dem Valheim-Export. Die früher übernommenen
`.ogg` (Biom-Musik, Wind, Schritte, One-Shots) sind gelöscht, ebenso alle
Audio-Dateien im Ripper-Export selbst; `tools/extract-audio.mjs` ist
entfallen. In `assets/audio/` liegt nur eigenes Material — aktuell
`hintergrundmusik.mp3`, die `GameAudio` als einzigen Loop abspielt.
Weitere Sounds (Schritte, Wind, Treffer) müssen aus lizenzfreien oder
selbst erzeugten Quellen kommen.

### Schritt 4 (optional, später) — Kompression
Erst wenn Bandbreite/Speicher zum Problem wird:
- KTX2/BasisU für eingebettete Texturen via `gltf-transform` (UASTC für Foliage wegen Alpha-Schärfe, ETC1S für Rest)
- Draco/Meshopt für große Location-Modelle
- ⚠️ Nicht vor Phase 3 — die 4,8 GB lokal sind unkritisch; Kompression kostet Iterationszeit in der Entwicklung.

---

## Lade-Strategie im Client

- `SceneLoader.ImportMeshAsync` für interaktive/animierte Modelle → `AssetContainer` cachen, pro Entity `instantiateModelsToScene()`.
- Für Thin Instances: nur die **Geometrie** des Master-Meshes nötig — einmal laden, danach nur noch Matrix-Buffer.
- Lazy-Load pro Zone: Modell wird beim ersten Auftauchen eines Prefabs in Sichtweite geladen; Platzhalter (Bounding-Box-Billboard) bis dahin.
- Preload-Liste beim Connect: Spieler-Modelle, HUD-Sprites, Terrain-Texturen, häufigste Meadows-Vegetation.
