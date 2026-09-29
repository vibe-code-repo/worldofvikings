/**
 * The own figure's death and hit reaction, driven by the server.
 *
 * The server decides (WovServer): it sends `PlayerTod` once when this player dies and
 * `PlayerTreffer` for every confirmed blow that does not kill. This module only plays what it
 * is told:
 *
 *  - death: the figure plays `tod_vorn` / `tod_hinten` and stays lying; every game input is
 *    blocked (InputManager.gesperrt) until the server revives the player — the respawn arrives
 *    as a `Teleport` packet. A timer at lying time + 3 s is only the safety net for a server
 *    that never answers: the player must not stay locked for good;
 *  - hit: the upper-body reaction from the side the server names (AvatarRig.zeigeTreffer, which
 *    keeps the minimum gap between two reactions).
 *
 * Everything sits in this module (not in main.ts) — main.ts has a line budget.
 */
import { PacketType, TOD_LIEGEZEIT_MS, todClipVonIndex, trefferClipVonIndex } from '@wov/shared';
import type { TodClip } from '@wov/shared';

/** What the module needs of the network: register a handler per packet type. */
export interface TodTrefferSocket {
  on(type: PacketType, handler: (reader: { readInt32(): number; readonly remaining: number }) => void): void;
}

/** What the module needs of the figure. */
export interface TodTrefferFigur {
  starteTod(name: TodClip): boolean;
  endeTod(): void;
  zeigeTreffer(name: string): boolean;
}

/** What the module needs of the input. */
export interface TodTrefferEingabe {
  gesperrt: boolean;
}

/** Safety margin after the lying time before the client lets go of the lock on its own (ms). */
const RESERVE_MS = 3000;

export class TodTreffer {
  private tot = false;
  private uhr: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly eingabe: TodTrefferEingabe,
    private readonly figur: () => TodTrefferFigur | null,
    private readonly reserveMs = RESERVE_MS
  ) {}

  /** Dead and lying? */
  get liegt(): boolean {
    return this.tot;
  }

  /** The server says: you died. `clipIndex` is an index into TOD_CLIPS, an unknown one shows the forward fall. */
  beiTod(clipIndex: number, liegeMs: number): void {
    this.tot = true;
    this.eingabe.gesperrt = true;
    this.figur()?.starteTod(todClipVonIndex(clipIndex) ?? 'tod_vorn');
    if (this.uhr !== null) clearTimeout(this.uhr);
    const ms = Number.isFinite(liegeMs) && liegeMs > 0 ? liegeMs : TOD_LIEGEZEIT_MS;
    this.uhr = setTimeout(() => this.belebt(), ms + this.reserveMs);
  }

  /** The server says: you were struck from the side `clipIndex` names. */
  beiTreffer(clipIndex: number): void {
    const clip = trefferClipVonIndex(clipIndex);
    if (clip && !this.tot) this.figur()?.zeigeTreffer(clip);
  }

  /** The player is alive again (the respawn teleport arrived): input free, figure upright. */
  belebt(): void {
    if (this.uhr !== null) {
      clearTimeout(this.uhr);
      this.uhr = null;
    }
    if (!this.tot) return;
    this.tot = false;
    this.eingabe.gesperrt = false;
    this.figur()?.endeTod();
  }

  /** Hooks the three packets up. */
  verdrahte(socket: TodTrefferSocket): void {
    socket.on(PacketType.PlayerTod, (r) => {
      const clip = r.readInt32();
      this.beiTod(clip, r.remaining >= 4 ? r.readInt32() : TOD_LIEGEZEIT_MS);
    });
    socket.on(PacketType.PlayerTreffer, (r) => this.beiTreffer(r.readInt32()));
    // The revival is always a teleport (bed or start point); the packet itself is read by main.ts.
    socket.on(PacketType.Teleport, () => this.belebt());
  }
}
