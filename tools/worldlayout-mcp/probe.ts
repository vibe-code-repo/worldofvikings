/**
 * Rauchtest des WorldLayout-MCP-Servers (Review-Punkt 30: vorher nur
 * console.log ohne Assertions — ein Fehler fiel niemandem auf; B8: fährt
 * jetzt gegen eine SELBST GEBAUTE Welt statt gegen die echte Instanzdatei).
 *
 * server/data/welten/<instanz>.json ist TABU — die *_set/*_delete-Werkzeuge
 * schreiben, also bekommt der MCP-Server einen EIGENEN Betriebsdienst (den
 * einzigen Schreiber der Weltdatei, siehe server.ts): Der Test legt unter
 * /tmp eine Wurzel mit einer frischen, deterministischen Welt an, startet
 * dort admin/src/main.ts (WOV_WURZEL, freier Port, Wegwerf-Token) und zeigt
 * den MCP-Server per WOV_ADMIN_URL darauf. Das macht die Assertionen unten
 * auch unabhängig vom Inhalt von dev.json (der sich zwischen zwei Läufen
 * ändern kann). Aufräumen läuft in `finally`, also auch bei einem
 * fehlgeschlagenen Check.
 *
 * Schreibsperre: Der MCP-Server schreibt nur in die Weltdatei SEINES
 * Checkouts. Sein Checkout ist der Ordner, in dem `server.ts` liegt; die
 * Probe legt deshalb je Wurzel eine KOPIE von `server.ts` hinein
 * (`checkoutAnlegen`, mit einem Symlink auf die node_modules), statt dem Server
 * eine Wurzel per Umgebung zu geben — die liest er nicht. Der Abschnitt
 * „Schreibsperre" prüft: `weltKennung` steht im GET, ein Server in fremder
 * Wurzel schreibt nichts (Datei und Sicherungen unverändert), auch nicht mit
 * einem gesetzten WOV_WURZEL, WOV_MCP_FREMDE_WELT=1 erlaubt es, ein Symlink
 * aus dem Checkout hinaus wird verweigert (Datei und Ordner), ein Checkout
 * unter einem Symlink-Ordner bleibt erlaubt, und ein Dienst ohne Kennung wird
 * abgewiesen, ohne dass ein POST ankommt.
 *
 *   npx tsx tools/worldlayout-mcp/probe.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Eigene kleine Welt statt der echten Instanzdatei: Ein Kern-Grasland um
// den Ursprung (Land bei (0,0), offene See weit draußen) reicht für alle
// Checks unten und ist unabhängig von Mikes tatsächlichem Weltstand.
const TEST_WURZEL = mkdtempSync(resolve(tmpdir(), 'worldlayout-mcp-probe-'));
// Weitere Wurzeln für die Schreibsperre-Prüfung: ein fremder Checkout mit
// eigener Welt, einer ohne Weltdatei, zwei mit Symlink aus dem Checkout hinaus,
// ein Symlink-Elternordner auf die Testwurzel.
const FREMD_WURZEL = mkdtempSync(resolve(tmpdir(), 'worldlayout-mcp-probe-fremd-'));
const LEER_WURZEL = mkdtempSync(resolve(tmpdir(), 'worldlayout-mcp-probe-leer-'));
const SYMDATEI_WURZEL = mkdtempSync(resolve(tmpdir(), 'worldlayout-mcp-probe-symdatei-'));
const SYMORDNER_WURZEL = mkdtempSync(resolve(tmpdir(), 'worldlayout-mcp-probe-symordner-'));
const ELTERNLINK = resolve(tmpdir(), `worldlayout-mcp-probe-link-${process.pid}`);

/** Ein „Checkout": eine Kopie des Ordners tools/worldlayout-mcp an derselben Stelle relativ zur Wurzel, mit den node_modules des Repos. */
function checkoutAnlegen(wurzel: string): void {
  mkdirSync(resolve(wurzel, 'tools/worldlayout-mcp'), { recursive: true });
  // Der ganze Ordner: server.ts importiert kern.ts und werkzeuge/*.ts.
  cpSync(resolve(WURZEL, 'tools/worldlayout-mcp'), resolve(wurzel, 'tools/worldlayout-mcp'), {
    recursive: true,
    filter: (quelle) => !quelle.includes('node_modules'),
  });
  symlinkSync(resolve(WURZEL, 'node_modules'), resolve(wurzel, 'node_modules'));
  // Wie im Repo: .ts-Dateien sind ES-Module (Top-Level-await in server.ts).
  writeFileSync(resolve(wurzel, 'package.json'), '{ "type": "module" }\n');
}
const TOKEN = 'probe-token-4711';
const TOKEN_DATEI = resolve(TEST_WURZEL, 'token');
mkdirSync(resolve(TEST_WURZEL, 'server/data/welten'), { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(
  resolve(TEST_WURZEL, 'server/data/welten/dev.json'),
  JSON.stringify({
    version: 1,
    name: 'MCP-Probe',
    detailSeed: 'mcp-probe',
    continents: [],
    regions: [
      { id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 },
    ],
  })
);

/** Startet einen Betriebsdienst auf der Testwurzel; gibt Kindprozess und die URL zurück. */
function dienstStarten(): Promise<{ kind: ChildProcess; url: string }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: resolve(WURZEL, 'admin'),
      env: {
        ...process.env,
        WOV_WURZEL: TEST_WURZEL,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let puffer = '';
    const zeitgrenze = setTimeout(() => {
      kind.kill();
      scheitern(new Error(`Betriebsdienst startet nicht:\n${puffer}`));
    }, 30_000);
    kind.stdout.on('data', (s: Buffer) => {
      puffer += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(puffer);
      if (t) {
        clearTimeout(zeitgrenze);
        fertig({ kind, url: `http://127.0.0.1:${t[1]}` });
      }
    });
    kind.stderr.on('data', (s: Buffer) => {
      puffer += s.toString();
    });
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Betriebsdienst beendet mit ${code}:\n${puffer}`));
    });
  });
}

/** Räumt die Testwurzeln samt Weltdatei und Sicherungen weg. */
function aufraeumen(): void {
  rmSync(ELTERNLINK, { force: true });
  for (const w of [TEST_WURZEL, FREMD_WURZEL, LEER_WURZEL, SYMDATEI_WURZEL, SYMORDNER_WURZEL]) {
    rmSync(w, { recursive: true, force: true });
  }
}

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}
const text = (r: unknown): string =>
  ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '');
const istFehler = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

let client: Client | undefined;
let dienst: ChildProcess | undefined;
try {
  const gestartet = await dienstStarten();
  checkoutAnlegen(TEST_WURZEL);
  dienst = gestartet.kind;
  const t = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'tools/worldlayout-mcp/server.ts'],
    cwd: TEST_WURZEL,
    // env wird bei Angabe NICHT gemergt, sondern ersetzt (SDK-Doku) —
    // deshalb erst die Standardauswahl holen und die Betriebsdienst-Angaben
    // ergänzen, statt versehentlich PATH & Co. zu verlieren (npx würde sonst
    // nicht mehr gefunden).
    env: { ...getDefaultEnvironment(), WOV_ADMIN_URL: gestartet.url, WOV_ADMIN_TOKEN: TOKEN },
  });
  const c = new Client({ name: 'probe', version: '1.0.0' });
  client = c;
  await c.connect(t);

  const tools = (await c.listTools()).tools.map((x) => x.name);
  for (const erwartet of [
    'layout_get',
    'layout_pruefen',
    'region_set',
    'region_delete',
    'continent_set',
    'continent_delete',
    'river_set',
    'river_delete',
    'lake_set',
    'lake_delete',
    'route_set',
    'route_delete',
    'placement_set',
    'placement_delete',
    'defaultSpawn_set',
    'defaultSpawn_clear',
    'layout_probe',
    'layout_deploy',
  ]) {
    check(`Tool ${erwartet} vorhanden`, tools.includes(erwartet), `gefunden: ${tools.join(', ')}`);
  }

  const get = text(await c.callTool({ name: 'layout_get', arguments: {} }));
  check('layout_get liefert Zusammenfassung', /Region\(en\)/.test(get), get.slice(0, 80));

  const probe = text(
    await c.callTool({ name: 'layout_probe', arguments: { punkte: [[0, 0], [30000, 30000]] } })
  );
  check('layout_probe: Startpunkt ist Land', /\(0, 0\): Höhe \d/.test(probe), probe.split('\n')[0]);
  check('layout_probe: weit draußen ist offene See', /offene See/.test(probe), probe.split('\n')[1] ?? '');

  // Prüf-Werkzeuge (world_check, world_diff, area_describe): nur lesen.
  for (const erwartet of ['world_check', 'world_diff', 'area_describe']) {
    check(`Tool ${erwartet} vorhanden`, tools.includes(erwartet), `gefunden: ${tools.join(', ')}`);
  }
  const wc = await c.callTool({ name: 'world_check', arguments: { bereich: { x: 0, z: 0, radius: 50 } } });
  check('world_check: leere Welt ist grün, mit Zeit und Zähler', !istFehler(wc) && /^world_check: GRÜN \(0 rot, 0 gelb\) in \d+ ms, 0 Objekte/.test(text(wc)), text(wc).slice(0, 120));
  const wcGross = await c.callTool({ name: 'world_check', arguments: { bereich: { x: 0, z: 0, radius: 600 } } });
  check('world_check: zu großer Bereich wird abgelehnt', istFehler(wcGross) && /zu groß/.test(text(wcGross)), text(wcGross));
  const ad = await c.callTool({ name: 'area_describe', arguments: { x: 0, z: 0, radius: 20 } });
  check('area_describe: Höhe und Region der Testwelt', !istFehler(ad) && /Höhe -?\d/.test(text(ad)) && /Region kern/.test(text(ad)), text(ad).slice(0, 160));
  const adGross = await c.callTool({ name: 'area_describe', arguments: { x: 0, z: 0, radius: 257 } });
  check('area_describe: Radius 257 wird abgelehnt', istFehler(adGross), text(adGross));
  const wd0 = await c.callTool({ name: 'world_diff', arguments: {} });
  check('world_diff: nach dem Lesen noch keine Änderung', !istFehler(wd0) && /Keine Änderungen/.test(text(wd0)), text(wd0).slice(0, 120));

  // Ohne Startpunkt meldet layout_pruefen genau das — dieselbe Prüfung wie
  // im Editor seit B1, hier zum ersten Mal über MCP erreichbar.
  const befundeVorSpawn = text(await c.callTool({ name: 'layout_pruefen', arguments: {} }));
  check('layout_pruefen meldet fehlenden Startpunkt', /Kein Startpunkt gesetzt/.test(befundeVorSpawn));

  // region_set muss UNBRAUCHBARE Regionen ablehnen und das Dokument dabei
  // unangetastet lassen. Bewusst ein unbekanntes Biom statt eines krummen
  // Radius: Zahlen KLEMMT sanitize absichtlich (radius -5 → 8 m), nur
  // strukturell Falsches wird verworfen.
  const vorher = text(await c.callTool({ name: 'layout_get', arguments: {} }));
  const kaputt = await c
    .callTool({
      name: 'region_set',
      arguments: {
        region: { id: 'probe-kaputt', biome: 'lava' as never, shape: { kind: 'circle', x: 0, z: 0, radius: 500 } },
      },
    })
    .catch(() => ({ isError: true }));
  check('region_set lehnt unbekanntes Biom ab', istFehler(kaputt));
  const nachher = text(await c.callTool({ name: 'layout_get', arguments: {} }));
  check('Dokument nach Ablehnung unverändert', vorher === nachher);

  // Der alte Biomname 'meadows' darf am MCP-Werkzeug NICHT mehr ankommen —
  // sanitizeWorldLayout migriert ihn zwar beim LESEN alter Dokumente, aber
  // wer heute über MCP baut, soll den heutigen Namen sehen und sonst
  // nichts (siehe BIOME_NAMEN-Herleitung im Kopfkommentar von server.ts).
  const altesBiom = await c
    .callTool({
      name: 'region_set',
      arguments: {
        region: { id: 'probe-alt', biome: 'meadows' as never, shape: { kind: 'circle', x: 5000, z: 5000, radius: 500 } },
      },
    })
    .catch(() => ({ isError: true }));
  check('region_set lehnt alten Biomnamen "meadows" ab', istFehler(altesBiom));

  // Die seit B8 nachgezogenen Regionsfelder (Progressionsstufe, die vier
  // Bewuchsregler) müssen ankommen UND im Dokument landen.
  const mitReglern = text(
    await c.callTool({
      name: 'region_set',
      arguments: {
        region: {
          id: 'regler',
          biome: 'blackforest',
          shape: { kind: 'circle', x: -5000, z: -5000, radius: 500 },
          tier: 3,
          bewuchsDichte: 2,
          waldKoernung: 0.5,
          abstandFaktor: 0.6,
          nester: 0.4,
          nesterKoernung: 1.5,
        },
      },
    })
  );
  check('region_set (regler) gespeichert', /^Gespeichert\./.test(mitReglern), mitReglern.slice(0, 80));
  // Die Zusammenfassung nennt die Regler bereits (zusammenfassung() oben),
  // aber ob sie WIRKLICH im Dokument landen, zeigt erst das rohe JSON.
  const dokumentMitRegler = text(await c.callTool({ name: 'layout_get', arguments: {} }));
  check(
    'region_set übernimmt tier/bewuchsDichte/waldKoernung/abstandFaktor/nester',
    /"tier":3/.test(dokumentMitRegler) &&
      /"bewuchsDichte":2/.test(dokumentMitRegler) &&
      /"waldKoernung":0\.5/.test(dokumentMitRegler) &&
      /"abstandFaktor":0\.6/.test(dokumentMitRegler) &&
      /"nester":0\.4/.test(dokumentMitRegler),
    dokumentMitRegler.slice(0, 400)
  );
  await c.callTool({ name: 'region_delete', arguments: { id: 'regler' } });

  // ── Kontinente ──────────────────────────────────────────────────────
  const mitKontinent = text(
    await c.callTool({
      name: 'continent_set',
      arguments: { kontinent: { id: 'wik', name: 'Wikingerland', faction: 'viking', spawn: [10, 10] } },
    })
  );
  check('continent_set: 1 Kontinent in der Zusammenfassung', /1 Kontinent\(e\)/.test(mitKontinent));
  const ohneKontinent = text(await c.callTool({ name: 'continent_delete', arguments: { id: 'wik' } }));
  check('continent_delete: wieder 0 Kontinente', /0 Kontinent\(e\)/.test(ohneKontinent));

  // ── Flüsse ──────────────────────────────────────────────────────────
  const mitFluss = text(
    await c.callTool({
      name: 'river_set',
      arguments: { fluss: { id: 'bach', points: [[0, 100], [0, 200]], width: 20 } },
    })
  );
  check('river_set: 1 Fluss/Flüsse in der Zusammenfassung', /1 Fluss\/Flüsse/.test(mitFluss));
  const riverWeg = await c.callTool({ name: 'river_delete', arguments: { id: 'bach' } });
  check('river_delete: kein isError', !istFehler(riverWeg));

  // ── Seen ────────────────────────────────────────────────────────────
  const mitSee = text(
    await c.callTool({ name: 'lake_set', arguments: { see: { id: 'teich', x: 300, z: 300, radius: 100 } } })
  );
  check('lake_set: 1 See in der Zusammenfassung', /1 See\(n\)/.test(mitSee));
  const seeWeg = await c.callTool({ name: 'lake_delete', arguments: { id: 'teich' } });
  check('lake_delete: kein isError', !istFehler(seeWeg));

  // ── Routen + Platzierung mit Routenverweis ─────────────────────────
  const mitRoute = text(
    await c.callTool({
      name: 'route_set',
      arguments: { route: { id: 'runde', points: [[0, 0], [10, 0], [10, 10]], mode: 'loop' } },
    })
  );
  check('route_set: 1 Route in der Zusammenfassung', /1 Route\(n\)/.test(mitRoute));

  // ── Platzierungen: seit E1 über eine stabile `id` adressiert (Prefab + gerundete
  // Position war die alte Kennung und teilten sich mehrere Objekte im selben Meter).
  const mitPlatzierung = text(
    await c.callTool({
      name: 'placement_set',
      arguments: { platzierung: { prefab: 'Beech1', x: 12, z: 34, route: 'runde' } },
    })
  );
  check('placement_set: 1 Platzierung in der Zusammenfassung', /1 Platzierung\(en\)/.test(mitPlatzierung));
  const wd1 = await c.callTool({ name: 'world_diff', arguments: {} });
  check('world_diff: nach placement_set zählt +1 Objekt (Sitzungsbasis)', !istFehler(wd1) && /\+1 Objekt\b/.test(text(wd1)), text(wd1).slice(0, 160));
  // Eine NEUE Platzierung bekommt seit K1.3 (A-10) die abgeleitete id PLUS einen Zufallsschwanz mit Buchstabe, damit
  // "gelöscht und gleichartig neu gesetzt" nie dieselbe id ergibt (der Spielserver hielte es für dasselbe Objekt).
  const NEUE_ID = /id (beech1_12_34-[a-z][0-9a-z]{3}), neu angelegt/;
  const idA = NEUE_ID.exec(mitPlatzierung)?.[1] ?? '';
  check('placement_set: ohne id wird eine neue vergeben (abgeleitet + Zufallsschwanz mit Buchstabe)', idA !== '', mitPlatzierung);
  const platzierungenLesen = async (): Promise<{ id: string; x: number; yaw?: number }[]> => {
    const t = text(await c.callTool({ name: 'layout_get', arguments: {} }));
    return (JSON.parse(t.slice(t.indexOf('\n\n') + 2)) as { placements?: { id: string; x: number; yaw?: number }[] }).placements ?? [];
  };
  // Zweite Platzierung im selben Meter: eigene id, die erste bleibt unberührt.
  const zweite = text(
    await c.callTool({ name: 'placement_set', arguments: { platzierung: { prefab: 'Beech1', x: 12.3, z: 34 } } })
  );
  const idB = NEUE_ID.exec(zweite)?.[1] ?? '';
  check('placement_set: gleicher Meter → eigene id, nichts ersetzt', idB !== '' && idB !== idA && /2 Platzierung\(en\)/.test(zweite), zweite);
  // Mit id: genau diese Platzierung wird ersetzt (verschieben, drehen), die id bleibt.
  const ersetzt = text(
    await c.callTool({
      name: 'placement_set',
      arguments: { platzierung: { id: idB, prefab: 'Beech1', x: 14, z: 34, yaw: 1 } },
    })
  );
  check('placement_set: mit id ersetzt genau diese Platzierung', ersetzt.includes(`id ${idB}, ersetzt`) && /2 Platzierung\(en\)/.test(ersetzt), ersetzt);
  const nachErsetzen = await platzierungenLesen();
  const erste = nachErsetzen.find((p) => p.id === idA);
  const zweiteNach = nachErsetzen.find((p) => p.id === idB);
  check(
    'placement_set: die andere Platzierung blieb, die ersetzte wanderte mit gleicher id',
    erste?.x === 12 && zweiteNach?.x === 14 && zweiteNach.yaw === 1,
    JSON.stringify(nachErsetzen)
  );
  check(
    'placement_set: Liste nach id sortiert',
    nachErsetzen.map((p) => p.id).join(',') === [...nachErsetzen.map((p) => p.id)].sort().join(',')
  );
  const ungueltigeId = await c.callTool({
    name: 'placement_set',
    arguments: { platzierung: { id: 'Ungültig Ü', prefab: 'Beech1', x: 1, z: 1 } },
  });
  check('placement_set: ungültige id wird abgelehnt', istFehler(ungueltigeId), text(ungueltigeId));
  // Veralteter Rückfall: die alte Kennung, mit Hinweis.
  const perKennung = text(
    await c.callTool({
      name: 'placement_set',
      arguments: { platzierung: { prefab: 'Beech1', x: 15, z: 34 }, ersetzeKennung: 'Beech1@14,34' },
    })
  );
  check('placement_set: alte Kennung löst auf die id auf (mit Hinweis)', perKennung.includes(`id ${idB}, ersetzt`) && /veraltet/.test(perKennung), perKennung);
  // Eine dritte im ersten Meter: Prefab@12,34 ist jetzt mehrdeutig.
  const dritte = text(await c.callTool({ name: 'placement_set', arguments: { platzierung: { prefab: 'Beech1', x: 12.4, z: 34 } } }));
  const idC = NEUE_ID.exec(dritte)?.[1] ?? '';

  const geprueft = text(await c.callTool({ name: 'layout_pruefen', arguments: {} }));
  check(
    'layout_pruefen: Route bekannt, keine unbekannte-Route-Meldung für Beech1',
    !/unbekannte Route.*Beech1/.test(geprueft),
    geprueft
  );

  const routeWeg = await c.callTool({ name: 'route_delete', arguments: { id: 'runde' } });
  check('route_delete: kein isError', !istFehler(routeWeg));
  const geprueftNachRouteWeg = text(await c.callTool({ name: 'layout_pruefen', arguments: {} }));
  check(
    'layout_pruefen: verwaiste Routenreferenz wird gemeldet',
    /unbekannte Route: runde/.test(geprueftNachRouteWeg),
    geprueftNachRouteWeg
  );

  const mehrdeutig = await c.callTool({ name: 'placement_delete', arguments: { prefab: 'Beech1', x: 12, z: 34 } });
  check(
    'placement_delete: mehrdeutige alte Kennung wird abgelehnt und nennt die ids',
    istFehler(mehrdeutig) && text(mehrdeutig).includes(idA) && text(mehrdeutig).includes(idC),
    text(mehrdeutig)
  );
  check('placement_delete: nach der Ablehnung nichts gelöscht', (await platzierungenLesen()).length === 3);
  const perId = await c.callTool({ name: 'placement_delete', arguments: { id: idA } });
  check('placement_delete: per id gelöscht, kein isError', !istFehler(perId), text(perId));
  const nachPerId = await platzierungenLesen();
  check('placement_delete: genau die eine Platzierung ist weg', nachPerId.length === 2 && !nachPerId.some((p) => p.id === idA), JSON.stringify(nachPerId));
  // A-10: das Objekt ist gelöscht, ein gleichartiges am selben Ort ist ein NEUES: andere id (nie die gelöschte).
  const nachLoeschen = text(await c.callTool({ name: 'placement_set', arguments: { platzierung: { prefab: 'Beech1', x: 12, z: 34 } } }));
  const idD = NEUE_ID.exec(nachLoeschen)?.[1] ?? '';
  check('placement_delete + placement_set gleichartig am selben Ort: NEUE id mit Zusatz, nicht die gelöschte', idD !== '' && idD !== idA && idD !== idC, nachLoeschen);
  await c.callTool({ name: 'placement_delete', arguments: { id: idD } });
  const perKennungWeg = text(await c.callTool({ name: 'placement_delete', arguments: { prefab: 'Beech1', x: 12.4, z: 34 } }));
  check('placement_delete: eindeutige alte Kennung löscht mit Hinweis', /veraltet/.test(perKennungWeg) && perKennungWeg.includes(idC), perKennungWeg);
  const unbekannteId = await c.callTool({ name: 'placement_delete', arguments: { id: 'gibt-es-nicht' } });
  check('placement_delete: unbekannte id ist ein Fehler', istFehler(unbekannteId), text(unbekannteId));
  const ohneAngabe = await c.callTool({ name: 'placement_delete', arguments: {} });
  check('placement_delete: ohne id und ohne Position ist ein Fehler', istFehler(ohneAngabe), text(ohneAngabe));
  const letzteWeg = await c.callTool({ name: 'placement_delete', arguments: { id: idB } });
  check('placement_delete: letzte per id, kein isError', !istFehler(letzteWeg), text(letzteWeg));
  const nachPlatzierungWeg = text(await c.callTool({ name: 'layout_get', arguments: {} }));
  check('placement_delete: keine Platzierung mehr in der Zusammenfassung', !/Platzierung\(en\)/.test(nachPlatzierungWeg));

  // ── Startpunkt setzen/löschen — layout_pruefen muss beidem folgen ─────
  const mitSpawn = text(await c.callTool({ name: 'defaultSpawn_set', arguments: { x: 42, z: 42 } }));
  check('defaultSpawn_set: Spawn in der Zusammenfassung', /Spawn @\(42, 42\)/.test(mitSpawn));
  const befundeMitSpawn = text(await c.callTool({ name: 'layout_pruefen', arguments: {} }));
  check('layout_pruefen: kein Startpunkt-Befund mehr', !/Kein Startpunkt gesetzt/.test(befundeMitSpawn));
  const ohneSpawn = text(await c.callTool({ name: 'defaultSpawn_clear', arguments: {} }));
  check('defaultSpawn_clear: kein Spawn mehr in der Zusammenfassung', !/Spawn @/.test(ohneSpawn));

  // ── layout_deploy MUSS sich weigern, solange WOV_ADMIN_URL gesetzt
  // ist — sonst würde ein "Erfolg" hier den echten wov-Server unverändert
  // neu starten und die Testdaten wären niemals sichtbar gewesen.
  const deployVersuch = await c.callTool({ name: 'layout_deploy', arguments: {} });
  check('layout_deploy verweigert sich unter WOV_ADMIN_URL', istFehler(deployVersuch), text(deployVersuch));

  // ── Schreibsperre: nur in die Weltdatei des eigenen Checkouts ──────────
  const weltDateiPfad = resolve(TEST_WURZEL, 'server/data/welten/dev.json');
  const sicherungen = (): string => readdirSync(resolve(TEST_WURZEL, 'server/data/welten')).sort().join(',');
  const pruefsumme = (): string => createHash('sha256').update(readFileSync(weltDateiPfad)).digest('hex');
  const dienstGet = async (url: string): Promise<{ text: string; json: Record<string, unknown> }> => {
    const r = await fetch(`${url}/api/worldlayout`, { headers: { 'x-wov-token': TOKEN } });
    const t = await r.text();
    return { text: t, json: JSON.parse(t) as Record<string, unknown> };
  };
  /** Startet den MCP-Server, den die Kopie in `wurzel` darstellt (deren Checkout er ist). */
  const mcpStarten = async (
    wurzel: string,
    extra: Record<string, string> = {},
    url = gestartet.url,
    cwd = wurzel
  ): Promise<Client> => {
    const tr = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'tools/worldlayout-mcp/server.ts'],
      cwd,
      env: { ...getDefaultEnvironment(), WOV_ADMIN_URL: url, WOV_ADMIN_TOKEN: TOKEN, ...extra },
    });
    const k = new Client({ name: 'probe-sperre', version: '1.0.0' });
    await k.connect(tr);
    return k;
  };
  const platzierung = { platzierung: { prefab: 'Beech1', x: 7, z: 8 } };
  const weltMitName = (name: string): string =>
    JSON.stringify({ version: 1, name, detailSeed: 'x', continents: [], regions: [] });

  // (1) Der GET nennt die Weltkennung, aber keinen Pfad.
  const antwort = await dienstGet(gestartet.url);
  const erwarteteKennung = createHash('sha256').update(realpathSync(weltDateiPfad)).digest('hex');
  check('GET /api/worldlayout enthält weltKennung (64 Hex)', /^[0-9a-f]{64}$/.test(String(antwort.json.weltKennung)), String(antwort.json.weltKennung));
  check('weltKennung = sha256(realpath der Weltdatei)', antwort.json.weltKennung === erwarteteKennung);
  check('GET verrät keinen Pfad der Wurzel', !antwort.text.includes(TEST_WURZEL));
  // Der Aufruf von realpathSync im GET steht in einem try: ein Wurf dort wäre sonst ein 500 statt
  // einer Antwort ohne Kennung (die Datei kann zwischen existsSync und realpathSync verschwinden).
  const adminQuelle = readFileSync(resolve(WURZEL, 'admin/src/main.ts'), 'utf-8');
  check(
    'GET: realpathSync(LAYOUT_DATEI) steht in einem try (kein 500 bei verschwundener Datei)',
    /try\s*\{\s*weltKennung\s*=[^;]*realpathSync\(LAYOUT_DATEI\)[^;]*;\s*\}\s*catch/.test(adminQuelle)
  );

  // (2) Eigener Checkout = verwaltete Welt: der lange Lauf oben hat geschrieben (alle *_set ok).

  // (3) Fremder Checkout: Lesen ja, Schreiben nein — Datei und Sicherungen unverändert.
  checkoutAnlegen(FREMD_WURZEL);
  mkdirSync(resolve(FREMD_WURZEL, 'server/data/welten'), { recursive: true });
  writeFileSync(resolve(FREMD_WURZEL, 'server/data/welten/dev.json'), weltMitName('Fremd'));
  const fremd = await mcpStarten(FREMD_WURZEL);
  try {
    const sumVorher = pruefsumme();
    const dateienVorher = sicherungen();
    const lesen = await fremd.callTool({ name: 'layout_get', arguments: {} });
    check('fremder Checkout: layout_get (Lesen) bleibt erlaubt', !istFehler(lesen) && /Region\(en\)/.test(text(lesen)), text(lesen).slice(0, 80));
    for (const [name, argumente] of [
      ['placement_set', platzierung],
      ['defaultSpawn_set', { x: 1, z: 1 }],
      ['region_set', { region: { id: 'fremd', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 300 } } }],
    ] as const) {
      const r = await fremd.callTool({ name, arguments: argumente as Record<string, unknown> });
      check(`fremder Checkout: ${name} wird verweigert`, istFehler(r), text(r).slice(0, 100));
      check(
        `fremder Checkout: ${name}: Meldung nennt Adresse, eigenen Pfad und WOV_MCP_FREMDE_WELT`,
        text(r).includes(gestartet.url) &&
          text(r).includes(resolve(FREMD_WURZEL, 'server/data/welten/dev.json')) &&
          /verwaltet nicht die Weltdatei dieses Checkouts/.test(text(r)) &&
          /WOV_MCP_FREMDE_WELT=1/.test(text(r)),
        text(r)
      );
    }
    check('fremder Checkout: Weltdatei unverändert (Prüfsumme)', pruefsumme() === sumVorher);
    check('fremder Checkout: keine neue Sicherung', sicherungen() === dateienVorher, `${dateienVorher} -> ${sicherungen()}`);
  } finally {
    await fremd.close();
  }

  // (3b) Ein gesetztes WOV_WURZEL hebelt die Sperre nicht aus: der fremde Checkout bekommt die
  // Wurzel des Dienstes per Umgebung und schreibt trotzdem nicht; der eigene ignoriert eine
  // abweichende. Ohne WOV_MCP_FREMDE_WELT=1 gilt die Umgebungsvariable nirgends.
  const umgebung = await mcpStarten(FREMD_WURZEL, { WOV_WURZEL: TEST_WURZEL });
  try {
    const sumVorher = pruefsumme();
    const r = await umgebung.callTool({ name: 'placement_set', arguments: platzierung });
    check('WOV_WURZEL=<Wurzel des Dienstes> im fremden Checkout: Schreiben verweigert', istFehler(r) && /verwaltet nicht/.test(text(r)), text(r));
    check('WOV_WURZEL=<Wurzel des Dienstes>: Weltdatei unverändert', pruefsumme() === sumVorher);
  } finally {
    await umgebung.close();
  }
  const eigenMitEnv = await mcpStarten(TEST_WURZEL, { WOV_WURZEL: FREMD_WURZEL });
  try {
    const r = await eigenMitEnv.callTool({ name: 'placement_set', arguments: platzierung });
    check('WOV_WURZEL=<fremde Wurzel> im eigenen Checkout wird ignoriert: schreibt in die eigene Welt', !istFehler(r), text(r));
    const weg = await eigenMitEnv.callTool({ name: 'placement_delete', arguments: { prefab: 'Beech1', x: 7, z: 8 } });
    check('WOV_WURZEL ignoriert: placement_delete räumt auf', !istFehler(weg), text(weg));
  } finally {
    await eigenMitEnv.close();
  }

  // (3c) Ein Checkout ohne eigene Weltdatei: auch nichts, mit deutlicher Begründung.
  checkoutAnlegen(LEER_WURZEL);
  const ohneDatei = await mcpStarten(LEER_WURZEL);
  try {
    const r = await ohneDatei.callTool({ name: 'placement_set', arguments: platzierung });
    check('Checkout ohne Weltdatei: Schreiben verweigert, sagt warum', istFehler(r) && /existiert nicht/.test(text(r)), text(r));
  } finally {
    await ohneDatei.close();
  }

  // (3d) Symlink aus dem Checkout hinaus: Die eigene Weltdatei ist nur ein Verweis auf die vom
  // Dienst verwaltete. Die Kennungen wären gleich; die Sperre muss trotzdem greifen.
  checkoutAnlegen(SYMDATEI_WURZEL);
  mkdirSync(resolve(SYMDATEI_WURZEL, 'server/data/welten'), { recursive: true });
  symlinkSync(weltDateiPfad, resolve(SYMDATEI_WURZEL, 'server/data/welten/dev.json'));
  checkoutAnlegen(SYMORDNER_WURZEL);
  mkdirSync(resolve(SYMORDNER_WURZEL, 'server/data'), { recursive: true });
  symlinkSync(resolve(TEST_WURZEL, 'server/data/welten'), resolve(SYMORDNER_WURZEL, 'server/data/welten'));
  for (const [was, wurzel] of [
    ['Weltdatei ist ein Symlink aus dem Checkout hinaus', SYMDATEI_WURZEL],
    ['Ordner welten/ ist ein Symlink aus dem Checkout hinaus', SYMORDNER_WURZEL],
  ] as const) {
    const sym = await mcpStarten(wurzel);
    try {
      const sumVorher = pruefsumme();
      const dateienVorher = sicherungen();
      const lesen = await sym.callTool({ name: 'layout_get', arguments: {} });
      check(`${was}: layout_get (Lesen) bleibt erlaubt`, !istFehler(lesen), text(lesen).slice(0, 80));
      const r = await sym.callTool({ name: 'placement_set', arguments: platzierung });
      check(`${was}: Schreiben verweigert, Meldung nennt den Symlink`, istFehler(r) && /Symlink/.test(text(r)), text(r));
      check(`${was}: Weltdatei und Sicherungen unverändert`, pruefsumme() === sumVorher && sicherungen() === dateienVorher);
    } finally {
      await sym.close();
    }
  }
  // Ein Checkout UNTER einem Symlink-Ordner (wie /opt/wov-worktrees, wenn es ein Link wäre) bleibt erlaubt.
  symlinkSync(TEST_WURZEL, ELTERNLINK);
  const ueberLink = await mcpStarten(TEST_WURZEL, {}, gestartet.url, ELTERNLINK);
  try {
    const r = await ueberLink.callTool({ name: 'placement_set', arguments: platzierung });
    check('Checkout unter einem Symlink-Ordner: Schreiben erlaubt', !istFehler(r), text(r));
    const weg = await ueberLink.callTool({ name: 'placement_delete', arguments: { prefab: 'Beech1', x: 7, z: 8 } });
    check('Checkout unter einem Symlink-Ordner: placement_delete räumt auf', !istFehler(weg), text(weg));
  } finally {
    await ueberLink.close();
  }

  // (4) Bewusst fremde Welt: WOV_MCP_FREMDE_WELT=1 erlaubt es.
  const bewusst = await mcpStarten(FREMD_WURZEL, { WOV_MCP_FREMDE_WELT: '1' });
  try {
    const sumVorher = pruefsumme();
    const r = await bewusst.callTool({ name: 'placement_set', arguments: platzierung });
    check('WOV_MCP_FREMDE_WELT=1: placement_set schreibt', !istFehler(r) && /id beech1_7_8-[a-z][0-9a-z]{3}/.test(text(r)), text(r));
    check('WOV_MCP_FREMDE_WELT=1: Weltdatei hat sich geändert', pruefsumme() !== sumVorher);
    const weg = await bewusst.callTool({ name: 'placement_delete', arguments: { prefab: 'Beech1', x: 7, z: 8 } });
    check('WOV_MCP_FREMDE_WELT=1: placement_delete räumt auf', !istFehler(weg), text(weg));
  } finally {
    await bewusst.close();
  }

  // (5) Ein Dienst ohne weltKennung (älterer Stand) wird abgewiesen, und es kommt kein POST an.
  const angekommen: string[] = [];
  const altDienst = createServer((req, res) => {
    angekommen.push(req.method ?? '?');
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') {
      const { weltKennung: _weg, ...ohneKennung } = antwort.json;
      void _weg;
      res.end(JSON.stringify(ohneKennung));
    } else {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    }
  });
  await new Promise<void>((fertig) => altDienst.listen(0, '127.0.0.1', fertig));
  const altPort = (altDienst.address() as { port: number }).port;
  const alt = await mcpStarten(TEST_WURZEL, {}, `http://127.0.0.1:${altPort}`);
  try {
    const r = await alt.callTool({ name: 'placement_set', arguments: platzierung });
    check('Dienst ohne weltKennung: Schreiben verweigert', istFehler(r) && /keine weltKennung/.test(text(r)), text(r));
    check('Dienst ohne weltKennung: es kam kein POST an', angekommen.length > 0 && angekommen.every((m) => m === 'GET'), angekommen.join(','));
  } finally {
    await alt.close();
    altDienst.close();
  }
} finally {
  await client?.close();
  dienst?.removeAllListeners('exit');
  dienst?.kill();
  aufraeumen();
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== MCP-PROBE: ALL PASSED ===');
