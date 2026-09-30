/**
 * F6 — zweite AoI-Schicht: der ferne Teil des Sichtfensters im halben Takt.
 *
 * Ring 0–1 (3×3 Zonen) wird jeden Tick geprueft, alles dahinter nur in jedem
 * 2. Tick (Phase deterministisch, Paritaet eines Tickzaehlers). Zerstoerungen
 * gehen jeden Tick raus. Alles in-process ueber den privaten `syncZDOs` (Peers
 * mit gefaelschtem Socket, wie f2-sync-deckel.ts) und den ECHTEN Client-Parser
 * (wie d6-zdo-delta.ts). Alle Schranken sind feste Zahlen, keine Modulkonstanten.
 *
 * Geprueft wird (Zeugen in Zahlen):
 *  1. Ring 0: eine Aenderung kommt im naechsten Tick an, immer (100 Laeufe
 *     mit zufaelligem Tick-Versatz).
 *  2. Ring 3 und Ring 4: Aenderung in hoechstens 2 Ticks (je 100 Laeufe); bei
 *     einer Aenderung JEDEN Tick tragen in 40 Ticks hoechstens 20 Pakete
 *     Ring-3-Saetze (vor F6: 40).
 *  3. Zugang in Ring 4: hoechstens 2 Ticks.
 *  4. Zerstoerung in Ring 2 und Ring 4 kommt im NAECHSTEN Tick (20 Laeufe mit
 *     zufaelliger Phase; wuerden Zerstoerungen nur mit dem fernen Teil gehen,
 *     waere jeder zweite Lauf verspaetet).
 *  5. Leerlauf: die Zahl der Pruefungen je 40 Ticks liegt zwischen 45 % und
 *     65 % des Vollfensters (vor F6: 100 %; ferner Teil nie: ~10 %).
 *  6. Erstuebertragung nach Zonenwechsel und nach Weltwechsel: alle Gruppen im
 *     ersten Tick voll (Saetze je Gruppe gezaehlt).
 *  7. Bytes je Peer (Metriken.syncBytesJePeerLaufend) = am Socket gezaehlte Bytes.
 *  8. 25 Peers, 48.000 ZDOs: Bytes je Peer und Sekunde sowie Ø tickSyncMs
 *     (nur Ausgabe, keine Schranke).
 *
 * Lauf: node_modules/.bin/tsx server/test/f6-aoi-ringe.ts   (aus dem Repo-Stamm)
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getStableHash } from '@wov/shared';
import { worldToZone } from '../src/zdo/ZDOManager.js';
import { createWovServer } from '../src/WovServer.js';
import { Peer } from '../src/net/Peer.js';
import * as Metriken from '../src/Metriken.js';
import type { ZDO } from '../src/zdo/ZDO.js';
import { BinaryReader } from '../../client/src/net/GameSocket';
import { parseZDOSync, ZDOSpiegel } from '../../client/src/net/ZDOSync';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const wurzel = mkdtempSync(join(tmpdir(), 'f6-aoi-ringe-'));

interface FakeSocket {
  readyState: number;
  bufferedAmount: number;
  send(buf: Buffer): void;
  pakete: Buffer[];
}
function fakeSocket(): FakeSocket {
  return {
    readyState: 1,
    bufferedAmount: 0,
    pakete: [],
    send(buf: Buffer) {
      this.pakete.push(buf);
    },
  };
}

type Intern = {
  net: { getPeers: () => readonly Peer[] };
  syncZDOs(): void;
};

/** Ring (Chebyshev-Abstand in Zonen) eines ZDO zur Zone des Peers. */
function ringVon(peer: Peer, zdo: ZDO): number {
  const pz = worldToZone(peer.position);
  const zz = worldToZone(zdo.position);
  return Math.max(Math.abs(zz.x - pz.x), Math.abs(zz.y - pz.y));
}
const gruppeVon = (ring: number): number => (ring <= 1 ? 0 : ring <= 3 ? 1 : 2);

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldSeed: 'KxSYuZquuw',
    worldFeatures: false,
    worldsDir: join(wurzel, 'welten'),
    kontenDir: join(wurzel, 'konten'),
    worldName: 'f6-aoi-ringe',
    saveIntervalMs: 3600_000,
  });
  server.init();
  const intern = server as unknown as Intern;
  const zdos = server.zdos;
  const kiPine = getStableHash('KiPine2');

  const peers: Peer[] = [];
  intern.net.getPeers = () => peers;
  let nextUser = 5000n;
  const spiegel = new Map<Peer, ZDOSpiegel>();
  const socks = new Map<Peer, FakeSocket>();
  function neuerPeer(x: number, z: number): Peer {
    const sock = fakeSocket();
    const peer = new Peer(sock as never, `P${nextUser}`, nextUser++);
    peer.position = { x, y: 0, z };
    spiegel.set(peer, new ZDOSpiegel());
    socks.set(peer, sock);
    return peer;
  }

  /** Ein Tick; liefert die vom Client-Parser gelesenen Saetze/Zerstoerungen dieses Ticks. */
  function tick(peer: Peer): { keys: string[]; destroyed: string[]; pakete: number } {
    const sock = socks.get(peer)!;
    const vorher = sock.pakete.length;
    intern.syncZDOs();
    const keys: string[] = [];
    const destroyed: string[] = [];
    for (const p of sock.pakete.slice(vorher)) {
      const nutz = p.subarray(1);
      const ab = nutz.buffer.slice(nutz.byteOffset, nutz.byteOffset + nutz.byteLength);
      const r = parseZDOSync(new BinaryReader(ab as ArrayBuffer), '', spiegel.get(peer)!);
      for (const u of r.updates) keys.push(u.key);
      destroyed.push(...r.destroyed);
    }
    return { keys, destroyed, pakete: sock.pakete.length - vorher };
  }
  const schluessel = (z: ZDO): string => `${z.zdoid.userId}:${z.zdoid.id}`;

  // ── Welt: 22×22 Zonen, je 2 Fueller (Fenster 9×9 = 162 Saetze, passt ins Budget) ──
  const ZONEN = 22;
  const ORIGIN = 40 * 64;
  for (let zx = 0; zx < ZONEN; zx++) {
    for (let zy = 0; zy < ZONEN; zy++) {
      for (let k = 0; k < 2; k++) {
        zdos.createZDO(kiPine, { x: ORIGIN + zx * 64 + 10 + k * 30, y: 0, z: ORIGIN + zy * 64 + 10 + k * 30 });
      }
    }
  }
  const mitteX = ORIGIN + 11 * 64 + 32;
  const mitteZ = ORIGIN + 11 * 64 + 32;
  const peer = neuerPeer(mitteX, mitteZ);
  peers.push(peer);
  const pz = worldToZone(peer.position);
  const sondeIn = (ring: number, dx = 1): ZDO =>
    zdos.createZDO(kiPine, { x: (pz.x + ring * dx) * 64 + 32, y: 0, z: pz.y * 64 + 32 });
  const r0 = sondeIn(0);
  const r3 = sondeIn(3);
  const r4 = sondeIn(4);
  check('Sonden liegen in Ring 0 / 3 / 4', ringVon(peer, r0) === 0 && ringVon(peer, r3) === 3 && ringVon(peer, r4) === 4);

  // Konvergenz
  let konv = 0;
  while (konv < 200 && !(peer.syncStand(r0.zdoid) && peer.syncStand(r3.zdoid) && peer.syncStand(r4.zdoid))) {
    tick(peer);
    konv++;
  }
  for (let i = 0; i < 10; i++) tick(peer);
  console.log(`  Fenster konvergiert nach ${konv} Ticks`);

  let zufall = 987654321;
  const rnd = (): number => {
    zufall = (zufall * 1664525 + 1013904223) >>> 0;
    return zufall / 4294967296;
  };
  const aendere = (z: ZDO, wert: number): void => {
    z.setInt('probe', wert);
    z.revision.reviseData();
  };

  // ── [1] Ring 0: immer im naechsten Tick ──
  console.log('\n[1] Ring 0 (100 Laeufe, zufaelliger Tick-Versatz):');
  {
    let fehl = 0;
    let wert = 1;
    for (let lauf = 0; lauf < 100; lauf++) {
      const leer = Math.floor(rnd() * 4);
      for (let i = 0; i < leer; i++) tick(peer);
      aendere(r0, wert++);
      const t = tick(peer);
      if (!t.keys.includes(schluessel(r0))) fehl++;
    }
    check('Ring-0-Aenderung im naechsten Tick, 100/100', fehl === 0, `${fehl} verspaetet`);
  }

  // ── [2] Ring 3: hoechstens 2 Ticks; halber Takt ──
  console.log('\n[2] Ring 3:');
  {
    let max = 0;
    let wert = 1000;
    for (let lauf = 0; lauf < 100; lauf++) {
      const leer = Math.floor(rnd() * 4);
      for (let i = 0; i < leer; i++) tick(peer);
      aendere(r3, wert++);
      let n = 0;
      let da = false;
      while (!da && n < 10) {
        n++;
        da = tick(peer).keys.includes(schluessel(r3));
      }
      max = Math.max(max, da ? n : 99);
    }
    check('Ring-3-Aenderung in hoechstens 2 Ticks (100 Laeufe)', max <= 2, `laengste Wartezeit ${max} Ticks`);
    let mitRing3 = 0;
    for (let t = 0; t < 40; t++) {
      aendere(r3, wert++);
      if (tick(peer).keys.includes(schluessel(r3))) mitRing3++;
    }
    check('Aenderung jeden Tick: hoechstens jeder 2. Tick traegt Ring-3-Saetze', mitRing3 <= 20, `${mitRing3} von 40 Ticks (vor F6: 40)`);
  }

  // ── [3] Ring 4 ──
  console.log('\n[3] Ring 4:');
  {
    for (let i = 0; i < 6; i++) tick(peer);
    let saetze = 0;
    const ring4Schluessel = schluessel(r4);
    for (let t = 0; t < 40; t++) saetze += tick(peer).keys.filter((k) => k === ring4Schluessel).length;
    check('unveraendert: 0 Saetze in 40 Ticks', saetze === 0, `${saetze}`);

    // Zugang: neues ZDO in Ring 4
    let maxZugang = 0;
    for (let lauf = 0; lauf < 20; lauf++) {
      for (let i = 0; i < Math.floor(rnd() * 3); i++) tick(peer);
      const neu = sondeIn(4, lauf % 2 === 0 ? 1 : -1);
      let n = 0;
      let da = false;
      while (!da && n < 10) {
        n++;
        da = tick(peer).keys.includes(schluessel(neu));
      }
      maxZugang = Math.max(maxZugang, da ? n : 99);
    }
    check('Zugang in Ring 4 kommt in hoechstens 2 Ticks', maxZugang <= 2, `laengste Wartezeit ${maxZugang} Ticks`);

    // Reine Member-Aenderung (Zonenbestand gleich): hoechstens im naechsten Netz-Tick
    let maxMember = 0;
    let wert = 5000;
    for (let lauf = 0; lauf < 100; lauf++) {
      for (let i = 0; i < Math.floor(rnd() * 3); i++) tick(peer);
      aendere(r4, wert++);
      let n = 0;
      let da = false;
      while (!da && n < 40) {
        n++;
        da = tick(peer).keys.includes(ring4Schluessel);
      }
      maxMember = Math.max(maxMember, da ? n : 99);
    }
    check('Member-Aenderung in Ring 4 in hoechstens 2 Ticks', maxMember <= 2, `laengste Wartezeit ${maxMember} Ticks`);
  }

  // ── [4] Zerstoerung in Ring 2 und Ring 4 ──
  console.log('\n[4] Zerstoerung in Ring 2 und Ring 4:');
  {
    for (const ring of [2, 4]) {
      let maxZerst = 0;
      for (let lauf = 0; lauf < 20; lauf++) {
        const opfer = sondeIn(ring, lauf % 2 === 0 ? 1 : -1);
        for (let i = 0; i < 4; i++) tick(peer);
        for (let i = 0; i < lauf % 3; i++) tick(peer);
        zdos.destroyZDO(opfer.zdoid);
        let n = 0;
        let da = false;
        while (!da && n < 40) {
          n++;
          da = tick(peer).destroyed.includes(schluessel(opfer));
        }
        maxZerst = Math.max(maxZerst, da ? n : 99);
      }
      check(`Zerstoerung in Ring ${ring} kommt im naechsten Tick (20 Laeufe)`, maxZerst === 1, `laengste Wartezeit ${maxZerst} Ticks`);
    }
  }

  // ── [5] Leerlauf: Pruefungen ──
  console.log('\n[5] Pruefungen im Leerlauf:');
  {
    for (let i = 0; i < 6; i++) tick(peer);
    let pruefungen = 0;
    const orig = peer.syncStand.bind(peer);
    peer.syncStand = (id) => {
      pruefungen++;
      return orig(id);
    };
    for (let t = 0; t < 40; t++) tick(peer);
    peer.syncStand = orig;
    const pz2 = worldToZone(peer.position);
    const fensterGroesse = peer.fenster.hole(zdos, pz2.x, pz2.y, 4).length;
    const voll = fensterGroesse * 40;
    console.log(`  Fenster ${fensterGroesse} ZDOs, ${pruefungen} Pruefungen in 40 Ticks (voll: ${voll})`);
    check('Pruefungen in 40 Ticks zwischen 45 % und 65 % des Vollfensters', pruefungen < 0.65 * voll && pruefungen > 0.45 * voll, `${((pruefungen / voll) * 100).toFixed(0)} %`);
  }

  // ── [6] Erstuebertragung: alle Gruppen im ersten Tick voll ──
  console.log('\n[6] Erstuebertragung nach Zonenwechsel und Weltwechsel:');
  {
    const pro = (p: Peer, keys: string[]): number[] => {
      const zaehler = [0, 0, 0];
      const set = new Set(keys);
      const jetzt = worldToZone(p.position);
      for (const zdo of p.fenster.hole(zdos, jetzt.x, jetzt.y, 4)) {
        if (set.has(schluessel(zdo))) zaehler[gruppeVon(ringVon(p, zdo))]!++;
      }
      return zaehler;
    };
    const soll = (p: Peer): number[] => {
      const zaehler = [0, 0, 0];
      const jetzt = worldToZone(p.position);
      for (const zdo of p.fenster.hole(zdos, jetzt.x, jetzt.y, 4)) zaehler[gruppeVon(ringVon(p, zdo))]!++;
      return zaehler;
    };
    // Zonenwechsel um 6 Zonen: das neue Fenster ueberschneidet sich teilweise;
    // Erstuebertragung heisst hier: ZDOs, die der Peer noch nie sah, je Gruppe.
    peer.position = { x: mitteX + 6 * 64, y: 0, z: mitteZ };
    const unbekannt = [0, 0, 0];
    const jetztZ = worldToZone(peer.position);
    for (const zdo of peer.fenster.hole(zdos, jetztZ.x, jetztZ.y, 4)) {
      if (!peer.syncStand(zdo.zdoid)) unbekannt[gruppeVon(ringVon(peer, zdo))]!++;
    }
    const ersterTick = pro(peer, tick(peer).keys);
    console.log(`  nach Zonenwechsel: unbekannt je Gruppe ${JSON.stringify(unbekannt)}, im ersten Tick gesendet ${JSON.stringify(ersterTick)}`);
    check(
      'nach Zonenwechsel: alle unbekannten ZDOs aller Gruppen im ersten Tick',
      unbekannt.every((n) => n > 0) && ersterTick[0] === unbekannt[0] && ersterTick[1] === unbekannt[1] && ersterTick[2] === unbekannt[2]
    );

    peer.weltWechselVorbereiten();
    const erwartetW = soll(peer);
    const t = tick(peer);
    const ersterW = pro(peer, t.keys);
    console.log(`  nach Weltwechsel, Saetze je Gruppe im ersten Tick ${JSON.stringify(ersterW)} (Fenster ${JSON.stringify(erwartetW)})`);
    check(
      'nach Weltwechsel: jede Gruppe komplett im ersten Tick',
      ersterW[0] === erwartetW[0] && ersterW[1] === erwartetW[1] && ersterW[2] === erwartetW[2]
    );
    // Nach dem Zonenwechsel ebenfalls: nach 2 weiteren Ticks ist alles da (Fenster vollstaendig)
    peer.position = { x: mitteX - 4 * 64, y: 0, z: mitteZ - 4 * 64 };
    peer.weltWechselVorbereiten();
    const t3 = tick(peer);
    const ersterZ = pro(peer, t3.keys);
    const erwartetZ = soll(peer);
    check(
      'Zonen- plus Weltwechsel: jede Gruppe komplett im ersten Tick',
      ersterZ[0] === erwartetZ[0] && ersterZ[1] === erwartetZ[1] && ersterZ[2] === erwartetZ[2],
      JSON.stringify(ersterZ)
    );
  }

  // ── [7] Bytes je Peer ──
  console.log('\n[7] Bytes je Peer:');
  {
    const laufend = (Metriken as unknown as { syncBytesJePeerLaufend?: () => ReadonlyMap<string, number> }).syncBytesJePeerLaufend;
    const sock = socks.get(peer)!;
    const socketBytes = sock.pakete.reduce((s, p) => s + p.length, 0);
    const gezaehlt = laufend?.().get(peer.verbindungsId) ?? -1;
    check('Zaehler je Peer vorhanden und gleich den am Socket gesendeten Bytes', gezaehlt === socketBytes, `Zaehler ${gezaehlt} B, Socket ${socketBytes} B`);
  }

  // ── [8] 25 Peers, 48.000 ZDOs ──
  console.log('\n[8] 25 Peers, 48.000 ZDOs, 0,5 % und 5 % Aenderungen je Tick (nur Ausgabe):');
  {
    peers.length = 0;
    const FLAECHE = 24 * 64;
    const BASIS = 100 * 64;
    const alle: ZDO[] = [];
    for (let i = 0; i < 48_000; i++) alle.push(zdos.createZDO(kiPine, { x: BASIS + rnd() * FLAECHE, y: 0, z: BASIS + rnd() * FLAECHE }));
    const gruppe: Peer[] = [];
    for (let i = 0; i < 25; i++) {
      const p = neuerPeer(BASIS + FLAECHE / 2 + ((i % 5) - 2) * 64, BASIS + FLAECHE / 2 + (Math.floor(i / 5) - 2) * 64);
      gruppe.push(p);
      peers.push(p);
    }
    let still = 0;
    let zaehle = -1;
    for (let t = 0; t < 400 && still < 3; t++) {
      intern.syncZDOs();
      const jetzt = gruppe.reduce((s, p) => s + socks.get(p)!.pakete.length, 0);
      still = jetzt === zaehle ? still + 1 : 0;
      zaehle = jetzt;
    }
    let proPeerProSek = 0;
    for (const aenderungen of [240, 2400]) {
      const startBytes = gruppe.map((p) => socks.get(p)!.pakete.reduce((s, q) => s + q.length, 0));
      const N = 100;
      let zeitMs = 0;
      for (let t = 0; t < N; t++) {
        for (let k = 0; k < aenderungen; k++) aendere(alle[Math.floor(rnd() * alle.length)]!, t * 10000 + k);
        const t0 = performance.now();
        intern.syncZDOs();
        zeitMs += performance.now() - t0;
      }
      const bytes = gruppe.map((p, i) => socks.get(p)!.pakete.reduce((s, q) => s + q.length, 0) - startBytes[i]!);
      proPeerProSek = bytes.reduce((s, b) => s + b, 0) / gruppe.length / (N / 20);
      console.log(`  ${aenderungen} Aenderungen je Tick (${((aenderungen / 480) ).toFixed(1)} %): Bytes je Peer und Sekunde ${proPeerProSek.toFixed(0)} B; Ø tickSyncMs ${(zeitMs / N).toFixed(2)} ms/Tick (${N} Ticks, 25 Peers)`);
      for (let t = 0; t < 60; t++) intern.syncZDOs(); // ausfuellen lassen
    }
    // Leerlauf: nichts aendert sich mehr, alles auf Stand (mehrere Durchlaeufe, Median).
    for (let t = 0; t < 10; t++) intern.syncZDOs();
    const leer: number[] = [];
    for (let lauf = 0; lauf < 5; lauf++) {
      const t1 = performance.now();
      for (let t = 0; t < 20; t++) intern.syncZDOs();
      leer.push((performance.now() - t1) / 20);
    }
    leer.sort((a, b) => a - b);
    console.log(`  Leerlauf (alles auf Stand): Median ${leer[2]!.toFixed(2)} ms/Tick (min ${leer[0]!.toFixed(2)}, max ${leer[4]!.toFixed(2)}, 5×20 Ticks, 25 Peers)`);
    check('Messung lief (Bytes > 0)', proPeerProSek > 0);
  }

  peers.length = 0;
  console.log(failures === 0 ? '\n=== F6 AoI-Ringe: ALLES BESTANDEN ===' : `\n=== F6 AoI-Ringe: ${failures} FEHLGESCHLAGEN ===`);
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => {
    rmSync(wurzel, { recursive: true, force: true });
    process.exit(failures === 0 ? 0 : 1);
  });
