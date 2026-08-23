/**
 * Metrik — die vier Betriebsgrössen aus der Roadmap (G12): Tick-Dauer,
 * ZDO-Anzahl, Sync-Bytes/s, Peers.
 *
 * Reines Datenformat plus Formatierung, hier in shared/ statt in server/,
 * weil ZWEI Prozesse dieselbe Form brauchen: der Spielserver MISST
 * (server/src/Metriken.ts) und schreibt einen Schnappschuss in
 * server/data/metriken.json; der Betriebsdienst (admin/) LIEST diese
 * Datei und formatiert sie fuer den Endpunkt. Beide Seiten muessen
 * dasselbe Feldschema meinen — ein zweiter, unabhaengig gepflegter
 * Feldsatz auf der Admin-Seite waere die Quelle des naechsten Bugs, bei
 * dem ein Feld umbenannt wird und die andere Seite es nicht mitbekommt.
 *
 * WARUM ADMIN/ NICHT SELBST MISST: admin/ und server/ sind getrennte
 * Prozesse (admin muss wov-server neu starten koennen, s. Kopfkommentar
 * von admin/src/main.ts) — admin hat keinen In-Process-Zugriff auf
 * ZDOManager, NetManager oder die Tick-Schleife des Spielservers.
 *
 * WARUM PROMETHEUS-TEXTFORMAT: kein npm-Paket noetig (reiner String-Bau,
 * s. formatierePrometheus), von Mensch UND Werkzeug lesbar, und braucht
 * keinen Adapter, falls hier je mehr als `curl`/Handauswertung mitliest.
 *
 * Nicht ueber index.ts exportiert: der Barrel geht ins Client-Bundle, und
 * Betriebsmetriken sind reine Server/Admin-Angelegenheit (gleiche
 * Begruendung wie shared/src/instanz.ts).
 */

export interface MetrikSchnappschuss {
  /** Unix-Millisekunden, wann dieser Schnappschuss entstand. */
  zeitMs: number;
  /** Mittlere Tick-Dauer der zuletzt abgeschlossenen Sekunde, in ms. */
  tickDauerMsDurchschnitt: number;
  /** Groesste Tick-Dauer derselben Sekunde, in ms — der Ausreisser. */
  tickDauerMsMax: number;
  /** Zahl der Ticks in dieser Sekunde. Sollwert 30 (TICK_MS); ein
   *  niedrigerer Wert zeigt einen haengenden Server, nicht nur einen
   *  langsamen. */
  tickAnzahl: number;
  /** Aktuelle Zahl lebender ZDOs (ZDOManager.totalZDOCount). */
  zdoAnzahl: number;
  /** Bytes, die in dieser Sekunde ueber Peer.sendPacket/sendRaw rausgingen
   *  (ZDO-Sync, TimeSync, TerrainOpSync, ... — jeder Paketversand zaehlt
   *  am Ort des Versands, s. server/src/net/Peer.ts). */
  syncBytesProSekunde: number;
  /** Zahl verbundener Peers. */
  peers: number;
}

/**
 * Prometheus-Textformat (Exposition Format 0.0.4) von Hand — sieben feste
 * Werte ohne Labels/Historie, eine Bibliothek waere hier ueberbaut.
 *
 * `jetztMs` kommt bewusst als Parameter herein statt Date.now() hier drin
 * zu rufen, damit die Alters-Berechnung ohne Systemuhr testbar bleibt.
 */
export function formatierePrometheus(schnappschuss: MetrikSchnappschuss, jetztMs: number): string {
  // Negative Werte (Schnappschuss "aus der Zukunft", z.B. verstellte Uhr
  // zwischen den beiden Prozessen) wuerden eine negative Alters-Metrik
  // ergeben — verwirrender als hilfreich, deshalb bei 0 gekappt.
  const alterSekunden = Math.max(0, Math.round(((jetztMs - schnappschuss.zeitMs) / 1000) * 10) / 10);

  const zeilen: string[] = [];
  const gauge = (name: string, hilfe: string, wert: number): void => {
    zeilen.push(`# HELP ${name} ${hilfe}`);
    zeilen.push(`# TYPE ${name} gauge`);
    zeilen.push(`${name} ${wert}`);
  };

  gauge('wov_tick_dauer_ms_avg', 'Mittlere Tick-Dauer der letzten vollen Sekunde in Millisekunden', schnappschuss.tickDauerMsDurchschnitt);
  gauge('wov_tick_dauer_ms_max', 'Groesste Tick-Dauer der letzten vollen Sekunde in Millisekunden', schnappschuss.tickDauerMsMax);
  gauge('wov_tick_anzahl', 'Zahl der Ticks in der letzten vollen Sekunde (Sollwert 30)', schnappschuss.tickAnzahl);
  gauge('wov_zdo_anzahl', 'Aktuelle Zahl lebender ZDOs', schnappschuss.zdoAnzahl);
  gauge('wov_sync_bytes_pro_sekunde', 'Ueber ZDO-Sync und andere Pakete gesendete Bytes in der letzten vollen Sekunde', schnappschuss.syncBytesProSekunde);
  gauge('wov_peers', 'Zahl verbundener Spieler', schnappschuss.peers);
  gauge('wov_metriken_alter_sekunden', 'Alter dieses Schnappschusses in Sekunden — hoch heisst: Spielserver haengt oder ist weg', alterSekunden);

  return zeilen.join('\n') + '\n';
}
