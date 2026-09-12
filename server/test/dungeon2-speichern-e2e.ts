/**
 * E2E: AP15.1 — `client/src/editor/dungeon2/Dungeon2Speichern.ts` gegen
 * einen echten `WovServer`.
 *
 * Anders als die reinen Formattests (`shared/test/dungeon2-dokument.ts`)
 * prüft dieser Test den ECHTEN Sende-/Empfangsweg: den echten `GameSocket`,
 * den echten Nonce/HMAC-Handshake, das echte `DungeonEditSave`/
 * `DungeonEditData`-Paket, und die echte Weiche in
 * `WovServer.handleDungeonEditSave` (`dungeon2.istDokument2`). Kein Paket-
 * Nachbau — dieselbe Lehre wie in `g9-editor-verbindung.ts`: was der
 * Produktivcode definiert, wird benutzt, nicht abgeschrieben.
 *
 * Rot vor AP15.1 (Datei existierte nicht), grün danach:
 *   npx tsx server/test/dungeon2-speichern-e2e.ts   (aus der Wurzel)
 *
 * E2E: AP15.1 — `Dungeon2Speichern.ts` against a real `WovServer`. Unlike the
 * pure format tests, this exercises the REAL wire: the real `GameSocket`,
 * the real nonce/HMAC handshake, the real `DungeonEditSave`/`DungeonEditData`
 * packet pair, and the real switch in `WovServer.handleDungeonEditSave`.
 */
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dungeon2 } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { speichereDungeon2 } from '../../client/src/editor/dungeon2/Dungeon2Speichern.js';

// `GameSocket.ts` liest/schreibt `localStorage` (SessionToken, F3/F4
// Security-Review) — im Browser vorhanden, unter Node nicht. Ein
// Klein-Polyfill genügt: dieser Test braucht keine Sitzungspersistenz über
// mehrere Verbindungen hinweg, nur, dass der Zugriff nicht mit einem
// ReferenceError abbricht (der sonst als "Handshake fehlgeschlagen" bei
// JEDER Anmeldung ankäme).
//
// `GameSocket.ts` reads/writes `localStorage` — present in a browser, not
// under Node. A tiny polyfill is enough: this test needs no session
// persistence across connections, only that the access does not blow up
// with a ReferenceError (which would otherwise surface as "handshake
// failed" on EVERY login).
// `startePing`/`stoppePing` in `GameSocket.ts` benutzen `window.setInterval`/
// `clearInterval` (Hintergrund-Tab-Heartbeat) — im Browser ist `window` das
// globale Objekt, unter Node gibt es keins. `globalThis` selbst trägt
// dieselben `setInterval`/`clearInterval`, ein Alias genügt.
//
// `startePing`/`stoppePing` in `GameSocket.ts` use `window.setInterval`/
// `clearInterval` — a browser's `window` IS the global object; Node has none.
// `globalThis` already carries the same `setInterval`/`clearInterval`, so an
// alias is enough.
(globalThis as { window?: typeof globalThis }).window ??= globalThis;

(globalThis as { localStorage?: Storage }).localStorage ??= (() => {
  const speicher = new Map<string, string>();
  return {
    getItem: (k: string) => speicher.get(k) ?? null,
    setItem: (k: string, v: string) => void speicher.set(k, v),
    removeItem: (k: string) => void speicher.delete(k),
    clear: () => speicher.clear(),
    key: () => null,
    get length() {
      return speicher.size;
    },
  } as Storage;
})();

const HIER = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(HIER, '../../.tmp-dungeon2-speichern-e2e');
/** Eigener Port — nicht 2467 (DEV), nicht 2498/2499 (g6/g9), nicht 27314 (g9-editor-verbindung). */
const PORT = 2515;
const HOST = `127.0.0.1:${PORT}`;

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

/** Ein minimales, aber gültiges 2.0-Dokument im Modus 'erzeugt'. */
function baueDokument(id: string): dungeon2.DungeonDokument2 {
  return {
    version: dungeon2.DUNGEON_DOKUMENT_VERSION_2,
    id,
    name: 'AP15.1-Probe',
    modus: 'erzeugt',
    thema: 'steingrab',
    seeds: { architektur: 4242, material: dungeon2.mische(4242, 1), deko: dungeon2.mische(4242, 2) },
    // Platzhalter: 'erzeugt'-Dokumente lassen den Server die Prüfsumme neu
    // rechnen (sanitizeDungeonDokument2), sie wird nie aus der Datei
    // übernommen — s. Kopfkommentar dort.
    pruefsumme: '',
    layoutVersion: dungeon2.LAYOUT_VERSION,
  };
}

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  const server = createWovServer({
    port: PORT,
    worldsDir: resolve(TMP, 'worlds'), kontenDir: resolve(TMP, 'konten'),
    saveIntervalMs: 3_600_000,
  });
  server.start();

  // ── 1. Erfolgsweg: Speichern, Quittung, servergeprüftes Dokument ─────────
  const doc = baueDokument('ap15-probe');
  const meldungen: string[] = [];
  const erg = await speichereDungeon2(HOST, doc, { aufMeldung: (m) => meldungen.push(m) });

  pruefe('Speichern meldet Erfolg', erg.ok === true, erg.fehler ?? '');
  pruefe('Das zurückgegebene Dokument ist ein 2.0-Dokument', !!erg.dokument && dungeon2.istDokument2(erg.dokument));
  pruefe('Die Kennung bleibt erhalten', erg.dokument?.id === 'ap15-probe');
  pruefe(
    'Die Prüfsumme wurde vom Server NEU berechnet (nicht der leere Platzhalter)',
    !!erg.dokument && erg.dokument.pruefsumme !== '' && erg.dokument.pruefsumme.length > 0
  );
  pruefe(
    'Fassung ist die des Servers (DUNGEON_DOKUMENT_VERSION_2), nicht bloß "irgendein 2.0"',
    erg.dokument?.version === dungeon2.DUNGEON_DOKUMENT_VERSION_2
  );
  pruefe('Mindestens eine Statuszeile kam über aufMeldung an', meldungen.length > 0);

  // ── 2. Es landet WIRKLICH beim Server (nicht nur in der Quittung) ────────
  const amServer = server.dungeons.getDokument2('ap15-probe');
  pruefe('Das Dokument liegt unter dem Server-Manager', amServer !== undefined);
  pruefeGleich('Server- und Antwortprüfsumme stimmen überein', amServer?.pruefsumme, erg.dokument?.pruefsumme);
  pruefe(
    'getDocument (Altformat) sieht das 2.0-Dokument NICHT — die Weiche hält',
    server.dungeons.getDocument('ap15-probe') === undefined
  );

  // ── 3. Ablehnung: unbekanntes Thema kommt als ok:false zurück ────────────
  const kaputt = { ...baueDokument('ap15-kaputt'), thema: 'nichtvorhanden' };
  const erg2 = await speichereDungeon2(HOST, kaputt);
  pruefe('Unbekanntes Thema wird abgelehnt', erg2.ok === false);
  pruefe('Fehlermeldung ist gesetzt', typeof erg2.fehler === 'string' && erg2.fehler.length > 0);
  pruefe('Kein Dokument bei Ablehnung', erg2.dokument === undefined);
  pruefe(
    'Das abgelehnte Dokument landet NICHT beim Server',
    server.dungeons.getDokument2('ap15-kaputt') === undefined
  );

  // ── 4. Keine erreichbare Gegenstelle: sauberer Fehlausgang, kein Hänger ──
  // Ein falscher Port verwirft die Verbindung sofort (ECONNREFUSED) statt
  // erst nach FRIST_MS — das prüft den `ende()`-Einmal-Riegel über den
  // ANDEREN Ausgang (`onDisconnected` statt Quittung), ohne zehn Sekunden
  // Testlaufzeit zu kosten.
  const ergKeinServer = await speichereDungeon2('127.0.0.1:1', baueDokument('ap15-niemand'));
  pruefe('Ohne erreichbaren Server kommt ok:false zurück', ergKeinServer.ok === false);
  pruefe('… mit einer Fehlermeldung, kein Hänger', typeof ergKeinServer.fehler === 'string');

  server.stop();
  rmSync(TMP, { recursive: true, force: true });

  console.log(`dungeon2-speichern-e2e: ${gutZahl} Prüfungen grün, ${fehlerListe.length} rot`);
  for (const f of fehlerListe) console.log(`  ROT  ${f}`);
  process.exit(fehlerListe.length === 0 ? 0 : 1);
}

function pruefeGleich(name: string, ist: unknown, soll: unknown): void {
  pruefe(name, Object.is(ist, soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

main().catch((e: unknown) => {
  console.error('dungeon2-speichern-e2e: ABBRUCH —', e);
  process.exit(1);
});
