<!-- Hilfsmittel: das Inventar dieses Ordners — welche Datei woher kam und wozu sie da ist. -->

# Elemente — Skripte, die Dungeon-Bausteine erzeugen und prüfen

Dieser Ordner sammelt an einer Stelle, was bis zum 04.09.2026 an drei Orten
lag: `tools/` im Repo, `~/wov-ai/elements/` und `~/wov-ai/pipeline-1.0/`
ausserhalb. Der Kit, an dem gerade gearbeitet wird (`DG_StoneVault`), war der
einzige, dessen Bauskript nicht im Repo stand — ein Skript ausserhalb des
Repos ist ein Skript, das beim nächsten Checkout fehlt.

Es gilt die Regel aus `tools/README.md`: **Alles hier ist Rezept, nicht
Ergebnis.** Die Ausgabeordner `out/` und `preview/` der Quellorte sind
deshalb bewusst *nicht* mitgezogen worden.

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
`OUT = ARGS[0]`), die Sonden bekommen den GLB-Ordner übergeben. Hart
verdrahtet ist nur die `ALIAS`-Tabelle in `dach-sonde.py`/`strahl-sonde.py`;
sie ist unverändert mitgewandert.

## Inventur

Aufgenommen **vor** dem Bewegen, gegen die Quellordner in dem Zustand vom
04.09.2026. 43 Dateien plus fünf Quelltexturen sind aus `~/wov-ai/` kopiert
(nicht verschoben — die alten Orte tragen jetzt eine `VERSCHOBEN.md` und
werden erst geleert, wenn ein voller Kit-Neubau aus dem neuen Ort dieselben
Kennzahlen liefert, s. Meilenstein S2). Eine Datei kam per `git mv` aus dem
Repo selbst.

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
| `run-kit.sh` | `tools/elements/pipeline/run-kit.sh` | Hilfsmittel: fährt die Textur-Pipeline über alle Kit-Elemente und legt spieltaugliche GLBs nach out/. |
| `variants.sh` | `tools/elements/pipeline/variants.sh` | Hilfsmittel: baut Moos-, Frost- und Nass-Variante des Steingrab-Gangs in einem Zug. |
| `shot.mjs` | `tools/elements/pipeline/shot.mjs` | Hilfsmittel: nimmt eine Seite des Vorschau-Servers im Browser auf (Playwright, Vulkan-Flags) und meldet Konsolenfehler. |
| `sections-shot.mjs` | `tools/elements/pipeline/sections-shot.mjs` | Hilfsmittel: nimmt die Abschnitts-Ansicht auf und meldet Seitenfehler und 404er. |
| `steinmat-shot.mjs` | `tools/elements/pipeline/steinmat-shot.mjs` | Hilfsmittel: nimmt die Steinmaterial-Probe auf und meldet Seiten- und Konsolenfehler. |
| `streu-shot.mjs` | `tools/elements/pipeline/streu-shot.mjs` | Hilfsmittel: nimmt die Streu-Probe auf und meldet Seitenfehler und 404er. |
| `wasd-test.mjs` | `tools/elements/pipeline/wasd-test.mjs` | Hilfsmittel: fährt die Steingrab-Seite mit WASD ab und meldet Seitenfehler. |

### pruefung/ — aus dem Repo (`git mv`)

| Datei | Zielpfad | Zweck |
|---|---|---|
| `tools/stonevault-kantensonde.ts` | `tools/elements/pruefung/stonevault-kantensonde.ts` | Prüft: die Kantenerklärung der Module (`RoomDef.gridEdges`, `connections`) gegen die echte GLB-Geometrie. Der Pfad in `scripts/run-tests.mjs` ist mitgezogen. |

### pruefung/ — hier entstanden

| Datei | Zielpfad | Zweck |
|---|---|---|
| `relief-kontrast.mjs` | `tools/elements/pruefung/relief-kontrast.mjs` | Prüft: die Helligkeitsstreuung einer Wand im Streiflicht, mit und ohne Normal-Kanal (`?relief=1` gegen `?relief=0`) — die Messung zu F1. Läuft **lokal** gegen den Tunnel, nicht auf `wov-dev`. |

### pipeline/quellen/ — Quelltexturen, ohne Kopfzeile

Fünf PNG aus `~/wov-ai/pipeline-1.0/`. Sie sind Eingabe, nicht Ergebnis, und
tragen deshalb keine Kopfzeile; der Wächter überspringt den Ordner.

| Datei | Zweck |
|---|---|
| `stein_albedo.png` | Stein-Grundtextur, Eingang von `make-moss/frost/wet.py` und `make-normal.py`. |
| `stein_normal.png` | Aus `stein_albedo.png` abgeleitete Normal-Map. War bis F1 **nie angeschlossen**; seither liest `DungeonSteinMaterial.ts` Normal-Karten nach der Konvention `<albedo>_normal.png`. Die Karte des Kits ist deshalb `assets/models/stein_clean_normal.png` (mit `make-normal.py` aus `stein_clean.png`), nicht diese hier — diese gehört zur Pipeline-Quelltextur. |
| `stein_moos_albedo.png` | Moos-Variante, Erzeugnis von `make-moss.py`. |
| `stein_frost_albedo.png` | Frost-Variante, Erzeugnis von `make-frost.py`. |
| `stein_wet_albedo.png` | Nass-Variante, Erzeugnis von `make-wet.py`. |

Die Normal-Karte des Kits liegt **nicht im Repo** (`assets/` ist draussen) und
wird bei Bedarf neu abgeleitet:

```bash
python3 tools/elements/pipeline/make-normal.py \
  assets/models/stein_clean.png assets/models/stein_clean_normal.png 2.0
```

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

### ts/ — noch leer

Für die TypeScript-Werkzeuge aus Vorhaben 1 (`hallen-generator-cli.ts`,
`glb-schreiber-probe.ts`). Der Ordner steht schon da, damit sie beim
Entstehen nicht wieder irgendwo landen; `ts/README.md` sagt es noch einmal
an Ort und Stelle.

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
