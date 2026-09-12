/**
 * World of Vikings Client — Entry Point (Phase 2 / M0.1).
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
 * only be chosen for the OFFLINE (no server) URL mode,
 * since a live multiplayer world's seed is fixed for good the moment the
 * server finishes booting (world generation completes before the server
 * even starts listening — see Docs/Migrationsplan-Differenzen-und-Aufgaben.md).
 * To play with a custom seed online, start a fresh server with
 * WORLD_SEED=<seed> (server/src/main.ts) instead.
 *
 * ?offline=1 builds a local world immediately
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
  TERRAIN_OP_DEFAULTS,
  Inventory,
  findItem,
  unpackContainer,
  WeatherManager,
  WORLD_TIME_LENGTH,
  FIGUR_VORGABE,
  istFigur,
  modellDateiZu,
  FRISUR_VORGABE,
  HAARFARBE_VORGABE,
  istFrisur,
  istHaarfarbe,
  istRuestung,
  frisurZu,
  bartAusFrisur,
  augenbraueAusFrisur,
  haarfarbeZu,
  ruestungZu,
  AUSSEHEN_ORDNER,
  istAusruestungsSlot,
  WETTER_AUTOMATISCH,
  FLAG_ASHLANDS_MODERN,
  FLAG_BILINEAR_HEIGHT,
  FLAG_BLEND_SMOOTHSTEP,
  FLAG_DISABLE_DISTANT_RIVERS,
  FLAG_LAYOUT_MODE,
  FLAG_RIVER_AFFECTS_OCEAN,
} from '@wov/shared';
import type { NpcDef, NpcEinordnung, SteinKitConfig, TerrainComp } from '@wov/shared';
import { createWorld, DEFAULT_OFFLINE_SEED, type ClientWorld, type ClientWorldSettings } from './world/World';
import { TerrainManager } from './engine/Terrain';
import { Lighting } from './engine/Lighting';
import { installiereStandardGammaFix } from './engine/StandardGammaFix';
import { installierePbrNebelFix } from './engine/PbrNebelFix';
import { installiereNebelRichtung } from './engine/NebelRichtung';
import { setzeLook } from './engine/lookProfil';
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
import { ladeModulRegistrierung } from './net/ModuleRegistryLoad';
import { Abgleicher } from './net/Positionsverlauf';
import { parseZDOSync, ZDOSpiegel } from './net/ZDOSync';
import { Hud } from './ui/Hud';
import { GrassClutter } from './engine/GrassClutter';
import { HuegelGras } from './engine/HuegelGras';
import { SettingsStore, VEGETATION_RANGE } from './ui/Settings';
import type { GameSettings } from './ui/Settings';
import { SettingsPanel } from './ui/SettingsPanel';
import { PostProcessing } from './engine/PostProcessing';
import { Shadows } from './engine/Shadows';
import { RENDER_SCALE } from './ui/Settings';
import { LoadingScreen } from './ui/LoadingScreen';
import { GameI18n } from './i18n';
import { Equipment } from './player/Equipment';
import { KampfEffekte } from './engine/KampfEffekte';
import { Hotbar } from './ui/Hotbar';
import { InventoryPanel } from './ui/InventoryPanel';
import { ContainerPanel } from './ui/ContainerPanel';
import { OffeneTruhe } from './entities/OffeneTruhe';
import { PlacementController } from './player/PlacementController';
import { PieceSelection } from './ui/PieceSelection';
import { ObjectLabels } from './ui/ObjectLabels';
import { Anvisiert } from './ui/Anvisiert';
import { Namensschilder } from './ui/Namensschild';
import { WorldMap } from './ui/WorldMap';
import { setzeKartenMasse } from './ui/worldmap/mapTypes';
import { SpawnPanel } from './editor/SpawnPanel';
import { baumenueHinweis } from './player/BaumenueHinweis';
import { RoutenEditor } from './editor/RoutenEditor';
import { RoutenVorschau } from './editor/RoutenVorschau';
import { BewuchsVorschau } from './editor/BewuchsVorschau';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DungeonEditor } from './ui/DungeonEditor';
import { DekoPlatzierung } from './ui/DekoPlatzierung';
import { FlammenAtlas } from './engine/FlammenAtlas';
import { Minimap } from './ui/Minimap';
import { DungeonMinimap } from './ui/DungeonMinimap';
import { LightPool } from './engine/LightPool';
import { Dungeon2Instanz, type Dungeon2Deskriptor } from './engine/Dungeon2Instanz';
import { DungeonGrafikStufe, setzeDungeonStufe } from './engine/DungeonMaterial';
import { CraftingPanel } from './ui/CraftingPanel';
import { CharakterPanel } from './ui/CharakterPanel';
import { ChatPanel } from './ui/ChatPanel';
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

/**
 * Dasselbe Muster, das der Betriebsdienst benutzt, bevor er aus einer
 * Dungeon-ID einen Dateinamen macht. Der Wert geht hier zwar nur in eine
 * Befehlszeile, aber ein Adressparameter ist Fremdeingabe, und die Zeile
 * wird serverseitig zerlegt.
 */
const DUNGEON_ID_MUSTER = /^[a-z0-9-]{1,64}$/;
/**
 * Hinterlegter Dungeon-Wunsch, der eine Anmeldung überdauert.
 *
 * ── Warum diese drei auf MODULEBENE stehen ──────────────────────────
 * Sie werden an zwei Stellen gebraucht, die in verschiedenen Funktionen
 * liegen: an der Anmeldeweiche (der Wunsch wird hinterlegt) und beim
 * Start der Welt (er wird eingelöst). Der erste Versuch legte sie neben
 * die zweite Stelle — der Typecheck schwieg, weil es eben zwei Funktionen
 * sind, und zur Laufzeit hätte die Anmeldeweiche einen ReferenceError
 * geworfen. Genau dieselbe Falle wie beim hochgezogenen `world` weiter
 * unten.
 */
const DUNGEON_WUNSCH_SCHLUESSEL = 'wov-dungeon-wunsch';
/**
 * Wie lange so ein Wunsch gilt. Großzügig genug für eine Anmeldung samt
 * Passwortsuche, kurz genug, dass er nicht in die nächste Sitzung
 * hineinreicht — sonst führe man Tage später beim normalen Spielen
 * unvermittelt in einen Dungeon, den man einmal im Editor angeklickt hat.
 */
const DUNGEON_WUNSCH_FRIST_MS = 10 * 60 * 1000;

/** Compass point for a bearing in degrees (0 = north) — HUD readability. */
function compass(deg: number): string {
  const points = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(deg / 45) % 8];
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
  // ── E6: die Modulregistry, BEVOR irgendetwas den Katalog kopiert ────
  //
  // Zur Laufzeit gebaute Säle (E5) stehen in `assets/generiert/
  // modul-registry.json` und in keinem Bündel. Ohne diesen Aufruf kennt
  // der Spielclient sie nicht: Ein Grab, das einen benutzt, zeigte an
  // seiner Stelle nichts — und ein Speichern aus dem Spiel heraus verlöre
  // ihn still. Hier ganz oben, weil `PrefabManager`-artige Leser die
  // Registry KOPIEREN statt sie zu befragen; eine Registrierung danach
  // ist eingetragen und trotzdem unsichtbar, ohne dass etwas fehlschlägt.
  //
  // Kein Ausgang, den der Aufrufer behandeln müsste: Eine fehlende Datei
  // ist der Normalfall und bedeutet „keine gebauten Säle".
  await ladeModulRegistrierung();

  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

  // ── Uebergabe von der Charaktererstellung ──────────────────────────
  // world-of-vikings.com tauscht die serverseitig gespeicherte Figur gegen
  // ein kurzlebiges Spielticket. In der Adresse steht nur noch dieses
  // Ticket; Name und Aussehen kommen aus der Konten- und Weltdatenbank.
  /**
   * Wurde diese Sitzung mit einem Spielticket eroeffnet?
   *
   * Dann gehoert der Charakter einem Konto, und Name wie Aussehen stehen
   * serverseitig fest. Der Client darf sie nach dem Verbinden NICHT
   * melden -- er wuerde den gespeicherten Stand mit lokalen Vorgabewerten
   * ueberschreiben.
   */
  let mitTicket = false;
  /** Lag ein Ticket in der Adresse? Dann ist die Anmeldung gewollt. */
  let ticketVorgelegt = false;

  /**
   * Liegt ein SessionToken im Speicher? Dann war der Besucher schon einmal
   * hier und kann ohne einen zweiten Anmeldeschritt zurueckkehren.
   *
   * Bis zum 24.08.2026 galt nur ein Ticket in der Adresse als Absicht. Wer
   * sich ueber world-of-vikings.com angemeldet hatte und play.* danach neu
   * lud oder spaeter wieder aufrief, sah wieder das alte Fenster -- mit
   * einem gueltigen Token im Speicher, das genau daneben lag. Genau der
   * Schritt, den die Charaktererstellung ersetzen sollte.
   *
   * Ist das Token abgelaufen, geht der Client zur Anmeldung auf der
   * Webseite zurueck. Einen zweiten Anmeldeweg im Spiel gibt es nicht mehr.
   */
  function tokenLiegtVor(): boolean {
    let roh: string;
    try {
      roh = localStorage.getItem('wov-session-token') ?? '';
    } catch {
      // Privater Modus: kein Speicher, also auch kein Token.
      return false;
    }
    if (!roh) return false;

    // Ablauf pruefen, BEVOR daraus eine Anmeldeabsicht wird.
    //
    // Die Signatur kann der Client nicht pruefen -- das Geheimnis liegt im
    // Server, und das ist richtig so. Das Ablaufdatum steht aber offen in
    // der Nutzlast, und das genuegt fuer die Frage, die hier ansteht.
    //
    // WARUM DAS NOETIG IST: Ein ungueltiges Token weist der Server nicht
    // ab, er vergibt eine NEUE Identitaet (F3, Sicherheitspruefung --
    // ausdruecklich kein stiller Rueckfall auf ein Client-Feld). Ohne
    // diese Pruefung landete jemand mit abgelaufenem Token wortlos als
    // frischer, namenloser Charakter in der Welt, waehrend sein eigener
    // weiter im Spielstand liegt. Er soll stattdessen das Fenster sehen
    // und sich neu anmelden koennen.
    //
    // Ein GEFAELSCHTES Token kommt hier durch; das faengt der Server.
    try {
      const teile = roh.split('.');
      if (teile.length !== 2 || !teile[0]) return false;
      const nutzlast = JSON.parse(atob(teile[0].replace(/-/g, '+').replace(/_/g, '/'))) as {
        e?: unknown;
      };
      return typeof nutzlast.e === 'number' && nutzlast.e > Date.now();
    } catch {
      // Unlesbar heisst unbrauchbar.
      return false;
    }
  }

  // ── Spielticket aus dem Adressfragment ────────────────────────────
  //
  // world-of-vikings.com tauscht einen gewaehlten Charakter gegen ein
  // SessionToken (POST /api/konto/charaktere/<id>/spielen) und haengt es
  // als #ticket= an die Adresse hierher. Von da an ist es das ganz normale
  // Token, das GameSocket ohnehin aus dem localStorage vorlegt -- der
  // Anmeldeweg im Server bleibt unveraendert.
  //
  // WARUM DAS FRAGMENT UND KEIN ?parameter: Ein Ticket ist ein
  // Zugangsnachweis. Ein Adressparameter wandert in den Browserverlauf,
  // in jedes Serverprotokoll und in die Referer-Kopfzeile jeder
  // Folgeanfrage. Das Fragment wird gar nicht erst an einen Server
  // geschickt.
  //
  // Und weil der Verlauf bleibt, wird es SOFORT wieder aus der Adresse
  // gestrichen (replaceState, nicht pushState -- der Eintrag soll ersetzt
  // und nicht um einen weiteren ergaenzt werden).
  {
    const roh = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const ticket = new URLSearchParams(roh).get('ticket');
    if (ticket) {
      mitTicket = true;
      ticketVorgelegt = true;
      try {
        localStorage.setItem('wov-session-token', ticket);
      } catch {
        // Privater Modus: dann eben nur fuer diese eine Verbindung. Das
        // Token liegt gleich ohnehin im Speicher des GameSocket.
      }
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  const ausAdresse = new URLSearchParams(window.location.search);
  const i18n = new GameI18n(ausAdresse.get('lang'));
  //
  // ── Englische PARAMETERNAMEN, deutsche WERTE ─────────────────────
  // Die Namen sind Drahtformat und heissen englisch; gesetzt werden
  // sie in wov-web/src/lib/account.ts (playUrl). Aendert sich einer
  // hier ohne dort, bricht die Uebergabe STILL: der Client sieht den
  // Parameter einfach nicht und faellt auf das Gemerkte zurueck.
  // Die WERTE bleiben, wie shared/aussehen.ts sie fuehrt --
  // 'wikingerin', 'H_01', 'leder_bh' stehen im Weltspeicher.
  const storedSessionPresent = tokenLiegtVor();
  if (storedSessionPresent) mitTicket = true;

  const vonSeite = {
    name: ausAdresse.get('name'),
    figure: ausAdresse.get('figure'),
    hairstyle: ausAdresse.get('hairstyle'),
    top: ausAdresse.get('top'),
    legs: ausAdresse.get('legs'),
    hairColor: ausAdresse.get('hairColor'),
    // Wunschstunde (0-23) — die Seite bietet sie nur fuer das Testgestade an.
    time: ausAdresse.get('time'),
  };

  const offlineMode = ausAdresse.has('offline');
  const accountSessionPresent = ticketVorgelegt || storedSessionPresent;
  const websiteLoginUrl = (expired = false): URL => {
    const loginPath = i18n.language === 'en' ? '/en/login' : '/de/anmelden';
    const url = new URL(loginPath, 'https://world-of-vikings.com');
    url.searchParams.set(
      'shore',
      window.location.hostname.includes('.dev.') ? 'dev' : 'live',
    );
    if (expired) url.searchParams.set('abgelaufen', '1');
    return url;
  };

  // Online play is account-only. The former anonymous `?go=1` route and
  // the in-game login/character picker were removed as one unit; the
  // built-in dialog a few lines down is not that picker's return — it
  // exists ONLY for a local clone with no website in front of it.
  if (!offlineMode && !accountSessionPresent) {
    // `?dungeon=` würde hier verloren gehen.
    //
    // Die Anmeldeadresse trägt kein Rückziel — sie kennt nur `shore` und
    // `abgelaufen`. Wer aus dem Karteneditor auf „Betreten" klickt und
    // hier noch keine Sitzung hat, landet nach dem Anmelden also in der
    // WELT statt im Dungeon, wortlos. Genau das ist am 28.08.2026
    // passiert.
    //
    // Hinterlegt statt an die Adresse gehängt: Nach dem Anmelden schickt
    // die Webseite auf genau diesen Ursprung zurück
    // (wov-web/src/lib/account.ts, `dev: play.dev.world-of-vikings.com`).
    // Der localStorage von eben ist dann derselbe — die Webseite muss
    // dafür nichts wissen und nichts weiterreichen.
    // Direkt aus der Adresse, nicht aus einer Variablen von weiter
    // unten: Diese Weiche liegt in einer ANDEREN Funktion als das
    // Einlösen, und ein Vorgriff wäre hier ein ReferenceError.
    const wunsch = ausAdresse.get('dungeon') ?? '';
    if (DUNGEON_ID_MUSTER.test(wunsch)) {
      try {
        localStorage.setItem(
          DUNGEON_WUNSCH_SCHLUESSEL,
          JSON.stringify({ id: wunsch, um: Date.now() })
        );
      } catch {
        // Privater Modus: kein Speicher. Dann geht der Wunsch verloren
        // wie bisher — das ist kein Grund, die Anmeldung zu verweigern.
      }
    }

    // ── Ein Ursprung: Webseite da, oder nicht? ─────────────────────────
    //
    // Teilen Webseite und Spiel denselben Ursprung (der Zweck dieses
    // Umbaus), entscheidet eine kurze Anfrage auf die Anmeldeseite der
    // Webseite. Eine richtige Installation da -- sie bleibt der EINE
    // Anmeldeweg, und die Weiterleitung ist RELATIV: kein fremder
    // Ursprung mehr in der Adresse, kein #ticket= ueber eine
    // Domaingrenze, `?weiter=` bringt den Besucher nach dem Anmelden
    // zurueck ins Spiel statt auf eine Startseite.
    //
    // WARUM NICHT NUR DER STATUSCODE: Sowohl Vites Dev-Server als auch
    // `vite preview` (Testgestade, s. wov-staging-nicht-mit-vite-dev)
    // beantworten JEDEN unbekannten Pfad standardmaessig mit 200 und der
    // EIGENEN index.html (History-API-Fallback fuer Ein-Seiten-Apps) --
    // genau der Fall "lokaler Klon ohne Webseite", den diese Weiche
    // erkennen soll. Ein blosses `probe.ok` waere hier IMMER wahr und
    // schickte den frischen Klon in eine Weiterleitungsschleife auf sich
    // selbst. Der Koerper verraet den Unterschied zuverlaessig: Nur die
    // eigene Spiel-Huelle (client/index.html) traegt
    // `id="renderCanvas"` -- eine echte, andersartige Webseiten-Seite
    // (vorgerendert oder per nginx ausgeliefert) tut das nie.
    //
    // Antwortet der Pfad gar nicht mit 200, oder ist die Anfrage
    // fehlgeschlagen (Netzfehler), zeigt der Client seinen eigenen,
    // eingebauten Anmeldedialog (ui/Anmeldung.ts). Das ist die einzige
    // Stelle, an der ein lokaler Klon ohne die Webseite an ein
    // SessionToken kommt -- ?offline und der Testtoken-Zweig bleiben
    // daneben unveraendert bestehen.
    const anmeldePfad = i18n.language === 'en' ? '/en/login' : '/de/anmelden';
    let websiteDa = false;
    try {
      const probe = await fetch(anmeldePfad, { method: 'GET', cache: 'no-store' });
      websiteDa = probe.ok && !(await probe.text()).includes('id="renderCanvas"');
    } catch {
      websiteDa = false;
    }

    if (websiteDa) {
      const ziel = new URL(anmeldePfad, window.location.origin);
      ziel.searchParams.set('weiter', '/play/');
      window.location.assign(ziel.pathname + ziel.search);
      return;
    }

    const { Anmeldung } = await import('./ui/Anmeldung');
    await new Anmeldung(i18n).anzeigen();
    // Der Dialog loest erst auf, wenn ein SessionToken im localStorage
    // liegt (siehe dort) -- ab hier gilt derselbe Vertrag wie beim Ticket
    // aus der Adresse: ein Konto-Charakter, Name und Aussehen stehen fest.
    mitTicket = true;
    ticketVorgelegt = true;
  }

  const stored = (key: string): string => {
    try { return localStorage.getItem(key) ?? ''; }
    catch { return ''; }
  };
  const storedArmour = (() => {
    try { return JSON.parse(stored('wov-ruestung') || '{}') as Record<string, string>; }
    catch { return {}; }
  })();
  const armourFor = (value: string | null, slot: 'oberkoerper' | 'beine'): string => {
    const candidate = value ?? storedArmour[slot] ?? '';
    const part = ruestungZu(candidate);
    return !candidate || (istRuestung(candidate) && part?.slot === slot) ? candidate : '';
  };

  // The website is the only character picker. These values remain solely
  // for offline probes and for the pre-account URL contract; ticket-backed
  // characters are authoritative on the server and are never overwritten.
  const storedFigure = stored('wov-figur');
  const storedHairstyle = stored('wov-frisur');
  const storedHairColor = stored('wov-haarfarbe');
  const selectedFigure = vonSeite.figure && istFigur(vonSeite.figure)
    ? vonSeite.figure
    : istFigur(storedFigure) ? storedFigure : FIGUR_VORGABE;
  const selectedHairstyle = vonSeite.hairstyle && istFrisur(vonSeite.hairstyle)
    ? vonSeite.hairstyle
    : istFrisur(storedHairstyle) ? storedHairstyle : FRISUR_VORGABE;
  const selectedHairColor = vonSeite.hairColor && istHaarfarbe(vonSeite.hairColor)
    ? vonSeite.hairColor
    : istHaarfarbe(storedHairColor) ? storedHairColor : HAARFARBE_VORGABE;
  const selectedTop = armourFor(vonSeite.top, 'oberkoerper');
  const selectedLegs = armourFor(vonSeite.legs, 'beine');
  const playerName = vonSeite.name?.slice(0, 24) || 'Viking';
  const requestedHour = (() => {
    if (vonSeite.time === null) return null;
    const hour = Number(vonSeite.time);
    return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null;
  })();

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
  const hud = new Hud(i18n);

  // F16 (Roadmap): EINE Sammelstelle für Fehler, die sonst spurlos in der
  // Konsole verschwinden. Anlass: In der Nacht auf den 20.08.2026 lief der
  // Anmelde-Handshake (GameSocket.ts) in einem `void (async () => {…})()`
  // ohne `catch` — jede Anmeldung schlug still fehl, nur ein Server-seitiger
  // Zehn-Sekunden-Timeout deutete überhaupt auf einen Fehler hin. Diese
  // beiden Ereignisse sind das Sicherheitsnetz für GENAU diesen Fall: jede
  // unbehandelte Ausnahme bzw. abgelehnte Promise, egal wo im Client sie
  // auftritt, landet jetzt sichtbar im HUD statt nur in der Konsole.
  // `addEventListener` statt `window.onerror =` / `window.onunhandledrejection =`,
  // damit ein künftiger zweiter Listener sich nicht gegenseitig überschreibt.
  window.addEventListener('error', (ev) => {
    console.error('[global] Unerwarteter Fehler:', ev.error ?? ev.message);
    hud.meldeFehler('Unerwarteter Fehler — Einzelheiten in der Browser-Konsole (F12)', 'schwer');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    console.error('[global] Unbehandelte Promise-Ablehnung:', ev.reason);
    hud.meldeFehler('Unerwarteter Fehler — Einzelheiten in der Browser-Konsole (F12)', 'schwer');
  });

  // Without the pointer lock the mouse buttons do nothing and the camera can't
  // be turned — the game looks broken while it is only waiting for a click on
  // the canvas. Clicking a hotbar slot or the connect button never grabs it, so
  // say so instead of leaving the player guessing.
  /**
   * Die Welt. Sie steht hier und nicht bei den uebrigen welt-abhaengigen
   * Feldern weiter unten, weil `updateLockHint` sie liest — und
   * `i18n.onChange` ruft seinen Zuhoerer SOFORT einmal auf (i18n/index.ts,
   * `onChange`). Stand die Deklaration unten, warf dieser erste Aufruf
   * `can't access lexical declaration 'world' before initialization` und
   * riss den ganzen Start mit: kein Zeiger, keine Kamera, nur ein Bild.
   * TypeScript sieht das nicht — die zeitliche Tote Zone ist eine
   * Laufzeitregel.
   */
  let world: ClientWorld | null = null;

  const lockHint = document.createElement('div');
  // The browser refuses the lock in cases we cannot control (right after an
  // Escape unlock, for one). Drag-look keeps the game playable there.
  lockHint.textContent = i18n.t('pointer.click');
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
    // Only once a world exists — during startup it would be noise.
    // Deliberately playing without the lock needs no hint at all: the drag
    // controls are the normal ones then, not a fallback.
    const show = world !== null && document.pointerLockElement !== canvas && !input.playingUnlocked;
    const state = show ? (input.lockDenied ? 'denied' : 'click') : '';
    if (state === lockHintState) return;
    lockHintState = state;
    lockHint.style.display = show ? 'block' : 'none';
    if (show) lockHint.textContent = i18n.t(state === 'denied' ? 'pointer.denied' : 'pointer.click');
  };
  document.addEventListener('pointerlockchange', updateLockHint);
  i18n.onChange(() => {
    lockHintState = '';
    updateLockHint();
  });

  const params = new URLSearchParams(location.search);

  /**
   * `?shafts=off` — Diagnoseschalter für die Strahlenmessung (A1).
   *
   * Erzwingt die Sonnenstrahlen aus, OHNE den gespeicherten Stand
   * anzufassen: Genau das braucht die Messung „an gegen aus", die bei
   * geschlossenem Tor bitgleich sein muss — sonst müsste sie zwischen
   * zwei Bildern die Einstellungen umschreiben und hätte danach einen
   * anderen Spielstand als davor.
   *
   * Muster: `params.has('flat')` in engine/Terrain.ts.
   */
  const strahlenAus = params.get('shafts') === 'off';
  /** Spielerwahl plus die Diagnoseschalter aus der Adresse. */
  const postOptionen = (s: GameSettings): GameSettings =>
    strahlenAus ? { ...s, sunShafts: false } : s;

  // World-dependent systems — only exist once the world (seed) is known.
  // `world` selbst steht weiter oben, beim Zeiger-Hinweis — Begruendung dort.
  /** Spawn-Editor des Testflugs offen? (gibt die Maus frei, s. cursorNoetig) */
  let spawnEditorOffen: () => boolean = () => false;
  /** Routen-Editor des Testflugs offen? (dito — Liste/Regler brauchen den Zeiger) */
  let routenEditorOffen: () => boolean = () => false;
  /** Auto-Reconnect-Zähler (Review-Punkt 9) — Reset bei erfolgreicher Verbindung. */
  let reconnectVersuch = 0;
  /**
   * `?dungeon=<id>`: nach dem Anmelden EINMAL in diese Instanz springen.
   *
   * Der Knopf „Betreten" im Karteneditor setzt ihn. Geprüft wird hier mit
   * demselben Muster, das der Betriebsdienst benutzt, bevor er aus einer
   * ID einen Dateinamen macht — der Wert geht zwar nur in eine
   * Befehlszeile, aber ein Adressparameter ist Fremdeingabe, und die
   * Zeile wird serverseitig zerlegt.
   *
   * NUR online: Eine Instanz lebt auf dem Server. Im Testflug (`?offline=1`)
   * gäbe es nichts zu betreten, und ein Befehl ins Leere sähe aus wie ein
   * kaputter Knopf.
   */
  const dungeonWunsch = (() => {
    const ausAdresse = params.get('dungeon') ?? '';
    if (DUNGEON_ID_MUSTER.test(ausAdresse)) return ausAdresse;

    // Kein Parameter — liegt einer von vor der Anmeldung bereit?
    //
    // VERBRAUCHT beim Lesen, und mit Verfallsdatum. Ohne beides führe
    // man Tage später beim normalen Spielen unvermittelt in einen
    // Dungeon, den man einmal im Editor angeklickt hat.
    let roh = '';
    try {
      roh = localStorage.getItem(DUNGEON_WUNSCH_SCHLUESSEL) ?? '';
      if (roh) localStorage.removeItem(DUNGEON_WUNSCH_SCHLUESSEL);
    } catch {
      return null;
    }
    if (!roh) return null;
    try {
      const w = JSON.parse(roh) as { id?: unknown; um?: unknown };
      const frisch = typeof w.um === 'number' && Date.now() - w.um < DUNGEON_WUNSCH_FRIST_MS;
      return typeof w.id === 'string' && DUNGEON_ID_MUSTER.test(w.id) && frisch ? w.id : null;
    } catch {
      return null;
    }
  })();
  /**
   * Schon gesprungen?
   *
   * Der Auto-Reconnect baut die Verbindung neu auf, und ohne diese Marke
   * risse er einen aus dem Dungeon wieder in denselben zurück — auch dann,
   * wenn man ihn inzwischen absichtlich verlassen hat.
   */
  let dungeonSprungGetan = false;
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
  /** Slash, Trefferblitz, Blut, Paradefunke (KampfEffekte.ts). */
  const kampfEffekte = new KampfEffekte(scene);
  let hotbar: Hotbar | null = null;
  let inventoryPanel: InventoryPanel | null = null;
  let containerPanel: ContainerPanel | null = null;
  /** Deckel-Animation der geoeffneten Truhe, s. entities/OffeneTruhe.ts. */
  let offeneTruhe: OffeneTruhe | null = null;
  let placement: PlacementController | null = null;
  let pieceSelection: PieceSelection | null = null;
  let worldMap: WorldMap | null = null;
  let minimap: Minimap | null = null;
  // Dungeon-Minimap (M2): nur in einer 2.0-Instanz sichtbar, deckt sich beim
  // Erkunden auf. / Dungeon minimap: visible only inside a 2.0 instance.
  let dungeonMinimap: DungeonMinimap | null = null;
  let lightPool: LightPool | null = null;
  const craftingPanel = new CraftingPanel(
    () => inventory,
    (t) => hud.meldung(t),
    (ergebnis) => {
      if (!socket?.connected) return false;
      socket.sendCraft(ergebnis);
      return true;
    },
    i18n
  );
  /**
   * Was die Figur tragen soll — aus Frisur der Charaktererstellung und
   * ANGELEGTER Ausruestung zusammengesetzt. Seit Kleidung aus Gegenstaenden
   * besteht, ist die Auswahl auf der Webseite nur der Startzustand; im Spiel
   * ist die Ausruestung die Wahrheit ueber das, was jemand traegt.
   *
   * Rueckgabe: Aussehen-Slot → BLOSSER Dateiname (ohne Ordner/Endung),
   * so wie AvatarRig und CharakterVorschau ihn erwarten.
   */
  const aussehenTeile = (): Record<string, string | null> => {
    const teile: Record<string, string | null> = {
      // Die alten Frisuren sind für den Wikingerin-Kopf gebunden. Auf dem
      // neuen Wikinger liegt der Zopf sichtbar hinter dem Schädel.
      frisur: selectedFigure === 'wikingerin' ? frisurZu(selectedHairstyle).datei : null,
      bart: bartAusFrisur(selectedHairstyle)?.datei ?? null,
      augenbraue: augenbraueAusFrisur(selectedHairstyle)?.datei ?? null,
      oberkoerper: null,
      beine: null,
    };
    const getragen = equipment?.aussehen() ?? {};
    for (const [slot, kennung] of Object.entries(getragen)) {
      teile[slot] = ruestungZu(kennung)?.datei ?? null;
    }
    return teile;
  };

  /**
   * Dieselben Teile MIT Ordner — die Form, die `AvatarRig` braucht.
   *
   * Zwei Formen sind kein Versehen: `AvatarRig.ladeTeil` baut
   * `/assets/models/<datei>.glb` und braucht den Ordner darin;
   * `CharakterVorschau.setze` schickt seinen Namen durch `teilPfad()`,
   * das den Ordner selbst davorsetzt. Eine gemeinsame Form haette an
   * einer der beiden Stellen `wikingerin/wikingerin/…` ergeben.
   */
  const aussehenFuerRig = (): Record<string, string | null> => {
    const teile = aussehenTeile();
    const mitOrdner: Record<string, string | null> = {};
    for (const [slot, datei] of Object.entries(teile)) {
      mitOrdner[slot] = datei ? `${AUSSEHEN_ORDNER}/${datei}` : null;
    }
    return mitOrdner;
  };

  /** Kennungen statt Dateinamen — genau das, was SetAussehen erwartet. */
  const aussehenKennungen = (): {
    frisur: string; ober: string; beine: string; haarfarbe: string;
  } => {
    const g = equipment?.aussehen() ?? {};
    return {
      frisur: selectedHairstyle,
      ober: g.oberkoerper ?? '',
      beine: g.beine ?? '',
      haarfarbe: selectedHairColor,
    };
  };

  const charakterPanel = new CharakterPanel(
    () => equipment,
    aussehenTeile,
    i18n,
    modellDateiZu(selectedFigure)
  );

  /**
   * Beide Fenster nebeneinander, sobald beide offen sind.
   *
   * WARUM NICHT EINS DAS ANDERE SCHLIESST (wie bisher): Gegenstaende
   * sollen sich aus dem Inventar auf die Slots ziehen lassen. Dafuer
   * muessen beide gleichzeitig sichtbar UND anklickbar sein.
   */
  const ordneFenster = (): void => {
    const beide = charakterPanel.isVisible && inventoryPanel?.isVisible === true;
    charakterPanel.setzePlatz(beide ? 'links' : 'mitte');
    inventoryPanel?.setzePlatz(beide ? 'rechts' : 'mitte');
  };

  /**
   * Aussehen an die eigene Figur legen UND melden.
   *
   * Beides zusammen, nie einzeln: Wer nur die eigene Figur anzieht, sieht
   * sich richtig und alle anderen sehen den alten Stand — der Fehler,
   * der bei F17 den halben Auftrag gekostet haette.
   */
  const uebernehmeAussehen = (): void => {
    void player?.avatar.setzeAussehen(aussehenFuerRig());
    const k = aussehenKennungen();
    player?.avatar.setzeHaarfarbe(haarfarbeZu(k.haarfarbe).hex);
    socket?.sendAussehen(k.frisur, k.ober, k.beine, k.haarfarbe);
    charakterPanel.zeichne();
  };

  // F14: Chat-Eingabe + Verlauf. `wiederFangen` verweist auf `cursorNoetig`
  // und `input`, die beide erst weiter unten in dieser Funktion entstehen
  // — als Closure unproblematisch, weil der Callback selbst erst durch
  // einen Tastendruck während des laufenden Spiels aufgerufen wird, lange
  // nach der Initialisierung.
  const chatPanel = new ChatPanel(
    (text, chatType) => socket?.sendChat(text, chatType),
    () => {
      if (!cursorNoetig()) input.captureFromGesture();
    },
    i18n
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
  /**
   * Die laufende 2.0-Instanz (AP13) — `null` in der Oberwelt UND in einer
   * Instanz des Altbestands. Der Altbestand bekommt seine Architektur weiter
   * als ZDOs zugestellt; nur 2.0 baut der Client selbst aus dem Deskriptor,
   * den das Teleportpaket trägt.
   * The live 2.0 instance — `null` in the overworld AND in a legacy instance.
   */
  let dungeon2Instanz: Dungeon2Instanz | null = null;
  /**
   * Läuft gerade ein `Dungeon2Instanz.betrete()`?
   *
   * Das Betreten ist asynchron (Texturen laden, Blöcke bauen), und ein
   * zweites Teleportpaket darf in dieser Zeit nicht ein zweites Grab in
   * dieselbe Szene bauen. Eine Zählmarke statt eines Abbruchs: Der laufende
   * Bau wird beim Eintreffen verworfen, wenn seine Marke nicht mehr die
   * aktuelle ist.
   * Is a `betrete()` in flight? A generation counter, not a cancel.
   */
  let dungeon2Marke = 0;
  /** Schlag-Sperre (s) — verhindert Dauerfeuer beim Klicken. */
  let angriffCooldown = 0;
  /**
   * Schlagtakt in Sekunden — kürzester Abstand zwischen zwei Schlägen.
   *
   * Dieselbe Zahl steuert die LÄNGE der Schlaganimation (AvatarRig
   * staucht den Clip darauf). Als Konstante statt zweier Literale, weil
   * ein Auseinanderlaufen genau das Aussetzen erzeugt, das Mike gemeldet
   * hat: Ein Clip, der länger dauert als der Takt, wird beim nächsten
   * Klick mitten im Lauf neu angestossen.
   */
  const ANGRIFF_TAKT = 0.5;
  /** Letzte Server-Spielerposition (PlayerState) — nur für die Diagnosezeile. */
  let serverPos: { x: number; y: number; z: number } | null = null;
  /**
   * F6: letzte vom Server bestätigte Eingabe-Sequenznummer (PlayerState,
   * angehängtes Feld) — die Nummer, unter der der Abgleich nachschlägt,
   * wo der Client stand, als er diese Eingabe abschickte.
   */
  let letzterBestaetigterInputSeq = -1;
  /**
   * Der Abgleich Client↔Server. Die ganze Logik (Verlauf, Schwellen,
   * weiches/hartes Nachziehen) steht in client/src/net/Positionsverlauf.ts
   * — hier stehen nur die drei Aufrufe: merken beim Senden, melden beim
   * Empfangen, anwenden je Bild.
   */
  const abgleicher = new Abgleicher();
  // Audio: startet mit der ersten Nutzergeste (Browser-Autoplay-Regel).
  const audio = new GameAudio();
  window.addEventListener('pointerdown', () => audio.start(), { once: true });
  window.addEventListener('keydown', () => audio.start(), { once: true });
  /** Dungeon-Eingänge vom Server — Kartenmarker (kommen ggf. vor buildWorld). */
  let dungeonEingaenge: Array<{ feature: string; dungeonId: string; x: number; z: number }> = [];
  // Letzte Zeigerposition — Ursprung des Zielstrahls beim Platzieren.
  // Fensterweit gefuehrt, weil der Zeiger beim Platzieren frei ist und
  // auch ueber Randbereiche wandern darf.
  let zeigerX = window.innerWidth / 2;
  let zeigerY = window.innerHeight / 2;
  window.addEventListener('mousemove', (e) => {
    zeigerX = e.clientX;
    zeigerY = e.clientY;
  });

  /**
   * Freies Setzen von Deko im Dungeon (F4 → „Frei setzen").
   *
   * Steht VOR dem Editor, weil der hineinruft. Umgekehrt reicht der Modus
   * sein Ergebnis über `dungeonEditor.dekoAusWelt` zurück — deshalb greifen
   * beide Richtungen erst zur Laufzeit auf die andere Seite zu.
   */
  const dekoPlatzierung = new DekoPlatzierung(scene, {
    // Eigener Container: Der Bucket-Pfad flacht den geteilten ein, und
    // ein Geist daraus haette keine Geometrie mehr (s. AssetManager).
    ladeGeist: (prefab) => assets.instantiate(prefab, undefined, `geist:${prefab}`),
    strahl: () => {
      if (!player) return null;
      // Strahl durch den ZEIGER, nicht durch die Bildmitte. Dieselbe
      // Technik, die der Welt-Editor fuer seine Maus-Platzierung benutzt
      // (`scene.createPickingRay`) — nur trifft er hier die Physik und
      // nicht das Hoehenfeld.
      const strahl = scene.createPickingRay(zeigerX, zeigerY, null, player.camera);
      return {
        x: strahl.origin.x, y: strahl.origin.y, z: strahl.origin.z,
        dx: strahl.direction.x, dy: strahl.direction.y, dz: strahl.direction.z,
      };
    },
    spielerYaw: () => player?.yaw ?? 0,
    gesetzt: (prefab, pos, yaw) => dungeonEditor.dekoAusWelt(prefab, pos, yaw),
    mausUmlenken: (fn) => {
      input.mausUmlenkung = fn;
    },
    radUmlenken: (fn) => {
      input.radUmlenkung = fn;
    },
    meldung: (text) => hud.meldung(text),
  });

  // F4-Editor: DOM-Panel, existiert von Anfang an (nur online nutzbar —
  // die Callbacks greifen dynamisch auf `socket` zu).
  const dungeonEditor = new DungeonEditor({
    anfordern: (id) => socket?.sendDungeonEditRequest(id),
    speichern: (json) => socket?.sendDungeonEditSave(json),
    admin: (line) => socket?.sendAdminCommand(line),
    meldung: (text) => hud.meldung(text),
    // Beim Klick gefragt, nicht gemerkt: Zwischen Oeffnen des Panels und
    // dem Setzen laeuft der Spieler weiter, und ein gemerkter Wert waere
    // genau der, an dem die Deko dann NICHT landet.
    spielerPose: () =>
      player
        ? { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }
        : null,
    freiSetzen: (prefab) => dekoPlatzierung.starte(prefab),
  });

  // ── Bedienung des Platzierungsmodus ───────────────────────────────
  //
  // Eigene Zuhörer statt eines Zweigs in der allgemeinen Eingabe: Der
  // Modus ist kurz, hat drei Tasten, und ein `if (dekoPlatzierung.aktiv)`
  // in der Bewegungsschleife wäre eine Abzweigung, an der später jeder
  // vorbeiliest.
  window.addEventListener('mousedown', (e) => {
    // Zeiger ist beim Platzieren FREI — es gibt keinen Lock, gegen den man
    // pruefen koennte. Stattdessen zaehlt, worauf geklickt wurde: Klicks
    // auf ein Panel gehoeren dem Panel.
    if (!dekoPlatzierung.aktiv || e.target !== canvas) return;
    if (e.button === 0) {
      dekoPlatzierung.setze();
      // NICHT beenden: Wer eine Fackel setzt, setzt meistens mehrere.
      // Escape beendet, und die Meldung sagt das auch.
    } else if (e.button === 2) {
      dekoPlatzierung.beende();
      hud.meldung('Platzieren abgebrochen');
    }
  });
  window.addEventListener('keydown', (e) => {
    if (!dekoPlatzierung.aktiv) return;
    dekoPlatzierung.setzeModifikatoren(e.shiftKey, e.ctrlKey);
    if (e.code === 'Escape') {
      dekoPlatzierung.beende();
      hud.meldung('Platzieren beendet');
    } else if (e.code === 'KeyF') {
      dekoPlatzierung.zuruecksetzen();
      hud.meldung('Drehung und Abstand zurückgesetzt');
    } else if (e.code === 'KeyR' && !e.repeat) {
      // Ab jetzt dreht die Maus das Objekt und nicht mehr den Blick.
      dekoPlatzierung.dreheBeginn();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (!dekoPlatzierung.aktiv) return;
    dekoPlatzierung.setzeModifikatoren(e.shiftKey, e.ctrlKey);
    if (e.code === 'KeyR') dekoPlatzierung.dreheEnde();
  });
  // Verliert das Fenster den Fokus, während R gedrückt ist, kommt kein
  // keyup mehr — die Maus bliebe für immer umgeleitet und die Kamera
  // stünde still. Das ist die Art Fehler, die man dem Platzieren nie
  // zuordnet.
  window.addEventListener('blur', () => dekoPlatzierung.dreheEnde());
  /**
   * Absolute world seconds. Seeded by TimeSync and advanced locally in
   * between, because the weather and the wind are pure functions of it —
   * letting it stand still between packets would freeze both.
   */
  let worldTime = 0;
  /**
   * Von der Webseite gewünschte Uhrzeit, in Sekunden innerhalb des Tages;
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

  // "Vegetationsqualität" / "Detailgrad" — graphics settings of the original
  // (GraphicsSettingInt.Vegetation/LOD), see ui/Settings.ts. Registered
  // after the `let terrain`/`let grass` declarations above: onChange()
  // fires its callback immediately with the current state, and referencing
  // those bindings any earlier throws (temporal dead zone).
  const gameSettings = new SettingsStore();
  const settingsPanel = new SettingsPanel(gameSettings, i18n);
  gameSettings.onChange((gewaehlt) => {
    // `?shafts=off` legt sich über die Spielerwahl, ohne sie zu speichern.
    const s = postOptionen(gewaehlt);
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
    minimap?.setZeitSichtbar(s.weltzeit);
    // Dungeon-Grafikstufe. Der Aufruf steht auch dann hier, wenn gerade kein
    // Dungeon offen ist: `setzeDungeonStufe` ist die GLOBALE Groesse, die der
    // naechste Dungeon beim Betreten liest (`Dungeon2Instanz` ruft
    // `dungeonStufe()` im Konstruktor). Ohne diese Zeile wirkte eine im Freien
    // umgestellte Stufe erst nach einem Neuladen — und der Spieler haette den
    // Regler bewegt, ohne dass irgendetwas passiert.
    // Dungeon graphics tier — set even with no dungeon open, because it is the
    // GLOBAL value the next dungeon reads on entering. Without this line the
    // control would do nothing until a reload.
    const stufe = Math.min(2, Math.max(0, Math.trunc(s.dungeonQuality))) as DungeonGrafikStufe;
    setzeDungeonStufe(stufe);
    dungeon2Instanz?.setzeStufe(stufe);
  });
  /** ?env= pins the weather — don't let the biome tracker override it. */
  let envPinned = false;
  /**
   * Vom Server festgenagelte Umgebung (server.yml `wetter.umgebung`),
   * oder null.
   *
   * Getrennt von `envPinned` gehalten, weil der WeatherManager erst in
   * der ersten Bildschleife entsteht — beim Eintreffen des Pakets gibt es
   * ihn noch nicht. Der Name muss also bis dorthin liegen bleiben.
   * `?env=` in der Adresszeile schlägt die Servervorgabe: Es ist das
   * Werkzeug, mit dem man am laufenden Server etwas anderes ansieht.
   */
  let serverUmgebung: string | null = null;

  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';

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
    player = new PlayerController(scene, input, world, assets, modellDateiZu(selectedFigure));
    // Schlaganimation auf den Schlagtakt stauchen — wie der Sprungclip auf
    // die Flugdauer. Der Rohclip ist mit 1,29 s deutlich laenger als der
    // Takt; ungestaucht wirkt der Schlag traege und jeder zweite Klick
    // faellt mitten hinein.
    player.avatar.setAngriffDauer(ANGRIFF_TAKT);
    // Frisur und Ruestung an die Spielfigur — dieselben Teildateien, die
    // schon in der Vorschau steckten, jetzt am Skelett des Avatars.
    // Der Aufruf darf vor dem Laden des Modells kommen: AvatarRig merkt
    // sich das Aussehen und zieht es nach, sobald der Koerper da ist.
    void player.avatar.setzeAussehen(aussehenFuerRig());
    player.avatar.setzeHaarfarbe(haarfarbeZu(selectedHairColor).hex);
    // Pruefzugang, NUR im Entwicklungsmodus — wie bei der Vorschau. Ohne
    // ihn laesst sich von aussen nicht messen, ob ein Kleidungsstueck am
    // Koerper sitzt; Babylon liegt als ES-Modul vor und nichts ist global.
    // Vite entfernt den Zweig im Build.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__avatar = player.avatar;
    }
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
    namensschilder.setSpielerName(playerName);
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
       * Abgleich Client↔Server in Zahlen — für die Messläufe.
       *
       * `ereignisse` ist die Kennzahl, um die es geht: wie oft der
       * Abgleich überhaupt eingegriffen hat. Auf freiem Feld soll sie im
       * Gehen wie im Sprint null bleiben; jedes Ereignis ist ein Ruck,
       * den Mike als Lag sieht. `zaehlerAus()` setzt sie zurück, damit
       * ein Messabschnitt bei null anfängt.
       */
      get abgleich() { return abgleicher.diagnose; },
      zaehlerAus: () => abgleicher.zaehlerZuruecksetzen(),
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
      /**
       * Intern hoeher rendern, als das Fenster gross ist — nur fuer Aufnahmen.
       *
       * Die Einstellung "Renderaufloesung" reicht dafuer nicht: RENDER_SCALE
       * endet bei 1.0, also bei der Fenstergroesse. Auf einem Bildschirm mit
       * 1080 Punkten Hoehe ist das fuer einen Hintergrundfilm zu wenig.
       *
       * setHardwareScalingLevel(0.5) rendert mit doppelter Kantenlaenge, also
       * vierfacher Pixelzahl. Die Kosten steigen entsprechend — das ist ein
       * Werkzeug fuer Aufnahmen, keine Spieleinstellung.
       */
      ueberaufloesung: (faktor: number) => {
        engine.setHardwareScalingLevel(1 / faktor);
        return engine.getHardwareScalingLevel();
      },
      /**
       * Figur aus- und einblenden — fuer Hintergrundaufnahmen, in denen der
       * Spieler nicht im Bild stehen soll (die Charaktererstellung auf
       * world-of-vikings.com laeuft vor so einem Film).
       *
       * isVisible statt setEnabled: Bewegung, Kamera und Physik sollen
       * weiterrechnen, nur gezeichnet werden soll nichts. Dasselbe Mittel
       * benutzt AvatarRig beim Modellwechsel.
       */
      figur: (an: boolean) => {
        for (const m of player?.avatar.root.getChildMeshes() ?? []) m.isVisible = an;
        return an;
      },
      /** Admin-Kommandozeile für Tests und Konsole: __vb.admin('dungeon list'). */
      admin: (line: string) => {
        socket?.sendAdminCommand(line);
        return socket?.connected ?? false;
      },
      /**
       * Eine Gelände-Operation schicken — wie ein Hackenschlag, nur ohne
       * Hacke. Nur für Messläufe: Eine steile Geländewand baut man sonst
       * nur von Hand mit dem Planier-Werkzeug, und ein Zeuge, der erst
       * eine Werkzeugleiste bedienen muss, misst am Ende die Werkzeugleiste.
       *
       * Es ist ausdrücklich KEINE Abkürzung an der Prüfung vorbei: Der
       * Server nimmt das Paket über denselben `handleTerrainOp` an (Radius
       * ≤ 8, Hub ≤ 8, höchstens 10 m vom Spieler) und spielt die Op an
       * alle zurück, uns eingeschlossen — Client und Server haben danach
       * bitgleich dasselbe Gelände.
       *
       *   __vb.gelaendeOp(x, y, z, { level: true, levelRadius: 8, square: true })
       */
      /**
       * Messhebel: Steigungsgrenze am Gelände im CLIENT an/aus. Der
       * Server fährt sie unabhängig davon weiter — genau deshalb ist der
       * Hebel etwas wert: Er trennt „der Client bremst" von „der Server
       * bremst" an derselben Wand, in derselben Sitzung.
       */
      hang: (an: boolean) => {
        if (player) player.hangRegelAn = an;
        return player?.hangRegelAn ?? null;
      },
      gelaendeOp: (x: number, y: number, z: number, teil: Record<string, unknown>) => {
        if (!socket?.connected) return false;
        socket.sendTerrainOp(x, y, z, JSON.stringify({ ...TERRAIN_OP_DEFAULTS, ...teil }));
        return true;
      },
      /** Diagnose: Platzierungsmodus (F4 -> Frei setzen). */
      deko: () => dekoPlatzierung.diagnose(),
      /** Diagnose: laufen die Flammen-Atlanten? */
      flammen: () => FlammenAtlas.diagnose(),
      /**
       * Diagnose: was tut der Strahlenkranz gerade? (A1)
       *
       * `angehaengt` und `passagen` sind die Zahlen, an denen das Tor
       * haengt — ohne sie ist „abgehaengt" eine Behauptung. `passagen`
       * ist zugleich der Leck-Zeuge: nach zehn Torwechseln 0 oder 1.
       * `null`, wenn die Option aus ist.
       */
      strahlen: () => post?.strahlenMesswerte ?? null,
      /**
       * Der Abnahmezeuge des Strahlenkranzes (F3): Was steht im
       * Verdeckungspuffer?
       *
       * `maxRot` war am 11.09.2026 ueber 400x225 Bildpunkte durchgehend 0
       * — der Effekt hat nichts gemalt und voll gekostet. Solange hier 0
       * steht, ist jede Aussage ueber Belichtung eine Aussage ueber einen
       * schwarzen Puffer. Liest zurueck von der GPU, gehoert also in
       * Messungen und nicht in die Bildschleife.
       */
      strahlenPuffer: () => post?.strahlenPufferProbe() ?? null,
      /**
       * Diagnose: jittert TAA wirklich? (F3)
       *
       * `versatzX`/`versatzY` sind Zeile 2 der Projektionsmatrix — genau
       * die Stelle, an der Babylon den Halton-Versatz ablegt. Sie stand
       * ueber siebzig Bilder auf (0, 0), weil `_updateProjectionMatrix`
       * ihn nur bei STEHENDER Kamera setzt und unsere Kamera in 58 von 58
       * Bildern `hasMoved` meldet. Ein Messlauf sammelt die Werte ueber 16
       * Bilder: unter 8 verschiedenen ist der Jitter gesperrt.
       * `entsperrt` sagt, ob unsere Ersetzung ueberhaupt sitzt.
       */
      taa: () => post?.taaMesswerte ?? null,
      /**
       * Diagnose: Woran haengt es, wenn eine Fackel nicht leuchtet?
       *
       * Drei Stationen, die von aussen gleich aussehen: Der Pool existiert
       * gar nicht, er findet keine Quelle, oder er hat sie und das Licht
       * kommt trotzdem nicht an.
       *
       * `quelle` sagt, WELCHE der beiden Listen gerade zaehlt. Ohne diese
       * Zeile las sich die Diagnose in einem 2.0-Grab wie „keine Fackeln
       * gebaut", wo in Wahrheit „falsche Liste gefragt" stand — sie fragte
       * fest `entities`, waehrend der Pool laengst umschaltet.
       * `quelle` names WHICH of the two lists currently counts.
       */
      fackeln: () => {
        const p = player?.position;
        const ausDungeon = dungeon2Instanz !== null;
        const nah = p
          ? ausDungeon
            ? dungeon2Instanz!.lichtquellen(p.x, p.z, 45)
            : (entities?.lichtquellen(p.x, p.z, 45) ?? [])
          : [];
        return {
          poolDa: lightPool !== null,
          poolInfo: lightPool?.info ?? null,
          quelle: ausDungeon ? 'dungeon2' : 'entities',
          quellenImUmkreis: nah.length,
          erste: nah[0] ?? null,
          plaetze: FackelLichter.plaetze,
          an: FackelLichter.anzahl,
        };
      },
      /** Messhilfe: Grundausrichtung um N Grad versetzen (s. DekoPlatzierung). */
      dekoVersatz: (grad: number) => dekoPlatzierung.setzeVersatz(grad),
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
      /** Treffereffekt vor der Figur ausloesen (Messzellen): art 0 hart, 1 Blut, 2 Parade. */
      effekt: (art = 0) => {
        if (!player) return false;
        const vorn = player.avatar.root.forward.clone();
        vorn.y = 0;
        vorn.normalize();
        const p = player.avatar.root.getAbsolutePosition().add(vorn.scale(1.0));
        p.y += 1.1;
        kampfEffekte.treffer(p, art);
        return true;
      },
      /** Parade wie per Rechtsklick: Geste + Server-Fenster (Messzellen). */
      pariere: () => {
        if (!player || !socket?.connected) return false;
        if (!player.avatar.starteAktion('parade')) return false;
        socket.sendParry();
        return true;
      },
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
    loading = new LoadingScreen(i18n);

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
        ['Messer', 1],
        ['Cultivator', 1], ['Wood', 12], ['Stone', 30],
      ] as Array<[string, number]>) {
        inventory.addItem(findItem(name)!, menge);
      }
    }
    hotbar = new Hotbar(inventory, equipment);
    inventoryPanel = new InventoryPanel(inventory, equipment, i18n);
    // Ziehen aus dem Inventar auf einen Ausruestungsslot. Das Inventar
    // kennt das Charakterfenster nicht — es fragt nur, ob jemand den
    // Gegenstand genommen hat (s. InventoryPanel.aufFremdesZiel).
    inventoryPanel.aufFremdesZiel = (item, ziel) => {
      const zelle = (ziel as Element | null)?.closest<HTMLElement>('[data-slot]');
      const slot = zelle?.dataset.slot;
      if (!slot || !istAusruestungsSlot(slot)) return false;
      // In den FALSCHEN Slot legen ist kein stiller Fehlschlag: Wer eine
      // Hose auf den Kopf zieht, soll erfahren, warum nichts passiert.
      const gehoert = equipment!.slotFuer(item);
      if (gehoert !== slot) {
        hud.meldung(`${item.shared.label} gehört nicht in diesen Slot`);
        return true;
      }
      equipment!.equip(item, slot as import('@wov/shared').AusruestungsSlot);
      return true;
    };
    // Jede Aenderung an der Ausruestung schlaegt auf Figur, Server und
    // Fenster durch — an EINER Stelle, damit nichts davon vergessen wird.
    equipment.onChanged(() => uebernehmeAussehen());
    // F1 (Roadmap): Truhen-UI. aufAktion reicht die ZDOID aus dem
    // zuletzt empfangenen ContainerSync unveraendert an den Server
    // zurueck (s. ContainerPanel-Kopfkommentar) — der Client entscheidet
    // nichts ueber Bestand oder Reichweite, das prueft WovServer.
    offeneTruhe = new OffeneTruhe(assets, entities);
    containerPanel = new ContainerPanel(inventory, (zdoUserId, zdoId, richtung, itemName, amount) => {
      socket?.sendContainerAction(zdoUserId, zdoId, richtung, itemName, amount);
    }, i18n);
    // Schliesst das Fenster auf welchem Weg auch immer (Escape, Klick
    // daneben, Karte auf, Inventar auf), faellt der Deckel zu. Der
    // Rueckruf sitzt im Fenster selbst, damit keiner der fuenf
    // hide()-Aufrufer ihn vergessen kann.
    containerPanel.onGeschlossen = () => offeneTruhe?.schliesse();
    placement = new PlacementController(scene, input, world, terrain, grass, player, equipment);
    // Das Mausrad zoomt die Kamera, im Baumodus wählt es aber das Stück und
    // stellt den Radius. Der PlayerController läuft hier VOR dem
    // PlacementController und würde das Ereignis sonst wegkonsumieren.
    player.zoomErlaubt = () => !placement!.menuOpen && !placement!.selectedPiece;
    pieceSelection = new PieceSelection(placement, input, i18n);
    // Terraforming server-autoritativ: online senden statt lokal graben.
    placement.sendeOp = (x, y, z, json) => {
      if (!socket?.connected) return false;
      socket.sendTerrainOp(x, y, z, json);
      return true;
    };
    // Hammer-Bausystem: Ghost aus dem AssetManager, Pieces zum Server.
    // Eigener Container, aus demselben Grund wie beim Deko-Geist: Sobald
    // ein Bauteil einmal statisch gesetzt wurde, hat der Bucket-Pfad die
    // Hierarchie des geteilten Containers eingeflacht, und der Geist
    // waere leer. Bisher unentdeckt, weil ein Bauteil meist zuerst als
    // Geist erscheint und erst danach steht.
    placement.ladeGhost = (prefab) => assets.instantiate(prefab, undefined, `geist:${prefab}`);
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
    }, i18n);
    worldMap.vorberechnen();
    // Fackel-/Feuer-Lichter: Pool wandert auf die nächsten Quellen.
    //
    // Die Quelle ist UMSCHALTBAR, nicht fest: In einer Dungeon-2.0-Instanz
    // liegen die Fackeln als Thin Instances beim Bauer und nicht als ZDOs
    // beim `EntityManager` (`dungeon2.ROLLEN_MIT_ZDO` führt nur `truhe` und
    // `spawner`). Der feste Griff nach `entities` lieferte dort null Quellen
    // — im Debug-Overlay `fackeln 0/16 array`, im Bild ein Grab mit fünfzig
    // Fackeln, von denen keine leuchtet. Die Vorschau hatte die Kopplung
    // (`bauer.lichtquellen`) von Anfang an; nur der Spielweg nicht.
    // The source is SWITCHABLE, not fixed: inside a dungeon 2.0 instance the
    // torches live as thin instances on the builder, not as ZDOs on the
    // entity manager. Reaching for `entities` unconditionally yielded zero
    // sources there.
    lightPool = new LightPool(scene, (x, z, r) =>
      dungeon2Instanz !== null
        ? dungeon2Instanz.lichtquellen(x, z, r)
        : (entities?.lichtquellen(x, z, r) ?? [])
    );
    // Minimap (Phase G): runder Detailausschnitt oben rechts mit Windzeiger.
    minimap = new Minimap(world);
    // Dungeon-Minimap (M2): sitzt am selben Platz, ist aber nur in einer
    // 2.0-Instanz sichtbar — beide schliessen einander aus.
    // Dungeon minimap (M2): same spot, visible only inside a 2.0 instance.
    dungeonMinimap = new DungeonMinimap();
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
    minimap.setZeitSichtbar(gameSettings.get().weltzeit);
    const aktuelleSettings = postOptionen(gameSettings.get());
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
    // ?fog=<dichte> — schrieb bis 22.08.2026 in `scene.fogDensity` und war
    // damit WIRKUNGSLOS: `Lighting.apply()` überschreibt den Wert im
    // nächsten Frame. Jetzt über denselben Schalter wie die Servervorgabe.
    if (params.has('fog')) lighting.nebelDichteFest = Number(params.get('fog'));
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
        `[Client] ServerConfig: world "${worldName}", seed "${worldSeed}", gen v${worldGenVersion}, flags 0b${flags.toString(2).padStart(7, '0')}`
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

    // Wettervorgabe des Servers (server.yml `wetter:`) — kommt direkt
    // hinter der ServerConfig, s. WovServer.onPeerAuthenticated.
    socket.on(PacketType.WeltWetter, (reader) => {
      const umgebung = reader.readString();
      const dichte = reader.readFloat32();
      // Der `look:`-Block haengt HINTEN dran (s. WovServer). `remaining`
      // gefragt und nicht blind gelesen: Ein Server ohne den Block
      // schickt das Feld nicht, und ein Lesefehler hier kostete die
      // ganze Wettervorgabe.
      if (reader.remaining > 0) {
        try {
          const roh: unknown = JSON.parse(reader.readString());
          const profil = setzeLook(roh);
          console.log(
            `[look] ${profil.tonemapping} bel ${profil.belichtung} kon ${profil.kontrast} ` +
              `saett ${profil.saettigung} nebel ${profil.nebelmodus} ` +
              `schatten ${profil.schatten.aufloesung}/${profil.schatten.reichweite}m/` +
              `${profil.schatten.dunkelheit}${profil.schatten.rasten ? '/gerastet' : ''}`
          );
        } catch (e) {
          console.warn('[look] Serverblock unlesbar — es bleibt bei der Vorgabe', e);
        }
      }

      if (umgebung !== WETTER_AUTOMATISCH && !envPinned) {
        if (lighting.setEnvironmentByName(umgebung)) {
          envPinned = true;
          serverUmgebung = umgebung;
          // Der WeatherManager entsteht erst in der Bildschleife; ist er
          // schon da, wird er sofort nachgezogen (Neuanmeldung ohne
          // Seitenwechsel).
          weather?.setEnvironmentOverride(umgebung);
        } else {
          // Kann nur passieren, wenn Server und Client verschiedene
          // Umgebungslisten haben — der Server prüft den Namen selbst.
          console.warn(`[wetter] Server nennt unbekannte Umgebung "${umgebung}"`);
        }
      }

      // Der Server schickt NEBEL_AUTOMATISCH (negativ), wenn nichts
      // eingestellt ist; `null` heisst hier „der Tageszeit folgen".
      lighting.nebelDichteFest = dichte >= 0 ? dichte : null;

      console.log(
        `[wetter] Servervorgabe: Umgebung ${umgebung || '(gewürfelt)'}, ` +
          `Nebeldichte ${dichte >= 0 ? dichte.toFixed(4) : '(nach Tageszeit)'}` +
          (envPinned && serverUmgebung === null ? ' — ?env= aus der Adresszeile hat Vorrang' : '')
      );
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
      // Der Sprung wartet, bis die WELT FERTIG GELADEN ist.
      //
      // ── Der Fehler, den das behebt ──────────────────────────────────
      // Zuerst hing er am ersten PlayerState — der kommt aus
      // `onPeerAuthenticated`, also eine Sekunde nach dem Anmelden und
      // damit MITTEN im Aufbau der Oberwelt. Der Teleport nimmt dem
      // Ladebildschirm dann genau das Gelände weg, auf dessen
      // Fertigstellung er wartet: `LoadingScreen.update()` blendet
      // ausschliesslich auf `terrain.ready` aus, und in einer
      // Dungeon-Instanz gibt es kein Gelände (`LeereGeo`) — es entstehen
      // dort keine Chunks mehr, `ready` wird nie wahr, der Vorhang hebt
      // sich nie.
      //
      // Am 28.08.2026 sah das so aus: `imDungeon: true`, 19 richtige
      // Instanzen ringsum, 9 brennende Fackeln, kein einziger Fehler in
      // der Konsole — und darüber „The world awakens… / Building the
      // terrain" bei 0 %. Alles funktionierte, man sah es nur nicht.
      //
      // Von Hand (Taste E, Admin-Befehl) trat der Fehler nie auf: Da ist
      // der Ladebildschirm längst weg und `update()` kehrt sofort zurück.
      //
      // `PlayerState` kommt fortlaufend, nicht nur einmal — die Marke
      // bleibt also ungesetzt, bis die Bedingung stimmt, und das
      // naechste Paket loest aus.
      if (dungeonWunsch && !dungeonSprungGetan && terrain?.ready) {
        dungeonSprungGetan = true;
        hud.meldung(`Betrete ${dungeonWunsch} …`);
        socket?.sendAdminCommand(`dungeon enter ${dungeonWunsch}`);
      }
      const health = reader.readFloat32();
      const stamina = reader.readFloat32();
      if (reader.remaining >= 12) serverPos = reader.readVector3();
      // F6: angehängtes Feld, älterer/neuerer Leser kommen sich nicht in
      // die Quere — s. Kommentar in WovServer.sendPlayerState.
      if (reader.remaining >= 4) letzterBestaetigterInputSeq = reader.readInt32();
      // Der Abgleich entscheidet hier, OB nachgezogen wird; angewandt
      // wird es im Bild (s. abgleicher.schritt weiter unten).
      if (serverPos && player) {
        abgleicher.serverMeldung(serverPos, letzterBestaetigterInputSeq, player.position, imDungeon);
      }
      hud.setVitals(health, stamina);
      // Ausdauer-Abgleich: Der Server ist die Wahrheit, der Controller rechnet
      // sie zwischen zwei Paketen nur mit (PlayerController.setzeServerAusdauer).
      player?.setzeServerAusdauer(stamina);
      // Dieselbe Zahl im eigenen Namensschild — eine Quelle, zwei Anzeigen.
      namensschilder?.setSpielerLeben(health);
    });

    // F14: eingehende Chat-Nachricht — Reichweitenfilterung macht der
    // Server (WovServer.handleChatMessage), der Client zeigt nur an, was
    // ankommt.
    socket.on(PacketType.ChatMessage, (reader) => {
      reader.readString(); // senderId — heute ungenutzt, Name reicht für die Anzeige
      const senderName = reader.readString();
      const chatType = reader.readInt32();
      const text = reader.readString();
      reader.readVector3(); // Position des Absenders — heute ungenutzt (keine Sprechblase)
      chatPanel.empfangen(senderName, chatType, text);
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
          // warnung, nicht hinweis: ein übersprungener Abschnitt kann ein
          // sichtbar falsches Gelände hinterlassen (z. B. eine nicht
          // eingetragene Grabung), auch wenn das Spiel weiterläuft.
          hud.meldeFehler('Geländedaten teilweise beschädigt — ein Abschnitt wurde übersprungen', 'warnung');
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
    // Treffereffekt vom Server (Kreatur getroffen: Blut; Holz/Stein: Funken;
    // Parade: Funke) — auch fuer Treffer, die Mitspieler landen.
    socket.on(PacketType.HitEffect, (reader) => {
      const pos = reader.readVector3();
      const art = reader.readInt32();
      kampfEffekte.treffer(new Vector3(pos.x, pos.y, pos.z), art);
    });

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

    // Truheninhalt (F1, Roadmap) — kommt NUR als direkte Antwort auf das
    // eigene Interact (Oeffnen) oder die eigene ContainerAction (s.
    // PacketType.ContainerSync, WovServer.sendeTruheInhalt) — nie
    // unaufgefordert fuer eine Truhe, die dieser Client gar nicht selbst
    // gerade angefasst hat. zeigeInhalt() darf deshalb hier bedenkenlos
    // OEFFNEN, nicht nur aktualisieren.
    socket.on(PacketType.ContainerSync, (reader) => {
      const zdoUserId = reader.readString();
      const zdoId = reader.readInt32();
      const json = reader.readString();
      containerPanel?.zeigeInhalt(zdoUserId, zdoId, unpackContainer(json));
      // Der Deckel geht auf. `oeffne` ist gegen Mehrfachaufrufe
      // abgesichert — bei jedem Umschichten kommt ein neues
      // ContainerSync, und der Deckel soll davon nicht neu aufspringen.
      void offeneTruhe?.oeffne(`${zdoUserId}:${zdoId}`);
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
      const dungeonId = reader.readString();
      const env = reader.readString();
      // AP13 — die ANGEHÄNGTEN Felder des 2.0-Deskriptors. Ein leeres
      // `thema` heisst „kein 2.0"; ein Server ohne diese Felder (älterer
      // Stand) liefert gar nichts mehr, und `remaining` fängt das ab, statt
      // über das Pufferende zu lesen.
      // AP13 — the APPENDED fields of the 2.0 descriptor.
      let deskriptor: Dungeon2Deskriptor | null = null;
      // Das dokumenteigene Steinmaterial (1.0-Gräber). Steht hier OBEN, weil
      // es unten ausserhalb von `if (thema)` gebraucht wird: Ein
      // 1.0-Dokument hat gar kein Thema, und genau es trägt dieses Feld.
      // Declared here because it is used OUTSIDE `if (thema)` below — a 1.0
      // document has no theme at all and is exactly what carries this field.
      let steinKitJson = '';
      // Die Grundbeleuchtung — aus demselben Grund hier oben. Bei 2.0 wandert
      // sie in den Deskriptor und wird von `DungeonAtmosphere` angelegt; bei
      // 1.0 gibt es keinen Deskriptor, und dann legt sie unten der
      // 1.0-Zweig selbst an. Vorbelegt mit 1 = „Umgebung wie bisher".
      // The base brightness, hoisted for the same reason: 2.0 carries it in
      // the descriptor, 1.0 applies it directly below.
      let ambientLicht = 1;
      if (reader.remaining > 0) {
        const thema = reader.readString();
        const architektur = reader.readInt32();
        const material = reader.readInt32();
        const deko = reader.readInt32();
        const pruefsumme = reader.readString();
        const layoutVersion = reader.readInt32();
        const name = reader.readString();
        // Grundhelligkeit (Dokumentfassung 11) — erst ab diesem Serverstand
        // im Paket. `remaining` entscheidet, NICHT ein Versionsfeld: Ein
        // Server ohne das Feld ist kein Fehler, er hat nur nichts dazu zu
        // sagen, und dann gilt „wie bisher" (1).
        // Base brightness (document revision 11) — only in the packet from
        // this server build on. `remaining` decides, not a version field.
        ambientLicht = reader.remaining >= 4 ? reader.readFloat32() : 1;
        // Das MITGELIEFERTE Layout-JSON (Befund 01.09.2026) — nur bei
        // handgebauten Graebern gefuellt, sonst leer. Angehaengt hinter
        // `ambientLicht`; ein aelterer Server hat es nicht, dann greift der
        // Seed-Weg. `remaining` entscheidet, kein Versionsfeld.
        // The SHIPPED layout JSON — only present for hand-built graves.
        const layoutJson = reader.remaining > 0 ? reader.readString() : '';
        // ANGEHÄNGT hinter `layoutJson`. Gelesen MUSS es hier drin werden —
        // nur hier steht der Lesezeiger richtig; ausgewertet wird es unten.
        // Must be READ in here (only here is the cursor right); evaluated
        // below.
        steinKitJson = reader.remaining > 0 ? reader.readString() : '';
        if (thema) {
          deskriptor = {
            thema,
            seeds: {
              architektur: architektur >>> 0,
              material: material >>> 0,
              deko: deko >>> 0,
            },
            pruefsumme,
            layoutVersion,
            id: dungeonId,
            name,
            ambientLicht,
            layoutJson,
          };
        }
      }
      // Die letzte bekannte Server-Position ist nach einem harten Sprung
      // bedeutungslos — stünde sie weiter, zöge die Reconciliation den
      // Spieler sofort zur ALTEN Stelle zurück (so entstand die Schleife
      // "beim Weglaufen spawne ich immer wieder am Eingang").
      serverPos = null;
      // Aus demselben Grund ist der Positionsverlauf hinüber: Seine
      // Punkte stehen alle am alten Ort, und ein Versatz daraus wäre die
      // Teleportstrecke selbst.
      abgleicher.zuruecksetzen();
      imDungeon = drin;
      // Das dokumenteigene Steinmaterial anlegen, BEVOR die Kit-Teile
      // geladen werden — `prepareMasters` bemalt sie beim Laden, und beim
      // zweiten Grab derselben Sitzung zieht `setzeDokumentSteinKit` die
      // längst geladenen Master nach. Beim Verlassen zurück auf die
      // Kit-Vorgabe, sonst sickerte ein Grab ins nächste.
      // Applied BEFORE the kit parts load; reset on leaving so no barrow
      // bleeds into the next.
      if (entities) {
        let kit: Record<string, unknown> | null = null;
        if (drin && steinKitJson) {
          try {
            const roh: unknown = JSON.parse(steinKitJson);
            if (roh && typeof roh === 'object') kit = roh as Record<string, unknown>;
          } catch (e) {
            console.warn('[steinKit] Dokument-Steinmaterial unlesbar — Kit-Vorgabe bleibt.', e);
          }
        }
        entities.setzeDokumentSteinKit(kit as Partial<SteinKitConfig> | null);
      }
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
      // Gegengleich die Dungeon-Minimap. Sichtbar sofort (sie zeichnet erst,
      // wenn `betrete()` das Layout nachreicht); beim Verlassen den
      // Fog-of-War-Zustand verwerfen, damit kein Grab ins nächste durchsickert.
      // The dungeon minimap, inverted. Cleared on exit so no fog bleeds over.
      dungeonMinimap?.setVisible(drin);
      if (!drin) dungeonMinimap?.leere();
      hud.meldung(drin ? 'Dungeon wird geladen…' : 'Zurück in der Oberwelt');

      // ── Dungeon 2.0 (AP13) ────────────────────────────────────────
      // Ein laufendes Grab wird IMMER abgeräumt — auch beim Wechsel von
      // einer 2.0-Instanz in die nächste. Die Marke steigt dabei, damit ein
      // noch fliegendes `betrete()` sein Ergebnis wegwirft statt es in eine
      // Szene zu hängen, die schon einer anderen Instanz gehört.
      // A live barrow is ALWAYS torn down — the counter makes an in-flight
      // `betrete()` discard its result.
      dungeon2Marke++;
      if (dungeon2Instanz) {
        dungeon2Instanz.verlasse();
        dungeon2Instanz = null;
      }

      // ── Grundbeleuchtung eines 1.0-Grabs ──────────────────────────
      //
      // NUR für 1.0, also nur OHNE Deskriptor: Bei 2.0 setzt und löscht
      // `DungeonAtmosphere` (`betrete()`/`verlasse()`) denselben Regler, und
      // zwei Schreiber auf einer Grösse überschreiben einander irgendwann in
      // der falschen Reihenfolge — `Dungeon2Instanz.betrete()` läuft
      // asynchron, würde also NACH dieser Zeile landen und sie stillschweigend
      // gewinnen. Deshalb hier die ausdrückliche Bedingung `!deskriptor`
      // statt eines „schadet ja nicht".
      //
      // Die Stelle ist bewusst NACH dem Abräumen oben: Kommt man aus einem
      // 2.0-Grab in ein 1.0-Grab, hat `verlasse()` den Regler gerade auf
      // `null` gestellt — erst danach darf der neue Wert stehen.
      //
      // Beim Verlassen (`drin === false`) IMMER zurück auf `null`, auch wenn
      // gar kein 1.0-Grab anlag: Ein Regler, den man beim Hinausgehen nicht
      // zurückgibt, färbt die Oberwelt — und das sieht man erst beim nächsten
      // Sonnenaufgang.
      //
      // 1.0 ONLY (i.e. no descriptor): for 2.0 the very same knob is set and
      // cleared by `DungeonAtmosphere`, and its async `betrete()` would land
      // AFTER this line and silently win. Placed after the teardown above so a
      // 2.0→1.0 transition sets the new value last. On leaving, always
      // released — a knob kept on exit tints the overworld.
      if (!drin) {
        lighting.setzeDungeonDaempfung(null);
      } else if (!deskriptor) {
        lighting.setzeDungeonDaempfung(ambientLicht);
      }

      if (drin && deskriptor && player) {
        const marke = dungeon2Marke;
        const spielerRef = player;
        void Dungeon2Instanz.betrete(deskriptor, {
          scene,
          kamera: spielerRef.camera,
          assets,
          meldung: (t) => hud.meldung(t),
          // Die Grundhelligkeit des Grabs liegt an der WELTBELEUCHTUNG an,
          // nicht an einem eigenen Licht der Instanz: `lighting.apply()`
          // schreibt Sonne und Hemisphärenlicht in jedem Bild neu, ein
          // zweites Licht daneben würde nur addieren statt zu dämpfen.
          // The barrow's base brightness applies to the WORLD lighting.
          licht: lighting,
        })
          .then((instanz) => {
            if (instanz === null) return;
            if (marke !== dungeon2Marke) {
              // Überholt: Es gab inzwischen einen weiteren Weltwechsel.
              // Overtaken by a later world change.
              instanz.verlasse();
              return;
            }
            dungeon2Instanz = instanz;
            // Die Dungeon-Minimap bekommt JETZT ihr Layout — vorher lag es
            // nicht bereit. Sie ist bereits sichtbar geschaltet und beginnt
            // mit dem nächsten Frame zu zeichnen (verdeckt, deckt sich auf).
            // The dungeon minimap gets its layout NOW; it is already visible.
            dungeonMinimap?.setzeLayout(instanz.layout);
            // JETZT erst geht der Vorhang hoch. In einer Instanz gibt es
            // kein `terrain.ready`, und `LoadingScreen` blendet
            // ausschliesslich darauf aus — ohne diese Zeile bliebe „The
            // world awakens…" bei 0 % über einem fertig gebauten Grab
            // stehen (Vault: „Ladebildschirm hängt am Gelände").
            // ONLY NOW does the curtain rise.
            loading?.update(1, true);
            // Und JETZT erst darf die Figur laufen: Der Bauer hat seine
            // Havok-Körper gesetzt, es liegt etwas unter ihr.
            // And ONLY NOW may the character walk.
            spielerRef.frozen = false;
            spielerRef.teleportTo(pos.x, pos.y, pos.z);
            hud.meldung(
              `${deskriptor.name || deskriptor.id} betreten ` +
                `(${instanz.messung.msBisBereit.toFixed(0)} ms) — E am Eingang: verlassen`
            );
            // Messfenster für den Ende-zu-Ende-Lauf. Absichtlich ein
            // eigener Name neben `__dg2` (der Vorschau) — beide dürfen
            // gleichzeitig existieren, ohne sich zu überschreiben.
            // Measurement handle for the end-to-end run.
            (window as unknown as Record<string, unknown>).__dg2live = {
              messung: instanz.messung,
              layout: instanz.layout,
              statistik: () => instanz.bauer.statistik(),
              vollstaendig: () => instanz.bauer.vollstaendig,
              /**
               * Befund 2 (31.08.2026): Speist der Pool sich wirklich aus
               * DIESEM Grab? `quellen` ist die Zahl, die vorher 0 war.
               * Does the pool really feed from THIS barrow?
               */
              fackeln: () => {
                const p = spielerRef.position;
                return {
                  quellen: instanz.lichtquellen(p.x, p.z, 45).length,
                  gesamt: instanz.lichtquellen(0, 0, 1e9).length,
                  poolInfo: lightPool?.info ?? null,
                  an: FackelLichter.anzahl,
                  plaetze: FackelLichter.plaetze,
                };
              },
              /**
               * Befund 1: Stehen die Füsse auf dem Boden? `sohleY` ist die
               * gemessene Sohle, `bodenY` die Fläche darunter.
               * Do the feet stand on the floor?
               */
              fuesse: () => {
                const d = spielerRef.fussDiagnose;
                return {
                  ...d,
                  spielerY: spielerRef.position.y,
                  abstand: d.bodenY === null ? null : d.sohleY - d.bodenY,
                };
              },
              /** Befund 4: die Grundhelligkeit dieses Grabs. / Base brightness. */
              ambient: () => ({
                ...instanz.atmosphaereWerte,
                daempfungAnLichtung: lighting.dungeonDaempfung,
                sonne: +lighting.sun.intensity.toFixed(4),
                hemisphaere: +lighting.ambient.intensity.toFixed(4),
                umgebung: +scene.environmentIntensity.toFixed(4),
              }),
            };
          })
          .catch((e: unknown) => {
            console.error('[dungeon2] Betreten fehlgeschlagen:', e);
            hud.meldung('Dungeon konnte nicht gebaut werden — siehe Konsole');
          });
      }
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
      // Wahl melden, sobald die Verbindung steht. Der Server prueft sie
      // und schreibt sie ans Charakter-ZDO — erst dadurch sehen die
      // anderen Spieler dieselbe Figur wie man selbst.
      //
      // NICHT bei einer Ticket-Anmeldung: Dann gehoert der Charakter einem
      // Konto, und der Server hat Aussehen und Namen bereits gesetzt --
      // aus dem Spielstand, ersatzweise aus der Kontendatenbank. Wuerde
      // der Client hier lokale Vorgabewerte melden, ueberschriebe er genau
      // das. Ein im Spiel geaenderter Haarschnitt waere nach jedem Neuladen
      // wieder weg.
      if (!mitTicket) {
        socket?.sendFigur(selectedFigure);
        // Frisur und Ruestung auf demselben Weg. Ohne das saehe jeder nur
        // sich selbst richtig — die anderen bekaemen die Vorgabefrisur.
        socket?.sendAussehen(
          selectedHairstyle, selectedTop, selectedLegs,
          selectedHairColor
        );
      }
      reconnectVersuch = 0;
    };
    socket.onDisconnected = (reason) => {
      netStatus = `getrennt${reason ? `: ${reason}` : ''}`;
      // Auto-Reconnect (Review-Punkt 9): drei Versuche mit wachsendem
      // Abstand, erst danach zur Anmeldung auf der Webseite. Ein Kick durch
      // den Server (reason gesetzt) wird NICHT automatisch wiederholt.
      if (!reason && reconnectVersuch < 3) {
        reconnectVersuch++;
        const wartezeit = 1000 * 2 ** (reconnectVersuch - 1);
        hud.meldung(`Verbindung verloren — Wiederaufbau in ${wartezeit / 1000}s (Versuch ${reconnectVersuch}/3)`);
        window.setTimeout(() => connectOnline(name, url), wartezeit);
        return;
      }
      document.body.classList.remove('ui-versteckt');
      const message = reason ? `Getrennt: ${reason}` : 'Verbindung zum Server verloren';
      hud.meldeFehler(`${message} — zurück zur Anmeldung …`, 'schwer');

      // The game no longer owns an account or character picker. Once all
      // reconnect attempts are exhausted, the only honest recovery path is
      // the website that issued the session. Keeping a second login here
      // would recreate the legacy layer this flow removes.
      window.setTimeout(
        () => window.location.replace(websiteLoginUrl(Boolean(reason))),
        1_200,
      );
    };
    socket.connect();
    netStatus = 'verbinde…';
  }

  function verbinden(): void {
    namensschilder?.setSpielerName(playerName);
    // `?t=` bleibt der stärkere Schalter: Der hält die Uhr zusätzlich an
    // (siehe buildWorld), und beides gleichzeitig anzuwenden ergäbe eine
    // angehaltene Uhr auf einer anderen Zeit als der ausgewählten.
    const zeitGewuenscht = requestedHour !== null && !params.has('t');

    // Wird beim ersten TimeSync eingelöst — siehe `zeitWunsch`.
    zeitWunsch = zeitGewuenscht ? (requestedHour! / 24) * WORLD_TIME_LENGTH : null;
    connectOnline(playerName, `${wsProto}://${location.host}/ws`);
  }

  // Online has exactly one entry now: an account session issued by wov-web.
  // There is no intermediate screen and no second connect button.
  if (!offlineMode) {
    verbinden();
  }

  // ?offline=1 remains available for quick dev/Playwright probes.
  // ?layout=editor lädt zusätzlich den Editor-Entwurf aus localStorage —
  // der "Testflug" des 3D-Map-Generators: die unveröffentlichte Welt im
  // echten Spiel-Terrain begehen (editor.html setzt den Eintrag).
  if (offlineMode) {
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
    if (requestedHour !== null && !params.has('t')) lighting.timeOfDay = requestedHour / 24;

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
    containerPanel?.isVisible === true ||
    settingsPanel.isVisible ||
    worldMap?.isVisible === true ||
    craftingPanel.isVisible ||
    // Ohne diese Zeile bliebe die Maus gefangen, waehrend das
    // Charakterfenster offen ist — man saehe die Liste und koennte nicht
    // daraufklicken.
    charakterPanel.isVisible ||
    dungeonEditor?.isVisible === true ||
    // Platzieren mit freiem Zeiger: gezielt wird mit der Maus, nicht mit
    // dem Kopf.
    dekoPlatzierung.aktiv ||
    spawnEditorOffen() ||
    routenEditorOffen() ||
    chatPanel.istOffen;
  /**
   * F1 — Oberflaeche aus und wieder an.
   *
   * Umgesetzt als eine Klasse am <body>, nicht als Liste von Fenstern:
   * Alles haengt direkt am Dokumentkoerper, und eine CSS-Regel erfasst
   * damit auch, was spaeter dazukommt (siehe index.html). Eine Liste
   * muesste jedes Mal nachgezogen werden — und ein vergessenes Element
   * faellt erst auf dem fertigen Bildschirmfoto auf.
   *
   * NUR IM SPIEL: Vor dem Aufbau einer Welt gibt es noch keine sichtbare
   * Oberflaeche, die diese Taste sinnvoll umschalten koennte.
   *
   * Die Mausfang-Antwort ist dieselbe wie sonst (`!cursorNoetig()`): Das
   * Ausblenden aendert nichts daran, ob gerade ein Fenster offen ist.
   */
  const uiSichtbarkeitUmschalten = (): void => {
    if (!world) return;
    document.body.classList.toggle('ui-versteckt');
  };
  input.onMenuKey('F1', () => {
    uiSichtbarkeitUmschalten();
    return !cursorNoetig();
  });

  input.onMenuKey('KeyM', () => {
    // Die Karte braucht die Maus (Ziehen, Zoomen, Abfrage unter dem Zeiger),
    // liegt also im selben Lager wie das Inventar: Zeiger frei.
    worldMap?.toggle();
    if (worldMap?.isVisible) {
      inventoryPanel?.hide();
      containerPanel?.hide();
      placement?.closeMenu();
    }
    return !cursorNoetig();
  });
  input.onMenuKey('KeyI', () => {
    inventoryPanel?.toggle();
    // Das Werkzeugmenue weicht weiterhin — das Charakterfenster NICHT:
    // Beide zusammen sind der Sinn der Sache (Ziehen von dort nach hier).
    if (inventoryPanel?.isVisible) {
      containerPanel?.hide();
      placement?.closeMenu();
    }
    ordneFenster();
    return !cursorNoetig();
  });
  input.onMenuKey('Tab', () => {
    // Sagen, WARUM nichts passiert. `toggleMenu()` steigt still aus, wenn
    // das gehaltene Werkzeug keine Bauteile fuehrt — das Menue haengt an
    // `equipment.pieceTable`, also am Gegenstand in der HAND. Mike stand
    // am 21.08.2026 genau davor: erst die falsche Taste (B ist nur im
    // Editor-Testflug belegt), dann die richtige ohne Hammer in der Hand,
    // und beide Male schwieg das Spiel. Begruendung der Faelle in
    // player/BaumenueHinweis.ts.
    const hinweis = baumenueHinweis({
      bauteile: placement?.pieces.length ?? 0,
      gehalten: equipment?.rightItem?.shared.name ?? null,
      werkzeugImInventar: (inventory?.countOf('Hammer') ?? 0) > 0,
    });
    if (hinweis !== null) {
      hud.meldung(hinweis);
      return !cursorNoetig();
    }
    if (inventoryPanel?.isVisible) inventoryPanel.hide();
    containerPanel?.hide();
    placement?.toggleMenu();
    return !cursorNoetig();
  });
  input.onMenuKey('KeyC', () => {
    craftingPanel.toggle();
    if (craftingPanel.isVisible) {
      inventoryPanel?.hide();
      containerPanel?.hide();
      charakterPanel.hide();
      placement?.closeMenu();
    }
    return !cursorNoetig();
  });
  // K wie Charakter. C waere die Gewohnheit aus anderen Spielen, ist hier
  // aber seit langem das Handwerksfenster; I, Tab, B, E, F, P und M sind
  // ebenfalls vergeben.
  input.onMenuKey('KeyK', () => {
    charakterPanel.toggle();
    if (charakterPanel.isVisible) {
      // Das Inventar bleibt bewusst stehen, wenn es offen ist.
      containerPanel?.hide();
      craftingPanel.hide();
      placement?.closeMenu();
    }
    ordneFenster();
    return !cursorNoetig();
  });
  input.onMenuKey('Enter', () => {
    // Nur das ÖFFNEN läuft hier — s. Kommentar oben. Ein zweites Enter
    // erreicht diesen Handler nie: ChatPanel stoppt die Weiterleitung an
    // window, solange die Eingabezeile fokussiert ist.
    if (!chatPanel.istOffen) chatPanel.oeffnen();
    return !cursorNoetig();
  });
  input.onMenuKey('Escape', () => {
    // Escape closes whatever is open. The browser drops the lock on Escape
    // anyway — this way that is a deliberate step, not a broken state.
    inventoryPanel?.hide();
    containerPanel?.hide();
    placement?.closeMenu();
    worldMap?.hide();
    craftingPanel.hide();
    charakterPanel.hide();
    dungeonEditor?.hide();
    ordneFenster();
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

  /*
    Zielfarben für den Himmel, den der Boden spiegelt (Stufe 2, „Look").

    `ValheimSky.gibHimmelsfarben()` legt ohne Zielobjekte zwei frische
    Color3 an — es gibt Kopien heraus, weil `update()` `reflectState` an
    Ort und Stelle überschreibt und ein durchgereichter Zeiger sich dem
    Empfänger unter den Händen änderte. Hier wird pro Frame gefragt,
    also werden die Ziele mitgegeben (so steht es an der Methode): zwei
    Objekte für die ganze Sitzung statt zwei je Bild.

    Targets for the sky the ground reflects — passed in because this is a
    per-frame caller (see `gibHimmelsfarben`).
  */
  const bodenHimmelZenit = new Color3();
  const bodenHimmelHorizont = new Color3();

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
    // Abgleich Client↔Server. Die Entscheidung ist beim Eintreffen des
    // PlayerState gefallen (abgleicher.serverMeldung, gegen die eigene
    // Position ZUM ZEITPUNKT der bestätigten Eingabe statt gegen jetzt);
    // hier wird nur noch der Anteil dieses Bildes angewandt. Warum das
    // nicht mehr hier gerechnet wird: client/src/net/Positionsverlauf.ts.
    if (socket?.connected && !player.frozen) {
      const befehl = abgleicher.schritt(dt);
      if (befehl?.art === 'setzen') {
        player.teleportTo(befehl.x, befehl.y ?? player.position.y, befehl.z);
      } else if (befehl?.art === 'schieben') {
        // NICHT `player.position.x += …`: `position` ist ein Spiegel, den
        // das nächste `update()` aus der Havok-Kapsel überschreibt — so
        // stand es hier seit jeher, und deshalb hat der weiche Abgleich
        // nie gezogen (Messung im Kopfkommentar von
        // PlayerController.verschiebeWeich).
        player.verschiebeWeich(befehl.dx, befehl.dy, befehl.dz);
      }
    }
    // Zielen/Ghost/Auslösen nach der Spielerbewegung, damit Kamera und
    // Fußhöhe im selben Frame aktuell sind.
    placement?.update(dt);
    // Geist am Fadenkreuz nachführen — nur im Platzierungsmodus, sonst
    // kehrt die Funktion sofort zurück.
    dekoPlatzierung.update();
    pieceSelection?.render();
    // Im Dungeon kein Terrain-Streaming: Es gäbe an x≈100000 nichts zu
    // bauen, und das Wasser würde dem Spieler in die Instanz folgen.
    if (!imDungeon) {
      miss('terrain', () => terrain!.update(player!.position.x, player!.position.z, elapsed));
    } else {
      // Das Gegenstück zum Gelände-Streaming: In der 2.0-Instanz zieht der
      // Bauer die restlichen Blöcke nach, während man schon läuft. Der
      // Spawnblock stand vor dem Auftauen (`Dungeon2Instanz.betrete`), alles
      // Weitere kommt hier — blockweise, damit ein grosses Grab keinen
      // Ruckler von einer halben Sekunde erzeugt.
      // The counterpart to terrain streaming: the builder catches up here.
      dungeon2Instanz?.weiterbauen();
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
      // Dasselbe gilt für die Servervorgabe; die Adresszeile schlägt sie.
      if (envPinned) weather.setEnvironmentOverride(params.get('env') ?? serverUmgebung);
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
    minimap?.update(player.position.x, player.position.z, player.yaw, minimapWind, lighting.timeOfDay);
    // Dungeon-Minimap: y bestimmt die Ebene, x/z/yaw Position und Pfeil.
    // Zeichnet nur, wenn sichtbar (in einer Instanz). / Only draws when visible.
    dungeonMinimap?.update(player.position.x, player.position.y, player.position.z, player.yaw);
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
      // Farbe × STÄRKE, nicht die nackte Farbe: Der Boden ist das einzige
      // Material, das seine Lichtwerte als Uniform bekommt und die
      // Intensität deshalb nicht selbst anwenden kann. Hier stand bis zum
      // 09.09.2026 `lighting.sun.diffuse` / `lighting.ambient.diffuse` —
      // um 17 Uhr hoben sich die beiden Fehler fast auf, im Dungeon nicht:
      // Dort dämpft `Lighting.apply()` beide Intensitäten, und der Boden
      // blieb voll hell. Die fertigen Puffer liegen in `Lighting`, samt
      // Messzahlen. / Colour × intensity — the terrain gets its lighting
      // as uniforms and cannot apply the intensity itself.
      lighting.bodenSonne,
      lighting.bodenAmbient,
      scene.fogDensity,
      // LINEAR — `scene.fogColor` ist Babylons Gamma-Wert und würde vom
      // ImageProcessing-Pass ein zweites Mal aufgehellt (Lighting.ts).
      lighting.fogColorLinear,
      // Zweite Nebelfarbe und Sonnenrichtung für den gerichteten Nebel.
      // Weltkoordinaten, weil die Nebelkette des Terrains dort rechnet —
      // Standard und PBR bekommen dieselbe Richtung im Sichtraum.
      lighting.fogColorSonnenLinear,
      lighting.zurSonneWelt,
      // Stufe 2: der Himmel, den der metallische Boden spiegelt. Ohne
      // dieses Argument leitet der Splat Zenit und Horizont aus der
      // Nebelfarbe ab — richtig aussehend, aber nicht vom `look:`-Profil
      // geführt. `?.` weil ältere Himmelsfassungen die Methode nicht
      // haben; dann bleibt es beim abgeleiteten Verlauf.
      lighting.sky.gibHimmelsfarben?.(bodenHimmelZenit, bodenHimmelHorizont) ?? null
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
      angriffCooldown = ANGRIFF_TAKT;
      // Die Geste ist für Waffe UND Faust dieselbe: Was der Schlag
      // anrichtet, entscheidet der Server anhand der geprüften Waffe
      // (handleAttack → WAFFEN_SCHADEN, Faust = 4). Zwei Animationen
      // hätten hier nichts zu unterscheiden; welche Hiebe der Kombo
      // laufen, entscheidet AvatarRig.schlage() selbst.
      // Mit Waffe die Hiebe, mit leerer Hand die Faeuste (Mike, 11.09.2026).
      const rechts = equipment?.rightItem;
      const satz = rechts
        ? rechts.shared.animationSet === 'staff'
          ? ('stab' as const)
          : rechts.shared.animationSet === 'spear'
            ? ('speer' as const)
            : ('schwert' as const)
        : ('faust' as const);
      // Der Slash-Halbmond gehoert zur Klinge; der Stab bekommt keinen.
      if (player.avatar.schlage(satz) && satz === 'schwert') {
        // Slash-Halbmond zur Spitze des jeweiligen Hiebs (Hand_R-Maxima
        // der drei Clips bei Tempo 2,5: 0,28 / 0,40 / 0,68 s), vor der
        // Figur in Brusthoehe; Hieb 2 ist der Querhieb von der anderen Seite.
        const hieb = player.avatar.letzterHieb;
        const verzug = [0.28, 0.4, 0.68][hieb] ?? 0.3;
        setTimeout(() => {
          const halter = equipment?.gehalten;
          if (halter) kampfEffekte.schlagBogen(halter);
        }, verzug * 1000);
      }
      socket.sendAttack(
        player.position.x,
        player.position.y,
        player.position.z,
        player.yaw,
        equipment?.rightItem?.shared.name ?? ''
      );
    }
    // Rechtsklick = Parade (10.09.2026): rein sichtbar, nach dem Vorbild
    // des Upperbody-Layers im Original (SwordParryLeft/Right/Down). Der
    // Server kennt noch keinen Block-Zustand — die Geste ist das Erste,
    // die Wirkung kommt spaeter. Nur mit Waffe in der Hand, damit die
    // leere Faust nicht mit einem unsichtbaren Schwert pariert.
    if (
      input.wasMousePressed(2) &&
      document.pointerLockElement &&
      !placement?.selectedPiece &&
      !cursorNoetig() &&
      equipment?.rightItem
    ) {
      if (player.avatar.starteAktion('parade')) socket?.sendParry();
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
        const seq = socket.sendPlayerInput(
          mv.x,
          mv.z,
          player.yaw,
          player.pitch,
          imDungeon ? player.position.y : 0,
          mv.running,
          false
        );
        // Wo standen wir, als diese Eingabe abging? Genau das braucht der
        // Abgleich, wenn der Server sie bestätigt.
        abgleicher.merkeEingabe(seq, player.position);
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
        `renderer ${engine.isWebGPU ? 'WebGPU' : 'WebGL2'}  pos ${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}  h ${player.position.y.toFixed(1)}${swimming ? ' (Wasser)' : ''}  seq ${letzterBestaetigterInputSeq}\n` +
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
  (window as unknown as Record<string, unknown>).__dbg = { scene, input, gameSettings, kampfEffekte, get post() { return post; }, get entities() { return entities; }, assets, get terrain() { return terrain; }, lighting, get player() { return player; }, get world() { return world; }, get inventory() { return inventory; }, get equipment() { return equipment; }, get placement() { return placement; }, get grass() { return grass; }, get shadows() { return shadows; }, get namensschilder() { return namensschilder; },
    // Fackeln: Helligkeit auf echter Hardware nachziehen, Notbremse von
    // Hand auslösen oder wieder lösen — s. engine/FackelLicht.ts.
    fackeln: {
      get zustand() { return `${FackelLichter.anzahl}/${FackelLichter.plaetze} plaetze, staerke ${FackelLichter.staerke}`; },
      staerke: (v: number) => { FackelLichter.staerke = v; },
      notbremse: () => fackelNotbremse('von Hand über __dbg ausgelöst'),
      notbremseLoesen: fackelNotbremseLoesen,
    },
    // AP13: Der Ende-zu-Ende-Lauf (`tools/dungeon2-e2e.mjs`) muss von aussen
    // sehen koennen, ob der Client in einer Instanz steht, und ihn wieder
    // herausschicken. Getter, keine Werte — `socket` und `imDungeon` aendern
    // sich beide waehrend des Spiels.
    // AP13: the end-to-end run must be able to see from outside whether the
    // client is inside an instance, and send it back out. Getters, not values.
    get socket() { return socket; },
    get imDungeon() { return imDungeon; },
    get dungeon2() { return dungeon2Instanz; } };
}

void main();
