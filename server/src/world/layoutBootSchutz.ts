/**
 * Editor E2, Karte Z3 N1: die dauerhafte Löschsperre (`shared/worldlayout/loeschsperre.ts`) mit dem
 * aktuellen Dokument und dem ZDO-Bestand abgleichen — für BEIDE Wege (Boot und Live), von
 * `WovServer.spawnLayoutPlacements` gerufen, jeweils bevor eine Löschung überhaupt entschieden wird.
 *
 * Die Sperrdatei selbst kennt nur ids und einen Hash zur Anzeige; ob eine id JETZT noch aktiv gesperrt
 * ist, entscheiden zwei Dinge, die nur hier zusammenlaufen: steht sie noch in der Datei, UND gibt es
 * noch ein Layout-ZDO mit genau dieser `layoutId`? Beides ist nötig — eine id, deren Objekt längst über
 * einen anderen Weg verschwunden ist (etwa `layoutAbgleich` selbst, bei einem Prefab-Wechsel), soll nicht
 * ewig als „aktiv" gelten, und eine id, die nur noch als ZDO existiert, aber nicht mehr in der Datei
 * steht, ist nicht (mehr) gesperrt.
 *
 * Rücknahme JE id (Karte Z3 N1, E-c): Steht eine gesperrte id wieder im aktuellen Dokument, fällt sie
 * hier aus der Sperrdatei — unabhängig davon, ob sie zufällig auch noch ein ZDO hat. Wird die Liste
 * dadurch leer, verschwindet die Datei ganz (Rücknahme insgesamt). Dieser Abgleich SCHREIBT also unter
 * Umständen, obwohl er nach außen wie ein reines Lesen aussieht — immer atomar, wie die Datei selbst.
 */
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import type { WorldLayout } from '@wov/shared';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import { istSpielerbau } from './layoutAbgleich.js';
import {
  type Loeschsperre,
  loeschsperreEntfernen,
  loeschsperreLesen,
  loeschsperreSchreiben,
} from '@wov/shared/src/worldlayout/loeschsperre.js';

export interface SperrAuswertung {
  /**
   * Die ids, die JETZT aktiv gesperrt sind (in der Datei UND noch als Layout-ZDO vorhanden).
   * `'kaputt'`: die Datei ist da, aber nicht lesbar — gilt als GESCHLOSSEN (jede Löschung verweigert,
   * nicht nur die genannten ids), bis sie von Hand geprüft ist.
   */
  aktive: ReadonlySet<string> | 'kaputt';
}

function vorhandeneLayoutIds(zdos: ZDOManager): Set<string> {
  const vorhanden = new Set<string>();
  for (const zdo of zdos.getAllZDOs()) {
    if (istSpielerbau(zdo)) continue;
    const id = zdo.getString(LAYOUT_ID_MEMBER);
    if (id) vorhanden.add(id);
  }
  return vorhanden;
}

/**
 * Sperrdatei lesen und mit dem übergebenen Dokument abgleichen (Rücknahme je id, s. Kopfkommentar).
 * Liefert die ids, die JETZT noch aktiv sind — für `layoutAbgleich`/`liveAbgleich` als `geschuetzteIds`.
 */
export function sperreAbgleichen(
  pfad: string,
  zdos: ZDOManager,
  layout: WorldLayout,
  protokoll: (text: string) => void = console.error
): SperrAuswertung {
  const sperre = loeschsperreLesen(pfad);
  if (sperre === null) return { aktive: new Set() };
  if (sperre === 'kaputt') {
    protokoll(
      `[WoV] Löschsperre (${pfad}) ist da, aber nicht als gültige Sperre lesbar — GESCHLOSSEN: kein Layout-Objekt wird gelöscht, bis die Datei von Hand geprüft ist.`
    );
    return { aktive: 'kaputt' };
  }
  const imDokument = new Set((layout.placements ?? []).map((p) => p.id).filter((id): id is string => typeof id === 'string'));
  const behalten = sperre.ids.filter((id) => !imDokument.has(id));
  if (behalten.length !== sperre.ids.length) {
    if (behalten.length === 0) loeschsperreEntfernen(pfad);
    else loeschsperreSchreiben(pfad, { ...sperre, ids: behalten });
  }
  const vorhanden = vorhandeneLayoutIds(zdos);
  return { aktive: new Set(behalten.filter((id) => vorhanden.has(id))) };
}

/**
 * Neue ids in die Sperrdatei aufnehmen (Vereinigung mit einer vorhandenen Sperre): Karte Z3 N1, E-b.
 * Aufgerufen, sobald ein Schreibvorgang die Massenlöschungsregel (a)/(b) träfe — unabhängig davon, was
 * die Quittung DIESES Schreibvorgangs sonst sagt (`zu-viele-aenderungen`, `geo`, …).
 */
export function sperreErweitern(pfad: string, neueIds: readonly string[], hash: string, grund: Loeschsperre['grund']): Loeschsperre | null {
  if (neueIds.length === 0) return null;
  const bestehend = loeschsperreLesen(pfad);
  const ids = new Set(bestehend && bestehend !== 'kaputt' ? bestehend.ids : []);
  for (const id of neueIds) ids.add(id);
  const sperre: Loeschsperre = { ids: [...ids], hash, grund, zeit: new Date().toISOString() };
  loeschsperreSchreiben(pfad, sperre);
  return sperre;
}

/**
 * Bestätigen (Karte Z3 N1, E-d): genau die ids liefern, die die Sperrdatei nennt UND im aktuellen
 * Dokument fehlen — nichts sonst. Entfernt die Sperrdatei in jedem Fall (auch wenn sie `'kaputt'` war
 * oder keine ihrer ids mehr im ZDO-Bestand steht): Eine Bestätigung räumt die Sperre auf, gleich was sie
 * bewirkt hat. Der Aufrufer zerstört selbst die ZDOs dieser ids — kein Abgleich im Boot-Stil, damit
 * gefällte Bäume und getötete NPCs unangetastet bleiben.
 */
export function sperreBestaetigenIds(pfad: string, layout: WorldLayout): string[] {
  const sperre = loeschsperreLesen(pfad);
  loeschsperreEntfernen(pfad);
  if (sperre === null || sperre === 'kaputt') return [];
  const imDokument = new Set((layout.placements ?? []).map((p) => p.id).filter((id): id is string => typeof id === 'string'));
  return sperre.ids.filter((id) => !imDokument.has(id));
}
