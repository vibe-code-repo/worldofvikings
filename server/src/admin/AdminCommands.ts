/**
 * AdminCommands — extensible admin command registry.
 *
 * Long-term admin concept: clients send a single command line via
 * PacketType.AdminCommand (e.g. "fly", later "teleport x y z", "god", ...).
 * The registry parses the first token and dispatches to the registered
 * handler; the result goes back to the requesting peer as AdminEvent
 * (command / active / message) so the client HUD mirrors server state.
 *
 * PERMISSIONS: gated on `peer.isAdmin`, which the NetManager sets at the
 * handshake. Since 2026-09-13 `players.everyone-admin` is `false` in the
 * committed server.yml, so that flag no longer hands rights to everybody:
 * what grants them is the persistent admin list keyed by spielerId
 * (server/src/admin/AdminListe.ts), seeded by the `admin: true` account in
 * `standard-konto:`. This gate is therefore a real one — all commands
 * funnel through canUseAdminCommands() below.
 */

import { HeightmapProvider, WATER_LEVEL } from '@wov/shared';
import { instanzName } from '@wov/shared/src/instanz.js';
import type { Peer } from '../net/Peer.js';
import {
  MAX_RADIUS_ZONEN,
  formatiereErgebnis,
  ruecksetzerErlaubt,
} from '../world/zonenRuecksetzer.js';
import type { ZonenErgebnis } from '../world/zonenRuecksetzer.js';

export interface AdminResult {
  ok: boolean;
  /** Resulting toggle state for toggle-style commands (e.g. fly on/off). */
  active: boolean;
  message: string;
}

export type AdminCommandHandler = (peer: Peer, args: string[]) => AdminResult;

/**
 * Single permission gate for all admin commands. `peer.isAdmin` is decided
 * once, at the handshake, from `players.everyone-admin` OR the persistent
 * admin list — so a rights change reaches a player with their next connect,
 * not mid-session. Per-command permissions, if ever needed, belong here.
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
  /**
   * Setzt die Zonen im Quadrat um die Zone (zx, zy) zurück (`zone reset`).
   * Fehlt sie, gibt es den Befehl in dieser Umgebung nicht.
   */
  zonenRuecksetzen?(zx: number, zy: number, radius: number): ZonenErgebnis[];
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

    this.register('zone', (_peer, args) => this.zoneBefehl(args));

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
     * sonst landet man beim Klick aufs Meer auf dem Grund. Der
     * Debug-Teleport des Vorbilds klemmt genauso (Heightmap-Höhe, dann
     * gegen den Meeresspiegel geklemmt; dort liegt der bei 0, bei uns bei
     * WATER_LEVEL).
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

  /**
   * `zone reset <x> <z> [radiusInZonen=0]` — Streuung schon erzeugter Zonen
   * neu würfeln (Weltkoordinaten). Nur auf der Dev-Instanz oder mit
   * `WOV_ZONEN_RUECKSETZER=1`; was dabei stehen bleibt und was abgelehnt
   * wird, steht in `world/zonenRuecksetzer.ts`.
   */
  private zoneBefehl(args: string[]): AdminResult {
    const aufruf = `Aufruf: zone reset <x> <z> [radiusInZonen=0] (Weltkoordinaten, Radius 0..${MAX_RADIUS_ZONEN})`;
    if (args[0]?.toLowerCase() !== 'reset') return { ok: false, active: false, message: aufruf };
    let erlaubt = false;
    try {
      erlaubt = ruecksetzerErlaubt(instanzName(), process.env.WOV_ZONEN_RUECKSETZER);
    } catch {
      erlaubt = false;
    }
    if (!erlaubt || !this.umgebung?.zonenRuecksetzen) {
      return {
        ok: false,
        active: false,
        message: 'zone reset ist nur auf der Dev-Instanz erlaubt (oder mit WOV_ZONEN_RUECKSETZER=1)',
      };
    }
    const x = Number(args[1]);
    const z = Number(args[2]);
    const radius = args[3] === undefined ? 0 : Number(args[3]);
    if (
      args[1] === undefined ||
      args[2] === undefined ||
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !Number.isInteger(radius) ||
      radius < 0 ||
      radius > MAX_RADIUS_ZONEN
    ) {
      return { ok: false, active: false, message: aufruf };
    }
    const ergebnisse = this.umgebung.zonenRuecksetzen(
      HeightmapProvider.worldToZone(x),
      HeightmapProvider.worldToZone(z),
      radius
    );
    return {
      ok: ergebnisse.some((e) => e.status === 'neu-gestreut'),
      active: false,
      message: formatiereErgebnis(ergebnisse),
    };
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
