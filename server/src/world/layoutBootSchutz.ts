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
 * Aber nur, wenn das Dokument verlässlich ist (`ruecknahme`): Ein Dokument mit Höhenfehler, mit verworfenen
 * oder falsch getypten Platzierungen gilt nicht als ausdrückliche Rücknahme.
 *
 * Eine unlesbare oder kaputte Sperrdatei bleibt in JEDEM Weg unangetastet: weder umgangen noch überschrieben,
 * weder verkleinert noch entfernt (das darf nur ein Mensch, oder „Welt zurücksetzen“).
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
  /** Zahl der ids, die die Datei nennt, und ihr Hash (für die Quittung); null: keine Datei. */
  info: { anzahl: number; hash: string; kaputt?: boolean } | null;
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
 * Karte Z3 N2 (B1): ids des Dokuments, die ein Prefab-WECHSEL sind — es gibt Layout-ZDOs mit dieser id, aber
 * keins mit dem Prefab, das das Dokument jetzt nennt (oder ein fremdes neben einem passenden). Der Wechsel würde das alte ZDO samt Zustand ersetzen.
 * Eine solche id gilt NICHT als zurückgenommen, nur weil sie im Dokument steht. Unbekannte Prefabs zählen nicht.
 */
export function ersetzteIds(zdos: ZDOManager, layout: WorldLayout, prefabHash: (name: string) => number | undefined): Set<string> {
  const soll = new Map<string, number>();
  for (const p of layout.placements ?? []) {
    if (typeof p.id !== 'string') continue;
    const hash = prefabHash(p.prefab);
    if (hash !== undefined) soll.set(p.id, hash);
  }
  // Z3 N3 (C1): one ZDO under the id with ANOTHER prefab is enough — a second ZDO that does match (left by an
  // earlier boot) must not read as a revocation and let the next boot delete the old one with its state.
  const ersetzt = new Set<string>();
  for (const zdo of zdos.getAllZDOs()) {
    if (istSpielerbau(zdo)) continue;
    const id = zdo.getString(LAYOUT_ID_MEMBER);
    const hash = id ? soll.get(id) : undefined;
    if (!id || hash === undefined) continue;
    if (zdo.prefabHash !== hash) ersetzt.add(id);
  }
  return ersetzt;
}

/** Was die Sperrdatei JETZT sagt, für die Quittung (liest, schreibt nie). */
export function sperrInfo(pfad: string): { anzahl: number; hash: string; kaputt?: boolean } | null {
  const sperre = loeschsperreLesen(pfad);
  if (sperre === null) return null;
  if (sperre === 'kaputt') return { anzahl: 0, hash: '', kaputt: true };
  return { anzahl: sperre.ids.length, hash: sperre.hash };
}

/**
 * Sperrdatei lesen und mit dem übergebenen Dokument abgleichen (Rücknahme je id, s. Kopfkommentar).
 * Liefert die ids, die JETZT noch aktiv sind — für `layoutAbgleich`/`liveAbgleich` als `geschuetzteIds`.
 */
export function sperreAbgleichen(
  pfad: string,
  zdos: ZDOManager,
  layout: WorldLayout,
  protokoll: (text: string) => void = console.error,
  ruecknahme = true,
  prefabHash?: (name: string) => number | undefined
): SperrAuswertung {
  const sperre = loeschsperreLesen(pfad);
  if (sperre === null) return { aktive: new Set(), info: null };
  if (sperre === 'kaputt') {
    protokoll(
      `[WoV] Löschsperre (${pfad}) ist da, aber nicht als gültige Sperre lesbar — GESCHLOSSEN: kein Layout-Objekt wird gelöscht, bis die Datei von Hand geprüft ist.`
    );
    return { aktive: 'kaputt', info: { anzahl: 0, hash: '', kaputt: true } };
  }
  const imDokument = new Set((layout.placements ?? []).map((p) => p.id).filter((id): id is string => typeof id === 'string'));
  // Ein Prefab-Wechsel an einem Objekt mit Zustand (B1) steht mit seiner id im Dokument und ist trotzdem keine Rücknahme.
  const ersetzt = ruecknahme && prefabHash ? ersetzteIds(zdos, layout, prefabHash) : new Set<string>();
  const behalten = ruecknahme ? sperre.ids.filter((id) => !imDokument.has(id) || ersetzt.has(id)) : sperre.ids;
  if (behalten.length !== sperre.ids.length) {
    try {
      if (behalten.length === 0) loeschsperreEntfernen(pfad);
      else loeschsperreSchreiben(pfad, { ...sperre, ids: behalten });
    } catch (fehler) {
      // Nicht schreibbar: Die alte Datei bleibt (mit den ids, die zurückgekehrt sind); der nächste Abgleich versucht es wieder.
      protokoll(`[WoV] Löschsperre: Rücknahme nicht gespeichert (${(fehler as Error).message})`);
    }
  }
  const vorhanden = vorhandeneLayoutIds(zdos);
  return { aktive: new Set(behalten.filter((id) => vorhanden.has(id))), info: behalten.length > 0 ? { anzahl: behalten.length, hash: sperre.hash } : null };
}

export type SperreErweitert =
  | { art: 'ok'; sperre: Loeschsperre }
  | { art: 'kaputt' }
  | { art: 'fehler'; text: string };

/**
 * Neue ids in die Sperrdatei aufnehmen (Vereinigung mit einer vorhandenen Sperre): Karte Z3 N1, E-b.
 * Aufgerufen, sobald ein Schreibvorgang die Massenlöschungsregel (a)/(b) träfe — unabhängig davon, was
 * die Quittung DIESES Schreibvorgangs sonst sagt (`zu-viele-aenderungen`, `geo`, …).
 * Eine kaputte/unlesbare Sperre wird NIE überschrieben (`kaputt`); ein Schreibfehler wird gemeldet (`fehler`),
 * der Aufrufer wendet dann nichts an.
 */
export function sperreErweitern(pfad: string, neueIds: readonly string[], hash: string, grund: Loeschsperre['grund']): SperreErweitert | null {
  if (neueIds.length === 0) return null;
  const bestehend = loeschsperreLesen(pfad);
  if (bestehend === 'kaputt') return { art: 'kaputt' };
  const ids = new Set(bestehend ? bestehend.ids : []);
  for (const id of neueIds) ids.add(id);
  const sperre: Loeschsperre = { ids: [...ids], hash, grund, zeit: new Date().toISOString() };
  try {
    loeschsperreSchreiben(pfad, sperre);
  } catch (fehler) {
    return { art: 'fehler', text: (fehler as Error).message };
  }
  return { art: 'ok', sperre };
}

export type BestaetigungsPlan = { art: 'kaputt' } | { art: 'keine' } | { art: 'ids'; ids: string[] };

/**
 * Bestätigen (Karte Z3 N1, E-d): genau die ids liefern, die die Sperrdatei nennt UND im aktuellen
 * Dokument fehlen — nichts sonst. Entfernt NICHTS: Der Aufrufer zerstört die ZDOs und gibt die Sperre
 * danach mit `sperreFreigeben` frei (nie vorher: bricht er ab, bleibt der Schutz stehen). Kein Abgleich im
 * Boot-Stil, damit gefällte Bäume und getötete NPCs unangetastet bleiben.
 */
export function sperreBestaetigenPlan(
  pfad: string,
  layout: WorldLayout,
  zdos?: ZDOManager,
  prefabHash?: (name: string) => number | undefined
): BestaetigungsPlan {
  const sperre = loeschsperreLesen(pfad);
  if (sperre === 'kaputt') return { art: 'kaputt' };
  if (sperre === null) return { art: 'keine' };
  const imDokument = new Set((layout.placements ?? []).map((p) => p.id).filter((id): id is string => typeof id === 'string'));
  // Auch ein zurückgehaltener Prefab-Wechsel (B1): sein altes ZDO geht, das neue entsteht danach im normalen Abgleich.
  const ersetzt = zdos && prefabHash ? ersetzteIds(zdos, layout, prefabHash) : new Set<string>();
  return { art: 'ids', ids: sperre.ids.filter((id) => !imDokument.has(id) || ersetzt.has(id)) };
}

/** Die Sperre nach einer erfolgreichen Bestätigung freigeben. */
export function sperreFreigeben(pfad: string): void {
  loeschsperreEntfernen(pfad);
}
