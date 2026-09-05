<!-- Hilfsmittel: das Inventar dieses Ordners — welche Datei woher kam und wozu sie da ist. -->

# Elemente — Skripte, die Dungeon-Bausteine erzeugen und prüfen

Dieser Ordner sammelt an einer Stelle, was bis zum 04.09.2026 an drei Orten
lag: `tools/` im Repo, `~/wov-ai/elements/` und `~/wov-ai/pipeline-1.0/`
ausserhalb. Der Kit, an dem gerade gearbeitet wird (`DG_StoneVault`), war der
einzige, dessen Bauskript nicht im Repo stand — ein Skript ausserhalb des
Repos ist ein Skript, das beim nächsten Checkout fehlt.

Es gilt die Regel aus `tools/README.md`: **Alles hier ist Rezept, nicht
Ergebnis.** Die Ausgabeordner `out/` und `preview/` der Quellorte sind
deshalb bewusst *nicht* mitgezogen worden — sie stehen weiterhin dort, wo
sie entstanden sind.

Seit S2 (04.09.2026) sind die Quellordner **geleert**: `~/wov-ai/elements/`
und `~/wov-ai/pipeline-1.0/` enthalten nur noch ihre
`~/wov-ai/…/VERSCHOBEN.md` und ihre Ergebnisordner. Was hier liegt, ist
damit die einzige Fassung.

## Kopfzeilen-Konvention

Die erste Kommentarzeile jeder Datei beginnt mit genau einem dieser drei
Wörter — eine Shebang-Zeile davor zählt nicht mit:

| Wort | Bedeutung |
|---|---|
| `Erzeugt:` | Das Skript **baut** etwas: Geometrie, eine Textur, ein Nachweisbild. |
| `Prüft:` | Das Skript **misst** an etwas Bestehendem und meldet Zahlen oder ein Bild zur Beurteilung. |
| `Hilfsmittel:` | Alles andere: Sammelskripte, Browser-Aufnahmen, Doku. |

`tools/elements/pruefe-koepfe.mjs` hält die Konvention fest. Er hängt in
`scripts/run-tests.mjs` als schneller, **assetfreier** Prüfer — er liest
nur Text, braucht weder `assets/` noch Blender noch eine GPU.

Der Ordnername sagt, **wo** ein Skript hingehört, das Kopfwort sagt, **was**
dabei herauskommt. Beides fällt nicht immer zusammen: `blender/` ist der Ort
der Bauskripte, und `dach-raster.py` liegt dort, weil es zur Dach-Werkbank
gehört — es misst aber, und trägt deshalb `Prüft:`.

## Zwei wiederkehrende Aufrufformen

```bash
flatpak run org.blender.Blender --background --factory-startup \
  --python tools/elements/blender/<skript>.py -- <argumente>
node tools/elements/pipeline/<skript>.mjs <argumente>     # oft mit Playwright
```

Die Bauskripte nehmen ihr Ziel als Argument (`make-stonevault.py`:
`OUT = ARGS[0]`), die Sonden bekommen den GLB-Ordner übergeben.

## Orte: kein Skript kennt einen Pfad ausserhalb des Repos

Das ist die Zusage von S2, und sie ist der eigentliche Inhalt des Umzugs:
Ein Skript, das `~/wov-ai/…` fest verdrahtet hat, ist **auf Mikes Rechner**
umgezogen und sonst nirgends — es findet seine Datei ja weiterhin am alten
Ort. Rot wird das erst beim nächsten Checkout, und dann erklärt es niemand
mehr. Deshalb gilt:

| Was | Woher | Vorgabe |
|---|---|---|
| Eingabe-GLBs | `$WOV_MODELLE` | `assets/models` dieses Repos |
| Ergebnisse (GLB, PNG) | `$WOV_ELEMENTE_AUS` | `~/wov-elemente` — **ausserhalb** des Repos, denn Ergebnis ist kein Rezept |
| Quelltexturen | `pipeline/quellen/` | liegen seit S1 im Repo |

`tools/elements/pruefe-pfade.mjs` hält das fest und hängt neben dem
Kopfzeilen-Wächter in `scripts/run-tests.mjs`. **Kommentare sind
ausgenommen:** Woher eine Datei kam, gehört in ihren Kopf — verboten ist der
fremde Ort dort, wo ihn ein Lauf benutzt.

Die `ALIAS`-Tabelle in `dach-sonde.py`/`strahl-sonde.py`/`render-szene.py`
ist keine Pfadtabelle, sondern eine Namenstabelle (`StoneVaultEntry` teilt
sich die GLB mit `StoneVaultCell`, wie `MODELL_ALIAS` im Client). Sie ist
unverändert mitgewandert.

## Inventur

Aufgenommen **vor** dem Bewegen, gegen die Quellordner in dem Zustand vom
04.09.2026. 43 Dateien plus fünf Quelltexturen sind aus `~/wov-ai/` kopiert
(zunächst kopiert, nicht verschoben; seit dem Kit-Neubau von S2 sind die
alten Orte geleert und tragen nur noch ihre `~/wov-ai/…/VERSCHOBEN.md`).
Eine Datei kam per `git mv` aus dem Repo selbst, fünf sind hier entstanden.

### Wurzel — aus `~/wov-ai/elements/`

| Datei | Zielpfad | Zweck |
|---|---|---|
| `modulFormat.md` | `tools/elements/modulFormat.md` | Hilfsmittel: die verbindliche Modul-Konvention (Raster, Zelle, Achsen, Connectoren) — `shared/src/dungeonRasterModul.ts:1-3` zitiert sie namentlich. |

### blender/ — baut Geometrie und Nachweisbilder (aus `~/wov-ai/elements/`)

| Datei | Zielpfad | Zweck |
|---|---|---|
| `make-stonevault.py` | `tools/elements/blender/make-stonevault.py` | Erzeugt: die Module des Kits DG_StoneVault als GLB — Zelle, Wand, Bogen, Korridor, Ecke, Abzweig, Treppe und die fünf Säle. |
| `make-steingrab-treppe-col.py` | `tools/elements/blender/make-steingrab-treppe-col.py` | Erzeugt: SteingrabTreppe.glb neu — gedreht und um ein `_col`-Netz ergänzt, ohne Blender direkt auf der GLB. |
| `make-elements.py` | `tools/elements/blender/make-elements.py` | Erzeugt: die Rohlinge der ersten Element-Bibliothek (WandPaneel, Bodenplatte, Deckenplatte) als GLB. |
| `compose-cells.py` | `tools/elements/blender/compose-cells.py` | Erzeugt: das M1-Nachweisbild aus Zellen — Gang plus Seitenraum, Innenblick mit 20 mm Brennweite. |
| `compose-cells-haus.py` | `tools/elements/blender/compose-cells-haus.py` | Erzeugt: dasselbe M1-Nachweisbild als Außenansicht (34 mm), damit der Baukörper als Ganzes sichtbar wird. |
| `compose-cells-plan.py` | `tools/elements/blender/compose-cells-plan.py` | Erzeugt: dasselbe M1-Nachweisbild als orthografischen Grundriss von oben — das Raster ist nur dort nachmessbar. |
| `compose-cells-uebersicht.py` | `tools/elements/blender/compose-cells-uebersicht.py` | Erzeugt: dasselbe M1-Nachweisbild als Übersicht schräg von oben (22 mm, Kamera über dem Gang-Eingang). |
| `compose-corridor.py` | `tools/elements/blender/compose-corridor.py` | Erzeugt: die Innenansicht eines aus Rohlingen gesetzten Korridors — der Beweis, dass ein Raum aus Elementen entsteht. |
| `elevation.py` | `tools/elements/blender/elevation.py` | Erzeugt: die orthografische Frontansicht mehrerer Wandpaneele nebeneinander — zeigt, ob das Ziegelmuster über die Paneelgrenze läuft. |
| `gallery.py` | `tools/elements/blender/gallery.py` | Erzeugt: das Galeriebild der Modul-Bibliothek im Dreiviertelblick. |
| `dach-raster.py` | `tools/elements/blender/dach-raster.py` | Prüft: eine Dachaufsicht auf Löcher und beschriftet die hellen Kacheln in Weltkoordinaten. |

### pruefung/ — misst an fertigen Modellen (aus `~/wov-ai/elements/`)

| Datei | Zielpfad | Zweck |
|---|---|---|
| `check-mirror.py` | `tools/elements/pruefung/check-mirror.py` | Prüft: Wickelrichtung (signiertes Volumen) und x-Asymmetrie eines GLB — negatives Volumen heißt vorgespiegelt. |
| `check-m3plus.py` | `tools/elements/pruefung/check-m3plus.py` | Prüft: die vier neuen StoneVault-Zellvarianten nach dem Export — Hüllbox, signiertes Volumen, Netz- und Materialzahl, Flächen, Reliefrichtung. |
| `check-p1.py` | `tools/elements/pruefung/check-p1.py` | Prüft: die Module aus Paket 1 (StoneVaultStairs, StoneVaultArch) in glTF-Achsen. |
| `check-steingrab-treppe.py` | `tools/elements/pruefung/check-steingrab-treppe.py` | Prüft: SteingrabTreppe.glb nach dem Umbau — zwei Netze, unveränderte Hüllbox, Laufprofil des `_col` und die Steigung. |
| `measure-glb.py` | `tools/elements/pruefung/measure-glb.py` | Prüft: Hüllbox und Ursprung aller Objekte eines GLB (headless). |
| `measure-treppe.py` | `tools/elements/pruefung/measure-treppe.py` | Prüft: SteingrabTreppe.glb auf glTF-Hüllbox, signiertes Volumen, Flächen und Höhenprofil. |
| `measure-steingrab-treppe.py` | `tools/elements/pruefung/measure-steingrab-treppe.py` | Prüft: SteingrabTreppe.glb auf alles, was das `_col`-Netz braucht — Trittprofil, Podeste, Innenmaß, Deckenunterkante und die Steigrichtung. |
| `measure-steingrab-treppe2.py` | `tools/elements/pruefung/measure-steingrab-treppe2.py` | Prüft: dieselbe Treppe zweitmeinend — je z-Probe ALLE nach oben und nach unten zeigenden Flächen getrennt, weil die „höchste Fläche"-Heuristik den Boden verschwieg. |
| `mess.py` | `tools/elements/pruefung/mess.py` | Prüft: die Maße von WandPaneel, Bodenplatte und Torbogen in einem Elementordner. |
| `render-m3plus.py` | `tools/elements/pruefung/render-m3plus.py` | Prüft: die vier neuen Zellvarianten im Rendering — zweite Reihe ohne Decke, scale.x = -1 wie Babylons `__root__`. |
| `render-naht.py` | `tools/elements/pruefung/render-naht.py` | Prüft: ob Licht der reinweißen Außenwelt durch die Fugen zwischen den Modulen dringt (Naht-Rendering). |
| `render-p1.py` | `tools/elements/pruefung/render-p1.py` | Prüft: Treppe und Torbogen aus Paket 1 im Rendering, jeweils in zwei Auftritten. |
| `render-saal-vergleich.py` | `tools/elements/pruefung/render-saal-vergleich.py` | Prüft: einen Saal von innen im Vergleich — Kit-Steinmaterial gegen die in der GLB gebackene KI-Textur. |
| `render-stonevault.py` | `tools/elements/pruefung/render-stonevault.py` | Prüft: die StoneVault-Module nebeneinander im Rendering. |
| `render-szene.py` | `tools/elements/pruefung/render-szene.py` | Prüft: eine Stelle aus dem Spiel, in Blender nachgebaut — jedes Pixel über der Schwelle ist ein Loch, nicht ein Lichteffekt. |
| `zaehle-naht.py` | `tools/elements/pruefung/zaehle-naht.py` | Prüft: die hellen Pixel eines Naht-Renderings — jedes einzelne ist Licht durch eine Modulfuge. |
| `dach-sonde.py` | `tools/elements/pruefung/dach-sonde.py` | Prüft: das Dach einer nachgebauten Szene per senkrechtem Strahl je Rasterpunkt — Höhe des ersten Treffers statt Helligkeit. |
| `strahl-sonde.py` | `tools/elements/pruefung/strahl-sonde.py` | Prüft: einzelne Bildpunkte eines Szenen-Renders — welcher Körper dort steht, an welchem Punkt und wie weit die Nachbarpunkte entfernt sind. |

### pipeline/ — Texturen und Browser-Aufnahmen (aus `~/wov-ai/pipeline-1.0/`)

| Datei | Zielpfad | Zweck |
|---|---|---|
| `texture-kit.py` | `tools/elements/pipeline/texture-kit.py` | Erzeugt: ein kachelndes Stein-PBR-Material auf jedem Netz eines Kit-GLB und exportiert es spieltauglich. |
| `make-normal.py` | `tools/elements/pipeline/make-normal.py` | Erzeugt: eine Tangent-Space-Normal-Map aus einer Stein-Albedo (Sobel auf der Helligkeit als Höhe). |
| `make-moss.py` | `tools/elements/pipeline/make-moss.py` | Erzeugt: die Moos-Variante einer Stein-Albedo — Maske aus den dunklen Fugen mal Fleckenrauschen. |
| `make-frost.py` | `tools/elements/pipeline/make-frost.py` | Erzeugt: die Frost-Variante einer Stein-Albedo — dieselbe Maske, aber bläulich-weiß und aufhellend. |
| `make-wet.py` | `tools/elements/pipeline/make-wet.py` | Erzeugt: die Nass-Variante einer Stein-Albedo — dunkler und gesättigter; der Glanz kommt aus der Rauheit in texture-kit.py. |
| `assemble-corridor.py` | `tools/elements/pipeline/assemble-corridor.py` | Erzeugt: das Innenbild mehrerer aneinandergesetzter Gang-Segmente aus Spielersicht. |
| `run-kit.sh` | `tools/elements/pipeline/run-kit.sh` | Hilfsmittel: fährt die Textur-Pipeline über alle Kit-Elemente und legt spieltaugliche GLBs nach `$WOV_ELEMENTE_AUS/out`. |
| `variants.sh` | `tools/elements/pipeline/variants.sh` | Hilfsmittel: baut Moos-, Frost- und Nass-Variante des Steingrab-Gangs in einem Zug. |
| `shot.mjs` | `tools/elements/pipeline/shot.mjs` | Hilfsmittel: nimmt eine Seite des Vorschau-Servers im Browser auf (Playwright, Vulkan-Flags) und meldet Konsolenfehler. |
| `sections-shot.mjs` | `tools/elements/pipeline/sections-shot.mjs` | Hilfsmittel: nimmt die Abschnitts-Ansicht auf und meldet Seitenfehler und 404er. |
| `steinmat-shot.mjs` | `tools/elements/pipeline/steinmat-shot.mjs` | Hilfsmittel: nimmt die Steinmaterial-Probe auf und meldet Seiten- und Konsolenfehler. |
| `streu-shot.mjs` | `tools/elements/pipeline/streu-shot.mjs` | Hilfsmittel: nimmt die Streu-Probe auf und meldet Seitenfehler und 404er. |
| `wasd-test.mjs` | `tools/elements/pipeline/wasd-test.mjs` | Hilfsmittel: fährt die Steingrab-Seite mit WASD ab und meldet Seitenfehler. |

### pruefung/ — aus dem Repo (`git mv`)

| Datei | Zielpfad | Zweck |
|---|---|---|
| `stonevault-kantensonde.ts` (lag bis S1 unmittelbar in `tools/`) | `tools/elements/pruefung/stonevault-kantensonde.ts` | Prüft: die Kantenerklärung der Module (`RoomDef.gridEdges`, `connections`) gegen die echte GLB-Geometrie. Der Pfad in `scripts/run-tests.mjs` ist mitgezogen. Seit F4 misst sie ohne Argument BEIDE Kits — Ziegel und Fels (s. „Das abgeleitete Kit"). |

### blender/ — hier entstanden

| Datei | Zielpfad | Zweck |
|---|---|---|
| `felsrelief.py` | `tools/elements/blender/felsrelief.py` | Erzeugt: das Höhenfeld der Fels-Frontschicht für `make-stonevault.py --stil fels` — die Messung zu F3. Voronoi-Bruchflächen, Klüfte, schräge Schichtung und feines Rauschen auf einem 0,125-m-Raster, 2 m periodisch. Kennt **weder `bpy` noch `bmesh`**: das Feld lässt sich mit blossem `python3 felsrelief.py --dump <lo> <hi>` befragen, und genau deshalb prüft es `pruefung/fels-frontschicht.mjs`, ohne Blender zu starten. Löst das Vorgängermodul felsblock.py (04.09.2026, gelöscht) ab — der Blockverband las sich im Kontaktbogen weiter als Mauerwerk. |

### pruefung/ — hier entstanden

| Datei | Zielpfad | Zweck |
|---|---|---|
| `fels-frontschicht.mjs` | `tools/elements/pruefung/fels-frontschicht.mjs` | Prüft: das Höhenfeld der Fels-Frontschicht (`--stil fels`) — Naht, Hub, Budget. Hält die Zusagen von F3 fest: die Randspalte des einen Moduls trifft die des Nachbarn in Höhe UND Tiefe (auch über die drei Wandvarianten hinweg), in jedem gebauten Ausschnitt steht ein Punkt ganz vorn und keiner weiter (die Hüllbox muss gleich bleiben, weil `DG_RockVault` abgeleitet wird), der Hub bleibt unter der Kapselgrenze, und ein Wandpaneel bleibt unter 1500 Dreiecken. Text und Arithmetik, kein `assets/`, kein Blender — hängt in `scripts/run-tests.mjs` hinter einer `python3`-Weiche. |
| `render-felsvergleich.py` | `tools/elements/pruefung/render-felsvergleich.py` | Prüft: die Fels-Frontschicht im STREIFLICHT — der Kontaktbogen zu F3. Zwei Betriebsarten: `--vergleich` stellt je ein Paneel aus mehreren Ordnern nebeneinander (Ziegel / bisher / neu), `--reihe` setzt vier Paneele Kante an Kante — nur so sieht man, ob sich das Feld alle 2 m wiederholt und ob die Naht hält. Ungetextetes Grau und 20-Grad-Einfall: Es soll die GEOMETRIE beurteilt werden, nicht die Steintextur. Bilder nach `tools/elements/out/` (nicht committet). |
| `relief-kontrast.mjs` | `tools/elements/pruefung/relief-kontrast.mjs` | Prüft: die Helligkeitsstreuung einer Wand im Streiflicht, mit und ohne Normal-Kanal (`?relief=1` gegen `?relief=0`) — die Messung zu F1. Läuft **lokal** gegen den Tunnel, nicht auf `wov-dev`. |
| `layout-szene.ts` | `tools/elements/pruefung/layout-szene.ts` | Hilfsmittel: schreibt ein ERZEUGTES Grab (Kit + Saat) als Posenliste für `render-szene.py`. Damit lässt sich ein ganzes Layout rendern statt einzelner Module — die Frage von F4 („fügt sich die Ableitung zu einem Grab zusammen?") beantwortet kein Einzelmodul. Der Kopf von `render-szene.py` nannte dafür bisher ein szene-json.ts unter tools/_scratch/ — hier bewusst ohne Backticks, weil es das im Repo nie gab (S4: was in Backticks steht, muss existieren). |
| `normalen-probe.mjs` | `tools/elements/pruefung/normalen-probe.mjs` | Prüft: ob die Normale eines Kit-Moduls IM SPIEL zur Raumseite zeigt — und was der übersetzte Shader daraus macht (`#define TWOSIDEDLIGHTING`). Die Sonde zu den Sichtbefunden vom 05.09.2026: Sie hat gemessen, dass die raumseitige Wandfläche eine Normale trägt, die IN die Wand zeigt (+0,666 in x bei x = +0,74). Läuft **lokal** gegen den Tunnel. |
| `licht-diagnose.mjs` | `tools/elements/pruefung/licht-diagnose.mjs` | Prüft: welche Lichter ein Grab überhaupt beleuchten — Klasse, Stärke, Farbe, Reichweite, Dungeon-Dämpfung, Fackelplätze — dazu ein Bild je Blickrichtung. Sie beantwortet die Frage, die vor jeder Beleuchtungsänderung steht: Was liegt an? Läuft **lokal** gegen den Tunnel. |
| `fackel-profil.mjs` | `tools/elements/pruefung/fackel-profil.mjs` | Prüft: wie sich Fackellicht auf einer Wand verteilt — Mittel, Streuung, 99. Perzentil, Anteil überstrahlter und dunkler Bildpunkte und ein Profil aus 16 senkrechten Streifen. Mit `--pruefe` zugleich die WACHE gegen „die Fackel leuchtet durch die Wand": Ein Blick auf eine Wand, hinter der eine Fackel steht, muss dunkel bleiben. Läuft **lokal** gegen den Tunnel. |
| `licht-probe-bauen.mjs` | `tools/elements/pruefung/licht-probe-bauen.mjs` | Erzeugt: das Messgrab `licht-probe` aus einem vorhandenen Grab — zwei Fackeln an festen Stellen, beide vom Einstiegspunkt aus im Bild (die Figur lässt sich im Grab nicht versetzen). Ohne diese Wiederholbarkeit misst man beim nächsten Mal ein anderes Grab. |
| `render-tstoss.py` | `tools/elements/pruefung/render-tstoss.py` | Prüft: den Innenstoss EINES Fels-Moduls (Vorgabe `RockVaultCorner`) im Streiflicht — die erste Frage zum Befund „man sieht das Endstück in der langen Seite der Wand". Sie hat das Eckmodul ENTLASTET; der Stoss sitzt an der Modulpaarung, s. `render-stoss.py`. |
| `render-stoss.py` | `tools/elements/pruefung/render-stoss.py` | Prüft: den Stoss ZWEIER Module in ihrer echten Nachbarschaft — baut ein Server-Layout (rooms + doors, Quaternion → Gierwinkel) nach und rendert benannte Blicke. Damit ist der Befund vom 05.09.2026 gefunden worden: Die Stirnfläche von `RockVaultArch` stand 15,4 cm vor dem Fels des anschliessenden Wandpaneels. `--praefix=StoneVault` zeigt dieselbe Stelle im Ziegelstil. |
| `fels-textur.mjs` | `tools/elements/pruefung/fels-textur.mjs` | Prüft: dass das Fels-Texturpaar kachelt, das Format der Bestandstexturen trägt und Relief statt Mauerwerk zeigt — die Messung zu F2. Liest das PNG selbst (`node:zlib`), braucht also weder PIL noch Blender. Hängt in `scripts/run-tests.mjs` hinter der `assets/`-Weiche. |

### pipeline/ — hier entstanden

| Datei | Zielpfad | Zweck |
|---|---|---|
| `make-fels.py` | `tools/elements/pipeline/make-fels.py` | Erzeugt: das kachelbare Fels-Texturpaar `stein_fels.png` + `stein_fels_normal.png` (1024², prozedural auf dem Torus). Ersetzt für diesen Fall `texture-kit.py` + `make-normal.py`: Die Kachelung ist Konstruktion statt Nachbearbeitung, und die Normal-Karte entsteht aus dem HÖHENFELD statt aus der Helligkeit — mit umlaufender Ableitung und einer Stärke in Metern. |

| `backe-hoehenkarte.py` | `tools/elements/pipeline/backe-hoehenkarte.py` | Erzeugt: Höhenkarte, Detail-Normale, Albedo und Rauheit aus einem gescannten Felsmodell (Tripo) — die Vorlage für `felsrelief.py --relief-quelle`. Strahlsonde über die vermessene Vorderseite; Auflösung 512 × 896 (16 Bit) für die Form, 1024² für die Texturen, und der Kopf begründet beides. |

### pipeline/quellen/ — Quelltexturen, ohne Kopfzeile

Fünf PNG aus `~/wov-ai/pipeline-1.0/`. Sie sind Eingabe, nicht Ergebnis, und
tragen deshalb keine Kopfzeile; der Wächter überspringt den Ordner.

| Datei | Zweck |
|---|---|
| `pipeline/quellen/stein_albedo.png` | Stein-Grundtextur, Eingang von `make-moss.py`, `make-frost.py`, `make-wet.py` und `make-normal.py`. |
| `pipeline/quellen/stein_normal.png` | Aus `stein_albedo.png` abgeleitete Normal-Map. War bis F1 **nie angeschlossen**; seither liest `DungeonSteinMaterial.ts` Normal-Karten nach der Konvention `<albedo>_normal.png`. Die Karte des Kits ist deshalb `stein_clean_normal.png` (mit `make-normal.py` aus `stein_clean.png`), nicht diese hier — diese gehört zur Pipeline-Quelltextur. |
| `pipeline/quellen/stein_moos_albedo.png` | Moos-Variante, Erzeugnis von `make-moss.py`. |
| `pipeline/quellen/stein_frost_albedo.png` | Frost-Variante, Erzeugnis von `make-frost.py`. |
| `pipeline/quellen/stein_wet_albedo.png` | Nass-Variante, Erzeugnis von `make-wet.py`. |

### pipeline/quellen/tripo/ — gebackene Karten aus Scans, ohne Kopfzeile

Das QUELLMODELL liegt nie hier (gross, binär, Eingabe statt Rezept — siehe
`HERKUNFT.md` im jeweiligen Ordner). Was hierher gehört, ist das Ergebnis des
Backens: Karten, die `felsrelief.py` und das Steinmaterial lesen.

| Datei | Zweck |
|---|---|
| `pipeline/quellen/tripo/rock-wall-01/HERKUNFT.md` | Herkunft, Vermessung und Neubau-Aufruf der Tripo-Felswand vom 05.09.2026. |
| `pipeline/quellen/tripo/rock-wall-01/rock-wall-01-hoehe.png` | Höhenfeld eines Wandpaneels, 512 × 896, 16 Bit — Eingang von `felsrelief.py --relief-quelle`. |
| `pipeline/quellen/tripo/rock-wall-01/rock-wall-01-roughness.png` | Rauheit aus dem Tripo-`_rm`. Heute unbenutzt (das Steinmaterial hat keinen Rauheitskanal), liegt hier für den Tag, an dem es einen bekommt. |
| `pipeline/quellen/tripo/rock-wall-01/stein_tripo_rock.png` | Albedo des Tripo-Felsens, 1024², in `STEIN_TEXTUREN` wählbar. |
| `pipeline/quellen/tripo/rock-wall-01/stein_tripo_rock_normal.png` | Detail-Normale dazu; der Gradient des Höhenfeldes ist abgezogen, weil ihn das Netz schon als Dreiecke trägt. |

Die Normal-Karte des Kits liegt **nicht im Repo** (`assets/` ist draussen) und
wird bei Bedarf neu abgeleitet:

```bash
python3 tools/elements/pipeline/make-normal.py \
  assets/models/stein_clean.png assets/models/stein_clean_normal.png 2.0
```

Das Fels-Paar entsteht dagegen **nicht** aus einer Quelltextur, sondern
prozedural — es hat keine Albedo-Vorlage, aus der sich eine Normal-Karte
ableiten liesse, und braucht auch keine:

```bash
python3 tools/elements/pipeline/make-fels.py assets/models/stein_fels.png
node tools/elements/pruefung/fels-textur.mjs
```

### Hier entstanden — nicht aus `~/wov-ai/`

| Datei | Zweck |
|---|---|
| `pruefe-koepfe.mjs` | Prüft: dass jede Datei unter `tools/elements/` eine Kopfzeile `Erzeugt:`/`Prüft:`/`Hilfsmittel:` trägt (S1). |
| `pruefe-pfade.mjs` | Prüft: dass kein Skript hier einen Ort ausserhalb des Repos fest verdrahtet hat (S2). |
| `pruefung/kit-neubau.mjs` | Prüft: einen vollen Neubau aller zwölf DG_StoneVault-Module gegen die ausgelieferten GLBs — sechs Felder je Objekt (S2). |
| `pipeline/aufnahmen.mjs` | Hilfsmittel: sagt den fünf Browser-Aufnahmen, wohin ihre PNG gehören — ein Ort, einmal festgelegt (S2). |
| `pruefe-readme.mjs` | Prüft: dass jeder Pfad in `tools/README.md` und in dieser Datei existiert und keine Datei dieses Ordners unerwähnt bleibt (S4). |

Vier davon hängen in `scripts/run-tests.mjs`. Die drei Wächter lesen nur
Text und stehen deshalb ganz vorn in der Kernliste;
`pruefung/kit-neubau.mjs` braucht Blender *und* `assets/` und steht hinter
der Weiche `brauchtBlender()` aus `scripts/testweichen.mjs` (S3) — fehlt
eines von beidem, wird er als *übersprungen* gemeldet statt rot.
`pipeline/aufnahmen.mjs` ist kein Prüfer, sondern eine Tabelle, die die fünf
Aufnahme-Skripte importieren; sie steht deshalb in keiner Testliste.

### ts/ — noch ohne Werkzeug

Für die TypeScript-Werkzeuge aus Vorhaben 1 — hallen-generator-cli.ts und
glb-schreiber-probe.ts, hier bewusst ohne Backticks, weil es sie noch nicht
gibt (siehe „Was ein Pfad in Backticks bedeutet" in `tools/README.md`). Der
Ordner steht schon da, damit sie beim Entstehen nicht wieder irgendwo
landen; `ts/README.md` sagt es noch einmal an Ort und Stelle.

## Das Kit in zwei Stilen bauen (F3)

`make-stonevault.py` baut seit dem 04.09.2026 **dasselbe Kit zweimal**. Die
Vorgabe bleibt der Ziegelverband und schreibt `StoneVault*.glb`; `--stil fels`
tauscht ausschliesslich die Frontschicht von `innenwand()`, `wand()`,
`bogen()` und den Treppenwangen gegen unregelmässige Blöcke und schreibt
`RockVault*.glb`:

```bash
flatpak run org.blender.Blender --factory-startup -b \
  --python tools/elements/blender/make-stonevault.py -- assets/models
flatpak run org.blender.Blender --factory-startup -b \
  --python tools/elements/blender/make-stonevault.py -- assets/models --stil fels
node tools/elements/pruefung/fels-frontschicht.mjs
```

Nachweis, dass der Fels-Stil nichts kostet, was der Nahtschluss gewonnen hat
(die Zählung muss gleich oder besser sein):

```bash
flatpak run … --python tools/elements/pruefung/render-naht.py -- \
  assets/models tools/elements/out/naht-alt.png  StoneVault
flatpak run … --python tools/elements/pruefung/render-naht.py -- \
  assets/models tools/elements/out/naht-fels.png RockVault
python3 tools/elements/pruefung/zaehle-naht.py \
  tools/elements/out/naht-alt.png tools/elements/out/naht-fels.png
```

Kontaktbogen alt/neu — `render-stonevault.py` nimmt die Modulnamen jetzt als
Argumente, damit beide Stile in EINEM Bild und unter EINER Kamera stehen:

```bash
flatpak run … --python tools/elements/pruefung/render-stonevault.py -- \
  assets/models assets/models tools/elements/out/kontakt.png \
  StoneVaultWall RockVaultWall
```

`--stil ziegel` ist dabei nachweislich unverändert: die zwölf so gebauten
GLB sind Byte für Byte dieselben wie die ausgelieferten.

`stein_decke.png` hat bewusst **keine** Karte bekommen: Damit läuft im Spiel
dauerhaft ein Beispiel des Rückfalls „Datei fehlt → heutiges Verhalten" mit,
statt dass er nur im Test vorkommt.

> **Offener Punkt für Mike.** Die fünf PNG sind zusammen 11 MB, und vier
> davon sind *ableitbar*: `make-normal.py`, `make-moss.py`, `make-frost.py`
> und `make-wet.py` rechnen sie aus `stein_albedo.png` aus — sie sind damit
> Ergebnis, und die Regel dieses Ordners lautet „Rezept, nicht Ergebnis".
> Die Konzeptnotiz nennt trotzdem ausdrücklich fünf Quelltexturen, deshalb
> liegen alle fünf hier. Wer nur `stein_albedo.png` behalten will, muss das
> **vor dem ersten Push** entscheiden: danach kostet es eine
> History-Umschrift.

## Das abgeleitete Kit (F4)

Die GLB aus `--stil fels` gehören zu einem eigenen Kit `DG_RockVault`. Es
steht **nicht** als zweite Kit-Definition im Quelltext, sondern entsteht aus
`DG_StoneVault`: `rockVariant()` in `shared/src/eigeneDungeons.ts` erzeugt die
zwölf RoomDefs mit umgestelltem Namen und lässt `size`, `connections` und
`gridEdges` unangetastet. Jede künftige Nahtschluss-Änderung am Stammkit wirkt
damit auf beide.

Zwei Prüfer halten das fest — an verschiedenen Enden:

```bash
# Die ERKLÄRUNG: Ist das Kit noch abgeleitet, oder hat jemand nachgetippt?
npx tsx shared/test/kit-ableitung.ts
# Die GEOMETRIE: Halten BEIDE Kits ihre Erklärung an der echten GLB ein?
npx tsx tools/elements/pruefung/stonevault-kantensonde.ts
```

Die Kantensonde misst ohne Argument seit F4 beide Kits, und das ist kein
Beiwerk: Die Erklärung ist für beide dieselbe (sie wird ja abgeleitet), die
Geometrie ist es nicht. Ein Fels-Block, der ins Durchgangsfenster ragt,
ändert keine Zeile der Erklärung — und fiele einer Sonde, die nur den
Ziegelstil misst, nie auf. Ein Kitname als Argument misst weiterhin nur
dieses eine.

Dasselbe gilt für die Messzelle und den Saat-Test:

```bash
npx tsx tools/messe-stonevault-logik.ts --streng --kit=DG_RockVault
npx tsx server/test/m3-stonevault-seeds.ts   # laeuft fuer beide Kits
```

## Abweichungen von der Konzeptnotiz

Die Ordnerliste im Konzept („Konzept — Elemente aus dem Editor und
Fels-Relief", Vorhaben 2) hat sich zweimal verzählt. Die Zuordnung ist
übernommen, die Zahlen sind berichtigt:

- `compose-*.py` sind **fünf**, nicht vier (`compose-cells`, `-haus`,
  `-plan`, `-uebersicht`, `compose-corridor`).
- `render-*.py` sind **sechs**, nicht fünf (`render-szene.py` fehlte in der
  Aufzählung).

Die Gesamtzahl 43 stimmt trotzdem: 30 aus `elements/` (29 `.py` plus
`modulFormat.md`) und 13 aus `pipeline-1.0/`.
