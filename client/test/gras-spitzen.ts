/**
 * Der Spitzen-Verlauf des Grases (Runde 2, Hebel 3 „Gras").
 *
 * Das Vorbild färbt seine Grasbüschel nicht mit EINER Farbe, sondern mit
 * zweien — hell gelbgrün an der Spitze, warm dunkel am Fuss. Unsere GLB
 * kann nur eine tragen (`baseColorFactor`), deshalb steht dort das MITTEL
 * aus beiden und der Verlauf entsteht im Shader (`GRAS_SPITZEN`,
 * `ClutterWindPlugin`).
 *
 * Diese Sonde prüft, was daran lautlos schiefgehen kann:
 *
 *  1. MITTELWERTTREUE. Der Faktor steht bei halber Halmhöhe auf 1,0.
 *     Sonst wäre der Verlauf zugleich ein Helligkeitsregler, und jede
 *     Look-Messung danach um einen unbekannten Betrag verschoben —
 *     genau das, was der Auftrag mit „keine Aufhellung des Bodens"
 *     ausschliesst.
 *  2. DIE ENDFARBEN STIMMEN. Mittel × Faktor(0) und Mittel × Faktor(1)
 *     ergeben wieder die gemessenen Farben des Vorbilds. Das prüft die
 *     Rechnung UND die Zahlen; ein Tippfehler in einer der acht Farben
 *     fällt hier auf und nicht erst im Bild.
 *  3. DER VERLAUF IST SICHTBAR. Der Grün-Kontrast des Wiesengrases liegt
 *     über 0,2. Ein Verlauf, den man nicht sieht, ist ein Schalter ohne
 *     Wirkung — und der sieht aus wie „das Gras ist halt so".
 *  4. SPITZE HELLER ALS FUSS. Für jedes der vier Büschel, in allen drei
 *     Kanälen ein positiver Kontrast heisst: oben heller. Ein
 *     vertauschtes Paar (Fuss oben) wäre im Bild nur ein „irgendwie
 *     komisch".
 *  5. DIE GLB TRÄGT DAS MITTEL. Liegt der aufbereitete Store daneben,
 *     wird gegengeprüft, dass `tools/store-vegetation-aufbereiten.mjs`
 *     wirklich den Mittelwert dieser beiden Farben in die Datei
 *     schreibt. Läuft eine der beiden Seiten weg, steht das Gras
 *     plötzlich zu hell oder zu dunkel — bei unverändertem Verlauf.
 *
 *   npx tsx client/test/gras-spitzen.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAS_SPITZEN, spitzenKontrast } from '../src/engine/GrassClutter';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Der Faktor, den der Shader auf die Grundfarbe multipliziert. */
const faktor = (d: readonly number[], h: number): [number, number, number] => [
  1 + d[0]! * (2 * h - 1),
  1 + d[1]! * (2 * h - 1),
  1 + d[2]! * (2 * h - 1),
];

const namen = Object.keys(GRAS_SPITZEN) as Array<keyof typeof GRAS_SPITZEN>;
check('Alle vier Store-Büschel haben einen Verlauf', namen.length === 4, namen.join(','));

for (const name of namen) {
  const v = GRAS_SPITZEN[name];
  const d = spitzenKontrast(v);
  const mittel = [0, 1, 2].map((k) => (v.oben[k]! + v.unten[k]!) / 2);

  // ── 1. Mittelwerttreue ─────────────────────────────────────────────
  const mitte = faktor(d, 0.5);
  check(
    `${name}: Faktor bei halber Höhe ist 1,0`,
    mitte.every((f) => Math.abs(f - 1) < 1e-9),
    mitte.map((f) => f.toFixed(6)).join('/')
  );

  // ── 2. Die Endfarben ───────────────────────────────────────────────
  const oben = faktor(d, 1).map((f, k) => f * mittel[k]!);
  const unten = faktor(d, 0).map((f, k) => f * mittel[k]!);
  check(
    `${name}: Mittel × Faktor(1) ergibt die Spitzenfarbe`,
    oben.every((c, k) => Math.abs(c - v.oben[k]!) < 1e-6),
    `${oben.map((c) => c.toFixed(4)).join('/')} statt ${v.oben.join('/')}`
  );
  check(
    `${name}: Mittel × Faktor(0) ergibt die Fussfarbe`,
    unten.every((c, k) => Math.abs(c - v.unten[k]!) < 1e-6),
    `${unten.map((c) => c.toFixed(4)).join('/')} statt ${v.unten.join('/')}`
  );

  // ── 4. Spitze heller als Fuss ──────────────────────────────────────
  check(
    `${name}: Spitze heller als Fuss in allen drei Kanälen`,
    d.every((k) => k > 0),
    d.map((k) => k.toFixed(3)).join('/')
  );
}

// ── 3. Der Verlauf ist sichtbar ──────────────────────────────────────
/*
  0,2 ist keine runde Zahl aus dem Gefühl: Der Faktor läuft damit von
  0,8 am Fuss bis 1,2 an der Spitze, also ±20 % linear — auf dem
  Bildschirm rund ±8 % Helligkeit (Gamma 2,2). Das ist die Grenze, ab
  der die Tönungsstreuung je Büschel (GRAS_LUMA_STREUUNG, ±7 %) den
  Verlauf nicht mehr überdeckt.
*/
const dGruen = spitzenKontrast(GRAS_SPITZEN.gruen);
check('Wiesengras: Grün-Kontrast über 0,2', dGruen[1] > 0.2, dGruen[1].toFixed(3));

// ── 5. Die GLB trägt das Mittel ──────────────────────────────────────
/*
  Nur wenn der aufbereitete Store dasteht. `assets/` liegt ausserhalb des
  Repos; im CI-Checkout gibt es die Datei nicht, und ein roter Test dafür
  wäre ein Fehlalarm statt eines Befunds.
*/
const GLB = join(WURZEL, 'assets/store-lab/vegetation/grass-short-clump-1.glb');
if (!existsSync(GLB)) {
  console.log('hinweis  Store-GLB nicht aufbereitet — Gegenprobe 5 übersprungen');
} else {
  const buf = readFileSync(GLB);
  // Nur den JSON-Block lesen: Der erste Datenblock einer GLB steht bei
  // Byte 12 und trägt seine Länge im Kopf.
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len)));
  const mat = (json.materials ?? []).find(
    (m: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }) =>
      m.pbrMetallicRoughness?.baseColorFactor
  );
  const f: number[] | undefined = mat?.pbrMetallicRoughness?.baseColorFactor;
  const soll = [0, 1, 2].map((k) => (GRAS_SPITZEN.gruen.oben[k]! + GRAS_SPITZEN.gruen.unten[k]!) / 2);
  check(
    'GLB-Faktor ist das Mittel aus Spitze und Fuss',
    Array.isArray(f) && soll.every((c, k) => Math.abs(f[k]! - c) < 5e-4),
    `${(f ?? []).map((c) => c.toFixed(4)).join('/')} gegen ${soll.map((c) => c.toFixed(4)).join('/')}`
  );
}

console.log(fehler === 0 ? '\nAlles grün.' : `\n${fehler} Fehler.`);
process.exit(fehler === 0 ? 0 : 1);
