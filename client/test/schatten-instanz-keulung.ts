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
 */
import {
  NEUPACK_ABSTAND,
  brauchtNeupacken,
  packeInstanzenRadial,
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

console.log(
  fehler === 0
    ? '\nOK — Auswahl radial korrekt, Reihenfolge dicht, Ränder halten'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
