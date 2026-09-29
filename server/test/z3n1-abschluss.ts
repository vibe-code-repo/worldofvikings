/**
 * Editor E2, Karte Z3 N1 Abschluss (PR #120): die Fälle, die der Altbestand von N1 offen gelassen hatte.
 * In-process (`createWovServer`, `layoutWache.tick()` direkt), nach dem Muster von `z3n1-live-inproc.ts`.
 *
 *  F1  Nur ENOENT heißt „keine Sperre“: Ein Verzeichnis (EISDIR) am Sperrpfad und kaputtes JSON schließen
 *      auch LIVE (kleine, sonst erlaubte Löschung wird verweigert), Datei/Ordner bleiben unverändert.
 *  F2  Eine kaputte Sperre wird nie überschrieben: neue Löschungen (5 Bäume) legen keinen Teilbestand an.
 *  F3  Anfrage während eines Speichervorgangs: nach der Freigabe innerhalb von zwei Takten verarbeitet.
 *  F4  Ungültige Anfrage (`{"hash":123}`, kein JSON): verbraucht, Logzeile, nichts gelöscht.
 *  F5  Bestätigen übernimmt weder Geo noch andere Objektänderungen und quittiert nicht „angewendet“.
 *  F6  Mehr als 40 gesperrte Alt-Löschungen blockieren eine erlaubte neue Einzelplatzierung nicht.
 *  F7  A5: gefällter Baum bleibt im Dokument und gefällt, nur die Truhe wird gelöscht.
 *  T1  Kreuzfälle mit der Höhenkorrektur: Sperre vor dem Höhenfehler, Reparatur entsperrt nichts, ungültiges
 *      Dokument ist keine Rücknahme, Bestätigen trotz Höhenfehler löscht nur die Truhe.
 *  Takt (E-e) über echte 6 s: Median ≤ 1 ms, genau eine Auslöserwarnung, höchstens eine neue Quittung.
 *
 * Lauf: npx tsx test/z3n1-abschluss.ts   (aus server/)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

const WURZEL = mkdtempSync(join(tmpdir(), 'z3n1-abschluss-'));
let aufgeraeumt = false;
function aufraeumen(): void {
  if (aufgeraeumt) return;
  aufgeraeumt = true;
  for (const u of offen) {
    try {
      u.server.stop();
    } catch {
      /* schon gestoppt */
    }
  }
  rmSync(WURZEL, { recursive: true, force: true });
}
process.on('exit', aufraeumen);
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    aufraeumen();
    process.exit(1);
  });
}

type Platz = { id: string; prefab: string; x: number; z: number };
function dokument(placements: unknown, extra: Record<string, unknown> = {}, baseLevel = 0.3): Record<string, unknown> {
  return {
    version: 1,
    name: 'Z3N1-Abschluss',
    detailSeed: 'z3n1',
    continents: [],
    regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1900 }, edgeFalloff: 200, baseLevel, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements,
    ...extra,
  };
}
function schreibe(datei: string, d: unknown): string {
  const text = JSON.stringify(d);
  const temp = `${datei}.probe.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, datei);
  return layoutHash(text);
}

interface Umgebung {
  server: ReturnType<typeof createWovServer>;
  layout: string;
  welten: string;
  quittungsPfad: string;
  loeschsperrePfad: string;
  anfragePfad: string;
  tick: () => void;
  zdo: (id: string) => ZDO | undefined;
  layoutIds: () => Set<string>;
  roh: () => { regions: { baseLevel: number }[] };
}
const offen: Umgebung[] = [];

function aufsetzen(name: string, anfang: Platz[], extra: Record<string, unknown> = {}): Umgebung {
  const ordner = mkdtempSync(join(WURZEL, `${name}-`));
  const welten = join(ordner, 'worlds');
  mkdirSync(welten, { recursive: true });
  const layout = join(ordner, 'layout.json');
  schreibe(layout, dokument(anfang, extra));
  const server = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: 'z3n1',
    worldSeed: 'z3n1-abschluss',
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
  wache.tick();
  const u: Umgebung = {
    server,
    layout,
    welten,
    quittungsPfad: quittungsDatei(welten, 'z3n1'),
    loeschsperrePfad: join(welten, 'layout-loeschsperre.z3n1.json'),
    anfragePfad: bestaetigenAnfrageDatei(welten, 'z3n1'),
    tick: () => wache.tick(),
    zdo: (id) => server.zdos.getAllZDOs().find((z: ZDO) => z.getString(LAYOUT_ID_MEMBER) === id),
    layoutIds: () => new Set(server.zdos.getAllZDOs().map((z: ZDO) => z.getString(LAYOUT_ID_MEMBER)).filter((id): id is string => !!id)),
    roh: () => (server as unknown as { worldLayoutRaw: { regions: { baseLevel: number }[] } }).worldLayoutRaw,
  };
  offen.push(u);
  return u;
}
function abbauen(u: Umgebung): void {
  u.server.stop();
  offen.splice(offen.indexOf(u), 1);
}

/** Konsolenausgabe (warn/error/log) einsammeln. */
function fange(): { zeilen: string[]; ende: () => void } {
  const zeilen: string[] = [];
  const orig = { warn: console.warn, error: console.error, log: console.log };
  const wrap =
    (): ((...a: unknown[]) => void) =>
    (...a) => {
      zeilen.push(a.map(String).join(' '));
    };
  console.warn = wrap();
  console.error = wrap();
  console.log = wrap();
  return {
    zeilen,
    ende: () => {
      console.warn = orig.warn;
      console.error = orig.error;
      console.log = orig.log;
    },
  };
}
function mitFang<T>(f: () => T): { wert: T; zeilen: string[] } {
  const fang = fange();
  try {
    return { wert: f(), zeilen: fang.zeilen };
  } finally {
    fang.ende();
  }
}

const BAEUME = (n: number, vorsilbe = 't'): Platz[] => Array.from({ length: n }, (_, i) => ({ id: `${vorsilbe}${i}`, prefab: 'Beech1', x: 10 + i * 3, z: 20 }));
const KISTE: Platz = { id: 'kiste', prefab: 'piece_chest_wood', x: 200, z: 200 };

try {
  // ── F1: nur ENOENT heißt „keine Sperre“ (Kontrolle ENOENT, EISDIR, kaputtes JSON) ──
  {
    // Kontrolle: KEINE Sperre (ENOENT) — eine einzelne Löschung läuft ganz normal (10 → 9).
    const k = aufsetzen('f1-enoent', BAEUME(10));
    schreibe(k.layout, dokument(BAEUME(10).slice(1)));
    k.tick();
    check('F1 Kontrolle ENOENT: kleine Einzellöschung läuft (10 → 9)', k.layoutIds().size === 9, `${k.layoutIds().size}`);
    abbauen(k);

    // EISDIR: ein Verzeichnis am Sperrpfad.
    const d = aufsetzen('f1-eisdir', BAEUME(10));
    mkdirSync(d.loeschsperrePfad);
    const { zeilen: zd } = mitFang(() => {
      schreibe(d.layout, dokument(BAEUME(10).slice(1)));
      d.tick();
    });
    check('F1 EISDIR: kleine Löschung wird VERWEIGERT (10 bleibt 10)', d.layoutIds().size === 10, `${d.layoutIds().size}`);
    const qd = quittungLesen(d.quittungsPfad);
    check('F1 EISDIR: Quittung abgelehnt, nicht angewendet', qd?.ergebnis === 'nicht-angewendet' && qd.grund === 'abgelehnt', `${qd?.ergebnis} ${qd?.grund}`);
    check('F1 EISDIR: laute Logzeile GESCHLOSSEN', zd.some((z) => /GESCHLOSSEN/.test(z)), zd.join(' | ').slice(0, 200));
    check('F1 EISDIR: das Verzeichnis ist unverändert da', existsSync(d.loeschsperrePfad));
    abbauen(d);

    // Kaputtes JSON.
    const j = aufsetzen('f1-json', BAEUME(10));
    writeFileSync(j.loeschsperrePfad, '{kaputt');
    const { zeilen: zj } = mitFang(() => {
      schreibe(j.layout, dokument(BAEUME(10).slice(1)));
      j.tick();
    });
    check('F1 kaputtes JSON: kleine Löschung wird VERWEIGERT (10 bleibt 10)', j.layoutIds().size === 10, `${j.layoutIds().size}`);
    check('F1 kaputtes JSON: laute Logzeile', zj.some((z) => /GESCHLOSSEN/.test(z)));
    check('F1 kaputtes JSON: Datei unverändert', readFileSync(j.loeschsperrePfad, 'utf-8') === '{kaputt');

    // ── F2: fünf Löschungen legen KEINEN Teilbestand über die kaputte Sperre ──
    mitFang(() => {
      schreibe(j.layout, dokument(BAEUME(10).slice(5)));
      j.tick();
    });
    check('F2 kaputt + 5 neue Löschungen: Datei weiterhin die kaputten Bytes (nicht überschrieben)', readFileSync(j.loeschsperrePfad, 'utf-8') === '{kaputt');
    mitFang(() => {
      schreibe(j.layout, dokument(BAEUME(10).slice(5).filter((p) => p.id !== 't9')));
      j.tick();
    });
    check('F2 danach t9 zusätzlich entfernt: alle 10 stehen weiterhin (t9 nicht gelöscht)', j.layoutIds().size === 10 && j.layoutIds().has('t9'), `${j.layoutIds().size}`);
    abbauen(j);
  }

  // ── F3: Anfrage während eines Speichervorgangs geht nicht verloren; F4: ungültige Anfrage wird verbraucht ──
  {
    const u = aufsetzen('f3', [...BAEUME(10), KISTE]);
    u.zdo('kiste')!.setString('truheInhalt', '[[Wood,9]]');
    const hashLeer = schreibe(u.layout, dokument(BAEUME(10)));
    u.tick();
    check('F3 Aufbau: Sperre mit der Truhe', ((): boolean => {
      const s = loeschsperreLesen(u.loeschsperrePfad);
      return s !== null && s !== 'kaputt' && s.ids.length === 1 && s.ids[0] === 'kiste';
    })());
    check('F3 Aufbau: 11 Layout-ZDOs, Truhe steht', u.layoutIds().size === 11 && !!u.zdo('kiste'));
    // Die Anfrage trifft ein, WÄHREND ein Speichern läuft (dasselbe Flag, das der Server ohnehin benutzt).
    const srv = u.server as unknown as { speichertGerade: boolean };
    srv.speichertGerade = true;
    const id = bestaetigenAnfrageSchreiben(u.anfragePfad, hashLeer);
    u.tick(); // Save-Takt: nichts geschieht, die Anfrage darf nicht als „erledigt“ gemerkt werden
    srv.speichertGerade = false;
    check('F3 im Save-Takt: Truhe noch da, Anfrage noch da', u.layoutIds().size === 11 && existsSync(u.anfragePfad));
    u.tick();
    u.tick();
    check('F3 nach der Freigabe binnen 2 Takten verarbeitet: Truhe weg (11 → 10)', u.layoutIds().size === 10 && !u.zdo('kiste'), `${u.layoutIds().size}`);
    check('F3 Anfrage-Datei verbraucht, Sperrdatei weg', !existsSync(u.anfragePfad) && !existsSync(u.loeschsperrePfad));
    const q = quittungLesen(u.quittungsPfad);
    check('F3 Quittung nennt genau diese Anfrage (bestaetigung.id, entfernt 1)', q?.bestaetigung?.id === id && q?.bestaetigung?.entfernt === 1, JSON.stringify(q?.bestaetigung));

    // F4: ungültige Anfragen.
    for (const [name, inhalt] of [
      ['hash als Zahl', '{"hash":123}'],
      ['kein JSON', 'das ist kein json'],
      ['leerer Hash', '{"hash":""}'],
    ] as const) {
      const { zeilen } = mitFang(() => {
        writeFileSync(u.anfragePfad, inhalt);
        u.tick();
      });
      check(`F4 ${name}: Anfrage verbraucht`, !existsSync(u.anfragePfad));
      check(`F4 ${name}: Logzeile`, zeilen.some((z) => /Bestätigungsanfrage ungültig/.test(z)), zeilen.join(' | ').slice(0, 200));
      check(`F4 ${name}: nichts gelöscht`, u.layoutIds().size === 10);
    }
    abbauen(u);
  }

  // ── F5: Bestätigen löscht NUR die Truhe; Geo und die Verschiebung von t0 bleiben unangewendet ──
  {
    const u = aufsetzen('f5', [...BAEUME(10), KISTE]);
    u.zdo('kiste')!.setString('truheInhalt', '[[Wood,9]]');
    const bodenVorher = u.server.getGroundHeight(0, 0);
    const t0x = u.zdo('t0')!.position.x;
    const hashNeu = schreibe(u.layout, dokument([{ ...BAEUME(10)[0]!, x: 444 }, ...BAEUME(10).slice(1)], {}, 0.35));
    u.tick();
    const q1 = quittungLesen(u.quittungsPfad);
    check('F5 Aufbau: Quittung geo, Sperre mit der Truhe', q1?.grund === 'geo' && q1.loeschsperre?.anzahl === 1, `${q1?.grund} ${JSON.stringify(q1?.loeschsperre)}`);
    const id = bestaetigenAnfrageSchreiben(u.anfragePfad, hashNeu);
    u.tick();
    const q2 = quittungLesen(u.quittungsPfad);
    check('F5 Truhe gelöscht, alle 10 Bäume stehen', !u.zdo('kiste') && u.layoutIds().size === 10);
    check('F5 Quittung: NICHT angewendet (geo bleibt offen), Bestätigung nennt 1 entfernt', q2?.ergebnis === 'nicht-angewendet' && q2.grund === 'geo' && q2.bestaetigung?.id === id && q2?.bestaetigung?.entfernt === 1, JSON.stringify(q2));
    check('F5 t0 blieb wirklich bei seiner Position (kein x444)', u.zdo('t0')!.position.x === t0x, `${u.zdo('t0')!.position.x}`);
    check('F5 Serverdokument NICHT übernommen (Region weiter 0.3)', u.roh().regions[0]!.baseLevel === 0.3, `${u.roh().regions[0]!.baseLevel}`);
    check('F5 Boden unverändert', u.server.getGroundHeight(0, 0) === bodenVorher);
    check('F5 Sperrdatei weg', !existsSync(u.loeschsperrePfad));
    abbauen(u);
  }

  // ── F6: mehr als 40 gesperrte Alt-Löschungen blockieren keine erlaubte Einzelplatzierung ──
  {
    const u = aufsetzen('f6', [...BAEUME(45), KISTE]);
    schreibe(u.layout, dokument([]));
    u.tick();
    const q1 = quittungLesen(u.quittungsPfad);
    check('F6 Auslöser: zu-viele-aenderungen, 46 ids gesperrt', q1?.grund === 'zu-viele-aenderungen' && q1.loeschsperre?.anzahl === 46, JSON.stringify(q1));
    const NEU: Platz = { id: 'neu-1', prefab: 'Beech1', x: 999, z: 999 };
    schreibe(u.layout, dokument([NEU]));
    u.tick();
    const q2 = quittungLesen(u.quittungsPfad);
    check('F6 erlaubte Einzelplatzierung: angewendet, nicht zu-viele-aenderungen', q2?.ergebnis === 'angewendet', `${q2?.ergebnis} ${q2?.grund} ${q2?.detail}`);
    check('F6 der neue Baum steht, die 46 gesperrten auch (47)', !!u.zdo('neu-1') && u.layoutIds().size === 47, `${u.layoutIds().size}`);
    abbauen(u);
  }

  // ── F7 (A5): gefällter Baum bleibt im Dokument und gefällt; Bestätigen löscht nur die Truhe ──
  {
    const u = aufsetzen('f7', [...BAEUME(10), KISTE]);
    u.server.zdos.destroyZDO(u.zdo('t3')!.zdoid); // gefällt: das Objekt ist weg, der Eintrag steht im Dokument
    check('F7 Aufbau: t3 gefällt, 10 ZDOs übrig', !u.zdo('t3') && u.layoutIds().size === 10);
    u.zdo('kiste')!.setString('truheInhalt', '[[Wood,9]]');
    const hash = schreibe(u.layout, dokument(BAEUME(10))); // t3 bleibt im Dokument, nur die Truhe fehlt
    u.tick();
    check('F7 Sperre: nur die Truhe', ((): boolean => {
      const s = loeschsperreLesen(u.loeschsperrePfad);
      return s !== null && s !== 'kaputt' && s.ids.join() === 'kiste';
    })());
    bestaetigenAnfrageSchreiben(u.anfragePfad, hash);
    u.tick();
    check('F7 Truhe weg', !u.zdo('kiste'));
    check('F7 der gefällte Baum t3 ist NICHT wieder da (kein Abgleich im Boot-Stil)', !u.zdo('t3') && u.layoutIds().size === 9, `${u.layoutIds().size}`);
    const q = quittungLesen(u.quittungsPfad);
    check('F7 Zähler: nichts gespawnt', q?.bestaetigung?.entfernt === 1 && (q.zaehler?.gespawnt ?? 0) === 0, JSON.stringify(q));
    abbauen(u);
  }

  // ── T1: Kreuzfälle mit der Höhenkorrektur ──
  const UNGUELTIG = [{ zx: 0, zz: 0, r: ['0|10|1.5'] }];
  const GUELTIG = [{ zx: 0, zz: 0, r: ['0|10|50'] }];
  {
    // a) gültige Höhenkorrektur + Massenlöschung > 40: die Löschung wird trotzdem gesperrt.
    const u = aufsetzen('t1a', [...BAEUME(45), KISTE]);
    schreibe(u.layout, dokument([], { heightDeltas: GUELTIG }));
    u.tick();
    const q = quittungLesen(u.quittungsPfad);
    const s = loeschsperreLesen(u.loeschsperrePfad);
    check('T1a gültige Höhenkorrektur + 46 Löschungen: Sperre mit 46 ids trotz zu-viele/geo', s !== null && s !== 'kaputt' && s.ids.length === 46 && q?.ergebnis === 'nicht-angewendet', `${q?.grund} ${JSON.stringify(q?.loeschsperre)}`);
    abbauen(u);
  }
  {
    // b) ungültige Höhe + leere Platzierungen: Sperrerfassung vor dem frühen Fehler-Return; Reparatur entsperrt nichts.
    const u = aufsetzen('t1b', [...BAEUME(10), KISTE]);
    u.zdo('kiste')!.setString('truheInhalt', '[[Wood,9]]');
    schreibe(u.layout, dokument([], { heightDeltas: UNGUELTIG }));
    u.tick();
    const q = quittungLesen(u.quittungsPfad);
    check('T1b ungültige Höhe: Quittung verworfen mit heightProblem', q?.grund === 'verworfen' && !!q.heightProblem, `${q?.grund}`);
    const s = loeschsperreLesen(u.loeschsperrePfad);
    check('T1b Sperre trotzdem angelegt (11 ids)', s !== null && s !== 'kaputt' && s.ids.length === 11, JSON.stringify(s));
    check('T1b Quittung nennt die Sperre', q?.loeschsperre?.anzahl === 11, JSON.stringify(q?.loeschsperre));
    check('T1b nichts gelöscht', u.layoutIds().size === 11);
    // Reparatur nur der Höhe (Platzierungen weiter leer): die ids bleiben geschützt.
    schreibe(u.layout, dokument([]));
    u.tick();
    check('T1b nach der Reparatur der Höhe: weiter 11 ZDOs, Sperre weiter da', u.layoutIds().size === 11 && loeschsperreLesen(u.loeschsperrePfad) !== null);
    abbauen(u);
  }
  {
    // c) ungültiges Dokument (Höhenfehler) ist KEINE Rücknahme; das reparierte schon.
    const u = aufsetzen('t1c', [...BAEUME(10), KISTE]);
    u.zdo('kiste')!.setString('truheInhalt', '[[Wood,9]]');
    schreibe(u.layout, dokument(BAEUME(10)));
    u.tick();
    check('T1c Aufbau: Sperre mit der Truhe', loeschsperreLesen(u.loeschsperrePfad) !== null);
    schreibe(u.layout, dokument([...BAEUME(10), KISTE], { heightDeltas: UNGUELTIG }));
    u.tick();
    check('T1c Truhe steht wieder im Dokument, aber mit Höhenfehler: Sperre bleibt', loeschsperreLesen(u.loeschsperrePfad) !== null);
    schreibe(u.layout, dokument([...BAEUME(10), KISTE]));
    u.tick();
    check('T1c Dokument repariert: Rücknahme, Sperrdatei weg', loeschsperreLesen(u.loeschsperrePfad) === null);
    abbauen(u);
  }
  {
    // d) Bestätigen trotz Höhenfehler: löscht nur die Truhe, übernimmt kein Terrain, quittiert die Höhe weiter als verworfen.
    const u = aufsetzen('t1d', [...BAEUME(10), KISTE]);
    u.zdo('kiste')!.setString('truheInhalt', '[[Wood,9]]');
    const hash = schreibe(u.layout, dokument(BAEUME(10), { heightDeltas: UNGUELTIG }));
    u.tick();
    check('T1d Aufbau: Sperre mit der Truhe', loeschsperreLesen(u.loeschsperrePfad) !== null && u.layoutIds().size === 11);
    const id = bestaetigenAnfrageSchreiben(u.anfragePfad, hash);
    u.tick();
    const q = quittungLesen(u.quittungsPfad);
    check('T1d Truhe weg, 10 Bäume stehen', !u.zdo('kiste') && u.layoutIds().size === 10);
    check('T1d Quittung bleibt verworfen mit heightProblem (nicht „angewendet“), Bestätigung 1 entfernt', q?.ergebnis === 'nicht-angewendet' && q.grund === 'verworfen' && !!!!q.heightProblem && q.bestaetigung?.id === id && q?.bestaetigung?.entfernt === 1, JSON.stringify(q));
    check('T1d Sperrdatei weg', !existsSync(u.loeschsperrePfad));
    abbauen(u);
  }

  // ── Takt (E-e) über echte 6 s: 1500 Platzierungen, offene Sperre ──
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
    const fang = fange();
    let auslöserWarnungen = 0;
    let quittungVor = '';
    const dauern: number[] = [];
    let neueQuittungen = 0;
    let warnungenLeerlauf = 0;
    let leerlaufZeilen: string[] = [];
    try {
      schreibe(u.layout, dokument([]));
      u.tick(); // Auslöser
      auslöserWarnungen = fang.zeilen.filter((z) => /Löschsperre: \d+ Objekt/.test(z)).length;
      quittungVor = readFileSync(u.quittungsPfad, 'utf-8');
      fang.zeilen.length = 0;
      const ende = Date.now() + 6000;
      let letzte = quittungVor;
      while (Date.now() < ende) {
        const t0 = performance.now();
        u.tick();
        dauern.push(performance.now() - t0);
        const jetzt = readFileSync(u.quittungsPfad, 'utf-8');
        if (jetzt !== letzte) neueQuittungen++;
        letzte = jetzt;
        await new Promise((r) => setTimeout(r, 100)); // 10 Takte je Sekunde: strenger als der 1-s-Takt des Servers
      }
      leerlaufZeilen = fang.zeilen.filter((z) => /Layout-Wache|Löschsperre|Layout-Abgleich/.test(z)); // Start-Zeilen und Node-Warnungen zählen nicht
      warnungenLeerlauf = leerlaufZeilen.length;
    } finally {
      fang.ende();
    }
    const sortiert = [...dauern].sort((a, b) => a - b);
    const median = sortiert[Math.floor(sortiert.length / 2)]!;
    check('Takt: genau EINE Auslöserwarnung', auslöserWarnungen === 1, `${auslöserWarnungen}`);
    check(`Takt über 6 s (${dauern.length} Takte): Median <= 1 ms`, median <= 1, `Median ${median.toFixed(3)} ms, max ${sortiert[sortiert.length - 1]!.toFixed(3)} ms`);
    check('Takt: keine weitere Warnzeile in den 6 s', warnungenLeerlauf === 0, `${warnungenLeerlauf}: ${leerlaufZeilen.join(' | ').slice(0, 300)}`);
    check('Takt: höchstens eine neue Quittung in den 6 s (Sperre steht darin, aber nichts ändert sich)', neueQuittungen <= 1, `${neueQuittungen}`);
    abbauen(u);
  }
} finally {
  aufraeumen();
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
