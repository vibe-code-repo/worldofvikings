/**
 * Nach dem Schreiben der Weltdatei: auf die Quittung des Spielservers warten
 * (Editor E2, Karte K5.0) und die Antwort danach einordnen.
 *
 *  - 200: der laufende Spielserver hat den Stand angewendet.
 *  - 202: geschrieben, aber nicht angewendet; `grund` sagt warum:
 *      `server-aus`   der Spielserver läuft nicht (oder quittiert nicht)
 *      `geo`          der Stand enthält Geo-Änderungen, die erst nach dem Neustart wirken
 *      `abgelehnt`    der Server hat den Stand aus Schutz nicht angewendet
 *      `bestaetigung-noetig` der Abgleich hätte viele Objekte oder Objekte mit Zustand entfernt;
 *                     `detail` nennt die ids, nichts ging live verloren; die betroffenen Objekte stehen in der
 *                     dauerhaften Löschsperre und bleiben auch über einen Neustart stehen, bis `POST /api/welt/bestaetigen`
 *      `verworfen`    der Sanitizer hat Einträge des Dokuments gestrichen (Tippfehler): live geschah nichts,
 *                     `detail` nennt die Einträge; nach der Korrektur greift der Abgleich
 *      `zu-viele-aenderungen` mehr als die Obergrenze an Änderungen in einem Schreibvorgang: live geschah nichts,
 *                     `detail` nennt die Zahl; die Datei gilt ab dem nächsten Neustart
 *      `keine-quittung` der Dienst läuft, hat aber binnen der Wartezeit nicht quittiert
 *
 * Steht eine Löschsperre offen (Z3), trägt JEDE Antwort 200/202 zusätzlich `loeschsperre: { anzahl, hash }`; bei 200 ist der
 * Rest angewendet, die gesperrten Objekte stehen aber weiter. Den Satz dazu baut der LESER aus `loeschsperre.anzahl`
 * (Editor und MCP je in ihrer Sprache, Katalog `lock.applied`); die 200-Antwort trägt bewusst keinen fertigen Text
 * (Z3 N3, C3: ein zweites Feld war ein toter Doppelgänger). Bei 202 steht der Text in `message`.
 *
 * Speichern ohne Änderung (gleicher Hash wie vorher, `vorherHash`): 200 mit `unveraendert: true` und Zähler 0,
 * nicht die Zähler der vorigen Quittung; eine offene Sperre steht auch dort (`loeschsperre`, Z3 Folgen C2).
 *
 * Die Datei ist geschrieben, egal was hier herauskommt: 202 heißt nie „nicht
 * gespeichert“. Eine Quittung zählt nur mit dem Hash der eigenen Bytes.
 */
import { quittungLesen, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { heightResponseMessage } from '@wov/shared/src/worldlayout/heightMessages.js';
import { lockMessage } from '@wov/shared/src/worldlayout/lockMessages.js';

export type AnwendungsStand =
  | { angewendet: true; quittung: Quittung }
  | { angewendet: false; grund: 'server-aus' | 'geo' | 'abgelehnt' | 'bestaetigung-noetig' | 'verworfen' | 'zu-viele-aenderungen' | 'keine-quittung'; detail?: string; quittung?: Quittung };

export interface QuittungOptionen {
  hash: string;
  quittungsPfad: string;
  /** Läuft der Spielserver? */
  dienstAktiv: () => Promise<boolean>;
  /** Hash der Datei vor dem Schreiben: gleich `hash` heißt, das Speichern hat nichts geändert. */
  vorherHash?: string;
  /** Wie lange auf die Quittung gewartet wird (Vorgabe 3000 ms). */
  warteMs?: number;
  intervallMs?: number;
}

export const QUITTUNG_WARTEN_MS = 3000;

/** Monotone Uhr: ein Sprung der Wanduhr (NTP, Umstellung) verkürzt oder verlängert die Wartezeit nicht. */
const jetzt = (): number => performance.now();
const schlafen = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function quittungAbwarten(o: QuittungOptionen): Promise<AnwendungsStand> {
  const warteMs = o.warteMs ?? QUITTUNG_WARTEN_MS;
  const intervall = o.intervallMs ?? 100;
  let aktiv = false;
  try {
    aktiv = await o.dienstAktiv();
  } catch {
    aktiv = false;
  }
  if (!aktiv) return { angewendet: false, grund: 'server-aus' };
  const ende = jetzt() + warteMs;
  for (;;) {
    const q = quittungLesen(o.quittungsPfad);
    if (q && q.hash === o.hash) {
      if (q.ergebnis === 'angewendet') return { angewendet: true, quittung: q };
      const grund =
        q.grund === 'geo' || q.grund === 'bestaetigung-noetig' || q.grund === 'verworfen' || q.grund === 'zu-viele-aenderungen'
          ? q.grund
          : 'abgelehnt';
      return { angewendet: false, grund, ...(q.detail ? { detail: q.detail } : {}), quittung: q };
    }
    if (jetzt() >= ende) break;
    await schlafen(intervall);
  }
  return { angewendet: false, grund: 'keine-quittung' };
}

type Antwort = { code: number; daten: unknown; kopf?: Record<string, string> };

/**
 * Hängt das Ergebnis an eine erfolgreiche Schreibantwort (200/201 mit `hash`):
 * `angewendet`, Zähler und (falls die Quittung eines hat) `detail` bei 200, bei nicht angewendet Code 202 mit `grund`.
 * Alle anderen Antworten bleiben unberührt (dort wurde nichts geschrieben).
 */
export async function anwendungAnhaengen(antwort: Antwort, o: Omit<QuittungOptionen, 'hash'>): Promise<Antwort> {
  const daten = antwort.daten as { hash?: unknown } | null;
  if ((antwort.code !== 200 && antwort.code !== 201) || !daten || typeof daten.hash !== 'string') return antwort;
  const stand = await quittungAbwarten({ ...o, hash: daten.hash });
  if (stand.angewendet && o.vorherHash === daten.hash) {
    // Dieselben Bytes wie vorher: Die Quittung ist die des früheren Speicherns, ihre Zähler (und ihr `detail`) gälten
    // nicht für dieses. Ein Speichern ohne Änderung meldet Zähler 0 und `unveraendert`.
    const null_ = Object.fromEntries(Object.keys(stand.quittung.zaehler ?? {}).map((k) => [k, 0]));
    // Z3 Folgen (C2): auch ein Speichern ohne Änderung meldet eine offene Sperre — die Quittung des früheren Speicherns trägt sie.
    const offen = stand.quittung.loeschsperre;
    const offenAnzahl = offen && !offen.kaputt && offen.anzahl > 0 ? offen.anzahl : 0;
    return { ...antwort, daten: { ...daten, angewendet: true, unveraendert: true, zaehler: null_, ...(offenAnzahl > 0 ? { loeschsperre: offen } : {}) } };
  }
  const sperre = stand.quittung?.loeschsperre;
  const gesperrt = sperre && !sperre.kaputt && sperre.anzahl > 0 ? sperre.anzahl : 0;
  const sprache = process.env.WOV_LANGUAGE;
  if (stand.angewendet) {
    // `detail` bei 200 nur, wenn die Quittung eines hat (Z5a: ein Grabstein hat ein Neusetzen verschluckt, `zaehler.zurueck`):
    // Ohne es sähe der Nutzer „angewendet“ und wüsste nicht, dass ein Objekt nicht wiederkam.
    return {
      ...antwort,
      daten: {
        ...daten,
        angewendet: true,
        zaehler: stand.quittung.zaehler,
        ...(stand.quittung.detail ? { detail: stand.quittung.detail } : {}),
        // Die Quittung trägt die offene Sperre; ohne sie hielten Editor und MCP „angewendet“ für „die Truhe ist weg“.
        // Kein fertiger Satz hier: Editor und MCP bauen ihn aus `anzahl` (eine Quelle, übersetzbar), `message` bleibt frei.
        ...(gesperrt > 0 ? { loeschsperre: sperre } : {}),
      },
    };
  }
  return {
    ...antwort,
    code: 202,
    daten: {
      ...daten,
      angewendet: false,
      grund: stand.grund,
      ...(stand.detail ? { detail: stand.detail } : {}),
      ...(stand.quittung?.heightProblem ? { heightProblem: stand.quittung.heightProblem } : {}),
      ...(gesperrt > 0 ? { loeschsperre: sperre } : {}),
      message: heightResponseMessage({ heightProblem: stand.quittung?.heightProblem }, process.env.WOV_LANGUAGE) ??
        `Geschrieben, aber nicht angewendet (${stand.grund}): ` +
        (stand.grund === 'server-aus'
          ? 'der Spielserver läuft nicht; die Änderung gilt nach dem Start.'
          : stand.grund === 'geo'
            ? 'Geländeänderungen wirken erst nach dem Neustart.'
            : stand.grund === 'abgelehnt'
              ? 'der Server hat den Stand aus Schutz nicht angewendet.'
              : stand.grund === 'bestaetigung-noetig'
                ? lockMessage('lock.pending', {}, sprache)
                : stand.grund === 'verworfen'
                  ? 'der Sanitizer hat Einträge des Dokuments gestrichen (Tippfehler?); live geschah nichts, die Einträge stehen in `detail`.'
                  : stand.grund === 'zu-viele-aenderungen'
                    ? 'zu viele Änderungen für den Live-Weg; live geschah nichts, die Datei gilt ab dem nächsten Neustart (Zahl in `detail`).'
                    : 'keine Quittung des Spielservers.') +
        (gesperrt > 0 && stand.grund !== 'bestaetigung-noetig' ? ` ${lockMessage('lock.open', { count: gesperrt }, sprache)}` : ''),
    },
  };
}
