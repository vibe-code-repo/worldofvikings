/**
 * Metriken — G12: Tick-Dauer, ZDO-Anzahl, Sync-Bytes/s, Peers billig
 * erheben, damit "was passiert bei 50 Spielern" eine Messung statt einer
 * Schaetzung wird.
 *
 * WARUM NICHT IN Zeitmessung.ts (client/src/engine/Zeitmessung.ts):
 * Zeitmessung.ts loest EINEN dominanten Posten in seine verschachtelten
 * Unterabschnitte auf (Rauschen vs. Gitterbau vs. GPU-Upload) — ein Stapel
 * mit Elternabzug, gebaut fuer die Tiefenanalyse EINES Problems. Hier
 * geht es um vier flache, unabhaengige Betriebsgroessen ohne
 * Verschachtelung, die laufend nach aussen sollen — der Stapelmechanismus
 * dort waere hier nur Ballast, und "baue keine zweite Messschiene daneben"
 * heisst nicht "zwinge Ungleiches in dieselbe Form".
 *
 * KOSTEN: Pro Tick nur `erfasseTick` (zwei Additionen, ein Vergleich) und
 * pro Paketversand `erfasseSyncBytes` (eine Addition) — kein
 * `performance.now()` im heissen Inneren von syncZDOs/writeZDO, sondern
 * genau EINMAL aussen um WovServer.update() herum (s. WovServer.start()).
 *
 * Modul-Singleton wie Zeitmessung.ts: Es gibt genau einen
 * Spielserver-Prozess je Instanz — ein zweiter Zustand waere nur eine
 * Quelle fuer "welchen Schnappschuss habe ich gerade gelesen"-Fehler.
 */
import type { MetrikSchnappschuss } from '@wov/shared/src/metrik.js';

let tickSumme = 0;
let tickMax = 0;
let tickAnzahl = 0;
let syncBytesAkkumulator = 0;

/** Einen abgeschlossenen Tick verbuchen. Aufrufer: WovServer.start(). */
export function erfasseTick(dauerMs: number): void {
  tickSumme += dauerMs;
  if (dauerMs > tickMax) tickMax = dauerMs;
  tickAnzahl++;
}

/**
 * Gesendete Bytes verbuchen — am ORT DES VERSANDS (Peer.sendPacket/
 * sendRaw), nicht nachtraeglich aus den ZDO-Saetzen hochgerechnet: Dort
 * entstehen die Bytes ohnehin schon (inklusive Paket-Header, Zerstoerungen,
 * TimeSync, TerrainOpSync, ...), ein zweiter Rechenweg koennte vom echten
 * Netzwerkaufwand abweichen und still auseinanderlaufen.
 */
export function erfasseSyncBytes(bytes: number): void {
  syncBytesAkkumulator += bytes;
}

/**
 * Einmal je Sekunde aufgerufen (WovServer.update(), im bestehenden
 * 1-Sekunden-Takt von TimeSync — kein zusaetzlicher Timer): liest die
 * Akkumulatoren aus, setzt sie zurueck und liefert den Schnappschuss fuer
 * die GERADE ABGESCHLOSSENE Sekunde.
 *
 * `zdoAnzahl` und `peers` kommen als Parameter statt hier gehalten zu
 * werden, weil sie live Zustand von ZDOManager/NetManager sind — dieses
 * Modul soll kein Handle auf WovServer brauchen, um sie zu lesen. Gleiches
 * Prinzip wie Zeitmessung.leseUndLeere: auslesen UND zuruecksetzen in
 * einem Aufruf.
 */
export function schliesseSekundeAb(zdoAnzahl: number, peers: number, jetztMs: number): MetrikSchnappschuss {
  const schnappschuss: MetrikSchnappschuss = {
    zeitMs: jetztMs,
    tickDauerMsDurchschnitt: tickAnzahl > 0 ? Math.round((tickSumme / tickAnzahl) * 100) / 100 : 0,
    tickDauerMsMax: Math.round(tickMax * 100) / 100,
    tickAnzahl,
    zdoAnzahl,
    syncBytesProSekunde: syncBytesAkkumulator,
    peers,
  };
  tickSumme = 0;
  tickMax = 0;
  tickAnzahl = 0;
  syncBytesAkkumulator = 0;
  return schnappschuss;
}
