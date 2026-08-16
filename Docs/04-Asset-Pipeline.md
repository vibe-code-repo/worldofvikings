# 04 — Asset-Pipeline

> **Stand 16.08.2026.** Dieses Dokument beschrieb bis dahin den AssetRipper-Weg: Valheim
> entpacken, GLBs kopieren, Manifest anreichern. Dieser Weg ist beendet. Das Projekt baut
> seine Modelle ausschließlich selbst. Der alte Weg steht weiter unten — er erklärt, woher
> die 7.463 Modelle kamen, mit denen zwei Monate lang entwickelt wurde, und warum sie
> gegangen sind.

Babylon.js lädt GLB/glTF + KTX2 + Draco nativ; am Format ändert sich nichts, der Client
konsumiert weiterhin über `SceneLoader`. Was sich geändert hat, ist die **Herkunft** der
Dateien.

---

## Ist-Zustand: eigene Modelle, sonst nichts

`assets/` ist gitignored — die Dateien liegen nicht im Repo, das **Rezept** liegt im Repo.
Das ist die tragende Regel dieser Pipeline: Jede Datei unter `assets/` muss sich aus einem
Werkzeug unter `tools/` reproduzieren lassen, mit denselben Parametern, mit denen sie
entstanden ist. Deshalb stehen Seeds und Höhen in `tools/baeume-bauen.sh` als feste Liste
und nicht als Vorschlag.

| Ordner | Bestand | Erzeugt von |
|---|---|---|
| `assets/models/` | 119 GLB — Bäume, Sträucher, Blumen, Felsen, Clutter-Meshes, Grabhügel, NPCs, Spieleravatar | `tools/baeume-bauen.sh`, `buesche-bauen.sh`, `blumen-bauen.sh`, `felsen-bauen.sh`, `grabhuegel-bauen.py`, `clutter-meshes.py`, `tripo-generate.mjs`, die `*-rig.py`-Reihe |
| `assets/textures/` | 66 PNG — Rinde/Laub je Art, Bodenbewuchs, die neun Terrainkarten, die vier Wasserkarten | `terrain-texturen.py`, `wasser-texturen.py`, `clutter-texturen.py`, `gen-grass-texture.py`, `blumen-texturen.py`, `busch-texturen.py`, `felsen-texturen.py`, `eiche-texturen.py`, `grabhuegel-texturen.py` |
| `assets/sprites/` | 26 Item-Icons | `tools/item-icons.py` (64², gezeichnet, nicht extrahiert) |
| `assets/audio/` | `hintergrundmusik.mp3` | eigenes Material; Valheim-Aufnahmen wurden nie verwendet |

Gesamt: **212 Dateien, 158 MB.** Vorher waren es 11.869 Dateien und 5,1 GB.

**Zwei Erzeugungsarten, bewusst nebeneinander.** Prozedural (Sapling/Blender-Skripte,
`felsen-generieren.py`, `blumen-generieren.py`) für alles, was in Varianten gebraucht wird —
sieben Tannen unterscheiden sich nur in Seed und Zielhöhe, und derselbe Aufruf liefert
Baum für Baum denselben Baum. Generativ über
[Tripo](https://www.tripo3d.ai) (`tools/tripo-generate.mjs`) für Einzelstücke, die sich
prozedural nicht sinnvoll beschreiben lassen. Beim generativen Weg ist `face_limit` der
entscheidende Parameter: ohne ihn kam der erste Baum mit 1.907.396 Dreiecken und 70 MB
zurück — Valheims `Pinetree_01` hat 2.532.

### Die Whitelist ist der Kern

`EIGENE_MODELLE` in `shared/src/prefabs.ts` listet jedes Modell, das es geben darf;
`istEigenesModell(name)` ist der Test. Die Liste ist **handgepflegt und nicht heuristisch**:
Ob ein Prefab aus dem Valheim-Paket oder aus unseren Werkzeugen stammt, steht ihm nicht am
Namen an.

Sie wird an allen Entstehungsstellen der Welt abgefragt — `features.ts`, `vegetation.ts`,
`spawnData.ts`, `items/itemDefs.ts`, `items/PieceTable.ts`, `worldlayout/pruefung.ts`,
`SpawnSystem`, `DungeonManager`. Gefiltert wird jeweils **beim Aufbau der Tabelle**, nicht
erst beim Benutzen: Sonst sähen Editor, Client und Server verschiedene Tabellen, je nachdem
wer gerade fragt.

Wer ein neues Modell baut, trägt es hier ein — sonst existiert es für das Spiel nicht,
auch wenn die GLB unter `assets/models/` liegt.

### Was das kostet — und warum es trotzdem so ist

Nach dem Filter stehen die Originaltabellen praktisch leer da: 146 Locations → 0,
3 Spawn-Einträge → 0, 25 Gegenstands-Modelle → 0, Bau-Pieces 9 → 2. Die Streutabelle
FOLIAGE speist sich nicht mehr aus `vegetation.pkg`, sondern aus `shared/src/flora.ts`
(174 Rohe → 73 eigene).

**Folge, die klar dastehen muss: Bis eigene Modelle vorliegen, kann im Spiel nicht gebaut
und nicht gekämpft werden.** Das ist ein bewusst gewählter Zwischenzustand, kein Defekt.
Die Alternative — Valheim-Prefabs weiter buchen und nur clientseitig ausblenden — wurde
verworfen: Dann stünden Geister-ZDOs im Spielstand, die später nicht mehr zu der Buchung
passen, die mit eigenen Modellen entsteht.

### Auch die Texturen sind eigene — die Namen täuschen

Ein Blick in `assets/textures/` legt einen falschen Schluss nahe: Dateien wie
`terrain_d_array.png`, `water_normals_real.png`, `vass_texture01.png` oder
`autumn_ormbunke_green.png` heißen wie ihre Valheim-Vorbilder. Sie sind es nicht — die
Namen sind **Schnittstellen**, weil die Shader sie so ansprechen. Erzeugt werden sie von
`tools/terrain-texturen.py` (die neun Bodentexturen), `wasser-texturen.py` (vier
Wasserkarten plus `grass_terrain_color.png`), `clutter-texturen.py` und
`gen-grass-texture.py`.

Diese Werkzeuge sind der Grund, warum die Löschung des Exports überhaupt möglich war.
Solange `TerrainSplat.ts` ohne `terrain_d_array.png` schwarzen Boden zeichnete, hing der
ganze Client am Rip.

⚠️ **Damit ist `tools/recover-textures.mjs` gegenstandslos geworden.** Es holte Texturen
über die PathIDs der Material-Assets aus `Valheim_Client/extracted_assets/` zurück (siehe
[03-Rendering-und-Engine.md](03-Rendering-und-Engine.md) §3.1 und Einschränkung 33 im
Analyse-Bericht) und war der Weg, auf dem die Wasser- und Terrainkarten ursprünglich ins
Projekt kamen. Der Client-Export unter `/root/Valheim_Client` existiert auf keinem
Container mehr; das Skript liegt noch in `tools/`, läuft aber ins Leere.

Die Maßvorgaben der Shader sind dadurch zu **harten Vorgaben der Werkzeuge** geworden: die
Tile-Reihenfolge (`TILE`-Enum), die Kanalmittel des Variety-Noise (0.456 / 0.312 / 0.497)
und die DXT5nm-Packung `(1, y, y, x)` von `water_normals_real.png` stehen im Kopf der
jeweiligen Python-Datei. Wer eine gewöhnlich gepackte Normal-Map dort ablegt, bekommt als
Steigung `(alpha, grün) = (1, y)` — das Wasser kippt permanent in eine Richtung.

Ausdrücklich nicht geblieben ist Mod-Material: `hdClutter` und die Texturen aus
*Willybach's HD Textures* sind restlos entfernt, siehe
[07-Grafik-Konzept.md](07-Grafik-Konzept.md) Stufe 3.

---

## Der alte Weg (22.07. – 16.08.2026) — AssetRipper

Er gehört hierher, weil er zwei Monate Projektgeschichte erklärt: fast jede Messung in
[03](03-Rendering-und-Engine.md) und [07](07-Grafik-Konzept.md) ist an diesen Dateien
entstanden, und viele Befunde gelten weiter.

| Schritt | Werkzeug | Ergebnis |
|---|---|---|
| Quelle | `Valheim_Client/Valheim/valheim_Data` (Linux-Client 0.221.12) | — |
| Extraktion | AssetRipper 1.3.14.0 (GUI), PNG-Export, DirectExport, StaticMeshSeparation | `tools/assetripper/export/` |
| Modelle | 1:1-Kopie der PrefabHierarchyObject-GLBs | **7463 GLB, 4,8 GB**, Texturen eingebettet |
| Sprites | Item-Icons | 1595 Icons |
| Audio | **entfiel schon damals** — die 3318 `.ogg` des Exports wurden gelöscht, Valheim-Aufnahmen kamen nie zum Einsatz | — |
| Index | `manifest.json` (4687 Einträge) | ohne Bounding-Boxen/Skalen |
| Kompression | keine (kein KTX2, kein Draco) | 4,8 GB Rohbestand |

**Was daran gut war und weiter gilt:** Die GLBs waren maßstabs-korrekt (Unity-Meter,
Prefab-Hierarchie als glTF-Nodes) — kein Rescaling nötig, und im Client verboten. Genau
diese Erkenntnis ist der Kern von
[Analyse-Modelle-und-Weltgenerierung.md](Analyse-Modelle-und-Weltgenerierung.md) und der
Grund, warum unsere eigenen Modelle ihre Maße heute über `renderScale` in
`shared/src/prefabs.ts` führen statt über geratene Höhen-Hints.

**Warum der Weg beendet wurde.** Es war fremdes Material, das ein öffentlich erreichbarer
Server ausgeliefert hat — was der Client lädt, ist abrufbar. Dazu kamen zwei praktische
Gründe: Der Export lag nur dort, wo ihn jemand gefahren hatte, und war damit eine ständige
Quelle von Unterschieden zwischen den Containern; und der Bestand war zu 95 % ohnehin
unbrauchbar (2.639 von 2.763 PNGs waren 0-Byte-Stubs, kein einziges der 7.471 GLBs führte
Animationen oder Skins — Einschränkungen 28/28b/33 im Analyse-Bericht).

Am 16.08.2026 wurde der Export von live gelöscht: 11.869 Dateien, 5,1 GB.
`tools/assetripper/` enthält nur noch `compile_time.txt` und `openapi.json`.
`tools/asset-extractor/` katalogisierte ohnehin nur Bundles und war nie die echte Pipeline.

**Damit hinfällige Pläne aus der alten Fassung dieses Dokuments** (sie standen hier als
Schritte 1–4 und sind nie ausgeführt worden):

- *Manifest anreichern* (Bounding Boxes, Animationslisten, Foliage-Flag) — es gibt kein
  `manifest.json` mehr, und im heutigen Quelltext greift nichts mehr darauf zu. Die Maße
  stehen in `HINT_DEFS`/`renderScale`, das Foliage-Flag ergibt sich aus `FOLIAGE_HASHES`.
- *Kreaturen-Fixes* (`*_fixed.glb` für Neck/Greyling/Troll) — gegenstandslos: Kreaturen
  kommen aus eigenen Modellen (`Furloc*`, `Surtr`, `Voelva`, `PlayerAvatar`) mit eigenen
  Rigs (`tools/furloc-rig.py`, `spieler-rig.py`, `surtr-rig.py`, `rig-idle.py`).
- *Kompression (KTX2/Draco)* — weiter offen, aber weniger dringend: 158 MB statt 4,8 GB.

---

## Lade-Strategie im Client (unverändert gültig)

- `SceneLoader.ImportMeshAsync` für interaktive/animierte Modelle → `AssetContainer` cachen,
  pro Entity `instantiateModelsToScene()`.
- Für Thin Instances: nur die **Geometrie** des Master-Meshes nötig — einmal laden, danach
  nur noch Matrix-Buffer.
- Lazy-Load pro Zone: Modell wird beim ersten Auftauchen eines Prefabs in Sichtweite
  geladen; Platzhalter bis dahin.
- Preload-Liste beim Connect: Spielermodell, HUD-Sprites, Terrain-Texturen, häufigste
  Wiesen-Vegetation.

Der Platzhalter-Fall ist seltener geworden, seit die Welt nur noch aus 119 Modellen besteht
— ein vollständiger Preload ist damit erstmals realistisch.
