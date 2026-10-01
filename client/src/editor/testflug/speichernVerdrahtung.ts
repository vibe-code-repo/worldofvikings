/**
 * The wiring of the save buttons of the terrain tab and the route editor, DOM-free: the plain save
 * (with its lock against a second save and against "Speichern & neu starten"), and the four panel
 * callbacks that forward to the restart control. `Testflug.ts` only builds the pieces and hands them
 * over; so what the test (`gelaende-neustart-panel.ts`) runs with the REAL `SpawnPanel` is the same
 * wiring the flight uses.
 *
 * Verdrahtung der Speichern-Knöpfe des Gelände-Reiters und des Routen-Editors, ohne DOM: das einfache
 * Speichern (mit Sperre gegen ein zweites Speichern und gegen „Speichern & neu starten“) und die vier
 * Panel-Rückrufe an die Neustart-Steuerung. `Testflug.ts` baut nur die Teile und reicht sie weiter.
 */
import { entwurfErgebnisText, entwurfSpeichern, type EntwurfDienste } from './entwurfSpeichern';
import type { NeustartSteuerung } from './neustartSteuerung';
import { t } from '../i18n';

export interface SpeichernVerdrahtung {
  /** The plain save: terrain tab and route editor both call this. */
  speichereEntwurf(): void;
  /** `true` while a plain save is on its way (a restart run must not start then: same base twice, R5). */
  einfachLaeuft(): boolean;
}

export function speichernVerdrahtung(d: {
  entwurf: EntwurfDienste;
  hud(text: string): void;
  /** The restart control (looked up late: it is built after the panel). */
  neustart(): NeustartSteuerung;
}): SpeichernVerdrahtung {
  let laeuft = false;
  return {
    einfachLaeuft: () => laeuft,
    speichereEntwurf() {
      // N6/R5: while "Speichern & neu starten" runs, or a plain save is on its way, only that one saves (same base twice).
      if (d.neustart().laeuft()) {
        d.hud(t('testflug.neustart.fehler.gesperrt'));
        return;
      }
      if (laeuft) {
        d.hud(t('testflug.neustart.fehler.speichert_noch'));
        return;
      }
      laeuft = true;
      // A2: a throwing HUD must never keep the lock (or stop the save): the lock is freed in `finally` whatever happens.
      const meldung = (text: string): void => {
        try {
          d.hud(text);
        } catch {
          /* the HUD is only a display */
        }
      };
      meldung(t('testflug.speichere_in_welt'));
      void entwurfSpeichern(d.entwurf)
        .then((e) => meldung(entwurfErgebnisText(e)))
        .catch(() => undefined)
        .finally(() => {
          laeuft = false;
        });
    },
  };
}

/** The callbacks of the panel's terrain tab (all looked up late, the panel is built before the pieces exist). */
export function panelRueckrufe(
  holen: () => { verdrahtung: SpeichernVerdrahtung; neustart: NeustartSteuerung }
): {
  speichernGelaende: () => void;
  neustartKlick: () => void;
  neustartJa: () => void;
  neustartAbbruch: () => void;
} {
  return {
    speichernGelaende: () => holen().verdrahtung.speichereEntwurf(),
    neustartKlick: () => void holen().neustart.neustartKlick(),
    neustartJa: () => void holen().neustart.neustartJa(),
    neustartAbbruch: () => holen().neustart.neustartAbbruch(),
  };
}
