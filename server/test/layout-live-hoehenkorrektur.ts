/**
 * K5.0 / Karte T1/N1: `heightDeltas` (Handkorrektur der Geländehöhe) ist eine
 * "geo"-Änderung wie Regionen/Wasser/Sockel — 202, kein Live-Übernehmen,
 * Neustart nötig.
 *
 *  1) `geoAenderung` (reine Funktion, kein Server): Klassifizierung, plus
 *     N1-Info-Punkt "delta 0 löst KEINEN Neustart aus" (normalisiert vor dem
 *     Vergleich).
 *  2) B8 (echter Server, `createWovServer`): eine roh geschriebene Datei mit
 *     EINEM ungültigen heightDeltas-Punkt UND einer echten Platzierungs-
 *     änderung wird GANZ zurückgehalten (Quittung `verworfen`), nicht "die
 *     Platzierung angewendet, die Korrektur still verschwunden" — dieselbe
 *     Regel wie bei geklemmten Platzierungsfeldern.
 *
 *   npx tsx test/layout-live-hoehenkorrektur.ts   (aus server/)
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { quittungLesen, quittungsDatei, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { geoAenderung } from '../src/world/layoutLive.js';
import { createWovServer } from '../src/WovServer.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

function basis(extra: Record<string, unknown> = {}): WorldLayout {
  return {
    version: 1,
    name: 'x',
    detailSeed: 'geo-hoehenkorrektur-test',
    continents: [],
    regions: [{ id: 'r', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 500 }, edgeFalloff: 100 }],
    ...extra,
  } as unknown as WorldLayout;
}

// ── 1) geoAenderung: Klassifizierung + Delta-0-Normalisierung ──────────
{
  const alt = basis();
  const neu = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10', d: '50' }] });
  check('heightDeltas dazu (vorher gar keins): als geo eingestuft (gelaende)', geoAenderung(alt, neu).includes('gelaende'), JSON.stringify(geoAenderung(alt, neu)));
}
{
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10', d: '50' }] });
  const neu = basis({ heightDeltas: [] });
  check('heightDeltas entfernt: als geo eingestuft', geoAenderung(alt, neu).includes('gelaende'));
}
{
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10', d: '50' }] });
  const neu = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10', d: '60' }] });
  check('heightDeltas geändert (anderes Delta am selben Punkt): als geo eingestuft', geoAenderung(alt, neu).includes('gelaende'));
}
{
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10', d: '50' }] });
  const neu = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '11', d: '50' }] });
  check('heightDeltas geändert (anderer Rasterpunkt): als geo eingestuft', geoAenderung(alt, neu).includes('gelaende'));
}
{
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10', d: '50' }] });
  const neu = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10', d: '50' }] });
  check('heightDeltas unverändert: NICHT als geo eingestuft', !geoAenderung(alt, neu).includes('gelaende'), JSON.stringify(geoAenderung(alt, neu)));
}
{
  const alt = basis();
  const neu = basis();
  check('kein heightDeltas auf beiden Seiten: keine geo-Änderung', geoAenderung(alt, neu).length === 0);
  const neuMitPlatzierung = basis({ placements: [{ id: 'p1', prefab: 'Kiste', x: 1, z: 1 }] });
  check('eine ANDERE Änderung bleibt unbeeinflusst (kein Platzierungs-Rauschen durch heightDeltas)', geoAenderung(alt, neuMitPlatzierung).length === 0);
}
{
  // N1 Info-Punkt: `delta: 0` (gültig, aber wirkungslos) darf ALLEIN keinen
  // Neustart auslösen. Rot auf T1 (111dbcd): dort verglich `geoAenderung`
  // die rohen Felder ohne Normalisierung, ein neu hinzugefuegter `delta:0`-
  // Punkt haette dort "gelaende" ausgeloest.
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10', d: '50' }] });
  const neuMitNullpunkt = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '10,20', d: '50,0' }] });
  check(
    'ein zusätzlicher delta:0-Punkt löst KEINEN Neustart aus (N1 Info-Punkt, normalisiert)',
    !geoAenderung(alt, neuMitNullpunkt).includes('gelaende'),
    JSON.stringify(geoAenderung(alt, neuMitNullpunkt))
  );
  const neuOhneWirkung = basis({ heightDeltas: [{ zx: 0, zz: 0, i: '20', d: '0' }] }); // nur ein wirkungsloser Punkt, ganz anderer Inhalt als alt
  check(
    'zwei Dokumente, die sich NUR in delta:0-Punkten unterscheiden, gelten als gleich',
    !geoAenderung(basis({ heightDeltas: [{ zx: 0, zz: 0, i: '30', d: '0' }] }), neuOhneWirkung).includes('gelaende')
  );
}

// ── 2) B8: eine rohe Datei mit ungueltigem heightDeltas + echter Platzierungs-aenderung ──
// Rot auf T1 (111dbcd): dort wurde die Platzierung angewendet (Quittung
// "angewendet"), waehrend der ungueltige Korrekturpunkt lautlos verschwand.
async function b8(): Promise<void> {
  const WURZEL = mkdtempSync(join(tmpdir(), 'wov-layout-live-hoehenkorrektur-'));
  const WELTEN = join(WURZEL, 'worlds');
  mkdirSync(WELTEN, { recursive: true });
  const LAYOUT = join(WURZEL, 'layout.json');
  const INSTANZ = 'b8hoehe';
  const QUITTUNG = quittungsDatei(WELTEN, INSTANZ);
  const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  async function warteAuf(bed: () => boolean, ms = 8000): Promise<boolean> {
    const t0 = Date.now();
    while (!bed()) {
      if (Date.now() - t0 > ms) return false;
      await warte(10);
    }
    return true;
  }
  function dokument(placements: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      name: 'B8-Hoehenkorrektur',
      detailSeed: 'b8hoehe',
      continents: [],
      regions: [{ id: 'probe', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
      defaultSpawn: [0, 0],
      placements,
      ...extra,
    };
  }
  function schreibe(d: unknown): void {
    const temp = `${LAYOUT}.probe.tmp`;
    writeFileSync(temp, JSON.stringify(d));
    renameSync(temp, LAYOUT);
  }
  const T0 = [{ id: 't1', prefab: 'Beech1', x: 30, z: 20 }];
  schreibe(dokument(T0));

  const orig = { log: console.log, warn: console.warn };
  console.log = (): void => undefined;
  console.warn = (): void => undefined;
  const server = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: INSTANZ,
    worldSeed: INSTANZ,
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: WELTEN,
    kontenDir: join(WURZEL, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: LAYOUT,
    saveIntervalMs: 3600_000,
  });
  try {
    server.start();
    await warteAuf(() => quittungLesen(QUITTUNG) !== null);
    const layoutZdos = () => server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER));
    console.log = orig.log;
    check('B8 set-up: 1 Baum nach dem Boot', layoutZdos().length === 1, `${layoutZdos().length}`);
    console.log = (): void => undefined;

    // Rohe Datei: EINE neue, echte Platzierung UND ein ungueltiger heightDeltas-Punkt (delta 1.5, keine Ganzzahl).
    schreibe(
      dokument([...T0, { id: 't2', prefab: 'Beech1', x: 60, z: 20 }], {
        heightDeltas: [{ zx: 0, zz: 0, i: '9', d: '1.5' }],
      })
    );
    let q: Quittung | null = null;
    await warteAuf(() => {
      q = quittungLesen(QUITTUNG);
      return q?.grund !== undefined && q?.zeit !== undefined && q !== null;
    });
    // Auf den NEUEN Stand warten (Hash-Wechsel), nicht nur "irgendeine Quittung".
    const hashVorher = q?.hash;
    await warteAuf(() => {
      const j = quittungLesen(QUITTUNG);
      if (j && j.hash !== hashVorher) {
        q = j;
        return true;
      }
      return false;
    });
    console.log = orig.log;
    check(
      'B8: Quittung "verworfen" (nicht "angewendet") — die ungueltige Korrektur haelt den GANZEN Vorgang zurueck',
      q?.ergebnis === 'nicht-angewendet' && q?.grund === 'verworfen',
      `${q?.ergebnis} ${q?.grund}: ${q?.detail}`
    );
    check('B8: die Quittung nennt die betroffene Zone (0,0)', (q?.detail ?? '').includes('0,0'), q?.detail ?? '');
    check('B8: die neue Platzierung t2 wurde NICHT angewendet (ganz oder gar nicht)', !layoutZdos().some((z) => z.getString(LAYOUT_ID_MEMBER) === 't2'), `${layoutZdos().length} ZDOs`);
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    server.stop();
    await warte(300);
    if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
  }
}
await b8();

console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
