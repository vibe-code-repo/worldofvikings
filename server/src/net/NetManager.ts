/**
 * NetManager — manages all connected peers, handshake, and packet routing.
 * 1:1 port of NetManager.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class INetManager {
 *     Map<string, int32> m_sessionIndexes;
 *     vector<Peer::Ptr> m_connectedPeers;
 *     vector<Peer::Ptr> m_onlinePeers;
 *     unique_ptr<IAcceptor> m_acceptor;
 *     string m_passwordHash, m_passwordSalt;
 *     ...
 *   };
 *
 * Transport: WebSocket (replaces Steam Networking Sockets).
 */

import type { WebSocket } from 'ws';
import { PacketType, ConnectionStatus, MAX_PLAYERS } from '@wov/shared';
import { Peer } from './Peer.js';
import { WebSocketAcceptor } from './WebSocketAcceptor.js';
import { Reader } from '../io/Reader.js';
import { Writer } from '../io/Writer.js';
import { getStableHash } from '../util/Hash.js';
import { Drossel } from './Drossel.js';
import {
  nonceErzeugen,
  antwortPruefen,
  spielerIdErzeugen,
  istSpielerId,
  tokenAusstellen,
  tokenPruefen,
  type SpielerId,
} from './Identitaet.js';

export interface NetManagerConfig {
  port: number;
  password: string;
  serverName: string;
  maxPlayers: number;
  everyoneAdmin: boolean;
  /**
   * F3 (Security-Review): Servergeheimnis fuer die SessionToken-Signatur.
   * NetManager erzeugt/laedt es NICHT selbst — Herkunft und die bewusste
   * Entscheidung "nur im Arbeitsspeicher" stehen im Kopfkommentar von
   * WovServer.ts (Konstruktor, dort wo `sessionSecret` entsteht).
   */
  sessionSecret: Buffer;
  /**
   * S6 (Security-Review): zusaetzliche Admin-Berechtigung ueber die
   * stabile Spieler-ID, NEBEN `everyoneAdmin` (das bleibt Mikes
   * Handgriff und wird hier nicht abgeschaltet). Peer.isAdmin ist die
   * ODER-Verknuepfung beider Quellen.
   */
  istAdminId: (id: SpielerId) => boolean;
}

/**
 * Deckel für offene, noch nicht authentifizierte Verbindungen: onlinePeers.length
 * (die maxPlayers-Prüfung) bleibt bis zur erfolgreichen Anmeldung bei 0, und der
 * Pre-Auth-Ping wird immer beantwortet und hält damit den 10s-Timeout beliebig
 * lange hinaus — ohne diesen Deckel könnte eine Flut nie authentifizierter
 * Sockets unbegrenzt Peer-Objekte ansammeln, bevor maxPlayers je greift.
 */
const MAX_PENDING_CONNECTIONS = 50;

/**
 * Protokollversion (F3/F4, Security-Review): auf 2 angehoben, weil der
 * Handshake sich UNVERTRAEGLICH geaendert hat (AuthChallenge/Nonce, neue
 * PasswordAuth-Felder). Ein alter Client sendet weiterhin Version 1 und
 * bekommt hier eine normale, lesbare Disconnect-Meldung — genau den Pfad,
 * den es fuer Versions-Mismatches schon vorher gab. Kein stiller Abbruch,
 * kein Sonderfall: der bestehende Mechanismus traegt die neue Bedeutung
 * "Client zu alt fuer den neuen Handshake" von selbst mit.
 */
const PROTOCOL_VERSION = 2;

export class NetManager {
  private acceptor: WebSocketAcceptor;
  private connectedPeers: Peer[] = [];
  private onlinePeers: Peer[] = [];

  readonly config: NetManagerConfig;

  /**
   * A4 (Security-Review): Token-Bucket-Drosselung je Peer und Pakettyp,
   * VOR jeder weiteren Verarbeitung (handlePacket). Lebt hier und nicht
   * in WovServer, weil das der fruehestmoegliche Punkt im Paketpfad ist —
   * noch vor dem Auth-Gate, das ohne eigene Drosselung selbst ein
   * Log-Flood-Ziel war (siehe handlePacket).
   */
  private readonly drossel = new Drossel();

  /** Callbacks for server integration */
  onPeerAuthenticated: ((peer: Peer) => void) | null = null;
  onPeerQuit: ((peer: Peer) => void) | null = null;
  onPacket: ((peer: Peer, type: PacketType, reader: Reader) => void) | null = null;

  private playerListAccumulator = 0;

  constructor(config: NetManagerConfig) {
    this.config = config;
    this.acceptor = new WebSocketAcceptor();
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  start(): void {
    this.acceptor.listen(this.config.port, (socket, address) => {
      this.handleNewConnection(socket, address);
    });
    console.log(`[NetManager] Started on port ${this.config.port}`);
  }

  stop(): void {
    for (const peer of this.onlinePeers) {
      peer.disconnect('Server shutting down');
    }
    this.acceptor.close();
  }

  update(deltaMs: number): void {
    // Periodic player list broadcast (C++ SendPlayerList)
    this.playerListAccumulator += deltaMs;
    if (this.playerListAccumulator >= 2000) {
      this.playerListAccumulator = 0;
      this.sendPlayerList();
    }
  }

  // ── Connection handling ──────────────────────────────────────────

  private handleNewConnection(socket: WebSocket, address: string): void {
    // Check server full
    if (this.onlinePeers.length >= this.config.maxPlayers) {
      socket.close(1000, 'Server full');
      return;
    }

    // Deckel gegen unbegrenzt viele offene, nie authentifizierte Sockets
    // (siehe Kommentar bei MAX_PENDING_CONNECTIONS).
    if (this.connectedPeers.length >= MAX_PENDING_CONNECTIONS) {
      socket.close(1000, 'Too many pending connections');
      return;
    }

    // Create a temporary peer (name assigned after auth)
    const peer = new Peer(socket, `pending_${address}`, 0n);
    this.connectedPeers.push(peer);

    socket.binaryType = 'nodebuffer';

    socket.on('message', (data: Buffer) => {
      // Ein kaputtes/abgeschnittenes Paket darf NIE den Prozess beenden
      // (Reader wirft RangeError) — der Verursacher fliegt stattdessen.
      try {
        this.handlePacket(peer, data);
      } catch (err) {
        console.error(
          `[NetManager] Paketfehler von ${peer.name}: ${err instanceof Error ? err.message : String(err)} — Verbindung wird getrennt`
        );
        socket.close();
      }
    });

    socket.on('close', () => {
      this.handleDisconnect(peer);
    });

    socket.on('error', (err: Error) => {
      console.error(`[NetManager] Socket error for ${peer.name}: ${err.message}`);
    });

    // Send version check request
    peer.sendPacketWith(PacketType.VersionCheck, (w) => {
      w.writeInt32(PROTOCOL_VERSION);
      w.writeString(this.config.serverName);
    });
  }

  private handlePacket(peer: Peer, data: Buffer): void {
    if (data.length < 1) return;

    const type = data.readUInt8(0) as PacketType;
    const payload = data.subarray(1);
    const reader = new Reader(Buffer.from(payload));
    const jetzt = Date.now();
    peer.letztesPaket = jetzt;

    // Heartbeat: Ping wird geechot und NICHT weitergereicht — er hält nur
    // letztesPaket frisch (auch bei Tab im Hintergrund, Review-Punkt 11/27).
    if (type === PacketType.Ping) {
      peer.sendPacket(PacketType.Ping, Buffer.alloc(0));
      return;
    }

    // A4 (Security-Review): Drosselung VOR jeder weiteren Arbeit. Die
    // Handshake-Pakete (VersionCheck, AuthChallenge, PasswordAuth) haben
    // ABSICHTLICH keinen Eintrag in STANDARD_DROSSEL (siehe Drossel.ts
    // Kopfkommentar) und bleiben dadurch immer erlaubt — der Handshake
    // wird durch diese Zeile also nie abgewürgt, alles andere schon.
    if (!this.drossel.erlaubt(peer.verbindungsId, type, jetzt)) {
      return;
    }

    // Auth-Gate: Vor der Authentifizierung sind NUR Handshake-Pakete
    // erlaubt — alles andere (Input, Angriffe, Editor-Saves, Admin)
    // wurde vorher ungeprüft geroutet (Review-Punkt 1).
    if (
      !peer.authenticated &&
      type !== PacketType.VersionCheck &&
      type !== PacketType.PasswordAuth
    ) {
      // A4 (Security-Review): Drosselung der LOGZEILE selbst, hoechstens
      // einmal pro Sekunde je Peer — ohne das schrieb ein Flood
      // unerlaubter Pakete vor der Anmeldung eine Zeile PRO PAKET und
      // fuellte das Journal in Sekunden. Das Paket wird trotzdem bei
      // JEDEM Treffer verworfen, nur das Loggen ist gedrosselt.
      if (jetzt - peer.letzteVorAuthWarnung > 1000) {
        peer.letzteVorAuthWarnung = jetzt;
        console.warn(`[NetManager] Paket type=${type} vor Auth von ${peer.name} — verworfen (weitere werden bis zu 1s lang still verworfen)`);
      }
      return;
    }

    switch (type) {
      case PacketType.VersionCheck:
        this.handleVersionCheck(peer, reader);
        break;
      case PacketType.PasswordAuth:
        this.handlePasswordAuth(peer, reader);
        break;
      case PacketType.PlayerInput:
      case PacketType.ChatMessage:
      case PacketType.RpcCall:
      case PacketType.SetTimeOfDay:
      case PacketType.AdminCommand:
        // Forward to server for processing
        this.onPacket?.(peer, type, reader);
        break;
      default:
        // Forward unknown types to server
        this.onPacket?.(peer, type, reader);
        break;
    }
  }

  /**
   * Stille Verbindungen trennen: authentifizierte Peers nach 30 s ohne
   * Paket (Client pingt alle 5 s), unauthentifizierte nach 10 s — vorher
   * blieben halboffene Sockets für immer bestehen (Review-Punkt 27).
   */
  pruefeTimeouts(): void {
    const jetzt = Date.now();
    for (const peer of [...this.connectedPeers]) {
      const still = jetzt - peer.letztesPaket;
      const limit = peer.authenticated ? 30_000 : 10_000;
      if (still > limit) {
        console.warn(`[NetManager] ${peer.name}: ${Math.round(still / 1000)}s still — Timeout`);
        peer.trenne();
      }
    }
  }

  private handleVersionCheck(peer: Peer, reader: Reader): void {
    const clientVersion = reader.readInt32();
    if (clientVersion !== PROTOCOL_VERSION) {
      peer.status = ConnectionStatus.ErrorVersion;
      peer.disconnect(
        `Client-Version veraltet (Client v${clientVersion}, Server v${PROTOCOL_VERSION}) — bitte Seite neu laden`
      );
      return;
    }
    // F4 (Security-Review): pro Verbindung EIN Nonce, danach wartet der
    // Server auf PasswordAuth als Antwort. Ersetzt den frueheren
    // "PeerInfo als Trigger"-Umweg: die alte Auth brauchte irgendein
    // Signal, um den Client zum Senden von PasswordAuth zu bewegen — jetzt
    // gibt es dafuer ein eigenes, semantisch klares Paket.
    const nonce = nonceErzeugen();
    peer.authNonce = nonce;
    peer.sendPacketWith(PacketType.AuthChallenge, (w) => {
      w.writeString(nonce);
    });
  }

  private handlePasswordAuth(peer: Peer, reader: Reader): void {
    const antwort = reader.readString();
    const playerName = reader.readString();
    const sessionToken = reader.readString();

    // F4 (Security-Review): Nonce ist EINMALIG und wird HIER verbraucht,
    // unabhaengig vom Ausgang — ein zweiter PasswordAuth-Versuch (egal ob
    // vom selben oder einem anderen Absender) trifft dann auf "kein Nonce
    // vorhanden" und faellt automatisch auf Ablehnung, ganz ohne
    // Sonderfall-Code. Das ist der Replay-Schutz.
    const nonce = peer.authNonce;
    peer.authNonce = null;
    if (!nonce || !antwortPruefen(nonce, this.config.password, antwort)) {
      peer.status = ConnectionStatus.ErrorPassword;
      peer.disconnect('Wrong password');
      return;
    }

    // Check duplicate name
    if (this.onlinePeers.some(p => p.name === playerName)) {
      peer.status = ConnectionStatus.ErrorAlreadyConnected;
      peer.disconnect('Name already in use');
      return;
    }

    // F3 (Security-Review, schliesst Luecke A + B): Identitaet kommt
    // AUSSCHLIESSLICH vom Server. Ein gueltiges SessionToken liefert eine
    // zuvor ausgestellte spielerId + die dabei eingefrorene Altlast-userId
    // zurueck. Fehlt das Token, ist es abgelaufen ODER gefaelscht/
    // manipuliert (auch: ein Token mit falscher Form), gibt es KEINEN
    // stillen Rueckfall auf irgendein Client-Feld — es entsteht eine
    // VOLLSTAENDIG NEUE, vom Server gewuerfelte Identitaet. Damit fliesst
    // ein frei vom Client gelieferter String an keiner Stelle mehr in
    // spielerId oder userId ein (bisher: userIdStr direkt bzw. gehasht
    // uebernommen — das war die Wurzel beider Luecken).
    let spielerId: SpielerId;
    let altlastUserId: bigint;
    const geprueft = sessionToken
      ? tokenPruefen(sessionToken, this.config.sessionSecret)
      : ({ status: 'gefaelscht' } as const);
    if (geprueft.status === 'gueltig' && istSpielerId(geprueft.spielerId)) {
      spielerId = geprueft.spielerId;
      altlastUserId = geprueft.altlastUserId;
    } else {
      spielerId = spielerIdErzeugen();
      // Altlast-userId dient ausschliesslich der ZDO-Besitzzuordnung
      // (peer.userId, BigInt — siehe WovServer.ts) und wird ab jetzt fuer
      // die gesamte Lebensdauer dieser spielerId im SessionToken
      // eingefroren. Abgeleitet aus der frisch gewuerfelten, unerratbaren
      // spielerId statt aus irgendeinem Client-Feld — ein Angreifer kann
      // also weder die spielerId noch die daraus abgeleitete userId
      // beeinflussen.
      altlastUserId = BigInt(getStableHash(spielerId) & 0x7fffffff);
    }

    (peer as { name: string }).name = playerName;
    peer.spielerId = spielerId;
    peer.userId = altlastUserId;
    peer.authenticated = true;
    peer.status = ConnectionStatus.Connected;
    // S6 (Security-Review): everyoneAdmin bleibt Mikes Handgriff (wird
    // hier NICHT abgeschaltet) — zusaetzlich zaehlt jetzt auch die
    // dauerhafte Admin-Liste ueber die stabile spielerId.
    peer.isAdmin = this.config.everyoneAdmin || this.config.istAdminId(spielerId);

    // Move from connected to online
    const idx = this.connectedPeers.indexOf(peer);
    if (idx !== -1) this.connectedPeers.splice(idx, 1);
    this.onlinePeers.push(peer);

    // Token (re)ausstellen: verlaengert die Sitzung um eine volle
    // Gueltigkeitsdauer ab JETZT — ob neue oder zurueckkehrende
    // Identitaet spielt keine Rolle, ein taeglich aktiver Spieler laeuft
    // so nie ab.
    const neuesToken = tokenAusstellen(spielerId, altlastUserId, this.config.sessionSecret);

    // Send peer info + server config (+ das aktuelle SessionToken)
    this.sendPeerInfo(peer, neuesToken);

    console.log(`[NetManager] ${playerName} authenticated (spielerId: ${spielerId}, userId: ${altlastUserId})`);
    this.onPeerAuthenticated?.(peer);
  }

  private handleDisconnect(peer: Peer): void {
    // A4 (Security-Review): Drosselzustand dieses Peers wieder heraus-
    // nehmen — sonst waechst die Map in Drossel.ts mit jedem jemals
    // verbundenen Peer unbegrenzt weiter (siehe Drossel.ts Kopfkommentar).
    this.drossel.raeumeAufFuerPeer(peer.verbindungsId);

    const connIdx = this.connectedPeers.indexOf(peer);
    if (connIdx !== -1) this.connectedPeers.splice(connIdx, 1);

    const onlineIdx = this.onlinePeers.indexOf(peer);
    if (onlineIdx !== -1) {
      this.onlinePeers.splice(onlineIdx, 1);
      console.log(`[NetManager] ${peer.name} disconnected`);
      this.onPeerQuit?.(peer);
    }
  }

  // ── Server → Client packets ──────────────────────────────────────

  private sendPeerInfo(peer: Peer, sessionToken = ''): void {
    peer.sendPacketWith(PacketType.PeerInfo, (w) => {
      w.writeString(peer.name);
      w.writeString(peer.userId.toString());
      w.writeString(this.config.serverName);
      // F3 (Security-Review): das (ggf. gerade neu ausgestellte)
      // SessionToken. Der Client legt es in localStorage ab und schickt
      // es bei der naechsten Verbindung als PasswordAuth-Feld zurueck.
      // PeerInfo geht jetzt NUR NOCH nach erfolgreicher Anmeldung raus
      // (kein Pre-Auth-"Trigger"-Versand mehr, siehe handleVersionCheck),
      // ein alter Client, der noch drei statt vier Felder liest, ignoriert
      // dieses zusaetzliche Feld einfach.
      w.writeString(sessionToken);
    });
  }

  private sendPlayerList(): void {
    const writer = new Writer();
    writer.writeInt32(this.onlinePeers.length);
    for (const p of this.onlinePeers) {
      writer.writeString(p.name);
      writer.writeString(p.userId.toString());
      writer.writeVector3(p.position);
      writer.writeInt32(p.ping);
    }
    const payload = writer.toBuffer();
    for (const p of this.onlinePeers) {
      p.sendPacket(PacketType.PlayerList, payload);
    }
  }

  // ── Peer lookup (C++ FindPeer*) ──────────────────────────────────

  findPeerByName(name: string): Peer | undefined {
    return this.onlinePeers.find(p => p.name === name);
  }

  findPeerByUserId(userId: bigint): Peer | undefined {
    return this.onlinePeers.find(p => p.userId === userId);
  }

  getPeers(): readonly Peer[] {
    return this.onlinePeers;
  }

  get peerCount(): number {
    return this.onlinePeers.length;
  }

  // ── Admin actions ────────────────────────────────────────────────

  kick(identifier: string): Peer | undefined {
    const peer = this.findPeerByName(identifier);
    if (peer) {
      peer.disconnect('Kicked by admin');
    }
    return peer;
  }
}
