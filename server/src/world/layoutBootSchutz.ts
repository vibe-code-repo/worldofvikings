/**
 * Editor E2, Karte Z3: welche Layout-Objekte eine offene Bestätigung schützt.
 *
 * Reine Lesefunktion für die Boot-Log-Meldung. Sie läuft NACH einem Aufruf von
 * `layoutAbgleich(..., { keineLoeschung: true })`: die hier gefundenen ZDOs
 * stehen dann garantiert noch, weil genau das die Sperre bedeutet — es ist
 * also keine Vorausberechnung, sondern ein Nachlesen dessen, was stehen blieb.
 */
import type { WorldLayout } from '@wov/shared';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import { istSpielerbau } from './layoutAbgleich.js';

/** Ids von Layout-ZDOs, die im ÜBERGEBENEN Dokument fehlen (Spielerbauten zählen nie). */
export function betroffeneIds(zdos: ZDOManager, layout: WorldLayout): string[] {
  const gewollt = new Set(
    (layout.placements ?? []).map((p) => p.id).filter((id): id is string => typeof id === 'string')
  );
  const gefunden = new Set<string>();
  for (const zdo of zdos.getAllZDOs()) {
    if (istSpielerbau(zdo)) continue;
    const id = zdo.getString(LAYOUT_ID_MEMBER);
    if (id && !gewollt.has(id)) gefunden.add(id);
  }
  return [...gefunden];
}
