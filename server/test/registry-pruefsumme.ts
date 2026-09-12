/**
 * E6 — Die Registry-Prüfsumme reist mit dem Dokument.
 *
 * ── Der Fehler, gegen den dieser Test steht ──────────────────────────
 * `sanitizeDungeonDocument` VERWIRFT UNBEKANNTE RÄUME STILL
 * (`shared/src/dungeons.ts`, Kopf: „Unknown rooms are dropped"). Das ist
 * für ein Dokument von der Platte richtig — ein Kit, das ein Raummodul
 * verloren hat, soll nicht das ganze Grab unbrauchbar machen. Für ein
 * Dokument aus dem EDITOR ist es der teuerste aller Fehler: Der Editor
 * baut seinen Grundriss selbst (`DungeonNeuesDokument.ts` ruft
 * `erzeugeLayoutFuerKit`), und seit E5 kann sein Katalog Säle enthalten,
 * die der Server erst nach einem Neustart kennt — oder umgekehrt: der
 * Server kennt einen Saal, den die noch offene Seite von vorhin nicht
 * hat. Wer in diesem Zustand speichert, bekommt kein „abgelehnt",
 * sondern eine Quittung mit einem Häkchen und ein Grab mit einem Loch.
 *
 * Abschnitt 3 unten MISST diesen stillen Verlust, statt ihn zu
 * behaupten. Alles danach misst, dass er nicht mehr passieren kann.
 *
 * ── Warum eine Prüfsumme und nicht „schick die Modulliste mit" ───────
 * Weil die Frage binär ist. Der Server kann mit einer Liste nichts
 * Besseres anfangen als vergleichen; eine Liste im Paket wäre nur eine
 * grössere Fassung derselben Antwort — und die erste Stelle, an der
 * Namen aus dem Netz in eine Schleife über Nachschlagewerke liefen.
 *
 * ── Was ein FEHLENDES Feld bedeutet ─────────────────────────────────
 * Ein Client von vor E6 schickt gar keine Prüfsumme. Er ist damit kein
 * Sonderfall, sondern die WÖRTLICHE Wahrheit über sich selbst: Sein
 * Bündel kennt keine generierten Module, denn die Registrierung im
 * Browser entsteht überhaupt erst mit E6. Ein fehlendes Feld ist
 * deshalb die Prüfsumme der LEEREN Registry — und das ist genau dann
 * eine Annahme, wenn der Server auch keine kennt, und genau dann eine
 * Ablehnung, wenn er welche kennt. Abschnitt 5a und 5b messen beide
 * Hälften.
 *
 * Rot zuerst: `moduleRegistry.registryChecksum` und der Vergleich in
 * `WovServer.handleDungeonEditSave` gibt es vor E6 nicht — dieser Test
 * lässt sich vorher nicht einmal importieren.
 *
 * E6 guard: the module-registry checksum travels with every
 * `DungeonEditSave`; the server compares it BEFORE `sanitizeDungeonDocument`
 * and rejects a stale editor page instead of silently dropping its rooms.
 *
 *   npx tsx server/test/registry-pruefsumme.ts     (aus der Wurzel)
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PacketType, sanitizeDungeonDocument, moduleRegistry } from '@wov/shared';
import type { BinaryReader } from '../../client/src/net/GameSocket.js';
import { GameSocket } from '../../client/src/net/GameSocket.js';
import { Writer } from '../src/io/Writer.js';
import { createWovServer } from '../src/WovServer.js';
import { ladeModulRegistrierung } from '../src/world/dungeon/ModuleBuild.js';

// ── Wirtsattrappen, wie in dungeon2-speichern-e2e.ts ────────────────────
// `GameSocket` ist Browsercode: Es liest `localStorage` (SessionToken) und
// ruft `window.setInterval` (Heartbeat). Beides fehlt unter Node und käme
// sonst als „Handshake fehlgeschlagen" an — an einer Stelle, die mit dem
// Handshake nichts zu tun hat.
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

/** Eigener Port — nicht 2467 (DEV), nicht 2498/2499, nicht 2515 (AP15.1). */
const PORT = 2519;
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

function pruefeGleich(name: string, ist: unknown, soll: unknown): void {
  pruefe(name, Object.is(ist, soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

// ── Bausteine ───────────────────────────────────────────────────────────
const KIT = moduleRegistry.KIT_NAME;
const SAAL = moduleRegistry.modulName(4, 3, 2);

function registryEintrag(): moduleRegistry.RegistryModul {
  return {
    kit: KIT,
    name: SAAL,
    zellenX: 4,
    zellenZ: 3,
    pfeilerRaster: 2,
    gewicht: 0.5,
    tris: moduleRegistry.dreiecke(4, 3, 2),
    erzeugt: '2026-09-05T00:00:00.000Z',
  };
}

/**
 * Ein 1.0-Dokument mit ZWEI Räumen: einem Bestandsraum und dem
 * generierten Saal. Genau diese Mischung ist der gefährliche Fall — ein
 * Dokument, dessen Räume ALLE unbekannt sind, fällt in
 * `sanitizeDungeonDocument` durch (`rooms.length === 0` → null) und wird
 * gemeldet. Verloren geht nur, was neben Bekanntem steht.
 */
function baueDokument(id: string, saalName: string): Record<string, unknown> {
  return {
    version: 2,
    id,
    name: 'E6-Probe',
    base: KIT,
    mode: 'custom',
    seed: 7,
    zoneSize: 64,
    layout: {
      rooms: [
        { room: 'StoneVaultHall', pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, placeOrder: 1, seed: 1 },
        { room: saalName, pos: { x: 0, y: 0, z: 8 }, rot: { x: 0, y: 0, z: 0, w: 1 }, placeOrder: 2, seed: 2 },
      ],
      doors: [],
      props: [],
    },
  };
}

interface Quittung {
  readonly ok: boolean;
  readonly meldung: string;
}

/**
 * Ein echter Speichervorgang über den echten Draht: echter `GameSocket`,
 * echter Nonce/HMAC-Handshake, echtes `DungeonEditSave`.
 *
 * Drei Absender werden nachgestellt:
 *
 *  • `pruefsumme === 'echt'` fährt den PRODUKTIVWEG — `GameSocket.
 *    sendDungeonEditSave(json)` ohne zweites Argument, also genau das,
 *    was der Editor tut. Nur dieser Fall beweist, dass die Zahl im
 *    Auslieferungszustand überhaupt auf den Draht kommt.
 *  • Eine Zeichenkette stellt eine VERALTETE Seite nach. In einem
 *    einzigen Prozess teilen Client und Server sich die
 *    Nachschlagewerke; ohne dieses Argument wäre der Fehlerfall hier
 *    nicht herstellbar.
 *  • `null` baut die Nutzlast eines ALT-Clients: nur die
 *    JSON-Zeichenkette, kein zweites Feld. Genau so liegen die Bytes
 *    eines Bündels von vor E6 auf dem Draht — und genau das muss der
 *    Server lesen können, ohne über das Ende des Puffers zu laufen.
 *
 * Je Aufruf eine eigene Verbindung: `DungeonEditSave` hat einen
 * Drosseleimer von 2 (`Drossel.ts`), fünf Speichervorgänge über
 * dieselbe Verbindung liefen in die Bremse statt in die Prüfung.
 */
function speichere(dokument: unknown, pruefsumme: string | null | 'echt'): Promise<Quittung> {
  const socket = new GameSocket(`ws://${HOST}/ws`, 'E6-Editor', true);
  return new Promise<Quittung>((fertig) => {
    let erledigt = false;
    const ende = (q: Quittung): void => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      socket.onDisconnected = null;
      socket.disconnect();
      fertig(q);
    };
    const uhr = setTimeout(() => ende({ ok: false, meldung: 'Keine Antwort (10 s)' }), 10_000);

    socket.on(PacketType.DungeonEditData, (reader: BinaryReader) => {
      const ok = reader.readBool();
      const meldung = reader.readString();
      ende({ ok, meldung });
    });
    socket.onDisconnected = (grund?: string) =>
      ende({ ok: false, meldung: `Verbindung beendet: ${grund ?? ''}` });

    socket.onConnected = () => {
      if (pruefsumme === 'echt') {
        socket.sendDungeonEditSave(JSON.stringify(dokument));
        return;
      }
      const w = new Writer();
      w.writeString(JSON.stringify(dokument));
      if (pruefsumme !== null) w.writeString(pruefsumme);
      socket.sendPacket(PacketType.DungeonEditSave, new Uint8Array(w.toBuffer()));
    };
    socket.connect();
  });
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'wov-e6-'));
  const generiert = join(tmp, 'generiert');
  const leerer = join(tmp, 'leer');
  mkdirSync(generiert, { recursive: true });
  mkdirSync(leerer, { recursive: true });

  // ── 1. Die Prüfsumme als Funktion ─────────────────────────────────────
  const leer = moduleRegistry.registryPruefsumme([]);
  const eins = moduleRegistry.registryPruefsumme([registryEintrag()]);
  pruefe('Leere Registry hat acht Hexstellen', /^[0-9a-f]{8}$/.test(leer), leer);
  pruefe('Ein Modul ändert die Prüfsumme', eins !== leer, `${leer} → ${eins}`);

  const zweiter: moduleRegistry.RegistryModul = { ...registryEintrag(), name: `${SAAL}b` };
  pruefeGleich(
    'Die Reihenfolge der Einträge zählt NICHT (sortiert kanonisch)',
    moduleRegistry.registryPruefsumme([registryEintrag(), zweiter]),
    moduleRegistry.registryPruefsumme([zweiter, registryEintrag()])
  );
  pruefeGleich(
    'Der Zeitstempel geht NICHT ein (sonst schlüge die Warnung falsch an)',
    moduleRegistry.registryPruefsumme([{ ...registryEintrag(), erzeugt: '2000-01-01T00:00:00.000Z' }]),
    eins
  );

  // ── 2. Fehlende Datei = leere Registry ────────────────────────────────
  const ohneDatei = ladeModulRegistrierung(leerer);
  pruefeGleich('Ohne Registry-Datei wird nichts geladen', ohneDatei.geladen, 0);
  pruefeGleich('Ohne Registry-Datei gibt es keine Beschwerde', ohneDatei.meldungen.length, 0);
  pruefeGleich('Ohne Registry-Datei ist die Prüfsumme die der leeren Registry', moduleRegistry.registryChecksum(), leer);

  const ausText = moduleRegistry.leseRegistryAusText('');
  pruefeGleich('Leerer Text ergibt eine leere Registry', ausText.module.length, 0);
  pruefeGleich('Unlesbarer Text ergibt eine leere Registry', moduleRegistry.leseRegistryAusText('{kaputt').module.length, 0);

  // ── 3. Was auf dem Spiel steht: der STILLE Verlust ────────────────────
  //
  // Gemessen, nicht behauptet. Ohne E6 ist genau das der Ausgang eines
  // Speichervorgangs aus einer Seite, deren Katalog dem Server voraus ist.
  const fremd = sanitizeDungeonDocument(baueDokument('e6-still', 'Gen_StoneVaultHall9x9'));
  pruefe('Ein Dokument mit unbekanntem Raum wird NICHT abgelehnt', fremd !== null);
  pruefeGleich('… es verliert den Raum still: zwei rein, einer raus', fremd?.layout.rooms.length, 1);
  pruefeGleich('… und was bleibt, ist der Bestandsraum', fremd?.layout.rooms[0]?.room, 'StoneVaultHall');

  // ── 4. Beide Seiten rechnen aus DERSELBEN Datei DIESELBE Zahl ─────────
  const datei: moduleRegistry.RegistryDatei = {
    version: moduleRegistry.REGISTRY_VERSION,
    pruefsumme: 'egal-was-hier-steht',
    module: [registryEintrag()],
  };
  writeFileSync(join(generiert, moduleRegistry.REGISTRY_DATEI), `${JSON.stringify(datei, null, 2)}\n`, 'utf8');

  const server = createWovServer({
    port: PORT,
    worldsDir: resolve(tmp, 'worlds'), kontenDir: resolve(tmp, 'konten'),
    saveIntervalMs: 3_600_000,
  });
  server.start();

  // 5a MUSS vor der Registrierung laufen: Es misst den Zustand „beide
  // Seiten kennen nichts", und der ist nach dem Laden weg.
  const altLeer = await speichere(baueDokument('e6-alt-leer', 'StoneVaultHall'), null);
  pruefe('Alt-Client OHNE Prüfsumme wird angenommen, solange der Server keine Module kennt', altLeer.ok, altLeer.meldung);

  const geladen = ladeModulRegistrierung(generiert);
  pruefeGleich('Der Server registriert das Modul aus der Datei', geladen.geladen, 1);
  pruefe('… und meldet nur die fehlende GLB als Warnung', geladen.meldungen.length === 0, geladen.meldungen.join(' | '));

  const serverSumme = moduleRegistry.registryChecksum();
  pruefe('Die Prüfsumme des Servers ist nicht mehr die leere', serverSumme !== leer, serverSumme);

  // Der „Client": derselbe Dateitext, eigener Weg zur Zahl — ohne die
  // Nachschlagewerke anzufassen (im Browser sind sie ein anderer Prozess).
  const clientDatei = moduleRegistry.leseRegistryAusText(JSON.stringify(datei));
  pruefeGleich(
    'Client und Server rechnen aus derselben Datei dieselbe Zahl',
    moduleRegistry.registryPruefsumme(clientDatei.module),
    serverSumme
  );
  pruefe(
    'Eine Datei mit einem Modul mehr ergibt eine ANDERE Zahl',
    moduleRegistry.registryPruefsumme([...clientDatei.module, zweiter]) !== serverSumme
  );
  pruefeGleich(
    'Das Feld `pruefsumme` IN der Datei wird nicht geglaubt, sondern nachgerechnet',
    clientDatei.pruefsumme,
    serverSumme
  );

  // ── 5. Am echten Draht ────────────────────────────────────────────────
  const altVoll = await speichere(baueDokument('e6-alt-voll', SAAL), null);
  pruefe('Alt-Client OHNE Prüfsumme wird abgelehnt, sobald der Server Module kennt', !altVoll.ok, altVoll.meldung);
  pruefe('… mit der Meldung „Registry veraltet — Seite neu laden"', altVoll.meldung.includes('Registry veraltet'), altVoll.meldung);
  pruefeGleich('… und NICHTS wurde gespeichert', server.dungeons.getDocument('e6-alt-voll'), undefined);

  const falsch = await speichere(baueDokument('e6-falsch', SAAL), leer);
  pruefe('Falsche Prüfsumme wird abgelehnt', !falsch.ok, falsch.meldung);
  pruefe('… mit derselben Meldung', falsch.meldung.includes('Registry veraltet'), falsch.meldung);
  pruefeGleich('… und NICHTS wurde gespeichert', server.dungeons.getDocument('e6-falsch'), undefined);

  const echt = await speichere(baueDokument('e6-echt', SAAL), 'echt');
  pruefe('Der PRODUKTIVWEG legt die Prüfsumme von selbst aufs Paket', echt.ok, echt.meldung);
  pruefeGleich(
    '… und das Dokument liegt danach mit BEIDEN Räumen beim Server',
    server.dungeons.getDocument('e6-echt')?.layout.rooms.length,
    2
  );

  const richtig = await speichere(baueDokument('e6-richtig', SAAL), serverSumme);
  pruefe('Richtige Prüfsumme wird angenommen', richtig.ok, richtig.meldung);
  const gespeichert = server.dungeons.getDocument('e6-richtig');
  pruefe('Das Dokument liegt beim Server', gespeichert !== undefined);
  pruefeGleich('… mit BEIDEN Räumen — der Saal hat überlebt', gespeichert?.layout.rooms.length, 2);
  pruefe(
    '… und der generierte Saal steht namentlich drin',
    (gespeichert?.layout.rooms ?? []).some((r) => r.room === SAAL)
  );

  server.stop();

  // ── Ergebnis ──────────────────────────────────────────────────────────
  console.log(`\n  Prüfsumme leer/voll   ${leer} → ${serverSumme}`);
  console.log(`  Saal                  ${SAAL}, ${registryEintrag().tris} Dreiecke`);
  console.log(`\n  ${gutZahl} Prüfungen grün, ${fehlerListe.length} rot`);
  for (const f of fehlerListe) console.log(`    ✗ ${f}`);
  if (fehlerListe.length > 0) process.exit(1);
  console.log('  E6 grün: die Registry-Prüfsumme reist mit.\n');
  process.exit(0);
}

void main();
