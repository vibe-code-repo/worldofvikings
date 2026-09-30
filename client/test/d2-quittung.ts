/**
 * D2 (client): the swing carries its combo step and tip time, the server's `AttackAck` is read, the
 * figure's chain restarts when the server counted differently, and the round trip is booked.
 * Pure: a stand-in socket and figure, a fake clock; no Babylon renderer.
 *
 * Run: npx tsx client/test/d2-quittung.ts   (from the repo root)
 */
import { PacketType } from '@wov/shared';
import { SchlagBuch, ERGEBNIS_KOMBO, ERGEBNIS_TREFFER, SERVER_KETTE_S, komboRestS } from '../src/net/Quittung';
import { KETTE_FENSTER_S, abklingzeitMs, neuerSchlagZustand, pruefeSchlag, verbucheSchlag } from '../../server/src/spiel/Treffer';
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
  // N1-4: an answer that arrives after the next swing still corrects the chain it belongs to.
  const sp = new SchlagBuch();
  sp.neu(0, 1);
  sp.neu(400, 2);
  sp.neu(800, 3);
  const spaet = sp.quittiere({ seq: 2, schritt: 1, ergebnis: ERGEBNIS_TREFFER }, 900);
  check('verspaetete Quittung (Schritt 1 statt 2) nach dem naechsten Schlag derselben Kette: Kette neu', spaet?.kettenNeu === true, JSON.stringify(spaet));
  const sp2 = new SchlagBuch();
  sp2.neu(0, 3);
  sp2.neu(400, 1);
  sp2.neu(800, 2);
  const spaet2 = sp2.quittiere({ seq: 1, schritt: 0, ergebnis: ERGEBNIS_KOMBO }, 900);
  check('verspaetete Verweigerung eines Schlags VOR dem letzten Neubeginn der Figur: Kette bleibt', spaet2?.kettenNeu === false, JSON.stringify(spaet2));
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

console.log('[3] Kettenfenster der Figur nie laenger als das des Servers (F4):');
{
  const serverMs = abklingzeitMs('') + KETTE_FENSTER_S * 1000;
  check('SERVER_KETTE_S = 0,80 s', SERVER_KETTE_S === 0.8, `${SERVER_KETTE_S} s`);
  check(`SERVER_KETTE_S laesst mindestens 120 ms Reserve zum Server (${serverMs} ms)`, SERVER_KETTE_S * 1000 <= serverMs - 120);
  // Gemessene Clips (WikingerKoerper.glb/WikingerinKoerper.glb): Laenge s, Tempo wie AvatarRig.hiebDauer, Ausstieg 0,25, Fenster 0,6.
  const clips: Array<[string, number, number]> = [
    ['angriff', 3.042, 2.5], ['angriff2', 3.042, 2.5], ['angriff3', 3.125, 2.5],
    ['faust', 1.958, 2], ['faust2', 2.167, 2], ['faust3', 1.917, 1.5],
    ['stab_angriff', 3.042, 2.5], ['stab_angriff2', 3.042, 2.5], ['stab_angriff3', 1.792, 1.5],
  ];
  for (const [name, laenge, tempo] of clips) {
    const eigen = Math.max(0.5, laenge / tempo) - 0.25 + 0.6;
    const fenster = komboRestS(Math.max(0.5, laenge / tempo) - 0.25, 0.6);
    check(`${name}: eigenes Fenster ${eigen.toFixed(3)} s, gedeckelt ${fenster.toFixed(3)} s`, eigen > SERVER_KETTE_S && fenster === SERVER_KETTE_S);
  }
  check('ein kurzer Schlag (Rest 0,1 s) behaelt sein kuerzeres Fenster (0,7 s)', Math.abs(komboRestS(0.1, 0.6) - 0.7) < 1e-9);
}

console.log('\n[4] Kettenreserve (N1-3): Klick-zu-Klick der Figur gegen Ankunft-zu-Ankunft des Servers, echte pruefeSchlag:');
{
  // Deterministic generator (mulberry32); every run gives the same numbers.
  const zufall = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /**
   * `versuche` fresh chains of three swings, `abstandMs` apart (click to click). The figure claims the next step while its
   * window (`deckelS`, from swing start) is open; a finisher is only claimed then. Each swing reaches the server after
   * latency +- jitter (uniform, in order like a TCP stream). Loss = a finisher the figure played (step 3) that the
   * server did not count as step 3: before N2 the server refused it (whole swing, damage included). Each chain starts
   * fresh, so one loss does not drag the next one along (the figure restarts its chain on the acknowledgement).
   */
  function simuliere(deckelS: number, latenzMs: number, jitterMs: number, abstandMs: number, versuche: number, seed: number) {
    const r = zufall(seed);
    const folgt = abstandMs <= deckelS * 1000;
    let verlust = 0;
    let endschlaege = 0;
    for (let v = 0; v < versuche; v++) {
      const z = neuerSchlagZustand();
      let letzteAnkunft = -1e9;
      for (let i = 0; i < 3; i++) {
        const figur = folgt ? i + 1 : 1;
        const ankunft = Math.max(i * abstandMs + latenzMs + (r() * 2 - 1) * jitterMs, letzteAnkunft + 1);
        letzteAnkunft = ankunft;
        const e = pruefeSchlag(z, { seq: i + 1, schritt: figur, alterMs: 0, spitzeMs: 400 }, ankunft, '');
        if (!e.ok) break; // cooldown: not a chain matter (the intervals below stay clear of it)
        if (figur === 3) {
          endschlaege++;
          if (e.schritt !== 3) verlust++;
        }
        verbucheSchlag(z, ankunft, e.schritt, '');
      }
    }
    return { verlust, endschlaege, quote: endschlaege ? verlust / endschlaege : 0 };
  }
  /** Worst loss rate over the click intervals `ab`..1000 ms (step 5). */
  const tabelle = (deckelS: number, latenz: number, jitter: number, ab = 450): number => {
    let schlechtest = 0;
    for (let d = ab; d <= 1000; d += 5) schlechtest = Math.max(schlechtest, simuliere(deckelS, latenz, jitter, d, 2000, d * 31 + latenz).quote);
    return schlechtest;
  };
  for (const lat of [40, 150, 300]) {
    const alt = tabelle(0.95, lat, 40);
    const neu = tabelle(SERVER_KETTE_S, lat, 40);
    console.log(`      Latenz ${lat} +-40 ms, schlechtester Klickabstand 450..1000 ms: Endschlag-Verlust Deckel 0,95 s = ${(alt * 100).toFixed(1)} %, Deckel ${SERVER_KETTE_S} s = ${(neu * 100).toFixed(1)} %`);
    check(`Latenz ${lat} +-40 ms: Verlustquote mit dem Deckel ${SERVER_KETTE_S} s hoechstens 1 %`, neu <= 0.01, `${(neu * 100).toFixed(2)} %`);
    check(`Latenz ${lat} +-40 ms: der alte Deckel 0,95 s verlor mehr als 1 % (Probe ist empfindlich)`, alt > 0.01, `${(alt * 100).toFixed(2)} %`);
  }
  const breit = tabelle(SERVER_KETTE_S, 300, 100, 600);
  console.log(`      Latenz 300 +-100 ms, Klickabstand ab 600 ms (zum Vergleich): Deckel ${SERVER_KETTE_S} s = ${(breit * 100).toFixed(1)} %, Deckel 0,95 s = ${(tabelle(0.95, 300, 100, 600) * 100).toFixed(1)} %`);
  // The serverside half: a finisher claimed after the chain ran out counts as step 1, not as refused.
  const z = neuerSchlagZustand();
  verbucheSchlag(z, 1000, 1, '');
  const rand = pruefeSchlag(z, { seq: 2, schritt: 3, alterMs: 0, spitzeMs: 400 }, 1000 + 950 + 1, '');
  check('Endschlag 1 ms nach dem Kettenfenster: zaehlt, als Schritt 1', rand.ok && rand.schritt === 1, JSON.stringify(rand));
}

console.log(fehler === 0 ? '\nD2 Quittung (Client): alles gruen' : `\nD2 Quittung (Client): ${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
