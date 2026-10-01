/**
 * Weapon helpers: which weapon a hit or a harvest is calculated with.
 *
 * Pure functions over an inventory. Moved here unchanged from
 * `../WovServer.ts` (refactoring I1, step 0b). `WovServer.ts` exports the four
 * names again, so every importer keeps its path.
 */

import { findItem, ItemType, SLOT_VORGABE } from '@wov/shared';
import type { Inventory } from '@wov/shared';

/**
 * Waffenname aus dem Angriffs-/Ernte-Paket nur übernehmen, wenn er
 * tatsächlich im Server-Inventar liegt (A2) — sonst Faust ('').
 *
 * Seit K2a kennt der Server die getragene Waffe (`peer.waffe`, Paket Equip);
 * diese Pruefung gilt nur noch fuer den Paketnamen alter Clients ohne Equip
 * (wirksameWaffe, Uebergangsregel WAFFE_PAKETNAME_OHNE_EQUIP). Ohne sie
 * schlug der Server den Schaden fuer den Paket-String direkt nach,
 * unabhaengig vom Besitz — Axtschaden ohne Axt und Werkzeugpflicht-Umgehung
 * beim Ernten (A2).
 */
export function gepruefteWaffe(inventar: Inventory, waffe: string): string {
  if (waffe === '') return waffe;
  return inventar.countOf(waffe) > 0 ? waffe : '';
}

/**
 * Darf dieser Gegenstand als Waffe getragen werden (K2a)? Er muss im
 * Server-Inventar liegen, in den Waffenslot gehoeren (kein Ruestungsteil,
 * kein anderer Slot) und darf kein blosses Material sein.
 */
export function waffeTragbar(inventar: Inventory, name: string): boolean {
  if (name === '' || inventar.countOf(name) <= 0) return false;
  const def = findItem(name);
  return !!def && !def.ruestungsteil && (def.ausruestung ?? SLOT_VORGABE) === 'waffe' && def.itemType !== ItemType.Material;
}

/**
 * Uebergangsregel fuer alte Clients (K2a): Solange eine Verbindung noch nie
 * ein Equip geschickt hat, gilt wie bisher der geprüfte Paketname
 * (gepruefteWaffe). Sonst wuerde ein offener Tab mit altem Client ploetzlich
 * mit der Faust schlagen und nicht mehr ernten. Auf `false` stellen, wenn
 * keine alten Clients mehr im Umlauf sind.
 */
export const WAFFE_PAKETNAME_OHNE_EQUIP = true;

/**
 * Die Waffe, mit der ein Schlag oder eine Ernte gerechnet wird. Rein, damit
 * beide Zweige der Uebergangsregel ohne Server testbar sind.
 */
export function wirksameWaffe(
  inventar: Inventory,
  getragen: string,
  equipGesehen: boolean,
  paketName: string,
  uebergang: boolean = WAFFE_PAKETNAME_OHNE_EQUIP,
): string {
  if (!equipGesehen && uebergang) return gepruefteWaffe(inventar, paketName);
  return waffeTragbar(inventar, getragen) ? getragen : '';
}

/**
 * Harvest levels a tree / a rock has at the moment: all trees are level 1 (a later card may add harder
 * ones), likewise all rocks. The field `ernte` of the item is a level too, so it says up to which level the
 * item can fell / break.
 */
export const BAUM_STUFE_STANDARD = 1;
export const FELS_STUFE_STANDARD = 1;

/**
 * Can this weapon fell a tree / break a rock? Decided by the field `ernte` of the item (code and data items
 * alike), not by its name. The fist (`''`) and unknown names never can.
 */
export function kannErnten(waffe: string, art: 'baum' | 'fels'): boolean {
  const stufe = findItem(waffe)?.ernte?.[art] ?? 0;
  return stufe >= (art === 'baum' ? BAUM_STUFE_STANDARD : FELS_STUFE_STANDARD);
}
