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
 *  - Every begin costs `BLOCK_BEGINN_AUSDAUER` stamina, like at the server: below that no block starts (the `zuErschoepft` hook
 *    shows the server's message), a begin calls `beginnt` (the caller charges the stamina). Holding is not affected.
 *
 *  - A roll (key Q) HIDES the block, it does not end it: the server ends the block when it accepts the roll (and says
 *    `Block=false`), so a refused roll (wall, rock, water edge, jitter) leaves the guard where it was. While the roll is
 *    predicted `verdeckt` is set: the figure shows no block, nothing is sent. `Rolle=false` (`rolleAbgelehnt`) brings the
 *    block back as soon as the roll is over in the client, without a new `Block(true)` and without the 5 stamina; a
 *    release, a row of the table or `Block=false` ends it as usual (a release sends `Block(false)`: the server still holds it).
 *
 * Provisional rule (Mike, 02.10.2026, open question): no block with bare hands (only with an item in the
 * hand) and none with a building tool (`pieceTable`) in the hand.
 */
import { bewegungsTempo } from '@wov/shared/src/bewegung/masse.js';
import { BLOCK_BEGINN_AUSDAUER } from '@wov/shared/src/kampf/block.js';

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
  /** The predicted stamina (0..100): a begin needs `BLOCK_BEGINN_AUSDAUER`. */
  readonly ausdauer: number;
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
  /** A roll hides the block (the server still holds it until it accepts the roll). */
  private verdeckt = false;
  /** The server refused the roll: the hidden block comes back when the roll is over in the client. */
  private wiederNehmen = false;
  /** The hidden block ended without an answer: the server may still hold it, and a late `Rolle=false` says so. */
  private spaetOffen = false;
  /** A late `Rolle=false` came: the block is shown again at the next frame if the button is still held. */
  private spaetWieder = false;

  /** @param sende `sendBlock`: called once per change of state. */
  constructor(
    private readonly sende: (an: boolean) => void | boolean,
    private readonly haken: { zuErschoepft?(): void; beginnt?(): void } = {}
  ) {}

  /** Is the figure blocking right now (what the controller and the rig show)? */
  get blockt(): boolean {
    return this._blockt;
  }

  /** Once per frame with the state of the moment. */
  aktualisiere(u: BlockUmfeld): void {
    const verboten = blockSperre(u) !== null;
    const schlag = this.schlagImBild;
    this.schlagImBild = false;
    if (this.verdeckt) {
      // Other rows than the roll's own end the hidden block; a release does too (the server may still hold it).
      if (!(u.rechtsGedrueckt || this.erzwungen) || blockSperre({ ...u, rollt: false }) !== null) {
        this.verdeckt = false;
        this.wiederNehmen = false;
        this.erzwungen = false;
        this.sende(false);
      } else if (!u.rollt) {
        // The roll is over in the client: refused = the block is back, accepted = the server ended it (`Block=false` came).
        if (this.wiederNehmen) this._blockt = true;
        // No answer by now: the server may still hold the block (a late `Rolle=false`): one more `Block(false)` at the release.
        else { this.ungewiss = true; this.spaetOffen = true; }
        this.verdeckt = false;
        this.wiederNehmen = false;
      }
      return;
    }
    if (this.spaetWieder) {
      // The server refused the roll long after the predicted one ended: it holds the block, so the client shows it again
      // (button still held) without a new Block(true) and without stamina.
      this.spaetWieder = false;
      this.spaetOffen = false;
      if (!this._blockt && !verboten && (u.rechtsGedrueckt || this.erzwungen)) {
        this._blockt = true;
        this.ungewiss = false;
        this.sofort = false;
        return;
      }
    }
    if (this._blockt) {
      if (!(u.rechtsGedrueckt || this.erzwungen) || verboten) this.beende();
      return;
    }
    if (this.ungewiss && (this.sofort || !(u.rechtsGedrueckt || this.erzwungen))) {
      this.ungewiss = false;
      this.sofort = false;
      this.spaetOffen = false;
      this.sende(false);
    }
    if (u.rechtsFlanke && u.rechtsGedrueckt && !verboten && !schlag) {
      if (!(u.ausdauer >= BLOCK_BEGINN_AUSDAUER)) {
        this.haken.zuErschoepft?.();
        return;
      }
      if (this.sende(true) !== false) {
        this._blockt = true;
        this.haken.beginnt?.();
      }
    }
  }

  /** The server ended or refused the block (`Block=false`): no answer back, the server knows. */
  serverBeendet(): void {
    this._blockt = false;
    this.verdeckt = false;
    this.wiederNehmen = false;
    this.spaetOffen = false;
    this.spaetWieder = false;
    this.erzwungen = false;
    this.ungewiss = true;
  }

  /** Teleport, world change, respawn, new connection: forget the block and make sure the server does too. */
  zuruecksetzen(): void {
    this._blockt = false;
    this.verdeckt = false;
    this.wiederNehmen = false;
    this.spaetOffen = false;
    this.spaetWieder = false;
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
    if (an) this.haken.beginnt?.();
  }

  /** The window lost the focus: no mouseup will come. */
  blur(): void {
    this.beende();
  }

  /**
   * A roll was sent (Q): hide the block without ending it. Nothing is sent: the server ends the block when it accepts
   * the roll (`beendeBlockDurchRolle`, `Block=false`) and leaves it when it refuses.
   */
  rolleBeginnt(): void {
    this.spaetOffen = false;
    this.spaetWieder = false;
    if (!this._blockt) return;
    this._blockt = false;
    this.verdeckt = true;
    this.wiederNehmen = false;
  }

  /** The server answered the roll with `Rolle=false`: a hidden block comes back once the roll is over in the client. */
  rolleAbgelehnt(): void {
    if (this.verdeckt) this.wiederNehmen = true;
    else if (this.spaetOffen) this.spaetWieder = true;
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
