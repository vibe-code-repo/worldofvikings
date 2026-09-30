/**
 * Resolver for kit instances (editor block C2): turns `WorldLayout.bausaetze` plus the kit
 * catalogue into plain world-space parts. Pure, DOM-free, no server or client imports.
 *
 * - id: `<instanz>#<teilId>` (`#` is outside `ID_RE`, so it never collides with a placement id);
 *   a part listed in the instance's `kennungen` gets the placement id given there instead.
 * - position: `anchor + rot(yaw_instanz)·(dx, dz)`, angle `yaw_instanz + yaw_teil`; position rounded
 *   to the millimetre, angle and scale passed on unrounded — the rule of the world sanitizer for placements,
 *   so a part whose anchor is a millimetre value and whose instance yaw is 0 equals the placement it replaces
 *   byte for byte (test: every placement of the real `dev.json`).
 * - rotation is right-handed around +Y (as `yawQuaternion`): `x' = dx·cosθ + dz·sinθ`,
 *   `z' = −dx·sinθ + dz·cosθ`.
 * - the result is sorted by id, so the order of the parts inside a kit file does not matter.
 * - `kennungen` is read as own properties only (a part id `constructor` is an ordinary string id).
 * - the resolver checks what it is given: a part or instance with a non-finite number is left out with a named
 *   `fehler`, never a NaN in the result.
 * - an unknown kit is no error: the instance lands in `unbekannt`. More than
 *   `BAUSATZ_AUFLOESUNG_MAX` parts, or a duplicate resolved id, is a named `fehler`, never capping.
 */

import type { PlacementDef, WorldLayout } from '../worldlayout/types.js';
import { rundePosition } from './sanitize.js';
import {
  BAUSATZ_AUFGELOEST_MAX,
  type AufgeloestesTeil,
  type Bausatz,
  type BausatzAufloesung,
  type BausatzSkala,
  type BausatzUnbekannt,
} from './types.js';

export type BausatzKatalog = ReadonlyMap<string, Bausatz> | readonly Bausatz[];

const endlich = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const skalaEndlich = (s: BausatzSkala): boolean => (typeof s === 'number' ? endlich(s) : Array.isArray(s) && s.length === 3 && s.every(endlich));

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
    if (!endlich(i.x) || !endlich(i.z) || !endlich(yaw)) {
      fehler.push(`Bausatz-Instanz "${i.id}": x, z oder yaw ist keine endliche Zahl — Instanz ausgelassen`);
      continue;
    }
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const t of bausatz.teile) {
      const adresse = i.kennungen !== undefined && Object.hasOwn(i.kennungen, t.id) ? i.kennungen[t.id] : undefined;
      const id = typeof adresse === 'string' ? adresse : `${i.id}#${t.id}`;
      const teilYaw = t.yaw;
      if (!endlich(t.dx) || !endlich(t.dz) || !endlich(teilYaw) || !skalaEndlich(t.scale) || [t.dy, t.pitch, t.roll].some((w) => w !== undefined && !endlich(w))) {
        fehler.push(`Bausatz-Teil "${t.id}" der Instanz "${i.id}": dx, dz, dy, yaw, pitch, roll oder scale ist keine endliche Zahl — Teil ausgelassen`);
        continue;
      }
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
        yaw: yaw + teilYaw + 0,
        ...(t.pitch !== undefined ? { pitch: t.pitch } : {}),
        ...(t.roll !== undefined ? { roll: t.roll } : {}),
        scale: typeof t.scale === 'number' ? t.scale : [t.scale[0], t.scale[1], t.scale[2]],
        ...(t.einebnen !== undefined ? { einebnen: t.einebnen } : {}),
        ...(t.gruppe !== undefined ? { gruppe: t.gruppe } : {}),
      });
    }
  }
  teile.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { teile, unbekannt, fehler };
}
