/**
 * Test flight, place mode and drag threshold: while a prefab is chosen a click places
 * (grabbing needs Alt), a grab becomes a drag only past 4 px (8 px touch) and keeps its offset.
 * Testflug: Setzen-Modus und Ziehschwelle.
 *
 *  1. Placing 0.5 / 1 / 2 / 2.9 m beside an object with a prefab chosen: 1 new object, 0 moves.
 *  2. No prefab chosen: the click grabs. Alt + click with a prefab: grabs.
 *  3. Series on: three clicks = three objects. Series off: the second click grabs (the old way).
 *  4. Threshold: 3 px jitter = 0 Vorgaenge, no move; 5 px = one drag, one Vorgang, offset kept.
 *  5. The plain (offline) way stores the same bytes as on main.
 *  6. The stored series switch; Testflug.ts and SpawnPanel.ts use the new logic.
 *  7. Double click, judged on the SCREEN: within 400 ms and 5 px (10 px touch) places nothing, 6 px
 *     or 401 ms places again; key P / button / captured mouse block the same rounded cell for 400 ms.
 *  8. Grab offset against the VISIBLE place (a walking route NPC): < 0.1 m from the pointer.
 *
 * Run: npx tsx client/test/testflug-greifen.ts
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

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
console.warn = (): void => undefined;

const { localStoragePersistenz, ENTWURF_SCHLUESSEL } = await import('../src/editor/testflug/LocalStoragePersistenz');
const { TestflugAktionen } = await import('../src/editor/testflug/TestflugAktionen');
const greifen = await import('../src/editor/testflug/greifen');
const { entscheideKlick, modusNachSetzen, Ziehgriff, ladeSerie, speichereSerie, SERIE_SCHLUESSEL, DoppelklickSperre, griffPosition } = greifen;

const KUH = 'kuh_20_20-c3d4';
const BUCHE = 'beech1_10_10-a1b2';
const START = () => ({
  name: 'k53',
  version: 1,
  eigenesFeld: 7,
  placements: [
    { id: BUCHE, prefab: 'Beech1', x: 10, z: 10, yaw: 1.5 },
    { id: KUH, prefab: 'Kuh', x: 20, z: 20, scale: 1.2, npc: { name: 'Bessie' } },
    { id: 'haus_30_30-e5f6', prefab: 'Haus', x: 30, z: 30, einebnen: 12 },
  ],
});
const setzeStart = (): void => void speicher.set(ENTWURF_SCHLUESSEL, JSON.stringify(START()));
const frisch = () => {
  setzeStart();
  const p = localStoragePersistenz();
  return { p, a: new TestflugAktionen(p) };
};
type Punkt = { x: number; z: number };
const liste = (p: ReturnType<typeof localStoragePersistenz>): Punkt[] => (p.laden()!.placements ?? []) as Punkt[];
const verschiebungen = (p: ReturnType<typeof localStoragePersistenz>): number =>
  p.protokoll().filter((v) => v.ops.some((o) => o.art === 'aendere')).length;

/** One left click as the test flight handles it: decide, then place or grab. */
let zaehler = 0;
function klick(z: ReturnType<typeof frisch>, punkt: Punkt, o: { setzenModus: boolean; alt?: boolean }) {
  const ent = entscheideKlick({ setzenModus: o.setzenModus, alt: o.alt ?? false, punkt, platzierungen: liste(z.p) });
  if (ent.art === 'setzen') {
    const id = `neu_${++zaehler}-abcd`;
    z.a.setzen({ id, prefab: 'Tanne', x: punkt.x, z: punkt.z, yaw: 0 });
  }
  return ent;
}

console.log('testflug-greifen');

// ── 1. place beside an object, prefab chosen ────────────────────────
for (const abstand of [0.5, 1, 2, 2.9]) {
  const z = frisch();
  const vorher = liste(z.p).length;
  const ent = klick(z, { x: 10 + abstand, z: 10 }, { setzenModus: true });
  pruefe(ent.art === 'setzen', `place mode ${abstand} m beside: decision ${ent.art}`);
  pruefe(liste(z.p).length === vorher + 1, `place mode ${abstand} m: ${liste(z.p).length - vorher} new objects, expected 1`);
  pruefe(verschiebungen(z.p) === 0, `place mode ${abstand} m: ${verschiebungen(z.p)} moves, expected 0`);
  const buche = liste(z.p).find((e) => (e as { id?: string }).id === BUCHE)!;
  pruefe(buche.x === 10 && buche.z === 10, `place mode ${abstand} m: the neighbour stayed at 10/10`);
  // the same point without a chosen prefab grabs (unchanged)
  const ohne = entscheideKlick({ setzenModus: false, alt: false, punkt: { x: 10 + abstand, z: 10 }, platzierungen: liste(z.p) });
  pruefe(ohne.art === 'greifen', `no prefab ${abstand} m beside: decision ${ohne.art}, expected greifen`);
}
{
  const z = frisch();
  pruefe(klick(z, { x: 13, z: 10 }, { setzenModus: false }).art === 'nichts', 'no prefab, exactly 3.0 m away: nothing (radius is exclusive, as before)');
  pruefe(klick(z, { x: 12.99, z: 10 }, { setzenModus: false }).art === 'greifen', 'no prefab, 2.99 m: grabs');
  pruefe(klick(z, { x: 10, z: 12 }, { setzenModus: false, alt: true }).art === 'greifen', 'Alt without a prefab still grabs');
  pruefe(klick(z, { x: 40, z: 40 }, { setzenModus: false }).art === 'nichts', 'no prefab far from everything: nothing');
}

// ── 2. no prefab and Alt ────────────────────────────────────────────
{
  const z = frisch();
  const e1 = klick(z, { x: 11, z: 10 }, { setzenModus: false });
  pruefe(e1.art === 'greifen' && e1.index === 0, 'no prefab: the click grabs the beech (index 0)');
  const e2 = klick(z, { x: 11, z: 10 }, { setzenModus: true, alt: true });
  pruefe(e2.art === 'greifen' && e2.index === 0, 'Alt + click with a prefab: grabs');
  pruefe(liste(z.p).length === 3, 'grabbing places nothing');
  const e3 = klick(z, { x: 25, z: 25 }, { setzenModus: true, alt: true });
  pruefe(e3.art === 'setzen', 'Alt + click on free ground with a prefab: places as before');
  // an entry without id no longer blocks placing beside it (the decision does not look at ids)
  const e4 = entscheideKlick({ setzenModus: true, alt: false, punkt: { x: 1, z: 1 }, platzierungen: [{ x: 1.2, z: 1 }] });
  pruefe(e4.art === 'setzen', 'place mode beside an entry: places');
}

// ── 3. series ───────────────────────────────────────────────────────
{
  const z = frisch();
  let modus = true;
  const serie = true;
  for (let i = 0; i < 3; i++) {
    if (klick(z, { x: 50 + i, z: 50 }, { setzenModus: modus }).art === 'setzen') modus = modusNachSetzen(serie);
  }
  pruefe(liste(z.p).length === 3 + 3, `series on: three clicks 1 m apart = ${liste(z.p).length - 3} new objects, expected 3`);
  pruefe(modus === true, 'series on: the mode stays on');
  pruefe(verschiebungen(z.p) === 0, 'series on: 0 moves');
}
{
  const z = frisch();
  let modus = true;
  const e1 = klick(z, { x: 50, z: 50 }, { setzenModus: modus });
  if (e1.art === 'setzen') modus = modusNachSetzen(false);
  const e2 = klick(z, { x: 51, z: 50 }, { setzenModus: modus });
  pruefe(e1.art === 'setzen' && modus === false, 'series off: the first click places and ends the mode');
  pruefe(e2.art === 'greifen', `series off: the second click 1 m beside grabs like before, got ${e2.art}`);
  pruefe(liste(z.p).length === 4, 'series off: only one new object');
}

// ── 4. drag threshold ───────────────────────────────────────────────
/** Pointer path as Testflug.ts handles it: only a non-null result moves the object. */
function zieh(z: ReturnType<typeof frisch>, id: string, art: string, wege: Array<[number, number, number, number]>) {
  const q = liste(z.p).find((e) => (e as { id?: string }).id === id)!;
  const start: Punkt = { x: q.x + 0.4, z: q.z - 0.3 }; // the mouse point beside the centre
  const griff = new Ziehgriff(id, { x: 100, y: 100 }, start, q, art);
  const versaetze: number[] = [];
  for (const [mx, my, dx, dz] of wege) {
    const punkt = { x: start.x + dx, z: start.z + dz };
    const ziel = griff.bewege({ x: mx, y: my }, punkt);
    if (!ziel) continue;
    z.a.verschieben(id, ziel.x, ziel.z);
    versaetze.push(Math.hypot(ziel.x - punkt.x, ziel.z - punkt.z));
  }
  const ende = griff.istGezogen ? z.a.abschliessen() : null;
  return { griff, ende, versaetze, start };
}
{
  const z = frisch();
  const roh0 = z.p.rohtext!();
  const n0 = z.p.protokoll().length;
  const r = zieh(z, KUH, 'mouse', [[101, 101, 0.05, 0.05], [102, 102, 0.1, 0.1], [103, 100, 0.15, 0], [100, 103, 0, 0.15], [102, 101, 0.1, 0.05]]);
  pruefe(!r.griff.istGezogen && r.ende === null, '3 px jitter is no drag');
  pruefe(z.p.protokoll().length === n0, `3 px jitter: ${z.p.protokoll().length - n0} Vorgaenge, expected 0`);
  pruefe(z.p.rohtext!() === roh0, '3 px jitter: the draft is unchanged byte for byte');
  const exakt = zieh(frisch(), KUH, 'mouse', [[104, 100, 0.2, 0]]);
  pruefe(!exakt.griff.istGezogen, 'exactly 4 px is still a click ("more than 4 px" drags)');
}
{
  const z = frisch();
  const n0 = z.p.protokoll().length;
  const r = zieh(z, KUH, 'mouse', [[103, 100, 0.1, 0], [105, 100, 0.5, 0.2], [106, 101, 1.0, 0.4], [110, 104, 2.0, 0.8], [120, 110, 3.0, 1.5]]);
  pruefe(r.griff.istGezogen && r.ende !== null, '5 px and more: a drag');
  pruefe(z.p.protokoll().length === n0 + 1, `5 px drag: ${z.p.protokoll().length - n0} Vorgaenge, expected exactly 1`);
  const kuh = liste(z.p).find((e) => (e as { id?: string }).id === KUH)!;
  pruefe(Math.abs(kuh.x - 23) < 1e-9 && Math.abs(kuh.z - 21.5) < 1e-9, `the object followed the mouse by its offset, at ${kuh.x}/${kuh.z}`);
  pruefe(r.versaetze.length === 4 && r.versaetze.every((v) => Math.abs(v - r.versaetze[0]!) < 0.001), `grab offset kept to 1 mm over ${r.versaetze.length} frames: ${r.versaetze.map((v) => v.toFixed(4)).join(' ')}`);
  pruefe(Math.abs(r.versaetze[0]! - Math.hypot(0.4, 0.3)) < 0.001, 'the offset is the one from the grab (0.5 m), the centre did not jump onto the mouse');
}
{
  const t = zieh(frisch(), KUH, 'touch', [[105, 100, 0.2, 0], [107, 101, 0.3, 0]]);
  pruefe(!t.griff.istGezogen, 'touch: 5-7 px is no drag');
  const t2 = zieh(frisch(), KUH, 'touch', [[109, 100, 0.5, 0]]);
  pruefe(t2.griff.istGezogen && t2.ende !== null, 'touch: 9 px drags');
  const s = zieh(frisch(), KUH, 'pen', [[106, 100, 0.2, 0]]);
  pruefe(!s.griff.istGezogen, 'pen counts like touch (8 px)');
}

// ── 5. offline bytes as on main ─────────────────────────────────────
{
  setzeStart();
  const p = localStoragePersistenz();
  const a = new TestflugAktionen(p);
  a.setzen({ id: 'tanne_5_5-g7h8', prefab: 'Tanne', x: 5, z: 5, yaw: 0.25 });
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
  const hash = createHash('sha256').update(text).digest('hex');
  console.log(`  LANGE-FOLGE bytes=${Buffer.byteLength(text)} sha256=${hash}`);
  pruefe(Buffer.byteLength(text) === 364, `long sequence: ${Buffer.byteLength(text)} bytes, expected 364 as on main`);
  pruefe(hash === 'ac47c755f4f1f4875cde9892895f514b64d89bdeabcdc73c739ec010ac74146f', 'long sequence: sha256 as on main');
}

// ── 6. the stored switch; the wiring ────────────────────────────────
{
  const mem = new Map<string, string>();
  const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  pruefe(ladeSerie(st) === true, 'series defaults to ON with an empty store');
  speichereSerie(false, st);
  pruefe(mem.get(SERIE_SCHLUESSEL) === '0' && ladeSerie(st) === false, 'series OFF is stored and read back');
  speichereSerie(true, st);
  pruefe(ladeSerie(st) === true, 'series ON is stored and read back');
  const kaputt = {
    getItem: (): string | null => {
      throw new Error('blocked');
    },
    setItem: (): void => {
      throw new Error('blocked');
    },
  };
  pruefe(ladeSerie(kaputt) === true, 'a store that throws on read gives the default (ON)');
  let warf = false;
  try {
    speichereSerie(false, kaputt);
  } catch {
    warf = true;
  }
  pruefe(!warf, 'a store that throws on write does not throw out');
  pruefe(ladeSerie(undefined) === true || ladeSerie(undefined) === false, 'no store at all does not throw');
}
{
  const testflug = readFileSync(new URL('../src/editor/testflug/Testflug.ts', import.meta.url), 'utf-8');
  const panel = readFileSync(new URL('../src/editor/SpawnPanel.ts', import.meta.url), 'utf-8');
  pruefe(/entscheideKlick\(\{/.test(testflug) && !/bestD/.test(testflug), 'Testflug.ts decides the click via entscheideKlick (no own radius loop)');
  pruefe(/alt: e\.altKey/.test(testflug), 'Testflug.ts passes the Alt key');
  pruefe(/new Ziehgriff\(/.test(testflug) && /griff\?\.bewege\(/.test(testflug), 'Testflug.ts drags only through Ziehgriff');
  pruefe(/modusNachSetzen\(panel\.einstellung\.serie\)/.test(testflug), 'Testflug.ts ends the mode after placing only without series');
  pruefe(/serie: ladeSerie\(\)/.test(panel) && /speichereSerie\(/.test(panel), 'SpawnPanel has the stored series switch');
  pruefe(/serie\.blur\(\)/.test(panel), 'the series tick gives up its focus (space no longer toggles it)');
  pruefe(/doppelSperre\.blockiert\(jetzt, bild, e\.pointerType/.test(testflug) && /doppelSperre\.gesetzt\(/.test(testflug), 'Testflug.ts blocks the double click on the screen');
  pruefe(!/e\.detail/.test(testflug.slice(testflug.indexOf("addEventListener('pointerdown'"), testflug.indexOf("addEventListener('pointerdown'") + 6000)), 'pointerdown does not read the always-0 detail');
  pruefe(/KeyP' && !e\.repeat/.test(testflug), 'key P ignores auto-repeat');
  pruefe(/doppelSperre\.blockiertZelle\(/.test(testflug.slice(testflug.indexOf('const platziere = '), testflug.indexOf('kontext.setzeSpawnEditorOffen'))), 'platziere() blocks the same cell');
  pruefe(/griffPosition\(vorschau\.positionVon\(best\), q\)/.test(testflug), 'Testflug.ts measures the grab offset at the visible place');
  const platzBlock = testflug.slice(testflug.indexOf('const platziere = '), testflug.indexOf('kontext.setzeSpawnEditorOffen'));
  pruefe(/modusNachSetzen\(panel\.einstellung\.serie\)/.test(platzBlock) && !/^\s*panel\.beendePlatzierModus\(\);/m.test(platzBlock), 'key P / captured-mouse click keep the mode with series');
}

// ── 7. double click ─────────────────────────────────────────────────
/** Clicks as the handler runs them: block check on the screen, then place. `x`/`z` are the world point, `px`/`py` the screen point. */
type Kl = { t: number; x: number; z: number; px: number; py: number; typ?: string };
function klickFolge(folge: Kl[]): number {
  const z = frisch();
  const sperre = new DoppelklickSperre();
  const vorher = liste(z.p).length;
  for (const k of folge) {
    const punkt = { x: k.x, z: k.z };
    if (sperre.blockiert(k.t, { x: k.px, z: k.py }, k.typ)) continue;
    if (klick(z, punkt, { setzenModus: true }).art === 'setzen') {
      sperre.gesetzt(k.t, { x: Math.round(k.x * 10) / 10, z: Math.round(k.z * 10) / 10 }, { x: k.px, z: k.py });
    }
  }
  return liste(z.p).length - vorher;
}
const K = (t: number, px: number, py: number, x = 50, z = 50, typ?: string): Kl => ({ t, x, z, px, py, typ });
// 1 px / 4 px jitter at 20 m: the world point moves 0.14 m per px, the screen point decides.
pruefe(klickFolge([K(1000, 400, 300, 50, 50), K(1120, 400, 301, 50, 50.14)]) === 1, '1 px jitter at 20 m (0.14 m) = 1 object');
pruefe(klickFolge([K(1000, 400, 300, 50, 50), K(1120, 402, 303, 50.3, 50.56)]) === 1, '3+4 px diagonal (5 px) jitter at 20 m = 1 object');
pruefe(klickFolge([K(1000, 400, 300), K(1120, 400, 304, 50, 50.56)]) === 1, '4 px jitter at 20 m (0.56 m) = 1 object');
pruefe(klickFolge([K(1000, 400, 300), K(1120, 406, 300, 50.3, 50)]) === 2, '6 px apart = 2 objects');
pruefe(klickFolge([K(1000, 400, 300), K(1401, 400, 300)]) === 2, '401 ms later on the same pixel = 2 objects');
pruefe(klickFolge([K(1000, 400, 300), K(1400, 400, 300)]) === 1, 'exactly 400 ms on the same pixel = 1 object');
pruefe(klickFolge([K(1000, 400, 300, 50, 50, 'touch'), K(1120, 408, 300, 50, 50, 'touch')]) === 1, 'touch: 8 px = 1 object');
pruefe(klickFolge([K(1000, 400, 300, 50, 50, 'touch'), K(1120, 411, 300, 50, 50, 'touch')]) === 2, 'touch: 11 px = 2 objects');
pruefe(klickFolge([K(1000, 400, 300), K(1120, 408, 300)]) === 2, 'mouse: 8 px = 2 objects (the mouse limit is 5 px)');
// series placing: 0.15 m steps every 100 ms with the pixels apart are NOT blocked
pruefe(klickFolge([0, 1, 2, 3, 4].map((i) => K(1000 + i * 100, 400 + i * 12, 300, 50 + i * 0.15, 50))) === 5, 'series 0.15 m / 100 ms with pixels apart = 5 objects');
pruefe(klickFolge([K(1000, 400, 300), K(1120, 400, 300), K(1900, 400, 300)]) === 2, 'a blocked click does not extend the window: the click after 900 ms places');

// key P / button / captured mouse: the same rounded cell within 400 ms is one placement
{
  const s = new DoppelklickSperre();
  const zelle = { x: 10, z: 15 };
  pruefe(!s.blockiertZelle(0, zelle), 'P: first press places');
  s.gesetzt(0, zelle);
  let gesperrt = 0;
  for (let t = 50; t <= 1500; t += 50) if (s.blockiertZelle(t, zelle) && t <= 400) gesperrt++;
  pruefe(gesperrt === 8, 'P: presses in the same cell within 400 ms are blocked');
  pruefe(s.blockiertZelle(400, zelle) && !s.blockiertZelle(401, zelle), 'P: 400 ms blocks, 401 ms places');
  pruefe(!s.blockiertZelle(100, { x: 11, z: 15 }), 'P: another grid cell places at once');
  pruefe(s.blockiertZelle(100, { x: 10, z: 15 }), 'P: the same cell is blocked');
  const nur = new DoppelklickSperre();
  nur.gesetzt(0, zelle);
  pruefe(!nur.blockiert(100, { x: 1, z: 1 }), 'no screen point stored (P): a click is not blocked by the pixel rule');
}

// ── 8. grab offset against the visible place ────────────────────────
{
  const z = frisch();
  const gespeichert = liste(z.p).find((e) => (e as { id?: string }).id === KUH)!;
  const sichtbar = { x: 40, z: 20 }; // the route NPC walked 20 m away from its entry
  const start: Punkt = { x: 40.5, z: 20 }; // mouse 0.5 m beside the visible figure
  const griff = new Ziehgriff(KUH, { x: 100, y: 100 }, start, griffPosition(sichtbar, gespeichert), 'mouse');
  const maus: Punkt = { x: 60, z: 25 };
  const ziel = griff.bewege({ x: 110, y: 100 }, maus)!;
  const abstand = Math.hypot(ziel.x - maus.x, ziel.z - maus.z);
  pruefe(abstand < 0.1 + 0.5, `route NPC stays at the pointer (offset ${abstand.toFixed(3)} m, the 0.5 m grab offset)`);
  pruefe(Math.abs(abstand - 0.5) < 0.001, 'the offset is the 0.5 m of the grab, not 20.5 m');
  const alt = new Ziehgriff(KUH, { x: 100, y: 100 }, start, gespeichert, 'mouse').bewege({ x: 110, y: 100 }, maus)!;
  pruefe(Math.hypot(alt.x - maus.x, alt.z - maus.z) > 20, 'against the stored entry it would be 20 m off (the old fault)');
  pruefe(griffPosition(undefined, gespeichert) === gespeichert, 'without a preview the stored entry counts');
}

if (fehler > 0) {
  console.log(`\n${fehler} failure(s) of ${geprueft} checks`);
  process.exit(1);
}
console.log(`\nPlace mode and drag threshold (${geprueft} checks).`);
