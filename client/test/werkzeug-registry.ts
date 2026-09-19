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
import type { SeitenHost } from '../src/editor/werkzeuge/typ';

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

  if (reg && flussModul && seeModul && F) {
    gleich('registry holds exactly fluss, see (in toolbar order)', reg.WERKZEUGE.map((w) => w.id), ['fluss', 'see']);
    check('werkzeugMitId finds a registered tool', reg.werkzeugMitId('fluss')?.id === 'fluss' && reg.werkzeugMitId('see')?.id === 'see');
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
      gleich('lake is not a course: no double click, no key, no overlay', [see.beiDoppelklick, see.beiTaste, see.zeichneOverlay], [undefined, undefined, undefined]);
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

  // ── Source guard ─────────────────────────────────────────────────
  console.log('Source guard');
  const haupt = readFileSync(resolve(EDITOR, 'editorMain.ts'), 'utf-8');
  const hud = readFileSync(resolve(EDITOR, 'KartenHud.ts'), 'utf-8');
  const vergleiche = haupt.match(/werkzeug\s*[!=]==\s*'(fluss|see)'/g) ?? [];
  gleich("editorMain.ts: no `werkzeug === 'fluss'` / `=== 'see'`", vergleiche, []);
  const zustand = haupt.match(/\b(flussPunkte|flussBreite|flussTiefe|seeRadius|seeTiefe|flussSchliessen)\b/g) ?? [];
  gleich('editorMain.ts: no river / lake state or close function left', zustand, []);
  check('editorMain.ts asks the registry', /from '\.\/werkzeuge'/.test(haupt) && /werkzeugMitId\(werkzeug\)\?\.beiZeigerRunter/.test(haupt));
  gleich("KartenHud.ts: no 'fluss' / 'see' key", hud.match(/^\s*(fluss|see):/gm) ?? [], []);
  for (const datei of ['index', 'fluss', 'see', 'typ']) {
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
