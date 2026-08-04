/**
 * WorldContext — die Einheit „eine Welt" (Review-Punkt 15 / Phase 6 des
 * Kartengenerierungs-Umbaus).
 *
 * Heute hält der WovServer genau EINEN Kontext (die Hauptwelt); alle
 * Systeme (Geo, Heightmaps, Zonen, ZDOs, Save) sind hier gebündelt, damit
 * künftige Welten — Housing-Welten mit eigenen Saves, Instanz-Shards —
 * als weitere Kontexte entstehen können statt als Koordinaten-Bänder im
 * selben ZDO-Raum (so behilft sich das Dungeon-System, mit isInDungeonBand
 * an sechs Stellen).
 *
 * Bewusst NUR das Fundament: Die WovServer-Felder (this.zdos, this.zones …)
 * zeigen weiter direkt auf die Bausteine des aktiven Kontexts — die
 * Aufrufstellen bleiben unangetastet. Der eigentliche Weltwechsel
 * (Kontext-Swap je Peer, mehrere gleichzeitig getickte Welten) ist das
 * Housing-Folgeprojekt; teleportPeer nimmt die worldId schon entgegen.
 */

import type { IGeo, HeightmapProvider } from '@wov/shared';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import type { ZoneManager } from './ZoneManager.js';
import type { WorldManager } from './WorldManager.js';

export const HAUPTWELT_ID = 'haupt';

export interface WorldContext {
  /** Stabile Kennung — 'haupt' für die eine Spielwelt. */
  readonly id: string;
  readonly geo: IGeo;
  readonly heightmaps: HeightmapProvider;
  readonly zones: ZoneManager;
  readonly zdos: ZDOManager;
  readonly worldManager: WorldManager;
}
