/**
 * Nach dem Schreiben der Weltdatei: auf die Quittung des Spielservers warten
 * (Editor E2, Karte K5.0) und die Antwort danach einordnen.
 *
 *  - 200: der laufende Spielserver hat den Stand angewendet.
 *  - 202: geschrieben, aber nicht angewendet; `grund` sagt warum:
 *      `server-aus`   der Spielserver läuft nicht (oder quittiert nicht)
 *      `geo`          der Stand enthält Geo-Änderungen, die erst nach dem Neustart wirken
 *      `abgelehnt`    der Server hat den Stand aus Schutz nicht angewendet
 *      `keine-quittung` der Dienst läuft, hat aber binnen der Wartezeit nicht quittiert
 *
 * Die Datei ist geschrieben, egal was hier herauskommt: 202 heißt nie „nicht
 * gespeichert“. Eine Quittung zählt nur mit dem Hash der eigenen Bytes.
 */
import { quittungLesen, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';

export type AnwendungsStand =
  | { angewendet: true; quittung: Quittung }
  | { angewendet: false; grund: 'server-aus' | 'geo' | 'abgelehnt' | 'keine-quittung'; detail?: string; quittung?: Quittung };

export interface QuittungOptionen {
  hash: string;
  quittungsPfad: string;
  /** Läuft der Spielserver? */
  dienstAktiv: () => Promise<boolean>;
  /** Wie lange auf die Quittung gewartet wird (Vorgabe 3000 ms). */
  warteMs?: number;
  intervallMs?: number;
}

export const QUITTUNG_WARTEN_MS = 3000;

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
  const ende = Date.now() + warteMs;
  for (;;) {
    const q = quittungLesen(o.quittungsPfad);
    if (q && q.hash === o.hash) {
      if (q.ergebnis === 'angewendet') return { angewendet: true, quittung: q };
      const grund = q.grund === 'geo' ? 'geo' : 'abgelehnt';
      return { angewendet: false, grund, ...(q.detail ? { detail: q.detail } : {}), quittung: q };
    }
    if (Date.now() >= ende) break;
    await schlafen(intervall);
  }
  return { angewendet: false, grund: 'keine-quittung' };
}

type Antwort = { code: number; daten: unknown; kopf?: Record<string, string> };

/**
 * Hängt das Ergebnis an eine erfolgreiche Schreibantwort (200/201 mit `hash`):
 * `angewendet` und Zähler bei 200, bei nicht angewendet Code 202 mit `grund`.
 * Alle anderen Antworten bleiben unberührt (dort wurde nichts geschrieben).
 */
export async function anwendungAnhaengen(antwort: Antwort, o: Omit<QuittungOptionen, 'hash'>): Promise<Antwort> {
  const daten = antwort.daten as { hash?: unknown } | null;
  if ((antwort.code !== 200 && antwort.code !== 201) || !daten || typeof daten.hash !== 'string') return antwort;
  const stand = await quittungAbwarten({ ...o, hash: daten.hash });
  if (stand.angewendet) {
    return { ...antwort, daten: { ...daten, angewendet: true, zaehler: stand.quittung.zaehler } };
  }
  return {
    ...antwort,
    code: 202,
    daten: {
      ...daten,
      angewendet: false,
      grund: stand.grund,
      ...(stand.detail ? { detail: stand.detail } : {}),
      message:
        `Geschrieben, aber nicht angewendet (${stand.grund}): ` +
        (stand.grund === 'server-aus'
          ? 'der Spielserver läuft nicht; die Änderung gilt nach dem Start.'
          : stand.grund === 'geo'
            ? 'Geländeänderungen wirken erst nach dem Neustart.'
            : stand.grund === 'abgelehnt'
              ? 'der Server hat den Stand aus Schutz nicht angewendet.'
              : 'keine Quittung des Spielservers.'),
    },
  };
}
