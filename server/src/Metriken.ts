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
 * KOSTEN: Pro Tick nur `erfasseTick` (Additionen und Vergleiche auf
 * Modulzahlen, keine Allokation) und pro Paketversand `erfasseSyncBytes`
 * (eine Addition) — kein `performance.now()` im heissen Inneren von
 * syncZDOs/writeZDO. Die Zeitstempel setzt WovServer.update() nur an den
 * Grenzen der beiden Phasen (Welten, Sync); "Rest" ist die Differenz zur
 * Gesamtdauer und braucht deshalb keinen eigenen Stempel.
 *
 * Modul-Singleton wie Zeitmessung.ts: Es gibt genau einen
 * Spielserver-Prozess je Instanz — ein zweiter Zustand waere nur eine
 * Quelle fuer "welchen Schnappschuss habe ich gerade gelesen"-Fehler.
 * Ausnahme ist `MetrikSchreiber` weiter unten: der haelt nur Dateizustand
 * (Tag, Warndrossel) und ist je Server eine Instanz.
 */
import { appendFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MetrikSchnappschuss } from '@wov/shared/src/metrik.js';

let tickSumme = 0;
let tickMax = 0;
let tickAnzahl = 0;
let weltenSumme = 0;
let weltenMax = 0;
let syncSumme = 0;
let syncMax = 0;
let restSumme = 0;
let restMax = 0;
let syncBytesAkkumulator = 0;
let budgetAbbrueche = 0;

/**
 * Einen abgeschlossenen Tick verbuchen. Aufrufer: WovServer.start().
 *
 * `weltenMs` and `syncMs` are the two measured phases of this tick (0 when
 * the phase did not run); the rest is the total minus both. Both are
 * optional so a caller without the split still reports just the total, and
 * all of it counts as "rest".
 */
export function erfasseTick(dauerMs: number, weltenMs = 0, syncMs = 0): void {
  tickSumme += dauerMs;
  if (dauerMs > tickMax) tickMax = dauerMs;
  tickAnzahl++;

  // The phases lie inside the total measurement, so the rest is never
  // really negative; the clamp only absorbs rounding noise and a wrongly
  // fed call.
  const restMs = Math.max(0, dauerMs - weltenMs - syncMs);
  weltenSumme += weltenMs;
  if (weltenMs > weltenMax) weltenMax = weltenMs;
  syncSumme += syncMs;
  if (syncMs > syncMax) syncMax = syncMs;
  restSumme += restMs;
  if (restMs > restMax) restMax = restMs;
}

/**
 * Zone generation was cut off by its per-tick time budget while zones were
 * still queued. Caller: ZoneManager.update().
 */
export function erfasseBudgetAbbruch(): void {
  budgetAbbrueche++;
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

const runde = (wert: number): number => Math.round(wert * 100) / 100;

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
export function schliesseSekundeAb(
  zdoAnzahl: number,
  peers: number,
  jetztMs: number,
  /** WovServer.ohneWeltVerworfen: laufende Summe seit dem Start, kein Sekundenwert. */
  ohneWeltVerworfen = 0
): MetrikSchnappschuss {
  const n = tickAnzahl;
  const schnappschuss: MetrikSchnappschuss = {
    zeitMs: jetztMs,
    tickDauerMsDurchschnitt: n > 0 ? runde(tickSumme / n) : 0,
    tickDauerMsMax: runde(tickMax),
    tickAnzahl,
    zdoAnzahl,
    syncBytesProSekunde: syncBytesAkkumulator,
    peers,
    tickWeltenMsDurchschnitt: n > 0 ? runde(weltenSumme / n) : 0,
    tickWeltenMsMax: runde(weltenMax),
    tickSyncMsDurchschnitt: n > 0 ? runde(syncSumme / n) : 0,
    tickSyncMsMax: runde(syncMax),
    tickRestMsDurchschnitt: n > 0 ? runde(restSumme / n) : 0,
    tickRestMsMax: runde(restMax),
    zonenBudgetAbbrueche: budgetAbbrueche,
    ohneWeltVerworfen,
  };
  tickSumme = 0;
  tickMax = 0;
  tickAnzahl = 0;
  weltenSumme = 0;
  weltenMax = 0;
  syncSumme = 0;
  syncMax = 0;
  restSumme = 0;
  restMax = 0;
  syncBytesAkkumulator = 0;
  budgetAbbrueche = 0;
  return schnappschuss;
}

// ── File output: snapshot and daily log ─────────────────────────────

/** Days of JSONL files kept, counting today: a file is deleted once it is 14 days old. */
export const METRIK_AUFBEWAHRUNG_TAGE = 14;
/** At most one warning per target and this long. */
export const METRIK_WARN_INTERVALL_MS = 60_000;

const TAG_MS = 86_400_000;
const JSONL_MUSTER = /^metriken-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** UTC calendar day, `YYYY-MM-DD`. UTC so that rotation does not depend on the host's time zone. */
function tagVon(zeitMs: number): string {
  return new Date(zeitMs).toISOString().slice(0, 10);
}

/**
 * Writes the snapshot once per second (`metriken.json`, overwritten, for the
 * admin service) and appends the same line to the daily log
 * `metriken-<YYYY-MM-DD>.jsonl` in the same folder (for load probes and later
 * analysis).
 *
 * All of this is a side dish of the game loop: a write failure (disk full,
 * missing rights, folder gone) must neither throw nor hold up the tick. It is
 * reported as a warning, at most once per minute and target, with the count
 * of failures swallowed in between. The clock is the snapshot's `zeitMs`, so
 * rotation and throttling can be tested without the system clock.
 */
export class MetrikSchreiber {
  private letzterTag = '';
  private readonly letzteWarnung = new Map<string, number>();
  private readonly unterdrueckt = new Map<string, number>();

  constructor(
    /** Path of `metriken.json`; the daily log lives in the same folder. */
    private readonly schnappschussDatei: string,
    private readonly warnung: (text: string) => void = (text) => console.warn(text),
    private readonly aufbewahrungTage = METRIK_AUFBEWAHRUNG_TAGE
  ) {}

  schreibe(schnappschuss: MetrikSchnappschuss): void {
    const zeile = JSON.stringify(schnappschuss);

    try {
      // .tmp first, then rename: a reader (admin/) must never see a file that
      // is half written (same reason as the world save, WovServer.saveWorldAsync).
      const tmp = `${this.schnappschussDatei}.tmp`;
      writeFileSync(tmp, zeile);
      renameSync(tmp, this.schnappschussDatei);
    } catch (fehler) {
      this.warne('snapshot', schnappschuss.zeitMs, this.schnappschussDatei, fehler);
    }

    const ordner = dirname(this.schnappschussDatei);
    // `tagVon` sits inside the try: a timestamp that is not a date (NaN,
    // Infinity) makes `toISOString` throw, and that must end as a warning like
    // any other write failure, not as an exception out of the tick timer.
    let tag: string | undefined;
    let datei = ordner;
    try {
      tag = tagVon(schnappschuss.zeitMs);
      datei = join(ordner, `metriken-${tag}.jsonl`);
      appendFileSync(datei, zeile + '\n');
    } catch (fehler) {
      this.warne('jsonl', schnappschuss.zeitMs, datei, fehler);
    }

    // Prune on the first write and on every day change, not every second.
    // Without a valid day there is nothing to prune against.
    if (tag !== undefined && tag !== this.letzterTag) {
      this.letzterTag = tag;
      this.raeumeAuf(ordner, schnappschuss.zeitMs);
    }
  }

  /** Delete `metriken-*.jsonl` files that are `aufbewahrungTage` days old or older. Other files stay. */
  private raeumeAuf(ordner: string, jetztMs: number): void {
    // Cut-off date: today minus N days. A log with exactly that date is N days
    // old and goes; today and the N-1 days before it stay.
    const grenze = tagVon(jetztMs - this.aufbewahrungTage * TAG_MS);
    let namen: string[];
    try {
      namen = readdirSync(ordner);
    } catch (fehler) {
      this.warne('prune', jetztMs, ordner, fehler);
      return;
    }
    for (const name of namen) {
      const treffer = JSONL_MUSTER.exec(name);
      if (!treffer || treffer[1]! > grenze) continue;
      const pfad = join(ordner, name);
      try {
        unlinkSync(pfad);
      } catch (fehler) {
        this.warne('prune', jetztMs, pfad, fehler);
      }
    }
  }

  private warne(ziel: string, jetztMs: number, pfad: string, fehler: unknown): void {
    const zuletzt = this.letzteWarnung.get(ziel);
    // A clock that jumped back (jetztMs < zuletzt) must not mute the target for good.
    if (zuletzt !== undefined && jetztMs >= zuletzt && jetztMs - zuletzt < METRIK_WARN_INTERVALL_MS) {
      this.unterdrueckt.set(ziel, (this.unterdrueckt.get(ziel) ?? 0) + 1);
      return;
    }
    this.letzteWarnung.set(ziel, jetztMs);
    const weitere = this.unterdrueckt.get(ziel) ?? 0;
    this.unterdrueckt.set(ziel, 0);
    const zusatz = weitere > 0 ? ` (${weitere} further failure(s) since the last warning)` : '';
    this.warnung(`[WoV] Metrics ${ziel} could not be written: ${pfad}: ${(fehler as Error).message}${zusatz}`);
  }
}
