/**
 * Keyboard/mouse state. Pointer-lock deltas are accumulated per frame by the
 * PlayerController; concept carried over from the old client's InputManager
 * (WASD + PointerLock).
 *
 * Two flavours of query:
 *  - level  (`isDown`, `isMouseDown`)   — held right now, for movement
 *  - edge   (`wasPressed`, `wasMousePressed`) — went down since the last frame,
 *    for actions that must fire exactly once per press (tool swing, hotbar
 *    slot, menu toggle). Edge state is cleared by `endFrame()`, which the main
 *    loop calls after everything has had a chance to read it.
 */
export class InputManager {
  private readonly keys = new Set<string>();
  /** Keys that went down since the last endFrame(). */
  private readonly keysPressed = new Set<string>();
  private readonly mouse = new Set<number>();
  /** Mouse buttons that went down since the last endFrame(). */
  private readonly mousePressed = new Set<number>();
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  /** When the right button last produced a real mousedown — see contextmenu. */
  private lastRightDown = -Infinity;
  pointerLocked = false;
  /**
   * Drag-look state for when the pointer lock is NOT held. The browser refuses
   * the lock in situations we cannot control — most notably right after the
   * user left it with Escape, where the spec has the next request fail outright
   * (Firefox is stricter about this than Chromium). Without a fallback the game
   * is unplayable in that state: the camera cannot turn, so no terrain ever
   * comes into reach.
   *
   * Held left button + movement turns the camera; a press that ends without
   * real movement counts as a click instead.
   */
  private dragging = false;
  private dragMoved = 0;
  /**
   * Pixels of travel that turn a click into a drag. Generous on purpose: a real
   * hand moves the mouse a few pixels during any click, and at 5 px almost
   * every genuine click was misread as a drag and swallowed.
   */
  private static readonly DRAG_SLOP = 24;
  /**
   * A press shorter than this counts as a click whatever the travel — the
   * length of the press separates "clicked" from "looked around" far more
   * reliably than distance alone.
   */
  private static readonly CLICK_MAX_MS = 250;
  private dragStart = 0;
  /**
   * How long to wait after a click before deciding it was NOT a lock-grabbing
   * one. pointerlockchange lands within a frame or two of the request; this is
   * generous enough for that and still below the perception threshold.
   */
  private static readonly LOCK_GRACE_MS = 80;
  /** Set when the browser refused the lock — the UI shows a hint for it. */
  lockDenied = false;
  /**
   * Whether to ask for the pointer lock at all (GameSettings.pointerLock).
   * Off means: cursor stays visible, drag-look does the turning, and the
   * browser never shows its own "control of your pointer" notice.
   */
  private useLock = true;
  /**
   * Gecko needs `requestPointerLock()` to run synchronously inside the handler
   * of the real user gesture (mousedown) — a later call, even inside the
   * transient-activation window, is refused with "was not called from inside a
   * short running user-generated event handler". Chromium is lenient.
   */
  private readonly needsSyncGesture = /\bGecko\/\d+/.test(navigator.userAgent);
  /** When the BROWSER took the lock away (Escape, focus loss) — see cooldown. */
  private lastForcedUnlock = -Infinity;
  /** Set while our own exitPointerLock() is in flight, to tell the two apart. */
  private selfExiting = false;
  /** A request is out and unanswered — keeps the click fallback from doubling it. */
  private lockPending = false;
  /** Menu keys, handled inside the keydown gesture — see the handler. */
  private readonly lockKeys = new Map<string, () => boolean>();
  /**
   * Gecko refuses every request for a while after it force-unlocked the pointer
   * itself, even with fresh activation (Mozilla bug 1284785; the duration is
   * undocumented, this is a safe upper bound). Asking anyway just produces a
   * silent denial, so the request is skipped and play continues unlocked.
   */
  private static readonly FORCED_UNLOCK_COOLDOWN_MS = 1300;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Tab opens the build menu; letting the browser have it moves focus off
      // the canvas and the next keystroke goes somewhere else entirely.
      // Space springt — der Browser würde damit sonst die Seite scrollen oder
      // ein Element betätigen, das gerade den Fokus hat.
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      this.keysPressed.add(e.code);

      // Keys that open or close a menu run HERE, not from the render loop:
      // taking the pointer lock back needs the call to sit inside the gesture
      // handler itself (Gecko refuses anything later). The callback does the
      // toggle and reports whether the game should be captured again.
      const toggle = this.lockKeys.get(e.code);
      if (toggle) {
        if (toggle()) this.requestLock();
        else this.exitLock();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Losing focus mid-press would otherwise leave the key/button stuck down.
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.clear();
    });

    // Second way in: some environments deliver `click` but no `mousedown` for a
    // press. Gecko needs the synchronous mousedown path above, everything else
    // is served fine from here; lockPending keeps the two from doubling up.
    canvas.addEventListener('click', () => this.requestLock());
    document.addEventListener('pointerlockchange', () => {
      const had = this.pointerLocked;
      this.lockPending = false;
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) {
        this.lockDenied = false;
      } else {
        // Lost it without asking → the browser took it (Escape, focus loss).
        // That is what starts Gecko's refusal window.
        if (had && !this.selfExiting) this.lastForcedUnlock = performance.now();
        this.selfExiting = false;
        // Buttons held while the lock is dropped never send their mouseup here.
        this.mouse.clear();
      }
    });
    // Fires when the browser refuses the request — after an Escape unlock, for
    // instance. Drag-look covers that case, and the hint tells the player.
    document.addEventListener('pointerlockerror', () => {
      this.lockDenied = true;
    });
    document.addEventListener('mousemove', (e) => {
      // Unlocked drag-look: same deltas, only while the button is held.
      if (!this.pointerLocked && this.dragging) {
        this.dx += e.movementX;
        this.dy += e.movementY;
        this.dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
        return;
      }
      if (this.pointerLocked) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });

    // Mouse buttons only count while the pointer is locked — otherwise the
    // very click that grabs the lock would also swing the tool, and clicks on
    // UI panels would reach the game.
    //
    // The right button is the exception: it opens the build menu and must work
    // on the first press, even when the lock was just dropped (Escape, Alt-Tab,
    // an inventory detour). Without this the browser eats it for its own
    // context menu and the menu appears to be broken.
    document.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) {
        // Unlocked: the left button starts a drag-look on the canvas. Whether
        // it was a look or a click is decided on mouseup, by the travel.
        if (e.button === 0 && e.target === this.canvas) {
          this.dragging = true;
          this.dragMoved = 0;
          this.dragStart = performance.now();
          this.mouse.add(0);
          // Requested HERE, synchronously inside the gesture handler — a later
          // call (on the click event, or once a drag threshold is crossed) is
          // what Gecko refuses.
          this.requestLock();
        }
        return;
      }
      // Stamped only when the press was actually registered here — the
      // contextmenu handler below uses it to avoid double counting, and must
      // NOT be blocked by a mousedown that this early return threw away.
      if (e.button === 2) this.lastRightDown = performance.now();
      if (e.button === 0) this.noteClick('lock');
      this.mouse.add(e.button);
      this.mousePressed.add(e.button);
    });
    document.addEventListener('mouseup', (e) => {
      this.mouse.delete(e.button);
      if (this.dragging && e.button === 0) {
        this.dragging = false;
        // Barely moved: the player meant to use the tool, not to look around.
        //
        // Deferred by a moment instead of decided here, because this same click
        // is what asks for the pointer lock (mouseup runs before the canvas
        // click handler). If the lock arrives, the click was only meant to grab
        // it and must not swing the tool; if it does not — Firefox refuses the
        // request right after an Escape unlock, sometimes silently — then the
        // press counts as a normal click. Waiting for the answer is what makes
        // this work the same in every browser, with or without an error event.
        const kurz = performance.now() - this.dragStart <= InputManager.CLICK_MAX_MS;
        if (kurz || this.dragMoved <= InputManager.DRAG_SLOP) {
          window.setTimeout(() => {
            if (this.pointerLocked) return; // war nur der Klick, der die Maus holt
            this.noteClick('frei');
            this.mousePressed.add(0);
          }, InputManager.LOCK_GRACE_MS);
        } else {
          this.noteClick('gezogen');
        }
      }
    });
    // Right mouse is the build menu — the browser context menu must never open
    // over it, locked or not, or it drops the pointer lock right back out.
    //
    // Without the lock, browsers disagree on what a right click even sends:
    // Chrome reports only `contextmenu`, Firefox sends `mousedown` too. So the
    // press is registered here as well, and the mousedown path above only
    // stamps its timestamp when it really took the press — otherwise Firefox
    // would suppress this handler with a mousedown that went nowhere, and the
    // menu would never open (which is exactly what it did).
    //
    // Edge state only, never `mouse`: a right click that produced no mousedown
    // may bring no mouseup either, and the button would stay stuck down.
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (e.target !== this.canvas) return;
      // The same click already came through as mousedown — don't count it twice.
      if (performance.now() - this.lastRightDown < 200) return;
      this.mousePressed.add(2);
    });
    // passive: false so preventDefault actually stops the page from scrolling.
    // Accepted without the lock too: the wheel picks the build mode, and that
    // has to work while the menu is open with the cursor free.
    document.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += e.deltaY;
      },
      { passive: false }
    );
  }

  /**
   * Bind a key that opens or closes a menu. The callback runs synchronously in
   * the keydown handler and returns true when the game should hold the pointer
   * again (i.e. no menu is left open) — see the keydown handler for why.
   */
  onMenuKey(code: string, toggle: () => boolean): void {
    this.lockKeys.set(code, toggle);
  }

  /**
   * Give the cursor back while any menu is open, take it again once they are
   * all closed. Called from the frame loop, so it also covers menus closed by
   * something other than their key (clicking a tile, Escape).
   *
   * Only the release happens here: taking the lock needs a user gesture, which
   * a frame callback is not — that runs from onMenuKey/the canvas click.
   */
  setUiOpen(open: boolean): void {
    if (open && this.pointerLocked) this.exitLock();
  }

  /** GameSettings.pointerLock — turning it off releases a lock already held. */
  setUseLock(use: boolean): void {
    this.useLock = use;
    if (!use) {
      this.lockDenied = false;
      this.exitLock();
    }
  }

  private exitLock(): void {
    if (!this.pointerLocked) return;
    // Marked so pointerlockchange does not mistake this for a browser-forced
    // unlock and start the cooldown.
    this.selfExiting = true;
    document.exitPointerLock();
  }

  /** Gecko denies every request inside this window — asking is pointless. */
  private inForcedUnlockCooldown(): boolean {
    return (
      this.needsSyncGesture &&
      performance.now() - this.lastForcedUnlock < InputManager.FORCED_UNLOCK_COOLDOWN_MS
    );
  }

  /**
   * Take the mouse back from inside a click handler — used by menus that close
   * themselves on a pick. Must be called synchronously in the gesture.
   */
  captureFromGesture(): void {
    this.requestLock();
  }

  /**
   * Ask for the lock — always straight out of a mousedown handler, never
   * deferred, because Gecko refuses anything else.
   */
  private requestLock(): void {
    if (this.pointerLocked || this.lockPending || !this.useLock || this.inForcedUnlockCooldown()) return;
    this.lockPending = true;
    // Older browsers return undefined instead of a promise here.
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (!p?.then) {
      // No promise to settle on — clear the guard on the next turn instead.
      window.setTimeout(() => {
        this.lockPending = false;
      }, InputManager.LOCK_GRACE_MS);
      return;
    }
    void p.then(
      () => {
        this.lockPending = false;
      },
      () => {
        this.lockPending = false;
        this.lockDenied = true;
      }
    );
  }

  /** True while the game runs without the lock — the UI explains the controls. */
  get playingUnlocked(): boolean {
    return !this.useLock;
  }

  /**
   * One line for the HUD, so a player can report what the mouse actually does
   * on their browser instead of us guessing. Kept short and stable.
   */
  get debugLine(): string {
    const lock = this.pointerLocked ? 'gefangen' : this.lockDenied ? 'abgelehnt' : 'frei';
    const seit = this.lastClickAt > 0 ? ((performance.now() - this.lastClickAt) / 1000).toFixed(1) : '–';
    return `maus ${lock}  lmb-weg ${this.lastClickPath}  vor ${seit}s`;
  }

  /** How the last left click reached the game: locked path, drag fallback, or none. */
  private lastClickPath = '–';
  private lastClickAt = 0;

  private noteClick(weg: string): void {
    this.lastClickPath = weg;
    this.lastClickAt = performance.now();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True for one frame after the key went down. */
  wasPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  /** 0 = left, 1 = middle, 2 = right. */
  isMouseDown(button: number): boolean {
    return this.mouse.has(button);
  }

  /** True for one frame after the button went down. */
  wasMousePressed(button: number): boolean {
    return this.mousePressed.has(button);
  }

  /** Consumes the accumulated mouse deltas. */
  consumeMouseDelta(): [number, number] {
    const d: [number, number] = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  /** Consumes accumulated wheel movement (positive = scrolled down). */
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Clears edge state. Call once per frame, after all readers have run. */
  endFrame(): void {
    this.keysPressed.clear();
    this.mousePressed.clear();
  }
}
