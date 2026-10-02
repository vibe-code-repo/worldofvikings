/**
 * Prüft den Export-Zweig von `tools/store-boden-quellen.mjs`: Die zwei
 * Export-Texturen (`terrain-rock-grey`, `terrain-rock-moss-normal`) kommen
 * VERLUSTFREI ins Labor (RGB-Pixel gleich, Alpha fällt weg), ein
 * unvollständiger Export macht den Lauf rot, und fehlt alles, endet er
 * mit Code 0.
 *
 * Läuft ohne Assets: Die Quellen baut der Test selbst in einem Temp-
 * Ordner (`WOV_BODEN_QUELLE`/`WOV_EXPORT_TEXTUREN`). Das Werkzeug läuft
 * als KOPIE in einem Temp-Baum, damit sein Ziel `assets/store-lab/`
 * nicht das des Arbeitsbaums ist.
 *
 *   npx tsx tools/test/store-boden-export.ts
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function haupt(): Promise<void> {
const tmp = mkdtempSync(join(tmpdir(), 'grauklamm-k1-boden-'));
try {
  // Arbeitsbaum-Attrappe: tools/ + node_modules, eigenes assets/.
  const baum = join(tmp, 'baum');
  mkdirSync(join(baum, 'tools'), { recursive: true });
  copyFileSync(join(WURZEL, 'tools/store-boden-quellen.mjs'), join(baum, 'tools/store-boden-quellen.mjs'));
  symlinkSync(join(WURZEL, 'node_modules'), join(baum, 'node_modules'));
  const zielDatei = (n: string): string => join(baum, 'assets/store-lab/textures', n);

  const bild = async (pfad: string, alpha: number, seed: number): Promise<Buffer> => {
    const w = 64;
    const roh = Buffer.alloc(w * w * 4);
    for (let i = 0; i < w * w; i++) {
      roh[i * 4] = (i * 7 + seed) & 255;
      roh[i * 4 + 1] = (i * 13 + seed * 3) & 255;
      roh[i * 4 + 2] = (i * 31 + seed * 5) & 255;
      roh[i * 4 + 3] = alpha;
    }
    await sharp(roh, { raw: { width: w, height: w, channels: 4 } }).png().toFile(pfad);
    return roh;
  };

  const bestand = join(tmp, 'bestand');
  const exportOrdner = join(tmp, 'export');
  mkdirSync(bestand);
  mkdirSync(exportOrdner);
  for (const n of ['terrain-moss-village', 'terrain-rock-moss', 'terrain-moss-dark']) await bild(join(bestand, `${n}.png`), 255, 1);
  const rockRoh = await bild(join(exportOrdner, 'Rock_Texture_01.png'), 255, 11);
  await bild(join(exportOrdner, 'Rock_Moss_Normals.png'), 255, 22);

  const lauf = (env: Record<string, string>): { status: number | null; ausgabe: string } => {
    const r = spawnSync(process.execPath, [join(baum, 'tools/store-boden-quellen.mjs')], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { status: r.status, ausgabe: `${r.stdout}${r.stderr}` };
  };
  const beide = { WOV_BODEN_QUELLE: bestand, WOV_EXPORT_TEXTUREN: exportOrdner };

  const a = lauf(beide);
  check('Lauf mit beiden Quellen endet mit 0', a.status === 0, a.ausgabe);
  check('terrain-rock-grey.png geschrieben', existsSync(zielDatei('terrain-rock-grey.png')));
  check('terrain-rock-moss-normal.png geschrieben', existsSync(zielDatei('terrain-rock-moss-normal.png')));
  const ausgabe = await sharp(zielDatei('terrain-rock-grey.png')).raw().toBuffer({ resolveWithObject: true });
  check('Ziel hat drei Kanäle (Alpha fällt weg)', ausgabe.info.channels === 3);
  let gleich = true;
  for (let i = 0; i < 64 * 64; i++) {
    for (let k = 0; k < 3; k++) if (ausgabe.data[i * 3 + k] !== rockRoh[i * 4 + k]) gleich = false;
  }
  check('RGB-Pixel verlustfrei gleich dem Export', gleich);
  const meta = await sharp(zielDatei('terrain-rock-grey.png')).metadata();
  check('Ziel ist keine Palette', meta.isPalette === false);
  const erster = readFileSync(zielDatei('terrain-rock-grey.png'));
  lauf(beide);
  check('zweiter Lauf byteidentisch', readFileSync(zielDatei('terrain-rock-grey.png')).equals(erster));

  rmSync(join(exportOrdner, 'Rock_Moss_Normals.png'));
  const b = lauf(beide);
  check('Export unvollständig ⇒ Code 2', b.status === 2, `${String(b.status)} ${b.ausgabe}`);
  check('Befund nennt die fehlende Datei', b.ausgabe.includes('Rock_Moss_Normals.png'));

  const c = lauf({ WOV_BODEN_QUELLE: join(tmp, 'gibt-es-nicht'), WOV_EXPORT_TEXTUREN: join(tmp, 'gibt-es-auch-nicht') });
  check('beide Quellen fehlen ⇒ Code 0', c.status === 0, c.ausgabe);

  const d = lauf({ WOV_BODEN_QUELLE: join(tmp, 'gibt-es-nicht'), WOV_EXPORT_TEXTUREN: exportOrdner });
  check('nur Export da, aber unvollständig ⇒ Code 2', d.status === 2, d.ausgabe);

  // Export vollständig, Quellbestand fehlt: nur die zwei Export-Dateien entstehen.
  await bild(join(exportOrdner, 'Rock_Moss_Normals.png'), 255, 22);
  rmSync(join(baum, 'assets'), { recursive: true, force: true });
  const e = lauf({ WOV_BODEN_QUELLE: join(tmp, 'gibt-es-nicht'), WOV_EXPORT_TEXTUREN: exportOrdner });
  check('nur Export da und vollständig ⇒ Code 0', e.status === 0, e.ausgabe);
  check(
    'dann entstehen genau die zwei Export-Texturen',
    existsSync(zielDatei('terrain-rock-grey.png')) &&
      existsSync(zielDatei('terrain-rock-moss-normal.png')) &&
      !existsSync(zielDatei('terrain-moss-village.png'))
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
}

haupt().then(
  () => {
    if (fehler > 0) {
      console.error(`\n${fehler} Prüfung(en) rot`);
      process.exit(1);
    }
    console.log('\nstore-boden-export: alles grün');
  },
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
