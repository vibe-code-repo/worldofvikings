/**
 * Karte T1/N1/N2 (Angriffsbefunde B1, B3, N1 "nicht aussperren", N3, N4, N5):
 * `heightDeltas` im echten Betriebsdienst (POST /api/worldlayout und PATCH
 * /api/worldlayout/ops, real service, port 0). B1 war der Kernbefund: eine
 * ungültige heightDeltas-Angabe fiel bisher durch den ganzen Fehlerzweig und
 * landete im Sammel-catch als 400 OHNE Liste, statt 422 MIT `fehlerhaftHoehe`
 * (analog Platzierungen, aber eigene Liste seit N3). B3: mehr als die
 * Obergrenze an Zonen/Punkten wurde mit 200 still gekürzt statt mit 422
 * abgewiesen. N1 "nicht aussperren": PATCH auf eine ANDERE Sammlung
 * (placements) darf ein bereits vorhandenes, über der Grenze liegendes oder
 * teilweise korruptes heightDeltas nicht sperren oder still kürzen. N4: eine
 * EINZIGE ungültige Zone gibt immer noch 422 MIT Liste (nicht den groben
 * "keiner der Einträge gültig"-Zweig ohne Liste). N5: die Grenzen 4096/4097
 * (Zonen) und 100000/100001 (Punkte) sind EXAKT getroffen, nicht ab-/aufgerundet.
 *
 *   npx tsx test/weltops-hoehenkorrektur.ts   (aus admin/)
 *
 * Zeilenform (N2): jede Zone `{ zx, zz, r: string[] }`, je Zeile `"ry|i|d"`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldLayout } from '@wov/shared';
import { createWovServer } from '../../server/src/WovServer.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const TSX = resolve(ADMIN, '..', 'node_modules/.bin/tsx');

let fehler = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-weltops-hoehenkorrektur-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const SPIELSTAENDE = resolve(ORDNER, 'server/data/worlds');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const LAEUFT = resolve(ORDNER, 'laeuft');
const TOKEN = 'hoehenkorrektur-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(WELTEN, { recursive: true });
mkdirSync(SPIELSTAENDE, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, `#!/bin/sh\nif [ "$1" = show ]; then if [ -e "${LAEUFT}" ]; then echo ActiveState=active; else echo ActiveState=inactive; fi; fi\nexit 0\n`);
chmodSync(SYSTEMCTL, 0o755);

function dokument(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'Hoehenkorrektur-Dienst',
    detailSeed: 'hoehenkorrektur-dienst',
    continents: [],
    regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements: [],
    ...extra,
  };
}
writeFileSync(WELT_DATEI, JSON.stringify(dokument(), null, 2));

let dienst = null as ChildProcess | null;
function dienstStarten(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    let protokoll = '';
    dienst = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: { ...process.env, WOV_WURZEL: ORDNER, WOV_WELT_VERZEICHNIS: WELTEN, NODE_ENV: 'test', WOV_INSTANZ: 'dev', WOV_ADMIN_ADRESSE: '127.0.0.1', WOV_ADMIN_PORT: '0', WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI, WOV_SYSTEMCTL: SYSTEMCTL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zeit = setTimeout(() => scheitern(new Error(`service does not start:\n${protokoll}`)), 30_000);
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
const port = await dienstStarten();
process.env.WOV_ADMIN_URL = `http://127.0.0.1:${port}`;
process.env.WOV_ADMIN_TOKEN = TOKEN;
process.env.WOV_MCP_FREMDE_WELT = '1';
// Load foreign package entry points at runtime; their DOM/SDK type environments
// belong to their own package checks, not to the admin Node-only tsconfig.
const mcp = await import(new URL('../../tools/worldlayout-mcp/kern.ts', import.meta.url).href);
const { holeWeltdokument, schreibeWeltdokument } = await import(new URL('../../client/src/editor/weltdokument.ts', import.meta.url).href);
const adminFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers); headers.set('x-wov-token', TOKEN);
  return fetch(`http://127.0.0.1:${port}${String(input)}`, { ...init, headers });
};

const server = createWovServer({
  port: 0,
  worldName: 'dev',
  worldSeed: 'hoehenkorrektur-dienst',
  worldFeatures: false,
  worldVegetation: false,
  worldsDir: SPIELSTAENDE,
  kontenDir: resolve(ORDNER, 'konten'),
  worldMode: 'layout',
  worldLayoutPath: WELT_DATEI,
  saveIntervalMs: 3600_000,
});
await server.start();
writeFileSync(LAEUFT, '');

interface HoehenFehlerEintrag {
  zone: string;
  feld: string;
  wert: unknown;
}
interface Daten {
  ok?: boolean;
  hash?: string;
  fehler?: string;
  grund?: string;
  anzahl?: number;
  grenze?: number;
  message?: string;
  art?: string;
  fehlerhaftHoehe?: HoehenFehlerEintrag[];
  fehlerhaft?: { id: string; feld: string; wert: unknown }[];
  heightProblem?: unknown;
  detail?: string;
  anzahlFehlerhaftHoehe?: number;
  angewendet?: boolean;
  zaehler?: Record<string, number>;
  layout?: { heightDeltas?: { zx: number; zz: number; r: string[] }[] };
}
async function anfrage(methode: 'GET' | 'POST' | 'PATCH', pfad: string, leib?: unknown, ifMatch?: string): Promise<{ status: number; daten: Daten }> {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, {
    method: methode,
    headers: { 'x-wov-token': TOKEN, ...(leib !== undefined ? { 'content-type': 'application/json' } : {}), ...(ifMatch ? { 'if-match': ifMatch } : {}) },
    body: leib !== undefined ? JSON.stringify(leib) : undefined,
  });
  return { status: r.status, daten: (await r.json().catch(() => ({}))) as Daten };
}
const schlafen = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));
const stumm = (): void => undefined;
async function aktuellerHash(): Promise<string> {
  const g = await anfrage('GET', '/api/worldlayout');
  return g.daten.hash!;
}
async function post(heightDeltas: unknown): Promise<{ status: number; daten: Daten }> {
  const basis = await aktuellerHash();
  return anfrage('POST', '/api/worldlayout', dokument({ heightDeltas }), basis);
}
async function patch(nachher: Record<string, unknown>): Promise<{ status: number; daten: Daten }> {
  return anfrage('PATCH', '/api/worldlayout/ops', { vorgangId: `v-${nachher.id as string}`, ops: [{ art: 'setze', sammlung: 'placements', id: nachher.id, nachher }] });
}
const findet = (d: Daten, zone: string, feld: string): HoehenFehlerEintrag | undefined =>
  d.fehlerhaftHoehe?.find((f) => f.zone === zone && f.feld === feld);

/** Eine volle Zone (4096 Punkte, alle einzeln gültig) als Zeilen-Strings. */
function volleZoneZeilen(deltaBasis: number): string[] {
  const zeilen: string[] = [];
  for (let ry = 0; ry < 64; ry++) {
    const i = Array.from({ length: 64 }, (_, rx) => rx).join(',');
    const d = Array.from({ length: 64 }, () => String(deltaBasis)).join(',');
    zeilen.push(`${ry}|${i}|${d}`);
  }
  return zeilen;
}
/** Eine Zone mit GENAU `anzahl` gültigen Punkten (≤ 4096), Zeilen zu je 64 gefüllt. */
function teilZoneZeilen(anzahl: number, deltaBasis: number): string[] {
  const zeilen: string[] = [];
  let rest = anzahl;
  let ry = 0;
  while (rest > 0) {
    const n = Math.min(64, rest);
    const i = Array.from({ length: n }, (_, rx) => rx).join(',');
    const d = Array.from({ length: n }, () => String(deltaBasis)).join(',');
    zeilen.push(`${ry}|${i}|${d}`);
    rest -= n;
    ry++;
  }
  return zeilen;
}
/** `anzahlZonen` einzeln gültige Zonen mit je einem Punkt — für die ZONEN-Grenze, zx/zz bleiben klein (Raster 64×N). */
function vieleZonenJeEinPunkt(anzahlZonen: number): { zx: number; zz: number; r: string[] }[] {
  return Array.from({ length: anzahlZonen }, (_, k) => ({ zx: k % 64, zz: Math.floor(k / 64), r: ['0|0|1'] }));
}
/** `anzahlPunkte` gültige Punkte in möglichst wenigen vollen Zonen — für die PUNKTE-Grenze. */
function vielePunkteWenigeZonen(anzahlPunkte: number): { zx: number; zz: number; r: string[] }[] {
  const zonen: { zx: number; zz: number; r: string[] }[] = [];
  let rest = anzahlPunkte;
  let zk = 0;
  while (rest >= 4096) {
    zonen.push({ zx: zk % 64, zz: Math.floor(zk / 64), r: volleZoneZeilen(1) });
    rest -= 4096;
    zk++;
  }
  if (rest > 0) {
    zonen.push({ zx: zk % 64, zz: Math.floor(zk / 64), r: teilZoneZeilen(rest, 1) });
  }
  return zonen;
}

/** Wartet, bis die Datei auf der Platte ein `heightDeltas` mit dieser Zonenzahl zeigt (Live-Wache/Boot-Nachlauf). */
async function warteAufDatei(bed: (roh: { heightDeltas?: unknown }) => boolean, ms = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const roh = JSON.parse(readFileSync(WELT_DATEI, 'utf-8')) as { heightDeltas?: unknown };
      if (bed(roh)) return true;
    } catch {
      /* Datei wird gerade geschrieben (rename): erneut versuchen */
    }
    await schlafen(20);
  }
  return false;
}

const orig = { log: console.log, warn: console.warn };
try {
  console.log = stumm;
  console.warn = stumm;

  const basis0 = await aktuellerHash();
  check('set-up: GET liefert den Ausgangshash', typeof basis0 === 'string' && basis0.length > 0, basis0);

  // ── B1: doppelte Zone ──
  const doppelt = await post([{ zx: 0, zz: 0, r: ['0|1|5'] }, { zx: 0, zz: 0, r: ['0|2|5'] }]);
  check('doppelte Zone: 422 ungueltig', doppelt.status === 422 && doppelt.daten.fehler === 'ungueltig' && doppelt.daten.art === 'hoehenkorrektur', `${doppelt.status} ${doppelt.daten.fehler} ${doppelt.daten.art}`);
  check('doppelte Zone: die Liste nennt Zone 0,0 und Feld "zone"="doppelt"', findet(doppelt.daten, '0,0', 'zone')?.wert === 'doppelt', JSON.stringify(doppelt.daten.fehlerhaftHoehe));

  // ── N4: EINE EINZIGE ungültige Zone gibt trotzdem 422 MIT Liste (nicht der grobe "keiner gültig"-Zweig ohne Liste) ──
  const einzelUngueltig = await post([{ zx: 5, zz: 5, r: ['70|0|1'] }]);
  check(
    'N4: eine einzige ungültige Zone (ry=70 außerhalb 0…63): 422 MIT Liste, nicht ohne',
    einzelUngueltig.status === 422 && (einzelUngueltig.daten.anzahlFehlerhaftHoehe ?? 0) > 0 && (einzelUngueltig.daten.fehlerhaftHoehe?.length ?? 0) > 0,
    `${einzelUngueltig.status} anzahl=${einzelUngueltig.daten.anzahlFehlerhaftHoehe} liste=${JSON.stringify(einzelUngueltig.daten.fehlerhaftHoehe)}`
  );
  check('N4: die Liste nennt Zone 5,5 und Feld "r[0].ry"', findet(einzelUngueltig.daten, '5,5', 'r[0].ry')?.wert === '70', JSON.stringify(einzelUngueltig.daten.fehlerhaftHoehe));

  // ── B1: gemischte Punkte (ein gültiger, ein ungültiger Punkt in einer Zone) ──
  const gemischt = await post([{ zx: 1, zz: 1, r: ['0|10,99999|50,1'] }]);
  check('gemischte Punkte: 422 ungueltig, nichts teilweise gespeichert', gemischt.status === 422 && gemischt.daten.fehler === 'ungueltig', `${gemischt.status}`);
  check('gemischte Punkte: die Liste nennt den ungültigen Wert (r[0].rx=99999)', findet(gemischt.daten, '1,1', 'r[0].rx')?.wert === 99999, JSON.stringify(gemischt.daten.fehlerhaftHoehe));
  const nachGemischt = await anfrage('GET', '/api/worldlayout');
  check('gemischte Punkte: nichts gespeichert (kein heightDeltas nach dem Versuch)', !nachGemischt.daten.layout?.heightDeltas);

  // ── __proto__ als Schlüssel: kein Absturz, keine Verschmutzung, normale 200-Antwort ──
  const protoRoh = { zx: 2, zz: 2, r: ['0|5|10'], __proto__: { polluted: true } };
  const proto = await post([protoRoh]);
  // 202 ist der ERWARTETE, richtige Status: heightDeltas ist "geo" (K5.0), also geschrieben aber erst nach Neustart wirksam.
  check('__proto__ im Zonen-Objekt: 200/201/202, kein Absturz', [200, 201, 202].includes(proto.status), `${proto.status} ${JSON.stringify(proto.daten)}`);
  check('__proto__: Object.prototype bleibt sauber', (Object.prototype as unknown as { polluted?: unknown }).polluted === undefined);
  const nachProto = await anfrage('GET', '/api/worldlayout');
  const gespeichertProto = nachProto.daten.layout?.heightDeltas;
  check('__proto__: die Zone selbst (zx/zz/r) wurde normal gespeichert', gespeichertProto?.length === 1 && gespeichertProto[0]!.zx === 2 && gespeichertProto[0]!.r[0] === '0|5|10', JSON.stringify(gespeichertProto));

  // ── Index 64 (Zeile 1, Spalte 0): GÜLTIGER, gewöhnlicher Punkt seit N1/B2 ──
  const idx64 = await post([{ zx: 0, zz: 0, r: ['1|0|250'] }]);
  check('Index 64: 200/201/202 (gültig seit N1/B2, 202 weil geo)', [200, 201, 202].includes(idx64.status), `${idx64.status} ${JSON.stringify(idx64.daten)}`);
  const nach64 = await anfrage('GET', '/api/worldlayout');
  const gespeichert64 = nach64.daten.layout?.heightDeltas;
  check('Index 64: unverändert gespeichert (Zeile "1|0|250")', gespeichert64?.length === 1 && gespeichert64[0]!.r[0] === '1|0|250', JSON.stringify(gespeichert64));

  // ── N5: Zonen-Grenze EXAKT — 4096 gültig (200/202), 4097 ungültig (422) ──
  const genau4096 = await post(vieleZonenJeEinPunkt(4096));
  check(
    'N5: genau 4096 Zonen (an der Grenze): 200/201/202, GESPEICHERT (kein 422)',
    [200, 201, 202].includes(genau4096.status),
    `${genau4096.status} ${JSON.stringify(genau4096.daten)}`
  );
  const nach4096 = await anfrage('GET', '/api/worldlayout');
  check('N5: 4096 Zonen wirklich gespeichert (nicht 422 verworfen)', (nach4096.daten.layout?.heightDeltas?.length ?? 0) === 4096, `${nach4096.daten.layout?.heightDeltas?.length}`);

  const genau4097 = await post(vieleZonenJeEinPunkt(4097));
  check(
    'N5: 4097 Zonen (eine über der Grenze): 422 zu-viele-hoehenzonen, anzahl exakt 4097',
    genau4097.status === 422 && genau4097.daten.fehler === 'zu-viele-hoehenzonen' && genau4097.daten.anzahl === 4097 && genau4097.daten.grenze === 4096,
    `${genau4097.status} ${genau4097.daten.fehler} anzahl=${genau4097.daten.anzahl} grenze=${genau4097.daten.grenze}`
  );
  const nach4097Versuch = await anfrage('GET', '/api/worldlayout');
  check('N5: nach dem 4097-Versuch weiterhin die 4096 Zonen von vorher (nichts überschrieben)', (nach4097Versuch.daten.layout?.heightDeltas?.length ?? 0) === 4096);

  // ── N5: Punkte-Grenze EXAKT — 100000 gültig (200/202), 100001 ungültig (422) ──
  const genau100000 = await post(vielePunkteWenigeZonen(100_000));
  check(
    'N5: genau 100000 Punkte (an der Grenze): 200/201/202, GESPEICHERT (kein 422)',
    [200, 201, 202].includes(genau100000.status),
    `${genau100000.status} ${JSON.stringify(genau100000.daten).slice(0, 200)}`
  );
  const nach100000 = await anfrage('GET', '/api/worldlayout');
  const punkteGezaehlt100000 = (nach100000.daten.layout?.heightDeltas ?? []).reduce(
    (n, z) => n + z.r.reduce((m, zeile) => m + (zeile.split('|')[1]?.split(',').length ?? 0), 0),
    0
  );
  check('N5: 100000 Punkte wirklich gespeichert (nicht 422 verworfen)', punkteGezaehlt100000 === 100_000, `${punkteGezaehlt100000}`);

  const genau100001 = await post(vielePunkteWenigeZonen(100_001));
  check(
    'N5: 100001 Punkte (einer über der Grenze): 422 zu-viele-hoehenpunkte, anzahl exakt 100001',
    genau100001.status === 422 && genau100001.daten.fehler === 'zu-viele-hoehenpunkte' && genau100001.daten.anzahl === 100_001 && genau100001.daten.grenze === 100_000,
    `${genau100001.status} ${genau100001.daten.fehler} anzahl=${genau100001.daten.anzahl} grenze=${genau100001.daten.grenze}`
  );
  const nach100001Versuch = await anfrage('GET', '/api/worldlayout');
  const punkteNach100001Versuch = (nach100001Versuch.daten.layout?.heightDeltas ?? []).reduce(
    (n, z) => n + z.r.reduce((m, zeile) => m + (zeile.split('|')[1]?.split(',').length ?? 0), 0),
    0
  );
  check('N5: nach dem 100001-Versuch weiterhin die 100000 Punkte von vorher (nichts überschrieben)', punkteNach100001Versuch === 100_000, `${punkteNach100001Versuch}`);

  // ── N1 "nicht aussperren" (a): PATCH auf placements bewahrt ein heightDeltas über der Zonen-Grenze unverändert ──
  // Roh geschrieben (bewusst AUSSERHALB des Dienstes, wie ein git-Merge oder eine Hand-Bearbeitung): 5000 Zonen, jede
  // für sich gültig, aber über HOEHENKORREKTUR_ZONEN_GRENZE (4096) — ein POST würde das mit 422 abweisen.
  const uebergrosseHoehe = vieleZonenJeEinPunkt(5000);
  writeFileSync(`${WELT_DATEI}.tmp`, JSON.stringify(dokument({ heightDeltas: uebergrosseHoehe, placements: [] })));
  renameSync(`${WELT_DATEI}.tmp`, WELT_DATEI);
  await warteAufDatei((roh) => Array.isArray(roh.heightDeltas) && roh.heightDeltas.length === 5000);
  const patchUebergross = await patch({ id: 'patch-uebergross', prefab: 'Beech1', x: 5, z: 5 });
  // 200 ODER 202 sind beide "geschrieben" (s. anwendung.ts): 202 heißt nur, dass die Live-Wache das
  // übergroße heightDeltas (zu Recht) nicht HEISS anwenden konnte — die Datei selbst ist in beiden
  // Fällen bereits geschrieben. NICHT erwartet: 422 (blockiert) oder 503 (gesperrt/wettlauf).
  check(
    'N1 nicht aussperren (a): PATCH auf placements trotz heightDeltas über der Zonen-Grenze: geschrieben (200/202), nicht 422 blockiert',
    [200, 202].includes(patchUebergross.status) && patchUebergross.daten.ok === true,
    `${patchUebergross.status} ${JSON.stringify(patchUebergross.daten)}`
  );
  const nachPatchUebergross = JSON.parse(readFileSync(WELT_DATEI, 'utf-8')) as { heightDeltas?: unknown[]; placements?: { id: string }[] };
  check(
    'N1 nicht aussperren (a): alle 5000 Zonen bleiben ERHALTEN (kein stilles Kürzen auf 4096)',
    (nachPatchUebergross.heightDeltas?.length ?? 0) === 5000,
    `${nachPatchUebergross.heightDeltas?.length}`
  );
  check(
    'N1 nicht aussperren (a): die neue Platzierung wurde trotzdem gesetzt',
    (nachPatchUebergross.placements ?? []).some((p) => p.id === 'patch-uebergross')
  );

  // ── N1 "nicht aussperren" (b): PATCH auf placements blockiert nicht an einer bereits VORHANDENEN Korruption ──
  // Roh geschrieben: eine STRUKTURELL kaputte Zeile (ry=99, außerhalb 0…63) neben einer gültigen Zone — ein POST
  // dieses Inhalts würde 422 geben; ein PATCH, das heightDeltas gar nicht anfasst, darf daran nicht scheitern.
  const korruptesHoehe = [{ zx: 9, zz: 9, r: ['99|0|1', '0|1|2'] }];
  writeFileSync(`${WELT_DATEI}.tmp`, JSON.stringify(dokument({ heightDeltas: korruptesHoehe, placements: [] })));
  renameSync(`${WELT_DATEI}.tmp`, WELT_DATEI);
  await warteAufDatei((roh) => Array.isArray(roh.heightDeltas) && roh.heightDeltas.length === 1);
  const patchKorrupt = await patch({ id: 'patch-korrupt', prefab: 'Beech1', x: 7, z: 7 });
  check(
    'N1 nicht aussperren (b): PATCH auf placements trotz vorhandener heightDeltas-Korruption: geschrieben (200/202), nicht 422 blockiert',
    [200, 202].includes(patchKorrupt.status) && patchKorrupt.daten.ok === true,
    `${patchKorrupt.status} ${JSON.stringify(patchKorrupt.daten)}`
  );
  const nachPatchKorrupt = JSON.parse(readFileSync(WELT_DATEI, 'utf-8')) as { heightDeltas?: { zx: number; zz: number; r: string[] }[]; placements?: { id: string }[] };
  check(
    'N1 nicht aussperren (b): die neue Platzierung wurde trotzdem gesetzt',
    (nachPatchKorrupt.placements ?? []).some((p) => p.id === 'patch-korrupt')
  );
  check('A1: PATCH preserves every malformed row, not just its valid remainder',
    JSON.stringify(nachPatchKorrupt.heightDeltas) === JSON.stringify(korruptesHoehe));

  for (const [label, raw] of [
    ['rows', [{ zx: 3, zz: 3, r: ['0|1,2|30,4O', '1|5|77'] }, { zx: '0x10', zz: 4, r: ['2|3|0x10'] }]],
    ['string', 'kaputt'], ['null', null], ['points', vielePunkteWenigeZonen(100_001)],
  ] as const) {
    writeFileSync(WELT_DATEI, JSON.stringify(dokument({ heightDeltas: raw })));
    const before = JSON.stringify(raw);
    const get = await anfrage('GET', '/api/worldlayout');
    check(`A2 ${label}: GET rejects bad height without exposing a partial layout`, label === 'null' ? get.status === 200 :
      get.status === 422 && !get.daten.layout && !!get.daten.heightProblem && /Git/.test(get.daten.message ?? ''));
    const result = await patch({ id: `raw-${label}`, prefab: 'Beech1', x: 8, z: 8 });
    check(`A1 ${label}: strict GET does not block PATCH`, [200, 202].includes(result.status));
    check(`A1 ${label}: raw JSON value unchanged`, JSON.stringify(JSON.parse(readFileSync(WELT_DATEI, 'utf8')).heightDeltas) === before);
    if (label !== 'null') {
      check(`A3 ${label}: actual Live→receipt→Admin carries specific rejection`, result.status === 202 && result.daten.grund === 'verworfen' &&
        !!result.daten.heightProblem && /Git/.test(result.daten.message ?? '') && !/Tippfehler/.test(result.daten.message ?? ''), JSON.stringify(result.daten));
      for (const locale of ['de', 'en']) {
        const editorRead = await holeWeltdokument(adminFetch, locale);
        check(`A2 ${label}/${locale}: real GET rejected by Editor`, !editorRead.erreichbar && /Git/.test(editorRead.grund));
        let mcpError = '';
        try { await mcp.lade(locale); } catch (error) { mcpError = (error as Error).message; }
        check(`A2 ${label}/${locale}: real GET rejected by MCP`, /Git/.test(mcpError));
        // Replay the actual PATCH response through the Editor's response reader:
        // its public save method sends POST, which correctly cannot create bad height.
        const replay: typeof fetch = async () => new Response(JSON.stringify(result.daten), { status: result.status });
        const editor = await schreibeWeltdokument(dokument() as unknown as WorldLayout, null, replay, locale);
        const hint = mcp.wirkungsHinweis(result.status, result.daten as Record<string, unknown>, locale);
        const translated = locale === 'en' ? /height correction/i : /Höhenkorrektur/;
        check(`A3 ${label}/${locale}: actual receipt displayed by Editor and MCP`,
          editor.art === 'ok' && editor.angewendet === false && translated.test(editor.message) && translated.test(hint) && /Git/.test(hint));
      }

    }
  }

  writeFileSync(WELT_DATEI, JSON.stringify(dokument()));
  const zeroPoints = await post([...vielePunkteWenigeZonen(100_000), { zx: 100, zz: 100, r: ['0|0,1|0,-0'] }]);
  check('A4: exactly 100000 effective points plus zero points are writable', [200, 202].includes(zeroPoints.status));
  const zeroZones = await post([...vieleZonenJeEinPunkt(4096), { zx: 100, zz: 100, r: ['0|0|0'] }]);
  check('A4: 4096 effective zones plus zero-only zone are writable', [200, 202].includes(zeroZones.status));

  const both = await anfrage('POST', '/api/worldlayout', dokument({
    heightDeltas: [{ zx: 3, zz: 3, r: ['0|1,2|30,4O'] }],
    placements: [{ id: 'broken-placement', prefab: 'Beech1', x: 1, z: 1, yaw: 'broken' }],
  }), await aktuellerHash());
  check('A6: real 422 includes BOTH lists in the same response', both.status === 422 &&
    (both.daten.fehlerhaft?.length ?? 0) > 0 && (both.daten.fehlerhaftHoehe?.length ?? 0) > 0, JSON.stringify(both.daten));
  const badDocument = dokument({ heightDeltas: [{ zx: 3, zz: 3, r: ['0|1,2|30,4O'] }],
    placements: [{ id: 'broken-placement', prefab: 'Beech1', x: 1, z: 1, yaw: 'broken' }] }) as unknown as WorldLayout;
  for (const locale of ['de', 'en']) {
    const hash = await aktuellerHash();
    const editor = await schreibeWeltdokument(badDocument, hash, adminFetch, locale);
    let error = '';
    try { await mcp.schreibe(badDocument, hash, locale); } catch (e) { error = (e as Error).message; }
    check(`A6 ${locale}: real Editor/MCP POST each displays both lists`, editor.art === 'fehler' &&
      /3,3/.test(editor.message) && /broken-placement/.test(editor.message) && /3,3/.test(error) && /broken-placement/.test(error));
  }


} finally {
  console.log = orig.log;
  console.warn = orig.warn;
  const child = dienst as ChildProcess | null;
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await exited;
  }
  console.log(`ADMIN_CHILD_EXIT pid=${child?.pid} code=${child?.exitCode} signal=${child?.signalCode}`);
  try {
    server.stop();
  } catch {
    /* already stopped */
  }
  await schlafen(500);
  rmSync(ORDNER, { recursive: true, force: true });
}
console.log(`CHECKS ${checks} FAILURES ${fehler}`);
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
