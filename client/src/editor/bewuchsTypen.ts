/**
 * Bruecke zwischen `BewuchsVorschau` und den geteilten Weltbausteinen.
 *
 * Die Vorschau braucht nur zwei Dinge aus `@wov/shared`: die Streufunktion
 * und die Typen ihrer Ein- und Ausgabe. Sie hier zu buendeln haelt die
 * Vorschau selbst frei von Import-Details und macht sichtbar, wie wenig
 * Beruehrungsflaeche zwischen Editor und Weltgenerierung noetig ist.
 */

export { streueZone } from '@wov/shared';
export type { StreuFund } from '@wov/shared';

import type { GeoManager, HeightmapProvider, RegionGeo } from '@wov/shared';

/**
 * Was die Vorschau von der Client-Welt braucht.
 *
 * `regionGeo` ist im Layout-Modus derselbe Gegenstand wie `geo` (RegionGeo
 * IST ein GeoManager) und sonst null — ohne ihn gibt es keine Kuratierung
 * und damit nichts vorzuschauen.
 */
export interface ClientWorldLike {
  readonly seed: number;
  readonly geo: GeoManager;
  readonly heightmaps: HeightmapProvider;
  readonly regionGeo: RegionGeo | null;
}
