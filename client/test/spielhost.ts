/**
 * Die Dungeon-Knöpfe „Betreten" öffnen das Spiel auf dem Spiel-Host.
 *
 * Auf den Editor-Hosts gibt es keine Anmeldung (nginx schickt `/de/anmelden` in
 * den Editor zurück) und kein Konto. `dungeonZiel` schlägt den Spiel-Host in
 * einer festen Tabelle nach (Live `play.`, dev und staging `live.`); auf jedem
 * anderen Host bleibt es beim eigenen Ursprung. Das Token, das die
 * Editor-Verbindung beim Speichern vom Server bekommt, gehört nicht in den
 * `localStorage`: es ist kontolos und würde als Anmeldung gelten.
 *
 * Geprüft wird die Tabelle, das Verhalten von `GameSocket` beim Token und, durch
 * Ausführen des Knopf-Wegs beider Kataloge, welche Adresse wirklich geöffnet wird.
 */
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { PacketType } from '@wov/shared';
import { dungeonMeldung, dungeonUrl, dungeonZiel, gameUrl, spielHostVon } from '../src/editor/spielAdresse';
import { DungeonSeite } from '../src/editor/DungeonKatalog';
import { Dungeon2Seite } from '../src/editor/dungeon2/Dungeon2Katalog';
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
  [`editor.${H}`, `play.${H}`],
  [`editor.dev.${H}`, `live.dev.${H}`],
  [`editor.staging.${H}`, `live.staging.${H}`],
  [`EDITOR.dev.${H}`, `live.dev.${H}`],
  [`live.${H}`, null],
  [`play.${H}`, null],
  [`live.dev.${H}`, null],
  [`play.dev.${H}`, null],
  [`live.staging.${H}`, null],
  [`dev.${H}`, null],
  [H, null],
  [`editor.${H}:8443`, null],
  [`editor.dev.${H}:5290`, null],
  [`editor.other.${H}`, null],
  ['localhost', null],
  ['localhost:5290', null],
  ['editor.localhost', null],
  ['editor.localhost:5290', null],
  ['editor.', null],
  ['editor', null],
  ['constructor', null],
  ['__proto__', null],
  ['toString', null],
  [`x.editor.dev.${H}`, null],
  [`editor.dev.${H}/evil`, null],
  [`editor.dev.${H}@evil.example`, null],
  [`editor.evil.example\\@${H}`, null],
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
pruefe(z.url === '/play/?dungeon=x' && z.gleicherUrsprung, `editor.localhost bleibt beim eigenen Ursprung: ${z.url}`);
z = dungeonZiel('x', { host: `editor.dev.${H}`, protocol: 'http:' }, '/play/');
pruefe(z.url === `http://live.dev.${H}/play/?dungeon=x`, `http bleibt http: ${z.url}`);
z = dungeonZiel('steingrab-2', { host: `editor.${H}`, protocol: 'https:' }, '/play/');
pruefe(z.url === `https://play.${H}/play/?dungeon=steingrab-2` && !z.gleicherUrsprung, `editor (Live) → ${z.url}`);
z = dungeonZiel('x', { host: `editor.dev.${H}`, protocol: 'javascript:' }, '/play/');
pruefe(z.url.startsWith('https://live.'), `fremdes Protokoll wird zu https: ${z.url}`);
for (const id of ['a/../b', 'a?x=1#y', '//evil.example/', 'a b\n', '%2e%2e']) {
  const u = new URL(dungeonZiel(id, { host: `editor.dev.${H}`, protocol: 'https:' }, '/play/').url);
  pruefe(u.host === `live.dev.${H}` && u.pathname === '/play/' && u.searchParams.get('dungeon') === id && u.hash === '', `Kennung ${JSON.stringify(id)} bleibt ein Parameter auf live.dev`);
}

// ── Die Meldung sagt ehrlich, was beim Hostwechsel passiert ─────────────────
const mHost = dungeonMeldung('x', dungeonZiel('x', { host: `editor.dev.${H}`, protocol: 'https:' }, '/play/'));
pruefe(/Anmeldung/.test(mHost) && /danach von selbst/.test(mHost) && !/verloren|erneut/.test(mHost), `Hostwechsel: Meldung sagt, dass der Dungeon nach der Anmeldung öffnet (${mHost})`);
const mGleich = dungeonMeldung('x', dungeonZiel('x', { host: 'localhost:5290', protocol: 'http:' }, '/'));
pruefe(!/Anmeldung/.test(mGleich), `gleicher Ursprung: schlichte Meldung (${mGleich})`);

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
}
// Verhalten statt Quelltext: den echten Knopf-Weg (`betrete`) mit gestelltem
// `location`, `window.open` und `localStorage` ausführen und jede geöffnete
// Adresse prüfen. Ein Umweg über `location.assign` oder eine geklebte Adresse
// kommt hier nicht durch, gleich wie er gebaut ist.
type Ort = { host: string; protocol: string };
const geoeffnet: string[] = [];
const zugewiesen: string[] = [];
const meldungen: string[] = [];
let ortJetzt: Ort = { host: '', protocol: 'https:' };
const g = globalThis as unknown as Record<string, unknown>;
g.location = new Proxy(
  {},
  {
    get: (_t, k) => (k === 'host' ? ortJetzt.host : k === 'protocol' ? ortJetzt.protocol : k === 'assign' || k === 'replace' ? (u: string) => zugewiesen.push(u) : undefined),
    set: (_t, k, v) => (zugewiesen.push(`${String(k)}=${String(v)}`), true)
  }
);
g.window = { open: (u: string) => geoeffnet.push(String(u)), location: g.location };
(g.localStorage as { getItem(k: string): string | null }).getItem = (k: string) => (k === 'wov-session-token' ? null : speicher.get(k) ?? null);
const legacy = (DungeonSeite.prototype as unknown as { betrete(this: unknown, d: { id: string }): void }).betrete;
const neu = (Dungeon2Seite.prototype as unknown as { betrete(this: unknown): void }).betrete;
const wege: Array<[string, () => void]> = [
  ['DungeonKatalog', () => legacy.call({ schmutzig: false, cb: { meldung: (t: string) => meldungen.push(t) } }, { id: 'steingrab-2' })],
  ['Dungeon2Katalog', () => neu.call({ aktuellesDokument: { id: 'steingrab-2' }, zustand: 'sauber', shell: { meldung: (t: string) => meldungen.push(t) } })],
];
// Der Pfad hängt an der Basis des Builds (`/play/` im Bündel, `/` ohne Vite).
const PFAD = gameUrl('dungeon=steingrab-2');
const SOLL: Array<[string, string]> = [
  [`editor.${H}`, `https://play.${H}${PFAD}`],
  [`editor.dev.${H}`, `https://live.dev.${H}${PFAD}`],
  [`editor.staging.${H}`, `https://live.staging.${H}${PFAD}`],
];
// Verzögerte Navigation (setTimeout, Microtask, Promise) läuft erst nach dem
// synchronen Aufruf: vor jeder Auswertung die Timer abwarten.
const warteAufTimer = (): Promise<void> => new Promise((fertig) => setTimeout(fertig, 50));
for (const [name, weg] of wege) {
  for (const [host, soll] of SOLL) {
    geoeffnet.length = zugewiesen.length = meldungen.length = 0;
    ortJetzt = { host, protocol: 'https:' };
    let fehlerText = '';
    try {
      weg();
    } catch (e) {
      fehlerText = String(e);
    }
    await warteAufTimer();
    pruefe(fehlerText === '' && geoeffnet.length === 1 && geoeffnet[0] === soll && zugewiesen.length === 0, `${name} auf ${host}: öffnet ${JSON.stringify(geoeffnet)} (soll ${soll}), kein assign ${fehlerText}`);
    pruefe(meldungen.length === 1 && /danach von selbst/.test(meldungen[0]) && !/verloren|erneut/.test(meldungen[0]), `${name} auf ${host}: ehrliche Meldung (${meldungen[0] ?? 'keine'})`);
  }
  // Eigener Ursprung: nur ein Pfad, keine Adresse mit Host.
  geoeffnet.length = zugewiesen.length = meldungen.length = 0;
  (g.localStorage as { getItem(k: string): string | null }).getItem = () => 'sp_konto';
  ortJetzt = { host: 'localhost:5290', protocol: 'http:' };
  weg();
  await warteAufTimer();
  pruefe(geoeffnet.length === 1 && geoeffnet[0] === gameUrl('dungeon=steingrab-2') && zugewiesen.length === 0, `${name} auf localhost: ${JSON.stringify(geoeffnet)}`);
  pruefe(meldungen.length === 1 && !/Nicht im Spiel angemeldet/.test(meldungen[0]), `${name} auf localhost mit Token: keine Anmelde-Warnung (${meldungen[0] ?? 'keine'})`);
  // Eigener Ursprung ohne Token: die Vorabprüfung meldet es und öffnet das
  // Spiel MIT `?dungeon=`, damit main.ts den Wunsch vor der Anmeldung ablegt.
  geoeffnet.length = zugewiesen.length = meldungen.length = 0;
  (g.localStorage as { getItem(k: string): string | null }).getItem = () => null;
  weg();
  await warteAufTimer();
  pruefe(geoeffnet.length === 1 && geoeffnet[0] === gameUrl('dungeon=steingrab-2') && zugewiesen.length === 0, `${name} auf localhost ohne Token: öffnet ${JSON.stringify(geoeffnet)} mit ?dungeon=`);
  pruefe(meldungen.length === 1 && /Nicht im Spiel angemeldet/.test(meldungen[0]) && /nach der Anmeldung/.test(meldungen[0]) && !/verloren/.test(meldungen[0]), `${name} auf localhost ohne Token: Meldung (${meldungen[0] ?? 'keine'})`);
}

// Das Speichern läuft auf dem Editor-Host über /ws.
const d2 = readFileSync(new URL('../src/editor/dungeon2/Dungeon2Katalog.ts', import.meta.url), 'utf8');
pruefe(/speichereDungeon2\(location\.host,/.test(d2), 'Dungeon2Katalog.speichere(): WebSocket-Host ist location.host');

console.log(fehler === 0 ? '\nAlle Adressen und der Anmeldeweg stimmen.' : `\n${fehler} falsch.`);
process.exit(fehler > 0 ? 1 : 0);
