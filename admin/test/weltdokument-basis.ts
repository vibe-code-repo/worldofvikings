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
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
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
      if (b.pausiereVorRenameMs) {
        (fs as { renameSync: typeof echtesRename }).renameSync = ((von: string, nach: string) => {
          if (nach === b.pfad) {
            if (b.markerPfad) writeFileSync(b.markerPfad, String(process.pid));
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, b.pausiereVorRenameMs!);
          }
          return echtesRename(von, nach);
        }) as typeof echtesRename;
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
    check('422 ungueltig: Logzeile im Betriebsdienst', /422 ungueltig: Feld placements ist keine Liste/.test(protokoll));
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

    // Verwaiste Tmp-Datei eines abgestürzten Schreibers wird beim nächsten Schreiben weggeräumt.
    const leiche = `${sPfad}.4242.deadbeef00.tmp`;
    const frisch = `${sPfad}.4243.deadbeef01.tmp`;
    writeFileSync(leiche, 'halb');
    utimesSync(leiche, vor, vor);
    writeFileSync(frisch, 'noch in Arbeit');
    layoutSchreiben(sPfad, koerper('raeumt-auf'));
    check('alte Tmp-Leiche wird weggeräumt', !existsSync(leiche));
    check('frische Tmp-Datei (evtl. lebender Schreiber) bleibt', existsSync(frisch));
    rmSync(frisch);

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
    for (let i = 0; i < 10; i++) {
      const t = Date.now();
      await fetch(`http://127.0.0.1:${port}/status`, { headers: { 'x-wov-token': TOKEN } });
      leerlauf.push(Date.now() - t);
    }
    const halterFertig = halter.fragen({ cmd: 'direkt', pfad: WELT_DATEI, basis: null, startAt: 0, anzahl: 1, tag: 'halter', pausiereVorRenameMs: 1800, markerPfad: marker });
    for (let i = 0; i < 200 && !existsSync(marker); i++) await warte(20);
    const tPost = Date.now();
    const wartender = anfrage('POST', { leib: koerper('wartender'), ifMatch: `"${hH}"` });
    const proben: number[] = [];
    while (Date.now() - tPost < 1400) {
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
    console.log(`# Ereignisschleife: /status ohne Sperre max ${Math.max(...leerlauf)} ms; mit fremder Sperre ${proben.length} Proben, max ${maximum} ms; wartender POST → ${w.status} nach ${msPost} ms`);
    check('Sperre gehalten: GET /status antwortet immer in < 50 ms', maximum < 50, `max ${maximum} ms, Proben ${proben.join(',')}`);
    check('Sperre gehalten: der wartende POST hat gewartet (≥ 1 s) und ist danach 409 (Halter hat geschrieben), nicht 503', w.status === 409 && msPost >= 1000, `= ${w.status} nach ${msPost} ms`);
    check('Sperre gehalten: der 409 nennt den Hash des Halters', w.daten.aktuell === plattenHash());
    halter.kind.stdin!.end();
  }

  // ── 17) Wann eine Sperre gebrochen wird (Besitzangabe in der Sperrdatei) ─
  {
    const zPfad = resolve(DIREKT, 'besitz.json');
    writeFileSync(zPfad, sollText(koerper('besitz-start')));
    const meineStartzeit = ((): string | null => {
      try {
        const s = readFileSync('/proc/self/stat', 'utf-8');
        return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] ?? null;
      } catch {
        return null;
      }
    })();
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
      sperreSchreiben({ pid: process.pid, start: meineStartzeit, host: hostname(), marke: 'lebend' }, 7_200_000);
      r = versuch({ sperreWartenMs: 250, sperreVeraltetMs: 1000 });
      check('lebender Besitzer, Sperre 2 h alt: LayoutGesperrt, NICHT gebrochen', !r.ok && r.name === 'LayoutGesperrt', JSON.stringify(r));
      check('lebender Besitzer: Datei unverändert, Sperre bleibt liegen', readFileSync(zPfad, 'utf-8') === vorher && JSON.parse(readFileSync(lockDatei, 'utf-8')).marke === 'lebend');
      check('lebender Besitzer: Logzeile ab 30 s („wird NICHT gebrochen")', log.some((z) => /wird NICHT gebrochen/.test(z)), log.join(' | '));
      sperreSchreiben({ pid: process.pid, start: null, host: hostname(), marke: 'lebend2' }, 7_200_000);
      r = versuch({ sperreWartenMs: 250 });
      check('lebender Besitzer ohne Startzeit in der Sperre: ebenfalls nie gebrochen', !r.ok && r.name === 'LayoutGesperrt', JSON.stringify(r));

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
      check('Besitzer auf anderem Rechner: nicht entscheidbar, Sperre bleibt', !r.ok && r.name === 'LayoutGesperrt' && existsSync(lockDatei), JSON.stringify(r));
      rmSync(lockDatei);

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
      sperreSchreiben({ pid: process.pid, start: meineStartzeit, host: hostname(), marke: 'lebend3' });
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
    const vor = new Date(Date.now() - 60_000);
    utimesSync(alt, vor, vor);
    layoutSchreiben(lPfad, koerper('alt-danach'));
    check('Tmp-Leiche im alten Schema (60 s alt) wird beim nächsten Schreiben geräumt', !existsSync(alt));
    writeFileSync(alt, 'frisch');
    layoutSchreiben(lPfad, koerper('alt-danach-2'));
    check('… eine frische bleibt liegen', existsSync(alt));
    rmSync(alt);
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
