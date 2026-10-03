/**
 * RolleSteuerung.ts (D3-K4) — the client side of the dodge roll: key Q.
 * Der Client-Teil der Ausweichrolle: Taste Q.
 *
 * DOM-free and without Babylon, so every rule is testable.
 *
 *  - `rolleSperre` is the conflict table of the key (same rows as the block where they apply: not dead, not in
 *    build mode, pointer captured, no window, no decor placing, not in the water; plus the roll's own rows: no roll
 *    running, lock, not in the air, enough stamina).
 *  - `rolleRichtungYaw`: the direction of the roll is the walking direction (WASD relative to the camera); without
 *    input the figure rolls forward along its own facing.
 *  - `RolleLauf` is the clock of one roll in the client: the time the figure is moved (`ROLLE_BEWEGUNG_S`), the
 *    time of the whole clip (`ROLLE_DAUER_MS`, invulnerable, no swing, no block) and the lock after it. The same
 *    numbers as the server (`shared/src/kampf/rolle.ts`), so the prediction and the server walk the same path.
 *
 * Q is also the way back from the editor's test flight (`Testflug.ts`). That flight is offline: the roll needs the
 * connection (`sende` returns false without it), so the key stays the editor's there.
 */
import {
  ROLLE_ABKLINGZEIT_MS,
  ROLLE_AUSDAUER,
  ROLLE_BEWEGUNG_S,
  ROLLE_DAUER_MS,
  SPRUNG_AUSDAUER,
  SPRUNG_SPERRE_MS,
  rolleRichtung,
  rolleWegAnteil,
  rolleYawVon,
} from '@wov/shared/src/kampf/rolle.js';

/** What the main loop knows about the moment. */
export interface RolleUmfeld {
  /** The key Q went down since the last frame (edge). */
  readonly qFlanke: boolean;
  /** The pointer is captured by the game. */
  readonly zeigerGefangen: boolean;
  /** A window that needs the cursor is open (`cursorNoetig`). */
  readonly fensterOffen: boolean;
  /** Placing decor. */
  readonly dekorPlatzieren: boolean;
  /** Build mode (editor test flight). */
  readonly baumodus: boolean;
  readonly tot: boolean;
  readonly imWasser: boolean;
  /** Jumping or falling. */
  readonly inLuft: boolean;
  /** The controller cannot move the figure (no physics yet, frozen while a dungeon loads). */
  readonly nichtBereit: boolean;
  /** A roll is running. */
  readonly rollt: boolean;
  /** Seconds left of the lock after the last roll. */
  readonly abklingRest: number;
  /** The predicted stamina. */
  readonly ausdauer: number;
}

/** One row of the conflict table. */
export interface RolleSperre {
  readonly id: string;
  readonly grund: string;
  readonly gilt: (u: RolleUmfeld) => boolean;
}

/** The first row that applies wins; each row is a case of the test. */
export const ROLLE_SPERREN: readonly RolleSperre[] = [
  { id: 'tot', grund: 'dead', gilt: (u) => u.tot },
  { id: 'baumodus', grund: 'build mode (test flight)', gilt: (u) => u.baumodus },
  { id: 'zeiger-frei', grund: 'pointer not captured', gilt: (u) => !u.zeigerGefangen },
  { id: 'fenster-offen', grund: 'a window needs the cursor', gilt: (u) => u.fensterOffen },
  { id: 'dekor-platzieren', grund: 'decor placing', gilt: (u) => u.dekorPlatzieren },
  { id: 'nicht-bereit', grund: 'no physics / frozen', gilt: (u) => u.nichtBereit },
  { id: 'laeuft', grund: 'a roll is running', gilt: (u) => u.rollt },
  { id: 'abklingzeit', grund: 'lock after the last roll', gilt: (u) => u.abklingRest > 0 },
  { id: 'wasser', grund: 'in the water', gilt: (u) => u.imWasser },
  { id: 'luft', grund: 'in the air', gilt: (u) => u.inLuft },
  { id: 'ausdauer', grund: 'not enough stamina', gilt: (u) => !(u.ausdauer >= ROLLE_AUSDAUER) },
];

/** The id of the first row that forbids a roll, or null when it is allowed. */
export function rolleSperre(u: RolleUmfeld): string | null {
  return ROLLE_SPERREN.find((z) => z.gilt(u))?.id ?? null;
}

/**
 * The yaw of the roll: the walking direction `(wx, wz)` (unit vector, WASD relative to the camera) when there is
 * input, else the facing of the figure (`figurYaw`). Both in the convention (-sin yaw, -cos yaw).
 */
export function rolleRichtungYaw(wx: number, wz: number, figurYaw: number): number {
  return wx !== 0 || wz !== 0 ? rolleYawVon(wx, wz) : figurYaw;
}

/** The clock of one roll in the client. */
export class RolleLauf {
  private _rollt = false;
  private t = 0;
  private _abkling = 0;
  private _yaw = 0;
  private _x = 0;
  private _z = 0;

  get rollt(): boolean {
    return this._rollt;
  }
  /** Seconds left of the lock after the last roll. */
  get abklingRest(): number {
    return this._abkling;
  }
  get yaw(): number {
    return this._yaw;
  }
  get x(): number {
    return this._x;
  }
  get z(): number {
    return this._z;
  }

  /** Begin a roll along `yaw`. */
  starte(yaw: number): void {
    const r = rolleRichtung(yaw);
    this._rollt = true;
    this.t = 0;
    this._yaw = yaw;
    this._x = r.x;
    this._z = r.z;
  }

  /** The roll is over without a lock (the server refused it, a teleport, death, a window). */
  abbrechen(mitSperre = false): void {
    this._rollt = false;
    this._abkling = mitSperre ? ROLLE_ABKLINGZEIT_MS / 1000 : 0;
  }

  /**
   * One frame of `dt` seconds (REAL time: the roll lasts as long as at the server whatever the frame rate; the
   * caller must not hand it a clamped frame time). Returns the seconds of this frame at the speed `ROLLE_TEMPO`
   * that cover the share of the path the curve of the clip puts in it (`rolleWegAnteil`, like the server's slices).
   * The lock runs after the roll.
   */
  schritt(dt: number): { bewegt: number } {
    if (!this._rollt) {
      this._abkling = Math.max(0, this._abkling - dt);
      return { bewegt: 0 };
    }
    const vorher = this.t;
    this.t += dt;
    const dauer = ROLLE_DAUER_MS / 1000;
    const bewegt = Math.max(0, rolleWegAnteil(Math.min(this.t, dauer)) - rolleWegAnteil(Math.min(vorher, dauer))) * ROLLE_BEWEGUNG_S;
    if (this.t >= dauer) {
      this._rollt = false;
      // the part of this frame after the clip already counts against the lock
      this._abkling = Math.max(0, ROLLE_ABKLINGZEIT_MS / 1000 - (this.t - dauer));
    }
    return { bewegt };
  }
}

/**
 * The cost side of the jump (D3-K4): the client jumps only with the stamina the server will bill (5), not in a roll
 * and not inside the server's lock (0.8 s), and reports each jump ONCE: the flag waits for the next input packet
 * (`nimm`), so a jump between two packets 50 ms apart is not lost and one jump is not reported twice.
 */
export class SprungMeldung {
  private sperre = 0;
  private merk = false;

  /** One frame: the lock runs down. */
  schritt(dt: number): void {
    this.sperre = Math.max(0, this.sperre - dt);
  }

  /** May a jump be billed now (stamina, lock, no roll)? */
  erlaubt(ausdauer: number, rollt: boolean): boolean {
    return !rollt && this.sperre === 0 && ausdauer >= SPRUNG_AUSDAUER;
  }

  /** A jump began: lock and flag. Returns the stamina after the cost. */
  springe(ausdauer: number): number {
    this.sperre = SPRUNG_SPERRE_MS / 1000;
    this.merk = true;
    return ausdauer - SPRUNG_AUSDAUER;
  }

  /** The jump flag of the next input packet: true once per jump. */
  nimm(): boolean {
    const war = this.merk;
    this.merk = false;
    return war;
  }
}
