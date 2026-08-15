/**
 * Stellt Messreihen aus tools/pw-fps-bench.mjs nebeneinander.
 *
 * Fasst mehrere Laeufe desselben Standes zum Median zusammen, damit ein
 * einzelner Ausreisser-Lauf keine Wirkung vortaeuscht, und rechnet die
 * Veraenderung gegen die erste Gruppe aus.
 *
 * WARUM DER MEDIAN UND NICHT DER MITTELWERT der Laeufe: Die Baseline
 * zeigte fps-Mittelwerte zwischen 115 und 140 bei praktisch gleichem
 * 1%-low (28,6 / 28,8 / 30,9). Ein Mittelwert ueber die Laeufe wuerde
 * diese Streuung in die Kennzahl tragen, statt sie herauszufiltern.
 *
 * WELCHE ZAHL ZAEHLT: Gemeldet wurden Framedrops, nicht niedrige
 * Durchschnitts-fps. Ausschlaggebend sind deshalb 1%-low, p99 und der
 * Anteil der Frames ueber 33 ms — nicht der fps-Mittelwert.
 *
 * Aufruf:  node tools/wov-mess-vergleich.mjs mess/baseline-*.json mess/d1-*.json
 *          node tools/wov-mess-vergleich.mjs --md mess/*.json > bericht.md
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const alsMarkdown = process.argv.includes('--md');
const dateien = process.argv.slice(2).filter((a) => a.endsWith('.json'));
if (!dateien.length) {
  console.error('Aufruf: node tools/wov-mess-vergleich.mjs <mess/*.json> [--md]');
  process.exit(1);
}

/** Laeufe nach Stand gruppieren: "baseline-1" und "baseline-2" -> "baseline". */
const gruppen = new Map();
for (const d of dateien) {
  const m = JSON.parse(readFileSync(d, 'utf8'));
  const stand = (m.label ?? basename(d, '.json')).replace(/-\d+$/, '');
  if (!gruppen.has(stand)) gruppen.set(stand, []);
  gruppen.get(stand).push(m);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const zeilen = [];
for (const [stand, laeufe] of gruppen) {
  zeilen.push({
    stand,
    n: laeufe.length,
    fpsMedian: median(laeufe.map((m) => m.fps.median)),
    einsProzentLow: median(laeufe.map((m) => m.fps.p1_low)),
    p95: median(laeufe.map((m) => m.frameZeitMs.p95)),
    p99: median(laeufe.map((m) => m.frameZeitMs.p99)),
    max: median(laeufe.map((m) => m.frameZeitMs.max)),
    anteil33: median(laeufe.map((m) => m.ausreisser.anteilUeber33)),
    meshes: median(laeufe.map((m) => m.teilsysteme?.aktiveMeshes ?? 0)),
  });
}

const basis = zeilen[0];
/** Vorzeichenbehaftete Veraenderung; `hoeherBesser` dreht die Bewertung. */
const delta = (jetzt, vorher, hoeherBesser) => {
  if (vorher === 0) return '—';
  const p = ((jetzt - vorher) / vorher) * 100;
  const gut = hoeherBesser ? p > 0 : p < 0;
  const pfeil = Math.abs(p) < 1 ? '·' : gut ? '+' : '!';
  return `${pfeil}${p >= 0 ? '+' : ''}${p.toFixed(1)} %`;
};

const kopf = ['Stand', 'n', 'fps Median', 'fps 1%-low', 'p95 ms', 'p99 ms', 'max ms', '>33ms', 'Meshes'];
const daten = zeilen.map((z) => [
  z.stand,
  String(z.n),
  z.fpsMedian.toFixed(1),
  `${z.einsProzentLow.toFixed(1)}${z === basis ? '' : ' (' + delta(z.einsProzentLow, basis.einsProzentLow, true) + ')'}`,
  z.p95.toFixed(1),
  `${z.p99.toFixed(1)}${z === basis ? '' : ' (' + delta(z.p99, basis.p99, false) + ')'}`,
  `${z.max.toFixed(1)}${z === basis ? '' : ' (' + delta(z.max, basis.max, false) + ')'}`,
  `${z.anteil33.toFixed(2)} %`,
  z.meshes.toFixed(0),
]);

if (alsMarkdown) {
  console.log(`| ${kopf.join(' | ')} |`);
  console.log(`|${kopf.map(() => '---').join('|')}|`);
  for (const r of daten) console.log(`| ${r.join(' | ')} |`);
  console.log('');
  console.log('`+` Verbesserung · `!` Verschlechterung · `·` unter 1 %, im Rauschen.');
  console.log('Je Stand der Median ueber alle Laeufe. Massgeblich sind 1%-low, p99 und der Anteil ueber 33 ms —');
  console.log('gemeldet wurden Framedrops, nicht niedrige Durchschnitts-fps.');
} else {
  const breiten = kopf.map((h, i) => Math.max(h.length, ...daten.map((r) => r[i].length)));
  const linie = (r) => r.map((c, i) => c.padEnd(breiten[i])).join('  ');
  console.log(linie(kopf));
  console.log(breiten.map((b) => '-'.repeat(b)).join('  '));
  for (const r of daten) console.log(linie(r));
  console.log('');
  console.log('+ besser · ! schlechter · · unter 1 % (Rauschen). Massgeblich: 1%-low, p99, >33ms.');
}
