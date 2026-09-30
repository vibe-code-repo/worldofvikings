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
/** Copies a triple (length read once); anything that is not three long becomes `[]`, which `skalaEndlich` rejects. */
const kopiereSkala = (a: readonly number[]): BausatzSkala => {
  const laenge = a.length;
  return (laenge === 3 ? [a[0]!, a[1]!, a[2]!] : []) as unknown as BausatzSkala;
};
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
    // Every input field is read exactly once into a constant; only the constants are checked and used, so a getter
    // that answers differently the second time cannot smuggle a NaN past the check.
    const { x: ix, z: iz, kennungen } = i;
    const yaw = i.yaw ?? 0;
    if (!endlich(ix) || !endlich(iz) || !endlich(yaw)) {
      fehler.push(`Bausatz-Instanz "${i.id}": x, z oder yaw ist keine endliche Zahl — Instanz ausgelassen`);
      continue;
    }
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const t of bausatz.teile) {
      const { id: teilId, prefab, dx, dz, dy, yaw: teilYaw, pitch, roll, scale: skalaRoh, einebnen, gruppe } = t;
      // a scale triple is ALWAYS copied before anything is checked (length included); only the copy is checked and passed on
      const skala = Array.isArray(skalaRoh) ? kopiereSkala(skalaRoh) : skalaRoh;
      // An address in `kennungen` for a part id this kit does not have is never applied here, but it stays in the document:
      // a part inserted later with that id would take it over. `pruefeLayout` reports such orphans.
      const adresse = kennungen !== undefined && Object.hasOwn(kennungen, teilId) ? kennungen[teilId] : undefined;
      const id = typeof adresse === 'string' ? adresse : `${i.id}#${teilId}`;
      if (!endlich(dx) || !endlich(dz) || !endlich(teilYaw) || !skalaEndlich(skala) || [dy, pitch, roll].some((w) => w !== undefined && !endlich(w))) {
        fehler.push(`Bausatz-Teil "${teilId}" der Instanz "${i.id}": dx, dz, dy, yaw, pitch, roll oder scale ist keine endliche Zahl — Teil ausgelassen`);
        continue;
      }
      if (ids.has(id) || platzierungsIds.has(id)) {
        fehler.push(`Bausatz-Teil "${teilId}" der Instanz "${i.id}": id "${id}" ist schon vergeben — Teil ausgelassen`);
        continue;
      }
      ids.add(id);
      teile.push({
        id,
        instanz: i.id,
        bausatz: i.bausatz,
        teilId,
        prefab,
        x: rundePosition(ix + dx * c + dz * s),
        z: rundePosition(iz - dx * s + dz * c),
        ...(dy !== undefined ? { dy } : {}),
        yaw: yaw + teilYaw + 0,
        ...(pitch !== undefined ? { pitch } : {}),
        ...(roll !== undefined ? { roll } : {}),
        scale: skala,
        ...(einebnen !== undefined ? { einebnen } : {}),
        ...(gruppe !== undefined ? { gruppe } : {}),
      });
    }
  }
  teile.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { teile, unbekannt, fehler };
}
