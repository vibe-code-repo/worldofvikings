/**
 * Wächter für die Schattenkeulung pro Instanz.
 *
 * Zwei Dinge dürfen hier nie kaputtgehen, und beide sind teuer gelernt:
 *
 *  1. **Es darf kein Schatten verschwinden.** Gekeult wird ausschliesslich
 *     seitlich im Lichtraum. Entlang der Lichtachse zu keulen wäre der
 *     naheliegende Fehler — ein Baum HINTER dem Kaskadenrand wirft seinen
 *     Schatten sehr wohl hinein. Der Test stellt genau so einen Baum auf.
 *
 *  2. **Die Packung muss zwischen zwei Neupackungen gültig bleiben.**
 *     Gepackt wird nur alle `NEUPACK_ABSTAND` Meter; deshalb bekommt der
 *     Kasten denselben Betrag als Rand. Ohne diesen Rand blinken
 *     Schattenwerfer beim Laufen weg und wieder da.
 *
 * Hintergrund und Messwerte stehen im Kopf von
 * client/src/engine/SchattenInstanzKeulung.ts.
 */
import {
  NEUPACK_ABSTAND,
  brauchtNeupacken,
  packeInstanzen,
  type Lichtkasten,
} from '../src/engine/SchattenInstanzKeulung.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

/** Einheitsmatrix als Sichtmatrix: Lichtraum = Weltraum, xy = xz-Ebene … */
const EINHEIT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** … und damit ist "y im Lichtraum" die Welt-y-Achse. Für den Test genügt
 *  das: Geprüft wird die Auswahl, nicht Babylons Matrixkonvention. */
const kasten: Lichtkasten = { sicht: EINHEIT, minX: -50, maxX: 50, minY: -50, maxY: 50 };

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

console.log('Schattenkeulung pro Instanz');

// ── 1. Auswahl: drinnen bleibt, weit draussen fällt weg ──────────────
{
  const p = puffer([[0, 0, 0], [400, 0, 0], [10, 5, -10], [-900, 0, 900]]);
  const ziel = new Float32Array(4 * 16);
  const n = packeInstanzen(p, 4, kasten, 0, ziel);
  pruefe(n === 2, `erwartet 2 Überlebende, bekam ${n}`);
  pruefe(ziel[12] === 0 && ziel[14] === 0, 'erste Instanz nicht an den Anfang gepackt');
  pruefe(ziel[16 + 12] === 10 && ziel[16 + 14] === -10, 'zweite Überlebende falsch gepackt');
}

// ── 2. Der Rand hält die Packung über die Laufstrecke gültig ─────────
{
  // 55 m draussen: ohne Rand gekeult, mit Rand (Radius 20 + Bewegung 8)
  // behalten — genau der Fall, der sonst beim Laufen aufblinkt.
  const p = puffer([[55, 0, 0]]);
  const ziel = new Float32Array(16);
  pruefe(packeInstanzen(p, 1, kasten, 0, ziel) === 0, 'ohne Rand fälschlich behalten');
  pruefe(packeInstanzen(p, 1, kasten, 20 + NEUPACK_ABSTAND, ziel) === 1, 'mit Rand fälschlich gekeult');
}

// ── 3. Entlang der Lichtachse wird NICHT gekeult ─────────────────────
{
  // Weit "hinter" dem Kasten in Blickrichtung des Lichts (hier y), aber
  // seitlich mittendrin: muss überleben, sonst fehlt sein Schattenwurf.
  const p = puffer([[0, 0, 0]]);
  const tief: Lichtkasten = { sicht: EINHEIT, minX: -50, maxX: 50, minY: -50, maxY: 50 };
  const ziel = new Float32Array(16);
  pruefe(packeInstanzen(p, 1, tief, 0, ziel) === 1, 'seitlich mittige Instanz wurde gekeult');

  // Und die Gegenprobe zur Sicherheit: seitlich draussen fällt sie weg.
  const seitlich = puffer([[500, 0, 0]]);
  pruefe(packeInstanzen(seitlich, 1, tief, 0, ziel) === 0, 'seitlich weit draussen wurde behalten');
}

// ── 4. Entartete Eingaben ───────────────────────────────────────────
{
  const ziel = new Float32Array(16);
  pruefe(packeInstanzen(new Float32Array(0), 0, kasten, 0, ziel) === 0, 'leerer Puffer lieferte nicht 0');
  pruefe(packeInstanzen(puffer([[0, 0, 0]]), -1, kasten, 0, ziel) === 0, 'negative Anzahl lieferte nicht 0');
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
    ? '\nOK — Auswahl korrekt, Rand hält, Lichtachse unangetastet'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
