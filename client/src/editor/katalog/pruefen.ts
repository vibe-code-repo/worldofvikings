/**
 * Availability check of the visible page: HEAD requests for the models of
 * the registry page and for the files of the store page. The two functions
 * were methods of GegenstandsKatalog and moved here as functions with a
 * context: `k` is the instance itself, `this` became `k`, nothing else
 * changed. The class keeps one forwarding method per function. Calls
 * between the two go through `k` (`k.pruefeSpeicherSeite(…)`), so a stub
 * set on the instance stays in effect.
 */

import { PREFABS_BY_NAME } from '@wov/shared';
import { modelUrl } from '../../engine/AssetManager';
import { SPEICHER_WURZEL } from '../StoreKatalogDaten';
import { PRUEF_PARALLEL } from './konstanten';
import type { KatalogKontext } from './kontext';

/** What this module uses of the class: three fields, one accessor and four methods, 8 members. */
type PruefKontext = KatalogKontext<
  | 'vorhanden'
  | 'pruefKnopf'
  | 'storeIndex'
  | 'seitenNamen'
  | 'speicherArt'
  | 'pruefeSpeicherSeite'
  | 'statusSetzen'
  | 'listeFuellen'
>;

/**
 * Für die sichtbare Seite abfragen, ob die GLB überhaupt ausgeliefert
 * wird — per HEAD, also ohne die Datei zu übertragen.
 *
 * Das beantwortet die Frage, die sich beim Durchblättern der vollen
 * Registry sofort stellt: Welche dieser 3.748 Einträge kann ich hier
 * überhaupt ansehen? Ein Klick auf jeden Einzelnen wäre die
 * Alternative — mit 17-MB-Downloads für die, die es gibt.
 *
 * `PRUEF_PARALLEL` deckelt die Gleichzeitigkeit: Der Dev-Server liest
 * jede Datei mit einem eigenen Stream, 60 auf einmal bringen ihn ins
 * Stocken. Ein Netzfehler lässt den Eintrag UNBEKANNT (kein Zeichen) —
 * „fehlt" behaupten wir nur bei einer echten Absage des Servers.
 */
async function pruefeSeite(k: PruefKontext): Promise<void> {
  const namen = k.seitenNamen();
  /*
    Im Speicher-Bereich ist der Schlüssel der PFAD und nicht der
    Modellname — dieselbe Frage, andere Adresse. Beides über einen
    Kamm zu scheren (`PREFABS_BY_NAME`) meldete für jeden
    Speicher-Eintrag „fehlt", denn die Registry kennt keinen davon.
  */
  if (k.speicherArt) {
    await k.pruefeSpeicherSeite(namen);
    return;
  }
  const offen = namen
    .map((n) => PREFABS_BY_NAME.get(n)?.model)
    .filter((m): m is string => !!m && !k.vorhanden.has(m));
  if (offen.length === 0) {
    k.statusSetzen('Seite bereits geprüft.', 'neutral');
    window.setTimeout(() => k.statusSetzen('', 'neutral'), 2000);
    return;
  }
  k.pruefKnopf.disabled = true;
  k.pruefKnopf.textContent = `prüfe ${offen.length} Modelle …`;
  let naechster = 0;
  const arbeiter = async (): Promise<void> => {
    while (naechster < offen.length) {
      const datei = offen[naechster++]!;
      try {
        /*
          Die URL kommt aus `modelUrl()` und nicht als feste
          Zeichenkette: Seit E4 kann in `PREFABS_BY_NAME` auch ein zur
          Laufzeit registrierter Saal stehen, und dessen GLB liegt unter
          `assets/generiert/`. Fest verdrahtet meldete diese Prüfung ihn
          als „fehlt" — eine falsche Auskunft, die niemandem auffiele:
          Das Modell IST da, nur an einem anderen Pfad, und der Katalog
          sagte trotzdem, es gebe es nicht.
        */
        const antwort = await fetch(modelUrl(datei), { method: 'HEAD' });
        // Ein 200 mit HTML ist die typische Antwort eines Servers, der
        // Unbekanntes auf die Startseite umbiegt — das ist kein Modell.
        const typ = antwort.headers.get('content-type') ?? '';
        k.vorhanden.set(datei, antwort.ok && !typ.includes('text/html'));
      } catch {
        /* Netzfehler: unbekannt lassen (s. Kopf) */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PRUEF_PARALLEL, offen.length) }, arbeiter));
  k.pruefKnopf.textContent = 'Verfügbarkeit dieser Seite prüfen';
  k.pruefKnopf.disabled = false;
  k.listeFuellen();
  const da = namen.filter((n) => {
    const m = PREFABS_BY_NAME.get(n)?.model;
    return m ? k.vorhanden.get(m) === true : false;
  }).length;
  k.statusSetzen(`${da} von ${namen.length} Modellen dieser Seite liegen vor.`, da > 0 ? 'da' : 'fehlt');
}

/**
 * Dasselbe für den Speicher — HEAD auf `/assets/store/<pfad>`.
 *
 * Auch hier nur die SICHTBARE Seite: 672 Anfragen auf einen Schlag
 * wären dieselbe kleine Denial-of-Service-Attacke wie bei der
 * Registry, nur mit einem Bestand, von dem fast alles daliegt.
 */
async function pruefeSpeicherSeite(k: PruefKontext, ids: readonly string[]): Promise<void> {
  const offen = ids
    .map((id) => k.storeIndex.get(id)?.pfad)
    .filter((p): p is string => !!p && !k.vorhanden.has(p));
  if (offen.length === 0) {
    k.statusSetzen('Seite bereits geprüft.', 'neutral');
    window.setTimeout(() => k.statusSetzen('', 'neutral'), 2000);
    return;
  }
  k.pruefKnopf.disabled = true;
  k.pruefKnopf.textContent = `prüfe ${offen.length} Dateien …`;
  let naechster = 0;
  const arbeiter = async (): Promise<void> => {
    while (naechster < offen.length) {
      const pfad = offen[naechster++]!;
      try {
        const antwort = await fetch(`${SPEICHER_WURZEL}${pfad}`, { method: 'HEAD' });
        const typ = antwort.headers.get('content-type') ?? '';
        k.vorhanden.set(pfad, antwort.ok && !typ.includes('text/html'));
      } catch {
        /* Netzfehler: unbekannt lassen (s. Kopf der Registry-Prüfung) */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PRUEF_PARALLEL, offen.length) }, arbeiter));
  k.pruefKnopf.textContent = 'Verfügbarkeit dieser Seite prüfen';
  k.pruefKnopf.disabled = false;
  k.listeFuellen();
  const da = ids.filter((id) => {
    const p = k.storeIndex.get(id)?.pfad;
    return p ? k.vorhanden.get(p) === true : false;
  }).length;
  k.statusSetzen(`${da} von ${ids.length} Dateien dieser Seite liegen vor.`, da > 0 ? 'da' : 'fehlt');
}

export { pruefeSeite, pruefeSpeicherSeite };
