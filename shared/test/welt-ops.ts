/**
 * Operations on the world document (Editor E1, card K1.2): `wende`,
 * `invertiere`, `verschmelze` (shared/src/worldlayout/ops.ts).
 *
 *   npx tsx test/welt-ops.ts      (from shared/)
 *
 * Pure: no file, no server. The HTTP side is admin/test/welt-ops.ts.
 *
 * Placements get their `id` from card K1.1. As long as the sanitizer in this
 * tree drops that field, the test injects a stand-in that keeps it (same
 * shape K1.1 promises); once K1.1 is in, the real sanitizer is used and the
 * stand-in is bypassed. The first lines of the output say which one ran.
 */
import { sanitizeWorldLayout } from '../src/worldlayout/sanitize.js';
import type { WorldLayout } from '../src/worldlayout/types.js';
import {
  OP_COLLECTIONS,
  OP_LIMITS,
  invertiere,
  opAendern,
  opEntfernen,
  opSetzen,
  verschmelze,
  wende,
  type LayoutSanitizer,
  type Op,
  type OpCollection,
  type OpEntry,
  type Vorgang,
  type WendeErgebnis,
} from '../src/worldlayout/ops.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const bytes = (l: unknown): string => JSON.stringify(l, null, 2);
const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

// ── Sanitizer: the real one, or a stand-in until K1.1 keeps placement ids ──
const probe = sanitizeWorldLayout({
  version: 1,
  name: 'p',
  regions: [{ id: 'r', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 100 }, edgeFalloff: 300 }],
  placements: [{ id: 'p1', prefab: 'Beech1', x: 1, z: 2 }],
});
const ECHT = (probe?.placements?.[0] as unknown as { id?: string } | undefined)?.id === 'p1';

function sanitizeMitPlatzierungsIds(eingabe: unknown): WorldLayout | null {
  const basis = sanitizeWorldLayout(eingabe);
  const roh = eingabe as { placements?: unknown };
  if (!basis || typeof eingabe !== 'object' || eingabe === null || !Array.isArray(roh.placements)) return basis;
  const ids = new Set<string>();
  const platzierungen: unknown[] = [];
  for (const p of roh.placements.slice(0, OP_LIMITS.placements)) {
    const q = sanitizeWorldLayout({ version: 1, name: 'x', placements: [p] })?.placements?.[0];
    const id = (p as { id?: unknown } | null)?.id;
    if (!q || typeof id !== 'string' || !ID_RE.test(id) || ids.has(id)) continue;
    ids.add(id);
    platzierungen.push({ id, ...q });
  }
  const aus: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(basis)) {
    if (k === 'placements') continue;
    aus[k] = v;
    if (k === 'regions' && platzierungen.length > 0) aus.placements = platzierungen;
  }
  return aus as unknown as WorldLayout;
}
const san: LayoutSanitizer = ECHT ? sanitizeWorldLayout : sanitizeMitPlatzierungsIds;
console.log(`# placement ids: ${ECHT ? 'real sanitizer keeps them (K1.1 in tree)' : 'STAND-IN sanitizer (K1.1 not in tree yet)'}`);

// ── A document with entries in every collection ──────────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const zufall = rng(20260919);
const ganz = (n: number): number => Math.floor(zufall() * n);
const halb = (max: number): number => Math.round(zufall() * max * 2) / 2;

let zaehler = 0;
const neueId = (vorsatz: string): string => `${vorsatz}-${++zaehler}`;

function neuerEintrag(s: OpCollection): OpEntry {
  const id = neueId(s.slice(0, 3));
  switch (s) {
    case 'placements':
      return { id, prefab: 'Beech1', x: halb(900), z: halb(900) };
    case 'regions':
      return { id, biome: 'grassland', shape: { kind: 'circle', x: halb(900), z: halb(900), radius: 100 + halb(300) }, edgeFalloff: 300 };
    case 'routes':
      return { id, points: [[halb(500), halb(500)], [halb(500), halb(500)]], mode: 'loop' };
    case 'rivers':
      return { id, points: [[halb(500), halb(500)], [halb(500), halb(500)]], width: 10 + halb(30) };
    case 'lakes':
      return { id, x: halb(900), z: halb(900), radius: 20 + halb(100) };
    case 'continents':
      return { id, name: `Land ${zaehler}`, faction: 'neutral' };
  }
}

/** A changed copy of `e`: one field moved, still a valid entry. */
function veraendert(s: OpCollection, e: OpEntry): OpEntry {
  const k = structuredClone(e);
  switch (s) {
    case 'placements':
      k.x = halb(900);
      k.yaw = Math.round(zufall() * 6 * 100) / 100;
      break;
    case 'regions':
      k.edgeFalloff = 16 + halb(400);
      break;
    case 'routes':
      k.points = [...(k.points as number[][]), [halb(500), halb(500)]];
      break;
    case 'rivers':
      k.width = 10 + halb(30);
      break;
    case 'lakes':
      k.radius = 20 + halb(100);
      break;
    case 'continents':
      k.name = `Land ${ganz(1000)}`;
      break;
  }
  return k;
}

function ausgang(): WorldLayout {
  const roh: Record<string, unknown> = { version: 1, name: 'Ops', detailSeed: 'ops' };
  for (const s of OP_COLLECTIONS) {
    const n = s === 'placements' ? 40 : s === 'continents' ? 2 : 4;
    roh[s] = Array.from({ length: n }, () => neuerEintrag(s));
  }
  return san(roh)!;
}

function nimm(r: WendeErgebnis): WorldLayout {
  if (!r.ok) throw new Error(`unexpected failure: ${JSON.stringify(r)}`);
  return r.layout;
}
const liste = (l: WorldLayout, s: OpCollection): readonly OpEntry[] =>
  ((l as unknown as Record<string, unknown>)[s] as readonly OpEntry[] | undefined) ?? [];
const vg = (vorgangId: string, ...ops: Op[]): Vorgang => ({ vorgangId, ops });

const D = ausgang();
const D_BYTES = bytes(D);
check(
  'base document has entries in all six collections',
  OP_COLLECTIONS.every((s) => liste(D, s).length > 0),
  OP_COLLECTIONS.map((s) => `${s}=${liste(D, s).length}`).join(' ')
);

// ── Basic operations, one collection each ───────────────────────────
for (const s of OP_COLLECTIONS) {
  const vorhandenId = liste(D, s)[1]!.id;
  const neu = neuerEintrag(s);
  const r1 = wende(D, vg('a', opSetzen(s, neu)), san);
  check(`${s}: setze adds the entry at the end`, r1.ok && liste(r1.layout, s).at(-1)?.id === neu.id && liste(r1.layout, s).length === liste(D, s).length + 1);
  const geaendert = veraendert(s, liste(D, s)[1]!);
  const r2 = wende(D, vg('b', opAendern(D, s, geaendert)), san);
  check(
    `${s}: aendere replaces in place`,
    r2.ok &&
      liste(r2.layout, s).length === liste(D, s).length &&
      liste(r2.layout, s)[1]?.id === vorhandenId &&
      bytes(liste(r2.layout, s)[1]) !== bytes(liste(D, s)[1])
  );
  const r3 = wende(D, vg('c', opEntfernen(D, s, vorhandenId)), san);
  check(`${s}: entferne removes exactly that entry`, r3.ok && liste(r3.layout, s).length === liste(D, s).length - 1 && !liste(r3.layout, s).some((e) => e.id === vorhandenId));
}
check('input layout is never mutated', bytes(D) === D_BYTES);

// ── Conflicts ────────────────────────────────────────────────────────
{
  const s: OpCollection = 'lakes';
  const [l0, l1, l2] = liste(D, s) as [OpEntry, OpEntry, OpEntry];
  const stale = { ...l1, radius: 999 }; // what the writer "saw", not what is there
  const r = wende(D, vg('k', { art: 'aendere', sammlung: s, id: l1.id, vorher: stale, nachher: { ...l1, radius: 50 } }), san);
  check('aendere with a stale vorher is a conflict naming the id', !r.ok && r.art === 'konflikt' && r.ids.length === 1 && r.ids[0] === l1.id, JSON.stringify(r));
  const r2 = wende(D, vg('k2', { art: 'entferne', sammlung: s, id: l1.id, vorher: stale }), san);
  check('entferne with a stale vorher is a conflict', !r2.ok && r2.art === 'konflikt' && r2.ids[0] === l1.id);
  const r3 = wende(D, vg('k3', opSetzen(s, l1)), san);
  check('setze of an id that exists is a conflict', !r3.ok && r3.art === 'konflikt' && r3.ids[0] === l1.id);
  const gone = { id: 'gibt-es-nicht', x: 0, z: 0, radius: 50 };
  const r4 = wende(D, vg('k4', { art: 'aendere', sammlung: s, id: gone.id, vorher: gone, nachher: { ...gone, radius: 60 } }), san);
  check('aendere of an id that is not there is a conflict', !r4.ok && r4.art === 'konflikt' && r4.ids[0] === gone.id);

  // All conflicts are collected, and one conflict voids the whole Vorgang.
  const gut = opAendern(D, s, { ...l0, radius: 77 });
  const schlecht1 = { art: 'aendere' as const, sammlung: s, id: l1.id, vorher: stale, nachher: { ...l1, radius: 50 } };
  const schlecht2 = { art: 'entferne' as const, sammlung: s, id: l2.id, vorher: { ...l2, radius: 1234 } };
  const r5 = wende(D, vg('k5', gut, schlecht1, schlecht2), san);
  check(
    'all conflicting ids are reported, in order, and nothing is applied',
    !r5.ok && r5.art === 'konflikt' && r5.ids.join() === [l1.id, l2.id].join(),
    JSON.stringify(r5)
  );
  // Same id in two collections: `stellen` tells them apart.
  const zwei = wende(
    D,
    vg('k6', { art: 'entferne', sammlung: 'lakes', id: l1.id, vorher: stale }, { art: 'entferne', sammlung: 'regions', id: l1.id, vorher: { id: l1.id } }),
    san
  );
  check('conflicts carry the collection (stellen)', !zwei.ok && zwei.art === 'konflikt' && zwei.stellen.length === 2 && zwei.ids.length === 1);

  // Different objects never conflict, even from the same base.
  const a = vg('a', opAendern(D, s, { ...l0, radius: 61 }));
  const b = vg('b', opAendern(D, s, { ...l1, radius: 62 }));
  const nachA = nimm(wende(D, a, san));
  const beide = wende(nachA, b, san);
  check('two writers on two objects from the same base: both stand', beide.ok && liste(beide.layout, s)[0]!.radius === 61 && liste(beide.layout, s)[1]!.radius === 62);
  const dasselbe = wende(nachA, vg('b2', opAendern(D, s, { ...l0, radius: 63 })), san);
  check('two writers on the same object from the same base: the second conflicts', !dasselbe.ok && dasselbe.art === 'konflikt' && dasselbe.ids[0] === l0.id);

  // Canonical comparison: formatting noise in `vorher` is not a conflict.
  const laut = { ...l1, x: Number(l1.x) + 0.0000004 };
  const kanon = wende(D, vg('kanon', { art: 'aendere', sammlung: s, id: l1.id, vorher: laut, nachher: { ...l1, radius: 55 } }), san);
  check('vorher is compared canonically (a 0.4 µm difference is no conflict)', kanon.ok, JSON.stringify(kanon));
  const gedreht = Object.fromEntries(Object.entries(l1).reverse()) as OpEntry;
  const kanon2 = wende(D, vg('kanon2', { art: 'entferne', sammlung: s, id: l1.id, vorher: gedreht }), san);
  check('vorher is compared canonically (key order is no conflict)', kanon2.ok);

  // Ops of one Vorgang run in order: the second sees the result of the first.
  const erst = { ...l0, radius: 41 };
  const zweit = { ...l0, radius: 42 };
  const kette = wende(D, vg('kette', opAendern(D, s, erst), { art: 'aendere', sammlung: s, id: l0.id, vorher: erst, nachher: zweit }), san);
  check('ops of one Vorgang see each other (aendere twice on one object)', kette.ok && liste(kette.layout, s)[0]!.radius === 42);
}

// ── Invalid and over the limit: an error, never a silent cut ─────────
{
  const leer = wende(D, { vorgangId: 'v', ops: [] }, san);
  check('empty ops → ungueltig', !leer.ok && leer.art === 'ungueltig');
  const kaputt: unknown[] = [
    null,
    {},
    { vorgangId: 'v' },
    { vorgangId: 'a b', ops: [opSetzen('lakes', neuerEintrag('lakes'))] },
    { vorgangId: 'v', ops: [{ art: 'loesche', sammlung: 'lakes', id: 'x' }] },
    { vorgangId: 'v', ops: [{ art: 'setze', sammlung: '__proto__', id: 'x', nachher: { id: 'x' } }] },
    { vorgangId: 'v', ops: [{ art: 'setze', sammlung: 'lakes', id: 'Bad Id', nachher: { id: 'Bad Id', x: 0, z: 0, radius: 9 } }] },
    { vorgangId: 'v', ops: [{ art: 'setze', sammlung: 'lakes', id: 'x', nachher: { id: 'y', x: 0, z: 0, radius: 9 } }] },
    { vorgangId: 'v', ops: [{ art: 'setze', sammlung: 'lakes', id: 'x' }] },
    { vorgangId: 'v', ops: [{ art: 'setze', sammlung: 'lakes', id: 'x', vorher: { id: 'x' }, nachher: { id: 'x', x: 0, z: 0, radius: 9 } }] },
    { vorgangId: 'v', ops: [{ art: 'entferne', sammlung: 'lakes', id: 'x', vorher: { id: 'x' }, nachher: { id: 'x' } }] },
    { vorgangId: 'v', ops: [{ art: 'setze', sammlung: 'lakes', id: 'x', nachher: { id: 'x', x: 0, z: 0, radius: 9 }, index: -1 }] },
    { vorgangId: 'v', ops: [{ art: 'setze', sammlung: 'lakes', id: 'x', nachher: { id: 'x', x: 0, z: 0, radius: 9 }, index: 1.5 }] },
    { vorgangId: 'v', ops: 'nein' },
  ];
  const alleZu = kaputt.every((k) => {
    const r = wende(D, k, san);
    return !r.ok && r.art === 'ungueltig';
  });
  check(`${kaputt.length} malformed Vorgaenge are all ungueltig (nothing thrown)`, alleZu);

  const region = neuerEintrag('regions');
  const schlechteRegion = wende(D, vg('r', opSetzen('regions', { ...region, biome: 'nichtvorhanden' })), san);
  check('an entry the sanitizer would drop → ungueltig, not a silent drop', !schlechteRegion.ok && schlechteRegion.art === 'ungueltig', JSON.stringify(schlechteRegion));
  const gutUndSchlecht = wende(D, vg('r2', opSetzen('lakes', neuerEintrag('lakes')), opSetzen('regions', { ...region, biome: 'nichtvorhanden' })), san);
  check('one bad op voids the whole Vorgang', !gutUndSchlecht.ok && gutUndSchlecht.art === 'ungueltig');

  // Over the limit: 2000 placements is the ceiling, 2001 is an error.
  const voll = san({
    ...(D as unknown as Record<string, unknown>),
    placements: Array.from({ length: OP_LIMITS.placements }, (_, i) => ({ id: `pl-${i}`, prefab: 'Beech1', x: i % 500, z: Math.floor(i / 500) })),
  })!;
  check('setup: 2000 placements survive the sanitizer', liste(voll, 'placements').length === OP_LIMITS.placements, `= ${liste(voll, 'placements').length}`);
  const eins = wende(voll, vg('g', opSetzen('placements', { id: 'pl-extra', prefab: 'Beech1', x: 1, z: 1 })), san);
  check(
    'placement number 2001 → grenze (anzahl 2001, grenze 2000)',
    !eins.ok && eins.art === 'grenze' && eins.anzahl === 2001 && eins.grenze === 2000 && eins.sammlung === 'placements',
    JSON.stringify(eins)
  );
  const tausch = wende(
    voll,
    vg('g2', opEntfernen(voll, 'placements', 'pl-7'), opSetzen('placements', { id: 'pl-extra', prefab: 'Beech1', x: 1, z: 1 })),
    san
  );
  check('at the limit, remove one and add one in the same Vorgang is fine', tausch.ok && liste(tausch.layout, 'placements').length === 2000);
  // The regions cap (512) and continents cap (32) are enforced the same way.
  const kontinente = Array.from({ length: OP_LIMITS.continents }, (_, i) => ({ id: `k-${i}`, name: `K${i}` }));
  const k32 = san({ ...(D as unknown as Record<string, unknown>), continents: kontinente })!;
  const k33 = wende(k32, vg('k33', opSetzen('continents', { id: 'k-x', name: 'zu viel' })), san);
  check('continent number 33 → grenze', !k33.ok && k33.art === 'grenze' && k33.anzahl === 33 && k33.grenze === 32);

  // Safety net: a sanitizer that drops something the checks above did not foresee.
  const knausrig: LayoutSanitizer = (e) => {
    const l = san(e);
    if (!l) return l;
    return { ...l, lakes: (l.lakes ?? []).slice(0, 2) } as WorldLayout;
  };
  const still = wende(D, vg('s', opSetzen('lakes', neuerEintrag('lakes'))), knausrig);
  check('a sanitizer that drops entries silently is caught → ungueltig', !still.ok && still.art === 'ungueltig', JSON.stringify(still));
}

// ── Position: undo puts an entry back where it was ───────────────────
{
  const s: OpCollection = 'regions';
  const mitte = liste(D, s)[1]!.id;
  const weg = vg('w', opEntfernen(D, s, mitte));
  const nachWeg = nimm(wende(D, weg, san));
  const zurueck = nimm(wende(nachWeg, invertiere(weg), san));
  check('undo of entferne restores list order (region z-order)', bytes(zurueck) === D_BYTES);
  const vorn = vg('v', opSetzen(s, neuerEintrag(s), 0));
  check('setze at index 0 inserts first', liste(nimm(wende(D, vorn, san)), s)[0]?.id === (vorn.ops[0] as Op).id);
  check('setze with a huge index appends', liste(nimm(wende(D, vg('h', opSetzen(s, neuerEintrag(s), 900)), san)), s).length === liste(D, s).length + 1);
  const inv = invertiere(weg);
  check('invertiere(invertiere(v)) is v', bytes(invertiere(inv)) === bytes(weg));
  check('invertiere leaves its input alone', inv.ops[0]!.art === 'setze' && weg.ops[0]!.art === 'entferne');
}

// ── Property: 1,000 random Vorgaenge, wende → invertiere gives the bytes back ──
function zufallsOp(arbeit: WorldLayout, bevorzugt: Op[] = []): Op {
  // Half the time (when there is something to pick) go back to an object an earlier op already touched.
  const wieder = bevorzugt.filter((o) => liste(arbeit, o.sammlung).some((e) => e.id === o.id));
  if (wieder.length > 0 && zufall() < 0.6) {
    const o = wieder[ganz(wieder.length)]!;
    const ziel = liste(arbeit, o.sammlung).find((e) => e.id === o.id)!;
    const letzteRegion = o.sammlung === 'regions' && liste(arbeit, 'regions').length <= 1;
    return zufall() < 0.7 || letzteRegion ? opAendern(arbeit, o.sammlung, veraendert(o.sammlung, ziel)) : opEntfernen(arbeit, o.sammlung, o.id);
  }
  const s = OP_COLLECTIONS[ganz(OP_COLLECTIONS.length)]!;
  const vorhanden = liste(arbeit, s);
  const grenze = s === 'continents' ? 8 : 60;
  const wurf = zufall();
  if (vorhanden.length === 0 || (wurf < 0.35 && vorhanden.length < grenze)) {
    return opSetzen(s, neuerEintrag(s), zufall() < 0.5 ? ganz(vorhanden.length + 1) : undefined);
  }
  const ziel = vorhanden[ganz(vorhanden.length)]!;
  if (wurf < 0.75) return opAendern(arbeit, s, veraendert(s, ziel));
  // Never empty out regions completely: a world without regions is refused on disk.
  if (s === 'regions' && vorhanden.length <= 1) return opAendern(arbeit, s, veraendert(s, ziel));
  return opEntfernen(arbeit, s, ziel.id);
}

function zufallsVorgang(von: WorldLayout, name: string, maxOps = 5, bevorzugt: Op[] = []): { vorgang: Vorgang; erwartet: WorldLayout } {
  let arbeit = von;
  const ops: Op[] = [];
  const n = 1 + ganz(maxOps);
  for (let i = 0; i < n; i++) {
    const op = zufallsOp(arbeit, [...bevorzugt, ...ops]);
    arbeit = nimm(wende(arbeit, vg(`${name}.${i}`, op), san));
    ops.push(op);
  }
  return { vorgang: vg(name, ...ops), erwartet: arbeit };
}

{
  let stand = D;
  let gut = 0;
  let opsGesamt = 0;
  const art = { setze: 0, aendere: 0, entferne: 0 };
  const jeSammlung: Record<string, number> = {};
  const schlecht: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const vorherBytes = bytes(stand);
    const { vorgang, erwartet } = zufallsVorgang(stand, `v${i}`);
    const r = wende(stand, vorgang, san);
    let ok = r.ok && bytes(r.layout) === bytes(erwartet);
    if (r.ok) {
      const zurueck = wende(r.layout, invertiere(vorgang), san);
      ok = ok && zurueck.ok && bytes(zurueck.layout) === vorherBytes;
      // Applying the inverse twice-inverted is the forward Vorgang again.
      const wieder = zurueck.ok ? wende(zurueck.layout, invertiere(invertiere(vorgang)), san) : null;
      ok = ok && wieder !== null && wieder.ok && bytes(wieder.layout) === bytes(r.layout);
      ok = ok && bytes(stand) === vorherBytes;
      stand = r.layout;
    }
    if (ok) gut++;
    else if (schlecht.length < 3) schlecht.push(`#${i}: ${JSON.stringify(vorgang).slice(0, 300)}`);
    for (const op of vorgang.ops) {
      opsGesamt++;
      art[op.art]++;
      jeSammlung[op.sammlung] = (jeSammlung[op.sammlung] ?? 0) + 1;
    }
  }
  console.log(`# property: ${gut}/1000 Vorgaenge byte-identical after wende+invertiere; ${opsGesamt} ops (${JSON.stringify(art)}), per collection ${JSON.stringify(jeSammlung)}`);
  check('1000 random Vorgaenge: wende(wende(d, v), invertiere(v)) is byte-identical to d', gut === 1000, schlecht.join(' | '));
  check('the random walk touched every collection with every kind of op', OP_COLLECTIONS.every((s) => (jeSammlung[s] ?? 0) > 20) && art.setze > 100 && art.aendere > 100 && art.entferne > 100);
}

// ── verschmelze ─────────────────────────────────────────────────────
for (const s of OP_COLLECTIONS) {
  const ziel = liste(D, s)[0]!;
  let aktuell = D;
  let eintrag: OpEntry = ziel;
  const schritte: Vorgang[] = [];
  for (let i = 0; i < 50; i++) {
    const naechster = veraendert(s, eintrag);
    const v = vg(`drag-${i}`, opAendern(aktuell, s, naechster));
    schritte.push(v);
    aktuell = nimm(wende(aktuell, v, san));
    eintrag = liste(aktuell, s)[0]!;
  }
  const summe = schritte.slice(1).reduce((acc, v) => verschmelze(acc, v), schritte[0]!);
  const einzeln = schritte.reduce((l, v) => nimm(wende(l, v, san)), D);
  const ganzes = wende(D, summe, san);
  check(`${s}: 50 drag steps of one object merge into 1 Vorgang with 1 op`, summe.ops.length === 1, `= ${summe.ops.length}`);
  check(`${s}: the merged Vorgang has the effect of the 50 steps`, ganzes.ok && bytes(ganzes.layout) === bytes(einzeln));
  check(`${s}: the inverse of the merged Vorgang restores the start`, ganzes.ok && bytes(nimm(wende(ganzes.layout, invertiere(summe), san))) === D_BYTES);
}
{
  // setze then drag then remove of the same new object leaves nothing behind.
  const s: OpCollection = 'lakes';
  const neu = neuerEintrag(s);
  const a = vg('a', opSetzen(s, neu));
  const nachA = nimm(wende(D, a, san));
  const b = vg('b', opAendern(nachA, s, { ...neu, radius: 77 }));
  const nachB = nimm(wende(nachA, b, san));
  const c = vg('c', opEntfernen(nachB, s, neu.id));
  const ab = verschmelze(a, b);
  check('setze + aendere folds into one setze with the final entry', ab.ops.length === 1 && ab.ops[0]!.art === 'setze' && ab.ops[0]!.nachher?.radius === 77);
  const abc = verschmelze(ab, c);
  check('setze + aendere + entferne cancels out (0 ops)', abc.ops.length === 0, `= ${abc.ops.length}`);
  const alt = liste(D, s)[0]!;
  const x = vg('x', opAendern(D, s, { ...alt, radius: 33 }));
  const nachX = nimm(wende(D, x, san));
  const y = vg('y', opEntfernen(nachX, s, alt.id));
  const xy = verschmelze(x, y);
  check('aendere + entferne folds into one entferne carrying the ORIGINAL vorher', xy.ops.length === 1 && xy.ops[0]!.art === 'entferne' && xy.ops[0]!.vorher?.radius === alt.radius);
  check('…and it undoes to the original', bytes(nimm(wende(nimm(wende(D, xy, san)), invertiere(xy), san))) === D_BYTES);
  // Not foldable (a stale link between the two): kept apart, so the meaning stays exact.
  const fremd = vg('f', { art: 'aendere', sammlung: s, id: alt.id, vorher: { ...alt, radius: 1 }, nachher: { ...alt, radius: 2 } });
  check('ops that do not chain (vorher ≠ previous nachher) are not folded', verschmelze(x, fremd).ops.length === 2);
}
{
  // 1000 random pairs: the merged Vorgang does what the two do in a row, and undoes to the start.
  let stand = D;
  let gut = 0;
  let gefaltet = 0;
  let angehaengt = 0;
  let leer = 0;
  const schlecht: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const a = zufallsVorgang(stand, `pa${i}`, 3);
    const b = zufallsVorgang(a.erwartet, `pb${i}`, 3, a.vorgang.ops);
    const m = verschmelze(a.vorgang, b.vorgang);
    gefaltet += a.vorgang.ops.length + b.vorgang.ops.length - m.ops.length;
    angehaengt += m.ops.length;
    let ok: boolean;
    if (m.ops.length === 0) {
      // Everything cancelled out (created and deleted again): the pair must have had no effect at all.
      leer++;
      ok = bytes(b.erwartet) === bytes(stand);
    } else {
      const r = wende(stand, m, san);
      ok = r.ok && bytes(r.layout) === bytes(b.erwartet);
      if (r.ok) {
        const zurueck = wende(r.layout, invertiere(m), san);
        ok = ok && zurueck.ok && bytes(zurueck.layout) === bytes(stand);
      }
    }
    if (ok) gut++;
    else if (schlecht.length < 3) schlecht.push(`#${i}: ${JSON.stringify(a.vorgang).slice(0, 200)} + ${JSON.stringify(b.vorgang).slice(0, 200)}`);
    stand = b.erwartet;
  }
  console.log(`# verschmelze property: ${gut}/1000 pairs exact; ${gefaltet} ops saved by folding, ${angehaengt} ops kept, ${leer} pairs cancelled to nothing`);
  check('1000 random pairs: verschmelze(a, b) = a then b, and its inverse restores the start', gut === 1000, schlecht.join(' | '));
  check('the random pairs did fold some ops (the test is not vacuous)', gefaltet > 100, `= ${gefaltet}`);
}

process.exit(fehler > 0 ? 1 : 0);
