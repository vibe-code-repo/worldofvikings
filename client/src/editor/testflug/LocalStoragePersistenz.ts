/**
 * The one implementation of `TestflugPersistenz` today: the working draft
 * lives in `localStorage['wov-editor-layout']` (the same entry `editor.html`
 * writes), publishing goes through the admin endpoint the map editor uses.
 *
 * Die einzige Umsetzung heute: Arbeitsentwurf im localStorage-Eintrag des
 * Karten-Editors, Speichern in die Serverdatei über denselben Endpunkt.
 *
 * Publishing carries the server base the editor last knew (hash in the
 * draft's companion note, `STAND_KEY`) as `If-Match`: a newer save by an
 * editor is answered with 409 and nothing is overwritten. Without a known base
 * nothing is sent. / Speichern schickt die Basis aus dem Begleitzettel des
 * Entwurfs als `If-Match`: eine neuere Editor-Speicherung wird nie still
 * überschrieben; ohne bekannte Basis geht nichts hinaus.
 */
import type { WorldLayout } from '@wov/shared';
import { STAND_KEY, schreibeWeltdokument } from '../weltdokument';
import { zettelBasisLesen, zettelMitBasis } from '../entwurfsSpeicher';
import type { EntwurfDokument, SpeicherAntwort, TestflugPersistenz } from './TestflugPersistenz';

const OHNE_BASIS =
  'Speichern aus dem Testflug braucht einen Editor-Stand – bitte einmal im Editor laden/speichern.';
const VERALTET =
  'Die Welt auf dem Server wurde inzwischen geändert – bitte im Editor abgleichen und dort speichern.';

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
      // Bei 409 bleibt die alte Basis im Zettel: Erst der Editor, der den neuen Stand gesehen hat, ersetzt sie.
      if (antwort.art === 'veraltet') return { ok: false, message: VERALTET } satisfies SpeicherAntwort;
      return { ok: false, message: antwort.message } satisfies SpeicherAntwort;
    },
  };
}
