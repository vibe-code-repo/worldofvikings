/**
 * FackelLicht — viele Punktlichter als EIN Uniform-Array statt als N
 * einzelne Babylon-Lichter.
 *
 * ── Warum überhaupt ──────────────────────────────────────────────────
 * `LightPool` durfte bisher nur VIER Lichter gleichzeitig brennen lassen.
 * Der Kommentar dort nannte als Grund „Uniform-Limits schwächerer
 * WebGL2-Treiber" — das stimmt, ist aber zu unscharf, um daraus die
 * richtige Abhilfe abzuleiten. Der harte Anschlag sind nicht die
 * Uniform-VEKTOREN, sondern die Uniform-BLÖCKE:
 *
 * Babylon legt für JEDES Licht einen eigenen Uniform-Block an
 * (`Shaders/ShadersInclude/lightUboDeclaration.js`):
 *
 *     uniform Light0 { vec4 vLightData; vec4 vLightDiffuse;
 *                      vec4 vLightSpecular; vec4 vLightFalloff;
 *                      vec4 shadowsInfo; vec2 depthValues; } light0;
 *
 * Ein Block je Licht, dazu die drei festen Blöcke Scene, Material und
 * Mesh. GLES 3.0 — und damit WebGL2 — garantiert lediglich
 * MAX_FRAGMENT_UNIFORM_BLOCKS = 12. Mit Sonne, Ambient und acht
 * Fackeln sind das 3 + 10 = 13 Blöcke: einer zu viel. Genau da kamen die
 * „Unable to compile effect"-Fehler her, und genau deshalb half es,
 * die Poolgröße zu senken — nicht weil die Datenmenge zu groß gewesen
 * wäre (sie ist winzig), sondern weil die STÜCKZAHL der Blöcke zählt.
 *
 * Ein eigener Uniform-Block wird hier also gar nicht erst aufgemacht:
 * `MaterialPluginBase.getUniforms()` hängt seine Einträge in den BEREITS
 * VORHANDENEN Material-Block. 16 Fackeln kosten damit
 *
 *     16 × (vec4 Position+Reichweite) + 16 × (vec4 Farbe+1/Reichweite²)
 *     + 1 × vec4 Kopfdaten  =  33 vec4  =  528 Byte
 *
 * in einem Block, dessen garantierte Mindestgröße 16 KiB beträgt, und
 * NULL zusätzliche Blockbindungen. Der Verbrauch, an dem der alte Weg
 * scheiterte, sinkt also von „+16 Blöcke" auf „+0 Blöcke".
 *
 * ── Was der Shader rechnet ───────────────────────────────────────────
 * Bewusst NICHT Babylons volle BRDF, sondern der diffuse Anteil, den ein
 * Punktlicht dort beisteuert — der Rest (Spiegelung) ist bei einer
 * Fackel ohnehin unerwünscht, `LightPool` hat ihn schon vorher auf
 * 0.3/0.2/0.1 gedämpft. Beide Materialklassen bekommen dabei die
 * Abfallkurve, die sie HEUTE schon von einem echten Babylon-Punktlicht
 * bekämen — sonst hätte der Umbau die Nachtbeleuchtung nebenbei
 * umgefärbt:
 *
 *   · PBRMaterial (Bäume, Fels, Bauwerke aus GLB) rechnet mit
 *     `lightFalloff = LIGHTFALLOFF_PHYSICAL`, also 1/d²
 *     (`pbrDirectLightingFalloffFunctions`), und multipliziert den
 *     diffusen Term mit 1/π (`computeDiffuseLighting`).
 *   · StandardMaterial (der komplette Bodenbewuchs, `GrassClutter`)
 *     rechnet linear: `max(0, 1 - d/range)` (`lightsFragmentFunctions`)
 *     und ohne 1/π.
 *
 * EIN Unterschied ist Absicht: Der physikalische Abfall in Babylon hat
 * überhaupt keine Reichweitengrenze — `computeDistanceLightFalloff_Physical`
 * ist schlicht 1/d², die `range` eines Punktlichts wird im PBR-Zweig gar
 * nicht gelesen. Bei vier Lichtern ist das folgenlos, bei sechzehn nicht:
 * ohne Grenze trägt jede Fackel bis zum Horizont bei, und der Sinn der
 * Ortsauswahl in `LightPool` wäre dahin. Deshalb liegt hier zusätzlich
 * das Fenster aus dem glTF-Abfall darüber
 * (`computeDistanceLightFalloff_GLTF`), das bei `range` weich auf null
 * geht. Nah an der Flamme ist die Kurve identisch, fern davon endet sie.
 *
 * ── Was NICHT erfasst ist ────────────────────────────────────────────
 * Das Terrain ist ein NodeMaterial mit vollständig eigener Lichtkette
 * (`TerrainSplat.ts` + `SonnenSchattenBlock.ts`) und nimmt Babylons
 * Punktlichter auch heute schon nicht an — daran ändert sich nichts,
 * der Boden unter einer Fackel war noch nie erhellt. Materialplugins
 * greifen bei NodeMaterial nicht an denselben Einhängepunkten; das wäre
 * ein eigener Block in der Terrain-Kette und ein eigener Arbeitsschritt.
 *
 * ── WebGPU ───────────────────────────────────────────────────────────
 * Der eingespritzte Code ist reines GLSL. Damit ist dieses Plugin der
 * nächste Grund, warum WebGPU im Projekt aus bleibt (die anderen stehen
 * in `WaterPlugin`, `ClutterWindPlugin`, `WindPlugin`, `PbrNebelFix`,
 * `StandardGammaFix`).
 *
 * Die Entscheidung gegen einen WGSL-Zweig ist bewusst und nicht
 * Bequemlichkeit: Die UNIFORM-Deklaration erzeugt Babylon für beide
 * Sprachen selbst (`materialPluginManager.js`, Zweig `isWebGPU`), zu
 * schreiben wäre also nur der Rechenblock. Aber genau der lebt von
 * Variablennamen aus Babylons Shader-Innerem (`finalColor`,
 * `surfaceAlbedo`, `normalW`, `baseColor`), die im WGSL-Zweig anders
 * aufgelöst werden — und ein WGSL-Block, den hier niemand übersetzen
 * kann, wäre eine Zusicherung ohne Deckung. `isCompatible()` meldet
 * deshalb ehrlich „nur GLSL"; unter WebGPU fällt das Plugin weg und
 * `LightPool` schaltet in den Rückfallbetrieb mit echten Lichtern.
 * Der Rechenblock steht in `bausteinGlsl()` beisammen, damit ein
 * späterer WGSL-Zwilling genau eine Funktion daneben ist.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/** Obergrenze der Arraygröße im Shader — mehr Plätze gibt es nie. */
export const FACKEL_OBERGRENZE = 16;

/**
 * Wie viele vec4 der übrige Material-Block schon belegt, grob geschätzt.
 *
 * Nur für den Rückfallpfad OHNE Uniform-Blöcke interessant: dort werden
 * die Einträge zu gewöhnlichen Uniforms, und dann zählt wieder
 * MAX_FRAGMENT_UNIFORM_VECTORS. PBRMaterial belegt davon in der vollen
 * Ausbaustufe rund 90 Vektoren; 120 als Reserve ist grosszügig gerechnet
 * und kostet im Zweifel nur Fackelplätze, nicht die Übersetzung.
 */
const RESERVE_VEKTOREN = 120;

/** Merker für die Notbremse, damit sie eine Sitzung überdauert. */
const NOTBREMSE_KEY = 'wov-fackeln-notbremse';

/**
 * Gemeinsamer Zustand aller Plugin-Instanzen.
 *
 * Statisch wie bei `ClutterWindPlugin`/`WaterPlugin`: Die Werte gelten
 * für die ganze Szene, jede Materialinstanz bindet dieselben Zahlen. Eine
 * Kopie je Material wäre nicht nur Speicher, sie müsste auch N-fach
 * gepflegt werden.
 */
export class FackelLichter {
  /**
   * Plätze, die dieses Gerät hergibt. 0 = Plugin nicht installiert,
   * `LightPool` arbeitet dann mit echten Babylon-Lichtern weiter.
   */
  static plaetze = 0;
  /** Wie viele Plätze gerade wirklich brennen (≤ `plaetze`). */
  static anzahl = 0;
  /**
   * Globaler Helligkeitsfaktor, damit sich die Nachtstimmung auf echter
   * Hardware nachziehen lässt, ohne den Shader anzufassen. Der Rechenweg
   * unten bildet Babylons Kurven nach, aber die absolute Helligkeit ist
   * ohne GPU nicht zu beurteilen — siehe Kopfkommentar.
   */
  static staerke = 1;
  /** xyz = Weltposition, w = Reichweite in Metern. */
  static readonly pos = new Float32Array(FACKEL_OBERGRENZE * 4);
  /** rgb = Farbe × Intensität × Flackern, w = 1/Reichweite². */
  static readonly farbe = new Float32Array(FACKEL_OBERGRENZE * 4);

  /**
   * Trägt eine Quelle in Platz `i` ein. Bündelt die Packung an EINER
   * Stelle — sie steht sonst zweimal da, hier und im Shader.
   */
  static setze(
    i: number,
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    reichweite: number
  ): void {
    const p = i * 4;
    FackelLichter.pos[p] = x;
    FackelLichter.pos[p + 1] = y;
    FackelLichter.pos[p + 2] = z;
    FackelLichter.pos[p + 3] = reichweite;
    FackelLichter.farbe[p] = r;
    FackelLichter.farbe[p + 1] = g;
    FackelLichter.farbe[p + 2] = b;
    // 1/Reichweite² vorberechnet: im Shader wäre das eine Division je
    // Licht und Bildpunkt, hier ist es eine je Licht und Frame.
    FackelLichter.farbe[p + 3] = 1 / Math.max(reichweite * reichweite, 1e-4);
  }

  /** Leert einen Platz vollständig (Farbe 0 = trägt garantiert nichts bei). */
  static loesche(i: number): void {
    const p = i * 4;
    FackelLichter.pos.fill(0, p, p + 4);
    FackelLichter.farbe.fill(0, p, p + 4);
  }
}

/** Von `installiereFackelLicht()` gesetzt, von jedem Plugin gelesen. */
let arrayGroesse = 0;
/** Alle angehängten Plugins — die Notbremse muss sie alle abschalten. */
const angehaengt = new Set<FackelLichtPlugin>();

class FackelLichtPlugin extends MaterialPluginBase {
  /** false schaltet den Rechenblock per Define aus (Notbremse). */
  private an = true;

  /**
   * PBR und Standard brauchen verschiedenen Code — und die Auskunft
   * MUSS aus `_material` kommen, nicht aus einem eigenen Feld.
   *
   * `getCustomCode()` läuft nämlich schon während `super()`, wenn der
   * Plugin-Manager die Einspritzpunkte einsammelt — ein im
   * Konstruktorrumpf gesetztes Feld ist dann noch leer, und der Shader
   * bekäme für ein PBR-Material den Standard-Block mit `color` und
   * `baseColor`, die es dort gar nicht gibt. Dieselbe Falle steht
   * ausführlich in `ClutterWindPlugin`. `_material` dagegen weist
   * `MaterialPluginBase` als ALLERERSTES zu, noch vor `_addPlugin()`.
   */
  private get istPbr(): boolean {
    return this._material instanceof PBRBaseMaterial;
  }

  constructor(material: Material) {
    // Priorität 120: nach StandardGammaFix (100) und PbrNebelFix (110),
    // damit die Farbraum-Korrekturen zuerst greifen. Der sechste Parameter
    // (`enable`) MUSS true sein, sonst landet das Plugin nur in der
    // passiven Liste: die Uniforms stünden im Shader, aber weder
    // `getCustomCode()` noch `bindForSubMesh()` würden je ausgeführt —
    // dieselbe Falle, die in `ClutterWindPlugin` ausführlich steht.
    super(material, 'FackelLicht', 120, { FACKELLICHT: true }, true, true);
    angehaengt.add(this);
  }

  override getClassName(): string {
    return 'FackelLichtPlugin';
  }

  /**
   * Nur GLSL — die Begründung steht im Kopfkommentar. Babylon meldet die
   * Unverträglichkeit selbst in der Konsole und lässt das Plugin weg,
   * statt einen halben Shader zu bauen.
   */
  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  /** Schaltet den Rechenblock; die Uniforms bleiben deklariert. */
  setzeAn(an: boolean): void {
    if (this.an === an) return;
    this.an = an;
    this.markAllDefinesAsDirty();
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.FACKELLICHT = this.an && arrayGroesse > 0;
  }

  override isReadyForSubMesh(): boolean {
    return true;
  }

  override getUniforms(): {
    ubo: Array<{ name: string; size: number; type: string; arraySize?: number }>;
  } {
    // arraySize > 0 → Babylon legt die Einträge std140-konform im
    // Material-Block an und `updateFloatArray` kennt über den
    // gemerkten Stride (4) den richtigen Setter (`setFloatArray4`),
    // falls das Gerät gar keine Uniform-Blöcke kann.
    const n = Math.max(arrayGroesse, 1);
    return {
      ubo: [
        // x = brennende Anzahl, y = globale Stärke, zw frei.
        { name: 'fackelInfo', size: 4, type: 'vec4' },
        { name: 'fackelPos', size: 4, type: 'vec4', arraySize: n },
        { name: 'fackelFarbe', size: 4, type: 'vec4', arraySize: n },
      ],
    };
  }

  override bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): void {
    if (!this.an || arrayGroesse === 0) return;
    const n = Math.min(FackelLichter.anzahl, arrayGroesse);
    uniformBuffer.updateFloat4('fackelInfo', n, FackelLichter.staerke, 0, 0);
    // Immer das volle Array schicken, auch wenn nur die ersten n Plätze
    // gelesen werden: `UniformBuffer` vergleicht ohnehin elementweise und
    // schreibt nur bei Änderung, und eine kürzere Teilsicht je Frame wäre
    // eine Allokation je Material und Frame.
    uniformBuffer.updateFloatArray('fackelPos', FackelLichter.pos);
    uniformBuffer.updateFloatArray('fackelFarbe', FackelLichter.farbe);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage?: ShaderLanguage
  ): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    if (shaderLanguage !== undefined && shaderLanguage !== ShaderLanguage.GLSL) return null;
    // CUSTOM_FRAGMENT_BEFORE_FOG gibt es in BEIDEN Shadern an derselben
    // Stelle: `default.fragment` direkt nach dem Zusammensetzen von
    // `color`, `pbr.fragment` in `pbrBlockFinalColorComposition` direkt
    // nach `finalColor`. Vor dem Nebel ist der richtige Ort — eine Fackel
    // im Dunst soll mit eingenebelt werden, nicht durch ihn hindurch
    // leuchten. Und vor dem ImageProcessing, damit das Licht durch
    // dieselbe Tonwertkurve läuft wie alles andere.
    return { CUSTOM_FRAGMENT_BEFORE_FOG: bausteinGlsl(this.istPbr, arrayGroesse) };
  }
}

/**
 * Der eigentliche Rechenblock. Getrennte Funktion, damit ein späterer
 * WGSL-Zwilling danebensteht und nicht in `getCustomCode()` eingewachsen
 * ist.
 *
 * `#ifdef FACKELLICHT` statt einer leeren Zeichenkette: Der Plugin-Manager
 * verwirft eine LEERE Einspritzung (`materialPluginManager.js`, Prüfung
 * `injectedCode.length > 0`) — der Code muss also immer dastehen und der
 * Präprozessor entscheidet, wie in `PbrNebelFix`.
 *
 * Exportiert, obwohl nur intern gebraucht: Ein GLSL-Fehler fällt sonst
 * erst auf der GPU auf. So lässt sich der fertige Text wenigstens ohne
 * laufendes Spiel ansehen und auf Klammern, Namen und Arraygrenzen prüfen.
 *
 * Die Kommentare IM GLSL bleiben bewusst reines ASCII. GLSL ES schreibt
 * einen begrenzten Quellzeichensatz vor, und es gibt Treiber, die schon
 * an einem Umlaut im Kommentar aussteigen — ausgerechnet die schwachen,
 * um die es hier die ganze Zeit geht. Die deutsche Erklärung steht
 * deshalb im TypeScript-Kommentar, nicht im Shader.
 */
export function bausteinGlsl(istPbr: boolean, n: number): string {
  // Der Abfall ist der einzige Unterschied im Schleifenrumpf: PBR rechnet
  // 1/d² (computeDistanceLightFalloff_Physical), StandardMaterial linear
  // (computeLighting). Beide bekommen zusätzlich das Reichweitenfenster.
  const abfall = istPbr
    ? '      float abfall = fenster / max(d2, 1e-4);'
    : '      float abfall = fenster * max(0.0, 1.0 - sqrt(d2) / max(fackelPos[i].w, 1e-4));';

  // Und die Übergabe an das fertige Bild: `finalColor` heisst die Variable
  // im PBR-Shader, `color` im Standard-Shader; 1/π ist der diffuseTerm aus
  // computeDiffuseLighting(), den default.fragment nicht kennt.
  // `vLightingIntensity.x` ist Babylons `directIntensity` (Material-Block).
  const uebergabe = istPbr
    ? '    finalColor.rgb += surfaceAlbedo.rgb * fackelSumme * (0.3183098861837907 * fackelInfo.y * vLightingIntensity.x);'
    : '    color.rgb += baseColor.rgb * diffuseColor * fackelSumme * fackelInfo.y;';

  // Die Schleifengrenze ist eine KONSTANTE (eingesetzte Zahl), nicht das
  // Uniform: GLSL ES 3.0 erlaubt zwar dynamische Grenzen, ältere Treiber
  // entrollen aber nur konstante Schleifen zuverlässig. Der Abbruch über
  // `break` sorgt trotzdem dafür, dass tagsüber (Anzahl 0) nach dem
  // ersten Vergleich Schluss ist.
  return /* glsl */ `
  #ifdef FACKELLICHT
  {
    int fackelN = int(fackelInfo.x);
    vec3 fackelSumme = vec3(0.0);
    for (int i = 0; i < ${n}; i++) {
      if (i >= fackelN) { break; }
      vec3 zumLicht = fackelPos[i].xyz - vPositionW;
      float d2 = dot(zumLicht, zumLicht);
      // Fenster aus computeDistanceLightFalloff_GLTF -- geht bei der
      // Reichweite weich auf null. fackelFarbe[i].w ist 1/Reichweite^2,
      // der Term also (d^2/Reichweite^2)^2. ASCII, siehe bausteinGlsl().
      float fensterF = clamp(1.0 - d2 * d2 * fackelFarbe[i].w * fackelFarbe[i].w, 0.0, 1.0);
      float fenster = fensterF * fensterF;
      vec3 richtung = zumLicht * inversesqrt(max(d2, 1e-8));
      float ndl = max(dot(normalW, richtung), 0.0);
${abfall}
      fackelSumme += fackelFarbe[i].rgb * (ndl * abfall);
    }
${uebergabe}
  }
  #endif`;
}

/**
 * Wie viele Plätze das Gerät verträgt.
 *
 * Mit Uniform-Blöcken ist die Antwort immer die Obergrenze: 33 vec4 in
 * einem Block, dessen garantiertes Minimum 1024 vec4 beträgt. Ohne
 * Blöcke (WebGL1-Fallback, exotische Treiber) werden daraus gewöhnliche
 * Uniforms, und dann zählt MAX_FRAGMENT_UNIFORM_VECTORS mit einem
 * WebGL2-Minimum von 224 — auch das reicht rechnerisch, aber dort ist
 * die Reserve für Babylons eigene Uniforms nicht gesichert, deshalb wird
 * gestuft: 16 → 8 → 4 → 0.
 */
function ermittlePlaetze(engine: AbstractEngine): number {
  if (engine.supportsUniformBuffers) return FACKEL_OBERGRENZE;
  const frei = (engine.getCaps().maxFragmentUniformVectors ?? 0) - RESERVE_VEKTOREN;
  // Je Fackel zwei vec4, dazu ein vec4 Kopf.
  for (const stufe of [FACKEL_OBERGRENZE, 8, 4]) {
    if (frei >= stufe * 2 + 1) return stufe;
  }
  return 0;
}

/**
 * Hängt das Plugin an jedes vorhandene und künftige PBR-/Standard-Material.
 * Einmal beim Szenenaufbau aufrufen, VOR `blockMaterialDirtyMechanism`.
 *
 * @returns die Zahl der Plätze; 0 heisst „`LightPool` bitte im
 *          Rückfallbetrieb mit echten Lichtern arbeiten".
 */
export function installiereFackelLicht(scene: Scene): number {
  if (arrayGroesse > 0) return arrayGroesse;
  if (leseNotbremse()) {
    console.warn(
      '[fackel] Notbremse aus einer früheren Sitzung aktiv — Fackeln laufen ' +
        'mit echten Babylon-Lichtern. Zum Aufheben: localStorage.removeItem("' +
        NOTBREMSE_KEY + '")'
    );
    return 0;
  }
  const plaetze = ermittlePlaetze(scene.getEngine());
  if (plaetze === 0) {
    console.warn('[fackel] Zu wenig Uniform-Platz — Fackeln laufen mit echten Lichtern.');
    return 0;
  }
  arrayGroesse = plaetze;
  FackelLichter.plaetze = plaetze;

  const haenge = (m: Material): void => {
    // Das Wasser bleibt aussen vor: eine bildfüllende Fläche mit eigener
    // Licht- und Brechungskette, bei der sechzehn zusätzliche Lichter je
    // Bildpunkt teuer wären und optisch fast nichts beitragen. Wenn die
    // Spiegelung des Lagerfeuers auf dem See später doch gewünscht ist,
    // ist es diese eine Zeile.
    if (m.name === 'waterMat') return;
    if (!(m instanceof PBRBaseMaterial) && !(m instanceof StandardMaterial)) return;
    if (m.pluginManager?.getPlugin('FackelLicht')) return;
    new FackelLichtPlugin(m);
  };
  for (const m of scene.materials) haenge(m);
  scene.onNewMaterialAddedObservable.add(haenge);

  // Rückfallebene: Wenn ein Effekt trotz allem nicht übersetzt, ist das
  // hier zu sehen, bevor der Spieler eine schwarze Welt sieht. Babylons
  // `Material.onError` ist ein EINZELNER Rückruf, kein Observable —
  // deshalb wird ein evtl. vorhandener weitergereicht statt überschrieben.
  const haengeFehlerwache = (m: Material): void => {
    const alt = m.onError;
    m.onError = (effect, fehler) => {
      if (/uniform|too many|exceed|compile/i.test(fehler)) {
        fackelNotbremse(`Übersetzungsfehler an ${m.name}: ${fehler.slice(0, 200)}`);
      }
      alt?.(effect, fehler);
    };
  };
  for (const m of scene.materials) haengeFehlerwache(m);
  scene.onNewMaterialAddedObservable.add(haengeFehlerwache);

  console.log(`[fackel] ${plaetze} Plätze über ein Uniform-Array (0 zusätzliche Blöcke)`);
  return plaetze;
}

/**
 * Notbremse: Rechenblock aus, Plätze auf 0. `LightPool` sieht das beim
 * nächsten `update()` und baut seine vier echten Lichter auf.
 *
 * Wird gemerkt, damit die nächste Sitzung nicht wieder erst in denselben
 * Übersetzungsfehler läuft — auf demselben Gerät geht der ja wieder
 * schief, und ein Bildaufbau mit fehlenden Materialien ist schlimmer als
 * vier Fackeln.
 */
export function fackelNotbremse(grund: string): void {
  if (arrayGroesse === 0) return;
  console.error(`[fackel] Notbremse: ${grund}`);
  arrayGroesse = 0;
  FackelLichter.plaetze = 0;
  FackelLichter.anzahl = 0;
  for (const p of angehaengt) p.setzeAn(false);
  try {
    localStorage.setItem(NOTBREMSE_KEY, '1');
  } catch {
    // Kein localStorage (privater Modus) — dann gilt sie nur für diese Sitzung.
  }
}

/** Hebt die gemerkte Notbremse auf (Diagnose über `__dbg`). */
export function fackelNotbremseLoesen(): void {
  try {
    localStorage.removeItem(NOTBREMSE_KEY);
  } catch {
    // s. o.
  }
}

function leseNotbremse(): boolean {
  try {
    return localStorage.getItem(NOTBREMSE_KEY) === '1';
  } catch {
    return false;
  }
}
