/**
 * Store-Felsen — die Streutabelle für die Felsmodelle aus
 * `assets/store/environment/`.
 *
 * `storeFlora.ts` ist die Streutabelle des BEWUCHSES, diese hier die des
 * GESTEINS. Getrennte Dateien, gleiche Bauart (`FloraKurz`), gleicher
 * Umrechner in `flora.ts` — die Trennung ist keine Technik, sondern
 * Besitz: Vegetation wird an anderer Stelle gepflegt, und zwei Bauer in
 * einer Tabelle bauen sich gegenseitig die Zeilen um.
 *
 * Auftrag (09.09.2026): „Die grossen Felsen mit in den Generator
 * aufnehmen, dass diese an Hängen öfter vorkommen und ggf. auch ein
 * wenig eingearbeitet sind."
 *
 * ── Die zwei Sätze, um die es geht ───────────────────────────────────
 * „An Hängen öfter" ist das NEIGUNGSFENSTER (`minTilt`/`maxTilt`), und
 * es ist neu: Bis hierher trug jeder Streueintrag `minTilt: 0` und
 * benutzte nur die Obergrenze — jede Art wuchs vom flachen Boden bis zu
 * ihrer Grenze, und „öfter am Hang" war gar nicht ausdrückbar. Erst eine
 * UNTERGRENZE macht einen Eintrag zum Hangbewohner:
 *
 *     klein   0–20°   die Wiese (Referenzbild 1: verstreute Brocken)
 *     mittel  15–35°  der Übergang, Hangfuss und Kuppen
 *     gross   25–55°  Steilhang und Grat (Referenzbild 3)
 *
 * Die Fenster überlappen sich um 5°, damit der Wechsel nicht als Kante
 * im Gelände steht.
 *
 * „Eingearbeitet" ist `versatz` (groundOffset) plus `hangfolge`
 * (chanceToUseGroundTilt): Der Fels sinkt in den Boden und dreht sich in
 * die Hangnormale, statt senkrecht auf ihr zu stehen. Beides wertet
 * `shared/src/worldgen/streuung.ts` aus (Zeile 355 ff.).
 *
 * ── NACHGEMESSEN: der Ursprung liegt MITTIG, nicht am Fuss ───────────
 * Die naheliegende Einstellung wäre gewesen, jedem Fels einen negativen
 * `versatz` von 0,15 bis 1,5 m zu geben. Das wäre falsch gewesen, und
 * zwar unsichtbar falsch — die Modelle wären VERSCHWUNDEN.
 *
 * Gemessen an den Hüllboxen des Katalogs (`STORE_KATALOG`, Dateiraum
 * über `boundsNachWeltraum()`) liegt der Ursprung dieser Modelle in der
 * MITTE des Steins. Bei `versatz: 0` steckt ein Findling deshalb schon
 * von sich aus zur Hälfte im Boden:
 *
 *     rock-01          0,27 m hoch, min.y −0,13  → 50 % eingegraben
 *     rock-round-01    0,89 m hoch, min.y −0,44  → 50 %
 *     rock-chunk-03-1  3,11 m hoch, min.y −1,55  → 50 %
 *     rock-cliff-02-1 20,55 m hoch, min.y −3,38  → 16 %
 *
 * Ein `versatz: -0.2` an `rock-01` (0,27 m hoch) hätte den Stein
 * vollständig unter die Grasnarbe gezogen. Die Spalte trägt deshalb
 * überall dort eine 0, wo das Modell die Einarbeitung schon MITBRINGT,
 * und einen negativen Wert nur dort, wo sie fehlt — bei den grossen
 * Klippen (9–26 %) und bei `stone-01` (0 %, als einziges Modell mit
 * Ursprung am Fuss). Der gemessene Anteil steht hinter jeder Zeile.
 *
 * Zielband: 45–55 % bei Klein- und Mittelfels („halb eingegraben", wie
 * Referenzbild 1 es zeigt), 25–35 % bei den Klippen — eine 20-m-Klippe
 * zur Hälfte zu versenken hiesse, sie durch eine 10-m-Klippe zu
 * ersetzen.
 *
 * ── Was NICHT gestreut wird, und warum ───────────────────────────────
 *  • SECHS Modelle des Stores tragen `DefaultMaterial` OHNE Textur und
 *    ohne `baseColorFactor` — `rock-03`, `rock-chunk-03`, `rock-cliff-02`,
 *    `rock-cliff-03`, `rock-pebble-02`, `rubble-pebbles-03`. Sie sind
 *    nicht kaputt, sie sind die Rohfassung: Zu jedem gibt es ein
 *    Geschwister `-1`/`-2` mit identischer Geometrie (gleiche Hüllbox,
 *    gleiche Dreieckszahl) und der Textur
 *    `textures/sm-env-rock-03-1-0-2a217835.png`. Gestreut wird das
 *    texturierte Geschwister; die Rohfassung wäre ein weisser Stein in
 *    der Landschaft.
 *  • Aus demselben Grund steht von jeder Form nur EINE Fassung hier:
 *    `rock-04` und `rock-04-2`, `rock-chunk-01` und `-01-1`,
 *    `rock-cliff-05` und `-05-1` sind Zwillinge bis auf den
 *    MATERIALNAMEN — nachgemessen tragen sie dieselbe Texturdatei. Zwei
 *    Master für dasselbe Bild kosten und zeigen nichts.
 *  • `Umgebung/Schutt` (`rubble-pebbles-*`) bleibt draussen: flache
 *    Trümmerflecken von 16 bis 28 cm Höhe, und der eine ist rotbraun
 *    (gemessen RGB 129/87/78), der andere blaugrau (89/108/112). Das ist
 *    Dungeon-Schutt, kein Verwitterungsgestein.
 *  • `Requisiten/Wege` (`path-rock-*`), `Steinmauer`, `stone-throne`,
 *    `sm-env-house-rocks-large-01`: gesetzte Requisiten, keine
 *    Landschaft. Wer sie streute, streute Bauwerksteile in die Wildnis.
 *  • `stone-02-snow` — die Schneefassung von `stone-02` unterscheidet
 *    sich in der gemessenen Grundfarbe kaum von ihr (107/118/101 gegen
 *    111/124/102). Als eigene Art im Hohen Norden brächte sie ein Modell
 *    mehr und kein anderes Bild.
 *
 * ── Ein Prefab, ein Biom ─────────────────────────────────────────────
 * Dieselbe Regel wie in `storeFlora.ts`, aus demselben Grund:
 * `EIGENE_FLORA` entdoppelt nach Namen, der erste Eintrag gewinnt, und
 * ein zweiter Zahlensatz für dieselbe Art wäre wirkungslos, ohne dass
 * man das der Zeile ansieht. Die Bäume halten sich strikt daran.
 *
 * Der Fels kann es NICHT: Es gibt 22 brauchbare Modelle für fünf Biome,
 * und ein Grasland ohne Findling wäre die Alternative. Die Auflösung ist
 * dieselbe, die `flora.ts` für die Bäume nennt — die Zahlen des ERSTEN
 * Bündels gelten, und das ist hier immer das Grasland (`FELSEN_BUENDEL`
 * unten gibt die Reihenfolge vor). Die späteren Bündel steuern damit
 * ausschliesslich die KURATIERUNG: welche Art eine Region anbietet, nicht
 * wie dicht sie steht. Das steht hier, damit niemand an einer Zahl im
 * Hochnord-Bündel dreht und sich wundert, dass sich nichts ändert;
 * `tools/test/store-felsen.ts` hält es fest.
 *
 * Store rock scatter table — slope windows, ground offsets and tilt
 * following for the store's rock models.
 */

import type { FloraKurz } from './flora.js';

/**
 * Stehen die Store-Felsen in den Kuratierungslisten?
 *
 * `true` — die Welt trägt Fels. `false` stellt den Stand davor her, ohne
 * dass eine Zeile zurückgenommen werden müsste; die Streueinträge selbst
 * bleiben in beiden Stellungen in `EIGENE_FLORA` registriert, damit ein
 * im Editor von Hand gesetzter Findling und ein alter Spielstand ihn
 * behalten (dieselbe Trennung wie bei `STORE_FLORA_AKTIV`).
 *
 * Der Schalter ist der Rückweg für den Fall, dass die Felsen im Bild
 * oder in der Leistung nicht tragen — er ist NICHT der Schalter für die
 * Kollision. Die hängt am Prefab und nicht an der Kuratierung: Ein
 * gesetzter Findling muss auch dann ein Hindernis sein, wenn die
 * Streuung aus ist.
 */
export const STORE_FELSEN_AKTIV = true;

/**
 * ── Das Grasland — die Zahlen, die überall gelten ────────────────────
 *
 * Dieses Bündel ist die Referenz: Weil `EIGENE_FLORA` nach Namen
 * entdoppelt und das Grasland zuerst eingehängt wird, sind SEINE
 * Stückzahlen die der ganzen Welt (siehe Kopf). Die anderen Bündel
 * wählen aus, sie stellen nicht ein.
 *
 * ── Woher die Stückzahlen kommen ─────────────────────────────────────
 * Eine Zone ist 64 × 64 m = 4.096 m². `min`/`max` sind VERSUCHE je Zone,
 * nicht Treffer: Ein Kandidat ausserhalb seines Neigungsfensters fällt
 * weg, und beim Fels ist das der Normalfall — die Fenster sind eng, das
 * ist ihr Zweck. Gerechnet wurde deshalb rückwärts aus dem Zielabstand
 * und der am Referenzort gemessenen Hangverteilung; die tatsächlich
 * gesetzte Zahl je Klasse steht im Bericht und wurde am gestreuten Stand
 * nachgezählt, nicht geschätzt.
 *
 * Ziel laut Auftrag: auf der Wiese alle 30–50 m ein kleiner Fels
 * (900–2.500 m² je Stück, also 1,6–4,5 je Zone), am Steilhang alle
 * 10–20 m ein grosser.
 *
 * ── Reihenfolge ist Streu-Vorrecht ───────────────────────────────────
 * Der Durchlauf arbeitet die Tabelle von vorn nach hinten ab und prüft
 * jeden Kandidaten gegen die schon belegten Flächen. Gross zuerst: Sonst
 * besetzt der Kies die Fläche, und von den Klippen kommt keine mehr
 * durch — derselbe Befund, den `flora.ts` für den Nadelwald beschreibt
 * (mit den Setzlingen vorn kam von den Riesen kein einziger durch).
 */
export const STORE_GRASLAND_FELSEN: readonly FloraKurz[] = [
  // ── Klippen und grosse Blöcke: 25–55° ──────────────────────────────
  // Sie sind der eigentliche Auftrag. `hangfolge: 1` heisst, dass JEDE
  // Klippe der Hangnormale folgt — eine 20-m-Wand, die senkrecht auf
  // einem 45°-Hang steht, schwebt auf der Talseite meterhoch in der
  // Luft, und das ist der Fehler, den man auf dem Bild sofort sieht.
  //
  // `radius` ist bewusst KLEINER als der halbe Fussabdruck: Die
  // Klippenmeshes SOLLEN sich durchdringen, daraus entsteht der Grat.
  // Referenzbild 3 zeigt genau das — kein Feld einzeln stehender
  // Blöcke, sondern eine zusammenhängende Felsformation aus mehreren
  // ungleich skalierten und voll gedrehten Netzen.
  { name: 'environment-sm-env-rock-cliff-02-1', radius: 5.0, min: 0, max: 0.5, minTilt: 30, maxTilt: 55, wald: [false, 0, 5], scaleMin: 0.7, scaleMax: 1.4, versatz: -0.8, hangfolge: 1, gruppe: [9, 1, 3] }, // 11,5 × 20,6 × 12,4 m, 986 Dr., Einbau 16 % → 24 %
  { name: 'environment-sm-env-rock-cliff-01', radius: 4.0, min: 0, max: 0.5, minTilt: 30, maxTilt: 55, wald: [false, 0, 5], scaleMin: 0.7, scaleMax: 1.4, versatz: -0.6, hangfolge: 1, gruppe: [8, 1, 3] }, // 9,1 × 18,5 × 9,8 m, 968 Dr., 26 % → 32 %
  { name: 'environment-sm-env-rock-cliff-03-1', radius: 4.0, min: 0, max: 1, minTilt: 28, maxTilt: 55, wald: [false, 0, 5], scaleMin: 0.7, scaleMax: 1.4, versatz: -0.6, hangfolge: 1, gruppe: [8, 1, 3] }, // 9,9 × 13,8 × 9,0 m, 958 Dr., 23 % → 31 %
  // Die Zwischengrösse, und die einzige mit weitem Skalenband: 0,8–2,2
  // deckt 4,8 bis 13 m ab und schliesst damit die Lücke zwischen Block
  // (3,7 m) und Klippe (13,8 m). Bei den grossen Klippen wäre dasselbe
  // Band sinnlos — 20,6 m mal 2,2 sind 45 m, ein Berg, kein Fels.
  { name: 'environment-sm-env-rock-cliff-05', radius: 3.0, min: 0, max: 2, minTilt: 25, maxTilt: 55, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 2.2, versatz: -0.9, hangfolge: 1, gruppe: [7, 1, 3] }, // 6,3 × 5,9 × 6,4 m, 200 Dr., 9 % → 24 %
  { name: 'environment-sm-env-rock-chunk-03-1', radius: 2.2, min: 0, max: 2, minTilt: 25, maxTilt: 52, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.9, kippen: 6, gruppe: [6, 1, 3] }, // 3,7 × 3,1 × 3,3 m, 228 Dr., 50 % — bringt die Einarbeitung mit
  { name: 'environment-sm-env-rock-chunk-02', radius: 1.9, min: 0, max: 2, minTilt: 25, maxTilt: 52, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.9, kippen: 6, gruppe: [6, 1, 3] }, // 2,7 × 2,0 × 3,3 m, 152 Dr., 50 %

  // ── Mittelfels: 15–35°, der Hangfuss ───────────────────────────────
  // Hier steht der Übergang von Wiese zu Wand. Die Nadeln (`spike`)
  // stehen bewusst mit dabei: Sie sind das Einzige im Bestand mit
  // aufragender Silhouette, und ein Hang aus lauter liegenden Blöcken
  // liest sich als Geröllhalde.
  { name: 'environment-sm-env-rock-spike-03', radius: 1.2, min: 0, max: 1, minTilt: 15, maxTilt: 35, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: -0.15, hangfolge: 0.9, kippen: 5 }, // 1,0 × 2,2 × 1,1 m, 72 Dr., 35 % → 42 %
  { name: 'environment-sm-env-rock-chunk-01', radius: 1.4, min: 0, max: 3, minTilt: 15, maxTilt: 35, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0.10, hangfolge: 0.9, kippen: 5, gruppe: [5, 1, 2] }, // 1,7 × 1,3 × 1,9 m, 82 Dr., 55 %
  { name: 'environment-sm-env-rock-spike-01', radius: 0.9, min: 0, max: 2, minTilt: 15, maxTilt: 35, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.5, versatz: 0.20, hangfolge: 0.9, kippen: 5 }, // 0,7 × 1,8 × 0,6 m, 92 Dr., 50 %
  { name: 'environment-sm-env-rock-spike-02', radius: 0.9, min: 0, max: 2, minTilt: 15, maxTilt: 35, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.5, versatz: 0.30, hangfolge: 0.9, kippen: 5 }, // 0,7 × 1,7 × 0,6 m, 86 Dr., 57 % — der tiefste des Bestands
  { name: 'environment-sm-env-rock-spike-04', radius: 0.9, min: 0, max: 2, minTilt: 15, maxTilt: 35, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.5, versatz: 0.15, hangfolge: 0.9, kippen: 5, gruppe: [4, 1, 2] }, // 0,8 × 1,4 × 0,9 m, 92 Dr., 50 %
  { name: 'environment-sm-env-stone-02', radius: 1.0, min: 0, max: 2, minTilt: 12, maxTilt: 32, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.5, versatz: 0.05, hangfolge: 0.95, kippen: 4 }, // 1,3 × 0,3 × 1,3 m, 72 Dr., 50 % — flache Platte, folgt fast immer dem Hang

  // ── Kleinfels: 0–20°, die Wiese ────────────────────────────────────
  // Referenzbild 1. Einzeln, halb eingegraben, dunkel — Blickpunkt und
  // Wegmarke auf einer Fläche, die sonst nur Gras trägt.
  //
  // ACHTUNG bei den Stückzahlen: Wo eine `gruppe` steht, MULTIPLIZIERT
  // ihre Grösse die Zahl (dieselbe Warnung wie in `flora.ts`). Deshalb
  // stehen hier fast überall Einzelstücke; nur der Kies liegt in Nestern,
  // wie Kies das tut.
  { name: 'environment-sm-env-rock-round-01', radius: 0.9, min: 0, max: 0.5, minTilt: 0, maxTilt: 20, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.85, kippen: 7 }, // 0,80 × 0,89 × 0,85 m, 80 Dr., 50 %
  { name: 'environment-sm-env-rock-round-03', radius: 0.9, min: 0, max: 0.5, minTilt: 0, maxTilt: 20, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.85, kippen: 7 }, // 0,82 × 0,89 × 0,80 m, 92 Dr., 50 %
  { name: 'environment-sm-env-rock-round-04', radius: 0.9, min: 0, max: 0.5, minTilt: 0, maxTilt: 20, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.85, kippen: 7 }, // 0,84 × 0,89 × 0,92 m, 72 Dr., 50 %
  // Die einzige aufrechte Kleinform — und die einzige der Klasse, deren
  // Ursprung NICHT mittig sitzt (16 %). Ohne den Versatz stünde sie auf
  // der Wiese wie hingestellt.
  { name: 'environment-sm-env-rock-spike-05', radius: 0.7, min: 0, max: 0.4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.5, versatz: -0.18, hangfolge: 0.85, kippen: 7 }, // 0,79 × 0,94 × 0,84 m, 100 Dr., 16 % → 35 %
  { name: 'environment-sm-env-rock-04', radius: 0.5, min: 0, max: 0.4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.85, kippen: 8, gruppe: [3, 1, 2] }, // 0,63 × 0,28 × 0,40 m, 66 Dr., 50 %
  { name: 'environment-sm-env-rock-03-1', radius: 0.4, min: 0, max: 0.4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.85, kippen: 8, gruppe: [3, 1, 2] }, // 0,48 × 0,31 × 0,38 m, 46 Dr., 47 %
  // Der einzige Fels des Bestands mit Ursprung am FUSS. Ohne Versatz
  // läge er obenauf statt darin.
  { name: 'environment-sm-env-stone-01', radius: 0.5, min: 0, max: 0.4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: -0.06, hangfolge: 0.9, kippen: 5, gruppe: [3, 1, 2] }, // 0,56 × 0,20 × 0,52 m, 24 Dr., 0 % → 30 %
  { name: 'environment-sm-env-rock-01', radius: 0.35, min: 0, max: 0.3, minTilt: 0, maxTilt: 24, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.85, kippen: 9, gruppe: [2.5, 1, 2] }, // 0,33 × 0,27 × 0,35 m, 70 Dr., 50 %
  { name: 'environment-sm-env-rock-02', radius: 0.35, min: 0, max: 0.3, minTilt: 0, maxTilt: 24, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.85, kippen: 9, gruppe: [2.5, 1, 2] }, // 0,39 × 0,29 × 0,40 m, 64 Dr., 50 %
  { name: 'environment-sm-env-rock-pebble-02-1', radius: 0.3, min: 0, max: 0.3, minTilt: 0, maxTilt: 26, wald: [false, 0, 5], scaleMin: 0.8, scaleMax: 1.6, versatz: 0, hangfolge: 0.85, kippen: 10, gruppe: [2, 1, 4] }, // 0,32 × 0,21 × 0,32 m, 30 Dr., 50 %
];

/**
 * Der Nadelwald (Biom `blackforest`) — dieselben Steine, eine andere
 * Auswahl.
 *
 * Unter geschlossenem Kronendach ist der Fels das, was aus dem Laub
 * ragt: moosige Blöcke und Platten. Die aufragenden Nadeln bleiben
 * draussen — sie sind eine Form der offenen Landschaft, im Hochwald
 * stünden sie wie Grabsteine.
 *
 * Die Klippen bleiben drin. Ein Nadelwald hat Hänge wie jede andere
 * Insel, und ein Steilhang ohne Fels sieht auch unter Bäumen falsch aus.
 */
export const STORE_NADELWALD_FELSEN: readonly FloraKurz[] = [
  { name: 'environment-sm-env-rock-cliff-01', radius: 4.0, min: 0, max: 2, minTilt: 30, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-cliff-03-1', radius: 4.0, min: 1, max: 3, minTilt: 28, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-cliff-05', radius: 3.0, min: 1, max: 4, minTilt: 25, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-03-1', radius: 2.2, min: 1, max: 4, minTilt: 25, maxTilt: 52, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-02', radius: 1.9, min: 1, max: 4, minTilt: 25, maxTilt: 52, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-01', radius: 1.4, min: 2, max: 6, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-stone-02', radius: 1.0, min: 2, max: 6, minTilt: 12, maxTilt: 32, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-round-01', radius: 0.9, min: 1, max: 3, minTilt: 0, maxTilt: 20, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-round-03', radius: 0.9, min: 1, max: 3, minTilt: 0, maxTilt: 20, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-04', radius: 0.5, min: 1, max: 4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-03-1', radius: 0.4, min: 1, max: 4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-pebble-02-1', radius: 0.3, min: 1, max: 4, minTilt: 0, maxTilt: 26, wald: [false, 0, 5] },
];

/**
 * Der Sumpf — flach, nass, und deshalb fast ohne Fels.
 *
 * `STORE_SUMPF_FLORA` hält die Sumpfarten mit niedrigen `maxTilt`-Werten
 * im Flachen, damit der Bewuchs von selbst nachzeichnet, wo das Wasser
 * steht. Für den Fels gilt das Umgekehrte und Gleiche: Klippen gehören
 * nicht hierher — ein 20-m-Steilfels im Moor ist keine Landschaft,
 * sondern ein Fehler.
 *
 * Was bleibt, ist der FINDLING: ein einzelner grosser Block (3,7 m) im
 * Flachen, dazu kleine Steine. Damit trägt auch dieses Biom einen
 * grossen und einen kleinen Fels — die Regel aus `tools/test/
 * store-felsen.ts` gilt ohne Ausnahme, weil sie sich hier ohne Bruch
 * erfüllen lässt.
 */
export const STORE_SUMPF_FELSEN: readonly FloraKurz[] = [
  // Der Findling. `maxTilt: 12` ist derselbe Wert, den die grossen
  // Sumpfbäume tragen: Er hält ihn im Flachen, wo das Moor liegt.
  { name: 'environment-sm-env-rock-chunk-03-1', radius: 2.2, min: 0, max: 1, minTilt: 0, maxTilt: 12, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-01', radius: 1.4, min: 0, max: 2, minTilt: 0, maxTilt: 14, wald: [false, 0, 5] },
  { name: 'environment-sm-env-stone-02', radius: 1.0, min: 1, max: 3, minTilt: 0, maxTilt: 16, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-round-01', radius: 0.9, min: 1, max: 3, minTilt: 0, maxTilt: 16, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-02', radius: 0.35, min: 1, max: 4, minTilt: 0, maxTilt: 18, wald: [false, 0, 5] },
];

/**
 * Der Hohe Norden (Biom `deepnorth`) — hier trägt der Fels die
 * Landschaft.
 *
 * `STORE_HOCHNORD_FLORA` beschreibt die Rolle des Bioms als WEITE: Man
 * sieht über das Land hinweg, und ein einzelner Baum ist von weit her
 * eine Wegmarke. Genau deshalb ist dies das Biom mit dem VOLLSTÄNDIGEN
 * Felsbestand und den höchsten Stückzahlen — auf einer Fläche fast ohne
 * Bewuchs ist der Fels das Einzige, woran das Auge Entfernung misst.
 * `flora.ts` sagt denselben Satz über den alten Bestand („Dazu Fels, und
 * der trägt hier mehr als Dekoration").
 *
 * Die Stückzahlen hier sind Kuratierung, nicht Dichte: Es gilt der
 * Zahlensatz des Graslands (siehe Kopf). Was dieses Bündel steuert, ist
 * die VOLLSTÄNDIGKEIT der Auswahl — jede Form des Bestands darf hier
 * vorkommen.
 */
export const STORE_HOCHNORD_FELSEN: readonly FloraKurz[] = [
  { name: 'environment-sm-env-rock-cliff-02-1', radius: 5.0, min: 0, max: 2, minTilt: 30, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-cliff-01', radius: 4.0, min: 0, max: 2, minTilt: 30, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-cliff-03-1', radius: 4.0, min: 1, max: 3, minTilt: 28, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-cliff-05', radius: 3.0, min: 1, max: 4, minTilt: 25, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-03-1', radius: 2.2, min: 1, max: 4, minTilt: 25, maxTilt: 52, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-02', radius: 1.9, min: 1, max: 4, minTilt: 25, maxTilt: 52, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-03', radius: 1.2, min: 1, max: 4, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-01', radius: 1.4, min: 2, max: 6, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-01', radius: 0.9, min: 1, max: 5, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-02', radius: 0.9, min: 1, max: 5, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-04', radius: 0.9, min: 2, max: 6, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-stone-02', radius: 1.0, min: 2, max: 6, minTilt: 12, maxTilt: 32, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-round-01', radius: 0.9, min: 1, max: 3, minTilt: 0, maxTilt: 20, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-round-03', radius: 0.9, min: 1, max: 3, minTilt: 0, maxTilt: 20, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-round-04', radius: 0.9, min: 1, max: 3, minTilt: 0, maxTilt: 20, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-05', radius: 0.7, min: 1, max: 3, minTilt: 0, maxTilt: 22, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-04', radius: 0.5, min: 1, max: 4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5] },
  { name: 'environment-sm-env-stone-01', radius: 0.5, min: 1, max: 4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-01', radius: 0.35, min: 1, max: 4, minTilt: 0, maxTilt: 24, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-pebble-02-1', radius: 0.3, min: 1, max: 4, minTilt: 0, maxTilt: 26, wald: [false, 0, 5] },
];

/**
 * Die Aschewüste (Biom `ashlands`) — kantig, nicht rund.
 *
 * `STORE_ASCHE_FLORA` nimmt aus dem Store nur, was NICHT grün ist, und
 * begründet die Auswahl an der gemessenen Materialrolle statt am Namen.
 * Für den Fels ist die Frage eine andere, aber sie wird genauso
 * beantwortet: Der Bestand ist durchweg neutralgrau (gemessen 101–130
 * über alle Kanäle, kein Farbstich), und grauer Stein auf Schlacke ist
 * kein Widerspruch — Basalt IST grau.
 *
 * Was fehlt, ist nicht die Farbe, sondern die FORM. Die runden Modelle
 * (`rock-round-*`, `rock-pebble-*`, `stone-*`) sind wassergeschliffen;
 * das ist die Geschichte eines Bachbetts, und die hat eine Aschewüste
 * nicht. Hier stehen deshalb nur die kantigen: Klippen, Blöcke und
 * Nadeln — Bruchgestein.
 *
 * Wer das ändern will, ändert die TEXTUR (verkohlt statt grau), nicht
 * diese Liste — dasselbe Wort, das `storeFlora.ts` über die Stämme
 * schreibt.
 */
export const STORE_ASCHE_FELSEN: readonly FloraKurz[] = [
  { name: 'environment-sm-env-rock-cliff-02-1', radius: 5.0, min: 0, max: 2, minTilt: 30, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-cliff-03-1', radius: 4.0, min: 1, max: 3, minTilt: 28, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-cliff-05', radius: 3.0, min: 1, max: 4, minTilt: 25, maxTilt: 55, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-03-1', radius: 2.2, min: 1, max: 4, minTilt: 25, maxTilt: 52, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-02', radius: 1.9, min: 1, max: 4, minTilt: 25, maxTilt: 52, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-03', radius: 1.2, min: 1, max: 4, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-chunk-01', radius: 1.4, min: 2, max: 6, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-01', radius: 0.9, min: 1, max: 5, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-02', radius: 0.9, min: 1, max: 5, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-04', radius: 0.9, min: 2, max: 6, minTilt: 15, maxTilt: 35, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-spike-05', radius: 0.7, min: 1, max: 3, minTilt: 0, maxTilt: 22, wald: [false, 0, 5] },
  { name: 'environment-sm-env-rock-03-1', radius: 0.4, min: 1, max: 4, minTilt: 0, maxTilt: 22, wald: [false, 0, 5] },
];

/**
 * Alle fünf Bündel in der Reihenfolge, in der `flora.ts` sie einhängt.
 *
 * Für die Prüfer: Sie fragen diese Liste, nicht die Einzelnamen — ein
 * neues Bündel, das hier fehlt, wird sonst von keinem Test gesehen
 * (dieselbe Vorkehrung wie `STORE_FLORA_BUENDEL`).
 *
 * Die Reihenfolge ist zugleich die Vorrangregel der Zahlen: Grasland
 * steht vorn, also gelten seine Stückzahlen (siehe Kopf).
 */
export const STORE_FELSEN_BUENDEL: readonly (readonly [string, readonly FloraKurz[]])[] = [
  ['grasland', STORE_GRASLAND_FELSEN],
  ['nadelwald', STORE_NADELWALD_FELSEN],
  ['sumpf', STORE_SUMPF_FELSEN],
  ['hochnord', STORE_HOCHNORD_FELSEN],
  ['asche', STORE_ASCHE_FELSEN],
];

/**
 * Jeder Felsname genau einmal — für den Client.
 *
 * `EntityManager` fragt sie, um einem Store-Fels die EXAKTE
 * Oberflächenkollision statt eines Hüllquaders zu geben (Begründung dort
 * bei `FELS_KOLLISION`). Eine Menge und keine Regel über den Namen: Was
 * ein Fels ist, steht in dieser Datei und nirgends sonst — ein zweites
 * Namensmuster im Client liefe beim ersten neuen Modell auseinander.
 *
 * Sie steht bewusst hier und nicht in `storeKatalogDaten.ts`: Der
 * Katalog ist absichtlich NICHT im Spiel-Bündel (siehe `index.ts`), und
 * eine Kollisionsentscheidung darf ihn nicht hereinziehen.
 */
export const STORE_FELSEN_NAMEN: ReadonlySet<string> = new Set(
  STORE_FELSEN_BUENDEL.flatMap(([, liste]) => liste.map((f) => f.name))
);
