/**
 * Abgleich per Eingabesequenz — Ringpuffer, Verwerfen, Driftrechnung und
 * Rückfall. DOM-frei: `client/src/net/Positionsverlauf.ts` kennt weder
 * Babylon noch `window`, deshalb läuft dieser Test unter nacktem tsx.
 *
 * Geprüft wird genau das, was die Messung hinterher NICHT mehr sehen
 * kann: dass die Drift gegen den VERLAUFSPUNKT gerechnet wird und nicht
 * gegen die aktuelle Position. Im Browser sähe man beides als „Figur
 * bewegt sich" — hier steht der Unterschied als Zahl.
 *
 * Lauf: npx tsx client/test/positionsverlauf.ts   (aus dem Repo-Wurzel)
 */
import {
  Positionsverlauf,
  Abgleicher,
  ABGLEICH_STANDARD,
  type AbgleichRegeln,
} from '../src/net/Positionsverlauf';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}
const nahe = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

console.log('=== Positionsverlauf / Abgleicher ===');

// ── [1] Ringpuffer ────────────────────────────────────────────────
console.log('\n[1] Ringpuffer:');
{
  const v = new Positionsverlauf(4);
  for (let s = 1; s <= 6; s += 1) v.merke(s, s, 0, 0);
  pruefe('Kapazität wird gehalten', v.laenge === 4, `laenge ${v.laenge}`);
  pruefe('ältester Eintrag ist herausgefallen', v.hole(2) === null);
  pruefe('jüngster Eintrag ist da', v.hole(6)?.x === 6);
  pruefe('Eintrag in der Mitte ist da', v.hole(4)?.x === 4);
}

// ── [2] Verwerfen: seq selbst bleibt liegen ───────────────────────
console.log('\n[2] Verwerfen:');
{
  const v = new Positionsverlauf(64);
  for (let s = 1; s <= 10; s += 1) v.merke(s, s, 0, 0);
  v.verwirfAelterAls(7);
  pruefe('alles vor seq ist weg', v.hole(6) === null);
  pruefe('seq selbst bleibt (zweites PlayerState mit derselben seq)', v.hole(7)?.x === 7);
  pruefe('neuere bleiben', v.hole(10)?.x === 10 && v.laenge === 4, `laenge ${v.laenge}`);
  v.leere();
  pruefe('leere() vergisst alles', v.laenge === 0 && v.hole(10) === null);
}

// ── [3] Drift gegen den Verlaufspunkt, nicht gegen jetzt ──────────
console.log('\n[3] Driftrechnung:');
{
  /*
    Der Kern der Sache. Der Client läuft mit 7,5 m/s nach +x und schickt
    bei seq 1 (x = 0) los. Bis die Antwort da ist, steht er bei x = 3.
    Der Server meldet für seq 1 die Position x = 0,1 — also 10 cm neben
    dem, was der Client damals hatte.
      • gegen den Verlauf gerechnet: 0,1 m → unter jeder Schwelle, nichts.
      • gegen jetzt gerechnet: 2,9 m → der alte Abgleich hätte gezogen.
  */
  const a = new Abgleicher();
  a.merkeEingabe(1, { x: 0, y: 30, z: 0 });
  a.merkeEingabe(2, { x: 1.5, y: 30, z: 0 });
  a.merkeEingabe(3, { x: 3, y: 30, z: 0 });
  a.serverMeldung({ x: 0.1, y: 30, z: 0 }, 1, { x: 3, y: 30, z: 0 }, false);
  const d = a.diagnose;
  pruefe('Drift ist der Abstand zum Verlaufspunkt', nahe(d.letzteDrift, 0.1, 1e-6),
    `${d.letzteDrift.toFixed(3)} m`);
  pruefe('kein Nachziehen', d.ereignisse === 0 && a.schritt(1 / 60) === null);
  pruefe('kein Rückfall nötig', d.rueckfaelle === 0);
}

// ── [4] Echte Drift wird weich abgetragen ─────────────────────────
console.log('\n[4] Weiches Nachziehen:');
{
  const a = new Abgleicher();
  a.merkeEingabe(1, { x: 0, y: 30, z: 0 });
  // Server sagt: bei seq 1 standest du 2 m weiter — das ist echter
  // Auseinanderlauf, keine Latenz.
  a.serverMeldung({ x: 2, y: 30, z: 0 }, 1, { x: 5, y: 30, z: 0 }, false);
  pruefe('ein Nachzieh-Ereignis gezählt', a.diagnose.ereignisse === 1);
  const dt = 1 / 60;
  const f = 1 - Math.exp(-dt / ABGLEICH_STANDARD.tau);
  const b1 = a.schritt(dt);
  pruefe('erstes Bild schiebt den τ-Anteil des Versatzes',
    b1?.art === 'schieben' && nahe(b1.dx, 2 * f), `dx ${b1?.art === 'schieben' ? b1.dx : '—'}`);
  // Summe über viele Bilder: exakt der Versatz, kein Überschwingen.
  let summe = b1 && b1.art === 'schieben' ? b1.dx : 0;
  let bilder = 1;
  for (;;) {
    const b = a.schritt(dt);
    if (!b) break;
    if (b.art === 'schieben') summe += b.dx;
    bilder += 1;
    if (bilder > 10_000) break;
  }
  pruefe('Summe läuft gegen den Versatz und stoppt', summe > 1.98 && summe <= 2.0,
    `${summe.toFixed(4)} m in ${bilder} Bildern`);
  pruefe('danach ist Ruhe', a.schritt(dt) === null);
}

// ── [5] Frische Meldung unter der Schwelle bricht ab ──────────────
console.log('\n[5] Abbruch bei frischer Meldung:');
{
  const a = new Abgleicher();
  a.merkeEingabe(1, { x: 0, y: 30, z: 0 });
  a.serverMeldung({ x: 2, y: 30, z: 0 }, 1, { x: 2, y: 30, z: 0 }, false);
  a.schritt(1 / 60);
  a.merkeEingabe(2, { x: 0, y: 30, z: 0 });
  a.serverMeldung({ x: 0.05, y: 30, z: 0 }, 2, { x: 0, y: 30, z: 0 }, false);
  pruefe('laufendes Nachziehen endet', a.schritt(1 / 60) === null);
}

// ── [6] Harte Schwelle setzt auf die Serverposition ───────────────
console.log('\n[6] Hart:');
{
  const a = new Abgleicher();
  a.merkeEingabe(1, { x: 0, y: 30, z: 0 });
  a.serverMeldung({ x: 100, y: 40, z: 0 }, 1, { x: 3, y: 30, z: 0 }, false);
  const b = a.schritt(1 / 60);
  pruefe('setzt auf die Serverposition (nicht Versatz auf jetzt)',
    b?.art === 'setzen' && b.x === 100 && b.y === 40 && b.z === 0, JSON.stringify(b));
  pruefe('als hartes Ereignis gezählt', a.diagnose.hart === 1 && a.diagnose.ereignisse === 1);
  pruefe('danach ist Ruhe', a.schritt(1 / 60) === null);
  // Nach dem Setzen darf kein alter Bezugspunkt mehr ziehen: derselbe
  // seq 1 liefert jetzt einen Rückfall statt der alten Stelle.
  a.serverMeldung({ x: 100.2, y: 40, z: 0 }, 1, { x: 100, y: 40, z: 0 }, false);
  pruefe('Verlauf ist nach dem harten Setzen leer (Rückfall)', a.diagnose.rueckfaelle === 1);
}

// ── [6b] Hart greift auch, wenn nur der Verlauf harmlos aussieht ──
console.log('\n[6b] Selbstheilung nach einem Sprung des Clients:');
{
  /*
    Der Client springt aus eigener Kraft (Debug-Teleport, Kartensprung)
    100 m weit; der Server weiss davon nichts. Im Verlauf stehen lauter
    Punkte vom ALTEN Ort, die der Server korrekt bestätigt — die
    verlaufsbezogene Drift ist NULL. Ohne die zusätzliche Prüfung gegen
    die aktuelle Position bliebe der Client für immer 100 m neben der
    Serverwahrheit stehen.
  */
  const a = new Abgleicher();
  a.merkeEingabe(1, { x: 0, y: 30, z: 0 });
  a.serverMeldung({ x: 0, y: 30, z: 0 }, 1, { x: 100, y: 30, z: 0 }, false);
  pruefe('verlaufsbezogene Drift ist null', a.diagnose.letzteDrift === 0);
  const b = a.schritt(1 / 60);
  pruefe('trotzdem hart auf die Serverposition gesetzt',
    b?.art === 'setzen' && b.x === 0 && b.z === 0, JSON.stringify(b));
  pruefe('als hartes Ereignis gezählt', a.diagnose.hart === 1);
}

// ── [7] Rückfall auf das alte Verhalten ───────────────────────────
console.log('\n[7] Rückfall (seq nicht im Puffer):');
{
  const a = new Abgleicher();
  // Nichts gemerkt: es gibt keinen Bezugspunkt.
  a.serverMeldung({ x: 1.0, y: 30, z: 0 }, 42, { x: 0, y: 30, z: 0 }, false);
  pruefe('Drift gegen die aktuelle Position', nahe(a.diagnose.letzteDrift, 1.0, 1e-6));
  pruefe('Rückfall gezählt', a.diagnose.rueckfaelle === 1);
  pruefe('1,0 m bleibt unter der alten 1,5-m-Schwelle → nichts',
    a.diagnose.ereignisse === 0 && a.schritt(1 / 60) === null);

  const b = new Abgleicher();
  b.serverMeldung({ x: 2.0, y: 30, z: 0 }, -1, { x: 0, y: 30, z: 0 }, false);
  pruefe('seq −1 (Server ohne Feld) ist ebenfalls Rückfall', b.diagnose.rueckfaelle === 1);
  pruefe('über 1,5 m zieht der Rückfall wie bisher', b.diagnose.ereignisse === 1);
}

// ── [8] Dungeon: y bleibt beim Client ─────────────────────────────
console.log('\n[8] Dungeon:');
{
  const a = new Abgleicher();
  a.merkeEingabe(1, { x: 0, y: 10, z: 0 });
  // 5 m Höhenunterschied, 0 m in der Ebene: im Dungeon kein Ereignis.
  a.serverMeldung({ x: 0, y: 15, z: 0 }, 1, { x: 0, y: 10, z: 0 }, true);
  pruefe('y wird ignoriert', a.diagnose.letzteDrift === 0 && a.diagnose.ereignisse === 0);

  const b = new Abgleicher();
  b.merkeEingabe(1, { x: 0, y: 10, z: 0 });
  b.serverMeldung({ x: 50, y: 15, z: 0 }, 1, { x: 0, y: 10, z: 0 }, true);
  const befehl = b.schritt(1 / 60);
  pruefe('hartes Setzen lässt y im Dungeon offen',
    befehl?.art === 'setzen' && befehl.y === null, JSON.stringify(befehl));
}

// ── [9] Eigene Regeln (die Schwelle ist eine Zahl, kein Literal) ──
console.log('\n[9] Regeln einstellbar:');
{
  const streng: AbgleichRegeln = { weich: 0.2, weichRueckfall: 1.5, hart: 8, tau: 0.4 };
  const a = new Abgleicher(streng);
  a.merkeEingabe(1, { x: 0, y: 0, z: 0 });
  a.serverMeldung({ x: 0.3, y: 0, z: 0 }, 1, { x: 0, y: 0, z: 0 }, false);
  pruefe('0,3 m löst bei 0,2-m-Schwelle aus', a.diagnose.ereignisse === 1);

  const b = new Abgleicher();
  b.merkeEingabe(1, { x: 0, y: 0, z: 0 });
  b.serverMeldung({ x: 0.3, y: 0, z: 0 }, 1, { x: 0, y: 0, z: 0 }, false);
  pruefe('dieselbe Drift lässt die Standardschwelle kalt', b.diagnose.ereignisse === 0);

  /*
    Die GEMESSENE Bandbreite des Auseinanderlaufs im Gehen auf freiem
    Feld (0,3 bis 0,6 m, Herleitung im Kopf von ABGLEICH_STANDARD) muss
    unter der Schwelle bleiben — sonst zieht der Abgleich dauernd gegen
    etwas, wogegen Ziehen nicht hilft. Die beiden Zeilen halten die Zahl
    fest, damit ein spaeteres Absenken auffaellt statt still 30 Eingriffe
    je Minute zurueckzubringen.
  */
  const c = new Abgleicher();
  c.merkeEingabe(1, { x: 0, y: 0, z: 0 });
  c.serverMeldung({ x: 0.6, y: 0, z: 0 }, 1, { x: 0, y: 0, z: 0 }, false);
  pruefe('0,6 m — oberer Rand des Messrauschens — löst nicht aus',
    c.diagnose.ereignisse === 0, `Schwelle ${ABGLEICH_STANDARD.weich} m`);
  const e = new Abgleicher();
  e.merkeEingabe(1, { x: 0, y: 0, z: 0 });
  e.serverMeldung({ x: 1.2, y: 0, z: 0 }, 1, { x: 0, y: 0, z: 0 }, false);
  pruefe('1,2 m — echter Auseinanderlauf — löst aus', e.diagnose.ereignisse === 1);
}

// ── [10] Zähler zurücksetzen (Messabschnitte) ────────────────────
console.log('\n[10] Zähler:');
{
  const a = new Abgleicher();
  a.merkeEingabe(1, { x: 0, y: 0, z: 0 });
  a.serverMeldung({ x: 3, y: 0, z: 0 }, 1, { x: 0, y: 0, z: 0 }, false);
  pruefe('vor dem Zurücksetzen gezählt', a.diagnose.ereignisse === 1 && a.diagnose.meldungen === 1);
  a.zaehlerZuruecksetzen();
  pruefe('danach bei null', a.diagnose.ereignisse === 0 && a.diagnose.meldungen === 0);
  pruefe('das laufende Nachziehen bleibt davon unberührt', a.schritt(1 / 60)?.art === 'schieben');
}

if (fehler > 0) {
  console.error(`\n=== Positionsverlauf: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== Positionsverlauf: ALLE GRÜN ===');
