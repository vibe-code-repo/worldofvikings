/**
 * D2 (client): the swing carries its combo step and tip time, the server's `AttackAck` is read, the
 * figure's chain restarts when the server counted differently, and the round trip is booked.
 * Pure: a stand-in socket and figure, a fake clock; no Babylon renderer.
 *
 * Run: npx tsx client/test/d2-quittung.ts   (from the repo root)
 */
import { PacketType } from '@wov/shared';
import { SchlagBuch, ERGEBNIS_KOMBO, ERGEBNIS_TREFFER } from '../src/net/Quittung';
import { verdrahteKampf } from '../src/net/KampfNetz';

let fehler = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fehler++;
}

console.log('[1] SchlagBuch:');
{
  const b = new SchlagBuch();
  const s1 = b.neu(1000, 1);
  const s2 = b.neu(1400, 2);
  check('fortlaufende Nummern', s1 === 1 && s2 === 2);
  const a1 = b.quittiere({ seq: 1, schritt: 1, ergebnis: ERGEBNIS_TREFFER }, 1041);
  check('Umlauf gemessen: 41 ms', a1?.latenzMs === 41 && !a1.kettenNeu, JSON.stringify(a1));
  const a2 = b.quittiere({ seq: 2, schritt: 0, ergebnis: ERGEBNIS_KOMBO }, 1445);
  check('verweigerte Kette beim neuesten Schlag: Kette neu', a2?.kettenNeu === true, JSON.stringify(a2));
  check('dieselbe Quittung zweimal: ignoriert', b.quittiere({ seq: 2, schritt: 0, ergebnis: ERGEBNIS_KOMBO }, 1500) === null);
  const c = new SchlagBuch();
  c.neu(0, 3);
  c.neu(100, 1);
  const alt = c.quittiere({ seq: 1, schritt: 1, ergebnis: ERGEBNIS_KOMBO }, 150);
  check('Quittung eines aelteren Schlags setzt die Kette NICHT zurueck', alt?.kettenNeu === false, JSON.stringify(alt));
  const d = new SchlagBuch();
  d.neu(0, 2);
  const z = d.quittiere({ seq: 1, schritt: 1, ergebnis: ERGEBNIS_TREFFER }, 30);
  check('Server zaehlt niedriger als die Figur (2 gespielt, 1 gezaehlt): Kette neu', z?.kettenNeu === true);
  const e = new SchlagBuch();
  for (let i = 0; i < 40; i++) e.neu(i, 1);
  check('eine Quittung, die nie kam, haelt das Buch nicht offen', e.quittiere({ seq: 1, schritt: 1, ergebnis: 0 }, 99) === null);
}

console.log('\n[2] Verdrahtung (Standin-Socket und -Figur):');
{
  type Handler = (r: never) => void;
  const handler = new Map<number, Handler[]>();
  let quelle: (() => { seq: number; schritt: number; alterMs: number; spitzeMs: number }) | null = null;
  const socket = {
    on: (t: number, h: Handler) => void handler.set(t, [...(handler.get(t) ?? []), h]),
    setzeSchlagQuelle: (q: typeof quelle) => void (quelle = q),
  };
  let kettenEnde = 0;
  const figur = { schlaegt: true, letzterHieb: 1, hiebSpitzeS: 0.5, kettenEnde: () => void kettenEnde++ };
  let uhr = 5000;
  const eingabe = { gesperrt: false } as never;
  verdrahteKampf(socket as never, eingabe, () => figur as never, { kampfEffekte: { treffer() {} }, kampfToene: { treffer() {} } }, () => uhr);
  check('Schlagquelle ist angemeldet', quelle !== null);
  const f = quelle!();
  check('Felder: Schritt 2 (Hieb-Index 1), Spitze 500 ms, Alter 0', f.schritt === 2 && f.spitzeMs === 500 && f.alterMs === 0 && f.seq === 1, JSON.stringify(f));
  figur.letzterHieb = 5;
  check('Schritt ist bei 3 gedeckelt', quelle!().schritt === 3);
  figur.schlaegt = false;
  const ohne = quelle!();
  check('Figur ohne Schlagclip: Schritt 0 (der Server zaehlt allein)', ohne.schritt === 0);
  // Quittung fuer den neuesten Schlag (seq 3): der Server verweigerte die Kette.
  const werte = [3, 0, ERGEBNIS_KOMBO];
  const leser = { readInt32: () => werte.shift()! };
  uhr = 5040;
  for (const h of handler.get(PacketType.AttackAck) ?? []) h(leser as never);
  check('Quittung verweigert die Kette: die Figur beginnt wieder bei Hieb 1', kettenEnde === 1);
}

console.log(fehler === 0 ? '\nD2 Quittung (Client): alles gruen' : `\nD2 Quittung (Client): ${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
