/**
 * Schattenwerfer pro INSTANZ keulen — der reine Kern.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Auf einer dicht bewachsenen Insel (10077 / -18723) ist die GPU zu
 * 99–100 % ausgelastet, und über die Hälfte davon ist der Schattenpass:
 * GPU-Zeit 15,4 ms, ohne Schatten 7,3 ms. Davon entfallen 5,0 ms allein
 * auf das Laub. Der Grund ist nicht die Zahl der Meshes, sondern die
 * Geometrie, die viermal (einmal je Kaskade) durch den Tiefenshader läuft
 * — Babylon keult nicht pro Kaskade (sebavan im Forum: „there is currently
 * not culling/clipping done on shadow generator per cascade").
 *
 * ── Warum auf Mesh-Ebene nichts zu holen war ─────────────────────────
 * Zwei Versuche am 17.08.2026, beide gemessen, beide wirkungslos:
 *
 *   Keulung pro Kaskade   77 % der Werfer fielen weg   → 0 ms gespart
 *   Nebelkeulung          31 von 66 Meshes fielen weg  → 0 ms gespart
 *
 * Gekeult wurden jeweils die billigen. Die Kosten stecken in wenigen
 * zusammengefassten Laubmeshes (`leaves_merged`: 425 m Hülle, 148 Thin
 * Instances), und die liegen in JEDEM Prüfvolumen. `Shadows.darfWerfen()`
 * sagt dasselbe bereits im Kommentar: „Für die gestreute Vegetation ändert
 * das nichts — ihre Instanzen reichen bis an den Rand des
 * Streaming-Gebiets, die Hülle umschliesst den Spieler."
 *
 * Die Ebene muss also tiefer: nicht das Mesh, sondern die Instanz. Von
 * 24.265 Vegetationsinstanzen erreichen je Kaskade nur 14–15 % überhaupt
 * die Schattenkarte — 85 % aller Einreichungen sind überflüssig.
 *
 * ── Die harte Randbedingung, teuer gelernt ───────────────────────────
 * Zwei Prototypen haben den Matrixpuffer des FARB-Meshes umgeschrieben und
 * nach dem Schattenpass zurückgesetzt:
 *
 *   je Kaskade packen + zurück   14 → 79 ms   (~12 MB Pufferverkehr je Bild)
 *   einmal je Bild + zurück      18 → 59 ms   (~3 MB je Bild)
 *
 * Beides ist um ein Vielfaches teurer als die gesparte Rasterarbeit.
 * Daraus folgt die Architektur, und sie ist nicht verhandelbar:
 *
 *   Der Puffer, den dieser Kern füllt, gehört einem EIGENEN Schatten-Mesh.
 *   Er wird NIE zurückgeschrieben, und er wird nur neu gepackt, wenn sich
 *   der Spieler weiter als `NEUPACK_ABSTAND` bewegt hat.
 *
 * Vorbild ist World of ClaudeCraft (`foliage_shadow_core.ts`,
 * `shadow_pass_gate_core.ts`), das denselben Fehlschlag auf Mesh-Ebene
 * dokumentiert — dort ~500×240-yd-Streifen mit 290 yd Hüllradius und
 * 670.000 unnötig eingereichten Dreiecken.
 *
 * ── Was hier NICHT geprüft wird ──────────────────────────────────────
 * Entlang der Lichtachse wird nicht gekeult. Ein Baum hinter dem
 * Kaskadenrand wirft seinen Schatten sehr wohl hinein; nur seitlich (im
 * Lichtraum-XY) ist eine Instanz sicher ausserhalb. Die Prüfung ist damit
 * konservativ in genau einer Richtung: Was hier überlebt, wird eingereicht;
 * verworfen wird nur, was geometrisch nichts beitragen kann.
 *
 * Reiner Kern: nur Zahlen und typisierte Felder, kein Babylon-Import, kein
 * DOM, keine Uhr. Getestet in client/test/schatten-instanz-keulung.ts.
 */

/**
 * Abstand in Metern, ab dem neu gepackt wird. Dasselbe Muster wie
 * `NACHFUEHR_ABSTAND` in Shadows.ts (dort 16 m für die Werferliste), nur
 * enger: Der Rand, den `packeInstanzen` auf den Kasten schlägt, wächst mit
 * diesem Wert, und ein zu grosser Rand hebt die Keulung wieder auf.
 */
export const NEUPACK_ABSTAND = 8;

/** Ein Lichtvolumen im Lichtraum — die seitlichen Grenzen einer Kaskade. */
export interface Lichtkasten {
  /** Sichtmatrix des Lichts, spaltenweise wie Babylon sie hält (16 Werte). */
  readonly sicht: ArrayLike<number>;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Muss neu gepackt werden?
 *
 * `letztX`/`letztZ` dürfen NaN sein (noch nie gepackt) — dann ist die
 * Antwort immer ja.
 */
export function brauchtNeupacken(
  x: number,
  z: number,
  letztX: number,
  letztZ: number,
  abstand: number = NEUPACK_ABSTAND
): boolean {
  if (Number.isNaN(letztX) || Number.isNaN(letztZ)) return true;
  return Math.abs(x - letztX) >= abstand || Math.abs(z - letztZ) >= abstand;
}

/**
 * Instanzen, die den Lichtkasten erreichen können, an den Anfang von
 * `ziel` packen. Gibt zurück, wie viele es sind — das ist die
 * `thinInstanceCount`, mit der das Schatten-Mesh gezeichnet wird.
 *
 * `matrizen` ist der Matrixpuffer der Thin Instances (16 Werte je Instanz,
 * spaltenweise; die Übersetzung steht in den Feldern 12/13/14).
 *
 * `radius` ist der Hüllradius EINER Pflanze plus der Bewegungsrand
 * (`NEUPACK_ABSTAND`), damit die Packung bis zum nächsten Neupacken gültig
 * bleibt. Lieber grosszügig: Ein zu grosser Radius behält zu viel, ein zu
 * kleiner löscht Schatten.
 *
 * `ziel` muss mindestens `anzahl * 16` Werte fassen. Bei `anzahl === 0`
 * oder fehlendem Kasten wird nichts geschrieben und 0 zurückgegeben.
 */
export function packeInstanzen(
  matrizen: ArrayLike<number>,
  anzahl: number,
  kasten: Lichtkasten,
  radius: number,
  ziel: Float32Array
): number {
  if (anzahl <= 0) return 0;
  const s = kasten.sicht;
  const minX = kasten.minX - radius;
  const maxX = kasten.maxX + radius;
  const minY = kasten.minY - radius;
  const maxY = kasten.maxY + radius;
  let behalten = 0;
  for (let i = 0; i < anzahl; i++) {
    const o = i * 16;
    const wx = matrizen[o + 12];
    const wy = matrizen[o + 13];
    const wz = matrizen[o + 14];
    // Weltpunkt in den Lichtraum. Nur x und y werden gebraucht — die
    // Tiefe entlang der Lichtachse darf nicht keulen (s. Kopfkommentar).
    const lx = wx * s[0] + wy * s[4] + wz * s[8] + s[12];
    const ly = wx * s[1] + wy * s[5] + wz * s[9] + s[13];
    if (lx < minX || lx > maxX || ly < minY || ly > maxY) continue;
    const zo = behalten * 16;
    for (let k = 0; k < 16; k++) ziel[zo + k] = matrizen[o + k];
    behalten++;
  }
  return behalten;
}
