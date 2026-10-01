/**
 * The ground height WITHOUT plinths and WITHOUT the hand correction, for the level tool (T3 N2).
 * The level tool aims the correction at `Ziel − Rohhöhe`, a number that does not depend on how the ground
 * answers to a correction next to a plinth (the slope there blends against the slab).
 *
 * Die Höhe ohne Sockel und ohne Handkorrektur: ein zweites, kleines Gelände aus demselben Layout ohne Platzierungen
 * und ohne `heightDeltas` (öffentliches `createWorld`, `shared/**` bleibt unberührt). Es entsteht erst beim ersten Ebnen.
 */
import { RegionGeo } from '@wov/shared';
import { createWorld } from '../../world/World';

/** `null` when `geo` is no layout ground (then the level tool falls back to the visible height). */
export function rohHoehenQuelle(geo: unknown): ((x: number, z: number) => number) | null {
  if (!(geo instanceof RegionGeo)) return null;
  const layout = { ...geo.layout, placements: [], heightDeltas: undefined };
  let welt: ReturnType<typeof createWorld> | null = null;
  return (x, z) => {
    welt ??= createWorld(undefined, {}, layout);
    return welt.getGroundHeight(x, z);
  };
}
