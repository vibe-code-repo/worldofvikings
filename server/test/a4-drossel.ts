/**
 * A4 (Roadmap): Token-Bucket-Drosselung je Peer und Pakettyp — reine
 * Funktion, kein Server/Socket nötig (Drossel.ts kennt weder Peer noch
 * Netzwerk). Zeit kommt bei jedem Test explizit als `jetzt`-Parameter
 * herein, es läuft keine echte Uhr mit.
 *
 * Nutzt bewusst eigene, rundere Testzahlen statt STANDARD_DROSSEL, damit
 * die erwarteten Werte im Test von Hand nachrechenbar bleiben.
 *
 * Run: npx tsx server/test/a4-drossel.ts   (from the repo root)
 */

import { PacketType } from '@wov/shared';
import { Drossel, type DrosselKonfiguration } from '../src/net/Drossel.js';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)} (expect ${JSON.stringify(expected)})`);
};

// PlacePiece: Eimer 3, 1 Token/s. Craft: Eimer 2, 2 Token/s — bewusst
// andere Zahlen, damit ein Test-Fehler, der die beiden Pakettypen
// vertauscht, nicht zufällig trotzdem grün bleibt.
const TESTKONFIG = new Map<PacketType, DrosselKonfiguration>([
  [PacketType.PlacePiece, { eimergroesse: 3, fuellrateProSekunde: 1 }],
  [PacketType.Craft, { eimergroesse: 2, fuellrateProSekunde: 2 }],
]);

// 1) Stoß bis zur Eimergröße geht durch, der nächste sofort danach nicht.
{
  const d = new Drossel(TESTKONFIG);
  check('1. Stoß Token 1/3', d.erlaubt('p1', PacketType.PlacePiece, 0), true);
  check('1. Stoß Token 2/3', d.erlaubt('p1', PacketType.PlacePiece, 0), true);
  check('1. Stoß Token 3/3', d.erlaubt('p1', PacketType.PlacePiece, 0), true);
  check('1. vierter Versuch im selben Moment abgelehnt', d.erlaubt('p1', PacketType.PlacePiece, 0), false);
}

// 2) Nach Wartezeit wieder frei — und danach wieder leer.
{
  const d = new Drossel(TESTKONFIG);
  for (let i = 0; i < 3; i++) d.erlaubt('p1', PacketType.PlacePiece, 0);
  check('2. Eimer leer bei t=0', d.erlaubt('p1', PacketType.PlacePiece, 0), false);
  // 1 Token/s -> nach genau 1000 ms ist genau 1 Token nachgewachsen.
  check('2. nach 1 s genau 1 Token frei', d.erlaubt('p1', PacketType.PlacePiece, 1000), true);
  check('2. sofort danach wieder leer', d.erlaubt('p1', PacketType.PlacePiece, 1000), false);
}

// 3) Zwei Peers stören einander nicht.
{
  const d = new Drossel(TESTKONFIG);
  for (let i = 0; i < 3; i++) d.erlaubt('peerA', PacketType.PlacePiece, 0);
  check('3. peerA-Eimer leer', d.erlaubt('peerA', PacketType.PlacePiece, 0), false);
  check('3. peerB unberührt vom Verbrauch von peerA', d.erlaubt('peerB', PacketType.PlacePiece, 0), true);
  check('3. peerB nach eigenem Stoß ebenfalls limitiert', d.erlaubt('peerB', PacketType.PlacePiece, 0), true);
}

// 4) Zwei Pakettypen desselben Peers stören einander nicht.
{
  const d = new Drossel(TESTKONFIG);
  for (let i = 0; i < 3; i++) d.erlaubt('p1', PacketType.PlacePiece, 0);
  check('4. PlacePiece-Eimer von p1 leer', d.erlaubt('p1', PacketType.PlacePiece, 0), false);
  check('4. Craft-Eimer von p1 unberührt, erster Zugriff geht durch', d.erlaubt('p1', PacketType.Craft, 0), true);
  check('4. Craft-Eimer von p1 zweiter Zugriff geht ebenfalls durch (Eimergröße 2)', d.erlaubt('p1', PacketType.Craft, 0), true);
  check('4. Craft-Eimer von p1 danach leer', d.erlaubt('p1', PacketType.Craft, 0), false);
}

// 5) Aufräumen entfernt den Zustand — ein Peer danach ist wieder frisch.
{
  const d = new Drossel(TESTKONFIG);
  d.erlaubt('p1', PacketType.PlacePiece, 0);
  check('5. Peer taucht in bekanntePeers auf', d.bekanntePeers, 1);
  d.raeumeAufFuerPeer('p1');
  check('5. Peer verschwunden nach raeumeAufFuerPeer', d.bekanntePeers, 0);
  // Voller Eimer, nicht der (nicht mehr existierende) Rest von vorher.
  check('5. frischer Eimer Token 1/3', d.erlaubt('p1', PacketType.PlacePiece, 0), true);
  check('5. frischer Eimer Token 2/3', d.erlaubt('p1', PacketType.PlacePiece, 0), true);
  check('5. frischer Eimer Token 3/3', d.erlaubt('p1', PacketType.PlacePiece, 0), true);
}

// 6) Zeitsprünge rückwärts (verstellte Uhr) führen nicht zu unendlichen
//    Token: solange die Uhr unter dem zuletzt gesehenen Zeitpunkt bleibt,
//    wächst der Eimer nicht — erst eine echte Sekunde NACH dem zuletzt
//    gesehenen Zeitpunkt darf wieder ein Token liefern.
{
  const d = new Drossel(TESTKONFIG);
  const T = 1_000_000;
  for (let i = 0; i < 3; i++) d.erlaubt('p1', PacketType.PlacePiece, T);
  check('6. Eimer leer vor dem Zeitsprung', d.erlaubt('p1', PacketType.PlacePiece, T), false);
  // Uhr springt weit zurück.
  check('6. während des Rücksprungs weiterhin leer', d.erlaubt('p1', PacketType.PlacePiece, 0), false);
  // Ein zweiter, noch tieferer Rücksprung darf ebenfalls nichts auffüllen.
  check('6. auch ein zweiter, tieferer Rücksprung bleibt leer', d.erlaubt('p1', PacketType.PlacePiece, -500_000), false);
  // Uhr springt knapp über den ursprünglichen (zuletzt GESEHENEN)
  // Zeitpunkt vor — nur die Spanne ab T zählt, nicht ab 0 oder -500_000.
  check('6. 100 ms nach dem zuletzt gesehenen Zeitpunkt noch leer (< 1 Token)', d.erlaubt('p1', PacketType.PlacePiece, T + 100), false);
  // Erst eine volle Sekunde nach dem zuletzt GESEHENEN Zeitpunkt (T) ist
  // ein Token entstanden — nicht eine Sekunde nach den Rücksprüngen.
  check('6. eine volle Sekunde nach dem zuletzt gesehenen Zeitpunkt gibt 1 Token', d.erlaubt('p1', PacketType.PlacePiece, T + 1000), true);
  check('6. danach wieder leer', d.erlaubt('p1', PacketType.PlacePiece, T + 1000), false);
}

console.log(
  failures === 0 ? '\n=== A4 Drossel: ALL PASSED ===' : `\n=== A4 Drossel: ${failures} FAILED ===`
);
process.exit(failures === 0 ? 0 : 1);
