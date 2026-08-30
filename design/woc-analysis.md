# WoC-Analyse: Wie World of ClaudeCraft Dungeons baut

**Quelle:** `https://github.com/levy-street/world-of-claudecraft`, flacher Klon vom 30.08.2026, Stand `57025e0`.
Klon liegt unter `/tmp/claude-1000/-home-mike-Nextcloud-Brain/9c8d23de-d8ff-4aeb-aa74-c375c734aefa/scratchpad/woc`.
Alle Datei:Zeile-Angaben beziehen sich auf diesen Stand. Bezug: [[Dungeon Generator 2.0]].

**Wichtigste Korrektur vorweg:** WoC baut die *Architektur nicht zur Laufzeit aus Dreiecken*. Es setzt fertige
GLB-Module (KayKit Dungeon Remastered) instanziert auf Positionen, die aus reinen Zahlen-Layouts berechnet werden
(`src/render/dungeon.ts:1-6`). Übertragbar ist also **nicht** der Geometriebau, sondern die **Datendisziplin**:
ein Layout, aus dem Darstellung *und* Kollision abgeleitet werden, deterministisch aus einem Deskriptor erzeugt,
und ein triplanares Oberflächen-Layer über allem. Unser Beschluss (Geometrie aus Zellen zur Laufzeit) ist die
konsequentere Fassung derselben Idee — und löst mehrere Klassen von WoC-Schmerzen, die unten benannt sind, bauartbedingt.

---

## 1. Schichtung und Systemgrenze

WoC hat **eine** Simulation, die in drei Wirten läuft (Browser, Node-Server, headless). Erzwungen wird das nicht
durch Konvention, sondern durch einen Dauertest: `tests/architecture.test.ts:1-38` scannt `src/sim/` und lässt
keinen Import von `three`, `render/`, `ui/`, `net/`, keinen DOM-Zugriff und keine Zufalls- oder Zeitquelle außerhalb
des gesetzten Rng zu. Der Server importiert exakt dieselben Module (`server/admin_db.ts:1` importiert `../src/sim/...`).

Die Layout-Daten liegen deshalb in der Sim-Schicht:

- `src/sim/dungeon_layout.ts:1-6` — „*the single source of truth for BOTH the visual module placement … and the
  interior collision sets … This kills the old hand-mirroring between renderer geometry and collider literals.*“
- `src/sim/delve_layout.ts:1-3` — dasselbe für die Delve-Module, ausdrücklich „*Sim layer: no three.js imports*“.
- `src/render/dungeon_wall_segments.ts:23-25` — die Render-Seite hat ein *Geschwistermodul*, das ebenfalls kein
  three.js importiert, damit ein Vitest Render-Platzierung und Kollision direkt gegeneinander sweepen kann.

**Für uns:** Der Geometrie-Bauer und das Layout gehören nach `shared/`, und wir brauchen die gleiche Dauerprüfung —
ein Test, der `shared/` gegen jeden `@babylonjs/*`-Import und jeden DOM-Zugriff verriegelt. Das ist billig und
verhindert genau den Rückfall, der uns zwingen würde, Geometrie über die Leitung zu schicken.

---

## 2. Datenmodell: ein Layout, viele Konsumenten

`DungeonLayout` (`src/sim/dungeon_layout.ts:108-162`) ist eine reine Zahlenstruktur:

| Feld | Bedeutung |
|---|---|
| `zMin`/`zMax`, `sideWallZ`/`sideWallHd`, `wallX`, `endWallHw`, `floorHalfX` | rechteckige Hülle |
| `pillars`, `tombs`, `stubs`, `clutter` | Hindernisse als Punkt-/Kastenlisten |
| `dais` + `daisRaised` | Bossbühne, begehbar, **absichtlich ohne Collider** (`:127`) |
| `illusionWalls` | gerendert, aber bewusst **nicht** in `layoutColliders` (`:143-146`) |
| `shellPolygon` + `shellPole` | nicht-rechteckiger Raum; ersetzt die Hülle für Render *und* Kollision (`:147-152`) |
| `rooms`/`doors`/`decor`/`ledges` | handgebauter Raumgraph, ersetzt die Hülle vollständig (`:153-161`) |

Daraus zieht **eine** Funktion die Kollision: `layoutColliders()` (`src/sim/dungeon_layout.ts:1003-1118`). Sie
verzweigt in derselben Reihenfolge, in der der Renderer verzweigt: Raumgraph → Polygon-Hülle → Rechteck-Hülle,
dann Stubs, Pfeiler, Wandnischen, Bodenkram.

Die Stil-Daten sind vom Layout getrennt: `InteriorStyle` (`:177-190`) trägt Fackelfarben, Nebel und
multiplikative Wand-/Bodentönungen. Der Kommentar dort ist genau unser „Theme per Tint + Material-Seed“-Beschluss:
dasselbe Kit wird pro Lauf neu eingefärbt, statt neue Assets zu bauen (`:164-176`).

**Für uns:** Das Feldschema ist nicht direkt übernehmbar (WoC ist parametrisch-rechteckig, wir sind zellbasiert),
aber die *Trennung* ist es: `Layout` (Struktur) ⟂ `Style` (Farbe/Material) ⟂ `Plan` (Spawns/Objekte). Und die
Regel „was gerendert wird, aber nicht kollidiert, steht als eigenes Feld im Layout“ (`illusionWalls`) statt als
Sonderfall im Renderer.

---

## 3. Determinismus-Mechanik

Der Kern steht in `src/sim/rift/rift_gen.ts:1-10`:

> „*pure, deterministic functions that turn a compact descriptor (seed + baseLevel + floorIndex) into a fully-resolved
> floor … The authoritative server and every client call these identical functions, so no rift geometry is ever
> transmitted, only the descriptor.*“

Bausteine:

1. **Rng = mulberry32**, ganzzahlig, `Math.imul`-basiert (`src/sim/rng.ts:16-52`). Kein `Math.random`, keine Uhr.
2. **Seed-Mischung statt geteiltem Strom für getrennte Belange:** `mixSeed(seed, salt)`
   (`src/sim/rift/style.ts:14-21`), verwendet u. a. für Etagenzahl (`rift_gen.ts:103`), Thema (`:107`),
   Set-Piece-Wurf (`:86`) und den Etagenstrom selbst (`:836`). Jeder Aspekt zieht aus seinem eigenen Strom,
   deshalb verschiebt eine Änderung an einem Aspekt die anderen nicht.
3. **Innerhalb einer Etage aber genau ein Strom** — und das ist die dokumentierte Falle:
   `rift_gen.ts:280-284` warnt, dass die Paketzahl bewusst am *ursprünglichen* Bandanfang hängt, weil
   „*Changing the draw COUNT here would shift every downstream object, hazard and roller on every procedural floor
   as a side effect.*“ Ein einziger zusätzlicher `rng.chance()` in `buildLayout` würde jede Etage jedes Seeds
   umwürfeln. Genauso schaltet der Set-Piece-Pfad **vor** dem ersten Zug ab (`:818-820`), damit die Ziehreihenfolge
   der anderen Läufe unberührt bleibt.
4. **Memoisierung ist Politik, nicht Semantik:** LRU-Cache über den Deskriptorschlüssel
   (`rift_gen.ts:763-769`, `:808-816`) mit dem ausdrücklichen Vermerk „*generation is deterministic per key, so
   results are identical either way*“.
5. **Stabile Positions-Hashes ohne Rng** für alles, was pro Slot gleich sein muss:
   `tombSlotRoll(x,z)` (`src/sim/dungeon_layout.ts:25-28`) ist *der eine* Wurf, den Renderer und Collider beide
   lesen — „*so mesh and physics can never disagree*“ (`:19-24`).

### Abweichung, die uns betrifft (wichtig)

`tombSlotRoll` und der Render-Hash `hash2` (`src/render/dungeon.ts:452-455`) sind **`Math.sin`-basiert**:
`Math.sin(a*127.1 + b*311.7) * 43758.5453`. `Math.sin` ist in ECMAScript **nicht bitgenau spezifiziert**. In WoC
fällt das nicht auf, weil Server und Client faktisch V8 sind. Bei uns läuft der Collider-Bau auf dem Node-Server
und die Darstellung in beliebigen Browser-Engines — ein Firefox-Client kann dann eine andere Sargform stehen
haben als der Server berechnet. **Regel für uns: jeder Hash, den Server *und* Client auswerten, ist ganzzahlig**
(`Math.imul`-Kette wie `src/sim/rng.ts:55-63`), niemals trigonometrisch. Das ist eine harte Übernahme *mit*
Korrektur, kein Kopieren.

---

## 4. Layout-Generierung (der eigentliche Generator)

`buildLayout()` (`src/sim/rift/rift_gen.ts:228-376`) arbeitet so:

1. Länge würfeln (`:235`), Archetyp würfeln aus 8 Silhouetten (`:173-183`), Boss-Etagen nur aus den hinten
   breiten (`:185`).
2. Der Archetyp ist eine **Halbbreiten-Profilfunktion** `t ∈ [0,1] → halfWidth` (`makeProfile`, `:192-227`):
   `rotunda` = Sinus, `taper` = linear, `apse` = Smoothstep ab der Hälfte, `hourglass` = invertierter Sinus,
   `chambers` = `cos(4πt)`, `cavern` = drei Harmonische mit gewürfelten Phasen, `corridor` = konstant schmal.
3. Aus dem Profil wird alle 6 Einheiten ein Polygon abgetastet (`:261-266`) und **validiert**: einfach (keine
   Selbstschnitte) und sternförmig vom Mittelpol (`:268`). Fällt die Prüfung durch → Rückfall auf das Rechteck
   (`:273`). Sternförmigkeit ist die Bedingung, unter der Wandverfolgung, Bodenmaske und Pfadlogik alle
   funktionieren.
4. Hindernisse werden **entlang der lokalen Breite** gesetzt, nicht auf ein globales Raster: Pfeilerreihen mit
   `inset = min(base, halfWidthAt(z) - 3)` (`:289`), Wandnischen bei `halfWidthAt(z) - 4` (`:300`), Prallwände
   („baffles“) als kurze Finnen von der Wand her (`:330-346`).
5. **Eine Invariante trägt alles:** der Mittelgang `|x| ≤ AISLE_HALF = 5.5` bleibt per Konstruktion frei
   (`:56`, respektiert in `:289`, `:300`, `:334-336`). Deshalb terminiert `toClear()` (`:145-157`) garantiert: es
   schiebt einen blockierten Punkt in festen Schritten Richtung Mitte, und die Mitte ist definitionsgemäß frei.
6. `generateRiftFloor()` (`:802-895`) setzt darüber die Reihenfolge Layout → Style → Puzzle → Eis → Spawns →
   Objekte → Hazards → Roller → Plattform → Gate, mit einer expliziten „genau ein Leitmechanik pro Etage“-Regel
   (`:855-866`).

**Für uns übertragbar:**

- Der **Archetyp-als-Funktion**-Trick ist auch zellbasiert gültig: das Profil erzeugt dann nicht ein Polygon,
  sondern eine Zellmaske (`zelleAktiv(cx,cz)`). Wir gewinnen dabei sogar: die in WoC dokumentierte
  Treppenstufen-Kante der Bodenmaske (siehe §7) entfällt, weil die Zelle *die* Auflösung ist.
- Die **Validierungsstufe mit Rückfall** ist Pflicht: sternförmig/einfach ersetzen wir durch
  Zusammenhang + Erreichbarkeit (Flood-Fill vom Eingang zum Boss), und bei Durchfall wird deterministisch auf
  eine einfache Form zurückgefallen — nicht neu gewürfelt (neu würfeln kostet Determinismus-Klarheit).
- Die **freie Achse** (WoC: Mittelgang) sollten wir als „garantierter Pfad“ übernehmen: eine
  Zellen-Rückgratkette, die kein Stempel überschreiben darf. Ohne so eine Invariante wird jede
  Erreichbarkeitsprüfung zu einer Schleife, die auch scheitern kann.
- **Getrennte Rng-Ströme pro Aspekt**, nicht nur pro Etage — hier gehen wir bewusst weiter als WoC.
  `mixSeed(seed, SALT_LAYOUT)`, `SALT_DRESSING`, `SALT_SPAWNS`. Dann kostet das Nachjustieren der Deko keine
  Neuwürfelung der Räume, und `rift_gen.ts:280-284` beschreibt einen Schmerz, den wir nie haben.

---

## 5. Laufzeit-„Geometriebau“ und Instancing

`DungeonInteriors` (`src/render/dungeon.ts:681ff`) ist der Bauer. Ablauf:

1. **Assetaufbereitung einmalig:** `extractModule()` (`:378-404`) traversiert das GLB, wirft alle Attribute außer
   `position`/`normal`/`uv` weg, backt Meshopt-quantisierte Attribute nach Float um (`attributeToFloat`, `:366-376`,
   sonst klemmt `applyMatrix4` Weltwerte in `[-1,1]`), bäckt die Weltmatrix ein und **merged** alle Submeshes zu
   einer Geometrie. Ergebnis: ein `{geo, pack}` pro Modulname.
2. **Platzierung sammeln, nicht zeichnen:** `class Placements` (`:470-496`) akkumuliert `Matrix4` pro Modulart.
3. **Ausgabe:** `emit()` (`:1532-1568`) macht aus jeder Art *eine* `InstancedMesh`, wählt dabei je nach Variante
   das getönte oder das geteilte Material, setzt `castShadow` nur für Kaster-Arten und `receiveShadow` nur für
   Empfänger-Arten. Zielgröße laut Kopfkommentar: **~30 Draws pro Innenraum** (`:5-6`).
4. **Boden** `placeFloor()` (`:1847-1888`): Rasterlauf in 4er-Zellen (`FLOOR_CELL = 4`, `:90`) über
   `[-floorHalfX, floorHalfX] × [zMin-2, zMax+2]`, Kachelart aus dem Positionshash, Maskierung gegen
   `shellPolygon` per `polygonContainsPoint`. `FLOOR_Y = -0.05` (`:91`), damit die Kachel*oberkante* auf y=0
   landet — die Sim rechnet mit y=0.
5. **Wände** `placeWalls()` (`:2169-2237`) und `placePolygonWalls()` (`:2250-2266`): siehe §7, das ist der interessante
   Teil.

**Babylon-Abweichungen (unsere Seite):**

| WoC / three.js | World of Vikings / Babylon 8 |
|---|---|
| `mergeGeometries` über GLB-Submeshes | entfällt — wir bauen `VertexData` direkt; stattdessen lohnt das *Zusammenfassen ganzer Räume* zu wenigen Meshes (`VertexData.merge` bzw. eigene Puffer) |
| `THREE.InstancedMesh` pro Modulart | **Thin Instances** (`thinInstanceSetBuffer('matrix', …)`) für Deko-Wiederholer; für unsere Wände/Böden meist *gar keine* Instanzen, weil zusammengebackene Geometrie billiger ist als tausende gleicher Quader |
| `mesh.computeBoundingSphere()` nach Instanzsetzen | Thin Instances brauchen `thinInstanceRefreshBoundingInfo()`, sonst culled Babylon falsch |
| `castShadow`/`receiveShadow` pro Mesh | `shadowGenerator.addShadowCaster(mesh)` + `mesh.receiveShadows`; Auswahl aber nach derselben Kaster-/Empfänger-Liste |
| implizite Matrixaktualisierung | `mesh.freezeWorldMatrix()`, `material.freeze()`, `scene.blockMaterialDirtyMechanism` beim Bau; sonst zahlen wir den Aufbau jedes Bild neu |
| ein Material pro Pack, geklonte Tönungen | in Babylon Tönung über *Instanz-Farbe* oder Material-Instanzen; Achtung: jede Materialvariante = eigener Shader-Compile |

WoC hat außerdem eine **Ressourcen-Buchhaltung**, die wir 1:1 brauchen und in Babylon sogar dringender:
`interior_resource_lifecycle.ts:14-22` führt pro Innenraum-Wurzel eine Registry, die nur Ressourcen *ohne*
„geteilt“-Markierung aufnimmt (`markSharedGeometry`/`markSharedMaterial`/`markSharedTexture`, benutzt in
`dungeon.ts:403`, `:396`). Beim Abbau einer Instanz wird nur Eigenes freigegeben. In Babylon ist
`mesh.dispose(doNotRecurse, disposeMaterialAndTextures)` genau die Falle: ein unbedachtes `true` schießt das
geteilte Dungeon-Material für alle laufenden Instanzen ab.

---

## 6. Materialsystem: das triplanare Detail-Layer (`worn_stone.ts`)

Das ist der technisch dichteste und für uns wertvollste Teil. `src/render/worn_stone.ts:1-33` beschreibt das
Ziel exakt so, wie wir es beschlossen haben: Die GLB-UVs zeigen auf Palettenfelder, taugen also nicht für Detail;
also wird **pro Materialfamilie** ein CC0-PBR-Satz **world-space triplanar** darübergelegt und mit dem komponiert,
was das Material ohnehin tut. Und die Schlussregel: „*The layer must stay SUBTLE: the game's look is cozy
low-poly, the detail suggests material, never photoreal.*“ (`:31-33`) — das ist unser Barrow-Leitbild.

### Aufbau

- **Sieben Familien** (`:120ff`): `stone` (Bricks076A, gemauert), `rock` (Rock026, natürlicher Bruch), `wood`,
  `plaster`, `bark`, `fabric`, `metal`. Der Kommentar `:29-32` erklärt die für uns wichtigste Trennung:
  Mauerwerk trägt Läuferverband-Fugen, die auf einem Findling absurd aussehen — **geologisches Gestein bekommt
  eine eigene Familie**. Für ein Steingrab heißt das mindestens: behauene Quader vs. Fels/Erde vs. Moos-Untergrund.
- **Pro Familie gemessene Konstanten** (`:76-105`): `dispCenter`/`dispSd` (Mittel und Standardabweichung der
  Displacement-Map), `aoMean`, `roughMean`, `metalMean` — per `ffmpeg signalstats` über das ausgelieferte
  1K-Asset ermittelt. Sie tragen zwei Dinge: (a) die Parallaxen-Amplitude wird als `parallaxDepth / dispSd`
  **normalisiert**, weil die Maps 10-fach unterschiedliche Dynamik haben (`:80-84`); (b) die Distanzblende
  konvergiert gegen genau die Mittelwerte, gegen die auch die Mipkette konvergiert, sodass ein Ausblenden der
  Taps die Helligkeit einer fernen Wand *nicht* verschiebt (`:94-99`).
- **Kanäle:** Normale (Whiteout-Blend nach Golus, `:899-952`), AO multipliziert die Diffuse in ein Familienband
  (`:865-871`), Roughness lerpt Richtung Map (`:873-882`), Metalness nur für Metall (`:883-896`), und ab Ultra
  eine 3–4-Tap-Parallaxe entlang des Blickstrahls (`:830-859`) plus Höhenschattierung der Diffuse (`:862`).

### Die drei Ideen, die wir übernehmen müssen

1. **Dominanzebenen-Kollaps** (`:801-810`): Gewichte `w = normalize(pow(|n|, 4))`, dann
   `w = normalize(max(w - 0.15, 0))`. Dadurch wird jede Fläche innerhalb von ~33° zu einer Achse **exakt**
   one-hot, stetig und ohne Schwellensprung — und die Sampler-Funktion nimmt den Ein-Tap-Schnellpfad
   (`wornTriR`, `:767-791`). **Für ein Barrow aus ruhigen Quadern heißt das: Triplanar kostet uns fast überall
   einen Tap statt drei.** Das ist das entscheidende Performance-Argument für unsere Stufe „Mittel“.
2. **Distanz-Blenden als Compile-Konstanten** (`:299-345`, `scaledFadeBands` `:370-377`): Die Parallaxe endet
   dort, wo eine Standardabweichung Höhe unter 2 Bildschirmpixel projiziert; das Detail-Layer endet dort, wo die
   Mipstufe 5 erreicht ist. Beides wird aus dem *effektiven* Kachelmaß berechnet und als Literal in den Shader
   gebacken, mit `if (wornCamD < …)` als Sprungwächter — ferne Flächen kosten null Taps.
3. **Nachträgliche Anwendbarkeit auf fremde Materialien**: `applySurfaceDetail(mat, family, opts)` (`:635-955`)
   hängt sich an ein bestehendes Material an, ruft einen eventuell vorhandenen Vorgänger-Hook zuerst
   (`:691`) und ist idempotent (`:648-649`).

### Babylon-Abweichungen (hier weichen wir am stärksten ab)

- **Injektionsmechanik.** three.js: `onBeforeCompile` + String-`replace` auf `#include <color_fragment>`,
  `<roughnessmap_fragment>`, `<metalnessmap_fragment>`, `<normal_fragment_maps>` (`:753-953`). Babylon 8 kennt
  diese Chunks nicht. Wir nehmen `MaterialPluginBase` mit `getCustomCode(shaderType)` und den
  `CUSTOM_*`-Markern des PBR-Shaders. **Die genauen Marker-Namen und ihre Reihenfolge relativ zu
  Albedo/Normale/Reflectivity müssen gegen die Babylon-8-Quelle verifiziert werden** — das gehört in die
  Babylon-Recherche, nicht in die Annahme. Muster existiert bereits im Client (PbrNebelFix, NebelRichtung,
  StandardGammaFix).
- **Varyings geschenkt.** WoC muss `vWornWorldPos`/`vWornWorldNormal` selbst deklarieren und im Vertex-Shader
  die Instanzmatrix von Hand anwenden (`:728-752`). Babylons PBR liefert `vPositionW` und `vNormalW` bereits
  weltraumtransformiert, inklusive Instanzen. **Ein ganzer Fehlerkanal fällt bei uns weg.**
- **Programm-Cache-Schlüssel.** WoC muss `customProgramCacheKey` von Hand bauen (`:956-980`) und dabei
  Familie, Texturbereitschaft, Tap-Zahl, Projektionsmodus, Blendbänder und den Schlüssel des Vorgänger-Hooks
  hineinkodieren — weil three.js sonst zwei verschiedene Materialien in dasselbe Programm zusammenfallen lässt.
  Babylon macht das über `getClassName()` + `prepareDefines()`/`getUniforms()` des Plugins selbst; wir dürfen den
  three.js-Trick **nicht** nachbauen, aber wir müssen jeden tier-abhängigen Wert als **Define** führen (nicht als
  Uniform), sonst rekompiliert Babylon beim Stufenwechsel nicht.
- **Klon-Falle.** In three.js verliert `Material.clone()` den `onBeforeCompile`-Hook; WoC rettet sich mit einem
  JSON-fähigen `userData.surfaceDetailSpec`, aus dem `material_clone_hooks.ts` das Layer neu anhängt
  (`:652-661`). Ob Babylons `Material.clone()` Plugins mitnimmt, ist **zu prüfen** — wenn nicht, brauchen wir
  dieselbe Wiederanheft-Spezifikation.
- **Grafikstufen.** WoC hat ein einziges `GFX`-Objekt mit monotoner Leiter und `gfxTierAtLeast(tier, floor)`
  (`src/render/gfx.ts:36-51`), Knöpfe wie `surfaceDetail`, `surfaceDetailTaps`, `surfaceDetailClampK`
  (`:175-179`), plus URL-Override `?gfx=…` und einen Dev-Killschalter pro Layer (`?worndetail=off`,
  `worn_stone.ts:645-647`). Das ist genau unsere „Grafikstufen, je Effekt schaltbar“-Anforderung und sollte in
  Struktur übernommen werden — inklusive des Killschalters, weil er A/B-Messung ohne Codeänderung erlaubt.
- **Getestet wird der Shader als Text:** `tests/worn_stone_shader.test.ts` kompiliert das Layer mit gemocktem
  Loader unter verschiedenen `?gfx=`-Presets und prüft den erzeugten Fragment-Quelltext. Das ist in Babylon
  genauso machbar (Plugin `getCustomCode` direkt aufrufen) und ist die einzige Art, Tier-Regressionen ohne GPU zu
  fangen.

### Was WoC *nicht* hat und wir bauen müssen

Material-**Blending** nach Weltlage (Moos unten, Feuchte in Ecken, Schmutz, Risse) gibt es in WoC nicht als
Shader-Term; die Varianz kommt aus multiplikativen Tönungen pro Variante (`emit()`, `dungeon.ts:1546-1560`,
`marshMaterial`/`drownedMaterial` `:1501-1511`). Unser Höhen-/Krümmungs-Blending ist ein echter Zusatz — und der
richtige Ort dafür ist derselbe Plugin-Fragmentblock, in dem das Triplanar-Sampling schon läuft, weil dort
Weltposition und Weltnormale bereits vorliegen.

---

## 7. Die Lücken-Lehre — teuer bezahltes Wissen

Das ist der Abschnitt, für den sich die Analyse allein schon lohnt. WoC hat vier verschiedene Lücken-Klassen
erlebt und jede in einem Kommentar dokumentiert.

### 7.1 Das falsche Layout am Renderer

`src/render/delve_interiors.ts:33-40`:

> „*Pass the module's own layout so visible geometry matches the collision set sim/colliders.ts derives from the
> SAME layout. Falling back to the interior default (CRYPT_LAYOUT) was the source of the drifting walls/floor and
> the out-of-map gaps between modules.*“

Kernaussage: Die Regel „ein Layout für beides“ hilft nichts, wenn der Renderer beim Fehlen eines Arguments auf
ein *Standardlayout* zurückfällt. **Ein Rückfall auf ein anderes Layout ist genau der Fehler, den die Regel
verhindern sollte.** Für uns: Layout ist ein Pflichtargument, kein Optional mit Default. Und wenn kein Layout da
ist, wird nicht gebaut, sondern laut gescheitert.

### 7.2 Das feste Modulraster

`src/render/dungeon_wall_segments.ts:7-21`:

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
Modul auf die exakte Spannweite skalieren**, statt ganze Module abzuzählen. `splitRun()`
(`dungeon_wall_segments.ts:43-60`): `segCount = ceil(len / WALL_MODULE_SPAN)`, `halfLength = len/segCount/2`;
Anwendung in `dungeon.ts:2180-2196` mit Skalierung `[seg.halfLength/2, MODULE_SCALE, MODULE_SCALE]`. Für
Polygonhüllen macht die Sim-Seite dasselbe (`polygonWallColliders`, `dungeon_layout.ts:893-919`,
`polygonWallSegments`, `delve_litany_layout.ts:193-217`) — **beide Seiten benutzen dieselbe Segmentteilung mit
derselben Rotationskonvention** `rot = atan2(-dz, dx)` (Kommentar dazu `dungeon.ts:2238-2249`).

Bei unserem Ansatz (Geometrie zur Laufzeit, zellbasiert) fällt dieser Fehler bauartbedingt weg: eine Wand ist
kein Modul mit fester Länge, sondern ein Quader über die exakte Zellkante. Der übertragbare Kern ist die
**Rotations- und Kanten-Konvention**: Render- und Kollisionsseite müssen dieselbe Formel für „diese Zellkante wird
zu diesem OBB / zu diesem Quader“ benutzen — als *eine* geteilte Funktion in `shared/`, nicht als zwei
Implementierungen mit gleichem Ergebnis.

### 7.3 Der Überhang über die Türöffnung

`src/render/authored_walls_core.ts:1-3`:

> „*Keeping every module inside its segment prevents short pieces beside a doorway from visually covering the
> collision-free opening.*“

Die Umkehrung von 7.2: nicht ein Loch in der Wand, sondern eine **Wand über dem Loch**. Eine Türöffnung ohne
Collider, über die ein Wandstück hängt, ist genau so kaputt wie eine Lücke — der Spieler läuft durch etwas
Sichtbares oder gegen etwas Unsichtbares. Merksatz für unsere Abnahme: **Lücken sind symmetrisch. Es gibt sie in
beide Richtungen, und der Test muss beide Richtungen prüfen.**

### 7.4 Der veraltete Baucache

`src/render/delve_interior_cache_core.ts:1-12`: Ein Delve-Slot behält seine Weltposition über Läufe hinweg,
aber *welches Modul* dort liegt, wird jeden Lauf neu gewürfelt. Ein nach **Position** gecachter Bau ließ die Wände
des vorigen Laufs stehen, während Mobs und Boss gegen die Geometrie des *aktuellen* Moduls spawnten — „*so they
read as spawned outside the walls and the stale geometry never blocks movement where the player actually is*“.
Die Lösung ist eine Drei-Wege-Entscheidung `skip | build | rebuild` über `(moduleId, ox, oz)` (`:22-28`).

**Für uns direkt relevant**, weil unsere Instanzen wiederverwendete Weltslots haben werden: Der Cache-Schlüssel
ist immer der **vollständige Deskriptor** (Seed + Etage + Layout-Version), niemals nur die Position.

### 7.5 Die Bodenmaske stuft ab

`dungeon.ts:1856-1858`: „*Boundary tiles will stair-step; accepted for this kit.*“ WoC akzeptiert an gekrümmten
Wänden eine 4-Einheiten-Treppe zwischen Boden und Wand. Bei Laufzeitgeometrie brauchen wir das nicht zu
akzeptieren — aber wir sollten die Entscheidung bewusst treffen: Zellauflösung so wählen, dass die Stufe
*gewollt* aussieht (Barrow-Stil verträgt rechtwinklige Kanten hervorragend), statt später gegen sie anzubauen.

### 7.6 Die Prüfung, die das alles festnagelt

`tests/rift_wall_render_parity.test.ts:13-27` ist der Test, den wir 1:1 in unsere Sprache übersetzen sollten:

> „*Every rendered wall face must sit ON collision, and every wall collider must be visually covered.*“

Mechanik: Segmentmittellinien werden abgetastet (`:43-55`, Schrittweite 1, Enden um 0.15 eingezogen, damit ein
Ecksample nicht knapp hinter das Nachbar-Collider-Ende fällt), gegen aufgeblähte OBBs geprüft (Toleranz 1.2 =
Modul-Halbdicke plus Reserve, `:24-27`), und das über **Seeds, Ränge und Etagen** hinweg gesweept. Ergänzend
`tests/rift_wall_solidity.test.ts` und `tests/rift_wall_swept_collision.test.ts` (durchgeschossene Bewegung,
nicht nur Punktprüfung).

Das ist die messbare Fassung von „keine Lücken“ und ersetzt Sichtprüfung nicht, aber es fängt die Regression,
bevor Mike hinsieht.

---

## 8. Höhen: Darstellung und Sim müssen dieselbe Funktion sein

Die Bossbühne ist in WoC **kein** Collider, sondern eine Höhenfunktion: `DAIS_HEIGHT = 0.6`
(`dungeon_layout.ts:42-49`) wird vom Renderer als Podest gestapelt *und* von der Sim als Bodenerhebung gelesen,
`daisLiftAt(layout, lx, lz)` (`:986-992`), das `world.ts groundHeight` addiert. Der Kommentar nennt beide
Konsequenzen: der Boss steht *auf* der Bühne statt knietief darin, und der Spieler geht die Kante hoch wie eine
Bordsteinkante, weil 0.6 unter `MAX_STEP_HEIGHT` liegt. Dasselbe für Rift-Plattformen (`riftPlatformLift`,
`riftLiftAt`, `rift_gen.ts:711-758`) und den Raumgraph (`authoredLiftAt`).

**Für uns:** Jede sichtbare Erhebung braucht eine `hoeheAn(x,z)`-Funktion in `shared/`, die Server und Client
gleichermaßen auswerten — und die Höhen müssen bewusst unter oder über der Stufenhöhe des Bewegungscodes liegen,
das ist eine Design-Entscheidung, kein Zufallswert. Bei Zellen ist das einfacher als bei WoC: die Zelle trägt ihre
Bodenhöhe ohnehin (unser Datenmodell sieht „Boden, Höhen, Wandflags“ vor).

Verwandt: die „standable tops“-Konstanten (`dungeon_layout.ts:51-85`) sind aus den GLBs **ausgemessen**
(gltf-transform, dequantisierte Bounds) und als Zahlen im Sim-Code eingefroren, samt Firstlinie und Traufe eines
Sargdeckels (`topSlope: {kind:'ridge', axis:'z', pitch:…}`, `:1068-1073`). Das ist beeindruckende Sorgfalt — und
zugleich der beste Beleg dafür, dass unser Beschluss richtig ist: **bei Laufzeitgeometrie kennen wir die Maße,
weil wir sie erzeugen.** Diese ganze Konstantenklasse existiert bei uns nicht.

---

## 9. Instanz-Anbindung: hier weichen wir am deutlichsten ab

WoC hat **keine** Instanz-Infrastruktur im eigentlichen Sinn. Alle Instanzen liegen als **Koordinatenbänder in
derselben Weltebene**: `instanceOrigin(dungeonIndex, slot)` (`src/sim/data.ts:1007-1016`) liefert
`x = 900 + index*600`, `z = -1250 + slot*500`; Delves ab `x ≥ 4800` (`:1150-1152`), Arena ab 4200, Rifts danach.
Zugehörigkeit ist eine **x-Bereichsabfrage** (`isDelvePos`, `:1157-1159`), und die Slot-Rückrechnung ist eine
Rundung (`instanceSlotForZ`, `:1024-1026`). Der Handoff dokumentiert das als Merkzettel inklusive der
Randbedingung „west-edge classification guard: `DELVE_BAND_X_MIN = 4773`, 1u Reserve hinter der Wandaußenfläche
bei 4774“ (`docs/prd/DELVE_HANDOFF.md:225-233`).

Das ist eine bewusste Vereinfachung für ein Spiel mit *einer* Weltinstanz. **Für uns nicht übernehmbar**: unsere
Dungeon-Instanzen sind eigene Welten mit eigenen Dokumenten, ZDOs und Persistenz (Beschluss: bleibt, Anbindung per
Adapter). Konsequenzen für den Adapter:

1. **Keine Weltkoordinaten-Bänder.** Layout-lokale Koordinaten bleiben lokal; die Instanzwelt hat ihren eigenen
   Ursprung. Damit entfallen sämtliche Bandgrenzen-Wächter — und die dazugehörige Fehlerklasse.
2. **Über die Leitung geht der Deskriptor, nicht die Geometrie** — das übernehmen wir unverändert
   (`rift_gen.ts:4-6`). Konkret: Instanz-Dokument trägt `{seed, tiefe, layoutVersion}`; Server und Client bauen
   daraus dasselbe.
3. **`layoutVersion` ist Pflicht** und ist unser Zusatz gegenüber WoC. WoC kann seine Generator-Zahlen jederzeit
   ändern, weil Läufe kurzlebig sind; unsere Instanzen sind persistent. Ändert sich der Generator, muss ein
   bestehendes Instanz-Dokument entweder die alte Version weiterbauen oder bewusst verworfen werden. Ohne dieses
   Feld ist jeder Generator-Commit eine stille Datenmigration.
4. **Stabile Objekt-IDs.** WoC leitet Objekte aus der Ziehreihenfolge ab (`planObjects`, Reihenfolge in
   `generateRiftFloor:838-870` bzw. `planObjects`). Für ZDO-Persistenz (geöffnete Truhe, entriegelte Tür) brauchen wir IDs aus der
   *Layout-Position* (Zellindex + Rolle), nicht aus dem Zählerstand — sonst wandert der Zustand einer Truhe auf
   eine andere, sobald sich irgendetwas an der Generierung ändert.
5. **`server.yml`-Flags erreichen laufende Clients nicht** (bekannte WoV-Falle): Der Layout-Deskriptor darf
   deshalb nichts enthalten, was der Client aus Server-Einstellungen ableiten müsste. Alles Geometrierelevante
   kommt aus dem Deskriptor selbst.

---

## 10. Übernahmeliste (verdichtet)

**Direkt übernehmen:**

1. Layout als reine Daten in `shared/`, *eine* Ableitungsfunktion für Kollision, *eine* für Darstellung, beide
   über dieselben Kantenformeln (`dungeon_layout.ts:1-6`, `dungeon_wall_segments.ts:23-25`).
2. Deskriptor statt Geometrie über die Leitung; reine Funktionen; mulberry32 (`rng.ts:16-52`);
   `mixSeed` pro Aspekt (`style.ts:14-21`).
3. Der geteilte Positions-Wurf für Slot-Dressing, den Render *und* Kollision lesen (`dungeon_layout.ts:19-28`) —
   **aber ganzzahlig gehasht, nicht per `Math.sin`.**
4. Parity-Test „jede gezeichnete Wandfläche liegt auf Kollision, jeder Wand-Collider ist gedeckt“, gesweept über
   Seeds und Etagen (`tests/rift_wall_render_parity.test.ts:13-27`).
5. Dominanzebenen-Kollaps im Triplanar (`worn_stone.ts:801-810`) und gemessene Textur-Konstanten als
   Konvergenzziel der Distanzblende (`:94-105`, `:299-345`).
6. Grafikstufen als eine monotone Leiter mit `tierAtLeast`, tier-abhängige Werte als Compile-Konstanten, plus
   Dev-Killschalter pro Layer (`gfx.ts:36-51`, `worn_stone.ts:645-647`).
7. Ressourcen-Besitz pro Instanzwurzel mit „geteilt“-Markierung (`interior_resource_lifecycle.ts:14-22`).
8. Architektur-Dauertest gegen Schichtverletzungen (`tests/architecture.test.ts:1-38`).
9. Höhen als geteilte Funktion, nicht als Renderer-Podest (`dungeon_layout.ts:986-992`).
10. Cache-Schlüssel = vollständiger Deskriptor, nie Position (`delve_interior_cache_core.ts:1-12`).

**Bewusst anders machen:**

| Thema | WoC | Wir |
|---|---|---|
| Architektur-Geometrie | GLB-Module, instanziert | zur Laufzeit aus Zellen erzeugt → Lücken- und Maßklasse entfällt |
| Raumform | Halbbreiten-Profil → Polygon, sternförmig validiert | Zellmaske, Zusammenhang + Erreichbarkeit validiert |
| Rng-Ströme | ein Strom pro Etage (dokumentierte Fragilität, `rift_gen.ts:280-284`) | ein Strom **pro Aspekt** |
| Hash für geteilte Würfe | `Math.sin`-basiert | ganzzahlig (`Math.imul`), engine-unabhängig |
| Shader-Injektion | `onBeforeCompile` + Chunk-`replace` + Hand-Cachekey | `MaterialPluginBase`, Defines statt Uniforms für Tier-Werte, `vPositionW`/`vNormalW` geschenkt |
| Instanzen | Koordinatenbänder in einer Welt | eigene Instanzwelten, Adapter, `layoutVersion` im Dokument |
| Material-Varianz | multiplikative Tönung pro Variante | zusätzlich Weltlage-Blending (Moos/Feuchte/Schmutz) im selben Plugin-Block |
| Objekt-Identität | Ziehreihenfolge | Layout-Position (Zellindex + Rolle), wegen ZDO-Persistenz |

**Offene Punkte für die Babylon-Recherche:**

- Exakte `CUSTOM_*`-Injektionsmarken des Babylon-8-PBR-Fragmentshaders und ihre Reihenfolge relativ zu
  Albedo / Normale / Reflectivity.
- Ob `Material.clone()` Plugins überträgt (sonst brauchen wir WoCs Wiederanheft-Spezifikation,
  `worn_stone.ts:652-661`).
- Thin Instances vs. zusammengebackene Raumgeometrie: ab welcher Wiederholungszahl lohnt was — das ist eine
  **Messung**, keine Annahme.
- Ob Babylons `NodeMaterial`-Weg für das Blending günstiger ist als GLSL im Plugin (Wartbarkeit gegen Kontrolle).

---

## 11. Zwei Sätze, die man sich merken sollte

Aus `dungeon_layout.ts:19-24` über den geteilten Slot-Wurf:

> „*the ONE draw both the renderer … and the collider builder … consume, so mesh and physics can never disagree.*“

Und aus `delve_interiors.ts:36-38`, warum das trotzdem schiefging:

> „*Falling back to the interior default … was the source of the drifting walls/floor and the out-of-map gaps.*“

Die Regel ist billig. Sie hält nur, wenn es **keinen** Standardwert gibt, auf den man zurückfallen kann.
