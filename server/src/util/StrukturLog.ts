/**
 * Strukturierte Logs — G12, Schritt 1.
 *
 * Der Server loggt heute in Prosa, z.B.
 *   [WoV] World saved: 12345 persistent ZDOs, 81 zones, 3 players (1377ms)
 * Richtig fuer Mike am Bildschirm, aber ein Skript, das "wie lange
 * dauerten die letzten 20 Saves" auswerten will, muesste die Prosa wieder
 * zerlegen — und jede spaetere Textaenderung wuerde diese Auswertung
 * leise kaputt machen.
 *
 * WARUM NUR EIN SCHALTER UND NUR EIN SCHRITT: Alles auf einmal
 * umzustellen waere ein Umbau, der die Lesbarkeit am Bildschirm nimmt —
 * und das Journal ist gerade erst gedeckelt worden (s.
 * WOV_LOG_STROEME_MAX in admin/src/main.ts). Deshalb bleibt jede
 * Prosa-Zeile stehen, und NUR Ereignisse, die bereits Zahlen tragen,
 * bekommen ZUSAETZLICH eine JSON-Zeile — und auch das nur, wenn
 * WOV_LOG_JSON=1 gesetzt ist. Jedes weitere Ereignis ist ein bewusster,
 * einzeln zu entscheidender nachster Schritt, kein automatischer Umbau
 * der ganzen Logausgabe.
 */

const AN = process.env.WOV_LOG_JSON === '1';

/**
 * Ein Ereignis zusaetzlich als JSON-Zeile loggen — IMMER zusaetzlich zur
 * vorhandenen Prosa-Zeile, nie an ihrer Stelle (s. Kopfkommentar). Bei
 * `WOV_LOG_JSON` unbesetzt ein reiner Bool-Test, kostet also im
 * Normalbetrieb praktisch nichts.
 */
export function strukturLog(ereignis: string, felder: Record<string, unknown>): void {
  if (!AN) return;
  console.log(JSON.stringify({ ereignis, zeitMs: Date.now(), ...felder }));
}
