/**
 * The editor announces its protocol version when it loads the world document, and shows the 426 refusal
 * (reload message) as its load error. The same path an editor from before the header takes for any refusal.
 * Der Editor nennt beim Laden des Weltdokuments seine Protokollversion und zeigt die 426-Abweisung als Ladefehler.
 *
 *   npx tsx client/test/editor-protokollkopf.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { holeWeltdokument } from '../src/editor/weltdokument';
import { PROTOCOL_VERSION, PROTOKOLL_KOPF, veraltetMeldung } from '@wov/shared/src/protokollVersion.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

let gesehen: Record<string, string> = {};
const meldung = veraltetMeldung(2, 3);
const antwortet = (status: number, body: unknown): typeof fetch =>
  (async (_url: unknown, init?: RequestInit) => {
    gesehen = { ...(init?.headers as Record<string, string>) };
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

const abgewiesen = await holeWeltdokument(antwortet(426, { ok: false, fehler: 'client-veraltet', message: meldung, mindest: 3 }));
check('the load request carries the protocol version of this editor', gesehen[PROTOKOLL_KOPF] === String(PROTOCOL_VERSION) && PROTOCOL_VERSION >= 3, JSON.stringify(gesehen));
check('a 426 is shown as the load error with the reload message', abgewiesen.erreichbar === false && 'grund' in abgewiesen && abgewiesen.grund === meldung && /neu laden/.test(abgewiesen.grund), JSON.stringify(abgewiesen));

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const kern = readFileSync(resolve(WURZEL, 'tools', 'worldlayout-mcp', 'kern.ts'), 'utf8');
check('the MCP server sends the version header with its requests', kern.includes('[PROTOKOLL_KOPF]: String(PROTOCOL_VERSION)'));

if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\neditor-protokollkopf: alle Pruefungen gruen');
