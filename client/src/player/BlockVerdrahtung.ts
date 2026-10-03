/**
 * BlockVerdrahtung.ts (D3-K3) — `BlockSteuerung` hooked up to the game, in one place (main.ts has a line budget):
 * what the main loop knows is read here once per frame, the figure is told the state, `Block=false` of the server and
 * `blur` end the block.
 * BlockSteuerung an das Spiel gehaengt; main.ts ruft nur `frame()`, `schlag()` und `verdrahte(socket)`.
 */
import { PacketType, WATER_LEVEL } from '@wov/shared';
import type { BinaryReader } from '../net/GameSocket';
import { BLOCK_BEGINN_AUSDAUER, SERVER_MELDUNG_ZU_ERSCHOEPFT } from '@wov/shared/src/kampf/block.js';
import { ROLLE_AUS_ABGELEHNT, SERVER_MELDUNG_ROLLE_ZU_ERSCHOEPFT } from '@wov/shared/src/kampf/rolle.js';
import { BlockSteuerung } from './BlockSteuerung';
import { rolleRichtungYaw, rolleSperre } from './RolleSteuerung';

/** D3-K4: what the roll (key Q) needs of the player, see `RolleSteuerung`. Optional in `BlockQuellen`: a stand-in without it has no roll. */
export interface RolleSpieler {
  readonly rollt: boolean;
  readonly rolleAbklingRest: number;
  readonly rolleBereit: boolean;
  readonly inLuft: boolean;
  readonly figurYaw: number;
  readonly moveIntent: { readonly x: number; readonly z: number };
  startRolle(yaw: number): void;
  rolleAbbruch(sperreLoeschen?: boolean): void;
}

/** What the wiring needs of the game; every field is a getter, so late-created objects (`let player`) work. */
export interface BlockQuellen {
  /** `socket?.sendBlock(an)`: called once per change of state. */
  sendBlock: (an: boolean) => void | boolean;
  input: { isMouseDown(button: number): boolean; wasMousePressed(button: number): boolean; wasPressed?(code: string): boolean };
  /** D3-K4: `socket?.sendRolle(yaw)`; false = no connection (the roll does not begin). */
  sendRolle?: (yaw: number, nr: number) => boolean;
  player: () => {
    setzeBlock(an: boolean): void;
    readonly ausdauerStand: number;
    zieheAusdauerAb(menge: number): void;
    readonly bauModus: boolean;
    readonly position: { readonly y: number };
    readonly avatar: { readonly liegt: boolean };
  } & Partial<RolleSpieler> | null;
  equipment: () => { readonly rightItem: unknown; readonly pieceTable: string | null } | null | undefined;
  placement: () => { readonly selectedPiece?: unknown } | null | undefined;
  /** `cursorNoetig()`: a window that needs the cursor is open. */
  fensterOffen: () => boolean;
  /** Placing decor (the right button cancels there). */
  dekorAktiv: () => boolean;
  /** Shows a message to the player (a catalogue key like `@kampf.zu_erschoepft` is translated): `hud.meldung(i18n.serverMeldung(t))`. */
  meldung: (text: string) => void;
  /** Default: the pointer lock element of the document. */
  zeigerGefangen?: () => boolean;
  /** Default: `window`. */
  fenster?: { addEventListener(art: 'blur', f: () => void): void };
}

function istRollenspieler<T extends object>(s: T & Partial<RolleSpieler>): s is T & RolleSpieler {
  return typeof s.startRolle === 'function' && typeof s.rolleAbbruch === 'function';
}

export class BlockVerdrahtung extends BlockSteuerung {
  /** The number of the last roll sent: the server's answer carries it back (an answer to an older roll is ignored). */
  private rolleNr = 0;

  constructor(private readonly q: BlockQuellen) {
    super((an) => q.sendBlock(an), {
      // The same rule and message as the server (K1 N5): a begin costs 5 stamina, below 5 it is refused.
      zuErschoepft: () => q.meldung(SERVER_MELDUNG_ZU_ERSCHOEPFT),
      beginnt: () => q.player()?.zieheAusdauerAb(BLOCK_BEGINN_AUSDAUER),
    });
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
      ausdauer: spieler.ausdauerStand,
      rollt: spieler.rollt === true,
    });
    if (q.input.wasPressed?.('KeyQ') && istRollenspieler(spieler)) this.rolle(spieler);
    spieler.setzeBlock(this.blockt); // after the key: a roll hides the block in the same frame
  }

  /**
   * Key Q (D3-K4): the roll, if no row of its table forbids it. A roll hides a block (the server ends it when it takes the
   * roll), is sent once and begins in the client at once (the server walks the same path). Without the connection it does not begin (and the key stays the
   * editor's in the offline test flight).
   */
  private rolle(spieler: RolleSpieler & NonNullable<ReturnType<BlockQuellen['player']>>): void {
    const q = this.q;
    const sperre = rolleSperre({
      qFlanke: true,
      zeigerGefangen: q.zeigerGefangen ? q.zeigerGefangen() : !!document.pointerLockElement,
      fensterOffen: q.fensterOffen(),
      dekorPlatzieren: q.dekorAktiv(),
      baumodus: spieler.bauModus,
      tot: spieler.avatar.liegt,
      imWasser: spieler.position.y < WATER_LEVEL,
      inLuft: spieler.inLuft,
      nichtBereit: !spieler.rolleBereit,
      rollt: spieler.rollt,
      abklingRest: spieler.rolleAbklingRest,
      ausdauer: spieler.ausdauerStand,
    });
    if (sperre === 'ausdauer') q.meldung(SERVER_MELDUNG_ROLLE_ZU_ERSCHOEPFT);
    if (sperre !== null) return;
    const yaw = rolleRichtungYaw(spieler.moveIntent.x, spieler.moveIntent.z, spieler.figurYaw);
    if (!q.sendRolle) return;
    if (!q.sendRolle(yaw, this.rolleNr + 1)) return;
    this.rolleNr += 1;
    this.rolleBeginnt(); // the block is hidden, not ended: the server ends it with the roll, a refused roll leaves it
    spieler.startRolle(yaw);
  }

  /**
   * The server's `Block=false` (it ended or refused the block) ends the block here (and leaves the state uncertain, see
   * `BlockSteuerung`); a teleport (world change, dungeon, respawn) resets it. Called once per connection.
   */
  verdrahte(socket: { on(typ: PacketType, handler: (reader: BinaryReader) => void): void }): void {
    socket.on(PacketType.Block, (reader) => {
      if (!reader.readBool()) this.serverBeendet();
    });
    socket.on(PacketType.Teleport, () => {
      this.zuruecksetzen();
      this.q.player()?.rolleAbbruch?.();
    });
    // D3-K4: the server refused or ended the roll (`Rolle` false): the predicted roll stops.
    socket.on(PacketType.Rolle, (reader) => {
      if (reader.readBool()) return;
      const grund = reader.remaining >= 1 ? reader.readUInt8() : 0; // no reason byte (an older server): ended
      const nr = reader.remaining >= 4 ? reader.readInt32() : 0; // no number: the current roll
      if (nr !== 0 && nr !== this.rolleNr) return; // the answer to an older roll: it must not touch the one that runs now
      if (grund === ROLLE_AUS_ABGELEHNT) {
        // refused: free of cost at the server, so no lock here either: Q works again at once
        this.rolleAbgelehnt();
        this.q.player()?.rolleAbbruch?.(true);
      } else {
        // ended (teleport, world change, flight) or an older server: the lock stays as the server holds it
        this.q.player()?.rolleAbbruch?.();
      }
    });
  }
}
