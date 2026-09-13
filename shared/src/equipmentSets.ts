import { IRONWARD_PARTS } from './ironward.js';
import { WILDWARDEN_PARTS } from './wildwarden.js';
import { ASHENVEIL_PARTS } from './ashenveil.js';
import { SEIDRAVEN_MALE_PARTS, SEIDRAVEN_FEMALE_PARTS } from './seidraven.js';

/** Stable set IDs, separate from asset revisions. This catalog grants no items. */
export const EQUIPMENT_SETS = [
  { id: 'ironward', version: 3, name: 'Ironward', figure: 'wikinger', parts: IRONWARD_PARTS },
  { id: 'wildwarden', version: 3, name: 'Waldhüter', figure: 'wikinger', parts: WILDWARDEN_PARTS },
  { id: 'ashenveil', version: 1, name: 'Aschenschleier', figure: 'wikinger', parts: ASHENVEIL_PARTS },
  { id: 'seidraven_male', version: 1, name: 'Seidraven', figure: 'wikinger', parts: SEIDRAVEN_MALE_PARTS },
  { id: 'seidraven_female', version: 1, name: 'Seidraven', figure: 'wikingerin', parts: SEIDRAVEN_FEMALE_PARTS },
] as const;

/** Same wire format for website and server; inventory and appearance IDs may differ. */
export function equipmentSetCatalog() {
  return {
    schemaVersion: 1,
    sets: EQUIPMENT_SETS.map(set => ({
      id: set.id, version: set.version, name: set.name, figure: set.figure,
      familyId: set.id.startsWith('seidraven_') ? 'seidraven' : set.id,
      bodyVariant: set.parts[0]!.bodyVariant, bodyProfile: set.parts[0]!.bodyProfile,
      itemIds: set.parts.map(part => part.item),
      appearance: Object.fromEntries(set.parts.map(part => [part.slot, part.id])),
      parts: set.parts.map(part => ({
        itemId: part.item, appearanceId: part.id,
        name: part.name, equipmentSlot: part.equipment, appearanceSlot: part.slot,
        model: `${set.id.startsWith('seidraven_') ? 'seidraven' : set.id}/${part.item}.glb`, icon: `${part.id}.png`, regions: part.regions,
        hideAppearance: part.hideAppearance,
        figure: part.figure, bodyVariant: part.bodyVariant, bodyProfile: part.bodyProfile,
      })),
    })),
  };
}

export type EquipmentSetCatalog = ReturnType<typeof equipmentSetCatalog>;
