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
  const a = new TestflugAktionen(p);
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
  pruefe(p.protokoll().every((v) => /^tf-[0-9a-f-]{36}$/.test(v.vorgangId) && /^~?[A-Za-z0-9._:-]{1,127}$/.test(v.vorgangId)), 'vorgangId is a random uuid the service accepts');
  {
    // B3/B8: two instances (two tabs) never produce the same id
    const a1 = new TestflugAktionen(localStoragePersistenz());
    const a2 = new TestflugAktionen(localStoragePersistenz());
    const einzel = new Set<string>();
    for (let i = 0; i < 500; i++) for (const x of [a1, a2]) einzel.add((x as unknown as { vorgangsId(): string }).vorgangsId());
    pruefe(einzel.size === 1000, `1000 ids from two instances are all different, got ${einzel.size}`);
  }

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
    return { p, a: new TestflugAktionen(p) };
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


// ── 3b. K5.3 N1: the Attrappe that keeps the server state ──────────
type Zustand = Awaited<ReturnType<typeof bauAttrappe>>;
async function bauAttrappe() {
  const { wendeAufEntwurf } = await import('../src/editor/testflug/TestflugPersistenz');
  type V = import('@wov/shared/src/worldlayout/ops.js').Vorgang;
  setzeStart();
  const server = START() as unknown as import('../src/editor/testflug/TestflugPersistenz').EntwurfDokument;
  const offene: Array<{ vorgang: V; antworte: (wie: 'ok' | 'ablehnen' | 'netz' | 'netz-nach-anwenden' | '204' | '422') => void }> = [];
  let gleichzeitig = 0;
  let hoechstens = 0;
  const gesendet: V[] = [];
  const fetchFn = ((_url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const vorgang = JSON.parse(String(init.body)) as V;
      gesendet.push(vorgang);
      hoechstens = Math.max(hoechstens, ++gleichzeitig);
      offene.push({
        vorgang,
        antworte: (wie) => {
          gleichzeitig--;
          if (wie === 'netz') return reject(new Error('reset'));
          if (wie === '422') return resolve(new Response(JSON.stringify({ ok: false, message: 'kaputt' }), { status: 422 }));
          if (wie === 'ablehnen') {
            const r = wendeAufEntwurf(server, vorgang);
            return resolve(new Response(JSON.stringify({ ok: false, ids: r.ok ? [] : r.ids, message: 'passt nicht' }), { status: 409 }));
          }
          wendeAufEntwurf(server, vorgang); // the server takes it
          if (wie === 'netz-nach-anwenden') return reject(new Error('reset after apply'));
          if (wie === '204') return resolve(new Response(null, { status: 204 }));
          resolve(new Response(JSON.stringify({ ok: true, message: 'ok' }), { status: 200 }));
        },
      });
    })) as unknown as typeof fetch;
  const p = opsPersistenz(localStoragePersistenz(), { fetchFn });
  const a = new TestflugAktionen(p);
  const intern: Array<Promise<Antwort>> = [];
  p.aufInternenAbschluss = (x) => void intern.push(x);
  const draft = (): string => JSON.stringify(p.laden()!.placements);
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
  return { server, offene, gesendet, p, a, intern, draft, tick, hoechstens: () => hoechstens };
}
/** An answer that may never come (the old code): `null` after 50 ms, so that a missing answer is a failed check, not a hang. */
const frist = <T>(p: Promise<T> | null | undefined): Promise<T | null> =>
  p ? Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 50))]) : Promise.resolve(null);
const ausStart = (): string => JSON.stringify(START().placements);
const KUH = 'kuh_20_20-c3d4';
const BUCHE = 'beech1_10_10-a1b2';

// B2 / P4: a drag is refused (409), before the answer the object is turned
{
  const z: Zustand = await bauAttrappe();
  z.server.placements![1]!.x = 99; // foreign change
  z.a.verschieben(KUH, 23, 20);
  const antwort1 = z.a.abschliessen()!;
  const r2 = z.a.drehen(KUH, 1);
  await z.tick();
  pruefe(z.offene.length === 1, `P4: the second Vorgang waits, ${z.offene.length} requests in flight`);
  z.offene[0]?.antworte('ablehnen');
  const ant = await frist(antwort1);
  const ant2 = r2.ok ? await frist(r2.antwort) : null;
  pruefe(z.draft() === ausStart(), `P4: draft is back at the last confirmed state, got ${z.draft()}`);
  pruefe(ant?.art === 'konflikt' && ant?.zurueckgenommen && ant?.verworfen === 2, `P4: refused, put back, 2 gestures: ${JSON.stringify(ant)}`);
  pruefe((ant ? antwortText(ant) : null)?.includes('2 Gesten') === true, `P4: the line names the count: ${ant ? antwortText(ant) : null}`);
  pruefe(ant2?.art === 'fehler' && ant2?.zurueckgenommen, 'P4: the later gesture is answered as discarded');
  pruefe(z.gesendet.length === 1, `P4: the discarded gesture was never sent, ${z.gesendet.length} sent`);
}
// B2 / P4c: Delete during a drag closes the drag inside; the answer of the drag is not lost
{
  const z: Zustand = await bauAttrappe();
  z.server.placements![1]!.x = 99;
  z.a.verschieben(KUH, 23, 20);
  const r = z.a.loeschen(KUH);
  await z.tick();
  pruefe(z.intern.length === 1, `P4c: the internally closed drag hands out its answer, ${z.intern.length}`);
  z.offene[0]?.antworte('ablehnen');
  const ant = await frist(z.intern[0]);
  const antLoeschen = r.ok ? await frist(r.antwort) : null;
  pruefe(ant?.art === 'konflikt' && ant?.zurueckgenommen && ant?.verworfen === 2, `P4c: drag answer: ${JSON.stringify(ant)}`);
  pruefe(antLoeschen?.art === 'fehler' && antLoeschen?.zurueckgenommen, 'P4c: the delete is put back as well');
  pruefe(z.draft() === ausStart(), `P4c: the cow is back at x=20 and not deleted, got ${z.draft()}`);
}
// B2 / P9: turning is refused, before the answer a drag of the same object begins
{
  const z: Zustand = await bauAttrappe();
  z.server.placements![0]!.yaw = 3;
  const r1 = z.a.drehen(BUCHE, 1);
  z.a.verschieben(BUCHE, 12, 10);
  z.a.verschieben(BUCHE, 13, 10);
  await z.tick();
  z.offene[0]?.antworte('ablehnen');
  const ant = r1.ok ? await frist(r1.antwort) : null;
  pruefe(ant?.art === 'konflikt' && ant?.zurueckgenommen && ant?.verworfen === 2, `P9: ${JSON.stringify(ant)}`);
  pruefe(z.draft() === ausStart(), `P9: draft is back at the last confirmed state, got ${z.draft()}`);
  pruefe(z.a.abschliessen() === null && z.gesendet.length === 1, 'P9: the dropped drag frames are gone and are not sent');
}
// B2: strictly one after the other; refusal by the service without a foreign change: draft AND server equal
{
  const z: Zustand = await bauAttrappe();
  const r1 = z.a.drehen(BUCHE, 1); // ok
  const r2 = z.a.drehen(KUH, 2); // 422
  const r3 = z.a.drehen(KUH, 3); // dropped
  const r4 = z.a.setzen({ ...NEU }); // other object, dropped too
  await z.tick();
  z.offene[0]?.antworte('ok');
  await z.tick();
  pruefe(z.offene.length === 2, 'strict: the second goes out only after the first was answered');
  z.offene[1]?.antworte('422');
  const antworten3 = await Promise.all([r1, r2, r3, r4].map((r) => (r.ok ? frist(r.antwort) : Promise.resolve(null))));
  pruefe(z.hoechstens() === 1 && z.gesendet.length === 2, `strict: never two PATCHes at once (${z.hoechstens()}), 2 sent (${z.gesendet.length})`);
  pruefe(antworten3[0]?.art === 'angewendet', 'the first was confirmed');
  pruefe(antworten3[1]?.art === 'fehler' && antworten3[1]?.zurueckgenommen && antworten3[1]?.verworfen === 3, `422 with 3 gestures: ${JSON.stringify(antworten3[1])}`);
  pruefe(z.draft() === JSON.stringify(z.server.placements), `draft equals the server after the refusal:\n${z.draft()}\n${JSON.stringify(z.server.placements)}`);
}
// B2: the rollback that fails is said aloud (the draft was changed from outside)
{
  const z: Zustand = await bauAttrappe();
  const r = z.a.drehen(BUCHE, 1);
  const doc = z.p.laden()!;
  (doc.placements![0] as { yaw: number }).yaw = 2.5; // a foreign write into the draft (map editor)
  z.p.aendern(doc);
  await z.tick();
  z.offene[0]?.antworte('ablehnen');
  const ant = r.ok ? await frist(r.antwort) : null;
  pruefe(ant?.art === 'konflikt' && !ant?.zurueckgenommen, `failed rollback is reported as not put back: ${JSON.stringify(ant)}`);
  pruefe((ant ? antwortText(ant) : null)?.includes('NICHT zurückgesetzt') === true, 'the line says NOT put back');
}
// B3: no answer after sending / 204: unknown, no silent rollback, nothing more goes out
for (const wie of ['netz-nach-anwenden', '204'] as const) {
  const z: Zustand = await bauAttrappe();
  const r1 = z.a.drehen(BUCHE, 3);
  const r2 = z.a.drehen(KUH, 2); // waits
  await z.tick();
  z.offene[0]?.antworte(wie);
  const ant = r1.ok ? await frist(r1.antwort) : null;
  const ant2 = r2.ok ? await frist(r2.antwort) : null;
  pruefe(ant?.art === 'unklar' && /neu laden/.test((ant ? antwortText(ant) : null) ?? ''), `${wie}: unknown, ask for a reload: ${JSON.stringify(ant)}`);
  pruefe(ant2?.art === 'unklar' && z.gesendet.length === 1, `${wie}: the waiting Vorgang is not sent, ${z.gesendet.length} sent`);
  pruefe((z.p.laden()!.placements![0] as { yaw: number }).yaw === 3, `${wie}: the draft was NOT put back (the server has it)`);
  const weiter = z.a.drehen(BUCHE, 1);
  pruefe(!weiter.ok && /neu laden/.test(weiter.message), `${wie}: no further Vorgang until a reload`);
}
{
  const z: Zustand = await bauAttrappe();
  const r = z.a.drehen(BUCHE, 3);
  await z.tick();
  z.offene[0]?.antworte('netz');
  const ant = r.ok ? await frist(r.antwort) : null;
  pruefe(ant?.art === 'unklar', `network error without answer: unknown, ${JSON.stringify(ant)}`);
}

// B1: a second gesture never joins an open drag; the abandoned drag goes out
{
  const z: Zustand = await bauAttrappe();
  for (let i = 1; i <= 10; i++) z.a.verschieben(KUH, 20 + i, 20);
  for (let i = 1; i <= 10; i++) z.a.verschieben(BUCHE, 10 + i, 10); // grabbed the next object, the release of the first was lost
  const ende = z.a.abschliessen();
  await z.tick();
  const protokoll = z.p.protokoll();
  pruefe(protokoll.length === 2 && protokoll.every((v) => v.ops.length === 1), `B1: 2 gestures = 2 Vorgaenge with 1 op each, has ${protokoll.length} (${protokoll.map((v) => v.ops.length)})`);
  pruefe(z.intern.length === 1, 'B1: the answer of the drag closed inside is handed out');
  z.offene[0]?.antworte('ok');
  await z.tick();
  z.offene[1]?.antworte('ok');
  pruefe((await frist(ende))?.art === 'angewendet', 'B1: the last drag is answered');
  pruefe(z.gesendet.length === 2, `B1: both Vorgaenge went out, ${z.gesendet.length}`);
}
{
  // the last drag goes out with OpsPersistenz when it is closed (right click / Esc / blur all call abschliessen)
  const z: Zustand = await bauAttrappe();
  for (let i = 1; i <= 10; i++) z.a.verschieben(KUH, 20 + i, 20);
  const ende = z.a.abschliessen();
  await z.tick();
  pruefe(z.gesendet.length === 1 && ende !== null, 'B1: the closed drag is sent at once');
}

// B6: turning and NPC fields do not split a drag: locked during the drag
{
  const z: Zustand = await bauAttrappe();
  for (let i = 1; i <= 5; i++) z.a.verschieben(KUH, 20 + i, 20);
  const vorher = z.draft();
  const d = z.a.drehen(KUH, 1);
  const n = z.a.npcSetzen(KUH, { name: 'Neu' });
  pruefe(!d.ok && !n.ok && z.draft() === vorher, 'B6: turning and NPC fields are refused while a drag is open, draft unchanged');
  const ende = z.a.abschliessen();
  pruefe(z.p.protokoll().length === 1, `B6: the drag is ONE Vorgang, has ${z.p.protokoll().length}`);
  z.a.drehen(KUH, 1);
  pruefe(z.p.protokoll().length === 2, 'B6: after the drop turning works again');
  void ende;
}

// B5: duplicate ids: nothing is grabbed, turned, or deleted
{
  const doppelteIds: (l: Array<{ id?: string }> | undefined) => string[] =
    (await import('../src/editor/testflug/TestflugAktionen') as { doppelteIds?: (l: Array<{ id?: string }> | undefined) => string[] }).doppelteIds ?? (() => []);
  setzeStart();
  const dok = JSON.parse(speicher.get(ENTWURF_SCHLUESSEL)!) as { placements: Array<Record<string, unknown>> };
  dok.placements.push({ id: KUH, prefab: 'Kuh', x: 50, z: 50 });
  speicher.set(ENTWURF_SCHLUESSEL, JSON.stringify(dok));
  const vor = speicher.get(ENTWURF_SCHLUESSEL);
  const p = localStoragePersistenz();
  const a = new TestflugAktionen(p);
  pruefe(doppelteIds(p.laden()!.placements).join() === KUH, 'B5: the duplicate id is found');
  pruefe(doppelteIds([{ id: 'a' }, { id: 'b' }, {}]).length === 0, 'B5: no false alarm');
  const rs = [a.verschieben(KUH, 55, 55), a.drehen(KUH, 1), a.npcSetzen(KUH, null), a.loeschen(KUH)];
  pruefe(rs.every((r) => !r.ok && /Doppelte id/.test(r.message)), `B5: every action is refused with a message: ${JSON.stringify(rs.map((r) => r.ok || r.message))}`);
  pruefe(speicher.get(ENTWURF_SCHLUESSEL) === vor && p.protokoll().length === 0, 'B5: draft and count unchanged');
}

// Offline bytes: a long sequence; prints the size and the hash so that two trees can be compared
{
  const { createHash } = await import('node:crypto');
  setzeStart();
  const p = localStoragePersistenz();
  const a = new TestflugAktionen(p);
  a.setzen({ ...NEU });
  a.setzen({ id: 'haus_40_40-i9j0', prefab: 'Haus', x: 40, z: 40, yaw: 0.5, einebnen: 8 });
  a.setzen({ id: 'stein_1_1-k1l2', prefab: 'Stein', x: 1, z: 1, yaw: 1, scale: 1.5 });
  for (let i = 1; i <= 30; i++) a.verschieben(KUH, 20 + i * 0.1, 20 - i * 0.1);
  a.abschliessen();
  for (let i = 1; i <= 3; i++) a.verschieben(KUH, 30 + i, 30);
  a.abschliessen();
  a.verschieben(KUH, 40, 40);
  a.verschieben(KUH, 23, 17);
  a.abschliessen();
  a.verschieben(BUCHE, 11, 11);
  a.abschliessen();
  a.drehen(BUCHE, 2);
  a.drehen(BUCHE, 2 + Math.PI / 12);
  a.npcSetzen(KUH, { name: 'Berta' });
  a.npcSetzen(KUH, null);
  a.npcSetzen(KUH, { name: 'Ærlig Ulf' });
  a.npcSetzen(KUH, { name: 'Ærlig Ulf' });
  a.loeschen('haus_30_30-e5f6');
  a.loeschen('stein_1_1-k1l2');
  const text = speicher.get(ENTWURF_SCHLUESSEL)!;
  console.log(`  LANGE-FOLGE bytes=${Buffer.byteLength(text)} sha256=${createHash('sha256').update(text).digest('hex')}`);
}

// ── 4. Testflug.ts: no direct draft writes, no list place as address ─
{
  const testflug = readFileSync(new URL('../src/editor/testflug/Testflug.ts', import.meta.url), 'utf-8');
  pruefe(!/persistenz\.aendern\(/.test(testflug), 'Testflug.ts must not write the draft directly any more');
  pruefe(!/\b(auswahlIndex|ziehIndex)\b/.test(testflug), 'the grab and the selection are held by id, not by list place');
  // B1: a right click, Esc, lost focus, a cancelled pointer and leaving the window close an open drag
  const verwerfenRumpf = /const verwerfen = \(\): void => \{[\s\S]*?\n    \};/.exec(testflug)?.[0] ?? '';
  pruefe(/setzeAb\(\)/.test(verwerfenRumpf), 'B1: verwerfen() closes an open drag');
  pruefe(/addEventListener\('pointercancel', setzeAb\)/.test(testflug), 'B1: pointercancel closes the drag');
  pruefe(/addEventListener\('blur', setzeAb\)/.test(testflug), 'B1: losing the focus closes the drag');
  pruefe(/document\.addEventListener\('mouseleave', setzeAb\)/.test(testflug), 'B1: leaving the window closes the drag');
  pruefe(/e\.code === 'Escape'\) setzeAb\(\)/.test(testflug), 'B1: Esc closes the drag');
  pruefe(/persistenz\.aufInternenAbschluss = melde/.test(testflug), 'B3: the answer of an internally closed drag is shown');
  pruefe(/doppelteIds\(roh\.placements\)/.test(testflug), 'B5: a grab on a duplicate id is refused');
  for (const geste of ['setzen', 'verschieben', 'drehen', 'npcSetzen', 'loeschen', 'abschliessen']) {
    pruefe(new RegExp(`aktionen\\.${geste}\\(`).test(testflug), `Testflug.ts must go through aktionen.${geste}`);
  }
}

if (fehler > 0) {
  console.log(`\n${fehler} failure(s) of ${geprueft} checks`);
  process.exit(1);
}
console.log(`\nThe flight edits the draft as operations by id (${geprueft} checks).`);
