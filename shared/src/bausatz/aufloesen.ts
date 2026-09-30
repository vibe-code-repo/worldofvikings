/**
 * Resolver for kit instances (editor block C2): turns `WorldLayout.bausaetze` plus the kit
 * catalogue into plain world-space parts. Pure, DOM-free, no server or client imports.
 *
 * - id: `<instanz>#<teilId>` (`#` is outside `ID_RE`, so it never collides with a placement id);
 *   a part listed in the instance's `kennungen` gets the placement id given there instead.
 * - position: `anchor + rot(yaw_instanz)·(dx, dz)`, angle `yaw_instanz + yaw_teil`; position rounded
 *   to 1e-3, angle and scale to 1e-6 — exactly like the world sanitizer, so a resolved part
 *   equals the placement it replaces to the millimetre.
 * - rotation is right-handed around +Y (as `yawQuaternion`): `x' = dx·cosθ + dz·sinθ`,
 *   `z' = −dx·sinθ + dz·cosθ`.
 * - the result is sorted by id, so the order of the parts inside a kit file does not matter.
 * - an unknown kit is no error: the instance lands in `unbekannt`. More than
 *   `BAUSATZ_AUFLOESUNG_MAX` parts, or a duplicate resolved id, is a named `fehler`, never capping.
 */

import type { PlacementDef, WorldLayout } from '../worldlayout/types.js';
import { rundePosition, rundeWinkel } from './sanitize.js';
import {
  BAUSATZ_AUFGELOEST_MAX,
  type AufgeloestesTeil,
  type Bausatz,
  type BausatzAufloesung,
  type BausatzSkala,
  type BausatzUnbekannt,
} from './types.js';

export type BausatzKatalog = ReadonlyMap<string, Bausatz> | readonly Bausatz[];

const skalaRunden = (s: BausatzSkala): BausatzSkala =>
  typeof s === 'number' ? rundeWinkel(s) : [rundeWinkel(s[0]), rundeWinkel(s[1]), rundeWinkel(s[2])];

export function loeseBausaetzeAuf(
  layout: Pick<WorldLayout, 'bausaetze'> & { placements?: readonly Pick<PlacementDef, 'id'>[] },
  bausaetze: BausatzKatalog
): BausatzAufloesung {
  const katalog: ReadonlyMap<string, Bausatz> = Array.isArray(bausaetze)
    ? new Map((bausaetze as readonly Bausatz[]).map((b) => [b.id, b]))
    : (bausaetze as ReadonlyMap<string, Bausatz>);
  const instanzen = layout.bausaetze ?? [];
  const unbekannt: BausatzUnbekannt[] = [];
  const fehler: string[] = [];

  // Count first: over the limit nothing is resolved (no silent capping).
  let summe = 0;
  for (const i of instanzen) summe += katalog.get(i.bausatz)?.teile.length ?? 0;
  if (summe > BAUSATZ_AUFGELOEST_MAX) {
    for (const i of instanzen) if (!katalog.has(i.bausatz)) unbekannt.push({ instanz: i.id, bausatz: i.bausatz });
    fehler.push(`${summe} aufgelöste Bausatz-Teile — mehr als ${BAUSATZ_AUFGELOEST_MAX} nimmt eine Welt nicht auf; nichts aufgelöst`);
    return { teile: [], unbekannt, fehler };
  }

  const platzierungsIds = new Set<string>();
  for (const p of layout.placements ?? []) if (p.id !== undefined) platzierungsIds.add(p.id);
  const teile: AufgeloestesTeil[] = [];
  const ids = new Set<string>();
  for (const i of instanzen) {
    const bausatz = katalog.get(i.bausatz);
    if (!bausatz) {
      unbekannt.push({ instanz: i.id, bausatz: i.bausatz });
      continue;
    }
    const yaw = i.yaw ?? 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const t of bausatz.teile) {
      const id = i.kennungen?.[t.id] ?? `${i.id}#${t.id}`;
      if (ids.has(id) || platzierungsIds.has(id)) {
        fehler.push(`Bausatz-Teil "${t.id}" der Instanz "${i.id}": id "${id}" ist schon vergeben — Teil ausgelassen`);
        continue;
      }
      ids.add(id);
      teile.push({
        id,
        instanz: i.id,
        bausatz: i.bausatz,
        teilId: t.id,
        prefab: t.prefab,
        x: rundePosition(i.x + t.dx * c + t.dz * s),
        z: rundePosition(i.z - t.dx * s + t.dz * c),
        ...(t.dy !== undefined ? { dy: t.dy } : {}),
        yaw: rundeWinkel(yaw + t.yaw),
        ...(t.pitch !== undefined ? { pitch: t.pitch } : {}),
        ...(t.roll !== undefined ? { roll: t.roll } : {}),
        scale: skalaRunden(t.scale),
        ...(t.einebnen !== undefined ? { einebnen: t.einebnen } : {}),
        ...(t.gruppe !== undefined ? { gruppe: t.gruppe } : {}),
      });
    }
  }
  teile.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { teile, unbekannt, fehler };
}
