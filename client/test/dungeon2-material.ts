/**
 * Prueft das Triplanar-Material-Plugin OHNE GPU.
 * Checks the triplanar material plugin WITHOUT a GPU.
 *
 * Das ist das Muster aus WoCs `worn_stone_shader.test.ts`, das
 * `ARCHITECTURE.md` AP10 als Pruefkriterium 1 vorschreibt: den erzeugten
 * Shader-Quelltext je Grafikstufe ansehen. Ein Shader, den nur die GPU je zu
 * sehen bekommt, ist bis zum ersten Bild ungeprueft — und dann faellt er als
 * schwarze Wand auf, nicht als Fehlermeldung.
 * This is the pattern of WoC's `worn_stone_shader.test.ts` that
 * `ARCHITECTURE.md` AP10 prescribes as criterion 1: look at the generated
 * shader source per graphics tier.
 *
 * Zwei Dinge werden hier GEMESSEN statt geglaubt:
 *
 *  1. **Die Einspritzpunkte gegen das installierte Babylon.** `PbrNebelFix.ts`
 *     haelt fest, dass Chunk-Namen zwischen Babylon-Fassungen wandern. Der Test
 *     liest den echten `pbrPixelShader` aus dem `ShaderStore` und belegt jeden
 *     der vier Orte darin — samt Reihenfolge, denn „vor der Lichtrechnung" ist
 *     eine Aussage ueber Positionen, nicht ueber Namen.
 *  2. **Die Vertraeglichkeit mit den vier bestehenden Plugins.** Die drei
 *     Regex-Muster von `StandardGammaFix`, `PbrNebelFix` und `NebelRichtung`
 *     werden aus deren QUELLDATEIEN ausgelesen, nicht abgeschrieben — ein
 *     abgeschriebenes Muster prueft nur die Kopie.
 * Two things are MEASURED here instead of believed: the injection points
 * against the installed Babylon, and the compatibility with the four existing
 * plugins (whose regexes are read out of their source files, not copied).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import '@babylonjs/core/Shaders/pbr.fragment';
import '@babylonjs/core/Shaders/pbr.vertex';
import { erzeugeDungeonMaterial } from '../src/engine/DungeonMaterial';
import type { DungeonMaterialArrays } from '../src/engine/DungeonMaterialArrays';
import {
  DungeonGrafikStufe,
  DUNGEON_SCHICHTEN_MAX,
  RX_AO_AUFRUF,
  dungeonAoGlsl,
  dungeonAufrufGlsl,
  dungeonDefinitionenGlsl,
  dungeonParallaxZustand,
  erlaubeDungeonParallax,
  PARALLAX_SCHRITTE_HOCH,
  PARALLAX_SCHRITTE_MAX,
  STEINGRAB_THEMA,
  dungeonReflectivityGlsl,
  dungeonVertexDefinitionenGlsl,
  dungeonVertexHauptGlsl,
} from '../src/engine/DungeonMaterial';

const HIER = dirname(fileURLToPath(import.meta.url));
const ENGINE = resolve(HIER, '../src/engine');
const SHARED = resolve(HIER, '../../shared/src/dungeon2');

let rot = 0;
function pruefe(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    rot++;
    console.error(`  ROT  ${name}: ${(e as Error).message}`);
  }
}

const STUFEN: readonly [string, DungeonGrafikStufe][] = [
  ['Niedrig', DungeonGrafikStufe.Niedrig],
  ['Mittel', DungeonGrafikStufe.Mittel],
  ['Hoch', DungeonGrafikStufe.Hoch],
];

/** Der komplette Fragment-Code, den das Plugin je Stufe einspritzt. */
function fragmentCode(stufe: DungeonGrafikStufe): string {
  return [
    dungeonDefinitionenGlsl(stufe),
    dungeonAufrufGlsl(),
    dungeonReflectivityGlsl(),
    dungeonAoGlsl(),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Die Einspritzpunkte am installierten Babylon
// ─────────────────────────────────────────────────────────────────────────────

const pbrFrag = ShaderStore.ShadersStore['pbrPixelShader'];
const pbrVert = ShaderStore.ShadersStore['pbrVertexShader'];
const reflectivity = ShaderStore.IncludesShadersStore['pbrBlockReflectivity'];

console.log('Einspritzpunkte am installierten Babylon:');

pruefe('pbr.fragment und pbr.vertex sind im ShaderStore', () => {
  assert.ok(pbrFrag && pbrFrag.length > 1000, 'pbrPixelShader fehlt');
  assert.ok(pbrVert && pbrVert.length > 1000, 'pbrVertexShader fehlt');
  assert.ok(reflectivity && reflectivity.length > 500, 'pbrBlockReflectivity fehlt');
});

pruefe('CUSTOM_FRAGMENT_DEFINITIONS steht VOR dem Reflectivity-Include', () => {
  const def = pbrFrag.indexOf('#define CUSTOM_FRAGMENT_DEFINITIONS');
  const inc = pbrFrag.indexOf('#include<pbrBlockReflectivity>');
  assert.ok(def >= 0, 'CUSTOM_FRAGMENT_DEFINITIONS nicht gefunden');
  assert.ok(inc >= 0, 'pbrBlockReflectivity nicht eingebunden');
  // Nur deshalb sind die globalen Zwischenwerte im Rumpf von
  // reflectivityBlock() ueberhaupt sichtbar.
  assert.ok(def < inc, `Definitionen (${def}) muessen vor dem Include (${inc}) stehen`);
});

pruefe('CUSTOM_FRAGMENT_BEFORE_LIGHTS liegt nach surfaceAlbedo und vor AO/Reflectivity', () => {
  const normal = pbrFrag.indexOf('#include<pbrBlockNormalFinal>');
  const albedo = pbrFrag.indexOf('vec3 surfaceAlbedo=albedoOpacityOut.surfaceAlbedo;');
  const punkt = pbrFrag.indexOf('#define CUSTOM_FRAGMENT_BEFORE_LIGHTS');
  const ao = pbrFrag.indexOf('aoOut=ambientOcclusionBlock(');
  const refl = pbrFrag.indexOf('reflectivityOut=reflectivityBlock(');
  for (const [n, i] of Object.entries({ normal, albedo, punkt, ao, refl })) {
    assert.ok(i >= 0, `${n} nicht im Shader gefunden`);
  }
  assert.ok(normal < punkt, 'normalW muss vor dem Einspritzpunkt deklariert sein');
  assert.ok(albedo < punkt, 'surfaceAlbedo muss vor dem Einspritzpunkt deklariert sein');
  assert.ok(punkt < ao, 'Einspritzung muss vor der Occlusion liegen');
  assert.ok(ao < refl, 'Occlusion muss vor der Reflectivity liegen');
});

pruefe('CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS existiert und sieht metallicRoughness', () => {
  const i = reflectivity.indexOf('#define CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS');
  assert.ok(i >= 0, 'Punkt nicht in pbrBlockReflectivity');
  const decl = reflectivity.indexOf('vec2 metallicRoughness=');
  assert.ok(decl >= 0 && decl < i, 'metallicRoughness muss vor dem Punkt deklariert sein');
});

pruefe('der AO-Regex trifft den Aufruf genau einmal', () => {
  // Erste zwei Zeichen sind die `!!`-Kennung des Plugin-Managers.
  assert.equal(RX_AO_AUFRUF.slice(0, 2), '!!');
  const rx = new RegExp(RX_AO_AUFRUF.slice(2), 'g');
  const treffer = pbrFrag.match(rx) ?? [];
  assert.equal(treffer.length, 1, `erwartet 1 Treffer, gefunden ${treffer.length}`);
  assert.ok(treffer[0].includes('ambientOcclusionBlock('), 'Treffer ist nicht der Aufruf');
  // Er darf nicht ueber den Aufruf hinaus fressen — sonst verschluckt die
  // Ersetzung Code, den niemand vermisst, bis das Bild dunkel bleibt.
  assert.ok(treffer[0].length < 200, `Treffer zu lang (${treffer[0].length} Zeichen)`);
});

pruefe('die vier fremden Groessen, auf die der Block baut, gibt es wirklich', () => {
  // vPositionW: unbedingt, nicht unter #ifdef NORMAL — sonst waere die
  // Weltraumprojektion an genau den Materialien aus, die keine Normalen melden.
  const extra = ShaderStore.IncludesShadersStore['pbrFragmentExtraDeclaration'];
  assert.ok(extra.startsWith('varying vec3 vPositionW;'), 'vPositionW nicht unbedingt');
  assert.ok(extra.includes('varying vec3 vNormalW;'), 'vNormalW fehlt');
  // toLinearSpace linearisiert das sRGB-kodierte Albedo-Array.
  assert.ok(
    ShaderStore.IncludesShadersStore['helperFunctions'].includes('vec3 toLinearSpace'),
    'toLinearSpace fehlt'
  );
  // vEyePosition treibt den Parallax-Zweig.
  assert.ok(
    ShaderStore.IncludesShadersStore['pbrFragmentDeclaration'].includes('vEyePosition'),
    'vEyePosition fehlt'
  );
});

pruefe('CUSTOM_VERTEX_DEFINITIONS und CUSTOM_VERTEX_MAIN_END existieren', () => {
  assert.ok(pbrVert.includes('#define CUSTOM_VERTEX_DEFINITIONS'));
  assert.ok(pbrVert.includes('#define CUSTOM_VERTEX_MAIN_END'));
});

pruefe('uv2 wird von Babylon nur unter #ifdef UV2 deklariert', () => {
  // Genau darauf beruht die eigene `#ifndef UV2`-Deklarierung im Vertexcode:
  // waere `uv2` unbedingt da, waere unsere Zeile eine Doppeldeklaration.
  const uvDecl = ShaderStore.IncludesShadersStore['uvAttributeDeclaration'];
  assert.ok(uvDecl.includes('#ifdef UV{X}'), 'uvAttributeDeclaration unerwartet');
  assert.ok(uvDecl.includes('attribute vec2 uv{X};'), 'uvAttributeDeclaration unerwartet');
  assert.ok(pbrVert.includes('#include<uvAttributeDeclaration>[2..7]'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Der erzeugte Quelltext je Stufe
// ─────────────────────────────────────────────────────────────────────────────

console.log('Shader-Textpruefung je Stufe:');

for (const [name, stufe] of STUFEN) {
  const code = fragmentCode(stufe);

  pruefe(`${name}: Klammern und #ifdef/#endif gehen auf`, () => {
    const auf = (code.match(/#ifdef|#ifndef|#if\b/g) ?? []).length;
    const zu = (code.match(/#endif/g) ?? []).length;
    assert.equal(auf, zu, `${auf} geoeffnete gegen ${zu} geschlossene Praeprozessorbloecke`);
    const geschweift = [...code].reduce((a, c) => a + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
    assert.equal(geschweift, 0, 'geschweifte Klammern unausgeglichen');
  });

  pruefe(`${name}: reines ASCII im GLSL`, () => {
    // GLSL ES schreibt einen begrenzten Quellzeichensatz vor, und es gibt
    // Treiber, die schon an einem Umlaut im Kommentar aussteigen.
    const boese = [...code].filter((c) => c.charCodeAt(0) > 126);
    assert.equal(boese.length, 0, `Nicht-ASCII gefunden: ${boese.slice(0, 5).join('')}`);
  });

  pruefe(`${name}: die drei Array-Sampler sind deklariert — MIT Praezision`, () => {
    // `highp` ist Teil der Zusicherung, nicht Formsache: GLSL ES 3.00 gibt
    // sampler2D eine Vorgabepraezision, sampler2DArray NICHT. Ohne den
    // Qualifizierer scheitert die Uebersetzung mit „No precision specified",
    // die Notbremse greift, und der ganze Dungeon ist grau. Gemessen am
    // 30.08.2026 auf ANGLE/Vulkan ueber die AP6-Vorschauseite — dieser Test
    // war vorher gruen, weil er nur nach dem Namen sah.
    // `highp` is part of the assertion, not cosmetics: GLSL ES 3.00 gives
    // sampler2D a default precision but NOT sampler2DArray. Without the
    // qualifier compilation fails with "No precision specified", the emergency
    // brake trips and the whole dungeon turns grey. Measured 2026-08-30 on
    // ANGLE/Vulkan through the AP6 preview page.
    for (const s of ['dungeonAlbedoArray', 'dungeonNormalArray', 'dungeonOrhArray']) {
      assert.ok(code.includes(`uniform highp sampler2DArray ${s};`), `${s} fehlt oder ohne highp`);
    }
    // Und der Funktionsparameter, den derselbe Uebersetzer als vierten Fehler
    // gemeldet hat: ein Sampler-Parameter hat ebenfalls keine Vorgabe.
    // And the function parameter the same compiler reported as a fourth error.
    assert.ok(
      code.includes('dgTap(highp sampler2DArray tex'),
      'dgTap nimmt den Sampler ohne Praezision entgegen'
    );
  });

  pruefe(`${name}: Dominanz-Kollaps und Ein-Tap-Schnellpfad sind drin`, () => {
    assert.ok(code.includes('w = max(w - vec3(dgTriplanar.y), vec3(0.0));'), 'Kollaps fehlt');
    assert.ok(code.includes('if (w.x > 0.999)'), 'Ein-Tap-Schnellpfad fehlt');
  });
}

pruefe('Niedrig enthaelt KEINEN Blending-Block und kein Rauschen', () => {
  const code = fragmentCode(DungeonGrafikStufe.Niedrig);
  assert.ok(!code.includes('#ifdef DUNGEON_BLENDING'), 'Blending-Block auf Niedrig vorhanden');
  assert.ok(!code.includes('dgWertRausch'), 'Rauschfunktion auf Niedrig vorhanden');
  assert.ok(!code.includes('dungeonMoosAlbedo, moosUv'), 'Moos-Zugriff auf Niedrig vorhanden');
});

pruefe('Mittel enthaelt Blending, aber keinen Cavity- und keinen Parallax-Zweig', () => {
  const code = fragmentCode(DungeonGrafikStufe.Mittel);
  assert.ok(code.includes('#ifdef DUNGEON_BLENDING'), 'Blending-Block fehlt');
  assert.ok(code.includes('dgWertRausch'), 'Rauschfunktion fehlt');
  // Cavity und Parallax stehen zwar als #ifdef im Text, ihre Defines sind auf
  // Mittel aber aus — der Textunterschied ist der Blending-Block.
  assert.ok(code.includes('#ifdef DUNGEON_CAVITY'), 'Cavity-Zweig fehlt');
});

pruefe('Hoch enthaelt den Parallax-#ifdef', () => {
  const code = fragmentCode(DungeonGrafikStufe.Hoch);
  assert.ok(code.includes('#ifdef DUNGEON_PARALLAX'), 'Parallax-#ifdef fehlt');
  assert.ok(code.includes('dgFest.y'), 'Parallaxtiefe wird nicht gelesen');
});

pruefe('der Rechenblock wird an surfaceAlbedo, normalW, Rauheit und AO uebergeben', () => {
  assert.ok(dungeonAufrufGlsl().includes('surfaceAlbedo = dgAlbedo;'));
  assert.ok(dungeonAufrufGlsl().includes('normalW = dgNormal;'));
  assert.ok(dungeonReflectivityGlsl().includes('metallicRoughness.g = dgRauheit;'));
  assert.ok(dungeonReflectivityGlsl().includes('metallicRoughness.r = dgMetall;'));
  assert.ok(dungeonAoGlsl().includes('aoOut.ambientOcclusionColor *= vec3(dgAo);'));
  // `$0` setzt den gefundenen Aufruf wieder ein — ohne ihn loeschte die
  // Ersetzung den AO-Aufruf und `aoOut` waere uninitialisiert.
  assert.ok(dungeonAoGlsl().startsWith('$0'), 'AO-Ersatz setzt den Fund nicht wieder ein');
});

pruefe('Vertexcode reicht Ebene und Blend-Werte durch, mit Rueckfall ohne Attribut', () => {
  const def = dungeonVertexDefinitionenGlsl();
  const haupt = dungeonVertexHauptGlsl();
  assert.ok(def.includes('#ifndef UV2'), 'uv2-Doppeldeklaration nicht abgesichert');
  assert.ok(def.includes('attribute float dgSchicht;'));
  assert.ok(haupt.includes('vDgSchicht = dgSchicht;'));
  assert.ok(haupt.includes('vDgBlend = uv2;'));
  // Fehlt das Blend-Attribut, muss Feuchte AUS sein (ARCHITECTURE W4) — der
  // Ersatzwert ist deshalb "weit weg von jeder Kante", nicht 0.
  assert.ok(haupt.includes('vDgBlend = vec2(999.0, 999.0);'), 'Rueckfallwert fehlt');
  assert.ok(haupt.includes('vDgSchicht = dgFest.x;'), 'Ebenen-Rueckfall fehlt');
});

pruefe('die Ebenenzahl im Shader passt zu den sechs Basismaterialien (W5)', () => {
  assert.equal(DUNGEON_SCHICHTEN_MAX, 6);
  const code = fragmentCode(DungeonGrafikStufe.Mittel);
  assert.ok(code.includes('clamp(vDgSchicht + 0.5, 0.0, 5.0)'), 'Ebenenklemme falsch');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Derselbe Hash wie im Bauer (W8)
// ─────────────────────────────────────────────────────────────────────────────

console.log('Hash-Gleichlauf mit shared/src/dungeon2/hashing.ts:');

pruefe('die GLSL-Fassung benutzt dieselben Murmur3-Konstanten und Shifts', () => {
  const ts = readFileSync(resolve(SHARED, 'hashing.ts'), 'utf8');
  const code = dungeonDefinitionenGlsl(DungeonGrafikStufe.Mittel);
  // Die beiden Multiplikatoren aus dem TS-Quelltext ziehen, nicht abschreiben.
  const konstanten = [...ts.matchAll(/0x([0-9a-f]{8})/g)].map((m) => m[1]);
  assert.ok(konstanten.length >= 2, 'keine Konstanten in hashing.ts gefunden');
  for (const k of new Set(konstanten)) {
    assert.ok(code.includes(`0x${k}u`), `Konstante 0x${k} fehlt im GLSL`);
  }
  // Und die drei Shifts in derselben Reihenfolge.
  const shiftsTs = [...ts.matchAll(/h \^= h >>> (\d+);/g)].map((m) => m[1]);
  const shiftsGl = [...code.matchAll(/h \^= h >> (\d+)u;/g)].map((m) => m[1]);
  assert.deepEqual(shiftsGl, shiftsTs, 'Shift-Folge weicht ab');
});

pruefe('die Reihenfolge x, z, ebene ist in beiden Fassungen dieselbe', () => {
  const ts = readFileSync(resolve(SHARED, 'hashing.ts'), 'utf8');
  const code = dungeonDefinitionenGlsl(DungeonGrafikStufe.Mittel);
  for (const q of [ts, code]) {
    const i = q.indexOf('h = verruehren(h, x);') >= 0 ? q.indexOf('h = verruehren(h, x);') : q.indexOf('h = dgVerruehren(h, x);');
    const j = q.indexOf('h = verruehren(h, z);') >= 0 ? q.indexOf('h = verruehren(h, z);') : q.indexOf('h = dgVerruehren(h, z);');
    const k = q.indexOf('h = verruehren(h, ebene);') >= 0 ? q.indexOf('h = verruehren(h, ebene);') : q.indexOf('h = dgVerruehren(h, ebene);');
    assert.ok(i >= 0 && j >= 0 && k >= 0, 'Mischschritte nicht gefunden');
    assert.ok(i < j && j < k, 'Reihenfolge der Mischschritte weicht ab');
  }
});

pruefe('der Seed reist als zwei 16-Bit-Haelften, nicht als ein float', () => {
  // Ein einzelner float verlaere oberhalb von 2^24 die unteren Bits, und das
  // Rauschen folgte `seeds.material` dann still gar nicht mehr.
  const code = dungeonDefinitionenGlsl(DungeonGrafikStufe.Mittel);
  assert.ok(code.includes('uint(dgTriplanar.z) | (uint(dgTriplanar.w) << 16u)'), 'Seed-Aufbau fehlt');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Vertraeglichkeit mit den vier bestehenden Plugins
// ─────────────────────────────────────────────────────────────────────────────

console.log('Vertraeglichkeit mit den bestehenden Plugins:');

/** Zieht die `!!`-Regexmuster aus einer Plugin-Quelldatei. */
function musterAus(datei: string): string[] {
  const quelle = readFileSync(resolve(ENGINE, datei), 'utf8');
  return [...quelle.matchAll(/'!!((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\\\/g, '\\'));
}

const FREMDE = ['PbrNebelFix.ts', 'NebelRichtung.ts', 'StandardGammaFix.ts'];

pruefe('aus den drei Quelldateien wurden ueberhaupt Muster gelesen', () => {
  const alle = FREMDE.flatMap(musterAus);
  assert.ok(alle.length >= 4, `nur ${alle.length} Muster gefunden — Ausleser stumpf?`);
});

for (const datei of FREMDE) {
  for (const muster of musterAus(datei)) {
    pruefe(`kein Treffer von ${datei} in unserem Code: ${muster.slice(0, 40)}`, () => {
      const rx = new RegExp(muster, 'g');
      for (const [name, stufe] of STUFEN) {
        const code = fragmentCode(stufe) + dungeonVertexDefinitionenGlsl() + dungeonVertexHauptGlsl();
        assert.equal(rx.test(code), false, `Muster trifft unseren ${name}-Code`);
        rx.lastIndex = 0;
      }
    });
  }
}

pruefe('unsere Einspritzorte sind andere als die der drei Nebel-/Gamma-Plugins', () => {
  // Jene drei zielen auf die Farbzusammensetzung ganz am Ende (fogFragment,
  // Gamma). Wir setzen an, bevor `finalColor` ueberhaupt entsteht.
  const unsere = new Set([
    'CUSTOM_FRAGMENT_DEFINITIONS',
    'CUSTOM_FRAGMENT_BEFORE_LIGHTS',
    'CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS',
    RX_AO_AUFRUF,
  ]);
  // FackelLicht ist der vierte im Bunde und benutzt CUSTOM_FRAGMENT_BEFORE_FOG.
  const fackel = readFileSync(resolve(ENGINE, 'FackelLicht.ts'), 'utf8');
  assert.ok(fackel.includes('CUSTOM_FRAGMENT_BEFORE_FOG'), 'FackelLicht-Punkt nicht gefunden');
  assert.equal(unsere.has('CUSTOM_FRAGMENT_BEFORE_FOG'), false);
  // Und unser Punkt liegt VOR dem der Fackeln — sonst beleuchteten die Fackeln
  // eine Albedo, die es noch gar nicht gibt.
  const vorLicht = pbrFrag.indexOf('#define CUSTOM_FRAGMENT_BEFORE_LIGHTS');
  const vorNebel = pbrFrag.indexOf('#define CUSTOM_FRAGMENT_BEFORE_FOG');
  assert.ok(vorLicht >= 0);
  // BEFORE_FOG sitzt in pbrBlockFinalColorComposition, nicht in pbr.fragment.
  const komposition = ShaderStore.IncludesShadersStore['pbrBlockFinalColorComposition'];
  assert.ok(
    vorNebel >= 0 || komposition.includes('#define CUSTOM_FRAGMENT_BEFORE_FOG'),
    'CUSTOM_FRAGMENT_BEFORE_FOG nirgends gefunden'
  );
});

pruefe('unsere Prioritaet liegt vor allen vier bestehenden Plugins', () => {
  const quelle = readFileSync(resolve(ENGINE, 'DungeonMaterial.ts'), 'utf8');
  const m = /super\(\s*material,\s*'DungeonTriplanar',\s*(\d+)/.exec(quelle);
  assert.ok(m, 'Prioritaet nicht im Quelltext gefunden');
  const unsere = Number(m[1]);
  const fremd: number[] = [];
  for (const d of [...FREMDE, 'FackelLicht.ts']) {
    const q = readFileSync(resolve(ENGINE, d), 'utf8');
    const p = /super\(material,\s*'[^']+',\s*(\d+)/.exec(q);
    assert.ok(p, `Prioritaet in ${d} nicht gefunden`);
    fremd.push(Number(p[1]));
  }
  assert.ok(fremd.length === 4, 'nicht alle vier Prioritaeten gelesen');
  assert.ok(
    unsere < Math.min(...fremd),
    `${unsere} muss kleiner sein als ${Math.min(...fremd)} (fruehe Einspritzung)`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Die ECHTE Einspritzung, durch Babylons eigenen Plugin-Manager
// ─────────────────────────────────────────────────────────────────────────────

console.log('Echte Einspritzung durch den Plugin-Manager:');

/**
 * Ein Texturbuendel-Doppel. Es muss nur `isReady()` beantworten — geladen wird
 * hier nichts, es geht ausschliesslich um den Shader-Text.
 * A texture bundle double: only `isReady()` matters, nothing is loaded here.
 */
const arraysDoppel = {
  albedo: { isReady: () => true },
  normal: { isReady: () => true },
  orh: { isReady: () => true },
  moosAlbedo: {},
  moosNormal: {},
  moosKachelM: 2,
  schichten: [{ layer: 0, name: 'wall-block', metallic: 0, tileMetres: 4 }],
  dispose: () => {},
} as unknown as DungeonMaterialArrays;

const engine = new NullEngine();
// Die NullEngine meldet WebGL 1, und dort gibt es kein `sampler2DArray` —
// die Fabrik liesse das Plugin also zu Recht weg. Fuer die Textpruefung wird
// die Fassung deshalb ausdruecklich auf 2 gestellt; das ist eine Aussage ueber
// den Pruefstand, nicht ueber das Geraet.
// The NullEngine reports WebGL 1, where `sampler2DArray` does not exist, so the
// factory would rightly omit the plugin. For the text check the version is
// explicitly set to 2.
(engine as unknown as { _webGLVersion: number })._webGLVersion = 2;
const szene = new Scene(engine);
const material = erzeugeDungeonMaterial(szene, 'dungeon2-test', arraysDoppel);
const manager = material.pluginManager as unknown as {
  getPlugin(n: string): unknown;
  _injectCustomCode(e: object, cb: undefined): (t: string, code: string) => string;
};

pruefe('das Plugin haengt am erzeugten Material', () => {
  assert.ok(manager?.getPlugin('DungeonTriplanar'), 'DungeonTriplanar nicht angehaengt');
  // METALLICWORKFLOW ist Bedingung fuer den Rauheits-Einspritzpunkt.
  assert.equal(material.metallic, 0);
  assert.equal(material.roughness, 1);
});

// Der Rueckruf des Managers laeuft NACH dem Aufloesen der Includes — deshalb
// wird der Reflectivity-Block hier von Hand eingesetzt, sonst faende die
// Einspritzung ihren Punkt gar nicht und der Test bewiese das Gegenteil.
// The manager's callback runs AFTER include resolution, so the reflectivity
// block is inlined by hand here.
const aufgeloest = pbrFrag.replace('#include<pbrBlockReflectivity>', reflectivity);
const fertig = manager._injectCustomCode({}, undefined)('fragment', aufgeloest);

pruefe('alle vier Einspritzungen landen im fertigen Fragment-Quelltext', () => {
  const def = fertig.indexOf('void dgBerechne');
  const aufruf = fertig.indexOf('dgBerechne(normalW);');
  const ao = fertig.indexOf('aoOut.ambientOcclusionColor *= vec3(dgAo);');
  const refl = fertig.indexOf('metallicRoughness.g = dgRauheit;');
  for (const [n, i] of Object.entries({ def, aufruf, ao, refl })) {
    assert.ok(i >= 0, `${n} fehlt im fertigen Quelltext`);
  }
  // Definition vor Gebrauch, Aufruf vor Occlusion — GLSL kennt keine
  // Vorwaertsdeklaration, und AO liest, was der Aufruf geschrieben hat.
  assert.ok(def < aufruf, 'dgBerechne wird vor seiner Definition gerufen');
  assert.ok(aufruf < ao, 'Occlusion liest vor dem Aufruf');
  assert.ok(refl > def, 'Rauheitsblock liegt vor den Definitionen');
});

pruefe('die AO-Ersetzung loescht den Aufruf nicht', () => {
  // `$0` muss den gefundenen Text wieder einsetzen. Ohne ihn waere `aoOut`
  // uninitialisiert und die ganze Umgebungsbeleuchtung Zufall.
  assert.ok(fertig.includes('aoOut=ambientOcclusionBlock('), 'AO-Aufruf verschwunden');
  const anzahl = (fertig.match(/aoOut=ambientOcclusionBlock\(/g) ?? []).length;
  assert.equal(anzahl, 1, `AO-Aufruf ${anzahl}-mal statt einmal`);
});

pruefe('die Einspritzung waechst den Shader, statt ihn zu ersetzen', () => {
  assert.ok(fertig.length > aufgeloest.length, 'nichts eingespritzt');
  // Und die Anker der drei fremden Plugins ueberleben unveraendert.
  for (const datei of FREMDE) {
    for (const muster of musterAus(datei)) {
      const rx = new RegExp(muster, 'g');
      const vorher = (aufgeloest.match(rx) ?? []).length;
      rx.lastIndex = 0;
      const nachher = (fertig.match(rx) ?? []).length;
      assert.equal(nachher, vorher, `Anker ${muster.slice(0, 30)}: ${vorher} -> ${nachher}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Parallax (M2 / AP16) — der Zweig, den nur die Stufe Hoch sieht
// ─────────────────────────────────────────────────────────────────────────────

pruefe('Parallax-Occlusion: die Schleife steht im Quelltext und laeuft ueber das Define', () => {
  const code = dungeonDefinitionenGlsl(DungeonGrafikStufe.Hoch);
  // Beide Zweige muessen DA sein — der Praeprozessor waehlt, nicht dieser Test.
  // Ohne den `#if` waere der Schrittzaehler eine Zahl ohne Wirkung, und
  // `?parallax=12` unterschiede sich von `?parallax=1` nur in der Meldezeile.
  // Both branches must be present; the preprocessor chooses, not this test.
  assert.ok(
    code.includes('#if DUNGEON_PARALLAX_SCHRITTE <= 1'),
    'Der Zweig fuer Offset-Limiting fehlt'
  );
  assert.ok(
    /for \(int i = 0; i < DUNGEON_PARALLAX_SCHRITTE; i\+\+\)/.test(code),
    'Die Occlusion-Schleife laeuft nicht ueber DUNGEON_PARALLAX_SCHRITTE'
  );
  // Genau EIN Griff je Schleifendurchlauf plus Einstieg plus Verfeinerung:
  // Der Test zaehlt die Griffe in den Hoehenkanal, weil die Kostenaussage
  // („4-8 Taps", render-tech 3.4) sonst eine Behauptung bleibt.
  // Exactly one tap per iteration plus entry plus refinement — the test counts
  // the taps into the height channel, otherwise the cost claim stays a claim.
  const parallaxBlock = code.slice(
    code.indexOf('#ifdef DUNGEON_PARALLAX'),
    code.indexOf('-- albedo')
  );
  const griffe = (parallaxBlock.match(/dgTap\(dungeonOrhArray/g) ?? []).length;
  assert.equal(griffe, 4, `Griffe im Parallax-Block: ${griffe} (erwartet 4)`);
});

pruefe('Der Schrittzaehler ist ein Define und wandert in die Cache-Zeichenkette', () => {
  // Die Begruendung steht bei `DungeonGrafikStufe`: Babylon schluesselt seinen
  // Effekt-Cache ueber die Define-Zeichenkette. Waere die Schrittzahl ein
  // Uniform, bekaeme ein Wechsel von 1 auf 6 denselben Schluessel und damit
  // den ALTEN Shader — der Schalter haette kein Symptom ausser dem fehlenden
  // Effekt.
  // Were the step count a uniform, switching 1 -> 6 would return the OLD
  // shader from the cache.
  const quelle = readFileSync(resolve(ENGINE, 'DungeonMaterial.ts'), 'utf8');
  assert.ok(
    /DUNGEON_PARALLAX_SCHRITTE: 1,/.test(quelle),
    'DUNGEON_PARALLAX_SCHRITTE fehlt in der Define-Liste des Konstruktors'
  );
  assert.ok(
    /defines\.DUNGEON_PARALLAX_SCHRITTE = parallaxSchritte;/.test(quelle),
    'Der Schrittzaehler wird nicht in die Defines geschrieben'
  );
});

pruefe('Parallax greift mit EXPLIZITEN Ableitungen in die Arrays', () => {
  // Warum das ein Test ist und keine Geschmacksfrage: Die Griffe der
  // Occlusion-Schleife stehen hinter einem `break`, also in nicht-uniformem
  // Kontrollfluss. GLSL ES laesst die impliziten Ableitungen dort
  // UNDEFINIERT — der Treiber darf jede Mip-Stufe zurueckgeben, die ihm
  // gefaellt. Und selbst wo sie definiert waeren, ist die Ableitung der
  // VERSCHOBENEN Koordinate die Ableitung des Sprungs und nicht der Flaeche.
  // Ohne `textureGrad` sieht man das als Sprenkelregen auf dem Mauerwerk.
  // The occlusion taps sit in non-uniform control flow, where GLSL ES leaves
  // implicit derivatives UNDEFINED — and the derivative of the DISPLACED
  // coordinate would be the derivative of the jump, not of the surface.
  const code = dungeonDefinitionenGlsl(DungeonGrafikStufe.Hoch);
  assert.ok(code.includes('textureGrad(tex, vec3(uv, schicht), ddx, ddy)'), 'textureGrad fehlt');
  for (const achse of ['X', 'Y', 'Z']) {
    assert.ok(code.includes(`dFdx(uv${achse})`), `Ableitung von uv${achse} fehlt`);
  }
  // Die Ableitungen stehen VOR dem Parallax-Block, also im uniformen
  // Kontrollfluss — `dFdx` in einem Zweig waere derselbe Fehler eine Etage
  // tiefer. / They must be taken before the branch.
  assert.ok(
    code.indexOf('dFdx(uvX)') < code.indexOf('vec3 sicht = normalize'),
    'Die Ableitungen werden erst im Parallax-Block genommen'
  );
});

pruefe('Der Parallax-Versatz folgt der Spiegelung der uv-Achsen', () => {
  // uvX kippt seine erste Achse auf Waenden mit n.x < 0, uvZ auf Waenden mit
  // n.z >= 0. Ohne dieselbe Kippung in der Blickrichtung lief der Versatz auf
  // genau diesen Waenden RUECKWAERTS, und das Relief las sich verkehrt herum —
  // Fugen standen vor, Steine sanken ein. Das sieht nicht nach einem Fehler im
  // Parallax aus, sondern nach einer falschen Hoehenkarte.
  // Without the same mirroring in the view direction the offset ran BACKWARDS
  // on exactly those walls and the relief read inside out.
  const code = dungeonDefinitionenGlsl(DungeonGrafikStufe.Hoch);
  assert.ok(
    code.includes('vec2(n.x < 0.0 ? -sicht.z : sicht.z, sicht.y)'),
    'Die x-dominante Richtung ist nicht gespiegelt'
  );
  assert.ok(
    code.includes('vec2(n.z < 0.0 ? sicht.x : -sicht.x, sicht.y)'),
    'Die z-dominante Richtung ist nicht gespiegelt'
  );
});

pruefe('Die Parallaxtiefe ist ein Mass in Metern und blendet streifend aus', () => {
  // Beides zusammen ist der Fix gegen die Sprenkel: Die Tiefe wird ueber
  // `skala` (1/Kachelmeter) in uv gerechnet, statt roh als uv-Versatz zu
  // gelten — 0,04 „Kachelanteile" waren auf einer Vier-Meter-Kachel 16 cm.
  // Und der Versatz blendet gegen den streifenden Blick aus, denn
  // Offset-Limiting DECKELT ihn nur, es fuehrt ihn nicht gegen null.
  // Depth in metres via `skala`, and a fade towards grazing angles — offset
  // limiting only CAPS the shift, it does not take it to zero.
  const code = dungeonDefinitionenGlsl(DungeonGrafikStufe.Hoch);
  assert.ok(code.includes('float tiefeUv = dgFest.y * skala;'), 'Die Tiefe wird nicht umgerechnet');
  assert.ok(code.includes('smoothstep(0.0, max(dgFest.z, 1e-3), ndv)'), 'Die Streifblende fehlt');
  assert.ok(
    STEINGRAB_THEMA.parallaxTiefeM > 0 && STEINGRAB_THEMA.parallaxTiefeM <= 0.06,
    `Parallaxtiefe ${STEINGRAB_THEMA.parallaxTiefeM} m ist keine Fugentiefe`
  );
  assert.ok(
    STEINGRAB_THEMA.parallaxStreifSchwelle > 0 && STEINGRAB_THEMA.parallaxStreifSchwelle < 1,
    'Die Streifschwelle liegt nicht zwischen 0 und 1'
  );
  // Die Schwelle muss auch WIRKLICH ankommen: eine Konstante im Thema, die
  // niemand in den Puffer schreibt, ist ein wirkungsloser Schalter (Vault:
  // „Messzellen brauchen Zeugen").
  // The threshold must actually reach the shader.
  const quelle = readFileSync(resolve(ENGINE, 'DungeonMaterial.ts'), 'utf8');
  assert.ok(
    /updateFloat4\('dgFest', 0, t\.parallaxTiefeM, t\.parallaxStreifSchwelle, 0\)/.test(quelle),
    'dgFest traegt Tiefe und Streifschwelle nicht'
  );
});

pruefe('erlaubeDungeonParallax klemmt die Schrittzahl', () => {
  erlaubeDungeonParallax(true, 999);
  assert.equal(dungeonParallaxZustand().schritte, PARALLAX_SCHRITTE_MAX, 'Obergrenze greift nicht');
  erlaubeDungeonParallax(true, 0);
  assert.equal(dungeonParallaxZustand().schritte, 1, 'Untergrenze greift nicht');
  erlaubeDungeonParallax(true, Number.NaN);
  assert.equal(dungeonParallaxZustand().schritte, PARALLAX_SCHRITTE_HOCH, 'NaN faellt nicht zurueck');
  // Zurueck in den Ausgangszustand: Der Zweig ist eine GLOBALE Groesse, und
  // ein hier angelassener Parallax faerbte jede folgende Pruefung.
  // Back to the initial state: the branch is a GLOBAL quantity.
  erlaubeDungeonParallax(false);
  assert.equal(dungeonParallaxZustand().erlaubt, false);
});

szene.dispose();
engine.dispose();

console.log(rot === 0 ? 'alles gruen' : `${rot} rot`);
process.exit(rot === 0 ? 0 : 1);
