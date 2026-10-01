/**
 * Entfernte Vegetation V1: der Betriebsdienst lehnt ein beschädigtes oder zu großes `vegetationEntfernt` mit 422 ab
 * (nichts geschrieben), nimmt gültige Kreise an und liefert sie wieder aus.
 * Removed vegetation V1: the operations service refuses a damaged or oversized list with 422 (nothing written).
 *
 *   npx tsx test/welt-vegetation-422.ts   (aus admin/)
 *
 * Der ECHTE Betriebsdienst (admin/src/main.ts, WOV_WURZEL = Temp-Verzeichnis, Port 0, ohne Spielserver:
 * WOV_QUITTUNG=aus). Nach server/data/ oder /var/lib/wov wird nie geschrieben.
 *  1  gültige Kreise: 200, die Datei trägt sie, GET liefert sie, der Hash ändert sich
 *  2  Radius außerhalb (500): 422, art `vegetation`, `fehlerhaftVegetation` nennt eintrag/feld/wert, Datei byte-identisch
 *  3  4097 Kreise: 422 `zu-viele-vegetationskreise` mit anzahl/grenze, Datei byte-identisch
 *  4  Feld kein Array: 422
 *  5  Datei von Hand beschädigt: GET antwortet 422 mit demselben Befund (nicht 400/500, nicht still gekürzt)
 *  6  PATCH auf eine andere Sammlung lässt vorhandene gültige Kreise unangetastet
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const TSX = resolve(ADMIN, '..', 'node_modules/.bin/tsx');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-welt-vegetation-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const TOKEN = 'vegetation-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(WELTEN, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, '#!/bin/sh\nexit 0\n');
chmodSync(SYSTEMCTL, 0o755);

const dokument = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  name: 'Vegetation-422',
  detailSeed: 'vegetation-422',
  continents: [],
  regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
  defaultSpawn: [0, 0],
  placements: [{ id: 't0', prefab: 'Beech1', x: 20, z: 20 }],
  ...extra,
});
writeFileSync(WELT_DATEI, JSON.stringify(dokument(), null, 2));

let dienst: ChildProcess | null = null;
function dienstStarten(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    let protokoll = '';
    dienst = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: { ...process.env, WOV_WURZEL: ORDNER, WOV_WELT_VERZEICHNIS: WELTEN, NODE_ENV: 'test', WOV_INSTANZ: 'dev', WOV_ADMIN_ADRESSE: '127.0.0.1', WOV_ADMIN_PORT: '0', WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI, WOV_SYSTEMCTL: SYSTEMCTL, WOV_QUITTUNG: 'aus' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zeit = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${protokoll}`)), 30_000);
    const auf = (s: Buffer): void => {
      protokoll += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(protokoll);
      if (t) {
        clearTimeout(zeit);
        fertig(Number(t[1]));
      }
    };
    dienst.stdout!.on('data', auf);
    dienst.stderr!.on('data', auf);
  });
}

interface Antwort {
  status: number;
  daten: Record<string, unknown>;
}
const port = await dienstStarten();
const BASIS = `http://127.0.0.1:${port}/api/worldlayout`;
async function anfrage(methode: 'GET' | 'POST', leib?: unknown, ifMatch?: string): Promise<Antwort> {
  const r = await fetch(BASIS, {
    method: methode,
    headers: {
      'x-wov-token': TOKEN,
      ...(ifMatch !== undefined ? { 'if-match': ifMatch } : {}),
      ...(leib !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: leib !== undefined ? JSON.stringify(leib) : undefined,
  });
  return { status: r.status, daten: (await r.json()) as Record<string, unknown> };
}
const platte = (): Buffer => readFileSync(WELT_DATEI);
const baks = (): number => readdirSync(WELTEN).filter((f) => f.endsWith('.bak')).length;
const hashJetzt = async (): Promise<string> => String((await anfrage('GET')).daten.hash);

try {
  // 1
  const h0 = await hashJetzt();
  const kreise = [{ x: 100, z: -50, r: 8 }, { x: 5, z: 5, r: 1.5, nur: 'baeume' }];
  const ok = await anfrage('POST', dokument({ vegetationEntfernt: kreise }), h0);
  check('1 gültige Kreise: 200', ok.status === 200 && ok.daten.ok === true, `${ok.status} ${JSON.stringify(ok.daten).slice(0, 160)}`);
  check('1 die Datei trägt die Kreise', JSON.stringify(JSON.parse(platte().toString()).vegetationEntfernt) === JSON.stringify(kreise));
  const g = await anfrage('GET');
  check('1 GET liefert die Kreise, der Hash hat sich geändert', JSON.stringify((g.daten.layout as { vegetationEntfernt?: unknown }).vegetationEntfernt) === JSON.stringify(kreise) && g.daten.hash !== h0);
  const h1 = String(g.daten.hash);

  // 2
  const vorher = platte();
  const b0 = baks();
  const r2 = await anfrage('POST', dokument({ vegetationEntfernt: [{ x: 1, z: 1, r: 500 }, { x: 'a', z: 1, r: 5 }] }), h1);
  const f2 = r2.daten.fehlerhaftVegetation as Array<{ eintrag: string; feld: string; wert: unknown }> | undefined;
  check('2 Radius außerhalb: 422, art vegetation, ungueltig', r2.status === 422 && r2.daten.art === 'vegetation' && r2.daten.fehler === 'ungueltig' && r2.daten.ok === false, `${r2.status} ${JSON.stringify(r2.daten).slice(0, 200)}`);
  check('2 die Liste nennt eintrag/feld/wert', Array.isArray(f2) && f2.length === 2 && f2[0]!.eintrag === '#0' && f2[0]!.feld === 'r' && f2[0]!.wert === 500 && f2[1]!.feld === 'x', JSON.stringify(f2));
  check('2 Datei byte-identisch, keine Sicherung angelegt', platte().equals(vorher) && baks() === b0);

  // 3
  const viele = Array.from({ length: 4097 }, (_, i) => ({ x: i, z: 0, r: 1 }));
  const r3 = await anfrage('POST', dokument({ vegetationEntfernt: viele }), h1);
  check('3 4097 Kreise: 422 zu-viele-vegetationskreise mit anzahl/grenze', r3.status === 422 && r3.daten.fehler === 'zu-viele-vegetationskreise' && r3.daten.anzahl === 4097 && r3.daten.grenze === 4096, `${r3.status} ${JSON.stringify(r3.daten).slice(0, 200)}`);
  check('3 Datei byte-identisch', platte().equals(vorher));
  const r3b = await anfrage('POST', dokument({ vegetationEntfernt: viele.slice(0, 4096) }), h1);
  check('3 genau 4096 Kreise: 200', r3b.status === 200, `${r3b.status}`);
  writeFileSync(WELT_DATEI, vorher);
  const h1b = await hashJetzt();

  // 4
  const r4 = await anfrage('POST', dokument({ vegetationEntfernt: 'kaputt' }), h1b);
  check('4 Feld kein Array: 422 art vegetation', r4.status === 422 && r4.daten.art === 'vegetation', `${r4.status} ${JSON.stringify(r4.daten).slice(0, 200)}`);
  check('4 Datei byte-identisch', platte().equals(vorher));

  // 6 PATCH auf eine andere Sammlung
  const stand6 = await anfrage('GET');
  const t0 = ((stand6.daten.layout as { placements: Array<Record<string, unknown>> }).placements).find((p) => p.id === 't0')!;
  const patch = await fetch(`${BASIS}/ops`, {
    method: 'PATCH',
    headers: { 'x-wov-token': TOKEN, 'content-type': 'application/json', 'if-match': String(stand6.daten.hash) },
    body: JSON.stringify({ vorgangId: 'veg-6', ops: [{ art: 'aendere', sammlung: 'placements', id: 't0', vorher: t0, nachher: { ...t0, x: 21 } }] }),
  });
  const pj = (await patch.json()) as Record<string, unknown>;
  const nach = JSON.parse(platte().toString()) as { vegetationEntfernt?: unknown; placements?: Array<{ x: number }> };
  check('6 PATCH auf placements: 200 und die Kreise bleiben', patch.status === 200 && JSON.stringify(nach.vegetationEntfernt) === JSON.stringify(kreise) && nach.placements?.[0]?.x === 21, `${patch.status} ${JSON.stringify(pj).slice(0, 200)}`);

  // 5 von Hand beschädigt
  const kaputt = dokument({ vegetationEntfernt: [{ x: 1, z: 1, r: 5 }, { x: 2, z: 2, r: -3 }] });
  writeFileSync(WELT_DATEI, JSON.stringify(kaputt, null, 2));
  const vorKaputt = platte();
  const r5 = await anfrage('GET');
  check('5 beschädigte Datei: GET 422 art vegetation mit Befund (#1, r)', r5.status === 422 && r5.daten.art === 'vegetation' && (r5.daten.fehlerhaftVegetation as Array<{ eintrag: string; feld: string }>)?.[0]?.eintrag === '#1', `${r5.status} ${JSON.stringify(r5.daten).slice(0, 200)}`);
  check('5 GET hat die Datei nicht angefasst', platte().equals(vorKaputt));
} finally {
  (dienst as ChildProcess | null)?.kill('SIGTERM');
  await new Promise((f) => setTimeout(f, 300));
  rmSync(ORDNER, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} FAILED`);
  process.exit(1);
}
console.log('\nAll welt-vegetation-422 checks passed.');
