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
 * Instances), und die liegen in JEDEM Prüfvolumen. Eine Ebene tiefer sieht
 * es anders aus: Von 24.265 Vegetationsinstanzen erreichen je Kaskade nur
 * 14–15 % überhaupt die Schattenkarte.
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
 * ── Ergebnis des sicheren Wegs (18.08.2026, schwere Insel) ───────────
 * Feste Position 10077/-18723, Wind aus, Sonne angehalten, normale hohe
 * Schattenstufe (4 × 150 m, 2048 px):
 *
 *   ursprünglicher Vollpass       14,29 ms GPU
 *   eigener Klon, alle Instanzen  13,77 ms GPU
 *   konservativ radial gekeult    12,09 ms GPU
 *
 * 18.761 von 29.242 Vegetations-Instanzeinreichungen bleiben. Der direkte
 * Bildvergleich „Klon voll“ gegen „Klon gekeult“ ergab nur 0,418 % RMSE
 * und 0,452 % geänderte Pixel — in der Größenordnung des Kontrollrauschens.
 *
 * ── Warum RADIAL und nicht im Lichtraum (18.08.2026, im Spiel gelernt) ─
 * Die erste Fassung prüfte jede Instanz gegen die Kaskadenkästen im
 * Lichtraum. Sie hat auf drei Arten hintereinander Schatten GELÖSCHT:
 *
 *   1. Gepackt wurde gegen die grösste Kaskade — die die kleineren NICHT
 *      umschliesst (jede hat ihre eigene Sichtmatrix und ihren eigenen
 *      Ausschnitt).
 *   2. Die Kaskadenmatrizen wurden in tick() gelesen, also einen Frame zu
 *      früh; die Doku sieht dafür `getCustomRenderList` vor, wo sie
 *      frisch sind.
 *   3. Der Klon selbst wurde von Babylons Frustum-Prüfung als GANZES
 *      gekeult, sobald seine Hülle nicht zum frisch gepackten Puffer
 *      passte — ein im Forum bekanntes Thin-Instance-Problem
 *      (forum.babylonjs.com/t/33711, /t/51901).
 *
 * Das Symptom war jedes Mal dasselbe und maximal heimtückisch: Bäume ohne
 * Schatten, wandernd mit der Spielerbewegung. Die radiale Regel kann all
 * das nicht: Sie hängt nur von Spielerposition und Abstand ab — beides
 * kennen wir exakt — und sie entspricht wörtlich der Anforderung
 * „Schatten sollen in Sichtweite des Charakters da sein". Werfer jenseits
 * der Schattenweite plus Wurfreserve können die Karte, die nur
 * `shadowMaxZ` Meter weit empfängt, geometrisch nicht mehr erreichen.
 *
 * Der Preis: Innerhalb des Radius wird gar nicht gekeult. Der Gewinn kommt
 * aus dem Ring dahinter — gegen das tatsächliche 576×576-m-Streamingfenster.
 * Der Radius ist dabei NICHT einfach `shadowMaxZ`: Er umfasst die fernen
 * Frustumecken, die Pflanzenausdehnung, den Nachlauf bis zum nächsten Packen
 * und den längeren Schattenwurf bei flacher Sonne. Bei Sonnenauf- und
 * -untergang kann er deshalb bewusst das ganze Fenster behalten.
 *
 * Reiner Kern: nur Zahlen und typisierte Felder, kein Babylon-Import, kein
 * DOM, keine Uhr. Getestet in client/test/schatten-instanz-keulung.ts.
 */

/**
 * Abstand in Metern, ab dem neu gepackt wird. Dasselbe Muster wie
 * `NACHFUEHR_ABSTAND` in Shadows.ts (dort 16 m für die Werferliste):
 * Gepackt wird zusammen mit dem Neuaufbau der Werferliste, und der
 * Auswahlradius bekommt diesen Betrag als Reserve, damit die Packung bis
 * zum nächsten Packen gültig bleibt.
 */
export const NEUPACK_ABSTAND = 16;

/**
 * Konservativer horizontaler Auswahlradius für einen Vegetationsmaster.
 *
 * `shadowMaxZ` beschreibt die Tiefe entlang der Kameraachse, nicht einen
 * Kreis um den Spieler. Die fernste sichtbare Frustumecke liegt zusätzlich
 * um die halbe Bildbreite und -höhe seitlich versetzt. Dazu kann ein Objekt
 * AUSSERHALB des Empfängerbereichs seinen Schatten hineinwerfen; dessen
 * maximale horizontale Länge folgt direkt aus Sonnenrichtung und Höhe.
 *
 * Bei nahezu waagerechter Sonne ist kein endlicher, allgemein korrekter
 * Wurfradius möglich. `Infinity` bedeutet dann absichtlich „nichts keulen".
 */
export function konservativerAuswahlRadius(
  shadowMaxZ: number,
  vertikalesFov: number,
  seitenverhaeltnis: number,
  sonneX: number,
  sonneY: number,
  sonneZ: number,
  objektHoehe: number,
  objektRadius: number,
  nachlauf = NEUPACK_ABSTAND
): number {
  if (!(shadowMaxZ > 0)) return 0;
  const halbHoch = shadowMaxZ * Math.tan(Math.max(0, vertikalesFov) * 0.5);
  const halbBreit = halbHoch * Math.max(1, seitenverhaeltnis);
  const frustumRadius = Math.hypot(shadowMaxZ, halbBreit, halbHoch);
  const horizontal = Math.hypot(sonneX, sonneZ);
  const senkrecht = Math.abs(sonneY);
  if (senkrecht < 1e-3 && horizontal > 0) return Number.POSITIVE_INFINITY;
  const wurf = senkrecht > 0 ? Math.max(0, objektHoehe) * horizontal / senkrecht : 0;
  return frustumRadius + wurf + Math.max(0, objektRadius) + Math.max(0, nachlauf);
}

/** Radius nur in groben Stufen ändern, damit die wandernde Sonne nicht
 * jeden Frame einen neuen GPU-Puffer auslöst. Aufrunden bleibt konservativ. */
export function quantisiereRadius(radius: number, schritt = NEUPACK_ABSTAND): number {
  if (!Number.isFinite(radius)) return Number.POSITIVE_INFINITY;
  if (!(radius > 0) || !(schritt > 0)) return Math.max(0, radius);
  return Math.ceil(radius / schritt) * schritt;
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
 * Instanzen im Umkreis von `radius` Metern um (`x`, `z`) an den Anfang von
 * `ziel` packen. Gibt zurück, wie viele es sind — das ist die
 * `thinInstanceCount`, mit der das Schatten-Mesh gezeichnet wird.
 *
 * `matrizen` ist der Matrixpuffer der Thin Instances (16 Werte je Instanz,
 * spaltenweise; die Übersetzung steht in den Feldern 12/13/14). Geprüft
 * wird nur in der Bodenebene (x/z): Die Höhe spielt für „kann diese
 * Pflanze einen sichtbaren Schatten werfen" keine Rolle, die
 * Höhenunterschiede unserer Inseln sind klein gegen den Radius.
 *
 * `ziel` muss mindestens `anzahl * 16` Werte fassen. Bei `anzahl <= 0`
 * oder `radius <= 0` wird nichts geschrieben und 0 zurückgegeben.
 */
export function packeInstanzenRadial(
  matrizen: ArrayLike<number>,
  anzahl: number,
  x: number,
  z: number,
  radius: number,
  ziel: Float32Array
): number {
  if (anzahl <= 0 || radius <= 0) return 0;
  const r2 = radius * radius;
  let behalten = 0;
  for (let i = 0; i < anzahl; i++) {
    const o = i * 16;
    const dx = matrizen[o + 12] - x;
    const dz = matrizen[o + 14] - z;
    if (dx * dx + dz * dz > r2) continue;
    const zo = behalten * 16;
    for (let k = 0; k < 16; k++) ziel[zo + k] = matrizen[o + k];
    behalten++;
  }
  return behalten;
}
