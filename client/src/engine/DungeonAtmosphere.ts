/**
 * DungeonAtmosphaere — die Bildwirkung im Inneren: dungeon-kalibriertes SSAO
 * und der Grafikstufen-Schalter (AP10, Meilenstein 1).
 * DungeonAtmosphere — the interior look: dungeon calibrated SSAO and the
 * graphics tier switch (AP10, milestone 1).
 *
 * Seit M2 haengen hier auch Parallax, Godrays und SSR — die Stufe ist der EINE
 * Schalter, und jeder Effekt hat daneben seinen eigenen. Godrays und SSR sind
 * eigene Module (`DungeonGodrays.ts`, `DungeonReflections.ts`), weil beide
 * einen Zustand haben, der nichts mit SSAO zu tun hat: der eine sucht sich je
 * Bild seinen Schacht, der andere entscheidet zwischen drei Bauweisen. Diese
 * Klasse besitzt sie und schaltet sie; sie rechnet nicht in ihnen.
 * Since M2 parallax, godrays and SSR hang here too — the tier is the ONE
 * switch, with a per-effect switch beside it. Godrays and SSR are separate
 * modules because each holds state that has nothing to do with SSAO.
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
import {
  DungeonGrafikStufe,
  PARALLAX_SCHRITTE_HOCH,
  dungeonParallaxZustand,
  erlaubeDungeonParallax,
  setzeDungeonStufe,
} from './DungeonMaterial';
import { DungeonGodrays } from './DungeonGodrays';
import { DungeonSpiegelung, DungeonSsrWeg } from './DungeonReflections';
import type { dungeon2 } from '@wov/shared';

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

/**
 * Der SSR-Weg der Stufe Hoch: KEINER. Das Ergebnis der Messreihe von M2
 * (Zahlen im `decisions-log.md`, 31.08.2026) und deshalb EINE Konstante — wer
 * sie aendert, aendert eine Entscheidung, nicht eine Einstellung.
 *
 * Warum nicht: SSR ueber den GeometryBuffer kostete gemessen +52,6 % Bildzeit
 * und veraenderte das Bild um 13 % der Bildpunkte bei mittlerer Abweichung
 * 16,6 — das ist der Flackerunterschied zweier Fackelbilder, nicht eine
 * Spiegelung. Die Ursache ist strukturell und nicht einstellbar: Der
 * GeometryBufferRenderer baut seinen eigenen Effekt, MaterialPlugins laufen
 * darin nicht, und deshalb sieht SSR von unserem Triplanar-Material nur den
 * MATERIALWERT `metallic = 0, roughness = 1`. Die nasse Stelle, auf die es
 * spiegeln soll, entsteht erst im Fragment-Shader.
 * Die Schwelle so weit zu senken, dass etwas sichtbar wird, macht nicht den
 * feuchten Boden spiegelnd, sondern JEDEN trockenen Felsen — das waere genau
 * der Kirmes-Effekt, den das Leitbild ausschliesst.
 * The SSR route of tier High: NONE. Measured +52.6 % frame time for a change of
 * 13 % of the pixels at mean delta 16.6 — the difference between two torch
 * flicker frames, not a reflection. The cause is structural: material plugins
 * do not run in the GBuffer pass, so SSR sees the MATERIAL value, not the wet
 * pixel. Lowering the threshold until something shows would make every DRY rock
 * reflect.
 *
 * Der Weg bleibt gebaut und ueber `?ssr=` waehlbar: Die Entscheidung haengt an
 * einer Eigenschaft von Babylon 8.56, und die naechste Fassung kann sie
 * aendern. Ein geloeschter Weg waere dann eine Messung, die man neu bauen muss.
 * The route stays built and selectable, because the decision hangs off a
 * property of Babylon 8.56 that a later version may change.
 */
export const SSR_WEG_HOCH = DungeonSsrWeg.Aus;

/**
 * Einzelschalter je Effekt. `undefined` heisst „der Stufe folgen" — und das ist
 * NICHT dasselbe wie `false`.
 *
 * Der Unterschied traegt: Die Vorschau soll `?godrays=0` auf Stufe Hoch sagen
 * koennen (Hoch, aber ohne Godrays — die A/B-Messung), und sie soll ohne
 * Angabe genau das bekommen, was die Stufe vorsieht. Mit einem blossen
 * `boolean` waere „nicht angegeben" und „aus" derselbe Wert, und jede Messung
 * auf Hoch liefe ohne Effekte, ohne dass es auffiele.
 * Per-effect switches. `undefined` means "follow the tier" and is NOT the same
 * as `false`: with a plain boolean, "unspecified" and "off" would be the same
 * value and every High-tier measurement would silently run without effects.
 */
export interface DungeonEffektWahl {
  /** Parallax-Schritte; 0 = aus. / Parallax steps; 0 = off. */
  readonly parallax?: number;
  readonly godrays?: boolean;
  readonly ssr?: DungeonSsrWeg;
}

/** Was eine Stufe von sich aus einschaltet. / What a tier switches on itself. */
function stufenWahl(stufe: DungeonGrafikStufe): Required<DungeonEffektWahl> {
  if (stufe < DungeonGrafikStufe.Hoch) {
    // Mittel und Niedrig bleiben BEIM HEUTIGEN UMFANG. Das ist eine Zusage aus
    // dem M2-Auftrag und keine Vorsicht: Wer auf Mittel spielt, hat einen
    // Grund, und ein Vollausbau, der sich dorthin durchdrueckt, nimmt ihm den.
    // Medium and Low stay at today's scope — a promise, not caution.
    return { parallax: 0, godrays: false, ssr: DungeonSsrWeg.Aus };
  }
  return { parallax: PARALLAX_SCHRITTE_HOCH, godrays: true, ssr: SSR_WEG_HOCH };
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
  private readonly godrays: DungeonGodrays;
  private readonly spiegelung: DungeonSpiegelung;

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
    private readonly licht: Grundlicht | null = null,
    /**
     * Die Lichtschacht-Muendungen dieses Dungeons (`dungeon2.lichtschaechte`).
     * Leer heisst: keine Godrays, egal welche Stufe — nicht „Godrays ohne
     * Quelle", das waere dieselbe Passage fuer ein leeres Bild.
     * The shaft mouths of this dungeon. Empty means no godrays at any tier.
     */
    schaechte: readonly dungeon2.Lichtschacht[] = [],
    /** Einzelschalter; leer = der Stufe folgen. / Per-effect overrides. */
    private readonly wahl: DungeonEffektWahl = {}
  ) {
    this.stufe = stufe;
    this.godrays = new DungeonGodrays(scene, kamera, schaechte);
    this.spiegelung = new DungeonSpiegelung(scene, kamera);
  }

  /**
   * Je Bild aufzurufen — nur die Godrays brauchen es (sie suchen sich ihren
   * Schacht). Ein eigener Aufruf und kein `scene.onBeforeRenderObservable`:
   * Ein Beobachter, den diese Klasse selbst anhaengt, muss beim Verlassen
   * wieder ab, und ein vergessener haelt die Kamera und den ganzen Dungeon am
   * Leben. Der Aufrufer hat ohnehin eine Bildschleife (Vorschau wie Spiel).
   * To be called per frame — only the godrays need it. A plain call rather than
   * an observable: one this class attaches must come off again on leaving, and
   * a forgotten one keeps camera and whole dungeon alive.
   */
  aktualisiere(x: number, y: number, z: number): void {
    if (this.abgeraeumt) return;
    this.godrays.aktualisiere(x, y, z);
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
    // Die drei M2-Effekte gehen mit. Parallax ausdruecklich auch: Es ist die
    // einzige GLOBALE Groesse hier (`erlaubeDungeonParallax` gilt fuer alle
    // Dungeon-Materialien der Sitzung) — bliebe sie an, traege der naechste
    // Dungeon auf Mittel den Parallax-Shader des vorigen.
    // The three M2 effects go too. Parallax explicitly as well: it is the only
    // GLOBAL quantity here, and left on, the next dungeon at tier Medium would
    // carry the previous one's parallax shader.
    erlaubeDungeonParallax(false);
    this.godrays.setzeAn(false);
    this.spiegelung.setzeWeg(DungeonSsrWeg.Aus);
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
    this.godrays.dispose();
    this.spiegelung.dispose();
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
    stufe: number;
    parallax: { erlaubt: boolean; schritte: number };
    godrays: ReturnType<DungeonGodrays['werte']>;
    ssr: ReturnType<DungeonSpiegelung['werte']>;
  } {
    return {
      stufe: this.stufe,
      parallax: dungeonParallaxZustand(),
      godrays: this.godrays.werte(),
      ssr: this.spiegelung.werte(),
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

  /**
   * Parallax, Godrays und SSR an die Stufe (und die Einzelschalter) anpassen.
   *
   * Steht VOR dem SSAO-Teil in `wendeStufeAn()` und nicht darin: Auf Niedrig
   * verlaesst die SSAO-Logik die Methode frueh (`return`), und die drei
   * Effekte muessen auch dort abgeschaltet werden — sonst waere ein Wechsel von
   * Hoch auf Niedrig genau der Fall, in dem die teuersten Effekte
   * weiterlaufen.
   * Applied BEFORE the SSAO part, because on Low the SSAO logic returns early
   * and the three effects must be switched off there too — otherwise High to
   * Low would be exactly the case where the most expensive effects keep going.
   */
  private wendeEffekteAn(): void {
    const vorgabe = stufenWahl(this.stufe);
    const parallax = this.wahl.parallax ?? vorgabe.parallax;
    const godrays = this.wahl.godrays ?? vorgabe.godrays;
    const ssr = this.wahl.ssr ?? vorgabe.ssr;
    erlaubeDungeonParallax(parallax > 0, parallax > 0 ? parallax : PARALLAX_SCHRITTE_HOCH);
    this.godrays.setzeAn(godrays);
    this.spiegelung.setzeWeg(ssr);
  }

  private wendeStufeAn(): void {
    this.wendeEffekteAn();
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
