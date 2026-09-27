/**
 * Editor E2, Karte Z3 N1 (Nachbesserung nach dem Angriff auf PR #120): die dauerhafte Löschsperre
 * greift schon beim ERKENNEN einer Massenlöschung — unabhängig von `AENDERUNGEN_MAX` und einer
 * Geo-Änderung (E-b), und schützt danach je `id`, nicht je Hash (E-c). In-process (`createWovServer`,
 * `layoutWache.tick()` direkt), nach dem Muster von `server/test/layout-live-takt.ts` — schnell, weil
 * ohne einen echten Kindprozess; die Fälle A1a/A2/A3 mit einem echten `main.ts`-Kindprozess stehen in
 * `server/test/z3n1-hauptprozess.ts`.
 *
 *  A1b  30 Bäume + Truhe, dann 11 neue + die 31 alten fehlend (42 Änderungen, über AENDERUNGEN_MAX=40):
 *       Vor dieser Nachbesserung endete das nur als `zu-viele-aenderungen`, ungeschützt (Angriffsbefund
 *       A1). Jetzt landen die 31 verwaisten ids TROTZDEM in der Sperrdatei.
 *  A1c  Ein Dokument, das GLEICHZEITIG eine Geo-Änderung UND eine Massenlöschung trägt: Vor der
 *       Nachbesserung bekam es nur `geo`, die Löschung blieb ungeschützt.
 *  E-c  Eine gesperrte id löscht kein Weg (Boot-artiger Abgleich UND Live), solange sie noch als
 *       Layout-ZDO existiert; eine ANDERE id im selben Dokument wird normal entfernt.
 *  E-e  Takt: 1500 Platzierungen, offene Sperre, 6 Leerlauf-Takte — Median ≤ 1 ms, genau eine
 *       Warnzeile und genau eine neue Quittung (aus dem AUSLÖSENDEN Takt, keine aus den sechs danach).
 *
 * Lauf: npx tsx test/z3n1-live-inproc.ts   (aus server/)
 */
import { mkdirSync, mkdtempSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { loeschsperreLesen } from '@wov/shared/src/worldlayout/loeschsperre.js';
import { quittungLesen, quittungsDatei } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../src/WovServer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const WURZEL = mkdtempSync(join(tmpdir(), 'z3n1-live-inproc-'));

type Platz = { id: string; prefab: string; x: number; z: number };
function dokument(placements: Platz[], region: { baseLevel: number } = { baseLevel: 0.3 }): Record<string, unknown> {
  return {
    version: 1,
    name: 'Z3N1',
    detailSeed: 'z3n1',
    continents: [],
    regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1900 }, edgeFalloff: 200, baseLevel: region.baseLevel, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements,
  };
}
function schreibe(datei: string, d: unknown): void {
  const temp = `${datei}.probe.tmp`;
  writeFileSync(temp, JSON.stringify(d));
  renameSync(temp, datei);
}

interface Umgebung {
  server: ReturnType<typeof createWovServer>;
  layout: string;
  quittungsPfad: string;
  loeschsperrePfad: string;
  tick: () => void;
  layoutIds: () => Set<string>;
}

function aufsetzen(name: string, anfang: Platz[]): Umgebung {
  const ordner = mkdtempSync(join(WURZEL, `${name}-`));
  const welten = join(ordner, 'worlds');
  mkdirSync(welten, { recursive: true });
  const layout = join(ordner, 'layout.json');
  schreibe(layout, dokument(anfang));
  const server = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: 'z3n1',
    worldSeed: 'z3n1-live',
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: welten,
    kontenDir: join(ordner, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: layout,
    saveIntervalMs: 3600_000,
  });
  server.start();
  const wache = (server as unknown as { layoutWache: { tick(): void } }).layoutWache;
  wache.tick(); // Bootstand übernehmen
  return {
    server,
    layout,
    quittungsPfad: quittungsDatei(welten, 'z3n1'),
    loeschsperrePfad: join(welten, 'layout-loeschsperre.z3n1.json'),
    tick: () => wache.tick(),
    layoutIds: () => new Set(server.zdos.getAllZDOs().map((z: ZDO) => z.getString(LAYOUT_ID_MEMBER)).filter((id): id is string => !!id)),
  };
}
function abbauen(u: Umgebung): void {
  u.server.stop();
}

try {
  // ── A1b: 30 Bäume + Truhe, dann 11 neue + 31 fehlend (42 Änderungen > 40) ──
  {
    const BAEUME = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, prefab: 'Beech1', x: 10 + i * 3, z: 20 }));
    const KISTE = { id: 'kiste', prefab: 'piece_chest_wood', x: 200, z: 200 };
    const u = aufsetzen('a1b', [...BAEUME, KISTE]);
    check('A1b Aufbau: 31 Layout-ZDOs', u.layoutIds().size === 31, `${u.layoutIds().size}`);
    const NEU = Array.from({ length: 11 }, (_, i) => ({ id: `n${i}`, prefab: 'Beech1', x: 500 + i * 3, z: 20 }));
    schreibe(u.layout, dokument(NEU)); // 31 entfernt + 11 neu = 42 Änderungen
    u.tick();
    const q = quittungLesen(u.quittungsPfad);
    check('A1b Quittung: zu-viele-aenderungen (42 > 40)', q?.grund === 'zu-viele-aenderungen', `${q?.grund}`);
    check('A1b Quittung trägt trotzdem loeschsperre', !!q?.loeschsperre && q.loeschsperre.anzahl >= 31, JSON.stringify(q?.loeschsperre));
    check('A1b nichts live entfernt: noch 31 alte + 0 neue ZDOs', u.layoutIds().size === 31, `${u.layoutIds().size}`);
    const sperre = loeschsperreLesen(u.loeschsperrePfad);
    check(
      'A1b Sperrdatei enthält alle 31 verwaisten ids (Baeume+Truhe), Grund anteil (31 von 31, nicht "alle": das neue Dokument hat noch 11 Einträge)',
      sperre !== null && sperre !== 'kaputt' && sperre.grund === 'anteil' && BAEUME.every((b) => (sperre as { ids: string[] }).ids.includes(b.id)) && (sperre as { ids: string[] }).ids.includes('kiste'),
      JSON.stringify(sperre)
    );
    abbauen(u);
  }

  // ── A1c: leer + gleichzeitig geänderte Region (Geo-Änderung) ──
  {
    const BAEUME = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, prefab: 'Beech1', x: 10 + i * 3, z: 20 }));
    const KISTE = { id: 'kiste-c', prefab: 'piece_chest_wood', x: 200, z: 200 };
    const u = aufsetzen('a1c', [...BAEUME, KISTE]);
    check('A1c Aufbau: 7 Layout-ZDOs', u.layoutIds().size === 7);
    // Leeres placements UND eine geänderte Region (baseLevel) im selben Schreibvorgang.
    schreibe(u.layout, dokument([], { baseLevel: 0.35 }));
    u.tick();
    const q = quittungLesen(u.quittungsPfad);
    check('A1c Quittung: geo (die Regel bleibt bei ihrem bisherigen Grund)', q?.grund === 'geo', `${q?.grund}`);
    check('A1c Quittung trägt trotzdem loeschsperre (7 ids)', q?.loeschsperre?.anzahl === 7, JSON.stringify(q?.loeschsperre));
    check('A1c nichts live entfernt: noch 7 ZDOs', u.layoutIds().size === 7, `${u.layoutIds().size}`);
    const sperre = loeschsperreLesen(u.loeschsperrePfad);
    check(
      'A1c Sperrdatei enthält alle 7 ids, Grund alle',
      sperre !== null && sperre !== 'kaputt' && sperre.grund === 'alle' && sperre.ids.length === 7,
      JSON.stringify(sperre)
    );
    abbauen(u);
  }

  // ── E-c: Folgeänderung an EINEM anderen Objekt löscht normal, die gesperrten ids bleiben ──
  {
    const BAEUME = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, prefab: 'Beech1', x: 10 + i * 3, z: 20 }));
    const ANDERER = { id: 'anderer', prefab: 'Beech1', x: 900, z: 900 };
    // ANKER bleibt in JEDEM Schreibvorgang stehen: ohne ihn würde die zweite Änderung das Dokument auf
    // 0 Einträge leeren, und "gleich alle entfernen" (Regel a) griffe unabhängig von der Zahl erneut —
    // genau das testet dieser Fall NICHT (das ist A1c). Mit dem Anker bleibt das Dokument nichtleer.
    const ANKER = { id: 'anker', prefab: 'Beech1', x: -900, z: -900 };
    const KISTE = { id: 'kiste-e', prefab: 'piece_chest_wood', x: 200, z: 200 };
    const u = aufsetzen('ec', [...BAEUME, ANDERER, ANKER, KISTE]);
    check('E-c Aufbau: 8 Layout-ZDOs', u.layoutIds().size === 8, `${u.layoutIds().size}`);
    // 6 von 8 Platzierungen fallen weg (BAEUME + KISTE): über der 25-%-Grenze (6 > 0,25*8) -> gesperrt.
    schreibe(u.layout, dokument([ANDERER, ANKER]));
    u.tick();
    const sperre1 = loeschsperreLesen(u.loeschsperrePfad);
    check(
      'E-c Sperre ausgelöst: 6 ids gesperrt (Grund anteil)',
      sperre1 !== null && sperre1 !== 'kaputt' && sperre1.grund === 'anteil' && sperre1.ids.length === 6,
      JSON.stringify(sperre1)
    );
    check('E-c nichts live entfernt (noch 8 ZDOs)', u.layoutIds().size === 8, `${u.layoutIds().size}`);
    // Folgeänderung: ANDERER wird NUN auch entfernt (eine einzelne, normale Löschung an einem ANDEREN Objekt,
    // weit unter jeder Massenlöschungsregel, Dokument bleibt nichtleer wegen ANKER) — die 6 gesperrten ids
    // stehen NICHT wieder im Dokument, bleiben also aktiv gesperrt.
    schreibe(u.layout, dokument([ANKER]));
    u.tick();
    const ids = u.layoutIds();
    check('E-c "anderer" ist jetzt weg (normale Löschung läuft)', !ids.has('anderer'), `${[...ids]}`);
    check(
      'E-c die 5 Bäume und die Truhe stehen weiterhin (dauerhaft gesperrt), der Anker auch',
      BAEUME.every((b) => ids.has(b.id)) && ids.has('kiste-e') && ids.has('anker'),
      `${[...ids]}`
    );
    const q = quittungLesen(u.quittungsPfad);
    check('E-c Quittung: angewendet (nur "anderer" war eine normale Löschung)', q?.ergebnis === 'angewendet', `${q?.ergebnis} ${q?.grund}`);
    const sperre2 = loeschsperreLesen(u.loeschsperrePfad);
    check('E-c Sperrdatei unverändert (6 ids, "anderer" war nie darin)', sperre2 !== null && sperre2 !== 'kaputt' && sperre2.ids.length === 6, JSON.stringify(sperre2));
    abbauen(u);
  }

  // ── E-e: Takt ──
  {
    const ANZAHL = 1500;
    let s = 987654;
    const zufall = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const VIEL: Platz[] = Array.from({ length: ANZAHL }, (_, i) => ({
      id: `p${i}`,
      prefab: 'Beech1',
      x: Math.round((zufall() * 2 - 1) * 1800),
      z: Math.round((zufall() * 2 - 1) * 1800),
    }));
    const u = aufsetzen('takt', VIEL);
    check('Takt Aufbau: 1500 Layout-ZDOs', u.layoutIds().size === ANZAHL, `${u.layoutIds().size}`);
    const meldungen: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]): void => {
      meldungen.push(a.map(String).join(' '));
    };
    try {
      schreibe(u.layout, dokument([])); // löst die Sperre aus (dieser Takt zählt NICHT zu den 6 Leerlauf-Takten)
      u.tick();
      // 1500 Entfernungen liegen weit über AENDERUNGEN_MAX (40): Die Quittung DIESES Schreibvorgangs bleibt
      // deshalb bei zu-viele-aenderungen (E-b: "Die Quittung darf ihren bisherigen Grund behalten") — die
      // Sperrdatei wird trotzdem erweitert, unabhängig von der Obergrenze (das prüft `loeschsperre` unten).
      const qAusloeser = quittungLesen(u.quittungsPfad);
      check(
        'Takt Auslöser: zu-viele-aenderungen, Sperre trotzdem erweitert (alle 1500 ids)',
        qAusloeser?.grund === 'zu-viele-aenderungen' && qAusloeser.loeschsperre?.anzahl === ANZAHL,
        JSON.stringify(qAusloeser)
      );
      const quittungVorLeerlauf = readFileSync(u.quittungsPfad, 'utf-8');
      meldungen.length = 0;
      const dauern: number[] = [];
      for (let i = 0; i < 6; i++) {
        const t0 = performance.now();
        u.tick();
        dauern.push(performance.now() - t0);
      }
      const sortiert = [...dauern].sort((a, b) => a - b);
      const median = (sortiert[2]! + sortiert[3]!) / 2;
      console.warn = origWarn;
      check('Takt 6 Leerlauf-Takte: Median <= 1 ms', median <= 1, `Takte: ${dauern.map((d) => d.toFixed(3)).join(', ')} ms`);
      check('Takt: keine neue Warnzeile in den 6 Leerlauf-Takten', meldungen.length === 0, `${meldungen.length}: ${meldungen.join(' | ')}`);
      const quittungNachLeerlauf = readFileSync(u.quittungsPfad, 'utf-8');
      check('Takt: keine neue Quittung in den 6 Leerlauf-Takten (Datei unverändert)', quittungNachLeerlauf === quittungVorLeerlauf);
    } finally {
      console.warn = origWarn;
    }
    abbauen(u);
  }
} finally {
  if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
