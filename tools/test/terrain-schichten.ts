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
 *  (e) EIN VORZEICHEN IN DER HIMMELS-IRRADIANZ. Die sechs Zahlen in
 *      `HIMMEL_IRRADIANZ` sind das Halbkugel-Mittel des Kuppelverlaufs.
 *      Ein Tippfehler darin macht den Boden zu hell, zu dunkel oder zu
 *      blau — und alle drei sehen aus wie eine Geschmacksfrage. Geprüft
 *      wird gegen eine stumpfe Summe über 20 000 Richtungen.
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
  FELS_TILE,
  RAU_TILE,
  RAMPEN,
  nyBeiGrad,
  TILE,
  BIOME_TILE,
  HIMMEL_IRRADIANZ,
  himmelIrradianzGewichte,
  TRIPLANAR,
  triplanarGewichte,
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
  farbe: string; farbeGewuenscht: string; farbeOrt: string | null;
  kachelMeter: number; normalStaerke: number; metallic: number; smoothness: number }[] };

/*
  ── (f) Die Ersatzkarte des hellen Hangfelses (A9, 11.09.2026) ───────

  Tile 5/6/14 wollen `terrain-rock-moss` — die Diffuse-Karte der Ebene,
  die das Vorbild auf der Wiese wirklich benutzt. Sie liegt nicht im
  Asset-Speicher, sondern entsteht aus einem Quellbestand ausserhalb des
  Repos (`tools/store-boden-quellen.mjs`). Auf einer Maschine ohne
  diesen Bestand MUSS der Boden trotzdem bauen; dann gilt `farbeErsatz`.

  Zwei Dinge sind dabei still gefährlich, und beide stehen hier:
   · Der Ersatz greift, OHNE dass es auffällt. Deshalb schreibt die
     Tabelle die wirklich benutzte Karte samt Ort mit, und dieser Test
     hält fest, dass sie das tut.
   · Der Wunsch wird vergessen. `farbeGewuenscht` bleibt deshalb auch
     dann `terrain-rock-moss`, wenn gerade der Ersatz gebaut wird — sonst
     wüsste nach einem Lauf ohne Quellbestand niemand mehr, dass hier
     eine Karte fehlt.
*/
{
  const felsZeilen = tab.tiles.filter((t) => t.quelle === 'rock-rough');
  check(
    'der helle Hangfels wünscht sich die Karte des Vorbilds',
    felsZeilen.length >= 3 && felsZeilen.every((t) => t.farbeGewuenscht === 'terrain-rock-moss'),
    felsZeilen.map((t) => `${String(t.tile)}:${t.farbeGewuenscht}`).join(' ')
  );
  check(
    'jede Zeile sagt, welche Karte sie wirklich trägt und woher',
    tab.tiles
      .filter((t) => t.quelle !== 'altbestand')
      .every((t) => typeof t.farbe === 'string' && t.farbe.length > 0 && t.farbeOrt !== null),
    tab.tiles.filter((t) => t.quelle !== 'altbestand' && !t.farbeOrt).map((t) => t.name).join(', ')
  );
  const gebaut = felsZeilen[0]?.farbe ?? '';
  check(
    'die gebaute Karte ist die gewünschte oder der benannte Ersatz',
    gebaut === 'terrain-rock-moss' || gebaut === 'terrain-rock-rough',
    `${gebaut} (${felsZeilen[0]?.farbeOrt ?? '—'})`
  );
  if (gebaut !== 'terrain-rock-moss') {
    console.log(
      '     Hinweis: Es wird der ERSATZ gebaut — `terrain-rock-moss` liegt weder im\n' +
        '     Speicher noch unter assets/store-lab/textures/. `npm run store:quellen`\n' +
        '     holt sie, wenn der Quellbestand auf dieser Maschine vorhanden ist.'
    );
  }
}

/*
  ── (g) Die Karte der Moosschicht (Folgekarte „Moosschicht", 12.09.) ──

  Dieselbe Lücke wie bei (f), eine Ebene weiter: Tile 1/10/11 tragen die
  Zahlen der Moos-Ebene des Vorbilds (2 m, Normale 1,2, Metallic 0), ihre
  FARBE war bis zum 12.09.2026 ein Vertreter aus dem Speicher. Gemessen
  ist der Unterschied eine Verdopplung — lineare Luma 0,0367 gegen 0,0180
  —, und genau die hielt `Hangfels/Moos` am Hang bei 1,21 fest
  (`design/original-boden.md`, Nachtrag 12.09.).

  Zwei Dinge sind hier still gefährlich:
   · Der Ersatz greift unbemerkt (wie bei (f)) — deshalb steht auch hier
     der WUNSCH in `farbeGewuenscht`, egal was gebaut wurde.
   · Die drei Moos-Tiles laufen auseinander. Sie sind EINE Schicht; wer
     nur eine davon umstellt, bekommt einen Waldboden, der anders
     aussieht als der Hang daneben — ohne Fehlermeldung.
*/
{
  const moosZeilen = tab.tiles.filter((t) => t.quelle === 'moss');
  check(
    'die Moosschicht wünscht sich die Karte des Vorbilds',
    moosZeilen.length >= 3 && moosZeilen.every((t) => t.farbeGewuenscht === 'terrain-moss-dark'),
    moosZeilen.map((t) => `${String(t.tile)}:${t.farbeGewuenscht}`).join(' ')
  );
  check(
    'alle Moos-Tiles tragen dieselbe Karte',
    new Set(moosZeilen.map((t) => t.farbe)).size === 1,
    moosZeilen.map((t) => `${String(t.tile)}:${t.farbe}`).join(' ')
  );
  const moosGebaut = moosZeilen[0]?.farbe ?? '';
  check(
    'die gebaute Mooskarte ist die gewünschte oder der benannte Ersatz',
    moosGebaut === 'terrain-moss-dark' || moosGebaut === 'terrain-moss',
    `${moosGebaut} (${moosZeilen[0]?.farbeOrt ?? '—'})`
  );
  if (moosGebaut !== 'terrain-moss-dark') {
    console.log(
      '     Hinweis: Es wird der ERSATZ gebaut — `terrain-moss-dark` liegt weder im\n' +
        '     Speicher noch unter assets/store-lab/textures/. `npm run store:quellen`\n' +
        '     holt sie, wenn der Quellbestand auf dieser Maschine vorhanden ist.'
    );
  }
}
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
  const fels = FELS_TILE[grund];
  const rau = RAU_TILE[grund];
  if (hang === undefined || fels === undefined || rau === undefined) {
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
  [...HANG_TILE, ...FELS_TILE, ...RAU_TILE].every((t) => SCHICHT_OBERFLAECHE[t] !== undefined),
  'ein Eintrag zeigt auf ein Tile ausserhalb von 0..15'
);

/*
  Alle DREI Tabellen führen sechzehn Zeilen. Der Splat indiziert sie im
  GLSL mit `VB_HANG[i]`, `i` aus dem Tile-Index — eine Tabelle mit
  fünfzehn Einträgen liest dort über das Ende hinaus, und GLSL sagt dazu
  nichts. `FELS_TILE` wird zusätzlich in `Terrain.ts` je Vertex gelesen;
  ein `undefined` würde dort zu NaN im Attributpuffer und der ganze
  Chunk verschwände lautlos.
*/
check(
  'alle sechzehn Zeilen haben Hang-, Fels- und Rau-Kachel',
  HANG_TILE.length === 16 && FELS_TILE.length === 16 && RAU_TILE.length === 16 &&
    [...HANG_TILE, ...FELS_TILE, ...RAU_TILE].every((t) => Number.isInteger(t) && t >= 0 && t < 16),
  `${HANG_TILE.length}/${FELS_TILE.length}/${RAU_TILE.length}`
);

// ── (f) Die Steigungsrampe ist monoton und überschneidungsfrei ──────
/*
  Drei Stufen, die sich stapeln. Zwei Arten, das still kaputtzumachen:

   - EINE STUFE LÄUFT RÜCKWÄRTS (`beginn` ≥ `voll`). Der Shader teilt
     durch `beginn − voll`; wird das null, ist die Rampe eine Division
     durch null, und wird es negativ, blendet die Stufe auf FLACHEM Grund
     ein statt am Hang. Beides sieht man erst im Bild, und dann sieht es
     aus wie ein Beleuchtungsfehler.

   - ZWEI STUFEN ÜBERSCHNEIDEN SICH. Sie werden nacheinander per Lerp
     aufgelegt (`hangLerp`, `rockLerp`, `rauLerp`). Überlappen sie, mischt
     der Hang zwei Kacheln, die beide „halb da" sind — ein Grauschleier
     statt eines Übergangs. Die Grenzen sollen sich BERÜHREN.

  Und die Umrechnung selbst: `nyBeiGrad` muss fallen (steiler = kleineres
  ny). Ein Vorzeichenfehler darin drehte die ganze Rampe um, ohne dass
  eine der beiden Prüfungen oben etwas merkte.
*/
{
  const stufen: [string, { beginn: number; voll: number }][] = [
    ['Hang', RAMPEN.hang],
    ['Fels', RAMPEN.fels],
    ['Rau', RAMPEN.rau],
  ];
  const fehler2: string[] = [];
  for (const [name, s] of stufen) {
    if (!(s.beginn < s.voll)) fehler2.push(`${name}: beginn ${s.beginn}° nicht kleiner als voll ${s.voll}°`);
    if (s.beginn < 0 || s.voll > 90) fehler2.push(`${name}: ausserhalb 0..90°`);
  }
  check('jede Stufe der Steigungsrampe läuft aufwärts', fehler2.length === 0, fehler2.join('; '));

  check(
    'die drei Stufen berühren sich, statt sich zu überschneiden',
    RAMPEN.hang.voll === RAMPEN.fels.beginn && RAMPEN.fels.voll === RAMPEN.rau.beginn,
    `${RAMPEN.hang.voll}/${RAMPEN.fels.beginn} und ${RAMPEN.fels.voll}/${RAMPEN.rau.beginn}`
  );

  check(
    'die Rampe ist monoton: flach → Hang → Fels → rauer Fels',
    RAMPEN.hang.beginn < RAMPEN.hang.voll &&
      RAMPEN.hang.voll <= RAMPEN.fels.beginn &&
      RAMPEN.fels.voll <= RAMPEN.rau.beginn &&
      RAMPEN.rau.voll <= 90,
    [RAMPEN.hang.beginn, RAMPEN.hang.voll, RAMPEN.fels.voll, RAMPEN.rau.voll].join(' → ')
  );

  check(
    'die Fels-Stufe deckt nicht ganz zu (Rest der Kachel darunter bleibt)',
    RAMPEN.fels.anteil > 0 && RAMPEN.fels.anteil <= 1,
    String(RAMPEN.fels.anteil)
  );

  /*
    Die oberste Stufe muss auf UNSEREM Gelände auslösen. Gemessen
    (hang-histogramm.mjs, 09.09.2026): über 56° kommt auf keiner der drei
    Messstellen ein einziger Vertex vor, 44–56° sind 0–1,3 %. Eine Stufe,
    die erst bei 56° einsetzt, ist auf diesen Inseln toter Code — genau
    der Zustand, den diese Nacharbeit behoben hat. 50° ist die Grenze,
    ab der das wieder gilt.
  */
  check(
    'die oberste Stufe ist auf unserem Gelände erreichbar (voll unter 56°)',
    RAMPEN.rau.voll < 56,
    `${RAMPEN.rau.voll}° — über 56° hat das Histogramm keinen einzigen Vertex`
  );

  const abwNy: string[] = [];
  for (const [g, erwartet] of [[0, 1], [30, Math.sqrt(3) / 2], [60, 0.5], [90, 0]] as [number, number][]) {
    if (Math.abs(nyBeiGrad(g) - erwartet) > 1e-6) abwNy.push(`${g}°: ${nyBeiGrad(g).toFixed(6)}`);
  }
  check('nyBeiGrad rechnet Grad in den Kosinus der Neigung um', abwNy.length === 0, abwNy.join('; '));
  check(
    'steiler heisst kleineres ny',
    nyBeiGrad(RAMPEN.hang.beginn) > nyBeiGrad(RAMPEN.fels.beginn) &&
      nyBeiGrad(RAMPEN.fels.beginn) > nyBeiGrad(RAMPEN.rau.beginn) &&
      nyBeiGrad(RAMPEN.rau.beginn) > nyBeiGrad(RAMPEN.rau.voll),
    [RAMPEN.hang.beginn, RAMPEN.fels.beginn, RAMPEN.rau.beginn, RAMPEN.rau.voll]
      .map((g) => nyBeiGrad(g).toFixed(4)).join(' > ')
  );
}

// ── (g) Der Fels des Graslands ist der HELLE ───────────────────────
/*
  Der Befund vom 09.09.2026: Auf einem 45°-Hang lag `terrain-rock-a` und
  wurde als Erde gelesen (Luma 25 um 17 Uhr, Wiese daneben 55). Die
  Ursache steht in der Quelle: Tile 4 ist im Original „Ani Dark
  Rockwall" mit Metallic 0,85 auf einer Albedo von sRGB 23–49; bei
  Metallic ist F₀ die eigene Albedo, eine dunkle Schicht spiegelt also
  auch dunkel. Der helle Fels des Zielbildes ist Tile 5,
  `Terrain_Meadow_Rock_Rough_01` mit Metallic 0.

  Diese Prüfung hält fest, was daraus folgt, damit es nicht beim
  nächsten Aufräumen zurückrutscht: Wo Gras wächst, ist der Fels der
  METALLFREIE. Ein Hang aus Metallic-0,85-Gestein wird ohne
  HDR-Umgebung schwarz, und die haben wir nicht.
*/
{
  const grasArtig = [TILE.Grass, TILE.Heath, TILE.Sand, TILE.Moss];
  const schuldig = grasArtig.filter((t) => {
    const f = SCHICHT_OBERFLAECHE[FELS_TILE[t]!];
    const r = SCHICHT_OBERFLAECHE[RAU_TILE[t]!];
    return !f || !r || f.metallic > 0.5 || r.metallic > 0.5;
  });
  check(
    'die Felsstufen der grasigen Biome sind metallfrei (sonst schwarzer Hang)',
    schuldig.length === 0,
    schuldig.map((t) => `Tile ${t} → ${FELS_TILE[t]}/${RAU_TILE[t]}`).join('; ')
  );
}

// ── (h) Die dunklen Biome behalten auf der WAND die dunkle Schicht ──
/*
  Der Befund vom 09.09.2026 (Mike, Feinabgleich): Der Schwarzwald hatte
  sandsteinfarbene Steilhänge. Ursache war `RAU_TILE`, das bis dahin für
  JEDES Biom `Cliff` führte — also `terrain-rock-rough`, den HELLEN Fels
  des Bergpanoramas (`design/look-referenz.md`, Bild 3: Luma 104, H 30,
  S 0,39). Ab 40° zog er sich über jede dunkle Waldflanke.

  Die Look-Referenz sagt zu genau dieser Stelle: „Wer diese Schicht am
  STEILSTEN Hang misst, misst sie nicht" — am 47°-Hang waren die
  vermeintlichen `rock-a`-Bildpunkte in Wahrheit `Cliff`. Diese Prüfung
  hält fest, dass sie es jetzt nicht mehr sind.

  Geprüft wird über die QUELLTEXTUR und nicht über den Tile-Namen: Der
  dunkle Wandfels ist `terrain-rock-a` (linear 0,023/0,020/0,017, also
  sRGB um 40), der helle raue `terrain-rock-rough` (0,228/0,198/0,159,
  sRGB um 125) — Faktor zehn in der Albedo. Ein Umbenennen der
  Konstanten liefe hier also nicht durch.

  ⚠ Hier stand bis zum 10.09.2026 `metallic >= 0.5` als Unterscheidung.
  Das war richtig, solange `rock-a` die Ebene `Ani Dark Rockwall` mit
  Metallic 0,85 war — und ist mit F25 hinfällig geworden: Level1 fährt
  `Ani Dark Rockwall 3` mit Metallic 0,20, und damit sagt diese Zahl
  nichts mehr über hell und dunkel. Die Albedo tut es weiterhin.
*/
{
  const dunkleBiome: [string, number][] = [
    ['Schwarzwald', 8],
    ['Sumpf', 2],
  ];
  const hell: string[] = [];
  for (const [name, biom] of dunkleBiome) {
    const grund = BIOME_TILE[biom]!;
    const zeile = (ZUORDNUNG as Array<{ schicht?: string }>)[RAU_TILE[grund]!];
    if (zeile?.schicht !== 'rock-a') {
      hell.push(`${name}: RAU_TILE[${grund}] = ${RAU_TILE[grund]} (${zeile?.schicht ?? '—'})`);
    }
  }
  check(
    'Schwarzwald und Sumpf tragen auch auf der senkrechten Wand den DUNKLEN Fels',
    hell.length === 0,
    hell.join('; ')
  );
  check(
    'die Wand des Schwarzwalds ist dieselbe Kachel wie sein mittlerer Hang',
    RAU_TILE[TILE.Forest] === FELS_TILE[TILE.Forest] &&
      RAU_TILE[TILE.Forest] === HANG_TILE[TILE.Forest],
    `${HANG_TILE[TILE.Forest]}/${FELS_TILE[TILE.Forest]}/${RAU_TILE[TILE.Forest]}`
  );
}

// ── (i) Die Gewichte der drei Projektionen ─────────────────────────
/*
  `triplanarGewichte` ist die eine Funktion, an der der ganze Umbau
  hängt: Sie sagt, WIEVIEL von der Projektion von oben und wieviel von
  den beiden Seitenprojektionen in den Bildpunkt geht. Der Shader rechnet
  dieselbe Zeile (erzeugt in `triGewichteGlsl`), damit hier nachrechenbar
  ist, was dort passiert.

  Drei Eigenschaften, und jede hat einen Fehler, den sie verhindert:

   - SUMME 1. Wären es 0,9, käme jede Wand um ein Zehntel zu dunkel
     heraus — und zwar als Farbe, die auf keiner Textur steht.
   - UNTER `TRIPLANAR.beginn` EXAKT [1, 0, 0]. Nicht „ungefähr":
     `mix(x, y, 0.0)` ist bitgenau `x`, und darauf steht der Nachweis,
     dass der flache Boden nach diesem Umbau BITGLEICH ist. Ein
     Gewicht von 1e-7 auf einer Seitenprojektion wäre eine zweite
     Texturabtastung und ein anderes letztes Bit.
   - MONOTON. Je steiler, desto weniger von oben. Eine Rampe, die
     zwischendurch zurückläuft, gäbe ein Band am Hang, in dem die
     Textur zweimal umschlägt.
*/
{
  const grade: number[] = [];
  for (let g = 0; g <= 90; g += 1) grade.push(g);
  // Eine Neigung in eine Normale: ny = cos, und der Rest auf die x-Achse.
  // Zusätzlich eine gedrehte Fassung (45° um y), damit auch der Fall
  // geprüft wird, in dem sich BEIDE Seitenprojektionen teilen.
  const normale = (grad: number, azimut: number): [number, number, number] => {
    const s = Math.sin((grad * Math.PI) / 180);
    return [s * Math.cos(azimut), Math.cos((grad * Math.PI) / 180), s * Math.sin(azimut)];
  };

  const summeAb: string[] = [];
  const flachAb: string[] = [];
  const monoAb: string[] = [];
  let vorigesOben = Number.POSITIVE_INFINITY;
  for (const g of grade) {
    for (const az of [0, Math.PI / 4, Math.PI / 2]) {
      const [nx, ny, nz] = normale(g, az);
      const [oben, sx, sz] = triplanarGewichte(nx, ny, nz);
      if (Math.abs(oben + sx + sz - 1) > 1e-9) summeAb.push(`${g}°/${az.toFixed(2)}: ${(oben + sx + sz).toFixed(9)}`);
      if (g < TRIPLANAR.beginn && (oben !== 1 || sx !== 0 || sz !== 0)) {
        flachAb.push(`${g}°: [${oben}, ${sx}, ${sz}]`);
      }
      if (oben < 0 || sx < 0 || sz < 0) summeAb.push(`${g}°: negatives Gewicht`);
    }
    // Monotonie auf der Achsenlage (azimut 0) — die anderen sind
    // dieselbe Rechnung mit umverteilten Seitenanteilen.
    const [oben] = triplanarGewichte(...normale(g, 0));
    if (oben > vorigesOben + 1e-12) monoAb.push(`${g}°: ${oben.toFixed(6)} > ${vorigesOben.toFixed(6)}`);
    vorigesOben = oben;
  }
  check('die drei Projektionsgewichte summieren sich auf 1', summeAb.length === 0, summeAb.slice(0, 4).join('; '));
  check(
    `unter ${TRIPLANAR.beginn}° ist das Gewicht exakt [1, 0, 0] — daran hängt „flacher Boden bitgleich"`,
    flachAb.length === 0,
    flachAb.slice(0, 4).join('; ')
  );
  check(
    'das Gewicht der Projektion von oben fällt monoton mit der Neigung',
    monoAb.length === 0,
    monoAb.slice(0, 4).join('; ')
  );

  // Die Rampe selbst: erst ab `beginn` überhaupt etwas, ab `voll` die
  // reine |N|^k-Verteilung. Bei 90° darf von oben nichts mehr kommen.
  const [obenBeginn] = triplanarGewichte(...normale(TRIPLANAR.beginn + 0.001, 0));
  const [obenSenkrecht, sxSenkrecht] = triplanarGewichte(...normale(90, 0));
  check(
    'die Seitenprojektionen blenden erst hinter der Schwelle ein',
    obenBeginn < 1 && obenBeginn > 0.999,
    `bei ${TRIPLANAR.beginn + 0.001}°: ${obenBeginn.toFixed(6)}`
  );
  check(
    'auf der senkrechten Wand kommt nichts mehr von oben',
    Math.abs(obenSenkrecht) < 1e-9 && Math.abs(sxSenkrecht - 1) < 1e-9,
    `[${obenSenkrecht.toFixed(9)}, ${sxSenkrecht.toFixed(9)}]`
  );
  check(
    'der Exponent hält den 45°-Fall aus der Mitte (sonst Matsch)',
    (() => {
      // Bei 45° und Azimut 0 stehen |N.y| und |N.x| gleich — die
      // Gewichte müssen sich dort zu gleichen Teilen aufteilen, und mit
      // steigendem Exponenten wird der Übergang schmaler. Geprüft wird,
      // dass bei 40° die Projektion von oben noch klar führt.
      const [oben40] = triplanarGewichte(...normale(40, 0));
      return oben40 > 0.6 && TRIPLANAR.schaerfe >= 4 && TRIPLANAR.schaerfe <= 8;
    })(),
    `oben bei 40° = ${triplanarGewichte(...normale(40, 0))[0].toFixed(3)}, k = ${TRIPLANAR.schaerfe}`
  );
  check(
    'die Schwelle liegt unter der Neigung, ab der die Hangkachel voll deckt',
    TRIPLANAR.beginn < RAMPEN.hang.voll && TRIPLANAR.beginn < TRIPLANAR.voll,
    `${TRIPLANAR.beginn}° / ${TRIPLANAR.voll}° gegen ${RAMPEN.hang.voll}°`
  );
}

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
  ── (h) Zwei Karten, eine Zahl: das Verhältnis Fels zu Moos ──────────

  Ein Dateiname beweist nicht, was in einer Zeile steht. Zwischen Quelle
  und Stapel liegt die Skalierung, und zwei vertauschte Zeilen sehen im
  `store-schichten.json` völlig richtig aus.

  Deshalb wird am GEBAUTEN Stapel gemessen: Über alle Texel und je Texel
  nach linear gewandelt stehen die zwei Karten des Vorbilds im Verhältnis
  0,08585 / 0,01799 = **4,77** (Hangfels Tile 5 zu Moos Tile 11). Das ist
  eine Eigenschaft der zwei Bilder, keine Look-Entscheidung — sie gilt
  unabhängig von Licht, Nebel und Grading, und sie fällt sofort unter 2,
  sobald eine der beiden Zeilen den alten Vertreter trägt.

  Läuft der Ersatz (Maschine ohne Quellbestand), ist das Verhältnis ein
  anderes und der Test sagt es, statt rot zu werden — dasselbe Muster wie
  bei (f)/(g).

  Gemessen über `spawnSync`, weil dieser Test synchron läuft: `tsx`
  übersetzt ihn nach CJS, und ein Top-Level-await ist dort nicht
  übersetzbar (die Begründung steht auch am Fuss des Werkzeugs).
*/
{
  const messProgramm = `
    const sharp = require('sharp');
    const K = 256, ZEILEN = 16;
    (async () => {
      const b = await sharp(process.argv[1]).raw().toBuffer();
      const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      const raus = {};
      for (const z of [1, 5, 11]) {
        let lr = 0, lg = 0, lb = 0;
        const off = z * K * K * 3, n = K * K;
        for (let p = 0; p < K * K * 3; p += 3) { lr += lin(b[off + p]); lg += lin(b[off + p + 1]); lb += lin(b[off + p + 2]); }
        raus[z] = 0.2126 * lr / n + 0.7152 * lg / n + 0.0722 * lb / n;
      }
      process.stdout.write(JSON.stringify(raus));
    })();
  `;
  const m = spawnSync(process.execPath, ['-e', messProgramm, join(AUS, 'store_d_array.png')], {
    cwd: WURZEL,
    encoding: 'utf-8',
  });
  let luma: Record<string, number> | null = null;
  try {
    luma = JSON.parse(m.stdout) as Record<string, number>;
  } catch {
    luma = null;
  }
  const moosGebaut =
    (tab.tiles.find((t) => t.quelle === 'moss')?.farbe ?? '') === 'terrain-moss-dark' &&
    (tab.tiles.find((t) => t.quelle === 'rock-rough')?.farbe ?? '') === 'terrain-rock-moss';
  if (!luma) {
    check('die Zeilen des Stapels lassen sich messen', false, m.stderr.slice(0, 200));
  } else {
    check(
      'Moos steht in Tile 1 und Tile 11 mit derselben Helligkeit',
      Math.abs(luma['1']! - luma['11']!) < 1e-4,
      `${luma['1']!.toFixed(5)} / ${luma['11']!.toFixed(5)}`
    );
    const v = luma['5']! / luma['11']!;
    if (moosGebaut) {
      check(
        'Hangfels zu Moos trifft das Verhältnis der zwei Karten des Vorbilds (4,77)',
        v > 4.3 && v < 5.2,
        `${v.toFixed(2)} (Tile 5 ${luma['5']!.toFixed(5)}, Tile 11 ${luma['11']!.toFixed(5)})`
      );
      check(
        'die Moosschicht liegt bei der linearen Luma des Vorbilds (0,0180)',
        luma['11']! > 0.016 && luma['11']! < 0.020,
        luma['11']!.toFixed(5)
      );
    } else {
      console.log(
        `     Hinweis: Ersatzkarte(n) im Stapel — Hangfels/Moos misst ${v.toFixed(2)} statt 4,77.`
      );
    }
  }
}

/*
  ── (e) Die sechs Zahlen der Himmels-Irradianz ─────────────────────
  Der Boden spiegelt seit dem 09.09.2026 nicht mehr EINEN Abtastwert des
  Verlaufs, sondern dessen Mittel über die Halbkugel (`HIMMEL_IRRADIANZ`).
  Sechs Konstanten, die niemand ansieht: Ein Vorzeichenfehler darin macht
  den Boden zu hell oder zu kalt, und beides sieht aus wie eine
  Geschmacksfrage.

  Geprüft wird nicht die Herleitung, sondern das Ergebnis — gegen eine
  stumpfe Summe über 20 000 Richtungen desselben Verlaufs, den
  `vhSkyGradient` in ValheimSky.ts zeichnet. Zwei Wege zur selben Zahl.
*/
function irradianzStumpf(ny: number): { wH: number; wZ: number } {
  // Kosinusgewichtete Halbkugel um N, N in der xy-Ebene bei Winkel a.
  const a = Math.acos(Math.max(-1, Math.min(1, ny)));
  const Nx = Math.sin(a), Ny = Math.cos(a);
  const N = 20_000;
  let sH = 0, sZ = 0, sW = 0;
  const gold = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * i + 1) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * gold;
    const dx = Math.cos(phi) * r, dy = y, dz = Math.sin(phi) * r;
    const cos = dx * Nx + dy * Ny;
    if (cos <= 0) continue;
    // vhSkyGradient: t = 1 − e^(−3,2·max(y,0)); col = mix(horizont, zenit, t)
    const t = 1 - Math.exp(-3.2 * Math.max(dy, 0));
    sH += (1 - t) * cos;
    sZ += t * cos;
    sW += cos;
    void dz;
  }
  // Normiert auf die Einstrahlung einer weissen Kuppel (Σcos), damit die
  // Summe der zwei Gewichte bei ny = 1 gerade 1,0 ergibt.
  return { wH: sH / sW, wZ: sZ / sW };
}
{
  const abw: string[] = [];
  for (const ny of [1, 0.9, 0.7, 0.5, 0.2, 0]) {
    const a = himmelIrradianzGewichte(ny);
    const b = irradianzStumpf(ny);
    // Die geschlossene Form ist eine SH-2-Näherung; 0,03 ist der Abstand,
    // den die abgeschnittenen Ordnungen im schlimmsten Fall lassen.
    if (Math.abs(a.wH - b.wH) > 0.03 || Math.abs(a.wZ - b.wZ) > 0.03) {
      abw.push(`ny=${ny.toFixed(1)}: ${a.wH.toFixed(3)}/${a.wZ.toFixed(3)} gegen ${b.wH.toFixed(3)}/${b.wZ.toFixed(3)}`);
    }
  }
  check(
    'die Himmels-Irradianz trifft die stumpfe Summe über den Kuppelverlauf',
    abw.length === 0,
    abw.join('; ')
  );
  const oben = himmelIrradianzGewichte(1);
  check(
    'ein flacher Boden bekommt genau eine weisse Kuppel (Summe der Gewichte = 1)',
    Math.abs(oben.wH + oben.wZ - 1) < 1e-3,
    (oben.wH + oben.wZ).toFixed(4)
  );
  check(
    'der flache Boden sieht ueberwiegend den Zenit, nicht den Horizont',
    oben.wZ > 4 * oben.wH,
    `${oben.wH.toFixed(4)} / ${oben.wZ.toFixed(4)}`
  );
  check(
    'die sechs Zahlen sind drei Paare',
    HIMMEL_IRRADIANZ.horizont.length === 3 && HIMMEL_IRRADIANZ.zenit.length === 3
  );
}

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
