/**
 * Offline flight draws the placement scale like the server does.
 *
 * `platzierungsUpdate` used to drop `scale`, so the ghost and every placed
 * object were drawn at prefab size. The rule now (same as online):
 * `sanitize` clamps scale to 0.2-5, `sollSkala` keeps it only when it differs
 * from 1 by more than 1e-3, and `composeZdoWorld` lets it REPLACE `localScale`.
 *
 * Run: npx tsx client/test/testflug-skala.ts
 */

import { PREFABS_BY_NAME, platzierungenEinzeln } from '@wov/shared';
import { platzierungsUpdate, SKALA_MAX, SKALA_MIN } from '../src/editor/testflug/vorschauZeichnen';

let fehler = 0;
function pruefe(name: string, ok: boolean, info = ''): void {
  if (!ok) fehler++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`);
}

// Server path: sanitize, then layoutAbgleich.sollSkala (0 = none, prefab localScale stays).
function serverSkala(scale: number | undefined): number {
  const p = platzierungenEinzeln([{ prefab: 'FirTree', x: 1, z: 2, ...(scale !== undefined ? { scale } : {}) }])[0];
  return p.scale !== undefined && Math.abs(p.scale - 1) > 1e-3 ? p.scale : 0;
}
// Client path: composeZdoWorld (scale replaces localScale, else localScale, else 1).
function zeichenFaktor(u: Record<string, unknown>, lokal: number): number {
  return typeof u.scale === 'number' ? u.scale : lokal;
}
const MODELL = { b: 1, h: 0.72, t: 0.6 }; // the 1 m upload model of the diagnosis

const lokalKiPine = PREFABS_BY_NAME.get('KiPine3')!.localScale.x;
pruefe('Vorbedingung: KiPine3 hat localScale ≠ 1', lokalKiPine > 1, `${lokalKiPine}`);

for (const scale of [undefined, 1, 1.0005, 3, 0.2, 5, 0.05, 0, -2, 9, 100, NaN] as (number | undefined)[]) {
  for (const prefab of ['FirTree', 'KiPine3']) {
    const u = platzierungsUpdate({ prefab, x: 1, z: 2, scale }, 0, 0, null);
    const lokal = PREFABS_BY_NAME.get(prefab)!.localScale.x;
    const soll = serverSkala(scale === undefined ? undefined : Number.isNaN(scale) ? ('x' as never) : scale);
    const sollFaktor = soll > 0 ? soll : lokal;
    const ist = zeichenFaktor(u, lokal);
    pruefe(
      `${prefab} scale ${scale}: Ausmaße wie Server`,
      Math.abs(ist - sollFaktor) < 1e-9 &&
        Math.abs(MODELL.b * ist - MODELL.b * sollFaktor) < 1e-9,
      `Faktor ${ist} (Server ${sollFaktor})`
    );
  }
}

const b = (s?: number) => platzierungsUpdate({ prefab: 'U_Marktstand2', x: 0, z: 0, scale: s }, 0, 0, null);
pruefe('scale 1: kein scale im Update', !('scale' in b(1)));
pruefe('scale fehlt: kein scale im Update', !('scale' in b()));
pruefe('scale 3: 3 x 2,16 x 1,80 m', b(3).scale === 3 && Math.abs(MODELL.h * 3 - 2.16) < 1e-9 && Math.abs(MODELL.t * 3 - 1.8) < 1e-9);
pruefe('unter der Klemme: auf 0,2', b(0.05).scale === SKALA_MIN);
pruefe('über der Klemme: auf 5', b(9).scale === SKALA_MAX);
pruefe('Geist (i < 0) trägt scale', platzierungsUpdate({ prefab: 'FirTree', x: 0, z: 0, scale: 3 }, -1, 0, null).scale === 3);
pruefe('Grenzen wie der Server', SKALA_MIN === serverSkala(0.0001) && SKALA_MAX === serverSkala(1e6));

console.log(fehler === 0 ? 'ALLE OK' : `${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
