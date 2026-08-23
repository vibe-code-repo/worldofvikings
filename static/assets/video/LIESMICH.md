# Hintergrundfilm der Charaktererstellung

Hier gehoert **`schwarzwald.webm`** hin — eine Aufnahme aus dem Spiel, die
hinter der Figur laeuft. Solange die Datei fehlt, bleibt die Buehne bei
ihrem Farbverlauf; die Seite fragt vorher per HEAD nach und haengt das
`<video>` erst ein, wenn es etwas zu spielen gibt.

## Was aufgenommen werden sollte

| | |
|---|---|
| Ort | Schwarzwald, gern mit Tiefe: Baeume nah UND fern |
| Kamera | **steht still** oder driftet ganz langsam. Kein Schwenk, kein Laufen |
| Laenge | 10 bis 20 Sekunden — es laeuft in Schleife |
| Blickhoehe | etwa Augenhoehe, leicht abwaerts, wie die Vorschaukamera |
| Wetter | ruhig. Wind im Laub ist erwuenscht, Regen lenkt ab |
| Aufloesung | 1280x720 genuegt; die Buehne ist selten groesser |

Wichtig ist der **feste Blickwinkel**. Die Vorschau dreht die FIGUR, nicht
die Kamera — ein Schwenk im Film wuerde dieser Bewegung widersprechen.

Am unteren Bildrand sollte Boden zu sehen sein: Dort stehen die Fuesse, und
dort sitzt der Klecksschatten.

## Umwandeln

```
ffmpeg -i aufnahme.mp4 -t 15 -an \
  -c:v libvpx-vp9 -crf 34 -b:v 0 -vf scale=1280:-2 \
  schwarzwald.webm
```

`-an` wirft die Tonspur weg (sie wird nie abgespielt und kostet nur Platz).
CRF 34 landet bei rund 1 bis 2 MB fuer 15 Sekunden. Zum Vergleich: Der
3D-Wald, den dieser Film ersetzt, hat 3,9 MB Modelle geladen.

## Danach

Nichts. Datei ablegen, fertig — kein neuer Build noetig. Beim naechsten
Aufruf findet die Seite sie und spielt sie ab.

Wenn die Aufnahme aus einer anderen Tageszeit stammt als das jetzige Licht
der Vorschau, gehoeren die Lichtwerte in `tools/web/vorschau-web.ts`
nachgezogen (Suchwort: "Licht muss zur AUFNAHME passen"). Sonst klebt die
Figur vor dem Wald, statt darin zu stehen.
