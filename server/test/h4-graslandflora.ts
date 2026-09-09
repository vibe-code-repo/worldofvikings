/**
 * H4 — Bewuchs einer Layout-Insel: eigene Flora, gar nichts, und das in
 * jedem Biom.
 *
 * Die drei Zustände von `RegionDef.vegetation` entscheiden, was auf einer
 * Insel wächst. Sie sind im Editor drei Knöpfe, im Dokument drei Formen
 * desselben Feldes — und hier wird nachgesehen, ob am Ende auch das aus
 * dem Boden kommt, was der Knopf verspricht:
 *
 *   Feld fehlt    → KEIN Bewuchs (seit Block A: es gibt keine
 *                   Biom-Standardtabelle mehr, FOLIAGE ist reine
 *                   Eigenflora und wächst nur auf Bestellung)
 *   Liste gefüllt → exakt diese Arten, sonst nichts
 *   Liste leer    → gar nichts
 *
 * Der mittlere Fall ist der eigentliche Prüfstein. Eine Art wird nur
 * gestreut, wenn sie BEIDES hat: einen Streueintrag in FOLIAGE
 * (`shared/src/flora.ts`) und einen Platz in der Kuratierungsliste.
 * Fehlt eines von beiden, bleibt die Insel kahl — und zwar lautlos.
 *
 * ── Warum der Test nicht mehr nur Grasland prüft ─────────────────────
 * Genau daran wäre die Welt beinahe gescheitert. Alle eigenen Einträge
 * trugen `Biome.Meadows`, und die Biom-Maske greift im Streudurchlauf
 * VOR dem Kuratierungstor. Vier Regionen der Welt tragen ein anderes
 * Biom — insel-2 (blackforest), insel-3 (swamp), land-1 (deepnorth),
 * insel-16 (ashlands) — und wären trotz gefüllter Liste vollständig
 * kahl geblieben. Ohne Fehlermeldung, denn ein abgewiesener Kandidat ist
 * im Streudurchlauf der Normalfall.
 *
 * Abschnitt 10 ist der Wächter dagegen: In einer kuratierten Region der
 * Biome blackforest, swamp und deepnorth MUSS Bewuchs entstehen, und
 * zwar ausschliesslich aus der jeweiligen Liste. Vier stille leere
 * Regionen fallen niemandem auf; eine rote Zeile hier schon.
 *
 * Lauf: npx tsx server/test/h4-graslandflora.ts
 */

import {
  ASCHE_FLORA_NAMEN,
  GRASLAND_FLORA_NAMEN,
  HOCHNORD_FLORA_NAMEN,
  NADELWALD_FLORA_NAMEN,
  SUMPF_FLORA_NAMEN,
  HeightmapProvider,
  RegionGeo,
  findPrefabByHash,
  findPrefabByName,
  getStableHash,
  sanitizeWorldLayout,
  STORE_FLORA_AKTIV,
  STORE_FLORA_BEREIT,
  STORE_GRAS_AKTIV,
  type WorldLayout,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

const SEED = getStableHash('GraslandProbe');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

/**
 * Eine Insel um den Nullpunkt, wahlweise kuratiert.
 *
 * Der Radius ist absichtlich grosszuegig (1600 m): Der Streutest laeuft
 * ueber 11 x 11 Zonen a 64 m, und jeder Punkt ausserhalb der Region
 * bekaeme die Ozean-Vorgabe statt der Inselregel.
 *
 * `biom` ist der zweite Parameter und nicht der erste, damit die
 * bestehenden Aufrufe unveraendert Grasland pruefen. `baseLevel` bleibt
 * fuer JEDES Biom bei 0.3 — die biomeigenen Vorgaben (Sumpf 0.16,
 * Hochnord 0.34) wuerden die Insel unterschiedlich hoch aus dem Wasser
 * heben, und dann maesse man beim Biomvergleich die Hoehe mit.
 */
function insel(vegetation?: readonly string[], biom = 'grassland'): WorldLayout {
  const region: Record<string, unknown> = {
    id: 'probe',
    biome: biom,
    shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
    edgeFalloff: 200,
    baseLevel: 0.3,
  };
  if (vegetation !== undefined) region.vegetation = [...vegetation];
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'Graslandprobe',
    detailSeed: 'gp',
    continents: [],
    regions: [region],
  });
  if (!layout) throw new Error('Testlayout wurde verworfen');
  return layout;
}

/** Streut die Zonen um den Nullpunkt und zaehlt die Prefabs nach Namen. */
function bewuchs(layout: WorldLayout): Map<string, number> {
  // RegionGeo IST der GeoManager im Layout-Modus; der ZoneManager erkennt
  // ihn am Typ (ZoneManager.ts:279) und schaltet die Kuratierung frei.
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, {
    blendSmoothStep: true,
    bilinearSampling: false,
  });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
  // Ein "Spieler" im Inselzentrum zieht die Zonen um sich herum auf.
  zm.update([{ x: 0, y: 40, z: 0 }], 60_000);
  const zaehler = new Map<string, number>();
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      for (const zdo of zdos.getZDOsInZone({ x: zx, y: zy })) {
        const name = findPrefabByHash(zdo.prefabHash)?.name ?? String(zdo.prefabHash);
        zaehler.set(name, (zaehler.get(name) ?? 0) + 1);
      }
    }
  }
  return zaehler;
}

const eigen = new Set(GRASLAND_FLORA_NAMEN);
const summe = (m: Map<string, number>, wenn: (n: string) => boolean): number => {
  let s = 0;
  for (const [n, k] of m) if (wenn(n)) s += k;
  return s;
};

/*
  ── Baum, Strauch oder Bodenpflanze: GEMESSEN, nicht am Namen geraten ──

  Bis zur Store-Vegetation stand hier eine Namensliste (`Eiche`, `Birke`,
  `Hasel`, `Margerite` …). Sie war stumpf geworden, sobald die
  Kuratierungslisten auf den Store umschalten (`STORE_FLORA_AKTIV` in
  `shared/src/storeFlora.ts`): Die Arten heissen dann
  `vegetation-tree-1a3`, jede Namensregel greift ins Leere, und der Test
  meldete nicht „falscher Bewuchs", sondern „Bäume vertreten: nein" —
  bei einem Wald aus 2.100 Bäumen.

  Die Höhe aus `renderScale.h` ist die Auskunft, die BEIDE Bestände
  geben, und sie ist die, um die es hier eigentlich geht: Ein Grasland
  ohne etwas Hohes, etwas Mittleres und etwas Bodennahes ist eine halbe
  Umsetzung — unabhängig davon, wie die Arten heissen. Die Grenzen sind
  am Bestand abgelesen und lassen bewusst Luft: Der niedrigste Baum
  beider Bestände misst 6,7 m, der höchste Strauch 4,8 m, das höchste
  Gras 0,3 m.
*/
const hoehe = (name: string): number => findPrefabByName(name)?.renderScale.h ?? 0;
const istBaum = (name: string): boolean => hoehe(name) >= 6;
const istStrauch = (name: string): boolean => hoehe(name) >= 1 && hoehe(name) < 6;
const istBodenpflanze = (name: string): boolean => hoehe(name) > 0 && hoehe(name) < 1;

// ── 1. Kuratiert: eigene Flora, sonst nichts ─────────────────────────
const mitFlora = bewuchs(insel(GRASLAND_FLORA_NAMEN));
const eigenAnzahl = summe(mitFlora, (n) => eigen.has(n));
const fremdAnzahl = summe(mitFlora, (n) => !eigen.has(n));
check('kuratiert: eigene Flora wächst', eigenAnzahl > 0, `= ${eigenAnzahl} Stück`);
check('kuratiert: NICHTS ausserhalb der Liste', fremdAnzahl === 0, `= ${fremdAnzahl} fremde`);
// Alle drei Schichten müssen vertreten sein — eine Wiese ohne Bäume oder
// ohne Blumen wäre kein Grasland, sondern eine halbe Umsetzung.
const artenMit = [...mitFlora.keys()].filter((n) => eigen.has(n));
check('kuratiert: Bäume vertreten', artenMit.some(istBaum));
check('kuratiert: Sträucher vertreten', artenMit.some(istStrauch));
/*
  ⚠ Die unterste Schicht ist seit Stufe 2 nicht mehr Sache der STREUUNG.
  Die vier `grass-short-clump-*` waren die einzigen Arten unter einem
  Meter; sie zeichnet jetzt der Gras-Clutter als Thin Instances
  (`client/src/engine/GrassClutter.ts`, Schalter `STORE_GRAS_AKTIV`).

  Der Wächter wird deshalb nicht gestrichen, sondern umgehängt: Solange
  der Clutter zuständig ist, MUSS die Streuliste den Boden freilassen —
  stünde dort wieder eine Bodenpflanze, stünde sie im Clutter-Gras. Ist
  der Clutter aus, gilt die alte Zusage unverändert. So bleibt in beiden
  Stellungen genau eine Quelle für die unterste Schicht, und der Test
  sagt, welche.
*/
if (STORE_GRAS_AKTIV) {
  check(
    'kuratiert: unterste Schicht liegt beim Clutter, nicht in der Streuung',
    !artenMit.some(istBodenpflanze),
    artenMit.filter(istBodenpflanze).join(', ')
  );
} else {
  check('kuratiert: Bodenpflanzen vertreten', artenMit.some(istBodenpflanze));
}

// ── 2. Ohne Kuratierung: gar nichts ──────────────────────────────────
// Bis Block A stand hier „Originalbewuchs vorhanden": Eine Region ohne
// Liste fiel auf die Biom-Standardtabelle aus `vegetation.pkg` zurück.
// Die Tabelle gibt es nicht mehr — FOLIAGE besteht nur noch aus eigener
// Flora, und die wächst ausschliesslich auf Bestellung. Eine Region ohne
// `vegetation` bleibt deshalb kahl.
//
// Der Fall bleibt trotzdem stehen, und zwar schärfer als vorher: Er ist
// die Probe darauf, dass eigene Flora NICHT von allein aufgeht. Seit die
// Biom-Maske durchlässig ist (ALLE_BIOME), hängt daran alles — fiele die
// Bestellregel weg, stünde ab sofort auf jeder Insel jede Pflanze.
const standard = bewuchs(insel(undefined));
check(
  'standard: ohne Bestellung wächst gar nichts',
  summe(standard, () => true) === 0,
  `= ${summe(standard, () => true)}`
);

// ── 3. Leere Liste: gar nichts ───────────────────────────────────────
const kahl = bewuchs(insel([]));
check('leer: gar kein Bewuchs', summe(kahl, () => true) === 0, `= ${summe(kahl, () => true)}`);

// ── 4. Nadelwald: anderes Bündel, mehr Bäume ─────────────────────────
const nadelwald = bewuchs(insel(NADELWALD_FLORA_NAMEN));
const nadelArten = [...nadelwald.keys()];
/*
  Nadelholz heisst im Altbestand `Fichte`/`Tanne`/`Kiefer` und im
  Store-Bestand `vegetation-pine-*`. Beides steht hier ausdrücklich
  nebeneinander — an der Höhe ist ein Nadelbaum nicht von einem
  Laubbaum zu unterscheiden, und der Punkt dieses Wächters ist genau,
  dass der Nadelwald NADELHOLZ trägt und nicht bloss Bäume.
*/
const istNadelholz = (n: string): boolean => /^(Fichte|Tanne|Kiefer)/.test(n) || /^vegetation-pine/.test(n);
check(
  'nadelwald: Nadelholz wächst',
  nadelArten.filter(istNadelholz).length >= 2,
  nadelArten.filter(istNadelholz).join(', ')
);
check(
  'nadelwald: keine Wiesenblumen unter dem Kronendach',
  !nadelArten.some((n) => /^(Margerite|Glockenblume|Trollblume|Schafgarbe)/.test(n)),
  nadelArten.filter((n) => /^(Margerite|Glockenblume|Trollblume|Schafgarbe)/.test(n)).join(', ')
);
// Der Nadelwald ist der DICHTE Typ — er muss mehr Bäume tragen als das
// Grasland, sonst ist die Unterscheidung nur ein anderer Name.
const baeume = (m: Map<string, number>): number => summe(m, istBaum);
check(
  'nadelwald: mehr Bäume als im Grasland',
  baeume(nadelwald) > baeume(mitFlora),
  `Nadelwald ${baeume(nadelwald)} vs. Grasland ${baeume(mitFlora)}`
);

// ── 5. Bewuchsdichte skaliert die Stückzahl ──────────────────────────
// Der Regler im Editor. Er darf die Menge ändern, ohne die Welt neu zu
// würfeln — deshalb wird NACH der Ziehung skaliert (siehe streuung.ts).
function mitDichte(faktor: number): WorldLayout {
  const l = insel(GRASLAND_FLORA_NAMEN) as { regions: Array<Record<string, unknown>> };
  l.regions[0]!.bewuchsDichte = faktor;
  return sanitizeWorldLayout(l)!;
}
const duenn = bewuchs(mitDichte(0.3));
const dick = bewuchs(mitDichte(2.5));
const g = summe(mitFlora, () => true);
const d1 = summe(duenn, () => true);
const d2 = summe(dick, () => true);
check('dichte: 0.3 dünnt aus', d1 < g, `${d1} < ${g}`);
check('dichte: 2.5 verdichtet', d2 > g, `${d2} > ${g}`);
console.log(`  Dichte 0.3 → ${d1} | 1.0 → ${g} | 2.5 → ${d2} Pflanzen`);

// ── 6. Waldkörnung: Struktur statt Menge ─────────────────────────────
// Der dritte Regler. Er darf den Waldanteil NICHT nennenswert ändern —
// sonst wäre er nur ein zweites forestDensity. Was er ändert, ist die
// Grösse der zusammenhängenden Flächen.
{
  const laufweite = (koernung?: number): { anteil: number; mittel: number } => {
    const region: Record<string, unknown> = {
      id: 'w', biome: 'grassland',
      shape: { kind: 'circle', x: 0, z: 0, radius: 6000 },
      edgeFalloff: 200, baseLevel: 0.3,
    };
    if (koernung !== undefined) region.waldKoernung = koernung;
    const l = sanitizeWorldLayout({
      version: 1, name: 'K', detailSeed: 'k', continents: [], regions: [region],
    })!;
    const geo = new RegionGeo(getStableHash('k'), { worldGenVersion: 2 }, l);
    let imWald = 0, wechsel = 0, gesamt = 0;
    let vorher: boolean | null = null;
    for (let z = -3000; z <= 3000; z += 750) {
      for (let x = -3000; x <= 3000; x += 15) {
        const wald = geo.getForestFactor(x, z) < 1.15;
        if (wald) imWald++;
        if (vorher !== null && wald !== vorher) wechsel++;
        vorher = wald;
        gesamt++;
      }
      vorher = null;
    }
    return { anteil: imWald / gesamt, mittel: (gesamt * 15) / Math.max(1, wechsel) };
  };
  const normal = laufweite();
  const grob = laufweite(0.35);
  check(
    'koernung: grössere Flächen bei kleinerem Wert',
    grob.mittel > normal.mittel * 1.8,
    `${normal.mittel.toFixed(0)} m → ${grob.mittel.toFixed(0)} m`
  );
  check(
    'koernung: Waldanteil bleibt (Struktur, nicht Menge)',
    Math.abs(grob.anteil - normal.anteil) < 0.08,
    `${(normal.anteil * 100).toFixed(0)} % → ${(grob.anteil * 100).toFixed(0)} %`
  );
  console.log(`  Laufweite im Wald: Vorgabe ${normal.mittel.toFixed(0)} m, Körnung 0.35 → ${grob.mittel.toFixed(0)} m`);
}

// ── 7. Der Abstand ist die harte Grenze ──────────────────────────────
// Gemessen an einem Nadelwald brachten die Dichtestufen 1.0 bis 4.0
// durchweg 45–47 Stämme je Zone: `bewuchsDichte` lief gegen den
// Mindestabstand. Erst `abstandFaktor` öffnet ihn — quadratisch, weil
// die belegte Fläche mit dem Quadrat des Radius geht.
//
// Zweite Prüfung im selben Block: Die GROSSEN Bäume müssen ankommen.
// Vor der Umstellung auf Schichten kam von ihnen kein einziger durch —
// die Setzlinge standen in FOLIAGE vorn und besetzten jeden Platz.
{
  const bestand = (abstand: number): { staemme: number; gross: number } => {
    const l = sanitizeWorldLayout({
      version: 1, name: 'A', detailSeed: 'a', continents: [],
      regions: [{
        id: 'w', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200, baseLevel: 0.3, forestDensity: 1.5, bewuchsDichte: 1.5,
        waldKoernung: 0.4, abstandFaktor: abstand, vegetation: [...NADELWALD_FLORA_NAMEN],
      }],
    })!;
    const m = bewuchs(l);
    let staemme = 0, gross = 0;
    for (const [name, k] of m) {
      if (!istBaum(name)) continue;
      staemme += k;
      if (hoehe(name) >= 18) gross += k;
    }
    return { staemme, gross };
  };
  const weit = bestand(1.0);
  const eng = bestand(0.5);
  check(
    'abstand: enger ergibt deutlich mehr Stämme',
    eng.staemme > weit.staemme * 1.8,
    `${weit.staemme} → ${eng.staemme}`
  );
  check(
    'abstand: grosse Bäume kommen durch',
    weit.gross > 0 && eng.gross > weit.gross,
    `über 18 m: ${weit.gross} → ${eng.gross}`
  );
  console.log(`  Stämme: Abstand 1.0 → ${weit.staemme} (${weit.gross} gross), 0.5 → ${eng.staemme} (${eng.gross} gross)`);
}

// ── 8. Nadelwald-Nester: Binnenvariation UND Terrainkopplung ─────────
// Der Mischwald soll nicht überall gleich sein, sondern geschlossene
// dunkle Partien enthalten. Dasselbe Feld hebt dort die Geländeamplitude
// — der dunkle Wald liegt im kupierten Gelände, nicht auf der Wiese.
{
  const bau = (nester: number): RegionGeo => {
    const l = sanitizeWorldLayout({
      version: 1, name: 'N', detailSeed: 'n', continents: [],
      regions: [{
        id: 'w', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 3000 },
        edgeFalloff: 200, baseLevel: 0.3, heightScale: 1, nester, nesterKoernung: 1,
      }],
    })!;
    return new RegionGeo(getStableHash('n'), { worldGenVersion: 2 }, l);
  };
  const ohne = bau(0);
  const mit = bau(0.8);

  // Nestfläche: genug, um beim Durchqueren mehrfach hineinzugeraten?
  let hoch = 0, gesamt = 0;
  const proben: Array<{ x: number; z: number; n: number }> = [];
  for (let z = -2000; z <= 2000; z += 100) {
    for (let x = -2000; x <= 2000; x += 100) {
      const n = mit.nestFaktor(x, z);
      gesamt++;
      if (n > 0.5) hoch++;
      proben.push({ x, z, n });
    }
  }
  const anteil = hoch / gesamt;
  check('nester: nennenswerte Fläche', anteil > 0.08 && anteil < 0.4, `${(anteil * 100).toFixed(0)} %`);
  check('nester: ohne Angabe wirkungslos', ohne.nestFaktor(0, 0) === 0);

  const rauheit = (g: RegionGeo, wenn: (n: number) => boolean): number => {
    let summe = 0, k = 0;
    for (const p of proben) {
      if (!wenn(p.n)) continue;
      const a2 = g.getHeight(p.x, p.z);
      summe += Math.abs(a2 - g.getHeight(p.x + 20, p.z)) + Math.abs(a2 - g.getHeight(p.x, p.z + 20));
      k += 2;
    }
    return k ? summe / k : 0;
  };
  const imNest = rauheit(mit, (n) => n > 0.5);
  const offen = rauheit(mit, (n) => n < 0.1);
  const vorher = rauheit(ohne, (n) => n > 0.5);
  check('terrain: im Nest bewegter', imNest > offen * 1.3, `${imNest.toFixed(2)} m gegen ${offen.toFixed(2)} m`);
  check('terrain: ausserhalb unverändert', Math.abs(offen - rauheit(ohne, (n) => n < 0.1)) < 0.2);
  console.log(`  Nester: ${(anteil * 100).toFixed(0)} % der Fläche | Geländerauheit ${vorher.toFixed(2)} → ${imNest.toFixed(2)} m im Nest, ${offen.toFixed(2)} m offen`);
}

// ── 9. Die anderen Biome der Welt ────────────────────────────────────
// Der Wächter gegen den Fehler, den Block A behoben hat: Die Biom-Maske
// der eigenen Flora griff VOR dem Kuratierungstor und liess nur Meadows
// durch. Vier Regionen der Welt tragen ein anderes Biom und wären
// lautlos kahl geblieben.
//
// Geprüft wird je Biom dasselbe Paar:
//   a) Es wächst überhaupt etwas (Anzahl > 0) — das ist die Maske.
//   b) Es wächst NUR aus der Liste des Bioms — das ist die Kuratierung.
//
// Die Fläche ist dieselbe Insel wie oben, nur mit anderem `biome`-Feld.
// Damit ist der Unterschied zwischen den Durchläufen ausschliesslich das
// Biom und die Liste, nicht das Gelände.
{
  const biome: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['blackforest', 'Nadelwald', NADELWALD_FLORA_NAMEN],
    ['swamp', 'Sumpf', SUMPF_FLORA_NAMEN],
    ['deepnorth', 'Hoher Norden', HOCHNORD_FLORA_NAMEN],
  ];
  for (const [biom, titel, liste] of biome) {
    const m = bewuchs(insel(liste, biom));
    const erlaubt = new Set(liste);
    const drin = summe(m, (n) => erlaubt.has(n));
    const fremd = summe(m, (n) => !erlaubt.has(n));
    const arten = [...m.keys()].filter((n) => erlaubt.has(n));
    check(`${biom}: Bewuchs entsteht (${titel})`, drin > 0, `= ${drin} Stück`);
    check(`${biom}: nichts ausserhalb der Liste`, fremd === 0, `= ${fremd} fremde`);
    // Eine Liste, von der nur zwei Arten ankommen, ist so gut wie kahl —
    // die Hälfte muss durchkommen, sonst stimmen die Streuzahlen nicht.
    check(
      `${biom}: die Liste kommt breit an`,
      arten.length >= Math.ceil(liste.length / 2),
      `${arten.length} von ${liste.length} Arten`
    );
    console.log(`  ${biom}: ${drin} Pflanzen, ${arten.length}/${liste.length} Arten`);
  }

  // Der Sumpf braucht seine Bäume — sie stehen in FOLIAGE HINTER den
  // niedrigeren Einträgen und müssen trotzdem Platz finden. Dasselbe
  // Muster wie beim Nadelwald in Abschnitt 7. Gefragt wird nach der
  // HÖHE und nicht nach `BirkeDicht[34]`: Welche Art der Sumpf trägt,
  // ist eine Frage der Kuratierung; dass er überhaupt Bäume trägt, ist
  // die Frage dieses Wächters.
  const sumpf = bewuchs(insel(SUMPF_FLORA_NAMEN, 'swamp'));
  check(
    'swamp: Bäume kommen durch',
    summe(sumpf, istBaum) > 0,
    `= ${summe(sumpf, istBaum)}`
  );
  // Und der Hohe Norden darf NICHT zuwachsen: Er ist über die Stückzahl
  // definiert, nicht über die Artenliste. Gemessen am Grasland auf
  // derselben Fläche muss er deutlich dünner sein.
  const hochnord = bewuchs(insel(HOCHNORD_FLORA_NAMEN, 'deepnorth'));
  const nHoch = summe(hochnord, () => true);
  const nGras = summe(mitFlora, () => true);
  check('deepnorth: karg gegenüber dem Grasland', nHoch < nGras / 3, `${nHoch} gegen ${nGras}`);
  console.log(`  Hoher Norden ${nHoch} gegen Grasland ${nGras} Pflanzen auf gleicher Fläche`);

  /*
    Die Aschewüste — und der einzige Ort, an dem der Store-Bestand etwas
    hinzufügt, wo vorher bewusst nichts stand.

    Die alte Antwort war LEER, und das war eine Entscheidung, kein
    Versäumnis: Der Altbestand kennt keinen Baum ohne Laub, und ein
    belaubter Baum auf Asche wäre falscher gewesen als gar keiner. Der
    Store bringt kahle Stämme mit (`vegetation-tree-*-2`), und damit
    ändert sich die Antwort — nicht der Grund.

    Beide Zustände bleiben deshalb geprüft, und der Test fragt die
    Umschaltung, statt einen der beiden Fälle zu bevorzugen: Ohne
    Store-Kuratierung MUSS die Liste leer und der Boden nackt sein; mit
    ihr MÜSSEN es Stämme sein und nichts als Stämme — kein Gras, kein
    Strauch, kein Laubdach auf der Asche.
  */
  const asche = bewuchs(insel(ASCHE_FLORA_NAMEN, 'ashlands'));
  const alles = summe(asche, () => true);
  if (STORE_FLORA_AKTIV && STORE_FLORA_BEREIT) {
    check('ashlands: kahle Stämme statt gar nichts', alles > 0, `= ${alles}`);
    check(
      'ashlands: nur Stämme, kein Unterwuchs',
      summe(asche, (n) => !istBaum(n)) === 0,
      [...asche.keys()].filter((n) => !istBaum(n)).join(', ')
    );
  } else {
    check('ashlands: Liste ist leer (Entwurf, kein Versäumnis)', ASCHE_FLORA_NAMEN.length === 0);
    check('ashlands: nackter Aschegrund', alles === 0, `= ${alles}`);
  }
}

// ── 10. Determinismus ────────────────────────────────────────────────
// Zwei Läufe mit demselben Seed müssen dasselbe ergeben, sonst wäre die
// Welt bei jedem Serverstart eine andere.
const nochmal = bewuchs(insel(GRASLAND_FLORA_NAMEN));
const alsText = (m: Map<string, number>): string =>
  [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([n, k]) => `${n}=${k}`).join(',');
check('determinismus: zweiter Lauf ist gleich', alsText(mitFlora) === alsText(nochmal));

console.log(`\nGestreut (kuratiert): ${eigenAnzahl} Pflanzen in ${artenMit.length} Arten`);
console.log(alsText(mitFlora).split(',').join('\n  '));

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== GRASLAND-FLORA: ALL PASSED ===');
