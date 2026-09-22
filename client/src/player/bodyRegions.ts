/** The body regions a set can replace or leave free. Pure name matching, no Babylon dependency, so both the
 * client and the Node armor tools read a body mesh's region the same way. */
export const BODY_REGIONS = ['Head', 'Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight',
  'HandLeft', 'HandRight', 'LegLeft', 'LegRight'] as const;
export type BodyRegion = typeof BODY_REGIONS[number];

const PATTERN = new RegExp(`(?:Chr_|WoV_BodyBase_(?:Male|Female)_)(${BODY_REGIONS.join('|')})(?:_(?:Male|Female)_\\d+)?(?:$|[. ])`);

/**
 * The single region a segmented body mesh's name names, or undefined for a name that names none (an unnamed or
 * unrelated mesh). The prefix anchors the match, so a mesh whose name merely CONTAINS a region word after the
 * one it is actually named for (e.g. a free hand called "Chr_HandLeft_Female_00 Head") still resolves to the
 * region it was actually named for, never to both.
 */
export function bodyRegionOfMeshName(name: string): BodyRegion | undefined {
  return PATTERN.exec(name)?.[1] as BodyRegion | undefined;
}
