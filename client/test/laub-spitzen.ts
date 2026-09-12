/**
 * Wächter für den Farbverlauf der Blattkarten — und für die vier
 * Entscheidungen darin, die alle lautlos falsch sein können.
 *
 * Der Verlauf (`client/src/engine/LaubSpitzen.ts`,
 * `shared/src/laubSpitzen.ts`) ersetzt den einen `baseColorFactor` der
 * GLB durch die zwei Farben des Vorbilds. Was dabei schiefgehen kann,
 * meldet KEIN Fehler, sondern nur ein Bild, das ein bisschen anders
 * aussieht:
 *
 *  1. DIE RICHTUNG DER V-ACHSE. Unity zählt v von unten, glTF von oben.
 *     Steht das Vorzeichen falsch, sitzt die helle Farbe am Ansatz statt
 *     an der Spitze — das Laub wird flauer statt klarer, und niemand
 *     kann sagen, warum. Geprüft wird nicht die Behauptung, sondern die
 *     GEOMETRIE des Speichers: Die Ecken mit dem grösseren v liegen
 *     näher am Schwerpunkt der Krone, das freie Ende ist also v = 0.
 *  2. DIE MITTELWERTTREUE. Der Verlauf darf die Krone nicht heimlich
 *     heller oder dunkler machen — das Mittel der Rampe MUSS der Faktor
 *     sein, der in der GLB steht. Sonst verschiebt eine Farbfrage die
 *     Helligkeitsmessung, an der zwei andere Bauer arbeiten.
 *  3. DIE ZWEI TABELLEN. `shared/src/laubVorbilder.ts` ist erzeugt,
 *     `LAUB_SPITZEN` gepflegt. Ein Materialname, den nur eine von beiden
 *     kennt, ergibt ein Blatt ohne Verlauf — sichtbar nur im Vergleich.
 *  4. DER WEG IN DEN SHADER. Babylons Einsatzstellen heissen nicht ewig
 *     gleich, und ein Plugin, das in der passiven Liste landet, tut
 *     schlicht nichts (derselbe Fehler hat das Wind-Plugin einmal ein
 *     halbes Jahr lang stillgelegt). Geprüft wird deshalb am echten
 *     `PBRMaterial`, dass das Plugin hängt, dass es aktiv ist und dass
 *     der Einsatzpunkt in Babylons PBR-Fragmentshader noch existiert.
 *
 * Weiche: Die Geometrieprobe (1) und der Abgleich mit der aufbereiteten
 * Datei (3) brauchen `assets/store-lab/vegetation` beziehungsweise
 * `assets/store/vegetation`; fehlen sie, werden genau diese Prüfungen
 * übersprungen und gemeldet. Der Rest ist Arithmetik und NullEngine.
 *
 *   npx tsx client/test/laub-spitzen.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import '@babylonjs/core/Shaders/pbr.fragment';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAUB_SPITZEN, laubMittel, laubAlbedo } from '@wov/shared/src/laubSpitzen.js';
import { LAUB_VORBILD_JE_MODELL } from '@wov/shared/src/laubVorbilder.js';
import { laubSpitzenAuftragen, laubVorbild, LaubSpitzenPlugin } from '../src/engine/LaubSpitzen';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUFBEREITET = join(WURZEL, 'assets/store-lab/vegetation');
const ROH = join(WURZEL, 'assets/store/vegetation');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── (1) Die Formel ───────────────────────────────────────────────────
//
// Gerechnet wird gegen eine Basis von 1, damit die Zahlen die reinen
// Faktoren sind.
const eins: [number, number, number] = [1, 1, 1];
const l1 = LAUB_SPITZEN['Leaves 1'];
const anSpitze = laubAlbedo(l1, eins, 0);
const amAnsatz = laubAlbedo(l1, eins, 1);
check(
  'v = 0 (freies Ende der Karte) trägt die OBERE Farbe',
  anSpitze.every((v, i) => Math.abs(v - l1.oben[i]) < 1e-9),
  JSON.stringify(anSpitze)
);
check(
  'v = 1 (Ansatz) trägt die UNTERE Farbe',
  amAnsatz.every((v, i) => Math.abs(v - l1.unten[i]) < 1e-9),
  JSON.stringify(amAnsatz)
);
check(
  'die Spitze ist heller als der Ansatz (sonst ist das Vorzeichen gedreht)',
  anSpitze[1] > amAnsatz[1],
  `${anSpitze[1]} gegen ${amAnsatz[1]}`
);
// Ausserhalb des Einheitsintervalls darf nichts weiterlaufen: Rinde
// kachelt bis u = 8,5, und ein Laubmaterial an einer kachelnden Karte
// wäre sonst stellenweise schwarz oder überstrahlt.
check(
  'v < 0 und v > 1 klemmen auf die Endfarben',
  laubAlbedo(l1, eins, -3)[1] === anSpitze[1] && laubAlbedo(l1, eins, 4)[1] === amAnsatz[1]
);

// ── (2) Mittelwerttreue ──────────────────────────────────────────────
//
// Der Mittelwert einer linearen Rampe ist der Mittelwert ihrer Enden.
// Genau diese Zahl schreibt die Aufbereitung als `baseColorFactor` —
// also darf der Verlauf die mittlere Kronenhelligkeit nicht verschieben.
// Gerechnet über 1001 Stützstellen, damit der Test nicht dieselbe
// Formel zweimal ausführt, sondern integriert.
for (const [name, s] of Object.entries(LAUB_SPITZEN)) {
  const summe = [0, 0, 0];
  const N = 1001;
  for (let k = 0; k < N; k++) {
    const a = laubAlbedo(s, eins, k / (N - 1));
    for (let i = 0; i < 3; i++) summe[i] += a[i];
  }
  const mittelRampe = summe.map((v) => v / N);
  /*
    `laubMittel` ist der reine Mittelwert der beiden Farben — das, was in
    der GLB steht. Die Menge sitzt in der Rampe aussen herum
    (`mix(1, verlauf, menge)`), also muss sie für den Vergleich auch auf
    den Mittelwert. Bei `menge = 1` (zehn von zehn Laubmaterialien) fällt
    sie weg und beide Seiten sind dieselbe Zahl.
  */
  const erwartet = laubMittel(s).map((v) => 1 * (1 - s.menge) + v * s.menge);
  const ok = erwartet.every((v, i) => Math.abs(v - mittelRampe[i]) < 5e-4);
  check(`Mittel der Rampe = Faktor der GLB (${name})`, ok, `${JSON.stringify(mittelRampe)} gegen ${JSON.stringify(erwartet)}`);
}

// ── (3) Die beiden Tabellen gegeneinander ────────────────────────────
const vorbilder = new Set<string>();
for (const materialien of Object.values(LAUB_VORBILD_JE_MODELL)) {
  for (const v of Object.values(materialien)) vorbilder.add(v);
}
check('jedes erzeugte Vorbild steht in LAUB_SPITZEN', [...vorbilder].every((v) => !!LAUB_SPITZEN[v]),
  [...vorbilder].filter((v) => !LAUB_SPITZEN[v]).join(', '));
check('jedes erzeugte Vorbild ist im Labor eingeschaltet', [...vorbilder].every((v) => LAUB_SPITZEN[v]?.imLabor),
  [...vorbilder].filter((v) => !LAUB_SPITZEN[v]?.imLabor).join(', '));
check('die erzeugte Zuordnung ist nicht leer', Object.keys(LAUB_VORBILD_JE_MODELL).length >= 50,
  String(Object.keys(LAUB_VORBILD_JE_MODELL).length));
// Die vier Grasbüschel stehen mit Farben, aber ausgeschaltet da — der
// Halm gehört in dieser Runde dem Bauer „Gras-Spitzenfarben". Ein
// versehentliches `true` wäre eine zweite Hand am selben Bild.
check(
  'die Grasbüschel bleiben ausgeschaltet',
  Object.entries(LAUB_SPITZEN).filter(([n]) => n.startsWith('Grass_')).every(([, s]) => !s.imLabor)
);

// ── (4) Der Abgleich mit der aufbereiteten Datei ─────────────────────
const glbJson = (pfad: string): { materials?: { name: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[] } => {
  const buf = readFileSync(pfad);
  return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
};
if (!existsSync(AUFBEREITET)) {
  console.log('skip  aufbereiteter Speicher fehlt (npm run store:aufbereiten) — Abgleich übersprungen');
} else {
  const abweichungen: string[] = [];
  let geprueft = 0;
  for (const [modell, materialien] of Object.entries(LAUB_VORBILD_JE_MODELL)) {
    const datei = join(AUFBEREITET, `${modell}.glb`);
    if (!existsSync(datei)) {
      abweichungen.push(`${modell}: Datei fehlt`);
      continue;
    }
    const json = glbJson(datei);
    for (const [matName, vorbild] of Object.entries(materialien)) {
      const mat = json.materials?.find((m) => m.name === matName);
      if (!mat) {
        abweichungen.push(`${modell}: Material ${matName} fehlt`);
        continue;
      }
      const f = mat.pbrMetallicRoughness?.baseColorFactor;
      const soll = laubMittel(LAUB_SPITZEN[vorbild]);
      if (!f || soll.some((v, i) => Math.abs(v - f[i]) > 1e-6)) {
        abweichungen.push(`${modell}/${matName}: ${JSON.stringify(f)} statt ${JSON.stringify(soll)}`);
      }
      geprueft++;
    }
  }
  check(
    `der Faktor in der GLB ist das Mittel des Vorbilds (${geprueft} Materialien)`,
    abweichungen.length === 0,
    abweichungen.slice(0, 5).join(' | ')
  );
  // Die Gegenrichtung: kein Laubmaterial der aufbereiteten Dateien darf
  // OHNE Verlauf bleiben. Ein neues Modell im Speicher fiele sonst
  // stillschweigend auf die Mischfarbe zurück.
  const ohne: string[] = [];
  for (const d of readdirSync(AUFBEREITET).filter((x) => x.endsWith('.glb'))) {
    const modell = d.slice(0, -4);
    const json = glbJson(join(AUFBEREITET, d));
    for (const m of json.materials ?? []) {
      if (!/^(laub|laubDunkel|laubSchnee|nadeln|ahorn)(-\d+)?$/.test(m.name)) continue;
      if (!LAUB_VORBILD_JE_MODELL[modell]?.[m.name]) ohne.push(`${modell}/${m.name}`);
    }
  }
  check('kein Laubmaterial ohne Vorbild', ohne.length === 0, ohne.slice(0, 5).join(', '));
}

// ── (5) Die Richtung der V-Achse, an der Geometrie gemessen ──────────
//
// Das ist der Zeuge, der eine gedrehte Achse fängt: Eine Blattkarte
// sitzt mit EINEM Ende am Ast und zeigt mit dem anderen nach aussen.
// Welches Ende welches v trägt, sagt der Abstand zum Schwerpunkt des
// Kronen-Primitivs — und nicht die Erinnerung dessen, der die Formel
// geschrieben hat.
function karteNachAussen(datei: string): { quads: number; aussen: number; delta: number } | null {
  const buf = readFileSync(datei);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const bin = buf.subarray(20 + jsonLen + 8);
  type Acc = { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string };
  const lies = (index: number): number[][] => {
    const a: Acc = json.accessors[index];
    const bv = json.bufferViews[a.bufferView];
    const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const breite = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType as 5126] ?? 4;
    const zahl = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as 'VEC3'] ?? 1;
    const schritt = bv.byteStride ?? breite * zahl;
    const out: number[][] = [];
    for (let k = 0; k < a.count; k++) {
      const o = start + k * schritt;
      const v: number[] = [];
      for (let c = 0; c < zahl; c++) {
        const oo = o + c * breite;
        v.push(a.componentType === 5126 ? bin.readFloatLE(oo)
          : a.componentType === 5123 ? bin.readUInt16LE(oo)
          : a.componentType === 5125 ? bin.readUInt32LE(oo) : bin.readUInt8(oo));
      }
      out.push(v);
    }
    return out;
  };
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const pos = lies(prim.attributes.POSITION);
      const idx = lies(prim.indices);
      // Blattkarten sind unverschweisste Vierecke: 4 Vertices auf 2
      // Dreiecke, also exakt 2,000 Vertices je Dreieck.
      if (Math.abs(pos.length / (idx.length / 3) - 2) > 0.01) continue;
      const uv = lies(prim.attributes.TEXCOORD_0);
      let cx = 0, cy = 0, cz = 0;
      for (const p of pos) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= pos.length; cy /= pos.length; cz /= pos.length;
      let aussen = 0, quads = 0, summe = 0;
      for (let q = 0; q + 3 < pos.length; q += 4) {
        const d = [0, 1, 2, 3].map((k) => Math.hypot(pos[q + k][0] - cx, pos[q + k][1] - cy, pos[q + k][2] - cz));
        const v = [0, 1, 2, 3].map((k) => uv[q + k][1]);
        const mv = (v[0] + v[1] + v[2] + v[3]) / 4;
        const hoch = d.filter((_, k) => v[k] > mv);
        const tief = d.filter((_, k) => v[k] <= mv);
        if (hoch.length === 0 || tief.length === 0) continue;
        const dh = hoch.reduce((a, b) => a + b, 0) / hoch.length;
        const dt = tief.reduce((a, b) => a + b, 0) / tief.length;
        if (dt > dh) aussen++;
        summe += dh - dt;
        quads++;
      }
      if (quads > 100) return { quads, aussen, delta: summe / quads };
    }
  }
  return null;
}

const PROBEN = ['massive-tree-1a1.glb', 'tree-1e1.glb', 'bush-1a2.glb'];
const quelle = existsSync(AUFBEREITET) ? AUFBEREITET : ROH;
if (!existsSync(quelle)) {
  console.log('skip  kein Speicher vorhanden — Achsenprobe übersprungen');
} else {
  for (const p of PROBEN) {
    const datei = join(quelle, p);
    if (!existsSync(datei)) { console.log(`skip  ${p} nicht vorhanden`); continue; }
    const m = karteNachAussen(datei);
    if (!m) { console.log(`skip  ${p} ohne Kartenprimitiv`); continue; }
    check(
      `${p}: v = 0 liegt weiter aussen (${m.aussen} von ${m.quads} Vierecken, Δ ${m.delta.toFixed(3)} m)`,
      m.aussen > m.quads / 2 && m.delta < 0
    );
  }
}

// ── (6) Der Weg in den Shader ────────────────────────────────────────
const engine = new NullEngine();
const scene = new Scene(engine);

const laub = new PBRMaterial('laub', scene);
laub.albedoColor.set(0.5975, 0.646, 0.3645);
const getroffen = laubSpitzenAuftragen(laub, 'store-lab/vegetation/tree-1a3');
check('ein Laubmaterial bekommt den Verlauf', getroffen);
const plugin = laub.pluginManager?.getPlugin('LaubSpitzen') as LaubSpitzenPlugin | null;
check('das Plugin hängt am Material', !!plugin);
check(
  'es trägt die Farben des Vorbilds (Leaves Birch 1)',
  !!plugin && plugin.oben[0] === LAUB_SPITZEN['Leaves Birch 1'].oben[0]
    && plugin.unten[2] === LAUB_SPITZEN['Leaves Birch 1'].unten[2]
);
check(
  'der Faktor der GLB ist auf Weiss gesetzt (sonst wird zweimal getönt)',
  laub.albedoColor.r === 1 && laub.albedoColor.g === 1 && laub.albedoColor.b === 1
);
/*
  AKTIV, nicht bloss vorhanden. `MaterialPluginBase` legt ein Plugin ohne
  das `enable`-Flag in die PASSIVE Liste: Uniformwerte werden deklariert,
  der Shadercode wird nie eingesetzt. Von aussen sieht beides gleich aus
  — bis auf diese Liste.
*/
const aktive = (laub.pluginManager as unknown as { _activePlugins?: { name: string }[] })?._activePlugins ?? [];
check('das Plugin steht in der AKTIVEN Liste', aktive.some((p) => p.name === 'LaubSpitzen'),
  aktive.map((p) => p.name).join(', '));

// Zweimal auftragen darf nichts verdoppeln — `fixupMaterial` läuft je
// Mesh, und mehrere Meshes teilen sich ein Material.
laubSpitzenAuftragen(laub, 'store-lab/vegetation/tree-1a3');
const aktive2 = (laub.pluginManager as unknown as { _activePlugins?: { name: string }[] })?._activePlugins ?? [];
check('ein zweiter Aufruf hängt kein zweites Plugin an',
  aktive2.filter((p) => p.name === 'LaubSpitzen').length === 1);

const rinde = new PBRMaterial('rinde-birke', scene);
check('Rinde bekommt keinen Verlauf', !laubSpitzenAuftragen(rinde, 'store-lab/vegetation/tree-1a3'));
const fremd = new PBRMaterial('laub', scene);
check('ein fremdes Modell mit gleichem Materialnamen bleibt unberührt',
  !laubSpitzenAuftragen(fremd, 'BirkeHoch1'));
check('der rohe Speicher findet sein Vorbild über den Materialnamen',
  !!laubVorbild('Leaves 1', 'store/vegetation/bush-1a2'));

/*
  Und der Einsatzpunkt selbst: `CUSTOM_FRAGMENT_BEFORE_LIGHTS` ist eine
  Zeile in Babylons PBR-Fragmentshader. Verschwindet sie bei einem
  Update, wird der eingesetzte Code stumm weggeworfen — kein Fehler, kein
  Log, nur flaches Laub.
*/
const pbrFragment = ShaderStore.ShadersStore['pbrPixelShader'] ?? '';
check('Babylons PBR-Shader hat noch CUSTOM_FRAGMENT_BEFORE_LIGHTS',
  pbrFragment.includes('#define CUSTOM_FRAGMENT_BEFORE_LIGHTS'));
check('… und dort steht surfaceAlbedo bereits zur Verfügung',
  pbrFragment.indexOf('vec3 surfaceAlbedo=') < pbrFragment.indexOf('#define CUSTOM_FRAGMENT_BEFORE_LIGHTS')
    && pbrFragment.indexOf('vec3 surfaceAlbedo=') > 0);
const code = new LaubSpitzenPlugin(new PBRMaterial('probe', scene)).getCustomCode('fragment');
check('der eingesetzte Code schreibt surfaceAlbedo und liest vAlbedoUV',
  !!code && code.CUSTOM_FRAGMENT_BEFORE_LIGHTS.includes('surfaceAlbedo =')
    && code.CUSTOM_FRAGMENT_BEFORE_LIGHTS.includes('vAlbedoUV.y'));
check('für den Vertex-Shader wird nichts eingesetzt',
  new LaubSpitzenPlugin(new PBRMaterial('probe2', scene)).getCustomCode('vertex') === null);

scene.dispose();
engine.dispose();

console.log(fehler === 0 ? '\nALLE PRÜFUNGEN GRÜN' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
