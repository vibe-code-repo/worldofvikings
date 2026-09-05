#!/usr/bin/env node
// Prüft: dass jedes Fels-Wandmodul ein `_col`-Netz hat — und dass es glatt ist.
/*
  ── Warum es diesen Prüfer gibt (Mass A, 05.09.2026) ──────────────────
  Mikes Befund: Die Felswand im Spiel sieht viel weniger grob aus als das
  Tripo-Modell, von dem sie abgeformt ist. Der grösste Einzelposten war
  eine Klemme, die gar nichts mit Gestein zu tun hatte: Das sichtbare Netz
  WAR die Kollisionsform, jede Kluft also eine Stelle, an der die
  Spielerkapsel (Radius 0,4 m, Stufe ≤ 9 cm) hängen bleibt. Deshalb war
  das Relief auf 9 cm gedeckelt.

  Seither trägt jedes Fels-Wandmodul ein `_col`-Netz: eine GLATTE Fläche
  auf der Wandflucht (`make-stonevault.py`, `baue()`). Das Relief steht
  rein optisch dahinter und darf 18 cm tief sein.

  Diese Vereinbarung hat eine unangenehme Eigenschaft: **Ein Vergessen hat
  kein Symptom, das man sieht.** Fällt das `_col`-Netz aus einer GLB
  heraus, sieht die Wand aus wie vorher — sie fängt nur an, die Figur
  festzuhalten, und zwar an einer zufälligen Kluft in einem zufälligen
  Grab. Genau deshalb steht die 18 in `felsrelief.py` NICHT allein: Sie
  ist nur belegt, solange dieser Prüfer grün ist.

  ── Was gemessen wird ─────────────────────────────────────────────────
  Gegen die AUSGELIEFERTEN GLBs unter `assets/models`, mit demselben
  Werkzeug wie `kit-neubau.mjs` (`measure-glb.py`, Blender headless):

    (1) Jedes Modul mit Fels-Frontschicht hat genau ein `<Name>_col`-Mesh
        mit dem Materialslot `Kollision` (die Namensregel des Clients:
        `AssetManager.NUR_KOLLISION_NAME`).
    (2) Die Hüllbox des `_col`-Netzes ist die des sichtbaren Netzes. Steht
        es weiter vor, kollidiert die Figur vor der Wand; steht es zurück,
        läuft sie in die Wand hinein.
    (3) Das `_col`-Netz ist DICKER als das sichtbare — sein signiertes
        Volumen ist dem Betrag nach grösser. Das ist die eigentliche
        Aussage „glatt statt gebrochen": Die Kollisionsform füllt die
        Klüfte aus, statt ihnen zu folgen. Ein `_col`, das aus dem
        Höhenfeld gebacken wäre (der Fehler, gegen den das hier steht),
        hätte dasselbe Volumen wie das Bild.
    (4) Es bleibt WENIGE Dreiecke gross (Havok fasst sie jedes Bild an).
    (5) Module OHNE Frontschicht (Zelle, Säle) haben KEIN `_col` — sonst
        wäre irgendwo ein Netz entstanden, das niemand bestellt hat.
    (6) Das Ziegelkit `DG_StoneVault` hat weiterhin genau EIN `_col`, das
        der Treppe. Es ist ausgeliefert und darf sich nicht rühren.

  Aufruf: node tools/elements/pruefung/fels-kollision.mjs
  Braucht Blender (Flatpak) und `assets/models`.

  Checks that every rock wall module ships a smooth `_col` collision mesh.
*/
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../../..');
const MESSER = join(HIER, 'measure-glb.py');
const MODELLE = join(WURZEL, 'assets', 'models');

/** Die Fels-Module MIT Frontschicht — genau sie brauchen ein `_col`. */
const MIT_SCHICHT = [
  'RockVaultWall',
  'RockVaultWallB',
  'RockVaultWallC',
  'RockVaultCorridor',
  'RockVaultCorner',
  'RockVaultJunction',
  'RockVaultArch',
];
/** Die Treppe hat ihr eigenes, handgeschriebenes Netz (Rampe unter den Stufen). */
const TREPPE = 'RockVaultStairs';
/** Kein Wandstück, also auch kein `_col`. */
const OHNE_SCHICHT = [
  'RockVaultCell',
  'RockVaultHall',
  'RockVaultHallLarge',
  'RockVaultHallLong',
  'RockVaultHallGrand',
  'RockVaultHallVast',
];
/** Havok fasst jedes dieser Dreiecke jedes Bild an. */
const KOLL_BUDGET = 600;

let fehler = 0;
const pruefe = (name, ok, hinweis = '') => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    fehler += 1;
    console.log(`  FAIL ${name}${hinweis ? ` — ${hinweis}` : ''}`);
  }
};

const fehlend = [...MIT_SCHICHT, TREPPE, ...OHNE_SCHICHT, 'StoneVaultStairs', 'StoneVaultWall']
  .map((n) => join(MODELLE, `${n}.glb`))
  .filter((p) => !existsSync(p));
if (fehlend.length > 0) {
  console.log(`FEHLGESCHLAGEN: ausgelieferte Module fehlen:\n  ${fehlend.join('\n  ')}`);
  process.exit(1);
}

/**
 * `measure-glb.py` über Blender laufen lassen und die KENNZAHL-Zeilen als
 * Karte `datei -> [{objekt, tris, mat, volumen, bbox}]` zurückgeben.
 */
function messe(dateien) {
  const r = spawnSync(
    'flatpak',
    [
      'run',
      'org.blender.Blender',
      '--background',
      '--factory-startup',
      '--python',
      MESSER,
      '--',
      ...dateien,
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
  if (r.error) throw new Error(`Blender liess sich nicht starten: ${r.error.message}`);
  if (r.status !== 0) {
    console.log(r.stdout ?? '');
    console.log(r.stderr ?? '');
    throw new Error(`Blender endete mit Code ${r.status}`);
  }
  const karte = new Map();
  for (const zeile of (r.stdout ?? '').split('\n')) {
    if (!zeile.startsWith('KENNZAHL ')) continue;
    const teile = zeile.trim().split(/\s+/);
    const [, datei, objekt] = teile;
    const feld = (schluessel) => {
      const t = teile.find((x) => x.startsWith(`${schluessel}=`));
      return t ? t.slice(schluessel.length + 1) : '';
    };
    if (!karte.has(datei)) karte.set(datei, []);
    karte.get(datei).push({
      objekt,
      tris: Number(feld('tris')),
      mat: feld('mat'),
      volumen: Number(feld('volumen')),
      bbox: feld('bbox'),
    });
  }
  return karte;
}

const alleNamen = [...MIT_SCHICHT, TREPPE, ...OHNE_SCHICHT, 'StoneVaultStairs', 'StoneVaultWall'];
const gemessen = messe(alleNamen.map((n) => join(MODELLE, `${n}.glb`)));

console.log('Fels-Kollision — `_col` je Fels-Wandmodul\n');

for (const name of MIT_SCHICHT) {
  const netze = gemessen.get(`${name}.glb`) ?? [];
  const bild = netze.find((n) => n.objekt === name);
  const koll = netze.find((n) => n.objekt === `${name}_col`);
  console.log(`${name}:`);
  pruefe('  sichtbares Netz da', !!bild);
  pruefe('  `_col`-Netz da (sonst hängt die Kapsel im Relief)', !!koll);
  if (!bild || !koll) continue;
  pruefe('  Materialslot `Kollision`', koll.mat === 'Kollision', koll.mat);
  pruefe('  Materialslot des Bildes unverändert', bild.mat === 'StoneVaultStone', bild.mat);
  pruefe('  Hüllbox deckungsgleich', koll.bbox === bild.bbox, `${koll.bbox} vs ${bild.bbox}`);
  pruefe(
    '  glatt statt gebrochen (füllt die Klüfte: |Volumen| grösser)',
    Math.abs(koll.volumen) > Math.abs(bild.volumen),
    `${koll.volumen} vs ${bild.volumen}`,
  );
  pruefe('  vorgespiegelt (signiertes Volumen negativ)', koll.volumen < 0, `${koll.volumen}`);
  pruefe(`  ≤ ${KOLL_BUDGET} Dreiecke`, koll.tris <= KOLL_BUDGET, `${koll.tris}`);
}

console.log(`\n${TREPPE} (eigenes Netz, unverändert):`);
{
  const netze = gemessen.get(`${TREPPE}.glb`) ?? [];
  pruefe('  `_col`-Netz da', netze.some((n) => n.objekt === `${TREPPE}_col`));
}

console.log('\nModule ohne Frontschicht — kein `_col`:');
for (const name of OHNE_SCHICHT) {
  const netze = gemessen.get(`${name}.glb`) ?? [];
  pruefe(`  ${name}`, !netze.some((n) => n.objekt.endsWith('_col')));
}

console.log('\nZiegelkit unberührt:');
{
  const treppe = gemessen.get('StoneVaultStairs.glb') ?? [];
  pruefe('  StoneVaultStairs hat sein `_col`', treppe.some((n) => n.objekt === 'StoneVaultStairs_col'));
  const wand = gemessen.get('StoneVaultWall.glb') ?? [];
  pruefe('  StoneVaultWall hat KEINS', !wand.some((n) => n.objekt.endsWith('_col')));
}

console.log(`\n${fehler === 0 ? 'alles gruen' : `FEHLGESCHLAGEN: ${fehler} rot`}`);
process.exit(fehler === 0 ? 0 : 1);
