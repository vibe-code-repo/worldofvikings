/**
 * Valheim Babylon Client — Entry Point (Phase 2 / M0.1).
 *
 * Phase 1: walk through the real generated world (terrain, sky, day/night).
 * Phase 2: connected to the authoritative server — ZDO sync renders
 * vegetation/pieces as thin instances and creatures as entities; server
 * world time drives the lighting.
 *
 * M0.1: the world is no longer built from a hardcoded seed. Online, the
 * client waits for the server's ServerConfig packet (type 52) and builds
 * its GeoManager from the server's actual seed + worldgen flags — client
 * and server can no longer render different worlds. A custom seed can
 * only be chosen for the OFFLINE (no server) case on the connect screen,
 * since a live multiplayer world's seed is fixed for good the moment the
 * server finishes booting (world generation completes before the server
 * even starts listening — see Docs/Migrationsplan-Differenzen-und-Aufgaben.md).
 * To play with a custom seed online, start a fresh server with
 * WORLD_SEED=<seed> (server/src/main.ts) instead.
 *
 * ?offline=1 skips the connect screen and builds a local world immediately
 * (?seed=<seed> optional); useful for quick dev/Playwright probes.
 */
import { Engine, WebGPUEngine } from '@babylonjs/core/Engines';
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.query';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import {
  WATER_LEVEL,
  ESSEN,
  sanitizeWorldLayout,
  layoutBounds,
  layoutKennung,
  loeseNpcAuf,
  istNpcPrefab,
  RegionGeo,
  PLATEAU_RAND_MAX,
  PacketType,
  PrefabFlag,
  findPrefabByName,
  getStableHash,
  opRadius,
  dekodiereTerrainComp,
  TERRAIN_HIT_OPS,
  Inventory,
  findItem,
  WeatherManager,
  WORLD_TIME_LENGTH,
  FRACTION_SUNRISE,
  FRACTION_MIDDAY,
  FRACTION_SUNSET,
} from '@wov/shared';
import type { NpcDef, NpcEinordnung, TerrainComp } from '@wov/shared';
import { createWorld, DEFAULT_OFFLINE_SEED, type ClientWorld, type ClientWorldSettings } from './world/World';
import { TerrainManager } from './engine/Terrain';
import { Lighting } from './engine/Lighting';
import { installiereStandardGammaFix } from './engine/StandardGammaFix';
import { installierePbrNebelFix } from './engine/PbrNebelFix';
import { installiereNebelRichtung } from './engine/NebelRichtung';
import {
  installiereFackelLicht,
  fackelNotbremse,
  fackelNotbremseLoesen,
  FackelLichter,
} from './engine/FackelLicht';
import { InputManager } from './engine/InputManager';
import { leseUndLeere as feinmessungLesen, setzeAktiv as feinmessungSetzen } from './engine/Zeitmessung';
import { AssetManager } from './engine/AssetManager';
import { WindPlugin } from './engine/WindPlugin';
import { ClutterWindPlugin } from './engine/ClutterWindPlugin';
import { GlutPuls } from './engine/GlutPuls';
import { initPhysics, bodenHoeheUnter } from './engine/Physics';
import { WaterPlugin } from './engine/WaterPlugin';
import { Precipitation } from './engine/Precipitation';
import { EntityManager } from './entities/EntityManager';
import { BaumImpostor } from './engine/BaumImpostor';
import { PlayerController } from './player/PlayerController';
import { GameSocket } from './net/GameSocket';
import { parseZDOSync, ZDOSpiegel } from './net/ZDOSync';
import { Hud } from './ui/Hud';
import { GrassClutter } from './engine/GrassClutter';
import { HuegelGras } from './engine/HuegelGras';
import { SettingsStore, VEGETATION_RANGE } from './ui/Settings';
import { SettingsPanel } from './ui/SettingsPanel';
import { PostProcessing } from './engine/PostProcessing';
import { Shadows } from './engine/Shadows';
import { RENDER_SCALE } from './ui/Settings';
import { LoadingScreen } from './ui/LoadingScreen';
import { Equipment } from './player/Equipment';
import { Hotbar } from './ui/Hotbar';
import { InventoryPanel } from './ui/InventoryPanel';
import { PlacementController } from './player/PlacementController';
import { PieceSelection } from './ui/PieceSelection';
import { ObjectLabels } from './ui/ObjectLabels';
import { Anvisiert } from './ui/Anvisiert';
import { Namensschilder } from './ui/Namensschild';
import { WorldMap } from './ui/WorldMap';
import { setzeKartenMasse } from './ui/worldmap/mapTypes';
import { SpawnPanel } from './editor/SpawnPanel';
import { RoutenEditor } from './editor/RoutenEditor';
import { RoutenVorschau } from './editor/RoutenVorschau';
import { BewuchsVorschau } from './editor/BewuchsVorschau';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DungeonEditor } from './ui/DungeonEditor';
import { Minimap } from './ui/Minimap';
import { LightPool } from './engine/LightPool';
import { CraftingPanel } from './ui/CraftingPanel';
import { GameAudio } from './engine/GameAudio';
import {
  aktiviereWebGpuGlslKompatibilitaet,
  istWebGpuGlslKompatibilitaetAktiv,
} from './engine/WebGpuKompatibilitaet';

const INPUT_SEND_RATE_MS = 50; // 20 Hz like the old client / original

/**
 * Bauwerke, in deren Grundfläche kein Gelände-Gras wachsen darf.
 *
 * Gemeint sind die mit begehbarem Innenraum, deren Boden auf Geländehöhe
 * liegt (siehe BEGEHBAR in entities/EntityManager.ts). Beim Steinkreis wäre
 * es falsch — dort SOLL Gras zwischen den Steinen stehen —, in einer
 * Grabkammer wächst sonst eine Wiese unter dem Totenschiff.
 */
const INNENRAUM_OHNE_GRAS = /^(Grabhuegel)/i;

// ServerConfig packet flag bits (D6) — same order server-side (WovServer.ts)
const FLAG_BLEND_SMOOTHSTEP = 1 << 0;
const FLAG_BILINEAR_HEIGHT = 1 << 1;
const FLAG_ASHLANDS_MODERN = 1 << 2;
const FLAG_RIVER_AFFECTS_OCEAN = 1 << 3;
const FLAG_DISABLE_DISTANT_RIVERS = 1 << 4;
/** Kündigt an, dass direkt nach ServerConfig ein WorldLayoutData folgt. */
const FLAG_LAYOUT_MODE = 1 << 5;

/** Compass point for a bearing in degrees (0 = north) — HUD readability. */
function compass(deg: number): string {
  const points = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(deg / 45) % 8];
}

/** Random 10-char alnum seed for the "🎲" button / offline default. */
function randomSeed(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function createEngine(canvas: HTMLCanvasElement) {
  // Der Opt-in bleibt absichtlich in der URL, bis Bildparitaet und Gewinn auf
  // echter Hardware gemessen sind. Die Material-Plugins bleiben vorerst GLSL;
  // Babylon uebersetzt sie fuer WebGPU (siehe WebGpuKompatibilitaet.ts).
  const params = new URLSearchParams(location.search);
  const webGpuAngefordert = params.has('webgpu');
  const performanceDiagnose = params.has('perf');
  const webGpuBundles = params.has('bundles');
  if (webGpuAngefordert) {
    if (await WebGPUEngine.IsSupportedAsync) {
      aktiviereWebGpuGlslKompatibilitaet();
      const engine = new WebGPUEngine(canvas, {
        antialias: true,
        powerPreference: 'high-performance',
        // Nur der ausdrueckliche Messlauf fordert optionale Adapter-Features
        // an. Dazu gehoert `timestamp-query`, mit dem Babylon die echte
        // GPU-Zeit eines Frames erfassen kann. Im normalen Spiel bleibt der
        // Device-Descriptor und damit auch der Laufzeitpfad unveraendert.
        enableAllFeatures: performanceDiagnose,
      });
      // Babylons Standard ist der vorsichtige Kompatibilitaetsmodus, der
      // jeden Draw Call unmittelbar in den RenderPassEncoder schreibt. Der
      // Nicht-Kompatibilitaetsmodus fasst unveraenderte Befehle in WebGPU-
      // Render-Bundles zusammen und ist der eigentliche CPU-Hebel des neuen
      // Backends. Bis die Bildparitaet bestaetigt ist, bleibt er ein eigener
      // Opt-in (`&bundles=1`).
      engine.compatibilityMode = !webGpuBundles;
      await engine.initAsync();
      console.log(
        `[engine] WebGPU (GLSL-Kompatibilitaet: ${istWebGpuGlslKompatibilitaetAktiv() ? 'aktiv' : 'FEHLER'}, ` +
        `Render-Bundles: ${webGpuBundles ? 'aktiv' : 'aus'})`
      );
      return engine;
    }
    console.warn(
      '[engine] ?webgpu=1 angefordert, aber WebGPU ist in diesem Browser/Kontext nicht verfuegbar; WebGL2-Fallback'
    );
  }
  console.log('[engine] WebGL2');
  // `powerPreference: 'high-performance'` ist auf Geräten mit zwei GPUs
  // (Laptop: iGPU + dGPU) der Unterschied zwischen Onboard-Grafik und
  // echter Karte — ohne die Angabe wählt der Browser gern die sparsame.
  // `adaptToDeviceRatio` bleibt AUS (Default): Auf einem HiDPI-Schirm
  // würde es die Pixelzahl vervierfachen; die Auflösung regelt stattdessen
  // die Einstellung "Renderauflösung" (engine.setHardwareScalingLevel).
  return new Engine(canvas, true, { stencil: true, powerPreference: 'high-performance' });
}

/**
 * Automatische CPU-/GPU-Aufschluesselung fuer echte Browser-Hardware.
 *
 * Aufruf ueber `?webgpu=1&perf=1`; absichtlich keine dauerhafte HUD-Anzeige
 * und kein Console-Paste notwendig. `frame` misst Babylons gesamten
 * CPU-Frame, `render` nur den Renderabschnitt und `pause` die Zeit zwischen
 * zwei Frames (typischerweise Browser/VSync). Die GPU-Zeit kommt unter
 * WebGPU aus Timestamp Queries und wird von Nanosekunden in Millisekunden
 * umgerechnet.
 */
function aktivierePerformanceDiagnose(
  engine: Engine | WebGPUEngine,
  scene: Scene,
  teilsystemProfil: () => string
): void {
  if (!new URLSearchParams(location.search).has('perf')) return;

  const szeneMessung = new SceneInstrumentation(scene);
  szeneMessung.captureFrameTime = true;
  szeneMessung.captureRenderTime = true;
  szeneMessung.captureInterFrameTime = true;
  szeneMessung.captureActiveMeshesEvaluationTime = true;
  szeneMessung.captureRenderTargetsRenderTime = true;

  const engineMessung = new EngineInstrumentation(engine);
  if (engine.isWebGPU) engineMessung.captureGPUFrameTime = true;
  engineMessung.captureShaderCompilationTime = true;

  window.setInterval(() => {
    const gpuNs = engine.isWebGPU
      ? engineMessung.gpuFrameTimeCounter.lastSecAverage
      : 0;
    const gpuText = gpuNs > 0 ? `${(gpuNs / 1_000_000).toFixed(2)} ms` : 'nicht verfuegbar';
    const shader = engineMessung.shaderCompilationTimeCounter;
    console.log(
      '[perf]',
      `renderer=${engine.isWebGPU ? 'WebGPU' : 'WebGL2'}`,
      `fps=${engine.getFps().toFixed(1)}`,
      `frame=${szeneMessung.frameTimeCounter.lastSecAverage.toFixed(2)} ms`,
      `render=${szeneMessung.renderTimeCounter.lastSecAverage.toFixed(2)} ms`,
      `pause=${szeneMessung.interFrameTimeCounter.lastSecAverage.toFixed(2)} ms`,
      `gpu=${gpuText}`,
      `shader=${shader.total.toFixed(0)}ms/${shader.count}x/max${shader.max.toFixed(0)}ms`,
      `bundles=${engine.isWebGPU && !(engine as WebGPUEngine).compatibilityMode ? 'an' : 'aus'}`,
      `targets=${szeneMessung.renderTargetsRenderTimeCounter.lastSecAverage.toFixed(2)} ms`,
      `active=${szeneMessung.activeMeshesEvaluationTimeCounter.lastSecAverage.toFixed(2)} ms`,
      `draws=${szeneMessung.drawCallsCounter.current}`,
      `size=${engine.getRenderWidth()}x${engine.getRenderHeight()}`,
      `scale=${engine.getHardwareScalingLevel().toFixed(3)}`,
      `visible=${document.visibilityState}`,
      teilsystemProfil()
    );
  }, 5_000);
}

async function main() {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const connectScreen = document.getElementById('connect-screen')!;
  const nameInput = document.getElementById('player-name') as HTMLInputElement;
  const urlInput = document.getElementById('server-url') as HTMLInputElement;
  const offlineToggle = document.getElementById('offline-toggle') as HTMLInputElement;
  const seedInput = document.getElementById('world-seed') as HTMLInputElement;
  const genSeedBtn = document.getElementById('gen-seed-btn') as HTMLButtonElement;
  const seedHint = document.getElementById('seed-hint')!;
  const timeSelect = document.getElementById('start-time') as HTMLSelectElement;
  const timeHint = document.getElementById('time-hint')!;
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const connectStatus = document.getElementById('connect-status')!;

  // ── Uhrzeit-Auswahl im Verbinden-Fenster ────────────────────────────
  //
  // Ein Spieltag dauert WORLD_TIME_LENGTH Sekunden; angezeigt wird er wie
  // eine 24-Stunden-Uhr, genau wie im HUD ("zeit 4.3h"). Die Marken kommen
  // aus dem Umgebungsmodell statt aus einer zweiten Tabelle — Valheims
  // Sonnenaufgang liegt bei 0.1333 des Tages, also gegen 03:00, nicht bei
  // 06:00, und eine handgeschriebene Beschriftung würde das früher oder
  // später falsch behaupten.
  const STUNDEN_MARKEN = new Map<number, string>([
    [0, 'Mitternacht'],
    [Math.round(FRACTION_SUNRISE * 24), 'Sonnenaufgang'],
    [Math.round(FRACTION_MIDDAY * 24), 'Mittag'],
    [Math.round(FRACTION_SUNSET * 24), 'Sonnenuntergang'],
  ]);
  {
    const serverOption = document.createElement('option');
    serverOption.value = '';
    serverOption.textContent = 'Serverzeit übernehmen';
    timeSelect.appendChild(serverOption);
    for (let h = 0; h < 24; h++) {
      const o = document.createElement('option');
      o.value = String(h);
      const marke = STUNDEN_MARKEN.get(h);
      o.textContent = `${String(h).padStart(2, '0')}:00${marke ? ` – ${marke}` : ''}`;
      timeSelect.appendChild(o);
    }
  }

  /** Gewählte Stunde, oder null für "Serverzeit übernehmen". */
  const gewaehlteStunde = (): number | null => {
    if (timeSelect.value === '') return null;
    const h = Number(timeSelect.value);
    return Number.isFinite(h) ? h : null;
  };

  const updateTimeHint = (): void => {
    const h = gewaehlteStunde();
    timeHint.textContent =
      h === null
        ? 'Die Welt startet mit der Zeit, die der Server gerade hat.'
        : offlineToggle.checked
          ? 'Wird lokal gesetzt.'
          : 'Wird auf dem Server gesetzt — gilt für alle Spieler.';
  };
  timeSelect.addEventListener('change', updateTimeHint);
  offlineToggle.addEventListener('change', updateTimeHint);
  updateTimeHint();

  const engine = await createEngine(canvas);
  const scene = new Scene(engine);
  // Babylon calls preventDefault() on pointerdown by default, and per the
  // Pointer Events spec that suppresses the compatibility mouse events the
  // browser would otherwise synthesise. InputManager listens for mousedown /
  // mouseup, so every left click was swallowed before it ever reached the
  // tool — only `click` survived, which is why the build menu worked and
  // terraforming did not. Firefox follows the spec here; Chrome is laxer,
  // which is why this only showed up in Firefox.
  scene.preventDefaultOnPointerDown = false;
  scene.preventDefaultOnPointerUp = false;

  // Muss vor jedem StandardMaterial und vor `blockMaterialDirtyMechanism`
  // (weiter unten) laufen — siehe StandardGammaFix.ts.
  installiereStandardGammaFix(scene);
  installierePbrNebelFix(scene);
  // Gerichteter Nebel pro Pixel — dieselbe Bedingung, derselbe Grund.
  installiereNebelRichtung(scene);
  // Fackel-Uniform-Array: hier und nicht erst bei `new LightPool(...)`, weil
  // das Plugin an JEDEM Material hängen muss, bevor der erste Effekt
  // übersetzt und `blockMaterialDirtyMechanism` gesetzt wird.
  installiereFackelLicht(scene);

  const lighting = new Lighting(scene);
  const input = new InputManager(canvas);
  const assets = new AssetManager(scene);
  const hud = new Hud();

  // Without the pointer lock the mouse buttons do nothing and the camera can't
  // be turned — the game looks broken while it is only waiting for a click on
  // the canvas. Clicking a hotbar slot or the connect button never grabs it, so
  // say so instead of leaving the player guessing.
  const lockHint = document.createElement('div');
  const HINT_CLICK = 'Ins Bild klicken, um die Maus zu fangen (Esc gibt sie frei)';
  // The browser refuses the lock in cases we cannot control (right after an
  // Escape unlock, for one). Drag-look keeps the game playable there.
  const HINT_DENIED = 'Maus konnte nicht gefangen werden — zum Umsehen mit gedrückter linker Taste ziehen, kurzer Klick benutzt das Werkzeug';
  lockHint.textContent = HINT_CLICK;
  lockHint.style.cssText = [
    'position:fixed', 'left:50%', 'top:24px', 'transform:translateX(-50%)',
    'z-index:960', 'display:none', 'pointer-events:none',
    'padding:6px 14px', 'border-radius:4px',
    'background:rgba(20,16,12,.72)', 'border:1px solid rgba(190,160,110,.35)',
    'font-family:system-ui,sans-serif', 'font-size:13px', 'color:#e8d9b8',
    'text-shadow:0 1px 3px #000',
  ].join(';');
  document.body.appendChild(lockHint);
  let lockHintState = '';
  const updateLockHint = (): void => {
    // Only once a world exists — during the connect screen it would be noise.
    // Deliberately playing without the lock needs no hint at all: the drag
    // controls are the normal ones then, not a fallback.
    const show = world !== null && document.pointerLockElement !== canvas && !input.playingUnlocked;
    const state = show ? (input.lockDenied ? 'denied' : 'click') : '';
    if (state === lockHintState) return;
    lockHintState = state;
    lockHint.style.display = show ? 'block' : 'none';
    if (show) lockHint.textContent = state === 'denied' ? HINT_DENIED : HINT_CLICK;
  };
  document.addEventListener('pointerlockchange', updateLockHint);

  const params = new URLSearchParams(location.search);

  // World-dependent systems — only exist once the world (seed) is known.
  let world: ClientWorld | null = null;
  /** Spawn-Editor des Testflugs offen? (gibt die Maus frei, s. cursorNoetig) */
  let spawnEditorOffen: () => boolean = () => false;
  /** Routen-Editor des Testflugs offen? (dito — Liste/Regler brauchen den Zeiger) */
  let routenEditorOffen: () => boolean = () => false;
  /** Auto-Reconnect-Zähler (Review-Punkt 9) — Reset bei erfolgreicher Verbindung. */
  let reconnectVersuch = 0;
  /** Layout-Handshake: ServerConfig kündigte ein WorldLayoutData an. */
  let layoutErwartet: { worldSeed: string; settings: ClientWorldSettings } | null = null;
  /** Aktives WorldLayout (Layout-Modus) — Karte/Editor lesen es mit. */
  let worldLayout: unknown = null;
  /**
   * Sockel-Platzierungen (`einebnen`) für die Gras-Aussparung: Auf der
   * ganzen Platte wächst kein Klutter-Gras. Der 0,62-Innenraum von
   * INNENRAUM_OHNE_GRAS reicht dafür nicht — Gang und Portal des
   * Grabhügels liegen außerhalb, dort stand Gras im Eingang. Gefüllt aus
   * dem Layout (buildWorld), im Testflug live gepflegt (sockelLiveDazu/-Weg).
   */
  let sockelFreiflaechen: Array<{ x: number; z: number; r: number }> = [];
  let terrain: TerrainManager | null = null;
  let player: PlayerController | null = null;
  let entities: EntityManager | null = null;
  let baumImpostor: BaumImpostor | null = null;
  let grass: GrassClutter | null = null;
  let huegelGras: HuegelGras | null = null;
  let post: PostProcessing | null = null;
  let shadows: Shadows | null = null;
  let loading: LoadingScreen | null = null;
  let inventory: Inventory | null = null;
  let equipment: Equipment | null = null;
  let hotbar: Hotbar | null = null;
  let inventoryPanel: InventoryPanel | null = null;
  let placement: PlacementController | null = null;
  let pieceSelection: PieceSelection | null = null;
  let worldMap: WorldMap | null = null;
  let minimap: Minimap | null = null;
  let lightPool: LightPool | null = null;
  const craftingPanel = new CraftingPanel(
    () => inventory,
    (t) => hud.meldung(t),
    (ergebnis) => {
      if (!socket?.connected) return false;
      socket.sendCraft(ergebnis);
      return true;
    }
  );
  let socket: GameSocket | null = null;
  let netStatus = 'offline';
  let inputAccum = 0;
  /**
   * Phase G: in einer Dungeon-Instanz? Gesetzt vom Teleport-Paket des
   * Servers. Schaltet Terrain-Streaming, Wasser, Gras, Niederschlag und
   * Wetter-Environment ab und meldet die Physik-Höhe an den Server
   * (moveY-Feld — dort gibt es keine Heightmap).
   */
  let imDungeon = false;
  /** Interior-Environment der aktuellen Instanz (z. B. 'Crypt'). */
  let dungeonEnv = 'Crypt';
  /** Einstiegspunkt in der Instanz — nur dort wirkt E als "Verlassen". */
  let dungeonSpawn = { x: 0, y: 0, z: 0 };
  /** Zeitpunkt des Instanz-Teleports — Timeout-Schranke fürs Einfrieren. */
  let dungeonLadenSeit = 0;
  /** Schlag-Sperre (s) — verhindert Dauerfeuer beim Klicken. */
  let angriffCooldown = 0;
  /** Letzte Server-Spielerposition (PlayerState) — Soft-Reconciliation. */
  let serverPos: { x: number; y: number; z: number } | null = null;
  // Audio: startet mit der ersten Nutzergeste (Browser-Autoplay-Regel).
  const audio = new GameAudio();
  window.addEventListener('pointerdown', () => audio.start(), { once: true });
  window.addEventListener('keydown', () => audio.start(), { once: true });
  /** Dungeon-Eingänge vom Server — Kartenmarker (kommen ggf. vor buildWorld). */
  let dungeonEingaenge: Array<{ feature: string; dungeonId: string; x: number; z: number }> = [];
  // F4-Editor: DOM-Panel, existiert von Anfang an (nur online nutzbar —
  // die Callbacks greifen dynamisch auf `socket` zu).
  const dungeonEditor = new DungeonEditor({
    anfordern: (id) => socket?.sendDungeonEditRequest(id),
    speichern: (json) => socket?.sendDungeonEditSave(json),
    admin: (line) => socket?.sendAdminCommand(line),
    meldung: (text) => hud.meldung(text),
  });
  /**
   * Absolute world seconds. Seeded by TimeSync and advanced locally in
   * between, because the weather and the wind are pure functions of it —
   * letting it stand still between packets would freeze both.
   */
  let worldTime = 0;
  /**
   * Im Verbinden-Fenster gewählte Uhrzeit, in Sekunden innerhalb des Tages;
   * null heisst "Serverzeit übernehmen".
   *
   * Gesendet wird erst beim ERSTEN TimeSync, nicht in `onConnected`: Das
   * feuert direkt nach dem Absenden der Anmeldung, der Server hat den Peer
   * zu dem Zeitpunkt noch nicht eingebucht und würde das Paket verwerfen.
   * Sein erstes TimeSync schickt er dagegen erst, wenn der Spieler steht
   * (WovServer.onPeerSpawn) — das ist der früheste sichere Moment.
   */
  let zeitWunsch: number | null = null;
  let weather: WeatherManager | null = null;
  let precipitation: Precipitation | null = null;
  let objectLabels: ObjectLabels | null = null;
  let anvisiert: Anvisiert | null = null;
  /** Namensschilder über Figuren (Name, Stufe, Leben, Quest-Zeichen). */
  let namensschilder: Namensschilder | null = null;
  /** Sekunden seit dem letzten Abgleich der Gras-Aussparungen. */
  let clearingTimer = 0;

  // "Vegetationsqualität" / "Detailgrad" — real Valheim graphics settings
  // (GraphicsSettingInt.Vegetation/LOD), see ui/Settings.ts. Registered
  // after the `let terrain`/`let grass` declarations above: onChange()
  // fires its callback immediately with the current state, and referencing
  // those bindings any earlier throws (temporal dead zone).
  const gameSettings = new SettingsStore();
  const settingsPanel = new SettingsPanel(gameSettings);
  gameSettings.onChange((s) => {
    terrain?.setDetailQuality(s.detailQuality);
    terrain?.setWaterQuality(s.waterQuality);
    grass?.setQuality(s.vegetationQuality);
    grass?.setDensity(s.grassDensity);
    // Das 100-FPS-Profil ist ein reproduzierbares Gesamtpaket, kein
    // vierter Schatten-Regler: Die gespeicherten Einzelwerte bleiben
    // unangetastet und gelten nach dem Abschalten sofort wieder.
    post?.apply(s.hundertFpsProfil
      ? {
          ...s,
          motionBlur: false,
          depthOfField: false,
          sunShafts: false,
          ambientOcclusion: false,
          temporalAA: false,
        }
      : s);
    shadows?.setHundertFpsProfil(s.hundertFpsProfil);
    shadows?.setLevel(s.hundertFpsProfil ? 1 : s.shadowQuality);
    shadows?.setDistantShadows(s.hundertFpsProfil ? false : s.distantShadows);
    entities?.setHundertFpsProfil(s.hundertFpsProfil);
    entities?.setVegetationsGrenze(VEGETATION_RANGE[s.vegetationRange] ?? 0);
    // Renderauflösung: setHardwareScalingLevel(1/faktor) — Wert > 1 rendert
    // KLEINER als das Fenster und skaliert beim Ausgeben hoch. Der Effekt
    // ist quadratisch (75 % Kantenlänge = 44 % weniger Pixel) und damit der
    // stärkste Einzelhebel, den wir dem Nutzer geben können.
    engine.setHardwareScalingLevel(1 / (RENDER_SCALE[s.renderScale] ?? 1));
    input.setUseLock(s.pointerLock);
    objectLabels?.setEnabled(s.showObjectNames);
    namensschilder?.setEnabled(s.nameplates);
    namensschilder?.setEigenes(s.eigenesNameplate);
  });
  /** ?env= pins the weather — don't let the biome tracker override it. */
  let envPinned = false;

  // ── Connect-screen seed field: only meaningful offline (see file header) ──
  function updateSeedFieldState(): void {
    const offline = offlineToggle.checked;
    seedInput.disabled = !offline;
    genSeedBtn.disabled = !offline;
    seedHint.textContent = offline
      ? 'Eigener Seed für die lokale Welt (leer = zufällig).'
      : 'Seed wird vom Server vorgegeben (nur im Offline-Modus wählbar).';
  }
  offlineToggle.addEventListener('change', updateSeedFieldState);
  genSeedBtn.addEventListener('click', () => {
    seedInput.value = randomSeed();
  });
  updateSeedFieldState();

  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  urlInput.value = `${wsProto}://${location.host}/ws`;
  nameInput.value = `Viking${Math.floor(Math.random() * 1000)}`;

  /**
   * Zeitmessung je Abschnitt der Spielschleife (nur Diagnose).
   *
   * `performance.now()` kostet selbst etwas, deshalb wird nur an wenigen
   * groben Stellen gemessen — feiner aufzulösen würde das Ergebnis
   * verfälschen. Auslesen und zurücksetzen über `__vb.profil()`.
   */
  const zeitmess: Record<string, { summe: number; max: number; n: number }> = {
    spieler: { summe: 0, max: 0, n: 0 },
    terrain: { summe: 0, max: 0, n: 0 },
    gras: { summe: 0, max: 0, n: 0 },
    entities: { summe: 0, max: 0, n: 0 },
    rest: { summe: 0, max: 0, n: 0 },
  };
  let gemessenDieserFrame = 0;
  /**
   * Stand des kumulativen Zeichenaufruf-Zählers beim letzten profil() —
   * die Bezugsgrösse für `zeichenaufrufeProBild`, s. dort.
   */
  let letzteZeichenaufrufe = 0;
  const miss = <T>(feld: string, fn: () => T): T => {
    const t0 = performance.now();
    const r = fn();
    const dt = performance.now() - t0;
    gemessenDieserFrame += dt;
    const e = zeitmess[feld]!;
    e.summe += dt; e.n++;
    if (dt > e.max) e.max = dt;
    return r;
  };
  const teilsystemProfil = (): string => {
    const teile: string[] = [];
    for (const [name, messung] of Object.entries(zeitmess)) {
      if (messung.n > 0) {
        teile.push(
          `${name}=${(messung.summe / messung.n).toFixed(2)}/${messung.max.toFixed(2)}ms`
        );
      }
      messung.summe = 0;
      messung.max = 0;
      messung.n = 0;
    }
    const s = gameSettings.get();
    return (
      `update(avg/max) ${teile.join(' ')} ` +
      `settings=100fps:${s.hundertFpsProfil ? 'an' : 'aus'},` +
      `shadow:${s.shadowQuality},water:${s.waterQuality},vegetation:${s.vegetationRange},` +
      `grass:${s.grassDensity},render:${s.renderScale}`
    );
  };
  aktivierePerformanceDiagnose(engine, scene, teilsystemProfil);

  /**
   * D9: Terraforming-Endzustände, die vor der Welt eintrafen.
   *
   * Das Paket kommt bei der Anmeldung und damit theoretisch vor
   * `buildWorld`. Der alte Code verwarf es in dem Fall stillschweigend —
   * die Welt hätte dann für immer unbearbeitetes Gelände gezeigt.
   */
  let offeneTerrainComps: TerrainComp[] = [];

  function wendeTerrainCompsAn(): void {
    if (!world || offeneTerrainComps.length === 0) return;
    for (const comp of offeneTerrainComps) {
      world.heightmaps.restoreTerrainComp(comp);
      // Kacheln, die es noch nicht gibt, ignoriert refreshZones — sie holen
      // sich den Comp später ohnehin über getZone().
      terrain?.refreshZones([[comp.zoneX, comp.zoneY]]);
      if (comp.hasPaint) terrain?.refreshPaint(comp.zoneX, comp.zoneY);
    }
    // Gras braucht hier NICHTS: Es entsteht erst nach dem Weltaufbau und
    // fragt je Halm `isCleared` (s. GrassClutter) — die Freiflächen stehen
    // zu dem Zeitpunkt schon. Nur beim Reconnect in eine bereits gebaute
    // Welt kann alter Bewuchs auf frisch übernommenen Wegen stehen bleiben;
    // die nächste Neugenerierung der Kachel räumt ihn weg.
    offeneTerrainComps = [];
  }

  /** Builds all world-dependent systems and starts the game loop (once). */
  function buildWorld(seed: string, settings?: ClientWorldSettings, layout?: unknown): void {
    // Reconnect-Guard (Review-Punkt 9): Die Weltsysteme existieren nach dem
    // ersten Aufbau weiter — ein zweiter Aufbau leakte Terrain, Physik,
    // Entities und eine komplette zweite Karten-Engine. Der neue Socket hat
    // seine Handler bereits registriert; es gibt nichts nachzubauen.
    if (world) {
      console.log('[world] Reconnect — bestehende Weltsysteme werden weiterverwendet');
      return;
    }
    worldLayout = layout ?? null;
    // Gras-Freiflächen der Sockel-Platzierungen einsammeln: Der Klutter
    // kennt später nur Prefab-Instanzen, nicht das Layout — hier ist der
    // eine Ort, an dem BEIDE Pfade (Online-Paket 64 wie Testflug-Entwurf)
    // mit dem vollständigen Dokument vorbeikommen.
    const sockelLayout = layout ? sanitizeWorldLayout(layout) : null;
    sockelFreiflaechen = (sockelLayout?.placements ?? [])
      .filter((p) => p.einebnen !== undefined)
      .map((p) => ({ x: p.x, z: p.z, r: p.einebnen! }));
    // Nachschlagewerk für die Namensschilder: Kennung → Einordnung. Der
    // Server schickt an jeder gespawnten Instanz nur die Kennung (ZDO-Member
    // `layoutId`, steht dort ohnehin) — Name, Rolle, Fraktion, Stufe und
    // Quest-Zustand holt der Client aus dem Dokument, das er längst hat.
    // Dieselben Angaben in jeden Positions-Tick zu legen wäre die
    // naheliegende, aber teure Lösung: Sie ändern sich nie.
    const npcNachKennung = new Map<string, NpcEinordnung>();
    for (const p of sockelLayout?.placements ?? []) {
      const e = loeseNpcAuf(p.prefab, p.npc);
      if (e) npcNachKennung.set(layoutKennung(p), e);
    }
    world = createWorld(seed, settings, layout);
    console.log('[world] GeoManager ready, ground(0,0) =', world.getGroundHeight(0, 0));

    // Das Terrain-Material braucht das Sonnenlicht, um Schatten zu
    // empfangen (LightBlock in TerrainSplat) — Lighting existiert bereits.
    terrain = new TerrainManager(scene, world, lighting.sun);
    // Terraforming VOR allem, was auf dem Boden aufsetzt (Gras, Physik,
    // Objekte): Sonst stünden Halme auf einer Höhe, die es gleich nicht
    // mehr gibt. Trifft das Paket erst später ein, greift derselbe Aufruf
    // aus seinem Handler.
    wendeTerrainCompsAn();
    player = new PlayerController(scene, input, world, assets);
    entities = new EntityManager(scene, world, assets, terrain);
    entities.setHundertFpsProfil(gameSettings.get().hundertFpsProfil);
    entities.setVegetationsGrenze(
      VEGETATION_RANGE[gameSettings.get().vegetationRange] ?? 0
    );
    entities.setzeNpcQuelle(npcNachKennung.size > 0 ? (id) => npcNachKennung.get(id) ?? null : null);
    grass = new GrassClutter(scene, world);
    // Bewuchs der Grabhügel-Kuppel: streut Wiesenhalme direkt auf die
    // Modelldreiecke, weil das Gelände-Gras nur die Heightmap kennt.
    huegelGras = new HuegelGras(scene, assets, grass);
    // Niederschlag (EnvSetup.m_psystems im Original) — folgt dem Spieler
    // und wird vom Wind schräg gestellt, s. Precipitation.ts.
    precipitation = new Precipitation(scene);
    // Namensschilder über den Objekten (Einstellung "Objektnamen anzeigen").
    objectLabels = new ObjectLabels(scene, player.camera, () => entities);
    objectLabels.setEnabled(gameSettings.get().showObjectNames);
    // Was unter dem Fadenkreuz steht — färbt es gelb (s. Anvisiert.ts).
    anvisiert = new Anvisiert(scene, player.camera, () => entities);
    // Namensschilder über Figuren. `bodenHoehe` ist die Sichtprüfung: Ein
    // Schild hinter einer Kuppe darf nicht durchscheinen (s. Namensschild.ts).
    namensschilder = new Namensschilder(scene, player.camera, () => entities, {
      bodenHoehe: (x, z) => world?.getGroundHeight(x, z) ?? -1000,
    });
    namensschilder.setSpielerName(nameInput.value);
    namensschilder.setEnabled(gameSettings.get().nameplates);
    namensschilder.setEigenes(gameSettings.get().eigenesNameplate);

    // Havok statt handgestrickter Abstandsprüfungen: im Original ist der
    // Character ein Rigidbody mit CapsuleCollider und PhysX löst die
    // Kontakte auf (Character.cs). Das WASM lädt asynchron — bis dahin
    // läuft die Bewegung über den Heightmap-Clamp, danach übernehmen
    // Kapsel und Kollider.
    const terrainRef = terrain;
    const playerRef = player;
    const entitiesRef = entities;
    void initPhysics(scene)
      .then(() => {
        terrainRef.enablePhysics();
        playerRef.enablePhysics(scene);
        entitiesRef.enablePhysics();
        // Dungeon-Bodensicherung: Raycast nach unten gegen die Havok-Welt.
        playerRef.bodenSonde = (x, y, z) => bodenHoeheUnter(scene, x, y, z);
        console.log('[physics] Havok aktiv');
      })
      .catch((err) => {
        // Ohne Physik bleibt das Spiel spielbar (man läuft durch alles),
        // deshalb kein harter Abbruch — aber sichtbar machen.
        console.error(
          '[physics] Havok konnte nicht geladen werden:',
          err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        );
      });

    // Diagnose-Zugriff für Tests (Kollisionslage, Spielerposition). Bewusst
    // schmal gehalten: nur lesen, keine Steuerung.
    (window as unknown as Record<string, unknown>).__vb = {
      // Ruhehaltung der Arme live einstellen (Modell ist in T-Pose gebunden).
      // Clip aus der GLB statt prozeduraler Pose (siehe AvatarRig.nutzeClip).
      anim: (an: boolean) => player?.avatar.setClipAnimation(an) ?? false,
      /**
       * Frame-Zeit nach Teilsystem aufschlüsseln.
       *
       * Notwendig, weil die Ruckler NICHT gleichmässig verteilt sind: Der
       * Median lag bei 17,1 ms (60 fps), aber 30 % der Frames brauchten
       * über 25 ms. Ein Mittelwert verrät nicht, WER die Ausreisser
       * verursacht — deshalb wird hier pro Abschnitt die Summe UND das
       * Maximum geführt.
       */
      /**
       * Einstellung setzen und den vollen Anwendungspfad durchlaufen.
       *
       * Nur für Messungen: Über die Schaltflächen des Panels zu klicken
       * war unzuverlässig (der Selektor fand sie zeitweise nicht, und
       * Messreihen liefen dann still auf unveränderter Szene weiter).
       */
      setze: (schluessel: string, wert: number) => {
        gameSettings.set({ [schluessel]: wert } as never);
        return { ...gameSettings.get(), skalierung: engine.getHardwareScalingLevel() };
      },
      /** Feinmessung der Terrain-Abschnitte ein-/ausschalten. */
      feinmessung: (an: boolean) => {
        feinmessungSetzen(an);
        return an;
      },
      profil: () => {
        const p: Record<string, unknown> = { ...zeitmess };
        // Zeichenaufrufe und aktive Meshes: Der Verdacht war, dass wir
        // draw-call-limitiert sind (Logik kostet nur 1,15 ms, Auflösung
        // wirkt nicht). Diese beiden Zahlen entscheiden das.
        const gezaehlt =
          (engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? -1;
        p['zeichenaufrufe'] = gezaehlt;
        // Zeichenaufrufe JE BILD — die Zahl, um die es eigentlich geht.
        //
        // `_drawCalls.current` summiert über die ganze Sitzung: Babylon
        // ruft `fetchNewFrame()` auf diesem Zähler nirgends auf (das täte
        // nur EngineInstrumentation mit `captureDrawCalls`), er wird also
        // nie zurückgesetzt. Ohne diese Ableitung stand in den Messreihen
        // eine Million, aus der niemand ablesen konnte, ob ein Frame 250
        // oder 400 Zeichenaufrufe kostet. Geteilt wird durch die Zahl der
        // Frames seit dem letzten Aufruf; `zeitmess.spieler.n` zählt genau
        // die, weil `miss('spieler', …)` einmal je Bild läuft.
        const bilder = zeitmess.spieler!.n;
        p['zeichenaufrufeProBild'] =
          gezaehlt >= 0 && bilder > 0 ? Math.round((gezaehlt - letzteZeichenaufrufe) / bilder) : -1;
        if (gezaehlt >= 0) letzteZeichenaufrufe = gezaehlt;
        p['aktiveMeshes'] = scene.getActiveMeshes().length;
        p['gesamtMeshes'] = scene.meshes.length;
        // Aufschlüsselung nach Teilsystem — zeigt, wer die Zeichenaufrufe
        // stellt.
        //
        // Die Prefab-Master liefen bis D10 unter "sonstige": Die Regel
        // suchte nach den Präfixen `inst_`/`master`, die Master tragen
        // aber den Namen ihres Submeshes aus der GLB — `tree`, `leaves`,
        // `huegel`, `Findling1`. Damit war die Zahl, an der D10 hängt,
        // in der eigenen Diagnose unsichtbar. Erkannt werden sie jetzt an
        // dem, was sie ausmacht: Thin Instances (Gras hat die auch, wird
        // aber vorher über sein `clutter`-Präfix abgeräumt).
        const nachTyp: Record<string, number> = {};
        for (const m of scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length)) {
          const n = m?.name ?? '?';
          const thin = (m as unknown as { thinInstanceCount?: number })?.thinInstanceCount ?? 0;
          // `impostor` VOR der Thin-Instance-Regel: Die Sprite-Zellen
          // tragen Thin Instances und landeten sonst unter 'entities' —
          // dann waere in der Messung nicht mehr zu trennen, ob ein
          // Posten von echten Zell-Mastern oder vom Sprite-Fernfeld
          // kommt, und genau diese Trennung ist der Punkt des Umbaus.
          const typ = n.startsWith('clutter') ? 'gras'
            : n.startsWith('impostor') ? 'sprites'
              : n.startsWith('zone') || n.startsWith('terrain') || n.startsWith('water') ? 'terrain'
                : thin > 0 || n.startsWith('inst_') ? 'entities'
                  : 'sonstige';
          nachTyp[typ] = (nachTyp[typ] ?? 0) + 1;
        }
        p['aktivNachTyp'] = nachTyp;
        p['materialien'] = scene.materials.length;
        // Feinmessung der Terrain-Abschnitte (nur gefuellt, wenn ueber
        // __vb.feinmessung(true) eingeschaltet). Beantwortet, WOMIT der
        // dominante terrain-Posten seine Zeit verbringt: Rauschen,
        // Gitterbau, GPU-Upload oder Havok-Shape.
        p['fein'] = feinmessungLesen();
        // Der Schattenpass rendert die Werferliste JE KASKADE komplett neu
        // — das Produkt ist der zweite Posten, den D10 betrifft, und er
        // ist grösser als der Bildpass. Beide Zahlen gehören deshalb in
        // dieselbe Momentaufnahme.
        p['schattenwerfer'] = shadows?.werferAnzahl() ?? 0;
        p['schattenKaskaden'] = shadows?.kaskaden() ?? 0;
        // Zellschnitt (E19 c): `aktiv` ist die Zahl, an der der Umbau
        // hängt — so viele Zeichenaufrufe stellen die Zell-Master
        // wirklich. `schattenwerfer` allein taugt seither nicht mehr als
        // Mass: Abgeschaltete Zell-Master bleiben nach der Regel in
        // Shadows.darfWerfen() ungeprüft in der Werferliste stehen und
        // blähen die Zahl auf, ohne etwas zu kosten.
        p['zellmaster'] = entities?.zellStats() ?? null;
        for (const k of Object.keys(zeitmess) as Array<keyof typeof zeitmess>) {
          zeitmess[k] = { summe: 0, max: 0, n: 0 };
        }
        return p;
      },
      ruhepose: (lx: number, ly: number, lz: number, rx: number, ry: number, rz: number, dreh?: number) =>
        player?.avatar.setRuhepose({ x: lx, y: ly, z: lz }, { x: rx, y: ry, z: rz }, dreh),
      colliderPositions: () => entities?.colliderPositions() ?? [],
      playerBody: () => player?.bodyInfo ?? null,
      teleport: (x: number, z: number, yaw: number) => player?.debugTeleport(x, z, yaw),
      /** Admin-Kommandozeile für Tests und Konsole: __vb.admin('dungeon list'). */
      admin: (line: string) => {
        socket?.sendAdminCommand(line);
        return socket?.connected ?? false;
      },
      /** Diagnose: Dungeon-Zustand des Clients. */
      dungeon: () => ({ imDungeon, env: dungeonEnv, spawn: { ...dungeonSpawn } }),
      /** Diagnose: Server-Inventar aus Client-Sicht. */
      inventar: () => inventory?.all.map((i) => `${i.shared.name}×${i.stack}`) ?? [],
      /** Diagnose: Craft über den Server-Pfad. */
      crafte: (ergebnis: string) => {
        if (!socket?.connected) return false;
        socket.sendCraft(ergebnis);
        return true;
      },
      /** Diagnose: Pose eines dynamischen Entities (Namens-Teilstring). */
      dynPose: (name: string) => entities?.dynamicPose(name) ?? null,
      /** Diagnose: Schlag mit beliebiger Waffe an der Spielerposition. */
      schlag: (waffe = '') => {
        if (!player || !socket?.connected) return false;
        socket.sendAttack(player.position.x, player.position.y, player.position.z, player.yaw, waffe);
        return true;
      },
      /** Diagnose: Bau-Piece direkt setzen (Server-Pfad, ohne Ghost/Kosten). */
      baueTest: (prefab = 'woodwall', dx = 2, dz = 0) => {
        if (!player || !world || !socket?.connected) return false;
        const x = player.position.x + dx;
        const z = player.position.z + dz;
        socket.sendPlacePiece(getStableHash(prefab), x, world.getGroundHeight(x, z), z, { x: 0, y: 0, z: 0, w: 1 });
        return true;
      },
      /** Diagnose: Essen serverseitig auslösen. */
      iss: (item = 'CookedMeat') => {
        socket?.sendEat(item);
        return socket?.connected ?? false;
      },
      /** Diagnose: eigenes Bau-Piece an der Spielerposition abreissen. */
      abriss: () => {
        if (!player || !socket?.connected) return false;
        socket.sendRemovePiece(player.position.x, player.position.y, player.position.z);
        return true;
      },
      /** Diagnose: Grabung neben dem Spieler über den Serverpfad auslösen. */
      grabe: (dx = 2, dz = 0) => {
        if (!player || !world || !socket?.connected) return false;
        const x = player.position.x + dx;
        const z = player.position.z + dz;
        socket.sendTerrainOp(x, world.getGroundHeight(x, z), z, JSON.stringify(TERRAIN_HIT_OPS.digg));
        return true;
      },
      /** Diagnose: dynamische Entities (fremde Spieler, Kreaturen). */
      dynamics: () => entities?.dynamicList() ?? [],
      /** Diagnose: Kartenzustand (Eingänge empfangen / Marker gebaut). */
      karte: () => ({
        eingaengeEmpfangen: dungeonEingaenge.length,
        markerGebaut: worldMap?.eingangsMarkerAnzahl ?? 0,
        offen: worldMap?.isVisible ?? false,
      }),
      groundAt: (x: number, z: number) => world?.getGroundHeight(x, z) ?? null,
      /**
       * Boden an einer Stelle dreifach messen: Heightmap (was der Server
       * rechnet), sichtbares Mesh (was man sieht) und Havok-Kollider (worauf
       * man steht). Fallen die auseinander, fällt der Spieler durch den
       * sichtbaren Boden.
       */
      bodenTest: (x: number, z: number) => {
        const hm = world?.getGroundHeight(x, z) ?? null;
        const von = new Vector3(x, (hm ?? 0) + 60, z);
        const strahl = new Ray(von, new Vector3(0, -1, 0), 200);
        const sicht = scene.pickWithRay(strahl, (m) => m.name.startsWith('terrain_'));
        const havok = scene.getPhysicsEngine()?.raycast(von, new Vector3(x, (hm ?? 0) - 140, z));
        return {
          heightmap: hm,
          mesh: sicht?.hit ? { name: sicht.pickedMesh?.name, y: sicht.pickedPoint?.y } : null,
          kollider: havok?.hasHit ? { y: havok.hitPointWorld.y, body: havok.body?.transformNode?.name } : null,
        };
      },
      playerY: () => player?.position.y ?? null,
      playerPos: () => (player ? { x: player.position.x, z: player.position.z } : null),
      // Wind festhalten (EnvMan.SetDebugWind) und die Sway-Amplitude
      // hochdrehen, damit die Shader-Wirkung im Bild messbar wird.
      setWind: (grad: number, staerke: number, amp?: number) => {
        weather?.setDebugWind(grad, staerke);
        if (amp !== undefined) WindPlugin.strength = amp;
      },
      resetWind: () => {
        weather?.clearDebugWind();
        WindPlugin.strength = 0.22;
        ClutterWindPlugin.ampScale = 3.0;
      },
      /**
       * Intensität live justieren, ohne Neuladen:
       *   __vb.sway(baumAmplitude, grasFaktor)
       * Standard 0.22 / 3.0 — kalibriert an _SwayDistance/_Height der
       * Originalmaterialien (beech_leaf 25/35, grasscross 2.5/0.5).
       */
      sway: (baum?: number, gras?: number) => {
        if (baum !== undefined) WindPlugin.strength = baum;
        if (gras !== undefined) ClutterWindPlugin.ampScale = gras;
        return { baum: WindPlugin.strength, gras: ClutterWindPlugin.ampScale };
      },
      /**
       * Glut live justieren, ohne Neuladen:
       *   __vb.glut(amplitude, grundhelligkeit)
       * Standard 0.5 / 3.0. Beide Werte müssen kräftig ausfallen, weil das
       * Tonemapping (KHR_PBR_NEUTRAL) helle Werte staucht und Bloom erst
       * ab 0.7 greift — mit 0.25/1.6 fand die Schwankung messbar statt,
       * war im Bild aber nicht zu sehen.
       */
      glut: (amplitude?: number, basis?: number) => {
        if (amplitude !== undefined) GlutPuls.amplitude = amplitude;
        if (basis !== undefined) GlutPuls.setzeBasis(basis);
        return { amplitude: GlutPuls.amplitude, materialien: GlutPuls.anzahl };
      },
      // Momentaufnahme, keine Live-Sicht: nearbyInstances() liefert die
      // internen Indexeinträge, die sich weiterbewegen. In der Konsole liest
      // man das Ergebnis Sekunden später — dann muss dastehen, was zum
      // Zeitpunkt der Abfrage galt.
      nearbyInstances: (r = 40) =>
        entities && player
          ? entities
              .nearbyInstances(player.position.x, player.position.z, r)
              .map((i) => ({ prefab: i.prefab, x: i.x, y: i.y, z: i.z }))
          : [],
      colliderSpecs: () => (entities ? Object.fromEntries(entities.colliderSpecs) : null),
      // Sprite-Fernfeld: Grenze zur Laufzeit verstellbar (Sweep
      // 150/180/240), plus die Zahlen, an denen der Umbau haengt.
      // `zellStats().sprites` traegt dieselben Werte in die
      // Momentaufnahme — hier stehen sie nur direkt greifbar.
      impostor: {
        get grenze(): number {
          return BaumImpostor.grenze;
        },
        set grenze(v: number) {
          BaumImpostor.grenze = v;
        },
        stats: () => baumImpostor?.stats() ?? null,
      },
      precipInfo: () => precipitation?.info ?? null,
      precipSystem: () => precipitation?.systemRef ?? null,
      windState: () => (weather ? { dir: weather.windDir, staerke: weather.windIntensity, amp: WindPlugin.strength } : null),
    };

    // Post-Process-Stack des Originals (Bloom/MotionBlur/ChromaticAberration/
    // Tonemapping) — hängt an der Spielerkamera, existiert also erst hier.
    // Schatten hängen am Sonnenlicht und müssen deshalb nach Lighting
    // entstehen; die Meshes melden sich selbst an (onNewMeshAddedObservable).
    shadows = new Shadows(scene, lighting.sun);
    const startSettings = gameSettings.get();
    shadows.setHundertFpsProfil(startSettings.hundertFpsProfil);
    shadows.setLevel(startSettings.hundertFpsProfil ? 1 : startSettings.shadowQuality);
    shadows.setDistantShadows(startSettings.hundertFpsProfil ? false : startSettings.distantShadows);
    // Sichtbare Vegetationspuffer bleiben beim EntityManager; Shadows
    // bekommt nach jedem Neuaufbau nur die fertige Matrix-Momentaufnahme
    // und baut daraus eigene, räumlich gekeulte Werfermaster.
    entities.setVegetationsSchattenEmpfaenger((mesh, matrizen) =>
      shadows?.setVegetationsInstanzen(mesh, matrizen)
    );
    // Zell-Master aus dem Pool entstehen NICHT neu — onNewMeshAdded feuert
    // fuer sie nie wieder. Dieser Rueckkanal traegt sie nach, s. die
    // Kommentare an EntityManager.onMasterBelebt und Shadows.meldeWerfer().
    entities.onMasterBelebt = (m) => shadows?.meldeWerfer(m);
    entities.onMasterEntsorgt = (m) => shadows?.entferneWerfer(m);

    // ── Impostor-Fernfeld ─────────────────────────────────────────
    // Ferne Vegetation wird durch 2-Dreiecke-Sprites ERSETZT, statt sie
    // kleiner zu zeichnen (BaumImpostor.ts, Roadmap E10-Revision). Muss
    // NACH Shadows entstehen, damit der `impostor`-Praefix in
    // Shadows.NIE_WERFEN schon greift, und VOR
    // `scene.blockMaterialDirtyMechanism = true`, damit
    // StandardGammaFix/NebelRichtung/FackelLicht sich noch an das
    // Sprite-Material haengen koennen (Leitplanke 5: der Nebel ist Teil
    // der Bildsprache).
    baumImpostor = new BaumImpostor(scene);
    baumImpostor.onMeshEntsorgt = (m) => shadows?.entferneWerfer(m);
    entities.impostoren = baumImpostor;
    entities.impostorGrenze = BaumImpostor.grenze;

    // ── Szenenweite Sparmassnahmen ────────────────────────────────
    // Kein Maus-Picking bei Mausbewegung: Babylon würde sonst bei JEDER
    // Bewegung einen Strahl gegen alle pickbaren Meshes schiessen. Wir
    // picken selbst und gezielt (Bauplatzierung, Werkzeug).
    scene.skipPointerMovePicking = true;
    // Materialien melden nach dem Aufbau keine Zustandsänderungen mehr an,
    // die einen Shader-Neubau auslösen könnten. Spart pro Frame das
    // Durchgehen aller Materialien. Die Post-Process-Schalter der
    // Einstellungen hängen NICHT daran — die laufen über die Pipeline.
    scene.blockMaterialDirtyMechanism = true;

    post = new PostProcessing(scene, player.camera, {
      // Autofokus des Originals: Strahl nach vorn, Trefferentfernung = Fokus.
      // Bei uns über die Höhenfunktion statt über Collider — Begründung in
      // ValheimDof.autoFocus().
      groundHeight: (x, z) => world!.getGroundHeight(x, z),
      waterLevel: WATER_LEVEL,
    });
    // Blende über die Aufbauphase (Chunks poppen, Wasser noch aus)
    loading = new LoadingScreen();

    // Inventar + Ausrüstung. Startausstattung, bis Item-Drops in der Welt
    // liegen: der Bauhammer, die drei Boden-Werkzeuge und etwas Material.
    //
    // Der Hammer stand hier bisher nicht, obwohl er als Item längst
    // vollständig definiert ist (itemDefs.ts, mit `pieceTable: 'Hammer'`).
    // Ohne ihn im Inventar bleibt das Baumenü unerreichbar — er ist das
    // Werkzeug, an dem die Bauteile hängen. `model: 'Hammer_0'` ist dabei
    // Absicht: `Hammer.glb` ist ein 248-Byte-Stub ohne Meshes, die echte
    // Geometrie liegt in `Hammer_0.glb` (Notiz oben in itemDefs.ts).
    inventory = new Inventory();
    equipment = new Equipment(inventory, assets, player.avatar);
    // Kein lokales Startkit mehr: Das Inventar ist SERVER-autoritativ
    // (InventorySync) — offline füllt der Block unten die Werkzeuge auf.
    if (params.has('offline')) {
      for (const [name, menge] of [
        ['Hammer', 1], ['AxeFlint', 1], ['Hoe', 1], ['PickaxeAntler', 1],
        ['Cultivator', 1], ['Wood', 12], ['Stone', 30],
      ] as Array<[string, number]>) {
        inventory.addItem(findItem(name)!, menge);
      }
    }
    hotbar = new Hotbar(inventory, equipment);
    inventoryPanel = new InventoryPanel(inventory, equipment);
    placement = new PlacementController(scene, input, world, terrain, grass, player, equipment);
    // Das Mausrad zoomt die Kamera, im Baumodus wählt es aber das Stück und
    // stellt den Radius. Der PlayerController läuft hier VOR dem
    // PlacementController und würde das Ereignis sonst wegkonsumieren.
    player.zoomErlaubt = () => !placement!.menuOpen && !placement!.selectedPiece;
    pieceSelection = new PieceSelection(placement, input);
    // Terraforming server-autoritativ: online senden statt lokal graben.
    placement.sendeOp = (x, y, z, json) => {
      if (!socket?.connected) return false;
      socket.sendTerrainOp(x, y, z, json);
      return true;
    };
    // Hammer-Bausystem: Ghost aus dem AssetManager, Pieces zum Server.
    placement.ladeGhost = (prefab) => assets.instantiate(prefab);
    placement.inventar = () => inventory;
    placement.sendePiece = (prefab, x, y, z, yawGrad) => {
      if (!socket?.connected) return false;
      const halb = (yawGrad * Math.PI) / 360;
      socket.sendPlacePiece(getStableHash(prefab), x, y, z, {
        x: 0,
        y: Math.sin(halb),
        z: 0,
        w: Math.cos(halb),
      });
      return true;
    };
    placement.sendeAbriss = (x, y, z) => {
      if (!socket?.connected) return false;
      socket.sendRemovePiece(x, y, z);
      return true;
    };
    // Weltkarte (Taste M). Die Vorberechnung läuft ab hier im Worker, damit
    // die Karte fertig ist, bevor sie das erste Mal aufgeschlagen wird —
    // sie rastert die ganze Welt, das dauert einige Sekunden.
    // Layout-Modus: Kartenmaße folgen der Layout-Bbox (+ Ozeanrand) statt
    // der festen 21-km-Radialwelt. Die Karte bleibt eine um den Ursprung
    // zentrierte Scheibe — das Layout sollte grob zentriert gebaut sein.
    if (worldLayout) {
      const layout = sanitizeWorldLayout(worldLayout);
      if (layout) {
        const b = layoutBounds(layout);
        const halb = Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minZ), Math.abs(b.maxZ)) + 2000;
        setzeKartenMasse(halb * 2, halb * 0.995);
      }
    }
    worldMap = new WorldMap({
      seed,
      settings: settings ?? {},
      layout: worldLayout ?? undefined,
      world,
      spieler: () => (player ? { x: player.position.x, z: player.position.z, yaw: player.yaw } : null),
      // Admin-Teleport per Strg+Klick auf die Karte.
      //
      // ZWEIMAL setzen ist Absicht, nicht Redundanz: Die Spielerbewegung
      // ist server-autoritativ (`handlePlayerInput` rechnet aus
      // `peer.position` weiter). Ohne den Admin-Befehl zöge der Server den
      // Spieler beim nächsten Input-Tick an die alte Stelle zurück; ohne
      // das lokale Setzen stünde die Kamera bis zur Serverantwort noch am
      // alten Ort. Offline gibt es keinen Server — dort trägt allein der
      // lokale Sprung.
      aufTeleport: (x, z) => {
        player?.debugTeleport(x, z, player.yaw);
        socket?.sendAdminCommand(`teleport ${x.toFixed(2)} ${z.toFixed(2)}`);
      },
    });
    worldMap.vorberechnen();
    // Fackel-/Feuer-Lichter: Pool wandert auf die nächsten Quellen.
    lightPool = new LightPool(scene, (x, z, r) => entities?.lichtquellen(x, z, r) ?? []);
    // Minimap (Phase G): runder Detailausschnitt oben rechts mit Windzeiger.
    minimap = new Minimap(world);
    // Objekt-Ebene: Bäume/Felsen/Bauwerke aus den echten Entity-Instanzen.
    minimap.setObjektQuelle((x, z, r) => entities?.nearbyInstances(x, z, r) ?? []);
    // Eingänge können vor buildWorld angekommen sein (der Server schickt
    // sie direkt nach der Anmeldung) — jetzt nachreichen.
    if (dungeonEingaenge.length > 0) {
      worldMap.setDungeonEingaenge(dungeonEingaenge);
      minimap.setDungeonEingaenge(dungeonEingaenge);
    }
    // gameSettings.onChange() only fires on future changes — sync the
    // current values onto the freshly created instances now.
    terrain.setDetailQuality(gameSettings.get().detailQuality);
    terrain.setWaterQuality(gameSettings.get().waterQuality);
    grass.setQuality(gameSettings.get().vegetationQuality);
    grass.setDensity(gameSettings.get().grassDensity);
    const aktuelleSettings = gameSettings.get();
    post.apply(aktuelleSettings.hundertFpsProfil
      ? {
          ...aktuelleSettings,
          motionBlur: false,
          depthOfField: false,
          sunShafts: false,
          ambientOcclusion: false,
          temporalAA: false,
        }
      : aktuelleSettings);

    if (params.has('t')) {
      lighting.timeOfDay = Number(params.get('t'));
      lighting.paused = true;
    }
    if (params.has('fog')) scene.fogDensity = Number(params.get('fog'));
    // ?env=Clear|Misty|SwampRain|… pins one weather (console `env` equivalent)
    if (params.has('env')) {
      if (lighting.setEnvironmentByName(params.get('env')!)) envPinned = true;
      else console.warn(`[lighting] unknown environment "${params.get('env')}"`);
    }
    // ?pos=x,z teleports the spawn (screenshot probes)
    if (params.has('pos')) {
      const [px, pz] = params.get('pos')!.split(',').map(Number);
      if (Number.isFinite(px) && Number.isFinite(pz)) {
        player.position.set(px, world.getGroundHeight(px!, pz!), pz!);
      }
    }
  }

  function connectOnline(name: string, url: string): void {
    // Alten Socket hart schließen, bevor ein neuer entsteht — sonst leben
    // zwei Verbindungen samt Handlern parallel (Review-Punkt 9).
    if (socket) {
      socket.onDisconnected = null;
      socket.disconnect();
    }
    socket = new GameSocket(url, name);
    // Ein Spiegel je Verbindung (D6): Der Server schickt einem frisch
    // verbundenen Peer jedes ZDO wieder als Vollstand, also darf und muss
    // hier nichts aus der alten Sitzung überleben.
    const zdoSpiegel = new ZDOSpiegel();

    // D6/M0.1: world info first — build the identical GeoManager the
    // server runs and only then start rendering (placeholder-free).
    socket.on(PacketType.ServerConfig, (reader) => {
      const worldName = reader.readString();
      const worldSeed = reader.readString();
      const worldGenVersion = reader.readInt32();
      const flags = reader.readUInt8();
      console.log(
        `[Client] ServerConfig: world "${worldName}", seed "${worldSeed}", gen v${worldGenVersion}, flags 0b${flags.toString(2).padStart(6, '0')}`
      );
      const settings = {
        worldGenVersion,
        disableDistantRivers: (flags & FLAG_DISABLE_DISTANT_RIVERS) !== 0,
        riverAffectsOcean: (flags & FLAG_RIVER_AFFECTS_OCEAN) !== 0,
        ashlandsModernNoise: (flags & FLAG_ASHLANDS_MODERN) !== 0,
        blendSmoothStep: (flags & FLAG_BLEND_SMOOTHSTEP) !== 0,
        bilinearSampling: (flags & FLAG_BILINEAR_HEIGHT) !== 0,
      };
      if ((flags & FLAG_LAYOUT_MODE) !== 0) {
        // Layout-Welt: Das Dokument kommt als NÄCHSTES Paket — erst damit
        // lässt sich dieselbe Welt bauen, die der Server fährt.
        layoutErwartet = { worldSeed, settings };
      } else {
        buildWorld(worldSeed, settings);
      }
    });

    socket.on(PacketType.WorldLayoutData, (reader) => {
      const json = reader.readString();
      if (!layoutErwartet) {
        console.warn('[Client] WorldLayoutData ohne angekündigten Layout-Modus — ignoriert');
        return;
      }
      let layout: unknown = null;
      try {
        layout = JSON.parse(json);
      } catch {
        console.error('[Client] WorldLayoutData: kaputtes JSON');
        return;
      }
      const { worldSeed, settings } = layoutErwartet;
      layoutErwartet = null;
      console.log(`[Client] WorldLayout empfangen (${(json.length / 1024).toFixed(1)} KB)`);
      buildWorld(worldSeed, settings, layout);
    });

    socket.on(PacketType.ZDOSync, (reader) => {
      if (!entities || !socket) return;
      const sync = parseZDOSync(reader, socket.ownUserId, zdoSpiegel);
      for (const u of sync.updates) entities.applyUpdate(u);
      for (const key of sync.destroyed) entities.removeZDO(key);
    });

    // Dungeon-Eingänge für die Weltkarte (bei Anmeldung + bei Änderungen).
    socket.on(PacketType.DungeonEntrances, (reader) => {
      const count = reader.readInt32();
      const list: Array<{ feature: string; dungeonId: string; x: number; z: number }> = [];
      for (let i = 0; i < count; i++) {
        const feature = reader.readString();
        const dungeonId = reader.readString();
        const pos = reader.readVector3();
        list.push({ feature, dungeonId, x: pos.x, z: pos.z });
      }
      dungeonEingaenge = list;
      worldMap?.setDungeonEingaenge(list);
      minimap?.setDungeonEingaenge(list);
      console.log(`[dungeon] ${list.length} Eingänge für die Karte empfangen`);
    });

    // Editor-Antworten: Dokument geladen bzw. Speichern quittiert.
    socket.on(PacketType.DungeonEditData, (reader) => {
      const ok = reader.readBool();
      const message = reader.readString();
      const json = reader.readString();
      dungeonEditor.empfangen(ok, message, json);
    });

    // Health/Stamina vom Server (Kampf-Basis).
    socket.on(PacketType.PlayerState, (reader) => {
      const health = reader.readFloat32();
      const stamina = reader.readFloat32();
      if (reader.remaining >= 12) serverPos = reader.readVector3();
      hud.setVitals(health, stamina);
      // Dieselbe Zahl im eigenen Namensschild — eine Quelle, zwei Anzeigen.
      namensschilder?.setSpielerLeben(health);
    });

    // D9: Endzustand des Terraformings beim Verbinden — je bearbeiteter
    // Zone ein Comp statt jeder je ausgeführten Operation. Der alte Weg
    // (Replay über TerrainOpSync) wuchs linear mit der Spielzeit UND war
    // beim Reconnect falsch: Er legte die Grabungen ein zweites Mal auf
    // eine bereits veränderte Heightmap. Ein Endzustand wird gesetzt, nicht
    // aufaddiert — das Problem gibt es damit nicht mehr.
    socket.on(PacketType.TerrainCompSync, (reader) => {
      const count = reader.readInt32();
      for (let i = 0; i < count; i++) {
        const roh = reader.readBytes();
        try {
          offeneTerrainComps.push(dekodiereTerrainComp(roh));
        } catch (err) {
          console.warn('[terrain] TerrainComp unlesbar, übersprungen:', err);
        }
      }
      wendeTerrainCompsAn();
    });

    // Terraforming vom Server: eigene Ops (Echo) und Mitspieler-Ops.
    socket.on(PacketType.TerrainOpSync, (reader) => {
      const count = reader.readInt32();
      for (let i = 0; i < count; i++) {
        const pos = reader.readVector3();
        const json = reader.readString();
        if (!world || !terrain) continue;
        try {
          const settings = JSON.parse(json);
          const effect = world.heightmaps.applyTerrainOp(pos.x, pos.y, pos.z, settings);
          if (effect.heights.length > 0) terrain.refreshZones(effect.heights);
          for (const [zx, zy] of effect.paint) terrain.refreshPaint(zx, zy);
          // Gras weicht der Grabung — exakt die Regel des lokalen Pfads
          // (PlacementController.apply), die der Server-Umweg sonst
          // überspringen würde: Halme im Op-Radius aus den Puffern filtern,
          // isClearing() verhindert das Nachwachsen. Gilt für eigene Ops
          // (Echo), Mitspieler-Ops und das Login-Replay gleichermaßen.
          grass?.clearArea(pos.x, pos.z, opRadius(settings));
        } catch {
          /* kaputte Op ignorieren */
        }
      }
    });

    // Interaktions-Ergebnis: Meldung + ggf. Beute ins Inventar.
    socket.on(PacketType.InteractResult, (reader) => {
      reader.readBool();
      const message = reader.readString();
      const itemName = reader.readString();
      const amount = reader.readInt32();
      if (message) hud.meldung(message);
      // Items addiert NUR noch der Server (InventorySync) — itemName/amount
      // bleiben im Paket für HUD-Signale und Alt-Clients.
      void itemName;
      void amount;
    });

    // Autoritativer Inventarstand vom Server — ersetzt das lokale Inventar
    // vollständig (Pickups, Drops, Craften, Baukosten, Essen …).
    socket.on(PacketType.InventorySync, (reader) => {
      const json = reader.readString();
      if (!inventory) return;
      try {
        inventory.load(JSON.parse(json));
      } catch {
        console.error('[Client] InventorySync: kaputtes JSON');
      }
    });

    // Serverantworten auf Admin-Kommandos (dungeon enter/leave, teleport …)
    // als Bildschirmmeldung — vorher liefen sie ins Leere.
    socket.on(PacketType.AdminEvent, (reader) => {
      reader.readString(); // command
      reader.readBool(); // active
      const message = reader.readString();
      if (message) hud.meldung(message);
    });

    // Phase G: harter Positions-Sprung vom Server (Dungeon betreten/verlassen,
    // dungeon-bewusster Admin-Teleport). Die Position ist server-autoritativ —
    // ohne den Snap würde die Kamera durch 100 km Nichts lerpen.
    socket.on(PacketType.Teleport, (reader) => {
      const pos = reader.readVector3();
      const drin = reader.readBool();
      reader.readString(); // dungeonId — später für HUD/Karte interessant
      const env = reader.readString();
      // Die letzte bekannte Server-Position ist nach einem harten Sprung
      // bedeutungslos — stünde sie weiter, zöge die Reconciliation den
      // Spieler sofort zur ALTEN Stelle zurück (so entstand die Schleife
      // "beim Weglaufen spawne ich immer wieder am Eingang").
      serverPos = null;
      imDungeon = drin;
      if (env) dungeonEnv = env;
      if (drin) {
        dungeonSpawn = { x: pos.x, y: pos.y, z: pos.z };
        dungeonLadenSeit = performance.now();
      }
      if (player) {
        player.dungeonMode = drin;
        // Beim Betreten einfrieren, bis die Raum-Collider stehen — die
        // GLBs laden asynchron, ohne Boden fiele man durch den Dungeon
        // (vom Nutzer gemeldet 2026-08-02). Auftauen im Game-Loop.
        player.frozen = drin;
        player.teleportTo(pos.x, pos.y, pos.z);
      }
      terrain?.setInstanzModus(drin);
      // In der Instanz gibt es kein Gelände zum Abtasten — Minimap aus.
      minimap?.setVisible(!drin);
      hud.meldung(drin ? 'Dungeon wird geladen…' : 'Zurück in der Oberwelt');
      console.log(
        drin
          ? `[dungeon] Instanz betreten @ (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}), env=${env}`
          : `[dungeon] zurück in der Oberwelt @ (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)})`
      );
    });

    socket.on(PacketType.TimeSync, (reader) => {
      // Gewünschte Uhrzeit genau einmal anfordern — der Server verschiebt
      // daraufhin seine Weltzeit und schickt allen ein neues TimeSync, das
      // dann hier unten ganz normal übernommen wird.
      if (zeitWunsch !== null) {
        socket?.sendSetTimeOfDay(zeitWunsch);
        zeitWunsch = null;
      }
      // Absolute world seconds — this is what seeds the weather and the
      // wind (EnvMan derives both from the clock, nothing is synced), so
      // it has to be kept rather than dropped.
      worldTime = reader.readFloat64();
      const timeOfDay = reader.readFloat64(); // seconds within the day
      reader.readInt32(); // day
      if (!lighting.paused) {
        lighting.timeOfDay = ((timeOfDay / 1800) % 1 + 1) % 1; // 30-min cycle
      }
    });

    socket.onConnected = () => {
      netStatus = 'verbunden';
      connectScreen.style.display = 'none';
      connectStatus.textContent = '';
      connectBtn.removeAttribute('disabled');
      reconnectVersuch = 0;
    };
    socket.onDisconnected = (reason) => {
      netStatus = `getrennt${reason ? `: ${reason}` : ''}`;
      // Auto-Reconnect (Review-Punkt 9): drei Versuche mit wachsendem
      // Abstand, erst danach zurück zum Connect-Screen. Ein Kick durch den
      // Server (reason gesetzt) wird NICHT automatisch wiederholt.
      if (!reason && reconnectVersuch < 3) {
        reconnectVersuch++;
        const wartezeit = 1000 * 2 ** (reconnectVersuch - 1);
        hud.meldung(`Verbindung verloren — Wiederaufbau in ${wartezeit / 1000}s (Versuch ${reconnectVersuch}/3)`);
        window.setTimeout(() => connectOnline(name, url), wartezeit);
        return;
      }
      connectScreen.style.display = 'flex';
      connectStatus.textContent = reason ? `Getrennt: ${reason}` : 'Verbindung zum Server verloren';
      connectBtn.removeAttribute('disabled');
    };
    socket.connect();
    netStatus = 'verbinde…';
  }

  connectBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Viking';
    namensschilder?.setSpielerName(name);
    connectBtn.setAttribute('disabled', 'true');

    const stunde = gewaehlteStunde();
    // `?t=` bleibt der stärkere Schalter: Der hält die Uhr zusätzlich an
    // (siehe buildWorld), und beides gleichzeitig anzuwenden ergäbe eine
    // angehaltene Uhr auf einer anderen Zeit als der ausgewählten.
    const zeitGewuenscht = stunde !== null && !params.has('t');

    if (offlineToggle.checked) {
      connectScreen.style.display = 'none';
      buildWorld(seedInput.value.trim() || randomSeed());
      // Offline gibt es keinen Server, der die Zeit verteilen könnte —
      // hier ist die Beleuchtung selbst die Welt-Uhr.
      if (zeitGewuenscht) lighting.timeOfDay = stunde! / 24;
      return;
    }

    connectStatus.textContent = 'Verbinde…';
    // Wird beim ersten TimeSync eingelöst — siehe `zeitWunsch`.
    zeitWunsch = zeitGewuenscht ? (stunde! / 24) * WORLD_TIME_LENGTH : null;
    connectOnline(name, urlInput.value.trim() || `${wsProto}://${location.host}/ws`);
  });

  // ?offline=1 skips the connect screen for quick dev/Playwright probes.
  // ?layout=editor lädt zusätzlich den Editor-Entwurf aus localStorage —
  // der "Testflug" des 3D-Map-Generators: die unveröffentlichte Welt im
  // echten Spiel-Terrain begehen (editor.html setzt den Eintrag).
  if (params.has('offline')) {
    connectScreen.style.display = 'none';
    let testflug: unknown = null;
    if (params.get('layout') === 'editor') {
      try {
        testflug = JSON.parse(localStorage.getItem('wov-editor-layout') ?? 'null');
      } catch {
        testflug = null;
      }
      if (!testflug) console.warn('[Testflug] Kein Editor-Entwurf in localStorage');
    }
    buildWorld(params.get('seed') ?? DEFAULT_OFFLINE_SEED, undefined, testflug ?? undefined);

    // ── Editor-Spawn im 3D-Testflug ─────────────────────────────────
    // Platzierungen des Entwurfs sichtbar machen und per Taste B + Klick
    // NEUE Objekte direkt im Gelände setzen — sie landen im selben
    // localStorage-Entwurf, den editor.html bearbeitet.
    // Cast nötig: TS sieht die Zuweisung in buildWorld() nicht und hielte
    // `entities` hier sonst für null.
    const ent = entities as EntityManager | null;
    if (testflug && ent) {
      // Ein Eintrag des Entwurfs — dieselben Felder wie PlacementDef, aber
      // beschreibbar: Der Entwurf im localStorage IST das Arbeitsdokument.
      type EntwurfEintrag = {
        prefab: string;
        x: number;
        z: number;
        yaw?: number;
        scale?: number;
        einebnen?: number;
        npc?: NpcDef;
      };
      // `anim` ist optional und nur für die Routen-Vorschau da: Sie schaltet
      // damit dieselbe Animationsgruppe um, die online der Server über den
      // ZDO-Member `anim` steuert (idle/walk). Ohne Angabe bleibt es bei der
      // Animation aus der PrefabDef — für jede stehende Platzierung.
      const zeige = (p: { prefab: string; x: number; z: number; yaw?: number; scale?: number; anim?: string; npc?: NpcDef }, i: number): void => {
        if (!findPrefabByName(p.prefab) || !world) return;
        const yaw = p.yaw ?? 0;
        // NPC-Einordnung fertig aufgelöst mitgeben statt über `layoutId`:
        // Offline gibt es keinen Server, der eine Kennung setzen könnte,
        // und der Entwurf liegt hier unmittelbar vor. Damit sieht der
        // Zeichner jede Änderung an Name/Rolle/Stufe sofort am Schild —
        // die Platzierung wird nach dem Bearbeiten einfach neu gezeichnet.
        const npc = loeseNpcAuf(p.prefab, p.npc);
        ent.applyUpdate({
          key: i < 0 ? 'edghost' : `edplace-${i}`,
          prefabHash: getStableHash(p.prefab),
          position: { x: p.x, y: world.getGroundHeight(p.x, p.z), z: p.z },
          rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
          ...(p.anim !== undefined ? { anim: p.anim } : {}),
          // Der Geist an der Maus (i < 0) bleibt bewusst ohne Schild — er
          // ist noch keine Figur, sondern eine Vorschau.
          ...(npc && i >= 0 ? { npc } : {}),
          isOwn: false,
        } as never);
      };
      const entwurf = testflug as { placements?: EntwurfEintrag[] };
      (entwurf.placements ?? []).forEach(zeige);
      ent.flush();

      // ── Live-Planieren ──────────────────────────────────────────────
      // Sockel sofort in die laufende Geo einfügen/entfernen und die
      // betroffenen Kacheln neu bauen — wer ein Bauwerk setzt, muss das
      // Planieren SOFORT sehen, nicht erst nach F5. Neuladen und Server
      // rechnen trotzdem exakt dieselbe Höhe, weil die Zielhöhe in
      // RegionGeo immer die UNGEEBNETE Mittelpunkthöhe ist — unabhängig
      // davon, wann die Platte dazukam.
      const kachelnNeu = (x: number, z: number, radius: number): void => {
        if (!world) return;
        const reichweite = radius + PLATEAU_RAND_MAX;
        // Muster F4 (applyLocationLeveling): Zonen-Cache verwerfen, Kacheln
        // über den Ring-Scan neu bauen lassen. Das Gras steht sonst auf der
        // alten Höhe (Muster: Terrain-Werkzeuge, grass.clearArea).
        terrain?.rebuildZones(world.heightmaps.invalidateArea(x, z, reichweite));
        grass?.clearArea(x, z, reichweite);
      };
      const sockelLiveDazu = (x: number, z: number, radius: number): void => {
        if (!world || !(world.geo instanceof RegionGeo)) return;
        world.geo.sockelEinfuegen(x, z, radius);
        sockelFreiflaechen.push({ x, z, r: radius });
        kachelnNeu(x, z, radius);
      };
      const sockelLiveWeg = (p: { x: number; z: number; einebnen?: number }): void => {
        if (!p.einebnen || !world || !(world.geo instanceof RegionGeo)) return;
        if (!world.geo.sockelEntfernen(p.x, p.z)) return;
        sockelFreiflaechen = sockelFreiflaechen.filter(
          (s) => Math.abs(s.x - p.x) >= 0.05 || Math.abs(s.z - p.z) >= 0.05
        );
        kachelnNeu(p.x, p.z, p.einebnen);
      };

      const panel = new SpawnPanel({
        // Tageszeit im Testflug: Lighting rechnet in Tagesbruchteilen
        // (0–1), der Regler zeigt Stunden. `paused` stoppt den Zyklus in
        // Lighting.apply() — ohne das wandert jeder eingestellte Wert
        // sofort weiter.
        setzeZeit: (stunden, angehalten) => {
          if (!lighting) return;
          lighting.timeOfDay = ((stunden / 24) % 1 + 1) % 1;
          lighting.paused = angehalten;
        },
        zeit: () => (lighting ? lighting.timeOfDay * 24 : 12),
        anzahl: () => {
          const roh = JSON.parse(localStorage.getItem('wov-editor-layout') ?? '{}') as {
            placements?: unknown[];
          };
          return roh.placements?.length ?? 0;
        },
        platzieren: () => platziere(),
        // ── NPC-Angaben der GEWÄHLTEN Platzierung ─────────────────────
        // Gelesen und geschrieben wird derselbe localStorage-Entwurf, den
        // auch Setzen, Ziehen und Löschen anfassen — eine zweite Quelle
        // für dieselben Daten wäre der sichere Weg in Widersprüche.
        gewaehlteNpc: () => {
          if (auswahlIndex < 0) return null;
          const p = leseEntwurf()?.placements[auswahlIndex];
          return p ? { prefab: p.prefab, npc: p.npc } : null;
        },
        setzeNpc: (npc) => {
          const roh = leseEntwurf();
          const p = roh?.placements[auswahlIndex];
          if (!roh || !p) return;
          if (npc) p.npc = npc;
          else delete p.npc;
          localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
          // Sofort neu zeichnen: Das Namensschild hängt an der Instanz,
          // und der Zeichner soll den geänderten Namen sehen, ohne die
          // Figur erst verschieben zu müssen.
          zeige(p, auswahlIndex);
          ent.flush();
          hud.meldung(`${p.prefab}: Angaben übernommen`);
        },
        entferneLetztes: () => {
          const roh = JSON.parse(localStorage.getItem('wov-editor-layout') ?? 'null') as {
            placements?: Array<{ prefab: string; x: number; z: number; einebnen?: number }>;
          } | null;
          if (!roh?.placements?.length) return;
          const i = roh.placements.length - 1;
          const weg = roh.placements[i]!;
          roh.placements = roh.placements.slice(0, -1);
          localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
          ent.removeZDO(`edplace-${i}`);
          ent.flush();
          // Kein verwaister Sockel: Der Untergrund geht mit der Platzierung.
          sockelLiveWeg(weg);
          hud.meldung('Letzte Platzierung entfernt');
        },
      });
      // Sockel-Radius fürs Einebnen: halbe DIAGONALE der Grundfläche plus
      // ein Meter Zugabe, mit der gewählten Größe skaliert. Zwei Anläufe
      // reichten nicht: ×0,8 ließ den Rand des Grabhügels auf unplaniertem
      // Gelände stehen, und auch w/2 + 1 (= 22,3 m) endete VOR der
      // Eingangsfront — renderScale.w ist nur die Bbox-BREITE, Vorbauten
      // (Portal bei −21,6 m, Runenstein bei −24 m) und jede yaw-Drehung
      // schieben Ecken bis zur halben Diagonale hinaus, und die Böschung
      // kletterte als Grashang quer über das Portal. Erst hinter der
      // Diagonale (Grabhügel: ~31 m) darf sie beginnen.
      const sockelRadius = (): number => {
        const e = panel.einstellung;
        const w = findPrefabByName(e.prefab)?.renderScale.w ?? 4;
        // Halbe LÄNGSTE Ausdehnung plus ein Meter Zugabe. Ein Kreis mit
        // diesem Radius deckt das Bauwerk in JEDER Drehung, weil w bereits
        // die größte waagerechte Kante ist.
        //
        // Vorher stand hier zusätzlich ein √2 — das rechnet die Diagonale
        // eines QUADRATS aus und ist für längliche Bauten schlicht zu
        // grosszügig: Beim Grabhügel (42,6 × 29,4 m) ergab das 31 m statt
        // 22 m, also einen Ring von bis zu 9 m planierter Wiese rund um
        // den Fuss. Gemeldet als „es wird sehr viel rund um den Hügel
        // planiert". Die Ecken einer gedachten Bbox deckt der Kreis dann
        // zwar nicht mehr — dort ist bei einem runden Hügel aber ohnehin
        // nur Luft.
        return Math.round(((w * e.scale) / 2) + 1);
      };
      const platziere = (): void => {
        if (!player || !world) return;
        // Zentrale Schranke für ALLE Setz-Pfade (Taste P, „Platzieren"-
        // Knopf, Linksklick bei gefangener Maus): Ohne bewusst in der
        // Liste aktivierten Platzier-Modus wird NICHTS gesetzt — sonst
        // setzte z. B. der Klick, der nach dem Schließen mit B die Maus
        // wieder einfängt, still das localStorage-Prefab in die Welt.
        if (!panel.istPlatzierModus) {
          hud.meldung('Kein Prefab aktiv — erst in der Liste (B) anklicken');
          return;
        }
        // Zweite Schranke: Solange Wegpunkte gesetzt werden, gehört der
        // Klick (und die Taste P) der Route — sonst stünde am Wegpunkt
        // ungewollt ein Baum. Kann eigentlich nicht eintreten, weil
        // aufZeichenStart den Platzier-Modus beendet; billiger Rückhalt.
        if (routen.istZeichenModus) {
          hud.meldung('Routen-Zeichnen aktiv — erst mit ✎ oder Esc beenden');
          return;
        }
        const e = panel.einstellung;
        const wx = Math.round(player.position.x - Math.sin(player.yaw) * e.abstand);
        const wz = Math.round(player.position.z - Math.cos(player.yaw) * e.abstand);
        const roh = JSON.parse(localStorage.getItem('wov-editor-layout') ?? 'null') as {
          placements?: EntwurfEintrag[];
        } | null;
        if (!roh) return;
        const sockel = e.einebnen ? sockelRadius() : undefined;
        const eintrag = {
          prefab: e.prefab,
          x: wx,
          z: wz,
          yaw: e.yaw ?? Math.random() * Math.PI * 2,
          ...(Math.abs(e.scale - 1) > 1e-3 ? { scale: e.scale } : {}),
          ...(sockel !== undefined ? { einebnen: sockel } : {}),
        };
        roh.placements = [...(roh.placements ?? []), eintrag];
        localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
        // Erst planieren, DANN zeichnen: zeige() liest getGroundHeight —
        // das Bauwerk soll auf der Platte sitzen, nicht auf der alten Welle.
        if (sockel !== undefined) sockelLiveDazu(wx, wz, sockel);
        zeige(eintrag, roh.placements.length - 1);
        ent.flush();
        // Eine frisch gesetzte FIGUR ist sofort die gewählte: Sonst müsste
        // man sie erst wieder anklicken, um ihr einen Namen zu geben.
        // Bewusst nur bei NPCs — bei Bäumen wäre eine Auswahl, die Entf
        // scharf macht, eine unerwartete Nebenwirkung des Setzens.
        if (istNpcPrefab(e.prefab)) auswahlIndex = roh.placements.length - 1;
        panel.aktualisiere();
        hud.meldung(
          `${e.prefab} platziert @ (${wx}, ${wz})` +
            (sockel !== undefined ? ` — Boden planiert (r=${sockel} m)` : '')
        );
        // Nutzerwunsch: Nach dem Setzen hängt NICHTS mehr an der Maus —
        // der Modus endet mit der Platzierung (aufWahl räumt den Geist ab).
        // Wer ein weiteres Exemplar will, klickt den Eintrag erneut an.
        panel.beendePlatzierModus();
      };
      spawnEditorOffen = () => panel.istOffen;
      /**
       * Landet der Tastendruck gerade in einem Feld des Panels, das ihn
       * selbst verarbeitet? Im Suchfeld sind „b"/„p"/Entf Texteingabe, im
       * Kategorie-Select springen Buchstaben zu Einträgen — ohne diese
       * Sperre schloss das Tippen das Menü bzw. platzierte mitten im
       * Suchwort (Ursache von „B setzt nochmal"). Regler und Häkchen
       * schlucken keine Buchstaben, dort gelten die Kürzel weiter.
       */
      const tipptImFeld = (e: KeyboardEvent): boolean =>
        (e.target instanceof HTMLInputElement &&
          // `number` seit den NPC-Feldern dabei: Im Stufenfeld ist die
          // Tastatur Eingabe, nicht Steuerung — sonst schlösse ein
          // Tastendruck darin das Panel oder platzierte.
          (e.target.type === 'text' || e.target.type === 'number')) ||
        e.target instanceof HTMLSelectElement;
      window.addEventListener('keydown', (e) => {
        if (tipptImFeld(e)) return;
        if (e.code === 'KeyB') {
          const offen = panel.toggle();
          if (!offen) {
            geistWeg();
            ring.setEnabled(false);
            auswahlIndex = -1;
          }
          if (offen) {
            // Maus freigeben, damit Liste/Regler anklickbar sind — das
            // Wieder-Einfangen übernimmt der Game-Loop (cursorNoetig).
            document.exitPointerLock();
          }
          hud.meldung(
            offen
              ? 'Spawn-Editor offen — Prefab anklicken startet die Platzierung, B schließt'
              : 'Spawn-Editor zu'
          );
        }
        if (e.code === 'KeyP' && panel.istOffen) platziere();
        // Esc beendet den Platzier-Modus (die Vorauswahl in der Liste bleibt).
        if (e.code === 'Escape') panel.beendePlatzierModus();
      });

      // ── Baumodus (Taste V) ──────────────────────────────────────────
      // Nur im Editor-Testflug registriert (dieser Block läuft sonst nie):
      // Figur schwebt, Kamera darf weit heraus — Übersicht beim Anlegen
      // ganzer Siedlungen. V ist frei (B=Spawn-Panel, E/F/P/M/I/C/Tab
      // vergeben); die Mechanik liegt im PlayerController (setBauModus).
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyV' || !player) return;
        // Tippt man gerade im Suchfeld des Panels, ist "v" ein Buchstabe.
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        const an = !player.bauModus;
        player.setBauModus(an);
        hud.meldung(
          an
            ? 'Baumodus AN — WASD fliegt, Leer steigt, X/Strg sinkt, Rad zoomt weit, V beendet'
            : 'Baumodus AUS — Figur fällt zu Boden'
        );
      });
      window.addEventListener('mousedown', (e) => {
        // Bei gefangener Maus platziert der Linksklick vor dem Spieler;
        // Rechtsklick (button 2) verwirft auch hier.
        if (!panel.istOffen || !document.pointerLockElement) return;
        if (e.button === 2) {
          verwerfen();
          return;
        }
        if (e.button === 0 && performance.now() - rechtsklickZeit > 400) platziere();
      });

      // ── Maus-Platzierung + Verschieben (Cursor frei) ────────────────
      //
      // Der Klickpunkt wird per Kamerastrahl gegen das Höhenfeld gemarcht
      // (kein scene.pick: Thin Instances und Terrain-Kacheln sind nicht
      // verlässlich pickbar). Klick auf freie Fläche = neues Objekt am
      // Mauspunkt; Klick nahe einer Platzierung = greifen und ziehen.
      const bodenPunkt = (px: number, py: number): { x: number; z: number } | null => {
        if (!player || !world) return null;
        const ray = scene.createPickingRay(px, py, null, player.camera);
        let t0 = 0;
        let t1 = -1;
        for (let t = 2; t < 800; t += 2) {
          const x = ray.origin.x + ray.direction.x * t;
          const y = ray.origin.y + ray.direction.y * t;
          const z = ray.origin.z + ray.direction.z * t;
          if (y <= world.getGroundHeight(x, z)) {
            t1 = t;
            break;
          }
          t0 = t;
        }
        if (t1 < 0) return null;
        for (let i = 0; i < 10; i++) {
          const tm = (t0 + t1) / 2;
          const x = ray.origin.x + ray.direction.x * tm;
          const y = ray.origin.y + ray.direction.y * tm;
          const z = ray.origin.z + ray.direction.z * tm;
          if (y <= world.getGroundHeight(x, z)) t1 = tm;
          else t0 = tm;
        }
        const tm = (t0 + t1) / 2;
        return { x: ray.origin.x + ray.direction.x * tm, z: ray.origin.z + ray.direction.z * tm };
      };
      const leseEntwurf = (): { placements: EntwurfEintrag[] } | null => {
        const roh = JSON.parse(localStorage.getItem('wov-editor-layout') ?? 'null');
        if (!roh) return null;
        roh.placements = roh.placements ?? [];
        return roh;
      };
      let ziehIndex = -1;
      /** Griffposition beim Packen — nach dem Ziehen wandert der Sockel
       *  von dort zur neuen Position (die alte steht sonst als verwaiste
       *  Platte im Gelände). */
      let ziehStart: { x: number; z: number } | null = null;
      /** Ausgewählte (zuletzt gegriffene) Platzierung — Ziel von Entf. */
      let auswahlIndex = -1;
      // Ob die Vorschau an der Maus hängt, entscheidet allein
      // panel.istPlatzierModus: aktiv erst nach bewusstem Klick in der
      // Liste, beendet durch Abwahl/Esc/Rechtsklick. Ein lokales Flag
      // hier war die Quelle des „Geist klebt nach dem Laden an der Maus".

      // ── Routen-Editor (Taste R) ─────────────────────────────────────
      // NACH `auswahlIndex` angelegt: Der Konstruktor zeichnet die Anzeige
      // einmal auf und liest dabei die gewählte Platzierung — vor der
      // Deklaration wäre das ein Zugriff in die temporale Todeszone.
      const routen = new RoutenEditor(scene, {
        bodenHoehe: (x, z) => world?.getGroundHeight(x, z) ?? 0,
        meldung: (t) => hud.meldung(t),
        gewaehltePlatzierung: () => auswahlIndex,
        // Zeichnen und Platzieren schließen einander aus (s. RoutenEditor).
        aufZeichenStart: () => {
          panel.beendePlatzierModus();
          geistWeg();
        },
        // Entwurf in die Serverdatei schreiben — derselbe Endpunkt, den der
        // Karten-Editor benutzt. Ohne diesen Weg blieb der im Testflug
        // gezeichnete Entwurf im Browserspeicher liegen, und der Server sah
        // die Route nie.
        aufSpeichern: () => {
          const roh = leseEntwurf();
          if (!roh) {
            hud.meldung('Kein Entwurf zum Speichern');
            return;
          }
          const sauber = sanitizeWorldLayout(roh as never);
          if (!sauber) {
            hud.meldung('Entwurf ist unbrauchbar — nicht gespeichert');
            return;
          }
          hud.meldung('Speichere in die Welt …');
          void fetch('/api/worldlayout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sauber),
          })
            .then((r) => r.json())
            .then((a: { ok: boolean; message: string }) => {
              hud.meldung(
                a.ok
                  ? `${a.message} — Server neu starten, damit die Welt sie lädt`
                  : a.message
              );
            })
            .catch((err) => hud.meldung(`Speichern fehlgeschlagen: ${String(err)}`));
        },
        // Umschalter „Vorschau an/aus" (Vorgabe AN). Der Zustand lebt im
        // Panel, das Laufen in RoutenVorschau — beim Ausschalten kehren die
        // NPCs auf ihren gespeicherten Platz zurück.
        aufVorschau: (an) => vorschau.setzeAn(an),
      });
      routenEditorOffen = () => routen.istOffen;

      // ── Routen-Vorschau im Testflug ─────────────────────────────────
      // Läuft NUR hier (offline + layout=editor). Online bewegt der Server,
      // im normalen Offline-Spiel gibt es keinen Entwurf mit Routen.
      const vorschau = new RoutenVorschau({
        // Derselbe Weg wie bei jeder anderen Platzierung: gleicher Schlüssel
        // `edplace-<i>` ⇒ die bestehende Instanz wird nachgeführt, es
        // entsteht keine zweite. `anim` schaltet die Animationsgruppe um.
        zeichne: (i, p, x, z, yaw, anim) => zeige({ prefab: p.prefab, x, z, yaw, anim }, i),
        // Was am Mauszeiger hängt, läuft nicht (s. RoutenVorschau).
        gegriffen: () => ziehIndex,
        // Der Spieler ist im Testflug das Gegenüber, an dem sich Aggro
        // entscheidet — online liefert der Server dafür die Peer-Positionen.
        spieler: () => (player ? { x: player.position.x, z: player.position.z } : null),
        meldung: (t) => hud.meldung(t),
      });
      // ── Bewuchs-Vorschau im Testflug ────────────────────────────────
      // Streut, was der Server streuen würde — mit DERSELBEN Funktion
      // (`streueZone` aus @wov/shared). Ohne sie blieb eine Insel im
      // Testflug kahl, auch wenn im Editor "Grasland bewachsen" gedrückt
      // war: Offline gibt es keinen ZoneManager.
      //
      // Nur im Layout-Modus sinnvoll — ohne Region gibt es keine
      // Kuratierung und damit nichts vorzuschauen.
      // Cast wie bei `ent` weiter oben: TS sieht die Zuweisung in
      // buildWorld() nicht und hielte `world` hier für `never`.
      const welt = world as ClientWorld | null;
      const bewuchs = welt?.regionGeo
        ? new BewuchsVorschau(
            { seed: welt.seed, geo: welt.geo, heightmaps: welt.heightmaps, regionGeo: welt.regionGeo },
            ent
          )
        : null;
      if (bewuchs) {
        hud.meldung('Bewuchs-Vorschau: wächst um dich herum nach (V baut sie neu auf)');
        window.addEventListener('keydown', (e) => {
          if (tipptImFeld(e) || e.code !== 'KeyV') return;
          bewuchs.neuAufbauen();
          hud.meldung('Bewuchs-Vorschau neu aufgebaut');
        });
      }

      scene.onBeforeRenderObservable.add(() => {
        // Vor buildWorld() gibt es keine Geländehöhe — dann noch nichts tun.
        if (!world) return;
        // Höchstens EINE Zone je Bild (13,4 ms gemessen) — der Umkreis
        // steht damit nach gut einer Sekunde, ohne dass ein Bild reißt.
        if (bewuchs && player) bewuchs.schritt(player.position.x, player.position.z);
        // Dieselbe Deckelung wie die Hauptschleife: Nach einem Tab-Wechsel
        // wäre der erste dt sonst Sekunden lang und der NPC teleportierte.
        vorschau.update(Math.min(engine.getDeltaTime() / 1000, 0.1));
        // Ein Routen-NPC ist dynamisch (SYNCED_TRANSFORM) und käme ohne das
        // flush() aus; eine statische Platzierung an einer Route nicht —
        // ihre Thin-Instance-Matrix wird erst dort neu gebaut. Einmal je
        // Frame, nicht je NPC.
        ent.flush();
      });
      /** Gegriffener Wegpunkt der gewählten Route (−1 = keiner). */
      let routenZiehIndex = -1;
      window.addEventListener('keydown', (e) => {
        if (tipptImFeld(e)) return;
        if (e.code === 'KeyR') {
          const offen = routen.toggle();
          // Wie bei B: Maus freigeben, das Wieder-Einfangen macht der
          // Game-Loop über cursorNoetig().
          if (offen) document.exitPointerLock();
          hud.meldung(
            offen
              ? 'Routen-Editor offen — Route wählen/anlegen, ✎ schaltet das Setzen scharf, R schließt'
              : 'Routen-Editor zu'
          );
        }
        // Esc beendet nur das Zeichnen, nicht das Panel — die Route bleibt.
        if (e.code === 'Escape') routen.beendeZeichnen();
      });

      // Leuchtring markiert Auswahl/Griff; Geist zeigt das Prefab an der Maus.
      const ring = MeshBuilder.CreateTorus('spawnRing', { diameter: 3, thickness: 0.12, tessellation: 48 }, scene);
      const ringMat = new StandardMaterial('spawnRingMat', scene);
      ringMat.emissiveColor = new Color3(0.95, 0.82, 0.35);
      ringMat.disableLighting = true;
      ring.material = ringMat;
      ring.isPickable = false;
      ring.setEnabled(false);
      const ringZu = (x: number, z: number): void => {
        ring.position.set(x, (world?.getGroundHeight(x, z) ?? 0) + 0.15, z);
        ring.setEnabled(true);
      };

      let geistPrefab = '';
      const geistWeg = (): void => {
        // BEDINGUNGSLOS abräumen. Vorher hing das Entfernen an der
        // Merkvariablen `geistPrefab` — und wenn die aus irgendeinem Grund
        // leer war, während die Geist-Instanz noch in der Szene lag, blieb
        // sie für immer stehen. Genau das passierte seit „ein Klick = eine
        // Platzierung": Der Geist fror auf dem eben gesetzten Bauwerk ein,
        // und es sah aus, als wäre doppelt gesetzt worden (gemessen: der
        // Bucket enthielt `edghost` UND `edplace-0`).
        //
        // removeZDO auf einen unbekannten Schlüssel ist ein No-Op, die
        // Bedingung war also nie nötig — nur riskant.
        ent.removeZDO('edghost');
        geistPrefab = '';
        ent.flush();
      };
      /**
       * Prefab für den VORSCHAU-Geist.
       *
       * Rein kosmetische Varianten werden für die Vorschau auf ihre
       * Grundform zurückgeführt. Grund: Der Geist ist eine echte Instanz
       * in der Szene, und der Kuppel-Bewuchs (HuegelGras) streut auf
       * jede Instanz, die er findet. Beim Geist hiess das: Gras wird
       * gestreut, sobald man den Eintrag anklickt — und bleibt in der
       * Luft stehen, sobald der Geist mit der Maus weiterwandert.
       *
       * Für die Vorschau ist das kein Verlust: Beide Varianten haben
       * exakt dieselbe Form, es geht um Lage und Drehung.
       */
      const VORSCHAU_PREFAB: Readonly<Record<string, string>> = {
        GrabhuegelGras: 'Grabhuegel',
      };
      const geistZu = (x: number, z: number): void => {
        const e = panel.einstellung;
        // Prefabwechsel: alter Geist liegt in einem anderen Bucket — erst weg.
        const sichtbar = VORSCHAU_PREFAB[e.prefab] ?? e.prefab;
        if (geistPrefab && geistPrefab !== sichtbar) geistWeg();
        geistPrefab = sichtbar;
        zeige(
          { prefab: VORSCHAU_PREFAB[e.prefab] ?? e.prefab, x, z, yaw: e.yaw ?? 0, scale: e.scale },
          -1 as never
        );
        ent.flush();
      };

      /** Nach Löschen/Umbau: alle edplace-Keys neu aufbauen (Indizes rutschen). */
      const alleNeuZeichnen = (roh: { placements: EntwurfEintrag[] }, vorher: number): void => {
        for (let i = 0; i < vorher; i++) ent.removeZDO(`edplace-${i}`);
        roh.placements.forEach(zeige);
        ent.flush();
      };
      window.addEventListener('keydown', (e) => {
        // Entf im Suchfeld löscht Text — nicht die gegriffene Platzierung.
        if (tipptImFeld(e)) return;
        if (e.code !== 'Delete' || !panel.istOffen || auswahlIndex < 0) return;
        const roh = leseEntwurf();
        if (!roh || !roh.placements[auswahlIndex]) return;
        const weg = roh.placements[auswahlIndex]!;
        const vorher = roh.placements.length;
        roh.placements.splice(auswahlIndex, 1);
        localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
        // Sockel VOR dem Neuzeichnen entfernen: alleNeuZeichnen liest
        // getGroundHeight — Nachbarn sollen wieder auf dem Urgelände sitzen.
        sockelLiveWeg(weg);
        alleNeuZeichnen(roh, vorher);
        hud.meldung(`${weg.prefab} gelöscht`);
        auswahlIndex = -1;
        ring.setEnabled(false);
        panel.aktualisiere();
        // Die Indizes hinter der Lücke rutschen — die Anzeige „gewählte
        // Platzierung" im Routen-Editor darf keine alte Nummer behalten.
        routen.aktualisiere();
        // Aus demselben Grund die Vorschau neu aufbauen: `edplace-3` ist
        // nach dem Löschen ein anderes Objekt, ein weiterlaufender Läufer
        // schöbe das falsche durch die Gegend.
        vorschau.ruecksetzen();
      });

      /** Verwerfen: von Rechtsklick-pointerdown UND contextmenu gerufen —
       *  je nach Browser/Pointer-Lock kommt nur eines von beiden an. */
      let rechtsklickZeit = 0;
      const verwerfen = (): void => {
        rechtsklickZeit = performance.now();
        if (document.pointerLockElement) {
          document.exitPointerLock();
          return;
        }
        ziehIndex = -1;
        routenZiehIndex = -1;
        auswahlIndex = -1;
        ring.setEnabled(false);
        geistWeg();
        panel.beendePlatzierModus();
        // Ohne Auswahl gibt es keine Figur zu bearbeiten — Felder weg.
        panel.aktualisiere();
        // Rechtsklick verwirft auch das Routen-Zeichnen — dieselbe Geste,
        // dieselbe Bedeutung wie beim Prefab-Geist.
        routen.beendeZeichnen();
        hud.meldung('Auswahl verworfen — Prefab in der Liste wählen startet die Vorschau neu');
      };
      canvas.addEventListener('pointerdown', (e) => {
        // Der Routen-Editor darf dieselben Wege benutzen (Wegpunkt setzen,
        // Platzierung zum Zuweisen auswählen) — deshalb genügt es, dass
        // EINES der beiden Editor-Panels offen ist. Ist keines offen,
        // bleibt der Klick unangetastet Spiel-Eingabe.
        if (!panel.istOffen && !routen.istOffen) return;
        if (e.button === 2) {
          e.preventDefault();
          verwerfen();
          return;
        }
        // Nur reiner Linksklick platziert/greift — und nie direkt nach
        // einem Rechtsklick (manche Browser feuern die Folge-Ereignisse
        // in anderer Reihenfolge, das setzte den Gegenstand ungewollt).
        if (e.button !== 0 || e.buttons !== 1 || document.pointerLockElement) return;
        if (performance.now() - rechtsklickZeit < 400) return;
        const p = bodenPunkt(e.offsetX, e.offsetY);
        const roh = leseEntwurf();
        if (!p || !roh) return;
        // ── Routen zuerst ───────────────────────────────────────────────
        // Im Zeichen-Modus gehört JEDER Geländeklick der Route; danach
        // kommt weder Greifen noch Platzieren dran.
        if (routen.istZeichenModus) {
          routen.punktSetzen(p.x, p.z);
          return;
        }
        // Sonst: Wegpunkt der gewählten Route in Griffweite? Dann anfassen.
        // Nur bei offenem Routen-Panel — bei geschlossenem bleibt der
        // Greif-Pfad der Platzierungen exakt wie zuvor.
        if (routen.istOffen) {
          const wp = routen.punktUnter(p.x, p.z);
          if (wp >= 0) {
            routenZiehIndex = wp;
            geistWeg();
            hud.meldung(`Wegpunkt ${wp + 1} von ${routen.gewaehlteId} gegriffen — ziehen verschiebt`);
            return;
          }
        }
        // Nächste Platzierung im Griffradius? Dann greifen statt setzen.
        // Gemessen wird an der SICHTBAREN Stelle: Ein Routen-NPC ist in der
        // Vorschau längst weitergelaufen, und auf seinen unsichtbaren
        // Startpunkt zu zielen wäre Raten. Ohne Vorschau ist das der
        // Eintrag selbst (positionVon liefert dann null).
        let best = -1;
        let bestD = 3;
        roh.placements.forEach((q, i) => {
          const sicht = vorschau.positionVon(i) ?? q;
          const d = Math.hypot(sicht.x - p.x, sicht.z - p.z);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (best >= 0) {
          ziehIndex = best;
          auswahlIndex = best;
          geistWeg();
          const q = roh.placements[best]!;
          // ziehStart bleibt die GESPEICHERTE Stelle: Von dort muss beim
          // Absetzen ein etwaiger Sockel weggeräumt werden.
          ziehStart = { x: q.x, z: q.z };
          const sicht = vorschau.positionVon(best) ?? q;
          ringZu(sicht.x, sicht.z);
          // Der Routen-Editor zeigt die gewählte Platzierung an (Ziel von
          // „→ zuweisen") — er erfährt den Wechsel nur hierüber.
          routen.aktualisiere();
          // Aus demselben Grund das Spawn-Panel: Die NPC-Felder gehören
          // zur gewählten Platzierung und müssen jetzt die ihre zeigen.
          panel.aktualisiere();
          hud.meldung(`${q.prefab} gegriffen — ziehen verschiebt, Entf löscht`);
        } else if (panel.istOffen && panel.istPlatzierModus) {
          // `panel.istOffen` steht hier zusätzlich, weil der Klick seit dem
          // Routen-Editor auch bei GESCHLOSSENEM Spawn-Panel hier ankommt:
          // Gesetzt wird weiterhin nur mit sichtbarer Prefab-Liste — sonst
          // platzierte ein Klick beim Routenzeichnen aus einem Modus, den
          // man gerade gar nicht sieht.
          const einst = panel.einstellung;
          const sockel = einst.einebnen ? sockelRadius() : undefined;
          const eintrag = {
            prefab: einst.prefab,
            x: Math.round(p.x * 10) / 10,
            z: Math.round(p.z * 10) / 10,
            yaw: einst.yaw ?? Math.random() * Math.PI * 2,
            ...(Math.abs(einst.scale - 1) > 1e-3 ? { scale: einst.scale } : {}),
            ...(sockel !== undefined ? { einebnen: sockel } : {}),
          };
          roh.placements.push(eintrag);
          localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
          // Erst planieren, DANN zeichnen — siehe platziere().
          if (sockel !== undefined) sockelLiveDazu(eintrag.x, eintrag.z, sockel);
          zeige(eintrag, roh.placements.length - 1);
          ent.flush();
          // Wie in platziere(): frisch gesetzte Figur ist gewählt.
          if (istNpcPrefab(einst.prefab)) auswahlIndex = roh.placements.length - 1;
          panel.aktualisiere();
          hud.meldung(
            `${einst.prefab} platziert @ (${eintrag.x}, ${eintrag.z})` +
              (sockel !== undefined ? ` — Boden planiert (r=${sockel} m)` : '')
          );
          // Ein Klick = eine Platzierung: Modus endet, der Geist folgt der
          // Maus nicht weiter — sonst setzt der nächste beiläufige Klick
          // (oder das Schließen-und-Wiederklicken um B) ungewollt erneut.
          panel.beendePlatzierModus();
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        if ((!panel.istOffen && !routen.istOffen) || document.pointerLockElement) return;
        const p = bodenPunkt(e.offsetX, e.offsetY);
        if (!p) return;
        // Gegriffener Wegpunkt folgt der Maus (Linie und Marker werden in
        // punktVerschieben neu gezeichnet).
        if (routenZiehIndex >= 0) {
          routen.punktVerschieben(routenZiehIndex, p.x, p.z);
          return;
        }
        // Im Zeichen-Modus hängt bewusst NICHTS an der Maus — der Geist
        // gehört dem Prefab-Setzen, und beides zugleich wäre irreführend.
        if (routen.istZeichenModus) return;
        if (ziehIndex < 0) {
          // Vorschau: Das gewählte Prefab hängt sichtbar an der Maus,
          // erst der Klick setzt es — aber NUR im aktiven Platzier-Modus
          // (bewusste Wahl in der Liste; Abwahl/Esc/Rechtsklick beendet).
          // `istOffen` wie beim Setzen: kein Geist ohne sichtbare Liste.
          if (panel.istOffen && panel.istPlatzierModus) {
            geistZu(Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10);
          }
          return;
        }
        const roh = leseEntwurf();
        if (!roh || !roh.placements[ziehIndex]) return;
        const q = roh.placements[ziehIndex]!;
        q.x = Math.round(p.x * 10) / 10;
        q.z = Math.round(p.z * 10) / 10;
        localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
        zeige(q, ziehIndex); // gleicher Key ⇒ Matrix-Update, kein Duplikat
        ringZu(q.x, q.z);
        ent.flush();
      });
      canvas.addEventListener('contextmenu', (e) => {
        // Auch mit nur offenem Routen-Panel: Rechtsklick bricht ab, statt
        // das Browser-Menü über die Szene zu legen.
        if (!panel.istOffen && !routen.istOffen) return;
        e.preventDefault();
        // Doppelt ausgelöst (pointerdown + contextmenu)? Die Sperre in
        // verwerfen() macht den zweiten Aufruf harmlos.
        if (performance.now() - rechtsklickZeit > 50) verwerfen();
      });
      panel.aufWahl = () => {
        // Wahl/Modus im Panel hat sich geändert: Bei Abwahl den Geist
        // sofort abräumen; bei (Neu-)Wahl zeichnet ihn das nächste
        // pointermove — geistZu() räumt einen Prefab-Wechsel selbst auf.
        if (!panel.istPlatzierModus) geistWeg();
        // Andersherum als aufZeichenStart: Wer in der Prefab-Liste einen
        // Eintrag scharf schaltet, hört damit auf, Wegpunkte zu setzen.
        if (panel.istPlatzierModus) routen.beendeZeichnen();
        panel.aktualisiere();
      };
      window.addEventListener('pointerup', () => {
        if (routenZiehIndex >= 0) {
          hud.meldung(`Wegpunkt ${routenZiehIndex + 1} abgesetzt`);
          routenZiehIndex = -1;
          return;
        }
        if (ziehIndex < 0) return;
        const roh = leseEntwurf();
        const q = roh?.placements[ziehIndex];
        // Sockel zieht mit um: alte Platte raus, neue rein, Objekt und
        // Ring neu aufsetzen — erst NACH dem Absetzen, damit nicht bei
        // jedem pointermove Kacheln neu gebaut werden.
        if (q?.einebnen && ziehStart && (ziehStart.x !== q.x || ziehStart.z !== q.z)) {
          sockelLiveWeg({ x: ziehStart.x, z: ziehStart.z, einebnen: q.einebnen });
          sockelLiveDazu(q.x, q.z, q.einebnen);
          zeige(q, ziehIndex);
          ringZu(q.x, q.z);
          ent.flush();
        }
        if (q) hud.meldung(`${q.prefab} abgesetzt @ (${q.x}, ${q.z})`);
        ziehStart = null;
        ziehIndex = -1;
        panel.aktualisiere();
      });
    }
  }

  // F9 toggles the Babylon Inspector (dev only)
  // Menu keys. The callback returns whether the game should capture the mouse
  // again afterwards; InputManager does the taking/releasing around it.
  //
  // Only panels that need a cursor release the mouse — the inventory (items get
  // dragged) and the settings. The tool menu deliberately does NOT: it is
  // driven by keys 1-8 and the wheel, so the pointer never leaves the game and
  // the tool works the instant the menu closes. Handing the lock back and forth
  // was what made picking a mode and then using it fall apart.
  const cursorNoetig = (): boolean =>
    inventoryPanel?.isVisible === true ||
    settingsPanel.isVisible ||
    worldMap?.isVisible === true ||
    craftingPanel.isVisible ||
    dungeonEditor?.isVisible === true ||
    spawnEditorOffen() ||
    routenEditorOffen();
  input.onMenuKey('KeyM', () => {
    // Die Karte braucht die Maus (Ziehen, Zoomen, Abfrage unter dem Zeiger),
    // liegt also im selben Lager wie das Inventar: Zeiger frei.
    worldMap?.toggle();
    if (worldMap?.isVisible) {
      inventoryPanel?.hide();
      placement?.closeMenu();
    }
    return !cursorNoetig();
  });
  input.onMenuKey('KeyI', () => {
    inventoryPanel?.toggle();
    // Opening the inventory closes the tool menu, so only one is ever up.
    if (inventoryPanel?.isVisible) placement?.closeMenu();
    return !cursorNoetig();
  });
  input.onMenuKey('Tab', () => {
    if (inventoryPanel?.isVisible) inventoryPanel.hide();
    placement?.toggleMenu();
    return !cursorNoetig();
  });
  input.onMenuKey('KeyC', () => {
    craftingPanel.toggle();
    if (craftingPanel.isVisible) {
      inventoryPanel?.hide();
      placement?.closeMenu();
    }
    return !cursorNoetig();
  });
  input.onMenuKey('Escape', () => {
    // Escape closes whatever is open. The browser drops the lock on Escape
    // anyway — this way that is a deliberate step, not a broken state.
    inventoryPanel?.hide();
    placement?.closeMenu();
    worldMap?.hide();
    craftingPanel.hide();
    dungeonEditor?.hide();
    return false;
  });
  // F4: Dungeon-Editor (Phase G) — nur sinnvoll IN einer Instanz, weil der
  // Server das Dokument des aktuellen Dungeons liefert und Speichern die
  // Instanz um einen herum neu aufbaut. Braucht die Maus (Listen, Knöpfe).
  input.onMenuKey('F4', () => {
    if (!imDungeon || !socket?.connected) {
      hud.meldung('Dungeon-Editor: erst eine Dungeon-Instanz betreten (E am Eingang)');
      return true;
    }
    dungeonEditor?.toggle();
    return !cursorNoetig();
  });
  // 1-8: hotbar slots (ZInput Hotbar1..8) — but while the tool menu is open the
  // same keys pick its modes, so a mode is chosen without ever letting go of
  // the mouse. Bound as menu keys so the lock is taken back inside the gesture
  // if the inventory had released it.
  // 9 statt 8: Die Hotbar hat acht Plätze, die Hammer-Tabelle inzwischen
  // neun Einträge. Ohne Digit9 wäre der letzte nur per Mausklick erreichbar,
  // obwohl die Kachel eine "9" anzeigt.
  for (let i = 0; i < 9; i++) {
    input.onMenuKey(`Digit${i + 1}`, () => {
      if (placement?.menuOpen) {
        const piece = placement.pieces[i];
        if (piece) pieceSelection?.pick(piece.name);
      } else if (i < 8) {
        equipment?.useHotbar(i);
      }
      return !cursorNoetig();
    });
  }

  window.addEventListener('keydown', (e) => {
    // Tasten, die nur bei aufgeschlagener Karte gelten (zentrieren, zoomen).
    if (worldMap?.taste(e.code)) {
      e.preventDefault();
      return;
    }
    // F9 blendet den Babylon-Inspector ein — NUR im Dev-Server.
    //
    // Der Import war schon immer dynamisch, gebaut wurde er trotzdem: der
    // GUI-Editor des Inspectors ist ein 4,16-MB-Chunk, der im
    // Produktionsbündel mit ausgeliefert wurde, obwohl ihn dort nie jemand
    // anfordert. `import.meta.env.DEV` ist im Build eine Konstante (false),
    // deshalb wirft Rollup den ganzen Zweig samt dynamischem Import weg und
    // der Chunk entsteht gar nicht erst. Im Dev-Server ist der Wert true und
    // Vite lädt den Inspector wie bisher auf Tastendruck nach.
    if (e.code === 'F9' && import.meta.env.DEV) {
      e.preventDefault();
      void import('@babylonjs/inspector').then(() => {
        if (scene.debugLayer.isVisible()) scene.debugLayer.hide();
        else void scene.debugLayer.show({ embedMode: true });
      });
    }
  });

  /** Windzeiger der Minimap — einmal angelegt, pro Frame beschrieben. */
  const minimapWind = { dirX: 0, dirZ: 0, intensity: 0 };

  scene.onBeforeRenderObservable.add(() => {
    if (!world || !terrain || !player || !entities || !grass) return; // waiting for buildWorld()
    const updateStart = performance.now();
    gemessenDieserFrame = 0;
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    const elapsed = performance.now() / 1000;

    // I opens the inventory and Tab the tool menu — both bound via
    // input.onMenuKey() below, because they hand the pointer lock back and
    // forth and that has to happen inside the key gesture itself. The same
    // goes for 1-8 (hotbar, or the tool modes while the menu is up).
    updateLockHint();
    // Any open menu means: cursor free, so it can be clicked.
    input.setUiOpen(cursorNoetig());

    miss('spieler', () => player!.update(dt));
    // Soft-Reconciliation: Client und Server rechnen dieselbe Bewegung,
    // driften aber unter Latenz/Paketverlust auseinander. Kleine Drift
    // wird weich zurueckgezogen, grosse hart gesetzt. Im Dungeon ist der
    // Client fuer y autoritativ (Raum-Collider) — dort nur x/z pruefen.
    if (serverPos && socket?.connected && !player.frozen) {
      const dx = serverPos.x - player.position.x;
      const dz = serverPos.z - player.position.z;
      const dy = imDungeon ? 0 : serverPos.y - player.position.y;
      const drift = Math.hypot(dx, dy, dz);
      if (drift > 8) {
        player.teleportTo(serverPos.x, imDungeon ? player.position.y : serverPos.y, serverPos.z);
      } else if (drift > 1.5) {
        const f = 1 - Math.exp(-dt / 0.4);
        player.position.x += dx * f;
        player.position.z += dz * f;
        if (!imDungeon) player.position.y += dy * f;
      }
    }
    // Zielen/Ghost/Auslösen nach der Spielerbewegung, damit Kamera und
    // Fußhöhe im selben Frame aktuell sind.
    placement?.update(dt);
    pieceSelection?.render();
    // Im Dungeon kein Terrain-Streaming: Es gäbe an x≈100000 nichts zu
    // bauen, und das Wasser würde dem Spieler in die Instanz folgen.
    if (!imDungeon) {
      miss('terrain', () => terrain!.update(player!.position.x, player!.position.z, elapsed));
    }
    // Weather follows the biome under the player (EnvMan.m_biomeEnvironments);
    // Lighting cross-fades, so calling this every frame is cheap and smooth.
    // Keep the clock running between TimeSync packets — see `worldTime`.
    worldTime += dt;
    const biome = world.geo.getBiome(player.position.x, player.position.z);
    if (!weather) {
      weather = new WeatherManager(biome, worldTime);
      // ?env=<name> pinnt nicht nur die Optik, sondern das ganze Wetter —
      // sonst zöge der Niederschlag weiter dem Biom-Würfel hinterher.
      if (envPinned) weather.setEnvironmentOverride(params.get('env'));
    }
    weather.setBiome(biome);
    const wx = weather.update(worldTime, dt);
    if (imDungeon) {
      // Phase G: im Dungeon zählt das Interior-Environment der Instanz
      // (alwaysDark — Unity EnvZone via Location.m_interiorEnvironment),
      // nicht das Biom-Wetter der Oberwelt.
      lighting.setEnvironmentByName(dungeonEnv);
    } else if (!envPinned) {
      // The weather is picked here (EnvMan.UpdateEnvironment); Lighting does
      // the cross-fade, so only the target is handed over.
      lighting.setEnvironmentByName(wx.to.name);
    }
    lighting.apply(dt);
    // Ein Wind für die ganze Szene — und zwar BEIDE Vektoren plus Blend,
    // wie EnvMan sie als _GlobalWind1/_GlobalWind2/_GlobalWindAlpha setzt.
    // Jeder Shader wertet seine Auslenkung für beide aus und mischt die
    // Ergebnisse (WaterVolume.CalcWave); den Vektor zu mischen würde ihn
    // bei einem 180°-Wechsel durch Null schicken.
    const { wind1, wind2, alpha } = wx.windData;
    WindPlugin.dirX = wind1.dirX;
    WindPlugin.dirZ = wind1.dirZ;
    WindPlugin.intensity = wind1.intensity;
    WindPlugin.dir2X = wind2.dirX;
    WindPlugin.dir2Z = wind2.dirZ;
    WindPlugin.intensity2 = wind2.intensity;
    WindPlugin.alpha = alpha;
    ClutterWindPlugin.dirX = wind1.dirX;
    ClutterWindPlugin.dirZ = wind1.dirZ;
    ClutterWindPlugin.intensity = wind1.intensity;
    ClutterWindPlugin.dir2X = wind2.dirX;
    ClutterWindPlugin.dir2Z = wind2.dirZ;
    ClutterWindPlugin.intensity2 = wind2.intensity;
    ClutterWindPlugin.alpha = alpha;
    // Wasser: wind.w ist die Wellenamplitude, wind.xz die Richtung der
    // ersten Oktave.
    WaterPlugin.windIntensity = wind1.intensity;
    WaterPlugin.windDirX = wind1.dirX;
    WaterPlugin.windDirZ = wind1.dirZ;
    WaterPlugin.windIntensity2 = wind2.intensity;
    WaterPlugin.windDir2X = wind2.dirX;
    WaterPlugin.windDir2Z = wind2.dirZ;
    WaterPlugin.windAlpha = alpha;
    lightPool?.update(player.position.x, player.position.y, player.position.z, dt);
    // Minimap: Detailausschnitt + Windzeiger (budgetiert, zeichnet selbst).
    // Gehaltenes Wind-Objekt statt eines Literals je Frame — die Minimap
    // liest es nur, sie behält es nicht.
    minimapWind.dirX = wind1.dirX;
    minimapWind.dirZ = wind1.dirZ;
    minimapWind.intensity = wind1.intensity;
    minimap?.update(player.position.x, player.position.z, player.yaw, minimapWind);
    // Regen/Schnee/Asche: Menge aus der Nässe-Rampe, Schräglage aus dem
    // Wind (GlobalWind.velocityOverLifetime im Original).
    // Gras um aufsammelbare Gegenstände freihalten (Flint, Stein, Löwenzahn
    // …) — sonst verschwinden sie im hohen Gras. Nicht jeden Frame: die
    // Liste ändert sich nur, wenn neue ZDOs hereinkommen.
    clearingTimer += dt;
    if (clearingTimer >= 1.0) {
      clearingTimer = 0;
      const nahe = entities.nearbyInstances(player.position.x, player.position.z, 70);
      // Eigene {x,z}-Literale statt der Einträge selbst: `nahe` liefert die
      // INTERNEN Indexeinträge des EntityManagers (s. StatischeInstanz), und
      // diese Liste wandert bis in GrassClutter.setClearings weiter. Wer
      // dort irgendwann ein Feld schriebe, verschöbe eine echte Instanz im
      // Umkreis-Index.
      const freihalten: Array<{ x: number; z: number }> = [];
      for (const i of nahe) {
        if (i.prefab.startsWith('Pickable')) freihalten.push({ x: i.x, z: i.z });
      }
      // Begehbare Bauwerke halten ihre GRUNDFLÄCHE frei, nicht nur einen
      // Punkt. Beim Grabhügel ist das keine Kosmetik: Sein Kammerboden liegt
      // bewusst auf Geländehöhe, damit der Weltspawn hineinfällt — der Boden
      // der Grabkammer IST also das gewachsene Gelände, und ohne Aussparung
      // wächst mitten in der Kammer kniehohes Wiesengras.
      for (const b of nahe) {
        if (!INNENRAUM_OHNE_GRAS.test(b.prefab)) continue;
        const def = findPrefabByName(b.prefab);
        // Halbe Modellbreite, auf den Innenraum eingezogen — der Kranz aus
        // Randsteinen draußen soll ruhig im Gras stehen.
        const r = ((def?.renderScale.w ?? 8) / 2) * 0.62;
        // Schrittweite 0,8 statt 1,0: clearArea entfernt bestehende Halme
        // nur im 0,6-m-Kreis um jeden Punkt. Bei 1,0 m Raster bleiben in
        // den Zwickeln Büschel stehen (Diagonalabstand 0,71 > 0,6) — genau
        // die vereinzelten Grasinseln, die in der Grabkammer standen. Bei
        // 0,8 m ist die halbe Diagonale 0,57 und die Kreise überdecken sich.
        for (let dz = -r; dz <= r; dz += 0.8) {
          for (let dx = -r; dx <= r; dx += 0.8) {
            if (dx * dx + dz * dz <= r * r) freihalten.push({ x: b.x + dx, z: b.z + dz });
          }
        }
      }
      // Platzierungen MIT Sockel halten die GANZE Platte frei: Gang und
      // Portal des Grabhügels liegen außerhalb des 0,62-Innenraums oben —
      // dort wuchs Klutter-Gras mitten im Eingang. Die Liste kommt aus dem
      // Layout (buildWorld) bzw. den Live-Edits des Testflugs; das
      // Instanzen-Nahfeld kennt die Sockelradien nicht.
      for (const s of sockelFreiflaechen) {
        if (Math.hypot(s.x - player.position.x, s.z - player.position.z) > 70 + s.r) continue;
        for (let dz = -s.r; dz <= s.r; dz += 0.8) {
          for (let dx = -s.r; dx <= s.r; dx += 0.8) {
            if (dx * dx + dz * dz <= s.r * s.r) freihalten.push({ x: s.x + dx, z: s.z + dz });
          }
        }
      }
      grass.setClearings(freihalten);
    }

    objectLabels?.update(player.position.x, player.position.z);
    namensschilder?.update(dt, player.position);
    precipitation?.setPlayerPosition(player.position.x, player.position.y, player.position.z);
    // In der Instanz regnet es nicht — Menge 0 lässt den Partikelstrom leerlaufen.
    precipitation?.update(
      wx.precipitation,
      imDungeon ? 0 : wx.precipitationAmount,
      wx.wind.dirX * wx.wind.intensity,
      wx.wind.dirZ * wx.wind.intensity
    );
    // Wasser: Himmel und Sonne für Spiegelung und Glitzern.
    //
    // Die Farben kommen aus derselben Momentaufnahme, aus der auch die
    // Himmelskuppel gezeichnet wird — das Wasser wertet damit denselben
    // Verlauf an der Spiegelrichtung aus (vhSkyGradient, ValheimSky.ts).
    // Vorher stand hier dreimal `fogColorSun`, also der Sonnenton
    // unabhängig von der Blickrichtung; siehe Kommentar dort.
    const himmel = lighting.sky.reflectState;
    WaterPlugin.skyHorizon.copyFrom(himmel.horizon);
    WaterPlugin.skyZenith.copyFrom(himmel.zenith);
    WaterPlugin.skySunGlow.copyFrom(himmel.sunGlow);
    WaterPlugin.sunColor.copyFrom(lighting.sun.diffuse);
    // Licht auf der Wassersäule — ohne das ignoriert das Wasser die
    // Tageszeit (siehe WaterPlugin, "Licht auf der Wassersäule").
    WaterPlugin.ambient.copyFrom(lighting.ambient.diffuse);
    WaterPlugin.sunIntensity = lighting.sun.intensity;
    WaterPlugin.night = himmel.night;
    WaterPlugin.skyProbe = lighting.sky.probe.cubeTexture;
    WaterPlugin.sunX = lighting.state.lightDir.x;
    WaterPlugin.sunY = lighting.state.lightDir.y;
    WaterPlugin.sunZ = lighting.state.lightDir.z;

    // G-TEX: sync sun/ambient/fog into the terrain splat material
    terrain.syncLighting(
      lighting.sun.direction,
      lighting.sun.diffuse,
      lighting.ambient.diffuse,
      scene.fogDensity,
      // LINEAR — `scene.fogColor` ist Babylons Gamma-Wert und würde vom
      // ImageProcessing-Pass ein zweites Mal aufgehellt (Lighting.ts).
      lighting.fogColorLinear,
      // Zweite Nebelfarbe und Sonnenrichtung für den gerichteten Nebel.
      // Weltkoordinaten, weil die Nebelkette des Terrains dort rechnet —
      // Standard und PBR bekommen dieselbe Richtung im Sichtraum.
      lighting.fogColorSonnenLinear,
      lighting.zurSonneWelt
    );
    WindPlugin.time += dt;
    // G-VEG: grass clutter follows the player, wind time advances.
    // Im Dungeon eingefroren — an x≈100000 gibt es keine Vegetation.
    if (!imDungeon) {
      grass.setPlayerPosition(player.position.x, player.position.z);
      miss('gras', () => grass!.update(dt, scene.fogDensity));
      // Kuppelbewuchs: streut einmalig, sobald Modell und Grasmaterial
      // bereitstehen, und prueft danach nicht weiter.
      huegelGras?.update(dt);
      // Kuppel-Bewuchs des Meadows-Grabhügels (pollt intern im Sekundentakt).
    }
    // Fern-Unschärfe: Autofokus nachführen (Post-Process selbst läuft auf der GPU).
    post?.update(dt, lighting.state.sunDir);

    // Phase G: nach dem Instanz-Teleport auftauen, sobald der Mesh-Collider
    // des Eingangsraums steht (oder nach 20 s Notausstieg — dann trägt zur
    // Not der Rettungsanker im PlayerController).
    if (player.frozen && imDungeon) {
      // Präziser als das frühere colliderNahe(12): Erst auftauen, wenn die
      // Sonde DIREKT UNTER dem Spieler einen Körper findet — ein bereits
      // geladener Nachbarraum in 12 m Entfernung trug einen nicht
      // (Nutzerbericht: beim Betreten durch den Dungeon gefallen).
      const bereit =
        player.bodenSonde !== null &&
        player.bodenSonde(player.position.x, player.position.y, player.position.z) !== null;
      if (bereit || performance.now() - dungeonLadenSeit > 20000) {
        player.frozen = false;
        hud.meldung(
          bereit
            ? 'Dungeon geladen — E am Eingang: verlassen'
            : 'Dungeon ohne Bodenkollision geladen — Vorsicht'
        );
      }
    }

    // F isst das beste Essen im Inventar (ESSEN-Tabelle, absteigender Bonus).
    if (input.wasPressed('KeyF') && socket?.connected && !cursorNoetig() && inventory) {
      const kandidat = Object.entries(ESSEN)
        .sort((a, b) => b[1].bonus - a[1].bonus)
        .find(([name]) => inventory!.countOf(name) > 0);
      if (kandidat) {
        // Abzug macht der Server (InventorySync bestätigt).
        socket.sendEat(kandidat[0]);
      } else {
        hud.meldung('Nichts Essbares im Inventar');
      }
    }

    // Linksklick = Nahkampfschlag — nur bei gefangener Maus und ohne
    // gewähltes Bauteil (sonst gehört der Klick dem Werkzeug).
    angriffCooldown = Math.max(0, angriffCooldown - dt);
    if (
      input.wasMousePressed(0) &&
      socket?.connected &&
      angriffCooldown === 0 &&
      document.pointerLockElement &&
      !placement?.selectedPiece &&
      !cursorNoetig()
    ) {
      angriffCooldown = 0.5;
      socket.sendAttack(
        player.position.x,
        player.position.y,
        player.position.z,
        player.yaw,
        equipment?.rightItem?.shared.name ?? ''
      );
    }

    // E ist kontextsensitiv: Interagierbares in Reichweite (Pickable, Tür,
    // Truhe) gewinnt; sonst Dungeon betreten/verlassen.
    if (input.wasPressed('KeyE') && socket?.connected && !cursorNoetig()) {
      const ziel = entities?.naechstesInteragierbares(player.position.x, player.position.z, 3);
      const zielDef = ziel ? findPrefabByName(ziel.prefab) : null;
      if (ziel && zielDef && (zielDef.flags & PrefabFlag.FIREPLACE) !== 0n) {
        // Braten macht der Server (prüft RawMeat im Server-Inventar).
        socket.sendInteract(ziel.x, ziel.y, ziel.z, ziel.prefabHash);
      } else if (ziel && ziel.prefab === 'StatueDeer') {
        // Opfergabe prüft der Server (2 Hirschtrophäen); die lokale
        // Abfrage bleibt nur als freundlicher Vorab-Hinweis.
        if ((inventory?.countOf('TrophyDeer') ?? 0) >= 2) {
          socket.sendInteract(ziel.x, ziel.y, ziel.z, ziel.prefabHash);
        } else {
          hud.meldung('Der Altar verlangt 2 Hirschtrophäen');
        }
      } else if (ziel) {
        socket.sendInteract(ziel.x, ziel.y, ziel.z, ziel.prefabHash);
      } else if (imDungeon) {
        const dx = player.position.x - dungeonSpawn.x;
        const dz = player.position.z - dungeonSpawn.z;
        if (dx * dx + dz * dz <= 6 * 6) {
          socket.sendAdminCommand('dungeon leave');
        } else {
          hud.meldung('Zum Verlassen zurück zum Eingang (E)');
        }
      } else {
        socket.sendAdminCommand('dungeon enter');
      }
    }

    // 20 Hz input → server (drives sector visibility + own player ZDO)
    if (socket?.connected) {
      inputAccum += dt;
      if (inputAccum >= INPUT_SEND_RATE_MS / 1000) {
        inputAccum -= INPUT_SEND_RATE_MS / 1000;
        const mv = player.moveIntent;
        // Phase G: im Dungeon meldet der Client seine Physik-Höhe über das
        // moveY-Feld — der Server hat dort keine Heightmap, nur der Client
        // simuliert die Raum-Collider (siehe handlePlayerInput serverseitig).
        socket.sendPlayerInput(
          mv.x,
          mv.z,
          player.yaw,
          player.pitch,
          imDungeon ? player.position.y : 0,
          mv.running,
          false
        );
      }
    }

    // Kollisionskörper folgen dem Spieler (nur die Umgebung bekommt welche)
    // — vor flush(), damit ein dadurch dirty markierter Bucket im selben
    // Frame neu gebaut wird.
    // Werferliste der Schatten der Spielerposition nachführen. tick()
    // arbeitet einen ggf. laufenden Scan budgetiert weiter ab (s. Shadows.ts).
    shadows?.setPlayerPosition(player.position.x, player.position.z);
    shadows?.tick();
    miss('entities', () => {
      // Die Uebergabegrenze je Bild nachfuehren: Sie ist ein STATIC,
      // damit der geplante Sweep 150/180/240 ueber `window.__dbg`
      // gefahren werden kann, ohne neu zu bauen. Der EntityManager liest
      // sie aus einem eigenen Feld, um keinen Wertimport auf
      // BaumImpostor zu brauchen.
      entities!.impostorGrenze = BaumImpostor.grenze;
      entities!.setPlayerPosition(player!.position.x, player!.position.z);
      entities!.updateDynamics(dt);
      entities!.flush();
    });

    loading?.update(terrain.loadProgress, terrain.ready);

    hud.setAnvisiert(anvisiert?.finde(player.position.x, player.position.z) ?? null);

    const swimming = player.position.y < WATER_LEVEL;
    hud.update(
      dt,
      engine.getFps(),
      `${netStatus}\n` +
        // Baumodus (Editor-Testflug, Taste V): sichtbar machen, WARUM die
        // Figur gerade schwebt und die Kamera so weit heraus darf.
        (player.bauModus ? `BAUMODUS  V beendet — Leer steigt, X sinkt\n` : '') +
        `renderer ${engine.isWebGPU ? 'WebGPU' : 'WebGL2'}  pos ${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}  h ${player.position.y.toFixed(1)}${swimming ? ' (Wasser)' : ''}\n` +
        `chunks ${terrain.chunkCount} (+${terrain.queuedCount})  zdo s:${entities.staticCount} d:${entities.dynamicCount}\n` +
        `zeit ${(lighting.timeOfDay * 24).toFixed(1)}h  assets-fehler ${assets.failed.size}\n` +
        `env ${lighting.environmentName}${envPinned ? ' (pinned)' : ''}  ` +
        `${lighting.state.isNight ? 'nacht' : 'tag'}  ` +
        `nebel ${lighting.state.fogDensity.toFixed(4)}  sonne ${lighting.state.lightIntensity.toFixed(2)}  ` +
        `dof ${post?.debugLine ?? '-'}\n` +
        `schatten ${shadows?.info ?? '-'}  fackeln ${lightPool?.info ?? '-'}\n` +
        // Wind: Richtung als Kompasswinkel und Stärke 0..1, plus die Nässe.
        // Beides folgt dem Wetter (EnvMan) und ist die Basis fürs Segeln.
        `kollision ${entities.colliderStats.bodies} inst / ${entities.colliderStats.havok} havok / ` +
        `${entities.colliderStats.prefabs} prefabs / ${entities.colliderStats.ohneForm} ohne form\n` +
        (weather
          ? `wind ${compass(weather.windAngleDeg)} ${weather.windAngleDeg.toFixed(0)}°  ` +
            `stärke ${weather.windIntensity.toFixed(2)}  nass ${weather.wetness.toFixed(2)}  ` +
            `niederschlag ${precipitation?.debugLine ?? '-'}\n`
          : '') +
        // Eingabe-Diagnose: zeigt, ob die Maus gefangen ist und auf welchem Weg
        // der letzte Linksklick angekommen ist (Browser verhalten sich hier
        // unterschiedlich — siehe engine/InputManager.ts).
        input.debugLine
    );

    // Last thing in the frame: everything above has now seen this frame's
    // key/button presses, so the edge state can be dropped.
    input.endFrame();

    // Alles, was nicht in einem der vier groben Abschnitte steckt: Wetter,
    // Licht, Schattenlisten, Wasser-Uniforms, Minimap und HUD. Gerade diese
    // bislang unsichtbare Summe ist fuer den WebGPU-Lauf entscheidend, weil
    // GPU und eigentlicher Draw-Abschnitt zusammen deutlich unter 10 ms
    // bleiben, der Gesamtframe aber etwa 16 ms braucht.
    const restDauer = Math.max(0, performance.now() - updateStart - gemessenDieserFrame);
    const rest = zeitmess.rest!;
    rest.summe += restDauer;
    rest.n++;
    if (restDauer > rest.max) rest.max = restDauer;
  });

  engine.runRenderLoop(() => {
    if (!scene.activeCamera) return; // no PlayerController/camera until buildWorld() runs
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());

  // dev/debug handle (Playwright probes, F9 inspector sessions)
  (window as unknown as Record<string, unknown>).__dbg = { scene, input, gameSettings, get post() { return post; }, get entities() { return entities; }, assets, get terrain() { return terrain; }, lighting, get player() { return player; }, get world() { return world; }, get inventory() { return inventory; }, get equipment() { return equipment; }, get placement() { return placement; }, get grass() { return grass; }, get shadows() { return shadows; }, get namensschilder() { return namensschilder; },
    // Fackeln: Helligkeit auf echter Hardware nachziehen, Notbremse von
    // Hand auslösen oder wieder lösen — s. engine/FackelLicht.ts.
    fackeln: {
      get zustand() { return `${FackelLichter.anzahl}/${FackelLichter.plaetze} plaetze, staerke ${FackelLichter.staerke}`; },
      staerke: (v: number) => { FackelLichter.staerke = v; },
      notbremse: () => fackelNotbremse('von Hand über __dbg ausgelöst'),
      notbremseLoesen: fackelNotbremseLoesen,
    } };
}

void main();
