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
 * Der Test bezieht neue Exporte nicht statisch aus layoutDatei.ts (Fehler
 * werden am Namen erkannt, der Hash mit node:crypto gebildet), damit er auf
 * dem Stand VOR der Änderung an einer Behauptung scheitert statt an einem
 * fehlenden Import.
 */
import { spawn, type ChildProcess } from 'node:child_process';
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
import { tmpdir } from 'node:os';
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
      for (let i = 0; i < (b.anzahl ?? 1); i++) {
        const name = `${b.tag}-${i}`;
        try {
          layoutSchreiben(b.pfad!, koerper(name), undefined, { basis: b.basis ?? null });
          ok++;
          erfolge.push(name);
        } catch (f) {
          if ((f as Error).name === 'LayoutVeraltet') veraltet++;
          else andere.push(`${(f as Error).name}: ${(f as Error).message}`);
        }
      }
      console.log(JSON.stringify({ ok, veraltet, andere, erfolge }));
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

  // ── 9) Wettlauf: zwei Prozesse, 20 POSTs, dieselbe Basis ────────────
  const [wa, wb] = await Promise.all([werkerStarten(), werkerStarten()]);
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
    check('verwaiste Sperre (60 s alt) wird gebrochen, Schreiben gelingt', gebrochen && readFileSync(sPfad, 'utf-8') === sollText(koerper('nach-verwaister-sperre')));
    check('verwaiste Sperre: Logzeile', gewarnt.some((z) => /verwaiste Sperre .* gebrochen/.test(z)), gewarnt.join(' | '));
    check('verwaiste Sperre: danach keine .lock', !existsSync(`${sPfad}.lock`));

    const beiDerFrischen = readFileSync(sPfad, 'utf-8');
    writeFileSync(`${sPfad}.lock`, 'lebender-prozess');
    let fehlerName = '';
    try {
      layoutSchreiben(sPfad, koerper('gegen-frische-sperre'), undefined, { sperreWartenMs: 200 });
    } catch (f) {
      fehlerName = (f as Error).name;
    }
    check('frische fremde Sperre: LayoutGesperrt nach kurzer Wartezeit', fehlerName === 'LayoutGesperrt', `= "${fehlerName}"`);
    check('frische fremde Sperre: Datei unverändert', readFileSync(sPfad, 'utf-8') === beiDerFrischen);
    check('frische fremde Sperre: bleibt liegen, gehört weiter dem anderen', readFileSync(`${sPfad}.lock`, 'utf-8') === 'lebender-prozess');
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
