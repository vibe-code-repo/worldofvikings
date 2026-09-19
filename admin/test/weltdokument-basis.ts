/**
 * Basisversion des Weltdokuments (Editor E0, Karte K0.2): ETag / If-Match /
 * 409 / 422, und die Sperre, die das über Prozessgrenzen hält.
 *
 *   npx tsx test/weltdokument-basis.ts      (aus admin/)
 *
 * Fährt den ECHTEN Betriebsdienst (wie betriebsdienst.ts) gegen eine Kopie
 * der Welt in einem Temp-Verzeichnis — nie gegen server/data/welten/. Port:
 * frei vergeben (WOV_ADMIN_PORT=0); mit WOV_TEST_ADMIN_PORT=<n> lässt sich
 * ein fester Slot-Port erzwingen.
 *
 * ── Warum zwei Werkzeugprozesse ──────────────────────────────────────
 * Der Betriebsdienst ist EIN Prozess und arbeitet Anfragen nacheinander ab;
 * ein Wettlauf zwischen zwei HTTP-Clients beweist deshalb nur die
 * Basisprüfung, nicht die Sperre. Die Sperre schützt gegen einen ZWEITEN
 * Prozess auf derselben Datei (früher: der MCP-Server). Das prüfen die
 * Abschnitte „direkt" und „Betriebsdienst gegen Fremdprozess": Zwei Prozesse
 * starten auf die Millisekunde gleichzeitig und schreiben mit derselben
 * Basis — je Runde darf genau EINER gewinnen.
 *
 * ── Nachbesserung (nach dem Angriff auf f728141) ─────────────────────
 * Abschnitte 14–20: Ein langsamer Schreiber zwischen Besitzprüfung und rename
 * (die Verzögerung sitzt im Werkzeugprozess), kill -9 zwischen Sperre und
 * rename, die Ereignisschleife des Betriebsdienstes während eine fremde Sperre
 * gehalten wird, wann eine Sperre gebrochen wird (tot / lebt / pid
 * wiederverwendet / anderer Rechner / ohne Besitzangabe), zwei Wartende am
 * selben toten Sperrschloss, eindeutige .bak-Namen, alte Tmp-Schemata; dazu
 * 8b: ein Listenfeld, das kein Array ist, gibt 422 statt eines stillen Verlusts.
 *
 * Der Test bezieht neue Exporte nicht statisch aus layoutDatei.ts (Fehler
 * werden am Namen erkannt, der Hash mit node:crypto gebildet), damit er auf
 * dem Stand VOR der Änderung an einer Behauptung scheitert statt an einem
 * fehlenden Import.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os, { hostname, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import { layoutSchreiben, layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const WURZEL = resolve(ADMIN, '..');
const TSX = resolve(WURZEL, 'node_modules/.bin/tsx');

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Ein Dokument, das der Sanitizer unverändert lässt; `name` macht jeden Schreiber erkennbar. */
function koerper(name: string, platzierungen = 1): Record<string, unknown> {
  return {
    version: 1,
    name,
    detailSeed: 'basis',
    continents: [{ id: 'nord', name: 'Nordland', faction: 'viking' }],
    regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1200 }, edgeFalloff: 300 }],
    placements: Array.from({ length: platzierungen }, (_, i) => ({ prefab: 'Beech1', x: i, z: 0 })),
  };
}
const sollText = (d: Record<string, unknown>): string => layoutText(sanitizeWorldLayout(d)!);

// ══ Werkzeugprozess ═══════════════════════════════════════════════════
// Dieselbe Datei als Unterprozess: liest Befehle (eine JSON-Zeile) von stdin,
// wartet bis `startAt`, tut sein Werk, antwortet mit einer JSON-Zeile.

async function werker(): Promise<void> {
  const zeilen = createInterface({ input: process.stdin });
  console.log('bereit');
  for await (const zeile of zeilen) {
    const b = JSON.parse(zeile) as {
      cmd: 'direkt' | 'http' | 'ende';
      pfad?: string;
      basis?: string | null;
      startAt?: number;
      anzahl?: number;
      tag?: string;
      port?: number;
      token?: string;
      /** renameSync auf `pfad` um so viele ms verzögern (der Schreiber steht dann in der Sperre). */
      pausiereVorRenameMs?: number;
      /** Datei, die der Schreiber anlegt (Inhalt: seine pid), sobald er in der Pause steht. */
      markerPfad?: string;
      /** renameSync der Sperrdatei (= der Bruch einer Sperre) um so viele ms verzögern. */
      pausiereVorSperrbruchMs?: number;
      /** linkSync scheitern lassen (Dateisystem ohne harte Links): das Zurücklegen einer Sperre misslingt. */
      linkScheitert?: boolean;
      /** Im Werkzeugprozess einen fremden Rechnernamen vortäuschen (die Sperre trägt ihn dann). */
      fremderHost?: string;
      /** Im Werkzeugprozess /proc unlesbar machen (die Sperre trägt dann keine Startzeit). */
      ohneProc?: boolean;
      sperreWartenMs?: number;
      sperreVeraltetMs?: number;
    };
    if (b.cmd === 'ende') return;
    while (Date.now() < (b.startAt ?? 0)) {
      /* aufeinander warten: alle starten in derselben Millisekunde */
    }
    if (b.cmd === 'direkt') {
      let ok = 0;
      let veraltet = 0;
      const andere: string[] = [];
      const erfolge: string[] = [];
      const hashes: string[] = [];
      // Die Verzögerung sitzt im WERKZEUGPROZESS (renameSync wird ersetzt), nicht im Code unter
      // Test: So läuft dieselbe Probe auch gegen einen Stand, der davon nichts weiß.
      const echtesRename = fs.renameSync;
      const echtesLink = fs.linkSync;
      const echterHost = os.hostname;
      const echtesRead = fs.readFileSync;
      if (b.fremderHost) {
        (os as { hostname: () => string }).hostname = () => b.fremderHost!;
        syncBuiltinESMExports();
      }
      if (b.ohneProc) {
        (fs as { readFileSync: unknown }).readFileSync = ((p: unknown, ...rest: unknown[]) => {
          if (typeof p === 'string' && p.startsWith('/proc/')) throw Object.assign(new Error('ENOENT: simulated, no /proc'), { code: 'ENOENT' });
          return (echtesRead as (...a: unknown[]) => unknown)(p, ...rest);
        }) as unknown;
        syncBuiltinESMExports();
      }
      const warteHier = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      if (b.pausiereVorRenameMs || b.pausiereVorSperrbruchMs || b.linkScheitert) {
        (fs as { renameSync: typeof echtesRename }).renameSync = ((von: string, nach: string) => {
          if (b.pausiereVorRenameMs && nach === b.pfad) {
            if (b.markerPfad) writeFileSync(b.markerPfad, String(process.pid));
            warteHier(b.pausiereVorRenameMs);
          }
          if (b.pausiereVorSperrbruchMs && von === `${b.pfad}.lock`) warteHier(b.pausiereVorSperrbruchMs);
          return echtesRename(von, nach);
        }) as typeof echtesRename;
        if (b.linkScheitert) {
          (fs as { linkSync: typeof echtesLink }).linkSync = (() => {
            throw Object.assign(new Error('EPERM: simulated, no hard links'), { code: 'EPERM' });
          }) as typeof echtesLink;
        }
        syncBuiltinESMExports();
      }
      for (let i = 0; i < (b.anzahl ?? 1); i++) {
        const name = `${b.tag}-${i}`;
        try {
          const r = layoutSchreiben(b.pfad!, koerper(name), undefined, {
            basis: b.basis ?? null,
            sperreWartenMs: b.sperreWartenMs,
            sperreVeraltetMs: b.sperreVeraltetMs,
          });
          ok++;
          erfolge.push(name);
          hashes.push((r as { hash?: string }).hash ?? '');
        } catch (f) {
          if ((f as Error).name === 'LayoutVeraltet') veraltet++;
          else andere.push(`${(f as Error).name}: ${(f as Error).message}`);
        }
      }
      (fs as { renameSync: typeof echtesRename }).renameSync = echtesRename;
      (fs as { linkSync: typeof echtesLink }).linkSync = echtesLink;
      (os as { hostname: () => string }).hostname = echterHost;
      (fs as { readFileSync: unknown }).readFileSync = echtesRead;
      syncBuiltinESMExports();
      console.log(JSON.stringify({ ok, veraltet, andere, erfolge, hashes }));
    } else {
      const antworten = await Promise.all(
        Array.from({ length: b.anzahl ?? 1 }, async (_, i) => {
          const name = `${b.tag}-${i}`;
          const r = await fetch(`http://127.0.0.1:${b.port}/api/worldlayout`, {
            method: 'POST',
            headers: { 'x-wov-token': b.token!, 'if-match': `"${b.basis}"`, 'content-type': 'application/json' },
            body: JSON.stringify(koerper(name)),
          });
          const d = (await r.json()) as Record<string, unknown>;
          return { name, status: r.status, hash: d.hash, aktuell: d.aktuell };
        })
      );
      console.log(JSON.stringify({ antworten }));
    }
  }
}

if (process.argv[2] === 'werker') {
  await werker();
  process.exit(0);
}

// ══ Prüfstand ═════════════════════════════════════════════════════════

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-weltdokument-basis-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const TOKEN = 'basis-token-4711';
const TOKEN_DATEI = resolve(ORDNER, 'token');
mkdirSync(WELTEN, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(WELT_DATEI, sollText(koerper('Ausgang')));

const platte = (): Buffer => readFileSync(WELT_DATEI);
const plattenHash = (): string => sha(platte());
const sicherungen = (): number => readdirSync(WELTEN).filter((f) => f.startsWith('dev.json.') && f.endsWith('.bak')).length;

let protokoll = '';
const kinder: ChildProcess[] = [];

function dienstStarten(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: process.env.WOV_TEST_ADMIN_PORT ?? '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    kinder.push(kind);
    const zeitgrenze = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${protokoll}`)), 30_000);
    const auf = (s: Buffer): void => {
      protokoll += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(protokoll);
      if (t) {
        clearTimeout(zeitgrenze);
        fertig(Number(t[1]));
      }
    };
    kind.stdout.on('data', auf);
    kind.stderr.on('data', auf);
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Dienst beendet mit ${code}:\n${protokoll}`));
    });
  });
}

interface Werker {
  kind: ChildProcess;
  fragen(befehl: Record<string, unknown>): Promise<Record<string, unknown>>;
}
function werkerStarten(): Promise<Werker> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(TSX, [fileURLToPath(import.meta.url), 'werker'], { cwd: ADMIN, stdio: ['pipe', 'pipe', 'inherit'] });
    kinder.push(kind);
    const zeilen = createInterface({ input: kind.stdout! });
    const warteschlange: Array<(z: string) => void> = [];
    let bereit = false;
    zeilen.on('line', (z) => {
      if (!bereit) {
        bereit = true;
        fertig({
          kind,
          fragen: (befehl) =>
            new Promise((f) => {
              warteschlange.push((antwort) => f(JSON.parse(antwort) as Record<string, unknown>));
              kind.stdin!.write(`${JSON.stringify(befehl)}\n`);
            }),
        });
      } else warteschlange.shift()?.(z);
    });
    kind.on('exit', () => scheitern(new Error('Werkzeugprozess beendet')));
  });
}

const port = await dienstStarten();
const BASIS = `http://127.0.0.1:${port}/api/worldlayout`;
console.log(`# Betriebsdienst auf 127.0.0.1:${port}, Wurzel ${ORDNER}`);

async function anfrage(
  methode: 'GET' | 'POST',
  opt: { leib?: unknown; ifMatch?: string } = {}
): Promise<{ status: number; kopf: Headers; daten: Record<string, unknown> }> {
  const r = await fetch(BASIS, {
    method: methode,
    headers: {
      'x-wov-token': TOKEN,
      ...(opt.ifMatch !== undefined ? { 'if-match': opt.ifMatch } : {}),
      ...(opt.leib !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opt.leib !== undefined ? JSON.stringify(opt.leib) : undefined,
  });
  return { status: r.status, kopf: r.headers, daten: (await r.json()) as Record<string, unknown> };
}
const warte = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));
const holeHash = async (): Promise<string> => String((await anfrage('GET')).daten.hash);

try {
  // ── 1) GET: ETag und hash ───────────────────────────────────────────
  const g = await anfrage('GET');
  const h0 = plattenHash();
  check('GET → 200', g.status === 200, `= ${g.status}`);
  check('GET: Rumpf.hash = sha256 der Plattenbytes', g.daten.hash === h0, `${String(g.daten.hash)} ≠ ${h0}`);
  check('GET: Kopf ETag = "<hash>"', g.kopf.get('etag') === `"${h0}"`, `= ${g.kopf.get('etag')}`);
  check('GET: hash ist 64 Zeichen Hex, klein', /^[0-9a-f]{64}$/.test(String(g.daten.hash)));
  check(
    'GET: bestehende Felder unverändert',
    g.daten.ok === true &&
      g.daten.instanz === 'dev' &&
      g.daten.datei === 'dev.json' &&
      typeof g.daten.message === 'string' &&
      layoutText(g.daten.layout as WorldLayout) === platte().toString('utf-8')
  );

  // ── 2) Ohne Basis: angenommen, laut, vermerkt ───────────────────────
  const ohne = await anfrage('POST', { leib: koerper('ohne-basis') });
  check('ohne Basis → 200', ohne.status === 200, `= ${ohne.status}`);
  check('ohne Basis: ohneBasis === true', ohne.daten.ohneBasis === true);
  await warte(150); // die Logzeile läuft über eine Pipe und kann der Antwort um einen Takt hinterherkommen
  check('ohne Basis: Logzeile im Betriebsdienst', /OHNE Basis/.test(protokoll));
  check('ohne Basis: Datei = Sanitizer-Ergebnis', platte().toString('utf-8') === sollText(koerper('ohne-basis')));
  check('ohne Basis: hash in der Antwort = Plattenhash', ohne.daten.hash === plattenHash());

  // ── 3) If-Match richtig → 200, neuer hash, ETag ─────────────────────
  const hA = await holeHash();
  const bakA = sicherungen();
  const ok = await anfrage('POST', { leib: koerper('mit-ifmatch'), ifMatch: `"${hA}"` });
  check('If-Match passt → 200', ok.status === 200, `= ${ok.status} ${JSON.stringify(ok.daten)}`);
  check('Erfolg: hash = sha256 der neuen Plattenbytes', ok.daten.hash === plattenHash());
  check('Erfolg: hash ≠ Basis (Datei hat sich geändert)', ok.daten.hash !== hA);
  check('Erfolg: Kopf ETag = "<neuer hash>"', ok.kopf.get('etag') === `"${plattenHash()}"`);
  check('Erfolg: kein ohneBasis-Vermerk', ok.daten.ohneBasis === undefined);
  check('Erfolg: genau eine .bak mehr', sicherungen() === bakA + 1, `${bakA} → ${sicherungen()}`);
  check('Erfolg: Datei bytegleich zum Sanitizer', platte().toString('utf-8') === sollText(koerper('mit-ifmatch')));

  // ── 4) Veraltete Basis → 409, Datei unberührt ───────────────────────
  const vorher = plattenHash();
  const bakV = sicherungen();
  const alt = await anfrage('POST', { leib: koerper('veraltet'), ifMatch: `"${hA}"` });
  check('veraltete Basis (If-Match) → 409', alt.status === 409, `= ${alt.status}`);
  check('409: fehler = "veraltet"', alt.daten.fehler === 'veraltet');
  check('409: aktuell = Hash der Datei jetzt', alt.daten.aktuell === vorher, `= ${String(alt.daten.aktuell)}`);
  check('409: Datei unverändert (Prüfsumme vorher = nachher)', plattenHash() === vorher);
  check('409: keine Sicherung angelegt', sicherungen() === bakV);
  const altRumpf = await anfrage('POST', { leib: { ...koerper('veraltet2'), basis: hA } });
  check('veraltete Basis (Rumpffeld) → 409', altRumpf.status === 409 && altRumpf.daten.aktuell === vorher);
  check('409 (Rumpffeld): Datei unverändert', plattenHash() === vorher);

  // ── 5) Rumpffeld richtig; basis landet nicht in der Datei ───────────
  const rumpfOk = await anfrage('POST', { leib: { ...koerper('rumpf-basis'), basis: vorher } });
  check('Rumpffeld basis passt → 200', rumpfOk.status === 200, `= ${rumpfOk.status}`);
  check('basis wird nicht ins Dokument geschrieben', !/"basis":/.test(platte().toString('utf-8')));
  check('Rumpffeld: Datei = Sanitizer-Ergebnis des Dokuments ohne basis', platte().toString('utf-8') === sollText(koerper('rumpf-basis')));

  // ── 6) Beides: der Kopf gewinnt ─────────────────────────────────────
  const hB = plattenHash();
  const kopfFalsch = await anfrage('POST', { leib: { ...koerper('kopf-falsch'), basis: hB }, ifMatch: `"${'0'.repeat(64)}"` });
  check('Kopf falsch + Rumpf richtig → 409 (Kopf gewinnt)', kopfFalsch.status === 409, `= ${kopfFalsch.status}`);
  check('Kopf gewinnt: Datei unverändert', plattenHash() === hB);
  const kopfRichtig = await anfrage('POST', { leib: { ...koerper('kopf-richtig'), basis: '0'.repeat(64) }, ifMatch: `"${hB}"` });
  check('Kopf richtig + Rumpf falsch → 200 (Kopf gewinnt)', kopfRichtig.status === 200, `= ${kopfRichtig.status}`);

  // ── 7) Basis, die keinen Stand eindeutig benennt, gilt nie ──────────
  const hC = plattenHash();
  const stern = await anfrage('POST', { leib: koerper('stern'), ifMatch: '*' });
  check('If-Match: * ist kein Freibrief → 409', stern.status === 409, `= ${stern.status}`);
  const leer = await anfrage('POST', { leib: { ...koerper('leer'), basis: '' } });
  check('leeres basis → 409', leer.status === 409, `= ${leer.status}`);
  const zahl = await anfrage('POST', { leib: { ...koerper('zahl'), basis: 42 } });
  check('basis kein Text → 400', zahl.status === 400, `= ${zahl.status}`);
  check('abgelehnte Basen lassen die Datei unberührt', plattenHash() === hC);

  // ── 8) 422: zu viele Platzierungen ──────────────────────────────────
  const hD = plattenHash();
  const bakD = sicherungen();
  const zuViele = await anfrage('POST', { leib: koerper('zu-viele', 2001), ifMatch: `"${hD}"` });
  check('2001 Platzierungen → 422', zuViele.status === 422, `= ${zuViele.status}`);
  check(
    '422: fehler/anzahl/grenze',
    zuViele.daten.fehler === 'zu-viele-platzierungen' && zuViele.daten.anzahl === 2001 && zuViele.daten.grenze === 2000,
    JSON.stringify(zuViele.daten)
  );
  check('422: Prüfsumme vorher = nachher', plattenHash() === hD);
  check('422: keine Sicherung angelegt', sicherungen() === bakD);
  await warte(150);
  check('422: Logzeile im Betriebsdienst', /422 zu-viele-platzierungen: 2001 > 2000/.test(protokoll));
  const muell = { ...koerper('muell'), placements: Array.from({ length: 2001 }, () => null) };
  const zuVieleMuell = await anfrage('POST', { leib: muell });
  check('gezählt VOR dem Sanitizer: 2001 Nullen → 422', zuVieleMuell.status === 422 && zuVieleMuell.daten.anzahl === 2001);
  check('422 (ohne Basis): Datei unverändert', plattenHash() === hD);
  const genau = await anfrage('POST', { leib: koerper('genau-2000', 2000), ifMatch: `"${hD}"` });
  check('genau 2000 Platzierungen → 200', genau.status === 200, `= ${genau.status}`);
  check(
    '2000 Platzierungen: alle 2000 stehen auf der Platte',
    (JSON.parse(platte().toString('utf-8')) as { placements: unknown[] }).placements.length === 2000
  );

  // ── 8b) B3: Listenfeld vorhanden, aber kein Array → 422, nichts geht still verloren ─
  {
    const hL = plattenHash();
    const bakL = sicherungen();
    for (const feld of ['placements', 'continents', 'routes', 'rivers', 'lakes']) {
      const r = await anfrage('POST', { leib: { ...koerper('feld-kaputt'), [feld]: { '0': { prefab: 'Beech1', x: 1, z: 2 } } }, ifMatch: `"${hL}"` });
      check(`${feld} als Objekt → 422 ungueltig`, r.status === 422 && r.daten.fehler === 'ungueltig' && r.daten.feld === feld && r.daten.ok === false && typeof r.daten.message === 'string', `= ${r.status} ${JSON.stringify(r.daten)}`);
    }
    for (const wert of ['text', 42, null, true]) {
      const r = await anfrage('POST', { leib: { ...koerper('feld-kaputt'), placements: wert } });
      check(`placements = ${JSON.stringify(wert)} → 422 ungueltig`, r.status === 422 && r.daten.feld === 'placements', `= ${r.status} ${JSON.stringify(r.daten)}`);
    }
    check('422 ungueltig: Prüfsumme vorher = nachher, keine Sicherung', plattenHash() === hL && sicherungen() === bakL);
    await warte(150);
    check('422 ungueltig: Logzeile im Betriebsdienst', /422 ungueltig: Feld "placements" ist vorhanden, aber keine Liste/.test(protokoll));
    const ohneFeld = await anfrage('POST', { leib: (({ placements: _p, ...rest }) => rest)(koerper('ohne-platzierungen')), ifMatch: `"${hL}"` });
    check('placements fehlt ganz → weiterhin 200 (kein Fehler, nur eine leere Liste)', ohneFeld.status === 200, `= ${ohneFeld.status}`);
    const hL2 = plattenHash();
    const regionenKaputt = await anfrage('POST', { leib: { ...koerper('regionen-kaputt'), regions: 'keine Liste' } });
    check('regions als Text → weiterhin 400 (Regel „keine Region“, bestehender Vertrag)', regionenKaputt.status === 400, `= ${regionenKaputt.status}`);
    check('… Datei unberührt', plattenHash() === hL2);
  }

  // ── 9) Wettlauf: zwei Prozesse, 20 POSTs, dieselbe Basis ────────────
  const [wa, wb] = await Promise.all([werkerStarten(), werkerStarten()]);
  // Die Rotation hält höchstens 10 Sicherungen; mit den Schreibvorgängen davor stünde der Zähler
  // schon an der Grenze, und „eine mehr“ wäre nicht mehr messbar. Ein frischer Anfang macht es messbar.
  for (const f of readdirSync(WELTEN)) if (f.startsWith('dev.json.') && f.endsWith('.bak')) rmSync(resolve(WELTEN, f));
  const hE = await holeHash();
  const bakE = sicherungen();
  const start = Date.now() + 300;
  const [ra, rb] = (await Promise.all([
    wa.fragen({ cmd: 'http', port, token: TOKEN, basis: hE, startAt: start, anzahl: 10, tag: 'A' }),
    wb.fragen({ cmd: 'http', port, token: TOKEN, basis: hE, startAt: start, anzahl: 10, tag: 'B' }),
  ])) as Array<{ antworten: Array<{ name: string; status: number; hash?: string; aktuell?: string }> }>;
  const alle = [...ra.antworten, ...rb.antworten];
  const gewinner = alle.filter((a) => a.status === 200);
  const verlierer = alle.filter((a) => a.status === 409);
  console.log(`# Wettlauf: ${gewinner.length} × 200, ${verlierer.length} × 409, Rest ${alle.length - gewinner.length - verlierer.length}`);
  check('Wettlauf: 20 Antworten', alle.length === 20);
  check('Wettlauf: genau 1 × 200', gewinner.length === 1, `= ${gewinner.length}`);
  check('Wettlauf: 19 × 409', verlierer.length === 19, `= ${verlierer.length}`);
  const sieger = gewinner[0]!;
  check('Wettlauf: Datei bytegleich mit dem Rumpf des Gewinners', platte().toString('utf-8') === sollText(koerper(sieger.name)), sieger.name);
  check('Wettlauf: Hash des Gewinners = Plattenhash', sieger.hash === plattenHash());
  check('Wettlauf: alle 409 nennen den Hash des Gewinners', verlierer.every((v) => v.aktuell === sieger.hash));
  check('Wettlauf: genau eine .bak mehr', sicherungen() === bakE + 1, `${bakE} → ${sicherungen()}`);
  check('Wettlauf: keine .tmp/.lock zurückgeblieben', !readdirSync(WELTEN).some((f) => f.endsWith('.tmp') || f.endsWith('.lock')));

  // ── 10) Direkt auf layoutSchreiben: zwei Prozesse, je 10 Versuche ───
  const DIREKT = resolve(ORDNER, 'direkt');
  mkdirSync(DIREKT, { recursive: true });
  const dPfad = resolve(DIREKT, 'welt.json');
  writeFileSync(dPfad, sollText(koerper('direkt-start')));
  const hF = sha(readFileSync(dPfad));
  const startD = Date.now() + 300;
  const [da, db] = (await Promise.all([
    wa.fragen({ cmd: 'direkt', pfad: dPfad, basis: hF, startAt: startD, anzahl: 10, tag: 'A' }),
    wb.fragen({ cmd: 'direkt', pfad: dPfad, basis: hF, startAt: startD, anzahl: 10, tag: 'B' }),
  ])) as Array<{ ok: number; veraltet: number; andere: string[]; erfolge: string[] }>;
  const erfolgeD = da.ok + db.ok;
  console.log(`# direkt: ${erfolgeD} Erfolg, ${da.veraltet + db.veraltet} veraltet, andere: ${JSON.stringify([...da.andere, ...db.andere])}`);
  check('direkt: 20 Versuche, genau 1 Erfolg', erfolgeD === 1, `= ${erfolgeD}`);
  check('direkt: alle übrigen 19 = LayoutVeraltet', da.veraltet + db.veraltet === 19 && da.andere.length + db.andere.length === 0);
  const siegerD = [...da.erfolge, ...db.erfolge][0]!;
  check('direkt: Datei bytegleich mit dem Erfolg', readFileSync(dPfad, 'utf-8') === sollText(koerper(siegerD)), siegerD);
  check('direkt: keine .tmp-Leiche, keine .lock', !readdirSync(DIREKT).some((f) => f.endsWith('.tmp') || f.endsWith('.lock')), readdirSync(DIREKT).join(','));

  // ── 11) Stresslauf: 40 Runden, zwei Prozesse auf dieselbe Millisekunde ─
  let rundenFehler = 0;
  for (let r = 0; r < 40; r++) {
    const basis = sha(readFileSync(dPfad));
    const t = Date.now() + 40;
    const [x, y] = (await Promise.all([
      wa.fragen({ cmd: 'direkt', pfad: dPfad, basis, startAt: t, anzahl: 1, tag: `r${r}a` }),
      wb.fragen({ cmd: 'direkt', pfad: dPfad, basis, startAt: t, anzahl: 1, tag: `r${r}b` }),
    ])) as Array<{ ok: number; andere: string[] }>;
    if (x.ok + y.ok !== 1 || x.andere.length + y.andere.length > 0) {
      rundenFehler++;
      console.error(`  Runde ${r}: ok ${x.ok}+${y.ok}, andere ${JSON.stringify([...x.andere, ...y.andere])}`);
    }
  }
  check('Stresslauf: in 40 von 40 Runden gewinnt genau ein Prozess', rundenFehler === 0, `${rundenFehler} Runden fehlerhaft`);
  check('Stresslauf: nichts zurückgeblieben', !readdirSync(DIREKT).some((f) => f.endsWith('.tmp') || f.endsWith('.lock')));

  // ── 12) Betriebsdienst gegen Fremdprozess auf DERSELBEN Datei ───────
  let gemischtFehler = 0;
  for (let r = 0; r < 20; r++) {
    const basis = await holeHash();
    const t = Date.now() + 60;
    const [x, http] = await Promise.all([
      wa.fragen({ cmd: 'direkt', pfad: WELT_DATEI, basis, startAt: t, anzahl: 1, tag: `g${r}` }),
      (async () => {
        while (Date.now() < t) {
          /* gleicher Startschuss wie beim Fremdprozess */
        }
        return anfrage('POST', { leib: koerper(`h${r}`), ifMatch: `"${basis}"` });
      })(),
    ]);
    const fremdOk = (x as { ok: number }).ok;
    const httpOk = http.status === 200 ? 1 : 0;
    if (fremdOk + httpOk !== 1 || (http.status !== 200 && http.status !== 409)) {
      gemischtFehler++;
      console.error(`  Runde ${r}: Fremdprozess ok=${fremdOk}, HTTP ${http.status}`);
    }
  }
  check('Betriebsdienst gegen Fremdprozess: in 20 von 20 Runden genau ein Sieger', gemischtFehler === 0, `${gemischtFehler} Runden fehlerhaft`);
  check('gemischt: keine .tmp/.lock zurückgeblieben', !readdirSync(WELTEN).some((f) => f.endsWith('.tmp') || f.endsWith('.lock')));

  // ── 13) Sperre: verwaist wird gebrochen, frische bleibt ─────────────
  const sPfad = resolve(DIREKT, 'sperre.json');
  writeFileSync(sPfad, sollText(koerper('sperre-start')));
  const gewarnt: string[] = [];
  const warnAlt = console.warn;
  console.warn = (...a: unknown[]) => void gewarnt.push(a.join(' '));
  try {
    writeFileSync(`${sPfad}.lock`, 'toter-prozess');
    const vor = new Date(Date.now() - 60_000);
    utimesSync(`${sPfad}.lock`, vor, vor);
    let gebrochen = true;
    try {
      layoutSchreiben(sPfad, koerper('nach-verwaister-sperre'));
    } catch {
      gebrochen = false;
    }
    check('Sperre ohne Besitzangabe (60 s alt) wird als Müll gebrochen, Schreiben gelingt', gebrochen && readFileSync(sPfad, 'utf-8') === sollText(koerper('nach-verwaister-sperre')));
    check('gebrochene Sperre: Logzeile', gewarnt.some((z) => /verwaiste Sperre .* gebrochen/.test(z)), gewarnt.join(' | '));
    check('gebrochene Sperre: danach keine .lock', !existsSync(`${sPfad}.lock`));

    const beiDerFrischen = readFileSync(sPfad, 'utf-8');
    writeFileSync(`${sPfad}.lock`, 'lebender-prozess');
    let fehlerName = '';
    try {
      layoutSchreiben(sPfad, koerper('gegen-frische-sperre'), undefined, { sperreWartenMs: 200 });
    } catch (f) {
      fehlerName = (f as Error).name;
    }
    check('frische Sperre ohne Besitzangabe: LayoutGesperrt nach kurzer Wartezeit', fehlerName === 'LayoutGesperrt', `= "${fehlerName}"`);
    check('frische Sperre ohne Besitzangabe: Datei unverändert', readFileSync(sPfad, 'utf-8') === beiDerFrischen);
    check('frische Sperre ohne Besitzangabe: bleibt liegen', readFileSync(`${sPfad}.lock`, 'utf-8') === 'lebender-prozess');
    rmSync(`${sPfad}.lock`);

    // (Tmp-Dateien und ihr Besitz: siehe Abschnitt 27.)

    // Datei fehlt, Basis gegeben: veraltet mit aktuell = null.
    let ohneDatei: { name?: string; aktuell?: unknown } = {};
    try {
      layoutSchreiben(resolve(DIREKT, 'gibt-es-nicht.json'), koerper('x'), undefined, { basis: '0'.repeat(64) });
    } catch (f) {
      ohneDatei = { name: (f as Error).name, aktuell: (f as { aktuell?: unknown }).aktuell };
    }
    check('fehlende Datei + Basis: LayoutVeraltet mit aktuell = null', ohneDatei.name === 'LayoutVeraltet' && ohneDatei.aktuell === null, JSON.stringify(ohneDatei));
    check('fehlende Datei + Basis: nichts angelegt', !existsSync(resolve(DIREKT, 'gibt-es-nicht.json')));
  } finally {
    console.warn = warnAlt;
  }

  // ══ Nachbesserung nach dem Angriff (B1, B2, B5, B6) ═════════════════

  // ── 14) TOCTOU: langsamer Schreiber zwischen Besitzprüfung und rename ─
  // Die Pause kommt aus dem Werkzeugprozess (renameSync wird dort verzögert),
  // nicht aus dem Code unter Test — so läuft dieselbe Probe auch gegen den
  // Stand davor. `sperreVeraltetMs: 300` ist die Frist, nach der der alte Code
  // eine Sperre brach; der neue bricht die eines LEBENDEN Besitzers nie.
  const tPfad = resolve(DIREKT, 'toctou.json');
  writeFileSync(tPfad, sollText(koerper('toctou-start')));
  const hT = sha(readFileSync(tPfad));
  const startT = Date.now() + 300;
  const [ta, tb] = (await Promise.all([
    wa.fragen({ cmd: 'direkt', pfad: tPfad, basis: hT, startAt: startT, anzahl: 1, tag: 'A-langsam', pausiereVorRenameMs: 1500, sperreVeraltetMs: 300, sperreWartenMs: 6000 }),
    wb.fragen({ cmd: 'direkt', pfad: tPfad, basis: hT, startAt: startT + 700, anzahl: 1, tag: 'B-flink', sperreVeraltetMs: 300, sperreWartenMs: 6000 }),
  ])) as Array<{ ok: number; veraltet: number; andere: string[]; erfolge: string[]; hashes: string[] }>;
  console.log(`# TOCTOU: A ok=${ta.ok} veraltet=${ta.veraltet}, B ok=${tb.ok} veraltet=${tb.veraltet} andere=${JSON.stringify([...ta.andere, ...tb.andere])}`);
  check('TOCTOU: genau 1 Erfolg (langsamer A gegen flinken B)', ta.ok + tb.ok === 1, `A ${ta.ok}, B ${tb.ok}`);
  const gewinnerT = [...ta.hashes, ...tb.hashes][0];
  check('TOCTOU: kein Schreiber scheitert mit etwas anderem als LayoutVeraltet (kein ENOENT, keine verlorene Tmp-Datei)', ta.andere.length + tb.andere.length === 0, JSON.stringify([...ta.andere, ...tb.andere]));
  check('TOCTOU: der gemeldete Hash liegt auf der Platte', gewinnerT === sha(readFileSync(tPfad)), `${gewinnerT} ≠ ${sha(readFileSync(tPfad))}`);
  check('TOCTOU: der Gewinner ist der Besitzer der Sperre (A), B wurde als veraltet abgewiesen', ta.ok === 1 && tb.veraltet === 1);
  check('TOCTOU: nichts zurückgeblieben', !readdirSync(DIREKT).some((f) => f.startsWith('toctou.json.') && (f.endsWith('.tmp') || f.endsWith('.lock'))));

  // ── 15) kill -9 zwischen Sperre und rename ──────────────────────────
  {
    const opfer = await werkerStarten();
    const hK = await holeHash();
    const marker = resolve(ORDNER, 'opfer.marker');
    void opfer.fragen({ cmd: 'direkt', pfad: WELT_DATEI, basis: hK, startAt: 0, anzahl: 1, tag: 'opfer', pausiereVorRenameMs: 60_000, markerPfad: marker });
    for (let i = 0; i < 200 && !existsSync(marker); i++) await warte(50);
    check('kill -9: Opfer steht in der Sperre (Marker da)', existsSync(marker));
    const pid = Number(readFileSync(marker, 'utf-8'));
    check('kill -9: vor dem Kill liegen .lock und die Tmp-Datei des Opfers', existsSync(`${WELT_DATEI}.lock`) && readdirSync(WELTEN).some((f) => f.startsWith(`dev.json.${pid}.`) && f.endsWith('.tmp')));
    const beendet = new Promise<void>((f) => opfer.kind.once('exit', () => f()));
    process.kill(pid, 'SIGKILL');
    await Promise.race([beendet, warte(3000)]);
    const t0 = Date.now();
    const nach = await anfrage('POST', { leib: koerper('nach-absturz'), ifMatch: `"${hK}"` });
    const ms = Date.now() - t0;
    console.log(`# kill -9: nächster POST → ${nach.status} nach ${ms} ms`);
    check('kill -9: nächster POST = 200 (nicht 503)', nach.status === 200, `= ${nach.status} ${JSON.stringify(nach.daten)}`);
    check('kill -9: … und das in unter 1 s', ms < 1000, `= ${ms} ms`);
    check('kill -9: Datei = Sanitizer-Ergebnis des nachfolgenden Schreibers', platte().toString('utf-8') === sollText(koerper('nach-absturz')));
    await warte(150);
    check('kill -9: Logzeile „verwaiste Sperre … Besitzer pid <pid> lebt nicht mehr"', new RegExp(`verwaiste Sperre .* gebrochen: Besitzer pid ${pid} lebt nicht mehr`).test(protokoll));
    check('kill -9: keine .lock, keine Tmp-Leiche des Opfers', !existsSync(`${WELT_DATEI}.lock`) && !readdirSync(WELTEN).some((f) => f.endsWith('.tmp')));
  }

  // ── 16) Ereignisschleife bleibt frei, während ein Fremder die Sperre hält ─
  {
    const halter = await werkerStarten();
    const hH = await holeHash();
    const marker = resolve(ORDNER, 'halter.marker');
    const leerlauf: number[] = [];
    for (let i = 0; i < 21; i++) {
      const t = Date.now();
      await fetch(`http://127.0.0.1:${port}/status`, { headers: { 'x-wov-token': TOKEN } });
      leerlauf.push(Date.now() - t);
      await warte(10);
    }
    const halterFertig = halter.fragen({ cmd: 'direkt', pfad: WELT_DATEI, basis: null, startAt: 0, anzahl: 1, tag: 'halter', pausiereVorRenameMs: 1800, markerPfad: marker });
    for (let i = 0; i < 200 && !existsSync(marker); i++) await warte(20);
    const tPost = Date.now();
    const wartender = anfrage('POST', { leib: koerper('wartender'), ifMatch: `"${hH}"` });
    const proben: number[] = [];
    let postFertig = false;
    void wartender.then(() => (postFertig = true));
    // Gemessen wird, solange der POST auf der Sperre wartet (etwa 1,8 s), mindestens aber bis 5 Proben da sind:
    // Unter Last dauert jede Probe länger, und ein Fenster fester Länge lieferte dann zu wenige.
    while (!postFertig || proben.length < 5) {
      const t = Date.now();
      const r = await fetch(`http://127.0.0.1:${port}/status`, { headers: { 'x-wov-token': TOKEN } });
      proben.push(Date.now() - t);
      if (r.status !== 200) proben.push(9999);
      await warte(25);
    }
    const w = await wartender;
    await halterFertig;
    const msPost = Date.now() - tPost;
    const maximum = Math.max(...proben);
    // Grenze aus der Basislinie DIESES Laufs (die erste Probe, der Kaltstart, zählt nicht) und ein fester
    // Boden von 500 ms: Streuung und Last einer vollen Maschine (gemessen bis ~160 ms) reißen sie nicht,
    // die alte Blockade (~3000 ms, ein synchron wartender Betriebsdienst) immer.
    const grundlinie = leerlauf.slice(1).sort((x, y) => x - y);
    const median = grundlinie[Math.floor(grundlinie.length / 2)]!;
    const grenze = Math.max(500, 4 * median + 50);
    console.log(`# Ereignisschleife: /status ohne Sperre Median ${median} ms, max ${Math.max(...grundlinie)} ms (${grundlinie.length} Proben, erste verworfen); mit fremder Sperre ${proben.length} Proben, max ${maximum} ms, Grenze ${grenze} ms; wartender POST → ${w.status} nach ${msPost} ms`);
    check('Sperre gehalten: GET /status bleibt weit unter der alten Blockade (≤ max(500 ms, 4 × Median + 50))', maximum <= grenze, `max ${maximum} ms > Grenze ${grenze} ms, Proben ${proben.join(',')}`);
    check('Sperre gehalten: mindestens 5 Proben im Fenster, damit das Maximum etwas aussagt', proben.length >= 5, `= ${proben.length}`);
    check('Sperre gehalten: der wartende POST hat gewartet (≥ 1 s) und ist danach 409 (Halter hat geschrieben), nicht 503', w.status === 409 && msPost >= 1000, `= ${w.status} nach ${msPost} ms`);
    check('Sperre gehalten: der 409 nennt den Hash des Halters', w.daten.aktuell === plattenHash());
    halter.kind.stdin!.end();
  }

  // ── 17) Wann eine Sperre gebrochen wird (Besitzangabe in der Sperrdatei) ─
  {
    const zPfad = resolve(DIREKT, 'besitz.json');
    writeFileSync(zPfad, sollText(koerper('besitz-start')));
    const startzeitVon = (pid: number | string): string | null => {
      try {
        const s = readFileSync(`/proc/${pid}/stat`, 'utf-8');
        return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] ?? null;
      } catch {
        return null;
      }
    };
    const meineStartzeit = startzeitVon('self');
    // Ein fremder, LEBENDER Besitzer für die „lebt“-Fälle. Der Testprozess selbst taugt dafür nicht mehr: Eine Sperre mit
    // seiner pid und Startzeit, die er nicht hält, ist seine eigene Leiche und wird sofort gebrochen (Abschnitt 26).
    const lebenderBesitzer = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], { stdio: 'ignore' });
    kinder.push(lebenderBesitzer);
    const lebenderStart = startzeitVon(lebenderBesitzer.pid!);
    const lockDatei = `${zPfad}.lock`;
    const sperreSchreiben = (info: Record<string, unknown> | string, alterMs = 0): void => {
      writeFileSync(lockDatei, typeof info === 'string' ? info : JSON.stringify(info));
      if (alterMs > 0) {
        const t = new Date(Date.now() - alterMs);
        utimesSync(lockDatei, t, t);
      }
    };
    const versuch = (opt: Record<string, unknown> = {}): { ok: boolean; name: string; ms: number } => {
      const t = Date.now();
      try {
        layoutSchreiben(zPfad, koerper(`besitz-${Math.random()}`), undefined, opt);
        return { ok: true, name: '', ms: Date.now() - t };
      } catch (f) {
        return { ok: false, name: (f as Error).name, ms: Date.now() - t };
      }
    };
    const log: string[] = [];
    const warnAlt2 = console.warn;
    console.warn = (...a: unknown[]) => void log.push(a.join(' '));
    try {
      // tot: ein beendeter Prozess
      const kurz = spawn(process.execPath, ['-e', '0']);
      await new Promise<void>((f) => kurz.once('exit', () => f()));
      const totePid = kurz.pid!;
      const frischTmp = `${zPfad}.${totePid}.abcdef012345.tmp`;
      writeFileSync(frischTmp, 'halb');
      sperreSchreiben({ pid: totePid, start: null, host: hostname(), marke: 'x' }); // ganz FRISCH
      let r = versuch({ sperreWartenMs: 2000 });
      check('toter Besitzer: frische Sperre wird SOFORT gebrochen, Schreiben gelingt', r.ok && r.ms < 500, `${JSON.stringify(r)}`);
      check('toter Besitzer: Logzeile mit pid', log.some((z) => new RegExp(`verwaiste Sperre .* gebrochen: Besitzer pid ${totePid} lebt nicht mehr`).test(z)), log.join(' | '));
      check('toter Besitzer: seine Tmp-Datei ist mit weg (obwohl frisch)', !existsSync(frischTmp));

      // lebend, uralt: wird nie gebrochen
      log.length = 0;
      const vorher = readFileSync(zPfad, 'utf-8');
      sperreSchreiben({ pid: lebenderBesitzer.pid, start: lebenderStart, host: hostname(), marke: 'lebend' }, 7_200_000);
      r = versuch({ sperreWartenMs: 250, sperreVeraltetMs: 1000 });
      check('lebender Besitzer, Sperre 2 h alt: LayoutGesperrt, NICHT gebrochen', !r.ok && r.name === 'LayoutGesperrt', JSON.stringify(r));
      check('lebender Besitzer: Datei unverändert, Sperre bleibt liegen', readFileSync(zPfad, 'utf-8') === vorher && JSON.parse(readFileSync(lockDatei, 'utf-8')).marke === 'lebend');
      check('lebender Besitzer: Logzeile ab 30 s („wird NICHT gebrochen")', log.some((z) => /wird NICHT gebrochen/.test(z)), log.join(' | '));
      // Sperre OHNE Startzeit (Handarbeit, fremdes Werkzeug): Wo es /proc gibt, nicht entscheidbar — eine
      // wiederverwendete pid ließe sich sonst nicht von dem Besitzer unterscheiden. 30-s-Frist wie beim fremden Rechner.
      if (meineStartzeit !== null) {
        const fremdLebend = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
        try {
          const fp = fremdLebend.pid!;
          log.length = 0;
          sperreSchreiben({ pid: fp, start: null, host: hostname(), marke: 'ohne-start-frisch' }, 5_000);
          r = versuch({ sperreWartenMs: 250 });
          check('Sperre ohne Startzeit, fremde lebende pid, 5 s alt: bleibt (LayoutGesperrt)', !r.ok && r.name === 'LayoutGesperrt' && existsSync(lockDatei), JSON.stringify(r));
          rmSync(lockDatei);
          sperreSchreiben({ pid: fp, start: null, host: hostname(), marke: 'ohne-start-mittel' }, 31_000);
          r = versuch({ sperreWartenMs: 250 });
          check('Sperre ohne Startzeit, fremde lebende pid, 31 s alt: bleibt (die Frist ist 10 min, der Halter kann noch schreiben)', !r.ok && r.name === 'LayoutGesperrt' && existsSync(lockDatei), JSON.stringify(r));
          rmSync(lockDatei);
          sperreSchreiben({ pid: fp, start: null, host: hostname(), marke: 'ohne-start-alt' }, 660_000);
          r = versuch({ sperreWartenMs: 2000 });
          check('Sperre ohne Startzeit, fremde lebende pid, 11 min alt: gebrochen, Schreiben gelingt', r.ok && r.ms < 500, JSON.stringify(r));
          check('… laute Logzeile (pid, Rechner, „Startzeit fehlt“, 660 s, Hinweis auf geteilte Laufwerke)', log.some((z) => z.includes('verwaiste Sperre') && z.includes(`ACHTUNG Besitzer pid ${fp}`) && z.includes('Startzeit fehlt in der Sperre') && / 660 s alt/.test(z) && z.includes('Geteilte Laufwerke über mehrere Rechner werden nicht unterstützt')), log.join(' | '));
          let lebtNoch = true;
          try {
            process.kill(fp, 0);
          } catch {
            lebtNoch = false;
          }
          check('… der fremde Prozess selbst wurde dabei nicht angerührt (lebt weiter)', lebtNoch);
        } finally {
          fremdLebend.kill('SIGKILL');
        }
      } else {
        check('Sperre ohne Startzeit: übersprungen (kein /proc)', true);
      }

      // pid wiederverwendet: lebt, aber andere Startzeit
      if (meineStartzeit !== null) {
        sperreSchreiben({ pid: process.pid, start: '1', host: hostname(), marke: 'alte-inkarnation' });
        r = versuch({ sperreWartenMs: 2000 });
        check('pid wiederverwendet (Startzeit passt nicht): Sperre gebrochen, Schreiben gelingt', r.ok && r.ms < 500, JSON.stringify(r));
      } else {
        check('pid wiederverwendet: übersprungen (kein /proc)', true);
      }

      // anderer Rechner: nicht entscheidbar → bleibt
      sperreSchreiben({ pid: totePid, start: null, host: 'ein-anderer-rechner', marke: 'fern' });
      r = versuch({ sperreWartenMs: 250 });
      check('Besitzer auf anderem Rechner, frisch: nicht entscheidbar, Sperre bleibt', !r.ok && r.name === 'LayoutGesperrt' && existsSync(lockDatei), JSON.stringify(r));
      rmSync(lockDatei);
      log.length = 0;
      sperreSchreiben({ pid: totePid, start: null, host: 'ein-anderer-rechner', marke: 'fern-mittel' }, 60_000);
      r = versuch({ sperreWartenMs: 250 });
      check('Besitzer auf anderem Rechner, Sperre 60 s alt: bleibt (Frist 10 min)', !r.ok && r.name === 'LayoutGesperrt' && existsSync(lockDatei), JSON.stringify(r));
      rmSync(lockDatei);
      sperreSchreiben({ pid: totePid, start: null, host: 'ein-anderer-rechner', marke: 'fern-alt' }, 660_000);
      r = versuch({ sperreWartenMs: 2000 });
      check('Besitzer auf anderem Rechner, Sperre 11 min alt: als verwaist gebrochen, Schreiben gelingt', r.ok && r.ms < 500, JSON.stringify(r));
      check('… laute Logzeile mit Rechner, pid und Alter', log.some((z) => new RegExp(`verwaiste Sperre .* gebrochen: ACHTUNG Besitzer pid ${totePid} auf Rechner ein-anderer-rechner .* 660 s alt`).test(z)), log.join(' | '));

      // ohne Besitzangabe: jung bleibt, alt ist Müll
      sperreSchreiben('hier hat jemand von Hand etwas hingelegt');
      r = versuch({ sperreWartenMs: 250 });
      check('Sperre ohne Besitzangabe, frisch: bleibt (LayoutGesperrt)', !r.ok && r.name === 'LayoutGesperrt', JSON.stringify(r));
      sperreSchreiben('hier hat jemand von Hand etwas hingelegt', 60_000);
      r = versuch({ sperreWartenMs: 2000 });
      check('Sperre ohne Besitzangabe, 60 s alt: als Müll gebrochen', r.ok, JSON.stringify(r));
      check('danach keine .lock', !existsSync(lockDatei));
    } finally {
      console.warn = warnAlt2;
    }

    // asynchron: Ereignisschleife läuft, während gewartet wird
    const modul = (await import('@wov/shared/src/worldlayout/layoutDatei.js')) as Record<string, unknown>;
    const asyncSchreiben = modul.layoutSchreibenAsync as
      | ((p: string, e: unknown, b?: number, o?: Record<string, unknown>) => Promise<{ hash: string }>)
      | undefined;
    check('layoutSchreibenAsync ist exportiert', typeof asyncSchreiben === 'function');
    if (asyncSchreiben) {
      sperreSchreiben({ pid: lebenderBesitzer.pid, start: lebenderStart, host: hostname(), marke: 'lebend3' });
      let takte = 0;
      const takt = setInterval(() => takte++, 5);
      const t = Date.now();
      let name = '';
      await asyncSchreiben(zPfad, koerper('async-gesperrt'), undefined, { sperreWartenMs: 600 }).catch((f: Error) => void (name = f.name));
      clearInterval(takt);
      const dauer = Date.now() - t;
      console.log(`# async: ${dauer} ms gewartet, in der Zeit ${takte} Takte à 5 ms`);
      check('async gesperrt: LayoutGesperrt nach ~600 ms', name === 'LayoutGesperrt' && dauer >= 550, `${name} nach ${dauer} ms`);
      check('async gesperrt: Ereignisschleife lief weiter (≥ 60 Takte in 600 ms)', takte >= 60, `${takte} Takte`);
      rmSync(lockDatei);
      // im selben Prozess: 10 gleichzeitige Schreiber, eine Basis → 1 Erfolg
      const hZ = sha(readFileSync(zPfad));
      const ergebnisse = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          asyncSchreiben(zPfad, koerper(`gleichzeitig-${i}`), undefined, { basis: hZ }).then(
            () => 'ok',
            (f: Error) => f.name
          )
        )
      );
      check('async, 10 gleichzeitige Schreiber im selben Prozess: 1 × ok, 9 × LayoutVeraltet', ergebnisse.filter((e) => e === 'ok').length === 1 && ergebnisse.filter((e) => e === 'LayoutVeraltet').length === 9, ergebnisse.join(','));
    }
  }

  // ── 18) Zwei Wartende brechen dieselbe tote Sperre gleichzeitig ──────
  {
    const dPfad2 = resolve(DIREKT, 'doppelbruch.json');
    writeFileSync(dPfad2, sollText(koerper('doppelbruch-start')));
    const kurz = spawn(process.execPath, ['-e', '0']);
    await new Promise<void>((f) => kurz.once('exit', () => f()));
    let falsch = 0;
    for (let r = 0; r < 15; r++) {
      writeFileSync(`${dPfad2}.lock`, JSON.stringify({ pid: kurz.pid, start: null, host: hostname(), marke: `tot-${r}` }));
      const basis = sha(readFileSync(dPfad2));
      const t = Date.now() + 40;
      const [x, y] = (await Promise.all([
        wa.fragen({ cmd: 'direkt', pfad: dPfad2, basis, startAt: t, anzahl: 1, tag: `d${r}a` }),
        wb.fragen({ cmd: 'direkt', pfad: dPfad2, basis, startAt: t, anzahl: 1, tag: `d${r}b` }),
      ])) as Array<{ ok: number; andere: string[] }>;
      if (x.ok + y.ok !== 1 || x.andere.length + y.andere.length > 0) {
        falsch++;
        console.error(`  Runde ${r}: ok ${x.ok}+${y.ok}, andere ${JSON.stringify([...x.andere, ...y.andere])}`);
      }
    }
    check('Doppelbruch: in 15 von 15 Runden gewinnt genau ein Schreiber, kein anderer Fehler', falsch === 0, `${falsch} Runden fehlerhaft`);
    check('Doppelbruch: keine .lock/.tmp zurückgeblieben', !readdirSync(DIREKT).some((f) => f.startsWith('doppelbruch.json.') && (f.endsWith('.lock') || f.endsWith('.tmp'))));
  }

  // ── 19) B5: Sicherungen haben eindeutige Namen, auch in derselben Millisekunde ─
  {
    const bPfad = resolve(DIREKT, 'sicherung.json');
    const bakNamen = (): string[] => readdirSync(DIREKT).filter((f) => f.startsWith('sicherung.json.') && f.endsWith('.bak')).sort();
    const stande = Array.from({ length: 6 }, (_, i) => sollText(koerper(`stand-${i}`)));
    writeFileSync(bPfad, stande[0]!);
    const EchtesDatum = Date;
    const FIX = EchtesDatum.parse('2026-01-01T00:00:00.000Z');
    class EingefrorenesDatum extends EchtesDatum {
      constructor(...a: unknown[]) {
        if (a.length === 0) super(FIX);
        else super(...(a as [number]));
      }
      static override now(): number {
        return FIX;
      }
    }
    globalThis.Date = EingefrorenesDatum as unknown as DateConstructor;
    try {
      for (let i = 1; i <= 5; i++) layoutSchreiben(bPfad, koerper(`stand-${i}`));
    } finally {
      globalThis.Date = EchtesDatum;
    }
    const baks = bakNamen();
    console.log(`# B5: 5 Schreibvorgänge in EINER (eingefrorenen) Millisekunde → ${baks.length} Sicherungen`);
    check('5 Schreibvorgänge in derselben Millisekunde → 5 Sicherungen', baks.length === 5, `= ${baks.length}: ${baks.join(', ')}`);
    check('… in der Reihenfolge ihres Entstehens (Inhalt = jeweils vorheriger Stand)', baks.length === 5 && baks.every((n, i) => readFileSync(resolve(DIREKT, n), 'utf-8') === stande[i]));
    for (let i = 6; i <= 17; i++) layoutSchreiben(bPfad, koerper(`stand-${i}`));
    check('nach 17 Schreibvorgängen bleiben genau 10 Sicherungen (die Grenze)', bakNamen().length === 10, `= ${bakNamen().length}`);
    // `at(-1)` statt Index 9: Auf einem Stand mit Namenskollisionen gibt es weniger als 10 Sicherungen,
    // und der Test soll dann an der Behauptung scheitern, nicht an einem Absturz, der die Abschnitte danach verschluckt.
    const juengste = bakNamen().at(-1);
    check('… und es sind die neuesten (die 10 Stände vor dem letzten)', juengste !== undefined && readFileSync(resolve(DIREKT, juengste), 'utf-8') === sollText(koerper('stand-16')));
  }

  // ── 20) B6: Tmp-Leiche im alten Schema (<datei>.tmp) wird geräumt ────
  {
    const lPfad = resolve(DIREKT, 'altschema.json');
    writeFileSync(lPfad, sollText(koerper('alt-start')));
    const alt = `${lPfad}.tmp`;
    writeFileSync(alt, 'halb, aus der Zeit des festen Tmp-Namens');
    const vor = new Date(Date.now() - 660_000);
    utimesSync(alt, vor, vor);
    layoutSchreiben(lPfad, koerper('alt-danach'));
    check('Tmp-Leiche im alten Schema (11 min alt) wird beim nächsten Schreiben geräumt', !existsSync(alt));
    writeFileSync(alt, 'frisch');
    layoutSchreiben(lPfad, koerper('alt-danach-2'));
    check('… eine frische bleibt liegen', existsSync(alt));
    rmSync(alt);
  }

  // ══ Dritte Runde (Angriff 2): fremder Rechner, Zurücklegen, Müll-Arrays, Freigabe ══

  // ── 21) Sperre eines fremden Rechners darf nicht ewig halten ────────
  {
    const lock = `${WELT_DATEI}.lock`;
    const fremd = { pid: 999999, start: '12345', host: 'editor-container-7f3a', marke: 'fern' };
    let hF = await holeHash();
    writeFileSync(lock, JSON.stringify(fremd));
    const vor2h = new Date(Date.now() - 7_200_000);
    utimesSync(lock, vor2h, vor2h);
    let t0 = Date.now();
    const alt = await anfrage('POST', { leib: koerper('nach-fremder-sperre'), ifMatch: `"${hF}"` });
    const ms = Date.now() - t0;
    console.log(`# Fremdrechner-Sperre, 2 h alt: erster POST → ${alt.status} nach ${ms} ms`);
    check('fremder Rechner, Sperre 2 h alt: erster POST = 200', alt.status === 200, `= ${alt.status} ${JSON.stringify(alt.daten)}`);
    check('… und nicht erst nach der Wartezeit (< 1 s)', ms < 1000, `= ${ms} ms`);
    await warte(150);
    check('… laute Logzeile mit Rechner, pid und Alter', /verwaiste Sperre .* gebrochen: ACHTUNG Besitzer pid 999999 auf Rechner editor-container-7f3a .* 7200 s alt/.test(protokoll));
    check('… die Sperre ist weg', !existsSync(lock));
    hF = await holeHash();
    const vorher = plattenHash();
    writeFileSync(lock, JSON.stringify({ ...fremd, marke: 'fern2' })); // frisch
    t0 = Date.now();
    const frisch = await anfrage('POST', { leib: koerper('gegen-frische-fremde-sperre'), ifMatch: `"${hF}"` });
    const ms2 = Date.now() - t0;
    console.log(`# Fremdrechner-Sperre, frisch: POST → ${frisch.status} nach ${ms2} ms, Retry-After ${frisch.kopf.get('retry-after')}`);
    check('fremder Rechner, frische Sperre (< 30 s): 503', frisch.status === 503 && frisch.daten.fehler === 'gesperrt', `= ${frisch.status}`);
    check('503 trägt den Kopf Retry-After', frisch.kopf.get('retry-after') === '3', `= ${frisch.kopf.get('retry-after')}`);
    check('503-Meldung nennt pid und Rechner des Halters', /pid 999999/.test(String(frisch.daten.message)) && /editor-container-7f3a/.test(String(frisch.daten.message)), String(frisch.daten.message));
    check('frische fremde Sperre: Datei unverändert, Sperre bleibt liegen', plattenHash() === vorher && JSON.parse(readFileSync(lock, 'utf-8')).marke === 'fern2');
    rmSync(lock);
  }

  // ── 22) Zurücklegen einer weggenommenen Sperre scheitert: nicht weiterschreiben ─
  // Der Brecher B beurteilt eine tote Sperre und pausiert vor seinem Bruch-rename; das Opfer A
  // bricht dieselbe Sperre, legt seine eigene an und steht hinter der Besitzprüfung, kurz
  // vor dem rename. B wacht auf, nimmt A's frische Sperre weg — und linkSync scheitert.
  {
    const iPfad = resolve(DIREKT, 'injektion.json');
    writeFileSync(iPfad, sollText(koerper('injektion-start')));
    const kurz = spawn(process.execPath, ['-e', '0']);
    await new Promise<void>((f) => kurz.once('exit', () => f()));
    let doppelt = 0;
    let unpassend = 0;
    let bGesperrt = 0;
    const RUNDEN = 20;
    for (let r = 0; r < RUNDEN; r++) {
      writeFileSync(`${iPfad}.lock`, JSON.stringify({ pid: kurz.pid, start: null, host: hostname(), marke: `tot-i-${r}` }));
      const basis = sha(readFileSync(iPfad));
      const t = Date.now() + 60;
      const [b, a] = (await Promise.all([
        wa.fragen({ cmd: 'direkt', pfad: iPfad, basis, startAt: t, anzahl: 1, tag: `i${r}B`, pausiereVorSperrbruchMs: 500, linkScheitert: true }),
        wb.fragen({ cmd: 'direkt', pfad: iPfad, basis, startAt: t + 100, anzahl: 1, tag: `i${r}A`, pausiereVorRenameMs: 900 }),
      ])) as Array<{ ok: number; andere: string[]; hashes: string[] }>;
      const erfolge = b.ok + a.ok;
      const gemeldet = [...b.hashes, ...a.hashes];
      if (erfolge > 1) doppelt++;
      if (erfolge !== 1 || gemeldet[0] !== sha(readFileSync(iPfad))) unpassend++;
      if (b.andere.length === 1 && /^LayoutGesperrt/.test(b.andere[0]!)) bGesperrt++;
    }
    console.log(`# Injektion Zurücklegen scheitert: ${RUNDEN} Runden, Doppelerfolge ${doppelt}, Runden ohne genau einen Sieger mit richtigem Hash ${unpassend}, B als LayoutGesperrt abgewiesen ${bGesperrt}`);
    check(`Zurücklegen scheitert: in ${RUNDEN}/${RUNDEN} Runden KEIN Doppelerfolg`, doppelt === 0, `${doppelt} Doppelerfolge`);
    check(`… und in jeder Runde genau ein Erfolg, dessen gemeldeter Hash auf der Platte liegt`, unpassend === 0, `${unpassend} Runden`);
    check(`… der Brecher meldet ehrlich LayoutGesperrt (die Injektion greift in ${RUNDEN}/${RUNDEN} Runden)`, bGesperrt === RUNDEN, `${bGesperrt}`);
    check('Injektion: keine .lock/.tmp zurückgeblieben', !readdirSync(DIREKT).some((f) => f.startsWith('injektion.json.') && (f.endsWith('.lock') || f.endsWith('.tmp'))));
  }

  // ── 23) Array aus Müll: nichts geht still verloren ──────────────────
  {
    const hM = plattenHash();
    const bakM = sicherungen();
    for (const muell of [['x', 'y'], [[]], [{}], [null], [{ prefab: 42, x: 'a' }]]) {
      const r = await anfrage('POST', { leib: { ...koerper('muell-array'), placements: muell }, ifMatch: `"${hM}"` });
      check(`placements = ${JSON.stringify(muell)} → 422 ungueltig`, r.status === 422 && r.daten.fehler === 'ungueltig' && r.daten.feld === 'placements' && /keiner der \d+ Einträge/.test(String(r.daten.message)), `= ${r.status} ${JSON.stringify(r.daten)}`);
    }
    check('Müll-Array: Prüfsumme vorher = nachher, keine Sicherung', plattenHash() === hM && sicherungen() === bakM);
    const leerListe = await anfrage('POST', { leib: { ...koerper('leere-liste'), placements: [] }, ifMatch: `"${hM}"` });
    check('placements = [] → weiterhin 200, kein verworfen-Feld', leerListe.status === 200 && leerListe.daten.verworfen === undefined, `= ${leerListe.status}`);
    const hN = plattenHash();
    const teil = await anfrage('POST', { leib: { ...koerper('teil-muell'), placements: [{ prefab: 'Beech1', x: 1, z: 2 }, 'x', { prefab: 'Beech1', x: 3, z: 4 }, null] }, ifMatch: `"${hN}"` });
    check('2 gültige + 2 Müll → 200 mit verworfen: 2 und verworfenJeFeld {placements: 2}', teil.status === 200 && teil.daten.verworfen === 2 && JSON.stringify(teil.daten.verworfenJeFeld) === '{"placements":2}', `= ${teil.status} ${JSON.stringify(teil.daten)}`);
    check('… die zwei gültigen stehen auf der Platte', (JSON.parse(platte().toString('utf-8')) as { placements: unknown[] }).placements.length === 2);
    await warte(150);
    check('… Logzeile nennt die verworfenen Einträge je Feld', /2 ungueltige\(r\) Eintrag\/Eintraege im Dokument verworfen \(placements 2\)/.test(protokoll));
    const ganz = await anfrage('POST', { leib: koerper('ganz-gueltig', 3), ifMatch: `"${plattenHash()}"` });
    check('lauter gültige Platzierungen → 200 ohne verworfen-Felder', ganz.status === 200 && ganz.daten.verworfen === undefined && ganz.daten.verworfenJeFeld === undefined);

    // Dieselbe Regel für JEDE Liste (roh ≥ 1, nach dem Sanitizer 0 → 422 mit Feldnamen), und Teilverwurf → 200 mit Zahl.
    const hK2 = plattenHash();
    const bakK2 = sicherungen();
    for (const feld of ['continents', 'routes', 'rivers', 'lakes']) {
      for (const muell of [['x', 'y'], [{}], [[]], [null]]) {
        const r = await anfrage('POST', { leib: { ...koerper('muell-liste'), [feld]: muell }, ifMatch: `"${hK2}"` });
        check(`${feld} = ${JSON.stringify(muell)} → 422 ungueltig, feld ${feld}`, r.status === 422 && r.daten.fehler === 'ungueltig' && r.daten.feld === feld && r.daten.ok === false && /keiner der \d+ Einträge/.test(String(r.daten.message)), `= ${r.status} ${JSON.stringify(r.daten).slice(0, 160)}`);
      }
    }
    check('Müll in allen Listen: Prüfsumme vorher = nachher, keine Sicherung', plattenHash() === hK2 && sicherungen() === bakK2);
    const gueltig: Record<string, unknown> = {
      placements: { prefab: 'Beech1', x: 1, z: 2 },
      continents: { id: 'nord', name: 'Nordland' },
      routes: { id: 'route-1', points: [[0, 0], [5, 5]], mode: 'loop' },
      rivers: { id: 'fluss-1', points: [[0, 0], [100, 100]], width: 20 },
      lakes: { id: 'see-1', x: 10, z: 10, radius: 50 },
    };
    for (const feld of Object.keys(gueltig)) {
      const r = await anfrage('POST', { leib: { ...koerper('ein-gueltig-ein-muell'), [feld]: [gueltig[feld], 'x'] }, ifMatch: `"${plattenHash()}"` });
      const inDatei = (JSON.parse(platte().toString('utf-8')) as Record<string, unknown[] | undefined>)[feld];
      check(`${feld}: 1 gültig + 1 Müll → 200 mit verworfen: 1, verworfenJeFeld {${feld}: 1}, genau 1 Eintrag auf der Platte`, r.status === 200 && r.daten.verworfen === 1 && JSON.stringify(r.daten.verworfenJeFeld) === JSON.stringify({ [feld]: 1 }) && inDatei?.length === 1, `= ${r.status} ${JSON.stringify(r.daten).slice(0, 200)}`);
    }
    // Mehrere Felder in einem Dokument: Summe und Aufteilung, Logzeile.
    const gemischt = await anfrage('POST', { leib: { ...koerper('gemischt-muell'), placements: [{ prefab: 'Beech1', x: 1, z: 2 }, 'a', 'b'], routes: [{ id: 'route-1', points: [[0, 0]], mode: 'loop' }, null] }, ifMatch: `"${plattenHash()}"` });
    check('zwei Felder mit Verlust → verworfen: 3, verworfenJeFeld {placements: 2, routes: 1}', gemischt.status === 200 && gemischt.daten.verworfen === 3 && JSON.stringify(gemischt.daten.verworfenJeFeld) === '{"placements":2,"routes":1}', `= ${gemischt.status} ${JSON.stringify(gemischt.daten)}`);
    await warte(150);
    check('… Logzeile nennt beide Felder', /3 ungueltige\(r\) Eintrag\/Eintraege im Dokument verworfen \(placements 2, routes 1\)/.test(protokoll));
    // Auch routes ohne Ausnahme: Der Editor schickt nur Saniertes (Entwürfe fliegen vorher heraus). Eine Liste
    // aus lauter Entwürfen, aus Müll oder aus `{}` ersetzt sonst still die echten Routen.
    const hR = plattenHash();
    for (const [name, routen] of [
      ['nur ein Entwurf {id, points: []}', [{ id: 'route-1', points: [], mode: 'loop' }]],
      ['ein Entwurf ohne id {points: []}', [{ points: [] }]],
      ['zwei Entwürfe', [{ id: 'a', points: [] }, { id: 'b', points: [] }]],
      ['Entwurf + Müll-Eintrag', [{ id: 'route-1', points: [], mode: 'loop' }, 'x']],
      ['{}', [{}]],
      ['["x","y"]', ['x', 'y']],
    ] as Array<[string, unknown[]]>) {
      const r = await anfrage('POST', { leib: { ...koerper('routen-ersatz'), routes: routen }, ifMatch: `"${hR}"` });
      check(`routes: ${name} → 422 ungueltig (keine Ausnahme mehr)`, r.status === 422 && r.daten.fehler === 'ungueltig' && r.daten.feld === 'routes', `= ${r.status} ${JSON.stringify(r.daten).slice(0, 160)}`);
    }
    check('routes-Müll: Prüfsumme vorher = nachher', plattenHash() === hR);
  }

  // ── 24) Fehler beim Freigeben der Sperre verfälscht die Antwort nicht ─
  {
    const fPfad = resolve(DIREKT, 'freigabe.json');
    writeFileSync(fPfad, sollText(koerper('freigabe-start')));
    const echtesRm = fs.rmSync;
    const geloggt: string[] = [];
    const errAlt = console.error;
    console.error = (...a: unknown[]) => void geloggt.push(a.join(' '));
    (fs as { rmSync: typeof echtesRm }).rmSync = ((p: string, o?: unknown) => {
      if (String(p).endsWith('.lock')) throw Object.assign(new Error('EROFS: simulated'), { code: 'EROFS' });
      return echtesRm(p, o as never);
    }) as typeof echtesRm;
    syncBuiltinESMExports();
    let geworfen = '';
    let ergebnis: { hash?: string } | undefined;
    try {
      ergebnis = layoutSchreiben(fPfad, koerper('freigabe-fehler'));
    } catch (f) {
      geworfen = (f as Error).message;
    } finally {
      (fs as { rmSync: typeof echtesRm }).rmSync = echtesRm;
      syncBuiltinESMExports();
      console.error = errAlt;
    }
    check('Freigabe scheitert (rmSync wirft): der gelungene Schreibvorgang meldet trotzdem Erfolg', geworfen === '' && ergebnis?.hash === sha(readFileSync(fPfad)), geworfen);
    check('… der Fehler steht laut im Log', geloggt.some((z) => /konnte nicht freigegeben werden: EROFS/.test(z)), geloggt.join(' | '));
    rmSync(`${fPfad}.lock`, { force: true });
  }

  // ══ Vierte Runde (Angriff 3): unprüfbarer Halter, eigene Leiche, Tmp-Besitz ═════

  // ── 25) F1: Halter, den man nicht prüfen kann — Herzschlag, 10-min-Frist, kein Doppelerfolg ─
  // Der Halter steht 35 s zwischen Besitzprüfung und rename (die Pause sitzt im Werkzeugprozess); ein
  // zweiter Schreiber wartet bis zu 60 s. Zwei Formen des „nicht entscheidbar“: ein fremder Rechnername
  // (im Halter ersetzt) und eine Sperre ohne Startzeit (im Halter liest /proc nicht). Früher brach der
  // Wartende die Sperre nach 30 s, und beide meldeten Erfolg.
  {
    const faelle = [
      { name: 'fremder Rechner', halter: { fremderHost: 'angreifer-fremd-test' }, pruefe: (i: { host: string; start: string | null }) => i.host === 'angreifer-fremd-test' },
      { name: 'Sperre ohne Startzeit', halter: { ohneProc: true }, pruefe: (i: { host: string; start: string | null }) => i.start === null },
    ];
    const ergebnisse = await Promise.all(
      faelle.map(async (fall, i) => {
        const pfadF = resolve(DIREKT, `herzschlag-${i}.json`);
        writeFileSync(pfadF, sollText(koerper(`herzschlag-${i}-start`)));
        const hF = sha(readFileSync(pfadF));
        const marker = resolve(ORDNER, `herzschlag-${i}.marker`);
        const [halter, schreiber] = await Promise.all([werkerStarten(), werkerStarten()]);
        const halterFertig = halter.fragen({ cmd: 'direkt', pfad: pfadF, basis: hF, startAt: 0, anzahl: 1, tag: `H${i}`, pausiereVorRenameMs: 35_000, markerPfad: marker, ...fall.halter });
        for (let n = 0; n < 300 && !existsSync(marker); n++) await warte(50);
        const tMarker = Date.now();
        const lockInfo = JSON.parse(readFileSync(`${pfadF}.lock`, 'utf-8')) as { host: string; start: string | null };
        const schreiberFertig = warte(1500).then(() => schreiber.fragen({ cmd: 'direkt', pfad: pfadF, basis: hF, startAt: 0, anzahl: 1, tag: `A${i}`, sperreWartenMs: 60_000 }));
        const alter: number[] = [];
        // 12 s und 27 s: Der Herzschlag schlägt alle 5 s (bei ~25 s zuletzt), das Alter ist dort ~2 s statt am Rand von 5 s.
        for (const nach of [12_000, 27_000]) {
          await warte(Math.max(0, tMarker + nach - Date.now()));
          alter.push(Date.now() - statSync(`${pfadF}.lock`).mtimeMs);
        }
        const [h, a] = (await Promise.all([halterFertig, schreiberFertig])) as Array<{ ok: number; veraltet: number; andere: string[]; hashes: string[] }>;
        halter.kind.stdin!.end();
        schreiber.kind.stdin!.end();
        return { fall, pfadF, lockInfo, alter, h, a };
      })
    );
    for (const { fall, pfadF, lockInfo, alter, h, a } of ergebnisse) {
      console.log(`# Herzschlag (${fall.name}): mtime der Sperre nach 12 s Halten ${Math.round(alter[0]!)} ms alt, nach 27 s ${Math.round(alter[1]!)} ms; Halter ok=${h.ok}, Wartender ok=${a.ok} veraltet=${a.veraltet} andere=${JSON.stringify(a.andere)}`);
      check(`${fall.name}: die Sperre trägt wirklich die nicht prüfbare Besitzangabe`, fall.pruefe(lockInfo), JSON.stringify(lockInfo));
      check(`${fall.name}: Herzschlag — mtime nach 12 s Halten jünger als 6 s`, alter[0]! < 6000, `= ${Math.round(alter[0]!)} ms`);
      check(`${fall.name}: Herzschlag — mtime nach 27 s Halten jünger als 6 s`, alter[1]! < 6000, `= ${Math.round(alter[1]!)} ms`);
      check(`${fall.name}: KEIN Doppelerfolg bei 35 s Haltedauer (genau 1 Erfolg)`, h.ok + a.ok === 1, `Halter ${h.ok}, Wartender ${a.ok}`);
      check(`${fall.name}: der Halter gewinnt, der Wartende wird als veraltet abgewiesen, ohne anderen Fehler`, h.ok === 1 && a.veraltet === 1 && a.andere.length === 0, JSON.stringify({ h, a }));
      check(`${fall.name}: der gemeldete Hash des Gewinners liegt auf der Platte`, h.hashes[0] === sha(readFileSync(pfadF)));
      check(`${fall.name}: keine .lock/.tmp zurückgeblieben`, !readdirSync(DIREKT).some((f) => f.startsWith(`herzschlag-`) && f.includes('.json.') && (f.endsWith('.lock') || f.endsWith('.tmp'))));
    }
  }

  // ── 26) F5: eine eigene Sperrleiche wird sofort gebrochen ───────────
  {
    const ePfad = resolve(DIREKT, 'eigene-leiche.json');
    writeFileSync(ePfad, sollText(koerper('leiche-start')));
    const echtesRm = fs.rmSync;
    const errAlt = console.error;
    const warnAlt3 = console.warn;
    const geloggt: string[] = [];
    console.error = () => undefined;
    console.warn = (...a: unknown[]) => void geloggt.push(a.join(' '));
    try {
      const modul = (await import('@wov/shared/src/worldlayout/layoutDatei.js')) as Record<string, unknown>;
      const asyncSchreiben = modul.layoutSchreibenAsync as ((p: string, e: unknown, b?: number, o?: Record<string, unknown>) => Promise<{ hash: string }>) | undefined;
      for (const weg of ['synchron', 'asynchron (Weg des Betriebsdienstes)']) {
        (fs as { rmSync: typeof echtesRm }).rmSync = ((p: string, o?: unknown) => {
          if (String(p).endsWith('.lock')) throw Object.assign(new Error('EROFS: simulated'), { code: 'EROFS' });
          return echtesRm(p, o as never);
        }) as typeof echtesRm;
        syncBuiltinESMExports();
        try {
          if (weg === 'synchron') layoutSchreiben(ePfad, koerper('mit-freigabefehler'));
          else await asyncSchreiben!(ePfad, koerper('mit-freigabefehler-async'));
        } finally {
          (fs as { rmSync: typeof echtesRm }).rmSync = echtesRm;
          syncBuiltinESMExports();
        }
        check(`eigene Leiche (${weg}): nach dem Freigabefehler liegt die Sperre noch da`, existsSync(`${ePfad}.lock`));
        geloggt.length = 0;
        const t = Date.now();
        let ergebnis = '';
        try {
          if (weg === 'synchron') layoutSchreiben(ePfad, koerper('nach-leiche'), undefined, { sperreWartenMs: 500 });
          else await asyncSchreiben!(ePfad, koerper('nach-leiche-async'), undefined, { sperreWartenMs: 500 });
          ergebnis = 'ok';
        } catch (f) {
          ergebnis = (f as Error).name;
        }
        const ms = Date.now() - t;
        check(`eigene Leiche (${weg}): der NÄCHSTE Schreibvorgang gelingt sofort (kein Dauer-503)`, ergebnis === 'ok' && ms < 400, `${ergebnis} nach ${ms} ms`);
        check(`eigene Leiche (${weg}): Logzeile „eigene Sperrleiche“`, geloggt.some((z) => /verwaiste Sperre .* gebrochen: eigene Sperrleiche/.test(z)), geloggt.join(' | '));
        check(`eigene Leiche (${weg}): danach keine .lock`, !existsSync(`${ePfad}.lock`));
      }
      // Eine Sperre, die dieser Prozess GERADE hält, wird nicht als Leiche gebrochen: 5 gleichzeitige asynchrone Schreiber.
      const hE = sha(readFileSync(ePfad));
      const r5 = await Promise.all(Array.from({ length: 5 }, (_, i) => asyncSchreiben!(ePfad, koerper(`gleichzeitig-e-${i}`), undefined, { basis: hE }).then(() => 'ok', (f: Error) => f.name)));
      check('eigene Leiche: eine GERADE gehaltene eigene Sperre wird nicht gebrochen (5 gleichzeitige, 1 ok, 4 veraltet)', r5.filter((x) => x === 'ok').length === 1 && r5.filter((x) => x === 'LayoutVeraltet').length === 4, r5.join(','));
    } finally {
      console.error = errAlt;
      console.warn = warnAlt3;
      (fs as { rmSync: typeof echtesRm }).rmSync = echtesRm;
      syncBuiltinESMExports();
    }
  }

  // ── 27) F8: Tmp-Dateien werden nur geräumt, wenn ihr Besitzer nachweislich tot ist ─
  {
    const tPfad2 = resolve(DIREKT, 'tmpbesitz.json');
    writeFileSync(tPfad2, sollText(koerper('tmp-start')));
    const tot = spawn(process.execPath, ['-e', '0']);
    await new Promise<void>((f) => tot.once('exit', () => f()));
    const lebend = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
    try {
      const vor = (ms: number): Date => new Date(Date.now() - ms);
      const lege = (name: string, alterMs: number): string => {
        const f = `${tPfad2}.${name}`;
        writeFileSync(f, 'halb');
        if (alterMs > 0) utimesSync(f, vor(alterMs), vor(alterMs));
        return f;
      };
      const a = lege(`${tot.pid}.aaaaaaaaaaaa.tmp`, 0); // Besitzer tot, ganz frisch
      const b = lege(`${lebend.pid}.bbbbbbbbbbbb.tmp`, 31_000); // Besitzer lebt, 31 s alt
      const c = lege(`${lebend.pid}.cccccccccccc.tmp`, 660_000); // Besitzer lebt, 11 min alt
      const d = lege('tmp', 31_000); // alter fester Name, 31 s alt
      layoutSchreiben(tPfad2, koerper('raeumt-tmp'));
      check('Tmp-Datei eines toten Prozesses wird sofort geräumt (auch ganz frisch)', !existsSync(a));
      check('Tmp-Datei eines LEBENDEN Prozesses, 31 s alt, bleibt liegen', existsSync(b));
      check('Tmp-Datei eines Lebenden, 11 min alt (pid womöglich wiederverwendet): wird geräumt', !existsSync(c));
      check('Tmp-Datei im alten festen Namen (ohne pid), 31 s alt, bleibt liegen', existsSync(d));
      rmSync(b);
      utimesSync(d, vor(660_000), vor(660_000));
      layoutSchreiben(tPfad2, koerper('raeumt-tmp-2'));
      check('Tmp-Datei im alten festen Namen, 11 min alt: wird geräumt', !existsSync(d));
    } finally {
      lebend.kill('SIGKILL');
    }
  }

  // stdin schließen beendet die Werkzeugprozesse (ihre Befehlsschleife läuft dann aus).
  wa.kind.stdin!.end();
  wb.kind.stdin!.end();
} finally {
  for (const k of kinder) k.removeAllListeners('exit');
  for (const k of kinder) k.kill();
  rmSync(ORDNER, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== WELTDOKUMENT-BASIS: ALL PASSED ===');
