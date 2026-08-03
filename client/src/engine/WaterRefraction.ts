/**
 * WaterRefraction — der Szenenpass, durch den man im Wasser den Grund sieht.
 *
 * ── Warum überhaupt ein eigener Pass ────────────────────────────────
 * Das Original-Wasser ist NICHT alphagemischt. Im `water`-Material
 * (extracted_assets/Material, m_Name "water") stehen:
 *
 *     _SrcBlend = 1 (One)   _DstBlend = 0 (Zero)   _ZWrite = 1
 *
 * Das ist ein OPAKER Blend-State. Die gesamte Durchsicht entsteht dort
 * dadurch, dass der Shader die bereits gerenderte Szene abtastet und sie
 * über die Wassertiefe gegen die Wasserfarbe mischt — gesteuert von
 * `_RefractionScale` (0,1) und `_RefractionMax` (0,01).
 *
 * Vorher hat das WaterPlugin das Ergebnis mit Alpha-Blending nachgeahmt
 * (ALPHA_SHALLOW 0,16 → ALPHA_DEEP 0,88 plus ein Fresnel-Korrekturglied).
 * Das trifft die Fernsicht passabel, aber am Strand nie: Alpha mischt das
 * Wasser gegen ALLES dahinter, auch gegen Himmel und Nebel, und es kann
 * den Grund nicht verzerren. Mit diesem Pass sehen wir tatsächlich den
 * Meeresboden, so wie ihn das Original zeigt.
 *
 * ── Was in den Pass hineingerendert wird ────────────────────────────
 * Nur, was durch Wasser überhaupt zu sehen ist: das Gelände und jedes
 * Objekt, das unter die Wasserlinie reicht. Nicht das Wasser selbst (es
 * bildete sich sonst rekursiv ab), nicht das Gras-Clutter und nichts,
 * was vollständig über dem Wasser steht — ein Baum am Ufer erscheint
 * nicht im Meeresgrund.
 *
 * Das ist keine Kosmetik, sondern der entscheidende Kostenfaktor.
 * Gemessen am 2026-07-30, Küste bei (30, -46), 1600×900:
 *
 *   Wasserqualität Aus                        59-63 fps
 *   Pass mit ALLEN ~880 Meshes                43-45 fps
 *   Pass mit dieser Auswahl (~630 Meshes)        47 fps
 *   Pass mit NUR den ~206 Terrain-Meshes         56 fps
 *
 * Die letzte Zeile ist verlockend und trotzdem falsch: das Wasser ist
 * jetzt opak, also verschwindet alles, was nicht im Pass steht,
 * vollständig unter der Oberfläche — Steine im Flachwasser ebenso wie
 * die eigenen Beine, wenn man knietief im Wasser steht. Die 9 fps sind
 * der Preis dafür, dass unter Wasser überhaupt noch etwas liegt.
 *
 * Die Auflösung des Passes ist dagegen fast bedeutungslos (400×225 → 43,
 * 800×450 → 43, 1600×900 → 41 fps): der zweite Szenendurchlauf kostet
 * Draw-Calls und Vertex-Arbeit, keine Pixel. Der Regler wirkt deshalb
 * vor allem als Aus/An — die Zwischenstufen helfen erst auf Geräten, die
 * über die Füllrate limitiert sind statt über die Geometrie.
 *
 * ── Auflösung ───────────────────────────────────────────────────────
 * Ein Bruchteil der aktuellen Render-Auflösung, damit der Pass AUCH an
 * der Einstellung "Renderauflösung" hängt (setHardwareScalingLevel in
 * main.ts) und nicht nur am eigenen Regler. Ein halbiertes
 * Refraktionsbild fällt nicht auf — es wird ohnehin durch eine bewegte
 * Wasseroberfläche verzerrt.
 *
 * ⚠ Die Grösse wird ausgerechnet und in Pixeln übergeben, NICHT als
 * `{ratio}`. Babylon jagt `ratio` durch `_bestReflectionRenderTarget-
 * Dimension()` und rundet dabei auf Zweierpotenzen: aus 1600×900 wird
 * 1024×512. Das ist für Reflexions-Cubemaps gedacht, hier aber fatal —
 * die Kamera nimmt beim Rendern das Seitenverhältnis des Ziels (2,00
 * statt 1,78), das Refraktionsbild zeigt also einen ANDEREN Ausschnitt
 * als das Hauptbild, und der Grund erscheint im Wasser verschoben.
 */
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { WATER_LEVEL } from '@wov/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

/**
 * Auflösung des Refraktionsbildes relativ zur Render-Auflösung, indiziert
 * über die Einstellung "Wasserqualität" (0..3).
 *
 * Stufe 0 baut gar keinen Pass auf — das WaterPlugin fällt dann auf den
 * alten Alpha-Pfad zurück. Das ist die Notbremse für schwache Geräte:
 * ein zusätzlicher Szenendurchlauf kostet Vertex-Arbeit, die sich durch
 * eine kleinere Textur NICHT wegskalieren lässt.
 */
export const WATER_QUALITY_RATIO = [0, 0.25, 0.5, 1.0] as const;

/**
 * Höhe, unter die ein Objekt reichen muss, um in der Brechung
 * aufzutauchen — exakt die Wasserlinie, ohne Toleranz nach oben.
 *
 * Ein erster Versuch mit +2 m Zuschlag (gedacht für den Wellenhub) ließ
 * 682 von 927 Meshes durch: ein Baum am Ufer steht mit seinem Stammfuss
 * auf ~30,5 m und lag damit noch unter der Schwelle, obwohl von ihm kein
 * Millimeter unter Wasser ist. Die Bounding-Box wird ohnehin am
 * UNTERSTEN Punkt gemessen, ein halb versunkener Stein rutscht also auch
 * ohne Zuschlag hinein.
 */
const TAUCHT_EIN_BIS = WATER_LEVEL;

/** Gehört das Mesh in die Brechung? */
function gehoertHinein(mesh: AbstractMesh): boolean {
  const n = mesh.name;
  // startsWith statt Namensliste: das Fernwasser heisst seit dem Umbau auf
  // die Ringgeometrie 'waterRing'. Stünde es hier nicht drin, spiegelte
  // sich das Wasser in sich selbst.
  if (n.startsWith('water') || n.startsWith('clutter_')) return false;
  // Die Himmelskuppel umspannt die ganze Szene, ihre Bounding-Box reicht
  // damit zwangsläufig unter die Wasserlinie — durchs Wasser gesehen hat
  // sie trotzdem nichts zu suchen.
  if (n === 'valheimSky') return false;
  // Fern-Terrain (2×2 Zonen, 4-m-Raster) liegt per Konstruktion JENSEITS
  // des Nah-Rings, also mindestens 160 m weg (Detailgrad "Hoch": 4 Zonen).
  // Dort schwimmt kein Nahwasser mehr, sondern der blickdichte Fernring —
  // durch den ist nichts zu sehen, und gerendert wurde es trotzdem: 96 der
  // 196 Meshes dieses Passes waren Fern-Chunks (gemessen 2026-08-02).
  if (n.startsWith('terrain_far')) return false;
  // Das Gelände IST der Meeresgrund — immer drin, ohne Höhenprüfung
  // (ein Chunk reicht fast immer über die Wasserlinie hinaus).
  if (n.startsWith('terrain')) return true;
  if (!mesh.subMeshes || mesh.subMeshes.length === 0) return false;
  return mesh.getBoundingInfo().boundingBox.minimumWorld.y < TAUCHT_EIN_BIS;
}

export class WaterRefraction {
  private rtt: RenderTargetTexture | null = null;
  private stufe = -1;
  private readonly abmelden: Array<() => void> = [];

  constructor(private readonly scene: Scene) {}

  /** Die Textur für das WaterPlugin — `null`, solange die Stufe 0 ist. */
  get texture(): RenderTargetTexture | null {
    return this.rtt;
  }

  /**
   * Setzt die Qualitätsstufe (0..3). Baut den Pass auf bzw. wieder ab;
   * ein Wechsel zwischen zwei aktiven Stufen erzeugt die Textur neu, weil
   * `ratio` nach der Konstruktion nicht mehr änderbar ist.
   */
  setQuality(stufe: number): void {
    const s = Math.max(0, Math.min(WATER_QUALITY_RATIO.length - 1, Math.round(stufe)));
    if (s === this.stufe) return;
    this.stufe = s;
    this.abbauen();
    const ratio = WATER_QUALITY_RATIO[s];
    if (ratio <= 0) return;

    const engine = this.scene.getEngine();
    const groesse = (): { width: number; height: number } => ({
      width: Math.max(1, Math.round(engine.getRenderWidth() * ratio)),
      height: Math.max(1, Math.round(engine.getRenderHeight() * ratio)),
    });
    const rtt = new RenderTargetTexture(
      'waterRefraction',
      groesse(),
      this.scene,
      /* generateMipMaps */ false
    );
    // Fenstergröße und Renderauflösung ändern sich zur Laufzeit
    // (setHardwareScalingLevel löst dasselbe Observable aus) — ohne das
    // hier bliebe das Refraktionsbild in der alten Form stehen.
    const beiResize = engine.onResizeObservable.add(() => rtt.resize(groesse()));
    this.abmelden.push(() => engine.onResizeObservable.remove(beiResize));
    // Hintergrund des Passes = Nebelfarbe, damit die Ränder (wo das
    // Wasser über den Horizont hinausragt) nicht auffallen.
    //
    // Der Wert MUSS je Frame nachgezogen werden: Lighting.apply() weist
    // scene.clearColor jeden Frame ein NEUES Color4-Objekt zu, eine
    // einmalige Kopie hier veraltete also sofort und hätte für den Rest
    // der Sitzung die Farbe des ersten Frames behalten.
    rtt.clearColor = this.scene.clearColor.clone();
    const beiClear = this.scene.onBeforeRenderObservable.add(() => {
      rtt.clearColor.copyFrom(this.scene.clearColor);
    });
    this.abmelden.push(() => this.scene.onBeforeRenderObservable.remove(beiClear));
    rtt.renderParticles = false;
    rtt.renderSprites = false;
    // ── Renderliste: die AKTIVEN Meshes, gefiltert ──────────────────
    //
    // Explizite Renderliste statt `null`: nur so lässt sich die Auswahl
    // oben durchsetzen.
    //
    // ⚠ Die Annahme "Babylon prüft pro Eintrag weiterhin Frustum und
    // Sichtbarkeit" (so stand es hier) ist FALSCH und war der teuerste
    // Irrtum dieses Passes. `ObjectRenderer._prepareRenderingManager()`
    // prüft bei einer expliziten Liste nur `isEnabled && isVisible &&
    // subMeshes` — die Frustum-Prüfung steckt in
    // `Scene._evaluateActiveMeshes()` und wird für eine eigene Liste
    // gerade NICHT durchlaufen. Gemessen am 2026-08-02: der Hauptpass
    // zeichnete 33 Nah- und 30 Fern-Chunks, dieser Pass alle 81 bzw. 96 —
    // also auch alles hinter der Kamera.
    //
    // Deshalb wird die Liste jetzt aus `scene.getActiveMeshes()` gebildet:
    // die ist bereits frustum-gekullt, und für einen SCREENSPACE-Effekt
    // ist genau das die richtige Menge — was nicht im Bild steht, kann
    // auch durch das Wasser nicht gesehen werden.
    //
    // Der Zeitpunkt ist `onAfterActiveMeshesEvaluationObservable`: früher
    // (onBeforeRender) stünde noch die Liste des Vorframes da, später
    // wären die Render-Targets schon durch. Damit erledigt sich auch der
    // alte Grund für den Ein-Sekunden-Takt — ein Mesh in der Aktivliste
    // hat seine Weltmatrix garantiert schon berechnet, die Höhenprüfung
    // greift also sofort statt erst nach bis zu einer Sekunde.
    const neuAufbauen = (): void => {
      const aktiv = this.scene.getActiveMeshes();
      const liste: AbstractMesh[] = [];
      for (let i = 0; i < aktiv.length; i++) {
        const m = aktiv.data[i]!;
        if (gehoertHinein(m)) liste.push(m);
      }
      rtt.renderList = liste;
    };
    neuAufbauen();
    const beiFrame = this.scene.onAfterActiveMeshesEvaluationObservable.add(neuAufbauen);
    this.abmelden.push(() =>
      this.scene.onAfterActiveMeshesEvaluationObservable.remove(beiFrame)
    );

    // customRenderTargets wird VOR dem Hauptbild abgearbeitet — genau die
    // Reihenfolge, die wir brauchen.
    this.scene.customRenderTargets.push(rtt);
    this.rtt = rtt;
  }

  private abbauen(): void {
    for (const fn of this.abmelden.splice(0)) fn();
    if (!this.rtt) return;
    const i = this.scene.customRenderTargets.indexOf(this.rtt);
    if (i >= 0) this.scene.customRenderTargets.splice(i, 1);
    this.rtt.dispose();
    this.rtt = null;
  }

  dispose(): void {
    this.abbauen();
    this.stufe = -1;
  }
}
