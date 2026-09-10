/**
 * GameSocket — WebSocket client for server communication (Phase 2).
 * Ported 1:1 from the first prototype client (protocol code only, no
 * engine dependencies). Binary framing: [type: u8][payload].
 */

import { PacketType, HANDSHAKE_LEERPASSWORT_SCHLUESSEL, moduleRegistry } from '@wov/shared';
import type { Vector3, Quaternion } from '@wov/shared';

/**
 * Ein DECODER für die ganze Sitzung statt einer je Zeichenkette.
 *
 * `new TextDecoder()` je `readString()` war der teuerste Posten des
 * Netzpfads: Jedes ZDO-Update trägt mindestens eine `userId`, die Updates
 * kommen im 20-Hz-Takt gebündelt — das sind hunderte kurzlebige Objekte
 * pro Sekunde, und jedes von ihnen zieht intern eine ICU-Instanz nach.
 * Der Decoder ist zustandslos, solange man ihn ohne `{ stream: true }`
 * benutzt; eine geteilte Instanz ist also nicht nur billiger, sondern
 * auch gleichwertig.
 */
const DECODER = new TextDecoder();
/** Dasselbe für die Senderichtung — s. DECODER. */
const ENCODER = new TextEncoder();

/**
 * localStorage-Schlüssel für das SessionToken (F3, Security-Review).
 *
 * Der Server vergibt die Spieler-Identität jetzt selbst und schickt bei
 * jeder erfolgreichen Anmeldung ein signiertes SessionToken zurück
 * (NetManager.sendPeerInfo). Der Client legt es hier ab und schickt es
 * beim nächsten Connect als Nachweis mit (PasswordAuth.sessionToken) —
 * damit bleibt die Identität über einen Reload/Neustart des Browsers
 * hinweg stabil (und mit ihr der ZDO-Besitz eigener Bauten), solange der
 * Server währenddessen nicht neu gestartet ist (siehe WovServer.ts,
 * Kopfkommentar zu `sessionSecret`, für die Grenze dieser Zusicherung).
 */
const SESSION_TOKEN_KEY = 'wov-session-token';

/**
 * HMAC-SHA256(key, message) → hex, über die Web-Crypto-API (F4,
 * Security-Review). Ersetzt den früheren rohen getStableHash-Vergleich:
 * der Server schickt einen Nonce (AuthChallenge), der Client antwortet
 * mit dem HMAC über genau diesen Nonce, das Passwort verlässt den
 * Browser also nie im Klartext UND nicht als wiederverwendbarer Hash.
 *
 * Erfordert einen sicheren Kontext (https oder localhost) — `crypto.subtle`
 * existiert sonst nicht. Für diese Codebasis (WebSocket-Spiel, auf einem
 * öffentlich erreichbaren Server ohnehin nur über https sinnvoll) keine
 * zusätzliche Einschränkung.
 */
async function hmacSha256Hex(schluessel: string, nachricht: string): Promise<string> {
  // Leeres Passwort auf den gemeinsamen Ersatzschluessel abbilden. WebCrypto
  // lehnt einen leeren HMAC-Schluessel ab ("DataError: HMAC key data must not
  // be empty"), Node nicht — ohne diese Abbildung schlaegt im Browser JEDE
  // Anmeldung fehl, solange kein Serverpasswort gesetzt ist. Begruendung und
  // Wert stehen in shared/src/protocol.ts.
  const wirklicherSchluessel =
    schluessel === '' ? HANDSHAKE_LEERPASSWORT_SCHLUESSEL : schluessel;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(wirklicherSchluessel),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatur = await crypto.subtle.sign('HMAC', cryptoKey, ENCODER.encode(nachricht));
  return Array.from(new Uint8Array(signatur))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Minimal binary reader for client-side packet parsing */
export class BinaryReader {
  private view: DataView;
  private pos = 0;

  /**
   * @param byteOffset Erstes zu lesendes Byte im Puffer.
   *
   * Das Feld existiert, damit der Nutzlast-Leser eines Pakets OHNE Kopie
   * auskommt: Vorher stand dort `new BinaryReader(data.slice(1))`, und
   * `slice` kopiert den ganzen Rest des Pakets — bei einem ZDO-Bündel
   * mehrere Kilobyte, im 20-Hz-Takt.
   *
   * Das Muster dagegen steht in dieser Klasse längst: `readString()` legt
   * seine Bytes als SICHT auf den bestehenden Puffer an
   * (`new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos,
   * len)`) statt sie herauszukopieren. Es war nur nicht durchgezogen —
   * und weil readString den `byteOffset` bereits mitrechnet, trägt es
   * einen versetzten Leser ohne weitere Änderung mit.
   */
  constructor(buffer: ArrayBuffer, byteOffset = 0) {
    this.view = new DataView(buffer, byteOffset);
  }

  readBool(): boolean { return this.view.getUint8(this.pos++) !== 0; }
  readInt8(): number { const v = this.view.getInt8(this.pos); this.pos += 1; return v; }
  readUInt8(): number { return this.view.getUint8(this.pos++); }
  readInt32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  readUInt32(): number { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  readFloat32(): number { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  readFloat64(): number { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }

  skip(n: number): void { this.pos += n; }

  /**
   * Rohbytes mit vorangestellter Länge (Writer.writeBytes). Die Kopie ist
   * Absicht: Der Aufrufer bekommt einen eigenständigen Puffer, der den
   * Paketpuffer nicht am Leben hält.
   */
  readBytes(): Uint8Array {
    const len = this.readVarInt();
    const start = this.view.byteOffset + this.pos;
    this.pos += len;
    return new Uint8Array(this.view.buffer.slice(start, start + len));
  }

  readVarInt(): number {
    let result = 0, shift = 0, byte: number;
    do {
      byte = this.view.getUint8(this.pos++);
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return (result >>> 1) ^ -(result & 1);
  }

  readString(): string {
    const len = this.readVarInt();
    if (len === 0) return '';
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, len);
    this.pos += len;
    return DECODER.decode(bytes);
  }

  readVector3(): Vector3 {
    return { x: this.readFloat32(), y: this.readFloat32(), z: this.readFloat32() };
  }

  readQuaternion(): Quaternion {
    return { x: this.readFloat32(), y: this.readFloat32(), z: this.readFloat32(), w: this.readFloat32() };
  }

  get remaining(): number { return this.view.byteLength - this.pos; }
}

/** Minimal binary writer for client-side packets */
class BinaryWriter {
  private buf: number[] = [];

  writeBool(v: boolean) { this.buf.push(v ? 1 : 0); }
  writeInt32(v: number) {
    const b = new ArrayBuffer(4); new DataView(b).setInt32(0, v, true);
    this.buf.push(...new Uint8Array(b));
  }
  writeFloat32(v: number) {
    const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, true);
    this.buf.push(...new Uint8Array(b));
  }
  writeFloat64(v: number) {
    const b = new ArrayBuffer(8); new DataView(b).setFloat64(0, v, true);
    this.buf.push(...new Uint8Array(b));
  }
  writeString(v: string) {
    const encoded = ENCODER.encode(v);
    let len = encoded.length;
    let zigzag = ((len << 1) ^ (len >> 31)) >>> 0;
    do {
      const byte = zigzag & 0x7f;
      zigzag >>>= 7;
      this.buf.push(zigzag ? byte | 0x80 : byte);
    } while (zigzag);
    // Schleife statt Spread: push(...arr) legt jedes Byte als Argument auf
    // den Stack — bei Editor-Dokumenten (>64k Bytes JSON) platzt der.
    for (let i = 0; i < encoded.length; i++) this.buf.push(encoded[i]!);
  }

  toUint8Array(): Uint8Array { return new Uint8Array(this.buf); }
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<PacketType, Array<(reader: BinaryReader) => void>> = new Map();
  private inputSeq = 0;
  private authSent = false;
  private _pendingPassword = '';

  readonly url: string;
  readonly playerName: string;
  connected = false;
  /** Own user ID assigned by the server (from PeerInfo). */
  ownUserId = '';

  onConnected: (() => void) | null = null;
  onDisconnected: ((reason?: string) => void) | null = null;
  private disconnectReason = '';
  private readonly nurEditor: boolean = false;

  /**
   * @param nurEditor Verbindung, die nur Editor-Pakete schickt und die Welt
   *   nicht betritt (Karteneditor, `DungeonSpeichern.ts`). Der Server legt
   *   dafuer keinen Charakter an und nimmt den Namen nicht in die
   *   Namensvergabe auf — ein offener Spielclient bleibt also verbunden.
   */
  constructor(url: string, playerName: string, nurEditor = false) {
    this.url = url;
    this.playerName = playerName;
    this.nurEditor = nurEditor;
  }

  connect(password = ''): void {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => console.log('[GameSocket] Connected to', this.url);
    this.ws.onmessage = (event) => this.handleMessage(event.data as ArrayBuffer);
    this.ws.onclose = () => {
      this.connected = false;
      this.stoppePing();
      this.onDisconnected?.(this.disconnectReason);
    };
    this.ws.onerror = (err) => console.error('[GameSocket] Error:', err);

    this._pendingPassword = password;
  }

  private handleMessage(data: ArrayBuffer): void {
    const reader = new BinaryReader(data);
    const type = reader.readUInt8() as PacketType;

    switch (type) {
      case PacketType.VersionCheck: {
        const w = new BinaryWriter();
        // F3/F4 (Security-Review): Protokollversion 2 — der Handshake hat
        // sich unverträglich geändert (AuthChallenge/Nonce statt PeerInfo
        // als Trigger, neue PasswordAuth-Felder). Ein Server, der noch
        // Version 1 erwartet, gibt es auf diesem Server nicht mehr; die
        // Konstante muss mit NetManager.ts (PROTOCOL_VERSION) übereinstimmen.
        w.writeInt32(2);
        this.sendPacket(PacketType.VersionCheck, w.toUint8Array());
        break;
      }
      case PacketType.Disconnect: {
        this.disconnectReason = reader.readString();
        console.warn('[GameSocket] Server disconnect:', this.disconnectReason);
        break;
      }
      case PacketType.AuthChallenge: {
        // F4 (Security-Review): Nonce/HMAC-Passwort-Handshake. Antwort ist
        // HMAC-SHA256(key=Passwort, data=nonce) — das Passwort selbst
        // verlässt den Browser nie, und die Antwort ist nur für DIESEN
        // Nonce gültig (kein Replay). `crypto.subtle` ist async, der Rest
        // des Handshakes wartet deshalb hier auf das Promise.
        const nonce = reader.readString();
        if (!this.authSent) {
          this.authSent = true;
          void (async () => {
            const antwort = await hmacSha256Hex(this._pendingPassword, nonce);
            const w = new BinaryWriter();
            w.writeString(antwort);
            w.writeString(this.playerName);
            // F3 (Security-Review): das zuvor vom Server ausgestellte
            // SessionToken — '' bei Erstverbindung oder geleertem
            // localStorage. Der Server entscheidet allein anhand dessen
            // (nie anhand eines frei gewählten Feldes), welche Identität
            // dieser Peer bekommt.
            w.writeString(localStorage.getItem(SESSION_TOKEN_KEY) ?? '');
            // ANGEHAENGT, nicht eingeschoben: Ein Server, der das Feld noch
            // nicht kennt, liest die drei Zeichenketten davor unveraendert
            // und ignoriert den Rest.
            w.writeBool(this.nurEditor);
            this.sendPacket(PacketType.PasswordAuth, w.toUint8Array());
            this.connected = true;
            this.startePing();
            this.onConnected?.();
          })().catch((fehler: unknown) => {
            // Ohne dieses catch verschwindet hier JEDER Fehler spurlos: Der
            // Client sendet dann keine Antwort, der Server laeuft nach zehn
            // Sekunden in seinen Timeout, und im Browser steht nichts —
            // weder Meldung noch Warnung. Genau diese Stille hat am
            // 20.08.2026 die Suche nach dem leeren HMAC-Schluessel so teuer
            // gemacht. Ein stiller Handshake-Fehler darf es nicht mehr geben.
            console.error('[GameSocket] Handshake-Antwort fehlgeschlagen:', fehler);
            this.disconnectReason = 'Handshake fehlgeschlagen — Einzelheiten in der Browser-Konsole';
            this.disconnect();
          });
        }
        break;
      }
      case PacketType.PeerInfo: {
        // Geht seit F3 NUR NOCH nach erfolgreicher Anmeldung raus (kein
        // Pre-Auth-"Trigger"-Versand mehr, das übernimmt AuthChallenge) —
        // hier wird nur noch das Ergebnis übernommen, nichts mehr gesendet.
        reader.readString(); // eigener Anzeigename (Server-Echo)
        this.ownUserId = reader.readString();
        reader.readString(); // serverName
        const sessionToken = reader.readString();
        if (sessionToken) localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
        break;
      }
      default:
        break;
    }

    const handlers = this.handlers.get(type);
    if (handlers) {
      // Versetzte SICHT statt Kopie — s. BinaryReader-Konstruktor.
      const payloadReader = new BinaryReader(data, 1);
      for (const h of handlers) h(payloadReader);
    }
  }

  on(type: PacketType, handler: (reader: BinaryReader) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  sendPacket(type: PacketType, payload: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const packet = new Uint8Array(1 + payload.length);
    packet[0] = type;
    packet.set(payload, 1);
    this.ws.send(packet.buffer);
  }

  /**
   * Eingabe senden — GIBT die vergebene Sequenznummer ZURÜCK.
   *
   * Der Rückgabewert ist neu und der einzige ehrliche Weg, wie der
   * Aufrufer erfährt, unter welcher Nummer diese Eingabe abging: Der
   * Zähler lebt hier drin, und der Abgleich
   * (client/src/net/Positionsverlauf.ts) muss zu genau dieser Nummer
   * die eigene Position ablegen. Ein zweiter Zähler im Aufrufer liefe
   * beim ersten übersprungenen Paket auseinander, und der Abgleich
   * verglich dann stillschweigend die falschen zwei Zeitpunkte.
   */
  sendPlayerInput(
    moveX: number, moveZ: number,
    lookYaw: number, lookPitch: number,
    moveY: number,
    running: boolean, jumping: boolean
  ): number {
    const w = new BinaryWriter();
    const seq = ++this.inputSeq;
    w.writeInt32(seq);
    w.writeFloat32(moveX);
    w.writeFloat32(moveZ);
    w.writeFloat32(lookYaw);
    w.writeFloat32(lookPitch);
    w.writeFloat32(moveY);
    w.writeBool(running);
    w.writeBool(jumping);
    this.sendPacket(PacketType.PlayerInput, w.toUint8Array());
    return seq;
  }

  sendAdminCommand(command: string): void {
    const w = new BinaryWriter();
    w.writeString(command);
    this.sendPacket(PacketType.AdminCommand, w.toUint8Array());
  }

  /** Craft-Wunsch — Zutatenprüfung und Abzug macht der Server. */
  sendCraft(ergebnis: string): void {
    const w = new BinaryWriter();
    w.writeString(ergebnis);
    this.sendPacket(PacketType.Craft, w.toUint8Array());
  }

  /** Essen (Taste F) — Bestand prüft und zieht der Server ab. */
  sendEat(itemName: string): void {
    const w = new BinaryWriter();
    w.writeString(itemName);
    this.sendPacket(PacketType.Eat, w.toUint8Array());
  }

  /** Bau-Piece setzen (Hammer). */
  sendPlacePiece(prefabHash: number, x: number, y: number, z: number, rot: Quaternion): void {
    const w = new BinaryWriter();
    w.writeInt32(prefabHash);
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    w.writeFloat32(rot.x);
    w.writeFloat32(rot.y);
    w.writeFloat32(rot.z);
    w.writeFloat32(rot.w);
    this.sendPacket(PacketType.PlacePiece, w.toUint8Array());
  }

  /** Eigenes Bau-Piece abreissen (Hammer, mittlere Maustaste). */
  sendRemovePiece(x: number, y: number, z: number): void {
    const w = new BinaryWriter();
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    this.sendPacket(PacketType.RemovePiece, w.toUint8Array());
  }

  /** Terrain-Werkzeug (Hacke/Pflug/Spitzhacke) — Server wendet an + broadcastet. */
  sendTerrainOp(x: number, y: number, z: number, settingsJson: string): void {
    const w = new BinaryWriter();
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    w.writeString(settingsJson);
    this.sendPacket(PacketType.TerrainOp, w.toUint8Array());
  }

  /** Nahkampfschlag an der Spielerposition (weapon = Item-Name, '' = Faust). */
  sendAttack(x: number, y: number, z: number, yaw: number, weapon = ''): void {
    const w = new BinaryWriter();
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    w.writeFloat32(yaw);
    w.writeString(weapon);
    this.sendPacket(PacketType.Attack, w.toUint8Array());
  }

  /** Parade (Rechtsklick mit Waffe): kein Payload, der Server oeffnet das Fenster. */
  sendParry(): void {
    this.sendPacket(PacketType.Parry, new Uint8Array(0));
  }

  /** Interaktion (E): Position + Prefab-Hash des Ziels. */
  sendInteract(x: number, y: number, z: number, prefabHash: number): void {
    const w = new BinaryWriter();
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    w.writeInt32(prefabHash);
    this.sendPacket(PacketType.Interact, w.toUint8Array());
  }

  /**
   * Truhen-Aktion (F1, Roadmap): Stapel zwischen eigenem Inventar und
   * einer offenen Truhe umschichten. `richtung`: 0 = aus der Truhe
   * nehmen, 1 = hineinlegen. `zdoUserId`/`zdoId` kommen aus dem zuletzt
   * empfangenen ContainerSync (WovServer.sendeTruheInhalt) — der Client
   * erfindet keine ZDOID, er reicht nur zurück, was der Server ihm
   * gerade erst geschickt hat.
   */
  sendContainerAction(
    zdoUserId: string,
    zdoId: number,
    richtung: 0 | 1,
    itemName: string,
    amount: number
  ): void {
    const w = new BinaryWriter();
    w.writeString(zdoUserId);
    w.writeInt32(zdoId);
    w.writeInt32(richtung);
    w.writeString(itemName);
    w.writeInt32(amount);
    this.sendPacket(PacketType.ContainerAction, w.toUint8Array());
  }

  /** Editor (Phase G): Dungeon-Dokument anfordern ('' = aktueller Dungeon). */
  sendDungeonEditRequest(dungeonId = ''): void {
    const w = new BinaryWriter();
    w.writeString(dungeonId);
    this.sendPacket(PacketType.DungeonEditRequest, w.toUint8Array());
  }

  /**
   * Editor (Phase G): bearbeitetes Dungeon-Dokument speichern.
   *
   * ── E6: die Registry-Prüfsumme reist mit ─────────────────────────
   * Zweites Feld hinter dem Dokument. Sie wird HIER geholt und nicht von
   * den Aufrufern durchgereicht — es gibt drei davon (1.0-Editor,
   * 2.0-Editor, Spielclient), und der eine, der sie vergässe, wäre
   * derjenige, dessen Dokumente still Räume verlieren. Ein Feld, das man
   * vergessen kann, ist ein Feld, das vergessen wird.
   *
   * Der Server vergleicht die Zahl VOR `sanitizeDungeonDocument` und
   * lehnt bei Ungleichheit ab (`WovServer.handleDungeonEditSave`). Ohne
   * das ist der Fehlerfall keine Meldung, sondern ein Grab mit einem
   * Loch — `sanitizeDungeonDocument` verwirft unbekannte Räume wortlos.
   *
   * @param pruefsumme NUR für Tests: eine ANDERE Prüfsumme als die
   *   dieser Seite. Damit lässt sich eine veraltete Editor-Seite
   *   nachstellen, die es in einem einzigen Prozess sonst nicht geben
   *   kann (Client und Server teilen sich dort die Nachschlagewerke).
   */
  sendDungeonEditSave(json: string, pruefsumme = moduleRegistry.registryChecksum()): void {
    const w = new BinaryWriter();
    w.writeString(json);
    w.writeString(pruefsumme);
    this.sendPacket(PacketType.DungeonEditSave, w.toUint8Array());
  }

  /**
   * Editor (E8): einen Saal bauen lassen — VIER ZAHLEN, sonst nichts.
   *
   * Kein Name und kein Pfad: Den Namen bildet der Server aus dem Mass
   * (`ModuleBuild.modulName`). Ein vom Client geschickter Name wäre die
   * erste Stelle, an der Zeichen aus dem Netz zu einem Dateinamen
   * würden — und die Erlaubnisliste dagegen stünde dann an einer Klemme,
   * die man auch weglassen könnte.
   */
  sendDungeonModulBau(cellsX: number, cellsZ: number, raster: number, weight: number): void {
    const w = new BinaryWriter();
    w.writeInt32(cellsX);
    w.writeInt32(cellsZ);
    w.writeInt32(raster);
    w.writeFloat32(weight);
    this.sendPacket(PacketType.DungeonModulBau, w.toUint8Array());
  }

  /**
   * Editor (E9): einen gebauten Saal wieder entfernen lassen.
   *
   * Hier reist — anders als beim Bauen — ein NAME. Das ist kein
   * Rückschritt hinter die Begründung dort, sondern der Unterschied
   * zwischen „welchen Saal soll ich bauen?" (das sagen vier Zahlen) und
   * „welchen soll ich entfernen?" (das kann nur ein Name sagen). Die
   * Erlaubnisliste dagegen steht auf der Serverseite und läuft, bevor aus
   * dem Namen ein Pfad oder ein Tabellenschlüssel wird.
   */
  sendDungeonModulLoeschen(name: string): void {
    const w = new BinaryWriter();
    w.writeString(name);
    this.sendPacket(PacketType.DungeonModulLoeschen, w.toUint8Array());
  }

  /**
   * Tageszeit für die ganze Welt setzen (Auswahl im Verbinden-Fenster).
   *
   * @param seconds Sekunden INNERHALB des Tages, also [0, WORLD_TIME_LENGTH).
   *   Nicht die absolute Weltzeit — der Server behält seinen Tageszähler
   *   und verschiebt nur die Zeit darin (WovServer.handleSetTimeOfDay).
   */
  sendSetTimeOfDay(seconds: number): void {
    const w = new BinaryWriter();
    w.writeFloat64(seconds);
    this.sendPacket(PacketType.SetTimeOfDay, w.toUint8Array());
  }

  sendChat(text: string, chatType = 1): void {
    const w = new BinaryWriter();
    w.writeInt32(chatType);
    w.writeString(text);
    this.sendPacket(PacketType.ChatMessage, w.toUint8Array());
  }

  /**
   * Gewaehlte Figur an den Server melden (SetFigur).
   *
   * Wird direkt nach dem Anmelden geschickt und bei jedem Wechsel. Der
   * Server prueft die Kennung gegen die gemeinsame Liste und schreibt
   * sie ans Charakter-ZDO — erst dadurch sehen die anderen Spieler sie.
   */
  sendFigur(figurId: string): void {
    const w = new BinaryWriter();
    w.writeString(figurId);
    this.sendPacket(PacketType.SetFigur, w.toUint8Array());
  }

  /**
   * Frisur und Ruestung an den Server melden (SetAussehen).
   *
   * Wie sendFigur: Erst wenn der Server es ans Charakter-ZDO haengt,
   * sehen die ANDEREN Spieler das Aussehen. Ohne diesen Weg saehe jeder
   * nur sich selbst richtig.
   *
   * Leerstring heisst "nichts angezogen" und ist eine gueltige Wahl —
   * deshalb kein Sonderfall im Server.
   */
  sendAussehen(
    frisurId: string,
    oberkoerperId: string,
    beineId: string,
    haarfarbeId: string
  ): void {
    const w = new BinaryWriter();
    w.writeString(frisurId);
    w.writeString(oberkoerperId);
    w.writeString(beineId);
    // Vierter Wert, ANGEHAENGT statt eingeschoben: Ein Server, der ihn
    // noch nicht kennt, liest die ersten drei und laesst den Rest
    // liegen — die Frisur kommt an, nur die Farbe nicht. Vorne
    // eingeschoben waere das Paket fuer ihn Unsinn.
    w.writeString(haarfarbeId);
    this.sendPacket(PacketType.SetAussehen, w.toUint8Array());
  }

  /** Heartbeat-Timer (alle 5 s) — hält die Verbindung auch bei
   *  Hintergrund-Tabs am Leben und füttert den Server-Timeout. */
  private pingTimer: number | null = null;

  private startePing(): void {
    this.stoppePing();
    this.pingTimer = window.setInterval(() => {
      if (this.connected) this.sendPacket(PacketType.Ping, new Uint8Array(0));
    }, 5000);
  }

  private stoppePing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  disconnect(): void {
    this.connected = false; // Review 21: log — socket?.connected sonst veraltet
    this.stoppePing();
    this.ws?.close();
    this.ws = null;
  }
}
