/**
 * A14 — server.yml ehrlich machen: Was in dieser Datei steht, wirkt auch.
 *
 * Ausgangslage (Roadmap A14): server.yml versprach sechzehn Einstellungen,
 * die kein Code las — darunter world.save-interval, das aussah wie der
 * Speichertakt, waehrend der Takt in Wahrheit allein aus der Konstante
 * SAVE_INTERVAL_MS kam. Beide Zahlen waren identisch (30 min), das
 * Laufzeitverhalten unterschied die Faelle also NICHT: Am Log war der
 * Fehler nicht zu sehen, und ein Test existierte nicht, weil die
 * Leseschicht in main.ts sass — und main.ts startet beim Import einen
 * Weltserver. Deshalb liegt sie seit A14 in server/src/ServerKonfig.ts.
 *
 * Dieser Test haelt vier Dinge fest:
 *  1. parseDauerMs: die Dauer-Syntax der Datei, inkl. des stillen
 *     Rueckfalls bei Tippfehlern ("30 min", "30m").
 *  2. Die ECHTE server/data/server.yml enthaelt keinen einzigen Schluessel,
 *     den ServerKonfig nicht liest — die Regressionswache gegen A14.
 *  3. Ein unbekannter Schluessel wird beim Lesen GEMELDET statt stumm
 *     ignoriert (der Riegel: A14 kann nicht unbemerkt zurueckkehren).
 *  4. Der Draht bis zum Ende: ein Wert aus einer echten yml-Datei laesst
 *     einen echten WovServer wirklich in diesem Takt speichern. Ohne
 *     diesen Schritt bewiese der Test nur, dass eine Zahl geparst wird —
 *     und genau das war vor A14 der Fall.
 *
 * Lauf: npx tsx test/a14-server-yml.ts   (aus server/)
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import { SAVE_INTERVAL_MS } from '@wov/shared';
import { parseDauerMs, unbekannteSchluessel, leseServerKonfig } from '../src/ServerKonfig.js';
import { createWovServer } from '../src/WovServer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECHTE_YML = resolve(__dirname, '../data/server.yml');
const TMP = resolve(__dirname, 'tmp-a14-konfig');

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (bedingung) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}

/** Schreibt eine server.yml in ein frisches Datenverzeichnis unter test/. */
function fixture(inhalt: string): string {
  rmSync(TMP, { recursive: true, force: true });
  // worlds/ gleich mit anlegen: sonst scheitert der Placement-Cache beim
  // Start mit einem ENOENT im Log, das nach einem echten Fehler aussieht.
  mkdirSync(resolve(TMP, 'worlds'), { recursive: true });
  writeFileSync(resolve(TMP, 'server.yml'), inhalt, 'utf-8');
  return TMP;
}

// ── 1. Dauer-Syntax ──────────────────────────────────────────────────
function dauerSyntax(): void {
  console.log('1. parseDauerMs');
  pruefe('30min', parseDauerMs('30min', 7) === 30 * 60_000);
  pruefe('45s', parseDauerMs('45s', 7) === 45_000);
  pruefe('500ms', parseDauerMs('500ms', 7) === 500);
  pruefe('2h', parseDauerMs('2h', 7) === 2 * 3_600_000);
  pruefe('0.5h (Kommazahl)', parseDauerMs('0.5h', 7) === 1_800_000);
  pruefe('Leerzeichen aussen werden geschluckt', parseDauerMs(' 45s ', 7) === 45_000);
  // Der stille Rueckfall ist Absicht (ein Tippfehler darf den Server nicht
  // toeten), aber er ist die gefaehrlichste Eigenschaft dieses Parsers:
  // genau so sieht "wirkungslos" aus. Deshalb steht er hier ausdruecklich.
  pruefe('"30 min" faellt auf den Vorgabewert zurueck', parseDauerMs('30 min', 7) === 7);
  pruefe('"30m" faellt auf den Vorgabewert zurueck', parseDauerMs('30m', 7) === 7);
  pruefe('Zahl statt Text faellt zurueck', parseDauerMs(30, 7) === 7);
  pruefe('undefined faellt zurueck', parseDauerMs(undefined, 7) === 7);
}

// ── 2. Die echte server.yml ──────────────────────────────────────────
function echteDateiIstEhrlich(): void {
  console.log('2. server/data/server.yml enthaelt nur Schluessel, die gelesen werden');
  const echt = parseYaml(readFileSync(ECHTE_YML, 'utf-8')) as Record<string, unknown>;
  const tote = unbekannteSchluessel(echt);
  pruefe('kein toter Schluessel', tote.length === 0, tote.length ? tote.join(', ') : 'alle gelesen');
}

// ── 3. Unbekannte Schluessel werden gemeldet ─────────────────────────
function toterSchluesselFaelltAuf(): void {
  console.log('3. Ein toter Schluessel wird beim Lesen gemeldet');
  const verzeichnis = fixture(
    [
      'server:',
      '  name: Test',
      '  port: 2599',
      'players:',
      '  max: 4',
      '  timeout: 0s',
      'zdos:',
      '  send-interval: 50ms',
      '',
    ].join('\n')
  );
  const yaml = parseYaml(readFileSync(resolve(verzeichnis, 'server.yml'), 'utf-8'));
  const gemeldet = unbekannteSchluessel(yaml);
  pruefe('players.timeout gemeldet', gemeldet.includes('players.timeout'), gemeldet.join(', '));
  // Ein unbekannter Abschnitt wird als GANZES gemeldet, nicht in seine
  // Einzelteile zerlegt — sonst verschwindet die Aussage hinter Details.
  pruefe(
    'zdos als ganzer Block gemeldet',
    gemeldet.includes('zdos') && !gemeldet.includes('zdos.send-interval'),
    gemeldet.join(', ')
  );

  const warnungen: string[] = [];
  const echteWarnung = console.warn;
  console.warn = (...args: unknown[]): void => {
    warnungen.push(args.join(' '));
  };
  const konfig = leseServerKonfig(verzeichnis, 'testinstanz');
  console.warn = echteWarnung;

  pruefe(
    'leseServerKonfig warnt beim Start',
    warnungen.some((w) => w.includes('players.timeout') && w.includes('liest niemand')),
    warnungen[0] ?? 'keine Warnung'
  );
  pruefe('bekannte Werte kommen trotzdem an', konfig.maxPlayers === 4 && konfig.port === 2599);
  pruefe(
    'fehlendes save-interval faellt auf SAVE_INTERVAL_MS',
    konfig.saveIntervalMs === SAVE_INTERVAL_MS,
    String(konfig.saveIntervalMs)
  );
  rmSync(TMP, { recursive: true, force: true });
}

// ── 4. Der Draht bis zum Speichertakt ────────────────────────────────
async function speichertaktPruefen(): Promise<void> {
  console.log('4. world.save-interval steuert wirklich den Speichertakt');
  const TAKT_MS = 400;
  const WARTEN_MS = 1_100;
  const datenDir = fixture(
    [
      'server:',
      '  name: A14-Test',
      '  port: 2593',
      'players:',
      '  max: 2',
      'world:',
      // Bewusst KEIN mode: layout — sonst braeuchte es eine Weltdatei, und
      // hier geht es um die Konfiguration, nicht um die Weltgenerierung.
      '  seed: KxSYuZquuw',
      `  save-interval: ${TAKT_MS}ms`,
      '  features: false',
      '  vegetation: false',
      '  creatures: false',
      'dungeons:',
      '  enabled: false',
      '',
    ].join('\n')
  );
  const konfig = leseServerKonfig(datenDir, 'a14welt');
  pruefe(`save-interval: ${TAKT_MS}ms gelesen`, konfig.saveIntervalMs === TAKT_MS, String(konfig.saveIntervalMs));
  pruefe('worldName = Instanzname', konfig.worldName === 'a14welt');

  const server = createWovServer(konfig);
  const savePfad = resolve(datenDir, 'worlds', 'a14welt.db.zst');
  try {
    server.start();
    // Vor dem ersten Takt darf nichts liegen — sonst bewiese ein spaeter
    // vorhandener Save nur, dass ueberhaupt gespeichert wird.
    pruefe('vor dem ersten Takt existiert kein Save', !existsSync(savePfad));

    const zeitstempel = new Set<number>();
    const bis = Date.now() + WARTEN_MS;
    while (Date.now() < bis) {
      await new Promise((f) => setTimeout(f, 50));
      if (existsSync(savePfad)) zeitstempel.add(statSync(savePfad).mtimeMs);
    }
    // Mit dem Vorgabewert (30 min) waere hier NICHTS entstanden. Zwei
    // verschiedene Schreibzeitpunkte in 1,1 s bei 400 ms Takt zeigen
    // ausserdem, dass der Wert den TAKT setzt und nicht nur den ersten
    // Schuss ausloest.
    pruefe(
      `mindestens 2 Speichervorgaenge in ${WARTEN_MS} ms`,
      zeitstempel.size >= 2,
      `${zeitstempel.size} verschiedene Schreibzeitpunkte`
    );
  } finally {
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  dauerSyntax();
  echteDateiIstEhrlich();
  toterSchluesselFaelltAuf();
  await speichertaktPruefen();
}

// Ausdruecklich beenden wie in verbindungsdeckel.ts: der Testserver haelt
// nach stop() noch Handles offen, der Prozess endete sonst nie — und ein
// haengender Test blockiert die ganze Suite.
main()
  .then(() => {
    if (fehler === 0) {
      console.log('PASS: server.yml verspricht nichts, was niemand liest');
      process.exit(0);
    }
    console.error(`FAIL: ${fehler} Pruefung(en) fehlgeschlagen`);
    process.exit(1);
  })
  .catch((err) => {
    console.error('FAIL:', err);
    process.exit(1);
  });
