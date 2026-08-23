/**
 * Haarfarbe — Palette, Pruefung, Rueckfall und Abwaertsvertraeglichkeit.
 *
 * Geprueft wird das, was beim Spielen schiefgehen kann:
 *
 *  [1] Die Palette: Kennungen eindeutig, jeder Hex-Wert lesbar, die
 *      Vorgabe steht in der Liste.
 *  [2] Die Pruefung: Der Server glaubt dem Client nicht. Unbekanntes,
 *      Leerstring, Nicht-Strings und ein durchgereichter Hex-Wert
 *      (statt einer Kennung) fallen durch.
 *  [3] Der Rueckfall: Eine entfernte Farbe darf einen alten Spielstand
 *      nicht unbrauchbar machen — haarfarbeZu() liefert die Vorgabe.
 *  [4] Die VORGABE aendert nichts am Aussehen. `mittelbraun` ist so
 *      gewaehlt, dass sie exakt die bisherige Platzhalterfarbe der
 *      Frisurenmaterialien trifft (linear 0,16/0,10/0,05). Sonst saehe
 *      jeder Spielstand von vor dem 23.08.2026 ploetzlich anders aus.
 *      Gerechnet wird mit Gamma 2,2 — das ist die Naeherung, die
 *      Babylons `toLinearSpace()` benutzt, nicht die exakte
 *      sRGB-Kurve. (Nachgemessen im laufenden Client: 0,160/0,099/0,046.)
 *  [5] Das Paket: SetAussehen traegt die Farbe als VIERTEN String,
 *      angehaengt statt eingeschoben. Ein Client von vor dem 23.08.2026
 *      sendet drei — der Server muss das ueberleben, statt beim Lesen
 *      zu werfen und die Verbindung abzureissen.
 *
 * Run: npx tsx server/test/f18-haarfarbe.ts   (from the repo root)
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  HAARFARBEN,
  HAARFARBE_MEMBER,
  HAARFARBE_VORGABE,
  haarfarbeZu,
  istHaarfarbe,
} from '@wov/shared';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

/** Repo-Wurzel aus dem eigenen Pfad, nicht aus process.cwd() — s. F17. */
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let fehler = 0;

function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (bedingung) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}

console.log('\n[1] Die Palette');
const kennungen = HAARFARBEN.map((h) => h.id);
pruefe('mindestens vier Farben', HAARFARBEN.length >= 4, `${HAARFARBEN.length}`);
pruefe('Kennungen eindeutig', new Set(kennungen).size === kennungen.length, kennungen.join(', '));
pruefe('Vorgabe steht in der Liste', istHaarfarbe(HAARFARBE_VORGABE), HAARFARBE_VORGABE);
for (const h of HAARFARBEN) {
  pruefe(`"${h.id}": Hex lesbar`, /^#[0-9A-Fa-f]{6}$/.test(h.hex), h.hex);
  pruefe(`"${h.id}": hat einen Namen`, h.name.trim().length > 0, h.name);
}
pruefe('Member heisst wie erwartet', HAARFARBE_MEMBER === 'haarfarbe', HAARFARBE_MEMBER);

console.log('\n[2] Der Server glaubt dem Client nicht');
for (const boese of ['', 'gibtsnicht', '#8C3A17', '../../etc/passwd', 'MITTELBRAUN']) {
  pruefe(`abgelehnt: ${JSON.stringify(boese)}`, !istHaarfarbe(boese));
}
for (const boese of [null, undefined, 42, {}, ['mittelbraun']]) {
  pruefe(`abgelehnt: ${JSON.stringify(boese) ?? 'undefined'}`, !istHaarfarbe(boese));
}
pruefe('angenommen: erste Farbe der Liste', istHaarfarbe(HAARFARBEN[0]!.id), HAARFARBEN[0]!.id);

console.log('\n[3] Rueckfall auf die Vorgabe');
pruefe('unbekannt → Vorgabe', haarfarbeZu('gibtsnicht').id === HAARFARBE_VORGABE);
pruefe('null → Vorgabe', haarfarbeZu(null).id === HAARFARBE_VORGABE);
pruefe('bekannt → sich selbst', haarfarbeZu('fuchsrot').id === 'fuchsrot');

/**
 * Liegen die Modelldateien ueberhaupt vor?
 *
 * `assets/` steht in `.gitignore` (nur `manifest.json` ist ausgenommen) --
 * 516 Dateien, 210 MB, die Mike bewusst ausserhalb des Repos sichert. Ein
 * frischer Checkout, wie ihn GitHub Actions macht, hat sie also NIE.
 *
 * Ohne diese Unterscheidung pruefte der Test dort nicht den Quelltext,
 * sondern den Umfang des Checkouts -- und war rot, ohne dass etwas kaputt
 * war (beobachtet am 23.08.2026, drei Tests gleichzeitig).
 *
 * FEHLT DER ORDNER GANZ, wird uebersprungen. FEHLEN EINZELNE DATEIEN
 * DARIN, bleibt es ein Fehlschlag -- genau dafuer ist die Pruefung da.
 */
if (!existsSync(resolve(WURZEL, 'assets/models/wikingerin/H_01.glb'))) {
  console.log('\n[4] UEBERSPRUNGEN: assets/ liegt nicht im Repo.');
  console.log(
    fehler === 0 ? '\n=== F18 Haarfarbe: ALLE PRUEFUNGEN BESTANDEN ===' : `\n=== F18 Haarfarbe: ${fehler} FEHLGESCHLAGEN ===`
  );
  process.exit(fehler === 0 ? 0 : 1);
}

console.log('\n[4] Die Vorgabe aendert nichts am Aussehen');
const vorgabe = haarfarbeZu(HAARFARBE_VORGABE);
const linear = (n: number): number => Math.pow(n / 255, 2.2);
const kanal = (i: number): number => linear(parseInt(vorgabe.hex.slice(1 + i * 2, 3 + i * 2), 16));
// Der Platzhalter steht in JEDER Frisurendatei als baseColorFactor. Er
// wird hier aus H_01.glb GELESEN statt getippt: Eine Zahl im Test, die
// niemand mit der Datei vergleicht, verrottet still.
const glb = readFileSync(resolve(WURZEL, 'assets/models/wikingerin/H_01.glb'));
let json: Record<string, unknown> | null = null;
for (let o = 12; o < glb.length; ) {
  const laenge = glb.readUInt32LE(o);
  if (glb.readUInt32LE(o + 4) === 0x4e4f534a) {
    json = JSON.parse(glb.subarray(o + 8, o + 8 + laenge).toString('utf8'));
    break;
  }
  o += 8 + laenge + ((4 - (laenge % 4)) % 4);
}
const werk = (json?.materials as Array<{ pbrMetallicRoughness?: { baseColorFactor?: number[] } }>)
  ?.[0]?.pbrMetallicRoughness?.baseColorFactor;
pruefe('Platzhalterfarbe in H_01.glb gefunden', Array.isArray(werk), JSON.stringify(werk));
if (Array.isArray(werk)) {
  for (let i = 0; i < 3; i++) {
    const ab = Math.abs(kanal(i) - werk[i]!);
    pruefe(
      `Kanal ${'RGB'[i]} trifft den Platzhalter`,
      ab < 0.01,
      `Vorgabe ${kanal(i).toFixed(3)} vs. Modell ${werk[i]!.toFixed(3)}`
    );
  }
}

console.log('\n[5] Altes Paket ohne Farbe bleibt lesbar');
// Genau der Aufbau, den ein Client von VOR dem 23.08.2026 schickt.
const alt = new Writer();
alt.writeString('H_03');
alt.writeString('leder_bh');
alt.writeString('leder_shorts');
const r = new Reader(alt.toBuffer());
const gelesen = [r.readString(), r.readString(), r.readString()];
pruefe('drei Werte kommen heil an', gelesen.join('|') === 'H_03|leder_bh|leder_shorts', gelesen.join('|'));
pruefe('danach ist der Puffer leer', r.remaining() === 0, `${r.remaining()} Byte`);

// Und der neue Aufbau mit Farbe.
const neu = new Writer();
neu.writeString('H_03');
neu.writeString('leder_bh');
neu.writeString('leder_shorts');
neu.writeString('fuchsrot');
const r2 = new Reader(neu.toBuffer());
r2.readString();
r2.readString();
r2.readString();
pruefe('neues Paket hat noch Daten', r2.remaining() > 0, `${r2.remaining()} Byte`);
pruefe('vierter Wert ist die Farbe', r2.readString() === 'fuchsrot');

if (fehler === 0) {
  console.log('\n=== F18 Haarfarbe: ALLE PRUEFUNGEN BESTANDEN ===');
  process.exit(0);
} else {
  console.error(`\n=== F18 Haarfarbe: ${fehler} FEHLGESCHLAGEN ===`);
  process.exit(1);
}
