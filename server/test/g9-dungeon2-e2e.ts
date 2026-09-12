/**
 * E2E-Test des 2.0-Adapters an die Instanz-Infrastruktur (AP13).
 * E2E test of the 2.0 adapter to the instance infrastructure (AP13).
 *
 *   npx tsx server/test/g9-dungeon2-e2e.ts    (aus dem Repo-Wurzelverzeichnis)
 *
 * Geprueft werden die vier Abnahmekriterien aus `design/ARCHITECTURE.md` AP13:
 * The four acceptance criteria from AP13 are checked:
 *
 *   (a) Ein 2.0-Dokument laeuft nie durch den Alt-Sanitizer und umgekehrt.
 *       Die Formatseite davon prueft `shared/test/dungeon2-dokument.ts`; HIER
 *       wird die BETRIEBSseite geprueft — dass der Manager beide Kartensaetze
 *       getrennt haelt und `dungeon list` beide zeigt.
 *       The format side is checked in shared; HERE the operational side is.
 *   (b) Betreten/Verlassen x20 ohne ZDO-Leck und ohne verlorenen Spielerstand.
 *       Enter/leave x20 without a ZDO leak and without losing player state.
 *   (c) Eine Deko-Aenderung erzeugt KEINEN Instanz-Abriss.
 *       A decor change causes NO instance teardown.
 *   (d) ZDO-Zahl je Instanz vor/nach gegenuebergestellt — die Zahl, die die
 *       ganze Umstellung begruendet: Der Altbestand gibt jeder Raumhuelle eine
 *       ZDO, 2.0 gibt sie nur noch dem Interaktiven.
 *       ZDO count per instance, old vs new — the number the whole change is
 *       about.
 *
 * Dazu ueber die LEITUNG (wie `g6-dungeon-e2e.ts`, gleiche Bauform): Der
 * Teleport traegt Thema, Seeds und Pruefsumme, und aus genau diesen Feldern
 * erzeugt dieser Test — wie es der Client tut — dasselbe Layout und vergleicht
 * die Pruefsumme. Das ist der Determinismus-Zeuge im Betrieb.
 * Plus over the WIRE: the teleport carries theme, seeds and checksum, and from
 * exactly those fields this test — like the client — generates the same layout
 * and compares the checksum.
 */

import WebSocket from 'ws';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dungeon2 } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
// Dieselbe Lehre wie in g6: Die Handshake-Antwort MUSS ueber die
// Produktivfunktion laufen, nicht ueber eine nachgebaute HMAC-Zeile.
// Same lesson as in g6: the handshake answer MUST use the production function.
import { antwortBerechnen } from '../src/net/Identitaet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-g9');
/**
 * Eigener Port. NICHT 2467 (der DEV-Spielserver) und nicht 2498 (g6) — zwei
 * Tests, die sich einen Port teilen, laufen nicht nebeneinander.
 * Own port. NOT 2467 (the DEV game server) and not 2498 (g6).
 */
const PORT = 2499;
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

// ── Drahtformat-Helfer (wie g6) / wire helpers ───────────────────────────────

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
  pos: { x: number; y: number; z: number };
  drin: boolean;
  dungeonId: string;
  env: string;
  thema: string;
  seeds: dungeon2.LayoutSeeds;
  pruefsumme: string;
  layoutVersion: number;
  name: string;
  ambientLicht: number;
  /** Das mitgelieferte Layout-JSON — leer bei erzeugten Gräbern. */
  layoutJson: string;
}

/**
 * Das Teleportpaket lesen — GENAU in der Reihenfolge des Clients. `view`
 * beginnt HINTER dem Typbyte (wie in g6).
 * Read the teleport packet — EXACTLY in the client's order. `view` starts
 * BEHIND the type byte (as in g6).
 */
function leseTeleport(view: DataView): TeleportPaket {
  let p = 0;
  const pos = {
    x: view.getFloat32(p, true),
    y: view.getFloat32(p + 4, true),
    z: view.getFloat32(p + 8, true),
  };
  p += 12;
  const drin = view.getUint8(p++) !== 0;
  let dungeonId: string;
  [dungeonId, p] = readString(view, p);
  let env: string;
  [env, p] = readString(view, p);
  let thema = '';
  let pruefsumme = '';
  let name = '';
  let architektur = 0;
  let material = 0;
  let deko = 0;
  let layoutVersion = 0;
  let ambientLicht = 1;
  let layoutJson = '';
  if (p < view.byteLength) {
    [thema, p] = readString(view, p);
    architektur = view.getInt32(p, true);
    material = view.getInt32(p + 4, true);
    deko = view.getInt32(p + 8, true);
    p += 12;
    [pruefsumme, p] = readString(view, p);
    layoutVersion = view.getInt32(p, true);
    p += 4;
    [name, p] = readString(view, p);
    // Angehängte Felder (Fassung 11 + Befund 01.09.2026): Grundhelligkeit,
    // dann das mitgelieferte Layout-JSON. `byteLength` entscheidet, kein
    // Versionsfeld — genau wie der Client.
    if (p + 4 <= view.byteLength) {
      ambientLicht = view.getFloat32(p, true);
      p += 4;
    }
    if (p < view.byteLength) {
      [layoutJson, p] = readString(view, p);
    }
  }
  return {
    pos,
    drin,
    dungeonId,
    env,
    thema,
    seeds: {
      architektur: architektur >>> 0,
      material: material >>> 0,
      deko: deko >>> 0,
    },
    pruefsumme,
    layoutVersion,
    name,
    ambientLicht,
    layoutJson,
  };
}

function sendAdmin(ws: WebSocket, line: string): void {
  ws.send(Buffer.from([P.AdminCommand, ...writeString(line)]));
}

const DUNGEON2_ID = 'steingrab-g9';
const ALT_ID = 'forestcrypt-g9';
/** Ein HANDGEBAUTES Grab (`modus: 'gebaut'`) für den Layout-Mitreise-Wächter. */
const GEBAUT_ID = 'steingrab-gebaut-g9';

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  const server = createWovServer({
    port: PORT,
    worldsDir: resolve(TMP, 'worlds'), kontenDir: resolve(TMP, 'konten'),
    saveIntervalMs: 3600_000,
  });
  server.start();

  const dungeons = server.dungeons;

  // ── (a) Betriebsseite der Weiche: beide Formate nebeneinander ─────────────
  // (a) Operational side of the switch: both formats side by side.

  const alt = dungeons.createGenerated('DG_ForestCrypt', 4242, ALT_ID);
  pruefe('Altdokument angelegt', alt !== null);
  // Die Seeds werden GEMISCHT wie in `dungeon create2` (WovServer) und nicht
  // von Hand klein gewaehlt.
  //
  // Der Grund ist ein Fehler, den 77/99 nicht finden konnten: `mische()`
  // liefert uint32, also liegt jeder zweite Seed ueber 2^31-1. Der Teleport
  // schrieb sie mit `writeInt32`, und `Buffer.writeInt32LE` WIRFT dort. Die
  // Ausnahme galt als Paketfehler, der Server trennte die Verbindung, und der
  // Spieler landete nach dem Auto-Reconnect wieder in der Oberwelt (wov-dev,
  // 29.08.2026, `steingrab-2`). Mit 77 und 99 lief derselbe Weg gruen — die
  // Zahlen waren einfach zu klein.
  // The seeds are MIXED as in `dungeon create2` rather than hand-picked small:
  // `mische()` yields uint32, and 77/99 could never have found the overflow.
  const SEEDS: dungeon2.LayoutSeeds = {
    architektur: 4242,
    material: dungeon2.mische(4242, 1),
    deko: dungeon2.mische(4242, 2),
  };
  pruefe(
    'Mindestens ein Seed liegt über 2^31-1 (sonst prüft der Teleport-Test nichts)',
    SEEDS.material > 0x7fffffff || SEEDS.deko > 0x7fffffff,
    `${SEEDS.architektur}/${SEEDS.material}/${SEEDS.deko}`
  );
  const neu = dungeons.erzeugeDungeon2('steingrab', SEEDS, DUNGEON2_ID);
  pruefe('2.0-Dokument angelegt', neu !== null);
  if (!alt || !neu) {
    console.log('g9-dungeon2-e2e: ABBRUCH — Dokumente nicht anlegbar');
    process.exit(1);
  }

  pruefe('getDocument sieht nur das Altdokument', dungeons.getDocument(ALT_ID) !== undefined);
  pruefe(
    'getDocument sieht das 2.0-Dokument NICHT',
    dungeons.getDocument(DUNGEON2_ID) === undefined
  );
  pruefe('getDokument2 sieht das 2.0-Dokument', dungeons.getDokument2(DUNGEON2_ID) !== undefined);
  pruefe('getDokument2 sieht das Altdokument NICHT', dungeons.getDokument2(ALT_ID) === undefined);
  pruefe('hatDokument kennt beide', dungeons.hatDokument(ALT_ID) && dungeons.hatDokument(DUNGEON2_ID));

  // ── (d) ZDO-Zahl vor/nach / ZDO count old vs new ──────────────────────────

  const instAlt = dungeons.getOrCreateInstance(ALT_ID);
  const inst2 = dungeons.getOrCreateInstance(DUNGEON2_ID);
  pruefe('Altinstanz steht', instAlt !== null);
  pruefe('2.0-Instanz steht', inst2 !== null);
  if (!instAlt || !inst2) {
    console.log('g9-dungeon2-e2e: ABBRUCH — Instanzen nicht anlegbar');
    process.exit(1);
  }
  const zdosAlt = instAlt.zdoids.length;
  const zdos2 = inst2.zdoids.length;
  console.log(
    `[g9] ZDOs je Instanz — Altbestand ${zdosAlt} (${alt.layout.rooms.length} Räume), ` +
      `2.0 ${zdos2} (${inst2.layout2?.stempel.length ?? 0} Stempel, ` +
      `${inst2.bau?.stuecke.length ?? 0} Bauteile)`
  );
  pruefe(
    '2.0 erzeugt WENIGER ZDOs als der Altbestand — Architektur bekommt keine mehr',
    zdos2 < zdosAlt,
    `2.0 ${zdos2}, alt ${zdosAlt}`
  );
  pruefe(
    'Die 2.0-Instanz trägt ihr Bauergebnis (Spawnpunkt, Kollision, Nav)',
    inst2.bau !== undefined && inst2.bau.nav.length > 0 && inst2.bau.kollision.length > 0
  );
  pruefe(
    'Die Altinstanz trägt KEIN Bauergebnis — sie geht den alten Weg',
    instAlt.bau === undefined
  );

  // Der Spawnpunkt kommt aus dem Bauergebnis, nicht aus der Herleitung.
  // The spawn point comes from the build result, not from a derivation.
  const spawn = dungeons.getSpawnPoint(inst2);
  pruefeGleich('Spawnpunkt == BauErgebnis.spawnPunkt (x)', spawn.x, inst2.bau!.spawnPunkt.x);
  pruefeGleich('Spawnpunkt == BauErgebnis.spawnPunkt (y)', spawn.y, inst2.bau!.spawnPunkt.y);
  pruefeGleich('Spawnpunkt == BauErgebnis.spawnPunkt (z)', spawn.z, inst2.bau!.spawnPunkt.z);

  // Und der Spawnpunkt liegt in einer begehbaren Navzelle — sonst stünde der
  // Spieler im Fels und die Zahl wäre nur eine Zahl.
  // And it lies in a walkable nav cell — otherwise the number is just a number.
  const ZELLE = dungeon2.ZELLE_M;
  const navTreffer = inst2.bau!.nav.some(
    (n) =>
      Math.abs(n.x * ZELLE + ZELLE / 2 - spawn.x) <= ZELLE / 2 + 0.01 &&
      Math.abs(n.z * ZELLE + ZELLE / 2 - spawn.z) <= ZELLE / 2 + 0.01
  );
  pruefe('Der Spawnpunkt liegt in einer begehbaren Navzelle', navTreffer);

  // ── (c) Anker-Änderung reisst die Instanz NICHT ab ────────────────────────
  // (c) An anchor change does NOT tear the instance down.

  const layout = dungeon2.layoutVonDokument2(neu)!;
  const zusatzAnker = { ...layout.anker[0]!, id: 0x7ffffff1 };
  // `mitPruefsumme`, nicht von Hand: Die Pruefsumme ist Teil der
  // Invarianten (`validateLayout`), ein Layout mit alter Pruefsumme und
  // neuem Anker wird — zu Recht — abgelehnt.
  // `mitPruefsumme`, not by hand: the checksum is part of the invariants.
  const nurAnkerGeaendert = {
    ...neu,
    modus: 'gebaut' as const,
    layout: dungeon2.mitPruefsumme({ ...layout, anker: [...layout.anker, zusatzAnker] }),
  };
  // Zuerst das Dokument auf 'gebaut' umstellen, damit beide Seiten des
  // Vergleichs dieselbe Bauform haben (ein 'erzeugt'-Dokument kann gar keine
  // zusätzlichen Anker tragen).
  // Switch to 'gebaut' first so both sides of the comparison have the same
  // shape.
  const gebaut = dungeons.upsertDokument2({ ...neu, modus: 'gebaut', layout });
  pruefe('Umstellung auf modus gebaut angenommen', gebaut !== null);
  const nachUmstellung = dungeons.getOrCreateInstance(DUNGEON2_ID)!;

  const erg = dungeons.upsertDokument2(nurAnkerGeaendert);
  pruefe('Anker-Änderung angenommen', erg !== null);
  pruefe('Anker-Änderung ERHÄLT die Instanz', erg?.instanzErhalten === true);
  pruefe(
    '… und es ist dieselbe Welt (der Spieler bleibt, wo er steht)',
    dungeons.getInstance(DUNGEON2_ID)?.welt === nachUmstellung.welt
  );

  // Der Gegenfall: Eine Architektur-Änderung MUSS abreissen.
  //
  // Gewählt wird ein anderer ARCHITEKTUR-SEED und nicht ein entfernter
  // Stempel: Ein Grab minus ein Stempel ist in aller Regel ein Grab mit einem
  // abgeschnittenen Raum, und das lehnt der Sanitizer zu Recht ganz ab
  // (`validateLayout`, Erreichbarkeit). Dann prüfte dieser Test aber
  // „ungültig" statt „abgerissen" — zwei verschiedene Dinge.
  // The counter-case: an architecture change MUST tear down. A different
  // architecture SEED is chosen, not a removed stamp: a barrow minus a stamp
  // is usually a barrow with an unreachable room, which the sanitizer rightly
  // rejects outright — and then this test would check "invalid" instead of
  // "torn down".
  const weltVorAenderung = dungeons.getInstance(DUNGEON2_ID)?.welt;
  const architekturGeaendert = { ...neu, seeds: { ...neu.seeds, architektur: 999 } };
  const erg2 = dungeons.upsertDokument2(architekturGeaendert);
  pruefe('Architektur-Änderung angenommen', erg2 !== null);
  pruefe('Architektur-Änderung ERHÄLT die Instanz NICHT', erg2?.instanzErhalten === false);
  pruefe(
    'Die alte Welt ist danach weg',
    dungeons.getInstance(DUNGEON2_ID)?.welt !== weltVorAenderung
  );
  pruefe(
    'Ein anderer Architektur-Seed ergibt eine andere Prüfsumme',
    erg2 !== null && erg2.doc.pruefsumme !== neu.pruefsumme
  );

  // Zurück auf den erzeugten Stand für den Rest des Tests.
  // Back to the generated state for the rest of the test.
  dungeons.destroyInstance(DUNGEON2_ID);
  dungeons.saveDokument2(neu);

  // ── Layout-Mitreise-Wächter (Befund 01.09.2026) ───────────────────────────
  // Ein HANDGEBAUTES Grab bekommt eine Handänderung, die aus den Seeds NICHT
  // wiederherstellbar ist: eine gemalte Materialkennung auf einer vorhandenen
  // Bodenzelle (genau, was der Pinsel im Editor tut). Über die Leitung muss
  // dieses Grab sein Layout MITBRINGEN — sonst baut der Client aus den Seeds
  // das ursprüngliche Grab und die Handarbeit ist unsichtbar. Das war der
  // gemeldete Fehler „nachträglich gesetzte Räume fehlen im Spiel".
  // A HAND-BUILT grave gets a hand edit that seeds cannot reproduce; over the
  // wire it must SHIP its layout, or the client rebuilds the original grave.
  const gebautBasis = dungeons.erzeugeDungeon2('steingrab', SEEDS, GEBAUT_ID);
  pruefe('Basis für das handgebaute Grab angelegt', gebautBasis !== null);
  let handZelle = { x: 0, z: 0, ebene: 0 };
  let handAltTag = -1;
  let handNeuTag = -1;
  if (gebautBasis) {
    const basisLayout = dungeon2.layoutVonDokument2(gebautBasis)!;
    const bodenZelle = dungeon2
      .zellenSortiert(dungeon2.zellenAufbauen(basisLayout))
      .find((z) => z.art === dungeon2.ZELLEN_ART.Boden)!;
    handZelle = { x: bodenZelle.x, z: bodenZelle.z, ebene: bodenZelle.ebene };
    handAltTag = bodenZelle.materialTag;
    // Garantiert anders und im gültigen Bereich (0..MAX_MATERIAL_TAG).
    handNeuTag = handAltTag >= dungeon2.MAX_MATERIAL_TAG ? handAltTag - 1 : handAltTag + 1;
    const handLayout = dungeon2.mitPruefsumme({
      ...basisLayout,
      korrekturen: [
        ...basisLayout.korrekturen,
        { x: handZelle.x, z: handZelle.z, ebene: handZelle.ebene, aendere: { materialTag: handNeuTag } },
      ],
    });
    const gebaut2 = dungeons.upsertDokument2({ ...gebautBasis, modus: 'gebaut', layout: handLayout });
    pruefe('Handgebautes Grab angenommen (gültig trotz Handänderung)', gebaut2 !== null);
    pruefe(
      'Die Handänderung ändert die Prüfsumme gegen die Seed-Fassung',
      gebaut2 !== null && gebaut2.doc.pruefsumme !== gebautBasis.pruefsumme
    );
    dungeons.destroyInstance(GEBAUT_ID);
  }

  // ── (b) Betreten/Verlassen x20 über die Leitung ───────────────────────────
  // (b) Enter/leave x20 over the wire.

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';

  let authSent = false;
  let runden = 0;
  /**
   * Runden ueber die LEITUNG. Bewusst wenige: `AdminCommand` ist gedrosselt
   * (Eimer 3, Nachfuellrate 1/s — `server/src/net/Drossel.ts`), zwanzig
   * Runden waeren vierzig Befehle und damit vierzig Sekunden Wartezeit in
   * einer Suite, die sonst in Sekunden durchlaeuft. Die Leitung beweist, DASS
   * das Paket stimmt und der Weg wiederholbar ist; die zwanzig Runden aus
   * Abnahmekriterium (b) laufen unten im Prozess, wo sie nichts kosten und
   * dieselbe Frage beantworten.
   * Rounds over the WIRE — deliberately few: `AdminCommand` is throttled.
   */
  const RUNDEN = 3;
  /** Abstand zwischen zwei Admin-Befehlen — knapp ueber der Nachfuellrate. */
  /** Gap between two admin commands — just above the refill rate. */
  const TAKT_MS = 1100;
  let drin = false;
  let ersterTeleport: TeleportPaket | null = null;
  let gebautTeleport: TeleportPaket | null = null;
  let phaseGebaut = false;
  let fertig = false;

  const zdoZahlen: number[] = [];

  await new Promise<void>((aufloesen, ablehnen) => {
    const uhr = setTimeout(
      () => ablehnen(new Error(`Zeitüberschreitung — runden=${runden}, drin=${drin}`)),
      60_000
    );
    /** Gedrosselt senden. / Send throttled. */
    const spaeter = (zeile: string): void => {
      setTimeout(() => sendAdmin(ws, zeile), TAKT_MS);
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
            ...writeString('Dungeon2Runner'),
            ...writeString(''),
          ])
        );
        return;
      }

      if (typ === P.PeerInfo) {
        sendAdmin(ws, `dungeon enter ${DUNGEON2_ID}`);
        return;
      }

      if (typ === P.Teleport) {
        const tp = leseTeleport(view);
        if (process.env.G9_LAUT)
          console.log(`[g9] Teleport drin=${tp.drin} id=${tp.dungeonId} runden=${runden}`);
        if (tp.drin) {
          drin = true;
          // Das handgebaute Grab (letzte Phase): sein Teleport wird erfasst,
          // dann sofort wieder verlassen.
          if (tp.dungeonId === GEBAUT_ID) {
            gebautTeleport ??= tp;
            spaeter('dungeon leave');
            return;
          }
          ersterTeleport ??= tp;
          const inst = dungeons.getInstance(DUNGEON2_ID);
          if (inst) zdoZahlen.push(inst.zdoids.length);
          spaeter('dungeon leave');
        } else if (drin) {
          drin = false;
          // Das gebaute Grab wurde verlassen — jetzt ist der Lauf fertig.
          if (phaseGebaut) {
            if (!fertig) {
              fertig = true;
              clearTimeout(uhr);
              aufloesen();
            }
            return;
          }
          runden++;
          if (runden >= RUNDEN) {
            // Erzeugt-Runden durch — als letztes das HANDGEBAUTE Grab betreten.
            phaseGebaut = true;
            spaeter(`dungeon enter ${GEBAUT_ID}`);
            return;
          }
          spaeter(`dungeon enter ${DUNGEON2_ID}`);
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

  // ── (b) Betreten/Verlassen x20 IM PROZESS ────────────────────────────────
  // Dieselbe Frage wie oben, nur ohne die Drossel: Bleibt die ZDO-Zahl
  // konstant, und ueberlebt der Spielerstand? Es laeuft ueber DIESELBEN
  // Methoden, die der Admin-Befehl aufruft — `enterDungeon`/`leaveDungeon`
  // sind der Weg, nicht der Umweg.
  // (b) Enter/leave x20 IN PROCESS — same question, without the throttle,
  // through the SAME methods the admin command calls.
  const peer = server.net.getPeers().find((p) => p.name === 'Dungeon2Runner');
  pruefe('Der Peer ist auffindbar', peer !== undefined);
  if (peer) {
    const IM_PROZESS = 20;
    const nameVorher = peer.name;
    const idVorher = peer.spielerId;
    const zdoImProzess: number[] = [];
    const charakterIds = new Set<string>();
    let alleOk = true;
    for (let i = 0; i < IM_PROZESS; i++) {
      alleOk &&= server.enterDungeon(peer, DUNGEON2_ID).ok;
      const inst = dungeons.getInstance(DUNGEON2_ID);
      zdoImProzess.push(inst?.zdoids.length ?? -1);
      // Das Charakter-ZDO der INSTANZWELT — es muss in jeder Runde ein
      // NEUES sein (ZDO-Kennungen gelten je ZDO-Raum, `charakterUmziehen`).
      // The character ZDO of the INSTANCE world — new in every round.
      charakterIds.add(peer.characterID.toString());
      alleOk &&= server.leaveDungeon(peer).ok;
    }
    pruefe(`Betreten/Verlassen x${IM_PROZESS} im Prozess ohne Fehler`, alleOk);
    const erste = zdoImProzess[0] ?? -1;
    pruefe(
      `ZDO-Zahl der Instanz bleibt über ${IM_PROZESS} Runden konstant (${erste})`,
      erste > 0 && zdoImProzess.every((z) => z === erste),
      `Zahlen: ${[...new Set(zdoImProzess)].join(', ')}`
    );
    pruefeGleich('Der Spielername überlebt', peer.name, nameVorher);
    pruefeGleich('Die Spieler-Id überlebt', peer.spielerId, idVorher);
    pruefe('Der Peer steht am Ende in der Oberwelt', peer.dungeonId === null);
    pruefe(
      'Das Charakter-ZDO wird bei jedem Wechsel neu vergeben (ZDO-Raum-Regel)',
      charakterIds.size > 1,
      `nur ${charakterIds.size} verschiedene`
    );
    // Und die WELTEN: Nach zwanzig Runden darf genau EINE Instanzwelt
    // dastehen, nicht zwanzig. Ein Leck hier waere unsichtbar, solange
    // niemand die Karte zaehlt.
    // And the WORLDS: exactly ONE instance world, not twenty.
    const instanzen = dungeons.listInstances().filter((i) => i.dungeonId === DUNGEON2_ID);
    pruefeGleich('Genau eine Instanz nach 20 Runden', instanzen.length, 1);
  }

  ws.close();

  pruefeGleich(`Betreten/Verlassen x${RUNDEN} über die Leitung durchgelaufen`, runden, RUNDEN);
  pruefe('Der Teleport kam an', ersterTeleport !== null);

  if (ersterTeleport) {
    const tp = ersterTeleport;
    pruefe('Teleport meldet: im Dungeon', tp.drin);
    pruefeGleich('Teleport trägt die Dungeon-Kennung', tp.dungeonId, DUNGEON2_ID);
    pruefeGleich('Teleport trägt das Thema', tp.thema, 'steingrab');
    pruefeGleich('Teleport trägt die Innen-Umgebung des Themas', tp.env, 'Crypt');
    pruefeGleich('Teleport trägt die Layout-Formatversion', tp.layoutVersion, dungeon2.LAYOUT_VERSION);
    pruefeGleich('Teleport trägt die Prüfsumme', tp.pruefsumme, neu.pruefsumme);
    pruefeGleich('Teleport trägt den Architektur-Seed', tp.seeds.architektur, 4242);
    // UNVERSEHRT, nicht bloss „irgendwie da": Der Fehler vom 29.08.2026 lag
    // genau hier — ein Seed über 2^31-1 riss beim Schreiben die Verbindung ab.
    // Dass die Verbindung überhaupt noch steht, beweist der Test schon durch
    // die 20 Runden darüber; diese zwei Zeilen sagen, WELCHE Zahl es war.
    // INTACT, not merely "somehow present".
    pruefeGleich('Teleport trägt den Material-Seed unversehrt', tp.seeds.material, SEEDS.material);
    pruefeGleich('Teleport trägt den Deko-Seed unversehrt', tp.seeds.deko, SEEDS.deko);

    // DER DETERMINISMUS-ZEUGE IM BETRIEB: Aus den Feldern des Pakets — und
    // NUR aus ihnen — dasselbe Layout erzeugen wie der Server.
    // THE DETERMINISM WITNESS IN OPERATION.
    const ausPaket = dungeon2.layoutAusDeskriptor({
      thema: tp.thema,
      seeds: tp.seeds,
      pruefsumme: tp.pruefsumme,
      layoutVersion: tp.layoutVersion,
      id: tp.dungeonId,
      name: tp.name,
    });
    pruefe('Aus dem Paket entsteht ein Layout', ausPaket.layout !== null);
    pruefe(
      'Client-Layout == Server-Layout (Prüfsumme)',
      !ausPaket.abweichung,
      `${ausPaket.erwartet} vs ${ausPaket.gerechnet}`
    );
    pruefeGleich('… und es hat keine Layout-Fehler', ausPaket.befunde.length, 0);

    // Die Position ist die des Bauers, und sie liegt nahe am Weltursprung —
    // dieselbe Schranke wie in g6, sie fängt einen Rückfall aufs alte Band
    // ab x = 100.000.
    // Same bound as in g6 — it catches a relapse to the old x = 100 000 band.
    pruefe(
      'Der Instanz-Teleport liegt nahe am Ursprung seiner Welt',
      Math.hypot(tp.pos.x, tp.pos.z) < 5_000,
      `(${tp.pos.x}, ${tp.pos.z})`
    );
  }

  // ── DER LAYOUT-MITREISE-WÄCHTER (Befund 01.09.2026) ───────────────────────
  // Das handgebaute Grab kam über die LEITUNG. Beweise: (1) sein Paket trägt
  // ein Layout-JSON, das erzeugte NICHT; (2) aus dem MITGELIEFERTEN Layout
  // gebaut, überlebt die Handänderung bis in die Zelle; (3) aus den SEEDS
  // allein fehlt sie — der rote Zeuge dafür, dass die Geometrie mitreisen MUSS.
  // THE LAYOUT-SHIPPING GUARD: prove the hand edit survives via the shipped
  // layout and would be LOST on the seed-only path.
  pruefe('Das handgebaute Grab kam über die Leitung an', gebautTeleport !== null);
  pruefe(
    'Das erzeugte Grab trägt KEIN Layout-JSON (Leitung bleibt schlank)',
    ersterTeleport?.layoutJson === '',
    `layoutJson.length=${ersterTeleport?.layoutJson.length}`
  );
  if (gebautTeleport && handAltTag >= 0) {
    const tp = gebautTeleport;
    pruefeGleich('Das gebaute Grab trägt seine eigene Kennung', tp.dungeonId, GEBAUT_ID);
    const hatLayout = tp.layoutJson.length > 0;
    pruefe(
      'Das handgebaute Grab trägt SEIN Layout im Teleport-Paket',
      hatLayout,
      `layoutJson.length=${tp.layoutJson.length}`
    );

    // (1) Aus dem MITGELIEFERTEN Layout — wie der Client es jetzt tut. Nur bei
    // vorhandenem Layout; fehlt es (Gegenprobe/Regression), steht die Rot-
    // Meldung schon oben, und ein `JSON.parse('')` soll den Lauf nicht
    // ABBRECHEN, sondern der Wächter soll sauber rot bleiben.
    if (hatLayout) {
      const ausLayout = dungeon2.layoutAusMitgeliefert(
        JSON.parse(tp.layoutJson) as unknown,
        tp.pruefsumme
      );
      pruefe('Aus dem mitgelieferten Layout entsteht ein Grab', ausLayout.layout !== null);
      pruefe(
        'Mitgeliefertes Layout == Server-Layout (keine Abweichung)',
        !ausLayout.abweichung,
        `${ausLayout.erwartet} vs ${ausLayout.gerechnet}`
      );
      const zelleMit =
        ausLayout.layout &&
        dungeon2.zelleImGitter(
          dungeon2.zellenAufbauen(ausLayout.layout),
          handZelle.x,
          handZelle.z,
          handZelle.ebene
        );
      pruefeGleich(
        'Die handgemalte Materialkennung überlebt bis in die gebaute Zelle',
        zelleMit?.materialTag,
        handNeuTag
      );
    }

    // (2) DER ROTE ZEUGE: aus den SEEDS allein baut der alte Weg das
    // URSPRÜNGLICHE Grab — die Handarbeit fehlt, die Prüfsumme weicht ab.
    const ausSeeds = dungeon2.layoutAusDeskriptor({
      thema: tp.thema,
      seeds: tp.seeds,
      pruefsumme: tp.pruefsumme,
      layoutVersion: tp.layoutVersion,
      id: tp.dungeonId,
      name: tp.name,
    });
    pruefe(
      'Der Seed-Weg allein weicht ab — Beleg, dass die Geometrie mitreisen muss',
      ausSeeds.abweichung
    );
    const zelleSeed =
      ausSeeds.layout &&
      dungeon2.zelleImGitter(
        dungeon2.zellenAufbauen(ausSeeds.layout),
        handZelle.x,
        handZelle.z,
        handZelle.ebene
      );
    pruefeGleich(
      '… und der Seed-Weg trägt die Handänderung NICHT (alte Kennung)',
      zelleSeed?.materialTag,
      handAltTag
    );
  }

  // Kein ZDO-Leck: Die Instanz wird über die Runden nicht dicker. Verglichen
  // wird die erste mit der letzten Zahl — die Instanz überlebt das Verlassen
  // (sie wird erst nach DUNGEON_REGEN_INTERVAL_MS abgeräumt), also muss die
  // Zahl KONSTANT bleiben, nicht nur beschränkt.
  // No ZDO leak: the count must stay CONSTANT, not merely bounded.
  const ersteZahl = zdoZahlen[0] ?? -1;
  pruefe(
    `ZDO-Zahl bleibt über ${RUNDEN} Leitungsrunden konstant (${ersteZahl})`,
    zdoZahlen.every((z) => z === ersteZahl),
    `Zahlen: ${[...new Set(zdoZahlen)].join(', ')}`
  );

  server.stop();
  rmSync(TMP, { recursive: true, force: true });

  console.log(`g9-dungeon2-e2e: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
  for (const f of fehlerListe) console.log(`  ROT  ${f}`);
  process.exit(fehlerListe.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('g9-dungeon2-e2e: ABBRUCH —', e);
  process.exit(1);
});
