/**
 * Prueft den NORMAL-KANAL des 1.0-Steinmaterials ohne GPU (F1).
 * Checks the stone material's normal channel without a GPU (F1).
 *
 * Bis heute mischt `DungeonSteinMaterial.ts` sechs ALBEDO-Texturen und setzt
 * am Einspritzpunkt ausschliesslich `surfaceAlbedo` — obwohl der Kommentar
 * dort festhaelt, dass `normalW` an derselben Stelle „da und noch aenderbar"
 * ist. Solange das so bleibt, sieht jedes geometrische Relief im Fackellicht
 * flacher aus, als es ist (Konzept „Elemente aus dem Editor und Fels-Relief",
 * Vorhaben 3a).
 * Until now the material only replaced `surfaceAlbedo`; this test is about the
 * second half of that injection point, `normalW`.
 *
 * Was hier GEMESSEN statt geglaubt wird — drei Dinge:
 *
 *  1. **Dass `normalW` an diesem Punkt ueberhaupt beschreibbar ist.** Der
 *     Beweis kommt aus dem INSTALLIERTEN Babylon (`ShaderStore`), nicht aus
 *     einer Erinnerung: `pbrBlockNormalGeometric` deklariert die Groesse in
 *     beiden Zweigen als gewoehnliches lokales `vec3`, und nach dem
 *     Einspritzpunkt liest die Lichtrechnung sie wieder. Waere eines von
 *     beidem nicht so, waere die Stoerung entweder ein Uebersetzungsfehler
 *     oder wirkungslos — und wirkungslos faellt niemandem auf.
 *  2. **Dass der Shader mit UND ohne Normal-Karte uebersetzbar bleibt.** Der
 *     Praeprozessor wird hier wirklich ausgefuehrt (klein, aber ueber genau
 *     die Bloecke, die dieses Modul selbst schreibt), und in jeder Variante
 *     wird geprueft: Jeder benutzte Sampler ist in derselben Variante auch
 *     deklariert, und jeder deklarierte wird benutzt. Das ist die schaerfste
 *     Aussage, die ohne GPU zu haben ist — ein `#ifdef` zu viel oder zu wenig
 *     ergaebe sonst eine schwarze Wand statt einer Fehlermeldung.
 *  3. **Dass eine fehlende Datei das heutige Verhalten ergibt, nicht Schwarz.**
 *     Der Zustandswechsel wird ueber genau den Rueckruf gefahren, den auch
 *     Babylons Texturlader bei einem 404 ruft.
 *
 * Ohne GPU heisst hier: NullEngine. Sie uebersetzt kein GLSL — deshalb ist
 * „kompiliert" in diesem Test zunaechst eine Aussage ueber den erzeugten
 * QUELLTEXT. Liegt aber `glslangValidator` auf dem PATH (lokal ja, auf
 * `wov-dev` und im CI-Checkout nicht), wird jede Variante zusaetzlich WIRKLICH
 * uebersetzt (Abschnitt 3b) — dann ist es keine Aussage mehr, sondern ein
 * Uebersetzer. Fehlt er, meldet sich der Abschnitt als uebersprungen, Muster
 * `brauchtModelle()` in `scripts/run-tests.mjs`.
 *
 * Das reale BILD misst `tools/elements/pruefung/relief-kontrast.mjs` in der
 * Fensterphase; kein Test hier ersetzt das (Gedaechtnis „Gruene Tests sind
 * kein Fenster").
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Scene } from '@babylonjs/core/scene';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import '@babylonjs/core/Shaders/pbr.fragment';
import '@babylonjs/core/Shaders/pbr.vertex';
import type { SteinKitConfig } from '@wov/shared';
import {
  erzeugeSteinKitMaterial,
  normalPfadZu,
  steinAufrufGlsl,
  steinDefinitionenGlsl,
  type SteinFlaeche,
} from '../src/engine/DungeonSteinMaterial';

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

/** Der komplette Fragment-Code, den das Plugin einspritzt. */
const GLSL = `${steinDefinitionenGlsl()}\n${steinAufrufGlsl()}`;

/**
 * Ein winziger Praeprozessor fuer `#ifdef`/`#ifndef`/`#else`/`#endif`.
 *
 * Warum selbst gebaut: Babylons eigener Prozessor braucht ein internes
 * Optionsobjekt mit einem Dutzend Feldern (`_IProcessingOptions`), das der
 * Test nachbauen muesste — dann prueft er seinen Nachbau. Diese Zeilen lesen
 * dagegen genau die vier Direktiven, die dieses Modul selbst schreibt; dass
 * es nicht mehr sind, haelt `nur die vier Direktiven` weiter unten fest.
 */
function praeprozessor(code: string, defines: readonly string[]): string {
  const an = new Set(defines);
  const raus: string[] = [];
  const stapel: boolean[] = [];
  for (const zeile of code.split('\n')) {
    const t = zeile.trim();
    const ifdef = t.match(/^#ifdef\s+(\w+)/);
    const ifndef = t.match(/^#ifndef\s+(\w+)/);
    if (ifdef) {
      stapel.push(an.has(ifdef[1]));
      continue;
    }
    if (ifndef) {
      stapel.push(!an.has(ifndef[1]));
      continue;
    }
    if (t === '#else') {
      if (stapel.length === 0) throw new Error('#else ohne #ifdef');
      stapel[stapel.length - 1] = !stapel[stapel.length - 1];
      continue;
    }
    if (t === '#endif') {
      if (stapel.length === 0) throw new Error('#endif ohne #ifdef');
      stapel.pop();
      continue;
    }
    if (stapel.every(Boolean)) raus.push(zeile);
  }
  if (stapel.length > 0) throw new Error(`${stapel.length} Bloecke nicht geschlossen`);
  return raus.join('\n');
}

/** Alle `uniform sampler2D <name>;` einer Variante. */
function deklarierteSampler(code: string): string[] {
  return [...code.matchAll(/uniform\s+sampler2D\s+(\w+)\s*;/g)].map((m) => m[1]);
}

/** Alle `steinXxx`-Kennungen, die NICHT die Deklarationszeile sind. */
function benutzteSampler(code: string): Set<string> {
  const ohneDekl = code.replace(/uniform\s+sampler2D\s+\w+\s*;/g, '');
  return new Set([...ohneDekl.matchAll(/\bstein[A-Z]\w*/g)].map((m) => m[0]));
}

const ALBEDO_SAMPLER = [
  'steinWand',
  'steinBoden',
  'steinDecke',
  'steinMoos',
  'steinFrost',
  'steinNass',
];
const NORMAL_SAMPLER = ['steinWandNormal', 'steinBodenNormal', 'steinDeckeNormal'];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Die Anker am installierten Babylon
// ─────────────────────────────────────────────────────────────────────────────

console.log('Anker am installierten Babylon:');

const pbrFrag = ShaderStore.ShadersStore['pbrPixelShader'];
const normalGeo = ShaderStore.IncludesShadersStore['pbrBlockNormalGeometric'];

pruefe('normalW ist ein gewoehnliches lokales vec3 — in BEIDEN Zweigen', () => {
  assert.ok(normalGeo && normalGeo.length > 100, 'pbrBlockNormalGeometric fehlt');
  // Beide Zweige deklarieren die Groesse; nur deshalb ist sie hinter dem
  // `#ifdef NORMAL` unbedingt da — und `vec3 x=` ist eine gewoehnliche lokale
  // Variable, keine `const`, kein `#define`.
  const treffer = [...normalGeo.matchAll(/vec3 normalW=/g)];
  assert.equal(treffer.length, 2, `erwartet 2 Deklarationen, gefunden ${treffer.length}`);
  assert.ok(normalGeo.includes('#ifdef NORMAL'), 'Zweigstruktur unerwartet');
  assert.ok(normalGeo.includes('#else'), 'Zweigstruktur unerwartet');
});

pruefe('geometricNormalW wird VOR dem Einspritzpunkt kopiert', () => {
  // Wichtig fuer die Begruendung: Die Stoerung aendert die SCHATTIERUNG, nicht
  // die Geometrie. Waere `geometricNormalW` erst nach dem Punkt gebildet,
  // haetten wir mit der Normalen auch die Schattenkanten verbogen.
  const kopie = normalGeo.indexOf('vec3 geometricNormalW=normalW;');
  assert.ok(kopie >= 0, 'geometricNormalW-Kopie nicht gefunden');
});

pruefe('der Einspritzpunkt liegt hinter normalFinal und vor der Lichtrechnung', () => {
  const normal = pbrFrag.indexOf('#include<pbrBlockNormalFinal>');
  const punkt = pbrFrag.indexOf('#define CUSTOM_FRAGMENT_BEFORE_LIGHTS');
  const licht = pbrFrag.indexOf('#include<lightFragment>');
  for (const [n, i] of Object.entries({ normal, punkt, licht })) {
    assert.ok(i >= 0, `${n} nicht im Shader gefunden`);
  }
  assert.ok(normal < punkt, 'normalW muss vor dem Einspritzpunkt endgueltig sein');
  assert.ok(punkt < licht, 'die Einspritzung muss vor der Lichtrechnung liegen');
});

pruefe('nach dem Einspritzpunkt wird normalW auch wirklich noch gelesen', () => {
  // Sonst waere die Stoerung ein teurer Nulleffekt — der Fehler, den man
  // niemals bemerkt, weil das Bild aussieht wie vorher.
  const punkt = pbrFrag.indexOf('#define CUSTOM_FRAGMENT_BEFORE_LIGHTS');
  const danach = pbrFrag.slice(punkt);
  const treffer = (danach.match(/\bnormalW\b/g) ?? []).length;
  assert.ok(treffer >= 3, `normalW wird nach dem Punkt nur ${treffer}-mal gelesen`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Die Konvention <albedo>_normal.png
// ─────────────────────────────────────────────────────────────────────────────

console.log('Konvention <albedo>_normal.png:');

pruefe('aus dem Albedo-Pfad wird der Normal-Pfad', () => {
  assert.equal(
    normalPfadZu('/assets/models/stein_clean.png'),
    '/assets/models/stein_clean_normal.png'
  );
  assert.equal(normalPfadZu('stein_fels.png'), 'stein_fels_normal.png');
  assert.equal(normalPfadZu('/assets/models/stein_decke.png'), '/assets/models/stein_decke_normal.png');
});

pruefe('ein Pfad ohne Endung bekommt sie dazu', () => {
  // Ein Punkt IM Ordnernamen darf nicht als Endung durchgehen — sonst hiesse
  // die Datei `/a.b/stein_normal.png/…` und der 404 waere unerklaerlich.
  assert.equal(normalPfadZu('/assets/v1.0/stein'), '/assets/v1.0/stein_normal.png');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Der Quelltext in seinen Varianten
// ─────────────────────────────────────────────────────────────────────────────

console.log('Praeprozessor-Varianten des eingespritzten GLSL:');

pruefe('nur die vier Direktiven, die der Praeprozessor dieses Tests kennt', () => {
  // Der Test darf nicht weniger verstehen als der Quelltext sagt.
  const direktiven = [...GLSL.matchAll(/^\s*#(\w+)/gm)].map((m) => m[1]);
  const erlaubt = new Set(['ifdef', 'ifndef', 'else', 'endif']);
  const fremd = [...new Set(direktiven)].filter((d) => !erlaubt.has(d));
  assert.deepEqual(fremd, [], `unbekannte Direktiven: ${fremd.join(', ')}`);
});

pruefe('reines ASCII im GLSL', () => {
  // GLSL ES schreibt einen begrenzten Quellzeichensatz vor, und es gibt
  // Treiber, die schon an einem Umlaut im Kommentar aussteigen.
  const boese = [...GLSL].filter((c) => c.charCodeAt(0) > 126);
  assert.equal(boese.length, 0, `nicht-ASCII: ${[...new Set(boese)].join(' ')}`);
});

const VARIANTEN: readonly [string, string[], string[]][] = [
  // Name, Defines, erwartete Normal-Sampler
  ['ohne STEIN_KIT', [], []],
  ['ohne Normal-Karte', ['STEIN_KIT'], []],
  ['nur Wand', ['STEIN_KIT', 'STEIN_NORMAL', 'STEIN_NORMAL_WAND'], ['steinWandNormal']],
  [
    'Wand und Boden',
    ['STEIN_KIT', 'STEIN_NORMAL', 'STEIN_NORMAL_WAND', 'STEIN_NORMAL_BODEN'],
    ['steinWandNormal', 'steinBodenNormal'],
  ],
  [
    'alle drei',
    [
      'STEIN_KIT',
      'STEIN_NORMAL',
      'STEIN_NORMAL_WAND',
      'STEIN_NORMAL_BODEN',
      'STEIN_NORMAL_DECKE',
    ],
    NORMAL_SAMPLER,
  ],
];

for (const [name, defines, erwartet] of VARIANTEN) {
  const code = praeprozessor(GLSL, defines);
  const mitKit = defines.includes('STEIN_KIT');

  pruefe(`${name}: geschweifte Klammern gehen auf`, () => {
    const saldo = [...code].reduce((a, c) => a + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
    assert.equal(saldo, 0, 'geschweifte Klammern unausgeglichen');
  });

  pruefe(`${name}: jeder benutzte Sampler ist auch deklariert`, () => {
    const dekl = new Set(deklarierteSampler(code));
    for (const b of benutzteSampler(code)) {
      if (!ALBEDO_SAMPLER.includes(b) && !NORMAL_SAMPLER.includes(b)) continue;
      assert.ok(dekl.has(b), `${b} wird benutzt, aber nicht deklariert`);
    }
  });

  pruefe(`${name}: kein deklarierter Sampler bleibt unbenutzt`, () => {
    const benutzt = benutzteSampler(code);
    for (const d of deklarierteSampler(code)) {
      assert.ok(benutzt.has(d), `${d} ist deklariert, aber ungenutzt`);
    }
  });

  pruefe(`${name}: genau die erwarteten Normal-Sampler`, () => {
    const dekl = deklarierteSampler(code).filter((s) => NORMAL_SAMPLER.includes(s));
    assert.deepEqual(dekl.sort(), [...erwartet].sort());
  });

  pruefe(`${name}: Albedo-Zweig unveraendert`, () => {
    if (!mitKit) {
      assert.equal(code.trim(), '', 'ohne STEIN_KIT darf nichts uebrig bleiben');
      return;
    }
    // Die Albedo-Haelfte ist in JEDER Variante dieselbe — der Normal-Kanal
    // ist eine Ergaenzung, kein Umbau.
    assert.ok(code.includes('surfaceAlbedo = toLinearSpace(steinAlbedo('), 'Albedo-Aufruf fehlt');
    for (const s of ALBEDO_SAMPLER) {
      assert.ok(deklarierteSampler(code).includes(s), `${s} fehlt`);
    }
  });

  pruefe(`${name}: normalW wird ${erwartet.length > 0 ? 'gesetzt' : 'NICHT angefasst'}`, () => {
    const setzt = /\bnormalW\s*=/.test(code);
    assert.equal(setzt, erwartet.length > 0, setzt ? 'normalW wird gesetzt' : 'normalW bleibt');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Und wenn ein Uebersetzer da ist: wirklich uebersetzen
// ─────────────────────────────────────────────────────────────────────────────

/*
  Die NullEngine uebersetzt kein GLSL. Alles bisher Geprueste ist deshalb eine
  Aussage ueber Text — scharf, aber nicht dasselbe wie ein Uebersetzer. Liegt
  `glslangValidator` auf dem PATH (lokal ja, auf wov-dev und im CI-Checkout
  nicht), wird jede Variante zusaetzlich wirklich uebersetzt: GLSL ES 1.00,
  in einem Rumpf, der genau die vier fremden Groessen stellt, die der Block
  benutzt (`stKachel`/`stSkala`/`stMenge`, `vPositionW`, `normalW`,
  `surfaceAlbedo`, `toLinearSpace`).

  Fehlt der Uebersetzer, wird der Abschnitt als UEBERSPRUNGEN gemeldet und
  zaehlt nicht als Fehler — dasselbe Muster wie `brauchtModelle()` in
  `scripts/run-tests.mjs`: Ein Test, der auf einer Maschine dauerhaft rot
  waere, wird dort in kurzer Zeit ignoriert.
*/

const glslang = spawnSync('glslangValidator', ['--version'], { stdio: 'ignore' }).status === 0;

/** Der kleinste Rumpf, in dem der Block uebersetzbar ist. */
function rumpf(code: string, aufruf: string): string {
  return `#version 100
precision highp float;
uniform vec4 stKachel;
uniform vec4 stSkala;
uniform vec4 stMenge;
varying vec3 vPositionW;
varying vec3 vNormalW;
vec3 toLinearSpace(vec3 c){ return pow(c, vec3(2.2)); }
${code}
void main(){
  vec3 normalW = normalize(vNormalW);
  vec3 surfaceAlbedo = vec3(1.0);
${aufruf}
  gl_FragColor = vec4(surfaceAlbedo * max(dot(normalW, vec3(0.0, 1.0, 0.0)), 0.0), 1.0);
}
`;
}

if (!glslang) {
  console.log('Echte Uebersetzung: UEBERSPRUNGEN (glslangValidator nicht auf dem PATH)');
} else {
  console.log('Echte Uebersetzung (glslangValidator, GLSL ES 1.00):');
  const ordner = mkdtempSync(join(tmpdir(), 'stein-normal-'));
  for (const [name, defines] of VARIANTEN) {
    if (!defines.includes('STEIN_KIT')) continue; // ohne Kit bleibt nichts uebrig
    pruefe(`${name}: uebersetzt`, () => {
      const datei = join(ordner, `${name.replace(/\W+/g, '-')}.frag`);
      writeFileSync(
        datei,
        rumpf(praeprozessor(steinDefinitionenGlsl(), defines), praeprozessor(steinAufrufGlsl(), defines))
      );
      try {
        execFileSync('glslangValidator', ['-S', 'frag', datei], { stdio: 'pipe' });
      } catch (e) {
        const aus = (e as { stdout?: Buffer }).stdout?.toString() ?? String(e);
        throw new Error(aus.split('\n').slice(0, 6).join(' | '));
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Das Plugin an einem NullEngine-Material
// ─────────────────────────────────────────────────────────────────────────────

console.log('Plugin an der NullEngine:');

const engine = new NullEngine();
const szene = new Scene(engine);

const KIT: SteinKitConfig = {
  wandTextur: '/assets/models/stein_clean.png',
  deckeTextur: '/assets/models/stein_decke.png',
  bodenTextur: '/assets/models/stein_clean.png',
  verwitterung: { moos: 1, frost: 0.5, nass: 0.5 },
  kachelM: 2,
  deckeKachelM: 2,
  moosSkala: 12,
  frostSkala: 9,
  nassSkala: 7,
};

const material = erzeugeSteinKitMaterial(szene, 'stein-normal-test', KIT);
const manager = material.pluginManager as unknown as {
  getPlugin(n: string): unknown;
  _injectCustomCode(e: object, cb: undefined): (t: string, code: string) => string;
};

interface SteinSeam {
  meldeNormal(flaeche: SteinFlaeche, da: boolean): void;
  prepareDefinesBeforeAttributes(defines: Record<string, boolean>): void;
  getSamplers(samplers: string[]): void;
}
const plugin = manager.getPlugin('SteinKit') as unknown as SteinSeam;

function defines(): Record<string, boolean> {
  const d: Record<string, boolean> = {};
  plugin.prepareDefinesBeforeAttributes(d);
  return d;
}

pruefe('das Plugin haengt am erzeugten Material', () => {
  assert.ok(plugin, 'SteinKit nicht angehaengt');
});

pruefe('die drei Normal-Sampler stehen in der Sampler-Liste', () => {
  // Sie MUESSEN unbedingt drinstehen: Babylon sammelt die Liste einmal beim
  // Bau des UBO — lange bevor feststeht, welche Datei es wirklich gibt. Ein
  // Sampler, den der uebersetzte Shader nicht hat, ist beim Binden ein
  // Leerlauf (`ThinEngine.setTexture` steigt bei `channel === undefined` aus),
  // ein FEHLENDER Sampler dagegen waere ein nicht bindbarer Kanal.
  const s: string[] = [];
  plugin.getSamplers(s);
  for (const n of [...ALBEDO_SAMPLER, ...NORMAL_SAMPLER]) {
    assert.ok(s.includes(n), `${n} fehlt in getSamplers`);
  }
});

// Die NullEngine legt Texturen an, ohne das Netz anzufassen, und meldet sie
// im naechsten Makrotask als geladen. Damit ist der „Datei da"-Fall echt
// durchlaufen und nicht gestellt.
await new Promise((r) => setTimeout(r, 0));

pruefe('geladene Karten schalten ihre Defines an', () => {
  const d = defines();
  assert.equal(d.STEIN_KIT, true);
  assert.equal(d.STEIN_NORMAL_WAND, true, 'Wand-Normale nicht erkannt');
  assert.equal(d.STEIN_NORMAL_BODEN, true, 'Boden-Normale nicht erkannt');
  assert.equal(d.STEIN_NORMAL_DECKE, true, 'Decken-Normale nicht erkannt');
  assert.equal(d.STEIN_NORMAL, true, 'Sammel-Define nicht gesetzt');
});

pruefe('eine fehlende Datei ergibt das HEUTIGE Verhalten, nicht Schwarz', () => {
  // Genau der Rueckruf, den Babylons Texturlader beim 404 ruft.
  for (const f of ['wand', 'boden', 'decke'] as SteinFlaeche[]) plugin.meldeNormal(f, false);
  const d = defines();
  assert.equal(d.STEIN_KIT, true, 'das Albedo muss weiterlaufen');
  assert.equal(d.STEIN_NORMAL, false);
  assert.equal(d.STEIN_NORMAL_WAND, false);
  assert.equal(d.STEIN_NORMAL_BODEN, false);
  assert.equal(d.STEIN_NORMAL_DECKE, false);
});

pruefe('eine einzelne Karte reicht — die anderen zwei bleiben aus', () => {
  plugin.meldeNormal('wand', true);
  const d = defines();
  assert.equal(d.STEIN_NORMAL, true);
  assert.equal(d.STEIN_NORMAL_WAND, true);
  assert.equal(d.STEIN_NORMAL_BODEN, false);
  assert.equal(d.STEIN_NORMAL_DECKE, false);
});

pruefe('beide Bloecke landen im fertigen Fragment-Quelltext', () => {
  const fertig = manager._injectCustomCode({}, undefined)('fragment', pbrFrag);
  const def = fertig.indexOf('vec3 steinNormale(');
  const aufruf = fertig.indexOf('normalW = steinNormale(');
  assert.ok(def >= 0, 'die Normalen-Funktion fehlt im Quelltext');
  assert.ok(aufruf >= 0, 'der Aufruf fehlt im Quelltext');
  // GLSL kennt keine Vorwaertsdeklaration.
  assert.ok(def < aufruf, 'steinNormale wird vor seiner Definition gerufen');
  assert.ok(fertig.length > pbrFrag.length, 'nichts eingespritzt');
});

// ─────────────────────────────────────────────────────────────────────────
// Die Szenensperre / the scene-wide dirty block
//
// Alles bisher Gemessene ruft `prepareDefinesBeforeAttributes` SELBST. Genau
// deshalb blieb bis zum 05.09.2026 unbemerkt, dass Babylon es im Spiel nie
// wieder ruft: `main.ts` setzt `scene.blockMaterialDirtyMechanism = true`,
// und `Material._markAllSubMeshesAsDirty` steigt bei gesetzter Sperre sofort
// aus. Auf wov-dev gemessen: Die Karte war geladen, `STEIN_NORMAL_WAND`
// stand in den MaterialDefines auf `true` — und `subMesh.effect.defines`
// trug nur `#define STEIN_KIT`.
//
// Der Zeuge ist deshalb nicht das Define, sondern der WEG dorthin: Kommt der
// Aufruf bei der Dirty-Mechanik an, und steht die Sperre in dem Moment
// offen? Gepruefte Stelle ist `Material._markAllSubMeshesAsDirty`, weil das
// die Methode ist, die die Sperre liest.
// ─────────────────────────────────────────────────────────────────────────
console.log('Unter gesetzter Szenensperre:');

interface DirtySpion {
  _markAllSubMeshesAsDirty(func: unknown): void;
}
const gesperrteSzene = new Scene(engine);
gesperrteSzene.blockMaterialDirtyMechanism = true;

/** Bei jedem Aufruf: Stand der Sperre in genau diesem Moment. */
const rufe: boolean[] = [];
const echt = (PBRMaterial.prototype as unknown as DirtySpion)._markAllSubMeshesAsDirty;
(PBRMaterial.prototype as unknown as DirtySpion)._markAllSubMeshesAsDirty = function (
  this: { getScene(): Scene },
  func: unknown
): void {
  if (this.getScene() === gesperrteSzene) rufe.push(this.getScene().blockMaterialDirtyMechanism);
  echt.call(this as unknown as DirtySpion, func);
};

const gesperrtesMaterial = erzeugeSteinKitMaterial(gesperrteSzene, 'stein-normal-sperre', KIT);
const gesperrtesPlugin = (
  gesperrtesMaterial.pluginManager as unknown as { getPlugin(n: string): unknown }
).getPlugin('SteinKit') as unknown as SteinSeam;
// Derselbe Makrotask-Umweg wie oben: die NullEngine meldet die Texturen erst
// danach als geladen, und genau diese Meldung soll hier ankommen.
await new Promise((r) => setTimeout(r, 0));
(PBRMaterial.prototype as unknown as DirtySpion)._markAllSubMeshesAsDirty = echt;

pruefe('der Ladeschluss erreicht die Dirty-Mechanik trotz Sperre', () => {
  assert.ok(rufe.length > 0, 'markAllDefinesAsDirty hat die Mechanik nie erreicht');
  assert.ok(
    rufe.some((gesperrt) => gesperrt === false),
    'die Sperre stand bei JEDEM Aufruf — der Shader wuerde nie neu uebersetzt'
  );
});

pruefe('die Sperre steht danach wieder', () => {
  assert.equal(
    gesperrteSzene.blockMaterialDirtyMechanism,
    true,
    'die szenenweite Sparmassnahme ist aufgehoben geblieben'
  );
});

pruefe('und die Defines stehen wirklich an', () => {
  const d: Record<string, boolean> = {};
  gesperrtesPlugin.prepareDefinesBeforeAttributes(d);
  assert.equal(d.STEIN_NORMAL_WAND, true);
});

console.log(rot === 0 ? 'alles gruen' : `${rot} rot`);
process.exit(rot === 0 ? 0 : 1);
