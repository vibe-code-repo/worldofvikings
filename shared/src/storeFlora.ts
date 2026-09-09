/**
 * Store-Flora — die Streutabelle für die 94 Vegetations-Prefabs aus
 * `assets/store/vegetation/`.
 *
 * `flora.ts` ist die Streutabelle der EIGENEN Modelle und bleibt es. Diese
 * Datei ist ihr Gegenstück für den Store-Bestand: dieselbe Bauart
 * (`FloraKurz`), dieselben Regeln, nur andere Arten und andere Zahlen.
 * `flora.ts` importiert sie und hängt sie in die Biom-Listen ein; die
 * Umrechnung nach `Foliage` bleibt dort, weil dort auch `BASIS` und
 * `ALLE_BIOME` stehen und zwei Umrechner unweigerlich auseinanderliefen.
 *
 * ── Der Schalter ─────────────────────────────────────────────────────
 * `STORE_FLORA_AKTIV` entscheidet, welcher Bestand in den
 * `*_FLORA_NAMEN`-Listen steht — also, was eine kuratierte Region
 * tatsächlich anbietet. Beide Bestände bleiben in `EIGENE_FLORA`
 * REGISTRIERT: Wer im Editor eine Birke von Hand setzt, soll sie weiter
 * setzen können, und ein alter Spielstand soll seine Bäume behalten.
 * Umgeschaltet wird nur die Kuratierung.
 *
 * Der Schalter existiert, damit Stufe 0 reproduzierbar bleibt: `false`
 * stellt den Stand vor dem Store-Import her, ohne dass eine Zeile
 * zurückgenommen werden müsste.
 *
 * ── Warum eine zweite Bedingung nötig ist ────────────────────────────
 * Ein Streueintrag ohne PrefabDef streut nichts — `findPrefabByHash()`
 * findet den Hash nicht, und die Region bleibt KAHL. Genau lautlos, genau
 * die Fehlerart, gegen die der Kopf von `flora.ts` und
 * `server/test/h4-graslandflora.ts` stehen.
 *
 * Die PrefabDefs für den Store erzeugt `tools/store-prefabs.mjs` nach
 * `shared/src/storePrefabs.ts` und trägt ihre Namen in `EIGENE_MODELLE`
 * ein. Solange das nicht geschehen ist, wäre ein Umschalten ein
 * Weltuntergang mit grünem Testlauf. Deshalb prüft `flora.ts` vor dem
 * Umschalten `EIGENE_MODELLE_SET` und meldet das Ergebnis als
 * `STORE_FLORA_BEREIT` — sichtbar, nicht still.
 *
 * ── Woher die Zahlen kommen ──────────────────────────────────────────
 * `radius` ist aus den `bounds` in `assets/store/prefabs.json` gerechnet,
 * nicht geschätzt: Kronenradius r = max(|min.x|, |max.x|, |min.z|,
 * |max.z|), daraus der Mindestabstand als rund 0,6 · r bei Bäumen und
 * rund 0,9 · r bei Büschen und Gras. Der Faktor ist derselbe, den die
 * eigenen Bäume in `flora.ts` tragen (Eiche1: 12 m Krone, radius 8) — die
 * Kronen sollen sich BERÜHREN, ein überlappungsfreier Bestand wäre ein
 * Park. Der gemessene Wert steht als Kommentar hinter jeder Zeile, damit
 * die Rechnung nachprüfbar bleibt.
 *
 * Die Stückzahlen folgen den Richtwerten aus dem Kopf von `flora.ts`
 * (Bäume rund 5 je Zone und Art, Sträucher 60–80 je Zone insgesamt, Gras
 * deutlich mehr) und der dortigen Staffelung: je grösser der Baum, desto
 * weniger und desto weiter auseinander. Die Waldfenster sind
 * unverändert übernommen — Bäume 0…1,15, Sträucher 0,9…1,3, offene
 * Bodenpflanzen ohne Waldbedingung.
 *
 * ── Was NICHT gestreut wird, und warum ───────────────────────────────
 *  • Die sechs `-lod-1`-Modelle. Sie sind die LOD-Stufe ihrer
 *    Geschwister, dieselbe Silhouette mit weniger Dreiecken. Als eigene
 *    Art gestreut stünde neben jedem Baum sein eigenes Fernbild.
 *  • Ein paar kahle Nebenstämme (`vegetation-tree-1b2-1`,
 *    `-tree-1e2-1`, `-tree-1a3` ist belaubt und steht drin): kein
 *    Ausschluss aus Prinzip, sie haben nur kein Biom, in dem sie etwas
 *    beitrügen, das ihre Geschwister nicht schon beitragen. Wer sie will,
 *    trägt sie unten ein — ohne Streueintrag wird nie gestreut.
 *
 * ── Ein Prefab, ein Biom ─────────────────────────────────────────────
 * `EIGENE_FLORA` entdoppelt nach Namen, und der erste Eintrag gewinnt.
 * Damit die Zahlen hier auch wirklich greifen, ist der Bestand STRIKT
 * aufgeteilt: Jedes der 94 Modelle kommt in höchstens einer der fünf
 * Listen vor. Das ist keine technische Notwendigkeit (der Vorbildbestand
 * führt Arten mehrfach), sondern eine Lesbarkeitsentscheidung — bei
 * doppelter Nennung stünden zwei Zahlensätze da, von denen der zweite
 * wirkungslos ist, und das fällt beim Lesen nicht auf.
 */

import type { FloraKurz } from './flora.js';
import { STORE_GRAS_AKTIV } from './storeKatalog.js';

/**
 * Die vier Grasbüschel — die einzigen Einträge dieser Datei, die ein
 * SCHALTER ein- und ausbaut.
 *
 * Seit Stufe 2 zeichnet der Gras-Clutter sie als Thin Instances
 * (`client/src/engine/GrassClutter.ts`, Tabelle `STORE_GRAS_MODELLE`).
 * Zweimal dasselbe Büschel an derselben Stelle sähe man nicht, es
 * kostete nur — und die Prefab-Streuung ist die teure Hälfte: 12.024
 * Instanzen `-clump-1` und 2.311 `-redblue` allein am Referenzort
 * (gemessen 09.09.2026).
 *
 * Die Zeilen bleiben trotzdem STEHEN und werden nicht gelöscht: Sie sind
 * die andere Hälfte des Rückfalls. Mit `STORE_GRAS_AKTIV = false`
 * zeichnet der Clutter wieder seine Altbestands-Karten, und dann muss
 * die Streuung die Büschel wieder liefern — sonst wäre „aus" nicht der
 * Zustand davor, sondern ein dritter.
 */
const GRAS_BUESCHEL_WIESE: readonly FloraKurz[] = [
  { name: 'vegetation-grass-short-clump-1', radius: 0.5, min: 18, max: 44, maxTilt: 32, wald: [false, 0.0, 5], gruppe: [4, 3, 7], kippen: 6, scaleMin: 0.8, scaleMax: 1.4 }, // 0,2 m, r 0,6
  { name: 'vegetation-grass-short-clump-redblue', radius: 0.7, min: 6, max: 16, maxTilt: 28, wald: [false, 1.1, 5], gruppe: [5, 2, 5], kippen: 6 }, // 0,2 m, r 0,6
];

/** Dasselbe für den Hohen Norden — Schneegras und Trockengras. */
const GRAS_BUESCHEL_HOCHNORD: readonly FloraKurz[] = [
  { name: 'vegetation-grass-short-clump-snow', radius: 0.7, min: 4, max: 12, maxTilt: 35, wald: [false, 0.0, 5], gruppe: [5, 2, 4], kippen: 6, scaleMin: 0.8, scaleMax: 1.3 }, // 0,2 m
  { name: 'vegetation-grass-short-clump-yellow', radius: 0.8, min: 3, max: 9, maxTilt: 38, wald: [false, 0.0, 5], gruppe: [5, 1, 4], kippen: 7, scaleMin: 0.8, scaleMax: 1.3 }, // 0,2 m, Trockengras
];

/**
 * Die Büschel, sofern der Clutter sie NICHT schon zeichnet — leer bei
 * `STORE_GRAS_AKTIV = true`.
 *
 * Eine Funktion und kein `if` an den fünf Streulisten: Der Schalter wird
 * an EINER Stelle gelesen, und die Listen bleiben Tabellen.
 */
const buescheln = (liste: readonly FloraKurz[]): readonly FloraKurz[] =>
  STORE_GRAS_AKTIV ? [] : liste;

/**
 * Steht die Store-Vegetation in den Kuratierungslisten?
 *
 * `true` — der Store-Bestand ist der Bewuchs der Welt. `false` stellt den
 * Stand vor dem Import her (die alten eigenen Bäume und Büsche). Beide
 * Bestände bleiben in beiden Stellungen in `EIGENE_FLORA` registriert.
 */
export const STORE_FLORA_AKTIV = true;

/**
 * Das Grasland — Wiese mit Laubwaldinseln.
 *
 * Der Store liefert dafür fünf Baumfamilien (`tree-1a…1e`), die
 * `branched-tree`-Paare, den Jungwuchs (`small-thin-tree`) und zwei
 * Strauchgrössen. Die Reihenfolge ist Streu-Vorrecht: gross vor klein,
 * sonst besetzt der Jungwuchs die Fläche und von den Solitären kommt
 * keiner mehr durch (nachgewiesen im Nadelwald-Abschnitt von `flora.ts`).
 */
export const STORE_GRASLAND_FLORA: readonly FloraKurz[] = [
  // ── Solitäre (17–25 m) ─────────────────────────────────────────────
  // Sie sind das Grössenmass der Insel und stehen einzeln: `min: 0`
  // heisst, in den meisten Zonen steht keiner.
  { name: 'vegetation-tree-1a3', radius: 8.0, min: 0, max: 2, maxTilt: 18, wald: [true, 0.9, 1.35] }, // 25,4 m, Krone r 8,3
  { name: 'vegetation-tree-1b3', radius: 7.0, min: 0, max: 2, maxTilt: 20, wald: [true, 0.9, 1.35] }, // 23,0 m, r 8,0
  { name: 'vegetation-tree-1e1', radius: 7.0, min: 0, max: 2, maxTilt: 20, wald: [true, 0.95, 1.4] }, // 16,8 m, r 8,3 — Ahorn
  { name: 'vegetation-tree-1e2', radius: 6.0, min: 0, max: 3, maxTilt: 20, wald: [true, 0.95, 1.4] }, // 16,7 m, r 7,0 — Ahorn
  { name: 'vegetation-tree-1b2', radius: 5.0, min: 1, max: 3, maxTilt: 22, wald: [true, 0.0, 1.25] }, // 16,7 m, r 5,9
  { name: 'vegetation-branched-tree-2a3', radius: 5.0, min: 0, max: 3, maxTilt: 22, wald: [true, 0.0, 1.2] }, // 16,6 m, r 6,0
  { name: 'vegetation-branched-tree-2a1', radius: 5.0, min: 1, max: 3, maxTilt: 24, wald: [true, 0.0, 1.2] }, // 13,5 m, r 6,4

  // ── Hauptbestand (9–12 m) ──────────────────────────────────────────
  // Er trägt den Hain. Gruppen, kleiner Radius: Die Kronen sollen sich
  // berühren.
  { name: 'vegetation-tree-1c3', radius: 4.4, min: 1, max: 4, maxTilt: 24, wald: [true, 0.0, 1.15], gruppe: [14, 2, 4] }, // 11,4 m, r 6,2
  { name: 'vegetation-tree-1b1', radius: 3.4, min: 3, max: 8, maxTilt: 26, wald: [true, 0.0, 1.15], gruppe: [12, 2, 5] }, // 11,1 m, r 3,9
  { name: 'vegetation-tree-1d2', radius: 3.8, min: 2, max: 6, maxTilt: 26, wald: [true, 0.0, 1.15], gruppe: [12, 2, 4] }, // 11,0 m, r 4,5
  { name: 'vegetation-tree-1d1', radius: 4.0, min: 2, max: 6, maxTilt: 26, wald: [true, 0.0, 1.15], gruppe: [12, 2, 4] }, // 10,9 m, r 4,9
  { name: 'vegetation-tree-1c2', radius: 3.8, min: 2, max: 6, maxTilt: 28, wald: [true, 0.0, 1.2], gruppe: [12, 2, 5] }, // 9,4 m, r 4,8
  { name: 'vegetation-tree-1c1', radius: 3.0, min: 3, max: 8, maxTilt: 28, wald: [true, 0.0, 1.2], gruppe: [10, 2, 5] }, // 8,3 m, r 3,6

  // ── Jungwuchs (8–11 m, dünnstämmig) ────────────────────────────────
  // Zuletzt unter den Bäumen, weil er in jede Lücke passt — und bis an
  // den Waldrand (Fenster bis 1,3), damit der Hain nach aussen ausfranst.
  { name: 'vegetation-small-thin-tree-1a3', radius: 2.6, min: 3, max: 9, maxTilt: 30, wald: [true, 0.0, 1.3], gruppe: [10, 2, 5] }, // 11,2 m, r 4,1
  { name: 'vegetation-small-thin-tree-1a5', radius: 2.6, min: 3, max: 9, maxTilt: 30, wald: [true, 0.0, 1.3], gruppe: [10, 2, 5] }, // 10,4 m, r 4,0
  { name: 'vegetation-small-thin-tree-1a2', radius: 1.8, min: 4, max: 12, maxTilt: 32, wald: [true, 0.0, 1.35], gruppe: [8, 2, 6] }, // 8,1 m, r 2,6

  // ── Grosssträucher am Waldrand (2,5–4,4 m) ─────────────────────────
  // Bewusst SELTEN: Ein `large-bush` kostet 6 500 bis 10 900 Dreiecke —
  // mehr als mancher Baum. Er ist ein Blickpunkt am Waldrand, kein
  // Bodendecker; das Fenster 0,9…1,3 setzt ihn genau dorthin.
  { name: 'vegetation-large-bush-1a5', radius: 1.8, min: 1, max: 3, maxTilt: 32, wald: [true, 0.9, 1.3] }, // 4,4 m, r 1,8
  { name: 'vegetation-large-bush-1a4', radius: 1.7, min: 1, max: 3, maxTilt: 32, wald: [true, 0.9, 1.3] }, // 4,4 m, r 1,7
  { name: 'vegetation-large-bush-1a1', radius: 1.5, min: 1, max: 3, maxTilt: 35, wald: [true, 0.9, 1.3] }, // 3,6 m, r 1,5
  { name: 'vegetation-large-bush-1a2', radius: 1.2, min: 1, max: 4, maxTilt: 35, wald: [true, 0.9, 1.3] }, // 3,6 m, r 1,2
  { name: 'vegetation-large-bush-1a3', radius: 1.4, min: 2, max: 5, maxTilt: 38, wald: [true, 0.9, 1.35] }, // 2,5 m, r 1,4

  // ── Gebüsch (1,3–2,1 m) ────────────────────────────────────────────
  // Die Richtwerte aus `flora.ts` nennen 60–80 Büsche je Zone. Hier
  // summieren sich min 26 / max 74 — die Mitte liegt im Fenster, und
  // mehr als `max` erlaubt der Mindestabstand ohnehin nicht.
  // Diese sind billig (624–810 Dreiecke) und dürfen deshalb tragen.
  { name: 'vegetation-bush-1a1-small', radius: 0.9, min: 6, max: 16, maxTilt: 40, wald: [false, 0.9, 1.8], gruppe: [6, 2, 6], kippen: 5 }, // 1,3 m, r 1,1
  { name: 'vegetation-bush-1a1', radius: 1.0, min: 5, max: 14, maxTilt: 40, wald: [false, 0.9, 1.8], gruppe: [6, 2, 6], kippen: 5 }, // 1,3 m, r 1,1
  { name: 'vegetation-bush-1a2', radius: 1.4, min: 4, max: 12, maxTilt: 38, wald: [true, 0.9, 1.3], gruppe: [8, 2, 5], kippen: 4 }, // 2,0 m, r 1,6
  { name: 'vegetation-bush-1a3', radius: 1.5, min: 3, max: 10, maxTilt: 38, wald: [true, 0.9, 1.3], gruppe: [8, 2, 4], kippen: 4 }, // 2,1 m, r 1,8

  // ── Grasbüschel ────────────────────────────────────────────────────
  // Zehn Dreiecke je Büschel — das billigste Modell des ganzen Bestands.
  // Seit Stufe 2 zeichnet sie trotzdem nicht die Streuung, sondern der
  // Gras-Clutter (Thin Instances, gemeinsame Keulung): Die Zeilen stehen
  // in `GRAS_BUESCHEL_WIESE` oben und kommen nur bei
  // `STORE_GRAS_AKTIV = false` hierher zurück. Die bunte Variante ist der
  // Blumen-Ersatz (Atlas 0,350/0,447/0,186 — der einzige
  // Vegetationsatlas des Stores mit echter Buntheit).
  ...buescheln(GRAS_BUESCHEL_WIESE),

  // ── Fallholz ───────────────────────────────────────────────────────
  // Abgebrochene, noch belaubte Äste — sie liegen dort, wo der Wald
  // steht, und geben dem Boden das, was ein reiner Grasteppich nicht
  // hat: eine Störung.
  { name: 'vegetation-branch-1a1', radius: 2.4, min: 0, max: 3, maxTilt: 30, wald: [true, 0.0, 1.2], kippen: 8 }, // 4,1 m, r 3,2
  { name: 'vegetation-branch-1a9', radius: 2.2, min: 0, max: 3, maxTilt: 32, wald: [true, 0.0, 1.2], kippen: 8 }, // 4,1 m, r 3,0
];

/**
 * Der Nadelwald (Biom `blackforest`) — Kiefernhochwald mit Riesen.
 *
 * Dieselbe Staffelung wie in `flora.ts`: Das Waldfenster ist je Schicht
 * enger, je grösser der Baum. Die Riesen (`pine-1b3/1b5`, 33–35 m) stehen
 * nur im Kern, der Hauptbestand reicht weiter, der Jungwuchs bis an den
 * Rand. Dazu die `massive-` und `split-tree`-Familien als Laubholz-
 * einsprengsel — ein reiner Kiefernforst wirkt gepflanzt.
 */
export const STORE_NADELWALD_FLORA: readonly FloraKurz[] = [
  // ── Schicht 1: Oberschicht (23–35 m) ───────────────────────────────
  // ZUERST, und das ist der Kern des Ganzen (siehe `flora.ts`: mit den
  // Setzlingen vorn kam von den Riesen kein einziger durch).
  { name: 'vegetation-pine-1b5', radius: 7.0, min: 1, max: 3, maxTilt: 24, wald: [true, 0.0, 0.9], gruppe: [18, 1, 2] }, // 34,9 m, Krone r 8,6
  { name: 'vegetation-pine-1b3', radius: 6.0, min: 1, max: 4, maxTilt: 26, wald: [true, 0.0, 0.95], gruppe: [16, 1, 3] }, // 33,5 m, r 7,0
  { name: 'vegetation-massive-tree-1a3', radius: 8.0, min: 0, max: 2, maxTilt: 22, wald: [true, 0.0, 0.9] }, // 28,9 m, r 12,3 — der grösste Baum des Bestands
  { name: 'vegetation-pine-1b2', radius: 5.0, min: 2, max: 6, maxTilt: 26, wald: [true, 0.0, 1.05], gruppe: [14, 2, 4] }, // 26,3 m, r 6,2
  { name: 'vegetation-pine-1b4', radius: 4.6, min: 3, max: 10, maxTilt: 28, wald: [true, 0.0, 1.1], gruppe: [14, 2, 5] }, // 23,8 m, r 5,9

  // ── Schicht 2: Hauptbestand (14–19 m) ──────────────────────────────
  { name: 'vegetation-massive-tree-1a2', radius: 5.4, min: 1, max: 3, maxTilt: 24, wald: [true, 0.0, 1.1] }, // 18,7 m, r 7,6
  { name: 'vegetation-split-tree-1a3', radius: 5.4, min: 1, max: 4, maxTilt: 26, wald: [true, 0.0, 1.15], gruppe: [14, 1, 3] }, // 15,2 m, r 8,8
  { name: 'vegetation-pine-1b1', radius: 3.0, min: 10, max: 26, maxTilt: 30, wald: [true, 0.0, 1.25], gruppe: [12, 2, 6] }, // 15,6 m, r 3,6
  { name: 'vegetation-massive-tree-1a1', radius: 4.2, min: 1, max: 4, maxTilt: 26, wald: [true, 0.0, 1.2] }, // 14,0 m, r 6,0

  // ── Schicht 3: Unterschicht (7–10 m) ───────────────────────────────
  // Sie macht den Bestand nach unten dicht — ohne sie sieht man unter den
  // Kronen hindurch bis zum Horizont.
  //
  // NACHGEMESSEN bei der Zusammenführung (08.09.2026): Mit den zuerst
  // eingetragenen Zahlen trug der Nadelwald 1.802 Stämme und das
  // Grasland 2.233 — der dichte Typ war der dünnere, weil das Grasland
  // seinen Jungwuchs (`small-thin-tree`, 8–11 m) grosszügig streut und
  // der als Baum zählt. `server/test/h4-graslandflora.ts` hält dagegen:
  // Der Nadelwald muss mehr Bäume tragen als das Grasland, sonst ist die
  // Unterscheidung nur ein anderer Name. Angehoben wurden deshalb die
  // Stückzahlen der BILLIGEN Unterschicht (`pine-1b1`, `split-tree-1a1`,
  // `split-tree-1a2`) und die von `pine-1b4` — nicht die der Riesen, die
  // kosten je Stück ein Vielfaches. Ergebnis: 2.371 gegen 2.233.
  { name: 'vegetation-split-tree-1a2', radius: 3.6, min: 6, max: 14, maxTilt: 30, wald: [true, 0.0, 1.35], gruppe: [12, 2, 5] }, // 9,3 m, r 5,9
  { name: 'vegetation-split-tree-1a1', radius: 2.6, min: 10, max: 22, maxTilt: 32, wald: [true, 0.0, 1.4], gruppe: [10, 2, 6] }, // 7,6 m, r 4,2

  // ── Schicht 4: Totholz ─────────────────────────────────────────────
  // Kahle Kiefernstämme, 13–23 m, 80 Dreiecke. Sie kosten nichts und sind
  // das Einzige, was einen Hochwald nicht wie eine Plantage aussehen
  // lässt.
  { name: 'vegetation-pine-1b2-1', radius: 2.0, min: 0, max: 2, maxTilt: 30, wald: [true, 0.0, 1.3] }, // 23,0 m, kahl
  { name: 'vegetation-pine-1b4-1', radius: 1.8, min: 0, max: 3, maxTilt: 32, wald: [true, 0.0, 1.35] }, // 20,3 m, kahl
  { name: 'vegetation-pine-1b1-1', radius: 1.2, min: 1, max: 4, maxTilt: 35, wald: [true, 0.0, 1.4] }, // 13,6 m, kahl

  // ── Schicht 5: Strauch- und Bodenschicht ───────────────────────────
  // Unter geschlossenem Kronendach wachsen keine Wiesenblumen. Es bleibt
  // der dunkle Busch — die einzige Variante des Bestands mit eigener
  // dunkler Tönung (0,40/0,78/0,18 statt 0,46/0,95/0,20) — und der Pilz.
  { name: 'vegetation-bush-1a2-small-1-dark', radius: 1.4, min: 5, max: 14, maxTilt: 38, wald: [true, 0.0, 1.4], gruppe: [8, 2, 5], kippen: 4 }, // 2,0 m, r 1,6
  { name: 'vegetation-branch-1a7', radius: 2.0, min: 1, max: 4, maxTilt: 32, wald: [true, 0.0, 1.3], kippen: 8 }, // 4,3 m, Fallholz
  { name: 'vegetation-branch-1a5', radius: 2.4, min: 0, max: 3, maxTilt: 32, wald: [true, 0.0, 1.3], kippen: 8 }, // 2,8 m, Fallholz
  { name: 'vegetation-sm-plant-mushrooms-02', radius: 0.4, min: 4, max: 12, maxTilt: 35, wald: [true, 0.0, 1.4], gruppe: [4, 2, 6], kippen: 10 }, // 0,3 m, r 0,3
];

/**
 * Der Sumpf — nass, schattig, niedrig.
 *
 * Der Store hat kein Sumpfgewächs. Was er hat, sind die
 * `-1-dark`-Varianten: dieselbe Geometrie wie die hellen Geschwister, aber
 * mit dem dunklen Laubfaktor — und genau das ist der Unterschied zwischen
 * einem Wald und einem Moorwald. Dazu die kahlen Stämme, die im
 * Stehwasser übrig bleiben.
 *
 * Die niedrigen `maxTilt`-Werte sind Absicht und tragen mehr als sie
 * aussehen (dieselbe Überlegung wie in `flora.ts`): Sumpfarten wachsen
 * nur im FLACHEN. Damit bleiben die Hänge einer Sumpfinsel frei, und der
 * Bewuchs zeichnet von selbst nach, wo das Wasser steht.
 */
export const STORE_SUMPF_FLORA: readonly FloraKurz[] = [
  // ── Baumschicht: die dunklen Varianten ─────────────────────────────
  { name: 'vegetation-massive-tree-1a2-1-dark', radius: 5.4, min: 0, max: 2, maxTilt: 14, wald: [true, 0.0, 1.35] }, // 18,7 m, r 7,6
  { name: 'vegetation-split-tree-1a3-1-dark', radius: 5.4, min: 0, max: 3, maxTilt: 16, wald: [true, 0.0, 1.4], gruppe: [14, 1, 3] }, // 15,2 m, r 8,8
  { name: 'vegetation-massive-tree-1a1-1-dark', radius: 4.2, min: 1, max: 3, maxTilt: 16, wald: [true, 0.0, 1.4] }, // 14,0 m, r 6,0
  { name: 'vegetation-split-tree-1a2-1-dark', radius: 3.6, min: 2, max: 6, maxTilt: 18, wald: [true, 0.0, 1.45], gruppe: [12, 2, 5] }, // 9,3 m, r 5,9
  { name: 'vegetation-split-tree-1a1-1-dark', radius: 2.6, min: 3, max: 9, maxTilt: 20, wald: [true, 0.0, 1.5], gruppe: [10, 2, 6] }, // 7,6 m, r 4,2
  // Der grösste dunkle Baum steht bewusst hinten und selten: 23 296
  // Dreiecke sind das Teuerste, was der Bestand hat.
  { name: 'vegetation-massive-tree-1a3-1-dark', radius: 8.0, min: 0, max: 1, maxTilt: 12, wald: [true, 0.0, 1.2] }, // 28,9 m, r 12,3

  // ── Totholz im Stehwasser ──────────────────────────────────────────
  // Kahle Stämme, 10–25 m, 16 bis 1 445 Dreiecke. Sie sind das Bild des
  // Moors: was einmal Wald war und im Wasser stehen geblieben ist.
  { name: 'vegetation-tree-1a3-1', radius: 3.0, min: 0, max: 2, maxTilt: 12, wald: [false, 0.0, 5] }, // 24,5 m, kahl
  { name: 'vegetation-tree-1a4', radius: 2.4, min: 1, max: 4, maxTilt: 14, wald: [false, 0.0, 5] }, // 13,9 m, kahl
  { name: 'vegetation-tree-1a5', radius: 2.2, min: 1, max: 4, maxTilt: 14, wald: [false, 0.0, 5] }, // 12,0 m, kahl
  { name: 'vegetation-tree-1a4-1', radius: 2.0, min: 1, max: 5, maxTilt: 16, wald: [false, 0.0, 5] }, // 13,9 m, kahl
  { name: 'vegetation-tree-1a5-1', radius: 2.0, min: 1, max: 5, maxTilt: 16, wald: [false, 0.0, 5] }, // 12,0 m, kahl
  { name: 'vegetation-tree-1b1-1', radius: 2.0, min: 1, max: 5, maxTilt: 18, wald: [false, 0.0, 5] }, // 10,6 m, kahl
  { name: 'vegetation-tree-1c1-1', radius: 1.6, min: 2, max: 6, maxTilt: 20, wald: [false, 0.0, 5] }, // 7,4 m, kahl
  { name: 'vegetation-tree-1d1-1', radius: 2.0, min: 1, max: 5, maxTilt: 18, wald: [false, 0.0, 5] }, // 9,9 m, kahl
  { name: 'vegetation-tree-1e1-1', radius: 3.8, min: 0, max: 3, maxTilt: 14, wald: [false, 0.0, 5] }, // 15,1 m, kahl

  // ── Strauch- und Bodenschicht ──────────────────────────────────────
  // `bush-1a2-small` ist der einzige Strauch, der hier noch frei war —
  // ein Prefab, ein Biom (siehe Kopf). In Gruppen, weil Weidengebüsch aus
  // einem Wurzelstock heraus buschig treibt.
  { name: 'vegetation-bush-1a2-small', radius: 1.2, min: 6, max: 18, maxTilt: 24, wald: [false, 0.0, 5], gruppe: [8, 2, 6], kippen: 6 }, // 2,0 m, r 1,6
];

/**
 * Der Hohe Norden (Biom `deepnorth`) — karg, und das ist der ganze Punkt.
 *
 * Die Rolle des Bioms ist die Weite: Man sieht über das Land hinweg, und
 * ein einzelner Baum ist von weit her eine Wegmarke. Deshalb die
 * niedrigsten Stückzahlen und die grössten Radien der Datei — jede andere
 * Einstellung machte daraus einen Nadelwald mit anderer Beschriftung.
 *
 * Hier stehen die beiden `-snow`-Varianten des Stores, und sie stehen
 * NUR hier. Ihre Tönung ist der eigentliche Grund: Der Schnee-Busch trägt
 * 0,94/0,97/1,00 (so hell, wie glTF es zulässt) statt eines Grüns.
 */
export const STORE_HOCHNORD_FLORA: readonly FloraKurz[] = [
  // ── Die letzten Bäume ──────────────────────────────────────────────
  // Die `-0`-Kiefern, also die Variante mit dem helleren Nadelatlas
  // (gemessen 0,581 gegen 0,462) — an der Baumgrenze steht, was Licht
  // bekommt. `min: 0` heisst: In den meisten Zonen steht keiner.
  { name: 'vegetation-pine-1b5-0', radius: 10.0, min: 0, max: 2, maxTilt: 26, wald: [true, 0.0, 0.9] }, // 34,9 m, r 8,6
  { name: 'vegetation-pine-1b4-0', radius: 7.0, min: 0, max: 2, maxTilt: 28, wald: [true, 0.0, 1.0], gruppe: [18, 1, 3] }, // 23,8 m, r 5,9
  { name: 'vegetation-pine-1b1-0', radius: 4.0, min: 0, max: 3, maxTilt: 30, wald: [true, 0.0, 1.1], gruppe: [16, 1, 3] }, // 15,6 m, r 3,6

  // ── Totholz ────────────────────────────────────────────────────────
  // Auf einer Fläche fast ohne Bewuchs ist ein kahler Stamm das Einzige,
  // woran das Auge Entfernung misst.
  { name: 'vegetation-pine-1b5-1', radius: 3.0, min: 0, max: 2, maxTilt: 30, wald: [false, 0.0, 5] }, // 29,7 m, kahl
  { name: 'vegetation-pine-1b3-1', radius: 2.6, min: 0, max: 2, maxTilt: 32, wald: [false, 0.0, 5] }, // 31,9 m, kahl
  { name: 'vegetation-tree-1a3-2', radius: 2.2, min: 0, max: 3, maxTilt: 32, wald: [false, 0.0, 5] }, // 20,8 m, kahl
  { name: 'vegetation-tree-1b3-1', radius: 2.8, min: 0, max: 3, maxTilt: 30, wald: [false, 0.0, 5] }, // 21,9 m, kahl
  { name: 'vegetation-tree-1c2-1', radius: 1.8, min: 1, max: 4, maxTilt: 35, wald: [false, 0.0, 5] }, // 8,1 m, kahl
  { name: 'vegetation-tree-1d2-1', radius: 1.8, min: 1, max: 4, maxTilt: 35, wald: [false, 0.0, 5] }, // 10,1 m, kahl

  // ── Zwergstrauchheide und Gras ─────────────────────────────────────
  // Der einzige flächige Bewuchs, und auch der bleibt fleckig: kleine
  // Gruppen mit engem Radius statt Teppich. Die Warnung aus `flora.ts`
  // gilt hier genauso — die GRUPPENGRÖSSE multipliziert die Stückzahl,
  // und das fällt beim Lesen der Zeile nicht auf.
  { name: 'vegetation-bush-1a2-small-1-snow', radius: 1.6, min: 1, max: 5, maxTilt: 40, wald: [false, 0.0, 5], gruppe: [8, 1, 3], kippen: 5 }, // 2,0 m, r 1,6
  // Schnee- und Trockengras zeichnet der Clutter, siehe
  // `GRAS_BUESCHEL_HOCHNORD` oben.
  ...buescheln(GRAS_BUESCHEL_HOCHNORD),
];

/**
 * Die Aschewüste (Biom `ashlands`) — nur noch kahle Stämme.
 *
 * `flora.ts` lässt dieses Biom leer, und die Begründung dort trägt
 * weiter: Der eigene Bestand ist mitteleuropäisch-nordisch und GRÜN, und
 * eine Birke auf Schlacke sähe nicht karg aus, sondern versehentlich
 * hingestellt.
 *
 * Der Store ändert daran genau eine Sache: Er bringt STÄMME OHNE LAUB
 * mit. Die `-2`-Varianten sind entastete Stümpfe von 6 bis 21 m, 16 bis
 * 352 Dreiecke, ohne ein einziges Blatt — nachgeprüft über die Rollen in
 * `assets/store-lab/vegetation/BERICHT.json`, wo sie ausschliesslich
 * `rinde` führen. Nichts daran ist grün, und nichts daran muss
 * weggeblendet werden.
 *
 * Was weiterhin FEHLT und deshalb weiterhin nicht hier steht: verkohlte
 * Rinde. Die Stümpfe tragen den Eichen- beziehungsweise
 * Birkenrinden-Atlas (gemessen 0,446/0,385/0,314 braun), nicht Kohle. Sie
 * sind ein totes Land, aber kein verbranntes. Wer das ändert, ändert die
 * Textur — nicht diese Liste.
 */
export const STORE_ASCHE_FLORA: readonly FloraKurz[] = [
  { name: 'vegetation-tree-1b3-2', radius: 3.0, min: 0, max: 2, maxTilt: 30, wald: [false, 0.0, 5], kippen: 3 }, // 21,4 m, kahl
  { name: 'vegetation-tree-1b2-2', radius: 2.0, min: 0, max: 2, maxTilt: 32, wald: [false, 0.0, 5], kippen: 4 }, // 15,5 m, kahl, 31 Dreiecke
  { name: 'vegetation-tree-1a4-2', radius: 1.6, min: 0, max: 3, maxTilt: 35, wald: [false, 0.0, 5], kippen: 4 }, // 11,8 m, kahl, 16 Dreiecke
  { name: 'vegetation-tree-1a5-2', radius: 1.6, min: 0, max: 3, maxTilt: 35, wald: [false, 0.0, 5], kippen: 4 }, // 10,2 m, kahl, 16 Dreiecke
  { name: 'vegetation-tree-1b1-2', radius: 1.4, min: 1, max: 4, maxTilt: 38, wald: [false, 0.0, 5], kippen: 5 }, // 10,3 m, kahl
  { name: 'vegetation-tree-1e1-2', radius: 2.6, min: 0, max: 3, maxTilt: 32, wald: [false, 0.0, 5], kippen: 4 }, // 10,2 m, kahl
  { name: 'vegetation-tree-1e2-2', radius: 2.4, min: 0, max: 3, maxTilt: 32, wald: [false, 0.0, 5], kippen: 4 }, // 11,2 m, kahl
  { name: 'vegetation-tree-1d1-2', radius: 1.8, min: 1, max: 4, maxTilt: 35, wald: [false, 0.0, 5], kippen: 5 }, // 7,2 m, kahl
  { name: 'vegetation-tree-1d2-2', radius: 1.8, min: 1, max: 4, maxTilt: 35, wald: [false, 0.0, 5], kippen: 5 }, // 6,7 m, kahl
  { name: 'vegetation-tree-1c1-2', radius: 1.4, min: 1, max: 4, maxTilt: 38, wald: [false, 0.0, 5], kippen: 5 }, // 7,4 m, kahl
  { name: 'vegetation-tree-1c2-2', radius: 1.6, min: 1, max: 4, maxTilt: 38, wald: [false, 0.0, 5], kippen: 5 }, // 8,1 m, kahl
];

/**
 * Alle fünf Bündel in der Reihenfolge, in der `flora.ts` sie einhängt.
 *
 * Für die Prüfer: Sie fragen diese Liste, nicht die Einzelnamen — ein
 * neues Bündel, das hier fehlt, wird sonst von keinem Test gesehen.
 */
export const STORE_FLORA_BUENDEL: readonly (readonly [string, readonly FloraKurz[]])[] = [
  ['grasland', STORE_GRASLAND_FLORA],
  ['nadelwald', STORE_NADELWALD_FLORA],
  ['sumpf', STORE_SUMPF_FLORA],
  ['hochnord', STORE_HOCHNORD_FLORA],
  ['asche', STORE_ASCHE_FLORA],
];
