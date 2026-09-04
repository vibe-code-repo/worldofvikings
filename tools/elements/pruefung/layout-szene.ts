/**
 * Hilfsmittel: schreibt ein erzeugtes Grab als Posenliste für `render-szene.py`.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * `render-szene.py` baut eine Stelle aus dem Spiel in Blender nach und
 * liest die Posen aus einer JSON-Datei. Diese Datei entstand bisher von
 * Hand (der Kopf dort nennt ein `tools/_scratch/szene-json.ts`, das es im
 * Repo nicht gibt) — eine Szene, die niemand reproduzieren kann, ist als
 * Nachweis wertlos.
 *
 * Mit F4 gibt es dasselbe Kit zweimal, und die interessanteste Frage ist
 * genau die, die kein Einzelmodul beantwortet: Fügt sich die ABLEITUNG zu
 * einem Grab zusammen, oder fehlt irgendwo eine Datei? Dafür braucht es
 * ein ganzes Layout, und dafür dieses Werkzeug.
 *
 * ── Was die Zahlen bedeuten ──────────────────────────────────────────
 * `x/y/z` sind Spielkoordinaten (y = Höhe), `yaw` die Gierung in Grad um
 * die Hochachse. Der Generator liefert eine Quaternion; die Umrechnung
 * `2·atan2(q.y, q.w)` gilt, weil ALLE Drehungen dieses Kits reine
 * Gierungen sind (x und z der Quaternion sind null) — geprüft wird das
 * hier, statt es anzunehmen: eine Kippung stumm auf yaw zu projizieren
 * ergäbe ein Bild, das keiner Szene entspricht.
 *
 * Aufruf:
 *   npx tsx tools/elements/pruefung/layout-szene.ts [--kit=DG_RockVault] [--seed=7] > szene.json
 */
import { DUNGEONS_BY_NAME } from '../../../shared/src/dungeons.js';
import { erzeugeLayoutFuerKit } from '../../messe-stonevault-logik.js';

const argv = process.argv.slice(2);
function arg(name: string, vorgabe: string): string {
  const treffer = argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : vorgabe;
}

const kitName = arg('kit', 'DG_StoneVault');
const seed = Number(arg('seed', '7'));
const def = DUNGEONS_BY_NAME.get(kitName);
if (!def) {
  console.error(`Kit '${kitName}' nicht gefunden.`);
  process.exit(1);
}

const layout = erzeugeLayoutFuerKit(def, seed);
const teile = layout.rooms.map((p) => {
  const q = p.rot;
  if (Math.abs(q.x) > 1e-6 || Math.abs(q.z) > 1e-6) {
    throw new Error(`${p.room}: Drehung ist keine reine Gierung (${JSON.stringify(q)}) — yaw wäre gelogen.`);
  }
  const yaw = (2 * Math.atan2(q.y, q.w) * 180) / Math.PI;
  return { name: p.room, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: Math.round(yaw * 1e6) / 1e6 };
});

// Die Türen stehen NICHT mit im Bild: `placeDoors` setzt sie in die
// Kopplungsebene zwischen zwei Zellen, und für die Frage „fügt sich das
// Grab zusammen" sind sie Beiwerk — für eine Loch-Zählung sogar
// schädlich, weil ein Torbogen eine Öffnung teilweise verdeckt.
console.log(JSON.stringify(teile));
console.error(`${kitName}, Saat ${seed}: ${teile.length} Module.`);
