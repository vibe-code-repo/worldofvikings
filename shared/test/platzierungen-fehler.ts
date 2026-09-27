/**
 * Editor E2, card K5.0 N4: `platzierungenFehler` (raw placements, before the sanitizer) and `geklemmteFelder`.
 *
 *   npx tsx test/platzierungen-fehler.ts      (from shared/)
 *
 * What counts as a typo: everything the sanitizer would drop, clamp, cut or ignore in a field the user set:
 * a bad prefab / coordinate, `yaw: "abc"`, `scale: null`, `einebnen: null`, `npc.stufe: null`, a name over 32
 * characters, `npc: []` / `npc: {}`, an unknown key (`Yaw`, `npc.Rolle`), a non-object entry.
 * What does NOT (false alarms): numbers as text ("3", " 4 ", "1e0"), null on the optional fields that read as missing
 * (`yaw`, `route`, `npc`, `npc.name/rolle/fraktion/quest`), rounding, a wrong prefab (another valid entry; a wrong id is an error since N5),
 * everything the editor writes (yaw up to 2 pi, scale 0.2-5, npc with any of the five keys).
 */
import { geklemmteFelder, platzierungenFehler, platzierungenFehlerText, sanitizeWorldLayout } from '../src/worldlayout/sanitize.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}
const basis = { id: 'a1', prefab: 'Beech1', x: 1, z: 2 };
const felder = (e: Record<string, unknown>): string => platzierungenFehler([{ ...basis, ...e }]).map((f) => f.feld).join(',');

// typos: each names its field
check('yaw "abc"', felder({ yaw: 'abc' }) === 'yaw');
check('yaw over 2 pi', felder({ yaw: 7 }) === 'yaw');
check('scale "abc", 99, 0, null', felder({ scale: 'abc' }) === 'scale' && felder({ scale: 99 }) === 'scale' && felder({ scale: 0 }) === 'scale' && felder({ scale: null }) === 'scale');
check('einebnen null / 0 / "x"', felder({ einebnen: null }) === 'einebnen' && felder({ einebnen: 0 }) === 'einebnen' && felder({ einebnen: 'x' }) === 'einebnen');
check('route with a space', felder({ route: 'Nord Weg' }) === 'route');
check('npc as text / array / empty object', felder({ npc: 'x' }) === 'npc' && felder({ npc: [] }) === 'npc' && felder({ npc: {} }) === 'npc');
check('npc.stufe null / "abc" / 0', felder({ npc: { stufe: null } }) === 'npc.stufe' && felder({ npc: { stufe: 'abc' } }) === 'npc.stufe' && felder({ npc: { stufe: 0 } }) === 'npc.stufe');
check('npc.name of 33 characters is cut: reported; 32 is not', felder({ npc: { name: 'x'.repeat(33) } }) === 'npc.name' && felder({ npc: { name: 'x'.repeat(32) } }) === '');
check('npc.name not a string', felder({ npc: { name: 5 } }) === 'npc.name');
check('npc.rolle / fraktion / quest unknown', felder({ npc: { rolle: 'zzz' } }) === 'npc.rolle' && felder({ npc: { fraktion: 'zzz' } }) === 'npc.fraktion' && felder({ npc: { quest: 'zzz' } }) === 'npc.quest');
check('unknown keys: Yaw, scael, npc.Rolle', felder({ Yaw: 2 }) === 'Yaw' && felder({ scael: 2 }) === 'scael' && felder({ npc: { name: 'a', Rolle: 'wache' } }) === 'npc.Rolle');
check('bad prefab (empty, missing, 65 chars, number)', felder({ prefab: '' }) === 'prefab' && felder({ prefab: undefined }) === 'prefab' && felder({ prefab: 'p'.repeat(65) }) === 'prefab' && felder({ prefab: 7 }) === 'prefab');
check('bad coordinates ("abc", null, missing, beyond the world frame)', felder({ x: 'abc' }) === 'x' && felder({ z: null }) === 'z' && felder({ x: undefined, z: undefined }) === 'x,z' && felder({ x: 1e12 }) === 'x');
// N5-A: a SET but invalid id is an error; a missing id is not
check('id "T9" / "t9 " / "tä" / 7 / null / 65 chars / "-a" are errors (feld id)', ['T9', 't9 ', 'tä', 7, null, 'a'.repeat(65), '-a', ''].every((v) => felder({ id: v }) === 'id'));
check('a missing id is legal (old documents get one derived)', felder({ id: undefined }) === '' && platzierungenFehler([{ prefab: 'Beech1', x: 1, z: 2 }]).length === 0);
check('valid ids ("t9", "a_b-1", 64 chars) are not errors', felder({ id: 't9' }) === '' && felder({ id: 'a_b-1' }) === '' && felder({ id: 'a'.repeat(64) }) === '');
check('geklemmteFelder names id too (second safeguard in the game server)', geklemmteFelder({ ...basis, id: 'T9' }).join() === 'id');
// N5-B: duplicate ids with different content
const doppelt = (a: Record<string, unknown>, b: Record<string, unknown>) => platzierungenFehler([{ ...basis, ...a }, { ...basis, ...b }]).filter((f) => f.feld === 'id' && f.wert === 'doppelt');
check('same id, other position: one error "doppelt" naming the id', doppelt({}, { z: 70 }).length === 1 && doppelt({}, { z: 70 })[0]!.id === 'a1');
check('same id, other yaw / scale / prefab: errors', doppelt({}, { yaw: 1 }).length === 1 && doppelt({}, { scale: 2 }).length === 1 && doppelt({}, { prefab: 'Beech2' }).length === 1);
check('same id, same content: NOT an error (folded)', doppelt({}, {}).length === 0 && doppelt({}, { x: 1.004 }).length === 0);
check('the order of the two does not matter', doppelt({ z: 70 }, {}).length === 1);
check('three entries, one id: one error only', platzierungenFehler([basis, { ...basis, z: 9 }, { ...basis, z: 10 }]).filter((f) => f.wert === 'doppelt').length === 1);
check('different ids are never duplicates', doppelt({}, { id: 'a2' }).length === 0);
check('an id that is only invalid is not also reported as doppelt', platzierungenFehler([{ ...basis, id: 'T' }, { ...basis, id: 'T', z: 9 }]).every((f) => f.wert !== 'doppelt'));
const roh = platzierungenFehler([basis, 'text', null, [], 7, { ...basis, id: 'b2', yaw: 'abc' }]);
check('entries that are no object: feld "eintrag", id = #position', roh.filter((f) => f.feld === 'eintrag').map((f) => f.id).join(',') === '#1,#2,#3,#4', roh.map((f) => `${f.id}.${f.feld}`).join(' '));
check('the id of an entry with a fine id is used as is', roh.some((f) => f.id === 'b2' && f.feld === 'yaw' && f.wert === 'abc'));
check('a long value is cut to 80 characters (+ ellipsis)', String(platzierungenFehler([{ ...basis, yaw: 'y'.repeat(500) }])[0]!.wert).length === 81);
check('a nested value becomes JSON text, cut', typeof platzierungenFehler([{ ...basis, scale: { a: [1, 2] } }])[0]!.wert === 'string');
check(
  'platzierungenFehlerText: id feld=value, the rest counted',
  platzierungenFehlerText(platzierungenFehler([{ ...basis, yaw: 'abc' }])) === 'a1 yaw="abc"' &&
    platzierungenFehlerText(Array.from({ length: 25 }, () => ({ id: 'x', feld: 'yaw', wert: 1 })), 20).endsWith('… (+5)')
);

// false alarms: none of these is a typo
const still = (e: Record<string, unknown>): boolean => felder(e) === '';
check('no fields at all', still({}));
check('numbers as text: scale "3", " 4 ", "1e0", yaw "1.5", einebnen "5", npc.stufe "7"', still({ scale: '3' }) && still({ scale: ' 4 ' }) && still({ scale: '1e0' }) && still({ yaw: '1.5' }) && still({ einebnen: '5' }) && still({ npc: { stufe: '7' } }));
check('null on the optional fields that read as missing: yaw, route, npc, npc.name/rolle/fraktion/quest', still({ yaw: null }) && still({ route: null }) && still({ npc: null }) && still({ npc: { name: null, rolle: 'zivil', fraktion: null, quest: null } }));
check('an npc with all five keys', still({ npc: { name: 'Ari', rolle: 'haendler', fraktion: 'wikinger', stufe: 5, quest: 'keine' } }));
check('rounding is no typo: x 1.00049, einebnen 5.04, npc.stufe 3.4', still({ x: 1.00049 }) && still({ einebnen: 5.04 }) && still({ npc: { stufe: 3.4 } }));
check('the edges: yaw 2 pi and -2 pi, scale 0.2 and 5, einebnen 1 and 100', still({ yaw: Math.PI * 2 }) && still({ yaw: -Math.PI * 2 }) && still({ scale: 0.2 }) && still({ scale: 5 }) && still({ einebnen: 1 }) && still({ einebnen: 100 }));
check('a wrong prefab is another valid entry, no typo (a wrong id is one since N5)', still({ prefab: 'Beeech1' }));
check('a list that is not an array reports nothing (listenPruefen owns that)', platzierungenFehler(undefined).length === 0 && platzierungenFehler(null).length === 0 && platzierungenFehler('x').length === 0 && platzierungenFehler({}).length === 0);
check('only the first 2000 entries are looked at (the write path refuses more before)', platzierungenFehler([...Array.from({ length: 2000 }, () => basis), { ...basis, yaw: 'abc' }]).length === 0);

// consistency with the sanitizer: an entry without a finding comes out unchanged
const sauber = { ...basis, yaw: 1, scale: 2, einebnen: 5, route: 'r1', npc: { name: 'Ari', stufe: 3 } };
const l = sanitizeWorldLayout({ version: 1, name: 'x', regions: [{ id: 'r', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 100 }, edgeFalloff: 10, baseLevel: 0.3 }], placements: [sauber] });
check('an entry without a finding comes out of the sanitizer as it went in', platzierungenFehler([sauber]).length === 0 && JSON.stringify(l?.placements?.[0]) === JSON.stringify({ id: 'a1', prefab: 'Beech1', x: 1, z: 2, route: 'r1', yaw: 1, scale: 2, einebnen: 5, npc: { name: 'Ari', stufe: 3 } }), JSON.stringify(l?.placements?.[0]));
check('geklemmteFelder ignores an entry that is not an object', geklemmteFelder('x').length === 0 && geklemmteFelder(null).length === 0);

console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
