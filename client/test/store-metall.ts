/**
 * Store-Materialien bleiben unmetallisch (Stufe 2, Bauer „Leistung").
 *
 * `AssetManager.setzeMetallgrad` leitet den Metallgrad aus dem
 * MATERIALNAMEN ab. Das ist für den alten Fremdexport richtig — dort ist
 * der `_Metallic`-Wert beim Rippen verlorengegangen und der Name die
 * einzige verbliebene Auskunft. Für den Store ist es falsch: Seine GLBs
 * tragen ihren `metallicFactor` selbst, und er ist überall 0 (Synty
 * POLYGON arbeitet ohne Metall).
 *
 * Angewandt richtet die Regel dort nur Schaden an. Das Labor hat keine
 * `scene.environmentTexture`; ein vollmetallisches Material hat also
 * nichts zu spiegeln und rendert nahezu SCHWARZ.
 *
 * WIE VIELE es trifft, ist nachgezählt und kleiner als erwartet: Der
 * Store führt 58 verschiedene Materialnamen, und genau ZWEI treffen die
 * Regel — `SM_Item_Crystal_04` (Kristall) und
 * `Metal_PolygonFantasyKingdom_Mat_01_A 5` (Ring). Die Erwartung, es gehe
 * auch um „sämtliche `sm-wep-sword-*`", geht daneben: Die Regel liest
 * MATERIALnamen, und die Waffen des Stores tragen den Palettennamen ihres
 * Atlas, in dem „sword" nicht vorkommt. Zwei schwarze Requisiten sind
 * trotzdem zwei zu viel — und die Zahl bleibt nur so lange klein, wie
 * niemand ein Material `Sword_…` nachimportiert. Genau deshalb zählt
 * dieser Test sie jedes Mal neu, statt sie festzuschreiben.
 *
 * Der Fehler wäre lautlos: keine Meldung, kein fehlendes Bild, nur ein
 * schwarzes Schwert, das nach einer fehlenden Textur aussieht — genau so
 * ist es beim Kupfererz-Brocken schon einmal gemeldet worden.
 *
 * Geprüft wird an der ECHTEN Klasse gegen die ECHTEN Materialnamen des
 * Stores (aus `assets/store` (rekursiv) gelesen), nicht gegen eine
 * Nachbildung. NullEngine, keine GPU.
 *
 *   npx tsx client/test/store-metall.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetManager, istStoreModell } from '../src/engine/AssetManager';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = join(WURZEL, 'assets/store');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Die Pfadregel ────────────────────────────────────────────────────
check('store/… gilt als Store-Modell', istStoreModell('store/environment/sm-prop-anvil-01'));
check('store-lab/… gilt als Store-Modell', istStoreModell('store-lab/vegetation/tree-1e1'));
check('ein Altbestandsmodell gilt NICHT als Store-Modell', !istStoreModell('BirkeHoch1'));
// Die Regel darf nicht am blossen Vorkommen hängen: ein eigenes Modell,
// das zufällig „store" im Namen trägt, ist keines.
check('„…store…" mitten im Namen zählt nicht', !istStoreModell('Vorratsstore/Kiste'));
check('ein generiertes Modul zählt nicht', !istStoreModell('Gen_Saal_01'));

// ── Der Durchlauf durch die echte Klasse ─────────────────────────────
const engine = new NullEngine();
const scene = new Scene(engine);
const assets = new AssetManager(scene);

/**
 * `setzeMetallgrad` ist privat — und soll es bleiben. Aufgerufen wird
 * deshalb über `fixupMaterial`, also über den Weg, den auch der Lader
 * nimmt. Damit misst dieser Test die Verdrahtung mit und nicht nur die
 * Formel: Wer `setzeMetallgrad` künftig ohne Modellnamen aufriefe,
 * bekäme hier Rot.
 */
async function metallNach(materialName: string, modellName: string): Promise<number> {
  const mat = new PBRMaterial(materialName, scene);
  mat.metallic = 0; // wie der glTF-Lader es aus `metallicFactor: 0` setzt
  await (
    assets as unknown as {
      fixupMaterial(m: PBRMaterial, modell: string): Promise<void>;
    }
  ).fixupMaterial(mat, modellName);
  return mat.metallic ?? -1;
}

// Die Gegenprobe zuerst: Für den Altbestand MUSS die Namensregel weiter
// greifen. Ein Test, der nur das Ausschalten prüft, wäre auch dann grün,
// wenn jemand `setzeMetallgrad` ganz entfernt.
check(
  'Altbestand: ein Metallname wird weiterhin metallisch',
  (await metallNach('blackmetalsword', 'SwordIron')) === 1
);
check(
  'Altbestand: Fels schlägt Metall weiterhin',
  (await metallNach('rock1_copper', 'MineRock')) === 0
);

// ── Und nun der Store, mit seinen ECHTEN Materialnamen ───────────────
if (!existsSync(STORE)) {
  console.error('assets/store fehlt — Weiche in run-tests.mjs (brauchtModelle).');
  process.exit(1);
}

/** Alle Materialnamen aller GLB unter assets/store, ohne Engine gelesen. */
function storeMaterialien(): Array<{ material: string; modell: string }> {
  const aus: Array<{ material: string; modell: string }> = [];
  const gehe = (ort: string, praefix: string): void => {
    for (const name of readdirSync(ort, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const voll = join(ort, name.name);
      if (name.isDirectory()) {
        gehe(voll, `${praefix}${name.name}/`);
        continue;
      }
      if (!name.name.endsWith('.glb')) continue;
      const buf = readFileSync(voll);
      if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) continue;
      const jsonLen = buf.readUInt32LE(12);
      const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
      for (const m of json.materials ?? []) {
        aus.push({ material: m.name ?? '', modell: `store/${praefix}${name.name.replace(/\.glb$/, '')}` });
      }
    }
  };
  gehe(STORE, '');
  return aus;
}

const alle = storeMaterialien();
check(`Store gelesen (${alle.length} Materialien in assets/store)`, alle.length > 100);

/*
  Nicht alle, sondern die GEFÄHRLICHEN: Materialien, deren Name die
  Metallregel überhaupt trifft. Sie sind der ganze Punkt — für die
  übrigen wäre der Test auch ohne die Änderung grün und bewiese nichts.
*/
const METALLISCH_NAME =
  /metal|iron|bronze|silver|copper|flametal|anvil|forge|cauldron|coin|crystal|sword|axe|mace|atgeir|arbalest|shield|armor|helm|chitin|marble|obsidian/i;
const FELSIG_NAME = /rock|stone|cliff/i;
const gefaehrlich = alle.filter((m) => METALLISCH_NAME.test(m.material) && !FELSIG_NAME.test(m.material));
check(
  `es gibt Store-Materialien, welche die Metallregel treffen würde (${gefaehrlich.length})`,
  gefaehrlich.length > 0,
  'ohne sie prüfte dieser Test nichts'
);

const schuldige: string[] = [];
for (const { material, modell } of gefaehrlich) {
  if ((await metallNach(material, modell)) !== 0) schuldige.push(`${material} (${modell})`);
}
check(
  `kein Store-Material wird metallisch (${gefaehrlich.length} geprüft)`,
  schuldige.length === 0,
  schuldige.slice(0, 8).join(', ')
);

// Namentlich, damit im Bericht steht, worum es ging.
for (const name of ['Metal_PolygonFantasyKingdom_Mat_01_A 5', 'SM_Item_Crystal_04']) {
  const treffer = alle.find((m) => m.material === name);
  if (!treffer) continue;
  check(`„${name}" bleibt metallic 0`, (await metallNach(name, treffer.modell)) === 0);
}
// Und dasselbe Material aus dem aufbereiteten Ordner.
check(
  'dasselbe über store-lab/',
  (await metallNach('Metal_PolygonFantasyKingdom_Mat_01_A 5', 'store-lab/vegetation/tree-1e1')) === 0
);

scene.dispose();
engine.dispose();
console.log(fehler === 0 ? '\nalles grün' : `\n${fehler} Fehlschläge`);
process.exit(fehler === 0 ? 0 : 1);
