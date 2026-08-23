# Hintergrundfilm der Charaktererstellung

`schwarzwald.webm` — 11 s, 620x992, **310 KB**. Dazu `schwarzwald.webp`
(29 KB) als Standbild, das steht, bis der Film laeuft.

Aufgenommen am 23.08.2026 auf **play.dev**, Schwarzwald-Insel `insel-2` bei
(-27820, -5900), Mittagslicht.

## Wie der Film entstanden ist

Nicht mit einem Bildschirmrekorder, sondern aus der Leinwand des Spiels
selbst — `canvas.captureStream()` plus `MediaRecorder`. Das ist der Grund,
warum **kein HUD** darauf ist: Minikarte, Leiste und Werte sind DOM und
liegen ueber der Leinwand, nicht darin. Ein Bildschirmmitschnitt haette sie
alle mitgenommen.

Ablauf:

1. Browser MIT sichtbarem Fenster starten (`headless: false`). Headless mit
   Software-Rendering laedt die Welt nicht in vertretbarer Zeit — mit
   Grafikkarte laeuft sie mit 40 bis 66 fps.
2. `https://Admin:PASSWORT@play.dev.world-of-vikings.com/` — Zugangsdaten
   NUR bei der ersten Navigation einbetten, sonst haengt es.
3. Uhrzeit `#start-time` auf 12, `#connect-btn` klicken.
4. Warten, bis `chunks N (+0)` steht.
5. Springen: `__vb.teleport(-27820, -5900, 0)` und
   `__vb.admin("teleport -27820 -5900")` — dasselbe, was der Admin-Strg-Klick
   auf der Karte tut. Der Spawn liegt 11 km entfernt auf `insel-1`.
6. Stelle suchen (von Hand — die Kamera landet nach dem Sprung gern im
   Gebuesch), dann 20 s aufnehmen.

## Nachbearbeiten

Die Spielfigur steht in der Bildmitte und muss weg. Sie laesst sich nicht
ausblenden: Es gibt keine Ich-Perspektive, der Mindestabstand der Kamera ist
1,5 m, und an die Babylon-Szene kommt man von aussen nicht heran.

Der Ausweg ist ein **Randstreifen**. Aus 1920 Punkten Breite bleiben die
linken 620 — dort war sie ueber die ganzen 20 s nie zu sehen.

```
ffmpeg -ss 8 -t 11 -i aufnahme.webm -an \
  -vf "crop=620:992:0:0" \
  -c:v libvpx-vp9 -crf 33 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 \
  schwarzwald.webm
```

`-ss 8`, weil die ersten Sekunden noch Kameraschwenk sind. Die geraden
Kantenlaengen sind Pflicht fuer VP9.

## Austauschen

Datei ersetzen, fertig — kein Build, kein Ausrollen der Seite. Sie fragt
beim Laden per HEAD nach und spielt, was da liegt.

Stammt eine neue Aufnahme aus einer anderen Tageszeit, gehoeren die
Lichtwerte in `tools/web/vorschau-web.ts` nachgezogen (Suchwort: "Licht muss
zur AUFNAHME passen"). Sonst klebt die Figur vor dem Wald, statt darin zu
stehen.
