/**
 * F2 — Sync-Deckel: numerischer Schlüssel, Budget vor der Arbeit, Prüfdeckel
 * mit Cursor, Login-Zähler ohne Vollscan.
 *
 * Alles in-process, ohne Netz: ein Server mit ~48.000 ZDOs (24×24 Zonen, dicht
 * genug, dass ein Sichtfenster > 4096 ZDOs hat), Peers mit gefälschtem Socket
 * (`bufferedAmount` steuert das Sendebudget, `send` fängt die Pakete), und der
 * private `syncZDOs` wird direkt getickt.
 *
 * Geprüft wird (Zeugen in Zahlen):
 *  1. Im Sync (nach Konvergenz, ein voller Prüfdurchlauf) wird `ZDOID.toString()`
 *     kein einziges Mal aufgerufen. Vor F2: mindestens einmal je Fenster-ZDO.
 *  2. Kleines Budget: kein Paket ist größer als Budget + ein Satz, ein
 *     übergroßes ZDO kommt trotzdem an, und ALLE Fenster-ZDOs kommen in endlich
 *     vielen Ticks an.
 *  3. Der Deckel greift (geprüfte ZDOs je Tick ≤ N), das Fensterende wird
 *     trotzdem erreicht, und ein ganz hinten liegendes geändertes ZDO kommt in
 *     höchstens ceil(Fenster / N) + 1 Ticks an (kein Verhungern der hinteren Ringe).
 *  4. `zaehleEigeneBauten` = alter Vollscan-Wert (500 Bauten, zwei Besitzer, dazu
 *     Attrappen); Zeit alt gegen neu.
 * Dazu Tick-Zeiten mit 25 simulierten Spielern (nur Ausgabe, keine Schranke).
 *
 * Lauf: node_modules/.bin/tsx server/test/f2-sync-deckel.ts   (aus dem Repo-Stamm)
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getStableHash } from '@wov/shared';
import { BAU_PREFABS } from '@wov/shared';
import { worldToZone } from '../src/zdo/ZDOManager.js';
import { createWovServer } from '../src/WovServer.js';
import { Peer } from '../src/net/Peer.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOID } from '../src/zdo/ZDOID.js';
import type { ZDO } from '../src/zdo/ZDO.js';
import * as ZonenFensterModul from '../src/zdo/ZonenFenster.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// Vor F2 gibt es die Konstante nicht: dann gilt der Sollwert der Karte.
const DECKEL: number =
  (ZonenFensterModul as unknown as { SYNC_PRUEFUNGEN_MAX?: number }).SYNC_PRUEFUNGEN_MAX ?? 4096;

const wurzel = mkdtempSync(join(tmpdir(), 'f2-sync-deckel-'));

interface FakeSocket {
  readyState: number;
  bufferedAmount: number;
  send(buf: Buffer): void;
  pakete: Buffer[];
}
function fakeSocket(rueckstau: number): FakeSocket {
  const s: FakeSocket = {
    readyState: 1,
    bufferedAmount: rueckstau,
    pakete: [],
    send(buf: Buffer) {
      this.pakete.push(buf);
    },
  };
  return s;
}

type Intern = {
  net: { getPeers: () => readonly Peer[] };
  syncZDOs(): void;
  writeZDO(w: Writer, zdo: ZDO, peerRev: number | undefined, peer: Peer): void;
  zaehleEigeneBauten?: (peer: Peer) => number;
  zdosVon(peer: Peer): import('../src/zdo/ZDOManager.js').ZDOManager;
};

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldSeed: 'KxSYuZquuw',
    worldFeatures: false,
    worldsDir: join(wurzel, 'welten'),
    kontenDir: join(wurzel, 'konten'),
    worldName: 'f2-sync-deckel',
    saveIntervalMs: 3600_000,
  });
  server.init();
  const intern = server as unknown as Intern;
  const zdos = server.zdos;

  // ── Welt: 48.000 ZDOs auf 24×24 Zonen (83 je Zone; Fenster 9×9 = ~6.700) ──
  const kiPine = getStableHash('KiPine2');
  const t0 = performance.now();
  const FLAECHE = 24 * 64;
  let zufall = 12345;
  const rnd = (): number => {
    zufall = (zufall * 1664525 + 1013904223) >>> 0;
    return zufall / 4294967296;
  };
  for (let i = 0; i < 48_000; i++) {
    zdos.createZDO(kiPine, { x: rnd() * FLAECHE, y: 0, z: rnd() * FLAECHE });
  }
  console.log(`Welt gebaut: 48000 ZDOs in ${(performance.now() - t0).toFixed(0)} ms`);

  // Übergroßes ZDO in der Mitte (Vollstand mit ~6 KB), für die Budgetprobe.
  const MITTE = FLAECHE / 2;
  const fett = zdos.createZDO(kiPine, { x: MITTE, y: 0, z: MITTE });
  fett.setString('polster', 'x'.repeat(6000));

  const peers: Peer[] = [];
  intern.net.getPeers = () => peers;
  let nextUser = 1000n;
  function neuerPeer(rueckstau: number, x = MITTE, z = MITTE): { peer: Peer; sock: FakeSocket } {
    const sock = fakeSocket(rueckstau);
    const peer = new Peer(sock as never, `P${nextUser}`, nextUser++);
    peer.position = { x, y: 0, z };
    return { peer, sock };
  }
  function tick(): void {
    intern.syncZDOs();
  }
  /** Fenster-Liste des Peers (nur lesend; hole baut sie bei Bedarf auf). */
  function fensterVon(peer: Peer): readonly ZDO[] {
    const zone = worldToZone(peer.position);
    return peer.fenster.hole(zdos, zone.x, zone.y, 4);
  }
  // Zähler für Prüfungen (syncStand) und ZDOID.toString
  let pruefungen = 0;
  function zaehleSyncStand(peer: Peer): void {
    const orig = peer.syncStand.bind(peer);
    peer.syncStand = (id) => {
      pruefungen++;
      return orig(id);
    };
  }
  let toStringAufrufe = 0;
  const origToString = ZDOID.prototype.toString;
  function mitToStringZaehler<T>(fn: () => T): T {
    ZDOID.prototype.toString = function (this: ZDOID): string {
      toStringAufrufe++;
      return origToString.call(this);
    };
    try {
      return fn();
    } finally {
      ZDOID.prototype.toString = origToString;
    }
  }

  // Größe des größten Satzes (Vollstand) je ZDO des Fensters, für die Schranke
  function groessterSatz(peer: Peer, fenster: readonly ZDO[]): number {
    let max = 0;
    for (const z of fenster) {
      const w = new Writer(256);
      intern.writeZDO(w, z, undefined, peer);
      max = Math.max(max, w.geschrieben);
    }
    return max;
  }

  // ── [2] Kleines Budget: Größe + Vollständigkeit + Endlichkeit ────────────
  console.log('\n[2] Kleines Budget (Rückstau 8000 → Budget 2240):');
  {
    const { peer, sock } = neuerPeer(8000);
    peers.length = 0;
    peers.push(peer);
    const fenster = fensterVon(peer);
    const fensterZahl = fenster.length;
    const budget = 10240 - 8000;
    const maxSatz = groessterSatz(peer, fenster);
    console.log(`  Fenster ${fensterZahl} ZDOs, Budget ${budget} B, größter Satz ${maxSatz} B`);
    let maxPaket = 0;
    let ticks = 0;
    const alle = (): boolean => fenster.every((z) => peer.syncStand(z.zdoid) !== undefined);
    while (!alle() && ticks < 5000) {
      tick();
      ticks++;
      const letztes = sock.pakete[sock.pakete.length - 1];
      if (letztes) maxPaket = Math.max(maxPaket, letztes.length);
    }
    // Paket = Typ(1) + tick(4) + Anzahl(4) + Sätze + Zerstörungsanzahl(4)
    const schranke = 1 + 4 + 4 + budget + maxSatz + 4;
    check('kein Paket größer als Budget + ein Satz', maxPaket <= schranke, `max ${maxPaket} ≤ ${schranke}`);
    check('alle Fenster-ZDOs kamen an', alle(), `${ticks} Ticks für ${fensterZahl} ZDOs`);
    check('das übergroße ZDO kam an', peer.syncStand(fett.zdoid) !== undefined);
    check('endlich viele Ticks (< 5000)', ticks < 5000, `${ticks}`);
    // Genauer Zeuge zum „vor der Arbeit“: kein Paket überschreitet das Budget,
    // ohne dass sein LETZTER Satz der überschreitende ist — Paket ohne letzten
    // Satz liegt unter dem Budget. Wir messen: jedes Paket mit mehr als einem
    // Satz und Länge > Budget+Kopf ist höchstens um EINEN Satz über dem Budget.
    let ueberschreitend = 0;
    for (const p of sock.pakete) if (p.length > 1 + 4 + 4 + budget + 4) ueberschreitend++;
    console.log(`  Pakete ${sock.pakete.length}, davon über Budget: ${ueberschreitend}`);
  }

  // ── [1]+[3] Konvergenz mit vollem Budget, dann ein voller Prüfdurchlauf ──
  console.log('\n[1+3] Voller Prüfdurchlauf im Leerlauf:');
  {
    const { peer, sock } = neuerPeer(0);
    peers.length = 0;
    peers.push(peer);
    zaehleSyncStand(peer);
    const fenster = fensterVon(peer);
    const fensterZahl = fenster.length;
    console.log(`  Fenster: ${fensterZahl} ZDOs, Deckel N = ${DECKEL}`);
    check('Fenster größer als der Deckel (sonst beweist der Test nichts)', fensterZahl > DECKEL, `${fensterZahl}`);

    let ticks = 0;
    const alle = (): boolean => fenster.every((z) => peer.syncStand(z.zdoid) !== undefined);
    pruefungen = 0;
    while (!alle() && ticks < 3000) {
      tick();
      ticks++;
    }
    check('Erstübertragung des ganzen Fensters', alle(), `${ticks} Ticks`);
    void sock;

    // Leerlauf: alles auf Stand. Ein voller Durchlauf braucht ceil(Fenster/N) Ticks.
    const maxTicks = Math.ceil(fensterZahl / DECKEL) + 1;
    let maxJeTick = 0;
    let summe = 0;
    toStringAufrufe = 0;
    let gesamtTicks = 0;
    mitToStringZaehler(() => {
      for (let i = 0; i < maxTicks; i++) {
        pruefungen = 0;
        tick();
        gesamtTicks++;
        maxJeTick = Math.max(maxJeTick, pruefungen);
        summe += pruefungen;
      }
    });
    check('ZDOID.toString im Sync: 0 Aufrufe', toStringAufrufe === 0, `${toStringAufrufe} Aufrufe in ${gesamtTicks} Ticks`);
    check(`geprüfte ZDOs je Tick ≤ N (${DECKEL})`, maxJeTick <= DECKEL, `max ${maxJeTick}`);
    check('das Fensterende wird trotzdem erreicht', summe >= fensterZahl, `${summe} Prüfungen ≥ ${fensterZahl}`);

    // Cursor auf den Anfang laufen lassen, damit das Hinterste der Worst Case ist.
    for (let i = 0; i < maxTicks && peer.fenster.cursor !== 0; i++) tick();
    // Hinterstes ZDO ändern: muss in ≤ ceil(Fenster/N)+1 Ticks ankommen.
    const hinten = fenster[fenster.length - 1]!;
    hinten.setInt('probe', 7);
    hinten.revision.reviseData();
    const revHinten = hinten.revision.dataRevision;
    let bisHinten = 0;
    while (peer.syncStand(hinten.zdoid)?.dataRevision !== revHinten && bisHinten < 50) {
      tick();
      bisHinten++;
    }
    check(
      'hinterstes geändertes ZDO kommt an (kein Verhungern), aber erst nach dem Deckel',
      bisHinten <= maxTicks && bisHinten >= 2,
      `${bisHinten} Ticks (Schranke ${maxTicks})`
    );
    // Auch ein vorderes ZDO, während der Cursor irgendwo steht.
    const vorn = fenster[0]!;
    vorn.setInt('probe', 8);
    vorn.revision.reviseData();
    const revVorn = vorn.revision.dataRevision;
    let bisVorn = 0;
    while (peer.syncStand(vorn.zdoid)?.dataRevision !== revVorn && bisVorn < 50) {
      tick();
      bisVorn++;
    }
    check('vorderes geändertes ZDO kommt an', bisVorn <= maxTicks, `${bisVorn} Ticks (Schranke ${maxTicks})`);
  }

  // ── [4] Login-Zähler ──────────────────────────────────────────────────
  console.log('\n[4] Eigene Bauten zählen (Login):');
  {
    const bauNamen = [...BAU_PREFABS];
    const besitzerA = '4711';
    const besitzerB = '4712';
    const baue = (i: number, registrieren: boolean): ZDO => {
      const hash = getStableHash(bauNamen[i % bauNamen.length]!);
      const z = zdos.createZDO(hash, { x: (i % 50) * 5, y: 0, z: Math.floor(i / 50) * 5 });
      z.setInt('spieler', 1);
      z.setString('besitzer', i % 2 === 0 ? besitzerA : besitzerB);
      if (registrieren) zdos.registriereSpielerbau(z);
      return z;
    };
    // 300 Bauten VOR dem ersten Zählen (Index kommt aus dem Vollscan), ...
    const gebaut: ZDO[] = [];
    for (let i = 0; i < 300; i++) gebaut.push(baue(i, false));
    // Attrappen: Besitzer ohne spieler=1 (zählt nicht).
    for (let i = 0; i < 50; i++) {
      const z = zdos.createZDO(getStableHash(bauNamen[0]!), { x: 900 + i, y: 0, z: 900 });
      z.setString('besitzer', besitzerA);
    }
    const alt = (id: string): number =>
      zdos.getAllZDOs().filter((z) => z.getInt('spieler') === 1 && z.getString('besitzer') === id).length;
    check('Funktionen vorhanden', typeof intern.zaehleEigeneBauten === 'function' && typeof zdos.spielerbauten === 'function');
    if (typeof intern.zaehleEigeneBauten === 'function') {
      const zaehle = (id: bigint): number =>
        intern.zaehleEigeneBauten!.call(server, { userId: id, worldId: 'haupt' } as unknown as Peer);
      const gleich = (etikett: string): void => {
        const a = zaehle(BigInt(besitzerA));
        const b = zaehle(BigInt(besitzerB));
        check(
          `${etikett}: neu = alt (A ${alt(besitzerA)}, B ${alt(besitzerB)})`,
          a === alt(besitzerA) && b === alt(besitzerB),
          `neu A ${a}, B ${b}`
        );
      };
      gleich('300 Bauten, Index aus dem ersten Scan');
      // ... 200 weitere NACH dem ersten Zählen (registriert, wie handlePlacePiece), ...
      for (let i = 300; i < 500; i++) gebaut.push(baue(i, true));
      gleich('500 Bauten, 200 nachregistriert');
      check('Besitzer A = 250 und B = 250', zaehle(BigInt(besitzerA)) === 250 && zaehle(BigInt(besitzerB)) === 250);
      // ... und Abriss (destroyZDO führt den Index nach).
      for (let i = 0; i < 40; i++) zdos.destroyZDO(gebaut[i * 7]!.zdoid);
      gleich('nach 40 Abrissen');
      check('Fremder ohne Bauten: 0', zaehle(4713n) === 0 && alt('4713') === 0);

      const N = 200;
      let t = performance.now();
      for (let i = 0; i < N; i++) alt(besitzerA);
      const zeitAlt = (performance.now() - t) / N;
      t = performance.now();
      for (let i = 0; i < N; i++) zaehle(BigInt(besitzerA));
      const zeitNeu = (performance.now() - t) / N;
      console.log(`  Login-Zählung bei ${zdos.getAllZDOs().length} ZDOs: alt ${zeitAlt.toFixed(2)} ms, neu ${zeitNeu.toFixed(3)} ms`);
    }
  }

  // ── Tick-Zeiten mit 25 Spielern (nur Ausgabe) ──────────────────────────
  console.log('\n[Zeit] syncZDOs mit 25 Spielern:');
  {
    peers.length = 0;
    for (let i = 0; i < 25; i++) {
      const dx = ((i % 5) - 2) * 64;
      const dz = (Math.floor(i / 5) - 2) * 64;
      peers.push(neuerPeer(0, MITTE + dx, MITTE + dz).peer);
    }
    let ticksBisRuhe = 0;
    const tStart = performance.now();
    // Bis alle 25 versorgt sind: ein Tick, in dem keiner mehr etwas bekommt.
    const zaehlPakete = (): number => peers.reduce((s, p) => s + (p.socketRef as unknown as FakeSocket).pakete.length, 0);
    let vorher = -1;
    while (ticksBisRuhe < 3000) {
      tick();
      ticksBisRuhe++;
      const jetzt = zaehlPakete();
      if (jetzt === vorher && ticksBisRuhe > 5) break;
      vorher = jetzt;
    }
    const gesamt = performance.now() - tStart;
    console.log(`  Aufbau: ${ticksBisRuhe} Ticks, ${gesamt.toFixed(0)} ms (Ø ${(gesamt / ticksBisRuhe).toFixed(2)} ms/Tick)`);
    const N = 40;
    const t1 = performance.now();
    for (let i = 0; i < N; i++) tick();
    const leerlauf = (performance.now() - t1) / N;
    console.log(`  Leerlauf (alles auf Stand): Ø ${leerlauf.toFixed(2)} ms/Tick über ${N} Ticks`);
  }

  peers.length = 0;
  console.log(failures === 0 ? '\n=== F2 Sync-Deckel: ALLES BESTANDEN ===' : `\n=== F2 Sync-Deckel: ${failures} FEHLGESCHLAGEN ===`);
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
