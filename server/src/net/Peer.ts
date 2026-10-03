/**
 * Peer — represents a connected client.
 * 1:1 port of the reference server's peer.
 *
 * State held (as in the reference):
 *   - known ZDOs per peer (revision + time)
 *   - force-send set and invalid-sector set
 *   - name, socket, position, character ZDOID
 *   - packed flags (visible, gated, ...) and the sync data map
 *
 * Transport: WebSocket (replaces the socket layer of the reference server).
 */

import type { Vector3, ZoneID, ConnectionStatus } from '@wov/shared';
import { Inventory, decodeArmor, summiereWerte, werteFuerRuestungsteil, KEINE_WERTE, type Werte } from '@wov/shared';
import { ZDOID } from '../zdo/ZDOID.js';
import { ZDORevision } from '../zdo/ZDO.js';
import { ZonenFenster } from '../zdo/ZonenFenster.js';
import { Writer } from '../io/Writer.js';
import { Reader } from '../io/Reader.js';
import { neuerSchlagZustand, type SchlagZustand } from '../spiel/Treffer.js';
import { Spielwerte } from '../spiel/Spielwerte.js';
import { blockZuruecksetzen } from '../spiel/Block.js';
import { rolleBeenden } from '../spiel/Rolle.js';
import type { RolleWeg } from '../world/Spielerbewegung.js';
import { PacketType } from '@wov/shared';
import type { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import type { SpielerId } from './Identitaet.js';
// G12: Sync-Bytes/s am Ort des Versands zaehlen, nicht nachtraeglich aus
// den ZDO-Saetzen hochrechnen -- s. Kopfkommentar von ../Metriken.ts.
import { erfasseSyncBytes } from '../Metriken.js';

/** ZDO tracking entry per peer (revision + time pair, as in the reference) */
export interface PeerZDOEntry {
  dataRevision: number;
  ownerRevision: number;
  lastSentTime: number;
}

export class Peer {
  // ── Immutable ──────────────────────────────────────────────────
  readonly name: string;
  private socket: WebSocket;

  /** Verbindung hart schließen (Timeout/Fehler) — Socket bleibt privat. */
  trenne(): void {
    this.socket.close();
  }

  // ── Mutable state ──────────────────────────────────────────────
  /** Protocol version the client sent in the handshake (0 until the VersionCheck is answered). */
  protokollVersion = 0;
  position: Vector3;
  characterID: ZDOID;
  /** Altlast-ID fuer ZDO-Besitz (BigInt, siehe WovServer.ts). Kommt seit
   *  F3 (Security-Review) AUSSCHLIESSLICH vom Server: bei Erstanmeldung
   *  serverseitig aus der neuen spielerId abgeleitet, danach im
   *  SessionToken eingefroren — nie mehr aus einem Client-Feld. */
  userId: bigint;
  /** Server-vergebene, stabile Spieler-ID (F3, Security-Review) — leer
   *  bis NetManager.handlePasswordAuth sie zuweist. Der Client kann sie
   *  weder waehlen noch beeinflussen (Luecke A/B). */
  spielerId: SpielerId = '';

  /**
   * Gewaehlte Spielfigur (Kennung aus shared/figuren.ts).
   *
   * Der Wert kommt vom Client (Paket SetFigur), wird aber NIE ungeprueft
   * uebernommen — `istFigur()` entscheidet, sonst stuende hier ein
   * beliebiger String aus dem Netz und der Client versuchte, ihn als
   * Dateinamen zu laden. Vorbelegt beim Anmelden aus dem Spielstand.
   */
  figur: string = '';
  /**
   * Gewaehlte Frisur (Kennung aus shared/aussehen.ts).
   */
  frisur: string = '';
  /** Kennung aus HAARFARBEN (shared/aussehen.ts), nicht die Farbe selbst. */
  haarfarbe: string = '';
  /** Kennung aus AUGENFARBEN (shared/aussehen.ts). */
  augenfarbe: string = '';
  klasse: string = '';
  starterSetGranted: string = '';
  /** Tode und Spielzeit dieses Charakters (Spielwerte.ts); laeuft ab dem Anmelden, endet beim Abmelden. */
  readonly spielwerte = new Spielwerte();
  /**
   * Getragene Ruestung als "oberkoerperId|beineId" — ein leerer Teil
   * heisst "nichts angezogen". Zusammengefasst statt zweier Felder, damit
   * ein weiterer Slot spaeter weder Peer noch Spielstand aufbläht.
   */
  private ruestungWert = '|';
  private werteWert: Werte = KEINE_WERTE;
  get ruestung(): string {
    return this.ruestungWert;
  }
  /**
   * Every assignment recomputes `werte` ONCE (not per blow): login, `inventarSync`, `SetAussehen`
   * all go through here, so the sums can never lag behind the worn parts.
   */
  set ruestung(wert: string) {
    this.ruestungWert = wert;
    this.werteWert = summiereWerte(Object.values(decodeArmor(wert)).map((id) => werteFuerRuestungsteil(id)));
  }
  /** Summed item attributes of the worn armor (shared/src/items/stats.ts), read-only. */
  get werte(): Werte {
    return this.werteWert;
  }

  /** Connection status */
  status: ConnectionStatus;

  /** Whether this peer has completed authentication */
  authenticated: boolean;
  /**
   * Verbindung, die nur Editor-Pakete schickt und die Welt NICHT betritt.
   *
   * Gesetzt aus dem Handshake (angehaengtes Feld in PasswordAuth). Ein
   * solcher Peer bekommt keinen Charakter, kein Inventar, kein Terrain und
   * keinen Platz in der Namensvergabe — er ist zum Speichern da und wieder
   * weg. Rechte gibt die Marke keine: Der Admin-Riegel vor den
   * Editor-Paketen bleibt `isAdmin`.
   */
  nurEditor = false;

  /** Whether this peer is an admin */
  isAdmin: boolean;

  /** Admin fly mode (AdminCommand "fly") — server-authoritative: skips
   *  gravity/ground clamp in handlePlayerInput so zone streaming and ZDO
   *  sync keep following the flying player. */
  flying: boolean;

  /** Kampf-Basis: Lebenspunkte (Server-autoritativ, 100 = voll). */
  health: number;

  /** Ausdauer (Server-autoritativ): Rennen und Schläge zehren, Pause regeneriert. */
  stamina: number;
  /** Zeitstempel (ms) des letzten Ausdauer-Verbrauchs — Regen-Sperre 1,5 s. */
  staminaZuletztVerbraucht: number;
  /** Akku fuer den 10-Hz-PlayerState-Versand (s), s. WovServer.handlePlayerInput. */
  staminaSyncAkku?: number;
  /**
   * Block (D3): Zeitstempel (ms) des Beginns eines gehaltenen Blocks, 0 = kein Block.
   * Gesetzt von spiel/Block.ts, gelesen in applyCreatureAttack und handlePlayerInput.
   */
  blockSeit: number;
  /** Block: Serverzeit (ms) der letzten Abbuchung des Haltens, 0 = kein Block. */
  blockTaktZeit: number;
  /** Block: bis zu diesem Zeitstempel (ms) bekommt ein neuer Block kein Paradefenster (Klickserien). */
  blockSperreBis: number;
  /** Block: der laufende Block begann innerhalb der Sperre, also ohne Paradefenster. */
  blockOhneParade: boolean;
  /** Rolle (D3-K4): Beginn (ms) der laufenden Rolle, 0 = keine. Gesetzt von spiel/Rolle.ts. */
  rolleStart: number;
  /** Rolle: Ende (ms, exklusiv) der laufenden Rolle: bis dahin unverwundbar, kein Schlag, kein Block. 0 = keine. */
  rolleBis: number;
  /** Rolle: Ende (ms) der bisher bewegten Zeitscheibe; die naechste beginnt hier. */
  rolleZeit: number;
  /** Rolle: Richtung des Wegs (Einheitsvektor am Boden). */
  rolleX: number;
  rolleZ: number;
  /** Rolle: bis hierhin (ms) darf keine neue Rolle beginnen (Abklingzeit). */
  rolleSperreBis: number;
  /** Rolle: die Nummer, die der Client der laufenden (oder letzten) Rolle gab; `Rolle=false` des Servers traegt sie zurueck. */
  rolleNr: number;
  /** Rolle: der Weg der laufenden Rolle (Raster und Hangspeicher wie in der Vorschau), null = keine. */
  rolleWeg: RolleWeg | null;
  /** Sprung (D3-K4): bis hierhin (ms) wird kein weiterer gemeldeter Sprung abgerechnet. */
  sprungSperreBis: number;
  /**
   * Tod: Zeitstempel (ms), bis zu dem der Spieler tot am Boden liegt. 0 = lebt.
   * Solange er laeuft, nimmt der Spieler keinen Schaden, gilt Kreaturen nicht als
   * Ziel und seine Eingaben (Bewegung, Schlag, Block, Interaktion) werden
   * ignoriert; danach belebt ihn der Server (WovServer.belebeFaellige).
   */
  totBis = 0;

  /** Respawn-Punkt (Bett) — null = Weltspawn. */
  spawnPoint: Vector3 | null;
  /**
   * Layout-Kennung des Bettes, an dem `spawnPoint` gesetzt wurde ('' = ein
   * Spielerbett oder keins). Nur ein Layout-Bett wandert mit dem Gelaende; beim
   * Tod wird genau dieses Bett gesucht, nicht die x/z-Saeule.
   */
  spawnBettId: string;
  /**
   * `besitzer` des Bettes, an dem `spawnPoint` gesetzt wurde ('' = Weltbett,
   * null = unbekannt: Punkt aus einem Stand vor dieser Angabe). Beim Tod muss
   * ein Spielerbett am Punkt denselben Besitzer tragen; die Angabe ist die des
   * Bettes, nicht die aktuelle userId (ein Gast bekommt bei jeder Verbindung eine neue).
   */
  spawnBettBesitzer: string | null;

  /** Aktiver Essens-Buff: maxHP-Bonus bis Zeitstempel (ms). */
  foodBonus: number;
  /** Lebensmaximum, das der Client mit dem letzten PlayerState mitbekam (Anzeige-Prozent bezieht sich darauf). */
  gesendetesLebensmax = 100;
  foodBis: number;

  /** Phase G: dungeon instance the peer is currently inside (null = overworld). */
  dungeonId: string | null;

  /** Phase G: overworld position to return to when leaving the dungeon. */
  dungeonReturn: Vector3 | null;
  /** Zeitstempel des letzten empfangenen Pakets (Heartbeat/Timeout). */
  letztesPaket = Date.now();
  /** Zeitstempel der letzten "Paket vor Auth verworfen"-Logzeile fuer
   *  diesen Peer (A4, Security-Review) — hoechstens 1 Zeile/Sekunde, sonst
   *  schreibt ein Flood unauthentifizierter Pakete das Journal in
   *  Sekunden voll (NetManager.handlePacket). */
  letzteVorAuthWarnung = 0;
  /** Nonce des laufenden Passwort-Handshakes (F4, Security-Review) — vom
   *  Server erzeugt, EINMALIG, wird von handlePasswordAuth sofort nach
   *  Gebrauch geloescht (Replay-Schutz). null ausserhalb eines laufenden
   *  Handshakes. */
  authNonce: string | null = null;
  /**
   * Zufaellige Kennung NUR fuer die Paket-Drosselung (A4, Security-Review)
   * — pro Verbindung neu, UNABHAENGIG von der Spieler-Identitaet (die
   * steht vor der Anmeldung noch gar nicht fest, und ein Bot, der nach
   * jedem Drosseltreffer die Verbindung wegwirft und neu aufbaut, wuerde
   * sich sonst nie in einem laenger laufenden Eimer fangen). Wird beim
   * Verbindungsabbau als Schluessel benutzt, um den Drosselzustand dieses
   * Peers wieder herauszunehmen (NetManager.handleDisconnect).
   */
  readonly verbindungsId = randomBytes(8).toString('hex');
  /** Welt, in der der Peer lebt (Review 15) — heute immer die Hauptwelt. */
  worldId = 'haupt';
  /** Server-autoritatives Inventar (Review-Punkt 8) — Quelle der Wahrheit. */
  readonly inventar = new Inventory();
  /**
   * Getragene Waffe (Kampfkern K2a): Name des Gegenstands im Server-Inventar,
   * "" = Faust. Gesetzt nur ueber Paket Equip, Spielstand und Login; wer sie
   * verliert (Inventar leer), verliert sie hier (WovServer.pruefeWaffe).
   */
  waffe = '';
  /**
   * Hat diese Verbindung je ein Equip geschickt? Ein Client ohne Equip
   * (alter Tab) meldet die Waffe nur im Angriffspaket — siehe wirksameWaffe.
   */
  equipGesehen = false;
  /** Anzahl eigener Bauwerke (Piece-Budget); beim Login gezählt. */
  bautenAnzahl = 0;

  /** Map visibility flag (BitPack index 0) */
  mapVisible: boolean;

  /**
   * ZDOs known to this peer: zdoid.hashCode() -> entry.
   *
   * Der Schlüssel ist die gepackte Zahl (10 Bit Nutzerindex + 22 Bit id), nicht
   * der String "userId:id": syncZDOs fragt die Karte je ZDO und Tick ab, und
   * ein Template-String je Abfrage waren Zehntausende Allokationen je Tick.
   * Eindeutig innerhalb EINES ZDO-Raums; weltWechselVorbereiten leert sie.
   */
  private knownZDOs: Map<number, PeerZDOEntry>;

  /** ZDOs to force-send next tick (numeric keys, see knownZDOs) */
  private forceSend: Set<number>;

  /** Invalidated sectors */
  private invalidSectors: Set<string>;

  /** Sync data (key-value pairs sent to client) */
  syncData: Map<string, string>;

  /** Last ping timestamp */
  lastPingTime: number;

  /** Measured ping in ms */
  ping: number;

  /** Sequence number for input reconciliation */
  lastInputSeq: number;

  /** Timestamp of the last input packet (D6 gravity delta time) */
  lastInputTime: number;

  /**
   * Server-gefuehrte Blickrichtung (rad, Basis wie im Client:
   * forward = (−sin yaw, −cos yaw)). `null` = dieser Peer hat noch keine
   * einzige brauchbare Blickmeldung geschickt.
   *
   * WAS DAS IST UND WAS NICHT: Der Wert kommt aus CLIENTMELDUNGEN
   * (PlayerInput, Attack) und ist damit keine unabhaengige Wahrheit —
   * anders als `position`, die der Server seit dem 11.09. selbst rechnet.
   * Er ist eine VERFOLGTE Groesse: `WovServer.fuehreBlickNach()` laesst
   * ihn je Meldung nur um so viel wandern, wie sich seit der letzten
   * Meldung ueberhaupt drehen laesst. Damit kann ein Client seine
   * Blickrichtung nicht mehr fuer ein einzelnes Paket umspringen lassen
   * (Nahkampf-Trefferkegel, s. WovServer.handleAttack).
   *
   * Tracked look direction — client-reported, but rate-limited so it
   * cannot teleport from one packet to the next.
   */
  blickYaw: number | null = null;
  /** Zeitstempel (ms) der Meldung, aus der `blickYaw` stammt. */
  blickYawZeit = 0;

  /** Combo chain and cooldown of the melee swings (D2, spiel/Treffer.ts). */
  schlag: SchlagZustand = neuerSchlagZustand();

  constructor(socket: WebSocket, name: string, userId: bigint) {
    this.socket = socket;
    this.name = name;
    this.userId = userId;
    this.position = { x: 0, y: 0, z: 0 };
    this.characterID = ZDOID.NONE;
    this.status = 1; // Connecting
    this.authenticated = false;
    this.isAdmin = false;
    this.flying = false;
    this.health = 100;
    this.stamina = 100;
    this.staminaZuletztVerbraucht = 0;
    this.blockSeit = 0;
    this.blockTaktZeit = 0;
    this.blockSperreBis = 0;
    this.blockOhneParade = false;
    this.rolleStart = 0;
    this.rolleBis = 0;
    this.rolleZeit = 0;
    this.rolleX = 0;
    this.rolleZ = 0;
    this.rolleSperreBis = 0;
    this.rolleNr = 0;
    this.rolleWeg = null;
    this.sprungSperreBis = 0;
    this.spawnPoint = null;
    this.spawnBettId = '';
    this.spawnBettBesitzer = null;
    this.foodBonus = 0;
    this.foodBis = 0;
    this.dungeonId = null;
    this.dungeonReturn = null;
    this.mapVisible = false;
    this.knownZDOs = new Map();
    this.forceSend = new Set();
    this.invalidSectors = new Set();
    this.syncData = new Map();
    this.lastPingTime = Date.now();
    this.ping = 0;
    this.lastInputSeq = 0;
    this.lastInputTime = 0;
  }

  // ── ZDO tracking (known ZDOs) ──────────────────────────────────

  /** Check if a ZDO is outdated for this peer. */
  isOutdatedZDO(zdoid: ZDOID, dataRev: number, ownerRev: number): boolean {
    const entry = this.knownZDOs.get(zdoid.hashCode());
    if (!entry) return true; // never sent = outdated
    return entry.dataRevision !== dataRev || entry.ownerRevision !== ownerRev;
  }

  /**
   * Was dieser Peer von einem ZDO zuletzt bekommen hat (D6) — `undefined`
   * heißt „noch nie gesehen" und damit: Erstübertragung, VOLLSTÄNDIG.
   *
   * Absichtlich zusätzlich zu `isOutdatedZDO`: Der Sync braucht denselben
   * Eintrag zweimal (veraltet? und: ab welcher Revision reicht ein Delta?),
   * und zwei Map-Zugriffe je ZDO und Tick sind genau die Sorte Kleinvieh,
   * die bei 81 Zonen × 20 Hz zusammenkommt.
   */
  syncStand(zdoid: ZDOID): PeerZDOEntry | undefined {
    return this.knownZDOs.get(zdoid.hashCode());
  }

  /** Mark a ZDO as known/sent to this peer. */
  markZDOSent(zdoid: ZDOID, dataRev: number, ownerRev: number): void {
    this.knownZDOs.set(zdoid.hashCode(), {
      dataRevision: dataRev,
      ownerRevision: ownerRev,
      lastSentTime: Date.now(),
    });
  }

  /**
   * Alles vergessen, was aus der bisherigen Welt stammt.
   *
   * ZDO-Kennungen werden JE ZDO-RAUM vergeben: Die erste ZDO einer frisch
   * angelegten Instanz trägt dieselbe Nummer wie die erste der Oberwelt.
   * Bliebe `knownZDOs` stehen, hielte der Server jede davon für „kennt er
   * schon" und schickte sie nie — der Spieler stünde in einem leeren
   * Dungeon. Dasselbe gilt für die offenen Zerstörungen: Sie zeigen auf
   * Nummern, die drüben etwas anderes bedeuten.
   */
  weltWechselVorbereiten(): void {
    blockZuruecksetzen(this); // a held block ends with the world; the client is told
    rolleBeenden(this); // a roll ends with the world (the locks stay)
    this.knownZDOs.clear();
    this.fenster.zuruecksetzen();
    this.quittiereZerstoerungen();
  }

  /** Remove a ZDO from this peer's known set. */
  removeKnownZDO(zdoid: ZDOID): void {
    this.knownZDOs.delete(zdoid.hashCode());
  }

  /** Force-send a ZDO next tick. */
  forceSendZDO(zdoid: ZDOID): void {
    this.forceSend.add(zdoid.hashCode());
  }

  /** Consume force-send set. */
  consumeForceSend(): Set<number> {
    const set = this.forceSend;
    this.forceSend = new Set();
    return set;
  }

  /** Invalidate a sector for this peer. */
  invalidateSector(zone: ZoneID): void {
    this.invalidSectors.add(`${zone.x},${zone.y}`);
  }

  get knownZDOCount(): number {
    return this.knownZDOs.size;
  }

  // ── ZDO-Sync-Zustand (D6/D7) ───────────────────────────────────

  /**
   * Zwischengespeichertes 9×9-Zonenfenster (D7). Gehört zum Peer, weil es
   * an dessen Position hängt und mit ihm verschwindet.
   */
  readonly fenster = new ZonenFenster();

  /**
   * Noch nicht zugestellte Zerstörungen (D6).
   *
   * Vorher wurde die Zerstörungsliste einmal je Tick global verbraucht und
   * sofort an alle Peers geschrieben. Mit dem Bandbreitenbudget kann ein
   * Tick für einen Peer aber komplett ausfallen — dann wäre die Liste für
   * ihn für immer weg und das zerstörte Objekt bliebe als Leiche in seiner
   * Welt stehen. Deshalb staut sie sich hier je Peer an, bis sie wirklich
   * im Paket war.
   */
  private zerstoerungen: ZDOID[] = [];

  stelleZerstoerungenEin(liste: ReadonlyArray<ZDOID>): void {
    for (const id of liste) this.zerstoerungen.push(id);
  }

  get offeneZerstoerungen(): ReadonlyArray<ZDOID> {
    return this.zerstoerungen;
  }

  quittiereZerstoerungen(): void {
    this.zerstoerungen = [];
  }

  /**
   * Bytes, die der Socket noch nicht losgeworden ist (Sendewarteschlange
   * des Originals). Das ist die Größe, gegen die
   * ZDO_MAX_SEND_THRESHOLD/ZDO_MIN_SEND_THRESHOLD im Original gemessen
   * werden: Ein Peer mit vollem Puffer bekommt nichts obendrauf, sonst
   * wächst der Rückstand schneller, als die Leitung ihn abträgt.
   */
  get sendeRueckstau(): number {
    return this.socket.bufferedAmount;
  }

  // ── Network send ───────────────────────────────────────────────

  /** Send a binary packet: [type: u8][payload] */
  sendPacket(type: PacketType, payload: Buffer): void {
    if (this.socket.readyState !== 1) return; // OPEN
    const packet = Buffer.allocUnsafe(1 + payload.length);
    packet.writeUInt8(type, 0);
    payload.copy(packet, 1);
    this.socket.send(packet);
    erfasseSyncBytes(packet.length, this.verbindungsId);
  }

  /** Send a packet built from a Writer callback. */
  sendPacketWith(type: PacketType, writeFn: (w: Writer) => void): void {
    const writer = new Writer();
    writeFn(writer);
    this.sendPacket(type, writer.toBuffer());
  }

  /** Send raw binary data. */
  sendRaw(data: Buffer): void {
    if (this.socket.readyState !== 1) return;
    this.socket.send(data);
    erfasseSyncBytes(data.length, this.verbindungsId);
  }

  /** Disconnect this peer. */
  disconnect(reason = ''): void {
    if (this.socket.readyState === 1) {
      const writer = new Writer();
      writer.writeString(reason);
      this.sendPacket(PacketType.Disconnect, writer.toBuffer());
      this.socket.close();
    }
  }

  get isConnected(): boolean {
    return this.socket.readyState === 1;
  }

  get socketRef(): WebSocket {
    return this.socket;
  }

  // ── Utility ────────────────────────────────────────────────────

  toString(): string {
    return `Peer(${this.name}, ${this.userId})`;
  }
}
