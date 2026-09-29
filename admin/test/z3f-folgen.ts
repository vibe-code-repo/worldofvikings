/**
 * Karte Z3 Folgen (Betriebsdienst): F1, F2, F3 und C2 über den ECHTEN `admin/src/main.ts`-Kindprozess (systemctl-Stand-in,
 * Muster `testwelt-einstellungen.ts` [9]) bzw. den echten `anwendungAnhaengen`.
 *
 *  F1  `POST /api/welt/bestaetigen` nimmt die gemeinsame Serversperre: Kommt die Bestätigung in der Startphase von "zurück"
 *      (nach den Umbenennungen, vor dem Boot), antwortet die Route 409 `aktion-laeuft` und schreibt KEINE Anfrage an den
 *      dev-Ladeort; danach (Sperre wieder frei) antwortet sie normal (409 `nichts-offen` ohne Sperrdatei).
 *  F2  "starten" ohne dev-Spielstand meldet nicht "Testwelt gestartet", wenn `aktiv=false` ist.
 *  F3  Ein `.beiseite` der Anfrage bei "zurück": nur eine lesbare Anfrage mit passendem Hash kommt zurück, ein Rest
 *      (unlesbar, überholter Stand) wird verworfen.
 *  C2  Speichern ohne Änderung (`unveraendert`) meldet die offene Sperre.
 *
 * Lauf: npx tsx test/z3f-folgen.ts   (aus admin/)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutDateiHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungSchreiben } from '@wov/shared/src/worldlayout/quittung.js';
import { anwendungAnhaengen } from '../src/routen/anwendung.js';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WURZEL_PROJEKT = resolve(ADMIN, '..');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}`);
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Antwort = { code: number; daten: Record<string, unknown> };

const ORDNER = mkdtempSync(resolve(tmpdir(), 'z3f-folgen-admin-'));
const WORLDS = resolve(ORDNER, 'server/data/worlds');
const WELTEN = resolve(ORDNER, 'server/data/welten');
const FAKE = resolve(ORDNER, 'fake');
const TOKEN = 'z3f-token';
for (const d of [WORLDS, WELTEN, FAKE]) mkdirSync(d, { recursive: true });
writeFileSync(resolve(ORDNER, 'token'), `${TOKEN}\n`);
const LAYOUT = resolve(WELTEN, 'dev.json');
writeFileSync(LAYOUT, JSON.stringify({ version: 1, regions: [], placements: [] }));
const SC = resolve(FAKE, 'systemctl');
writeFileSync(
  SC,
  `#!/bin/sh
D="${FAKE}"
echo "$1 $2" >> "$D/log"
case "$1" in
  show) if [ -f "$D/aktiv" ]; then echo "ActiveState=active"; else echo "ActiveState=inactive"; fi ;;
  start) [ -f "$D/langsamstart" ] && sleep 1.5; touch "$D/aktiv" ;;
  stop) rm -f "$D/aktiv" ;;
esac
exit 0
`
);
chmodSync(SC, 0o755);

function anfrage(port: number, pfad: string, methode = 'GET', leib?: unknown): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const text = leib === undefined ? undefined : JSON.stringify(leib);
    const kopf: Record<string, string> = { 'x-wov-token': TOKEN };
    if (text !== undefined) {
      kopf['content-type'] = 'application/json';
      kopf['content-length'] = String(Buffer.byteLength(text));
    }
    const req = request({ host: '127.0.0.1', port, path: pfad, method: methode, headers: kopf }, (res: IncomingMessage) => {
      let t = '';
      res.setEncoding('utf-8');
      res.on('data', (s: string) => (t += s));
      res.on('end', () => {
        let d: Record<string, unknown> = {};
        try {
          d = JSON.parse(t);
        } catch {
          /* leer */
        }
        fertig({ code: res.statusCode ?? 0, daten: d });
      });
    });
    req.on('error', scheitern);
    if (text !== undefined) req.write(text);
    req.end();
  });
}

let kind: ChildProcess | undefined;
async function c2(): Promise<void> {
  const q = resolve(ORDNER, 'quittung.json');
  const hash = 'h-gleich';
  quittungSchreiben(q, { hash, ergebnis: 'angewendet', grund: null, loeschsperre: { anzahl: 3, hash }, zaehler: { gespawnt: 2 }, zeit: new Date().toISOString() });
  const antwort = await anwendungAnhaengen({ code: 200, daten: { ok: true, hash } }, { quittungsPfad: q, dienstAktiv: async () => true, vorherHash: hash, warteMs: 500 });
  const d = antwort.daten as { unveraendert?: boolean; loeschsperre?: { anzahl: number } };
  check('C2 Speichern ohne Änderung: 200 unveraendert MIT offener Sperre (3)', antwort.code === 200 && d.unveraendert === true && d.loeschsperre?.anzahl === 3, JSON.stringify(antwort.daten));
  quittungSchreiben(q, { hash, ergebnis: 'angewendet', grund: null, zaehler: { gespawnt: 2 }, zeit: new Date().toISOString() });
  const ohne = await anwendungAnhaengen({ code: 200, daten: { ok: true, hash } }, { quittungsPfad: q, dienstAktiv: async () => true, vorherHash: hash, warteMs: 500 });
  check('C2 ohne offene Sperre: kein loeschsperre-Feld', (ohne.daten as { loeschsperre?: unknown }).loeschsperre === undefined);
}

async function main(): Promise<void> {
  let ausgabe = '';
  const port = await new Promise<number>((fertig, scheitern) => {
    const k = spawn(resolve(WURZEL_PROJEKT, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_WELT_VERZEICHNIS: WELTEN,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_QUITTUNG: 'aus',
        NODE_ENV: 'test',
        WOV_ADMIN_TOKEN_DATEI: resolve(ORDNER, 'token'),
        WOV_SYSTEMCTL: SC,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    kind = k;
    const zg = setTimeout(() => scheitern(new Error(ausgabe)), 30_000);
    k.stdout!.on('data', (s: Buffer) => {
      ausgabe += s;
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(ausgabe);
      if (t) {
        clearTimeout(zg);
        fertig(Number(t[1]));
      }
    });
    k.stderr!.on('data', (s: Buffer) => (ausgabe += s));
  });
  const tw = (a: string): Promise<Antwort> => anfrage(port, '/api/testwelt', 'POST', { aktion: a });
  const H = layoutDateiHash(LAYOUT)!;
  const best = (): Promise<Antwort> => anfrage(port, '/api/welt/bestaetigen', 'POST', { hash: H });
  const welt = resolve(WORLDS, 'dev.db.zst');
  const sperre = resolve(WORLDS, 'layout-loeschsperre.dev.json');
  const bitte = resolve(WORLDS, 'layout-bestaetigen.dev.json');
  const DEV = JSON.stringify({ ids: ['t0', 't1'], hash: H, grund: 'anteil', zeit: '2026-09-29T00:00:00.000Z' });
  const TEST = JSON.stringify({ ids: ['neukiste'], hash: H, grund: 'zustand', zeit: '2026-09-29T01:00:00.000Z' });
  const lies = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf-8') : null);
  const alle = [welt, `${welt}.beiseite`, `${welt}.prev`, `${welt}.prev.beiseite`, sperre, `${sperre}.beiseite`, `${sperre}.testwelt`, bitte, `${bitte}.beiseite`, `${bitte}.testwelt`, resolve(WORLDS, 'testwelt.db.zst')];
  const reset = (): void => {
    for (const f of alle) rmSync(f, { recursive: true, force: true });
    rmSync(resolve(FAKE, 'langsamstart'), { force: true });
  };

  // ── F1: Bestätigung in der Startphase von "zurück" ──
  reset();
  writeFileSync(welt, 'dev');
  writeFileSync(sperre, DEV);
  await tw('starten');
  writeFileSync(welt, 'test');
  writeFileSync(sperre, TEST);
  writeFileSync(resolve(FAKE, 'langsamstart'), '');
  const lauf = tw('zurueck');
  await warte(500);
  const b = await best();
  const z = await lauf;
  rmSync(resolve(FAKE, 'langsamstart'));
  check('F1 zurück läuft durch (200)', z.code === 200, `${z.code}`);
  check('F1 Bestätigung in der Startphase: 409 aktion-laeuft', b.code === 409 && b.daten.fehler === 'aktion-laeuft', `${b.code} ${JSON.stringify(b.daten)}`);
  check('F1 KEINE Anfrage am dev-Ladeort', !existsSync(bitte) && !existsSync(`${bitte}.testwelt`), `ladeort=${existsSync(bitte)}`);
  check('F1 dev-Sperre liegt byte-gleich am Ladeort', lies(sperre) === DEV);
  const danach = await best();
  check('F1 danach ist die Serversperre frei: normale Antwort (202: dev-Sperre liegt, Anfrage geschrieben; nicht aktion-laeuft)', danach.code === 202 && danach.daten.fehler !== 'aktion-laeuft', `${danach.code} ${JSON.stringify(danach.daten)}`);
  const nochmal = await tw('starten');
  check('F1 die Sperre wurde freigegeben: ein folgendes /api/testwelt geht durch (200)', nochmal.code === 200, `${nochmal.code}`);

  // ── F2: starten ohne dev-Spielstand ──
  reset();
  const s2 = await tw('starten');
  check('F2 starten ohne dev-Spielstand: 200, aktiv=false', s2.code === 200 && s2.daten.aktiv === false, JSON.stringify(s2.daten));
  check('F2 die Meldung behauptet KEINE gestartete Testwelt', !/Testwelt gestartet/.test(String(s2.daten.message)) && /keine Testwelt aktiv/.test(String(s2.daten.message)), String(s2.daten.message));
  reset();
  writeFileSync(welt, 'dev');
  const s2b = await tw('starten');
  check('F2 mit dev-Spielstand bleibt es bei "Testwelt gestartet" (aktiv=true)', s2b.code === 200 && s2b.daten.aktiv === true && /Testwelt gestartet/.test(String(s2b.daten.message)), JSON.stringify(s2b.daten));

  // ── F3: Rest .beiseite der Anfrage bei "zurück" ──
  const DEV_BITTE = JSON.stringify({ hash: H, zeit: '2026-09-29T00:00:00.000Z', id: 'dev-anfrage' });
  for (const [name, inhalt, erwartetZurueck] of [
    ['passender Hash', DEV_BITTE, true],
    ['überholter Hash', JSON.stringify({ hash: 'ueberholt', zeit: 'z', id: 'alt-rest' }), false],
    ['unlesbar', '{kaputt', false],
  ] as const) {
    reset();
    writeFileSync(welt, 'dev');
    await tw('starten'); // legt den Spielstand beiseite; eine dev-Anfrage gab es nicht
    writeFileSync(`${bitte}.beiseite`, inhalt); // Rest von Hand / aus einem abgebrochenen Wechsel
    const zr = await tw('zurueck');
    check(`F3 ${name}: zurück → 200`, zr.code === 200, `${zr.code}`);
    if (erwartetZurueck) check(`F3 ${name}: die Anfrage liegt byte-gleich am dev-Ladeort`, lies(bitte) === inhalt && !existsSync(`${bitte}.beiseite`));
    else check(`F3 ${name}: verworfen — weder am Ladeort noch als .beiseite`, !existsSync(bitte) && !existsSync(`${bitte}.beiseite`));
  }
  await c2();
}

try {
  await main();
} catch (e) {
  fehler++;
  console.error('FAIL Lauf abgebrochen:', (e as Error).message);
} finally {
  kind?.kill('SIGTERM');
  await warte(200);
  rmSync(ORDNER, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
