/**
 * Rauchtest des WorldLayout-MCP-Servers (Review-Punkt 30: vorher nur
 * console.log ohne Assertions — ein Fehler fiel niemandem auf).
 *
 *   npx tsx tools/worldlayout-mcp/probe.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

const t = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'tools/worldlayout-mcp/server.ts'],
  cwd: WURZEL,
});
const c = new Client({ name: 'probe', version: '1.0.0' });
await c.connect(t);

const tools = (await c.listTools()).tools.map((x) => x.name);
for (const erwartet of ['layout_get', 'region_set', 'region_delete', 'layout_probe', 'layout_deploy']) {
  check(`Tool ${erwartet} vorhanden`, tools.includes(erwartet), `gefunden: ${tools.join(', ')}`);
}

const get = text(await c.callTool({ name: 'layout_get', arguments: {} }));
check('layout_get liefert Zusammenfassung', /Region\(en\)/.test(get), get.slice(0, 80));

const probe = text(
  await c.callTool({ name: 'layout_probe', arguments: { punkte: [[0, 0], [30000, 30000]] } })
);
check('layout_probe: Startpunkt ist Land', /\(0, 0\): Höhe \d/.test(probe), probe.split('\n')[0]);
check('layout_probe: weit draußen ist offene See', /offene See/.test(probe), probe.split('\n')[1] ?? '');

// region_set muss UNBRAUCHBARE Regionen ablehnen und das Dokument dabei
// unangetastet lassen. Bewusst ein unbekanntes Biom statt eines krummen
// Radius: Zahlen KLEMMT sanitize absichtlich (radius -5 → 8 m), nur
// strukturell Falsches wird verworfen.
const vorher = text(await c.callTool({ name: 'layout_get', arguments: {} }));
const kaputt = await c.callTool({
  name: 'region_set',
  arguments: {
    region: { id: 'probe-kaputt', biome: 'lava' as never, shape: { kind: 'circle', x: 0, z: 0, radius: 500 } },
  },
}).catch(() => ({ isError: true }));
check('region_set lehnt unbekanntes Biom ab', (kaputt as { isError?: boolean }).isError === true);
const nachher = text(await c.callTool({ name: 'layout_get', arguments: {} }));
check('Dokument nach Ablehnung unverändert', vorher === nachher);

await c.close();

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== MCP-PROBE: ALL PASSED ===');
