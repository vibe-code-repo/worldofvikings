/**
 * Live-Abgleich des Objektteils (Editor E2, Karte K5.0 N1).
 *
 * Der Boot gleicht ALLE Platzierungen mit den ZDOs der Welt ab; das ist dort
 * richtig, weil ein frischer Server alles neu aufbaut. Live gilt etwas anderes:
 * Das Spiel läuft seit Stunden, und was seither geschah, gehört dem Spiel, nicht
 * dem Dokument. Ein gefällter Baum hat kein ZDO mehr, ein toter NPC hat
 * `health = 0`. Gliche jede Live-Anwendung wieder alles ab, käme beides bei
 * JEDER Änderung irgendwo in der Welt zurück (Holz und Beute auf Knopfdruck).
 *
 * Deshalb fasst der Live-Abgleich nur die Platzierungen an, deren Eintrag sich
 * gegenüber dem zuletzt angewendeten Dokument geändert hat (Vergleich je `id`):
 *
 *   neu        ⇒ ein ZDO entsteht (`layoutAbgleich`)
 *   geändert   ⇒ das ZDO wird angeglichen; fehlt es (gefällt) oder ist der NPC
 *                tot, wird er wie beim Boot neu gesetzt: an genau diesem Objekt
 *                hat der Designer etwas getan
 *   entfernt   ⇒ sein ZDO geht (hier, nicht im Abgleich)
 *   unverändert ⇒ nicht angefasst. Weder Boden noch Prefab-Suche noch ZDO-Suche.
 *
 * `layoutAbgleich` selbst bleibt unverändert: Die Auswahl der ids läuft VOR dem
 * Aufruf. Er bekommt nur die geänderten Platzierungen und die Option
 * `verworfen`, die ihn nichts löschen lässt (sonst gälten alle unveränderten
 * ZDOs als verwaist). Was der Live-Abgleich selbst entfernt, entscheidet und
 * zählt er selbst.
 *
 * ── Grabsteine ───────────────────────────────────────────────────────
 * Löschen eines gefällten Baums, speichern, Rückgängig, speichern belebt ihn nicht: siehe `Grabsteine`.
 *
 * ── Obergrenze ───────────────────────────────────────────────────────
 * Mehr als `AENDERUNGEN_MAX` neue, geänderte oder entfernte Einträge in einem Schreibvorgang: `zuViele`, nichts
 * angewendet. Weit verteilte Einträge kosten je Stück Bodenhöhe (kalte Kacheln); gemessen ist die Grenze im Bericht.
 *
 * ── Massenlöschung ───────────────────────────────────────────────────
 * Ein Tippfehler in der `id`, ein leeres `placements`, eine abgeschnittene
 * Ausgabe der KI: Live wirkt so etwas binnen einer Sekunde, ohne Blick ins Log.
 * Deshalb wendet der Live-Abgleich NICHT an, wenn er
 *   (a) mehr als 20 Platzierungen oder mehr als 25 % aller Platzierungen (des
 *       zuletzt angewendeten Dokuments; der Anteil erst ab 5 Stück) oder gleich
 *       alle entfernen würde, oder
 *   (b) ZDOs mit Zustand entfernen würde (Truheninhalt, Trefferpunkte, Türzustand,
 *       auch das Ersetzen bei einem Prefab-Wechsel), gemessen wie `zustand()`.
 * Dann kommt `bestaetigung` mit den betroffenen ids zurück, es geschieht nichts,
 * und die Datei bleibt, wie sie ist. Der Boot beim nächsten Neustart verhält
 * sich wie bisher (er räumt ab).
 */
import type { PlacementDef, WorldLayout } from '@wov/shared';
import { LAYOUT_ID_MEMBER, layoutKennung } from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import {
  istSpielerbau,
  layoutAbgleich,
  zustand,
  type LayoutAbgleichErgebnis,
  type LayoutAbgleichKontext,
} from './layoutAbgleich.js';

/** Mehr als so viele entfernte Platzierungen wendet der Live-Abgleich nicht an. */
export const MASSENLOESCHUNG_ANZAHL = 20;
/** Mehr als dieser Anteil aller Platzierungen ebenso nicht, sofern es mindestens `MASSENLOESCHUNG_MINDEST` sind. */
export const MASSENLOESCHUNG_ANTEIL = 0.25;
/**
 * Bei kleinen Dokumenten wäre jede zweite Löschung „mehr als 25 %“ (1 von 3): Der Anteil zählt erst ab so vielen
 * entfernten Platzierungen. Ein Dokument ganz zu leeren wird unabhängig davon abgefangen.
 */
export const MASSENLOESCHUNG_MINDEST = 5;
/** Meter um eine Platzierung mit unbekanntem Prefab, in denen ZDOs geschont werden (wie beim Boot). */
const SCHONZONE = 1.0;
/** Wie viele ids im Text der Quittung stehen (der Rest als Zahl). */
const IDS_IM_TEXT = 40;

export interface LiveAbgleich {
  readonly art: 'angewendet';
  readonly ergebnis: LayoutAbgleichErgebnis;
  /** Die Platzierungen, die geprüft wurden (nur die geänderten): für `pruefeLayout`. */
  readonly geaendert: readonly PlacementDef[];
  /** Platzierungen, die nicht angefasst wurden. */
  readonly unberuehrt: number;
}
/** Mehr neue, geänderte oder entfernte Einträge in einem Schreibvorgang wendet der Live-Abgleich nicht an. */
export const AENDERUNGEN_MAX = 100;

export interface LiveZuViele {
  readonly art: 'zuViele';
  /** Neue + geänderte + entfernte Einträge dieses Schreibvorgangs. */
  readonly anzahl: number;
}
export interface LiveBestaetigung {
  readonly art: 'bestaetigung';
  /** Text für die Quittung: Regel und betroffene ids. */
  readonly detail: string;
  readonly ids: readonly string[];
}

/**
 * Ein Vergleichsschlüssel je Platzierung: gleicher Inhalt, gleicher Schlüssel. Verglichen wird der NORMALISIERTE
 * Eintrag: Feste Schlüsselfolge, und was der Sanitizer als Vorgabe kennt, zählt wie ein fehlendes Feld (`yaw: 0`,
 * `scale: 1`, kein `einebnen`, keine `route`). Sonst belebte ein Werkzeug, das `yaw: 0` ausdrücklich schreibt (oder
 * weglässt), einen gefällten Baum bei jedem Wechsel.
 */
const eintrag = (p: PlacementDef): string =>
  JSON.stringify([p.id ?? null, p.prefab, p.x, p.z, p.yaw ?? 0, p.scale ?? 1, p.route ?? null, p.einebnen ?? 0, p.npc ?? null]);

/**
 * Grabsteine: Entfernte Einträge, deren Objekt schon nicht mehr stand (gefällt), samt ihrem Vergleichsschlüssel.
 * Kommt derselbe Eintrag später unverändert zurück (Löschen, speichern, Rückgängig, speichern), gilt er als
 * unverändert und belebt nichts. Ein anderer Inhalt unter derselben id gilt als neu. Bis zum Neustart.
 */
export type Grabsteine = Map<string, string>;
/** So viele Grabsteine höchstens (der älteste geht zuerst). */
const GRABSTEINE_MAX = 5000;

/** Was sich zwischen den beiden Ständen geändert hat (je `id`). */
export function idDiff(
  alt: readonly PlacementDef[],
  neu: readonly PlacementDef[],
  grabsteine?: ReadonlyMap<string, string>
): {
  geaendert: PlacementDef[];
  entfernt: string[];
  /** Schlüssel der Einträge des alten Stands (für die Grabsteine). */
  vorher: ReadonlyMap<string, string>;
  /** Wieder aufgetauchte Einträge, deren Grabstein passt (nicht angefasst). */
  zurueck: string[];
} {
  const vorher = new Map<string, string>();
  for (const p of alt) if (p.id) vorher.set(p.id, eintrag(p));
  const geaendert: PlacementDef[] = [];
  const zurueck: string[] = [];
  const jetzt = new Set<string>();
  for (const p of neu) {
    if (!p.id) continue;
    jetzt.add(p.id);
    const schluessel = eintrag(p);
    if (vorher.get(p.id) === schluessel) continue;
    if (!vorher.has(p.id) && grabsteine?.get(p.id) === schluessel) {
      zurueck.push(p.id);
      continue;
    }
    geaendert.push(p);
  }
  const entfernt: string[] = [];
  for (const id of vorher.keys()) if (!jetzt.has(id)) entfernt.push(id);
  return { geaendert, entfernt, vorher, zurueck };
}

export function liveAbgleich(
  kontext: LayoutAbgleichKontext,
  alt: WorldLayout,
  neu: WorldLayout,
  grabsteine: Grabsteine = new Map()
): LiveAbgleich | LiveBestaetigung | LiveZuViele {
  const altListe = alt.placements ?? [];
  const neuListe = neu.placements ?? [];
  const { geaendert, entfernt, vorher, zurueck } = idDiff(altListe, neuListe, grabsteine);
  // Der Takt läuft im Spiel-Thread: Ab der Obergrenze wird nichts angewendet (die Datei gilt nach dem Neustart).
  if (geaendert.length + entfernt.length > AENDERUNGEN_MAX) return { art: 'zuViele', anzahl: geaendert.length + entfernt.length };
  const bekannt = (p: PlacementDef): { hash: number } | undefined => kontext.prefabs.getByName(p.prefab);

  // ── Was würde entfernt? ──
  // Ein ZDO je Platzierung aus dem Bestand suchen, nur wenn etwas zu entfernen oder zu ersetzen sein KANN.
  const ids = new Set<string>(entfernt);
  const ersatz = new Map<string, number>(); // geänderte id → Prefab-Hash, der jetzt gelten soll
  for (const p of geaendert) {
    const prefab = bekannt(p);
    if (prefab) ersatz.set(p.id!, prefab.hash);
  }
  for (const id of ersatz.keys()) ids.add(id);
  const kandidaten: { zdo: ZDO; id: string; ersetzt: boolean }[] = [];
  const mitZdo = new Set<string>(); // ids, zu denen es (noch) ein Layout-ZDO gibt
  if (ids.size > 0) {
    // Unbekannte Prefabs des NEUEN Dokuments: was zu ihnen gehören könnte, bleibt stehen (wie beim Boot).
    const unbekannte = neuListe.filter((p) => !bekannt(p));
    const geschont = (zdo: ZDO, layoutId: string): boolean =>
      unbekannte.some(
        (p) =>
          layoutId === p.id ||
          layoutId === layoutKennung(p) ||
          Math.hypot(zdo.position.x - p.x, zdo.position.z - p.z) <= SCHONZONE
      );
    const gruppen = new Map<string, ZDO[]>();
    for (const zdo of kontext.zdos.getAllZDOs()) {
      const layoutId = zdo.getString(LAYOUT_ID_MEMBER);
      if (!layoutId || !ids.has(layoutId) || istSpielerbau(zdo)) continue;
      mitZdo.add(layoutId);
      const g = gruppen.get(layoutId);
      if (g) g.push(zdo);
      else gruppen.set(layoutId, [zdo]);
    }
    for (const [id, gruppe] of gruppen) {
      const hash = ersatz.get(id);
      // Geänderte Platzierung: nur ersetzen, wenn KEIN ZDO der id zum neuen Prefab passt.
      if (hash !== undefined && gruppe.some((z) => z.prefabHash === hash)) continue;
      for (const zdo of gruppe) if (!geschont(zdo, id)) kandidaten.push({ zdo, id, ersetzt: hash !== undefined });
    }
  }

  // ── Massenlöschung abfangen ──
  // Gezählt werden entfernte Platzierungen; ein Prefab-Wechsel ersetzt nur das ZDO (die Platzierung bleibt).
  const betroffen = [...new Set(kandidaten.filter((k) => !k.ersetzt).map((k) => k.id))];
  const mitZustand = [...new Set(kandidaten.filter((k) => zustand(k.zdo) > 0).map((k) => k.id))];
  const alle = altListe.length > 0 && neuListe.length === 0;
  const zuViele =
    betroffen.length > MASSENLOESCHUNG_ANZAHL ||
    (betroffen.length >= MASSENLOESCHUNG_MINDEST && betroffen.length > MASSENLOESCHUNG_ANTEIL * altListe.length) ||
    (alle && betroffen.length > 0);
  if (zuViele || mitZustand.length > 0) {
    const regel = zuViele
      ? `würde ${betroffen.length} von ${altListe.length} Platzierungen entfernen (Grenze: ${MASSENLOESCHUNG_ANZAHL}, ${MASSENLOESCHUNG_ANTEIL * 100} % ab ${MASSENLOESCHUNG_MINDEST}, oder alle)`
      : `würde ZDOs mit Zustand entfernen`;
    const genannt = zuViele ? betroffen : mitZustand;
    const zeigen = genannt.slice(0, IDS_IM_TEXT).join(', ') + (genannt.length > IDS_IM_TEXT ? ` … (+${genannt.length - IDS_IM_TEXT})` : '');
    return { art: 'bestaetigung', detail: `${regel}: ${zeigen}`, ids: genannt };
  }

  // ── Entfernen, dann die geänderten Platzierungen abgleichen ──
  let entferntZdos = 0;
  const ueberzaehligeZdos: LayoutAbgleichErgebnis['ueberzaehligeZdos'] = [];
  for (const { zdo, id, ersetzt } of kandidaten) {
    if (ersetzt) ueberzaehligeZdos.push({ id: zdo.zdoid.toString(), kennung: id, member: zustand(zdo) });
    kontext.zdos.destroyZDO(zdo.zdoid);
    entferntZdos++;
  }
  // Grabsteine nachführen: ein entfernter Eintrag OHNE Objekt (gefällt) merkt sich seinen Schlüssel; ein
  // zurückgekehrter oder anders neu gesetzter Eintrag löscht seinen.
  for (const id of zurueck) grabsteine.delete(id);
  for (const p of geaendert) grabsteine.delete(p.id!);
  for (const id of entfernt) {
    if (mitZdo.has(id)) continue;
    grabsteine.delete(id);
    grabsteine.set(id, vorher.get(id)!);
  }
  while (grabsteine.size > GRABSTEINE_MAX) grabsteine.delete(grabsteine.keys().next().value as string);
  // `verworfen: 1` sperrt das Löschen im Abgleich: Alles, was nicht in der Auswahl steht, gälte sonst als verwaist.
  const ergebnis = layoutAbgleich(kontext, { ...neu, placements: geaendert }, { verworfen: 1, zusammengefasst: 0 });
  ergebnis.ohneLoeschen = null;
  ergebnis.entfernt += entferntZdos;
  ergebnis.ueberzaehlig += ueberzaehligeZdos.length;
  ergebnis.ueberzaehligeZdos.push(...ueberzaehligeZdos);
  return { art: 'angewendet', ergebnis, geaendert, unberuehrt: neuListe.length - geaendert.length };
}
