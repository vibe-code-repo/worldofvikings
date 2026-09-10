/**
 * Messrig: der Spielserver mit EINER erfundenen Kiste vor dem Spawn.
 *
 * Wozu. Die Serverkollision (`server/src/world/Kollisionswelt.ts`) haengt
 * an einer Formquelle, die die Kollisionsformen der Prefabs liefert.
 * Solange die noch nicht da ist, laesst sich die Serverseite im SPIEL
 * nicht zeigen — der Server rechnet dann absichtlich wie frueher. Dieses
 * Rig haengt stattdessen eine Quelle mit einer einzigen, frei gesetzten
 * Kiste ein: eine Wand, die NUR der Server kennt.
 *
 * Damit wird sichtbar, was sonst nur ein Test behauptet:
 *  - Der Server haelt den Spieler an, obwohl der Client dort nichts sieht.
 *  - Der Client laeuft weiter und wird zurueckgezogen — man SIEHT also,
 *    wie sich ein Server-Stopp anfuehlt, und misst, wie gross die Drift
 *    dabei wird (`~/wov-lab-mess/kollision-drift.mjs`).
 *
 * Es ist bewusst kein Test: Es behauptet nichts, es stellt eine Lage her.
 *
 * Aufruf (aus dem Arbeitsbaum, Port kommt wie immer aus server.yml):
 *   WOV_INSTANZ=dev WOV_KISTE="x,z,kante" \
 *     node_modules/.bin/tsx tools/kollisions-kistenprobe.mts
 *
 * `WOV_KISTE` ist die Mitte der Kiste in Weltkoordinaten plus ihre
 * Kantenlaenge in Metern; ohne die Variable steht sie bei 0/0 mit 4 m.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWovServer } from '../server/src/WovServer.js';
import { leseServerKonfig } from '../server/src/ServerKonfig.js';
import { ladeModulRegistrierung } from '../server/src/world/dungeon/ModuleBuild.js';
import { instanzName } from '@wov/shared/src/instanz.js';
import { Prefab } from '../server/src/prefab/Prefab.js';
import type { FormQuelle, KollisionsForm } from '@wov/shared/src/kollision/form.js';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../server/data');
const config = leseServerKonfig(DATA_DIR, instanzName());
ladeModulRegistrierung(config.generiertDir);

const [mx, mz, kante] = (process.env['WOV_KISTE'] ?? '0,0,4').split(',').map(Number);
const halb = (kante ?? 4) / 2;

const server = createWovServer(config);
// Erst hochfahren (start() ruft init() selbst — ein zweiter Aufruf legte
// die Welt ein zweites Mal an), dann die Probe einhaengen.
server.start();

/*
  Ein EIGENES Prefab, das nur dieser Prozess kennt — und das ist der Kern
  der Probe.

  Nimmt man einen bestehenden Felsen (Rock_3), baut der Client dort seinen
  eigenen Havok-Koerper und stoppt selbst; man saehe dann gar nicht, WER
  angehalten hat. Ein Prefabname, den der Client nicht kennt, hat drueben
  weder Modell noch Kollisionsform: Er zeichnet nichts, er stoppt nichts —
  was dann passiert, kommt zwingend vom Server.
*/
const PROBE_PREFAB = 'ProbeWandUnsichtbar';
server.prefabs.register(new Prefab(PROBE_PREFAB, { x: 1, y: 1, z: 1 }));
const kisteForm: KollisionsForm = {
  art: 'kiste',
  min: { x: -halb, y: -20, z: -halb },
  max: { x: halb, y: 20, z: halb },
};
const quelle: FormQuelle = {
  formFuer: (name) => (name === PROBE_PREFAB ? kisteForm : null),
};
server.kollisionswelt.setzeFormQuelle(quelle);

const prefab = server.prefabs.getByName(PROBE_PREFAB);
if (!prefab) throw new Error(`Prefab ${PROBE_PREFAB} fehlt in der Registry`);
// Die Form ist LOKAL zur Instanz und wird mit ihr skaliert — die
// localScale des Prefabs zaehlt also mit (wie im Client, s.
// EntityManager.composeZdoWorld). Deshalb hier ausrechnen und ausgeben,
// statt die Kantenlaenge zu behaupten.
const s = prefab.localScale.x;
const y = server.getGroundHeight(mx ?? 0, mz ?? 0);
server.zdos.createZDO(prefab.hash, { x: mx ?? 0, y, z: mz ?? 0 });

console.log(
  `[Kistenprobe] unsichtbare Wand um ${mx}/${mz} (Hoehe ${y.toFixed(1)}), ` +
    `Halbkante ${(halb * s).toFixed(2)} m — Flanken bei x = ` +
    `${((mx ?? 0) - halb * s).toFixed(2)} und ${((mx ?? 0) + halb * s).toFixed(2)}`
);

process.on('SIGINT', () => { server.stop(); process.exit(0); });
process.on('SIGTERM', () => { server.stop(); process.exit(0); });
