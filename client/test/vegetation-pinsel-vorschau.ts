/**
 * Remove vegetation V3, preview: the preview reads the circles from the DRAFT and re-scatters while the brush paints,
 * on undo and on redo. Real scatter (`streueZone`), real `RegionGeo`; DOM-free, no browser/GPU.
 * Entfernen V3, Vorschau: die Vorschau liest die Kreise aus dem ENTWURF und streut beim Malen, Rückgängig und
 * Wiederholen neu.
 *
 *  1. Source of the circles: the draft decides, not the layout of the world (the layout holds a circle somewhere else).
 *  2. While the button is down the plants vanish in the circles of the stroke (pending circles, `stand` in the marker).
 *  3. After the stroke: everything inside the circles is gone, everything else is bit-identical to before (keys and content).
 *  4. "Trees only": only trees leave, bushes/herbs/stones stay.
 *  5. Undo: the plants are back, bit-equal to before the stroke. Redo: gone again.
 *
 * Run: npx tsx client/test/vegetation-pinsel-vorschau.ts
 */
import { GRASLAND_FLORA_NAMEN, HeightmapProvider, NADELWALD_FLORA_NAMEN, RegionGeo, getStableHash, sanitizeWorldLayout, streuArt, FOLIAGE, type VegetationEntferntKreis } from '@wov/shared';
import { BewuchsVorschau } from '../src/editor/BewuchsVorschau';
import { VegetationAktionen, vegetationQuelleFuerVorschau } from '../src/editor/testflug/vegetationAktionen';
import { VegetationSteuerung } from '../src/editor/testflug/vegetationSteuerung';
import type { EntwurfDokument } from '../src/editor/testflug/TestflugPersistenz';

let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FAIL: ${text}`);
  }
};

const SEED = getStableHash('KxSYuZquuw');
// Deliberately asymmetric (x != z, both signs): a swapped x/z would not show otherwise.
const MITTE = { x: -150, z: 90 };
const art = new Map<number, 'baum' | 'sonstiges'>();
for (const f of FOLIAGE) art.set(f.prefabHash, streuArt(f.prefabName));

function weltBauen(layoutExtra: Record<string, unknown>) {
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'Vegetation-Pinsel-Vorschau',
    detailSeed: 've',
    continents: [],
    regions: [
      {
        id: 'probe',
        biome: 'grassland',
        shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200,
        baseLevel: 0.3,
        vegetation: [...GRASLAND_FLORA_NAMEN, ...NADELWALD_FLORA_NAMEN.filter((n) => !GRASLAND_FLORA_NAMEN.includes(n))],
      },
    ],
    ...layoutExtra,
  });
  if (!layout) throw new Error('Testlayout wurde verworfen');
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  return { geo, heightmaps };
}

type Live = Map<string, { prefabHash: number; position: { x: number; y: number; z: number } }>;
const inhalt = (u: { prefabHash: number; position: { x: number; y: number; z: number } }): string => `${u.prefabHash}|${u.position.x},${u.position.y},${u.position.z}`;
const imKreis = (p: { x: number; z: number }, k: { x: number; z: number; r: number }): boolean => (p.x - k.x) ** 2 + (p.z - k.z) ** 2 <= k.r * k.r;
/** Inside one of the circles (the kind `nur` is not looked at: the scenarios with `nur` use `imKreis` themselves). */
const imEinem = (p: { x: number; z: number }, ks: readonly VegetationEntferntKreis[]): boolean => ks.some((k) => imKreis(p, k));

/** The test flight in miniature: draft in memory, brush, preview wired like `Testflug.ts`. */
function flug(layoutExtra: Record<string, unknown> = {}, einst = { radius: 20, nurBaeume: false }) {
  const { geo, heightmaps } = weltBauen(layoutExtra);
  let dok: Record<string, unknown> = { placements: [] };
  const persistenz = {
    laden: (): EntwurfDokument | null => structuredClone(dok) as EntwurfDokument,
    aendern: (d: EntwurfDokument): void => void (dok = structuredClone(d) as Record<string, unknown>),
    rohtext: (): string => JSON.stringify(dok),
  };
  const live: Live = new Map();
  const ent = {
    applyUpdate: (u: { key: string; prefabHash: number; position: { x: number; y: number; z: number } }): void => void live.set(u.key, u),
    removeZDO: (k: string): void => void live.delete(k),
    flush: (): void => undefined,
  };
  let pinsel: VegetationSteuerung | null = null;
  const v = new BewuchsVorschau(
    { seed: SEED, geo, heightmaps, regionGeo: geo },
    ent as never,
    undefined,
    () => (dok.placements as never) ?? [],
    () => `${persistenz.rohtext()}#${pinsel?.stand ?? 0}`,
    () => vegetationQuelleFuerVorschau(persistenz.laden(), pinsel?.strichKreise() ?? [])
  );
  pinsel = new VegetationSteuerung({
    aktionen: new VegetationAktionen(persistenz),
    einstellung: () => einst,
    meldung: () => undefined,
    kreis: { zeige: () => undefined, verberge: () => undefined },
  });
  let ms = 100000;
  const pumpe = (n = 80): void => {
    for (let i = 0; i < n; i++) v.schritt(MITTE.x, MITTE.z, (ms += 300));
  };
  const stand = (): Map<string, string> => new Map([...live].map(([k, u]) => [k, inhalt(u)]));
  return { v, pinsel: pinsel!, live, pumpe, stand, einst, kreise: (): VegetationEntferntKreis[] => ((dok.vegetationEntfernt as VegetationEntferntKreis[]) ?? []).map((k) => ({ ...k })) };
}

console.log('=== vegetation-pinsel-vorschau ===');
const f = flug();
f.pumpe();
const vorher = f.stand();
const vorherKeys = [...f.live.values()];
const nahe = vorherKeys.filter((u) => imKreis(u.position, { ...MITTE, r: 40 }));
const nBaeume = nahe.filter((u) => art.get(u.prefabHash) === 'baum').length;
console.log(`  Bezug: ${vorher.size} Pflanzen in der Vorschau, im 40-m-Kreis um den Strich ${nahe.length} (davon ${nBaeume} Bäume)`);
if (vorher.size === 0 || nahe.length === 0) {
  console.log('ÜBERSPRUNGEN — die Vorschau streut hier nichts (Katalog ohne eigene Vegetation, z. B. WOV_OHNE_MODELLE=1): der Zeuge braucht Modelle');
  process.exit(0);
}
pruefe(nBaeume > 0 && nahe.length - nBaeume > 0, `Vorbedingung: im Strichbereich stehen Bäume UND anderes (${nBaeume} / ${nahe.length - nBaeume})`);

// ── 1+2. Quelle Entwurf; während des Malens ──────────────────────────────────
f.pinsel.druecken({ x: MITTE.x - 25, z: MITTE.z });
f.pinsel.bewegen({ x: MITTE.x + 25, z: MITTE.z });
const offen = f.pinsel.strichKreise().map((k) => ({ ...k }));
pruefe(offen.length >= 5, `2: Strich offen: ${offen.length} Kreise stehen noch nicht im Entwurf`);
pruefe(f.kreise().length === 0, '2: … der Entwurf ist noch leer');
f.pumpe();
const waehrend = f.stand();
const imStrichVorher = vorherKeys.filter((u) => imEinem(u.position, offen)).length;
pruefe(imStrichVorher > 0, `2: Vorbedingung: im Strich standen ${imStrichVorher} Pflanzen`);
pruefe([...f.live.values()].every((u) => !imEinem(u.position, offen)), '2: beim Malen verschwinden die Pflanzen in den Kreisen des offenen Strichs');
pruefe(waehrend.size === vorher.size - imStrichVorher, `2: genau diese ${imStrichVorher} fehlen (${vorher.size} → ${waehrend.size})`);

// ── 3. Nach dem Strich ───────────────────────────────────────────────────────
f.pinsel.loslassen();
f.pumpe();
const kreise = f.kreise();
pruefe(kreise.length === offen.length, `3: der Strich steht mit ${kreise.length} Kreisen im Entwurf (ein Schreibvorgang)`);
const nach = f.stand();
pruefe([...f.live.values()].every((u) => !imEinem(u.position, kreise)), '3: im Entwurf-Zustand: nichts steht mehr in den Kreisen');
const aussen = [...vorher].filter(([, i]) => !imEinem({ x: Number(i.split('|')[1]!.split(',')[0]), z: Number(i.split('|')[1]!.split(',')[2]) }, kreise));
pruefe(aussen.length === nach.size && aussen.every(([k, i]) => nach.get(k) === i), `3: alle ${aussen.length} anderen Pflanzen sind bitgleich (Schlüssel und Inhalt) wie vorher`);
pruefe(JSON.stringify([...nach].sort()) === JSON.stringify([...waehrend].sort()), '3: der Stand nach dem Loslassen ist der, den das Malen schon zeigte');

// ── 5. Rückgängig / Wiederholen ──────────────────────────────────────────────
pruefe(f.pinsel.rueckgaengig() && f.kreise().length === 0, '5: Rückgängig leert die Liste im Entwurf');
f.pumpe();
const zurueck = f.stand();
pruefe(zurueck.size === vorher.size && [...vorher].every(([k, i]) => zurueck.get(k) === i), `5: Rückgängig: die Pflanzen sind wieder da, bitgleich wie vor dem Strich (${zurueck.size} = ${vorher.size})`);
pruefe(f.pinsel.wiederholen(), '5: Wiederholen');
f.pumpe();
pruefe([...f.live.values()].every((u) => !imEinem(u.position, kreise)) && f.stand().size === nach.size, '5: Wiederholen: sie sind wieder weg (derselbe Stand wie nach dem Strich)');

// ── 4. nur Bäume ─────────────────────────────────────────────────────────────
{
  const g = flug({}, { radius: 20, nurBaeume: true });
  g.pumpe();
  const v0 = [...g.live.values()];
  g.pinsel.druecken({ x: MITTE.x - 25, z: MITTE.z });
  g.pinsel.bewegen({ x: MITTE.x + 25, z: MITTE.z });
  g.pinsel.loslassen();
  g.pumpe();
  const ks = g.kreise();
  const baeumeInKreisen = v0.filter((u) => art.get(u.prefabHash) === 'baum' && imEinem(u.position, ks)).length;
  const sonstigesInKreisen = v0.filter((u) => art.get(u.prefabHash) !== 'baum' && ks.some((k) => imKreis(u.position, k))).length;
  const n1 = [...g.live.values()];
  pruefe(baeumeInKreisen > 0 && sonstigesInKreisen > 0, `4: Vorbedingung: im Strich ${baeumeInKreisen} Bäume und ${sonstigesInKreisen} sonstige Pflanzen`);
  pruefe(n1.every((u) => !(art.get(u.prefabHash) === 'baum' && imEinem(u.position, ks))), '4: kein Baum steht mehr in den Kreisen');
  pruefe(n1.filter((u) => art.get(u.prefabHash) !== 'baum' && ks.some((k) => imKreis(u.position, k))).length === sonstigesInKreisen, `4: alle ${sonstigesInKreisen} sonstigen Pflanzen im Strich bleiben stehen`);
  pruefe(v0.length - n1.length === baeumeInKreisen, `4: genau ${baeumeInKreisen} Bäume fehlen (${v0.length} → ${n1.length})`);
}

// ── 1. Quelle ist der Entwurf, nicht das Layout ──────────────────────────────
{
  // The layout of the world holds a circle far from the stroke: it must not matter, and the draft's circle must.
  const g = flug({ vegetationEntfernt: [{ x: 600, z: 600, r: 30 }] });
  g.pumpe();
  const v0 = [...g.live.values()];
  g.pinsel.druecken({ x: MITTE.x, z: MITTE.z });
  g.pinsel.loslassen();
  g.pumpe();
  const ks = g.kreise();
  pruefe(ks.length === 1, '1: ein Klick legt einen Kreis in den Entwurf (das Layout der Welt hat nur seinen eigenen)');
  const imKlick = v0.filter((u) => imKreis(u.position, ks[0]!)).length;
  pruefe(imKlick > 0 && [...g.live.values()].every((u) => !imKreis(u.position, ks[0]!)), `1: der Kreis des ENTWURFS wirkt in der Vorschau (${imKlick} Pflanzen weg)`);
}

if (fehler > 0) {
  console.error(`\n${fehler} FAILED von ${geprueft}`);
  process.exit(1);
}
console.log(`\n${geprueft} Prüfungen, alles grün`);
