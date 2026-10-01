import { Inventory, findItem, starterSetForClass } from '@wov/shared';

/** The marker and inventory are persisted in the same world-save snapshot. */
export function grantStarterSet(inventory: Inventory, classId: string, figure: string, granted: string): string {
  if (granted) return granted;
  const set = starterSetForClass(classId, figure);
  // A future compatible set can still be delivered on a later login.
  if (!set) return '';
  // A copy that carries the kept raw stacks too (serialize/load would drop the ones without a definition).
  const staged = inventory.kopie();
  for (const part of set.parts) {
    const definition = findItem(part.item);
    if (!definition) throw new Error(`Missing starter item: ${part.item}`);
    // Existing manually delivered items count towards this initial delivery.
    if (staged.countOf(part.item)) continue;
    if (staged.addItem(definition, 1) !== 0) return '';
  }
  inventory.uebernimm(staged);
  return set.id;
}
