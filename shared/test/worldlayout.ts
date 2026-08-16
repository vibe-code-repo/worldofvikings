/**
 * Phase-1-Tests des Kartengenerierungs-Umbaus: sanitizeWorldLayout und
 * RegionField (Distanz-Korrektheit, Z-Ordnung, Stetigkeit, Ozean-Default).
 *
 *   npx tsx test/worldlayout.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RegionField,
  ROUTE_MAX_PAUSE,
  pruefeLayout,
  sanitizeWorldLayout,
  signedDistance,
  wegpunktPause,
  type WorldLayout,
} from '../src/worldlayout/index.js';
import { NPC_NAME_MAX, haltungZwischen, loeseNpcAuf, questZeichen } from '../src/npc.js';
import { GRASLAND_FLORA_NAMEN } from '../src/flora.js';
import { FOLIAGE } from '../src/vegetation.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── sanitize ─────────────────────────────────────────────────────────
check('sanitize: Müll → null', sanitizeWorldLayout(null) === null && sanitizeWorldLayout(42) === null);
check('sanitize: falsche Version → null', sanitizeWorldLayout({ version: 2, name: 'x' }) === null);

const roh = {
  version: 1,
  name: 'Testwelt',
  detailSeed: 'seed1',
  continents: [
    { id: 'wik', name: 'Wikingerland', faction: 'viking' },
    { id: 'wik', name: 'Duplikat', faction: 'viking' }, // Duplikat → verworfen
    { id: 'BAD ID', name: 'kaputt' }, // ungültige id → verworfen
  ],
  regions: [
    {
      id: 'insel',
      biome: 'meadows',
      shape: { kind: 'circle', x: 0, z: 0, radius: 2000 },
      edgeFalloff: 99999, // → geklemmt auf 5000
      vegetation: ['Beech1', 'Beech1', ''],
    },
    { id: 'kaputt', biome: 'lava', shape: { kind: 'circle', x: 0, z: 0, radius: 100 } }, // Biom unbekannt
    { id: 'flach', biome: 'plains', shape: { kind: 'polygon', points: [[0, 0], [1, 1], [2, 2]] } }, // Fläche ~0
  ],
};
const layout = sanitizeWorldLayout(roh);
check('sanitize: Dokument angenommen', layout !== null);
check('sanitize: Kontinent-Duplikate/Bad-IDs verworfen', layout!.continents.length === 1);
check('sanitize: ungültige Regionen verworfen', layout!.regions.length === 1, `= ${layout!.regions.length}`);
check('sanitize: edgeFalloff geklemmt', layout!.regions[0]!.edgeFalloff === 5000);
check(
  'sanitize: Vegetation dedupliziert/bereinigt',
  JSON.stringify(layout!.regions[0]!.vegetation) === JSON.stringify(['Beech1'])
);

// ── Routen (sanitize) ────────────────────────────────────────────────
const mitRouten = sanitizeWorldLayout({
  version: 1,
  name: 'Routenwelt',
  detailSeed: 'r',
  continents: [],
  regions: [],
  routes: [
    { id: 'runde', points: [[0, 0], [10, 0], [10, 10]], mode: 'loop' },
    // Modus unbekannt → 'loop'; Tempo über der Grenze → geklemmt.
    { id: 'pendel', points: [[0, 0], [5, 0]], mode: 'schleichen', speed: 99 },
    { id: 'posten', points: [[3, 4]], mode: 'pingpong', speed: 0 },
    { id: 'runde', points: [[0, 0], [1, 1]], mode: 'loop' }, // Duplikat → verworfen
    { id: 'BAD ID', points: [[0, 0], [1, 1]], mode: 'loop' }, // ID ungültig
    { id: 'leer', points: [], mode: 'loop' }, // ohne Wegpunkt → verworfen
    { id: 'kaputt', points: [[0, 0], [1, 'x']], mode: 'loop' }, // Koordinate ungültig
    { id: 'weit', points: [[0, 0], [1e9, 0]], mode: 'loop' }, // außerhalb der Bbox
  ],
  placements: [
    { prefab: 'Voelva', x: 0, z: 0, route: 'runde' },
    { prefab: 'Voelva', x: 5, z: 0, route: 'GIBT ES NICHT' }, // ungültige ID → weg
    { prefab: 'Voelva', x: 9, z: 0 },
  ],
});
const routen = mitRouten!.routes ?? [];
check('routen: nur gültige übernommen', routen.length === 3, `= ${routen.map((r) => r.id).join(',')}`);
check('routen: Reihenfolge/IDs', routen.map((r) => r.id).join(',') === 'runde,pendel,posten');
check('routen: unbekannter Modus → loop', routen[1]!.mode === 'loop');
check('routen: Tempo geklemmt (99 → 10)', routen[1]!.speed === 10, `= ${routen[1]!.speed}`);
check('routen: Tempo-Untergrenze (0 → 0.2)', routen[2]!.speed === 0.2, `= ${routen[2]!.speed}`);
check('routen: pingpong bleibt', routen[2]!.mode === 'pingpong');
check('routen: Ein-Punkt-Route erlaubt (Standposten)', routen[2]!.points.length === 1);
check('routen: ohne speed bleibt das Feld leer', routen[0]!.speed === undefined);
const platzierungen = mitRouten!.placements ?? [];
check('routen: gültige Referenz bleibt', platzierungen[0]!.route === 'runde');
check('routen: unsauber geschriebene Referenz verworfen', platzierungen[1]!.route === undefined);
check('routen: Platzierung ohne Route unberührt', platzierungen[2]!.route === undefined);
// Referenzprüfung ist INHALTLICH (pruefeLayout), nicht syntaktisch:
const befunde = pruefeLayout(
  sanitizeWorldLayout({
    version: 1,
    name: 'Tippfehler',
    detailSeed: 'r',
    continents: [],
    regions: [],
    routes: [{ id: 'runde', points: [[0, 0], [10, 0]], mode: 'loop' }],
    placements: [{ prefab: 'Voelva', x: 0, z: 0, route: 'rundee' }],
  })!
);
check(
  'routen: pruefeLayout meldet unbekannte Route',
  befunde.some((b) => b.art === 'route' && b.text.includes('rundee'))
);
check(
  'routen: keine Falschmeldung bei gültiger Referenz',
  !pruefeLayout(mitRouten!).some((b) => b.art === 'route' && b.text.includes('unbekannte Route'))
);
// Routen ohne Einträge tauchen NICHT im Dokument auf (wie rivers/lakes).
check('routen: leeres Feld wird weggelassen', layout!.routes === undefined);

// ── Pausen an Wegpunkten ([x, z, pause], abwaertskompatibel) ─────────
const mitPausen = sanitizeWorldLayout({
  version: 1,
  name: 'Pausenwelt',
  detailSeed: 'p',
  continents: [],
  regions: [],
  routes: [
    {
      id: 'wache',
      mode: 'loop',
      points: [
        [0, 0], // alte Form: laeuft durch
        [10, 0, 5], // neue Form: 5 s Pause
        [20, 0, -3], // negativ → keine Pause
        [30, 0, 'lang'], // Unsinn → keine Pause
        [40, 0, 9999], // ueber der Grenze → geklemmt
        [50, 0, 0], // ausdrueckliche Null → wieder [x, z]
      ],
    },
    // Vier Elemente sind kein Wegpunkt — die ganze Route faellt weg.
    { id: 'zuviel', mode: 'loop', points: [[0, 0, 1, 2]] },
  ],
});
const pausenRoute = (mitPausen!.routes ?? [])[0]!;
check('pausen: nur die gueltige Route bleibt', (mitPausen!.routes ?? []).length === 1);
check('pausen: [x, z] bleibt zweielementig', pausenRoute.points[0]!.length === 2);
check('pausen: [x, z, pause] uebernommen', wegpunktPause(pausenRoute.points[1]!) === 5);
check('pausen: negative Pause → 0', pausenRoute.points[2]!.length === 2);
check('pausen: unsinnige Pause → 0', pausenRoute.points[3]!.length === 2);
check(
  'pausen: geklemmt auf ROUTE_MAX_PAUSE',
  wegpunktPause(pausenRoute.points[4]!) === ROUTE_MAX_PAUSE,
  `= ${wegpunktPause(pausenRoute.points[4]!)}`
);
check('pausen: ausdrueckliche 0 wird wieder [x, z]', pausenRoute.points[5]!.length === 2);
// Stabiler Round-Trip: Ein sanitisiertes Dokument darf sich beim zweiten
// Durchlauf nicht mehr aendern — sonst driftete jede Speicherung.
check(
  'pausen: Round-Trip ist stabil',
  JSON.stringify(sanitizeWorldLayout(JSON.parse(JSON.stringify(mitPausen)))) ===
    JSON.stringify(mitPausen)
);
// Eine Route ohne jede Pause muss BYTEGLEICH bleiben (Bestandsdokumente).
// Feldreihenfolge wie in sanitize.ts — JSON.stringify vergleicht sie mit.
const altbestand = { id: 'alt', points: [[0, 0], [10, 0]], mode: 'loop' as const, speed: 1.5 };
check(
  'pausen: alte Route bleibt unveraendert',
  JSON.stringify(
    sanitizeWorldLayout({
      version: 1,
      name: 'Alt',
      detailSeed: 'a',
      continents: [],
      regions: [],
      routes: [altbestand],
    })!.routes
  ) === JSON.stringify([altbestand])
);

// ── NPC-Angaben an der Platzierung ───────────────────────────────────
const mitNpc = sanitizeWorldLayout({
  version: 1,
  name: 'NPC-Welt',
  detailSeed: 'n',
  continents: [],
  regions: [],
  placements: [
    // Alles gültig — kommt unverändert durch.
    { prefab: 'Voelva', x: 0, z: 0, npc: { name: 'Sigrun', rolle: 'quest', fraktion: 'wikinger', stufe: 12, quest: 'verfuegbar' } },
    // Unbekannte Werte werden WEGGELASSEN (nicht auf einen Standard
    // gezwungen) — dann greift die Prefab-Vorgabe.
    { prefab: 'Surtr', x: 10, z: 0, npc: { rolle: 'buergermeister', fraktion: 'elfen', quest: 'vielleicht', stufe: 7 } },
    // Stufe wird geklemmt, leerer Name fällt weg.
    { prefab: 'Voelva', x: 20, z: 0, npc: { name: '   ', stufe: 999 } },
    { prefab: 'Voelva', x: 30, z: 0, npc: { stufe: -5 } },
    // Nur Unsinn drin → gar kein npc-Feld.
    { prefab: 'Voelva', x: 40, z: 0, npc: { rolle: 'quatsch' } },
    { prefab: 'Voelva', x: 50, z: 0, npc: 'kein Objekt' },
    // Überlanger Name wird gekürzt statt die Platzierung zu verwerfen.
    { prefab: 'Voelva', x: 60, z: 0, npc: { name: 'x'.repeat(200) } },
    // Ohne npc bleibt es dabei — der Round-Trip-Fall des Bestands.
    { prefab: 'Beech1', x: 70, z: 0 },
  ],
})!.placements!;
check('npc: vollständige Angabe bleibt', JSON.stringify(mitNpc[0]!.npc) === JSON.stringify({ name: 'Sigrun', rolle: 'quest', fraktion: 'wikinger', stufe: 12, quest: 'verfuegbar' }));
check('npc: unbekannte Rolle/Fraktion/Quest verworfen', JSON.stringify(mitNpc[1]!.npc) === JSON.stringify({ stufe: 7 }), JSON.stringify(mitNpc[1]!.npc));
check('npc: Stufe nach oben geklemmt', mitNpc[2]!.npc?.stufe === 99);
check('npc: leerer Name weggelassen', mitNpc[2]!.npc?.name === undefined);
check('npc: Stufe nach unten geklemmt', mitNpc[3]!.npc?.stufe === 1);
check('npc: nur Unsinn → kein Feld', mitNpc[4]!.npc === undefined);
check('npc: npc ist kein Objekt → kein Feld', mitNpc[5]!.npc === undefined);
check('npc: langer Name gekürzt', mitNpc[6]!.npc?.name?.length === NPC_NAME_MAX);
check('npc: Platzierung ohne npc bekommt keins', mitNpc[7]!.npc === undefined);
check(
  'npc: Round-Trip ist stabil',
  JSON.stringify(sanitizeWorldLayout(JSON.parse(JSON.stringify({ version: 1, name: 'NPC-Welt', detailSeed: 'n', continents: [], regions: [], placements: mitNpc }))))
    === JSON.stringify({ version: 1, name: 'NPC-Welt', detailSeed: 'n', continents: [], regions: [], placements: mitNpc })
);

// ── Auflösung Vorgabe + Platzierung ──────────────────────────────────
check('npc: kein NPC-Prefab → null', loeseNpcAuf('Beech1') === null);
const surtr = loeseNpcAuf('Surtr')!;
check('npc: Surtr-Vorgabe', surtr.rolle === 'monster' && surtr.fraktion === 'muspel');
const voelva = loeseNpcAuf('Voelva')!;
check('npc: Völva-Vorgabe', voelva.rolle === 'quest' && voelva.fraktion === 'wikinger');
check('npc: Vorgabe-Quest ist "keine"', voelva.quest === 'keine' && questZeichen(voelva) === null);
const eigen = loeseNpcAuf('Voelva', { name: 'Sigrun', stufe: 12, quest: 'verfuegbar' })!;
check('npc: Platzierung schlägt Vorgabe', eigen.name === 'Sigrun' && eigen.stufe === 12);
check('npc: Ungesetztes erbt die Vorgabe', eigen.fraktion === 'wikinger' && eigen.rolle === 'quest');
check('npc: Quest-Zeichen aus dem Zustand', questZeichen(eigen) === '?');
check('npc: fertige Quest zeigt "!"', questZeichen(loeseNpcAuf('Voelva', { quest: 'fertig' })!) === '!');
check(
  'npc: Monster zeigt nie ein Quest-Zeichen',
  questZeichen(loeseNpcAuf('Surtr', { quest: 'verfuegbar' })!) === null
);
check(
  'npc: npc-Block an einem Baum macht ihn zur Figur',
  loeseNpcAuf('Beech1', { name: 'Sprechende Buche' })?.rolle === 'zivil'
);
check('npc: Haltung folgt den Fraktionen', haltungZwischen('muspel', 'wikinger') === 'feindlich');

// Bestandsdokument der echten Welt: Es MUSS bytegleich durch den
// Sanitizer gehen — sonst schriebe jeder Speichervorgang des Editors 158
// Platzierungen um. Die Datei ist die Welt des Nutzers, nicht Testdaten.
// Beide Weltdokumente, nicht nur eines: dev.json und live.json sind
// getrennte Autorenstaende, und der Editor schreibt in beide.
// KEIN stilles Ueberspringen mehr — vorher war der Test in existsSync
// gekapselt und waere nach dem Umzug nach welten/ fuer immer gruen
// geblieben, ohne noch irgendetwas zu pruefen.
for (const instanz of ['dev', 'live'] as const) {
  const datei = fileURLToPath(
    new URL(`../../server/data/welten/${instanz}.json`, import.meta.url)
  );
  check(`npc: welten/${instanz}.json existiert`, existsSync(datei));
  if (!existsSync(datei)) continue;
  const roh = readFileSync(datei, 'utf-8');
  const wieder = JSON.stringify(sanitizeWorldLayout(JSON.parse(roh)), null, 2);
  check(`npc: welten/${instanz}.json bleibt bytegleich`, wieder === roh.trimEnd());
}

// ── signedDistance ───────────────────────────────────────────────────
const quadrat = {
  kind: 'polygon' as const,
  points: [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ] as [number, number][],
};
check('sd: Quadrat-Mitte = +100', Math.abs(signedDistance(quadrat, 0, 0) - 100) < 1e-9);
check('sd: Quadrat außen = −50', Math.abs(signedDistance(quadrat, 150, 0) + 50) < 1e-9);
check('sd: Kreis analytisch', Math.abs(signedDistance({ kind: 'circle', x: 10, z: 0, radius: 30 }, 10, 20) - 10) < 1e-9);

// ── RegionField ──────────────────────────────────────────────────────
const welt: WorldLayout = sanitizeWorldLayout({
  version: 1,
  name: 'Zwei Kontinente',
  detailSeed: 's',
  continents: [],
  regions: [
    { id: 'wiese', biome: 'meadows', shape: { kind: 'circle', x: 0, z: 0, radius: 3000 }, edgeFalloff: 300 },
    // Overlay MITTEN auf der Wiese — Z-Ordnung muss gewinnen:
    { id: 'berg', biome: 'mountain', shape: { kind: 'circle', x: 0, z: 0, radius: 800 }, edgeFalloff: 200 },
    // Zweiter Kontinent weit im Osten:
    { id: 'ost', biome: 'plains', shape: { kind: 'circle', x: 20000, z: 0, radius: 2500 }, edgeFalloff: 300 },
  ],
})!;
const feld = new RegionField(welt);

check('feld: Chunks kompiliert', feld.chunkCount > 0, `= ${feld.chunkCount}`);
// Nur ~Umgebung der Regionen kompiliert, nicht die Riesen-Bbox dazwischen:
// Kontinent1 ~ (7km)² + Berg + Kontinent2 ~ (6km)² ⇒ deutlich unter 200 Chunks.
check('feld: leere See kostet nichts', feld.chunkCount < 200, `= ${feld.chunkCount}`);

const mitte = feld.sample(0, 0);
check('feld: Overlay gewinnt per Z-Ordnung', mitte.regionA?.id === 'berg', `= ${mitte.regionA?.id}`);
check('feld: Untergrund als Zweitplatzierter', mitte.regionB?.id === 'wiese', `= ${mitte.regionB?.id}`);

const rand = feld.sample(2000, 0); // in der Wiese, außerhalb des Bergs
check('feld: außerhalb des Overlays gilt der Untergrund', rand.regionA?.id === 'wiese');
check('feld: Berg dort außen (dist < 0)', rand.regionB?.id !== 'berg' || rand.distB < 0);

const see = feld.sample(10000, 0); // zwischen den Kontinenten
check('feld: offene See → keine Region', see.regionA === null);

const ost = feld.sample(20000, 100);
check('feld: zweiter Kontinent gefunden', ost.regionA?.id === 'ost' && ost.distA > 0);

// Stetigkeit: distA entlang einer Küstenquerung darf nie schneller wachsen
// als die Schrittweite (Distanzfelder sind 1-Lipschitz). Gilt nur solange
// eine Region in Reichweite ist — dahinter endet das Feld VERTRAGSGEMÄSS
// (offene See), dort muss die Höhe längst auf Ozeanboden sein (s. unten).
let stetig = true;
let vorher: number | null = null;
for (let x = 2500; x <= 3500; x += 4) {
  const s = feld.sample(x, 0);
  if (!s.regionA) break;
  if (vorher !== null && Math.abs(s.distA - vorher) > 4 + 1e-6) {
    stetig = false;
    console.error(`  Sprung bei x=${x}: ${vorher} → ${s.distA}`);
    break;
  }
  vorher = s.distA;
}
check('feld: Distanz 1-Lipschitz über die Küste', stetig);

// Übergangs-Vertrag Feldende ↔ offene See: Wo das Feld noch antwortet, aber
// die Region weiter weg ist als ihr edgeFalloff, gilt der Punkt als voller
// Ozean — identisch zur Antwort "keine Region". RegionGeo darf sich darauf
// verlassen, dass am Feldrand kein Höhensprung entsteht.
let vertrag = true;
for (let x = 2500; x <= 4000; x += 8) {
  const s = feld.sample(x, 0);
  if (!s.regionA) continue;
  const wieOzean = s.distA <= -s.regionA.edgeFalloff;
  const nochLand = s.distA > -s.regionA.edgeFalloff;
  if (!wieOzean && !nochLand) vertrag = false;
  // Feldende erst NACH dem Falloff: solange Land-Anteil möglich ist, muss
  // das Feld antworten.
  if (nochLand && x > 3000 + 300) {
    vertrag = false;
    console.error(`  Land-Anteil außerhalb des Falloffs bei x=${x} (dist ${s.distA})`);
  }
}
check('feld: Feldende liegt jenseits des Falloffs', vertrag);

// ── Bewuchs je Region: die drei Zustaende ────────────────────────────
// Sie unterscheiden sich NUR im Inhalt von RegionDef.vegetation, und der
// stillste Fall ist der wichtigste: Ein leeres Array heisst "gar nichts"
// und muss die Bereinigung ueberleben. Faellt es auf `undefined` zurueck,
// bekaeme die Insel wieder die volle Biom-Tabelle — der Unterschied
// zwischen einer kahlen Wiese und einem Wald.
{
  const bau = (vegetation?: unknown): Record<string, unknown> => ({
    version: 1,
    name: 'Bewuchs',
    regions: [
      {
        id: 'insel',
        biome: 'grassland',
        shape: { kind: 'circle', x: 0, z: 0, radius: 500 },
        edgeFalloff: 300,
        ...(vegetation === undefined ? {} : { vegetation }),
      },
    ],
  });
  const ohne = sanitizeWorldLayout(bau([])).regions[0]!;
  check('bewuchs: leere Liste bleibt leer', Array.isArray(ohne.vegetation) && ohne.vegetation.length === 0);
  const standard = sanitizeWorldLayout(bau()).regions[0]!;
  check('bewuchs: ohne Feld bleibt Biom-Standard', standard.vegetation === undefined);
  const eigen = sanitizeWorldLayout(bau([...GRASLAND_FLORA_NAMEN])).regions[0]!;
  check(
    'bewuchs: eigene Flora kommt vollstaendig durch',
    eigen.vegetation?.length === GRASLAND_FLORA_NAMEN.length
  );
  // Jeder kuratierte Name MUSS einen Streueintrag haben, sonst filtert
  // der ZoneManager ihn weg und die Insel bleibt kahl (ZoneManager.ts:601).
  const ohneEintrag = GRASLAND_FLORA_NAMEN.filter((n) => !FOLIAGE.some((f) => f.prefabName === n));
  check('bewuchs: jede eigene Art ist streubar', ohneEintrag.length === 0, ohneEintrag.join(', '));
}

// ── Umbenennung meadows -> grassland ─────────────────────────────────
// Ein Weltdokument ist die Arbeit des Nutzers; eine Umbenennung darf es
// nicht unlesbar machen.
{
  const alt = sanitizeWorldLayout({
    version: 1,
    name: 'Alt',
    regions: [
      { id: 'a', biome: 'meadows', shape: { kind: 'circle', x: 0, z: 0, radius: 500 }, edgeFalloff: 300 },
    ],
  });
  check('biom: altes "meadows" wird zu "grassland"', alt.regions[0]?.biome === 'grassland');
  const unsinn = sanitizeWorldLayout({
    version: 1,
    name: 'Unsinn',
    regions: [
      { id: 'a', biome: 'wiese', shape: { kind: 'circle', x: 0, z: 0, radius: 500 }, edgeFalloff: 300 },
    ],
  });
  check('biom: unbekannter Name faellt weiterhin raus', unsinn.regions.length === 0);
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== WORLDLAYOUT: ALL PASSED ===');
