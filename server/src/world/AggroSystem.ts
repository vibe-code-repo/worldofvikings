/**
 * AggroSystem — feindliche NPCs wenden sich dem Spieler zu und schlagen zu.
 *
 * WAHRNEHMUNG, HALTUNG und SCHLAG. Ein NPC, dem der Spieler zu nahe kommt,
 * dreht sich zu ihm; wer noch näher kommt, wird verfolgt; wer in die
 * Angriffsreichweite kommt, wird geschlagen — und zwar wirklich: Im Band
 * „zuschlagen" ruft das System im Takt der Kampfwerte (`takt`, s.
 * shared/npc.ts) den Rückruf `onSchlag` mit dem Schaden der Figur. Der
 * Server verdrahtet ihn auf denselben Weg wie die Kreaturen des
 * Spawnsystems (Parade, Trefferwirkung, Tod des Spielers), es gibt also
 * keinen zweiten Schadenspfad.
 *
 * Schlagen tut nur, wer eigene Kampfwerte hat (`hatKampfwerte`): Ein NPC
 * ohne NPC_KAMPF-Eintrag dreht sich allenfalls zum Spieler, verletzt ihn
 * aber nie. Dieselbe Menge trägt das Flag ANGREIFBAR — der Spieler kann
 * genau die treffen, die zurückschlagen.
 *
 * ── Warum das ganz auf dem Server liegt und der Client nichts lernt ──
 * Weil der Weg schon da ist. Der Client dreht jedes dynamische Entity zur
 * ZDO-Rotation (EntityManager.updateDynamics slerpt darauf zu) und
 * schaltet die Animationsgruppe auf den String im ZDO-Member `anim`
 * (ANIM_MEMBER) — und der Membername IST der Name der Gruppe im GLB.
 * Surtrs Modell trägt eine Gruppe "attack", also genügt es, "attack" in
 * den Member zu schreiben. Kein neuer Pakettyp, keine Client-Änderung,
 * und jeder Client, der die Zone später betritt, bekommt den Zustand über
 * den normalen ZDO-Sync mitgeliefert.
 *
 * ── Warum kein Register, sondern eine Umkreissuche ───────────────────
 * Der RoutenLaeufer bekommt seine NPCs beim Boot angemeldet, weil er nur
 * die mit einer Route führt. Aggro betrifft dagegen JEDEN feindlichen
 * NPC — auch den, den ein Admin gerade eben mit `spawn` gesetzt hat, und
 * den, der aus dem Save kam. Ein Register müsste an all diesen Stellen
 * gepflegt werden und wäre genau dort lückenhaft, wo es zählt. Die
 * Umkreissuche um die SPIELER findet sie alle, und sie kostet nichts:
 * Gesucht wird nur um Spieler herum und nur viermal je Sekunde
 * (PRUEF_INTERVALL_SEC), nicht im vollen Tick.
 *
 * ── Wer angreift, steht nicht am NPC ─────────────────────────────────
 * Die Haltung ergibt sich aus dem Verhältnis der Fraktionen
 * (`haltungZwischen` in shared/npc.ts). Surtr gehört zu `muspel`, der
 * Spieler zu `wikinger`, und dieses Paar steht dort als feindlich — also
 * greift er an. Der Furloc-Fischer ist `furlocs` und zu Wikingern
 * neutral: Er dreht sich nicht einmal um. Wer das ändern will, ergänzt
 * eine Zeile in FEINDLICH und nicht hier.
 */

import type { Vector3 } from '@wov/shared';
import {
  ANIM_MEMBER,
  ANIM_EINMAL_MEMBER,
  naechstesEinmal,
  SPAWN_SIM_RADIUS,
  SPIELER_FRAKTION,
  VERFOLGUNG_ANTEIL,
  kiSchritt,
  neuerKiZustand,
  npcKampf,
  npcSteckbrief,
  hatKampfwerte,
  haltungZwischen,
  loeseNpcAuf,
  yawQuaternion,
  type AnimZustand,
  type KiSteckbrief,
  type KiZiel,
  type KiZustand,
} from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import { AnimKonflikt, nimmAnim } from './AnimBesitz.js';

/**
 * Wie oft der Umkreis abgesucht wird. Viermal je Sekunde ist reichlich:
 * Ein Spieler legt in 250 ms höchstens zwei Meter zurück, und die
 * Reichweiten liegen bei 3 bis 30 Metern. Jeden Tick zu suchen hiesse,
 * eine Radiusabfrage 60-mal je Sekunde und Spieler zu fahren, ohne dass
 * irgendjemand den Unterschied sähe.
 */
const PRUEF_INTERVALL_SEC = 0.25;

/**
 * Ab welcher Winkeländerung die Drehung wirklich geschrieben wird.
 *
 * Jedes Schreiben hebt die ZDO-Revision an und schickt das Objekt an alle
 * Clients in der Zone. Ein Riese, der einem stehenden Spieler folgt,
 * würde sonst viermal je Sekunde ein Update auslösen, obwohl sich sein
 * Blick um ein Hundertstel Grad geändert hat. Drei Grad sind bei neun
 * Metern Höhe knapp eine halbe Körperbreite an der Schulter — darunter
 * sieht es niemand.
 */
const DREH_SCHWELLE_RAD = (3 * Math.PI) / 180;

interface AggroZustand {
  /** Zuletzt geschriebene Blickrichtung (Bogenmass). */
  yaw: number;
  /** Zuletzt geschriebener Animationszustand. */
  anim: AnimZustand | null;
}

export interface AggroSystemOptionen {
  simRadius?: number;
  pruefIntervallSec?: number;
}

export class AggroSystem {
  private readonly zustand = new Map<string, AggroZustand>();
  /** Die KI-Zustandsmaschine je NPC, solange er jemanden im Blick hat. */
  private readonly ki = new Map<string, KiZustand>();
  /** Steckbrief je Prefab — aus den Kampfwerten, einmal gebaut. */
  private readonly steckbriefe = new Map<string, KiSteckbrief>();
  /**
   * NPCs, die gerade jemanden ins Auge gefasst haben. Der RoutenLaeufer
   * liest diese Menge und lässt sie in Ruhe — sonst schriebe er im selben
   * Tick 'walk' über das 'attack' und drehte den NPC zurück auf seinen
   * Weg. Zwei Systeme, die dieselbe ZDO steuern, brauchen eine klare
   * Vorfahrtsregel, und Kampf schlägt Spaziergang.
   */
  readonly gesperrt = new Set<string>();
  /** ZDOs whose animation conflict was already reported (once each). */
  private readonly konfliktGemeldet = new Set<string>();
  private readonly simRadius: number;
  private readonly pruefIntervallSec: number;
  private accum = 0;

  /**
   * Ein NPC schlägt zu: Position, Schaden, Radius (die Angriffsreichweite).
   * Verdrahtet die Welt, genau wie `SpawnSystem.onCreatureAttack`. Ohne
   * Rückruf bleibt die Haltung (Drehen, Verfolgen, Schlagbewegung) und der
   * Schaden entfällt.
   */
  onSchlag: ((pos: Vector3, schaden: number, radius: number) => void) | null = null;

  constructor(
    private readonly zdos: ZDOManager,
    /** Prefab-Name zu einem Hash — ohne ihn ist eine ZDO nur eine Zahl. */
    private readonly prefabName: (hash: number) => string | undefined,
    /**
     * Geländehöhe — IMMER die Quelle der Y-Koordinate, genau wie beim
     * RoutenLaeufer. Ein Verfolger, der die Höhe aus seiner alten
     * Position fortschriebe, liefe den Hügel waagerecht hinauf.
     */
    private readonly hoehe: (x: number, z: number) => number,
    optionen: AggroSystemOptionen = {}
  ) {
    this.simRadius = optionen.simRadius ?? SPAWN_SIM_RADIUS;
    this.pruefIntervallSec = optionen.pruefIntervallSec ?? PRUEF_INTERVALL_SEC;
  }

  /** Wie viele NPCs gerade jemanden verfolgen (Diagnose, Admin-Ausgabe). */
  get aggroCount(): number {
    return this.gesperrt.size;
  }

  /**
   * `zielInfo` (optional) ist parallel zu `peerPositions`: die stabile Kennung je Spieler. Ohne sie zählt der Listenindex,
   * und dann erbt der Spieler, der nach dem Abmelden eines anderen auf dessen Platz rutscht, dessen Aggro.
   */
  update(deltaSec: number, peerPositions: readonly Vector3[], zielInfo: readonly { readonly id: string }[] = []): void {
    this.accum += deltaSec;
    if (this.accum < this.pruefIntervallSec) return;
    // Die WIRKLICH vergangene Zeit, nicht das Intervall: Der Schritt des
    // Verfolgers wird damit integriert, und bei einem hängenden Tick
    // (Zonengenerierung, Save) sind das schnell 400 ms statt 250. Wer hier
    // das Intervall einsetzt, bekommt einen Verfolger, der bei Last
    // langsamer wird.
    const vergangen = this.accum;
    this.accum = 0;
    if (peerPositions.length === 0) {
      this.alleLoesen();
      return;
    }

    // Einmal alle Kandidaten einsammeln, statt je Spieler zu entscheiden:
    // Stehen zwei Spieler nebeneinander, taucht derselbe NPC sonst zweimal
    // auf und bekäme zwei widersprüchliche Blickrichtungen.
    const kandidaten = this.sucheKandidaten(peerPositions);
    const nochAktiv = new Set<string>();
    const ziele: KiZiel[] = peerPositions.map((p, i) => ({ key: zielInfo[i]?.id ?? `p${i}`, x: p.x, z: p.z }));

    for (const { zdo, name } of kandidaten.values()) {
      const key = zdo.zdoid.toString();
      // Die Entscheidung fällt in der Zustandsmaschine (shared/kiZustand.ts):
      // bemerkt (hindrehen) → anrennen (nachsetzen) → kämpfen (schlagen), mit
      // denselben Staffeln wie `aggroSchritt` der Editor-Vorschau. Hier bleibt
      // die Buchführung: Drosselung, ZDO-Member, Vorfahrt gegenüber dem RoutenLaeufer.
      const w = this.entscheide(key, name, zdo, ziele, vergangen);
      if (!w) {
        this.loese(key, zdo);
        continue;
      }
      // Same side as the route walker (they hand over via `gesperrt`), but
      // not the same as the SpawnSystem: a ZDO both would write is reported
      // once and left alone, instead of flipping between two states.
      try {
        nimmAnim(zdo, 'npc');
      } catch (e) {
        if (!(e instanceof AnimKonflikt)) throw e;
        if (!this.konfliktGemeldet.has(key)) {
          this.konfliktGemeldet.add(key);
          console.error(`[aggro] ${e.message} — not driven by the aggro system`);
        }
        continue;
      }
      nochAktiv.add(key);
      this.setze(key, zdo, w.yaw, w.anim);
      if (w.bewegt) this.ruecke(zdo, w.x, w.z);
      if (w.schlag && hatKampfwerte(name)) this.zuschlagen(zdo, w.schaden, w.angriff);
    }

    // Wer diesmal nicht dabei war, ist ausser Reichweite oder weg. Auch der
    // Zustand geht: Ein erschlagener NPC kommt nie wieder, und einer, der
    // aus dem Umkreis heraus war, fängt beim Wiedersehen mit vollem Takt an.
    for (const key of [...this.gesperrt]) {
      if (!nochAktiv.has(key)) {
        this.gesperrt.delete(key);
        this.zustand.delete(key);
        this.ki.delete(key);
      }
    }
  }

  /**
   * Ein Schlag ist fällig (der Takt läuft in der Zustandsmaschine).
   *
   * Der Schlag trifft jeden Spieler im Radius der Angriffsreichweite um den
   * NPC, nicht nur den nächsten — dieselbe Regel wie bei den Kreaturen. Wer
   * dabei pariert, bekommt keinen Schaden (`applyCreatureAttack`).
   */
  private zuschlagen(zdo: ZDO, schaden: number, angriff: number): void {
    // One-shot event: the client plays the swing once per blow, in step with
    // the damage — the state `attack` alone would be a loop.
    zdo.setString(ANIM_EINMAL_MEMBER, naechstesEinmal(zdo.getString(ANIM_EINMAL_MEMBER), 'attack'));
    this.onSchlag?.(zdo.position, schaden, angriff);
  }

  /**
   * Was dieser NPC jetzt tut, oder null (kein Ziel: loslassen). Die Schritte
   * und Anzeigen der drei Phasen entsprechen den Bändern von `aggroSchritt`.
   */
  private entscheide(
    key: string,
    name: string,
    zdo: ZDO,
    ziele: readonly KiZiel[],
    vergangen: number
  ): { yaw: number; anim: AnimZustand; bewegt: boolean; x: number; z: number; schlag: boolean; schaden: number; angriff: number } | null {
    let steck = this.steckbriefe.get(name);
    const kampf = npcKampf(name);
    if (!steck) {
      steck = npcSteckbrief(kampf, VERFOLGUNG_ANTEIL);
      this.steckbriefe.set(name, steck);
    }
    let ki = this.ki.get(key);
    if (!ki) {
      ki = neuerKiZustand();
      this.ki.set(key, ki);
    }
    const p = zdo.position;
    const b = kiSchritt(
      ki,
      steck,
      { x: p.x, z: p.z, yaw: 0, homeX: p.x, homeZ: p.z, ziele },
      vergangen,
      () => 0.5
    );
    if (b.phase === 'wandern') {
      this.ki.delete(key);
      return null;
    }
    const yaw = Math.atan2(b.blickX, b.blickZ);
    const anim: AnimZustand = b.phase === 'kaempfen' ? 'attack' : b.phase === 'anrennen' ? 'walk' : 'idle';
    let x = p.x;
    let z = p.z;
    let bewegt = false;
    if (b.bewegung === 'laeuft') {
      const weg = Math.min(kampf.tempo * vergangen, b.maxWeg);
      if (weg > 0) {
        x += b.dirX * weg;
        z += b.dirZ * weg;
        bewegt = true;
      }
    }
    return { yaw, anim, bewegt, x, z, schlag: b.schlag, schaden: kampf.schaden, angriff: kampf.angriff };
  }

  /**
   * Verfolger einen Schritt nachrücken lassen.
   *
   * Über `updateZDOZone` und nicht über `zdo.position = …`: Ein NPC, der
   * über eine Zonengrenze läuft, muss im Zonenindex umgehängt werden —
   * sonst bekämen ihn die Clients der neuen Zone nie zu sehen und die der
   * alten für immer. Genau dieselbe Zeile fährt der RoutenLaeufer.
   *
   * Die Revision wird JEDES MAL angehoben. Anders als beim Routenlauf ist
   * das keine Verschwendung: Der Aggro-Tick läuft ohnehin nur viermal je
   * Sekunde, also genau im Sync-Takt — eine zusätzliche Drossel würde die
   * Verfolgung nur ruckeln lassen.
   */
  private ruecke(zdo: ZDO, x: number, z: number): void {
    this.zdos.updateZDOZone(zdo, { x, y: this.hoehe(x, z), z });
    zdo.revision.reviseData();
    zdo.dirty = true;
  }

  /**
   * Feindliche NPCs im Umkreis der Spieler.
   *
   * Der Suchradius ist der SIM-Radius und nicht der Aggroradius des
   * einzelnen NPC: Der ist erst bekannt, wenn man das Prefab kennt, und
   * das kennt man erst nach der Suche. Der Sim-Radius ist die Obergrenze,
   * die auch die Kreaturen und der RoutenLaeufer verwenden; die feinere
   * Prüfung folgt oben je NPC.
   */
  private sucheKandidaten(peers: readonly Vector3[]): Map<string, { zdo: ZDO; name: string }> {
    const gefunden = new Map<string, { zdo: ZDO; name: string }>();
    for (const p of peers) {
      for (const zdo of this.zdos.getZDOsInRadius(p, this.simRadius)) {
        if (zdo.destroyed) continue;
        const key = zdo.zdoid.toString();
        if (gefunden.has(key)) continue;
        const name = this.prefabName(zdo.prefabHash);
        if (!name) continue;
        const einordnung = loeseNpcAuf(name);
        if (!einordnung) continue;
        if (haltungZwischen(einordnung.fraktion, SPIELER_FRAKTION) !== 'feindlich') continue;
        gefunden.set(key, { zdo, name });
      }
    }
    return gefunden;
  }

  /** Drehung und Animationszustand schreiben — nur bei Änderung. */
  private setze(key: string, zdo: ZDO, yaw: number, anim: AnimZustand): AggroZustand {
    let z = this.zustand.get(key);
    if (!z) {
      z = { yaw: Number.NaN, anim: null };
      this.zustand.set(key, z);
    }
    this.gesperrt.add(key);

    if (!(Math.abs(winkelDifferenz(yaw, z.yaw)) < DREH_SCHWELLE_RAD)) {
      z.yaw = yaw;
      zdo.rotation = yawQuaternion(yaw);
      zdo.revision.reviseData();
      zdo.dirty = true;
    }
    if (z.anim !== anim) {
      z.anim = anim;
      // setString hebt die Revision selbst an — der Wechsel geht damit
      // sofort raus und nicht erst beim nächsten Positionsupdate.
      zdo.setString(ANIM_MEMBER, anim);
    }
    return z;
  }

  /**
   * NPC aus dem Kampf entlassen: zurück auf 'idle', damit er nicht für
   * immer in der Schlagbewegung steht. Die DREHUNG bleibt, wie sie ist —
   * ein Riese, der einem nachsieht, bis man weg ist, wirkt richtiger als
   * einer, der beim Verlassen der Zone zurückschnappt. Läuft er eine
   * Route, richtet der RoutenLaeufer ihn beim nächsten Schritt ohnehin
   * wieder aus.
   */
  private loese(key: string, zdo: ZDO): void {
    const z = this.zustand.get(key);
    this.gesperrt.delete(key);
    this.ki.delete(key);
    if (!z) return;
    if (z.anim !== null && z.anim !== 'idle') {
      z.anim = 'idle';
      zdo.setString(ANIM_MEMBER, 'idle');
    }
    this.zustand.delete(key);
  }

  /** Alle loslassen (letzter Spieler weg). */
  private alleLoesen(): void {
    for (const key of [...this.gesperrt]) {
      const zdo = [...this.zdos.getAllZDOs()].find((z) => z.zdoid.toString() === key);
      if (zdo && !zdo.destroyed) this.loese(key, zdo);
      else {
        this.gesperrt.delete(key);
        this.zustand.delete(key);
        this.ki.delete(key);
      }
    }
  }
}

/** Kleinste Differenz zweier Winkel, auf -pi..pi normiert. */
function winkelDifferenz(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
