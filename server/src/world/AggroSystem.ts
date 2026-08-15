/**
 * AggroSystem — feindliche NPCs wenden sich dem Spieler zu und schlagen zu.
 *
 * Erster Ausbaustufe des Kampfsystems: WAHRNEHMUNG und HALTUNG, noch kein
 * Schaden. Ein NPC, dem der Spieler zu nahe kommt, dreht sich zu ihm; wer
 * noch näher kommt, wird angegriffen. Trefferpunkte, Abklingzeiten und
 * Schadenspakete kommen später — die Naht dafür ist unten markiert.
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
  SPAWN_SIM_RADIUS,
  SPIELER_FRAKTION,
  aggroSchritt,
  haltungZwischen,
  loeseNpcAuf,
  yawQuaternion,
  type AnimZustand,
} from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';

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
  /**
   * NPCs, die gerade jemanden ins Auge gefasst haben. Der RoutenLaeufer
   * liest diese Menge und lässt sie in Ruhe — sonst schriebe er im selben
   * Tick 'walk' über das 'attack' und drehte den NPC zurück auf seinen
   * Weg. Zwei Systeme, die dieselbe ZDO steuern, brauchen eine klare
   * Vorfahrtsregel, und Kampf schlägt Spaziergang.
   */
  readonly gesperrt = new Set<string>();
  private readonly simRadius: number;
  private readonly pruefIntervallSec: number;
  private accum = 0;

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

  update(deltaSec: number, peerPositions: readonly Vector3[]): void {
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

    for (const { zdo, name } of kandidaten.values()) {
      const key = zdo.zdoid.toString();
      // Die Entscheidung selbst fällt in shared/aggro.ts — derselbe Code,
      // den der Editor-Testflug rechnet. Hier bleibt nur die Buchführung:
      // Drosselung, ZDO-Member, Vorfahrt gegenüber dem RoutenLaeufer.
      const w = aggroSchritt(name, zdo.position.x, zdo.position.z, peerPositions, vergangen);
      if (!w) {
        this.loese(key, zdo);
        continue;
      }
      nochAktiv.add(key);
      this.setze(key, zdo, w.yaw, w.anim);
      if (w.bewegt) this.ruecke(zdo, w.x, w.z);
    }

    // Wer diesmal nicht dabei war, ist ausser Reichweite oder weg.
    for (const key of [...this.gesperrt]) {
      if (!nochAktiv.has(key)) this.gesperrt.delete(key);
    }
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
  private setze(key: string, zdo: ZDO, yaw: number, anim: AnimZustand): void {
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
