/**
 * Stable placement ids (editor stage E1, card K1.1): every placement of a layout
 * document carries an `id`, unique inside the document; documents that predate
 * the field are migrated by a deterministic derivation; the list is written
 * sorted by id so two branches that each append a placement merge without a
 * conflict.
 *
 * The checks that need the new API reach it through the module namespace, so the
 * same file runs against an older tree and fails check by check there.
 *
 *   npx tsx test/platzierungs-ids.ts   (from shared/)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as WL from '../src/worldlayout/index.js';
import { layoutKennung, pruefeLayout, sanitizeWorldLayout, type WorldLayout } from '../src/worldlayout/index.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// Absent on a tree from before E1.
const neuePlatzierungsId = (WL as unknown as Record<string, unknown>).neuePlatzierungsId as
  | ((layout: { placements?: readonly { id?: string }[] }, p: { prefab: string; x: number; z: number }) => string)
  | undefined;

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
type Roh = Record<string, unknown>;

const welt = (extra: Roh): Roh => ({
  version: 1,
  name: 'Platzierungs-IDs',
  detailSeed: 'p',
  continents: [],
  regions: [],
  ...extra,
});
const sauber = (extra: Roh): WorldLayout => sanitizeWorldLayout(welt(extra))!;
const text = (l: WorldLayout | null): string => JSON.stringify(l, null, 2);
const ids = (l: WorldLayout): string[] => (l.placements ?? []).map((p) => (p as { id?: string }).id ?? '<keine>');

// ── 1. Every placement gets an id, derived deterministically ─────────
const alt = sauber({
  placements: [
    { prefab: 'Beech1', x: 140.4, z: -22.2 },
    { prefab: 'Tanne4', x: 10, z: 20 },
    { prefab: 'Voelva', x: 0, z: 0, npc: { name: 'Sigrun' } },
  ],
});
check('ids: every placement has an id matching the region id format', alt.placements!.every((p) => ID_RE.test((p as { id?: string }).id ?? '')), ids(alt).join(','));
check('ids: derived from lower-case prefab and rounded position', ids(alt).includes('beech1_140_-22') && ids(alt).includes('tanne4_10_20') && ids(alt).includes('voelva_0_0'), ids(alt).join(','));

// Prefab names with characters outside [a-z0-9-], very long names, names that vanish.
const wild = sauber({
  placements: [
    { prefab: 'Ünï Ko/de Ä', x: 1, z: 2 },
    { prefab: 'A'.repeat(64), x: 39999.9, z: -39999.9 },
    { prefab: '___', x: 3, z: 4 },
  ],
});
check('ids: odd prefab names still give valid, unique ids', wild.placements!.length === 3 && wild.placements!.every((p) => ID_RE.test((p as { id?: string }).id ?? '')) && new Set(ids(wild)).size === 3, ids(wild).join(','));
check('ids: even the longest derived id fits the 64 character limit', ids(wild).every((i) => i.length <= 64), ids(wild).map((i) => i.length).join(','));

// Same rounded spot: document order decides who keeps the plain id.
const kollision = sauber({
  placements: [
    { prefab: 'woodwall', x: 5.2, z: 5, yaw: 1 },
    { prefab: 'woodwall', x: 5.4, z: 5, yaw: 2 },
    { prefab: 'woodwall', x: 4.8, z: 5, yaw: 3 },
  ],
});
const kollisionJeYaw = Object.fromEntries((kollision.placements ?? []).map((p) => [p.yaw, (p as { id?: string }).id]));
check('ids: entries on one spot get -2, -3 in document order', kollisionJeYaw['1'] === 'woodwall_5_5' && kollisionJeYaw['2'] === 'woodwall_5_5-2' && kollisionJeYaw['3'] === 'woodwall_5_5-3', JSON.stringify(kollisionJeYaw));

// Explicit ids: valid and unique ones stay; an id-less entry never takes one away.
const explizit = sauber({
  placements: [
    { prefab: 'Beech1', x: 5, z: 5 }, // would derive 'beech1_5_5' ...
    { id: 'beech1_5_5', prefab: 'Tanne4', x: 9, z: 9 }, // ... which this entry already owns
    { id: 'Ungültig Ü', prefab: 'Beech1', x: 7, z: 7 },
    { id: 'doppelt', prefab: 'Beech1', x: 8, z: 8 },
    { id: 'doppelt', prefab: 'Beech1', x: 18, z: 18 },
  ],
});
const nachPos = (l: WorldLayout, x: number): string => (l.placements!.find((p) => p.x === x) as { id?: string }).id ?? '<keine>';
check('ids: an explicit unique id is kept, an id-less entry derives around it', nachPos(explizit, 9) === 'beech1_5_5' && nachPos(explizit, 5) === 'beech1_5_5-2', ids(explizit).join(','));
check('ids: an invalid explicit id is replaced by a derived one', nachPos(explizit, 7) === 'beech1_7_7', nachPos(explizit, 7));
check('ids: of two equal explicit ids the first keeps it, the second derives one', nachPos(explizit, 8) === 'doppelt' && nachPos(explizit, 18) === 'beech1_18_18', `${nachPos(explizit, 8)} / ${nachPos(explizit, 18)}`);
check('ids: after sanitize every id is unique', new Set(ids(explizit)).size === explizit.placements!.length);

// ── 2. Idempotent, byte for byte ─────────────────────────────────────
const messy = welt({
  regions: [{ id: 'r1', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 500 }, edgeFalloff: 100 }],
  placements: [
    ...explizit.placements!,
    { prefab: 'woodwall', x: 5.2, z: 5, yaw: 1 },
    { prefab: 'woodwall', x: 5.4, z: 5, yaw: 2 },
    { prefab: 'Beech1', x: 100, z: 100 },
    { prefab: 'Beech1', x: 100.004, z: 100 }, // exact duplicate of the line above
    { prefab: 'Beech1', x: null, z: 3 },
    { prefab: 'Voelva', x: 1, z: 1, npc: { name: ' Sigrun ', stufe: 999 } },
  ],
  rivers: [{ id: 'fluss', points: [[0, 0], [10, 10]], width: 30 }],
});
const einmal = sanitizeWorldLayout(messy);
const zweimal = sanitizeWorldLayout(JSON.parse(text(einmal)));
check('idempotent: sanitize(sanitize(x)) is byte-identical to sanitize(x)', einmal !== null && text(einmal) === text(zweimal));
check('idempotent: also with the array order reversed, the written list is the same', text(sanitizeWorldLayout({ ...JSON.parse(text(einmal)), placements: [...einmal!.placements!].reverse() })) === text(einmal));

// ── 3. Exact duplicates ──────────────────────────────────────────────
const dup = sauber({
  placements: [
    { prefab: 'Beech1', x: 100, z: 100, yaw: 1, scale: 2 },
    { prefab: 'Beech1', x: 100.006, z: 99.996, yaw: 1, scale: 2 }, // 7 mm away, all fields equal
    { prefab: 'Beech1', x: 100.02, z: 100, yaw: 1, scale: 2 }, // 2 cm away: a different object
    { prefab: 'Beech1', x: 100, z: 100, yaw: 1.5, scale: 2 }, // one field differs
    { prefab: 'Voelva', x: 50, z: 50, npc: { name: 'A' } },
    { prefab: 'Voelva', x: 50, z: 50, npc: { name: 'B' } }, // npc differs
  ],
});
check('duplicates: exact duplicates (all fields equal, within 1 cm) become one entry', dup.placements!.length === 5, `${dup.placements!.length} entries`);
check('duplicates: 2 cm apart, another yaw or another npc block is NOT a duplicate', dup.placements!.filter((p) => p.prefab === 'Voelva').length === 2 && dup.placements!.filter((p) => p.prefab === 'Beech1').length === 3);
const befunde = pruefeLayout(dup).filter((b) => /Duplikat/.test(b.text));
check('duplicates: pruefeLayout reports the folded duplicate', befunde.length === 1 && /Beech1/.test(befunde[0]!.text), JSON.stringify(befunde));
check('duplicates: the report is a note, not an error', befunde.every((b) => b.art === 'welt'));
const dupMitId = sauber({
  placements: [
    { prefab: 'Beech1', x: 1, z: 1 },
    { id: 'meine-buche', prefab: 'Beech1', x: 1, z: 1 },
  ],
});
check('duplicates: an id-less entry folds into its explicit twin and the explicit id survives', dupMitId.placements!.length === 1 && (dupMitId.placements![0] as { id?: string }).id === 'meine-buche', ids(dupMitId).join(','));
const zweiIds = sauber({
  placements: [
    { id: 'links', prefab: 'Beech1', x: 1, z: 1 },
    { id: 'rechts', prefab: 'Beech1', x: 1, z: 1 },
  ],
});
check('duplicates: two explicit different ids are two entries, however alike', zweiIds.placements!.length === 2);
check('duplicates: ... and pruefeLayout points at them', pruefeLayout(zweiIds).some((b) => /identischem Inhalt/.test(b.text) && /links/.test(b.text) && /rechts/.test(b.text)), JSON.stringify(pruefeLayout(zweiIds)));

// ── 4. A coordinate that is not a number drops the entry ─────────────
const nichtZahl = sauber({
  placements: [
    { prefab: 'Beech1', x: null, z: 5 },
    { prefab: 'Beech1', x: 5, z: null },
    { prefab: 'Beech1', x: '', z: 5 },
    { prefab: 'Beech1', x: true, z: 5 },
    { prefab: 'Beech1', x: [], z: 5 },
    { prefab: 'Beech1', x: '7', z: 5 },
    { prefab: 'Beech1', z: 5 },
    { prefab: 'Beech1', x: 1, z: 2 },
  ],
});
check('coordinate: null, empty text, true, [], text and a missing value drop the entry (no jump to the origin)', nichtZahl.placements?.length === 1 && nichtZahl.placements[0]!.x === 1, JSON.stringify(nichtZahl.placements));
check('coordinate: null in a shape or spawn drops that too', sanitizeWorldLayout(welt({ regions: [{ id: 'r', biome: 'grassland', shape: { kind: 'circle', x: null, z: 0, radius: 100 }, edgeFalloff: 100 }] }))!.regions.length === 0 && sauber({ defaultSpawn: [null, 5] }).defaultSpawn === undefined);

// ── 5. River and lake ids are unique ─────────────────────────────────
const gewaesser = sauber({
  rivers: [
    { id: 'a', points: [[0, 0], [10, 0]], width: 10 },
    { id: 'a', points: [[0, 50], [10, 50]], width: 20 },
    { id: 'b', points: [[0, 90], [10, 90]], width: 10 },
  ],
  lakes: [
    { id: 'see', x: 0, z: 0, radius: 50 },
    { id: 'see', x: 900, z: 900, radius: 60 },
  ],
});
check('rivers: a repeated id drops the second river', gewaesser.rivers?.length === 2 && gewaesser.rivers[0]!.width === 10 && gewaesser.rivers[1]!.id === 'b', JSON.stringify(gewaesser.rivers));
check('lakes: a repeated id drops the second lake', gewaesser.lakes?.length === 1 && gewaesser.lakes[0]!.x === 0, JSON.stringify(gewaesser.lakes));

// ── 6. Written sorted by id; regions keep their order ────────────────
const sortiert = sauber({
  regions: [
    { id: 'zeta', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 100 }, edgeFalloff: 100 },
    { id: 'alpha', biome: 'grassland', shape: { kind: 'circle', x: 500, z: 0, radius: 100 }, edgeFalloff: 100 },
  ],
  placements: [
    { id: 'z-last', prefab: 'Beech1', x: 1, z: 1 },
    { id: 'a-first', prefab: 'Beech1', x: 2, z: 2 },
    { id: 'm-mid', prefab: 'Beech1', x: 3, z: 3 },
    { id: '_x', prefab: 'Beech1', x: 4, z: 4 }, // invalid (starts with _) -> derived, sorted by that
  ],
});
check('sorted: placements are written in id order', ids(sortiert).join(',') === [...ids(sortiert)].sort().join(',') && ids(sortiert)[0] === 'a-first', ids(sortiert).join(','));
check('sorted: regions keep their document order (z order)', sortiert.regions.map((r) => r.id).join(',') === 'zeta,alpha');
check('sorted: `id` is the first field of every entry', JSON.stringify(sortiert.placements![0]).startsWith('{"id":'));

// ── 7. neuePlatzierungsId ────────────────────────────────────────────
const bestand = sauber({ placements: [{ prefab: 'Beech1', x: 5, z: 5 }, { prefab: 'Beech1', x: 5.2, z: 5, yaw: 1 }] });
const frisch = neuePlatzierungsId?.(bestand, { prefab: 'Beech1', x: 5.1, z: 5 });
check('neuePlatzierungsId: gives a fresh id, unique against the document', frisch === 'beech1_5_5-3', String(frisch));
check('neuePlatzierungsId: for a spot nobody uses it is the plain derived id', neuePlatzierungsId?.(bestand, { prefab: 'Beech1', x: 900, z: 1 }) === 'beech1_900_1');
const mitNeuer = sanitizeWorldLayout({ ...bestand, placements: [...bestand.placements!, { id: frisch, prefab: 'Beech1', x: 5.1, z: 5, scale: 3 }] })!;
check('neuePlatzierungsId: the id survives sanitize and all three entries stay', mitNeuer.placements!.length === 3 && ids(mitNeuer).includes(String(frisch)), ids(mitNeuer).join(','));

// ── 8. Two branches that each append a placement merge without conflict ──
const devPfad = fileURLToPath(new URL('../../server/data/welten/dev.json', import.meta.url));
const devRoh = JSON.parse(readFileSync(devPfad, 'utf-8')) as Roh;
const devLayout = sanitizeWorldLayout(devRoh)!;
const mitPlatzierung = (basis: WorldLayout, p: { prefab: string; x: number; z: number }): string => {
  // A tool that adds a placement: it takes a fresh id where the API exists; on an older
  // tree the entry has none and is simply appended, as the tools of that time did.
  const id = neuePlatzierungsId?.(basis, p);
  const eintrag = id === undefined ? p : { id, ...p };
  return text(sanitizeWorldLayout({ ...basis, placements: [...(basis.placements ?? []), eintrag] }));
};
const tmp = mkdtempSync(join(tmpdir(), 'wov-platzierungs-ids-'));
try {
  // The two new entries sort far apart (first and last): a merge conflict would be down to the format, not to luck.
  writeFileSync(join(tmp, 'basis.json'), text(devLayout));
  writeFileSync(join(tmp, 'ast-a.json'), mitPlatzierung(devLayout, { prefab: 'AaaNeu', x: 10, z: 10 }));
  writeFileSync(join(tmp, 'ast-b.json'), mitPlatzierung(devLayout, { prefab: 'ZzzNeu', x: 20, z: 20 }));
  const merge = spawnSync('git', ['merge-file', '-p', join(tmp, 'ast-a.json'), join(tmp, 'basis.json'), join(tmp, 'ast-b.json')], { encoding: 'utf-8' });
  const merged = merge.stdout;
  check('git: two branches that each append one placement merge with 0 conflicts', merge.status === 0, `exit ${merge.status} (= conflicts), stderr: ${merge.stderr}`);
  const mergedLayout = sanitizeWorldLayout(JSON.parse(merged || 'null'));
  check('git: the merged document holds both new placements', mergedLayout !== null && (mergedLayout.placements ?? []).length === (devLayout.placements ?? []).length + 2, `${mergedLayout?.placements?.length} of ${(devLayout.placements ?? []).length + 2}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── 9. The old key stays what it was ─────────────────────────────────
check('layoutKennung is unchanged (the server reads old saves with it)', layoutKennung({ prefab: 'Beech1', x: 140.4, z: -22.2 }) === 'Beech1@140,-22');

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== PLATZIERUNGS-IDS: ALL PASSED ===');
