import { IRONWARD_PARTS } from './ironward.js';
import { WILDWARDEN_PARTS } from './wildwarden.js';
import { ASHENVEIL_PARTS } from './ashenveil.js';
import { SEIDRAVEN_MALE_PARTS, SEIDRAVEN_FEMALE_PARTS } from './seidraven.js';
import { EMBERRAGE_MALE_PARTS, EMBERRAGE_FEMALE_PARTS } from './emberrage.js';
import { PLAINHIDE_MALE_PARTS, PLAINHIDE_FEMALE_PARTS, PLAINHIDE_FREE_REGIONS } from './plainhide.js';
import { GRAVETHORN_MALE_PARTS, GRAVETHORN_FEMALE_PARTS } from './gravethorn.js';
import { CROWSHADE_MALE_PARTS, CROWSHADE_FEMALE_PARTS } from './crowshade.js';
import { canWearArmor } from './armorCompatibility.js';

export const CHARACTER_CLASSES = ['krieger', 'schildmaid', 'jaeger', 'skalde', 'seherin', 'berserker', 'runenmagier', 'hexer', 'druide'] as const;
export function isCharacterClass(value: unknown): value is typeof CHARACTER_CLASSES[number] {
  return typeof value === 'string' && CHARACTER_CLASSES.some(id => id === value);
}
export const CLASS_EQUIPMENT_FAMILIES: Readonly<Record<string, string>> = {
  krieger: 'ironward', hexer: 'ashenveil', druide: 'wildwarden', seherin: 'seidraven', runenmagier: 'emberrage', berserker: 'gravethorn', jaeger: 'crowshade',
};

/**
 * OPEN DECISION: does a character WITHOUT a class (empty `classId`) get the starter set? That is a new character made
 * through an API client that sends no class, and every character from before the class choice. Today it does not
 * (false): they keep an empty marker and are simply not served. Flipping this constant is the whole change; the tests
 * `server/test/starter-sets.ts` and `starter-sets-e2e.ts` pin both cases and name the expectation in one line each.
 * An unknown, non-empty class (`admin`, ...) never gets a set, whatever this says.
 */
export const STARTER_SET_FOR_CLASSLESS = false;

/**
 * Server chooses the complete, compatible set; the client never chooses item IDs.
 * Every valid class starts in the starter set (Plainhide) that fits the figure. The class sets in
 * CLASS_EQUIPMENT_FAMILIES are earned later and are never granted here. An unknown class gets nothing.
 */
export function starterSetForClass(classId: string, figure: string) {
  if (classId === '' ? !STARTER_SET_FOR_CLASSLESS : !isCharacterClass(classId)) return undefined;
  return EQUIPMENT_SETS.find(set => 'starter' in set && canWearArmor(set.parts[0], figure));
}

/** Stable set IDs, separate from asset revisions. This catalog grants no items. */
export const EQUIPMENT_SETS = [
  { id: 'ironward', version: 3, name: 'Ironward', figure: 'wikinger', parts: IRONWARD_PARTS },
  { id: 'wildwarden', version: 3, name: 'Waldhüter', figure: 'wikinger', parts: WILDWARDEN_PARTS },
  { id: 'ashenveil', version: 1, name: 'Aschenschleier', figure: 'wikinger', parts: ASHENVEIL_PARTS },
  { id: 'seidraven_male', version: 1, name: 'Seidraven', figure: 'wikinger', parts: SEIDRAVEN_MALE_PARTS },
  { id: 'seidraven_female', version: 1, name: 'Seidraven', figure: 'wikingerin', parts: SEIDRAVEN_FEMALE_PARTS },
  { id: 'emberrage_male', version: 1, name: 'Glutzorn', figure: 'wikinger', parts: EMBERRAGE_MALE_PARTS },
  { id: 'emberrage_female', version: 1, name: 'Glutzorn', figure: 'wikingerin', parts: EMBERRAGE_FEMALE_PARTS },
  // `starter` marks the set new characters start in; `freeRegions` are the body regions no piece replaces.
  { id: 'plainhide_male', version: 1, name: 'Plainhide', figure: 'wikinger', parts: PLAINHIDE_MALE_PARTS, starter: true, freeRegions: PLAINHIDE_FREE_REGIONS },
  { id: 'plainhide_female', version: 1, name: 'Plainhide', figure: 'wikingerin', parts: PLAINHIDE_FEMALE_PARTS, starter: true, freeRegions: PLAINHIDE_FREE_REGIONS },
  { id: 'gravethorn_male', version: 1, name: 'Gravethorn', figure: 'wikinger', parts: GRAVETHORN_MALE_PARTS },
  { id: 'gravethorn_female', version: 1, name: 'Gravethorn', figure: 'wikingerin', parts: GRAVETHORN_FEMALE_PARTS },
  { id: 'crowshade_male', version: 1, name: 'Crowshade', figure: 'wikinger', parts: CROWSHADE_MALE_PARTS },
  { id: 'crowshade_female', version: 1, name: 'Crowshade', figure: 'wikingerin', parts: CROWSHADE_FEMALE_PARTS },
] as const;

const familyOf = (setId: string) => setId.replace(/_(male|female)$/, '');
const classIdOf = (setId: string) => {
  const classId = Object.entries(CLASS_EQUIPMENT_FAMILIES).find(([, family]) => family === familyOf(setId))?.[0];
  return classId === undefined ? {} : { classId };
};

/**
 * Item file (`<family>/<item>`, no extension) -> the file of its 63-bone web-body fit under `armor/`.
 * Every set for the `wikingerin` figure ships one; the website preview and the catalog's `previewModel`
 * name the same files. Built from the registry, so a new female set needs no second list.
 */
const FEMALE_WEB_FILES: ReadonlyMap<string, string> = new Map(EQUIPMENT_SETS
  .filter(set => set.figure === 'wikingerin')
  .flatMap(set => set.parts.map(part => [`${familyOf(set.id)}/${part.item}`, `armor/${familyOf(set.id)}/${part.item}`] as const)));
export function femaleWebArmorFile(file: string): string | undefined {
  return FEMALE_WEB_FILES.get(file);
}

/** Same wire format for website and server; inventory and appearance IDs may differ. */
export function equipmentSetCatalog() {
  return {
    schemaVersion: 1,
    sets: EQUIPMENT_SETS.map(set => ({
      id: set.id, version: set.version, name: set.name, figure: set.figure,
      familyId: familyOf(set.id),
      // A set without a class (Plainhide) has no `classId` key at all, so the object equals its own JSON.
      ...classIdOf(set.id),
      bodyVariant: set.parts[0]!.bodyVariant, bodyProfile: set.parts[0]!.bodyProfile,
      ...('starter' in set ? { starter: set.starter, freeRegions: set.freeRegions } : {}),
      itemIds: set.parts.map(part => part.item),
      appearance: Object.fromEntries(set.parts.map(part => [part.slot, part.id])),
      parts: set.parts.map(part => ({
        itemId: part.item, appearanceId: part.id,
        name: part.name, equipmentSlot: part.equipment, appearanceSlot: part.slot,
        model: `${familyOf(set.id)}/${part.item}.glb`, icon: `${part.id}.png`, regions: part.regions,
        previewModel: `${femaleWebArmorFile(`${familyOf(set.id)}/${part.item}`) ?? `${familyOf(set.id)}/${part.item}`}.glb`,
        previewBodyProfile: set.figure === 'wikingerin' ? 'wov-female-v1' : 'wov-male-v1',
        ...('vfxProfile' in part ? { vfxProfile: part.vfxProfile } : {}),
        hideAppearance: part.hideAppearance,
        figure: part.figure, bodyVariant: part.bodyVariant, bodyProfile: part.bodyProfile,
      })),
    })),
  };
}

export type EquipmentSetCatalog = ReturnType<typeof equipmentSetCatalog>;
