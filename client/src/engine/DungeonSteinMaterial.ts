/**
 * KI-Steinmaterial für den 1.0-Steingrab-Kit — als `MaterialPluginBase` auf
 * einem gewöhnlichen `PBRMaterial`, damit die ECHTE Spielbeleuchtung greift:
 * Sonne + Hemisphäre (`Lighting.ts`), Nebel (`NebelRichtung.ts`), CSM-Schatten
 * und vor allem der Fackel-Pool (`FackelLicht.ts` hängt nur an
 * `PBRMaterial`/`StandardMaterial`). Ein bare `ShaderMaterial` bekäme nichts
 * davon — deshalb dieser Weg, exakt nach dem Muster von `DungeonMaterial.ts`
 * (dem 2.0-Triplanar-Material).
 *
 * Die Logik (Triplanar je Fläche Wand/Decke/Boden + elementübergreifend
 * eingestreute Verwitterung Moos/Frost/Nass aus Weltraum-Masken) ist der
 * Prüfstand `steingrabPreview.ts`, hier aber OHNE eigene Fackel/Ambient — das
 * liefert jetzt die PBR-Pipeline. Wand/Decke/Boden werden per WELTNORMALE
 * getrennt, weil die Kit-GLBs EIN verschmolzenes Mesh sind (keine getrennten
 * Submeshes). Weltposition/-normale kommen aus `vPositionW`/`normalW`, die die
 * PBR-Pipeline pro Thin-Instance korrekt liefert.
 *
 * Reines GLSL, Grund wie in `DungeonMaterial.ts`.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { Scene } from '@babylonjs/core/scene';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { SteinKitConfig } from '@wov/shared';

const MODELLE = '/assets/models/';

/** Die sechs Texturen eines Steinmaterials, in Bindungsreihenfolge. */
interface SteinTexturen {
  wand: Texture;
  boden: Texture;
  decke: Texture;
  moos: Texture;
  frost: Texture;
  nass: Texture;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GLSL-Bausteine / GLSL fragments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `CUSTOM_FRAGMENT_DEFINITIONS`: Sampler + Hilfsfunktionen + `steinAlbedo()`.
 * Die drei `uniform vec4` (`stKachel`/`stSkala`/`stMenge`) werden NICHT hier
 * deklariert — sie liegen im Material-UBO und injiziert Babylon über
 * `getUniforms()`. Sampler dagegen müssen im GLSL stehen.
 */
function steinDefinitionenGlsl(): string {
  return /* glsl */ `
#ifdef STEIN_KIT
  uniform sampler2D steinWand;
  uniform sampler2D steinBoden;
  uniform sampler2D steinDecke;
  uniform sampler2D steinMoos;
  uniform sampler2D steinFrost;
  uniform sampler2D steinNass;

  float stHash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
  float stNoise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    float a=stHash(i), b=stHash(i+vec2(1.,0.)), c=stHash(i+vec2(0.,1.)), d=stHash(i+vec2(1.,1.));
    vec2 u=f*f*(3.-2.*f);
    return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
  }
  float stFbm(vec2 p){ return 0.6*stNoise(p)+0.3*stNoise(p*2.03)+0.1*stNoise(p*4.01); }

  vec3 stTri(sampler2D t, vec3 wp, vec3 n, float inv){
    vec3 bw = abs(n); bw /= (bw.x+bw.y+bw.z + 1e-4);
    vec3 cx = texture2D(t, wp.zy*inv).rgb;
    vec3 cy = texture2D(t, wp.xz*inv).rgb;
    vec3 cz = texture2D(t, wp.xy*inv).rgb;
    return cx*bw.x + cy*bw.y + cz*bw.z;
  }

  vec3 steinAlbedo(vec3 wp, vec3 n){
    float invW = stKachel.x;
    vec3 wand  = stTri(steinWand,  wp, n, invW);
    vec3 boden = stTri(steinBoden, wp, n, invW);
    vec3 moss  = stTri(steinMoos,  wp, n, invW);
    vec3 frost = stTri(steinFrost, wp, n, invW);
    vec3 wet   = stTri(steinNass,  wp, n, invW);

    // Flächen per Weltnormale: dieses Kit -> Decke +y, Boden -y.
    float sw = stKachel.z;
    float decke = smoothstep(sw, sw + 0.35, n.y);
    float boch  = smoothstep(sw, sw + 0.35, -n.y);
    vec3 deckeC = texture2D(steinDecke, wp.xz * stKachel.y).rgb;

    // Große Weltraum-Masken -> Flecken über mehrere Kit-Teile, nahtlos.
    float mMask = smoothstep(0.52, 0.78, stFbm(wp.xz / stSkala.x))            * stMenge.x;
    float fMask = smoothstep(0.58, 0.84, stFbm(wp.xz / stSkala.y + 31.7))     * stMenge.y;
    float wMask = smoothstep(0.50, 0.80, stFbm(wp.xz / stSkala.z + 71.3))     * stMenge.z;
    fMask *= smoothstep(1.2, 3.0, wp.y);   // Frost eher oben
    wMask *= smoothstep(2.2, 0.2, wp.y);   // Nass eher unten
    wMask *= (1.0 - decke);
    mMask *= (1.0 - decke);

    vec3 albedo = mix(wand, boden, boch);
    albedo = mix(albedo, deckeC, decke);
    albedo = mix(albedo, moss,  mMask);
    albedo = mix(albedo, wet,   wMask);
    albedo = mix(albedo, frost, fMask);
    return albedo;
  }
#endif`;
}

/**
 * `CUSTOM_FRAGMENT_BEFORE_LIGHTS`: der einzige Punkt, an dem `surfaceAlbedo` und
 * `normalW` beide da und noch änderbar sind und der VOR der Lichtrechnung liegt
 * (wie `dungeonAufrufGlsl` in 2.0). Die PNGs sind sRGB -> `toLinearSpace`.
 */
function steinAufrufGlsl(): string {
  return /* glsl */ `
#ifdef STEIN_KIT
  surfaceAlbedo = toLinearSpace(steinAlbedo(vPositionW, normalize(normalW)));
#endif`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Plugin / plugin
// ─────────────────────────────────────────────────────────────────────────────

/** Alle lebenden Plugins — für die gemeinsame Notbremse. */
const angehaengt = new Set<SteinKitPlugin>();

class SteinKitPlugin extends MaterialPluginBase {
  private an = true;
  private cfg: SteinKitConfig;
  private tex: SteinTexturen;

  constructor(material: Material, cfg: SteinKitConfig, tex: SteinTexturen) {
    // Priorität 10: weit vor NebelRichtung/FackelLicht (120). Wir ERSETZEN
    // Albedo vor `finalColor`; jene korrigieren das fertige Ergebnis. Der
    // sechste Parameter (`enable`) MUSS true sein. Alle Defines müssen hier
    // stehen (collectDefines legt genau diese Schlüssel an) — s. DungeonMaterial.
    super(material, 'SteinKit', 10, { STEIN_KIT: true }, true, true);
    this.cfg = cfg;
    this.tex = tex;
    angehaengt.add(this);
  }

  override getClassName(): string {
    return 'SteinKitPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  setzeAn(an: boolean): void {
    if (this.an === an) return;
    this.an = an;
    this.markAllDefinesAsDirty();
  }

  override prepareDefinesBeforeAttributes(defines: MaterialDefines): void {
    defines.STEIN_KIT = this.an;
  }

  override isReadyForSubMesh(): boolean {
    if (!this.an) return true;
    const t = this.tex;
    return (
      t.wand.isReady() &&
      t.boden.isReady() &&
      t.decke.isReady() &&
      t.moos.isReady() &&
      t.frost.isReady() &&
      t.nass.isReady()
    );
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('steinWand', 'steinBoden', 'steinDecke', 'steinMoos', 'steinFrost', 'steinNass');
  }

  /** In den BESTEHENDEN Material-UBO-Block — kein eigener Block (UBO-Budget). */
  override getUniforms(): { ubo: Array<{ name: string; size: number; type: string }> } {
    return {
      ubo: [
        // x = 1/kachelM (Wand/Boden), y = 1/deckeKachelM, z = Deckenschwelle, w = frei
        { name: 'stKachel', size: 4, type: 'vec4' },
        // x = moosSkala, y = frostSkala, z = nassSkala, w = frei
        { name: 'stSkala', size: 4, type: 'vec4' },
        // x = moos, y = frost, z = nass, w = frei
        { name: 'stMenge', size: 4, type: 'vec4' },
      ],
    };
  }

  override bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): void {
    if (!this.an) return;
    const c = this.cfg;
    uniformBuffer.updateFloat4(
      'stKachel',
      1 / Math.max(c.kachelM, 1e-3),
      1 / Math.max(c.deckeKachelM, 1e-3),
      c.deckeSchwelle ?? 0.45,
      0
    );
    uniformBuffer.updateFloat4(
      'stSkala',
      Math.max(c.moosSkala, 1e-3),
      Math.max(c.frostSkala, 1e-3),
      Math.max(c.nassSkala, 1e-3),
      0
    );
    uniformBuffer.updateFloat4(
      'stMenge',
      c.verwitterung.moos,
      c.verwitterung.frost,
      c.verwitterung.nass,
      0
    );
    const t = this.tex;
    uniformBuffer.setTexture('steinWand', t.wand);
    uniformBuffer.setTexture('steinBoden', t.boden);
    uniformBuffer.setTexture('steinDecke', t.decke);
    uniformBuffer.setTexture('steinMoos', t.moos);
    uniformBuffer.setTexture('steinFrost', t.frost);
    uniformBuffer.setTexture('steinNass', t.nass);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage?: ShaderLanguage
  ): Record<string, string> | null {
    if (shaderLanguage !== undefined && shaderLanguage !== ShaderLanguage.GLSL) return null;
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: steinDefinitionenGlsl(),
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: steinAufrufGlsl(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Notbremse, URL-Regler, Fabrik / brake, url knobs, factory
// ─────────────────────────────────────────────────────────────────────────────

/** `?stein=off` schaltet das Plugin ab (A/B ohne Codeänderung). */
function steinAbgeschaltet(): boolean {
  try {
    return new URLSearchParams(location.search).get('stein') === 'off';
  } catch {
    return false;
  }
}

/** Sitzungsweise Notbremse: bei Übersetzungsfehler alle Plugins grau schalten. */
export function steinNotbremse(grund: string): void {
  console.error(`[steinKit] Notbremse: ${grund} — Grab bleibt grau, aber begehbar.`);
  for (const p of angehaengt) p.setzeAn(false);
}

/** Config-Überlagerung aus der Adresszeile — Test-Sofortregler wie im Prüfstand. */
function mitUrlReglern(cfg: SteinKitConfig): SteinKitConfig {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(location.search);
  } catch {
    return cfg;
  }
  const z = (k: string, v: number): number => {
    const s = p.get(k);
    return s === null ? v : Number(s);
  };
  const pfad = (k: string, v: string): string => p.get(k) ?? v;
  return {
    ...cfg,
    wandTextur: pfad('wand', cfg.wandTextur),
    deckeTextur: pfad('decke', cfg.deckeTextur),
    bodenTextur: pfad('boden', cfg.bodenTextur),
    verwitterung: {
      moos: z('moos', cfg.verwitterung.moos),
      frost: z('frost', cfg.verwitterung.frost),
      nass: z('nass', cfg.verwitterung.nass),
    },
    kachelM: z('tile', cfg.kachelM),
    deckeKachelM: z('deckentile', cfg.deckeKachelM),
  };
}

function ladeTextur(scene: Scene, datei: string): Texture {
  // Pfad kann absolut (/assets/…) oder bloßer Dateiname sein; letzterer wird
  // relativ zum Modellordner aufgelöst.
  const url = datei.startsWith('/') || datei.startsWith('http') ? datei : MODELLE + datei;
  return new Texture(url, scene, false, false); // mit Mipmaps, invertY=false (wie Prüfstand)
}

/**
 * Raum-Override über die Kit-Vorgabe legen — nur gesetzte Felder gewinnen,
 * `verwitterung` wird tief gemischt. So kann ein Raum (z. B. Kammer) andere
 * Texturen tragen als der Rest des Kits.
 */
export function mergeSteinKit(
  basis: SteinKitConfig,
  ueber?: Partial<SteinKitConfig>
): SteinKitConfig {
  if (!ueber) return basis;
  return {
    ...basis,
    ...ueber,
    verwitterung: { ...basis.verwitterung, ...(ueber.verwitterung ?? {}) },
  };
}

/**
 * DAS Steinmaterial eines 1.0-Kits. Fällt auf ein graues, begehbares
 * PBRMaterial zurück, wenn `?stein=off` gesetzt ist oder der Shader nicht
 * übersetzt (Notbremse).
 */
export function erzeugeSteinKitMaterial(
  scene: Scene,
  name: string,
  config: SteinKitConfig
): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  // Wie 2.0: METALLICWORKFLOW + kein Himmelsschimmer im Innenraum.
  mat.metallic = 0;
  mat.roughness = 1;
  mat.albedoColor = new Color3(0.62, 0.6, 0.56); // Rückfallgrau ohne Plugin
  mat.environmentIntensity = 0.35;
  // Der Kit hat invertierte Normalen (Decke +y) — beide Seiten zeichnen.
  mat.backFaceCulling = false;

  if (steinAbgeschaltet()) {
    console.warn('[steinKit] ?stein=off — Grab bleibt grau (A/B-Messung).');
    return mat;
  }

  const cfg = mitUrlReglern(config);
  const tex: SteinTexturen = {
    wand: ladeTextur(scene, cfg.wandTextur),
    boden: ladeTextur(scene, cfg.bodenTextur),
    decke: ladeTextur(scene, cfg.deckeTextur),
    moos: ladeTextur(scene, cfg.moosTextur ?? '/assets/models/stein_moos.png'),
    frost: ladeTextur(scene, cfg.frostTextur ?? '/assets/models/stein_frost.png'),
    nass: ladeTextur(scene, cfg.nassTextur ?? '/assets/models/stein_wet.png'),
  };

  new SteinKitPlugin(mat, cfg, tex);

  // Rückfallebene wie in `erzeugeDungeonMaterial`: `Material.onError` ist ein
  // EINZELNER Rückruf — vorhandenen weiterreichen, nicht überschreiben.
  const alt = mat.onError;
  mat.onError = (effect, fehler) => {
    if (fehler && /uniform|too many|exceed|compile|sampler/i.test(fehler)) {
      steinNotbremse(`Übersetzungsfehler an ${mat.name}: ${fehler.slice(0, 200)}`);
    }
    alt?.(effect, fehler);
  };
  return mat;
}
