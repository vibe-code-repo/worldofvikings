/**
 * Prüft `tools/store-boden-quellen.mjs`: Die Bodentexturen kommen
 * VERLUSTFREI ins Labor (RGB-Pixel gleich, kein Palettenbild, Alpha fällt
 * weg), der zweite Lauf ist byteidentisch, eine unvollständige Quelle
 * macht den Lauf rot (Code 2), und fehlt die Quelle ganz, endet er mit
 * Code 0. (Vorher schrieb `effort: 10` in sharp >= 0.33 ein
 * Palettenbild und veränderte 5,7 % der Texel.)
 *
 * Läuft ohne Assets: Die Quelle baut der Test in einem Temp-Ordner
 * (`WOV_BODEN_QUELLE`); das Werkzeug läuft als KOPIE in einem Temp-Baum,
 * damit sein Ziel `assets/store-lab/` nicht das des Arbeitsbaums ist.
 *
 *   npx tsx tools/test/store-boden-quellen.ts
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
    const baum = join(tmp, 'baum');
    mkdirSync(join(baum, 'tools'), { recursive: true });
    copyFileSync(join(WURZEL, 'tools/store-boden-quellen.mjs'), join(baum, 'tools/store-boden-quellen.mjs'));
    symlinkSync(join(WURZEL, 'node_modules'), join(baum, 'node_modules'));
    const ziel = (n: string): string => join(baum, 'assets/store-lab/textures', n);

    // Rauschartiges Bild mit vielen Farben (ein Palettenbild müsste es verändern).
    const bild = async (pfad: string, seed: number): Promise<Buffer> => {
      const w = 128;
      const roh = Buffer.alloc(w * w * 4);
      for (let i = 0; i < w * w; i++) {
        roh[i * 4] = (i * 7 + seed * 13 + (i >> 3)) & 255;
        roh[i * 4 + 1] = (i * 13 + seed * 3 + (i >> 5) * 5) & 255;
        roh[i * 4 + 2] = (i * 31 + seed * 5 + (i >> 2)) & 255;
        roh[i * 4 + 3] = 255;
      }
      await sharp(roh, { raw: { width: w, height: w, channels: 4 } }).png().toFile(pfad);
      return roh;
    };

    const quelle = join(tmp, 'quelle');
    mkdirSync(quelle);
    const namen = ['terrain-moss-village', 'terrain-rock-moss', 'terrain-moss-dark'];
    const roh: Buffer[] = [];
    for (const [i, n] of namen.entries()) roh.push(await bild(join(quelle, `${n}.png`), i + 1));

    const lauf = (env: Record<string, string>): { status: number | null; ausgabe: string } => {
      const r = spawnSync(process.execPath, [join(baum, 'tools/store-boden-quellen.mjs')], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
      return { status: r.status, ausgabe: `${r.stdout}${r.stderr}` };
    };

    const a = lauf({ WOV_BODEN_QUELLE: quelle });
    check('Lauf mit Quelle endet mit 0', a.status === 0, a.ausgabe);
    for (const [i, n] of namen.entries()) {
      const aus = await sharp(ziel(`${n}.png`)).raw().toBuffer({ resolveWithObject: true });
      let gleich = aus.info.channels === 3;
      for (let p = 0; p < 128 * 128 && gleich; p++) {
        for (let k = 0; k < 3; k++) if (aus.data[p * 3 + k] !== roh[i][p * 4 + k]) gleich = false;
      }
      check(`${n}: drei Kanäle, RGB-Pixel verlustfrei gleich der Quelle`, gleich);
      check(`${n}: kein Palettenbild`, (await sharp(ziel(`${n}.png`)).metadata()).isPalette === false);
    }
    const erster = readFileSync(ziel('terrain-moss-dark.png'));
    lauf({ WOV_BODEN_QUELLE: quelle });
    check('zweiter Lauf byteidentisch', readFileSync(ziel('terrain-moss-dark.png')).equals(erster));

    rmSync(join(quelle, 'terrain-rock-moss.png'));
    const b = lauf({ WOV_BODEN_QUELLE: quelle });
    check('Quelle unvollständig ⇒ Code 2', b.status === 2, `${String(b.status)} ${b.ausgabe}`);
    check('Befund nennt die fehlende Datei', b.ausgabe.includes('terrain-rock-moss.png'));

    const c = lauf({ WOV_BODEN_QUELLE: join(tmp, 'gibt-es-nicht') });
    check('Quelle fehlt ganz ⇒ Code 0 mit Hinweis', c.status === 0 && c.ausgabe.includes('übersprungen'), c.ausgabe);
    check('nichts Neues geschrieben, wenn die Quelle fehlt', existsSync(ziel('terrain-moss-dark.png')));
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
    console.log('\nstore-boden-quellen: alles grün');
  },
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
