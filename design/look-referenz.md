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

## Nachtrag 10.09.2026: die VERHÄLTNISSE sind der Massstab

Mikes Sichtprüfung nach dem Ausrollen von `c6a3fee`: „Die Farben des
Bodens passen nicht — es wirkt alles sehr braun; die Texturen der
Berghänge sind zu hell; prüfe nochmal die Bilder. Bäume sind stellenweise
sehr hell vom Blattlaub her, nicht alle, einzelne."

Die Messung dazu hat drei Dinge ergeben, und das erste ist unbequem:
**Die Bodenzeilen trafen ihre Zielzahlen.** Der Wiesengrund stand mittags
im Vordergrund-Ausschnitt auf L 64,1 · H 54,4 · S 0,431 gegen L 52,9–61,9
· H 52–55 · S 0,42–0,46 im Vorbild, und die Cliff-Zeile am 45°-Hang auf
L 102,9 gegen 104,4. Wer also nur die Luma-Spalten der Tabelle oben
abhakt, findet keinen Fehler — und sieht trotzdem, was Mike sieht.

Der Fehler steht in den Spalten, die diese Datei selbst als die
belastbaren bezeichnet, und die bis heute niemand nachgerechnet hat:

| Verhältnis (Mittag, EIN Bild) | Vorbild | `c6a3fee` | nach dieser Runde |
| --- | --- | --- | --- |
| Hangfels / Himmel | 0,73 | 1,18 | 0,84 |
| Moos / Himmel | 0,435 | 0,855 | 0,62 |
| Hangfels / Moos | 1,69 | 1,37 | 1,33 |
| Kronen / Himmel | 0,34 | 1,02 | 0,65 |
| Kronen / Boden | 0,84 | 1,60 | 1,48 |
| Büschel / Grund | 1,12 | 1,07 | 1,06 |
| Himmel (Luma) | 142,1 | 93,4 | 111,6 |
| Kronen (Luma) | 48,3 | 94,9 | 72,1 |

Die `Hangfels`-Zeile der Tabelle steht auf dem FERNEN Hangband (Dunst
dazwischen). Nah am 45°-Hang, wo der Nebel nichts beiträgt, sieht es so
aus — und hier steht auch der Zeuge, aus dem die Zahl 0,6 stammt:

| 45°-Hang, `rock-rough` | Luma | H | S |
| --- | --- | --- | --- |
| Vorbild (Bild 3, Hangfels tan) | 104,4 | 30,5 | **0,408** |
| `c6a3fee`, Mittag | 102,9 | 33,5 | 0,338 |
| nachher, Mittag | 79,4 | 33,4 | 0,352 |
| nachher, am Hang mit Himmel im Bild | 76,1 | 33,6 | **0,410** |
| `c6a3fee`, 17 Uhr | **133,6** | 27,9 | 0,339 |
| nachher, 17 Uhr | 107,1 | 27,8 | 0,364 |

Die Zielluma sass also schon vorher — was fehlte, war die Sättigung, und
die kommt nicht aus einer Tönung, sondern aus dem Tonemapper: KHR-PBR-
Neutral entsättigt helle Werte, und eine Fläche, die zu hell steht,
verliert darüber ihre Farbe. Bei ×0,6 hört das auf.

Und der andere Grund, aus dem die Luma allein nichts gesagt hat: Um
17 Uhr, wo Mike gesehen hat, stand dieselbe Zeile auf 133,6 statt 104,4.
Die Kalibrierung war gegen MITTAG gefahren, der Befund kam vom Abend.

Gemessen mit `~/wov-lab-mess/farbe-rechtecke.py` auf
`~/.cache/wov-lab/farbe-fernblick-{vorher,nachher}.png` — einer Pose, in
der Himmel, Kronen, Hangband und Wiesengrund gleichzeitig im Rahmen
stehen. Nur so ist das Verhältnis eines; über zwei Aufnahmen hinweg
gemittelt wäre es keins.

Zwei Sätze fallen daraus:

* **Der hellste Boden stand HELLER als der Himmel.** Im Vorbild ist das
  nirgends zu finden (der Satz stand schon oben, unter „Bild 3"); bei uns
  war es der Normalfall, und um 17 Uhr misst die Cliff-Zeile 133,6.
* **Die Baumkronen standen auf der Himmelsluma und 60 % über dem Boden.**
  Im Vorbild sind sie DUNKLER als die Wiese. Das ist zugleich die
  Erklärung für „es wirkt alles sehr braun": Das Auge stellt sich auf die
  hellste grosse Fläche ein, und wenn das die Kronen sind, liest sich ein
  Wiesengrund, der die Referenz trifft, als dunkler Lehm.

### Was daraufhin gedreht wurde

| Regler | vorher | nachher | Zeuge |
| --- | --- | --- | --- |
| `Grass` (Tile 0) | [1,378 / 1,279 / 1,032] | [1,27 / 1,35 / 1,00] | R stand über G auf einer Textur mit R ≈ G — der Grund konnte gar nicht grün werden |
| `Cliff` (Tile 5) | [2,139 / 1,024 / 0,373] | [1,283 / 0,614 / 0,224] | bei ×0,6 hört das Ausbleichen durch den Tonemapper auf: S 0,410 gegen S 0,408 im Vorbild |
| `Moss` (Tile 11) | [1,317 / 0,972 / 1,0] | [0,623 / 0,460 / 0,473] | `Hangfels/Moos` auf 1,6, das Mittel der beiden Moosstreifen |
| `TOENUNG_DAEMPFUNG` (Laub) | — | ×0,41 je Laubrolle | Kronen/Boden 1,60 → 1,42, Kronen/Himmel 1,02 → 0,66 |
| `ahorn` in `TOENUNG_VORRANG` | Store [0,62 / 1,00 / 0,20] | Original [0,377 / 0,4095 / 0,209] | Albedo 2,39 × Median → 1,08 × Median |
| `fogColorDay` (Klar-Comic) | (0,68 / 0,73 / 0,79) | (0,83 / 0,87 / 0,92) | der Himmel war der zweite Teil des Missverhältnisses, s. unten |

### Die Sättigung ist eine Decke, kein Regler dieser Runde

Jede Fläche liegt um denselben Betrag unter der Referenzsättigung, und
zwar unabhängig davon, welche Fläche man misst:

| Fläche (Mittag) | unser S | Vorbild S |
| --- | --- | --- |
| Wiesengrund | 0,344 | 0,42 |
| Büschel | 0,442 | 0,468 |
| Hangfels | 0,338 | 0,408 |
| Moos | 0,376 | 0,414 |

Der Grund ist EIN Regler: `look.saettigung` steht auf 0,45. Am lebenden
Client gegengeprüft (Farbkurven aus, sonst nichts geändert): Der
Wiesengrund springt von S 0,344 auf 0,711, der Hangfels von 0,338 auf
0,640. Die Referenzwerte liegen also MITTEN in dem, was der Regler
wegnimmt — mit 0,45 sind sie auf keiner Fläche erreichbar, mit rund 0,57
wären sie es. `server.yml` gehört dieser Runde nicht; die Zahl steht hier,
damit sie beim nächsten Mal nicht wieder gesucht werden muss.

### Der Himmel hat jetzt eine Zielzahl

Bis hierher stand in der Kalibrierung: „Der Himmel hat keine Zielzahl
(das Vorbildbild gibt nur die beiden Böden vor)." Das ist überholt. Bild 3
enthält Hangfels UND Himmel UND Moos, und aus zwei der drei Zeilen folgt
die dritte: Ein Himmel, unter dem `Hangfels/Himmel = 0,73` und
`Moos/Himmel = 0,435` gleichzeitig gelten, ist festgelegt.

Unser Himmel stand um den Faktor 1,6 bis 1,9 zu dunkel unter diesen
beiden Bedingungen — und zusätzlich zu satt (S 0,354 gegen 0,133 im
Vorbild; der Vorbildhimmel ist ein heller Dunst, unserer ein tiefes
Blau). Angehoben wurde deshalb der Tag-Keyframe `fogColorDay` (der
Horizont IST die Nebelfarbe, `look.himmel.horizont: nebel`), von
(0,68 / 0,73 / 0,79) auf (0,83 / 0,87 / 0,92).

Weiter geht es an dieser Schraube nicht: `fogColor` ist eine sRGB-Farbe
mit Anschlag bei 1,0, und `ValheimSky` leitet den Zenit als
0,45/0,55/0,80 des Horizonts ab — die Bildluma des Himmels lässt sich so
um höchstens etwa ×1,3 heben, gebraucht wären ×1,6. Der Rest sitzt in
`ValheimSky.ts` (Zenitableitung) und in der Belichtung, und beides
gehörte dieser Runde nicht. Deshalb bleibt `Hangfels/Himmel` bei 0,84
statt 0,73 stehen; das ist der benannte Rest, nicht ein übersehener.

### Was NICHT der Befund war

* **Der Wiesengrund.** Er trifft die Referenz an beiden Stunden
  (17 Uhr: L 54,0 · H 58,6 gegen L 57,5 · H 53; Halm H 56,1 gegen H 56,0).
  Geändert wurde an ihm nur die Kanalreihenfolge, nicht die Helligkeit.
* **`rock-a`.** Am 24°-Schwarzwaldzeugen mittags L 28,9 bei B−R −0,3 —
  neutrales Dunkelgrau, wie Bild 2 es verlangt (28,1 bis 39,3, B−R ≈ 0).
* **Die `-snow`-Modelle.** Der Laub-Zensus wirft `grass-short-clump-snow`
  mit 3,41 × Median aus; das Modell steht ausschliesslich in
  `GRAS_BUESCHEL_HOCHNORD` (`shared/src/storeFlora.ts`) und ist damit
  kein Wiesenproblem. `tools/test/look-referenz.ts` prüft beides
  zusammen: die Ausnahme für Schnee UND dass Schnee im Hohen Norden
  bleibt.
* **Die Findlinge und Klippen-MESHES.** Sie stehen im Bild deutlich zu
  hell (am hanghimmel-Zeugen misst der Findling neben der Figur L 183
  gegen L 50,6 und 75,9 der beiden Felsbrocken aus Bild 1). Das ist
  `tools/store-prefabs.mjs` und nicht diese Runde — festgehalten, damit
  es nicht noch einmal gesucht wird.

## Nachtrag 10.09.2026 (2): die Spezifikation schlägt das Bild

Seit `design/original-boden.md` gibt es eine zweite Quelle, und sie ist
die stärkere: Zahlen aus den SPIELDATEIEN von Tale of Dark Lands statt
aus Screenshots. Wo beide etwas sagen, gilt die Spezifikation; diese
Datei bleibt für das, was nur ein Bild hergibt — die VERHÄLTNISSE.

Drei Zeilen dieser Datei sind damit überholt und stehen nur noch als
Geschichte:

| Zeile | stand hier | sagt die Spezifikation |
| --- | --- | --- |
| Halmhöhe | 0,64–1,04 m, gegen die Figur geschätzt | **0,50–0,75 m**; die Figur steht im Bild näher an der Kamera als die Büschel (§B, F28) |
| `rock-rough` (Tile 5) als „heller Fels" | `Terrain_Meadow_Rock_Rough_01` | diese Ebene benutzt **kein einziges Terrain des Spiels**; gemeint ist `Terrain_Meadow_Rock_Moss_01` (7 m, Normale 2,0 — F26) |
| `rock-a` (Tile 4) bei Metallic 0,85 | „Metallic senken wäre die falsche Richtung" | Level1 fährt `Ani Dark Rockwall **3**` mit Metallic **0,20** und Kachel 5 m (F25) — die Messung war richtig, die Ebene die falsche |

Und eine Zeile, die schon hier stand und jetzt eine Begründung hat: Die
Sättigung 0,45 war „eine Decke, kein Regler dieser Runde". Sie ist keine
Decke mehr — das Vorbild überschreibt `saturation` in **keiner** seiner
zwölf Szenen (§E, F2), und der Regler steht auf 1,0.

### Was am Maßstab NICHT überholt ist

Die drei binnenbildlichen Verhältnisse aus Bild 3. Sie kommen aus einem
Bild, in dem Himmel, Hangfels und Moos gleichzeitig stehen, und genau
das kann keine Asset-Datei ersetzen:

    Hangfels / Himmel  0,73      Moos / Himmel  0,435
    Kronen  / Himmel   0,34      Hangfels / Moos 1,69

### Wie sie ab jetzt gemessen werden — zwei Fallen, beide bezahlt

**(1) Ein Fehlschuss ist kein Himmel.** `~/wov-lab-mess/original-lib.mjs`
ordnet jede Rasterzelle über `scene.pick` einer Schicht zu und hat
Zellen, in denen der Strahl nichts trifft, als „Himmel" gezählt. In
Wahrheit steht dort meist ferner, vom Nebel gedeckter Boden.

**(2) Die Baumkronen sind nicht pickbar.** Gemessen am Referenzort: In
923 von 1600 Zellen trifft der Strahl die Himmelskuppel HINTER der
Krone. Die Zellenmaske kann Kronen deshalb weder finden noch aussparen —
der „Himmel" mass RGB 74/96/71, also Laub, während die Kuppel selbst auf
129/145/149 steht. Ein Verhältnis gegen diesen Himmel ist keins.

Behoben ist beides über denselben Handgriff, den die Halmmaske schon
benutzt: einmal MIT und einmal OHNE die Kronen aufnehmen. Die Differenz
ist die Kronenfläche, die Aufnahme ohne Kronen der saubere Himmel.
Erkannt werden Kronen am MATERIALNAMEN (`laub`, `laubDunkel`,
`laubSchnee`, `nadeln`, `ahorn`, `baum`) — die Rinde heisst anders.

### Der Zeuge heisst jetzt `weitblick`

Die alte Bergblick-Pose taugt für diese Verhältnisse nicht mehr: Mit dem
linearen Nebel des Vorbilds (15 → 200 m) ist alles, was dort „Hangfels"
heisst, zu über 90 % Nebelfarbe. Nachgemessen: Sonne × 0,5 und
Grundlicht × 0,12 bewegen den „Fels" dieser Pose von 88,4 auf 81,9 — er
hängt am Nebel und nicht am Licht.

Gemessen wird deshalb an zwei Posen, und beide stehen im Messskript:

* `weitblick` (10077/−18723, Blick waagerecht, Neigung −0,25): Himmel,
  Kronen und Wiesengrund in einem Rahmen.
* `hanghimmel` (10111/−18649, Neigung −0,62): Fels und Himmel in einem
  Rahmen, nah genug, dass der Nebel nicht die Aussage ist.

### Und die eine Zahl, die keine Belichtung repariert

Ohne Tonemapper (`look.tonemapping: aus`, wie das Vorbild) ist ein
sRGB-Luma-VERHÄLTNIS unabhängig von der Belichtung: Beide Seiten laufen
durch dieselbe Potenz 1/2,2, der gemeinsame Faktor kürzt sich heraus.
Nachgemessen über eine Reihe von Belichtung 0,8 bis 2,0 am selben Bild:
`Moos/Himmel` wandert von 0,857 auf 0,862 — fünf Tausendstel über eine
Verdopplung der Helligkeit.

Das trennt die Kalibrierung sauber in zwei Schritte, und beide haben
ihren eigenen Regler:

    VERHÄLTNIS   Licht und Grundlicht (shared/src/environment.ts)
    HELLIGKEIT   look.belichtung (server/data/server.yml)

Mit einem Tonemapper wäre das nicht so — er verschiebt Verhältnisse,
sobald sich die Belichtung ändert, und genau deshalb hat die Runde vom
09.09. die Zielsättigung nie getroffen.

### Der Stand nach dem Umbau (10.09.2026, Bauer „Original-Boden")

Gemessen mit `~/wov-lab-mess/original-mess.mjs` an 16 Posen, vorher der
Stand `2c359d0`, nachher `lab/original`. Die Verhältnisse stehen je Pose,
weil sie nur INNERHALB eines Bildes eine Aussage sind.

| Verhältnis (Mittag) | Pose | Vorbild | vorher | nachher |
| --- | --- | --- | --- | --- |
| Moos / Himmel | `weitblick` | 0,435 | — | **0,417** |
| Moos / Himmel | `wiese-eben` | 0,435 | 0,606 | **0,424** |
| Moos / Himmel | `schwarzwald` | 0,435 | 0,633 | **0,423** |
| Hangfels / Himmel | `hanghimmel` | 0,73 | — | **0,634** |
| Hangfels / Himmel | `hanghimmel`, 17 Uhr | 0,73 | — | **0,732** |
| Hangfels / Himmel | `berg` | 0,73 | 1,067 | 0,806 |
| Kronen / Himmel | `weitblick` | 0,34 | — | 0,670 |
| Hangfels / Moos | `hanghimmel` | 1,69 | — | 1,177 |

Und die absoluten Zahlen am Verhältniszeugen `weitblick` (Mittag):

| Region | Vorbild (Bild 3 / Bild 1) | nachher |
| --- | --- | --- |
| Himmel | 142,1 | **142,3** |
| Moos | 61,8–67,8 | 59,4 |
| Wiesengrund | 57,5 (Bild 1, Nachmittag) | 47,0 |
| Kronen | 48,3 | 95,3 |

Clipping ist auf allen sechzehn Aufnahmen 0,000 bis 0,003 %.

### Die drei Lücken, mit Diagnose

**Kronen / Himmel 0,67 gegen 0,34.** Das ist die grösste. Sie ist NICHT
die Laubdämpfung: Die stand bis heute auf ×0,41 und ist zurückgenommen
worden (sie war eine Bildkorrektur an der Albedo, s. `store-vegetation-
aufbereiten.mjs`) — und das Licht des Vorbilds erreicht ohne sie
denselben Wert, den sie vorher erreicht hat (0,65 bis 0,67). Der Rest
sitzt im VERHÄLTNIS der Albedos: Im Vorbild ist die Krone DUNKLER als
der Bodengrund (48,3 gegen 61,8), bei uns heller (95,3 gegen 59,4). Das
ist eine Aussage über die Laubatlanten und nicht über eine
Look-Einstellung — und `design/original-boden.md` misst zwar die
Baum-PREFABS von Level1 (§C), nicht aber ihre Materialfarben. Solange
die fehlt, wäre jeder Faktor hier wieder eine Zahl aus einem Bild.

**Hangfels / Moos 1,18 gegen 1,69.** Der Grund steht in der Rampe: Mit
dem Deckel des Vorbilds (0,425 bei ≥ 45°) ist unser Fels an JEDER Stelle
eine Mischung, und die gemessenen „Fels"-Bildpunkte tragen zu einem
Viertel bis zur Hälfte Moos. Das Vorbild hat denselben MITTELWERT und
trotzdem reine Felsbänder, weil seine Karte gemalt ist; die Rauschmaske
in `TerrainSplat.ts` holt einen Teil dieser Streuung zurück (Fels
erreicht in den stärksten Flecken 0,78), aber nicht die ganze.

**Der Farbort des hellen Felses.** Er misst jetzt H 169–213 bei S 0,13
statt der H 30 / S 0,41 des Vorbilds — grau-grün statt tan. Zwei
Ursachen, beide benannt: die Mischung von oben, und die Textur.
`terrain-rock-rough` ist NICHT `Terrain_Meadow_Rock_Moss_01`; deren
Diffuse-Karte liegt nicht im Speicher, übernommen sind nur Kachelmaß und
Normalstärke (F26). Vorher stand diese Zeile auf H 33 / S 0,35 — aber nur,
weil eine Tönung [1,283 / 0,614 / 0,224] sie dorthin gerechnet hat.

## Nachtrag 11.09.2026: Himmel (A5), Nebelwand (A6), Sonnenhof (A12), Schatten (A7)

Bauer „Himmel und Licht", Block A der [[Roadmap — ToDL-MMORPG (Labor)]].
Zeuge für alles hier: `~/wov-lab-mess/himmel-mess.mjs`, Bilder und
Rohwerte unter `~/.cache/wov-lab/a5-*`, `a6-*`, `a7-*`, `a12-*`.

### Die dritte Quelle: die Original-Würfelkarte

Bis hierher galt die Begründung aus `server.yml`: „Was die Referenz
hergibt, ist GENAU EINE Himmelsfarbe — ein Verlauf wäre eine Erfindung."
Das stimmte, solange die Cubemap nur behauptet war. Sie liegt lokal vor
(`~/wov-assets/Assets/Cubemap/AllSky_FantasyClouds_High3.png`, ein
Streifen aus sechs 2048er-Flächen in der Reihenfolge +X −X +Y −Y +Z −Z)
und ist mit dem Tint `#B2D1FE` und der Exposure 0,8 des Vorbilds
vermessen:

| Elevation | Luma | Sättigung |
| --- | --- | --- |
| +42° | 113 | 0,58 |
| +30° | 137 | 0,47 |
| +23° | 153 | 0,39 |
| +14° | 161 | 0,36 |
| +5° | 168 | 0,33 |

**Der Zenit ist dunkler und blauer, der Horizont heller und blasser.**
Dieselbe Richtung misst Bild 3 auf dem Bildschirm, nur flacher (oben
L 137,7 / S 0,135, weiter unten L 154,6 / S 0,070) — die Nachbearbeitung
des Vorbilds drückt seinen eigenen Verlauf zusammen, und unsere tut das
auch.

Das ist der zweite Stützpunkt, der 2026-09-10 noch fehlte. Tor T2 ist
damit nicht nur entschieden, sondern belegt.

### Die Wolken haben eine Zielzahl

Gemessen in Bild 3, Fenster 1170–1350 / 0–150 (reiner Himmel, ohne Berg
und ohne Sonnenhof):

    Spanne p95 − p5 = 28 Luma        Anteil über 1,03 × Median = 32 %

Wichtig ist, WIE man das nachmisst: innerhalb EINES Elevationsbandes.
Über den ganzen Himmel gemessen wäre der Verlauf als Streuung mitgezählt
und jede Wolkenaussage eine Aussage über den Verlauf.

### Der Sonnenhof hat zwei Terme, nicht einen

Radiales Profil um den hellsten Punkt des Sonnenhofs in Bild 3
(Himmelsgrund dort rund L 152):

| Abstand | Luma | Überschuss |
| --- | --- | --- |
| 0–40 px | 197 | +45 |
| 40–80 px | 177 | +25 |
| 120–160 px | 166 | +14 |
| 160–200 px | 155 | +3 |
| > 240 px | ≈ 152 | ±0 |

Der schmale Term (`sonnenglühen` 0,2 = Exponent 176) hat 5,1°
Halbwertsbreite und ist bei 9° praktisch aus — er trifft den Kern und
lässt den Hof weg. Deshalb A12: ein zweiter, breiterer Summand
(`haloBreite` 0,28 = Exponent 65 = 8,3° Halbwertsbreite, `haloStaerke`
0,22). Beide stehen nebeneinander, nicht statt einander.

### Was daraus in den Daten steht

| Stelle | vorher | nachher | warum |
| --- | --- | --- | --- |
| `look.himmel.zenit` | `#819195` | `#6B8798` | dunkler und blauer, Richtung aus der Würfelkarte |
| `look.himmel.horizont` | `#819195` | `#8D9598` | heller und blasser, dito |
| `rainCloudAlpha` (Klar-Comic) | 0,06 | 0,40 | 0,06 war rechnerisch wolkenlos, s. unten |
| `look.schatten.dunkelheit` | 0,42 | 0,62 | Verhältnis Licht/Schatten am Fels, Bild 2 = 1,21 |
| neu: `look.himmel.wolken*`, `silberrand`, `halo*` | — | `shared/src/lookHimmel.ts` | bis zur Einhängung Vorgaben |

### Zwei Rechnungen, die wie Regler aussahen und keine waren

**(1) Eine Wolkendeckung von 0,06 ist keine geringe Deckung, sondern
keine.** Die Kuppel prüfte ihre FBM-Dichte gegen `1,25 − Deckung · 1,15`
und nahm dabei an, die Dichte laufe über 0..1. Nachgemessen über 4.800
Richtungen des sichtbaren Himmels tut sie das nicht: Mittel 0,466,
Streuung 0,069, p5 0,363, p95 0,584 — eine Summe aus fünf Oktaven landet
nach dem Grenzwertsatz um ihren Mittelwert. Mit 0,06 stand die Schwelle
1,7 Streuungen darüber; wo sie überschritten war, lag die Deckkraft bei
5 %. Die Wolken waren rechnerisch vorhanden und im Bild nicht zu sehen.
Seit die Dichte zuerst auf ihre eigene Streuung normiert wird, heisst der
Regler, was sein Name sagt: 0,20 → 11 %, 0,34 → 24 %, 0,50 → 41 % des
Himmels.

**(2) Die CPU-Fassung des Himmels war nie nachgezogen worden.**
`ValheimSky.himmelsFarbeToRef()` — die Quelle des Umgebungslichts —
rechnete den Sonnenschein mit `pow(cos, 8)`, der Shader längst mit dem
Profilwert (`sonnenglühen` 0,2 → 176). Acht ist ein Lappen von 23°
Halbwertsbreite, 176 einer von 5°: Das Umgebungslicht trug eine
Sonnenwärme über rund ein Achtel der Kugel, die die Kuppel nirgends
zeichnet. Die Zahl stammt aus der Zeit vor dem Profilregler.

### Wie man den Himmel ab jetzt misst

Drei Zeugen, alle in `~/wov-lab-mess/himmel-mess.mjs`:

* **Verlauf** — Himmelsluma je Elevationsband, aus den KAMERAACHSEN
  gerechnet und nicht aus der Bildzeile. Eine Bildzeile ist bei geneigter
  Kamera keine Höhe.
* **Wolken** — Streuung (p95 − p5) und Anteil über 1,03 × Median
  innerhalb eines Bandes.
* **Naht** — mittlere Farbe im Band 0,3°…1,2° über und unter `dir.y = 0`.
  Ohne Maske, weil dort keine Zelle verlässlich ist: Der Strahl trifft
  mal die Kuppel, mal fernes Wasser, mal nichts.

Und zwei Fallen, beide bezahlt:

* **Eine Himmelszelle ist nicht lauter Himmel.** Die Zellenmaske aus
  `original-lib.mjs` etikettiert je MITTELSTRAHL; an den Zellenrändern
  steht trotzdem Blatt. Wer die ganze Zelle misst statt ihres
  Mittelfensters (und dabei das Laub nicht ausblendet), bekommt am
  Referenzort L 118,5 / S 0,202 statt L 142,2 / S 0,081 — und eine
  „Wolkenspanne" von 75, die die Baumkrone ist.
* **Die Kamera kann nicht nach oben sehen.** Sie ist ein Ausleger, der
  auf die Figur zielt; bei negativer Neigung sinkt sie unter die Figur
  und wird vom Boden geklemmt. Gemessen: −0,25, −0,95 und −1,35 liefern
  auf ebenem Grund dasselbe Bild. Was ein Spieler vom Himmel überhaupt zu
  sehen bekommt, sind die Elevationen **−8° bis +37°** — dort müssen die
  Wolken lesbar sein, und dort ist die alte Projektion `dir.xz /
  max(up, 0,06)` zu Rauschen zusammengeschrumpft.

### A7: das Schattenverhältnis, und was es NICHT beweist

Pose `felsschatten` steht bei **10111 / −18649** (Gier −2,734, Neigung
0,20, Ausleger 4,5) — dem freien 46°-Hang aus Gestein und Moos. Nicht an
einem Findling: `findlingSuchen()` findet am Referenzort 66 Store-Felsen,
prüft mit einem Strahl zur Sonne, welche besonnt sind, und liefert die
acht grössten; jeder einzelne steht im geschlossenen Laubwald
(`~/.cache/wov-lab/findling-0..7.png`). Was die Schattenmaske dort misst,
sind Baumstämme unter einem Kronendach — Verhältnis 1,00, also gar keine
Aussage.

Die Schattenmaske entsteht durch ABSCHALTEN: einmal mit Schatten, einmal
mit `ShadowGenerator.darkness = 1`, die Differenz IST der Schlagschatten.
Gemessen wird auf den Gesteinsschichten `rock-rough` und `rock-a`.

| `look.schatten.dunkelheit` | Licht / Schatten am Fels |
| --- | --- |
| 0,25 | 1,375 |
| 0,42 (vorher) | 1,313 |
| **0,62** | **1,236** (Vorbild 1,21) |

`ambColorDay` ist dabei nicht mitbewegt worden, und das ist gemessen und
nicht vergessen: Der Schritt von 0,42 auf 0,62 hebt am Zeugen
`weitblick` den Moosgrund von L 59,8 auf 59,5 und den Himmel von 142,8
auf 143,0 — unter einem Prozent, `Moos/Himmel` bleibt bei 0,416. Es gab
nichts auszugleichen.

**Was damit nicht erreicht ist:** Das Vorbild kommt auf sein flaches
Verhältnis über einen SCHWARZEN Schatten und ein sehr starkes
Cubemap-Grundlicht (direkt/Grundlicht ≈ 0,5 linear), wir über ein
aufgehelltes Schattenrestlicht (≈ 3,3). Dieselbe Zahl, anderer Weg. Den
Weg des Vorbilds zu gehen hiesse, das Grundlicht auf das Sechsfache zu
heben und die Bodenkalibrierung der Stufe 2 neu zu fahren.
