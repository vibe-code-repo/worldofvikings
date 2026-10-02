/**
 * Prüft die zwei Bodentexturen der Grauklamm, die in Mikes Speicher
 * liegen müssen (`assets/store/textures/`): Dateibytes gleich dem Export,
 * Größe 2048², Kennungen ohne Leerzeichen. Sie brauchen kein Werkzeug:
 * `store-terrain-schichten.mjs` sucht im Speicher zuerst.
 *
 * Braucht die Dateien im Speicher; fehlen sie noch (Mike hat nicht
 * kopiert), überspringt der Sammellauf den Test (`brauchtModelle`,
 * scripts/kern/tools.mjs). Fehlt nur EINE der beiden, wird er rot.
 *
 *   npx tsx tools/test/store-boden-texturen.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXTUREN = join(WURZEL, 'assets/store/textures');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Datei im Speicher → sha256 der Export-Datei (`Rock_Texture_01.png`, `Rock_Moss_Normals.png`) und Größe. */
export const ERWARTET: Record<string, { sha256: string; bytes: number }> = {
  'terrain-rock-grey.png': { sha256: 'ec0eb0ec4ca13fa4dfe600a7922d3a587f6fe347003db64e1dc041c3bb78cb25', bytes: 1254738 },
  'terrain-rock-moss-normal.png': { sha256: 'd49869f13ee6b17f04aee98b1ada4371f4b08ff8a14bca451df93903fda88a4d', bytes: 1832608 },
};

for (const [datei, soll] of Object.entries(ERWARTET)) {
  const pfad = join(TEXTUREN, datei);
  check(`${datei}: liegt im Speicher`, existsSync(pfad), pfad);
  if (!existsSync(pfad)) continue;
  const buf = readFileSync(pfad);
  check(`${datei}: Größe ${soll.bytes} B`, buf.length === soll.bytes, String(buf.length));
  const hash = createHash('sha256').update(buf).digest('hex');
  check(`${datei}: sha256 gleich dem Export`, hash === soll.sha256, hash);
  check(`${datei}: PNG 2048×2048`, buf.readUInt32BE(16) === 2048 && buf.readUInt32BE(20) === 2048);
  check(`${datei}: Kennung ohne Leerzeichen`, !/\s/.test(datei));
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) rot`);
  process.exit(1);
}
console.log('\nstore-boden-texturen: alles grün');
