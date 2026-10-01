/**
 * D2 (client): the swing carries its combo step and tip time, the server's `AttackAck` is read, the
 * figure's chain restarts when the server counted differently, and the round trip is booked.
 * Pure: a stand-in socket and figure, a fake clock; no Babylon renderer.
 *
 * Run: npx tsx client/test/d2-quittung.ts   (from the repo root)
 */
import { PacketType } from '@wov/shared';
import { SchlagBuch, ERGEBNIS_KOMBO, ERGEBNIS_TREFFER, SERVER_KETTE_S, komboRestS } from '../src/net/Quittung';
import { KETTE_FENSTER_S, SchlagErgebnis, abklingzeitMs, neuerSchlagZustand, pruefeSchlag, verbucheSchlag } from '../../server/src/spiel/Treffer';
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
  // N2-3: a refusal (cooldown, stamp, stamina: step 0) is not a chain matter; the figure's chain stays.
  for (const [name, ergebnis] of [['Abklingzeit', SchlagErgebnis.Abklingzeit], ['Zeit', SchlagErgebnis.Zeit], ['Ausdauer', SchlagErgebnis.Ausdauer]] as const) {
    for (const gespielt of [1, 2, 3]) {
      const v = new SchlagBuch();
      v.neu(0, gespielt);
      const a = v.quittiere({ seq: 1, schritt: 0, ergebnis }, 40);
      check(`Verweigerung (${name}, schritt 0) bei gespieltem Schritt ${gespielt} setzt die Kette der Figur NICHT zurueck`, a?.kettenNeu === false, JSON.stringify(a));
    }
  }
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
  check(`SERVER_KETTE_S = Abklingzeit + Kettenfenster des Servers (${serverMs} ms)`, Math.round(SERVER_KETTE_S * 1000) === serverMs, `${SERVER_KETTE_S} s`);
  // Figure and server agree on every click gap when nothing is delayed: the figure follows the chain exactly when the server would.
  let abweichung = 0;
  for (let gap = 400; gap <= 1400; gap += 5) {
    const z = neuerSchlagZustand();
    verbucheSchlag(z, 1000, 1, '');
    const e = pruefeSchlag(z, { seq: 2, schritt: 0, alterMs: 0, spitzeMs: 400 }, 1000 + gap, '');
    const serverFolgt = e.ok && e.schritt === 2;
    const figurFolgt = gap <= SERVER_KETTE_S * 1000;
    if (e.ok && serverFolgt !== figurFolgt) abweichung++;
  }
  check('ohne Verzoegerung zaehlen Figur und Server bei jedem Klickabstand 400..1400 ms gleich (kein Abstand, bei dem sie auseinanderlaufen)', abweichung === 0, `${abweichung} abweichende Abstaende`);
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

console.log('\n[4] Figur gegen Server bei Latenz und Jitter (N2-1/N2-2): Sprungquote der Figur, Kettenabbruch durch die Quittung, Abklingzeit-Verlust:');
{
  // Deterministic generator (mulberry32); every run gives the same numbers.
  const zufall = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  interface Lauf {
    klicks: number;
    /** The figure played step 1 because its own window (the cap) was over: its jump rate. */
    sprung: number;
    /** The figure restarted its chain although its window was open: the server counted lower, the acknowledgement corrected it. */
    abbruch: number;
    /** Swings the server refused (cooldown), damage lost entirely. */
    verweigert: number;
    /** Swings the server counted with a lower step than the figure played (a finisher counted as step 1; same damage, no loss). */
    niedriger: number;
  }
  /**
   * An honest player clicks `trials` x `laenge` times; gap click to click: triangular around `mittelS` (standard deviation
   * `sigmaS`, at least 0.5 s). Each swing reaches the server after latency +- jitter (uniform, in order), the acknowledgement
   * comes back after the latency. The figure follows the cap `deckelS` (from swing start) and the real `SchlagBuch`; the
   * server is the real `pruefeSchlag`/`verbucheSchlag`.
   */
  function spiel(deckelS: number, latenzMs: number, jitterMs: number, mittelS: number, sigmaS: number, trials: number, seed: number, minS = 0.5): Lauf {
    const r = zufall(seed);
    const halb = sigmaS * Math.sqrt(6);
    const lauf: Lauf = { klicks: 0, sprung: 0, abbruch: 0, verweigert: 0, niedriger: 0 };
    for (let v = 0; v < trials; v++) {
      const buch = new SchlagBuch();
      const z = neuerSchlagZustand();
      const offen: Array<{ seq: number; ack: number; schritt: number; ergebnis: number }> = [];
      let klick = 0;
      let ankunft = -1e9;
      let figur = 0;
      let neu = false;
      for (let i = 0; i < 30; i++) {
        const gap = Math.max(minS, mittelS + halb * (r() + r() - 1));
        klick += i === 0 ? 0 : gap * 1000;
        // acknowledgements that arrived before this click
        offen.sort((a, b) => a.ack - b.ack);
        while (offen.length && offen[0].ack <= klick) {
          const o = offen.shift()!;
          const q = buch.quittiere({ seq: o.seq, schritt: o.schritt, ergebnis: o.ergebnis }, o.ack);
          if (q?.kettenNeu) neu = true;
        }
        const offenesFenster = i > 0 && gap <= deckelS;
        if (i > 0 && !offenesFenster) lauf.sprung++;
        if (!offenesFenster || figur === 0) figur = 1;
        else if (neu) {
          // After step 3 the chain starts again anyway: that is no abort.
          if (figur !== 3) lauf.abbruch++;
          figur = 1;
        } else figur = (figur % 3) + 1;
        neu = false;
        const seq = buch.neu(klick, figur);
        ankunft = Math.max(klick + latenzMs + (r() * 2 - 1) * jitterMs, ankunft + 1);
        const e = pruefeSchlag(z, { seq, schritt: figur, alterMs: 0, spitzeMs: 400 }, ankunft, '');
        lauf.klicks++;
        if (e.ok) {
          verbucheSchlag(z, ankunft, e.schritt, '');
          if (e.schritt < figur) lauf.niedriger++;
          offen.push({ seq, ack: ankunft + latenzMs, schritt: e.schritt, ergebnis: ERGEBNIS_TREFFER });
        } else {
          lauf.verweigert++;
          offen.push({ seq, ack: ankunft + latenzMs, schritt: 0, ergebnis: e.ergebnis });
        }
      }
    }
    return lauf;
  }
  const pro = (n: number, m: number): string => `${((n / m) * 100).toFixed(2)} %`;
  const TRIALS = 4000;
  // Klickabstand 0,75 s +- 0,08 s: the combo rhythm of a player who keeps the chain (the window is 0.95 s).
  for (const lat of [40, 150, 300]) {
    const jitter = lat === 40 ? 40 : 100;
    const l = spiel(SERVER_KETTE_S, lat, jitter, 0.75, 0.08, TRIALS, 7 + lat);
    const alt = spiel(0.8, lat, jitter, 0.75, 0.08, TRIALS, 7 + lat);
    console.log(
      `      Latenz ${lat} +-${jitter} ms, Klick 0,75 +-0,08 s: Deckel ${SERVER_KETTE_S} s: Figur-Sprung ${pro(l.sprung, l.klicks)}, Kettenabbruch durch Quittung ${pro(l.abbruch, l.klicks)}, ` +
        `Verlust durch Abklingzeit ${pro(l.verweigert, l.klicks)}, Server zaehlt niedriger (kein Schadensverlust) ${pro(l.niedriger, l.klicks)}; Deckel 0,80 s: Figur-Sprung ${pro(alt.sprung, alt.klicks)}`
    );
    check(`Latenz ${lat} +-${jitter} ms: Sprungquote der Figur mit dem Deckel ${SERVER_KETTE_S} s hoechstens 1 %`, l.sprung / l.klicks <= 0.01, pro(l.sprung, l.klicks));
    check(`Latenz ${lat} +-${jitter} ms: der Deckel 0,80 s sprang in mehr als 10 % der Klicks (Probe ist empfindlich)`, alt.sprung / alt.klicks > 0.1, pro(alt.sprung, alt.klicks));
    // Measured 0.19 / 1.32 / 1.15 %; the margin is small so that a fallback to the cap 0.80 s turns this red, too.
    const abbruchMax = lat === 40 ? 0.01 : 0.025;
    check(`Latenz ${lat} +-${jitter} ms: sichtbarer Kettenabbruch durch die Quittung hoechstens ${abbruchMax * 100} % der Klicks`, l.abbruch / l.klicks <= abbruchMax, pro(l.abbruch, l.klicks));
    check(`Latenz ${lat} +-${jitter} ms: Verlust durch die Abklingzeit hoechstens 1 % der Schlaege`, l.verweigert / l.klicks <= 0.01, pro(l.verweigert, l.klicks));
    // Measured 2.00 / 10.92 / 11.00 %; with the cap 0.80 s it is 15.19 % at 40 ms.
    const niedrigerMax = lat === 40 ? 0.04 : 0.14;
    check(`Latenz ${lat} +-${jitter} ms: Server zaehlt niedriger (kein Schadensverlust) hoechstens ${niedrigerMax * 100} % der Schlaege`, l.niedriger / l.klicks <= niedrigerMax, pro(l.niedriger, l.klicks));
  }
  // The fastest click the client allows (ANGRIFF_TAKT 0,5 s): 0,55 +- 0,08 s, at least 0,5 s. Reported only: what the cooldown refuses.
  for (const lat of [40, 150, 300]) {
    const jitter = lat === 40 ? 40 : 100;
    const l = spiel(SERVER_KETTE_S, lat, jitter, 0.55, 0.08, TRIALS, 11 + lat, 0.5);
    console.log(`      Latenz ${lat} +-${jitter} ms, schnellster Klick 0,55 +-0,08 s (mind. 0,5 s): Verlust durch Abklingzeit ${pro(l.verweigert, l.klicks)}, Server zaehlt niedriger ${pro(l.niedriger, l.klicks)}, Figur-Sprung ${pro(l.sprung, l.klicks)}`);
  }
}

console.log(fehler === 0 ? '\nD2 Quittung (Client): alles gruen' : `\nD2 Quittung (Client): ${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
