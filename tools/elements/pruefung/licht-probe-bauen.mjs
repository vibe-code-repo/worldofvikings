#!/usr/bin/env node
/**
 * Erzeugt: das Messgrab `licht-probe` — eine Kopie eines vorhandenen Grabs mit
 * zwei Fackeln an festen Stellen.
 *
 * Die zwei Fackeln stehen an genau den Stellen, an denen sich „leuchtet
 * durch die Wand" ueberhaupt zeigen KANN.
 * Builds the measuring barrow `licht-probe`.
 *
 * ── Warum es dieses Skript gibt ────────────────────────────────────────
 * Der Befund vom 05.09.2026 lautete: „Die Fackel leuchtet durch eine Wand
 * auf der Rueckseite durch." Ein solcher Satz ist nur zu pruefen, wenn eine
 * Fackel HINTER einer Wand steht, hinter der sonst nichts ist — sonst weiss
 * man nie, ob das Licht durch den Stein kam oder um die Ecke.
 *
 * Genau das stellt dieses Skript her, und es stellt es WIEDERHOLBAR her:
 * Ein von Hand im Editor gesetztes Grab ist beim naechsten Mal ein anderes,
 * und eine Messung an einem anderen Grab ist keine Wiederholung.
 *
 * Die beiden Stellen (Koordinaten des Quellgrabs `rock-probe`, 2-m-Raster):
 *
 *   (0; 1,7; 1,15)    1,0 m HINTER dem Abschlusspaneel (0; 0,15), das die
 *                     Nordkante des Eingangsraums versiegelt. Dahinter ist
 *                     nichts — was von dieser Wand her leuchtet, ist durch
 *                     30 cm Stein gekommen.
 *   (0,55; 1,7; −3,0) an der Wand der Kreuzung (0; −3), 1 m von der Figur.
 *                     Der Verteilungstest.
 *
 * BEIDE sind vom EINSTIEGSPUNKT aus im Bild, und das ist keine Bequemlichkeit:
 * Die Figur laesst sich im Grab nicht versetzen — der Havok-Koerper schreibt
 * `player.position` im naechsten Bild zurueck (s. relief-kontrast.mjs). Eine
 * Messstelle, die man nicht erlaufen will, muss also am Eingang liegen.
 *
 * Was am 05.09.2026 damit gemessen wurde (`fackel-profil.mjs`, mittlere
 * Bildhelligkeit im Messfeld, gleiche Kamera):
 *
 *   Blick auf die Wand mit der Fackel dahinter   61,7  ->  8,3
 *   die zweite solche Wand                       39,0  ->  7,2
 *
 * Der Unterschied ist NICHT dieses Skript, sondern `twoSidedLighting` im
 * Steinmaterial: Ohne den Schalter beleuchtete das Kit die vom Betrachter
 * ABGEWANDTE Seite jeder Wand — deshalb leuchtete es hinten durch.
 *
 * Aufruf (legt die Datei lokal ab; der Weg nach wov-dev ist scp):
 *   node tools/elements/pruefung/licht-probe-bauen.mjs <quelle.json> <ziel.json>
 *
 * Danach:
 *   scp <ziel.json> wov-bau:/opt/worldofvikings/server/data/dungeons/dev/licht-probe.json
 *   ssh wov-bau systemctl restart wov-server
 *
 * Der Neustart gehoert dazu: `DungeonManager.load()` liest die Dokumente
 * EINMAL beim Start. Ohne ihn misst man ein Grab, das es noch nicht gibt —
 * der Client kommt dann nie in `imDungeon`, und die Sonde laeuft in ihr
 * Zeitlimit statt in eine Fehlermeldung.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [quelle, ziel] = process.argv.slice(2);
if (!quelle || !ziel) {
  console.error('Aufruf: node tools/elements/pruefung/licht-probe-bauen.mjs <quelle.json> <ziel.json>');
  process.exit(2);
}

/**
 * Der Hash der Wandfackel.
 *
 * Ausgeschrieben und nicht aus `@wov/shared` geholt: Dieses Skript laeuft
 * ohne Bauschritt, und `getStableHash` steckt in TypeScript. Dass die Zahl
 * stimmt, ist keine Hoffnung — der Sanitizer des Servers wirft jeden Prop
 * mit unbekanntem Hash still weg (`sanitizeDungeonDocument`), und die Sonde
 * meldet dann „0/16 plaetze".
 */
const CRYPT_WALL_TORCH = 620891044;
const OHNE_DREHUNG = { x: 0, y: 0, z: 0, w: 1 };

const doc = JSON.parse(readFileSync(quelle, 'utf-8'));
doc.id = 'licht-probe';
doc.name = 'Lichtprobe RockVault';

/** `roomIndex` bindet die Fackel an einen Raum — beim Entfernen geht sie mit. */
const raumMit = (x, z) =>
  doc.layout.rooms.findIndex((r) => Math.abs(r.pos.x - x) < 0.6 && Math.abs(r.pos.z - z) < 0.6);

doc.layout.props = [
  { prefabName: 'CryptWallTorch', prefabHash: CRYPT_WALL_TORCH, pos: { x: 0, y: 1.7, z: 1.15 }, rot: OHNE_DREHUNG, roomIndex: raumMit(0, 0.15) },
  { prefabName: 'CryptWallTorch', prefabHash: CRYPT_WALL_TORCH, pos: { x: 0.55, y: 1.7, z: -3.0 }, rot: OHNE_DREHUNG, roomIndex: raumMit(0, -3) },
];

writeFileSync(ziel, JSON.stringify(doc, null, 1));
console.log(
  `${ziel}: ${doc.layout.rooms.length} Raeume, ${doc.layout.props.length} Fackeln ` +
    `(roomIndex ${doc.layout.props.map((p) => p.roomIndex).join(', ')})`
);
if (doc.layout.props.some((p) => p.roomIndex < 0)) {
  console.error(
    'WARNUNG: mindestens eine Fackel findet ihren Raum nicht — das Quellgrab hat ' +
      'einen anderen Grundriss als `rock-probe`, und die Stellen oben passen nicht.'
  );
  process.exit(1);
}
