/**
 * Tests für kartenAuswertung.ts (B6 Überlappungswarnung, B7 Flächenanzeige).
 * Reine Geometrie, kein DOM, keine Server/Sockets — läuft in Sekunden.
 *
 *   npx tsx test/karten-auswertung.ts
 */
import {
  flaechenBericht,
  ueberlappungsBericht,
  ueberlappungsGruppen,
  zellUeberlappungen,
} from '../src/worldlayout/kartenAuswertung.js';
import { MAX_KANDIDATEN } from '../src/worldlayout/compile.js';
import type { RegionDef, WorldLayout } from '../src/worldlayout/types.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function welt(regions: readonly RegionDef[], placements: WorldLayout['placements'] = []): WorldLayout {
  return {
    version: 1,
    name: 'Test',
    detailSeed: 't',
    continents: [],
    regions,
    placements,
  };
}

function kreis(id: string, x: number, z: number, radius: number, biome: RegionDef['biome'] = 'grassland', edgeFalloff = 50): RegionDef {
  return { id, biome, shape: { kind: 'circle', x, z, radius }, edgeFalloff };
}

// ── B6: Zellüberlappungen ───────────────────────────────────────────────

// Die Schwelle selbst kommt aus compile.ts, nicht aus einer eigenen
// Annahme — verifiziert die Roadmap-Zahl "4" statt sie zu glauben.
check('MAX_KANDIDATEN ist die dokumentierte Herkunft der "4"', MAX_KANDIDATEN === 4, `= ${MAX_KANDIDATEN}`);

{
  // Zwei weit getrennte Inseln — keine Zelle sieht beide.
  const l = welt([kreis('a', 0, 0, 300), kreis('b', 50000, 50000, 300)]);
  check('keine Überlappung bei getrennten Inseln', zellUeberlappungen(l).length === 0);
}

{
  // Genau MAX_KANDIDATEN Regionen am selben Punkt: noch KEINE Meldung —
  // "mehr als 4" ist die Grenze, nicht "4 oder mehr".
  const regionen = Array.from({ length: MAX_KANDIDATEN }, (_, i) => kreis(`r${i}`, 0, 0, 40, 'grassland', 20));
  const l = welt(regionen);
  const befunde = zellUeberlappungen(l);
  check(`genau ${MAX_KANDIDATEN} Regionen am Punkt → keine Meldung`, befunde.length === 0, `${befunde.length} Befunde`);
}

{
  // MAX_KANDIDATEN + 1 Regionen am selben Punkt: DAS ist der Fall, den
  // RegionField beim Kompilieren still verdrängt.
  const n = MAX_KANDIDATEN + 1;
  const regionen = Array.from({ length: n }, (_, i) => kreis(`r${i}`, 0, 0, 40, 'grassland', 20));
  const l = welt(regionen);
  const befunde = zellUeberlappungen(l);
  check(`${n} Regionen am Punkt → mindestens ein Befund`, befunde.length > 0, `${befunde.length}`);
  const zentrum = befunde.find((b) => Math.hypot(b.x, b.z) < 40);
  check('Befund an der Mittelzelle mit allen Regionen', zentrum !== undefined && zentrum.anzahl === n, JSON.stringify(zentrum));
  check(
    'Befund nennt alle beteiligten IDs',
    zentrum !== undefined && regionen.every((r) => zentrum.regionen.includes(r.id))
  );

  const bericht = ueberlappungsBericht(l);
  check('ueberlappungsBericht traegt die echte Schwelle', bericht.schwelle === MAX_KANDIDATEN);
  check('ueberlappungsBericht zaehlt betroffene Zellen', bericht.zellenBetroffen === befunde.length);
  check(
    'ueberlappungsBericht listet alle beteiligten Regionen',
    regionen.every((r) => bericht.regionenBeteiligt.includes(r.id))
  );
  check('ueberlappungsBericht kennt die schlimmste Zelle', bericht.schlimmste?.anzahl === n);
}

{
  // Zwei getrennte Überlappungs-Cluster mit unterschiedlichen
  // Regionen-Kombinationen — genau der Fall aus der Dev-Welt (Cluster um
  // insel-7/10..15): viele Zellen, aber nur wenige tatsächliche
  // Kombinationen. `ueberlappungsGruppen` muss daraus GRUPPEN machen,
  // keine Zellenliste.
  const clusterA = Array.from({ length: MAX_KANDIDATEN + 1 }, (_, i) => kreis(`a${i}`, 0, 0, 60, 'grassland', 20));
  const clusterB = Array.from({ length: MAX_KANDIDATEN + 2 }, (_, i) => kreis(`b${i}`, 30000, 30000, 60, 'swamp', 20));
  const l = welt([...clusterA, ...clusterB]);
  const gruppen = ueberlappungsGruppen(l);
  check('zwei Cluster ergeben zwei Gruppen', gruppen.length === 2, `${gruppen.length}`);
  const gA = gruppen.find((g) => g.regionen.includes('a0'));
  const gB = gruppen.find((g) => g.regionen.includes('b0'));
  check('Gruppe A enthält genau die Cluster-A-Regionen', gA !== undefined && gA.regionen.length === clusterA.length);
  check('Gruppe B enthält genau die Cluster-B-Regionen', gB !== undefined && gB.regionen.length === clusterB.length);
  check('Gruppe A liegt räumlich um den Cluster-A-Mittelpunkt', gA !== undefined && Math.hypot(gA.mitteX, gA.mitteZ) < 200, JSON.stringify(gA));
  check(
    'Gruppe B liegt räumlich um den Cluster-B-Mittelpunkt',
    gB !== undefined && Math.hypot(gB.mitteX - 30000, gB.mitteZ - 30000) < 200
  );
  check('Summe der Gruppen-Zellen entspricht der Rohliste', gruppen.reduce((s, g) => s + g.zellenAnzahl, 0) === zellUeberlappungen(l).length);
}

// ── B7: Flächenrechnung ─────────────────────────────────────────────────

{
  // Ein einzelner Kreis fernab vom Ursprung (Rasterphase soll die
  // analytische Fläche nicht verfälschen) — πr² mit Rastertoleranz.
  const r = 2000;
  const l = welt([kreis('insel', 13337, -9001, r, 'swamp')]);
  const bericht = flaechenBericht(l);
  const erwartet = Math.PI * r * r;
  const abweichung = Math.abs(bericht.gesamtQm - erwartet) / erwartet;
  check('Kreisfläche stimmt bis auf Rasterrauschen', abweichung < 0.01, `${bericht.gesamtQm} vs ${erwartet} (${(abweichung * 100).toFixed(2)}%)`);
  check('Kreisfläche steht vollständig im richtigen Biom', bericht.jeBiom.get('swamp') === bericht.gesamtQm);
  check('kein anderes Biom bekommt Fläche', bericht.jeBiom.size === 1);
}

{
  // Zwei gleich große, überlappende Kreise DERSELBEN Region-Reihenfolge:
  // Fläche darf NICHT die Summe zweier Vollkreise sein (das wäre der Bug,
  // den die Roadmap für B7 unterstellt), sondern höchstens die Fläche der
  // Vereinigung.
  const r = 1000;
  const abstand = 800; // deutliche Überlappung
  const l = welt([kreis('a', -abstand / 2, 0, r, 'grassland'), kreis('b', abstand / 2, 0, r, 'blackforest')]);
  const bericht = flaechenBericht(l);
  const summeEinzeln = 2 * Math.PI * r * r;
  check('überlappte Fläche ist kleiner als die Summe der Einzelflächen', bericht.gesamtQm < summeEinzeln, `${bericht.gesamtQm} vs ${summeEinzeln}`);
  check('überlappte Fläche ist größer als ein Einzelkreis', bericht.gesamtQm > Math.PI * r * r);
  // Die spätere Region (höherer Index, 'b'/blackforest) gewinnt laut
  // Z-Regel die Überlappungszone — ihr Biom-Anteil darf deshalb nicht
  // kleiner sein als der der früheren.
  const flaecheA = bericht.jeBiom.get('grassland') ?? 0;
  const flaecheB = bericht.jeBiom.get('blackforest') ?? 0;
  check('spätere Region gewinnt die Überlappungszone (Z-Regel)', flaecheB > flaecheA, `a=${flaecheA} b=${flaecheB}`);
  check('Biomsumme ergibt die Gesamtfläche', Math.abs(flaecheA + flaecheB - bericht.gesamtQm) < 1e-6);
}

{
  // Regionen ohne jede Platzierung.
  const l = welt(
    [kreis('mit-platzierung', 0, 0, 500), kreis('ohne-platzierung', 20000, 20000, 500), kreis('leer', -20000, -20000, 500)],
    [{ prefab: 'Baum1', x: 10, z: -10 }]
  );
  const bericht = flaechenBericht(l);
  check(
    'Region mit Platzierung fehlt in der Liste',
    !bericht.regionenOhnePlatzierung.includes('mit-platzierung'),
    bericht.regionenOhnePlatzierung.join(', ')
  );
  check(
    'Regionen ohne Platzierung sind beide gelistet',
    bericht.regionenOhnePlatzierung.includes('ohne-platzierung') && bericht.regionenOhnePlatzierung.includes('leer')
  );
}

{
  // Layout ganz ohne Platzierungen: jede Region gilt als unbesetzt.
  const l = welt([kreis('a', 0, 0, 300), kreis('b', 5000, 5000, 300)]);
  const bericht = flaechenBericht(l);
  check('ohne jede Platzierung sind alle Regionen gelistet', bericht.regionenOhnePlatzierung.length === 2);
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== KARTEN-AUSWERTUNG: ALL PASSED ===');
