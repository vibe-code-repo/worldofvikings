import { armorByFile } from '@wov/shared';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';

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
  const regions = new Set(activeFiles.flatMap(f => armorByFile(f)?.regions ?? []));
  for (const mesh of meshes) {
    const region = /(?:Chr_|WoV_BodyBase_Male_)(Head|Torso|Hips|ArmUpperLeft|ArmUpperRight|ArmLowerLeft|ArmLowerRight|HandLeft|HandRight|LegLeft|LegRight)(?:_Male_\d+)?(?:$|[. ])/.exec(mesh.name)?.[1];
    if (region) mesh.setEnabled(!regions.has(region));
  }
}
