/**
 * sockelDiff — which plateaus (placements with `einebnen > 0`) a layout change
 * removes and which it adds. Server and client apply the same diff to a running
 * RegionGeo (`sockelEntfernen` for `weg`, then `sockelEinfuegen` for `dazu`).
 *
 * The values are the DOCUMENT values (x, z, einebnen as stored in the layout),
 * never float32 vectors. A moved or changed plate counts as one `weg` plus one
 * `dazu`. Plates are compared as a multiset, so identical plates at the same
 * spot are matched one by one.
 *
 * Sockel-Diff: welche Platten wegfallen und welche dazukommen; Werte sind die
 * Dokumentwerte, eine verschobene oder geänderte Platte ist weg + dazu.
 */
import type { WorldLayout } from './types.js';

export interface SockelPlatte {
  x: number;
  z: number;
  einebnen: number;
}

export interface SockelDiff {
  /** Platten, die im alten Layout stehen und im neuen nicht (mehr). */
  weg: SockelPlatte[];
  /** Platten, die im neuen Layout stehen und im alten nicht. */
  dazu: SockelPlatte[];
}

/** All plates of a layout in document order (same filter as PlateauField). */
export function sockelPlatten(layout: Pick<WorldLayout, 'placements'> | null | undefined): SockelPlatte[] {
  const aus: SockelPlatte[] = [];
  for (const p of layout?.placements ?? []) {
    const r = p.einebnen;
    if (typeof r === 'number' && r > 0 && Number.isFinite(r) && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      aus.push({ x: p.x, z: p.z, einebnen: r });
    }
  }
  return aus;
}

const schluessel = (p: SockelPlatte): string => `${p.x}|${p.z}|${p.einebnen}`;

export function sockelDiff(
  altesLayout: Pick<WorldLayout, 'placements'> | null | undefined,
  neuesLayout: Pick<WorldLayout, 'placements'> | null | undefined
): SockelDiff {
  const alt = sockelPlatten(altesLayout);
  const neu = sockelPlatten(neuesLayout);
  const zaehl = new Map<string, number>();
  for (const p of alt) zaehl.set(schluessel(p), (zaehl.get(schluessel(p)) ?? 0) + 1);
  const dazu: SockelPlatte[] = [];
  for (const p of neu) {
    const k = schluessel(p);
    const n = zaehl.get(k) ?? 0;
    if (n > 0) zaehl.set(k, n - 1);
    else dazu.push(p);
  }
  // What is left in the count was in the old layout only.
  const weg: SockelPlatte[] = [];
  for (const p of alt) {
    const k = schluessel(p);
    const n = zaehl.get(k) ?? 0;
    if (n > 0) {
      zaehl.set(k, n - 1);
      weg.push(p);
    }
  }
  return { weg, dazu };
}
