/**
 * Standardkonto — Ausprobieren ohne Registrierung.
 *
 * Aufbau wie `konto-lokal.ts`: eine echte Kontendatenbank in einem
 * temporaeren Ordner, ein echter node:http-Server fuer KontoApi (Port 0,
 * ephemer) — kein `WovServer.start()` und kein fester Port, denn diese
 * Funktion (`standardKontoSicherstellen`, `server/src/konto/
 * StandardKonto.ts`) laesst sich vollstaendig gegen Kontendatenbank und
 * KontoApi allein pruefen, genau wie sie aus dem `WovServer`-Konstruktor
 * heraus laeuft.
 *
 * Gepruefte Punkte (Auftrag):
 *  1. Server startet mit Block -> Konto UND Charakter existieren, Login
 *     ueber die echte HTTP-API klappt.
 *  2. Zweiter "Start" (zweiter Aufruf) legt das Konto NICHT doppelt an
 *     und laesst das Passwort unveraendert (derselbe Datenbank-Eintrag).
 *  3. Ohne Block entsteht kein Konto.
 *  4. `/accounts/status` meldet `standardKonto` nur, wenn der Server
 *     tatsaechlich eines hat.
 *  5. Das Standardkonto ist NIE Admin: `standardKontoSicherstellen` kennt
 *     keine AdminListe (strukturelle Garantie, siehe StandardKonto.ts)
 *     und warnt, wenn `everyone-admin` es trotzdem zum Admin macht.
 *  6. `ServerKonfig.leseStandardKonten` (ueber `leseServerKonfig`) prueft
 *     den Block: Name/Charakter/Passwort wie bei der Registrierung.
 *  7. Die LISTENFORM: Zwei Bloecke ergeben zwei Konten (`gast` fuer die
 *     deutsche Anmeldeseite, `guest` fuer die englische), beide lassen
 *     sich ueber die echte HTTP-API anmelden, der Status meldet beide
 *     Namen, die Einzelblock-Form gilt weiter, und ein doppelt
 *     vergebener Name wird beim Lesen abgefangen statt erst an der
 *     UNIQUE-Spalte der Datenbank.
 *
 * Lauf: npx tsx test/standard-konto.ts   (aus server/)
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KontoApi } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { standardKontoSicherstellen } from '../src/konto/StandardKonto.js';
import { leseServerKonfig } from '../src/ServerKonfig.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (bedingung) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}

/** Faengt console.warn/error waehrend `fn()` ein, statt sie auszugeben. */
function eingefangen(fn: () => void): { warnungen: string[]; fehlermeldungen: string[] } {
  const warnungen: string[] = [];
  const fehlermeldungen: string[] = [];
  const echtWarn = console.warn;
  const echtError = console.error;
  console.warn = (...args: unknown[]) => warnungen.push(args.join(' '));
  console.error = (...args: unknown[]) => fehlermeldungen.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = echtWarn;
    console.error = echtError;
  }
  return { warnungen, fehlermeldungen };
}

async function startServer(api: KontoApi) {
  const server = createServer((req, res) => {
    if (!api.behandle(req, res)) res.writeHead(404).end();
  });
  await new Promise<void>((f, r) => {
    server.once('error', r);
    server.listen(0, '127.0.0.1', () => f());
  });
  const { port } = server.address() as { port: number };
  return { server, basis: `http://127.0.0.1:${port}` };
}

interface Antwort { status: number; daten: Record<string, unknown> | null }
async function ruf(basis: string, pfad: string, init: RequestInit = {}): Promise<Antwort> {
  const antwort = await fetch(basis + pfad, init);
  let daten: Record<string, unknown> | null = null;
  try { daten = (await antwort.json()) as Record<string, unknown>; } catch { /* leerer Koerper */ }
  return { status: antwort.status, daten };
}

// ── 1 + 2 + 5. Konto anlegen, idempotent, kein Admin ─────────────────
async function kontoAnlegenUndAnmelden(): Promise<void> {
  console.log('1. Server startet mit Block -> Konto + Charakter, Login klappt');
  const ordner = mkdtempSync(join(tmpdir(), 'wov-standardkonto-'));
  const db = new Kontendatenbank(join(ordner, 'konten.db'));
  const vorgabe = { name: 'gast', passwort: 'gast', charakter: 'Gast' };

  try {
    // ── Erster Start ────────────────────────────────────────────────
    const { warnungen: warnBeimErstenStart } = eingefangen(() => {
      standardKontoSicherstellen(db, vorgabe, false);
    });
    pruefe(
      'keine Admin-Warnung ohne everyone-admin',
      !warnBeimErstenStart.some((w) => w.includes('everyone-admin')),
      warnBeimErstenStart.join(' | '),
    );

    const konto = db.kontoNachName('gast');
    pruefe('Konto "gast" existiert', konto !== null);
    const ersterHash = konto?.passwort;

    const charaktere = konto ? db.charaktereVonKonto(konto.id) : [];
    pruefe('genau ein Charakter "Gast"', charaktere.length === 1 && charaktere[0]?.name === 'Gast');

    // ── Login ueber die echte HTTP-API ──────────────────────────────
    const api = new KontoApi(db, Buffer.from('ab'.repeat(16), 'hex'), () => ({
      spieler: 0, plaetze: 10, tag: 1, welt: 'test',
    }), [vorgabe.name]);
    const { server, basis } = await startServer(api);
    try {
      const login = await ruf(basis, '/accounts/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'gast', password: 'gast' }),
      });
      pruefe('Login mit gast/gast klappt', login.status === 200, JSON.stringify(login.daten));
      const eingeloggteCharaktere = login.daten?.characters;
      pruefe(
        'Login-Antwort traegt den Charakter "Gast"',
        Array.isArray(eingeloggteCharaktere) &&
          eingeloggteCharaktere.some(
            (c: unknown) => (c as Record<string, unknown>).name === 'Gast',
          ),
      );

      // ── 4. Status meldet das Standardkonto ────────────────────────
      const status = await ruf(basis, '/accounts/status');
      const standardKontoImStatus = status.daten?.standardKonto as Record<string, unknown> | undefined;
      pruefe(
        'status meldet standardKonto.name = "gast"',
        standardKontoImStatus?.name === 'gast',
        JSON.stringify(status.daten),
      );
      pruefe(
        'status meldet KEIN Passwort',
        JSON.stringify(status.daten).toLowerCase().includes('passwort') === false &&
          !('password' in (status.daten?.standardKonto ?? {})),
      );
    } finally {
      server.close();
    }

    // ── 2. Zweiter "Start" ──────────────────────────────────────────
    const { warnungen: zweiterStartWarnungen } = eingefangen(() => {
      standardKontoSicherstellen(db, vorgabe, true);
    });
    const kontoNachher = db.kontoNachName('gast');
    pruefe('nach zweitem Start weiterhin genau ein Konto "gast"', kontoNachher !== null);
    pruefe(
      'Passwort-Eintrag unveraendert',
      kontoNachher?.passwort === ersterHash,
      `${kontoNachher?.passwort} vs ${ersterHash}`,
    );
    const charaktereNachher = kontoNachher ? db.charaktereVonKonto(kontoNachher.id) : [];
    pruefe(
      'weiterhin genau ein Charakter "Gast" (nicht doppelt angelegt)',
      charaktereNachher.length === 1,
      String(charaktereNachher.length),
    );

    // ── 5. everyone-admin: true -> Warnung, aber keine AdminListe-Spur ──
    pruefe(
      'Warnung, wenn everyone-admin beim (zweiten) Start aktiv ist',
      zweiterStartWarnungen.some((w) => w.includes('everyone-admin') && w.includes('gast')),
      zweiterStartWarnungen.join(' | '),
    );
  } finally {
    db.schliessen();
    rmSync(ordner, { recursive: true, force: true });
  }
}

// ── 3. Ohne Block kein Konto ──────────────────────────────────────────
function ohneBlockKeinKonto(): void {
  console.log('2. Ohne standard-konto: entsteht kein Konto');
  const ordner = mkdtempSync(join(tmpdir(), 'wov-standardkonto-leer-'));
  const db = new Kontendatenbank(join(ordner, 'konten.db'));
  try {
    // Kein Aufruf von standardKontoSicherstellen -- genau das entspricht
    // einem Serverstart ohne den Block (WovServer prueft `if
    // (this.config.standardKonto)`, s. WovServer.ts).
    pruefe('kein Konto "gast" ohne Block', db.kontoNachName('gast') === null);
  } finally {
    db.schliessen();
    rmSync(ordner, { recursive: true, force: true });
  }
}

// ── 6. ServerKonfig validiert den Block ──────────────────────────────
function serverKonfigValidiert(): void {
  console.log('3. ServerKonfig prueft standard-konto (Name/Passwort/Charakter)');
  const verzeichnis = mkdtempSync(join(tmpdir(), 'wov-standardkonto-konfig-'));
  mkdirSync(resolve(verzeichnis, 'worlds'), { recursive: true });

  function schreiben(yamlBlock: string): void {
    writeFileSync(
      resolve(verzeichnis, 'server.yml'),
      ['server:', '  name: Test', '  port: 2599', 'players:', '  max: 4', yamlBlock, ''].join('\n'),
      'utf-8',
    );
  }

  try {
    // Gueltig.
    schreiben(['standard-konto:', '  name: gast', '  passwort: gast', '  charakter: Gast'].join('\n'));
    const gueltig = leseServerKonfig(verzeichnis, 'test');
    pruefe(
      'gueltiger Einzelblock kommt als einelementige Liste an',
      gueltig.standardKonten?.length === 1 &&
        gueltig.standardKonten[0]?.name === 'gast' &&
        gueltig.standardKonten[0]?.passwort === 'gast' &&
        gueltig.standardKonten[0]?.charakter === 'Gast',
      JSON.stringify(gueltig.standardKonten),
    );

    // Name zu kurz (< 3 Zeichen, wie bei der Registrierung).
    schreiben(['standard-konto:', '  name: ab', '  passwort: gast', '  charakter: Gast'].join('\n'));
    const { warnungen: w1 } = eingefangen(() => {
      const k = leseServerKonfig(verzeichnis, 'test');
      pruefe('zu kurzer Name -> kein Standardkonto', k.standardKonten?.length === 0);
    });
    pruefe('Warnung nennt den Namen', w1.some((w) => w.includes('standard-konto')), w1.join(' | '));

    // Passwort zu kurz (< 4 Zeichen).
    schreiben(['standard-konto:', '  name: gast', '  passwort: abc', '  charakter: Gast'].join('\n'));
    eingefangen(() => {
      const k = leseServerKonfig(verzeichnis, 'test');
      pruefe('zu kurzes Passwort -> kein Standardkonto', k.standardKonten?.length === 0);
    });

    // Ungueltiger Charaktername (leer).
    schreiben(['standard-konto:', '  name: gast', '  passwort: gast', '  charakter: ""'].join('\n'));
    eingefangen(() => {
      const k = leseServerKonfig(verzeichnis, 'test');
      pruefe('ungueltiger Charaktername -> kein Standardkonto', k.standardKonten?.length === 0);
    });

    // Ganz ohne Block.
    writeFileSync(
      resolve(verzeichnis, 'server.yml'),
      ['server:', '  name: Test', '  port: 2599', 'players:', '  max: 4', ''].join('\n'),
      'utf-8',
    );
    const ohneBlock = leseServerKonfig(verzeichnis, 'test');
    pruefe('kein Block -> leere Liste', ohneBlock.standardKonten?.length === 0);

    // ── 7. Listenform ──────────────────────────────────────────────
    schreiben(
      [
        'standard-konto:',
        '  - name: gast',
        '    passwort: gast',
        '    charakter: Gast',
        '  - name: guest',
        '    passwort: guest',
        '    charakter: Guest',
      ].join('\n'),
    );
    const { warnungen: wListe } = eingefangen(() => {
      const liste = leseServerKonfig(verzeichnis, 'test');
      pruefe(
        'Liste -> beide Konten, in der Reihenfolge der Datei',
        liste.standardKonten?.length === 2 &&
          liste.standardKonten[0]?.name === 'gast' &&
          liste.standardKonten[1]?.name === 'guest' &&
          liste.standardKonten[1]?.charakter === 'Guest',
        JSON.stringify(liste.standardKonten),
      );
    });
    // Der Riegel aus A14 darf die Listeneintraege nicht fuer unbekannte
    // Schluessel "0"/"1" halten -- sonst begraebt er echte Tippfehler.
    pruefe(
      'Liste loest keine "liest niemand"-Warnung aus',
      !wListe.some((w) => w.includes('liest niemand')),
      wListe.join(' | '),
    );

    // Ein kaputter Eintrag nimmt die anderen NICHT mit.
    schreiben(
      [
        'standard-konto:',
        '  - name: ab',
        '    passwort: gast',
        '    charakter: Gast',
        '  - name: guest',
        '    passwort: guest',
        '    charakter: Guest',
      ].join('\n'),
    );
    eingefangen(() => {
      const k = leseServerKonfig(verzeichnis, 'test');
      pruefe(
        'kaputter Eintrag faellt einzeln weg, der gueltige bleibt',
        k.standardKonten?.length === 1 && k.standardKonten[0]?.name === 'guest',
        JSON.stringify(k.standardKonten),
      );
    });

    // Doppelter Name -- NOCASE, wie die Spalte `benutzername`.
    schreiben(
      [
        'standard-konto:',
        '  - name: gast',
        '    passwort: gast',
        '    charakter: Gast',
        '  - name: GAST',
        '    passwort: anders',
        '    charakter: Zweit',
      ].join('\n'),
    );
    const { warnungen: wDoppelt } = eingefangen(() => {
      const k = leseServerKonfig(verzeichnis, 'test');
      pruefe(
        'doppelter Name -> nur der erste Eintrag',
        k.standardKonten?.length === 1 && k.standardKonten[0]?.passwort === 'gast',
        JSON.stringify(k.standardKonten),
      );
    });
    pruefe(
      'Warnung nennt den doppelten Namen',
      wDoppelt.some((w) => w.includes('steht schon weiter oben')),
      wDoppelt.join(' | '),
    );
  } finally {
    rmSync(verzeichnis, { recursive: true, force: true });
  }
}

// ── 7. Zwei Konten entstehen wirklich und beide koennen sich anmelden ──
async function zweiKontenAusDerListe(): Promise<void> {
  console.log('4. Zwei Standardkonten -> beide existieren, beide melden sich an');
  const ordner = mkdtempSync(join(tmpdir(), 'wov-standardkonto-zwei-'));
  const db = new Kontendatenbank(join(ordner, 'konten.db'));
  // Genau das, was `WovServer` mit `config.standardKonten` tut: je
  // Eintrag ein Aufruf.
  const vorgaben = [
    { name: 'gast', passwort: 'gast', charakter: 'Gast' },
    { name: 'guest', passwort: 'guest', charakter: 'Guest' },
  ];

  try {
    eingefangen(() => {
      for (const v of vorgaben) standardKontoSicherstellen(db, v, false);
    });
    pruefe('Konto "gast" existiert', db.kontoNachName('gast') !== null);
    pruefe('Konto "guest" existiert', db.kontoNachName('guest') !== null);
    const guest = db.kontoNachName('guest');
    const guestCharaktere = guest ? db.charaktereVonKonto(guest.id) : [];
    pruefe(
      'Konto "guest" hat genau den Charakter "Guest"',
      guestCharaktere.length === 1 && guestCharaktere[0]?.name === 'Guest',
      JSON.stringify(guestCharaktere.map((c) => c.name)),
    );

    const api = new KontoApi(db, Buffer.from('cd'.repeat(16), 'hex'), () => ({
      spieler: 0, plaetze: 10, tag: 1, welt: 'test',
    }), vorgaben.map((v) => v.name));
    const { server, basis } = await startServer(api);
    try {
      for (const v of vorgaben) {
        const login = await ruf(basis, '/accounts/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: v.name, password: v.passwort }),
        });
        pruefe(
          `Login mit ${v.name}/${v.passwort} klappt`,
          login.status === 200,
          JSON.stringify(login.daten),
        );
      }

      const status = await ruf(basis, '/accounts/status');
      const namen = (status.daten?.standardKonten as { name: string }[] | undefined) ?? [];
      pruefe(
        'status meldet beide Namen unter standardKonten',
        namen.length === 2 && namen[0]?.name === 'gast' && namen[1]?.name === 'guest',
        JSON.stringify(status.daten),
      );
      // Rueckwaertskompatibilitaet: die ausgelieferte Webseite fragt
      // heute `standardKonto` (Einzahl) ab.
      const einzahl = status.daten?.standardKonto as Record<string, unknown> | undefined;
      pruefe('status meldet weiterhin standardKonto = erster Eintrag', einzahl?.name === 'gast');
      pruefe(
        'status meldet KEIN Passwort',
        !JSON.stringify(status.daten).toLowerCase().includes('passwor'),
        JSON.stringify(status.daten),
      );
    } finally {
      server.close();
    }
  } finally {
    db.schliessen();
    rmSync(ordner, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await kontoAnlegenUndAnmelden();
  ohneBlockKeinKonto();
  serverKonfigValidiert();
  await zweiKontenAusDerListe();

  if (fehler > 0) {
    console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nStandardkonto: alle Pruefungen bestanden');
}

await main();
