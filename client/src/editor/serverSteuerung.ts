/**
 * DOM-freie Entscheidungslogik der Serversteuerung im Editor (Mikes
 * Befund: der Neustart-Knopf blieb gesperrt, sobald eine Testwelt lief).
 *
 * Drei reine Funktionen, kein `fetch`, kein DOM — `editorMain.ts`
 * verdrahtet sie nur mit dem Betriebsdienst (`/api/server`,
 * `/api/testwelt`) und den Übersetzungen. Getestet in
 * `client/test/editor-serversteuerung.ts`.
 */

export interface DienstZustand {
  aktiv: boolean;
  seit: string | null;
  /** Roher `ActiveState` von systemctl (29.09., B5) — `undefined` nur in aelteren Fixturen/Aufrufern ohne dieses Feld. */
  roh?: string;
}

/** Welche der drei Serversteuerung-Knöpfe sichtbar bzw. benutzbar sind. */
export interface ServerKnoepfeZustand {
  neustartBenutzbar: boolean;
  stoppenSichtbar: boolean;
  stoppenBenutzbar: boolean;
  startenSichtbar: boolean;
  startenBenutzbar: boolean;
}

/**
 * `dienstAktiv: null` heisst „Zustand noch nicht geladen" (erster Aufruf
 * nach dem Öffnen). Dann gilt wie bei `Boolean(stand?.aktiv)` in
 * `testweltKnoepfeAktualisieren`: als „nicht aktiv" behandeln — dasselbe
 * Fail-Safe wie dort (lieber „Starten" zeigen als einen Stopp-Knopf für
 * einen Dienst, von dem man nichts weiss).
 */
export function serverKnoepfeZustand(eingabe: { dienstAktiv: boolean | null; aktionLaeuft: boolean }): ServerKnoepfeZustand {
  const aktiv = eingabe.dienstAktiv === true;
  return {
    neustartBenutzbar: !eingabe.aktionLaeuft,
    stoppenSichtbar: aktiv,
    stoppenBenutzbar: aktiv && !eingabe.aktionLaeuft,
    startenSichtbar: !aktiv,
    startenBenutzbar: !aktiv && !eingabe.aktionLaeuft,
  };
}

export type ServerStatusAnzeige = { art: 'unbekannt' } | { art: 'wechselt' } | { art: 'laeuft'; seit: string } | { art: 'gestoppt' };

/**
 * `roh` (B5, Angriffsbefund): `aktiv`/`seit` allein sagen bei
 * `activating`/`deactivating` FALSCH "gestoppt", und bei einer
 * gescheiterten Abfrage (`dienstZustand()`s catch, `roh: 'unbekannt'`)
 * ebenso. Ein Zustand ohne `roh` (aeltere Aufrufer/Fixturen) verhaelt sich
 * wie zuvor: nur `aktiv` entscheidet.
 */
export function serverStatusAnzeige(zustand: DienstZustand | null): ServerStatusAnzeige {
  if (!zustand) return { art: 'unbekannt' };
  if (zustand.roh === 'activating' || zustand.roh === 'deactivating') return { art: 'wechselt' };
  if (zustand.roh === 'unbekannt') return { art: 'unbekannt' };
  return zustand.aktiv ? { art: 'laeuft', seit: zustand.seit ?? '?' } : { art: 'gestoppt' };
}

/**
 * Was „Karte live testen" tut, wenn schon eine Testwelt läuft (Mikes
 * Befund, Nachbesserung N1 29.09.): NICHT noch einmal
 * `testweltSchalten('starten')` — das liefe in den 409 „Es läuft bereits
 * eine Testwelt". Und NICHT `/api/server neustart`: Ein bloßer Neustart
 * lädt den Spielstand der LAUFENDEN Testwelt wieder (der Server schreibt
 * ihn periodisch und synchron beim Stoppen, `WovServer.ts`), die Karte
 * entstünde also nicht neu — genau der Fehler, den der erste Durchgang
 * dieser Karte übersehen hat. Richtig ist `testweltSchalten('erneuern')`:
 * speichern (immer dieselbe Weltdatei, unabhängig vom Testwelt-Umschalter,
 * der nur den SPIELSTAND beiseitelegt, s. admin/src/main.ts LAYOUT_DATEI),
 * dann den aktuellen Testwelt-Spielstand aus dem Weg räumen und neu
 * starten.
 */
export function karteLiveTestenAktion(eingabe: { testweltAktiv: boolean }): 'testwelt-starten' | 'testwelt-erneuern' {
  return eingabe.testweltAktiv ? 'testwelt-erneuern' : 'testwelt-starten';
}

/** Optionen im Bestätigungsdialog von „Server neu starten", in Anzeigereihenfolge. */
export type NeustartWahl = 'ab' | 'speichern-neustart' | 'nur-neustart';

/**
 * Ohne ungespeicherte Änderungen (Schmutz-Merker aus `faerbeSpeicherKnopf`,
 * s. Kopfkommentar dort) gibt es nichts zu speichern — nur Abbrechen/
 * Neustarten. Mit ungespeicherten Änderungen kommt eine dritte Option
 * dazwischen: erst speichern (derselbe Weg wie „In die Welt speichern"),
 * dann neu starten. „Nur neu starten" bedeutet dabei ausdrücklich: der
 * Editor-Entwurf bleibt unverändert im Browser, auf den SERVER geht nichts
 * — der Neustart selbst ändert an der Weltdatei nichts.
 */
export function neustartOptionen(entwurfWeichtAb: boolean): NeustartWahl[] {
  return entwurfWeichtAb ? ['ab', 'speichern-neustart', 'nur-neustart'] : ['ab', 'nur-neustart'];
}
