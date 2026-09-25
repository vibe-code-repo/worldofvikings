/**
 * Herunterfahren des Spielservers: der Teil von main.ts, der bei SIGTERM und
 * SIGINT läuft. Eigene Datei, weil main.ts beim Import einen Weltserver
 * startet und deshalb für keinen Test erreichbar ist.
 *
 * Die Zusage: Der Prozess endet IMMER. Scheitert das Speichern (Verzeichnis
 * im Weg, Platte voll, Rechte), steht der Fehler im Journal und der Exit-Code
 * ist `EXIT_SPEICHERN_FEHLGESCHLAGEN` statt 0. Früher warf `stop()`, das
 * Auffangnetz für unbehandelte Fehler protokollierte nur, `process.exit`
 * wurde nie erreicht — der Prozess lebte weiter, der Port blieb offen, und
 * nach TimeoutStopSec kam SIGKILL ohne Speichern.
 */

/** sysexits EX_IOERR: Ein-/Ausgabefehler beim Schreiben des Endstands. */
export const EXIT_SPEICHERN_FEHLGESCHLAGEN = 74;
/** Auch `stop()` selbst ist unerwartet geworfen (sollte es nie). */
export const EXIT_STOPP_GEWORFEN = 75;

/**
 * Baut den Signal-Handler. Der Zustand "läuft schon" gehört dem Handler, nicht
 * dem Modul, damit ein Test mehrere Fälle nacheinander fahren kann.
 */
export function erstelleHerunterfahren(
  server: { stop(): boolean },
  beende: (code: number) => void,
  protokoll: (zeile: string) => void = (z) => console.error(z)
): () => void {
  let laeuftHerunter = false;
  return () => {
    // Zweites Signal, waehrend der erste Stopp noch laeuft: nichts doppelt tun.
    if (laeuftHerunter) return;
    laeuftHerunter = true;
    let code = 0;
    try {
      code = server.stop() ? 0 : EXIT_SPEICHERN_FEHLGESCHLAGEN;
    } catch (err) {
      protokoll(`[Main] stop() hat geworfen: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      code = EXIT_STOPP_GEWORFEN;
    }
    if (code !== 0) protokoll(`[Main] Beende mit Exit-Code ${code} (Endstand nicht gespeichert)`);
    beende(code);
  };
}
