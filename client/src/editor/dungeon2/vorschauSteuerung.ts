/**
 * AP15.6 — die REINE Steuerung der eingebetteten 3D-Live-Vorschau
 * (`Dungeon2Vorschau.ts`), ohne jede Babylon- oder DOM-Berührung.
 * AP15.6 — the PURE control logic of the embedded 3D live preview
 * (`Dungeon2Vorschau.ts`), without any Babylon or DOM contact.
 *
 * Warum getrennt: 3D/WebGL ist in Node nicht render-testbar. Die drei
 * Zusicherungen, die hier drin stecken, sind aber reine Zustandslogik und
 * müssen es sein — sie in die Babylon-Klasse zu weben, hiesse sie ungeprüft
 * lassen (dasselbe Prinzip wie `cellCanvasMath.ts` neben `CellCanvas.ts`):
 * Why split out: 3D/WebGL cannot be render-tested in Node. The three promises
 * kept here are pure state logic though, and must stay testable — weaving them
 * into the Babylon class would leave them unchecked (same principle as
 * `cellCanvasMath.ts` next to `CellCanvas.ts`):
 *
 *   1. ENTPRELLUNG: Ein Dauerstrich mit dem Pinsel schickt viele `setzeLayout`
 *      kurz hintereinander. Ein Vollneubau je Aufruf würde bei jedem gezogenen
 *      Feld die ganze Geometrie neu werfen. Erst nach Ruhe (`entprellMs`) wird
 *      genau EINMAL gebaut.
 *      DEBOUNCE: a held brush stroke fires many `setzeLayout` in quick
 *      succession. Only after quiet is a single rebuild performed.
 *   2. SICHTBAR ↔ SCHLEIFE: Solange die Vorschau unsichtbar ist, läuft KEINE
 *      Render-Schleife (sie stiehlt sonst dem Karten-Worker die CPU, s.
 *      `GegenstandsKatalog.oeffne()`-Kommentar). `zeige(true/false)` schaltet
 *      Schleife und Sichtbarkeit gemeinsam.
 *      VISIBLE ↔ LOOP: while hidden, NO render loop runs.
 *   3. DISPOSE ist idempotent und endgültig: nach `dispose()` läuft keine
 *      Schleife, kein Entprell-Zeitgeber, und weitere Aufrufe sind wirkungslos.
 *      DISPOSE is idempotent and final.
 *
 * WARUM VOLLNEUBAU (nicht partiell): `DungeonBauer` nimmt sein Layout im
 * Konstruktor entgegen und rollt das Zellgitter EINMAL aus (s.
 * `DungeonBuilder.ts`-Konstruktor); ein „nur betroffene Blöcke neu"-Weg
 * existiert nicht öffentlich. Ein Pinselstrich kann ausserdem Blockgrenzen
 * verschieben. Deshalb: alten Bauer verwerfen, neuen anlegen — aber entprellt,
 * und den Nachbau blockweise über `baueWeiter()` in die Bildschleife gelegt
 * (das erledigt die Babylon-Klasse, nicht diese Datei).
 * WHY FULL REBUILD (not partial): `DungeonBauer` takes its layout in the
 * constructor and rolls the grid out ONCE; there is no public "rebuild only
 * affected blocks" path, and a brush stroke can move block borders. Hence:
 * drop the old builder, make a new one — but debounced.
 */

import type { dungeon2 } from '@wov/shared';

/**
 * Die Babylon-Seite, hinter einem schmalen Interface, das der Test
 * durch eine Attrappe ersetzt. Diese Datei ruft nur hier hinein — sie hält
 * selbst KEINE Engine, keine Szene, keinen Bauer.
 * The Babylon side behind a narrow interface the test replaces with a fake.
 */
export interface VorschauTreiber {
  /**
   * Alten Bauer verwerfen und für dieses Layout einen neuen anlegen
   * (`null` = Szene leeren). Synchron; der blockweise Nachbau läuft danach in
   * der Bildschleife.
   * Drop the old builder and create a new one for this layout (`null` = clear).
   */
  baueNeu(layout: dungeon2.DungeonLayout2 | null): void;
  /** Sichtbar schalten und die Render-Schleife starten. / Show + start loop. */
  starteSchleife(): void;
  /** Unsichtbar schalten und die Render-Schleife anhalten. / Hide + stop loop. */
  stoppeSchleife(): void;
  /** Bauer, Szene, Engine, Beobachter endgültig abräumen. / Tear everything down. */
  abbauen(): void;
}

/**
 * Der Zeitgeber der Entprellung — injizierbar, damit der Test die Zeit selbst
 * treibt statt echt zu warten. Voreinstellung: die globalen Timer (in Browser
 * UND Node vorhanden).
 * The debounce timer — injectable so the test drives time itself. Default: the
 * global timers (present in browser AND Node).
 */
export interface Zeitgeber {
  setzen(rueckruf: () => void, ms: number): number;
  loeschen(handle: number): void;
}

const GLOBALER_ZEITGEBER: Zeitgeber = {
  setzen: (rueckruf, ms) => setTimeout(rueckruf, ms) as unknown as number,
  loeschen: (handle) => clearTimeout(handle),
};

/**
 * Voreinstellung der Entprellzeit in Millisekunden. Kurz genug, dass ein
 * einzelner Klick sich sofort anfühlt, lang genug, dass ein zügiger
 * Pinselstrich (mehrere Felder je 100 ms) als EIN Bau ankommt.
 * Default debounce in ms — short enough that a single click feels instant,
 * long enough that a brisk brush stroke arrives as ONE build.
 */
export const ENTPRELL_MS_VORGABE = 120;

export class VorschauSteuerung {
  private sichtbar = false;
  private abgeraeumt = false;

  /** Zuletzt übergebenes Layout — der nächste Bau nimmt genau dieses. */
  /** The last handed-in layout — the next build takes exactly this one. */
  private letztesLayout: dungeon2.DungeonLayout2 | null = null;
  /** Ob `letztesLayout` noch gebaut werden muss. / Whether a build is pending. */
  private schmutzig = false;

  private timer: number | null = null;

  constructor(
    private readonly treiber: VorschauTreiber,
    private readonly zeitgeber: Zeitgeber = GLOBALER_ZEITGEBER,
    private readonly entprellMs: number = ENTPRELL_MS_VORGABE
  ) {}

  get istSichtbar(): boolean {
    return this.sichtbar;
  }

  /** Nur zum Messen im Test: ob ein Entprell-Zeitgeber läuft. / For tests only. */
  get bauSteht(): boolean {
    return this.timer !== null;
  }

  /**
   * Ein neues (oder verändertes) Layout übernehmen. Baut NICHT sofort — merkt
   * es sich und stösst den entprellten Neubau an, sofern die Vorschau sichtbar
   * ist. Unsichtbar wird nur gemerkt; `zeige(true)` holt den Bau dann nach.
   * Adopt a new/changed layout. Does NOT build immediately — remembers it and
   * arms the debounced rebuild if visible. While hidden it is only remembered;
   * `zeige(true)` catches the build up.
   */
  setzeLayout(layout: dungeon2.DungeonLayout2 | null): void {
    if (this.abgeraeumt) return;
    this.letztesLayout = layout;
    this.schmutzig = true;
    if (this.sichtbar) this.planeBau();
  }

  /**
   * Sichtbarkeit schalten. Idempotent: zweimal dasselbe ändert nichts. Beim
   * Einblenden mit ausstehendem Layout wird der Bau nachgeholt (entprellt).
   * Toggle visibility. Idempotent. On show with a pending layout the build is
   * caught up (debounced).
   */
  zeige(an: boolean): void {
    if (this.abgeraeumt) return;
    if (an === this.sichtbar) return;
    this.sichtbar = an;
    if (an) {
      this.treiber.starteSchleife();
      if (this.schmutzig) this.planeBau();
    } else {
      this.entprelleAb();
      this.treiber.stoppeSchleife();
    }
  }

  /**
   * Endgültig abräumen. Idempotent — ein zweiter Aufruf tut nichts, und danach
   * sind `setzeLayout`/`zeige` wirkungslos. Kein Zeitgeber, keine Schleife
   * überlebt.
   * Final teardown. Idempotent; afterwards `setzeLayout`/`zeige` are inert.
   */
  dispose(): void {
    if (this.abgeraeumt) return;
    this.abgeraeumt = true;
    this.entprelleAb();
    this.sichtbar = false;
    this.treiber.stoppeSchleife();
    this.treiber.abbauen();
  }

  // ── innen / internals ─────────────────────────────────────────────────────

  private planeBau(): void {
    this.entprelleAb();
    this.timer = this.zeitgeber.setzen(() => {
      this.timer = null;
      // Zwischen Armierung und Ablauf kann abgeräumt oder ausgeblendet worden
      // sein — dann NICHT bauen (ein Bau in eine abgebaute Szene wäre ein
      // Zugriff auf eine entsorgte Engine).
      // Between arming and firing we may have been disposed or hidden — do NOT
      // build then.
      if (this.abgeraeumt || !this.sichtbar) return;
      this.schmutzig = false;
      this.treiber.baueNeu(this.letztesLayout);
    }, this.entprellMs);
  }

  private entprelleAb(): void {
    if (this.timer !== null) {
      this.zeitgeber.loeschen(this.timer);
      this.timer = null;
    }
  }
}
