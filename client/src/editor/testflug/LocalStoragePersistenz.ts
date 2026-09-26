/**
 * The one implementation of `TestflugPersistenz` today: the working draft
 * lives in `localStorage['wov-editor-layout']` (the same entry `editor.html`
 * writes), publishing goes through the admin endpoint the map editor uses.
 *
 * Die einzige Umsetzung heute: Arbeitsentwurf im localStorage-Eintrag des
 * Karten-Editors, Speichern in die Serverdatei über denselben Endpunkt.
 *
 * Publishing carries the base of the DRAFT (the server state it rests on;
 * `basis` in the draft's companion note, `STAND_KEY`) as `If-Match`. The editor
 * sets that base only when server content went into the draft, after a
 * successful save, or when the user explicitly chose "keep draft"; merely
 * fetching a newer server state does not move it. So a save from here that
 * would replace a server state the draft does not rest on and the user has not
 * decided about is answered with 409 and nothing is overwritten. The one
 * deliberate way to replace it is the editor dialog's "keep draft": from then on
 * the next save (also from here) replaces the state the user was shown. Without
 * a known base nothing is sent.
 *
 * Speichern schickt die Basis des ENTWURFS (den Serverstand, auf dem er beruht;
 * Feld `basis` im Begleitzettel) als `If-Match`. Der Editor setzt sie nur, wenn
 * Serverinhalt in den Entwurf kam, nach einem gelungenen Speichern oder wenn
 * der Nutzer ausdrücklich „Entwurf behalten" wählt; ein bloss geholter neuerer
 * Serverstand ändert sie nicht. Ein Speichern von hier, das einen Serverstand
 * ersetzen würde, auf dem der Entwurf nicht beruht und über den der Nutzer
 * nicht entschieden hat, wird mit 409 abgelehnt. Der einzige bewusste Weg,
 * ihn zu ersetzen, ist „Entwurf behalten" im Editor-Dialog: danach ersetzt das
 * nächste Speichern (auch von hier) den Stand, den der Nutzer gesehen hat.
 * Ohne bekannte Basis geht nichts hinaus.
 */
import type { WorldLayout } from '@wov/shared';
import { STAND_KEY, schreibeWeltdokument } from '../weltdokument';
import { zettelBasisLesen, zettelMitBasis } from '../entwurfsSpeicher';
import type { EntwurfDokument, SpeicherAntwort, TestflugPersistenz } from './TestflugPersistenz';

const OHNE_BASIS =
  'Speichern aus dem Testflug braucht einen Editor-Stand – bitte im Editor den Serverstand abgleichen ' +
  '(Feld „WELT" links oben anklicken; nach einem JSON-Import nötig) und dort speichern.';
const VERLANGT =
  'Der Betriebsdienst verlangt für das Speichern eine Basis und hat nichts geschrieben – ' +
  'bitte im Editor den Serverstand abgleichen (Feld „WELT" links oben anklicken) und dort speichern.';
const VERALTET =
  'Die Welt auf dem Server wurde inzwischen geändert und dein Entwurf beruht nicht darauf – ' +
  'nichts überschrieben. Bitte im Editor abgleichen (Serverstand laden oder „Entwurf behalten") und dort speichern.';

/** Basis aus dem Begleitzettel; `null` bei fehlendem oder nicht lesbarem Zettel bzw. Speicher. */
function zettelBasis(): string | null {
  try {
    return zettelBasisLesen(localStorage.getItem(STAND_KEY));
  } catch {
    return null;
  }
}

/** Nach eigenem erfolgreichem Speichern: nur das Feld `basis` des Zettels nachziehen, alles andere bleibt. */
function basisNachziehen(hash: string | null): void {
  try {
    const neu = zettelMitBasis(localStorage.getItem(STAND_KEY), hash);
    if (neu !== null) localStorage.setItem(STAND_KEY, neu);
  } catch {
    /* Zettel nicht schreibbar: die nächste Speicherung verlangt dann einen Editor-Stand */
  }
}

/** Storage key shared with `editor.html`. */
export const ENTWURF_SCHLUESSEL = 'wov-editor-layout';

export function localStoragePersistenz(): TestflugPersistenz {
  return {
    laden: () =>
      JSON.parse(localStorage.getItem(ENTWURF_SCHLUESSEL) ?? 'null') as EntwurfDokument | null,
    rohtext: () => localStorage.getItem(ENTWURF_SCHLUESSEL),
    aendern: (dokument) => {
      localStorage.setItem(ENTWURF_SCHLUESSEL, JSON.stringify(dokument));
    },
    // Entwurf in die Serverdatei schreiben — derselbe Endpunkt, den der
    // Karten-Editor benutzt. Ohne diesen Weg blieb der im Testflug
    // gezeichnete Entwurf im Browserspeicher liegen, und der Server sah
    // die Route nie.
    speichern: async (dokument) => {
      const basis = zettelBasis();
      if (!basis) return { ok: false, message: OHNE_BASIS } satisfies SpeicherAntwort;
      const antwort = await schreibeWeltdokument(dokument as WorldLayout, basis);
      if (antwort.art === 'ok') {
        // Der Server hat jetzt unseren Stand: Er ist die Basis des nächsten Speicherns.
        basisNachziehen(antwort.hash);
        return { ok: true, message: antwort.message } satisfies SpeicherAntwort;
      }
      // Bei 409 bleibt die alte Basis im Zettel: Erst der Editor-Dialog (Serverstand laden oder „Entwurf behalten") ersetzt sie.
      if (antwort.art === 'veraltet') return { ok: false, message: VERALTET } satisfies SpeicherAntwort;
      // 428: the service demands a base; neutral text (whether one was sent is not the service's statement).
      if (antwort.art === 'basis-fehlt') return { ok: false, message: VERLANGT } satisfies SpeicherAntwort;
      return { ok: false, message: antwort.message } satisfies SpeicherAntwort;
    },
  };
}
