# Bilder fürs README

Hier liegen die Bilder, die das README einbindet. Was hier nicht liegt, wird dort
auch nicht angezeigt — die Plätze für die Spielbilder stehen im README als
HTML-Kommentar, damit GitHub kein kaputtes Bildsymbol zeigt, solange sie fehlen.

## Was gebraucht wird

| Datei | Was drauf sein soll | Stand |
|---|---|---|
| `weltkarte.webp` | Die Live-Welt aus dem Weltdokument gerendert | liegt hier |
| `spiel.webp` | Ein Spielbild: Figur in der Landschaft, ohne Debug-Kasten (F3) und ohne Maushinweis | fehlt |
| `charakter.webp` | Charakterfenster und Inventar nebeneinander | fehlt |

Sind die Dateien da, im README die beiden `<!-- ... -->` um die `![...]`-Zeilen
entfernen.

## Format

WebP, rund 1600 px breit, Qualität 85–90. Das landet bei 40–150 KB pro Bild.
Aus einem PNG:

```bash
magick bild.png -resize 1600x -quality 88 spiel.webp
```

Grösser lohnt nicht: GitHub skaliert die Anzeige ohnehin herunter, und jedes
Byte hier liegt für immer in der Historie, die jeder Klon mitzieht. Deshalb
gehören auch nur wenige, ausgesuchte Bilder hierher — die 500 Modelle und
Texturen bleiben aus gutem Grund draussen (siehe README).

## Die Weltkarte neu erzeugen

`weltkarte.webp` ist ein Ausschnitt aus `wov-web/static/assets/karten/live.webp`
(4096×4096, kommt aus dem Weltkarten-Renderer in `tools/`). Der Ausschnitt lässt
den leeren Ozean an den Rändern weg:

```bash
magick wov-web/static/assets/karten/live.webp -crop 3800x2700+150+950 +repage -resize 1600x -quality 88 Docs/bilder/weltkarte.webp
```

Ändert sich der Weltschnitt, stimmt der Ausschnitt nicht mehr — dann die Zahlen
neu bestimmen, statt das alte Bild stehen zu lassen.
