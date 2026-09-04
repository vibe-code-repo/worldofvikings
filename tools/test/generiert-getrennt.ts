/**
 * E7 — `assets/generiert/` ist ein SCHWESTERORDNER, kein Unterordner.
 *
 * ── Was hier auf dem Spiel steht ─────────────────────────────────────
 * Unter `assets/` ist genau eine Datei git-getrackt: `assets/manifest.
 * json` (`.gitignore`, Ausnahme mit eigener Begründung). Zwei Werkzeuge
 * hängen daran, und beide laufen rekursiv über `assets/models/`:
 * `tools/asset-manifest.mjs` schreibt das Manifest aus dem
 * Plattenbestand, `tools/test/manifest-vollstaendig.ts` macht jede GLB
 * ohne Eintrag zum Fehlschlag.
 *
 * Legte der Spielserver seine gebauten Säle also nach `assets/models/`,
 * hätte jeder Klick im Editor zwei Folgen: der Testlauf würde rot, und
 * auf jeder Maschine mit Modellen stünde eine ungetrackte Änderung an
 * einer GETRACKTEN Datei — die das nächste `git pull` in
 * `tools/wov-update.sh` blockiert. Auf einem Server, der sich selbst
 * aktualisiert, fällt das erst auf, wenn die Aktualisierung ausbleibt.
 *
 * ── Warum das trotzdem geprüft wird, obwohl es heute stimmt ──────────
 * Die Trennung ist heute keine Regel, sondern ein Zufall der Pfade:
 * beide Werkzeuge wurzeln in `assets/models`, und `generiert/` liegt
 * daneben. Ein Zufall hat keine Bruchstelle, an der ein Test anschlägt —
 * wer den Erzeuger morgen auf `assets/` wurzeln lässt (um „auch die
 * Texturen mitzunehmen"), bekommt von keinem bestehenden Test ein Wort
 * dazu. Dieser Test legt deshalb eine echte GLB dorthin, wo der Server
 * sie ablegen wird, und lässt BEIDE Werkzeuge im Original laufen: Was
 * sie danach sagen, muss Zeichen für Zeichen dasselbe sein wie vorher.
 *
 * Der Vergleich ist bewusst „gleich wie vorher" und nicht „grün": In
 * einem Arbeitsbaum, dessen `assets/models` nur einen Ausschnitt des
 * Bestandes trägt, ist `manifest-vollstaendig.ts` schon vorher rot. Das
 * ist eine Aussage über den Plattenbestand, nicht über `generiert/` —
 * und ein Test, der daran hängen bliebe, prüfte den Umfang des
 * Checkouts statt den Quelltext (dieselbe Falle, die der Kopf von
 * `manifest-vollstaendig.ts` schon einmal beschreibt).
 *
 * Lauf:  npx tsx tools/test/generiert-getrennt.ts
 *
 * A dummy GLB in assets/generiert/ must change nothing: same manifest
 * bytes, same completeness-test output, clean `git status assets/`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHall } from '@wov/shared/src/hallenGeometrie.js';
import { encodeGlb } from '../../server/src/world/dungeon/GlbWriter.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const ASSETS = join(WURZEL, 'assets');
const MODELLE_DIR = join(ASSETS, 'models');
const GENERIERT_DIR = join(ASSETS, 'generiert');
const TSX = join(WURZEL, 'node_modules', '.bin', 'tsx');

/**
 * Der Name trägt das `Gen_`-Präfix, weil er sonst nicht der Fall wäre,
 * um den es geht — der AssetManager wählt an genau diesem Präfix die
 * zweite Basis-URL (`client/src/engine/AssetManager.ts`).
 */
const ATTRAPPE = 'Gen_StoneVaultHall2x2Attrappe';

let fehler = 0;
function pruefe(bedingung: boolean, was: string, detail = ''): void {
  if (bedingung) {
    console.log(`  OK   ${was}`);
  } else {
    fehler++;
    console.error(`  ROT  ${was}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Lauf {
  readonly code: number;
  readonly ausgabe: string;
}

function laufe(datei: string, ...args: string[]): Lauf {
  const r = spawnSync(TSX, [datei, ...args], { cwd: WURZEL, encoding: 'utf8' });
  return { code: r.status ?? -1, ausgabe: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Das Manifest ohne seinen Zeitstempel — der ändert sich je Lauf. */
function ohneZeitstempel(pfad: string): string {
  const m = JSON.parse(readFileSync(pfad, 'utf8')) as Record<string, unknown>;
  delete m.erzeugt;
  return JSON.stringify(m);
}

function git(...args: string[]): { code: number; aus: string } {
  const r = spawnSync('git', args, { cwd: WURZEL, encoding: 'utf8' });
  return { code: r.status ?? -1, aus: (r.stdout ?? '').trim() };
}

function main(): void {
  console.log('\nE7 — assets/generiert/ bleibt für die Manifest-Werkzeuge unsichtbar\n');

  if (!existsSync(MODELLE_DIR)) {
    console.log(`ÜBERSPRUNGEN: ${MODELLE_DIR} fehlt — assets/ liegt ausserhalb des Repos.`);
    process.exit(0);
  }

  const glbPfad = join(GENERIERT_DIR, `${ATTRAPPE}.glb`);
  if (existsSync(glbPfad)) {
    // Eine fremde Datei gleichen Namens würde am Ende weggeräumt.
    console.error(`ROT: ${glbPfad} existiert bereits — der Test räumt nur seine eigene Attrappe weg.`);
    process.exit(1);
  }

  const ordnerWarDa = existsSync(GENERIERT_DIR);
  const tmp = mkdtempSync(join(tmpdir(), 'wov-e7-manifest-'));
  const vorherJson = join(tmp, 'vorher.json');
  const nachherJson = join(tmp, 'nachher.json');

  try {
    // ── Vorher ────────────────────────────────────────────────────────
    const vollstVorher = laufe('tools/test/manifest-vollstaendig.ts');
    const erzVorher = laufe('tools/asset-manifest.mjs', '--ziel', vorherJson);
    if (erzVorher.code !== 0) {
      console.error(`ROT: tools/asset-manifest.mjs scheiterte:\n${erzVorher.ausgabe}`);
      process.exit(1);
    }

    // ── Die Attrappe an den echten Zielort ────────────────────────────
    mkdirSync(GENERIERT_DIR, { recursive: true });
    const saal = buildHall(2, 2, {});
    writeFileSync(glbPfad, encodeGlb(saal.boxes, { name: ATTRAPPE }));
    console.log(
      `  Attrappe: assets/generiert/${ATTRAPPE}.glb, ` +
        `${saal.boxes.length} Quader, ${12 * saal.boxes.length} Dreiecke`
    );

    // ── Nachher ───────────────────────────────────────────────────────
    const vollstNachher = laufe('tools/test/manifest-vollstaendig.ts');
    const erzNachher = laufe('tools/asset-manifest.mjs', '--ziel', nachherJson);

    const anzahl = (JSON.parse(readFileSync(nachherJson, 'utf8')) as { anzahl: number }).anzahl;
    console.log(
      `  manifest-vollstaendig: Rückgabe ${vollstVorher.code} → ${vollstNachher.code}; ` +
        `asset-manifest zählt ${anzahl} Modelle`
    );

    pruefe(
      erzNachher.code === 0,
      'tools/asset-manifest.mjs läuft mit der Attrappe durch'
    );
    pruefe(
      ohneZeitstempel(vorherJson) === ohneZeitstempel(nachherJson),
      'das erzeugte Manifest ist Zeichen für Zeichen dasselbe'
    );
    pruefe(
      vollstVorher.code === vollstNachher.code && vollstVorher.ausgabe === vollstNachher.ausgabe,
      'tools/test/manifest-vollstaendig.ts sagt unverändert dasselbe'
    );

    // ── git sieht die Attrappe nicht ──────────────────────────────────
    if (git('rev-parse', '--is-inside-work-tree').code !== 0) {
      console.log('  ÜBERSPRUNGEN: kein git-Arbeitsbaum — die beiden git-Proben entfallen.');
    } else {
      const ignoriert = git('check-ignore', `assets/generiert/${ATTRAPPE}.glb`);
      pruefe(ignoriert.code === 0, '.gitignore deckt assets/generiert/ ab', ignoriert.aus);
      const status = git('status', '--porcelain', 'assets/');
      pruefe(status.aus === '', '`git status --porcelain assets/` ist leer', status.aus);
    }
  } finally {
    rmSync(glbPfad, { force: true });
    // Nur den Ordner wegräumen, den dieser Test angelegt hat — und nur,
    // wenn er leer ist: auf wov-dev liegen dort echte Säle.
    if (!ordnerWarDa) {
      try {
        rmdirSync(GENERIERT_DIR);
      } catch {
        /* nicht leer — dann gehört er jemand anderem. */
      }
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(fehler === 0 ? '\nE7-Trennung: alles grün.\n' : `\nE7-Trennung: ${fehler} ROT.\n`);
  process.exit(fehler > 0 ? 1 : 0);
}

main();
