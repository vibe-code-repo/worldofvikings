/**
 * BlockVerdrahtung.ts (D3-K3) — `BlockSteuerung` hooked up to the game, in one place (main.ts has a line budget):
 * what the main loop knows is read here once per frame, the figure is told the state, `Block=false` of the server and
 * `blur` end the block.
 * BlockSteuerung an das Spiel gehaengt; main.ts ruft nur `frame()`, `schlag()` und `verdrahte(socket)`.
 */
import { PacketType, WATER_LEVEL } from '@wov/shared';
import type { BinaryReader } from '../net/GameSocket';
import { BlockSteuerung } from './BlockSteuerung';

/** What the wiring needs of the game; every field is a getter, so late-created objects (`let player`) work. */
export interface BlockQuellen {
  /** `socket?.sendBlock(an)`: called once per change of state. */
  sendBlock: (an: boolean) => void;
  input: { isMouseDown(button: number): boolean; wasMousePressed(button: number): boolean };
  player: () => {
    setzeBlock(an: boolean): void;
    readonly bauModus: boolean;
    readonly position: { readonly y: number };
    readonly avatar: { readonly liegt: boolean };
  } | null;
  equipment: () => { readonly rightItem: unknown; readonly pieceTable: string | null } | null | undefined;
  placement: () => { readonly selectedPiece?: unknown } | null | undefined;
  /** `cursorNoetig()`: a window that needs the cursor is open. */
  fensterOffen: () => boolean;
  /** Placing decor (the right button cancels there). */
  dekorAktiv: () => boolean;
  /** Default: the pointer lock element of the document. */
  zeigerGefangen?: () => boolean;
  /** Default: `window`. */
  fenster?: { addEventListener(art: 'blur', f: () => void): void };
}

export class BlockVerdrahtung extends BlockSteuerung {
  constructor(private readonly q: BlockQuellen) {
    super((an) => q.sendBlock(an));
    // Losing the focus sends no mouseup: the block would stay on.
    (q.fenster ?? (typeof window !== 'undefined' ? window : null))?.addEventListener('blur', () => this.blur());
  }

  /** Once per frame, after the input is read: the block state of the moment, handed to the figure. */
  frame(): void {
    const q = this.q;
    const spieler = q.player();
    if (!spieler) return;
    const ausruestung = q.equipment();
    this.aktualisiere({
      rechtsGedrueckt: q.input.isMouseDown(2),
      rechtsFlanke: q.input.wasMousePressed(2),
      zeigerGefangen: q.zeigerGefangen ? q.zeigerGefangen() : !!document.pointerLockElement,
      fensterOffen: q.fensterOffen(),
      dekorPlatzieren: q.dekorAktiv(),
      baumodus: spieler.bauModus,
      bauteilGewaehlt: !!q.placement()?.selectedPiece,
      bauwerkzeug: !!ausruestung?.pieceTable,
      gegenstandInHand: !!ausruestung?.rightItem,
      tot: spieler.avatar.liegt,
      imWasser: spieler.position.y < WATER_LEVEL,
    });
    spieler.setzeBlock(this.blockt);
  }

  /** The server's `Block=false` (it ended or refused the block) ends the block here; no answer back. */
  verdrahte(socket: { on(typ: PacketType, handler: (reader: BinaryReader) => void): void }): void {
    socket.on(PacketType.Block, (reader) => {
      if (!reader.readBool()) this.serverBeendet();
    });
  }
}
