/**
 * Herkunft.ts — woher kommt eine Anfrage WIRKLICH, hinter einem Reverse-Proxy?
 *
 * ── Der Befund, den das behebt ────────────────────────────────────────
 * `KontoApi.herkunft()` und `WebSocketAcceptor` lasen bisher nur
 * `req.socket.remoteAddress`. Das ist ehrlich, solange der Node-Prozess
 * direkt am Netz haengt — sobald aber nginx davorsteht (deploy/nginx/
 * wov-lab.conf, ein einziger Ursprung fuer alles), ist die Peer-Adresse
 * IMMER 127.0.0.1, fuer jeden Besucher gleich. Die Anmelde-Drossel in
 * KontoApi (fuenf Fehlversuche, dann 15 Minuten Pause) haette dann nicht
 * mehr EINEN Angreifer gebremst, sondern nach fuenf Fehlversuchen von
 * IRGENDWEM jeden Anmeldeversuch von JEDEM Besucher gesperrt.
 *
 * ── Die Regel, bewusst simpel gehalten ────────────────────────────────
 * NUR wenn die Peer-Adresse (wer die TCP-Verbindung tatsaechlich
 * aufgebaut hat) eine Loopback-Adresse ist, wird `X-Forwarded-For`
 * (LETZTER Eintrag) bzw. ersatzweise `X-Real-IP` geglaubt. Ist die
 * Peer-Adresse KEINE Loopback-Adresse, kam die Anfrage nicht ueber den
 * lokalen nginx — dann waeren die Kopfzeilen frei erfundbar, und es
 * bleibt bei der Peer-Adresse selbst.
 *
 * Warum der LETZTE Eintrag: Jeder vertraute Sprung haengt die Adresse, die
 * ER gesehen hat, RECHTS an; alles links davon hat der Besucher selbst
 * geschrieben und ist beliebig erfindbar. Der erste Eintrag war damit die
 * einzige Stelle, die ein Angreifer bestimmen konnte (Befund F3). Der
 * lokale nginx UEBERSCHREIBT den Kopf zusaetzlich mit der echten
 * Besucheradresse (real_ip, siehe deploy/nginx-live.conf und deploy/nginx/
 * wov-lab.conf) — dann steht dort genau ein Eintrag, und beide Lesarten
 * stimmen ueberein. Die Rechts-Regel haelt auch dann, wenn ein Block
 * einmal wieder anhaengt.
 *
 * Nur gueltige IP-Adressen zaehlen: `unknown`, leere Eintraege, Text und
 * ein angehaengter Port werden nicht als Herkunft benutzt (sonst waere
 * jeder erfundene Text ein eigener Drosselschluessel).
 *
 * Das ist enger als admin/src/main.ts (dort eine Liste vertrauter
 * Vorschalter-Netze, NAHE_NETZE/PROXY_ADRESSEN, weil der Betriebsdienst
 * auch aus dem internen Bruecken-Netz erreichbar sein muss). Hier reicht
 * die einfachere Regel: Der Spielserver liefert /accounts/ NUR ueber
 * `proxy_pass http://127.0.0.1:2467` aus demselben Container — der
 * einzige legitime Vorschalter ist Loopback, sonst keiner.
 *
 * ── Warum eine gemeinsame Funktion ────────────────────────────────────
 * KontoApi.ts (Konten-Endpunkte) und WebSocketAcceptor.ts (Spielserver-
 * WebSocket) hatten dieselbe Luecke unabhaengig voneinander eingebaut.
 * Ein Fix an zwei Stellen mit demselben Text ist ein Fix, der beim
 * naechsten Mal an einer Stelle vergessen wird.
 */
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/**
 * Eine Adresse bereinigen: Leerraum weg, IPv4-gemappte IPv6-Adressen
 * (::ffff:127.0.0.1) auf ihre v4-Form, `[v6]:port` und `v4:port` ohne Port.
 * Liefert '' fuer alles, was keine IP-Adresse ist.
 */
function normalisiert(roh: string | undefined): string {
  let wert = (roh ?? '').trim().toLowerCase();
  const eckig = /^\[([^\]]+)\](?::\d+)?$/.exec(wert);
  if (eckig) wert = eckig[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(wert)) wert = wert.slice(0, wert.lastIndexOf(':'));
  wert = wert.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  return isIP(wert) ? wert : '';
}

/** Ein Kopf, ggf. mehrfach gesendet (Node fuegt Zeilen von X-Forwarded-For mit ', ' zusammen). */
function ersterWert(roh: string | string[] | undefined): string | undefined {
  return Array.isArray(roh) ? roh[0] : roh;
}

/**
 * Herkunfts-Adresse einer Anfrage.
 *
 * Peer-Adresse, ausser sie ist Loopback UND ein Kopf verspricht mehr —
 * dann der letzte gueltige Eintrag von `X-Forwarded-For`, sonst `X-Real-IP`.
 */
export function herkunftErmitteln(req: IncomingMessage): string {
  const peer = normalisiert(req.socket.remoteAddress ?? undefined);
  if (!peer) return 'unknown';
  if (!LOOPBACK.has(peer)) return peer;

  // Der letzte Eintrag ist der des naechsten vertrauten Sprungs. Ist er
  // ungueltig (`unknown`, Text), gilt der Kopf als kaputt — NICHT der
  // vorletzte Eintrag, der waere wieder Besucher-Eingabe.
  const kette = String(ersterWert(req.headers['x-forwarded-for']) ?? '').split(',');
  const weitergeleitet = normalisiert(kette[kette.length - 1]);
  if (weitergeleitet) return weitergeleitet;

  const echt = normalisiert(ersterWert(req.headers['x-real-ip']));
  if (echt) return echt;

  return peer;
}
