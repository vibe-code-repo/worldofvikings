/**
 * Prüft: dass `tools/store-terrain-schichten.mjs` deterministisch läuft und
 * dass die Zahlen, mit denen der Splat-Shader gebaut wird, dieselben sind
 * wie die des Werkzeugs.
 *
 * ── Wogegen dieser Test steht ────────────────────────────────────────
 * Vier Arten, wie die Bodenschichten still falsch werden können. Keine
 * davon wirft eine Fehlermeldung, drei davon sieht man nicht einmal auf
 * dem Bild sofort:
 *
 *  (a) NICHT DETERMINISTISCH. Läuft das Werkzeug zweimal und schreibt
 *      zweimal verschiedene Bytes, ist der Ordner nach jedem Lauf
 *      „geändert" — und niemand kann mehr feststellen, ob sich etwas
 *      geändert HAT. Die Ausgabe liegt unter `assets/` und damit
 *      ausserhalb von Git; ein `git status` fängt das nicht ab.
 *
 *  (b) ZWEI WAHRHEITEN. Kachelmass, Normalstärke, Metallic und Glätte
 *      stehen an ZWEI Stellen: im Werkzeug (das die Pixel baut) und in
 *      `SCHICHT_OBERFLAECHE` von `TerrainSplat.ts` (das den Shader
 *      baut). Das ist keine Nachlässigkeit, sondern eine Notwendigkeit —
 *      der Shader entsteht beim Bauen des Materials, `assets/generiert/`
 *      erst zur Laufzeit. Aber zwei Listen laufen auseinander, und zwar
 *      an dem Tag, an dem jemand EINE davon korrigiert. Dieser Test ist
 *      die Klammer.
 *
 *  (c) EINE UNVOLLSTÄNDIGE SCHICHT. Eine Zeile ohne Normalmap, ohne
 *      Kachelmass oder mit Metallic 0,85 und ohne Glätte ist eine
 *      Schicht, die jemand halb fertig gemacht hat. Metallic ohne
 *      Himmelsterm ist schwarz, Normalmap ohne Stärke ist flach.
 *
 *  (d) EIN BIOM OHNE HANG. Die Steigungsrampe (`HANG_TILE`, `RAU_TILE`)
 *      muss für JEDES der fünf Biome sagen, was auf flachem Grund liegt
 *      und was am Hang. Fehlt ein Eintrag, zeigt der Hang dort weiter
 *      die Grundkachel — und ein Berg aus Gras sieht nicht falsch aus,
 *      er sieht nur nicht nach Berg aus.
 *
 * ── Die Weiche ───────────────────────────────────────────────────────
 * `assets/store` ist ein Symlink auf einen Speicher ausserhalb des
 * Repos. Fehlt der Ordner GANZ (CI-Checkout), überspringt der Sammellauf
 * (`brauchtStore()`). Fehlen einzelne Dateien DARIN, wird dieser Test
 * rot — das ist ein unvollständiger Speicher, kein Umstand. Er
 * überspringt nie von sich aus.
 *
 *   npx tsx tools/test/terrain-schichten.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHICHT_OBERFLAECHE,
  HANG_TILE,
  RAU_TILE,
  TILE,
  BIOME_TILE,
} from '../../client/src/engine/TerrainSplat.js';
// Das Werkzeug ist ein `.mjs` ohne Typen — genau deshalb wird es HIER
// importiert und nicht nachgebildet: Eine Nachbildung prüft sich selbst.
import {
  SCHICHTEN,
  ZUORDNUNG,
  tabelle,
  fehlendeDateien,
} from '../store-terrain-schichten.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const WERKZEUG = join(WURZEL, 'tools/store-terrain-schichten.mjs');
const AUS = join(WURZEL, 'assets/generiert/terrain');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/*
  Der Speicher MUSS hier liegen. Dass er da ist, entscheidet die Weiche im
  Sammellauf; wer diesen Test ohne ihn startet, bekommt einen Befund.
*/
const fehlt = fehlendeDateien() as string[];
check(
  'jede Quelltextur der Tabelle liegt im Speicher',
  fehlt.length === 0,
  fehlt.slice(0, 4).join(', ')
);

// ── (c) Keine halbe Schicht ────────────────────────────────────────
type Schicht = {
  farbe: string;
  normale: string;
  kachelMeter: number;
  normalStaerke: number;
  metallic: number;
  smoothness: number;
};
const schichten = SCHICHTEN as Record<string, Schicht>;
const unvollstaendig: string[] = [];
for (const [name, s] of Object.entries(schichten)) {
  const gut =
    typeof s.farbe === 'string' &&
    s.farbe.length > 0 &&
    typeof s.normale === 'string' &&
    s.normale.length > 0 &&
    Number.isFinite(s.kachelMeter) &&
    s.kachelMeter > 0 &&
    Number.isFinite(s.normalStaerke) &&
    s.normalStaerke > 0 &&
    Number.isFinite(s.metallic) &&
    s.metallic >= 0 &&
    s.metallic <= 1 &&
    Number.isFinite(s.smoothness) &&
    s.smoothness >= 0 &&
    s.smoothness <= 1;
  if (!gut) unvollstaendig.push(name);
}
check(
  `alle ${String(Object.keys(schichten).length)} Schichten tragen Farbe, Normalmap, Kachelmass, Metallic und Glätte`,
  Object.keys(schichten).length >= 6 && unvollstaendig.length === 0,
  unvollstaendig.join(', ')
);

// ── (b) Eine Wahrheit, zwei Listen ─────────────────────────────────
const tab = tabelle(512) as { tiles: { tile: number; name: string; quelle: string;
  kachelMeter: number; normalStaerke: number; metallic: number; smoothness: number }[] };
check(
  'das Werkzeug beschreibt genau 16 Tiles — so viele hat der Stapel',
  tab.tiles.length === 16 && SCHICHT_OBERFLAECHE.length === 16,
  `${String(tab.tiles.length)} / ${String(SCHICHT_OBERFLAECHE.length)}`
);
const abweichungen: string[] = [];
for (const t of tab.tiles) {
  const o = SCHICHT_OBERFLAECHE[t.tile];
  if (!o) {
    abweichungen.push(`${t.name}: im Shader nicht vorhanden`);
    continue;
  }
  for (const feld of ['kachelMeter', 'normalStaerke', 'metallic', 'smoothness'] as const) {
    if (Math.abs(o[feld] - t[feld]) > 1e-6) {
      abweichungen.push(`${t.name}.${feld}: Werkzeug ${String(t[feld])} vs Shader ${String(o[feld])}`);
    }
  }
}
check(
  'Werkzeug und Shader nennen für jedes Tile dieselben vier Zahlen',
  abweichungen.length === 0,
  abweichungen.slice(0, 5).join('; ')
);

// ── (d) Kein Biom ohne Hang ────────────────────────────────────────
/*
  Die fünf Biome, um die es geht: Grasland, Schwarzwald, Sumpf, Tiefer
  Norden und Asche. Geprüft wird nicht, WELCHE Kachel ein Hang bekommt —
  das ist eine Gestaltungsfrage —, sondern dass für jedes Biom eine
  Antwort da ist und dass sie eine ANDERE Kachel nennt als der flache
  Grund. Sagt die Rampe an einem Berghang „wieder Gras", ist sie zwar
  vollständig, aber wirkungslos, und genau das war der Zustand vor
  dieser Stufe.
*/
const BIOME: [string, number][] = [
  ['Grasland', 1],
  ['Schwarzwald', 8],
  ['Sumpf', 2],
  ['Tiefer Norden', 64],
  ['Asche', 32],
];
const luecken: string[] = [];
for (const [name, biom] of BIOME) {
  const grund = BIOME_TILE[biom];
  if (grund === undefined) {
    luecken.push(`${name}: kein Grund-Tile in BIOME_TILE`);
    continue;
  }
  const hang = HANG_TILE[grund];
  const rau = RAU_TILE[grund];
  if (hang === undefined || rau === undefined) {
    luecken.push(`${name}: Rampe unvollständig`);
    continue;
  }
  // Fels (Tiefer Norden, Berg) trägt am Hang bewusst wieder Fels — dort
  // ist die MITTLERE Stufe kein Wechsel. Die STEILE muss es aber sein,
  // sonst gibt es im ganzen Biom keinen rauen Fels.
  if (rau === grund) luecken.push(`${name}: steiler Hang zeigt dieselbe Kachel wie flacher Grund`);
  if (hang === grund && grund !== TILE.Rock) {
    luecken.push(`${name}: mittlerer Hang zeigt dieselbe Kachel wie flacher Grund`);
  }
}
check(
  'jedes der fünf Biome hat eine Kachel für flach, mittleren Hang und steilen Hang',
  luecken.length === 0,
  luecken.join('; ')
);

check(
  'jede Rampenkachel hat selbst eine Oberfläche',
  [...HANG_TILE, ...RAU_TILE].every((t) => SCHICHT_OBERFLAECHE[t] !== undefined),
  'ein Eintrag zeigt auf ein Tile ausserhalb von 0..15'
);

// ── Der Rückfall bleibt erreichbar ─────────────────────────────────
/*
  `STORE_BODEN_AKTIV` und `BODEN_FACETTIERT` müssen `boolean` sein und
  nicht `true`/`false` als Literaltyp. Mit einem Literal narrowt
  TypeScript den jeweils anderen Zweig zu totem Code, `tsc` schweigt zu
  jedem Fehler darin, und der Rückfall auf Stufe 0 ist beim nächsten
  Umbau still kaputt. Geprüft wird am QUELLTEXT, weil genau die
  Typannotation das Entscheidende ist und sie zur Laufzeit verschwunden
  wäre.
*/
const splatQuelle = readFileSync(join(WURZEL, 'client/src/engine/TerrainSplat.ts'), 'utf-8');
for (const schalter of ['STORE_BODEN_AKTIV', 'BODEN_FACETTIERT']) {
  check(
    `${schalter} ist als boolean typisiert — beide Stellungen bleiben übersetzbar`,
    new RegExp(`export const ${schalter}: boolean = (true|false);`).test(splatQuelle),
    'ohne die Annotation narrowt TypeScript den anderen Zweig zu totem Code'
  );
}
check(
  'die Vorgabe ist: Store-Boden an, facettiert aus',
  /export const STORE_BODEN_AKTIV: boolean = true;/.test(splatQuelle) &&
    /export const BODEN_FACETTIERT: boolean = false;/.test(splatQuelle),
  'Analyse §5: der Boden des Vorbilds ist glatt'
);

// ── (a) Determinismus ──────────────────────────────────────────────
/*
  Der teure Teil, deshalb zuletzt und auf der KLEINSTEN Kante: Zwei Läufe
  hintereinander, und die Dateien müssen byteidentisch sein. 256² statt
  der Vorgabe 512², weil die Frage „schreibt der zweite Lauf dieselben
  Bytes?" von der Auflösung nicht abhängt, die Laufzeit aber schon.

  Der Lauf überschreibt `assets/generiert/terrain/` — das ist Absicht und
  unschädlich: Der Ordner ist erzeugt, gitignored, und wer eine andere
  Kante braucht, ruft das Werkzeug ohnehin neu auf. Damit der Test
  niemandem den Stapel unter dem laufenden Client wegzieht, stellt er am
  Ende die Kante wieder her, die vorher dort lag.
*/
const vorherKante = existsSync(join(AUS, 'store-schichten.json'))
  ? (JSON.parse(readFileSync(join(AUS, 'store-schichten.json'), 'utf-8')) as { kante: number }).kante
  : null;

function lauf(kante: number): { code: number; fingerabdruck: string } {
  const r = spawnSync(process.execPath, [WERKZEUG, '--kante', String(kante)], {
    cwd: WURZEL,
    encoding: 'utf-8',
  });
  const dateien = existsSync(AUS) ? readdirSync(AUS).sort() : [];
  const abdruck = dateien
    .map((d) => {
      const p = join(AUS, d);
      return `${d}:${String(statSync(p).size)}:${readFileSync(p).toString('base64').length}:${
        // Ein Hash ohne Krypto-Modul: Summe und Länge reichen nicht, ein
        // vollständiger Vergleich schon. Die Dateien sind klein genug.
        readFileSync(p).toString('latin1').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7)
      }`;
    })
    .join('|');
  return { code: r.status ?? -1, fingerabdruck: abdruck };
}

const a = lauf(256);
check('das Werkzeug läuft durch', a.code === 0);
const b = lauf(256);
check(
  'zweiter Lauf schreibt byteidentische Dateien',
  a.fingerabdruck === b.fingerabdruck && a.fingerabdruck.length > 0,
  a.fingerabdruck.length === 0 ? 'keine Ausgabedateien gefunden — der Test misst nichts' : 'die Ausgabe wandert'
);
check(
  'die Ausgabe besteht aus den drei versprochenen Dateien',
  ['store_d_array.png', 'store_n_array.png', 'store-schichten.json'].every((d) =>
    existsSync(join(AUS, d))
  )
);

/*
  Die zwei Altbestand-Zeilen. Sie sind der Grund, warum der Stapel nicht
  einfach sechs Store-Texturen untereinander ist: Asche hat im Speicher
  keine Entsprechung, und Zeile 15 ist gar keine Farbkachel, sondern die
  Graustufen-Emissionsmaske der Lava-Risse. Wer sie überschreibt, legt
  die glühenden Risse dorthin, wo das neue Gestein hell ist.
*/
const zuordnung = ZUORDNUNG as { name: string; altbestand?: boolean }[];
check(
  'Asche und Lava-Kruste bleiben Altbestand',
  zuordnung[TILE.Ash]?.altbestand === true && zuordnung[TILE.LavaCrust]?.altbestand === true,
  'Zeile 15 ist eine Emissionsmaske, keine Farbkachel'
);

// Den Stapel zurückstellen, den der Arbeitsbaum vorher hatte.
if (vorherKante !== null && vorherKante !== 256) lauf(vorherKante);

console.log(fehler === 0 ? '\nalle Prüfungen grün' : `\n${String(fehler)} Prüfung(en) fehlgeschlagen`);
process.exit(fehler > 0 ? 1 : 0);
