/**
 * MESSWERKZEUG, kein Test (druckt Zahlen, behauptet nichts).
 *
 * Frage: Passt die auf 2,0 m gewachsene Spielerkapsel noch durch die
 * niedrigsten Stellen der Dungeon-Geometrie?
 *
 * Gemessen wird die LICHTE HOEHE ueber jedem begehbaren Abtastpunkt: vom
 * Boden unter dem Punkt senkrecht nach oben, bis zum ersten massiven
 * Koerper. Abgetastet wird nicht nur die Zellmitte, sondern der ganze
 * Figurenumfang (acht Punkte auf dem Kreis mit KOERPER_RADIUS) — eine
 * Kapsel bleibt am Tuersturz haengen, nicht an der Zellmitte.
 *
 * Die Formen kommen aus derselben Kette, die im Spiel laeuft
 * (`baueLayout -> zellenAufbauen -> baueGeometrie -> kollisionsForm`),
 * also aus dem Kollisionskoerper und nicht aus dem Bild.
 *
 * Aufruf:  npx tsx client/test/durchgangshoehe-mess.ts
 */
import { kollisionsForm, formOberkante, type KollisionsForm } from '../src/engine/DungeonBuilder';
import { dungeon2 } from '@wov/shared';
import { KOERPER_HOEHE, KOERPER_RADIUS } from '@wov/shared/src/bewegung/masse.js';

const { erzeugeLayout, STEINGRAB, zellenAufbauen, baueGeometrie, KANTEN, nachbarZelle } = dungeon2;
const baueLayout = (seed: number) =>
  erzeugeLayout(STEINGRAB, { architektur: seed, material: 4711, deko: 815 });

const RASTER_M = 4;
type FormIndex = Map<string, KollisionsForm[]>;

function huelle(form: KollisionsForm): { hx: number; hz: number } {
  if (form.achse === null) return { hx: form.halbe.x, hz: form.halbe.z };
  const cos = Math.abs(Math.cos(form.winkel));
  const sin = Math.abs(Math.sin(form.winkel));
  return form.achse === 'x'
    ? { hx: form.halbe.x, hz: form.halbe.z * cos + form.halbe.y * sin }
    : { hx: form.halbe.x * cos + form.halbe.y * sin, hz: form.halbe.z };
}

function baueIndex(formen: readonly KollisionsForm[]): FormIndex {
  const index: FormIndex = new Map();
  for (const form of formen) {
    const h = huelle(form);
    const x0 = Math.floor((form.mitte.x - h.hx - KOERPER_RADIUS) / RASTER_M);
    const x1 = Math.floor((form.mitte.x + h.hx + KOERPER_RADIUS) / RASTER_M);
    const z0 = Math.floor((form.mitte.z - h.hz - KOERPER_RADIUS) / RASTER_M);
    const z1 = Math.floor((form.mitte.z + h.hz + KOERPER_RADIUS) / RASTER_M);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const s = `${x}|${z}`;
        let liste = index.get(s);
        if (liste === undefined) { liste = []; index.set(s, liste); }
        liste.push(form);
      }
    }
  }
  return index;
}

const nahe = (index: FormIndex, x: number, z: number): readonly KollisionsForm[] =>
  index.get(`${Math.floor(x / RASTER_M)}|${Math.floor(z / RASTER_M)}`) ?? [];

function oberkante(index: FormIndex, x: number, z: number, untenBis: number): number | null {
  let beste: number | null = null;
  for (const form of nahe(index, x, z)) {
    const y = formOberkante(form, x, z);
    if (y === null) continue;
    if (y > untenBis) continue;
    if (beste === null || y > beste) beste = y;
  }
  return beste;
}

/**
 * Unterkante des ersten massiven Koerpers ueber `y` an (x,z) — oder null,
 * wenn nichts darueber steht. Nur achsparallele Formen; die gekippten sind
 * Rampen, und die stehen unter einem, nicht ueber einem.
 */
function decke(index: FormIndex, x: number, y: number, z: number): number | null {
  let beste: number | null = null;
  for (const form of nahe(index, x, z)) {
    if (form.achse !== null) continue;
    if (Math.abs(x - form.mitte.x) >= form.halbe.x) continue;
    if (Math.abs(z - form.mitte.z) >= form.halbe.z) continue;
    const unten = form.mitte.y - form.halbe.y;
    if (unten <= y + 1e-6) continue;
    if (beste === null || unten < beste) beste = unten;
  }
  return beste;
}

const SEEDS = [1234, 99, 7];
const SCHRITT_M = 0.25;
console.log(
  `Lichte Hoehe ueber begehbarem Boden — Kapsel ${KOERPER_HOEHE} m x r ${KOERPER_RADIUS} m\n`
);

let weltMin = Infinity;
let weltMinOrt = '';
for (const seed of SEEDS) {
  const layout = baueLayout(seed);
  const gitter = zellenAufbauen(layout);
  const voll = baueGeometrie(layout, { gitter });
  const index = baueIndex(voll.kollision.map(kollisionsForm));

  let min = Infinity, minOrt = '';
  let proben = 0;
  const eimer = new Map<string, number>();
  const knapp: Array<{ x: number; y: number; z: number; h: number }> = [];

  const navNach = new Map(voll.nav.map((n) => [`${n.ebene}|${n.z}|${n.x}`, n]));
  for (const n of voll.nav) {
    for (const kante of KANTEN) {
      if ((n.offeneKanten & kante) === 0) continue;
      const p = nachbarZelle(n.x, n.z, kante);
      const ziel = navNach.get(`${n.ebene}|${p.z}|${p.x}`);
      if (ziel === undefined) continue;
      if (ziel.x < n.x || (ziel.x === n.x && ziel.z < n.z)) continue;
      if (n.nachUnten || ziel.nachUnten) continue;
      const laenge = Math.hypot(ziel.mitte.x - n.mitte.x, ziel.mitte.z - n.mitte.z);
      const schritte = Math.max(1, Math.round(laenge / SCHRITT_M));
      for (let i = 0; i <= schritte; i++) {
        const t = i / schritte;
        const x = n.mitte.x + (ziel.mitte.x - n.mitte.x) * t;
        const z = n.mitte.z + (ziel.mitte.z - n.mitte.z) * t;
        const boden = oberkante(index, x, z, n.mitte.y + 1);
        if (boden === null) continue;
        // Der ganze Figurenumfang, nicht nur die Mitte.
        for (let w = 0; w < 8; w++) {
          const winkel = (w * Math.PI) / 4;
          const px = x + Math.cos(winkel) * KOERPER_RADIUS;
          const pz = z + Math.sin(winkel) * KOERPER_RADIUS;
          const d = decke(index, px, boden + 0.05, pz);
          proben += 1;
          const h = d === null ? Infinity : d - boden;
          if (h === Infinity) continue;
          const eimerSchluessel =
            h < 2.0 ? '<2,00' : h < 2.1 ? '2,00–2,10' : h < 2.5 ? '2,10–2,50' : h < 3.5 ? '2,50–3,50' : '>=3,50';
          eimer.set(eimerSchluessel, (eimer.get(eimerSchluessel) ?? 0) + 1);
          if (h < 2.6) knapp.push({ x: px, y: boden, z: pz, h });
          if (h < min) { min = h; minOrt = `${px.toFixed(2)}/${boden.toFixed(2)}/${pz.toFixed(2)}`; }
        }
      }
    }
  }
  console.log(
    `Seed ${seed}: ${proben} Koerperproben, niedrigste lichte Hoehe ` +
      `${min === Infinity ? '— (nirgends eine Decke im Weg)' : `${min.toFixed(3)} m bei ${minOrt}`}`
  );
  console.log(
    `   Verteilung: ${[...eimer.entries()].sort().map(([k, v]) => `${k}: ${v}`).join(' · ') || '(keine Decke ueber einem Abtastpunkt)'}`
  );
  if (knapp.length) {
    console.log(`   unter 2,60 m: ${knapp.length} Proben`);
  }
  if (min < weltMin) { weltMin = min; weltMinOrt = `Seed ${seed} @ ${minOrt}`; }
}

console.log(
  `\nNIEDRIGSTE STELLE ueber alle Seeds: ` +
    (weltMin === Infinity
      ? 'keine — ueber keinem begehbaren Punkt steht ein Koerper'
      : `${weltMin.toFixed(3)} m (${weltMinOrt}); Kapsel ${KOERPER_HOEHE} m ` +
        `-> ${weltMin >= KOERPER_HOEHE ? 'passt' : 'PASST NICHT'}`)
);
