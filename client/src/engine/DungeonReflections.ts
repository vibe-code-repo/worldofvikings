/**
 * Spiegelnde Boeden im Dungeon — SSR (M2 / AP17).
 * Reflective floors in a dungeon — screen space reflections.
 *
 * ── Drei Wege, und keiner ist offensichtlich der richtige ─────────────
 * `render-tech.md` §3.2 kannte zwei; Babylon 8.56 hat drei, und der dritte ist
 * genau der, den das Dokument fuer unmoeglich hielt:
 *
 *   1 `Einfach`  — `ScreenSpaceReflectionPostProcess`, der alte Pass. Arbeitet
 *                  auf Farbe, Tiefe und Normale; keine Reflektivitaet, also
 *                  spiegelt er ueberall gleich stark.
 *   2 `GBuffer`  — `SSRRenderingPipeline` mit `forceGeometryBuffer = true`.
 *                  Der GeometryBufferRenderer HAT seit Babylon 8 eine
 *                  Reflektivitaets-MRT (`REFLECTIVITY_TEXTURE_TYPE = 4`,
 *                  `enableReflectivity`), und die Pipeline schaltet sie selbst
 *                  ein. Damit braucht auch das moderne SSR keinen
 *                  PrePassRenderer — es haengt sich an GENAU DIE Passage, die
 *                  unser SSAO2 (`forceGeometryBuffer = true`) ohnehin bezahlt.
 *   3 `PrePass`  — `SSRRenderingPipeline` ohne Zwang, also ueber den
 *                  PrePassRenderer. Zweite vollstaendige Zusatzpassage neben
 *                  dem GeometryBuffer.
 *
 * ── Der Unterschied, der die Bildqualitaet macht ──────────────────────
 * Er liegt NICHT in der Pipeline, sondern darin, WER die Normale und die
 * Rauheit schreibt:
 * - Der GeometryBufferRenderer baut seinen eigenen Effekt aus einer festen
 *   Liste (`geometryBufferRenderer.js`) — MaterialPlugins laufen darin NICHT.
 *   Unser Triplanar-Plugin rechnet Normale, Rauheit und die Feuchte-Maske im
 *   Fragment-Shader des Materials; davon kommt in der GBuffer-Passage nichts
 *   an. Sie sieht `metallic = 0, roughness = 1` — den Materialwert, nicht den
 *   Bildpunktwert.
 * - Der PrePassRenderer schreibt aus dem SHADER DES MATERIALS heraus. Dort
 *   laeuft unser Plugin, also traegt er die echte, nasse Stelle.
 * Der GeometryBuffer-Weg ist also billiger UND unschaerfer, und zwar nicht ein
 * bisschen: Er kann „nur der feuchte Boden spiegelt" gar nicht wissen.
 * The difference in quality is not the pipeline but WHO writes normal and
 * roughness: the GBuffer builds its own effect and material plugins do NOT run
 * in it, so it sees the material value, not the per-pixel one. The prepass
 * writes from the material's own shader, where our plugin runs.
 *
 * Welcher Weg genommen wird, entscheidet die Messung und das Bild, nicht dieser
 * Kommentar — deshalb sind alle drei baubar und ueber `?ssr=` einzeln
 * anwaehlbar. Das Ergebnis steht im `decisions-log.md`.
 * Which way is taken is decided by the measurement and the picture; all three
 * are buildable and selectable, and the outcome is in the decisions log.
 */
import { ScreenSpaceReflectionPostProcess } from '@babylonjs/core/PostProcesses/screenSpaceReflectionPostProcess';
import { SSRRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Der gewaehlte Weg. `Aus` ist kein Sonderfall, sondern ein Wert: Der Schalter
 * soll auch dann eine Zahl haben, wenn nichts laeuft, damit die Messreihe eine
 * Zeile fuer „aus" hat und nicht eine Luecke.
 * The chosen route. `Aus` is a value, not a special case.
 */
export const enum DungeonSsrWeg {
  Aus = 0,
  Einfach = 1,
  GBuffer = 2,
  PrePass = 3,
}

/** Name der Pipeline — auch der Schluessel beim An- und Abhaengen. */
const PIPELINE_NAME = 'dungeon2SSR';

/**
 * Schrittweite des Bildraum-Strahls in Bildpunkten und seine Laenge in Metern.
 *
 * Beide sind Innenraum-Zahlen und nicht Babylons Voreinstellungen: Ein
 * Reflexionsstrahl, der 1000 m weit laeuft, verlaesst im Dungeon nach drei
 * Metern die Wand und tastet danach nur noch Bildschirmrand ab — das ist der
 * Streifen, den man als „SSR-Artefakt" kennt. 12 m deckt einen Gang.
 * Step size of the screen space ray in pixels and its length in metres — both
 * interior numbers, not Babylon's defaults: a ray running 1000 m leaves the
 * wall after three metres and samples screen edge afterwards, which is the
 * streak everyone knows as "the SSR artefact".
 */
const SCHRITT_PX = 1.0;
const REICHWEITE_M = 12;

/**
 * Ab welcher Reflektivitaet ueberhaupt gespiegelt wird.
 *
 * Babylons Vorgabe ist 0.04 — und 0.04 ist genau der Fresnel-Grundwert JEDES
 * Dielektrikums. Mit der Vorgabe spiegelt also die ganze Welt ein bisschen,
 * auch trockener Fels. Ein Steingrab ist kein Spiegelsaal; die Schwelle liegt
 * deshalb darueber.
 * Babylon's default is 0.04 — exactly the Fresnel base of EVERY dielectric, so
 * with the default the entire world reflects a little, dry rock included.
 */
const REFLEKTIVITAET_SCHWELLE = 0.06;

/** Staerke der Spiegelung. / Strength of the reflection. */
const STAERKE = 0.55;

export class DungeonSpiegelung {
  private weg = DungeonSsrWeg.Aus;
  private pipeline: SSRRenderingPipeline | null = null;
  private einfach: ScreenSpaceReflectionPostProcess | null = null;
  private abgeraeumt = false;
  /** Was beim Bauen schiefging — der Zeuge fuer „Schalter ohne Wirkung". */
  private fehler: string | null = null;
  /**
   * Zaehler der Umschaltungen. Der PrePass-Weg baut nach einem `await` (siehe
   * `bauePrePass`) — ohne diesen Zaehler landete eine Pipeline in der Szene,
   * deren Weg der Aufrufer in der Zwischenzeit schon wieder abgewaehlt hat.
   * Switch counter: the prepass route builds after an `await`, and without it a
   * pipeline could land in a scene whose route was deselected meanwhile.
   */
  private stand = 0;

  constructor(
    private readonly scene: Scene,
    private readonly kamera: Camera
  ) {}

  /**
   * Weg setzen. Ein Wechsel raeumt den alten vollstaendig ab, statt zwei
   * Spiegelungen uebereinanderzulegen — dasselbe Argument wie bei den zwei
   * SSAO-Pipelines in `DungeonAtmosphere.ts`: Das saehe nicht nach „doppelt"
   * aus, sondern nach „falsch", und man suchte es im Material.
   * Set the route. A switch tears the old one down completely.
   */
  setzeWeg(weg: DungeonSsrWeg): void {
    if (this.abgeraeumt || this.weg === weg) return;
    this.raeumeAb();
    this.weg = weg;
    this.stand += 1;
    this.fehler = null;
    if (weg === DungeonSsrWeg.Aus) return;
    if (weg === DungeonSsrWeg.PrePass) {
      void this.bauePrePass(this.stand);
      return;
    }
    try {
      if (weg === DungeonSsrWeg.Einfach) this.baueEinfach();
      else this.bauePipeline(true);
    } catch (f) {
      // Ein SSR, das nicht baut, darf den Dungeon nicht kosten — dieselbe
      // Haltung wie die Notbremse des Materials. Der Grund wird aber
      // festgehalten, sonst meldet `werte()` „aus" und niemand weiss warum.
      // An SSR that fails to build must not cost the dungeon; but the reason is
      // kept, otherwise `werte()` reads "off" and nobody knows why.
      this.fehler = String(f).slice(0, 200);
      console.error('[dungeon2] SSR konnte nicht gebaut werden:', f);
      this.raeumeAb();
      this.weg = DungeonSsrWeg.Aus;
    }
  }

  /** Nur zum Messen: der tatsaechliche Zustand. / For measuring only. */
  werte(): { weg: number; an: boolean; prepass: boolean; gbuffer: boolean; fehler: string | null } {
    return {
      weg: this.weg,
      an: this.pipeline !== null || this.einfach !== null,
      // Die beiden Zeugen der PrePass-Frage: Wer hier `prepass: true` UND
      // `gbuffer: true` sieht, bezahlt ZWEI vollstaendige Zusatzpassagen.
      // The two witnesses of the prepass question: `true`/`true` means TWO
      // complete extra passes are being paid for.
      prepass: this.scene.prePassRenderer !== undefined && this.scene.prePassRenderer !== null,
      gbuffer: this.scene.geometryBufferRenderer !== undefined && this.scene.geometryBufferRenderer !== null,
      fehler: this.fehler,
    };
  }

  dispose(): void {
    if (this.abgeraeumt) return;
    this.raeumeAb();
    this.weg = DungeonSsrWeg.Aus;
    this.abgeraeumt = true;
  }

  // ── innen / internals ───────────────────────────────────────────────────

  private baueEinfach(): void {
    // Der letzte Parameter ist `forceGeometryBuffer` — true, aus demselben
    // Grund wie bei SSAO2: Der Vorgabepfad rief `enablePrePassRenderer()`,
    // und der Seiteneffekt-Import dafuer fehlt in diesem Projekt bewusst.
    // The last parameter is `forceGeometryBuffer` — true for the same reason as
    // in SSAO2: the default path would call `enablePrePassRenderer()`.
    const pp = new ScreenSpaceReflectionPostProcess(
      'dungeon2SsrEinfach',
      this.scene,
      1.0,
      this.kamera,
      undefined,
      this.scene.getEngine(),
      false,
      Constants.TEXTURETYPE_HALF_FLOAT,
      false,
      true
    );
    pp.strength = STAERKE;
    pp.reflectionSpecularFalloffExponent = 3;
    pp.enableSmoothReflections = false;
    pp.reflectionSamples = 32;
    this.einfach = pp;
  }

  /**
   * Der PrePass-Weg, und warum er als EINZIGER nachgeladen wird.
   *
   * `scene.enablePrePassRenderer()` ist keine Methode der Szene, sondern wird
   * von `prePassRendererSceneComponent` an den Prototyp gehaengt.
   * `ssrRenderingPipeline.js` zieht diese Komponente NICHT nach (es importiert
   * nur die GeometryBuffer-Komponente) — ohne den Import faende der Weg 3
   * still keinen PrePass und saehe aus wie „SSR tut nichts".
   *
   * Nachgeladen statt oben importiert, weil der Import ein SEITENEFFEKT ist:
   * Er haengt eine Szenenkomponente an JEDE Szene dieses Clients, auch an die
   * der Oberwelt, die den PrePass ausdruecklich meidet. Ein Weg, der beim
   * Messen verlieren kann, darf den ausgelieferten Client nicht dauerhaft
   * belasten.
   * The prepass route is the only one loaded on demand, because the import is a
   * SIDE EFFECT: it attaches a scene component to EVERY scene of this client,
   * including the overworld's, which avoids the prepass on purpose. A route
   * that may lose the measurement must not weigh on the shipped client.
   */
  private async bauePrePass(stand: number): Promise<void> {
    try {
      await import('@babylonjs/core/Rendering/prePassRendererSceneComponent');
      if (this.abgeraeumt || this.stand !== stand) return;
      this.bauePipeline(false);
    } catch (f) {
      if (this.stand !== stand) return;
      this.fehler = String(f).slice(0, 200);
      console.error('[dungeon2] SSR über PrePass konnte nicht gebaut werden:', f);
      this.raeumeAb();
      this.weg = DungeonSsrWeg.Aus;
    }
  }

  private bauePipeline(ueberGBuffer: boolean): void {
    const p = new SSRRenderingPipeline(
      PIPELINE_NAME,
      this.scene,
      [this.kamera],
      ueberGBuffer,
      Constants.TEXTURETYPE_HALF_FLOAT
    );
    p.step = SCHRITT_PX;
    p.maxDistance = REICHWEITE_M;
    p.maxSteps = 1000;
    p.thickness = 0.4;
    p.strength = STAERKE;
    p.reflectivityThreshold = REFLEKTIVITAET_SCHWELLE;
    // Halbe Aufloesung: Eine Spiegelung im nassen Boden ist per Bauart
    // unscharf, und die Aufloesung sieht man ihr weniger an als der Bildrate.
    // Half resolution: a reflection in a wet floor is blurry by construction.
    p.ssrDownsample = 1;
    p.blurDispersionStrength = 0.05;
    p.attenuateScreenBorders = true;
    p.attenuateBackfaceReflection = true;
    this.pipeline = p;
  }

  private raeumeAb(): void {
    if (this.pipeline !== null) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    if (this.einfach !== null) {
      this.einfach.dispose(this.kamera);
      this.einfach = null;
    }
    // Den PrePass ausdruecklich wieder abschalten. Babylon raeumt beim
    // `dispose()` der Pipeline nur DEREN Konfiguration aus dem PrePass; der
    // Renderer selbst — eine vollstaendige Zusatzpassage ueber die ganze
    // Geometrie — bliebe stehen. Der Effekt waere weg, die Kosten blieben, und
    // genau so sieht ein Leck aus, das niemand findet.
    // Switch the prepass off explicitly: disposing the pipeline only removes
    // ITS configuration; the renderer — a complete extra pass — would stay. The
    // effect gone, the cost remaining: that is what an unfindable leak is.
    const szene = this.scene as Scene & { disablePrePassRenderer?: () => void };
    if (szene.prePassRenderer != null && typeof szene.disablePrePassRenderer === 'function') {
      szene.disablePrePassRenderer();
    }
  }
}
