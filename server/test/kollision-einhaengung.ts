/**
 * Die Naht zwischen den beiden Haelften — eine ECHTE Felsform im
 * Serverraum.
 *
 * `server/test/kollision-formen.ts` prueft, dass die Form STIMMT (dieselbe
 * wie im Client), `server/test/kollision-schritt.ts` prueft, dass die
 * Abfrage RECHNET (gegen von Hand gebaute Kisten). Keiner der beiden
 * fuehrt die Teile zusammen: Der eine sieht die Kollisionswelt nie, der
 * andere nie eine Datei von der Platte. Genau dazwischen liegen die
 * Fehler, die eine Integration macht — eine Wurzel, die ins Leere zeigt,
 * eine Skalierung, die auf halbem Weg verlorengeht, eine Achse, die sich
 * bei der Spiegelung dreht.
 *
 *  (a) DIE WURZEL. `ASSET_WURZEL` muss ohne Argument auf `<repo>/assets`
 *      zeigen. Zeigt sie daneben, ist das NICHT sichtbar: Eine Wurzel,
 *      die es nicht gibt, ist fuer `KollisionsFormen` derselbe Fall wie
 *      ein CI-Checkout ohne Speicher — die Quelle bleibt leer, der Server
 *      startet, und die Figur laeuft durch jeden Felsen. Der Fehler stand
 *      hier (ein `..` zu viel, aus `dungeon/ModuleBuild.ts` uebernommen,
 *      das eine Ebene tiefer liegt) und kostete eine ganze Messreihe.
 *
 *  (b) DER STRAHL. Ein Felsnetz aus dem Speicher in die Kollisionswelt
 *      gesetzt und angeschossen: Der Treffer muss INNERHALB der
 *      Weltumhuellenden liegen und seine Normale zum Strahlursprung
 *      zeigen. Trifft er daneben, steht der Spieler im Bild woanders als
 *      auf dem Server.
 *
 *  (c) DIE SKALIERUNGSKETTE. Derselbe Fels mit Skalierung 2 muss doppelt
 *      so weit ausladen. Faellt die Skalierung aus, laeuft der Server an
 *      halben Felsen vorbei — der Fall, den Rock_3/Rock_4 mit
 *      `localScale 2` im Katalog wirklich haben.
 *
 *  (d) DIE ABBILDUNG. Fels UND Strahl um 90 Grad um y gedreht muessen
 *      denselben Treffer ergeben, mitgedreht: R·P. Das ist die schaerfste
 *      Probe auf die (−x,y,z)-Spiegelung und die Drehmatrix, weil sie
 *      eine GLEICHUNG prueft und keine Plausibilitaet — eine vertauschte
 *      Achse faellt sofort durch, waehrend sie in einer Huellbox-Probe
 *      unsichtbar bliebe.
 *
 *  (e) OBEN STEHEN. Wer auf dem Fels steht, muss auf dem Fels stehen und
 *      nicht in der Gelaendehoehe darunter — die y-Drift, die als Ruck
 *      sichtbar wurde, sobald der weiche Abgleich anzog.
 *
 *   npx tsx server/test/kollision-einhaengung.ts
 *
 * The seam between shape source and collision world, on a real store rock.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createWovServer } from '../src/WovServer.js';
import { ASSET_WURZEL, KollisionsFormen } from '../src/world/KollisionsFormen.js';
import { Kollisionswelt } from '../src/world/Kollisionswelt.js';
import { KOERPER_RADIUS } from '@wov/shared/src/bewegung/masse.js';
import type { KollisionsForm } from '@wov/shared/src/kollision/form.js';

let fehler = 0;
/*
  Reihenfolge wie in `server/test/kollision-formen.ts`: BEDINGUNG zuerst.
  Die Nachbardatei `kollision-schritt.ts` nimmt sie andersherum — wer die
  Zeilen mischt, uebergibt den Namen als Bedingung, und weil ein nicht
  leerer Text wahr ist, wird JEDE Pruefung gruen. Genau das ist hier
  einmal passiert; der Zeuge dagegen ist der Name in der PASS-Zeile.
*/
function pruefe(ok: boolean, name: string, detail = ''): void {
  if (ok) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}

console.log('=== Einhaengung: echte Felsform in der Kollisionswelt ===');

/** Der Pruefling: ein Kliff aus dem Speicher, als exaktes Netz. */
const FELS = 'environment-sm-env-rock-cliff-01';

// ── (a) Die Wurzel ───────────────────────────────────────────────────

pruefe(
  existsSync(ASSET_WURZEL),
  '(a) ASSET_WURZEL zeigt auf einen Ordner, den es gibt',
  ASSET_WURZEL
);
pruefe(
  existsSync(join(ASSET_WURZEL, 'manifest.json')),
  '(a) … und zwar auf `<repo>/assets` (manifest.json liegt darin)'
);

// ── Die Quelle OHNE Argument — genau wie `server/src/main.ts` ────────

const quelle = new KollisionsFormen();
const form: KollisionsForm | null = quelle.formFuer(FELS);

pruefe(form !== null, '(a) die Vorgabewurzel findet den Fels', FELS);
if (form === null || form.art !== 'netz') {
  console.error(`\n${fehler + 1} FEHLER — ohne Form ist der Rest nicht pruefbar`);
  process.exit(1);
}
pruefe(form.art === 'netz', '(a) und liefert das exakte Netz, keine Katalog-Kiste');

const spanneX = form.max.x - form.min.x;
const spanneZ = form.max.z - form.min.z;

// ── Die Kollisionswelt, mit ebenem Boden auf 0 ──────────────────────

const server = createWovServer({ port: 2476, worldSeed: 'KxSYuZquuw', worldFeatures: false });
server.init();
const welt = new Kollisionswelt(server.zdos, server.prefabs, () => 0);

/** Der Strahl der Bewegungsabfrage, quer durch den Fels. */
const HOEHE = 1.0;
const WEIT = 30;

// ── (b) Der Strahl gegen den gesetzten Fels ─────────────────────────

const mitte = welt.nahfeldAus([{ form, position: { x: 0, y: 0, z: 0 } }]);
const treffer = mitte.ersterTreffer(
  { x: -WEIT, y: HOEHE, z: 0 },
  { x: WEIT, y: HOEHE, z: 0 },
  KOERPER_RADIUS
);

pruefe(treffer !== null, '(b) der Strahl trifft den Fels ueberhaupt');
if (treffer !== null) {
  const p = treffer.punkt;
  const drin =
    p.x >= form.min.x - 1e-3 &&
    p.x <= form.max.x + 1e-3 &&
    p.y >= form.min.y - 1e-3 &&
    p.y <= form.max.y + 1e-3 &&
    p.z >= form.min.z - 1e-3 &&
    p.z <= form.max.z + 1e-3;
  pruefe(
    drin,
    '(b) der Treffer liegt in der Huellbox der Form',
    `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`
  );
  /*
    Der Strahl laeuft nach +x, die Normale muss also nach −x weisen.
    Das Skalarprodukt mit der Laufrichtung ist die scharfe Fassung von
    „zeigt zum Ursprung zurueck": Eine nach innen gekehrte Normale (die
    Spiegelung dreht die Umlaufrichtung der Dreiecke um!) waere positiv,
    und der Bewegungsschritt liesse die Figur durch die Wand, weil er nur
    blockt, was sich NAEHERT.
  */
  pruefe(
    treffer.normale.x < -0.5,
    '(b) die Normale zeigt zum Strahlursprung zurueck',
    `n.x = ${treffer.normale.x.toFixed(3)}`
  );
  // Vor der Wand, nicht dahinter: die Figur haelt an der nahen Flanke.
  pruefe(
    p.x < 0,
    '(b) getroffen wird die ZUGEWANDTE Flanke',
    `x = ${p.x.toFixed(2)} < 0`
  );
}

// ── (c) Die Skalierungskette ────────────────────────────────────────

const gross = welt.nahfeldAus([
  { form, position: { x: 0, y: 0, z: 0 }, skalierung: { x: 2, y: 2, z: 2 } },
]);
const trefferGross = gross.ersterTreffer(
  { x: -WEIT, y: HOEHE, z: 0 },
  { x: WEIT, y: HOEHE, z: 0 },
  KOERPER_RADIUS
);
pruefe(trefferGross !== null, '(c) der doppelt so grosse Fels wird getroffen');
if (treffer !== null && trefferGross !== null) {
  /*
    Nicht exakt das Doppelte: Der Strahl laeuft auf FESTER Welthoehe durch
    einen mitskalierten Koerper, trifft also eine andere Stelle der
    Oberflaeche. Die Flanke muss aber deutlich weiter aussen liegen — der
    Fehlerfall „Skalierung faellt aus" gaebe exakt dieselbe Zahl.
  */
  const verhaeltnis = trefferGross.punkt.x / treffer.punkt.x;
  pruefe(
    verhaeltnis > 1.5 && verhaeltnis < 2.5,
    '(c) mit Skalierung 2 liegt die Flanke rund doppelt so weit aussen',
    `${treffer.punkt.x.toFixed(2)} → ${trefferGross.punkt.x.toFixed(2)} (×${verhaeltnis.toFixed(2)})`
  );
}

// ── (d) Die Abbildung: Drehung um 90 Grad um y ──────────────────────

/*
  Fels und Strahl gemeinsam gedreht — dann MUSS derselbe Punkt
  herauskommen, nur mitgedreht. R_y(90 Grad) bildet (x, y, z) auf
  (z, y, −x) ab.
*/
const s = Math.SQRT1_2;
const gedreht = welt.nahfeldAus([
  { form, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: s, z: 0, w: s } },
]);
const trefferGedreht = gedreht.ersterTreffer(
  { x: 0, y: HOEHE, z: WEIT },
  { x: 0, y: HOEHE, z: -WEIT },
  KOERPER_RADIUS
);
pruefe(trefferGedreht !== null, '(d) der gedrehte Fels wird vom gedrehten Strahl getroffen');
if (treffer !== null && trefferGedreht !== null) {
  const sollX = treffer.punkt.z;
  const sollY = treffer.punkt.y;
  const sollZ = -treffer.punkt.x;
  const dp = Math.max(
    Math.abs(trefferGedreht.punkt.x - sollX),
    Math.abs(trefferGedreht.punkt.y - sollY),
    Math.abs(trefferGedreht.punkt.z - sollZ)
  );
  pruefe(
    dp < 1e-3,
    '(d) der Treffer ist der mitgedrehte Treffer (R·P)',
    `Abweichung ${dp.toExponential(1)} m`
  );
  const dn = Math.max(
    Math.abs(trefferGedreht.normale.x - treffer.normale.z),
    Math.abs(trefferGedreht.normale.y - treffer.normale.y),
    Math.abs(trefferGedreht.normale.z + treffer.normale.x)
  );
  pruefe(dn < 1e-3, '(d) … und die Normale die mitgedrehte Normale (R·n)', `Abweichung ${dn.toExponential(1)}`);
}

// ── (e) Auf dem Fels stehen ─────────────────────────────────────────

/*
  Die Fuesse ueber den Gipfel setzen und nach unten fragen. Ohne die
  Formen antwortet hier das Gelaende (0) — mehrere Meter unter dem, was
  der Client zeigt. Der Bodenstrahl reicht nur `BODEN_TIEFE` weit, die
  Fuesse muessen also dicht ueber der Kuppe stehen.
*/
const gipfel = mitte.hoeheBei(0, 0, form.max.y + 0.5);
pruefe(
  gipfel !== null && gipfel > 1,
  '(e) wer oben steht, steht auf dem Fels und nicht im Gelaende',
  `y = ${gipfel === null ? 'null' : gipfel.toFixed(2)} statt 0`
);
pruefe(
  gipfel !== null && gipfel <= form.max.y + 1e-3,
  '(e) … und nicht ueber seiner Oberkante',
  `${gipfel === null ? 'null' : gipfel.toFixed(2)} ≤ ${form.max.y.toFixed(2)}`
);

// ── Zeuge fuer den Bericht ──────────────────────────────────────────

console.log(
  `  INFO Fels ${FELS}: ${form.indizes.length / 3} Dreiecke, ` +
    `Huellbox ${spanneX.toFixed(2)} × ${(form.max.y - form.min.y).toFixed(2)} × ${spanneZ.toFixed(2)} m`
);

console.log(
  fehler === 0
    ? '\nOK — die Formquelle sitzt in der Kollisionswelt, Achsen und Skalierung stimmen'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
