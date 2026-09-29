/**
 * NetManager — manages all connected peers, handshake, and packet routing.
 * 1:1 port of the reference server's net manager.
 *
 * State held (as in the reference):
 *   - session indexes
 *   - connected peers and online peers
 *   - the acceptor
 *   - password hash and salt
 *
 * Transport: WebSocket (replaces the socket layer of the reference server).
 */

import type { WebSocket } from 'ws';
import { PacketType, ConnectionStatus, MAX_PLAYERS } from '@wov/shared';
import { Peer } from './Peer.js';
import { WebSocketAcceptor, type HttpBehandler } from './WebSocketAcceptor.js';
import { Reader } from '../io/Reader.js';
import { Writer } from '../io/Writer.js';
import { getStableHash } from '../util/Hash.js';
import { Drossel } from './Drossel.js';
import { EDITOR_NAME, nameHatSteuerzeichen, namenSchluessel, namenVarianten } from './Namen.js';
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
   * stabile Spieler-ID. Seit dem 13.09.2026 steht `everyoneAdmin` per
   * Vorgabe auf false, diese Funktion ist damit der Regelweg zu Rechten
   * und nicht mehr die Ergaenzung. Peer.isAdmin ist die
   * ODER-Verknuepfung beider Quellen.
   */
  istAdminId: (id: SpielerId) => boolean;
  /**
   * Optionaler HTTP-Behandler fuer den SPIELPORT. Damit beantwortet die
   * Konto-API (/api/konto/...) Anfragen auf 2467, statt einen zweiten
   * Host samt Zertifikat zu brauchen -- Begruendung in KontoApi.ts.
   */
  httpBehandler?: HttpBehandler;
  /**
   * Is this name held by an account character? A guest (an identity that
   * belongs to no character) may not wear it: two owners under one name
   * would mix saved state, bans and admin lookups that go by name.
   * Absent = no names are reserved (every test that starts a bare NetManager).
   */
  kontoNameBelegt?: (name: string) => boolean;
  /**
   * Look up the character an identity belongs to, or null when the token
   * predates accounts (or the character was deleted).
   *
   * NetManager deliberately gets a FUNCTION rather than the database: it
   * has no business knowing where accounts live, and this keeps the
   * dependency pointing one way.
   */
  charakterZuSpielerId?: (id: SpielerId) => { name: string } | null;
  /**
   * Darf dieser Zugang herein? null = ja, sonst der wirksame Bann.
   *
   * Wieder eine Funktion und nicht die Datenbank, aus demselben Grund wie
   * bei `charakterZuSpielerId`: worauf gebannt wird (Konto, Spieler-ID,
   * Herkunft) und wie sich das aufloest, entscheidet Kontendatenbank.ts —
   * NetManager stellt nur die Frage und traegt das Ergebnis vor.
   *
   * Fehlt die Funktion, gibt es keine Bannliste und niemand wird
   * abgewiesen. Das ist der Zustand jedes Tests, der NetManager ohne
   * Konten hochzieht, und darf ihn nicht zum Absturz bringen.
   */
  bannPruefen?: (zugang: { spielerId: SpielerId | null; herkunft: string; ausgestelltAm?: number })
    => { grund: string; bis: number | null } | null;
}

/**
 * Ablehnungstext fuer einen gebannten Zugang.
 *
 * Der Spieler soll lesen koennen, WARUM und BIS WANN — eine wortlose
 * Trennung ist von einem Serverfehler nicht zu unterscheiden, und dann
 * versucht er es im Minutentakt weiter.
 */
function bannMeldung(bann: { grund: string; bis: number | null }): string {
  const grund = bann.grund.trim();
  const teil = grund ? `: ${grund}` : '';
  if (bann.bis === null) return `Zugang dauerhaft gesperrt${teil}`;
  // Datum in Ortszeit des SERVERS, mit ausgeschriebenem Zeitzonenkuerzel —
  // eine blanke Zahl waere fuer den Gesperrten nicht lesbar.
  const bis = new Date(bann.bis).toLocaleString('de-DE', { timeZoneName: 'short' });
  return `Zugang gesperrt bis ${bis}${teil}`;
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

  /**
   * Herkunfts-Adresse je Verbindung, Schluessel `peer.verbindungsId`.
   *
   * Warum eine Map und kein Feld an Peer: Peer.ts gehoert in diesem Umbau
   * einem anderen Bauer, und die Adresse ist ohnehin eine Eigenschaft der
   * VERBINDUNG, nicht des Spielers — genau wie verbindungsId, an dem sie
   * hier haengt. Wird in handleDisconnect wieder herausgenommen, sonst
   * waechst sie wie der Drosselzustand unbegrenzt weiter.
   *
   * Der Wert kommt aus herkunftErmitteln() (WebSocketAcceptor), NICHT aus
   * socket.remoteAddress: hinter nginx waere das fuer jeden Spieler
   * 127.0.0.1, und ein Herkunftsbann wuerde dann alle aussperren.
   */
  private readonly herkunftJeVerbindung = new Map<string, string>();

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

  /** Resolves with the bound port once listening; rejects when the bind fails. */
  start(): Promise<number> {
    return this.acceptor.listen(
      this.config.port,
      (socket, address) => {
        this.handleNewConnection(socket, address);
      },
      this.config.httpBehandler,
    ).then((port) => {
      console.log(`[NetManager] Started on port ${port}`);
      return port;
    });
  }

  /** The port the acceptor is really bound to (null while not listening); see WebSocketAcceptor.boundPort. */
  get boundPort(): number | null {
    return this.acceptor.boundPort;
  }

  /**
   * Nimmt keine neuen Verbindungen mehr an, lässt die bestehenden aber
   * stehen (der Save beim Herunterfahren liest noch ihre Peers).
   */
  schliesseAnnahme(): void {
    this.acceptor.close();
  }

  stop(): void {
    for (const peer of this.onlinePeers) {
      peer.disconnect('Server shutting down');
    }
    this.acceptor.close();
  }

  update(deltaMs: number): void {
    // Periodic player list broadcast
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
    this.herkunftJeVerbindung.set(peer.verbindungsId, address);

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

    // C2 (Pruefung 2/3, Karte "Gaestebesitz — Folgen aus #102"): eine
    // Editor-Verbindung (nurEditor) steht nie in der Welt und hat kein
    // ZDO. GameSocket schickt ueber eine solche Verbindung tatsaechlich
    // nur drei Pakettypen (client/src/editor/DungeonNeuerSaal.ts,
    // DungeonSpeichern.ts, dungeon2/Dungeon2Speichern.ts — jeweils nur
    // EIN send*-Aufruf je Datei) plus den Grundverkehr, den GameSocket
    // beim Verbinden von selbst sendet: VersionCheck (GameSocket.ts:240)
    // und PasswordAuth (GameSocket.ts:272) ERREICHEN diese Zeile — der
    // switch steht dahinter, nicht davor (Berichtigung, Pruefung 4: die
    // vorige Fassung dieses Kommentars behauptete das Gegenteil). Sie
    // kommen trotzdem durch, weil `peer.nurEditor` in diesem Moment noch
    // `false` ist: Das Feld wird erst WEITER UNTEN in handlePasswordAuth
    // aus genau dem Paket gesetzt, das diese Pruefung gerade durchlaeuft
    // — zu spaet, um sich selbst noch zu blockieren. Ping
    // (GameSocket.ts:606) wird schon ganz oben in dieser Methode geechot
    // und erreicht diese Stelle nie. Eine gefaelschte nurEditor-Verbindung
    // (das Bit setzt der Client) konnte bisher jedes andere Paket senden,
    // das WovServer ueber onPacket bekommt — TerrainOp etwa kam beim
    // Zeugen als TerrainOpSync an, unsichtbar fuer jeden Admin-Namensweg,
    // weil alle Editoren "Editor" heissen.
    //
    // Die Allowlist ist deshalb nicht "was der Editor-CLIENT schickt",
    // sondern "was serverseitig schon sein eigenes isAdmin-Gate hat"
    // (Pruefung 2, Zeile 18: "Nur fuer Admins sind AdminCommand,
    // SetTimeOfDay und die vier Dungeon-Pakete"): AdminCommand
    // (handleAdminCommand -> this.adminCommands.execute, das intern
    // jeden Befehl gegen peer.isAdmin prueft) prueft isAdmin genauso wie
    // die drei Dungeon-Bau/Speicher-Handler. Ohne AdminCommand hier waere
    // der in Pruefung 2 §84 bestaetigte Weg "Admin ueber die spielerId"
    // (ein Admin-Editor fuehrt admin-Befehle ueber seine
    // Editor-Verbindung aus, etwa um eine Testinstanz aufzuraeumen)
    // zerstoert — genau das brach instanz-verwurf.ts, weil der Test einen
    // Editor-Admin per AdminCommand in eine Dungeon-Instanz stellt.
    //
    // SetTimeOfDay (handleSetTimeOfDay) und DungeonEditRequest
    // (handleDungeonEditRequest) pruefen isAdmin ebenso, stehen aber seit
    // dieser Nachbesserung (Pruefung 4, T1) NICHT mehr in der Liste: kein
    // Editor-Client und kein Werkzeug schickt sie ueber eine
    // nurEditor-Verbindung — beide Sender sitzen ausschliesslich in
    // client/src/main.ts, ueber die normale Spielverbindung ohne
    // nurEditor-Bit (git grep client/src/editor, GameSocket.ts, tools/,
    // admin/ zeigt keinen anderen Aufrufer). Die kleinere Liste ist die
    // kleinere Angriffsflaeche; kommt je ein echter Bedarf dazu, gehoert
    // ein Test dazu, der ihn belegt (server/test/gaeste-besitz.ts [F3b]
    // probiert deshalb ausdruecklich, dass ein ADMIN-Editor mit beiden
    // Typen nichts bewirkt).
    //
    // Diese Zeile nimmt keinem der vier verbleibenden Handler etwas, sie
    // verwirft nur, was ein Editor nie schickt und was KEIN eigenes
    // Rechte-Gate hat (PlayerInput, TerrainOp, PlacePiece, Interact, …).
    if (
      peer.nurEditor &&
      type !== PacketType.DungeonModulBau &&
      type !== PacketType.DungeonModulLoeschen &&
      type !== PacketType.DungeonEditSave &&
      type !== PacketType.AdminCommand
    ) {
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
    let playerName = reader.readString();
    const sessionToken = reader.readString();
    // ANGEHAENGTES Feld: Wer es nicht schickt, meint `false` — aeltere und
    // neuere Leser kommen sich so nicht in die Quere (dasselbe Muster wie
    // bei PlayerState). Es steht bewusst NACH der Token-Pruefung im
    // Ablauf: Eine Verbindung, die sich als Editor ausgibt, muss dieselbe
    // Anmeldung bestehen wie jede andere.
    const nurEditor = reader.remaining() > 0 ? reader.readBool() : false;

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

    // Bannpruefung — hier, und nicht frueher oder spaeter.
    //
    // Frueher geht nicht: vor tokenPruefen() steht die Identitaet noch gar
    // nicht fest, und ein Bann auf eine vom Client BEHAUPTETE Kennung waere
    // wertlos (dieselbe Falle wie beim Namen, s. unten).
    //
    // Spaeter waere schaedlich: gleich darunter loest eine zurueckkehrende
    // Identitaet ihre eigene aeltere Verbindung ab. Ein Gebannter koennte
    // sonst zwar nicht herein, aber mit jedem Versuch die noch laufende
    // Sitzung desselben Kontos abschiessen — und wer den Bann waehrend des
    // Spiels kassiert, wuerde sich selbst hinauswerfen.
    //
    // Die Herkunft kommt aus herkunftErmitteln() (WebSocketAcceptor) und
    // NICHT aus socket.remoteAddress; hinter dem Proxy waere die fuer alle
    // gleich.
    const herkunft = this.herkunftJeVerbindung.get(peer.verbindungsId) ?? '';
    const bann = this.config.bannPruefen?.({
      spielerId, herkunft,
      ausgestelltAm: geprueft.status === 'gueltig' ? geprueft.ausgestelltAm : undefined,
    }) ?? null;
    if (bann) {
      peer.status = ConnectionStatus.ErrorBanned;
      console.warn(`[NetManager] Gebannter Zugang abgewiesen (spielerId: ${spielerId}, Herkunft: ${herkunft || 'unbekannt'})`);
      peer.disconnect(bannMeldung(bann));
      return;
    }

    // The NAME comes from the account, not from the client.
    //
    // Until 2026-08-24 the browser sent it and the server believed it, so
    // anybody could appear under any name that happened to be free. Now
    // the session token identifies a character, and that character's row
    // carries the name -- there is nothing left to claim.
    //
    // The client-supplied name still applies when the token belongs to no
    // character: a direct visit to play.* without an account, which is
    // still how the connect screen works.
    const ausKonto = this.config.charakterZuSpielerId?.(spielerId) ?? null;
    if (ausKonto) playerName = ausKonto.name;
    // `nurEditor` is a bit the CLIENT sends, so it must unlock nothing: an
    // editor connection never carries a name the client picked. The server
    // fixes it (EDITOR_NAME), which no chat line, admin lookup or name check
    // ever resolves to a player (editor peers are skipped there).
    // Gast-Token: Ein Gast (Identitaet ohne Charakter) behaelt seine Kennung
    // ueber sein Token, den Namen waehlt er selbst -- aber keinen, den ein
    // Konto-Charakter traegt, und keinen mit Steuer- oder Nullbreiten-Zeichen.
    if (nurEditor) {
      playerName = EDITOR_NAME;
    } else if (!ausKonto) {
      if (nameHatSteuerzeichen(playerName)) {
        peer.status = ConnectionStatus.ErrorDisconnected;
        peer.disconnect('Invalid name');
        return;
      }
      // "Editor" is reserved for guests only (this check runs in the guest
      // branch): without it, a guest could sit in the world under the very
      // name every editor peer answers to. An account character may still
      // be named "Editor" -- it is told apart by player id, not by name
      // (C1, Pruefung 2).
      if (namenSchluessel(playerName) === namenSchluessel(EDITOR_NAME)) {
        peer.status = ConnectionStatus.ErrorAlreadyConnected;
        peer.disconnect('Name already in use');
        return;
      }
      if (namenVarianten(playerName).some((n) => this.config.kontoNameBelegt?.(n))) {
        peer.status = ConnectionStatus.ErrorAlreadyConnected;
        peer.disconnect('Name already in use');
        return;
      }
    }

    // Duplicate name — checked AFTER the identity is resolved, deliberately.
    //
    // Until 2026-08-23 this check ran first, and a returning player was
    // locked out by their own ghost: closing a tab does not drop the peer
    // right away, so signing in again from world-of-vikings.com hit
    // "Name already in use". The direct login (?los=1) then failed and the
    // old connect window appeared — precisely what the character creator
    // was built to replace.
    //
    // A matching spielerId means the SAME identity is returning, and the
    // session token proved that above. So drop the stale connection rather
    // than refuse the new one. A DIFFERENT player claiming a taken name is
    // still refused, exactly as before.
    // Eine Editor-Verbindung nimmt keinen Namen in Anspruch: Sie steht
    // nicht in der Welt, es kann sie also auch niemand doppelt sehen.
    //
    // Das ist nicht nur Ordnung, sondern der Punkt: Der Name kommt aus dem
    // Konto (s. oben), zwei Verbindungen derselben Kennung tragen also
    // denselben — und ohne diese Ausnahme loeste ein Klick auf
    // „Speichern" im Karteneditor den offenen Spielclient ab. Genau die
    // Schleife, fuer die der Editor gebaut ist.
    // C3 (Namensvergleich vereinheitlicht): namenSchluessel statt `===`,
    // wie die Gastregel darueber und `kick`/`bann herkunft` jetzt auch —
    // vorher liessen "Kai", "kai" und "Kai " gleichzeitig online stehen
    // (Pruefung 2 §3), obwohl der Anspruch "eine Normalisierungsstelle"
    // war.
    const schluesselNeu = namenSchluessel(playerName);
    const namensgleich = nurEditor
      ? undefined
      : this.onlinePeers.find((p) => !p.nurEditor && namenSchluessel(p.name) === schluesselNeu);
    if (namensgleich) {
      if (namensgleich.spielerId === spielerId) {
        namensgleich.disconnect('Von einer neuen Verbindung abgelöst');
        // Clean up synchronously: peer.disconnect() only closes the socket,
        // handleDisconnect would follow later. Until then two peers with the
        // same name would sit in onlinePeers.
        this.handleDisconnect(namensgleich);
      } else {
        peer.status = ConnectionStatus.ErrorAlreadyConnected;
        peer.disconnect('Name already in use');
        return;
      }
    }

    (peer as { name: string }).name = playerName;
    peer.nurEditor = nurEditor;
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
    this.herkunftJeVerbindung.delete(peer.verbindungsId);

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

  // Privacy fix (2026-09-27): userId and position used to go out for every
  // online peer, world-wide and unrange-checked — nobody reads this packet
  // client-side today (no PacketType.PlayerList listener anywhere), so both
  // fields only leaked account identity and live position. Name + ping is
  // what a future player-list UI needs; identity and position are dropped.
  private sendPlayerList(): void {
    const writer = new Writer();
    writer.writeInt32(this.onlinePeers.length);
    for (const p of this.onlinePeers) {
      writer.writeString(p.name);
      writer.writeInt32(p.ping);
    }
    const payload = writer.toBuffer();
    for (const p of this.onlinePeers) {
      p.sendPacket(PacketType.PlayerList, payload);
    }
  }

  // ── Peer lookup ──────────────────────────────────────────────────

  /**
   * C3: namenSchluessel statt `===`, wie die Doppelnamen-Pruefung oben.
   * B2 (Nachbesserung Pruefung 4): Editor-Peers bleiben aussen vor, genau
   * wie bei `spielerIdFuerName` und `spieler entfernen` — sie heissen
   * alle "Editor" und wuerden sonst `kick editor` reihenfolgeabhaengig
   * statt dem Konto-Charakter treffen.
   */
  findPeerByName(name: string): Peer | undefined {
    const schluessel = namenSchluessel(name);
    return this.onlinePeers.find(p => !p.nurEditor && namenSchluessel(p.name) === schluessel);
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
      peer.status = ConnectionStatus.ErrorKicked;
      peer.disconnect('Kicked by admin');
      // Synchron aufraeumen statt auf das close-Ereignis zu warten: bis
      // dahin stuende der Geworfene weiter in onlinePeers, taucht in der
      // Spielerliste auf und belegt seinen Namen. Genau dasselbe tut
      // handlePasswordAuth beim Abloesen einer alten Verbindung.
      this.handleDisconnect(peer);
    }
    return peer;
  }

  /**
   * Alle jetzt gebannten Verbindungen hinauswerfen.
   *
   * Eine Bannliste, die nur beim Anmelden greift, ist eine Bitte: wer schon
   * drin ist, bleibt drin, bis er von selbst geht. Der Adminbefehl traegt
   * den Bann in die Datenbank ein und ruft danach DIESE Methode — sie
   * fragt fuer jede offene Verbindung dieselbe Funktion wie der Handshake
   * (config.bannPruefen) und wirft raus, wer nicht mehr herein duerfte.
   *
   * Dass hier nicht "wirf Spieler X raus" steht, ist Absicht: der Aufrufer
   * muss dann nicht wissen, ob der Bann auf Konto, Spieler-ID oder
   * Herkunft lag, und ein Kontobann erwischt auch den zweiten Charakter
   * derselben Person, der gerade nebenher online ist. Der Preis ist eine
   * Abfrage je verbundenem Peer — bei einer zweistelligen Spielerzahl und
   * einem Adminbefehl als Ausloeser ist das keine Rechnung wert.
   *
   * Liefert die getrennten Peers zurueck, damit der Befehl melden kann,
   * wen es getroffen hat.
   */
  trenneGebannte(): Peer[] {
    if (!this.config.bannPruefen) return [];
    const getroffen: Peer[] = [];
    // Kopie: handleDisconnect veraendert beide Listen waehrend des Laufs.
    for (const peer of [...this.onlinePeers, ...this.connectedPeers]) {
      if (!peer.authenticated) continue;
      const herkunft = this.herkunftJeVerbindung.get(peer.verbindungsId) ?? '';
      const bann = this.config.bannPruefen({ spielerId: peer.spielerId || null, herkunft });
      if (!bann) continue;
      peer.status = ConnectionStatus.ErrorBanned;
      peer.disconnect(bannMeldung(bann));
      this.handleDisconnect(peer);
      getroffen.push(peer);
    }
    return getroffen;
  }

  /**
   * Alle Verbindungen dieser Spieler-Kennungen trennen (auch Editor-
   * Verbindungen) — nach einem Passwortwechsel: das Token, mit dem sie
   * hereinkamen, gilt nicht mehr. Trennt die Peers als Objekte, nicht ueber
   * ihren Namen (der kann mehreren Verbindungen gehoeren). Der Spielstand
   * bleibt: `onPeerQuit` schreibt ihn wie bei jedem Verlassen.
   */
  trenneSpieler(spielerIds: readonly string[], grund: string): Peer[] {
    const ids = new Set(spielerIds);
    const getroffen: Peer[] = [];
    for (const peer of [...this.onlinePeers, ...this.connectedPeers]) {
      if (!peer.authenticated || !ids.has(peer.spielerId)) continue;
      peer.status = ConnectionStatus.ErrorKicked;
      peer.disconnect(grund);
      this.handleDisconnect(peer);
      getroffen.push(peer);
    }
    return getroffen;
  }

  /**
   * Herkunfts-Adresse einer offenen Verbindung, '' wenn unbekannt.
   *
   * Damit kann der Adminbefehl `bann <Name> herkunft` die Adresse dessen
   * bannen, der gerade verbunden ist — ohne sie irgendwo hinschreiben zu
   * muessen, wo sie nicht hingehoert. Sie steht bewusst NICHT an Peer:
   * eine IP ist kein Spielzustand, und je weniger Code sie sieht, desto
   * weniger Wege gibt es, sie versehentlich zu verschicken.
   */
  herkunftVon(peer: Peer): string {
    return this.herkunftJeVerbindung.get(peer.verbindungsId) ?? '';
  }
}
