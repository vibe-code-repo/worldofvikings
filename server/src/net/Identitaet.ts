/**
 * Identitaet — reine Logik fuer stabile Spieler-Identitaet, Sitzungsnachweis
 * und den Nonce/HMAC-Passwort-Handshake (F3/F4, Security-Review).
 *
 * Diese Datei verdrahtet nichts: sie fasst weder NetManager.ts noch Peer.ts
 * noch WovServer.ts an. Sie liefert nur die Funktionen, mit denen ein
 * anderer Agent den Handshake in NetManager.handlePasswordAuth ersetzt.
 *
 * ── Ausgangslage (Voruntersuchung) ──────────────────────────────────────
 * NetManager.handlePasswordAuth leitet peer.userId aus einer vom CLIENT
 * gelieferten Zeichenkette ab: ist sie rein numerisch, wird sie ROH als
 * BigInt uebernommen — ein Client kann sich also buchstaeblich jede userId
 * aussuchen. Ist sie nicht numerisch, wird sie ungesalzen gehasht (31 Bit).
 * In beiden Faellen bestimmt der Client seine eigene Identitaet.
 *
 * ── 1. Stabile Spieler-ID ────────────────────────────────────────────────
 * Format: "sp_" + 22 Base64url-Zeichen = 16 zufaellige Bytes (128 Bit) vom
 * CSPRNG des Servers. Der Client bekommt die ID zugeteilt, kann sie nicht
 * beeinflussen und kann sie nicht erraten (128 Bit Kollisionsraum ist fuer
 * eine Spielerzahl in dieser Groessenordnung praktisch kollisionsfrei —
 * Geburtstagsschranke liegt bei ~2^64 IDs fuer 50% Kollisionswahrscheinlichkeit).
 * Ein Praefix statt einer reinen Zahl, weil String-IDs sich verlustfrei als
 * Map-Schluessel, JSON-Feld und Log-Zeile verwenden lassen, ohne dass eine
 * BigInt/Number-Rundung lauert.
 *
 * WARUM NEBENEINANDER STATT ERSATZ: peer.userId (BigInt) steckt tief in den
 * ZDO-Besitzverhaeltnissen (ZDOID, setOwner, das 'besitzer'-Feld — siehe
 * WovServer.ts:881,934,942,1016,1355,1423). Bestehende Spielstaende haben
 * ZDOs, deren Besitzer-Feld die ALTE, hash-abgeleitete userId traegt. Wuerde
 * man die Ableitung der userId aendern, wuerde jeder bestehende Spielstand
 * seine ZDO-Zuordnung verlieren, sobald derselbe Spieler sich das naechste
 * Mal verbindet — er saehe fremde/verwaiste Objekte. Deshalb: die alte
 * hash-abgeleitete userId bleibt unangetastet als "Altlast-ID" bestehen
 * und wird weiterhin fuer ZDO-Besitz verwendet; die neue spielerId liegt
 * NUR im SessionToken und im spaeteren Identitaets-Mapping (Name -> Token
 * statt Name -> State) daneben. Der Einbau-Agent muss die Altlast-ID beim
 * ERSTEN erfolgreichen Login weiterhin serverseitig ableiten (nicht mehr
 * roh vom Client uebernehmen!) und danach im SessionToken einfrieren, damit
 * sie bei jeder Rueckkehr identisch bleibt — das ist ausserhalb dieser
 * Datei, siehe Kopfkommentar der Aufgabe.
 *
 * ── 2. Sitzungsnachweis (SessionToken) ───────────────────────────────────
 * Format: "<base64url(JSON-Payload)>.<base64url(HMAC-SHA256-Signatur)>".
 * Die Signatur deckt den kompletten base64url-kodierten Payload ab (nicht
 * die rohen JSON-Bytes), damit Kodierung und Signatur ueber genau dieselbe
 * Zeichenkette laufen — kein Raum fuer kanonisierungsbedingte Abweichungen
 * zwischen Ausstellen und Pruefen. Payload traegt spielerId, altlastUserId
 * (als Hex-String, da BigInt nicht JSON-faehig ist), Ausstellungszeitpunkt
 * und Ablaufzeitpunkt (beide ms seit Epoch, vom SERVER gesetzt).
 *
 * Der Signaturvergleich verwendet crypto.timingSafeEqual statt "===" oder
 * Buffer.equals: ein fruehzeitiger Byte-Abbruch bei einem simplen Vergleich
 * macht die Vergleichsdauer vom Praefix-Uebereinstimmungsgrad abhaengig,
 * was einem Angreifer erlaubt, die Signatur Byte fuer Byte per Zeitmessung
 * zu erraten (klassischer Timing-Seitenkanal). timingSafeEqual vergleicht
 * in konstanter Zeit bezogen auf die Puffergroesse. Voraussetzung ist, dass
 * beide Puffer gleich lang sind — bei Laengenunterschied wird deshalb VOR
 * dem Vergleich mit "gefaelscht" abgebrochen; das ist kein Seitenkanal auf
 * das Geheimnis, weil die erwartete Laenge (HMAC-SHA256 = 32 Byte) oeffentlich
 * bekannt ist und nichts ueber das Geheimnis verraet.
 *
 * Die Ablaufpruefung laeuft ERST NACH erfolgreicher Signaturpruefung: ein
 * Angreifer soll aus der Unterscheidung "gefaelscht" vs. "abgelaufen" keine
 * Information ueber ein gueltig aussehendes, aber manipuliertes Token ziehen
 * koennen (er muss zuerst eine echte Signatur vorweisen, bevor der Server
 * ueberhaupt den Ablauf bewertet).
 *
 * ── 3. Nonce/HMAC fuer den Passwort-Handshake (F4) ───────────────────────
 * Heute vergleicht der Server passwordHash (ein blosser getStableHash ohne
 * Salt/Nonce) direkt gegen einen serverseitig vorab berechneten Wert. Das
 * ist ein REPLAY-faehiges, durchprobierbares Verfahren: derselbe Hash
 * funktioniert bei jedem Verbindungsversuch erneut, und ein Angreifer kann
 * offline durchprobieren, welcher Klartext auf den beobachteten Hash fuehrt.
 *
 * Neu: der Server erzeugt pro Verbindung einen zufaelligen Nonce (16 Byte
 * Hex). Der Client antwortet mit HMAC-SHA256(key=Passwort, data=Nonce). Der
 * Server berechnet dieselbe HMAC serverseitig und vergleicht zeitkonstant.
 * Ein mitgeschnittener Handshake laesst sich nicht wiederholen (naechste
 * Verbindung hat einen anderen Nonce) und verraet den Passwort-Hash nicht
 * direkt (er ist der HMAC-SCHLUESSEL, nicht Teil der uebertragenen Daten).
 *
 * FALL "KEIN PASSWORT GESETZT" (server.yml: password: ""): der Server
 * verlangt WEITERHIN denselben Nonce/HMAC-Ablauf, nur mit leerem String als
 * HMAC-Schluessel. Das ist bewusst KEINE Sonderbehandlung ("wenn Passwort
 * leer, immer true zurueckgeben") — eine solche Attrappe wuerde den echten
 * Pruefpfad fuer den haeufigsten Konfigurationsfall (everyone-admin-Server
 * ohne Passwort) unbelastet lassen und ihn dadurch nie durchlaufen. Mit der
 * einheitlichen Pruefung MUSS der Client trotzdem korrekt am Protokoll
 * teilnehmen (Nonce empfangen, HMAC bilden, Antwort im richtigen Format
 * schicken) — was sie NICHT bietet, ist Vertraulichkeit, weil ein leerer
 * Schluessel oeffentlich ist und jeder denselben HMAC berechnen kann. Das
 * ist ehrlich: ohne Passwort gibt es kein Geheimnis zu beweisen, aber die
 * Codepfade fuer "Passwort gesetzt" und "kein Passwort gesetzt" bleiben
 * identisch, was die Angriffsflaeche eines separaten Bypass-Zweigs vermeidet.
 *
 * ── 4. Herkunft des Servergeheimnisses ───────────────────────────────────
 * Dieses Modul liest/erzeugt das Geheimnis NICHT selbst aus /etc/wov.env —
 * das ist Sache des Einbau-Agents (main.ts o.ae., beim Serverstart). Es
 * stellt nur geheimnisAusEnv (Laden) und geheimnisErzeugen (Erzeugen-bei-
 * Fehlen) bereit.
 *
 * Vorschlag: /etc/wov.env ist die instanzspezifische Umgebungsdatei (traegt
 * bereits WOV_INSTANZ, siehe Voruntersuchung) — sie liegt AUSSERHALB des
 * Git-Repos und ueberlebt damit "git pull"-Deploys unveraendert, anders als
 * server/data/server.yml, das VERSIONIERT ist und deshalb kein Ort fuer ein
 * Geheimnis sein darf (es wuerde ins oeffentliche Repo wandern und bei
 * jedem Pull auf allen Instanzen GLEICH sein). Neue Variable dort:
 * WOV_SESSION_SECRET_HEX=<64 Hex-Zeichen = 32 Byte>.
 *
 * Ablauf beim Start (im Einbau-Agenten, NICHT hier): geheimnisAusEnv(process.env)
 * aufrufen; liefert sie undefined (Variable fehlt oder ist zu kurz), einmalig
 * geheimnisErzeugen() aufrufen, das Ergebnis als WOV_SESSION_SECRET_HEX an
 * /etc/wov.env ANHAENGEN (nicht ueberschreiben — andere Variablen bleiben
 * stehen) und im selben Prozess weiterverwenden, damit der erste Start nicht
 * ohne Geheimnis dasteht. Nach einem Neustart liest jede Instanz danach
 * dasselbe Geheimnis erneut aus der Datei — Sitzungen ueberleben Deploys.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HANDSHAKE_LEERPASSWORT_SCHLUESSEL } from '@wov/shared';

// ── 1. Stabile Spieler-ID ──────────────────────────────────────────────

/** Server-vergebene, vom Client nicht waehlbare Spieler-ID. */
export type SpielerId = string;

const SPIELER_ID_PRAEFIX = 'sp_';
const SPIELER_ID_ZUFALLSBYTES = 16; // 128 Bit

/**
 * Erzeugt eine neue, zufaellige Spieler-ID. Nur der Server ruft dies auf
 * (beim allerersten erfolgreichen Login eines Namens/einer Altlast-ID) —
 * ein Client liefert niemals eine ID, die hier landet.
 */
export function spielerIdErzeugen(): SpielerId {
  return SPIELER_ID_PRAEFIX + randomBytes(SPIELER_ID_ZUFALLSBYTES).toString('base64url');
}

/** Grobe Formpruefung, z. B. bevor eine gespeicherte ID vertraut wird. */
export function istSpielerId(wert: unknown): wert is SpielerId {
  if (typeof wert !== 'string') return false;
  if (!wert.startsWith(SPIELER_ID_PRAEFIX)) return false;
  const rest = wert.slice(SPIELER_ID_PRAEFIX.length);
  // 16 Byte Base64url ohne Padding sind immer 22 Zeichen.
  return rest.length === 22 && /^[A-Za-z0-9_-]+$/.test(rest);
}

// ── 2. Sitzungsnachweis (SessionToken) ─────────────────────────────────

/** Mindestlaenge des Servergeheimnisses in Byte (256 Bit). */
const MIN_GEHEIMNIS_BYTES = 32;

const STANDARD_GUELTIGKEITSDAUER_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

interface TokenPayload {
  /** spielerId */
  s: SpielerId;
  /** altlastUserId, hex-kodiert (BigInt ist nicht JSON-faehig) */
  a: string;
  /** ausgestelltAm, ms seit Epoch */
  i: number;
  /** gueltigBis, ms seit Epoch */
  e: number;
}

export type TokenPruefErgebnis =
  | { status: 'gueltig'; spielerId: SpielerId; altlastUserId: bigint; ausgestelltAm: number }
  | { status: 'abgelaufen' }
  | { status: 'gefaelscht' };

function pruefeGeheimnisLaenge(geheimnis: Buffer): void {
  if (geheimnis.length < MIN_GEHEIMNIS_BYTES) {
    throw new Error(
      `Servergeheimnis zu kurz: ${geheimnis.length} Byte, mindestens ${MIN_GEHEIMNIS_BYTES} Byte noetig`,
    );
  }
}

function signiere(payloadB64: string, geheimnis: Buffer): string {
  return createHmac('sha256', geheimnis).update(payloadB64).digest('base64url');
}

/**
 * Stellt ein neues SessionToken aus. Wird vom Server nach erfolgreicher
 * Erst-Authentifizierung aufgerufen; der Client speichert das Ergebnis
 * und legt es bei der naechsten Verbindung als Nachweis vor.
 *
 * @param jetzt Injizierbar fuer Tests; Default = Date.now().
 */
export function tokenAusstellen(
  spielerId: SpielerId,
  altlastUserId: bigint,
  geheimnis: Buffer,
  gueltigkeitsdauerMs: number = STANDARD_GUELTIGKEITSDAUER_MS,
  jetzt: number = Date.now(),
): string {
  pruefeGeheimnisLaenge(geheimnis);
  const payload: TokenPayload = {
    s: spielerId,
    a: altlastUserId.toString(16),
    i: jetzt,
    e: jetzt + gueltigkeitsdauerMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = signiere(payloadB64, geheimnis);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Prueft ein vorgelegtes SessionToken gegen das Servergeheimnis.
 * Liefert drei unterscheidbare Ergebnisse (gueltig / abgelaufen /
 * gefaelscht) — siehe Kopfkommentar fuer die Reihenfolge Signatur-vor-Ablauf.
 */
export function tokenPruefen(
  token: string,
  geheimnis: Buffer,
  jetzt: number = Date.now(),
): TokenPruefErgebnis {
  pruefeGeheimnisLaenge(geheimnis);

  const teile = token.split('.');
  if (teile.length !== 2) return { status: 'gefaelscht' };
  const [payloadB64, sigB64] = teile;
  if (!payloadB64 || !sigB64) return { status: 'gefaelscht' };

  const erwarteteSigB64 = signiere(payloadB64, geheimnis);
  let vorgelegt: Buffer;
  let erwartet: Buffer;
  try {
    vorgelegt = Buffer.from(sigB64, 'base64url');
    erwartet = Buffer.from(erwarteteSigB64, 'base64url');
  } catch {
    return { status: 'gefaelscht' };
  }
  // timingSafeEqual verlangt gleiche Laenge; ein Laengenunterschied ist
  // selbst kein Geheimnis (HMAC-SHA256 hat immer 32 Byte) und darf sofort
  // durchfallen, siehe Kopfkommentar.
  if (vorgelegt.length !== erwartet.length || !timingSafeEqual(vorgelegt, erwartet)) {
    return { status: 'gefaelscht' };
  }

  let payload: TokenPayload;
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const geparst: unknown = JSON.parse(json);
    if (
      typeof geparst !== 'object' ||
      geparst === null ||
      typeof (geparst as TokenPayload).s !== 'string' ||
      typeof (geparst as TokenPayload).a !== 'string' ||
      typeof (geparst as TokenPayload).i !== 'number' ||
      typeof (geparst as TokenPayload).e !== 'number'
    ) {
      return { status: 'gefaelscht' };
    }
    payload = geparst as TokenPayload;
  } catch {
    return { status: 'gefaelscht' };
  }

  if (jetzt > payload.e) return { status: 'abgelaufen' };

  return {
    status: 'gueltig',
    spielerId: payload.s,
    altlastUserId: BigInt(`0x${payload.a || '0'}`),
    ausgestelltAm: payload.i,
  };
}

// ── 3. Nonce/HMAC fuer den Passwort-Handshake (F4) ─────────────────────

const NONCE_BYTES = 16;

/** Erzeugt einen neuen Nonce fuer EINE Verbindung (nicht wiederverwenden). */
export function nonceErzeugen(): string {
  return randomBytes(NONCE_BYTES).toString('hex');
}

/**
 * Erwartete Handshake-Antwort: HMAC-SHA256(key=passwort, data=nonce), hex.
 * Bei leerem Passwort ist der Schluessel ein leerer String — siehe
 * Kopfkommentar zum Fall "kein Passwort gesetzt".
 */
export function antwortBerechnen(nonce: string, passwort: string): string {
  // Leeres Passwort auf den gemeinsamen Ersatzschluessel abbilden — die
  // Begruendung steht bei HANDSHAKE_LEERPASSWORT_SCHLUESSEL in shared.
  // Node kaeme mit '' zurecht, der Browser nicht, und beide Seiten muessen
  // dieselbe Zahl ausrechnen.
  const schluessel = passwort === '' ? HANDSHAKE_LEERPASSWORT_SCHLUESSEL : passwort;
  return createHmac('sha256', schluessel).update(nonce).digest('hex');
}

/**
 * Prueft eine vorgelegte Handshake-Antwort zeitkonstant. Aus demselben
 * Grund wie bei tokenPruefen (Timing-Seitenkanal, siehe Kopfkommentar)
 * kommt hier NICHT "===" zum Einsatz.
 */
export function antwortPruefen(nonce: string, passwort: string, antwort: string): boolean {
  const erwartet = antwortBerechnen(nonce, passwort);
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(antwort, 'hex');
    b = Buffer.from(erwartet, 'hex');
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── 4. Servergeheimnis ──────────────────────────────────────────────────

/** Name der Umgebungsvariable in /etc/wov.env (siehe Kopfkommentar). */
export const WOV_SESSION_SECRET_ENV = 'WOV_SESSION_SECRET_HEX';

/**
 * Laedt das Servergeheimnis aus einer Umgebungsvariablen-Quelle (typischer-
 * weise process.env, das main.ts nach dem Einlesen von /etc/wov.env
 * gefuellt hat). Liefert undefined, wenn die Variable fehlt oder kuerzer
 * als MIN_GEHEIMNIS_BYTES ist — der Aufrufer entscheidet dann, ob er
 * geheimnisErzeugen() nutzt.
 */
export function geheimnisAusEnv(
  env: Record<string, string | undefined> = process.env,
): Buffer | undefined {
  const hex = env[WOV_SESSION_SECRET_ENV];
  if (!hex) return undefined;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return undefined;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length < MIN_GEHEIMNIS_BYTES) return undefined;
  return buf;
}

/**
 * Erzeugt ein neues, zufaelliges Servergeheimnis als Hex-String (fuer
 * WOV_SESSION_SECRET_HEX in /etc/wov.env). Legt die Datei NICHT an und
 * schreibt nichts — das ist Sache des Einbau-Agenten, siehe Kopfkommentar.
 */
export function geheimnisErzeugen(): string {
  return randomBytes(MIN_GEHEIMNIS_BYTES).toString('hex');
}
