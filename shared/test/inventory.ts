/**
 * Inventory parity checks (Unity Inventory.cs).
 *
 * The properties that matter for feel:
 *  1. Stacking merges into partial stacks and respects maxStackSize.
 *  2. Tools/weapons fill from the top row down (so a picked-up hoe lands in
 *     the hotbar), materials from the bottom up.
 *  3. The hotbar is exactly inventory row 0.
 *  4. Moving merges compatible stacks and swaps incompatible ones.
 *  5. A full inventory reports the leftover instead of silently dropping it.
 *  6. Save/load round-trips.
 *
 * Run: npx tsx shared/test/inventory.ts   (from the repo root)
 */

import { Inventory, findItem, HOTBAR_SIZE } from '../src/index.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

const HOE = findItem('Hoe')!;
const PICK = findItem('PickaxeAntler')!;
const WOOD = findItem('Wood')!;

// ── 1. Stacking ───────────────────────────────────────────────────
console.log('── stacking ──');
{
  const inv = new Inventory();
  check('wood stacks to 50', WOOD.maxStackSize === 50);

  inv.addItem(WOOD, 30);
  inv.addItem(WOOD, 15);
  check('merges into the partial stack', inv.all.length === 1, `slots=${inv.all.length}`);
  check('count is 45', inv.countOf('Wood') === 45, `${inv.countOf('Wood')}`);

  inv.addItem(WOOD, 20);
  check('overflow opens a second slot', inv.all.length === 2, `slots=${inv.all.length}`);
  check('total is 65', inv.countOf('Wood') === 65, `${inv.countOf('Wood')}`);
  check('first stack is full', inv.all.some((i) => i.stack === 50));

  const tools = new Inventory();
  tools.addItem(HOE, 1);
  tools.addItem(HOE, 1);
  check('non-stackable tools take separate slots', tools.all.length === 2, `slots=${tools.all.length}`);
}

// ── 2. Fill direction ─────────────────────────────────────────────
console.log('── fill direction ──');
{
  const inv = new Inventory();
  inv.addItem(HOE, 1);
  const hoe = inv.all[0];
  check('tool goes to the top row (hotbar)', hoe.gridY === 0, `gridY=${hoe.gridY}`);

  const mat = new Inventory();
  mat.addItem(WOOD, 1);
  check('material goes to the bottom row', mat.all[0].gridY === mat.height - 1, `gridY=${mat.all[0].gridY}`);
}

// ── 3. Hotbar is row 0 ────────────────────────────────────────────
console.log('── hotbar ──');
{
  const inv = new Inventory();
  inv.addItem(HOE, 1);
  inv.addItem(PICK, 1);
  const bar = inv.hotbar();
  check('hotbar has 8 slots', bar.length === HOTBAR_SIZE, `${bar.length}`);
  check('both tools are on the hotbar', bar.filter(Boolean).length === 2);
  check(
    'hotbar order follows gridX',
    bar[0]?.shared.name === 'Hoe' && bar[1]?.shared.name === 'PickaxeAntler',
    `${bar[0]?.shared.name}, ${bar[1]?.shared.name}`
  );

  // An item moved off row 0 must leave the hotbar.
  inv.moveTo(bar[0]!, 3, 2);
  check('moving off row 0 removes it from the hotbar', inv.hotbar().filter(Boolean).length === 1);
}

// ── 4. Moving: merge vs swap ──────────────────────────────────────
console.log('── move ──');
{
  // addItem always tops up partial stacks, so getting two separate wood stacks
  // means filling one to the brim first, then shrinking it again.
  const inv = new Inventory();
  inv.addItem(WOOD, 50); // full stack
  inv.addItem(WOOD, 10); // forced into a second slot
  check('setup produced two stacks', inv.all.length === 2, `slots=${inv.all.length}`);

  const full = inv.all.find((i) => i.stack === 50)!;
  const small = inv.all.find((i) => i.stack === 10)!;
  inv.removeItem(full, 30); // now 20 — room for the small stack

  inv.moveTo(small, full.gridX, full.gridY);
  check('dropping wood on wood merges', inv.all.length === 1, `slots=${inv.all.length}`);
  check('merged count is 30', inv.countOf('Wood') === 30, `${inv.countOf('Wood')}`);

  const sw = new Inventory();
  sw.addItem(HOE, 1);
  sw.addItem(PICK, 1);
  const hoe = sw.all.find((i) => i.shared.name === 'Hoe')!;
  const pick = sw.all.find((i) => i.shared.name === 'PickaxeAntler')!;
  const hoePos: [number, number] = [hoe.gridX, hoe.gridY];
  const pickPos: [number, number] = [pick.gridX, pick.gridY];
  sw.moveTo(hoe, pickPos[0], pickPos[1]);
  check(
    'different items swap places',
    hoe.gridX === pickPos[0] && hoe.gridY === pickPos[1] &&
      pick.gridX === hoePos[0] && pick.gridY === hoePos[1],
    `hoe→${hoe.gridX},${hoe.gridY} pick→${pick.gridX},${pick.gridY}`
  );

  check('out-of-bounds move is rejected', sw.moveTo(hoe, 99, 0) === false);
}

// ── 5. Full inventory reports the leftover ────────────────────────
console.log('── capacity ──');
{
  const inv = new Inventory(2, 2); // 4 slots
  const left = inv.addItem(WOOD, 4 * 50 + 7);
  check('reports what did not fit', left === 7, `left=${left}`);
  check('filled exactly 4 slots', inv.all.length === 4, `slots=${inv.all.length}`);
  check('stored the rest', inv.countOf('Wood') === 200, `${inv.countOf('Wood')}`);

  const none = inv.addItem(HOE, 1);
  check('nothing fits into a full inventory', none === 1, `left=${none}`);
}

// ── 6. Save / load round-trip ─────────────────────────────────────
console.log('── persistence ──');
{
  const inv = new Inventory();
  inv.addItem(HOE, 1);
  inv.addItem(WOOD, 73);
  const saved = JSON.parse(JSON.stringify(inv.serialize()));

  const restored = new Inventory();
  restored.load(saved);
  check('slot count survives', restored.all.length === inv.all.length, `${restored.all.length}`);
  check('wood count survives', restored.countOf('Wood') === 73, `${restored.countOf('Wood')}`);
  check('grid positions survive', restored.all.every((r) =>
    inv.all.some((o) => o.shared.name === r.shared.name && o.gridX === r.gridX && o.gridY === r.gridY)));

  const partial = new Inventory();
  partial.load([...saved, { name: 'NoSuchItem', stack: 1, durability: 1, quality: 1, gridX: 7, gridY: 3, equipped: false }]);
  check('unknown item names are skipped, not fatal', partial.all.length === inv.all.length);
}

// ── 7. Weight ─────────────────────────────────────────────────────
console.log('── weight ──');
{
  const inv = new Inventory();
  inv.addItem(WOOD, 10); // 2 each
  inv.addItem(HOE, 1); // 2
  check('weight counts stack size', inv.totalWeight() === 22, `${inv.totalWeight()}`);
}

console.log('');
if (failures === 0) {
  console.log('=== ALL INVENTORY TESTS PASSED ===');
} else {
  console.error(`=== ${failures} INVENTORY TEST(S) FAILED ===`);
  process.exit(1);
}
