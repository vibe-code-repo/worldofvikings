/**
 * Zwischengespeichertes Sichtfenster eines Peers (D7).
 *
 * `syncZDOs` lief alle 50 ms je Peer über 81 Zonen und zählte jede ZDO darin
 * an — auch wenn sich weder der Peer noch der Zoneninhalt seit dem letzten
 * Tick bewegt hatte. Bei 48.000 ZDOs und einem Dutzend Spielern ist das der
 * Löwenanteil der Sync-Kosten, und er fällt 20×/s an.
 *
 * Das Fenster hält die eingesammelte Liste fest und baut sie nur neu auf,
 * wenn der Peer die Zone wechselt ODER eine der 81 Zonen ihren Bestand
 * geändert hat. Letzteres verrät der Generationszähler im ZDOManager: die
 * Prüfung kostet 81 Zahlenvergleiche statt 81 Set-Durchläufen.
 *
 * Bewusst konservativ: Der Zähler steigt bei JEDEM Zu- und Abgang einer Zone,
 * also auch bei einer Kreatur, die nur eine Zonengrenze überschreitet. Lieber
 * einmal zu viel neu sammeln als ein frisch gespawntes Objekt übersehen — ein
 * überflüssiger Neuaufbau kostet exakt das, was der alte Code IMMER tat.
 *
 * Die Liste ist nach RINGEN sortiert (Chebyshev-Abstand 0, 1, 2, …): Damit
 * ist die Entfernungspriorisierung des Bandbreitenbudgets (D6) geschenkt —
 * wer die Liste von vorn abarbeitet und beim Budget aufhört, hat automatisch
 * das Nahe zuerst geschickt. Innerhalb eines Rings ist die Reihenfolge egal,
 * eine Zone ist nur 64 m breit.
 */

import type { ZDO } from './ZDO.js';
import type { ZDOManager } from './ZDOManager.js';

export class ZonenFenster {
  private zoneX = NaN;
  private zoneY = NaN;
  private radius = -1;
  /** Generation je Fensterzone, in derselben Reihenfolge wie `ringe`. */
  private gen = new Int32Array(0);
  /** Ringweise sortierte (dx, dy)-Paare, flach: [dx0, dy0, dx1, dy1, …]. */
  private ringe = new Int32Array(0);
  private liste: ZDO[] = [];

  /**
   * Die ZDOs im Sichtfenster, nahe Zonen zuerst. Das Ergebnis gehört dem
   * Fenster und darf NICHT verändert werden — es überlebt bis zum nächsten
   * Neuaufbau.
   */
  hole(zdos: ZDOManager, zoneX: number, zoneY: number, radius: number): readonly ZDO[] {
    if (radius !== this.radius) this.baueRinge(radius);

    const anzahl = this.ringe.length / 2;
    let gueltig = zoneX === this.zoneX && zoneY === this.zoneY;
    if (gueltig) {
      for (let i = 0; i < anzahl; i++) {
        const g = zdos.zonenGeneration(zoneX + this.ringe[i * 2]!, zoneY + this.ringe[i * 2 + 1]!);
        if (g !== this.gen[i]) {
          gueltig = false;
          break;
        }
      }
    }
    if (gueltig) return this.liste;

    this.zoneX = zoneX;
    this.zoneY = zoneY;
    this.liste.length = 0;
    for (let i = 0; i < anzahl; i++) {
      const zx = zoneX + this.ringe[i * 2]!;
      const zy = zoneY + this.ringe[i * 2 + 1]!;
      this.gen[i] = zdos.zonenGeneration(zx, zy);
      const menge = zdos.zdosInZoneXY(zx, zy);
      if (!menge) continue;
      for (const zdo of menge) this.liste.push(zdo);
    }
    return this.liste;
  }

  /**
   * (dx, dy) aller Fensterzonen, nach Chebyshev-Abstand aufsteigend. Einmal
   * je Radius gebaut; der Radius ist heute konstant, aber ein Fenster, das
   * sich beim ersten Aufruf still auf den falschen Radius festlegt, wäre ein
   * unauffindbarer Fehler.
   */
  private baueRinge(radius: number): void {
    this.radius = radius;
    const paare: number[] = [];
    for (let ring = 0; ring <= radius; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          paare.push(dx, dy);
        }
      }
    }
    this.ringe = Int32Array.from(paare);
    this.gen = new Int32Array(paare.length / 2);
    this.zoneX = NaN; // erzwingt den Neuaufbau im selben Aufruf
  }
}
