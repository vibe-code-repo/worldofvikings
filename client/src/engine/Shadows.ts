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
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { huellkoerperAufweiten, zellMeshAusPrototyp } from '../entities/EntityManager';
import {
  NEUPACK_ABSTAND,
  konservativerAuswahlRadius,
  packeInstanzenRadial,
  quantisiereRadius,
} from './SchattenInstanzKeulung';

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
  // Hoechste Stufe: 4096 statt 2048 — gemessen 17.08.2026 nachts gegen das
  // Kriseln des Bodenschattens (E15). Vierfache Texelzahl auf gleicher
  // Flaeche, also die Dichte von 75 m bei 2048, nur mit VOLLEN Fernschatten.
  //
  //   2048 / lambda 0,5 / stabilisiert   2,77 %   p50  9,40 ms   p95 10,70 ms
  //   2048 / lambda 0,8 / frei           1,22 %   p50  9,50 ms   p95 12,20 ms
  //   4096 / lambda 0,8 / frei           0,87 %   p50  9,60 ms   p95 10,90 ms
  //   2048 /  80 m / lambda 0,8 / frei   1,16 %   p50 10,30 ms   p95 12,20 ms
  //
  // (Anteil Bildpunkte mit dunklem Einbruch im Bodenausschnitt, Wind aus,
  //  Sonne laeuft. Der Ausgangswert stammt aus EINER Runde — die zweite war
  //  durch eine nicht gegriffene Ruecksetzung verdorben; die drei anderen
  //  Zellen sind je n=2 und liegen innerhalb 0,1 Prozentpunkt.)
  //
  // Die vierfache Karte kostet +0,1 ms und ist im p95 sogar besser. Sie
  // kostet aber VRAM: vier Kaskaden a 4096^2 sind grob 270 MB statt 67.
  // Deshalb NUR auf dieser hoechsten Stufe — wer sie waehlt, hat die Karte
  // dafuer. Stufe 1 und 2 bleiben unberuehrt.
  //
  // Bewusst KEIN eigener Regler: shadowQuality IST der Regler. Auflösung,
  // lambda und Stabilisierung sind Interna, die einmal gemessen und dann
  // festgeschrieben gehoeren — kein Spieler kann sie im Bild beurteilen.
  // ⚠ 17.08.2026, ZURUECKGENOMMEN: Hier stand kurzzeitig 4096 (gegen das
  // Kriseln des Bodenschattens, E15). Gemessen wurde das im Wald bei 141
  // Werfern: +0,1 ms, im p95 sogar besser. Auf der neuen Insel bei 10077 /
  // -18723 (214 Werfer, dichtes Gras) kostet dieselbe Aenderung
  //
  //   4096  67,1 ms p50 (15 fps)
  //   1024  31,5 ms p50 (22 fps)
  //   aus   13,1 ms p50 (49 fps)
  //
  // also rund 36 ms — mehr als das halbe Bild. Der Mechanismus ist nicht
  // das Zeichnen der Karte, sondern ihr ABTASTEN: Gras ist alphagetestet
  // und massiv ueberzeichnet, und jedes Fragment schlaegt in der
  // Kaskadenkarte nach. Bei 4096^2 mal vier Kaskaden faellt das aus jedem
  // Cache. Gegenprobe: Gras aus senkt dieselbe Szene von 67,1 auf 21,6 ms,
  // bei ausgeschalteten Schatten kostet Gras nur 3,4 ms.
  //
  // Lehre, die ueber diesen Fall hinausgeht: Eine Messung an EINEM Ort ist
  // keine Messung fuer die Welt. Der Wald war die falsche Probe fuer eine
  // Aenderung, die mit Werferzahl und Grasdichte skaliert.
  { kaskaden: 4, distanz: 150, aufloesung: 2048 },
];

/**
 * Schattenfassung des 100-FPS-Profils.
 *
 * Zwei Kaskaden und 80 m halten die Draw-Call-Seite des gemessenen Profils
 * unverändert. 1024 statt 512 Pixel verdoppeln die Texeldichte gegen das
 * Kriechen feiner Blattschatten; die Kaskaden werden zusätzlich am
 * Texelraster stabilisiert. Bewusst getrennt von SHADOW_LEVELS[1], damit
 * die normale Stufe "Niedrig" beim Abschalten exakt unverändert zurückkommt.
 */
const HUNDERT_FPS_SCHATTEN: ShadowLevel = { kaskaden: 2, distanz: 80, aufloesung: 1024 };

/** Reine Profilzuordnung — getrennt testbar, ohne WebGL-ShadowGenerator. */
export function schattenKonfiguration(stufe: number, hundertFpsProfil: boolean): ShadowLevel | null {
  if (hundertFpsProfil && stufe === 1) return HUNDERT_FPS_SCHATTEN;
  return SHADOW_LEVELS[stufe] ?? null;
}

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
 * - `impostor*`: das Sprite-Fernfeld der Vegetation (BaumImpostor.ts) und
 *   seine Backmeshes. Ein Billboard ist aus Sonnenrichtung eine papierdünne
 *   Fläche — sein Schatten wäre je nach Sonnenstand entweder verschwunden
 *   oder ein Streifen quer über die Landschaft. Nötig ist er ohnehin nicht:
 *   Die Sprites beginnen erst bei 240 m, die höchste Kaskade reicht 150 m.
 *   ⚠ Dieser Eintrag ist die EINZIGE wirksame Absicherung. `receiveShadows`
 *   und die Sichtbarkeitsflags halten ein Mesh NICHT aus der Werferliste —
 *   werferNeuBestimmen() scannt scene.meshes und filtert allein über diesen
 *   auf `^` verankerten Regex.
 */
const NIE_WERFEN =
  /^(clutter|impostor|valheimSky|sky|water|precipEmitter|col_|avatar_(hips|torso|head|leg|knee|arm|elbow))/i;

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
const SCHATTEN_VEGETATION_PRAEFIX = 'schattenVegetation_';

const NIE_EMPFANGEN = /^(schattenVegetation_|valheimSky|sky|water|precipEmitter|avatar_(hips|torso|head|leg|knee|arm|elbow))/i;

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
 *
 * ── Nachgerechnet für den Zellschnitt (E19 c), bleibt bei 4 ────────
 * Der Schnitt vervielfacht die Zahl der Meshes in der Szene: aus rund
 * 58 Prefab-Mastern einer Grasland-Sitzung werden je nach Streuung
 * mehrere hundert bis wenige tausend Zell-Master (128-m-Zellen, dazu
 * abgeschaltete Master im Pool). Ein Scanschritt ist zwei Regex-Tests
 * plus eine Hüllkugel-Abfrage, in der Grössenordnung einer
 * Zehntel-Mikrosekunde bis Mikrosekunde — 4 ms reichen damit für
 * mehrere tausend Meshes, der Scan bleibt bei ein bis zwei Frames.
 *
 * Angehoben wird deshalb NICHT. Das Budget begrenzt nicht die
 * Gesamtdauer, sondern wie viel davon in EINEN Frame fällt; ein
 * grösserer Wert schöbe mehr Arbeit in genau den Frame, in dem der
 * Spieler gerade 16 m gelaufen ist. Die Gegenrechnung: Zwischen zwei
 * Scans liegen bei Sprinttempo rund 130 Frames, ein Scan über zwei
 * Frames ist dagegen nichts. Wenn der Zellschnitt die Meshzahl
 * wesentlich über die hier angenommene Grössenordnung treibt, gehört
 * nicht dieses Budget angehoben, sondern der Scan auf die
 * Zellstruktur gezogen statt über scene.meshes.
 */
const WERFER_BUDGET_MS = 4;

interface VegetationsSchattenMaster {
  readonly quelle: Mesh;
  readonly schatten: Mesh;
  /** Fertiger local×world-Puffer des sichtbaren Masters. */
  matrizen: Float32Array | null;
  ziel: Float32Array;
  gesamt: number;
  aktiv: number;
  /** Aus der instanzlosen, unverfälschten Klon-Hülle. */
  readonly modellHoehe: number;
  readonly modellRadius: number;
  /** Größte Skalierung im aktuellen Puffer. */
  maxSkala: number;
  gepackterRadius: number;
  bereit: boolean;
}

export class Shadows {
  private generator: CascadedShadowGenerator | null = null;
  private stufe = 0;
  private hundertFpsProfil = false;
  private fern = true;
  private letzteX = Number.NaN;
  private letzteZ = Number.NaN;
  /** Momentaufnahme für den laufenden inkrementellen Werfer-Scan, s. tick(). */
  private werferSnapshot: readonly AbstractMesh[] = [];
  private werferIndex = 0;
  private werferPending: AbstractMesh[] | null = null;
  /**
   * Begleitmenge zu werferPending — gegen Doppeleintraege.
   *
   * Review-Fund 18.08., mit NullEngine belegt: scene.addMesh() pusht
   * SYNCHRON in scene.meshes, onNewMeshAddedObservable feuert aber erst
   * ueber Tools.SetImmediate (scene.js:2237). Ein zwischen Konstruktion
   * und Benachrichtigung gestarteter Scan traegt das Mesh also aus der
   * Momentaufnahme ein UND nimmAuf() pusht es beim verspaeteten Feuern
   * erneut — _activate() dedupliziert nicht, der Sub-Mesh wird je Kaskade
   * zweimal dispatcht. Ein Set statt includes(), weil includes() bei
   * tausenden Meshes im budgetierten Scan eine O(n^2)-Falle waere.
   */
  private werferPendingSet: Set<AbstractMesh> | null = null;
  private werferCfg: ShadowLevel | null = null;
  /**
   * E26: Sichtbares Vegetationsmesh und Schattenmesh besitzen absichtlich
   * verschiedene Geometrien. `mesh.clone()` wäre hier falsch: Babylons
   * Thin-Instance-Puffer hängen an der Geometry und überschrieben beim
   * ersten Anlauf dadurch den Farbpuffer — ganze Bäume verschwanden.
   */
  private readonly vegetationsSchatten = new Map<Mesh, VegetationsSchattenMaster>();
  private readonly vegetationsQuellen = new Set<AbstractMesh>();
  private readonly vegetationsKlone = new Set<AbstractMesh>();
  private readonly vegetationsPackPending = new Set<VegetationsSchattenMaster>();
  private vegetationsInstanzKeulung = true;

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

  private konfiguration(stufe = this.stufe): ShadowLevel | null {
    return schattenKonfiguration(stufe, this.hundertFpsProfil);
  }

  /** Profil-spezifische Texeldichte und Kaskadenstabilisierung umschalten. */
  setHundertFpsProfil(an: boolean): void {
    if (an === this.hundertFpsProfil) return;
    this.hundertFpsProfil = an;
    // Die Kartenauflösung ist nachträglich unveränderlich. setLevel muss
    // deshalb auch bei gleicher sichtbarer Stufe den Generator neu bauen.
    const stufe = this.stufe;
    this.stufe = -1;
    this.setLevel(stufe);
  }

  /**
   * Fertigen Thin-Instance-Puffer eines gestreuten Vegetationsmasters
   * übernehmen. Der EntityManager ruft das nach JEDEM Neuaufbau auf; so
   * kann der Schattenpuffer nie hinter Streaming oder Profilwechseln
   * zurückbleiben.
   */
  setVegetationsInstanzen(quelle: Mesh, matrizen: Float32Array | null): void {
    let stand = this.vegetationsSchatten.get(quelle);
    if (!stand) {
      // zellMeshAusPrototyp extrahiert VertexData in eine EIGENE Geometry.
      // Genau das fehlte im verworfenen Klon-Anlauf, dessen clone()/
      // applyToMesh-Weg die Instanzpuffer der sichtbaren Bäume überschrieb.
      const schatten = zellMeshAusPrototyp(
        quelle,
        `${SCHATTEN_VEGETATION_PRAEFIX}${quelle.uniqueId}_${quelle.name}`,
        this.scene
      );
      schatten.layerMask = 0; // nie im Farbbild, nur in expliziter Werferliste
      schatten.receiveShadows = false;
      schatten.alwaysSelectAsActiveMesh = true;
      schatten.setEnabled(false);
      const bb = schatten.getBoundingInfo().boundingBox;
      const bs = schatten.getBoundingInfo().boundingSphere;
      stand = {
        quelle,
        schatten,
        matrizen: null,
        ziel: new Float32Array(0),
        gesamt: 0,
        aktiv: 0,
        modellHoehe: Math.max(
          Math.abs(bb.minimum.y),
          Math.abs(bb.maximum.y),
          bb.maximum.y - bb.minimum.y
        ),
        modellRadius: bs.radius,
        maxSkala: 1,
        gepackterRadius: Number.NaN,
        bereit: false,
      };
      this.vegetationsSchatten.set(quelle, stand);
      this.vegetationsKlone.add(schatten);
    }

    stand.matrizen = matrizen;
    stand.gesamt = (matrizen?.length ?? 0) / 16;
    // Bis der neue Puffer steht, wirft die Quelle weiter. Das verhindert
    // die wandernden schattenlosen Bäume des ersten Anlaufs vollständig.
    if (this.vegetationsInstanzKeulung) {
      stand.bereit = false;
      stand.schatten.setEnabled(false);
      this.vegetationsQuellen.delete(quelle);
      this.nimmAuf(quelle);
      this.vegetationsPackPending.add(stand);
    }
  }

  /** Laufzeit-A/B: false stellt ohne Reload die unveränderten Quellen her. */
  setVegetationsInstanzKeulung(an: boolean): void {
    if (an === this.vegetationsInstanzKeulung) return;
    this.vegetationsInstanzKeulung = an;
    this.vegetationsPackPending.clear();
    for (const stand of this.vegetationsSchatten.values()) {
      if (an) {
        stand.bereit = false;
        this.vegetationsPackPending.add(stand);
      } else {
        this.vegetationsQuellen.delete(stand.quelle);
        this.entferneWerfer(stand.schatten);
        stand.schatten.setEnabled(false);
        stand.bereit = false;
        this.nimmAuf(stand.quelle);
      }
    }
    this.werferNeuBestimmen();
  }

  private maximaleSkala(matrizen: Float32Array): number {
    let max = 1;
    for (let o = 0; o < matrizen.length; o += 16) {
      max = Math.max(
        max,
        Math.hypot(matrizen[o]!, matrizen[o + 1]!, matrizen[o + 2]!),
        Math.hypot(matrizen[o + 4]!, matrizen[o + 5]!, matrizen[o + 6]!),
        Math.hypot(matrizen[o + 8]!, matrizen[o + 9]!, matrizen[o + 10]!)
      );
    }
    return max;
  }

  private auswahlRadius(stand: VegetationsSchattenMaster): number {
    const cfg = this.konfiguration();
    if (!cfg) return 0;
    const kamera = this.scene.activeCamera;
    const fov = kamera?.fov ?? Math.PI / 3;
    const aspect = kamera ? this.scene.getEngine().getAspectRatio(kamera) : 16 / 9;
    const d = this.sonne.direction;
    return quantisiereRadius(konservativerAuswahlRadius(
      cfg.distanz,
      fov,
      aspect,
      d.x,
      d.y,
      d.z,
      stand.modellHoehe * stand.maxSkala,
      stand.modellRadius * stand.maxSkala
    ));
  }

  private packeVegetationsMaster(stand: VegetationsSchattenMaster): void {
    if (!this.vegetationsInstanzKeulung) return;
    const daten = stand.matrizen;
    if (!daten || daten.length === 0) {
      stand.schatten.thinInstanceSetBuffer('matrix', null, 16, false);
      stand.schatten.setEnabled(false);
      stand.aktiv = 0;
      stand.maxSkala = 1;
      stand.gepackterRadius = 0;
    } else {
      if (stand.ziel.length < daten.length) stand.ziel = new Float32Array(daten.length);
      stand.maxSkala = this.maximaleSkala(daten);
      const radius = this.auswahlRadius(stand);
      const x = Number.isNaN(this.letzteX) ? 0 : this.letzteX;
      const z = Number.isNaN(this.letzteZ) ? 0 : this.letzteZ;
      const n = Number.isFinite(radius)
        ? packeInstanzenRadial(daten, daten.length / 16, x, z, radius, stand.ziel)
        : daten.length / 16;
      const puffer = Number.isFinite(radius) ? stand.ziel : daten;
      stand.schatten.thinInstanceSetBuffer(
        'matrix',
        n > 0 ? puffer.subarray(0, n * 16) : null,
        16,
        false
      );
      if (n > 0) huellkoerperAufweiten(stand.schatten);
      stand.schatten.setEnabled(n > 0);
      stand.aktiv = n;
      stand.gepackterRadius = radius;
    }

    // Erst NACH vollständigem Pufferwechsel umschalten: Es gibt in keinem
    // Frame eine Lücke zwischen sichtbarer Quelle und Schattenklon.
    this.vegetationsQuellen.add(stand.quelle);
    this.entferneWerfer(stand.quelle);
    this.nimmAuf(stand.schatten);
    stand.bereit = true;
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
   *    andere. Bis D10 griff das nur bei den ortsfesten Bauwerken: Ein
   *    Grabhügel jenseits der Kaskadendistanz nimmt zehn Master mal
   *    Kaskadenzahl aus der Werferliste.
   *
   * ── Seit dem Zellschnitt greift es auch bei der Vegetation (E19 c) ──
   * Hier stand: „Für die gestreute Vegetation ändert das nichts — ihre
   * Instanzen reichen bis an den Rand des Streaming-Gebiets, die Hülle
   * umschliesst den Spieler." Das stimmte und war der Befund: Bei
   * `leaves_merged` mit 425 m Hülle (r ≈ 212 m) ist `d` unten für jede
   * Kaskadendistanz negativ, die Prüfung KANN nicht greifen — auf der
   * Insel erreichten deshalb nur 14–15 % der eingereichten
   * Vegetationsinstanzen je Kaskade die Schattenkarte (E20).
   *
   * EntityManager verteilt die Instanzen jetzt auf einen Master je
   * 128-m-Zelle (RENDER_ZELLE_M). Deren Hüllradius liegt bei rund 90 m
   * plus Kronenhöhe, `d` wird endlich positiv, und ferne Zellen fallen
   * hier heraus — ohne dass an dieser Funktion etwas zu ändern war.
   *
   * Zwei Nebenwirkungen, die man beim Messen kennen muss: Die
   * abgeschalteten Zell-Master (leer bzw. im Pool) bleiben nach der
   * Regel unten ungeprüft in der Liste stehen, `werferAnzahl()` ist
   * damit allein kein Mass mehr — die belastbare Zahl liefert
   * EntityManager.zellStats().aktiv.
   */
  private darfWerfen(mesh: AbstractMesh, cfg: ShadowLevel): boolean {
    // Entsorgte Meshes ZUERST — vor dem Freifahrtschein fuer Abgeschaltete.
    // Review-Fund 18.08.: entferneWerfer() raeumt renderList und
    // werferPending, aber nicht die Momentaufnahme eines laufenden Scans
    // (werferSnapshot). Ohne diesen Guard nahm ein wahrend des Scans
    // entsorgter Zell-Master den !isEnabled-Zweig ("return true") und lag
    // danach als Leiche in der Schattenkarte — je Kaskade je Bild durch
    // isReady()/getLOD(), bis zum naechsten Nachfuehren.
    if (mesh.isDisposed()) return false;
    if (this.vegetationsInstanzKeulung && this.vegetationsQuellen.has(mesh)) return false;
    if (!this.vegetationsInstanzKeulung && this.vegetationsKlone.has(mesh)) return false;
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
    const erste = Number.isNaN(this.letzteX);
    const bewegt = erste || Math.hypot(x - this.letzteX, z - this.letzteZ) >= NACHFUEHR_ABSTAND;
    if (bewegt) {
      this.letzteX = x;
      this.letzteZ = z;
      if (this.vegetationsInstanzKeulung) {
        for (const stand of this.vegetationsSchatten.values()) {
          this.vegetationsPackPending.add(stand);
        }
      }
    }

    // Die Sonne wandert auch im Stand. Nur wenn der konservativ
    // AUFGERUNDETE Radius eine 16-m-Stufe wechselt, wird neu gepackt.
    // Wächst er, wirft bis zum fertigen Klon die vollständige Quelle.
    let radiusGeaendert = false;
    if (this.vegetationsInstanzKeulung) {
      for (const stand of this.vegetationsSchatten.values()) {
        if (!stand.bereit || stand.matrizen === null) continue;
        const radius = this.auswahlRadius(stand);
        if (radius === stand.gepackterRadius) continue;
        radiusGeaendert = true;
        if (radius > stand.gepackterRadius) {
          stand.schatten.setEnabled(false);
          stand.bereit = false;
          this.vegetationsQuellen.delete(stand.quelle);
          this.nimmAuf(stand.quelle);
        }
        this.vegetationsPackPending.add(stand);
      }
    }
    if (!bewegt && !radiusGeaendert) return;
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
    const cfg = this.konfiguration();
    if (!this.generator || !cfg) return;
    this.werferSnapshot = this.scene.meshes.slice();
    this.werferIndex = 0;
    this.werferPending = [];
    this.werferPendingSet = new Set();
    this.werferCfg = cfg;
  }

  /**
   * Einen Teil des laufenden Werferlisten-Scans abarbeiten, budgetiert
   * (s. WERFER_BUDGET_MS). Jeden Frame aus dem Game-Loop aufrufen; ohne
   * laufenden Scan ist der Aufruf ein No-op.
   */
  tick(): void {
    if (!this.generator) return;
    const budgetEnde = performance.now() + WERFER_BUDGET_MS;

    // Schattenpuffer und Werfer-Scan teilen sich EIN Zeitbudget. Ein
    // einzelner Master wird immer fertiggestellt; danach darf der Rest in
    // den Folgeframe. So wird aus dem Gewinn kein Sprint-Ruckler.
    // Vor der ersten gemeldeten Spielerposition bleibt die vollständige
    // Quelle der Fallback. Gegen (0, 0) zu packen würde beim Weltstart für
    // einige Bilder die falschen Instanzen auswählen.
    if (this.vegetationsPackPending.size > 0 && Number.isNaN(this.letzteX)) return;
    let gepackt = 0;
    while (this.vegetationsPackPending.size > 0) {
      if (gepackt > 0 && performance.now() >= budgetEnde) return;
      const stand = this.vegetationsPackPending.values().next().value as
        | VegetationsSchattenMaster
        | undefined;
      if (!stand) break;
      this.vegetationsPackPending.delete(stand);
      this.packeVegetationsMaster(stand);
      gepackt++;
    }

    if (!this.werferPending || !this.werferCfg) return;
    const karte = this.generator.getShadowMap();
    if (!karte) {
      this.werferPending = null;
      return;
    }
    let geprueft = 0;
    while (this.werferIndex < this.werferSnapshot.length) {
      if (geprueft > 0 && performance.now() >= budgetEnde) return;
      const m = this.werferSnapshot[this.werferIndex]!;
      if (this.darfWerfen(m, this.werferCfg) && !this.werferPendingSet!.has(m)) {
        this.werferPending.push(m);
        this.werferPendingSet!.add(m);
      }
      this.werferIndex++;
      geprueft++;
    }
    karte.renderList = this.werferPending;
    this.werferPending = null;
    this.werferPendingSet = null;
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

  /** Diagnose für A/B und HUD: tatsächliche Instanzarbeit im Laubwurf. */
  vegetationsSchattenStats(): {
    an: boolean;
    master: number;
    gesamt: number;
    aktiv: number;
    pending: number;
    radiusMax: number;
  } {
    let gesamt = 0;
    let aktiv = 0;
    let radiusMax = 0;
    for (const stand of this.vegetationsSchatten.values()) {
      gesamt += stand.gesamt;
      aktiv += stand.aktiv;
      if (!Number.isNaN(stand.gepackterRadius)) {
        radiusMax = Math.max(radiusMax, stand.gepackterRadius);
      }
    }
    return {
      an: this.vegetationsInstanzKeulung,
      master: this.vegetationsSchatten.size,
      gesamt,
      aktiv,
      pending: this.vegetationsPackPending.size,
      radiusMax,
    };
  }

  /** Diagnose: Kaskaden der aktuellen Stufe, 0 wenn Schatten aus sind. */
  kaskaden(): number {
    return this.generator ? (this.konfiguration()?.kaskaden ?? 0) : 0;
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
    const cfg = this.konfiguration();
    if (!cfg) return;
    if (this.darfEmpfangen(mesh)) mesh.receiveShadows = true;
    if (!this.darfWerfen(mesh, cfg)) return;
    this.generator.addShadowCaster(mesh, false);
    // Läuft gerade ein Scan, muss das Mesh auch in dessen Ergebnis.
    //
    // tick() ERSETZT die renderList am Ende durch werferPending
    // (`karte.renderList = this.werferPending`). Alles, was seit der
    // Momentaufnahme über addShadowCaster hinzukam, fiele damit wieder
    // heraus und käme erst beim nächsten Nachführen zurück, also nach
    // NACHFUEHR_ABSTAND = 16 m Spielerbewegung.
    //
    // Bis E19 c war das folgenlos: Prefab-Master entstanden einmal je
    // Prefab, praktisch nie während eines Scans. Mit dem Zellschnitt
    // entstehen Master im Streaming-Takt — genau dann, wenn der Spieler
    // läuft, und genau dann läuft auch ständig ein Scan. Ohne diese zwei
    // Zeilen wäre der Fehlermodus der von Leitplanke 4: wandernde
    // schattenlose Bäume, kein Ruckler, im Bildschirmfoto kaum zu sehen.
    //
    // Doppelt eintragen kann es nichts: Die Momentaufnahme entstand vor
    // diesem Mesh, es kann in werferPending noch nicht stehen.
    if (this.werferPending && !this.werferPendingSet?.has(mesh)) {
      this.werferPending.push(mesh);
      this.werferPendingSet?.add(mesh);
    }
  }

  /**
   * Einen wiederverwendeten Werfer nachmelden.
   *
   * Der Review des Zellschnitts (E19 c) hat die Luecke gefunden: Der
   * einzige Anmeldeweg fuer Werfer ist scene.onNewMeshAddedObservable,
   * und der feuert nur bei der KONSTRUKTION. Der Zell-Pool des
   * EntityManager gibt aber bestehende Meshes wieder aus — nach einer
   * Minute Laufen kommt fast jede Zelle aus dem Pool, und nach einem
   * Teleport ohne anschliessende Bewegung (Spieler steht, kein 16-m-Scan)
   * staenden alle reaktivierten Zellen OHNE renderList-Eintrag da:
   * fleckenweise fehlende Vegetationsschatten, stumm, und eine Messung,
   * die besser aussieht als das Spiel.
   *
   * Doppeleintraege kann der Weg nicht erzeugen: addShadowCaster prueft
   * selbst auf Identitaet (shadowGenerator.js:427), und der
   * werferPending-Push deckt den Fall ab, dass gerade ein Scan laeuft,
   * dessen Momentaufnahme das Mesh noch nicht kannte.
   */
  meldeWerfer(mesh: AbstractMesh): void {
    this.nimmAuf(mesh);
  }

  /**
   * Einen Werfer endgueltig abmelden — Gegenstueck zu meldeWerfer().
   *
   * Noetig, damit der EntityManager Zell-Master ENTSORGEN kann: dispose()
   * allein liesse das Mesh in der renderList und — schlimmer — in der
   * Momentaufnahme eines gerade laufenden Scans (werferPending) stehen.
   * Der Umbau-Agent hat dispose deshalb urspruenglich ganz vermieden und
   * einen unbegrenzt wachsenden Pool hinterlassen (Review-Fund E19 c,
   * mittel). Mit diesem Abmeldeweg ist beides sauber: erst abmelden,
   * dann entsorgen.
   */
  entferneWerfer(mesh: AbstractMesh): void {
    const liste = this.generator?.getShadowMap()?.renderList;
    if (liste) {
      const i = liste.indexOf(mesh);
      if (i >= 0) liste.splice(i, 1);
    }
    if (this.werferPending) {
      const i = this.werferPending.indexOf(mesh);
      if (i >= 0) this.werferPending.splice(i, 1);
      this.werferPendingSet?.delete(mesh);
    }
  }

  /** Stufe setzen (Index in SHADOW_LEVELS). */
  setLevel(stufe: number): void {
    const i = Math.max(0, Math.min(SHADOW_LEVELS.length - 1, stufe));
    if (i === this.stufe && (i === 0) === (this.generator === null)) return;
    this.stufe = i;
    const cfg = this.konfiguration(i);

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
    // ── Kaskadenverteilung: gemessen 17.08.2026 nachts (E15) ─────────
    //
    // Hier stand `stabilizeCascades = true` mit der Begruendung:
    // "Kaskadengrenzen an der Kamera ausrichten statt an der Weltachse:
    //  Ohne das wandern die Schattenkanten beim Drehen sichtbar."
    //
    // Die Begruendung ist NICHT widerlegt — sie ist ungeprueft. Gemessen
    // wurde gegen ein anderes Problem: das Kriseln des Bodenschattens unter
    // wandernder Sonne. Dort kostet die Stabilisierung rund ein Drittel der
    // erreichbaren Verbesserung (bei 150 m und lambda 0,8: 2,29 %
    // stabilisiert gegen 2,04 % frei).
    //
    // E25 schaltet sie deshalb gezielt im 100-FPS-Profil wieder ein und
    // bezahlt die verlorene Texeldichte mit 1024 statt 512 px. A/B auf der
    // schweren Insel: dunkle Pixeleinbrueche -28 %, bewegte Pixel -20..24 %,
    // GPU +0,6 ms bei weiter 107..109 FPS. Die normalen Stufen bleiben auf
    // `false`, damit ihr zuvor gemessener Stand unveraendert bleibt.
    g.stabilizeCascades = this.hundertFpsProfil && i === 1;
    // Logarithmischere Aufteilung der vier Kaskaden: schiebt Texeldichte in
    // den Nahbereich, wo der Spieler steht. Babylons Vorgabe ist 0,5.
    // Gemessen: 0,80 traegt, 0,95 ist bereits schlechter (2,04 gegen 2,44 %).
    g.lambda = 0.80;
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

    // Eine andere Distanz verändert den konservativen Packradius. Bis die
    // budgetierten Klone neu stehen, bleiben die vollständigen Quellen als
    // lückenloser Fallback in der neuen Werferliste.
    if (this.vegetationsInstanzKeulung) {
      for (const stand of this.vegetationsSchatten.values()) {
        stand.schatten.setEnabled(false);
        stand.bereit = false;
        this.vegetationsQuellen.delete(stand.quelle);
        this.vegetationsPackPending.add(stand);
      }
    }

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
    const cfg = this.konfiguration();
    if (!cfg) return 'aus';
    const n = this.generator?.getShadowMap()?.renderList?.length ?? 0;
    const v = this.vegetationsSchattenStats();
    const instanzen = v.master > 0 && v.an ? `, v ${v.aktiv}/${v.gesamt}` : '';
    return `${cfg.kaskaden}x ${cfg.distanz}m ${cfg.aufloesung}px (${n} werfer${
      this.fern ? '' : ', nah'
    }${instanzen})`;
  }

  dispose(): void {
    this.abbauen();
    for (const stand of this.vegetationsSchatten.values()) stand.schatten.dispose();
    this.vegetationsSchatten.clear();
    this.vegetationsQuellen.clear();
    this.vegetationsKlone.clear();
    this.vegetationsPackPending.clear();
  }
}
