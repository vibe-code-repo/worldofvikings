/**
 * The one implementation of `TestflugPersistenz` today: the working draft
 * lives in `localStorage['wov-editor-layout']` (the same entry `editor.html`
 * writes), publishing goes through the admin endpoint the map editor uses.
 *
 * Die einzige Umsetzung heute: Arbeitsentwurf im localStorage-Eintrag des
 * Karten-Editors, Speichern in die Serverdatei über denselben Endpunkt.
 */
import type { EntwurfDokument, SpeicherAntwort, TestflugPersistenz } from './TestflugPersistenz';

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
    speichern: (dokument) =>
      fetch('/api/worldlayout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dokument),
      }).then((r) => r.json() as Promise<SpeicherAntwort>),
  };
}
