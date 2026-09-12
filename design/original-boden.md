# Boden wie im Original — Spezifikation aus den Spieldaten

Gemessen am 10.09.2026 **aus den Spieldateien**, nicht aus Screenshots:
`~/.steam/steam/steamapps/common/Tale of Dark Lands/Tale of Dark Lands_Data`
(Unity 2022.3.62f2, URP, Farbraum **Linear**), gelesen mit UnityPy 1.25.3.
MonoBehaviour-Felder (Volume, VolumeProfile, URP-Asset) über Typetrees aus
den DLLs des Spiels selbst (`…_Data/Managed/`).

* Alle Rohwerte je Szene und Terrain: **`~/wov-lab-mess/original-boden.json`** (904 kB)
* Prüfbilder je Terrain: **`~/.cache/wov-lab/original-splat-<Terrain>.png`**
  (Splat in Falschfarben) und **`…-neigung.png`** (Neigungskarte)

Diese Datei ist die Spezifikation. Wo eine Zahl hier steht, steht sie
auch in der JSON — und nirgends ist eine geschätzt.

> **Die zwei DLL-Sätze sind nicht gleich.** `~/wov-assets/Assemblies/`
> enthält eine ältere `Unity.RenderPipelines.Universal.Runtime.dll`
> (761 856 statt 787 968 Bytes); mit ihr bricht das Lesen des URP-Assets
> ab. Gelesen wurde deshalb gegen `…_Data/Managed/`.

## 0 Was gelesen wurde, und welche Szene das Vorbild ist

13 Szenen, 12 Terrains. Die Zuordnung ist `levelN` ↔ `sharedassetsN`,
die Namen stehen in `BuildSettings`:

| Datei | Szene | Terrain | Größe | Höhe | mittl. Neigung |
| --- | --- | --- | --- | --- | --- |
| level0 | MainMenu | Terrain_MainMenu | 120 × 70 m | 19,4 m | 25,0° |
| level1 | Customization | Terrain_Customization | 20 × 20 m | 10,0 m | 45,4° |
| level2 | Village1 | Terrain_Village1 | 300 × 300 m | 73,0 m | 24,1° |
| **level3** | **Level1** | **TerrainL1** | **200 × 200 m** | **29,4 m** | **25,2°** |
| level4…level11 | Level2…Level9 | TerrainL2…L9 | 200–300 m | 20–92 m | 13–33° |
| level12 | DemoEnd | — | — | — | — |

**Alle drei Referenzbilder zeigen dieselbe Szene: Level1.** Der Beleg
steht im Bild selbst — in allen drei Aufnahmen steht oben rechts
derselbe Auftrag „Get rid of goblins 0/6" und oben links dieselbe
Erfahrung „0/50". Wiese, Felshang und Bergpanorama sind also **ein**
Ort, und die Zahlen von TerrainL1 gelten für alle drei Bilder.

### Der wichtigste Strukturbefund: das Panorama ist kein Terrain

TerrainL1 ist **200 × 200 m groß und 29,4 m hoch**. Das Höhenfeld hat
513² Punkte auf 0,39 m Raster; die Höhennormierung ist `h/32767 ×
scale.y`, geprüft gegen `m_MinMaxPatchHeights` (0,049045 gegen 0,049043)
und gegen `~/wov-assets/Assets/TerrainData/TerrainL1.glb`
(Y max = 29,4259 m). Ein 30-m-Hügel kann das Bergpanorama aus Bild 3
nicht erzeugen.

Die Berge sind **Meshes**. Die Mesh-Objekte der Szene reichen von
−94/−109 bis +299/+315 in x/z und bis 118,8 m Höhe — also weit über das
Terrain hinaus und viermal so hoch. Sie sind statisch zusammengefasst
(„Combined Mesh (root: scene)", 21 Batches à 40–65 Objekte, je
150–210 m Ausdehnung) und tragen die Synty-Atlasmaterialien
(`Dark 60 PolyVikings_Material_01 1`, `PolygonFantasyKingdom_Mat_01_A`).

**Konsequenz für uns:** Das Vorbild löst „Berg" nicht über die
Bodenschichten, sondern über Geometrie auf dem Boden. Jede Anstrengung,
den Panorama-Eindruck aus einer Splat-Regel zu holen, zielt auf die
falsche Ebene. Der Kommentar in `TerrainSplat.ts` bei `TRIPLANAR` sagt
das bereits richtig („seine Klippen sind Meshes") — hier sind die Zahlen
dazu.

---

## A Schichten — TerrainL1 (Level1)

Alphamap 512², also **0,39 m je Splat-Texel**; Basemap 1024;
7 Schichten in zwei `SplatAlpha`-Texturen (RGBA32).
Terrain-Material: **`TerrainLit`**, Shader
`Universal Render Pipeline/Terrain/Lit`, einziges Keyword
`_TERRAIN_INSTANCED_PERPIXEL_NORMAL`. **Kein** `_TERRAIN_BLEND_HEIGHT`,
**kein** `_MASKMAP` — keine Schicht hat eine Maskentextur, alle
`MaskMapRemap` stehen auf 0…1. `m_DrawInstanced` = true.

| # | Schicht | Diffuse | Normal | Kachel | Metallic | Glätte | NormalScale |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Ani Dark Pebbles_Sand | Ani Dark Pebbles_Sand | Ani Pebbles_Sand_normals | 2 m | 0,75 | 0,10 | 3,0 |
| 1 | Ani Dark Rockwall 3 | Ani Dark Rockwall | Ani Rockwall_Normal | 5 m | 0,20 | 0,20 | 1,5 |
| 2 | Meadow Rock Dark | Rock_Texture_01 | Rock_Normals_01 | 5 m | 0,00 | 0,00 | 3,0 |
| 3 | Moss very Dark | Moss very Dark A | Moss_Normals_01 | 2 m | 0,00 | 0,00 | 1,2 |
| 4 | Terrain_Meadow_Rock_01 | Rock_Texture_01 | Rock_Normals_01 | 7 m | 0,00 | 0,00 | 3,0 |
| 5 | Terrain_Meadow_Rock_Moss_01 | Rock_Moss_Texture_01 | Rock_Moss_Normals | 7 m | 0,00 | 0,00 | 2,0 |
| 6 | Ani Dark Pebbles_Sand under water | …under water | Ani Pebbles_Sand_normals | 2 m | 0,75 | 0,10 | 3,0 |

`m_TileOffset` ist bei allen [0, 0], `m_Specular` bei allen schwarz,
`m_DiffuseRemapMin/Max` bei allen 0…1 — also keine Remaps im Spiel.

### Die gemessene Rampe — Verteilung über Neigungsbänder

Flächenanteil = Summe der Schichtgewichte / Gesamtgewicht.
Dominanz = Anteil der Texel, auf denen diese Schicht die stärkste ist.
Zeilen normiert je Schicht (Summe der Bänder = 1).

| Schicht | Fläche | Dominanz | mittl. Neigung | 0–8° | 8–15° | 15–22° | 22–30° | 30–40° | 40–50° | > 50° |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Moss very Dark | **0,514** | 0,556 | 21,8° | 0,234 | 0,217 | 0,166 | 0,134 | 0,101 | 0,056 | 0,093 |
| Ani Dark Pebbles_Sand | 0,200 | 0,157 | 20,4° | 0,275 | 0,230 | 0,156 | 0,113 | 0,087 | 0,056 | 0,084 |
| Ani Dark Rockwall 3 | 0,168 | 0,153 | 39,5° | 0,090 | 0,091 | 0,077 | 0,095 | 0,141 | 0,142 | **0,365** |
| Pebbles_Sand under water | 0,060 | 0,060 | 16,4° | 0,242 | 0,311 | 0,198 | 0,129 | 0,084 | 0,027 | 0,009 |
| Terrain_Meadow_Rock_Moss_01 | 0,057 | 0,074 | 40,4° | 0,006 | 0,011 | 0,021 | 0,100 | **0,386** | 0,319 | 0,158 |
| Meadow Rock Dark | 0,001 | 0,000 | 59,0° | 0,007 | 0,009 | 0,009 | 0,024 | 0,055 | 0,115 | **0,781** |
| Terrain_Meadow_Rock_01 | 0,000 | 0,000 | 72,3° | 0 | 0 | 0 | 0 | 0 | 0 | **1,000** |

Flächenanteil der Neigungsbänder selbst (das Gelände, nicht die Schichten):
0–8° 20,5 % · 8–15° 19,2 % · 15–22° 14,2 % · 22–30° 12,1 % ·
30–40° 12,0 % · 40–50° 8,4 % · > 50° 13,6 %. Mittel 25,2°, Median 20,1°,
p95 64,4°, Maximum 83,4°.

### Wie hart sind die Übergänge?

Weich, und über weite Strecken. Median-Kantenbreite (aus `1/|∇w|` an
Mischtexeln, in Metern):

| Schicht | reine Texel (w > 0,95) | Mischtexel (0,05…0,95) | Kantenbreite |
| --- | --- | --- | --- |
| Moss very Dark | 19,2 % | 61,8 % | 3,3 m |
| Ani Dark Pebbles_Sand | 2,8 % | 47,7 % | 4,3 m |
| Ani Dark Rockwall 3 | 5,8 % | 31,0 % | 2,8 m |
| Terrain_Meadow_Rock_Moss_01 | 0,0 % | 13,8 % | 2,7 m |
| Pebbles_Sand under water | 5,6 % | 0,9 % | 1,0 m |

**66 % aller Texel tragen mindestens zwei Schichten über 0,05**
(in Village1 sogar 93 %). Der Boden des Vorbilds ist fast überall eine
Mischung, nicht ein Feld mit Rändern. Übergänge laufen typisch über
**2,7 bis 4,3 m**, also über 7 bis 11 Splat-Texel.

### Die Rampe ist gemalt, nicht gerechnet — mit Zahlen

Prüfbild `~/.cache/wov-lab/original-splat-TerrainL1.png` zeigt es sofort:
Fels (blau) folgt dem **Flusslauf und den Graten**, nicht einer
Höhenlinie. Der Fluss (grau, Schicht 6) zieht als S-Kurve durch die
Karte, links und rechts davon liegt ein Felsband, darum ein Sandsaum
(rot) — eine gezeichnete Landschaft.

Noch deutlicher wird es beim Nebeneinanderlegen der beiden Prüfbilder.
Die Neigungskarte (`…-neigung.png`, rot = steil) zeigt den steilsten
Boden als **umlaufenden Randwall** — die Wand, die das Spielfeld
einfasst. Genau dort malt der Autor **keinen** Fels: im Splatbild ist der
Rand gelb und orange (Moos, Rock_Moss). Sein Fels (blau) liegt statt
dessen **innen**, am Flusslauf und an den Graten, wo die Neigung
mittelmäßig ist. Die steilste Fläche der Karte und die gemalte
Felsfläche sind über weite Strecken **verschiedene Orte**.

Gegenprobe: Was würde eine reine Neigungsformel treffen?
(Fels = Summe aller drei Felsschichten, Werte in der JSON unter
`probe_steigungsrampe_gegen_gemalte_karte`.)

| Schwelle | Formel färbt | dort wirklich Fels | gemalter Fels **unterhalb** der Schwelle |
| --- | --- | --- | --- |
| ≥ 25° | 41,2 % | 0,291 | 28,9 % |
| **≥ 30°** | **34,0 %** | **0,322** | **35,1 %** |
| ≥ 35° | 27,5 % | 0,356 | 42,1 % |
| ≥ 40° | 22,0 % | 0,391 | 49,2 % |

Gemalt sind **16,9 %** Fels. Eine 30°-Regel färbt **doppelt so viel**
(34,0 %) — und verfehlt trotzdem **35 %** des Felses, den der Autor
gemalt hat, weil der unter 30° liegt.

Mittleres Felsgewicht je Band: < 15° 0,076 · 15–30° 0,110 ·
30–45° 0,216 · **≥ 45° nur 0,425**. Selbst am steilsten Hang ist der
Boden des Vorbilds **weniger als zur Hälfte** Fels — der Rest bleibt
Moos. Genau das zeigt Bild 2: grüne Moosinseln mitten in der Felswand.

> **Die Neigung erklärt den Boden des Vorbilds nur zu einem kleinen
> Teil.** Eine Formel, die auf 45° hart auf Fels stellt, ist nicht eine
> feinere Fassung dieser Karte, sondern eine andere Aussage.

### Zum Vergleich: Village1 (die Zone, gegen die das Labor kalibriert hat)

300 × 300 m, 73 m Höhe, 6 Schichten. Grundschicht ist **`Ani Grass 2`**
(Fläche 0,574, Dominanz 0,657, Kachel 2 m, Metallic **0,70**,
Glätte 0, NormalScale 2,0), dazu `Ani Dark Rockwall 3` 0,169,
`Moss Dark` 0,153, `Terrain_Meadow_Rock_Moss_01` 0,068. Kantenbreiten
sind hier noch weiter: Gras 24,5 m, Sand 16,6 m, Rockwall 7,1 m.
Village1 ist also **weicher und grüner** als Level1, das mit
`Moss very Dark` als Grundschicht deutlich dunkler angelegt ist.

### Alle TerrainLayer des Spiels und wo sie wirklich benutzt werden

Das ist die Tabelle, an der zwei Fehlzuordnungen des Labors sichtbar
werden (F25, F26). Nur Anteile über 0,5 % sind aufgeführt.

| Schicht | Kachel | Metallic | Glätte | Nrm | benutzt in (Flächenanteil) |
| --- | --- | --- | --- | --- | --- |
| Moss very Dark | 2 m | 0,00 | 0,00 | 1,2 | MainMenu 0,76 · **Level1 0,51** · L2 0,58 · L3 0,57 · L4 0,22 · L6 0,49 · L9 0,11 |
| Ani Dark Pebbles_Sand | 2 m | 0,75 | 0,10 | 3,0 | MainMenu 0,21 · **Level1 0,20** · L2 0,14 · L5 0,31 · L8 0,35 |
| Ani Snow | 2 m | 0,95 | 0,03 | 1,0 | L6 0,33 · L7 0,85 · L8 0,18 |
| Moss very Dark 1 | 2 m | 0,00 | 0,00 | 1,2 | L4 0,39 · L5 0,52 · L9 0,37 |
| **Ani Dark Rockwall** | **2 m** | **0,85** | 0,10 | 1,5 | Customization 0,23 · L4 0,20 · L5 0,13 · **L8 0,47** — *nicht* in Level1/Village1 |
| Ani Grass 2 | 2 m | 0,70 | 0,00 | 2,0 | Customization 0,56 · **Village1 0,57** |
| **Ani Dark Rockwall 3** | **5 m** | **0,20** | 0,20 | 1,5 | **Village1 0,17 · Level1 0,17** · L2 0,15 · **L3 0,29** |
| Terrain_Meadow_Rock_Moss_01 | 7 m | 0,00 | 0,00 | 2,0 | Village1 0,068 · **Level1 0,057** · L2 0,107 |
| Moss Dark | 2 m | 0,00 | 0,00 | 1,2 | Village1 0,15 |
| Meadow Rock Dark | 5 m | 0,00 | 0,00 | 3,0 | L2 0,019 · L6 0,043 · L9 0,054 |
| Terrain_Meadow_Rock_01 2 | 3 m | 0,00 | 0,00 | 1,0 | L9 0,136 |
| Ani Dark Rockwall 2 | 5 m | 0,785 | 0,25 | 1,5 | L7 0,121 |
| Pebbles_Sand under water | 2 m | 0,75 | 0,10 | 3,0 | **Level1 0,060** |
| Terrain_Meadow_Rock_01 | 7 m | 0,00 | 0,00 | 3,0 | **nirgends über 0,5 %** |
| **Terrain_Meadow_Rock_Rough_01** | 3 m | 0,00 | 0,00 | **5,0** | **von keinem Terrain benutzt** |
| Moss very Dark 1 for Clear | 2 m | 0,00 | 0,00 | 1,2 | von keinem Terrain benutzt |

Zwei Dinge fallen auf:

1. **Drei Rockwall-Ebenen teilen sich dieselbe Diffuse-Textur**
   (PathID 96) und unterscheiden sich nur in Metallic und Kachelmaß.
   Level1 und Village1 fahren die **matte** Fassung (0,20 / 5 m); die
   glänzende (0,85 / 2 m) liegt in ganz anderen Leveln.
2. **`Terrain_Meadow_Rock_Rough_01` ist im ganzen Spiel unbenutzt** —
   sie liegt im Export, aber kein Terrain referenziert sie.

---

## B Gras und Details — TerrainL1

Detailkarte **1024 × 1024** (32 Patches × 32 Samples), also
**0,195 m je Detailzelle**. 17 Detail-Prototypen.
Terrain-Komponente: `m_DetailObjectDistance` **70 m**,
`m_DetailObjectDensity` **1,0**, `m_HeightmapPixelError` 15,
`m_SplatMapDistance` (Basemap) 1000 m, `m_TreeDistance` 500 m,
`m_TreeBillboardDistance` 50 m, `m_ShadowCastingMode` 2 (TwoSided).
`WavingGrassTint` = (0,70 / 0,60 / 0,50), Strength/Amount/Speed je 0,5.
`m_DetailScatterMode` = 0 (InstanceCountMode).

**Die Höhen sind Skalen, keine Meter.** `minHeight`/`maxHeight`
multiplizieren die Prefab-Höhe. Die Prefab-Maße unten sind aus der
AABB der Prefab-Hierarchie inklusive Wurzel-`localScale` gemessen.

| # | Prefab | Prefab-Höhe | H-Skala | **echte Höhe** | B-Skala | **echte Breite** | density | Deckung ⌀ | mittl. Neigung |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | SM_Env_Grass_Short_Clump_01_LOD0 | 0,25 m | 2,0–3,0 | **0,50–0,75 m** | 1,0–2,0 | 1,00–2,00 m | 0,75 | 127/255 | 26,1° |
| 1 | SM_Plant_Mushrooms_02 | 0,477 m | 2,0–3,0 | 0,95–1,43 m | 1,0–2,0 | 0,55–1,10 m | 0,05 | 137/255 | 26,6° |
| 2 | SM_Env_Grass_Short_Clump_01_LOD0 | 0,25 m | 1,0–1,5 | **0,25–0,38 m** | 1,0–1,0 | 1,00 m | 1,00 | 17/255 | **43,7°** |
| 3 | Bush_1A2 (Small) | 1,364 m | 0,7–1,0 | 0,95–1,36 m | 0,7–1,0 | 1,09–1,55 m | 0,20 | 110/255 | 25,0° |
| 4 | leaf.858 | 3,145 m | 1,0–1,2 | 3,15–3,77 m | 1,0–1,0 | 2,85 m | 0,20 | 107/255 | 19,3° |
| 5 | = 0 (Duplikat) | 0,25 m | 2,0–3,0 | 0,50–0,75 m | 1,0–2,0 | 1,00–2,00 m | 0,75 | 137/255 | 26,6° |
| 6 | = 2 (anderes Material) | 0,25 m | 1,0–1,5 | 0,25–0,38 m | 1,0–1,0 | 1,00 m | 1,00 | 42/255 | **41,6°** |
| 7 | leaf.858 | 3,145 m | 1,0–1,2 | 3,15–3,77 m | 1,0–1,0 | 2,85 m | 0,20 | 117/255 | 22,3° |
| 8 | SM_Env_Rock_03 1 | 0,308 m | 1,0–2,0 | 0,31–0,62 m | 1,0–2,0 | 0,48–0,95 m | 0,07 | 154/255 | 24,9° |
| 9 | SM_Env_Rock_Pebble_02 1 | 0,213 m | 1,0–2,0 | 0,21–0,43 m | 1,0–2,0 | 0,32–0,64 m | 0,10 | 154/255 | 24,9° |
| 10 | Flower_1A12 | 0,545 m | 1,0–2,0 | 0,55–1,09 m | 1,0–2,0 | 0,17–0,35 m | 0,10 | 11/255 | 10,8° |
| 11–13 | Flower_1A4 | 0,458 m | 1,0–2,0 | 0,46–0,92 m | 1,0–2,0 | 0,21–0,41 m | 0,10–0,20 | 0,5–5/255 | 4–17° |
| 14–16 | Fern_1A1 | 0,590 m | 1,0–2,0 | 0,59–1,18 m | 1,0–2,0 | 1,34–2,68 m | 0,30–0,50 | 8–25/255 | 13–16° |

Materialien der Grasbüschel: `Grass_Short_Plant_Leaves_1A1 2` (Nr. 0/5)
und `Grass_Short_Mat_01 1` (Nr. 2/6). Nr. 1 und 5 sowie 8 und 9 tragen
**identische Deckungskarten** — der Autor hat Ebenen dupliziert; das ist
kein Lesefehler (geprüft, siehe unten).

### Wo wächst was — Detail × Neigung, Detail × Schicht

| # | 0–8° | 8–15° | 15–22° | 22–30° | 30–40° | 40–50° | > 50° | dominante Schicht darunter |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 hohes Gras | 0,192 | 0,175 | 0,143 | 0,129 | 0,135 | 0,089 | 0,137 | Moss 0,62 · Rockwall 0,16 · Sand 0,12 |
| 2 kurzes Gras | 0,007 | 0,014 | 0,026 | 0,063 | **0,305** | **0,302** | **0,284** | Rock_Moss 0,35 · Rockwall 0,31 · Moss 0,26 |
| 6 kurzes Gras | 0,020 | 0,041 | 0,063 | 0,116 | 0,242 | 0,205 | **0,314** | Moss 0,41 · Rockwall 0,33 · Rock_Moss 0,18 |
| 10 Blume | **0,479** | 0,315 | 0,118 | 0,051 | 0,017 | 0,008 | 0,013 | Moss 0,81 · Sand 0,18 |
| 11 Blume | **0,926** | 0,074 | 0 | 0 | 0 | 0 | 0 | Moss 0,79 · Sand 0,21 |
| 14 Farn | 0,319 | 0,258 | 0,199 | 0,114 | 0,056 | 0,024 | 0,030 | Moss 0,74 · Sand 0,16 |

**Die Regel des Autors, in einem Satz:** hohes Gras (0,50–0,75 m)
überall, kurzes Gras (0,25–0,38 m) auf dem Steilhang, Blumen und Farne
nur in der Ebene. Blumen sind bei > 22° praktisch aus.

> **Wie belastbar ist die Deckungszahl?** Die Karte ist korrekt
> dekodiert: `m_Patches.coverage` ist layer-major (Zeilenperiode 32
> nachgewiesen), und die mittlere Nachbardifferenz liegt bei 5,6 gegen
> 100 bei einer Zufallskontrolle — es ist eine gemalte Karte, kein
> Rauschen. **Nicht** ableitbar ist die absolute Instanzzahl je m²:
> `m_DetailScatterMode` = 0 und der Zusammenhang von `coverage`,
> `density` und `detailObjectDensity` sitzt in Unitys Terrain-Engine.
> Belastbar sind Verhältnis der Arten, Ort und Größe — die absolute
> Dichte muss im Labor am Bild kalibriert werden.

---

## C Bäume — TerrainL1

256 Instanzen auf 4 ha = **64 Bäume/ha**. Alle Skalen sind fest, es gibt
keine Zufallsstreuung außer bei Tree_1A3.

| # | Prefab | Prefab-Höhe | Skala | **echte Höhe** | Anzahl | Dichte |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Tree_1C1 | 9,27 m | 0,50 | 4,6 m | 59 | 14,75/ha |
| 1 | Tree_1C2 | 10,14 m | 0,50 | 5,1 m | 50 | 12,50/ha |
| 2 | Tree_1A3 (Birke) | 33,75 m | 0,42–0,567 | 14,2–19,1 m | 47 | 11,75/ha |
| 3 | Tree_1B3 | 29,66 m | 0,50 | 14,8 m | 49 | 12,25/ha |
| 4 | Pine_1B4 | 30,09 m | 0,50 | 15,0 m | 51 | 12,75/ha |

`bendFactor` = 0 bei allen, `m_TreeCrossFadeLength` 5 m,
`m_BakeLightProbesForTrees` = true. Die fünf Arten sind fast gleich
häufig — der Autor hat bewusst gemischt, nicht dominieren lassen.

---

## D Licht, Ambient, Nebel, Himmel, Reflexion — Level1

Farben sind so serialisiert, wie Unity sie ablegt: `Light.m_Color` und
die `RenderSettings`-Farben in **Gamma/sRGB**. Die JSON führt je Farbe
den Rohwert, den sRGB-Hex und **beide** Umrechnungen mit.

### Sonne

| Größe | Wert |
| --- | --- |
| Typ | Directional, 1 Stück (dazu 1 Punktlicht, s. u.) |
| Farbe | **#FFC98C** = (1,000 / 0,788 / 0,549) sRGB → linear (1,000 / 0,584 / 0,262) |
| Intensität | **2,3** |
| Elevation | **50,0°** über dem Horizont |
| Azimut | **150,0°** |
| Schatten | Soft (Typ 2), Stärke **1,0**, Bias 0,05 / NormalBias **0,0** |
| Farbtemperatur | 5000 K, **aber `useColorTemperature` = false** → wirkt nicht |
| Bounce (indirekt) | 1,0 |
| Lightmaps | keine (`m_Lightmaps` leer, `m_LightmapsMode` 1) — alles Echtzeit |

Das zweite Licht ist ein **Punktlicht** (`Light`, Intensität 30,
#2681FF, ohne Schatten) — eine lokale blaue Aufhellung, kein Sonnenlicht.

### Ambient und Himmel

| Größe | Wert |
| --- | --- |
| `m_AmbientMode` | **0 = Skybox** |
| `m_AmbientIntensity` | 1,0 |
| Skybox-Material | **`Sky1 L1`**, Shader `Skybox/Cubemap` |
| `_Tint` | **#B2D1FE** = (0,697 / 0,821 / 0,996) |
| `_Exposure` | **0,8** |
| `_Rotation` | 0 |
| Reflexion | `m_DefaultReflectionMode` 0 (Skybox), Auflösung 128, Intensität 1,0, 1 Bounce |
| ReflectionProbes | **0 Stück in der Szene** |

> **`m_AmbientSkyColor` / `EquatorColor` / `GroundColor` sind wirkungslos.**
> Sie stehen auf Unitys Vorgabe (0,212/0,227/0,259 · 0,114/0,125/0,133 ·
> 0,047/0,043/0,035) und werden bei `AmbientMode = Skybox` nicht
> benutzt. Wer sie überträgt, überträgt eine Zahl, die im Vorbild nichts
> tut. Die Umgebungshelligkeit des Vorbilds kommt **aus der
> Cubemap `Sky1 L1` mit Tint #B2D1FE und Exposure 0,8**.

### Nebel

| Größe | Wert |
| --- | --- |
| `m_Fog` | an |
| `m_FogMode` | **1 = Linear** |
| `m_LinearFogStart` | **15 m** |
| `m_LinearFogEnd` | **200 m** |
| `m_FogColor` | **#73A7FF** = (0,450 / 0,654 / 1,000) — kräftiges Blau |
| `m_FogDensity` | 0,01 — **im Linear-Modus unbenutzt** |

Der Nebel ist die stärkste Einzelgröße im Bild: bei 200 m Endweite und
einer Kameraweite von 1200 m sind die Berge des Panoramas **voll
eingefärbt**. Das blaue Bergpanorama in Bild 3 ist zu großen Teilen
diese Nebelfarbe, nicht die Farbe des Gesteins.

### Kamera

FOV **40°**, Near 0,1 m, Far **1200 m**, HDR an, MSAA an,
ClearFlags 1 (Skybox). `UniversalAdditionalCameraData`:
Antialiasing **1 (FXAA)**, Qualität 2, Dithering aus, StopNaN aus,
PostProcessing **an**, VolumeLayerMask Bit 0.

### URP-Asset (Qualitätsstufen)

| | Performant | **Balanced** | HighFidelity |
| --- | --- | --- | --- |
| HDR | aus | **an** | an |
| MSAA | 1 | **1** | 4 |
| Schattenweite | 50 m | **50 m** | 150 m |
| Kaskaden | 1 | **1** | 4 |
| Schattenkarte | 1024 | **1024** | 4096 |
| Soft Shadows | aus | **an (Qualität 2)** | an |
| ColorGradingMode | LDR (0) | **LDR (0)** | LDR (0) |
| LUT-Größe | 16 | **32** | 32 |
| Zusatzlicht-Schatten | aus | **aus** | an |
| DepthBias / NormalBias | 1,0 / 1,0 | **1,0 / 1,0** | 1,0 / 1,0 |

> **Korrektur zu einer Annahme im Repo.** `server.yml` notiert „Das
> Vorbild fährt 40 m mit zwei Kaskaden". Die 40 m / 2 Kaskaden stehen in
> `QualitySettings` (Stufe HighFidelity) — **URP benutzt die nicht**,
> sondern die Werte des eigenen Assets. Wirksam sind **50 m mit
> 1 Kaskade** (Balanced/Performant) bzw. 150 m mit 4 (HighFidelity).

---

## E Nachbearbeitung — Level1

Ein Volume je Szene, gelesen über Typetrees aus
`Unity.RenderPipelines.Universal.Runtime.dll`. In Level1 gibt es drei
Volumes: `Postprocessing` (global, Priorität 1, Gewicht 1,0 → **das
wirksame**), `Postprocessing Underwater` (lokal, isGlobal = 0) und
`PauseBlur` (Gewicht 0). Profil: **`FantasyL1`**.
`PostprocessingSetter.cs` (die einzige Look-Klasse im Spiel) schaltet
das Volume nur ein und aus — **es überschreibt keinen Wert**.

| Komponente | aktiv | gesetzte Werte |
| --- | --- | --- |
| **Tonemapping** | ja | `mode` = **0 = None — kein Tonemapper** |
| **ColorAdjustments** | **NEIN** | (postExposure 0,7 · contrast 0 · saturation 0 — alle wirkungslos) |
| **ShadowsMidtonesHighlights** | ja | midtones (1,000 / 0,961 / 0,937 / 0,000) · highlights (1,000 / 0,913 / 0,780 / −0,164) · highlightsStart 1,07 · highlightsEnd 1,58 |
| **Bloom** | ja | threshold **0,35** · intensity **0,55** · dirtIntensity 12,0 (mit Dirt-Textur) |
| **Vignette** | ja | intensity **0,25** |
| **ChromaticAberration** | ja | intensity **0,10** |
| **DepthOfField** | ja | mode 2 (Bokeh) · focusDistance 2,0 · aperture 6,0 · focalLength 47 · gaussianStart 70 · gaussianEnd 100 |
| LensDistortion | nein | (−0,10) |
| SplitToning | nein | (highlights #7A7780) |
| LiftGammaGain | nein | — |

### Das ist kein Einzelfall — es ist die Handschrift aller Spiel-Level

| Szene | Tonemapper | ColorAdjustments | Bloom thr/int | Vignette | Sonne | Elev | Nebel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MainMenu | Neutral | **an** | 1,0 / 2,0 | 0,445 | 1,5 | 50° | Exp2 |
| Customization | Neutral | **an** | 1,0 / 2,0 | 0,445 | 1,5 | 50° | Exp2 |
| Village1 | Neutral | **an** | 1,0 / 2,0 | 0,25 | 2,0 | 50° | Exp2 |
| **Level1** | **None** | **aus** | 0,35 / 0,55 | 0,25 | 2,3 | 50° | **Linear 15–200 m** |
| Level2 | None | aus | 0,35 / 0,55 | 0,25 | 1,5 | 50° | Linear 15–200 |
| Level3 | None | aus | 0,35 / 1,20 | 0,25 | 1,5 | 50° | Linear 5–200 |
| Level4/5 | None | aus | 0,35 / 0,55 | 0,45 | 2,0 | 35° | Linear 2–100 |
| Level6 | None | aus | 0,35 / 0,55 | 0,45 | 1,5 | 35° | Exp 15–476 |
| Level7 | None | aus | 0,35 / 0,40 | 0,45 | 1,2 | 35° | Exp 0–30 |
| Level8 | None | aus | 0,35 / 0,40 | 0,45 | 1,2 | 35° | Linear 20–100 |
| Level9 | None | aus | 0,35 / 0,40 | 0,45 | 1,5 | 35° | Exp 20–200 |

**Alle neun Spiel-Level fahren ohne Tonemapper und ohne
ColorAdjustments.** Nur Menü, Charakterwahl und Village1 haben Neutral
plus ColorAdjustments — und selbst dort ist **`saturation` in keiner
einzigen Szene überschrieben**; Village1 setzt nur `postExposure` 0,2.

Es gibt **kein globales Standard-Volume-Profil**, das das noch ändern
könnte: das Spiel hat genau ein `VolumeProfile` je Szene (12 Stück,
`FantasyL1`…`FantasyL9`, `Fantasy1`, `MainMenu`, `Customization`, plus
`PauseBlur` und zwei Sonderprofile).

> **Nicht lesbar:** `UniversalRenderPipelineGlobalSettings` — der
> Typetree aus der DLL passt nicht auf die serialisierten Daten
> (`read_str out of bounds`). In URP 14 (Unity 2022.3) trägt diese
> Klasse **kein** Standard-Volume-Profil; die obige Aufzählung der
> Profile deckt den Look also ab. Sollte sich das als falsch erweisen,
> wäre das die einzige verbleibende Lücke dieser Messung.

---

## F Abweichungsliste — Labor gegen Original

| # | Größe | **Original** | **Labor** | Quelle im Labor | Vorschlag |
| --- | --- | --- | --- | --- | --- |
| F1 | Tonemapper | **keiner** (Level1–9) | KHR-PBR-Neutral | `server.yml` `look.tonemapping` | **Nicht 1 : 1 übertragbar.** Babylon ohne Tonemapper klippt HDR hart; das Original tut genau das (URP, HDR an, LDR-Grading). Zunächst *messen*, wie „aus" bei uns aussieht, bevor Neutral verteidigt wird. Village1 (= unsere Zone) fährt Neutral — der Widerspruch ist echt und muss entschieden werden. |
| F2 | Sättigung | **nie gesetzt**, in keiner Szene | 0,45 (Faktor) | `server.yml` `look.saettigung` | **Erfindung des Labors.** Das Original hat keinen Sättigungsregler. Auf 1,0 stellen und die Farbe stattdessen aus Licht/Ambient/Nebel holen (F5–F7). |
| F3 | Belichtung | postExposure 0,7 **aus**; Village1 0,2 | 1,35 | `server.yml` `look.belichtung` | Nicht vergleichbar (URP-Blende gegen Babylon-Belichtung). Nach F1/F5–F7 **neu kalibrieren**, nicht übernehmen. |
| F4 | Kontrast | contrast 0 (und aus) | 1,15 | `server.yml` `look.kontrast` | Auf 1,0. Der Kontrast des Vorbilds kommt aus `ShadowsMidtonesHighlights`, nicht aus einem Kontraströhrchen. |
| F5 | Farbstich | `ShadowsMidtonesHighlights`: midtones (1 / 0,961 / 0,937), highlights (1 / 0,913 / 0,780), Start 1,07 / Ende 1,58 | nicht vorhanden | — | **Übernehmen.** Das ist die ganze Farbhandschrift des Vorbilds: Mitten leicht warm, Lichter deutlich gelb. Eine Kurve, die wir noch nicht haben. |
| F6 | Nebelmodell | **Linear, 15 → 200 m** | exp, Dichte 0,0009 (Tag) | `server.yml` `look.nebelmodus`, `environment.ts` | **Umrechnen.** Linear 15–200 m ist erheblich dichter als exp mit 0,0009. Bei 200 m ist das Vorbild zu 100 % Nebel, wir zu 16 %. Das ist die wahrscheinlichste Ursache für „unsere Ferne wirkt anders". |
| F7 | Nebelfarbe (Tag) | **#73A7FF** (0,450 / 0,654 / 1,000) | (0,83 / 0,87 / 0,92) | `environment.ts` `fogColorDay` | **Übernehmen prüfen.** Unsere Farbe ist ein heller Dunst, die des Vorbilds ein sattes Blau. Achtung: `look.himmel.horizont: nebel` — das ändert auch den Himmel. |
| F8 | Sonnenfarbe | **#FFC98C** (1,000 / 0,788 / 0,549) | Tag (1,00 / 0,96 / 0,90) | `environment.ts` `sunColorDay` | **Übernehmen.** Das Vorbild fährt am Tag eine deutlich wärmere Sonne als wir. |
| F9 | Sonnenintensität | **2,3** | 1,55 (Tag) / 2,67 (Abend) | `environment.ts` `lightIntensityDay` | Nicht direkt übertragbar (URP-Lux gegen Babylon). Als **Verhältnis** benutzen: Sonne zu Ambient. |
| F10 | Sonnenstand | **Elevation 50°, Azimut 150°**, fest | `sunAngle: 46`, tagesabhängig | `environment.ts` | Der Referenzort/-zeitpunkt sollte **50°** treffen, wenn gegen die Bilder gemessen wird. Unser Tageslauf bleibt. |
| F11 | Ambient | **Skybox-Cubemap**, Tint #B2D1FE, Exposure 0,8 | flache Farbe (0,86 / 0,95 / 1,00) | `environment.ts` `ambColorDay` | **Nicht 1 : 1 übertragbar** (wir haben keine Cubemap-Ambient). Ersatz: eine Gradient-Ambient aus dem Tint, nicht aus `m_AmbientSkyColor` — das ist im Vorbild tot (s. §D). |
| F12 | `m_AmbientSkyColor` u. a. | **wirkungslos** (Unity-Vorgabe, AmbientMode = Skybox) | — | — | **Nicht übertragen.** Wer diese Zahl abschreibt, schreibt eine Vorgabe ab. |
| F13 | Schattenweite | **50 m, 1 Kaskade** (Balanced) | 120 m | `server.yml` `look.schatten.reichweite` | Bewusste Abweichung möglich (unsere Welt ist offener). Aber die Notiz „40 m, zwei Kaskaden" im `server.yml` **korrigieren**: wirksam sind 50 m / 1 Kaskade. |
| F14 | Schattendunkelheit | Stärke **1,0** (Level1), 0,87 (Village1) | 0,42 Restlicht | `server.yml` `look.schatten.dunkelheit` | Nicht direkt vergleichbar (URP füllt den Schatten über Ambient auf). Nach F11 neu messen. |
| F15 | Bloom | threshold **0,35**, intensity **0,55**, Dirt 12,0 | 0,85 / 0,22, kein Dirt | `server.yml` `look.bloom` | **Umrechnen, Richtung klar:** Das Vorbild blüht viel früher und stärker. Unsere Schwelle 0,85 lässt fast nichts durch. Die Dirt-Textur ist ein eigener Effekt, den wir nicht haben. |
| F16 | Vignette | **0,25** (URP 0…1) | 1,2 (Babylon) | `server.yml` `look.vignette` | Skalen verschieden — am Bild abgleichen, nicht die Zahl kopieren. |
| F17 | Chrom. Aberration | **0,10** (URP 0…1) | 4,5 px (Babylon) | `server.yml` `look.ca` | Skalen verschieden. Richtung: Das Vorbild ist zurückhaltend. |
| F18 | Tiefenunschärfe | Bokeh, Fokus 2 m, Blende 6, Brennweite 47 mm; Gauß 70–100 m | `dof.an: true` | `server.yml` `look.dof` | **Zahlen übernehmen** — wir haben bisher nur einen Schalter. |
| F19 | Kamera-FOV | **40°** | — | — | Prüfen: Vergleichsbilder müssen mit 40° entstehen, sonst ist jede Luma-Messung schief. |
| F20 | Antialiasing | **FXAA** (URP, Qualität 2) | — | — | Zur Kenntnis. |
| F21 | **Steigungsrampe** | **gemalte Karte**; 66 % Mischtexel; Fels nur 16,9 % Fläche; bei ≥ 45° nur 0,425 Felsgewicht | Formel: Hang 15→30°, Fels 30→40° (Anteil 0,85), Rau 40→50° | `TerrainSplat.ts` `RAMPEN` | **Erfindung des Labors** (bewusst, aber falsch kalibriert). Sofort besser: Schwellen aus der gemessenen Verteilung (F22) und ein **Deckel** auf den Felsanteil. |
| F22 | Fels-Flächenanteil | **16,9 %** gemalt | eine 30°-Regel liefert 34,0 % | `TerrainSplat.ts` `RAMPEN.fels` | **Halbieren.** Entweder Schwelle auf ~40° (22,0 %) plus `anteil` 0,75, oder — besser — eine Rauschmaske, die den Fels auf ~17 % drückt und ihn nicht an Höhenlinien kleben lässt. |
| F23 | Übergangsbreite | **2,7–4,3 m** Median (Level1), 4–24 m (Village1) | `smoothstep` über 10–15° | `TerrainSplat.ts` | Die Grad-Spanne ist am Hang etwas anderes als eine Meterbreite. **Nachrechnen:** Bei 30° Hang entsprechen 10° Spanne ≈ 3–5 m — das passt zufällig gut. Zahlen belassen, aber die Begründung auf diese Messung stützen. |
| F24 | Zeilentönungen | **es gibt keine** — alle Schichten sind unverfälschte Texturen, `m_DiffuseRemap` 0…1, `m_Specular` schwarz | 16 Tönungen, u. a. Cliff (1,283 / 0,614 / 0,224), Moss (0,623 / 0,46 / 0,473) | `tools/store-terrain-schichten.mjs` | **Erfindung des Labors.** Das Original färbt keine Bodentextur um. Vorschlag: alle Tönungen schrittweise auf [1, 1, 1] und den Unterschied über F5–F8/F11 holen. |
| F25 | **Falsche Rockwall-Variante** | Level1 und Village1 benutzen `Ani Dark Rockwall **3**`: Metallic **0,20**, Glätte 0,20, **Kachel 5 m** | Tile 4 (Rock) = `Ani Dark Rockwall` (Metallic **0,85**, Kachel **2 m**) | `TerrainSplat.ts` `SCHICHT_OBERFLAECHE[4]` | Das Spiel hat **drei** Rockwall-Ebenen mit **derselben Diffuse-Textur** (PathID 96) und verschiedener Oberfläche: `Ani Dark Rockwall` (0,85 / 2 m), `…2` (0,785 / 5 m), `…3` (**0,20 / 5 m**). Das Labor hat die erste erwischt — **die Referenzbilder stammen aber aus Level1, und Level1 fährt die dritte.** Der Kommentar bei `FELS_TILE` beschreibt richtig, warum 0,85 „wie Erde" aussieht; **die Lösung ist Metallic 0,20 und Kachel 5 m, nicht ein anderes Tile.** |
| F26 | **Cliff kopiert eine tote Ebene** | `Terrain_Meadow_Rock_Rough_01` wird von **keinem einzigen Terrain im Spiel** benutzt | Tile 5 (Cliff) = genau diese Ebene (Metallic 0, Kachel 3 m, NormalScale 5) | `TerrainSplat.ts` `SCHICHT_OBERFLAECHE[5]` | Die Übertragung ist buchstabengetreu — nur ist die Vorlage im Spiel unbenutzt. Der helle Fels, den die Bilder wirklich zeigen, ist **`Terrain_Meadow_Rock_Moss_01`** (Metallic 0, Glätte 0, **Kachel 7 m**, **NormalScale 2,0**; 5,7 % in Level1, 6,8 % in Village1, 10,7 % in Level2). **Cliff auf diese Werte umstellen.** |
| F27 | NormalScale | Moos **1,2** · Rockwall 3 **1,5** · Meadow_Rock_Moss **2,0** · Sand 3,0. Maximum aller **benutzten** Ebenen: **3,0** | Cliff **5**, Rock 1,5, Grass 2 | `TerrainSplat.ts` | NormalScale 5 gibt es im Spiel nur auf der unbenutzten Rough-Ebene. **Auf 2,0 (mit F26) bzw. höchstens 3,0 deckeln.** |
| F28 | Grashöhe | **0,50–0,75 m** (hoch), **0,25–0,38 m** (kurz, am Hang) | 0,77–0,94 m | `GrassClutter.ts` `storeScale.prefabScale.y = 3.0` | **Das Labor ist ~25 % zu hoch.** Die Schätzung „0,64–1,04 m aus dem Bild" (look-referenz.md) misst die Büschel gegen eine Figur, die näher an der Kamera steht. Die Daten sagen 0,50–0,75 m. **`prefabScale.y` von 3,0 auf ~2,4 senken.** |
| F29 | Zwei Grashöhen | **ja** — hoch überall, kurz gezielt am Steilhang (30–50°+) | `meadowsGrass` + `meadowsGrassShort` unterscheiden sich nur in Menge/Höhe, nicht nach Neigung (`maxTiltCos` cos 25 bei beiden) | `GrassClutter.ts` | **Übernehmen:** kurzes Gras an den Hang binden statt in die Ebene. Das ist es, was Bild 2 zeigt. |
| F30 | Grasfarbe | `healthyColor` = `dryColor` = **weiß** — die Farbe kommt allein aus dem Prefab-Material | „weisse Halm-Maske × Terrainfarbe" (`terrainTint: true`) | `GrassClutter.ts` (~Z. 751) | **Der Kommentar „Der Mechanismus stammt aus dem Original" stimmt für dieses Original nicht.** Tale of Dark Lands tönt seine Detail-Meshes nicht. Entweder abschalten oder als bewusste eigene Entscheidung kennzeichnen. |
| F31 | Gras-Sichtweite | **70 m** (`m_DetailObjectDistance`) | Fade 20 → 35 m | `GrassClutter.ts` `fadeMin/fadeMax` | **Übernehmen prüfen.** Unser Gras endet doppelt so früh. Kostenfrage, aber der Unterschied ist sichtbar. |
| F32 | Grasdichte | nicht absolut ableitbar (s. §B) | 200 + 250 je 100 m² = 4,5/m² | `GrassClutter.ts` `amount` | **Am Bild kalibrieren**, mit `deckungHell` gegen die 17 % aus `look-referenz.md`. Die Datenlage erlaubt hier keine Zielzahl. |
| F33 | Blumen/Farne | Blumen 93 % unter 15°, Farne 58 % unter 15° | `meadowsFern` `maxTiltCos` cos 18, Höhenfenster 1–4 m | `GrassClutter.ts` | Passt in der Richtung. Blumen fehlen als eigene Art. |
| F34 | Baumdichte | **64/ha**, 5 Arten fast gleich häufig, 4,6–19,1 m | — | — | Als Zielzahl für die Wiese übernehmen. |
| F35 | Detail-/Splat-Auflösung | Splat 0,39 m/Texel, Detail 0,195 m/Zelle, Höhe 0,39 m/Punkt | Chunk-Gitter 1 m | `Terrain.ts` | **Nicht übertragbar** — unsere Welt ist um Größenordnungen größer und bearbeitbar. Zur Kenntnis: Das Vorbild ist 2,5-mal feiner aufgelöst als wir. |
| F36 | Fels als Geometrie | Klippen und Berge sind **Meshes** bis 118 m Höhe, weit außerhalb des 200-m-Terrains | Fels ist eine Splat-Schicht auf dem Höhenfeld | `TerrainSplat.ts` | **Nicht übertragbar, aber der wichtigste Befund.** Solange wir Fels nur malen, fehlt dem Bild die Silhouette. Gehört in die Roadmap, nicht in diese Runde. |
| F37 | Terrain-Shader | `URP/Terrain/Lit`, nur `_TERRAIN_INSTANCED_PERPIXEL_NORMAL`; **kein** Height-Blend, **keine** Maskmaps | NodeMaterial mit Triplanar + Himmelsterm | `TerrainSplat.ts` | Zur Kenntnis: Das Vorbild mischt seine Schichten **linear über die Alphagewichte**, ohne Höhen-Blending. Wir sind hier aufwendiger, nicht ähnlicher. |
| F38 | Facettierung | glatt (513²-Gitter, geteilte Ecken) | `BODEN_FACETTIERT = false` | `TerrainSplat.ts` | **Stimmt bereits** — der Kommentar dort ist durch diese Messung bestätigt. |

---

## G Umsetzung in Schritten — für einen Bauer

Kleinste Schritte zuerst. Jeder Schritt ist einzeln messbar; nach jedem
gehört eine Aufnahme am Referenzort gegen `design/look-referenz.md`.

**Schritt 1 — Tönungen zurücknehmen (`store-terrain-schichten.mjs`).**
Alle 16 `toenung` auf `[1, 1, 1]`. Stapel neu bauen, eine Aufnahme.
Erwartung: Der Boden wird flacher und kühler — das ist gewollt, die
Farbe kommt ab Schritt 3 von woanders. Belegt durch F24.

**Schritt 2 — Oberflächen der Schichten korrigieren
(`TerrainSplat.ts`, `SCHICHT_OBERFLAECHE`).**
Rock (Tile 4): Metallic 0,85 → **0,20**, Glätte 0,10 → **0,20**,
Kachel 2 m → **5 m** — also von `Ani Dark Rockwall` auf
`Ani Dark Rockwall 3` umstellen (F25).
Cliff (Tile 5): Kachel 3 m → **7 m**, NormalScale 5 → **2,0** — von der
im Spiel unbenutzten `…Rough_01` auf `Terrain_Meadow_Rock_Moss_01`
umstellen (F26, F27).
Moss (Tile 11): NormalScale auf **1,2**.
Das ist die Änderung mit dem besten Verhältnis von Aufwand zu Wirkung:
Sie behebt Mikes Befund „ich lese den Fels als Erde" an der Ursache
statt über ein anderes Tile. Die **Texturen** müssen dafür nicht
getauscht werden — alle drei Rockwall-Ebenen teilen sich dieselbe
Diffuse-Textur.

**Schritt 3 — Licht, Ambient, Nebel des Vorbilds setzen
(`environment.ts` Klar-Comic, `server.yml`).**
`sunColorDay` → (1,000 / 0,788 / 0,549); Sonnenstand am Referenzort auf
**50°** prüfen; `fogColorDay` → (0,450 / 0,654 / 1,000);
Nebel auf **linear 15 → 200 m** umstellen (F6–F8, F10).
Achtung `look.himmel.horizont: nebel` — der Himmel zieht mit.

**Schritt 4 — Grading umstellen (`server.yml` `look`).**
`saettigung` 0,45 → **1,0**, `kontrast` 1,15 → **1,0** (F2, F4).
Dafür `ShadowsMidtonesHighlights` neu einführen: midtones
(1 / 0,961 / 0,937), highlights (1 / 0,913 / 0,780), Start 1,07,
Ende 1,58 (F5). Danach `belichtung` **neu** kalibrieren — der alte Wert
1,35 gilt nach Schritt 1–3 nicht mehr.

**Schritt 5 — Bloom und Tiefenunschärfe angleichen.**
`bloom.schwelle` 0,85 → **0,35**, `staerke` 0,22 → **0,55** (F15).
DoF-Zahlen aus §E eintragen (F18). Vignette und CA am Bild abgleichen,
nicht die Zahlen kopieren (F16, F17).

**Schritt 6 — Rampenschwellen aus der Messung
(`TerrainSplat.ts`, `RAMPEN`).**
Ziel ist **16,9 %** Felsfläche statt 34 %. Zwei Wege, in dieser
Reihenfolge zu versuchen:
1. `fels.beginn` 30 → **40**, `fels.anteil` 0,85 → **0,75**,
   `rau.beginn` 40 → **50** (F21, F22). Billig, sofort messbar.
2. Wenn das Bild dann „gestreift" wirkt: eine Rauschmaske auf den
   Felsanteil, damit der Fels nicht an Höhenlinien klebt. Das Vorbild
   hat bei ≥ 45° nur 0,425 Felsgewicht — **Moos gehört in die Felswand**.

**Schritt 7 — Gras nach den Daten
(`GrassClutter.ts`).**
`storeScale.prefabScale.y` 3,0 → **2,4** (Zielhöhe 0,50–0,75 m, F28).
`meadowsGrassShort` an die **Neigung** binden statt an die Ebene:
`maxTiltCos` heraufsetzen und ein `minTilt` einführen, damit kurzes Gras
ab ~30° erscheint (F29). Danach `deckungHell` gegen die 17 % messen
(F32).

**Schritt 8 — Reichweiten (`GrassClutter.ts`, `server.yml`).**
Gras-Fade 20/35 → Richtung **70 m** prüfen (F31); Schattennotiz im
`server.yml` auf 50 m / 1 Kaskade korrigieren (F13).

**Nicht in dieser Runde:** F36 (Fels als Mesh-Geometrie) und F30
(Grastönung) sind Entscheidungen, keine Korrekturen — sie gehören in die
Roadmap.

---

## Anhang — Wasser (nur zur Kenntnis)

Level1, Material `Water_Mat_01 1`, Shader `SyntyStudios/WaterShader`:
`_ShallowColour` #F3C996 (0,953 / 0,788 / 0,588) ·
`_DeepColour` #136E66 (0,075 / 0,431 / 0,400) ·
`_VeryDeepColour` #032C46 (0,012 / 0,173 / 0,275) ·
`_FoamColor` #85E5D8 · `_Depth` 4,27 · `_Opacity` 0,90 ·
`_OpacityMin` 0,32 · `_ReflectionPower` 0,32 · `_WaveAmplitude` 0,10 ·
`_NormalTiling` 0,38 · `_CausticScale` 3,0.
Dazu die Terrain-Schicht `Ani Dark Pebbles_Sand under water` (6 % der
Fläche, mittlere Neigung 16,4°, Kantenbreite 1,0 m — der einzige harte
Rand im ganzen Splat).

## Anhang — Prüfungen, die diese Messung bestanden hat

| Prüfung | Ergebnis |
| --- | --- |
| Höhennormierung `/32767` | `h.max()/32767` = 0,049043 gegen `m_MinMaxPatchHeights.max()` = 0,049045; GLB-Export Y max 29,4259 m = 0,049043 × 600 |
| Alphamap-Orientierung | Fels-gegen-Neigung-Korrelation **0,431** ohne Spiegelung gegen 0,098 mit — die ungespiegelte Lesart ist richtig |
| Detail-Patch-Dekodierung | layer-major bestätigt (Zeilenperiode 32); mittlere Nachbardifferenz **5,6** gegen **100** bei Zufallskontrolle |
| Doppelte Detail-Ebenen (1 = 5, 8 = 9) | echte Duplikate in den Daten, kein Lesefehler (Arrays elementweise verglichen) |
| Prefab-Maße | AABB der ganzen Hierarchie inkl. Wurzel-`localScale` (geprüft an `Bush_1A2`: 3,10 m ohne, 1,55 m mit Wurzelskala) |

**Nicht lesbar geblieben:** `UniversalRenderPipelineGlobalSettings`
(Typetree passt nicht). Kein anderer Wert dieser Spezifikation musste
geschätzt werden.

---

## Nachtrag 12.09.2026 — Moosschicht und Bodenlicht

Folgekarte zu A9/A11 (Block A des Fahrplans). Ausgangslage:
`Hangfels/Moos` klebte bei **1,21** (Ziel 1,69) und `Hangfels/Himmel` bei
**0,52** (Ziel 0,73), obwohl A9 dem Hangfels die Karte des Vorbilds
gegeben und A11 das Felsrauschen nachgezogen hatte. Zeugen dieses
Nachtrags: `~/wov-lab-mess/moos-hebel.mjs` und `moos-diagnose.mjs`,
Rohwerte und Bilder unter `~/.cache/wov-lab/moos-*`.

### Die Moosschicht stand doppelt so hell wie ihre Vorlage

Tile 1 `Forest`, 10 `SwampMud` und 11 `Moss` tragen die Zahlen der
Moos-Ebene des Vorbilds (2 m, Metallic 0, Glätte 0, Normale 1,2 — Tabelle
in §A; es ist mit 51 % Flächenanteil die grösste Schicht der Referenzzone
überhaupt). Ihre FARBE war ein Vertreter aus dem Speicher. Der
Unterschied ist keine Nuance:

| | lineare Luma (alle Texel) | sRGB-Mittel | Farbton | Sättigung |
| --- | --- | --- | --- | --- |
| Vertreter `terrain-moss` | **0,0367** | 41,9 / 57,9 / 13,4 | 82° | 0,77 |
| Vorbild `terrain-moss-dark` | **0,0180** | 36,6 / 37,2 / 7,8 | 61° | 0,79 |

Also doppelt so hell und eine halbe Stufe zu grün — gras- statt olivgrün.
Weil die Moosschicht am Hang die Mehrheit der Fläche stellt (bei 46° trägt
sie 56,5 %, der Fels 43,5 % — der Deckel aus §A), war nicht der Fels zu
dunkel, sondern das Moos daneben zu hell.

Die Karte kommt über denselben Weg wie `terrain-rock-moss`
(`tools/store-boden-quellen.mjs` → `assets/store-lab/textures/`) und trägt
in `tools/store-terrain-schichten.mjs` einen `farbeErsatz`, damit der
Boden auf einer Maschine ohne den Quellbestand weiter baut.
`tools/test/terrain-schichten.ts` hält das Verhältnis der zwei Karten am
GEBAUTEN Stapel fest: **Tile 5 / Tile 11 = 4,77** (0,08585 / 0,01799).
Mit dem alten Vertreter misst dieselbe Prüfung 2,34.

### Gemessen, Pose `hanghimmel` (46,2°) und `weitblick`, Mittag

| Verhältnis | Ziel | vorher | nachher |
| --- | --- | --- | --- |
| `Hangfels/Moos`, `hanghimmel` | 1,69 | 1,215 | **1,281** |
| `Hangfels/Himmel`, `hanghimmel` | 0,73 | 0,520 | 0,485 |
| `Moos/Himmel`, `hanghimmel` | 0,435 | 0,428 | 0,379 |
| `Moos/Himmel`, `weitblick` | 0,435 | 0,410 | 0,376 |
| Wiesengrund `weitblick` (L) | — | 46,3 | **45,8** (−1,1 %) |
| Clipping | 0 | 0,091 % | 0,089 % |

Der Wiesengrund bleibt, wie er war — die Moosschicht liegt dort nicht.
`Hangfels/Moos` steigt, aber nur um 5 %; und beide Moos-Zeilen fallen
unter ihr kalibriertes Band. Beides hat denselben Grund, und der steht im
nächsten Abschnitt.

### Woraus die Helligkeit einer Bodenfläche besteht

Jeder Beitrag einzeln auf null, dieselbe Maske, Mittag
(`moos-diagnose.mjs`):

| | Sonne | Grundlicht | Himmelsterm | Nebel |
| --- | --- | --- | --- | --- |
| Hang, Moos | 20 % | 38 % | 21 % | 0 % |
| Hang, Fels | 17 % | 27 % | 14 % | 11 % |
| Wiese, eben | 56 % | 10 % | 17 % | 2 % |

Der Unterschied zwischen Wiese und Hang ist **Geometrie, nicht Schatten**:
Am Messhang steht die Sonne mittags hinter dem Hang, **N·L = 0,136** gegen
**0,785** auf der Ebene (Sonne 51,7° hoch, Hang 46,2° und abgewandt).
Derselbe Hang misst um 17 Uhr bereits `Hangfels/Himmel` = 0,732
(`design/look-referenz.md`, Nachtrag 10.09.) — die 0,73 sind an dieser
Stelle also eine Aussage über den Sonnenstand und nicht über den Boden.

### Der Hebel „Bodenlicht": gemessen, nicht gesetzt

Faktor auf `bodenSonne` UND `bodenAmbient` (die zwei Farben, durch die das
Licht zum Boden geht), live je Bild, dieselbe Maske:

| Faktor | `Hangfels/Moos` | `Hangfels/Himmel` | `Moos/Himmel` (Hang) | `Moos/Himmel` (weit) | Wiesengrund |
| --- | --- | --- | --- | --- | --- |
| 1,00 | 1,281 | 0,485 | 0,379 | 0,376 | 45,8 |
| 1,15 | 1,264 | 0,500 | 0,396 | 0,396 | 48,2 (+5,2 %) |
| 1,30 | 1,249 | 0,514 | 0,412 | 0,415 | 50,4 (+10 %) |
| 1,60 | 1,227 | 0,541 | 0,441 | 0,451 | 54,4 (+19 %) |
| 1,80 | 1,214 | 0,558 | 0,460 | 0,473 | 56,9 (+24 %) |

Drei Dinge stehen damit fest, und alle drei sind Zahlen:

1. **`Hangfels/Moos` fällt mit dem Bodenlicht**, es steigt nicht. Fels und
   Moos liegen auf DEMSELBEN Hang unter DEMSELBEN Licht; ihr Verhältnis
   ist eine Aussage über Albedo und Mischung, und die fixen Anteile
   (Himmelsterm, Nebel) sind beim Fels grösser. Kein Bodenlicht der Welt
   bringt 1,69.
2. **`Hangfels/Himmel` bräuchte Faktor ≈ 4**, `Moos/Himmel` verlässt sein
   Band schon bei ≈ 1,45. Die zwei Ziele sind über diesen Hebel nicht
   gleichzeitig erreichbar.
3. **„Wiese unverändert ± 5 %" deckelt den Hebel bei 1,15**, während
   `Moos/Himmel` erst ab ≈ 1,30 zurück in sein Band kommt. Auch diese
   zwei schliessen sich aus — bei Faktor **1,80** landet der Wiesengrund
   übrigens exakt auf dem Referenzwert **56,9** der Vorlage, also auf dem
   Ziel, das der Bauer „Farbe und Grading" hat.

Daraus die Entscheidung dieses Nachtrags: **kein Faktor im Boden.** Ein
Regler an `bodenSonne`/`bodenAmbient` ist von einer Belichtungsänderung im
`look:`-Block nicht zu unterscheiden, und die Belichtung setzt der
Integrator. Zwei Stellen für dieselbe Wirkung heisst zweimal korrigiert.
Was das Bodenlicht braucht, ist eine Zahl im Profil, keine im Shader.

### Was offen bleibt

`Hangfels/Moos` 1,69 verlangt, dass die Felsbänder am Hang wirklich Fels
sind. Mit dem Deckel des Vorbilds (0,425 Felsgewicht ab 45°) trägt jeder
Bildpunkt Moos: A11 hat die Streuung auf 18,4 % reines Moos und **0 %
reinen Fels** gebracht — und misst damit dieselbe Verteilung wie die
Vorlage (19,2 / 0). Die Referenzzahl 1,69 stammt aus einem Bild, in dem
„Hangfels" ein FERNES, vom Dunst aufgehelltes Hangband ist und „Moos" ein
naher Streifen; das sind zwei verschiedene Entfernungen, kein
Albedo-Verhältnis. Solange beide Flächen aus einem Bild und aus derselben
Entfernung kommen sollen, ist 1,69 mit dem Splat des Vorbilds nicht
darstellbar. Die nächste ehrliche Zahl dafür wäre eine Neumessung der
Referenz mit Angabe der Entfernung je Rechteck.
