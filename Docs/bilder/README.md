# Bilder fürs README

Hier liegen die Bilder, die das README einbindet, und sonst nichts. Wer ein
Bild austauscht, behält den Dateinamen; dann muss im README nichts nachgezogen
werden.

| Datei | Was drauf ist |
|---|---|
| `wald.webp` | Die Figur auf einer Wiese am Waldrand, ohne Oberfläche |
| `erstellen.webp` | Charaktererstellung auf der Webseite mit der 3D-Vorschau |

Weitere Motive (Startdorf, Nacht, gegrabene Grube, Charakter und Inventar,
Weltkarte) kommen dazu, sobald es gute Aufnahmen vom aktuellen Stand gibt.

## Aufnehmen

**F1** blendet die gesamte Oberfläche aus. Soll die Oberfläche sichtbar
bleiben, darf trotzdem kein Diagnosetext (Bildrate, Koordinaten) und kein
Hinweis wie „Ins Bild klicken …“ im Bild stehen. Ein Bild lässt sich
beschneiden, aber nicht entrümpeln.

Aufnahmen per Playwright brauchen einen Rechner mit GPU. Die Maus lässt sich
dort nicht fangen; Blickrichtung und Kamera werden deshalb über die
Diagnosehaken des Clients gesetzt, nicht per Mausbewegung.

## Format

WebP, rund 1600 px breit, Qualität 88. Das landet bei 40–250 KB pro Bild. Aus
einem PNG:

```bash
magick bild.png -resize 1600x -quality 88 wald.webp
```

Größer lohnt nicht: GitHub skaliert die Anzeige ohnehin herunter, und jedes
Byte hier liegt für immer in der Historie, die jeder Klon mitzieht. Deshalb
gehören nur wenige, ausgesuchte Bilder hierher. Die Modelle und Texturen
bleiben aus demselben Grund ganz draußen (siehe README).
