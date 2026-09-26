/**
 * K5.3 — the test flight changes its draft as operations (`Vorgang`), addressed by `id`.
 * Der Testflug ändert seinen Entwurf als Vorgänge, adressiert über `id`.
 *
 *  1. One gesture = one Vorgang with one op (set, drag, turn, NPC fields, delete);
 *     a drag over 30 frames = ONE Vorgang.
 *  2. The plain (offline) way stores byte for byte what the old direct edits stored.
 *  3. `OpsPersistenz`: PATCH per Vorgang; 200 applied, 202 written-only with its reason
 *     (draft stays), 409 per object (draft put back, ids named), errors put it back too.
 *  4. Testflug.ts no longer writes the draft directly and keeps no list place as an address.
 *
 * Run: npx tsx client/test/testflug-ops.ts
 */
import { readFileSync } from 'node:fs';

let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FAIL: ${text}`);
  }
};

const speicher = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => speicher.get(k) ?? null,
  setItem: (k: string, v: string) => void speicher.set(k, v),
};
const abrufe: Array<{ url: string; init: RequestInit }> = [];
let antworten: Array<{ status: number; rumpf: unknown } | 'netz'> = [];
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
  abrufe.push({ url, init });
  const a = antworten.shift() ?? { status: 200, rumpf: { ok: true, message: 'ok' } };
  if (a === 'netz') throw new Error('offline');
  return new Response(JSON.stringify(a.rumpf), { status: a.status });
};
console.warn = (): void => undefined;

const { localStoragePersistenz, ENTWURF_SCHLUESSEL } = await import('../src/editor/testflug/LocalStoragePersistenz');
const { opsPersistenz } = await import('../src/editor/testflug/OpsPersistenz');
const { TestflugAktionen } = await import('../src/editor/testflug/TestflugAktionen');
const { antwortText } = await import('../src/editor/testflug/TestflugPersistenz');
type Antwort = import('../src/editor/testflug/TestflugPersistenz').VorgangAntwort;

const START = () => ({
  name: 'k53',
  version: 1,
  eigenesFeld: 7,
  placements: [
    { id: 'beech1_10_10-a1b2', prefab: 'Beech1', x: 10, z: 10, yaw: 1.5 },
    { id: 'kuh_20_20-c3d4', prefab: 'Kuh', x: 20, z: 20, scale: 1.2, npc: { name: 'Bessie' } },
    { id: 'haus_30_30-e5f6', prefab: 'Haus', x: 30, z: 30, einebnen: 12 },
  ],
});
const setzeStart = (): void => void speicher.set(ENTWURF_SCHLUESSEL, JSON.stringify(START()));
const NEU = { id: 'tanne_5_5-g7h8', prefab: 'Tanne', x: 5, z: 5, yaw: 0.25 };

console.log('K5.3 testflug-ops');

// ── 1. one gesture, one Vorgang, one op ─────────────────────────────
{
  setzeStart();
  const p = localStoragePersistenz();
  const a = new TestflugAktionen(p, () => 1);
  const zaehl = (): number => p.protokoll().length;
  const letzte = () => p.protokoll()[p.protokoll().length - 1]!;

  let r = a.setzen(NEU);
  pruefe(r.ok && zaehl() === 1 && letzte().ops.length === 1 && letzte().ops[0]!.art === 'setze' && letzte().ops[0]!.id === NEU.id, `set: 1 Vorgang, 1 op setze — has ${zaehl()}`);

  const marke0 = p.rohtext!();
  for (let i = 1; i <= 30; i++) a.verschieben('kuh_20_20-c3d4', 20 + i * 0.1, 20 - i * 0.1);
  pruefe(zaehl() === 1, `30 drag frames before the drop count nothing yet, protokoll has ${zaehl()}`);
  pruefe(p.rohtext!() !== marke0, 'a drag frame changes the raw text (change marker of the vegetation preview)');
  const abgesetzt = a.abschliessen();
  pruefe(abgesetzt !== null && zaehl() === 2, `drag over 30 frames = ONE Vorgang, protokoll has ${zaehl()}`);
  pruefe(letzte().ops.length === 1 && letzte().ops[0]!.art === 'aendere', `drag: 1 op aendere, has ${letzte().ops.length}`);
  const kuh = p.laden()!.placements!.find((e) => e.id === 'kuh_20_20-c3d4')!;
  pruefe(kuh.x === 23 && kuh.z === 17, `drag ends at the last frame, (${kuh.x}, ${kuh.z})`);
  pruefe((letzte().ops[0]!.vorher as unknown as { x: number }).x === 20 && (letzte().ops[0]!.nachher as unknown as { x: number }).x === 23, 'the merged op carries the state at the grab and at the drop');
  pruefe((await abgesetzt!).art === 'angewendet', 'plain store: answer applied');
  pruefe(a.abschliessen() === null && zaehl() === 2, 'closing twice adds nothing');

  // a drag that ends where it started is no Vorgang
  a.verschieben('kuh_20_20-c3d4', 25, 25);
  a.verschieben('kuh_20_20-c3d4', 23, 17);
  pruefe(a.abschliessen() === null && zaehl() === 2, 'a drag back to the start is no Vorgang');

  r = a.drehen('beech1_10_10-a1b2', 1.5 + Math.PI / 12);
  pruefe(r.ok && zaehl() === 3 && letzte().ops.length === 1 && letzte().ops[0]!.art === 'aendere', `turn: 1 Vorgang, 1 op aendere — has ${zaehl()}`);
  pruefe(Math.abs(p.laden()!.placements![0]!.yaw! - (1.5 + Math.PI / 12)) < 1e-3, 'turn: yaw written');

  r = a.npcSetzen('kuh_20_20-c3d4', { name: 'Berta' });
  pruefe(r.ok && zaehl() === 4 && letzte().ops.length === 1, 'NPC fields: 1 Vorgang, 1 op');
  r = a.loeschen('haus_30_30-e5f6');
  pruefe(r.ok && zaehl() === 5 && letzte().ops.length === 1 && letzte().ops[0]!.art === 'entferne', `delete: 1 Vorgang, 1 op entferne — has ${zaehl()}`);
  pruefe(p.laden()!.placements!.every((e) => e.id !== 'haus_30_30-e5f6'), 'delete: entry gone');

  pruefe(new Set(p.protokoll().map((v) => v.vorgangId)).size === 5, 'every Vorgang has its own vorgangId');
  pruefe(p.protokoll().every((v) => /^tf-[a-z0-9]+-\d+$/.test(v.vorgangId)), 'vorgangId has the accepted shape');

  // an address that is gone: refused, draft untouched
  const vor = speicher.get(ENTWURF_SCHLUESSEL);
  const weg = a.loeschen('gibt-es-nicht');
  pruefe(!weg.ok && weg.ids[0] === 'gibt-es-nicht' && speicher.get(ENTWURF_SCHLUESSEL) === vor && zaehl() === 5, 'an unknown id is refused, draft and count unchanged');
  // a stale `vorher` is a conflict on the local draft, too (all or nothing)
  const alt = p.vorgang({
    vorgangId: 'stale-1',
    ops: [
      { art: 'aendere', sammlung: 'placements', id: 'beech1_10_10-a1b2', vorher: { id: 'beech1_10_10-a1b2', prefab: 'Beech1', x: 99, z: 99 }, nachher: { id: 'beech1_10_10-a1b2', prefab: 'Beech1', x: 1, z: 1 } },
      { art: 'setze', sammlung: 'placements', id: 'egal-1', nachher: { id: 'egal-1', prefab: 'Tanne', x: 1, z: 1 } },
    ],
  });
  pruefe(!alt.ok && alt.ids.join() === 'beech1_10_10-a1b2' && speicher.get(ENTWURF_SCHLUESSEL) === vor, 'stale vorher: conflict, nothing of the Vorgang applied');
}

// ── 2. plain way: byte for byte as before ───────────────────────────
{
  // The old flight edited the parsed draft in place and wrote it whole (`aendern`).
  setzeStart();
  const alt = localStoragePersistenz();
  {
    let roh = alt.laden()!;
    roh.placements = [...(roh.placements ?? []), { ...NEU }];
    alt.aendern(roh);
    for (let i = 1; i <= 30; i++) {
      roh = alt.laden()!;
      const q = roh.placements!.find((e) => e.id === 'kuh_20_20-c3d4')!;
      q.x = 20 + i * 0.1;
      q.z = 20 - i * 0.1;
      alt.aendern(roh);
    }
    roh = alt.laden()!;
    roh.placements!.find((e) => e.id === 'kuh_20_20-c3d4')!.npc = { name: 'Berta' };
    alt.aendern(roh);
    roh = alt.laden()!;
    delete roh.placements!.find((e) => e.id === 'kuh_20_20-c3d4')!.npc;
    alt.aendern(roh);
    roh = alt.laden()!;
    roh.placements!.splice(roh.placements!.findIndex((e) => e.id === 'haus_30_30-e5f6'), 1);
    alt.aendern(roh);
  }
  const erwartet = speicher.get(ENTWURF_SCHLUESSEL);

  setzeStart();
  const p = localStoragePersistenz();
  const a = new TestflugAktionen(p);
  a.setzen({ ...NEU });
  for (let i = 1; i <= 30; i++) a.verschieben('kuh_20_20-c3d4', 20 + i * 0.1, 20 - i * 0.1);
  a.abschliessen();
  a.npcSetzen('kuh_20_20-c3d4', { name: 'Berta' });
  a.npcSetzen('kuh_20_20-c3d4', null);
  a.loeschen('haus_30_30-e5f6');
  pruefe(speicher.get(ENTWURF_SCHLUESSEL) === erwartet, `plain way bytes differ from the old in-place edits:\n${erwartet}\n${speicher.get(ENTWURF_SCHLUESSEL)}`);
  pruefe((erwartet ?? '').includes('"eigenesFeld":7'), 'the reference keeps foreign fields');
}

// ── 3. OpsPersistenz ────────────────────────────────────────────────
{
  const bau = () => {
    setzeStart();
    const basis = localStoragePersistenz();
    const p = opsPersistenz(basis);
    return { p, a: new TestflugAktionen(p, () => 1) };
  };
  const vorAbruf = () => abrufe.length;

  // 200
  {
    const { p, a } = bau();
    abrufe.length = 0;
    antworten = [{ status: 200, rumpf: { ok: true, message: 'Vorgang tf-1-1 in dev.json: 3 Platzierung(en)' } }];
    const r = a.setzen({ ...NEU });
    const ant = r.ok ? await r.antwort : null;
    pruefe(ant?.art === 'angewendet', `200: applied, got ${JSON.stringify(ant)}`);
    pruefe(abrufe.length === 1 && abrufe[0]!.url === '/api/worldlayout/ops' && abrufe[0]!.init.method === 'PATCH', 'sent as PATCH /api/worldlayout/ops');
    const gesendet = JSON.parse(String(abrufe[0]?.init.body)) as { vorgangId: string; ops: Array<{ art: string; id: string }> };
    pruefe(gesendet.ops.length === 1 && gesendet.ops[0]!.art === 'setze' && gesendet.ops[0]!.id === NEU.id, 'the body is the Vorgang (1 op setze)');
    pruefe(p.laden()!.placements!.some((e) => e.id === NEU.id), '200: draft keeps the change');
    pruefe(antwortText(ant!) !== null, '200: a line for the HUD');
  }
  // 30 drag frames -> one PATCH
  {
    const { p, a } = bau();
    abrufe.length = 0;
    antworten = [];
    for (let i = 1; i <= 30; i++) a.verschieben('kuh_20_20-c3d4', 20 + i * 0.1, 20);
    pruefe(vorAbruf() === 0, `drag frames send nothing, ${vorAbruf()} requests`);
    const ant = await a.abschliessen();
    pruefe(vorAbruf() === 1 && ant?.art === 'angewendet', `30 frames = 1 PATCH, ${vorAbruf()} requests`);
    const gesendet = JSON.parse(String(abrufe[0]?.init.body)) as { ops: Array<{ art: string; nachher: { x: number } }> };
    pruefe(gesendet.ops.length === 1 && gesendet.ops[0]!.art === 'aendere' && Math.abs(gesendet.ops[0]!.nachher.x - 23) < 1e-9, 'the one PATCH carries the end state');
    pruefe(p.protokoll().length === 1, 'protokoll: 1 Vorgang');
  }
  // 202 with reason
  for (const grund of ['server-aus', 'geo', 'abgelehnt']) {
    const { p, a } = bau();
    abrufe.length = 0;
    antworten = [{ status: 202, rumpf: { ok: true, grund, message: 'geschrieben' } }];
    const r = a.drehen('beech1_10_10-a1b2', 2);
    const ant = r.ok ? await r.antwort : null;
    const text = ant ? antwortText(ant) : null;
    pruefe(ant?.art === 'nur-geschrieben' && ant.grund === grund, `202 ${grund}: art and reason, got ${JSON.stringify(ant)}`);
    pruefe(!!text && text.includes(grund) && /nicht angewendet/.test(text), `202 ${grund}: the reason is on the HUD line: ${text}`);
    pruefe(p.laden()!.placements![0]!.yaw === 2, `202 ${grund}: local draft stays written`);
  }
  // 202 without a reason: says so
  {
    const { a } = bau();
    antworten = [{ status: 202, rumpf: { ok: true } }];
    const r = a.drehen('beech1_10_10-a1b2', 2);
    const ant = r.ok ? await r.antwort : null;
    pruefe(ant?.art === 'nur-geschrieben' && ant.grund === 'unbekannt', '202 without grund: "unbekannt"');
  }
  // 409 per object
  for (const [name, tu] of [
    ['set', (a: InstanceType<typeof TestflugAktionen>) => a.setzen({ ...NEU })],
    ['turn', (a: InstanceType<typeof TestflugAktionen>) => a.drehen('beech1_10_10-a1b2', 2)],
    ['delete', (a: InstanceType<typeof TestflugAktionen>) => a.loeschen('kuh_20_20-c3d4')],
  ] as const) {
    const { p, a } = bau();
    const vorher = speicher.get(ENTWURF_SCHLUESSEL);
    antworten = [{ status: 409, rumpf: { ok: false, fehler: 'konflikt', ids: ['kuh_20_20-c3d4', 'zweite-id'], message: 'passt nicht' } }];
    const r = tu(a);
    const ant: Antwort | null = r.ok ? await r.antwort : null;
    pruefe(ant?.art === 'konflikt' && ant.ids.join() === 'kuh_20_20-c3d4,zweite-id', `409 ${name}: names the ids, got ${JSON.stringify(ant)}`);
    pruefe(speicher.get(ENTWURF_SCHLUESSEL) === vorher, `409 ${name}: local draft unchanged, byte for byte`);
    pruefe(ant?.art === 'konflikt' && ant.zurueckgenommen, `409 ${name}: reported as put back`);
    const text = ant ? antwortText(ant) : null;
    pruefe(!!text && text.includes('kuh_20_20-c3d4'), `409 ${name}: HUD line names the id`);
    void p;
  }
  // 409 of a drag: the whole drag is put back
  {
    const { a } = bau();
    const vorher = speicher.get(ENTWURF_SCHLUESSEL);
    antworten = [{ status: 409, rumpf: { ok: false, fehler: 'konflikt', ids: ['kuh_20_20-c3d4'] } }];
    for (let i = 1; i <= 30; i++) a.verschieben('kuh_20_20-c3d4', 20 + i, 20);
    const ant = await a.abschliessen();
    pruefe(ant?.art === 'konflikt' && speicher.get(ENTWURF_SCHLUESSEL) === vorher, '409 after a drag: draft back at the grab state');
  }
  // 409 without ids: the objects of the Vorgang
  {
    const { a } = bau();
    antworten = [{ status: 409, rumpf: { ok: false, fehler: 'konflikt' } }];
    const r = a.drehen('beech1_10_10-a1b2', 2);
    const ant = r.ok ? await r.antwort : null;
    pruefe(ant?.art === 'konflikt' && ant.ids.join() === 'beech1_10_10-a1b2', '409 without ids: falls back to the Vorgang\'s own object');
  }
  // 422 / 503 / network: nothing written, draft put back
  for (const [name, antwort] of [
    ['422', { status: 422, rumpf: { ok: false, fehler: 'ungueltig', message: 'kaputt' } }],
    ['503', { status: 503, rumpf: { ok: false, fehler: 'gesperrt', message: 'gesperrt' } }],
    ['network', 'netz'],
  ] as const) {
    const { a } = bau();
    const vorher = speicher.get(ENTWURF_SCHLUESSEL);
    antworten = [antwort];
    const r = a.loeschen('haus_30_30-e5f6');
    const ant = r.ok ? await r.antwort : null;
    pruefe(ant?.art === 'fehler' && speicher.get(ENTWURF_SCHLUESSEL) === vorher, `${name}: error, draft put back`);
  }
  // order: two Vorgaenge in a row go out one after the other
  {
    const { a } = bau();
    abrufe.length = 0;
    antworten = [];
    const r1 = a.drehen('beech1_10_10-a1b2', 2);
    const r2 = a.drehen('beech1_10_10-a1b2', 3);
    if (r1.ok) await r1.antwort;
    if (r2.ok) await r2.antwort;
    const ops = abrufe.map((x) => JSON.parse(String(x.init.body)) as { ops: Array<{ nachher: { yaw: number } }> });
    pruefe(ops.length === 2 && ops[0]!.ops[0]!.nachher.yaw === 2 && ops[1]!.ops[0]!.nachher.yaw === 3, 'two Vorgaenge are sent in the order they were made');
  }
}

// ── 4. Testflug.ts: no direct draft writes, no list place as address ─
{
  const testflug = readFileSync(new URL('../src/editor/testflug/Testflug.ts', import.meta.url), 'utf-8');
  pruefe(!/persistenz\.aendern\(/.test(testflug), 'Testflug.ts must not write the draft directly any more');
  pruefe(!/\b(auswahlIndex|ziehIndex)\b/.test(testflug), 'the grab and the selection are held by id, not by list place');
  for (const geste of ['setzen', 'verschieben', 'drehen', 'npcSetzen', 'loeschen', 'abschliessen']) {
    pruefe(new RegExp(`aktionen\\.${geste}\\(`).test(testflug), `Testflug.ts must go through aktionen.${geste}`);
  }
}

if (fehler > 0) {
  console.log(`\n${fehler} failure(s) of ${geprueft} checks`);
  process.exit(1);
}
console.log(`\nThe flight edits the draft as operations by id (${geprueft} checks).`);
