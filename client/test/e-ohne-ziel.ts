/**
 * D5 — the E key without a target must not send `dungeon enter` to a player who has no business with a dungeon.
 *
 * Fault (DEV 02.10.2026): E with nothing in reach fell through to `sendAdminCommand('dungeon enter')`; a player without admin
 * rights got "Admin commands are not allowed for this player" on every such press.
 *
 *  [1] The pure rule (`eOhneZiel`): overworld, no entrance near -> nothing; entrance within 16 m -> enter; dungeon -> leave / hint.
 *  [2] main.ts: the only `dungeon enter` goes through the rule, and the file did not grow (3682 lines before this card).
 *
 * Run: npx tsx client/test/e-ohne-ziel.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eOhneZiel, DUNGEON_BETRETEN_M, DUNGEON_VERLASSEN_M } from '../src/player/eOhneZiel';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string, detail = ''): void => {
  console.log(`  ${bedingung ? 'PASS' : 'FAIL'}  ${text}${detail ? ' — ' + detail : ''}`);
  if (!bedingung) fehler++;
};
// Asymmetric on purpose: x and z differ everywhere, so a swapped axis cannot hide behind equal numbers.
const lage = (o: Partial<Parameters<typeof eOhneZiel>[0]> = {}) => ({ imDungeon: false, pos: { x: 100, z: 120 }, dungeonSpawn: { x: 10, z: 20 }, eingaenge: [], ...o });

pruefe(eOhneZiel(lage()) === 'nichts', 'overworld, no entrance known: nothing (no dungeon enter)');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 500, z: 500 }] })) === 'nichts', 'overworld, entrance far away: nothing');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100 + DUNGEON_BETRETEN_M, z: 120 }] })) === 'dungeon-enter', 'entrance exactly 16 m away in x: enter');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100 + DUNGEON_BETRETEN_M + 0.5, z: 120 }] })) === 'nichts', 'entrance 16.5 m away in x: nothing');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100, z: 120 + DUNGEON_BETRETEN_M }] })) === 'dungeon-enter', 'entrance exactly 16 m away in z: enter');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100, z: 120 + DUNGEON_BETRETEN_M + 0.5 }] })) === 'nichts', 'entrance 16.5 m away in z: nothing');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 500, z: 500 }, { x: 105, z: 120 }] })) === 'dungeon-enter', 'any one near entrance is enough');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 110, z: 130 }] })) === 'dungeon-enter', 'the distance counts in x AND z (14.1 m)');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 112, z: 132 }] })) === 'nichts', 'the distance counts in x AND z (17 m)');
const drin = (dx: number, dz: number) => eOhneZiel(lage({ imDungeon: true, pos: { x: 10 + dx, z: 20 + dz } }));
pruefe(drin(3, 4) === 'dungeon-leave', 'in a dungeon at 5 m from the entry: leave');
pruefe(drin(DUNGEON_VERLASSEN_M, 0) === 'dungeon-leave', 'in a dungeon at exactly 6 m in x: leave');
pruefe(drin(DUNGEON_VERLASSEN_M + 0.5, 0) === 'hinweis-eingang', 'in a dungeon at 6.5 m in x: the hint');
pruefe(drin(0, DUNGEON_VERLASSEN_M) === 'dungeon-leave', 'in a dungeon at exactly 6 m in z: leave');
pruefe(drin(0, DUNGEON_VERLASSEN_M + 0.5) === 'hinweis-eingang', 'in a dungeon at 6.5 m in z: the hint');
pruefe(eOhneZiel(lage({ imDungeon: true, eingaenge: [{ x: 100, z: 120 }] })) === 'hinweis-eingang', 'in a dungeon the overworld entrances do not count');

const quelle = readFileSync(resolve(import.meta.dirname, '../src/main.ts'), 'utf8');
const zeilen = quelle.split('\n').length - 1;
const treffer = quelle.match(/sendAdminCommand\('dungeon enter'\)/g) ?? [];
pruefe(treffer.length === 1, "main.ts sends the bare 'dungeon enter' exactly once", String(treffer.length));
pruefe(/aktion === 'dungeon-enter'\)\s*socket\.sendAdminCommand\('dungeon enter'\)/.test(quelle), "... and only when the rule says 'dungeon-enter'");
pruefe(/eOhneZiel\(\{[^}]*dungeonEingaenge/.test(quelle), 'the rule is fed with the entrances the server sent');
pruefe(/aktion === 'dungeon-leave'\)\s*socket\.sendAdminCommand\('dungeon leave'\)/.test(quelle), "'dungeon-leave' sends `dungeon leave`");
pruefe(/aktion === 'hinweis-eingang'\)\s*hud\.meldung\(/.test(quelle), "'hinweis-eingang' shows the hint");
pruefe(/eOhneZiel\(\{ imDungeon, pos: player\.position, dungeonSpawn,/.test(quelle), 'the rule is fed with the dungeon flag, the position and the entry point');
pruefe(zeilen <= 3682, 'main.ts did not grow', `${zeilen} lines (limit 3682, guard 3700)`);

console.log(fehler === 0 ? '\ne-ohne-ziel: OK' : `\ne-ohne-ziel: ${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
