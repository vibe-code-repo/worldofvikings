/**
 * Prueft die gebackene VERSCHATTUNG des Steinmaterials ohne GPU (Mass D).
 * Checks the baked cavity term of the stone material without a GPU.
 *
 * ── Warum es diesen Test gibt ─────────────────────────────────────────
 * Am 05.09.2026 ist gemessen worden, dass in der Krypta KEIN gerichtetes
 * Licht steht: Die Sonne ist auf 0, uebrig bleibt ein `HemisphericLight`,
 * dessen Beitrag auf einer senkrechten Wand ueberall gleich ist. Der
 * Relieffaktor sigma/mu mit gegen ohne Normal-Kanal war 1,001 — das
 * Relief war da, es zeigte sich nur nicht.
 *
 * Die Antwort darauf ist eine Farbe IM NETZ (COLOR_0, aus der Kruemmung
 * des Hoehenfeldes gebacken), die im Shader multiplikativ aufs Albedo
 * geht. Sie braucht kein Licht — aber sie haengt an drei Stellen, die
 * alle still ausfallen koennen:
 *
 *  1. **Der Einspritzpunkt.** `steinAufrufGlsl()` ERSETZT `surfaceAlbedo`.
 *     Babylons eigenes `surfaceAlbedo *= vColor.rgb` steht VORHER
 *     (`pbrBlockAlbedoOpacity`) und waere damit weggeworfen. Ohne die
 *     eigene Zeile traegt jedes Modul die Farbe im Netz und zeigt sie
 *     nie — und das sieht genau aus wie „die Verschattung wirkt nicht".
 *  2. **Die Deklaration.** `vColor` gibt es im PBR-Fragment nur unter
 *     `VERTEXCOLOR`. Steht unsere Zeile ausserhalb dieses `#ifdef`,
 *     uebersetzt der Shader fuer die ZIEGELmodule nicht mehr — und die
 *     Notbremse schaltet dann das ganze Grab grau.
 *  3. **Das Alphaflag.** Der glTF-Lader setzt `hasVertexAlpha`, sobald
 *     `COLOR_0` VEC4 ist, ohne hineinzusehen. Blender schreibt IMMER
 *     VEC4. `entschaerfeVertexAlpha` nimmt das zurueck, wenn die Spalte
 *     durchweg 1 ist — und darf es NICHT zuruecknehmen, wenn nicht.
 *
 * Alle drei werden hier am installierten Babylon gemessen, nicht aus dem
 * Gedaechtnis behauptet. Das reale BILD misst
 * `tools/elements/pruefung/relief-kontrast.mjs --kanal=cavity`; kein Test
 * hier ersetzt das (Gedaechtnis „Gruene Tests sind kein Fenster").
 */
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import '@babylonjs/core/Shaders/pbr.fragment';
import '@babylonjs/core/Shaders/pbr.vertex';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cavityStaerke, steinAufrufGlsl, steinDefinitionenGlsl } from '../src/engine/DungeonSteinMaterial';
import { entschaerfeVertexAlpha } from '../src/engine/AssetManager';

let gruen = 0;
const pruefe = (name: string, bedingung: boolean, hinweis = ''): void => {
  assert.ok(bedingung, `${name}${hinweis ? ` — ${hinweis}` : ''}`);
  gruen += 1;
  console.log(`  ok   ${name}`);
};

console.log('Steinmaterial — gebackene Verschattung (Cavity)\n');

// ── 1. Der Einspritzpunkt multipliziert die Vertexfarbe ────────────────
{
  const glsl = steinAufrufGlsl();
  pruefe(
    'der Aufruf multipliziert vColor auf surfaceAlbedo',
    /surfaceAlbedo\s*\*=\s*mix\(vec3\(1\.0\),\s*vColor\.rgb/.test(glsl)
  );
  // Die Zeile MUSS in einem VERTEXCOLOR-Block stehen: `vColor` ist sonst
  // nicht deklariert, und der Shader der Ziegelmodule uebersetzt nicht.
  const block = glsl.slice(glsl.indexOf('#ifdef VERTEXCOLOR'));
  pruefe(
    'sie steht innerhalb von #ifdef VERTEXCOLOR',
    glsl.includes('#ifdef VERTEXCOLOR') && block.indexOf('vColor.rgb') < block.indexOf('#endif')
  );
  pruefe('die Stärke kommt aus stMenge.w (?cavity=)', glsl.includes('stMenge.w'));
  // Bei Stärke 0 ist `mix(vec3(1), vColor.rgb, 0)` genau vec3(1) — ein
  // Modul mit Farbschicht rechnet dann Zeile für Zeile wie vor Mass D.
  // Das ist die A/B-Stellung, auf der relief-kontrast.mjs --kanal=cavity
  // steht; wäre der Nullpunkt kein Nullpunkt, verglichen beide Läufe
  // zwei verschiedene Bilder und der Faktor wäre eine Zufallszahl.
  pruefe('bei Stärke 0 ist der Faktor exakt 1 (mix gegen vec3(1.0))',
    /mix\(vec3\(1\.0\),\s*vColor\.rgb,\s*stMenge\.w\)/.test(glsl));
  // Und ohne Adressparameter steht sie auf der VORGABE — die Verschattung
  // ist die Vorgabe, nicht ein Schalter, den jemand setzen muss. Sie steht
  // seit dem 05.09.2026 auf 2: bei der gebackenen Stärke 1 senkt sie die
  // Wand um 11,5 % und hebt σ/µ von 0,225 auf 0,244, was unter dem
  // Sprenkeln der Albedo-Kachel nicht zu lesen ist (Zahlen im Kommentar
  // an CAVITY_VORGABE).
  pruefe('ohne ?cavity= ist die Stärke 2', cavityStaerke() === 2);
}

// ── 2. Babylon deklariert vColor unter genau diesem Schlüssel ──────────
{
  const decl = ShaderStore.IncludesShadersStore['pbrFragmentExtraDeclaration'];
  const frag = ShaderStore.ShadersStore['pbrPixelShader'];
  pruefe('das installierte Babylon deklariert `varying vec4 vColor`',
    typeof decl === 'string' && decl.includes('varying vec4 vColor;'));
  pruefe('und zwar unter VERTEXCOLOR',
    /#if\s+defined\(VERTEXCOLOR\)[^\n]*\nvarying vec4 vColor;/.test(decl));
  pruefe('die Deklaration steht VOR unserem Einspritzpunkt',
    frag.indexOf('pbrFragmentExtraDeclaration') < frag.indexOf('CUSTOM_FRAGMENT_BEFORE_LIGHTS'));
  // Der Grund für die eigene Zeile: Babylons Multiplikation liegt im
  // Albedoblock, und der läuft VOR uns — wir überschreiben sie.
  const albedo = ShaderStore.IncludesShadersStore['pbrBlockAlbedoOpacity'];
  pruefe('Babylons eigenes vColor liegt im Albedoblock (den wir überschreiben)',
    typeof albedo === 'string' && albedo.includes('surfaceAlbedo*=vColor.rgb'));
  pruefe('und dieser Block läuft vor dem Einspritzpunkt',
    frag.indexOf('pbrBlockAlbedoOpacity') < frag.indexOf('CUSTOM_FRAGMENT_BEFORE_LIGHTS'));
}

// ── 3. Das Alphaflag ───────────────────────────────────────────────────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);

  const bauen = (alphas: number[]): Mesh => {
    const m = new Mesh('probe', scene);
    const n = alphas.length;
    m.setVerticesData(
      VertexBuffer.PositionKind,
      Array.from({ length: n * 3 }, (_, i) => i)
    );
    m.setVerticesData(
      VertexBuffer.ColorKind,
      alphas.flatMap((a) => [0.8, 0.8, 0.8, a])
    );
    // Das setzt sonst der glTF-Lader, sobald COLOR_0 vier Komponenten hat.
    m.hasVertexAlpha = true;
    return m;
  };

  const voll = bauen([1, 1, 1, 1]);
  entschaerfeVertexAlpha(voll);
  pruefe('Alphaspalte durchweg 1 -> hasVertexAlpha fällt', voll.hasVertexAlpha === false);

  const echt = bauen([1, 1, 0.4, 1]);
  entschaerfeVertexAlpha(echt);
  pruefe('echtes Vertexalpha bleibt stehen', echt.hasVertexAlpha === true);

  const ohne = new Mesh('ohne', scene);
  ohne.setVerticesData(VertexBuffer.PositionKind, [0, 0, 0, 1, 1, 1, 2, 2, 2]);
  ohne.hasVertexAlpha = true;
  entschaerfeVertexAlpha(ohne);
  pruefe('ohne Farbspalte bleibt alles, wie es war', ohne.hasVertexAlpha === true);

  scene.dispose();
  engine.dispose();
}

// ── 4. Beide Varianten wirklich uebersetzen ───────────────────────────
/*
  Die NullEngine uebersetzt kein GLSL; alles bisher Geprueste ist eine
  Aussage ueber TEXT. Genau hier ist das zu wenig: Die neue Zeile steht in
  einem `#ifdef`, und der teuerste Fehler waere, dass sie den Shader der
  ZIEGELmodule nicht mehr uebersetzen laesst — dann schaltet die Notbremse
  das ganze Grab grau, und kein Textmuster haette es gesagt.

  Uebersetzt wird deshalb ZWEIMAL: einmal mit `VERTEXCOLOR` (das Fels-Kit,
  dessen Netz ein COLOR_0 mitbringt) und einmal ohne (Ziegel). Und zwar
  ohne eigenen Praeprozessor — `glslangValidator` bringt seinen mit; ein
  nachgebauter prueft am Ende sich selbst.

  Fehlt der Uebersetzer (wov-dev, CI-Checkout), meldet sich der Abschnitt
  als uebersprungen. Muster `brauchtModelle()` in scripts/run-tests.mjs:
  ein Test, der auf einer Maschine dauerhaft rot waere, ist dort keiner.
*/
{
  const glslang = spawnSync('glslangValidator', ['--version'], { stdio: 'ignore' }).status === 0;
  if (!glslang) {
    console.log('\n  --   echte Uebersetzung UEBERSPRUNGEN (glslangValidator nicht auf dem PATH)');
  } else {
    console.log('\nEchte Uebersetzung (glslangValidator, GLSL ES 1.00):');
    const ordner = mkdtempSync(join(tmpdir(), 'stein-cavity-'));
    // Nur die Groessen, die der Block wirklich braucht — `vColor` steht
    // wie im PBR-Fragment hinter demselben `#ifdef`.
    const rumpf = (vertexcolor: boolean): string => `#version 100
precision highp float;
#define STEIN_KIT
${vertexcolor ? '#define VERTEXCOLOR' : ''}
uniform vec4 stKachel;
uniform vec4 stSkala;
uniform vec4 stMenge;
varying vec3 vPositionW;
varying vec3 vNormalW;
#ifdef VERTEXCOLOR
varying vec4 vColor;
#endif
vec3 toLinearSpace(vec3 c){ return pow(c, vec3(2.2)); }
${steinDefinitionenGlsl()}
void main(){
  vec3 normalW = normalize(vNormalW);
  vec3 surfaceAlbedo = vec3(1.0);
${steinAufrufGlsl()}
  gl_FragColor = vec4(surfaceAlbedo, 1.0);
}
`;
    for (const [name, vertexcolor] of [
      ['mit COLOR_0 (Fels)', true],
      ['ohne COLOR_0 (Ziegel)', false],
    ] as const) {
      const datei = join(ordner, `${vertexcolor ? 'mit' : 'ohne'}.frag`);
      writeFileSync(datei, rumpf(vertexcolor));
      let fehler = '';
      try {
        execFileSync('glslangValidator', ['-S', 'frag', datei], { stdio: 'pipe' });
      } catch (e) {
        fehler = ((e as { stdout?: Buffer }).stdout?.toString() ?? String(e))
          .split('\n').slice(0, 6).join(' | ');
      }
      pruefe(`uebersetzt ${name}`, fehler === '', fehler);
      // Zeuge, dass die beiden Varianten nicht derselbe Shader sind. Ohne
      // ihn waere die Uebersetzung oben zweimal derselbe Text, und der
      // Ziegel-Fall geprueft, ohne geprueft zu sein. Gefragt wird der
      // Praeprozessor des Uebersetzers selbst (`-E`), nicht der Quelltext:
      // Ein Kommentar, der `vColor` bloss ERWAEHNT, ist keine Verwendung.
      const nachher = execFileSync('glslangValidator', ['-E', datei], { encoding: 'utf8' });
      pruefe(
        vertexcolor
          ? 'nach dem Praeprozessor steht `vColor` im Fels-Shader'
          : 'nach dem Praeprozessor steht `vColor` NICHT im Ziegel-Shader',
        nachher.includes('vColor') === vertexcolor
      );
    }
  }
}

console.log(`\n${gruen} Prüfungen grün.`);
