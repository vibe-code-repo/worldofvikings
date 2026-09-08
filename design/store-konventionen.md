---
tags: [wov, labor, store, messprobe, konventionen]
status: gemessen
erstellt: 2026-09-08
autor: Bauer D (Messprobe)
---

# Store-Konventionen — was gemessen ist, nicht was angenommen wird

Diese Datei sagt Bauer A (Registrierung) und dem Integrator, **wie** die 570
Prefabs aus `~/wov-assets/store/` in den alten Client gehören: gespiegelt oder
nicht, gedreht oder nicht, in welchem Maßstab, mit welchem Ursprung und woran
ein Kollisionsnetz zu erkennen ist.

Alle Zahlen unten sind gemessen, keine ist übernommen:

| Werkzeug | Was es misst |
|---|---|
| `tools/store-messprobe.mjs` | GLB-Rohdaten ohne Engine: Hüllbox, Ursprung, Knotenbaum mit Weltorten, gespiegelte Knoten (negative Determinante), Kollisionsknoten, Dreiecke, Abgleich gegen `prefabs.json`. `--uebersicht` zählt den ganzen Store durch. |
| `~/wov-lab-mess/messprobe-client.mjs` | Dasselbe Modell im **echten alten Client** (Playwright, offline, `__dbg.assets`): Welt-Hüllbox nach `computeWorldMatrix(true)`/`refreshBoundingInfo`, die ganze Knotenkette mit Weltdeterminante, der statische Bucket-Weg `getMasters()`, dazu die Bilder. Liegt bewusst ausserhalb des Repos (braucht den Store und einen laufenden Dev-Client). |

Aufbau der Messung: Arbeitsbaum `/home/mike/wov-lab-wt-messprobe`, darin
`assets/store → ~/wov-assets/store` und `assets/models/store → ../store`, dazu
`assets/models/textures/` (s. §6.1). Client mit
`WOV_CLIENT_PORT=5287 npm run dev:client`, Messung gegen
`http://localhost:5287/?offline&name=BauerD`. **Am Client-Quelltext wurde
nichts geändert.**

---

## 1 Die Messtabelle

Rohhüllbox = Modellkoordinaten aus der GLB (Knotenmatrizen angewandt).
Welt-Hüllbox = dasselbe Modell im Client, `instantiate()` an den Ursprung
gesetzt. Beide in Metern.

| Modell (Prefab-Id) | Rohhüllbox min → max | Welt-Hüllbox im Client min → max | x-Vorzeichen | Ursprung (min y) | Maßstab | „Vorne“ | Kollisionsknoten |
|---|---|---|---|---|---|---|---|
| `environment-sm-bld-preset-shelter-02-optimized` (Haus) | −0,493 / −1,250 / −5,890 → 7,993 / 7,556 / 0,890 | **−7,993** / −1,250 / −5,890 → **0,493** / 7,556 / 0,890 | **umgedreht** | −1,25 m (Pfosten stecken im Boden) | 1:1 | keine Fassadenachse (Modulteil) | keiner **im** Modell; eigene Datei `…-collision.glb` |
| `vegetation-tree-1e1` (Baum) | −6,701 / −0,428 / −8,345 → 7,228 / 16,845 / 5,462 | **−7,227** / −0,428 / −8,345 → **6,701** / 16,845 / 5,462 | **umgedreht** | −0,428 m (Wurzelanlauf) | 1:1 | keine | keiner; `collision.box` in `prefabs.json` |
| `environment-sm-env-rock-01` (Fels) | −0,163 / −0,134 / −0,175 → 0,163 / 0,134 / 0,175 | −0,163 / −0,134 / −0,175 → 0,163 / 0,134 / 0,175 (x symmetrisch) | umgedreht, sichtbar folgenlos | −0,134 m (Ursprung in der Mitte) | 1:1 | keine | keiner |
| `environment-sm-prop-sign-iron-02` (Schild, asymmetrisch) | −0,409 / −0,244 / −0,018 → 0,409 / 0,244 / 0,018 | gleiche Zahlen, **Bild seitenverkehrt** | **umgedreht** | −0,244 m (Ursprung in der Mitte, hängend) | 1:1 | Blech in der xy-Ebene, Dicke 3,6 cm in z | keiner |
| `environment-sm-bld-house-stairs-03` (Treppe) | −0,079 / 0 / −3,774 → 2,521 / 1,472 / 0,153 | **−2,521** / 0 / −3,774 → **0,079** / 1,472 / 0,153 | **umgedreht** | 0 (Bodenkontakt) | 1:1 | Stufen steigen nach +y bei −z | keiner; eigene Datei `sm-bld-house-stairs-03-collision.glb`, 216 Dreiecke |
| `environment-sm-veh-cart-01` (Karren, Zeuge) | −0,940 / 0 / −2,129 → 0,940 / 1,320 / 2,289 | gleiche Zahlen (x symmetrisch), **Räder tauschen die Seite** | **umgedreht** | 0 (Bodenkontakt) | 1:1 | **+z** (Vorderräder bei z = 0, Hinterräder bei z = −1,279) | keiner |
| `BirkeHoch1` (altes eigenes Modell) | −1,877 / 0 / −1,721 → 2,060 / 5,131 / 2,036 | **−2,060** / 0 / −1,721 → **1,877** / 5,131 / 2,036 | **umgedreht** | 0 | 1:1 | keine | keiner |
| `WikingerBasis` (altes eigenes Rig) | −0,296 / −0,000 / −0,102 → 0,296 / 1,000 / 0,102 | gleiche Zahlen (x symmetrisch), **L/R tauschen** | **umgedreht** | −0,4 mm | 1:1 | **−z** (Rig schaut rückwärts, s. §3.3) | keiner |

**Die Regel hinter der Spalte „Welt-Hüllbox“, an allen acht Modellen bestätigt:**

```
welt.min.x = −roh.max.x        welt.max.x = −roh.min.x
welt.min.y =  roh.min.y        welt.max.y =  roh.max.y
welt.min.z =  roh.min.z        welt.max.z =  roh.max.z
```

y und z bleiben **bitgleich**. Nur x wird gespiegelt.

### Der Zeuge, an dem das hängt

Eine Hüllbox beweist nichts über Spiegelung, wenn das Modell symmetrisch ist —
sie bleibt dann gleich. `sm-veh-cart-01` trägt seine Antwort aber im
Knotennamen:

| Knoten | Ort in der GLB | Ort im Client (Weltraum) |
|---|---|---|
| `SM_Veh_Cart_01_Wheel_fl` (vorne links) | x = **+0,7502**, z = 0 | x = **−0,7502**, z = 0 |
| `SM_Veh_Cart_01_Wheel_fr` (vorne rechts) | x = **−0,7502**, z = 0 | x = **+0,7502**, z = 0 |
| `SM_Veh_Cart_01_Wheel_rl` (hinten links) | x = +0,7502, z = −1,2787 | x = −0,7502, z = −1,2787 |
| `SM_Veh_Cart_01_Wheel_rr` (hinten rechts) | x = −0,7502, z = −1,2787 | x = +0,7502, z = −1,2787 |

In der Datei liegt **links bei +x**, vorne bei **+z** — genau die
glTF-Konvention. Im Client liegt links bei −x. Das ist keine Verdrehung des
Modells, sondern die Umbenennung der Achsen (§2).

---

## 2 Woher die x-Spiegelung kommt — und warum sie richtig ist

Babylons glTF-Lader hängt jede geladene Datei unter einen Knoten `__root__`.
Gemessen im Client (`node_modules/@babylonjs/loaders/glTF/2.0/glTFLoader.js`,
`_createRootNode`, Babylon 8.56.2) trägt der:

```
rotationQuaternion = (0, 1, 0, 0)   // halbe Drehung um y
scaling            = (1, 1, −1)
→ Weltdeterminante = −1 an jedem Knoten der Kette (gemessen an allen 8 Modellen)
```

Ausmultipliziert ist das `Ry(π) · diag(1,1,−1) = diag(−1, 1, 1)` — eine
Spiegelung in x. Genau das steht auch im Schwesterprojekt
(`packages/asset-system/src/scene-placement.ts`, `tooling/asset-pipeline/seating.ts`:
„The net effect of that root on a position is a mirror in x“).

**Trotzdem ist nichts spiegelverkehrt.** `diag(−1,1,1)` ist dieselbe Abbildung
wie `Ry(π) ∘ diag(1,1,−1)`: die Umrechnung von rechtshändig (glTF) auf
linkshändig (Babylon, `scene.useRightHandedSystem = false` — gemessen), gefolgt
von einer halben Drehung um die Hochachse. Eine Drehung spiegelt nicht. Das
Modell steht also körperlich richtig da; nur seine **Weltkoordinaten in x**
haben das Vorzeichen gewechselt, und seine autorenseitige Vorderseite (+z in
der Datei) zeigt danach nach +z in Babylon — also nach vorne.

Der alte Client geht mit dem negativen Vorzeichen bereits richtig um, auf
beiden Wegen:

* **Dynamisch** (`AssetManager.instantiate`): `__root__` bleibt in der Kette.
  Das ist ausdrücklich so gewollt — `EntityManager.setzeFremdesAussehen` warnt
  in einem Kommentar, dass ein direkt umgehängtes Teil „gespiegelt sitzt“.
* **Statisch** (`AssetManager.getMasters` → `zuMaster`): die Hierarchie wird in
  `localMatrix` eingeebnet; bei negativer Determinante wird die Kompensation in
  `sideOrientation` **eingebacken**. Gemessen an unseren Modellen:

  | Modell | Master | `localMatrix`-Determinante | `sideOrientation` |
  |---|---|---|---|
  | Haus | `SubMesh_0` | −1 | 1 (umgedreht) |
  | Fels | `SubMesh_0` | −1 | 1 |
  | Schild | `SubMesh_0` | −1 | 1 |
  | Treppe | `sm-bld-house-stairs-03` | −1 | 1 |
  | Karren | `sm-veh-cart-01_merged` | +1 | 0 (MergeMeshes dreht die Wicklung selbst) |
  | Baum | `Tree_1E1` / `…_merged` | −1 / +1 | 1 / 0 |

  Beide Fälle treten auf, beide werden bedient. Das ist genau der Mechanismus,
  den der Kommentar in `zuMaster()` beschreibt („hollow-looking rocks,
  half-missing trunks“) — er greift bei den Store-Modellen unverändert.

---

## 3 Empfehlungen

### 3.1 Spiegeln: **NEIN** — `STORE_SPIEGELN_VORGABE = false`

Store-Modelle werden **nicht zusätzlich gespiegelt**, weder beim Import noch
beim Platzieren. `__root__` bleibt unangetastet.

Begründung in einem Satz: die Spiegelung, die man an der Determinante sieht,
IST die Händigkeitsumrechnung; wer sie „korrigiert“, wendet sie ein zweites Mal
an und dreht die Modelle tatsächlich um.

Konkret heisst „unangetastet“:

* `__root__.scaling` niemals **setzen**, nur **multiplizieren**
  (`scaling.scaleInPlace(faktor)`). Ein zugewiesenes positives `scaling` löscht
  das `−1` in z und stülpt das Modell um. (Dieselbe Falle ist im
  Schwesterprojekt kommentiert.)
* Die dynamische Wurzel bleibt in der Kette; Netze nicht direkt umhängen.
* Auf dem Bucket-Weg nichts an `sideOrientation` nachbessern — `zuMaster()`
  macht das bereits und würde doppelt wirken.

Anders liegt der Fall nur beim **Gelände**: das Schwesterprojekt löscht dort
den Loader-Root ganz (`clearLoaderTransform`), weil ein 0…300-Tile sonst bei
−300…0 läge. Für Prefabs gilt das nicht.

### 3.2 Zusätzliche Drehung um y: **0°**

Keine Korrekturdrehung. Der Store folgt der glTF-Konvention (vorne = +z, links
= +x in der Datei); Babylon bildet das auf vorne = +z im Weltraum ab, und +z
ist die Vorwärtsachse des Clients. Der Karren belegt das: Vorderräder bei
z = 0, Hinterräder bei z = −1,279, im Client unverändert.

Einschränkung, die dazugehört: **die allermeisten Store-Modelle haben gar keine
Vorderseite.** Von 581 Dateien tragen ganze **6** Knotennamen mit einer
Links/Rechts- oder Vorne/Hinten-Angabe (zwei Karren, drei Kulissen, ein
Wandbrett). Der Rest sind Bausteine eines Modulkits — Wände, Dächer, Felsen,
Pflanzen. Für die ist „vorne“ keine Eigenschaft des Modells, sondern eine
Entscheidung beim Setzen. 0° ist deshalb nicht nur richtig, sondern die einzige
Vorgabe, die man überhaupt begründen kann.

### 3.3 Das alte eigene Modell fällt aus der Reihe — und das ist kein Widerspruch

`WikingerBasis` (Blender/Tripo-Export) hat **`L_Thigh` bei x = −0,054 und
`R_Thigh` bei x = +0,053** — in der Datei liegt links also bei −x, umgekehrt
zum Store. Nach Babylons Umrechnung liegt links bei +x, und die Figur schaut
nach −z.

Das ist die Notiz „Client spiegelt eigene Modelle / eigene Exporte müssen
vorgespiegelt werden“ in Zahlen: die eigenen Modelle wurden so gebaut, dass sie
**nach** der Laderumrechnung stimmen. Die Store-Modelle brauchen das nicht, weil
sie die glTF-Konvention schon einhalten. **Für Bauer A folgt daraus: die
Vorgabe für Store-Modelle darf nicht aus dem Verhalten der Altmodelle abgeleitet
werden.** Beide Bestände sind in sich stimmig und unterscheiden sich um 180°.

### 3.4 `localScale` = 1, `renderScale` = gemessene Hüllbox

Alle 581 GLB im Store sind in **Metern** gebaut, keine trägt eine
Knotenskalierung ≠ 1, und die Werte in `prefabs.json` stimmen **auf allen 581
Dateien bitgenau** mit der Nachmessung überein (Abweichung 0,0000 in min und
max). Für `renderScale` also direkt `bounds` aus `prefabs.json` nehmen; ein
`localScale` ≠ 1 wäre bei diesem Bestand immer ein Fehler.

**Aber `bounds` steht im Dateiraum, nicht im Weltraum.** Wer aus `bounds` oder
`collision.box` eine Kiste im Weltraum baut, muss x umklappen:

```
box.min.x_welt = −box.max.x_datei
box.max.x_welt = −box.min.x_datei     // y und z unverändert
```

Bei symmetrischen Modellen fällt das nie auf — beim Haus (−0,49 … 7,99) sitzt
die Kiste sonst 8 Meter neben dem Modell.

Dasselbe gilt für **Platzierungen**: übernimmt der Integrator irgendwann
Positionen aus der Ursprungsszene des Stores, müssen die x-Koordinaten
mitgespiegelt werden (das Schwesterprojekt konjugiert die ganze Matrix,
`S·M·S` mit `S = diag(−1,1,1)`). Ein einzelnes Modell sieht richtig aus; ein
Ensemble aus Kitteilen steht ohne diese Spiegelung seitenverkehrt zusammen.

### 3.5 Kollisionsnetze: eigene DATEI, nicht eigener Knoten

Im Store gibt es **kein einziges** Modell mit einem Kollisionsnetz *im* Modell.
Die alte `_col`-Konvention (ein Mesh in derselben GLB) kommt hier nicht vor.
Stattdessen:

* **Namensmuster: `<modell>-collision.glb`** — eine Schwesterdatei neben dem
  Modell. Gefunden: **12 Stück**, alle unter `environment/`:
  `sm-bld-boathouse-01`, `sm-bld-house-stairs-02/-03/-04`, `sm-bld-outhouse-01`,
  `sm-bld-preset-shelter-01-optimized`, `sm-bld-preset-shelter-02-optimized`,
  `sm-bld-wooden-tower-01/-02`, `sm-prop-dock-01/-02`,
  `sm-prop-wagon-broken-01`.
* Sie tragen **kein Bild und ein `DefaultMaterial`** und dürfen nie als
  sichtbares Prefab registriert werden. Erkennungsregel für den Import:
  `/(^|[-_])col(lision)?([-_.]|$)/i` auf **Dateiname und Wurzelknotennamen** —
  beide passen bei allen 12.
* `prefabs.json` verweist über `collision.asset.path` allerdings nur auf
  **3** davon (`sm-bld-house-stairs-03`, `sm-bld-preset-shelter-02-optimized`,
  `sm-prop-dock-02`). **Neun Kollisionsdateien sind verwaist.** Wer nur der
  `prefabs.json` folgt, verliert sie — wer nur dem Ordner folgt, registriert
  neun unsichtbare Prefabs.
* Verteilung der Kollisionsarten über die 570 Prefabs: **524 `box`** (davon nur
  **73** mit eigener, engerer `collision.box` — alle Vegetation, damit man durch
  die Krone laufen kann), **19 `mesh`** (3 mit Datei, 16 ohne: `sm-prop-archway-01`
  und die 15 Geländekacheln), **27 `none`**.
* Die Kollisionshülle der Treppe stimmt mit der Sichthülle überein
  (−2,52 … 0,08 in x im Weltraum, gemessen), sie ist also im selben Raum
  gebaut und wird von `__root__` genauso gespiegelt.

---

## 4 Bilder

Je Modell zwei Aufnahmen aus **demselben** Kamerastandpunkt. Der einzige
Unterschied ist die Laderumrechnung: `-client` zeigt den Zustand, wie der
Client das Modell zeichnet; `-roh` zeigt dasselbe Modell, nachdem
`__root__.scaling` auf `(1,1,1)` und die Wurzeldrehung auf die Einheit gesetzt
wurden — also die Rohdaten der Datei, als Babylon-Koordinaten gelesen. Die
beiden Bilder eines Paars sind spiegelbildlich; die **Form** ist in beiden
vollständig und massiv, nichts ist hohl oder umgestülpt.

| Bild | Aussage |
|---|---|
| `/home/mike/.cache/wov-lab/messprobe-haus-client.png` / `…-haus-roh.png` | Deutlichstes Paar: das kurze Dachüberstand-Ende wechselt die Seite, das Dach fällt in die andere Richtung. |
| `/home/mike/.cache/wov-lab/messprobe-treppe-client.png` / `…-treppe-roh.png` | Treppe mit Podest — Rampe zeigt einmal nach rechts unten, einmal nach links unten. |
| `/home/mike/.cache/wov-lab/messprobe-schild-client.png` / `…-schild-roh.png` | Ambossschild: das Horn zeigt im Client nach links, roh nach rechts. |
| `/home/mike/.cache/wov-lab/messprobe-baum-client.png` / `…-baum-roh.png` | `tree-1e1`, Stamm und Astwerk. |
| `/home/mike/.cache/wov-lab/messprobe-fels-client.png`, `…-treppe-koll-*.png`, `…-karren-*.png`, `…-birke-alt-*.png`, `…-wikinger-alt-*.png` | weitere Paare, s. Einschränkung §6.3. |

---

## 5 Zensus über den ganzen Store

`node tools/store-messprobe.mjs --uebersicht`, 581 GLB, 570 Prefabs, 0 Lesefehler:

| Befund | Zahl | Bedeutung für die Registrierung |
|---|---|---|
| Dateien mit einem gespiegelten Knoten **in der GLB** | **0** | Kein Modell bringt eine eigene Spiegelung mit. Das Vorzeichen kommt ausschliesslich von `__root__`. |
| Ursprung exakt auf dem Boden (\|min y\| < 1 mm) | **212** | |
| Geometrie **unter** y = 0 (min y < −5 cm) | **257** | **Nicht hochschieben.** Der Ursprung ist der autorenseitige Bodenkontaktpunkt, nicht die Unterkante: Pfosten stecken absichtlich im Boden, Wurzelanläufe reichen darunter. Ein „Snapping“ auf die Hüllbox hübe jeden Baum in die Luft. |
| dazwischen / über y = 0 | 100 | |
| Kollisionsdateien (leer nach Sichtgeometrie) | **12** | nie als sichtbares Prefab registrieren |
| „Riesen“ > 80 m Kantenlänge | **17** | 3 Kulissen (`backdrop-mountains-clear/-snow` je 594 × 297 × 594 m, `backdrop-sky-dome` 132 m) und 14 Geländekacheln (200–300 m). Das sind **keine** Prefabs im Sinne des alten Clients — Kulissen gehören hinter den Nebel, Gelände in den Geländeweg. |
| Modelle mit Ursprung weit über der Geometrie | z. B. `sm-item-horn` (min y = −15,20 m), `sm-item-bag-large` (−14,89 m), `sm-item-shrooms` (−8,82 m) | Diese drei sind aus einer Szene herausgeschnitten und haben den Szenenursprung behalten. Wer sie an eine Spielerposition setzt, sieht sie 15 m tiefer. Vor der Registrierung prüfen. |
| GLB mit **externen** Texturen | **468** von 581 | s. §6.1 — das ist die Stelle, an der der Import zuerst scheitert |
| GLB ohne Bilder | 113 | Kollisionsdateien, Gelände, Kulissen |
| Abweichung `prefabs.json` ↔ Nachmessung | **0** von 581 | `bounds` ist belastbar, aber im Dateiraum (§3.4) |

---

## 6 Was Bauer A wissen muss, bevor er anfängt

### 6.1 Die Texturen liegen neben der GLB, Babylon sucht sie an der Basis-URL

468 der 581 GLB tragen ihre Bilder **nicht eingebettet**, sondern als relative
URI der Form `textures/<name>.png` (31 verschiedene Dateien). Diese URI ist
relativ zum **Ordner der GLB** gemeint — im Store liegen die Bilder unter
`store/textures/`, `store/environment/textures/` und
`store/vegetation/textures/`.

Babylon löst sie aber gegen die **rootUrl** auf, die
`AssetManager.loadContainer` übergibt, und die ist fest
`MODEL_BASE_URL = '/assets/models/'`. Aus `store/environment/foo.glb` mit
`textures/bar.png` wird deshalb `/assets/models/textures/bar.png` — nicht
`/assets/models/store/environment/textures/bar.png`.

Gemessene Wirkung: **das Modell lädt gar nicht.** Der ganze Container fällt mit
`RuntimeError: … /images/0/uri: Failed to load 'textures/…': 404` aus, und
`instantiate()` liefert `null` — kein Platzhalter, keine sichtbare Ursache. In
der ersten Messrunde scheiterten daran alle sechs Store-Modelle auf einmal.

Zwei Auswege, beide ohne Änderung an der Ladelogik denkbar:

1. **Einen flachen `textures/`-Ordner unter `assets/models/` bereitstellen.**
   Die drei Texturordner des Stores enthalten zusammen 45 Dateien und
   **kollidieren in keinem einzigen Namen** — ein flacher Ordner ist also
   verlustfrei. So läuft diese Messprobe.
2. Den Ordner der Datei als rootUrl übergeben (`modelBaseUrl` erweitern). Das
   ist eine Änderung am Ladeweg und gehört zu Bauer A, nicht hierher.

### 6.2 Der Dateiname ist der Prefabname mit Ordner

Über den unveränderten Ladeweg funktioniert
`assets.instantiate('store/environment/sm-veh-cart-01')`, sobald
`assets/models/store` auf den Store zeigt. Der Name mit Schrägstrichen läuft
durch `MODELL_ALIAS`, `modelBaseUrl()` und `SceneLoader` ohne Sonderbehandlung —
gemessen, nicht vermutet.

### 6.3 Eine offene Stelle, ehrlich benannt

Im Messaufbau zeichnen **`sm-veh-cart-01`, `BirkeHoch1` und `WikingerBasis`
kein Pixel**, obwohl alle ihre Netze angeschaltet sind, Geometrie tragen und in
`scene.getActiveMeshes()` stehen; auch als Drahtgitter, unbeleuchtet und ohne
Rückseiten-Culling bleibt das Bild leer. Haus, Treppe, Schild, Fels und der
Baumstamm zeichnen im selben Lauf normal.

Das ist mit hoher Wahrscheinlichkeit ein Fehler des **Messaufbaus**, nicht der
Modelle: `BirkeHoch1` ist ein Altbestandsmodell, das im Spiel unbestritten
sichtbar ist. Die Zahlenmessung hängt nicht daran — sie liest die
Transformationskette, nicht das Bild. Für den Karren steht der Beweis ohnehin
in den Knotennamen (§1). **Wer die Bilder erneuert, sollte diese Stelle zuerst
aufklären**, statt aus einem leeren Bild auf ein kaputtes Modell zu schliessen.

---

## 7 Kurzfassung für die Registrierung

```
STORE_SPIEGELN_VORGABE = false      // __root__ bleibt, Determinante −1 ist richtig
STORE_DREHUNG_Y        = 0          // vorne = +z, wie glTF es meint
localScale             = 1          // Meter, 1:1, an 581 Dateien geprüft
renderScale            = prefabs.json bounds  (x-Intervall für den Weltraum umklappen!)
Kollisionsnetz         = Datei „<modell>-collision.glb“, 12 Stück, nie sichtbar registrieren
Ursprung               = Bodenkontaktpunkt des Autors, NICHT auf min y = 0 schieben
Ausschliessen          = 3 Kulissen + 14 Geländekacheln (> 80 m) + 12 Kollisionsdateien
Vor allem anderen      = Texturpfade auflösen (§6.1), sonst lädt gar nichts
```
