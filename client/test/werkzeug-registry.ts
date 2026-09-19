/**
 * Map tool registry (Editor E1, N1): the river and lake tools run in their own
 * modules against a fake `WerkzeugKontext`, without an editor window.
 *
 * What is measured is the effect on the DOCUMENT (points, width, depth, radius,
 * number of undo steps per click sequence) and what the tool tells the editor
 * (messages, redraws, tool switch) -- not what the old code looked like.
 * The same click sequences in the real editor, on `122db70` and on this
 * branch, are compared in the report (Browser run).
 *
 * Nachbesserung 1: the registry refuses an id twice and an id that still belongs
 * to a tool on the old path; a tool that throws is caught per call (logged with
 * its id, that call skipped) and cannot take the others down. Both are checked
 * with synthetic tools, DOM-free.
 *
 * The source guard at the end must be red on `122db70`: there the tools are
 * still `if (werkzeug === 'fluss')` branches in `editorMain.ts` and there is
 * no registry module.
 *
 * Run:  npx tsx test/werkzeug-registry.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout, type WorldLayout } from '@wov/shared';
import type { KartenWerkzeug, SeitenHost } from '../src/editor/werkzeuge/typ';

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

// ── Fake context ─────────────────────────────────────────────────────
interface Meldung {
  text: string;
  fehler: boolean;
}
function neuerKontext(start: WorldLayout, aktiv: string) {
  const z = {
    layout: start,
    /** The documents pushed by `aendere` -- one entry = one undo step. */
    schritte: [] as WorldLayout[],
    aktiv,
    uebernommen: 0,
    seite: 0,
    zeichnen: 0,
    meldungen: [] as Meldung[],
    massstab: 40,
  };
  const ctx = {
    layout: () => z.layout,
    aendere: (neu: WorldLayout) => {
      z.schritte.push(z.layout);
      z.layout = neu;
    },
    bestaetige: () => true,
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
    meldung: (text: string, fehler = false) => {
      z.meldungen.push({ text, fehler });
    },
    zuBild: (wx: number, wz: number): [number, number] => [wx / z.massstab + 400, wz / z.massstab + 300],
    massstab: () => z.massstab,
  };
  return { z, ctx };
}

// ── Fake canvas: records what the overlay draws ──────────────────────
function neuerZeichner() {
  const log: string[] = [];
  const z = {
    strokeStyle: '',
    lineWidth: 0,
    lineWidthLog: [] as number[],
    log,
    beginPath: () => log.push('beginPath'),
    moveTo: (x: number, y: number) => log.push(`moveTo ${x},${y}`),
    lineTo: (x: number, y: number) => log.push(`lineTo ${x},${y}`),
    stroke: () => log.push(`stroke ${z.strokeStyle} w${z.lineWidth}`),
    setLineDash: (d: number[]) => log.push(`dash ${JSON.stringify(d)}`),
  };
  return z;
}

// ── Fake DOM: only what `design.ts` (el, feld) needs for the sidebar ─
interface FakeKnoten {
  tag: string;
  style: { cssText: string };
  children: FakeKnoten[];
  title?: string;
  value?: string;
  textContent?: string;
  onchange?: () => void;
  appendChild(k: FakeKnoten): FakeKnoten;
  append(...k: FakeKnoten[]): void;
}
function fakeKnoten(tag: string): FakeKnoten {
  const k: FakeKnoten = {
    tag,
    style: { cssText: '' },
    children: [],
    appendChild(c) {
      k.children.push(c);
      return c;
    },
    append(...c) {
      k.children.push(...c);
    },
  };
  return k;
}
(globalThis as unknown as { document: unknown }).document = { createElement: fakeKnoten };
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

const echt = sanitizeWorldLayout(JSON.parse(readFileSync(resolve(WURZEL, 'server/data/welten/dev.json'), 'utf-8')))!;
const leer: WorldLayout = { ...echt, rivers: [], lakes: [] };
const klick = (x: number, z: number, shiftKey = false) => ({ weltX: x, weltZ: z, shiftKey });

/**
 * A synthetic tool that counts what it is asked. `wirft`: every call throws
 * (also with a thrown STRING for the click, an `Error` otherwise), so the
 * guard is measured against both kinds of thrown value.
 */
function attrappe(id: string, wirft: boolean) {
  const z = { klick: 0, doppel: 0, taste: 0, overlay: 0, abbrechen: 0, kachelZusatz: 0, hudZusatz: 0, seite: 0 };
  const boom = (was: string): never => {
    throw new Error(`boom ${id}.${was}`);
  };
  const w: KartenWerkzeug = {
    id,
    titel: id,
    bild: 'M0 0',
    kachelName: id,
    kachelTipp: id,
    tasten: [['Klick', 'x']],
    kachelZusatz: () => {
      z.kachelZusatz++;
      if (wirft) boom('kachelZusatz');
      return 'kz';
    },
    hudZusatz: () => {
      z.hudZusatz++;
      if (wirft) boom('hudZusatz');
      return 'hz';
    },
    beiZeigerRunter: (_ctx, e) => {
      z.klick++;
      if (wirft) throw 'boom-string';
      return e.shiftKey; // true / false pass through
    },
    beiDoppelklick: () => {
      z.doppel++;
      if (wirft) boom('beiDoppelklick');
    },
    beiTaste: (_ctx, e) => {
      z.taste++;
      if (wirft) boom('beiTaste');
      return e.code === 'Escape';
    },
    zeichneOverlay: (_ctx, zeichner) => {
      z.overlay++;
      zeichner.beginPath();
      if (wirft) boom('zeichneOverlay');
      zeichner.stroke();
    },
    abbrechen: () => {
      z.abbrechen++;
      if (wirft) boom('abbrechen');
    },
    seitenleiste: () => {
      z.seite++;
      if (wirft) boom('seitenleiste');
      return fakeKnoten('block') as unknown as HTMLElement;
    },
  };
  return { z, w };
}
/** Run `tu`, returning the message it threw (or `null`). */
function wirftMit(tu: () => unknown): string | null {
  try {
    tu();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function main(): Promise<void> {
  console.log('Registry module');
  let reg: typeof import('../src/editor/werkzeuge') | null = null;
  let flussModul: typeof import('../src/editor/werkzeuge/fluss') | null = null;
  let seeModul: typeof import('../src/editor/werkzeuge/see') | null = null;
  let F: typeof import('../src/editor/design').F | null = null;
  try {
    reg = await import('../src/editor/werkzeuge');
    flussModul = await import('../src/editor/werkzeuge/fluss');
    seeModul = await import('../src/editor/werkzeuge/see');
    F = (await import('../src/editor/design')).F;
  } catch (e) {
    console.log(`  (modules missing: ${(e as Error).message.split('\n')[0]})`);
  }
  check('registry, river and lake modules load', reg !== null && flussModul !== null && seeModul !== null);
  let schutz: typeof import('../src/editor/werkzeuge/schutz') | null = null;
  try {
    schutz = await import('../src/editor/werkzeuge/schutz');
  } catch (e) {
    console.log(`  (guard module missing: ${(e as Error).message.split('\n')[0]})`);
  }
  check(
    'guard module and registry build API exist (pruefeRegistrierung, schuetze, registriere, ALTE_WERKZEUGE)',
    schutz !== null && typeof reg?.registriere === 'function' && Array.isArray(reg?.ALTE_WERKZEUGE)
  );

  if (reg && flussModul && seeModul && F) {
    gleich('registry holds exactly fluss, see, platzieren (in toolbar order)', reg.WERKZEUGE.map((w) => w.id), ['fluss', 'see', 'platzieren']);
    check('werkzeugMitId finds a registered tool', reg.werkzeugMitId('fluss')?.id === 'fluss' && reg.werkzeugMitId('see')?.id === 'see' && reg.werkzeugMitId('platzieren')?.id === 'platzieren');
    check('werkzeugMitId: unregistered ids fall through', reg.werkzeugMitId('auswahl') === undefined && reg.werkzeugMitId('polygon') === undefined && reg.werkzeugMitId('') === undefined);
    for (const w of reg.WERKZEUGE) {
      check(`${w.id}: tile, HUD and key help are filled`, w.titel !== '' && w.kachelName !== '' && w.kachelTipp !== '' && w.bild.startsWith('M') && w.tasten.length >= 2);
    }
    gleich('fluss HUD text / key help', [reg.werkzeugMitId('fluss')!.titel, reg.werkzeugMitId('fluss')!.tasten], [
      'Fluss zeichnen',
      [['Klick', 'Punkt'], ['Doppelklick', 'schließen'], ['Esc', 'abbrechen']],
    ]);
    gleich('see HUD text / key help', [reg.werkzeugMitId('see')!.titel, reg.werkzeugMitId('see')!.tasten], [
      'See setzen',
      [['Klick', 'setzen'], ['Shift', 'Serie']],
    ]);

    // ── River ──────────────────────────────────────────────────────
    console.log('River: 4 points + close');
    {
      const fluss = flussModul.erzeugeFluss();
      const { z, ctx } = neuerKontext(leer, 'fluss');
      const gesamt = [klick(10.4, 20.6), klick(300, 40), klick(700.5, 400), klick(1200, 900)];
      gesamt.forEach((e) => check('click handled', fluss.beiZeigerRunter(ctx, e) === true));
      gleich('after 4 clicks: document untouched, undo steps', [z.schritte.length, z.layout.rivers?.length], [0, 0]);
      gleich('after 4 clicks: sidebar rebuilds / redraws', [z.seite, z.zeichnen], [4, 4]);
      gleich('tile badge / HUD badge', [fluss.kachelZusatz(), fluss.hudZusatz()], ['4 P.', '4 Punkte · 40 m']);

      const zeichner = neuerZeichner();
      fluss.zeichneOverlay!(ctx, zeichner as unknown as CanvasRenderingContext2D);
      gleich(
        'overlay of the open course (dashed, width max(2, 40/40))',
        zeichner.log,
        [
          'dash [6,4]',
          'beginPath',
          `moveTo ${10 / 40 + 400},${21 / 40 + 300}`,
          `lineTo ${300 / 40 + 400},${40 / 40 + 300}`,
          `lineTo ${701 / 40 + 400},${400 / 40 + 300}`,
          `lineTo ${1200 / 40 + 400},${900 / 40 + 300}`,
          `stroke ${F.wasser} w2`,
          'dash []',
        ]
      );
      gleich('overlay resets the line width to 1.5', zeichner.lineWidth, 1.5);

      fluss.beiDoppelklick!(ctx);
      const r = z.layout.rivers ?? [];
      gleich('river count / id', [r.length, r[0]?.id], [1, 'fluss-1']);
      gleich('river points (rounded)', r[0]?.points, [[10, 21], [300, 40], [701, 400], [1200, 900]]);
      gleich('river width / depth (defaults)', [r[0]?.width, r[0]?.depth], [40, 8]);
      gleich('undo steps for the whole sequence', z.schritte.length, 1);
      check('the undo step is the document from before (not mutated in place)', z.schritte[0] === leer && (leer.rivers ?? []).length === 0);
      gleich('tool switched to selection', z.aktiv, 'auswahl');
      gleich('committed once', z.uebernommen, 1);
      gleich('message', z.meldungen, [{ text: 'fluss-1 angelegt (4 Punkte, 40 m breit)', fehler: false }]);
      gleich('course emptied: badge', fluss.kachelZusatz(), '');
      const leerZeichner = neuerZeichner();
      fluss.zeichneOverlay!(ctx, leerZeichner as unknown as CanvasRenderingContext2D);
      gleich('course emptied: overlay draws nothing', leerZeichner.log, []);
    }

    console.log('River: refusals and Escape');
    {
      const fluss = flussModul.erzeugeFluss();
      const { z, ctx } = neuerKontext(leer, 'fluss');
      fluss.beiZeigerRunter(ctx, klick(100, 100));
      fluss.beiDoppelklick!(ctx);
      gleich('1 point: no river, no undo step, warning', [z.layout.rivers?.length, z.schritte.length, z.uebernommen], [0, 0, 0]);
      gleich('1 point: message', z.meldungen, [{ text: 'Ein Fluss braucht mindestens 2 Punkte (aktuell 1).', fehler: true }]);
      gleich('1 point: course kept, tool stays active', [fluss.kachelZusatz(), z.aktiv], ['1 P.', 'fluss']);
      // the two clicks of a double click add near-duplicates: < 1 m apart are dropped
      fluss.beiZeigerRunter(ctx, klick(100.4, 100.4));
      fluss.beiDoppelklick!(ctx);
      gleich('near-duplicate point does not count (still 1 after 2 clicks)', [z.layout.rivers?.length, z.meldungen.length], [0, 2]);
      gleich('…message says 1', z.meldungen[1]!.text, 'Ein Fluss braucht mindestens 2 Punkte (aktuell 1).');
      fluss.beiZeigerRunter(ctx, klick(900, 900));
      fluss.beiDoppelklick!(ctx);
      gleich('3 clicks, 1 near-duplicate: river has 2 points', z.layout.rivers?.[0]?.points, [[100, 100], [900, 900]]);
      gleich('…message counts 2', z.meldungen[2]!.text, 'fluss-1 angelegt (2 Punkte, 40 m breit)');

      // double click while ANOTHER tool is active: nothing happens
      const b = neuerKontext(leer, 'auswahl');
      const f2 = flussModul.erzeugeFluss();
      f2.beiZeigerRunter(b.ctx, klick(0, 0));
      f2.beiZeigerRunter(b.ctx, klick(500, 500));
      f2.beiDoppelklick!(b.ctx);
      gleich('double click with another tool active: no river, no message', [b.z.layout.rivers?.length, b.z.meldungen.length, b.z.schritte.length], [0, 0, 0]);
      gleich('…the open course stays (also drawn when the tool is not active)', f2.kachelZusatz(), '2 P.');
      const zz = neuerZeichner();
      f2.zeichneOverlay!(b.ctx, zz as unknown as CanvasRenderingContext2D);
      check('…and the overlay still draws it (lineTo count 1)', zz.log.filter((l) => l.startsWith('lineTo')).length === 1);

      // Escape claims: only Escape ends the tool
      check('Escape ends the river tool', fluss.beiTaste!(ctx, { code: 'Escape' }) === true);
      check('other keys do not', fluss.beiTaste!(ctx, { code: 'KeyA' }) === false && fluss.beiTaste!(ctx, { code: 'Enter' }) === false);

      // discard: silent, no document change
      const c = neuerKontext(leer, 'fluss');
      const f3 = flussModul.erzeugeFluss();
      f3.beiZeigerRunter(c.ctx, klick(0, 0));
      f3.beiZeigerRunter(c.ctx, klick(50, 50));
      f3.beiZeigerRunter(c.ctx, klick(90, 90));
      const seiteVor = c.z.seite;
      f3.abbrechen(c.ctx);
      gleich('abbrechen mid-river: course gone, document and undo stack untouched', [f3.kachelZusatz(), c.z.layout === leer, c.z.schritte.length, c.z.meldungen.length], ['', true, 0, 0]);
      gleich('abbrechen is silent (no rebuild, no redraw by itself)', [c.z.seite, c.z.zeichnen], [seiteVor, 3]);
      f3.beiDoppelklick!(c.ctx);
      gleich('after Escape a double click finds no course', c.z.meldungen.map((m) => m.text), ['Ein Fluss braucht mindestens 2 Punkte (aktuell 0).']);
    }

    console.log('River: second river, id and undo');
    {
      const vorhanden: WorldLayout = { ...echt, rivers: [{ id: 'fluss-1', points: [[0, 0], [10, 10]], width: 5, depth: 2 }], lakes: [] };
      const fluss = flussModul.erzeugeFluss();
      const { z, ctx } = neuerKontext(vorhanden, 'fluss');
      fluss.beiZeigerRunter(ctx, klick(0, 0));
      fluss.beiZeigerRunter(ctx, klick(400, 0));
      fluss.beiDoppelklick!(ctx);
      gleich('new id skips the taken one', z.layout.rivers?.map((r) => r.id), ['fluss-1', 'fluss-2']);
      gleich('the earlier river is untouched', z.layout.rivers?.[0], vorhanden.rivers![0]);
      z.layout = z.schritte.pop()!;
      gleich('undo: back to one river', z.layout.rivers?.length, 1);
    }

    console.log('River: sidebar (width / depth / close button)');
    {
      const fluss = flussModul.erzeugeFluss();
      const { z, ctx } = neuerKontext(leer, 'fluss');
      let { host, knoepfe } = neuerHost();
      let block = fluss.seitenleiste!(ctx, host) as unknown as FakeKnoten;
      gleich('no close button with 0 points', knoepfe.length, 0);
      gleich('hint line is the tool tooltip', finde(block, (k) => k.tag === 'hint').map((k) => k.textContent), [fluss.kachelTipp]);
      tippe(block, 'Breite in Metern', '120');
      gleich('width field: rebuild + redraw', [z.seite, z.zeichnen], [1, 1]);
      gleich('width in the HUD badge', fluss.hudZusatz(), '0 Punkte · 120 m');
      tippe(block, 'Tiefe unter der Wasserlinie (m)', '15');
      tippe(block, 'Breite in Metern', '9999');
      gleich('width clamps to 400', fluss.hudZusatz(), '0 Punkte · 400 m');
      tippe(block, 'Breite in Metern', '1');
      gleich('width clamps to 4', fluss.hudZusatz(), '0 Punkte · 4 m');
      tippe(block, 'Breite in Metern', 'abc');
      gleich('width: garbage keeps the value', fluss.hudZusatz(), '0 Punkte · 4 m');
      tippe(block, 'Breite in Metern', '80');
      tippe(block, 'Tiefe unter der Wasserlinie (m)', '99');
      fluss.beiZeigerRunter(ctx, klick(0, 0));
      fluss.beiZeigerRunter(ctx, klick(1000, 0));
      ({ host, knoepfe } = neuerHost());
      block = fluss.seitenleiste!(ctx, host) as unknown as FakeKnoten;
      gleich('close button appears with 2 points', knoepfe.map((k) => k.text), ['Fluss abschließen (2 Punkte)']);
      knoepfe[0]!.cb();
      const r = z.layout.rivers?.[0];
      gleich('close button: river width 80, depth clamps to 60, 2 points, 1 undo step', [r?.width, r?.depth, r?.points.length, z.schritte.length], [80, 60, 2, 1]);
      gleich('close button: message', z.meldungen.at(-1)?.text, 'fluss-1 angelegt (2 Punkte, 80 m breit)');
      void block;
    }

    // ── Lake ───────────────────────────────────────────────────────
    console.log('Lake: one click = one lake');
    {
      const see = seeModul.erzeugeSee();
      const { z, ctx } = neuerKontext(leer, 'see');
      check('click handled', see.beiZeigerRunter(ctx, klick(1234.6, -50.4)) === true);
      const l = z.layout.lakes ?? [];
      gleich('lake: id, centre (rounded), radius, depth (defaults)', [l[0]?.id, l[0]?.x, l[0]?.z, l[0]?.radius, l[0]?.depth], ['see-1', 1235, -50, 200, 8]);
      gleich('lake count / undo steps', [l.length, z.schritte.length], [1, 1]);
      check('undo step is the document from before', z.schritte[0] === leer);
      gleich('no Shift: back to selection', z.aktiv, 'auswahl');
      gleich('committed once', z.uebernommen, 1);
      gleich('message', z.meldungen, [{ text: 'see-1 angelegt (Radius 200 m)', fehler: false }]);
      check('lake is not a course: no double click, no key, no overlay (members absent)', see.beiDoppelklick === undefined && see.beiTaste === undefined && see.zeichneOverlay === undefined);
      see.abbrechen(ctx);
      gleich('abbrechen changes nothing', [z.layout.lakes?.length, z.schritte.length, z.meldungen.length], [1, 1, 1]);
    }

    console.log('Lake: series with Shift, radius / depth from the sidebar');
    {
      const see = seeModul.erzeugeSee();
      const { z, ctx } = neuerKontext(leer, 'see');
      const { host } = neuerHost();
      const block = see.seitenleiste!(ctx, host) as unknown as FakeKnoten;
      tippe(block, 'Radius in Metern', '500');
      gleich('radius field: rebuild only (no redraw)', [z.seite, z.zeichnen], [1, 0]);
      gleich('badges show the radius', [see.kachelZusatz(), see.hudZusatz()], ['500 m', 'Radius 500 m']);
      tippe(block, 'Tiefe unter der Wasserlinie (m)', '20');
      see.beiZeigerRunter(ctx, klick(0, 0, true));
      gleich('Shift: tool stays active', z.aktiv, 'see');
      see.beiZeigerRunter(ctx, klick(5000, 5000, true));
      const l = z.layout.lakes ?? [];
      gleich('two lakes: ids, radius, depth', l.map((x) => [x.id, x.radius, x.depth]), [['see-1', 500, 20], ['see-2', 500, 20]]);
      gleich('one undo step per lake', z.schritte.length, 2);
      gleich('messages carry the Shift suffix', z.meldungen.map((m) => m.text), [
        'see-1 angelegt (Radius 500 m) — Werkzeug bleibt aktiv (Shift)',
        'see-2 angelegt (Radius 500 m) — Werkzeug bleibt aktiv (Shift)',
      ]);
      see.beiZeigerRunter(ctx, klick(9000, 0, false));
      gleich('last click without Shift ends the series', [z.aktiv, z.layout.lakes?.length, z.schritte.length], ['auswahl', 3, 3]);
      tippe(block, 'Radius in Metern', '99999');
      gleich('radius clamps to 5000', see.hudZusatz(), 'Radius 5000 m');
      tippe(block, 'Radius in Metern', '2');
      gleich('radius clamps to 8', see.hudZusatz(), 'Radius 8 m');
      tippe(block, 'Radius in Metern', '0');
      gleich('radius 0 / garbage keeps the value', see.hudZusatz(), 'Radius 8 m');
      tippe(block, 'Tiefe unter der Wasserlinie (m)', '500');
      see.beiZeigerRunter(ctx, klick(1, 1));
      gleich('depth clamps to 60', z.layout.lakes?.at(-1)?.depth, 60);
      // undo of the series, one by one
      for (let i = 0; i < 4; i++) z.layout = z.schritte.pop()!;
      gleich('4 undos empty the document again', z.layout.lakes?.length, 0);
    }

    console.log('Tools do not share state');
    {
      const a = flussModul.erzeugeFluss();
      const b = flussModul.erzeugeFluss();
      const { ctx } = neuerKontext(leer, 'fluss');
      a.beiZeigerRunter(ctx, klick(1, 1));
      gleich('a fresh instance starts empty', [a.kachelZusatz(), b.kachelZusatz()], ['1 P.', '']);
    }
  }


  // ── Registry build: ids ─────────────────────────────────────────────
  if (reg && flussModul && seeModul && schutz && typeof reg.registriere === 'function') {
    console.log('Registry build: ids');
    gleich('reserved ids = the tools still on the old path', reg.ALTE_WERKZEUGE, ['auswahl', 'form', 'polygon']);
    check('no registered tool uses a reserved id', reg.WERKZEUGE.every((w) => !(reg.ALTE_WERKZEUGE as readonly string[]).includes(w.id)));
    const doppelt = wirftMit(() => reg.registriere(flussModul.erzeugeFluss(), seeModul.erzeugeSee(), flussModul.erzeugeFluss()));
    check('same id twice: registriere throws', doppelt !== null);
    check('…the message names the id and says twice', /"fluss"/.test(doppelt ?? '') && /twice/.test(doppelt ?? ''), doppelt ?? '');
    check('two different ids: fine (returns both, in order)', (() => {
      const r = reg.registriere(attrappe('a1', false).w, attrappe('a2', false).w);
      return r.length === 2 && r[0]!.id === 'a1' && r[1]!.id === 'a2';
    })());
    for (const id of reg.ALTE_WERKZEUGE) {
      const m = wirftMit(() => reg.registriere(attrappe(id, false).w));
      check(`reserved id "${id}": registriere throws`, m !== null && m.includes(`"${id}"`) && /reserved/.test(m) && /ALTE_WERKZEUGE/.test(m), m ?? 'did not throw');
    }
    const leerId = wirftMit(() => reg.registriere(attrappe('', false).w));
    check('empty id: throws', leerId !== null && /empty id/.test(leerId), leerId ?? 'did not throw');
    const keine = wirftMit(() => reg.registriere());
    check('an EMPTY registry: registriere throws, naming the list', keine !== null && /list is empty/.test(keine) && /werkzeuge\/index\.ts/.test(keine), keine ?? 'did not throw');
    check('the pure check: no tool throws, one tool does not', wirftMit(() => schutz.pruefeRegistrierung([], [])) !== null && wirftMit(() => schutz.pruefeRegistrierung([{ id: 'x' }], [])) === null);
    check('the pure check without wrapping: duplicate and reserved', (() => {
      const a = wirftMit(() => schutz.pruefeRegistrierung([{ id: 'x' }, { id: 'x' }], []));
      const b = wirftMit(() => schutz.pruefeRegistrierung([{ id: 'x' }], ['x']));
      const c = wirftMit(() => schutz.pruefeRegistrierung([{ id: 'x' }, { id: 'y' }], ['z']));
      return a !== null && /twice/.test(a) && b !== null && /reserved/.test(b) && c === null;
    })());
  } else {
    check('Registry build: ids -- section could not run (registriere / schuetze missing)', false);
  }

  // ── Fault isolation per tool ────────────────────────────────────────
  if (reg && flussModul && seeModul && schutz && typeof reg.registriere === 'function') {
    console.log('Fault isolation: a tool that throws');
    const { ctx } = neuerKontext(leer, 'kaputt');
    const gemeldet: { id: string; aufruf: string; fehler: unknown }[] = [];
    const senke = (id: string, aufruf: string, fehler: unknown): void => {
      gemeldet.push({ id, aufruf, fehler });
    };
    {
      const { z, w } = attrappe('kaputt', true);
      const g = schutz.schuetze(w, senke);
      const ereignis = { weltX: 1, weltZ: 2, shiftKey: false };
      gleich('click: does not throw, the click is consumed (true)', wirftMit(() => g.beiZeigerRunter(ctx, ereignis)), null);
      check('…result true', g.beiZeigerRunter(ctx, ereignis) === true);
      check('double click: no throw', wirftMit(() => g.beiDoppelklick!(ctx)) === null);
      check('key: no throw, does NOT end the tool (false)', wirftMit(() => g.beiTaste!(ctx, { code: 'Escape' })) === null && g.beiTaste!(ctx, { code: 'Escape' }) === false);
      const zz = neuerZeichner();
      check('overlay: no throw', wirftMit(() => g.zeichneOverlay!(ctx, zz as unknown as CanvasRenderingContext2D)) === null);
      check('abbrechen: no throw', wirftMit(() => g.abbrechen(ctx)) === null);
      gleich('kachelZusatz / hudZusatz: empty text', [g.kachelZusatz(), g.hudZusatz()], ['', '']);
      check('seitenleiste: null', g.seitenleiste!(ctx, neuerHost().host) === null);
      gleich('every call reached the tool once (or twice where called twice)', [z.klick, z.doppel, z.taste, z.overlay, z.abbrechen, z.kachelZusatz, z.hudZusatz, z.seite], [2, 1, 2, 1, 1, 1, 1, 1]);
      gleich('every failure was reported with the tool id', [...new Set(gemeldet.map((m) => m.id))], ['kaputt']);
      gleich('…and with the name of the call', [...new Set(gemeldet.map((m) => m.aufruf))].sort(), ['abbrechen', 'beiDoppelklick', 'beiTaste', 'beiZeigerRunter', 'hudZusatz', 'kachelZusatz', 'seitenleiste', 'zeichneOverlay']);
      check('…with the thrown value (string and Error alike)', gemeldet.some((m) => m.fehler === 'boom-string') && gemeldet.some((m) => m.fehler instanceof Error && /boom kaputt/.test(m.fehler.message)));
      const g2 = schutz.schuetze(w, () => {
        throw new Error('sink broken');
      });
      check('a sink that throws does not bring the call down either', wirftMit(() => g2.abbrechen(ctx)) === null);
    }

    {
      // A hook that returns a Promise breaks the contract (`async` hooks): a rejection must be
      // reported like a throw, must not surface as an unhandled rejection, and the call counts as skipped.
      console.log('Fault isolation: a hook that returns a Promise');
      const gemeldet: { id: string; aufruf: string; fehler: unknown }[] = [];
      let unbehandelt = 0;
      const beiUnbehandelt = (): void => void unbehandelt++;
      process.on('unhandledRejection', beiUnbehandelt);
      const { w } = attrappe('asynchron', false);
      const asynchron: KartenWerkzeug = {
        ...w,
        beiZeigerRunter: (async () => {
          throw new Error('async click boom');
        }) as unknown as KartenWerkzeug['beiZeigerRunter'],
        beiTaste: (async () => true) as unknown as KartenWerkzeug['beiTaste'],
        beiDoppelklick: async () => {
          throw 'async-string';
        },
      };
      const g = schutz.schuetze(asynchron, (id, aufruf, fehler) => void gemeldet.push({ id, aufruf, fehler }));
      const ereignis = { weltX: 1, weltZ: 2, shiftKey: false };
      check('rejected async click: no throw, replacement value true (the click is consumed)', wirftMit(() => g.beiZeigerRunter(ctx, ereignis)) === null && g.beiZeigerRunter(ctx, ereignis) === true);
      check('fulfilled async key: replacement value false, NOT the Promise', g.beiTaste!(ctx, { code: 'Escape' }) === false);
      check('rejected async double click: no throw', wirftMit(() => g.beiDoppelklick!(ctx)) === null);
      gleich('nothing is reported before the Promises settle (the call itself returned at once)', gemeldet.length, 0);
      await new Promise((fertig) => setTimeout(fertig, 30));
      process.off('unhandledRejection', beiUnbehandelt);
      gleich('one report per call (2 clicks, 1 key, 1 double click)', gemeldet.map((m) => m.aufruf).sort(), ['beiDoppelklick', 'beiTaste', 'beiZeigerRunter', 'beiZeigerRunter']);
      check('a rejection is reported as what it carries (Error and string alike)', gemeldet.some((m) => m.fehler instanceof Error && /async click boom/.test(m.fehler.message)) && gemeldet.some((m) => m.fehler === 'async-string'));
      check('a fulfilled Promise is reported as a contract violation', gemeldet.some((m) => m.aufruf === 'beiTaste' && m.fehler instanceof Error && /returned a Promise/.test(m.fehler.message)));
      check('every report names the tool id', gemeldet.every((m) => m.id === 'asynchron'));
      gleich('no unhandled rejection reached the process', unbehandelt, 0);
    }

    {
      // the editor's own loops, with a broken tool in the middle
      const { z: zk, w: kaputt } = attrappe('kaputt', true);
      const { z: zg, w: gut } = attrappe('gut', false);
      const { z: zh, w: gut2 } = attrappe('gut2', false);
      const stumm: unknown[][] = [];
      const alt = console.error;
      console.error = (...a: unknown[]) => void stumm.push(a);
      let liste: KartenWerkzeug[];
      try {
        liste = reg.registriere(gut, kaputt, gut2); // default sink = console.error
        // an exception escaping a loop is a failed check, not a crashed test
        const fangen = (was: string, tu: () => void): void => {
          try {
            tu();
          } catch (e) {
            check(`${was}: no exception escapes the loop`, false, String((e as Error).message));
          }
        };
        const zeichner = neuerZeichner();
        fangen('overlay loop', () => {
          for (const w of liste) w.zeichneOverlay?.(ctx, zeichner as unknown as CanvasRenderingContext2D);
        });
        gleich('overlay loop: the tools before AND after the broken one drew (beginPath+stroke each)', zeichner.log.filter((l) => l === 'beginPath').length + '/' + zeichner.log.filter((l) => l.startsWith('stroke')).length, '3/2');
        fangen('abbrechen loop', () => {
          for (const w of liste) w.abbrechen(ctx);
        });
        gleich('abbrechen loop (Escape, foreign draft): all three were asked', [zg.abbrechen, zk.abbrechen, zh.abbrechen], [1, 1, 1]);
        gleich('click on the healthy tool passes its value through (Shift → true, else false)', [liste[0]!.beiZeigerRunter(ctx, { weltX: 0, weltZ: 0, shiftKey: true }), liste[0]!.beiZeigerRunter(ctx, { weltX: 0, weltZ: 0, shiftKey: false })], [true, false]);
        gleich('Escape on the healthy tool ends it, another key does not', [liste[0]!.beiTaste!(ctx, { code: 'Escape' }), liste[0]!.beiTaste!(ctx, { code: 'KeyA' })], [true, false]);
        gleich('healthy tools report their texts unchanged', [liste[0]!.kachelZusatz(), liste[2]!.hudZusatz()], ['kz', 'hz']);
      } finally {
        console.error = alt;
      }
      const ersteMeldung = String(stumm[0]?.[0] ?? '');
      check('the default sink is console.error with the tool id', stumm.length > 0 && /\[werkzeuge\] tool "kaputt": /.test(ersteMeldung), ersteMeldung);
      check('the healthy tools reported nothing', stumm.every((m) => /tool "kaputt"/.test(String(m[0]))));
      // a healthy tool keeps its identity: absent optional members stay absent
      const sicherSee = reg.registriere(seeModul.erzeugeSee())[0]!;
      check('optional members the tool lacks stay absent (see: no double click, key, overlay)', sicherSee.beiDoppelklick === undefined && sicherSee.beiTaste === undefined && sicherSee.zeichneOverlay === undefined);
      check('…and the ones it has are there (river: double click, key, overlay)', (() => {
        const f = reg.registriere(flussModul.erzeugeFluss())[0]!;
        return typeof f.beiDoppelklick === 'function' && typeof f.beiTaste === 'function' && typeof f.zeichneOverlay === 'function' && typeof f.seitenleiste === 'function';
      })());
    }

    {
      // the real river tool next to a broken one: its overlay and its clicks still work
      const alt = console.error;
      const stumm: unknown[][] = [];
      console.error = (...a: unknown[]) => void stumm.push(a);
      try {
        const [fluss, kaputt] = reg.registriere(flussModul.erzeugeFluss(), attrappe('kaputt', true).w);
        const k = neuerKontext(leer, 'fluss');
        fluss.beiZeigerRunter(k.ctx, klick(0, 0));
        fluss.beiZeigerRunter(k.ctx, klick(400, 0));
        const zz = neuerZeichner();
        try {
          for (const w of [fluss, kaputt]) w.zeichneOverlay?.(k.ctx, zz as unknown as CanvasRenderingContext2D);
        } catch (e) {
          check('river next to a broken tool: no exception escapes the overlay loop', false, String((e as Error).message));
        }
        check('river overlay drawn although the next tool threw (1 lineTo, 1 stroke)', zz.log.filter((l) => l.startsWith('lineTo')).length === 1 && zz.log.filter((l) => l.startsWith('stroke')).length === 1, zz.log.join('|'));
        fluss.beiDoppelklick!(k.ctx);
        gleich('river still closes: 1 river, 1 undo step', [k.z.layout.rivers?.length, k.z.schritte.length], [1, 1]);
      } finally {
        console.error = alt;
      }
      check('exactly one report (the broken tool, its overlay), none for the river', stumm.length === 1 && /"kaputt": zeichneOverlay/.test(String(stumm[0]?.[0])), `${stumm.length} report(s)`);
    }
  } else {
    check('Fault isolation -- section could not run (registriere / schuetze missing)', false);
  }

  // ── Source guard ─────────────────────────────────────────────────
  console.log('Source guard');
  const haupt = readFileSync(resolve(EDITOR, 'editorMain.ts'), 'utf-8');
  const hud = readFileSync(resolve(EDITOR, 'KartenHud.ts'), 'utf-8');
  const vergleiche = haupt.match(/werkzeug\s*[!=]==\s*'(fluss|see)'/g) ?? [];
  gleich("editorMain.ts: no `werkzeug === 'fluss'` / `=== 'see'`", vergleiche, []);
  const zustand = haupt.match(/\b(flussPunkte|flussBreite|flussTiefe|seeRadius|seeTiefe|flussSchliessen)\b/g) ?? [];
  gleich('editorMain.ts: no river / lake state or close function left', zustand, []);
  check('editorMain.ts asks the registry', /from '\.\/werkzeuge'/.test(haupt) && /const registriert = werkzeugMitId\(werkzeug\);/.test(haupt) && /registriert\?\.beiZeigerRunter\(werkzeugKontext/.test(haupt));
  gleich("KartenHud.ts: no 'fluss' / 'see' key", hud.match(/^\s*(fluss|see):/gm) ?? [], []);
  const indexQuelle = (() => {
    try {
      return readFileSync(resolve(EDITOR, 'werkzeuge', 'index.ts'), 'utf-8');
    } catch {
      return '';
    }
  })();
  check('index.ts builds the list with registriere() (check + guard)', /registriere\(erzeugeFluss\(\), erzeugeSee\(\), erzeugePlatzieren\(\)\)/.test(indexQuelle) && /pruefeRegistrierung\(werkzeuge, ALTE_WERKZEUGE\)/.test(indexQuelle) && /schuetze\(w\)/.test(indexQuelle));
  check('KartenHud.ts takes its old names from ALTE_WERKZEUGE (one list)', /AltesWerkzeugname = \(typeof ALTE_WERKZEUGE\)\[number\]/.test(hud));
  for (const datei of ['index', 'fluss', 'see', 'platzieren', 'typ']) {
    check(`werkzeuge/${datei}.ts has no DOM access at module level`, (() => {
      try {
        const q = readFileSync(resolve(EDITOR, 'werkzeuge', `${datei}.ts`), 'utf-8');
        return !/^(document|window)\./m.test(q);
      } catch {
        return false;
      }
    })());
  }

  console.log(fehler === 0 ? '\nOK' : `\n${fehler} FAILED`);
  process.exit(fehler === 0 ? 0 : 1);
}

void main();
