/**
 * Prüft den Rollout-Weg der Labor-Pflanzen: `store:aufbereiten` (Schritt 5b
 * von `tools/wov-update.sh`) baut `assets/store-lab/vegetation/` bei jedem
 * Lauf NEU auf und muss Blumen und Farn aus den Ausgangsdateien in
 * `assets/store/vegetation-roh/` ohne Extra-Schritt wieder hineinlegen,
 * OHNE je abzubrechen und OHNE getrackte Dateien zu schreiben. Sechs
 * Zustände des Ordners:
 *
 *  (a) fehlt ganz        → Code 0, Warnung, keine Pflanzen
 *  (b) vollständig, passt zur Messliste → Code 0, drei Pflanzen, zweiter Lauf byteidentisch
 *  (c) teilweise gefüllt → Code 0, Warnung, das Vorhandene gebaut
 *  (d) eine Datei abgeschnitten → Code 0, Warnung, nur die gültigen gebaut
 *  (e) gültig, aber mit anderem Hash als die Messliste (Mike ersetzt eine Datei)
 *                        → Code 0, laute Warnung „per PR", ersetzte Datei nicht gebaut
 *  (f) leer              → Code 0, Warnung
 *
 * In jedem Zustand: Messliste und `shared/src/store*.ts` des Wegwerf-Baums
 * unverändert (Hash vorher/nachher), die Store-Vegetation daneben da.
 *
 * Läuft in einem Wegwerf-Baum (Kopie der Werkzeuge, Verweise auf den
 * Speicher ohne `vegetation-roh`), schreibt also nie in den Arbeitsbaum.
 * Braucht `assets/store/vegetation` (Weiche `brauchtModelle`); die
 * Ausgangsdateien baut der Test selbst.
 *
 *   npx tsx tools/test/store-lab-rollout.ts
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs ohne Typen
import { MODELLE } from '../store-pflanzen-quellen.mjs';
// @ts-expect-error — .mjs ohne Typen
import { exportGlb } from '../lib/pflanzen-probe.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = join(WURZEL, 'assets/store');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const modelle = MODELLE as { quelle: string; id: string }[];
const sauber = (): Buffer[] => modelle.map((m, i) => exportGlb(m.id.startsWith('fern') ? 'Plant_Leaves_1A3 1' : 'Flowers_A 1', i + 1));
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

function baumBauen(tmp: string, name: string, dateien: Record<string, Buffer> | null): string {
  const baum = join(tmp, name);
  mkdirSync(join(baum, 'tools/lib'), { recursive: true });
  mkdirSync(join(baum, 'shared/src'), { recursive: true });
  mkdirSync(join(baum, 'assets/store'), { recursive: true });
  for (const f of ['store-vegetation-aufbereiten.mjs', 'store-pflanzen-quellen.mjs', 'store-lab-katalog.json', 'lib/png.mjs']) {
    copyFileSync(join(WURZEL, 'tools', f), join(baum, 'tools', f));
  }
  copyFileSync(join(WURZEL, 'shared/src/laubSpitzen.ts'), join(baum, 'shared/src/laubSpitzen.ts'));
  symlinkSync(join(WURZEL, 'node_modules'), join(baum, 'node_modules'));
  for (const n of readdirSync(STORE)) {
    if (n !== 'vegetation-roh') symlinkSync(join(STORE, n), join(baum, 'assets/store', n));
  }
  if (dateien) {
    const roh = join(baum, 'assets/store/vegetation-roh');
    mkdirSync(roh);
    for (const [n, b] of Object.entries(dateien)) writeFileSync(join(roh, n), b);
  }
  return baum;
}

function lauf(baum: string): { status: number | null; ausgabe: string } {
  const r = spawnSync(join(WURZEL, 'node_modules/.bin/tsx'), [join(baum, 'tools/store-vegetation-aufbereiten.mjs')], {
    cwd: baum,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, ausgabe: `${r.stdout}${r.stderr}` };
}

const lab = (baum: string): string => join(baum, 'assets/store-lab/vegetation');
const pflanzen = (baum: string): string[] =>
  existsSync(lab(baum)) ? readdirSync(lab(baum)).filter((f) => /^(flower|fern)-.*\.glb$/.test(f)).sort() : [];
const liste = (baum: string): string => join(baum, 'tools/store-lab-katalog.json');

const tmp = mkdtempSync(join(tmpdir(), 'grauklamm-k1-rollout-'));
try {
  const gut = sauber();
  const ganz: Record<string, Buffer> = Object.fromEntries(modelle.map((m, i) => [m.quelle, gut[i]]));

  /** Zustand durchspielen: Code 0, Messliste und Rest unverändert, Pflanzen wie erwartet. */
  function zustand(kennung: string, dateien: Record<string, Buffer> | null, erwartet: string[], warnung: RegExp | null, vorbereiten?: (b: string) => void): string {
    const baum = baumBauen(tmp, kennung, dateien);
    vorbereiten?.(baum);
    const vorher = sha(liste(baum));
    const l = lauf(baum);
    check(`(${kennung}) Lauf endet mit 0`, l.status === 0, l.ausgabe.slice(-500));
    check(`(${kennung}) Pflanzen im Labor: ${erwartet.join(',') || 'keine'}`, JSON.stringify(pflanzen(baum)) === JSON.stringify(erwartet), pflanzen(baum).join(','));
    check(`(${kennung}) Messliste unverändert`, sha(liste(baum)) === vorher);
    check(`(${kennung}) Warnung ${warnung ? 'steht in der Ausgabe' : 'fehlt (keine nötig)'}`, warnung ? warnung.test(l.ausgabe) : !/pflanzen-quellen\] WARNUNG/.test(l.ausgabe), l.ausgabe.slice(-300));
    check(`(${kennung}) Store-Vegetation daneben steht`, existsSync(join(lab(baum), 'bush-1a2-small.glb')) && existsSync(join(lab(baum), 'BERICHT.json')));
    return baum;
  }

  /** Messliste des Wegwerf-Baums aus den selbstgebauten Dateien erzeugen (der Schalter, von Hand). */
  const messlisteErzeugen = (baum: string): void => {
    const r = spawnSync(join(WURZEL, 'node_modules/.bin/tsx'), [join(baum, 'tools/store-pflanzen-quellen.mjs'), '--messliste-schreiben'], {
      cwd: baum,
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`Messliste: ${r.stdout}${r.stderr}`);
  };
  const echt = sha(join(WURZEL, 'tools/store-lab-katalog.json'));

  // (a) fehlt ganz
  zustand('a', null, [], /WARNUNG.*vegetation-roh/s);
  // (b) vollständig, Liste passend gemacht
  const b = zustand('b', ganz, modelle.map((m) => `${m.id}.glb`).sort(), null, messlisteErzeugen);
  const bytes1 = pflanzen(b).map((f) => readFileSync(join(lab(b), f)));
  const b2 = lauf(b);
  check('(b) zweiter Lauf endet mit 0', b2.status === 0);
  check('(b) zweiter Lauf: Modelle byteidentisch', pflanzen(b).every((f, i) => readFileSync(join(lab(b), f)).equals(bytes1[i])));
  check('(b) Texturen neben den Modellen', readdirSync(join(lab(b), 'textures')).some((f) => /^blume-[0-9a-f]{8}\.png$/.test(f)) && readdirSync(join(lab(b), 'textures')).some((f) => /^farn-[0-9a-f]{8}\.png$/.test(f)));
  // (c) teilweise
  zustand('c', { [modelle[0].quelle]: gut[0] }, ['flower-1a4.glb'], /flower-1a12\.glb fehlt/, (baum) => {
    // Liste muss zu der einen Datei passen: aus dem vollen Satz erzeugen, dann nur eine liegen lassen.
    const voll = baumBauen(tmp, 'c-voll', ganz);
    messlisteErzeugen(voll);
    copyFileSync(liste(voll), liste(baum));
  });
  // (d) abgeschnitten
  zustand('d', { [modelle[0].quelle]: gut[0], [modelle[1].quelle]: gut[1], [modelle[2].quelle]: gut[2].subarray(0, 200) }, ['flower-1a12.glb', 'flower-1a4.glb'], /fern-1a1\.glb:.*übersprungen/, (baum) => {
    const voll = baumBauen(tmp, 'd-voll', ganz);
    messlisteErzeugen(voll);
    copyFileSync(liste(voll), liste(baum));
  });
  // (e) gültiger Ersatz mit anderem Hash
  zustand('e', { [modelle[0].quelle]: exportGlb('Flowers_A 1', 9), [modelle[1].quelle]: gut[1], [modelle[2].quelle]: gut[2] }, ['fern-1a1.glb', 'flower-1a12.glb'], /Messliste weicht ab.*per PR/s, (baum) => {
    const voll = baumBauen(tmp, 'e-voll', ganz);
    messlisteErzeugen(voll);
    copyFileSync(liste(voll), liste(baum));
  });
  // (f) leer
  zustand('f', {}, [], /flower-1a4\.glb fehlt/);

  check('Messliste des Arbeitsbaums bleibt unangetastet', sha(join(WURZEL, 'tools/store-lab-katalog.json')) === echt);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) rot`);
  process.exit(1);
}
console.log('\nstore-lab-rollout: alles grün');
