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
 * Alle 21 Frisuren zusammen sind 17,5 MB. Der Koerper allein ist
 * 3,76 MB, eine Frisur 0,28 bis 1,71 MB. Wer die Auswahl oeffnet, soll
 * nicht auf 20 Frisuren warten, die er nicht traegt.
 *
 * Das funktioniert nur, weil jede Teildatei DIESELBE Gelenkliste traegt
 * wie der Koerper — 51 Knochen, Index fuer Index. Erzeugt werden sie von
 * tools/asset-aufteilen.py, das genau das nachprueft und sonst abbricht.
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
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
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import '@babylonjs/loaders/glTF';

interface Teil {
  netze: AbstractMesh[];
}

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
  private zerstoert = false;
  private beobachter: ResizeObserver | null = null;
  private sonne!: DirectionalLight;
  /** Nur das alte Wikingerin-Rig kann deren separate Aussehensteile tragen. */
  private teileErlaubt = true;
  /** Verhindert, dass Reset und Zufall denselben Körper mehrfach importieren. */
  private koerperDatei = '';
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

    // Die Figur ist 1,0 hoch mit den Fuessen im Ursprung — der Kopf sitzt
    // also bei rund 0,95. Der Blick geht auf Kopf und Oberkoerper.
    /*
      Alle Werte in METERN, seit die Szene die echte Welt zeigt. Die Figur
      ist 1,80 m: Brust bei 1,05, Scheitel bei rund 1,62.

      Ausgangsabstand 6,5 m statt der frueheren 3,4: Bei 3,4 fuellte die
      Figur das Bild und vom Wald sah man Rinde. Aus 6,5 m steht sie ganz
      im Bild UND der Bestand dahinter ist zu erkennen — darum geht es auf
      dieser Seite. Bis 16 m laesst sich herausziehen, bis 2,2 m heran.
    */
    this.kamera = new ArcRotateCamera(
      'vorschau', Math.PI / 2, Math.PI / 2.12, 3.6,
      new Vector3(0, 1.05, 0), this.scene);
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

    /*
      Wie nah man heran darf.

      Nachgemessen am Modell (tools/glb-bbox.js): Der Koerper ist
      0,62 breit x 1,00 hoch x 0,16 tief, Fuesse bei y = 0. Der Blickpunkt
      wandert beim Hineinzoomen bis 0,90, also in den Kopf.

      1,0 statt der frueheren 0,7: Bei 0,7 lag die Kamera rechnerisch zwar
      noch ausserhalb der Figur, aber so knapp, dass eine voluminoese
      Frisur oder ein gedrehter Blickwinkel gereicht haetten — und genau
      das wurde am 23.08.2026 gemeldet. Ein Meter Abstand haelt auch bei
      der groessten Frisur und jedem erlaubten Winkel Luft.

      Der Preis ist eine etwas weitere Grossaufnahme: Bei Radius 1,0 fuellt
      der Kopf rund ein Viertel der Bildhoehe statt eines Drittels. Fuer
      "welche Frisur nehme ich" reicht das, und es ist der bessere Tausch
      gegen eine Kamera, die im Kopf steckt.
    */
    this.kamera.lowerRadiusLimit = 2.2;
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
      Gedreht und gezoomt wird weiter; dafuer gibt es auch die drei Knoepfe.
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

    this.scene.onBeforeRenderObservable.add(() => this.blickpunktNachfuehren());
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
    if (typeof ResizeObserver !== 'undefined') {
      this.beobachter = new ResizeObserver(() => this.engine.resize());
      this.beobachter.observe(leinwand);
    }
  }

  private beiGroesse = () => this.engine.resize();

  /** Server wechseln: alles Geladene verwerfen, sonst mischen sich Staende. */
  async setzeWurzel(wurzel: string): Promise<void> {
    if (wurzel === this.wurzel) return;
    this.wurzel = wurzel;
    for (const teil of this.geladen.values()) {
      for (const m of teil.netze) m.dispose();
    }
    this.geladen.clear();
    this.aktuell.clear();
    for (const s of [...this.scene.skeletons]) s.dispose();
    for (const g of [...this.scene.animationGroups]) g.dispose();
    for (const m of [...this.scene.meshes]) m.dispose();
    this.skelett = null;
    this.ruhe = null;
  }

  async ladeKoerper(datei: string): Promise<void> {
    if (datei === this.koerperDatei) return;
    const res = await SceneLoader.ImportMeshAsync('', this.wurzel, datei + '.glb', this.scene);

    this.koerperDatei = datei;
    this.teileErlaubt = datei === 'wikingerin/WikingerinKoerper';

    // Der Synty-Atlas ist für einen nahezu unbeleuchteten Unity-Shader
    // gemalt. Das Spiel tönt ihn deshalb auf dieselben gemessenen Werte;
    // die Webseite muss dieselbe Figur und nicht eine ausgewaschene Kopie
    // davon zeigen. Jedes Material nur einmal setzen, weil Meshes teilen.
    if (datei === 'wikinger/WikingerKoerper') {
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
    for (const teil of res.meshes.filter((m) => !m.parent)) teil.parent = this.figurKnoten;
    this.skelett = res.skeletons[0] ?? null;
    for (const g of res.animationGroups) g.stop();
    // Ueber den Namen, nicht "der erste Clip": Die Reihenfolge im glTF ist
    // alphabetisch und begaenne bei "angriff".
    this.ruhe = res.animationGroups.find((g) => /idle|ruhe|stand/i.test(g.name))
      ?? res.animationGroups[0] ?? null;
    this.ruhe?.start(true);

    /*
      Der Hain kommt NACH der Figur und ohne await: Er ist Kulisse, und
      niemand soll auf seine Eiche warten, um die eigene Frisur zu sehen.
      Faellt er ganz aus, steht die Figur trotzdem — vor Himmel und Boden,
      die beide nichts kosten.
    */

  }

  async setze(slot: string, datei: string | null): Promise<void> {
    if (!this.teileErlaubt) return;
    if (this.aktuell.get(slot) === (datei ?? '')) return;
    const vorher = this.aktuell.get(slot);
    if (vorher) this.zeige(vorher, false);
    this.aktuell.set(slot, datei ?? '');
    if (!datei) return;

    if (!this.geladen.has(datei)) {
      const res = await SceneLoader.ImportMeshAsync('', this.wurzel, datei + '.glb', this.scene);
      // Unter denselben Knoten wie der Koerper — sonst stuende die Frisur
      // in 1,00 m Groesse neben einer 1,80 m grossen Figur.
      for (const teil of res.meshes.filter((m) => !m.parent)) teil.parent = this.figurKnoten;
      const netze = res.meshes.filter((m) => m.getTotalVertices() > 0);
      for (const m of netze) {
        // Das Skelett des KOERPERS aufziehen, nicht das mitgelieferte:
        // sonst stuende die Frisur in der Bindepose, waehrend der Koerper
        // atmet. Zulaessig nur, weil beide dieselbe Gelenkliste haben.
        if (this.skelett) m.skeleton = this.skelett;
      }
      this.geladen.set(datei, { netze });
    }
    this.zeige(datei, true);
    // Nach dem Anzeigen faerben — eine frisch geladene Frisur bringt ihr
    // eigenes Material mit und waere sonst wieder platzhalterbraun.
    this.faerbeFrisur();
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

  private faerbeFrisur(): void {
    if (!this.haarHex) return;
    const datei = this.aktuell.get('frisur');
    if (!datei) return;
    const farbe = Color3.FromHexString(this.haarHex).toLinearSpace();
    for (const m of this.geladen.get(datei)?.netze ?? []) {
      const mat = m.material as unknown as Record<string, unknown> | null;
      if (!mat) continue;
      // Nach Bauart statt nach Klasse: glTF liefert ein PBR-Material.
      if ('albedoColor' in mat) mat['albedoColor'] = farbe;
      else if ('diffuseColor' in mat) mat['diffuseColor'] = farbe;
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
   * (client/src/engine — blob_shadows im ClaudeCraft-Vergleich).
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
   * Ausschnitt — und ClaudeCraft faehrt aus genau dem Grund ebenfalls nur
   * eine (siehe Notiz "Was World of ClaudeCraft anders macht").
   *
   * PCF wie im Spiel, damit die Kante weich ist. `darkness` unter 1, weil
   * ein Waldschatten nie schwarz ist — es faellt immer Streulicht hinein.
   */
  /**
   * Ziehen dreht die Figur, das Rad zoomt.
   *
   * Beim Zoomen wird das Video im HTML MITSKALIERT (--zoom auf der Buehne).
   * Ohne das faellt der Trick auseinander: Die Figur waechst, der Wald
   * dahinter bleibt gleich gross, und man sieht sofort, dass sie vor einer
   * Leinwand steht statt darin.
   */
  private zeigerAnschliessen(leinwand: HTMLCanvasElement): void {
    let letzterX: number | null = null;

    leinwand.addEventListener('pointerdown', (e) => {
      leinwand.setPointerCapture(e.pointerId);
      letzterX = e.clientX;
    });
    const los = (e: PointerEvent) => {
      letzterX = null;
      if (leinwand.hasPointerCapture(e.pointerId)) leinwand.releasePointerCapture(e.pointerId);
    };
    leinwand.addEventListener('pointerup', los);
    leinwand.addEventListener('pointercancel', los);
    leinwand.addEventListener('pointermove', (e) => {
      if (letzterX === null) return;
      // 0,01 rad je Bildpunkt: eine halbe Bildbreite dreht die Figur einmal
      // knapp herum — genug, um die Rueckseite zu sehen, ohne zu zappeln.
      this.figurKnoten.rotation.y += (e.clientX - letzterX) * 0.01;
      letzterX = e.clientX;
    });

    leinwand.addEventListener('wheel', (e) => {
      e.preventDefault();
      const neu = this.kamera.radius * (e.deltaY < 0 ? 1 / 1.12 : 1.12);
      this.kamera.radius = Math.min(
        this.kamera.upperRadiusLimit ?? 6,
        Math.max(this.kamera.lowerRadiusLimit ?? 2.2, neu)
      );
      this.videoMassstabSetzen();
    }, { passive: false });
  }

  /**
   * Das Video im Takt der Kamera mitskalieren.
   *
   * Der Wert geht als CSS-Variable an die Buehne; das Stylesheet der Seite
   * setzt ihn auf `transform: scale(...)` des Videos. Der Faktor ist bewusst
   * schwaecher als der Kamerazoom (Wurzel statt linear): Ein Hintergrund in
   * zwanzig Metern Entfernung waechst beim Vortreten eben kaum, und wer ihn
   * genauso stark mitwachsen laesst, uebertreibt die Bewegung.
   */
  private videoMassstabSetzen(): void {
    const aus = this.kamera.upperRadiusLimit ?? 6;
    const anteil = Math.max(0.001, this.kamera.radius / aus);
    const s = Math.sqrt(1 / anteil);
    this.leinwand.parentElement?.style.setProperty('--zoom', s.toFixed(3));
  }

  private blickpunktNachfuehren(): void {
    const AUSGANG = 3.6;
    const BRUST = 1.05;
    const KOPF = 1.62;
    const nah = this.kamera.lowerRadiusLimit ?? 2.2;
    const t = Math.min(1, Math.max(0, (AUSGANG - this.kamera.radius) / (AUSGANG - nah)));
    this.kamera.target.y = BRUST + t * (KOPF - BRUST);
  }

  blickZurueck(): void {
    this.figurKnoten.rotation.y = 0;
    this.kamera.radius = 3.6;
    this.videoMassstabSetzen();
    // Der Blickpunkt folgt beim naechsten Frame von selbst; ihn hier
    // ebenfalls zu setzen waere eine zweite Wahrheit ueber dieselbe Zahl.
  }

  drehe(schritt: number): void { this.figurKnoten.rotation.y += schritt; }

  dispose(): void {
    this.zerstoert = true;
    this.beobachter?.disconnect();
    window.removeEventListener('resize', this.beiGroesse);
    this.scene.dispose();
    this.engine.dispose();
  }
}
