/**
 * Placing tool (Editor E1, K1.3) against a fake `WerkzeugKontext`, without an
 * editor window: set, select, drag, change, delete, jump from a finding.
 *
 * What is measured is the effect on the DOCUMENT and the operation the tool
 * hands to the editor (`aendere(neu, vorgang)`: kind, collection, id), not
 * what the old `if (werkzeug === 'platzieren')` branch looked like. The fake
 * context keeps an undo stack of snapshots exactly like the editor does.
 *
 * Every check is its own report line, also on a tree WITHOUT the module (`e6a7351`): a missing module is
 * replaced by a stand-in that does nothing, so each check that needs the tool reports ✗ by itself, and a
 * section that cannot go on reports one ✗ for the whole section instead of crashing the file.
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
const klick = (x: number, z: number, shiftKey = false, zeigerId?: number) => ({ weltX: x, weltZ: z, shiftKey, zeigerId });
const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/** Start document for the scripts: the real dev world (157 objects) plus three we know by id. */
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

/** One section of the test: a failure inside (an exception) is ONE ✗ for the section, the file goes on. */
async function sektion(name: string, tu: () => void | Promise<void>): Promise<void> {
  console.log(name);
  try {
    await tu();
  } catch (e) {
    check(`${name}: section could not go on (${(e as Error).message.split('\n')[0]})`, false);
  }
}

/** Stand-in for a tool that does not exist (a tree without the module): every member does nothing and returns `undefined`. */
const nullWerkzeug = (): never =>
  new Proxy(
    {},
    {
      get: (_o, name) => (name === 'then' ? undefined : name === 'seitenleiste' ? () => fakeKnoten('block') : () => undefined),
    }
  ) as never;

async function main(): Promise<void> {
  console.log('Placing tool: module');
  let modul: typeof import('../src/editor/werkzeuge/platzieren') | null = null;
  let reg: typeof import('../src/editor/werkzeuge') | null = null;
  try {
    modul = await import('../src/editor/werkzeuge/platzieren');
  } catch (e) {
    console.log(`  (module missing: ${(e as Error).message.split('\n')[0]})`);
  }
  // The shared id function (a tree without it -- e6a7351 -- gives a stand-in, and every check of it reports ✗ by itself).
  type IdModul = { frischePlatzierungsId?: (b: unknown, p: { prefab: string; x: number; z: number }, z?: () => number) => string };
  let idModul = null as IdModul | null;
  try {
    idModul = (await import('@wov/shared/src/worldlayout/platzierungsId.js')) as unknown as IdModul;
  } catch (e) {
    console.log(`  (id module missing: ${(e as Error).message.split('\n')[0]})`);
  }
  const frischeId = (idModul?.frischePlatzierungsId ?? (() => '')) as (b: ReadonlySet<string>, p: { prefab: string; x: number; z: number }, z: () => number) => string;
  try {
    reg = await import('../src/editor/werkzeuge');
  } catch (e) {
    console.log(`  (registry missing: ${(e as Error).message.split('\n')[0]})`);
  }
  check('werkzeuge/platzieren.ts loads and the registry offers the tool', modul !== null && reg?.werkzeugMitId('platzieren')?.id === 'platzieren');

  {
    // On a tree without the module the stand-ins below let every section run and fail check by check.
    const { erzeugePlatzieren, trefferSuchen, platzierungZuBefund, TREFFER_PX, ZUG_PX } =
      modul ??
      ({
        erzeugePlatzieren: nullWerkzeug,
        trefferSuchen: () => undefined,
        platzierungZuBefund: () => null,
        TREFFER_PX: NaN,
        ZUG_PX: NaN,
      } as unknown as typeof import('../src/editor/werkzeuge/platzieren'));
    const platzierenWerkzeug = reg?.platzierenWerkzeug ?? (nullWerkzeug() as unknown as NonNullable<typeof reg>['platzierenWerkzeug']);
    /** A tool in the mode ANWAEHLEN (click selects, drag moves). */
    const erzeugeAnwaehlen = (opt?: Parameters<typeof erzeugePlatzieren>[0]) => {
      const t = erzeugePlatzieren(opt);
      t.setzeModus?.('anwaehlen');
      return t;
    };
    const zuGrad = (g: number): number => (g * Math.PI) / 180;

    // ── The tool through the registry wrapper ──────────────────────
    await sektion('The tool through the registry wrapper', async () => {
      const w = platzierenWerkzeug;
      check('the registry entry is guarded and keeps the tool\'s own members', typeof w.setzePrefab === 'function' && typeof w.auswahlId === 'function' && typeof w.waehle === 'function');
      gleich('tile: name, wide, badge = default prefab', [w.kachelName, w.kachelBreit, w.kachelZusatz(), w.hudZusatz(), w.titel], ['Objekt platzieren', true, 'Beech1', 'Beech1', 'Objekt platzieren']);
      gleich('key help', w.tasten, [['P', 'Setzen'], ['V', 'Anwählen'], ['Klick', 'setzen / wählen'], ['Ziehen', 'verschieben (V)'], ['Entf', 'löschen']]);
      check('hooks present: pointer move, pointer up, key, overlay, sidebar', [w.beiZeigerBewegt, w.beiZeigerHoch, w.beiTaste, w.zeichneOverlay, w.seitenleiste].every((h) => typeof h === 'function'));
      const { z, ctx } = neuerKontext(start);
      const vorher = platz(z.layout).length;
      check('a click through the guarded tool is handled', w.beiZeigerRunter(ctx, klick(15000, 15000)) === true);
      gleich('…and set one object with one undo step', [platz(z.layout).length - vorher, z.schritte.length], [1, 1]);
      w.abbrechen(ctx);
    });

    // ── Set ────────────────────────────────────────────────────────
    await sektion('Set: id, turn, prefab', async () => {
      const gemerkt: string[] = [];
      const t = erzeugePlatzieren({ zufall: () => 0.25, merkePrefab: (n) => gemerkt.push(n) });
      const { z, ctx } = neuerKontext(start);
      const idsVorher = new Set(platz(z.layout).map((p) => p.id));
      check('click on free ground is handled', t.beiZeigerRunter(ctx, klick(10.4, 9979.4)) === true);
      const neu = platz(z.layout).find((p) => !idsVorher.has(p.id))!;
      check('one new object with a valid id: the derived id plus a random tail that starts with a letter', neu !== undefined && typeof neu.id === 'string' && ID_RE.test(neu.id) && /^beech1_10_9979-[a-z][0-9a-z]{3}$/.test(neu.id), neu?.id);
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
    });

    await sektion('Set: 100 objects at one place, same prefab (the K1.1 case)', async () => {
      const t = erzeugePlatzieren({ zufall: () => 0.5 });
      const { z, ctx } = neuerKontext(start);
      const vorher = new Map(platz(z.layout).map((p) => [p.id!, JSON.stringify(p)]));
      // an existing object at the very spot with the derived id
      const { z: z0, ctx: c0 } = neuerKontext(sanitizeWorldLayout({ ...start, placements: [{ prefab: 'Beech1', x: 5, z: 5 }] })!);
      const idAlt = platz(z0.layout)[0]!.id!;
      for (let i = 0; i < 100; i++) t.beiZeigerRunter(c0, klick(5, 5));
      const ids = platz(z0.layout).map((p) => p.id!);
      gleich('101 objects, 101 different valid ids', [ids.length, new Set(ids).size, ids.every((i) => ID_RE.test(i))], [101, 101, true]);
      gleich('the old object keeps id AND content', platz(z0.layout).find((p) => p.id === idAlt), { id: idAlt, prefab: 'Beech1', x: 5, z: 5 });
      gleich('100 undo steps, 100 "setze" operations of placements', [z0.schritte.length, z0.vorgaenge.every((v) => v?.ops.length === 1 && v.ops[0]!.art === 'setze' && v.ops[0]!.sammlung === 'placements')], [100, true]);
      // and next to the real document: nothing existing changes
      for (let i = 0; i < 100; i++) t.beiZeigerRunter(ctx, klick(20000 + (i % 7), 20000));
      const nachher = new Map(platz(z.layout).map((p) => [p.id!, JSON.stringify(p)]));
      let veraendert = 0;
      for (const [id, text] of vorher) if (nachher.get(id) !== text) veraendert++;
      gleich('in the real world: 157+3 existing ids unchanged, +100 new', [veraendert, nachher.size - vorher.size], [0, 100]);
      // mode SETZEN: a click ON an existing object sets one more (the old rule "click on an object selects" is gone)
      const t2 = erzeugePlatzieren({ zufall: () => 0.5 });
      t2.beiZeigerRunter(c0, klick(5, 5, false));
      check('mode SETZEN: a click on an existing object (Shift or not) sets ANOTHER one, and selects the new one', platz(z0.layout).length === 102 && t2.auswahlId() !== idAlt && t2.auswahlId() !== null);
    });

    await sektion('Set: outside the world', async () => {
      const t = erzeugePlatzieren();
      const { z, ctx } = neuerKontext(start);
      check('the click is consumed', t.beiZeigerRunter(ctx, klick(40001, 0)) === true);
      gleich('a click beyond ±40000 m: nothing set, no step, plain message', [platz(z.layout).length, z.schritte.length, z.meldungen.at(-1)?.fehler, /Außerhalb der Welt/.test(z.meldungen.at(-1)?.text ?? '')], [platz(start).length, 0, true, true]);
      t.beiZeigerRunter(ctx, klick(40000, -40000));
      gleich('exactly on the border is fine', [platz(z.layout).length - platz(start).length, z.schritte.length], [1, 1]);
    });

    await sektion('Set: refused by the operation (limit of 2,000)', async () => {
      const voll: WorldLayout = sanitizeWorldLayout({ ...start, placements: Array.from({ length: 2000 }, (_, i) => ({ id: `voll-${i}`, prefab: 'Beech1', x: i * 10 - 10000, z: 0 })) })!;
      check('fixture: 2,000 objects', platz(voll).length === 2000);
      const t = erzeugePlatzieren();
      const { z, ctx } = neuerKontext(voll);
      check('the click is consumed', t.beiZeigerRunter(ctx, klick(0, 9000)) === true);
      gleich('nothing changed, no undo step, no commit', [platz(z.layout).length, z.schritte.length, z.uebernommen, t.auswahlId()], [2000, 0, 0, null]);
      check('the message says why', z.meldungen.length === 1 && z.meldungen[0]!.fehler && /2000/.test(z.meldungen[0]!.text), z.meldungen[0]?.text);
    });

    // ── Select ─────────────────────────────────────────────────────
    await sektion('Select: tolerance in screen pixels, converted with the map scale', async () => {
      gleich('the tolerance is named: 8 px; a drag starts after 4 px', [TREFFER_PX, ZUG_PX], [8, 4]);
      const t = erzeugeAnwaehlen();
      const { z, ctx } = neuerKontext(start, 'platzieren', 0.1); // 0.1 m/px → 8 px = 0.8 m
      t.beiZeigerRunter(ctx, klick(5000.1 + 0.4, 5000.0 + 0));
      // probe-a at (5000,5000), probe-b at (5000.3,5000): the click at 5000.5 is 0.5 from a and 0.2 from b → b wins
      gleich('at 0.1 m/px a click 0.5 m from a and 0.2 m from b: the NEARER one (probe-b) wins', [t.auswahlId(), platz(z.layout).length], ['probe-b', platz(start).length]);
      const { z: z2, ctx: c2 } = neuerKontext(start, 'platzieren', 0.1);
      const t2 = erzeugeAnwaehlen();
      t2.beiZeigerRunter(c2, klick(5100.4, 5000));
      gleich('0.4 m beside probe-c: selected, nothing set', [t2.auswahlId(), platz(z2.layout).length], ['probe-c', platz(start).length]);
      const t3 = erzeugeAnwaehlen();
      const { z: z3, ctx: c3 } = neuerKontext(start, 'platzieren', 0.1);
      t3.beiZeigerRunter(c3, klick(5100 + 3, 5000));
      gleich('3 m beside probe-c (mode ANWAEHLEN): a miss does nothing — nothing selected, nothing set, no undo step', [t3.auswahlId(), platz(z3.layout).length, z3.schritte.length], [null, platz(start).length, 0]);
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
    });

    // ── Drag ───────────────────────────────────────────────────────
    await sektion('Drag: 30 pointer moves = 1 undo step', async () => {
      const t = erzeugeAnwaehlen();
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
      // a horizontal drag must not nudge the other axis: an object with a fraction keeps it
      const { z: zf, ctx: cf } = neuerKontext(sanitizeWorldLayout({ ...start, placements: [{ id: 'bruch', prefab: 'Beech1', x: 7000.3, z: 7000.1 }] })!, 'platzieren', 1);
      const tf = erzeugeAnwaehlen();
      tf.beiZeigerRunter(cf, klick(7000.3, 7000.1));
      tf.beiZeigerBewegt!(cf, klick(7040.3, 7000.1));
      tf.beiZeigerHoch!(cf, klick(7040.3, 7000.1));
      gleich('horizontal drag of 40 m: x 7000.3 → 7040.3, z 7000.1 stays', [platz(zf.layout)[0]!.x, platz(zf.layout)[0]!.z], [7040.3, 7000.1]);
      gleich('vorher/nachher of the operation', [z.vorgaenge[0]!.ops[0]!.vorher, z.vorgaenge[0]!.ops[0]!.nachher], [{ id: 'probe-c', prefab: 'Birch1', x: 5100, z: 5000, scale: 2 }, { id: 'probe-c', prefab: 'Birch1', x: 5160, z: 5030, scale: 2 }]);
      gleich('committed once, message names the object and the new place', [z.uebernommen, z.meldungen.at(-1)?.text], [1, 'probe-c verschoben (5160, 5030)']);
      rueckgaengig();
      gleich('ONE undo puts it back exactly', platz(z.layout).find((q) => q.id === 'probe-c'), platz(start).find((q) => q.id === 'probe-c'));
      // a further release does nothing
      t.beiZeigerHoch!(ctx, klick(1, 1));
      gleich('a second release without a press changes nothing', [z.schritte.length, z.vorgaenge.length], [0, 1]);
    });
    await sektion('Drag: shaky click, Escape, moves without a press, vanished object', async () => {
      const t = erzeugeAnwaehlen();
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
      t.setzeModus('setzen');
      t.beiZeigerRunter(c2, klick(17000, 17000));
      const neuId = t.auswahlId()!;
      t.setzeModus('anwaehlen');
      t.beiZeigerRunter(c2, klick(17000, 17000)); // now on the object: press
      t.beiZeigerBewegt!(c2, klick(17100, 17000));
      rg2(); // Ctrl+Z with the button held
      t.beiZeigerHoch!(c2, klick(17100, 17000));
      gleich('release after the object was undone away: no change, no throw', [z2.schritte.length, platz(z2.layout).some((p) => p.id === neuId)], [0, false]);
      rueckgaengig();
      // drag of an object whose neighbour is 0.3 m away: the nearer one is dragged
      const { z: z3, ctx: c3 } = neuerKontext(start, 'platzieren', 0.05);
      const t3 = erzeugeAnwaehlen();
      t3.beiZeigerRunter(c3, klick(5000.25, 5000));
      t3.beiZeigerBewegt!(c3, klick(5010.25, 5000));
      t3.beiZeigerHoch!(c3, klick(5010.25, 5000));
      gleich('overlapping objects: the nearer (probe-b) is dragged, probe-a stays (probe-b keeps its 0.3: 5000.3 + 10)', [platz(z3.layout).find((p) => p.id === 'probe-b')?.x, platz(z3.layout).find((p) => p.id === 'probe-a')?.x], [5010.3, 5000]);
    });

    // ── Change ─────────────────────────────────────────────────────
    await sektion('Change: turn, scale, x/z, prefab', async () => {
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
    });

    await sektion('Picking another tool / a foreign draft (abbrechen) drops selection and drag', async () => {
      const t = erzeugeAnwaehlen();
      const { z, ctx } = neuerKontext(start, 'platzieren', 1);
      t.beiZeigerRunter(ctx, klick(5100, 5000));
      t.beiZeigerBewegt!(ctx, klick(5200, 5000));
      t.abbrechen(ctx);
      t.beiZeigerHoch!(ctx, klick(5200, 5000));
      gleich('abbrechen: nothing selected, the pending drag is gone (no step)', [t.auswahlId(), z.schritte.length], [null, 0]);
      const zz = neuerZeichner();
      t.zeichneOverlay!(ctx, zz as unknown as CanvasRenderingContext2D);
      check('…no ring is drawn, and the sidebar shows no object fields', zz.log.length === 0 && !hatFeld(t.seitenleiste!(ctx, neuerHost().host) as unknown as FakeKnoten, 'x des ausgewählten Objekts in Metern'));
      t.waehle('probe-a');
      z.aktiv = 'fluss';
      const z2 = neuerZeichner();
      t.zeichneOverlay!(ctx, z2 as unknown as CanvasRenderingContext2D);
      check('a selection is not drawn while another tool is active', z2.log.length === 0);
    });

    // ── Delete ─────────────────────────────────────────────────────
    await sektion('Delete', async () => {
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
    });

    // ── 50 actions, 50 undos, 50 redos ─────────────────────────────
    await sektion('50 actions → 50 × undo → byte-equal to the start → 50 × redo → byte-equal to the end', async () => {
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
      // 12 × set (3 of them on top of the object before: mode SETZEN sets there as well)
      for (let i = 0; i < 12; i++) {
        t.setzePrefab(prefabs[i % 4]!);
        const shift = i % 3 === 0 && i > 0;
        const ort = shift ? platz(z.layout).find((p) => p.id === t.auswahlId()) : undefined;
        aktion(`setze ${i}`, 'setze', null, () => void t.beiZeigerRunter(ctx, klick(ort ? ort.x : 8000 + i * 40, ort ? ort.z : 8000 + i * 25)));
        gesetzt.push(t.auswahlId()!);
      }
      // 10 × drag, each with 30 pointer moves, in the mode ANWAEHLEN; only objects with an unmistakable spot
      t.setzeModus('anwaehlen');
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
    });

    // ── Jump from a finding ────────────────────────────────────────
    await sektion('Finding → object (structured `ref` of the check, no text parsing)', async () => {
      const doc = sanitizeWorldLayout({
        ...start,
        routes: [],
        placements: [
          { id: 'unbek-1', prefab: 'NoSuchPrefab', x: 10, z: 20 },
          { id: 'unbek-neg', prefab: 'NoSuchPrefab', x: -30.5, z: -40 },
          // a prefab name with a space next to its LAST word at the same metre: the text alone cannot tell them apart
          { id: 'big-beech1_0_80', prefab: 'Big Beech1', x: 0, z: 80 },
          { id: 'beech1_0_80', prefab: 'Beech1', x: 0, z: 80 },
          { id: 'ohne-route', prefab: 'Beech1', x: 300, z: 400, route: 'nirgends' },
          { id: 'zwilling-a', prefab: 'Beech1', x: 900, z: 900 },
          { id: 'zwilling-b', prefab: 'Beech1', x: 900, z: 900 },
        ],
      })!;
      const befunde = pruefeLayout(doc).filter((b) => b.wo === 'placements');
      const ziele = befunde.map((b) => ({ text: b.text, ref: (b as { ref?: unknown }).ref, ziel: platzierungZuBefund(doc, b) }));
      console.log(ziele.map((z) => `    ${z.ziel ?? '—'}  ⇐  ${z.text}`).join('\n'));
      gleich('the finding of "Big Beech1" jumps to big-beech1_0_80, NOT to beech1_0_80 (the prefab with the last word)', ziele.find((z) => /Big Beech1/.test(z.text))?.ziel, 'big-beech1_0_80');
      gleich('unknown prefab at (10, 20) → unbek-1; at (−30.5, −40) → unbek-neg', [ziele.find((z) => /NoSuchPrefab @\(10, 20\)/.test(z.text))?.ziel, ziele.find((z) => /@\(-30.5, -40\)/.test(z.text))?.ziel], ['unbek-1', 'unbek-neg']);
      gleich('unknown route → the object that names it', ziele.find((z) => /unbekannte Route/.test(z.text))?.ziel, 'ohne-route');
      check('identical content → an object of the pair (zwilling-a or zwilling-b)', ['zwilling-a', 'zwilling-b'].includes(ziele.find((z) => /identischem Inhalt/.test(z.text))?.ziel ?? ''));
      gleich('a finding that counts objects ("kein eigenes Modell: X (n Platzierungen)") carries no `ref` → not clickable', ziele.filter((z) => /kein eigenes Modell/.test(z.text)).map((z) => [z.ref, z.ziel]), ziele.filter((z) => /kein eigenes Modell/.test(z.text)).map(() => [undefined, null]));
      check('every finding of the check that carries a `ref` resolves to an object of the document', ziele.every((z) => (z.ref === undefined ? z.ziel === null : z.ziel !== null && platz(doc).some((p) => p.id === z.ziel))));
      // the check itself gives the ref (a raw document: two entries with one id, an NPC detail on a prefab without a preset)
      const roh = pruefeLayout({ ...doc, placements: [{ id: 'x', prefab: 'Beech1', x: 1, z: 1 }, { id: 'x', prefab: 'Beech1', x: 2, z: 2 }, { id: 'npc-x', prefab: 'Beech1', x: 3, z: 3, npc: { name: 'Olaf' } }] } as unknown as WorldLayout).filter((b) => b.wo === 'placements') as { text: string; ref?: { sammlung: string; id: string } }[];
      gleich('"id given twice" → the ref names that id', roh.find((b) => /mehrfach vergeben/.test(b.text))?.ref, { sammlung: 'placements', id: 'x' });
      gleich('"NPC details on a prefab without a preset" → the ref names the object', roh.find((b) => /NPC-Angaben/.test(b.text))?.ref, { sammlung: 'placements', id: 'npc-x' });
      // only the ref counts: the same text without a ref is not clickable, a ref to an object that is gone gives nothing
      gleich('the text alone never names an object: without `ref` → null, whatever it says', [platzierungZuBefund(doc, { text: 'unbekanntes Prefab: NoSuchPrefab @(10, 20)' } as never), platzierungZuBefund(doc, { wo: 'placements', text: 'Platzierungs-ID mehrfach vergeben: unbek-1' } as never)], [null, null]);
      gleich('a `ref` to an id that is not in the document → null; a `ref` of another collection → null', [platzierungZuBefund(doc, { ref: { sammlung: 'placements', id: 'gibt-es-nicht' } }), platzierungZuBefund(doc, { ref: { sammlung: 'regions', id: 'unbek-1' } })], [null, null]);
      gleich('a `ref` resolves to exactly that id', platzierungZuBefund(doc, { ref: { sammlung: 'placements', id: 'beech1_0_80' } }), 'beech1_0_80');
      // the tool takes the jump: selection by id
      const t = erzeugePlatzieren();
      t.waehle('unbek-1');
      const { ctx } = neuerKontext(doc);
      const host = neuerHost().host;
      const block = t.seitenleiste!(ctx, host) as unknown as FakeKnoten;
      gleich('after the jump the sidebar shows that object (x = 10)', finde(block, (k) => k.tag === 'input' && k.title === 'x des ausgewählten Objekts in Metern')[0]?.value, '10');
    });

    // ── layoutMitPlatzierung ───────────────────────────────────────
    await sektion('layoutMitPlatzierung gives an id too', async () => {
      const { layoutMitPlatzierung } = await import('../src/editor/weltdokument');
      let l = sanitizeWorldLayout({ ...start, placements: [] })!;
      for (let i = 0; i < 100; i++) l = layoutMitPlatzierung(l, 'Beech1', 5.2, 5.4, 1);
      const ids = platz(l).map((p) => p.id);
      gleich('100 calls at one place: 100 ids, all present and valid', [ids.length, new Set(ids).size, ids.every((i) => typeof i === 'string' && ID_RE.test(i))], [100, 100, true]);
      check('the entry: id first, then prefab, rounded position, yaw; the id is the derived one plus a tail with a letter', (() => {
        const e = platz(l)[0]!;
        return Object.keys(e).join(',') === 'id,prefab,x,z,yaw' && /^beech1_5_5-[a-z][0-9a-z]{3}$/.test(e.id!) && e.x === 5 && e.z === 5 && e.yaw === 1;
      })(), JSON.stringify(platz(l)[0]));
      gleich('the sanitizer keeps all 100 (no fold, no re-id)', [platz(sanitizeWorldLayout(l)!).length, JSON.stringify(platz(sanitizeWorldLayout(l)!).map((p) => p.id!).sort())], [100, JSON.stringify([...ids].sort())]);
    });

    // ── Modes ──────────────────────────────────────────────────────
    await sektion('Modes: SETZEN (default, every click sets) and ANWAEHLEN (click selects, drag moves)', async () => {
      const t = erzeugePlatzieren({ zufall: lcg(7) });
      check('the default mode is SETZEN', t.modus?.() === 'setzen');
      // A-1: at every zoom step from 4 to 200 m per pixel a click 1 m beside an existing object sets a NEW one
      const zoom = [4, 6, 10, 20, 40, 80, 120, 160, 200];
      const gesetzt: string[] = [];
      for (const m of zoom) {
        const { z, ctx } = neuerKontext(start, 'platzieren', m);
        const vor = platz(z.layout).length;
        t.beiZeigerRunter(ctx, klick(5101, 5000)); // probe-a stands at (5000, 5000), probe-c at (5100, 5000): 1 m beside probe-c
        const neu = platz(z.layout).filter((p) => !platz(start).some((q) => q.id === p.id));
        gesetzt.push(`${m}:${platz(z.layout).length - vor}/${neu[0]?.x}`);
      }
      gleich('SETZEN, 1 m beside an existing object at 9 zoom steps (4 … 200 m/px): every click sets exactly one new object at (5101)', gesetzt, zoom.map((m) => `${m}:1/5101`));
      const { z: zs, ctx: cs } = neuerKontext(start, 'platzieren', 0.1);
      t.beiZeigerRunter(cs, klick(5100, 5000, true));
      t.beiZeigerRunter(cs, klick(5100, 5000, false));
      gleich('SETZEN, exactly ON an existing object, with and without Shift: one new object each (Shift has no meaning here)', platz(zs.layout).length - platz(start).length, 2);
      // ANWAEHLEN: the click selects the nearest within 8 px and on nothing does nothing
      const auswahl: string[] = [];
      for (const m of zoom) {
        const a = erzeugeAnwaehlen({ zufall: lcg(3) });
        const { z, ctx } = neuerKontext(start, 'platzieren', m);
        a.beiZeigerRunter(ctx, klick(5100 + 5 * m, 5000)); // 5 px beside probe-c
        const treffer = a.auswahlId();
        a.abbrechen(ctx);
        a.setzeModus('anwaehlen');
        a.beiZeigerRunter(ctx, klick(5100 + 12 * m, 5000)); // 12 px beside probe-c: outside the 8 px
        auswahl.push(`${m}:${treffer}/${a.auswahlId()}/${platz(z.layout).length - platz(start).length}`);
      }
      gleich('ANWAEHLEN at the same 9 zoom steps: 5 px beside probe-c selects it, 12 px beside it selects nothing and sets nothing', auswahl, zoom.map((m) => `${m}:probe-c/null/0`));
      // drag only in ANWAEHLEN
      const s1 = erzeugePlatzieren({ zufall: lcg(5) });
      const k1 = neuerKontext(start, 'platzieren', 1);
      s1.beiZeigerRunter(k1.ctx, klick(9000, 9000, false, 1));
      const nachSetzen = k1.z.schritte.length;
      s1.beiZeigerBewegt!(k1.ctx, klick(9100, 9000, false, 1));
      s1.beiZeigerHoch!(k1.ctx, klick(9100, 9000, false, 1));
      gleich('SETZEN: press = one object; moving on and releasing moves nothing (no drag in this mode)', [nachSetzen, k1.z.schritte.length, platz(k1.z.layout).filter((p) => p.x === 9100).length], [1, 1, 0]);
      // keys and buttons
      const k2 = neuerKontext(start, 'platzieren', 1);
      const u = erzeugePlatzieren();
      u.beiTaste!(k2.ctx, { code: 'KeyV' });
      check('key V switches to ANWAEHLEN (redraws, rebuilds the sidebar, says so), P back to SETZEN', u.modus() === 'anwaehlen' && k2.z.seite === 1 && k2.z.zeichnen === 1 && /Anwählen/.test(k2.z.meldungen.at(-1)?.text ?? ''));
      u.beiTaste!(k2.ctx, { code: 'KeyP' });
      check('… and P back to SETZEN', u.modus() === 'setzen' && /Setzen/.test(k2.z.meldungen.at(-1)?.text ?? ''));
      u.beiTaste!(k2.ctx, { code: 'KeyP' });
      gleich('a key for the mode that is already on does nothing (no message, no redraw)', [k2.z.meldungen.length, k2.z.seite], [2, 2]);
      const { host, knoepfe } = neuerHost();
      u.seitenleiste!(k2.ctx, host);
      gleich('the sidebar has two mode buttons "Setzen (P)" and "Anwählen (V)"', knoepfe.map((k) => k.text).filter((x) => /\(P\)|\(V\)/.test(x)), ['Setzen (P)', 'Anwählen (V)']);
      knoepfe.find((k) => k.text === 'Anwählen (V)')!.cb();
      check('the button switches the mode', u.modus() === 'anwaehlen');
      gleich('the badges show the mode: "Anwählen" in ANWAEHLEN, the prefab in SETZEN', [u.hudZusatz(), u.kachelZusatz()], ['Anwählen', 'Anwählen']);
      u.setzeModus('setzen');
      gleich('… and the prefab again in SETZEN', [u.hudZusatz(), u.kachelZusatz()], ['Beech1', 'Beech1']);
      // switching the mode drops a drag in progress
      const v = erzeugeAnwaehlen();
      const k3 = neuerKontext(start, 'platzieren', 1);
      v.beiZeigerRunter(k3.ctx, klick(5100, 5000));
      v.beiZeigerBewegt!(k3.ctx, klick(5300, 5000));
      v.beiTaste!(k3.ctx, { code: 'KeyP' });
      v.beiZeigerHoch!(k3.ctx, klick(5300, 5000));
      gleich('switching to SETZEN in the middle of a drag drops it: the release moves nothing', [k3.z.schritte.length, platz(k3.z.layout).find((p) => p.id === 'probe-c')?.x], [0, 5100]);
    });

    // ── Ids ────────────────────────────────────────────────────────
    await sektion('Ids: derived + a random tail with a letter; never one that was just deleted', async () => {
      const geloescht: string[] = [];
      const t = erzeugePlatzieren({ zufall: () => 0.5 }); // a FIXED random source: the counter has to keep the ids apart
      const { z, ctx } = neuerKontext(start, 'platzieren', 1);
      const gesehen = new Set<string>();
      let wiederverwendet = 0;
      for (let i = 0; i < 40; i++) {
        t.beiZeigerRunter(ctx, klick(30000, 30000));
        const id = t.auswahlId()!;
        if (gesehen.has(id)) wiederverwendet++;
        gesehen.add(id);
        t.beiTaste!(ctx, { code: 'Delete' }); // delete it again, set the same thing at the same place
        geloescht.push(id);
      }
      gleich('set + delete + set again at the SAME place, 40 times, even with a fixed random source: 40 different ids, none used twice', [gesehen.size, wiederverwendet], [40, 0]);
      check('… every one of them valid (ID_RE) and not in the document any more', geloescht.every((id) => ID_RE.test(id)) && platz(z.layout).length === platz(start).length);
      // the derived part alone would repeat: the editor's old behaviour, and what the game server took for the same object
      const zufall = lcg(11);
      const belegt = new Set<string>();
      const teile: string[] = [];
      for (let i = 0; i < 2000; i++) {
        const id = frischeId(belegt, { prefab: 'Beech1', x: 5, z: 5 }, zufall);
        belegt.add(id);
        teile.push(id);
      }
      check('2000 ids at one place from a real random source: all different, all `beech1_5_5-` + a letter + 3 base-36 characters (never only digits: never taken for the counter of a derived id)', new Set(teile).size === 2000 && teile.every((id) => /^beech1_5_5-[a-z][0-9a-z]{3}$/.test(id)));
      const lang = frischeId(new Set(), { prefab: 'P'.repeat(64), x: -40000, z: 40000 }, () => 0.999999);
      check('a 64-character prefab at the far corner: the id still fits ID_RE and 64 characters', ID_RE.test(lang) && lang.length <= 64, `${lang.length} chars: ${lang}`);
      const voll = frischeId(new Set(['beech1_5_5-a000', 'beech1_5_5-a000-2']), { prefab: 'Beech1', x: 5, z: 5 }, () => 0);
      gleich('a taken tail gets a counter behind it', voll, 'beech1_5_5-a000-3');
      // the tool never gives a deleted id out again, whatever the random source says (the ids of THIS session)
      const t2 = erzeugePlatzieren({ zufall: () => 0 });
      const k2 = neuerKontext(start, 'platzieren', 1);
      t2.beiZeigerRunter(k2.ctx, klick(40, 40));
      const erste = t2.auswahlId()!;
      t2.beiTaste!(k2.ctx, { code: 'Delete' });
      t2.beiZeigerRunter(k2.ctx, klick(40, 40));
      check('the id of a deleted object is not given out again even by a random source that repeats itself', t2.auswahlId() !== erste && ID_RE.test(t2.auswahlId()!), `${erste} then ${t2.auswahlId()}`);
    });

    // ── Cancel, release outside, foreign pointer ───────────────────
    await sektion('Pointer: cancel, release outside the map, another pointer, a release nobody pressed for', async () => {
      const t = erzeugeAnwaehlen();
      const { z, ctx } = neuerKontext(start, 'platzieren', 1);
      t.beiZeigerRunter(ctx, klick(5100, 5000, false, 7));
      for (let i = 1; i <= 10; i++) t.beiZeigerBewegt!(ctx, klick(5100 + i * 20, 5000, false, 7));
      t.beiZeigerAbbruch!(ctx);
      for (let i = 1; i <= 6; i++) t.beiZeigerBewegt!(ctx, klick(5300 + i * 20, 5000, false, 7));
      t.beiZeigerHoch!(ctx, klick(5420, 5000, false, 7)); // a release WITHOUT a press (the press was cancelled)
      gleich('pointercancel drops the drag: the later release moves NOTHING (no step, the object stays)', [z.schritte.length, platz(z.layout).find((p) => p.id === 'probe-c')?.x, t.auswahlId()], [0, 5100, 'probe-c']);
      const zz = neuerZeichner();
      t.zeichneOverlay!(ctx, zz as unknown as CanvasRenderingContext2D);
      check('… and no ghost is drawn any more (only the ring)', zz.log.filter((l) => l.startsWith('arc')).length === 1 && !zz.log.includes('dash [4,4]'));
      // another pointer (a second finger) neither moves nor releases the drag of the first
      t.beiZeigerRunter(ctx, klick(5100, 5000, false, 1));
      t.beiZeigerBewegt!(ctx, klick(5100 + 100, 5000, false, 2));
      t.beiZeigerHoch!(ctx, klick(5100 + 100, 5000, false, 2));
      gleich('pointer 2 moves and releases: the drag of pointer 1 is untouched (no step)', z.schritte.length, 0);
      t.beiZeigerBewegt!(ctx, klick(5100 + 60, 5000, false, 1));
      t.beiZeigerHoch!(ctx, klick(5100 + 60, 5000, false, 1));
      gleich('pointer 1 finishes it: one step, moved by ITS travel (60)', [z.schritte.length, platz(z.layout).find((p) => p.id === 'probe-c')?.x], [1, 5160]);
      // a release nobody pressed for
      t.beiZeigerHoch!(ctx, klick(1, 1, false, 9));
      gleich('a release with no press before it does nothing', z.schritte.length, 1);
      // release outside the map = the editor calls the abort hook instead of the release hook: nothing is committed
      const k2 = neuerKontext(start, 'platzieren', 1);
      const u = erzeugeAnwaehlen();
      u.beiZeigerRunter(k2.ctx, klick(5100, 5000));
      u.beiZeigerBewegt!(k2.ctx, klick(4000, 5000));
      u.beiZeigerAbbruch!(k2.ctx);
      gleich('release over the sidebar (abort hook): no step, the object stays at 5100, the selection stays', [k2.z.schritte.length, platz(k2.z.layout).find((p) => p.id === 'probe-c')?.x, u.auswahlId()], [0, 5100, 'probe-c']);
      // an abort without a drag does nothing (also in SETZEN)
      const w = erzeugePlatzieren();
      const k3 = neuerKontext(start, 'platzieren', 1);
      w.beiZeigerAbbruch!(k3.ctx);
      gleich('an abort without a drag in progress: nothing (no redraw)', [k3.z.zeichnen, k3.z.schritte.length], [0, 0]);
    });

    // ── Keys: Backspace like Delete ────────────────────────────────
    await sektion('Keys: Backspace deletes like Delete', async () => {
      const t = erzeugePlatzieren();
      const { z, ctx } = neuerKontext(start);
      t.waehle('probe-b');
      t.beiTaste!(ctx, { code: 'Backspace' });
      gleich('Backspace removes the selection: an "entferne" of placements/probe-b, one step', [platz(z.layout).some((p) => p.id === 'probe-b'), z.schritte.length, z.vorgaenge[0]?.ops.map((o) => `${o.art}/${o.sammlung}/${o.id}`)], [false, 1, ['entferne/placements/probe-b']]);
      t.beiTaste!(ctx, { code: 'Backspace' });
      gleich('a second Backspace (no selection): nothing', z.schritte.length, 1);
    });

    // ── Every way to create a placement gives an id with a tail ────
    await sektion('Every creator of a placement (editor tool, test flight, MCP, layoutMitPlatzierung) uses the shared id function', () => {
      const lies = (pfad: string): string => {
        try {
          return readFileSync(resolve(EDITOR, pfad), 'utf-8');
        } catch {
          return '';
        }
      };
      const testflug = lies('testflug/Testflug.ts');
      const mcp = (() => {
        try {
          return readFileSync(resolve(WURZEL, 'tools/worldlayout-mcp/server.ts'), 'utf-8');
        } catch {
          return '';
        }
      })();
      const dok = lies('weltdokument.ts');
      check('test flight: both places that append a placement give it id: frischePlatzierungsId(...) (2 calls)', (testflug.match(/id: frischePlatzierungsId\(roh, /g) ?? []).length === 2);
      check('MCP placement_set without an id: frischePlatzierungsId(layout, platzierung), not the derived neuePlatzierungsId', /const neueId = id \?\? frischePlatzierungsId\(layout, platzierung\);/.test(mcp) && !/neuePlatzierungsId/.test(mcp));
      check('layoutMitPlatzierung: frischePlatzierungsId', /id: frischePlatzierungsId\(layout,/.test(dok) && !/neuePlatzierungsId/.test(dok));
      // the function itself, on the shared module
      const belegt = new Set(['beech1_5_5-a000']);
      const a = frischeId(belegt, { prefab: 'Beech1', x: 5, z: 5 }, () => 0);
      const b = frischePlatzierungsIdVonLayout();
      gleich('a taken tail gets a counter; a LAYOUT can be handed over instead of a set of ids', [a, /^beech1_5_5-[a-z][0-9a-z]{3}$/.test(b)], ['beech1_5_5-a000-2', true]);
      function frischePlatzierungsIdVonLayout(): string {
        const f = (idModul?.frischePlatzierungsId ?? (() => '')) as (b: unknown, p: { prefab: string; x: number; z: number }) => string;
        return f({ placements: [{ id: 'beech1_5_5' }] }, { prefab: 'Beech1', x: 5, z: 5 });
      }
    });

    // ── Source guard ───────────────────────────────────────────────
    console.log('Source guard');
    const haupt = readFileSync(resolve(EDITOR, 'editorMain.ts'), 'utf-8');
    const hud = readFileSync(resolve(EDITOR, 'KartenHud.ts'), 'utf-8');
    const index = readFileSync(resolve(EDITOR, 'werkzeuge', 'index.ts'), 'utf-8');
    gleich("editorMain.ts: no `werkzeug === 'platzieren'` branch", haupt.match(/werkzeug\s*[!=]==\s*'platzieren'/g) ?? [], []);
    gleich('editorMain.ts: no `spawnPrefab`, no `layoutMitPlatzierung`', haupt.match(/\b(spawnPrefab|layoutMitPlatzierung)\b/g) ?? [], []);
    check("editorMain.ts: the pointer hooks are CALLED (move, up, cancel), the pointer is captured, Delete is passed on", /\?\.beiZeigerBewegt\?\.\(werkzeugKontext/.test(haupt) && /registriert\.beiZeigerHoch\?\.\(werkzeugKontext/.test(haupt) && /addEventListener\('pointercancel', zeigerAbbruch\)/.test(haupt) && /addEventListener\('lostpointercapture', zeigerAbbruch\)/.test(haupt) && /\.beiZeigerAbbruch\?\.\(werkzeugKontext\)/.test(haupt) && /zeigerId: e\.pointerId/.test(haupt) && /setPointerCapture\(e\.pointerId\)/.test(haupt) && /WERKZEUG_TASTEN_CODES\.has\(e\.code\)/.test(haupt) && /\?\.beiTaste\?\.\(werkzeugKontext, e\)/.test(haupt));
    check('editorMain.ts: the tool keys (Delete, Backspace, P, V) are ignored while an input has the focus and while the catalog is open', /new Set\(\['Delete', 'Backspace', 'KeyP', 'KeyV'\]\)/.test(haupt) && /INPUT\|TEXTAREA\|SELECT/.test(haupt) && /katalogIstOffen\(\)/.test(haupt));
    check('editorMain.ts: the catalog sets the prefab through the tool; the finding jump selects through it', /platzierenWerkzeug\.setzePrefab\(prefab\)/.test(haupt) && /platzierenWerkzeug\.waehle\(id\)/.test(haupt) && /platzierungZuBefund\(layout, b\)/.test(haupt));
    check('editorMain.ts: the context answers `bestaetige` with the browser confirm (through erzeugeWerkzeugKontext)', /bestaetige: \(frage\) => window\.confirm\(frage\)/.test(haupt) && /erzeugeWerkzeugKontext\(\{/.test(haupt));
    check('editorMain.ts: the wide tile comes from the tool (`kachelBreit`)', /w\.kachelBreit/.test(haupt));
    gleich("KartenHud.ts: no 'platzieren' key in the old tables", hud.match(/^\s*platzieren:/gm) ?? [], []);
    check("index.ts: 'platzieren' left ALTE_WERKZEUGE and is registered", !/ALTE_WERKZEUGE = \[[^\]]*'platzieren'/.test(index) && /erzeugePlatzieren\(\)/.test(index));
    check('platzieren.ts: every change goes through ops.ts (opSetzen, opAendern, opEntfernen, wende) and the id from frischePlatzierungsId', (() => {
      const q = readFileSync(resolve(EDITOR, 'werkzeuge', 'platzieren.ts'), 'utf-8');
      return /opSetzen\(/.test(q) && /opAendern\(/.test(q) && /opEntfernen\(/.test(q) && /\bwende\(/.test(q) && /frischePlatzierungsId\(/.test(q) && !/neuePlatzierungsId\(/.test(q) && !/Math\.random\(\)/.test(q.replace(/opt\.zufall \?\? Math\.random/, ''));
    })());
  }

  console.log(fehler === 0 ? '\nOK' : `\n${fehler} FAILED`);
  process.exit(fehler === 0 ? 0 : 1);
}

void main();
