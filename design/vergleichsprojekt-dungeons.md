# Analyse: Wie ein Vergleichsprojekt Dungeons baut

**Quelle:** flacher Klon des Vergleichsprojekts vom 30.08.2026.
Bezug: [[Dungeon Generator 2.0]].

**Wichtigste Korrektur vorweg:** Das Vergleichsprojekt baut die *Architektur nicht zur Laufzeit aus Dreiecken*. Es setzt fertige
GLB-Module (KayKit Dungeon Remastered) instanziert auf Positionen, die aus reinen Zahlen-Layouts berechnet werden.
Übertragbar ist also **nicht** der Geometriebau, sondern die **Datendisziplin**:
ein Layout, aus dem Darstellung *und* Kollision abgeleitet werden, deterministisch aus einem Deskriptor erzeugt,
und ein triplanares Oberflächen-Layer über allem. Unser Beschluss (Geometrie aus Zellen zur Laufzeit) ist die
konsequentere Fassung derselben Idee — und löst mehrere Klassen von Schmerzen des Vergleichsprojekts, die unten benannt sind, bauartbedingt.

---

## 1. Schichtung und Systemgrenze

Das Vergleichsprojekt hat **eine** Simulation, die in drei Wirten läuft (Browser, Node-Server, headless). Erzwungen wird das nicht
durch Konvention, sondern durch einen Dauertest: er scannt die Sim-Schicht und lässt
keinen Import von `three`, `render/`, `ui/`, `net/`, keinen DOM-Zugriff und keine Zufalls- oder Zeitquelle außerhalb
des gesetzten Rng zu. Der Server importiert exakt dieselben Module.

Die Layout-Daten liegen deshalb in der Sim-Schicht:

- Kopfkommentar des Layout-Moduls — „*the single source of truth for BOTH the visual module placement … and the
  interior collision sets … This kills the old hand-mirroring between renderer geometry and collider literals.*“
- Kopfkommentar des Delve-Layouts — dasselbe für die Delve-Module, ausdrücklich „*Sim layer: no three.js imports*“.
- Die Render-Seite hat ein *Geschwistermodul*, das ebenfalls kein
  three.js importiert, damit ein Vitest Render-Platzierung und Kollision direkt gegeneinander sweepen kann.

**Für uns:** Der Geometrie-Bauer und das Layout gehören nach `shared/`, und wir brauchen die gleiche Dauerprüfung —
ein Test, der `shared/` gegen jeden `@babylonjs/*`-Import und jeden DOM-Zugriff verriegelt. Das ist billig und
verhindert genau den Rückfall, der uns zwingen würde, Geometrie über die Leitung zu schicken.

---

## 2. Datenmodell: ein Layout, viele Konsumenten

`DungeonLayout` ist eine reine Zahlenstruktur:

| Feld | Bedeutung |
|---|---|
| `zMin`/`zMax`, `sideWallZ`/`sideWallHd`, `wallX`, `endWallHw`, `floorHalfX` | rechteckige Hülle |
| `pillars`, `tombs`, `stubs`, `clutter` | Hindernisse als Punkt-/Kastenlisten |
| `dais` + `daisRaised` | Bossbühne, begehbar, **absichtlich ohne Collider** |
| `illusionWalls` | gerendert, aber bewusst **nicht** in `layoutColliders` |
| `shellPolygon` + `shellPole` | nicht-rechteckiger Raum; ersetzt die Hülle für Render *und* Kollision |
| `rooms`/`doors`/`decor`/`ledges` | handgebauter Raumgraph, ersetzt die Hülle vollständig |

Daraus zieht **eine** Funktion die Kollision: `layoutColliders()`. Sie
verzweigt in derselben Reihenfolge, in der der Renderer verzweigt: Raumgraph → Polygon-Hülle → Rechteck-Hülle,
dann Stubs, Pfeiler, Wandnischen, Bodenkram.

Die Stil-Daten sind vom Layout getrennt: `InteriorStyle` trägt Fackelfarben, Nebel und
multiplikative Wand-/Bodentönungen. Der Kommentar dort ist genau unser „Theme per Tint + Material-Seed“-Beschluss:
dasselbe Kit wird pro Lauf neu eingefärbt, statt neue Assets zu bauen.

**Für uns:** Das Feldschema ist nicht direkt übernehmbar (das Vergleichsprojekt ist parametrisch-rechteckig, wir sind zellbasiert),
aber die *Trennung* ist es: `Layout` (Struktur) ⟂ `Style` (Farbe/Material) ⟂ `Plan` (Spawns/Objekte). Und die
Regel „was gerendert wird, aber nicht kollidiert, steht als eigenes Feld im Layout“ (`illusionWalls`) statt als
Sonderfall im Renderer.

---

## 3. Determinismus-Mechanik

Der Kern steht im Kopfkommentar des Rift-Generators:

> „*pure, deterministic functions that turn a compact descriptor (seed + baseLevel + floorIndex) into a fully-resolved
> floor … The authoritative server and every client call these identical functions, so no rift geometry is ever
> transmitted, only the descriptor.*“

Bausteine:

1. **Rng = mulberry32**, ganzzahlig, `Math.imul`-basiert. Kein `Math.random`, keine Uhr.
2. **Seed-Mischung statt geteiltem Strom für getrennte Belange:** `mixSeed(seed, salt)`,
   verwendet u. a. für Etagenzahl, Thema,
   Set-Piece-Wurf und den Etagenstrom selbst. Jeder Aspekt zieht aus seinem eigenen Strom,
   deshalb verschiebt eine Änderung an einem Aspekt die anderen nicht.
3. **Innerhalb einer Etage aber genau ein Strom** — und das ist die dokumentierte Falle:
   ein Kommentar im Generator warnt, dass die Paketzahl bewusst am *ursprünglichen* Bandanfang hängt, weil
   „*Changing the draw COUNT here would shift every downstream object, hazard and roller on every procedural floor
   as a side effect.*“ Ein einziger zusätzlicher `rng.chance()` in `buildLayout` würde jede Etage jedes Seeds
   umwürfeln. Genauso schaltet der Set-Piece-Pfad **vor** dem ersten Zug ab, damit die Ziehreihenfolge
   der anderen Läufe unberührt bleibt.
4. **Memoisierung ist Politik, nicht Semantik:** LRU-Cache über den Deskriptorschlüssel
   mit dem ausdrücklichen Vermerk „*generation is deterministic per key, so
   results are identical either way*“.
5. **Stabile Positions-Hashes ohne Rng** für alles, was pro Slot gleich sein muss:
   `tombSlotRoll(x,z)` ist *der eine* Wurf, den Renderer und Collider beide
   lesen — „*so mesh and physics can never disagree*“.

### Abweichung, die uns betrifft (wichtig)

`tombSlotRoll` und der Render-Hash `hash2` sind **`Math.sin`-basiert**:
`Math.sin(a*127.1 + b*311.7) * 43758.5453`. `Math.sin` ist in ECMAScript **nicht bitgenau spezifiziert**. Im Vergleichsprojekt
fällt das nicht auf, weil Server und Client faktisch V8 sind. Bei uns läuft der Collider-Bau auf dem Node-Server
und die Darstellung in beliebigen Browser-Engines — ein Firefox-Client kann dann eine andere Sargform stehen
haben als der Server berechnet. **Regel für uns: jeder Hash, den Server *und* Client auswerten, ist ganzzahlig**
(`Math.imul`-Kette wie beim Rng), niemals trigonometrisch. Das ist eine harte Übernahme *mit*
Korrektur, kein Kopieren.

---

## 4. Layout-Generierung (der eigentliche Generator)

`buildLayout()` arbeitet so:

1. Länge würfeln, Archetyp würfeln aus 8 Silhouetten, Boss-Etagen nur aus den hinten
   breiten.
2. Der Archetyp ist eine **Halbbreiten-Profilfunktion** `t ∈ [0,1] → halfWidth` (`makeProfile`):
   `rotunda` = Sinus, `taper` = linear, `apse` = Smoothstep ab der Hälfte, `hourglass` = invertierter Sinus,
   `chambers` = `cos(4πt)`, `cavern` = drei Harmonische mit gewürfelten Phasen, `corridor` = konstant schmal.
3. Aus dem Profil wird alle 6 Einheiten ein Polygon abgetastet und **validiert**: einfach (keine
   Selbstschnitte) und sternförmig vom Mittelpol. Fällt die Prüfung durch → Rückfall auf das Rechteck.
   Sternförmigkeit ist die Bedingung, unter der Wandverfolgung, Bodenmaske und Pfadlogik alle
   funktionieren.
4. Hindernisse werden **entlang der lokalen Breite** gesetzt, nicht auf ein globales Raster: Pfeilerreihen mit
   `inset = min(base, halfWidthAt(z) - 3)`, Wandnischen bei `halfWidthAt(z) - 4`, Prallwände
   („baffles“) als kurze Finnen von der Wand her.
5. **Eine Invariante trägt alles:** der Mittelgang `|x| ≤ AISLE_HALF = 5.5` bleibt per Konstruktion frei.
   Deshalb terminiert `toClear()` garantiert: es
   schiebt einen blockierten Punkt in festen Schritten Richtung Mitte, und die Mitte ist definitionsgemäß frei.
6. `generateRiftFloor()` setzt darüber die Reihenfolge Layout → Style → Puzzle → Eis → Spawns →
   Objekte → Hazards → Roller → Plattform → Gate, mit einer expliziten „genau ein Leitmechanik pro Etage“-Regel.

**Für uns übertragbar:**

- Der **Archetyp-als-Funktion**-Trick ist auch zellbasiert gültig: das Profil erzeugt dann nicht ein Polygon,
  sondern eine Zellmaske (`zelleAktiv(cx,cz)`). Wir gewinnen dabei sogar: die im Vergleichsprojekt dokumentierte
  Treppenstufen-Kante der Bodenmaske (siehe §7) entfällt, weil die Zelle *die* Auflösung ist.
- Die **Validierungsstufe mit Rückfall** ist Pflicht: sternförmig/einfach ersetzen wir durch
  Zusammenhang + Erreichbarkeit (Flood-Fill vom Eingang zum Boss), und bei Durchfall wird deterministisch auf
  eine einfache Form zurückgefallen — nicht neu gewürfelt (neu würfeln kostet Determinismus-Klarheit).
- Die **freie Achse** (Vergleichsprojekt: Mittelgang) sollten wir als „garantierter Pfad“ übernehmen: eine
  Zellen-Rückgratkette, die kein Stempel überschreiben darf. Ohne so eine Invariante wird jede
  Erreichbarkeitsprüfung zu einer Schleife, die auch scheitern kann.
- **Getrennte Rng-Ströme pro Aspekt**, nicht nur pro Etage — hier gehen wir bewusst weiter als das Vergleichsprojekt.
  `mixSeed(seed, SALT_LAYOUT)`, `SALT_DRESSING`, `SALT_SPAWNS`. Dann kostet das Nachjustieren der Deko keine
  Neuwürfelung der Räume, und der Kommentar im Generator des Vergleichsprojekts beschreibt einen Schmerz, den wir nie haben.

---

## 5. Laufzeit-„Geometriebau“ und Instancing

`DungeonInteriors` ist der Bauer. Ablauf:

1. **Assetaufbereitung einmalig:** `extractModule()` traversiert das GLB, wirft alle Attribute außer
   `position`/`normal`/`uv` weg, backt Meshopt-quantisierte Attribute nach Float um (`attributeToFloat`,
   sonst klemmt `applyMatrix4` Weltwerte in `[-1,1]`), bäckt die Weltmatrix ein und **merged** alle Submeshes zu
   einer Geometrie. Ergebnis: ein `{geo, pack}` pro Modulname.
2. **Platzierung sammeln, nicht zeichnen:** `class Placements` akkumuliert `Matrix4` pro Modulart.
3. **Ausgabe:** `emit()` macht aus jeder Art *eine* `InstancedMesh`, wählt dabei je nach Variante
   das getönte oder das geteilte Material, setzt `castShadow` nur für Kaster-Arten und `receiveShadow` nur für
   Empfänger-Arten. Zielgröße laut Kopfkommentar: **~30 Draws pro Innenraum**.
4. **Boden** `placeFloor()`: Rasterlauf in 4er-Zellen (`FLOOR_CELL = 4`) über
   `[-floorHalfX, floorHalfX] × [zMin-2, zMax+2]`, Kachelart aus dem Positionshash, Maskierung gegen
   `shellPolygon` per `polygonContainsPoint`. `FLOOR_Y = -0.05`, damit die Kachel*oberkante* auf y=0
   landet — die Sim rechnet mit y=0.
5. **Wände** `placeWalls()` und `placePolygonWalls()`: siehe §7, das ist der interessante
   Teil.

**Babylon-Abweichungen (unsere Seite):**

| Vergleichsprojekt / three.js | World of Vikings / Babylon 8 |
|---|---|
| `mergeGeometries` über GLB-Submeshes | entfällt — wir bauen `VertexData` direkt; stattdessen lohnt das *Zusammenfassen ganzer Räume* zu wenigen Meshes (`VertexData.merge` bzw. eigene Puffer) |
| `THREE.InstancedMesh` pro Modulart | **Thin Instances** (`thinInstanceSetBuffer('matrix', …)`) für Deko-Wiederholer; für unsere Wände/Böden meist *gar keine* Instanzen, weil zusammengebackene Geometrie billiger ist als tausende gleicher Quader |
| `mesh.computeBoundingSphere()` nach Instanzsetzen | Thin Instances brauchen `thinInstanceRefreshBoundingInfo()`, sonst culled Babylon falsch |
| `castShadow`/`receiveShadow` pro Mesh | `shadowGenerator.addShadowCaster(mesh)` + `mesh.receiveShadows`; Auswahl aber nach derselben Kaster-/Empfänger-Liste |
| implizite Matrixaktualisierung | `mesh.freezeWorldMatrix()`, `material.freeze()`, `scene.blockMaterialDirtyMechanism` beim Bau; sonst zahlen wir den Aufbau jedes Bild neu |
| ein Material pro Pack, geklonte Tönungen | in Babylon Tönung über *Instanz-Farbe* oder Material-Instanzen; Achtung: jede Materialvariante = eigener Shader-Compile |

Das Vergleichsprojekt hat außerdem eine **Ressourcen-Buchhaltung**, die wir 1:1 brauchen und in Babylon sogar dringender:
Ein Lebenszyklus-Modul führt pro Innenraum-Wurzel eine Registry, die nur Ressourcen *ohne*
„geteilt“-Markierung aufnimmt (`markSharedGeometry`/`markSharedMaterial`/`markSharedTexture`).
Beim Abbau einer Instanz wird nur Eigenes freigegeben. In Babylon ist
`mesh.dispose(doNotRecurse, disposeMaterialAndTextures)` genau die Falle: ein unbedachtes `true` schießt das
geteilte Dungeon-Material für alle laufenden Instanzen ab.

---

## 6. Materialsystem: das triplanare Detail-Layer

Das ist der technisch dichteste und für uns wertvollste Teil. Der Kopfkommentar des Detail-Moduls beschreibt das
Ziel exakt so, wie wir es beschlossen haben: Die GLB-UVs zeigen auf Palettenfelder, taugen also nicht für Detail;
also wird **pro Materialfamilie** ein CC0-PBR-Satz **world-space triplanar** darübergelegt und mit dem komponiert,
was das Material ohnehin tut. Und die Schlussregel: „*The layer must stay SUBTLE: the game's look is cozy
low-poly, the detail suggests material, never photoreal.*“ — das ist unser Barrow-Leitbild.

### Aufbau

- **Sieben Familien**: `stone` (Bricks076A, gemauert), `rock` (Rock026, natürlicher Bruch), `wood`,
  `plaster`, `bark`, `fabric`, `metal`. Der Kommentar dazu erklärt die für uns wichtigste Trennung:
  Mauerwerk trägt Läuferverband-Fugen, die auf einem Findling absurd aussehen — **geologisches Gestein bekommt
  eine eigene Familie**. Für ein Steingrab heißt das mindestens: behauene Quader vs. Fels/Erde vs. Moos-Untergrund.
- **Pro Familie gemessene Konstanten**: `dispCenter`/`dispSd` (Mittel und Standardabweichung der
  Displacement-Map), `aoMean`, `roughMean`, `metalMean` — per `ffmpeg signalstats` über das ausgelieferte
  1K-Asset ermittelt. Sie tragen zwei Dinge: (a) die Parallaxen-Amplitude wird als `parallaxDepth / dispSd`
  **normalisiert**, weil die Maps 10-fach unterschiedliche Dynamik haben; (b) die Distanzblende
  konvergiert gegen genau die Mittelwerte, gegen die auch die Mipkette konvergiert, sodass ein Ausblenden der
  Taps die Helligkeit einer fernen Wand *nicht* verschiebt.
- **Kanäle:** Normale (Whiteout-Blend nach Golus), AO multipliziert die Diffuse in ein Familienband,
  Roughness lerpt Richtung Map, Metalness nur für Metall, und ab Ultra
  eine 3–4-Tap-Parallaxe entlang des Blickstrahls plus Höhenschattierung der Diffuse.

### Die drei Ideen, die wir übernehmen müssen

1. **Dominanzebenen-Kollaps**: Gewichte `w = normalize(pow(|n|, 4))`, dann
   `w = normalize(max(w - 0.15, 0))`. Dadurch wird jede Fläche innerhalb von ~33° zu einer Achse **exakt**
   one-hot, stetig und ohne Schwellensprung — und die Sampler-Funktion nimmt den Ein-Tap-Schnellpfad
   (`wornTriR`). **Für ein Barrow aus ruhigen Quadern heißt das: Triplanar kostet uns fast überall
   einen Tap statt drei.** Das ist das entscheidende Performance-Argument für unsere Stufe „Mittel“.
2. **Distanz-Blenden als Compile-Konstanten** (`scaledFadeBands`): Die Parallaxe endet
   dort, wo eine Standardabweichung Höhe unter 2 Bildschirmpixel projiziert; das Detail-Layer endet dort, wo die
   Mipstufe 5 erreicht ist. Beides wird aus dem *effektiven* Kachelmaß berechnet und als Literal in den Shader
   gebacken, mit `if (wornCamD < …)` als Sprungwächter — ferne Flächen kosten null Taps.
3. **Nachträgliche Anwendbarkeit auf fremde Materialien**: `applySurfaceDetail(mat, family, opts)`
   hängt sich an ein bestehendes Material an, ruft einen eventuell vorhandenen Vorgänger-Hook zuerst
   und ist idempotent.

### Babylon-Abweichungen (hier weichen wir am stärksten ab)

- **Injektionsmechanik.** three.js: `onBeforeCompile` + String-`replace` auf `#include <color_fragment>`,
  `<roughnessmap_fragment>`, `<metalnessmap_fragment>`, `<normal_fragment_maps>`. Babylon 8 kennt
  diese Chunks nicht. Wir nehmen `MaterialPluginBase` mit `getCustomCode(shaderType)` und den
  `CUSTOM_*`-Markern des PBR-Shaders. **Die genauen Marker-Namen und ihre Reihenfolge relativ zu
  Albedo/Normale/Reflectivity müssen gegen die Babylon-8-Quelle verifiziert werden** — das gehört in die
  Babylon-Recherche, nicht in die Annahme. Muster existiert bereits im Client (PbrNebelFix, NebelRichtung,
  StandardGammaFix).
- **Varyings geschenkt.** Das Vergleichsprojekt muss `vWornWorldPos`/`vWornWorldNormal` selbst deklarieren und im Vertex-Shader
  die Instanzmatrix von Hand anwenden. Babylons PBR liefert `vPositionW` und `vNormalW` bereits
  weltraumtransformiert, inklusive Instanzen. **Ein ganzer Fehlerkanal fällt bei uns weg.**
- **Programm-Cache-Schlüssel.** Das Vergleichsprojekt muss `customProgramCacheKey` von Hand bauen und dabei
  Familie, Texturbereitschaft, Tap-Zahl, Projektionsmodus, Blendbänder und den Schlüssel des Vorgänger-Hooks
  hineinkodieren — weil three.js sonst zwei verschiedene Materialien in dasselbe Programm zusammenfallen lässt.
  Babylon macht das über `getClassName()` + `prepareDefines()`/`getUniforms()` des Plugins selbst; wir dürfen den
  three.js-Trick **nicht** nachbauen, aber wir müssen jeden tier-abhängigen Wert als **Define** führen (nicht als
  Uniform), sonst rekompiliert Babylon beim Stufenwechsel nicht.
- **Klon-Falle.** In three.js verliert `Material.clone()` den `onBeforeCompile`-Hook; das Vergleichsprojekt rettet sich mit einem
  JSON-fähigen `userData.surfaceDetailSpec`, aus dem ein Klon-Hilfsmodul das Layer neu anhängt
  Ob Babylons `Material.clone()` Plugins mitnimmt, ist **zu prüfen** — wenn nicht, brauchen wir
  dieselbe Wiederanheft-Spezifikation.
- **Grafikstufen.** Das Vergleichsprojekt hat ein einziges `GFX`-Objekt mit monotoner Leiter und `gfxTierAtLeast(tier, floor)`,
  Knöpfe wie `surfaceDetail`, `surfaceDetailTaps`, `surfaceDetailClampK`,
  plus URL-Override `?gfx=…` und einen Dev-Killschalter pro Layer (`?worndetail=off`).
  Das ist genau unsere „Grafikstufen, je Effekt schaltbar“-Anforderung und sollte in
  Struktur übernommen werden — inklusive des Killschalters, weil er A/B-Messung ohne Codeänderung erlaubt.
- **Getestet wird der Shader als Text:** ein Test kompiliert das Layer mit gemocktem
  Loader unter verschiedenen `?gfx=`-Presets und prüft den erzeugten Fragment-Quelltext. Das ist in Babylon
  genauso machbar (Plugin `getCustomCode` direkt aufrufen) und ist die einzige Art, Tier-Regressionen ohne GPU zu
  fangen.

### Was das Vergleichsprojekt *nicht* hat und wir bauen müssen

Material-**Blending** nach Weltlage (Moos unten, Feuchte in Ecken, Schmutz, Risse) gibt es im Vergleichsprojekt nicht als
Shader-Term; die Varianz kommt aus multiplikativen Tönungen pro Variante (`emit()`,
`marshMaterial`/`drownedMaterial`). Unser Höhen-/Krümmungs-Blending ist ein echter Zusatz — und der
richtige Ort dafür ist derselbe Plugin-Fragmentblock, in dem das Triplanar-Sampling schon läuft, weil dort
Weltposition und Weltnormale bereits vorliegen.

---

## 7. Die Lücken-Lehre — teuer bezahltes Wissen

Das ist der Abschnitt, für den sich die Analyse allein schon lohnt. Das Vergleichsprojekt hat vier verschiedene Lücken-Klassen
erlebt und jede in einem Kommentar dokumentiert.

### 7.1 Das falsche Layout am Renderer

Aus dem Kommentar des Delve-Renderers:

> „*Pass the module's own layout so visible geometry matches the collision set [the sim layer] derives from the
> SAME layout. Falling back to the interior default (CRYPT_LAYOUT) was the source of the drifting walls/floor and
> the out-of-map gaps between modules.*“

Kernaussage: Die Regel „ein Layout für beides“ hilft nichts, wenn der Renderer beim Fehlen eines Arguments auf
ein *Standardlayout* zurückfällt. **Ein Rückfall auf ein anderes Layout ist genau der Fehler, den die Regel
verhindern sollte.** Für uns: Layout ist ein Pflichtargument, kein Optional mit Default. Und wenn kein Layout da
ist, wird nicht gebaut, sondern laut gescheitert.

### 7.2 Das feste Modulraster

Aus dem Kopfkommentar des Wandsegment-Moduls:

> „*the renderer used to place the rectangular shell by stepping a fixed 8u module grid (leaving up to an 8u visual
> gap at end-wall corners whenever endWallHw is not module-aligned, which a rift's arbitrary wallX + 1 almost never
> is), and drew chamber-waist stubs with HARDCODED classic-dungeon coordinates … every rift waist rendered a wall
> panel INSIDE the open passage (a "phantom wall" the player must run through to reach the next chamber) plus an
> invisible collider strip beyond |x| 23 that no wall was drawn for.*“

Zwei Fehlerrichtungen aus einer Ursache:
- **Loch:** sichtbare Ecklücke bis zu einer vollen Modullänge, weil die Wand in ganzen Modulen gerastert wurde.
- **Phantomwand:** Wandpaneel im offenen Durchgang, weil die Renderseite eigene Zahlen statt der Collider-Zahlen
  benutzt hat.

Die Lösung ist die, die wir übernehmen sollten: **Jeden Collider-Lauf in gleich lange Segmente teilen und das
Modul auf die exakte Spannweite skalieren**, statt ganze Module abzuzählen. `splitRun()`:
`segCount = ceil(len / WALL_MODULE_SPAN)`, `halfLength = len/segCount/2`;
Anwendung mit Skalierung `[seg.halfLength/2, MODULE_SCALE, MODULE_SCALE]`. Für
Polygonhüllen macht die Sim-Seite dasselbe (`polygonWallColliders`,
`polygonWallSegments`) — **beide Seiten benutzen dieselbe Segmentteilung mit
derselben Rotationskonvention** `rot = atan2(-dz, dx)` (mit eigenem Kommentar dazu).

Bei unserem Ansatz (Geometrie zur Laufzeit, zellbasiert) fällt dieser Fehler bauartbedingt weg: eine Wand ist
kein Modul mit fester Länge, sondern ein Quader über die exakte Zellkante. Der übertragbare Kern ist die
**Rotations- und Kanten-Konvention**: Render- und Kollisionsseite müssen dieselbe Formel für „diese Zellkante wird
zu diesem OBB / zu diesem Quader“ benutzen — als *eine* geteilte Funktion in `shared/`, nicht als zwei
Implementierungen mit gleichem Ergebnis.

### 7.3 Der Überhang über die Türöffnung

Aus dem Kopfkommentar des Wandbau-Kerns:

> „*Keeping every module inside its segment prevents short pieces beside a doorway from visually covering the
> collision-free opening.*“

Die Umkehrung von 7.2: nicht ein Loch in der Wand, sondern eine **Wand über dem Loch**. Eine Türöffnung ohne
Collider, über die ein Wandstück hängt, ist genau so kaputt wie eine Lücke — der Spieler läuft durch etwas
Sichtbares oder gegen etwas Unsichtbares. Merksatz für unsere Abnahme: **Lücken sind symmetrisch. Es gibt sie in
beide Richtungen, und der Test muss beide Richtungen prüfen.**

### 7.4 Der veraltete Baucache

Aus dem Kopfkommentar des Bau-Caches: Ein Delve-Slot behält seine Weltposition über Läufe hinweg,
aber *welches Modul* dort liegt, wird jeden Lauf neu gewürfelt. Ein nach **Position** gecachter Bau ließ die Wände
des vorigen Laufs stehen, während Mobs und Boss gegen die Geometrie des *aktuellen* Moduls spawnten — „*so they
read as spawned outside the walls and the stale geometry never blocks movement where the player actually is*“.
Die Lösung ist eine Drei-Wege-Entscheidung `skip | build | rebuild` über `(moduleId, ox, oz)`.

**Für uns direkt relevant**, weil unsere Instanzen wiederverwendete Weltslots haben werden: Der Cache-Schlüssel
ist immer der **vollständige Deskriptor** (Seed + Etage + Layout-Version), niemals nur die Position.

### 7.5 Die Bodenmaske stuft ab

Ein Kommentar im Bodenbau: „*Boundary tiles will stair-step; accepted for this kit.*“ Das Vergleichsprojekt akzeptiert an gekrümmten
Wänden eine 4-Einheiten-Treppe zwischen Boden und Wand. Bei Laufzeitgeometrie brauchen wir das nicht zu
akzeptieren — aber wir sollten die Entscheidung bewusst treffen: Zellauflösung so wählen, dass die Stufe
*gewollt* aussieht (Barrow-Stil verträgt rechtwinklige Kanten hervorragend), statt später gegen sie anzubauen.

### 7.6 Die Prüfung, die das alles festnagelt

Der Paritätstest zwischen Wandrendering und Kollision ist der Test, den wir 1:1 in unsere Sprache übersetzen sollten:

> „*Every rendered wall face must sit ON collision, and every wall collider must be visually covered.*“

Mechanik: Segmentmittellinien werden abgetastet (Schrittweite 1, Enden um 0.15 eingezogen, damit ein
Ecksample nicht knapp hinter das Nachbar-Collider-Ende fällt), gegen aufgeblähte OBBs geprüft (Toleranz 1.2 =
Modul-Halbdicke plus Reserve), und das über **Seeds, Ränge und Etagen** hinweg gesweept. Ergänzend
die Tests zu Wand-Massivität und Sweep-Kollision (durchgeschossene Bewegung,
nicht nur Punktprüfung).

Das ist die messbare Fassung von „keine Lücken“ und ersetzt Sichtprüfung nicht, aber es fängt die Regression,
bevor Mike hinsieht.

---

## 8. Höhen: Darstellung und Sim müssen dieselbe Funktion sein

Die Bossbühne ist im Vergleichsprojekt **kein** Collider, sondern eine Höhenfunktion: `DAIS_HEIGHT = 0.6`
wird vom Renderer als Podest gestapelt *und* von der Sim als Bodenerhebung gelesen,
`daisLiftAt(layout, lx, lz)`, das die Bodenhöhenfunktion der Welt addiert. Der Kommentar nennt beide
Konsequenzen: der Boss steht *auf* der Bühne statt knietief darin, und der Spieler geht die Kante hoch wie eine
Bordsteinkante, weil 0.6 unter `MAX_STEP_HEIGHT` liegt. Dasselbe für Rift-Plattformen (`riftPlatformLift`,
`riftLiftAt`) und den Raumgraph (`authoredLiftAt`).

**Für uns:** Jede sichtbare Erhebung braucht eine `hoeheAn(x,z)`-Funktion in `shared/`, die Server und Client
gleichermaßen auswerten — und die Höhen müssen bewusst unter oder über der Stufenhöhe des Bewegungscodes liegen,
das ist eine Design-Entscheidung, kein Zufallswert. Bei Zellen ist das einfacher als im Vergleichsprojekt: die Zelle trägt ihre
Bodenhöhe ohnehin (unser Datenmodell sieht „Boden, Höhen, Wandflags“ vor).

Verwandt: die „standable tops“-Konstanten sind aus den GLBs **ausgemessen**
(gltf-transform, dequantisierte Bounds) und als Zahlen im Sim-Code eingefroren, samt Firstlinie und Traufe eines
Sargdeckels (`topSlope: {kind:'ridge', axis:'z', pitch:…}`). Das ist beeindruckende Sorgfalt — und
zugleich der beste Beleg dafür, dass unser Beschluss richtig ist: **bei Laufzeitgeometrie kennen wir die Maße,
weil wir sie erzeugen.** Diese ganze Konstantenklasse existiert bei uns nicht.

---

## 9. Instanz-Anbindung: hier weichen wir am deutlichsten ab

Das Vergleichsprojekt hat **keine** Instanz-Infrastruktur im eigentlichen Sinn. Alle Instanzen liegen als **Koordinatenbänder in
derselben Weltebene**: `instanceOrigin(dungeonIndex, slot)` liefert
`x = 900 + index*600`, `z = -1250 + slot*500`; Delves ab `x ≥ 4800`, Arena ab 4200, Rifts danach.
Zugehörigkeit ist eine **x-Bereichsabfrage** (`isDelvePos`), und die Slot-Rückrechnung ist eine
Rundung (`instanceSlotForZ`). Die Übergabenotiz dokumentiert das als Merkzettel inklusive der
Randbedingung „west-edge classification guard: `DELVE_BAND_X_MIN = 4773`, 1u Reserve hinter der Wandaußenfläche
bei 4774“.

Das ist eine bewusste Vereinfachung für ein Spiel mit *einer* Weltinstanz. **Für uns nicht übernehmbar**: unsere
Dungeon-Instanzen sind eigene Welten mit eigenen Dokumenten, ZDOs und Persistenz (Beschluss: bleibt, Anbindung per
Adapter). Konsequenzen für den Adapter:

1. **Keine Weltkoordinaten-Bänder.** Layout-lokale Koordinaten bleiben lokal; die Instanzwelt hat ihren eigenen
   Ursprung. Damit entfallen sämtliche Bandgrenzen-Wächter — und die dazugehörige Fehlerklasse.
2. **Über die Leitung geht der Deskriptor, nicht die Geometrie** — das übernehmen wir unverändert.
   Konkret: Instanz-Dokument trägt `{seed, tiefe, layoutVersion}`; Server und Client bauen
   daraus dasselbe.
3. **`layoutVersion` ist Pflicht** und ist unser Zusatz gegenüber dem Vergleichsprojekt. Das Vergleichsprojekt kann seine Generator-Zahlen jederzeit
   ändern, weil Läufe kurzlebig sind; unsere Instanzen sind persistent. Ändert sich der Generator, muss ein
   bestehendes Instanz-Dokument entweder die alte Version weiterbauen oder bewusst verworfen werden. Ohne dieses
   Feld ist jeder Generator-Commit eine stille Datenmigration.
4. **Stabile Objekt-IDs.** Das Vergleichsprojekt leitet Objekte aus der Ziehreihenfolge ab (`planObjects`).
   Für ZDO-Persistenz (geöffnete Truhe, entriegelte Tür) brauchen wir IDs aus der
   *Layout-Position* (Zellindex + Rolle), nicht aus dem Zählerstand — sonst wandert der Zustand einer Truhe auf
   eine andere, sobald sich irgendetwas an der Generierung ändert.
5. **`server.yml`-Flags erreichen laufende Clients nicht** (bekannte WoV-Falle): Der Layout-Deskriptor darf
   deshalb nichts enthalten, was der Client aus Server-Einstellungen ableiten müsste. Alles Geometrierelevante
   kommt aus dem Deskriptor selbst.

---

## 10. Übernahmeliste (verdichtet)

**Direkt übernehmen:**

1. Layout als reine Daten in `shared/`, *eine* Ableitungsfunktion für Kollision, *eine* für Darstellung, beide
   über dieselben Kantenformeln.
2. Deskriptor statt Geometrie über die Leitung; reine Funktionen; mulberry32;
   `mixSeed` pro Aspekt.
3. Der geteilte Positions-Wurf für Slot-Dressing, den Render *und* Kollision lesen —
   **aber ganzzahlig gehasht, nicht per `Math.sin`.**
4. Parity-Test „jede gezeichnete Wandfläche liegt auf Kollision, jeder Wand-Collider ist gedeckt“, gesweept über
   Seeds und Etagen.
5. Dominanzebenen-Kollaps im Triplanar und gemessene Textur-Konstanten als
   Konvergenzziel der Distanzblende.
6. Grafikstufen als eine monotone Leiter mit `tierAtLeast`, tier-abhängige Werte als Compile-Konstanten, plus
   Dev-Killschalter pro Layer.
7. Ressourcen-Besitz pro Instanzwurzel mit „geteilt“-Markierung.
8. Architektur-Dauertest gegen Schichtverletzungen.
9. Höhen als geteilte Funktion, nicht als Renderer-Podest.
10. Cache-Schlüssel = vollständiger Deskriptor, nie Position.

**Bewusst anders machen:**

| Thema | Vergleichsprojekt | Wir |
|---|---|---|
| Architektur-Geometrie | GLB-Module, instanziert | zur Laufzeit aus Zellen erzeugt → Lücken- und Maßklasse entfällt |
| Raumform | Halbbreiten-Profil → Polygon, sternförmig validiert | Zellmaske, Zusammenhang + Erreichbarkeit validiert |
| Rng-Ströme | ein Strom pro Etage (dokumentierte Fragilität) | ein Strom **pro Aspekt** |
| Hash für geteilte Würfe | `Math.sin`-basiert | ganzzahlig (`Math.imul`), engine-unabhängig |
| Shader-Injektion | `onBeforeCompile` + Chunk-`replace` + Hand-Cachekey | `MaterialPluginBase`, Defines statt Uniforms für Tier-Werte, `vPositionW`/`vNormalW` geschenkt |
| Instanzen | Koordinatenbänder in einer Welt | eigene Instanzwelten, Adapter, `layoutVersion` im Dokument |
| Material-Varianz | multiplikative Tönung pro Variante | zusätzlich Weltlage-Blending (Moos/Feuchte/Schmutz) im selben Plugin-Block |
| Objekt-Identität | Ziehreihenfolge | Layout-Position (Zellindex + Rolle), wegen ZDO-Persistenz |

**Offene Punkte für die Babylon-Recherche:**

- Exakte `CUSTOM_*`-Injektionsmarken des Babylon-8-PBR-Fragmentshaders und ihre Reihenfolge relativ zu
  Albedo / Normale / Reflectivity.
- Ob `Material.clone()` Plugins überträgt (sonst brauchen wir die Wiederanheft-Spezifikation des Vergleichsprojekts).
- Thin Instances vs. zusammengebackene Raumgeometrie: ab welcher Wiederholungszahl lohnt was — das ist eine
  **Messung**, keine Annahme.
- Ob Babylons `NodeMaterial`-Weg für das Blending günstiger ist als GLSL im Plugin (Wartbarkeit gegen Kontrolle).

---

## 11. Zwei Sätze, die man sich merken sollte

Aus dem Kommentar über den geteilten Slot-Wurf:

> „*the ONE draw both the renderer … and the collider builder … consume, so mesh and physics can never disagree.*“

Und aus dem Kommentar des Delve-Renderers, warum das trotzdem schiefging:

> „*Falling back to the interior default … was the source of the drifting walls/floor and the out-of-map gaps.*“

Die Regel ist billig. Sie hält nur, wenn es **keinen** Standardwert gibt, auf den man zurückfallen kann.
