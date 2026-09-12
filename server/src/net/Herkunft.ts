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
 * (erster Eintrag) bzw. ersatzweise `X-Real-IP` geglaubt. Ist die
 * Peer-Adresse KEINE Loopback-Adresse, kam die Anfrage nicht ueber den
 * lokalen nginx — dann waeren die Kopfzeilen frei erfundbar, und es
 * bleibt bei der Peer-Adresse selbst.
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
import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** IPv4-gemappte IPv6-Adressen (::ffff:127.0.0.1) auf ihre v4-Form bringen. */
function normalisiert(roh: string | string[] | undefined): string {
  const wert = Array.isArray(roh) ? roh[0] : roh;
  return (wert ?? '').trim().replace(/^::ffff:/, '');
}

/**
 * Herkunfts-Adresse einer Anfrage.
 *
 * Peer-Adresse, ausser sie ist Loopback UND ein Kopf verspricht mehr —
 * dann `X-Forwarded-For` (erster Eintrag), sonst `X-Real-IP`.
 */
export function herkunftErmitteln(req: IncomingMessage): string {
  const peer = normalisiert(req.socket.remoteAddress ?? undefined);
  if (!peer) return 'unknown';
  if (!LOOPBACK.has(peer)) return peer;

  const weitergeleitet = normalisiert(
    String(req.headers['x-forwarded-for'] ?? '').split(',')[0],
  );
  if (weitergeleitet) return weitergeleitet;

  const echt = normalisiert(req.headers['x-real-ip']);
  if (echt) return echt;

  return peer;
}
