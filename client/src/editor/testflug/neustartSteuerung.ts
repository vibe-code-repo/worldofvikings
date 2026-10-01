/**
 * The control logic of the "Speichern & neu starten" button, DOM-free: question first, run only after
 * "Ja", the buttons locked from the start to the end, status and player count handed to the surface.
 * The panel (`SpawnPanel`) implements `NeustartOberflaeche` and only forwards clicks; so what a run
 * with fakes can show (no restart without the confirmation, unlock after every end, status on every
 * change, the player number in the question) is shown in `client/test/gelaende-neustart.ts`.
 *
 * Steuerlogik des Knopfes „Speichern & neu starten“ ohne DOM: erst die Frage, Lauf erst nach „Ja“,
 * Knöpfe von Anfang bis Ende gesperrt, Status und Spielerzahl an die Oberfläche. Das Panel setzt
 * `NeustartOberflaeche` um und leitet nur Klicks weiter.
 */
import { neustartLauf, neustartText, type NeustartDienste, type NeustartPhase } from './neustart';

export interface NeustartOberflaeche {
  /** Show the confirmation; `spieler`: connected players, `null` = unknown (then no number is shown). */
  zeigeNeustartFrage(spieler: number | null): void;
  schliesseNeustartFrage(): void;
  zeigeNeustartStatus(text: string, phase: NeustartPhase): void;
  /** `true` from the start to the end of a run: both save buttons and the restart button are locked. */
  sperreSpeichern(an: boolean): void;
}

export interface NeustartSteuerungDienste extends Omit<NeustartDienste, 'status'> {
  spieler(): Promise<number | null>;
  oberflaeche: NeustartOberflaeche;
  /** The line in the flight HUD (end of a run and errors). */
  hud(text: string): void;
}

export interface NeustartSteuerung {
  /** `true` while a run goes on (the plain save button asks this, too). */
  laeuft(): boolean;
  /** Click on "Speichern & neu starten": only asks. */
  neustartKlick(): Promise<void>;
  /** Click on "Ja" in the confirmation: the run starts. */
  neustartJa(): Promise<void>;
  /** Click on "Abbrechen". */
  neustartAbbruch(): void;
}

export function neustartSteuerung(d: NeustartSteuerungDienste): NeustartSteuerung {
  const ui = d.oberflaeche;
  const lauf = neustartLauf({
    entwurf: d.entwurf,
    holen: d.holen,
    jetzt: d.jetzt,
    schlafe: d.schlafe,
    status: (s) => {
      const text = neustartText(s);
      ui.zeigeNeustartStatus(text, s.phase);
      if (s.phase === 'fehler' || s.phase === 'laeuft-wieder') d.hud(text);
    },
  });
  return {
    laeuft: () => lauf.laeuft(),
    async neustartKlick() {
      if (lauf.laeuft()) return;
      const zahl = await d.spieler().catch(() => null);
      if (lauf.laeuft()) return;
      ui.zeigeNeustartFrage(zahl);
    },
    async neustartJa() {
      ui.schliesseNeustartFrage();
      if (lauf.laeuft()) return;
      ui.sperreSpeichern(true);
      try {
        await lauf.starten();
      } finally {
        ui.sperreSpeichern(false);
      }
    },
    neustartAbbruch() {
      ui.schliesseNeustartFrage();
    },
  };
}
