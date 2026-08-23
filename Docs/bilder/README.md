# Bilder fürs README

Hier liegen die Bilder, die das README einbindet — sonst nichts. Wer eines
austauscht, behält den Dateinamen; dann muss im README nichts nachgezogen
werden.

| Datei | Was drauf ist |
|---|---|
| `spiel.webp` | Die Figur in Wiese und Wald, Lebens- und Ausdauerleiste, Schnellleiste |
| `weltkarte.webp` | Die Live-Welt, aus dem Weltdokument gerendert |
| `gelaende.webp` | Terraforming: eine ausgehobene Grube mit den Schnittflächen des Geländes |
| `nacht.webp` | Dieselbe Gegend bei Nacht |
| `erstellen.webp` | Charaktererstellung auf der Webseite mit der 3D-Vorschau |
| `charakter.webp` | Charakterfenster und Inventar nebeneinander |

## Aufnehmen

**F3** blendet den Debug-Kasten aus, **F1** die gesamte Oberfläche. Beides vor
dem Auslösen — ein Bild lässt sich beschneiden, aber nicht entrümpeln.
`spiel.webp` und `charakter.webp` sind rechts beschnitten, weil der Debug-Kasten
und die Minikarte in der Ecke standen; das ist ein Schnitt, keine Retusche, aber
mit F3 wäre es keiner gewesen.

## Format

WebP, rund 1600 px breit, Qualität 88. Das landet bei 40–190 KB pro Bild. Aus
einem PNG:

```bash
magick bild.png -resize 1600x -quality 88 spiel.webp
```

Grösser lohnt nicht: GitHub skaliert die Anzeige ohnehin herunter, und jedes
Byte hier liegt für immer in der Historie, die jeder Klon mitzieht. Deshalb
gehören auch nur wenige, ausgesuchte Bilder hierher — die Modelle und Texturen
bleiben aus demselben Grund ganz draussen (siehe README).

## Die Weltkarte neu erzeugen

`weltkarte.webp` ist ein Ausschnitt aus `wov-web/static/assets/karten/live.webp`
(4096×4096, kommt aus dem Weltkarten-Renderer in `tools/`). Der Ausschnitt lässt
den leeren Ozean an den Rändern weg:

```bash
magick wov-web/static/assets/karten/live.webp -crop 3800x2700+150+950 +repage -resize 1600x -quality 88 Docs/bilder/weltkarte.webp
```

Ändert sich der Weltschnitt, stimmt der Ausschnitt nicht mehr — dann die Zahlen
neu bestimmen, statt das alte Bild stehen zu lassen.
