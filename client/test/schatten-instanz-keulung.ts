/**
 * Wächter für die Schattenkeulung pro Instanz.
 *
 * Die Auswahl ist radial um den Spieler — bewusst die simpelste Regel, die
 * korrekt ist, nachdem die Lichtraum-Prüfung gegen die Kaskadenkästen auf
 * drei Arten hintereinander Schatten gelöscht hat (Herleitung im Kopf von
 * SchattenInstanzKeulung.ts). Ein Fehler in dieser Auswahl löscht Schatten
 * statt sie zu sparen, und zwar unauffällig — deshalb Kernliste.
 *
 * Festgehalten wird:
 *  1. Auswahl und Packreihenfolge stimmen (Überlebende lückenlos am Anfang).
 *  2. Der Radius wird als ECHTE Distanz geprüft, nicht je Achse — eine
 *     Instanz diagonal knapp ausserhalb fällt raus, knapp innerhalb bleibt.
 *  3. Entartete Eingaben liefern 0 statt Müll.
 *  4. Die Neupack-Schwelle feuert beim ersten Mal und ab der Schwelle.
 *  5. Der Auswahlradius deckt Frustumecken und flachen Schattenwurf ab.
 *  6. Der Kameraversatz geht in den Radius ein — ohne ihn verliert jeder
 *     Kameraschwenk am fernen Rand Werfer (G6).
 *  7. Die Hysterese haelt den Radius stehen. Das ist die eigentliche
 *     Zusage von G6: Ein wandernder Radius schaltet ganze Schattenfelder
 *     an und aus, und daran ist die Keulung in E27 gescheitert.
 */
import {
  NEUPACK_ABSTAND,
  brauchtNeupacken,
  konservativerAuswahlRadius,
  packeInstanzenRadial,
  quantisiereRadius,
  radiusMitHysterese,
} from '../src/engine/SchattenInstanzKeulung.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

/** Baut einen Matrixpuffer aus Positionen (Einheitsmatrix + Übersetzung). */
function puffer(punkte: ReadonlyArray<readonly [number, number, number]>): Float32Array {
  const f = new Float32Array(punkte.length * 16);
  punkte.forEach(([x, y, z], i) => {
    const o = i * 16;
    f[o] = 1; f[o + 5] = 1; f[o + 10] = 1; f[o + 15] = 1;
    f[o + 12] = x; f[o + 13] = y; f[o + 14] = z;
  });
  return f;
}

console.log('Schattenkeulung pro Instanz (radial)');

// ── 1. Auswahl und Packreihenfolge ───────────────────────────────────
{
  const p = puffer([[10, 0, 0], [500, 0, 0], [-30, 7, 40], [0, 0, -800]]);
  const ziel = new Float32Array(4 * 16);
  const n = packeInstanzenRadial(p, 4, 0, 0, 100, ziel);
  pruefe(n === 2, `erwartet 2 Überlebende, bekam ${n}`);
  pruefe(ziel[12] === 10, 'erste Überlebende nicht an den Anfang gepackt');
  pruefe(ziel[16 + 12] === -30 && ziel[16 + 14] === 40, 'zweite Überlebende falsch gepackt');
}

// ── 2. Radius ist eine Distanz, keine Achsenprüfung ─────────────────
{
  // (80, 80) liegt 113 m diagonal: je Achse unter 100, als Distanz drüber.
  // Wer hier je Achse prüft, behält fälschlich — der Test erwischt es.
  const diagonalDraussen = puffer([[80, 0, 80]]);
  const diagonalDrinnen = puffer([[70, 0, 70]]);   // 99 m
  const ziel = new Float32Array(16);
  pruefe(packeInstanzenRadial(diagonalDraussen, 1, 0, 0, 100, ziel) === 0, 'diagonal ausserhalb wurde behalten');
  pruefe(packeInstanzenRadial(diagonalDrinnen, 1, 0, 0, 100, ziel) === 1, 'diagonal innerhalb wurde gekeult');
}

// ── 3. Die Höhe keult nicht ─────────────────────────────────────────
{
  // Ein Baum 60 m über dem Spieler (Klippe) wirft trotzdem — geprüft wird
  // nur in der Bodenebene.
  const hoch = puffer([[10, 60, 10]]);
  const ziel = new Float32Array(16);
  pruefe(packeInstanzenRadial(hoch, 1, 0, 0, 100, ziel) === 1, 'hohe Instanz wurde über die Höhe gekeult');
}

// ── 4. Entartete Eingaben ───────────────────────────────────────────
{
  const ziel = new Float32Array(16);
  pruefe(packeInstanzenRadial(new Float32Array(0), 0, 0, 0, 100, ziel) === 0, 'leerer Puffer lieferte nicht 0');
  pruefe(packeInstanzenRadial(puffer([[0, 0, 0]]), -1, 0, 0, 100, ziel) === 0, 'negative Anzahl lieferte nicht 0');
  pruefe(packeInstanzenRadial(puffer([[0, 0, 0]]), 1, 0, 0, 0, ziel) === 0, 'Radius 0 lieferte nicht 0');
}

// ── 5. Neupack-Schwelle ─────────────────────────────────────────────
{
  pruefe(brauchtNeupacken(0, 0, Number.NaN, Number.NaN), 'erster Aufruf muss packen');
  pruefe(!brauchtNeupacken(3, 3, 0, 0), 'kleine Bewegung löste Neupacken aus');
  pruefe(brauchtNeupacken(NEUPACK_ABSTAND, 0, 0, 0), 'Schwelle löste kein Neupacken aus');
  pruefe(brauchtNeupacken(0, -NEUPACK_ABSTAND, 0, 0), 'Schwelle in -z löste kein Neupacken aus');
}

// ── 6. Konservativer Radius ─────────────────────────────────────────
{
  const distanz = 120;
  const fov = Math.PI / 3;
  const aspect = 16 / 9;
  const hoch = konservativerAuswahlRadius(distanz, fov, aspect, 0, -1, 0, 20, 8);
  const halbHoch = distanz * Math.tan(fov / 2);
  const ecke = Math.hypot(distanz, halbHoch * aspect, halbHoch);
  pruefe(hoch >= ecke + 8 + NEUPACK_ABSTAND, 'ferne Frustumecke ist nicht vollständig abgedeckt');

  const flach = konservativerAuswahlRadius(distanz, fov, aspect, 1, -0.25, 0, 20, 8);
  pruefe(flach >= hoch + 79, 'flache Sonne verlängert den Auswahlradius nicht um den Schattenwurf');

  const waagerecht = konservativerAuswahlRadius(distanz, fov, aspect, 1, 0, 0, 20, 8);
  pruefe(waagerecht === Number.POSITIVE_INFINITY, 'waagerechte Sonne muss die Keulung abschalten');

  pruefe(quantisiereRadius(201, 16) === 208, 'Radius wird nicht konservativ aufgerundet');
  pruefe(quantisiereRadius(Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY, 'unendlicher Radius ging verloren');

  // Kameraversatz: Gepackt wird um den SPIELER, gerechnet aus dem Frustum
  // der KAMERA. Ohne diesen Summanden verliert jeder Kameraschwenk am
  // fernen Rand Werfer (G6).
  const mitArm = konservativerAuswahlRadius(distanz, fov, aspect, 0, -1, 0, 20, 8, NEUPACK_ABSTAND, 8);
  pruefe(mitArm === hoch + 8, 'Kameraversatz geht nicht in den Auswahlradius ein');
  pruefe(
    konservativerAuswahlRadius(distanz, fov, aspect, 0, -1, 0, 20, 8, NEUPACK_ABSTAND, -5) === hoch,
    'negativer Kameraversatz darf den Radius nicht verkleinern'
  );
}

// ── 7. Hysterese auf dem Radius (G6) ────────────────────────────────
//
// Die Zusage, die hier festgehalten wird, ist nicht „der Radius ist
// richtig", sondern „der Radius BLEIBT STEHEN". Ein wandernder Radius
// schaltet ganze Schattenfelder an und aus, und genau daran ist die
// Keulung in E27 gescheitert.
{
  const band = NEUPACK_ABSTAND;
  // Noch nie gepackt: der Aufnahmeradius, eine Bandbreite über dem Bedarf.
  pruefe(radiusMitHysterese(100, Number.NaN, band) === 100 + band, 'erstes Packen ohne Zuschlag');

  // Der gepackte Ring deckt den Bedarf: halten, egal wie die Sonne driftet.
  const gepackt = radiusMitHysterese(100, Number.NaN, band);
  for (const bedarf of [100, 100 - band, 100 + band]) {
    pruefe(
      radiusMitHysterese(bedarf, gepackt, band) === gepackt,
      `Radius wandert bei Bedarf ${bedarf}, statt stehenzubleiben`
    );
  }

  // Wächst der Bedarf über den gepackten Ring hinaus, MUSS sofort
  // nachgezogen werden — sonst fehlen Schatten, und das ist der teurere
  // Fehler.
  pruefe(
    radiusMitHysterese(gepackt + 1, gepackt, band) === gepackt + 1 + band,
    'wachsender Bedarf wird nicht sofort aufgenommen'
  );

  // Fallengelassen wird erst deutlich später (mehr als zwei Bandbreiten).
  pruefe(
    radiusMitHysterese(gepackt - 2 * band - 1, gepackt, band) < gepackt,
    'ein weit geschrumpfter Bedarf verkleinert den Ring nicht'
  );

  // Unendlich trägt sich in beide Richtungen korrekt durch.
  pruefe(
    radiusMitHysterese(Number.POSITIVE_INFINITY, 200, band) === Number.POSITIVE_INFINITY,
    'waagerechte Sonne muss die Keulung auch mit Hysterese abschalten'
  );
  pruefe(
    Number.isFinite(radiusMitHysterese(100, Number.POSITIVE_INFINITY, band)),
    'aus dem unendlichen Ring kommt man nicht zurück'
  );
}

console.log(
  fehler === 0
    ? '\nOK — Auswahl radial korrekt, Reihenfolge dicht, Ränder halten'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
