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
 * (`shared/worldlayout/bestaetigenAnfrage.ts`, mit eigener Kennung); die Layout-Wache des
 * Spielservers übernimmt sie im nächsten Takt (höchstens eine Sekunde) und löscht dabei GENAU die
 * dauerhaft gesperrten Objekte, die im Dokument fehlen, sonst nichts (Karte Z3 N1) — keine Geo-, Höhen-
 * oder Objektänderung des Dokuments wird dadurch angewendet.
 *
 * ── Worauf gewartet wird ─────────────────────────────────────────────
 * Die Anfrage ändert NICHT den Hash der Weltdatei, und ein `angewendet` für denselben Hash kann schon vor
 * der Anfrage dastehen (etwa nach einem Start mit Sperre). Deshalb wartet dieser Weg auf die Quittung,
 * die die Kennung SEINER Anfrage nennt (`bestaetigung.id`): `200` mit `entfernt` und `angewendet` (ob der
 * Rest des Dokuments angewendet ist), `409 abgelehnt` mit dem Grund, sonst `202`.
 *
 * Geschützt wie jeder andere Schreibweg: Anmeldung (Token), Herkunft und
 * Netz-Riegel prüft der allgemeine Vorschalter in `admin/src/main.ts`, bevor
 * dieser Code erreicht wird.
 *
 * ── Karte Z3 N1 ────────────────────────────────────────────────────────
 * Gibt es keine (gültige) dauerhafte Löschsperre, ist hier nichts zu bestätigen: 409 `nichts-offen`,
 * ohne die Anfrage-Datei zu schreiben — anders als vorher antwortet dieser Weg nicht mehr fälschlich
 * 200, wenn zufällig schon eine Quittung `angewendet` für den Hash vorliegt (Angriffsbefund A6).
 */
import { layoutDateiHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen } from '@wov/shared/src/worldlayout/quittung.js';
import { bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { loeschsperreLesen } from '@wov/shared/src/worldlayout/loeschsperre.js';

/** Same shape as `Antwort` in admin/src/main.ts. */
export type BestaetigenAntwort = { code: number; daten: unknown };

export interface BestaetigenUmgebung {
  /** Die Weltdatei dieser Instanz. */
  datei: string;
  /** Pfad der Bestätigungsanfrage (`bestaetigenAnfrageDatei`). */
  anfragePfad: string;
  /** Pfad der dauerhaften Löschsperre (Karte Z3 N1, `loeschsperreDatei`). */
  loeschsperrePfad: string;
  quittungsPfad: string;
  /** Läuft der Spielserver? */
  dienstAktiv: () => Promise<boolean>;
  /**
   * WOV_QUITTUNG=aus (nur Tests ohne Spielserver): die Anfrage wird geschrieben, aber nicht auf eine
   * Quittung gewartet — es gäbe nie eine.
   */
  warten: boolean;
  /** Wie lange auf den Übergang zu `angewendet` gewartet wird (Vorgabe 3000 ms, wie `quittungAbwarten`). */
  warteMs?: number;
}

/** Monotone Uhr: ein Sprung der Wanduhr verkürzt oder verlängert die Wartezeit nicht (wie `quittungAbwarten`). */
const jetzt = (): number => performance.now();
const schlafen = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `body` ist der geparste JSON-Rumpf des POST. */
export async function weltBestaetigenBehandeln(body: unknown, umg: BestaetigenUmgebung): Promise<BestaetigenAntwort> {
  const eingabe = (typeof body === 'object' && body !== null ? body : {}) as { hash?: unknown };
  if (typeof eingabe.hash !== 'string' || eingabe.hash.length === 0) {
    return { code: 400, daten: { ok: false, fehler: 'hash', message: 'hash (der zurückgehaltene Stand) fehlt oder ist leer — nichts geändert.' } };
  }
  const sperre = loeschsperreLesen(umg.loeschsperrePfad);
  if (sperre === null) {
    return { code: 409, daten: { ok: false, fehler: 'nichts-offen', message: 'Keine zurückgehaltene Löschung offen — nichts zu bestätigen.' } };
  }
  if (sperre === 'kaputt') {
    return {
      code: 409,
      daten: { ok: false, fehler: 'nichts-offen', message: 'Die Löschsperre-Datei ist da, aber nicht lesbar — von Hand prüfen. Nichts bestätigt.' },
    };
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
  let anfrageId: string;
  try {
    anfrageId = bestaetigenAnfrageSchreiben(umg.anfragePfad, aktuell);
  } catch (fehler) {
    console.error(`[Admin] POST /api/welt/bestaetigen -> 500: ${(fehler as Error).message}`);
    return { code: 500, daten: { ok: false, fehler: 'schreiben', message: `Bestätigungsanfrage nicht schreibbar: ${(fehler as Error).message}` } };
  }
  if (!umg.warten) {
    return { code: 202, daten: { ok: true, hash: aktuell, angewendet: false, message: 'Bestätigungsanfrage geschrieben (Quittung aus).' } };
  }
  let aktiv = false;
  try {
    aktiv = await umg.dienstAktiv();
  } catch {
    aktiv = false;
  }
  if (!aktiv) {
    console.warn('[Admin] POST /api/welt/bestaetigen -> 202: der Spielserver läuft nicht');
    return {
      code: 202,
      daten: {
        ok: true,
        hash: aktuell,
        angewendet: false,
        grund: 'server-aus',
        message: 'Bestätigungsanfrage geschrieben, aber der Spielserver läuft nicht — sie wirkt beim nächsten Start.',
      },
    };
  }
  const warteMs = umg.warteMs ?? 3000;
  const ende = jetzt() + warteMs;
  for (;;) {
    const q = quittungLesen(umg.quittungsPfad);
    // Karte Z3 N1: gewartet wird auf die Quittung, die DIESE Anfrage nennt (`bestaetigung.id`) — nicht auf irgendein
    // `angewendet` desselben Hashs (die Wache schreibt es auch ohne Bestätigung, etwa nach einem Start mit Sperre).
    if (q && q.hash === aktuell && q.bestaetigung?.id === anfrageId) {
      if (q.bestaetigung.abgelehnt) {
        return {
          code: 409,
          daten: {
            ok: false,
            fehler: 'abgelehnt',
            grund: q.bestaetigung.abgelehnt,
            hash: aktuell,
            message: `Die Bestätigung wurde nicht ausgeführt (${q.bestaetigung.abgelehnt}) — nichts gelöscht.`,
          },
        };
      }
      // Bestätigt heißt: genau die gesperrten Objekte sind weg. Ob der Rest des Dokuments (Geo, Höhe, …) angewendet
      // ist, sagt `angewendet`; `grund` nennt sonst, was noch aussteht.
      return {
        code: 200,
        daten: {
          ok: true,
          hash: aktuell,
          bestaetigt: true,
          entfernt: q.bestaetigung.entfernt,
          angewendet: q.ergebnis === 'angewendet',
          ...(q.ergebnis === 'angewendet' ? {} : { grund: q.grund }),
          ...(q.detail ? { detail: q.detail } : {}),
          message:
            q.ergebnis === 'angewendet'
              ? 'Zurückgehaltene Löschung ausgeführt.'
              : 'Zurückgehaltene Löschung ausgeführt; der Rest des Dokuments ist noch nicht angewendet.',
        },
      };
    }
    if (jetzt() >= ende) break;
    await schlafen(100);
  }
  console.warn(`[Admin] POST /api/welt/bestaetigen -> 202: nicht rechtzeitig angewendet (${warteMs} ms)`);
  return {
    code: 202,
    daten: {
      ok: true,
      hash: aktuell,
      angewendet: false,
      grund: 'keine-quittung',
      message: 'Bestätigungsanfrage geschrieben, aber (noch) nicht angewendet — die Wache übernimmt sie beim nächsten Takt.',
    },
  };
}
