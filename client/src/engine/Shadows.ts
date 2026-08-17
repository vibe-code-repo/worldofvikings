/**
 * Shadows — kaskadierte Sonnenschatten nach dem Vorbild des Originals.
 *
 * ── Die Werte stammen aus dem Client ─────────────────────────────────
 * `GraphicsSettingsManager.ApplyQualitySettings()` schaltet Unitys
 * QualitySettings je nach `m_shadowQuality`:
 *
 *   Stufe 0  shadowCascades 2   shadowDistance  80 m   ShadowResolution.Low
 *   Stufe 1  shadowCascades 3   shadowDistance 120 m   ShadowResolution.Medium
 *   Stufe 2  shadowCascades 4   shadowDistance 150 m   ShadowResolution.High
 *
 * Voreinstellung im Original ist Stufe 2 (`m_shadowQuality = 2`).
 *
 * Babylons `CascadedShadowGenerator` ist der direkte Gegenpart zu Unitys
 * kaskadierten Schattenkarten für gerichtetes Licht — Kaskadenzahl und
 * maximale Distanz heissen dort `numCascades` und `shadowMaxZ`, die
 * Auflösung ist die Kantenlänge der Schattenkarte.
 *
 * Die Stufe "Aus" gibt es im Original NICHT (der Wertebereich ist 0..2).
 * Sie ist ergänzt, weil jede Kaskade eine eigene Renderpassage über die
 * Szene bedeutet — bei vier Kaskaden also vier zusätzliche Durchläufe.
 * Auf schwacher Hardware muss das abschaltbar sein.
 *
 * ── Der Boden empfängt Schatten (seit 2026-08-02) ────────────────────
 * `TerrainSplat` ist ein NodeMaterial mit vollständig eigener
 * Beleuchtung; für den Schattenfaktor hängt dort ein `LightBlock`, von
 * dem nur der `shadow`-Ausgang benutzt wird.
 *
 * Dafür mussten VIER Fehler aus dem Weg (die ersten drei in
 * `SonnenSchattenBlock.ts` beschrieben, alle in Babylons
 * Einzellicht-Zweig, der systematisch vergisst, was der Mehrlicht-Zweig
 * tut):
 *   1. Define `SHADOWS` wurde nie gesetzt → Schattenfunktionen fielen
 *      komplett aus dem Shader.
 *   2. `view` wurde nicht deklariert → Vertex-Shader übersetzte nicht.
 *   3. `shadowTexture0` wurde nicht als Sampler angemeldet → landete auf
 *      Textureinheit 0 und machte das Terrain unsichtbar.
 *   4. Der vierte steckt HIER, nicht in Babylon: Ob das Terrain-Material
 *      mit Schattencode kompiliert wird, war ein WETTLAUF gegen den
 *      ShadowGenerator — je nachdem, ob der erste Chunk vorher oder
 *      nachher entsteht. Zweimal derselbe Start gemessen, einmal mit und
 *      einmal ohne `computeShadowCSM` im Shader. Babylon würde das
 *      selbst korrigieren, aber `main.ts` setzt
 *      `blockMaterialDirtyMechanism = true`, und `markAsDirty` steigt
 *      dann sofort wieder aus (`material.js:1151`). Behoben in
 *      `nodeMaterialsNeuUebersetzen()` weiter unten.
 *
 * ── Werfen und Empfangen sind getrennt ───────────────────────────────
 * Clutter ist von den WERFERN ausgenommen: Zehntausende Alpha-getestete
 * Halme durch vier Kaskaden zu schicken ist der teuerste denkbare Posten
 * und im Ergebnis kaum sichtbar. Valheims `InstanceRenderer` hat dafür
 * ein eigenes Flag (`m_shadowCasting`); wir setzen es für Gras auf aus.
 *
 * EMPFANGEN darf das Gras dagegen sehr wohl — das kostet nur eine
 * Abtastung im Fragment-Shader und keinen einzigen zusätzlichen
 * Zeichenaufruf. Ein Grasteppich, der unter der Baumkrone genauso hell
 * bleibt wie in der Sonne, ist einer der Hauptgründe für den flachen
 * Bildeindruck (Docs/07-Grafik-Konzept.md, Ursache B).
 */
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
// Ohne diesen Side-Effect-Import fehlt der Szene die Schattenkomponente
// (dieselbe Falle wie bei Physik und GeometryBuffer in diesem Projekt).
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Material } from '@babylonjs/core/Materials/material';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';

/** Die drei Original-Stufen, plus "Aus" an Index 0. */
export interface ShadowLevel {
  readonly kaskaden: number;
  readonly distanz: number;
  readonly aufloesung: number;
}

export const SHADOW_LEVELS: readonly (ShadowLevel | null)[] = [
  null, // Aus — nicht im Original, siehe Kopfkommentar
  { kaskaden: 2, distanz: 80, aufloesung: 512 },
  { kaskaden: 3, distanz: 120, aufloesung: 1024 },
  { kaskaden: 4, distanz: 150, aufloesung: 2048 },
];

/**
 * Meshes, die keinen Schatten WERFEN.
 *
 * - `clutter*`  Gras: jede Kaskade rendert die Werferliste komplett neu,
 *   und Clutter stellt mit Abstand die meisten Meshes. Empfangen darf es
 *   trotzdem — siehe NIE_EMPFANGEN.
 * - `valheimSky`/Himmelskuppel: Hintergrund, hat keine Tiefe
 * - `water*`: Wasseroberfläche wirft keinen brauchbaren Schatten. Das
 *   Präfix deckt Nahwasser (`water`) und Fernwasser-Ring (`waterRing`) ab.
 * - `precipEmitter`: unsichtbarer Knoten für die Partikel
 * - `avatar_`-Klötzchen: unsichtbare Ersatzfigur (siehe AvatarRig)
 * - `col_`: unsichtbare Kollisionsträger (EntityManager.rebuildBucketColliders).
 *   Sie tragen Ersatzformen — Kapseln und Hüllquader —, nicht die Silhouette
 *   des Objekts. `isVisible = false` hält sie derzeit aus dem Zeichenpfad
 *   heraus, sie standen aber trotzdem in der Werferliste und wurden dort
 *   dreimal je Frame durchgesehen. Aus der Liste heraus ist beides erledigt.
 */
const NIE_WERFEN = /^(clutter|valheimSky|sky|water|precipEmitter|col_|avatar_(hips|torso|head|leg|knee|arm|elbow))/i;

/**
 * Meshes, die keinen Schatten EMPFANGEN — dieselbe Liste OHNE `clutter`.
 *
 * Gras im Waldschatten ist ein Kernstück von Valheims Optik: Ein
 * Grasteppich, der unter einer Baumkrone genauso hell bleibt wie in der
 * prallen Sonne, ist einer der Hauptgründe, warum unser Bild flach wirkt
 * (Docs/07, Ursache B). Der Preis ist eine zusätzliche Schattenabtastung
 * pro Fragment — anders als beim Werfen entsteht dabei kein einziger
 * zusätzlicher Zeichenaufruf.
 *
 * Wasser bleibt bewusst aussen vor: Es ist transparent, liegt in einer
 * eigenen Rendergruppe und wird von einem Material-Plugin bespielt —
 * Schattenempfang dort ist ein eigener Schritt, kein Nebeneffekt.
 */
const NIE_EMPFANGEN = /^(valheimSky|sky|water|precipEmitter|avatar_(hips|torso|head|leg|knee|arm|elbow))/i;

/**
 * Prefabs, die bei abgeschalteten "fernen Schatten" nicht mehr werfen.
 *
 * Kleinzeug — Büsche, Zweige, Aufsammelbares, Blumen, Pilze, Stümpfe.
 * Ihr Schattenwurf ist im Bild kaum auszumachen, sie stellen aber einen
 * grossen Teil der Werferliste. Bäume, Felsen und Bauteile bleiben drin,
 * denn deren Schatten sind der eigentliche Gewinn.
 */
const KLEINZEUG = /bush|shrub|branch|berry|pickable|sapling|seed|shoot|flower|mushroom|stubbe|vines|grass/i;

/** Ab dieser Bewegung wird die Werferliste neu bestimmt (m). */
const NACHFUEHR_ABSTAND = 16;

/**
 * Zeitbudget pro Frame für den Werferlisten-Scan, in Millisekunden —
 * dasselbe Muster wie EntityManagers REBUILD_BUDGET_MS/GrassClutters
 * CELL_BUILD_BUDGET_MS. Der volle Scan über scene.meshes lief bisher
 * synchron in EINEM Aufruf von werferNeuBestimmen() — beim Sprinten
 * (alle NACHFUEHR_ABSTAND=16 m, ~2,1 s) ein unbudgetierter Vollscan
 * mitten im Frame.
 */
const WERFER_BUDGET_MS = 4;

export class Shadows {
  private generator: CascadedShadowGenerator | null = null;
  private stufe = 0;
  private fern = true;
  private letzteX = Number.NaN;
  private letzteZ = Number.NaN;
  /** Momentaufnahme für den laufenden inkrementellen Werfer-Scan, s. tick(). */
  private werferSnapshot: readonly AbstractMesh[] = [];
  private werferIndex = 0;
  private werferPending: AbstractMesh[] | null = null;
  private werferCfg: ShadowLevel | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly sonne: DirectionalLight
  ) {
    // Neue Meshes automatisch aufnehmen. Terrain-Zonen, Prefab-Master und
    // der Spieler entstehen über die gesamte Laufzeit verteilt; sie in
    // jedem Teilsystem einzeln anzumelden wäre eine Fehlerquelle, die man
    // beim nächsten neuen Mesh-Typ prompt vergisst.
    scene.onNewMeshAddedObservable.add((m) => {
      if (this.generator) this.nimmAuf(m);
    });
  }

  /**
   * Darf dieses Mesh werfen?
   *
   * Der teuerste Posten des ganzen Systems ist die Länge der
   * Werferliste: JEDE Kaskade rendert sie komplett erneut. Bei drei
   * Kaskaden und 761 Werfern sind das über zweitausend zusätzliche
   * Zeichenaufrufe pro Frame — gemessen 14 fps.
   *
   * Gefiltert wird auf zwei Wegen, weil unsere Meshes zwei Sorten sind:
   *
   *  - Meshes mit echter Position (Terrain-Zonen, bewegliche Objekte,
   *    der Spieler) fallen raus, sobald sie weiter weg sind als die
   *    Kaskadendistanz. Weiter draussen wirft ohnehin nichts mehr in
   *    das Bild hinein, was man sähe.
   *  - Prefab-Master mit Thin Instances liegen zwar im Ursprung, ihr
   *    Hüllkörper umfasst aber seit D10 alle Instanzen (Babylon spannt ihn
   *    in `thinInstanceSetBuffer` selbst auf, s. AssetManager.zuMaster).
   *    Damit gilt für sie DIESELBE Entfernungsprüfung wie für alles
   *    andere. Für die gestreute Vegetation ändert das nichts — ihre
   *    Instanzen reichen bis an den Rand des Streaming-Gebiets, die Hülle
   *    umschliesst den Spieler. Es greift bei den ortsfesten Bauwerken:
   *    Ein Grabhügel jenseits der Kaskadendistanz nimmt zehn Master mal
   *    Kaskadenzahl aus der Werferliste.
   */
  private darfWerfen(mesh: AbstractMesh, cfg: ShadowLevel): boolean {
    if (NIE_WERFEN.test(mesh.name)) return false;
    if (!this.fern && KLEINZEUG.test(mesh.name)) return false;
    // Abgeschaltete Meshes bleiben drin, ohne geprüft zu werden.
    //
    // Das sind genau die Master, deren Instanzen noch nicht da sind: Ihr
    // Hüllkörper beschreibt bis dahin nur die Rohgeometrie im
    // Weltursprung, und die Entfernung dorthin sagt nichts über die
    // spätere Lage der Instanzen. Sie kosten nichts — der Schattenpass
    // überspringt abgeschaltete Meshes (objectRenderer.js:695), und
    // EntityManager schaltet sie mit `setEnabled(count > 0)` genau dann
    // ein, wenn Instanzen existieren. Ohne diese Ausnahme fiele jeder
    // Master beim Einblenden aus der Werferliste und käme erst beim
    // nächsten Nachführen zurück (alle NACHFUEHR_ABSTAND Meter) — wer
    // sich beim Anmelden nicht bewegt, sähe zunächst keinen Schatten.
    if (!mesh.isEnabled()) return true;
    if (Number.isNaN(this.letzteX)) return true;
    const p = mesh.getBoundingInfo().boundingSphere.centerWorld;
    const r = mesh.getBoundingInfo().boundingSphere.radiusWorld;
    const d = Math.hypot(p.x - this.letzteX, p.z - this.letzteZ) - r;
    // Ohne ferne Schatten nur die halbe Kaskadendistanz.
    return d <= cfg.distanz * (this.fern ? 1 : 0.5);
  }

  /**
   * Spielerposition melden — bestimmt die Werferliste neu, wenn er sich
   * weit genug bewegt hat. Pro Frame neu zu filtern wäre teurer als der
   * Gewinn; NACHFUEHR_ABSTAND ist klein gegen die Kaskadendistanz.
   */
  setPlayerPosition(x: number, z: number): void {
    if (!this.generator) return;
    if (!Number.isNaN(this.letzteX) && Math.hypot(x - this.letzteX, z - this.letzteZ) < NACHFUEHR_ABSTAND) return;
    this.letzteX = x;
    this.letzteZ = z;
    this.werferNeuBestimmen();
  }

  /** Ferne Schatten (GraphicsSettingBool.DistantShadows im Original). */
  setDistantShadows(an: boolean): void {
    if (an === this.fern) return;
    this.fern = an;
    this.werferNeuBestimmen();
  }

  /**
   * Startet einen neuen Werferlisten-Scan — abgearbeitet wird er über
   * mehrere Frames in tick(), s. dort. Ein evtl. noch laufender Scan wird
   * verworfen: Die Spielerposition hat sich ohnehin schon wieder geändert,
   * sein Zwischenstand taugt nichts mehr.
   *
   * scene.meshes wird hier als Momentaufnahme kopiert statt live in tick()
   * durchlaufen — ein sich über mehrere Frames änderndes Array wäre eine
   * Fehlerquelle. Das ist unproblematisch: neu hinzukommende Meshes tragen
   * sich über nimmAuf()/addShadowCaster ohnehin sofort selbst in die
   * renderList ein und müssen hier nicht miterfasst werden.
   */
  private werferNeuBestimmen(): void {
    const cfg = SHADOW_LEVELS[this.stufe];
    if (!this.generator || !cfg) return;
    this.werferSnapshot = this.scene.meshes.slice();
    this.werferIndex = 0;
    this.werferPending = [];
    this.werferCfg = cfg;
  }

  /**
   * Einen Teil des laufenden Werferlisten-Scans abarbeiten, budgetiert
   * (s. WERFER_BUDGET_MS). Jeden Frame aus dem Game-Loop aufrufen; ohne
   * laufenden Scan ist der Aufruf ein No-op.
   */
  tick(): void {
    if (!this.werferPending || !this.generator || !this.werferCfg) return;
    const karte = this.generator.getShadowMap();
    if (!karte) {
      this.werferPending = null;
      return;
    }
    const budgetEnde = performance.now() + WERFER_BUDGET_MS;
    let geprueft = 0;
    while (this.werferIndex < this.werferSnapshot.length) {
      if (geprueft > 0 && performance.now() >= budgetEnde) return;
      const m = this.werferSnapshot[this.werferIndex]!;
      if (this.darfWerfen(m, this.werferCfg)) this.werferPending.push(m);
      this.werferIndex++;
      geprueft++;
    }
    karte.renderList = this.werferPending;
    this.werferPending = null;
    this.werferSnapshot = [];
  }

  /**
   * Diagnose: Wie viele Werfer stehen in der Liste?
   *
   * Zusammen mit kaskaden() ergibt das den Schattenanteil an den
   * Zeichenaufrufen — jede Kaskade rendert die Liste komplett neu. Genau
   * dieses Produkt ist der Posten, den D10 untersucht, und ohne die Zahl
   * lässt sich von aussen nicht nachsehen, ob eine Änderung ihn bewegt
   * (s. `__vb.profil()` in main.ts).
   */
  werferAnzahl(): number {
    return this.generator?.getShadowMap()?.renderList?.length ?? 0;
  }

  /** Diagnose: Kaskaden der aktuellen Stufe, 0 wenn Schatten aus sind. */
  kaskaden(): number {
    return this.generator ? (SHADOW_LEVELS[this.stufe]?.kaskaden ?? 0) : 0;
  }

  /**
   * Empfangen ist NICHT an Werfen gekoppelt.
   *
   * Vorher hing beides an `darfWerfen()`: eine Terrain-Zone, die beim
   * Entstehen jenseits der Kaskadendistanz lag, bekam nie
   * `receiveShadows = true` — und `werferNeuBestimmen()` setzt beim
   * Näherkommen nur die `renderList` neu, ruft `nimmAuf()` aber nie
   * erneut. Der Boden blieb damit dauerhaft schattenlos, sobald er
   * einmal zu weit weg erzeugt worden war; genau das passiert beim
   * Streaming ständig.
   *
   * Empfangen kostet auch nichts Nennenswertes: eine zusätzliche
   * Abtastung im Fragment-Shader, und nur dort, wo eine Kaskade den
   * Pixel überhaupt abdeckt. Es gibt deshalb keinen Grund, es nach
   * Entfernung zu filtern.
   */
  /**
   * NodeMaterials nach dem Anlegen des Generators zum Neuübersetzen zwingen.
   *
   * Ohne das ist der Bodenschatten ein WETTLAUF: Ob das Terrain-Material
   * mit oder ohne Schattencode kompiliert wird, hängt davon ab, ob der
   * erste Chunk vor oder nach dem ShadowGenerator entsteht. Zweimal
   * derselbe Startvorgang gemessen, einmal war `computeShadowCSM` im
   * Fragment-Shader, einmal nicht.
   *
   * Normalerweise korrigiert Babylon das selbst: Ein neuer
   * ShadowGenerator ruft `light._markMeshesAsLightDirty()`. Bei uns läuft
   * das aber ins Leere, weil `main.ts` `scene.blockMaterialDirtyMechanism
   * = true` setzt (Sparmaßnahme gegen Shader-Neuübersetzungen beim
   * Weltaufbau). Das Terrain-NodeMaterial bleibt dann für immer in der
   * Fassung, die es beim allerersten Chunk bekommen hat.
   *
   * Deshalb hier gezielt und nur für NodeMaterials — StandardMaterial und
   * PBR reagieren ohnehin über den normalen Pfad, und ein pauschales
   * `markAllMaterialsAsDirty` würde beim Weltaufbau genau die
   * Neuübersetzungen auslösen, die `blockMaterialDirtyMechanism`
   * verhindern soll.
   */
  private nodeMaterialsNeuUebersetzen(): void {
    // `markAsDirty` steigt bei blockiertem Mechanismus SOFORT wieder aus
    // (`material.js:1151`) — ein Aufruf ohne dieses Aufheben ist
    // wirkungslos und war es hier auch, bis es gemessen wurde. Die
    // Blockade gilt nur für die paar Zeilen dazwischen.
    const blockiert = this.scene.blockMaterialDirtyMechanism;
    this.scene.blockMaterialDirtyMechanism = false;
    try {
      for (const m of this.scene.materials) {
        if (m.getClassName() === 'NodeMaterial') m.markAsDirty(Material.LightDirtyFlag);
      }
    } finally {
      this.scene.blockMaterialDirtyMechanism = blockiert;
    }
  }

  private darfEmpfangen(mesh: AbstractMesh): boolean {
    // `receiveShadows` auf einer InstancedMesh ist wirkungslos — das
    // Empfangen entscheidet die Quell-Mesh. Babylon warnt darüber einmal
    // pro Aufruf, was beim Weltaufbau über hundert Zeilen Konsolenrauschen
    // erzeugt hat.
    if (mesh.getClassName() === 'InstancedMesh') return false;
    return !NIE_EMPFANGEN.test(mesh.name);
  }

  private nimmAuf(mesh: AbstractMesh): void {
    if (!this.generator) return;
    const cfg = SHADOW_LEVELS[this.stufe];
    if (!cfg) return;
    if (this.darfEmpfangen(mesh)) mesh.receiveShadows = true;
    if (this.darfWerfen(mesh, cfg)) this.generator.addShadowCaster(mesh, false);
  }

  /** Stufe setzen (Index in SHADOW_LEVELS). */
  setLevel(stufe: number): void {
    const i = Math.max(0, Math.min(SHADOW_LEVELS.length - 1, stufe));
    if (i === this.stufe && (i === 0) === (this.generator === null)) return;
    this.stufe = i;
    const cfg = SHADOW_LEVELS[i];

    if (!cfg) {
      this.abbauen();
      return;
    }
    // Auflösung lässt sich nachträglich nicht ändern — bei einem Wechsel
    // wird neu angelegt statt umkonfiguriert.
    this.abbauen();

    const g = new CascadedShadowGenerator(cfg.aufloesung, this.sonne);
    g.numCascades = cfg.kaskaden;
    g.shadowMaxZ = cfg.distanz;
    // Kaskadengrenzen an der Kamera ausrichten statt an der Weltachse:
    // Ohne das wandern die Schattenkanten beim Drehen sichtbar.
    g.stabilizeCascades = true;
    // `autoCalcDepthBounds` BEWUSST AUS: Es klingt richtig (der
    // Tiefenbereich passt sich dem Gelände an), zieht aber einen
    // zusätzlichen Tiefen-Renderpass über die ganze Szene nach sich —
    // bei unserer Draw-Call-Lage der falsche Handel.
    g.autoCalcDepthBounds = false;
    // PCF war hier abgeschaltet, weil es mit dem Terrain-NodeMaterial
    // nicht übersetzte:
    //
    //   FRAGMENT SHADER ERROR: 'computeShadowWithCSMPCF1'
    //   : no matching overloaded function found
    //
    // Die ursprüngliche Diagnose ("PCF übersetzt mit NodeMaterial nicht")
    // war im Ergebnis richtig, in der Begründung aber unvollständig — und
    // sie verdeckte einen zweiten, schwerwiegenderen Fehler:
    //
    //  1. `computeShadowWithCSMPCF1` fehlte, WEIL das Define `SHADOWS`
    //     fehlte: Babylon setzt es nur im Mehrlicht-Pfad von
    //     `LightBlock.prepareDefines`, und sobald `.light` gesetzt ist —
    //     wie im Terrain — fällt `shadowsFragmentFunctions` komplett aus
    //     dem Shader. `computeShadowCSM` fehlte genauso, weshalb das
    //     Terrain auch OHNE PCF nie Schatten empfangen hat. Das blieb
    //     unbemerkt, weil `shadowQuality` ohnehin auf 0 stand. Behoben in
    //     SonnenSchattenBlock.ts.
    //
    //  2. Mit repariertem Define übersetzt PCF zwar, erzeugt dann aber
    //     einen VERGLEICHS-Sampler:
    //
    //         uniform sampler2DArrayShadow shadowTexture0;
    //
    //     und der verträgt sich im NodeMaterial nicht mit den 20 normalen
    //     `sampler2D` des Splattings. Gemessen beim Weltaufbau:
    //
    //         GL_INVALID_OPERATION: glDrawElements: Two textures of
    //         different types use the same sampler location
    //
    //     (256 Meldungen, danach greift WebGLs Meldelimit; mit
    //     `shadowQuality 0` exakt null). Die Folge im Bild ist genau das,
    //     was der ursprüngliche Kommentar beschrieb: Das Terrain verliert
    //     seine Texturen. Ohne PCF ist es ein gewöhnlicher
    //     `sampler2DArray` und der Konflikt entfällt.
    //
    // Seit die Sampler-Anmeldung repariert ist (SonnenSchattenBlock.ts,
    // Punkt 3), liegt `shadowTexture0` auf einer eigenen Textureinheit —
    // damit ist auch der Vergleichssampler von PCF unproblematisch, und
    // PCF ist wieder an.
    //
    // Es ist zugleich der billigste Weg gegen pixelige Schattenkanten:
    // PCF vergleicht in der Hardware mehrere Tiefenwerte auf einmal
    // (`sampler2DArrayShadow`), statt einen einzelnen Texel hart gegen die
    // Fragmenttiefe zu prüfen. Die Alternative — höhere Kaskadenauflösung —
    // kostet Speicher UND Füllrate, PCF nur ein paar Taps.
    //
    // QUALITY_MEDIUM ist PCF3 (3×3-Kernel). QUALITY_HIGH (PCF5) glättet
    // etwas mehr, ist aber bei 1024er-Kaskaden kaum noch zu sehen und
    // kostet gut die doppelte Zahl Abtastungen.
    g.usePercentageCloserFiltering = true;
    g.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
    // Selbstverschattung ("shadow acne") an flachen Böschungen vermeiden.
    g.bias = 0.005;
    g.normalBias = 0.02;
    // ── `refreshRate` IST HIER WIRKUNGSLOS — gemessen 17.08.2026 ────────
    //
    // Hier stand `karte.refreshRate = 2` ("Schattenkarte nur jeden zweiten
    // Frame neu zeichnen") mit einer Messung vom 02.08.2026 als Beleg:
    //
    //   refreshRate 1 (jeden Frame)     1134 Zeichenaufrufe  20,6 ms  43 fps
    //   refreshRate 2 (jeden zweiten)    912 Zeichenaufrufe  17,6 ms  53 fps
    //
    // Die Zeile ist entfernt, weil sie NICHTS TUT. Nachgezählt, statt die
    // Frame-Zeit zu vergleichen — die Zählung ist eindeutig, der Zeitvergleich
    // war es nie:
    //
    //   const o = karte.onBeforeRenderObservable.add(() => schatten++);
    //   … über 120 Bilder …
    //
    //   refreshRate 2   120 Bilder   360 Schattendurchläufe   3,0 je Bild
    //   refreshRate 1   120 Bilder   360 Schattendurchläufe   3,0 je Bild
    //   refreshRate 2   120 Bilder   360 Schattendurchläufe   3,0 je Bild
    //
    // Drei Durchläufe je Bild sind genau die drei Kaskaden der Stufe
    // "Mittel" — die Karte wird also in JEDEM Bild vollständig neu
    // gezeichnet, egal was in `refreshRate` steht. Der gelesene Wert
    // stimmt dabei mit dem gesetzten überein; es ist kein Tippfehler,
    // sondern der `CascadedShadowGenerator` rendert seine Kaskaden an der
    // Auslassprüfung der RenderTargetTexture vorbei.
    //
    // Was das für die alte Messung heisst, ist offen: Entweder hat sie
    // etwas anderes gemessen, oder Babylons Verhalten hat sich seither
    // geändert. Belastbar ist nur die Zählung oben, und die schliesst die
    // Sparmassnahme aus.
    //
    // ⚠ FOLGE FÜR DIE FEHLERSUCHE: Die Schattenkarte ist damit NIE einen
    // Frame alt. Der naheliegende Verdacht bei flackernden Schatten —
    // "der Wurf hinkt der bewegten Figur um ein Bild hinterher" — ist
    // damit ausgeschlossen, und zwar für die Figur wie für das Laub.
    // Siehe Docs/07-Grafik-Konzept.md, "Flimmern: es sind nicht die
    // Schatten".
    //
    // Wer den Schattenpass wirklich verbilligen will, muss an der LÄNGE
    // der Werferliste ansetzen (darfWerfen weiter oben) oder an der
    // Kaskadenzahl — nicht an der Bildrate der Karte.
    this.generator = g;

    for (const m of this.scene.meshes) this.nimmAuf(m);
    this.nodeMaterialsNeuUebersetzen();
    this.werferNeuBestimmen();
  }

  private abbauen(): void {
    if (!this.generator) return;
    this.generator.dispose();
    this.generator = null;
    for (const m of this.scene.meshes) {
      if (m.getClassName() !== 'InstancedMesh') m.receiveShadows = false;
    }
  }

  /** Für die Diagnoseanzeige. */
  get info(): string {
    const cfg = SHADOW_LEVELS[this.stufe];
    if (!cfg) return 'aus';
    const n = this.generator?.getShadowMap()?.renderList?.length ?? 0;
    return `${cfg.kaskaden}x ${cfg.distanz}m ${cfg.aufloesung}px (${n} werfer${this.fern ? '' : ', nah'})`;
  }

  dispose(): void {
    this.abbauen();
  }
}
