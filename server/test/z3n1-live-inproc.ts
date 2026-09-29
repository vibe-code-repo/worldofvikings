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
 *  D1   (Z3 N4) Ein Offline-Wechsel mit einem verworfenen Eintrag im Dokument (`ohneLoeschen`) erzeugt kein zweites
 *       ZDO unter der id; `ersetzteIds` zählt ein fremdes ZDO neben einem passenden nur mit Zustand; Bestätigen
 *       zerstört bei einer im Dokument stehenden id nur die ZDOs mit fremdem Prefab (Truhe samt Inhalt bleibt,
 *       wenn sie wieder das Dokument-Prefab ist). Fälle R8, R5a, R5b des Angriffs auf Z3 N3.
 *
 * Lauf: npx tsx test/z3n1-live-inproc.ts   (aus server/)
 */
import { mkdirSync, mkdtempSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { bestaetigenAnfrageDatei, bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
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
  // ── D1 (Z3 N4): zwei ZDOs unter einer id, Rücknahme und Bestätigen ──
  {
    const B10: Platz[] = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, prefab: 'Beech1', x: 10 + i * 3, z: 20 }));
    const KISTE_D: Platz = { id: 'kiste', prefab: 'piece_chest_wood', x: 200, z: 200 };
    const INHALT = '[[Wood,9]]';
    const TRUHE = `1:piece_chest_wood+${INHALT}`;
    const doc = (prefab: string, extra: Platz[] = []): Platz[] => [...B10, { ...KISTE_D, prefab }, ...extra];
    type Neu = Umgebung & { welten: string; anfragePfad: string; server: ReturnType<typeof createWovServer> };
    const aufD = (name: string): Neu => {
      const u = aufsetzen(name, [...B10, KISTE_D]);
      u.server.zdos.getAllZDOs().find((z: ZDO) => z.getString(LAYOUT_ID_MEMBER) === 'kiste')!.setString('truheInhalt', INHALT);
      const welten = join(u.layout, '..', 'worlds');
      return { ...u, welten, anfragePfad: bestaetigenAnfrageDatei(welten, 'z3n1') };
    };
    const prefabHash = (u: Neu, n: string): number => (u.server as unknown as { prefabs: { getByName(n: string): { hash: number } | undefined } }).prefabs.getByName(n)!.hash;
    const zdosVon = (u: Neu, id: string): string => {
      const namen = ['Beech1', 'Oak1', 'piece_chest_wood'];
      const l = u.server.zdos.getAllZDOs().filter((z: ZDO) => z.getString(LAYOUT_ID_MEMBER) === id);
      return l.length === 0 ? '0' : `${l.length}:` + l.map((z: ZDO) => `${namen.find((n) => prefabHash(u, n) === z.prefabHash) ?? z.prefabHash}${z.getString('truheInhalt') ? `+${z.getString('truheInhalt')}` : ''}`).join('|');
    };
    const sperre = (u: Neu): string => {
      const x = loeschsperreLesen(u.loeschsperrePfad);
      return x === null ? 'KEINE' : x === 'kaputt' ? 'KAPUTT' : x.ids.join(',');
    };
    const stumm = <T,>(f: () => T): T => {
      const o = { w: console.warn, e: console.error, l: console.log };
      console.warn = console.error = console.log = (): void => undefined;
      try {
        return f();
      } finally {
        console.warn = o.w;
        console.error = o.e;
        console.log = o.l;
      }
    };
    const schreibeH = (u: Neu, d: Platz[]): string => {
      const text = JSON.stringify(dokument(d));
      const temp = `${u.layout}.probe.tmp`;
      writeFileSync(temp, text);
      renameSync(temp, u.layout);
      return layoutHash(text);
    };
    const schreibTick = (u: Neu, d: Platz[]): string => stumm(() => {
      const h = schreibeH(u, d);
      u.tick();
      return h;
    });
    const bestaetige = (u: Neu, h: string): void => {
      bestaetigenAnfrageSchreiben(u.anfragePfad, h);
      stumm(() => u.tick());
    };
    const neustartD = (u: Neu, vorBoot: () => void): Neu => {
      u.server.stop();
      vorBoot();
      return stumm(() => {
        const server = createWovServer({
          port: 0, everyoneAdmin: true, worldName: 'z3n1', worldSeed: 'z3n1-live', worldFeatures: false, worldVegetation: false,
          worldsDir: u.welten, kontenDir: join(u.welten, '..', 'konten'), worldMode: 'layout', worldLayoutPath: u.layout, saveIntervalMs: 3600_000,
        });
        server.start();
        const wache = (server as unknown as { layoutWache: { tick(): void } }).layoutWache;
        wache.tick();
        return { ...u, server, tick: () => wache.tick(), layoutIds: () => new Set(server.zdos.getAllZDOs().map((z: ZDO) => z.getString(LAYOUT_ID_MEMBER)).filter((id): id is string => !!id)) };
      });
    };
    const bad = { id: 'bad', prefab: 'Beech1', x: 'abc', z: 1 } as unknown as Platz;

    // R8: Offline-Wechsel + verworfener Eintrag → kein zweites ZDO; Wechsel live → Sperre, Rücknahme hebt sie auf, Bestätigen zerstört die Truhe nicht
    {
      let u = aufD('d1-r8');
      u = neustartD(u, () => schreibeH(u, doc('Beech1', [bad])));
      check('D1/R8 Boot mit verworfenem Eintrag: die Truhe steht allein, KEIN zweites ZDO', zdosVon(u, 'kiste') === TRUHE, zdosVon(u, 'kiste'));
      check('D1/R8 ... und keine Sperre (nichts wurde ersetzt)', sperre(u) === 'KEINE', sperre(u));
      schreibTick(u, doc('Oak1'));
      check('D1/R8 live Wechsel → Oak1: Sperre auf kiste, Truhe steht', sperre(u) === 'kiste' && zdosVon(u, 'kiste') === TRUHE, `${sperre(u)} ${zdosVon(u, 'kiste')}`);
      const hR = schreibTick(u, doc('piece_chest_wood'));
      check('D1/R8 Rücknahme hebt die Sperre auf, Truhe mit Inhalt', sperre(u) === 'KEINE' && zdosVon(u, 'kiste') === TRUHE, `${sperre(u)} ${zdosVon(u, 'kiste')}`);
      u = neustartD(u, () => undefined);
      bestaetige(u, hR);
      check('D1/R8 Neustart + Bestätigen mit dem Rücknahme-Hash: Truheninhalt lebt', zdosVon(u, 'kiste') === TRUHE, zdosVon(u, 'kiste'));
      abbauen(u);
    }
    // R5 (Altbestand): zwei ZDOs unter kiste — Truhe mit Inhalt + ein zustandsloser Baum mit dem Dokument-Prefab
    for (const variante of ['a', 'b'] as const) {
      let u = aufD(`d1-r5${variante}`);
      const h = schreibTick(u, doc('Beech1'));
      const k = u.server.zdos.getAllZDOs().find((z: ZDO) => z.getString(LAYOUT_ID_MEMBER) === 'kiste')!;
      const extra = u.server.zdos.createZDO(prefabHash(u, 'Beech1'), { x: k.position.x, y: k.position.y, z: k.position.z });
      extra.setString(LAYOUT_ID_MEMBER, 'kiste');
      u = neustartD(u, () => undefined);
      check(`D1/R5${variante} Boot Altbestand (Dokument Beech1): Truhe mit Inhalt lebt, Sperre hält`, sperre(u) === 'kiste' && zdosVon(u, 'kiste').includes(INHALT), `${sperre(u)} ${zdosVon(u, 'kiste')}`);
      if (variante === 'a') {
        bestaetige(u, h);
        check('D1/R5a Bestätigen (Dokument Beech1): NUR die Truhe fällt, der passende Baum bleibt (genau 1 Beech1)', zdosVon(u, 'kiste') === '1:Beech1' && sperre(u) === 'KEINE', `${zdosVon(u, 'kiste')} ${sperre(u)}`);
      } else {
        // Rücknahme: das Dokument sagt wieder Truhe; der zustandslose Baum daneben hält die Sperre nicht
        const hR = schreibTick(u, doc('piece_chest_wood'));
        check('D1/R5b Rücknahme: die Sperre fällt (ein zustandsloses fremdes ZDO hält sie nicht)', sperre(u) === 'KEINE', `${sperre(u)} ${zdosVon(u, 'kiste')}`);
        check('D1/R5b Rücknahme: Truhe mit Inhalt lebt', zdosVon(u, 'kiste').includes(INHALT), zdosVon(u, 'kiste'));
        bestaetige(u, hR);
        check('D1/R5b Bestätigen nach der Rücknahme: Truheninhalt lebt', zdosVon(u, 'kiste').includes(INHALT), zdosVon(u, 'kiste'));
      }
      abbauen(u);
    }
    // R5c (Z3 N5, E3): Altbestand mit ZWEI ZDOs MIT Zustand unter einer id — das passende (Dokument-Prefab Beech1) mit
    // eigenem Inhalt, dazu die alte Truhe. Bestätigen zerstört nur das ZDO mit fremdem Prefab (die Truhe); das passende
    // behält seinen Inhalt. Tötet die Mutante "bestaetigungsZdos zerstört wieder ALLE ZDOs der id" (D1 (c)), die R5a/R5b
    // überlebt, weil deren passendes ZDO zustandslos ist und im nächsten Abgleich ohnehin neu entsteht.
    {
      let u = aufD('d1-r5c');
      const h = schreibTick(u, doc('Beech1'));
      const k = u.server.zdos.getAllZDOs().find((z: ZDO) => z.getString(LAYOUT_ID_MEMBER) === 'kiste')!;
      const passend = u.server.zdos.createZDO(prefabHash(u, 'Beech1'), { x: k.position.x, y: k.position.y, z: k.position.z });
      passend.setString(LAYOUT_ID_MEMBER, 'kiste');
      passend.setString('truheInhalt', '[[Stone,3]]');
      u = neustartD(u, () => undefined);
      check('D1/R5c Boot Altbestand: beide ZDOs mit Inhalt leben, Sperre hält', sperre(u) === 'kiste' && zdosVon(u, 'kiste').startsWith('2:') && zdosVon(u, 'kiste').includes(INHALT) && zdosVon(u, 'kiste').includes('[[Stone,3]]'), `${sperre(u)} ${zdosVon(u, 'kiste')}`);
      bestaetige(u, h);
      check('D1/R5c Bestätigen: die Truhe (fremdes Prefab) fällt, das passende Beech1 behält SEINEN Inhalt', zdosVon(u, 'kiste') === '1:Beech1+[[Stone,3]]' && sperre(u) === 'KEINE', `${zdosVon(u, 'kiste')} ${sperre(u)}`);
      abbauen(u);
    }
  }
} finally {
  if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
