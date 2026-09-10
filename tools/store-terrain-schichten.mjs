#!/usr/bin/env node
/**
 * Erzeugt: die Bodenschichten des Vorbilds als Texturstapel für den Splat.
 *
 * Liest die sechs handgemalten Bodentexturen aus `assets/store/textures/`
 * (NUR lesend — der Store liegt ausserhalb des Repos) und baut daraus die
 * zwei Stapel, die `client/src/engine/TerrainSplat.ts` sampelt:
 *
 *   assets/generiert/terrain/store_d_array.png   Farbe,  16 Zeilen à K²
 *   assets/generiert/terrain/store_n_array.png   Normale, 16 Zeilen à K²
 *   assets/generiert/terrain/store-schichten.json  die Tabelle dazu
 *
 * `assets/` ist gitignored; die Dateien entstehen neu, wenn man das
 * Werkzeug laufen lässt. Der Dev-Server liefert den ganzen Ordner unter
 * `/assets/` aus (client/vite.config.ts, `assetHandler`), der Client lädt
 * sie also unter `/assets/generiert/terrain/`.
 *
 *   node tools/store-terrain-schichten.mjs                 # 512², Vorgabe
 *   node tools/store-terrain-schichten.mjs --kante 1024
 *   node tools/store-terrain-schichten.mjs --nur-pruefen    # nur die Tabelle
 *
 * ── Warum ein 16-Zeilen-Stapel und nicht sechs eigene Texturen ───────
 * Weil der Splat genau das schon sampelt. `terrain_d_array.png` ist ein
 * 256×4096-Stapel aus 16 Kacheln, und `vbTileSample_*` rechnet die
 * Zeilennummer aus dem Tile-Index des Vertex. Wer stattdessen sechs
 * Einzeltexturen bindet, muss die Auswahl im Shader nachbauen (sechs
 * `step()`-Masken je Abtastung, wie es die alte Normal-Map-Gruppierung
 * tut) und verliert die Eigenschaft, dass Farbe und Normale garantiert
 * dieselbe Zeile treffen. Derselbe Stapel für beides heisst: EIN
 * Zeilenindex, zwei Abtastungen, kein Auseinanderlaufen möglich.
 *
 * ── Warum nicht alle 16 Zeilen aus dem Store kommen ──────────────────
 * Zwei Zeilen bleiben Altbestand, und beide aus einem Grund, den man am
 * Bild sieht:
 *
 *   7  Ash        Die Asche der AshLands hat im Store keine Entsprechung.
 *                 Die Analyse sagt für dieses Biom „rauer Fels + Asche-
 *                 Altbestand" — der rauhe Fels kommt aus dem Store
 *                 (Zeilen 5/14), die Asche bleibt, was sie war.
 *   15 LavaCrust  Das ist gar keine Farbkachel, sondern die GRAUSTUFEN-
 *                 EMISSIONSMASKE der glühenden Risse (`emisSS` im Shader
 *                 liest ihren Rotkanal). Eine Store-Textur an dieser
 *                 Stelle würde die Risse dorthin legen, wo ihr Gestein
 *                 hell ist — sichtbar falsch, ohne Fehlermeldung.
 *
 * Beide werden aus `assets/textures/terrain_d_array.png` übernommen und
 * auf die Zielkante skaliert.
 *
 * ── Die Zahlen je Schicht ────────────────────────────────────────────
 * `kachelMeter`, `normalStaerke`, `metallic` und `smoothness` sind NICHT
 * geraten. Sie stehen im `terrain`-Block der Zone `village` von
 * `content/worlds/village1.json` des Schwesterprojekts, wo sie am Bild
 * kalibriert wurden (ADR-0032). Nachgelesen am 09.09.2026:
 *
 *   terrain-gravel-path  2 m  normal 3    metallic 0.75  smooth 0.10
 *   terrain-rock-a       2 m  normal 1.5  metallic 0.85  smooth 0.10
 *   terrain-grass-a      2 m  normal 2    metallic 0.50  smooth 0
 *   terrain-gravel       2 m  normal 3    metallic 0.75  smooth 0.10
 *   terrain-rock-rough   3 m  normal 5    metallic 0     smooth 0
 *   terrain-moss         2 m  normal 1.2  metallic 0     smooth 0
 *
 * `terrain-grass-b` führt der Weltdatei keine eigene Zeile; es teilt sich
 * die Normalmap mit `grass-a` und erbt deshalb dessen Werte.
 *
 * Metallic 0,5 bis 0,85 bei Glätte 0,1 ist der Kern des Looks und
 * zugleich seine Falle: Ein Boden mit Metallic 0,85 hat fast keine
 * Eigenfarbe mehr, er zeigt den Himmel. OHNE einen Himmelsterm im Shader
 * wird er schwarz. Der Term steht in `TerrainSplat.ts` (`terrainHimmel`);
 * diese Zahlen ohne ihn zu setzen ist ein Rückschritt, kein Fortschritt.
 *
 * ── Determinismus ────────────────────────────────────────────────────
 * Zweimal laufen lassen muss byteidentische Dateien ergeben, sonst ist
 * der Ordner bei jedem Lauf „geändert" und niemand kann mehr sehen, ob
 * sich etwas geändert HAT. Dafür: fester Skalierungskern (`lanczos3`),
 * feste PNG-Einstellungen, keine Zeitstempel, und die Tabelle wird mit
 * `JSON.stringify(..., 2)` in fester Schlüsselreihenfolge geschrieben.
 * `scripts/run-tests.mjs` fährt genau das nach.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const STORE = resolve(WURZEL, 'assets/store/textures');
const ALTBESTAND = resolve(WURZEL, 'assets/textures');
const AUS = resolve(WURZEL, 'assets/generiert/terrain');

/** Zeilen des Altbestand-Stapels — 16 Kacheln à 256², oben beginnend. */
const ALT_KANTE = 256;
const ZEILEN = 16;

/**
 * Die Schichten, wie sie im Store liegen, mit den Werten aus village1.json.
 *
 * `farbe` und `normale` sind Dateinamen ohne Endung unter `STORE`.
 */
export const SCHICHTEN = {
  'gravel-path': { farbe: 'terrain-gravel-path', normale: 'terrain-gravel-normal', kachelMeter: 2, normalStaerke: 3, metallic: 0.75, smoothness: 0.1 },
  'rock-a': { farbe: 'terrain-rock-a', normale: 'terrain-rock-a-normal', kachelMeter: 2, normalStaerke: 1.5, metallic: 0.85, smoothness: 0.1 },
  'grass-a': { farbe: 'terrain-grass-a', normale: 'terrain-grass-normal', kachelMeter: 2, normalStaerke: 2, metallic: 0.5, smoothness: 0 },
  'grass-b': { farbe: 'terrain-grass-b', normale: 'terrain-grass-normal', kachelMeter: 2, normalStaerke: 2, metallic: 0.5, smoothness: 0 },
  gravel: { farbe: 'terrain-gravel', normale: 'terrain-gravel-normal', kachelMeter: 2, normalStaerke: 3, metallic: 0.75, smoothness: 0.1 },
  'rock-rough': { farbe: 'terrain-rock-rough', normale: 'terrain-rock-rough-normal', kachelMeter: 3, normalStaerke: 5, metallic: 0, smoothness: 0 },
  moss: { farbe: 'terrain-moss', normale: 'terrain-moss-normal', kachelMeter: 2, normalStaerke: 1.2, metallic: 0, smoothness: 0 },
};

/**
 * Tile-Index → Schicht. Die Reihenfolge ist die von `TILE` in
 * `client/src/engine/TerrainSplat.ts` und darf sich nicht verschieben:
 * die Indizes stehen in den Vertex-Attributen jedes Chunks.
 *
 * `toenung` multipliziert die Farbe (linear gerechnet, nicht auf den
 * sRGB-Bytes — sonst dunkelt eine Tönung von 0,6 um mehr als 40 %).
 * Sie ist der Weg, aus sechs gemalten Schichten sechzehn Untergründe zu
 * machen, ohne eine siebte zu malen: Sumpfmoos ist dasselbe Moos, nur
 * dunkler und entsättigt.
 *
 * `altbestand: true` heisst „Zeile aus terrain_d_array.png übernehmen".
 *
 * ── Die vier Zeilen des Feinabgleichs (09.09.2026) ───────────────────
 * Vier Tönungen standen bis hierher auf [1, 1, 1] — nicht weil das die
 * richtige Farbe war, sondern weil noch niemand gemessen hatte, welche
 * es ist. Die Referenzbilder aus dem Original geben sie jetzt vor; die
 * Zielzahlen stehen in `design/look-referenz.md`.
 *
 * ── Wie eine Tönung berechnet wird, und was dabei fast schiefging ────
 * Die naheliegende Rechnung ist
 *
 *       t = (Ziel_sRGB / Ist_sRGB) ^ 2.2
 *
 * — sie unterstellt, dass der Bildwert PROPORTIONAL zur Albedo ist. Das
 * ist er nicht. Gemessen am 45°-Hang (Mittag), Tönung 1,000 gegen 1,537
 * auf DENSELBEN Bildpunkten:
 *
 *       Kanal   t=1,000   t=1,537   → D (skaliert)   A (skaliert nicht)
 *       R       98,7      112,0        0,0739          0,0500  (40 %)
 *       G       99,8       98,8        0,0459          0,0811  (64 %)
 *       B       96,3       82,8        0,0757          0,0417  (36 %)
 *
 * `Bild_linear = Albedo_linear · D + A`. Vierzig bis vierundsechzig
 * Prozent des Bildwertes hängen NICHT an der Albedo — das ist der
 * Himmelsterm plus Nebel. Mit der naiven Formel hätte die
 * Cliff-Zeile 1,54 statt 2,14 bekommen und wäre bei S 0,26 statt 0,38
 * stehengeblieben; genau das ist im ersten Anlauf passiert.
 *
 * Gerechnet wird deshalb aus ZWEI Messungen je Zeile: D und A auflösen,
 * dann `t = (Ziel_linear − A) / D`. Die zweite Messung ist billig — man
 * lässt das Werkzeug einmal mit einer bekannten Probetönung laufen.
 *
 * „Ist" ist dabei kein Bildschirmeindruck, sondern die Messung JE
 * SCHICHT aus `~/wov-lab-mess/fein-mess.mjs`: Bildpunkte werden über
 * `scene.pick` ihrer Vertex-Normalen zugeordnet, aus Neigung und
 * Biom-Tile fällt die wirksame Kachel, und erst deren Bildpunkte werden
 * gemittelt. Eine Bandmessung über das halbe Bild hätte stattdessen
 * Baumkronen und Schatten mitgewogen.
 *
 * ── Die Stunde gehört zur Zahl ───────────────────────────────────────
 * Bild 1 und 2 der Referenz sind warmes Nachmittagslicht und werden
 * gegen 17 Uhr (`t=0.708333`) gehalten, Bild 3 steht in der Sonne und
 * wird gegen Mittag (`t=0.5`) gehalten. Gegen die falsche Stunde
 * kalibriert bekäme man eine Farbe, die im Bild nie eintritt.
 *
 * ── Kein Anschlag ist gefallen ───────────────────────────────────────
 * Die Tönung greift auf die Textur im Speicher, und `zuSrgb` klemmt bei
 * 255. Nachgezählt am fertigen Stapel: Zeile 0 Maximum 133, Zeile 4
 * Maximum 55, Zeile 5 Maximum 236, Zeile 11 Maximum 85 — kein einziger
 * Texel in der Klemme (`(t >= 255).sum() == 0` je Zeile).
 *
 * ── Nachtrag 10.09.2026: der Massstab ist das VERHÄLTNIS ─────────────
 * (Bauer „Farbabgleich 2", nach Mikes Sichtprüfung „die Texturen der
 * Berghänge sind zu hell".)
 *
 * Die Zielzahlen oben sind Luma-Werte AUS DEN REFERENZBILDERN, und
 * `design/look-referenz.md` sagt im selben Atemzug, dass ein Luma-
 * Vergleich über Bilder hinweg falsch ist. Der Feinabgleich hat trotzdem
 * gegen sie kalibriert — mit dem Ergebnis, dass die Cliff-Zeile ihre
 * Zielluma auf die Zehntel trifft (Mittag am 45°-Hang: 102,9 gegen
 * 104,4) und der Hang trotzdem grell aussieht. Der Grund steht in der
 * einen Zahl, die das Vorbild BINNENBILDLICH vorgibt:
 *
 *                        Hangfels/Himmel   Moos/Himmel   Hangfels/Moos
 *   Vorbild (Bild 3)          0,73            0,435          1,69
 *   unser Stand c6a3fee       1,17            0,855          1,37
 *
 * Der hellste Boden stand also HELLER als der Himmel über ihm — ein
 * Zustand, den das Vorbild nirgends zeigt. Um 17 Uhr, wo Mike gesehen
 * hat, ist es noch deutlicher: die Cliff-Zeile misst dort 133,6.
 *
 * ── Warum die Zeilen gedämpft werden und nicht nur der Himmel ────────
 * Beides. Der Himmel ist um denselben Faktor zu dunkel, in dem BEIDE
 * Bodenverhältnisse danebenliegen (1,60 und 1,97) — deshalb ist der
 * Tag-Keyframe `fogColorDay` mitgehoben worden (s.
 * `shared/src/environment.ts`). Er allein reicht aber nicht: `fogColor`
 * ist eine sRGB-Farbe mit Anschlag bei 1,0, und der Himmelsverlauf
 * dämpft den Zenit zusätzlich auf 0,45/0,55/0,80 des Horizonts. Über
 * etwa ×1,3 an der Bildluma kommt man so nicht hinaus, gebraucht wären
 * ×1,6.
 *
 * ── Die Zahl für die Cliff-Zeile: die SÄTTIGUNG ──────────────────────
 * Sie ist der belastbarste Zeuge, den diese Runde gefunden hat, weil sie
 * ohne Belichtungsvergleich auskommt. Der Tonemapper (KHR-PBR-Neutral)
 * ENTSÄTTIGT helle Werte; eine Fläche, die zu hell steht, verliert
 * darüber ihre Farbe. Gemessen am 45°-Hang mittags:
 *
 *   Tönung [2,139, 1,024, 0,373]   Luma 102,9   S 0,338
 *   Tönung × 0,6                   Luma  77,3   S 0,410
 *   Vorbild (Bild 3, Hangfels tan)              S 0,408
 *
 * Genau bei ×0,6 hört das Ausbleichen auf, und die Zeile trifft die
 * Sättigung des Vorbilds auf drei Tausendstel. Das ist die neue Zahl:
 * [1,283, 0,614, 0,224]. Der Farbton bleibt dabei stehen (33,5 → 33,6
 * gegen 30,5 im Vorbild, innerhalb der ±5°-Toleranz).
 *
 * Die Moss-Zeile folgt derselben Rechnung über `Hangfels/Moos = 1,6`
 * (Mittel der beiden Moosstreifen des Vorbilds): [0,623, 0,460, 0,473].
 *
 * ── Und die Grass-Zeile: Grün muss dominieren ────────────────────────
 * [1,378, 1,279, 1,032] hatte ROT über Grün. Auf einer Quelltextur mit
 * R ≈ G (terrain-grass-a, linear 0,0399/0,0401/0,0007) heisst das: Der
 * Wiesengrund KANN nicht grün werden. Gemessen (Mittag, ebener Blick)
 * kam er auf 62,4/62,4/40,5 heraus — Rot und Grün auf dieselbe Zehntel
 * gleich, also Khaki. Die neue Zeile [1,27, 1,35, 1,00] dreht das um
 * (G/R = 1,063) und lässt die Luma stehen (+2,3 % rechnerisch). Die
 * Referenzfarbe H 53 des Vorbilds bleibt damit knapp unterschritten —
 * absichtlich: Bild 1 ist eine Nachmittagsaufnahme, ihre Wärme steckt im
 * LICHT, und unser 17-Uhr-Licht bringt sie ohnehin mit.
 */
export const ZUORDNUNG = [
  // Der Wiesengrund. Referenz: Bild 1, die Fläche ZWISCHEN den Büscheln
  // (Luma 57,5, H 53, S 0,42).
  //
  // 10.09.2026: [1,378, 1,279, 1,032] → [1,27, 1,35, 1,00]. Nicht die
  // Helligkeit war falsch, sondern die REIHENFOLGE der Kanäle — Rot stand
  // über Grün, und die Quelltextur bringt R ≈ G mit (linear
  // 0,0399/0,0401/0,0007). Damit KANN der Grund nicht grün werden; er kam
  // im Bild als Khaki heraus (Mittag, ebener Blick: 62,4/62,4/40,5), und
  // Mikes Sichtprüfung sagte „es wirkt alles sehr braun". Jetzt ist
  // G/R = 1,063, die Luma bleibt (rechnerisch +2,3 %).
  //
  // Die Referenz H 53 wird dabei bewusst NICHT angesteuert: Bild 1 ist
  // eine Nachmittagsaufnahme, ihre Wärme steckt im LICHT und nicht in der
  // Albedo. Gemessen an unserem eigenen Halm: mittags H 61,2, um 17 Uhr
  // H 56,1 — das Vorbild steht auf H 56,0. Die Stunde bringt die Wärme
  // mit; wer sie zusätzlich in die Tönung legt, zählt sie doppelt.
  /* 0  Grass      */ { name: 'Grass', schicht: 'grass-a', toenung: [1.27, 1.35, 1] },
  /* 1  Forest     */ { name: 'Forest', schicht: 'moss', toenung: [0.88, 0.92, 0.85] },
  /* 2  Dirt       */ { name: 'Dirt', schicht: 'gravel', toenung: [1.15, 1.02, 0.85] },
  /* 3  Cleared    */ { name: 'Cleared', schicht: 'gravel-path', toenung: [0.9, 0.84, 0.74] },
  // Der dunkle Fels — und die EINZIGE Zeile, die der Feinabgleich
  // absichtlich stehengelassen hat. Die Begründung ist eine Messung, kein
  // Übersehen; sie steht hier, damit niemand sie ein zweites Mal machen
  // muss.
  //
  // ── Erstens: WO man diese Schicht misst ─────────────────────────────
  // Nicht am steilsten Hang. Am 47°-Nordhang des Schwarzwaldes zeichnet
  // die Rampe längst `RAU_TILE` = `rock-rough`; wer dort misst, misst
  // den HELLEN Fels und hält ihn für den dunklen. Genau daran ist am
  // 09.09.2026 ein erster Anlauf gescheitert: Eine Tönung an `rock-a`
  // schien die Farbe in die falsche Richtung zu ziehen — in Wahrheit sah
  // man die Wirkung der Cliff-Zeile. Der Zeuge ist deshalb eine
  // 24°-Flanke (−27060/−5500), wo `HANG_TILE[Forest] = Rock` gilt.
  //
  // ── Zweitens: die Tönung wirkt dort fast nicht ──────────────────────
  // Gegenprobe an genau diesem Zeugen, [1, 1, 1] gegen [0,95, 0,97, 1,30]
  // (also Blau +30 % linear):
  //
  //            ohne Tönung        mit Tönung
  //   17 Uhr   65,7/69,0/63,7     63,6/66,0/60,6   B−R −2,0 → −3,0
  //   Mittag   68,2/72,8/65,6     65,0/69,7/62,8   B−R −2,6 → −2,2
  //
  // Ein Blauzuschlag von 30 % auf die Albedo bewegt B−R um ein Zehntel
  // Byte in die eine und ein halbes in die andere Richtung — das ist
  // Rauschen. Der Grund steckt in Metallic 0,85: Was diese Schicht im
  // Bild ausmacht, ist der Himmelsterm, nicht ihre Eigenfarbe. Eine
  // Tönung hier ist ein Regler ohne Wirkung, und ein wirkungsloser
  // Regler mit einer Zahl darin ist schlimmer als keiner — beim nächsten
  // Mal dreht jemand daran und wundert sich.
  //
  // ── Drittens: und Metallic senken wäre die falsche Richtung ─────────
  // Metallic 0 multipliziert den diffusen Anteil mit 1/(1−0,85) = 6,7.
  // Die Schicht steht am Zeugen ohnehin schon auf Luma 65,7 (17 Uhr) und
  // 68,2 (Mittag), während die Referenz für Fels im Schatten auf 39,3
  // und für Fels im Licht auf 46,3 steht. Sie ist also nicht zu dunkel,
  // sondern eher zu HELL — heller machen löst nichts.
  //
  // Was von Mikes Befund „schwarz" bleibt: nichts Messbares. Er stammt
  // aus `boden2-hang-nachher.png`; seit Stufe „Boden 3" trägt der
  // Himmelsterm diese Schicht. Farblich ist sie mit B−R −2 bis −3 nahezu
  // neutral, also das verlangte Blaugrau und nicht das alte Braun.
  /* 4  Rock       */ { name: 'Rock', schicht: 'rock-a', toenung: [1, 1, 1] },
  // Der helle, raue Fels. Referenz: Bild 3, die tan-braunen Hangbänder
  // (Luma 104, H 30, S 0,39). Bei uns war er mittags Beton: Luma 99 bei
  // S 0,05 und H 80 — die Helligkeit stimmte fast, die FARBE fehlte
  // ganz. Die Tönung sättigt und wärmt; die Luma steigt dabei kaum
  // (99 → 109), weil Rot steigt, während Blau um denselben Betrag
  // fällt. Nachgemessen am 45°-Hang mittags: 127,6/105,9/79,5,
  // H 33, S 0,38.
  //
  // Die Zahl 2,139 ist der Grund, aus dem oben die Zwei-Punkt-Rechnung
  // steht: Aus einer einzelnen Messung wäre 1,537 gefallen, und damit
  // blieb der Hang bei S 0,26 — sichtbar zu blass.
  //
  // 10.09.2026: [2,139, 1,024, 0,373] → ×0,6 = [1,283, 0,614, 0,224].
  // Mikes Befund „die Texturen der Berghänge sind zu hell", und er hat
  // recht, obwohl die ZIELLUMA sass (Mittag 102,9 gegen 104,4): Der Hang
  // stand HELLER als der Himmel über ihm — Hangfels/Himmel 1,17 gegen
  // 0,73 im Vorbild, und um 17 Uhr misst die Zeile 133,6. Die Zahl 0,6
  // kommt nicht aus dieser Ungleichung, sondern aus der SÄTTIGUNG (s.
  // Nachtrag im Kopfkommentar): Bei ×0,6 hört das Ausbleichen durch den
  // Tonemapper auf, und die Zeile trifft S 0,410 gegen S 0,408 des
  // Vorbilds — ein Zeuge, der ohne Belichtungsvergleich auskommt.
  /* 5  Cliff      */ { name: 'Cliff', schicht: 'rock-rough', toenung: [1.283, 0.614, 0.224] },
  /* 6  LavaEmber  */ { name: 'LavaEmber', schicht: 'rock-rough', toenung: [0.55, 0.4, 0.36] },
  /* 7  Ash        */ { name: 'Ash', altbestand: true },
  /* 8  Heath      */ { name: 'Heath', schicht: 'grass-b', toenung: [1.25, 1.12, 0.9] },
  /* 9  Sand       */ { name: 'Sand', schicht: 'gravel-path', toenung: [1.05, 1.0, 0.9] },
  /* 10 SwampMud   */ { name: 'SwampMud', schicht: 'moss', toenung: [0.62, 0.6, 0.52] },
  // Die Hangkachel des Graslands (`HANG_TILE[Grass] = Moss`) — also die
  // Farbe der 15°-bis-30°-Flanken, auf denen bei uns fast die halbe
  // Insel liegt. Referenz: Bild 3, die grünen Moosstreifen am Hang
  // (H 44, S 0,39); unsere lag bei H 65 mit S 0,35, also zu kühl.
  //
  // 10.09.2026: [1,317, 0,972, 1,0] → [0,623, 0,460, 0,473]. Der Farbton
  // der Zeile bleibt unangetastet (R/G weiter 1,354), gedämpft wird
  // allein die Helligkeit — über die EINE Beziehung, die das Vorbild für
  // diese beiden Schichten GEMEINSAM angibt: `Hangfels/Moos` 1,69
  // (Bild 3, Streifen 1) beziehungsweise 1,54 (Streifen 2). Unser Stand
  // lag bei 1,37; nach der Dämpfung der Cliff-Zeile hätte er ohne diese
  // Zeile bei 1,09 gelegen — das Moos wäre fast so hell gewesen wie der
  // Fels darüber. Gezielt wird auf 1,6, das Mittel der beiden Streifen.
  /* 11 Moss       */ { name: 'Moss', schicht: 'moss', toenung: [0.623, 0.46, 0.473] },
  /* 12 Paved      */ { name: 'Paved', schicht: 'gravel-path', toenung: [1, 1, 1] },
  /* 13 SwampDark  */ { name: 'SwampDark', schicht: 'gravel', toenung: [0.75, 0.75, 0.68] },
  /* 14 Basalt     */ { name: 'Basalt', schicht: 'rock-rough', toenung: [0.55, 0.53, 0.52] },
  /* 15 LavaCrust  */ { name: 'LavaCrust', altbestand: true },
];

/**
 * Normalmap-Zeile für die zwei Altbestand-Kacheln.
 *
 * KEINE flache Normale (128,128,255) — die wäre zwar unschädlich, aber
 * sie nähme der Asche das Relief, das sie heute hat. Die beiden erben
 * stattdessen die Gruppen-Normalmap, unter der sie im Altbestand liefen
 * (`vbTileNormalGroup`: Ash → Gruppe 2, LavaCrust → Gruppe 4).
 */
const ALT_NORMALE = { 7: 'terraintile_n_1', 15: 'gouacherock_big_n' };

/** sRGB-Byte → linear. */
function zuLinear(v) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
/** linear → sRGB-Byte. */
function zuSrgb(l) {
  const c = Math.min(1, Math.max(0, l));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** 256er Nachschlagetabelle je Kanal — 3 statt 3·K² pow()-Aufrufe. */
function toenungsTabelle(faktor) {
  const t = new Uint8Array(256);
  for (let v = 0; v < 256; v++) t[v] = zuSrgb(zuLinear(v) * faktor);
  return t;
}

/** Ein RGB-Bild auf `kante`² bringen; Alpha fällt weg. */
async function laden(pfad, kante) {
  return sharp(pfad)
    .removeAlpha()
    .resize(kante, kante, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer();
}

/** Eine Zeile aus dem Altbestand-Stapel schneiden und auf `kante` bringen. */
async function altZeile(datei, zeile, kante) {
  return sharp(datei)
    .extract({ left: 0, top: zeile * ALT_KANTE, width: ALT_KANTE, height: ALT_KANTE })
    .removeAlpha()
    .resize(kante, kante, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer();
}

/** Prüft, dass jede Datei da ist, die die Tabelle verspricht. */
export function fehlendeDateien() {
  const fehlt = [];
  for (const s of Object.values(SCHICHTEN)) {
    for (const n of [s.farbe, s.normale]) {
      const p = resolve(STORE, `${n}.png`);
      if (!existsSync(p)) fehlt.push(p);
    }
  }
  if (!existsSync(resolve(ALTBESTAND, 'terrain_d_array.png'))) {
    fehlt.push(resolve(ALTBESTAND, 'terrain_d_array.png'));
  }
  for (const n of Object.values(ALT_NORMALE)) {
    const p = resolve(ALTBESTAND, `${n}.png`);
    if (!existsSync(p)) fehlt.push(p);
  }
  return fehlt;
}

/**
 * Die Tabelle, die der Client liest: je Tile-Index Herkunft und Material.
 *
 * `kachelFaktor` ist die Zahl, die im Shader steht: der Splat kachelt mit
 * `uvScale = 0.5`, also EINE Wiederholung je 2 Weltmeter. Eine Schicht mit
 * `kachelMeter: 3` braucht deshalb den Faktor 2/3.
 */
export function tabelle(kante) {
  return {
    kante,
    zeilen: ZEILEN,
    /** Weltmeter, die eine Wiederholung im Splat heute abdeckt (uvScale 0.5). */
    grundKachelMeter: 2,
    tiles: ZUORDNUNG.map((z, i) => {
      if (z.altbestand) {
        return {
          tile: i,
          name: z.name,
          quelle: 'altbestand',
          kachelMeter: 2,
          kachelFaktor: 1,
          normalStaerke: 0.7,
          metallic: 0,
          smoothness: 0.1,
        };
      }
      const s = SCHICHTEN[z.schicht];
      return {
        tile: i,
        name: z.name,
        quelle: z.schicht,
        farbe: s.farbe,
        normale: s.normale,
        toenung: z.toenung,
        kachelMeter: s.kachelMeter,
        kachelFaktor: +(2 / s.kachelMeter).toFixed(6),
        normalStaerke: s.normalStaerke,
        metallic: s.metallic,
        smoothness: s.smoothness,
      };
    }),
  };
}

async function baue(kante) {
  const fehlt = fehlendeDateien();
  if (fehlt.length) {
    console.error('[terrain-schichten] Es fehlen Dateien:\n  ' + fehlt.join('\n  '));
    process.exit(2);
  }
  mkdirSync(AUS, { recursive: true });
  const altArray = resolve(ALTBESTAND, 'terrain_d_array.png');

  const farbe = Buffer.alloc(kante * kante * ZEILEN * 3);
  const normale = Buffer.alloc(kante * kante * ZEILEN * 3);
  const zeilenBytes = kante * kante * 3;

  for (let i = 0; i < ZEILEN; i++) {
    const z = ZUORDNUNG[i];
    if (z.altbestand) {
      (await altZeile(altArray, i, kante)).copy(farbe, i * zeilenBytes);
      (await laden(resolve(ALTBESTAND, `${ALT_NORMALE[i]}.png`), kante)).copy(normale, i * zeilenBytes);
      continue;
    }
    const s = SCHICHTEN[z.schicht];
    const roh = await laden(resolve(STORE, `${s.farbe}.png`), kante);
    const [tr, tg, tb] = z.toenung.map(toenungsTabelle);
    const ziel = i * zeilenBytes;
    for (let p = 0; p < zeilenBytes; p += 3) {
      farbe[ziel + p] = tr[roh[p]];
      farbe[ziel + p + 1] = tg[roh[p + 1]];
      farbe[ziel + p + 2] = tb[roh[p + 2]];
    }
    (await laden(resolve(STORE, `${s.normale}.png`), kante)).copy(normale, ziel);
  }

  const schreiben = async (daten, datei) => {
    await sharp(daten, { raw: { width: kante, height: kante * ZEILEN, channels: 3 } })
      .png({ compressionLevel: 9, effort: 10, palette: false })
      .toFile(resolve(AUS, datei));
  };
  await schreiben(farbe, 'store_d_array.png');
  await schreiben(normale, 'store_n_array.png');
  writeFileSync(resolve(AUS, 'store-schichten.json'), JSON.stringify(tabelle(kante), null, 2) + '\n');

  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(`[terrain-schichten] ${kante}² × ${ZEILEN} Zeilen`);
  for (const d of ['store_d_array.png', 'store_n_array.png']) {
    console.log(`  ${d.padEnd(20)} ${mb(readFileSync(resolve(AUS, d)).length)} MB Datei, ` +
      `${mb(kante * kante * ZEILEN * 4)} MB roh im VRAM (ohne Mipmaps)`);
  }
  console.log(`  Ausgabe: ${AUS}`);
}

if (process.argv[1] && process.argv[1].endsWith('store-terrain-schichten.mjs')) {
  const i = process.argv.indexOf('--kante');
  const kante = i >= 0 ? Number(process.argv[i + 1]) : 512;
  if (![256, 512, 1024, 2048].includes(kante)) {
    console.error('[terrain-schichten] --kante muss 256, 512, 1024 oder 2048 sein.');
    process.exit(2);
  }
  if (process.argv.includes('--nur-pruefen')) {
    const fehlt = fehlendeDateien();
    console.log(JSON.stringify(tabelle(kante), null, 2));
    if (fehlt.length) {
      console.error('Es fehlen:\n  ' + fehlt.join('\n  '));
      process.exit(2);
    }
  } else {
    // Kein `await` auf oberster Ebene: `tools/test/terrain-schichten.ts`
    // importiert diese Datei, um ihre Tabelle zu lesen statt sie
    // nachzubilden — und tsx uebersetzt sie dafuer nach CJS, wo ein
    // Top-Level-await nicht uebersetzbar ist. Der Test staerbe dann an
    // einer Zeile, die mit dem Test nichts zu tun hat.
    void baue(kante).catch((e) => {
      console.error('[terrain-schichten] ' + String(e));
      process.exit(1);
    });
  }
}
