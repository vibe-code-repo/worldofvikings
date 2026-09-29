/**
 * Kampftöne (client/src/engine/Audio/KampfToene.ts): Schwung zum Hiebzeitpunkt
 * (nicht beim Klick), Treffer und Parade nur mit Serverpaket `HitEffect`,
 * Faust ohne Schwungton, jede verwendete Gruppe im echten `toene`-Abschnitt.
 * Pure: falsche Uhr, falsche Ton-Engine, kein Babylon-Renderer.
 *
 * Lauf: npx tsx client/test/kampf-toene.ts   (aus dem Repo-Wurzel)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KAMPF_GRUPPEN,
  KampfToene,
  SCHWUNG_VERZUG_S,
  TREFFER_ERNTE,
  TREFFER_FLEISCH,
  TREFFER_PARADE,
  type KampfFigur,
  type Uhr,
  type Waffensatz,
} from '../src/engine/Audio/KampfToene';
import { readAudioManifest, groupByBus } from '../src/engine/Audio/AudioManifest';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

/** Uhr, die nur auf Befehl weiterläuft. */
class FalscheUhr implements Uhr {
  t = 0;
  private naechste = 1;
  private geplant = new Map<number, { faellig: number; fn: () => void }>();
  jetzt(): number {
    return this.t;
  }
  setze(fn: () => void, ms: number): unknown {
    const id = this.naechste++;
    this.geplant.set(id, { faellig: this.t + ms / 1000, fn });
    return id;
  }
  loesche(h: unknown): void {
    this.geplant.delete(h as number);
  }
  /** Läuft bis `bis` Sekunden, feuert fällige Zeitgeber in Reihenfolge. */
  bis(bis: number): void {
    for (;;) {
      let best: [number, { faellig: number; fn: () => void }] | null = null;
      for (const e of this.geplant) if (e[1].faellig <= bis + 1e-9 && (!best || e[1].faellig < best[1].faellig)) best = e;
      if (!best) break;
      this.geplant.delete(best[0]);
      this.t = Math.max(this.t, best[1].faellig);
      best[1].fn();
    }
    this.t = bis;
  }
}

/** Ohne die Schwungtöne (combat/slash…): nur Treffer, Parade, Ernte. */
function ohneSchwung(spuren: Spur[]): Spur[] {
  return spuren.filter((x) => !/^combat\/slash/.test(x.gruppe));
}

interface Spur {
  zeit: number;
  bus: string;
  gruppe: string;
  pos: { x: number; y: number; z: number } | null;
}

function aufbau(waffe = 'SwordNorth') {
  const uhr = new FalscheUhr();
  const spuren: Spur[] = [];
  const audio = {
    async playAsync(bus: string, gruppe: string, o: { position?: { x: number; y: number; z: number } } = {}) {
      spuren.push({ zeit: uhr.t, bus, gruppe, pos: o.position ? { x: o.position.x, y: o.position.y, z: o.position.z } : null });
    },
  };
  const figur = { position: { x: 10, y: 0, z: 10 }, avatar: { schlaegt: false, letzterHieb: -1 } };
  let w = waffe;
  const k = new KampfToene(
    () => audio as never,
    () => figur as KampfFigur,
    () => w,
    uhr,
  );
  /** Klick wie in main.ts: Avatar startet den Hieb, dann meldet main den Schlag. */
  const klick = (satz: Waffensatz, hieb: number, bogen?: () => void) => {
    figur.avatar.schlaegt = true;
    figur.avatar.letzterHieb = hieb;
    k.schlag(satz, hieb, bogen);
  };
  return { uhr, spuren, figur, k, klick, setzeWaffe: (n: string) => (w = n) };
}

console.log('=== Kampftöne ===');

console.log('\n[1] Schwung zum Hiebzeitpunkt:');
{
  const gruppen = ['combat/slash', 'combat/slash', 'combat/slash-heavy'];
  const verzoegerung: number[] = [];
  for (let hieb = 0; hieb < 3; hieb++) {
    const a = aufbau();
    a.uhr.t = 100;
    a.klick('schwert', hieb);
    pruefe(`Hieb ${hieb + 1}: beim Klick noch kein Ton`, a.spuren.length === 0);
    const verzug = SCHWUNG_VERZUG_S[hieb]!;
    a.uhr.bis(100 + verzug - 0.01);
    pruefe(`Hieb ${hieb + 1}: 10 ms vor dem Hieb noch kein Ton`, a.spuren.length === 0);
    a.uhr.bis(100 + verzug + 0.01);
    pruefe(`Hieb ${hieb + 1}: genau ein Ton`, a.spuren.length === 1, String(a.spuren.length));
    const s = a.spuren[0];
    pruefe(`Hieb ${hieb + 1}: Gruppe ${gruppen[hieb]}`, s?.gruppe === gruppen[hieb], String(s?.gruppe));
    pruefe(`Hieb ${hieb + 1}: Bus world, räumlich an der Figur`, s?.bus === 'world' && s.pos?.x === 10 && s.pos?.z === 10);
    verzoegerung.push(s ? s.zeit - 100 : NaN);
  }
  console.log(`  Verzug Klick -> Ton (Auslösen): ${verzoegerung.map((v) => `${(v * 1000).toFixed(0)} ms`).join(' / ')}`);
  pruefe('Verzug = 280/400/680 ms', verzoegerung.every((v, i) => Math.abs(v - SCHWUNG_VERZUG_S[i]!) < 1e-6));
  pruefe('Schlag 3 klingt nach dem 1. um mindestens 0,3 s später', verzoegerung[2]! - verzoegerung[0]! >= 0.3);
}

console.log('\n[2] Abgebrochene Schläge:');
{
  const a = aufbau();
  a.klick('schwert', 0);
  a.uhr.bis(0.1);
  a.klick('schwert', 1); // neuer Klick setzt den Hieb neu an
  a.uhr.bis(0.29);
  pruefe('Hieb 1 wurde vom neuen Klick verworfen (nichts bei 0,28 s nach dem 1. Klick)', a.spuren.length === 0);
  a.uhr.bis(0.6);
  pruefe('… nur Hieb 2 klingt, einmal', a.spuren.length === 1 && a.spuren[0]!.gruppe === 'combat/slash', String(a.spuren.length));
}
{
  const a = aufbau();
  a.klick('schwert', 0);
  a.uhr.bis(0.1);
  a.klick('schwert', 0); // gleicher Hieb noch einmal angestossen (einzelner Clip): erster verfaellt
  a.uhr.bis(0.6);
  pruefe('gleicher Hieb zweimal angestossen: nur ein Ton, beim zweiten Klick + 0,28 s', a.spuren.length === 1 && Math.abs(a.spuren[0]!.zeit - 0.38) < 1e-6, JSON.stringify(a.spuren.map((x) => x.zeit)));
}
{
  const a = aufbau();
  a.klick('schwert', 2);
  a.figur.avatar.schlaegt = false; // Clip unterbrochen (Modellwechsel, Clip zu Ende)
  a.uhr.bis(1);
  pruefe('Schlag läuft beim Hiebzeitpunkt nicht mehr -> kein Ton', a.spuren.length === 0);
}
{
  const a = aufbau();
  a.klick('schwert', 2);
  a.figur.avatar.letzterHieb = 0; // Kombo neu begonnen ohne unseren Aufruf
  a.uhr.bis(1);
  pruefe('anderer Hieb läuft als angemeldet -> kein Ton', a.spuren.length === 0);
}

console.log('\n[3] Faust, Stab, Speer:');
{
  for (const satz of ['faust', 'stab', 'speer'] as Waffensatz[]) {
    const a = aufbau();
    a.klick(satz, 0);
    a.uhr.bis(2);
    pruefe(`${satz}: kein Schwert-Schwung`, a.spuren.length === 0);
  }
  const a = aufbau();
  let bogen = 0;
  a.klick('faust', 0);
  a.klick('schwert', 0, () => (bogen += 1));
  a.uhr.bis(0.29);
  pruefe('Slash-Halbmond kommt zum selben Zeitpunkt wie der Ton (0,28 s)', bogen === 1 && a.spuren.length === 1);
}

console.log('\n[4] Treffer nur mit Serverpaket:');
{
  const a = aufbau();
  a.klick('schwert', 0);
  a.uhr.bis(3);
  pruefe('Schlag ohne HitEffect: nur der Schwung, kein Treffer-Ton', a.spuren.length === 1 && a.spuren[0]!.gruppe === 'combat/slash');
  a.spuren.length = 0;
  const ziel = { x: 13, y: 1, z: 10 };
  a.klick('schwert', 0);
  a.uhr.bis(a.uhr.t + 0.1);
  a.k.treffer(ziel, TREFFER_FLEISCH);
  a.uhr.bis(a.uhr.t + 1);
  const treffer = ohneSchwung(a.spuren);
  pruefe('mit HitEffect: Treffer-Ton sword-flesh am Ziel', treffer.length === 1 && treffer[0]!.gruppe === 'combat/sword-flesh' && treffer[0]!.pos?.x === 13, JSON.stringify(treffer));
}
{
  const a = aufbau();
  a.klick('schwert', 2);
  a.k.treffer({ x: 13, y: 1, z: 10 }, TREFFER_FLEISCH);
  a.uhr.bis(2);
  pruefe('Schwerthieb 3: sword-impact-flesh', ohneSchwung(a.spuren)[0]?.gruppe === 'combat/sword-impact-flesh', String(ohneSchwung(a.spuren)[0]?.gruppe));
}
{
  const a = aufbau('Spear');
  a.klick('speer', 0);
  a.k.treffer({ x: 13, y: 1, z: 10 }, TREFFER_FLEISCH);
  pruefe('Speer: sword-stab-flesh', a.spuren[0]?.gruppe === 'combat/sword-stab-flesh', String(a.spuren[0]?.gruppe));
}
{
  const a = aufbau('');
  a.klick('faust', 0);
  a.uhr.bis(2);
  a.spuren.length = 0;
  pruefe('Faust ohne Treffer: still', a.spuren.length === 0);
  a.klick('faust', 0);
  a.k.treffer({ x: 12.5, y: 1, z: 10 }, TREFFER_FLEISCH);
  pruefe('Faust + Treffer: punch', a.spuren.length === 1 && a.spuren[0]!.gruppe === 'combat/punch', String(a.spuren[0]?.gruppe));
  a.k.treffer({ x: 10.2, y: 1.2, z: 10 }, TREFFER_FLEISCH);
  pruefe('Biss auf die Figur nach Faustschlag: sword-flesh, nicht punch', a.spuren[1]?.gruppe === 'combat/sword-flesh', String(a.spuren[1]?.gruppe));
}
{
  const a = aufbau();
  a.klick('schwert', 2);
  a.uhr.bis(5);
  a.spuren.length = 0;
  a.k.treffer({ x: 13, y: 1, z: 10 }, TREFFER_FLEISCH);
  pruefe('Treffer 5 s nach dem Klick (fremd): schlichtes sword-flesh', a.spuren[0]?.gruppe === 'combat/sword-flesh', String(a.spuren[0]?.gruppe));
  a.k.treffer({ x: 30, y: 1, z: 10 }, TREFFER_FLEISCH);
  pruefe('Treffer eines Mitspielers 20 m entfernt: hörbar an seinem Ort', a.spuren[1]?.gruppe === 'combat/sword-flesh' && a.spuren[1]?.pos?.x === 30);
}

console.log('\n[4b] Der eigene Treffer klingt zum Hiebzeitpunkt:');
{
  const soll = [0.28, 0.4, 0.68];
  for (let hieb = 0; hieb < 3; hieb++) {
    const a = aufbau();
    a.uhr.t = 50;
    a.klick('schwert', hieb);
    a.uhr.bis(50.03); // Serverpaket kommt 30 ms nach dem Klick
    a.k.treffer({ x: 13, y: 1, z: 10 }, TREFFER_FLEISCH);
    const vorher = a.spuren.filter((x) => x.gruppe.includes('flesh')).length;
    a.uhr.bis(50 + soll[hieb]! - 0.01);
    const kurzVor = a.spuren.filter((x) => x.gruppe.includes('flesh')).length;
    a.uhr.bis(50 + soll[hieb]! + 0.01);
    const flesh = a.spuren.filter((x) => x.gruppe.includes('flesh'));
    pruefe(`Hieb ${hieb + 1}: Treffer nicht sofort (${vorher}), nicht 10 ms vor dem Hieb (${kurzVor}), dann genau einer`, vorher === 0 && kurzVor === 0 && flesh.length === 1, String(flesh.length));
    pruefe(`Hieb ${hieb + 1}: Treffer-Ton zeitgleich mit dem Schwung (${soll[hieb]} s)`, flesh.length === 1 && Math.abs(flesh[0]!.zeit - (50 + soll[hieb]!)) < 1e-6, String(flesh[0]?.zeit));
    pruefe(`Hieb ${hieb + 1}: an der Trefferstelle`, flesh[0]?.pos?.x === 13);
  }
  const a = aufbau();
  a.klick('schwert', 0);
  a.uhr.bis(0.5);
  a.k.treffer({ x: 13, y: 1, z: 10 }, TREFFER_FLEISCH);
  pruefe('Serverpaket NACH dem Hiebzeitpunkt: sofort', a.spuren.filter((x) => x.gruppe.includes('flesh')).length === 1 && a.spuren[a.spuren.length - 1]!.zeit === 0.5);
  const b = aufbau();
  b.k.treffer({ x: 13, y: 1, z: 10 }, TREFFER_FLEISCH);
  pruefe('fremder Treffer (kein eigener Klick): sofort', b.spuren.length === 1 && b.spuren[0]!.zeit === 0);
  const c = aufbau('');
  c.klick('faust', 0);
  c.k.treffer({ x: 12, y: 1, z: 10 }, TREFFER_FLEISCH);
  pruefe('Faust (Hiebzeit ungemessen): Treffer sofort', c.spuren.length === 1 && c.spuren[0]!.gruppe === 'combat/punch' && c.spuren[0]!.zeit === 0);
}

console.log('\n[5] Ernte (HitEffect art 0):');
{
  const cases: [string, string | null][] = [
    ['AxeFlint', 'combat/sword-wood'],
    ['PickaxeAntler', 'combat/sword-metal'],
    ['SwordNorth', null],
    ['', null],
  ];
  for (const [w, soll] of cases) {
    const a = aufbau(w);
    a.klick('schwert', 0);
    a.k.treffer({ x: 12, y: 1, z: 10 }, TREFFER_ERNTE);
    a.uhr.bis(2);
    const e = ohneSchwung(a.spuren)[0]?.gruppe ?? null;
    pruefe(`Ernte mit ${w || 'leerer Hand'}: ${soll ?? 'kein Ton'}`, e === soll, String(e));
  }
  const a = aufbau('AxeFlint');
  a.k.treffer({ x: 12, y: 1, z: 10 }, TREFFER_ERNTE);
  pruefe('Ernte ohne eigenen Klick (Mitspieler): kein Ton', a.spuren.length === 0);
}

console.log('\n[6] Parade (HitEffect art 2):');
{
  const cases: [string, string][] = [
    ['SwordNorth', 'combat/shield-metal'],
    ['Club', 'combat/shield-wood'],
    ['Staff', 'combat/shield-wood'],
  ];
  for (const [w, soll] of cases) {
    const a = aufbau(w);
    a.k.treffer({ x: 10, y: 1.1, z: 10 }, TREFFER_PARADE);
    pruefe(`eigene Parade mit ${w}: ${soll}`, a.spuren[0]?.gruppe === soll, String(a.spuren[0]?.gruppe));
  }
  const a = aufbau('Club');
  a.k.treffer({ x: 25, y: 1.1, z: 10 }, TREFFER_PARADE);
  pruefe('Parade eines Mitspielers: shield-metal an seinem Ort', a.spuren[0]?.gruppe === 'combat/shield-metal' && a.spuren[0]?.pos?.x === 25);
  const b = aufbau();
  b.k.treffer({ x: 10, y: 1, z: 10 }, 7);
  pruefe('unbekannte HitEffect-art: kein Ton', b.spuren.length === 0);
}

console.log('\n[7] Ton-Engine nicht bereit / keine Figur:');
{
  const uhr = new FalscheUhr();
  const k = new KampfToene(() => null, () => null, () => '', uhr);
  k.schlag('schwert', 0);
  uhr.bis(2);
  k.treffer({ x: 0, y: 0, z: 0 }, TREFFER_FLEISCH);
  pruefe('ohne Engine/Figur: kein Fehler', true);
}

console.log('\n[8] Gruppen im echten toene-Abschnitt (Bus world):');
{
  const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const manifest = JSON.parse(readFileSync(resolve(wurzel, 'assets/manifest.json'), 'utf-8')) as { toene?: Record<string, unknown> };
  const gruppen = groupByBus(readAudioManifest(manifest)).world;
  const soll: Record<string, number> = {
    'combat/slash': 3, 'combat/slash-heavy': 3, 'combat/sword-flesh': 3, 'combat/sword-impact-flesh': 3,
    'combat/sword-stab-flesh': 5, 'combat/punch': 3, 'combat/sword-wood': 4, 'combat/sword-metal': 4,
    'combat/shield-metal': 6, 'combat/shield-wood': 4,
  };
  pruefe('10 verwendete Gruppen', KAMPF_GRUPPEN.length === 10 && new Set(KAMPF_GRUPPEN).size === 10);
  for (const g of KAMPF_GRUPPEN) {
    const n = (gruppen.get(g) ?? []).length;
    pruefe(`Gruppe ${g}`, n === soll[g], `${n} Klips`);
  }
}

console.log('\n[9] Einbau in main.ts:');
{
  const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const q = readFileSync(resolve(wurzel, 'client/src/main.ts'), 'utf-8');
  const zeilen = q.split('\n').length;
  pruefe('Zeilenwächter: main.ts < 3700 Zeilen', zeilen < 3700, String(zeilen));
  pruefe('HitEffect-Handler ruft kampfToene.treffer', /PacketType\.HitEffect[\s\S]{0,400}?kampfToene\.treffer\(pos, art\)/.test(q));
  pruefe('Schlag ruft kampfToene.schlag mit letzterHieb', /schlage\(satz\)[\s\S]{0,200}?kampfToene\.schlag\(satz, player\.avatar\.letzterHieb/.test(q));
}

if (fehler > 0) {
  console.error(`\n${fehler} FEHLER`);
  process.exit(1);
}
console.log('\nALLE GRÜN');
