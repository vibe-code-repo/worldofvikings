/**
 * Ingame-Weltkarte — die ganze Welt als stilisiertes 3D-Relief.
 *
 * Vorbild ist der Babylon-Playground XKPVRC#3 („2048map"): eine
 * orthografische Kartenansicht, die beim Herauszoomen in die Draufsicht
 * kippt und beim Hineinzoomen schräg wird, mattes, unaufdringliches Licht,
 * eine weiche Wasserfläche über dem Relief und ein runder Kartenrand. Statt
 * eines fertigen GLTF-Modells liegt hier die echte Welt darunter: Relief,
 * Biome-Einfärbung, Flüsse und Waldsignaturen kommen aus demselben
 * `GeoManager`, den auch der Server fährt (gerechnet im Worker, siehe
 * worldmap/mapWorker.ts).
 *
 * Bewusst eine eigene Engine auf einem eigenen Canvas: die Kartenszene hat
 * eine völlig andere Kamera, kein Pointer-Lock und ein anderes Post-Processing
 * als die Spielszene, und ein separater Canvas fängt seine Mausereignisse
 * selbst ab, ohne dem InputManager der Spielszene ins Gehege zu kommen.
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Rendering/edgesRenderer';
import { Biome, BiomeArea, WATER_LEVEL } from '@wov/shared';
import type { ClientWorld, ClientWorldSettings } from '../world/World';
import { UI } from './theme';
import {
  BIOME_LABEL,
  BIOME_ORDER,
  BIOME_COLOR,
  BIOME_INHALT,
  TREE_STYLE,
  TreeKind,
  forestLabel,
  treeKindAt,
  type RGB,
} from './worldmap/MapPalette';
import {
  GRID_N,
  HEIGHT_EXAG,
  MAP_RADIUS,
  MAP_SPAN,
  MAP_UNIT,
  TEX_N,
  type MapWorkerMessage,
} from './worldmap/mapTypes';

/** Kartenhöhe des Wasserspiegels in Babylon-Einheiten. */
const WASSER_Y = (WATER_LEVEL / MAP_UNIT) * HEIGHT_EXAG;
/**
 * Kartenradius in Babylon-Einheiten — als Funktion, weil MAP_RADIUS im
 * Layout-Modus vor dem Kartenaufbau umgestellt wird (setzeKartenMasse);
 * ein Modul-const fröre den Radialwelt-Wert ein.
 */
const scheibe = (): number => MAP_RADIUS / MAP_UNIT;
/**
 * Zoomstufen: klein = dicht dran, 10 = ganze Welt im Bild.
 *
 * Weiter als 1.8 lässt sich nicht heranfahren: das Kartenbild hat 10 m je
 * Texel, darunter sieht man nur noch dessen Raster statt der Landschaft.
 */
const ZOOM_MIN = 1.8;
const ZOOM_MAX = 10;
/** Wie viele Karteneinheiten die Bildhöhe bei Zoomwert 1 abdeckt. */
const SICHT_PRO_ZOOM = 22;

const css = (...teile: string[]): string => teile.filter(Boolean).join(';');
const rgb = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;

interface Spielerstand {
  x: number;
  z: number;
  yaw: number;
}

export interface WorldMapOptions {
  /** Weltseed — der Worker baut daraus dieselbe Welt wie das Spiel. */
  seed: string;
  /** Worldgen-Flags aus dem ServerConfig-Handshake. */
  settings: ClientWorldSettings;
  /** WorldLayout-Dokument (Layout-Modus) — der Worker baut daraus RegionGeo. */
  layout?: unknown;
  /** Weltdaten des Spiels, für Abfragen unter dem Mauszeiger. */
  world: ClientWorld;
  /** Aktuelle Spielerposition und Blickrichtung, oder null vor dem Spawn. */
  spieler: () => Spielerstand | null;
  /**
   * Admin: Strg+Klick auf die Karte. Fehlt der Rückruf, ist die Funktion
   * abgeschaltet (und der Hinweis in der Kopfzeile bleibt weg).
   *
   * Vorbild ist Valheims Debug-Teleport (`Minimap.OnMapMiddleClick` →
   * `DebugTeleport`), dort an Strg+MITTELklick. Im Browser ist die
   * mittlere Taste unzuverlässig (Autoscroll, oft gar nicht vorhanden),
   * deshalb hört das hier zusätzlich auf die linke.
   */
  aufTeleport?: (x: number, z: number) => void;
}

export class WorldMap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly statusZeile: HTMLDivElement;
  private readonly infoZeile: HTMLDivElement;
  private readonly balken: HTMLDivElement;

  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private kamera: ArcRotateCamera | null = null;
  private relief: Mesh | null = null;
  private textur: RawTexture | null = null;
  private texturPuffer: Uint8Array | null = null;
  private spielerMarke: Mesh | null = null;
  private readonly baumMeshes: Mesh[] = [];
  /** Dungeon-Eingänge (Phase G) — als glutrote Rauten auf der Karte. */
  private eingangsMarke: Mesh | null = null;
  private dungeonEingaenge: Array<{ feature: string; dungeonId: string; x: number; z: number }> = [];

  private worker: Worker | null = null;
  private gestartet = false;
  private fertig = false;
  /** Zwischenlager für Worker-Ergebnisse, die vor dem ersten Öffnen ankommen. */
  private warteschlange: MapWorkerMessage[] = [];

  private zoom = ZOOM_MAX;
  private zielX = 0;
  private zielZ = 0;
  private ziehtVon: { x: number; y: number } | null = null;
  /** Wo der Zeiger gedrückt wurde — unterscheidet Klick von Ziehen. */
  private klickVon: { x: number; y: number } | null = null;
  private sichtbar = false;
  /** Weltkoordinate unter dem Mauszeiger, für die Infozeile. */
  private zeiger: { x: number; z: number } | null = null;

  /** Biome-/Höhen-/Waldraster des Workers für schnelle Abfragen. */
  private rasterBiome: Uint16Array | null = null;
  private rasterHoehe: Float32Array | null = null;
  private rasterWald: Float32Array | null = null;
  private rasterN = 0;

  constructor(private readonly opts: WorldMapOptions) {
    this.root = document.createElement('div');
    this.root.style.cssText = css(
      'position:fixed', 'inset:0', 'z-index:980', 'display:none',
      'background:radial-gradient(circle at 50% 45%, #1d2531 0%, #0b0e14 70%, #05070a 100%)',
      `font-family:${UI.font}`, `color:${UI.text}`,
    );

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = css('position:absolute', 'inset:0', 'width:100%', 'height:100%', 'display:block', 'touch-action:none');
    this.root.appendChild(this.canvas);

    this.root.appendChild(this.kopfzeile());
    this.balken = this.fortschrittsbalken();
    this.root.appendChild(this.balken);
    this.statusZeile = this.status();
    this.root.appendChild(this.statusZeile);
    this.root.appendChild(this.legende());
    this.infoZeile = this.info();
    this.root.appendChild(this.infoZeile);
    this.root.appendChild(this.hinweis());

    this.mausBinden();
    document.body.appendChild(this.root);
  }

  // ---------------------------------------------------------------- Chrome --

  private kopfzeile(): HTMLDivElement {
    const kopf = document.createElement('div');
    kopf.style.cssText = css(
      'position:absolute', 'top:18px', 'left:0', 'right:0', 'text-align:center', 'pointer-events:none',
    );
    const titel = document.createElement('div');
    titel.textContent = 'Karte';
    titel.style.cssText = css(
      'font-size:26px', 'letter-spacing:.22em', `color:${UI.gold}`, 'text-shadow:0 2px 6px #000',
    );
    const seed = document.createElement('div');
    seed.textContent = `Welt „${this.opts.seed}"`;
    seed.style.cssText = css('font-size:12px', 'letter-spacing:.12em', `color:${UI.muted}`, 'margin-top:2px');
    kopf.append(titel, seed);
    return kopf;
  }

  private fortschrittsbalken(): HTMLDivElement {
    const aussen = document.createElement('div');
    aussen.style.cssText = css(
      'position:absolute', 'top:70px', 'left:50%', 'transform:translateX(-50%)',
      'width:280px', 'height:4px', 'border-radius:2px', 'background:rgba(0,0,0,.5)',
      `border:1px solid ${UI.borderDim}`, 'overflow:hidden', 'pointer-events:none',
    );
    const innen = document.createElement('div');
    innen.style.cssText = css('height:100%', 'width:0%', `background:${UI.gold}`, 'transition:width .2s');
    aussen.appendChild(innen);
    return aussen;
  }

  private status(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = css(
      'position:absolute', 'top:82px', 'left:0', 'right:0', 'text-align:center',
      'font-size:12px', `color:${UI.muted}`, 'letter-spacing:.08em', 'pointer-events:none',
    );
    return el;
  }

  /** Legende: Biome links, Waldsignaturen rechts daneben. */
  private legende(): HTMLDivElement {
    const box = document.createElement('div');
    box.style.cssText = css(
      'position:absolute', 'top:50%', 'right:22px', 'transform:translateY(-50%)',
      'background:linear-gradient(180deg,rgba(58,47,34,.92),rgba(36,28,20,.92))',
      `border:2px solid ${UI.border}`, 'border-radius:6px', 'padding:14px 16px',
      'box-shadow:0 12px 40px rgba(0,0,0,.6)', 'font-size:12px', 'pointer-events:none',
      'max-height:78vh', 'overflow:hidden',
    );

    const t1 = document.createElement('div');
    t1.textContent = 'Biome';
    t1.style.cssText = css(`color:${UI.gold}`, 'letter-spacing:.14em', 'margin-bottom:6px', 'font-size:13px');
    box.appendChild(t1);

    for (const b of BIOME_ORDER) {
      const zeile = document.createElement('div');
      zeile.style.cssText = css('display:flex', 'align-items:center', 'gap:8px', 'margin:3px 0');
      const punkt = document.createElement('span');
      punkt.style.cssText = css(
        'width:13px', 'height:13px', 'border-radius:3px', 'flex:0 0 auto',
        `background:${rgb(BIOME_COLOR[b])}`, `border:1px solid ${UI.borderDim}`,
      );
      const name = document.createElement('span');
      name.textContent = BIOME_LABEL[b];
      zeile.append(punkt, name);
      box.appendChild(zeile);
    }

    const t2 = document.createElement('div');
    t2.textContent = 'Bewuchs';
    t2.style.cssText = css(`color:${UI.gold}`, 'letter-spacing:.14em', 'margin:12px 0 6px', 'font-size:13px');
    box.appendChild(t2);

    const arten: TreeKind[] = [
      TreeKind.Laubwald, TreeKind.Fichtenwald, TreeKind.Kiefernwald, TreeKind.Sumpfwald,
      TreeKind.Herbstwald, TreeKind.Nebelwald, TreeKind.Aschewald, TreeKind.Eis, TreeKind.Fels,
    ];
    for (const art of arten) {
      const stil = TREE_STYLE[art];
      const zeile = document.createElement('div');
      zeile.style.cssText = css('display:flex', 'align-items:center', 'gap:8px', 'margin:3px 0');
      const sym = document.createElement('span');
      // Kegel für Nadelholz, Kreis für Laubkronen, Raute für Fels/Eis.
      const form = stil.form === 'kugel'
        ? 'border-radius:50%;width:12px;height:12px'
        : stil.form === 'zacke'
          ? 'width:11px;height:11px;transform:rotate(45deg)'
          : 'width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;'
            + `border-bottom:13px solid ${rgb(stil.color)};background:none`;
      sym.style.cssText = css('flex:0 0 12px', `background:${rgb(stil.color)}`, form);
      const name = document.createElement('span');
      name.textContent = stil.label;
      zeile.append(sym, name);
      box.appendChild(zeile);
    }
    return box;
  }

  private info(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = css(
      'position:absolute', 'left:22px', 'bottom:60px',
      'background:linear-gradient(180deg,rgba(58,47,34,.92),rgba(36,28,20,.92))',
      `border:2px solid ${UI.border}`, 'border-radius:6px', 'padding:10px 14px',
      'min-width:230px', 'font-size:12.5px', 'line-height:1.55', 'pointer-events:none',
      'box-shadow:0 12px 40px rgba(0,0,0,.6)',
    );
    return el;
  }

  private hinweis(): HTMLDivElement {
    const el = document.createElement('div');
    // Der Teleport-Hinweis erscheint nur, wenn die Funktion auch
    // verdrahtet ist — sonst stünde dort eine Bedienung, die nichts tut.
    const basis = 'Ziehen: verschieben · Mausrad: zoomen · Leertaste: zum Spieler · M oder Esc: schliessen';
    el.textContent = this.opts.aufTeleport ? `${basis} · Strg+Klick: hierhin teleportieren` : basis;
    el.style.cssText = css(
      'position:absolute', 'left:0', 'right:0', 'bottom:18px', 'text-align:center',
      'font-size:12px', `color:${UI.muted}`, 'letter-spacing:.06em', 'pointer-events:none',
    );
    return el;
  }

  // ----------------------------------------------------------------- Maus ---

  private mausBinden(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.ziehtVon = { x: e.clientX, y: e.clientY };
      // Startpunkt getrennt merken: `ziehtVon` wandert bei jeder Bewegung
      // mit (es ist der Bezug für das Delta), taugt also nicht, um am Ende
      // Klick von Ziehen zu unterscheiden.
      this.klickVon = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const von = this.klickVon;
      this.klickVon = null;
      this.ziehtVon = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      // Nur ein echter Klick teleportiert — wer die Karte verschiebt, will
      // das nicht. 4 px Toleranz gegen das Wackeln beim Loslassen.
      if (!von || !e.ctrlKey || !this.opts.aufTeleport) return;
      if (Math.hypot(e.clientX - von.x, e.clientY - von.y) > 4) return;
      this.teleportAn(e.offsetX, e.offsetY);
    });
    this.canvas.addEventListener('pointerleave', () => { this.ziehtVon = null; });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.ziehtVon) {
        const dx = e.clientX - this.ziehtVon.x;
        const dy = e.clientY - this.ziehtVon.y;
        this.ziehtVon = { x: e.clientX, y: e.clientY };
        this.verschieben(dx, dy);
      }
      this.zeigerAktualisieren(e.offsetX, e.offsetY);
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomen(Math.sign(e.deltaY) * 0.14 * Math.max(this.zoom, 1));
    }, { passive: false });
  }

  /** Bildschirmpixel in Kartenbewegung umrechnen (Neigung eingerechnet). */
  private verschieben(dx: number, dy: number): void {
    const hoehe = this.canvas.clientHeight || 1;
    const proPixel = (SICHT_PRO_ZOOM * this.zoom) / hoehe;
    const beta = this.betaFuer(this.zoom);
    this.zielX -= dx * proPixel;
    // Norden liegt oben (+Z): nach unten ziehen holt den Norden ins Bild.
    this.zielZ += (dy * proPixel) / Math.max(Math.cos(beta), 0.25);
    this.grenzen();
  }

  private zoomen(delta: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom + delta));
    this.grenzen();
  }

  private grenzen(): void {
    // Nicht über den Kartenrand hinaus schwenken.
    const rand = Math.max(0, scheibe() - (SICHT_PRO_ZOOM * this.zoom) / 4);
    this.zielX = Math.min(rand, Math.max(-rand, this.zielX));
    this.zielZ = Math.min(rand, Math.max(-rand, this.zielZ));
  }

  /** Kippwinkel: von der Draufsicht (ganze Welt) in die Schrägsicht (nah dran). */
  private betaFuer(zoom: number): number {
    const t = (ZOOM_MAX - zoom) / (ZOOM_MAX - ZOOM_MIN); // 0 = weit weg, 1 = nah
    return 0.03 + t * 0.92;
  }

  // ------------------------------------------------------------ Vorberechnen --

  /**
   * Startet die Berechnung im Hintergrund. Wird direkt nach dem Weltaufbau
   * aufgerufen, damit die Karte fertig ist, bevor sie zum ersten Mal
   * gebraucht wird.
   */
  vorberechnen(): void {
    if (this.gestartet) return;
    this.gestartet = true;
    try {
      this.worker = new Worker(new URL('./worldmap/mapWorker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      this.statusZeile.textContent = `Karte nicht verfügbar: ${String(err)}`;
      return;
    }
    this.worker.onmessage = (e: MessageEvent<MapWorkerMessage>) => this.nachricht(e.data);
    this.worker.onerror = (e) => { this.statusZeile.textContent = `Kartenfehler: ${e.message}`; };
    // Kartenmaße mitgeben: Der Worker hat einen EIGENEN Modulkontext —
    // setzeKartenMasse() im Panel erreicht ihn nicht.
    this.worker.postMessage({
      seed: this.opts.seed,
      settings: this.opts.settings,
      layout: this.opts.layout,
      span: MAP_SPAN,
      radius: MAP_RADIUS,
    });
  }

  private nachricht(m: MapWorkerMessage): void {
    switch (m.t) {
      case 'fortschritt':
        (this.balken.firstElementChild as HTMLDivElement).style.width = `${(m.anteil * 100).toFixed(0)}%`;
        this.statusZeile.textContent = m.text;
        return;
      case 'raster':
        this.rasterBiome = m.biome;
        this.rasterHoehe = m.hoehe;
        this.rasterWald = m.wald;
        this.rasterN = m.n;
        // Eingangs-Marker standen bis hierher auf Meereshöhe (siehe
        // kartenHoehe) — jetzt auf die echten Höhen heben.
        if (this.scene) this.eingangsMarkerBauen();
        return;
      case 'fertig':
        this.fertig = true;
        this.balken.style.display = 'none';
        this.statusZeile.textContent = '';
        this.worker?.terminate();
        this.worker = null;
        return;
      case 'fehler':
        this.statusZeile.textContent = `Karte konnte nicht gebaut werden: ${m.text}`;
        return;
      default:
        // Alles Geometrische braucht die Szene — solange die noch nicht
        // existiert (Karte nie geöffnet), wandert es in den Zwischenspeicher.
        if (!this.scene) this.warteschlange.push(m);
        else this.anwenden(m);
    }
  }

  private anwenden(m: MapWorkerMessage): void {
    switch (m.t) {
      case 'relief': this.reliefBauen(m.positions, m.normals, m.uvs, m.indices); return;
      case 'texturteil': this.texturStreifen(m.y, m.hoehe, m.data); return;
      case 'textur': this.texturSetzen(m.data); return;
      case 'baeume': this.baeumeBauen(m.art, m.data); return;
      default: return;
    }
  }

  // ---------------------------------------------------------------- Szene ---

  private szeneBauen(): void {
    // preserveDrawingBuffer: die Karte ist billig genug, und so lässt sich das
    // Kartenbild per canvas.toDataURL() abgreifen (Prüfsonden, Kartenexport).
    const engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: false }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.04, 0.05, 0.07, 1);
    scene.ambientColor = new Color3(0.35, 0.36, 0.4);

    const kamera = new ArcRotateCamera('kartekamera', -Math.PI / 2, 0.05, 100, Vector3.Zero(), scene);
    kamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    kamera.minZ = -400;
    kamera.maxZ = 1200;
    // Gedreht wird nicht: Norden bleibt oben, gesteuert wird nur Zoom und
    // Verschiebung — wie beim Vorbild, das Alpha ebenfalls festnagelt.
    kamera.lowerAlphaLimit = kamera.upperAlphaLimit = -Math.PI / 2;

    // Flaches, sehr weiches Licht: die Karte soll gemalt wirken, nicht
    // fotorealistisch. Der Höhenzuwachs kommt aus dem Relief, nicht aus
    // harten Schatten.
    const sonne = new DirectionalLight('kartesonne', new Vector3(-0.55, -1, -0.35), scene);
    sonne.intensity = 1.35;
    sonne.specular = Color3.Black();
    const himmel = new HemisphericLight('kartehimmel', new Vector3(0, 1, 0), scene);
    himmel.intensity = 0.75;
    himmel.diffuse = new Color3(0.85, 0.9, 1);
    himmel.groundColor = new Color3(0.35, 0.33, 0.3);

    this.engine = engine;
    this.scene = scene;
    this.kamera = kamera;

    // Wie im Vorbild: kräftiges Kantenglätten, dazu eine leichte Vignette
    // und etwas Nachschärfen — das gibt der Karte den gezeichneten Anschein,
    // ohne dass ein eigenes Node-Material nötig wäre.
    const pipeline = new DefaultRenderingPipeline('kartepost', false, scene, [kamera]);
    pipeline.samples = 4;
    pipeline.fxaaEnabled = true;
    pipeline.sharpenEnabled = true;
    pipeline.sharpen.edgeAmount = 0.22;
    pipeline.sharpen.colorAmount = 1;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.86;
    pipeline.bloomWeight = 0.18;
    pipeline.bloomKernel = 48;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 3.2;
    pipeline.imageProcessing.vignetteColor = new Color4(0.02, 0.03, 0.05, 0);
    pipeline.imageProcessing.contrast = 1.12;
    pipeline.imageProcessing.exposure = 1.05;

    this.wasserBauen();
    this.randBauen();
    this.markerBauen();
    this.eingangsMarkerBauen();

    for (const m of this.warteschlange) this.anwenden(m);
    this.warteschlange = [];

    scene.onBeforeRenderObservable.add(() => this.frame());
    window.addEventListener('resize', this.aufResize);
  }

  private readonly aufResize = (): void => { if (this.sichtbar) this.engine?.resize(); };

  /** Wasserfläche über dem Relief — die Küstenlinie kommt aus dem Kartenbild. */
  private wasserBauen(): void {
    const scene = this.scene!;
    const disc = MeshBuilder.CreateDisc('kartewasser', { radius: scheibe(), tessellation: 128 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = WASSER_Y;
    const mat = new StandardMaterial('kartewassermat', scene);
    // Zurückhaltend: die Küstenlinie und die Wassertiefe stecken bereits im
    // Kartenbild darunter. Die Fläche gibt nur den Glanz und die Kante
    // dazu — deckt sie zu stark, verschwindet das Land im Blau.
    mat.diffuseColor = new Color3(0.07, 0.17, 0.3);
    mat.specularColor = new Color3(0.3, 0.38, 0.46);
    mat.specularPower = 96;
    mat.emissiveColor = new Color3(0.02, 0.05, 0.09);
    mat.alpha = 0.38;
    mat.backFaceCulling = false;
    disc.material = mat;
    disc.isPickable = false;
  }

  /** Goldener Rand der Kartenscheibe — kaschiert die Rasterkante des Reliefs. */
  private randBauen(): void {
    const scene = this.scene!;
    const ring = MeshBuilder.CreateTorus('karterand', {
      diameter: scheibe() * 2, thickness: 0.55, tessellation: 128,
    }, scene);
    ring.position.y = WASSER_Y;
    const mat = new StandardMaterial('karterandmat', scene);
    mat.diffuseColor = new Color3(0.55, 0.42, 0.2);
    mat.emissiveColor = new Color3(0.22, 0.16, 0.07);
    mat.specularColor = new Color3(0.6, 0.5, 0.3);
    ring.material = mat;
    ring.isPickable = false;
  }

  /** Spielerpfeil und Startpunkt. */
  private markerBauen(): void {
    const scene = this.scene!;

    const pfeil = MeshBuilder.CreateCylinder('kartespieler', {
      diameterTop: 0, diameterBottom: 1.7, height: 3, tessellation: 3,
    }, scene);
    // Die Spitze zeigt in Blickrichtung: liegend, nicht stehend.
    pfeil.rotation.x = Math.PI / 2;
    pfeil.bakeCurrentTransformIntoVertices();
    const pmat = new StandardMaterial('kartespielermat', scene);
    pmat.diffuseColor = new Color3(0.95, 0.8, 0.35);
    pmat.emissiveColor = new Color3(0.6, 0.45, 0.12);
    pmat.specularColor = Color3.Black();
    pfeil.material = pmat;
    pfeil.isPickable = false;
    pfeil.renderingGroupId = 1;
    this.spielerMarke = pfeil;

    // Startpunkt (0,0): dort steht der Weihestein, an dem jede Welt beginnt.
    const stab = MeshBuilder.CreateCylinder('kartestart', {
      diameterTop: 0.35, diameterBottom: 0.35, height: 3.2, tessellation: 6,
    }, scene);
    const kugel = MeshBuilder.CreateSphere('kartestartkopf', { diameter: 1.5, segments: 6 }, scene);
    kugel.position.y = 2;
    kugel.parent = stab;
    const smat = new StandardMaterial('kartestartmat', scene);
    smat.diffuseColor = new Color3(0.9, 0.85, 0.7);
    smat.emissiveColor = new Color3(0.35, 0.3, 0.18);
    smat.specularColor = Color3.Black();
    stab.material = smat;
    kugel.material = smat;
    stab.isPickable = false;
    kugel.isPickable = false;
    const h = this.opts.world.getGroundHeight(0, 0);
    stab.position.set(0, (Math.max(h, WATER_LEVEL) / MAP_UNIT) * HEIGHT_EXAG + 1.6, 0);
    stab.renderingGroupId = 1;
    kugel.renderingGroupId = 1;
  }

  /**
   * Dungeon-Eingänge vom Server (Phase G). Kommt bei der Anmeldung und bei
   * jeder Änderung (assign/delete) — die Marker werden komplett neu gebaut.
   */
  setDungeonEingaenge(
    eingaenge: Array<{ feature: string; dungeonId: string; x: number; z: number }>
  ): void {
    this.dungeonEingaenge = eingaenge;
    if (this.scene) this.eingangsMarkerBauen();
  }

  /**
   * Markerhöhe an einer Weltstelle — aus dem WORKER-Raster, niemals live.
   *
   * `world.getGroundHeight()` wäre hier fatal: Es baut die Heightmap der
   * getroffenen Zone synchron auf, und die über tausend Eingänge liegen
   * quer über die ganze Welt verstreut — der erste Kartenaufbau stand
   * damit minutenlang (eingefrorener Tab, vom Nutzer gemeldet 2026-08-02).
   * Solange das Raster noch nicht da ist, stehen die Marker auf
   * Meereshöhe; der 'raster'-Zweig in nachricht() hebt sie danach an.
   */
  private kartenHoehe(x: number, z: number): number {
    if (this.rasterHoehe) {
      const n = this.rasterN;
      const c = Math.min(n - 1, Math.max(0, Math.floor(((x + MAP_SPAN / 2) / MAP_SPAN) * n)));
      const r = Math.min(n - 1, Math.max(0, Math.floor(((z + MAP_SPAN / 2) / MAP_SPAN) * n)));
      return this.rasterHoehe[r * n + c]!;
    }
    return WATER_LEVEL;
  }

  /**
   * Eingangs-Marker: EIN Mesh mit Thin Instances (auf einer Welt liegen
   * über tausend Krypten/Höhlen — einzelne Meshes wären ein Draw-Call-Grab).
   * Glutrote Raute, deutlich abgesetzt vom Gold des Spielers und dem Beige
   * des Startsteins.
   */
  private eingangsMarkerBauen(): void {
    const scene = this.scene!;
    this.eingangsMarke?.dispose();
    this.eingangsMarke = null;
    if (this.dungeonEingaenge.length === 0) return;

    const marke = MeshBuilder.CreatePolyhedron('karteeingang', { type: 1, size: 0.5 }, scene);
    const mat = new StandardMaterial('karteeingangmat', scene);
    mat.diffuseColor = new Color3(0.78, 0.22, 0.1);
    mat.emissiveColor = new Color3(0.5, 0.1, 0.04);
    mat.specularColor = Color3.Black();
    marke.material = mat;
    marke.isPickable = false;
    marke.renderingGroupId = 1;

    const data = new Float32Array(this.dungeonEingaenge.length * 16);
    const m = Matrix.Identity();
    this.dungeonEingaenge.forEach((e, i) => {
      const h = this.kartenHoehe(e.x, e.z);
      Matrix.TranslationToRef(
        e.x / MAP_UNIT,
        (Math.max(h, WATER_LEVEL) / MAP_UNIT) * HEIGHT_EXAG + 0.8,
        e.z / MAP_UNIT,
        m
      );
      m.copyToArray(data, i * 16);
    });
    marke.thinInstanceSetBuffer('matrix', data, 16, true);
    this.eingangsMarke = marke;
  }

  private reliefBauen(
    positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array,
  ): void {
    const scene = this.scene!;
    this.relief?.dispose();
    const mesh = new Mesh('karterelief', scene);
    const daten = new VertexData();
    daten.positions = positions;
    daten.normals = normals;
    daten.uvs = uvs;
    daten.indices = indices;
    daten.applyToMesh(mesh, false);

    const mat = new StandardMaterial('kartereliefmat', scene);
    // Beidseitig: an den Kanten der Kartenscheibe schaut man sonst durch das
    // Relief hindurch ins Nichts.
    mat.backFaceCulling = false;
    mat.specularColor = Color3.Black();
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.ambientColor = new Color3(1, 1, 1);
    if (this.textur) mat.diffuseTexture = this.textur;
    mesh.material = mat;
    this.relief = mesh;
  }

  private texturSicherstellen(): RawTexture {
    if (this.textur) return this.textur;
    const scene = this.scene!;
    this.texturPuffer = new Uint8Array(TEX_N * TEX_N * 4).fill(60);
    const tex = RawTexture.CreateRGBATexture(
      this.texturPuffer, TEX_N, TEX_N, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE,
    );
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.textur = tex;
    const mat = this.relief?.material as StandardMaterial | undefined;
    if (mat) mat.diffuseTexture = tex;
    return tex;
  }

  private texturStreifen(y: number, hoehe: number, data: Uint8Array): void {
    const tex = this.texturSicherstellen();
    this.texturPuffer!.set(data, y * TEX_N * 4);
    tex.update(this.texturPuffer!);
    void hoehe;
  }

  private texturSetzen(data: Uint8Array): void {
    const tex = this.texturSicherstellen();
    this.texturPuffer = data;
    tex.update(data);
  }

  /**
   * Baumsignaturen einer Art als Thin Instances: ein Stamm- und ein
   * Kronen-Mesh je Art, beide mit derselben Matrixliste. Bei ~10 000 Symbolen
   * sind das zwei Draw-Calls pro Waldtyp.
   */
  private baeumeBauen(art: number, data: Float32Array): void {
    const scene = this.scene!;
    const stil = TREE_STYLE[art as TreeKind];
    if (!stil) return;
    const anzahl = data.length / 5;
    if (anzahl === 0) return;

    // Die Symbole sind gegenüber echten Bäumen stark überzeichnet — anders
    // wäre auf einer 21-km-Karte kein Wald zu erkennen. Aber eben nur so
    // stark, dass ein Wald als Textur aus vielen Kronen liest und nicht als
    // Haufen Klekse.
    const hoehe = (stil.height / MAP_UNIT) * 0.7;
    const radius = (stil.radius / MAP_UNIT) * 0.6;

    const teile: Mesh[] = [];
    if (stil.form === 'kegel') {
      const krone = MeshBuilder.CreateCylinder(`kartebaum${art}`, {
        diameterTop: 0, diameterBottom: radius * 2, height: hoehe, tessellation: 6,
      }, scene);
      krone.bakeTransformIntoVertices(Matrix.Translation(0, hoehe / 2, 0));
      teile.push(krone);
    } else if (stil.form === 'kugel') {
      const krone = MeshBuilder.CreateSphere(`kartebaum${art}`, { diameter: radius * 2, segments: 5 }, scene);
      krone.scaling.y = 0.85;
      krone.bakeCurrentTransformIntoVertices();
      krone.bakeTransformIntoVertices(Matrix.Translation(0, hoehe * 0.72, 0));
      teile.push(krone);
    } else if (stil.form === 'zacke') {
      const spitze = MeshBuilder.CreateCylinder(`kartebaum${art}`, {
        diameterTop: 0, diameterBottom: radius * 2.1, height: hoehe, tessellation: 4,
      }, scene);
      spitze.bakeTransformIntoVertices(Matrix.Translation(0, hoehe / 2, 0));
      teile.push(spitze);
    } else {
      // Kahler Baum: schlanker, leicht schiefer Kegel ohne Krone.
      const stamm = MeshBuilder.CreateCylinder(`kartebaum${art}`, {
        diameterTop: radius * 0.15, diameterBottom: radius * 0.8, height: hoehe, tessellation: 5,
      }, scene);
      stamm.bakeTransformIntoVertices(Matrix.Translation(0, hoehe / 2, 0));
      teile.push(stamm);
    }

    const kronenMat = new StandardMaterial(`kartebaummat${art}`, scene);
    kronenMat.diffuseColor = Color3.FromInts(stil.color[0], stil.color[1], stil.color[2]);
    kronenMat.specularColor = Color3.Black();
    kronenMat.emissiveColor = kronenMat.diffuseColor.scale(0.12);
    teile[0].material = kronenMat;

    // Stamm nur dort, wo eine Krone darüber schwebt.
    if (stil.form === 'kegel' || stil.form === 'kugel') {
      const stamm = MeshBuilder.CreateCylinder(`kartestamm${art}`, {
        diameterTop: radius * 0.22, diameterBottom: radius * 0.3,
        height: hoehe * (stil.form === 'kugel' ? 0.78 : 0.35), tessellation: 5,
      }, scene);
      stamm.bakeTransformIntoVertices(Matrix.Translation(0, hoehe * (stil.form === 'kugel' ? 0.39 : 0.175), 0));
      const smat = new StandardMaterial(`kartestammmat${art}`, scene);
      smat.diffuseColor = Color3.FromInts(stil.trunk[0], stil.trunk[1], stil.trunk[2]);
      smat.specularColor = Color3.Black();
      stamm.material = smat;
      teile.push(stamm);
    }

    const matrizen = new Float32Array(anzahl * 16);
    const m = Matrix.Identity();
    for (let i = 0; i < anzahl; i++) {
      const x = data[i * 5];
      const y = data[i * 5 + 1];
      const z = data[i * 5 + 2];
      const s = data[i * 5 + 3];
      const rot = data[i * 5 + 4];
      Matrix.ComposeToRef(
        new Vector3(s, s, s),
        Quaternion.RotationYawPitchRoll(rot, 0, 0),
        new Vector3(x, y, z),
        m,
      );
      m.copyToArray(matrizen, i * 16);
    }
    for (const teil of teile) {
      teil.isPickable = false;
      teil.alwaysSelectAsActiveMesh = true;
      teil.thinInstanceSetBuffer('matrix', matrizen, 16, true);
      this.baumMeshes.push(teil);
    }
  }

  // ---------------------------------------------------------------- Frame ---

  private frame(): void {
    const kamera = this.kamera!;
    const canvas = this.canvas;
    const seiten = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    const sicht = SICHT_PRO_ZOOM * this.zoom;
    kamera.orthoTop = sicht / 2;
    kamera.orthoBottom = -sicht / 2;
    kamera.orthoLeft = (-sicht / 2) * seiten;
    kamera.orthoRight = (sicht / 2) * seiten;
    kamera.beta = this.betaFuer(this.zoom);
    kamera.alpha = -Math.PI / 2;
    kamera.radius = 300;
    kamera.target.set(this.zielX, 0, this.zielZ);

    // Spielerpfeil nachführen.
    const p = this.opts.spieler();
    if (p && this.spielerMarke) {
      const h = this.opts.world.getGroundHeight(p.x, p.z);
      this.spielerMarke.position.set(
        p.x / MAP_UNIT,
        (Math.max(h, WATER_LEVEL) / MAP_UNIT) * HEIGHT_EXAG + 0.9,
        p.z / MAP_UNIT,
      );
      // Blickrichtung des Spielers ist (-sin yaw, -cos yaw); der Pfeil zeigt
      // im Modell nach +Z, also Yaw um PI drehen.
      this.spielerMarke.rotation.y = p.yaw + Math.PI;
      // Damit die Marke in jeder Zoomstufe gleich gross wirkt.
      const s = 0.35 + this.zoom * 0.11;
      this.spielerMarke.scaling.set(s, s, s);
    }
  }

  /**
   * Admin-Teleport an die angeklickte Stelle (Strg+Klick).
   *
   * Nutzt dasselbe Picking wie die Auskunftszeile: Der Strahl trifft das
   * Reliefgitter, dessen Koordinaten mit `MAP_UNIT` in Weltmeter
   * zurückgerechnet werden. Ein Klick daneben (Himmel, Kartenrand)
   * liefert keinen Treffer und wird still verworfen.
   *
   * Wie im Original schließt sich die Karte danach — man will ja sehen,
   * wo man gelandet ist (`Minimap.DebugTeleport` ruft dort
   * `SetMapMode(MapMode.Small)`).
   */
  private teleportAn(px: number, py: number): void {
    const scene = this.scene;
    if (!scene || !this.relief || !this.opts.aufTeleport) return;
    const treffer = scene.pick(px, py, (m) => m === this.relief);
    if (!treffer?.hit || !treffer.pickedPoint) return;
    const x = treffer.pickedPoint.x * MAP_UNIT;
    const z = treffer.pickedPoint.z * MAP_UNIT;
    this.opts.aufTeleport(x, z);
    this.hide();
  }

  /** Weltkoordinate unter dem Mauszeiger bestimmen und die Infozeile füllen. */
  private zeigerAktualisieren(px: number, py: number): void {
    const scene = this.scene;
    if (!scene || !this.relief) return;
    const treffer = scene.pick(px, py, (m) => m === this.relief);
    if (!treffer?.hit || !treffer.pickedPoint) {
      this.zeiger = null;
      this.infoSchreiben();
      return;
    }
    this.zeiger = { x: treffer.pickedPoint.x * MAP_UNIT, z: treffer.pickedPoint.z * MAP_UNIT };
    this.infoSchreiben();
  }

  /** Was an einer Weltstelle liegt — aus dem Worker-Raster, sonst live. */
  private auskunft(x: number, z: number): { biome: Biome; hoehe: number; wald: number } {
    if (this.rasterBiome && this.rasterHoehe && this.rasterWald) {
      const n = this.rasterN;
      const c = Math.min(n - 1, Math.max(0, Math.floor(((x + MAP_SPAN / 2) / MAP_SPAN) * n)));
      const r = Math.min(n - 1, Math.max(0, Math.floor(((z + MAP_SPAN / 2) / MAP_SPAN) * n)));
      const i = r * n + c;
      return { biome: this.rasterBiome[i] as Biome, hoehe: this.rasterHoehe[i], wald: this.rasterWald[i] };
    }
    const geo = this.opts.world.geo;
    const biome = geo.getBiome(x, z);
    return { biome, hoehe: geo.getHeight(x, z), wald: 0 };
  }

  private infoSchreiben(): void {
    const p = this.opts.spieler();
    const ziel = this.zeiger ?? (p ? { x: p.x, z: p.z } : null);
    if (!ziel) { this.infoZeile.innerHTML = ''; return; }

    const { biome, hoehe } = this.auskunft(ziel.x, ziel.z);
    const geo = this.opts.world.geo;
    const ff = geo.getForestFactor(ziel.x, ziel.z);
    const ueberWasser = hoehe - WATER_LEVEL;
    const imWasser = biome === Biome.Ocean || ueberWasser < 0;
    const area = biome === Biome.BlackForest ? geo.getBiomeArea(ziel.x, ziel.z) : BiomeArea.Everything;
    const art = imWasser ? null : treeKindAt(biome, area, ff, ueberWasser);

    const zeilen: string[] = [];
    zeilen.push(`<div style="color:${UI.gold};font-size:14px;letter-spacing:.08em">${BIOME_LABEL[biome] ?? '—'}</div>`);
    zeilen.push(
      `<div style="color:${UI.muted}">${this.zeiger ? 'unter dem Zeiger' : 'Standort'}: `
      + `${ziel.x.toFixed(0)} / ${ziel.z.toFixed(0)}</div>`,
    );
    zeilen.push(imWasser
      ? `<div>Wassertiefe ${Math.max(0, -ueberWasser).toFixed(0)} m</div>`
      : `<div>Höhe ${ueberWasser.toFixed(0)} m über dem Meer</div>`);
    if (!imWasser) {
      const bewuchs = art ? TREE_STYLE[art].label : 'ohne Baumbestand';
      zeilen.push(`<div>${forestLabel(ff)} — ${bewuchs}</div>`);
    }
    zeilen.push(
      `<div style="color:${UI.muted};margin-top:4px;max-width:250px">`
      + `${BIOME_INHALT[biome] ?? ''}</div>`,
    );
    if (p && this.zeiger) {
      const d = Math.hypot(ziel.x - p.x, ziel.z - p.z);
      zeilen.push(`<div style="color:${UI.muted}">${d.toFixed(0)} m vom Spieler</div>`);
    }
    // Dungeon-Eingang unter dem Zeiger? (Suchradius wächst mit dem Zoom,
    // damit man beim Blick auf die ganze Welt nicht pixelgenau treffen muss.)
    if (this.zeiger) {
      const radius = 30 + this.zoom * 25;
      let bester: { feature: string; dungeonId: string; d: number } | null = null;
      for (const e of this.dungeonEingaenge) {
        const d = Math.hypot(e.x - ziel.x, e.z - ziel.z);
        if (d <= radius && (bester === null || d < bester.d)) {
          bester = { feature: e.feature, dungeonId: e.dungeonId, d };
        }
      }
      if (bester) {
        zeilen.push(
          `<div style="color:#e08050;margin-top:4px">⯁ Dungeon: ${bester.feature}</div>`
          + `<div style="color:${UI.muted}">ID ${bester.dungeonId}</div>`,
        );
      }
    }
    this.infoZeile.innerHTML = zeilen.join('');
  }

  // -------------------------------------------------------------- Anzeige ---

  get isVisible(): boolean { return this.sichtbar; }

  /** Diagnose: wie viele Eingangs-Marker die Karte gerade trägt. */
  get eingangsMarkerAnzahl(): number {
    return this.eingangsMarke?.thinInstanceCount ?? 0;
  }

  show(): void {
    if (this.sichtbar) return;
    this.sichtbar = true;
    this.root.style.display = 'block';
    if (!this.scene) this.szeneBauen();
    this.engine!.resize();
    // Beim Öffnen auf den Spieler zentrieren, wie es die Karte im Original tut.
    this.zumSpieler();
    this.infoSchreiben();
    this.engine!.runRenderLoop(() => this.scene!.render());
  }

  hide(): void {
    if (!this.sichtbar) return;
    this.sichtbar = false;
    this.root.style.display = 'none';
    this.ziehtVon = null;
    this.engine?.stopRenderLoop();
  }

  toggle(): void { this.sichtbar ? this.hide() : this.show(); }

  /** Ansicht auf den Spieler zentrieren (Leertaste). */
  zumSpieler(): void {
    const p = this.opts.spieler();
    if (!p) return;
    this.zielX = p.x / MAP_UNIT;
    this.zielZ = p.z / MAP_UNIT;
    this.grenzen();
  }

  /** Tastendrücke, die nur bei offener Karte gelten. */
  taste(code: string): boolean {
    if (!this.sichtbar) return false;
    if (code === 'Space') { this.zumSpieler(); return true; }
    if (code === 'Equal' || code === 'NumpadAdd') { this.zoomen(-0.6); return true; }
    if (code === 'Minus' || code === 'NumpadSubtract') { this.zoomen(0.6); return true; }
    return false;
  }

  /** Ist die Karte fertig gerechnet? (Für Statusanzeigen/Tests.) */
  get bereit(): boolean { return this.fertig; }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    window.removeEventListener('resize', this.aufResize);
    this.engine?.stopRenderLoop();
    this.scene?.dispose();
    this.engine?.dispose();
    this.root.remove();
  }
}
