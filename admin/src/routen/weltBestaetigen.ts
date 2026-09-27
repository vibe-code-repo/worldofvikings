/**
 * POST /api/welt/bestaetigen: eine vom Massenlöschungsschutz zurückgehaltene
 * Änderung ausdrücklich "trotzdem anwenden" (Editor E2, Karte Z3).
 *
 * ── Warum ein eigener Weg ────────────────────────────────────────────
 * Speichert der Editor eine Weltdatei, die viele Objekte oder Objekte mit
 * Zustand löschen würde, hält der laufende Spielserver das zurück
 * (`bestaetigung-noetig`, seit #95) — auch nach einem Neustart (Karte Z3):
 * Solange dieselbe Quittung offen ist, geschieht nichts, und der Betriebs-
 * dienst antwortet auf jedes weitere Speichern mit 202. Dieser Weg ist die
 * einzige Stelle, die das aufheben kann, ohne die Datei zurückzunehmen.
 *
 * ── Wie er wirkt ─────────────────────────────────────────────────────
 * Der Hash im Rumpf muss GENAU der aktuellen Weltdatei entsprechen (derselbe
 * Hash, den die offene Quittung nennt) — sonst 409, nichts geschrieben. Passt
 * er, schreibt dieser Weg eine kleine Anfrage-Datei neben der Quittung
 * (`shared/worldlayout/bestaetigenAnfrage.ts`); die Layout-Wache des
 * Spielservers verbraucht sie im nächsten Takt (höchstens eine Sekunde) und
 * gleicht dabei das GANZE Dokument gegen den ZDO-Bestand ab, nicht nur die
 * geänderten Einträge — nur so geschieht die zurückgehaltene Löschung jetzt
 * wirklich. Anschließend steht die Quittung auf `angewendet`.
 *
 * Geschützt wie jeder andere Schreibweg: Anmeldung (Token), Herkunft und
 * Netz-Riegel prüft der allgemeine Vorschalter in `admin/src/main.ts`, bevor
 * dieser Code erreicht wird.
 */
import { layoutDateiHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { quittungAbwarten, type QuittungOptionen } from './anwendung.js';

/** Same shape as `Antwort` in admin/src/main.ts. */
export type BestaetigenAntwort = { code: number; daten: unknown };

export interface BestaetigenUmgebung {
  /** Die Weltdatei dieser Instanz. */
  datei: string;
  /** Pfad der Bestätigungsanfrage (`bestaetigenAnfrageDatei`). */
  anfragePfad: string;
  /** `quittungsPfad` und `dienstAktiv` — wie bei jedem anderen Schreibweg (`mitAnwendung`). */
  wartenOptionen: Omit<QuittungOptionen, 'hash'>;
  /**
   * WOV_QUITTUNG=aus (nur Tests ohne Spielserver): die Anfrage wird geschrieben, aber nicht auf eine
   * Quittung gewartet — es gäbe nie eine.
   */
  warten: boolean;
}

/** `body` ist der geparste JSON-Rumpf des POST. */
export async function weltBestaetigenBehandeln(body: unknown, umg: BestaetigenUmgebung): Promise<BestaetigenAntwort> {
  const eingabe = (typeof body === 'object' && body !== null ? body : {}) as { hash?: unknown };
  if (typeof eingabe.hash !== 'string' || eingabe.hash.length === 0) {
    return { code: 400, daten: { ok: false, fehler: 'hash', message: 'hash (der zurückgehaltene Stand) fehlt oder ist leer — nichts geändert.' } };
  }
  const aktuell = layoutDateiHash(umg.datei);
  if (aktuell === null) {
    return { code: 404, daten: { ok: false, fehler: 'datei-fehlt', message: 'Weltdatei nicht lesbar — nichts geändert.' } };
  }
  if (aktuell !== eingabe.hash) {
    return {
      code: 409,
      daten: {
        ok: false,
        fehler: 'veraltet',
        aktuell,
        message: `Die Weltdatei hat sich seit der zurückgehaltenen Löschung geändert (jetzt ${aktuell}) — nichts angewendet. Neu laden und erneut prüfen.`,
      },
    };
  }
  try {
    bestaetigenAnfrageSchreiben(umg.anfragePfad, aktuell);
  } catch (fehler) {
    console.error(`[Admin] POST /api/welt/bestaetigen -> 500: ${(fehler as Error).message}`);
    return { code: 500, daten: { ok: false, fehler: 'schreiben', message: `Bestätigungsanfrage nicht schreibbar: ${(fehler as Error).message}` } };
  }
  if (!umg.warten) {
    return { code: 202, daten: { ok: true, hash: aktuell, angewendet: false, message: 'Bestätigungsanfrage geschrieben (Quittung aus).' } };
  }
  const stand = await quittungAbwarten({ ...umg.wartenOptionen, hash: aktuell });
  if (stand.angewendet) {
    return { code: 200, daten: { ok: true, hash: aktuell, angewendet: true, zaehler: stand.quittung.zaehler, message: 'Zurückgehaltene Löschung angewendet.' } };
  }
  console.warn(`[Admin] POST /api/welt/bestaetigen -> 202: nicht (rechtzeitig) angewendet (${stand.grund})`);
  return {
    code: 202,
    daten: {
      ok: true,
      hash: aktuell,
      angewendet: false,
      grund: stand.grund,
      message: `Bestätigungsanfrage geschrieben, aber (noch) nicht angewendet (${stand.grund}).`,
    },
  };
}
