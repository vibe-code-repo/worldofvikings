#!/usr/bin/env node
/**
 * Store-Vegetation aufbereiten: Materialien zusammenlegen, Laub tönen,
 * verlorene Materialzuweisungen aus der Geometrie zurückgewinnen.
 *
 * Liest `assets/store/vegetation/*.glb` (NUR lesend — der Store liegt
 * ausserhalb des Repos und wird nie beschrieben) und schreibt die
 * aufbereiteten Modelle nach `assets/store-lab/vegetation/`. Der Ordner
 * ist erzeugt und steht in `.gitignore`; der Name sagt am Pfad, was die
 * Datei ist.
 *
 *   npm run store:aufbereiten
 *   npx tsx tools/store-vegetation-aufbereiten.mjs --nur-pruefen
 *
 * ── Was gemessen wurde, bevor irgendetwas gesetzt wurde ──────────────
 * Die zwölf Atlanten unter `assets/store/vegetation/textures/`, jeweils
 * der Mittelwert über die DECKENDEN Texel (Alpha >= 128), in sRGB
 * normiert:
 *
 *   Laub      bush-1a2-small-1-dark-…  0.452 / 0.452 / 0.452   GRAU
 *   Nadel 1   pine-1b1-0-1-…           0.581 / 0.581 / 0.581   GRAU
 *   Nadel 2   pine-1b1-1-…             0.462 / 0.462 / 0.462   GRAU
 *   Ahorn     tree-1e1-1-…             0.647 / 0.646 / 0.647   GRAU
 *   Gras      grass-short-clump-1-…    0.342 / 0.420 / 0.214   farbig
 *   Gras rb   …-redblue-…              0.350 / 0.447 / 0.186   farbig
 *   Gras gelb …-yellow-…               0.415 / 0.444 / 0.376   fast grau
 *   Gras Schnee …-snow-…               0.707 / 0.708 / 0.704   GRAU, hell
 *   Rinde Eiche massive-tree-1a1-1-…   0.446 / 0.385 / 0.314   braun
 *   Rinde Nadel pine-1b1-0-…           0.313 / 0.263 / 0.236   braun
 *   Rinde Birke tree-1a3-0-…           0.632 / 0.616 / 0.560   beige
 *   Pilz      sm-plant-mushrooms-02-…  0.334 / 0.292 / 0.235   braun
 *
 * Das bestätigt den Befund aus dem Schwesterprojekt, aber genauer als
 * erwartet: Die LAUB- und NADEL-Atlanten sind Helligkeitsmasken (R = G =
 * B auf die dritte Stelle), die RINDEN- und GRAS-Atlanten dagegen sind
 * farbig. Rinde braucht also keine Tönung, Laub braucht sie zwingend.
 *
 * ── Und der zweite, wichtigere Befund ────────────────────────────────
 * Der Farbton fehlt NICHT überall. Der Store-Export trägt in 39 von 151
 * Materialien einen `baseColorFactor` — Werte, die messbar hinkommen
 * (Laub 0.46/0.95/0.20 ergibt mit dem Atlas sRGB 0.31/0.43/0.21, ein
 * glaubhaftes Blattgrün). Sie stammen aus dem Original-Material und
 * werden hier deshalb NICHT überschrieben, sondern JE MATERIAL
 * übernommen — nicht je Rolle: Die 39 tragen fünf verschiedene Werte,
 * und eine Tabelle je Rolle gäbe nur den häufigsten davon wieder.
 *
 * ── Und wo gar keiner steht: das Original-Material ───────────────────
 * Für die Lücken (die wiederhergestellten Kronen und das eine
 * verschneite Laubmaterial) wird nicht mehr geschätzt. Die Spieldaten
 * des Vorbilds führen zu jedem Laub-Atlas ein Shadergraph-Material mit
 * einer Ober- und einer Unterfarbe; glTF kennt nur einen Faktor, also
 * steht hier das MITTEL aus beiden. Die Zahlen und ihre Herkunft stehen
 * in `shared/src/laubSpitzen.ts`, gemessen am 08.09.2026.
 *
 * Er fehlt genau dort, wo es am meisten weh tut: In 33 Primitiven zeigt
 * das Material auf `DefaultMaterial` — kein Bild, keine Tönung, kein
 * Alphatest. Das sind die Kronen und Stämme der GRÖSSTEN Bäume
 * (massive-tree, split-tree, branched-tree) und die Stämme von 16
 * abgestorbenen Varianten. Sie rendern heute als weisse, undurchsichtige
 * Rechtecke.
 *
 * ── Wie die verlorene Zuweisung zurückgeholt wird ────────────────────
 * Nicht aus einer Artentabelle — die wäre eine zweite Wahrheit neben der
 * Geometrie und liefe beim nächsten Store-Import still auseinander.
 * Sondern aus dem Bestand selbst, in zwei Schritten:
 *
 *  1. FINGERABDRUCK. Über ALLE 94 Modelle hinweg wird je Primitiv der
 *     SHA1 seiner POSITION-Bytes gebildet. Dieselbe Geometrie kommt in
 *     mehreren Dateien vor (`massive-tree-1a1.glb` und
 *     `massive-tree-1a1-1-dark.glb` teilen sich Stamm UND Krone), und in
 *     einer davon trägt sie oft ein richtiges Material. 19 der 33
 *     DefaultMaterial-Primitive finden so ihren Zwilling — allesamt
 *     Stämme, allesamt `Trunks` oder `Oak_Bark_A 2 Dark`.
 *
 *  2. BAUART. Für die restlichen 14 gibt es keinen Zwilling. Sie werden
 *     an einer Kennzahl unterschieden, die im Bestand trennscharf ist:
 *     VERTICES JE DREIECK. Laubkarten sind unverschweisste Vierecke —
 *     4 Vertices auf 2 Dreiecke, also exakt 2,000. Gemessen über alle
 *     Primitive mit bekanntem Material:
 *
 *         Laub-/Gras-/Nadelkarten   2,000 ohne Ausnahme (n = 68)
 *         Rinde und Stamm           0,65 … 1,85 (n = 108)
 *
 *     12 der 14 liegen bei exakt 2,000 → Krone. Zwei liegen bei 0,964
 *     (`branched-tree-2a1/2a3`, Prim 0) → Stamm.
 *
 * Krone bekommt den Laub-Atlas samt Tönung, Stamm den Eichenrinden-Atlas
 * (den ihre Geschwister massive-tree/split-tree tragen — dieselbe
 * Baumfamilie, derselbe Export).
 *
 * ── Warum Rinde und Laub NICHT in EIN Material gehen ─────────────────
 * `tools/baum-material-zusammenlegen.mjs` kann das für die eigenen Bäume,
 * weil deren UVs im Einheitsquadrat liegen: Man legt zwei Bilder
 * nebeneinander und rechnet die UVs in ihre Hälfte um. Die Store-Modelle
 * KACHELN — die Rinden-UVs laufen von -9,6 bis 8,5 in u und bis 26,4 in
 * v. Ein Atlas mit Wiederholung ist keine Halbierung, sondern eine
 * Unmöglichkeit: Bei u = 3,7 holt der Sampler in einem Atlas die
 * Nachbarhälfte statt der eigenen Kachel.
 *
 * Ohne Blender (UV-Neuwicklung) bleibt es deshalb bei einem Material JE
 * ATLAS UND TÖNUNG. Zusammengelegt wird alles, was sich Bild,
 * Alphamodus, Cutoff, Zweiseitigkeit UND Tönung teilt — in 93 von 94
 * Modellen sind das alle Laubmaterialien zusammen. Die Ausnahme ist
 * `small-thin-tree-1a5`: Sie führt zwei Grüntöne des Stores auf
 * derselben Karte (`Leaves Birch 1` neben `Leaves 2`), und die bleiben
 * getrennt, weil sonst einer von beiden lautlos seine Store-Farbe
 * verlöre. Was bleibt, steht in BERICHT.json: `materialienNachher`.
 *
 * ── Die zweite Schale: LOD-Stufen IN der Datei ───────────────────────
 * (Nachtrag Bauer „Leistung", 09.09.2026 — gemessen, nicht vermutet.)
 *
 * 34 der 94 Modelle tragen ihre eigene LOD-Kette MIT IN DERSELBEN DATEI,
 * als Kindknoten der LOD0-Schale:
 *
 *   tree-1e1.glb      Tree_1E1 (11.678 Dr.)
 *                       ├─ Tree_1E1_1  (6.346 Dr.)
 *                       └─ Tree_1E1_2  (2.238 Dr.)      = 20.262 gesamt
 *   massive-tree-1a1-1-dark.glb
 *                     Massive_Tree_1A1 1 Dark (14.110)
 *                       └─ Massive_Tree_1A1_LOD_1 (9.185) = 23.295
 *
 * Sie stehen NICHT nebeneinander, sondern ineinander: dieselbe Hüllbox,
 * dieselbe Achse, dieselben Materialien — Unity hätte je nach Entfernung
 * eine davon eingeschaltet, Babylon zeichnet ALLE. Der Befund aus Schritt 1
 * („zwei beschädigte Varianten") war die richtige Beobachtung mit der
 * falschen Erklärung: Es ist keine Schadensvariante, es ist die
 * Fernstufe. Der Beweis steht in den Zahlen — dieselbe Silhouette bei
 * 55 % beziehungsweise 19 % der Dreiecke, und für drei Familien liegt
 * genau diese Fernstufe zusätzlich als eigene Datei daneben
 * (`massive-tree-1a1-lod-1.glb` = 9.185 Dreiecke, bitgleich).
 *
 * Der Client hat dagegen eine Abwehr, aber sie greift hier nicht:
 * `AssetManager` filtert `/^lod\d/i` — auf den ANFANG des Meshnamens
 * verankert, weil der alte Fremdexport seine Schalen `Lod0`/`Lod1`
 * nannte. Der Store nennt sie `Tree_1E1_1` und `…_LOD_1`. Kein einziger
 * Name beginnt mit „lod", also rendert jede Schale mit.
 *
 * Entfernt wird deshalb HIER, in der Aufbereitung: Was gar nicht erst in
 * die Datei kommt, wird auch nicht geladen, nicht geparst, nicht in den
 * Puffer geschoben und nicht gezeichnet. Über alle 94 Modelle sind das
 * 164.649 von 584.136 Dreiecken — 28,2 %.
 *
 * ERKANNT wird eine Schale an drei Bedingungen ZUSAMMEN, nie am Namen
 * allein (ein Name ist eine Behauptung, kein Beweis):
 *
 *   1. NAME  `…_LOD_<n>` oder `…_<n>` mit n >= 1.
 *   2. LAGE  Der Knoten hängt UNTER einer anderen Schale mit Geometrie
 *            (verschachtelt) oder NEBEN einer gleichnamigen mit
 *            kleinerer Stufe (Geschwister — so liegen die vier
 *            Grasbüschel).
 *   3. MASS  Weniger Dreiecke als die behaltene Schale UND eine Hüllbox,
 *            die in deren Hüllbox liegt (1 cm Toleranz). Das ist der
 *            Zeuge: Ein zweites, eigenständiges Objekt stünde woanders
 *            oder wäre grösser. Fällt eine der drei Bedingungen, bleibt
 *            der Knoten stehen und der Bericht sagt, warum.
 *
 * Nie entfernt wird die Stufe 0 und nie der letzte Knoten mit Geometrie:
 * `massive-tree-1a1-lod-1.glb` IST die Fernstufe und behält sie deshalb
 * vollständig.
 *
 * `--lod-behalten` stellt den alten Zustand her — für die
 * Vergleichsmessung, nicht für den Betrieb.
 *
 * ── Der Binärteil: bufferView-weise, nie byteweise ───────────────────
 * Alle 117 Bilder des Bestands liegen als externe `uri` neben den GLBs,
 * kein einziges als bufferView. Ein Material zu tönen oder ihm ein Bild
 * zu geben ist damit eine reine JSON-Änderung.
 *
 * Solange nur Materialien umgebaut wurden, ging der BIN-Block deshalb
 * Byte für Byte durch. Seit die LOD-Schalen fallen, stimmt das nicht mehr
 * — ihre Positions- und Indexdaten wären tote 15 MB im Download. Der
 * BIN wird deshalb NEU GEPACKT, aber auf der Ebene der bufferViews und
 * nicht der Bytes: Jeder noch von einem Accessor benutzte bufferView
 * wandert als GANZES und in seiner alten Reihenfolge in den neuen Block,
 * `byteStride` und Innenaufbau bleiben unangetastet (83 bufferViews des
 * Bestands sind verschränkt — ein byteweises Umpacken müsste ihre
 * Verschränkung verstehen, ein bufferView-weises muss es nicht).
 * `byteOffset` wird neu geschrieben, die Accessor-Offsets sind relativ
 * zum bufferView und bleiben.
 *
 * Was daraus folgt, und was NICHT:
 *   • Die überlebende Geometrie ist bitgleich — dieselben Bytes, nur an
 *     einer anderen Stelle im Block.
 *   • Der zweite Lauf ist byteidentisch (die Reihenfolge hängt allein am
 *     alten Index; Test: `tools/test/store-vegetation.ts`).
 *   • Die `bounds` aus `prefabs.json` gelten für die aufbereitete Datei
 *     NICHT mehr ungeprüft. Sie stehen deshalb nachgemessen in
 *     BERICHT.json (`huellbox`), und `tools/store-prefabs.mjs` nimmt sie
 *     von dort, sobald es eine aufbereitete Datei gibt.
 *
 * Ausdrücklich NICHT angefasst, weil es an anderer Stelle schon
 * beantwortet ist (Messprobe Bauer D, `design/store-konventionen.md`):
 * Knotentransformationen (`__root__` trägt die Händigkeitsumrechnung, der
 * Client rechnet sie in `zuMaster()` heraus — eine zweite Spiegelung hier
 * wäre eine doppelte), der Ursprung (257 Modelle reichen unter y = 0, das
 * sind Wurzelanläufe und Absicht) und die Kollision (die kommt nicht aus
 * der GLB, sondern aus `collision.box` in `prefabs.json`).
 *
 * ── Warum die Bilder KOPIERT und nicht verlinkt oder eingebettet werden
 * Die GLBs nennen ihre Texturen relativ (`textures/<name>.png`), und
 * Babylon löst das gegen die rootUrl des Ladeaufrufs auf — also gegen
 * `assets/store-lab/vegetation/`. Ein 404 dort ist kein sichtbarer
 * Fehler: Der Container fällt aus, `instantiate()` liefert stumm `null`.
 * Drei Wege führen daran vorbei, und die Wahl ist begründet:
 *
 *   EINBETTEN   hiesse, den BIN-Block neu zu packen — und damit die
 *               Zusage aufzugeben, dass die Geometrie Byte für Byte
 *               dieselbe bleibt. Ausserdem läge der Laub-Atlas dann 30-mal
 *               in 30 Dateien statt einmal; aus 53 MB würden ~250 MB, und
 *               der Browser lüde dieselbe Textur 30-mal statt sie im
 *               Cache zu finden.
 *   SYMLINK     hält den Ordner klein, aber er ist dann keine
 *               eigenständige Auslieferung mehr: Wer `store-lab/`
 *               kopiert, kopiert einen toten Zeiger, und der Fehler
 *               zeigt sich erst im Browser als stummer Ausfall.
 *   KOPIEREN    zwölf Dateien, 7,2 MB, in Millisekunden geschrieben. Der
 *               Ordner steht für sich, und der Prüfer
 *               (`tools/test/store-vegetation.ts`) kann für JEDES
 *               Material nachsehen, ob sein Bild wirklich daneben liegt.
 *
 * Kopiert wird deshalb, und geprüft wird es auch.
 *
 * ── Wind ─────────────────────────────────────────────────────────────
 * Der Wind hängt am MATERIAL, und `AssetManager.fixupMaterial` hängt ihn
 * an, sobald das Material `alphaMode: MASK` deklariert und der
 * Prefabname nicht nach Bauteil aussieht (`swaysInWind`). Alle
 * `vegetation-*`-Namen kommen durch. Es schwingt also nach dieser
 * Aufbereitung jedes LAUB-, NADEL- und GRAS-Material — und die 14
 * reparierten Kronen schwingen erstmals überhaupt, weil sie vorher
 * OPAQUE waren. Rinde bleibt bewusst still: Ihr Atlas ist voll deckend,
 * fällt durch den Cutout-Test und bekommt keinen Sway.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode as decodePng } from './lib/png.mjs';
/*
  Die Farben des Vorbilds stehen seit dem 12.09.2026 NICHT mehr hier,
  sondern in `shared/src/laubSpitzen.ts` — dort, wo auch der Client sie
  liest. Vorher lagen dieselben Zahlen zweimal im Baum (hier das Mittel,
  dort der Verlauf), und zwei Tabellen mit denselben Zahlen laufen
  auseinander, sobald jemand eine davon nachmisst.

  Deshalb startet `store:aufbereiten` dieses Werkzeug mit `tsx` statt mit
  `node` — dieselbe Zeile startet `tools/store-prefabs.mjs` schon so.
*/
import { LAUB_SPITZEN, laubMittel } from '../shared/src/laubSpitzen.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : standard;
};
const flag = (name) => process.argv.includes(`--${name}`);

const QUELLE_STANDARD = 'assets/store/vegetation';
const ZIEL_STANDARD = 'assets/store-lab/vegetation';

const QUELLE = resolve(WURZEL, arg('quelle', QUELLE_STANDARD));
const ZIEL = resolve(WURZEL, arg('ziel', ZIEL_STANDARD));
const NUR_PRUEFEN = flag('nur-pruefen');
/**
 * Die überzähligen LOD-Schalen stehen lassen? Vorgabe: NEIN.
 *
 * Siehe den Abschnitt „Die zweite Schale" im Kopfkommentar. Der Schalter
 * ist der Rückweg für eine Vergleichsmessung — nicht für den Betrieb.
 */
const LOD_BEHALTEN = flag('lod-behalten');

// ── Die Bilder, benannt ──────────────────────────────────────────────
//
// Der Store benennt seine Texturen nach dem Modell, in dem sie ZUERST
// vorkamen, plus Inhaltskürzel — `bush-1a2-small-1-dark-0-46087926.png`
// ist der Laub-Atlas ALLER Laubbäume, nicht der eines Busches. Diese
// Zuordnung steht hier einmal, damit der Rest des Werkzeugs über Rollen
// reden kann statt über Dateinamen.
const BILD = {
  laub: 'textures/bush-1a2-small-1-dark-0-46087926.png',
  rindeEiche: 'textures/massive-tree-1a1-1-dark-0-755765f4.png',
  rindeNadel: 'textures/pine-1b1-0-8c80d300.png',
  rindeBirke: 'textures/tree-1a3-0-c6f2bd38.png',
};

/**
 * Der Faktor des QUELLMATERIALS, wenn es einen mitbringt — sonst nichts.
 *
 * Das ist die erste von zwei Auskünften über die Tönung und die
 * stärkere: Ein `baseColorFactor` im Store stammt aus dem
 * Original-Material des Spiels und wird NICHT ersetzt. 39 der 151
 * Store-Materialien tragen einen, und sie tragen ihn in fünf
 * verschiedenen Werten — die Rolle allein ist also zu grob, um ihn
 * wiederzugeben. (Vorher stand hier eine Tabelle je ROLLE, und die sechs
 * `Leaves Birch 1/2` verloren dabei still ihren eigenen Wert
 * 0.55/1.00/0.24 an den häufigeren 0.46/0.95/0.20.)
 */
const quellFaktor = (mat) => mat?.pbrMetallicRoughness?.baseColorFactor ?? null;

/**
 * Rollen, deren Tönung den Store-Faktor SCHLÄGT — die einzige Ausnahme
 * von der Regel darüber, und sie ist am Bild belegt.
 *
 * ── Warum es diese Ausnahme geben muss ───────────────────────────────
 * Der Vorrang des Store-Faktors ist richtig, solange dieser Faktor aus
 * dem Original-Material stammt und die Fläche danach so aussieht wie im
 * Vorbild. Beim Wiesengras trifft das zweite nicht zu, und zwar
 * messbar: `grass-short-clump-1` trägt [0.85, 1.0, 0.6]; damit steht
 * unser Halm am Referenzort um 17 Uhr auf
 *
 *     sRGB 78,5 / 87,9 / 57,4   Luma 83,7   H 78°   S 0,39
 *
 * die Büschel des Originals (Referenzbild 1, Rechtecke in
 * `design/look-referenz.md`) dagegen auf
 *
 *     sRGB 68,1 / 66,0 / 36,2   Luma 64,3   H 56°   S 0,47
 *
 * Unser Gras ist also zu hell, zu grün und zu blau — es liest sich als
 * frisches Maigrün, wo das Vorbild ein gelbstichiges Sommergras zeigt.
 * Ohne diese Ausnahme gäbe es keinen Regler dafür: Die Tönungskarte
 * `grass_terrain_color` bleibt für Store-Büschel bewusst aus (zweimal
 * grün ergibt Neon, siehe GrassClutter.ts), und die Instanzstreuung ist
 * eine ±7-%-Schwankung um genau diesen Faktor, kein Ersatz für ihn.
 *
 * ── Die Rechnung ─────────────────────────────────────────────────────
 * Der Halm ist eine alphagetestete Karte auf einem StandardMaterial,
 * also Lambert: Der Faktor multipliziert das Bild linear. Auf sRGB
 * gelesen ist die Korrektur deshalb
 *
 *     k = (Ziel / Ist) ^ 2.2  =  (0.731, 0.533, 0.363)
 *
 * und der neue Faktor das Produkt aus altem Faktor und Korrektur:
 *
 *     [0.85, 1.00, 0.60] × (0.731, 0.533, 0.363) = [0.622, 0.533, 0.218]
 *
 * Die Zahl steht in `TOENUNG_VORGABE.gras`, damit sie nur EINMAL im
 * Werkzeug steht; diese Menge sagt bloss, dass sie gewinnt.
 *
 * NICHT drin: `grasGelb`, `grasBunt`, `grasSchnee`. Für sie gibt es
 * kein Referenzbild — das Original zeigt in allen drei Aufnahmen
 * Wiesen- und Hanggras, kein Trockengras und keinen Schnee. `grasGelb`
 * bleibt damit die eine geschätzte Zeile, die sie schon war.
 *
 * ── Der zweite Eintrag: `ahorn` (10.09.2026) ─────────────────────────
 * Mikes Sichtprüfung: „Bäume sind stellenweise sehr hell vom Blattlaub
 * her, nicht alle, einzelne." Der Zensus über ALLE 94 Modelle sagt,
 * welche. Gerechnet wird je Material die Albedo, wie sie am Bildschirm
 * ankommt: der Atlasmittelwert über die DECKENDEN Texel (Alpha >= 128,
 * linear) MAL dem `baseColorFactor`. Beides steht im Bestand, geschätzt
 * ist daran nichts.
 *
 *   Modell(e)                    Material     linLuma   x Median
 *   grass-short-clump-snow       grasSchnee    0.4688     3.41
 *   tree-1e1, tree-1e2           ahorn         0.3287     2.39   <--
 *   pine-1b1-0 … (5 Kiefern)     nadeln        0.1478     1.07
 *   bush-1a2 … (6 Modelle)       laub          0.1476     1.07
 *   branch-1a1 … (19 Modelle)    laub          0.1376     1.00
 *   massive-/split-tree (12)     laub          0.1070     0.78
 *   massive-…-1-dark (6)         laubDunkel    0.0840     0.61
 *
 * Der Median liegt bei 0,1376, die Schwelle „1,3 x" also bei 0,1788.
 * ZWEI Zeilen stehen darüber, und nur eine davon ist ein Fehler:
 *
 *   grasSchnee ist SCHNEE. Der Atlas ist absichtlich fast weiss
 *     (gemessen 0,707/0,708/0,704 sRGB), und `grass-short-clump-snow`
 *     steht ausschliesslich in `GRAS_BUESCHEL_HOCHNORD`
 *     (shared/src/storeFlora.ts) — auf der Wiese kommt er nicht vor.
 *     Heller Schnee im Hohen Norden ist richtig, nicht auffaellig.
 *
 *   ahorn ist es NICHT. `tree-1e1`/`tree-1e2` stehen im Wiesen-Wald
 *     (`wald: [true, 0.95, 1.4]`), also genau dort, wo Mike laeuft — und
 *     sie sind mit 2,39 x Median doppelt so hell wie ihre Nachbarn. Der
 *     Grund steht in zwei Zahlen: Der Ahorn-Atlas ist mit linear 0,383
 *     der HELLSTE Laubatlas des Bestands (der gewoehnliche Laubatlas
 *     liegt bei 0,174, also 2,2 x dunkler), und sein Store-Faktor
 *     [0,62, 1,00, 0,20] daempft ihn NICHT — der Gruenkanal steht auf
 *     dem Anschlag 1,0. Zwei Helligkeiten multiplizieren sich, keine
 *     bremst.
 *
 * Genommen wird die gemessene Originalfarbe `Maple Leaves 1` aus den
 * Spieldaten (`LAUB_SPITZEN['Maple Leaves 1']`) — dieselbe Quelle, aus
 * der die uebrigen Vorgaben stammen. Mit ihr faellt die Albedo auf
 * 0,1482 linear, also 1,08 x Median: Der Ahorn steht damit neben Kiefer
 * (1,07) und Busch (1,07) statt doppelt so hell.
 *
 * Warum der Vorrang der richtige Regler ist und nicht ein zusaetzlicher
 * Daempfungsfaktor: Der Store-Faktor beschreibt bei diesem Material
 * nachweislich nicht die Blattfarbe des Vorbilds — er laesst einen 2,2 x
 * zu hellen Atlas ungebremst durch. Die Originalmessung tut es. Dieselbe
 * Begruendung wie bei `gras`, nur an einem anderen Material.
 */
/*
  ── 10.09.2026: `gras` ist raus ────────────────────────────────────────
  Die Zahl [0,46, 0,22, 0,04] war aus Referenzbild 1 ZURÜCKGERECHNET
  (`k = (Ziel/Ist)^2.2`, die Rechnung steht oben) — also eine
  Bildkorrektur an der Albedo, und damit genau die Sorte Eingriff, die
  diese Runde aus dem Boden entfernt hat: Sie legt eine Farbe, die aus
  Licht, Nebel und Grading kommt, in die Textur.

  Das Vorbild tönt seine Grasbüschel nicht. `design/original-boden.md`
  §B: Die Detail-Ebenen von TerrainL1 führen `healthyColor` = `dryColor`
  = WEISS; was ein Halm an Farbe hat, hat er aus seinem Material — und
  das ist bei uns der Store-Faktor [0,85, 1,00, 0,60], der genau aus
  diesem Material stammt (F30).

  Der Befund, der die Ausnahme begründet hat, bleibt trotzdem richtig:
  Unser Halm stand um 17 Uhr auf H 78° und S 0,39 gegen H 56° und S 0,47
  im Vorbild — zu grün, zu hell. Nur ist die Ursache jetzt woanders zu
  suchen, nämlich im LICHT (Sonne #FFC98C, Grundlicht aus dem
  Skybox-Tint), und dort ist sie in dieser Runde auch angefasst worden.
  Was danach übrigbleibt, misst der Nachweis; steht es weiter daneben,
  ist das ein Befund und kein Grund für einen Faktor.
*/
const TOENUNG_VORRANG = new Set(['ahorn']);

/**
 * Die Farbe, die das VORBILD diesem Quellmaterial gibt — nach dem Namen
 * des Materials, das im Store steht.
 *
 * ── Warum es diese Tabelle gibt (A8, 11.09.2026) ─────────────────────
 * `Kronen/Himmel` steht bei 0,65 statt 0,34, und die Diagnose hat drei
 * Verdächtige gehabt. Zwei davon sind erledigt, und beide durch eine
 * Messung und nicht durch einen Regler:
 *
 *  1. DER ATLAS IST NICHT SCHULD. Die vier Blattkarten des Vorbilds
 *     (`Color Leaves Alpha`, `Pine Alpha A/B`, `Maple Leaves Alpha A`)
 *     sind GRAUSTUFEN — Sättigung der deckenden Texel 0,0002 bis 0,0018.
 *     Ihre lineare Luma über die deckenden Texel (Alpha ≥ 128):
 *
 *         Color Leaves Alpha    0,17383      Pine Alpha A   0,30313
 *         Pine Alpha B          0,19855      Maple A        0,38172
 *
 *     Das ist Bild für Bild dieselbe Karte, die im Speicher liegt. Die
 *     Blattfarbe kommt also VOLLSTÄNDIG aus den Materialfarben — und
 *     damit ist diese Tabelle die einzige Stelle, an der sie entsteht.
 *
 *  2. DIE 26 KRONEN MIT `DefaultMaterial` SIND NICHT DIE HELLEN. Sie
 *     bekommen `TOENUNG_VORGABE.laub` (= Mittel von „Leaves 1", lineare
 *     Luma des Faktors 0,615) und liegen damit UNTER den Store-Faktoren
 *     der übrigen Kronen (0,792 und 0,849). Der Bericht weist es je
 *     Primitiv aus (`albedo` im Zensus).
 *
 *  3. WAS ÜBRIG BLEIBT: die Store-Faktoren selbst. Sie sind die Zahlen
 *     des ASSET-HERSTELLERS, nicht die des Vorbilds — und das Vorbild
 *     fährt dieselben Karten mit eigenen, DUNKLEREN Farben. Beispiel
 *     `Leaves Birch 1`: Store 0,55/1,00/0,24 (lineare Luma 0,849),
 *     Vorbild 0,5525/0,5995/0,3725 (0,573) — ein Drittel dunkler, bei
 *     identischer Karte.
 *
 * Deshalb steht hier je QUELLMATERIAL die gemessene Farbe des Vorbilds.
 * Nicht je Rolle: Ein Vorrang je Rolle würde `Leaves 1`, `Leaves 2` und
 * `Leaves Birch 1` auf denselben Wert ziehen und damit genau die
 * Unterschiede einebnen, die der Schlüssel in Schritt 2 bewahrt (siehe
 * dort, `small-thin-tree-1a5`).
 *
 * ── Woher die Zahlen kommen ──────────────────────────────────────────
 * Aus `shared/src/laubSpitzen.ts` — und nur von dort. Dort stehen beide
 * Farben des Vorbilds (`Color_3E4BE667` oben, `Color_99FDAD86` unten,
 * linear, gemessen in `/home/mike/wov-lab-mess/laub-materialien.json`),
 * hier das MITTEL aus beiden, weil glTF nur EINEN `baseColorFactor`
 * kennt.
 *
 * Bis zum 12.09.2026 stand hier eine eigene Zahlenliste mit genau diesen
 * Mittelwerten. Sie ist ersatzlos weg: Der Client baut den Verlauf seit
 * heute nach (`client/src/engine/LaubSpitzen.ts`), und zwei Tabellen mit
 * denselben Zahlen laufen auseinander, sobald eine davon nachgemessen
 * wird. Geschätzt ist an keiner Zeile etwas.
 *
 * ── Und damit ist `grasGelb` vermessen ───────────────────────────────
 * Die eine geschätzte Zeile des Bestands (`TOENUNG_VORGABE.grasGelb`,
 * „sRGB 0,41/0,41/0,26, Strohfarbe") hat eine Herkunft bekommen:
 * `Grass_Short_Plant_Leaves_1A1_Yellow` steht in derselben Liste. Die
 * Vorgabe bleibt stehen, greift aber nur noch, wenn ein künftiges
 * Modell diesen Materialnamen NICHT trägt.
 *
 * Measured original material colours, keyed by the source material name
 * the store GLB carries — the mean of the shader graph's top and bottom
 * crown colour, derived from shared/src/laubSpitzen.ts.
 *
 * Die `1A1`-Grasfamilie steht mit drin: Sie teilt sich EINE Geometrie
 * und unterscheidet sich nur in diesen Farben; der Store hat für drei
 * der vier gar keinen Faktor mitgebracht (`grasBunt`, `grasSchnee`
 * standen auf „ohne").
 */
const UNITY_JE_MATERIAL = Object.fromEntries(
  Object.entries(LAUB_SPITZEN).map(([name, s]) => [name, [...laubMittel(s), 1]])
);

/**
 * Welches Originalmaterial hinter einer ROLLE steht.
 *
 * Gebraucht an zwei Stellen, und nur deshalb gibt es die Zeile
 * überhaupt: für die Vorgabe unten (ein Primitiv ohne eigenes Material
 * bekommt die Farbe seiner Familie) und für `shared/src/laubVorbilder.ts`
 * — der Client muss auch bei den wiederhergestellten Kronen wissen,
 * WELCHEN Verlauf er auftragen soll.
 *
 * Die Zuordnung Store-Textur ↔ Original-Material läuft über den
 * Texturnamen; der Store hängt an jeden noch seinen Inhaltshash:
 *
 *   laub        „Leaves 1"                 ↔ bush-1a2-small-1-dark-0-46087926.png
 *   laubDunkel  „Leaves Birch 3 Dark"      ↔ dieselbe Karte, Sumpf-/Schattenvariante
 *   laubSchnee  „Leaves Birch 3 Dark Snow" ↔ dieselbe Karte, verschneit
 *   nadeln      „Pine 1"                   ↔ pine-1b1-0-1-45d12350.png
 *   ahorn       „Maple Leaves 1"           ↔ tree-1e1-1-ac727b2e.png
 *
 * Die Farben dazu stehen in `shared/src/laubSpitzen.ts`.
 */
const VORBILD_JE_ROLLE = {
  laub: 'Leaves 1',
  laubDunkel: 'Leaves Birch 3 Dark',
  laubSchnee: 'Leaves Birch 3 Dark Snow',
  nadeln: 'Pine 1',
  ahorn: 'Maple Leaves 1',
};

/** Das Mittel des Vorbilds einer Rolle — die Vorgabe unten liest hier. */
const rollenMittel = (rolle) => UNITY_JE_MATERIAL[VORBILD_JE_ROLLE[rolle]];

/**
 * Die VORGABE je Rolle — sie greift nur, wo das Quellmaterial keinen
 * eigenen Faktor mitbringt.
 *
 * Das sind zwei Fälle, und beide sind echte Lücken, keine Geschmacksfrage:
 * die 26 Kronen-Primitive, deren Material im Store verlorengegangen ist
 * (`DefaultMaterial`, siehe Kopfkommentar Schritt 2), und das eine
 * verschneite Laubmaterial, das ohne Faktor exportiert wurde. Ohne
 * Tönung rendern sie GRAU — die Atlanten sind Helligkeitsmasken
 * (gemessen R = G = B, Laub 0.452).
 *
 * Wo eine Zuordnung zum Original-Material besteht, steht hier dessen
 * Mittel aus Ober- und Unterfarbe (siehe VORBILD_JE_ROLLE) und keine
 * Schätzung. Übrig bleibt genau eine geschätzte Zeile, `grasGelb` — für
 * seinen Atlas gibt es keine benannte Zuordnung, das steht als offener
 * Punkt im Bericht.
 */
const TOENUNG_VORGABE = {
  // Wiederhergestellte Kronen der Massive-/Split-/Branched-Tree-Familie.
  // In den Spieldaten haben diese Bäume zwei Submeshes, aber nur EIN
  // Material (Rinde) — ein Original-Laubmaterial gibt es für sie nicht.
  // Genommen wird die Laubfamilie ihrer Karte, „Leaves 1".
  laub: rollenMittel('laub'),
  // Dieselben Kronen in den `-dark`-Dateien (Sumpf, Schattenwald).
  laubDunkel: rollenMittel('laubDunkel'),
  // Verschneite Kronen und das faktorlose `Leaves Birch 3 Dark Snow`.
  // Vorher stand hier [0.94, 0.97, 1.0, 1] — hell und kühl geschätzt,
  // weil die Herkunft fehlte. Das Original ist deutlich gedämpfter.
  laubSchnee: rollenMittel('laubSchnee'),
  // Nadeln und Ahorn: im Store trägt jedes dieser Materialien seinen
  // eigenen Faktor, die Vorgabe ist also derzeit unerreicht. Sie steht
  // trotzdem hier, damit ein künftiges Modell ohne Faktor nicht grau
  // wird — und sie steht auf dem Original, nicht auf dem Nachbarwert.
  nadeln: rollenMittel('nadeln'),
  ahorn: rollenMittel('ahorn'),
  // Wiesengras. Steht in TOENUNG_VORRANG und schlägt damit den
  // Store-Faktor [0.85, 1.0, 0.6] — die Begründung dort.
  gras: [0.46, 0.22, 0.04, 1],
  // Herbstgras: Der `-yellow`-Atlas ist mit 0.415/0.444/0.376 fast grau
  // und trägt KEINEN Faktor — ohne Tönung ist er ein schmutziger Fleck.
  // Der einzige geschätzte Wert, der übrig ist: Für „Grass_Short_01 2"
  // steht keine Zuordnung in der Materialliste, die diese Runde
  // abgedeckt hat.  → sRGB 0.41 / 0.41 / 0.26, Strohfarbe.
  grasGelb: [1.0, 0.86, 0.45, 1],
};

/**
 * Rollen, die aus freigestellten KARTEN bestehen.
 *
 * Sie brauchen `alphaMode: MASK` und `doubleSided` — und bekommen genau
 * deshalb im Client den Wind (siehe Kopfkommentar). Alles andere
 * (Rinde, Pilzhut) ist ein Körper mit deckender Textur.
 *
 * `grasBunt` und `grasSchnee` stehen hier mit drin, obwohl sie keine
 * Tönung bekommen: Karte sein und getönt werden sind zwei verschiedene
 * Fragen. Ihre Atlanten sind bereits farbig beziehungsweise absichtlich
 * hell — ein Faktor könnte darauf nur DÄMPFEN (glTF deckelt ihn auf 1),
 * und gedämpfter Schnee ist kein Gewinn, sondern Matsch.
 */
const KARTEN_ROLLEN = new Set([
  'laub',
  'laubDunkel',
  'laubSchnee',
  'nadeln',
  'ahorn',
  'gras',
  'grasGelb',
  'grasBunt',
  'grasSchnee',
]);

/**
 * Dämpfung je Rolle — der EINE Regler für „Laub zu hell", ohne die
 * Store-Faktoren einzuebnen.
 *
 * Sie multipliziert, was gewonnen hat (Store-Faktor oder Vorgabe), und
 * hält damit die Unterschiede ZWISCHEN den Materialien: `Leaves Birch 1`
 * bleibt heller als `Leaves 1`, beide werden nur gemeinsam leiser. Ein
 * einzelner Faktor auf alle Vegetation wäre der bequeme Weg gewesen und
 * hätte genau das zerstört, was die Store-Faktoren tragen.
 *
 * ── Woher die Zahl kommt (10.09.2026, Mittag) ────────────────────────
 * Gemessen in EINEM Bild (`~/.cache/wov-lab/farbe-fernblick-vorher.png`,
 * feste Rechtecke, `~/wov-lab-mess/farbe-rechtecke.py`), damit die
 * Verhaeltnisse belastbar sind — ein Luma-Vergleich ueber zwei Aufnahmen
 * hinweg waere es nicht (`design/look-referenz.md`, „Was diese Tabelle
 * NICHT sagt"):
 *
 *              Kronen   Himmel   Boden    Kronen/Himmel   Kronen/Boden
 *   unser       94.9     93.4     59.2        1.02            1.60
 *   Vorbild     48.3    142.1     57.5        0.34            0.84
 *
 * Das Vorbild (Bild 1, Busch 1280,85–1420,200; Bild 3, Himmel) hat seine
 * Kronen DUNKLER als die Wiese darunter. Bei uns standen sie 60 % darueber
 * und genau auf der Himmelsluma — die Regel „kein Laub heller als der
 * Himmel" war damit nicht knapp erfuellt, sondern gerissen.
 *
 * Und das ist zugleich die Erklaerung fuer Mikes ERSTEN Befund („die
 * Farben des Bodens passen nicht, es wirkt alles sehr braun"), der auf
 * den Boden zeigt und nicht am Boden liegt: Der Wiesengrund steht
 * gemessen auf der Referenz (Vordergrund-Ausschnitt Mittag L 64,1 · H
 * 54,4 · S 0,431 gegen Bild 1 L 52,9–61,9 · H 52–55 · S 0,42–0,46). Wenn
 * ueber diesem Grund aber Kronen mit der 1,6-fachen Luma stehen, stellt
 * sich das Auge auf DIE ein — und derselbe Grund liest sich als dunkler
 * Lehm. Das Laub leiser zu stellen hebt den Boden, ohne ihn anzufassen.
 *
 * ── Die Rechnung ─────────────────────────────────────────────────────
 * Laubkarten sind alphagetestete StandardMaterials, also Lambert: kein
 * Himmelsterm, kein additiver Anteil. Nachgerechnet aus zwei Laeufen
 * (Daempfung 1,0 und 0,6) auf denselben Bildpunkten, linear gerechnet:
 *
 *     I(t) = 0,1175 · t + (−0,003)
 *
 * Der Achsenabschnitt ist innerhalb der Messgenauigkeit NULL — anders als
 * beim Boden, wo 4 bis 13 Prozent des Bildwertes aus dem Himmelsterm
 * kommen (s. `tools/store-terrain-schichten.mjs`). Beim Laub ist die
 * Daempfung deshalb ein direkter Regler auf die Bildluma.
 *
 * Gezielt wird auf Kronen ≈ 62, also Kronen/Boden ≈ 1,05 — die Bandbreite
 * „Bild 1, Buesche/Baum L 60–70" aus Mikes Auftrag, nicht die 0,84 des
 * Vorbilds. Begruendung: Mikes Befund lautet „nicht alle, einzelne", der
 * Ausreisser (Ahorn, s. TOENUNG_VORRANG) ist getrennt behoben, und den
 * Wald in einer Runde ganz auf 0,84 zu ziehen waere ein Umfaerben und
 * keine Fehlerbehebung. `t = I(62)/0,1175 = 0,41`.
 *
 * Nachgemessen mit 0,41 am selben Rechteck: Kronen 69,7 (statt 94,9),
 * Kronen/Himmel 0,655 (statt 1,016) — das Laub steht damit klar unter
 * dem Himmel. Der Rest der Luecke zum Vorbild (0,34) ist NICHT Laub,
 * sondern der Himmel selbst; die Zahlen dazu stehen in
 * `design/look-referenz.md`, Nachtrag vom 10.09.2026.
 *
 * ── Warum alle fuenf Rollen denselben Faktor tragen ──────────────────
 * Weil der Zensus sagt, dass die Familie ZUSAMMEN zu hell steht und nicht
 * einzelne Mitglieder: ohne den Ahorn (der seinen eigenen Befund hat)
 * liegen alle Laubmaterialien zwischen 0,61 und 1,07 × Median. Ein
 * unterschiedlicher Faktor je Rolle wuerde eine Ordnung erfinden, die in
 * keiner Messung steht. Wer spaeter eine Rolle einzeln nachzieht, tut es
 * genau hier — und braucht dafuer eine Zahl, keine Meinung.
 */
/*
  ── 10.09.2026: die Dämpfung steht auf 1,0 ─────────────────────────────
  Der Faktor 0,41 war am BILD gerechnet (`t = I(62)/0,1175`) und sollte
  `Kronen/Himmel` von 1,016 auf 0,655 ziehen. Das Vorbild liefert für
  ihn keine Zahl: Seine Laubmaterialien tragen die Farben, die im Store
  stehen, und einen Dämpfungsregler kennt es nicht.

  Zurückgenommen, weil er dasselbe tut wie die Bodentönungen — eine
  Bildhelligkeit in die Albedo legen. Der Zeuge, an dem sich das
  entscheidet, bleibt `Kronen/Himmel` 0,34 aus Bild 3: Nach Licht,
  Nebel und Grading dieser Runde wird er neu gemessen. Trifft er, war
  die Dämpfung ein Symptomregler; trifft er nicht, steht der Befund
  wieder da — dann aber mit einem Bild, das sonst dem Vorbild entspricht,
  und nicht als Korrektur auf einer Korrektur.

  Die Tabelle bleibt stehen und wird nicht gelöscht: Sie ist der Ort, an
  dem eine GEMESSENE Dämpfung stünde, wenn das Vorbild je eine hergibt.
*/
const TOENUNG_DAEMPFUNG = {
  laub: [1, 1, 1],
  laubDunkel: [1, 1, 1],
  laubSchnee: [1, 1, 1],
  nadeln: [1, 1, 1],
  ahorn: [1, 1, 1],
};

/** Lineare Albedo der Bodenschicht, gegen die verglichen wird. */
const BODEN_ALBEDO_LINEAR = 0.0367;

/** sRGB-Byte → linear. */
function srgbZuLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const atlasZwischen = new Map();

// ── GLB lesen und schreiben ──────────────────────────────────────────

function glbLesen(pfad) {
  const buf = readFileSync(pfad);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${pfad}: kein GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const binStart = 20 + jsonLen + 8;
  return { json, bin: buf.subarray(binStart, binStart + binLen) };
}

/**
 * Den Binärteil auf die noch benutzten bufferViews eindampfen.
 *
 * Aufgerufen, NACHDEM die LOD-Schalen aus dem Knotenbaum gefallen sind:
 * Ihre Accessoren sind dann unerreichbar, ihre bufferViews damit tote
 * Bytes. Über den Bestand sind das rund 15 der 45 MB.
 *
 * Umgepackt wird bufferView-WEISE (s. Kopfkommentar): Jeder benutzte
 * View wandert als Ganzes, in der Reihenfolge seines alten Index, 4-Byte
 * ausgerichtet in den neuen Block. Innen ändert sich nichts — deshalb
 * bleiben `byteStride` und die Accessor-`byteOffset`s gültig, und die
 * überlebende Geometrie ist bitgleich.
 *
 * Ist nichts weggefallen, kommt der ursprüngliche Puffer unverändert
 * zurück (die Ausrichtung stimmt dann schon).
 */
function binNeuPacken(json, bin) {
  /*
    ERST die Accessoren, DANN die bufferViews.

    Ein Mesh, das aus `json.meshes` gefallen ist, nimmt seine Accessoren
    nicht mit — die stehen weiter im Array und hielten über ihren
    `bufferView` genau die Bytes am Leben, die weg sollen. Der erste
    Anlauf sparte deshalb 0,0 MiB bei 140.000 entfernten Dreiecken; das
    ist die Sorte Fehler, die man nur an einer Zahl sieht, die sich nicht
    bewegt.
  */
  const accBenutzt = new Set();
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      for (const a of Object.values(prim.attributes)) accBenutzt.add(a);
      if (prim.indices !== undefined) accBenutzt.add(prim.indices);
      for (const ziel of prim.targets ?? []) for (const a of Object.values(ziel)) accBenutzt.add(a);
    }
  }
  if (accBenutzt.size < json.accessors.length) {
    const alte = [...accBenutzt].sort((a, b) => a - b);
    const neuerIndex = new Map(alte.map((alt, i) => [alt, i]));
    json.accessors = alte.map((alt) => json.accessors[alt]);
    for (const mesh of json.meshes) {
      for (const prim of mesh.primitives) {
        for (const k of Object.keys(prim.attributes)) prim.attributes[k] = neuerIndex.get(prim.attributes[k]);
        if (prim.indices !== undefined) prim.indices = neuerIndex.get(prim.indices);
        for (const ziel of prim.targets ?? []) {
          for (const k of Object.keys(ziel)) ziel[k] = neuerIndex.get(ziel[k]);
        }
      }
    }
  }

  /*
    ZUSCHNITT INNERHALB eines bufferViews.

    77 der 94 Modelle führen ihren ganzen Bestand in ZWEI bufferViews —
    einem verschränkten für alle Vertexattribute, einem für alle Indizes.
    Ansichtsweise ausgesiebt spart das nichts: Der View bleibt benutzt,
    weil die überlebende Schale darin steht. Genau so las sich der zweite
    Anlauf, 2,8 statt der erwarteten 15 MiB.

    Geschnitten wird deshalb auch INNEN, aber nur an einem Stück: Von
    jedem View bleibt die Spanne von der ersten bis zur letzten Stelle,
    die ein überlebender Accessor anfasst. Das ist die Annahme, dass die
    Schalen im Puffer hintereinander liegen — sie stimmt in diesem
    Bestand (die Fernstufe ist ein eigenes Mesh und wurde als Ganzes
    exportiert), und wo sie nicht stimmte, bliebe schlimmstenfalls
    ungenutzter Zwischenraum stehen. Falsch wird nichts: Die Accessoren
    bekommen ihren Versatz um genau den Anfang der Spanne verringert.

    Bei einem VERSCHRÄNKTEN View muss der Anfang auf einer
    Schrittweitengrenze liegen, sonst verschöbe sich das Raster gegen die
    Daten. Liegt er das nicht, bleibt der View ungeschnitten — lieber ein
    paar Kilobyte zu viel als ein Modell, dessen Normalen aus den
    Positionen des Nachbarvertex kommen.
  */
  const spanne = new Map();
  const breiteVon = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const anzahlVon = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  for (const acc of json.accessors) {
    if (acc.bufferView === undefined) continue;
    const bv = json.bufferViews[acc.bufferView];
    const elementBytes = breiteVon[acc.componentType] * anzahlVon[acc.type];
    const von = acc.byteOffset ?? 0;
    const bis = bv.byteStride ? (acc.count - 1) * bv.byteStride + elementBytes + von : von + acc.count * elementBytes;
    const s = spanne.get(acc.bufferView);
    if (!s) spanne.set(acc.bufferView, { von, bis });
    else {
      if (von < s.von) s.von = von;
      if (bis > s.bis) s.bis = bis;
    }
  }
  const zuschnitt = new Map();
  for (const [i, s] of spanne) {
    const bv = json.bufferViews[i];
    const anfang = bv.byteStride && s.von % bv.byteStride !== 0 ? 0 : s.von;
    const laenge = Math.min(bv.byteLength, s.bis) - anfang;
    if (anfang > 0 || laenge < bv.byteLength) zuschnitt.set(i, { anfang, laenge });
  }

  const benutzt = new Set(spanne.keys());
  if (benutzt.size === json.bufferViews.length && zuschnitt.size === 0) {
    return { json, bin, gespart: 0 };
  }

  const alteViews = json.bufferViews;
  const neueViews = [];
  const umnummerierung = new Map();
  const stuecke = [];
  let offset = 0;
  // Aufsteigend nach ALTEM Index — das ist die eine Reihenfolge, die
  // nicht davon abhängt, in welcher Folge die Accessoren gelesen wurden.
  // Ohne sie wäre der zweite Lauf nicht mehr byteidentisch.
  const versatz = new Map();
  for (let i = 0; i < alteViews.length; i++) {
    if (!benutzt.has(i)) continue;
    const bv = alteViews[i];
    const z = zuschnitt.get(i) ?? { anfang: 0, laenge: bv.byteLength };
    versatz.set(i, z.anfang);
    const von = (bv.byteOffset ?? 0) + z.anfang;
    stuecke.push(bin.subarray(von, von + z.laenge));
    const neu = { ...bv, byteOffset: offset, byteLength: z.laenge };
    if (offset === 0) delete neu.byteOffset;
    umnummerierung.set(i, neueViews.length);
    neueViews.push(neu);
    offset += z.laenge;
    // glTF verlangt die Ausrichtung des grössten Komponententyps; 4 Byte
    // deckt alles ab, was hier vorkommt (float32 und uint32).
    const luecke = (4 - (offset % 4)) % 4;
    if (luecke > 0) {
      stuecke.push(Buffer.alloc(luecke));
      offset += luecke;
    }
  }
  json.bufferViews = neueViews;
  for (const acc of json.accessors) {
    if (acc.bufferView === undefined) continue;
    const ab = versatz.get(acc.bufferView) ?? 0;
    acc.bufferView = umnummerierung.get(acc.bufferView);
    if (ab > 0) {
      const neu = (acc.byteOffset ?? 0) - ab;
      if (neu > 0) acc.byteOffset = neu;
      else delete acc.byteOffset;
    }
  }
  const neu = Buffer.concat(stuecke);
  json.buffers = [{ byteLength: neu.length }];
  return { json, bin: neu, gespart: bin.length - neu.length };
}

/**
 * GLB schreiben.
 *
 * Der übergebene BIN-Block geht Byte für Byte durch (das Umpacken hat
 * `binNeuPacken` schon erledigt, falls es nötig war); nur die JSON-Länge
 * und damit der Dateikopf ändern sich hier.
 */
function glbSchreiben(pfad, json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binBuf = binPad > 0 ? Buffer.concat([bin, Buffer.alloc(binPad)]) : Buffer.from(bin);

  const kopf = Buffer.alloc(12);
  kopf.writeUInt32LE(0x46546c67, 0);
  kopf.writeUInt32LE(2, 4);
  kopf.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jsonKopf = Buffer.alloc(8);
  jsonKopf.writeUInt32LE(jsonBuf.length, 0);
  jsonKopf.writeUInt32LE(0x4e4f534a, 4);
  const binKopf = Buffer.alloc(8);
  binKopf.writeUInt32LE(binBuf.length, 0);
  binKopf.writeUInt32LE(0x004e4942, 4);

  writeFileSync(pfad, Buffer.concat([kopf, jsonKopf, jsonBuf, binKopf, binBuf]));
}

// ── Geometrie befragen ───────────────────────────────────────────────

/** Rohbytes eines Accessors — Grundlage des Fingerabdrucks. */
function accessorBytes(json, bin, index) {
  const acc = json.accessors[index];
  const bv = json.bufferViews[acc.bufferView];
  const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const komponenten = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const breite = acc.componentType === 5123 || acc.componentType === 5122 ? 2 : 4;
  return bin.subarray(start, start + acc.count * komponenten * breite);
}

const fingerabdruck = (json, bin, prim) =>
  createHash('sha1').update(accessorBytes(json, bin, prim.attributes.POSITION)).digest('hex');

const dreiecke = (json, prim) =>
  prim.indices !== undefined
    ? json.accessors[prim.indices].count / 3
    : json.accessors[prim.attributes.POSITION].count / 3;

/**
 * Vertices je Dreieck — die Kennzahl, an der Karte und Körper
 * auseinanderfallen (siehe Kopfkommentar, Schritt 2).
 */
const vertexDichte = (json, prim) =>
  json.accessors[prim.attributes.POSITION].count / dreiecke(json, prim);

/**
 * Die 4x4-Matrix eines Knotens, spaltenweise wie in glTF.
 *
 * Der Bestand nutzt ausschliesslich `translation` (und zwar 26-mal —
 * jede Laubkarte hängt versetzt über ihrem Stamm); `rotation`, `scale`
 * und `matrix` kommen in keiner der 94 Dateien vor. Sie werden trotzdem
 * gelesen, weil ein stiller Ausfall bei einem künftigen Modell teurer
 * wäre als die zwanzig Zeilen hier.
 */
function knotenMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const r = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
    2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
    2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
  const s = [sx, sx, sx, sy, sy, sy, sz, sz, sz];
  return [
    r[0] * s[0], r[1] * s[1], r[2] * s[2], 0,
    r[3] * s[3], r[4] * s[4], r[5] * s[5], 0,
    r[6] * s[6], r[7] * s[7], r[8] * s[8], 0,
    tx, ty, tz, 1,
  ];
}

const matMal = (a, b) => {
  const aus = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      aus[c * 4 + r] = s;
    }
  }
  return aus;
};

const punktMal = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const leereBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });

function boxDazu(box, p) {
  for (let i = 0; i < 3; i++) {
    if (p[i] < box.min[i]) box.min[i] = p[i];
    if (p[i] > box.max[i]) box.max[i] = p[i];
  }
}

/** Liegt `innen` in `aussen`, mit `luft` Metern Toleranz? */
const boxLiegtIn = (innen, aussen, luft) =>
  [0, 1, 2].every((i) => innen.min[i] >= aussen.min[i] - luft && innen.max[i] <= aussen.max[i] + luft);

/**
 * Hüllbox eines Teilbaums IM DATEIRAUM — mit den Knotentransformationen.
 *
 * Die Transformationen sind hier nicht optional: `tree-1e1` hat seine
 * Laubkarten 9,36 m über dem Stammfuss hängen, und ohne den Versatz
 * käme die Krone bei y = 7,49 statt bei 16,84 heraus. Die alte Fassung
 * dieser Funktion las blosse Accessor-Grenzen und lag deshalb an jedem
 * Baum daneben — unbemerkt, weil sie nur im Bericht stand.
 *
 * Der Vergleichswert steht in `design/store-konventionen.md`: dort ist
 * `vegetation-tree-1e1` mit −6,701 / −0,428 / −8,345 → 7,228 / 16,845 /
 * 5,462 nachgemessen. Genau das kommt hier heraus.
 *
 * DATEIRAUM heisst: noch nicht x-gespiegelt. Für `renderScale` (Breite
 * und Höhe) ist das gleichgültig, für eine Kiste im Weltraum nicht —
 * s. `design/store-konventionen.md` §3.4.
 */
function teilbaumBox(json, wurzel, matrix = null) {
  const box = leereBox();
  const gehe = (i, eltern) => {
    const n = json.nodes[i];
    const m = matMal(eltern, knotenMatrix(n));
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (!acc.min || !acc.max) continue;
        // Alle acht Ecken, nicht nur min/max: Unter einer Drehung ist die
        // Box der gedrehten Ecken eine andere als die gedrehte Box.
        for (let e = 0; e < 8; e++) {
          boxDazu(
            box,
            punktMal(m, [
              e & 1 ? acc.max[0] : acc.min[0],
              e & 2 ? acc.max[1] : acc.min[1],
              e & 4 ? acc.max[2] : acc.min[2],
            ])
          );
        }
      }
    }
    for (const k of n.children ?? []) gehe(k, m);
  };
  gehe(wurzel, matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return box;
}

/** Hüllbox des ganzen Modells: alle Wurzeln der Szene, gerundet. */
function huellbox(json) {
  const box = leereBox();
  for (const w of json.scenes?.[json.scene ?? 0]?.nodes ?? []) {
    const b = teilbaumBox(json, w);
    boxDazu(box, b.min);
    boxDazu(box, b.max);
  }
  return { min: box.min.map(runde), max: box.max.map(runde) };
}

/** Dreiecke eines Teilbaums. */
function teilbaumDreiecke(json, wurzel) {
  const n = json.nodes[wurzel];
  let t = 0;
  if (n.mesh !== undefined) for (const prim of json.meshes[n.mesh].primitives) t += dreiecke(json, prim);
  for (const k of n.children ?? []) t += teilbaumDreiecke(json, k);
  return t;
}

const runde = (x) => Math.round(x * 10000) / 10000;

// ── LOD-Schalen ──────────────────────────────────────────────────────

/**
 * Die Stufe, die ein Knotenname behauptet — oder null.
 *
 * Zwei Schreibweisen kommen im Bestand vor, und beide werden gelesen:
 * `Massive_Tree_1A1_LOD_1` / `SM_…_Clump_01_LOD1` (ausgeschrieben) und
 * `Tree_1E1_1` / `Pine_1B1_1` (nur die Ziffer). Die zweite ist die
 * riskante — sie träfe auch einen Knoten, der einfach so auf eine Ziffer
 * endet. Deshalb ist der Name nur die erste von drei Bedingungen; die
 * Lage und das Mass entscheiden mit (s. Kopfkommentar).
 *
 * `Tree_1E1` selbst fällt NICHT darauf herein: Nach dem letzten
 * Unterstrich steht `1E1`, und das sind keine reinen Ziffern.
 */
function lodStufe(name) {
  const m = /^(.*?)_(?:LOD_?)?(\d+)$/i.exec(name ?? '');
  if (!m) return null;
  const ausgeschrieben = /_LOD_?\d+$/i.test(name);
  return { basis: m[1], stufe: Number(m[2]), ausgeschrieben };
}

/**
 * Die überzähligen LOD-Schalen aus dem Knotenbaum nehmen.
 *
 * Gibt den Bericht zurück; das JSON wird an Ort und Stelle umgebaut
 * (Knoten und Meshes werden neu durchnummeriert, damit im Ergebnis nichts
 * Unerreichbares stehenbleibt — ein unerreichbares Mesh zählte in jeder
 * späteren Messung mit und wäre eine zweite Wahrheit).
 *
 * Die TOLERANZ, mit der die Hüllbox der Schale in der der behaltenen
 * liegen muss, ist nicht absolut, sondern hängt an der Grösse des
 * Modells — und zwar weil sie es gemessen tun muss:
 *
 *   massive-tree-1a1 (14 m hoch)   LOD_1 bleibt 0,9 cm innerhalb
 *   massive-tree-1a3 (29 m hoch)   LOD_1 reicht 2,0 cm tiefer
 *
 * Beides ist dieselbe Fernstufe derselben Baumfamilie; nur ist die eine
 * doppelt so gross. Eine feste Grenze von einem Zentimeter hätte den
 * grösseren Baum durchfallen lassen und seine Schale stehengelassen —
 * lautlos, denn ein Baum mit zu vielen Dreiecken sieht richtig aus.
 *
 * 0,2 % der längsten Kante der behaltenen Schale, mindestens 1 cm. Beim
 * 29-m-Baum sind das 6 cm, beim Grasbüschel bleibt es bei 1 cm. Ein
 * eigenständiges zweites Objekt verfehlt die Box nicht um Promille,
 * sondern um einen Gutteil seiner eigenen Grösse.
 */
const LOD_LUFT_MIN_M = 0.01;
const LOD_LUFT_ANTEIL = 0.002;

const lodLuft = (box) =>
  Math.max(LOD_LUFT_MIN_M, LOD_LUFT_ANTEIL * Math.max(...[0, 1, 2].map((i) => box.max[i] - box.min[i])));

function lodSchalenTrennen(json, datei) {
  const gefallen = [];
  const geprueft = [];
  if (LOD_BEHALTEN) return { gefallen, geprueft, aktiv: false };

  const eltern = new Map();
  json.nodes.forEach((n, i) => {
    for (const k of n.children ?? []) eltern.set(k, i);
  });
  const hatGeometrie = (i) => teilbaumDreiecke(json, i) > 0;

  /** Der Knoten mit Geometrie, unter dem `i` hängt — oder null. */
  function traegerDarueber(i) {
    for (let p = eltern.get(i); p !== undefined; p = eltern.get(p)) {
      if (json.nodes[p].mesh !== undefined) return p;
    }
    return null;
  }

  const kandidaten = [];
  json.nodes.forEach((n, i) => {
    const s = lodStufe(n.name);
    if (!s || s.stufe < 1 || !hatGeometrie(i)) return;
    // Bedingung 2 (LAGE), erster Fall: verschachtelt.
    const oben = traegerDarueber(i);
    if (oben !== null) {
      kandidaten.push({ knoten: i, stufe: s.stufe, gegen: oben, lage: 'verschachtelt' });
      return;
    }
    /*
      Zweiter Fall: ein Geschwister mit derselben Basis und kleinerer
      Stufe (so liegen die vier Grasbüschel — `…_Clump_01_LOD0` und
      `…_Clump_01_LOD1` nebeneinander unter derselben Wurzel).

      Hier muss BEIDEN Namen das Wort „LOD" ausgeschrieben anhängen, und
      das ist keine Pedanterie: Nebeneinander liegende Geschwister sind im
      Bestand normalerweise TEILE eines Modells, keine Stufen — 24 Modelle
      führen `SubMesh_0` neben `SubMesh_1` (Stamm neben Krone). Nach der
      blossen Ziffer beurteilt wäre `SubMesh_1` eine Fernstufe von
      `SubMesh_0`, und dann hinge die Krone allein am Mass-Zeugen. Sie
      besteht ihn heute (die Krone ragt über den Stamm hinaus), aber bei
      einem Baum mit enger Krone bestünde sie ihn nicht, und dann fiele
      lautlos das Laub weg.

      `_LOD0`/`_LOD1` nebeneinander ist dagegen Unitys LODGroup-Schreibweise
      und keine Nummerierung von Teilen. Für den verschachtelten Fall
      oben bleibt die blosse Ziffer erlaubt — dort ist die LAGE (ein
      Knoten hängt IM anderen) schon ein Argument, das Teile nicht
      liefern.
    */
    const p = eltern.get(i);
    const geschwister = p === undefined ? (json.scenes?.[json.scene ?? 0]?.nodes ?? []) : (json.nodes[p].children ?? []);
    if (s.ausgeschrieben) {
      for (const g of geschwister) {
        if (g === i) continue;
        const gs = lodStufe(json.nodes[g].name);
        if (gs?.ausgeschrieben && gs.basis === s.basis && gs.stufe < s.stufe && hatGeometrie(g)) {
          kandidaten.push({ knoten: i, stufe: s.stufe, gegen: g, lage: 'Geschwister', nurName: true });
          return;
        }
      }
    }
    geprueft.push({ knoten: n.name, stufe: s.stufe, behalten: 'keine Schale darüber oder daneben' });
  });

  const fallen = new Set();
  for (const k of kandidaten) {
    const meins = teilbaumDreiecke(json, k.knoten);
    // Die Bezugsgrösse ist die behaltene Schale OHNE die Kandidaten
    // darunter — sonst verglichen sich bei einer dreistufigen Kette
    // (tree-1e1) Stufe 1 und Stufe 2 gegen die Summe aller drei.
    // BEIDE Boxen im DATEIRAUM, nicht je im eigenen Knotenraum: Die
    // behaltene Schale hängt bei den Geschwisterfällen unter einer
    // anderen Kette als die Kandidatin, und ein Vergleich zweier Boxen
    // aus verschiedenen Räumen ist keiner.
    const gegenBox = teilbaumBoxOhne(json, k.gegen, new Set([k.knoten]), kette(json, eltern, k.gegen));
    const gegenTris = teilbaumDreieckeOhne(json, k.gegen, new Set([k.knoten]));
    const meineBox = teilbaumBox(json, k.knoten, kette(json, eltern, k.knoten));
    const kleiner = meins < gegenTris;
    /*
      Der Mass-Zeuge — mit einer Ausnahme, die benannt sein will:
      Tragen BEIDE Knoten das Wort „LOD" ausgeschrieben und dieselbe
      Basis (`nurName`), dann hat der Exporteur die Stufenfolge selbst
      erklärt, und die Hüllbox darf abweichen. Sie tut es auch: Die
      Fernstufe des Grasbüschels ist in z sechs Zentimeter WEITER als die
      Nahstufe (LOD0 −0,37…0,54, LOD1 −0,43…0,57) — eine dezimierte Karte
      steht eben anders. Ohne diese Ausnahme bliebe an jedem Grasbüschel
      eine zweite Karte stehen; mit ihr bleibt der strenge Zeuge dort, wo
      der Name allein nichts beweist.
    */
    const drin = k.nurName || boxLiegtIn(meineBox, gegenBox, lodLuft(gegenBox));
    if (kleiner && drin) {
      fallen.add(k.knoten);
      gefallen.push({
        knoten: json.nodes[k.knoten].name,
        stufe: k.stufe,
        lage: k.lage,
        unter: json.nodes[k.gegen].name,
        dreiecke: meins,
        gegenDreiecke: gegenTris,
      });
    } else {
      geprueft.push({
        knoten: json.nodes[k.knoten].name,
        stufe: k.stufe,
        behalten: !kleiner
          ? `nicht kleiner (${meins} gegen ${gegenTris} Dreiecke)`
          : 'Hüllbox liegt nicht in der behaltenen Schale',
      });
    }
  }

  if (fallen.size > 0) knotenbaumNeu(json, fallen, datei);
  return { gefallen, geprueft, aktiv: true };
}

/** Die Weltmatrix eines Knotens im Dateiraum (Kette von der Szenenwurzel). */
function kette(json, eltern, i) {
  const weg = [];
  for (let p = eltern.get(i); p !== undefined; p = eltern.get(p)) weg.unshift(p);
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const p of weg) m = matMal(m, knotenMatrix(json.nodes[p]));
  return m;
}

function teilbaumDreieckeOhne(json, wurzel, aus) {
  if (aus.has(wurzel)) return 0;
  const n = json.nodes[wurzel];
  let t = 0;
  if (n.mesh !== undefined) for (const prim of json.meshes[n.mesh].primitives) t += dreiecke(json, prim);
  for (const k of n.children ?? []) t += teilbaumDreieckeOhne(json, k, aus);
  return t;
}

function teilbaumBoxOhne(json, wurzel, aus, start = null) {
  const box = leereBox();
  const gehe = (i, m0) => {
    if (aus.has(i)) return;
    const n = json.nodes[i];
    const m = matMal(m0, knotenMatrix(n));
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (!acc.min || !acc.max) continue;
        for (let e = 0; e < 8; e++) {
          boxDazu(box, punktMal(m, [
            e & 1 ? acc.max[0] : acc.min[0],
            e & 2 ? acc.max[1] : acc.min[1],
            e & 4 ? acc.max[2] : acc.min[2],
          ]));
        }
      }
    }
    for (const k of n.children ?? []) gehe(k, m);
  };
  gehe(wurzel, start ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return box;
}

/**
 * Knoten und Meshes neu aufbauen, ohne die gefallenen Teilbäume.
 *
 * Erst wird gesammelt, was von den Szenenwurzeln aus noch erreichbar ist,
 * dann werden `nodes` und `meshes` in AUFSTEIGENDER alter Reihenfolge neu
 * geschrieben. Die Reihenfolge ist der Grund, warum der zweite Lauf
 * byteidentisch bleibt.
 *
 * Wirft, wenn eine Datei dabei ihre ganze Geometrie verlöre — das wäre
 * kein Sparen mehr, sondern ein Löschen, und `massive-tree-1a1-lod-1.glb`
 * (die Fernstufe als eigene Datei) ist genau der Fall, an dem das
 * auffallen müsste.
 */
function knotenbaumNeu(json, fallen, datei) {
  const behalten = [];
  const gesehen = new Set();
  const sammle = (i) => {
    if (fallen.has(i) || gesehen.has(i)) return;
    gesehen.add(i);
    behalten.push(i);
    for (const k of json.nodes[i].children ?? []) sammle(k);
  };
  for (const w of json.scenes?.[json.scene ?? 0]?.nodes ?? []) sammle(w);
  behalten.sort((a, b) => a - b);

  const neuerKnoten = new Map(behalten.map((alt, i) => [alt, i]));
  const alteMeshes = [...new Set(behalten.map((i) => json.nodes[i].mesh).filter((m) => m !== undefined))].sort(
    (a, b) => a - b
  );
  if (alteMeshes.length === 0) {
    throw new Error(`${datei}: LOD-Trennung liesse das Modell ohne jede Geometrie zurück`);
  }
  const neuesMesh = new Map(alteMeshes.map((alt, i) => [alt, i]));

  json.nodes = behalten.map((alt) => {
    const n = { ...json.nodes[alt] };
    if (n.mesh !== undefined) n.mesh = neuesMesh.get(n.mesh);
    const kinder = (n.children ?? []).filter((k) => neuerKnoten.has(k)).map((k) => neuerKnoten.get(k));
    if (kinder.length > 0) n.children = kinder;
    else delete n.children;
    return n;
  });
  json.meshes = alteMeshes.map((alt) => json.meshes[alt]);
  json.scenes = (json.scenes ?? []).map((s) => ({
    ...s,
    nodes: (s.nodes ?? []).filter((k) => neuerKnoten.has(k)).map((k) => neuerKnoten.get(k)),
  }));
}

// ── Rollen ───────────────────────────────────────────────────────────

/**
 * Welche Rolle spielt dieses Material?
 *
 * Gefragt wird die DATEI, nicht eine Namensliste: das Bild, auf das das
 * Material zeigt, und sein Alphamodus. Der Materialname geht nur dort
 * ein, wo die Datei zwei Dinge nicht unterscheiden kann — die drei
 * Grasvarianten hängen an drei verschiedenen Bildern, aber `… Dark` und
 * `… Snow` sind Spielarten desselben Laub-Atlas.
 */
function rolleVonMaterial(json, mat, dateiname) {
  const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
  if (ti === undefined) return null; // DefaultMaterial — wird aus der Geometrie geholt
  return bildRolle(json.images[json.textures[ti].source].uri, mat.name, dateiname);
}

/** Rolle aus einer Bild-URI. Die einzige Stelle, die Dateinamen liest. */
function bildRolle(uri, matName, dateiname) {
  if (uri === BILD.laub) return laubRolle(matName, dateiname);
  if (uri === BILD.rindeEiche || uri === BILD.rindeNadel || uri === BILD.rindeBirke) return 'rinde';
  if (uri.includes('grass-short-clump-snow')) return 'grasSchnee';
  if (uri.includes('grass-short-clump-yellow')) return 'grasGelb';
  if (uri.includes('grass-short-clump-redblue')) return 'grasBunt';
  if (uri.includes('grass-short-clump')) return 'gras';
  if (uri.includes('pine-1b1-0-1') || uri.includes('pine-1b1-1')) return 'nadeln';
  if (uri.includes('tree-1e1-1')) return 'ahorn';
  if (uri.includes('mushrooms')) return 'pilz';
  throw new Error(`${dateiname}: unbekanntes Bild ${uri}`);
}

/**
 * Laub, dunkles Laub oder Schneelaub?
 *
 * Der Dateiname entscheidet mit, und zwar bewusst VOR dem Materialnamen:
 * In `massive-tree-1a1-1-dark.glb` heisst das Kronenmaterial schlicht
 * `DefaultMaterial`, die Variante steckt allein im Dateinamen. Umgekehrt
 * gibt es kein Modell, das eine helle und eine dunkle Krone zugleich
 * trüge — der Dateiname ist also nie zu grob.
 */
function laubRolle(matName, dateiname) {
  if (/-snow(\.|$)/.test(dateiname) || /snow/i.test(matName)) return 'laubSchnee';
  if (/-dark(\.|$)/.test(dateiname) || /dark/i.test(matName)) return 'laubDunkel';
  return 'laub';
}

// ── Hauptlauf ────────────────────────────────────────────────────────

const dateien = readdirSync(QUELLE)
  .filter((d) => d.endsWith('.glb'))
  .sort();
if (dateien.length === 0) throw new Error(`${QUELLE}: keine GLB gefunden`);

/*
  Vorlauf: der Zwillingsindex.

  Er MUSS über alle Dateien laufen, bevor die erste geschrieben wird —
  `massive-tree-1a1.glb` kommt alphabetisch vor `massive-tree-1a1-1-dark.glb`,
  und genau dort steht das Material, das ihm fehlt.
*/
const zwilling = new Map(); // Fingerabdruck → { uri, mat }
const modelle = new Map(); // Dateiname → { json, bin }
for (const datei of dateien) {
  const { json, bin } = glbLesen(join(QUELLE, datei));
  modelle.set(datei, { json, bin });
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const mat = json.materials[prim.material];
      const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
      if (ti === undefined) continue;
      const abdruck = fingerabdruck(json, bin, prim);
      if (!zwilling.has(abdruck)) {
        zwilling.set(abdruck, { uri: json.images[json.textures[ti].source].uri, mat: mat.name });
      }
    }
  }
}

if (!NUR_PRUEFEN) {
  // Der Zielordner wird JEDES MAL neu aufgebaut. Ein Modell, das aus dem
  // Store verschwindet, bliebe sonst als Leiche liegen — und die Leiche
  // hat einen Prefab-Eintrag, also auch einen Streueintrag.
  rmSync(ZIEL, { recursive: true, force: true });
  mkdirSync(join(ZIEL, 'textures'), { recursive: true });
  for (const bild of readdirSync(join(QUELLE, 'textures')).sort()) {
    copyFileSync(join(QUELLE, 'textures', bild), join(ZIEL, 'textures', bild));
  }
}

const bericht = {
  erzeugtVon: 'tools/store-vegetation-aufbereiten.mjs',
  lodSchalenEntfernt: !LOD_BEHALTEN,
  modelle: {},
};
let ausGeometrie = 0;
let ausZwilling = 0;
/** Modell → { Materialname → Name des Originalmaterials }. */
const vorbildJeModell = {};
/** Kartenmaterialien ohne Vorbild — im Bericht, damit sie auffallen. */
const ohneVorbild = new Set();

for (const datei of dateien) {
  const { json, bin } = modelle.get(datei);
  const vorher = json.materials.map((m) => m.name);

  // ── Schritt 0: die überzähligen LOD-Schalen ───────────────────────
  //
  // VOR der Materialrunde, damit die Schalen nicht mitgezählt und nicht
  // mitgetönt werden. NACH dem Zwillingsindex oben — der ist über die
  // unveränderten Dateien gebaut, und die Schalen tragen dort teils das
  // Material, das ihrer LOD0-Schwester fehlt (`Massive_Tree_1A1_LOD_1`
  // heisst `Oak_Bark_A 2 Dark`, ihre LOD0 heisst `DefaultMaterial`).
  // Erst trennen, dann den Index bauen, hiesse die Auskunft wegwerfen,
  // wegen der es den Index gibt.
  const dreieckeVorher = json.meshes.reduce(
    (s, m) => s + m.primitives.reduce((t, p) => t + dreiecke(json, p), 0),
    0
  );
  const huellboxVorher = huellbox(json);
  const lod = lodSchalenTrennen(json, datei);

  // ── Schritt 1: jedem Primitiv eine Rolle geben ────────────────────
  const rolleJePrim = [];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const mat = json.materials[prim.material];
      let rolle = rolleVonMaterial(json, mat, datei);
      let quelle = 'Datei';
      // Der Name des QUELLmaterials — der Schlüssel in
      // `UNITY_JE_MATERIAL`. Bei `DefaultMaterial` ist er verloren; dann
      // gilt der des Zwillings, der auch schon die Rolle liefert.
      let quellMat = mat.name ?? '';
      if (rolle === null) {
        const gefunden = zwilling.get(fingerabdruck(json, bin, prim));
        if (gefunden) {
          // Der Zwilling nennt das Bild; die Rolle folgt daraus. Der
          // Materialname kommt MIT, weil `-dark`/`-snow` sonst verloren
          // ginge — der Dateiname des Zwillings ist ein anderer.
          rolle = bildRolle(gefunden.uri, gefunden.mat, datei);
          quellMat = gefunden.mat;
          quelle = `Zwilling (${gefunden.mat})`;
          ausZwilling++;
        } else {
          // Kein Zwilling: die Bauart entscheidet (Vertices je Dreieck).
          const karte = vertexDichte(json, prim) === 2;
          rolle = karte ? laubRolle('', datei) : 'rinde';
          quelle = karte ? 'Bauart: Laubkarte (2,00 V/Dreieck)' : 'Bauart: Körper (< 2,00 V/Dreieck)';
          ausGeometrie++;
        }
      }
      rolleJePrim.push({ prim, rolle, quelle, quellMat, tris: dreiecke(json, prim) });
    }
  }

  // ── Schritt 2: je Rolle, Bild UND Tönung ein Material bauen ───────
  //
  // Das ist die Zusammenlegung. Zwei Materialien, die sich Rolle, Bild
  // und Faktor teilen, sind dasselbe Material — sie zu trennen kostete
  // einen Thin-Instance-Master und brächte nichts.
  //
  // Der FAKTOR gehört in den Schlüssel und nicht bloss die Rolle: Genau
  // ein Modell des Stores (`small-thin-tree-1a5`) führt zwei Laubkarten
  // in zwei Grüntönen (`Leaves Birch 1` 0.55/1.00/0.24 neben `Leaves 2`
  // 0.46/0.95/0.20). Nach Rolle allein zusammengelegt verlöre eines von
  // beiden seine Store-Farbe — lautlos, denn getönt wäre es ja.
  const neueMaterialien = [];
  const indexJeSchluessel = new Map();
  // Materialindex → Name des Originalmaterials (oder null). Wird in
  // Schritt 3 auf den MATERIALNAMEN umgeschlüsselt — den Index sieht der
  // Client nicht, den Namen schon.
  const vorbildJeIndex = new Map();
  for (const eintrag of rolleJePrim) {
    const altMaterial = json.materials[eintrag.prim.material];
    const altBild = bildDesMaterials(json, altMaterial);
    const uri = altBild ?? standardBild(eintrag.rolle);
    const ausStore = quellFaktor(altMaterial);
    /*
      Die gemessene Farbe des VORBILDS schlägt alles andere — sie ist die
      einzige Zahl in dieser Kette, die aus dem Vorbild stammt und nicht
      vom Asset-Hersteller (Store) oder aus einer Rollenvorgabe. Der
      Schlüssel ist der Name des QUELLmaterials, nicht die Rolle; die
      Begründung steht bei `UNITY_JE_MATERIAL`.
    */
    const gemessen = UNITY_JE_MATERIAL[eintrag.quellMat] ?? null;
    // TOENUNG_VORRANG schlägt den Store-Faktor — siehe dort.
    const vorrang = TOENUNG_VORRANG.has(eintrag.rolle)
      ? (TOENUNG_VORGABE[eintrag.rolle] ?? null)
      : null;
    const gewaehlt = gemessen ?? vorrang ?? ausStore ?? TOENUNG_VORGABE[eintrag.rolle] ?? null;
    // Die Dämpfung (s. TOENUNG_DAEMPFUNG) multipliziert, was gewonnen
    // hat — sie ERSETZT nichts. Alpha (Index 3) bleibt unangetastet: es
    // ist keine Farbe, und ein gedämpftes Alpha wäre ein halbdurch-
    // sichtiges Blatt.
    const daempfung = TOENUNG_DAEMPFUNG[eintrag.rolle] ?? null;
    const toenung = gewaehlt && daempfung
      ? gewaehlt.map((v, i) => (i < 3 ? +(v * daempfung[i]).toFixed(4) : v))
      : gewaehlt;
    eintrag.toenungQuelle =
      (gemessen ? 'Vorbild' : vorrang ? 'Vorrang' : ausStore ? 'Store' : gewaehlt ? 'Vorgabe' : 'ohne')
      + (daempfung ? '+D' : '');
    // Was der Store gesagt HÄTTE — der Zeuge für die Wirkung dieser
    // Tabelle. Ohne ihn steht im Bericht nur das Ergebnis, und niemand
    // sieht mehr, um wie viel die Messung den Herstellerwert verschiebt.
    eintrag.toenungVorher = ausStore ?? null;
    /*
      WELCHES Originalmaterial hinter diesem Material steht — die einzige
      Auskunft, die der Client braucht und aus der GLB nicht bekommt.

      glTF kann nur den einen Faktor, und der ist das Mittel aus zwei
      Farben. Der Verlauf dazwischen (`client/src/engine/LaubSpitzen.ts`)
      braucht beide, also braucht er den NAMEN des Quellmaterials — und
      der ist beim Zusammenlegen weg. Er wandert deshalb in
      `shared/src/laubVorbilder.ts`, Modell für Modell.

      Eingetragen wird NUR, wenn der Faktor auch wirklich vom Vorbild
      kommt:
        • `gemessen`  — das Quellmaterial steht in der Tabelle.
        • `Vorgabe`/`Vorrang` — die Rolle hat ein Vorbild (die
          wiederhergestellten Kronen, der Ahorn).
      Hat dagegen der STORE-Faktor gewonnen, trägt das Material die Farbe
      des Asset-Herstellers; der Verlauf des Vorbilds gehörte dann nicht
      dazu und würde die Farbe verschieben statt sie aufzufächern.

      Und nur bei neutraler Dämpfung: Ein `TOENUNG_DAEMPFUNG` ungleich
      1 verschöbe den geschriebenen Faktor gegen die Tabelle, und der
      Client rechnete mit ungedämpften Farben weiter. Lieber kein
      Verlauf als ein widersprüchlicher.
    */
    const neutral = !daempfung || daempfung.every((v) => v === 1);
    const vorbildName = gemessen
      ? eintrag.quellMat
      : ausStore && !vorrang
        ? null
        : (VORBILD_JE_ROLLE[eintrag.rolle] ?? null);
    const vorbild = neutral && vorbildName && LAUB_SPITZEN[vorbildName]?.imLabor ? vorbildName : null;
    if (!vorbild && KARTEN_ROLLEN.has(eintrag.rolle) && !eintrag.rolle.startsWith('gras')) {
      ohneVorbild.add(`${datei}:${eintrag.rolle}:${eintrag.quellMat}`);
    }
    const schluessel = `${eintrag.rolle}|${uri}|${JSON.stringify(toenung)}`;
    if (!indexJeSchluessel.has(schluessel)) {
      indexJeSchluessel.set(schluessel, neueMaterialien.length);
      neueMaterialien.push(baueMaterial(eintrag.rolle, uri, toenung, neueMaterialien));
      vorbildJeIndex.set(indexJeSchluessel.get(schluessel), vorbild);
    }
    eintrag.neuerIndex = indexJeSchluessel.get(schluessel);
    eintrag.toenung = toenung;
    eintrag.uri = uri;
  }

  // ── Schritt 3: Bilder, Texturen, Materialien neu setzen ───────────
  const uris = [...new Set(neueMaterialien.map((m) => m.uri))].sort();
  json.images = uris.map((uri) => ({ uri, name: uri.split('/').pop().replace(/\.png$/, '') }));
  json.textures = uris.map((_, i) => ({ source: i }));
  json.materials = neueMaterialien.map((m) => m.material);
  for (const [i, m] of neueMaterialien.entries()) {
    json.materials[i].pbrMetallicRoughness.baseColorTexture = { index: uris.indexOf(m.uri) };
  }
  for (const eintrag of rolleJePrim) eintrag.prim.material = eintrag.neuerIndex;

  // Das Vorbild vom Index auf den NAMEN umschlüsseln — erst hier steht
  // er fest (`materialName` hängt zwei gleiche auseinander).
  const vorbilder = {};
  for (const [i, m] of neueMaterialien.entries()) {
    const v = vorbildJeIndex.get(i);
    if (v) vorbilder[m.material.name] = v;
  }
  if (Object.keys(vorbilder).length > 0) vorbildJeModell[datei.replace(/\.glb$/, '')] = vorbilder;

  pruefeIndizes(json, datei);

  const gepackt = binNeuPacken(json, bin);
  if (!NUR_PRUEFEN) glbSchreiben(join(ZIEL, datei), json, gepackt.bin);

  const huellboxNachher = huellbox(json);
  bericht.modelle[datei.replace(/\.glb$/, '')] = {
    materialienVorher: vorher,
    materialienNachher: json.materials.map((m) => m.name),
    masterNachher: json.materials.length,
    dreiecke: rolleJePrim.reduce((s, e) => s + e.tris, 0),
    /*
      Der LOD-Block ist die BEGRÜNDUNG, nicht nur die Zahl: Er nennt jeden
      gefallenen Knoten mit seiner Stufe, seiner Lage und der Schale, gegen
      die er gemessen wurde — und unter `lod.geprueft` auch jeden Knoten,
      der wie eine Schale HIESS und trotzdem stehenblieb. Ohne die zweite
      Liste sähe ein Fehlurteil aus wie ein Modell, das eben keine
      Fernstufe hatte.
    */
    lod: {
      dreieckeVorher,
      dreieckeNachher: rolleJePrim.reduce((s, e) => s + e.tris, 0),
      gefallen: lod.gefallen,
      geprueft: lod.geprueft,
      binGespartBytes: gepackt.gespart,
    },
    huellboxVorher,
    huellbox: huellboxNachher,
    /*
      Hat das Abtragen der Schalen die Hüllbox verändert? Fast nie — eine
      Fernstufe hat dieselbe Silhouette. Aber „fast nie" ist keine Zusage,
      und `renderScale` hängt daran: `tools/store-prefabs.mjs` nimmt genau
      diese Box, sobald eine aufbereitete Datei existiert.
    */
    huellboxGleich:
      JSON.stringify(huellboxVorher) === JSON.stringify(huellboxNachher),
    primitive: rolleJePrim.map((e) => ({
      dreiecke: e.tris,
      rolle: e.rolle,
      herkunft: e.quelle,
      // Der Name des Quellmaterials — der Schlüssel, über den
      // `UNITY_JE_MATERIAL` greift. Ohne ihn sieht man im Bericht
      // nicht, WARUM eine Zeile „Vorbild" sagt und die daneben nicht.
      quellMaterial: e.quellMat || null,
      // Die WIRKLICH gesetzte Tönung, nicht die Tabellenzeile: Seit der
      // Store-Faktor Vorrang hat, unterscheiden sich zwei Primitive
      // derselben Rolle, und der Bericht muss das zeigen können.
      toenung: e.toenung ?? null,
      toenungAus: e.toenungQuelle,
      // Was der Store gesagt hätte. Steht daneben, damit die Wirkung
      // der Messung als Zahl im Bericht landet und nicht nur im Bild.
      toenungStore: e.toenungVorher,
      ...albedoZeile(e),
    })),
  };
}

/**
 * Der ZENSUS: Wie hell ist dieses Primitiv am Bildschirm, bevor Licht
 * darauf fällt?
 *
 * ── Warum das im Bericht stehen muss ─────────────────────────────────
 * „Kronen zu hell" ist keine Zahl, und ein Faktor ohne Zahl ist ein
 * Geschmack. Die Zahl, um die es geht, ist die ALBEDO: der Mittelwert
 * des Atlas über die DECKENDEN Texel (Alpha ≥ 128; ein durchsichtiges
 * Texel ist kein Blatt), linear gerechnet, MAL dem `baseColorFactor`
 * des Materials. Genau dieses Produkt geht in den Lambert-Term des
 * Clients — beim Laub ohne Himmelsterm und ohne additiven Anteil
 * (gemessen: Achsenabschnitt 0,000 ± 0,003, s. `TOENUNG_DAEMPFUNG`).
 *
 * Bis zum 11.09.2026 ist dieser Zensus von Hand gerechnet worden, und
 * seine Ergebnisse stehen als Tabelle in einem Kommentar (oben, bei
 * `TOENUNG_VORRANG`). Eine Tabelle in einem Kommentar altert ohne
 * Vorwarnung; jetzt rechnet ihn der Lauf und schreibt ihn mit.
 *
 * ── Der Bezugswert ───────────────────────────────────────────────────
 * Der BODEN. Das Vorbild hat seine Kronen DUNKLER als die Wiese darunter
 * (48,3 gegen 61,8 Bildluma, `design/look-referenz.md`); bei uns stehen
 * sie darüber. Die lineare Albedo der Bodenschichten liegt bei 0,0366
 * (`grass-a`) und 0,0367 (`moss`) — gemessen an denselben Zeilen, die
 * `tools/store-terrain-schichten.mjs` in den Stapel schreibt. Der
 * Bericht führt `xBoden` deshalb je Primitiv mit: Wer 4 sagt, ist
 * viermal so hell wie der Grund, auf dem er steht.
 *
 * Albedo census per primitive: atlas mean over opaque texels (linear)
 * times the base colour factor, plus the ratio against the terrain's
 * ground albedo.
 */
/**
 * Lineare Luma eines Atlas über seine deckenden Texel.
 *
 * Gelesen wird aus der QUELLE und nicht aus dem Ziel: Der Aufbereiter
 * kopiert die Bilder unverändert, und im Prüflauf (`--nur-pruefen`)
 * existiert das Ziel gar nicht.
 */
function atlasLuma(uri) {
  if (atlasZwischen.has(uri)) return atlasZwischen.get(uri);
  let wert = null;
  try {
    const bild = decodePng(join(QUELLE, uri));
    const { data, ch } = bild;
    let n = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let i = 0; i < data.length; i += ch) {
      if (ch === 4 && data[i + 3] < 128) continue;
      n++;
      sr += srgbZuLinear(data[i]);
      sg += srgbZuLinear(data[ch > 2 ? i + 1 : i]);
      sb += srgbZuLinear(data[ch > 2 ? i + 2 : i]);
    }
    wert = n === 0
      ? null
      : {
          deckendAnteil: +(n / (bild.w * bild.h)).toFixed(4),
          linear: +(0.2126 * (sr / n) + 0.7152 * (sg / n) + 0.0722 * (sb / n)).toFixed(5),
        };
  } catch {
    // Ein fehlender Atlas ist kein Grund, den Lauf abzubrechen — die
    // Zeile bleibt dann im Bericht leer, und das sieht man ihr an.
    wert = null;
  }
  atlasZwischen.set(uri, wert);
  return wert;
}

/** Die Zensuszeile eines Primitivs. */
function albedoZeile(e) {
  const atlas = e.uri ? atlasLuma(e.uri) : null;
  if (!atlas) return { atlas: null, faktorLuma: null, albedo: null, xBoden: null };
  const t = e.toenung;
  const faktorLuma = t ? 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2] : 1;
  const albedo = atlas.linear * faktorLuma;
  return {
    atlas: { bild: e.uri.split('/').pop(), ...atlas },
    faktorLuma: +faktorLuma.toFixed(4),
    albedo: +albedo.toFixed(5),
    xBoden: +(albedo / BODEN_ALBEDO_LINEAR).toFixed(2),
  };
}

/** Bild-URI eines Materials, oder null bei DefaultMaterial. */
function bildDesMaterials(json, mat) {
  const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
  return ti === undefined ? null : json.images[json.textures[ti].source].uri;
}

/** Das Bild, das eine Rolle bekommt, wenn das Material keines mitbringt. */
function standardBild(rolle) {
  if (rolle === 'rinde') return BILD.rindeEiche;
  if (rolle.startsWith('laub')) return BILD.laub;
  throw new Error(`Rolle ${rolle} ohne Bild`);
}

/**
 * Ein Material für eine Rolle.
 *
 * `doubleSided` und `alphaMode: MASK` gehören zusammen und sind bei Laub
 * nicht verhandelbar: Eine Blattkarte ohne Alphatest ist ein Rechteck,
 * eine ohne Zweiseitigkeit verschwindet von hinten. Beides ist zugleich
 * die Bedingung, unter der `AssetManager` den Wind anhängt.
 */
function baueMaterial(rolle, uri, toenung, schon) {
  const karte = KARTEN_ROLLEN.has(rolle);
  const material = {
    name: materialName(rolle, uri, schon),
    pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
    doubleSided: karte,
  };
  if (karte) {
    material.alphaMode = 'MASK';
    material.alphaCutoff = 0.5;
  }
  if (toenung) material.pbrMetallicRoughness.baseColorFactor = [...toenung];
  return { material, uri };
}

/**
 * Der Name des zusammengelegten Materials.
 *
 * Rolle plus Atlas, denn `rinde` allein ist nicht eindeutig: 13 Modelle
 * führen ZWEI Rindenatlanten (Eiche für den Hauptstamm, Nadelholz für die
 * abgebrochenen Nebenstämme). Zwei gleichnamige Materialien in einer
 * Datei sind kein Fehler für den Lader, aber sie machen jede Messung am
 * Material unlesbar — und `EntityManager.verschmelzeNachMaterial()`
 * berichtet über Namen.
 *
 * Kein Name enthält „bark": `AssetManager.isFoliageMaterial()` schliesst
 * genau dieses Wort aus, und ein Rindenmaterial, das den Cutout-Test
 * ohnehin nicht besteht, soll nicht zusätzlich am Namen scheitern —
 * sonst hinge die Erklärung an der falschen Stelle.
 *
 * Seit der Faktor im Zusammenlegungsschlüssel steckt, kann dieselbe
 * Rolle in EINER Datei zweimal vorkommen (zwei Grüntöne auf derselben
 * Karte, `small-thin-tree-1a5`). Die zweite bekommt `-2` angehängt,
 * damit die Namen eindeutig bleiben — `tools/test/store-vegetation.ts`
 * und `EntityManager.verschmelzeNachMaterial()` berichten über Namen,
 * und zwei gleiche wären dort nicht auseinanderzuhalten. Die Zählung
 * folgt der Reihenfolge der Primitive und ist damit so deterministisch
 * wie der Rest des Werkzeugs.
 */
function materialName(rolle, uri, schon) {
  const gleiche = schon.filter((m) => m.material.name.replace(/-\d+$/, '') === basisName(rolle, uri));
  return gleiche.length === 0 ? basisName(rolle, uri) : `${basisName(rolle, uri)}-${gleiche.length + 1}`;
}

function basisName(rolle, uri) {
  if (rolle !== 'rinde') return rolle;
  if (uri === BILD.rindeEiche) return 'rinde-eiche';
  if (uri === BILD.rindeNadel) return 'rinde-nadel';
  if (uri === BILD.rindeBirke) return 'rinde-birke';
  throw new Error(`Rinde mit unbekanntem Atlas: ${uri}`);
}

/** Nach dem Umbau muss jeder Index noch auflösen. */
function pruefeIndizes(json, datei) {
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      if (json.materials[prim.material] === undefined) {
        throw new Error(`${datei}: Primitiv zeigt auf Material ${prim.material}`);
      }
    }
  }
  for (const mat of json.materials) {
    const t = mat.pbrMetallicRoughness?.baseColorTexture?.index;
    if (t === undefined || json.textures[t] === undefined) {
      throw new Error(`${datei}: Material ${mat.name} ohne auflösbare Textur`);
    }
  }
  for (const tex of json.textures) {
    if (json.images[tex.source] === undefined) throw new Error(`${datei}: Textur ohne Bild`);
  }
}

bericht.vorbilder = vorbildJeModell;
bericht.ohneVorbild = [...ohneVorbild].sort();

if (!NUR_PRUEFEN) {
  writeFileSync(join(ZIEL, 'BERICHT.json'), `${JSON.stringify(bericht, null, 2)}\n`);
  /*
    Die erzeugte Zuordnung wird NUR beim Lauf in den Regelordner
    geschrieben. `tools/test/store-vegetation.ts` lässt dasselbe Werkzeug
    mit `--ziel` in einen Probenordner laufen und vergleicht zwei Läufe
    byteweise — ein Test, der dabei eine Quelldatei des Repos überschreibt,
    ist einer zu viel.
  */
  if (ZIEL === resolve(WURZEL, ZIEL_STANDARD)) vorbilderSchreiben();
  else console.log('\n(laubVorbilder.ts nicht geschrieben — Lauf mit --ziel)');
}

/**
 * `shared/src/laubVorbilder.ts` — die Zuordnung Modell/Material →
 * Originalmaterial, erzeugt und nicht von Hand gepflegt.
 *
 * ── Warum eine erzeugte Datei und kein Eintrag in der GLB ────────────
 * Weil Babylons glTF-Lader `extras` an Materialien nicht durchreicht
 * (geprüft in `@babylonjs/loaders/glTF/2.0/glTFLoader.js`: `extras`
 * erreicht nur registrierte Erweiterungen, `material.metadata` bleibt
 * leer). Und weil der MATERIALNAME nicht reicht: Die Zusammenlegung
 * benennt nach ROLLE (`laub`, `nadeln`), und unter `laub` liegen fünf
 * verschiedene Originalmaterialien.
 *
 * Umbenennen wäre der andere Weg gewesen und ist bewusst NICHT gewählt:
 * Die Messwerkzeuge dieser Runde erkennen Kronen am Materialnamen
 * (`~/wov-lab-mess/original-lib.mjs`, `LAUB_MAT`). Ein neuer Name hätte
 * jede Vorher-Nachher-Messung dieses Workflows still entwertet — auch
 * die der Nachbarbauer.
 *
 * Dasselbe Muster wie `shared/src/storePrefabs.ts`, das dieselbe
 * npm-Zeile erzeugt.
 */
function vorbilderSchreiben() {
  const modelle = Object.keys(vorbildJeModell).sort();
  const zeilen = modelle.map((m) => {
    const inner = Object.entries(vorbildJeModell[m])
      .sort()
      .map(([mat, v]) => `${JSON.stringify(mat)}: ${JSON.stringify(v)}`)
      .join(', ');
    return `  ${JSON.stringify(m)}: { ${inner} },`;
  });
  const kopf = `/**
 * Welches Originalmaterial hinter welchem Laubmaterial steht.
 *
 * ERZEUGT von \`tools/store-vegetation-aufbereiten.mjs\` — nicht von Hand
 * bearbeiten. Der Schlüssel ist der Dateiname des Speichermodells ohne
 * Endung, darunter der Materialname, wie ihn die aufbereitete GLB führt.
 *
 * Gebraucht wird das, weil glTF nur EINEN \`baseColorFactor\` kennt: In
 * der Datei steht das Mittel aus Ober- und Unterfarbe, den Verlauf
 * dazwischen trägt der Client auf (\`client/src/engine/LaubSpitzen.ts\`),
 * und dafür braucht er den Namen des Vorbilds. Die Farben selbst stehen
 * in \`shared/src/laubSpitzen.ts\`.
 *
 * Generated: which original material each prepared foliage material
 * came from.
 */
export const LAUB_VORBILD_JE_MODELL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
`;
  const datei = join(WURZEL, 'shared/src/laubVorbilder.ts');
  writeFileSync(datei, `${kopf}${zeilen.join('\n')}\n};\n`);
  console.log(`\nlaubVorbilder.ts: ${modelle.length} Modelle geschrieben`);
}

// ── Bericht auf der Konsole ──────────────────────────────────────────
const werte = Object.values(bericht.modelle);
const masterVerteilung = new Map();
for (const m of werte) masterVerteilung.set(m.masterNachher, (masterVerteilung.get(m.masterNachher) ?? 0) + 1);
const vorherSumme = werte.reduce((s, m) => s + m.materialienVorher.length, 0);
const nachherSumme = werte.reduce((s, m) => s + m.masterNachher, 0);

console.log(`${NUR_PRUEFEN ? 'NUR GEPRÜFT' : 'GESCHRIEBEN'} — ${dateien.length} Modelle`);
console.log(`  Quelle ${QUELLE}`);
if (!NUR_PRUEFEN) console.log(`  Ziel   ${ZIEL}`);
console.log(`\nMaterialien: ${vorherSumme} vorher → ${nachherSumme} nachher`);
console.log('Master je Modell nachher:');
for (const [n, anzahl] of [...masterVerteilung].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${n} Material${n === 1 ? ' ' : 'ien'}: ${anzahl} Modelle`);
}
console.log(`\nMaterial zurückgewonnen: ${ausZwilling} aus dem Zwilling, ${ausGeometrie} aus der Bauart`);

// ── LOD-Schalen ──────────────────────────────────────────────────────
const lodVor = werte.reduce((s, m) => s + m.lod.dreieckeVorher, 0);
const lodNach = werte.reduce((s, m) => s + m.lod.dreieckeNachher, 0);
const lodModelle = werte.filter((m) => m.lod.gefallen.length > 0).length;
const lodBytes = werte.reduce((s, m) => s + m.lod.binGespartBytes, 0);
const boxAnders = Object.entries(bericht.modelle).filter(([, m]) => !m.huellboxGleich);
console.log(
  `\nLOD-Schalen: ${LOD_BEHALTEN ? 'BEHALTEN (--lod-behalten)' : 'entfernt'} — ` +
    `${lodModelle} Modelle betroffen`
);
console.log(
  `  Dreiecke ${lodVor} → ${lodNach} (−${lodVor - lodNach}, ` +
    `${(100 * ((lodVor - lodNach) / lodVor)).toFixed(1)} %), ` +
    `Binärteil −${(lodBytes / 1048576).toFixed(1)} MiB`
);
// Die Hüllbox ist die Zusage an `tools/store-prefabs.mjs`. Ändert sie
// sich, muss man das SEHEN — nicht in einer 4000-Zeilen-JSON suchen.
console.log(
  boxAnders.length === 0
    ? '  Hüllboxen: alle unverändert'
    : `  Hüllboxen VERÄNDERT bei ${boxAnders.length} Modell(en): ${boxAnders.map(([n]) => n).join(', ')}`
);
const stehen = werte.flatMap((m) => m.lod.geprueft);
if (stehen.length > 0) {
  console.log(`  Wie eine Schale benannt, aber stehengeblieben: ${stehen.length}`);
  for (const s of stehen) console.log(`    ${s.knoten} (Stufe ${s.stufe}) — ${s.behalten}`);
}
/*
  Gezählt wird nach Rolle UND Tönung, nicht nur nach Rolle: Der ganze
  Sinn dieser Runde ist, dass eine Rolle mehrere Faktoren tragen kann —
  den des Store-Materials, wo einer da ist, und die Vorgabe aus dem
  Original-Material, wo keiner da war. Eine Zeile je Rolle verschwiege
  genau das.
*/
const rollen = new Map();
for (const m of werte) {
  for (const p of m.primitive) {
    const k = `${p.rolle}|${p.toenungAus}|${JSON.stringify(p.toenung)}`;
    rollen.set(k, (rollen.get(k) ?? 0) + 1);
  }
}
console.log('Primitive je Rolle und Tönung:');
for (const [k, n] of [...rollen].sort()) {
  const [rolle, aus, toenung] = k.split('|');
  console.log(`  ${rolle.padEnd(12)} ${String(n).padStart(3)}  ${aus.padEnd(7)} ${toenung}`);
}

/*
  Die Spitzenfarben zum Schluss, und mit BEIDEN Zahlen: wie viele
  Materialien einen Verlauf bekommen und welche keinen. Die zweite Liste
  ist die wichtigere — ein Laubmaterial ohne Vorbild bekommt im Bild
  weiterhin die flache Mischfarbe, und das sieht man ihm nicht an.
*/
const mitVerlauf = Object.values(vorbildJeModell).reduce((s, m) => s + Object.keys(m).length, 0);
const vorbildZaehler = new Map();
for (const m of Object.values(vorbildJeModell)) {
  for (const v of Object.values(m)) vorbildZaehler.set(v, (vorbildZaehler.get(v) ?? 0) + 1);
}
console.log(`\nLaub-Spitzenfarben: ${mitVerlauf} Materialien in ${Object.keys(vorbildJeModell).length} Modellen`);
for (const [v, n] of [...vorbildZaehler].sort()) console.log(`  ${v.padEnd(26)} ${String(n).padStart(3)}`);
if (ohneVorbild.size > 0) {
  console.log(`  OHNE Vorbild (flache Mischfarbe): ${ohneVorbild.size}`);
  for (const o of [...ohneVorbild].sort()) console.log(`    ${o}`);
} else {
  console.log('  ohne Vorbild: keines');
}
