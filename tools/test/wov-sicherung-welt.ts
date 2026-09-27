/**
 * tools/wov-sicherung.sh sichert die Arbeitskopie der Welt samt Basis (editor stage E2, card K5.7, N3).
 *
 *   npx tsx tools/test/wov-sicherung-welt.ts      (from any directory)
 *
 * Kurzfassung der grossen Probe (tools/test/wov-sicherung-probe.sh, ~70 s), nur fuer die Weltdatei:
 *  1. Probe-Haken WOV_SICHERUNG_DATEN gilt VOR WOV_WELT_VERZEICHNIS: mit exportierter Variable (auf ein anderes
 *     Verzeichnis mit anderer dev.json) sichert das Skript trotzdem die Datei aus dem Datenordner der Probe;
 *  2. die Basis (dev.basis) neben der Weltdatei wird byte-gleich mitgesichert;
 *  3. ohne den Haken, mit WOV_WELT_VERZEICHNIS: gesichert wird dessen dev.json samt dev.basis;
 *  4. ohne den Haken und ohne die Variable: <Daten>/welten-arbeit/dev.json (wie der Spielserver), NICHT
 *     /var/lib/wov/welten;
 *  5. ein relatives WOV_WELT_VERZEICHNIS bricht ab;
 *  6. Leerzeichen am Rand des Wertes werden abgeschnitten, ein Wert nur aus Leerzeichen bricht ab (N2);
 *  7. im DEV-Deployment (Haken WOV_DEV_CHECKOUT) verweigert die Sicherung ohne die Variable nur den Welt-Teil: Datenbanken
 *     werden gesichert, Exit 1 am Ende (M-A).
 * Alles unter einem Temp-Verzeichnis; /var/lib/wov wird nie gelesen oder geschrieben (der Test prueft es nur auf Aenderungen).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUELLE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`ok   ${name}`);
  }
}
const varLibWov = (): string => (existsSync('/var/lib/wov') ? `${readdirSync('/var/lib/wov').sort().join(',')}@${statSync('/var/lib/wov').mtimeMs}` : 'fehlt');
const vor = varLibWov();

const T = mkdtempSync(resolve(tmpdir(), 'wov-sicherung-welt-'));
const DATEN = resolve(T, 'daten');
const ANDERE = resolve(T, 'andere');
const WURZEL = resolve(T, 'wurzel');
const ZIEL = resolve(T, 'ziel');
const lies = (p: string): string => {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return '<fehlt>';
  }
};
const hash = (s: string): string => s.repeat(64).slice(0, 64);

try {
  for (const d of ['worlds', 'welten', 'konten', 'forum', 'dungeons/dev']) mkdirSync(resolve(DATEN, d), { recursive: true });
  mkdirSync(ANDERE, { recursive: true });
  const zstd = spawnSync('zstd', ['-q', '--no-check', '-o', resolve(DATEN, 'worlds/dev.db.zst')], { input: Buffer.alloc(4096, 7) });
  check('Testdaten: zstd vorhanden, Weltdatei-Attrappe angelegt', zstd.status === 0, String(zstd.stderr));
  writeFileSync(resolve(DATEN, 'server.yml'), 'x: 1\n');
  writeFileSync(resolve(DATEN, 'welten/dev.json'), '{"welt":"daten-welten"}\n');
  writeFileSync(resolve(DATEN, 'welten/dev.basis'), `${hash('a')}\n`);
  writeFileSync(resolve(ANDERE, 'dev.json'), '{"welt":"andere"}\n');
  writeFileSync(resolve(ANDERE, 'dev.basis'), `${hash('b')}\n`);
  mkdirSync(resolve(DATEN, 'welten-arbeit'), { recursive: true });
  writeFileSync(resolve(DATEN, 'welten-arbeit/dev.json'), '{"welt":"welten-arbeit"}\n');
  writeFileSync(resolve(DATEN, 'welten-arbeit/dev.basis'), `${hash('c')}\n`);
  const py = spawnSync(
    'python3',
    [
      '-c',
      `import sqlite3, sys
d = sys.argv[1]
k = sqlite3.connect(d + "/konten/dev.db")
k.execute("CREATE TABLE konten(id INTEGER PRIMARY KEY)")
k.execute("CREATE TABLE charaktere(id INTEGER PRIMARY KEY)")
k.commit(); k.close()
f = sqlite3.connect(d + "/forum/dev.db")
for t in ("boards", "threads", "posts"):
    f.execute("CREATE TABLE %s(id INTEGER PRIMARY KEY)" % t)
f.commit(); f.close()`,
      DATEN,
    ],
    { encoding: 'utf-8' }
  );
  check('Testdaten: Konten- und Forum-DB angelegt', py.status === 0, py.stderr);
  writeFileSync(resolve(T, 'wov.env'), 'WOV_INSTANZ=dev\n');
  // Nachgebaute Wurzel wie in der grossen Probe: <wurzel>/tools/wov-sicherung.sh, <wurzel>/server/data -> DATEN.
  mkdirSync(resolve(WURZEL, 'tools'), { recursive: true });
  mkdirSync(resolve(WURZEL, 'server'), { recursive: true });
  copyFileSync(resolve(QUELLE, 'tools/wov-sicherung.sh'), resolve(WURZEL, 'tools/wov-sicherung.sh'));
  chmodSync(resolve(WURZEL, 'tools/wov-sicherung.sh'), 0o755);
  symlinkSync(DATEN, resolve(WURZEL, 'server/data'));

  const laufNr = { n: 0 };
  const lauf = (env: NodeJS.ProcessEnv): { rc: number; aus: string; ordner: string; fehlerhaft: string } => {
    const ziel = resolve(ZIEL, `l${laufNr.n++}`);
    const umgebung: NodeJS.ProcessEnv = { ...process.env, WOV_ENV_DATEI: resolve(T, 'wov.env'), WOV_SICHERUNG_ZIEL: ziel, WOV_SICHERUNG_MINDEST_FREI_MB: '1', WOV_SICHERUNG_DB_FRIST: '60' };
    delete umgebung.WOV_WELT_VERZEICHNIS;
    delete umgebung.WOV_SICHERUNG_DATEN;
    delete umgebung.WOV_DEV_CHECKOUT;
    const r = spawnSync('bash', [resolve(WURZEL, 'tools/wov-sicherung.sh')], { env: { ...umgebung, ...env }, encoding: 'utf-8' });
    const dev = resolve(ziel, 'dev');
    const laeufe = existsSync(dev) ? readdirSync(dev).filter((n) => !n.includes('.')).sort() : [];
    const kaputt = existsSync(dev) ? readdirSync(dev).filter((n) => n.endsWith('.fehlerhaft')).sort() : [];
    return { rc: r.status ?? -1, aus: `${r.stdout}${r.stderr}`, ordner: laeufe.length > 0 ? resolve(dev, laeufe[laeufe.length - 1]!) : '', fehlerhaft: kaputt.length > 0 ? resolve(dev, kaputt[kaputt.length - 1]!) : '' };
  };

  // 1+2) Haken + exportierte Variable
  const a = lauf({ WOV_SICHERUNG_DATEN: DATEN, WOV_WELT_VERZEICHNIS: ANDERE });
  check('Haken + exportierte Variable: Exit 0', a.rc === 0, a.aus.slice(-400));
  check('Haken gilt vor der Variable: gesichert ist die Weltdatei aus dem Datenordner der Probe', a.ordner !== '' && lies(resolve(a.ordner, 'welten/dev.json')) === lies(resolve(DATEN, 'welten/dev.json')));
  check('Basis mitgesichert (welten/dev.basis), byte-gleich', a.ordner !== '' && lies(resolve(a.ordner, 'welten/dev.basis')) === lies(resolve(DATEN, 'welten/dev.basis')));

  // 3) Variable, ohne Haken
  const b = lauf({ WOV_WELT_VERZEICHNIS: ANDERE });
  check('Variable ohne Haken: Exit 0, gesichert ist dev.json samt dev.basis aus dem Variablen-Ordner', b.rc === 0 && b.ordner !== '' && lies(resolve(b.ordner, 'welten/dev.json')) === lies(resolve(ANDERE, 'dev.json')) && lies(resolve(b.ordner, 'welten/dev.basis')) === lies(resolve(ANDERE, 'dev.basis')), b.aus.slice(-300));

  // 4) weder Haken noch Variable
  const c = lauf({});
  check('ohne Haken und ohne Variable: gesichert ist <Daten>/welten-arbeit/dev.json samt Basis (nicht /var/lib/wov)', c.rc === 0 && c.ordner !== '' && lies(resolve(c.ordner, 'welten/dev.json')) === lies(resolve(DATEN, 'welten-arbeit/dev.json')) && lies(resolve(c.ordner, 'welten/dev.basis')) === lies(resolve(DATEN, 'welten-arbeit/dev.basis')) && !/\/var\/lib\/wov/.test(c.aus), c.aus.slice(-300));

  // 5) relativer Wert
  const d = lauf({ WOV_WELT_VERZEICHNIS: 'relwelt' });
  check('relatives WOV_WELT_VERZEICHNIS: Abbruch mit Meldung, kein Lauf-Ordner', d.rc !== 0 && /kein absoluter Pfad/.test(d.aus) && d.ordner === '', d.aus.slice(-200));

  // 6) N2: Leerzeichen am Rand werden abgeschnitten (wie im TS-Weg), nie still die Repo-Datei
  const e1 = lauf({ WOV_WELT_VERZEICHNIS: `${ANDERE} ` });
  check('Leerzeichen am Ende: gesichert ist dev.json samt Basis aus dem Variablen-Ordner (nicht die Repo-Datei)', e1.rc === 0 && e1.ordner !== '' && lies(resolve(e1.ordner, 'welten/dev.json')) === lies(resolve(ANDERE, 'dev.json')) && lies(resolve(e1.ordner, 'welten/dev.basis')) === lies(resolve(ANDERE, 'dev.basis')) && !/fehlt, gesichert wird ersatzweise/.test(e1.aus), e1.aus.slice(-300));
  const e2 = lauf({ WOV_WELT_VERZEICHNIS: `  ${ANDERE}\t` });
  check('Leerzeichen und Tabulator an beiden Enden: derselbe Ordner', e2.rc === 0 && e2.ordner !== '' && lies(resolve(e2.ordner, 'welten/dev.json')) === lies(resolve(ANDERE, 'dev.json')), e2.aus.slice(-300));
  const e3 = lauf({ WOV_WELT_VERZEICHNIS: '   ' });
  check('nur Leerzeichen: Abbruch mit Meldung (leer), kein Lauf-Ordner', e3.rc !== 0 && /ist leer/.test(e3.aus) && e3.ordner === '', e3.aus.slice(-200));
  const e4 = lauf({ WOV_WELT_VERZEICHNIS: ` relwelt` });
  check('relativ mit fuehrendem Leerzeichen: Abbruch mit Meldung, kein Lauf-Ordner', e4.rc !== 0 && /kein absoluter Pfad/.test(e4.aus) && e4.ordner === '', e4.aus.slice(-200));

  // 7) M1: im DEV-Deployment ohne die Variable bricht die Sicherung ab (nicht still <Daten>/welten-arbeit)
  // N3 (M-A): nur der WELT-Teil wird verweigert. Spielstand, Konten und Forum werden gesichert, der Lauf endet mit Exit 1
  // und bleibt als <stempel>.fehlerhaft liegen (wie bei einer kaputten Datenbank), ohne Weltdatei und ohne Basis.
  const f1 = lauf({ WOV_DEV_CHECKOUT: WURZEL });
  const f1o = f1.fehlerhaft;
  check('DEV-Checkout ohne Variable: Exit 1 mit Meldung (DEV-Deployment, Welt-Teil nicht gesichert, Aufruf mit der Variable)', f1.rc === 1 && /DEV-Deployment/.test(f1.aus) && /Welt-Teil/.test(f1.aus) && /WOV_WELT_VERZEICHNIS=\/var\/lib\/wov\/welten/.test(f1.aus), f1.aus.slice(-400));
  check('DEV-Checkout ohne Variable: Spielstand, Konten und Forum sind trotzdem gesichert (worlds/dev.db.zst, konten/dev.db, forum/dev.db)', f1o !== '' && existsSync(resolve(f1o, 'worlds/dev.db.zst')) && existsSync(resolve(f1o, 'konten/dev.db')) && existsSync(resolve(f1o, 'forum/dev.db')), f1.aus.slice(-400));
  check('DEV-Checkout ohne Variable: die Weltdatei und die Basis sind NICHT gesichert (auch nicht die Repo- oder welten-arbeit-Datei), kein gueltiger Lauf-Ordner', f1o !== '' && !existsSync(resolve(f1o, 'welten/dev.json')) && !existsSync(resolve(f1o, 'welten/dev.basis')) && f1.ordner === '', f1.aus.slice(-400));
  // N4 (M-A-2): kein leerer welten/-Ordner im Teillauf; die Rueckspielanleitung nennt den .fehlerhaft-Ordner der Teilsicherung
  // ausdruecklich als brauchbar fuer DB, Konten und Forum; der veraltete Kommentar ("bricht das Skript ... ab") ist weg.
  check('DEV-Checkout ohne Variable: im .fehlerhaft-Ordner gibt es keinen (leeren) welten/-Ordner', f1o !== '' && !existsSync(resolve(f1o, 'welten')), f1o === '' ? 'kein Ordner' : readdirSync(f1o).join(','));
  const skriptText = readFileSync(resolve(QUELLE, 'tools/wov-sicherung.sh'), 'utf-8');
  const anleitung = /So spielst du eine Sicherung zurück[\s\S]*?Server starten/.exec(skriptText)?.[0] ?? '';
  check('Rueckspielanleitung: ein .fehlerhaft-Ordner der Teilsicherung enthaelt gueltige DB-, Konten- und Forum-Staende', /\.fehlerhaft/.test(anleitung) && /Teilsicherung/.test(anleitung) && /Konten und Forum/.test(anleitung), anleitung.slice(0, 500));
  check('veralteter Kommentar ("bricht das Skript ohne die Variable ab") ist berichtigt', !/bricht das Skript ohne die Variable ab/.test(skriptText));
  const f2 = lauf({ WOV_DEV_CHECKOUT: WURZEL, WOV_WELT_VERZEICHNIS: ANDERE });
  check('DEV-Checkout mit Variable: Exit 0, gesichert ist der Variablen-Ordner', f2.rc === 0 && f2.ordner !== '' && lies(resolve(f2.ordner, 'welten/dev.json')) === lies(resolve(ANDERE, 'dev.json')), f2.aus.slice(-300));

  check('/var/lib/wov unveraendert', varLibWov() === vor);
} finally {
  rmSync(T, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nwov-sicherung-welt: alles gruen');
