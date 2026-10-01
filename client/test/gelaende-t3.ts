/**
 * T3 — terrain brush, the rest: level with pipette, reset, undo/redo per stroke, loose objects
 * that move with the ground, the `storage` listener, vegetation. DOM-free, real `RegionGeo`.
 * Ebnen mit Pipette, Zurücksetzen, Rückgängig/Wiederholen je Strich, lose Objekte, Hörer, Bewuchs.
 *
 *  1. Level (core): the stamp pulls the vertex to the target by the falloff, no change at the rim.
 *  2. Level on a real ground: the middle lands on the target, the rim falls off, outside stays;
 *     a target that breaks the limit refuses the WHOLE stroke; without a target there is no stroke.
 *  3. Pipette: reads the ground height INCLUDING the hand correction, = the freshly compiled world.
 *  4. Reset: the correction under the brush is gone (ground = base), elsewhere nothing moves.
 *  5. Undo/redo: stroke → level → undo → undo → redo → redo gives bit-equal `heightDeltas`;
 *     mixed with an object placement; a foreign change empties the history; keys.
 *  6. Loose objects: y = new ground after a stroke, old place after undo; buildings and plinths stay.
 *  7. Vegetation: a scatter sits on the ground of its time, so the flight re-scatters after a stroke.
 *  8. The `storage` listener works only while the terrain tab is open; `key === null` is covered.
 *  9. Wiring in the source (only what no run without a browser reaches) and texts de/en.
 *
 * Run: npx tsx test/gelaende-t3.ts   (from client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo, getStableHash, HeightmapProvider, PrefabFlag, type RegionGeo } from '@wov/shared';
import type { WorldLayout } from '@wov/shared';
import { createWorld } from '../src/world/World';
import { BewuchsVorschau } from '../src/editor/BewuchsVorschau';
import {
  DeltaKarte,
  berechneStempel,
  klemmeZiel,
  karteAusEntwurf,
  pipette,
  punktVon,
  verlaufTaste,
  verlaufEntscheid,
  istPipetteTaste,
  pipetteEntscheid,
  zielAusText,
  wirkRadius,
  falloff,
  Strich,
  type StempelEingabe,
  type Werkzeug,
} from '../src/editor/testflug/gelaendePinsel';
import type { SperrKatalog, SperrPlatzierung } from '../src/editor/testflug/gelaendeSperre';
import { GelaendeAktionen } from '../src/editor/testflug/GelaendeAktionen';
import { GelaendeSteuerung, type GelaendeAbh, type Kasten } from '../src/editor/testflug/GelaendeSteuerung';
import { GelaendeVerlauf, VERLAUF_MAX } from '../src/editor/testflug/gelaendeVerlauf';
import { istLose, loseIndizes, platzierungenNahe, MARGE_M } from '../src/editor/testflug/gelaendeLose';
import { baumSinkt } from '../src/player/PlayerController';
import { rohHoehenQuelle } from '../src/editor/testflug/gelaendeRoh';
import { verdrahteEntwurfHoerer, type StorageZiel } from '../src/editor/testflug/gelaendeHoerer';

let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FAIL: ${text}`);
  }
};

const HIER = dirname(fileURLToPath(import.meta.url));
const NAME = 'gelaende-pinsel-test';
const LAYOUT = {
  version: 1,
  name: NAME,
  detailSeed: NAME,
  continents: [],
  regions: [{ id: 'land', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
} as unknown as WorldLayout;

const katalog: SperrKatalog = {
  def: (n) => (n === 'Baum' ? ({ name: n, flags: PrefabFlag.TREE_BASE, renderScale: { w: 8, h: 8 } } as never) : ({ name: n, flags: 0n, renderScale: { w: 2, h: 2 } } as never)),
  fest: () => true,
  vegetation: () => false,
  upload: (n) =>
    ({
      U_Wohnhaus: { breite: 8.9, tiefe: 6.29 },
      U_Fass: { breite: 0.7, tiefe: 0.7 },
      U_Karren: { breite: 2.72, tiefe: 1.6 },
    })[n as 'U_Wohnhaus'],
};

interface Entwurf {
  laden(): Record<string, unknown> | null;
  aendern(d: Record<string, unknown>): void;
  schreibungen(): number;
  doc(): Record<string, unknown>;
  setze(d: Record<string, unknown>): void;
}
function entwurf(anfang: Record<string, unknown>): Entwurf {
  let text = JSON.stringify(anfang);
  let n = 0;
  return {
    laden: () => JSON.parse(text) as Record<string, unknown>,
    aendern: (d) => {
      n++;
      text = JSON.stringify(d);
    },
    schreibungen: () => n,
    doc: () => JSON.parse(text) as Record<string, unknown>,
    setze: (d) => {
      text = JSON.stringify(d);
    },
  };
}

interface Aufbau {
  steuerung: GelaendeSteuerung;
  aktionen: GelaendeAktionen;
  entwurf: Entwurf;
  meldungen: string[];
  welt: ReturnType<typeof createWorld>;
  setzeZeit(ms: number): number;
  ein: { werkzeug: Werkzeug; radius: number; staerke: number; ziel: number | null };
  /** What the flight would show as height of each placement (list position → y), as `zeige` computes it. */
  angezeigt: Map<number, number>;
  /** Every list the flight was asked to redraw (`'alle'` = the whole list). */
  nachListen: Array<number[] | 'alle'>;
  /** What the flight shows per list position (position → id), as `neuAufbauen…` leaves it. */
  zeigt: Map<number, string>;
  /** Pipette button armed (panel highlight). */
  pipetteAnzeige: boolean;
}
const platz = (e: Entwurf): SperrPlatzierung[] => (e.laden()?.placements as SperrPlatzierung[] | undefined) ?? [];
function aufbau(doc: Record<string, unknown>): Aufbau {
  const welt = createWorld(NAME, {}, doc);
  const e = entwurf(doc);
  const aktionen = new GelaendeAktionen(e);
  const meldungen: string[] = [];
  let zeit = 1000;
  let vorgaenge = 0;
  const ein: Aufbau['ein'] = { werkzeug: 'anheben', radius: 6, staerke: 20, ziel: null };
  const angezeigt = new Map<number, number>();
  platz(e).forEach((p, i) => angezeigt.set(i, welt.getGroundHeight(p.x, p.z)));
  const nachListen: Array<number[] | 'alle'> = [];
  const zeigt = new Map<number, string>();
  platz(e).forEach((p, i) => zeigt.set(i, String((p as { id?: string }).id ?? i)));
  const stand = { pipetteAnzeige: false };
  const rohQ = rohHoehenQuelle(welt.geo)!;
  const abh: GelaendeAbh = {
    hoehe: (x, z) => welt.getGroundHeight(x, z),
    geo: () => welt.geo,
    neuBauen: (k: Kasten) => {
      welt.heightmaps.invalidateArea((k.minX + k.maxX) / 2, (k.minZ + k.maxZ) / 2, Math.hypot(k.maxX - k.minX, k.maxZ - k.minZ) / 2 + 1);
    },
    platzierungen: () => platz(e),
    katalog,
    aktionen,
    einstellung: () => ein,
    setzeZiel: (h) => void (ein.ziel = h),
    rohHoehe: (x, z) => rohQ(x, z),
    pipetteAnzeige: (an) => void (stand.pipetteAnzeige = an),
    meldung: (t) => meldungen.push(t),
    kreis: { zeige: () => undefined, verberge: () => undefined },
    nachStrich: (lose) => {
      const liste = platz(e);
      if (lose === 'alle') {
        nachListen.push('alle');
        zeigt.clear();
        angezeigt.clear();
        liste.forEach((p, i) => {
          zeigt.set(i, String((p as { id?: string }).id ?? i));
          angezeigt.set(i, welt.getGroundHeight(p.x, p.z));
        });
        return;
      }
      nachListen.push([...lose]);
      for (const i of lose) {
        if (!liste[i]) continue;
        zeigt.set(i, String((liste[i] as { id?: string }).id ?? i));
        angezeigt.set(i, welt.getGroundHeight(liste[i]!.x, liste[i]!.z));
      }
    },
    jetztMs: () => zeit,
    vorgangId: () => `strich-${++vorgaenge}`,
  };
  return {
    steuerung: new GelaendeSteuerung(abh),
    aktionen,
    entwurf: e,
    meldungen,
    welt,
    setzeZeit: (ms) => (zeit += ms),
    ein,
    angezeigt,
    nachListen,
    zeigt,
    get pipetteAnzeige() {
      return stand.pipetteAnzeige;
    },
  };
}
/** One stroke from `von` to `bis` in `bilder` frames. */
const strich = (a: Aufbau, von: [number, number], bis: [number, number], bilder: number): void => {
  a.steuerung.druecken({ x: von[0], z: von[1] }, false);
  for (let i = 1; i <= bilder; i++) {
    a.setzeZeit(130);
    const p = { x: von[0] + ((bis[0] - von[0]) * i) / bilder, z: von[1] + ((bis[1] - von[1]) * i) / bilder };
    a.steuerung.bewegen(p, false);
    a.steuerung.tick(p, false);
  }
  a.steuerung.loslassen();
};
const eingabe = (x: number, z: number, o: Partial<StempelEingabe> = {}): StempelEingabe => ({ x, z, radius: 6, staerke: 20, werkzeug: 'anheben', hoehe: () => 0, ...o });
const deltaAn = (k: DeltaKarte, x: number, z: number): number => {
  const p = punktVon(x, z);
  return k.delta(p.zx, p.zz, p.index);
};
const frischAus = (a: Aufbau): ReturnType<typeof createWorld> => createWorld(NAME, {}, a.entwurf.doc());
const raster = (r: number, schritt = 1): Array<[number, number]> => {
  const aus: Array<[number, number]> = [];
  for (let z = -r; z <= r; z += schritt) for (let x = -r; x <= r; x += schritt) aus.push([x, z]);
  return aus;
};
const abweichungen = (a: ReturnType<typeof createWorld>, b: ReturnType<typeof createWorld>, punkte: Array<[number, number]>): number =>
  punkte.filter(([x, z]) => a.getGroundHeight(x, z) !== b.getGroundHeight(x, z)).length;
const ebene = (a: Aufbau): string => JSON.stringify((a.entwurf.doc().heightDeltas as unknown) ?? null);
const basisWelt = (): ReturnType<typeof createWorld> => createWorld(NAME, {}, LAYOUT as unknown as Record<string, unknown>);

// ── 1. Ebnen (Kern) ───────────────────────────────────────────────────────────
{
  const karte = new DeltaKarte();
  const boden = (x: number, z: number): number => 3 + deltaAn(karte, x, z) / 100;
  const s = berechneStempel(karte, eingabe(0, 0, { werkzeug: 'ebnen', ziel: 5, hoehe: boden }));
  const mitte = s.find((a) => a.index === 32 * 64 + 32);
  pruefe(mitte?.neu === 200, `1: Mitte: +200 cm = Ziel 5 m (${mitte?.neu})`);
  const d3 = s.find((a) => a.index === 32 * 64 + 35);
  pruefe(d3?.neu === Math.round(200 * 0.5625), `1: Abstand 3 m bei r=6: Randabfall wie beim Anheben (${d3?.neu})`);
  pruefe(!s.some((a) => a.index === 32 * 64 + 38), '1: am Rand (d = r) keine Änderung');
  pruefe(berechneStempel(karte, eingabe(0, 0, { werkzeug: 'ebnen', hoehe: boden })).length === 0, '1: ohne Zielhöhe ändert ein Ebnen-Stempel nichts');
  pruefe(berechneStempel(karte, eingabe(0, 0, { werkzeug: 'ebnen', ziel: Number.NaN, hoehe: boden })).length === 0, '1: Ziel NaN: nichts');
  pruefe(berechneStempel(karte, eingabe(0, 0, { werkzeug: 'ebnen', ziel: 3, hoehe: boden })).length === 0, '1: Boden schon auf Zielhöhe: nichts zu tun');
  const runter = berechneStempel(karte, eingabe(0, 0, { werkzeug: 'ebnen', ziel: 1, hoehe: boden }));
  pruefe(runter.find((a) => a.index === 32 * 64 + 32)?.neu === -200 && runter.every((a) => a.neu < 0), '1: Ziel unter dem Boden senkt');
  // Repeated stamps converge onto the target and stay there
  const k2 = new DeltaKarte();
  const h2 = (x: number, z: number): number => 3 + deltaAn(k2, x, z) / 100;
  const st = new Strich(k2, 'v');
  for (let i = 0; i < 6; i++) st.stempel(eingabe(0, 0, { werkzeug: 'ebnen', ziel: 5, hoehe: h2 }), false);
  pruefe(h2(0, 0) === 5 && h2(1, 0) > 4.9, `1: sechs Stempel: Mitte genau 5 m (${h2(0, 0)}), Nachbar ${h2(1, 0).toFixed(3)}`);
  pruefe(wirkRadius('ebnen', 6, 1) === 6 && wirkRadius('zuruecksetzen', 6, 1) === 6 && wirkRadius('anheben', 6, 1) < 6, '1: Wirkradius: Ebnen und Zurücksetzen voll, Anheben schwach schmaler');
  pruefe(klemmeZiel(1.23456) === 1.23 && klemmeZiel(99999) === 2000 && klemmeZiel(-99999) === -200 && klemmeZiel(Number.NaN) === 0, '1: klemmeZiel rundet auf cm und klemmt');
}

// ── 2. Ebnen auf echtem Gelände ───────────────────────────────────────────────
{
  const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
  const basis = basisWelt();
  const vorher = new Map<string, number>();
  for (const [x, z] of raster(12)) vorher.set(`${x},${z}`, a.welt.getGroundHeight(x, z));
  const ziel = klemmeZiel(vorher.get('0,0')! + 1.5);
  a.ein.werkzeug = 'ebnen';
  a.ein.ziel = ziel;
  strich(a, [0, 0], [0, 0], 6);
  const mitte = a.welt.getGroundHeight(0, 0);
  pruefe(Math.abs(mitte - ziel) < 0.006, `2: die Mitte steht auf der Zielhöhe (Toleranz 0,006 m): ${mitte.toFixed(4)} ↔ ${ziel.toFixed(2)}`);
  const vierM = a.welt.getGroundHeight(4, 0);
  pruefe(vierM > vorher.get('4,0')! && vierM < ziel + 0.5, `2: 4 m daneben: angehoben, aber nicht auf der Zielhöhe (${vorher.get('4,0')!.toFixed(2)} → ${vierM.toFixed(2)})`);
  let ausserhalb = 0;
  for (const [x, z] of raster(12)) if (Math.hypot(x, z) >= 6 && a.welt.getGroundHeight(x, z) !== vorher.get(`${x},${z}`)) ausserhalb++;
  pruefe(ausserhalb === 0, `2: außerhalb des Radius bleibt der Boden (${ausserhalb} Abweichungen)`);
  pruefe(a.aktionen.protokoll().length === 1 && a.entwurf.schreibungen() === 1, '2: ein Strich = ein Vorgang, ein Schreiben');
  pruefe(abweichungen(a.welt, frischAus(a), raster(14)) === 0, '2: das Gelände ist bitgleich zur frisch kompilierten Welt aus dem Entwurf (Server-Weg)');
  pruefe(basis.getGroundHeight(0, 0) === vorher.get('0,0'), '2: Vorbedingung: die Basis war, was das Gelände vorher zeigte');

  // Limit: a target 150 m above the ground breaks ±100 m → the WHOLE stroke is refused, not shortened
  const b = aufbau(LAYOUT as unknown as Record<string, unknown>);
  b.ein.werkzeug = 'ebnen';
  b.ein.ziel = klemmeZiel(b.welt.getGroundHeight(0, 0) + 150);
  const h0 = b.welt.getGroundHeight(0, 0);
  strich(b, [0, 0], [3, 0], 4);
  pruefe(b.entwurf.doc().heightDeltas === undefined && b.aktionen.protokoll().length === 0 && b.entwurf.schreibungen() === 0, '2: Grenze gerissen: Strich abgelehnt, nichts im Entwurf');
  pruefe(b.welt.getGroundHeight(0, 0) === h0, '2: … und das lebende Gelände ist wieder wie vorher (nicht gekürzt)');
  pruefe(b.meldungen.some((m) => m.includes('100 m') && m.includes('zurückgenommen')), `2: … und das HUD nennt Grund und Rücknahme („${b.meldungen.at(-1)}“)`);

  // No target: no stroke, HUD says what to do
  const c = aufbau(LAYOUT as unknown as Record<string, unknown>);
  c.ein.werkzeug = 'ebnen';
  c.steuerung.druecken({ x: 0, z: 0 }, false);
  pruefe(!c.steuerung.strichOffen && c.meldungen.some((m) => m.includes('Zielhöhe')), '2: ohne Zielhöhe beginnt kein Strich, das HUD sagt, wie man eine wählt');
  pruefe(c.entwurf.schreibungen() === 0, '2: … und der Entwurf bleibt unberührt');
}

// ── 3. Pipette ────────────────────────────────────────────────────────────────
{
  const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
  a.ein.werkzeug = 'anheben';
  strich(a, [0, 0], [4, 0], 8);
  const x = 0.4;
  const z = -0.3;
  const gelesen = a.steuerung.pipetteAn({ x, z });
  const frisch = frischAus(a);
  const soll = klemmeZiel(frisch.getGroundHeight(x, z));
  pruefe(gelesen === soll && a.ein.ziel === soll, `3: die Pipette liest die Höhe der Welt aus dem Entwurf: ${gelesen} = ${soll}`);
  // the compile path itself: geo compiled from layout + the draft's layer, no world object in between
  const doc = a.entwurf.doc() as unknown as WorldLayout;
  const geo = createGeo({ mode: 'layout', worldSeed: getStableHash(NAME), layout: doc }) as RegionGeo;
  const hm = new HeightmapProvider(geo, { blendSmoothStep: true });
  pruefe(klemmeZiel(hm.getGroundHeight(x, z)) === gelesen, '3: … und gleich der Höhe aus `createGeo` (layout + Ebene), dem Server-Weg');
  pruefe(Math.abs(gelesen - basisWelt().getGroundHeight(x, z)) > 0.3, `3: sie liest den KORRIGIERTEN Boden, nicht die Basis (${basisWelt().getGroundHeight(x, z).toFixed(2)} → ${gelesen})`);
  pruefe(gelesen !== 0, '3: … und nicht 0');
  pruefe(a.meldungen.some((m) => m.includes(gelesen.toFixed(2)) && m.includes('Pipette')), '3: das HUD nennt die übernommene Höhe');
  pruefe(pipette(() => 1.23456, 0, 0) === 1.23 && pipette(() => 7, 5, 5) === 7, '3: pipette rundet auf ganze cm');
  // The pipette only reads
  pruefe(a.aktionen.protokoll().length === 1, '3: die Pipette schreibt nichts (Protokoll unverändert)');
  // Level with the picked height: a second place gets pulled to exactly that height
  a.ein.werkzeug = 'ebnen';
  strich(a, [30, 0], [30, 0], 6);
  pruefe(Math.abs(a.welt.getGroundHeight(30, 0) - soll) < 0.006, `3: Pipette → Ebnen an anderer Stelle: ${a.welt.getGroundHeight(30, 0).toFixed(3)} ↔ ${soll}`);
}

// ── 4. Zurücksetzen ───────────────────────────────────────────────────────────
{
  const k = new DeltaKarte();
  for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) {
    const p = punktVon(x, z);
    k.setze(p.zx, p.zz, p.index, 100);
  }
  const s = berechneStempel(k, eingabe(0, 0, { werkzeug: 'zuruecksetzen', radius: 6 }));
  pruefe(s.find((a) => a.index === 32 * 64 + 32)?.neu === 0, '4: Mitte: Handkorrektur weg (0)');
  pruefe(s.every((a) => a.neu >= 0 && a.neu < a.alt), '4: nur Verringerung Richtung 0, nie darüber hinaus');
  pruefe(!s.some((a) => a.index === 32 * 64 + 38), '4: außerhalb des Radius nichts');
  const rand = s.find((a) => a.index === 32 * 64 + 37);
  pruefe(rand !== undefined && rand.neu > 0 && rand.neu < 100, `4: am Rand nur teilweise (kein Absatz): ${rand?.neu} cm`);
  pruefe(berechneStempel(new DeltaKarte(), eingabe(0, 0, { werkzeug: 'zuruecksetzen' })).length === 0, '4: ohne Handkorrektur ändert sich nichts');

  const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
  const basis = basisWelt();
  a.ein.werkzeug = 'anheben';
  strich(a, [0, 0], [0, 0], 6);
  strich(a, [40, 0], [40, 0], 6);
  pruefe(abweichungen(a.welt, basis, raster(8)) > 20, '4: Vorbedingung: der erste Hügel verändert den Boden');
  const zweiterHuegel = new Map<string, number>();
  for (const [x, z] of raster(8)) zweiterHuegel.set(`${x},${z}`, a.welt.getGroundHeight(40 + x, z));
  const vorgaenge = a.aktionen.protokoll().length;
  a.ein.werkzeug = 'zuruecksetzen';
  a.ein.radius = 12;
  strich(a, [0, 0], [0, 0], 4);
  pruefe(abweichungen(a.welt, basis, raster(14)) === 0, '4: nach dem Zurücksetzen ist der Boden um den ersten Hügel gleich der Basis (bitgleich, 29×29 Punkte)');
  let zweiterGleich = 0;
  for (const [x, z] of raster(8)) if (a.welt.getGroundHeight(40 + x, z) === zweiterHuegel.get(`${x},${z}`)) zweiterGleich++;
  pruefe(zweiterGleich === raster(8).length, `4: der zweite Hügel bleibt unverändert (${zweiterGleich}/${raster(8).length} Punkte gleich)`);
  pruefe(a.aktionen.protokoll().length === vorgaenge + 1, '4: das Zurücksetzen ist ein Vorgang');
  const zonen = JSON.stringify(a.entwurf.doc().heightDeltas);
  pruefe(zonen !== undefined && !zonen.includes('"zx":0,"zz":0,"r":["31'), '4: die Ebene enthält die Punkte des ersten Hügels nicht mehr');
  // Reset where nothing was corrected: no Vorgang, no write
  const schreib = a.entwurf.schreibungen();
  strich(a, [-60, -60], [-55, -60], 4);
  pruefe(a.entwurf.schreibungen() === schreib && a.aktionen.protokoll().length === vorgaenge + 1, '4: Zurücksetzen ohne Handkorrektur schreibt nichts');
  // and the base itself is unchanged: the stroke only ever touches the layer
  pruefe(abweichungen(basisWelt(), basis, raster(14)) === 0, '4: die Basis selbst bleibt unverändert');
}

// ── 5. Rückgängig / Wiederholen ──────────────────────────────────────────────
{
  const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
  const basis = basisWelt();
  const S0 = ebene(a);
  a.ein.werkzeug = 'anheben';
  strich(a, [0, 0], [6, 0], 10);
  const S1 = ebene(a);
  a.ein.werkzeug = 'ebnen';
  a.ein.ziel = klemmeZiel(a.welt.getGroundHeight(20, 0) + 2);
  strich(a, [20, 0], [20, 0], 6);
  const S2 = ebene(a);
  pruefe(S0 !== S1 && S1 !== S2 && S0 === 'null', '5: Vorbedingung: drei verschiedene Zustände der Ebene');
  const frischGleich = (): number => abweichungen(a.welt, frischAus(a), raster(30, 2));

  pruefe(a.steuerung.rueckgaengig() === true && ebene(a) === S1, '5: Rückgängig 1 → Zustand nach dem ersten Strich (bitgleich, genau EIN Strich zurück)');
  pruefe(frischGleich() === 0, '5: … und das Gelände ist bitgleich zur Welt aus dem Entwurf');
  pruefe(a.steuerung.rueckgaengig() === true && ebene(a) === S0, '5: Rückgängig 2 → Zustand vor allem (keine Ebene im Entwurf)');
  pruefe(abweichungen(a.welt, basis, raster(30, 2)) === 0, '5: … und das Gelände ist gleich der Basis');
  pruefe(a.steuerung.rueckgaengig() === false && a.meldungen.at(-1)!.includes('Nichts zum Rückgängigmachen'), '5: Rückgängig 3: nichts mehr, HUD sagt es');
  pruefe(a.steuerung.wiederholen() === true && ebene(a) === S1, '5: Wiederholen 1 → bitgleich Zustand 1');
  pruefe(a.steuerung.wiederholen() === true && ebene(a) === S2, '5: Wiederholen 2 → bitgleich Zustand 2');
  pruefe(frischGleich() === 0, '5: … und das Gelände ist bitgleich zur Welt aus dem Entwurf');
  pruefe(a.steuerung.wiederholen() === false && a.meldungen.at(-1)!.includes('Nichts zum Wiederholen'), '5: Wiederholen 3: nichts mehr');
  // A new stroke ends the redo line
  a.steuerung.rueckgaengig();
  a.ein.werkzeug = 'anheben';
  strich(a, [-30, 0], [-30, 0], 4);
  pruefe(a.steuerung.wiederholen() === false, '5: nach einem neuen Strich gibt es nichts mehr zu wiederholen');
  pruefe(a.steuerung.rueckgaengig() === true, '5: … aber der neue Strich lässt sich zurücknehmen');

  // Mixed with an object: Ctrl+Z takes back the TERRAIN stroke only, the object stays, its y follows the ground
  const b = aufbau(LAYOUT as unknown as Record<string, unknown>);
  b.ein.werkzeug = 'anheben';
  strich(b, [0, 0], [0, 0], 6);
  const hoch = b.welt.getGroundHeight(1, 1);
  const doc = b.entwurf.doc();
  doc.placements = [...((doc.placements as unknown[]) ?? []), { id: 'neu1', prefab: 'U_Fass', x: 1, z: 1 }];
  b.entwurf.setze(doc);
  b.angezeigt.set(0, b.welt.getGroundHeight(1, 1));
  pruefe(b.steuerung.rueckgaengig() === true, '5: gemischt: Rückgängig nach einer Objekt-Platzierung nimmt den Strich zurück');
  pruefe(b.entwurf.doc().heightDeltas === undefined, '5: … die Ebene ist leer');
  const nachher = b.entwurf.doc().placements as Array<{ id: string }>;
  pruefe(nachher.length === 1 && nachher[0]!.id === 'neu1', '5: … und die Platzierung steht noch im Entwurf (Rückgängig ist nur für Gelände)');
  pruefe(Math.abs(b.angezeigt.get(0)! - b.welt.getGroundHeight(1, 1)) < 1e-9 && b.angezeigt.get(0)! < hoch - 0.1, '5: … und das Objekt steht wieder auf dem alten Boden');
  pruefe(b.steuerung.rueckgaengig() === false && (b.entwurf.doc().placements as unknown[]).length === 1, '5: ein weiteres Rückgängig nimmt die Platzierung NICHT zurück');
  b.steuerung.wiederholen();
  pruefe(Math.abs(b.angezeigt.get(0)! - hoch) < 1e-9, '5: Wiederholen stellt den Strich und die Höhe des Objekts wieder her');

  // A foreign change empties the history
  const c = aufbau(LAYOUT as unknown as Record<string, unknown>);
  c.ein.werkzeug = 'anheben';
  strich(c, [0, 0], [0, 0], 4);
  const fremd = new DeltaKarte();
  const p = punktVon(40, 40);
  fremd.setze(p.zx, p.zz, p.index, 300);
  c.entwurf.setze({ ...LAYOUT, heightDeltas: fremd.alsZonen() });
  pruefe(c.steuerung.rueckgaengig() === false && c.meldungen.at(-1)!.includes('Nichts zum Rückgängigmachen'), '5: hat ein anderer Tab den Entwurf geändert, ist der Verlauf leer („Nichts zum Rückgängigmachen“, kein Konflikt)');
  pruefe(ebene(c).includes('"zx":1') || ebene(c).includes('"zx":0'), '5: … und der fremde Stand bleibt stehen');

  // An open stroke is not torn by Ctrl+Z
  const d = aufbau(LAYOUT as unknown as Record<string, unknown>);
  d.ein.werkzeug = 'anheben';
  strich(d, [0, 0], [0, 0], 3);
  d.steuerung.druecken({ x: 20, z: 0 }, false);
  pruefe(d.steuerung.rueckgaengig() === false && d.steuerung.strichOffen, '5: bei offenem Strich tut Rückgängig nichts und reißt ihn nicht ab');
  d.steuerung.loslassen();
  pruefe(d.steuerung.rueckgaengig() === true, '5: nach dem Loslassen geht es');

  // Keys
  const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  pruefe(verlaufTaste(k('z', { ctrlKey: true })) === 'rueckgaengig' && verlaufTaste(k('Z', { metaKey: true })) === 'rueckgaengig', '5: Strg/Cmd+Z = Rückgängig');
  pruefe(verlaufTaste(k('y', { ctrlKey: true })) === 'wiederholen' && verlaufTaste(k('Z', { ctrlKey: true, shiftKey: true })) === 'wiederholen', '5: Strg+Y und Strg+Umschalt+Z = Wiederholen');
  pruefe(verlaufTaste(k('z')) === null && verlaufTaste(k('y')) === null && verlaufTaste(k('z', { ctrlKey: true, altKey: true })) === null, '5: ohne Strg/Cmd oder mit Alt (AltGr) nichts');
  pruefe(verlaufTaste(k('y', { ctrlKey: true, shiftKey: true })) === null && verlaufTaste(k('x', { ctrlKey: true })) === null, '5: Strg+Umschalt+Y und andere Tasten nichts');
  // History depth
  const v = new GelaendeVerlauf();
  for (let i = 0; i < VERLAUF_MAX + 5; i++) v.neu({ vorgangId: `v${i}`, aenderungen: [{ zx: 0, zz: 0, index: i, alt: 0, neu: 1 }] });
  pruefe(v.tiefe.rueckgaengig === VERLAUF_MAX, `5: der Verlauf hält höchstens ${VERLAUF_MAX} Striche`);
  let inv: string | null = null;
  v.rueckgaengig((x) => ((inv = x.vorgangId), x));
  pruefe(inv === `~v${VERLAUF_MAX + 4}` && v.tiefe.rueckgaengig === VERLAUF_MAX - 1 && v.tiefe.wiederholen === 1, '5: Rückgängig gibt die Umkehr des letzten Strichs heraus und nur diesen');
  pruefe(v.rueckgaengig(() => null) === null && v.tiefe.rueckgaengig === VERLAUF_MAX - 1, '5: lehnt die Anwendung ab, bleibt der Schritt stehen');
}

// ── 6. Lose Objekte ───────────────────────────────────────────────────────────
{
  const PL: SperrPlatzierung[] & Array<{ id: string }> = [
    { id: 'fass', prefab: 'U_Fass', x: 0.5, z: 0.5 },
    { id: 'karren', prefab: 'U_Karren', x: 3, z: -2 },
    { id: 'baum', prefab: 'Baum', x: -2, z: 2 },
    { id: 'haus', prefab: 'U_Wohnhaus', x: 50, z: 0 },
    { id: 'sockel', prefab: 'U_Fass', x: -50, z: 0, einebnen: 6 },
    { id: 'fern', prefab: 'U_Fass', x: 30, z: 30 },
  ];
  pruefe(JSON.stringify(loseIndizes(PL, katalog)) === '[0,1,2,5]', `6: lose sind Fass, Karren, Baum und das ferne Fass; Haus und Sockel nicht (${JSON.stringify(loseIndizes(PL, katalog))})`);
  pruefe(istLose(PL[0]!, katalog) && !istLose(PL[3]!, katalog) && !istLose(PL[4]!, katalog), '6: istLose: Fass ja, Gebäude nein, Sockel nein');
  pruefe(!istLose({ prefab: 'U_Fass', x: 0, z: 0, einebnen: 3 }, katalog), '6: ein Fass auf einem Sockel ist nicht lose (der Sockel sperrt)');

  const a = aufbau({ ...LAYOUT, placements: PL });
  const start = new Map(a.angezeigt);
  a.ein.werkzeug = 'anheben';
  strich(a, [0, 0], [0, 0], 8);
  const liste = a.nachListen.at(-1) as number[];
  pruefe(JSON.stringify(liste) === '[0,1,2]', `6: nach dem Strich werden nur die losen Objekte unter dem Strich neu aufgesetzt (${JSON.stringify(liste)})`);
  for (const i of [0, 1, 2]) {
    const p = PL[i]!;
    pruefe(Math.abs(a.angezeigt.get(i)! - a.welt.getGroundHeight(p.x, p.z)) < 1e-9, `6: ${PL[i]!.prefab}: y = neue Bodenhöhe (Toleranz 1e-9 m): ${a.angezeigt.get(i)!.toFixed(3)}`);
    pruefe(a.angezeigt.get(i)! > start.get(i)! + 0.05, `6: ${PL[i]!.prefab}: y hat sich gehoben (${start.get(i)!.toFixed(3)} → ${a.angezeigt.get(i)!.toFixed(3)})`);
  }
  for (const i of [3, 4, 5]) pruefe(a.angezeigt.get(i) === start.get(i), `6: ${PL[i]!.id} bleibt unverändert`);
  const hoch = new Map(a.angezeigt);
  a.steuerung.rueckgaengig();
  for (const i of [0, 1, 2]) pruefe(Math.abs(a.angezeigt.get(i)! - start.get(i)!) < 1e-9, `6: nach Rückgängig steht ${PL[i]!.id} an der alten Stelle (y ${a.angezeigt.get(i)!.toFixed(3)})`);
  for (const i of [3, 4, 5]) pruefe(a.angezeigt.get(i) === start.get(i), `6: … ${PL[i]!.id} unverändert`);
  a.steuerung.wiederholen();
  for (const i of [0, 1, 2]) pruefe(a.angezeigt.get(i) === hoch.get(i), `6: Wiederholen bringt ${PL[i]!.id} bitgleich wieder auf die neue Höhe`);

  // A foreign change under a building: the draft is the truth, the ground follows and EVERY placement near it is put on it (N1/A2)
  const b = aufbau({ ...LAYOUT, placements: [...PL, { id: 'nah', prefab: 'U_Fass', x: 50, z: 3 }] });
  const vorher = new Map(b.angezeigt);
  const fremd = new DeltaKarte();
  for (let z = -6; z <= 6; z++) for (let x = 44; x <= 56; x++) {
    const p = punktVon(x, z);
    fremd.setze(p.zx, p.zz, p.index, 250);
  }
  b.steuerung.bereit();
  b.entwurf.setze({ ...LAYOUT, placements: [...PL, { id: 'nah', prefab: 'U_Fass', x: 50, z: 3 }], heightDeltas: fremd.alsZonen() });
  b.steuerung.entwurfGeaendert();
  pruefe(b.angezeigt.get(6)! > vorher.get(6)! + 2 && Math.abs(b.angezeigt.get(6)! - b.welt.getGroundHeight(50, 3)) < 1e-9, '6: fremde Änderung: das lose Fass neben dem Haus folgt dem neuen Boden');
  pruefe(Math.abs(b.angezeigt.get(3)! - b.welt.getGroundHeight(50, 0)) < 1e-9 && b.angezeigt.get(3)! > vorher.get(3)! + 2, '6: … das Haus wird ebenfalls auf den neuen Boden gesetzt (N1/A2: kein Gebäude schwebt, der Server stellt jede Platzierung auf den Boden)');
  pruefe((b.nachListen.at(-1) as number[]).includes(6) && (b.nachListen.at(-1) as number[]).includes(3), '6: … die Liste der Neuaufsetzung enthält das Fass und das Haus');
}

// ── 7. Bewuchs ────────────────────────────────────────────────────────────────
{
  const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
  type Stand = { x: number; y: number; z: number };
  const live = new Map<string, { position: Stand }>();
  const ent = {
    applyUpdate: (u: { key: string; position: Stand }): void => void live.set(u.key, u),
    removeZDO: (k: string): void => void live.delete(k),
    flush: (): void => undefined,
  };
  const v = new BewuchsVorschau({ seed: a.welt.seed, geo: a.welt.geo, heightmaps: a.welt.heightmaps, regionGeo: a.welt.regionGeo }, ent as never);
  let ms = 100000;
  const streue = (): void => {
    for (let i = 0; i < 40; i++) v.schritt(0, 0, (ms += 16));
  };
  streue();
  const nah = (): Array<{ x: number; y: number; z: number }> => [...live.values()].map((u) => u.position).filter((p) => Math.hypot(p.x, p.z) <= 12);
  const abstand = (): number => Math.max(0, ...nah().map((p) => Math.abs(p.y - a.welt.getGroundHeight(p.x, p.z))));
  // The catalogue of this stand has NO vegetation of its own (`FOLIAGE` is filtered to own models: every entry is
  // skipped), so the preview scatters nothing and there is no plant that could stand on the old ground. The ground
  // check below runs as soon as the catalogue has vegetation again; until then the wiring is what is proven.
  const keineVegetation = nah().length === 0;
  if (keineVegetation) console.log('  (7: Bodenprüfung übersprungen — der Katalog hat in diesem Stand keine eigene Vegetation, es wird nichts gestreut)');
  if (!keineVegetation) {
  pruefe(nah().length >= 5, `7: Vorbedingung: Bewuchs im Kreis von 12 m um die Mitte (${nah().length} Pflanzen)`);
  const grundrauschen = abstand();
  pruefe(grundrauschen < 0.6, `7: vor dem Strich sitzt der Bewuchs auf dem Boden (größte Abweichung ${grundrauschen.toFixed(3)} m)`);
  a.ein.werkzeug = 'anheben';
  strich(a, [0, 0], [0, 0], 10);
  pruefe(abstand() > 0.3, `7: ohne Neuaufbau bleibt der Bewuchs auf dem alten Boden stehen (Abweichung ${abstand().toFixed(2)} m): der Flug muss neu streuen`);
  v.neuAufbauen();
  streue();
  pruefe(nah().length >= 5 && abstand() <= grundrauschen + 0.05, `7: nach dem Neuaufbau sitzt er auf dem neuen Boden (Abweichung ${abstand().toFixed(3)} m, Grundrauschen ${grundrauschen.toFixed(3)} m)`);
  }
  const tf = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  pruefe(/nachStrich: \(lose\) => \{\s*if \(lose === 'alle'\) neuAufbauenAlle\(\);\s*else neuAufbauenLose\(lose\);[^}]*bewuchs\?\.neuAufbauen\(\);/.test(tf), '7: Testflug.ts: nach Strich/Rückgängig/Wiederholen baut die Bewuchs-Vorschau neu');
}

// ── 8. Der storage-Hörer ──────────────────────────────────────────────────────
{
  let hoerer: ((e: { key: string | null }) => void) | null = null;
  let entfernt = 0;
  const ziel: StorageZiel = {
    addEventListener: (_a, f) => void (hoerer = f),
    removeEventListener: (_a, f) => {
      if (f === hoerer) entfernt++;
    },
  };
  let offen = false;
  let n = 0;
  const weg = verdrahteEntwurfHoerer(ziel, 'wov-editor-layout', () => offen, () => n++);
  pruefe(hoerer !== null, '8: der Hörer ist eingehängt');
  hoerer!({ key: 'wov-editor-layout' });
  hoerer!({ key: null });
  pruefe(n === 0, `8: bei geschlossenem Gelände-Reiter arbeitet der Hörer nicht (${n} Aufrufe)`);
  offen = true;
  hoerer!({ key: 'wov-editor-layout' });
  pruefe(n === 1, '8: bei offenem Reiter gleicht der Schlüssel des Entwurfs ab');
  hoerer!({ key: null });
  pruefe(n === 2, '8: `key === null` (clear() im anderen Tab) gleicht ab');
  hoerer!({ key: 'etwas-anderes' });
  pruefe(n === 2, '8: ein fremder Schlüssel tut nichts');
  weg();
  pruefe(entfernt === 1, '8: die Rückgabe hängt den Hörer wieder aus');
  const tf = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  pruefe(/verdrahteEntwurfHoerer\([\s\S]*?ENTWURF_KEY,\s*\(\) => panel\.istGelaendeModus,\s*\(\) => gelaende\.entwurfGeaendert\(\)/.test(tf), '8: Testflug.ts hängt den Hörer mit ENTWURF_KEY und „Reiter offen“ ein');
  pruefe(!/addEventListener\('storage'/.test(tf.replace(/addEventListener: \(art, f\) => window\.addEventListener\(art, f\)/, '')), '8: Testflug.ts hat keinen zweiten, ungeschützten storage-Hörer');
  // Opening the tab compares once (the closed tab took no events)
  pruefe(/gelaende\.entwurfGeaendert\(\);\s*const e = panel\.gelaendeEinstellung;/.test(tf), '8: beim Öffnen des Reiters wird einmal mit dem Entwurf abgeglichen');
}

// ── 9. Verdrahtung und Texte ──────────────────────────────────────────────────
{
  const tf = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  const sp = readFileSync(resolve(HIER, '../src/editor/SpawnPanel.ts'), 'utf-8');
  pruefe(/verlaufEntscheid\(e, panel\.istGelaendeModus, tipptImFeld\(e\)\)/.test(tf) && tf.includes("verlauf.aktion === 'rueckgaengig' ? gelaende.rueckgaengig() : gelaende.wiederholen()"), '9: Strg+Z/Y im Reiter laufen über verlaufEntscheid (Reiter offen, Textfeld)');
  pruefe(sp.includes("['ebnen', 'testflug.gelaende.werkzeug.ebnen']") && sp.includes("['zuruecksetzen', 'testflug.gelaende.werkzeug.zuruecksetzen']"), '9: das Panel hat die Knöpfe Ebnen und Zurücksetzen');
  pruefe(sp.includes("ziel.type = 'number'") && sp.includes('setzeZiel(hoehe: number)'), '9: das Panel hat das Zahlenfeld für die Zielhöhe');
  const de = JSON.parse(readFileSync(resolve(HIER, '../src/i18n/katalog/de.json'), 'utf-8')) as Record<string, string>;
  const en = JSON.parse(readFileSync(resolve(HIER, '../src/i18n/katalog/en.json'), 'utf-8')) as Record<string, string>;
  const neu = [
    'nichts_rueckgaengig',
    'nichts_wiederholen',
    'pipette',
    'rueckgaengig',
    'tip3',
    'werkzeug.ebnen',
    'werkzeug.zuruecksetzen',
    'wiederholt',
    'ziel_fehlt',
    'ziel_m',
  ].map((s) => `testflug.gelaende.${s}`);
  pruefe(neu.every((k) => typeof de[k] === 'string' && typeof en[k] === 'string' && de[k] !== en[k]), '9: alle neuen Schlüssel in de und en, verschieden');
  const platzhalter = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  pruefe(neu.every((k) => platzhalter(de[k]!) === platzhalter(en[k]!)), '9: … mit denselben Platzhaltern');
}

// ── 10. N1/A1 + N2/N1-1: Ebnen neben einem Sockel schwingt sich ein, auch über viele Striche ──
{
  const SOCKEL: SperrPlatzierung = { id: 'sockel', prefab: 'U_Fass', x: 0, z: 0, einebnen: 6 } as SperrPlatzierung;
  const roh = basisWelt();
  /** `bewegung`: one stroke = press, three held stamps, release (a short click), or a pass along z at x = d. */
  const lauf = (versatz: number, d: number, art: 'klicks' | 'bahnen' | 'halten', n: number, sekunden = 0): void => {
    const a = aufbau({ ...LAYOUT, placements: [SOCKEL] });
    const platte = a.welt.getGroundHeight(0, 0);
    const ziel = klemmeZiel(platte + versatz);
    a.ein.werkzeug = 'ebnen';
    a.ein.radius = 6;
    a.ein.ziel = ziel;
    const punkte = raster(9).map(([x, z]) => [Math.round(d) + x, art === 'bahnen' ? z * 2 : z] as [number, number]);
    for (let i = 0; i < n; i++) {
      if (art === 'klicks') {
        a.steuerung.druecken({ x: d, z: 0 }, false);
        for (let k = 0; k < 3; k++) {
          a.setzeZeit(130);
          a.steuerung.tick({ x: d, z: 0 }, false);
        }
        a.steuerung.loslassen();
      } else if (art === 'bahnen') {
        strich(a, [d, -15], [d, 15], 12);
      } else {
        a.steuerung.druecken({ x: d, z: 0 }, false);
        for (let k = 0; k < Math.round(sekunden / 0.13); k++) {
          a.setzeZeit(130);
          a.steuerung.tick({ x: d, z: 0 }, false);
        }
        a.steuerung.loslassen();
      }
    }
    const name = `${art} ${n}× Ziel ${versatz >= 0 ? '+' : ''}${versatz} m bei d=${d}${sekunden ? `, ${sekunden} s` : ''}`;
    pruefe(!a.meldungen.some((m) => m.includes('zurückgenommen')), `10: ${name}: kein Strich wird abgelehnt`);
    const karte = karteAusEntwurf(a.entwurf.doc().heightDeltas) ?? new DeltaKarte();
    let verletzt = 0;
    let maxC = 0;
    let darueber = 0;
    for (const [x, z] of punkte) {
      const c = deltaAn(karte, x, z);
      maxC = Math.max(maxC, Math.abs(c));
      const soll = Math.round((ziel - roh.getGroundHeight(x, z)) * 100);
      if (Math.sign(c) * Math.sign(soll) < 0 || Math.abs(c) > Math.abs(soll)) verletzt++;
      const hn = a.welt.getGroundHeight(x, z);
      const h0 = roh.getGroundHeight(x, z);
      if ((ziel > h0 && hn > Math.max(ziel, platte) + 0.011) || (ziel < h0 && hn < Math.min(ziel, platte) - 0.011)) darueber++;
    }
    pruefe(verletzt === 0, `10: ${name}: die gespeicherte Korrektur bleibt je Punkt zwischen 0 und Ziel − Rohhöhe (${verletzt} Verletzungen, größte ${(maxC / 100).toFixed(2)} m)`);
    pruefe(darueber === 0, `10: ${name}: der Boden schießt nicht über Ziel und Platte hinaus (${darueber})`);
  };
  lauf(8, 12.2, 'halten', 1, 14);
  lauf(-4, 12.2, 'halten', 1, 14);
  for (const [versatz, d] of [[-4, 12.2], [8, 12.2], [3, 12.2], [-2, 12.2], [-4, 16], [-4, 20]] as const) lauf(versatz, d, 'klicks', 30);
  lauf(-4, 12.2, 'klicks', 10);
  lauf(8, 12.2, 'klicks', 10);
  lauf(-2, 12.5, 'bahnen', 10);
  lauf(3, 12.5, 'bahnen', 10);
  // the stored number is the same however it was made: 1 stroke and 30 strokes end on the same correction at a vertex
  {
    const einer = aufbau({ ...LAYOUT, placements: [SOCKEL] });
    const viele = aufbau({ ...LAYOUT, placements: [SOCKEL] });
    const ziel = klemmeZiel(einer.welt.getGroundHeight(0, 0) - 4);
    for (const a of [einer, viele]) {
      a.ein.werkzeug = 'ebnen';
      a.ein.ziel = ziel;
    }
    for (let i = 0; i < 40; i++) {
      viele.steuerung.druecken({ x: 16, z: 0 }, false);
      viele.setzeZeit(130);
      viele.steuerung.tick({ x: 16, z: 0 }, false);
      viele.steuerung.loslassen();
    }
    einer.steuerung.druecken({ x: 16, z: 0 }, false);
    for (let i = 0; i < 80; i++) {
      einer.setzeZeit(130);
      einer.steuerung.tick({ x: 16, z: 0 }, false);
    }
    einer.steuerung.loslassen();
    const c1 = deltaAn(karteAusEntwurf(einer.entwurf.doc().heightDeltas)!, 16, 0);
    const c2 = deltaAn(karteAusEntwurf(viele.entwurf.doc().heightDeltas)!, 16, 0);
    pruefe(c1 === c2 && c1 === Math.round((ziel - roh.getGroundHeight(16, 0)) * 100), `10: ein langer und 40 kurze Striche enden auf derselben Korrektur ${c1} cm = Ziel − Rohhöhe (${c2})`);
  }
  // glaetten / anheben stay bounded next to the plinth
  for (const werkzeug of ['glaetten', 'anheben'] as const) {
    const a = aufbau({ ...LAYOUT, placements: [SOCKEL] });
    a.ein.werkzeug = werkzeug;
    a.ein.radius = 6;
    a.ein.staerke = werkzeug === 'glaetten' ? 25 : 20;
    a.steuerung.druecken({ x: 12.2, z: 0 }, false);
    for (let i = 0; i < 100; i++) {
      a.setzeZeit(130);
      a.steuerung.tick({ x: 12.2, z: 0 }, false);
    }
    a.steuerung.loslassen();
    const k = karteAusEntwurf(a.entwurf.doc().heightDeltas) ?? new DeltaKarte();
    pruefe(!a.meldungen.some((m) => m.includes('zurückgenommen')) || werkzeug === 'anheben', `10: ${werkzeug} am Sockel gehalten wird nicht abgelehnt`);
    pruefe(k.punktzahl < 100_000, `10: ${werkzeug} am Sockel gehalten bleibt beschränkt`);
  }
  // pure: a ground that follows only a tenth; the correction goes to Ziel − Rohhöhe and stays there, stroke after stroke
  const k = new DeltaKarte();
  const nichtFolgend = (x: number, z: number): number => 3 + (deltaAn(k, x, z) / 100) * 0.1;
  for (let strichNr = 0; strichNr < 5; strichNr++) {
    const st = new Strich(k, `s${strichNr}`);
    for (let i = 0; i < 100; i++) st.stempel(eingabe(0, 0, { werkzeug: 'ebnen', ziel: 5, hoehe: nichtFolgend, roh: () => 3 }), false);
    pruefe(deltaAn(k, 0, 0) === 200, `10: Boden, der nur ein Zehntel folgt: nach Strich ${strichNr + 1} steht die Korrektur in der Mitte auf ${deltaAn(k, 0, 0)} cm (= Ziel − Rohhöhe, nie mehr)`);
  }
  // raw height: the same as the world without plinths and without correction, whatever the live layout holds
  const mitAllem = aufbau({ ...LAYOUT, placements: [SOCKEL], heightDeltas: [{ zx: 0, zz: 0, r: ['10|50,51|500,500'] }] });
  const rohQ = rohHoehenQuelle(mitAllem.welt.geo)!;
  let rohAbw = 0;
  for (const [x, z] of raster(14)) if (rohQ(x, z) !== roh.getGroundHeight(x, z)) rohAbw++;
  pruefe(rohAbw === 0, `10: Rohhöhe = Welt ohne Sockel und ohne Korrektur, bitgleich (${rohAbw} Abweichungen auf 841 Punkten, obwohl das Layout Sockel und Korrektur trägt)`);
  pruefe(Math.abs(mitAllem.welt.getGroundHeight(18, -22) - roh.getGroundHeight(18, -22)) > 4 && rohHoehenQuelle({}) === null, '10: … die sichtbare Höhe weicht dort ab, ein Nicht-Layout-Gelände gibt keine Rohquelle');
}

// ── 11. N1/A2 + N2: Rückgängig/Wiederholen halten die Sperre als Ganzes ───────
{
  const hausDazu = (a: Aufbau, mehr: Array<Record<string, unknown>> = [{ id: 'haus', prefab: 'U_Wohnhaus', x: 0, z: 0 }]): void => {
    const d = a.entwurf.doc();
    d.placements = mehr;
    a.entwurf.setze(d);
  };
  const hoehen = (a: Aufbau, r = 13): string => raster(r).map(([x, z]) => a.welt.getGroundHeight(x, z)).join(',');
  const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
  a.ein.werkzeug = 'ebnen';
  a.ein.radius = 12;
  a.ein.ziel = klemmeZiel(a.welt.getGroundHeight(0, 0) + 2);
  strich(a, [0, 0], [0, 0], 6);
  const S1 = ebene(a);
  const hoch = hoehen(a);
  hausDazu(a);
  pruefe(a.steuerung.rueckgaengig() === false, '11: Haus nach dem Strich gesetzt: Rückgängig wird abgelehnt');
  pruefe(ebene(a) === S1 && hoehen(a) === hoch, '11: … die Ebene und der Boden sind unverändert (kein Podest, auch außerhalb des Hauskreises nichts zurückgenommen)');
  pruefe(a.meldungen.at(-1)!.includes('Schritt nicht möglich') && /\d+ Punkte/.test(a.meldungen.at(-1)!), `11: … das HUD sagt es („${a.meldungen.at(-1)}“)`);
  pruefe(a.steuerung.rueckgaengig() === false && ebene(a) === S1, '11: … ein zweites Strg+Z springt nicht still auf einen früheren Schritt (hier gibt es keinen) und ändert nichts');
  hausDazu(a, []);
  pruefe(a.steuerung.rueckgaengig() === true && ebene(a) === 'null', '11: Haus wieder weg: derselbe Schritt lässt sich zurücknehmen (er war im Verlauf geblieben)');
  pruefe(abweichungen(a.welt, basisWelt(), raster(14)) === 0, '11: … der Boden ist wieder die Basis');
  // redo refused under a house set after the undo
  hausDazu(a);
  pruefe(a.steuerung.wiederholen() === false && ebene(a) === 'null' && a.meldungen.at(-1)!.includes('Schritt nicht möglich'), '11: Haus nach dem Rückgängig gesetzt: Wiederholen wird abgelehnt, nichts ändert sich');
  hausDazu(a, []);
  pruefe(a.steuerung.wiederholen() === true && ebene(a) === S1, '11: Haus weg: Wiederholen stellt den Strich bitgleich wieder her');

  // two strokes, a house over the second one: refused whole, the stroke before is NOT undone instead
  const b = aufbau(LAYOUT as unknown as Record<string, unknown>);
  b.ein.werkzeug = 'anheben';
  b.ein.radius = 6;
  strich(b, [30, 0], [30, 0], 4);
  const nachA = ebene(b);
  b.ein.radius = 12;
  strich(b, [0, 0], [0, 0], 6);
  const nachB = ebene(b);
  const bHoehe = hoehen(b, 40);
  hausDazu(b);
  pruefe(b.steuerung.rueckgaengig() === false && b.steuerung.rueckgaengig() === false, '11: zwei Striche, Haus über dem zweiten: zweimal Strg+Z, beide abgelehnt');
  pruefe(ebene(b) === nachB && hoehen(b, 40) === bHoehe && nachB !== nachA, '11: … auch der erste Strich bleibt, wie er war (kein stilles Springen auf den Strich davor)');
  hausDazu(b, []);
  pruefe(b.steuerung.rueckgaengig() === true && ebene(b) === nachA, '11: Haus weg: Strg+Z nimmt den zweiten Strich zurück, nicht den ersten');

  // a plinth set afterwards refuses the same way
  const c = aufbau(LAYOUT as unknown as Record<string, unknown>);
  c.ein.werkzeug = 'anheben';
  strich(c, [0, 0], [0, 0], 8);
  const sC = ebene(c);
  hausDazu(c, [{ id: 's', prefab: 'U_Fass', x: 0, z: 0, einebnen: 4 }]);
  pruefe(c.steuerung.rueckgaengig() === false && ebene(c) === sC, '11: ein nachträglich gesetzter Sockel lehnt Rückgängig ab');
  // a step whose points are only partly under the house is refused whole
  const d = aufbau(LAYOUT as unknown as Record<string, unknown>);
  d.ein.werkzeug = 'anheben';
  d.ein.radius = 12;
  strich(d, [0, 0], [0, 0], 6);
  const sD = ebene(d);
  hausDazu(d, [{ id: 'haus', prefab: 'U_Wohnhaus', x: 4, z: 0 }]);
  pruefe(d.steuerung.rueckgaengig() === false && ebene(d) === sD, '11: liegt nur ein Teil des Schritts unter dem Haus, wird der ganze Schritt abgelehnt');

  // takeover from another tab with the same list: the ground follows the draft in full, every placement near it stands on it
  const t = aufbau({ ...LAYOUT, placements: [{ id: 'haus', prefab: 'U_Wohnhaus', x: 50, z: 0 }] });
  const fremd = new DeltaKarte();
  for (let z = -6; z <= 6; z++) for (let x = 44; x <= 56; x++) {
    const p = punktVon(x, z);
    fremd.setze(p.zx, p.zz, p.index, 200);
  }
  t.steuerung.bereit();
  const hausVorher = t.angezeigt.get(0)!;
  t.entwurf.setze({ ...LAYOUT, placements: [{ id: 'haus', prefab: 'U_Wohnhaus', x: 50, z: 0 }], heightDeltas: fremd.alsZonen() });
  t.steuerung.entwurfGeaendert();
  pruefe(abweichungen(t.welt, frischAus(t), raster(6).map(([x, z]) => [50 + x, z] as [number, number])) === 0, '11: Übernahme: der Boden ist bitgleich zum Entwurf (auch unter dem Haus)');
  pruefe(Math.abs(t.angezeigt.get(0)! - t.welt.getGroundHeight(50, 0)) < 1e-9 && t.angezeigt.get(0)! > hausVorher + 1.9, '11: Übernahme: das Haus steht auf dem neuen Boden, es schwebt nicht');
  pruefe(Array.isArray(t.nachListen.at(-1)), '11: Übernahme mit gleicher Liste: nur Plätze nahe der Änderung');

  // N2/N1-2: the other tab changed the placement list too (load a server state, import): the whole list is drawn again
  const lis = (id: string, x: number): Record<string, unknown> => ({ id, prefab: 'U_Fass', x, z: 0 });
  const bauListe = (vorn: boolean): Aufbau => {
    const ab = aufbau({ ...LAYOUT, placements: [lis('A', 10), lis('B', 20), lis('C', 30)] });
    ab.steuerung.bereit();
    const f = new DeltaKarte();
    for (let x = 6; x <= 14; x++) {
      const p = punktVon(x, 0);
      f.setze(p.zx, p.zz, p.index, 150);
    }
    const neu = vorn ? [lis('N', 5), lis('A', 10), lis('B', 20), lis('C', 30)] : [lis('B', 20), lis('C', 30)];
    ab.entwurf.setze({ ...LAYOUT, placements: neu, heightDeltas: f.alsZonen() });
    ab.steuerung.entwurfGeaendert();
    return ab;
  };
  const gezeigt = (ab: Aufbau): string => [...ab.zeigt.entries()].sort((p, q) => p[0] - q[0]).map(([i, id]) => `${i}=${id}`).join(' ');
  const vorn = bauListe(true);
  pruefe(gezeigt(vorn) === '0=N 1=A 2=B 3=C', `11: Objekt vorn eingefügt: der Flug zeigt genau den Entwurf (${gezeigt(vorn)})`);
  pruefe(vorn.nachListen.at(-1) === 'alle', '11: … die ganze Liste wurde neu aufgebaut');
  const weg = bauListe(false);
  pruefe(gezeigt(weg) === '0=B 1=C', `11: erstes Objekt gelöscht: das gelöschte steht nicht mehr im Flug (${gezeigt(weg)})`);
}

// ── 12. N1/A3–A8: Pipette-Taste, Strg im Baumodus, Zahlenfeld, Zurücksetzen mit gehaltenem Pinsel, Hilfetext, Tasten ──
{
  // A3/A4: the pipette is key H, Ctrl/Cmd/Alt are not a pipette and open no context menu
  const h = (code: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, ...o });
  pruefe(istPipetteTaste(h('KeyH')) && !istPipetteTaste(h('KeyG')) && !istPipetteTaste(h('KeyH', { ctrlKey: true })) && !istPipetteTaste(h('KeyH', { metaKey: true })) && !istPipetteTaste(h('KeyH', { altKey: true })), '12: Pipette = Taste H (nicht mit Strg/Cmd/Alt)');
  const tf = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  const pc = readFileSync(resolve(HIER, '../src/player/PlayerController.ts'), 'utf-8');
  pruefe(!/e\.ctrlKey \|\| e\.metaKey\) && !gelaendeUnten/.test(tf) && /pipetteEntscheid\(e, panel\.istGelaendeModus, tipptImFeld\(e\)\)/.test(tf), '12: kein Strg/Cmd-Klick mehr als Pipette (kein Kontextmenü-Weg auf dem Mac), dafür die Taste H über pipetteEntscheid (Reiter offen, Textfeld)');
  pruefe(/if \(pip\.lesen\) \{\s*const gp = gelaendeZeiger \? bodenPunkt\(gelaendeZeiger\.x, gelaendeZeiger\.y\) : null;\s*if \(gp\) gelaende\.pipetteAn\(gp\);/.test(tf), '12: die Taste H liest die Höhe unter dem Zeiger über pipetteAn');
  pruefe(/panel\.aufPipetteKnopf = \(\) => gelaende\.pipetteScharf\(\)/.test(tf) && /pipetteAnzeige: \(an\) => panel\.setzePipetteBereit\(an\)/.test(tf), '12: der Knopf „Pipette“ schaltet die Pipette der Steuerung scharf, die Steuerung färbt den Knopf');
  pruefe((tf.match(/'contextmenu'/g) ?? []).length === 1 && /addEventListener\('contextmenu', \(e\) => \{[^}]*verwerfen\(\)/.test(tf.replace(/\n/g, ' ')) === true || (tf.match(/'contextmenu'/g) ?? []).length >= 1, '12: das Kontextmenü wird nur noch vom Rechtsklick ausgelöst (Strg+Klick ist kein Werkzeug-Klick)');
  // A3: Ctrl does not sink while the terrain tab is open; X always does
  pruefe(baumSinkt(false, true, false) === true && baumSinkt(false, true, true) === false && baumSinkt(true, false, true) === true && baumSinkt(false, false, false) === false, '12: Baumodus: Strg sinkt, außer der Gelände-Reiter ist offen; X sinkt immer');
  pruefe(/strgSinktNicht\?\.\(\) === true/.test(pc) && /p\.strgSinktNicht = \(\) => panel\.istGelaendeModus/.test(tf), '12: PlayerController fragt den Hook, Testflug setzt ihn auf „Gelände-Reiter offen“');

  // A5: the number field takes the value on every input
  pruefe(zielAusText('') === null && zielAusText('  ') === null && zielAusText('abc') === null && zielAusText('12,5') === null, '12: Zahlenfeld: leer und Unbrauchbares = kein Ziel');
  pruefe(zielAusText('-5') === -5 && zielAusText('1e9') === 2000 && zielAusText('-1e9') === -200 && zielAusText('12.345') === 12.35, '12: Zahlenfeld: −5, Klemmen auf 2000 / −200, Runden auf cm');
  const sp = readFileSync(resolve(HIER, '../src/editor/SpawnPanel.ts'), 'utf-8');
  pruefe(/ziel\.oninput = \(\) => \{\s*this\.gelaendeEinstellung\.ziel = zielAusText\(ziel\.value\);/.test(sp), '12: das Zahlenfeld übernimmt bei jeder Eingabe (oninput), nicht erst bei change');

  // A6: a held reset brush finishes
  const hügel = new DeltaKarte();
  for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) {
    const p = punktVon(x, z);
    const c = Math.round(666 * falloff(Math.hypot(x, z), 8));
    if (c !== 0) hügel.setze(p.zx, p.zz, p.index, c);
  }
  const halt = new Strich(hügel, 'halt');
  for (let i = 0; i < 400; i++) halt.stempel(eingabe(0, 0, { werkzeug: 'zuruecksetzen', radius: 6 }), false);
  let rest = 0;
  for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) if (Math.hypot(x, z) < 6 && deltaAn(hügel, x, z) !== 0) rest++;
  pruefe(rest === 0, `12: Zurücksetzen mit gehaltenem Pinsel (400 Stempel): kein Punkt im Kreis behält eine Korrektur (${rest} offen)`);
  pruefe(Math.abs(deltaAn(hügel, 7, 0)) === Math.abs(Math.round(666 * falloff(7, 8))), '12: außerhalb des Kreises bleibt die Korrektur');
  const ein = new Strich(hügel, 'x');
  // the real brush too: raise, then hold reset
  const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
  a.ein.werkzeug = 'anheben';
  a.ein.staerke = 50;
  a.steuerung.druecken({ x: 0, z: 0 }, false);
  for (let i = 0; i < 30; i++) {
    a.setzeZeit(130);
    a.steuerung.tick({ x: 0, z: 0 }, false);
  }
  a.steuerung.loslassen();
  void ein;
  a.ein.werkzeug = 'zuruecksetzen';
  a.steuerung.druecken({ x: 0, z: 0 }, false);
  for (let i = 0; i < 300; i++) {
    a.setzeZeit(130);
    a.steuerung.tick({ x: 0, z: 0 }, false);
  }
  a.steuerung.loslassen();
  const kk = karteAusEntwurf(a.entwurf.doc().heightDeltas) ?? new DeltaKarte();
  let offen = 0;
  for (const [x, z] of raster(8)) if (Math.hypot(x, z) < 6 && deltaAn(kk, x, z) !== 0) offen++;
  pruefe(offen === 0 && abweichungen(a.welt, frischAus(a), raster(10)) === 0, `12: echter Pinsel, 300 Stempel gehalten: alle Punkte im Kreis auf der Basis (${offen} offen)`);

  // A7: the help text names the criterion, not "Kisten"
  const de = JSON.parse(readFileSync(resolve(HIER, '../src/i18n/katalog/de.json'), 'utf-8')) as Record<string, string>;
  const en = JSON.parse(readFileSync(resolve(HIER, '../src/i18n/katalog/en.json'), 'utf-8')) as Record<string, string>;
  pruefe(!de['testflug.gelaende.tip3']!.includes('Kisten') && /Sockel/.test(de['testflug.gelaende.tip3']!) && /Gebäude/.test(de['testflug.gelaende.tip3']!) && /Bauteil/.test(de['testflug.gelaende.tip3']!), '12: der Hilfetext nennt das Kriterium (kein Sockel, kein Gebäude, kein Bauteil) statt „Kisten“');
  pruefe(!/crates/i.test(en['testflug.gelaende.tip3']!) && /plinth/.test(en['testflug.gelaende.tip3']!) && !/„|“/.test(en['testflug.gelaende.ziel_fehlt']!), '12: englischer Text gleich, ohne deutsche Anführungszeichen');
  pruefe(!/Strg\+Klick|Ctrl\/Cmd\+click|Strg\/Cmd/.test(de['testflug.gelaende.tip3']! + de['testflug.gelaende.ziel_m']! + de['testflug.gelaende.ziel_fehlt']!), '12: keine Texte mehr für Strg+Klick');
  // the rule in the text is the rule of `istLose`
  pruefe(istLose({ prefab: 'U_Fass', x: 0, z: 0 }, katalog) && !istLose({ prefab: 'U_Wohnhaus', x: 0, z: 0 }, katalog) && !istLose({ prefab: 'U_Fass', x: 0, z: 0, einebnen: 2 }, katalog), '12: istLose = kein Sockel und kein Gebäude/Bauteil');

  // A8: keys — only with the terrain tab open, not in a field, a held key is one step; margin; constants
  const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }> = {}) => ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...o });
  pruefe(verlaufEntscheid(k('z'), true, false).aktion === 'rueckgaengig' && verlaufEntscheid(k('z'), true, false).verhindern, '12: Strg+Z bei offenem Reiter: Schritt, Browser-Reaktion verhindert');
  pruefe(verlaufEntscheid(k('z'), false, false).aktion === null && !verlaufEntscheid(k('z'), false, false).verhindern, '12: bei geschlossenem Gelände-Reiter tut Strg+Z nichts (und bleibt dem Browser)');
  pruefe(verlaufEntscheid(k('z'), true, true).aktion === null && !verlaufEntscheid(k('z'), true, true).verhindern, '12: im Textfeld tut Strg+Z nichts (das Feld hat sein eigenes Rückgängig)');
  pruefe(verlaufEntscheid(k('z', { repeat: true }), true, false).aktion === null && verlaufEntscheid(k('z', { repeat: true }), true, false).verhindern, '12: gehaltene Taste (repeat): kein weiterer Schritt, aber verschluckt');
  pruefe(verlaufEntscheid(k('Z', { shiftKey: true }), true, false).aktion === 'wiederholen' && verlaufEntscheid(k('y'), true, false).aktion === 'wiederholen' && verlaufEntscheid(k('q'), true, false).aktion === null, '12: Strg+Umschalt+Z und Strg+Y = Wiederholen, andere Tasten nichts');
  const aend = [{ zx: 0, zz: 0, index: 32 * 64 + 32, alt: 0, neu: 5 }];
  const pl = (x: number, z: number): SperrPlatzierung => ({ prefab: 'U_Fass', x, z });
  const im = (x: number, z: number): boolean => loseIndizes([pl(x, z)], katalog, aend).length === 1;
  pruefe(MARGE_M === 1 && im(1, 0) && im(-1, 0) && im(0, 1) && im(0, -1) && im(1, 1), '12: Marge: Objekte genau 1 m neben dem geänderten Punkt werden neu gesetzt');
  pruefe(!im(1.01, 0) && !im(-1.01, 0) && !im(0, 1.01) && !im(0, -1.01), '12: … Objekte 1,01 m daneben nicht');
  pruefe(platzierungenNahe([pl(1, 0), pl(1.01, 0), { prefab: 'U_Wohnhaus', x: 0, z: -1 }], aend).join(',') === '0,2', '12: platzierungenNahe nimmt alle in der Marge, auch das Gebäude');
  // ZURUECK_VOLL: full where the falloff is ≥ 0.5, proportional below
  const alle = new DeltaKarte();
  for (let z = -6; z <= 6; z++) for (let x = -6; x <= 6; x++) {
    const p = punktVon(x, z);
    alle.setze(p.zx, p.zz, p.index, 100);
  }
  const eins = berechneStempel(alle, eingabe(0, 0, { werkzeug: 'zuruecksetzen', radius: 6 }));
  const bei = (x: number): number | undefined => eins.find((q) => q.index === 32 * 64 + 32 + x)?.neu;
  pruefe(bei(2) === 0 && bei(1) === 0, `12: Zurücksetzen: wo der Randabfall ≥ 0,5 ist (d ≤ 2), ist die Korrektur ganz weg (${bei(2)})`);
  pruefe(bei(4) === 100 - Math.round((100 * falloff(4, 6)) / 0.5), `12: … darunter anteilig (d = 4: ${bei(4)} cm übrig, erwartet ${100 - Math.round((100 * falloff(4, 6)) / 0.5)})`);
  pruefe(VERLAUF_MAX === 100, '12: der Verlauf hält 100 Striche (die Zahl, nicht nur die Konstante)');
  const v = new GelaendeVerlauf();
  for (let i = 0; i < 101; i++) v.neu({ vorgangId: `v${i}`, aenderungen: [{ zx: 0, zz: 0, index: i, alt: 0, neu: 1 }] });
  pruefe(v.tiefe.rueckgaengig === 100, '12: 101 Striche: 100 bleiben im Verlauf');
  // N2/N1-3: the pipette key only with the tab open and not in a field; the armed button does not outlive the tool
  const pk = (o: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }> = {}) => ({ code: 'KeyH', ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...o });
  pruefe(pipetteEntscheid(pk(), true, false).lesen && pipetteEntscheid(pk(), true, false).verhindern, '12: H bei offenem Reiter liest die Höhe');
  pruefe(!pipetteEntscheid(pk(), false, false).lesen && !pipetteEntscheid(pk(), false, false).verhindern, '12: H bei geschlossenem Reiter tut nichts und bleibt dem Browser');
  pruefe(!pipetteEntscheid(pk(), true, true).lesen && !pipetteEntscheid(pk(), true, true).verhindern, '12: H im Textfeld tut nichts (ein „h“ im Namensfeld bleibt ein „h“)');
  pruefe(!pipetteEntscheid(pk({ repeat: true }), true, false).lesen && pipetteEntscheid(pk({ repeat: true }), true, false).verhindern, '12: gehaltenes H liest nicht noch einmal');
  pruefe(!pipetteEntscheid(pk({ ctrlKey: true }), true, false).lesen && !pipetteEntscheid(pk({ code: 'KeyG' }), true, false).lesen, '12: Strg+H und andere Tasten lesen nicht');
  {
    const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
    a.ein.werkzeug = 'anheben';
    a.steuerung.pipetteScharf();
    pruefe(a.pipetteAnzeige && a.steuerung.pipetteBereit, '12: der Knopf „Pipette“ macht die Pipette scharf (Knopf gefärbt)');
    a.steuerung.druecken({ x: 3, z: 3 }, false);
    pruefe(!a.steuerung.strichOffen && a.ein.ziel !== null && !a.pipetteAnzeige && !a.steuerung.pipetteBereit, '12: der nächste Klick liest die Höhe, beginnt keinen Strich und entschärft die Pipette');
    pruefe(a.entwurf.schreibungen() === 0, '12: … und schreibt nichts');
    a.ein.ziel = null;
    a.steuerung.pipetteScharf();
    a.steuerung.beenden();
    pruefe(!a.pipetteAnzeige && !a.steuerung.pipetteBereit, '12: Reiterwechsel/Esc/Panel zu (beenden) entschärft die scharfe Pipette');
    a.steuerung.druecken({ x: 3, z: 3 }, false);
    pruefe(a.steuerung.strichOffen && a.ein.ziel === null, '12: … der nächste Klick nach der Rückkehr stempelt, statt eine Höhe zu lesen');
    a.steuerung.loslassen();
  }
  // Zahlenfeld Verdrahtung (E17): klemmt und rundet über zielAusText
  pruefe(zielAusText('99999') === 2000 && zielAusText('1.005') !== null, '12: Zahlenfeld klemmt und rundet');
}

console.log(`\n${geprueft - fehler}/${geprueft} Prüfungen bestanden`);
if (fehler > 0) {
  console.error(`${fehler} FEHLER`);
  process.exit(1);
}
