/**
 * DungeonAtmosphaere — die Bildwirkung im Inneren: dungeon-kalibriertes SSAO
 * und der Grafikstufen-Schalter (AP10, Meilenstein 1).
 * DungeonAtmosphere — the interior look: dungeon calibrated SSAO and the
 * graphics tier switch (AP10, milestone 1).
 *
 * SSR, Godrays und Parallax stehen ausdruecklich NICHT hier: sie sind
 * Meilenstein 2 (ARCHITECTURE W9). Der Parallax-Zweig existiert im Shader und
 * ist ueber `erlaubeDungeonParallax()` zuschaltbar — dieses Modul schaltet ihn
 * nicht ein.
 * SSR, godrays and parallax are explicitly NOT here: they are milestone 2.
 *
 * ── Warum eine eigene Pipeline und nicht die von `PostProcessing.ts` ────────
 * Die Aussenwelt-Pipeline ist auf 4 km kalibriert (`SSAO_MAX_Z = 1000`). Ihr
 * `maxZ` ist der Tiefenbereich, ueber den die Verdeckung ueberhaupt gerechnet
 * wird; bei 1000 m verteilt sich die Tiefengenauigkeit auf das Tausendfache
 * dessen, was ein Innenraum braucht, und die Ecke zwischen Wand und Boden —
 * der einzige Ort, an dem SSAO im Dungeon etwas beitraegt — faellt unter die
 * Aufloesung. Deshalb eine zweite Pipeline mit eigenen Zahlen statt einer
 * umgeschalteten.
 * The outdoor pipeline is calibrated for 4 km (`SSAO_MAX_Z = 1000`). Its
 * `maxZ` is the depth range occlusion is computed over at all; at 1000 m the
 * depth precision spreads over a thousand times what an interior needs.
 *
 * Beim Betreten wird die Aussen-Pipeline von der Kamera GETRENNT und beim
 * Verlassen wieder angehaengt — nicht abgeschaltet. Zwei SSAO-Pipelines auf
 * derselben Kamera rechneten die Verdeckung zweimal und legten sie
 * uebereinander; das sieht nicht nach „doppelt" aus, sondern nach „zu dunkel",
 * und man sucht es im Material.
 * On entering, the outdoor pipeline is DETACHED from the camera and reattached
 * on leaving — not switched off. Two SSAO pipelines on one camera would
 * multiply the occlusion; that does not look "doubled", it looks "too dark".
 */
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import { DungeonGrafikStufe, setzeDungeonStufe } from './DungeonMaterial';

/**
 * Tiefenbereich der Verdeckungsrechnung in Metern.
 *
 * GEMESSEN, nicht uebernommen (AP10-Kriterium 3): `client/test/dungeon2-bauer.ts`
 * laeuft ueber 40 erzeugte Steingraeber und misst die freie Sichtstrecke von
 * jeder begehbaren Zelle in alle vier Richtungen — also genau die Strecke, ueber
 * die im Dungeon ueberhaupt etwas zu verdecken ist. Ergebnis ueber 47.328
 * Sichtlinien: Median 8 m, 90. Perzentil 28 m, 99. Perzentil 60 m, laengste
 * 112 m. 60 m deckt damit 99 % der Sichtlinien und ist zugleich das obere Ende
 * des von `render-tech.md` §3 genannten Fensters 30-60 m.
 * Depth range of the occlusion computation in metres. MEASURED, not adopted
 * (AP10 criterion 3): the test walks 40 generated barrows and measures the open
 * sight distance from every walkable cell in all four directions — over 47,328
 * sight lines: median 8 m, 90th percentile 28 m, 99th percentile 60 m, longest
 * 112 m.
 *
 * Die Zahl steht unter Vorbehalt einer GPU-Messung: sie ist aus der Geometrie
 * hergeleitet, nicht aus einem Bild. Was sie ausschliesst, ist der Fehler
 * „1000 aus der Aussenwelt uebernommen"; was sie nicht leistet, ist der Blick.
 * The number is subject to a GPU measurement: it is derived from geometry, not
 * from a picture. It rules out "1000 adopted from outdoors"; it is not a look.
 */
export const DUNGEON_SSAO_MAX_Z = 60;

/**
 * Abtastradius in Metern.
 *
 * Ebenfalls gemessen: `kantenAbstand` ist der Meterabstand einer Ecke zur
 * naechsten konkaven Kante, den der Bauer je Vertex ausrechnet — dieselbe
 * Groesse, die SSAO sichtbar machen soll. Ueber 40 Graeber und 330.376 Ecken:
 * Mittel 0,35 m, 90. Perzentil 1,0 m, groesster ungedeckelter Wert 1,5 m; nur
 * 1,2 % laufen in den 2-Meter-Deckel. Ein Radius zwischen Mittel und
 * 90. Perzentil trifft die Fugen; die Aussenwelt-Zahl 0,15 m traefe im
 * 4-Meter-Raster fast nichts.
 * Sampling radius in metres. Also measured: `kantenAbstand` is the metric
 * distance of a corner to the nearest concave edge, computed per vertex by the
 * builder — the same quantity SSAO is meant to show. Over 40 barrows and
 * 330,376 corners: mean 0.35 m, 90th percentile 1.0 m, largest uncapped 1.5 m.
 */
export const DUNGEON_SSAO_RADIUS = 0.45;

/** Name der eigenen Pipeline. / Name of our own pipeline. */
const PIPELINE_NAME = 'dungeon2SSAO';

/**
 * Pipelines, die beim Betreten von der Kamera getrennt werden.
 * `PostProcessing.ts` nennt die Aussen-Pipeline `valheimSSAO`; sie steht hier
 * als Zeichenkette und nicht als Import, weil `PostProcessing.ts` sie nicht
 * exportiert und ein Import nur wegen eines Namens die ganze Nachbearbeitung in
 * den Dungeon-Pfad zoege.
 * Pipelines detached from the camera on entering. `PostProcessing.ts` calls the
 * outdoor pipeline `valheimSSAO`; it stands here as a string because importing
 * it for a name alone would drag the whole post pipeline into this path.
 */
const FREMDE_PIPELINES: readonly string[] = ['valheimSSAO'];

/** Abtastzahl je Stufe. / Sample count per tier. */
const PROBEN_JE_STUFE: Readonly<Record<DungeonGrafikStufe, number>> = {
  [DungeonGrafikStufe.Niedrig]: 0,
  [DungeonGrafikStufe.Mittel]: 8,
  [DungeonGrafikStufe.Hoch]: 16,
};

/**
 * Aufloesungsanteil je Stufe. Halbe Aufloesung ist die Voreinstellung der
 * Aussenwelt und bleibt es auf Mittel; auf Hoch kostet volle Aufloesung genau
 * das, was sie an Kantenschaerfe bringt — und die Entscheidung darueber gehoert
 * in eine Messung, nicht in eine Meinung, deshalb steht sie als Zahl hier.
 * Resolution ratio per tier. Half resolution is the outdoor default.
 */
const VERHAELTNIS_JE_STUFE: Readonly<Record<DungeonGrafikStufe, number>> = {
  [DungeonGrafikStufe.Niedrig]: 0.5,
  [DungeonGrafikStufe.Mittel]: 0.5,
  [DungeonGrafikStufe.Hoch]: 0.75,
};

/** Gesamtstaerke der Verdeckung. / Overall occlusion strength. */
const STAERKE = 1.1;

/**
 * Alles, was diese Klasse von der Weltbeleuchtung braucht — eine Methode.
 *
 * Als Schnittstelle und nicht als `Lighting`-Import: Die Vorschau
 * (`dungeon2Preview.ts`) hat kein `Lighting`, sondern ein einzelnes
 * `HemisphericLight`, und sie soll denselben Regler bedienen koennen wie das
 * Spiel — sonst prueft man in der Vorschau eine Zahl, die im Spiel eine
 * andere Wirkung hat.
 * Everything this class needs from the world lighting — one method. An
 * interface rather than a `Lighting` import, because the preview has no
 * `Lighting` but must drive the same knob.
 */
export interface Grundlicht {
  /** `null` = Oberwelt, sonst der Faktor 0..1. / `null` = overworld. */
  setzeDungeonDaempfung(faktor: number | null): void;
}

export class DungeonAtmosphaere {
  private pipeline: SSAO2RenderingPipeline | null = null;
  private angehaengt = false;
  /** Fremde Pipelines, die WIR getrennt haben — nur die werden zurueckgehaengt. */
  /** Foreign pipelines WE detached — only those get reattached. */
  private getrennt: string[] = [];
  private stufe: DungeonGrafikStufe;
  private abgeraeumt = false;
  /** Aufloesungsanteil, mit dem die lebende Pipeline gebaut wurde; -1 = keine. */
  /** Ratio the living pipeline was built with; -1 = none. */
  private gebautMit = -1;

  constructor(
    private readonly scene: Scene,
    private readonly kamera: Camera,
    stufe: DungeonGrafikStufe = DungeonGrafikStufe.Mittel,
    /**
     * Grundhelligkeit dieses Dungeons (0..1) und der Regler, an dem sie
     * anliegt. Ohne `licht` bleibt `ambientLicht` folgenlos — dann gibt es
     * niemanden, der die Beleuchtung besitzt, und diese Klasse macht sich
     * keine eigene auf (der Bauer macht auch keine Lichter, s. `LightPool`).
     * The base brightness of this dungeon and the knob it applies to.
     */
    private readonly ambientLicht: number = 1,
    private readonly licht: Grundlicht | null = null
  ) {
    this.stufe = stufe;
  }

  /** Die gerade gesetzte Stufe. / The currently set tier. */
  get grafikStufe(): DungeonGrafikStufe {
    return this.stufe;
  }

  /**
   * Betritt den Dungeon: Aussen-SSAO ab, Dungeon-SSAO an.
   * Enter the dungeon: outdoor SSAO off, dungeon SSAO on.
   */
  betrete(): void {
    if (this.abgeraeumt) return;
    setzeDungeonStufe(this.stufe);
    this.trenneFremde();
    this.wendeStufeAn();
    this.licht?.setzeDungeonDaempfung(this.ambientLicht);
  }

  /**
   * Verlaesst den Dungeon: Dungeon-SSAO ab, die vorher getrennten Pipelines
   * zurueck an die Kamera. Die eigene Pipeline bleibt bestehen — sie wieder
   * aufzubauen kostet eine Shader-Uebersetzung je Tuer.
   * Leave the dungeon: dungeon SSAO off, the previously detached pipelines back
   * onto the camera. Our own pipeline stays alive.
   */
  verlasse(): void {
    if (this.abgeraeumt) return;
    // Die Grundhelligkeit ZUERST zurueckgeben, aus demselben Grund, aus dem
    // `Dungeon2Instanz.verlasse()` diese Klasse zuerst ruft: Ein Fehler weiter
    // unten liesse die Oberwelt sonst in Dungeon-Beleuchtung stehen — ein
    // Fehler, den man erst beim naechsten Sonnenaufgang sieht.
    // Give the base brightness back FIRST — an error further down would
    // otherwise leave the overworld in dungeon lighting.
    this.licht?.setzeDungeonDaempfung(null);
    this.haengeAb();
    for (const name of this.getrennt) {
      this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(name, this.kamera);
    }
    this.getrennt = [];
  }

  /**
   * Setzt die Grafikstufe — Shader UND Nachbearbeitung.
   *
   * Der Aufruf von `setzeDungeonStufe()` gehoert hierher und nicht nur in den
   * Bauer: Wer die Stufe ueber die Atmosphaere umstellt, erwartet, dass sich
   * auch das Material bewegt. Der Bauer haengt seine Geometrie ueber
   * `DungeonBauer.setzeStufe()` daran; beide rufen dieselbe globale Funktion,
   * und die ist gegen Doppelaufrufe abgesichert (sie vergleicht zuerst).
   * Sets the graphics tier — shader AND post processing.
   */
  setzeStufe(stufe: DungeonGrafikStufe): void {
    if (this.stufe === stufe) return;
    this.stufe = stufe;
    setzeDungeonStufe(stufe);
    if (this.abgeraeumt) return;
    this.wendeStufeAn();
  }

  dispose(): void {
    if (this.abgeraeumt) return;
    this.verlasse();
    this.abgeraeumt = true;
    this.pipeline?.dispose();
    this.pipeline = null;
  }

  /** Nur zum Messen: die tatsaechlich gesetzten Werte. / For measuring only. */
  werte(): {
    maxZ: number;
    radius: number;
    proben: number;
    verhaeltnis: number;
    an: boolean;
    ambientLicht: number;
    lichtVerdrahtet: boolean;
  } {
    return {
      maxZ: this.pipeline?.maxZ ?? DUNGEON_SSAO_MAX_Z,
      radius: this.pipeline?.radius ?? DUNGEON_SSAO_RADIUS,
      proben: this.pipeline?.samples ?? 0,
      verhaeltnis: VERHAELTNIS_JE_STUFE[this.stufe],
      an: this.angehaengt,
      ambientLicht: this.ambientLicht,
      // Der Zeuge dafuer, dass `ambientLicht` ueberhaupt irgendwo ankommt.
      // Ohne ihn saehe ein nicht verdrahteter Regler genauso aus wie einer,
      // der auf 1 steht.
      // The witness that `ambientLicht` reaches anything at all.
      lichtVerdrahtet: this.licht !== null,
    };
  }

  // ── innen / internals ─────────────────────────────────────────────────────

  private wendeStufeAn(): void {
    if (this.stufe === DungeonGrafikStufe.Niedrig) {
      this.haengeAb();
      return;
    }
    const proben = PROBEN_JE_STUFE[this.stufe];
    const verhaeltnis = VERHAELTNIS_JE_STUFE[this.stufe];
    // Das Verhaeltnis ist ein KONSTRUKTOR-Wert — es bestimmt die Groesse der
    // Zieltexturen und laesst sich nachtraeglich nicht setzen. Aendert es sich,
    // muss die Pipeline neu gebaut werden; alles andere ist eine Zuweisung.
    // The ratio is a CONSTRUCTOR value: it fixes the render target size and
    // cannot be set afterwards. When it changes the pipeline must be rebuilt.
    if (this.pipeline !== null && this.gebautMit !== verhaeltnis) {
      this.haengeAb();
      this.pipeline.dispose();
      this.pipeline = null;
    }
    if (this.pipeline === null) {
      this.pipeline = new SSAO2RenderingPipeline(
        PIPELINE_NAME,
        this.scene,
        verhaeltnis,
        // Kameras erst unten anhaengen — sonst laeuft die Pipeline schon,
        // bevor `maxZ` und `radius` gesetzt sind, und das erste Bild traegt die
        // Voreinstellungen der Aussenwelt.
        // Attach cameras below only, else the first frame carries the defaults.
        undefined,
        // Beide Werte woertlich wie in `PostProcessing.ts`, und aus denselben
        // zwei Gruenden: `forceGeometryBuffer = true`, weil der Vorgabepfad
        // `scene.enablePrePassRenderer()` ruft, das es bei den granularen
        // Imports dieses Projekts gar nicht gibt; `HALF_FLOAT`, weil die
        // Pipeline die Szenenfarbe durchreicht und 8 Bit das HDR-Bild vor dem
        // Bloom auf LDR klemmten.
        // Both values verbatim as in `PostProcessing.ts`, for the same two
        // reasons: the default path calls `scene.enablePrePassRenderer()`,
        // which does not exist under this project's granular imports; and 8 bit
        // would clamp the HDR image to LDR before the bloom.
        true,
        Constants.TEXTURETYPE_HALF_FLOAT
      );
      this.gebautMit = verhaeltnis;
    }
    this.pipeline.radius = DUNGEON_SSAO_RADIUS;
    this.pipeline.maxZ = DUNGEON_SSAO_MAX_Z;
    this.pipeline.totalStrength = STAERKE;
    this.pipeline.samples = proben;
    this.haengeAn();
  }

  private haengeAn(): void {
    if (this.angehaengt || this.pipeline === null) return;
    this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(
      PIPELINE_NAME,
      this.kamera
    );
    this.angehaengt = true;
  }

  private haengeAb(): void {
    if (!this.angehaengt) return;
    this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
      PIPELINE_NAME,
      this.kamera
    );
    this.angehaengt = false;
  }

  private trenneFremde(): void {
    for (const name of FREMDE_PIPELINES) {
      const pipeline = this.scene.postProcessRenderPipelineManager.supportedPipelines.find(
        (p) => p.name === name
      );
      // `_cameras` ist Babylons interne Liste; ohne sie liesse sich nicht
      // unterscheiden, ob eine Pipeline ueberhaupt an DIESER Kamera hing —
      // und ein Rueckhaengen von etwas, das nie hing, schaltete beim Verlassen
      // die Aussenwelt-Verdeckung ein, obwohl der Spieler sie ausgeschaltet hat.
      // `_cameras` is Babylon's internal list; without it we could not tell
      // whether the pipeline was attached to THIS camera at all — and
      // reattaching something that never hung would switch outdoor occlusion on
      // although the player had it off.
      const kameras = (pipeline as unknown as { _cameras?: Camera[] } | undefined)?._cameras;
      if (pipeline === undefined || kameras === undefined) continue;
      if (!kameras.includes(this.kamera)) continue;
      this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
        name,
        this.kamera
      );
      this.getrennt.push(name);
    }
  }
}
