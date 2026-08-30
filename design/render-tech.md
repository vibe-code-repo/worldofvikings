---
tags: [wov, dungeon-generator-2, design, rendering, babylon]
status: entwurf
erstellt: 2026-08-30
---

# Render-Technik für Dungeon Generator 2.0 (Babylon.js 8)

Grundlage: [[Dungeon Generator 2.0]] (Beschlüsse), Code-Analyse von
`client/src/engine/PbrNebelFix.ts`, `NebelRichtung.ts`, `StandardGammaFix.ts`,
`FackelLicht.ts`, `Lighting.ts`, `ValheimDof.ts`, `PostProcessing.ts` sowie
`BaumImpostor.ts`, `GrassClutter.ts`, `HuegelGras.ts` (Instancing-Muster) und
`client/package.json` (Babylon 8.0.0, `@babylonjs/materials`, `@babylonjs/havok`).

Dieses Dokument ist ein **technischer Plan**, keine fertige Implementierung.
Wo Babylon-interne Shader-Chunk-Namen zitiert werden (z. B. konkrete
`CUSTOM_FRAGMENT_*`-Injektionspunkte), gilt dieselbe Regel wie in
`PbrNebelFix.ts`/`NebelRichtung.ts`: **am aufgelösten Shadercode der
installierten Babylon-Version nachmessen, nicht aus der Erinnerung
übernehmen.** Die Namen können sich zwischen Babylon-Minor-Versionen
verschieben (`fogFragment`-Beispiel in `NebelRichtung.ts` zeigt genau das:
derselbe Include heißt in `default.fragment` `color`, in `pbr.fragment`
`finalColor`).

## 1. Triplanar-PBR als `MaterialPluginBase`-Plugin

### 1.1 Grundprinzip

World-Space-Triplanar heißt: keine UVs auf der Laufzeit-Geometrie nötig.
Der Shader sampelt jede Textur dreimal — auf den Ebenen XY, XZ, YZ der
**Weltposition** (`vPositionW`, in PBR-Fragmentshadern bereits vorhanden,
sobald Licht/Normale gebraucht werden — bei Dungeon-Wänden immer der Fall)
— und mischt die drei Ergebnisse mit Gewichten aus der Weltnormale:

```glsl
vec3 blendWeights = pow(abs(normalW), vec3(SCHAERFE));
blendWeights /= (blendWeights.x + blendWeights.y + blendWeights.z);
```

`SCHAERFE` (typisch 3–6) entscheidet, wie schnell an Kanten von einer
Projektion zur nächsten umgeschaltet wird — zu niedrig verwäscht Kanten, zu
hoch macht den Übergang sichtbar hart. Das ist ein Theme-Parameter (Punkt
1.4), kein globaler Fixwert.

**Normal-Blending an Kanten**: Die drei Normal-Map-Samples liegen in
unterschiedlichen Tangentenräumen (je Projektionsachse), ein simples
Weighted-Average der rohen Normalen ist falsch (mittelt Richtungen aus drei
verschiedenen Räumen). Zwei Wege, beide etabliert:

- **Whiteout-Blend** (billig, robust): Jede Tangentenraum-Normale wird in
  Weltraum gedreht (feste Rotation je Achse — für achsenausgerichtete
  Projektion nur Achsentausch + Vorzeichen, keine Matrixmultiplikation
  nötig), dann `(nx.xy + ny.xy + nz.xy, nx.z * ny.z * nz.z)` normalisiert.
  Reicht für die angestrebte "flächige, ruhige Quader"-Optik völlig aus.
- **Reoriented Normal Mapping (RNM)**: korrekter an starken Kanten, kostet
  mehr ALU. Für den "Viking Barrow"-Stil (bewusst NICHT fotoreal, siehe
  Leitbild) ist der Mehraufwand nicht zu rechtfertigen — Whiteout-Blend
  reicht, kann aber als spätere Stufe-Hoch-Option offenstehen.

### 1.2 Welche PBR-Kanäle werden ersetzt

Albedo, Normal, Roughness, AO, Height — pro Layer eigene Textur(-Ebene).
Vier Injektionsorte im PBR-Fragmentshader (Namen am aufgelösten Shader
verifizieren, siehe Kopfhinweis):

| Kanal | ungefährer Injektionsort | überschreibt |
|---|---|---|
| Albedo | nach der Basisfarb-Zusammensetzung, vor Beleuchtung | `surfaceAlbedo` |
| Normal | im Normal-Block, nach dem Auslesen der (nicht vorhandenen) Textur-Normale | `normalW` |
| Roughness/Metal | im Reflectivity-Block | `roughness`/`microSurface` |
| AO | im Ambient-Occlusion-Block | `ambientOcclusionColor` |
| Height | nur intern für Parallax (Punkt 3), kein PBR-Kanal |

Das Muster ist exakt das aus `FackelLicht.ts`: `getUniforms()` liefert
zusätzliche Einträge in den **bestehenden Material-UBO-Block** (kein neuer
Block — siehe Budget-Hinweis unten), `getCustomCode()` liefert den
GLSL-Baustein an einem `CUSTOM_FRAGMENT_*`-Punkt, `prepareDefines()`
schaltet ihn per `#ifdef` ein/aus.

**Wichtiger Unterschied zu den vier bestehenden Plugins**: `PbrNebelFix`,
`NebelRichtung`, `StandardGammaFix`, `FackelLicht` hängen sich über
`scene.onNewMaterialAddedObservable` an **jedes** Standard-/PBR-Material der
Szene — sie korrigieren eine globale Eigenschaft (Nebelkurve, Gammafehler)
bzw. liefern einen globalen Dienst (Fackellicht). Das Triplanar-Plugin ist
das erste, das **material-spezifische Theme-Daten** braucht (welche
Textur-Ebene, welche Tint-Farbe, welche Schwellwerte). Es wird deshalb
gezielt an genau den PBR-Materialien installiert, die der
Dungeon-Geometrie-Bauer erzeugt — nicht global. Es stapelt sich trotzdem
korrekt mit den vier globalen Plugins auf demselben Material, weil der
`MaterialPluginManager` das explizit erlaubt (dasselbe Prinzip, mit dem
heute schon vier Plugins auf einem Baum-Material koexistieren).

### 1.3 Prioritäts-/Reihenfolge-Entscheidung

Bestehende Prioritäten: `StandardGammaFix` 100, `PbrNebelFix` 110,
`NebelRichtung` 120, `FackelLicht` 120. Alle vier setzen erst **spät** an
(Gamma-Endkorrektur, Nebelmischung, direkt vor der Nebelmischung) — nach
Farb- und Lichtzusammensetzung.

Das Triplanar-Plugin muss dagegen **vor** der Lichtberechnung greifen: Es
ersetzt Albedo/Normal/Roughness/AO, bevor `finalColor` überhaupt entsteht.
Empfehlung: **Priorität 10**, deutlich vor `StandardGammaFix` (100). Die vier
bestehenden Plugins bleiben unberührt, weil sie auf andere Textstellen
zielen (Gammakorrektur am Ende, Nebelmischung ganz am Ende) — es gibt keine
Regex-Kollision, nur eine Reihenfolge im internen Injektionspunkt-Register,
und niedrige Priorität = früh in der generierten Reihenfolge.

Ein zweiter Punkt aus `FackelLicht.ts` gilt unverändert: **Priorität und
Injektionspunkt-Name sind zwei verschiedene Dinge.** Solange das
Triplanar-Plugin einen eigenen `CUSTOM_FRAGMENT_UPDATE_ALBEDO`-artigen Punkt
nutzt und nicht denselben Regex-Text wie `PbrNebelFix`/`NebelRichtung`
trifft, ist die genaue Prioritätszahl unkritisch — wichtig ist nur "vor der
Lichtrechnung", nicht "vor Priorität 100" im mathematischen Sinn.

### 1.4 Theme-Parameter pro Material-Instanz

Jede Dungeon-Wand-/Boden-Materialinstanz bekommt eigene Uniform-Werte
(nicht die globale Static-Klasse aus `FackelLicht.ts` — dort war Teilen
richtig, weil alle Fackeln denselben Szenen-Zustand abbilden; hier ist
jedes Theme anders):

```ts
interface TriplanarTheme {
  layerIndex: number;      // Index in den Textur-Arrays (Punkt 1.5)
  blendSharpness: number;  // s.o., 3..6
  mossHoehe: number; mossNormaleSchwelle: number; mossTint: Color3;
  feuchteEckenStaerke: number;
  schmutzHoehe: number;
  rissDichte: number; rissTiefe: number;
  seed: number;            // Hash-Offset fürs prozedurale Rauschen (Determinismus!)
}
```

`seed` ist kein Kosmetik-Parameter, sondern **Pflicht** wegen des
Determinismus-Gesetzes: Das prozedurale Rauschen (Punkt 2) muss bei
gleichem Seed auf Server *und* Client dieselbe Verteilung ergeben — server-
seitig zählt das nur für Kollisions-/Sichtprüfungen, falls solche je an
Materialeigenschaften hängen sollten, aber die Regel gilt unabhängig davon
strikt für die Layout-/Geometrieerzeugung, und Materialparameter sollten
ihr nicht widersprechen.

### 1.5 Textur-Arrays statt Atlas

**Empfehlung: `Texture2DArray` (Babylon: `RawTexture2DArray` beim
prozeduralen Bau, oder `Texture2DArray`-Loader bei vorproduzierten
Assets), nicht ein Atlas.**

Begründung:

- **Triplanar + Atlas bricht an den Kachelgrenzen.** Bilineares Filtern
  und vor allem Mipmapping sampeln über die Kachelgrenze hinweg in die
  Nachbarkachel hinein (klassisches Atlas-Bleeding), und triplanares
  Mapping erzeugt durch die Weltraum-Wiederholung ständig neue
  UV-Wraps — Rand-Padding hilft nur bis zu einer gewissen Mip-Stufe.
  Bei einer Wand, die über zehn Meter dieselbe Kachel wiederholt, ist das
  ein garantiertes Problem, kein Randfall.
- **Texture2DArray hat pro Layer eigenes Mipmapping und eigenes
  Wrap-Verhalten** — exakt das, was `REPEAT`-Wrapping bei Triplanar
  braucht, ohne Bleeding-Sonderfälle.
- Kosten: alle Layer einer Array-Textur müssen dieselbe Auflösung und
  dasselbe Format haben. Für ein begrenztes Set von Barrow-Materialien
  (Fels grob, Fels glatt, Bruchstein, Holz/Balken, evtl. 1–2 Theme-
  Varianten) ist das kein Problem — die Materialpalette ist laut Leitbild
  ohnehin gedämpft und klein, nicht ein PBR-Materialsatz mit hundert
  Varianten.

**Sampler-Budget** (wichtig, weil `FackelLicht.ts` schon zeigt, dass
WebGL2-Grenzen im Projekt real gerissen werden können): Empfehlung, mit
möglichst wenigen zusätzlichen Samplern auszukommen:

| Sampler | Inhalt |
|---|---|
| `dungeonAlbedoArray` | RGB Albedo, A ungenutzt oder Opacity-Reserve |
| `dungeonNormalArray` | RG Normal (Z rekonstruiert), B ungenutzt |
| `dungeonOrhArray` | R Occlusion, G Roughness, B Height (für Parallax, Punkt 3) |

Drei neue `sampler2DArray`-Bindings für alle Basismaterialien zusammen —
unabhängig davon, wie viele Layer die Arrays am Ende haben. Moos/Feuchte/
Schmutz/Risse (Punkt 2) kommen **nicht** aus zusätzlichen Arrays, sondern
aus ein bis zwei kleinen, eigenständig tilenden Detailtexturen (Moos-
Albedo+Normal gemeinsam gepackt) plus prozeduralem Rauschen ohne Textur
(Punkt 2.4) — das hält den Sampler-Verbrauch bei ca. 5 zusätzlichen
Einheiten. Vor dem Festlegen: tatsächliche Sampler-Anzahl aller bereits
aktiven Plugins/Passes an einem Dungeon-Wand-Material auszählen
(PBR-Basissamplers + Environment-Cube + Shadow-Map-Sampler aus
`Shadows.ts`) und gegen `engine.getCaps()`-Limits prüfen — genau die
Vorsichtsmaßnahme, die `FackelLicht.ermittlePlaetze()` für Uniform-Plätze
schon vorführt, hier für Textur-Einheiten statt Uniform-Vektoren.

### 1.6 Uniform-Budget

`getUniforms()` soll wie bei `FackelLicht` in den **Material-UBO-Block**
einhängen, nicht einen eigenen Block aufmachen — aus genau dem in
`FackelLicht.ts` dokumentierten Grund (WebGL2-Garantie ist
`MAX_FRAGMENT_UNIFORM_BLOCKS = 12`; Szene+Material+Mesh+Licht-Blöcke sind
schon mehrere). Die Theme-Struct aus 1.4 ist klein (< 10 Skalare/Vektoren
pro Material), verglichen mit den 33 vec4 aus `FackelLicht` also
unkritisch für den Block selbst — kritisch ist nur, KEINEN zusätzlichen
Block zu erzeugen.

## 2. Material-Blending im selben Shader

Alle vier Effekte laufen **im selben Fragment-Durchlauf** wie das
Triplanar-Sampling (kein zweiter Pass, kein Compositing) — sie modifizieren
Albedo/Normal/Roughness nach dem Triplanar-Sample und vor der
Lichtberechnung.

### 2.1 Moos nach Höhe + Normale

```glsl
float moosFaktor = smoothstep(theme.mossHoehe - 0.3, theme.mossHoehe + 0.3, worldPos.y)
                  * smoothstep(theme.mossNormaleSchwelle, 1.0, dot(normalW, vec3(0,1,0)));
```

Höhe (welcher Boden näher am Grundwasser/Erdreich liegt) UND Normale
(waagerechte Flächen sammeln Moos, senkrechte kaum) — beide Bedingungen
UND-verknüpft, sonst wächst Moos an senkrechten Wänden am Boden genauso
stark wie auf Sockeln. `moosFaktor` mischt Albedo (grünlicher Tint aus
`mossTint`), Normal (leicht aufgeraut) und Roughness (höher) der
Basisschicht mit der Moos-Detailtextur.

### 2.2 Feuchte in Ecken via AO/Distanz

**Wichtiger Fallstrick, der vorab geklärt werden muss**: Echtes
Screen-Space-AO (SSAO2, Punkt 3) ist ein **Post-Process nach dem
Material-Pass** — im Fragment-Shader des Materials selbst steht kein
SSAO-Wert zur Verfügung, den man hier abfragen könnte (SSAO wirkt auf das
fertige Bild, nicht auf `surfaceAlbedo`). "Feuchte in Ecken via AO" kann
also nicht heißen: SSAO-Textur im Material lesen.

Zwei echte Optionen:

- **Geometrische Krümmung (Cavity) aus Ableitungen**: `fwidth(normalW)`
  ist an konkaven Kanten (Ecken, Fugen) groß, auf flachen Flächen nahe
  null — eine billige, deterministische Cavity-Näherung ganz ohne
  zusätzliche Textur oder Pass. Rein bildraum-basiert (`dFdx`/`dFdy`),
  läuft also auf Fragmentgranularität ohne globalen Kontext — genau
  richtig für "nasser Fleck direkt an der Kante", nicht für "diese ganze
  Nische ist feucht".
- **Vorberechnetes Zellen-Attribut aus dem Layout**: Da das Zellenraster
  (Beschluss: zellbasiertes Datenmodell) ohnehin weiß, welche Zellen
  Wandnachbarn in mehreren Richtungen haben (= Ecken/Nischen), kann der
  Geometrie-Bauer eine Ecken-/Konkavitäts-Stärke direkt als
  Vertex-Attribut (ein zusätzlicher `float`-Kanal, z. B. im vierten Slot
  einer sonst ungenutzten Vertexfarbe) mitgeben. Das ist **deterministisch
  per Definition** (kommt aus den Layout-Daten, nicht aus Bildraum-
  Rauschen) und passt zum "Determinismus ist Gesetz"-Beschluss besser als
  jede Bildraum-Heuristik.

**Empfehlung**: beide kombinieren — das Vertex-Attribut liefert die grobe,
raumbezogene Verteilung ("diese Nische ist feucht"), `fwidth`-Cavity
liefert die feine, kantengenaue Verstärkung obendrauf. Reine SSAO-Kopplung
ist technisch nicht möglich, ohne die Rendering-Reihenfolge umzudrehen
(Material müsste NACH einem Pre-Pass-AO lesen — deutlich teurer, siehe
Punkt 3 zu SSR/PrePass).

### 2.3 Schmutz am Boden

Analog zu Moos, aber ohne Normalenbedingung: reiner Höhen-Schwellwert
(`theme.schmutzHoehe`) plus dieselbe `fwidth`-Cavity-Verstärkung (Schmutz
sammelt sich ebenfalls in Ritzen/an der Wand-Boden-Kante).

### 2.4 Risse per Noise

Prozedurale Wertrauschen-Funktion **im Shader**, keine Rauschtextur —
spart einen Sampler (Budget siehe 1.5) und vermeidet Wiederholungsmuster
bei großen Weltkoordinaten. Ein einfacher Hash-basierter 3D-Value-Noise
(gehashte Gitterwerte + trilineare Interpolation) reicht für Risse, die
nur ein binäres/weiches Maskensignal liefern müssen — kein High-Fidelity-
Terrain-Noise nötig, wie es z. B. `TerrainSplat.ts` fürs Gelände braucht.
`theme.rissDichte`/`rissTiefe` skalieren Frequenz und Eindringtiefe;
`theme.seed` verschiebt den Hash-Ursprung, damit verschiedene Dungeon-
Instanzen nicht sichtbar identische Rissmuster zeigen, obwohl beide
deterministisch aus ihrem jeweiligen Seed folgen.

Risse wirken zweifach: dunklerer Albedo-Streifen entlang der Maske, plus
ein kleiner Normalen-Versatz (nicht echte Geometrie) für die Illusion von
Tiefe — bei Bedarf durch echten Parallax-Versatz ergänzt (Punkt 3, nur
Stufe Hoch).

## 3. Vollausbau-Effekte in Babylon 8

### 3.1 SSAO2RenderingPipeline — wiederverwenden, Parameter neu

Bereits produktiv in `PostProcessing.ts` (Zeile 326 ff.), inklusive der
beiden dort dokumentierten Fallstricke: `forceGeometryBuffer = true` (weil
`scene.enablePrePassRenderer()` bei den granularen Imports dieses Projekts
fehlt) und `textureType = HALF_FLOAT` (sonst klemmt SSAO das HDR-Bild vor
dem Bloom auf LDR). Für Dungeons **nicht** dieselbe Pipeline-Instanz mit
denselben Parametern verwenden — `SSAO_MAX_Z = 1000` ist explizit für die
4-km-Außenwelt kalibriert (siehe der dortige Kommentar zu den
Nebelbändern). Innenräume sind meterklein; ein an der Weltgröße kalibrierter
`maxZ` schneidet in einem Dungeon nichts sinnvoll ab (der ganze Dungeon
liegt sowieso "im Nahbereich"). Empfehlung: eigene SSAO2-Instanz oder
zumindest eigene `maxZ`/`radius` für Dungeon-Kameras, z. B. `maxZ` im
Bereich 30–60 m, `radius` ggf. kleiner (0.05–0.1) für die engeren
Raummaßstäbe — MUSS in der Instanz nachgemessen werden (die
Außenwelt-Erfahrung "Radius ändert kaum etwas, `totalStrength` ist der
richtige Regler" gilt vermutlich analog, aber das ist eine Messung, keine
Übernahme).

Geteilter GeometryBufferRenderer: `PostProcessing.syncGeometryBuffer()`
zeigt das Muster, drei Nutzer (DOF, Motion Blur, SSAO) teilen sich eine
Passage. Für Dungeons kommt ein vierter potenzieller Nutzer dazu (SSR,
Punkt 3.2) — falls SSR über den PrePassRenderer statt den
GeometryBufferRenderer läuft (wahrscheinlich, siehe unten), sind das ZWEI
verschiedene Zusatzpassagen, keine gemeinsame. Das muss in die
Kostenrechnung der Grafikstufen (Punkt 4) einfließen.

### 3.2 SSR (nasse Böden)

Babylon 8 bietet **zwei** SSR-Wege:

- `ScreenSpaceReflectionPostProcess` (älter, einfacher, arbeitet auf
  Farbe+Tiefe, kein PrePass nötig) — geringere Qualität (kein
  Reflectivity-/Normal-Buffer, "billige" Bildraum-Reflexion), aber ohne
  die PrePass-Abhängigkeit.
- `SSRRenderingPipeline`/`ScreenSpaceReflections2Configuration`
  (Babylon 8-Generation, physikalisch plausibler, braucht den
  **PrePassRenderer** mit Normal+Reflectivity-MRTs).

**Fallstrick mit bestehendem Code**: Der PrePassRenderer wird im Projekt
bislang **bewusst gemieden** — `PostProcessing.ts` (Motion-Blur-Kommentar)
hält ausdrücklich fest, dass `scene.enablePrePassRenderer()` bei den
granularen Babylon-Imports dieses Projekts nicht existiert, weil der
Side-Effect-Import fehlt, und wählt deshalb überall den
GeometryBufferRenderer als Ausweichroute. Für echtes SSR (Reflectivity-
Qualität) führt daran aber kein Weg vorbei — der GeometryBufferRenderer
liefert keine Reflectivity-MRT. Konsequenz: entweder

1. den fehlenden Side-Effect-Import gezielt nachziehen (nach dem in
   `ValheimDof.ts` vorgeführten Muster:
   `import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent'`
   → Analogon `import '@babylonjs/core/Rendering/prePassRendererSceneComponent'`)
   und den PrePassRenderer als **zweite, komplette Zusatzpassage** neben
   dem GeometryBufferRenderer akzeptieren, oder
2. mit der einfacheren `ScreenSpaceReflectionPostProcess`-Variante starten
   (kein PrePass, geringere Qualität, aber für "nasse Böden spiegeln
   grob" in einem Dungeon mit kontrollierter Beleuchtung evtl. genug).

Empfehlung: **Meilenstein 1 (begehbarer Auto-Dungeon) ohne SSR**, danach
Variante 2 zuerst messen (kein PrePass-Risiko), Variante 1 nur, wenn die
Bildqualität sichtbar nicht reicht — und dann mit derselben
Messdisziplin wie bei SSAO_MAX_Z (Bild-Vorher/Nachher, nicht nur FPS-Zahl,
siehe die Lehre in `PostProcessing.setSSAO()`: "eine Messung unter den
Voreinstellungen ist keine Messung für den, der sie geändert hat").

Wasser-Reflexion existiert im Projekt bereits separat (`WaterPlugin.ts`,
`WaterRefraction.ts`) — das ist eine andere, wasserspezifische Technik
(Planar-Reflexion vermutlich) und kein Vorbild für allgemeines SSR auf
beliebigen Bodenmaterialien; sollte vor der SSR-Entscheidung trotzdem
kurz gegengelesen werden, falls sich Teile (Reflexionstextur-Handling)
wiederverwenden lassen.

### 3.3 Godrays (Volumetric Light Scattering)

`VolumetricLightScatteringPostProcess` ist bereits produktiv
(`PostProcessing.setSunShafts()`) — dort für Außenwelt-Sonnenlicht, mit
gemessenen, happigen Kosten (40 → 17 fps bei Ratio 0.5/100 Samples,
deshalb Standard AUS, Ratio 0.25/60 Samples als Kompromiss). Zwei
Übertragungsfragen für Dungeons:

- **Lichtquelle**: kein `sunDir`, sondern feste Weltpositionen (Fackeln,
  Deckenöffnungen/Lichtschächte). `customMeshPosition` (bereits im
  bestehenden Code über `useCustomMeshPosition = true` genutzt) passt
  direkt — die Occlusion-Mesh-Position ist bei einer Deckenöffnung/
  Fackel ohnehin fix, nicht wie beim Sonnenlicht "2 km in Blickrichtung
  geschoben".
- **Kosten**: Die 40→17-fps-Messung war Außenwelt mit dichter Vegetation
  als Verdecker. Ein Dungeon-Innenraum hat eine viel kleinere,
  kontrolliertere Verdeckungsgeometrie (Wände/Decke des Raums selbst) —
  die Occlusion-Passage sollte günstiger sein, ist aber **nicht ohne
  eigene Messung zu übernehmen**. Aufwand skaliert laut Babylon-Doku mit
  Bildschirmfläche des Lichtkegels und Sample-Zahl, nicht direkt mit
  Szenenkomplexität, insofern könnte der bisherige Kostenschock
  (Vegetation) hier weniger stark zuschlagen — das ist eine Hypothese,
  keine Messung.

Empfehlung: Godrays gezielt an einzelne, vom Editor markierte
"Lichtschacht"-Stellen hängen (nicht global "ein Godray je Fackel" — bei
16 Fackeln pro Instanz wäre das dieselbe Kostenexplosion wie ungebremstes
SSR), Stufe Hoch, mit Ratio/Samples analog zur bestehenden 0.25/60-Wahl
als Startpunkt.

### 3.4 Parallax (im Triplanar-Plugin selbst)

Parallax Occlusion Mapping (POM) braucht eine Tangentenraum-Sichtrichtung
und mehrere Texturzugriffe entlang der Sichtrichtung, um die
Höhenkarte (Punkt 1.5, im ORH-Array) abzusuchen. Bei **Standard-UV**-
Materialien ist das Standardkost. Bei **Triplanar** kommt eine
Komplikation dazu: Es gibt nicht einen Tangentenraum, sondern bis zu drei
gleichzeitig aktive (einer je Projektionsachse), und der volle POM-Tap-
Aufwand vervielfacht sich mit der Zahl der geblendeten Ebenen — an einer
Kante (alle drei Gewichte > 0) im ungünstigsten Fall dreimal die
Tap-Zahl einer einzelnen Ebene.

Konsequenzen für den Plan:

- **Kein Steep-POM mit vielen Schichten** (typisch 16–32 Taps) auf allen
  drei Ebenen gleichzeitig — das multipliziert sich zu inakzeptablen
  Kosten für eine Wandfläche, die im Barrow-Stil ohnehin "ruhige
  Quader" sein soll, keine fotorealistische Tiefenillusion.
- **Empfehlung**: einfacher Offset-Limiting-Parallax (4–8 Taps, kein
  Occlusion-Test) NUR auf der **dominanten** Projektionsebene (höchstes
  Blend-Gewicht), die anderen beiden Ebenen bekommen nur die (bereits
  vorhandene) Normal-Map-Tiefenillusion ohne echten UV-Versatz. Das
  reduziert die Kosten auf höchstens 8 Taps zusätzlich und passt zum
  Stil-Leitbild ("flächig", nicht "jede Fuge in echter Tiefe").
- Parallax ist ein reiner Stufe-Hoch-Effekt (Punkt 4) — als
  `#ifdef PARALLAX`-Zweig im selben Triplanar-Plugin, analog zu
  `FACKELLICHT`/`FACKELLICHT`-Define in `FackelLicht.ts`.

### 3.5 Zusammenspiel mit bestehenden Plugins — Zusammenfassung der Fallstricke

- **Fog-Plugins bleiben unberührt**, solange Triplanar früh genug (vor
  Licht-/Fog-Zusammensetzung) greift — siehe Prioritäts-Diskussion 1.3.
  Kein Regex-Konflikt, weil unterschiedliche Codezeilen getroffen werden.
- **PrePassRenderer ist im Projekt Neuland** (nur SSR2 bräuchte ihn) —
  jede Entscheidung dafür ist eine Architekturentscheidung, keine lokale
  Materialänderung, weil PrePass und GeometryBufferRenderer **zwei
  getrennte Zusatzpassagen** sind, die beide über die komplette aktive
  Geometrie laufen. `PostProcessing.beschraenkeGeometryBuffer()` filtert
  heute schon Gras aus der GBuffer-Passage aus Kostengründen — eine
  analoge Filterung (welche Meshes braucht SSR wirklich? nur Böden mit
  `feuchteStaerke > 0`?) gehört von Anfang an mitgedacht, nicht
  nachträglich wie beim Gras.
- **Sampler-/Uniform-Budget** ist über alle vier bestehenden Plugins plus
  Triplanar plus Shadow-Maps plus Environment-Probe gemeinsam zu prüfen,
  nicht isoliert je Plugin — `FackelLicht.ermittlePlaetze()` ist das
  Vorbild für eine Laufzeit-Kapazitätsprüfung mit Fallback-Stufen statt
  einer festen Annahme.
- **Notbremse-Muster übernehmen**: `FackelLicht.fackelNotbremse()` fängt
  Compile-Fehler ab und schaltet betroffene Effekte für die Sitzung (und
  gemerkt für künftige Sitzungen) ab, statt eine schwarze Welt zu zeigen.
  Für ein Plugin, das auf JEDER Dungeon-Wand hängt, ist dieselbe
  Rückfallebene Pflicht, nicht Kür — ein Compile-Fehler in einem
  Dungeon-Theme darf nicht den ganzen begehbaren Dungeon unsichtbar
  machen.

## 4. Grafikstufen-Design

Grundprinzip wie in `PostProcessing.ts` bereits etabliert: eine zentrale
Options-Struktur (dort `PostProcessingOptions`), einzelne Setter je Effekt,
ein `apply()`, das alle Setter durchreicht. Für Dungeons kommt eine
Material-seitige Ergänzung dazu (der Triplanar-Plugin-Stand ist selbst Teil
der Grafikstufe, nicht nur Post-Processing).

| Effekt | Niedrig | Mittel | Hoch |
|---|---|---|---|
| Triplanar Basis (Albedo/Normal/Rough/AO) | an | an | an |
| Material-Blending (Moos/Feuchte/Schmutz/Risse) | aus (nur Basisschicht) | an | an |
| Parallax (dominante Ebene) | aus | aus | an |
| SSAO2 (dungeon-kalibriert) | aus | an | an, höhere `totalStrength` |
| SSR | aus | aus | an (Variante 2 zuerst, s. 3.2) |
| Godrays (nur an Editor-markierten Lichtschächten) | aus | aus | an |
| TAA | aus | Nutzeroption (wie Außenwelt) | Nutzeroption |
| Bloom/Chrom. Aberration/FXAA | wie Außenwelt-Voreinstellung, unverändert | gleich | gleich |

**Schalter-Architektur**:

- Eine `DungeonGrafikStufe`-Enum (`Niedrig`/`Mittel`/`Hoch`), eine Ebene
  über `PostProcessingOptions` — kein Ersatz dafür, sondern eine
  zweite, Dungeon-spezifische Konfiguration, weil Godrays/SSR/SSAO-Werte
  für Dungeons andere Zahlen brauchen als für die Außenwelt (Punkt 3.1).
- Das Triplanar-Plugin bekommt wie `FackelLichtPlugin` ein
  `setzeStufe(stufe)` mit `markAllDefinesAsDirty()` beim Wechsel, statt
  `prepareDefines()` selbst zu pollen — dasselbe Muster wie
  `FackelLichtPlugin.setzeAn()`.
- Eine gemeinsame Quelle (z. B. `ui/Settings.ts`, wo laut
  `PostProcessing.ts`-Kopfkommentar die Außenwelt-Schalter schon sitzen)
  speist sowohl `PostProcessing.apply()` als auch
  `TriplanarPlugin.setzeStufe()` und die SSR/Godray-Verwaltung — ein
  einziger Stufenwert, mehrere Abnehmer, nicht mehrere Wahrheiten.
- Automatische Rückstufung: analog zur `FackelLicht`-Notbremse sollte ein
  gemessener Framerate-Einbruch (bereits vorhandener "FPS-Wächter" laut
  `PostProcessing.ts`-Kommentarhistorie, siehe E3-Referenz) eine Stufe
  automatisch zurücknehmen können — aber, wie dort dokumentiert, **eine
  Zahl ersetzt nie den Blick**: automatische Rückstufung ja, automatisches
  Feintuning der Einzelparameter nein.

## 5. Instancing-Strategie für Laufzeit-Geometrie

### 5.1 Ein Mesh je Material-Gruppe — mit Chunk-Grenze

**Ja, ein Mesh je Material-Gruppe**, aber nicht ein Mesh für den gesamten
Dungeon: Vollständiges Zusammenführen (`Mesh.MergeMeshes`) aller Zellen
gleichen Materials in EIN Mesh maximiert die Draw-Call-Ersparnis, tötet
aber jedes Frustum-/Occlusion-Culling innerhalb des Dungeons — ein
Spieler in Raum 1 würde die komplette Geometrie von Raum 40 mitrendern,
weil sie geometrisch ein einziges Objekt ist.

Empfehlung: **Chunking nach Raum bzw. Zellblock**, exakt das Muster, das
`GrassClutter.ts` für die Außenwelt bereits nutzt ("Cell = 4×4 patches =
40m — one InstancedMesh per cell per entry", Zeile 45). Für Dungeons ist
die natürliche Chunk-Grenze der **Raum** (aus dem Zellen-/Raum-
Stempel-Modell): pro Raum und pro Material-Layer ein gemergtes
Static-Mesh. Das hält Culling grob raumgenau (kein Sub-Raum-Culling
nötig — ein Raum ist ohnehin meist als Ganzes sichtbar oder gar nicht)
und die Draw-Call-Zahl niedrig (Räume × Materialschichten, nicht
Zellen × Materialschichten).

### 5.2 Thin Instances für Deko

**Ja, Thin Instances** für alles Wiederholte, das keine individuelle
Geometrie braucht: Fackelhalterungen, Trümmer/Geröll, kleine
Barrow-Steine, Stützbalken. Drei etablierte Vorbilder im Client:

- `BaumImpostor.ts`: `thinInstanceSetBuffer('matrix', …)` +
  zusätzliche Custom-Attribute (`aImpUv`, `aImpKarte`) über
  weitere `kind`-Buffer — zeigt, wie sich Thin Instances mit
  Zusatzdaten je Instanz kombinieren lassen (für Dungeon-Deko z. B. ein
  Rotations-/Variantenindex).
- `GrassClutter.ts`/`HuegelGras.ts`: Cell-weise Puffer-Neuaufbau,
  Farb-Buffer (`kind: 'color'`) für Varianz ohne Materialwechsel.
- `SchattenInstanzKeulung.ts`: Culling der `thinInstanceCount`,
  mit der ein Schatten-Mesh gezeichnet wird — dasselbe Muster für
  Dungeon-Deko-Schatten wiederverwenden, damit nicht jede Fackelhalterung
  auch ohne Sichtkontakt einen Schattenwurf kostet.

Platzierung deterministisch aus den Layout-Daten (Seed → Zellen-Belegung
→ Deko-Positionen), keine Laufzeit-Zufallsstreuung wie bei
`GrassClutter` (dort ist Streuung gewollt und pro Client identisch, weil
seed-basiert) — für Dungeon-Deko gilt dasselbe Prinzip, nur mit dem
Zellenraster als Eingabe statt Terrain-Höhenfeld.

### 5.3 Kollision

Der Geometrie-Bauer lebt laut Beschluss in `shared/`, weil der **Server**
ihn für Kollision braucht. Render-Mesh und Kollisions-Mesh müssen deshalb
nicht identisch fein sein: Havok (`@babylonjs/havok` ist bereits
Abhängigkeit) kann mit einer vereinfachten Kollisionsgeometrie (z. B. je
Zelle ein Boxen-/Konvexkörper-Ansatz aus den Zellenflags, nicht das
gerenderte Dreiecksnetz) rechnen, während das Rendering die volle
Triplanar-Wandgeometrie zeigt. Das entkoppelt Rendering-Chunk-Größe (5.1,
raumweise) von Kollisions-Granularität (zellweise, weil Server so oder so
zellweise denkt) — beide leiten sich aus demselben deterministischen
Layout ab, ohne dass eine Struktur die andere erzwingt.

## Offene Punkte für die nächste Phase

1. Am tatsächlich installierten Babylon 8.0.0 die exakten
   `CUSTOM_FRAGMENT_*`-Injektionspunktnamen für Albedo/Normal/Roughness/AO
   im PBR-Fragmentshader nachmessen (wie in `PbrNebelFix.ts`/
   `NebelRichtung.ts` vorgeführt).
2. Sampler- und Uniform-Budget am realen Dungeon-Wand-Material
   durchzählen (alle fünf Plugins + Shadow-Maps + Environment-Probe).
3. SSR-Variante 2 (`ScreenSpaceReflectionPostProcess`) prototypisch
   messen, bevor über PrePassRenderer (Variante 1) entschieden wird.
4. Dungeon-spezifische SSAO-Parameter (`maxZ`, `radius`,
   `totalStrength`) an einem gebauten Testraum messen, nicht von der
   Außenwelt übernehmen.
5. Whiteout- vs. RNM-Normal-Blending optisch gegen das Barrow-Referenzbild
   prüfen, bevor der teurere Weg (RNM) überhaupt erwogen wird.
