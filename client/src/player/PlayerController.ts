/**
 * Phase 1/2 — local player: WASD + pointer-lock mouse look, third-person
 * boom, ground clamp via the shared heightmap (same getGroundHeight the
 * server uses for movement validation).
 *
 * Movement math matches the old client 1:1 (worldMoveX/Z below) — the
 * server simulates the player ZDO from the SAME input values we send at
 * 20 Hz, so both sides agree without reconciliation for now. Speeds match
 * Valheim: walk 4.5 m/s, run 7.5 m/s. Havok character controller replaces
 * the clamp in Phase 5.
 */
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math';
import {
  PhysicsCharacterController,
  CharacterSupportedState,
} from '@babylonjs/core/Physics/v2/characterController';
import { WATER_LEVEL } from '@wov/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { InputManager } from '../engine/InputManager';
import type { ClientWorld } from '../world/World';
import type { AssetManager } from '../engine/AssetManager';
import { AvatarRig } from './AvatarRig';

const WALK_SPEED = 4.5;
const RUN_SPEED = 7.5;
const MOUSE_SENSITIVITY = 0.0022;
const BOOM_LENGTH = 4.5;
const BOOM_MIN_PITCH = -0.9;
const BOOM_MAX_PITCH = 1.2;
const EYE_HEIGHT = 1.65;

// ── Zoom (Mausrad) ──────────────────────────────────────────────────
/** Nächster Stand — dichter heran geht nicht, sonst steckt die Kamera im Kopf. */
const BOOM_MIN = 1.5;
/** Weitester Stand. Darüber hinaus verdeckt das Gelände die Figur ohnehin. */
const BOOM_MAX = 12;
/** Weg pro Rasterklick des Rades. */
const BOOM_SCHRITT = 0.6;
/**
 * Mindestabstand der Kamera über dem Gelände.
 *
 * Beim Rauszoomen an einem Hang läuft der Ausleger sonst in den Boden und
 * die Sicht wird von innen schwarz. Die Heightmap ist hier dieselbe
 * Bezugsfläche, die auch die Kapsel klemmt (stepPhysics).
 */
const KAMERA_BODEN_ABSTAND = 0.5;

// ── Sprung ──────────────────────────────────────────────────────────
/**
 * Absprunggeschwindigkeit nach oben (m/s).
 *
 * Das Original gibt `m_jumpForce = 10.0` an (Character-MonoBehaviour,
 * extracted_assets/MonoBehaviour — derselbe Wert in allen gefundenen
 * Character-Dumps) und wendet ihn als `ForceMode.VelocityChange` an, also
 * direkt als Geschwindigkeit (Character.Jump: `jump += normalized *
 * (m_jumpForce * num2 - num4)`, danach `ForceJump` → `linearVelocity`).
 *
 * Der Wert wird 1:1 übernommen. Die dritte Größe, die dazu gehört, ist
 * Valheims Gravitation — und die ist NICHT der Unity-Default: die
 * ProjectSettings des Spiels stehen auf −20 m/s² (PhysicsManager.json,
 * `m_Gravity.m_Y = -20`, siehe GRAVITY unten). Der Charakter hat keine
 * eigene Fallbeschleunigung, er läuft mit `m_body.useGravity = true` in
 * genau dieser Weltgravitation.
 *
 * Zusammen ergibt das eine Scheitelhöhe von v²/2g = 100/40 = 2.5 m bei
 * 1.0 s Flugzeit. Mit dem vorher hier stehenden Ersatzwert 6.26 gegen
 * 9.81 m/s² kamen zwar ähnliche 2 m heraus, aber in 1.28 s — dieselbe
 * Höhe in längerer Zeit ist genau das, was sich wie zu geringe
 * Schwerkraft anfühlt. Nicht die Sprunghöhe war falsch, sondern das
 * Tempo, mit dem sie durchlaufen wird.
 */
const JUMP_SPEED = 10;
/**
 * Wie lange nach dem Absprung der Bodenkontakt ignoriert wird (s).
 *
 * Ohne das erstickt der Sprung im nächsten Frame: Die Kapsel hat sich noch
 * kaum bewegt, `checkSupport` meldet weiterhin Bodenkontakt, und der Zweig
 * unten setzt die Vertikalgeschwindigkeit auf 0.
 */
const SPRUNG_SPERRE = 0.15;
/**
 * Ab dieser Fallgeschwindigkeit (m/s) gilt die Figur als abgestürzt und
 * bekommt die Sprunganimation, auch ohne eigenen Absprung — etwa beim
 * Treten über eine Kante. Bei 20 m/s² ist das nach 0,2 s freiem Fall
 * erreicht; kurzes Abheben an einer Geländekante bleibt darunter.
 */
const FALL_SCHWELLE = 4;

// ── Physics body (C# Character: Rigidbody + CapsuleCollider) ─────────
/** Capsule radius — a Viking is about 0.4 m wide at the shoulders. */
const BODY_RADIUS = 0.4;
/** Capsule height, matching EYE_HEIGHT plus a bit of head. */
const BODY_HEIGHT = 1.8;
/**
 * Endgeschwindigkeit im freien Fall (m/s). Begrenzt, damit die Kapsel bei
 * einem Bildraten-Einbruch nicht in einem einzigen Frame durch das
 * Terrain-Mesh hindurchspringt.
 *
 * Mit der Weltgravitation von 20 m/s² wäre die alte Grenze von 20 m/s
 * schon nach 10 m Fallhöhe erreicht — bei einem Sturz vom Berg hätte man
 * die Bremse deutlich gesehen. 40 m/s greift erst nach 40 m und ist als
 * Tunnelschutz noch reichlich: selbst bei 30 fps sind das 1.3 m pro
 * Frame, unter der Kapselhöhe.
 */
const MAX_FALL_SPEED = 40;
/**
 * Erdbeschleunigung (m/s²) — wie in Physics.ts.
 *
 * NICHT der Unity-Default 9.81: Valheim stellt die Weltgravitation in den
 * ProjectSettings auf −20 (`m_Gravity.m_Y` in PhysicsManager.json des
 * AssetRipper-Exports). Alles, was fällt, fällt im Original doppelt so
 * schnell wie auf der Erde.
 */
const GRAVITY = new Vector3(0, -20, 0);
/**
 * Flugdauer eines ungestörten Sprungs (s): Steigen und Fallen dauern
 * gleich lang, also 2·v/g.
 */
const FLUGZEIT = (2 * JUMP_SPEED) / Math.abs(GRAVITY.y);
/**
 * Wie schnell sich die Figur in ihre Laufrichtung dreht (rad/s).
 *
 * Aus dem Original übernommen: `Character.m_turnSpeed = 300` Grad/s, und
 * `m_runTurnSpeed` steht auf demselben Wert — Rennen dreht also nicht
 * anders als Gehen. Bei 300°/s ist eine Kehrtwende nach 0,6 s vollzogen:
 * schnell genug, dass die Steuerung direkt wirkt, langsam genug, dass die
 * Drehung als Bewegung sichtbar wird statt zu springen.
 */
const TURN_SPEED = (300 * Math.PI) / 180;
const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);

export class PlayerController {
  readonly camera: UniversalCamera;
  readonly position = new Vector3(0, 0, 0);
  private _yaw = 0;
  private _pitch = 0.25;
  /**
   * Blickrichtung der FIGUR — getrennt vom Kamera-Yaw.
   *
   * Bis hierher trug die Figur `_yaw` direkt, drehte sich also bei jeder
   * Mausbewegung mit. Jetzt kreist die Kamera im Stand um eine stehende
   * Figur; erst beim Losgehen dreht sie sich in die Laufrichtung.
   *
   * So macht es auch das Original: `Character.UpdateRotation` nimmt als
   * Ziel `Quaternion.LookRotation(m_moveDir)`, sobald ein Bewegungswunsch
   * anliegt — die Figur schaut also dorthin, wo sie hinläuft, und nicht
   * starr dorthin, wo die Kamera hinsieht.
   */
  private _figurYaw = 0;
  private _moveIntent = { x: 0, z: 0, running: false };
  /** Aktueller Kameraabstand — vom Mausrad zwischen BOOM_MIN und BOOM_MAX bewegt. */
  private boomLength = BOOM_LENGTH;
  /**
   * Zoom-Sperre für den Baumodus.
   *
   * Das Rad ist doppelt belegt: Es zoomt die Kamera UND wählt im Baumenü
   * das Stück beziehungsweise stellt den Radius. `consumeWheel()` leert den
   * Puffer, es kann also nur einer gewinnen — und dieser Controller läuft in
   * main.ts VOR dem PlacementController. Ohne diese Rückfrage bekäme der
   * Baumodus nie ein Rad-Ereignis zu sehen.
   */
  zoomErlaubt: (() => boolean) | null = null;
  /**
   * Phase G: in einer Dungeon-Instanz gibt es keine Heightmap — Böden und
   * Treppen sind Mesh-Collider der Räume. Alle Heightmap-Klemmen (Boden-
   * Untergrenze, Kamerahöhe, Fallback ohne Havok) sind dann abgeschaltet.
   */
  dungeonMode = false;
  /** Rückholpunkt, falls die Figur in der Instanz durchs Nichts fällt. */
  private dungeonAnker = new Vector3(0, 0, 0);
  /**
   * Physik-Raycast nach unten (main.ts → bodenHoeheUnter): Höhe des nächsten
   * Kollisionskörpers unter der Figur, oder null. Im Dungeon die einzige
   * Wahrheit über "trägt mich hier etwas" — die Raum-GLBs laden asynchron.
   */
  bodenSonde: ((x: number, y: number, z: number) => number | null) | null = null;
  /** Letzte Stelle MIT Boden unter den Füssen — Ziel der Dungeon-Rettung. */
  private letzteSichere = new Vector3(0, 0, 0);
  /** Gehaltene Höhe, solange unter der Figur noch kein Collider liegt. */
  private dungeonHalteY = 0;
  /**
   * Nach einem Instanz-Teleport eingefroren, bis die Raum-Collider stehen
   * (main.ts prüft EntityManager.colliderNahe): Die GLBs des Dungeons
   * laden asynchron, und ohne Boden fiele die Figur sofort ins Leere.
   */
  frozen = false;
  /** Auf true gesetzt, sobald die Leertaste gedrückt wurde; von stepPhysics geleert. */
  private sprungWunsch = false;
  /** Restzeit der Absprungsperre (s) — siehe SPRUNG_SPERRE. */
  private sprungSperre = 0;
  /**
   * Restdauer der Sprungphase (s).
   *
   * Warum ein Timer und keine Höhenabfrage: Der naheliegende Weg — "in der
   * Luft, wenn die Kapsel über der Heightmap steht" — ist an dieser Stelle
   * unbrauchbar. Nachgemessen am 2026-08-01 schwebt die Kapsel beim
   * normalen Laufen im Median 0,25 m über dem Heightmap-Wert (Maximum 0,70,
   * im Stand 0,145), weil der Havok-Kollider auf dem Kollisionsnetz
   * aufsitzt und nicht auf der interpolierten Höhe. In 90 % der Frames lag
   * sie damit über der Bodentoleranz und galt fälschlich als fliegend —
   * die Sprunganimation blieb nach der Landung hängen und die Figur stand
   * in ihrer Landepose zusammengesackt da.
   *
   * Die Flugdauer ist dagegen exakt bekannt (FLUGZEIT) und deckt sich mit
   * der Zeit, auf die der Sprungclip gestreckt wird.
   */
  private flugRest = 0;
  /** Ob die Figur gerade keinen Boden unter sich hat — steuert die Sprunganimation. */
  private inDerLuft = false;
  /** Public so Equipment can attach a held tool to the rig's hand node. */
  readonly avatar: AvatarRig;
  private readonly assets: AssetManager | null;

  constructor(
    scene: Scene,
    private readonly input: InputManager,
    private readonly world: ClientWorld,
    assets?: AssetManager
  ) {
    this.assets = assets ?? null;
    this.camera = new UniversalCamera('playerCam', new Vector3(0, 40, -BOOM_LENGTH), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 4000;
    this.camera.fov = 1.05; // ~60°

    // spawn at world origin on the ground (server spawn for new players, D6)
    this.position.set(0, this.world.getGroundHeight(0, 0), 0);

    // Third-Person-Figur. Es wird bewusst KEIN GLB mehr geladen: die
    // Spieler-Assets im Export sind nachweislich unbrauchbar (Player.glb
    // hat 0 Meshes, PlayerUnarmed.glb ist ein 0,14 m hohes Prop-Fragment
    // mit "woodwall"-Material und 0-Byte-Textur) und keine der 7.471 GLBs
    // enthält Skin- oder Animationsdaten. Details und der Weg zurück zu
    // einem echten Modell: AvatarRig.ts (Kopfkommentar).
    this.avatar = new AvatarRig(scene);
    // Flugdauer eines Sprungs: Steigen und Fallen dauern gleich lang, also
    // 2·v/g. Der Sprungclip wird darauf gestreckt, damit die Landepose mit
    // dem Aufsetzen zusammenfällt.
    this.avatar.setSprungDauer((2 * JUMP_SPEED) / Math.abs(GRAVITY.y));
  }

  // ── Physics ──────────────────────────────────────────────────────
  //
  // C# Character carries a Rigidbody plus a CapsuleCollider and lets PhysX
  // resolve contacts (Character.cs:234/236). Same arrangement on Havok: the
  // capsule is driven by setting its horizontal velocity, gravity and every
  // collision response come from the engine — which is what makes a tree
  // actually stop you, including sliding along it, without re-inventing any
  // of that by hand.

  private controller: PhysicsCharacterController | null = null;
  private lastSupport = -1;

  /**
   * An eine Stelle setzen und in eine Richtung schauen.
   *
   * Zwei Nutzer: die Kollisionsprüfungen der Playwright-Proben und der
   * Admin-Teleport per Strg+Klick auf der Karte (WorldMap.teleportAn).
   *
   * Die Höhe ist mindestens die Wasserlinie — sonst landet man beim Klick
   * aufs Meer auf dem Grund statt schwimmend an der Oberfläche. Der
   * server-autoritative Gegenpart (`AdminCommands`, Befehl `teleport`)
   * rechnet genauso; liefen die beiden auseinander, gäbe es nach jedem
   * Sprung eine sichtbare Korrektur.
   */
  debugTeleport(x: number, z: number, yaw: number): void {
    const y = Math.max(this.world.getGroundHeight(x, z), WATER_LEVEL);
    this.position.set(x, y, z);
    this._yaw = yaw;
    this._figurYaw = yaw;
    this.controller?.setPosition(new Vector3(x, y + BODY_HEIGHT / 2, z));
    this.controller?.setVelocity(Vector3.Zero());
  }

  /**
   * Harter Positions-Sprung mit EXPLIZITER Höhe (Dungeon-Betreten/Verlassen,
   * PacketType.Teleport vom Server). Anders als debugTeleport wird die Höhe
   * nicht aus der Heightmap abgeleitet — in der Instanz gibt es keine.
   */
  teleportTo(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.dungeonAnker.set(x, y, z);
    this.letzteSichere.set(x, y, z);
    this.dungeonHalteY = y;
    this.controller?.setPosition(new Vector3(x, y + BODY_HEIGHT / 2, z));
    this.controller?.setVelocity(Vector3.Zero());
  }

  /** Diagnose: Zustand des Spielerkörpers. */
  get bodyInfo(): Record<string, unknown> | null {
    if (!this.controller) return null;
    const v = this.controller.getVelocity();
    const p = this.controller.getPosition();
    return {
      art: 'PhysicsCharacterController',
      gestuetzt: this.lastSupport,
      position: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      geschwindigkeit: { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) },
    };
  }

  /**
   * Attach the physics character. Call once initPhysics() has resolved.
   *
   * Havok's PhysicsCharacterController rather than a plain rigid body: a
   * dynamic body whose velocity is overwritten every frame keeps pushing
   * INTO whatever the solver just pushed it out of, so the capsule creeps
   * through trunks (measured: 0.28 m from a 0.55 m trunk centre, i.e. 0.69 m
   * inside it). The controller integrates the desired velocity WITH the
   * contacts instead — which is the same division of labour Unity's
   * CharacterController gives Valheim.
   */
  enablePhysics(scene: Scene): void {
    if (this.controller) return;
    this.controller = new PhysicsCharacterController(
      new Vector3(this.position.x, this.position.y + BODY_HEIGHT / 2, this.position.z),
      { capsuleHeight: BODY_HEIGHT, capsuleRadius: BODY_RADIUS },
      scene
    );
    // Babylons Vorgabe ist acceleration = 0.05 — der Controller nähert sich
    // der Zielgeschwindigkeit damit extrem träge an. Auf ebenem Boden fällt
    // das kaum auf, an einer Steigung arbeitet die Schwerkraft dagegen und
    // der Charakter kommt gar nicht erst in Fahrt: gemessen 1,1 m in 4 s an
    // einem 37-%-Hang statt der vollen 18 m. Valheim beschleunigt praktisch
    // sofort, deshalb hier ein Vielfaches davon.
    this.controller.acceleration = 8;
    // Steigungsgrenze wie in Valheim: etwa 40° sind noch begehbar, steiler
    // rutscht man ab (Babylon-Vorgabe wären 60°).
    this.controller.maxSlopeCosine = Math.cos((40 * Math.PI) / 180);
  }

  /**
   * Drive the capsule for one frame.
   *
   * Horizontal velocity is the DESIRED value — the controller resolves it
   * against the contacts. Vertical motion stays with gravity so slopes and
   * steps keep working.
   */
  private stepPhysics(wx: number, wz: number, moving: boolean, speed: number, dt: number): void {
    const c = this.controller!;
    const support = c.checkSupport(dt, DOWN);
    this.lastSupport = support.supportedState;

    // Wunschgeschwindigkeit DIREKT setzen statt über calculateMovement().
    //
    // Der Helfer glättet die Geschwindigkeit über `acceleration` an die
    // Zielvorgabe heran und kam dabei nicht einmal auf ebenem Boden an:
    // gemessen 8,8 m in 4 s statt der vollen 18 m, an einer 20°-Steigung
    // nur 0,5 m. Das Hochprojizieren auf die Hangfläche übernimmt
    // integrate() ohnehin selbst — es braucht nur eine ehrliche
    // horizontale Vorgabe.
    //
    // Vertikal: bei Bodenkontakt keine Altlast mitschleppen (daher kam das
    // Abheben an Steigungen), in der Luft die Fallgeschwindigkeit
    // fortschreiben.
    // Rutschen zählt als Bodenkontakt, nicht als freier Fall: Wer an einem
    // zu steilen Hang abrutscht, berührt den Boden trotzdem. Valheim führt
    // dafür ein eigenes `m_groundContact`, das ebenfalls beide Fälle deckt.
    // Ohne das summiert sich an jeder Steigung Fallgeschwindigkeit auf.
    const supported = support.supportedState !== CharacterSupportedState.UNSUPPORTED;
    const current = c.getVelocity();

    // ── Sprung ──────────────────────────────────────────────────────
    // Absprungfreigabe ist NICHT `checkSupport`: Gemessen am 2026-08-01
    // meldet der Havok-Kollider am Spawn dauerhaft UNSUPPORTED
    // (`bodyInfo.gestuetzt = 0`), obwohl die Figur sichtbar auf dem Boden
    // steht — dasselbe Verhalten, das weiter unten die Heightmap-Klemme
    // nötig macht. Ein Sprung, der daran hängt, löst nie aus.
    //
    // Sie ist aber auch NICHT die Höhe über der Heightmap. Das war der
    // erste Anlauf und ging aus demselben Grund schief wie bei der
    // Sprungphase (siehe flugRest): Beim Laufen schwebt die Kapsel im
    // Median 0,25 m über dem Heightmap-Wert, also über jeder brauchbaren
    // Toleranz — der Sprung löste beim Gehen in der Hälfte der Versuche
    // nicht aus, beim Rennen dagegen immer, weil dort der Kollider trägt.
    //
    // Maßgeblich ist stattdessen der Flugzustand: Wer nicht gerade
    // springt oder fällt, steht. Dieselbe Größe steuert die Animation,
    // damit können Bild und Physik nicht auseinanderlaufen. Sie stammt aus
    // dem Vorframe — ein Frame Verzug ist bei 0,15 s Absprungsperre
    // bedeutungslos.
    //
    // Der Wunsch wird IMMER geleert, auch wenn gerade nicht gesprungen
    // werden darf: Sonst löst ein Tastendruck im Fall den Sprung
    // nachträglich bei der Landung aus.
    const aufBoden = !this.inDerLuft;
    this.sprungSperre = Math.max(0, this.sprungSperre - dt);
    const springt = this.sprungWunsch && aufBoden && this.sprungSperre === 0;
    this.sprungWunsch = false;
    if (springt) this.sprungSperre = SPRUNG_SPERRE;
    // Der Nullsetz-Zweig bleibt an `supported` gebunden — er soll das
    // bisherige Verhalten an Hängen nicht verändern, sondern nur einen
    // laufenden Absprung nicht abwürgen.
    const amBoden = supported && this.sprungSperre === 0;

    const velocity = new Vector3(
      moving ? wx * speed : 0,
      // Fallgeschwindigkeit begrenzen: Ungebremst legt die Kapsel bei einem
      // Bildraten-Einbruch mehr Strecke pro Frame zurück, als das
      // Terrain-Mesh dick ist, und fällt hindurch (gemessen am 2026-07-30:
      // −7,5 m/s nach 0,8 s freiem Fall, bei 8 fps knapp 1 m pro Frame).
      springt ? JUMP_SPEED : amBoden ? 0 : Math.max(-MAX_FALL_SPEED, current.y + GRAVITY.y * dt),
      moving ? wz * speed : 0
    );
    c.setVelocity(velocity);
    c.integrate(dt, support, GRAVITY);

    const p = c.getPosition();
    this.position.set(p.x, p.y - BODY_HEIGHT / 2, p.z);

    // ── Boden aus der Heightmap als Untergrenze ──────────────────────
    //
    // Der Havok-Kollider ist nicht überall verlässlich: Gemessen am
    // 2026-07-30 meldete `checkSupport` an JEDER geprüften Stelle
    // UNSUPPORTED, und am Spawn (0,0) sackte die Kapsel im Sekundentakt
    // 3 m durch den sichtbaren Boden, bis die Rettung sie zurücksetzte —
    // das war das im Bild sichtbare "Springen".
    //
    // Die Heightmap ist ohnehin die maßgebliche Fläche: Der Server
    // validiert Bewegung gegen dieselben Werte, und der Zweig ohne Havok
    // (unten) klemmt bereits genauso. Sie greift NUR nach oben — steht der
    // Spieler auf einem Haus oder Felsen, liegt er über dem Gelände und
    // bleibt unangetastet; dort trägt ihn weiterhin der Kollider.
    //
    // Damit ist die frühere Rettung nach 3 m Durchsacken abgelöst: Sie
    // liess genau das Sägezahn-Springen zu, das sie verhindern sollte.
    if (!this.dungeonMode) {
      const ground = this.world.getGroundHeight(this.position.x, this.position.z);
      if (this.position.y < ground) {
        this.position.y = ground;
        c.setPosition(new Vector3(p.x, ground + BODY_HEIGHT / 2, p.z));
        const v = c.getVelocity();
        // Nur den Fall stoppen — die horizontale Fahrt behält der Spieler.
        if (v.y < 0) c.setVelocity(new Vector3(v.x, 0, v.z));
      }
    } else {
      // ── Dungeon: Boden-Sicherung über die Physik-Sonde ──────────────
      //
      // Die Raum-Collider entstehen asynchron (GLB-Fetch + Bucket-Aufbau)
      // und nur im Kollisionsfenster um den Spieler. Wer schneller läuft
      // als sie laden, stand früher über dem Nichts, fiel 80 m und wurde
      // zum EINGANG zurückgeholt — gemeldet als "wenn ich weglaufe,
      // spawne ich immer wieder im Eingangsbereich" (2026-08-03).
      //
      // Neu: Fehlt unter der Figur jeder Körper, wird die Höhe schlicht
      // GEHALTEN — man geht auf unsichtbarem Boden weiter, bis der Raum
      // da ist, dann übernimmt wieder die normale Schwerkraft. Kein Sturz,
      // kein Teleport, selbstheilend.
      const boden = this.bodenSonde ? this.bodenSonde(p.x, this.position.y, p.z) : null;
      if (boden === null) {
        this.position.y = this.dungeonHalteY;
        c.setPosition(new Vector3(p.x, this.dungeonHalteY + BODY_HEIGHT / 2, p.z));
        const v = c.getVelocity();
        if (v.y < 0) c.setVelocity(new Vector3(v.x, 0, v.z));
      } else {
        this.dungeonHalteY = this.position.y;
        // Sichere Stelle nur im Stand auf dem Boden merken — nicht mitten
        // im Fall über einer Grube, sonst rettete die Rettung ins Loch.
        if (this.position.y - boden < 2) {
          this.letzteSichere.set(this.position.x, this.position.y, this.position.z);
        }
      }
      // Letztes Netz (Sonde nicht verfügbar oder legitimer Absturz in eine
      // Grube): zurück zur letzten sicheren Stelle statt zum Eingang.
      if (this.position.y < this.dungeonAnker.y - 80) {
        this.teleportTo(this.letzteSichere.x, this.letzteSichere.y, this.letzteSichere.z);
      }
    }

    // ── Sprungphase für die Animation ───────────────────────────────
    // Läuft über die bekannte Flugdauer ab (siehe flugRest), nicht über
    // die Höhe über Grund.
    this.flugRest = Math.max(0, this.flugRest - dt);
    if (springt) this.flugRest = FLUGZEIT;
    const vEnde = c.getVelocity().y;
    // Vorzeitige Landung, etwa auf einem Felsvorsprung: Der Kollider trägt
    // wieder und es geht nicht mehr aufwärts. Erst nach der halben
    // Flugzeit geprüft — im Absprungframe meldet er noch Bodenkontakt.
    if (this.flugRest > 0 && this.flugRest < FLUGZEIT * 0.5 && supported && vEnde <= 0) {
      this.flugRest = 0;
    }
    // Sturz ohne eigenen Absprung — über eine Kante getreten.
    const stuerzt = !supported && vEnde < -FALL_SCHWELLE;
    this.inDerLuft = this.flugRest > 0 || stuerzt;
  }

  /** Nur für Messungen: ob die Sprunganimation gerade laufen soll. */
  get inLuft(): boolean { return this.inDerLuft; }


  get yaw(): number { return this._yaw; }
  get pitch(): number { return this._pitch; }
  /** World-space move intent (same values sent to the server). */
  get moveIntent(): { x: number; z: number; running: boolean } { return this._moveIntent; }

  /** dt in seconds. */
  update(dt: number): void {
    const [dx, dy] = this.input.consumeMouseDelta();
    // dx>0 = mouse moved right → look right → yaw increases (verified via
    // the forward/right basis below: increasing yaw sweeps `forward` from
    // -Z towards -X, which is this camera's right-hand side at yaw=0).
    this._yaw += dx * MOUSE_SENSITIVITY;
    this._pitch = Math.min(BOOM_MAX_PITCH, Math.max(BOOM_MIN_PITCH, this._pitch + dy * MOUSE_SENSITIVITY));

    // input axes: x = A(-1)..D(+1), z = S(-1)..W(+1)
    let mx = 0;
    let mz = 0;
    if (this.input.isDown('KeyW')) mz += 1;
    if (this.input.isDown('KeyS')) mz -= 1;
    if (this.input.isDown('KeyA')) mx -= 1;
    if (this.input.isDown('KeyD')) mx += 1;

    const running = this.input.isDown('ShiftLeft');
    const speed = running ? RUN_SPEED : WALK_SPEED;

    // Leertaste als FLANKE, nicht als Dauerzustand: Gedrückthalten soll nicht
    // bei jeder Landung erneut abheben lassen.
    if (this.input.wasPressed('Space')) this.sprungWunsch = true;

    // Mausrad zoomt den Ausleger — solange der Baumodus es nicht braucht.
    if (!this.zoomErlaubt || this.zoomErlaubt()) {
      const rad = this.input.consumeWheel();
      if (rad !== 0) {
        // Nur das Vorzeichen zählt. Die Rohwerte von `deltaY` unterscheiden
        // sich je nach Browser und Gerät um Größenordnungen (Pixel, Zeilen,
        // Seiten) — ein Rasterklick soll überall gleich weit zoomen.
        const schritt = Math.sign(rad) * BOOM_SCHRITT;
        this.boomLength = Math.min(BOOM_MAX, Math.max(BOOM_MIN, this.boomLength + schritt));
      }
    }

    // old-client mapping (server runs the same math on these values):
    // forward = (-sin yaw, -cos yaw), right = (-cos yaw, sin yaw)
    const sinY = Math.sin(this._yaw);
    const cosY = Math.cos(this._yaw);
    let wx = -mx * cosY - mz * sinY;
    let wz = mx * sinY - mz * cosY;
    const moving = mx !== 0 || mz !== 0;
    if (moving) {
      const len = Math.hypot(wx, wz);
      wx /= len;
      wz /= len;
    }
    this._moveIntent = { x: wx, z: wz, running };

    if (this.frozen) {
      // Warten auf die Raum-Collider: Position und Kapsel festhalten, kein
      // Bewegungswunsch an den Server (sonst liefe er ohne uns los).
      this._moveIntent = { x: 0, z: 0, running: false };
      this.controller?.setPosition(
        new Vector3(this.position.x, this.position.y + BODY_HEIGHT / 2, this.position.z)
      );
      this.controller?.setVelocity(Vector3.Zero());
    } else if (this.controller) {
      this.stepPhysics(wx, wz, moving, speed, dt);
    } else {
      // Before Havok is up: move freely and clamp to the heightmap — the
      // nearest-vertex rule the server validates against.
      if (moving) {
        this.position.x += wx * speed * dt;
        this.position.z += wz * speed * dt;
      }
      // Im Dungeon gibt es keine Heightmap — Höhe halten, bis Havok trägt.
      if (!this.dungeonMode) {
        this.position.y = this.world.getGroundHeight(this.position.x, this.position.z);
      }
    }

    // third-person boom: behind the player opposite the look direction
    const cp = Math.cos(this._pitch);
    const forwardX = -sinY;
    const forwardZ = -cosY;
    const eye = this.position.add(new Vector3(0, EYE_HEIGHT, 0));
    const boom = this.boomLength;
    const camX = eye.x - forwardX * cp * boom;
    const camZ = eye.z - forwardZ * cp * boom;
    // Kamera nicht unter das Gelände sinken lassen (siehe KAMERA_BODEN_ABSTAND).
    // Im Dungeon gilt die Klemme nicht — die Heightmap dort ist bedeutungslos.
    const camBoden = this.dungeonMode
      ? -Infinity
      : this.world.getGroundHeight(camX, camZ) + KAMERA_BODEN_ABSTAND;
    this.camera.position = new Vector3(
      camX,
      Math.max(camBoden, eye.y + Math.sin(this._pitch) * boom),
      camZ
    );
    this.camera.setTarget(eye);

    // ── Figur ausrichten ─────────────────────────────────────────────
    // Nur wenn ein Bewegungswunsch anliegt; im Stand bleibt sie stehen und
    // die Kamera kreist um sie herum. Ziel ist die LAUFRICHTUNG (wx, wz),
    // nicht die Kamerarichtung — beim Geradeauslaufen ist das dasselbe
    // (man läuft zum Fadenkreuz), beim seitlichen Ausweichen dreht sich
    // die Figur dorthin, wo sie tatsächlich hingeht, und läuft damit immer
    // vorwärts. Das entspricht `LookRotation(m_moveDir)` im Original.
    if (moving) {
      // Umkehrung der Basis oben: forward = (-sin yaw, -cos yaw).
      const zielYaw = Math.atan2(-wx, -wz);
      // Differenz auf [-π, π] bringen, damit über den kürzeren Weg gedreht
      // wird — sonst nimmt die Figur bei einer Kehrtwende den Umweg.
      const roh = zielYaw - this._figurYaw;
      const diff = Math.atan2(Math.sin(roh), Math.cos(roh));
      const schritt = TURN_SPEED * dt;
      this._figurYaw += Math.abs(diff) <= schritt ? diff : Math.sign(diff) * schritt;
    }

    const rig = this.avatar.root;
    rig.position.set(this.position.x, this.position.y, this.position.z);
    // model forward is +Z; look forward is (-sin yaw, -cos yaw)
    rig.rotation.setAll(0);
    rig.rotation.y = this._figurYaw + Math.PI;
    // Laufzyklus: tatsächlich zurückgelegte Horizontalstrecke pro Sekunde,
    // nicht die Wunschgeschwindigkeit — steht die Figur (kein Input), läuft
    // auch die Animation aus. `running` wählt zwischen Geh- und Rennzyklus.
    this.avatar.update(dt, moving ? speed : 0, RUN_SPEED, running, this.inDerLuft);
  }
}
