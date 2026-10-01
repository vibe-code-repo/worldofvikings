/**
 * Remove vegetation V3, the brush of the terrain tab: core, draft actions, undo/redo, wiring. DOM-free, no browser/assets/GPU.
 * Entfernen V3, der Bewuchs-Pinsel des Gelände-Reiters: Kern, Entwurfsaktionen, Verlauf, Verdrahtung.
 *
 *  1. A stroke lays circles half a radius apart (also across a pointer jump) and writes them as ONE write and ONE undo step.
 *  2. Covering: a circle that an existing circle of the same kind covers completely is not laid (no growth when painting over).
 *  3. `nur`: the switch "trees only" sets `nur: 'baeume'`; without it the field is absent (everything scattered).
 *  4. Limit 4096: nothing is laid beyond it, the HUD says so, the draft never holds more.
 *  5. Undo / redo: exactly the circles of the stroke leave and come back (bit-equal); a foreign change refuses and says so.
 *  6. An open stroke: undo does nothing, `beenden` finishes it, the preview sees its circles through `strichKreise`/`stand`.
 *  7. Draft unusable (damaged field, no draft): the brush stays locked and says why.
 *  8. Wiring in the source, texts de/en, keys and text fields.
 *
 * Run: npx tsx client/test/vegetation-pinsel.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VEGETATION_KREISE_MAX, type VegetationEntferntKreis } from '@wov/shared';
import { abgedeckt, stempelEntlang, vegStempelAbstand, VegetationStrich } from '../src/editor/testflug/vegetationPinsel';
import { VegetationVerlauf, VEG_VERLAUF_MAX } from '../src/editor/testflug/vegetationVerlauf';
import { VegetationAktionen, vegetationKreiseAusEntwurf } from '../src/editor/testflug/vegetationAktionen';
import { VegetationSteuerung } from '../src/editor/testflug/vegetationSteuerung';
import type { EntwurfDokument } from '../src/editor/testflug/TestflugPersistenz';
import { verlaufEntscheid } from '../src/editor/testflug/gelaendePinsel';
import { t } from '../src/editor/i18n';

const HIER = dirname(fileURLToPath(import.meta.url));
let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FAIL: ${text}`);
  }
};

type Kreis = VegetationEntferntKreis;

/** A draft in memory, counting its writes like the real persistence does. */
function entwurf(start: Record<string, unknown> = { placements: [] }) {
  let dok: Record<string, unknown> = structuredClone(start);
  const s = {
    schreibungen: 0,
    laden: (): EntwurfDokument | null => structuredClone(dok) as EntwurfDokument,
    aendern: (d: EntwurfDokument): void => {
      dok = structuredClone(d) as Record<string, unknown>;
      s.schreibungen++;
    },
    rohtext: (): string => JSON.stringify(dok),
    kreise: (): Kreis[] => ((dok.vegetationEntfernt as Kreis[] | undefined) ?? []).map((k) => ({ ...k })),
    roh: (): Record<string, unknown> => dok,
    setzeFremd: (neu: Record<string, unknown>): void => void (dok = structuredClone(neu)),
  };
  return s;
}

function aufbau(start?: Record<string, unknown>, einst: { radius: number; nurBaeume: boolean } = { radius: 10, nurBaeume: false }) {
  const e = entwurf(start);
  const meldungen: string[] = [];
  const kreisAufrufe: Array<{ x: number; z: number; r: number; gesperrt: boolean }> = [];
  let versteckt = 0;
  const aktionen = new VegetationAktionen(e);
  const steuerung = new VegetationSteuerung({
    aktionen,
    einstellung: () => einst,
    meldung: (m) => void meldungen.push(m),
    kreis: { zeige: (x, z, r, gesperrt) => void kreisAufrufe.push({ x, z, r, gesperrt }), verberge: () => void versteckt++ },
  });
  return { e, einst, meldungen, kreisAufrufe, steuerung, aktionen, versteckt: () => versteckt };
}

/** A stroke along a line, in many small pointer events. */
function ziehe(a: ReturnType<typeof aufbau>, von: [number, number], bis: [number, number], schritte = 40): void {
  a.steuerung.druecken({ x: von[0], z: von[1] });
  for (let i = 1; i <= schritte; i++) a.steuerung.bewegen({ x: von[0] + ((bis[0] - von[0]) * i) / schritte, z: von[1] + ((bis[1] - von[1]) * i) / schritte });
  a.steuerung.loslassen();
}

// ── 1. Strich ────────────────────────────────────────────────────────────────
{
  const a = aufbau();
  ziehe(a, [0, 0], [100, 0]);
  const k = a.e.kreise();
  // radius 10 → stamp every 5 m → 0, 5, …, 100 = 21 circles
  pruefe(k.length === 21, `1: Strich über 100 m mit Radius 10 legt 21 Kreise (${k.length})`);
  const abst = k.slice(1).map((c, i) => Math.hypot(c.x - k[i]!.x, c.z - k[i]!.z));
  pruefe(abst.every((d) => Math.abs(d - 5) < 0.02), `1: Stempelabstand = Radius/2 = 5 m (min ${Math.min(...abst).toFixed(3)}, max ${Math.max(...abst).toFixed(3)})`);
  pruefe(k.every((c) => c.r === 10 && !('nur' in c)), '1: jeder Kreis hat Radius 10 und kein `nur`');
  pruefe(a.e.schreibungen === 1, `1: der ganze Strich ist EIN Schreibvorgang (${a.e.schreibungen})`);
  pruefe(a.steuerung.rueckgaengig() && a.e.kreise().length === 0 && a.e.schreibungen === 2, '1: EIN Rückgängig nimmt alle 21 Kreise weg');
  pruefe(a.e.roh().vegetationEntfernt === undefined, '1: eine leere Liste lässt das Feld ganz weg (Dokument wie vorher)');

  // Pointer jumps: the line is filled in, no gap
  const b = aufbau();
  b.steuerung.druecken({ x: 0, z: 0 });
  b.steuerung.bewegen({ x: 100, z: 0 });
  b.steuerung.loslassen();
  pruefe(b.e.kreise().length === 21, `1: ein einziger Zeigersprung über 100 m füllt die Linie auf (${b.e.kreise().length} Kreise)`);
  // A click without moving: one circle
  const c = aufbau();
  c.steuerung.druecken({ x: 7.126, z: -3.504 });
  c.steuerung.loslassen();
  pruefe(c.e.kreise().length === 1 && c.e.kreise()[0]!.x === 7.13 && c.e.kreise()[0]!.z === -3.5, `1: ein Klick = ein Kreis, auf den cm gerundet (${JSON.stringify(c.e.kreise())})`);
  // Spacing core
  const e = stempelEntlang({ x: 0, z: 0 }, { x: 3, z: 0 }, 5);
  pruefe(e.length === 0, '1: Weg kürzer als der Abstand: kein Stempel');
  pruefe(vegStempelAbstand(10) === 5 && vegStempelAbstand(0.5) === 0.25, '1: Abstand = Radius/2');
  pruefe(vegStempelAbstand(500) === 25 && vegStempelAbstand(0.01) === 0.25, '1: Radius wird auf 0,5…50 m geklemmt (Grenzen aus V1)');
  // Radius changes during a stroke
  const d = aufbau();
  d.steuerung.druecken({ x: 0, z: 0 });
  d.einst.radius = 20;
  d.steuerung.bewegen({ x: 50, z: 0 });
  d.steuerung.loslassen();
  const kd = d.e.kreise();
  pruefe(kd[0]!.r === 10 && kd.slice(1).every((c2) => c2.r === 20), '1: der Radius gilt je Stempel');
  pruefe(d.kreisAufrufe.length > 0 && d.kreisAufrufe.at(-1)!.r === 20 && d.kreisAufrufe.every((x) => !x.gesperrt), '1: der Pinselkreis wird mit dem Radius gezeigt (grün)');
}

// ── 2. Abdeckung ─────────────────────────────────────────────────────────────
{
  pruefe(abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 3, z: 0, r: 7 }), '2: Kreis liegt ganz im vorhandenen (Rand berührt): abgedeckt');
  pruefe(!abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 3, z: 0, r: 7.5 }), '2: ragt 0,5 m heraus: nicht abgedeckt');
  pruefe(!abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 0, z: 0, r: 12 }), '2: größerer Kreis: nicht abgedeckt');
  pruefe(abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 0, z: 0, r: 10 }), '2: derselbe Kreis: abgedeckt');
  pruefe(!abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 0, z: 0, r: 5, nur: 'baeume' }), '2: ein Kreis für alles deckt einen Nur-Bäume-Kreis NICHT (andere Wirkung)');
  pruefe(!abgedeckt([{ x: 0, z: 0, r: 10, nur: 'baeume' }], { x: 0, z: 0, r: 5 }), '2: ein Nur-Bäume-Kreis deckt einen Kreis für alles nicht');
  pruefe(abgedeckt([{ x: 0, z: 0, r: 10, nur: 'baeume' }], { x: 1, z: 0, r: 5, nur: 'baeume' }), '2: gleiche Wirkung (nur Bäume): abgedeckt');

  const a = aufbau();
  ziehe(a, [0, 0], [60, 0]);
  const n1 = a.e.kreise().length;
  const s1 = a.e.schreibungen;
  ziehe(a, [0, 0], [60, 0]);
  pruefe(a.e.kreise().length === n1 && a.e.schreibungen === s1, `2: derselbe Strich noch einmal: keine neuen Kreise, kein Schreibvorgang (${n1} → ${a.e.kreise().length})`);
  ziehe(a, [10, 0], [50, 0]);
  pruefe(a.e.kreise().length === n1 && a.e.schreibungen === s1, '2: ein Strich mitten im bemalten Streifen: nichts Neues');
  pruefe(a.steuerung.rueckgaengig() && a.e.kreise().length === 0, '2: der abgedeckte Strich hat keinen eigenen Schritt: ein Rückgängig nimmt den ersten Strich ganz zurück');
  // Inside one stroke: back and forth over itself
  const b = aufbau();
  ziehe(b, [0, 0], [40, 0]);
  const nb = b.e.kreise().length;
  b.steuerung.druecken({ x: 0, z: 0 });
  for (let i = 0; i < 3; i++) {
    b.steuerung.bewegen({ x: 40, z: 0 });
    b.steuerung.bewegen({ x: 0, z: 0 });
  }
  b.steuerung.loslassen();
  pruefe(b.e.kreise().length === nb, `2: hin und her über denselben Weg wächst die Liste nicht (${nb})`);
  // Bigger brush on top adds; smaller one does not
  const c = aufbau(undefined, { radius: 10, nurBaeume: false });
  ziehe(c, [0, 0], [40, 0]);
  const nc = c.e.kreise().length;
  c.einst.radius = 4;
  ziehe(c, [5, 0], [35, 0]);
  pruefe(c.e.kreise().length === nc, '2: kleinerer Pinsel im bemalten Streifen: nichts Neues');
  c.einst.radius = 20;
  ziehe(c, [5, 0], [35, 0]);
  pruefe(c.e.kreise().length > nc, '2: größerer Pinsel: neue Kreise');
  // Trees-only on top of "everything": not covered (different effect), laid
  const d = aufbau();
  ziehe(d, [0, 0], [40, 0]);
  const nd = d.e.kreise().length;
  d.einst.nurBaeume = true;
  ziehe(d, [0, 0], [40, 0]);
  pruefe(d.e.kreise().length === 2 * nd - 0 || d.e.kreise().length > nd, `2: derselbe Weg mit „nur Bäume“ legt eigene Kreise (${nd} → ${d.e.kreise().length})`);
}

// ── 3. nur ───────────────────────────────────────────────────────────────────
{
  const a = aufbau(undefined, { radius: 8, nurBaeume: true });
  ziehe(a, [0, 0], [30, 10]);
  const k = a.e.kreise();
  pruefe(k.length > 3 && k.every((c) => c.nur === 'baeume'), `3: Schalter an: jeder Kreis trägt nur: 'baeume' (${k.length} Kreise)`);
  const b = aufbau(undefined, { radius: 8, nurBaeume: false });
  ziehe(b, [0, 0], [30, 10]);
  pruefe(b.e.kreise().length > 3 && b.e.kreise().every((c) => !('nur' in c)), '3: Schalter aus: kein Kreis trägt `nur` (alles Gestreute)');
  // Switch flipped in the middle of a stroke
  const c = aufbau(undefined, { radius: 8, nurBaeume: false });
  c.steuerung.druecken({ x: 0, z: 0 });
  c.einst.nurBaeume = true;
  c.steuerung.bewegen({ x: 40, z: 0 });
  c.steuerung.loslassen();
  const kc = c.e.kreise();
  pruefe(!('nur' in kc[0]!) && kc.slice(1).every((x) => x.nur === 'baeume'), '3: der Schalter gilt je Stempel');
}

// ── 4. Grenze ────────────────────────────────────────────────────────────────
{
  const viele = (n: number): Kreis[] => Array.from({ length: n }, (_, i) => ({ x: -30000 + (i % 100) * 20, z: -30000 + Math.floor(i / 100) * 20, r: 2 }));
  const a = aufbau({ placements: [], vegetationEntfernt: viele(VEGETATION_KREISE_MAX - 5) });
  ziehe(a, [0, 0], [200, 0], 200);
  pruefe(a.e.kreise().length === VEGETATION_KREISE_MAX, `4: es wird bis zur Grenze gemalt, nicht darüber (${a.e.kreise().length} von ${VEGETATION_KREISE_MAX})`);
  const grenzText = t('testflug.gelaende.vegetation.grenze', { max: VEGETATION_KREISE_MAX });
  pruefe(a.meldungen.filter((m) => m === grenzText).length === 1, `4: der Hinweis erscheint genau einmal je Strich (${a.meldungen.filter((m) => m === grenzText).length}×)`);
  pruefe(a.meldungen.at(-1) !== undefined && a.meldungen.some((m) => m.includes('4096')), '4: der Hinweis nennt die Zahl 4096');
  pruefe(a.kreisAufrufe.at(-1)!.gesperrt === true, '4: der Pinselkreis wird bei erreichter Grenze rot');
  pruefe(a.e.kreise().slice(0, VEGETATION_KREISE_MAX - 5).length === VEGETATION_KREISE_MAX - 5, '4: die alten Kreise bleiben unverändert stehen');
  const vorher = a.e.schreibungen;
  ziehe(a, [500, 500], [600, 500]);
  pruefe(a.e.schreibungen === vorher && a.e.kreise().length === VEGETATION_KREISE_MAX, '4: bei voller Liste schreibt ein neuer Strich nichts, ohne still zu bleiben');
  pruefe(a.meldungen.filter((m) => m === grenzText).length === 2, '4: … er sagt es wieder');
  // A covered stamp over a full list says nothing (nothing would be lost)
  const b = aufbau({ placements: [], vegetationEntfernt: [...viele(VEGETATION_KREISE_MAX - 1), { x: 0, z: 0, r: 20 }] });
  b.steuerung.druecken({ x: 0, z: 0 });
  b.steuerung.loslassen();
  pruefe(b.meldungen.every((m) => m !== grenzText), '4: ein abgedeckter Stempel bei voller Liste meldet die Grenze nicht');
  // Undo makes room
  pruefe(a.steuerung.rueckgaengig() && a.e.kreise().length === VEGETATION_KREISE_MAX - 5, '4: Rückgängig schafft wieder Platz');
  // The write path itself refuses over the limit (another tab filled the list during the stroke)
  const c = aufbau();
  c.steuerung.druecken({ x: 0, z: 0 });
  c.steuerung.bewegen({ x: 20, z: 0 });
  c.e.setzeFremd({ placements: [], vegetationEntfernt: viele(VEGETATION_KREISE_MAX - 1) });
  c.steuerung.loslassen();
  pruefe(c.e.kreise().length === VEGETATION_KREISE_MAX - 1 && c.meldungen.some((m) => m === grenzText), '4: ein Strich, der beim Schreiben nicht mehr passt, wird mit Hinweis abgelehnt, der Entwurf bleibt');
}

// ── 5. Rückgängig / Wiederholen ──────────────────────────────────────────────
{
  const a = aufbau();
  ziehe(a, [0, 0], [30, 0]);
  const nachEins = a.e.kreise();
  ziehe(a, [0, 40], [30, 40]);
  const nachZwei = a.e.kreise();
  pruefe(nachZwei.length > nachEins.length && a.steuerung.rueckgaengig(), '5: Strg+Z nimmt den zweiten Strich');
  pruefe(JSON.stringify(a.e.kreise()) === JSON.stringify(nachEins), '5: danach steht die Liste bitgleich wie nach dem ersten Strich');
  pruefe(a.steuerung.wiederholen() && JSON.stringify(a.e.kreise()) === JSON.stringify(nachZwei), '5: Wiederholen bringt den zweiten Strich bitgleich zurück');
  pruefe(a.steuerung.rueckgaengig() && a.steuerung.rueckgaengig() && a.e.kreise().length === 0, '5: zweimal Rückgängig: leer');
  const vorher = a.e.schreibungen;
  pruefe(!a.steuerung.rueckgaengig() && a.e.schreibungen === vorher, '5: nichts mehr zurückzunehmen: false, kein Schreibvorgang');
  pruefe(a.meldungen.at(-1) === t('testflug.gelaende.nichts_rueckgaengig'), '5: … mit Hinweis');
  pruefe(a.steuerung.wiederholen() && a.steuerung.wiederholen() && JSON.stringify(a.e.kreise()) === JSON.stringify(nachZwei), '5: zweimal Wiederholen: wieder alles');
  pruefe(!a.steuerung.wiederholen() && a.meldungen.at(-1) === t('testflug.gelaende.nichts_wiederholen'), '5: nichts mehr zu wiederholen, mit Hinweis');
  // A new stroke ends the redo line
  a.steuerung.rueckgaengig();
  ziehe(a, [100, 100], [120, 100]);
  pruefe(!a.steuerung.wiederholen(), '5: ein neuer Strich beendet die Wiederholen-Linie');

  // Foreign circles stay when a stroke is undone
  const b = aufbau();
  ziehe(b, [0, 0], [30, 0]);
  const eigene = b.e.kreise();
  const fremd: Kreis = { x: 500, z: 500, r: 9, nur: 'baeume' };
  b.e.setzeFremd({ placements: [], vegetationEntfernt: [fremd, ...eigene] });
  pruefe(b.steuerung.rueckgaengig() && JSON.stringify(b.e.kreise()) === JSON.stringify([fremd]), '5: Rückgängig nimmt genau die Kreise des Strichs, der Kreis des anderen Tabs bleibt');
  // A circle of the stroke was removed elsewhere: refused, said, history cleared, draft untouched
  const c = aufbau();
  ziehe(c, [0, 0], [30, 0]);
  const rest = c.e.kreise().slice(1);
  c.e.setzeFremd({ placements: [], vegetationEntfernt: rest });
  const schr = c.e.schreibungen;
  pruefe(!c.steuerung.rueckgaengig() && c.e.schreibungen === schr && c.e.kreise().length === rest.length, '5: fehlt ein Kreis des Strichs (anderer Tab), wird nichts geschrieben');
  pruefe(c.meldungen.at(-1) === t('testflug.gelaende.vegetation.konflikt'), '5: … und der Grund wird genannt');
  pruefe(!c.steuerung.rueckgaengig() && c.meldungen.at(-1) === t('testflug.gelaende.nichts_rueckgaengig'), '5: … der Verlauf ist danach leer');
  // History depth
  const v = new VegetationVerlauf();
  for (let i = 0; i < VEG_VERLAUF_MAX + 5; i++) v.neu({ kreise: [{ x: i, z: 0, r: 1 }] });
  pruefe(v.tiefe.rueckgaengig === VEG_VERLAUF_MAX, `5: der Verlauf behält ${VEG_VERLAUF_MAX} Schritte`);
}

// ── 6. Offener Strich ────────────────────────────────────────────────────────
{
  const a = aufbau();
  ziehe(a, [0, 0], [20, 0]);
  const stand0 = a.steuerung.stand;
  a.steuerung.druecken({ x: 0, z: 100 });
  const s1 = a.steuerung.stand;
  pruefe(a.steuerung.strichOffen && a.steuerung.strichKreise().length === 1 && s1 > stand0, '6: offener Strich: der erste Kreis steht in `strichKreise`, `stand` ist weitergezählt');
  a.steuerung.bewegen({ x: 40, z: 100 });
  pruefe(a.steuerung.strichKreise().length > 1 && a.steuerung.stand > s1, '6: jeder neue Kreis ändert `stand` (Änderungsmarke der Vorschau)');
  pruefe(a.e.kreise().length === a.e.kreise().length && a.e.schreibungen === 1, '6: während des Malens wird nichts in den Entwurf geschrieben');
  pruefe(!a.steuerung.rueckgaengig() && !a.steuerung.wiederholen(), '6: Strg+Z/Y reißen einen offenen Strich nicht entzwei');
  a.steuerung.beenden();
  pruefe(!a.steuerung.strichOffen && a.e.schreibungen === 2 && a.steuerung.strichKreise().length === 0, '6: `beenden` schließt den Strich ab (ein Schreibvorgang), nichts bleibt offen');
  pruefe(a.versteckt() > 0, '6: `beenden` blendet den Kreis aus');
  const stand = a.steuerung.stand;
  a.steuerung.bewegen({ x: 99, z: 99 });
  pruefe(a.steuerung.stand === stand && a.e.schreibungen === 2, '6: Bewegen ohne offenen Strich tut nichts');
  // Release ends: the stroke counts once even when `loslassen` is called twice (mouse up + focus loss)
  const b = aufbau();
  ziehe(b, [0, 0], [20, 0]);
  b.steuerung.loslassen();
  b.steuerung.beenden();
  pruefe(b.e.schreibungen === 1, '6: doppeltes Loslassen schreibt nicht doppelt');
}

// ── 7. Entwurf unbrauchbar ───────────────────────────────────────────────────
{
  const a = aufbau({ placements: [], vegetationEntfernt: [{ x: 1, z: 1, r: 'gross' }] });
  a.steuerung.druecken({ x: 0, z: 0 });
  pruefe(!a.steuerung.strichOffen && a.meldungen.at(-1) === t('testflug.gelaende.vegetation.entwurf_unbrauchbar'), '7: beschädigtes Feld im Entwurf: kein Strich, Grund genannt');
  const b = aufbau({ placements: [], vegetationEntfernt: 'kaputt' });
  b.steuerung.druecken({ x: 0, z: 0 });
  pruefe(!b.steuerung.strichOffen && b.e.schreibungen === 0, '7: ein Feld, das keine Liste ist: ebenso, nichts geschrieben');
  const c = aufbau({ placements: [], vegetationEntfernt: viele4097() });
  c.steuerung.druecken({ x: 0, z: 0 });
  pruefe(!c.steuerung.strichOffen, '7: 4097 Kreise im Entwurf (über der Grenze): gesperrt');
  const leer = new VegetationAktionen({ laden: () => null, aendern: () => undefined });
  const r = leer.lese();
  pruefe(!r.ok && r.message === t('testflug.gelaende.kein_entwurf'), '7: ohne Entwurf: „Kein Entwurf“');
  const wirft = new VegetationAktionen({ laden: () => { throw new Error('x'); }, aendern: () => undefined });
  pruefe(!wirft.lese().ok, '7: ein Entwurf, dessen Laden wirft: gesperrt statt Absturz');
  // Quelle für die Vorschau
  pruefe(vegetationKreiseAusEntwurf(null) === null, '7: ohne Entwurf gibt die Quelle null (Vorschau nimmt das Layout der Welt)');
  pruefe(vegetationKreiseAusEntwurf({})!.length === 0, '7: Entwurf ohne Feld: leere Liste (NICHT das Layout der Welt)');
  pruefe(vegetationKreiseAusEntwurf({ vegetationEntfernt: [{ x: 1, z: 2, r: 3 }] })!.length === 1, '7: Entwurf mit Kreisen: diese Kreise');
  pruefe(vegetationKreiseAusEntwurf({ vegetationEntfernt: 'x' })!.length === 0, '7: ein Nicht-Array gibt die leere Liste (kein Absturz)');
}
function viele4097(): Kreis[] {
  return Array.from({ length: VEGETATION_KREISE_MAX + 1 }, (_, i) => ({ x: i, z: 0, r: 1 }));
}

// ── 8. Kern des Strichs, Tasten, Verdrahtung, Texte ─────────────────────────
{
  const s = new VegetationStrich([]);
  pruefe(s.stempel(NaN, 0, 5, false) === 'ungueltig' && s.stempel(1e9, 0, 5, false) === 'ungueltig', '8: unbrauchbare Zeigerpunkte (NaN, außerhalb der Welt) legen keinen Kreis');
  pruefe(s.kreise.length === 0, '8: … auch keinen halben');
  // Keys: in a text field neither undo nor redo
  const e = { key: 'z', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false };
  pruefe(verlaufEntscheid(e, true, true).aktion === null && verlaufEntscheid(e, true, false).aktion === 'rueckgaengig', '8: Strg+Z im Textfeld löst nichts aus, im Reiter den Rückgängig-Schritt');
  pruefe(verlaufEntscheid(e, false, false).aktion === null, '8: bei geschlossenem Reiter nichts');

  const tf = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  const sp = readFileSync(resolve(HIER, '../src/editor/SpawnPanel.ts'), 'utf-8');
  pruefe(/new BewuchsVorschau\([\s\S]*?vegetationKreiseAusEntwurf\(persistenz\.laden\(\)\)/.test(tf), '8: Testflug.ts: die Vorschau bekommt die Kreise aus dem ENTWURF');
  pruefe(/vegetationPinsel\?\.stand/.test(tf) && /vegetationPinsel\?\.strichKreise\(\)/.test(tf), '8: Testflug.ts: Änderungsmarke und Kreise des offenen Strichs gehen in die Vorschau');
  pruefe(/verlaufEntscheid\(e, panel\.istGelaendeModus, tipptImFeld\(e\)\)[\s\S]{0,400}panel\.vegetationEinstellung\.aktiv\) void \(verlauf\.aktion === 'rueckgaengig' \? vegPinsel\.rueckgaengig\(\) : vegPinsel\.wiederholen\(\)\);\s*else if \(verlauf\.aktion\) void/.test(tf), '8: Testflug.ts: Strg+Z/Y gehen durch dieselbe Prüfung (Reiter offen, nicht im Textfeld) an das gewählte Werkzeug');
  pruefe(/gelaende\.beenden\(\);\s*vegPinsel\.beenden\(\);/.test(tf), '8: Testflug.ts: Werkzeugende (Esc, Rechtsklick, Loslassen) schließt auch den Bewuchs-Strich');
  pruefe(/vegPinsel\.druecken\(gp\)/.test(tf) && /vegPinsel\.bewegen\(p\)/.test(tf), '8: Testflug.ts: Drücken und Bewegen gehen an den Bewuchs-Pinsel, wenn er gewählt ist');
  pruefe(/vegetationEinstellung\.aktiv\) return;\s*gelaende\.tick/.test(tf), '8: Testflug.ts: ein stehender Zeiger stempelt nicht nach (Gelände-Takt gilt nicht für den Bewuchs-Pinsel)');
  pruefe(/testflug\.gelaende\.werkzeug\.vegetation/.test(sp) && /vegetationEinstellung = \{ aktiv: false, nurBaeume: false \}/.test(sp), '8: SpawnPanel.ts: Werkzeug-Knopf und Schalter „nur Bäume“ im Gelände-Block');
  pruefe(!/e\.code === 'Key[A-Z]'/.test(readFileSync(resolve(HIER, '../src/editor/testflug/vegetationSteuerung.ts'), 'utf-8')), '8: der Pinsel hat keine eigenen Tastenkürzel (keine Taste kann im Textfeld etwas auslösen)');
  for (const sprache of ['de', 'en'] as const) {
    const kat = JSON.parse(readFileSync(resolve(HIER, `../src/i18n/katalog/${sprache}.json`), 'utf-8')) as Record<string, string>;
    const schluessel = [
      'testflug.gelaende.werkzeug.vegetation',
      'testflug.gelaende.vegetation.nur_baeume',
      'testflug.gelaende.vegetation.pinsel_an',
      'testflug.gelaende.vegetation.pinsel_an_baeume',
      'testflug.gelaende.vegetation.strich_gespeichert',
      'testflug.gelaende.vegetation.grenze',
      'testflug.gelaende.vegetation.rueckgaengig',
      'testflug.gelaende.vegetation.wiederholt',
      'testflug.gelaende.vegetation.konflikt',
      'testflug.gelaende.vegetation.entwurf_unbrauchbar',
      'testflug.gelaende.vegetation.tip',
    ];
    pruefe(schluessel.every((k) => typeof kat[k] === 'string' && kat[k]!.length > 3), `8: ${sprache}.json hat alle ${schluessel.length} Schlüssel`);
    pruefe(/\{max\}/.test(kat['testflug.gelaende.vegetation.grenze']!) && /\{n\}/.test(kat['testflug.gelaende.vegetation.strich_gespeichert']!), `8: ${sprache}: die Platzhalter {max} und {n} stehen im Text`);
  }
}

console.log(`\n${geprueft} Prüfungen, ${fehler} Fehler`);
if (fehler > 0) process.exit(1);
console.log('vegetation-pinsel: alles grün');
