/**
 * Wächter für die GEMESSENE Werfer-Regel (G5).
 *
 * Bis G5 entschied ein Regex über Namen, was Schatten wirft. Ein Regex
 * über Namen ist eine Liste, und eine Liste wird bei jedem neuen Modell
 * stillschweigend falsch — in beide Richtungen und ohne Symptom. Seit G5
 * entscheidet die gemessene Modellhöhe (Shadows.MIN_WURF_HOEHE_M).
 *
 * Die zwei Zusagen, die dabei brechen können, stehen hier:
 *
 *  1. Die Skalenmessung überschätzt, sie unterschätzt NIE. Ein zu grosser
 *     Wert lässt einen Werfer stehen; ein zu kleiner löscht einen
 *     sichtbaren Schatten, und das ist der Fehler, den man im Bild sucht
 *     und nicht findet.
 *  2. „Nicht gemessen" ist NICHT „klein". Gelände, Spieler, Dungeon-
 *     Architektur und Himmel laufen nie durch den Instanzpfad; würde
 *     `undefined` als 0 gelesen, verlöre der Boden seinen Schattenwurf.
 *
 * Ohne Szene und ohne GPU gerechnet — beide Grössen sind reine Zahlen,
 * und genau deshalb sind sie hier prüfbar.
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { gemesseneModellHoehe, groessteInstanzSkala } from '../src/entities/EntityManager';
import { MIN_WURF_HOEHE_M } from '../src/engine/Shadows';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Gemessene Werfer-Regel (Modellhöhe)');

/** Instanzmatrix mit gleichmässiger Skalierung, spaltenweise wie Babylon. */
function skaliert(s: number): number[] {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
}

// ── 1. Gleichmässige Skalierung ─────────────────────────────────────
{
  pruefe(groessteInstanzSkala(new Float32Array(skaliert(1))) === 1, 'Einheitsskala nicht 1');
  pruefe(groessteInstanzSkala(new Float32Array(skaliert(2.5))) === 2.5, 'Skala 2,5 nicht erkannt');
  // Über mehrere Instanzen zählt das MAXIMUM, nicht die letzte.
  const mehrere = new Float32Array([...skaliert(3), ...skaliert(1)]);
  pruefe(groessteInstanzSkala(mehrere) === 3, 'Maximum über mehrere Instanzen verfehlt');
}

// ── 2. Ungleichmässige Skalierung wird ÜBERSCHÄTZT, nie unterschätzt ─
{
  // x 0,5 / y 1 / z 4 — die Regel nimmt 4, nicht 0,5 und nicht 1.
  const krumm = new Float32Array([0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);
  pruefe(groessteInstanzSkala(krumm) === 4, 'ungleichmässige Skala wurde unterschätzt');
}

// ── 3. Drehung ist keine Skalierung ─────────────────────────────────
{
  // 90 Grad um y, Skala 1: Die Spaltennormen bleiben 1.
  const gedreht = new Float32Array([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 7, 3, -2, 1]);
  pruefe(
    Math.abs(groessteInstanzSkala(gedreht) - 1) < 1e-6,
    'eine reine Drehung wurde als Skalierung gelesen'
  );
}

// ── 4. Entartete Eingaben ───────────────────────────────────────────
{
  pruefe(groessteInstanzSkala(new Float32Array(0)) === 0, 'leerer Puffer lieferte nicht 0');
  // Ein angebrochener Puffer darf nicht über das Ende hinauslesen.
  pruefe(groessteInstanzSkala(new Float32Array(7)) === 0, 'Teilmatrix wurde ausgewertet');
}

// ── 5. „Nicht gemessen" ist nicht „klein" ───────────────────────────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const fremd = new Mesh('terrain_0_0', scene);
  pruefe(
    gemesseneModellHoehe(fremd) === undefined,
    'ein nie gemessenes Mesh liefert eine Zahl — der Boden verlöre seinen Schattenwurf'
  );
  scene.dispose();
  engine.dispose();
}

// ── 6. Die Schwelle selbst ──────────────────────────────────────────
{
  // Die Zahl ist eine Look-/Kostenentscheidung und gehört festgenagelt:
  // Wer sie ändert, ändert die Werferliste der ganzen Welt. Seit dem
  // Angreifer-Review vom 13.09.2026 steht sie auf 0,35 m statt 0,5 —
  // ausgezählt am Katalog und an der gebauten Welt; die Herleitung samt
  // der zehn Prefabs, die sie weiterhin kostet, steht im Kopf von
  // MIN_WURF_HOEHE_M.
  pruefe(MIN_WURF_HOEHE_M === 0.35, `Schwelle steht auf ${MIN_WURF_HOEHE_M}, erwartet 0,35 m`);
}

console.log(
  fehler === 0
    ? '\nOK — Skala überschätzt, Drehung zählt nicht, ungemessen bleibt Werfer'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
