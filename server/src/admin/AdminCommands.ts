/**
 * AdminCommands — extensible admin command registry.
 *
 * Long-term admin concept: clients send a single command line via
 * PacketType.AdminCommand (e.g. "fly", later "teleport x y z", "god", ...).
 * The registry parses the first token and dispatches to the registered
 * handler; the result goes back to the requesting peer as AdminEvent
 * (command / active / message) so the client HUD mirrors server state.
 *
 * PERMISSIONS: gated on `peer.isAdmin`, which the NetManager sets from the
 * server config (`players.everyone-admin`). The project currently runs with
 * everyone-admin: true, so the admin mode is effectively unprotected — to
 * lock it down later, set everyone-admin: false and grant peer.isAdmin from
 * the admin list instead. All commands funnel through the single gate
 * canUseAdminCommands() below.
 */

import { WATER_LEVEL } from '@wov/shared';
import type { Peer } from '../net/Peer.js';

export interface AdminResult {
  ok: boolean;
  /** Resulting toggle state for toggle-style commands (e.g. fly on/off). */
  active: boolean;
  message: string;
}

export type AdminCommandHandler = (peer: Peer, args: string[]) => AdminResult;

/**
 * Single permission gate for all admin commands.
 * Currently everyone is admin (server config `players.everyone-admin: true`);
 * tighten here (admin list, per-command permissions) when needed.
 */
export function canUseAdminCommands(peer: Peer): boolean {
  return peer.isAdmin;
}

/**
 * Weltzugriffe, die einzelne Befehle brauchen. Als Schnittstelle statt
 * als direkte Server-Referenz, damit die Registry für sich testbar bleibt.
 */
export interface AdminUmgebung {
  /** Bodenhöhe an einer Weltstelle (für `teleport`). */
  bodenHoehe(x: number, z: number): number;
}

export class AdminCommandRegistry {
  private handlers = new Map<string, AdminCommandHandler>();

  constructor(private readonly umgebung?: AdminUmgebung) {
    this.register('fly', (peer) => {
      peer.flying = !peer.flying;
      return {
        ok: true,
        active: peer.flying,
        message: peer.flying
          ? 'Fly mode ON (Space up, Ctrl/C down, Shift fast)'
          : 'Fly mode OFF',
      };
    });

    /**
     * `teleport <x> <z>` — den Spieler an eine Weltstelle versetzen.
     *
     * MUSS serverseitig laufen: Die Spielerbewegung ist
     * server-autoritativ (`handlePlayerInput` rechnet aus `peer.position`
     * weiter). Ein rein clientseitiger Sprung würde beim nächsten
     * Input-Tick wieder eingesammelt. Der Client setzt seine Position
     * zusätzlich sofort selbst, damit die Kamera nicht erst auf die
     * Serverantwort wartet.
     *
     * Die Höhe kommt aus der Heightmap, aber mindestens Wasserlinie —
     * sonst landet man beim Klick aufs Meer auf dem Grund. Valheim macht
     * es genauso (`Minimap.DebugTeleport`: `Heightmap.GetHeight` dann
     * `Math.max(0f, height)`; dort liegt der Meeresspiegel bei 0, bei uns
     * bei WATER_LEVEL).
     */
    this.register('teleport', (peer, args) => {
      const x = Number(args[0]);
      const z = Number(args[1]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return { ok: false, active: false, message: 'Aufruf: teleport <x> <z>' };
      }
      const boden = this.umgebung?.bodenHoehe(x, z) ?? 0;
      const y = Math.max(boden, WATER_LEVEL);
      peer.position = { x, y, z };
      return {
        ok: true,
        active: false,
        message: `Teleportiert nach ${x.toFixed(0)}, ${z.toFixed(0)} (Höhe ${y.toFixed(1)})`,
      };
    });
  }

  register(name: string, handler: AdminCommandHandler): void {
    this.handlers.set(name.toLowerCase(), handler);
  }

  /** Execute a raw command line ("fly", "teleport 1 2 3", ...) for a peer. */
  execute(peer: Peer, line: string): AdminResult {
    if (!canUseAdminCommands(peer)) {
      return { ok: false, active: false, message: 'Admin commands are not allowed for this player' };
    }
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (!name) {
      return { ok: false, active: false, message: 'Empty admin command' };
    }
    const handler = this.handlers.get(name);
    if (!handler) {
      return { ok: false, active: false, message: `Unknown admin command: ${name}` };
    }
    return handler(peer, tokens);
  }
}
