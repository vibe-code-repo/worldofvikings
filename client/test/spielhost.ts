/**
 * Die Dungeon-Knöpfe „Betreten" öffnen das Spiel auf dem Spiel-Host.
 *
 * Auf `editor.<rest>` gibt es keine Anmeldung (nginx schickt `/de/anmelden` in
 * den Editor zurück) und kein Konto. `dungeonZiel` macht daher aus
 * `editor.dev.world-of-vikings.com` den Host `live.dev.world-of-vikings.com`;
 * auf jedem anderen Host bleibt es beim eigenen Ursprung. Das Token, das die
 * Editor-Verbindung beim Speichern vom Server bekommt, gehört nicht in den
 * `localStorage`: es ist kontolos und würde als Anmeldung gelten.
 *
 * Geprüft wird die Abbildung, das Verhalten von `GameSocket` beim Token und,
 * am Syntaxbaum, dass beide Kataloge nur über `dungeonZiel` öffnen.
 */
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { PacketType } from '@wov/shared';
import { dungeonUrl, dungeonZiel, gameUrl, spielHostVon } from '../src/editor/spielAdresse';
import { GameSocket } from '../src/net/GameSocket';

let fehler = 0;
function pruefe(ok: boolean, was: string): void {
  if (!ok) fehler++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${was}`);
}

// ── Die Pfad-Adresse: nur ein Pfad, nie ein Host ────────────────────────────
for (const basis of ['/play/', '/', '/play']) {
  const ist = dungeonUrl('steingrab-2', basis);
  pruefe(ist === `${gameUrl('', basis)}?dungeon=steingrab-2`, `dungeonUrl mit Basis ${basis}: ${ist}`);
  pruefe(ist.startsWith('/') && !ist.startsWith('//') && !/^[a-z]+:/i.test(ist), `Basis ${basis}: ein Pfad auf dem eigenen Ursprung`);
}
pruefe(dungeonUrl('a b&c=d/ö', '/play/') === '/play/?dungeon=a%20b%26c%3Dd%2F%C3%B6', 'die Kennung wird kodiert (Leerzeichen, &, =, /, Umlaut)');
let meldung = '';
try {
  dungeonUrl('a\uD800b', '/play/');
} catch (e) {
  meldung = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
}
pruefe(meldung.startsWith('Error: Ungültige Dungeon-Kennung'), `einzelnes Surrogat: verständliche Ablehnung statt URIError (${meldung})`);

// ── Die Host-Abbildung ──────────────────────────────────────────────────────
const H = 'world-of-vikings.com';
const faelle: Array<[string, string | null]> = [
  [`editor.dev.${H}`, `live.dev.${H}`],
  [`editor.staging.${H}`, `live.staging.${H}`],
  [`editor.${H}`, `live.${H}`],
  [`editor.${H}:8443`, `live.${H}:8443`],
  [`EDITOR.dev.${H}`, `live.dev.${H}`],
  [`live.dev.${H}`, null],
  [`play.dev.${H}`, null],
  [`dev.${H}`, null],
  ['localhost', null],
  ['localhost:5290', null],
  ['editor.', null],
  ['editor', null],
  ['editor.localhost:5290', 'live.localhost:5290'],
  [`x.editor.dev.${H}`, null],
  [`editor.dev.${H}/evil`, null],
  [`editor.dev.${H}@evil.example`, null],
  [`editor.evil.example\\@${H}`, null],
  [`editor.dev.${H}:99999999`, null],
  ['', null],
];
for (const [host, soll] of faelle) {
  const ist = spielHostVon(host);
  pruefe(ist === soll, `spielHostVon(${JSON.stringify(host)}) = ${JSON.stringify(ist)} (soll ${JSON.stringify(soll)})`);
}
let z = dungeonZiel('steingrab-2', { host: `editor.dev.${H}`, protocol: 'https:' }, '/play/');
pruefe(z.url === `https://live.dev.${H}/play/?dungeon=steingrab-2` && !z.gleicherUrsprung, `editor.dev → ${z.url}`);
z = dungeonZiel('steingrab-2', { host: `live.dev.${H}`, protocol: 'https:' }, '/play/');
pruefe(z.url === '/play/?dungeon=steingrab-2' && z.gleicherUrsprung, `live.dev bleibt beim eigenen Ursprung: ${z.url}`);
z = dungeonZiel('steingrab-2', { host: 'localhost:5290', protocol: 'http:' }, '/');
pruefe(z.url === '/?dungeon=steingrab-2' && z.gleicherUrsprung, `localhost bleibt beim eigenen Ursprung: ${z.url}`);
z = dungeonZiel('x', { host: 'editor.localhost:5290', protocol: 'http:' }, '/play/');
pruefe(z.url === 'http://live.localhost:5290/play/?dungeon=x', `http bleibt http: ${z.url}`);
z = dungeonZiel('x', { host: `editor.dev.${H}`, protocol: 'javascript:' }, '/play/');
pruefe(z.url.startsWith('https://live.'), `fremdes Protokoll wird zu https: ${z.url}`);
for (const id of ['a/../b', 'a?x=1#y', '//evil.example/', 'a b\n', '%2e%2e']) {
  const u = new URL(dungeonZiel(id, { host: `editor.dev.${H}`, protocol: 'https:' }, '/play/').url);
  pruefe(u.host === `live.dev.${H}` && u.pathname === '/play/' && u.searchParams.get('dungeon') === id && u.hash === '', `Kennung ${JSON.stringify(id)} bleibt ein Parameter auf live.dev`);
}
pruefe(!/play\.dev|\bplay\./.test(readFileSync(new URL('../src/editor/spielAdresse.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), 'das tote play.-Host taucht in spielAdresse.ts nicht auf');

// ── GameSocket: die Editor-Verbindung schreibt kein Token ───────────────────
function peerInfo(token: string): ArrayBuffer {
  const enc = new TextEncoder();
  const bytes: number[] = [PacketType.PeerInfo];
  for (const s of ['Editor', 'uid', 'server', token]) {
    const b = enc.encode(s);
    if (b.length > 63) throw new Error('Probe: Zeichenkette zu lang');
    bytes.push(b.length << 1, ...b); // Zickzack-VarInt: Länge * 2
  }
  return new Uint8Array(bytes).buffer;
}
const speicher = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => speicher.get(k) ?? null,
  setItem: (k: string, v: string) => void speicher.set(k, v),
};
const geben = (s: GameSocket, daten: ArrayBuffer): void => (s as unknown as { handleMessage(d: ArrayBuffer): void }).handleMessage(daten);
geben(new GameSocket('ws://x/ws', 'Editor', true), peerInfo('sp_kontolos'));
pruefe(!speicher.has('wov-session-token'), 'Editor-Verbindung (nurEditor): Token nicht im localStorage');
geben(new GameSocket('ws://x/ws', 'Viking', false), peerInfo('sp_konto'));
pruefe(speicher.get('wov-session-token') === 'sp_konto', 'Spielverbindung: Token wird gespeichert wie bisher');

// ── Die Kataloge ────────────────────────────────────────────────────────────
const KATALOGE = ['../src/editor/DungeonKatalog.ts', '../src/editor/dungeon2/Dungeon2Katalog.ts'];
for (const rel of KATALOGE) {
  const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const knoten: ts.Node[] = [];
  const geh = (k: ts.Node): void => {
    knoten.push(k);
    ts.forEachChild(k, geh);
  };
  geh(sf);

  const namen = knoten.filter((k) => ts.isIdentifier(k) && /^spielHost2?$/.test(k.text));
  pruefe(namen.length === 0, `${rel}: kein spielHost/spielHost2 mehr (${namen.length} Treffer)`);
  const ziele = knoten.filter((k) => ts.isCallExpression(k) && ts.isIdentifier(k.expression) && k.expression.text === 'dungeonZiel');
  pruefe(ziele.length === 1, `${rel}: genau ein dungeonZiel-Aufruf (${ziele.length})`);
  // dungeonZiel bekommt das echte location, kein selbstgebautes Objekt.
  pruefe(ziele.every((k) => (k as ts.CallExpression).arguments[1]?.getText() === 'location'), `${rel}: dungeonZiel(…, location)`);

  const oeffner = knoten.filter(
    (k): k is ts.CallExpression =>
      ts.isCallExpression(k) &&
      ts.isPropertyAccessExpression(k.expression) &&
      ts.isIdentifier(k.expression.expression) &&
      k.expression.expression.text === 'window' &&
      k.expression.name.text === 'open'
  );
  pruefe(oeffner.length === 2, `${rel}: zwei window.open (${oeffner.length})`);
  for (const o of oeffner) {
    const a = o.arguments[0];
    const arg = a?.getText() ?? '';
    pruefe(/^gameUrl\(\)$/.test(arg) || arg === 'ziel.url', `${rel}: window.open(${arg}) geht über gameUrl() oder dungeonZiel().url`);
  }
  // Die Token-Vorabprüfung steht hinter `gleicherUrsprung`: im Zweig davor liest niemand localStorage.
  const liest = knoten.filter((k) => ts.isCallExpression(k) && k.getText().startsWith('localStorage.getItem'));
  pruefe(
    liest.length === 1 &&
      liest.every((k) => {
        for (let p: ts.Node | undefined = k.parent; p; p = p.parent) if (ts.isIfStatement(p) && p.expression.getText() === 'ziel.gleicherUrsprung') return true;
        return false;
      }),
    `${rel}: localStorage nur im Zweig ziel.gleicherUrsprung gelesen (${liest.length} Lesung)`
  );
  // Kein Adresstext aus location.protocol/host, ausser dem WebSocket-Pfad `…/ws`.
  const geklebt = knoten.filter((k) => ts.isTemplateExpression(k) && /location\.(protocol|host)/.test(k.getText()) && !/\/ws`$/.test(k.getText()));
  pruefe(geklebt.length === 0, `${rel}: keine Adresse aus location.protocol/host (${geklebt.length})`);
}
// Das Speichern läuft auf dem Editor-Host über /ws.
const d2 = readFileSync(new URL('../src/editor/dungeon2/Dungeon2Katalog.ts', import.meta.url), 'utf8');
pruefe(/speichereDungeon2\(location\.host,/.test(d2), 'Dungeon2Katalog.speichere(): WebSocket-Host ist location.host');

console.log(fehler === 0 ? '\nAlle Adressen und der Anmeldeweg stimmen.' : `\n${fehler} falsch.`);
process.exit(fehler > 0 ? 1 : 0);
