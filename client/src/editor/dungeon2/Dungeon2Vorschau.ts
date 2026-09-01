/**
 * AP15.6 — die eingebettete 3D-Live-Vorschau des Dungeon-Editors 2.0.
 * AP15.6 — the embedded 3D live preview of dungeon editor 2.0.
 *
 * Sie zeigt IM Editor-Viewport denselben Geometrie-Bauer, dasselbe
 * Triplanar-Material und dieselbe Atmosphäre wie das echte Spiel — als zweite
 * Ansicht desselben Dokuments neben der 2D-`CellCanvas`. Beide erfüllen das
 * schmale `Dungeon2Zeichenflaeche`-Interface (`setzeLayout`, `zeige`) und
 * docken an derselben Stelle an (`Dungeon2Seite`); umgeschaltet wird über
 * `display`/`zeige(an)` wie Grundriss neben Weltkarte.
 * It shows, INSIDE the editor viewport, the same geometry builder, triplanar
 * material and atmosphere as the real game — a second view of the same document
 * next to the 2D `CellCanvas`. Both satisfy the narrow `Dungeon2Zeichenflaeche`
 * interface and dock at the same place.
 *
 * ── Eingebettet, nicht Popup / embedded, not popup ──────────────────────────
 * Der Auftrag ist die eingebettete Variante: eigene Engine/Szene in einer
 * Canvas-Ebene des Viewports. Der Popup-Weg (die bestehende Standalone-Seite
 * `dungeon2Preview.ts` in einem neuen Fenster) bräuchte man nur bei einem
 * WebGL-Kontext-Engpass. Den gibt es hier nicht: Der `GegenstandsKatalog` legt
 * seine Engine erst bei `oeffne()` an (`szeneSicherstellen()`) und hält die
 * Render-Schleife nur, solange er offen ist — und diese Vorschau tut dasselbe
 * (Engine erst bei erster Sichtbarkeit, Schleife nur sichtbar). Objekt-Editor
 * und Dungeon-Vorschau sind ausserdem nicht gleichzeitig sichtbar. Zwei ruhende
 * Kontexte liegen weit unter jedem Browserlimit.
 * The task is the embedded variant. The popup path would only be needed on a
 * WebGL-context bottleneck — there is none: the object catalogue creates its
 * engine lazily and only runs its loop while open, and this preview does the
 * same, so at most two idle contexts ever coexist.
 *
 * ── Grafikstufen 1:1 zum Spiel / graphics tiers 1:1 with the game ───────────
 * KEIN Editor-Sonderpfad (editor-integration.md §3.5): SSAO, Godrays,
 * Triplanar, Parallax laufen über `DungeonAtmosphaere` und das geteilte
 * Dungeon-Material — genau die Kette aus `dungeon2Preview.ts`. Ein zweiter
 * Renderpfad wäre der historische Vertrauensbruch „Editor sieht anders aus als
 * die Welt".
 * NO editor special path: the effect chain is exactly `dungeon2Preview.ts`'s.
 *
 * ── Reaktivität / reactivity ────────────────────────────────────────────────
 * `DungeonBauer` baut sein Layout nicht partiell nach (Layout im Konstruktor,
 * Gitter einmal ausgerollt). Ein Pinselstrich führt daher zu einem VOLLNEUBAU
 * — aber entprellt (`VorschauSteuerung`, `entprellMs`), damit ein Dauerstrich
 * nicht jeden Frame neu baut, und der Nachbau läuft blockweise über
 * `baueWeiter()` in der Bildschleife, damit der Neubau nicht sichtbar ruckt.
 * `DungeonBauer` has no partial rebuild, so a brush stroke triggers a FULL
 * rebuild — debounced, with the block-wise catch-up driven per frame.
 *
 * Die reine Zustandslogik (Entprellung, sichtbar↔Schleife, dispose) liegt in
 * `vorschauSteuerung.ts` und ist dort ohne WebGL getestet
 * (`client/test/dungeon2-vorschau.ts`). Diese Datei ist die Babylon-Hälfte.
 * The pure state logic lives in `vorschauSteuerung.ts`, tested there without
 * WebGL. This file is the Babylon half.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import { dungeon2 } from '@wov/shared';
import { installiereFackelLicht } from '../../engine/FackelLicht';
import { LightPool } from '../../engine/LightPool';
import { AssetManager } from '../../engine/AssetManager';
import { DungeonBauer } from '../../engine/DungeonBuilder';
import { DungeonAtmosphaere, type Grundlicht } from '../../engine/DungeonAtmosphere';
import { DungeonGrafikStufe } from '../../engine/DungeonMaterial';
import { ladeDungeonMaterialArrays, type DungeonMaterialArrays } from '../../engine/DungeonMaterialArrays';
import type { Dungeon2Zeichenflaeche } from './Dungeon2Katalog';
import { VorschauSteuerung, type VorschauTreiber, type Zeitgeber } from './vorschauSteuerung';

/**
 * Fundort der Texturen — dieselbe Doppelsuche wie `dungeon2Preview.ts`: erst
 * der Entwicklungspfad (`vite` reicht `assets/` durch), dann der Auslieferpfad.
 * Location of the textures — the same two-path lookup as the standalone preview.
 */
const ARRAY_PFADE: readonly string[] = ['/assets/dungeon2/', '/dungeon2/'];

/** Grundhelligkeit des Hemisphärenlichts (wie in `dungeon2Preview.ts`). */
/** Base intensity of the hemispheric light (as in the standalone preview). */
const GRUNDHELLIGKEIT = 0.55;

export interface Dungeon2VorschauRueckrufe {
  /** Statuszeile (Andockung AP15.7). / Status line (docking AP15.7). */
  meldung?(text: string, fehler?: boolean): void;
}

/**
 * Erfüllt `Dungeon2Zeichenflaeche` (`setzeLayout`, `zeige`) — an derselben
 * Stelle andockbar wie `CellCanvas`, als 3D-Ansicht desselben Dokuments.
 * Satisfies `Dungeon2Zeichenflaeche` — dockable where `CellCanvas` docks.
 */
export class Dungeon2Vorschau implements Dungeon2Zeichenflaeche {
  private readonly canvas: HTMLCanvasElement;

  // Babylon-Seite — erst bei erster Sichtbarkeit angelegt (lazy), damit ein nie
  // geöffnetes Register keinen WebGL-Kontext hält. / Babylon side, lazy.
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private kamera: ArcRotateCamera | null = null;
  private assets: AssetManager | null = null;
  private pool: LightPool | null = null;

  private bauer: DungeonBauer | null = null;
  private atmosphaere: DungeonAtmosphaere | null = null;

  private arrays: DungeonMaterialArrays | null = null;
  private arraysVersucht = false;

  /** Zuletzt gebautes Layout — für den Nachbau, wenn die Arrays eintreffen. */
  /** Last built layout — for the rebuild once the arrays arrive. */
  private aktuellesLayout: dungeon2.DungeonLayout2 | null = null;
  /** Zählt Bauten, damit ein spät zurückkehrendes `baueDeko` nicht in einen
   *  längst ersetzten Bauer schreibt. / Guards decor against a stale builder. */
  private bauGeneration = 0;

  private readonly steuerung: VorschauSteuerung;
  private readonly aufResize: () => void;
  private readonly frame: () => void;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly cb: Dungeon2VorschauRueckrufe = {},
    /** Grafikstufe wie im Spiel; Voreinstellung Mittel (wie die Standalone-Seite). */
    /** Graphics tier as in the game; default Medium (like the standalone page). */
    private readonly stufe: DungeonGrafikStufe = DungeonGrafikStufe.Mittel
  ) {
    const c = document.createElement('canvas');
    // Koexistenz über display:block/none wie `CellCanvas`; z-index über der
    // 2D-Canvas (dort 2), damit die aktive Ansicht oben liegt.
    // Coexistence via display like `CellCanvas`; z above the 2D canvas.
    c.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:none;outline:none;z-index:3';
    c.tabIndex = 0; // damit die Kamera Tastatur/Rad bekommt / so the camera gets input
    viewport.appendChild(c);
    this.canvas = c;

    this.frame = (): void => {
      const scene = this.scene;
      if (scene === null) return;
      // Blockweiser Nachbau: ein Schwung je Bild, bis alles steht — so ruckt der
      // Neubau nach einem Strich nicht. / Block-wise catch-up per frame.
      if (this.bauer !== null && !this.bauer.vollstaendig) this.bauer.baueWeiter();
      if (this.kamera !== null && this.engine !== null) {
        const p = this.kamera.position;
        this.pool?.update(p.x, p.y, p.z, this.engine.getDeltaTime() / 1000);
        this.atmosphaere?.aktualisiere(p.x, p.y, p.z);
      }
      scene.render();
    };

    this.aufResize = (): void => this.engine?.resize();
    window.addEventListener('resize', this.aufResize);

    // Der Treiber verdrahtet die pure Steuerung mit der Babylon-Hälfte. Ein
    // echter Zeitgeber (window-Timer) — der Test ersetzt beide durch Attrappen.
    // The driver wires the pure control to the Babylon half.
    const treiber: VorschauTreiber = {
      baueNeu: (layout) => this.baueNeuIntern(layout),
      starteSchleife: () => this.starteSchleifeIntern(),
      stoppeSchleife: () => this.stoppeSchleifeIntern(),
      abbauen: () => this.abbauenIntern(),
    };
    const zeitgeber: Zeitgeber = {
      setzen: (r, ms) => window.setTimeout(r, ms),
      loeschen: (h) => window.clearTimeout(h),
    };
    this.steuerung = new VorschauSteuerung(treiber, zeitgeber);
  }

  // ── Öffentliche API (Dungeon2Zeichenflaeche) ───────────────────────────────

  setzeLayout(layout: dungeon2.DungeonLayout2 | null): void {
    this.steuerung.setzeLayout(layout);
  }

  zeige(an: boolean): void {
    this.steuerung.zeige(an);
  }

  get sichtbar(): boolean {
    return this.steuerung.istSichtbar;
  }

  dispose(): void {
    // Erst die Steuerung (stoppt Schleife, ruft `abbauen`), dann den
    // window-Listener. Idempotent über die Steuerung. / Control first, then listener.
    this.steuerung.dispose();
    window.removeEventListener('resize', this.aufResize);
  }

  // ── Babylon-Hälfte, von der Steuerung getrieben ────────────────────────────

  private starteSchleifeIntern(): void {
    this.szeneSicherstellen();
    this.canvas.style.display = 'block';
    this.engine?.resize();
    // Rendern erst jetzt: eine Vorschau, die unsichtbar rechnet, stiehlt dem
    // Karten-Worker die CPU (s. `GegenstandsKatalog.oeffne()`).
    // Render only now: an invisible preview would steal the map worker's CPU.
    this.engine?.runRenderLoop(this.frame);
  }

  private stoppeSchleifeIntern(): void {
    this.canvas.style.display = 'none';
    this.engine?.stopRenderLoop(this.frame);
  }

  /**
   * Engine/Szene/Kamera/Licht einmal anlegen und die Texturarrays laden.
   * Idempotent — beim zweiten Einblenden steht schon alles.
   * Create engine/scene/camera/light once and load the texture arrays.
   */
  private szeneSicherstellen(): void {
    if (this.engine !== null) return;

    const engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.02, 0.02, 0.03, 1);

    // Ein Innenraum hat kein Aussenlicht; der schwache Hemisphärenanteil macht
    // nur graue Kästen ohne Fackeln sichtbar (wie in der Standalone-Seite).
    // An interior has no outdoor light; the weak hemispheric term only makes
    // grey boxes visible without torches.
    const licht = new HemisphericLight('vorschauLicht', new Vector3(0, 1, 0), scene);
    licht.intensity = GRUNDHELLIGKEIT;
    licht.diffuse = new Color3(0.8, 0.82, 0.9);
    licht.groundColor = new Color3(0.12, 0.11, 0.1);
    // Grundlicht-Adapter wie im Spiel/der Standalone-Seite: `ambientLicht`
    // dämpft dieses eine Licht über dieselbe Schnittstelle.
    const grundlicht: Grundlicht = {
      setzeDungeonDaempfung: (faktor) => {
        licht.intensity = GRUNDHELLIGKEIT * (faktor ?? 1);
      },
    };
    this.grundlicht = grundlicht;

    // ArcRotate statt fester Spielkamera: Im Editor umkreist man den Dungeon,
    // um ihn zu inspizieren. / ArcRotate rather than the fixed game camera.
    const kamera = new ArcRotateCamera('vorschauKamera', -Math.PI / 2 + 0.6, 1.05, 24, Vector3.Zero(), scene);
    kamera.lowerRadiusLimit = 2;
    kamera.upperRadiusLimit = 200;
    kamera.minZ = 0.1;
    kamera.maxZ = 400;
    kamera.wheelDeltaPercentage = 0.02;
    kamera.attachControl(this.canvas, true);

    // Fackellicht VOR dem ersten Bau installieren: das Plugin hängt sich an
    // jedes künftige Material, sonst gäbe es eine sichtbare Neuübersetzung.
    // Install the torch light BEFORE the first build, else a visible recompile.
    installiereFackelLicht(scene);

    this.engine = engine;
    this.scene = scene;
    this.kamera = kamera;
    this.assets = new AssetManager(scene);
    // Der Pool zieht die nächsten Fackeln aus dem jeweils AKTUELLEN Bauer —
    // eine Closure, damit er einen Neubau überlebt. / Closure survives rebuilds.
    this.pool = new LightPool(scene, (x, z, r) => this.bauer?.lichtquellen(x, z, r) ?? []);

    void this.arraysLaden();
  }

  private grundlicht: Grundlicht | null = null;

  /**
   * Die Texturarrays einmal laden. Ohne sie baut der Bauer graue Kästen (der
   * definierte AP6-Zustand). Treffen sie ein, während schon ein grauer Bau
   * steht, wird EINMAL nachgebaut — dann sieht der Editor aus wie die Welt.
   * Load the texture arrays once. Without them the builder makes grey boxes
   * (the defined AP6 state); when they arrive over a grey build, rebuild once.
   */
  private async arraysLaden(): Promise<void> {
    if (this.arraysVersucht || this.scene === null) return;
    this.arraysVersucht = true;
    for (const pfad of ARRAY_PFADE) {
      try {
        this.arrays = await ladeDungeonMaterialArrays(this.scene, pfad);
        break;
      } catch (fehler) {
        console.warn(`[dungeon2-vorschau] ${pfad} nicht ladbar:`, fehler);
      }
    }
    // Nachbauen nur, wenn schon grau gebaut wurde und die Vorschau noch lebt.
    if (this.arrays !== null && this.bauer !== null && this.scene !== null) {
      this.baueNeuIntern(this.aktuellesLayout);
    }
  }

  /**
   * Vollneubau: alten Bauer/Atmosphäre verwerfen, für `layout` einen neuen
   * anlegen. `null` leert nur. Die teure Kette (Bauer, Atmosphäre) ist genau
   * die des Spiels — kein Sonderpfad. / Full rebuild, same chain as the game.
   */
  private baueNeuIntern(layout: dungeon2.DungeonLayout2 | null): void {
    if (this.scene === null || this.kamera === null) return;
    this.aktuellesLayout = layout;
    const generation = ++this.bauGeneration;

    // Alten Bau abräumen — Atmosphäre zuerst (sie hängt an der Kamera).
    // Tear down the old build — atmosphere first (it hangs on the camera).
    this.atmosphaere?.dispose();
    this.atmosphaere = null;
    this.bauer?.dispose();
    this.bauer = null;

    if (layout === null) {
      this.cb.meldung?.('Kein Layout — Vorschau leer');
      return;
    }

    // Ohne Physik: die Vorschau ist eine Kulisse (kein Havok im Editor).
    // No physics: the preview is a backdrop (no Havok in the editor).
    const bauer = new DungeonBauer(this.scene, layout, { arrays: this.arrays, physik: false });
    bauer.baueSpawnBloecke();
    this.bauer = bauer;

    // Atmosphäre mit den Lichtschächten DIESES Baus — dieselbe Klasse und
    // dieselbe Stufe wie im Spiel. / Atmosphere with this build's shafts.
    const atmosphaere = new DungeonAtmosphaere(
      this.scene,
      this.kamera,
      this.stufe,
      1, // Grundhelligkeit voll; die dokumentspezifische kommt in AP15.7 herein
      this.grundlicht,
      bauer.lichtschaechte
    );
    atmosphaere.betrete();
    bauer.setzeStufe(this.stufe);
    this.atmosphaere = atmosphaere;

    // Kamera auf den Spawnpunkt richten. / Aim the camera at the spawn point.
    this.kamera.setTarget(bauer.spawnPunkt.add(new Vector3(0, 1.5, 0)));

    // Sichtbare Deko nachladen (asynchron, GLB-Fetch). Ein spät zurückkehrender
    // Aufruf darf nicht in einen inzwischen ersetzten Bauer schreiben — die
    // Generation ist der Zeuge. / Late decor must not write into a replaced builder.
    if (this.assets !== null) {
      void bauer.baueDeko(this.assets).catch((f: unknown) => {
        console.warn('[dungeon2-vorschau] Deko:', f);
      }).then(() => {
        if (generation !== this.bauGeneration) return; // veraltet / stale
        const s = bauer.statistik();
        this.cb.meldung?.(
          `${layout.stempel.length} Stempel · ${s.bloeckeGebaut}/${s.bloeckeGesamt} Blöcke · ` +
            `${s.meshes} Meshes · ${s.dreiecke} Dreiecke · Material ${this.arrays === null ? 'grau' : 'Arrays'}`
        );
      });
    }
  }

  /** Alles endgültig abräumen — kein Leak, keine laufende Schleife danach. */
  /** Final teardown — no leak, no running loop afterwards. */
  private abbauenIntern(): void {
    this.engine?.stopRenderLoop(this.frame);
    this.atmosphaere?.dispose();
    this.atmosphaere = null;
    this.bauer?.dispose();
    this.bauer = null;
    this.pool?.dispose();
    this.pool = null;
    // `AssetManager` besitzt keine eigene Abbaumethode — seine Master sind
    // Szenen-Meshes und fallen mit `scene.dispose()`; die Referenz lassen wir
    // los. / No own teardown: its masters are scene meshes, freed by scene.dispose().
    this.assets = null;
    this.scene?.dispose();
    this.scene = null;
    this.engine?.dispose();
    this.engine = null;
    this.kamera = null;
    this.grundlicht = null;
    this.canvas.remove();
  }
}
