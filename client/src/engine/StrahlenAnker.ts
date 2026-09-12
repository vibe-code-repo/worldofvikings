/**
 * Strahlen-Anker und Komposit-Korrektur fuer `VolumetricLightScattering`.
 * Sun-shaft anchor and composite fix for `VolumetricLightScattering`.
 *
 * Diese Datei behebt die beiden Gruende, aus denen der Strahlenkranz am
 * 11.09.2026 gemessen **exakt nichts** gemalt und trotzdem voll gekostet hat
 * (Analyse „Licht und Farbe", C2). Beide sind in Babylon 8.56 begruendet, nicht
 * in unseren Zahlen — deshalb stehen sie hier zusammen und nicht verstreut in
 * den beiden Aufrufern (`PostProcessing`, `DungeonGodrays`).
 *
 * ── 1. Der Anker kam nie in den Verdeckungspuffer ────────────────────────
 *
 * `VolumetricLightScatteringPostProcess` rendert eine eigene Szenenpassage:
 * Verdecker schwarz (`volumetricLightScatteringPass.fragment` endet
 * bedingungslos auf `gl_FragColor = vec4(0,0,0,1)`), die LICHTQUELLE weiss.
 * Weiss wird dabei genau ein Mesh — `vls.mesh` —, und zwar ueber einen
 * Sonderzweig in `_createPass` (`volumetricLightScatteringPostProcess.js:332`):
 *
 *     if (renderingMesh === this.mesh) material.bind(world, renderingMesh);
 *
 * Der voreingestellte Anker ist eine 1-m-Plane mit `StandardMaterial`
 * (`CreateDefaultMesh`, :479) — und `Material.prototype.bind` ist in 8.56 ein
 * **leerer Rumpf** (`material.js:859`); `StandardMaterial` ueberschreibt nur
 * `bindForSubMesh`. Das Effekt-Uniform `worldViewProjection`/`viewProjection`
 * wird also nie gesetzt, der Anker landet irgendwo oder nirgends, und der
 * Puffer bleibt ueber die ganze Flaeche auf Rotkanal 0. GEMESSEN: 123
 * Bind-Aufrufe in 123 Passagen, Maximum 0.
 *
 * Zweiter, unabhaengiger Grund fuer dieselbe Null: Groesse. Eine 1-m-Plane in
 * `ankerAbstand` = 1400 m Entfernung misst rund 0,04° — im
 * Verdeckungspuffer, der mit `passRatio 0.25` auf 400x225 laeuft, ist das ein
 * Viertel eines Bildpunkts. Selbst ein korrekt gebundener Anker haette nichts
 * zu verschmieren gehabt.
 *
 * ── Und der dritte Grund, der erst im Messlauf sichtbar wurde ───────────
 *
 * Der naheliegende Ausweg — ein EIGENES Mesh als `mesh`-Argument des
 * Konstruktors, damit der `renderingMesh === this.mesh`-Zweig ein
 * `ShaderMaterial` bindet, das `bind` wirklich ueberschreibt — ist GEMESSEN
 * gescheitert, und zwar still: Anker da, sichtbar, Material uebersetzt, mitten
 * im Bild projiziert, `renderSubMesh` laeuft nachweislich auf seinem Submesh
 * (`_isActiveIntermediate` steht danach auf false) — Puffer trotzdem 0.
 *
 * Der Grund steht zwei Zeilen vor dem Zeichenaufruf:
 *
 *     let drawWrapper = subMesh._getDrawWrapper();
 *     if (renderingMesh === this.mesh && !drawWrapper) {
 *         drawWrapper = material._getDrawWrapper();
 *     }
 *
 * Fuer den Anker EXISTIERT ein DrawWrapper am Submesh — er ist nur LEER
 * (GEMESSEN: `{da: true, effekt: false}`, waehrend der des Materials
 * `{effekt: true, bereit: true}` meldet). Die Ausweiche greift deshalb nie,
 * `engine.enableEffect` bekommt einen Wrapper ohne Effekt, und es wird nichts
 * gezeichnet. `ShaderMaterial` fuellt den Submesh-Wrapper naemlich nur, wenn
 * es mit `storeEffectOnSubMeshes` gebaut wurde — und der `this.mesh`-Zweig
 * fragt sein Material ueber `isReady(mesh)` OHNE Submesh.
 *
 * Deshalb geht der Anker den anderen, von Babylon ausdruecklich dafuer
 * vorgesehenen Weg: `setMaterialForRenderPass`. Dann gilt in `_isReady` der
 * Zweig `renderingMaterial.isReadyForSubMesh(mesh, subMesh, useInstances)`,
 * der den Submesh-Wrapper der PASSAGE mit dem uebersetzten Effekt fuellt, und
 * in `renderSubMesh` der Zweig `renderingMaterial.bindForSubMesh(...)`. Beide
 * Haelften sitzen damit am selben Objekt, und keine Ausweiche muss greifen.
 * Babylons voreingestellter Anker bleibt dabei, was er war: abgeschaltet,
 * ausgeschlossen und beim Abraeumen mitzunehmen.
 *
 * Die uebrigen Entscheidungen:
 *  · Das Material ist ein `ShaderMaterial` mit `storeEffectOnSubMeshes` und
 *    genau einer Uniform (`worldViewProjection`, in `bindOnlyWorldMatrix`
 *    BEDINGUNGSLOS gesetzt — eigene Uniforms haengen im `mustRebind`-Zweig).
 *    Ein `StandardMaterial` taete es auch, brauchte aber Nebel aus, Licht aus
 *    und drei Farben auf den richtigen Werten, um dasselbe Weiss zu liefern.
 *  · Der Anker ist eine KUGEL, kein Billboard: Ihre Silhouette ist aus jeder
 *    Richtung dieselbe Scheibe, und damit entfaellt die `billboardMode`-
 *    Nachfuehrung fuer ein Mesh, das aus dem normalen Zeichenpfad heraushaengt
 *    (s. u.) und dessen Weltmatrix niemand mehr von selbst aktualisiert.
 *  · Ihr Durchmesser folgt einem WINKEL, nicht einer Laenge.
 *
 * ── Warum der Anker aus dem Kamerabild heraus muss, und wie ──────────────
 *
 * Ein Anker, der gross genug fuer den Verdeckungspuffer ist, ist im Farbbild
 * eine weisse Scheibe von mehreren Grad Durchmesser. Er darf also nur in der
 * Verdeckungspassage gezeichnet werden. `isVisible = false` taugt dafuer
 * nicht: `Scene._evaluateActiveMeshes` (`scene.js:3854`) nimmt das Mesh damit
 * aus `scene.getActiveMeshes()`, und genau diese Liste ist die Vorlage der
 * Verdeckungspassage (`renderList === null`) — der Anker waere in BEIDEN
 * Passagen weg.
 *
 * Der Weg, der beides trennt, sind die zwei Stellen, an denen Babylon die
 * Maskenpruefung unterschiedlich handhabt:
 *  · `layerMask = 0` nimmt das Mesh aus jeder Kamera — Farbbild,
 *    Geometriepuffer, SSAO, aktive Meshes (`objectRenderer.js:689`,
 *    `checkLayerMask` ist dort true, weil `renderList` null ist). Dasselbe
 *    Mittel benutzt `Shadows.ts:474` fuer den Vegetations-Schattenmaster.
 *  · `RenderTargetTexture.getCustomRenderList` setzt `checkLayerMask` auf
 *    `forceLayerMaskCheck` (false, `objectRenderer.js:620`). Die Liste, die
 *    wir dort zurueckgeben, wird also ohne Maskenpruefung gezeichnet.
 *
 * Ergebnis: aktive Meshes + Anker in der Verdeckung, nichts im Bild. Der Name
 * beginnt mit `sky`, damit `Shadows.NIE_WERFEN`/`NIE_EMPFANGEN` ihn ohne
 * Zusatzregel aus Werfer- und Empfaengerliste halten.
 *
 * ── 2. Der Konstantterm im Komposit ─────────────────────────────────────
 *
 * `volumetricLightScattering.fragment` endet auf
 *
 *     gl_FragColor = vec4(color.rgb * exposure, realColor.a)
 *                  + realColor * (1.5 - 0.4);
 *
 * Der zweite Summand haengt an keinem Regler: Ein angehaengter Pass macht das
 * ganze Bild um **10 %** heller, auch bei `exposure = 0`. GEMESSEN an/aus:
 * p25 1,0934 / p50 1,0986 / p75 1,1016 — bei einem auf Luma 57,4 geeichten
 * Look sind das +5,7 Luma. `korrigiereStrahlenKomposit()` ersetzt den Faktor
 * durch die 1 der Vorlage (GPU Gems 3, Kapitel 13: Streuterm ADDITIV ueber das
 * Szenenbild). Danach ist ein Pass ohne Quelle im Bild wirklich unsichtbar,
 * und „an gegen aus" ist eine Aussage ueber Strahlen statt ueber Belichtung.
 *
 * Der Eingriff ist eine Textersetzung im `ShaderStore` und muss VOR der ersten
 * Uebersetzung laufen — deshalb steht er zusaetzlich als Seiteneffekt am
 * Dateiende. `kompositKorrigiert()` ist der Zeuge; schlaegt die Ersetzung nach
 * einem Babylon-Wechsel fehl, steht dort false statt einer stillen Rueckkehr
 * der 10 %.
 *
 * In English: Babylon 8.56 never binds the anchor's matrices (empty
 * `Material.bind`), the default 1 m anchor is sub-pixel in a quarter-res
 * occlusion buffer, and the composite multiplies the whole frame by 1.1
 * regardless of exposure. This file fixes all three.
 */
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
// SEITENEFFEKT, nicht wegoptimieren: Ohne diesen Import steht der
// Komposit-Shader gar nicht im Store, und die Ersetzung unten liefe ins
// Leere — sie wuerde dann nicht einmal falsch, sondern still wirkungslos.
// Side effect import: without it the composite shader is not in the store yet
// and the patch below would silently do nothing.
import '@babylonjs/core/Shaders/volumetricLightScattering.fragment';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess';

const SHADER_NAME = 'strahlenAnker';

const ANKER_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
void main(void) {
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// Der Verdeckungspuffer kennt nur zwei Werte: schwarz (Verdecker) und weiss
// (Quelle). Keine Uniform, kein Zweig — jede Uniform haenge im
// `mustRebind`-Zweig von `ShaderMaterial.bind` und koennte ausbleiben.
// Two values only, and deliberately no uniform: custom uniforms sit inside
// `mustRebind` and could be skipped.
const ANKER_FRAGMENT = `
precision highp float;
void main(void) {
  gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
}
`;

/**
 * Scheinbarer Durchmesser des Ankers in GRAD.
 *
 * Nicht in Metern, weil die Sonne 1400 m und eine Schachtmuendung 6 m weit
 * weg ist — derselbe Meterwert waere einmal ein Punkt und einmal eine Wand.
 * Die Zahl kommt aus der Aufloesung der Verdeckungspassage, nicht aus der
 * Astronomie: Sie laeuft mit `passRatio 0.25` auf 400x225, das sind bei 60°
 * Bildwinkel rund 3,75 Bildpunkte je Grad. Unter etwa 2° hat der radiale
 * Blur weniger als acht Punkte zu verschmieren und der Kranz zerfaellt in
 * Treppen; 4° sind rund 15 Punkte und liegen zugleich innerhalb des Halos,
 * den die Himmelskuppel um die Sonne malt.
 *
 * Apparent anchor diameter in DEGREES — driven by the quarter-resolution
 * occlusion buffer, not by astronomy.
 */
export const ANKER_WINKEL_GRAD = 4;

/** Kugelsegmente: die Silhouette ist ein Kreis, 16 reichen dafuer. */
const ANKER_SEGMENTE = 16;

/**
 * Weltdurchmesser eines Ankers, der aus `abstand` Metern unter
 * `ANKER_WINKEL_GRAD` erscheint. Reine Funktion, damit sie ohne GPU pruefbar
 * ist. / World diameter for a given distance.
 */
export function ankerDurchmesser(abstand: number): number {
  return 2 * abstand * Math.tan((ANKER_WINKEL_GRAD * Math.PI) / 360);
}

let registriert = false;
function registriereShader(): void {
  if (registriert) return;
  Effect.ShadersStore[`${SHADER_NAME}VertexShader`] = ANKER_VERTEX;
  Effect.ShadersStore[`${SHADER_NAME}FragmentShader`] = ANKER_FRAGMENT;
  registriert = true;
}

const KOMPOSIT = 'volumetricLightScatteringPixelShader';
/** Der Konstantterm, wie er in Babylon 8.56.2 im Quelltext steht. */
const KOMPOSIT_ALT = '(realColor*(1.5-0.4))';
const KOMPOSIT_NEU = 'realColor';
let kompositStand: boolean | null = null;

/**
 * Den 10-%-Konstantterm aus dem Komposit-Shader nehmen (s. Kopfkommentar).
 * Idempotent und absichtlich ohne Ausnahme: Findet die Ersetzung ihr Muster
 * nicht, ist das kein Absturz, sondern eine Zahl, die der Zeuge meldet.
 * Removes the hard-coded 1.1 gain from the composite. Idempotent.
 */
export function korrigiereStrahlenKomposit(): boolean {
  if (kompositStand !== null) return kompositStand;
  const quelle = Effect.ShadersStore[KOMPOSIT];
  if (typeof quelle !== 'string') {
    kompositStand = false;
    return false;
  }
  if (!quelle.includes(KOMPOSIT_ALT)) {
    // Entweder schon ersetzt (kann hier nicht sein, wir laufen einmal) oder
    // Babylon hat den Shader geaendert. Beides heisst: nicht anfassen.
    kompositStand = false;
    return false;
  }
  Effect.ShadersStore[KOMPOSIT] = quelle.replace(KOMPOSIT_ALT, KOMPOSIT_NEU);
  kompositStand = true;
  return true;
}

/** Zeuge: Ist der Konstantterm wirklich draussen? / Witness. */
export function kompositKorrigiert(): boolean {
  return kompositStand === true && !(Effect.ShadersStore[KOMPOSIT] ?? '').includes(KOMPOSIT_ALT);
}

/**
 * Ein Anker-Mesh samt Material.
 *
 * Der Aufrufer baut den Anker, baut danach den Pass (mit `mesh = undefined`,
 * also Babylons voreingestelltem Anker, den er wie bisher abschaltet und
 * beim Abraeumen mitnimmt) und ruft dann `verbinde()`. `setzePosition()`
 * gehoert in dieselbe Zeile, in der schon `customMeshPosition` gesetzt wird:
 * Der Anker haengt nicht an den aktiven Meshes, also aktualisiert niemand
 * sonst seine Weltmatrix.
 */
export class StrahlenAnker {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  /** Wiederverwendete Liste — je Bild einmal gefuellt, nie neu angelegt. */
  private readonly liste: AbstractMesh[] = [];
  private verbunden: VolumetricLightScatteringPostProcess | null = null;
  private passagenIds: readonly number[] = [];

  constructor(scene: Scene, name: string, durchmesser: number) {
    registriereShader();
    this.material = new ShaderMaterial(
      name + 'Mat',
      scene,
      SHADER_NAME,
      {
        attributes: ['position'],
        // NUR diese eine Matrix: `bindOnlyWorldMatrix` setzt sie
        // bedingungslos (`shaderMaterial.js:777`), waehrend `view`,
        // `viewProjection` und jede eigene Uniform im `mustRebind`-Zweig
        // haengen — und ob der greift, entscheidet `scene.getCachedMaterial()`,
        // also die Reihenfolge fremder Passagen.
        uniforms: ['worldViewProjection'],
        // Ohne explizite Sprache sucht ShaderMaterial unter WebGPU nach einer
        // WGSL-Datei; Vite beantwortet den unbekannten Pfad mit index.html
        // (dieselbe Falle wie in ValheimSky.ts).
        shaderLanguage: ShaderLanguage.GLSL,
      },
      // `storeEffectOnSubMeshes` — das ist der Schalter, an dem der erste
      // Anlauf gescheitert ist. Ohne ihn legt `isReady` den uebersetzten
      // Effekt am MATERIAL ab, waehrend die Verdeckungspassage den Wrapper am
      // SUBMESH zieht: der ist dann da, aber leer, und es wird nichts
      // gezeichnet. Mit ihm fuellt `isReadyForSubMesh` genau den Wrapper, den
      // `renderSubMesh` gleich darauf benutzt.
      true
    );
    this.material.fogEnabled = false;
    this.mesh = MeshBuilder.CreateSphere(
      name,
      { segments: ANKER_SEGMENTE, diameter: durchmesser },
      scene
    );
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.doNotSyncBoundingInfo = true;
    // Aus jeder Kamera heraus (Farbbild, Geometriepuffer, SSAO, aktive
    // Meshes). In die Verdeckungspassage kommt er ueber `verbinde()`.
    this.mesh.layerMask = 0;
  }

  /**
   * Den Anker in die Verdeckungspassage des Passes haengen — zwei Haelften,
   * und beide sind noetig:
   *
   *  1. `getCustomRenderList` ist der einzige Ort, an dem Babylon eine Liste
   *     OHNE Maskenpruefung zeichnet (`objectRenderer.js:620`) — genau deshalb
   *     steht der Anker hier und nicht in `renderList`: `renderList` wuerde die
   *     aktiven Meshes ERSETZEN, und ohne Verdecker gibt es keinen Faecher,
   *     sondern eine Scheibe.
   *  2. `setMaterialForRenderPass` sagt der Passage, WOMIT sie ihn zeichnet.
   *     Ohne diesen Schritt bekaeme der Anker den
   *     `volumetricLightScatteringPass`-Shader der Verdecker — und der endet
   *     bedingungslos auf `gl_FragColor = vec4(0,0,0,1)`. Der Anker waere dann
   *     im Puffer, aber schwarz: dieselbe Null, nur an einer anderen Stelle.
   */
  verbinde(vls: VolumetricLightScatteringPostProcess): void {
    this.verbunden = vls;
    const pass = vls.getPass();
    pass.getCustomRenderList = (_durchlauf, vorgabe, laenge) => {
      const l = this.liste;
      l.length = laenge + 1;
      for (let i = 0; i < laenge; i++) l[i] = vorgabe![i]!;
      l[laenge] = this.mesh;
      return l;
    };
    // Eine 2D-Zieltextur hat genau eine Passage; die Schleife steht hier,
    // weil `renderPassIds` das Feld ist, das Babylon garantiert — nicht
    // `renderPassId`, das nur den ersten Eintrag liefert.
    this.passagenIds = pass.renderPassIds.slice();
    for (const id of this.passagenIds) this.mesh.setMaterialForRenderPass(id, this.material);
  }

  /**
   * Anker setzen. `computeWorldMatrix(true)` ist Pflicht und nicht
   * Vorsicht: Ein Mesh ausserhalb der aktiven Liste wird von
   * `_evaluateActiveMeshes` nie angefasst, und `renderSubMesh` liest die
   * zwischengespeicherte Matrix.
   */
  setzePosition(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
    this.mesh.computeWorldMatrix(true);
  }

  dispose(): void {
    for (const id of this.passagenIds) this.mesh.setMaterialForRenderPass(id, undefined);
    this.passagenIds = [];
    if (this.verbunden) {
      // Die Zieltextur kann bereits abgeraeumt sein; dann ist nichts zu tun.
      try {
        this.verbunden.getPass().getCustomRenderList = null;
      } catch {
        /* Pass schon weg — nichts zu loesen. */
      }
      this.verbunden = null;
    }
    this.mesh.dispose();
    this.material.dispose();
  }
}

// Muss vor der ersten Uebersetzung eines Strahlenpasses laufen — ein Import
// dieser Datei genuegt dafuer, weil beide Aufrufer sie importieren.
korrigiereStrahlenKomposit();
