# rock-wall-01 — Tripo-Felswand, Herkunft und Weg ins Kit

*Angelegt 05.09.2026. Dieser Ordner enthält die **gebackenen Karten**, nicht
das Quellmodell.*

## Quelle

| Feld | Wert |
|---|---|
| Werkzeug | Tripo (Image/Text-to-3D), Auftrag `rock wall texture 3d model` |
| Datei | `~/wov-ai/jobs/rock wall texture 3d model.glb` (11,4 MB) |
| Datum | 05.09.2026 |
| Netz | 1 Objekt `tripo_node_bf43655c`, 48 446 Dreiecke, 40 843 Ecken |
| Hüllbox | 97,19 × 32,06 × 98,16 Tripo-Einheiten (x breit, y tief, z hoch) |
| Texturen | eingebettet, je 4096²: Basecolor (JPG, sRGB), Normal (JPG), Roughness/Metal (PNG, G = Rauheit) |
| UV | eine Lage `UVMap` |
| Lizenz | Tripo-Ausgabe aus Mikes eigenem Auftrag; Nutzung im Projekt uneingeschränkt |

**Warum das GLB nicht hier liegt:** `assets/` und grosse Binärdateien bleiben
ausserhalb des Repos (`tools/README.md`, `.gitignore:32`). Das Quellmodell ist
Eingabe, kein Rezept — reproduzierbar ist der Weg, nicht der Scan. Im Repo
stehen deshalb nur diese Notiz und die vier gebackenen Karten (zusammen
4,0 MB, jede unter 3 MB).

## Vermessung (Schritt 2 der Ablaufnotiz)

Gemessen, nicht angenommen — die vollständige Herleitung steht im Kopf von
`tools/elements/pipeline/backe-hoehenkarte.py`. Der eine Befund, der eine
Sichtprobe gebraucht hat: **beide** y-Seiten tragen Relief (das Modell ist
eine geschlossene Schale), und die Flächenzählung ist mit 12 609 gegen
12 601 Flächen praktisch symmetrisch. Erst Strahlsonde (Spanne 15,73 gegen
13,93 Einheiten) und zwei Streiflicht-Renderings haben **−y** als Vorderseite
festgelegt.

## Karten in diesem Ordner

| Datei | Format | Wozu |
|---|---|---|
| `rock-wall-01-hoehe.png` | 512 × 896, 16 Bit Graustufe | Höhenfeld eines Wandpaneels (2 × 3,5 m, 18 cm Hub) — **gekachelt aus einer 1-m-Kachel**, nicht mehr gestreckt (s. u.). Liest `felsrelief.py` mit `--relief-quelle`. |
| `stein_tripo_rock.png` | 1024², sRGB | Albedo für das triplanare Steinmaterial (`STEIN_TEXTUREN`). |
| `stein_tripo_rock_normal.png` | 1024², Tangentenraum | Detail-Normale — das Korn **unterhalb** des 0,125-m-Rasters; der Gradient des Höhenfeldes ist abgezogen, weil ihn das Netz schon trägt. |
| `rock-wall-01-roughness.png` | 1024², Graustufe | Rauheit aus dem Tripo-`_rm` (G-Kanal). **Heute unbenutzt:** `DungeonSteinMaterial.ts` hat keinen Rauheitskanal; die Karte liegt hier, damit sie nicht neu gebacken werden muss, wenn er kommt. |

Die beiden `stein_tripo_rock*`-Dateien liegen zusätzlich unter
`assets/models/` — dort holt sie der Client, hier stehen sie als Erzeugnis
des Rezepts.

## Kacheln statt strecken (05.09.2026, Mass B)

Die erste Fassung legte den Scan über die **ganze** Vorderseite und streckte
ihn auf 2 × 3,5 m. Das Modell ist rund 1 × 1 m gross — jeder Brocken wurde
damit doppelt so breit und dreieinhalbmal so hoch, seine **Tiefe** aber
nicht. Aus einer 5 cm breiten, 5 cm tiefen Kluft wurde eine 10 cm breite,
5 cm tiefe Mulde. Genau das war Mikes Befund „im Spiel sieht es viel weniger
grob aus als im Tripo-Viewer".

Jetzt wird in Originalgrösse gescannt (512 × 512 Strahlen über einen
Quadratmeter, gemittelt auf eine Kachel von 256 × 256 Bildpunkten = 256 px/m)
und die Paneelkarte daraus **gekachelt**: 3 × 4 Kacheln mit 8 cm Überlappung,
jede in einer anderen Lage der Diedergruppe des Quadrats (spiegeln, drehen),
in der Überlappung ineinander geblendet. Der äussere Randstreifen auf das
neutrale Niveau bleibt, wie er war — er ist die Nahtregel des Rezepts.

Gemessen an den beiden Karten (innerer Ausschnitt, 256 px/m):

| | gestreckt | gekachelt |
|---|---|---|
| mittlerer Gradient | 1,369 / m | **2,691 / m** |
| Halbwertslänge der Autokorrelation in x | 8,2 cm | **6,2 cm** |
| Tiefenspanne des Scans | 37,1 cm auf 2 m Paneelbreite | **18,1 cm auf 1 m Kachelbreite** |

Die 18,1 cm sind die eigentliche Auskunft: So grob ist dieser Fels in
Wirklichkeit, und `PROT` = 18 cm im Kit ist damit keine gewählte Zahl,
sondern die gemessene.

**Ehrlich dazu:** Es bleibt **ein** Quadratmeter Gestein, zwölfmal gedreht
und gespiegelt. Die Kachelung liefert den Massstab, nicht mehr Material.
Mehr Material hiesse: ein zweiter Scan.

## Neu backen

```
flatpak run org.blender.Blender --background --factory-startup \
  --python tools/elements/pipeline/backe-hoehenkarte.py \
  -- "$HOME/wov-ai/jobs/rock wall texture 3d model.glb" \
     tools/elements/pipeline/quellen/tripo/rock-wall-01
```
