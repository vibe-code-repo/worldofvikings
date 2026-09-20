import { armorByFile, femaleWebArmorFile } from '@wov/shared';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { updateLegacyFemaleMask } from './legacyFemaleMask.js';
import { syncEmberrageGlow } from './emberrageGlow.js';
export { prepareLegacyFemaleBody } from './legacyFemaleMask.js';

/**
 * Resolve the fitted asset from the body actually loaded by the current origin.
 * The 63-bone web body needs the web fit of every female set; which files have one comes from the registry.
 */
export function armorFileForSkeleton(file: string, body: Skeleton | null): string {
  if (body?.bones.length === 63 && body.bones.some(b => b.name === 'UpperLeg_L')) return femaleWebArmorFile(file) ?? file;
  return file;
}

/** Fail before hiding the body if an incompatible skin was exported. */
export function verifyArmorSkin(body: Skeleton | null, part: Skeleton | null, file: string): void {
  if (!armorByFile(file)) return;
  if (!body || !part || body.bones.length !== part.bones.length ||
      body.bones.some((b, i) => b.name !== part.bones[i]?.name)) {
    throw new Error(`Incompatible armor skeleton: ${file}`);
  }
}

/** Only successfully loaded replacements may hide the corresponding base mesh. */
export function updateArmorVisibility(meshes: readonly AbstractMesh[], activeFiles: readonly string[]): void {
  if (meshes[0]) syncEmberrageGlow(meshes[0].getScene());
  const regions = new Set(activeFiles.flatMap(f => armorByFile(f)?.regions ?? []));
  for (const mesh of meshes) {
    if (updateLegacyFemaleMask(mesh, regions)) continue;
    const region = /(?:Chr_|WoV_BodyBase_(?:Male|Female)_)(Head|Torso|Hips|ArmUpperLeft|ArmUpperRight|ArmLowerLeft|ArmLowerRight|HandLeft|HandRight|LegLeft|LegRight)(?:_(?:Male|Female)_\d+)?(?:$|[. ])/.exec(mesh.name)?.[1];
    if (region) mesh.setEnabled(!regions.has(region));
  }
}
