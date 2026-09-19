/**
 * Placing tool (Editor E1, K1.3) against a fake `WerkzeugKontext`, without an
 * editor window: set, select, drag, change, delete, jump from a finding.
 *
 * What is measured is the effect on the DOCUMENT and the operation the tool
 * hands to the editor (`aendere(neu, vorgang)`: kind, collection, id), not
 * what the old `if (werkzeug === 'platzieren')` branch looked like. The fake
 * context keeps an undo stack of snapshots exactly like the editor does.
 *
 * The source guard at the end must be red on `e6a7351`: there the module does
 * not exist and `editorMain.ts` still appends id-less entries.
 *
 * Run:  npx tsx test/werkzeug-platzieren.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruefeLayout, sanitizeWorldLayout, type PlacementDef, type WorldLayout } from '@wov/shared';
import { invertiere, wende, type Vorgang } from '@wov/shared/src/worldlayout/ops.js';
import type { SeitenHost, WerkzeugKontext } from '../src/editor/werkzeuge/typ';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');
const EDITOR = resolve(HIER, '../src/editor');

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}
function gleich(name: string, ist: unknown, soll: unknown): void {
  const a = JSON.stringify(ist);
  const b = JSON.stringify(soll);
  check(name, a === b, a === b ? a : `ist ${a}, soll ${b}`);
}

// ── Fake context: document, undo/redo snapshots, recorded operations ──
interface Meldung {
  text: string;
  fehler: boolean;
}
function neuerKontext(start: WorldLayout, aktiv = 'platzieren', massstab = 0.1) {
  const z = {
    layout: start,
    /** Snapshots pushed by `aendere`: one entry = one undo step (the editor's `merkeSchritt`). */
    schritte: [] as WorldLayout[],
    wieder: [] as WorldLayout[],
    /** The operation of every `aendere` call, in order. */
    vorgaenge: [] as (Vorgang | undefined)[],
    aktiv,
    uebernommen: 0,
    seite: 0,
    zeichnen: 0,
    meldungen: [] as Meldung[],
    massstab,
    fragen: [] as string[],
    antwort: true,
  };
  const ctx: WerkzeugKontext = {
    layout: () => z.layout,
    aendere: (neu, vorgang) => {
      z.schritte.push(z.layout);
      z.wieder = [];
      z.layout = neu;
      z.vorgaenge.push(vorgang);
    },
    bestaetige: (frage) => {
      z.fragen.push(frage);
      return z.antwort;
    },
    werkzeugId: () => z.aktiv,
    zurAuswahl: () => {
      z.aktiv = 'auswahl';
    },
    uebernommen: () => {
      z.uebernommen++;
    },
    seiteNeuBauen: () => {
      z.seite++;
    },
    neuZeichnen: () => {
      z.zeichnen++;
    },
    meldung: (text, f = false) => {
      z.meldungen.push({ text, fehler: f });
    },
    zuBild: (wx, wz) => [wx / z.massstab + 400, wz / z.massstab + 300],
    massstab: () => z.massstab,
  };
  const rueckgaengig = (): boolean => {
    const v = z.schritte.pop();
    if (v === undefined) return false;
    z.wieder.push(z.layout);
    z.layout = v;
    return true;
  };
  const wiederherstellen = (): boolean => {
    const v = z.wieder.pop();
    if (v === undefined) return false;
    z.schritte.push(z.layout);
    z.layout = v;
    return true;
  };
  return { z, ctx, rueckgaengig, wiederherstellen };
}

// ── Fake canvas ──────────────────────────────────────────────────────
function neuerZeichner() {
  const log: string[] = [];
  const z = {
    log,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    tiefe: 0,
    save: () => {
      z.tiefe++;
      log.push('save');
    },
    restore: () => {
      z.tiefe--;
      log.push('restore');
    },
    beginPath: () => log.push('beginPath'),
    arc: (x: number, y: number, r: number) => log.push(`arc ${x},${y},${r}`),
    moveTo: (x: number, y: number) => log.push(`moveTo ${x},${y}`),
    lineTo: (x: number, y: number) => log.push(`lineTo ${x},${y}`),
    stroke: () => log.push(`stroke ${z.strokeStyle} w${z.lineWidth}`),
    fill: () => log.push(`fill ${z.fillStyle}`),
    setLineDash: (d: number[]) => log.push(`dash ${JSON.stringify(d)}`),
  };
  return z;
}

// ── Fake DOM: what `design.ts` (el, feld) and the tool's sidebar need ──
interface FakeKnoten {
  tag: string;
  id?: string;
  style: { cssText: string };
  children: FakeKnoten[];
  attribute: Record<string, string>;
  title?: string;
  value?: string;
  textContent?: string;
  onchange?: () => void;
  appendChild(k: FakeKnoten): FakeKnoten;
  append(...k: FakeKnoten[]): void;
  setAttribute(n: string, v: string): void;
  querySelector(sel: string): FakeKnoten | null;
}
const angehaengt: FakeKnoten[] = [];
function fakeKnoten(tag: string): FakeKnoten {
  const k: FakeKnoten = {
    tag,
    style: { cssText: '' },
    children: [],
    attribute: {},
    appendChild(c) {
      k.children.push(c);
      return c;
    },
    append(...c) {
      k.children.push(...c);
    },
    setAttribute(n, v) {
      k.attribute[n] = v;
    },
    querySelector(sel) {
      return finde(k, (x) => x !== k && x.tag === sel)[0] ?? null;
    },
  };
  return k;
}
(globalThis as unknown as { document: unknown }).document = {
  createElement: fakeKnoten,
  getElementById: (id: string) => angehaengt.find((k) => k.id === id) ?? null,
  body: { appendChild: (k: FakeKnoten) => angehaengt.push(k) },
};
function finde(k: FakeKnoten, pruefe: (k: FakeKnoten) => boolean, aus: FakeKnoten[] = []): FakeKnoten[] {
  if (pruefe(k)) aus.push(k);
  for (const c of k.children) finde(c, pruefe, aus);
  return aus;
}
/** Type a value into the sidebar field with this tooltip. */
function tippe(block: FakeKnoten, titel: string, wert: string): void {
  const i = finde(block, (k) => k.tag === 'input' && k.title === titel)[0];
  if (!i) throw new Error(`no field "${titel}" in the sidebar`);
  i.value = wert;
  i.onchange!();
}
const hatFeld = (block: FakeKnoten, titel: string): boolean => finde(block, (k) => k.tag === 'input' && k.title === titel).length > 0;
function neuerHost() {
  const knoepfe: { text: string; cb: () => void }[] = [];
  const host = {
    hinweis: (text: string) => Object.assign(fakeKnoten('hint'), { textContent: text }),
    beschriftet: (text: string, inhalt: FakeKnoten) => {
      const k = Object.assign(fakeKnoten('label'), { textContent: text });
      k.children.push(inhalt);
      return k;
    },
    breiterKnopf: (text: string, cb: () => void) => {
      knoepfe.push({ text, cb });
      return Object.assign(fakeKnoten('button'), { textContent: text });
    },
  };
  return { host: host as unknown as SeitenHost, knoepfe };
}

// ── Documents ────────────────────────────────────────────────────────
const echt = sanitizeWorldLayout(JSON.parse(readFileSync(resolve(WURZEL, 'server/data/welten/dev.json'), 'utf-8')))!;
const kanon = (l: WorldLayout): string => JSON.stringify(sanitizeWorldLayout(l));
const platz = (l: WorldLayout): readonly PlacementDef[] => l.placements ?? [];
const klick = (x: number, z: number, shiftKey = false) => ({ weltX: x, weltZ: z, shiftKey });
const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/** Start document for the scripts: the real dev world (159 objects) plus three we know by id. */
const start: WorldLayout = sanitizeWorldLayout({
  ...echt,
  placements: [
    ...platz(echt),
    { id: 'probe-a', prefab: 'Beech1', x: 5000, z: 5000, yaw: 0.5 },
    { id: 'probe-b', prefab: 'Beech1', x: 5000.3, z: 5000, yaw: 1 },
    { id: 'probe-c', prefab: 'Birch1', x: 5100, z: 5000, scale: 2 },
  ],
})!;

/** Small deterministic random source for the scripted actions. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

async function main(): Promise<void> {
  console.log('Placing tool: module');
  let modul: typeof import('../src/editor/werkzeuge/platzieren') | null = null;
  let reg: typeof import('../src/editor/werkzeuge') | null = null;
  try {
    modul = await import('../src/editor/werkzeuge/platzieren');
    reg = await import('../src/editor/werkzeuge');
  } catch (e) {
    console.log(`  (module missing: ${(e as Error).message.split('\n')[0]})`);
  }
  check('werkzeuge/platzieren.ts loads and the registry offers the tool', modul !== null && reg?.werkzeugMitId('platzieren')?.id === 'platzieren');

  if (modul && reg) {
    const { erzeugePlatzieren, trefferSuchen, platzierungZuBefund, TREFFER_PX, ZUG_PX } = modul;
    const zuGrad = (g: number): number => (g * Math.PI) / 180;

    // ── The tool through the registry wrapper ──────────────────────
    {
      const w = reg.platzierenWerkzeug;
      check('the registry entry is guarded and keeps the tool\'s own members', typeof w.setzePrefab === 'function' && typeof w.auswahlId === 'function' && typeof w.waehle === 'function');
      gleich('tile: name, wide, badge = default prefab', [w.kachelName, w.kachelBreit, w.kachelZusatz(), w.hudZusatz(), w.titel], ['Objekt platzieren', true, 'Beech1', 'Beech1', 'Objekt platzieren']);
      gleich('key help', w.tasten, [['Klick', 'setzen / wählen'], ['Ziehen', 'verschieben'], ['Entf', 'löschen'], ['Shift', 'auf Objekt setzen']]);
      check('hooks present: pointer move, pointer up, key, overlay, sidebar', [w.beiZeigerBewegt, w.beiZeigerHoch, w.beiTaste, w.zeichneOverlay, w.seitenleiste].every((h) => typeof h === 'function'));
      const { z, ctx } = neuerKontext(start);
      const vorher = platz(z.layout).length;
      check('a click through the guarded tool is handled', w.beiZeigerRunter(ctx, klick(15000, 15000)) === true);
      gleich('…and set one object with one undo step', [platz(z.layout).length - vorher, z.schritte.length], [1, 1]);
      w.abbrechen(ctx);
    }

    // ── Set ────────────────────────────────────────────────────────
    console.log('Set: id, turn, prefab');
    {
      const gemerkt: string[] = [];
      const t = erzeugePlatzieren({ zufall: () => 0.25, merkePrefab: (n) => gemerkt.push(n) });
      const { z, ctx } = neuerKontext(start);
      const idsVorher = new Set(platz(z.layout).map((p) => p.id));
      check('click on free ground is handled', t.beiZeigerRunter(ctx, klick(10.4, 9979.4)) === true);
      const neu = platz(z.layout).find((p) => !idsVorher.has(p.id))!;
      check('one new object with a valid id', neu !== undefined && typeof neu.id === 'string' && ID_RE.test(neu.id), neu?.id);
      gleich('prefab Beech1, position rounded to whole metres, random turn = 0.25 × 2π rounded to 0.001', [neu.prefab, neu.x, neu.z, neu.yaw], ['Beech1', 10, 9979, 1.571]);
      gleich('operation: kind, collection, id, no vorher', [z.vorgaenge[0]?.ops.length, z.vorgaenge[0]?.ops[0]?.art, z.vorgaenge[0]?.ops[0]?.sammlung, z.vorgaenge[0]?.ops[0]?.id, z.vorgaenge[0]?.ops[0]?.vorher], [1, 'setze', 'placements', neu.id, undefined]);
      gleich('one undo step, committed once, selected the new object', [z.schritte.length, z.uebernommen, t.auswahlId()], [1, 1, neu.id]);
      check('the tool stays active (no switch to the selection tool)', z.aktiv === 'platzieren');
      check('message names the object', z.meldungen.length === 1 && z.meldungen[0]!.text.startsWith(`${neu.id} gesetzt`), z.meldungen[0]?.text);
      // the sidebar: random turn is the default, off → the typed turn is used
      const { host, knoepfe } = neuerHost();
      const block = t.seitenleiste!(ctx, host) as unknown as FakeKnoten;
      const drehKnoepfe = (k: { text: string }[]): string[] => k.map((x) => x.text).filter((x) => x.startsWith('Zufällige'));
      gleich('random turn is ON by default (button text)', drehKnoepfe(knoepfe), ['Zufällige Drehung: an']);
      knoepfe.find((k) => k.text.startsWith('Zufällige'))!.cb();
      const { host: host2, knoepfe: knoepfe2 } = neuerHost();
      const block2 = t.seitenleiste!(ctx, host2) as unknown as FakeKnoten;
      gleich('after the switch: OFF', drehKnoepfe(knoepfe2), ['Zufällige Drehung: aus']);
      tippe(block2, 'Drehung neuer Objekte in Grad (gilt bei ausgeschalteter Zufallsdrehung)', '90');
      t.beiZeigerRunter(ctx, klick(12100, 12100));
      const zweite = platz(z.layout).find((p) => p.x === 12100 && p.z === 12100)!;
      check('random off: yaw = the typed 90° (π/2)', Math.abs((zweite.yaw ?? NaN) - Math.PI / 2) < 1e-12, String(zweite.yaw));
      tippe(block2, 'Drehung neuer Objekte in Grad (gilt bei ausgeschalteter Zufallsdrehung)', '-450');
      t.beiZeigerRunter(ctx, klick(12200, 12200));
      check('typed −450° = −90° (turned into (−360, 360))', Math.abs((platz(z.layout).find((p) => p.x === 12200 && p.z === 12200)!.yaw ?? NaN) + Math.PI / 2) < 1e-12);
      tippe(block2, 'Drehung neuer Objekte in Grad (gilt bei ausgeschalteter Zufallsdrehung)', 'abc');
      gleich('garbage in the turn field: message, value kept (−90)', [z.meldungen.at(-1)?.fehler, z.meldungen.at(-1)?.text], [true, 'Drehung muss eine Zahl sein (Grad)']);
      // prefab of new objects
      tippe(block2, 'Prefab-Name neuer Objekte — Vorschläge aus der Vegetationstabelle', ' Birch1 ');
      gleich('prefab field: trimmed, remembered for the test flight, shown in the badges', [t.prefab(), gemerkt, t.kachelZusatz(), t.hudZusatz()], ['Birch1', ['Birch1'], 'Birch1', 'Birch1']);
      t.beiZeigerRunter(ctx, klick(12300, 12300));
      gleich('the next object has the new prefab', platz(z.layout).find((p) => p.x === 12300 && p.z === 12300)?.prefab, 'Birch1');
      t.setzePrefab('   ');
      gleich('an empty prefab falls back to the default', t.prefab(), 'Beech1');
      tippe(block2, 'Prefab-Name neuer Objekte — Vorschläge aus der Vegetationstabelle', 'X'.repeat(65));
      check('a prefab name over 64 characters is refused with a message, prefab kept', z.meldungen.at(-1)?.fehler === true && /zu lang/.test(z.meldungen.at(-1)!.text) && t.prefab() === 'Beech1');
      check('the datalist of prefab suggestions exists exactly once', angehaengt.filter((k) => k.id === 'prefab-liste').length === 1 && angehaengt[0]!.children.length > 10, `${angehaengt[0]?.children.length} options`);
      check('the prefab input points at the datalist', finde(block, (k) => k.tag === 'input' && k.attribute.list === 'prefab-liste').length === 1);
    }

    console.log('Set: 100 objects at one place, same prefab (the K1.1 case)');
    {
      const t = erzeugePlatzieren({ zufall: () => 0.5 });
      const { z, ctx } = neuerKontext(start);
      const vorher = new Map(platz(z.layout).map((p) => [p.id!, JSON.stringify(p)]));
      // an existing object at the very spot with the derived id
      const { z: z0, ctx: c0 } = neuerKontext(sanitizeWorldLayout({ ...start, placements: [{ prefab: 'Beech1', x: 5, z: 5 }] })!);
      const idAlt = platz(z0.layout)[0]!.id!;
      for (let i = 0; i < 100; i++) t.beiZeigerRunter(c0, klick(5, 5, true));
      const ids = platz(z0.layout).map((p) => p.id!);
      gleich('101 objects, 101 different valid ids', [ids.length, new Set(ids).size, ids.every((i) => ID_RE.test(i))], [101, 101, true]);
      gleich('the old object keeps id AND content', platz(z0.layout).find((p) => p.id === idAlt), { id: idAlt, prefab: 'Beech1', x: 5, z: 5 });
      gleich('100 undo steps, 100 "setze" operations of placements', [z0.schritte.length, z0.vorgaenge.every((v) => v?.ops.length === 1 && v.ops[0]!.art === 'setze' && v.ops[0]!.sammlung === 'placements')], [100, true]);
      // and next to the real document: nothing existing changes
      for (let i = 0; i < 100; i++) t.beiZeigerRunter(ctx, klick(20000 + (i % 7), 20000, true));
      const nachher = new Map(platz(z.layout).map((p) => [p.id!, JSON.stringify(p)]));
      let veraendert = 0;
      for (const [id, text] of vorher) if (nachher.get(id) !== text) veraendert++;
      gleich('in the real world: 159+3 existing ids unchanged, +100 new', [veraendert, nachher.size - vorher.size], [0, 100]);
      // Shift is what sets on top of an object; without it the click selects the object under the pointer
      const t2 = erzeugePlatzieren({ zufall: () => 0.5 });
      t2.beiZeigerRunter(c0, klick(5, 5, false));
      gleich('without Shift a click on the object selects it and sets nothing', [platz(z0.layout).length, t2.auswahlId()], [101, idAlt]);
    }

    console.log('Set: outside the world');
    {
      const t = erzeugePlatzieren();
      const { z, ctx } = neuerKontext(start);
      check('the click is consumed', t.beiZeigerRunter(ctx, klick(40001, 0)) === true);
      gleich('a click beyond ±40000 m: nothing set, no step, plain message', [platz(z.layout).length, z.schritte.length, z.meldungen.at(-1)?.fehler, /Außerhalb der Welt/.test(z.meldungen.at(-1)?.text ?? '')], [platz(start).length, 0, true, true]);
      t.beiZeigerRunter(ctx, klick(40000, -40000));
      gleich('exactly on the border is fine', [platz(z.layout).length - platz(start).length, z.schritte.length], [1, 1]);
    }

    console.log('Set: refused by the operation (limit of 2,000)');
    {
      const voll: WorldLayout = sanitizeWorldLayout({ ...start, placements: Array.from({ length: 2000 }, (_, i) => ({ id: `voll-${i}`, prefab: 'Beech1', x: i * 10 - 10000, z: 0 })) })!;
      check('fixture: 2,000 objects', platz(voll).length === 2000);
      const t = erzeugePlatzieren();
      const { z, ctx } = neuerKontext(voll);
      check('the click is consumed', t.beiZeigerRunter(ctx, klick(0, 9000)) === true);
      gleich('nothing changed, no undo step, no commit', [platz(z.layout).length, z.schritte.length, z.uebernommen, t.auswahlId()], [2000, 0, 0, null]);
      check('the message says why', z.meldungen.length === 1 && z.meldungen[0]!.fehler && /2000/.test(z.meldungen[0]!.text), z.meldungen[0]?.text);
    }

    // ── Select ─────────────────────────────────────────────────────
    console.log('Select: tolerance in screen pixels, converted with the map scale');
    {
      gleich('the tolerance is named: 8 px; a drag starts after 4 px', [TREFFER_PX, ZUG_PX], [8, 4]);
      const t = erzeugePlatzieren();
      const { z, ctx } = neuerKontext(start, 'platzieren', 0.1); // 0.1 m/px → 8 px = 0.8 m
      t.beiZeigerRunter(ctx, klick(5000.1 + 0.4, 5000.0 + 0));
      // probe-a at (5000,5000), probe-b at (5000.3,5000): the click at 5000.5 is 0.5 from a and 0.2 from b → b wins
      gleich('at 0.1 m/px a click 0.5 m from a and 0.2 m from b: the NEARER one (probe-b) wins', [t.auswahlId(), platz(z.layout).length], ['probe-b', platz(start).length]);
      const { z: z2, ctx: c2 } = neuerKontext(start, 'platzieren', 0.1);
      const t2 = erzeugePlatzieren();
      t2.beiZeigerRunter(c2, klick(5100.4, 5000));
      gleich('0.4 m beside probe-c: selected, nothing set', [t2.auswahlId(), platz(z2.layout).length], ['probe-c', platz(start).length]);
      const t3 = erzeugePlatzieren();
      const { z: z3, ctx: c3 } = neuerKontext(start, 'platzieren', 0.1);
      t3.beiZeigerRunter(c3, klick(5100 + 3, 5000));
      const neu = platz(z3.layout).find((p) => p.x === 5103 && p.z === 5000);
      check('3 m beside probe-c: NOT selected — a new object is set there and selected', neu !== undefined && t3.auswahlId() === neu.id && t3.auswahlId() !== 'probe-c', String(t3.auswahlId()));
      gleich('the same 0.4 m at 40 m/px (tolerance 320 m) hits; 3 m hits as well — the tolerance is pixels, not metres', [
        trefferSuchen(platz(start), 5100.4, 5000, TREFFER_PX * 40)?.id,
        trefferSuchen(platz(start), 5103, 5000, TREFFER_PX * 40)?.id,
        trefferSuchen(platz(start), 5100 + 3, 5000, TREFFER_PX * 0.1),
      ], ['probe-c', 'probe-c', undefined]);
      gleich('tie: two objects at the same distance → the earlier one', trefferSuchen([{ id: 'a', prefab: 'X', x: 1, z: 0 }, { id: 'b', prefab: 'X', x: -1, z: 0 }], 0, 0, 5)?.id, 'a');
      gleich('an object without an id cannot be selected', trefferSuchen([{ prefab: 'X', x: 0, z: 0 }], 0, 0, 5), undefined);
      // the sidebar shows the selection as fields
      const { host, knoepfe } = neuerHost();
      const block = t.seitenleiste!(ctx, host) as unknown as FakeKnoten;
      const felder = ['Prefab des ausgewählten Objekts (ein Wechsel ersetzt das Objekt im Spiel)', 'x des ausgewählten Objekts in Metern', 'z des ausgewählten Objekts in Metern', 'Drehung des ausgewählten Objekts in Grad', 'Skalierung des ausgewählten Objekts (0,2 bis 5)'];
      check('selection: fields for prefab, x, z, turn, scale', felder.every((f) => hatFeld(block, f)));
      const werte = felder.map((f) => finde(block, (k) => k.tag === 'input' && k.title === f)[0]!.value);
      gleich('…filled with probe-b: Beech1, 5000.3, 5000, 57.3° (1 rad), scale 1', werte, ['Beech1', '5000.3', '5000', '57.3', '1']);
      check('the id is shown', finde(block, (k) => k.textContent === 'probe-b').length === 1);
      check('a delete button', knoepfe.some((k) => k.text === 'Objekt löschen (Entf)'));
      const { host: h2 } = neuerHost();
      t.waehle(null);
      const leer = t.seitenleiste!(ctx, h2) as unknown as FakeKnoten;
      check('no selection: no object fields', !hatFeld(leer, felder[0]!) && !hatFeld(leer, felder[1]!));
      // an undo that takes the selected object away leaves nothing to show
      const t4 = erzeugePlatzieren();
      const k4 = neuerKontext(start);
      t4.beiZeigerRunter(k4.ctx, klick(16000, 16000));
      const idNeu = t4.auswahlId()!;
      k4.rueckgaengig();
      check('after undoing the set, the selected id is gone from the document: no fields, no ring', !hatFeld(t4.seitenleiste!(k4.ctx, neuerHost().host) as unknown as FakeKnoten, felder[0]!) && (() => {
        const zz = neuerZeichner();
        t4.zeichneOverlay!(k4.ctx, zz as unknown as CanvasRenderingContext2D);
        return zz.log.length === 0;
      })(), idNeu);
    }

    // ── Drag ───────────────────────────────────────────────────────
    console.log('Drag: 30 pointer moves = 1 undo step');
    {
      const t = erzeugePlatzieren();
      const { z, ctx, rueckgaengig } = neuerKontext(start, 'platzieren', 1);
      t.beiZeigerRunter(ctx, klick(5100.5, 5000.5)); // press 0.5 m beside probe-c (scale 1 m/px → 8 m tolerance)
      gleich('the press selects and changes nothing yet', [t.auswahlId(), z.schritte.length, z.vorgaenge.length], ['probe-c', 0, 0]);
      const start0 = z.zeichnen;
      for (let i = 1; i <= 30; i++) t.beiZeigerBewegt!(ctx, klick(5100.5 + i * 2, 5000.5 + i));
      gleich('30 moves: NO change of the document, no undo step (the drag is a ghost)', [z.schritte.length, z.vorgaenge.length, platz(z.layout).find((p) => p.id === 'probe-c')?.x], [0, 0, 5100]);
      check('…the first move under 4 px did not count, the others redrew', z.zeichnen - start0 === 30 - 1 || z.zeichnen - start0 === 30, `${z.zeichnen - start0} redraws`);
      const zz = neuerZeichner();
      t.zeichneOverlay!(ctx, zz as unknown as CanvasRenderingContext2D);
      check('overlay while dragging: ring + ghost (2 arcs), a dashed line, save/restore balanced', zz.log.filter((l) => l.startsWith('arc')).length === 2 && zz.log.includes('dash [4,4]') && zz.tiefe === 0, zz.log.join('|'));
      t.beiZeigerHoch!(ctx, klick(5100.5 + 60, 5000.5 + 30));
      gleich('release: ONE undo step, ONE operation "aendere" of placements/probe-c', [z.schritte.length, z.vorgaenge.length, z.vorgaenge[0]?.ops.map((o) => `${o.art}/${o.sammlung}/${o.id}`)], [1, 1, ['aendere/placements/probe-c']]);
      const p = platz(z.layout).find((q) => q.id === 'probe-c')!;
      gleich('the object moved by exactly the pointer travel (60, 30), scale kept', [p.x, p.z, p.scale], [5160, 5030, 2]);
      gleich('vorher/nachher of the operation', [z.vorgaenge[0]!.ops[0]!.vorher, z.vorgaenge[0]!.ops[0]!.nachher], [{ id: 'probe-c', prefab: 'Birch1', x: 5100, z: 5000, scale: 2 }, { id: 'probe-c', prefab: 'Birch1', x: 5160, z: 5030, scale: 2 }]);
      gleich('committed once, message names the object and the new place', [z.uebernommen, z.meldungen.at(-1)?.text], [1, 'probe-c verschoben (5160, 5030)']);
      rueckgaengig();
      gleich('ONE undo puts it back exactly', platz(z.layout).find((q) => q.id === 'probe-c'), platz(start).find((q) => q.id === 'probe-c'));
      // a further release does nothing
      t.beiZeigerHoch!(ctx, klick(1, 1));
      gleich('a second release without a press changes nothing', [z.schritte.length, z.vorgaenge.length], [0, 1]);
    }
    {
      console.log('Drag: shaky click, Escape, moves without a press, vanished object');
      const t = erzeugePlatzieren();
      const { z, ctx, rueckgaengig } = neuerKontext(start, 'platzieren', 1);
      t.beiZeigerRunter(ctx, klick(5100, 5000));
      t.beiZeigerBewegt!(ctx, klick(5102, 5001)); // 2.2 px < 4 px
      t.beiZeigerHoch!(ctx, klick(5102, 5001));
      gleich('a click that moves 2.2 px: selected, NOT moved, no step', [t.auswahlId(), z.schritte.length, platz(z.layout).find((p) => p.id === 'probe-c')?.x], ['probe-c', 0, 5100]);
      t.beiZeigerBewegt!(ctx, klick(9000, 9000));
      t.beiZeigerHoch!(ctx, klick(9000, 9000));
      gleich('moves and a release without a press: nothing', z.schritte.length, 0);
      // Escape during a drag cancels it and keeps the selection
      t.beiZeigerRunter(ctx, klick(5100, 5000));
      t.beiZeigerBewegt!(ctx, klick(5200, 5100));
      check('Escape during a drag: not claimed as "ends the tool"', t.beiTaste!(ctx, { code: 'Escape' }) === false);
      t.beiZeigerHoch!(ctx, klick(5200, 5100));
      gleich('…the release afterwards moves nothing; the selection stays', [z.schritte.length, t.auswahlId()], [0, 'probe-c']);
      t.beiTaste!(ctx, { code: 'Escape' });
      gleich('a second Escape deselects (and redraws)', t.auswahlId(), null);
      // the object vanishes (undo of the set) while the pointer is down
      const { z: z2, ctx: c2, rueckgaengig: rg2 } = neuerKontext(start, 'platzieren', 1);
      t.beiZeigerRunter(c2, klick(17000, 17000));
      const neuId = t.auswahlId()!;
      t.beiZeigerRunter(c2, klick(17000, 17000)); // now on the object: press
      t.beiZeigerBewegt!(c2, klick(17100, 17000));
      rg2(); // Ctrl+Z with the button held
      t.beiZeigerHoch!(c2, klick(17100, 17000));
      gleich('release after the object was undone away: no change, no throw', [z2.schritte.length, platz(z2.layout).some((p) => p.id === neuId)], [0, false]);
      rueckgaengig();
      // drag of an object whose neighbour is 0.3 m away: the nearer one is dragged
      const { z: z3, ctx: c3 } = neuerKontext(start, 'platzieren', 0.05);
      const t3 = erzeugePlatzieren();
      t3.beiZeigerRunter(c3, klick(5000.25, 5000));
      t3.beiZeigerBewegt!(c3, klick(5010.25, 5000));
      t3.beiZeigerHoch!(c3, klick(5010.25, 5000));
      gleich('overlapping objects: the nearer (probe-b) is dragged, probe-a stays', [platz(z3.layout).find((p) => p.id === 'probe-b')?.x, platz(z3.layout).find((p) => p.id === 'probe-a')?.x], [5010, 5000]);
    }

    // ── Change ─────────────────────────────────────────────────────
    console.log('Change: turn, scale, x/z, prefab');
    {
      const t = erzeugePlatzieren();
      const { z, ctx, rueckgaengig } = neuerKontext(start);
      t.waehle('probe-a');
      const { host } = neuerHost();
      const block = t.seitenleiste!(ctx, host) as unknown as FakeKnoten;
      const T = { yaw: 'Drehung des ausgewählten Objekts in Grad', scale: 'Skalierung des ausgewählten Objekts (0,2 bis 5)', x: 'x des ausgewählten Objekts in Metern', z: 'z des ausgewählten Objekts in Metern', prefab: 'Prefab des ausgewählten Objekts (ein Wechsel ersetzt das Objekt im Spiel)' };
      const a = (): PlacementDef => platz(z.layout).find((p) => p.id === 'probe-a')!;
      tippe(block, T.yaw, '90');
      check('turn 90° → π/2, one step, an "aendere" of probe-a', Math.abs((a().yaw ?? NaN) - Math.PI / 2) < 1e-12 && z.schritte.length === 1 && z.vorgaenge[0]?.ops[0]?.art === 'aendere' && z.vorgaenge[0]?.ops[0]?.id === 'probe-a');
      tippe(block, T.yaw, '450');
      check('turn 450° = 90° again → no effect on the world → NO new step', z.schritte.length === 1);
      tippe(block, T.yaw, '-45,5');
      check('turn −45,5 (comma) → −0.7941…', Math.abs((a().yaw ?? NaN) - zuGrad(-45.5)) < 1e-12, String(a().yaw));
      tippe(block, T.scale, '10');
      gleich('scale 10 → clamped to 5, said so', [a().scale, /begrenzt/.test(z.meldungen.at(-1)!.text)], [5, true]);
      tippe(block, T.scale, '0.1');
      gleich('scale 0.1 → clamped to 0.2', a().scale, 0.2);
      tippe(block, T.scale, '1');
      gleich('scale 1 on an entry that had scale 0.2: set to 1', a().scale, 1);
      const vorher = z.schritte.length;
      tippe(block, T.scale, 'abc');
      tippe(block, T.x, '');
      gleich('garbage / empty: refused with a message, no step', [z.schritte.length, z.meldungen.at(-1)?.fehler], [vorher, true]);
      tippe(block, T.x, '12,5');
      tippe(block, T.z, '-7');
      gleich('x = 12,5 and z = −7 (each one step)', [a().x, a().z, z.schritte.length - vorher], [12.5, -7, 2]);
      tippe(block, T.x, '99999999');
      check('a coordinate beyond the world (±40000 m) is refused with a plain message, nothing changes', a().x === 12.5 && z.meldungen.at(-1)?.fehler === true && /Außerhalb der Welt/.test(z.meldungen.at(-1)!.text), z.meldungen.at(-1)?.text);
      // prefab swap: declined
      const n0 = z.schritte.length;
      z.antwort = false;
      tippe(block, T.prefab, 'Birch1');
      gleich('prefab swap DECLINED: no change, no step, asked once', [a().prefab, z.schritte.length - n0, z.fragen.length], ['Beech1', 0, 1]);
      check('the question says the object is replaced in the game and its state is lost', /ersetzt das Objekt im Spiel/.test(z.fragen[0]!) && /Zustand geht verloren/.test(z.fragen[0]!) && z.fragen[0]!.includes('probe-a'), z.fragen[0]);
      z.antwort = true;
      tippe(block, T.prefab, 'Birch1');
      gleich('prefab swap CONFIRMED: exactly one aendere, same id', [a().prefab, a().id, z.schritte.length - n0, z.vorgaenge.length - (n0)], ['Birch1', 'probe-a', 1, 1]);
      check('…as an operation "aendere" whose vorher/nachher differ only in the prefab', (() => {
        const o = z.vorgaenge.at(-1)!.ops[0]!;
        return o.art === 'aendere' && (o.vorher as unknown as { prefab: string }).prefab === 'Beech1' && (o.nachher as unknown as { prefab: string }).prefab === 'Birch1' && o.id === 'probe-a';
      })());
      tippe(block, T.prefab, 'Birch1');
      tippe(block, T.prefab, '  ');
      gleich('the same prefab / an empty one: no question, no step', [z.fragen.length, z.schritte.length - n0], [2, 1]);
      tippe(block, T.prefab, 'Y'.repeat(70));
      check('a prefab name over 64 characters: asked, then refused by the operation (nothing changes)', a().prefab === 'Birch1' && z.meldungen.at(-1)?.fehler === true, z.meldungen.at(-1)?.text);
      while (rueckgaengig());
      check('undo all: the document is byte-equal to the start', kanon(z.layout) === kanon(start));
    }

    // ── Delete ─────────────────────────────────────────────────────
    console.log('Delete');
    {
      const t = erzeugePlatzieren();
      const { z, ctx, rueckgaengig } = neuerKontext(start);
      check('Delete without a selection: nothing, no step', t.beiTaste!(ctx, { code: 'Delete' }) === false && z.schritte.length === 0 && z.meldungen.length === 0);
      t.waehle('probe-b');
      check('another key: nothing', t.beiTaste!(ctx, { code: 'KeyA' }) === false && z.schritte.length === 0);
      t.beiTaste!(ctx, { code: 'Delete' });
      gleich('Delete removes the selection: gone, one step, an "entferne" of placements/probe-b', [platz(z.layout).some((p) => p.id === 'probe-b'), platz(z.layout).length, z.schritte.length, z.vorgaenge[0]?.ops.map((o) => `${o.art}/${o.sammlung}/${o.id}`)], [false, platz(start).length - 1, 1, ['entferne/placements/probe-b']]);
      gleich('nothing selected any more; committed; message', [t.auswahlId(), z.uebernommen, z.meldungen.at(-1)?.text], [null, 1, 'probe-b entfernt — Strg+Z holt es zurück']);
      t.beiTaste!(ctx, { code: 'Delete' });
      gleich('a second Delete (key repeat): nothing more', [z.schritte.length, platz(z.layout).length], [1, platz(start).length - 1]);
      rueckgaengig();
      check('undo: the object is back, the document byte-equal', kanon(z.layout) === kanon(start));
      // the delete button of the sidebar does the same
      t.waehle('probe-c');
      const { host, knoepfe } = neuerHost();
      t.seitenleiste!(ctx, host);
      knoepfe.find((k) => k.text === 'Objekt löschen (Entf)')!.cb();
      check('the delete button: same effect', !platz(z.layout).some((p) => p.id === 'probe-c') && z.schritte.length === 1);
    }

    // ── 50 actions, 50 undos, 50 redos ─────────────────────────────
    console.log('50 actions → 50 × undo → byte-equal to the start → 50 × redo → byte-equal to the end');
    {
      const t = erzeugePlatzieren({ zufall: lcg(20260919) });
      const { z, ctx, rueckgaengig, wiederherstellen } = neuerKontext(start, 'platzieren', 1);
      const T = { yaw: 'Drehung des ausgewählten Objekts in Grad', scale: 'Skalierung des ausgewählten Objekts (0,2 bis 5)', x: 'x des ausgewählten Objekts in Metern', z: 'z des ausgewählten Objekts in Metern', prefab: 'Prefab des ausgewählten Objekts (ein Wechsel ersetzt das Objekt im Spiel)' };
      const feldBlock = (): FakeKnoten => t.seitenleiste!(ctx, neuerHost().host) as unknown as FakeKnoten;
      const staende: string[] = [kanon(z.layout)]; // canonical document after k actions
      const beide: Vorgang[] = [];
      const abweichungen: string[] = [];
      /** One action: it must hand over exactly ONE operation of the expected kind on the expected id (`null` = the object just set). */
      const aktion = (name: string, art: 'setze' | 'aendere' | 'entferne', id: string | null, tu: () => void): void => {
        const n = z.vorgaenge.length;
        tu();
        const v = z.vorgaenge.at(-1);
        const op = v?.ops[0];
        const erwarteteId = id ?? t.auswahlId();
        if (z.vorgaenge.length !== n + 1 || !v || v.ops.length !== 1 || op!.sammlung !== 'placements' || op!.art !== art || op!.id !== erwarteteId) {
          abweichungen.push(`${name}: ${z.vorgaenge.length - n} call(s), got ${op?.art}/${op?.sammlung}/${op?.id}, expected ${art}/placements/${erwarteteId}`);
          return;
        }
        beide.push(v);
        staende.push(kanon(z.layout));
      };
      const prefabs = ['Beech1', 'Birch1', 'Pine1', 'Oak1'];
      const gesetzt: string[] = [];
      // 12 × set (3 of them on top of the object before, with Shift)
      for (let i = 0; i < 12; i++) {
        t.setzePrefab(prefabs[i % 4]!);
        const shift = i % 3 === 0 && i > 0;
        const ort = shift ? platz(z.layout).find((p) => p.id === t.auswahlId()) : undefined;
        aktion(`setze ${i}`, 'setze', null, () => void t.beiZeigerRunter(ctx, klick(ort ? ort.x : 8000 + i * 40, ort ? ort.z : 8000 + i * 25, shift)));
        gesetzt.push(t.auswahlId()!);
      }
      // 10 × drag, each with 30 pointer moves; only objects with an unmistakable spot
      for (const [i, id] of [gesetzt[0]!, gesetzt[1]!, gesetzt[4]!, gesetzt[7]!, gesetzt[10]!, gesetzt[11]!, 'probe-a', 'probe-c', gesetzt[0]!, gesetzt[1]!].entries()) {
        const ziel = platz(z.layout).find((p) => p.id === id)!;
        aktion(`ziehen ${id}`, 'aendere', id, () => {
          t.beiZeigerRunter(ctx, klick(ziel.x, ziel.z));
          for (let k = 1; k <= 30; k++) t.beiZeigerBewegt!(ctx, klick(ziel.x + k * 3, ziel.z - k * 2));
          t.beiZeigerHoch!(ctx, klick(ziel.x + 90 + (i % 3) * 5, ziel.z - 60));
        });
      }
      const nr = (k: number): string => platz(z.layout)[k]!.id!;
      // 8 × turn, 8 × scale, 5 × prefab swap, 3 × x/z: by field, on objects picked from the whole document
      for (let i = 0; i < 8; i++) {
        const id = platz(z.layout).at(-(i + 1))!.id!;
        aktion(`drehen ${id}`, 'aendere', id, () => {
          t.waehle(id);
          tippe(feldBlock(), T.yaw, String(15 + i * 21));
        });
      }
      for (let i = 0; i < 8; i++) {
        const id = nr(i * 5);
        aktion(`skalieren ${id}`, 'aendere', id, () => {
          t.waehle(id);
          tippe(feldBlock(), T.scale, String(1.25 + i * 0.5));
        });
      }
      for (let i = 0; i < 5; i++) {
        const id = nr(10 + i * 7);
        aktion(`prefab ${id}`, 'aendere', id, () => {
          t.waehle(id);
          tippe(feldBlock(), T.prefab, `Tausch${i}`);
        });
      }
      for (let i = 0; i < 3; i++) {
        const id = nr(3 + i * 11);
        aktion(`xz ${id}`, 'aendere', id, () => {
          t.waehle(id);
          tippe(feldBlock(), i % 2 === 0 ? T.x : T.z, String(1000 + i * 111.25));
        });
      }
      // 4 × delete
      for (let i = 0; i < 4; i++) {
        const id = nr(20 + i * 9);
        aktion(`entfernen ${id}`, 'entferne', id, () => {
          t.waehle(id);
          t.beiTaste!(ctx, { code: 'Delete' });
        });
      }
      gleich('every action handed over exactly one operation of the expected kind, collection and id', abweichungen, []);
      gleich('50 actions, 50 undo steps, 50 operations', [beide.length, z.schritte.length, z.vorgaenge.length], [50, 50, 50]);
      const zaehle = (art: string): number => beide.filter((v) => v.ops[0]!.art === art).length;
      gleich('mix: 12 setze, 34 aendere (10 drag, 8 turn, 8 scale, 5 prefab, 3 x/z), 4 entferne', [zaehle('setze'), zaehle('aendere'), zaehle('entferne')], [12, 34, 4]);
      gleich('the drags: 10 aendere that only differ in x/z', beide.slice(12, 22).map((v) => { const o = v.ops[0]!; const a = o.vorher as Record<string, unknown>; const b = o.nachher as Record<string, unknown>; return Object.keys(b).every((k) => k === 'x' || k === 'z' || JSON.stringify(a[k]) === JSON.stringify(b[k])); }), Array(10).fill(true));
      const ende = kanon(z.layout);
      check('the end document differs from the start', ende !== staende[0]);
      // (a) 50 × undo, every step byte-equal to the state before that action
      let alleGleich = true;
      for (let k = 49; k >= 0; k--) {
        if (!rueckgaengig() || kanon(z.layout) !== staende[k]) alleGleich = false;
      }
      check('50 × undo: after EACH undo the document equals the state before that action (canonical bytes)', alleGleich);
      check('…and after 50 undos it is BYTE-EQUAL to the start', kanon(z.layout) === staende[0] && JSON.stringify(z.layout) === JSON.stringify(start), `${JSON.stringify(z.layout).length} bytes`);
      check('…there is no 51st undo', rueckgaengig() === false);
      let redoGleich = true;
      for (let k = 1; k <= 50; k++) {
        if (!wiederherstellen() || kanon(z.layout) !== staende[k]) redoGleich = false;
      }
      check('50 × redo: after each redo the state after that action; the end is BYTE-EQUAL to the end state', redoGleich && kanon(z.layout) === ende);
      // (b) the same through the operations themselves (what the server would do)
      let l = z.layout;
      let opsGleich = true;
      for (let k = beide.length - 1; k >= 0; k--) {
        const r = wende(l, invertiere(beide[k]!));
        if (!r.ok) {
          opsGleich = false;
          break;
        }
        l = r.layout;
        if (kanon(l) !== staende[k]) opsGleich = false;
      }
      check('the 50 operations inverted one by one (ops.ts `invertiere` + `wende`): every step equals the snapshot, the last is byte-equal to the start', opsGleich && kanon(l) === staende[0]);
      let vor = start;
      let vorwaerts = true;
      for (const v of beide) {
        const r = wende(vor, v);
        if (!r.ok) {
          vorwaerts = false;
          break;
        }
        vor = r.layout;
      }
      check('the 50 operations applied to the start (`wende`) give the end document byte for byte — editor and server agree', vorwaerts && kanon(vor) === ende);
      check('the ids of all objects at the end are unique and valid', (() => {
        const ids = platz(z.layout).map((p) => p.id!);
        return new Set(ids).size === ids.length && ids.every((i) => ID_RE.test(i));
      })());
    }

    // ── Jump from a finding ────────────────────────────────────────
    console.log('Finding → object');
    {
      const doc = sanitizeWorldLayout({
        ...start,
        routes: [],
        placements: [
          { id: 'unbek-1', prefab: 'NoSuchPrefab', x: 10, z: 20 },
          { id: 'unbek-neg', prefab: 'NoSuchPrefab', x: -30.5, z: -40 },
          { id: 'ohne-route', prefab: 'Beech1', x: 300, z: 400, route: 'nirgends' },
          { id: 'zwilling-a', prefab: 'Beech1', x: 900, z: 900 },
          { id: 'zwilling-b', prefab: 'Beech1', x: 900, z: 900 },
        ],
      })!;
      const befunde = pruefeLayout(doc).filter((b) => b.wo === 'placements');
      const ziele = befunde.map((b) => ({ text: b.text, ziel: platzierungZuBefund(doc, b) }));
      console.log(ziele.map((z) => `    ${z.ziel ?? '—'}  ⇐  ${z.text}`).join('\n'));
      gleich('unknown prefab at (10, 20) → unbek-1', ziele.find((z) => /NoSuchPrefab @\(10, 20\)/.test(z.text))?.ziel, 'unbek-1');
      gleich('unknown prefab at (−30.5, −40) → unbek-neg', ziele.find((z) => /@\(-30.5, -40\)/.test(z.text))?.ziel, 'unbek-neg');
      gleich('unknown route → the object that names it', ziele.find((z) => /unbekannte Route/.test(z.text))?.ziel, 'ohne-route');
      gleich('identical content → the first of the pair', ziele.find((z) => /identischem Inhalt/.test(z.text))?.ziel, 'zwilling-a');
      gleich('a finding that counts objects ("kein eigenes Modell: X (n Platzierungen)") names none → null', platzierungZuBefund(doc, { wo: 'placements', text: 'kein eigenes Modell: Beech1 (3 Platzierungen)' }), null);
      check('…and the ones the real check produced for this document all resolve or are counts', ziele.every((z) => z.ziel !== null || /kein eigenes Modell|Duplikat/.test(z.text)));
      check('every returned id exists in the document', ziele.every((z) => z.ziel === null || platz(doc).some((p) => p.id === z.ziel)));
      gleich('a finding of a region or the world is not a placement', [platzierungZuBefund(doc, { wo: 'insel-1', text: 'unbekannte Vegetation: Beech1 @(10, 20)' }), platzierungZuBefund(doc, { wo: 'welt', text: 'Kein Startpunkt' })], [null, null]);
      gleich('an id that is only PART of a word does not match (unbek-1 vs unbek-10)', platzierungZuBefund(doc, { wo: 'placements', text: 'Platzierungs-ID mehrfach vergeben: unbek-10' }), null);
      gleich('the whole-word id matches', platzierungZuBefund(doc, { wo: 'placements', text: 'Platzierungs-ID mehrfach vergeben: unbek-1' }), 'unbek-1');
      gleich('prefab and position must BOTH match: right position, wrong prefab → null', platzierungZuBefund(doc, { wo: 'placements', text: 'unbekanntes Prefab: Anders @(10, 20)' }), null);
      // the tool takes the jump: selection by id
      const t = erzeugePlatzieren();
      t.waehle('unbek-1');
      const { ctx } = neuerKontext(doc);
      const host = neuerHost().host;
      const block = t.seitenleiste!(ctx, host) as unknown as FakeKnoten;
      gleich('after the jump the sidebar shows that object (x = 10)', finde(block, (k) => k.tag === 'input' && k.title === 'x des ausgewählten Objekts in Metern')[0]?.value, '10');
    }

    // ── layoutMitPlatzierung ───────────────────────────────────────
    console.log('layoutMitPlatzierung gives an id too');
    {
      const { layoutMitPlatzierung } = await import('../src/editor/weltdokument');
      let l = sanitizeWorldLayout({ ...start, placements: [] })!;
      for (let i = 0; i < 100; i++) l = layoutMitPlatzierung(l, 'Beech1', 5.2, 5.4, 1);
      const ids = platz(l).map((p) => p.id);
      gleich('100 calls at one place: 100 ids, all present and valid', [ids.length, new Set(ids).size, ids.every((i) => typeof i === 'string' && ID_RE.test(i))], [100, 100, true]);
      gleich('the entry: id first, prefab, rounded position, yaw', platz(l)[0], { id: 'beech1_5_5', prefab: 'Beech1', x: 5, z: 5, yaw: 1 });
      gleich('the sanitizer keeps all 100 (no fold, no re-id)', [platz(sanitizeWorldLayout(l)!).length, JSON.stringify(platz(sanitizeWorldLayout(l)!).map((p) => p.id!).sort())], [100, JSON.stringify([...ids].sort())]);
    }

    // ── Source guard ───────────────────────────────────────────────
    console.log('Source guard');
    const haupt = readFileSync(resolve(EDITOR, 'editorMain.ts'), 'utf-8');
    const hud = readFileSync(resolve(EDITOR, 'KartenHud.ts'), 'utf-8');
    const index = readFileSync(resolve(EDITOR, 'werkzeuge', 'index.ts'), 'utf-8');
    gleich("editorMain.ts: no `werkzeug === 'platzieren'` branch", haupt.match(/werkzeug\s*[!=]==\s*'platzieren'/g) ?? [], []);
    gleich('editorMain.ts: no `spawnPrefab`, no `layoutMitPlatzierung`', haupt.match(/\b(spawnPrefab|layoutMitPlatzierung)\b/g) ?? [], []);
    check("editorMain.ts: the pointer hooks are CALLED (move, up), the pointer is captured, Delete is passed on", /\?\.beiZeigerBewegt\?\.\(werkzeugKontext/.test(haupt) && /\?\.beiZeigerHoch\?\.\(werkzeugKontext/.test(haupt) && /setPointerCapture\(e\.pointerId\)/.test(haupt) && /e\.code !== 'Delete'/.test(haupt) && /\?\.beiTaste\?\.\(werkzeugKontext, e\)/.test(haupt));
    check('editorMain.ts: Delete is ignored while an input has the focus and while the catalog is open', /INPUT\|TEXTAREA\|SELECT/.test(haupt) && /katalogIstOffen\(\)/.test(haupt));
    check('editorMain.ts: the catalog sets the prefab through the tool; the finding jump selects through it', /platzierenWerkzeug\.setzePrefab\(prefab\)/.test(haupt) && /platzierenWerkzeug\.waehle\(id\)/.test(haupt) && /platzierungZuBefund\(layout, b\)/.test(haupt));
    check('editorMain.ts: the context answers `bestaetige` with the browser confirm', /bestaetige: \(frage\) => window\.confirm\(frage\)/.test(haupt));
    check('editorMain.ts: the wide tile comes from the tool (`kachelBreit`)', /w\.kachelBreit/.test(haupt));
    gleich("KartenHud.ts: no 'platzieren' key in the old tables", hud.match(/^\s*platzieren:/gm) ?? [], []);
    check("index.ts: 'platzieren' left ALTE_WERKZEUGE and is registered", !/ALTE_WERKZEUGE = \[[^\]]*'platzieren'/.test(index) && /erzeugePlatzieren\(\)/.test(index));
    check('platzieren.ts: every change goes through ops.ts (opSetzen, opAendern, opEntfernen, wende) and the id from neuePlatzierungsId', (() => {
      const q = readFileSync(resolve(EDITOR, 'werkzeuge', 'platzieren.ts'), 'utf-8');
      return /opSetzen\(/.test(q) && /opAendern\(/.test(q) && /opEntfernen\(/.test(q) && /\bwende\(/.test(q) && /neuePlatzierungsId\(/.test(q) && !/Math\.random\(\)/.test(q.replace(/opt\.zufall \?\? Math\.random/, ''));
    })());
  } else {
    check('Placing tool -- sections could not run (module missing)', false);
    check("Source guard: editorMain.ts has no `werkzeug === 'platzieren'` branch", !/werkzeug\s*[!=]==\s*'platzieren'/.test(readFileSync(resolve(EDITOR, 'editorMain.ts'), 'utf-8')));
  }

  console.log(fehler === 0 ? '\nOK' : `\n${fehler} FAILED`);
  process.exit(fehler === 0 ? 0 : 1);
}

void main();
