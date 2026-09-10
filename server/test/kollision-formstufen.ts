/**
 * Wie viele Kollisionsformen eine Gegend braucht — an einer echten Welt
 * gezaehlt.
 *
 * DAS PROBLEM. Die Kollisionsform steht LOKAL zur Instanz (s. Kopf von
 * `shared/src/kollision/form.ts`), die Instanzgroesse muss deshalb IN die
 * Form gerechnet werden — im Client als eigenes Havok-Shape, beim Netz
 * sogar als eigenes Babylon-Mesh mit einer eigenen Kopie aller
 * Vertexdaten (`client/src/engine/Physics.ts`, `buildShape`). Solange die
 * Groesse aus `state.rangeFloat(scaleMin, scaleMax)` kommt und der
 * Formschluessel auf einen Millimeter genau war, hiess das: eine Form je
 * STEIN. Der Kopfkommentar von `Physics.ts` ging von „rund 30
 * Groessenklassen" aus.
 *
 * WAS HIER GEZAEHLT WIRD. Eine kuratierte Region wird wirklich gestreut
 * (dasselbe Muster wie `server/test/e2-vegetation.ts`), die ECHTEN
 * ZDO-Groessen im 48-m-Fenster um den Nullpunkt werden ausgelesen, und
 * dann zweimal gezaehlt: wie viele verschiedene Formschluessel es mit dem
 * alten Millimeterraster gaebe und wie viele mit `skalierungsStufe`. Die
 * Zahl steht in der Ausgabe, nicht nur die Schranke — eine
 * Verschlechterung soll man sehen, bevor sie eine Grenze reisst.
 *
 * WAS ER NICHT PRUEFT. Ob die Ersparnis im Client ankommt: Das haengt an
 * `Physics.formFuerSkalierung`, und der braucht Babylon. Dass CLIENT und
 * SERVER dieselbe Stufe rechnen, haengt dagegen nur daran, dass beide
 * dieselbe Funktion rufen — das ist im Quelltext zu sehen und nicht zu
 * messen.
 *
 * Braucht keine Modelldatei: gezaehlt werden Groessen, nicht Dreiecke.
 *
 * Lauf: npx tsx server/test/kollision-formstufen.ts   (aus server/)
 */
import {
  GRASLAND_FLORA_NAMEN,
  HeightmapProvider,
  RegionGeo,
  getStableHash,
  sanitizeWorldLayout,
  skalierungsStufe,
  SKALIERUNGS_STUFEN_JE_OKTAVE,
} from '@wov/shared';
import { FELS_NAME } from '@wov/shared/src/kollision/formen.js';
import { STORE_FELSEN_NAMEN } from '@wov/shared/src/storeFelsen.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

let fehler = 0;
function pruefe(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); fehler++; }
}

console.log('=== Groessenstufen: wie viele Formen eine Gegend braucht ===');

// ── Die Funktion selbst ────────────────────────────────────────────
{
  // Der Fehler haengt am ANTEIL, nicht an der Groesse — das ist der
  // Grund fuer „je Oktave" statt „je Zentimeter".
  let groessterAnteil = 0;
  for (let i = 0; i < 20000; i += 1) {
    const s = 0.05 + (i / 20000) * 19.95;
    const g = skalierungsStufe(s);
    const anteil = (g > s ? g - s : s - g) / s;
    if (anteil > groessterAnteil) groessterAnteil = anteil;
  }
  const schranke = 1 / (2 * SKALIERUNGS_STUFEN_JE_OKTAVE) + 1e-12; // halbe Stufe bei s=1
  pruefe('kein Wert weicht um mehr als eine halbe Stufe ab',
    groessterAnteil <= schranke, `groesster Anteil ${(groessterAnteil * 100).toFixed(3)} %`);

  // Zweimal einrasten muss dasselbe ergeben — sonst driftet jede Form,
  // die durch zwei Haende geht.
  let unstet = 0;
  for (let i = 0; i < 20000; i += 1) {
    const s = 0.05 + (i / 20000) * 19.95;
    if (skalierungsStufe(skalierungsStufe(s)) !== skalierungsStufe(s)) unstet += 1;
  }
  pruefe('die Stufe ist fest: zweimal einrasten aendert nichts', unstet === 0, `${unstet} Abweichungen`);

  // Glatte Zahlen bleiben, wie sie sind — sonst waere jede Handarbeit im
  // Editor („Skalierung 2") plötzlich 1,95 oder 2,05.
  for (const s of [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 8, 0.125]) {
    pruefe(`glatte Groesse ${s} bleibt unveraendert`, skalierungsStufe(s) === s);
  }
  pruefe('0 bleibt 0', skalierungsStufe(0) === 0);
  pruefe('negative Groessen behalten ihr Vorzeichen', skalierungsStufe(-2) === -2);
  pruefe('NaN wird nicht in eine plausible Zahl verwandelt', Number.isNaN(skalierungsStufe(NaN)));
}

// ── Die echte Welt ─────────────────────────────────────────────────
const SEED = getStableHash('KxSYuZquuw-stufen');
const layout = sanitizeWorldLayout({
  version: 1,
  name: 'Stufen-Probe',
  detailSeed: 'stufen',
  continents: [],
  regions: [{
    id: 'probe',
    biome: 'grassland',
    shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
    edgeFalloff: 200,
    baseLevel: 0.3,
    vegetation: [...GRASLAND_FLORA_NAMEN],
  }],
});
if (!layout) throw new Error('Testlayout verworfen');
const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
const zdos = new ZDOManager(1n);
const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
zm.update([{ x: 0, y: 40, z: 0 }], 60_000);

const alle = [];
for (let zy = -6; zy <= 6; zy += 1) {
  for (let zx = -6; zx <= 6; zx += 1) alle.push(...zdos.getZDOsInZone({ x: zx, y: zy }));
}

// Felsen sind die teuren: ihre Form ist ein NETZ, und jede eigene Form
// ist eine eigene Kopie der Vertexdaten.
const felsNamen = GRASLAND_FLORA_NAMEN.filter((n) => FELS_NAME.test(n) || STORE_FELSEN_NAMEN.has(n));
const hashZuName = new Map<unknown, string>();
for (const n of felsNamen) hashZuName.set(getStableHash(n), n);

/*
  Gezaehlt wird in mehreren Fenstern, und das ist kein Zierrat: Der
  Client haelt nicht 48 m, sondern die GELADENEN ZONEN (ZONE_SIZE = 64 m)
  in der Physikwelt. In 48 m stehen so wenige Steine, dass sich zwei
  ohnehin selten dieselbe Groesse teilen — dort ist auch mit Stufen
  nichts zu gewinnen, und das soll die Ausgabe zeigen statt es zu
  verschweigen. Ab 128 m greift es, ab 320 m halbiert es.

  Der Grund ist eine Saettigung: Mit dem Millimeterraster waechst die
  Zahl der Formen LINEAR mit der Zahl der Steine (jeder bringt seine
  eigene mit); mit den Stufen laeuft sie gegen „Klassen mal Stufen im
  natuerlichen Groessenbereich" und bleibt dann stehen.
*/
const FENSTER = [48, 128, 320];
const messung = new Map<number, { steine: number; klassen: number; vorher: number; nachher: number }>();
for (const w of FENSTER) {
  const liste: Array<{ name: string; skala: number }> = [];
  for (const zdo of alle) {
    const name = hashZuName.get(zdo.prefabHash as unknown);
    if (name === undefined) continue;
    const dx = zdo.position.x, dz = zdo.position.z;
    if (Math.sqrt(dx * dx + dz * dz) > w) continue;
    const members = zdo.getMembers() as Map<number, { type: number; value: unknown }>;
    const skalar = [...members.values()].find((m) => m.type === 0);
    liste.push({ name, skala: skalar !== undefined ? (skalar.value as number) : 1 });
  }
  const vorher = new Set(liste.map((e) => `${e.name}|${e.skala.toFixed(3)}`));
  const nachher = new Set(liste.map((e) => `${e.name}|${skalierungsStufe(e.skala)}`));
  const klassen = new Set(liste.map((e) => e.name));
  messung.set(w, { steine: liste.length, klassen: klassen.size, vorher: vorher.size, nachher: nachher.size });
  console.log(
    `  MESSWERT ${w} m: ${liste.length} Felsen aus ${klassen.size} Klassen, ` +
    `${vorher.size} Formen mit dem Millimeterraster -> ${nachher.size} mit den Groessenstufen`
  );
}

const nah = messung.get(48)!;
pruefe('es stehen ueberhaupt Felsen im Nahfenster', nah.steine >= 5, `${nah.steine}`);
pruefe('das Millimeterraster gab (fast) je Stein eine eigene Form',
  nah.vorher / nah.steine > 0.8,
  `${nah.vorher} von ${nah.steine} = ${((nah.vorher / nah.steine) * 100).toFixed(0)} %`);

const weit = messung.get(320)!;
pruefe('ueber die geladenen Zonen halbieren die Stufen die Formen',
  weit.nachher <= weit.vorher / 1.8,
  `${weit.vorher} -> ${weit.nachher} bei ${weit.steine} Felsen`);
pruefe('… und ihre Zahl bleibt durch Klassen mal Stufen gedeckelt',
  weit.nachher <= weit.klassen * 32,
  `${weit.nachher} <= ${weit.klassen} x 32`);

console.log(fehler === 0 ? '\nALLE GRUEN' : `\n${fehler} FEHLER`);
process.exit(fehler > 0 ? 1 : 0);
