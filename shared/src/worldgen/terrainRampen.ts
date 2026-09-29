/**
 * Die Steigungsrampe des Bodens: ab welcher Hangneigung welche Schicht
 * kommt — und die eine Umrechnung Grad → `ny`.
 *
 * ── Warum eine eigene Datei ──────────────────────────────────────────
 * Damit sie ohne Engine lesbar ist. `TerrainSplat.ts` zieht Babylon
 * mit; ein Test, der nachrechnet, was die Rampe und die Rauschmaske
 * (`./felsRauschen`) zusammen ergeben, müsste dafür eine Engine starten
 * — und hat die Zahlen bis zum 11.09.2026 deshalb ABGESCHRIEBEN, in
 * `~/wov-lab-mess/original-lib.mjs` genauso wie in jeder Diagnose
 * daneben. Eine abgeschriebene Rampe ist so lange richtig, bis jemand
 * an einem Grad dreht.
 *
 * `TerrainSplat.ts` reicht beides unverändert weiter, damit kein
 * bestehender Import bricht.
 *
 * Slope ramp thresholds of the terrain splat, engine-free so tests can
 * read them.
 */

/**
 * Die drei Stufen der Steigungsrampe, in GRAD Hangneigung.
 *
 * ── Warum nicht die Zahlen des Vorbilds ──────────────────────────────
 * Das Dorf staffelt Gras < 15°, Moos/Kies 15–30°, Fels ab ~35°, rauen
 * Fels ab ~65° (Analyse §2). Diese Zahlen sind für ein handmodelliertes
 * 300-m-Tal gemacht. UNSERE Inseln sind nirgends so steil. Gemessen mit
 * `~/wov-lab-mess/hang-histogramm.mjs` über die Vertex-Normalen im
 * 250-m-Umkreis:
 *
 *   Ort                  <15°   15–30°  30–44°  44–56°  >56°
 *   Referenz 10077/−18723  35 %   48 %    16 %   0,6 %   0
 *   Spawn-Insel            54 %   43 %     3 %   0       0
 *   10500/−17600           29 %   52 %    18 %   1,3 %   0
 *
 * Über 56° kommt hier NICHTS vor. Die oberste Stufe („rauer Fels ab
 * 65°") konnte auf unseren Inseln also niemals auslösen, und der Fels
 * ab 30° traf nur die obersten 3–18 %, dort aber mit der dunklen
 * Wandschicht. Übernommen wird deshalb die REIHENFOLGE des Vorbilds,
 * nicht seine oberste Gradzahl: Die beiden Felsstufen werden auf die
 * Verteilung unserer Inseln heruntergezogen, so dass sie die steilsten
 * Prozent treffen, statt leer zu laufen.
 *
 * ── Die Grenzen, und warum die unterste NICHT verschoben wird ────────
 * Ein erster Versuch zog alle drei Stufen herunter (12/22/34/46, der
 * Vorschlag aus dem Auftrag). Gemessen am Referenzort (Bildpunkte den
 * Vertex-Normalen zugeordnet, 17 Uhr, ohne Gras) verschiebt das den
 * SANFTEN Grund, auf dem die Kalibrierung von Stufe 2 steht:
 *
 *   Neigungsband   Stufe 2   12/22/34/46
 *   15–22°           59,2       64,1
 *   22–30°           59,9       71,7
 *
 * Das ist kein Fels an einem Hang mehr, das ist ein Steinschleier über
 * jedem Grashügel — 15–30° sind auf unseren Inseln 43–52 % der Fläche.
 * Die Regionsmessung „nah 55,8 ± 3" hätte das nicht überlebt.
 *
 * Also bleibt die unterste Stufe da, wo Stufe 2 sie kalibriert hat
 * (15°→30°, die Zahl des Vorbilds), und nur die zwei Felsstufen rücken
 * nach unten. Jede Stufe endet, wo die nächste anfängt — sie stapeln
 * sich, sie überschneiden sich nicht (geprüft in
 * `tools/test/terrain-schichten.ts`):
 *
 *   Hang  15° → 30°   unverändert; lässt die 29–54 % unter 15° in Ruhe
 *   Fels  30° → 40°   trifft die 3–18 % über 30° (vorher: voll erst 44°)
 *   Rau   40° → 50°   voll auf den steilsten 0,6–1,3 % (vorher: 56°→65°,
 *                     also nie)
 *
 * ── Die DECKUNGEN, und warum sie am 10.09.2026 gefallen sind ─────────
 * Die drei Gradzahlen bleiben, wo sie stehen — was sich ändert, sind die
 * `anteil`e. Der Grund ist die gemessene Verteilung des Vorbilds
 * (`design/original-boden.md` §A, „Die Rampe ist gemalt, nicht gerechnet
 * — mit Zahlen"): Mittleres FELSGEWICHT je Neigungsband
 *
 *     < 15°  0,076    15–30°  0,110    30–45°  0,216    ≥ 45°  0,425
 *
 * Selbst am steilsten Hang ist der Boden des Vorbilds also **weniger als
 * zur Hälfte Fels** — der Rest bleibt Moos. Genau das zeigt Bild 2 der
 * Look-Referenz: grüne Moosinseln mitten in der Felswand.
 *
 * Unsere Rampe stand auf dem Gegenteil. `fels.anteil` 0,85 und ein `rau`
 * OHNE Deckel ergaben ab 50° ein Felsgewicht von **1,0** — eine Wand aus
 * reinem Fels, wo das Vorbild 0,425 hat. Das ist nicht eine feinere
 * Fassung derselben Karte, sondern eine andere Aussage.
 *
 * Neu sind deshalb `fels.anteil` 0,40 und ein `rau.anteil` 0,10. Die
 * Rechnung (dieselbe, die der Shader fährt, `Fels = kF·(1−kR) + kR`):
 *
 *     30–40°  Rampenmittel 0,48 × 0,40 = 0,192   (Vorbild 0,216)
 *     45°     0,40 + 0,60 · 0,478 · 0,10 = 0,429 (Vorbild 0,425)
 *     ≥ 50°   0,40 + 0,60 · 0,10        = 0,460
 *
 * ── Was diese Formel NICHT kann, und warum das kein Fehler ist ───────
 * Unter 30° bleibt sie bei null, während das Vorbild dort 0,076 bis
 * 0,110 Fels hat. Diese Zahlen kommen nicht aus der Neigung: Das
 * Prüfbild `original-splat-TerrainL1.png` zeigt, dass der Autor seinen
 * Fels dem FLUSSLAUF und den Graten entlang gemalt hat, quer über alle
 * Neigungen — und dass er ihn am steilsten Rand der Karte gerade NICHT
 * gemalt hat. Gegenprobe aus derselben Messung: Eine 30°-Regel färbt
 * 34,0 % der Fläche und verfehlt trotzdem 35 % des gemalten Felses.
 *
 * Wer die 0,076 nachahmen wollte, müsste Fels gleichmässig über jede
 * flache Wiese streuen. Wie das aussieht, steht zwei Absätze weiter oben
 * gemessen: ein Steinschleier über jedem Grashügel. Die zwei flachen
 * Bänder bleiben deshalb leer, und das ist eine benannte Lücke (F21),
 * keine übersehene.
 *
 * ── Und die Flächenanteile, die dabei herauskommen ───────────────────
 * Am Referenzort (Neigungshistogramm oben) ergibt die neue Rampe rund
 * **3,3 %** Felsfläche. Das Vorbild hat 16,9 % — aber diese 16,9 %
 * gehören `Ani Dark Rockwall 3`, und das ist in unseren Tabellen
 * `rock-a`, die Kachel von SCHWARZWALD und BERG. Was auf der WIESE
 * erscheint, ist über `FELS_TILE[Grass]`/`RAU_TILE[Grass]` die Kachel
 * `Cliff`, und ihre Entsprechung im Vorbild ist
 * `Terrain_Meadow_Rock_Moss_01` mit **5,7 %** Fläche und mittlerer
 * Neigung 40,4°. Gegen diese Zahl steht 3,3 % — der Rest ist der
 * Unterschied der Gelände: Über 44° liegen bei uns 0,6 % der Fläche, im
 * Vorbild 16 %.
 *
 * `anteil` ist die Deckung, die die jeweilige Stufe höchstens erreicht.
 * Was fehlt, bleibt die Kachel darunter — das ist die Streuung, die ein
 * reiner Lerp sonst verliert, und im Vorbild ist es das Moos in der Wand.
 */
export const RAMPEN = {
  /** Hangkachel (Moos/Kies/Erde je Biom). */
  hang: { beginn: 15, voll: 30 },
  /** Mittlerer Fels (`FELS_TILE`). */
  fels: { beginn: 30, voll: 40, anteil: 0.4 },
  /** Steilster Hang, raue Felsschicht (`RAU_TILE`). */
  rau: { beginn: 40, voll: 50, anteil: 0.1 },
} as const;

/**
 * Hangneigung in Grad → `ny` der Normalen. Der Shader rechnet in `ny`,
 * geredet wird in Grad; diese Funktion ist die einzige Umrechnung.
 */
export function nyBeiGrad(grad: number): number {
  return Math.cos((grad * Math.PI) / 180);
}
