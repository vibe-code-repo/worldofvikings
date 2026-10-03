/**
 * BlockSteuerung.ts (D3-K3) — the client side of holding a block: right mouse button HELD = block.
 * Der Client-Teil des Blockens: rechte Maustaste HALTEN = Block.
 *
 * DOM-free and without Babylon, so every rule is testable. `main.ts` only feeds it the per-frame state
 * (`BlockUmfeld`) and the events (blur, server message), `PlayerController` and `AvatarRig` read the result.
 *
 *  - Start: the right button went down this frame, under a captured pointer, and no row of the conflict
 *    table (`BLOCK_SPERREN`) forbids it. A button that is merely still held (stuck after a lost pointer
 *    lock, which sends no mouseup) never starts a block: it needs a fresh press.
 *  - Hold: as long as the button is down and no row forbids it.
 *  - End: release, a row of the table, `blur`, loss of the pointer lock (a row), `Block=false` from the
 *    server (it ended or refused the block), an own swing.
 *  - Send: `sendBlock(true|false)` exactly once per change of state, never twice in a row the same value.
 *  - Uncertain state: after `Block=false` from the server (it may belong to an older block, a new one may have been accepted
 *    since) or after a hard reset (teleport, world change, respawn) the client no longer knows what the server holds. It
 *    then sends one more `Block(false)` (idempotent at the server): at the next release, after a reset at once.
 *  - A swing and a press in the same frame: the swing wins, no block starts in that frame.
 *  - If the line is down (`sende` returns false) the start is dropped: the client never blocks without the server knowing.
 *
 * Provisional rule (Mike, 02.10.2026, open question): no block with bare hands (only with an item in the
 * hand) and none with a building tool (`pieceTable`) in the hand.
 */
import { bewegungsTempo } from '@wov/shared/src/bewegung/masse.js';

/** How fast the figure turns to the camera while it blocks (rad/s): 540 deg/s, 180 deg in 0.33 s. */
export const BLOCK_TURN_SPEED = (540 * Math.PI) / 180;

/** What the main loop knows about the moment. */
export interface BlockUmfeld {
  /** The right button is down (level). */
  readonly rechtsGedrueckt: boolean;
  /** The right button went down since the last frame (edge). */
  readonly rechtsFlanke: boolean;
  /** The pointer is captured by the game. */
  readonly zeigerGefangen: boolean;
  /** A window that needs the cursor is open (`cursorNoetig`). */
  readonly fensterOffen: boolean;
  /** Placing decor (the right button cancels there). */
  readonly dekorPlatzieren: boolean;
  /** Build mode (editor test flight). */
  readonly baumodus: boolean;
  /** A building piece is chosen: the click belongs to the tool. */
  readonly bauteilGewaehlt: boolean;
  /** The item in the right hand is a building tool (`pieceTable`). */
  readonly bauwerkzeug: boolean;
  /** Something is in the right hand. */
  readonly gegenstandInHand: boolean;
  readonly tot: boolean;
  readonly imWasser: boolean;
  /** D3-K4: a roll is running (no block during it); absent = false. */
  readonly rollt?: boolean;
}

/** One row of the conflict table: why a block is not allowed. */
export interface BlockSperre {
  readonly id: string;
  readonly grund: string;
  readonly gilt: (u: BlockUmfeld) => boolean;
}

/**
 * The conflict table of the right click (planner report D3, 2.6). The first row that applies wins.
 * Reihenfolge = Rangfolge; jede Zeile ein Fall im Test.
 */
export const BLOCK_SPERREN: readonly BlockSperre[] = [
  { id: 'tot', grund: 'dead', gilt: (u) => u.tot },
  { id: 'baumodus', grund: 'build mode (test flight)', gilt: (u) => u.baumodus },
  { id: 'zeiger-frei', grund: 'pointer not captured', gilt: (u) => !u.zeigerGefangen },
  { id: 'fenster-offen', grund: 'a window needs the cursor', gilt: (u) => u.fensterOffen },
  { id: 'dekor-platzieren', grund: 'decor placing (right click cancels)', gilt: (u) => u.dekorPlatzieren },
  { id: 'bauteil-gewaehlt', grund: 'building piece chosen (click belongs to the tool)', gilt: (u) => u.bauteilGewaehlt },
  { id: 'leere-hand', grund: 'nothing in the hand', gilt: (u) => !u.gegenstandInHand },
  { id: 'bauwerkzeug', grund: 'building tool in the hand', gilt: (u) => u.bauwerkzeug },
  { id: 'wasser', grund: 'in the water', gilt: (u) => u.imWasser },
  { id: 'rolle', grund: 'a roll is running', gilt: (u) => u.rollt === true },
];

/** The id of the first row that forbids a block, or null when it is allowed. */
export function blockSperre(u: BlockUmfeld): string | null {
  return BLOCK_SPERREN.find((z) => z.gilt(u))?.id ?? null;
}

/** Direction of the walk relative to the view, for the clip choice. */
export type BlockRichtung = 'steht' | 'vor' | 'rueck' | 'seit';

/**
 * From the input axes (x = A -1 .. D +1, z = S -1 .. W +1): forward and diagonal-forward count as forward,
 * backward and diagonal-backward as backward, pure A/D as sideways. The figure looks along the camera while
 * it blocks, so the axes ARE the direction relative to the figure.
 */
export function blockRichtung(mx: number, mz: number): BlockRichtung {
  if (mz > 0) return 'vor';
  if (mz < 0) return 'rueck';
  return mx !== 0 ? 'seit' : 'steht';
}

/** The speed of one step while blocking or not, in m/s: the one function of the shared step. */
export function blockSchrittTempo(rennt: boolean, blockt: boolean): number {
  return bewegungsTempo(rennt, blockt);
}

/** Turn `ist` towards `ziel` (both rad) by at most `tempo * dt`, the short way round. */
export function dreheZu(ist: number, ziel: number, tempo: number, dt: number): number {
  const roh = ziel - ist;
  const diff = Math.atan2(Math.sin(roh), Math.cos(roh));
  const schritt = tempo * dt;
  return ist + (Math.abs(diff) <= schritt ? diff : Math.sign(diff) * schritt);
}

export class BlockSteuerung {
  private _blockt = false;
  /** The server may hold a block the client does not believe in: one more `Block(false)` is due. */
  private ungewiss = false;
  /** ... and it is due at once, not only at the next release (after a reset). */
  private sofort = false;
  /** An own swing came in this frame: no block starts before the next one. */
  private schlagImBild = false;
  /** Measuring cell: the block holds without the mouse (see `erzwinge`). */
  private erzwungen = false;

  /** @param sende `sendBlock`: called once per change of state. */
  constructor(private readonly sende: (an: boolean) => void | boolean) {}

  /** Is the figure blocking right now (what the controller and the rig show)? */
  get blockt(): boolean {
    return this._blockt;
  }

  /** Once per frame with the state of the moment. */
  aktualisiere(u: BlockUmfeld): void {
    const verboten = blockSperre(u) !== null;
    const schlag = this.schlagImBild;
    this.schlagImBild = false;
    if (this._blockt) {
      if (!(u.rechtsGedrueckt || this.erzwungen) || verboten) this.beende();
      return;
    }
    if (this.ungewiss && (this.sofort || !(u.rechtsGedrueckt || this.erzwungen))) {
      this.ungewiss = false;
      this.sofort = false;
      this.sende(false);
    }
    if (u.rechtsFlanke && u.rechtsGedrueckt && !verboten && !schlag && this.sende(true) !== false) {
      this._blockt = true;
    }
  }

  /** The server ended or refused the block (`Block=false`): no answer back, the server knows. */
  serverBeendet(): void {
    this._blockt = false;
    this.erzwungen = false;
    this.ungewiss = true;
  }

  /** Teleport, world change, respawn, new connection: forget the block and make sure the server does too. */
  zuruecksetzen(): void {
    this._blockt = false;
    this.erzwungen = false;
    this.ungewiss = true;
    this.sofort = true;
  }

  /**
   * Measuring cell (`window.__dbg.blocke`): switch the block on or off like the held button would, without
   * the mouse. The rows of the table still end it, the same `sende` rule holds (once per change).
   */
  erzwinge(an: boolean): void {
    if (an === this._blockt) return;
    this._blockt = an;
    this.erzwungen = an;
    this.sende(an);
  }

  /** The window lost the focus: no mouseup will come. */
  blur(): void {
    this.beende();
  }

  /** An own swing ends the block (the server does the same). */
  schlag(): void {
    this.beende();
    this.schlagImBild = true;
  }

  private beende(): void {
    if (!this._blockt) return;
    this._blockt = false;
    this.erzwungen = false;
    this.sende(false);
  }
}
