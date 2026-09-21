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

  // Tick split (block 0.12). Per tick: total = welten + sync + rest, where
  // `rest` is the remainder (total minus the two measured phases), so the
  // three parts add up to `tickDauerMs*` by construction. All values are
  // per-second averages over ALL ticks of that second (a tick in which a
  // phase did not run counts as 0 ms for it) and the per-second maximum of
  // the single phase, both in ms rounded to 0.01.

  /** Per-world tick loop (WovServer.update -> Welt.tick for every world that
   *  has a player): zone generation, spawns, routes, aggro. */
  tickWeltenMsDurchschnitt: number;
  tickWeltenMsMax: number;
  /** ZDO sync (WovServer.syncZDOs), which runs every 50 ms, so on about two
   *  of three ticks. */
  tickSyncMsDurchschnitt: number;
  tickSyncMsMax: number;
  /** Everything else in the tick: network update, time sync, admin rights,
   *  dungeons, events, the metric writes of the previous second. */
  tickRestMsDurchschnitt: number;
  tickRestMsMax: number;
  /** How often zone generation stopped because its per-tick time budget was
   *  used up with zones still queued (ZoneManager.update). Summed over all
   *  worlds, per second. */
  zonenBudgetAbbrueche: number;

  /** Strikes and hit effects the server dropped because the caller gave no
   *  world id (WovServer.ohneWeltVerworfen). A running TOTAL since the server
   *  started, not a per-second value: in operation it stays 0, so any value
   *  above 0 is a caller that lost its world — and a per-second gauge would
   *  read 0 on almost every scrape and hide it. */
  ohneWeltVerworfen: number;
}

/**
 * Prometheus-Textformat (Exposition Format 0.0.4) von Hand — feste
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
  const gauge = (name: string, hilfe: string, wert: number | undefined, art = 'gauge'): void => {
    // A snapshot file written by an older server has no split fields: skip
    // the gauge rather than print `undefined`, which would make the whole
    // scrape unparseable.
    if (typeof wert !== 'number') return;
    zeilen.push(`# HELP ${name} ${hilfe}`);
    zeilen.push(`# TYPE ${name} ${art}`);
    zeilen.push(`${name} ${wert}`);
  };

  gauge('wov_tick_dauer_ms_avg', 'Mittlere Tick-Dauer der letzten vollen Sekunde in Millisekunden', schnappschuss.tickDauerMsDurchschnitt);
  gauge('wov_tick_dauer_ms_max', 'Groesste Tick-Dauer der letzten vollen Sekunde in Millisekunden', schnappschuss.tickDauerMsMax);
  gauge('wov_tick_anzahl', 'Zahl der Ticks in der letzten vollen Sekunde (Sollwert 30)', schnappschuss.tickAnzahl);
  gauge('wov_zdo_anzahl', 'Aktuelle Zahl lebender ZDOs', schnappschuss.zdoAnzahl);
  gauge('wov_sync_bytes_pro_sekunde', 'Ueber ZDO-Sync und andere Pakete gesendete Bytes in der letzten vollen Sekunde', schnappschuss.syncBytesProSekunde);
  gauge('wov_tick_welten_ms_avg', 'Mittlere Dauer der Welt-Ticks (Zonen, Spawns, Routen, Aggro) je Tick in Millisekunden', schnappschuss.tickWeltenMsDurchschnitt);
  gauge('wov_tick_welten_ms_max', 'Groesste Dauer der Welt-Ticks eines Ticks der letzten vollen Sekunde in Millisekunden', schnappschuss.tickWeltenMsMax);
  gauge('wov_tick_sync_ms_avg', 'Mittlere Dauer des ZDO-Syncs je Tick in Millisekunden', schnappschuss.tickSyncMsDurchschnitt);
  gauge('wov_tick_sync_ms_max', 'Groesste Dauer des ZDO-Syncs eines Ticks der letzten vollen Sekunde in Millisekunden', schnappschuss.tickSyncMsMax);
  gauge('wov_tick_rest_ms_avg', 'Mittlere Dauer des uebrigen Ticks (Netz, TimeSync, Dungeons, Ereignisse) in Millisekunden', schnappschuss.tickRestMsDurchschnitt);
  gauge('wov_tick_rest_ms_max', 'Groesste Dauer des uebrigen Ticks in der letzten vollen Sekunde in Millisekunden', schnappschuss.tickRestMsMax);
  gauge('wov_zonen_budget_abbrueche', 'Zonenaufbau-Abbrueche wegen Zeitbudget in der letzten vollen Sekunde', schnappschuss.zonenBudgetAbbrueche);
  gauge('wov_ohne_welt_verworfen_gesamt', 'Schlaege und Effekte, die ohne Welt-Id verworfen wurden, seit dem Serverstart (im Betrieb 0)', schnappschuss.ohneWeltVerworfen, 'counter');
  gauge('wov_peers', 'Zahl verbundener Spieler', schnappschuss.peers);
  gauge('wov_metriken_alter_sekunden', 'Alter dieses Schnappschusses in Sekunden — hoch heisst: Spielserver haengt oder ist weg', alterSekunden);

  return zeilen.join('\n') + '\n';
}
