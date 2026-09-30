/**
 * F9 — Wetter serverautoritativ, je Biom aus Definitionen (Paket WetterZustand).
 *
 * Teil A (rein, ohne Server): Definitionsdatei (Schema, Fehlertexte, Übersetzungs-
 *   schlüssel), Würfel (bitgleich zu `selectWeather` über 100 Fenster je Biom,
 *   Verteilung über 1.000 Fenster je Biom in Zahlen, Dauer und Tageszeit, wahlfreier
 *   Zugriff = fortlaufender Zugriff), Wetterdienst mit Attrappen-Spielern (Editor,
 *   Dungeon, andere Welt, Rangfolge der Quellen), Admin-Befehl.
 * Teil B (echter Serverprozess, echte WebSocket-Clients, kein Monkeypatch auf Date):
 *   Anmelden mit dem AKTUELLEN Stand, Fensterwechsel an alle in höchstens 2 s,
 *   zwei Biome = zwei Wetter aus demselben Fenster, Biomwechsel in höchstens 1,1 s,
 *   Admin `wetter <Zustand|auto> [biom]`, Editor-Verbindung und Dungeonband: 0 Pakete,
 *   `WeltWetter` bleibt Byte für Byte lesbar für den alten Leser.
 *
 * Run: npx tsx server/test/wetter-server.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { leseServerKonfig } from '../src/ServerKonfig.js';
import {
  Biome,
  ENVIRONMENT_DURATION,
  STANDARD_WETTER_DEFINITIONEN,
  WETTER_AUTOMATISCH,
  WetterWuerfel,
  inhaltText,
  pruefeWetterDefinitionen,
  selectWeather,
  weatherPeriod,
  type WetterDefinitionen,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { WetterDienst, fuehreWetterBefehlAus, type WetterEmpfaenger } from '../src/spiel/Wetter.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-wetter-server');
const WORLDS_DIR = resolve(TMP, 'welten');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(WORLDS_DIR, { recursive: true });

/** Nummern stehen hier bewusst als Zahlen: Auf einem Stand ohne das Paket muss der Test ROT werden, nicht nicht laufen. */
const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  AdminCommand: 53,
  AuthChallenge: 68,
  WeltWetter: 72,
  WetterZustand: 87,
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(20);
  }
  return bedingung();
};

// ════════════════════════════════ Teil A ════════════════════════════════
function teilA(): void {
  console.log('\n[A1] Definitionsdatei');
  const std = STANDARD_WETTER_DEFINITIONEN;
  check(
    'mitgelieferte Datei besteht die Prüfung',
    pruefeWetterDefinitionen(JSON.parse(JSON.stringify(std))).ok,
  );
  const schluesselFehlt = std.zustaende.filter(
    (z) => inhaltText(z.textKey, 'de') === z.textKey || inhaltText(z.textKey, 'en') === z.textKey,
  );
  check(
    'jeder Zustand hat Anzeigenamen in de UND en',
    schluesselFehlt.length === 0,
    schluesselFehlt.map((z) => z.id).join(','),
  );
  check(
    'de und en unterscheiden sich mindestens bei "Clear"',
    inhaltText('inhalt.wetter.clear', 'de') !== inhaltText('inhalt.wetter.clear', 'en'),
  );
  type Roh = {
    version: unknown;
    zustaende: Record<string, unknown>[];
    biome: { biom: unknown; zustaende: Record<string, unknown>[] }[];
  };
  const kopie = (): Roh => JSON.parse(JSON.stringify(std)) as Roh;
  const fall = (name: string, veraendere: (d: Roh) => void, muster: RegExp): void => {
    const d = kopie();
    veraendere(d);
    const p = pruefeWetterDefinitionen(d);
    check(
      `Fehlertext: ${name}`,
      !p.ok && p.fehler.some((f) => muster.test(f)),
      p.ok ? 'angenommen' : p.fehler.join(' | '),
    );
  };
  fall('unbekanntes Biom', (d) => (d.biome[0].biom = 'Atlantis'), /unbekanntes Biom/);
  fall(
    'unbekannter Zustand',
    (d) => (d.biome[0].zustaende[0].zustand = 'Hagel'),
    /steht nicht unter zustaende/,
  );
  fall('negatives Gewicht', (d) => (d.biome[0].zustaende[0].gewicht = -1), /gewicht/);
  fall('Gewichte 0', (d) => d.biome[2].zustaende.forEach((e) => (e.gewicht = 0)), /ergeben 0/);
  fall(
    'min > max',
    (d) => Object.assign(d.biome[0].zustaende[0], { fensterMin: 3, fensterMax: 2 }),
    /fensterMin/,
  );
  fall('Dauer keine ganze Zahl', (d) => (d.biome[0].zustaende[0].fensterMin = 1.5), /fensterMin/);
  fall('Tageszeit außerhalb', (d) => (d.biome[0].zustaende[0].tageszeit = { von: 0, bis: 2 }), /tageszeit/);
  fall('unbekannte Umgebung', (d) => (d.zustaende[0].umgebung = 'Hagelsturm'), /unbekannte Umgebung/);
  fall('Schlüssel fehlt', (d) => delete d.zustaende[0].textKey, /textKey/);
  fall('doppelte Id', (d) => (d.zustaende[1].id = d.zustaende[0].id), /doppelt/);
  fall('falsche Version', (d) => (d.version = 2), /version/);
  check(
    'Nicht-Objekt wird abgelehnt',
    !pruefeWetterDefinitionen(null).ok && !pruefeWetterDefinitionen([]).ok,
  );

  console.log('\n[A2] Golden: ohne neue Definition bitgleich zum alten Würfel (100 Fenster je Biom)');
  const w = new WetterWuerfel();
  const biome: [string, Biome][] = [
    ['Meadows', Biome.Meadows],
    ['BlackForest', Biome.BlackForest],
    ['Swamp', Biome.Swamp],
    ['Mountain', Biome.Mountain],
    ['Plains', Biome.Plains],
    ['DeepNorth', Biome.DeepNorth],
    ['Ocean', Biome.Ocean],
    ['Mistlands (ohne Tabelle)', Biome.Mistlands],
    ['Meadows|BlackForest (Mischzone)', Biome.Meadows | Biome.BlackForest],
    ['None', Biome.None],
  ];
  for (const [name, bit] of biome) {
    let gleich = 0;
    for (let n = 0; n < 100; n++) {
      const t = n * ENVIRONMENT_DURATION + 17;
      if (w.wetterFuer(bit, t).umgebung === selectWeather(bit, t).name) gleich++;
    }
    check(`${name}: 100/100 Fenster gleich dem alten Würfel`, gleich === 100, `${gleich}/100`);
  }
  check(
    'Fensternummer = weatherPeriod',
    w.wetterFuer(Biome.Meadows, 5 * ENVIRONMENT_DURATION + 3).fenster ===
      weatherPeriod(5 * ENVIRONMENT_DURATION + 3),
  );

  console.log('\n[A3] Verteilung über 1.000 Fenster je Biom (Häufigkeit gegen Gewicht, Toleranz 4 sigma)');
  for (const b of std.biome) {
    const bit = (Biome as unknown as Record<string, number>)[b.biom] as Biome;
    const gesamt = b.zustaende.reduce(
      (s, e) => s + (e.ashlandsOverride || e.deepnorthOverride ? 0 : e.gewicht),
      0,
    );
    const zaehler = new Map<string, number>();
    const N = 1000;
    for (let n = 0; n < N; n++) {
      const z = w.wetterFuer(bit, n * ENVIRONMENT_DURATION + 1).zustand;
      zaehler.set(z, (zaehler.get(z) ?? 0) + 1);
    }
    const zeilen: string[] = [];
    let ok = true;
    for (const e of b.zustaende) {
      const p = e.gewicht / gesamt;
      const ist = (zaehler.get(e.zustand) ?? 0) / N;
      const tol = 4 * Math.sqrt((p * (1 - p)) / N) + 0.002;
      zeilen.push(
        `${e.zustand} soll ${(p * 100).toFixed(1)}% ist ${(ist * 100).toFixed(1)}% (±${(tol * 100).toFixed(1)})`,
      );
      if (Math.abs(ist - p) > tol) ok = false;
    }
    check(`${b.biom}: Häufigkeiten innerhalb Gewicht ± Toleranz`, ok, zeilen.join('; '));
  }

  console.log('\n[A4] Dauer, Tageszeit, wahlfreier Zugriff');
  const eigene = (aendere: (d: WetterDefinitionen) => void): WetterWuerfel => {
    const d = JSON.parse(JSON.stringify(std)) as WetterDefinitionen;
    aendere(d);
    const p = pruefeWetterDefinitionen(d);
    if (!p.ok) throw new Error(p.fehler.join('; '));
    return new WetterWuerfel(p.defs);
  };
  const lang = eigene((d) => {
    const clear = d.biome.find((b) => b.biom === 'Meadows')!.zustaende.find((e) => e.zustand === 'Clear')!;
    clear.fensterMin = 2;
    clear.fensterMax = 4;
  });
  const folge: string[] = [];
  for (let n = 0; n < 600; n++)
    folge.push(lang.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1).zustand);
  const clearLaeufe: number[] = [];
  for (let i = 0, l = 0; i <= folge.length; i++) {
    if (folge[i] === 'Clear') l++;
    else if (l > 0) {
      clearLaeufe.push(l);
      l = 0;
    }
  }
  check(
    'Clear hält mindestens 2 Fenster am Stück (kürzester Lauf)',
    Math.min(...clearLaeufe) >= 2,
    `kürzester ${Math.min(...clearLaeufe)}, längster ${Math.max(...clearLaeufe)}, ${clearLaeufe.length} Läufe`,
  );
  check(
    'es gibt Läufe von 3 und mehr Fenstern',
    clearLaeufe.some((l) => l >= 3),
  );
  // Zwei Zustände mit fester Dauer 3: Der Wechsel darf nur an Laufgrenzen (Vielfache von 3) stattfinden.
  const dreier = eigene((d) => {
    d.biome.find((b) => b.biom === 'Meadows')!.zustaende = [
      { zustand: 'Clear', gewicht: 1, fensterMin: 3, fensterMax: 3 },
      { zustand: 'Misty', gewicht: 1, fensterMin: 3, fensterMax: 3 },
    ];
  });
  const dz: string[] = [];
  for (let n = 0; n < 300; n++)
    dz.push(dreier.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1).zustand);
  let wechsel = 0;
  let schief = 0;
  for (let i = 1; i < dz.length; i++)
    if (dz[i] !== dz[i - 1]) {
      wechsel++;
      if (i % 3 !== 0) schief++;
    }
  check(
    'feste Dauer 3: Wechsel nur an Vielfachen von 3',
    wechsel > 10 && schief === 0,
    `${wechsel} Wechsel, ${schief} an falscher Stelle`,
  );
  const zufaellig = eigene((d) => {
    const clear = d.biome.find((b) => b.biom === 'Meadows')!.zustaende.find((e) => e.zustand === 'Clear')!;
    clear.fensterMin = 2;
    clear.fensterMax = 4;
  });
  let gleich = 0;
  const reihenfolge = [...Array(600).keys()].sort((a, b) => ((a * 7919) % 600) - ((b * 7919) % 600));
  for (const n of reihenfolge)
    if (zufaellig.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1).zustand === folge[n]) gleich++;
  check(
    'wahlfreier Zugriff = fortlaufender Zugriff (600 Fenster, andere Reihenfolge)',
    gleich === 600,
    `${gleich}/600`,
  );

  const tags = eigene((d) => {
    const m = d.biome.find((b) => b.biom === 'Meadows')!;
    m.zustaende = [
      {
        zustand: 'Clear',
        gewicht: 1,
        fensterMin: 1,
        fensterMax: 1,
        tageszeit: { von: 0, bis: 0.5 },
      },
      {
        zustand: 'Misty',
        gewicht: 1,
        fensterMin: 1,
        fensterMax: 1,
        tageszeit: { von: 0.5, bis: 1 },
      },
    ];
  });
  let richtig = 0;
  let tag = 0;
  for (let n = 0; n < 300; n++) {
    const frac = ((n * ENVIRONMENT_DURATION) % 1800) / 1800;
    const soll = frac < 0.5 ? 'Clear' : 'Misty';
    if (frac < 0.5) tag++;
    if (tags.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1).zustand === soll) richtig++;
  }
  check(
    'Tageszeit: 300/300 Fenster ziehen nur den erlaubten Zustand',
    richtig === 300,
    `${richtig}/300 (davon ${tag} am Tag)`,
  );
  const nacht = eigene((d) => {
    d.biome.find((b) => b.biom === 'Meadows')!.zustaende = [
      {
        zustand: 'Misty',
        gewicht: 1,
        fensterMin: 1,
        fensterMax: 1,
        tageszeit: { von: 0.8, bis: 0.2 },
      },
      {
        zustand: 'Clear',
        gewicht: 1,
        fensterMin: 1,
        fensterMax: 1,
        tageszeit: { von: 0.2, bis: 0.8 },
      },
    ];
  });
  let nachtRichtig = 0;
  for (let n = 0; n < 300; n++) {
    const frac = ((n * ENVIRONMENT_DURATION) % 1800) / 1800;
    const soll = frac >= 0.8 || frac < 0.2 ? 'Misty' : 'Clear';
    if (nacht.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1).zustand === soll) nachtRichtig++;
  }
  check('Tageszeit über Mitternacht (von > bis)', nachtRichtig === 300, `${nachtRichtig}/300`);

  // M3 (Angriff #178): negative Weltzeit mit Dauern > 1 warf einen TypeError.
  let negativOk = true;
  let negativFehler = '';
  const negA = eigene((d) => {
    for (const e of d.biome.find((b) => b.biom === 'Meadows')!.zustaende) {
      e.fensterMin = 2;
      e.fensterMax = 4;
    }
  });
  const negB = eigene((d) => {
    for (const e of d.biome.find((b) => b.biom === 'Meadows')!.zustaende) {
      e.fensterMin = 2;
      e.fensterMax = 4;
    }
  });
  for (let n = -50; n <= 5; n++) {
    try {
      const x = negA.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1);
      const y = negB.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1);
      if (!x.umgebung || x.umgebung !== y.umgebung || x.fenster !== n) negativOk = false;
    } catch (e) {
      negativOk = false;
      negativFehler = String(e);
    }
  }
  // N2 (Nachprüfung #178): Weltzeit ±Infinity und NaN mit Dauern > 1 — auf dem alten Stand läuft der Heap voll bzw. es fliegt
  // ein TypeError. Eigener Prozess mit kleinem Heap und Zeitgrenze, damit ein Rückfall den Test nicht aufhängt.
  {
    const code = [
      "import { Biome, STANDARD_WETTER_DEFINITIONEN, WetterWuerfel, pruefeWetterDefinitionen } from '@wov/shared';",
      'const d = JSON.parse(JSON.stringify(STANDARD_WETTER_DEFINITIONEN));',
      "d.biome.find((b) => b.biom === 'Meadows').zustaende.forEach((e) => { e.fensterMin = 2; e.fensterMax = 4; });",
      'const p = pruefeWetterDefinitionen(d);',
      'const w = new WetterWuerfel(p.defs);',
      'const out = {};',
      "for (const [k, t] of [['plusInf', Infinity], ['minusInf', -Infinity], ['nan', NaN]]) {",
      "  try { out[k] = !!w.wetterFuer(Biome.Meadows, t).umgebung; } catch (e) { out[k] = 'Fehler: ' + e.message; }",
      '}',
      "console.log('ERGEBNIS ' + JSON.stringify(out));",
    ].join('\n');
    let antwort = '';
    let ok = false;
    try {
      antwort = execFileSync(
        process.execPath,
        ['--max-old-space-size=200', '--import', 'tsx', '--input-type=module', '-e', code],
        {
          cwd: resolve(__dirname, '..'),
          timeout: 20_000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      ok = antwort.includes('ERGEBNIS {"plusInf":true,"minusInf":true,"nan":true}');
    } catch (e) {
      antwort = `Prozess gescheitert oder Zeitgrenze (20 s): ${String((e as Error).message).slice(0, 120)}`;
    }
    check(
      'Weltzeit +Infinity, -Infinity, NaN mit Dauer 2-4: Antwort ohne Fehler und ohne Heap-Überlauf (20 s, 200 MB)',
      ok,
      antwort.trim().slice(0, 160),
    );
  }
  check(
    'negative Weltzeit (Fenster -50..5) mit Dauer 2-4: kein Fehler, gleiche Antwort in zwei Instanzen',
    negativOk,
    negativFehler,
  );
  check(
    'negative Weltzeit, Dauer 2-4, als ERSTER Aufruf einer frischen Instanz',
    (() => {
      try {
        return !!eigene((d) => {
          const e = d.biome.find((b) => b.biom === 'Meadows')!.zustaende[0];
          e.fensterMin = 2;
          e.fensterMax = 4;
        }).wetterFuer(Biome.Meadows, -5 * ENVIRONMENT_DURATION).umgebung;
      } catch {
        return false;
      }
    })(),
  );
  check(
    'positive Zeit nach negativer bleibt unberührt (600/600 wie vorher)',
    (() => {
      try {
        const z = eigene((d) => {
          const e = d.biome.find((b) => b.biom === 'Meadows')!.zustaende.find((x) => x.zustand === 'Clear')!;
          e.fensterMin = 2;
          e.fensterMax = 4;
        });
        z.wetterFuer(Biome.Meadows, -3 * ENVIRONMENT_DURATION);
        for (let n = 0; n < 600; n++)
          if (z.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1).zustand !== folge[n]) return false;
        return true;
      } catch {
        return false;
      }
    })(),
  );

  // N2 (Angriff #178): eine Ersatzdatei mit vielen Fehlern füllt das Log nicht.
  {
    const dir = mkdtempSync(join(tmpdir(), 'wov-wetter-n2-'));
    const warnungen: string[] = [];
    const alt = console.warn;
    try {
      const kaputt = (anzahl: number): unknown => ({
        version: 1,
        zustaende: [{ id: 'Clear', umgebung: 'Clear', textKey: 'inhalt.wetter.clear' }],
        biome: Array.from({ length: anzahl }, () => ({
          biom: 'Atlantis',
          zustaende: [{ zustand: 'Clear', gewicht: 1 }],
        })),
      });
      const lies = (anzahl: number): { zeilen: string[]; defs: unknown } => {
        warnungen.length = 0;
        writeFileSync(join(dir, 'wetter.json'), JSON.stringify(kaputt(anzahl)), 'utf-8');
        writeFileSync(
          join(dir, 'server.yml'),
          'server:\n  name: Test\nworld:\n  mode: radial\nwetter:\n  definitionen: wetter.json\n',
          'utf-8',
        );
        console.warn = (...a: unknown[]): void => void warnungen.push(a.map(String).join(' '));
        const k = leseServerKonfig(dir, 'test');
        console.warn = alt;
        return {
          zeilen: warnungen.filter((w) => w.startsWith('[Main] wetter.definitionen')),
          defs: k.wetterDefinitionen,
        };
      };
      const gross = lies(100);
      check(
        '100 Fehler: höchstens 20 Fehlerzeilen + "… und 80 weitere" + Verworfen-Zeile',
        gross.zeilen.length === 22 && gross.zeilen.some((z) => z.includes('… und 80 weitere')),
        `${gross.zeilen.length} Zeilen`,
      );
      check('… der Server nimmt die mitgelieferten Tabellen', gross.defs === undefined);
      const klein = lies(2);
      check(
        '2 Fehler: beide einzeln, kein "weitere"',
        klein.zeilen.length === 3 && !klein.zeilen.some((z) => z.includes('weitere')),
        `${klein.zeilen.length} Zeilen`,
      );
    } finally {
      console.warn = alt;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n[A5] Wetterdienst mit Attrappen-Spielern');
  const gesendet: string[] = [];
  const attrappe = (extra: Partial<WetterEmpfaenger> = {}): WetterEmpfaenger => ({
    position: { x: 0, y: 0, z: 0 },
    worldId: 'haupt',
    dungeonId: null,
    nurEditor: false,
    authenticated: true,
    sendPacketWith: (_t, fn) => {
      const wr = new Writer();
      fn(wr);
      gesendet.push(new Reader(wr.toBuffer()).readString());
    },
    ...extra,
  });
  const dienst = (vorgabe = WETTER_AUTOMATISCH): WetterDienst =>
    new WetterDienst(
      new WetterWuerfel(),
      { umgebung: vorgabe, nebelDichte: -1 },
      () => Biome.Meadows,
      'haupt',
    );
  const d1 = dienst();
  const t0 = 3 * ENVIRONMENT_DURATION + 1;
  check('normaler Spieler bekommt Wetter', d1.wetterFuer(attrappe(), t0) !== null);
  check('Editor bekommt keins', d1.wetterFuer(attrappe({ nurEditor: true }), t0) === null);
  check('nicht angemeldet: keins', d1.wetterFuer(attrappe({ authenticated: false }), t0) === null);
  check('Dungeon (dungeonId): keins', d1.wetterFuer(attrappe({ dungeonId: 'grab1' }), t0) === null);
  check(
    'Dungeonband (x >= 100000): keins',
    d1.wetterFuer(attrappe({ position: { x: 100500, y: 0, z: 0 } }), t0) === null,
  );
  check('andere Welt: keins', d1.wetterFuer(attrappe({ worldId: 'instanz-7' }), t0) === null);
  const kein = new WetterDienst(new WetterWuerfel(), { umgebung: '', nebelDichte: -1 }, () => null, 'haupt');
  check('Biom unbekannt (null): keins', kein.wetterFuer(attrappe(), t0) === null);
  const p1 = attrappe();
  gesendet.length = 0;
  const erst = d1.sendeAn(p1, t0);
  const zweit = d1.sendeAn(p1, t0 + 5);
  const naechstes = d1.sendeAn(p1, t0 + ENVIRONMENT_DURATION);
  const erzwungen = d1.sendeAn(p1, t0 + ENVIRONMENT_DURATION, true);
  check(
    'erst senden, dann nur bei Wechsel (Fenster), erzwingen geht immer',
    erst && !zweit && naechstes && erzwungen,
    `${erst} ${zweit} ${naechstes} ${erzwungen}; Pakete ${gesendet.length}`,
  );
  const alt = d1.wetterFuer(attrappe(), t0)!;
  d1.setze('Snow');
  check(
    'globaler Override gewinnt gegen den Würfel',
    d1.wetterFuer(attrappe(), t0)?.umgebung === 'Snow' && alt.umgebung !== 'Snow',
  );
  d1.setze('Rain', 'Meadows');
  check('Biom-Override gewinnt gegen den globalen', d1.wetterFuer(attrappe(), t0)?.umgebung === 'Rain');
  d1.setze('Misty', 'Mountain');
  check('Override eines anderen Bioms wirkt hier nicht', d1.wetterFuer(attrappe(), t0)?.umgebung === 'Rain');
  d1.setze(null, 'Meadows');
  d1.setze(null);
  d1.setze(null, 'Mountain');
  check(
    'Overrides zurückgenommen = Würfel',
    d1.wetterFuer(attrappe(), t0)?.umgebung === alt.umgebung && d1.aktiveOverrides().length === 0,
  );
  const d2 = dienst('Misty');
  check(
    'feste Umgebung aus server.yml gilt gegen den Würfel',
    d2.wetterFuer(attrappe(), t0)?.umgebung === 'Misty',
  );
  d2.setze('Rain');
  check('Admin-Override schlägt die feste Umgebung', d2.wetterFuer(attrappe(), t0)?.umgebung === 'Rain');

  // M2 (Angriff #178): In einer Mischzone (Bitmaske) löst der Würfel auf EIN Biom auf; der Override muss es ebenso.
  const mischung = new WetterDienst(
    new WetterWuerfel(),
    { umgebung: WETTER_AUTOMATISCH, nebelDichte: -1 },
    () => Biome.Meadows | Biome.BlackForest,
    'haupt',
  );
  const vorOverride = mischung.wetterFuer(attrappe(), t0)!.umgebung;
  mischung.setze('Snow', 'Meadows');
  check(
    'Mischzone Meadows|BlackForest: Biom-Override "Meadows" wirkt (wie der Würfel, der Meadows nimmt)',
    mischung.wetterFuer(attrappe(), t0)?.umgebung === 'Snow' && vorOverride !== 'Snow',
    `vorher ${vorOverride}, danach ${mischung.wetterFuer(attrappe(), t0)?.umgebung}`,
  );
  mischung.setze(null, 'Meadows');
  mischung.setze('Snow', 'BlackForest');
  check(
    'Mischzone: ein Override für das nicht aufgelöste Biom (BlackForest) wirkt dort nicht',
    mischung.wetterFuer(attrappe(), t0)?.umgebung === vorOverride,
  );

  console.log('\n[A6] Admin-Befehl');
  const d3 = dienst();
  const r1 = fuehreWetterBefehlAus(d3, ['Rain']);
  check('wetter Rain', r1.ok && d3.wetterFuer(attrappe(), t0)?.umgebung === 'Rain', r1.message);
  const r2 = fuehreWetterBefehlAus(d3, ['heath_clear', 'meadows']);
  check(
    'wetter heath_clear meadows (Schreibweise egal, Leerzeichen als _)',
    r2.ok && d3.wetterFuer(attrappe(), t0)?.zustand === 'Heath clear',
    r2.message,
  );
  const r3 = fuehreWetterBefehlAus(d3, ['Hagel']);
  check(
    'unbekannter Zustand abgelehnt, Liste in der Antwort',
    !r3.ok && /Clear/.test(r3.message),
    r3.message,
  );
  const r4 = fuehreWetterBefehlAus(d3, ['Rain', 'Atlantis']);
  check('unbekanntes Biom abgelehnt', !r4.ok, r4.message);
  const r5 = fuehreWetterBefehlAus(d3, ['auto']);
  const r6 = fuehreWetterBefehlAus(d3, ['auto', 'Meadows']);
  check('wetter auto nimmt alles zurück', r5.ok && r6.ok && d3.aktiveOverrides().length === 0);
  check('wetter ohne Argument zeigt den Stand', fuehreWetterBefehlAus(d3, []).ok);
}

// ════════════════════════════════ Teil B ════════════════════════════════
interface WetterPaket {
  t: number;
  umgebung: string;
  zustand: string;
  fenster: number;
}
interface Klient {
  name: string;
  ws: WebSocket;
  wetter: WetterPaket[];
  weltWetterRoh: Buffer[];
  reihenfolge: number[];
}

function verbinde(port: number, name: string, nurEditor = false): Promise<Klient> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const k: Klient = { name, ws, wetter: [], weltWetterRoh: [], reihenfolge: [] };
    const timeout = setTimeout(() => reject(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        if (nurEditor) w.writeBool(true);
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timeout);
        resolvePromise(k);
      } else if (type === P.WetterZustand) {
        k.reihenfolge.push(type);
        k.wetter.push({
          t: Date.now(),
          umgebung: r.readString(),
          zustand: r.readString(),
          fenster: r.readInt32(),
        });
      } else if (type === P.WeltWetter) {
        k.reihenfolge.push(type);
        k.weltWetterRoh.push(Buffer.from(data.subarray(1)));
      }
    });
    ws.on('error', reject);
  });
}

function sendAdmin(ws: WebSocket, line: string): void {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}

async function teilB(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'wetter-server',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
    metrikenDatei: resolve(TMP, 'metriken', 'metriken.json'),
    wetterVorgabe: { umgebung: 'Misty', nebelDichte: -1 },
  });
  server.start();
  const PORT = portVon(server);
  try {
    const n = weatherPeriod(server.worldTime) + 2;

    console.log('\n[B1] Anmelden: Vorgabe (WeltWetter) zuerst, dann das Wetter des Bioms');
    server.worldTime = n * ENVIRONMENT_DURATION - 100; // Fenster n-1, weit von der Grenze
    const kA = await verbinde(PORT, 'Anna');
    const kB = await verbinde(PORT, 'Bjoern');
    check(
      'beide bekamen beim Anmelden ein WetterZustand',
      await bis(() => kA.wetter.length > 0 && kB.wetter.length > 0, 3000),
      `A ${kA.wetter.length}, B ${kB.wetter.length}`,
    );
    check(
      'Reihenfolge: WeltWetter (Vorgabe) vor WetterZustand',
      kA.reihenfolge[0] === P.WeltWetter && kA.reihenfolge[1] === P.WetterZustand,
      kA.reihenfolge.join(','),
    );
    // WeltWetter Byte für Byte mit dem alten Leser: umgebung, nebelDichte, look-JSON — danach nichts mehr.
    const rw = new Reader(kA.weltWetterRoh[0]!);
    const umg = rw.readString();
    rw.readFloat32();
    const look = rw.readString();
    check(
      'alter Leser: WeltWetter unverändert (Umgebung, Dichte, look) und ohne Rest',
      umg === 'Misty' && look.startsWith('{') && rw.remaining() === 0,
      `umgebung ${umg}, Rest ${rw.remaining()}`,
    );
    check(
      'Vorgabe Misty gilt auch als Wetter-Stand (feste Umgebung aus server.yml)',
      kA.wetter[0]?.umgebung === 'Misty',
      kA.wetter[0]?.umgebung,
    );

    // Die feste Vorgabe lässt sich nur per Admin-Override ersetzen; für die Würfel-Fälle folgt ein zweiter Server OHNE Vorgabe.
    kA.ws.close();
    kB.ws.close();
    await warte(200);
  } finally {
    server.stop();
  }

  const server2 = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten2'),
    worldName: 'wetter-server-2',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
    metrikenDatei: resolve(TMP, 'metriken2', 'metriken.json'),
  });
  server2.start();
  const PORT2 = portVon(server2);
  const wuerfel = new WetterWuerfel();
  try {
    const orte = new Map<Biome, { x: number; z: number }>();
    for (let x = -4000; x <= 4000 && orte.size < 2; x += 100) {
      for (let z = -4000; z <= 4000 && orte.size < 2; z += 100) {
        const b = server2.geo.getBiome(x, z);
        if ((b === Biome.Meadows || b === Biome.Mountain) && !orte.has(b)) orte.set(b, { x, z });
      }
    }
    const wiese = orte.get(Biome.Meadows)!;
    const berg = orte.get(Biome.Mountain)!;
    const stelle = (
      p: { position: { x: number; y: number; z: number } },
      o: { x: number; z: number },
    ): void => {
      p.position = { x: o.x, y: p.position.y, z: o.z };
    };
    let n = weatherPeriod(server2.worldTime) + 2;
    while (wuerfel.wetterFuer(Biome.Meadows, n * ENVIRONMENT_DURATION + 1).zustand !== 'Clear') n++;

    server2.worldTime = n * ENVIRONMENT_DURATION - 100; // Fenster n-1
    const kA = await verbinde(PORT2, 'Anna');
    const kB = await verbinde(PORT2, 'Bjoern');
    const kE = await verbinde(PORT2, 'Editor', true);
    const pA = server2.net.getPeers().find((p) => p.name === 'Anna')!;
    const pB = server2.net.getPeers().find((p) => p.name === 'Bjoern')!;
    const letztes = (k: Klient): WetterPaket | undefined => k.wetter[k.wetter.length - 1];

    console.log('\n[B2] Zwei Biome, ein Fenster: verschiedenes Wetter');
    stelle(pA, wiese);
    stelle(pB, berg);
    const nm1 = n - 1;
    const erwartetA = wuerfel.wetterFuer(Biome.Meadows, nm1 * ENVIRONMENT_DURATION + 1);
    const erwartetB = wuerfel.wetterFuer(Biome.Mountain, nm1 * ENVIRONMENT_DURATION + 1);
    check(
      'Wiese und Berg erhalten ihr Wetter (Fenster n-1)',
      await bis(
        () => letztes(kA)?.umgebung === erwartetA.umgebung && letztes(kB)?.umgebung === erwartetB.umgebung,
        3000,
      ),
      `A ${letztes(kA)?.umgebung} (soll ${erwartetA.umgebung}), B ${letztes(kB)?.umgebung} (soll ${erwartetB.umgebung})`,
    );
    check(
      'gleiche Fensternummer, verschiedenes Wetter',
      letztes(kA)?.fenster === letztes(kB)?.fenster && letztes(kA)?.umgebung !== letztes(kB)?.umgebung,
      `Fenster ${letztes(kA)?.fenster}/${letztes(kB)?.fenster}`,
    );

    console.log('\n[B3] Fensterwechsel: beide bekommen in höchstens 2 s dieselbe neue Fensternummer');
    // Zustand vor dem Wechsel: Wiese soll in Fenster n "Clear" ziehen, Berg etwas mit Schnee.
    const vorA = kA.wetter.length;
    const vorB = kB.wetter.length;
    server2.worldTime = n * ENVIRONMENT_DURATION - 0.3;
    const t0 = Date.now();
    const okFenster = await bis(
      () =>
        kA.wetter.length > vorA &&
        kB.wetter.length > vorB &&
        letztes(kA)?.fenster === n &&
        letztes(kB)?.fenster === n,
      4000,
    );
    const dauer = Math.max(letztes(kA)?.t ?? 0, letztes(kB)?.t ?? 0) - t0;
    check(
      'beide: neue Fensternummer n',
      okFenster,
      `A ${letztes(kA)?.fenster}, B ${letztes(kB)?.fenster}, soll ${n}`,
    );
    check('… in höchstens 2000 ms', okFenster && dauer <= 2000, `${dauer} ms`);
    check(
      'Wiese zieht in Fenster n Clear, Berg Schnee/Schneesturm',
      letztes(kA)?.umgebung === 'Clear' && ['Snow', 'SnowStorm'].includes(letztes(kB)?.umgebung ?? ''),
      `${letztes(kA)?.umgebung} / ${letztes(kB)?.umgebung}`,
    );
    const gleicheFensterPaket = (letztes(kA)?.t ?? 0) - (letztes(kB)?.t ?? 0);
    console.log(`      Abstand der beiden Pakete: ${Math.abs(gleicheFensterPaket)} ms`);

    console.log('\n[B4] Neuer Client nach dem Wechsel bekommt den AKTUELLEN Stand');
    const kC = await verbinde(PORT2, 'Clara');
    check(
      'Clara: Wetter beim Anmelden, Fenster n',
      (await bis(() => kC.wetter.length > 0, 3000)) && kC.wetter[0]?.fenster === n,
      `Fenster ${kC.wetter[0]?.fenster}, soll ${n}`,
    );
    kC.ws.close();

    console.log('\n[B5] Biomwechsel: neues Wetter in höchstens 1,5 s (ein Takt + Lastzuschlag)');
    const vorB2 = kB.wetter.length;
    const tW = Date.now();
    stelle(pB, wiese);
    const okW = await bis(() => kB.wetter.length > vorB2 && letztes(kB)?.umgebung === 'Clear', 3000);
    const dW = (letztes(kB)?.t ?? 0) - tW;
    check('Bjoern (Berg → Wiese) bekommt Clear', okW, `${letztes(kB)?.umgebung}`);
    check('… in höchstens 1500 ms (ein Takt von 1 s + Lastzuschlag)', okW && dW <= 1500, `${dW} ms`);
    stelle(pB, berg);
    await bis(() => ['Snow', 'SnowStorm'].includes(letztes(kB)?.umgebung ?? ''), 3000);

    console.log('\n[B6] Admin-Befehl `wetter <Zustand|auto> [biom]`');
    const vor = [kA.wetter.length, kB.wetter.length];
    const tR = Date.now();
    sendAdmin(kA.ws, 'wetter Rain');
    const okR = await bis(() => letztes(kA)?.umgebung === 'Rain' && letztes(kB)?.umgebung === 'Rain', 3000);
    const dR = Math.max(letztes(kA)?.t ?? 0, letztes(kB)?.t ?? 0) - tR;
    check('wetter Rain: beide bekommen Rain', okR, `A ${letztes(kA)?.umgebung}, B ${letztes(kB)?.umgebung}`);
    check('… in höchstens 1500 ms (ein Sekundentakt + Lastzuschlag)', okR && dR <= 1500, `${dR} ms`);
    sendAdmin(kA.ws, 'wetter Snow Meadows');
    const okS = await bis(() => letztes(kA)?.umgebung === 'Snow', 3000);
    await warte(1300);
    check(
      'wetter Snow Meadows: nur die Wiese wechselt, der Berg behält Rain',
      okS && letztes(kB)?.umgebung === 'Rain',
      `A ${letztes(kA)?.umgebung}, B ${letztes(kB)?.umgebung}`,
    );
    sendAdmin(kA.ws, 'wetter auto');
    sendAdmin(kA.ws, 'wetter auto Meadows');
    const okZ = await bis(
      () => letztes(kA)?.umgebung === 'Clear' && ['Snow', 'SnowStorm'].includes(letztes(kB)?.umgebung ?? ''),
      4000,
    );
    check(
      'wetter auto: beide zurück beim gewürfelten Wetter',
      okZ,
      `A ${letztes(kA)?.umgebung}, B ${letztes(kB)?.umgebung}`,
    );
    check('es kamen mehr Pakete (Zähler)', kA.wetter.length > vor[0]! && kB.wetter.length > vor[1]!);

    console.log('\n[B7] Editor-Verbindung und Dungeonband: kein Paket');
    check(
      'Editor-Verbindung: 0 WetterZustand-Pakete über die ganze Sitzung',
      kE.wetter.length === 0,
      `${kE.wetter.length}`,
    );
    const pE = server2.net.getPeers().find((p) => p.name === 'Editor');
    check(
      '… und sie ist verbunden und authentifiziert (Zeuge, dass 0 nicht "nie angekommen" heißt)',
      !!pE && pE.authenticated && pE.nurEditor,
    );
    const vorA2 = kA.wetter.length;
    pA.position = { x: 100_500, y: pA.position.y, z: 0 }; // Dungeonband
    await warte(1300);
    sendAdmin(kB.ws, 'wetter Misty');
    await bis(() => letztes(kB)?.umgebung === 'Misty', 3000);
    await warte(1300);
    check(
      'Spieler im Dungeonband: nach dem Verlassen der Oberwelt kommt nichts mehr',
      kA.wetter.length === vorA2,
      `${kA.wetter.length - vorA2} neue Pakete`,
    );
    sendAdmin(kB.ws, 'wetter auto');

    kA.ws.close();
    kB.ws.close();
    kE.ws.close();
  } finally {
    server2.stop();
  }
}

async function main(): Promise<void> {
  try {
    teilA();
    await teilB();
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
  console.log(
    failures === 0
      ? '\n=== Wetter serverautoritativ: ALLES BESTANDEN ==='
      : `\n=== Wetter serverautoritativ: ${failures} CHECK(S) FAILED ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
