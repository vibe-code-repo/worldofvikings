/**
 * Rot-Test — das Teleport-Paket traegt die Grundbeleuchtung auch fuer
 * 1.0-Dokumente (`DungeonDocument.ambientLicht`).
 * Red test — the teleport packet carries the base brightness for 1.0
 * documents too.
 *
 *   npx tsx server/test/licht-teleport.ts   (aus dem Repo-Wurzelverzeichnis)
 *
 * Nachgebaut nach `m5a-steinkit-teleport.ts` (echte Leitung, derselbe
 * Drahtformat-Helfer `leseTeleport`). NEU ist hier NICHT das Feld — das
 * Float32 hinter dem Namen gibt es seit Dokumentfassung 11 und der Server
 * schreibt es fuer JEDES Teleport-Paket. Neu ist, WAS darin steht: bisher
 * `deskriptor?.ambientLicht ?? 1`, also fuer jedes 1.0-Grab stumpf 1.
 *
 * VOR DER UMSETZUNG ROT, weil:
 *   - `sanitizeDungeonDocument` das Feld `ambientLicht` noch verwirft, das
 *     gespeicherte 1.0-Dokument es also gar nicht erst traegt;
 *   - `enterDungeon()` fuer 1.0-Dokumente nichts in das Float schreibt —
 *     der Deskriptor ist dort `null`, und der Ersatzwert 1 gewinnt immer.
 *
 * NACH DER UMSETZUNG GRUEN, OHNE AENDERUNG an diesem Test.
 *
 * Geprueft wird:
 *  1. Ein 1.0-Dokument (`DG_StoneVault`) MIT `ambientLicht: 2.5` liefert im
 *     Teleport-Paket genau 2.5.
 *  2. Dasselbe Dokument OHNE das Feld liefert 1 (fehlend = wie bisher).
 *  3. Ein 2.0-Dokument bleibt unveraendert: Thema, Pruefsumme, layoutJson
 *     und die Grundhelligkeit aus dem Thema stehen wie zuvor.
 */

import WebSocket from 'ws';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWovServer } from '../src/WovServer.js';
// Dieselbe Lehre wie in g9/m5a: die Handshake-Antwort MUSS ueber die
// Produktivfunktion laufen. / Same lesson as in g9.
import { antwortBerechnen } from '../src/net/Identitaet.js';
// Die 2.0-Seite ausdruecklich ueber den 2.0-Namensraum: `ambientLichtVon`
// gibt es dann in BEIDEN Formaten, und ein blosser Namensimport waere hier
// stumm der falsche.
import { dungeon2 } from '@wov/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-licht-teleport');
/** Eigener Port — nicht 2467 (DEV), nicht 2498/2499 (g6/g9), nicht 2520 (m5a). */
const PORT = 2521;
const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  Teleport: 43,
  AdminCommand: 53,
  AdminEvent: 54,
  AuthChallenge: 68,
};

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

// ── Drahtformat-Helfer (wie m5a/g9) / wire helpers ───────────────────────────

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

function readVarInt(view: DataView, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = view.getUint8(pos++);
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [(result >>> 1) ^ -(result & 1), pos];
}

function readString(view: DataView, pos: number): [string, number] {
  const [len, p] = readVarInt(view, pos);
  const s = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + p, len));
  return [s, p + len];
}

interface TeleportPaket {
  drin: boolean;
  dungeonId: string;
  thema: string;
  pruefsumme: string;
  ambientLicht: number;
  layoutJson: string;
  steinKitJson: string;
}

/** Das Teleportpaket lesen — GENAU in der Reihenfolge des Clients. */
function leseTeleport(view: DataView): TeleportPaket {
  let p = 0;
  // pos (Vector3, 12 Byte)
  p += 12;
  const drin = view.getUint8(p++) !== 0;
  let dungeonId: string;
  [dungeonId, p] = readString(view, p);
  let env: string;
  [env, p] = readString(view, p);
  void env;
  let thema = '';
  let pruefsumme = '';
  let ambientLicht = 1;
  let layoutJson = '';
  let steinKitJson = '';
  if (p < view.byteLength) {
    [thema, p] = readString(view, p);
    p += 12; // architektur/material/deko (3x Int32)
    [pruefsumme, p] = readString(view, p);
    p += 4; // layoutVersion (Int32)
    let name: string;
    [name, p] = readString(view, p);
    void name;
    if (p + 4 <= view.byteLength) {
      ambientLicht = view.getFloat32(p, true);
      p += 4;
    }
    if (p < view.byteLength) {
      [layoutJson, p] = readString(view, p);
    }
    if (p < view.byteLength) {
      [steinKitJson, p] = readString(view, p);
    }
  }
  return { drin, dungeonId, thema, pruefsumme, ambientLicht, layoutJson, steinKitJson };
}

function sendAdmin(ws: WebSocket, line: string): void {
  ws.send(Buffer.from([P.AdminCommand, ...writeString(line)]));
}

const ID_OHNE_LICHT = 'stonevault-ohne-licht';
const ID_MIT_LICHT = 'stonevault-mit-licht';
const ID_ZWEI = 'steingrab-zwei-licht';

/** Der erwartete Wert — ausdruecklich UEBER 1 (heller als die Umgebung). */
const ERWARTETES_LICHT = 2.5;

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  const server = createWovServer({
    port: PORT,
    worldsDir: resolve(TMP, 'worlds'),
    saveIntervalMs: 3600_000,
  });
  server.start();

  const dungeons = server.dungeons;

  // ── Dokumente anlegen ──────────────────────────────────────────────────

  const ohneLicht = dungeons.createGenerated('DG_StoneVault', 111, ID_OHNE_LICHT);
  pruefe('1.0-Dokument ohne ambientLicht angelegt', ohneLicht !== null);

  const basis = dungeons.createGenerated('DG_StoneVault', 222, ID_MIT_LICHT);
  pruefe('1.0-Dokument (Basis für ambientLicht) angelegt', basis !== null);
  if (basis) {
    const mitLicht = { ...basis, ambientLicht: ERWARTETES_LICHT };
    const erg = dungeons.upsertDocument(mitLicht);
    pruefe('1.0-Dokument mit ambientLicht gespeichert', erg !== null);
    pruefeGleich(
      'Das gespeicherte Dokument trägt das Feld (Sanitizer hat es nicht verworfen)',
      erg?.doc.ambientLicht,
      ERWARTETES_LICHT
    );
  }

  const zwei = dungeons.erzeugeDungeon2(
    'steingrab',
    { architektur: 333, material: 444, deko: 555 },
    ID_ZWEI
  );
  pruefe('2.0-Dokument angelegt', zwei !== null);

  if (!ohneLicht || !basis || !zwei) {
    console.log('licht-teleport: ABBRUCH — Dokumente nicht anlegbar');
    server.stop();
    process.exit(1);
  }

  // ── Über die Leitung besuchen: ohne Licht, mit Licht, 2.0 ─────────────

  const REIHENFOLGE = [ID_OHNE_LICHT, ID_MIT_LICHT, ID_ZWEI];
  const teleports = new Map<string, TeleportPaket>();

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';

  let authSent = false;
  let schritt = 0;
  let drin = false;
  let fertig = false;

  await new Promise<void>((aufloesen, ablehnen) => {
    const uhr = setTimeout(
      () => ablehnen(new Error(`Zeitüberschreitung — schritt=${schritt}, drin=${drin}`)),
      30_000
    );
    const spaeter = (zeile: string): void => {
      setTimeout(() => sendAdmin(ws, zeile), 1100);
    };

    ws.on('message', (data: Buffer) => {
      const typ = data.readUInt8(0);
      const view = new DataView(data.buffer, data.byteOffset + 1, data.length - 1);

      if (typ === P.VersionCheck) {
        const pkt = Buffer.alloc(5);
        pkt.writeUInt8(P.VersionCheck, 0);
        pkt.writeInt32LE(2, 1);
        ws.send(pkt);
        return;
      }

      if (typ === P.AuthChallenge && !authSent) {
        authSent = true;
        const [nonce] = readString(view, 0);
        const antwort = antwortBerechnen(nonce, '');
        ws.send(
          Buffer.from([
            P.PasswordAuth,
            ...writeString(antwort),
            ...writeString('LichtRunner'),
            ...writeString(''),
          ])
        );
        return;
      }

      if (typ === P.PeerInfo) {
        spaeter(`dungeon enter ${REIHENFOLGE[0]}`);
        return;
      }

      if (typ === P.Teleport) {
        const tp = leseTeleport(view);
        if (tp.drin) {
          drin = true;
          const ziel = REIHENFOLGE[schritt];
          if (tp.dungeonId === ziel) teleports.set(ziel, tp);
          spaeter('dungeon leave');
        } else if (drin) {
          drin = false;
          schritt++;
          if (schritt >= REIHENFOLGE.length) {
            if (!fertig) {
              fertig = true;
              clearTimeout(uhr);
              aufloesen();
            }
            return;
          }
          spaeter(`dungeon enter ${REIHENFOLGE[schritt]}`);
        }
        return;
      }

      if (typ === P.AdminEvent) {
        let p = 0;
        let cmd: string;
        [cmd, p] = readString(view, p);
        const aktiv = view.getUint8(p++) !== 0;
        const [nachricht] = readString(view, p);
        if (!aktiv && /Unbekannt|fehlgeschlagen|Berechtigung/.test(nachricht)) {
          clearTimeout(uhr);
          ablehnen(new Error(`Admin-Befehl abgelehnt: ${cmd} — ${nachricht}`));
        }
      }
    });

    ws.on('error', (e) => {
      clearTimeout(uhr);
      ablehnen(e);
    });
  });

  ws.close();

  // ── (1) 1.0 mit ambientLicht ────────────────────────────────────────────

  const tpMit = teleports.get(ID_MIT_LICHT);
  pruefe('Teleport für das Dokument MIT ambientLicht kam an', tpMit !== undefined);
  if (tpMit) {
    pruefeGleich(
      'Mit ambientLicht: das Float trägt genau den Dokumentwert',
      tpMit.ambientLicht,
      ERWARTETES_LICHT
    );
    pruefeGleich('Mit ambientLicht: es bleibt ein 1.0-Grab (leeres Thema)', tpMit.thema, '');
  }

  // ── (2) 1.0 ohne ambientLicht ───────────────────────────────────────────

  const tpOhne = teleports.get(ID_OHNE_LICHT);
  pruefe('Teleport für das Dokument ohne ambientLicht kam an', tpOhne !== undefined);
  if (tpOhne) {
    pruefeGleich('Ohne ambientLicht: das Float ist 1 (wie bisher)', tpOhne.ambientLicht, 1);
  }

  // ── (3) 2.0-Dokument: unverändert ──────────────────────────────────────

  const tpZwei = teleports.get(ID_ZWEI);
  pruefe('Teleport für das 2.0-Dokument kam an', tpZwei !== undefined);
  if (tpZwei) {
    pruefeGleich('2.0: Dungeon-Kennung unverändert', tpZwei.dungeonId, ID_ZWEI);
    pruefeGleich('2.0: Thema unverändert', tpZwei.thema, 'steingrab');
    pruefeGleich('2.0: Prüfsumme unverändert', tpZwei.pruefsumme, zwei.pruefsumme);
    pruefeGleich('2.0: erzeugtes Grab trägt weiterhin kein layoutJson', tpZwei.layoutJson, '');
    pruefeGleich('2.0: kein steinKit', tpZwei.steinKitJson, '');
    // Der 2.0-Weg bleibt der 2.0-Weg: Der Wert kommt aus Dokument bzw. Thema,
    // NICHT aus dem neuen 1.0-Feld.
    pruefeGleich(
      '2.0: Grundhelligkeit weiterhin aus Dokument/Thema',
      Math.round(tpZwei.ambientLicht * 1000) / 1000,
      Math.round(dungeon2.ambientLichtVon(zwei) * 1000) / 1000
    );
  }

  server.stop();
  rmSync(TMP, { recursive: true, force: true });

  console.log(`licht-teleport: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
  for (const f of fehlerListe) console.log(`  ROT  ${f}`);
  process.exit(fehlerListe.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('licht-teleport: ABBRUCH —', e);
  process.exit(1);
});
