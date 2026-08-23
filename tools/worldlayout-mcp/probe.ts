/**
 * Rauchtest des WorldLayout-MCP-Servers (Review-Punkt 30: vorher nur
 * console.log ohne Assertions — ein Fehler fiel niemandem auf; B8: fährt
 * jetzt gegen eine SELBST GEBAUTE Welt statt gegen die echte Instanzdatei).
 *
 * server/data/welten/<instanz>.json ist TABU — die *_set/*_delete-Werkzeuge
 * schreiben, also bekommt der Server-Unterprozess über WOV_LAYOUT_PFAD eine
 * frische, deterministische Welt unter /tmp. Das macht die Assertionen
 * unten auch unabhängig vom Inhalt von dev.json (der sich zwischen zwei
 * Läufen ändern kann, siehe Kopfkommentar von server.ts). Aufräumen läuft
 * in `finally`, also auch bei einem fehlgeschlagenen Check.
 *
 *   npx tsx tools/worldlayout-mcp/probe.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Eigene kleine Welt statt der echten Instanzdatei: Ein Kern-Grasland um
// den Ursprung (Land bei (0,0), offene See weit draußen) reicht für alle
// Checks unten und ist unabhängig von Mikes tatsächlichem Weltstand.
const LAYOUT_PFAD = resolve(tmpdir(), `worldlayout-mcp-probe-${process.pid}.json`);
writeFileSync(
  LAYOUT_PFAD,
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

/** Räumt die Testdatei UND die Sicherungen weg, die layoutSchreiben dort anlegt. */
function aufraeumen(): void {
  const ordner = dirname(LAYOUT_PFAD);
  const name = basename(LAYOUT_PFAD);
  for (const f of readdirSync(ordner)) {
    if (f === name || (f.startsWith(`${name}.`) && f.endsWith('.bak'))) {
      rmSync(resolve(ordner, f), { force: true });
    }
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
try {
  const t = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'tools/worldlayout-mcp/server.ts'],
    cwd: WURZEL,
    // env wird bei Angabe NICHT gemergt, sondern ersetzt (SDK-Doku) —
    // deshalb erst die Standardauswahl holen und WOV_LAYOUT_PFAD ergänzen,
    // statt versehentlich PATH & Co. zu verlieren (npx würde sonst nicht
    // mehr gefunden).
    env: { ...getDefaultEnvironment(), WOV_LAYOUT_PFAD: LAYOUT_PFAD },
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

  // ── Platzierungen: Upsert/Delete über layoutKennung (Prefab + gerundete
  // Position) — dieselbe Kennung wie beim ZDO-Member im Spiel.
  const mitPlatzierung = text(
    await c.callTool({
      name: 'placement_set',
      arguments: { platzierung: { prefab: 'Beech1', x: 12, z: 34, route: 'runde' } },
    })
  );
  check('placement_set: 1 Platzierung in der Zusammenfassung', /1 Platzierung\(en\)/.test(mitPlatzierung));
  check('placement_set: Kennung im Text', /Beech1@12,34/.test(mitPlatzierung));

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

  const platzierungWeg = await c.callTool({
    name: 'placement_delete',
    arguments: { prefab: 'Beech1', x: 12, z: 34 },
  });
  check('placement_delete: kein isError', !istFehler(platzierungWeg));
  const nachPlatzierungWeg = text(await c.callTool({ name: 'layout_get', arguments: {} }));
  check('placement_delete: keine Platzierung mehr in der Zusammenfassung', !/Platzierung\(en\)/.test(nachPlatzierungWeg));

  // ── Startpunkt setzen/löschen — layout_pruefen muss beidem folgen ─────
  const mitSpawn = text(await c.callTool({ name: 'defaultSpawn_set', arguments: { x: 42, z: 42 } }));
  check('defaultSpawn_set: Spawn in der Zusammenfassung', /Spawn @\(42, 42\)/.test(mitSpawn));
  const befundeMitSpawn = text(await c.callTool({ name: 'layout_pruefen', arguments: {} }));
  check('layout_pruefen: kein Startpunkt-Befund mehr', !/Kein Startpunkt gesetzt/.test(befundeMitSpawn));
  const ohneSpawn = text(await c.callTool({ name: 'defaultSpawn_clear', arguments: {} }));
  check('defaultSpawn_clear: kein Spawn mehr in der Zusammenfassung', !/Spawn @/.test(ohneSpawn));

  // ── layout_deploy MUSS sich weigern, solange WOV_LAYOUT_PFAD gesetzt
  // ist — sonst würde ein "Erfolg" hier den echten wov-Server unverändert
  // neu starten und die Testdaten wären niemals sichtbar gewesen.
  const deployVersuch = await c.callTool({ name: 'layout_deploy', arguments: {} });
  check('layout_deploy verweigert sich unter WOV_LAYOUT_PFAD', istFehler(deployVersuch), text(deployVersuch));
} finally {
  await client?.close();
  aufraeumen();
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== MCP-PROBE: ALL PASSED ===');
