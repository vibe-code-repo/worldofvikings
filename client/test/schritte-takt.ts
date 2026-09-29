/**
 * Schritttakt (client/src/engine/Audio/Schritte.ts): Meter statt Zeit.
 *
 * Gehen 11 m -> 10 Schritte (+-1), Rennen 15 m -> 10 (+-1), Stand 5 s -> 0,
 * Sprung -> 0 in der Luftphase, nie zwei Schritte naeher als 0,18 s,
 * Richtungswechsel auf der Stelle -> kein Schritt. Pure, kein Babylon, keine
 * Audio-API. Simuliert wird mit den echten Figurgeschwindigkeiten
 * (Gehen 4,5 m/s, Rennen 7,5 m/s) bei 60 Bildern je Sekunde.
 *
 * Lauf: npx tsx client/test/schritte-takt.ts   (aus dem Repo-Wurzel)
 */
import { SchrittTakt, SCHRITT_MIN_ABSTAND_S, SCHRITT_WEITE, type Gangart } from '../src/engine/Audio/Schritte';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

const DT = 1 / 60;

interface Lauf {
  zeiten: number[];
  strecke: number;
}

/** Laeuft `meter` geradeaus mit `tempo` m/s; liefert die Zeitpunkte der Schritte. */
function laufe(takt: SchrittTakt, gangart: Gangart, tempo: number, meter: number, start = { x: 0, z: 0, t: 0 }): Lauf & { ende: { x: number; z: number; t: number } } {
  const zeiten: number[] = [];
  let x = start.x;
  let t = start.t;
  const z = start.z;
  const ziel = start.x + meter;
  takt.update({ x, y: 0, z, zeit: t, bodenkontakt: true, gangart });
  while (x < ziel - 1e-9) {
    x = Math.min(ziel, x + tempo * DT);
    t += DT;
    if (takt.update({ x, y: 0, z, zeit: t, bodenkontakt: true, gangart })) zeiten.push(t);
  }
  return { zeiten, strecke: meter, ende: { x, z, t } };
}

function minAbstand(zeiten: number[]): number {
  let m = Infinity;
  for (let i = 1; i < zeiten.length; i++) m = Math.min(m, zeiten[i] - zeiten[i - 1]);
  return m;
}

console.log('=== Schritttakt ===');

console.log('\n[1] Gehen und Rennen:');
{
  const g = laufe(new SchrittTakt(), 'gehen', 4.5, 11);
  pruefe('Gehen 11 m -> 10 Schritte (+-1)', Math.abs(g.zeiten.length - 10) <= 1, String(g.zeiten.length));
  const r = laufe(new SchrittTakt(), 'rennen', 7.5, 15);
  pruefe('Rennen 15 m -> 10 Schritte (+-1)', Math.abs(r.zeiten.length - 10) <= 1, String(r.zeiten.length));
  pruefe('Gehen: nie zwei Schritte naeher als 0,18 s', minAbstand(g.zeiten) >= SCHRITT_MIN_ABSTAND_S - 1e-9, minAbstand(g.zeiten).toFixed(3));
  pruefe('Rennen: nie zwei Schritte naeher als 0,18 s', minAbstand(r.zeiten) >= SCHRITT_MIN_ABSTAND_S - 1e-9, minAbstand(r.zeiten).toFixed(3));
  const lang = laufe(new SchrittTakt(), 'gehen', 4.5, 110);
  pruefe('Gehen 110 m -> 100 Schritte (+-2), kein Auseinanderlaufen', Math.abs(lang.zeiten.length - 100) <= 2, String(lang.zeiten.length));
  pruefe('Schrittweiten sind die der Karte (1,1 / 1,5 m)', SCHRITT_WEITE.gehen === 1.1 && SCHRITT_WEITE.rennen === 1.5);
}

console.log('\n[2] Stand und Richtungswechsel:');
{
  const takt = new SchrittTakt();
  let n = 0;
  for (let i = 0; i <= 300; i++) if (takt.update({ x: 10, y: 0, z: 10, zeit: i * DT, bodenkontakt: true, gangart: 'gehen' })) n++;
  pruefe('Stand 5 s -> 0 Schritte', n === 0, String(n));
  // Auf der Stelle drehen: Position bleibt, nur die Gangart wechselt hin und her.
  let m = 0;
  for (let i = 0; i <= 300; i++) {
    if (takt.update({ x: 10, y: 0, z: 10, zeit: 5 + i * DT, bodenkontakt: true, gangart: i % 2 ? 'rennen' : 'gehen' })) m++;
  }
  pruefe('Richtungswechsel auf der Stelle (5 s) -> 0 Schritte', m === 0, String(m));
  // Zittern um 1 cm (Physik-Rauschen) zaehlt ebenfalls nicht als Gehen: 5 s * 60 * 0,02 m = 6 m Weg waeren 5 Schritte.
  let k = 0;
  for (let i = 0; i <= 300; i++) {
    const x = 10 + (i % 2 ? 0.0001 : 0);
    if (takt.update({ x, y: 0, z: 10, zeit: 10 + i * DT, bodenkontakt: true, gangart: 'gehen' })) k++;
  }
  pruefe('Mikrozittern um 0,1 mm (5 s) -> 0 Schritte', k === 0, String(k));
}

console.log('\n[3] Sprung und Fall:');
{
  const takt = new SchrittTakt();
  const a = laufe(takt, 'gehen', 4.5, 3.3);
  // Sprung: 0,6 s Luft, dabei 2,7 m weiter.
  let inLuft = 0;
  let t = a.ende.t;
  let x = a.ende.x;
  for (let i = 0; i < 36; i++) {
    x += 4.5 * DT;
    t += DT;
    if (takt.update({ x, y: 1, z: 0, zeit: t, bodenkontakt: false, gangart: 'gehen' })) inLuft++;
  }
  pruefe('Sprung: 0 Schritte waehrend der Luftphase', inLuft === 0, String(inLuft));
  // Landung: 3,3 m weiterlaufen. Zaehlt nur der Boden (3,3 + 3,3 = 6,6 m -> 6 Schritte +-1), sind es insgesamt 6 und nicht 8-9,
  // wie es waere, wenn die 2,7 m der Luftphase nachgeholt wuerden.
  let nachLandung = 0;
  for (let i = 0; i < 49; i++) {
    x += 4.5 * DT;
    t += DT;
    if (takt.update({ x, y: 0, z: 0, zeit: t, bodenkontakt: true, gangart: 'gehen' })) nachLandung++;
  }
  const gesamt = a.zeiten.length + nachLandung;
  pruefe('Luftstrecke wird nicht nachgeholt: Boden 6,6 m -> 6 Schritte (+-1)', Math.abs(gesamt - 6) <= 1, `vor ${a.zeiten.length} + nach ${nachLandung} = ${gesamt}`);
  // Freier Fall von 6 s: nichts.
  let fall = 0;
  for (let i = 0; i < 360; i++) if (takt.update({ x, y: 50 - i, z: 0, zeit: t + i * DT, bodenkontakt: false, gangart: 'gehen' })) fall++;
  pruefe('Fall 6 s -> 0 Schritte', fall === 0, String(fall));
}

console.log('\n[4] Teleport und lange Bilder:');
{
  const takt = new SchrittTakt();
  laufe(takt, 'gehen', 4.5, 2);
  const s = takt.update({ x: 5000, y: 0, z: 5000, zeit: 100, bodenkontakt: true, gangart: 'gehen' });
  pruefe('Teleport 7 km -> kein Schritt', s === null);
  // Ein einziges langes Bild (0,5 s, 2,25 m = zwei Schrittweiten): hoechstens ein Schritt, der Rest bleibt gutgeschrieben.
  const t2 = new SchrittTakt();
  t2.update({ x: 0, y: 0, z: 0, zeit: 0, bodenkontakt: true, gangart: 'gehen' });
  const erst = t2.update({ x: 2.25, y: 0, z: 0, zeit: 0.5, bodenkontakt: true, gangart: 'gehen' });
  pruefe('langes Bild: hoechstens ein Schritt je Update', erst !== null);
  // Zu frueh (unter 0,18 s): die Strecke wird zurueckgehalten, der Schritt kommt danach.
  const t3 = new SchrittTakt();
  t3.update({ x: 0, y: 0, z: 0, zeit: 0, bodenkontakt: true, gangart: 'rennen' });
  const a = t3.update({ x: 1.6, y: 0, z: 0, zeit: 0.2, bodenkontakt: true, gangart: 'rennen' });
  const b = t3.update({ x: 3.4, y: 0, z: 0, zeit: 0.25, bodenkontakt: true, gangart: 'rennen' });
  const c = t3.update({ x: 3.5, y: 0, z: 0, zeit: 0.4, bodenkontakt: true, gangart: 'rennen' });
  pruefe('Mindestabstand: zweiter Schritt bei 0,25 s (0,05 s nach dem ersten) wird zurueckgehalten', a !== null && b === null, `a=${a !== null} b=${b !== null}`);
  pruefe('… und kommt, sobald 0,18 s vergangen sind', c !== null);
}

if (fehler > 0) {
  console.error(`\n${fehler} FEHLER`);
  process.exit(1);
}
console.log('\nALLE GRÜN');
