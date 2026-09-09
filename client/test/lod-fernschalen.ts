/**
 * Das zweite Netz gegen die verschachtelten Fernstufen des Speichers
 * (Stufe 2, Integration) — `AssetManager.fernSchalen()`.
 *
 * Abgetragen werden die Schalen offline, in
 * `tools/store-vegetation-aufbereiten.mjs`. Diese Regel im Client ist nur
 * das Netz darunter: für einen Lauf mit `--lod-behalten`, für einen
 * Speicher, der nie aufbereitet wurde, und für neue Modelle, die niemand
 * durchs Werkzeug geschickt hat.
 *
 * Der Test hält vor allem EINEN Fehler fest, und zwar den, der beim
 * Bauen dieser Regel beinahe passiert wäre: die Stufe am NAMEN zu
 * erkennen. Der Speicher liefert dieselben Schalen auch als
 * eigenständige Prefabs — `massive-tree-1a1-lod-1.glb` enthält einzig
 * `Massive_Tree_1A1_LOD_1` (9.185 Dreiecke), `pine-1b1-1.glb` einzig
 * `Pine_1B1_1`. Beide sind ein absichtlich billiger Fernbaum zum Setzen.
 * Ein `/_LOD_?\d/i` über den Namen hätte sie LEER gerendert — ohne
 * Fehler, ohne Absturz und ohne dass ein Test rot geworden wäre. Die
 * Fälle 3 und 4 unten sind genau diese beiden Dateien, mit den Namen aus
 * `tools/berichte/store-vegetation-bericht.json`.
 *
 * Geprüft wird über die ECHTE Funktion gegen echte Babylon-Meshes auf
 * der NullEngine — keine GPU, kein `assets/`, keine GLB.
 *
 *   npx tsx client/test/lod-fernschalen.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { fernSchalen, lodStufeAusName } from '../src/engine/AssetManager';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);

/** Ein Würfel mit Kantenlänge `groesse` am Ursprung. */
function wuerfel(name: string, groesse: number, elternteil?: Mesh): Mesh {
  const m = MeshBuilder.CreateBox(name, { size: groesse }, scene);
  if (elternteil) m.parent = elternteil;
  m.computeWorldMatrix(true);
  return m;
}

/** Die Namen, die `fernSchalen()` abschalten will. */
const namen = (s: Set<Mesh>): string[] => [...s].map((m) => m.name).sort();

// ── 1. Die Stufenerkennung am Namen ──────────────────────────────────
// Sie ist für sich genommen noch keine Entscheidung — sie liefert nur
// die erste der drei Bedingungen.
check('`Tree_1E1_1` ist Stufe 1 unter dem Stamm `Tree_1E1`', (() => {
  const t = lodStufeAusName('Tree_1E1_1');
  return t?.stufe === 1 && t.stamm === 'Tree_1E1';
})());
check('`Massive_Tree_1A1_LOD_1` wird als Stufe 1 gelesen', (() => {
  const t = lodStufeAusName('Massive_Tree_1A1_LOD_1');
  return t?.stufe === 1 && t.stamm === 'Massive_Tree_1A1';
})());
check('`SM_Env_Grass_Short_Clump_01_LOD0` ist Stufe 0 (die Nahstufe)', (() => {
  const t = lodStufeAusName('SM_Env_Grass_Short_Clump_01_LOD0');
  return t?.stufe === 0;
})());
// `Tree_1E1` endet auf eine Ziffer, behauptet aber keine Stufe: Die
// Ziffer hängt nicht an einem Unterstrich. Läse die Regel sie als Stufe,
// verschwände die NAHSTUFE statt der Fernstufe.
check('`Tree_1E1` behauptet keine Stufe', lodStufeAusName('Tree_1E1') === null);
// `_primitiveN` hängt der glTF-Lader an, wenn ein Mesh mehrere Primitive
// hat. Als Stufe gelesen wäre jedes zweite Primitiv eine „Fernstufe".
check(
  '`_primitive1` ist keine Stufe',
  lodStufeAusName('Tree_1E1_primitive1') === null,
  JSON.stringify(lodStufeAusName('Tree_1E1_primitive1'))
);

// ── 2. Der Regelfall: verschachtelte Schalen fallen ───────────────────
// `Tree_1E1` hält `Tree_1E1_1` und `Tree_1E1_2` als Kinder, beide
// kleiner. Genau die Bauart, die im Speicher ein Viertel aller Dreiecke
// kostet.
{
  const nah = wuerfel('Tree_1E1', 10);
  const fern1 = wuerfel('Tree_1E1_1', 9, nah);
  const fern2 = wuerfel('Tree_1E1_2', 8, nah);
  const raus = fernSchalen([nah, fern1, fern2]);
  check(
    'verschachtelte Stufen 1 und 2 fallen, die Nahstufe bleibt',
    raus.size === 2 && !raus.has(nah),
    namen(raus).join(',')
  );
}

// ── 3. `massive-tree-1a1-lod-1.glb` — die Schale ALLEIN in der Datei ──
// Der Fall, an dem eine Namensregel das Modell leer gerendert hätte.
{
  const allein = wuerfel('Massive_Tree_1A1_LOD_1', 10);
  const sub = wuerfel('SubMesh_1', 10, allein);
  const raus = fernSchalen([allein, sub]);
  check(
    'die eigenständige Fernstufe bleibt stehen (massive-tree-1a1-lod-1)',
    raus.size === 0,
    namen(raus).join(',')
  );
}

// ── 4. `pine-1b1-1.glb` — dasselbe mit blosser Ziffer ────────────────
{
  const allein = wuerfel('Pine_1B1_1', 4);
  const raus = fernSchalen([allein]);
  check('die eigenständige `Pine_1B1_1` bleibt stehen', raus.size === 0, namen(raus).join(','));
}

// ── 5. Geschwister nur bei AUSDRÜCKLICHEM `_LOD` ─────────────────────
// Der Grasbüschel des Speichers legt seine Stufen nebeneinander, nicht
// ineinander — dort muss die Regel greifen.
{
  const wurzel = wuerfel('clump-root', 20);
  const nah = wuerfel('SM_Env_Grass_Short_Clump_01_LOD0', 2, wurzel);
  const fern = wuerfel('SM_Env_Grass_Short_Clump_01_LOD1', 1.8, wurzel);
  const raus = fernSchalen([wurzel, nah, fern]);
  check(
    'ausdrückliches `_LOD1` fällt auch als Geschwister',
    raus.size === 1 && raus.has(fern),
    namen(raus).join(',')
  );
}

// ── 6. VARIANTEN sind keine Stufen ───────────────────────────────────
// Der Speicher nummeriert auch Varianten: `SM_Plant_Mushrooms_01` und
// `_02` sind zwei Pflanzen, nicht zwei Entfernungen. Sie stehen
// nebeneinander und tragen keine ausdrückliche Stufe — die Regel muss
// beide behalten, selbst wenn die eine in die Hüllbox der anderen passt.
{
  const wurzel = wuerfel('mushrooms', 20);
  const a = wuerfel('SM_Plant_Mushrooms_01', 3, wurzel);
  const b = wuerfel('SM_Plant_Mushrooms_02', 2, wurzel);
  const raus = fernSchalen([wurzel, a, b]);
  check(
    'Varianten als Geschwister ohne `_LOD` bleiben beide',
    raus.size === 0,
    namen(raus).join(',')
  );
}

// ── 7. Die Hüllbox entscheidet mit ───────────────────────────────────
// Ein Kind, das GRÖSSER ist als sein Elternteil, ist keine Fernstufe —
// es ist ein Ast, eine Wurzel oder ein Anbau. Ohne diese Bedingung
// verlöre das Modell Geometrie, die niemand ersetzt.
{
  const nah = wuerfel('Tree_1B2', 5);
  const groesser = wuerfel('Tree_1B2_1', 9, nah);
  const raus = fernSchalen([nah, groesser]);
  check(
    'ein Kind ausserhalb der Hüllbox fällt nicht',
    raus.size === 0,
    namen(raus).join(',')
  );
}

// ── 8. Der aufbereitete Normalfall kostet nichts ─────────────────────
// Nach dem Werkzeug gibt es keine Schalen mehr; die Regel muss dann ein
// leeres Set liefern, ohne Hüllboxen zu rechnen.
{
  const a = wuerfel('rinde-nadel', 10);
  const b = wuerfel('laub', 10, a);
  const raus = fernSchalen([a, b]);
  check('aufbereitete Datei: nichts abzuschalten', raus.size === 0, namen(raus).join(','));
}

scene.dispose();
engine.dispose();

console.log(fehler === 0 ? '\nalles grün' : `\n${fehler} Fehlschläge`);
process.exit(fehler === 0 ? 0 : 1);
