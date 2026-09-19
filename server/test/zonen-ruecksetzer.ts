/**
 * K1.4 — Zonen-Rücksetzer: `zone reset` würfelt die Streuung erzeugter Zonen
 * neu und lässt alles andere stehen.
 *
 * Geprüft wird, mit Zahlen:
 *  1. Die Streuung markiert, was sie anlegt (`streu = 1`), und nur das.
 *  2. Nach einem Dokumentwechsel (anderer Bewuchs-Regler) trifft der Reset
 *     die Zone so, wie eine frische Erzeugung mit dem neuen Dokument sie
 *     gebaut hätte — Stückzahl und jede einzelne Pflanze auf ±0.
 *  3. Layout-Objekte, Adminbäume (ohne Marke), Kreaturen bleiben unberührt.
 *  4. Zonen mit Spielerbau (Int, Float, Text) oder Terraforming werden
 *     abgelehnt, und zwar ohne ein einziges ZDO zu verändern.
 *  5. Alte Zonen ohne Marke: Ersatzregel — die Grenze wird als Zahl benannt.
 *  6. Der Befehl ist ohne `dev`-Instanz und ohne Umgebungsvariable gesperrt.
 *  7. Die Änderung geht über die normale Replikation: Zerstörungsliste und
 *     Dirty-Menge, kein Client-Umbau.
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
  istMarkiertStreu,
  setzeZoneZurueck,
  setzeZonenZurueck,
  type RuecksetzKontext,
} from '../src/world/zonenRuecksetzer.js';

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
  '1 jedes Streu-ZDO trägt die Marke, keines fehlt',
  markiertA.length === alleA.length && alleA.every((z) => z.getInt(STREU_MEMBER) === 1),
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

// ── 5. Alte Zone ohne Marke: Ersatzregel ─────────────────────────────
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
  const abgelehnt = setzeZoneZurueck(alt.kontext, zone);
  check('5 alte Zone mit Spielerbau → abgelehnt', abgelehnt.status === 'abgelehnt');
  alt.zdos.destroyZDO(bauwerk.zdoid);

  const b2 = neustart(alt, DOK_B);
  const r = setzeZoneZurueck(b2.kontext, zone);
  check('5 Ersatzregel wird gemeldet', r.status === 'neu-gestreut' && r.ersatzregel);
  check(
    '5 alte Zone: entfernt = Streu + Adminbaum (Grenze)',
    r.entfernt === streu.length + 1,
    `(${r.entfernt} = ${streu.length} Streu + 1 Adminbaum)`
  );
  check('5 alte Zone: Adminbaum weg (nicht von Streuung zu unterscheiden)', b2.zdos.getZDO(adminB.zdoid) === undefined);
  check(
    '5 alte Zone: Layout-Baum (layoutId) und Kreatur bleiben',
    b2.zdos.getZDO(lay.zdoid) === lay && b2.zdos.getZDO(tier.zdoid) === tier
  );
  const c2 = welt(DOK_B);
  c2.zm.erzeugeZone(zone);
  check(
    '5 alte Zone: danach Sollwert der frischen Erzeugung',
    r.gestreut === menge(c2.zdos, zone).length,
    `(${r.gestreut} / ${menge(c2.zdos, zone).length})`
  );
  // Jetzt trägt die Zone Marken: ein neuer Adminbaum überlebt den nächsten Reset.
  const neuerAdminBaum = b2.zdos.createZDO(baum, { ...mz, x: mz.x - 9 });
  setzeZoneZurueck(b2.kontext, zone);
  check('5 nach dem ersten Reset trägt die Zone Marken: Adminbaum überlebt', b2.zdos.getZDO(neuerAdminBaum.zdoid) === neuerAdminBaum);
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
  const aufrufe: Array<[number, number, number]> = [];
  const registry = new AdminCommandRegistry({
    bodenHoehe: () => 0,
    zonenRuecksetzen: (zx, zy, r) => {
      aufrufe.push([zx, zy, r]);
      return [
        { zone: { x: zx, y: zy }, status: 'neu-gestreut', grund: '', entfernt: 4, gestreut: 5, ersatzregel: false, ms: 1.5 },
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
    check('6 live ohne Variable → abgelehnt', !gesperrt.ok && /nur auf der Dev-Instanz/.test(gesperrt.message) && aufrufe.length === 0, `(${gesperrt.message})`);
    setzeEnv('live', '0');
    check('6 live mit WOV_ZONEN_RUECKSETZER=0 → abgelehnt', !registry.execute(admin, 'zone reset 128 64').ok && aufrufe.length === 0);
    setzeEnv('live', '1');
    const frei = registry.execute(admin, 'zone reset 128 64 2');
    check('6 live mit WOV_ZONEN_RUECKSETZER=1 → erlaubt, Weltkoordinaten → Zone', frei.ok && aufrufe.length === 1 && aufrufe[0]!.join() === '2,1,2', `(${aufrufe[0]})`);
    check('6 Rückmeldung nennt entfernt / neu gestreut / ms', /4 entfernt, 5 neu gestreut \(1.5 ms\)/.test(frei.message), `(${frei.message.split('\n')[0]})`);
    setzeEnv('dev', undefined);
    check('6 dev → erlaubt', registry.execute(admin, 'zone reset 0 0').ok && aufrufe.length === 2);
    setzeEnv(undefined, undefined);
    check('6 ohne WOV_INSTANZ gilt dev → erlaubt', registry.execute(admin, 'zone reset -33 96').ok && aufrufe[2]!.join() === '-1,2,0', `(${aufrufe[2]})`);
    setzeEnv('dev', undefined);
    const vorher = aufrufe.length;
    for (const zeileText of ['zone', 'zone reset', 'zone reset 1', 'zone reset a b', 'zone reset 0 0 -1', 'zone reset 0 0 1.5', `zone reset 0 0 ${MAX_RADIUS_ZONEN + 1}`, 'zone jetzt 0 0']) {
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
