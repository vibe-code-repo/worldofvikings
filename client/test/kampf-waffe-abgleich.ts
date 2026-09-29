/**
 * Combat core K2a, client side: equipping a weapon is shown at once and reported with Equip (the last
 * choice after a short quiet time); the server's EquipStand is the truth and the LAST state always
 * wins — rejection, unasked state, lost answer. Pure: a fake Equipment, no Babylon, no socket.
 * Real timers with short times (quiet 15 ms, expiry 150 ms).
 *
 * Run: npx tsx client/test/kampf-waffe-abgleich.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ItemStack, AusruestungsSlot } from '@wov/shared';
import { WaffenAbgleich, waffenStandHandler, RUHE_MS, FRIST_MS, type WaffenTraeger } from '../src/player/WaffenAbgleich';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ZEITEN = { ruheMs: 15, fristMs: 150 };
const RUHE = ZEITEN.ruheMs + 25;

const stapel = (name: string): ItemStack => ({ shared: { name } } as unknown as ItemStack);
const INV = new Map(['AxeFlint', 'SwordNorth', 'Messer'].map((n) => [n, stapel(n)]));

/** Same observable behaviour as Equipment: equip/unequip change the hand and notify. */
class FakeTraeger implements WaffenTraeger {
  hand: ItemStack | null = null;
  readonly hoerer = new Set<() => void>();
  get rightItem(): ItemStack | null { return this.hand; }
  onChanged(fn: () => void): () => void { this.hoerer.add(fn); return () => this.hoerer.delete(fn); }
  equip(item: ItemStack, _slot?: AusruestungsSlot): void { this.hand = item; [...this.hoerer].forEach((f) => f()); }
  unequip(_slot?: AusruestungsSlot): void { this.hand = null; [...this.hoerer].forEach((f) => f()); }
  waehle(name: string): void { this.equip(INV.get(name)!); }
  ablegen(): void { this.unequip(); }
}

function aufbau(): { t: FakeTraeger; a: WaffenAbgleich; gesendet: Array<[string, string]> } {
  const t = new FakeTraeger();
  const gesendet: Array<[string, string]> = [];
  const a = new WaffenAbgleich(t, (n) => INV.get(n) ?? null, (s, n) => gesendet.push([s, n]), ZEITEN);
  return { t, a, gesendet };
}
const name = (t: FakeTraeger): string => t.hand?.shared.name ?? '';
const namen = (g: Array<[string, string]>): string => g.map((x) => x[1]).join('|');

async function main(): Promise<void> {
  console.log('[1] Equip is sent (after the quiet time), the answer confirms');
  {
    const { t, a, gesendet } = aufbau();
    a.stand('waffe', '', false);
    pruefe('first server message: one greeting Equip with the server state (empty)', gesendet.length === 1 && gesendet[0]![1] === '', JSON.stringify(gesendet));
    a.stand('waffe', '', true);
    t.waehle('AxeFlint');
    pruefe('choosing the axe shows it at once, nothing sent yet (quiet time)', name(t) === 'AxeFlint' && gesendet.length === 1);
    await warte(RUHE);
    pruefe('after the quiet time: Equip(waffe, AxeFlint)', gesendet.length === 2 && gesendet[1]!.join() === 'waffe,AxeFlint', JSON.stringify(gesendet));
    a.stand('waffe', 'AxeFlint', true);
    pruefe('the confirming answer changes nothing and sends nothing', name(t) === 'AxeFlint' && gesendet.length === 2);
    t.ablegen(); await warte(RUHE);
    pruefe('putting it away sends Equip(waffe, "")', gesendet.length === 3 && gesendet[2]!.join() === 'waffe,');
    a.stand('waffe', '', true);
    pruefe('confirmed: hand empty, nothing more sent', name(t) === '' && gesendet.length === 3);
    a.dispose();
  }

  console.log('[2] Rejection rolls the display back');
  {
    const { t, a, gesendet } = aufbau();
    a.stand('waffe', 'AxeFlint', false);
    pruefe('login state with a weapon: shown', name(t) === 'AxeFlint');
    a.stand('waffe', 'AxeFlint', true);
    const vorher = gesendet.length;
    t.waehle('Messer');
    pruefe('optimistic: Messer shown at once', name(t) === 'Messer');
    await warte(RUHE);
    pruefe('one Equip sent', gesendet.length === vorher + 1);
    a.stand('waffe', 'AxeFlint', true);
    pruefe('server says AxeFlint (rejected): back to the axe', name(t) === 'AxeFlint');
    await warte(RUHE);
    pruefe('the rollback itself sends nothing (no ping-pong)', gesendet.length === vorher + 1);
    t.waehle('SwordNorth'); await warte(RUHE);
    a.stand('waffe', '', true);
    pruefe('rejection to "nothing": hand emptied', name(t) === '');
    a.dispose();
  }

  console.log('[3] Unasked states always win');
  {
    const { t, a, gesendet } = aufbau();
    a.stand('waffe', '', false); a.stand('waffe', '', true);
    t.waehle('AxeFlint'); await warte(RUHE); a.stand('waffe', 'AxeFlint', true);
    const n = gesendet.length;
    a.stand('waffe', '', false);
    pruefe('the weapon fell off on the server: the hand is emptied', name(t) === '');
    await warte(RUHE);
    pruefe('... without sending anything back', gesendet.length === n);
    a.stand('waffe', 'Gone', false);
    pruefe('a server weapon the client does not have: hand stays empty', name(t) === '');
    a.stand('kopf', 'AxeFlint', false);
    pruefe('another slot is ignored', name(t) === '');
    // unasked while an answer is still open: it must still be applied
    t.waehle('SwordNorth'); await warte(RUHE);
    a.stand('waffe', '', false);
    pruefe('unasked state while an Equip is unanswered: applied at once', name(t) === '');
    a.dispose();
  }

  console.log('[4] Quick switching is condensed: one Equip, last choice, no flicker');
  {
    const { t, a, gesendet } = aufbau();
    a.stand('waffe', '', false); a.stand('waffe', '', true);
    const n = gesendet.length;
    const gesehen: string[] = [];
    t.onChanged(() => gesehen.push(name(t)));
    for (let i = 0; i < 30; i++) { t.waehle(i % 2 === 0 ? 'AxeFlint' : 'SwordNorth'); await warte(3); }
    pruefe('30 quick choices show at once (30 changes)', gesehen.length === 30);
    await warte(RUHE);
    pruefe('exactly one Equip, naming the LAST choice', gesendet.length === n + 1 && gesendet[n]![1] === 'SwordNorth', namen(gesendet));
    a.stand('waffe', 'SwordNorth', true);
    pruefe('confirmed, hand unchanged (still 30 changes, no flicker)', name(t) === 'SwordNorth' && gesehen.length === 30);
    a.dispose();
  }
  {
    // A -> (sent) -> B while A is unanswered: A's answer must not flip the display.
    const { t, a, gesendet } = aufbau();
    a.stand('waffe', '', false); a.stand('waffe', '', true);
    t.waehle('AxeFlint'); await warte(RUHE);
    t.waehle('SwordNorth');
    a.stand('waffe', 'AxeFlint', true);
    pruefe('answer to the older Equip while a newer choice is pending: not applied', name(t) === 'SwordNorth');
    await warte(RUHE);
    a.stand('waffe', 'SwordNorth', true);
    pruefe('the last answer confirms', name(t) === 'SwordNorth' && namen(gesendet) === '|AxeFlint|SwordNorth', namen(gesendet));
    a.dispose();
  }
  {
    // back to the server state within the quiet time: nothing to send
    const { t, a, gesendet } = aufbau();
    a.stand('waffe', 'AxeFlint', false); a.stand('waffe', 'AxeFlint', true);
    const n = gesendet.length;
    t.waehle('SwordNorth'); t.waehle('AxeFlint'); await warte(RUHE);
    pruefe('A -> B -> A within the quiet time sends nothing', gesendet.length === n);
    a.dispose();
  }

  console.log('[5] A lost answer (server throttle) does not freeze the client');
  {
    const { t, a, gesendet } = aufbau();
    a.stand('waffe', '', false); a.stand('waffe', '', true);
    t.waehle('AxeFlint'); await warte(RUHE);
    const n = gesendet.length;   // the Equip is out; no answer ever comes
    await warte(ZEITEN.fristMs + 80);
    pruefe('the unanswered choice is sent again after the expiry', gesendet.length === n + 1 && gesendet[n]![1] === 'AxeFlint', namen(gesendet));
    a.stand('waffe', 'AxeFlint', true);
    a.stand('waffe', '', false);
    pruefe('afterwards an unasked state (weapon into a chest) is applied', name(t) === '');
    a.dispose();
  }
  {
    const { t, a } = aufbau();
    a.stand('waffe', '', false); a.stand('waffe', '', true);
    t.waehle('AxeFlint'); await warte(RUHE);
    await warte(ZEITEN.fristMs + 80);   // no answer, expired
    a.stand('waffe', 'SwordNorth', true);
    pruefe('a late answer after the expiry is applied (last server state wins)', name(t) === 'SwordNorth');
    a.dispose();
  }
  {
    const { t, a, gesendet } = aufbau();
    a.stand('waffe', '', false);   // greeting goes out, and its answer never comes
    await warte(ZEITEN.fristMs + 50);
    t.waehle('AxeFlint'); await warte(RUHE);
    a.stand('waffe', 'AxeFlint', true);
    pruefe('a lost greeting answer does not hold back the next real answer', name(t) === 'AxeFlint' && gesendet.length === 2);
    a.dispose();
  }

  console.log('[6] The stand handler and reconnects');
  {
    const t1 = new FakeTraeger(); const t2 = new FakeTraeger();
    let aktuell: FakeTraeger | null = t1;
    const gesendet: Array<[string, string]> = [];
    const h = waffenStandHandler(() => aktuell, (n) => INV.get(n) ?? null, (s, n) => gesendet.push([s, n]), ZEITEN);
    const leser = (slot: string, item: string, auf: boolean) => { const w = [slot, item]; return { readString: () => w.shift()!, readBool: () => auf }; };
    h(leser('waffe', 'SwordNorth', false));
    pruefe('reads slot, item, flag and applies', name(t1) === 'SwordNorth' && gesendet.length === 1);
    aktuell = t2;
    h(leser('waffe', 'AxeFlint', false));
    pruefe('a new Equipment gets its own abgleich and greeting', name(t2) === 'AxeFlint' && gesendet.length === 2);
    aktuell = null;
    h(leser('waffe', 'AxeFlint', false));
    pruefe('no Equipment yet: ignored without error', true);
    h(leser('waffe', 'AxeFlint', false));
  }
  {
    // Connection 1..4 on the SAME Equipment: one change = exactly one Equip.
    const t = new FakeTraeger();
    const gesendet: Array<[string, string]> = [];
    const leser = (slot: string, item: string, auf: boolean) => { const w = [slot, item]; return { readString: () => w.shift()!, readBool: () => auf }; };
    for (let verbindung = 1; verbindung <= 4; verbindung++) {
      const h = waffenStandHandler(() => t, (n) => INV.get(n) ?? null, (s, n) => gesendet.push([s, n]), ZEITEN);
      h(leser('waffe', name(t), false));   // login state of this connection
      await warte(RUHE);
      const n = gesendet.length;
      t.waehle(verbindung % 2 === 0 ? 'AxeFlint' : 'SwordNorth'); await warte(RUHE);
      pruefe(`connection ${verbindung}: one change sends exactly one Equip`, gesendet.length === n + 1, `${gesendet.length - n}`);
      h(leser('waffe', name(t), true));
    }
    pruefe('only one listener is left on the Equipment', t.hoerer.size === 1, `${t.hoerer.size}`);
    const alle = new FakeTraeger();
    const a1 = new WaffenAbgleich(alle, () => null, () => undefined, ZEITEN);
    a1.dispose();
    pruefe('dispose() removes the listener', alle.hoerer.size === 0);
  }

  console.log('[7] Constants and main.ts guard');
  {
    pruefe('quiet time 100–150 ms, expiry ≥ 1 s (real defaults)', RUHE_MS >= 100 && RUHE_MS <= 150 && FRIST_MS >= 1000, `${RUHE_MS}/${FRIST_MS}`);
    const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const main = readFileSync(resolve(wurzel, 'client/src/main.ts'), 'utf-8');
    pruefe('main.ts < 3700 lines', main.split('\n').length < 3700, String(main.split('\n').length));
    pruefe('main.ts registers the EquipStand handler', /PacketType\.EquipStand,\s*waffenStandHandler/.test(main));
  }

  if (fehler > 0) { console.error(`\n${fehler} FAILED`); process.exit(1); }
  console.log('\nALL PASS');
}
void main();
