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
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import {
  WATER_LEVEL,
  ESSEN,
  sanitizeWorldLayout,
  layoutBounds,
  PacketType,
  PrefabFlag,
  findPrefabByName,
  getStableHash,
  opRadius,
  TERRAIN_HIT_OPS,
  Inventory,
  findItem,
  WeatherManager,
  WORLD_TIME_LENGTH,
  FRACTION_SUNRISE,
  FRACTION_MIDDAY,
  FRACTION_SUNSET,
} from '@wov/shared';
import { createWorld, DEFAULT_OFFLINE_SEED, type ClientWorld, type ClientWorldSettings } from './world/World';
import { TerrainManager } from './engine/Terrain';
import { Lighting } from './engine/Lighting';
import { installiereStandardGammaFix } from './engine/StandardGammaFix';
import { installierePbrNebelFix } from './engine/PbrNebelFix';
import { InputManager } from './engine/InputManager';
import { AssetManager } from './engine/AssetManager';
import { WindPlugin } from './engine/WindPlugin';
import { ClutterWindPlugin } from './engine/ClutterWindPlugin';
import { initPhysics, bodenHoeheUnter } from './engine/Physics';
import { WaterPlugin } from './engine/WaterPlugin';
import { Precipitation } from './engine/Precipitation';
import { EntityManager } from './entities/EntityManager';
import { PlayerController } from './player/PlayerController';
import { GameSocket } from './net/GameSocket';
import { parseZDOSync } from './net/ZDOSync';
import { Hud } from './ui/Hud';
import { GrassClutter } from './engine/GrassClutter';
import { SettingsStore } from './ui/Settings';
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
import { WorldMap } from './ui/WorldMap';
import { setzeKartenMasse } from './ui/worldmap/mapTypes';
import { SpawnPanel } from './editor/SpawnPanel';
import { DungeonEditor } from './ui/DungeonEditor';
import { Minimap } from './ui/Minimap';
import { LightPool } from './engine/LightPool';
import { CraftingPanel } from './ui/CraftingPanel';
import { GameAudio } from './engine/GameAudio';

const INPUT_SEND_RATE_MS = 50; // 20 Hz like the old client / original

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
  if (await WebGPUEngine.IsSupportedAsync) {
    const engine = new WebGPUEngine(canvas, { antialias: true });
    await engine.initAsync();
    console.log('[engine] WebGPU');
    return engine;
  }
  console.log('[engine] WebGL2 fallback');
  // `powerPreference: 'high-performance'` ist auf Geräten mit zwei GPUs
  // (Laptop: iGPU + dGPU) der Unterschied zwischen Onboard-Grafik und
  // echter Karte — ohne die Angabe wählt der Browser gern die sparsame.
  // `adaptToDeviceRatio` bleibt AUS (Default): Auf einem HiDPI-Schirm
  // würde es die Pixelzahl vervierfachen; die Auflösung regelt stattdessen
  // die Einstellung "Renderauflösung" (engine.setHardwareScalingLevel).
  return new Engine(canvas, true, { stencil: true, powerPreference: 'high-performance' });
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
  /** Layout-Handshake: ServerConfig kündigte ein WorldLayoutData an. */
  let layoutErwartet: { worldSeed: string; settings: ClientWorldSettings } | null = null;
  /** Aktives WorldLayout (Layout-Modus) — Karte/Editor lesen es mit. */
  let worldLayout: unknown = null;
  let terrain: TerrainManager | null = null;
  let player: PlayerController | null = null;
  let entities: EntityManager | null = null;
  let grass: GrassClutter | null = null;
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
  const craftingPanel = new CraftingPanel(() => inventory, (t) => hud.meldung(t));
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
    grass?.setHdClutter(s.hdClutter);
    post?.apply(s);
    shadows?.setLevel(s.shadowQuality);
    shadows?.setDistantShadows(s.distantShadows);
    // Renderauflösung: setHardwareScalingLevel(1/faktor) — Wert > 1 rendert
    // KLEINER als das Fenster und skaliert beim Ausgeben hoch. Der Effekt
    // ist quadratisch (75 % Kantenlänge = 44 % weniger Pixel) und damit der
    // stärkste Einzelhebel, den wir dem Nutzer geben können.
    engine.setHardwareScalingLevel(1 / (RENDER_SCALE[s.renderScale] ?? 1));
    input.setUseLock(s.pointerLock);
    objectLabels?.setEnabled(s.showObjectNames);
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
  const miss = <T>(feld: string, fn: () => T): T => {
    const t0 = performance.now();
    const r = fn();
    const dt = performance.now() - t0;
    const e = zeitmess[feld]!;
    e.summe += dt; e.n++;
    if (dt > e.max) e.max = dt;
    return r;
  };

  /** Builds all world-dependent systems and starts the game loop (once). */
  function buildWorld(seed: string, settings?: ClientWorldSettings, layout?: unknown): void {
    worldLayout = layout ?? null;
    world = createWorld(seed, settings, layout);
    console.log('[world] GeoManager ready, ground(0,0) =', world.getGroundHeight(0, 0));

    // Das Terrain-Material braucht das Sonnenlicht, um Schatten zu
    // empfangen (LightBlock in TerrainSplat) — Lighting existiert bereits.
    terrain = new TerrainManager(scene, world, lighting.sun);
    player = new PlayerController(scene, input, world, assets);
    entities = new EntityManager(scene, world, assets, terrain);
    grass = new GrassClutter(scene, world);
    // Niederschlag (EnvSetup.m_psystems im Original) — folgt dem Spieler
    // und wird vom Wind schräg gestellt, s. Precipitation.ts.
    precipitation = new Precipitation(scene);
    // Namensschilder über den Objekten (Einstellung "Objektnamen anzeigen").
    objectLabels = new ObjectLabels(scene, player.camera, () => entities);
    objectLabels.setEnabled(gameSettings.get().showObjectNames);
    // Was unter dem Fadenkreuz steht — färbt es gelb (s. Anvisiert.ts).
    anvisiert = new Anvisiert(scene, player.camera, () => entities);

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
      profil: () => {
        const p: Record<string, unknown> = { ...zeitmess };
        // Zeichenaufrufe und aktive Meshes: Der Verdacht war, dass wir
        // draw-call-limitiert sind (Logik kostet nur 1,15 ms, Auflösung
        // wirkt nicht). Diese beiden Zahlen entscheiden das.
        p['zeichenaufrufe'] = (engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? -1;
        p['aktiveMeshes'] = scene.getActiveMeshes().length;
        p['gesamtMeshes'] = scene.meshes.length;
        // Aufschlüsselung nach Namenspräfix — zeigt, welches Teilsystem
        // die Zeichenaufrufe stellt.
        const nachTyp: Record<string, number> = {};
        for (const m of scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length)) {
          const n = m?.name ?? '?';
          const typ = n.startsWith('clutter') ? 'gras'
            : n.startsWith('zone') || n.startsWith('terrain') || n.startsWith('water') ? 'terrain'
              : n.startsWith('inst_') || n.startsWith('master') ? 'entities'
                : 'sonstige';
          nachTyp[typ] = (nachTyp[typ] ?? 0) + 1;
        }
        p['aktivNachTyp'] = nachTyp;
        p['materialien'] = scene.materials.length;
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
      nearbyInstances: (r = 40) =>
        entities && player ? entities.nearbyInstances(player.position.x, player.position.z, r) : [],
      colliderSpecs: () => (entities ? Object.fromEntries(entities.colliderSpecs) : null),
      precipInfo: () => precipitation?.info ?? null,
      precipSystem: () => precipitation?.systemRef ?? null,
      windState: () => (weather ? { dir: weather.windDir, staerke: weather.windIntensity, amp: WindPlugin.strength } : null),
    };

    // Post-Process-Stack des Originals (Bloom/MotionBlur/ChromaticAberration/
    // Tonemapping) — hängt an der Spielerkamera, existiert also erst hier.
    // Schatten hängen am Sonnenlicht und müssen deshalb nach Lighting
    // entstehen; die Meshes melden sich selbst an (onNewMeshAddedObservable).
    shadows = new Shadows(scene, lighting.sun);
    shadows.setLevel(gameSettings.get().shadowQuality);
    shadows.setDistantShadows(gameSettings.get().distantShadows);

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
    inventory.addItem(findItem('Hammer')!, 1);
    // Feuersteinaxt: die erste Axt der Fortschrittskette und mit
    // `toolTier: 1` die niedrigste Stufe, die Bäume fällt. Steht seit
    // jeher vollständig in itemDefs.ts, lag nur nicht im Startinventar.
    inventory.addItem(findItem('AxeFlint')!, 1);
    inventory.addItem(findItem('Hoe')!, 1);
    inventory.addItem(findItem('PickaxeAntler')!, 1);
    inventory.addItem(findItem('Cultivator')!, 1);
    inventory.addItem(findItem('Wood')!, 12);
    inventory.addItem(findItem('Stone')!, 30);
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
    grass.setHdClutter(gameSettings.get().hdClutter);
    post.apply(gameSettings.get());

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
    socket = new GameSocket(url, name);

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
      const sync = parseZDOSync(reader, socket.ownUserId);
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
    });

    // Terraforming vom Server: eigene Ops (Echo), Mitspieler-Ops und das
    // Replay aller bisherigen Grabungen beim Verbinden.
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
      if (message.startsWith('Tür')) audio.play('tuer', 0.8);
      else if (message.startsWith('Aufgesammelt') || message.startsWith('Gefunden')) audio.play('pickup', 0.7);
      if (itemName && amount > 0 && inventory) {
        const def = findItem(itemName);
        if (def) {
          inventory.addItem(def, amount);
        }
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
    };
    socket.onDisconnected = (reason) => {
      netStatus = `getrennt${reason ? `: ${reason}` : ''}`;
      connectScreen.style.display = 'flex';
      connectStatus.textContent = reason ? `Getrennt: ${reason}` : 'Verbindung zum Server verloren';
      connectBtn.removeAttribute('disabled');
    };
    socket.connect();
    netStatus = 'verbinde…';
  }

  connectBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Viking';
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
      const zeige = (p: { prefab: string; x: number; z: number; yaw?: number; scale?: number }, i: number): void => {
        if (!findPrefabByName(p.prefab) || !world) return;
        const yaw = p.yaw ?? 0;
        ent.applyUpdate({
          key: `edplace-${i}`,
          prefabHash: getStableHash(p.prefab),
          position: { x: p.x, y: world.getGroundHeight(p.x, p.z), z: p.z },
          rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
          isOwn: false,
        } as never);
      };
      const entwurf = testflug as { placements?: Array<{ prefab: string; x: number; z: number; yaw?: number }> };
      (entwurf.placements ?? []).forEach(zeige);
      ent.flush();

      const panel = new SpawnPanel({
        anzahl: () => {
          const roh = JSON.parse(localStorage.getItem('wov-editor-layout') ?? '{}') as {
            placements?: unknown[];
          };
          return roh.placements?.length ?? 0;
        },
        platzieren: () => platziere(),
        entferneLetztes: () => {
          const roh = JSON.parse(localStorage.getItem('wov-editor-layout') ?? 'null') as {
            placements?: Array<{ prefab: string; x: number; z: number }>;
          } | null;
          if (!roh?.placements?.length) return;
          const i = roh.placements.length - 1;
          roh.placements = roh.placements.slice(0, -1);
          localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
          ent.removeZDO(`edplace-${i}`);
          ent.flush();
          hud.meldung('Letzte Platzierung entfernt');
        },
      });
      const platziere = (): void => {
        if (!player || !world) return;
        const e = panel.einstellung;
        const wx = Math.round(player.position.x - Math.sin(player.yaw) * e.abstand);
        const wz = Math.round(player.position.z - Math.cos(player.yaw) * e.abstand);
        const roh = JSON.parse(localStorage.getItem('wov-editor-layout') ?? 'null') as {
          placements?: Array<{ prefab: string; x: number; z: number; yaw?: number; scale?: number }>;
        } | null;
        if (!roh) return;
        const eintrag = {
          prefab: e.prefab,
          x: wx,
          z: wz,
          yaw: e.yaw ?? Math.random() * Math.PI * 2,
          ...(Math.abs(e.scale - 1) > 1e-3 ? { scale: e.scale } : {}),
        };
        roh.placements = [...(roh.placements ?? []), eintrag];
        localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
        zeige(eintrag, roh.placements.length - 1);
        ent.flush();
        panel.aktualisiere();
        hud.meldung(`${e.prefab} platziert @ (${wx}, ${wz})`);
      };
      spawnEditorOffen = () => panel.istOffen;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyB') {
          const offen = panel.toggle();
          if (offen) {
            // Maus freigeben, damit Liste/Regler anklickbar sind — das
            // Wieder-Einfangen übernimmt der Game-Loop (cursorNoetig).
            document.exitPointerLock();
          }
          hud.meldung(offen ? 'Spawn-Editor offen — P platziert, B schließt' : 'Spawn-Editor zu');
        }
        if (e.code === 'KeyP' && panel.istOffen) platziere();
      });
      window.addEventListener('mousedown', (e) => {
        // Bei gefangener Maus platziert der Klick vor dem Spieler.
        if (panel.istOffen && e.button === 0 && document.pointerLockElement) platziere();
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
      const leseEntwurf = (): { placements: Array<{ prefab: string; x: number; z: number; yaw?: number; scale?: number }> } | null => {
        const roh = JSON.parse(localStorage.getItem('wov-editor-layout') ?? 'null');
        if (!roh) return null;
        roh.placements = roh.placements ?? [];
        return roh;
      };
      let ziehIndex = -1;
      canvas.addEventListener('pointerdown', (e) => {
        if (!panel.istOffen || e.button !== 0 || document.pointerLockElement) return;
        const p = bodenPunkt(e.offsetX, e.offsetY);
        const roh = leseEntwurf();
        if (!p || !roh) return;
        // Nächste Platzierung im Griffradius? Dann greifen statt setzen.
        let best = -1;
        let bestD = 3;
        roh.placements.forEach((q, i) => {
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (best >= 0) {
          ziehIndex = best;
          hud.meldung(`${roh.placements[best]!.prefab} gegriffen — ziehen, loslassen setzt ab`);
        } else {
          const einst = panel.einstellung;
          const eintrag = {
            prefab: einst.prefab,
            x: Math.round(p.x * 10) / 10,
            z: Math.round(p.z * 10) / 10,
            yaw: einst.yaw ?? Math.random() * Math.PI * 2,
            ...(Math.abs(einst.scale - 1) > 1e-3 ? { scale: einst.scale } : {}),
          };
          roh.placements.push(eintrag);
          localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
          zeige(eintrag, roh.placements.length - 1);
          ent.flush();
          panel.aktualisiere();
          hud.meldung(`${einst.prefab} platziert @ (${eintrag.x}, ${eintrag.z})`);
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (ziehIndex < 0) return;
        const p = bodenPunkt(e.offsetX, e.offsetY);
        const roh = leseEntwurf();
        if (!p || !roh || !roh.placements[ziehIndex]) return;
        const q = roh.placements[ziehIndex]!;
        q.x = Math.round(p.x * 10) / 10;
        q.z = Math.round(p.z * 10) / 10;
        localStorage.setItem('wov-editor-layout', JSON.stringify(roh));
        zeige(q, ziehIndex); // gleicher Key ⇒ Matrix-Update, kein Duplikat
        ent.flush();
      });
      window.addEventListener('pointerup', () => {
        if (ziehIndex < 0) return;
        const roh = leseEntwurf();
        const q = roh?.placements[ziehIndex];
        if (q) hud.meldung(`${q.prefab} abgesetzt @ (${q.x}, ${q.z})`);
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
    spawnEditorOffen();
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
  for (let i = 0; i < 8; i++) {
    input.onMenuKey(`Digit${i + 1}`, () => {
      if (placement?.menuOpen) {
        const piece = placement.pieces[i];
        if (piece) pieceSelection?.pick(piece.name);
      } else {
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
    if (e.code === 'F9') {
      e.preventDefault();
      void import('@babylonjs/inspector').then(() => {
        if (scene.debugLayer.isVisible()) scene.debugLayer.hide();
        else void scene.debugLayer.show({ embedMode: true });
      });
    }
  });

  scene.onBeforeRenderObservable.add(() => {
    if (!world || !terrain || !player || !entities || !grass) return; // waiting for buildWorld()
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
    audio.update(
      dt,
      wind1.intensity,
      player.moveIntent.x !== 0 || player.moveIntent.z !== 0,
      player.moveIntent.running,
      imDungeon
    );
    // Biom-Musik: leise Untermalung je Biom, in der Instanz der Krypta-Track.
    audio.musikSetzen(
      imDungeon
        ? 'musik_crypt'
        : ({ 1: 'musik_meadows', 8: 'musik_blackforest', 2: 'musik_swamp', 4: 'musik_mountain' } as Record<number, string>)[biome] ?? null
    );
    // Minimap: Detailausschnitt + Windzeiger (budgetiert, zeichnet selbst).
    minimap?.update(player.position.x, player.position.z, player.yaw, {
      dirX: wind1.dirX,
      dirZ: wind1.dirZ,
      intensity: wind1.intensity,
    });
    // Regen/Schnee/Asche: Menge aus der Nässe-Rampe, Schräglage aus dem
    // Wind (GlobalWind.velocityOverLifetime im Original).
    // Gras um aufsammelbare Gegenstände freihalten (Flint, Stein, Löwenzahn
    // …) — sonst verschwinden sie im hohen Gras. Nicht jeden Frame: die
    // Liste ändert sich nur, wenn neue ZDOs hereinkommen.
    clearingTimer += dt;
    if (clearingTimer >= 1.0) {
      clearingTimer = 0;
      const pickables = entities
        .nearbyInstances(player.position.x, player.position.z, 70)
        .filter((i) => i.prefab.startsWith('Pickable'));
      grass.setClearings(pickables);
    }

    objectLabels?.update(player.position.x, player.position.z);
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
      lighting.fogColorLinear
    );
    WindPlugin.time += dt;
    // G-VEG: grass clutter follows the player, wind time advances.
    // Im Dungeon eingefroren — an x≈100000 gibt es keine Vegetation.
    if (!imDungeon) {
      grass.setPlayerPosition(player.position.x, player.position.z);
      miss('gras', () => grass!.update(dt, scene.fogDensity));
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
        inventory.removeByName(kandidat[0], 1);
        socket.sendEat(kandidat[0]);
        audio.play('pickup', 0.5);
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
      audio.play('schwung', 0.6);
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
      if (ziel && zielDef && (zielDef.flags & PrefabFlag.FIREPLACE) !== 0n && (inventory?.countOf('RawMeat') ?? 0) > 0) {
        // Feuerstelle brät: rein clientseitig (Inventar lebt im Client).
        inventory!.removeByName('RawMeat', 1);
        inventory!.addItem(findItem('CookedMeat')!, 1);
        hud.meldung('Fleisch gebraten');
        audio.play('pickup', 0.6);
      } else if (ziel && ziel.prefab === 'StatueDeer') {
        // Eikthyr verlangt eine Opfergabe: 2 Hirschtrophäen.
        if ((inventory?.countOf('TrophyDeer') ?? 0) >= 2) {
          inventory!.removeByName('TrophyDeer', 2);
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
    // Werferliste der Schatten der Spielerposition nachführen.
    shadows?.setPlayerPosition(player.position.x, player.position.z);
    miss('entities', () => {
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
        `pos ${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}  h ${player.position.y.toFixed(1)}${swimming ? ' (Wasser)' : ''}\n` +
        `chunks ${terrain.chunkCount} (+${terrain.queuedCount})  zdo s:${entities.staticCount} d:${entities.dynamicCount}\n` +
        `zeit ${(lighting.timeOfDay * 24).toFixed(1)}h  assets-fehler ${assets.failed.size}\n` +
        `env ${lighting.environmentName}${envPinned ? ' (pinned)' : ''}  ` +
        `${lighting.state.isNight ? 'nacht' : 'tag'}  ` +
        `nebel ${lighting.state.fogDensity.toFixed(4)}  sonne ${lighting.state.lightIntensity.toFixed(2)}  ` +
        `dof ${post?.debugLine ?? '-'}\n` +
        `schatten ${shadows?.info ?? '-'}\n` +
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
  });

  engine.runRenderLoop(() => {
    if (!scene.activeCamera) return; // no PlayerController/camera until buildWorld() runs
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());

  // dev/debug handle (Playwright probes, F9 inspector sessions)
  (window as unknown as Record<string, unknown>).__dbg = { scene, input, get entities() { return entities; }, assets, get terrain() { return terrain; }, lighting, get player() { return player; }, get world() { return world; }, get inventory() { return inventory; }, get equipment() { return equipment; }, get placement() { return placement; }, get grass() { return grass; }, get shadows() { return shadows; } };
}

void main();
