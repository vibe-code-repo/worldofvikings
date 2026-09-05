#!/usr/bin/env node
// Prüft: die gebackene Verschattung (COLOR_0) in den Fels-Modulen — Vorhandensein, Wertebereich, Streuung.
/*
  ── Warum (Mass D, 05.09.2026) ────────────────────────────────────────
  In der Krypta steht die Sonne auf `intensity 0`; übrig bleibt EIN
  `HemisphericLight`, und dessen Beitrag hängt auf einer senkrechten Wand
  nur von `n.y` ab — er ist dort überall gleich. Gemessen im eigens
  gebauten Grab `hell-probe`: Der Relieffaktor σ/µ mit gegen ohne
  Normal-Kanal war **1,001**. Das Relief war da, es zeigte sich nur nicht.

  Deshalb tragen die Fels-Wandmodule seit heute eine Verschattung IM NETZ:
  je Stützstelle ein Faktor 0,55 (tief in einer Kluft) bis 1,0 (auf einer
  Kante), gerechnet aus der Krümmung des Höhenfeldes
  (`felsrelief.py`, `_cavity`), als `COLOR_0` ins GLB geschrieben
  (`make-stonevault.py`, `CAVITY_SCHICHT`) und im Steinmaterial
  multiplikativ aufs Albedo gelegt (`DungeonSteinMaterial.ts`,
  `#ifdef VERTEXCOLOR`). Eine Farbe im Netz braucht kein Licht.

  ── Was gemessen wird und warum ohne Blender ──────────────────────────
  Der GLB-Kopf ist JSON, und die Farbspalte steht als schlichter
  Zahlenblock dahinter. Beides liest `node` allein — dieser Prüfer läuft
  damit in Millisekunden und kann in jedem Testlauf mit, nicht nur dort,
  wo Blender steht.

    (1) Jedes Fels-Modul MIT Frontschicht hat ein `COLOR_0`.
    (2) Die Werte liegen im Fenster 0,55 .. 1,0 — kein Punkt wird schwarz
        (das wäre ein nie beschriebener Standardwert) und keiner heller
        als das Albedo selbst.
    (3) Sie STREUEN: σ/µ über 0,05. Eine Farbspalte aus lauter Einsen wäre
        vorhanden, gültig — und wirkungslos. Genau dieser Fall ist der
        wahrscheinlichste Fehler (`fels_schicht` schreibt nicht, und
        `aufbereiten` zieht alles auf Weiss).
    (4) Die Alphaspalte ist durchweg 1. Der glTF-Lader von Babylon setzt
        `hasVertexAlpha`, sobald `COLOR_0` VEC4 ist, und schöbe das ganze
        Kit in den Alpha-Blend-Pfad; `AssetManager.entschaerfeVertexAlpha`
        nimmt das zurück, ABER nur, wenn die Spalte wirklich 1 ist.
    (5) Das `_col`-Netz hat KEINE Farbe (es wird nie gezeichnet).
    (6) Die Ziegelmodule haben keine — sonst wäre `DG_StoneVault` nicht
        mehr byte-gleich mit der Auslieferung.

  Aufruf: node tools/elements/pruefung/fels-cavity.mjs
  Braucht `assets/models`, sonst nichts.

  Checks the baked cavity term (COLOR_0) in the rock modules.
*/
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const MODELLE = resolve(HIER, '../../..', 'assets', 'models');

const MIT_SCHICHT = [
  'RockVaultWall',
  'RockVaultWallB',
  'RockVaultWallC',
  'RockVaultCorridor',
  'RockVaultCorner',
  'RockVaultJunction',
  'RockVaultArch',
  'RockVaultStairs',
];
const OHNE_SCHICHT = ['RockVaultCell', 'RockVaultHall'];
const ZIEGEL = ['StoneVaultWall', 'StoneVaultCorridor', 'StoneVaultStairs'];

/** Aus `felsrelief.py`: CAVITY_MIN und CAVITY_MAX. */
const UNTEN = 0.55;
const OBEN = 1.0;
/** Eine Spalte aus lauter Einsen hätte 0 — die Schwelle trennt beides. */
const MIN_STREUUNG = 0.05;

let fehler = 0;
const pruefe = (name, ok, hinweis = '') => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    fehler += 1;
    console.log(`  FAIL ${name}${hinweis ? ` — ${hinweis}` : ''}`);
  }
};

/** Den JSON-Kopf und den Binärblock einer GLB trennen. */
function glb(pfad) {
  const buf = readFileSync(pfad);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`Keine GLB: ${pfad}`);
  const jsonLaenge = buf.readUInt32LE(12);
  const kopf = JSON.parse(buf.subarray(20, 20 + jsonLaenge).toString('utf8'));
  // Nach dem JSON-Block folgt der BIN-Block mit eigenem 8-Byte-Vorspann.
  const bin = 20 + jsonLaenge + 8;
  return { kopf, buf, bin };
}

/** Die COLOR_0-Werte eines Meshes als {rot: [...], alpha: [...]} oder null. */
function farben({ kopf, buf, bin }, meshName) {
  const mesh = kopf.meshes?.find((m) => m.name === meshName);
  if (!mesh) return undefined;
  const prim = mesh.primitives[0];
  if (prim.attributes.COLOR_0 === undefined) return null;
  const acc = kopf.accessors[prim.attributes.COLOR_0];
  const bv = kopf.bufferViews[acc.bufferView];
  const start = bin + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const komponenten = acc.type === 'VEC4' ? 4 : 3;
  // Blender schreibt normalisierte 16-Bit-Werte (5123); float (5126) und
  // 8 Bit (5121) sind die anderen beiden Formen, die glTF erlaubt.
  const leser = {
    5121: [1, (o) => buf.readUInt8(o) / 255],
    5123: [2, (o) => buf.readUInt16LE(o) / 65535],
    5126: [4, (o) => buf.readFloatLE(o)],
  }[acc.componentType];
  if (!leser) throw new Error(`Unbekannter COLOR_0-Typ ${acc.componentType} in ${meshName}`);
  const [breite, lies] = leser;
  const schritt = bv.byteStride ?? breite * komponenten;
  const rot = [];
  const alpha = [];
  for (let i = 0; i < acc.count; i++) {
    rot.push(lies(start + i * schritt));
    alpha.push(komponenten === 4 ? lies(start + i * schritt + 3 * breite) : 1);
  }
  return { rot, alpha, typ: acc.type };
}

const fehlend = [...MIT_SCHICHT, ...OHNE_SCHICHT, ...ZIEGEL]
  .map((n) => join(MODELLE, `${n}.glb`))
  .filter((p) => !existsSync(p));
if (fehlend.length > 0) {
  console.log(`FEHLGESCHLAGEN: Module fehlen:\n  ${fehlend.join('\n  ')}`);
  process.exit(1);
}

console.log('Fels-Cavity — die gebackene Verschattung im Netz\n');

for (const name of MIT_SCHICHT) {
  const datei = glb(join(MODELLE, `${name}.glb`));
  const f = farben(datei, name);
  console.log(`${name}:`);
  pruefe('  COLOR_0 da', !!f);
  if (!f) continue;
  const min = Math.min(...f.rot);
  const max = Math.max(...f.rot);
  const mu = f.rot.reduce((a, b) => a + b, 0) / f.rot.length;
  const sd = Math.sqrt(f.rot.reduce((a, b) => a + (b - mu) ** 2, 0) / f.rot.length);
  pruefe(`  Werte im Fenster ${UNTEN} .. ${OBEN}`,
    min >= UNTEN - 0.002 && max <= OBEN + 0.002, `${min.toFixed(4)} .. ${max.toFixed(4)}`);
  pruefe(`  streut (σ/µ ≥ ${MIN_STREUUNG})`, sd / mu >= MIN_STREUUNG,
    `σ/µ ${(sd / mu).toFixed(4)}, µ ${mu.toFixed(4)}`);
  pruefe('  Alphaspalte durchweg 1 (sonst Alpha-Blend im ganzen Kit)',
    Math.min(...f.alpha) >= 0.999, `min ${Math.min(...f.alpha).toFixed(4)}`);
  const c = farben(datei, `${name}_col`);
  if (c !== undefined) pruefe('  das `_col`-Netz trägt keine Farbe', c === null);
}

console.log('\nOhne Frontschicht — keine Verschattung:');
for (const name of OHNE_SCHICHT) {
  pruefe(`  ${name}`, farben(glb(join(MODELLE, `${name}.glb`)), name) === null);
}

console.log('\nZiegelkit unberührt:');
for (const name of ZIEGEL) {
  pruefe(`  ${name}`, farben(glb(join(MODELLE, `${name}.glb`)), name) === null);
}

console.log(`\n${fehler === 0 ? 'alles gruen' : `FEHLGESCHLAGEN: ${fehler} rot`}`);
process.exit(fehler === 0 ? 0 : 1);
