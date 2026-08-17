# 07 — Grafik-Konzept: Valheim-Atmosphäre statt Minecraft-Look

> Erstellt 2026-08-01 auf die Meldung „unser Bild erinnert eher an Minecraft als an
> Valheim". Ergänzt [03-Rendering-und-Engine.md](03-Rendering-und-Engine.md) um eine
> Ursachenanalyse und eine Umsetzungsreihenfolge; die dortigen Detailbefunde bleiben gültig,
> **außer** den beiden hier ausdrücklich korrigierten (Schattenempfang des Terrains,
> Clutter-UV-Layout).
>
> **Nachgezogen 2026-08-16.** Die Diagnose (Ursachen A–E) und die Stufen 1–5 stehen
> unverändert — es sind Befunde über unsere Farb- und Beleuchtungspipeline, und die hat
> sich nicht geändert. Was sich geändert hat, ist die **Materialgrundlage**: Der
> Valheim-Export ist gelöscht, es gibt keine gerippten Modelle und keine gerippten Texturen
> mehr (siehe [04-Asset-Pipeline.md](04-Asset-Pipeline.md)). Die Vorgabe *streng
> originalgetreu, kein HD-Mod-Material* ist damit schärfer geworden als sie gemeint war:
> Vorbild bleibt das Original, **Material** kommt ausschließlich aus eigener Hand. Betroffen
> sind Stufe 3 (bereits nachgezogen), Stufe 6 und Stufe 9 sowie der Abschnitt Verifikation
> — jeweils unten gekennzeichnet.

## Ausgangslage

Die Screenshots `screenshots/{fels,wasser,bei_nacht}.png` zeigen Original-Valheim: sehr
dunkle, blaugrüne Nachtszenen mit dichtem, vielgestaltigem Unterholz, weichen
Tiefenstaffelungen und Nebelschichten. Unser Client (`screenshots/2026-07-29_20-32.png`,
`2026-07-31_20-20.png`) wirkt dagegen wie ein Voxelspiel: gleichmäßig gefärbte Flächen,
harte Materialgrenzen, kein Schatten, keine Tiefe.

Der Eindruck ist nicht diffus, sondern **messbar**, und er hat wenige, klar benennbare
Ursachen — überwiegend **Fehler in der Farb- und Beleuchtungspipeline**, nicht fehlende
Assets. Vorgaben aus der Abstimmung: *Optik vor Framerate (30+ fps genügen)*, *dedizierte
Desktop-GPU*, ***streng originalgetreu*** *(kein HD-Mod-Material)*, Vegetationsvielfalt und
Baum-LOD gehören mit in den Umfang.

---

## Diagnose — gemessen, nicht geschätzt

### Bildstatistik unser vs. Original

Gemessen mit `node tools/shot-stats.mjs` (Bodenregion: `300 700 1600 950` bzw. `0 700 700 950`):

| Region | Unser Bild | Original |
|---|---|---|
| Boden Tag | RGB(70.6, 76.5, **12.4**), Sättigung **84,0 %**, Streuung sd 9.6 | RGB(40.4, 41.5, 34.8), Sättigung **31,0 %**, sd **14.6** |
| Boden Nacht | RGB(20, 33, **7**) grünstichig, lum 25 | RGB(2, 8, 9) blaugrün, lum **10.5** |
| Pixel über Helligkeit 128 (Tag, gesamtes Bild) | **0,4 %** | **38,6 %** |
| Tonwert-Entropie (Tag, gesamtes Bild) | 6,44 bit | **7,32 bit** |

Unser Boden ist hypergesättigt mit zerquetschtem Blaukanal und **halber Tonwertstreuung**;
das Bild nutzt fast **nur die untere Hälfte des Tonwertumfangs**.

---

### Ursache A — StandardMaterial bekommt eine Gamma-Konvertierung zu viel (die Hauptursache)

`node_modules/@babylonjs/core/Shaders/default.fragment.js:305-312` hängt am Ende jedes
StandardMaterial-Fragments ein zusätzliches `color.rgb = toLinearSpace(color.rgb)`.
StandardMaterial ist bei Babylon per Konvention ein **Gamma**-Material. PBRMaterial tut das
nicht, das Terrain-NodeMaterial auch nicht.

Unser Projekt füttert StandardMaterial aber durchgehend **linear**:
`Lighting.ts:255-266` (`toLinear(sunColor/ambColor)`), `Lighting.ts:194-203`
(`vFogColor` → `fogColorLinear`), `GrassClutter.ts:428-433` (`useSRGBBuffer: true`).
Das Ergebnis ist, dass ein **linearer Wert als sRGB-Wert angezeigt** wird.

Gegenrechnung mit unseren Daten (Kachel 0 Albedo sRGB(81,112,64), `sunColorDay` Clear,
`lightIntensityDay` 1.7, `ambColorDay`):

| | R | G | B | Sättigung |
|---|---|---|---|---|
| korrekt | 98 | 111 | 60 | 46 % |
| vorhergesagt bei diesem Fehler | ~31–71 | ~41–77 | **~10–12** | **72–84 %** |
| **tatsächlich gemessen** | **71** | **77** | **12** | **84 %** |

Die Vorhersage trifft die Messung. Das Potenzieren mit 2.2 spreizt Kanalverhältnisse —
deshalb *steigt* die Sättigung, statt nur die Helligkeit zu sinken. Betroffen sind Gras,
Wasser und Avatar. **Das ist der billigste große Hebel im ganzen Paket.**

### Ursache B — Schatten sind aus, und sie wären auch eingeschaltet kaputt

`Settings.ts:119` setzt `shadowQuality: 0`. Der Grund dahinter ist ein **Babylon-Bug**:
`LightBlock.prepareDefines` (`Materials/Node/Blocks/Dual/lightBlock.js:183-204`) hat zwei
Zweige. Nur der Mehrlicht-Zweig setzt `defines["SHADOWS"]`; der Einzellicht-Zweig
(`PrepareDefinesForLight`) verwirft ihn. `TerrainSplat.ts:931` setzt
`schattenLicht.light = sonne`, landet also im Einzellicht-Zweig. Und
`ShadersInclude/shadowsFragmentFunctions.js:4` beginnt mit `#ifdef SHADOWS` — die **ganze
Datei** wird wegpräprozessiert.

Headless nachgestellt:
```
LightBlock.light gesetzt   → SHADOWS: false | SHADOW0: true | SHADOWCSM0: true
LightBlock.light NICHT ges.→ SHADOWS: true  | SHADOW0: true | SHADOWCSM0: true
```

**Korrektur an der bisherigen Projektannahme:** `Docs/03` ging davon aus, das Terrain
empfange dank des vorhandenen `LightBlock` inzwischen Schatten. Es empfing keine — weder mit
PCF noch ohne (`computeShadowCSM` steht in derselben `#ifdef`-Klammer). Der Kommentar in
`Settings.ts` war also weiterhin zutreffend, nur aus einem anderen Grund als dort genannt.

**Derselbe Bug steckt ein zweites Mal im VERTEX-Shader.** `shadowsVertex` berechnet die
Kaskadenauswahl als `vPositionFromCamera{X} = view * worldPos` — mit dem fest verdrahteten
Bezeichner `view`. `LightBlock` deklariert den ebenfalls nur im Mehrlicht-Zweig
(`lightBlock.js:277`, hinter `if (this.view.isConnected)`). Sobald das Fragment-Define
repariert ist, tritt deshalb sofort der nächste Fehler auf:

```
VERTEX SHADER ERROR: 'view' : undeclared identifier
```

Den `view`-Input bloß zu verbinden genügt nicht: NodeMaterial vergibt Uniform-Namen mit
`u_`-Präfix, die Matrix heißt im generierten Shader `u_view`. Gebraucht wird zusätzlich die
Brücke `mat4 view = u_view;` vor dem Include. Beides in `SonnenSchattenBlock.ts`.

**Warum das optisch so viel ausmacht:** Die Originaldaten in `shared/src/envData.json` haben
warmes Sonnenlicht (1.00, 0.77, 0.48) und **kaltes, blaues Ambient** (0.46, 0.57, 0.71).
Dieser Warm/Kalt-Kontrast erzeugt im Original die Tiefe — sichtbar wird er aber nur dort, wo
Schatten die Sonne wegnimmt. Ohne Schatten sieht man überall nur die Mischung: eine
Einheitsfarbe. Das erklärt die halbierte Tonwertstreuung.

### Ursache C — die Grastextur ist eine Eigenerfindung mit 6-facher Deckung

`assets/textures/grass_meadows_gen.png` ist **selbst generiert**
(`tools/gen-grass-texture.py`), nicht extrahiert. Gegen die echte Vanilla-Maske:

| | unsere (im Einsatz) | Vanilla-Original |
|---|---|---|
| Auflösung | 256² | 128² |
| Alpha-Deckung | **60,6 %** | **9,5 %** |
| Farbe | RGB(82,123,46) **fest eingebrannt** | **weiß** — zur Laufzeit getönt |
| Halmform | dicke, harte Rechteckbalken | dünne, einzelne Striche |

Sechsfache Deckung ⇒ geschlossener Teppich statt Halme mit Durchblick; eingebrannte,
blauarme Farbe statt Tönung über die Terrainfarbe.

**Warum der Originalpfad bisher scheiterte — und warum die Begründung falsch war.**
`Docs/03` notiert, der Original-Mechanismus sei gescheitert, weil *„`clutter_default.glb`
auf den 256²-Atlas ausgelegt ist"* und es *„die zum Original passende Clutter-Geometrie"*
brauche. **Das trifft nicht zu.** Der UV-Dump zeigt: `clutter_default.glb` und die
Original-Geometrie `assetripper/export/Assets/PrefabHierarchyObject/grasscross.glb` haben ein
**identisches UV-Layout** (drei Spalten u 0.01–0.37 / 0.37–0.66 / 0.66–0.97, v 0.03–0.99,
je 48 Vertices). Es *ist* bereits die Originalgeometrie.

*(Nachtrag 2026-08-16: Der Rip-Pfad existiert nicht mehr. Beide Meshes — `clutter_default`
und `grasscross` — kommen heute aus `tools/clutter-meshes.py` und liegen unter
`assets/models/`. Das UV-Layout ist dabei die erhaltene Größe: Es ist der Vertrag zwischen
Mesh und Atlas, und deshalb steht es im Kopf des Werkzeugs. Der Befund oben bleibt damit
gültig — nur ist die Geometrie jetzt unsere eigene mit demselben Layout, statt der
Originalgeometrie.)*

Die tatsächliche Ursache ist ein **Alpha-Test-Mipmap-Problem**: Die Vanilla-Maske besteht aus
1–2 px dünnen Halmen. Beim automatischen Mipmapping mittelt sich deren Alpha gegen den
transparenten Hintergrund weg und fällt unter `alphaCutOff` (0.46) — die Halme lösen sich
schon wenige Meter vor der Kamera auf („zerfallen zu Schollen"). Unity löst das mit *„Mip
Maps Preserve Coverage"*; Babylon erzeugt Mipmaps ohne diese Korrektur, und
**Alpha-to-Coverage bietet Babylon im WebGL-Pfad nicht an**.

Die dicke Eigenbau-Textur war also eine **Kompensation des Mipmap-Problems**. Der richtige
Fix liegt in der Mip-Kette, nicht in dickeren Halmen.

### Ursache D — Nebel ist eine flache Farbschicht statt Atmosphäre

Der Zwei-Farben-Nebel des EnvSetup-Modells (`fogColor` weg von der Sonne, `fogColorSun` zu
ihr) wird **einmal pro Frame auf der CPU** gemischt (`Lighting.ts:294-305`) und als
szenenweites Uniform gesetzt — der Tint ist über das ganze Bild konstant. Zusätzlich ist der
Nebel rein distanzbasiert (`FOGMODE_EXP2`): es gibt keinen **Höhennebel**, also keinen Dunst
in Senken und über Wasser, der im Original die Tiefenstaffelung trägt.

### Ursache E — kein IBL, keine Ambient Occlusion, faktisch kein Antialiasing

- **Kein IBL**: `scene.environmentTexture` ist nirgends gesetzt. Deshalb musste
  `AssetManager.ts:223-230` alle PBR-Prefabs auf `metallic = 0` zwingen (sonst nachts
  schwarz). Bäume, Fels und Bauteile bekommen keinen Himmelsanteil von oben.
- **Kein SSAO**, obwohl das Original-Post-Profil es mit `intensity 1.0, radius 0.15` **an**
  hat — es fehlen alle Kontaktschatten an Grasfüßen, Steinauflagen, Terrainfalten.
- **MSAA wirkt nicht, selbst wenn man es setzt.** `pipeline.samples`
  (`postProcessRenderPipeline.js:162-175`) fasst nur den ersten PostProcess *der Pipeline*
  an; die Szene rendert aber in `ValheimDof.ts:219`, das sich mit
  `camera.attachPostProcess(pp, 0)` davorhängt. Es bleibt nur FXAA.

### Randbedingung — der faktische Zielpfad ist WebGL2, nicht WebGPU

Alle vier MaterialPlugins des Projekts sind GLSL-only:
`MaterialPluginBase.isCompatible()` (`materialPluginBase.js:17-24`) liefert für WGSL `false`,
und `Material._createUniformBuffer` schaltet Standard-/PBRMaterial unter WebGPU auf WGSL.
Unter WebGPU wirft daher `new ClutterWindPlugin(...)`, `GrassClutter.load()` fängt es ab —
**das Gras verschwindet**. `main.ts:91-106` bevorzugt aber WebGPU. Ein-Zeilen-Antwort, falls
WebGPU laufen soll: `Material.ForceGLSL = true`.

---

## Was bereits gut ist (nicht anfassen)

Das EnvSetup/EnvMan-Datenmodell (39 echte Wetter in `shared/src/envData.json`), die
Himmelskuppel mit `Horizont == scene.fogColor`, das Wasser mit der echten trochoidalen
Wellenformel, das Terrain-Splatting samt Gamma-Fix und Normal-Maps, der DOF-Nachbau.

---

## Umsetzung — priorisiert nach Optikgewinn je Aufwand

### Stufe 1 — Farbpipeline und Schatten (zusammen, ~5 h) — der Kern

Beide verschieben die Tonwerte; die Nachmessung lohnt nur einmal.

**1a — StandardMaterial-Gamma korrigieren.** Kleines `MaterialPluginBase`, das die
überzählige Konvertierung per Regex-Ersetzung entfernt (der Plugin-Manager unterstützt
`!`-Präfix-Keys, `materialPluginManager.js:322-352`, Callback läuft nach der
Include-Auflösung):

```ts
getCustomCode(shaderType) {
  if (shaderType !== 'fragment') return null;
  return { '!color\\.rgb=toLinearSpace\\(color\\.rgb\\);': '' };
}
```

Anhängen über `scene.onNewMaterialAddedObservable` — genau der Mechanismus, den
`Lighting.bindeLinearenNebel()` (`Lighting.ts:194-203`) bereits benutzt. Muss **vor**
`main.ts:500` (`blockMaterialDirtyMechanism = true`) laufen.
Nachziehen: `emissiveColor`-Sockel `GrassClutter.ts:521` (0.0011 ist ein Gamma-Ableger, wird
~4× zu hell → auf ~0.0003 oder streichen); Wasser und Avatar einmal nachmessen.

**1b — Schatten reparieren.** Unterklasse in `TerrainSplat.ts` statt
`new LightBlock('sonnenSchatten')` (Zeile 930), die das fehlende Define nachträgt:

```ts
class SonnenSchattenBlock extends LightBlock {
  prepareDefines(defines, nodeMaterial, mesh) {
    if (!mesh || !defines._areLightsDirty) return;
    super.prepareDefines(defines, nodeMaterial, mesh);
    // Babylon setzt SHADOWS/SHADOWFLOAT nur im Mehrlicht-Zweig — ohne sie
    // wird shadowsFragmentFunctions komplett wegpräprozessiert.
    const neu = defines['SHADOWS'] === undefined;
    const caps = mesh.getScene().getEngine().getCaps();
    defines['SHADOWS'] = !!defines['SHADOW0'];
    defines['SHADOWFLOAT'] = !!defines['SHADOW0'] &&
      ((caps.textureFloatRender && caps.textureFloatLinearFiltering) ||
       (caps.textureHalfFloatRender && caps.textureHalfFloatLinearFiltering));
    if (neu) defines.rebuild();   // sonst landen die Keys nicht in toString()
  }
}
```
Danach funktionieren PCF/PCSS/Poisson im NodeMaterial → `usePercentageCloserFiltering = true`,
`filteringQuality = QUALITY_MEDIUM` (`Shadows.ts:200-239`), statt der heutigen harten Kanten.

**1c — zwei weitere Fehler in `Shadows.ts`, die vorher weg müssen.**
- `nimmAuf()` (Zeile 173-183) koppelt *Empfangen* an *Werfen*: `if (!cfg ||
  !this.darfWerfen(mesh, cfg)) return;`. Eine Terrain-Zone, die beim Entstehen jenseits der
  Kaskadendistanz liegt, bekommt nie `receiveShadows = true`, und `werferNeuBestimmen()`
  (Zeile 163-171) setzt nur die `renderList` neu. Empfangen muss unabhängig gesetzt werden.
- **Gras: empfangen JA, werfen NEIN.** `AUSGENOMMEN` (Zeile 76) sperrt `clutter*` für beides.
  Gras im Waldschatten ist ein Kernstück von Valheims Optik und kostet nur eine zusätzliche
  Abtastung pro Fragment; Werfen bleibt gesperrt (jede Kaskade rendert die volle Werferliste).

**1d — Default setzen.** `Settings.ts:119` auf `shadowQuality: 2` (Original-Default,
3 Kaskaden / 1024 px) und den Begründungskommentar (Zeile 104-118) ersetzen.

#### Stufe 1 — Ergebnis (umgesetzt 2026-08-01)

A/B mit `node tools/pw-grafik-messung.mjs` (offline, Seed fix, t=0.5, Bodenregion
`300 700 1600 950`), jeweils derselbe Lauf mit und ohne die beiden Eingriffe:

| | vorher | nachher |
|---|---|---|
| RGB | (32.7, 68.4, **1.2**) | (89.8, 132.4, **32.4**) |
| Sättigung | **98,3 %** | **75,6 %** |
| Luminanz | 55.9 | 116.1 |
| Pixel über 128 | **0,0 %** | **17,7 %** |

Der Blaukanal war auf **1.2** zerquetscht und steigt auf 32.4 — die doppelte
Gamma-Kodierung ist damit belegt und behoben. Shader übersetzen fehlerfrei (auch mit PCF),
alle 111 Terrain- und 84 Clutter-Meshes empfangen (`aus=0`).

**Schattenwirkung direkt nachgewiesen**, nicht nur die Absicht: dieselbe Szene mit
`shadows.setLevel(3)` und `setLevel(0)` gelesen und pixelweise verglichen — mittlere
Abweichung **5,62**, größte Einzelabweichung **156** von 255.

#### Nachtrag 2026-08-02 — der Boden empfängt doch (noch) nicht

Im Spiel zeigte sich, was die Headless-Messung nicht auffing: Mit eingeschaltetem
Terrain-Schattenempfang **verschwindet das Terrain vollständig** — Gras schwebt über blankem
Himmel. Ursache ist ein dritter, von den beiden Define-Fehlern unabhängiger Konflikt:

```
GL_INVALID_OPERATION: glDrawElements:
Two textures of different types use the same sampler location
```

**Es war kein Mengenproblem.** Die Textureinheiten wurden am fertigen GL-Programm per
`gl.getUniform` ausgelesen:

```
Unit  0: tb_lTexture(sampler2D), shadowTexture0(sampler2DArray)   ⚠ KOLLISION
Unit  1: tb_l1Texture …                                (Unit 5 blieb frei)
```

Von 32 Einheiten waren nur 21 belegt. `shadowTexture0` bekam schlicht **nie eine eigene
Einheit** und blieb auf dem Default 0. Ursache ist — zum dritten Mal — derselbe
Einzellicht-Zweig: `LightBlock._injectVertexCode` trägt den Block nur bei `!this.light` in
`sharedData.dynamicUniformBlocks` ein, und ausschließlich über diese Liste ruft
`NodeMaterial` (`nodeMaterial.js:1126`) `updateUniformsAndSamples()` auf — erst das meldet
`shadowTexture{X}` als Sampler an (`materialHelper.functions.js:1142`).

Damit ist auch der alte Projektvermerk *„PCF zerlegt das Terrain-Material"* endgültig
geklärt: PCF war nie die Ursache, es machte den Konflikt nur sichtbarer (zusätzlicher
Vergleichssampler `sampler2DArrayShadow`).

#### Der vierte Fehler — und er lag bei uns

Nach den drei Babylon-Korrekturen übersetzte der Shader sauber, aber der Schatten kam
trotzdem nicht am Boden an. Die Ursache zeigte sich als **Nichtdeterminismus**: Zweimal
derselbe Startvorgang gemessen, einmal stand `computeShadowCSM` im Fragment-Shader, einmal
nicht.

Es ist ein **Wettlauf**. Ob das Terrain-Material mit Schattencode kompiliert wird, hängt
davon ab, ob der erste Terrain-Chunk vor oder nach dem `ShadowGenerator` entsteht. Babylon
würde das selbst korrigieren — ein neuer Generator ruft `light._markMeshesAsLightDirty()` —
aber `main.ts` setzt `scene.blockMaterialDirtyMechanism = true`, und `markAsDirty` steigt
dann **sofort wieder aus** (`material.js:1151`). Das Material bleibt für immer in der
Fassung, die es beim allerersten Chunk bekam.

Behoben in `Shadows.nodeMaterialsNeuUebersetzen()`: Nach dem Anlegen des Generators werden
gezielt die NodeMaterials neu übersetzt, wobei die Blockade für genau diese Zeilen aufgehoben
wird. Ein erster Anlauf ohne dieses Aufheben war wirkungslos — was erst die Messung zeigte.

**Verifiziert:** Der Schlagschatten des Spielers liegt sichtbar auf dem Boden, auch bei
Grasdichte 0 — es ist also wirklich das Terrain und nicht das Clutter darüber. Im Spiel auf
echter GPU bestätigt.

⚠️ **Methodenlehre:** Die Prüfung „steht `computeShadowCSM` im Fragment-Quelltext?" über
`material.getEffect()` ist hierfür **kein taugliches Maß**. Sie meldete `false`, während der
Schatten im Bild klar sichtbar war — nach dem Neuübersetzen greift der Getter offenbar einen
anderen Effekt ab. Dieselbe Falle wie bei der UV-Rotation in `Docs/03` §3.4: Die Metrik sagte
etwas anderes als das Bild, und das Bild hatte recht.

**Stand jetzt:** Schatten sind an (`shadowQuality: 2`, ohne PCF). Boden, Gras, Bäume, Felsen,
Bauteile und Spieler empfangen; Gras und die üblichen Ausnahmen werfen nicht.

⚠️ **Offener Punkt, den Stufe 1 sichtbar macht:** Das Bild ist jetzt rund doppelt so hell
(Luminanz 56 → 116). Das ist die rechnerisch richtige Folge — vorher wurde der lineare Wert
direkt als sRGB angezeigt. Aber `MEADOWS_TINT` (`GrassClutter.ts`), der emissive Sockel und
die Wasserwerte wurden auf die *fehlerhafte* Kette abgestimmt; der Tint mit B=2.192
kompensierte gerade den zerquetschten Blaukanal. Mit 75,6 % Sättigung liegt der Boden
weiterhin weit über den 31 % des Originals. **Stufe 3 ist damit nicht optional, sondern die
notwendige Ergänzung zu Stufe 1** — erst der Originalpfad (weiße Maske × Terrainfarbe)
liefert wieder stimmige Werte. Bis dahin wirkt die Wiese heller und greller als vorher.

### Stufe 2 — MSAA ✅ (umgesetzt 2026-08-16)

`PostProcessing.setzeMsaa()` legt am Ende von `apply()` 4×MSAA auf den **tatsächlich
ersten** PostProcess der Kamera und setzt alle übrigen ausdrücklich auf 1 zurück.
Gekoppelt an den vorhandenen Schalter „Kantenglättung", zusammen mit FXAA: MSAA glättet
Dreieckskanten, FXAA sieht auch die Alpha-Test-Kanten von Gras und Laub.

**Warum nicht `pipeline.samples`, wie hier ursprünglich stand.** Das Rezept lautete
„`dof.pp.samples = 4` wenn DOF an, sonst `pipeline.samples = 4`". Der erste Teil stimmt,
der zweite ist eine Falle: `DefaultRenderingPipeline.samples` trifft über
`_enableMSAAOnFirstPostProcess` nur den ersten Pass **dieser Pipeline** — nicht den ersten
der Kamera. Wirksam ist MSAA aber ausschließlich dort, wo die Szene rasterisiert wird, und
das ist der Kopf der gesamten Kette. Zur Laufzeit nachgesehen sah die Kette so aus:

```
valheimDof, null ×11, highlights, horizontal blur, vertical blur,
bloomMerge, imageProcessing, ChromaticAberration, fxaa, valheimMotionBlur
```

Die elf Lücken stammen vom Ab- und Wiederanhängen der Pipeline-Pässe bei jedem Umschalten.
Wer die Reihenfolge annimmt statt sie zu lesen, trifft früher oder später den falschen Pass —
deshalb läuft die Zuweisung über eine Schleife über `camera._postProcesses`.

**Gemessen** auf einer RX 7900 XT über den Dev-Client, nur `samples` umgeschaltet, Uhrzeit
angehalten, alles andere unverändert (`mess/msaa-probe.mjs`-Muster, 4 Bilder je Durchgang,
1600×900):

| | ohne | mit 4× | Gegenprobe ohne |
|---|---|---|---|
| Anteil harter Helligkeitssprünge (>40) zwischen Nachbarpixeln | 0,0300 % | **0,0277 %** | 0,0354 % |
| mittlere Nachbardifferenz | 1,492 | **1,422** | 1,462 |

Also −15,3 % harte Kanten gegenüber dem Mittel der beiden MSAA-freien Läufe. Die Gegenprobe
zurück auf `samples = 1` landet wieder auf Ausgangsniveau — der Unterschied ist reproduzierbar
und kein Rauschen. Kein GL-Fehler; die halb-float-Zieltextur der Tiefenunschärfe nimmt die
Mehrfachabtastung anstandslos an.

### Stufe 3 — der HD-Umweg ist zurückgenommen (2026-08-16), die Aufgabe ist wieder offen

Am 2026-08-02 stand hier „ERLEDIGT über den HD-Pfad statt über den Originalpfad". Das gilt
nicht mehr: **`hdClutter` und die HD-Mod-Texturen sind restlos entfernt** — Schalter,
Konstanten, Aufbereitungswerkzeuge und der Rückfallmechanismus `hdFehlt`
(`GrassClutter.ts`, `ui/Settings.ts`, `ui/SettingsPanel.ts`, `main.ts`; siehe
[03-Rendering-und-Engine.md](03-Rendering-und-Engine.md) 4.1). Zwei Gründe:

- Es war Fremdmaterial, das wir laut eigenem Codekommentar nicht ausliefern durften — der
  Live-Server tat es unter `/assets/textures/hd-clutter/` trotzdem. Die Vorgabe oben
  (*streng originalgetreu, kein HD-Mod-Material*) stand von Anfang an dagegen; die
  Entscheidung von 08-02 war ein Verstoß dagegen, nicht eine Ausnahme davon.
- Der Schalter war eine Quelltextkonstante, die auf dev und live verschieden stehen
  **musste** (das Paket lag nur dort, wo es jemand gebaut hatte) — und damit einer der
  Gründe, warum die Bäume nach jedem Abgleich auseinanderliefen.

**Die Messung, die zu dem Umweg geführt hat, bleibt gültig** — sie ist der Grund, warum
Stufe 3 jetzt wieder ansteht:

| | Deckung | Sättigung |
|---|---|---|
| `grass_meadows_gen` (heutiger und einziger Stand) | 61 % | **62 %** |
| `grasscross_meadows` (HD-Pack, entfernt) | 32 % | **30 %** |
| Valheim-Original (Screenshot, Boden) | — | **31 %** |

Die selbst generierte Karte verfehlt den Originalwert um das Doppelte; die Wiese wirkt
damit wieder so grell, wie Stufe 1 es beschreibt. Die Antwort darauf ist nicht ein
fremdes Texturpaket, sondern der Originalmechanismus (weiße Maske × `grass_terrain_color`)
plus coverage-erhaltende Mipmaps — die Schritte darunter. Ein eigener, dünner gedeckter
Wiesen-Atlas aus `tools/gen-grass-texture.py` ist der kleinere Zwischenschritt, wenn das
Ganze nicht in einem Zug zu haben ist.

📌 **Ein Befund aus dem HD-Pfad ist trotzdem zu behalten**, weil er für unsere eigenen
Texturwerkzeuge genauso gilt: Cutout-Texturen darf man nicht über einen
**uint8**-Zwischenschritt verkleinern. Bei dünnen Halmen ist `rgb × alpha` winzig (bei
α = 0.02 landet ein Grün von 0.4 als ≈ 2 im Byte); die anschließende Division durch
dasselbe kleine Alpha multipliziert den Quantisierungsfehler wieder hoch.

| | halbtransparente Ränder | sichtbare Halme |
|---|---|---|
| Quelle 2048² | RGB(73, 104, 72) | RGB(70, 98, 68) |
| verkleinert über uint8 | RGB(**109, 144, 107**) | RGB(72, 101, 70) |
| verkleinert in 32-bit-Float | RGB(**74, 105, 73**) | RGB(70, 98, 68) |

23 % aller Pixel sind halbtransparent, und der Alpha-Cutout zeichnet sie als volle Pixel —
daher ein sichtbar ausgebleichter Teppich. Zweitens gehört in vollständig transparente
Pixel die mittlere Motivfarbe, nicht Weiß: „die Farbe ist dort beliebig" gilt nur, solange
niemand sie mittelt — genau das tut die GPU beim Mipmapping.

*(Der ursprüngliche Plan, jetzt wieder der einzige:)*

### Stufe 3 — Zwischenschritt gegangen (17.08.2026), Ziel noch nicht erreicht

Der eigene Atlas ist neu abgestimmt — der „kleinere Zwischenschritt", den der Abschnitt
darüber selbst nennt. Gemessen im laufenden Bild, **feste Weltposition, feste Uhrzeit**,
nur die drei PNG getauscht:

| | alter Atlas | neuer Atlas | Ziel (Original) |
|---|---|---|---|
| Bodensättigung | **73,3 %** (73,2 / 73,3) | **~47 %** (45,2 / 47,5 / 48,7) | 31 % |
| Boden RGB | (44,6 / 56,5 / **15,1**) | (29 / 41 / **22**) | (40 / 42 / 35) |
| Alpha-Deckung des Atlas | 0,60 | **0,40** | 0,095 (Vanilla-Maske) |

Geändert wurden zwei Größen in `tools/gen-grass-texture.py`: die Halmfarben (Blau/Grün von
0,34 auf 0,62 angehoben) und die Deckung (26 statt 42 Halme je Spalte, Breite 2,0–3,6 statt
3,0–5,5 px). **Der zerquetschte Blaukanal ist damit weg** — er war der auffälligste Einzelwert
der ganzen Diagnose.

**Das Ziel von 31 % ist nicht erreicht, und das ist keine Frage der Feinabstimmung.** Der Rest
steckt im Verfahren: Solange die Farbe in die Textur EINGEBACKEN ist, kann sie sich nicht nach
dem Boden richten. Der Originalmechanismus ist eine nahezu weiße Maske mal
`grass_terrain_color` (`terrainTint`) — dann bestimmt der Boden die Farbe des Grases und nicht
umgekehrt. Das ist der noch offene Teil dieser Stufe, zusammen mit den coverage-erhaltenden
Mipmaps.

> [!warning] Methodenfehler, der beim Messen aufgefallen ist
> Die ersten Vergleiche liefen über **getrennte Browsersitzungen** — und damit über
> verschiedene Spawnpunkte. Zwei Läufe desselben Standes lagen so 14 Prozentpunkte
> auseinander. Erst mit fest gesetzter Weltposition (`-16889, -5345`) wurde die Zahl
> reproduzierbar: der alte Atlas misst 73,2 / 73,3 %.
>
> Der neue Atlas streut trotzdem noch (45–49 %), und auch das ist ein Befund: Bei dünner
> Deckung hängt das Verhältnis Gras zu Boden davon ab, wie weit der Clutter aufgebaut ist.
> Bei dichter Deckung fiel das nicht auf, weil dort ohnehin alles zugewachsen war.

Heide- und Sumpfatlas sind nach derselben Überlegung mitgezogen, aber **nicht einzeln
gemessen** — sie tragen im Original erdigere Töne, und die Änderung ist dort kleiner.

*(Der ursprüngliche Plan, weiterhin offen:)*

### Stufe 3 (Originalpfad) — steht wieder an

1. **Coverage-erhaltende Mipmaps** als neues Werkzeug (`tools/gen-coverage-mips.mjs`,
   `sharp` ist bereits devDependency): Mip-Kette selbst erzeugen und den Alpha je Level so
   nachskalieren, dass die Deckung nach `alphaCutOff` konstant bleibt. Einbinden über
   `RawTexture` mit manuell gefüllten Levels. **Das ist die Voraussetzung dafür, dass die
   Vanilla-Masken überhaupt tragen** — ohne sie wiederholt sich der „Schollen"-Effekt.
2. `grass_meadows_gen` / `grass_heath_gen` / `grass_toon1_yellow_gen` in
   `GrassClutter.ts:192-203` durch die Vanilla-Masken `grass_meadows.png`,
   `grass_meadows_short.png` usw. ersetzen.
3. `terrainTint: true` setzen und `grass_terrain_color.png` (liegt geladen, aber ungenutzt
   herum) anwenden; `MEADOWS_TINT` (Zeile 184) entfällt — das ist der Originalmechanismus
   (weiße Maske × Terrainfarbe).
4. **Slotweise umstellen und einzeln im Bild prüfen**, nicht alle zwölf auf einmal.

⚠️ **Schritt 2 ist so nicht mehr ausführbar** (Stand 2026-08-16): `grass_meadows.png` und
die übrigen Vanilla-Masken liegen nicht unter `assets/textures/` — dort stehen ausschließlich
die 66 selbst erzeugten Karten. Seit der Rücknahme des HD-Pfads gilt für den Bewuchs
ohnehin: **eigene Modelle und Texturen, sonst nichts.** Der Schritt heißt damit nicht mehr
„extrahierte Maske einsetzen", sondern *„`tools/gen-grass-texture.py` eine weiße Maske mit
~15 % Deckung erzeugen lassen"* — das ist dieselbe Physik (Maske × Terrainfarbe) und dabei
frei von fremdem Material. Die UV-Belegung von `clutter_default.glb` muss dabei mitgezogen
werden; daran scheiterte der Versuch vom 2026-07-29 (siehe `MEADOWS_TINT` in
`GrassClutter.ts`).

### Stufe 4a — Nebel pro Pixel ✅ (umgesetzt 2026-08-16) · 4b Höhennebel offen

Umgesetzt als `engine/NebelRichtung.ts`, ein gemeinsames `MaterialPluginBase` für Standard
**und** PBR. `Lighting` liefert seitdem BEIDE Nebelfarben plus die Sonnenrichtung aus, und
`scene.fogColor` trägt die **ungemischte** Farbe (Blick von der Sonne weg);
`Lighting.directionalFogColorToRef()` ist ersatzlos entfallen, samt dem `Ray`, den es je
Frame anlegte. Der Exponent (2,5) ist unverändert übernommen — der Umbau verschiebt den Ort
der Rechnung, nicht die Abstimmung.

**Drei Abweichungen vom Rezept oben, jede aus einem konkreten Fehlschlag:**

**1. Die Rückreferenz `\1` trägt nicht.** Der Manager ersetzt `$1` im Ersatzcode nur beim
ERSTEN Vorkommen (`materialPluginManager.js`: `newCode.replace("$" + i, match[i])`, ohne
`g`); gebraucht wird der Name aber zweimal. Stattdessen zwei ausdrückliche Regeln für `color`
(default.fragment) und `finalColor` (pbr.fragment). Das ist nicht bloß Formsache: Der erste
Anlauf mit einem Regex auf `color.rgb=…` traf **nur StandardMaterial**. Der Uniform stand im
PBR-Shader, die Mischung fehlte — Bäume, Felsen und Gebäude behielten den flachen Nebel,
während Boden und Gras den gerichteten bekamen. Aufgefallen ist das erst beim Auslesen des
übersetzten Shaders, weil beide Töne derselben Farbfamilie angehören.

Grund für die Namen: `fogFragment` wird über Include-mit-Parametern eingebunden
(`#include<fogFragment>(color,finalColor)`), und Babylon tauscht den Bezeichner beim
Auflösen. Es gibt vier Varianten im Baum — dazu noch `baseColor` (background) und
`gl_FragColor` (particles/sprites), die dieses Plugin nicht berührt.

**2. Blickrichtung aus `vFogDistance` statt aus `vPositionW` + `vEyePosition`.** `fogVertex`
legt ohnehin `vFogDistance = (view * worldPos).xyz` an — den Vektor vom Auge zum Fragment im
Sichtraum. Er existiert überall dort, wo `FOG` definiert ist, also überall dort, wo die
Ersetzung greift, und spart ein Varying. `vPositionW` wird dagegen nur unter Bedingungen
deklariert und fehlt ausgerechnet bei den einfachsten Materialien. Preis: Die Sonnenrichtung
muss im Sichtraum ankommen — `Lighting` dreht sie einmal je Frame über
`kamera.getViewMatrix()`. **Nicht** über `scene.getViewMatrix()`: Die Szene reicht nur den
zuletzt berechneten Wert durch, und der entsteht erst mitten in `scene.render()` — in einem
`onBeforeRender`-Beobachter ist er im ersten Frame noch gar nicht da, was den Client beim
Start zerlegt hat.

**3. Terrain über einen `CustomBlock`, nicht über `LerpBlock`.** Die Kette dort rechnet in
Weltkoordinaten (`worldPos − cameraPos` liegt für die Distanz schon bereit), also bekommt sie
den Weltvektor statt des Sichtraumvektors. Als Blockgraph wären es fünf Blöcke
(Normalize/Dot/Max/Pow/Lerp) quer über die Datei; als `CustomBlock` steht die Formel an einer
Stelle — und sie muss mit den beiden anderen Pfaden zusammenpassen, sonst zeigt der Boden
einen anderen Sonnenton als der Baum darauf. Deshalb importiert `TerrainSplat.ts` den
Exponenten aus `NebelRichtung.ts`, statt ihn zu wiederholen.

**Nachgewiesen** über den übersetzten Shader und eine Messung (beides in einem Lauf,
`mess/`-Muster, RX 7900 XT):

| Pfad | Uniform im Shader | Mischung im Shader |
|---|---|---|
| StandardMaterial | ja | ja |
| PBR | ja | ja |
| Terrain-NodeMaterial | ja | ja |

Für den Verlauf selbst wurde **ausschließlich die Nebel-Sonnenrichtung um 180° gekippt** —
Kamera, Geometrie, Uhrzeit und `sun.direction` blieben unangetastet, die Beleuchtung ist also
Pixel für Pixel dieselbe. Wärmeprofil (R−B) über acht Spalten der Bildbreite:

```
normal     15.29    4.18   11.55    7.98   12.12    9.11    9.12    2.93
gekippt    15.28    4.31   12.45   12.25   13.57   11.04   14.23   14.78
```

Das Gefälle links−rechts dreht sich von **+1,43 auf −2,33**, die Spannweite über die Breite
beträgt 12,4 — bei einem Blend pro Frame wäre sie null und beide Bildhälften änderten sich
gleichsinnig. Dass die beiden linken Spalten praktisch unverändert bleiben (15,29 → 15,28),
ist die Gegenprobe im selben Bild: Dort steht Nahbereich, in dem kaum Nebel liegt.

**Offen bleibt 4b, der Höhennebel** — analytisch integriert über `vPositionW.y`, damit der
Dunst in Senken und über Wasser steht statt auf Bergkuppen. Er braucht dieselbe Zeile und
denselben Injektionspunkt, ist aber eine eigene Entscheidung über die Bildsprache und nicht
bloß der Umzug einer vorhandenen Rechnung.

Zwei Pfade blieben bewusst unberührt: **Wasser** injiziert bereits bei
`CUSTOM_FRAGMENT_BEFORE_FOG` (`WaterPlugin.ts`) und läuft als StandardMaterial ohnehin über
das neue Plugin mit; die **Himmelskuppel** bleibt nebelfrei, weil sie *der* Horizont ist —
und sie malte ihren Sonnenschein als einzige schon immer pro Pixel. Genau deshalb war der
flache Nebel davor sichtbar falsch.

### Stufe 5 — IBL aus der vorhandenen Sky-Probe ✅ (umgesetzt 2026-08-16)

Umgesetzt wie unten beschrieben. Die Probe hängt als `scene.environmentTexture`; alle drei
PBR-Shadervarianten der laufenden Szene tragen `REFLECTION`, `REFLECTIONMAP_CUBIC`,
`USESPHERICALFROMREFLECTIONMAP` und `SPHERICAL_HARMONICS` — nachgesehen im übersetzten
Shader, nicht angenommen.

**Ein Fallstrick kam dazu, den das Rezept nicht kannte:** `BaseTexture.sphericalPolynomial`
ist eine **Modul-Erweiterung**. Bei den granularen Imports dieses Projekts existiert der
Setter nur, wenn `@babylonjs/core/Materials/Textures/baseTexture.polynomial` als
Seiteneffekt geladen wurde — sonst geht die Zuweisung still ins Leere. Dieselbe Klasse wie
der fehlende PrePass-Scene-Component beim Motion Blur.

Die Kugelharmonischen kommen wie vorgeschlagen aus der CPU-Fassung von `SKY_GRADIENT_GLSL`
(128 Richtungen auf einer Fibonacci-Kugel, alle zwei Sekunden, rund eine halbe
Millisekunde), nicht aus einem Rücklesen der Würfelkarte. Damit stammen Kuppel, Spiegelung,
Nebel und Grundlicht aus **einer** Quelle.

> [!warning] Die Gegenrechnung beim Grundlicht ist noch nicht fertig
> `HemisphericLight.intensity` steht jetzt auf 0,5, damit das Grundlicht nicht doppelt
> zählt. Gemessen (gleiche Kamera, gleiche Uhrzeit, nur diese Änderung an und aus):
>
> | | mittlere Helligkeit | Streuung |
> |---|---|---|
> | Tag (t = 0.30) | 56,5 → **54,7** (−3 %) | 13,7 → 12,6 |
> | Nacht | 20,5 → **15,2** (−26 %) | 7,4 → 5,3 |
>
> **Bei Tag geht die Rechnung auf, nachts nicht.** Was die Kuppel liefert, skaliert mit
> ihrer Helligkeit; der Abzug ist fest. Nachts wird also etwas weggenommen, das nicht
> ersetzt wird. Ob das stört, ist Geschmackssache mit Vorgeschichte: „der Boden wird im
> Dunkeln nicht dunkel" steht in [03](03-Rendering-und-Engine.md) als Mangel — die Änderung
> geht in diese Richtung. Die Streuung sinkt aber mit, und Streuung ist Tiefe.
>
> Zwei saubere Wege stehen offen, beide in `Lighting.AMBIENT_ANTEIL_HIMMEL` beschrieben:
> den Abzug an die Kuppelhelligkeit koppeln, oder PBR-Meshes aus dem HemisphericLight
> ausschliessen, damit jedes Material genau eine Grundlichtquelle hat.

*(Das ursprüngliche Rezept, unverändert — es hat getragen:)*

### Stufe 5 — IBL aus der vorhandenen Sky-Probe (~4 h)

Die Probe existiert bereits (`ValheimSky.ts:314-317`, 128², Refresh alle 15 Frames, für das
Wasser) — die Renderkosten laufen also schon heute. Zwei Änderungen an der Konstruktion:
`useFloat: true` (erhält Werte > 1, ~0,8 MB) und `linearSpace: true` (sonst linearisiert PBR
die bereits lineare Himmelsfarbe ein zweites Mal — derselbe Fehlertyp wie Ursache A).

Für den **diffusen** Anteil braucht PBR `sphericalPolynomial`. Der Getter würde die Textur
zurücklesen (teuer), **der Setter existiert aber ebenfalls** — also die Kugelharmonischen
analytisch aus dem EnvSetup rechnen (~128 fibonacci-verteilte Richtungen, ~0,5 ms alle paar
Sekunden) und setzen. `SKY_GRADIENT_GLSL` ist in `ValheimSky.ts` bereits als eigenständige
Funktion gekapselt; die CPU-Portierung sind ein Dutzend Zeilen und garantiert, dass IBL,
Kuppel, Wasser und Nebel dieselbe Quelle haben.

Danach `HemisphericLight.intensity` (`Lighting.ts:266`, fest 1) herunternehmen, sonst zählt
das Grundlicht doppelt. Nebenwirkung, die man will: `AssetManager.setzeMetallgrad()` kann
`METALLISCH` wieder echt metallisch machen (Erz, Waffen, Amboss).

### Stufe 6 — Normal-Maps auf die Prefab-Materialien (~3 h)

**`roughness = 1` ist kein Fehler** — die Flachheit kommt davon, dass **keine Normal-Map
gebunden ist**. Diese Ursachenzuschreibung gilt weiter und ist der Kern dieser Stufe.
(Der Beleg von damals: 725 von 1454 Originalmaterialien hatten `_Glossiness = 0`, eigene
Auswertung in `AssetManager.ts`. Rau war also die Absicht des Originals, nicht unser
Versehen — für unsere eigenen Materialien gilt dieselbe Wahl, jetzt aus eigenem Entschluss.)

⚠️ **Der beschriebene Weg dorthin gilt nicht mehr (16.08.2026).** Hier stand: Zuordnung
über den Materialnamen, weil die GLB-Materialnamen die Unity-Namen *sind*; 161 direkte
`<name>_n.png`-Treffer in `assets/textures/`, darunter alle bildfüllenden (`beech_leaf`,
`beech_bark`, `oak_bark`, `birch_bark`, `Bush01`), plus eine Alias-Tabelle von ~20
Einträgen für den Rest. Diese Rechnung stand auf dem AssetRipper-Export. In
`assets/textures/` liegen heute 66 Dateien, sämtlich selbst erzeugt, und die einzigen
`_n`-Karten darunter (`forest_n`, `cultivated_n`, `paved_n`, `gouacherock_big_n`,
`snow_normal`) gehören dem Terrain. Für `eiche_bark`, `hasel_leaf`, `granit_fels` und die
übrigen eigenen Materialien existiert **keine** Normal-Map, also auch nichts zuzuordnen.

**Was an die Stelle tritt:** Die Normal-Maps müssen dort entstehen, wo auch die Albedo
entsteht — in `tools/eiche-texturen.py`, `busch-texturen.py`, `felsen-texturen.py`,
`blumen-texturen.py`. Das ist eher mehr Arbeit als die drei Stunden hier, aber es ist
derselbe Weg, den `terrain-texturen.py` für den Boden bereits gegangen ist: Die Karte wird
aus derselben Höhenfunktion gerechnet, aus der die Farbe kommt, statt sie zu einer fremden
Bilddatei zu suchen. Der Zuordnungsteil entfällt damit ersatzlos.

⚠️ **Zwei Sätze dieser Stufe sind am 16.08.2026 nachgemessen worden, einer davon fällt.**
Über alle 122 GLBs in `assets/models` gezählt:

| | |
|---|---|
| GLBs mit `TANGENT`-Attribut | **0 von 122** |
| GLBs mit `normalTexture` im Material | **12 von 122** |

**„Die GLBs führen `TANGENT`" gilt nicht mehr** — das war eine Eigenschaft der
Unity-Exporte. Unsere Werkzeuge schreiben Position, Normale und UV, sonst nichts. Das ist
kein Hindernis: Babylon baut ohne Tangenten pro Pixel eine Kotangenten-Basis aus den
Ableitungen von Weltposition und UV (`bumpFragmentMainFunctions`) — genau derselbe
tangentenfreie Weg, den das Terrain schon geht (siehe G-TEX2 in
[03](03-Rendering-und-Engine.md)). Es ist also nichts nachzurüsten, aber die Begründung
„brauchen wir nicht, es ist ja da" trägt nicht mehr; sie muss „brauchen wir nicht, es geht
auch ohne" heißen.

**Zwölf Modelle haben ihre Normal-Map schon** — alle aus der Tripo-Erzeugung:
`Grabhuegel` (vier Materialien), `GrabMenhir`, `GrabRunenstein`, `GrabTruhe`,
`GrabDrachenkopf`, `KiPine2`, `KiPine3`, `Steinkreis`, `Surtr`, `Voelva`, `WikingerBasis`,
`WikingerStatue`. Sie kommen fertig aus dem Erzeuger und werden vom glTF-Lader ohne Zutun
gebunden. Damit ist diese Stufe kein Alles-oder-nichts mehr, sondern eine Lücke zwischen
zwei Erzeugungswegen: Was Tripo baut, hat eine Karte; was die eigenen Python-Werkzeuge
bauen, hat keine. **Der Vergleich der beiden im Bild ist der billigste nächste Schritt** —
er zeigt, was die Karte optisch überhaupt bringt, bevor zehn Werkzeuge umgebaut werden.

Was weiter gilt: Ort ist `AssetManager.fixupMaterial()`; und `useSRGBBuffer` gehört auf eine
Normal-Map **nie**. Der Fallstrick „teils DXT5nm-gepackt"
ist bei selbst gerechneten Karten keiner mehr — man wählt die Packung selbst (und schreibt
sie in den Kopf des Werkzeugs, wie `wasser-texturen.py` es für `water_normals_real.png`
tut).

### Stufe 7 — SSAO2 gebaut, aber wieder AUS (17.08.2026)

> [!warning] Aus dem Spiel gemeldet: „Die Umgebungsverdeckung erzeugt diese Schlieren"
> Die Voreinstellung stand einen Abend lang auf an. Sie ist wieder aus, und der Weg dorthin
> gehört aufgeschrieben, weil er ein Muster ist.
>
> Die Messung unten sagte **+3,5 % Tonwertstreuung** und nannte das einen Gewinn — die
> Streuung ist schließlich *die* Kennzahl der Diagnose ganz oben. Nur misst sie nicht
> Qualität, sondern Kontrast: **Ein Artefakt aus dunklen Schlieren erhöht sie genauso
> zuverlässig wie echte Tiefe in den Ritzen.** Die Zahl war richtig gerechnet und hat
> trotzdem das Gegenteil belegt.
>
> Dieselbe Lehre steht seit dem 16.08.2026 über dem FPS-Wächter (E3): Eine Messung sagt, ob
> Zahlen besser werden. Ob es besser *aussieht*, sagt nur das Spielen. Beim Wächter war es
> die Bildrate, hier die Streuung — beide Male hat die Zahl den Blick ersetzt statt ihn zu
> schärfen.
>
> **Was fehlt, bevor sie wiederkommen darf:** die Ursache der Schlieren. Verdächtig sind der
> Radius (0,15 stammt aus Unitys Einheiten und unserem Maßstab, nicht aus einer Messung an
> unserer Geometrie) und die halbe Auflösung über den dünnen Alpha-Test-Kanten von Laub und
> Gras — dort steht in der Tiefenpassage die Kante des **Rechtecks**, nicht die des Blattes.
> Der Code bleibt; es fehlt die Abstimmung, nicht die Mechanik.

### Stufe 7 — SSAO2, wie sie gebaut wurde (2026-08-16)

Umgesetzt mit allen vier Fallstricken unten; sie waren alle vier real und alle vier so
lösbar wie beschrieben. **Die Voreinstellung ist AN** — und das ist die eigentliche Änderung
gegenüber dem, was hier stand.

Der Effekt galt als „im Gesamtbild der schwächste Beitrag" und wurde wegen der zusätzlichen
Geometriepassage zurückgestellt. Die zweite Hälfte davon stimmt nicht mehr: Den
GeometryBufferRenderer teilt sich die Verdeckung mit Tiefen- und Bewegungsunschärfe, die
beide voreingestellt an sind — die Passage läuft ohnehin. Die erste Hälfte war nie gemessen.

Gemessen (RX 7900 XT, 1280×720, feste Kamera und Uhrzeit, **verschränkt in vier Wechseln**,
weil die ersten Läufe systematisch schneller werden und ein einfaches Vorher/Nachher diese
Drift mitmisst):

| | aus | an | |
|---|---|---|---|
| Frame-Zeit (Median) | 12,67 ms | 12,86 ms | **+1,5 %** |
| Rohwerte | 12,43…13,06 | 12,42…13,29 | überlappen sich |
| **Tonwertstreuung** | 14,85 | **15,37** | **+3,5 %** |
| mittlere Helligkeit | 54,65 | 54,30 | −0,6 % |

Die Streuung ist dabei keine beliebige Kennzahl, sondern **die** der Diagnose ganz oben:
Unser Bild hatte die halbe Streuung des Originals (9,6 gegen 14,6). Verdeckung in Ritzen ist
genau das, was sie erhöht. Ein Effekt, der ein diagnostiziertes Defizit angeht und dabei
unter 2 % kostet, gehört in die Voreinstellung — abschaltbar bleibt er über
„Umgebungsverdeckung" im Einstellungsmenü.

*(Die vier Fallstricke, unverändert — sie haben alle getragen:)*

Vier konkrete Fallstricke, alle lösbar:
1. `forceGeometryBuffer = true` ist Pflicht — der Default-Pfad ruft
   `scene.enablePrePassRenderer()`, die bei den granularen Imports fehlt (in
   `PostProcessing.ts:288-295` für MotionBlur schon dokumentiert). Kein zweiter Szenendurchlauf.
2. `textureType = TEXTURETYPE_HALF_FLOAT` (6. ctor-Parameter, default 8 Bit) — sonst clampt
   `SSAOOriginalSceneColor` das HDR-Bild vor dem Bloom auf LDR.
3. Die SSAO2-Pipeline **vor** `new DefaultRenderingPipeline(...)` (`PostProcessing.ts:132`)
   erzeugen, sonst läuft AO nach dem Tonemapping.
4. `syncGeometryBuffer()` (Zeile 192-195) erweitern, sonst reißt es SSAO mit, sobald DOF und
   MotionBlur aus sind.

Parameter nach dem Original-Profil: `radius 0.15`, `totalStrength 1.0`, `samples 10`,
`ratio 0.5`.

### Stufe 8 — Vegetationsvielfalt: erst messen, dann ändern (~1 h Diagnose)

⚠️ **Die Prämisse dieser Stufe hat sich am 16.08.2026 umgedreht.** Hier stand: *„Die
Datenlage ist bereits vollständig — `shared/src/vegetationData.json` enthält 120
Foliage-Einträge 1:1 aus `vegetation.pkg` (`Bush01`, `shrub_2`, `stubbe`, `FirTree_oldLog`,
`Pickable_*`, `Rock_3/4` …), alle zugehörigen GLBs liegen vor (Stichprobe 19/19). Der
Eindruck ‚nur ein Grasteppich' kommt daher vermutlich aus Sichtweite/LOD,
Serverstreaming-Radius oder dem `DefaultMaterial`-Filter — Diagnose zuerst, erst bei einer
echten Lücke Code ändern."*

Die Diagnose-vor-Änderung-Haltung bleibt richtig. Die Datenlage ist es nicht mehr:
`vegetationData.json` liegt unverändert im Quelltext, aber jeder Eintrag läuft in
`shared/src/vegetation.ts` gegen `istEigenesModell()`, und in `vegetation.pkg` steht
ausschließlich Valheim-Material. Der gesamte Block fällt heraus. **`FOLIAGE` ist heute
`shared/src/flora.ts`** — die eigene Streutabelle, nicht mehr ein Anhang an die
Original-Tabelle. Von 174 Roheinträgen bleiben 73 eigene.

Zwei Folgen, die man kennen muss:

- Es gibt **keine Biom-Standardtabelle** mehr. Eine Region ohne Kuratierungsliste bleibt
  kahl, und die radiale Welt aus `GeoManager` (ohne Layout) trägt überhaupt keinen Bewuchs.
  `server/test/e2-vegetation.ts` misst genau das.
- Ein Modell in einer `*_FLORA_NAMEN`-Liste einer Region reicht **nicht**: Ohne Eintrag in
  `EIGENE_FLORA` wird es nie gestreut. Dagegen steht `server/test/h4-graslandflora.ts`.

Die Frage „warum sieht der Wald nach einem Grasteppich aus?" beantwortet man deshalb heute
nicht mehr mit Instanzzahlen gegen `vegetationData.json`, sondern gegen `flora.ts` und die
Kuratierungsliste der Region.

#### Die Diagnose ist gelaufen (16.08.2026)

**Flora — kein einziger Totfall.** `tools/flora-zensus.ts` streut je Biom 13×13 Zonen einer
Testinsel und zählt die abgelegten ZDOs nach Art. Ergebnis: **0 Arten mit null Vorkommen**,
über alle vier gefüllten Bündel. Der Verdacht, der diese Stufe ausgelöst hat, gehörte zur
gelöschten Valheim-Tabelle und ist mit ihr verschwunden.

| Bündel | Arten | Pflanzen auf 13×13 Zonen |
|---|---|---|
| Grasland | 33 | 8.265 |
| Nadelwald | 28 | 12.198 |
| Sumpf | 14 | 4.100 |
| Hochnord | 9 | 2.176 |
| Asche | 0 | — (Bündel ist leer) |

Was die Messung stattdessen zeigt, ist eine **sehr weite Spreizung**: In jedem Bündel stehen
Arten mit ein bis sieben Vorkommen neben solchen mit über 2.000 (Grasland: `Eiche4` 1 gegen
`Margerite1`; Nadelwald: `Kiefer4` 1 gegen `Tanne4` 2.472). Das ist kein Fehler — die
Einträge mit `min/max 0/2` ziehen absichtlich oft die Null — aber es ist eine Aussage über
die Welt, die vorher niemand hatte: Rund ein Sechstel der Arten begegnet einem Spieler
faktisch nie. Ob das Seltenheit oder Verschwendung ist, gehört entschieden, nicht
weggerechnet.

**Clutter — der Farn-Verdacht stimmt, aber die Ursache liegt woanders.** Im laufenden Client
an einer Graslandregion der Dev-Welt erzeugen von 13 Einträgen genau **drei** Instanzen:
`meadowsGrassShort` (28.380), `meadowsGrass` (21.508), `meadowsShrub` (2.216).
`meadowsFern` ist nicht dabei.

Der Grund ist nicht `inForest`, sondern `maxAlt: 4.0` — vier Meter über der Wasserlinie.
`tools/hoehen-histogramm.ts` tastet die echte Dev-Welt in 8-m-Schritten ab:

| Band | Anteil der Landfläche |
|---|---|
| 0 – 4 m | **4,57 %** (2,94 km²) |
| 4 – 10 m | 1,41 % |
| 10 – 30 m | 28,07 % |
| 30 – 60 m | 30,43 % |
| 60 – 120 m | 27,43 % |
| über 120 m | 8,09 % |

Landfläche gesamt: 64,26 km². **Der Farn ist damit auf 4,6 % der Welt beschränkt, bevor Biom-
und Waldfilter überhaupt greifen** — und die Graslandregionen liegen ausgerechnet auf
30–120 m. Valheims Wiesen liegen dicht am Meeresspiegel; ein authentischer Wert trifft hier
auf eine Welt, für die er nicht gedacht war.

> [!important] Bewusst nicht eigenmächtig geändert
> Die 4.0 stammt aus dem Dump. Ob der Farn hochwandert (`maxAlt` anheben) oder die Wiesen
> heruntergehen (`baseLevel` der Graslandregionen), ist eine Entscheidung über die
> Bildsprache und über die Welt — nicht über eine Konstante. Genau hier ist die Fels-Schwelle
> (E4) schon einmal falsch abgebogen: Ein frei erfundener Ersatzwert musste später
> zurückgenommen werden.

**Nebenbefund, korrigiert:** Der Dateikopf sprach von „14 enabled entries". Es sind **13**,
und zwar seit dem ersten Commit — der vierzehnte ist beim Port aus der three.js-Referenz nie
angekommen. Welcher, lässt sich nicht mehr feststellen, weil der Export gelöscht ist. Seit
Block A ist die Tabelle ohnehin unsere eigene.

### Cutout-Schatten (Roadmap E12) — vermessen, **nicht** behoben

Die Roadmap sagt: „`alphaTest` greift nur im Forward-Pass, Schatten von Laub und Gras sind
blockig." Das stimmt, und zwar messbar. Am 16.08.2026 an den übersetzten Shadern der
laufenden Szene gezählt:

| Pass | Shadervarianten | davon mit `ALPHATEST` |
|---|---|---|
| Vorwärts (PBR) | 6 | **6** |
| Schattenkarte | 3 | **0** |

Die drei Schattenvarianten sind `NORMAL`, `NORMAL + INSTANCES + THIN_INSTANCES` und
`NORMAL + BONES` — Laubkarten teilen sich also die Thin-Instance-Variante mit Fels und
Stamm und werfen damit ihre **Rechteckform**.

**Was NICHT die Ursache ist** — alles einzeln nachgemessen, damit der nächste Anlauf nicht
dieselben vier Sackgassen abläuft:

- *Die Materialien melden keinen Alphatest.* Doch: 35 Werfer in der Schattenkarte liefern
  `needAlphaTestingForMesh() === true`, `transparencyMode === MATERIAL_ALPHATEST`,
  `alphaCutOff 0.5` und eine gültige `getAlphaTestTexture()`.
- *Sie stehen nicht in der Werferliste.* Doch: 35 von 102, alle `isEnabled()`, alle
  `isVisible`, alle mit Thin Instances.
- *`blockMaterialDirtyMechanism` verhindert das Neuübersetzen.* Nein — Sperre gelöst und alle
  35 Materialien als schmutzig gemeldet, danach 80 Frames: keine einzige neue Shadervariante.
- *`ShadowDepthWrapper` ist der Ausweg.* Angehängt an alle 35 alphagetesteten Materialien,
  80 Frames gerendert: **null** Wrapper-Shader übersetzt. Der Eingriff war wirkungslos und
  ist deshalb wieder zurückgenommen worden, statt als toter Code stehenzubleiben.

Babylon setzt `ALPHATEXTURE`/`ALPHATESTVALUE` im Schattenpass eigentlich selbst
(`shadowGenerator.js`, `isReady()`), sobald beides zutrifft — hier trifft beides zu, und es
passiert trotzdem nicht. Der nächste Schritt ist deshalb, den Schattenpass **während des
Renderns** zu instrumentieren (Haltepunkt in `_renderSubMeshForShadowMap`), statt
`isReady()` von außen aufzurufen: Ein Aufruf außerhalb des Schattendurchlaufs liest den
Draw-Wrapper der falschen Renderpassage und liefert ein falsches Negativ — daran ist diese
Untersuchung zwischendurch selbst hängengeblieben.

**Gras ist ein anderer Fall und kein Fehler:** Clutter steht mit null Einträgen in der
Werferliste, weil `NIE_WERFEN` in `Shadows.ts` es ausdrücklich ausschliesst — jede Kaskade
rendert die Werferliste komplett neu, und Clutter stellt die meisten Meshes. Empfangen darf
es weiterhin. „Blockige Grasschatten" gibt es also gar nicht; es gibt keine.

### Stufe 9 — Baum-LOD und Impostoren

Es wird ausschließlich die `Lod0`-Hülle gerendert (`AssetManager.ts`, `NON_LOD0`/`LOD0_NAME`
— Unity-GLBs führen alle LOD-Stufen als Geschwister-Meshes, die höheren werden abgeschaltet),
ohne Laufzeit-Umschaltung und ohne Impostoren — ferne Wälder kosten voll und flimmern.
Umsetzung als `Mesh.addLODLevel()` auf den Thin-Instance-Mastern. **Das ist die Gegenfinanzierung für die Schatten aus Stufe 1** —
deshalb bewusst am Ende, wenn die tatsächlichen Kosten gemessen sind.

⚠️ **Woher die LOD-Stufen kommen, hat sich umgekehrt (16.08.2026).** Hier stand: „Die
LOD-Stufen liegen in den Prefab-Ordnern des Rips
(`assetripper/export/Assets/world/Props/<Baum>/`, 6–7 GLBs je Baum)" — es war also ein
reines Verdrahtungsproblem. Den Rip gibt es nicht mehr, und unsere eigenen Bäume haben
genau eine Stufe.

Das ist weniger schlimm, als es klingt, weil die Bäume **erzeugt** und nicht gefunden
werden: `tools/baeume-bauen.sh` fährt jeden Baum mit festem Seed und fester Höhe, ein Lauf
mit gröberer Zielauflösung liefert dieselbe Silhouette in weniger Dreiecken. Die Stufe
verschiebt sich damit vom Client in die Werkzeugkette — und die Werte in
`tools/baeume-bauen.sh` sind, wie dort im Kopf steht, keine Vorschläge: Wer sie ändert,
ändert die Bäume, die in `shared/src/prefabs.ts` mit `renderScale` eingetragen sind.

Der Kostendruck ist außerdem gesunken: Die Welt besteht heute aus 119 Modellen statt aus
7.463, und `face_limit` beim generativen Weg hält die Dreieckszahlen von vornherein klein
(siehe [04-Asset-Pipeline.md](04-Asset-Pipeline.md)). Vor dem Bau der LOD-Kette gehört
deshalb erst gemessen, ob sie noch nötig ist.

---

## Nicht empfohlen

- **Volumetric Light Scattering** (`PostProcessing.ts:244-266`): gemessen 40 → 17 fps
  (eigene Verdeckungspassage über die ganze Szene). Der Nebelgradient aus Stufe 4 liefert das
  Glühen um die Sonne praktisch gratis.
- **HD-Mod-Texturen** (ehemals `assets/textures-hd/`, 829 MB): abgewählt zugunsten der
  Originaltreue — und seit 2026-08-16 endgültig, siehe Stufe 3. Weder dieser Ordner noch
  `assets/textures/hd-clutter/` liegt noch auf einem der beiden Container; in
  `assets/textures/` stehen 66 selbst erzeugte Karten und sonst nichts. Fremdes Material
  gehört generell nicht in `assets/` — was der Client ausliefert, ist öffentlich abrufbar.
  Derselbe Grundsatz hat inzwischen auch den Valheim-Export selbst erledigt (siehe
  [04-Asset-Pipeline.md](04-Asset-Pipeline.md)).
- **Triplanar-Terrain**, **`terrain_n_array.png`**, **Wolken-/Sterntexturen**: geringer
  Gewinn bzw. würden die Kopplung des prozeduralen Himmels an das EnvSetup schwächen.
- **Höher aufgelöste Bodentexturen**: existieren im Original schlicht nicht (Wiesenkachel hat
  Nachbardifferenz 0,91 — die Textur *ist* flach).

---

## Verifikation

Dienste sind seit 08/2026 **drei systemd-Units, als Dateien auf beiden Containern
identisch** (`deploy/systemd/`): `wov-server` (Spielserver, Port 2467), `wov-client`
(Vite-Dev-Server, Port 5274 — auf live nicht aktiviert, dort liefert nginx den gebauten
Client aus) und `wov-admin` (Betriebsdienst, Port 2468; dort liegen auch
`/api/worldlayout` und `/api/serverlog`). Ob der Server im Watch-Modus läuft, entscheidet
`WOV_WATCH` in `/etc/wov.env`, nicht der Quelltext; auf live bleibt die Variable leer.

*(Bis dahin stand hier `systemctl start valheim.target` mit Server 2466 und Client 5273 —
ein Sammelziel aus der Zeit, als dev und live sich in Quelldateien unterschieden. Ports und
Unit-Namen stimmen beide nicht mehr.)*

Welche Instanz ein Container fährt, sagt `WOV_INSTANZ` (`dev`|`live`) in `/etc/wov.env`.
Für die Messungen unten ist das relevant, weil Welt und Spielstand daran hängen —
Bodenregionen aus zwei Instanzen sind nicht vergleichbar.

| Stufe | Prüfung |
|---|---|
| 1a | Wiese fotografieren, Bodenregion messen: Sättigung 84 % → ~45 %, Blaukanal 12 → ~55–65 |
| 1b/c | Mittags unter einer Buche: weicher Schlagschatten auf Boden **und** Grashalmen; Konsole ohne `FRAGMENT SHADER ERROR`; Terrain behält seine Textur |
| 2 | 200-%-Zoom auf eine Baumsilhouette gegen den Himmel — Treppenstufen verschwinden |
| 3 | Kamera auf 3 m Höhe über die Wiese: einzelne Halmspitzen erkennbar statt Pixelmuster; Deckung fällt von 60 % auf ~10 %; beim Rückwärtsgehen dürfen Halme **nicht** verschwinden (Mip-Coverage) |
| 4 | Bei Sonnenuntergang auf der Stelle drehen: warmer Dunst glüht **um die Sonne**, bleibt beim Wegdrehen kalt; im Tal steht Bodennebel, auf der Kuppe daneben nicht |
| 5 | Felsblock am Mittag: Oberseite kühl-blau, Unterseite warm; nachts dürfen Bäume nicht schwarz werden |
| 6 | Nah an einen Buchenstamm: Rindenfurchen bekommen bei wandernder Sonne wandernde Schatten |
| 7 | Fuß eines Felsblocks dunkelt ab; `scene.geometryBufferRenderer` überlebt das Abschalten von DOF+MotionBlur |
| 8/9 | Im Schwarzwald: Farne, `shrub_2`, `stubbe`, umgestürzte `FirTree_oldLog` zwischen den Stämmen; fps-Messung vor/nach LOD |

**Gesamtmaß über alle Stufen** — die Eingangsmessung wiederholen: Tonwert-Entropie der
Tagesszene muss von 6,41 in Richtung 7,3 bit steigen und der Anteil der Pixel über
Helligkeit 128 von 0,5 % deutlich zunehmen.

Alle Farb- und Tonwertzahlen dieses Dokuments stammen aus `tools/shot-stats.mjs`
(`node tools/shot-stats.mjs <bild> [x0 y0 x1 y1]`) — dasselbe Werkzeug für die Nachmessung
benutzen, sonst sind die Zahlen nicht vergleichbar.
