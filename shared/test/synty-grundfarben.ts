/**
 * Die Grundfarben der Speicher-Materialien — Tabelle, Regeln und die
 * VERDRAHTUNG bis ins echte `PBRMaterial`.
 *
 * Warum die Verdrahtung mitgeprüft wird und nicht nur die Tabelle: Eine
 * Farbtabelle, die niemand aufruft, ist grün und wirkungslos. Der Test
 * legt deshalb ein echtes `PBRMaterial` auf einer `NullEngine` an und
 * misst die `albedoColor` NACH dem Aufruf — dieselbe Bauart wie
 * `client/test/figur-toenung.ts`.
 *
 * Was er NICHT kann: den Speicher lesen. `assets/store/` liegt ausserhalb
 * des Repos, im CI-Checkout gibt es ihn nicht. Die Modellpfade unten
 * stehen deshalb als Konstanten hier — sie sind Dateinamen des Speichers,
 * nachgeschlagen am 12.09.2026, und die Positiv-/Negativlisten sind der
 * eigentliche Gegenstand: An ihnen entscheidet sich, ob die Fels-Gruppe
 * eine Landschaft oder ein halbes Dorf abdunkelt.
 *
 * Lauf:  npx tsx shared/test/synty-grundfarben.ts
 */

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import {
  FELS_GRUNDFARBE,
  SYNTY_GRUNDFARBE,
  istFelsModell,
  syntyGrundfarbe,
} from '../src/syntyGrundfarben.js';
import { toeneStoreMaterial, toeneStoreMeshes } from '../../client/src/engine/StoreToenung.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  OK   ${was}`);
  } else {
    fehler++;
    console.error(`  ROT  ${was}`);
  }
}

const nah = (a: number, b: number, eps = 1e-4): boolean => Math.abs(a - b) <= eps;

// ── (a) Die Tabelle selbst ───────────────────────────────────────────
console.log('(a) Tabelle: Wertebereich und die Regel „1/1/1 heisst nicht anfassen"');
for (const [name, farbe] of Object.entries(SYNTY_GRUNDFARBE)) {
  pruefe(
    farbe.length === 3 && farbe.every((v) => v > 0 && v <= 1),
    `${name}: drei Kanaele in (0…1]`
  );
  pruefe(
    !(farbe[0] === 1 && farbe[1] === 1 && farbe[2] === 1),
    `${name}: steht nicht auf 1/1/1 (solche Zeilen gehoeren gar nicht in die Tabelle)`
  );
}
pruefe(
  Object.keys(SYNTY_GRUNDFARBE).length === 14,
  `die Tabelle fuehrt 14 Materialnamen (gezaehlt: ${Object.keys(SYNTY_GRUNDFARBE).length})`
);

// ── (b) Vegetation bleibt draussen ───────────────────────────────────
console.log('\n(b) Vegetation: weder in der Tabelle noch ueber den Pfad erreichbar');
/**
 * Die Materialnamen, die `tools/store-vegetation-aufbereiten.mjs` in den
 * abgeleiteten Ordner schreibt (aus `assets/store-lab/vegetation/
 * BERICHT.json`, Lauf vom 12.09.2026). Kollidierte ein Tabellenschluessel
 * mit einem davon, bekaeme ein schon getoentes Laubmaterial einen zweiten
 * Faktor — genau die Doppelung, die die Datei ausschliesst.
 */
const AUFBEREITETE_MATERIALIEN = [
  'ahorn', 'gras', 'grasBunt', 'grasGelb', 'grasSchnee', 'laub', 'laubDunkel',
  'laubSchnee', 'nadeln', 'pilz', 'rinde-birke', 'rinde-eiche', 'rinde-nadel',
] as const;
for (const name of AUFBEREITETE_MATERIALIEN) {
  pruefe(
    !Object.prototype.hasOwnProperty.call(SYNTY_GRUNDFARBE, name),
    `das aufbereitete Material \`${name}\` steht NICHT in der Tabelle`
  );
}
/** Die vier Rindenfaktoren des Speichers — bewusst weggelassen. */
for (const name of ['Trunks', 'Oak_Bark_A', 'Oak_Bark_A 2 Dark', 'Birch_Bark_A']) {
  pruefe(
    !Object.prototype.hasOwnProperty.call(SYNTY_GRUNDFARBE, name),
    `der Rindenfaktor \`${name}\` steht NICHT in der Tabelle (die Aufbereitung toent schon)`
  );
}
pruefe(
  syntyGrundfarbe('Lit', 'store/vegetation/tree-1e1') === null,
  'ein Tabellenname auf einem Vegetationspfad wird trotzdem nicht getoent'
);
pruefe(
  syntyGrundfarbe('Lit', 'store-lab/vegetation/tree-1e1') === null,
  'dasselbe im abgeleiteten Ordner `store-lab/vegetation/`'
);

// ── (c) Die Fels-Gruppe: was dazugehoert und was nicht ───────────────
console.log('\n(c) Fels-Gruppe: Landschaft ja, Bauwerk und Requisite nein');
/** Landschaftsfels — bekommt den Gruppenwert, wenn kein Tabelleneintrag greift. */
const FELS_JA = [
  'store/environment/sm-env-rock-01',
  'store/environment/sm-env-rock-chunk-03-1',
  'store/environment/sm-env-rock-cliff-02-1',
  'store/environment/sm-env-rock-spike-02',
  'store/environment/sm-env-rock-round-04',
  'store/environment/sm-env-rock-pebble-02-1',
  'store/environment/sm-env-stone-01',
  'store/environment/sm-env-stone-02-snow',
  'store/environment/sm-env-glacier-01',
  'store/environment/sm-env-rubble-pebbles-03',
];
/**
 * Gleicher Wortstamm, anderes Ding. Jede dieser Dateien liegt im
 * Speicher; keine ist Landschaft. Wuerde die Regel sie mitnehmen,
 * duenkelte sie Requisiten ab — und die stehen in den Quelldaten zu
 * 93,8 % auf 1/1/1.
 */
const FELS_NEIN = [
  'store/environment/sm-env-stonewall-01',
  'store/environment/sm-env-stonewall-pillar-01',
  'store/environment/sm-env-stone-throne-01',
  'store/environment/sm-env-house-rocks-large-01',
  'store/environment/sm-prop-path-rock-group-03',
  'store/environment/sm-prop-table-stone-03',
  'store/environment/sm-prop-grinding-wheel-01-stone',
  'store/environment/sm-bld-house-chimney-stone-01',
  'store/environment/sm-item-rock-01',
];
for (const pfad of FELS_JA) pruefe(istFelsModell(pfad), `Landschaftsfels: ${pfad}`);
for (const pfad of FELS_NEIN) pruefe(!istFelsModell(pfad), `kein Landschaftsfels: ${pfad}`);
pruefe(
  !istFelsModell('assets/models/rock1_copper'),
  'ein Altbestandsmodell faellt nicht in die Gruppe (der Speicherpfad entscheidet)'
);

console.log('\n(c2) Der Gruppenwert greift dort, wo die Tabelle schweigt');
const felsGruppe = syntyGrundfarbe('Dungeon_Material_01', 'store/environment/sm-env-rock-chunk-03-1');
pruefe(
  felsGruppe !== null && felsGruppe.every((v, i) => nah(v, FELS_GRUNDFARBE[i])),
  '`Dungeon_Material_01` auf einem Findling bekommt den Gruppenwert 0,466/0,425/0,378'
);
pruefe(
  syntyGrundfarbe('Dungeon_Material_01', 'store/environment/sm-env-dungeon-entrance-01') === null,
  'dasselbe Material auf einem Nicht-Felsmodell bleibt unberuehrt (es steht dort auf 1/1/1)'
);
pruefe(
  syntyGrundfarbe('PolyVikings_Material_01', 'store/environment/sm-env-rock-cliff-01') !== null,
  '`PolyVikings_Material_01` auf einer Klippe bekommt den Gruppenwert'
);

// ── (d) Werkgetreu schlaegt Gruppe ───────────────────────────────────
console.log('\n(d) Vorrang: die gemessene Zeile schlaegt den Gruppenwert');
const kiesel = syntyGrundfarbe('PolygonFantasyKingdom_Mat_01_A 3', 'store/environment/sm-env-rock-pebble-02-1');
pruefe(
  kiesel !== null && nah(kiesel[0], 0.7),
  'der helle Kiesel behaelt 0,700 statt 0,466 (sonst faehrt die Gruppe ueber die Messung)'
);
const eis = syntyGrundfarbe('Ice', 'store/environment/sm-env-glacier-01');
pruefe(
  eis !== null && nah(eis[0], 0.851),
  'Gletschereis behaelt 0,851, obwohl `glacier-01` in der Fels-Gruppe steht'
);

console.log('\n(e) Alles ausserhalb des Speichers bleibt unberuehrt');
pruefe(syntyGrundfarbe('Lit', 'BirkeHoch1') === null, 'Altbestandsmodell');
pruefe(syntyGrundfarbe('Lit', 'Gen_Saal_01') === null, 'erzeugtes Modul');
pruefe(
  syntyGrundfarbe('EinNameOhneZeile', 'store/environment/sm-prop-barrel-03') === null,
  'Requisite ohne Tabellenzeile — keine pauschale Abdunklung'
);

// ── (f) Verdrahtung bis ins PBRMaterial ──────────────────────────────
console.log('\n(f) Verdrahtung: der Faktor kommt im Material an');
const engine = new NullEngine();
const scene = new Scene(engine);

const mat = new PBRMaterial('PolygonFantasyKingdom_Mat_01_A 2', scene);
pruefe(
  mat.albedoColor.r === 1 && mat.albedoColor.g === 1 && mat.albedoColor.b === 1,
  'frisches PBRMaterial steht auf 1/1/1 (der Zustand, den die GLB liefert)'
);
const getroffen = toeneStoreMaterial(mat, 'store/environment/sm-env-rock-chunk-03-1');
pruefe(getroffen, 'toeneStoreMaterial meldet „getoent"');
pruefe(
  nah(mat.albedoColor.r, 0.466) && nah(mat.albedoColor.g, 0.4245) && nah(mat.albedoColor.b, 0.3784),
  `albedoColor steht auf 0,466/0,4245/0,3784 (gemessen: ${mat.albedoColor.r}/${mat.albedoColor.g}/${mat.albedoColor.b})`
);

console.log('\n(f2) GESETZT, nicht multipliziert — der Fehler, der von der Ladereihenfolge abhaengt');
for (let i = 0; i < 5; i++) toeneStoreMaterial(mat, 'store/environment/sm-env-rock-chunk-03-1');
pruefe(
  nah(mat.albedoColor.r, 0.466),
  `fuenf weitere Aufrufe aendern nichts (gemessen: ${mat.albedoColor.r}) — multipliziert stuende hier ${(0.466 ** 6).toFixed(5)}`
);

console.log('\n(f3) Fremdes bleibt fremd');
const fremd = new PBRMaterial('PolygonFantasyKingdom_Mat_01_A 2', scene);
pruefe(
  !toeneStoreMaterial(fremd, 'BirkeHoch1') && fremd.albedoColor.r === 1,
  'derselbe Materialname an einem Altbestandsmodell bleibt auf 1/1/1'
);
const standard = new StandardMaterial('PolygonFantasyKingdom_Mat_01_A 2', scene);
pruefe(
  !toeneStoreMaterial(standard, 'store/environment/sm-env-rock-01'),
  'ein StandardMaterial wird nicht angefasst (es hat kein albedoColor)'
);
pruefe(!toeneStoreMaterial(null, 'store/environment/sm-env-rock-01'), 'null stuerzt nicht ab');

console.log('\n(f4) toeneStoreMeshes zaehlt MATERIALIEN, nicht Meshes');
const geteilt = new PBRMaterial('Dungeon_Material_01', scene);
const eigen = new PBRMaterial('PolygonFantasyKingdom_Mat_01_A 2', scene);
const meshes = [0, 1, 2, 3].map((i) => new Mesh(`teil${i}`, scene));
meshes[0].material = geteilt;
meshes[1].material = geteilt;
meshes[2].material = geteilt;
meshes[3].material = eigen;
const n = toeneStoreMeshes(meshes, 'store/environment/sm-env-rock-chunk-03-1');
pruefe(n === 2, `vier Meshes auf zwei Materialien melden 2 (gemessen: ${n})`);
pruefe(
  nah(geteilt.albedoColor.r, 0.466) && nah(eigen.albedoColor.r, 0.466),
  'beide Materialien tragen den Faktor'
);
const nochmal = toeneStoreMeshes(meshes, 'store/environment/sm-env-rock-chunk-03-1');
pruefe(
  nochmal === 2 && nah(geteilt.albedoColor.r, 0.466),
  'ein zweiter Lauf ueber dieselben Meshes aendert die Farbe nicht (die zwei Ladewege duerfen sich ueberschneiden)'
);

// ── (g) Die Zahl, gegen die eingebaut wurde ──────────────────────────
console.log('\n(g) Nachrechnung: aus dem gemessenen Sockel folgt die Ziel-Luma');
/*
  Gemessen am 12.09.2026 an der Pose `hanghimmel` (10111/−18649), Uhr
  12:00, Findling `SM_Env_Rock_Chunk_03 1` in 14,8 m, Maske 912 493 px
  (`gf-sockel2.mjs`, `gf-nachweis.mjs`):

    albedoColor 1/1/1   sRGB-Luma 85,23   linear 0,09026
    albedoColor 0/0/0   sRGB-Luma 30,66   linear 0,00980

  Der Rest bei Albedo 0 ist KEIN Fehler, sondern die dielektrische
  Grundreflexion des PBR-Materials (F0 = 0,04): `metallicF0Factor = 0`
  loescht ihn auf Luma 0,25, `environmentIntensity = 0` halbiert ihn,
  Lichter aus nimmt den Rest. Grading, Bloom, Nebel und Belichtung haben
  daran keinen Anteil — gemessen, je einzeln abgeschaltet.

  Daraus folgt das Modell: der DIFFUSE Anteil skaliert mit dem Faktor,
  der Spiegelungssockel bleibt stehen. Linear gerechnet (Babylon
  linearisiert mit pow(x, 2,2), nicht mit der exakten sRGB-EOTF):

    linear(neu) = (0,09026 − 0,00980) · L(Faktor) + 0,00980

  Der Test rechnet das nach und haelt es gegen die 62,0, die am Bild
  gemessen wurden. Er wird rot, wenn jemand FELS_GRUNDFARBE verstellt,
  ohne die Messung zu wiederholen.
*/
const LIN_VOLL = 0.09026;
const LIN_SOCKEL = 0.0098;
const GEMESSEN_NACHHER = 62.0;
const linLuma = (f: readonly [number, number, number]): number =>
  0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
const lf = linLuma(FELS_GRUNDFARBE);
pruefe(nah(lf, 0.4304, 5e-4), `lineare Luma des Gruppenfaktors ist 0,4304 (gerechnet: ${lf.toFixed(4)})`);
const vorhergesagt = 255 * ((LIN_VOLL - LIN_SOCKEL) * lf + LIN_SOCKEL) ** (1 / 2.2);
pruefe(
  Math.abs(vorhergesagt - GEMESSEN_NACHHER) < 1.5,
  `das Modell sagt Luma ${vorhergesagt.toFixed(1)} voraus, gemessen wurden ${GEMESSEN_NACHHER}`
);
pruefe(
  vorhergesagt >= 51 && vorhergesagt <= 76,
  `und das liegt im Zielband 51–76 (Stufe C waere ${(255 * ((LIN_VOLL - LIN_SOCKEL) * linLuma([0.271, 0.247, 0.22]) + LIN_SOCKEL) ** (1 / 2.2)).toFixed(1)})`
);
/** Der Sockel in sRGB sieht dreimal so gross aus wie er ist. */
pruefe(
  nah(LIN_SOCKEL / LIN_VOLL, 0.109, 5e-3),
  `der Sockel traegt linear 10,9 % bei — in sRGB sind es 36,0 %, und das ist die Kurve, nicht das Licht`
);

scene.dispose();
engine.dispose();

console.log(fehler === 0 ? '\nAlles grün.' : `\n${fehler} Prüfung(en) ROT.`);
process.exit(fehler === 0 ? 0 : 1);
