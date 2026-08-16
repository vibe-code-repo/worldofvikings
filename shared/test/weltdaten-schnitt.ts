/**
 * Weltdaten-Schnitt (Bundle-Optimierung D1).
 *
 * Die Weltvorlagen liegen seit dem Bundle-Schnitt in je zwei Dateien:
 *
 *   featuresData.json    Feature-Koepfe (Client + Server)
 *   featurePiecesData.json   die 23 228 Pieces (nur Server)
 *   dungeonsData.json    Dungeon- und Raum-Koepfe (Client + Server)
 *   roomPiecesData.json  netViews/randomSpawns der Raeume (nur Server)
 *
 * Der Grund war die Ladezeit: die schweren Haelften hingen ueber den
 * Barrel-Export an jedem Client-Modul und lagen als 12-MB-Chunk im
 * ausgelieferten Bundle. Der Preis dafuer ist eine Naht, die auseinander-
 * laufen kann — genau die prueft dieser Test:
 *
 *  1. Zu jedem Feature gibt es Pieces (bzw. eine bewusst leere Liste).
 *  2. Der vorberechnete `pieceRadius` im Kopf stimmt mit den echten Pieces
 *     ueberein. Er ersetzt in getTerrainLeveling das Durchlaufen der Pieces;
 *     laeuft er weg, ebnen Locations falsch, ohne dass irgendetwas kracht.
 *  3. Zu jedem Raum aus dem Kit gibt es einen Einrichtungs-Eintrag —
 *     sonst materialisierte der Server leere Raeume ohne Truhen und Spawner.
 *
 * Lauf: npx tsx shared/test/weltdaten-schnitt.ts   (aus shared/)
 */

import { DUNGEONS } from '../src/dungeons.js';
import { getFeaturePieces } from '../src/featurePieces.js';
import { getRoomPieces } from '../src/roomPieces.js';
import featuresData from '../src/featuresData.json';
import featurePiecesData from '../src/featurePiecesData.json';
import roomPiecesData from '../src/roomPiecesData.json';

/**
 * Geprueft werden die DATEIEN, nicht die ausgelieferte Tabelle.
 *
 * Bis Block A stand hier `FEATURES` aus features.ts — dasselbe wie die
 * Kopfdatei, nur als fertige Objekte. Seit die Tabelle gegen die Whitelist
 * `EIGENE_MODELLE` gefiltert wird, ist sie leer, und der Test lief mit
 * „alle 0 Features stehen in der Piece-Datei" gruen durch, ohne noch
 * irgendetwas anzufassen. Die Naht, um die es hier geht, liegt aber
 * zwischen den beiden JSON-Dateien und wird von der Filterung gar nicht
 * beruehrt: Sie laeuft genauso auseinander, ob nun ein Feature
 * ausgeliefert wird oder keines.
 *
 * Deshalb die Rohdatei — sie prueft wieder alle 146 Koepfe statt keinen.
 */
const FEATURE_KOEPFE = featuresData.features as ReadonlyArray<{
  name: string;
  pieceRadius: number;
}>;

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fehler++;
    console.log(`  FEHL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('=== Weltdaten-Schnitt: Kopf- und Rumpfdateien passen zusammen ===\n');

// ── 1 + 2: Features ────────────────────────────────────────────────────
const ohnePieces: string[] = [];
let schlechtesterRadius = 0;
let schlechtestesFeature = '';
let pieceSumme = 0;

for (const f of FEATURE_KOEPFE) {
  const pieces = getFeaturePieces(f.name);
  pieceSumme += pieces.length;
  // Auf den SCHLUESSEL pruefen, nicht auf Inhalt: zehn Features (Bonemass,
  // StoneCircle, die Runensteine …) tragen im pkg tatsaechlich null Pieces —
  // ihre Geometrie steckt im Location-Prefab selbst. Fehlt dagegen der
  // Schluessel, kennt die Rumpfdatei das Feature ueberhaupt nicht.
  if (!(f.name in featurePiecesData.pieces)) ohnePieces.push(f.name);

  let echt = 0;
  for (const p of pieces) {
    const d = Math.hypot(p.pos.x, p.pos.z);
    if (d > echt) echt = d;
  }
  const abweichung = Math.abs(echt - f.pieceRadius);
  if (abweichung > schlechtesterRadius) {
    schlechtesterRadius = abweichung;
    schlechtestesFeature = f.name;
  }
}

check(
  `alle ${FEATURE_KOEPFE.length} Features stehen in der Piece-Datei`,
  ohnePieces.length === 0,
  ohnePieces.length ? `ohne Pieces: ${ohnePieces.slice(0, 5).join(', ')}` : `${pieceSumme} Pieces gesamt`
);

check(
  'pieceRadius im Kopf == groesster Piece-Abstand',
  schlechtesterRadius < 1e-6,
  schlechtesterRadius < 1e-6
    ? 'exakt'
    : `${schlechtestesFeature} weicht um ${schlechtesterRadius} ab`
);

// Kein verwaister Rumpf: jeder Eintrag der Piece-Datei gehoert zu einem Feature.
const featureNamen = new Set(FEATURE_KOEPFE.map((f) => f.name));
const verwaisteFeatures = Object.keys(featurePiecesData.pieces).filter((n) => !featureNamen.has(n));
check(
  'keine verwaisten Piece-Eintraege',
  verwaisteFeatures.length === 0,
  verwaisteFeatures.slice(0, 5).join(', ')
);

// ── 3: Dungeon-Raeume ──────────────────────────────────────────────────
const raumNamen = new Set(DUNGEONS.flatMap((d) => d.rooms.map((r) => r.name)));
const ohneEinrichtung: string[] = [];
let netViewSumme = 0;

for (const name of raumNamen) {
  const p = getRoomPieces(name);
  netViewSumme += p.netViews.length;
  // Ein Raum ohne JEDEN Eintrag ist verdaechtig: die Datei kennt ihn dann
  // gar nicht. Leere netViews sind dagegen legitim (reine Gang-Stuecke),
  // deshalb prueft der Test auf Vorhandensein des Schluessels.
  if (!(name in roomPiecesData.rooms)) ohneEinrichtung.push(name);
}

check(
  `alle ${raumNamen.size} Raum-Prefabs haben einen Einrichtungs-Eintrag`,
  ohneEinrichtung.length === 0,
  ohneEinrichtung.length ? ohneEinrichtung.slice(0, 5).join(', ') : `${netViewSumme} netViews gesamt`
);

const verwaisteRaeume = Object.keys(roomPiecesData.rooms).filter((n) => !raumNamen.has(n));
check(
  'keine verwaisten Einrichtungs-Eintraege',
  verwaisteRaeume.length === 0,
  verwaisteRaeume.slice(0, 5).join(', ')
);

console.log(`\n${fehler === 0 ? 'ALLE PRUEFUNGEN GRUEN' : `${fehler} PRUEFUNG(EN) FEHLGESCHLAGEN`}`);
process.exit(fehler === 0 ? 0 : 1);
