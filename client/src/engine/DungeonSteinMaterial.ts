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
 * Seit F1 (Konzept „Elemente aus dem Editor und Fels-Relief", Vorhaben 3a)
 * setzt derselbe Einspritzpunkt auch `normalW`: eine triplanare
 * Normalstoerung aus `<albedo>_normal.png`. Ohne sie sieht JEDES geometrische
 * Relief im Fackellicht flacher aus, als es ist — die Wand hat dann eine
 * Struktur, aber keinen Schattenwurf darin. Fehlt die Datei, bleibt es beim
 * heutigen Zustand; ein 404 ist hier eine Antwort, keine Stoerung.
 * Since F1 the same injection point also perturbs `normalW` from a
 * `<albedo>_normal.png` map; a missing file falls back to today's behaviour.
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

/**
 * Die drei Flaechen, fuer die es eine Normal-Karte geben KANN.
 * The three surfaces that may carry a normal map.
 */
export type SteinFlaeche = 'wand' | 'boden' | 'decke';

export const STEIN_FLAECHEN: readonly SteinFlaeche[] = ['wand', 'boden', 'decke'];

/** Fläche -> Sampler-Name im GLSL. Eine Tabelle, damit es EINE Schreibweise gibt. */
const NORMAL_SAMPLER: Record<SteinFlaeche, string> = {
  wand: 'steinWandNormal',
  boden: 'steinBodenNormal',
  decke: 'steinDeckeNormal',
};

/**
 * Zustand einer Normal-Karte.
 *
 * `laedt` ist ausdruecklich NICHT dasselbe wie `fehlt`: Ob eine Datei da ist,
 * weiss im Browser nur der Server, und die Antwort kommt erst nach dem
 * Ladeversuch. Bis dahin zeichnet das Material ohne Relief weiter — deshalb
 * blockiert eine Normal-Karte auch `isReadyForSubMesh` nie. Ein fehlendes
 * Relief ist eine flache Wand; eine Wand, die auf eine Datei wartet, die es
 * nicht gibt, waere gar keine.
 * `laedt` is not `fehlt`: only the server knows whether the file exists, so
 * normal maps never gate readiness — a missing relief is a flat wall, a
 * blocked material is no wall at all.
 */
type NormalZustand = 'laedt' | 'da' | 'fehlt';

/**
 * Konvention `<albedo>_normal.png`: Zu jeder Steintextur gehoert die
 * Normal-Karte gleichen Namens mit dem Anhang `_normal`.
 *
 * WARUM KONVENTION UND KEINE ZWEITE LISTE: Stuende die Normal-Karte in
 * `STEIN_TEXTUREN` (`shared/src/dungeons.ts`), waere sie im Editor-Dropdown
 * ein waehlbares ALBEDO — eine blaue Wand, die niemand erklaeren kann. Der
 * Pfad wird deshalb abgeleitet und nie gewaehlt.
 * Convention only, never a second allow-list: a normal map listed among the
 * albedos would show up in the editor dropdown as a selectable albedo.
 */
export function normalPfadZu(albedo: string): string {
  const punkt = albedo.lastIndexOf('.');
  const schrag = albedo.lastIndexOf('/');
  // Ein Punkt IM Ordnernamen ist keine Endung.
  if (punkt <= schrag) return `${albedo}_normal.png`;
  return `${albedo.slice(0, punkt)}_normal${albedo.slice(punkt)}`;
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
export function steinDefinitionenGlsl(): string {
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

    // Flaechen per Weltnormale: dieses Kit -> Decke +y, Boden -y.
    float sw = stKachel.z;
    float decke = smoothstep(sw, sw + 0.35, n.y);
    float boch  = smoothstep(sw, sw + 0.35, -n.y);
    vec3 deckeC = texture2D(steinDecke, wp.xz * stKachel.y).rgb;

    // Grosse Weltraum-Masken -> Flecken ueber mehrere Kit-Teile, nahtlos.
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

  #ifdef STEIN_NORMAL
    #ifdef STEIN_NORMAL_WAND
    uniform sampler2D steinWandNormal;
    #endif
    #ifdef STEIN_NORMAL_BODEN
    uniform sampler2D steinBodenNormal;
    #endif
    #ifdef STEIN_NORMAL_DECKE
    uniform sampler2D steinDeckeNormal;
    #endif

  // Triplanare Normalstoerung OHNE Tangenten ("whiteout blend"): Jede der
  // drei Projektionen liefert eine Tangentennormale, die an ihrer eigenen
  // Achse ausgerichtet und mit DENSELBEN Gewichten gemischt wird wie das
  // Albedo. Ohne Tangenten, weil die Kit-GLBs keine mitbringen -- ein
  // verschmolzenes, flach schattiertes Netz ohne brauchbare UV.
  // Das abs(t.z) * n.a haelt das Vorzeichen der Flaeche fest; ohne es
  // kippte die Stoerung an den Rueckseiten des Kits nach innen.
  vec3 stTriNormal(sampler2D t, vec3 wp, vec3 n, float inv){
    vec3 bw = abs(n); bw /= (bw.x+bw.y+bw.z + 1e-4);
    vec3 tx = texture2D(t, wp.zy*inv).xyz * 2.0 - 1.0;
    vec3 ty = texture2D(t, wp.xz*inv).xyz * 2.0 - 1.0;
    vec3 tz = texture2D(t, wp.xy*inv).xyz * 2.0 - 1.0;
    tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
    ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
    tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
    return normalize(tx.zyx*bw.x + ty.xzy*bw.y + tz.xyz*bw.z);
  }

  // Dieselbe Flaechentrennung wie steinAlbedo(). Eine Flaeche ohne eigene
  // Karte behaelt die Geometrienormale -- das ist der heutige Zustand, und
  // genau der ist der Rueckfall, wenn eine Datei fehlt.
  vec3 steinNormale(vec3 wp, vec3 n){
    float sw = stKachel.z;
    float decke = smoothstep(sw, sw + 0.35, n.y);
    float boch  = smoothstep(sw, sw + 0.35, -n.y);

    vec3 nWand = n, nBoden = n, nDecke = n;
    #ifdef STEIN_NORMAL_WAND
      nWand = stTriNormal(steinWandNormal, wp, n, stKachel.x);
    #endif
    #ifdef STEIN_NORMAL_BODEN
      nBoden = stTriNormal(steinBodenNormal, wp, n, stKachel.x);
    #endif
    #ifdef STEIN_NORMAL_DECKE
      nDecke = stTriNormal(steinDeckeNormal, wp, n, stKachel.y);
    #endif

    vec3 nr = mix(nWand, nBoden, boch);
    nr = mix(nr, nDecke, decke);
    // stKachel.w ist die Reliefstaerke; 0 ergibt exakt die Geometrienormale.
    return normalize(mix(n, nr, stKachel.w));
  }
  #endif
#endif`;
}

/**
 * `CUSTOM_FRAGMENT_BEFORE_LIGHTS`: der einzige Punkt, an dem `surfaceAlbedo` und
 * `normalW` beide da und noch änderbar sind und der VOR der Lichtrechnung liegt
 * (wie `dungeonAufrufGlsl` in 2.0). Die Albedo-PNGs sind sRGB ->
 * `toLinearSpace`; die Normal-Karte NICHT — sie trägt keine Farbe, sondern
 * eine Richtung, und eine linearisierte Richtung zeigt woanders hin.
 */
export function steinAufrufGlsl(): string {
  return /* glsl */ `
#ifdef STEIN_KIT
  vec3 stNormale = normalize(normalW);
  surfaceAlbedo = toLinearSpace(steinAlbedo(vPositionW, stNormale));
  #ifdef STEIN_NORMAL
    // normalW ist hier ein gewoehnliches lokales vec3 aus
    // pbrBlockNormalGeometric und wird von der ganzen Lichtrechnung danach
    // wieder gelesen -- beides misst client/test/stein-normal.ts am
    // installierten Babylon nach. geometricNormalW ist zu diesem Zeitpunkt
    // schon kopiert: Die Stoerung aendert die Schattierung, nicht die
    // Schattenkante.
    normalW = steinNormale(vPositionW, stNormale);
  #endif
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
  /** Reliefstärke aus `?relief=`; 0 lädt die Normal-Karten gar nicht erst. */
  private staerke: number;
  private normalTex: Partial<Record<SteinFlaeche, Texture>> = {};
  /**
   * Die Szene — nur, um die Sperre kurz aufzuheben (s. `meldeNormal`).
   * Sie kommt aus `ladeNormalen`; vorher gibt es nichts nachzuübersetzen.
   */
  private szene: Scene | null = null;
  private normalZustand: Record<SteinFlaeche, NormalZustand> = {
    wand: 'laedt',
    boden: 'laedt',
    decke: 'laedt',
  };

  constructor(material: Material, cfg: SteinKitConfig, tex: SteinTexturen, staerke: number) {
    // Priorität 10: weit vor NebelRichtung/FackelLicht (120). Wir ERSETZEN
    // Albedo vor `finalColor`; jene korrigieren das fertige Ergebnis. Der
    // sechste Parameter (`enable`) MUSS true sein. Alle Defines müssen hier
    // stehen (collectDefines legt genau diese Schlüssel an) — s. DungeonMaterial.
    super(
      material,
      'SteinKit',
      10,
      {
        STEIN_KIT: true,
        // Sammel-Define: mindestens eine Karte da. Es trägt den gemeinsamen
        // Code (`stTriNormal`, `steinNormale`) — ohne es stünde die Funktion
        // auch dann im Shader, wenn keine einzige Karte sie ruft.
        STEIN_NORMAL: false,
        STEIN_NORMAL_WAND: false,
        STEIN_NORMAL_BODEN: false,
        STEIN_NORMAL_DECKE: false,
      },
      true,
      true
    );
    this.cfg = cfg;
    this.tex = tex;
    this.staerke = staerke;
    if (staerke <= 0) {
      // `?relief=0` ist die A/B-Stellung der Messung: kein Ladeversuch, keine
      // Defines, exakt der Shader von vor F1.
      this.normalZustand = { wand: 'fehlt', boden: 'fehlt', decke: 'fehlt' };
    }
    angehaengt.add(this);
  }

  /**
   * Die drei Normal-Karten nach der Konvention `<albedo>_normal.png` holen.
   *
   * Es wird PROBIERT, nicht gefragt: Im Browser gibt es keine Dateiliste, und
   * ein 404 ist hier die Antwort „gibt es nicht" — deshalb meldet `onError`
   * bloss `fehlt`, und der Shader wird ohne diesen Kanal neu übersetzt. Der
   * Preis sind Fehlzeilen in der Browserkonsole für jede Fläche ohne Karte;
   * das ist billiger als eine zweite Liste, die man pflegen muss.
   *
   * Ein Dev-Server, der auf einen unbekannten Pfad die `index.html` legt
   * statt eines 404, landet an derselben Stelle: Ein HTML-Rumpf ist kein
   * Bild, und der Bilddekoder meldet denselben Fehler.
   */
  ladeNormalen(scene: Scene): void {
    if (this.staerke <= 0) return;
    this.szene = scene;
    const quelle: Record<SteinFlaeche, string> = {
      wand: this.cfg.wandTextur,
      boden: this.cfg.bodenTextur,
      decke: this.cfg.deckeTextur,
    };
    for (const f of STEIN_FLAECHEN) {
      this.normalTex[f] = ladeTextur(
        scene,
        normalPfadZu(quelle[f]),
        () => this.meldeNormal(f, true),
        () => this.meldeNormal(f, false)
      );
    }
  }

  /**
   * Rückmeldung des Texturladers: Karte da oder nicht. Wechselt der Zustand,
   * müssen die Defines neu — sonst zeigt der übersetzte Shader den Stand von
   * vor der Antwort, und niemand sieht, woran es liegt.
   *
   * ── Warum die Sperre hier kurz fällt ─────────────────────────────────
   * `main.ts` setzt einmalig `scene.blockMaterialDirtyMechanism = true`
   * (szenenweite Sparmassnahme). Genau daran ist F1 im Spiel wirkungslos
   * geblieben: `Material._markAllSubMeshesAsDirty` steigt bei gesetzter
   * Sperre SOFORT aus, `markAllDefinesAsDirty()` ist dann ein Aufruf ins
   * Leere. Die Karte lag geladen im Speicher, `STEIN_NORMAL_WAND` stand in
   * den MaterialDefines auf `true` — und der übersetzte Shader trug
   * trotzdem nur `#define STEIN_KIT`. Gemessen am 05.09.2026 auf wov-dev:
   * `defines.toString()` nannte den Kanal, `subMesh.effect.defines` nicht.
   *
   * Das Aufheben ist deshalb kein Trick, sondern die einzige Stelle, an der
   * dieses Material ÜBERHAUPT neu übersetzt werden muss: einmal je Fläche,
   * wenn die Antwort auf den Ladeversuch eintrifft. Dasselbe Muster steht
   * in `Terrain.ts` (`setzeDeckkraft`) — vorherigen Stand merken, aufheben,
   * zurücksetzen, damit ein späteres Umschalten der Sperre nicht verloren
   * geht.
   * `main.ts` blocks the dirty mechanism scene-wide, which silently made
   * F1's recompile a no-op; lifted here for the one call that needs it.
   */
  meldeNormal(flaeche: SteinFlaeche, da: boolean): void {
    const neu: NormalZustand = da ? 'da' : 'fehlt';
    if (this.normalZustand[flaeche] === neu) return;
    this.normalZustand[flaeche] = neu;
    this.definesNeu();
  }

  /**
   * Defines erneuern, auch bei gesetzter Szenensperre — s. `meldeNormal`.
   * Kennt das Plugin die Szene nicht (kein Ladeversuch gelaufen), bleibt
   * es beim blossen Aufruf: dann gibt es auch nichts zu erneuern.
   */
  private definesNeu(): void {
    const szene = this.szene;
    if (!szene) {
      this.markAllDefinesAsDirty();
      return;
    }
    const gesperrt = szene.blockMaterialDirtyMechanism;
    szene.blockMaterialDirtyMechanism = false;
    this.markAllDefinesAsDirty();
    szene.blockMaterialDirtyMechanism = gesperrt;
  }

  override getClassName(): string {
    return 'SteinKitPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  /**
   * Die Notbremse geht denselben Weg wie `meldeNormal` — aus demselben
   * Grund: Bei gesetzter Szenensperre bliebe „grau, aber begehbar" ein
   * Vorsatz ohne Wirkung, weil der Shader nie neu übersetzt würde.
   */
  setzeAn(an: boolean): void {
    if (this.an === an) return;
    this.an = an;
    this.definesNeu();
  }

  override prepareDefinesBeforeAttributes(defines: MaterialDefines): void {
    defines.STEIN_KIT = this.an;
    const wand = this.an && this.normalZustand.wand === 'da';
    const boden = this.an && this.normalZustand.boden === 'da';
    const decke = this.an && this.normalZustand.decke === 'da';
    defines.STEIN_NORMAL_WAND = wand;
    defines.STEIN_NORMAL_BODEN = boden;
    defines.STEIN_NORMAL_DECKE = decke;
    defines.STEIN_NORMAL = wand || boden || decke;
  }

  /**
   * Die sechs ALBEDO-Texturen müssen da sein — ohne sie wäre die Wand
   * schwarz. Die Normal-Karten stehen ABSICHTLICH nicht in dieser Liste:
   * Wer auf eine Datei wartet, die es nicht gibt, wartet für immer. Ihr
   * Zustand steuert nur die Defines; bis zur Antwort zeichnet das Material
   * flach weiter und wird danach neu übersetzt.
   */
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

  /**
   * Die drei Normal-Sampler stehen hier UNBEDINGT, auch wenn ihre Datei
   * fehlt. Babylon sammelt diese Liste genau einmal, beim Bau des Material-
   * UBO (`MaterialPluginEvent.PrepareUniformBuffer`) — lange bevor der
   * Ladeversuch beantwortet ist. Ein Name zu viel ist folgenlos
   * (`ThinEngine.setTexture` steigt bei unbekanntem Kanal aus), ein Name zu
   * wenig wäre ein Kanal, den man nie mehr binden kann.
   *
   * Die Texturplätze kostet dagegen erst das DEFINE: Nur eine Fläche mit
   * Karte bekommt ihren Sampler in den übersetzten Shader. Genau deshalb
   * sind es drei Defines und nicht eines — ein Kit mit einer einzigen
   * Wandkarte belegt einen Platz, nicht drei. Reisst das Budget doch
   * (WebGL garantiert nur 16 im Fragment), greift die Notbremse weiter
   * unten: Sie erkennt „too many"/„exceed" in der Übersetzungsmeldung und
   * schaltet auf das graue, begehbare Material zurück.
   */
  override getSamplers(samplers: string[]): void {
    samplers.push('steinWand', 'steinBoden', 'steinDecke', 'steinMoos', 'steinFrost', 'steinNass');
    samplers.push('steinWandNormal', 'steinBodenNormal', 'steinDeckeNormal');
  }

  /** In den BESTEHENDEN Material-UBO-Block — kein eigener Block (UBO-Budget). */
  override getUniforms(): { ubo: Array<{ name: string; size: number; type: string }> } {
    return {
      ubo: [
        // x = 1/kachelM (Wand/Boden), y = 1/deckeKachelM, z = Deckenschwelle,
        // w = Reliefstärke. Das freie `w` statt eines vierten vec4: Der Block
        // liegt im BESTEHENDEN Material-UBO, und ein Kanal, der schon da ist,
        // kostet nichts.
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
      this.staerke
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
    // Nur Flächen mit Karte binden. Zwischen „Karte da" und dem daraufhin
    // neu übersetzten Shader liegt ein Bild; in diesem Bild kennt der Effekt
    // den Sampler noch nicht, und das Binden läuft ins Leere statt in einen
    // Fehler (`ThinEngine.setTexture`, `channel === undefined`).
    for (const f of STEIN_FLAECHEN) {
      const n = this.normalTex[f];
      if (n && this.normalZustand[f] === 'da') {
        uniformBuffer.setTexture(NORMAL_SAMPLER[f], n);
      }
    }
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

function ladeTextur(
  scene: Scene,
  datei: string,
  onLoad?: () => void,
  onError?: () => void
): Texture {
  // Pfad kann absolut (/assets/…) oder bloßer Dateiname sein; letzterer wird
  // relativ zum Modellordner aufgelöst.
  const url = datei.startsWith('/') || datei.startsWith('http') ? datei : MODELLE + datei;
  // mit Mipmaps, invertY=false (wie Prüfstand); samplingMode bleibt Vorgabe.
  return new Texture(url, scene, false, false, undefined, onLoad ?? null, onError ?? null);
}

/**
 * `?relief=<zahl>` regelt die Stärke der Normalstörung, 0 schaltet sie ganz
 * ab (dann werden die Karten gar nicht erst geholt).
 *
 * Warum ein Regler und nicht zwei Bauzustände: Eine Messung, die zwei
 * Baustände vergleicht, vergleicht zwei Programme — Übersetzer, Texturcache
 * und Zufallszahlen inbegriffen. Eine, die zwei Adressen vergleicht,
 * vergleicht einen einzigen. Genau darauf baut
 * `tools/elements/pruefung/relief-kontrast.mjs` (F1).
 */
const RELIEF_VORGABE = 1;
const RELIEF_MAX = 2;
function reliefStaerke(): number {
  try {
    const s = new URLSearchParams(location.search).get('relief');
    if (s === null) return RELIEF_VORGABE;
    const z = Number(s);
    return Number.isFinite(z) ? Math.min(Math.max(z, 0), RELIEF_MAX) : RELIEF_VORGABE;
  } catch {
    return RELIEF_VORGABE;
  }
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

  const plugin = new SteinKitPlugin(mat, cfg, tex, reliefStaerke());
  // Erst nach dem Anhängen: Die Rückrufe der Normal-Karten fassen das Plugin
  // an, und die NullEngine beantwortet sie schon im nächsten Makrotask.
  plugin.ladeNormalen(scene);

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
