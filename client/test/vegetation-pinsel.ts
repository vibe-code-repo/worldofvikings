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
import { VEGETATION_KREISE_MAX, vegetationPruefer, type VegetationEntferntKreis } from '@wov/shared';
import { abgedeckt, stempelEntlang, vegStempelAbstand, VegetationStrich } from '../src/editor/testflug/vegetationPinsel';
import { VegetationVerlauf, VEG_VERLAUF_MAX } from '../src/editor/testflug/vegetationVerlauf';
import { VegetationAktionen, vegetationKreiseAusEntwurf, vegetationQuelleFuerVorschau } from '../src/editor/testflug/vegetationAktionen';
import { VerlaufReihenfolge, REIHENFOLGE_MAX, type VerlaufQuelle } from '../src/editor/testflug/verlaufReihenfolge';
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

function aufbau(start?: Record<string, unknown>, einst: { radius: number; nurBaeume: boolean } = { radius: 10, nurBaeume: false }, strichGemacht?: () => void) {
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
    strichGemacht,
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
  pruefe(abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 3, z: 0, r: 7.2 }), '2: 0,2 m über den Rand (2,9 % des Radius): noch abgedeckt (Toleranz 6 %)');
  pruefe(!abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 3, z: 0, r: 8 }), '2: ragt 1 m heraus: nicht abgedeckt');
  pruefe(!abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 3, z: 0, r: 7.5 }), '2: ragt 0,5 m heraus (6,7 % des Radius): nicht abgedeckt');
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

// ── 9. N1: Zittern, Grenzhinweis, Weltrand, Reihenfolge, Testlücken ───────────
{
  // Befund 1: 20 Striche über dieselbe Stelle mit 0,5 m Zittern wachsen die Liste nicht auf das Zwanzigfache
  let zufall = 12345;
  const rnd = (): number => ((zufall = (zufall * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  const einzel = aufbau();
  ziehe(einzel, [0, 0], [100, 0]);
  const nEinzel = einzel.e.kreise().length;
  const z = aufbau();
  for (let s = 0; s < 20; s++) {
    z.steuerung.druecken({ x: rnd(), z: rnd() });
    for (let i = 1; i <= 40; i++) z.steuerung.bewegen({ x: (100 * i) / 40 + rnd(), z: rnd() });
    z.steuerung.loslassen();
  }
  pruefe(z.e.kreise().length <= 5 * nEinzel, `9: 20 Striche mit 0,5 m Zittern: ${z.e.kreise().length} Kreise (Einzelstrich ${nEinzel}); Warnschwelle 5 ×, keine feste Obergrenze (Korrektheit geht vor)`);
  // Eine Pflanze am Rand eines leicht versetzten Strichs wird trotzdem entfernt
  const r = aufbau({ placements: [], vegetationEntfernt: [{ x: 0, z: 0, r: 6 }] }, { radius: 6, nurBaeume: false });
  r.steuerung.druecken({ x: 0.5, z: 0 });
  r.steuerung.loslassen();
  const pr = vegetationPruefer(r.e.kreise());
  pruefe(r.e.kreise().length === 2 && pr.istEntfernt(6.4, 0, 'baum'), '9: ein um 0,5 m versetzter Stempel wird gelegt, die Pflanze bei x = 6,4 (nur dort erreicht) wird entfernt');
  pruefe(!vegetationPruefer([{ x: 0, z: 0, r: 6 }]).istEntfernt(6.4, 0, 'baum'), '9: Kontrolle: der erste Kreis allein erreicht sie nicht');

  // Befund 2: der Grenzhinweis steht auch in der Abschlussmeldung
  const viele = (n: number): Kreis[] => Array.from({ length: n }, (_, i) => ({ x: -30000 + (i % 100) * 20, z: -30000 + Math.floor(i / 100) * 20, r: 2 }));
  const g = aufbau({ placements: [], vegetationEntfernt: viele(VEGETATION_KREISE_MAX - 5) });
  ziehe(g, [0, 0], [200, 0], 200);
  const letzte = g.meldungen.at(-1) ?? '';
  pruefe(letzte.includes(t('testflug.gelaende.vegetation.strich_gespeichert', { n: 5 })) && letzte.includes(t('testflug.gelaende.vegetation.grenze', { max: VEGETATION_KREISE_MAX })), `9: die letzte Meldung nennt „gespeichert“ UND die Grenze (${letzte.slice(0, 80)}…)`);
  const kurz = aufbau();
  ziehe(kurz, [0, 0], [30, 0]);
  pruefe(!(kurz.meldungen.at(-1) ?? '').includes(t('testflug.gelaende.vegetation.weltrand')) && !(kurz.meldungen.at(-1) ?? '').includes('4096'), '9: ein normaler Strich meldet weder Grenze noch Weltrand');

  // Befund 3: Stempel außerhalb des Weltbereichs: Hinweis
  const w = aufbau();
  w.steuerung.druecken({ x: 39995, z: 0 });
  w.steuerung.bewegen({ x: 40030, z: 0 });
  pruefe(w.meldungen.filter((m) => m === t('testflug.gelaende.vegetation.weltrand')).length === 1, '9: Weltrand: der Hinweis kommt während des Strichs, genau einmal');
  w.steuerung.loslassen();
  pruefe((w.meldungen.at(-1) ?? '').includes(t('testflug.gelaende.vegetation.weltrand')) && w.e.kreise().length >= 1 && w.e.kreise().every((c) => c.x <= 40000), '9: … und in der Abschlussmeldung; was im Weltbereich lag, ist gespeichert');

  // Befund 4: eine Reihenfolge über zwei Verläufe
  const log: string[] = [];
  const falsch = (name: string): VerlaufQuelle & { stapel: string[]; vorn: string[]; neu(): void } => {
    const q = {
      stapel: [] as string[],
      vorn: [] as string[],
      neu(): void {
        q.stapel.push(`${name}${q.stapel.length + q.vorn.length + 1}`);
        q.vorn.length = 0;
      },
      rueckgaengig(): boolean {
        const x = q.stapel.pop();
        if (!x) return false;
        q.vorn.push(x);
        log.push(`z:${x}`);
        return true;
      },
      wiederholen(): boolean {
        const x = q.vorn.pop();
        if (!x) return false;
        q.stapel.push(x);
        log.push(`y:${x}`);
        return true;
      },
      verwirfRueckgaengig(): void {
        q.stapel.pop();
      },
      get kannRueckgaengig(): boolean {
        return q.stapel.length > 0;
      },
      get kannWiederholen(): boolean {
        return q.vorn.length > 0;
      },
    };
    return q;
  };
  const boden = falsch('G');
  const bew = aufbau(undefined, undefined, () => reihenfolge.neu('vegetation'));
  const reihenfolge = new VerlaufReihenfolge();
  reihenfolge.verbinde({ gelaende: boden, vegetation: bew.steuerung });
  const machG = (): void => {
    boden.neu();
    reihenfolge.neu('gelaende');
  };
  machG();
  ziehe(bew, [0, 0], [20, 0]);
  machG();
  pruefe(bew.e.kreise().length > 0, '9: Reihenfolge: Gelände, Bewuchs, Gelände gemacht');
  reihenfolge.rueckgaengig();
  pruefe(boden.stapel.length === 1 && bew.e.kreise().length > 0, '9: 1. Strg+Z nimmt den ZULETZT gemachten (Gelände) zurück, der Bewuchs bleibt');
  reihenfolge.rueckgaengig();
  pruefe(bew.e.kreise().length === 0 && boden.stapel.length === 1, '9: 2. Strg+Z nimmt den Bewuchs-Strich zurück (egal welches Werkzeug gewählt ist)');
  reihenfolge.rueckgaengig();
  pruefe(boden.stapel.length === 0 && log.join(',') === 'z:G2,z:G1', `9: 3. Strg+Z den ersten Geländestrich (${log.join(',')})`);
  const leer: string[] = [];
  reihenfolge.verbinde({ gelaende: boden, vegetation: bew.steuerung }, (a) => leer.push(a));
  pruefe(!reihenfolge.rueckgaengig() && leer.join() === 'rueckgaengig', '9: danach nichts mehr (und der Hinweis „nichts zurückzunehmen“)');
  reihenfolge.wiederholen();
  reihenfolge.wiederholen();
  pruefe(bew.e.kreise().length > 0 && boden.stapel.length === 1, '9: Strg+Y in derselben Reihenfolge: erst Gelände (1.), dann der Bewuchs');
  reihenfolge.wiederholen();
  pruefe(boden.stapel.length === 2 && log.at(-1) === 'y:G2', '9: … zuletzt der zweite Geländestrich');
  // a new stroke ends the redo line over both tools
  reihenfolge.rueckgaengig();
  ziehe(bew, [100, 100], [120, 100]);
  const nGemeldet: string[] = [];
  reihenfolge.verbinde({ gelaende: boden, vegetation: bew.steuerung }, (a) => nGemeldet.push(a));
  const logLaenge = log.length;
  pruefe(!reihenfolge.wiederholen() && log.length === logLaenge && boden.vorn.length === 1 && nGemeldet.join() === 'wiederholen', '9: ein neuer Strich beendet die Wiederholen-Linie beider Werkzeuge: der alte Redo-Schritt des Geländes wird NICHT genommen, es heißt „nichts zu wiederholen“');
  // stale tag: a history that lost its steps (foreign change) is skipped
  const b2 = falsch('G');
  const v2 = falsch('V');
  const r2 = new VerlaufReihenfolge();
  r2.verbinde({ gelaende: b2, vegetation: v2 });
  b2.neu(); r2.neu('gelaende');
  v2.neu(); r2.neu('vegetation');
  v2.stapel.length = 0; // emptied from outside
  pruefe(r2.rueckgaengig() && b2.stapel.length === 0, '9: ein Eintrag, dessen Verlauf leer ist, wird übersprungen, der ältere Schritt kommt dran');
  // refused step stays
  const b3 = falsch('G');
  b3.rueckgaengig = (): boolean => false;
  const r3 = new VerlaufReihenfolge();
  r3.verbinde({ gelaende: b3, vegetation: falsch('V') });
  b3.neu(); r3.neu('gelaende');
  pruefe(!r3.rueckgaengig() && r3.tiefe.rueckgaengig === 0 && b3.stapel.length === 0, '9: ein verweigerter Rückgängig-Schritt (Sperre) verlässt Reihenfolge und Verlauf (Z2, siehe Abschnitt 11)');

  // Befund 5: Testlücken
  const entlang = stempelEntlang({ x: 0, z: 0 }, { x: 7, z: 0 }, 5);
  pruefe(entlang.length === 1 && entlang[0]!.x === 5 && entlang.every((p) => p.x <= 7), '9: stempelEntlang stempelt nie über den Zeiger hinaus (floor, nicht ceil)');
  pruefe(stempelEntlang({ x: 0, z: 0 }, { x: 10, z: 0 }, 5).length === 2 && stempelEntlang({ x: 0, z: 0 }, { x: 14.9, z: 0 }, 5).length === 2, '9: genau n = floor(Weg / Abstand) Stempel');
  // Quelle der Vorschau: Kreise des offenen Strichs gehören dazu
  const q = vegetationQuelleFuerVorschau({ vegetationEntfernt: [{ x: 1, z: 1, r: 2 }] }, [{ x: 5, z: 5, r: 3 }]);
  pruefe(q?.length === 2 && q[1]!.x === 5, '9: Quelle der Vorschau = Entwurf + Kreise des offenen Strichs');
  pruefe(vegetationQuelleFuerVorschau(null, [{ x: 5, z: 5, r: 3 }]) === null, '9: ohne Entwurf: null');
  // `stand` ändert sich beim Loslassen auch dann, wenn das Schreiben verweigert wird (die Vorschau muss die Kreise loswerden)
  const s = aufbau();
  s.steuerung.druecken({ x: 0, z: 0 });
  s.steuerung.bewegen({ x: 30, z: 0 });
  s.e.setzeFremd({ placements: [], vegetationEntfernt: viele(VEGETATION_KREISE_MAX) });
  const vorStand = s.steuerung.stand;
  s.steuerung.loslassen();
  pruefe(s.e.kreise().length === VEGETATION_KREISE_MAX && s.steuerung.stand !== vorStand && s.steuerung.strichKreise().length === 0, '9: verweigertes Schreiben: `stand` ändert sich beim Loslassen, die Kreise des Strichs sind aus der Quelle');
  const s2 = aufbau();
  s2.steuerung.druecken({ x: 0, z: 0 });
  const vor2 = s2.steuerung.stand;
  s2.steuerung.loslassen();
  pruefe(s2.steuerung.stand !== vor2, '9: erfolgreicher Strich: `stand` ändert sich beim Loslassen');
  // `entfernen`: bei doppelten Kreisen kommt das LETZTE Vorkommen heraus (die Liste behält ihre Reihenfolge)
  const A: Kreis = { x: 1, z: 1, r: 2 };
  const Bk: Kreis = { x: 9, z: 9, r: 2 };
  const d = aufbau({ placements: [], vegetationEntfernt: [A, Bk, A] });
  pruefe(d.aktionen.entfernen([A]).ok && JSON.stringify(d.e.kreise()) === JSON.stringify([A, Bk]), '9: `entfernen` nimmt das letzte Vorkommen: [A, B, A] ⇒ [A, B]');
  // Wächter im Schreibweg: ungültige Kreise werden von jedem Aufrufer abgelehnt
  const wch = aufbau({ placements: [], vegetationEntfernt: [A] });
  const roh = JSON.stringify(wch.e.roh());
  const ergebnisse = [wch.aktionen.hinzufuegen([{ x: NaN, z: 0, r: 5 }]), wch.aktionen.hinzufuegen([{ x: 0, z: 0, r: 500 }]), wch.aktionen.hinzufuegen([{ x: 0, z: 0, r: 5, nur: 'busch' as never }])];
  pruefe(ergebnisse.every((e) => !e.ok) && JSON.stringify(wch.e.roh()) === roh && wch.e.schreibungen === 0, '9: Schreibweg: NaN, Radius 500 und ein falsches `nur` werden abgelehnt, der Entwurf bleibt byte-gleich');
  // Verdrahtung im Quelltext
  const tf2 = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  const gs = readFileSync(resolve(HIER, '../src/editor/testflug/GelaendeSteuerung.ts'), 'utf-8');
  pruefe(/strichGemacht: \(\) => reihenfolge\.neu\('gelaende'\)/.test(tf2) && /strichGemacht: \(\) => reihenfolge\.neu\('vegetation'\)/.test(tf2) && /reihenfolge\.verbinde\(\{ gelaende, vegetation: vegPinsel \}, /.test(tf2), '9: Testflug.ts meldet beide Werkzeuge an die gemeinsame Reihenfolge');
  pruefe(/this\.verlauf\.neu\(v\);\s*this\.abh\.strichGemacht\?\.\(\);/.test(gs), '9: GelaendeSteuerung meldet jeden gespeicherten Strich');
  pruefe(/vegetationQuelleFuerVorschau\(persistenz\.laden\(\), vegetationPinsel\?\.strichKreise\(\) \?\? \[\]\)/.test(tf2) && /reihenfolge\.verbinde\(\{ gelaende, vegetation: vegPinsel \}, \(art\) =>/.test(tf2), '9: Testflug.ts: die Vorschau-Quelle ist `vegetationQuelleFuerVorschau` mit den Kreisen des offenen Strichs');
}

// ── 10. N2: dichte Probepunkte, gescheiterter Schritt, Kappe der Reihenfolge ──
{
  // R1: wo `abgedeckt` ja sagt, bleibt praktisch keine Fläche ungeräumt (Zufallsproben, 20 000 Punkte je Fall, feste Saat)
  let z0 = 987654321;
  const u = (): number => ((z0 = (z0 * 1103515245 + 12345) % 2147483648) / 2147483648);
  let ja = 0;
  let schlimmster = 0;
  for (let fall = 0; fall < 4000; fall++) {
    const r = 3 + u() * 10;
    const basis: Kreis[] = Array.from({ length: 1 + Math.floor(u() * 4) }, () => ({ x: (u() - 0.5) * 0.6 * r, z: (u() - 0.5) * 0.6 * r, r: r * (0.9 + u() * 0.3) }));
    const neu: Kreis = { x: (u() - 0.5) * 0.5 * r, z: (u() - 0.5) * 0.5 * r, r };
    if (!abgedeckt(basis, neu)) continue;
    ja++;
    let draussen = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const w = u() * 2 * Math.PI;
      const d = Math.sqrt(u()) * neu.r;
      const x = neu.x + Math.cos(w) * d;
      const zz = neu.z + Math.sin(w) * d;
      if (!basis.some((k) => Math.hypot(x - k.x, zz - k.z) <= k.r)) draussen++;
    }
    schlimmster = Math.max(schlimmster, draussen / N);
  }
  console.log(`  (R1: ${ja} übersprungen, schlimmster ungeräumter Anteil ${(schlimmster * 100).toFixed(2)} %)`);
  pruefe(ja > 100 && schlimmster <= 0.04, `10: R1: ${ja} übersprungene Stempel, ungeräumt höchstens ${(schlimmster * 100).toFixed(2)} % der Stempelfläche (Grenze 4 %)`);
  // Randpflanze eines versetzten Stempels zwischen mehreren Basiskreisen
  const basis3: Kreis[] = [{ x: 0, z: 0, r: 10 }, { x: 2, z: 1, r: 10 }, { x: -2, z: 1.5, r: 10 }];
  pruefe(!abgedeckt(basis3, { x: 0.3, z: -1.2, r: 10 }), '10: ein Stempel, dessen Rand unten über die Basiskreise ragt, wird gelegt');
  // Zittern: Kreiszahl erneut (Zahl für den Bericht)
  let zufall = 4242;
  const rnd = (): number => ((zufall = (zufall * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  const ein = aufbau();
  ziehe(ein, [0, 0], [100, 0]);
  const zz = aufbau();
  for (let s = 0; s < 20; s++) {
    zz.steuerung.druecken({ x: rnd(), z: rnd() });
    for (let i = 1; i <= 40; i++) zz.steuerung.bewegen({ x: (100 * i) / 40 + rnd(), z: rnd() });
    zz.steuerung.loslassen();
  }
  console.log(`  (Zittern 0,5 m: ${zz.e.kreise().length} Kreise nach 20 Strichen, Einzelstrich ${ein.e.kreise().length})`);
  pruefe(zz.e.kreise().length <= 5 * ein.e.kreise().length, `10: 20 Striche mit 0,5 m Zittern, r = 10: ${zz.e.kreise().length} Kreise (Einzelstrich ${ein.e.kreise().length}); keine feste Obergrenze, nur eine Warnschwelle bei 5 ×`);
  // dasselbe mit r = 2 (das Zittern ist dort 25 % des Radius)
  const klein = aufbau(undefined, { radius: 2, nurBaeume: false });
  ziehe(klein, [0, 0], [100, 0]);
  const kleinZ = aufbau(undefined, { radius: 2, nurBaeume: false });
  for (let s2 = 0; s2 < 20; s2++) {
    kleinZ.steuerung.druecken({ x: rnd(), z: rnd() });
    for (let i = 1; i <= 100; i++) kleinZ.steuerung.bewegen({ x: i + rnd(), z: rnd() });
    kleinZ.steuerung.loslassen();
  }
  console.log(`  (Zittern 0,5 m, r = 2: ${kleinZ.e.kreise().length} Kreise nach 20 Strichen, Einzelstrich ${klein.e.kreise().length})`);
  pruefe(kleinZ.e.kreise().length < VEGETATION_KREISE_MAX && kleinZ.e.kreise().length >= klein.e.kreise().length, `10: 20 Striche mit 0,5 m Zittern, r = 2: ${kleinZ.e.kreise().length} Kreise, unter der Grenze von 4096`);

  // R2: ein Schritt, der seinen Verlauf selbst leert, wird nicht an das andere Werkzeug weitergereicht
  const mk = (name: string) => {
    const q = {
      stapel: [name + '1', name + '2'] as string[],
      geleert: false,
      kannRueckgaengig: true,
      kannWiederholen: false,
      verwirfRueckgaengig: (): void => undefined,
      rueckgaengig(): boolean {
        if (q.geleert) {
          q.stapel.length = 0;
          q.kannRueckgaengig = false;
          return false;
        }
        q.stapel.pop();
        q.kannRueckgaengig = q.stapel.length > 0;
        return true;
      },
      wiederholen: (): boolean => false,
    };
    return q;
  };
  const gg = mk('G');
  const vv = mk('V');
  const rr = new VerlaufReihenfolge();
  const gemeldet: string[] = [];
  rr.verbinde({ gelaende: gg, vegetation: vv }, (a) => gemeldet.push(a));
  rr.neu('vegetation'); rr.neu('vegetation'); rr.neu('gelaende'); rr.neu('gelaende');
  gg.geleert = true; // der Geländeverlauf leert sich beim nächsten Versuch selbst (Fremdänderung)
  const erg = rr.rueckgaengig();
  pruefe(!erg && vv.stapel.length === 2 && rr.tiefe.rueckgaengig === 3 && gemeldet.length === 0, '10: R2: der Schritt, der seinen Verlauf leert, gibt false zurück; der Bewuchs wird NICHT zurückgenommen (derselbe Druck)');
  pruefe(rr.rueckgaengig() === true && vv.stapel.length === 1 && rr.tiefe.rueckgaengig === 1, '10: R2: erst der NÄCHSTE Druck überspringt das tote Gelände-Tag und nimmt den Bewuchs-Strich zurück');

  // R3: die Kappe der Reihenfolge ist 200 Schritte
  const a1 = { n: 0, kannRueckgaengig: true, kannWiederholen: false, verwirfRueckgaengig: (): void => undefined, rueckgaengig(): boolean { a1.n++; return true; }, wiederholen: (): boolean => false };
  const r4 = new VerlaufReihenfolge();
  r4.verbinde({ gelaende: a1, vegetation: a1 });
  for (let i = 0; i < REIHENFOLGE_MAX + 50; i++) r4.neu(i % 2 ? 'gelaende' : 'vegetation');
  pruefe(REIHENFOLGE_MAX === 200 && r4.tiefe.rueckgaengig === 200, `10: R3: die Reihenfolge behält genau 200 Einträge (${r4.tiefe.rueckgaengig})`);
  let n = 0;
  while (r4.rueckgaengig() && n < 1000) n++;
  pruefe(n === 200 && a1.n === 200, `10: R3: 200 Schritte lassen sich zurücknehmen (${n})`);
}

// ── 11. N3: Löcher zwischen Kreisen, verweigerte Schritte ─────────────────────
{
  // Z1: ein gemalter Ring (R = 12, 16 Stempel, r = 10) und ein Klick in der Mitte: der Stempel wird gelegt
  const ring: Kreis[] = Array.from({ length: 16 }, (_, i) => ({ x: +(12 * Math.cos((2 * Math.PI * i) / 16)).toFixed(2), z: +(12 * Math.sin((2 * Math.PI * i) / 16)).toFixed(2), r: 10 }));
  pruefe(!abgedeckt(ring, { x: -1, z: -1, r: 10 }), '11: Z1: Ring aus 16 Stempeln (R = 12, r = 10): der Klick bei (−1, −1) wird NICHT übersprungen');
  const rg = aufbau({ placements: [], vegetationEntfernt: ring });
  rg.steuerung.druecken({ x: -1, z: -1 });
  rg.steuerung.loslassen();
  pruefe(rg.e.kreise().length === 17, `11: Z1: … und steht danach im Entwurf (${rg.e.kreise().length} Kreise)`);
  // Z1 Test 2: nur durch die Vereinigung mehrerer Kreise gedeckt: gelegt
  pruefe(!abgedeckt([{ x: -3, z: 0, r: 10 }, { x: 3, z: 0, r: 10 }], { x: 0, z: 0, r: 12 }) && !abgedeckt([{ x: -4, z: 0, r: 8 }, { x: 4, z: 0, r: 8 }], { x: 0, z: 0, r: 5 }), '11: Z1: ein Stempel, der nur durch die Vereinigung zweier Kreise gedeckt ist, wird gelegt');
  pruefe(abgedeckt([{ x: 0, z: 0, r: 10 }], { x: 3, z: 0, r: 7 }) && abgedeckt([{ x: 5, z: 5, r: 10 }, { x: 0, z: 0, r: 10 }], { x: 0.5, z: 0, r: 10 }), '11: Z1: ein einzelner Kreis, der den Stempel (mit 6 % Toleranz) enthält, genügt');

  // Z2: ein verweigerter Rückgängig-Schritt blockiert die älteren Striche nicht dauerhaft
  const mk2 = (name: string, verweigert: boolean) => {
    const q = {
      stapel: [`${name}1`, `${name}2`] as string[],
      vorn: [] as string[],
      verweigert,
      get kannRueckgaengig(): boolean {
        return q.stapel.length > 0;
      },
      get kannWiederholen(): boolean {
        return q.vorn.length > 0;
      },
      rueckgaengig(): boolean {
        if (q.verweigert) return false;
        q.vorn.push(q.stapel.pop()!);
        return true;
      },
      wiederholen(): boolean {
        if (q.verweigert) return false;
        q.stapel.push(q.vorn.pop()!);
        return true;
      },
      verwirfRueckgaengig(): void {
        q.stapel.pop();
      },
    };
    return q;
  };
  const gq = mk2('G', true);
  const vq = mk2('V', false);
  const ro = new VerlaufReihenfolge();
  const verworfen: string[] = [];
  ro.verbinde({ gelaende: gq, vegetation: vq }, undefined, (w) => verworfen.push(w));
  ro.neu('vegetation'); ro.neu('vegetation'); ro.neu('gelaende');
  pruefe(!ro.rueckgaengig() && vq.stapel.length === 2 && verworfen.join() === 'gelaende', '11: Z2: der verweigerte Schritt (Sperre) tut sonst nichts: false, der Bewuchs bleibt, der Hinweis „verworfen“ kommt');
  pruefe(gq.stapel.length === 1 && ro.tiefe.rueckgaengig === 2, '11: Z2: er ist aus der Reihenfolge UND aus seinem Verlauf genommen (der nächstältere Geländestrich ist nicht mehr blockiert)');
  pruefe(ro.rueckgaengig() && vq.stapel.length === 1, '11: Z2: der NÄCHSTE Strg+Z nimmt den nächstälteren Strich (Bewuchs)');
  // refused redo blocks no undo
  const g2 = mk2('G', false);
  const v2b = mk2('V', false);
  const r5 = new VerlaufReihenfolge();
  r5.verbinde({ gelaende: g2, vegetation: v2b });
  r5.neu('gelaende'); r5.neu('vegetation');
  r5.rueckgaengig();
  v2b.verweigert = true; // das Wiederholen an der Grenze 4096 wird abgelehnt
  pruefe(!r5.wiederholen() && r5.tiefe.wiederholen === 1, '11: Z2: ein verweigertes Wiederholen bleibt stehen (kein Verwerfen)');
  v2b.verweigert = false;
  pruefe(r5.rueckgaengig() && g2.stapel.length === 1 && g2.vorn.length === 1, '11: Z2: … und blockiert das Rückgängig nicht (der Geländestrich wird zurückgenommen)');
  // Verdrahtung
  const tf3 = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  pruefe(/schritt_verworfen/.test(tf3) && /verwirfRueckgaengig\(\): void/.test(readFileSync(resolve(HIER, '../src/editor/testflug/GelaendeSteuerung.ts'), 'utf-8')) && /verwirfRueckgaengig\(\): void/.test(readFileSync(resolve(HIER, '../src/editor/testflug/vegetationSteuerung.ts'), 'utf-8')), '11: Z2: Testflug.ts meldet den verworfenen Schritt; beide Steuerungen können ihren Verlauf kürzen');
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
  pruefe(/new BewuchsVorschau\([\s\S]*?vegetationQuelleFuerVorschau\(persistenz\.laden\(\), vegetationPinsel\?\.strichKreise\(\) \?\? \[\]\)/.test(tf), '8: Testflug.ts: die Vorschau bekommt die Kreise aus dem ENTWURF');
  pruefe(/vegetationPinsel\?\.stand/.test(tf) && /vegetationPinsel\?\.strichKreise\(\)/.test(tf), '8: Testflug.ts: Änderungsmarke und Kreise des offenen Strichs gehen in die Vorschau');
  pruefe(/verlaufEntscheid\(e, panel\.istGelaendeModus, tipptImFeld\(e\)\)[\s\S]{0,400}verlauf\.aktion === 'rueckgaengig' \? reihenfolge\.rueckgaengig\(\) : reihenfolge\.wiederholen\(\)/.test(tf), '8: Testflug.ts: Strg+Z/Y gehen durch dieselbe Prüfung (Reiter offen, nicht im Textfeld) an die gemeinsame Reihenfolge');
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
