/**
 * Combat core K2a, client side: equipping a weapon is shown at once and reported with Equip; the
 * server's EquipStand is the truth and the display rolls back on a rejection. Pure: a fake
 * Equipment, no Babylon, no socket.
 *
 * Run: npx tsx client/test/kampf-waffe-abgleich.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ItemStack, AusruestungsSlot } from '@wov/shared';
import { WaffenAbgleich, waffenStandHandler, type WaffenTraeger } from '../src/player/WaffenAbgleich';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}

const stapel = (name: string): ItemStack => ({ shared: { name } } as unknown as ItemStack);
const INV = new Map(['AxeFlint', 'SwordNorth', 'Messer'].map((n) => [n, stapel(n)]));

/** Same observable behaviour as Equipment: equip/unequip change the hand and notify. */
class FakeTraeger implements WaffenTraeger {
  hand: ItemStack | null = null;
  private readonly hoerer = new Set<() => void>();
  get rightItem(): ItemStack | null { return this.hand; }
  onChanged(fn: () => void): () => void { this.hoerer.add(fn); return () => this.hoerer.delete(fn); }
  equip(item: ItemStack, _slot?: AusruestungsSlot): void { this.hand = item; this.hoerer.forEach((f) => f()); }
  unequip(_slot?: AusruestungsSlot): void { this.hand = null; this.hoerer.forEach((f) => f()); }
  // What the player does (hotbar / inventory double click):
  waehle(name: string): void { this.equip(INV.get(name)!); }
  ablegen(): void { this.unequip(); }
}

function aufbau(): { t: FakeTraeger; a: WaffenAbgleich; gesendet: Array<[string, string]> } {
  const t = new FakeTraeger();
  const gesendet: Array<[string, string]> = [];
  const a = new WaffenAbgleich(t, (n) => INV.get(n) ?? null, (s, n) => gesendet.push([s, n]));
  return { t, a, gesendet };
}
const name = (t: FakeTraeger): string => t.hand?.shared.name ?? '';

console.log('[1] Equip is sent, the answer confirms');
{
  const { t, a, gesendet } = aufbau();
  a.stand('waffe', '', false);
  pruefe('first server message: one greeting Equip with the server state (empty)', gesendet.length === 1 && gesendet[0]![1] === '', JSON.stringify(gesendet));
  a.stand('waffe', '', true);
  t.waehle('AxeFlint');
  pruefe('choosing the axe shows it at once and sends Equip(waffe, AxeFlint)', name(t) === 'AxeFlint' && gesendet.length === 2 && gesendet[1]!.join() === 'waffe,AxeFlint', JSON.stringify(gesendet));
  a.stand('waffe', 'AxeFlint', true);
  pruefe('the confirming answer changes nothing and sends nothing', name(t) === 'AxeFlint' && gesendet.length === 2);
  t.ablegen();
  pruefe('putting it away sends Equip(waffe, "")', gesendet.length === 3 && gesendet[2]!.join() === 'waffe,');
  a.stand('waffe', '', true);
  pruefe('confirmed: hand empty, nothing more sent', name(t) === '' && gesendet.length === 3);
}

console.log('[2] Rejection rolls the display back');
{
  const { t, a, gesendet } = aufbau();
  a.stand('waffe', 'AxeFlint', false);
  pruefe('login state with a weapon: shown', name(t) === 'AxeFlint');
  a.stand('waffe', 'AxeFlint', true);
  const vorher = gesendet.length;
  t.waehle('Messer');
  pruefe('optimistic: Messer shown at once, one Equip sent', name(t) === 'Messer' && gesendet.length === vorher + 1);
  a.stand('waffe', 'AxeFlint', true);
  pruefe('server says AxeFlint (rejected): back to the axe', name(t) === 'AxeFlint');
  pruefe('the rollback itself sends nothing (no ping-pong)', gesendet.length === vorher + 1);
  t.waehle('SwordNorth');
  a.stand('waffe', '', true);
  pruefe('rejection to "nothing": hand emptied', name(t) === '');
}

console.log('[3] Unasked states (login, item gone)');
{
  const { t, a, gesendet } = aufbau();
  a.stand('waffe', '', false);
  a.stand('waffe', '', true);
  t.waehle('AxeFlint'); a.stand('waffe', 'AxeFlint', true);
  const n = gesendet.length;
  a.stand('waffe', '', false);
  pruefe('the weapon fell off on the server: the hand is emptied', name(t) === '');
  pruefe('... without sending anything back', gesendet.length === n);
  a.stand('waffe', 'Gone', false);
  pruefe('a server weapon the client does not have in the inventory: hand stays empty', name(t) === '');
  a.stand('kopf', 'AxeFlint', false);
  pruefe('another slot is ignored', name(t) === '');
}

console.log('[4] Quick switching: the last answer wins, no flicker');
{
  const { t, a, gesendet } = aufbau();
  a.stand('waffe', '', false); a.stand('waffe', '', true);
  const n = gesendet.length;
  const gesehen: string[] = [];
  t.onChanged(() => gesehen.push(name(t)));
  t.waehle('AxeFlint'); t.waehle('SwordNorth');
  pruefe('two Equips on the way', gesendet.length === n + 2);
  a.stand('waffe', 'AxeFlint', true);
  pruefe('the first answer (axe) is NOT applied while the second is open', name(t) === 'SwordNorth');
  a.stand('waffe', 'SwordNorth', true);
  pruefe('the last answer confirms the sword', name(t) === 'SwordNorth');
  pruefe('the hand was changed exactly twice (no flicker)', gesehen.join() === 'AxeFlint,SwordNorth', gesehen.join());
}

console.log('[5] Inventory sync clearing the hand');
{
  const { t, a, gesendet } = aufbau();
  a.stand('waffe', '', false); a.stand('waffe', '', true);
  t.waehle('AxeFlint'); a.stand('waffe', 'AxeFlint', true);
  t.ablegen();   // what Equipment.syncWithInventory does when the stack is gone
  a.stand('waffe', '', false);   // unasked state arrives while the Equip('') answer is open
  pruefe('still open answer: unasked state does not fight the local state', name(t) === '');
  a.stand('waffe', '', true);
  pruefe('settled: empty, exactly the Equip messages we expect', name(t) === '' && gesendet.map((g) => g[1]).join('|') === '|AxeFlint|', gesendet.map((g) => g[1]).join('|'));
}

console.log('[6] The stand handler');
{
  const t1 = new FakeTraeger(); const t2 = new FakeTraeger();
  let aktuell: FakeTraeger | null = t1;
  const gesendet: Array<[string, string]> = [];
  const h = waffenStandHandler(() => aktuell, (n) => INV.get(n) ?? null, (s, n) => gesendet.push([s, n]));
  const leser = (slot: string, item: string, auf: boolean) => { const w = [slot, item]; return { readString: () => w.shift()!, readBool: () => auf }; };
  h(leser('waffe', 'SwordNorth', false));
  pruefe('reads slot, item, flag and applies', name(t1) === 'SwordNorth' && gesendet.length === 1);
  aktuell = t2;
  h(leser('waffe', 'AxeFlint', false));
  pruefe('a new Equipment gets its own abgleich and greeting', name(t2) === 'AxeFlint' && gesendet.length === 2);
  aktuell = null;
  h(leser('waffe', 'AxeFlint', false));
  pruefe('no Equipment yet: ignored without error', true);
}

console.log('[7] main.ts guard');
{
  const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const zeilen = readFileSync(resolve(wurzel, 'client/src/main.ts'), 'utf-8').split('\n').length;
  pruefe('main.ts < 3700 lines', zeilen < 3700, String(zeilen));
  const main = readFileSync(resolve(wurzel, 'client/src/main.ts'), 'utf-8');
  pruefe('main.ts registers the EquipStand handler', /PacketType\.EquipStand,\s*waffenStandHandler/.test(main));
}

if (fehler > 0) { console.error(`\n${fehler} FAILED`); process.exit(1); }
console.log('\nALL PASS');
