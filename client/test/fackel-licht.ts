/**
 * Prueft den ABFALL des Fackellichts im erzeugten Shader — ohne GPU.
 * Checks the torch light's distance falloff in the generated shader.
 *
 * ── Warum es diesen Test gibt ──────────────────────────────────────────
 * Am 05.09.2026 lautete ein Befund: „Das Licht der Fackeln verteilt sich im
 * Raum nicht realistisch." Die Hauptursache lag woanders (das Steinmaterial
 * beleuchtete die falsche Seite, s. `client/test/stein-normal.ts`), aber
 * eine zweite blieb: `1/d²` ist das Gesetz fuer einen PUNKT, und eine
 * Flamme ist keiner. Bei 15 cm — dem Abstand der Wand, an der die Fackel
 * haengt — liefert die Punktformel den Faktor 44; alles darueber ist im
 * Bild dieselbe weisse Flaeche.
 *
 * `bausteinGlsl()` rechnet deshalb mit `1/(d² + r²)`, dem Gesetz fuer eine
 * leuchtende KUGEL. Was hier gemessen wird, ist nicht „sieht besser aus",
 * sondern dreierlei, das man ohne GPU festhalten kann:
 *
 *  1. Im PBR-Zweig steht die Kugelformel MIT genau der Zahl, die
 *     `FACKEL_RADIUS_M` nennt — und nicht eine zweite, die daneben
 *     geschrieben wurde.
 *  2. Der StandardMaterial-Zweig bleibt LINEAR. Er bildet Babylons
 *     `computeLighting` nach; eine Kugelformel dort waere eine andere
 *     Beleuchtung fuer den Bodenbewuchs als fuer alles andere.
 *  3. Die Zahlen selbst: Der Abfall wird an vier Abstaenden nachgerechnet,
 *     damit „nah gedaempft, fern unveraendert" eine Zusage mit Grenzen ist
 *     und keine Absicht.
 *
 * Das reale Bild misst `tools/elements/pruefung/fackel-profil.mjs` im Grab
 * `licht-probe` (Gedaechtnis „Gruene Tests sind kein Fenster").
 */
import assert from 'node:assert/strict';
import { bausteinGlsl, FACKEL_RADIUS_M, FACKEL_OBERGRENZE } from '../src/engine/FackelLicht';

let rot = 0;
function pruefe(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    rot++;
    console.log(`  ROT  ${name}: ${(e as Error).message}`);
  }
}

const pbr = bausteinGlsl(true, FACKEL_OBERGRENZE);
const standard = bausteinGlsl(false, FACKEL_OBERGRENZE);
const r2 = FACKEL_RADIUS_M * FACKEL_RADIUS_M;

pruefe('der PBR-Zweig rechnet mit der endlichen Flammengroesse', () => {
  assert.ok(
    pbr.includes(`float abfall = fenster / (d2 + ${r2.toFixed(6)});`),
    `Kugelformel mit r² = ${r2.toFixed(6)} fehlt im PBR-Zweig:\n${pbr}`
  );
});

pruefe('und nirgends mehr mit der Punktformel', () => {
  // `max(d2, 1e-4)` war der alte Nenner. Er ist kein Kugelradius, sondern
  // eine Notbremse gegen die Division durch null — und genau die brauchte
  // es, WEIL die Formel bei null explodiert.
  assert.ok(!pbr.includes('max(d2, 1e-4)'), 'die alte Punktformel steht noch im PBR-Zweig');
});

pruefe('der StandardMaterial-Zweig bleibt linear', () => {
  // Babylons `computeLighting` rechnet fuer StandardMaterial linear ueber
  // die Reichweite. Das ist kein Versehen, das man mitkorrigiert: Der
  // komplette Bodenbewuchs haengt daran, und zwei Gesetze fuer dasselbe
  // Licht sind schlimmer als ein ungenaues.
  assert.ok(standard.includes('1.0 - sqrt(d2)'), 'der lineare Abfall fehlt');
  assert.ok(!standard.includes(`d2 + ${r2.toFixed(6)}`), 'die Kugelformel ist in den falschen Zweig geraten');
});

pruefe('nah gedaempft, fern unveraendert — mit Zahlen', () => {
  const punkt = (d: number): number => 1 / Math.max(d * d, 1e-4);
  const kugel = (d: number): number => 1 / (d * d + r2);
  // 15 cm: der Abstand der Wand hinter der Fackel. Hier MUSS es wirken.
  assert.ok(kugel(0.15) / punkt(0.15) < 0.35, `bei 0,15 m nur ${(kugel(0.15) / punkt(0.15)).toFixed(2)} gedaempft`);
  // 1 m: spuerbar, aber klein.
  assert.ok(kugel(1) / punkt(1) > 0.9, 'bei 1 m zu stark gedaempft');
  // 4 m und weiter: praktisch dasselbe Licht wie vorher. Ohne diese Grenze
  // waere aus der Korrektur eine allgemeine Verdunklung geworden.
  assert.ok(kugel(4) / punkt(4) > 0.99, 'bei 4 m ist es keine Nahfeld-Korrektur mehr');
  assert.ok(kugel(8) / punkt(8) > 0.995, 'bei 8 m ist es keine Nahfeld-Korrektur mehr');
});

pruefe('die Flamme ist als Kugel kleiner als der Raum, in dem sie haengt', () => {
  // Eine Zelle ist 2 m breit, die Wandflaeche steht 0,7 m von der Mitte.
  // Ein Radius in dieser Groessenordnung wuerde das Licht flach machen
  // statt es zu baendigen — die Zahl gehoert an die Flamme, nicht an den Raum.
  assert.ok(FACKEL_RADIUS_M > 0.05 && FACKEL_RADIUS_M < 0.5, `unplausibler Flammenradius ${FACKEL_RADIUS_M}`);
});

console.log(rot === 0 ? 'alles gruen' : `${rot} rot`);
process.exit(rot === 0 ? 0 : 1);
