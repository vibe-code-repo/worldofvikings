---
tags: [wov, dungeon-generator-2, architektur, bauanleitung]
status: verbindlich
erstellt: 2026-08-30
---

# Dungeon Generator 2.0 — Architektur-Synthese

**Das ist die Bauanleitung.** Sie verdichtet die fünf Design-Analysen zu einem widerspruchsfreien Bild und friert
die Verträge ein, auf denen die Umsetzungs-Workflows aufsetzen.

Quellen (alle fünf gelesen, alle Aussagen unten sind gegen sie geprüft):
`design/woc-analysis.md` · `design/data-model.md` · `design/render-tech.md` ·
`design/editor-integration.md` · `design/material-plan.md`
Maßgebliche Beschlüsse: `02 Projekte/World-of-Vikings/Dungeon Generator 2.0.md` (Vault).

Worktree `/home/mike/wov-wt-dungeon2`, Branch `dungeon-generator-2` ab `origin/main`.

> **Verbindliche Kommentar-Regel (gilt für jede neue Zeile Code in diesem Vorhaben):**
> **Code-Kommentare sind zweisprachig — Deutsch UND Englisch, beide Sprachen am selben Kommentar.**
> Muster (aus `data-model.md` §1.2, so und nicht anders):
> ```ts
> /**
>  * Rasterkonstanten. Sie stehen ZUSÄTZLICH im Dokument, weil eine Konstante
>  * sich ändern kann und ein altes Dokument dann still umgedeutet würde.
>  * Grid constants. They are ALSO written into each document, because a
>  * constant can change and an old document would then be silently reinterpreted.
>  */
> ```
> Das gilt auch für Python (`tools/bake-barrow-materials.py`), GLSL-Blöcke im Plugin und Testdateien.
> Kurze Zeilenkommentare dürfen einzeilig zweisprachig sein: `// Meter durch Multiplikation, nie Addition / metres by multiplication, never accumulation`.

---

## 1. Gesamtbild und Modulschnitt

### 1.1 Die vier Schichten und die eine harte Grenze

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ shared/src/dungeon2/   REIN. Kein Babylon, kein DOM, kein node:, kein Zufall │
│                        außerhalb des gesetzten Rng, keine Uhr.              │
│                                                                             │
│   layout.ts      Typen · Konstanten · Kanonisierung · Prüfsumme · Migration  │
│   cells.ts      Stempel + Korrekturen → Zellgitter · Wandableitung          │
│   generator.ts   erzeugeLayout(thema, seeds) — P0..P10                       │
│   themen.ts      ThemenProfil · 'steingrab' als erstes Thema                 │
│   builder.ts       baueGeometrie(layout) → Optik | Kollision | Nav | Anker     │
│   bestuecker.ts  Anker (Rolle) → Prefab                                      │
│   validation.ts    Invarianten, Befund[]                                       │
│   hashing.ts    ganzzahlige Positions-Hashes (Math.imul), mische(seed,salt) │
└───────────────┬─────────────────────────────┬───────────────────────────────┘
                │                             │
   ┌────────────▼───────────────┐  ┌──────────▼────────────────────────────┐
   │ client/                    │  │ server/                               │
   │  engine/DungeonBuilder.ts    │  │  world/dungeon/Materialisierung2.ts   │
   │    Meshes, Havok, Blöcke   │  │    ZDOs aus dekoPlaetze               │
   │  engine/DungeonMaterial.ts │  │  world/dungeon/DungeonManager.ts      │
   │    Triplanar-Plugin        │  │    (bleibt; 3 Methoden ersetzt)       │
   │  engine/DungeonAtmosphere.ts     │  │  kollision/nav → Spawn-Platzprüfung,  │
   │    SSAO/SSR/Godrays,Stufen │  │    NPC-Wegfindung                     │
   └────────────┬───────────────┘  └───────────────────────────────────────┘
                │
   ┌────────────▼──────────────────────────────────────────────────────────┐
   │ client/src/editor/dungeon2/   ZellenCanvas · ZellenWerkzeuge ·         │
   │   RaumStempelPalette · Dungeon2Katalog · Dungeon2Speichern ·           │
   │   Dungeon2Vorschau        (neue Betriebsart 'dungeon2' neben 'dungeons')│
   └───────────────────────────────────────────────────────────────────────┘
```

**Die harte Grenze wird durch einen Dauertest erzwungen, nicht durch Disziplin.** WoC hat dafür
`tests/architecture.test.ts` (`woc-analysis.md` §1). Unsere Fassung: `shared/test/dungeon2-schichten.ts` scannt
`shared/src/dungeon2/**` und lässt nicht zu: `@babylonjs/*`, `node:*`, `window`/`document`, `Math.random`,
`Date.now`, `performance.now`, `Math.sin`/`Math.cos` in Hash-Pfaden. Das ist billig und verhindert genau den
Rückfall, der uns zwingen würde, Geometrie über die Leitung zu schicken.

`shared/package.json` sagt bereits `"sideEffects": false` und begründet das ausführlich — `dungeon2/` muss diese
Zusage halten (keine Registry-Einträge auf Modulebene), sonst schleppt der Karten-Worker den Dungeon-Generator mit.

### 1.2 Neue Dateien (vollständige Liste)

| Datei | Inhalt | Woher |
|---|---|---|
| `shared/src/dungeon2/layout.ts` | `DungeonLayout2`, `Zelle`, `RaumStempel`, `Tuer`, `DekoAnker`, `LayoutSeeds`, Rasterkonstanten, `kanonisch()`, `layoutPruefsumme()`, `migriere()` | data-model §1 |
| `shared/src/dungeon2/cells.ts` | `zellenAufbauen()`, `wandZwischen()`, `stempelSetzen()`, `stempelEntfernen()`, `zellKanteZuQuader()` | data-model §1.3/§4.5 |
| `shared/src/dungeon2/hashing.ts` | `mische(seed, salt)`, `hashPos(x,z,ebene,seed)` — **ganzzahlig, `Math.imul`** | woc-analysis §3 (Korrektur der `Math.sin`-Falle) |
| `shared/src/dungeon2/generator.ts` | `erzeugeLayout()`, Phasen P0–P10 | data-model §2 |
| `shared/src/dungeon2/themen.ts` | `ThemenProfil`, `RaumTypProfil`, `steingrab` | data-model §2.2, material-plan §3 |
| `shared/src/dungeon2/builder.ts` | `baueGeometrie()` → `BauErgebnis` | data-model §3 |
| `shared/src/dungeon2/bestuecker.ts` | `bestuecke()` — Rolle → Prefab | data-model §2.5 |
| `shared/src/dungeon2/validation.ts` | `validateLayout()` → `Befund[]` | data-model §1.10 |
| `shared/src/campGenerator.ts` | herausgelöstes `generateCampLayout`/`CampGround` — **bleibt aktiv** | data-model §5.1 |
| `client/src/engine/DungeonBuilder.ts` | Babylon-Adapter: Merge je Block×materialTag, Havok aus `kollision`, `dungeonBereit` | data-model §3.3 |
| `client/src/engine/DungeonMaterial.ts` | Triplanar-`MaterialPluginBase` + Blending, Grafikstufen als Defines, Notbremse | render-tech §1/§2 |
| `client/src/engine/DungeonAtmosphere.ts` | dungeon-kalibriertes SSAO, Stufen- und Einzelschalter, besitzt Godrays und SSR | render-tech §3/§4 |
| `client/src/engine/DungeonGodrays.ts` | EINE Verdeckungspassage für den jeweils nächsten Lichtschacht (M2) | render-tech §3.3 |
| `client/src/engine/DungeonReflections.ts` | drei SSR-Wege, gebaut und gemessen; keiner in Stufe Hoch (M2) | render-tech §3.2 |
| `client/src/editor/dungeon2/*.ts` | sechs Dateien, siehe §1.1 | editor-integration §3 |
| `server/src/world/dungeon/Materialisierung2.ts` | ZDOs nur für Bewegliches/Interaktives | data-model §4.3 |
| `tools/bake-barrow-materials.py` | 8 Materialien prozedural in Blender, gebacken | material-plan §4 |
| `tools/pack-material-arrays.py` | PNG-Sätze → drei `Texture2DArray`-Quellen → KTX2 | **neu, siehe Widerspruch W5** |
| `shared/test/dungeon2-*.ts` | Schichten, Determinismus, Invarianten, Bauer, Parität | §4 |
| `LEGACY.md` | Sammelliste, ab Arbeitspaket 1 laufend gefüllt | Beschluss |

### 1.3 Datenfluss beim Betreten (ein Bild, sechs Schritte)

```
Instanz-Dokument {modus:'erzeugt', thema, seeds, pruefsumme}
        │  (über die Leitung reist der Deskriptor, nie Geometrie)
        ├── Server: erzeugeLayout → validateLayout → baueGeometrie
        │            └→ kollision + nav → Spawn-Platzprüfung, NPC-Wege
        │            └→ dekoPlaetze → bestuecke → ZDOs (nur Interaktives)
        └── Client: erzeugeLayout → validateLayout → Prüfsumme vergleichen
                     └→ baueGeometrie (Spawnblöcke zuerst)
                     └→ DungeonBauer: Meshes + Havok + Material
                     └→ dungeonBereit → Ladebildschirm aus
```

Gehen die Prüfsummen auseinander, lädt der Client das volle Layout nach **und meldet es laut**. Ein stiller
Rückfall wäre die Bauform, bei der man ein Jahr später merkt, dass der Determinismus seit Monaten kaputt ist.

---

## 2. Aufgelöste Widersprüche zwischen den fünf Dokumenten

Die fünf Autoren haben unabhängig gearbeitet. An zwölf Stellen sagen sie Verschiedenes. Jede Stelle ist hier
benannt, entschieden und begründet. **Die Entscheidung unten gilt, nicht das Quelldokument.**

### W1 — Sind Stempel Teil des gespeicherten Dokuments?

- `data-model.md` §1.4: Ja. Das Dokument speichert **Stempel + Korrekturen**, `zellenAufbauen()` rollt aus.
- `editor-integration.md` §3.3: Nein — „der Stempel selbst ist kein persistentes Objekt im Dokument, sondern nur
  der Weg, wie die Zellen entstanden sind".

**Entscheidung: Stempel werden gespeichert (datenmodell gewinnt).** Drei Gründe, die die Editor-Sicht schlagen:
(a) `DekoAnker.stempelId` braucht eine nie neu vergebene ID — ohne persistente Stempel gibt es sie nicht, und
damit kehrt die `roomIndex`-Rutschfalle zurück, die `removeRoom` heute hat; (b) „diesen Saal eine Nummer größer"
ist im Editor die häufigste Operation und ist ohne Stempel nicht mehr möglich, weil ausgerollte Zellen keine
Herkunft mehr kennen; (c) ein 60-Raum-Grab sind ~40 Stempel gegen ein paar tausend Zellen — die Stempelform ist
auch die sparsame.
Die berechtigte Sorge des Editor-Dokuments („gestempelt und gepinselt darf im Ergebnis nicht unterscheidbar
sein") bleibt erfüllt: **im ausgerollten Gitter** ist beides gleich, `Zelle.stempelId` ist nur Herkunft, nie
Verhalten. Kein Bauer-, Kollisions- oder Shader-Pfad darf `stempelId` auswerten.

### W2 — Wann kippt ein erzeugter Dungeon auf „von Hand gebaut"?

- `editor-integration.md` §3.4: bei **jedem** Handeingriff (`mode = 'custom'`, wie im Altbestand).
- `data-model.md` §4.5: erst wenn jemand **die Stempel** anfasst; Zellen-Korrekturen lassen `modus: 'erzeugt'`
  stehen.

**Entscheidung: datenmodell gewinnt, mit einer Zusatzregel.** Der Gewinn ist konkret — „regenerieren und meine
Fackeln behalten" geht heute nicht (`dungeon regen <id>` wirft die Deko weg), und das ist ein echter Schmerz.
Zusatzregel, die der Editor-Autor zu Recht gefürchtet hat: **Korrekturen und Anker überleben eine
Neu-Erzeugung nur, solange der `architektur`-Seed unverändert ist.** Ändert jemand den Architekturseed, verlieren
Korrekturen ihre Zellen unter sich; dann friert der Editor das Layout vorher ein (`modus: 'gebaut'`) **oder**
verwirft die Korrekturen — mit ausdrücklicher Rückfrage, nie still. Material- und Deko-Seed dürfen jederzeit neu
gewürfelt werden (das ist der ganze Sinn der Seed-Dreiteilung).

### W3 — Was ist die Chunk-Grenze für Rendering?

- `render-tech.md` §5.1: der **Raum**.
- `data-model.md` §3.2 (4): der **Block** = 8×8 Zellen einer Ebene (32 m).

**Entscheidung: der Block (datenmodell gewinnt).** Räume sind als Chunk untauglich, weil Stempel sich
überlappen dürfen („Gang durch Saal", `ordnung`) — eine Zelle kann dann zu zwei Räumen gehören, und ein Chunk mit
uneindeutiger Zugehörigkeit ist kein Chunk. Ein Saal von 20×20 Zellen wäre außerdem ein 80-m-Brocken, ein
Nischenraum ein 4-m-Krümel; die Draw-Call-Verteilung wäre zufällig. Blöcke sind gleich groß, gitterausgerichtet,
und sie sind ohnehin schon der Schlüssel für den blockweisen Bauer-Aufruf und den Ladefortschritt.
Der berechtigte Kern der Render-Sicht bleibt: **ein gemergtes Mesh je (Block × materialTag)**, nicht je Zelle und
nicht für den ganzen Dungeon — genau das Muster aus `GrassClutter.ts` („one InstancedMesh per cell per entry"),
nur mit Block statt Terrain-Cell. Die Blockgröße 8×8 steht unter Messvorbehalt (Mikes offener Punkt 2), der
**Begriff** Block steht nicht mehr zur Debatte.

### W4 — Woher kommt die „Feuchte in Ecken"?

- Beschluss/`material-plan.md` §2: Blend-Layer über eine Maske.
- `render-tech.md` §2.2: SSAO ist im Material-Shader **nicht lesbar** (Post-Process nach dem Material-Pass);
  Ersatz `fwidth`-Cavity **plus** Zellen-Attribut.
- `data-model.md` §3.1: Der Bauer rechnet `hoeheUeberBoden` und `kantenAbstand` je Ecke aus und legt sie in
  `BlendAttribute` ab; im Client wandern sie in `uv2`.

**Entscheidung: Das Zellen-/Bauer-Attribut ist die Wahrheit, `fwidth` ist optionale Verfeinerung auf Stufe Hoch.**
Der Render-Autor hat den Fallstrick korrekt gefunden und wird bestätigt: „Feuchte via AO" ist gestrichen.
Konkret: `BauStueck.blend` trägt zwei Werte je Ecke — `hoeheUeberBoden` (Meter, treibt Moos und Schmutz) und
`kantenAbstand` (Meter zur nächsten konkaven Kante, treibt Feuchte). Transport: **`uv2`** (zwei Floats,
datenmodell), **nicht** der vierte Vertexfarben-Slot (render-technik) — Vertexfarben bleiben für spätere
Deko-Varianz frei, und `uv2` ist in Babylon ohne Sonderweg an Bord. `fwidth(normalW)` kommt als `#ifdef`-Zweig
nur auf Stufe Hoch dazu und ist ausdrücklich **kein** Ersatz, wenn das Attribut fehlt: fehlt es, ist Feuchte aus.
Ein bildraum-abhängiger Ersatzpfad wäre ein zweites Verhalten für denselben Effekt.

### W5 — ORM oder ORH? Und Atlas, Array oder Einzeltexturen?

- `material-plan.md` §2: pro Material **Albedo, Normal, ORM (Occlusion/Rauheit/Metallic), Height**, je 1K, KTX2.
- `render-tech.md` §1.5: drei `sampler2DArray` — `dungeonAlbedoArray`, `dungeonNormalArray`,
  **`dungeonOrhArray` (Occlusion/Rauheit/Height)**.

Das ist ein echter Kanalkonflikt: Der dritte Kanal ist einmal Metallic, einmal Height.

**Entscheidung: ORH (Occlusion / Rauheit / Height) im Array; Metallic ist eine Konstante je Layer, kein Kanal.**
Begründung: Von den acht Materialien ist genau eines metallisch (Nr. 6). Ein voller Texturkanal für einen Wert,
der auf sieben von acht Layern konstant 0 ist, ist verschwendet — Height dagegen wird pro Texel gebraucht
(Parallax) und lässt sich nicht durch eine Konstante ersetzen. Der Metallwert wandert als
`metallProLayer[]`-Uniform ins Theme-Struct. Das ist genau WoCs Lösung, dort als gemessene Familien-Konstante
`metalMean` (`worn_stone.ts:76-105`).

**Und: Array, nicht Atlas** (render-technik gewinnt gegen die implizite Einzeltextur-Annahme des Material-Plans).
Triplanar + Atlas bricht an Kachelgrenzen durch Mip-/Bilinear-Bleeding; das ist bei einer Wand, die zehn Meter
dieselbe Kachel wiederholt, ein garantiertes Problem, kein Randfall.
Daraus folgt eine **neue Aufgabe, die in keinem der fünf Dokumente steht**: Der Bake-Weg liefert Einzel-PNGs,
das Ziel ist ein 2D-Array. Dazwischen fehlt ein Schritt → `tools/pack-material-arrays.py` (Arbeitspaket 12).
Und ein Risiko: **KTX2/Basis Universal in Kombination mit `Texture2DArray` ist zu verifizieren**, bevor sich der
Bake-Weg darauf festlegt (Risiko R4).

**Layer-Belegung eingefroren** (`materialTag` = Index):

| Tag | Material | im Basis-Array? |
|---|---|---|
| 0 | Wand-Quader (Sandstein hell) | ja |
| 1 | Fels roh (Bruchstein) | ja |
| 2 | Boden-Platten (verlegt) | ja |
| 3 | Erde/Sand | ja |
| 4 | Holz (Runenholz) | ja |
| 5 | Metall (Beschläge) | ja |
| 6 | **Moos-Overlay** | **nein** — eigenständige Detailtextur |
| 7 | **Feuchte-Overlay** | **nein** — nur Rauheitsabsenkung, keine eigene Textur |
| 8 | Frost-Overlay (Theme Eis) | nein — Overlay |
| 9 | Ruß-Overlay (Theme Feuer) | nein — Overlay |

Das Basis-Array hat also **sechs** Layer, nicht acht. Die Overlays sind Blend-Layer im selben Fragmentblock und
dürfen nie als `materialTag` einer Zelle auftauchen — `validateLayout()` prüft das (`materialTag <= 5`).

### W6 — Welcher Zufallsgenerator?

- `woc-analysis.md` §3: mulberry32, `Math.imul`, engine-unabhängig.
- `data-model.md` §2.1: `XorShiftRandom` aus `shared/src/worldgen/Random.ts` bleibt.

**Entscheidung: `XorShiftRandom` bleibt — der Einwand trifft ihn nicht.** Nachgelesen: der Generator ist
uint32-basiert (`Math.imul`, `>>>`), `nextFloat()` ist per `Math.fround` bit-exakt auf float32 normiert, und die
Kopf-Doku belegt die Bit-Treue gegen die C++-Referenz. Er ist damit genau so engine-unabhängig wie mulberry32 und
zusätzlich projektweit erprobt.
**Aber der Kern des WoC-Einwands gilt trotzdem, an anderer Stelle:** `XorShiftRandom.insideUnitCircle()` benutzt
`Math.cos`/`Math.sin` und warnt selbst davor („can differ by ~1 ulp"). **Regel: kein Dungeon-2.0-Pfad ruft
`insideUnitCircle()` auf**, und kein geteilter Hash ist trigonometrisch. Alle Positions-Hashes gehen durch
`hashing.ts` (`Math.imul`-Kette). Der Schichtentest verbietet `Math.sin`/`Math.cos` in `dungeon2/`.

### W7 — Ein Rng-Strom oder mehrere?

Alle drei Quellen sind sich fast einig, aber unterschiedlich streng. **Festlegung:** drei Seeds
(`architektur`/`material`/`deko`), daraus:
- **ein** Architekturstrom für die Phasen P0–P8, Ziehreihenfolge ist Vertrag;
- **ein Strom je Stempel** für Deko (`mische(seeds.deko, stempel.id)`) und **ein Strom je Anker** im Bestücker
  (`mische(seeds.deko, anker.id)`);
- **kein Strom** im Bauer — der hasht (siehe W8).
Neue Merkmale in P0–P8 bekommen einen **eigenen Strom** (`mische(seeds.architektur, SALZ_X)`), nie zusätzliche
Ziehungen im bestehenden. Das ist die Lehre aus `rift_gen.ts:280-284`: „eine zusätzliche Ziehung verschiebt jede
Etage jedes Seeds".

### W8 — Zieht der Bauer oder hasht er?

`data-model.md` §3.2 (2) sagt hashen. Kein anderes Dokument widerspricht, aber `render-tech.md` §2.4 spricht
von „prozeduralem Rauschen mit `theme.seed`" im Shader. **Beides ist dasselbe und wird festgeschrieben:**
CPU-Bauer und GPU-Shader benutzen **denselben ganzzahligen Hash** über Weltposition und `seeds.material`.
Nur so ist ein Moosfleck, den der Shader zeichnet, an derselben Stelle wie eine Kante, die der Bauer geformt hat.
Folge (und der eigentliche Gewinn): Der Bauer ist blockweise und in **beliebiger Reihenfolge** aufrufbar —
Spawnblöcke zuerst, Rest nachziehen, ohne dass sich etwas ändert.

### W9 — Was gehört in Meilenstein 1?

- Beschluss: „Vollausbau Stufe 1: SSAO, Godrays, SSR, Parallax".
- `render-tech.md` §3.2: „Meilenstein 1 ohne SSR".
- `data-model.md` §7: Atmosphäre erst nach dem Adapter.

**Entscheidung: Meilenstein 1 endet beim begehbaren, texturierten Dungeon mit dungeon-kalibriertem SSAO.**
SSR, Godrays und Parallax sind **Meilenstein 2**. Der Beschluss „Vollausbau" bleibt gültig als Ziel des
Vorhabens, nicht als Inhalt des ersten Meilensteins — und der Beschluss selbst nennt Meilenstein 1 wörtlich
„begehbarer Auto-Dungeon". Der Grund ist die Abnahmeregel: SSR über den PrePassRenderer ist eine
Architekturentscheidung (zweite Vollgeometrie-Passage neben dem GeometryBufferRenderer), die man nicht
nebenbei trifft, während der Grundriss noch nicht steht.

**Nachtrag 31.08.2026 (M2 abgeschlossen, Zahlen im `decisions-log.md`).** Meilenstein 2 ist gebaut und
gemessen, und er endet anders als geplant:

- **Parallax** ist in Stufe Hoch (Parallax Occlusion, sechs Schritte, +10,5 % Bildzeit). R6 ist damit
  beantwortet: Er kostet ein Zehntel, nicht ein Drittel.
- **Godrays** sind in Stufe Hoch — EINE Passage für den jeweils nächsten Lichtschacht, nicht eine je Schacht
  (±0 % gemessen, weil sie außerhalb von 30 m gar nicht laufen).
- **SSR ist NICHT in Stufe Hoch.** Nicht aus Kostengründen allein (+52,6 %), sondern weil es auf dem einzig
  gangbaren Weg nichts zeigen KANN: MaterialPlugins laufen in der GBuffer-Passage nicht, also sieht SSR von
  unserem Triplanar-Material nur `metallic = 0, roughness = 1` — die feuchte Stelle entsteht erst im
  Fragment-Shader. Gemessen: 13 % geänderte Bildpunkte bei mittlerer Abweichung 16,6, also der
  Flacker-Unterschied zweier Fackelbilder.
- **Die PrePass-Frage ist entschieden: nein.** Und die Begründung ist eine andere als erwartet — nicht „zwei
  Passagen sind zu teuer", sondern: `scene.enablePrePassRenderer()` SCHALTET DEN GEOMETRYBUFFERRENDERER AB
  (`PrePassRenderer._refreshGeometryBufferRendererLink`). Danach rechnet unser SSAO2 ins Leere. Der PrePass-Lauf
  war deshalb *schneller* als die Grundlinie — daran erkennt man ihn.
- Nebenbefund gegen `render-tech.md` §3.2: Babylon 8.56 HAT eine Reflektivitäts-MRT im GeometryBufferRenderer.
  Die dortige Aussage „daran führt kein Weg vorbei" ist überholt und dort korrigiert.

### W10 — Wer prüft die Kollision?

- Beschluss: „Server braucht den Bauer für Kollision".
- `data-model.md` Befund 1: Der Server prüft **heute keine** Kollision; die gesamte Physik ist Client/Havok, die
  Form wird aus den GLBs gemessen.

**Entscheidung: In Meilenstein 1 wird die Spielerbewegung nicht serverautoritativ.** Der Bauer liegt trotzdem in
`shared/`, und der Server ruft ihn — aber seine ersten Verwender sind **Spawn-Platzprüfung und NPC-Wegfindung**
(`kollision`, `nav`). Der Client baut sein Havok-Shape aus `BauErgebnis.kollision`, **nicht** mehr aus dem
gerenderten Mesh. Damit ist die Kollision ab Tag eins von der Optik entkoppelt (ein Kunstpass ändert nicht das
Laufgefühl), und autoritative Bewegung ist später eine reine Server-Entscheidung ohne Client-Umbau.

### W11 — Blend-Gewichte: weiche Potenz oder Dominanz-Kollaps?

- `render-tech.md` §1.1: `pow(abs(n), SCHAERFE)` mit Schärfe 3–6, normalisiert.
- `woc-analysis.md` §6: WoCs Kollaps `w = normalize(pow(|n|,4))`, dann `w = normalize(max(w - 0.15, 0))` — macht
  achsnahe Flächen **exakt** one-hot und erlaubt einen Ein-Tap-Schnellpfad.

**Entscheidung: Dominanz-Kollaps (woc-analyse gewinnt).** Für ein Barrow aus ruhigen, achsausgerichteten Quadern
ist praktisch jede Fläche innerhalb von ~33° zu einer Achse — Triplanar kostet uns damit fast überall **einen
Tap statt drei**. Das ist das entscheidende Performance-Argument für Stufe Mittel und keine Stilfrage.
`SCHAERFE` bleibt als Theme-Parameter erhalten (Exponent vor dem Kollaps), der Subtraktionsschwellwert 0.15 wird
gemessen, nicht geglaubt.

Folgeentscheidung, die W11 gratis mitliefert: **Parallax läuft nur auf der dominanten Ebene** (render-tech §3.4
empfahl das aus Kostengründen) — nach dem Kollaps ist „die dominante Ebene" fast überall die **einzige** Ebene,
der Sonderfall wird also billig statt teuer.

### W12 — Editor: 2D oder 3D als primäre Fläche?

- `editor-integration.md` §3.5: 2D-Draufsicht primär, 3D als zweite Ebene, Debouncing bei Bedarf.

Kein Widerspruch, aber eine **Ergänzung aus dem Datenmodell**, die dort noch fehlt: Weil der Bauer blockweise und
reihenfolgefrei ist (W8), braucht die 3D-Vorschau **kein** Debouncing im üblichen Sinn — ein Pinselstrich baut
genau die betroffenen Blöcke neu. Das ist der Grund, warum der Hash-statt-Strom-Beschluss im Bauer keine
Detailfrage ist. Debouncing bleibt als Rückfallebene, wenn die Messung etwas anderes sagt.

Und die drei offenen Fragen aus `editor-integration.md` §4 sind hiermit beantwortet:
Bodenhöhe **pro Zelle flach** (`boden`), plus `neigung` nur bei Treppen · Wandflags als **Bitmaske je Kante**
(`Kante`-Enum, zwei Masken: erzwungen/durchgang) · Theme-Referenz als **`thema: string` + `seeds`** im Dokument,
die Seitenleiste braucht einen Theme-Wähler und drei Seed-Felder.

---

## 3. Layout-Datenformat v1 — eingefroren

**Ab hier bauen alle anderen darauf. Änderungen an diesem Abschnitt sind eine Versionserhöhung, kein Edit.**

Modul `shared/src/dungeon2/layout.ts`, `LAYOUT_FORMAT = 'wov-dungeon-layout'`, `LAYOUT_VERSION = 1`.

### 3.1 Der tragende Grundsatz

**Das Layout enthält keine Fließkommazahlen.** Jede Koordinate ist eine Ganzzahl — Zellindex, Ebenenindex,
Höhenstufe, Vierteldrehung. Meter entstehen erst im Bauer, durch Multiplikation, auf beiden Seiten mit derselben
Funktion. Damit ist Determinismus per Byte-Vergleich nachweisbar statt geglaubt; heute hängt er an
f32-Bitmustern (der Alt-Sanitizer normalisiert gesunde Quaternionen bewusst nicht, um genau das nicht zu stören).

### 3.2 Raster

```ts
export const ZELLE_M = 4;             // Kantenlänge einer Zelle / cell edge length
export const EBENE_M = 8;             // Stockwerkshöhe / storey height
export const HOEHEN_SCHRITT_M = 0.5;  // feinste Höhenstufe / finest height step
export const MIN_LICHTE_STUFEN = 8;   // 4 m Mindesthöhe / minimum headroom
export const BLOCK_ZELLEN = 8;        // 8×8 Zellen = 32 m je Block / cells per block
```

`ZELLE_M`, `EBENE_M` und die 4-m-Mindesthöhe sind die belegten Werte aus `dungeonRaster.ts` (Figurenmaße
`BODY_RADIUS 0.4` / `BODY_HEIGHT 1.8`, Z-Fighting-Rechnung für die Stockwerkshöhe). Die Herleitung überlebt den
Neubau, das Modul nicht. `HOEHEN_SCHRITT_M` und `BLOCK_ZELLEN` stehen unter Messvorbehalt (Mikes offene Punkte).

Die Werte stehen **zusätzlich im Dokument** (`raster`), weil eine Konstante sich ändern kann und ein altes
Dokument dann still umgedeutet würde.

### 3.3 Zelle

```ts
export const enum Kante { Nord = 1, Ost = 2, Sued = 4, West = 8 }
export const enum ZellenArt { Leer = 0, Boden = 1, Treppe = 2, Schacht = 3, Wasser = 4 }

export interface Zelle {
  readonly x: number; readonly z: number; readonly ebene: number;
  readonly art: ZellenArt;
  readonly boden: number;   // in HOEHEN_SCHRITT_M, relativ zur Ebene
  readonly decke: number;   // in HOEHEN_SCHRITT_M über dem Boden DIESER Zelle
  readonly neigung?: Kante; // nur Treppe: Richtung des Anstiegs
  readonly wandErzwungen: number;      // Kanten-Bitmaske
  readonly durchgangErzwungen: number; // Kanten-Bitmaske, schlägt wandErzwungen
  readonly materialTag: number;        // 0..5, siehe W5
  readonly oberflaeche: number;        // Zusatzmerkmale fürs Blending (Bitmaske)
  readonly stempelId: number;          // Herkunft; -1 = Handarbeit. NIE verhaltensrelevant (W1)
}
```

**Wände werden abgeleitet, nicht gespeichert.** Die Ableitungsregel ist symmetrisch, damit die Besuchsreihenfolge
das Ergebnis nie bestimmt:

```
Wand(A,B) = ( abgeleitet(A,B) ∨ erzwungen_A ∨ erzwungen_B ) ∧ ¬( durchgang_A ∨ durchgang_B )
abgeleitet(A,B) = genau eine begehbar  ∨  |boden_A − boden_B| > 1
```

### 3.4 Stempel, Korrekturen, Türen, Anker

```ts
export type RaumTyp = 'eingang'|'gang'|'kammer'|'saal'|'schatzkammer'|'grabkammer'|'treppe'|'nische'|'abschluss';

export interface RaumStempel {
  readonly id: number;            // stabil, wird NIE neu vergeben
  readonly typ: RaumTyp;
  readonly x: number; readonly z: number; readonly ebene: number;
  readonly breite: number; readonly tiefe: number;
  readonly hoehe: number;         // über Raumboden, in HOEHEN_SCHRITT_M
  readonly bodenVersatz: number;  // gegen die Ebene, in HOEHEN_SCHRITT_M
  readonly drehung: 0|1|2|3;      // Vierteldrehungen, keine anderen Winkel
  readonly seed: number;
  readonly variante: number;
  readonly ordnung: number;       // spätere Stempel überschreiben frühere Zellen
  readonly tiefeImBaum: number;   // 0 = Eingang
}

export interface ZellenKorrektur {
  readonly x: number; readonly z: number; readonly ebene: number;
  readonly aendere: Partial<Omit<Zelle, 'x'|'z'|'ebene'>>;
  readonly loeschen?: boolean;
}

export interface Tuer {
  readonly x: number; readonly z: number; readonly ebene: number;
  readonly kante: Kante;          // kanonisiert an der Zelle mit kleinerem (ebene,z,x)
  readonly art: string;           // 'holz'|'gitter'|'bogen'|'steinplatte' aus dem Thema
  readonly zustand: 'offen'|'zu'|'verschlossen';
  readonly schluessel?: string;
}

export const enum AnkerOrt { Wand = 0, Boden = 1, Decke = 2, Ecke = 3 }

export interface DekoAnker {
  readonly id: number;
  readonly x: number; readonly z: number; readonly ebene: number;
  readonly ort: AnkerOrt;
  readonly kante?: Kante;
  readonly u: number; readonly v: number; // Versatz in Achteln einer Zelle, 0..8
  readonly h: number;                     // Höhe in HOEHEN_SCHRITT_M
  readonly drehung: 0|1|2|3;
  readonly rolle: string;  // die ROLLE, nicht das Prefab
  readonly prefab?: string;// von Hand festgenagelt
  readonly seed: number;
  readonly stempelId: number;
}
```

Der Anker ist ein **Platz**, keine Instanz. Ein neues Fackelmodell soll in alten Gräbern auftauchen können, ohne
dass 3.596 Dokumente angefasst werden; ein handgesetzter Altar soll trotzdem der Altar bleiben — dafür ist
`prefab`. `stempelId` ersetzt den heutigen `roomIndex` und damit die Index-Rutsch-Falle von `removeRoom`.

### 3.5 Seeds und Dokument

```ts
export interface LayoutSeeds {
  readonly architektur: number; // Grundriss: Stempel, Gänge, Ebenen, Schleifen
  readonly material: number;    // Oberflächen: Variation, Moos, Feuchte, Schmutz
  readonly deko: number;        // Bestückung: welches Prefab an welchem Anker
}

export interface DungeonLayout2 {
  readonly format: 'wov-dungeon-layout';
  readonly version: number;
  readonly id: string; readonly name: string;
  readonly thema: string;                    // 'steingrab'
  readonly seeds: LayoutSeeds;
  readonly raster: { zelleM: number; ebeneM: number; hoehenSchrittM: number; blockZellen: number };
  readonly grenzen: { minX: number; maxX: number; minZ: number; maxZ: number; minEbene: number; maxEbene: number };
  readonly eingang: { x: number; z: number; ebene: number; kante: Kante };
  readonly stempel: readonly RaumStempel[];
  readonly korrekturen: readonly ZellenKorrektur[];
  readonly tueren: readonly Tuer[];
  readonly anker: readonly DekoAnker[];
  readonly pruefsumme: string;               // FNV-1a über kanonisch(), ohne dieses Feld
}
```

Erzeugungsart und Herkunft stehen **nicht** im Layout, sondern im Instanz-Dokument. Das Layout beantwortet „wie
sieht dieser Dungeon aus", nicht „woher kommt er".

### 3.6 Kanonisierung, Prüfsumme, Migration

- **Sortiert wird vor dem Serialisieren.** Stempel nach (`ordnung`, `id`); Korrekturen, Türen, Anker nach
  (`ebene`, `z`, `x`, Unterscheidungsfeld). Eine `Map`-Iterationsreihenfolge darf nie in die Prüfsumme eingehen.
- **FNV-1a, kein HMAC, kein `crypto`.** Die Prüfsumme ist ein Zeuge gegen Auseinanderlaufen, keine Absicherung
  gegen einen Angreifer. `crypto` läuft in Node anders als im Browser, und zwar still.
- **Migration ist eine Kette reiner Schritte** v_n → v_{n+1}, nie ein wachsender Sanitizer. Der Sanitizer sagt
  „ist das gültig", die Migration sagt „was bedeutete das damals". Auch additive Felder erhöhen die Version.

### 3.7 Invarianten (`validation.ts`)

| Regel | Warum |
|---|---|
| Jede begehbare Zelle ist vom Eingang aus erreichbar (Flutfüllung über offene Kanten) | Ein abgeschnittener Raum ist unsichtbar kaputt |
| Die **lichte Säule** (Decke durch offene Schächte hindurch minus Boden) `≥ MIN_LICHTE_STUFEN` in jeder begehbaren Zelle | Sonst geduckt statt gewölbt. NICHT das rohe Feld `decke`: Steht ein Schacht darüber, fällt die Deckenplatte weg und `decke` ist nur noch die Zahl, mit der der Stempel gesetzt wurde — ein Treppenlauf, der oben in eine Mündung austritt, wäre damit gleichzeitig „zu niedrig“ (decisions-log, 30.08.2026) |
| Keine zwei begehbaren Zellen mit gleichem (x,z,ebene) | Der Zellenaufbau darf nicht doppelt belegen |
| Zwei Ebenen übereinander: Deckenoberkante unten < Bodenunterkante oben | Die Z-Fighting-Rechnung hinter `EBENE_M = 8` |
| Jede Treppenzelle hat oben und unten je eine begehbare Nachbarzelle, und über ihrer **obersten Stufe** stehen `TREPPE_KOPFRAUM_STUFEN = 4` (2 m) frei | Treppe ins Nichts — und ein Lauf, unter dem man nicht durchkommt. Der Kopfraum wird ausdrücklich nicht an `MIN_LICHTE_STUFEN` gemessen: Ein Absatz ist kein Raum, und 4 m über jeder Stufe sind bei 8 m Ebenenhöhe und begehbarer Steigung nicht erreichbar. Gemessen: ein Raum über einem Lauf liess ihm 1,5 m, die Regel blieb stumm, die Spielerkapsel (1,8 m) kam nicht durch |
| Jede Tür sitzt auf einer Kante zwischen zwei begehbaren Zellen | Türen im Fels |
| Jeder Anker liegt in einer begehbaren Zelle; `Wand`-Anker an einer Kante mit Wand | Fackeln in der Luft |
| `materialTag ≤ 5` | Overlays (6–9) sind Blend-Layer, keine Zellmaterialien (W5) |
| Alle Ganzzahlfelder sind ganzzahlig und endlich | Der Grundsatz aus §3.1, geprüft statt gehofft |
| `pruefsumme` stimmt mit `layoutPruefsumme()` überein | Der Zeuge |
| **Ein garantiertes Rückgrat vom Eingang zum tiefsten Pflichtraum, das kein Stempel überschreiben darf** | WoCs Mittelgang-Invariante (`rift_gen.ts:56`) — ohne sie kann jede Erreichbarkeitsprüfung scheitern statt zu terminieren |

### 3.8 Bauer-Vertrag (`BauErgebnis`) — ebenfalls eingefroren

```ts
export interface BauErgebnis {
  readonly stuecke: readonly BauStueck[];          // Sichtgeometrie, je Block × materialTag
  readonly kollision: readonly KollisionsKoerper[];// EIGENE Liste, nicht „die Meshes"
  readonly nav: readonly NavZelle[];
  readonly dekoPlaetze: readonly DekoPlatz[];
  readonly spawnPunkt: Vector3;                    // ausdrücklich, nicht hergeleitet
  readonly huelle: { min: Vector3; max: Vector3 };
  readonly pruefsumme: string;
}
```

Die fünf Vertragsregeln:
1. **Optik und Kollision sind zwei Ausgaben, nicht eine.** Der Server kann die Kollision haben, ohne je ein
   Dreieck zu sehen; ein Kunstpass ändert nicht das Laufgefühl.
2. **Der Bauer würfelt nicht, er hasht** (W8) — deshalb blockweise und reihenfolgefrei aufrufbar.
3. **Meter durch Multiplikation, nie durch Addition.** `x * ZELLE_M`, nicht `vorige + ZELLE_M`.
4. **Blöcke sind die Einheit von allem Weiteren** (W3): Merge, Culling, Ladefortschritt, Nachladen.
5. **Der Bauer kennt keine Grafikstufe.** Er liefert immer alles; was auf Niedrig entfällt, entscheidet der
   Client-Adapter über `BauStueck.art`. Sonst fiele ein Spieler auf Niedrig durch einen Boden, den er nicht sieht.

**Eine geteilte Kantenfunktion, nicht zwei gleiche.** `zellKanteZuQuader(zelle, kante, gitter)` liefert Mitte,
Größe und Vierteldrehung — Sichtgeometrie **und** Kollision rufen dieselbe Funktion. Das ist die Übersetzung von
WoCs `splitRun()`/`polygonWallSegments`-Paarung in unsere Welt und der Grund, warum die dortige Phantomwand-/
Ecklücken-Klasse bei uns bauartbedingt entfällt.

---

## 4. Meilenstein 1 — „begehbarer Auto-Dungeon auf wov-dev"

**Abnahmeregel des Projekts, in dieser Reihenfolge: Messung → Rendering → Mikes Blick.**
Deshalb steht in jedem Paket unten ein Prüfkriterium, das **ohne Bild** entscheidbar ist, und erst die Pakete
AP7/AP11 liefern Bilder. Nichts wird ausgerollt, bevor Mike die Bilder gesehen hat.

Der Grundsatz aus `data-model.md` §7 ist übernommen: **das erste Rendering zeigt graue Kästen, nicht Material** —
ein Fehler im Grundriss verschwindet unter einer schönen Oberfläche.

### Abhängigkeitsbild

```
AP0 ──▶ AP1 ──▶ AP2 ──▶ AP3 ──▶ AP4 ──┬─▶ AP6 ──▶ AP7 ──┬─▶ AP10 ──▶ AP11 ──▶ AP13 ──▶ AP14
                          │           │                 │
                          └─▶ AP5 ────┘        AP8 ─────┘
                                                AP9 (parallel, Blender)
                                                AP12 (nach AP9)
```

| AP | Umfang | Braucht | Modell |
|---|---|---|---|
| 0 | Vorbereitung: Datei teilen, Schichtentest, LEGACY.md anlegen | — | Sonnet |
| 1 | `layout.ts` + `hashing.ts` | AP0 | Opus |
| 2 | `cells.ts` + `validation.ts` | AP1 | Opus |
| 3 | `builder.ts` | AP2 | Opus |
| 4 | `generator.ts` + `themen.ts` | AP2 | Opus |
| 5 | Determinismus-Prüfstand Node↔Browser | AP4 | Sonnet |
| 6 | `DungeonBuilder.ts` (graue Kästen + Havok) | AP3, AP4 | Opus |
| 7 | **Erstes Rendering** + Parität + Begehbarkeit lokal | AP6 | Sonnet |
| 8 | Babylon-Recherche: Injektionsmarken, Sampler-Budget, Klon-Verhalten | AP0 | Opus |
| 9 | `tools/bake-barrow-materials.py` | — (parallel) | Opus |
| 10 | `DungeonMaterial.ts` — Triplanar + Blending | AP7, AP8, AP12 | Opus |
| 11 | **Zweites Rendering** + Messung Stufe Mittel | AP10 | Sonnet |
| 12 | `tools/pack-material-arrays.py` — PNG → Array/KTX2 | AP9 | Sonnet |
| 13 | Adapter: `materialisiere2`, Sanitizer-Weiche, Teleportpaket | AP7 | Opus |
| 14 | Ausrollen auf wov-dev, Betreten, Leak-/Sichtbarkeitstest portiert | AP13, AP11 | Sonnet |

---

### AP0 — Vorbereitung und Schutzzaun
**Modell: Sonnet.** **Braucht: nichts.**

Umfang:
1. `shared/src/dungeonGenerator.ts` teilen: `generateCampLayout` + `CampGround` (ab Z. 623) nach
   `shared/src/campGenerator.ts`, Importe im `ZoneManager` nachziehen. **Das ist Oberweltinhalt und bleibt aktiv** —
   wer die Datei als Ganzes stempelt, stempelt die Oberwelt mit.
2. `shared/test/dungeon2-schichten.ts`: scannt `shared/src/dungeon2/**` und verbietet `@babylonjs/*`, `node:*`,
   `window`, `document`, `Math.random`, `Date.now`, `performance.now`, `Math.sin`, `Math.cos`,
   `XorShiftRandom.insideUnitCircle`.
3. `LEGACY.md` anlegen mit der Tabelle aus §5 — **ab hier laufend gefüllt, nicht am Ende**.
4. Ordner `shared/src/dungeon2/` mit Platzhaltermodulen, damit der Test etwas zu scannen hat.

Dateien: `shared/src/dungeonGenerator.ts`, `shared/src/campGenerator.ts`, `server/src/world/ZoneManager.ts` (o.ä.
Aufrufstelle), `shared/test/dungeon2-schichten.ts`, `LEGACY.md`.

**Prüfkriterium (Messung):** `npm run typecheck` grün in `shared/`, `server/`, `client/`; der bestehende
Camp-/Zonentest läuft unverändert durch; der neue Schichtentest scheitert nachweislich, wenn man probeweise
`import { Vector3 } from '@babylonjs/core'` in ein Platzhaltermodul schreibt (**negativ geprüft, nicht nur
positiv** — ein Test, der nie rot war, ist kein Test).

**Vorsicht:** 37 Dateien im Repo sind CRLF. Ein Python-Massenumbau liest sie still auf LF um — beim Teilen der
Datei Zeilenenden prüfen.

---

### AP1 — `layout.ts` + `hashing.ts`
**Modell: Opus** (Format-Entscheidungen mit Langzeitfolgen). **Braucht: AP0.**

Umfang: §3.2–§3.6 dieses Dokuments als Code. Typen, Konstanten, `kanonisch()`, `layoutPruefsumme()` (FNV-1a),
`migriere()`-Gerüst. `hashing.ts`: `mische(seed, salt)` und `hashPos(x, z, ebene, seed)`, beide
`Math.imul`-basiert, mit einer eingefrorenen Werte-Tabelle im Test.

Dateien: `shared/src/dungeon2/layout.ts`, `shared/src/dungeon2/hashing.ts`,
`shared/test/dungeon2-layout.ts`.

**Prüfkriterium (Messung):** (a) Ein von Hand geschriebenes Zwei-Raum-Layout wird kanonisiert und ergibt eine
eingefrorene Prüfsumme; (b) dieselben Daten in **anderer Feld- und Array-Reihenfolge** ergeben **dieselbe**
Prüfsumme; (c) `hashPos` liefert für 1000 eingefrorene Eingaben identische Werte in Node und im Browser-Bündel;
(d) ein Layout mit einer eingeschmuggelten Fließkommazahl wird von der Typprüfung **und** von
`validateLayout` abgelehnt.

---

### AP2 — `cells.ts` + `validation.ts`
**Modell: Opus.** **Braucht: AP1.**

Umfang: `zellenAufbauen()` (Stempel nach `ordnung`, dann Korrekturen), `wandZwischen()` mit der symmetrischen
Regel aus §3.3, `zellKanteZuQuader()` (die eine geteilte Kantenfunktion), `stempelSetzen`/`stempelEntfernen`,
alle Invarianten aus §3.7 als `Befund[]` mit stabilem `regel`-Kurznamen.

Dateien: `shared/src/dungeon2/cells.ts`, `shared/src/dungeon2/validation.ts`,
`shared/test/dungeon2-invarianten.ts`.

**Prüfkriterium (Messung):** (a) **Symmetrietest**: für 10.000 zufällig (seed-fest) erzeugte Zellpaare gilt
`wandZwischen(A,B) === wandZwischen(B,A)` — der Test, der die „kleinerer Index gewinnt"-Falle fängt;
(b) jede Invariante hat einen Positiv- **und** einen Negativfall, der Negativfall muss den erwarteten
`regel`-Namen liefern; (c) `zellenAufbauen()` ist idempotent und reihenfolgeunabhängig: dieselben Stempel in
gemischter Array-Reihenfolge (bei gleicher `ordnung`) ergeben dasselbe Gitter.

---

### AP3 — `builder.ts`
**Modell: Opus** (die fünf Vertragsregeln sind subtil). **Braucht: AP2.**

Umfang: `baueGeometrie(layout, auswahl?)` nach §3.8. Böden, Wände, Decken, Stufen, Türrahmen als Quader;
`kollision` als getrennte Box-/Rampenliste; `nav`; `dekoPlaetze` in Metern; `blend`-Attribute
(`hoeheUeberBoden`, `kantenAbstand`) je Ecke; `spawnPunkt`; `huelle`.

Dateien: `shared/src/dungeon2/builder.ts`, `shared/test/dungeon2-builder.ts`,
`shared/test/dungeon2-paritaet.ts`.

**Prüfkriterium (Messung) — das wichtigste Paket, drei Tests:**
1. **Paritätstest** (die Übersetzung von WoCs `rift_wall_render_parity.test.ts`): *Jede gezeichnete Wandfläche
   liegt auf Kollision, und jeder Wand-Kollisionskörper ist visuell gedeckt.* Mittellinien werden abgetastet
   (Schrittweite 1 m, Enden um 0,15 m eingezogen), gegen aufgeblähte Körper geprüft, gesweept über ≥50 Seeds und
   alle Ebenen. **Beide Richtungen** — Lücken sind symmetrisch, es gibt sie als Loch und als Überhang.
2. **Blockweise Gleichheit:** `baueGeometrie(l)` und die Vereinigung von `baueGeometrie(l, {bloecke:[b]})` über
   alle Blöcke sind identisch, auch bei zufälliger Blockreihenfolge. Das ist die messbare Fassung von „der Bauer
   hasht, er zieht nicht".
3. **Kein Haarriss:** über ein 60×60-Zellen-Layout darf keine zwei benachbarten Bodenstücke eine Lücke > 1e-6 m
   trennen. Das ist der Multiplikations-statt-Addition-Beweis.

---

### AP4 — `generator.ts` + `themen.ts`
**Modell: Opus.** **Braucht: AP2** (kann parallel zu AP3 laufen).

Umfang: Phasen P0–P10 nach `data-model.md` §2.3, Thema `steingrab`. Zielgröße in **Zellen**, nicht in Räumen.
Ausdrückliche **Schleifenphase P5** — ohne sie ist jeder erzeugte Dungeon ein Baum, und Bäume laufen sich als
Sackgassenparcours an. Validierung mit **deterministischem Rückfall** auf eine einfache Form (nie neu würfeln —
neu würfeln kostet Determinismus-Klarheit). Garantiertes Rückgrat (§3.7, letzte Zeile).
Die gesamte `endcaps*`-Familie des Altgenerators entfällt ersatzlos (163 gemessene Notfallsetzungen über 40 Seeds
lösten ein Problem, das nur existiert, wenn Wände Bauteile mit Platzbedarf sind).

Dateien: `shared/src/dungeon2/generator.ts`, `shared/src/dungeon2/themen.ts`.

**Prüfkriterium (Messung):** über 200 Seeds: (a) `validateLayout` liefert **null** Befunde der Schwere `fehler`;
(b) Zellenzahl liegt in `zielZellen`; (c) Schleifenanteil > 0 (mindestens ein Zyklus im Raumgraphen) bei
≥ 90 % der Seeds; (d) kein Seed erzeugt einen unerreichbaren Raum; (e) **Reihenfolge-Stabilität**: das Einfügen
einer zusätzlichen Ziehung in P9 (Deko) verändert **kein** einziges Stempel-Feld — das misst, ob die
Stromtrennung wirklich trägt.

---

### AP5 — Determinismus-Prüfstand Node ↔ Browser
**Modell: Sonnet** (Fleißarbeit, aber unverzichtbar). **Braucht: AP4.**

Umfang: `shared/test/dungeon2-determinismus.ts` erzeugt 100 Seeds und vergleicht gegen eingefrorene Prüfsummen
(Layout **und** `BauErgebnis`). Derselbe Vergleich läuft zusätzlich **im Browser-Bündel** — das ist die Lehre aus
„Node-Krypto ist nicht Browser-Krypto", eine Ebene tiefer.

Dateien: `shared/test/dungeon2-determinismus.ts`, `shared/test/golden/dungeon2-*.json`, Browser-Prüfseite.

**Prüfkriterium (Messung):** 100/100 Prüfsummen identisch in Node **und** im Browser. Bei Abweichung wird der
erste abweichende Seed samt Phase gemeldet, nicht nur „ungleich". Vorsicht: Das Vorschau-Bündel erneuert kein
Build-Schritt — nach jedem Bauen `vite preview` neu starten, sonst misst man still den alten Stand.

---

### AP6 — `DungeonBuilder.ts` im Client (graue Kästen)
**Modell: Opus** (Havok- und Lebenszyklus-Fallen). **Braucht: AP3, AP4.**

Umfang: je (Block × `materialTag`) ein gemergtes Mesh mit Standardmaterial in Grau; `blend`-Werte nach `uv2`;
`PhysicsShapeMesh`/Box-Verbund je Block **aus `kollision`**, nicht aus der Sichtgeometrie; `freezeWorldMatrix()`,
`material.freeze()`, `scene.blockMaterialDirtyMechanism` beim Bau; `dungeonBereit`-Zusage (der Ladebildschirm
blendet erst aus, wenn die Blöcke um den Spawn stehen — in einer Instanz gibt es kein `terrain.ready`);
Ressourcenbesitz je Instanzwurzel mit „geteilt"-Markierung, weil `mesh.dispose(_, true)` sonst das geteilte
Dungeon-Material für **alle** laufenden Instanzen abschießt.

Dateien: `client/src/engine/DungeonBuilder.ts`, Anbindung in der Weltwechsel-Logik.

**Prüfkriterium (Messung, headless):** (a) Draw-Call- und Mesh-Zahl je Block ausgezählt und gegen die erwartete
Formel (Blöcke × belegte materialTags) geprüft; (b) ein Spielercharakter, headless über das Layout geschoben,
fällt an keiner Stelle durch den Boden und bleibt an keiner Kante hängen — **Strecke messen, nicht Zeit**
(bei fester Zeit misst sich schnellerer Code teurer); (c) Instanz auf- und abbauen ×20: Mesh-, Material- und
Texturzahl der Szene kehrt exakt auf den Ausgangswert zurück.
Headless Chromium braucht die GPU — ohne ANGLE-Flags rendert SwiftShader und jede Messung ist wertlos.

---

### AP7 — Erstes Rendering für Mike
**Modell: Sonnet.** **Braucht: AP6.**

Umfang: Screenshot-Serie aus dem lokalen Client über ein erzeugtes Steingrab — Übersicht von oben, drei
Innenansichten, eine Treppe, ein Durchgang. Dazu die Messwerte aus AP6.

**Prüfkriterium: Mikes Blick.** Das ist die erste Stelle, an der ein Bild entscheidet. Vorher wird nichts
ausgerollt. Messungen laufen lokal gegen den Tunnel :5274 — auf wov-dev startet Chromium nicht.

---

### AP8 — Babylon-Recherche (kann früh und parallel laufen)
**Modell: Opus.** **Braucht: AP0.**

Vier Fragen, alle **am installierten Babylon 8.0.0 nachgemessen, nicht aus der Erinnerung**:
1. Die exakten `CUSTOM_*`-Injektionsmarken des PBR-Fragmentshaders für Albedo / Normale / Reflectivity / AO und
   ihre Reihenfolge. `NebelRichtung.ts` zeigt, warum: derselbe Include heißt in `default.fragment` `color` und in
   `pbr.fragment` `finalColor`.
2. Ob `Material.clone()` Plugins überträgt. Wenn nicht, brauchen wir WoCs Wiederanheft-Spezifikation.
3. Sampler- und Uniform-Budget am realen Dungeon-Wand-Material **gemeinsam** über alle fünf Plugins
   (`StandardGammaFix`, `PbrNebelFix`, `NebelRichtung`, `FackelLicht`, Triplanar) plus Shadow-Maps plus
   Environment-Probe, gegen `engine.getCaps()`. Vorbild für die Laufzeit-Kapazitätsprüfung mit Fallback:
   `FackelLicht.ermittlePlaetze()`.
4. Trägt `Texture2DArray` KTX2/Basis Universal in dieser Version? (Risiko R4.)

**Prüfkriterium (Messung):** ein Miniprogramm gibt den **aufgelösten** Fragment-Shader-Quelltext eines
PBR-Materials mit allen vier bestehenden Plugins aus, und die vier Marken sind darin mit Zeilennummer belegt.
Steht die Meldung nicht im Quelltext, läuft nicht der Quelltext.

---

### AP9 — Material-Bake in Blender
**Modell: Opus** (Node-Graphen), **Ausführung parallel zu AP1–AP7.**

Umfang: `tools/bake-barrow-materials.py` nach `material-plan.md` §4 — sechs Basismaterialien (Tags 0–5) plus die
vier Overlays (6–9). Blender headless über Flatpak, absolute Pfade unter `$HOME`, `--factory-startup`, offene
Sitzung nie anfassen. Seed je Material aus `seed * 100 + index`, nicht nur global. Szene je Material neu
aufgebaut und verworfen. Kontroll-Thumbnail je Material.
**Achtung, korrigiert gegenüber `material-plan.md`:** der dritte Kanal ist **ORH (Occlusion/Rauheit/Height)**,
Metallic ist eine Konstante je Layer (W5).

**Prüfkriterium (Messung):** zwei Läufe mit gleichem Seed liefern byte-identische PNGs; ein Lauf mit vertauschter
Material-Reihenfolge liefert für die unveränderten Materialien **dieselben** Bytes (das ist der eigentliche Test
der Seed-Ableitung). Danach: Thumbnails an Mike.

---

### AP10 — `DungeonMaterial.ts` (Triplanar + Blending)
**Modell: Opus.** **Braucht: AP7, AP8, AP12.**

Umfang: `MaterialPluginBase`, Priorität ~10 (vor der Lichtrechnung, weit vor `StandardGammaFix` 100).
Dominanz-Kollaps nach W11 mit Ein-Tap-Schnellpfad. Whiteout-Normal-Blend (RNM erst, wenn das Bild es verlangt).
Drei `sampler2DArray` (Albedo / Normal / ORH), Metallic als Layer-Konstante. Blending aus `uv2`: Moos (Höhe UND
Normale, UND-verknüpft), Feuchte (`kantenAbstand`), Schmutz (Höhe), Risse (Value-Noise aus `hashwerk`-Hash mit
`seeds.material`, **derselbe Hash wie im Bauer**, W8). Tier-Werte als **Defines**, nicht als Uniforms, sonst
rekompiliert Babylon beim Stufenwechsel nicht. `setzeStufe()` + `markAllDefinesAsDirty()` wie
`FackelLichtPlugin.setzeAn()`. Uniforms in den **bestehenden Material-UBO-Block**, keinen neuen aufmachen.
**Notbremse-Muster ist Pflicht, nicht Kür** (`FackelLicht.fackelNotbremse()`): ein Compile-Fehler in einem Theme
darf nicht den ganzen begehbaren Dungeon unsichtbar machen. Plus ein Dev-Killschalter (`?triplanar=off`), damit
A/B-Messung ohne Codeänderung geht.

Dateien: `client/src/engine/DungeonMaterial.ts`, `client/src/engine/DungeonAtmosphere.ts` (nur SSAO in M1).

**Prüfkriterium (Messung vor Bild):**
1. **Shader-Textprüfung ohne GPU** (WoCs `worn_stone_shader.test.ts`-Muster): `getCustomCode()` je Stufe direkt
   aufrufen und den erzeugten Quelltext prüfen — Niedrig enthält keinen Blending-Block, Hoch enthält den
   Parallax-`#ifdef`. Das ist die einzige Art, Tier-Regressionen ohne GPU zu fangen.
2. **fps auf Stufe Mittel** im Testgrab, gemessen über **Strecke**, nicht Zeit; Ziel 60 auf Mittelklasse.
   Eine Messung unter den Voreinstellungen ist keine Messung für den, der sie geändert hat.
3. Dungeon-kalibriertes SSAO: eigene `maxZ` (Bereich 30–60 m statt der für die 4-km-Außenwelt kalibrierten 1000)
   und `radius` **gemessen**, nicht von außen übernommen.

---

### AP11 — Zweites Rendering + Messreihe
**Modell: Sonnet.** **Braucht: AP10.**

Bilderserie mit Material, dazu die fps-Tabelle über die drei Stufen und die Draw-Call-Zahlen.
**Prüfkriterium: Mikes Blick** gegen das Barrow-Referenzbild. Whiteout gegen RNM wird hier optisch entschieden,
nicht vorher theoretisch.

---

### AP12 — `tools/pack-material-arrays.py`
**Modell: Sonnet.** **Braucht: AP9.** (Diese Aufgabe steht in keinem der fünf Dokumente — sie ist die Lücke
zwischen Material-Plan und Render-Technik, siehe W5.)

Umfang: sechs PNG-Sätze → drei Layer-Stapel gleicher Auflösung und gleichen Formats → KTX2 (`toktx`), plus eine
`materialArrayIndex.json`, die Layer-Index, Metallic-Konstante und Kachelmaß je Material festhält.

**Prüfkriterium (Messung):** Alle Layer haben identische Auflösung und identisches Format (hart geprüft, nicht
angenommen); das erzeugte Array lädt im Client und ein Testquad zeigt Layer *n* für jedes *n*; Dateigröße und
Ladezeit protokolliert.

---

### AP13 — Adapter an die Instanz-Infrastruktur
**Modell: Opus** (hier hängen die drei gelösten Fallen aus der Vault-Notiz). **Braucht: AP7.**

Umfang nach `data-model.md` §4: `DungeonDokument2` mit `version >= 10` als Weiche im Sanitizer;
`materialisiere2()` — ZDOs **nur** für Bewegliches/Interaktives (Architektur bekommt keine ZDOs mehr, Größenordnung
ein Fünftel); `getSpawnPoint()` → `BauErgebnis.spawnPunkt`; `dekoAngleichen()` → `ankerAngleichen()`
(**Deko ändern reißt die Instanz nicht ab** — sonst teleportiert jede gesetzte Fackel den Spieler an den Eingang);
`upsertDocument` vergleicht Prüfsummen statt `JSON.stringify`; Teleportpaket trägt `thema`, `seeds`, `pruefsumme`;
`RPC_DungeonLayout` für `modus: 'gebaut'`.

**Objekt-IDs kommen aus der Layout-Position (Zellindex + Rolle), nie aus der Ziehreihenfolge** — sonst wandert der
ZDO-Zustand einer geöffneten Truhe auf eine andere, sobald sich irgendetwas an der Generierung ändert.
`layoutVersion` gehört ins Instanz-Dokument: unsere Instanzen sind persistent (WoC-Läufe sind es nicht), ohne
dieses Feld ist jeder Generator-Commit eine stille Datenmigration.

**Unverändert bleibt:** die komplette Eingangs-Registry, `getOrCreateInstance`/`destroyInstance` samt
ZDO-Zerstörungsreihenfolge, `tick()`, `enterDungeon`/`leaveDungeon`, `charakterUmziehen`, das Leeren von
`knownZDOs`, das Zerstören des alten Charakter-ZDOs vor dem Wechsel.

**Prüfkriterium (Messung):** (a) ein 2.0-Dokument läuft nachweislich **nie** durch den Alt-Sanitizer und
umgekehrt (beide Richtungen getestet); (b) Betreten/Verlassen ×20 ohne ZDO-Leck und ohne verlorenen Spielerstand;
(c) eine Deko-Änderung erzeugt **keinen** Instanz-Abriss (Spieler bleibt stehen, wo er stand); (d) ZDO-Zahl je
Instanz vor/nach gegenübergestellt.

---

### AP14 — Ausrollen auf wov-dev
**Modell: Sonnet.** **Braucht: AP13, AP11.**

Umfang: Nur auf `wov-dev` (CT 102, `10.10.10.12`, Alias `wov-bau`), nie live. Leak- und Sichtbarkeitstest aufs
neue System portiert. `server.yml`-Flags erreichen laufende Clients nicht — bei „bei mir anders" zuerst den Stand
vergleichen; der Layout-Deskriptor darf nichts enthalten, was der Client aus Server-Einstellungen ableiten müsste.

**Prüfkriterium:** Messung (fps, Ladezeit bis `dungeonBereit`, ZDO-Zahl) → Rendering (Bilderserie von wov-dev) →
**Mikes Blick**. Erst danach gilt Meilenstein 1 als erreicht.

---

### Danach (nicht Meilenstein 1)

AP15 Editor-Modul (`client/src/editor/dungeon2/`, sechs Dateien, Andockpunkt `shell.betriebsart('dungeon2', …)`
**neben** `dungeons`, kurzlebiger `GameSocket(nurEditor=true)` je Speicherklick, `schmutzig`-Muster, Live-Vorschau
über denselben Bauer) · AP16 Parallax · AP17 SSR (erst `ScreenSpaceReflectionPostProcess` messen, PrePassRenderer
nur wenn das Bild es erzwingt) · AP18 Godrays nur an editor-markierten Lichtschächten · AP19 Themes Sumpf/Eis/Feuer
· AP20 der eine Lösch-Commit nach Mikes Abnahme.

Für AP15 gilt unverändert: **Der Editor darf zum Erproben nicht in Mikes `dev.json` schreiben** (eigene
Erprobungskopie), und vor jedem Schreiben werden Änderungszeiten geprüft (parallele Sitzungen).

---

## 5. LEGACY-Liste (Vorlage für `LEGACY.md`)

Regel: **markieren, nicht löschen.** Sammelliste ab AP0 laufend füllen, **ein** Lösch-Commit nach Mikes Abnahme.

### 5.1 Vorher teilen — sonst stempelt man die Oberwelt mit

`shared/src/dungeonGenerator.ts` enthält ab Zeile 623 `generateCampLayout`/`CampGround` — **Oberweltinhalt für
Dörfer, Höfe und Goblinlager, der weiterlebt.** Erst teilen (AP0), dann stempeln.
Dasselbe kleiner in `shared/src/dungeons.ts`: die Datei bleibt (Camps, `getDungeonByHash`, `ENTRANCE_HULL_MODELS`,
`isValidDungeonId`, `interiorEnvironment`), nur ihr Abschnitt „Layout & document" wird LEGACY-Block.

### 5.2 Die Liste

| Datei / Symbol | Status | Grund |
|---|---|---|
| `shared/src/dungeonGenerator.ts` (ohne Camps) | **LEGACY** | Connector-Kopplung ersetzt durch Zellen |
| ↳ `generateDungeonLayout`, `DungeonGeneratorSettings`, `DEFAULT_GENERATOR_SETTINGS` | LEGACY | inkl. `endcaps*`, `roomsFlipped`, `roomsInsetSize`, `roomBodyFromFloor` — alle lösen Bauteilprobleme, die es nicht mehr gibt |
| ↳ `attachRoom`, `removeRoom`, `computeOpenConnections`, `OpenConnection` | LEGACY | ersetzt durch `stempelSetzen`/`stempelEntfernen` |
| ↳ `generateCampLayout`, `CampGround` | **bleibt** → `shared/src/campGenerator.ts` | Oberwelt |
| `shared/src/dungeonFlatten.ts` | **LEGACY** | Layout → Raum-GLB-Instanzen; Architektur ist keine Prefabliste mehr |
| `shared/src/dungeonRaster.ts` | **LEGACY** | prüft GLB-Bauteile, die es nicht mehr gibt. **Konstanten und Herleitung wandern nach `dungeon2/layout.ts`** |
| `shared/src/eigeneDungeons.ts` (`DG_Steingrab`, 687 Z.) | **LEGACY** | RoomDefs mit Connectors; `propTypes` wandert nach `dungeon2/themen.ts` |
| `shared/src/dungeons.ts` — `RoomDef`, `RoomConnectionDef`, `PlacedRoom`, `PlacedDoor`, `PlacedProp`, `DungeonLayout`, `DungeonPropDef`, `sanitizeDungeonDocument`, `MAX_DUNGEON_*`, `DUNGEON_DOCUMENT_VERSION` | **LEGACY-Block** | Altformat; Rest der Datei bleibt |
| `shared/src/roomPieces.ts`, `roomPiecesData.json` (4,9 MB) | **LEGACY für Dungeons** | wird nur noch von Camps gelesen; nach dem Umbau prüfen, ob Camps wirklich alle 289 Räume brauchen |
| `shared/test/dungeon-generator.ts`, `shared/test/dungeon-raster.ts` | **LEGACY** | ersetzt durch `dungeon2-determinismus.ts`, `-invarianten.ts`, `-builder.ts`, `-paritaet.ts`, `-schichten.ts` |
| `server/src/world/dungeon/DungeonManager.ts` — `materialize()`, `dekoAngleichen()`, `getSpawnPoint()` | **ersetzt** | Rest der Klasse bleibt unverändert |
| `client/src/ui/DungeonEditor.ts` (F4) | **LEGACY** | baut über Connectors |
| `client/src/ui/DecorPlacement.ts` | **LEGACY** | setzt `PlacedProp` mit `roomIndex` |
| `client/src/editor/DungeonFloorplan.ts`, `DungeonCatalog.ts`, `DungeonDocument.ts`, `DungeonSpeichern.ts` | **LEGACY** | Raumbibliothek + Connector-Grundriss; ersetzt durch `editor/dungeon2/` |
| `client/src/engine/Physics.ts` — Mesh-Collider-Zweig für Dungeon-Räume (`kind: 'mesh'`, ~Z. 134/143/553) | **LEGACY-Zweig** | Kollision kommt aus `BauErgebnis.kollision`, nicht aus dem Mesh |
| `tools/steingrab-erzeugen.py`, `tools/dungeon-zusammensetzen.py` | **LEGACY** | erzeugen Architektur-GLBs |
| `assets/models/Steingrab*.glb` (außerhalb des Repos) | **LEGACY** | Mike sichert `assets/` selbst — **nicht löschen**, nur aus `EIGENE_MODELLE` nehmen |
| `shared/src/prefabs.ts` — Steingrab-Einträge in `EIGENE_MODELLE`/`MODELL_ALIAS` | **LEGACY-Einträge** | müssen mit dem Kit fallen, sonst zeigt die Registry auf Modelle ohne Verwender |

**Nicht LEGACY, obwohl es danach aussieht:** die Eingangshüllen (`ENTRANCE_HULL_MODELS`, `spawnEntranceHull`) sind
Oberweltmodelle und haben mit dem Dungeoninneren nichts zu tun. Tripo bleibt für Deko und Unikate (Altäre,
Statuen, Türen, Truhen) — nur Flächen sind Vergangenheit.

---

## 6. Offene Risiken — ehrlich

**R1 — Der Server prüft heute keine Kollision.** Der Beschluss sagt „Server braucht den Bauer für Kollision",
der Ist-Zustand ist ein reiner Client-Havok mit aus GLBs gemessenen Formen. Wir bauen den Vertrag so, dass der
Server die Kollision *bekommen kann*, führen sie in Meilenstein 1 aber nicht ein (W10). Das Risiko ist nicht
technisch, sondern erwartungsseitig: Wer „Server prüft Kollision" liest, könnte glauben, Cheat-Sicherheit sei Teil
dieses Meilensteins. Sie ist es nicht.

**R2 — `HOEHEN_SCHRITT_M = 0.5` und `BLOCK_ZELLEN = 8` sind gesetzt, aber nicht gemessen.** Beide sind
Formatkonstanten: Ändert sich der Höhenschritt nachträglich, ändert sich jede gespeicherte Höhe. Ändert sich die
Blockgröße, ändert sich die Draw-Call-Verteilung und der Ladefortschritt. Der Höhenschritt sollte **vor** dem
ersten Thema festliegen, die Blockgröße darf bis zur ersten Messung auf Stufe Mittel offen bleiben (sie steht im
Dokument, ist also migrierbar).

**R3 — Die Babylon-Injektionsmarken sind unbekannt.** AP8 misst sie; bis dahin ist `DungeonMaterial.ts` nicht
planbar. Wenn die Marken nicht das leisten, was WoCs `onBeforeCompile`+Chunk-Replace leistet, kann Triplanar
teurer oder umständlicher werden als geplant. Rückfallebene: `NodeMaterial` statt GLSL im Plugin — mehr
Wartbarkeit, weniger Kontrolle, und die Grafikstufen-Defines müssten anders gelöst werden.

**R4 — KTX2/Basis Universal in `Texture2DArray` ist unverifiziert.** Wenn die Kombination nicht trägt, bleiben
zwei Wege: unkomprimierte Arrays (mehr VRAM, für sechs 1K-Layer noch tragbar) oder Einzeltexturen mit
Material-je-Tag (mehr Draw Calls, aber bei sechs Materialien überschaubar). Das entscheidet AP8, bevor AP9/AP12
sich festlegen.

**R5 — Der Dominanz-Kollaps ist eine Hypothese über unsere Geometrie.** Er zahlt sich nur aus, wenn Flächen
achsnah sind. Sobald Schrägen, Gewölbe oder gedrehte Stempel häufig werden, fällt der Ein-Tap-Schnellpfad weg und
Triplanar kostet wieder das Dreifache. Messen an einem Grab **mit** Treppen und gedrehten Sälen, nicht an einem
Rechteckraum.

**R6 — Parallax auf Triplanar bleibt teuer, auch auf einer Ebene.** Der Plan (Offset-Limiting, 4–8 Taps, nur
dominante Ebene, nur Stufe Hoch) ist eine begründete Schätzung, keine Messung. Fällt sie schlecht aus, entfällt
Parallax ersatzlos — das Leitbild („flächig, nicht jede Fuge in echter Tiefe") verlangt ihn nicht.

**R7 — SSR ist die riskanteste Einzelentscheidung.** Echtes SSR2 braucht den PrePassRenderer, den das Projekt
bisher bewusst meidet (fehlender Side-Effect-Import bei den granularen Imports). Das wären **zwei** getrennte
Vollgeometrie-Passagen neben dem GeometryBufferRenderer. Deshalb außerhalb von Meilenstein 1, und dann erst die
einfache Variante messen.

**R8 — Godrays sind vermessen teuer** (40 → 17 fps in der Außenwelt bei Ratio 0.5/100 Samples). Die Hoffnung,
dass Innenräume billiger sind, ist eine Hypothese. Deshalb: nur an editor-markierten Lichtschächten, nie pro
Fackel — bei 16 Fackeln je Instanz wäre das dieselbe Kostenexplosion.

**R9 — Eigenbau der Materialien kostet eine Woche statt eines Tages**, und handgebaute Fels-/Holzmaserung kann
weniger organisch wirken als ein Fotoscan-Derivat. Bewusst akzeptiert, weil das Leitbild ruhige, flächige Formen
verlangt, nicht Natur-Authentizität — aber es ist ein realer Aufwandsposten, und die ColorRamp-Stützstellen sind
ein iterativer Blender-Termin mit Mike, kein Code-Schreibvorgang.

**R10 — Die Migration bestehender Dungeons ist nicht geplant.** 2.0-Dokumente und Altdokumente koexistieren über
die Versionsweiche; ein bestehendes Steingrab wird **nicht** ins neue Format überführt. Solange der Altbestand
parallel läuft, ist das richtig. Beim Lösch-Commit wird es eine Entscheidung: Altdungeons neu erzeugen (Spielstände
in ihnen gehen verloren) oder das Altformat länger tragen.

**R11 — `oberflaeche` ist ein Bitfeld ohne festgelegte Bedeutung.** Es ist im Format v1 reserviert, aber die
Bit-Belegung (Moos/Feuchte/Ruß/Riss erzwungen oder verboten) steht noch nicht. Das ist absichtlich offen, bis das
Material tatsächlich läuft — aber es ist ein Feld im eingefrorenen Format, dessen Semantik später kommt. Wer es
vorher benutzt, benutzt es falsch.

**R12 — Die zweisprachige Kommentar-Regel ist leicht zu vergessen** und hat kein Symptom, wenn sie verletzt wird.
Empfehlung: ein Lint-Schritt, der neue Dateien unter `dungeon2/` auf Kommentarblöcke ohne zweite Sprache hinweist —
mindestens aber ein Punkt auf jeder Paket-Abnahme.
