/**
 * Die ZWEI Farben, mit denen das Vorbild eine Blattkarte einfärbt — und
 * die Formel, die dazwischen mischt.
 *
 * ── Was hier gelöst wird ─────────────────────────────────────────────
 * Die Laub-Atlanten des Bestands sind Graustufen (gemessen: Sättigung
 * 0,0002 bis 0,0018 über die deckenden Texel). Die ganze Blattfarbe
 * entsteht also im MATERIAL. Bis A8 stand dafür EINE Zahl je
 * Quellmaterial in der GLB (`baseColorFactor`), und diese Zahl ist das
 * arithmetische MITTEL aus zwei Farben, die das Vorbild getrennt führt:
 * oben in der Karte eine helle, gelbgrüne, unten eine dunkle, satte.
 * glTF kennt nur einen Faktor — der Verlauf ging beim Übertragen
 * verloren, und übrig blieb die flache Mischfarbe, die Mike am
 * 12.09.2026 als „blass grau-grün" beschrieben hat.
 *
 * Diese Tabelle bringt beide Farben zurück. Der Verlauf selbst wird im
 * Client gerechnet (`client/src/engine/LaubSpitzen.ts`), die Zuordnung
 * Modell → Quellmaterial erzeugt die Aufbereitung
 * (`shared/src/laubVorbilder.ts`, aus
 * `tools/store-vegetation-aufbereiten.mjs`).
 *
 * ── Die Formel, und woher sie stammt ─────────────────────────────────
 * Nicht geraten, sondern aus dem ÜBERSETZTEN Shader des Vorbilds
 * gelesen. Der Materialshader heisst `Shader Graphs/Leaves Foliage`; der
 * Export legt davon nur einen leeren Rumpf ab („DummyShaderTextExporter"),
 * der lediglich die Eigenschaften nennt:
 *
 *     Color_3E4BE667  „Top Color"
 *     Color_99FDAD86  „Bottom Color"
 *     Vector1_605C986C „Added Color Amount"  Range(0, 1.5), Vorgabe 1
 *
 * Der gerechnete Code steht in den Spieldaten selbst (Shader-Objekt,
 * d3d11-Rumpf). Die Stelle, an der die Farbe entsteht, lautet dort —
 * Zeile für Zeile aus dem Fragmentprogramm rückübersetzt:
 *
 *     r4 = TopColor - BottomColor
 *     r4 = uv.y * r4 + BottomColor          // mix(unten, oben, uv.y)
 *     r4 = base * r4 - base
 *     r0 = AddedColorAmount * r4 + base     // mix(base, base*verlauf, menge)
 *
 * Also, in einer Zeile:
 *
 *     albedo = mix(base, base * mix(unten, oben, v), menge)
 *
 * Drei Dinge stehen damit fest, die man sonst hätte raten müssen:
 *
 *  1. DIE ACHSE IST DIE UV, nicht die Höhe im Objekt oder in der Welt.
 *     Das Fragmentprogramm liest `v3.y`, und `v3` ist der durchgereichte
 *     TEXCOORD0 — dieselbe Koordinate, mit der die Karte abgetastet
 *     wird. Eine Objekt- oder Welthöhe kommt im Programm gar nicht vor.
 *  2. DER VERLAUF LÄUFT JE KARTE, nicht über die Krone. Jede Blattkarte
 *     des Bestands belegt die UV-Fläche GANZ: nachgemessen über
 *     `tree-1a3`, `tree-1e1`, `bush-1a2` und `massive-tree-1a1` sind die
 *     vier Ecken jedes Vierecks ausnahmslos (0,0), (1,0), (0,1), (1,1).
 *     Der Verlauf sitzt also in jedem einzelnen Blattbüschel: aussen
 *     hell und gelbgrün, am Ansatz dunkel.
 *  3. MULTIPLIKATIV, nicht ersetzend: `base * verlauf`. Die Graukarte
 *     bleibt die Helligkeitsmaske, die sie ist.
 *
 * ── Die Richtung der V-Achse (die teuerste Frage) ────────────────────
 * Unity misst v von UNTEN, glTF von OBEN — für dieselbe Bildstelle gilt
 * `v_glTF = 1 − v_Unity`. Verlassen kann man sich darauf nicht, weil
 * jede Umwandlungskette unterwegs noch einmal spiegeln kann. Deshalb
 * GEMESSEN, an zwei unabhängigen Zeugen:
 *
 *   (a) Das Vorbild dämpft seinen Wind mit derselben Koordinate: im
 *       Vertexprogramm steht `position += uv.y * windversatz`. Was sich
 *       am weitesten bewegt, ist das FREIE Ende der Karte — bei Unity
 *       also v = 1.
 *   (b) In den Speicher-GLBs liegen die Ecken mit dem GRÖSSEREN v näher
 *       am Schwerpunkt des Kronen-Primitivs, die mit dem kleineren
 *       weiter aussen. Gemessen als mittlerer Abstandsunterschied je
 *       Viereck: `massive-tree-1a1` −0,49 m (2815 von 3107 Vierecken
 *       einig), `tree-1e1` −0,12 m, `bush-1a2` −0,029 m, `tree-1a3`
 *       −0,011 m. Das freie Ende ist in der GLB also v = 0.
 *
 * Beides zusammen: `v_Unity = 1 − v_glTF`. Der Client rechnet deshalb
 * mit `1 − uv.y`, und `oben` liegt an der Blattspitze.
 *
 * ── Was der Verlauf NICHT tut ────────────────────────────────────────
 * Er macht die Krone nicht dunkler. Der Mittelwert einer linearen Rampe
 * ist der Mittelwert ihrer Enden — genau die Zahl, die bisher als
 * einzelner Faktor drinstand. Nachgerechnet über die deckenden Texel der
 * Atlanten (Alpha ≥ 128, Erwartungswert der Achse 0,476 bis 0,529)
 * ändert sich die lineare Kronen-Albedo um −0,6 % bis +0,5 %, in sRGB
 * gelesen um weniger als 0,7 Luma-Stufen. Wer hier eine dunklere Krone
 * erwartet, muss an der Beleuchtung oder am Himmel ansetzen, nicht an
 * dieser Tabelle.
 *
 * Was er sehr wohl tut: Innerhalb EINER Karte stehen Spitze und Ansatz
 * um Faktor 1,5 bis 1,7 in der Helligkeit auseinander (`Leaves 1`:
 * lineare Luma 0,768 gegen 0,463) und rund 11° im Farbton (66° gegen
 * 77°) — genau der gelbgrüne Saum, den das Vorbild zeigt und den eine
 * Mischfarbe nicht haben kann.
 *
 * ── Woher die Zahlen ─────────────────────────────────────────────────
 * Aus den Spieldaten, Abschnitt `materialien` von
 * `/home/mike/wov-lab-mess/laub-materialien.json`: `Color_3E4BE667`
 * (oben), `Color_99FDAD86` (unten), `Vector1_605C986C` (Menge). Linear,
 * wie das Vorbild sie führt — dieselbe Lesart, unter der die
 * Grundfarben der Findlinge das gemessene Referenzband getroffen haben
 * (`shared/src/syntyGrundfarben.ts`). Geschätzt ist an keiner Zeile
 * etwas; das Mittel aus beiden Farben IST der Faktor, den die
 * Aufbereitung seit A8 in die GLB schreibt.
 *
 * The original's two crown colours per source material plus the blend
 * rule read out of its compiled shader: albedo = mix(base, base *
 * mix(bottom, top, v), amount), v running along the leaf card's UV.
 */

/** Eine Farbe, linear, wie das Vorbild sie führt. */
export type LaubFarbe = readonly [number, number, number];

export type LaubSpitze = {
  /** `Top Color` — an der Blattspitze (Unity v = 1). */
  readonly oben: LaubFarbe;
  /** `Bottom Color` — am Ansatz der Karte (Unity v = 0). */
  readonly unten: LaubFarbe;
  /** `Added Color Amount` — 1 heisst „ganz", 0 hiesse „gar nicht". */
  readonly menge: number;
  /**
   * Bekommt dieses Material den Verlauf aus `LaubSpitzenPlugin`?
   *
   * Die vier Grasbüschel stehen hier mit ihren gemessenen Farben, aber
   * auf `false` — und das BLEIBT so. Sie waren in dieser Runde der
   * Auftrag eines zweiten Bauern, und der hat ihren Verlauf über einen
   * anderen Weg eingebaut: nicht über die Blattkarte (`1 − uv.y`),
   * sondern über die HALMHÖHE im Clutter-Shader (`GRAS_SPITZEN` in
   * `client/src/engine/GrassClutter.ts`, Achse an der Geometrie
   * nachgemessen). Beide Wege tragen dieselben acht Farben auf
   * dieselben Büschel auf.
   *
   * Ein `true` hier wäre deshalb keine Nachrüstung, sondern ein ZWEITER
   * Verlauf über demselben Halm — die Spitzenfarbe stünde zweimal
   * darauf. Die vier Zeilen haben in dieser Tabelle nur noch einen
   * Zweck: Die Aufbereitung leitet aus ihnen das Mittel ab, das als
   * einzelner `baseColorFactor` in die GLB geht (nachgetragen bei der
   * Zusammenführung von Runde 2, 12.09.2026).
   */
  readonly imLabor: boolean;
};

/**
 * Je QUELLMATERIAL des Vorbilds — nicht je Rolle.
 *
 * Eine Tabelle je Rolle zöge `Leaves 1`, `Leaves 2` und `Leaves Birch 1`
 * auf denselben Wert und ebnete genau die Unterschiede ein, wegen derer
 * die Aufbereitung ihre Materialien überhaupt getrennt hält
 * (`small-thin-tree-1a5` führt zwei Grüntöne auf EINER Karte).
 */
export const LAUB_SPITZEN: Readonly<Record<string, LaubSpitze>> = {
  // ── Laubkarten (Atlas „Color Leaves Alpha") ────────────────────────
  'Leaves 1': { oben: [0.764, 0.802, 0.443], unten: [0.431, 0.49, 0.286], menge: 1.0, imLabor: true },
  'Leaves 2': { oben: [0.755, 0.792, 0.49], unten: [0.584, 0.69, 0.067], menge: 1.0, imLabor: true },
  'Leaves 3': { oben: [0.906, 0.962, 0.513], unten: [0.189, 0.491, 0.076], menge: 1.0, imLabor: true },
  'Leaves Birch 1': { oben: [0.843, 0.859, 0.522], unten: [0.262, 0.34, 0.223], menge: 1.0, imLabor: true },
  'Leaves Birch 2': { oben: [0.588, 0.651, 0.439], unten: [0.368, 0.434, 0.211], menge: 1.0, imLabor: true },
  'Leaves Birch 3 Dark': { oben: [0.886, 0.682, 0.353], unten: [0.365, 0.243, 0.182], menge: 1.0, imLabor: true },
  'Leaves Birch 3 Dark Snow': { oben: [0.976, 0.979, 0.996], unten: [0.365, 0.341, 0.328], menge: 1.0, imLabor: true },
  // ── Nadeln und Ahorn ───────────────────────────────────────────────
  // `Pine 1` ist die eine Zeile, deren Verlauf ABWÄRTS läuft: oben
  // 0,275/0,349/0,157, unten 0,404 grau. Die Nadelspitze ist dort
  // dunkler als der Ansatz — das ist kein Vertipper, sondern steht so in
  // den Spieldaten, und es ist der Grund, aus dem `Pine 1` als einziges
  // Material durch den Verlauf minimal HELLER wird (+0,15 %).
  'Pine 1': { oben: [0.275, 0.349, 0.157], unten: [0.404, 0.404, 0.404], menge: 1.0, imLabor: true },
  'Pine 2': { oben: [0.651, 0.671, 0.592], unten: [0.384, 0.388, 0.102], menge: 1.0, imLabor: true },
  'Maple Leaves 1': { oben: [0.412, 0.451, 0.208], unten: [0.342, 0.368, 0.21], menge: 1.017, imLabor: true },
  // ── Grasbüschel des Speichers (s. `imLabor`) ───────────────────────
  // ⚠ Diese vier Zeilen sind seit dem 12.09.2026 an ZWEI Stellen
  // wirksam: Die Aufbereitung schreibt ihr Mittel als `baseColorFactor`
  // in die GLB, und `GRAS_SPITZEN` in `client/src/engine/GrassClutter.ts`
  // führt dieselben acht Farben noch einmal, um daraus den Höhenverlauf
  // des Halms zu rechnen — mittelwerttreu, das Mittel bleibt also
  // richtig. Wer hier eine Zahl nachmisst, zieht die dortige Tabelle
  // mit; `client/test/gras-spitzen.ts` vergleicht beide Seiten und wird
  // sonst rot.
  'Grass_Short_Plant_Leaves_1A1 2': { oben: [0.937, 1.0, 0.851], unten: [0.698, 0.608, 0.23], menge: 0.956, imLabor: false },
  Grass_Short_Plant_Leaves_1A1_Yellow: { oben: [1.0, 0.998, 0.95], unten: [0.85, 0.391, 0.125], menge: 0.956, imLabor: false },
  Grass_Short_Plant_Leaves_1A1_Snow: { oben: [0.921, 0.936, 0.95], unten: [0.742, 0.762, 0.818], menge: 0.956, imLabor: false },
  Grass_Short_Plant_Leaves_1A1_RedBlue: { oben: [1.0, 0.821, 0.948], unten: [0.736, 0.137, 0.696], menge: 0.956, imLabor: false },
};

/**
 * Das Mittel aus beiden Farben — der EINE Faktor, den glTF kann.
 *
 * Die Aufbereitung schreibt genau diesen Wert als `baseColorFactor`, und
 * dieselbe Funktion liefert ihn: Zwei Tabellen mit denselben Zahlen
 * liefen unweigerlich auseinander (die alte `UNITY_JE_MATERIAL` im
 * Werkzeug WAR diese zweite Tabelle).
 *
 * Die `menge` bleibt hier absichtlich aussen vor. Genau genommen wäre
 * das Mittel `mix(1, mittel, menge)`; bei den zehn Laubmaterialien ist
 * `menge` zehnmal 1,0 beziehungsweise 1,017, der Unterschied liegt unter
 * einem Tausendstel. Sie hier einzurechnen würde den Speicherstand
 * ändern, ohne dass irgendetwas im Bild davon abhinge — der Verlauf im
 * Client rechnet sie ohnehin richtig.
 */
export function laubMittel(s: LaubSpitze): [number, number, number] {
  /*
    Auf vier Stellen gerundet, und das ist keine Kosmetik: Beide Farben
    haben höchstens drei Nachkommastellen, ihr Mittel also höchstens
    vier — die Rundung verliert nichts. Ohne sie schreibt die
    Aufbereitung `(0.95 + 0.818) / 2` als `0.8839999999999999` in die
    GLB, und der Speicherstand änderte sich bei jedem Lauf gegen die
    Zahl, die dort seit A8 steht.
  */
  const m = (a: number, b: number) => Number(((a + b) / 2).toFixed(4));
  return [m(s.oben[0], s.unten[0]), m(s.oben[1], s.unten[1]), m(s.oben[2], s.unten[2])];
}

/**
 * Der Verlaufswert an einer Stelle der Karte — dieselbe Rechnung wie im
 * Shader, damit der Test sie prüfen kann, ohne eine GPU zu brauchen.
 *
 * `vGltf` ist die V-Koordinate, wie sie in der GLB steht (0 = freies
 * Ende). Die Umkehr auf die Unity-Achse steckt hier drin und NUR hier.
 */
export function laubAlbedo(s: LaubSpitze, basis: LaubFarbe, vGltf: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, 1 - vGltf));
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const verlauf = s.unten[i] + t * (s.oben[i] - s.unten[i]);
    out[i] = basis[i] * (1 - s.menge) + basis[i] * verlauf * s.menge;
  }
  return out;
}
