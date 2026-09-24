/**
 * The swing clock of the editor test flight.
 *
 * Online the server writes a one-shot event (`animEinmal` = `attack#n`) at
 * every blow (AggroSystem.zuschlagen); the client plays the swing from that
 * event, the state `attack` alone only means "in striking range". The route
 * preview has no server, so it keeps the same clock itself: it runs while the
 * NPC is in the attack band, one event per `takt` seconds, and starts again
 * from zero when the NPC leaves it — the rule of AggroSystem.zuschlagen.
 *
 * DOM-free, so it is tested without a scene.
 */

import { formatEinmal } from '@wov/shared';

export class SchlagTakt {
  private readonly zustand = new Map<number, { n: number; akku: number }>();

  /**
   * One step for placement `index`. Returns the value of `animEinmal` to draw
   * with (undefined until the first blow). The counter never goes back, so a
   * new attack episode continues counting and the client sees a change.
   */
  schritt(index: number, schlaegt: boolean, deltaSec: number, takt: number): string | undefined {
    let z = this.zustand.get(index);
    if (!z) {
      z = { n: 0, akku: 0 };
      this.zustand.set(index, z);
    }
    if (!schlaegt) {
      z.akku = 0;
    } else {
      z.akku += deltaSec;
      if (z.akku >= takt) {
        // The rest above one beat stays, capped at one beat (a slow frame
        // must not fire two blows at once) — as on the server.
        z.akku = Math.min(z.akku - takt, takt);
        z.n++;
      }
    }
    return z.n > 0 ? formatEinmal('attack', z.n) : undefined;
  }

  /** Forget everything (indices shift when a placement is deleted). */
  vergiss(): void {
    this.zustand.clear();
  }
}
