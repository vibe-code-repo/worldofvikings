# Hintergrundfilm der Charaktererstellung

`schwarzwald.webm` — 14,5 s, **1440x1348**, 1,1 MB. Dazu `schwarzwald.webp`
(86 KB) als Standbild, das steht, bis der Film laeuft.

Aufgenommen am 23.08.2026 auf **play.dev**, Schwarzwald-Insel `insel-2` bei
(-27820, -5900), Mittagslicht. Kamera steht vollkommen still, die Spielfigur
ist ausgeblendet — das Bild laesst sich also frei ausrichten.

Das Seitenverhaeltnis ist mit Absicht fast quadratisch: die Buehne ist am
Rechner quer und am Telefon hoch, und `object-fit: cover` beschneidet immer
die andere Richtung. Ein quadratisches Bild verliert in beiden Faellen
wenig. Ein Hochformat (so war die erste Fassung) wird quer stark
beschnitten.

## Wie der Film entsteht

Skript: `hintergrund-aufnehmen.mjs` (liegt im Sitzungsordner der Aufnahme,
gehoert bei Gelegenheit ins Repo). Es laeuft auf **Mikes Maschine**, nicht
auf wov-dev — dort startet kein Chromium.

Aufgenommen wird nicht der Bildschirm, sondern der Zeichenpuffer der
Leinwand: `canvas.captureStream()` plus `MediaRecorder`. Deshalb ist **kein
HUD** darauf — Minikarte, Leiste und Werte sind DOM und liegen *ueber* der
Leinwand, nicht darin. Ein Bildschirmmitschnitt haette sie mitgenommen.

Ablauf:

1. Browser MIT sichtbarem Fenster (`headless: false`). Headless mit
   Software-Rendering laedt die Welt nicht in vertretbarer Zeit.
2. `https://Admin:PASSWORT@play.dev.world-of-vikings.com/?pos=-27820,-5900`
   — Zugangsdaten NUR bei der ersten Navigation einbetten, sonst haengt es.
3. Warten, bis `window.__vb.figur` existiert. Dann uebernimmt ein Mensch das
   Fenster und stellt die Kamera ein.
4. Auf Zuruf: `__vb.figur(false)`, `__vb.ueberaufloesung(2)`, 20 s
   aufnehmen, danach `__vb.figur(true)`.

### Die beiden Haken in `__vb`

Beide stehen in `client/src/main.ts` des Spiel-Repos und sind ausdruecklich
Aufnahmewerkzeug, keine Spieleinstellung.

- **`figur(an)`** blendet die Spielfigur aus (`isVisible`, nicht
  `setEnabled` — Bewegung, Kamera und Physik sollen weiterrechnen). Ohne
  ihn steht die Figur mitten im Bild; die erste Fassung des Films musste
  deshalb auf einen leeren Randstreifen beschnitten werden.
- **`ueberaufloesung(faktor)`** rendert intern groesser als das Fenster.
  Ohne ihn ist bei Fenstergroesse Schluss: die Einstellung
  „Renderaufloesung" endet in `RENDER_SCALE` bei `1.0`, und der Bildschirm
  ist nur 1080 Punkte hoch. Faktor 2 macht aus einem 1076x1008-Fenster
  2152x2016 — vierfache Pixelzahl, gemessen noch 51 Bilder/s.

Vor der Aufnahme die Bildrate messen und die tatsaechliche Puffergroesse
ausgeben lassen. Ein wirkungsloser Schalter faellt sonst erst am fertigen
Film auf.

## Nachbearbeiten

Der Rohfilm hat wegen `MediaRecorder` **keine feste Bildrate**
(`r_frame_rate=1000/1`); Schnitte darauf sind unzuverlaessig. Also erst
normalisieren, dann schneiden.

```
# 1. feste Bildrate + Zielgroesse
ffmpeg -i roh.webm -ss 2 -t 16 -r 30 -vf "scale=1440:-2:flags=lanczos" \
  -c:v ffv1 -an norm.mkv

# 2. nahtlose Schleife: das letzte Stueck ueber den Anfang blenden
ffmpeg -i norm.mkv -filter_complex "\
[0:v]trim=0:14.5,setpts=PTS-STARTPTS,split[m1][m2];\
[0:v]trim=14.5:16,setpts=PTS-STARTPTS[tail];\
[m1]trim=0:1.5,setpts=PTS-STARTPTS[mkopf];\
[m2]trim=1.5,setpts=PTS-STARTPTS[mrest];\
[tail][mkopf]xfade=transition=fade:duration=1.5:offset=0[misch];\
[misch][mrest]concat=n=2:v=1[v]" -map "[v]" -c:v ffv1 -an schleife.mkv

# 3. ausliefern
ffmpeg -i schleife.mkv -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 \
  -pix_fmt yuv420p -g 300 -deadline good -cpu-used 1 -an schwarzwald.webm

# 4. Standbild
ffmpeg -ss 0.2 -i schwarzwald.webm -frames:v 1 -c:v libwebp -quality 72 \
  schwarzwald.webp
```

Ob die Schleife sitzt, laesst sich messen — aber nur **gegen einen
Bezugswert**: PSNR letztes gegen erstes Bild, verglichen mit PSNR zweier
Bilder mitten im Film. Diese Fassung: 37,8 dB an der Naht, 39,1 dB im
Normalfall. Der Ruecksprung faellt also nicht staerker auf als ein
gewoehnlicher Bildwechsel. Eine nackte Differenzzahl ohne Bezug sagt
nichts.

Gerade Kantenlaengen sind fuer VP9 Pflicht (`-2` in `scale` erledigt das).

## Austauschen

Datei ersetzen **und die Seite ausrollen** (`tools/ausrollen.sh`) — sie
liegt in `static/`, kommt also erst durch den Build nach `/var/www/wov`.
Auf der Seite selbst braucht es keine Aenderung: sie fragt beim Laden per
HEAD nach und haengt das `<video>` nur ein, wenn etwas da liegt.

Stammt eine neue Aufnahme aus einer anderen Tageszeit, gehoeren die
Lichtwerte in `tools/web/vorschau-web.ts` nachgezogen (Suchwort: "Licht muss
zur AUFNAHME passen"). Sonst klebt die Figur vor dem Wald, statt darin zu
stehen.
