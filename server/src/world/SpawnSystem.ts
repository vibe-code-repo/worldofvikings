/**
 * SpawnSystem (Phase G2) — server-side creature spawning + wander behavior.
 *
 * There is NO reference implementation for this system: in the original
 * architecture the owning client runs the spawning, the reference server
 * only replicates the resulting creature ZDOs. Our browser
 * architecture has no privileged client, so spawning lives server-side
 * here, driven by the AUTHORED table in shared/spawnData.ts (no vanilla
 * reference data exists — documented in Bekannte Einschränkungen #26).
 *
 * Lifecycle per update():
 *  1. Despawn: creatures with no player within despawnRadius are destroyed
 *     (destroy list auto-broadcasts at the next ZDO sync).
 *  2. Spawn rolls: one accumulator per table entry; on expiry one roll per
 *     player (chance → caps → ring anchor → gates: zone generated, biome,
 *     ground above water → group scatter → createZDO).
 *  3. Simulation: creatures with a player within simRadius run a small
 *     state machine (idle → walk to wander target; deer flee from close
 *     players). Positions integrate every tick; the ZDO data revision is
 *     bumped only every syncIntervalSec (4 Hz) — the revision compare in
 *     syncZDOs is the authoritative resend gate, so this throttles
 *     bandwidth without touching the movement granularity.
 *
 * Determinism: simTime is the only clock; inject a seeded XorShiftRandom
 * via options for reproducible tests (reference parity: the original client-side
 * spawning is not world-deterministic either — same as randomRotation).
 *
 * Persistence: creature prefabs carry PERSISTENT in the pkg, so spawned
 * ZDOs flow into the G1 save automatically. adoptPersisted() (called after
 * loadWorld) re-registers restored creatures so they simulate/despawn
 * correctly after a restart instead of accumulating forever.
 */

import type { Hash, Vector3, Quaternion } from '@wov/shared';
import {
  GeoManager,
  RegionGeo,
  HeightmapProvider,
  XorShiftRandom,
  getStableHash,
  SPAWN_TABLE,
  SPAWN_DESPAWN_RADIUS,
  SPAWN_SIM_RADIUS,
  SPAWN_SYNC_INTERVAL_SEC,
  HEALTH_MEMBER,
  ANIM_MEMBER,
  ANIM_EINMAL_MEMBER,
  maxLeben,
  istEigenesModell,
  naechstesEinmal,
  pruefeClips,
  kiSchritt,
  kiReiz,
  kiLaerm,
  kiRuf,
  kiDarfRufen,
  hoert,
  neuerKiZustand,
  type KiZustand,
  type KiSteckbrief,
  type KiZiel,
  type KiBefehl,
  type SpawnEntry,
  type KreaturAnim,
  type EinmalClip,
} from '@wov/shared';
import { gleitBewegung } from '@wov/shared/src/bewegung/gleiten.js';
import { KI_VORGABE, steckbriefFuer } from '../spiel/KreaturenSteckbriefe.js';
import type { Kollisionswelt } from './Kollisionswelt.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZoneManager } from './ZoneManager.js';
import { gibAnim, nimmAnim } from './AnimBesitz.js';

export interface SpawnSystemOptions {
  /** Table override for tests (defaults to SPAWN_TABLE). */
  table?: readonly SpawnEntry[];
  /** RNG override for deterministic tests (default: time-seeded). */
  rng?: XorShiftRandom;
  despawnRadius?: number;
  simRadius?: number;
  syncIntervalSec?: number;
  /**
   * NUR FÜR TESTS (Server und Konfiguration setzen sie nicht): Werte des
   * KI-Steckbriefs, die für alle aggressiven Kreaturen dieses Systems
   * überschrieben werden, um einen Wert zu isolieren, etwa den Rückzug.
   */
  kiUeberschreibung?: Partial<KiSteckbrief>;
}

type CreatureMode = 'idle' | 'walk' | 'flee' | 'chase';

interface CreatureState {
  readonly zdo: ZDO;
  readonly entry: SpawnEntry;
  /** Wander anchor (spawn point / adoption position). */
  home: Vector3;
  mode: CreatureMode;
  /** Current walk target (walk mode). */
  target: Vector3;
  /** simTime until which the idle pause lasts. */
  idleUntil: number;
  /** Accumulator for the 4 Hz revision throttle. */
  syncAccum: number;
  /** Angriffstakt im Chase-Modus (s seit letztem Schlag). */
  attackAccum?: number;
  /** Last animation state written to the ZDO (`entry.clips` only). */
  anim?: KreaturAnim;
  /** simTime at which a slain creature is removed (the `die` clip is playing). */
  stirbtBis?: number;
  /** KI-Zustandsmaschine (nur aggressive Kreaturen) und ihr Steckbrief. */
  ki?: KiZustand;
  steck?: KiSteckbrief;
  /** Kollisionsradius des Körpers (Steckbrief, sonst 0,4). */
  radius?: number;
  /** Weg des letzten Schritts — die Strecke der Verfolgung. */
  gelaufen?: number;
  /** Der Heimatpunkt wurde gegen die Formen geprüft (einmal, beim ersten Schritt). */
  ankerGeprueft?: boolean;
  /** Wo die Kreatur aufgenommen wurde (Spawn, Adoption): Ein neuer Anker bleibt in ihrer Leine. */
  ursprung?: Vector3;
  /** Aus dem Spiel nehmen (kein Ausweg aus dem Fels): der nächste Schritt räumt sie ab. */
  entfernen?: boolean;
}

/** Ein Angreifer, wie das Spawnsystem ihn kennt: Kennung und Schaden. */
export interface SpawnAngreifer {
  readonly id: string;
  readonly schaden: number;
}

/** Kennung und Blickrichtung eines Ziels (parallel zur Zielliste). */
export interface SpawnZielInfo {
  readonly id: string;
  /** Gierwinkel des Blicks (forward = (−sin, −cos)) oder null. */
  readonly blick: number | null;
}

/**
 * Pick the clip to play for a wanted state: the state itself if the model
 * ships it, else the nearest cheaper one (attack -> run -> walk -> idle).
 */
function waehleClip(clips: readonly string[], wunsch: KreaturAnim): KreaturAnim {
  const kette: readonly KreaturAnim[] =
    wunsch === 'attack' ? ['attack', 'run', 'walk', 'idle']
    : wunsch === 'run' ? ['run', 'walk', 'idle']
    : wunsch === 'walk' ? ['walk', 'idle']
    : ['idle'];
  const treffer = kette.find((z) => clips.includes(z));
  // No silent 'idle' here: a state the model does not ship freezes the animal
  // on the client (the group is not found, all groups stop). `pruefeClips`
  // demands 'idle' in every list, so this is a bug guard, not a normal path.
  if (treffer === undefined) {
    throw new Error(
      `[spawns] no clip for '${wunsch}' in [${clips.join(', ')}] — the list must contain 'idle'`
    );
  }
  return treffer;
}

/**
 * Zweite Verteidigungslinie hinter `bauSpawnTabelle()` (shared/spawnData.ts).
 *
 * Die erste Filterung sitzt dort, wo SPAWN_TABLE entsteht — das ist die
 * eine Stelle je Tabelle. Sie deckt aber nur die eine Tabelle ab: Das
 * SpawnSystem nimmt ueber `SpawnSystemOptions.table` beliebige Eintraege
 * entgegen (Tests, kuenftige Layout-Tabellen), und createZDO fragt nicht
 * nach, ob es zu dem Hash je ein Modell gab. Ein Wesen ohne Modell ist
 * fuer den Spieler eine unsichtbare Kollision, die zuschlaegt — der
 * Fehler, der am schwersten zu deuten ist.
 *
 * Nicht still: Wer eine Tabelle injiziert und nichts spawnen sieht, soll
 * im Log lesen koennen, warum.
 */
function nurEigeneModelle(tabelle: readonly SpawnEntry[]): readonly SpawnEntry[] {
  const liste = tabelle.filter((e) => istEigenesModell(e.prefab));
  const uebersprungen = tabelle.length - liste.length;
  if (uebersprungen > 0) {
    console.warn(
      `[spawns] ${uebersprungen} von ${tabelle.length} Eintraegen ohne eigenes Modell uebersprungen`
    );
  }
  return liste;
}

const TWO_PI = Math.PI * 2;
/** Arrival tolerance for wander targets (meters). */
const ARRIVE_DIST = 0.4;

/**
 * Wolfsbalance (27.09.2026): how many aggro creatures may run their own
 * strike timer against the SAME nearest player at once. Without this, a
 * pack that spawns as up to 4 overlapping wolves (maxPerPlayer 3 + a group
 * of 2, see spawnData.ts) all struck independently every 2 s — a starter
 * player measured 24 damage in 9 s from three at once (Befund, Karte
 * Wolfsbalance). The cap holds regardless of how many creatures cluster
 * nearby: extras stay in melee range (still shown attacking, cosmetic
 * only) but do not accumulate a strike timer until a slot frees up (a
 * ranked creature dies or loses aggro). Ranking is by ZDO id (stable for a
 * creature's lifetime), so the same two attackers keep the slot instead of
 * it flickering between candidates every tick.
 */
const MAX_GLEICHZEITIGE_ANGREIFER = 2;

/**
 * Längster Schritt der Simulation in Sekunden. Nach einem Stau des Servers
 * (Speichern, Ladepause) käme sonst ein Schritt von Sekunden an: Der Wolf
 * sprang mehrere Meter durch die Kollision, und Takt und Fristen der KI
 * liefen auf einmal ab. 0,25 s sind ein Sync-Schritt (4 Hz) und bei 4,9 m/s
 * Laufschritt 1,2 m, weniger als der Wolf (Durchmesser 0,9 m) plus ein Fels.
 * (Die Eingabe der Spieler kappt bei 0,5 s, WovServer.handlePlayerInput.)
 */
const MAX_SCHRITT_SEC = 0.25;

/**
 * Wie viel eines langen Ticks die Simulation in Teilschritten nachholt, in Sekunden.
 * Ein Tick von 0,5 oder 1 s läuft so in Schritten zu höchstens 0,25 s ab, statt die
 * Kreaturen auf einen Bruchteil der Wanduhr zu bremsen (0,25 s je 1 s = 25 %).
 * 2 s sind acht Teilschritte; was darüber liegt (ein Hänger von 30 s), wird verworfen,
 * damit der Stau keine Lawine aus Schritten auslöst.
 */
const MAX_NACHHOL_SEC = 2;

export class SpawnSystem {
  private readonly table: readonly SpawnEntry[];
  private readonly rng: XorShiftRandom;
  private readonly despawnRadius: number;
  private readonly simRadius: number;
  private readonly syncIntervalSec: number;
  private readonly kiUeberschreibung: Partial<KiSteckbrief> | undefined;

  private readonly creatures = new Map<string, CreatureState>();
  /**
   * Felsen und Bauten für die Bewegung der Kreaturen (0.15). Der Server hängt
   * die Kollisionswelt der Hauptwelt ein; ohne Formen oder ohne Abfrage
   * rechnen Kreaturen wie vor der Kollision (eine Zone ohne Felsen kostet nichts).
   */
  kollision: Kollisionswelt | null = null;
  /** Das Gelände als Boden für den Gleitschritt. */
  private readonly bodenAbfrage = {
    hoeheBei: (x: number, z: number): number => this.heightmaps.getGroundHeight(x, z),
    gelaendeHoehe: (x: number, z: number): number => this.heightmaps.getGroundHeight(x, z),
  };
  /** Kennung und Blick der Ziele des laufenden Ticks (parallel zur Zielliste). */
  private zielInfo: readonly SpawnZielInfo[] = [];
  private readonly spawnAccums: number[];
  /** Simulated seconds since construction (sole clock — no Date.now). */
  private simTime = 0;

  constructor(
    private readonly zdos: ZDOManager,
    private readonly geo: GeoManager,
    private readonly heightmaps: HeightmapProvider,
    private readonly zones: ZoneManager,
    options: SpawnSystemOptions = {}
  ) {
    const roh = options.table ?? SPAWN_TABLE;
    // Before the whitelist filter: an injected table with a wrong `clips`
    // fails here, loudly, and not as an animal that stands still.
    for (const e of roh) pruefeClips(e.prefab, e.clips, e.dieSec);
    this.table = nurEigeneModelle(roh);
    // Reference parity: time-seeded default RNG (same as location
    // randomRotation) — tests inject a seeded one.
    this.rng = options.rng ?? new XorShiftRandom((Date.now() & 0x7fffffff) | 0);
    this.despawnRadius = options.despawnRadius ?? SPAWN_DESPAWN_RADIUS;
    this.simRadius = options.simRadius ?? SPAWN_SIM_RADIUS;
    this.syncIntervalSec = options.syncIntervalSec ?? SPAWN_SYNC_INTERVAL_SEC;
    this.kiUeberschreibung = options.kiUeberschreibung;
    this.spawnAccums = this.table.map(() => 0);
  }

  get creatureCount(): number {
    return this.creatures.size;
  }

  /**
   * Trefferpunkte anlegen, falls die ZDO noch keine hat.
   *
   * Warum beim Spawn und nicht erst beim ersten Treffer (so war es
   * bisher): Ohne den Member kann der Client keinen Lebensbalken zeichnen
   * — „Member fehlt" und „0 Trefferpunkte" wären sonst dasselbe. Und weil
   * jede Kreatur beim Boot durch `adoptPersisted` läuft, holt derselbe
   * Aufruf die Wesen aus älteren Saves nach.
   *
   * `getInt` liefert 0, wenn der Member fehlt — genau das ist der Fall,
   * den wir füllen wollen. Ein Wesen mit 0 Trefferpunkten gibt es nicht,
   * es wäre längst zerstört.
   */
  private stelleLebenSicher(zdo: ZDO, prefab: string): void {
    if (zdo.getInt(HEALTH_MEMBER) > 0) return;
    zdo.setInt(HEALTH_MEMBER, maxLeben(prefab));
    zdo.revision.reviseData();
    zdo.dirty = true;
  }

  /**
   * Write the animation state into the ZDO member `anim` — only for entries
   * that list their clips (`SpawnEntry.clips`), and only when it changes.
   *
   * The client plays the group whose name contains the string, so this is the
   * whole path for `idle`/`walk`/`run`/`attack`; no packet type is involved.
   * Every client that enters the zone later gets the state with the normal
   * ZDO sync, `setString` bumps the revision by itself.
   */
  private zeigeAnim(c: CreatureState, wunsch: KreaturAnim): void {
    const clips = c.entry.clips;
    if (!clips) return;
    const anim = waehleClip(clips, wunsch);
    if (anim === c.anim) return;
    c.anim = anim;
    c.zdo.setString(ANIM_MEMBER, anim);
  }

  /**
   * Trigger a one-shot clip (`animEinmal` = `<clip>#<n>`): the client plays it
   * once and falls back to the state. Only for a clip the entry lists —
   * returns whether it was written.
   */
  private einmal(c: CreatureState, clip: EinmalClip): boolean {
    const clips = c.entry.clips;
    if (!clips || !clips.includes(clip)) return false;
    c.zdo.setString(ANIM_EINMAL_MEMBER, naechstesEinmal(c.zdo.getString(ANIM_EINMAL_MEMBER), clip));
    return true;
  }

  /**
   * A player hit this creature and it lives on: play `hit` once, if the model
   * has the clip. Returns whether a clip was triggered.
   */
  treffer(zdo: ZDO, angreifer?: SpawnAngreifer): boolean {
    const c = this.eigene(zdo);
    if (!c || c.stirbtBis !== undefined) return false;
    if (angreifer) this.reizeVon(c, angreifer);
    return this.einmal(c, 'hit');
  }

  /**
   * Schaden zieht Aggro: Der Angreifer kommt in die Tabelle der getroffenen
   * Kreatur. Sie ruft außerdem ihre Nachbarn derselben Art — aber nur, wenn sie
   * selbst noch innerhalb ihrer Leine steht.
   */
  private reizeVon(c: CreatureState, a: SpawnAngreifer): void {
    if (!c.ki || !c.steck) return;
    kiReiz(c.ki, a.id, a.schaden);
    if (kiDarfRufen(c.steck, c.zdo.position.x, c.zdo.position.z, c.home.x, c.home.z)) {
      this.ruf(c, a.id);
    }
  }

  /** Ziele des letzten Ticks (Positionen), parallel zu `zielInfo`. */
  private letzteZiele: readonly Vector3[] = [];

  /**
   * Ein Lärm an `pos`, verursacht von `id`: Jede aggressive Kreatur im Hörradius
   * kennt den Verursacher danach. Hören ist an diesen Reiz gebunden: Ein Spieler,
   * der nur im Hörradius steht, macht keinen Lärm und bleibt unbemerkt, solange
   * er außerhalb des Sichtkegels ist. Wer Lärm erzeugt (Schritte, Schläge),
   * ruft diese Methode.
   *
   * NOCH OHNE QUELLE: Kein Code des Servers ruft sie auf (Schritte, Schläge
   * und Rufe als Lärm sind offen); nur der Test `ki-zustaende` benutzt sie.
   */
  laerm(id: string, pos: Vector3): void {
    for (const c of this.creatures.values()) {
      if (!c.ki || !c.steck || c.stirbtBis !== undefined) continue;
      if (hoert(c.steck, c.zdo.position.x, c.zdo.position.z, pos.x, pos.z)) kiLaerm(c.ki, id);
    }
  }

  /**
   * Heimkehrende Kreaturen sind unverwundbar (sie haben ihre Lebenspunkte beim
   * Aufgeben aufgefüllt): Der Angriffspfad des Servers überspringt sie als Ziel.
   * Sonst träfe ein Spieler mit längerer Reichweite an der Leine gratis.
   */
  unverwundbar(zdo: ZDO): boolean {
    return this.eigene(zdo)?.ki?.phase === 'heimkehren';
  }

  /** Die Phase der KI einer Kreatur (Diagnose, Tests); null ohne Zustandsmaschine. */
  kiPhase(zdo: ZDO): KiZustand['phase'] | null {
    return this.eigene(zdo)?.ki?.phase ?? null;
  }

  /** Nachbarn derselben Art im Umkreis der Leine kennen den Reiz danach. */
  private ruf(c: CreatureState, id: string): void {
    const r = c.steck?.leine ?? 0;
    if (!Number.isFinite(r)) return;
    const rSqr = r * r;
    for (const o of this.creatures.values()) {
      if (o === c || o.entry !== c.entry || !o.ki || o.stirbtBis !== undefined) continue;
      const dx = o.zdo.position.x - c.zdo.position.x;
      const dz = o.zdo.position.z - c.zdo.position.z;
      if (dx * dx + dz * dz <= rSqr) kiRuf(o.ki, id);
    }
  }

  /**
   * A player killed this creature: if the entry lists `die`, play the clip and
   * keep the body for `dieSec` (then this system destroys it) — returns true
   * and the CALLER MUST NOT destroy the ZDO. Otherwise returns false and the
   * caller destroys it at once, as before.
   */
  sterbe(zdo: ZDO): boolean {
    const c = this.eigene(zdo);
    if (!c || c.stirbtBis !== undefined || !this.einmal(c, 'die')) return false;
    // pruefeClips guarantees dieSec whenever 'die' is listed; +0.25 s lets the
    // last frame arrive before the body disappears.
    c.stirbtBis = this.simTime + (c.entry.dieSec ?? 0) + 0.25;
    c.zdo.setInt(HEALTH_MEMBER, 0);
    return true;
  }

  /** Is this creature in its death animation (not hittable, not acting)? */
  stirbt(zdo: ZDO): boolean {
    return this.eigene(zdo)?.stirbtBis !== undefined;
  }

  /**
   * Speed (m/s) this creature moves at right now, from its mode (D2: tolerance of the hit sphere
   * for a moving target). 0 for a creature that stands, that is not ours, or that lies dying.
   */
  tempo(zdo: ZDO): number {
    const c = this.eigene(zdo);
    if (!c || c.stirbtBis !== undefined) return 0;
    if (c.mode === 'chase' || c.mode === 'flee') return c.entry.runSpeed;
    return c.mode === 'walk' ? c.entry.walkSpeed : 0;
  }

  /**
   * The creature of THIS system that is this very ZDO. The id alone is no
   * identity: an instance world has its own ZDOManager with the same
   * serverUserId, so its ZDO can carry the id of a main-world creature —
   * a blow in the instance would then kill or twitch the main-world animal
   * (and pay the loot twice). Object identity refuses the stranger.
   */
  private eigene(zdo: ZDO): CreatureState | undefined {
    const c = this.creatures.get(zdo.zdoid.toString());
    return c !== undefined && c.zdo === zdo ? c : undefined;
  }

  /**
   * Put a creature under this system. The single place that registers one, so
   * the animation ownership is claimed exactly here (AnimBesitz): an entry
   * that lists `clips` writes `anim`, and then no NPC system may share the ZDO.
   */
  private nimmAuf(key: string, c: CreatureState): void {
    if (c.entry.clips) nimmAnim(c.zdo, 'kreatur');
    const brief = steckbriefFuer(c.entry.prefab);
    c.ursprung = { ...c.home };
    c.radius = brief?.koerperRadius ?? KI_VORGABE.koerperRadius;
    // Aggressive Kreaturen (weder fliehend noch friedlich) bekommen die
    // Zustandsmaschine; ohne eigenen Steckbrief gilt das Verhalten von früher.
    if (!c.entry.flees && c.entry.aggro !== false) {
      const basis = brief?.ki ?? KI_VORGABE;
      c.steck = this.kiUeberschreibung ? { ...basis, ...this.kiUeberschreibung } : basis;
      c.ki = neuerKiZustand();
    }
    this.creatures.set(key, c);
  }

  /**
   * Re-register creature ZDOs restored from the world save (call after
   * loadWorld). Their spawn position becomes their wander anchor.
   */
  adoptPersisted(): void {
    for (const entry of this.table) {
      const hash = getStableHash(entry.prefab);
      for (const zdo of this.zdos.getZDOByPrefab(hash)) {
        const key = zdo.zdoid.toString();
        if (this.creatures.has(key)) continue;
        this.stelleLebenSicher(zdo, entry.prefab);
        const c: CreatureState = {
          zdo,
          entry,
          home: { ...zdo.position },
          mode: 'idle',
          target: { ...zdo.position },
          idleUntil: 0,
          syncAccum: 0,
        };
        this.nimmAuf(key, c);
        // Aus dem Save geladen steht jede Kreatur in `wandern` (die KI-Phase wird nicht gespeichert): Eine mit
        // Leine (Wolf) bekommt volle Lebenspunkte, sonst bliebe sie mit 1 LP verwundet.
        if (c.steck && Number.isFinite(c.steck.leine)) this.fuelleLeben(c);
        // A creature from the save may still say `walk` or `attack`.
        this.zeigeAnim(c, 'idle');
      }
    }
  }

  /**
   * Einzelne ZDO mit synthetischem Entry adoptieren (Boss, NPC): bekommt
   * Wander-/Chase-Verhalten, ohne in der Spawn-Tabelle zu stehen.
   */
  adoptSingle(zdo: ZDO, entry: SpawnEntry): void {
    // Dieselbe Pruefung wie bei der Tabelle, und hier ist sie noetiger:
    // Bosse und Layout-NPCs kommen ueber synthetische Eintraege herein und
    // gehen an der Tabelle absichtlich vorbei. Wer hier durchkaeme, waere
    // eine unsichtbare Huelle, die den Spieler verfolgt und zuschlaegt.
    //
    // Die ZDO selbst bleibt bestehen — sie zu zerstoeren waere hier der
    // falsche Ort: Dieses System simuliert, es raeumt nicht auf. Wer den
    // Eikthyr aus der Welt nehmen will, tut das dort, wo er entsteht
    // (WovServer, Altar-Opfergabe), nicht in der Wander-KI.
    if (!istEigenesModell(entry.prefab)) {
      console.warn(
        `[spawns] '${entry.prefab}' ohne eigenes Modell — nicht adoptiert, die ZDO simuliert nicht`
      );
      return;
    }
    pruefeClips(entry.prefab, entry.clips, entry.dieSec);
    const key = zdo.zdoid.toString();
    if (this.creatures.has(key)) return;
    this.stelleLebenSicher(zdo, entry.prefab);
    this.nimmAuf(key, {
      zdo,
      entry,
      home: { ...zdo.position },
      mode: 'idle',
      target: { ...zdo.position },
      idleUntil: 0,
      syncAccum: 0,
    });
  }

  /**
   * ZDO aus der Kreatur-Simulation entlassen (ohne sie zu zerstören).
   *
   * Nötig, weil NPC_1-ZDOs beim Boot pauschal als wandernde Kreaturen
   * adoptiert werden: Bekommt so einer per Layout eine Route, würden zwei
   * Systeme dieselbe Position schreiben und der NPC zuckte zwischen
   * Wanderziel und Wegpunkt hin und her.
   */
  entlasse(zdo: ZDO): void {
    this.creatures.delete(zdo.zdoid.toString());
    gibAnim(zdo, 'kreatur');
  }

  /**
   * `peerPositions`: every player in this world (despawn and spawn radius). `ziele`: those creatures may
   * chase and strike (default: all) — a dead player is in the first list, not in the second.
   */
  update(
    deltaSec: number,
    peerPositions: readonly Vector3[],
    ziele: readonly Vector3[] = peerPositions,
    zielInfo: readonly SpawnZielInfo[] = []
  ): void {
    this.zielInfo = zielInfo;
    this.letzteZiele = ziele;
    // Ein langer Tick läuft in Teilschritten zu höchstens MAX_SCHRITT_SEC ab, insgesamt
    // höchstens MAX_NACHHOL_SEC (der Rest eines Staus wird verworfen).
    let rest = Math.min(deltaSec, MAX_NACHHOL_SEC);
    do {
      const dt = Math.min(rest, MAX_SCHRITT_SEC);
      rest -= dt;
      this.simTime += dt;
      // Nobody online: nothing simulates, nothing despawns (reference parity:
      // persistent creatures simply sleep with no clients connected).
      if (peerPositions.length === 0) continue;
      this.despawnFar(peerPositions);
      this.spawnTick(dt, peerPositions);
      this.simulateTick(dt, ziele);
    } while (rest > 1e-9);
  }

  // ── Despawn ──────────────────────────────────────────────────────

  private despawnFar(peerPositions: readonly Vector3[]): void {
    const rSqr = this.despawnRadius * this.despawnRadius;
    for (const [key, c] of this.creatures) {
      if (c.entry.despawns === false) continue;
      if (!this.anyPeerWithin(c.zdo.position, peerPositions, rSqr)) {
        this.zdos.destroyZDO(c.zdo.zdoid);
        this.creatures.delete(key);
      }
    }
  }

  // ── Spawning ─────────────────────────────────────────────────────

  private spawnTick(deltaSec: number, peerPositions: readonly Vector3[]): void {
    for (let i = 0; i < this.table.length; i++) {
      const entry = this.table[i];
      this.spawnAccums[i] += deltaSec;
      if (this.spawnAccums[i] < entry.spawnIntervalSec) continue;
      this.spawnAccums[i] -= entry.spawnIntervalSec;

      for (const peerPos of peerPositions) {
        if (this.rng.nextFloat() >= entry.spawnChance) continue;
        this.trySpawnAt(entry, peerPos);
      }
    }
  }

  private trySpawnAt(entry: SpawnEntry, peerPos: Vector3): void {
    // Caps: per-player area + server-wide safety
    if (this.countGlobal(entry) >= entry.globalMax) return;
    if (this.countNear(entry, peerPos, entry.countRadius) >= entry.maxPerPlayer) return;

    // Ring anchor around the player
    const angle = this.rng.rangeFloat(0, TWO_PI);
    const dist = this.rng.rangeFloat(entry.ringMin, entry.ringMax);
    const ax = peerPos.x + Math.cos(angle) * dist;
    const az = peerPos.z + Math.sin(angle) * dist;

    // Gates: zone generated, biome match, above water
    if (!this.zones.isZoneGenerated({
      x: HeightmapProvider.worldToZone(ax),
      y: HeightmapProvider.worldToZone(az),
    })) return;
    if ((this.geo.getBiome(ax, az) & entry.biomes) === 0) return;
    if (this.heightmaps.getGroundHeight(ax, az) < entry.minAltitude) return;
    // Kuratierte Region (Layout-Modus): Spawn-Liste ist exklusiv.
    if (this.geo instanceof RegionGeo) {
      const region = this.geo.regionAt(ax, az);
      if (region?.spawns && !region.spawns.includes(entry.prefab)) return;
    }

    // Group scatter around the anchor (each member re-checked for ground)
    const groupSize = this.rng.rangeInt(entry.groupSizeMin, entry.groupSizeMax + 1);
    const hash = getStableHash(entry.prefab);
    for (let m = 0; m < groupSize; m++) {
      const mx = m === 0 ? ax : ax + this.rng.rangeFloat(-entry.groupRadius, entry.groupRadius);
      const mz = m === 0 ? az : az + this.rng.rangeFloat(-entry.groupRadius, entry.groupRadius);
      const ground = this.heightmaps.getGroundHeight(mx, mz);
      if (ground < entry.minAltitude) continue;
      // Nicht in einen Fels oder ein Bauwerk setzen (sonst läuft die Kreatur hindurch).
      if (this.stecktImFels({ x: mx, y: ground, z: mz }, steckbriefFuer(entry.prefab)?.koerperRadius ?? KI_VORGABE.koerperRadius)) continue;

      const yaw = this.rng.rangeFloat(0, TWO_PI);
      const rot = yawQuaternion(yaw);
      const zdo = this.zdos.createZDO(hash, { x: mx, y: ground, z: mz }, rot);
      this.stelleLebenSicher(zdo, entry.prefab);
      const c: CreatureState = {
        zdo,
        entry,
        home: { x: mx, y: ground, z: mz },
        mode: 'idle',
        target: { x: mx, y: ground, z: mz },
        idleUntil: this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec),
        syncAccum: 0,
      };
      this.nimmAuf(zdo.zdoid.toString(), c);
      this.zeigeAnim(c, 'idle');
    }
  }

  // ── Simulation (wander / flee) ───────────────────────────────────

  /** Creature strike: position, damage, radius and selected target — wired by the server. */
  onCreatureAttack: ((pos: Vector3, damage: number, radius: number, target: Vector3) => void) | null = null;

  /** D5: the damage tally of a creature is void (it went home at full health, or left the game without a kill) — wired by the world. */
  beiAnteileVergessen: ((zdo: ZDO) => void) | null = null;

  private simulateTick(deltaSec: number, peerPositions: readonly Vector3[]): void {
    const simSqr = this.simRadius * this.simRadius;
    const kiZiele: KiZiel[] = peerPositions.map((p, i) => ({
      key: this.zielInfo[i]?.id ?? `p${i}`,
      x: p.x,
      z: p.z,
      blick: this.zielInfo[i]?.blick ?? null,
    }));
    const angriffsSlots = this.berechneAngriffsSlots(kiZiele);
    for (const [key, c] of this.creatures) {
      // Extern getötet (Spieler-Angriff): Zustand aufräumen.
      if (c.zdo.destroyed) {
        this.creatures.delete(key);
        continue;
      }
      // Kein Ausweg aus dem Fels: wie beim Wegzug des Spielers aus dem Spiel nehmen,
      // die Spawn-Würfe setzen sie normal neu (kein Kampf, kein Tod, keine Beute).
      if (c.entfernen) {
        this.nimmAusDemSpiel(key, c);
        continue;
      }
      // Slain: the body stays while the clip plays, then goes. Before the
      // radius check — a body must not linger because the player walked off.
      if (c.stirbtBis !== undefined) {
        if (this.simTime >= c.stirbtBis) {
          this.zdos.destroyZDO(c.zdo.zdoid);
          this.creatures.delete(key);
        }
        continue;
      }
      // Cheap rest when no player is near (position untouched, bit-exact)
      const nearest = this.nearestPeer(c.zdo.position, peerPositions);
      if (!nearest) {
        // No target at all (the only player lies dead): the table empties
        // and the creature walks home.
        if (c.ki && c.steck && c.ki.phase !== 'wandern') this.kiLauf(key, c, deltaSec, kiZiele, angriffsSlots);
        continue;
      }
      if (nearest.distSqr > simSqr) {
        // Außerhalb der Simulation steht die Kreatur: mitten in `heimkehren` (unverwundbar) einzufrieren hieße,
        // dass sie es bleibt. Sie gilt als zu Hause: volle Lebenspunkte, Phase `wandern`.
        if (c.ki && c.steck && c.ki.phase !== 'wandern' && Number.isFinite(c.steck.leine)) this.setzeZuHause(c);
        continue;
      }

      const entry = c.entry;

      // Aggressive Kreaturen: die Zustandsmaschine führt, solange sie nicht
      // in `wandern` steht; dann gilt der Wanderzweig unten.
      if (c.ki && c.steck && this.kiLauf(key, c, deltaSec, kiZiele, angriffsSlots)) {
        c.syncAccum += deltaSec;
        if (c.syncAccum >= this.syncIntervalSec) {
          c.syncAccum -= this.syncIntervalSec;
          c.zdo.revision.reviseData();
          c.zdo.dirty = true;
        }
        continue;
      }

      // Flee gate (skittish creatures only)
      if (entry.flees) {
        if (c.mode !== 'flee' && nearest.distSqr < entry.fleeDistance * entry.fleeDistance) {
          c.mode = 'flee';
        } else if (c.mode === 'flee' && nearest.distSqr > entry.calmDistance * entry.calmDistance) {
          c.mode = 'idle';
          c.idleUntil = this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec);
        }
      }

      if (c.mode === 'flee') {
        // Straight away from the nearest player
        const dx = c.zdo.position.x - nearest.pos.x;
        const dz = c.zdo.position.z - nearest.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        this.moveStep(c, dx / len, dz / len, entry.runSpeed * deltaSec);
      } else if (c.mode === 'idle') {
        if (this.simTime >= c.idleUntil) {
          // New wander target around the home anchor; water targets are
          // skipped (stay idle another second and retry)
          const angle = this.rng.rangeFloat(0, TWO_PI);
          const dist = this.rng.rangeFloat(0, Math.min(entry.wanderRadius, c.steck?.leine ?? Infinity));
          const tx = c.home.x + Math.cos(angle) * dist;
          const tz = c.home.z + Math.sin(angle) * dist;
          if (this.heightmaps.getGroundHeight(tx, tz) >= entry.minAltitude) {
            c.target = { x: tx, y: 0, z: tz };
            c.mode = 'walk';
          } else {
            c.idleUntil = this.simTime + 1;
          }
        }
      } else {
        // walk toward the target
        const dx = c.target.x - c.zdo.position.x;
        const dz = c.target.z - c.zdo.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= ARRIVE_DIST) {
          c.mode = 'idle';
          c.idleUntil = this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec);
        } else {
          const step = Math.min(entry.walkSpeed * deltaSec, dist);
          const moved = this.moveStep(c, dx / dist, dz / dist, step);
          if (!moved) {
            // Blocked by water on all axes — give up on this target
            c.mode = 'idle';
            c.idleUntil = this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec);
          }
        }
      }

      this.zeigeAnim(c, c.mode === 'walk' ? 'walk' : c.mode === 'flee' ? 'run' : 'idle');

      // 4 Hz revision throttle: position lives in the ZDO wire header, and
      // the revision compare in syncZDOs is the authoritative resend gate.
      c.syncAccum += deltaSec;
      if (c.syncAccum >= this.syncIntervalSec) {
        c.syncAccum -= this.syncIntervalSec;
        c.zdo.revision.reviseData();
        c.zdo.dirty = true;
      }
    }
  }

  /**
   * Ein Schritt der Zustandsmaschine für eine Kreatur. Liefert false, wenn sie
   * in `wandern` steht und der Wanderzweig übernimmt.
   */
  private kiLauf(
    key: string,
    c: CreatureState,
    deltaSec: number,
    ziele: readonly KiZiel[],
    slots: ReadonlySet<string>
  ): boolean {
    const ki = c.ki as KiZustand;
    const p = c.zdo.position;
    const vorher = ki.phase;
    // Der Heimatpunkt liegt nicht im Fels (nachgeladener Fels, Spawn am Bauwerk):
    // sonst käme die Heimkehr nie an. Einmal, beim ersten Schritt mit Formen.
    if (!c.ankerGeprueft && this.kollision?.hatFormen) {
      c.ankerGeprueft = true;
      const raus = this.kollision.nahfeld(c.home, 0).ausDemFels(c.home, c.radius ?? KI_VORGABE.koerperRadius, this.betretbar(c));
      if (raus === 'keinAusweg') c.home = { x: p.x, y: p.y, z: p.z };
      else if (raus) c.home = { x: raus.x, y: c.home.y, z: raus.z };
    }
    const befehl: KiBefehl = kiSchritt(
      ki,
      c.steck as KiSteckbrief,
      {
        x: p.x,
        z: p.z,
        yaw: yawVon(c.zdo.rotation),
        homeX: c.home.x,
        homeZ: c.home.z,
        ziele,
        zuletztGelaufen: c.gelaufen ?? 0,
        darfSchlagen: slots.has(key),
      },
      deltaSec,
      () => this.rng.nextFloat()
    );
    c.gelaufen = 0;
    // Festgesessen auf dem Heimweg: hier ist jetzt der Anker (kiSchritt: `ankerNeu`).
    if (befehl.ankerNeu) {
      // Der neue Anker bleibt in der Leine des Ursprungs, sonst wanderte das Revier mit
      // jedem Hindernis weiter (dichtes Feld: 21–34 m in 30–120 min). Liegt er weiter weg,
      // wird die Kreatur aus dem Spiel genommen und spawnt normal neu: verworfen wird ein
      // Wolf, der ohnehin fern von seinem Revier festsitzt, ohne Spieleffekt (kein Tod, keine Beute).
      const u = c.ursprung ?? c.home;
      const fern = Math.hypot(p.x - u.x, p.z - u.z) > (c.steck?.leine ?? Infinity);
      if (fern) {
        this.nimmAusDemSpiel(key, c);
        return true;
      }
      c.home = { x: p.x, y: p.y, z: p.z };
    }
    // Beim Aufgeben füllt sie ihre Lebenspunkte (wie ein Zurücksetzen), und bis
    // zur Ankunft trifft sie niemand (`unverwundbar`).
    if (befehl.phase === 'heimkehren' && vorher !== 'heimkehren') {
      this.beiAnteileVergessen?.(c.zdo);
      this.fuelleLeben(c);
    }
    // Jenseits der Leine ist `ziel` schon null (sie kehrt heim): dann gibt es nichts zu rufen.
    if (befehl.neuBemerkt && befehl.ziel) this.ruf(c, befehl.ziel);
    if (befehl.phase === 'wandern') {
      if (vorher !== 'wandern') {
        // Heimgekehrt oder das Ziel los: Pause, dann wieder wandern.
        c.mode = 'idle';
        c.idleUntil = this.simTime + this.rng.rangeFloat(c.entry.idleMinSec, c.entry.idleMaxSec);
        this.zeigeAnim(c, 'idle');
      }
      return false;
    }
    // Der Modus bleibt lesbar (D2 liest daraus das Tempo): laufend = chase, sonst steht sie.
    // Die Heimkehr geht im Gehtempo der Art (`walkSpeed`, vorhandene Zahl) mit dem Clip `walk`: Der Spieler sieht,
    // dass der Wolf abzieht, und die Beine rutschen nicht (der Client koppelt die Clip-Rate an die Bodengeschwindigkeit;
    // `run` mit Gehtempo oder `walk` mit Lauftempo wären Zeitlupe bzw. ein Wirbel). Modus `walk`: `tempo()` (D2) liest daraus.
    const heim = befehl.phase === 'heimkehren';
    c.mode = befehl.bewegung === 'laeuft' ? (heim ? 'walk' : 'chase') : 'idle';
    if (befehl.bewegung === 'laeuft') {
      // Anrennen ohne Kappung (wie vor der Zustandsmaschine); nur der Heimweg endet genau am Ziel.
      const step = heim ? Math.min(c.entry.walkSpeed * deltaSec, befehl.maxWeg) : c.entry.runSpeed * deltaSec;
      const vx = p.x;
      const vz = p.z;
      if (step > 0) this.moveStep(c, befehl.dirX, befehl.dirZ, step);
      const np = c.zdo.position;
      c.gelaufen = Math.sqrt((np.x - vx) ** 2 + (np.z - vz) ** 2);
      this.zeigeAnim(c, heim ? 'walk' : 'run');
    } else {
      if (befehl.blickX !== 0 || befehl.blickZ !== 0) this.richte(c, befehl.blickX, befehl.blickZ);
      this.zeigeAnim(c, befehl.phase === 'kaempfen' ? 'attack' : 'idle');
    }
    if (befehl.schlag) {
      const idx = ziele.findIndex((z) => z.key === befehl.ziel);
      const ziel = idx >= 0 ? this.letzteZiele[idx] : undefined;
      if (ziel) {
        this.einmal(c, 'attack');
        this.onCreatureAttack?.(c.zdo.position, 8, 2.4, ziel);
      }
    }
    return true;
  }

  /** Zu Hause (außerhalb der Simulation, neu geladen): frische KI, volle Lebenspunkte, Schadensanteile vergessen. */
  private setzeZuHause(c: CreatureState): void {
    c.ki = neuerKiZustand();
    this.beiAnteileVergessen?.(c.zdo);
    this.fuelleLeben(c);
    c.mode = 'idle';
    c.idleUntil = this.simTime + this.rng.rangeFloat(c.entry.idleMinSec, c.entry.idleMaxSec);
    this.zeigeAnim(c, 'idle');
  }

  /** Volle Lebenspunkte (Heimkehr): der Wert der Art aus `maxLeben`. */
  private fuelleLeben(c: CreatureState): void {
    const voll = maxLeben(c.entry.prefab);
    if (c.zdo.getInt(HEALTH_MEMBER) === voll) return;
    c.zdo.setInt(HEALTH_MEMBER, voll);
    c.zdo.revision.reviseData();
    c.zdo.dirty = true;
  }

  /** Aus dem Spiel nehmen (kein Tod, keine Beute): ZDO zerstören, Schadensanteile der Beute vergessen. */
  private nimmAusDemSpiel(key: string, c: CreatureState): void {
    this.beiAnteileVergessen?.(c.zdo);
    this.zdos.destroyZDO(c.zdo.zdoid);
    this.creatures.delete(key);
  }

  /** Steckt ein Körper dieses Radius an `pos` im Fels? (Nur mit Formen, sonst nie.) */
  private stecktImFels(pos: Vector3, radius: number): boolean {
    if (!this.kollision?.hatFormen) return false;
    return this.kollision.nahfeld(pos, 0).ausDemFels(pos, radius) !== null;
  }

  /** Darf die Kreatur diese Stelle betreten? (Mindesthöhe der Art: kein Wasser, kein Tal.) */
  private betretbar(c: CreatureState): (x: number, z: number) => boolean {
    return (x, z) => this.heightmaps.getGroundHeight(x, z) >= c.entry.minAltitude;
  }

  /**
   * Blickrichtung setzen, erst ab 3° Änderung (jede Schreibung kostet Sync). 3°: kleiner als die Drehung, die
   * ein Spieler bei 4 Hz Sync und 230° Sichtkegel erkennt (ein Schritt der Wanderrichtung ändert den Blick um
   * wenige Grad); jede Schreibung hebt die ZDO-Revision und damit Netzlast. Gewählt, nicht gemessen.
   */
  private richte(c: CreatureState, bx: number, bz: number): void {
    const yaw = Math.atan2(bx, bz);
    let d = yaw - yawVon(c.zdo.rotation);
    while (d > Math.PI) d -= TWO_PI;
    while (d < -Math.PI) d += TWO_PI;
    if (Math.abs(d) < (3 * Math.PI) / 180) return;
    c.zdo.rotation = yawQuaternion(yaw);
  }

  /**
   * Integrate one movement step with water deflection: if the ground at
   * the next position is below minAltitude, try the X and Z components
   * separately (slide along the shoreline); fully blocked → no move.
   * Returns whether any movement happened.
   */
  private moveStep(c: CreatureState, dirX: number, dirZ: number, step: number): boolean {
    const p = c.zdo.position;
    const minAlt = c.entry.minAltitude;

    // Felsen und Bauten: derselbe Gleitschritt wie beim Spieler, mit dem Radius
    // der Art. Ohne Formen (oder ohne angehängte Kollisionswelt) fällt nichts
    // an — die Nahfeldabfrage läuft erst, wenn es etwas zu treffen gibt.
    if (this.kollision?.hatFormen && step > 0) {
      const nah = this.kollision.nahfeld(p, step);
      if (nah.anzahl > 0) {
        // Steckt sie schon im Fels (nachgeladen, hineingesetzt), läuft sie sonst
        // hindurch: Erst auf dem kürzesten Weg hinaus, dann weiter.
        const raus = nah.ausDemFels(p, c.radius ?? KI_VORGABE.koerperRadius, this.betretbar(c));
        if (raus === 'keinAusweg') {
          // Kein gültiger Weg hinaus (Wasser oder Fels ringsum): aus dem Spiel nehmen.
          c.entfernen = true;
          return false;
        }
        if (raus) {
          this.applyMove(c, raus.x, raus.z, 0, 0);
          return true;
        }
        const g = gleitBewegung({
          von: p,
          nachX: p.x + dirX * step,
          nachZ: p.z + dirZ * step,
          radius: c.radius ?? KI_VORGABE.koerperRadius,
          boden: this.bodenAbfrage,
          hindernis: nah,
        });
        const wx = g.x - p.x;
        const wz = g.z - p.z;
        const weg = Math.sqrt(wx * wx + wz * wz);
        if (g.blockiert || weg === 0) return false;
        dirX = wx / weg;
        dirZ = wz / weg;
        step = weg;
      }
    }

    let nx = p.x + dirX * step;
    let nz = p.z + dirZ * step;
    if (this.heightmaps.getGroundHeight(nx, nz) >= minAlt) {
      this.applyMove(c, nx, nz, dirX, dirZ);
      return true;
    }
    // Deflect: X only
    nx = p.x + dirX * step;
    if (this.heightmaps.getGroundHeight(nx, p.z) >= minAlt) {
      this.applyMove(c, nx, p.z, dirX, 0);
      return true;
    }
    // Deflect: Z only
    nz = p.z + dirZ * step;
    if (this.heightmaps.getGroundHeight(p.x, nz) >= minAlt) {
      this.applyMove(c, p.x, nz, 0, dirZ);
      return true;
    }
    return false;
  }

  private applyMove(c: CreatureState, nx: number, nz: number, faceX: number, faceZ: number): void {
    const ground = this.heightmaps.getGroundHeight(nx, nz);
    this.zdos.updateZDOZone(c.zdo, { x: nx, y: ground, z: nz });
    if (faceX !== 0 || faceZ !== 0) {
      const yaw = Math.atan2(faceX, faceZ);
      c.zdo.rotation = yawQuaternion(yaw);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private countGlobal(entry: SpawnEntry): number {
    let n = 0;
    for (const c of this.creatures.values()) {
      if (c.entry === entry) n++;
    }
    return n;
  }

  private countNear(entry: SpawnEntry, pos: Vector3, radius: number): number {
    const rSqr = radius * radius;
    let n = 0;
    for (const c of this.creatures.values()) {
      if (c.entry !== entry) continue;
      const dx = c.zdo.position.x - pos.x;
      const dz = c.zdo.position.z - pos.z;
      if (dx * dx + dz * dz <= rSqr) n++;
    }
    return n;
  }

  private anyPeerWithin(pos: Vector3, peers: readonly Vector3[], rSqr: number): boolean {
    for (const p of peers) {
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      if (dx * dx + dz * dz <= rSqr) return true;
    }
    return false;
  }

  /**
   * Which creatures may run their strike timer this tick (see
   * MAX_GLEICHZEITIGE_ANGREIFER). Grouped by the creature's ACTUAL target (the
   * one its aggro table chose, `ki.ziel`), not by the nearest player: the two
   * differ as soon as a player with less aggro stands closer, and a count by
   * nearest player let four wolves strike one target at once. Only creatures
   * that run at or fight their target count; the target is the one of the last
   * step, so a creature that switches target wins its place one tick later.
   * Ranked by ZDO id — a deterministic order that stays the same from tick to
   * tick as long as the same creatures are in range, so a slot does not flicker
   * between candidates.
   */
  private berechneAngriffsSlots(ziele: readonly KiZiel[]): ReadonlySet<string> {
    const kandidatenJeZiel = new Map<string, string[]>();
    for (const [key, c] of this.creatures) {
      if (c.zdo.destroyed || c.stirbtBis !== undefined) continue;
      if (c.entry.flees || c.entry.aggro === false) continue;
      const ki = c.ki;
      if (!ki || ki.ziel === null) continue;
      if (ki.phase !== 'anrennen' && ki.phase !== 'kaempfen') continue;
      const ziel = ziele.find((q) => q.key === ki.ziel);
      if (!ziel) continue;
      const dx = ziel.x - c.zdo.position.x;
      const dz = ziel.z - c.zdo.position.z;
      if (Math.sqrt(dx * dx + dz * dz) > 1.7 + 1e-6) continue;
      const liste = kandidatenJeZiel.get(ziel.key) ?? [];
      liste.push(key);
      kandidatenJeZiel.set(ziel.key, liste);
    }
    const slots = new Set<string>();
    for (const liste of kandidatenJeZiel.values()) {
      liste.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const key of liste.slice(0, MAX_GLEICHZEITIGE_ANGREIFER)) slots.add(key);
    }
    return slots;
  }

  private nearestPeer(
    pos: Vector3,
    peers: readonly Vector3[]
  ): { pos: Vector3; distSqr: number } | null {
    let best: { pos: Vector3; distSqr: number } | null = null;
    for (const p of peers) {
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const d = dx * dx + dz * dz;
      if (!best || d < best.distSqr) best = { pos: p, distSqr: d };
    }
    return best;
  }
}

/** Gierwinkel aus einer Drehung um die Hochachse (Gegenstück zu `yawQuaternion`). */
function yawVon(q: Quaternion): number {
  return 2 * Math.atan2(q.y, q.w);
}

/** Y-axis rotation quaternion (heading), y-up right-handed. */
function yawQuaternion(yaw: number): Quaternion {
  const half = yaw / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}
