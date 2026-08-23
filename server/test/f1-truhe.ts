/**
 * E2E-Test: Truhen mit echtem Inhalt (Roadmap F1).
 *
 * Faehrt den ECHTEN Draht-/Serverpfad ueber echte WebSocket-Verbindungen
 * (Handshake wie server/test/set-time-of-day.ts, g6-dungeon-e2e.ts) statt
 * WovServer-Methoden nachzubauen — die private Interaktionslogik
 * (handleTruheOeffnen/handleContainerAction) ist nur so ueberhaupt
 * erreichbar, und genau das ist der Pfad, den ein Browser auch nimmt.
 * Zum Interpretieren der ContainerSync-/InventorySync-Nutzlast wird die
 * ECHTE unpackContainer()-Funktion aus shared/items/Container.ts benutzt,
 * kein eigener Parser (CLAUDE.md-Lehre: niemals die zu pruefende Logik
 * nachbauen).
 *
 * Deckt die geforderte Liste:
 *  1. Erstbefuellung: eine unberuehrte Truhe bekommt ihre Zufallsbeute
 *     als echten Inhalt, EXAKT einmal (zweite Oeffnung liest denselben
 *     Stand, wuerfelt nicht neu).
 *  2. Nehmen + Legen desselben Postens ergibt in Summe dieselbe Menge
 *     (Truheninhalt UND Spieler-Inventar je vorher/nachher identisch).
 *  3. Eine bereits geplünderte Alt-Truhe (nur `TRUHE_LOOTED_MEMBER`
 *     gesetzt, kein Inhalt-Member — der Zustand eines Saves von VOR
 *     diesem Umbau) startet leer.
 *  4. Ein Spieler ausserhalb der Reichweite wird abgewiesen —
 *     ContainerAction traegt keine Positionsangabe, geprueft wird also
 *     handleContainerAction's EIGENE Distanzpruefung gegen die echte
 *     ZDO-/Peer-Position.
 *  5. Inhalt uebersteht Speichern (saveWorld) und Laden (frischer
 *     Server, init()-only wie server/test/g2-persistence.ts).
 *
 * Laufzeit: drei gestartete Server (start(), je ein eigener Port/Save)
 * plus ein init()-only Reload — in derselben Groessenordnung wie
 * set-time-of-day.ts (zwei gestartete Server).
 *
 * Run: npx tsx server/test/f1-truhe.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import {
  TRUHE_INHALT_MEMBER,
  TRUHE_LOOTED_MEMBER,
  unpackContainer,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { ZDOID } from '../src/zdo/ZDOID.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Eigenes Verzeichnis statt data/worlds (Default) — sonst landet bei jedem
// Testlauf ein world.db.zst neben Mikes echtem dev.db.zst (s.
// g2-persistence.ts, derselbe Grund).
const WORLDS_DIR = resolve(__dirname, 'tmp-f1-truhe');
rmSync(WORLDS_DIR, { recursive: true, force: true });

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  PlayerState: 41,
  Interact: 44,
  InteractResult: 45,
  InventorySync: 65,
  // F4 (Security-Review): Nonce/HMAC-Passwort-Handshake.
  AuthChallenge: 68,
  ContainerAction: 69,
  ContainerSync: 70,
};

// ── Draht-Hilfsfunktionen (identisch zu set-time-of-day.ts/g6-dungeon-e2e.ts) ──

function writeString(v: string): number[] {
  const enc = new TextEncoder().encode(v);
  let zigzag = ((enc.length << 1) ^ (enc.length >> 31)) >>> 0;
  const out: number[] = [];
  do {
    const b = zigzag & 0x7f;
    zigzag >>>= 7;
    out.push(zigzag ? b | 0x80 : b);
  } while (zigzag);
  return [...out, ...enc];
}

function writeInt32(v: number): number[] {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v, 0);
  return [...b];
}

function writeFloat32(v: number): number[] {
  const b = Buffer.alloc(4);
  b.writeFloatLE(v, 0);
  return [...b];
}

function readVarInt(view: DataView, pos: number): [number, number] {
  let result = 0, shift = 0, byte: number;
  do {
    byte = view.getUint8(pos++);
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [((result >>> 1) ^ -(result & 1)), pos];
}

function readString(view: DataView, pos: number): [string, number] {
  const [len, p] = readVarInt(view, pos);
  const s = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + p, len));
  return [s, p + len];
}

function parseContainerSync(view: DataView): { userId: string; id: number; json: string } {
  const [userId, p1] = readString(view, 0);
  const id = view.getInt32(p1, true);
  const [json] = readString(view, p1 + 4);
  return { userId, id, json };
}

function sendInteract(ws: WebSocket, x: number, y: number, z: number, prefabHash: number): void {
  const payload = [...writeFloat32(x), ...writeFloat32(y), ...writeFloat32(z), ...writeInt32(prefabHash)];
  ws.send(Buffer.from([P.Interact, ...payload]));
}

function sendContainerAction(
  ws: WebSocket,
  zdoUserId: string,
  zdoId: number,
  richtung: 0 | 1,
  itemName: string,
  amount: number
): void {
  const payload = [
    ...writeString(zdoUserId),
    ...writeInt32(zdoId),
    ...writeInt32(richtung),
    ...writeString(itemName),
    ...writeInt32(amount),
  ];
  ws.send(Buffer.from([P.ContainerAction, ...payload]));
}

/**
 * Minimaler Testclient: puffert JEDES Paket nach Typ (statt nur auf den
 * naechsten Aufruf von naechstes() zu warten) — sonst geht ein Paket
 * verloren, das zwischen zwei await-Punkten ankommt (z. B. PlayerState
 * unmittelbar nach PeerInfo, im selben Tick verschickt).
 */
interface TestClient {
  ws: WebSocket;
  naechstes(type: number): Promise<DataView>;
}

function verbindeClient(port: number, name: string): Promise<TestClient> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;

    const puffer = new Map<number, DataView[]>();
    const warteschlangen = new Map<number, Array<(v: DataView) => void>>();

    const client: TestClient = {
      ws,
      naechstes(type: number): Promise<DataView> {
        return new Promise((res) => {
          const anstehend = puffer.get(type);
          if (anstehend && anstehend.length > 0) {
            res(anstehend.shift()!);
            return;
          }
          const liste = warteschlangen.get(type) ?? [];
          liste.push(res);
          warteschlangen.set(type, liste);
        });
      },
    };

    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      // Eigene Kopie statt View auf den (moeglicherweise gepoolten) Node-
      // Buffer: die Nachricht wird ggf. erst Ticks spaeter aus der
      // Warteschlange gelesen, der Original-Buffer darf bis dahin nicht
      // von der naechsten Socket-Lesung ueberschrieben werden.
      const kopie = Buffer.from(data.subarray(1));
      const view = new DataView(kopie.buffer, kopie.byteOffset, kopie.byteLength);

      if (type === P.VersionCheck) {
        const pkt = Buffer.alloc(5);
        pkt.writeUInt8(P.VersionCheck, 0);
        pkt.writeInt32LE(2, 1);
        ws.send(pkt);
        return;
      }
      if (type === P.AuthChallenge) {
        if (!authSent) {
          authSent = true;
          const [nonce] = readString(view, 0);
          const antwort = antwortBerechnen(nonce, ''); // ECHTE Funktion, s. Importkommentar-Lehre in g6-dungeon-e2e.ts
          const payload = [...writeString(antwort), ...writeString(name), ...writeString('')];
          ws.send(Buffer.from([P.PasswordAuth, ...payload]));
        }
        return;
      }

      const warter = warteschlangen.get(type);
      if (warter && warter.length > 0) {
        warter.shift()!(view);
      } else {
        const liste = puffer.get(type) ?? [];
        liste.push(view);
        puffer.set(type, liste);
      }

      if (type === P.PeerInfo) resolvePromise(client);
    });
    ws.on('error', reject);
  });
}

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

/** Erste PlayerState-Nachricht abwarten und die Server-Spawnposition daraus lesen. */
async function holeSpawn(client: TestClient): Promise<{ x: number; y: number; z: number }> {
  const view = await client.naechstes(P.PlayerState);
  return {
    x: view.getFloat32(8, true),
    y: view.getFloat32(12, true),
    z: view.getFloat32(16, true),
  };
}

function summeMenge(inventarJson: string, itemName: string): number {
  const eintraege = JSON.parse(inventarJson) as Array<{ name: string; stack: number }>;
  return eintraege.filter((e) => e.name === itemName).reduce((sum, e) => sum + e.stack, 0);
}

/** [1]+[2]+[5]: Erstbefuellung genau einmal, Nehmen/Legen konserviert die Menge, Speichern/Laden. */
async function testErstbefuellungUmschichtenPersistenz(): Promise<void> {
  console.log('\n[1] Erstbefuellung, Umschichten, Persistenz:');
  const PORT = 2551;
  const WORLD_NAME = 'f1-a';
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: WORLD_NAME });
  server.start();
  const chestDef = server.prefabs.getByName('piece_chest_wood')!;

  const client = await verbindeClient(PORT, 'Spieler-A');
  const spawn = await holeSpawn(client);
  // Login schickt sofort einen InventorySync mit der SERVERSEITIGEN
  // Startausruestung (WovServer onPeerAuthenticated: u. a. 12x Wood) —
  // abholen als Ausgangsbasis. Ein Test, der hier 0 annaehme, waere von
  // wuerfleTruhe()s Zufallswahl abhaengig (faellt sie auf ein Item aus der
  // Startausruestung, z. B. Wood, stimmt die Annahme nicht mehr).
  const [invJsonStart] = readString(await client.naechstes(P.InventorySync), 0);
  const chest = server.zdos.createZDO(chestDef.hash, { ...spawn });

  // Erste Beruehrung: wuerfleTruhe() befuellt die Truhe als echten Inhalt.
  sendInteract(client.ws, spawn.x, spawn.y, spawn.z, chestDef.hash);
  const ergebnis1 = await client.naechstes(P.InteractResult);
  check('erste Oeffnung: ok', ergebnis1.getUint8(0) !== 0);
  const sync1 = parseContainerSync(await client.naechstes(P.ContainerSync));
  check('erste Oeffnung: dieselbe ZDOID wie die angelegte Truhe', sync1.id === chest.zdoid.id);
  const inv1 = unpackContainer(sync1.json);
  check('Erstbefuellung: genau ein Posten', inv1.all.length === 1, sync1.json);
  const posten = inv1.all[0]!;
  check('Erstbefuellung: positive Menge', posten.stack > 0, `${posten.stack}`);
  const startMenge = summeMenge(invJsonStart, posten.shared.name);

  // Zweite Beruehrung (derselbe Peer): kein erneutes Wuerfeln.
  sendInteract(client.ws, spawn.x, spawn.y, spawn.z, chestDef.hash);
  await client.naechstes(P.InteractResult);
  const sync2 = parseContainerSync(await client.naechstes(P.ContainerSync));
  check(
    'zweite Oeffnung: Inhalt unveraendert (Erstbefuellung genau einmal)',
    sync2.json === sync1.json,
    `${sync2.json} vs ${sync1.json}`
  );

  // Nehmen: ganzen Posten aus der Truhe entnehmen.
  sendContainerAction(client.ws, sync2.userId, sync2.id, 0, posten.shared.name, posten.stack);
  const syncNehmen = parseContainerSync(await client.naechstes(P.ContainerSync));
  const invSyncNehmen = await client.naechstes(P.InventorySync);
  const [invJsonNehmen] = readString(invSyncNehmen, 0);
  check('Nehmen: Truhe leer', unpackContainer(syncNehmen.json).all.length === 0, syncNehmen.json);
  check(
    'Nehmen: Menge beim Spieler um den entnommenen Posten gewachsen',
    summeMenge(invJsonNehmen, posten.shared.name) === startMenge + posten.stack,
    `${summeMenge(invJsonNehmen, posten.shared.name)}, erwartet ${startMenge + posten.stack} (Start ${startMenge} + ${posten.stack})`
  );

  // Legen: denselben Posten wieder in die Truhe zurueck.
  sendContainerAction(client.ws, sync2.userId, sync2.id, 1, posten.shared.name, posten.stack);
  const syncLegen = parseContainerSync(await client.naechstes(P.ContainerSync));
  const invSyncLegen = await client.naechstes(P.InventorySync);
  const [invJsonLegen] = readString(invSyncLegen, 0);
  check(
    'Legen: Truhe wieder wie zu Beginn — Menge konserviert (Nehmen+Legen = Summe gleich)',
    syncLegen.json === sync1.json,
    `${syncLegen.json} vs ${sync1.json}`
  );
  check(
    'Legen: beim Spieler wieder auf dem Ausgangsstand (Nehmen+Legen = Summe gleich)',
    summeMenge(invJsonLegen, posten.shared.name) === startMenge,
    `${summeMenge(invJsonLegen, posten.shared.name)}, erwartet ${startMenge}`
  );

  // [5] Persistenz: speichern, Server anhalten, mit frischem (init()-only,
  // wie g2-persistence.ts) Server denselben Spielstand laden.
  server.saveWorld();
  client.ws.close();
  server.stop();

  const server2 = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: WORLD_NAME });
  server2.init();
  const reloaded = server2.zdos.getZDO(ZDOID.fromTuple(sync2.userId, sync2.id));
  check('Persistenz: Truhe nach Neuladen vorhanden', reloaded !== undefined);
  const reloadedJson = reloaded?.getString(TRUHE_INHALT_MEMBER) ?? '';
  check(
    'Persistenz: Inhalt uebersteht Speichern/Laden unveraendert',
    reloadedJson === sync1.json,
    `${reloadedJson} vs ${sync1.json}`
  );
}

/** [3]: eine bereits geplünderte Alt-Truhe (nur das Bit, kein Inhalt-Member) startet leer. */
async function testAltTrucheGepluendertStartetLeer(): Promise<void> {
  console.log('\n[2] Alt-Truhe (bereits geplündert) startet leer:');
  const PORT = 2552;
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'f1-b' });
  server.start();
  const chestDef = server.prefabs.getByName('piece_chest_wood')!;

  const client = await verbindeClient(PORT, 'Spieler-B');
  const spawn = await holeSpawn(client);

  // Alt-Save-Fixtur: NUR das 1-Bit-Flag gesetzt, kein TRUHE_INHALT_MEMBER —
  // exakt der Zustand eines Saves von VOR diesem Umbau.
  const chest = server.zdos.createZDO(chestDef.hash, { ...spawn });
  chest.setInt(TRUHE_LOOTED_MEMBER, 1);

  sendInteract(client.ws, spawn.x, spawn.y, spawn.z, chestDef.hash);
  await client.naechstes(P.InteractResult);
  const sync = parseContainerSync(await client.naechstes(P.ContainerSync));
  check('Alt-Truhe (geplündert): startet leer', unpackContainer(sync.json).all.length === 0, sync.json);

  client.ws.close();
  server.stop();
}

/** [4]: ein Spieler ausserhalb der Reichweite wird abgewiesen. */
async function testAusserReichweiteAbgewiesen(): Promise<void> {
  console.log('\n[3] Ausserhalb der Reichweite:');
  const PORT = 2553;
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'f1-c' });
  server.start();
  const chestDef = server.prefabs.getByName('piece_chest_wood')!;

  const client = await verbindeClient(PORT, 'Spieler-C');
  const spawn = await holeSpawn(client);

  // Truhe 500 m entfernt — weit ausserhalb der 6-m-Reichweitenpruefung.
  // ContainerAction traegt (anders als Interact) gar keine
  // Positionsangabe, die ein Client faelschen koennte — geprueft wird
  // hier also handleContainerAction's EIGENE Distanzpruefung gegen die
  // echte ZDO-Position und die echte, servergefuehrte Peer-Position.
  const chest = server.zdos.createZDO(chestDef.hash, { x: spawn.x + 500, y: spawn.y, z: spawn.z });

  sendContainerAction(client.ws, chest.zdoid.userId.toString(), chest.zdoid.id, 0, 'Wood', 1);
  const antwort = await client.naechstes(P.InteractResult);
  const ok = antwort.getUint8(0) !== 0;
  const [meldung] = readString(antwort, 1);
  check('ausser Reichweite: abgewiesen (ok=false)', !ok, meldung);
  check('ausser Reichweite: Meldung "Zu weit weg"', meldung === 'Zu weit weg', meldung);

  client.ws.close();
  server.stop();
}

async function main(): Promise<void> {
  try {
    await testErstbefuellungUmschichtenPersistenz();
    await testAltTrucheGepluendertStartetLeer();
    await testAusserReichweiteAbgewiesen();
  } catch (err) {
    console.error('FAIL:', err);
    failures++;
  } finally {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    if (failures > 0) {
      console.error(`\n=== F1: ${failures} CHECK(S) FAILED ===`);
    } else {
      console.log('\n=== F1: ALLE TRUHEN-CHECKS BESTANDEN ===');
    }
    process.exit(failures > 0 ? 1 : 0);
  }
}

main();
