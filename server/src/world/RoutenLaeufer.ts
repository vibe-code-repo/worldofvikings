/**
 * RoutenLaeufer — lässt platzierte NPCs eine feste Route ablaufen.
 *
 * Die Route selbst ist Weltdesign und steht im WorldLayout
 * (shared/worldlayout/types.ts, `routes`); hier läuft nur die Bewegung.
 * Sie gehört auf den SERVER, weil der die Wahrheit über Positionen hält:
 * Die Wegpunkte gehen nie an den Client, der bekommt ausschließlich das
 * Ergebnis über den normalen ZDO-Weg (Position + Rotation im Wire-Header,
 * Gangart als Member) — genau wie bei Kreaturen.
 *
 * Bewusst NEBEN dem SpawnSystem statt darin: Dessen Kreaturen wandern
 * zufällig um einen Anker und werden bei Spielerferne despawnt. Ein
 * Routen-NPC ist das Gegenteil — er ist gesetzt, persistent und folgt
 * einer Vorgabe. Beide in einer Zustandsmaschine zu mischen hieße, jede
 * Wander-/Flucht-/Chase-Regel um ein "außer bei Route" zu ergänzen.
 *
 * Gemeinsam mit dem SpawnSystem sind die zwei Sparmaßnahmen, die sich dort
 * bewährt haben:
 *   - Simulation nur, wenn ein Spieler in simRadius ist (sonst steht der
 *     NPC — sehen kann ihn ohnehin niemand, die Interest-Management-Zonen
 *     sind kleiner).
 *   - Die ZDO-Revision wird nur alle syncIntervalSec angehoben; sie ist
 *     das Weiterleitungs-Tor in syncZDOs, die Bewegung selbst läuft im
 *     vollen Tick.
 *
 * Die Wegmathematik selbst steht NICHT mehr hier, sondern in
 * shared/worldlayout/routenlauf.ts (`RoutenLauf`): Der Editor-Testflug
 * zeigt dieselbe Bewegung als Vorschau, und eine Vorschau, die anders
 * rechnet als der Server, wäre schlimmer als keine. Hier bleibt genau
 * das, was den Server ausmacht — ZDO, Spielernähe, Sync-Drossel.
 */

import type { Vector3, RouteDef, Gangart } from '@wov/shared';
import {
  ANIM_MEMBER,
  RoutenLauf,
  SPAWN_SIM_RADIUS,
  SPAWN_SYNC_INTERVAL_SEC,
  yawQuaternion,
} from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';

interface RoutenNpc {
  readonly zdo: ZDO;
  /** Laufzustand (Zielwegpunkt, Richtung) — die geteilte Mathematik. */
  readonly lauf: RoutenLauf;
  /** Akkumulator für die Revisions-Drossel. */
  syncAccum: number;
  /** Zuletzt gesetzte Gangart (null = noch nie gesetzt). */
  gangart: Gangart | null;
}

export interface RoutenLaeuferOptionen {
  simRadius?: number;
  syncIntervalSec?: number;
}

export class RoutenLaeufer {
  private readonly npcs = new Map<string, RoutenNpc>();
  private readonly simRadius: number;
  private readonly syncIntervalSec: number;

  constructor(
    private readonly zdos: ZDOManager,
    /** Geländehöhe — IMMER die Quelle der Y-Koordinate (getGroundHeight). */
    private readonly hoehe: (x: number, z: number) => number,
    optionen: RoutenLaeuferOptionen = {}
  ) {
    this.simRadius = optionen.simRadius ?? SPAWN_SIM_RADIUS;
    this.syncIntervalSec = optionen.syncIntervalSec ?? SPAWN_SYNC_INTERVAL_SEC;
  }

  get npcCount(): number {
    return this.npcs.size;
  }

  /**
   * NPCs, die das AggroSystem gerade führt — die lässt der Laeufer stehen.
   * Wird von aussen gesetzt, damit dieser Klasse das Kampfsystem nicht
   * bekannt sein muss: Sie sieht nur eine Menge von Schlüsseln.
   */
  gesperrt: ReadonlySet<string> | null = null;

  /**
   * NPC an eine Route hängen. Erneutes Registrieren derselben ZDO ist ein
   * No-Op — spawnLayoutPlacements läuft bei jedem Boot über alle Einträge,
   * findet gespeicherte NPCs wieder und würde sie sonst doppelt führen.
   *
   * Der Einstiegspunkt ist der NÄCHSTGELEGENE Wegpunkt statt immer der
   * erste (RoutenLauf-Konstruktor): Ein NPC aus dem Save steht irgendwo
   * mitten auf seiner Runde und liefe sonst quer durch die Landschaft zum
   * Anfang zurück.
   */
  registriere(zdo: ZDO, route: RouteDef): void {
    const key = zdo.zdoid.toString();
    if (this.npcs.has(key)) return;
    this.npcs.set(key, {
      zdo,
      lauf: new RoutenLauf(route, zdo.position.x, zdo.position.z),
      syncAccum: 0,
      gangart: null,
    });
  }

  /** Bewegungsschritt aller Routen-NPCs (aus der Server-Hauptschleife). */
  update(deltaSec: number, peerPositions: readonly Vector3[]): void {
    if (this.npcs.size === 0 || peerPositions.length === 0) return;
    const simSqr = this.simRadius * this.simRadius;

    for (const [key, npc] of this.npcs) {
      // Extern zerstört (Admin-Abbau, verwaiste Platzierung): aufräumen.
      if (npc.zdo.destroyed) {
        this.npcs.delete(key);
        continue;
      }
      if (!this.spielerNah(npc.zdo.position, peerPositions, simSqr)) continue;
      // Vorfahrt für den Kampf: Wer gerade jemanden ins Auge gefasst hat,
      // läuft nicht weiter. Ohne diese Zeile schriebe der Laeufer im
      // selben Tick 'walk' über das 'attack' des AggroSystems und drehte
      // den NPC zurück auf seinen Weg — er liefe schlagend im Kreis.
      if (this.gesperrt?.has(key)) {
        // Und der gemerkte Gangart-Wert wird VERWORFEN. Er ist ein
        // Zwischenspeicher für „was steht im ZDO-Member" (s.
        // `setzeGangart`), und solange das AggroSystem die ZDO führt,
        // schreibt es dort 'idle' und 'attack' hinein, ohne dass der
        // Laeufer davon erfährt. Ohne das Verwerfen hält der Vergleich in
        // `setzeGangart` beim Weiterlaufen an seinem alten 'walk' fest
        // und schreibt NIE WIEDER — der NPC gleitet dann in der Ruhepose
        // über seine Route.
        //
        // Am Furloc-Krieger gemessen: Er läuft mit 0,52 m/s sichtbar
        // seine Runde, und der Client spielt dabei `idle`, weil im
        // Member noch das 'idle' des letzten Aggro-Endes steht.
        npc.gangart = null;
        continue;
      }

      const bewegt = this.laufeSchritt(npc, deltaSec);
      this.setzeGangart(npc, bewegt ? 'walk' : 'idle');
      // Ein stehender NPC braucht keine Weiterleitung: Der WECHSEL auf
      // 'idle' hebt die Revision selbst an (setString), damit geht auch
      // die letzte Position vor dem Halt noch raus. Ohne diese Abkürzung
      // würde ein Standposten für immer im 4-Hz-Takt neu verschickt.
      if (!bewegt) continue;

      npc.syncAccum += deltaSec;
      if (npc.syncAccum >= this.syncIntervalSec) {
        npc.syncAccum -= this.syncIntervalSec;
        npc.zdo.revision.reviseData();
        npc.zdo.dirty = true;
      }
    }
  }

  /**
   * Ein Tick entlang der Route. Gibt zurück, ob sich der NPC bewegt hat —
   * das ist zugleich die Antwort auf "steht oder läuft".
   *
   * Gerechnet wird in `RoutenLauf` (shared); hier wird das Ergebnis nur
   * noch in die ZDO geschrieben. Die Höhe kommt IMMER aus dem Gelände und
   * nie aus der Route — deshalb reicht die geteilte Mathematik xz zurück.
   */
  private laufeSchritt(npc: RoutenNpc, deltaSec: number): boolean {
    const start = npc.zdo.position;
    const s = npc.lauf.schritt(start.x, start.z, deltaSec);
    if (!s.bewegt) return false;
    this.zdos.updateZDOZone(npc.zdo, { x: s.x, y: this.hoehe(s.x, s.z), z: s.z });
    npc.zdo.rotation = yawQuaternion(s.yaw);
    return true;
  }

  /**
   * Gangart an die ZDO schreiben — nur bei ÄNDERUNG: setString hebt die
   * Datenrevision an, ein Schreiben pro Tick würde die 4-Hz-Drossel
   * aushebeln und jede Bewegung sofort verschicken.
   */
  private setzeGangart(npc: RoutenNpc, gangart: Gangart): void {
    if (npc.gangart === gangart) return;
    npc.gangart = gangart;
    npc.zdo.setString(ANIM_MEMBER, gangart);
  }

  private spielerNah(pos: Vector3, peers: readonly Vector3[], rSqr: number): boolean {
    for (const p of peers) {
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      if (dx * dx + dz * dz <= rSqr) return true;
    }
    return false;
  }
}
