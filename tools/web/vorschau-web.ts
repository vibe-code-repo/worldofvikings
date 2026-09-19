/**
 * Die Figurenvorschau fuer die Charaktererstellung auf
 * world-of-vikings.com — als eigenstaendiges Buendel mit Babylon darin.
 *
 * WARUM EIN BUENDEL: Die Webseite besteht aus statischen Dateien und
 * kennt keinen Build-Schritt. Babylon aus dem Spiel-Repo hier
 * hineinzubuendeln ist der einzige Weg, ohne der Seite eine
 * Werkzeugkette aufzuzwingen — und ohne ein CDN, das dem
 * Selbsthosten-Prinzip der Seite widerspraeche (Schriften und Symbole
 * liegen dort ebenfalls auf eigenem Grund).
 *
 * Gebaut mit tools/vorschau-buendeln.mjs, ausgeliefert nach
 * /assets/js/vorschau.js auf wov-web. Wer hier etwas aendert, muss neu
 * buendeln — die Datei auf der Webseite ist ERZEUGT.
 *
 * ── Warum die Teile einzeln geladen werden ──────────────────────────
 * Die 38 Frisuren, 18 Bärte und 17 Augenbrauenformen werden einzeln
 * nachgeladen. Wer die Auswahl öffnet, soll nicht auf 72 Teile warten,
 * die er nicht trägt.
 *
 * Das funktioniert nur, weil jede Teildatei DIESELBE Gelenkliste traegt
 * wie der Koerper — 63 Knochen, Index fuer Index. Erzeugt werden sie von
 * tools/web/charakterteile-exportieren.py aus derselben Blender-Datei.
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
/*
  Nebenwirkungs-Import. Babylons Baumschnitt-freundliche Module tragen ihre
  Szenenkomponenten getrennt: Ohne diese Zeile wirft der ShadowGenerator zur
  Laufzeit "needs to be imported before as it contains a side-effect
  required by your code" — und zwar erst im Browser, nicht beim Buendeln.
*/
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { DynamicTexture as Fleck } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Animation } from '@babylonjs/core/Animations/animation';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import '@babylonjs/loaders/glTF';
import { faerbeAugen } from '../../client/src/player/augenfarbe.js';
import { armorByFile, hiddenAppearanceForFiles } from '../../shared/src/aussehen.js';
import { APPEARANCE_ATTACHMENTS } from '../../shared/src/appearanceVisibility.js';
import { updateArmorVisibility, verifyArmorSkin, prepareLegacyFemaleBody } from '../../client/src/player/armorVisibility.js';
import { stabilizeHeadSkin } from '../../client/src/player/headSkin.js';
import { canWearArmor } from '@wov/shared';

interface Teil {
  netze: AbstractMesh[];
  wurzeln: TransformNode[];
  skelette: Skeleton[];
}

interface WaffenSchicht {
  kanaele: Array<{ knoten: TransformNode; animation: Animation }>;
  von: number;
  bis: number;
  bilderJeSekunde: number;
}

type Waffenart = 'schwert' | 'stab';

/**
 * Was die Seite vom Kopf-Zoom wissen muss: ob die Kamera im Portraet steht
 * (oder dorthin faehrt) und ob der Mauszeiger ueber dem Kopf ist.
 */
export interface KopfZustand {
  nah: boolean;
  ueber: boolean;
}

/*
  Kamerawerte in METERN. Eine Wahrheit ist der Radius der Kamera: Rad, Kopf-
  Klick und Knopf aendern nur ihn, der Blickpunkt (blickpunktNachfuehren) und
  der Video-Massstab (videoMassstabSetzen) leiten sich daraus ab.

  Nachgemessen am 19.09.2026 an beiden Koerpern in der Ruhepose (Kopfnetz,
  bei 1,0 m Abstand gerendert): Scheitel 1,80 m, Kinn 1,46 m (die
  Silhouette verjuengt sich dort auf Halsbreite), Kopfmitte 1,63 m bei
  beiden Koerpern, Kopfknochen "Head" bei beiden auf
  1,556 m. Die Koerper weichen weniger als 1 cm voneinander und 1 cm von
  KOPF_Y ab; die Konstante bleibt darum stehen.
*/
const AUSGANG_RADIUS = 3.2;
/** Ab hier (und naeher) steht der Blickpunkt auf dem Kopf. */
const NAH_ENDE = 2.2;
/** Senkrechtes Sichtfeld im Ausgangsbild und bis 2,2 m (Babylons Vorgabe). */
const FOV_AUSGANG = 0.8;
/**
 * Portraet: Der Kopf (Kinn bis Scheitel, 0,34 m) soll gut 40 % der
 * Leinwandhoehe fuellen, das Bild also 0,80 m hoch sein (gemessen am
 * gerenderten Kopf: 38 bis 40 %). Mit dem Sichtfeld des Ausgangsbildes
 * (0,8 rad) hiesse das Radius 0,95 m — und dort schneidet die Nahebene die
 * Kristallfluegel der Seidraven-Ruestung an (gemessen bei 1,0 m: kleinster
 * Abstand 0,035 m bei minZ 0,05 m; die Fluegel stehen rund 1 m seitlich der
 * Achse). Darum sinkt das Sichtfeld unterhalb von 2,2 m (sichtfeldNachfuehren)
 * auf ein Teleobjektiv: dieselben 0,80 m Bildhoehe aus 1,4 m Abstand
 * (0,80 / (2 * 1,4) = tan 0,278, also 0,557 rad). Gleicher Kopfanteil, aber
 * alles rund 0,45 m weiter von der Kamera weg.
 * Naeher ist nicht vorgesehen; das Rad haelt hier an.
 */
const PORTRAET_RADIUS = 1.4;
const PORTRAET_BILDHOEHE = 0.8;
const BRUST_Y = 1.05;
const KOPF_Y = 1.62;
/** Treffer- und Markierungsradius um die Kopfmitte, mit Zugabe fuer Frisur und Helm. */
const KOPF_RADIUS = 0.21;
/** Weg in Bildpunkten, bis aus einem Klick ein Ziehen wird. */
const KLICK_WEG = 6;
const FAHRT_MS = 450;

export class Vorschau {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly kamera: ArcRotateCamera;
  private skelett: Skeleton | null = null;
  private ruhe: AnimationGroup | null = null;
  private readonly geladen = new Map<string, Teil>();
  private readonly aktuell = new Map<string, string>();
  /** sRGB-Hex der Haarfarbe; leer = Farbe des Modells stehen lassen. */
  private haarHex = '';
  private augenfarbe = '';
  private zerstoert = false;
  private beobachter: ResizeObserver | null = null;
  private sonne!: DirectionalLight;
  /** Nur die beiden spielbaren Körper können modulare Aussehensteile tragen. */
  private teileErlaubt = true;
  /** Für H_01 braucht der neue Wikinger einen eigenen, noch fehlenden Export. */
  private neuerWikinger = false;
  /** Verhindert, dass Reset und Zufall denselben Körper mehrfach importieren. */
  private koerperDatei = '';
  /** Nur der zuletzt angeforderte Körper darf nach dem asynchronen Import sichtbar werden. */
  private koerperLauf = 0;
  /** Macht noch laufende Teile-Importe beim Körperwechsel eindeutig ungültig. */
  private teileEpoche = 0;
  /** Pro Auswahlfeld gewinnt der jüngste Import, auch wenn ein älterer später fertig wird. */
  private readonly teileLaeufe = new Map<string, number>();
  private koerperWurzeln: TransformNode[] = [];
  /** Sichtbare Segmentnetze des Körpers, für vollständige Rüstungsersatzteile. */
  private koerperNetze: AbstractMesh[] = [];
  private koerperGruppen: AnimationGroup[] = [];
  /** Klassenwaffen samt Arm- und Greifpose, jeweils nur bei ihrer Klasse. */
  private waffenHalter = new Map<Waffenart, TransformNode>();
  private waffenLaden = new Map<Waffenart, Promise<void>>();
  private waffeAktiv: Waffenart | null = null;
  private waffenZeit = 0;
  private waffenSchichten = new Map<Waffenart, WaffenSchicht[]>();
  /** Laufende Radiusfahrt (Kopf-Zoom); null, solange die Kamera steht. */
  private radiusFahrt: { von: number; nach: number; start: number } | null = null;
  /** Der Kopfknochen des Koerpers; seine Lage folgt der Ruhepose. */
  private kopfKnoten: TransformNode | null = null;
  private readonly kopfWelt = new Vector3();
  private readonly kopfMatrix = new Matrix();
  /** Zuletzt gesetzte Zeigerform der Leinwand; '' = Stil der Seite. */
  private zeigerForm = '';
  /** Letzte Mausposition ueber der Leinwand (Client-Koordinaten); null bei Touch oder ausserhalb. */
  private zeigerPos: { x: number; y: number } | null = null;
  private zeigerGedrueckt = false;
  /** Haengt die Zeigerbehandlung der Leinwand in dispose() wieder ab. */
  private readonly zeigerAbbruch = new AbortController();
  /** Abstand der Leinwand von ihrem Elternelement, dem Bezug der Markierung. */
  private leinwandVersatz = { x: 0, y: 0 };
  private kopfMarke = { x: NaN, y: NaN, r: NaN };
  private kopfZustandLetzter: KopfZustand = { nah: false, ueber: false };
  /**
   * Rueckruf fuer die Seite; kommt nur bei einer Aenderung und nie nach
   * dispose().
   */
  beiKopfZustand: ((zustand: KopfZustand) => void) | null = null;
  /*
    Ein Knoten fuer alles, was zur Figur gehoert.

    Der erste Versuch streckte den glTF-Wurzelknoten des Koerpers direkt.
    Zwei Dinge gingen dabei schief: Seine Skalierung war NaN (gemessen), und
    Frisur und Ruestung kommen aus EIGENEN Dateien mit eigenen Wurzeln — die
    waeren ungestreckt geblieben und haetten neben einer 1,80-m-Figur in
    1,00 m Groesse gestanden.

    Deshalb ein gemeinsamer Elternknoten: Er traegt den Faktor, alle Teile
    haengen darunter, und die Haendigkeitsmatrix der einzelnen Dateien
    bleibt unangetastet.
  */
  private figurKnoten!: TransformNode;

  /*
    Die Szene rechnet in METERN, wie das Spiel. Die Figur misst im Modell
    1,00 Einheit (nachgemessen mit tools/glb-bbox.js), ein Mensch 1,80 m.

    ACHTUNG, diese Zeile ist schon einmal verlorengegangen — und der Fehler
    war nicht zu sehen, sondern nur zu messen: Ohne sie ist
    `Vorschau.FIGURHOEHE` undefined, `scaling.setAll(undefined)` setzt x, y
    und z auf undefined, die Bounding-Box wird -Infinity und die Figur
    verschwindet spurlos. Keine Ausnahme, keine Konsolenmeldung. esbuild
    prueft keine Typen — es buendelt nur.
  */
  private static readonly FIGURHOEHE = 1.8;

  /** @param wurzel z. B. "https://play.dev.world-of-vikings.com/assets/models/" */
  constructor(private readonly leinwand: HTMLCanvasElement,
              private wurzel: string) {
    /*
      `alpha: true` — die Leinwand ist DURCHSICHTIG.

      Der Hintergrund ist seit dem 23.08.2026 kein 3D-Aufbau mehr, sondern
      ein <video> HINTER der Leinwand im HTML. Das ist der billigste Weg,
      den es gibt: Das Video geht nie durch WebGL, es wird vom Browser
      dekodiert und von der Grafikkarte direkt zusammengesetzt. Kein
      Texturupload je Frame, keine Weltgenerierung, keine 10.000 Instanzen.
    */
    this.engine = new Engine(leinwand, true, { alpha: true, premultipliedAlpha: false }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    // Babylons Eingabeverwaltung setzt bei jeder Mausbewegung
    // `canvas.style.cursor` zurueck. Die Zeigerform gehoert hier aber der
    // Vorschau (Kopf: zoom-in/zoom-out) und dem Stil der Seite (grab).
    this.scene.doNotHandleCursors = true;

    // Die Figur ist 1,0 hoch mit den Fuessen im Ursprung — der Kopf sitzt
    // also bei rund 0,95. Der Blick geht auf Kopf und Oberkoerper.
    /*
      Alle Werte in METERN, seit die Szene die echte Welt zeigt. Die Figur
      ist 1,80 m: Brust bei 1,05, Scheitel bei 1,80, Kopfmitte bei 1,62.

      Ausgangsabstand 3,2 m: Die Figur ist damit etwas praesentierter als
      zuvor bei 3,6 m, bleibt aber samt Schwert und Fuessen voll im Bild.
      Bis 5,5 m laesst sich herausziehen, bis 1,0 m (Portraet) heran.
    */
    this.kamera = new ArcRotateCamera(
      'vorschau', Math.PI / 2, Math.PI / 2.12, AUSGANG_RADIUS,
      new Vector3(0, BRUST_Y, 0), this.scene);
    /*
      NAHE SCHNITTEBENE. Babylons Vorgabe ist minZ = 1 — gedacht fuer eine
      Spielwelt, in der eine Einheit ein Meter ist und die Kamera Dutzende
      Meter weit weg steht. Hier ist die ganze Figur 1,0 Einheiten hoch.

      Was das anrichtete (gemessen am 23.08.2026 auf der Live-Seite): Alles
      naeher als eine Einheit an der Kamera wurde weggeschnitten. Bei
      Radius 1,9 fehlte damit bereits die Vorderseite — Brust, Nase, Haar
      —, und ganz hineingezoomt (Radius 0,7) lag die Figur KOMPLETT hinter
      der Schnittebene: eine leere schwarze Buehne, ohne Fehlermeldung.

      Das sah aus wie ein Zoom-Problem und war keines. Die Radiusgrenzen
      unten waren immer richtig; sie konnten nur nichts ausrichten, weil
      die Kamera schnitt, lange bevor sie zu nah war.

      0,02 statt 1: knapp unter der kleinsten Naehe, die die Radiusgrenze
      zulaesst (0,7 minus Kopfradius). Kleiner muss es nicht sein — eine
      unnoetig nahe Schnittebene kostet Tiefenpuffer-Genauigkeit und laesst
      Flaechen flackern, die dicht beieinander liegen.
    */
    this.kamera.minZ = 0.05;
    this.kamera.maxZ = 220;
    this.kamera.fov = FOV_AUSGANG;

    /*
      Wie nah man heran darf: bis zum Portraet, 1,4 m.

      Die Vorschau rechnet in Metern (Figur 1,80 m). Der Blickpunkt wandert
      beim Hineinzoomen von der Brust auf die Kopfmitte (blickpunktNachfuehren)
      und bleibt von 2,2 m an dort; das Sichtfeld verengt sich unterhalb von
      2,2 m (sichtfeldNachfuehren). Bei 1,4 m fuellt der Kopf 40 % der
      Leinwandhoehe (siehe PORTRAET_RADIUS).

      Am 23.08.2026 stand die Grenze schon einmal bei 1,0 — damals in
      Modelleinheiten, wo es die Kamera in den Kopf setzte. Hier misst
      tools/test/vorschau-kopf.mjs bei jeder Drehung der Figur den Abstand
      zwischen Kamera und Dreiecken (Frisuren, Helme, Ruestungen, Waffen).
    */
    this.kamera.lowerRadiusLimit = PORTRAET_RADIUS;
    // Enger als frueher: Der Hintergrund ist ein Bild, und je weiter man
    // herauszieht, desto deutlicher verraet sich der fehlende Parallaxe-Effekt.
    this.kamera.upperRadiusLimit = 5.5;
    this.kamera.lowerBetaLimit = 0.5;
    this.kamera.upperBetaLimit = Math.PI / 1.85;
    this.kamera.wheelDeltaPercentage = 0.02;

    /*
      Kein Verschieben des Blickpunkts von Hand.

      ArcRotateCamera erlaubt es sonst per rechter Maustaste, und zwei
      Gruende sprechen dagegen: Erstens koennte man die Figur aus dem Bild
      schieben, ohne zu wissen, wie man sie zurueckholt. Zweitens fuehrt
      der Blickpunkt hier seit dieser Fassung dem Zoom nach (siehe
      blickpunktNachfuehren) — ein Verschieben von Hand wuerde jeden Frame
      wieder ueberschrieben und liesse die Steuerung kaputt wirken.
      Gedreht und gezoomt wird weiter; dafuer gibt es auch die vier Knoepfe.
    */
    /*
      KEIN attachControl.

      Vor dem Videohintergrund kreiste die Kamera um die Figur. Das geht
      jetzt nicht mehr: Ein Video hat einen FESTEN Blickwinkel, und eine
      wandernde Kamera vor einem stehenden Bild sieht sofort nach
      Pappkulisse aus. Stattdessen dreht sich die FIGUR — so machen es die
      meisten Charaktererstellungen, und fuer "welche Frisur nehme ich" ist
      es ohnehin die richtige Bewegung.

      Ziehen und Rad haengen deshalb in zeigerAnschliessen().
    */
    this.zeigerAnschliessen(leinwand);

    this.figurKnoten = new TransformNode('figur', this.scene);
    // Der Skalierungsfaktor folgt nach dem Laden aus den echten Modellmaßen.
    // Die alte Wikingerin ist 1,0 Modelleinheit hoch, der neue Wikinger
    // bereits 1,79. Ein fester Faktor von 1,8 machte ihn sonst 3,2 m groß.
    this.figurKnoten.scaling.setAll(1);

    this.scene.onBeforeRenderObservable.add(() => {
      this.radiusFahrtWeiter();
      this.blickpunktNachfuehren();
      this.sichtfeldNachfuehren();
      this.kopfNachfuehren();
    });
    // Babylon mischt gleichzeitig laufende Gruppen. Die Waffenpose soll
    // Idle dagegen gezielt am rechten Arm und an den Fingern UEBERSCHREIBEN.
    // Darum wird sie nach Babylons Animationsdurchlauf von Hand aufgetragen.
    this.scene.onAfterAnimationsObservable.add(() => this.wendeWaffenPoseAn());
    this.umgebungslichtSetzen();

    /*
      Licht muss zur AUFNAHME passen, nicht zu einer erdachten Szene.

      Die Werte lehnen sich an "DeepForest Mist" an (envData.json): kuehles
      Umgebungslicht von oben, eine schraege warme Sonne. Wenn die spaetere
      Videoaufnahme aus einer anderen Tageszeit stammt, gehoeren sie
      nachgezogen — sonst klebt die Figur vor dem Wald, statt darin zu
      stehen. Das ist der einzige heikle Punkt an einem Videohintergrund.
    */
    const himmelslicht = new HemisphericLight('himmel', new Vector3(0, 1, 0), this.scene);
    himmelslicht.intensity = 0.62;
    himmelslicht.diffuse = new Color3(0.72, 0.78, 0.84);
    himmelslicht.groundColor = new Color3(0.14, 0.14, 0.11);
    this.sonne = new DirectionalLight('sonne', new Vector3(-0.4, -0.85, 0.45), this.scene);
    this.sonne.intensity = 1.5;
    this.sonne.diffuse = new Color3(1.0, 0.94, 0.84);

    this.fleckschattenLegen();

    this.engine.runRenderLoop(() => {
      if (!this.zerstoert) this.scene.render();
    });
    window.addEventListener('resize', this.beiGroesse);

    // Babylon nimmt die Leinwandgroesse bei der Erzeugung. Steht das
    // Layout da noch nicht (Schriften laden, Raster rechnet), ist sie
    // 0x0 — die Szene rendert dann in ein leeres Ziel, und man sieht
    // nichts, ohne dass irgendwo ein Fehler auftaucht. Ein
    // ResizeObserver auf der Leinwand faengt jede spaetere Aenderung ab,
    // das window-resize-Ereignis allein tut das nicht.
    this.engine.resize();
    this.leinwandVersatzMessen();
    if (typeof ResizeObserver !== 'undefined') {
      this.beobachter = new ResizeObserver(() => {
        this.engine.resize();
        this.leinwandVersatzMessen();
      });
      this.beobachter.observe(leinwand);
      if (leinwand.parentElement) this.beobachter.observe(leinwand.parentElement);
    }
  }

  private beiGroesse = () => {
    this.engine.resize();
    this.leinwandVersatzMessen();
  };

  /** Server wechseln: alles Geladene verwerfen, sonst mischen sich Staende. */
  async setzeWurzel(wurzel: string): Promise<void> {
    if (wurzel === this.wurzel) return;
    this.wurzel = wurzel;
    this.koerperLauf += 1;
    this.teileEpoche += 1;
    this.teileLaeufe.clear();
    for (const teil of this.geladen.values()) {
      for (const wurzel of teil.wurzeln) wurzel.dispose(false, true);
      for (const skelett of teil.skelette) skelett.dispose();
    }
    this.geladen.clear();
    this.aktuell.clear();
    for (const s of [...this.scene.skeletons]) s.dispose();
    for (const g of [...this.scene.animationGroups]) g.dispose();
    for (const m of [...this.scene.meshes]) m.dispose();
    this.skelett = null;
    this.ruhe = null;
    for (const halter of this.waffenHalter.values()) halter.dispose(false, true);
    this.waffenHalter.clear();
    this.waffenLaden.clear();
    this.waffenSchichten.clear();
    this.koerperWurzeln = [];
    this.koerperNetze = [];
    this.koerperGruppen = [];
    this.koerperDatei = '';
    this.kopfZoomZuruecksetzen();
  }

  async ladeKoerper(datei: string): Promise<boolean> {
    if (datei === this.koerperDatei) return true;

    const lauf = ++this.koerperLauf;
    this.teileEpoche += 1;
    this.teileLaeufe.clear();

    // Beim Wechsel zwischen Wikinger und Wikingerin müssen Körper,
    // Animationen und die auf dessen Skelett gezogenen Module gemeinsam
    // verschwinden. Ein blosses zweites Importieren stellte beide Körper
    // ineinander und liess Haare am alten Skelett weiterlaufen.
    for (const halter of this.waffenHalter.values()) halter.dispose(false, true);
    this.waffenHalter.clear();
    this.waffenLaden.clear();
    for (const teil of this.geladen.values()) {
      for (const wurzel of teil.wurzeln) wurzel.dispose(false, true);
      for (const skelett of teil.skelette) skelett.dispose();
    }
    this.geladen.clear();
    this.aktuell.clear();
    for (const gruppe of this.koerperGruppen) gruppe.dispose();
    for (const wurzel of this.koerperWurzeln) wurzel.dispose(false, true);
    this.skelett?.dispose();
    this.skelett = null;
    this.koerperWurzeln = [];
    this.koerperNetze = [];
    this.koerperGruppen = [];
    this.koerperDatei = '';
    // Ein neuer Koerper steht wieder im Ausgangsbild: Porträt, Fahrt und
    // Markierung des alten gelten nicht mehr.
    this.kopfZoomZuruecksetzen();

    const res = await SceneLoader.ImportMeshAsync('', this.wurzel, datei + '.glb', this.scene);

    // Ein langsamer alter Import darf eine inzwischen neu gewählte Figur
    // nicht wieder über die Bühne legen. Genau dadurch blieben zuvor der
    // alte Körper und dessen Haare sichtbar, obwohl die Auswahl bereits
    // „Wikingerin“ zeigte.
    if (lauf !== this.koerperLauf || this.zerstoert) {
      for (const gruppe of res.animationGroups) gruppe.dispose();
      for (const wurzel of res.meshes.filter((m) => !m.parent)) wurzel.dispose(false, true);
      for (const skelett of res.skeletons) skelett.dispose();
      return false;
    }

    this.koerperDatei = datei;
    if (res.skeletons[0]?.bones.some(bone => bone.name === 'L_Thigh')) {
      prepareLegacyFemaleBody(res.meshes, datei);
    }
    this.teileErlaubt = /^(wikinger\/WikingerKoerper|wikingerin\/WikingerinKoerper)$/.test(datei);
    this.neuerWikinger = datei === 'wikinger/WikingerKoerper';

    // Der Synty-Atlas ist für einen nahezu unbeleuchteten Unity-Shader
    // gemalt. Das Spiel tönt ihn deshalb auf dieselben gemessenen Werte;
    // die Webseite muss dieselbe Figur und nicht eine ausgewaschene Kopie
    // davon zeigen. Jedes Material nur einmal setzen, weil Meshes teilen.
    if (this.teileErlaubt) {
      const gesehen = new Set();
      for (const mesh of res.meshes) {
        const material = mesh.material;
        if (!material || gesehen.has(material)) continue;
        gesehen.add(material);
        if (material instanceof PBRMaterial) {
          material.albedoColor.set(0.7305, 0.4904, 0.4179);
        }
      }
    }

    // Beide spielbaren Körper haben andere Exportmaße. Aus der Bindepose
    // messen, auf 1,80 m bringen und den tiefsten Punkt auf den Boden setzen.
    let unten = Infinity;
    let oben = -Infinity;
    for (const mesh of res.meshes) {
      if (mesh.getTotalVertices() === 0) continue;
      mesh.computeWorldMatrix(true);
      const kasten = mesh.getBoundingInfo().boundingBox;
      unten = Math.min(unten, kasten.minimumWorld.y);
      oben = Math.max(oben, kasten.maximumWorld.y);
    }
    const hoehe = oben - unten;
    const faktor = Number.isFinite(hoehe) && hoehe > 0.01
      ? Vorschau.FIGURHOEHE / hoehe
      : Vorschau.FIGURHOEHE;
    this.figurKnoten.scaling.setAll(faktor);
    this.figurKnoten.position.y = Number.isFinite(unten) ? -unten * faktor : 0;

    // Alle Wurzelnetze unter den gemeinsamen, soeben vermessenen
    // Figurenknoten hängen. Damit drehen Körper und kompatible Anbauteile
    // gemeinsam, ohne die Händigkeit der glTF-Wurzel selbst anzufassen.
    this.koerperWurzeln = res.meshes.filter((m) => !m.parent);
    this.koerperNetze = res.meshes.filter((m) => m.getTotalVertices() > 0);
    stabilizeHeadSkin(this.koerperNetze);
    if (this.augenfarbe) faerbeAugen(this.koerperNetze, this.augenfarbe);
    for (const teil of this.koerperWurzeln) teil.parent = this.figurKnoten;
    this.koerperGruppen = res.animationGroups;
    this.skelett = res.skeletons[0] ?? null;
    this.kopfKnoten = res.transformNodes.find((knoten) => knoten.name === 'Head') ?? null;
    for (const g of res.animationGroups) g.stop();
    // Ueber den Namen, nicht "der erste Clip": Die Reihenfolge im glTF ist
    // alphabetisch und begaenne bei "angriff".
    this.ruhe = res.animationGroups.find((g) => /idle|ruhe|stand/i.test(g.name))
      ?? res.animationGroups[0] ?? null;
    this.ruhe?.start(true);
    this.bereiteWaffenPoseVor(res.animationGroups);

    /*
      Der Hain kommt NACH der Figur und ohne await: Er ist Kulisse, und
      niemand soll auf seine Eiche warten, um die eigene Frisur zu sehen.
      Faellt er ganz aus, steht die Figur trotzdem — vor Himmel und Boden,
      die beide nichts kosten.
    */
    return true;
  }

  /**
   * Zeigt das Nordschwert beim Krieger und den Holzstab beim Druiden. Beide
   * werden an den echten Handknochen gehängt und nur bei Bedarf geladen.
   */
  async setzeWaffe(art: Waffenart | null): Promise<void> {
    this.waffeAktiv = art;
    this.waffenZeit = 0;
    for (const [vorhanden, halter] of this.waffenHalter) {
      halter.setEnabled(vorhanden === art);
    }
    if (!art || this.waffenHalter.has(art)) return;

    if (!this.waffenLaden.has(art)) {
      const laden = art === 'schwert' ? this.ladeNordschwert() : this.ladeDruidenstab();
      this.waffenLaden.set(art, laden);
    }
    await this.waffenLaden.get(art);
    this.waffenHalter.get(art)?.setEnabled(this.waffeAktiv === art);
  }

  private async ladeNordschwert(): Promise<void> {
    const hand = this.scene.getTransformNodeByName('Hand_R');
    if (!hand) throw new Error('Hand_R für das Nordschwert nicht gefunden');

    const res = await SceneLoader.ImportMeshAsync(
      '', this.wurzel, 'wikinger/SwordNorth.glb', this.scene,
    );
    const halter = new TransformNode('krieger-schwert', this.scene);
    halter.position.set(0.08, 0.08, 0.035);
    halter.rotation.set(0, Math.PI, Math.PI / 2);
    // Der Körper wird auf 1,80 m normiert, das Schwert liegt bereits in
    // Metern vor und darf diese Skalierung nicht noch einmal erben.
    halter.scaling.setAll(1 / this.figurKnoten.scaling.x);
    halter.parent = hand;

    const modell = new TransformNode('krieger-schwert-modell', this.scene);
    modell.parent = halter;
    for (const knoten of [...res.meshes, ...res.transformNodes]) {
      if (!knoten.parent) knoten.parent = modell;
    }
    this.waffenHalter.set('schwert', halter);
    halter.setEnabled(this.waffeAktiv === 'schwert');
  }

  private async ladeDruidenstab(): Promise<void> {
    const hand = this.scene.getTransformNodeByName('Hand_R');
    if (!hand) throw new Error('Hand_R für den Druidenstab nicht gefunden');

    const res = await SceneLoader.ImportMeshAsync(
      '', this.wurzel, 'wikinger/DruidStaff.glb', this.scene,
    );
    const halter = new TransformNode('druide-stab', this.scene);
    // SpearIdle dreht die Hand so, dass deren lokale Z-Achse quer über
    // den Bildschirm läuft. Der Stabmittelpunkt sitzt bei 7,4 cm im
    // geschlossenen Fingerring; der Schwertwert 3,5 cm lag daneben.
    halter.position.set(0.08, 0.08, 0.074);
    // Der Stab zeigt im Asset entlang +Y. In der Speer-Ruhepose zeigt die
    // lokale +X-Achse der rechten Hand senkrecht nach oben; Z -90° legt die
    // Stabachse genau darauf.
    halter.rotation.set(0, 0, -Math.PI / 2);
    halter.scaling.setAll(1 / this.figurKnoten.scaling.x);
    halter.parent = hand;

    const modell = new TransformNode('druide-stab-modell', this.scene);
    // Das Spielmodell ist ein schlanker Wanderstab. Seine Laenge bleibt
    // 1,62 m; nur die beiden Querachsen werden auf rund ein Drittel der
    // bisherigen Staerke gebracht. Gleichmaessiges Skalieren hatte aus dem
    // 3-cm-Schaft in der Vorschau einen fast unterarmdicken Pfosten gemacht.
    modell.scaling.set(0.55, 1.65, 0.55);
    // Die Hand sitzt rund 1,06 m über dem Boden. Dieser Versatz legt das
    // Metallende auf den Boden und lässt die verzierte Spitze nach oben.
    // Kein seitlicher Modellversatz: Die Griffachse laeuft durch den von
    // SpearIdle geschlossenen Fingerring. Der alte Z-Versatz von -8 cm
    // stellte den Stab sichtbar neben die Faust.
    modell.position.set(0, -1.06, 0);
    modell.parent = halter;
    for (const knoten of [...res.meshes, ...res.transformNodes]) {
      if (!knoten.parent) knoten.parent = modell;
    }
    this.waffenHalter.set('stab', halter);
    halter.setEnabled(this.waffeAktiv === 'stab');
  }

  private bereiteWaffenPoseVor(gruppen: AnimationGroup[]): void {
    const hand = this.scene.getTransformNodeByName('Hand_R');
    const finger = new Set(hand?.getDescendants(false).map((knoten) => knoten.name) ?? []);
    const arm = new Set(['Clavicle_R', 'Shoulder_R', 'Elbow_R', 'Hand_R']);
    this.waffenSchichten.clear();

    for (const gruppe of gruppen.filter((g) => /^(arm|hand)_(schwert|speer)$/i.test(g.name))) {
      const speer = /_speer$/i.test(gruppe.name);
      const art: Waffenart = speer ? 'stab' : 'schwert';
      const maske = /^arm_/i.test(gruppe.name) ? arm : finger;
      const kanaele: WaffenSchicht['kanaele'] = [];
      let bilderJeSekunde = 60;
      for (const spur of gruppe.targetedAnimations) {
        const knoten = spur.target as TransformNode;
        if (spur.animation.targetProperty !== 'rotationQuaternion' || !maske.has(knoten.name)) continue;
        kanaele.push({ knoten, animation: spur.animation });
        bilderJeSekunde = spur.animation.framePerSecond;
      }
      if (kanaele.length) {
        const schichten = this.waffenSchichten.get(art) ?? [];
        schichten.push({
          kanaele,
          von: gruppe.from,
          bis: gruppe.to,
          bilderJeSekunde,
        });
        this.waffenSchichten.set(art, schichten);
      }
      gruppe.stop();
    }
  }

  private wendeWaffenPoseAn(): void {
    if (!this.waffeAktiv) return;
    const schichten = this.waffenSchichten.get(this.waffeAktiv) ?? [];
    if (!schichten.length) return;
    this.waffenZeit += this.engine.getDeltaTime() / 1000;
    for (const schicht of schichten) {
      const spanne = schicht.bis - schicht.von;
      const bild = spanne > 0
        ? schicht.von + ((this.waffenZeit * schicht.bilderJeSekunde) % spanne)
        : schicht.von;
      for (const kanal of schicht.kanaele) {
        const drehung = kanal.animation.evaluate(bild) as Quaternion;
        if (!kanal.knoten.rotationQuaternion) kanal.knoten.rotationQuaternion = drehung.clone();
        else kanal.knoten.rotationQuaternion.copyFrom(drehung);
      }
    }
  }

  async setze(slot: string, datei: string | null): Promise<void> {
    if (!this.teileErlaubt) return;
    const armor = datei ? armorByFile(datei.replace(/^armor\//, '')) : undefined;
    if (armor && !canWearArmor(armor, this.koerperDatei)) datei = null;
    // Nur H_01 ist das alte, hinter dem neuen Kopf schwebende Haarteil. Die
    // übrigen 37 Frisuren sind dort ausdrücklich weiter zugelassen.
    if (slot === 'frisur' && this.neuerWikinger && /(?:^|\/)H_01$/.test(datei ?? '')) datei = null;
    const ziel = datei ?? '';
    if (this.aktuell.get(slot) === ziel && (!datei || this.geladen.has(datei))) return;
    const epoche = this.teileEpoche;
    const lauf = (this.teileLaeufe.get(slot) ?? 0) + 1;
    this.teileLaeufe.set(slot, lauf);
    const vorher = this.aktuell.get(slot);
    if (vorher) this.zeige(vorher, false);
    this.aktuell.set(slot, ziel);
    this.refreshVisibility();
    if (!datei) return;

    if (!this.geladen.has(datei)) {
      const res = await SceneLoader.ImportMeshAsync('', this.wurzel, datei + '.glb', this.scene);
      // Unter denselben Knoten wie der Koerper — sonst stuende die Frisur
      // in 1,00 m Groesse neben einer 1,80 m grossen Figur.
      for (const teil of res.meshes.filter((m) => !m.parent)) teil.parent = this.figurKnoten;
      const netze = res.meshes.filter((m) => m.getTotalVertices() > 0);
      try { verifyArmorSkin(this.skelett, res.skeletons[0] ?? null, datei.replace(/^armor\//, '')); }
      catch (error) {
        for (const root of res.meshes.filter(mesh => mesh.parent === this.figurKnoten)) root.dispose(false, true);
        for (const skeleton of res.skeletons) skeleton.dispose();
        throw error;
      }
      for (const m of netze) {
        // Das Skelett des KOERPERS aufziehen, nicht das mitgelieferte:
        // sonst stuende die Frisur in der Bindepose, waehrend der Koerper
        // atmet. Zulaessig nur, weil beide dieselbe Gelenkliste haben.
        if (this.skelett) m.skeleton = this.skelett;
      }
      const importiertesTeil = {
        netze,
        wurzeln: res.meshes.filter((m) => m.parent === this.figurKnoten),
        skelette: res.skeletons,
      };
      if (slot === 'frisur') stabilizeHeadSkin(this.koerperNetze, netze);
      // ImportMeshAsync schaltet Netze sofort ein. Zuerst ausblenden und
      // erst nach dem Lauf-Abgleich freigeben, sonst blitzt eine alte
      // Frisur auf oder bleibt nach schnellem Weiterklicken sogar stehen.
      for (const m of netze) m.setEnabled(false);
      if (epoche !== this.teileEpoche || this.teileLaeufe.get(slot) !== lauf
          || this.aktuell.get(slot) !== datei || this.zerstoert) {
        for (const wurzel of importiertesTeil.wurzeln) wurzel.dispose(false, true);
        for (const skelett of importiertesTeil.skelette) skelett.dispose();
        return;
      }
      this.geladen.set(datei, importiertesTeil);
    }
    if (epoche !== this.teileEpoche || this.teileLaeufe.get(slot) !== lauf
        || this.aktuell.get(slot) !== datei || this.zerstoert) return;
    this.zeige(datei, true);
    // Nach dem Anzeigen faerben — eine frisch geladene Frisur bringt ihr
    // eigenes Material mit und waere sonst wieder platzhalterbraun.
    this.faerbeFrisur();
    this.refreshVisibility();
  }

  /** Derive masks from loaded items; late cosmetic loads cannot escape an active hood. */
  private refreshVisibility(): void {
    const active = [...this.aktuell.values()]
      .filter(file => (this.geladen.get(file)?.netze.length ?? 0) > 0)
      .map(file => file.replace(/^armor\//, ''));
    updateArmorVisibility(this.koerperNetze, active);
    const hidden = hiddenAppearanceForFiles(active);
    for (const [slot, feature] of Object.entries(APPEARANCE_ATTACHMENTS)) {
      const file = this.aktuell.get(slot);
      if (file) this.zeige(file, !hidden.has(feature));
    }
  }

  /**
   * Blendet die vom vollständigen Rüstungsset ersetzten Körpersegmente aus.
   * Die Rüstungs-GLBs enthalten diese Segmente als passende Innengeometrie;
   * beides gleichzeitig ergäbe flimmernde, ineinanderliegende Flächen.
   */
  setzeKoerperRegionenVerdeckt(regionen: readonly string[]): void {
    const verdeckt = new Set(regionen);
    for (const mesh of this.koerperNetze) {
      const region = [...verdeckt].find((name) => mesh.name.startsWith(`Chr_${name}_`));
      mesh.setEnabled(!region);
    }
  }

  /**
   * Haarfarbe setzen. Erwartet sRGB-Hex, wie es aussehen.json liefert.
   *
   * KEIN Materialklon noetig: Jede Frisur kommt hier ueber einen eigenen
   * `ImportMeshAsync` und bringt ihr eigenes Material mit. Im Spiel ist
   * das anders — dort teilen sich Mitspieler den Container-Cache, und
   * dort MUSS geklont werden (client/src/player/haarfarbe.ts).
   *
   * `toLinearSpace()` ist nicht kosmetisch: glTF legt `baseColorFactor`
   * unveraendert in `albedoColor`, und der ist linear definiert. Ohne
   * die Umrechnung sieht jede Farbe sichtbar zu hell aus.
   */
  setzeHaarfarbe(hex: string): void {
    this.haarHex = hex;
    this.faerbeFrisur();
  }

  /** Augenfarbe als Kennung aus appearance.json. */
  setzeAugenfarbe(id: string): void {
    this.augenfarbe = id;
    if (this.koerperNetze.length) faerbeAugen(this.koerperNetze, id);
  }

  private faerbeFrisur(): void {
    if (!this.haarHex) return;
    const farbe = Color3.FromHexString(this.haarHex).toLinearSpace();
    for (const slot of ['frisur', 'bart', 'augenbraue']) {
      const datei = this.aktuell.get(slot);
      if (!datei) continue;
      for (const m of this.geladen.get(datei)?.netze ?? []) {
        const mat = m.material as unknown as Record<string, unknown> | null;
        if (!mat) continue;
        // Nach Bauart statt nach Klasse: glTF liefert ein PBR-Material.
        if ('albedoColor' in mat) mat['albedoColor'] = farbe;
        else if ('diffuseColor' in mat) mat['diffuseColor'] = farbe;
      }
    }
  }

  private zeige(datei: string, sichtbar: boolean): void {
    const teil = this.geladen.get(datei);
    if (!teil) return;
    for (const m of teil.netze) m.setEnabled(sichtbar);
  }


  /**
   * Boden und Dunst.
   *
   * Eine Scheibe bei y = 0 — die Figur steht mit den Fuessen im Ursprung,
   * also genau darauf. Nach aussen loest sie der Nebel auf; ohne ihn saehe
   * man die Kante der Scheibe als harten Kreis im Nichts.
   *
   * Die Nebelfarbe ist dieselbe wie das mittlere Band des Himmels. Das ist
   * kein Zufall, sondern die Bedingung dafuer, dass der Uebergang
   * verschwindet: Wo Boden und Himmel sich treffen, muessen beide dieselbe
   * Farbe erreichen, sonst zieht sich dort eine sichtbare Naht.
   *
   * Keine Bodentextur: Die liegen im Spiel unter /assets/textures/, und auf
   * dem Testgestade ist nur /assets/models/ von der Basic-Auth ausgenommen
   * (der Block in NPMs 4.conf). Eine Textur wuerde dort mit 401 antworten
   * und der Boden bliebe schwarz — auf live aber nicht. Ein Unterschied,
   * den man erst im Betrieb merkt.
   */
  /**
   * Umgebungslicht fuer die PBR-Materialien — die Sky-Probe im Kleinen.
   *
   * DAS ist der Grund, warum die Kulisse vorher "billig" aussah, und nicht
   * die Zahl der Baeume. Die Gewaechse des Spiels tragen PBR-Materialien,
   * und die holen ihren Grundton nicht aus Punktlichtern, sondern aus
   * `scene.environmentTexture`. Fehlt sie, bleibt Rinde stumpf und Laub
   * flach — egal wie viele Lampen man aufstellt.
   *
   * Das Spiel haengt dort eine echte Sky-Probe hinein (Lighting.ts:338).
   * Die zu portieren hiesse, die Beleuchtungskette mitzunehmen. Hier
   * genuegt eine Wuerfeltextur aus SECHS 16x16-Flaechen, gefuellt aus
   * demselben Verlauf wie die Kuppel: oben Himmel, unten Waldboden, an den
   * Seiten der Uebergang. Fuer diffuse Rueckstrahlung ist das genau genug —
   * ein Baum braucht kein scharfes Spiegelbild, er braucht die Information
   * "von oben kommt kuehles Licht, von unten dunkles Gruen".
   */
  /**
   * Der Klecksschatten unter der Figur.
   *
   * Ohne ihn schwebt sie vor dem Video — der Blick sucht immer die Stelle,
   * wo Fuss und Boden sich treffen, und wenn dort nichts ist, stimmt das
   * ganze Bild nicht. Ein gerechneter Schatten geht nicht: Es gibt keinen
   * Boden mehr, der ihn auffangen koennte, der Boden IST das Video.
   *
   * Also ein weicher dunkler Fleck als flache Scheibe, knapp ueber Null.
   * Dasselbe Mittel benutzt das Spiel fuer billige Schatten
   * (client/src/engine — blob_shadows im Vergleichsprojekt).
   */
  private fleckschattenLegen(): void {
    const K = 128;
    const textur = new Fleck('fleck', { width: K, height: K }, this.scene, false);
    const stift = textur.getContext() as CanvasRenderingContext2D;
    const v = stift.createRadialGradient(K / 2, K / 2, 0, K / 2, K / 2, K / 2);
    v.addColorStop(0, 'rgba(0,0,0,0.55)');
    v.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    stift.fillStyle = v;
    stift.fillRect(0, 0, K, K);
    textur.update();
    textur.hasAlpha = true;

    const scheibe = CreateDisc('fleck', { radius: 0.55, tessellation: 24 }, this.scene);
    scheibe.rotation.x = Math.PI / 2;
    // Zwei Zentimeter ueber Null: Auf genau 0 kaempfen Scheibe und Boden um
    // dieselben Tiefenwerte und flackern.
    scheibe.position.y = 0.02;
    scheibe.isPickable = false;

    const stoff = new StandardMaterial('fleck', this.scene);
    stoff.diffuseTexture = textur;
    stoff.opacityTexture = textur;
    stoff.emissiveColor = new Color3(0, 0, 0);
    stoff.specularColor = new Color3(0, 0, 0);
    stoff.disableLighting = true;
    scheibe.material = stoff;
  }

  private umgebungslichtSetzen(): void {
    const K = 16;
    const flaeche = (oben: [number, number, number], unten: [number, number, number]) => {
      const d = new Uint8Array(K * K * 4);
      for (let y = 0; y < K; y++) {
        const f = y / (K - 1);
        for (let x = 0; x < K; x++) {
          const i = (y * K + x) * 4;
          d[i] = oben[0] + (unten[0] - oben[0]) * f;
          d[i + 1] = oben[1] + (unten[1] - oben[1]) * f;
          d[i + 2] = oben[2] + (unten[2] - oben[2]) * f;
          d[i + 3] = 255;
        }
      }
      return d;
    };

    const HIMMEL: [number, number, number] = [38, 74, 98];
    const DUNST: [number, number, number] = [61, 126, 163];
    const BODEN: [number, number, number] = [30, 34, 24];

    // Reihenfolge: +X, -X, +Y (oben), -Y (unten), +Z, -Z
    const seiten = [
      flaeche(HIMMEL, BODEN),
      flaeche(HIMMEL, BODEN),
      flaeche(HIMMEL, DUNST),
      flaeche(BODEN, BODEN),
      flaeche(HIMMEL, BODEN),
      flaeche(HIMMEL, BODEN),
    ];

    const wuerfel = new RawCubeTexture(
      this.scene, seiten as unknown as ArrayBufferView[], K,
      Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE,
      false, false, Constants.TEXTURE_LINEAR_LINEAR
    );
    wuerfel.gammaSpace = true;
    this.scene.environmentTexture = wuerfel;
    // Unter einem Kronendach kommt weniger Himmel an als auf freiem Feld.
    this.scene.environmentIntensity = 0.85;
  }

  /**
   * Schatten. Ohne sie steht alles auf der Flaeche, nicht darin.
   *
   * Das Spiel faehrt einen CascadedShadowGenerator ueber 250 m. Hier reicht
   * EINE Karte: Die ganze Szene, die Schatten braucht, misst keine
   * 20 Einheiten. Vier Kaskaden waeren viermal rastern fuer denselben
   * Ausschnitt — und das Vergleichsprojekt faehrt aus genau dem Grund ebenfalls nur
   * eine.
   *
   * PCF wie im Spiel, damit die Kante weich ist. `darkness` unter 1, weil
   * ein Waldschatten nie schwarz ist — es faellt immer Streulicht hinein.
   */
  /**
   * Ziehen dreht die Figur, das Rad zoomt, ein Klick auf den Kopf faehrt ins
   * Portraet und wieder heraus.
   *
   * Beim Zoomen wird das Video im HTML MITSKALIERT (--zoom auf der Buehne).
   * Ohne das faellt der Trick auseinander: Die Figur waechst, der Wald
   * dahinter bleibt gleich gross, und man sieht sofort, dass sie vor einer
   * Leinwand steht statt darin.
   *
   * KLICK GEGEN ZIEHEN: Ein Klick ist Zeiger runter und hoch mit weniger als
   * KLICK_WEG Bildpunkten zurueckgelegtem WEG (nicht Abstand: wer weit weg
   * und wieder zurueck zieht, hat gezogen). Ziehen loest den Zoom nie aus,
   * auch wenn es auf dem Kopf beginnt oder endet. Ein zweiter Finger macht
   * den Klick ungueltig, damit Kneifen nicht zoomt.
   */
  private zeigerAnschliessen(leinwand: HTMLCanvasElement): void {
    let letzterX: number | null = null;
    let druck: { id: number; x: number; y: number; weg: number; gueltig: boolean } | null = null;

    const signal = this.zeigerAbbruch.signal;
    leinwand.addEventListener('pointerdown', (e) => {
      leinwand.setPointerCapture(e.pointerId);
      letzterX = e.clientX;
      this.zeigerGedrueckt = true;
      if (e.pointerType !== 'mouse') this.zeigerPos = null;
      if (druck) druck.gueltig = false;
      else if (e.button === 0) druck = { id: e.pointerId, x: e.clientX, y: e.clientY, weg: 0, gueltig: true };
    }, { signal });
    const los = (e: PointerEvent) => {
      letzterX = null;
      this.zeigerGedrueckt = false;
      if (leinwand.hasPointerCapture(e.pointerId)) leinwand.releasePointerCapture(e.pointerId);
    };
    leinwand.addEventListener('pointerup', (e) => {
      los(e);
      const klick = druck;
      if (klick && klick.id === e.pointerId) druck = null;
      if (klick && klick.id === e.pointerId && klick.gueltig && klick.weg < KLICK_WEG
          && this.kopfGetroffen(e.clientX, e.clientY, e.pointerType !== 'mouse')) {
        this.zoomeKopf();
      }
    }, { signal });
    leinwand.addEventListener('pointercancel', (e) => {
      los(e);
      druck = null;
    }, { signal });
    leinwand.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.zeigerPos = { x: e.clientX, y: e.clientY };
      if (druck && druck.id === e.pointerId) {
        druck.weg += Math.hypot(e.clientX - druck.x, e.clientY - druck.y);
        druck.x = e.clientX;
        druck.y = e.clientY;
      }
      if (letzterX === null) return;
      // 0,01 rad je Bildpunkt: eine halbe Bildbreite dreht die Figur einmal
      // knapp herum — genug, um die Rueckseite zu sehen, ohne zu zappeln.
      this.figurKnoten.rotation.y += (e.clientX - letzterX) * 0.01;
      letzterX = e.clientX;
    }, { signal });
    leinwand.addEventListener('pointerleave', () => {
      this.zeigerPos = null;
    }, { signal });

    leinwand.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Das Rad uebernimmt: eine laufende Fahrt endet dort, wo sie steht.
      this.radiusFahrt = null;
      const neu = this.kamera.radius * (e.deltaY < 0 ? 1 / 1.12 : 1.12);
      this.kamera.radius = Math.min(
        this.kamera.upperRadiusLimit ?? 6,
        Math.max(this.kamera.lowerRadiusLimit ?? PORTRAET_RADIUS, neu)
      );
      this.videoMassstabSetzen();
      this.kopfZustandMelden();
    }, { passive: false, signal });
  }

  /**
   * Das Video im Takt der Kamera mitskalieren.
   *
   * Der Wert geht als CSS-Variable an die Buehne; das Stylesheet der Seite
   * setzt ihn auf `transform: scale(...)` des Videos. Der Faktor ist bewusst
   * schwaecher als der Kamerazoom (Wurzel statt linear): Ein Hintergrund in
   * zwanzig Metern Entfernung waechst beim Vortreten eben kaum, und wer ihn
   * genauso stark mitwachsen laesst, uebertreibt die Bewegung.
   *
   * Am Portraetabstand (1,4 m) steht der Faktor bei Wurzel aus 5,5 / 1,4 =
   * 1,98; die Radiusgrenze haelt ihn unter 2,0, ab dem ein Video sichtbar
   * grobe Bloecke zeigt. Eine eigene Kappung braucht es darum nicht.
   */
  private videoMassstabSetzen(): void {
    const aus = this.kamera.upperRadiusLimit ?? 6;
    const s = Math.sqrt(aus / Math.max(0.001, this.kamera.radius));
    this.leinwand.parentElement?.style.setProperty('--zoom', s.toFixed(3));
  }

  /**
   * Blickpunkt aus dem Radius ableiten (die einzige Quelle ist der Radius):
   * ab 3,2 m auf die Brust, von 3,2 bis 2,2 m stetig zum Kopf hinauf, von
   * 2,2 m bis zum Portraet auf der Kopfmitte.
   */
  private blickpunktNachfuehren(): void {
    const t = Math.min(1, Math.max(0, (AUSGANG_RADIUS - this.kamera.radius) / (AUSGANG_RADIUS - NAH_ENDE)));
    this.kamera.target.y = BRUST_Y + t * (KOPF_Y - BRUST_Y);
  }

  /**
   * Sichtfeld aus dem Radius ableiten (ebenfalls nur eine Folge des Radius):
   * bis 2,2 m unveraendert; darunter sinkt die sichtbare Bildhoehe geometrisch
   * von der bei 2,2 m auf PORTRAET_BILDHOEHE, und das Sichtfeld folgt daraus
   * fuer den jeweiligen Abstand (Teleaufnahme, siehe PORTRAET_RADIUS).
   */
  private sichtfeldNachfuehren(): void {
    const r = this.kamera.radius;
    if (r >= NAH_ENDE) {
      this.kamera.fov = FOV_AUSGANG;
      return;
    }
    const t = Math.min(1, (NAH_ENDE - r) / (NAH_ENDE - PORTRAET_RADIUS));
    const hoeheNah = 2 * NAH_ENDE * Math.tan(FOV_AUSGANG / 2);
    const hoehe = hoeheNah * Math.pow(PORTRAET_BILDHOEHE / hoeheNah, t);
    this.kamera.fov = 2 * Math.atan(hoehe / (2 * r));
  }

  /** Setzt die Kamera zurueck: Drehung sofort, Radius als Fahrt (ohne Animation bei reduzierter Bewegung). */
  blickZurueck(): void {
    this.figurKnoten.rotation.y = 0;
    this.radiusFahren(AUSGANG_RADIUS);
    // Der Blickpunkt folgt beim naechsten Frame von selbst; ihn hier
    // ebenfalls zu setzen waere eine zweite Wahrheit ueber dieselbe Zahl.
  }

  /**
   * Kopf-Zoom: `true` faehrt ins Portraet, `false` zurueck ins Ausgangsbild,
   * ohne Angabe wird umgeschaltet. Tut dasselbe wie ein Klick auf den Kopf.
   */
  zoomeKopf(nah: boolean = !this.kopfNah): void {
    this.radiusFahren(nah ? PORTRAET_RADIUS : AUSGANG_RADIUS);
  }

  /** Steht die Kamera im Portraet oder faehrt sie dorthin? Aus dem Radius abgeleitet. */
  get kopfNah(): boolean {
    return this.radiusFahrt
      ? this.radiusFahrt.nach <= PORTRAET_RADIUS
      : this.kamera.radius <= PORTRAET_RADIUS + 0.005;
  }

  /**
   * Faehrt den Radius weich (Ein- und Ausbremsen) auf `ziel`. Der Radius
   * ist die einzige Wahrheit, darum ist das hier nur eine Animation
   * desselben Wertes, den auch das Rad schreibt. Die Zwischenwerte laufen
   * geometrisch (gleiches Verhaeltnis je Zeit), so wirkt die Fahrt gleichmaessig.
   */
  private radiusFahren(ziel: number): void {
    if (this.zerstoert) return;
    const von = this.kamera.radius;
    if (Math.abs(von - ziel) < 1e-3 || this.bewegungReduziert()) {
      this.radiusFahrt = null;
      this.kamera.radius = ziel;
      this.videoMassstabSetzen();
      this.kopfZustandMelden();
      return;
    }
    this.radiusFahrt = { von, nach: ziel, start: performance.now() };
    this.kopfZustandMelden();
  }

  private radiusFahrtWeiter(): void {
    const fahrt = this.radiusFahrt;
    if (!fahrt) return;
    const t = Math.min(1, (performance.now() - fahrt.start) / FAHRT_MS);
    const weich = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.kamera.radius = fahrt.von * Math.pow(fahrt.nach / fahrt.von, weich);
    if (t >= 1) {
      this.kamera.radius = fahrt.nach;
      this.radiusFahrt = null;
    }
    this.videoMassstabSetzen();
  }

  private bewegungReduziert(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Kopfmitte, -radius und Abstand zum Kopfknochen als Bildschirmwerte in
   * CSS-Pixeln (bezogen auf die Leinwand); null, solange keine Figur steht.
   * Die Hoehe ist die gemessene Kopfmitte, die seitliche Lage kommt vom
   * Kopfknochen — die Ruhepose neigt den Kopf um einige Zentimeter nach vorn,
   * und bei gedrehter Figur wuerde die Markierung sonst neben dem Kopf stehen.
   */
  private kopfAufBildschirm(): { x: number; y: number; r: number } | null {
    if (!this.koerperNetze.length) return null;
    const box = this.leinwand.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    const knochen = this.kopfKnoten?.getAbsolutePosition();
    this.kopfWelt.set(knochen?.x ?? 0, KOPF_Y, knochen?.z ?? 0);
    // Ansicht und Projektion frisch von der Kamera: scene.getTransformMatrix()
    // haelt den Stand des vorigen Bildes, waehrend Radius und Blickpunkt
    // in diesem Frame schon neu gesetzt sind.
    const ansicht = this.kamera.getViewMatrix();
    const tiefe = Vector3.TransformCoordinates(this.kopfWelt, ansicht).z;
    if (!(tiefe > this.kamera.minZ)) return null;
    ansicht.multiplyToRef(this.kamera.getProjectionMatrix(), this.kopfMatrix);
    const bild = Vector3.TransformCoordinates(this.kopfWelt, this.kopfMatrix);
    const proMeter = box.height / (2 * tiefe * Math.tan(this.kamera.fov / 2));
    return {
      x: (bild.x + 1) / 2 * box.width,
      y: (1 - bild.y) / 2 * box.height,
      r: KOPF_RADIUS * proMeter,
    };
  }

  /** Trifft ein Punkt (Client-Koordinaten) den Kopf, samt Frisur und Helm? */
  private kopfGetroffen(clientX: number, clientY: number, finger: boolean): boolean {
    const kopf = this.kopfAufBildschirm();
    if (!kopf) return false;
    const box = this.leinwand.getBoundingClientRect();
    // Zugabe: ein Finger trifft ungenauer als eine Maus.
    return Math.hypot(clientX - box.left - kopf.x, clientY - box.top - kopf.y) <= kopf.r + (finger ? 14 : 4);
  }

  private leinwandVersatzMessen(): void {
    const eltern = this.leinwand.parentElement;
    if (!eltern) return;
    const a = this.leinwand.getBoundingClientRect();
    const b = eltern.getBoundingClientRect();
    this.leinwandVersatz = { x: a.left - b.left, y: a.top - b.top };
  }

  /**
   * Jeden Frame: Zeigerform, Zustandsmeldung und die CSS-Variablen der
   * Kopfmarkierung (--kopf-x, --kopf-y, --kopf-r in Pixeln, bezogen auf das
   * Elternelement der Leinwand — wie --zoom). Geschrieben wird nur, wenn sich
   * ein Wert um mehr als 0,5 Pixel aendert.
   */
  private kopfNachfuehren(): void {
    const kopf = this.kopfAufBildschirm();
    const eltern = this.leinwand.parentElement;
    if (eltern) {
      const x = kopf ? kopf.x + this.leinwandVersatz.x : NaN;
      const y = kopf ? kopf.y + this.leinwandVersatz.y : NaN;
      const r = kopf ? kopf.r : 0;
      const alt = this.kopfMarke;
      const anders = (neu: number, vorher: number) =>
        Number.isNaN(neu) ? !Number.isNaN(vorher) : Number.isNaN(vorher) || Math.abs(neu - vorher) > 0.5;
      if (anders(x, alt.x) || anders(y, alt.y) || anders(r, alt.r)) {
        this.kopfMarke = { x, y, r };
        eltern.style.setProperty('--kopf-x', Number.isNaN(x) ? '0px' : `${x.toFixed(1)}px`);
        eltern.style.setProperty('--kopf-y', Number.isNaN(y) ? '0px' : `${y.toFixed(1)}px`);
        eltern.style.setProperty('--kopf-r', `${r.toFixed(1)}px`);
      }
    }
    this.kopfZustandMelden();
  }

  /** Bildet Zustand und Zeigerform neu und ruft die Seite nur bei einer Aenderung. */
  private kopfZustandMelden(): void {
    if (this.zerstoert) return;
    const ueber = !this.zeigerGedrueckt && this.zeigerPos !== null
      && this.kopfGetroffen(this.zeigerPos.x, this.zeigerPos.y, false);
    const nah = this.kopfNah;
    // Ausserhalb des Kopfes bleibt es beim Stil der Seite (grab/grabbing).
    const form = ueber ? (nah ? 'zoom-out' : 'zoom-in') : '';
    if (form !== this.zeigerForm) {
      this.zeigerForm = form;
      this.leinwand.style.cursor = form;
    }
    const letzter = this.kopfZustandLetzter;
    if (letzter.nah === nah && letzter.ueber === ueber) return;
    this.kopfZustandLetzter = { nah, ueber };
    this.beiKopfZustand?.({ nah, ueber });
  }

  /** Koerper- oder Serverwechsel: Portraet, Fahrt, Markierung und Zeigerform aufraeumen. */
  private kopfZoomZuruecksetzen(): void {
    this.radiusFahrt = null;
    this.kopfKnoten = null;
    this.kamera.radius = AUSGANG_RADIUS;
    this.videoMassstabSetzen();
    this.kopfZustandMelden();
  }

  drehe(schritt: number): void { this.figurKnoten.rotation.y += schritt; }

  dispose(): void {
    this.zerstoert = true;
    this.zeigerAbbruch.abort();
    this.radiusFahrt = null;
    this.beiKopfZustand = null;
    this.leinwand.style.cursor = '';
    this.zeigerForm = '';
    for (const name of ['--zoom', '--kopf-x', '--kopf-y', '--kopf-r']) {
      this.leinwand.parentElement?.style.removeProperty(name);
    }
    this.koerperLauf += 1;
    this.teileEpoche += 1;
    this.teileLaeufe.clear();
    this.beobachter?.disconnect();
    window.removeEventListener('resize', this.beiGroesse);
    this.scene.dispose();
    this.engine.dispose();
  }
}
