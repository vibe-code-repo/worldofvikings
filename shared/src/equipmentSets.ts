import { IRONWARD_PARTS } from './ironward.js';
import { WILDWARDEN_PARTS } from './wildwarden.js';
import { ASHENVEIL_PARTS } from './ashenveil.js';
import { SEIDRAVEN_MALE_PARTS, SEIDRAVEN_FEMALE_PARTS } from './seidraven.js';
import { EMBERRAGE_MALE_PARTS, EMBERRAGE_FEMALE_PARTS } from './emberrage.js';
import { canWearArmor } from './armorCompatibility.js';

export const CHARACTER_CLASSES = ['krieger', 'schildmaid', 'jaeger', 'skalde', 'seherin', 'berserker', 'runenmagier', 'hexer', 'druide'] as const;
export function isCharacterClass(value: unknown): value is typeof CHARACTER_CLASSES[number] {
  return typeof value === 'string' && CHARACTER_CLASSES.some(id => id === value);
}
export const CLASS_EQUIPMENT_FAMILIES: Readonly<Record<string, string>> = {
  krieger: 'ironward', hexer: 'ashenveil', druide: 'wildwarden', seherin: 'seidraven', runenmagier: 'emberrage',
};

/** Server chooses the complete, compatible set; the client never chooses item IDs. */
export function starterSetForClass(classId: string, figure: string) {
  const family = CLASS_EQUIPMENT_FAMILIES[classId];
  return EQUIPMENT_SETS.find(set =>
    set.id.replace(/_(male|female)$/, '') === family &&
    canWearArmor(set.parts[0], figure));
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
] as const;

/** Same wire format for website and server; inventory and appearance IDs may differ. */
export function equipmentSetCatalog() {
  return {
    schemaVersion: 1,
    sets: EQUIPMENT_SETS.map(set => ({
      id: set.id, version: set.version, name: set.name, figure: set.figure,
      familyId: set.id.replace(/_(male|female)$/, ''),
      classId: Object.entries(CLASS_EQUIPMENT_FAMILIES).find(([, family]) =>
        family === set.id.replace(/_(male|female)$/, ''))?.[0],
      bodyVariant: set.parts[0]!.bodyVariant, bodyProfile: set.parts[0]!.bodyProfile,
      itemIds: set.parts.map(part => part.item),
      appearance: Object.fromEntries(set.parts.map(part => [part.slot, part.id])),
      parts: set.parts.map(part => ({
        itemId: part.item, appearanceId: part.id,
        name: part.name, equipmentSlot: part.equipment, appearanceSlot: part.slot,
        model: `${set.id.replace(/_(male|female)$/, '')}/${part.item}.glb`, icon: `${part.id}.png`, regions: part.regions,
        previewModel: `${set.figure === 'wikingerin' ? 'armor/' : ''}${set.id.replace(/_(male|female)$/, '')}/${part.item}.glb`,
        previewBodyProfile: set.figure === 'wikingerin' ? 'wov-female-v1' : 'wov-male-v1',
        ...('vfxProfile' in part ? { vfxProfile: part.vfxProfile } : {}),
        hideAppearance: part.hideAppearance,
        figure: part.figure, bodyVariant: part.bodyVariant, bodyProfile: part.bodyProfile,
      })),
    })),
  };
}

export type EquipmentSetCatalog = ReturnType<typeof equipmentSetCatalog>;
