/**
 * K1.4 — Zonen-Rücksetzer: `zone reset` würfelt die Streuung erzeugter Zonen
 * neu und lässt alles andere stehen.
 *
 * Geprüft wird, mit Zahlen:
 *  1. Die Streuung markiert, was sie anlegt (`streu` = Kennung der erzeugenden
 *     Zone), und nur das.
 *  2. Nach einem Dokumentwechsel (anderer Bewuchs-Regler) trifft der Reset
 *     die Zone so, wie eine frische Erzeugung mit dem neuen Dokument sie
 *     gebaut hätte — Stückzahl und jede einzelne Pflanze auf ±0.
 *  3. Layout-Objekte, Adminbäume (ohne Marke), Kreaturen bleiben unberührt.
 *  4. Zonen mit Spielerbau (Int, Float, Text) oder Terraforming werden
 *     abgelehnt, und zwar ohne ein einziges ZDO zu verändern.
 *  5. Alte Zonen ohne Marke: Ersatzregel nur mit `alt`, ohne `alt` Ablehnung
 *     mit der Zahl der Objekte; jedes entfernte Objekt steht im Protokoll.
 *  6. Der Befehl ist nur bei ausdrücklichem `WOV_INSTANZ=dev` oder
 *     `WOV_ZONEN_RUECKSETZER=1` frei — sonst gesperrt, auch ohne gesetzte Instanz.
 *  7. Die Änderung geht über die normale Replikation: Zerstörungsliste und
 *     Dirty-Menge, kein Client-Umbau.
 *  8. Ein Objekt exakt auf der Zonengrenze verdoppelt sich nicht und geht nicht
 *     verloren, in jeder Reihenfolge der Zonen (Herkunft statt Lage).
 *  9. Beschädigte Pflanzen werden gezählt; 10. Marke packen, Altform 1.
 *
 * Lauf: npx tsx server/test/zonen-ruecksetzer.ts   (aus der Wurzel)
 */

import {
  GRASLAND_FLORA_NAMEN,
  HeightmapProvider,
  NADELWALD_FLORA_NAMEN,
  FOLIAGE_HASHES,
  RegionGeo,
  TERRAIN_OP_DEFAULTS,
  getStableHash,
  sanitizeWorldLayout,
  type WorldLayout,
  type ZoneID,
} from '@wov/shared';
import { AdminCommandRegistry } from '../src/admin/AdminCommands.js';
import type { Peer } from '../src/net/Peer.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import type { ZDO } from '../src/zdo/ZDO.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import {
  MAX_RADIUS_ZONEN,
  STREU_MEMBER,
  ablehnungsGrund,
  formatiereErgebnis,
  istMarkiertStreu,
  setzeZoneZurueck,
  setzeZonenZurueck,
  type RuecksetzKontext,
} from '../src/world/zonenRuecksetzer.js';
// Namensraum-Import: Was erst mit der Nachbesserung hinzukam, fehlt auf dem alten Stand
// als Wert (nicht als Bindungsfehler) — so schlägt der Test dort mit Prüfungen fehl, statt zu stürzen.
import * as Rueck from '../src/world/zonenRuecksetzer.js';

const SEED = getStableHash('ZonenRuecksetzer');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}${detail ? '  ' + detail : ''}`);
  }
}

/** Eine grosse Insel um den Nullpunkt; `regler` ist der Bewuchs der Region. */
function insel(vegetation: readonly string[], dichte?: number): WorldLayout {
  const region: Record<string, unknown> = {
    id: 'probe',
    biome: 'grassland',
    shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
    edgeFalloff: 200,
    baseLevel: 0.3,
    vegetation: [...vegetation],
  };
  if (dichte !== undefined) region.bewuchsDichte = dichte;
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'Ruecksetzerprobe',
    detailSeed: 'rp',
    continents: [],
    regions: [region],
  });
  if (!layout) throw new Error('Testlayout wurde verworfen');
  return layout;
}

interface Welt {
  readonly geo: RegionGeo;
  readonly heightmaps: HeightmapProvider;
  readonly zdos: ZDOManager;
  readonly zm: ZoneManager;
  readonly kontext: RuecksetzKontext;
}

/** Baut eine Welt aus einem Dokument; `zdos` reicht einen vorhandenen ZDO-Raum herein (Neustart). */
function welt(layout: WorldLayout, zdos = new ZDOManager(1n)): Welt {
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
  return { geo, heightmaps, zdos, zm, kontext: { zdos, heightmaps, zones: zm } };
}

/** Ein Neustart: dasselbe ZDO-Gut, neues Dokument, erzeugte Zonen aus dem Spielstand zurück. */
function neustart(alt: Welt, layout: WorldLayout): Welt {
  const neu = welt(layout, alt.zdos);
  neu.zm.restoreGeneratedZones(alt.zm.getGeneratedZones());
  return neu;
}

/** Vergleichbare Zeile je ZDO: Prefab, Lage, Drehung und Skalierung. */
function zeile(z: ZDO): string {
  const s = z.getFloat('scaleScalar', -1);
  const r = z.rotation;
  return [
    z.prefabHash,
    z.position.x,
    z.position.y,
    z.position.z,
    r.x,
    r.y,
    r.z,
    r.w,
    s,
    z.getString('layoutId'),
  ].join('|');
}

/**
 * Alle ZDOs, die in der Erzeugungszone liegen — bewusst über die Weltlage
 * aus dem ganzen ZDO-Raum gezogen und nicht über die Sektoren des
 * Rücksetzers, damit der Test ein eigener Zeuge bleibt. (Erzeugungszone =
 * ±32 m um x·64; ZDO-Sektor = [x·64, (x+1)·64): nicht dasselbe Raster.)
 */
function menge(zdos: ZDOManager, zone: ZoneID, wenn: (z: ZDO) => boolean = () => true): ZDO[] {
  return zdos
    .getAllZDOs()
    .filter(
      (z) =>
        HeightmapProvider.worldToZone(z.position.x) === zone.x &&
        HeightmapProvider.worldToZone(z.position.z) === zone.y
    )
    .filter(wenn);
}
const zeilen = (l: readonly ZDO[]): string[] => l.map(zeile).sort();
const gleich = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Alles im ZDO-Raum als Fingerabdruck — für "0 ZDOs verändert". */
function abzug(zdos: ZDOManager): string[] {
  return zdos
    .getAllZDOs()
    .map((z) => `${z.zdoid.toString()}#${zeile(z)}#${z.getMembers().size}`)
    .sort();
}

const DOK_A = insel(GRASLAND_FLORA_NAMEN);
const DOK_B = insel(NADELWALD_FLORA_NAMEN, 0.5);
const ZONE: ZoneID = { x: 2, y: 1 };

const admin = { isAdmin: true } as unknown as Peer;
const baum = [...FOLIAGE_HASHES][0]!;

// ── 1. Marke: nur die Streuung trägt sie ─────────────────────────────
const a = welt(DOK_A);
a.zm.erzeugeZone(ZONE);
const alleA = menge(a.zdos, ZONE);
const markiertA = alleA.filter(istMarkiertStreu);
check('1 die Streuung legt ZDOs an', alleA.length > 20, `(${alleA.length})`);
check(
  '1 jedes Streu-ZDO trägt die Marke mit der Herkunftszone, keines fehlt',
  markiertA.length === alleA.length && alleA.every((z) => z.getInt(STREU_MEMBER) === Rueck.packeHerkunft?.(ZONE)),
  `(${markiertA.length} von ${alleA.length})`
);
check(
  '1 die ganze Streuung liegt in der Erzeugungszone (ZDO-Raum insgesamt = Zone)',
  a.zdos.totalZDOCount === alleA.length,
  `(${a.zdos.totalZDOCount} im Raum, ${alleA.length} in der Zone)`
);
check(
  '1 die Erzeugungszone liegt auf mehreren ZDO-Sektoren (der Test unterscheidet die Raster)',
  new Set(alleA.map((z) => `${z.zone.x},${z.zone.y}`)).size > 1,
  `(${new Set(alleA.map((z) => `${z.zone.x},${z.zone.y}`)).size} Sektoren)`
);

// Fremdes in der Zone: Layout-Objekt, Adminbaum (ohne Marke), Kreatur.
const mitte = { x: ZONE.x * 64, y: 5, z: ZONE.y * 64 };
const layoutZdo = a.zdos.createZDO(getStableHash('Boat'), { ...mitte, x: mitte.x + 3 });
layoutZdo.setString('layoutId', 'platz-1');
layoutZdo.setString('layoutSoll', '3,0,0,0');
const adminBaum = a.zdos.createZDO(baum, { ...mitte, x: mitte.x - 7 });
const kreatur = a.zdos.createZDO(getStableHash('Deer'), { ...mitte, z: mitte.z + 5 });
check('1 Fremdes trägt keine Marke', ![layoutZdo, adminBaum, kreatur].some(istMarkiertStreu));
const fremdVorher = zeilen([layoutZdo, adminBaum, kreatur]);
const layoutIdVorher = layoutZdo.zdoid.toString();

// ── 2. Reset nach Dokumentwechsel = frische Erzeugung mit dem neuen Dokument
a.zdos.consumeDestroyList();
const b = neustart(a, DOK_B);
const ergebnis = setzeZoneZurueck(b.kontext, ZONE);
const nachher = menge(b.zdos, ZONE);
const streuNachher = nachher.filter(istMarkiertStreu);

const c = welt(DOK_B); // frisch, leer, nur das neue Dokument
c.zm.erzeugeZone(ZONE);
const soll = menge(c.zdos, ZONE);

check('2 Status neu-gestreut', ergebnis.status === 'neu-gestreut', ergebnis.grund);
check(
  '2 entfernt = Streu-ZDOs von vorher',
  ergebnis.entfernt === markiertA.length,
  `(${ergebnis.entfernt} / ${markiertA.length})`
);
check(
  '2 Dokument B streut anders als A (der Test misst etwas)',
  soll.length !== markiertA.length,
  `(A ${markiertA.length}, B ${soll.length})`
);
check(
  '2 Streu-ZDOs nachher = Sollwert der frischen Erzeugung, auf ±0',
  streuNachher.length === soll.length && ergebnis.gestreut === soll.length,
  `(nachher ${streuNachher.length}, gemeldet ${ergebnis.gestreut}, Soll ${soll.length})`
);
check(
  '2 jede Pflanze gleich (Prefab, Lage, Drehung, Skalierung)',
  gleich(zeilen(streuNachher), zeilen(soll))
);
check(
  '2 keine alte Pflanze übrig (alle ZDO-IDs der Streuung sind neu)',
  !streuNachher.some((z) => markiertA.some((alt) => alt.zdoid.toString() === z.zdoid.toString()))
);

// ── 3. Unberührtes ───────────────────────────────────────────────────
check(
  '3 Layout-Objekt: dieselbe ID, Lage, Zustand',
  b.zdos.getZDO(layoutZdo.zdoid)?.getString('layoutId') === 'platz-1' &&
    b.zdos.getZDO(layoutZdo.zdoid)?.getString('layoutSoll') === '3,0,0,0' &&
    layoutZdo.zdoid.toString() === layoutIdVorher
);
check(
  '3 Layout-Objekt, Adminbaum und Kreatur unverändert (Zeilen vorher = nachher)',
  gleich(zeilen([layoutZdo, adminBaum, kreatur]), fremdVorher) &&
    [layoutZdo, adminBaum, kreatur].every((z) => b.zdos.getZDO(z.zdoid) === z)
);
check(
  '3 ZDOs in der Zone: Sollwert + 3 Fremde',
  nachher.length === soll.length + 3,
  `(${nachher.length} = ${soll.length} + 3)`
);
check('3 Adminbaum in NEUER Zone überlebt (Marke unterscheidet ihn)', b.zdos.getZDO(adminBaum.zdoid) === adminBaum);

// ── 7. Replikation ───────────────────────────────────────────────────
const zerstoert = b.zdos.consumeDestroyList();
// Die vier ZDO-Sektoren, auf denen die Erzeugungszone liegt.
const sektorenDerZone = [-1, 0].flatMap((dx) => [-1, 0].map((dy) => ({ x: ZONE.x + dx, y: ZONE.y + dy })));
const dirty = b.zdos.collectDirtyZDOs(sektorenDerZone).filter(istMarkiertStreu);
check(
  '7 Zerstörungsliste = entfernte Streu-ZDOs',
  zerstoert.length === ergebnis.entfernt,
  `(${zerstoert.length} / ${ergebnis.entfernt})`
);
check(
  '7 alle neuen Streu-ZDOs stehen zum Senden an',
  dirty.length === streuNachher.length,
  `(${dirty.length} / ${streuNachher.length})`
);

// Zweiter Reset: dasselbe Ergebnis, Marke trägt weiter.
const zweiter = setzeZoneZurueck(b.kontext, ZONE);
check(
  '2 zweiter Reset: gleiche Menge, gleiche Pflanzen',
  zweiter.entfernt === soll.length &&
    zweiter.gestreut === soll.length &&
    gleich(zeilen(menge(b.zdos, ZONE, istMarkiertStreu)), zeilen(soll)),
  `(${zweiter.entfernt} → ${zweiter.gestreut})`
);
check('2 zweiter Reset: Adminbaum lebt noch', b.zdos.getZDO(adminBaum.zdoid) === adminBaum);

// ── 4. Spielerspuren: abgelehnt, null Änderungen ─────────────────────
for (const [name, setze] of [
  ['Int', (z: ZDO) => z.setInt('spieler', 1)],
  ['Float', (z: ZDO) => z.setFloat('spieler', 1)],
  ['Text', (z: ZDO) => z.setString('spieler', '1')],
] as const) {
  const p = welt(DOK_B);
  const zone = { x: 3, y: -2 };
  p.zm.erzeugeZone(zone);
  setze(p.zdos.createZDO(getStableHash('wood_wall'), { x: zone.x * 64 + 4, y: 3, z: zone.y * 64 }));
  p.zdos.consumeDestroyList();
  const vor = abzug(p.zdos);
  const gen = p.zm.getGeneratedZones().length;
  const r = setzeZoneZurueck(p.kontext, zone);
  check(
    `4 Spielerbau (${name}) → abgelehnt, 0 ZDOs verändert`,
    r.status === 'abgelehnt' &&
      r.entfernt === 0 &&
      gleich(abzug(p.zdos), vor) &&
      p.zdos.consumeDestroyList().length === 0 &&
      p.zm.getGeneratedZones().length === gen &&
      p.zm.isZoneGenerated(zone),
    `(${r.grund}; ${vor.length} ZDOs vorher = ${abzug(p.zdos).length} nachher)`
  );
}

{
  const t = welt(DOK_B);
  const zone = { x: -1, y: 2 };
  t.zm.erzeugeZone(zone);
  t.heightmaps.applyTerrainOp(zone.x * 64, 10, zone.y * 64, {
    ...TERRAIN_OP_DEFAULTS,
    level: true,
    levelRadius: 4,
  });
  t.zdos.consumeDestroyList();
  const vor = abzug(t.zdos);
  const r = setzeZoneZurueck(t.kontext, zone);
  check(
    '4 Terraforming → abgelehnt, 0 ZDOs verändert',
    r.status === 'abgelehnt' &&
      /Terraforming/.test(r.grund) &&
      gleich(abzug(t.zdos), vor) &&
      t.zdos.consumeDestroyList().length === 0,
    `(${r.grund}; ${vor.length} ZDOs)`
  );
}

{
  const n = welt(DOK_B);
  const zone = { x: 1, y: 1 };
  const r = setzeZoneZurueck(n.kontext, zone);
  check('4 noch nicht erzeugte Zone → abgelehnt', r.status === 'abgelehnt' && r.entfernt === 0, `(${r.grund})`);
  // Ort in der Zone (FEATURES ist leer, deshalb ein Stellvertreter für die Buchung).
  n.zm.erzeugeZone(zone);
  const vor = abzug(n.zdos);
  const mitOrt = ablehnungsGrund(
    {
      ...n.kontext,
      zones: {
        isZoneGenerated: () => true,
        getFeatureInstance: () => ({ name: 'Ort', pos: { x: 0, y: 0, z: 0 } }),
        nimmZoneZurueck: () => {
          throw new Error('darf nicht aufgerufen werden');
        },
        erzeugeZone: () => {
          throw new Error('darf nicht aufgerufen werden');
        },
      },
    },
    zone
  );
  check('4 Zone mit gebuchtem Ort → abgelehnt', mitOrt !== null && /Ort/.test(mitOrt), `(${mitOrt})`);
  check('4 abgelehnte Zonen verändern nichts', gleich(abzug(n.zdos), vor));
}

// ── 5. Alte Zone ohne Marke: Ersatzregel nur mit "alt" ───────────────
{
  const alt = welt(DOK_A);
  const zone = { x: -3, y: -1 };
  alt.zm.erzeugeZone(zone);
  const streu = menge(alt.zdos, zone);
  for (const z of streu) z.removeMember(getStableHash(STREU_MEMBER)); // Stand vor der Marke
  const mz = { x: zone.x * 64, y: 5, z: zone.y * 64 };
  const lay = alt.zdos.createZDO(baum, { ...mz, x: mz.x + 2 });
  lay.setString('layoutId', 'baum-im-dokument');
  const adminB = alt.zdos.createZDO(baum, { ...mz, x: mz.x - 5 });
  const tier = alt.zdos.createZDO(getStableHash('Deer'), { ...mz, z: mz.z + 4 });
  const bauwerk = alt.zdos.createZDO(baum, { ...mz, z: mz.z - 4 });
  bauwerk.setInt('spieler', 1); // Spielerbau: dann wird die Zone ohnehin abgelehnt
  const abgelehnt = setzeZoneZurueck(alt.kontext, zone, { alt: true });
  check('5 alte Zone mit Spielerbau → auch mit alt abgelehnt', abgelehnt.status === 'abgelehnt');
  alt.zdos.destroyZDO(bauwerk.zdoid);

  const b2 = neustart(alt, DOK_B);
  b2.zdos.consumeDestroyList(); // Reste aus dem Aufbau (zerstörter Spielerbau)
  const vorAbzug = abzug(b2.zdos);
  const zeilenLog: string[] = [];
  const ohneAlt = setzeZoneZurueck({ ...b2.kontext, protokoll: (l) => zeilenLog.push(l) }, zone);
  const erwartet = streu.length + 1; // Streu + Adminbaum: die Ersatzregel kann sie nicht trennen
  check(
    '5 alte Zone OHNE alt → abgelehnt, nennt die Zahl der Objekte, die die Ersatzregel träfe',
    ohneAlt.status === 'abgelehnt' && new RegExp(`träfe ${erwartet} `).test(ohneAlt.grund),
    `(${ohneAlt.grund})`
  );
  check(
    '5 alte Zone OHNE alt: 0 ZDOs verändert, nichts protokolliert',
    gleich(abzug(b2.zdos), vorAbzug) && zeilenLog.length === 0 && b2.zdos.consumeDestroyList().length === 0
  );
  const r = setzeZoneZurueck({ ...b2.kontext, protokoll: (l) => zeilenLog.push(l) }, zone, { alt: true });
  check(
    '5 mit alt: Ersatzregel greift, Zahl in der Rückmeldung',
    r.status === 'neu-gestreut' && r.ersatzregel === erwartet && /nach Ersatzregel entfernt/.test(formatiereErgebnis([r])),
    `(${r.ersatzregel})`
  );
  check(
    '5 mit alt: entfernt = Streu + Adminbaum (Grenze)',
    r.entfernt === erwartet,
    `(${r.entfernt} = ${streu.length} Streu + 1 Adminbaum)`
  );
  check(
    '5 mit alt: JEDES entfernte Objekt steht im Protokoll (Prefab, Lage)',
    zeilenLog.length === erwartet &&
      zeilenLog.every((l) => /Ersatzregel entfernt .+ \(-?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+\), Zone -3,-1/.test(l)) &&
      zeilenLog.some((l) => l.includes(`(${adminB.position.x.toFixed(2)}, `)),
    `(${zeilenLog.length} Zeilen; z. B. ${zeilenLog[0]})`
  );
  check('5 mit alt: Adminbaum weg (nicht von Streuung zu unterscheiden)', b2.zdos.getZDO(adminB.zdoid) === undefined);
  check(
    '5 mit alt: Layout-Baum (layoutId) und Kreatur bleiben',
    b2.zdos.getZDO(lay.zdoid) === lay && b2.zdos.getZDO(tier.zdoid) === tier
  );
  const c2 = welt(DOK_B);
  c2.zm.erzeugeZone(zone);
  check(
    '5 mit alt: danach Sollwert der frischen Erzeugung',
    r.gestreut === menge(c2.zdos, zone).length,
    `(${r.gestreut} / ${menge(c2.zdos, zone).length})`
  );
  // Jetzt trägt die Zone Marken: ein neuer Adminbaum überlebt den nächsten Reset, auch ohne alt.
  const neuerAdminBaum = b2.zdos.createZDO(baum, { ...mz, x: mz.x - 9 });
  const nochmal = setzeZoneZurueck(b2.kontext, zone);
  check(
    '5 nach dem ersten Reset trägt die Zone Marken: ohne alt möglich, Adminbaum überlebt',
    nochmal.status === 'neu-gestreut' && b2.zdos.getZDO(neuerAdminBaum.zdoid) === neuerAdminBaum && nochmal.ersatzregel === 0
  );
}

// ── Kahle Alt-Zone: die Ersatzregel träfe nichts, also kein alt nötig ───
{
  const w = welt(insel([]));
  const zone = { x: 2, y: 2 };
  w.zm.erzeugeZone(zone);
  const r = setzeZoneZurueck(w.kontext, zone);
  check('5 kahle Zone ohne Verdacht: Reset ohne alt möglich', r.status === 'neu-gestreut' && r.entfernt === 0, `(${r.status})`);
}

// ── 8. B1: Objekt auf der Zonengrenze — Herkunft entscheidet, nicht die Lage ─
{
  const A: ZoneID = { x: 2, y: 1 };
  const B: ZoneID = { x: 3, y: 1 }; // besitzt die Kante x = 160 nach worldToZone
  const kante = A.x * 64 + 32;
  const aufbau = (): { w: Welt; grenz: ZDO } => {
    const w = welt(DOK_A);
    w.zm.erzeugeZone(A);
    w.zm.erzeugeZone(B);
    const grenz = menge(w.zdos, A).find((z) => z.position.x > 100 && z.position.x < 150)!;
    w.zdos.updateZDOZone(grenz, { x: kante, y: grenz.position.y, z: grenz.position.z });
    return { w, grenz };
  };
  const herkunftAnzahl = (w: Welt, z: ZoneID): number =>
    w.zdos.getAllZDOs().filter((o) => Rueck.herkunftDerMarke?.(o)?.x === z.x && Rueck.herkunftDerMarke?.(o)?.y === z.y).length;
  const doppelte = (w: Welt): number => {
    const seen = new Map<string, number>();
    for (const o of w.zdos.getAllZDOs()) seen.set(zeile(o), (seen.get(zeile(o)) ?? 0) + 1);
    return [...seen.values()].filter((n) => n > 1).length;
  };
  const basis = aufbau();
  const soll = { gesamt: basis.w.zdos.totalZDOCount, a: herkunftAnzahl(basis.w, A), b: herkunftAnzahl(basis.w, B) };
  check(
    '8 Grenzobjekt liegt nach worldToZone in der Nachbarzone (der Test stellt den Fall her)',
    HeightmapProvider.worldToZone(basis.grenz.position.x) === B.x && Rueck.herkunftDerMarke?.(basis.grenz)?.x === A.x,
    `(x = ${basis.grenz.position.x}, Herkunft ${JSON.stringify(Rueck.herkunftDerMarke?.(basis.grenz))})`
  );
  for (const [name, folge] of [
    ['Erzeuger, dann Besitzer', [A, B]],
    ['Besitzer, dann Erzeuger', [B, A]],
    ['Erzeuger, Besitzer, Erzeuger', [A, B, A]],
    ['Besitzer, Erzeuger, Besitzer', [B, A, B]],
  ] as const) {
    const { w } = aufbau();
    const rs = folge.map((z) => setzeZoneZurueck(w.kontext, z));
    check(
      `8 ${name}: keine Verdopplung, kein Verlust`,
      rs.every((r) => r.status === 'neu-gestreut') &&
        w.zdos.totalZDOCount === soll.gesamt &&
        herkunftAnzahl(w, A) === soll.a &&
        herkunftAnzahl(w, B) === soll.b &&
        doppelte(w) === 0,
      `(gesamt ${w.zdos.totalZDOCount}/${soll.gesamt}, A ${herkunftAnzahl(w, A)}/${soll.a}, B ${herkunftAnzahl(w, B)}/${soll.b}, doppelt ${doppelte(w)})`
    );
  }
  // Radius-Reset über beide Zonen, in beiden Reihenfolgen (Radius 1 um A: Mitte zuerst; um B: B zuerst).
  for (const [name, mx] of [['Radius 1 um A (Erzeuger zuerst)', A.x], ['Radius 1 um B (Besitzer zuerst)', B.x]] as const) {
    const { w } = aufbau();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) w.zm.erzeugeZone({ x: mx + dx, y: 1 + dy });
    const vorGesamt = w.zdos.totalZDOCount;
    const vorA = herkunftAnzahl(w, A);
    const rs = setzeZonenZurueck(w.kontext, mx, 1, 1);
    check(
      `8 ${name}: keine Verdopplung, kein Verlust`,
      rs.every((r) => r.status === 'neu-gestreut') &&
        w.zdos.totalZDOCount === vorGesamt &&
        herkunftAnzahl(w, A) === vorA &&
        doppelte(w) === 0,
      `(gesamt ${w.zdos.totalZDOCount}/${vorGesamt}, A ${herkunftAnzahl(w, A)}/${vorA}, doppelt ${doppelte(w)})`
    );
  }
}

// ── 8a. B1 gemischt: Erzeuger neu (markiert), Besitzer alt (ohne Marke) ─
// Das ist der Fall des Angriffs auf den echten Spielstand: Nachbar mit GENAU EINEM markierten
// Objekt (dem Grenzobjekt) und sonst nur Altbestand.
{
  const A: ZoneID = { x: 2, y: 1 };
  const B: ZoneID = { x: 3, y: 1 };
  const kante = A.x * 64 + 32;
  const aufbau = (): Welt => {
    const w = welt(DOK_A);
    w.zm.erzeugeZone(A);
    w.zm.erzeugeZone(B);
    for (const z of menge(w.zdos, B)) z.removeMember(getStableHash(STREU_MEMBER)); // B: Altzone
    const grenz = menge(w.zdos, A).find((z) => z.position.x > 100 && z.position.x < 150)!;
    w.zdos.updateZDOZone(grenz, { x: kante, y: grenz.position.y, z: grenz.position.z });
    return w;
  };
  const doppelte = (w: Welt): number => {
    const seen = new Map<string, number>();
    for (const o of w.zdos.getAllZDOs()) seen.set(zeile(o), (seen.get(zeile(o)) ?? 0) + 1);
    return [...seen.values()].filter((n) => n > 1).length;
  };
  const basis = aufbau();
  const gesamt = basis.zdos.totalZDOCount;
  for (const [name, folge] of [
    ['Erzeuger, dann Besitzer', [A, B]],
    ['Besitzer, dann Erzeuger', [B, A]],
    ['Erzeuger, Besitzer, Erzeuger', [A, B, A]],
    ['Besitzer, Erzeuger, Besitzer', [B, A, B]],
  ] as const) {
    const w = aufbau();
    const rs = folge.map((z) => setzeZoneZurueck({ ...w.kontext, protokoll: () => undefined }, z, { alt: true }));
    check(
      `8a gemischt, ${name}: keine Verdopplung, kein Verlust`,
      rs.every((r) => r.status === 'neu-gestreut') && w.zdos.totalZDOCount === gesamt && doppelte(w) === 0,
      `(gesamt ${w.zdos.totalZDOCount}/${gesamt}, doppelt ${doppelte(w)})`
    );
  }
}

// ── 8b. Alte Kantenobjekte ohne Marke: die Neuerzeugung erkennt ihr eigenes Doppel ─
{
  const A: ZoneID = { x: 2, y: 1 };
  const kante = A.x * 64 + 32;
  const w = welt(DOK_A);
  w.zm.erzeugeZone(A);
  for (const z of menge(w.zdos, A)) z.removeMember(getStableHash(STREU_MEMBER)); // Altzone
  const vorlage = menge(w.zdos, A)[0]!;
  const eigenesAlt = w.zdos.createZDO(vorlage.prefabHash, { x: kante, y: 3, z: A.y * 64 + 5 });
  const fremdesAlt = w.zdos.createZDO(vorlage.prefabHash, { x: kante, y: 3, z: A.y * 64 - 9 });
  const log: string[] = [];
  // Stellvertreter für "die Streuung erzeugt genau auf der Kante" (der echte Fall ist selten: 1 von ~6500).
  const zones = {
    isZoneGenerated: (z: ZoneID): boolean => w.zm.isZoneGenerated(z),
    getFeatureInstance: (z: ZoneID) => w.zm.getFeatureInstance(z),
    nimmZoneZurueck: (z: ZoneID): boolean => w.zm.nimmZoneZurueck(z),
    erzeugeZone: (z: ZoneID): boolean => {
      const ok = w.zm.erzeugeZone(z);
      const neu = w.zdos.createZDO(eigenesAlt.prefabHash, { x: kante, y: 3, z: A.y * 64 + 5 });
      neu.setInt(STREU_MEMBER, Rueck.packeHerkunft?.(z) ?? 1);
      return ok;
    },
  };
  const r = setzeZoneZurueck({ ...w.kontext, zones, protokoll: (l) => log.push(l) }, A, { alt: true });
  const ander = (o: ZDO): boolean => o.position.x === kante && o.position.z === A.y * 64 + 5;
  check(
    '8b eigenes Kantenobjekt: alt weg, genau ein neues an der Stelle',
    r.kantenDoppel === 1 &&
      w.zdos.getZDO(eigenesAlt.zdoid) === undefined &&
      w.zdos.getAllZDOs().filter(ander).length === 1 &&
      log.some((l) => /Kantenobjekt als Doppel/.test(l)),
    `(kantenDoppel ${r.kantenDoppel}, an der Stelle ${w.zdos.getAllZDOs().filter(ander).length})`
  );
  check(
    '8b fremdes Kantenobjekt (Neuerzeugung erzeugt es nicht): bleibt, kein Verlust',
    w.zdos.getZDO(fremdesAlt.zdoid) === fremdesAlt
  );
}

// ── 9. B3: beschädigte Pflanzen werden gezählt ───────────────────────
{
  const w = welt(DOK_A);
  const zone = { x: 2, y: 1 };
  w.zm.erzeugeZone(zone);
  const ziele = menge(w.zdos, zone).slice(0, 3);
  for (const z of ziele) z.setInt('health', 42);
  const r = setzeZoneZurueck(w.kontext, zone);
  check(
    '9 angeschlagene Pflanzen: zurückgesetzt und in der Rückmeldung gezählt',
    r.status === 'neu-gestreut' &&
      r.beschaedigt === 3 &&
      /3 beschädigte Pflanzen zurückgesetzt/.test(formatiereErgebnis([r])) &&
      ziele.every((z) => w.zdos.getZDO(z.zdoid) === undefined) &&
      menge(w.zdos, zone).every((z) => !z.hasMember(getStableHash('health'))),
    `(${r.beschaedigt})`
  );
  const glatt = setzeZoneZurueck(w.kontext, zone);
  check('9 ohne Beschädigung steht nichts davon in der Rückmeldung', glatt.beschaedigt === 0 && !/beschädigte/.test(formatiereErgebnis([glatt])));
}

// ── 10. Marke: Herkunft packen, Altform 1 ────────────────────────────
{
  const gesehen = new Set<number>();
  let ok = true;
  for (let x = -170; x <= 170; x++) {
    for (let y = -170; y <= 170; y++) {
      const wert = Rueck.packeHerkunft?.({ x, y }) ?? 0;
      if (wert < 2 || gesehen.has(wert)) ok = false;
      gesehen.add(wert);
    }
  }
  check('10 Herkunft: 116 281 Zonen, jede Kennung >= 2 und eindeutig', ok && gesehen.size === 341 * 341, `(${gesehen.size})`);
  const dummy = welt(DOK_A).zdos.createZDO(baum, { x: 0, y: 0, z: 0 });
  let rundlauf = true;
  for (const z of [{ x: 0, y: 0 }, { x: -1, y: 1 }, { x: -170, y: 170 }, { x: 16383, y: -16384 }]) {
    dummy.setInt(STREU_MEMBER, Rueck.packeHerkunft?.(z) ?? 1);
    const h = Rueck.herkunftDerMarke?.(dummy);
    if (!h || h.x !== z.x || h.y !== z.y) rundlauf = false;
  }
  check('10 Herkunft: Rundlauf über negative und Randzonen', rundlauf);
  check('10 Außerhalb ±16384 Zonen: Marke ohne Herkunft (1)', Rueck.packeHerkunft?.({ x: 20000, y: 0 }) === 1);
  dummy.setInt(STREU_MEMBER, 1);
  check('10 Altform streu = 1: keine Herkunft', Rueck.herkunftDerMarke?.(dummy) === null);

  // Zone voller Altform-Marken (streu = 1): wie eine unmarkierte behandelt — Ersatzregel nur mit alt.
  const w = welt(DOK_A);
  const zone = { x: 2, y: 1 };
  w.zm.erzeugeZone(zone);
  const menge1 = menge(w.zdos, zone);
  for (const z of menge1) z.setInt(STREU_MEMBER, 1);
  const abgelehnt = setzeZoneZurueck(w.kontext, zone);
  check(
    '10 Zone mit Altform-Marken (1): ohne alt abgelehnt, nichts verändert',
    abgelehnt.status === 'abgelehnt' && new RegExp(`träfe ${menge1.length} `).test(abgelehnt.grund) && w.zdos.totalZDOCount === menge1.length,
    `(${abgelehnt.grund})`
  );
  const erzwungen = setzeZoneZurueck({ ...w.kontext, protokoll: () => undefined }, zone, { alt: true });
  check(
    '10 Zone mit Altform-Marken (1): mit alt zurückgesetzt, danach neue Herkunftsmarken',
    erzwungen.status === 'neu-gestreut' &&
      erzwungen.entfernt === menge1.length &&
      menge(w.zdos, zone).every((z) => Rueck.herkunftDerMarke?.(z)?.x === zone.x)
  );
}

// ── Radius ───────────────────────────────────────────────────────────
{
  const w = welt(DOK_B);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) w.zm.erzeugeZone({ x: 4 + dx, y: 4 + dy });
  }
  const alle = setzeZonenZurueck(w.kontext, 4, 4, 1);
  check(
    'Radius 1: neun Zonen, die Mitte zuerst, alle neu gestreut',
    alle.length === 9 &&
      alle[0]!.zone.x === 4 &&
      alle[0]!.zone.y === 4 &&
      alle.every((e) => e.status === 'neu-gestreut'),
    `(${alle.length}; ${alle.map((e) => e.ms).join('/')} ms)`
  );
  const gross = setzeZonenZurueck(w.kontext, 4, 4, 99);
  check(
    `Radius wird auf ${MAX_RADIUS_ZONEN} begrenzt`,
    gross.length === (2 * MAX_RADIUS_ZONEN + 1) ** 2,
    `(${gross.length})`
  );
}

// ── 6. Befehl und Freigabe ───────────────────────────────────────────
{
  const aufrufe: Array<[number, number, number, boolean]> = [];
  const registry = new AdminCommandRegistry({
    bodenHoehe: () => 0,
    zonenRuecksetzen: (zx, zy, r, alt) => {
      aufrufe.push([zx, zy, r, alt]);
      return [
        {
          zone: { x: zx, y: zy },
          status: 'neu-gestreut',
          grund: '',
          entfernt: 4,
          gestreut: 5,
          ersatzregel: 0,
          beschaedigt: 2,
          kantenDoppel: 0,
          ms: 1.5,
        },
      ];
    },
  });
  const merke = { inst: process.env.WOV_INSTANZ, flag: process.env.WOV_ZONEN_RUECKSETZER };
  const setzeEnv = (inst: string | undefined, flag: string | undefined): void => {
    if (inst === undefined) delete process.env.WOV_INSTANZ;
    else process.env.WOV_INSTANZ = inst;
    if (flag === undefined) delete process.env.WOV_ZONEN_RUECKSETZER;
    else process.env.WOV_ZONEN_RUECKSETZER = flag;
  };
  try {
    setzeEnv('live', undefined);
    const gesperrt = registry.execute(admin, 'zone reset 128 64');
    check('6 live ohne Variable → abgelehnt', !gesperrt.ok && /ausdrücklich dev/.test(gesperrt.message) && aufrufe.length === 0, `(${gesperrt.message})`);
    setzeEnv('live', '0');
    check('6 live mit WOV_ZONEN_RUECKSETZER=0 → abgelehnt', !registry.execute(admin, 'zone reset 128 64').ok && aufrufe.length === 0);
    setzeEnv('live', '1');
    const frei = registry.execute(admin, 'zone reset 128 64 2');
    check('6 live mit WOV_ZONEN_RUECKSETZER=1 → erlaubt, Weltkoordinaten → Zone', frei.ok && aufrufe.length === 1 && aufrufe[0]!.join() === '2,1,2,false', `(${aufrufe[0]})`);
    check('6 Rückmeldung nennt entfernt / neu gestreut / ms', /4 entfernt, 5 neu gestreut \(1.5 ms\)/.test(frei.message), `(${frei.message.split('\n')[0]})`);
    check('6 Rückmeldung nennt die beschädigten Pflanzen', /2 beschädigte Pflanzen zurückgesetzt/.test(frei.message));
    setzeEnv('dev', undefined);
    check('6 dev → erlaubt', registry.execute(admin, 'zone reset 0 0').ok && aufrufe.length === 2);
    setzeEnv('dev', '0');
    check('6 dev mit Variable 0 → erlaubt (dev genügt)', registry.execute(admin, 'zone reset 0 0').ok && aufrufe.length === 3);
    // B4: Zweifel schließt. Ohne ausdrückliches dev (kein Rückfall) und ohne Variable: gesperrt.
    for (const inst of [undefined, '', '  ', 'DEV', ' dev ', 'liv', 'production', 'dev2']) {
      setzeEnv(inst, undefined);
      const n = aufrufe.length;
      check(`6 WOV_INSTANZ=${JSON.stringify(inst)} ohne Variable → gesperrt`, !registry.execute(admin, 'zone reset 0 0').ok && aufrufe.length === n);
    }
    setzeEnv(undefined, '1');
    check('6 ohne WOV_INSTANZ, aber WOV_ZONEN_RUECKSETZER=1 → erlaubt', registry.execute(admin, 'zone reset -33 96').ok && aufrufe[aufrufe.length - 1]!.join() === '-1,2,0,false');
    for (const f of ['true', ' 1', '01', 'yes']) {
      setzeEnv('live', f);
      const n = aufrufe.length;
      check(`6 live mit WOV_ZONEN_RUECKSETZER=${JSON.stringify(f)} → gesperrt (nur genau 1)`, !registry.execute(admin, 'zone reset 0 0').ok && aufrufe.length === n);
    }
    setzeEnv('dev', undefined);
    // alt-Zusatz
    const vor = aufrufe.length;
    registry.execute(admin, 'zone reset 128 64 alt');
    registry.execute(admin, 'zone reset 128 64 2 alt');
    registry.execute(admin, 'zone reset 128 64 ALT 3');
    registry.execute(admin, 'zone reset 128 64 1');
    check(
      '6 alt-Zusatz: Radius optional, Reihenfolge frei, ohne alt = false',
      aufrufe.slice(vor).map((a) => a.join()).join('|') === '2,1,0,true|2,1,2,true|2,1,3,true|2,1,1,false',
      `(${aufrufe.slice(vor).map((a) => a.join()).join('|')})`
    );
    const vorher = aufrufe.length;
    for (const zeileText of [
      'zone',
      'zone reset',
      'zone reset 1',
      'zone reset a b',
      'zone reset 0 0 -1',
      'zone reset 0 0 1.5',
      `zone reset 0 0 ${MAX_RADIUS_ZONEN + 1}`,
      'zone reset 0 0 1 2',
      'zone reset 0 0 alt alt 1 2',
      'zone jetzt 0 0',
    ]) {
      const r = registry.execute(admin, zeileText);
      check(`6 "${zeileText}" → Aufruf-Hinweis, nichts ausgeführt`, !r.ok && /Aufruf: zone reset/.test(r.message) && aufrufe.length === vorher, `(${r.message.slice(0, 40)})`);
    }
    check('6 Nicht-Admin bleibt draußen', !registry.execute({ isAdmin: false } as unknown as Peer, 'zone reset 0 0').ok && aufrufe.length === vorher);
    const ohneWelt = new AdminCommandRegistry({ bodenHoehe: () => 0 });
    check('6 ohne Weltzugriff → abgelehnt statt Absturz', !ohneWelt.execute(admin, 'zone reset 0 0').ok);
  } finally {
    setzeEnv(merke.inst, merke.flag);
  }
}

console.log(fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) FEHLGESCHLAGEN`);
process.exit(fehler === 0 ? 0 : 1);
