/**
 * Test für Fehlersammler (F16, ui/Fehlermeldungen.ts). DOM-frei, ruft
 * ausschliesslich die echte Klasse — kein Nachbau der Dedupe-/Deckel-
 * /Ablauf-Logik (s. Testregel im Kopfkommentar von run-tests.mjs).
 */
import { Fehlersammler, FEHLER_TTL_MS, FEHLER_MAX_GLEICHZEITIG } from '../src/ui/Fehlermeldungen';

let fehlgeschlagen = 0;
function pruefe(name: string, bedingung: boolean): void {
  if (bedingung) {
    console.log(`  OK  ${name}`);
  } else {
    fehlgeschlagen++;
    console.log(`FEHLER  ${name}`);
  }
}

// 1) Gleiche Meldung (Text + Schweregrad) zählt hoch statt zu stapeln.
{
  const s = new Fehlersammler();
  const t0 = 1000;
  s.melden('Asset X fehlt', 'hinweis', t0);
  s.melden('Asset X fehlt', 'hinweis', t0 + 10);
  s.melden('Asset X fehlt', 'hinweis', t0 + 20);
  const aktiv = s.aktive();
  pruefe('gleiche Meldung erzeugt genau einen Eintrag', aktiv.length === 1);
  pruefe('Eintrag zählt auf 3', aktiv[0]?.anzahl === 3);
  pruefe('Text/Schweregrad bleiben erhalten', aktiv[0]?.text === 'Asset X fehlt' && aktiv[0]?.schweregrad === 'hinweis');
}

// 2) Unterschiedlicher Schweregrad bei gleichem Text bleibt getrennt.
{
  const s = new Fehlersammler();
  s.melden('Verbindung gestört', 'warnung', 0);
  s.melden('Verbindung gestört', 'schwer', 0);
  pruefe('gleicher Text, verschiedener Schweregrad -> zwei Einträge', s.aktive().length === 2);
}

// 3) Deckel: mehr als FEHLER_MAX_GLEICHZEITIG verschiedene Meldungen.
{
  const s = new Fehlersammler();
  for (let i = 0; i < FEHLER_MAX_GLEICHZEITIG + 2; i++) {
    s.melden(`Fehler ${i}`, 'warnung', 1000 + i);
  }
  pruefe(
    `Deckel hält Anzahl bei ${FEHLER_MAX_GLEICHZEITIG}`,
    s.aktive().length === FEHLER_MAX_GLEICHZEITIG,
  );
  // Die kürzeste Restlebenszeit (kleinste ablauf-Zeit, hier: die zuerst
  // gemeldete) muss weichen — 'Fehler 0' darf nicht mehr da sein.
  pruefe(
    'verdrängter Eintrag ist der mit der kürzesten Restlebenszeit',
    !s.aktive().some((e) => e.text === 'Fehler 0'),
  );
  pruefe(
    'die zuletzt gemeldeten Einträge überleben',
    s.aktive().some((e) => e.text === `Fehler ${FEHLER_MAX_GLEICHZEITIG + 1}`),
  );
}

// 4) tick() entfernt abgelaufene Einträge, lässt frische stehen.
{
  const s = new Fehlersammler();
  const t0 = 5000;
  s.melden('Alt', 'hinweis', t0);
  s.tick(t0 + FEHLER_TTL_MS + 1);
  pruefe('abgelaufener Eintrag verschwindet nach tick()', s.aktive().length === 0);

  s.melden('Neu', 'hinweis', t0);
  s.tick(t0 + FEHLER_TTL_MS - 1);
  pruefe('noch nicht abgelaufener Eintrag bleibt', s.aktive().length === 1);
}

// 5) Erneutes Melden verlängert die Sichtbarkeit über die ursprüngliche
//    TTL hinaus — genau der Fall "Fehler wiederholt sich jedes Bild".
{
  const s = new Fehlersammler();
  const t0 = 0;
  s.melden('Pro Bild', 'warnung', t0);
  // Kurz vor dem ursprünglichen Ablauf erneut gemeldet.
  s.melden('Pro Bild', 'warnung', FEHLER_TTL_MS - 100);
  s.tick(FEHLER_TTL_MS + 50);
  pruefe(
    'wiederholte Meldung verlängert den Ablauf über die erste TTL hinaus',
    s.aktive().length === 1,
  );
  s.tick(FEHLER_TTL_MS - 100 + FEHLER_TTL_MS + 1);
  pruefe('nach der verlängerten TTL läuft der Eintrag doch ab', s.aktive().length === 0);
}

// 6) Deckel greift NICHT, wenn eine bestehende Meldung nur hochgezählt wird.
{
  const s = new Fehlersammler();
  for (let i = 0; i < FEHLER_MAX_GLEICHZEITIG; i++) s.melden(`F${i}`, 'warnung', 0);
  s.melden('F0', 'warnung', 1); // Wiederholung einer bestehenden, keine neue
  pruefe(
    'Hochzählen einer bestehenden Meldung verdrängt niemanden',
    s.aktive().length === FEHLER_MAX_GLEICHZEITIG && s.aktive().every((e) => e.anzahl >= 1),
  );
}

if (fehlgeschlagen > 0) {
  console.log(`\n${fehlgeschlagen} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
} else {
  console.log('\nAlle Prüfungen grün');
  process.exit(0);
}
