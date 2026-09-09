# Look-Referenz — gemessen, nicht geschätzt

Drei Aufnahmen aus dem Original (`~/wov-assets/proof-staging/`, je
2000 × 562, mit HUD-Ecken und Vignette) sind ab dem 09.09.2026 die
Zielvorgabe für Boden, Fels und Gras. Diese Datei hält fest, WO gemessen
wurde und WAS dabei herauskam — damit jede Tönungszahl im Repo auf eine
Zeile hier zeigen kann statt auf einen Eindruck.

## Wie gemessen wird

Auf den sRGB-Bytes des Bildes, so wie ein Spieler sie sieht — nicht auf
dem linearen Puffer. Fünf Grössen je Rechteck:

| Grösse | Rechnung |
| --- | --- |
| Luma | `0.2126·R + 0.7152·G + 0.0722·B` (Rec. 709), Mittel über alle Bildpunkte |
| RGB | Kanalmittel |
| H | HSV-Farbton in Grad, aus dem RGB-**Mittel** (nicht der Mittelwert der Einzeltöne — der ist bei einem Farbkreis undefiniert) |
| S | HSV-Sättigung `(max−min)/max`, Mittel über die Einzelbildpunkte |
| B−R | `B_mittel − R_mittel`; das Vorzeichen sagt warm (negativ) oder kalt (positiv) |

Dieselbe Rechnung fährt `~/wov-lab-mess/fein-mess.mjs` auf unseren
Aufnahmen, damit die beiden Tabellen vergleichbar sind.

Die Rechtecke sind von Hand gewählt und stehen unten als
`x0,y0–x1,y1` in Bildkoordinaten. Zwei Regeln galten dabei:

* **HUD-Ecken und Vignette bleiben draussen.** Oben links steht die
  Uhrzeit, oben rechts der Auftragstext, unten links das Lebensrad; die
  Vignette dunkelt alle vier Ecken ab. Gemessen wird deshalb nur in der
  Bildmitte (x zwischen 300 und 1700, y zwischen 5 und 540).
* **Ein Rechteck zeigt EINE Sache.** Jeder Ausschnitt wurde vierfach
  vergrössert angesehen, bevor er in die Tabelle kam; Rechtecke mit
  Gras am Rand oder einem Bein der Figur darin wurden verschoben.

Für die Büschel steht zusätzlich eine Zeile *Spitzen*: das oberste
Luma-Drittel innerhalb desselben Rechtecks. Ein Büschel ist kein
Farbfeld — zwischen den Halmen liegt Grund, und was das Auge als
„Halmfarbe" liest, ist die helle Hälfte.

## Bild 1 — Wiese von oben

Warmes Nachmittagslicht. Mittelgrüner Grund mit Gelbstich, hohe dichte
Büschel mit hellen Spitzen, tan-braune Erdflecken, ein paar
Felsbrocken als Meshes.

| Region | Rechteck | Luma | RGB | H | S | B−R | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Grund zwischen den Büscheln 1 | 800,320–865,362 | 58.0 | 62.9/58.5/38.5 | 49.2 | 0.387 | −24.3 | 2730 |
| Grund zwischen den Büscheln 2 | 500,320–590,380 | 56.9 | 59.5/58.5/32.9 | 57.8 | 0.447 | −26.5 | 5400 |
| Büschel 1 | 405,205–490,275 | 64.3 | 68.1/66.0/36.2 | 56.0 | 0.468 | −31.9 | 5950 |
| Büschel 1, Spitzen | 405,205–490,275 | 75.5 | 80.6/77.5/39.9 | 55.5 | 0.506 | −40.7 | 1965 |
| Büschel 2 | 610,5–700,65 | 57.8 | 62.1/58.3/40.4 | 49.5 | 0.345 | −21.7 | 5400 |
| Büschel 2, Spitzen | 610,5–700,65 | 65.8 | 70.7/66.8/41.6 | 51.9 | 0.410 | −29.1 | 1782 |
| Erdfleck | 585,178–635,220 | 70.1 | 79.5/69.5/48.4 | 40.7 | 0.389 | −31.1 | 2100 |
| Felsbrocken 1 (Mesh) | 785,425–830,462 | 50.6 | 58.6/49.0/42.9 | 23.2 | 0.263 | −15.7 | 1665 |
| Felsbrocken 2 (Mesh) | 335,315–378,335 | 75.9 | 89.3/73.7/58.8 | 29.2 | 0.345 | −30.5 | 860 |

Ableitungen, die keine Belichtung brauchen:

* **Büschel / Grund = 1,12** (64,3 zu 57,5 im Mittel beider Rechtecke).
  Die Halme stehen also nur wenig heller als der Grund; sie fallen durch
  ihre FORM auf, nicht durch Helligkeit.
* **Spitzen / Büschel = 1,17.** Der Verlauf steckt im Atlas, nicht im
  Licht.
* **B/R = 0,55 bis 0,61** über Grund und Büschel. Das Bild ist durchweg
  warm; grün heisst hier gelbgrün.

### Deckung — wie dicht ist dicht?

„Dicht" lässt sich im Original nicht über eine Instanzzahl messen, es
gibt kein „Gras aus". Ersatzweise der Anteil der Bildpunkte, die um mehr
als 10 Luma über dem Grundmittel (57,5) liegen, gemessen im Ausschnitt
`300,0–1700,500`:

| Schwelle | Anteil |
| --- | --- |
| Grund + 8 | 21,0 % |
| Grund + 10 | 17,1 % |
| Grund + 12 | 13,8 % |

Also **rund 17 %** nach dem mittleren Kriterium. `fein-mess.mjs` rechnet
dieselbe Zahl auf unseren Aufnahmen (`deckungHell`).

### Halmhöhe

Aus demselben Bild, über die Figur als Massstab:

* Figur: Kopf y 262 bis Fuss y 366 → **104 Bildpunkte** (Ausschnitt
  900,240–1060,400 angesehen).
* Büschel daneben (Ausschnitt 780,200–900,300): die niedrigen spannen
  y 248 bis 285 → 37 Bildpunkte, die hohen y 205 bis 265 → 60.

Bei 1,80 m Figurhöhe sind das **0,64 m bis 1,04 m** Halm. Die Büschel
liegen im Bild weiter weg als die Figur, sind also eher noch etwas
höher als diese Rechnung sagt.

## Bild 2 — Felshang im Schatten

Fast das ganze Bild liegt im Schlagschatten. Der Fels ist dort dunkel,
aber NICHT schwarz und NICHT bunt: neutral bis eine Spur purpur, mit
klar lesbaren Facetten.

| Region | Rechteck | Luma | RGB | H | S | B−R | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fels mit Licht 1 | 325,90–400,185 | 46.3 | 51.5/45.1/43.3 | 12.9 | 0.177 | −8.2 | 7125 |
| Fels mit Licht 2 | 310,190–390,270 | 49.2 | 55.8/47.6/46.0 | 9.7 | 0.183 | −9.8 | 6400 |
| Fels im Schatten 1 | 645,265–760,375 | 39.3 | 40.1/39.0/40.1 | 301.6 | 0.091 | −0.0 | 12650 |
| Fels im Schatten 2 | 640,400–750,470 | 28.1 | 27.0/28.5/26.8 | 113.3 | 0.085 | −0.2 | 7700 |

Der Farbton der beiden Schattenzeilen ist bei S 0,09 **keine Aussage** —
bei einer Sättigung unter etwa 0,1 wandert H schon durch Rundungsrauschen
über den halben Kreis. Was zählt, ist B−R ≈ 0: der Schattenfels ist
neutral grau. Die belichteten Flächen sind mit B−R ≈ −9 leicht warm.

* **Licht / Schatten = 1,21** (47,8 zu 39,3). Der Kontrast zwischen
  besonnter und beschatteter Felsfläche ist im Original klein.

## Bild 3 — Bergpanorama in der Sonne

Die Vorgabe für den HELLEN Fels und für die Moosstreifen. Klippen und
Grate sind Meshes (Stufe 3), stehen hier nur zur Einordnung.

| Region | Rechteck | Luma | RGB | H | S | B−R | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hang-Fels tan 1 | 560,355–632,392 | 104.4 | 126.2/100.9/74.7 | 30.5 | 0.408 | −51.5 | 2664 |
| Hang-Fels tan 2 | 1130,440–1200,462 | 103.0 | 123.5/99.5/77.4 | 28.8 | 0.372 | −46.2 | 1540 |
| Moosstreifen 1 | 330,300–420,320 | 61.8 | 69.1/61.8/40.4 | 44.7 | 0.414 | −28.6 | 1800 |
| Moosstreifen 2 | 1040,495–1105,535 | 67.8 | 75.1/67.7/47.1 | 44.1 | 0.372 | −28.0 | 2600 |
| Klippen-Mesh | 900,130–970,260 | 52.3 | 54.5/51.0/59.6 | 264.7 | 0.177 | +5.0 | 9100 |
| Ferne Berge | 1400,130–1470,190 | 75.3 | 57.7/77.4/106.2 | 215.7 | 0.457 | +48.6 | 4200 |
| Himmel | 1220,20–1290,70 | 142.1 | 129.0/145.4/148.6 | 190.0 | 0.133 | +19.7 | 3500 |

* **Hangfels / Moos = 1,60.** Der helle Fels steht deutlich über dem
  Moos — aber er ist tan, nicht weiss: S 0,39 bei H 30.
* **Hangfels / Himmel = 0,73.** Der hellste Boden bleibt unter dem
  Himmel. Ein Boden, der HELLER ist als der Himmel darüber, ist in
  diesem Vorbild nirgends zu finden.
* Alles, was Ferne ist, wird BLAU (B−R +49 bei den fernen Bergen, +20
  am Himmel), alles, was nah ist, warm. Das Vorzeichen von B−R ist
  damit auch ein Entfernungsmass.

## Was daraus Zielvorgabe wurde

| Unsere Schicht | Zielzeile oben | Zahl |
| --- | --- | --- |
| `grass-a` (Tile 0, Wiesengrund) | Bild 1, Grund (Mittel) | Luma 57,5 · RGB 61,2/58,5/35,7 · H 53 · S 0,42 |
| `moss` (Tile 11, Hang des Graslands) | Bild 3, Moosstreifen | H 44 · S 0,39 bei gleichbleibender Luma |
| `rock-a` (Tile 4, dunkler Fels) | Bild 2, Fels im Schatten | B−R ≈ 0 — **erreicht, ohne Regler** (siehe unten) |
| `rock-rough` (Tile 5, heller Fels) | Bild 3, Hang-Fels tan | Luma ≈ 104 · H 30 · S 0,39 |
| Store-Gras `gras` (Halm) | Bild 1, Büschel 1 | Luma 64,3 · RGB 68,1/66,0/36,2 · H 56 · S 0,47 |
| Halmhöhe | Bild 1, Massstab Figur | 0,64 bis 1,04 m |
| Grasdeckung | Bild 1, Schwelle Grund + 10 | ≈ 17 % |

Die Stunde gehört zur Zahl: Bild 1 und 2 sind warmes Nachmittagslicht
und werden gegen unsere 17 Uhr (`t=0.708333`) gehalten, Bild 3 steht in
der Sonne und wird gegen Mittag (`t=0.5`) gehalten. Wer eine Zeile gegen
die falsche Stunde kalibriert, trifft eine Farbe, die im Bild nie
vorkommt.

## Was diese Tabelle NICHT sagt

Die drei Aufnahmen tragen ihre eigene Belichtung, und die ist nicht
unsere. Ein direkter Luma-Vergleich über Bilder hinweg wäre deshalb
falsch — innerhalb EINES Bildes sind die Verhältnisse aber belastbar,
und genau deshalb stehen sie oben je Bild ausgerechnet
(Büschel/Grund, Licht/Schatten, Hangfels/Moos, Hangfels/Himmel).

Ebensowenig sagt sie etwas über Klippen- und Findling-MESHES: Die
Zeilen `Klippen-Mesh` und `Felsbrocken` stehen zur Einordnung da, nicht
als Auftrag. Sie gehören zu Stufe 3.

## Nachtrag: die eine Zeile ohne Regler

`rock-a` (Tile 4) hat nach dieser Messrunde **keine** Tönung bekommen,
und das ist ein Ergebnis, kein Rest. Zwei Zahlenpaare dazu, beide am
selben Zeugen — einer 24°-Schwarzwaldflanke bei −27060/−5500, wo
`HANG_TILE[Forest] = Rock` gilt und die Schicht tatsächlich zu sehen ist:

| | ohne Tönung | mit Tönung [0,95 / 0,97 / 1,30] |
| --- | --- | --- |
| 17 Uhr | 65.7/69.0/63.7 · B−R −2.0 | 63.6/66.0/60.6 · B−R −3.0 |
| Mittag | 68.2/72.8/65.6 · B−R −2.6 | 65.0/69.7/62.8 · B−R −2.2 |

Ein Blauzuschlag von 30 % auf die Albedo bewegt B−R um weniger als ein
Byte, und in beiden Richtungen. Bei Metallic 0,85 ist das Bild dieser
Schicht der Himmelsterm, nicht ihre Eigenfarbe.

Zwei Folgerungen stehen damit fest:

* **Das Ziel ist erreicht.** B−R −2 bis −3 ist praktisch neutral, also
  das verlangte Blaugrau. Von „schwarz" (dem Befund aus
  `boden2-hang-nachher.png`) ist bei Luma 66 bis 68 nichts übrig.
* **Metallic senken wäre die falsche Richtung.** Der Faktor
  1/(1−0,85) = 6,7 auf den diffusen Anteil würde eine Schicht aufhellen,
  die gegenüber der Referenz (Fels im Schatten 39.3, Fels im Licht 46.3)
  ohnehin schon zu hell steht.

**Und die Falle, an der der erste Anlauf hängengeblieben ist:** Wer
diese Schicht am STEILSTEN Hang misst, misst sie nicht. Ab 40° zieht
`RAU_TILE` den hellen `rock-rough` darüber; am 47°-Nordhang sind die
„rock-a"-Bildpunkte zu grossen Teilen heller Fels. Eine Tönungsänderung
an `rock-a` schien dort in die Gegenrichtung zu wirken — sichtbar war in
Wahrheit die Cliff-Zeile.
