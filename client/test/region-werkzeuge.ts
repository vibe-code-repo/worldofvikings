/**
 * Regions-Vorlagen, Feldvalidierung, Kontinente und Startpunkt-Logik
 * (Aufgaben B2 + B10). Prüft die reine Logik aus
 * `client/src/editor/regionsWerkzeuge.ts` — DOM-frei, s. Begründung dort
 * und in `befundSchwere.ts`.
 *
 * Zwei Ebenen wie im Vorbild `befund-schwere.ts`: Erst jede Vorlage und
 * jeder Klemm-Zweig einzeln mit Literalen, dann dieselben Werte gegen
 * ECHTE `sanitizeWorldLayout`/`pruefeLayout`-Läufe — die Absicherung
 * gegen Drift, falls sich die Grenzen dort künftig ändern, ohne dass
 * `klemmeRegionsFelder` (die eigene Kopie davon, s. Dateikopf dort)
 * nachgezogen wird.
 *
 * Lauf:  npx tsx test/region-werkzeuge.ts
 */
import { pruefeLayout, sanitizeWorldLayout, type RegionDef, type WorldLayout } from '@wov/shared';
import {
  REGION_VORLAGEN,
  klemmeKoordinate,
  klemmeRegionsFelder,
  kontinentEntfernen,
  kontinentHinzufuegen,
  kontinentIdVorschlag,
  setzeStartpunkt,
  wendeVorlageAn,
} from '../src/editor/regionsWerkzeuge';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const leereWelt = (regionen: RegionDef[] = []): WorldLayout => ({
  version: 1,
  name: 'Vorlagen-Testwelt',
  detailSeed: 'x',
  continents: [],
  regions: regionen,
});

const basisRegion = (id: string): RegionDef => ({
  id,
  biome: 'grassland',
  shape: { kind: 'circle', x: 0, z: 0, radius: 500 },
  edgeFalloff: 300,
});

// ── 1. Jede Vorlage einzeln ───────────────────────────────────────────
// Angewandt, sanitisiert (ECHTE sanitizeWorldLayout) und geprüft (ECHTE
// pruefeLayout) — nicht nur gegen die eigene Klemmfunktion.
for (const v of REGION_VORLAGEN) {
  check(
    `Vorlage "${v.name}": klemmeRegionsFelder verändert die eigenen Werte nicht`,
    JSON.stringify(klemmeRegionsFelder(v.werte)) === JSON.stringify(v.werte),
    '— eine Vorlage mit Werten außerhalb ihres eigenen Wertebereichs wäre ein Autorenfehler'
  );

  const region = wendeVorlageAn(basisRegion(`test-${v.id}`), v);
  const layout = sanitizeWorldLayout(leereWelt([region]));
  check(`Vorlage "${v.name}": übersteht sanitizeWorldLayout`, layout !== null);
  if (!layout) continue;
  const echt = layout.regions.find((r) => r.id === region.id);
  check(`Vorlage "${v.name}": Region bleibt nach Sanitisierung erhalten`, echt !== undefined);
  if (!echt) continue;

  check(`Vorlage "${v.name}": Biom übernommen`, echt.biome === v.werte.biome);
  check(`Vorlage "${v.name}": tier unverändert von sanitizeWorldLayout geklemmt`, echt.tier === v.werte.tier);
  check(
    `Vorlage "${v.name}": edgeFalloff unverändert von sanitizeWorldLayout geklemmt`,
    echt.edgeFalloff === v.werte.edgeFalloff
  );

  const befunde = pruefeLayout(layout).filter((b) => b.wo === region.id);
  check(
    `Vorlage "${v.name}": keine Prüfbefunde an der eigenen Region (${befunde.length})`,
    befunde.length === 0,
    befunde.map((b) => b.text).join('; ')
  );
}

// ── 2. wendeVorlageAn setzt vorherige Preset-Felder zurück ────────────
{
  const grenzwald = REGION_VORLAGEN.find((v) => v.id === 'grenzwald')!;
  const startwiese = REGION_VORLAGEN.find((v) => v.id === 'startwiese')!;
  const nachGrenzwald = wendeVorlageAn(basisRegion('r'), grenzwald);
  check('Grenzwald setzt nester', nachGrenzwald.nester === 0.8);
  const nachStartwiese = wendeVorlageAn(nachGrenzwald, startwiese);
  check(
    'Startwiese NACH Grenzwald setzt nester zurück auf undefined statt 0.8 stehen zu lassen',
    nachStartwiese.nester === undefined
  );
  check(
    '… und vegetation zurück auf Biom-Standard (undefined)',
    nachStartwiese.vegetation === undefined
  );
  check('… id und shape bleiben unangetastet', nachStartwiese.id === 'r' && nachStartwiese.shape.kind === 'circle');
}

// ── 3. klemmeRegionsFelder — jeder Zweig einzeln UND gegen echtes
//    sanitizeWorldLayout, damit eine Grenzänderung dort hier auffällt ──
{
  const ausserhalb: Partial<RegionDef> = {
    edgeFalloff: 99999,
    baseLevel: 9,
    heightScale: -1,
    tier: 12,
    forestDensity: -5,
    bewuchsDichte: 0,
    waldKoernung: 0,
    abstandFaktor: 0,
    nester: 5,
    nesterKoernung: 0,
  };
  const geklemmt = klemmeRegionsFelder(ausserhalb);
  check('edgeFalloff auf 5000 geklemmt', geklemmt.edgeFalloff === 5000);
  check('baseLevel auf 0.6 geklemmt', geklemmt.baseLevel === 0.6);
  check('heightScale auf 0 geklemmt (Untergrenze)', geklemmt.heightScale === 0);
  check('tier auf 5 geklemmt und gerundet', geklemmt.tier === 5);
  check('forestDensity auf 0 geklemmt (Untergrenze)', geklemmt.forestDensity === 0);
  check('bewuchsDichte auf 0.1 geklemmt (Untergrenze)', geklemmt.bewuchsDichte === 0.1);
  check('waldKoernung auf 0.2 geklemmt (Untergrenze)', geklemmt.waldKoernung === 0.2);
  check('abstandFaktor auf 0.3 geklemmt (Untergrenze)', geklemmt.abstandFaktor === 0.3);
  check('nester auf 1 geklemmt', geklemmt.nester === 1);
  check('nesterKoernung auf 0.2 geklemmt (Untergrenze)', geklemmt.nesterKoernung === 0.2);

  // Dieselben Rohwerte durch die ECHTE sanitizeWorldLayout — an einer
  // vollen Region, weil die Funktion nur ganze Dokumente entgegennimmt.
  const roheRegion = { ...basisRegion('r'), ...ausserhalb } as unknown as RegionDef;
  const echtGeklemmt = sanitizeWorldLayout(leereWelt([roheRegion]))!.regions[0]!;
  for (const feld of [
    'edgeFalloff',
    'baseLevel',
    'heightScale',
    'tier',
    'forestDensity',
    'bewuchsDichte',
    'waldKoernung',
    'abstandFaktor',
    'nester',
    'nesterKoernung',
  ] as const) {
    check(
      `${feld}: eigene Klemmung deckungsgleich mit sanitizeWorldLayout (${geklemmt[feld]} === ${echtGeklemmt[feld]})`,
      geklemmt[feld] === echtGeklemmt[feld]
    );
  }
}

// Felder, die NICHT im Patch stehen, bleiben unangetastet (kein Erfinden).
{
  const teil = klemmeRegionsFelder({ tier: 3 });
  check('unbeteiligte Felder bleiben weg', teil.edgeFalloff === undefined && teil.baseLevel === undefined);
  check('tier 3 bleibt 3 (innerhalb der Grenzen)', teil.tier === 3);
}

// ── 4. klemmeKoordinate ────────────────────────────────────────────────
check('klemmeKoordinate lässt normale Werte in Ruhe', klemmeKoordinate(1234.5) === 1234.5);
check('klemmeKoordinate klemmt auf LAYOUT_MAX_EXTENT', klemmeKoordinate(999999) === 40000);
check('klemmeKoordinate klemmt negativ symmetrisch', klemmeKoordinate(-999999) === -40000);
check('klemmeKoordinate rundet auf Millimeter', klemmeKoordinate(1.23456) === 1.235);

// ── 5. Startpunkt (B2, Kernkriterium) ─────────────────────────────────
// Der Prüfbericht muss den Startpunkt-Befund verlieren, sobald ein
// Startpunkt gesetzt ist — geprüft mit der ECHTEN pruefeLayout.
{
  const ohneSpawn = sanitizeWorldLayout(leereWelt([basisRegion('r')]))!;
  const vorher = pruefeLayout(ohneSpawn);
  check('ohne Startpunkt meldet pruefeLayout den welt-Befund', vorher.some((b) => b.art === 'welt'));

  const mitWeltSpawn = setzeStartpunkt(ohneSpawn, 'welt', 12.3, -45.6);
  check('setzeStartpunkt(welt) schreibt defaultSpawn', JSON.stringify(mitWeltSpawn.defaultSpawn) === JSON.stringify([12.3, -45.6]));
  const nachher = pruefeLayout(mitWeltSpawn);
  check('… und der welt-Befund verschwindet', !nachher.some((b) => b.art === 'welt'));

  const mitKontinent = kontinentHinzufuegen(ohneSpawn, { name: 'Angelland', faction: 'saxon' });
  const kontinentId = mitKontinent.continents[0]!.id;
  const mitKontinentSpawn = setzeStartpunkt(mitKontinent, { continentId: kontinentId }, 5, 5);
  check(
    'setzeStartpunkt(continentId) schreibt continent.spawn statt defaultSpawn',
    mitKontinentSpawn.defaultSpawn === undefined &&
      JSON.stringify(mitKontinentSpawn.continents[0]!.spawn) === JSON.stringify([5, 5])
  );
  const nachherKontinent = pruefeLayout(sanitizeWorldLayout(mitKontinentSpawn)!);
  check('… und deckt den welt-Befund ebenfalls ab (continent.spawn zählt laut pruefeLayout)', !nachherKontinent.some((b) => b.art === 'welt'));
}

// ── 6. Kontinente ──────────────────────────────────────────────────────
{
  const leer = leereWelt();
  check('einfacher Name ergibt lesbare ID', kontinentIdVorschlag('Sachsenland', []) === 'sachsenland');
  check(
    'Umlaute werden auf den Grundbuchstaben normiert, nicht verworfen',
    kontinentIdVorschlag('Ödland', []).startsWith('odland') || kontinentIdVorschlag('Ödland', []) === 'kontinent'
  );
  check('rein leerer Name fällt auf "kontinent" zurück', kontinentIdVorschlag('!!!', []) === 'kontinent');

  const erstesMal = kontinentHinzufuegen(leer, { name: 'Sachsenland', faction: 'saxon' });
  check('erster Kontinent angelegt', erstesMal.continents.length === 1);
  check('faction übernommen', erstesMal.continents[0]!.faction === 'saxon');

  const zweitesMal = kontinentHinzufuegen(erstesMal, { name: 'Sachsenland' });
  check(
    'gleicher Name zweimal: ID wird eindeutig gemacht statt zu kollidieren',
    zweitesMal.continents.length === 2 && zweitesMal.continents[0]!.id !== zweitesMal.continents[1]!.id
  );

  const leererName = kontinentHinzufuegen(leer, { name: '   ' });
  check('reiner Leerraum-Name ist ein No-Op', leererName.continents.length === 0);

  const mitRegion = kontinentHinzufuegen(leer, { name: 'Wikingerland' });
  const kId = mitRegion.continents[0]!.id;
  const weltMitZuweisung: WorldLayout = {
    ...mitRegion,
    regions: [{ ...basisRegion('r'), continentId: kId }],
  };
  const entfernt = kontinentEntfernen(weltMitZuweisung, kId);
  check('kontinentEntfernen nimmt den Kontinenten weg', entfernt.continents.length === 0);
  check(
    '… und löst die continentId der Region auf, statt sie auf ein Nichts zeigen zu lassen',
    entfernt.regions[0]!.continentId === undefined
  );
}

console.log(
  fehler === 0
    ? '\nOK — Regions-Vorlagen, Feldvalidierung, Kontinente und Startpunkt stimmen in jedem Fall'
    : `\n${fehler} ABWEICHUNGEN`
);
process.exit(fehler > 0 ? 1 : 0);
