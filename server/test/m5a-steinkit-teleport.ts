/**
 * Rot-Test fuer M5a — das Teleport-Paket traegt das dokumenteigene
 * Steinmaterial (1.0-Dokumente) hinter `layoutJson`.
 * Red test for M5a — the teleport packet carries the document's own stone
 * material (1.0 documents) behind `layoutJson`.
 *
 *   npx tsx server/test/m5a-steinkit-teleport.ts   (aus dem Repo-Wurzelverzeichnis)
 *
 * Nachgebaut nach dem Muster von `g9-dungeon2-e2e.ts` (echte Leitung,
 * derselbe Drahtformat-Helfer `leseTeleport`, hier um ein Feld ERWEITERT:
 * einen JSON-String HINTER `layoutJson`, der das dokumenteigene `steinKit`
 * traegt — Feld 12 in der ansteigenden Kette der angehaengten Felder).
 * Modeled on `g9-dungeon2-e2e.ts` (real wire, same wire helper, extended by
 * one field: a JSON string BEHIND `layoutJson` carrying the document's own
 * `steinKit`).
 *
 * VOR DER UMSETZUNG ROT, weil:
 *   - `DungeonManager.upsertDocument()` das `steinKit`-Feld noch nicht kennt
 *     (`sanitizeDungeonDocument` verwirft es derzeit ungeprueft) — das
 *     gespeicherte Dokument traegt es also gar nicht erst.
 *   - `teleportPeer()`/`enterDungeon()` haengen noch keinen JSON-String
 *     hinter `layoutJson` an — die Leitung endet dort, wo sie heute endet.
 *
 * NACH DER UMSETZUNG GRUEN, OHNE AENDERUNG an diesem Test.
 *
 * Geprueft wird:
 *  1. Ein 1.0-Dokument (`DG_StoneVault`, `createGenerated`) OHNE `steinKit`
 *     liefert im Teleport-Paket einen LEEREN String hinter `layoutJson`.
 *  2. Dasselbe Dokument MIT `steinKit` ({wandTextur: stein_moos,
 *     verwitterung.moos 2}) liefert im Teleport-Paket genau dieses
 *     `steinKit` als JSON.
 *  3. Ein 2.0-Dokument liefert ebenfalls einen leeren String, und alle
 *     vorherigen Felder (Thema, Seeds, Pruefsumme, ambientLicht,
 *     layoutJson) bleiben unveraendert.
 */

import WebSocket from 'ws';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWovServer } from '../src/WovServer.js';
// Dieselbe Lehre wie in g9: die Handshake-Antwort MUSS ueber die
// Produktivfunktion laufen. / Same lesson as in g9.
import { antwortBerechnen } from '../src/net/Identitaet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-m5a-steinkit');
/** Eigener Port — nicht 2467 (DEV), nicht 2498/2499 (g6/g9). */
const PORT = 2520;
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

// ── Drahtformat-Helfer (wie g9) / wire helpers (as in g9) ────────────────────

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
  /**
   * ANNAHME dieses Tests (s. Kommentar oben): ein JSON-String HINTER
   * `layoutJson` mit dem dokumenteigenen `steinKit`. Existiert vor der
   * Umsetzung noch nicht — bleibt dann schlicht '' (view zu Ende).
   * ASSUMPTION of this test: a JSON string BEHIND `layoutJson`. Does not
   * exist before implementation — stays '' (view runs out).
   */
  steinKitJson: string;
}

/**
 * Das Teleportpaket lesen — GENAU in der Reihenfolge des Clients, ERWEITERT
 * um das (noch nicht existierende) `steinKit`-Feld hinter `layoutJson`.
 * `view` beginnt HINTER dem Typbyte (wie in g9).
 */
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
    // Das ERWARTETE Feld dieses Tests — hinter `layoutJson`.
    if (p < view.byteLength) {
      [steinKitJson, p] = readString(view, p);
    }
  }
  return { drin, dungeonId, thema, pruefsumme, ambientLicht, layoutJson, steinKitJson };
}

function sendAdmin(ws: WebSocket, line: string): void {
  ws.send(Buffer.from([P.AdminCommand, ...writeString(line)]));
}

const ID_OHNE_KIT = 'stonevault-ohne-kit-m5a';
const ID_MIT_KIT = 'stonevault-mit-kit-m5a';
const ID_ZWEI = 'steingrab-zwei-m5a';

/** Das erwartete `steinKit` — genau das, was in Punkt (2) verlangt ist. */
const ERWARTETES_STEINKIT = {
  wandTextur: '/assets/models/stein_moos.png',
  verwitterung: { moos: 2, frost: 0, nass: 0 },
};

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  const server = createWovServer({
    port: PORT,
    worldsDir: resolve(TMP, 'worlds'), kontenDir: resolve(TMP, 'konten'),
    saveIntervalMs: 3600_000,
  });
  server.start();

  const dungeons = server.dungeons;

  // ── Dokumente anlegen ──────────────────────────────────────────────────

  const ohneKit = dungeons.createGenerated('DG_StoneVault', 111, ID_OHNE_KIT);
  pruefe('1.0-Dokument ohne steinKit angelegt', ohneKit !== null);

  const basis = dungeons.createGenerated('DG_StoneVault', 222, ID_MIT_KIT);
  pruefe('1.0-Dokument (Basis für steinKit) angelegt', basis !== null);
  if (basis) {
    const mitKit = { ...basis, steinKit: ERWARTETES_STEINKIT };
    const erg = dungeons.upsertDocument(mitKit);
    pruefe('1.0-Dokument mit steinKit gespeichert', erg !== null);
  }

  const zwei = dungeons.erzeugeDungeon2(
    'steingrab',
    { architektur: 333, material: 444, deko: 555 },
    ID_ZWEI
  );
  pruefe('2.0-Dokument angelegt', zwei !== null);

  if (!ohneKit || !basis || !zwei) {
    console.log('m5a-steinkit-teleport: ABBRUCH — Dokumente nicht anlegbar');
    server.stop();
    process.exit(1);
  }

  // ── Über die Leitung besuchen: ohne Kit, mit Kit, 2.0 ─────────────────

  const REIHENFOLGE = [ID_OHNE_KIT, ID_MIT_KIT, ID_ZWEI];
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
            ...writeString('SteinKitRunner'),
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

  // ── (1) 1.0 ohne steinKit ───────────────────────────────────────────────

  const tpOhne = teleports.get(ID_OHNE_KIT);
  pruefe('Teleport für das Dokument ohne steinKit kam an', tpOhne !== undefined);
  if (tpOhne) {
    pruefeGleich(
      'Ohne steinKit: leerer String hinter layoutJson',
      tpOhne.steinKitJson,
      ''
    );
  }

  // ── (2) 1.0 mit steinKit ────────────────────────────────────────────────

  const tpMit = teleports.get(ID_MIT_KIT);
  pruefe('Teleport für das Dokument MIT steinKit kam an', tpMit !== undefined);
  if (tpMit) {
    pruefe(
      'Mit steinKit: der String hinter layoutJson ist NICHT leer',
      tpMit.steinKitJson.length > 0,
      `steinKitJson.length=${tpMit.steinKitJson.length}`
    );
    let geparst: Record<string, unknown> | null = null;
    try {
      geparst = tpMit.steinKitJson.length > 0
        ? (JSON.parse(tpMit.steinKitJson) as Record<string, unknown>)
        : null;
    } catch {
      geparst = null;
    }
    pruefe(
      'Der String ist gültiges JSON',
      geparst !== null,
      `roh: ${JSON.stringify(tpMit.steinKitJson)}`
    );
    pruefeGleich(
      'Er trägt die erwartete wandTextur',
      geparst?.wandTextur,
      ERWARTETES_STEINKIT.wandTextur
    );
    const verwitterung = geparst?.verwitterung as { moos?: number } | undefined;
    pruefeGleich(
      'Er trägt die erwartete Verwitterung (moos)',
      verwitterung?.moos,
      ERWARTETES_STEINKIT.verwitterung.moos
    );
  }

  // ── (3) 2.0-Dokument: leer, und alle vorherigen Felder unverändert ──────

  const tpZwei = teleports.get(ID_ZWEI);
  pruefe('Teleport für das 2.0-Dokument kam an', tpZwei !== undefined);
  if (tpZwei) {
    pruefeGleich('2.0: leerer String hinter layoutJson', tpZwei.steinKitJson, '');
    pruefeGleich('2.0: Dungeon-Kennung unverändert', tpZwei.dungeonId, ID_ZWEI);
    pruefeGleich('2.0: Thema unverändert', tpZwei.thema, 'steingrab');
    pruefeGleich('2.0: Prüfsumme unverändert', tpZwei.pruefsumme, zwei.pruefsumme);
    pruefeGleich('2.0: erzeugtes Grab trägt weiterhin kein layoutJson', tpZwei.layoutJson, '');
  }

  server.stop();
  rmSync(TMP, { recursive: true, force: true });

  console.log(`m5a-steinkit-teleport: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
  for (const f of fehlerListe) console.log(`  ROT  ${f}`);
  process.exit(fehlerListe.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('m5a-steinkit-teleport: ABBRUCH —', e);
  process.exit(1);
});
