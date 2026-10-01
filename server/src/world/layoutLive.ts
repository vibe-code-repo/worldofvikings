import { heightResponseMessage } from '@wov/shared/src/worldlayout/heightMessages.js';
/**
 * Live-Abgleich des Weltdokuments (Editor E2, Karte K5.0): Der laufende
 * Spielserver übernimmt eine geschriebene Weltdatei binnen einer Sekunde,
 * ohne Neustart.
 *
 * ── Kanal ────────────────────────────────────────────────────────────
 * Datei-Wache nach dem Muster der Adminliste (`admin/AdminListe.ts`): Im
 * 1-Sekunden-Block von `update()` ein `statSync` der Weltdatei. Kein
 * `fs.watch`, kein Port, kein Socket. Erst wenn sich Änderungszeit, Größe oder
 * Inode ändern, wird EINMAL gelesen; der Hash entsteht aus denselben Bytes.
 *
 * ── Was live gilt ────────────────────────────────────────────────────
 * Live ist nur, was ein ZDO ist (Platzierungen samt NPC-Daten), und davon nur,
 * was sich gegenüber dem zuletzt angewendeten Dokument geändert hat
 * (`layoutLiveAbgleich.ts`: gefällte Bäume und tote NPCs bleiben so, wenn ihr Objekt nicht angefasst wird). Jede
 * Änderung, die die Geo berührt (Regionen, Kontinente, Wasser, `detailSeed`,
 * Spawn, Routen, `einebnen`), wird NICHT angewendet und mit `geo` quittiert:
 * ein Vorgang gilt ganz oder gar nicht (kein halber Stand aus neuen Objekten
 * auf altem Boden). `einebnen` live folgt in K5.9.
 *
 * ── Schutz ───────────────────────────────────────────────────────────
 * Die Schutzrückgaben des Boots gelten unverändert (`placements` unlesbar,
 * alle Einträge verworfen): Quittung `abgelehnt`, nichts geschieht. Hat der
 * Sanitizer EINZELNE Einträge verworfen oder in einem gesetzten Feld geklemmt (Tippfehler wie `x: "abc"`, `yaw: "abc"`), wendet der
 * Live-Weg gar nichts an: Quittung `verworfen` mit den betroffenen ids in
 * `detail`, der Vergleichsstand bleibt der alte. Gemeint ist: kein Löschen
 * (ein verworfener Eintrag gälte sonst als entfernt) und kein Wiederbeleben
 * beim Korrigieren (der Eintrag gälte dann als neu). Nach der Korrektur greift
 * der Abgleich gegen den alten Stand, als wäre nichts geschehen. Mehr als
 * `AENDERUNGEN_MAX` Änderungen in einem Schreibvorgang: `zu-viele-aenderungen`,
 * ebenfalls nichts (die Datei gilt nach dem Neustart). Wurde das Dokument
 * schon beim Boot nicht angewendet (`placements` unlesbar), gibt es keinen
 * Vergleichsstand: jede Quittung bis zum nächsten Neustart ist `abgelehnt`. Würde der Abgleich viele Objekte oder Objekte mit
 * Zustand entfernen, meldet die Quittung `bestaetigung-noetig` und nichts
 * geschieht. Solange ein Speichern läuft, wird nichts
 * angewendet; die Wache probiert es eine Sekunde später erneut.
 *
 * ── Quittung ─────────────────────────────────────────────────────────
 * Nach jedem gesehenen Stand schreibt die Wache die Quittung
 * (`shared/worldlayout/quittung.ts`). Der Spielserver schreibt nie ins
 * Weltdokument.
 *
 * ── Dauerhafte Löschsperre (Karte Z3 N1) ──────────────────────────────
 * `bestaetigung-noetig` heißt: nichts geschieht, die Datei bleibt liegen — GENAU wie bisher. Neu ist, dass
 * die betroffenen ids dabei in einer eigenen, dauerhaften Sperrdatei landen (`layoutBootSchutz.ts`,
 * `sperreErweitern`), die weder ein Neustart noch eine harmlose Folgeänderung an ANDEREN Objekten löscht.
 * Diese Prüfung (`this.d.pruefeLoeschregel`) läuft VOR jeder anderen Entscheidung dieses Ticks — auch vor
 * einer Geo-Änderung und unabhängig von `AENDERUNGEN_MAX` (Angriffsbefund A1: sonst bliebe der Kartenfall
 * auf einer Welt mit mehr als 40 Platzierungen ungeschützt). Die Quittung DIESES Schreibvorgangs behält
 * ihren bisherigen Grund (auch `zu-viele-aenderungen` oder `geo`); sie bekommt nur zusätzlich das Feld
 * `loeschsperre`. Ob eine id danach wirklich noch etwas schützt, entscheidet nicht diese Wache, sondern
 * `layoutAbgleich`/`liveAbgleich` bei JEDEM Abgleich frisch (`sperreAbgleichen`): Die Wache selbst hält
 * über die Sperre kein eigenes Gedächtnis mehr (kein `offenerHash`) — sie lebt ausschließlich in der Datei.
 *
 * Aufgehoben wird eine gesperrte id durch:
 *  - eine ausdrückliche Bestätigung (`POST /api/welt/bestaetigen`): Der nächste Tick sieht die neue
 *    Anfrage-Datei (per `stat`, s. u.), übernimmt sie atomar (`bestaetigenAnfrageNehmen`, ungültige werden mit
 *    Logzeile verbraucht) und löscht GENAU die gesperrten ids, die im aktuellen Dokument fehlen — kein Abgleich
 *    im Boot-Stil (`vorgabe.bestaetigt`, ausgewertet in `WovServer`). Danach läuft das Dokument durch die
 *    übrigen Entscheidungen (Höhenfehler, Geo, Objekte): Was dort noch aussteht, wird NICHT als angewendet
 *    quittiert, und `uebernehmen` sendet nichts, was nicht wirklich angewendet wurde;
 *  - Rücknahme je id: Steht sie wieder im Dokument, fällt sie beim nächsten Abgleich aus der Sperrdatei
 *    (`sperreAbgleichen`), ohne dass diese Wache das ausdrücklich anstößt;
 *  - „Welt zurücksetzen": schreibt ein neues Dokument mit anderem Hash; die alte Sperrdatei bleibt zwar
 *    zunächst liegen, ihre ids haben aber nach dem harten Reset (neuer Spielstand) kein ZDO mehr und
 *    gelten damit nicht mehr als aktiv — der nächste Abgleich räumt die (dann leere) Sperrdatei mit auf.
 *
 * Eine unlesbare/kaputte Sperrdatei (jeder Lesefehler außer ENOENT, kaputtes JSON) schließt: Die Wache wendet
 * nichts an, überschreibt die Datei nie und gibt sie nie frei (Quittung `abgelehnt`, laute Logzeile).
 *
 * ── Takt (Karte Z3 N1, E-e) ────────────────────────────────────────────
 * Die Abkürzung „Stand unverändert" bleibt AUCH bei offener Sperre erhalten: Ein Tick, der weder eine
 * neue Weltdatei noch eine neue Bestätigungsanfrage sieht, tut nichts außer zwei `stat`-Aufrufen. Die
 * Bestätigungsanfrage wird deshalb nicht mehr wie vor dieser Karte bei JEDEM Tick gelesen, sondern nur,
 * wenn ihr `stat` sich seit dem letzten Tick geändert hat (neu angelegt oder ersetzt) — das genügt, weil
 * sie ohnehin binnen einer Sekunde verbraucht wird.
 */
import { statSync, readFileSync } from 'node:fs';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import {
  type HeightProblem,
  sanitizeWorldLayoutMitBericht,
  type SanitizeBericht,
} from '@wov/shared/src/worldlayout/sanitize.js';
import { quittungLoeschenSicher, quittungSchreiben, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { bestaetigenAnfrageNehmen } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import type { LoeschsperreGrund } from '@wov/shared/src/worldlayout/loeschsperre.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';
import { AENDERUNGEN_MAX, type Grabsteine } from './layoutLiveAbgleich.js';
import { sperreErweitern, sperrInfo, type SperrAuswertung } from './layoutBootSchutz.js';
import { bereinigungsZeile, VEGETATION_LIVE_MAX, type VegetationLive } from './vegetationBereinigung.js';

/** Die Teile eines Dokuments, die die Welt formen und NICHT live geändert werden. */
export function geoAenderung(alt: WorldLayout, neu: WorldLayout): string[] {
  const teile: string[] = [];
  const gleich = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (alt.detailSeed !== neu.detailSeed) teile.push('detailSeed');
  if (!gleich(alt.regions, neu.regions)) teile.push('regionen');
  if (!gleich(alt.continents, neu.continents)) teile.push('kontinente');
  if (!gleich(alt.rivers, neu.rivers) || !gleich(alt.lakes, neu.lakes)) teile.push('wasser');
  if (!gleich(alt.defaultSpawn, neu.defaultSpawn)) teile.push('spawn');
  if (!gleich(alt.routes, neu.routes)) teile.push('routen');
  // Handkorrektur (Editor-Pinsel, T2+): Teil der kompilierten Geo wie
  // Regionen und Sockel — jede Änderung braucht deshalb denselben Neustart.
  // N2: `delta 0` wird jetzt vom SANITIZER selbst verworfen (s.
  // `sanitizeHeightDeltas`), `alt`/`neu` sind hier bereits sanitisiert —
  // ein eigener Normalisierungs-Schritt vor dem Vergleich ist deshalb nicht
  // mehr nötig (anders als in T1 N1, wo das Feld die wirkungslosen Punkte
  // noch enthielt).
  if (!gleich(alt.heightDeltas, neu.heightDeltas)) teile.push('gelaende');
  // Einebnen: die Platte ist Teil der kompilierten Geo. Verglichen wird je `id`,
  // was den Boden formt (Ort und Radius); ohne Einebnen gibt es keinen Eintrag.
  const ebnen = (l: WorldLayout): Map<string, string> => {
    const m = new Map<string, string>();
    for (const p of l.placements ?? []) {
      if (typeof p.einebnen === 'number' && p.einebnen > 0) m.set(p.id ?? `${p.prefab}@${p.x},${p.z}`, `${p.x},${p.z},${p.einebnen}`);
    }
    return m;
  };
  const a = ebnen(alt);
  const n = ebnen(neu);
  let ebnenGeaendert = a.size !== n.size;
  for (const [id, wert] of a) if (n.get(id) !== wert) ebnenGeaendert = true;
  if (ebnenGeaendert) teile.push('einebnen');
  // Eine geänderte Route an einem vorhandenen Objekt greift nicht live: Der
  // RoutenLaeufer meldet dieselbe ZDO nur einmal an.
  const routeVon = (l: WorldLayout): Map<string, string> =>
    new Map((l.placements ?? []).filter((p) => p.id).map((p) => [p.id as string, p.route ?? '']));
  const ra = routeVon(alt);
  for (const [id, route] of routeVon(neu)) {
    if (ra.has(id) && ra.get(id) !== route) {
      teile.push('route');
      break;
    }
  }
  return teile;
}

/** Ergebnis der Anwendung des Objektteils, geliefert vom Spielserver. */
export type Anwendung =
  | { art: 'angewendet'; zaehler: Record<string, number>; detail?: string }
  | { art: 'abgelehnt'; grund: string }
  /** Viele Objekte oder Objekte mit Zustand würden entfernt: nichts angewendet, `detail` nennt die ids. */
  | { art: 'bestaetigung'; detail: string }
  /** Der Sanitizer hat Einträge verworfen: nichts angewendet, `detail` nennt sie. */
  | { art: 'verworfen'; detail: string }
  /** Mehr Änderungen als die Obergrenze: nichts angewendet, `anzahl` ist die Zahl. */
  | { art: 'zuViele'; anzahl: number }
  /**
   * Karte Z3 N1: eine ausdrückliche Bestätigung wurde ausgeführt: genau die gesperrten, im Dokument fehlenden
   * ids sind weg (`ids`), die Sperre ist freigegeben — sonst geschah NICHTS (kein Abgleich, keine Geo, kein Spawn).
   */
  | { art: 'bestaetigt'; ids: readonly string[]; entfernt: number };

/** Was die Wache dem Spielserver für EINE Anwendung mitgibt (einmal sanitisiert, nicht dreimal). */
export interface LiveVorgabe {
  /** Das neue Dokument, sanitisiert. */
  readonly neu: SanitizeBericht;
  /** Das zuletzt angewendete Dokument, sanitisiert (null: unlesbar). */
  readonly alt: WorldLayout | null;
  /** Entfernte Einträge ohne Objekt (gefällt), siehe `layoutLiveAbgleich.ts`; die Wache besitzt sie. */
  readonly grabsteine: Grabsteine;
  /**
   * Karte Z3 N1: eine ausdrückliche Bestätigung für GENAU diesen Hash liegt vor — `WovServer` löscht dann
   * genau die dauerhaft gesperrten ids, die im Dokument fehlen (kein Abgleich im Boot-Stil).
   */
  readonly bestaetigt?: boolean;
  /**
   * Karte Z3 N1: dauerhaft gesperrte ids, als Schnappschuss VOM ANFANG dieses Takts (vor einer
   * möglichen Erweiterung durch `pruefeLoeschregel` weiter unten im selben Takt). `WovServer` muss
   * GENAU diesen alten Stand für die Anwendung benutzen, nicht neu einlesen: Sonst sähe ein Takt, der
   * gerade selbst eine neue Sperre anlegt, seine eigenen, druckfrischen ids schon als „längst gesperrt"
   * und stufte eine echte Massenlöschung fälschlich als folgenlose Nicht-Änderung ein (0 entfernt) statt
   * als `bestaetigung-noetig` zu quittieren. `'kaputt'`: die Datei ist da, aber unlesbar.
   */
  readonly geschuetzteIds?: ReadonlySet<string> | 'kaputt';
}

export interface LayoutWacheAbhaengigkeiten {
  /** Die Weltdatei dieser Instanz. */
  readonly pfad: string;
  readonly quittungsPfad: string;
  /**
   * Karte Z3: Pfad der Bestätigungsanfrage ("trotzdem anwenden", `POST /api/welt/bestaetigen`). Fehlt er
   * (ältere Aufrufer, Tests ohne Z3-Bezug), wird nie eine Anfrage gesucht — wie vor dieser Karte.
   */
  readonly bestaetigenPfad?: string;
  /**
   * Karte Z3 N1: Pfad der dauerhaften Löschsperre. Nötig, damit diese Wache eine neu erkannte
   * Massenlöschung (`pruefeLoeschregel`) dort ablegen kann. Fehlt er, wird nichts abgelegt (wie
   * `bestaetigenPfad` fehlend: ältere Aufrufer, Tests ohne Z3-N1-Bezug).
   */
  readonly loeschsperrePfad?: string;
  /**
   * Karte Z3 N1: die AKTUELL (vor jeder Änderung durch diesen Takt) aktiv gesperrten ids — aus der
   * Sperrdatei, abgeglichen mit `neu` (Rücknahme je id, s. Kopfkommentar `layoutBootSchutz.ts`,
   * `sperreAbgleichen`) und dem ZDO-Bestand. Wird EINMAL pro Takt gerufen (nicht bei jedem
   * unveränderten Tick) und ihr Ergebnis unverändert an `anwenden()` weitergereicht — s.
   * `LiveVorgabe.geschuetzteIds`. `'kaputt'`: die Datei ist da, aber unlesbar.
   */
  readonly geschuetzteIdsJetzt?: (neu: WorldLayout, ruecknahme: boolean) => SperrAuswertung;
  /**
   * Karte Z3 N1: Würde `neu` gegenüber `alt` Objekte entfernen, die Regel (a) oder (b) einer
   * Massenlöschung träfe — UNABHÄNGIG von `AENDERUNGEN_MAX` und einer gleichzeitigen Geo-Änderung? Von
   * `WovServer` mit Zugriff auf den ZDO-Bestand implementiert (`layoutLiveAbgleich.ts`, `wuerdeEntfernen`).
   * `bereitsGesperrt` (derselbe Schnappschuss wie `geschuetzteIdsJetzt`, s. dort): ids, die schon VOR
   * diesem Takt gesperrt waren, zählen hier nicht als „neu entdeckt" — sonst würde jede Folgeänderung an
   * einem ANDEREN Objekt, die im selben Vergleich zufällig alte, längst gesperrte ids mit nennt, die
   * Regel erneut auslösen (E-c). `null`: die Regel greift nicht, nichts wird NEU gesperrt.
   */
  readonly pruefeLoeschregel?: (
    alt: WorldLayout,
    neu: WorldLayout,
    grabsteine: Grabsteine,
    bereitsGesperrt: ReadonlySet<string>
  ) => { ids: readonly string[]; grund: LoeschsperreGrund } | null;
  /**
   * Eigener Ast für `vegetationEntfernt` (Karte Bäume entfernen V2): keine Geo-Änderung, zählt nicht gegen
   * `AENDERUNGEN_MAX`. `trocken`: nur zählen (Obergrenze `VEGETATION_LIVE_MAX`), nichts geschieht; sonst löschen
   * und den Streu-Prüfer neuer Zonen austauschen. Fehlt er (Tests ohne Spielserver), gibt es den Ast nicht.
   */
  readonly vegetationLive?: (alt: WorldLayout, neu: WorldLayout, trocken: boolean) => VegetationLive;
  /** Das Dokument, das der Server gerade in Gebrauch hat (roh). */
  readonly aktuell: () => unknown;
  /** Läuft ein Speichern? Dann nicht anwenden. */
  readonly speichertGerade: () => boolean;
  /** Den Objektteil des neuen Dokuments anwenden (mit den Schutzrückgaben des Boots). */
  readonly anwenden: (roh: unknown, vorgabe: LiveVorgabe) => Anwendung;
  /**
   * Was der Boot mit dem Dokument gemacht hat. Wurde es nicht angewendet (`placements` unlesbar), fehlt der
   * Vergleichsstand: Die Wache wendet dann nichts live an und quittiert `abgelehnt`, bis der nächste Boot es kann.
   */
  readonly boot?: Anwendung;
  /** Das Dokument des Servers tauschen und den Clients der Hauptwelt schicken. */
  readonly uebernehmen: (roh: unknown) => void;
}

export class LayoutWache {
  private letzterStand = '';
  /** Stand der Bestätigungsanfrage-Datei (Karte Z3 N1, E-e): nur per `stat`, nicht gelesen. */
  private letzterAnfrageStand: string | null = null;
  /** Kanonische Darstellung des Standes, den der Server hat: gleicher Inhalt ⇒ nichts zu tun. */
  private kanonisch: string | null = null;
  /** Das Dokument, das zuletzt angewendet wurde (sanitisiert): Vergleichsstand für die id-Auswahl. */
  private angewendet: WorldLayout | null = null;
  private readonly grabsteine: Grabsteine = new Map();

  constructor(private readonly d: LayoutWacheAbhaengigkeiten) {
    // Eine Quittung des vorigen Serverlaufs gilt für diesen nicht: Sie würde im Boot-Fenster
    // dem Betriebsdienst ein 200 für einen Stand liefern, den dieser Lauf nie angewendet hat.
    // Die Löschsperre (Karte Z3 N1) ist eine ANDERE Datei und wird hier bewusst NIE gelöscht — sie lebt
    // unabhängig von diesem Prozess, s. Kopfkommentar.
    quittungLoeschenSicher(d.quittungsPfad, (text) => console.error(`[WoV] Layout-Wache: ${text}`));
  }

  /** Im 1-Sekunden-Takt aufrufen. Wirft nie. */
  tick(): void {
    try {
      this.pruefe();
    } catch (fehler) {
      console.error(`[WoV] Layout-Wache: ${(fehler as Error).message}`);
    }
  }

  private pruefe(): void {
    let stand: string;
    try {
      const s = statSync(this.d.pfad);
      stand = `${s.mtimeMs}:${s.size}:${s.ino}`;
    } catch {
      return; // Datei fehlt gerade (Umbenennen, Wartung): nichts tun.
    }
    // Karte Z3 N1 (E-e): die Bestätigungsanfrage wird NUR per `stat` beobachtet, nicht gelesen — ein Tick
    // ohne neuen Stand UND ohne neue Anfrage bleibt bei zwei `stat`-Aufrufen (die Abkürzung unten greift).
    let anfrageStand: string | null = null;
    if (this.d.bestaetigenPfad) {
      try {
        const s = statSync(this.d.bestaetigenPfad);
        anfrageStand = `${s.mtimeMs}:${s.size}:${s.ino}`;
      } catch {
        anfrageStand = null;
      }
    }
    const neueAnfrage = anfrageStand !== null && anfrageStand !== this.letzterAnfrageStand;

    if (stand === this.letzterStand && !neueAnfrage) {
      this.letzterAnfrageStand = anfrageStand;
      return;
    }
    // Speichern hat Vorrang: weder den Stand NOCH den Anfrage-Stand merken, damit der nächste Takt beides
    // erneut sieht (sonst ginge eine Anfrage, die genau während eines Speicherns eintrifft, verloren).
    if (this.d.speichertGerade()) return;
    this.letzterAnfrageStand = anfrageStand;

    const t0 = performance.now();

    const bytes = readFileSync(this.d.pfad);
    const hash = layoutHash(bytes);
    this.letzterStand = stand;

    // Karte Z3 N1: die Bestätigungsanfrage wird IMMER verbraucht (atomar übernommen und gelöscht), sobald ihr
    // `stat` sich geändert hat — gleich ob gültig oder ob ihr Hash zu DIESEM Tick passt: Eine Anfrage für einen
    // überholten Stand soll nicht liegen bleiben und einen SPÄTEREN, andersartigen Stand treffen. Eine
    // ungültige Anfrage gibt eine Logzeile.
    let bestaetigung: NonNullable<Quittung['bestaetigung']> | undefined;
    let bestaetigt = false;
    if (neueAnfrage && this.d.bestaetigenPfad) {
      const r = bestaetigenAnfrageNehmen(this.d.bestaetigenPfad);
      if (r.art === 'ungueltig') {
        console.warn(`[WoV] Layout-Wache: Bestätigungsanfrage ungültig (${r.grund}) — verbraucht, nichts bestätigt`);
      } else if (r.art === 'gueltig') {
        bestaetigung = { id: r.anfrage.id ?? null, entfernt: 0 };
        bestaetigt = r.anfrage.hash === hash;
        if (!bestaetigt) {
          bestaetigung.abgelehnt = 'veraltet';
          console.warn(`[WoV] Layout-Wache: Bestätigungsanfrage für einen überholten Stand (${r.anfrage.hash.slice(0, 12)}…, jetzt ${hash.slice(0, 12)}…) — verbraucht, nichts bestätigt`);
        }
      }
    }
    const ablehnen = (grund: string): void => {
      if (bestaetigung && !bestaetigung.abgelehnt) bestaetigung.abgelehnt = grund;
    };

    if (this.d.boot && this.d.boot.art !== 'angewendet') {
      // Der Boot hat das Dokument nicht angewendet: Es gibt keinen Stand, gegen den ein Abgleich sinnvoll wäre
      // (alles gälte als neu und belebte gefällte Bäume). Bis zum nächsten sauberen Boot wirkt nichts live.
      const grund = this.d.boot.art === 'abgelehnt' ? this.d.boot.grund : 'Start hat das Dokument nicht angewendet';
      ablehnen('kein-vergleichsstand');
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, `Start ohne Vergleichsstand (${grund}); die Datei gilt ab dem nächsten Neustart`, { bestaetigung });
      return;
    }
    if (this.kanonisch === null) {
      const ausgang = sanitizeWorldLayoutMitBericht(this.d.aktuell());
      this.angewendet = ausgang?.layout ?? null;
      this.kanonisch = ausgang ? JSON.stringify(ausgang.layout) : null;
    }

    let roh: unknown;
    try {
      roh = JSON.parse(bytes.toString('utf-8'));
    } catch (fehler) {
      ablehnen('dokument-unlesbar');
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, `Datei kein JSON: ${(fehler as Error).message}`, { bestaetigung });
      return;
    }
    const neuBericht = sanitizeWorldLayoutMitBericht(roh);
    if (!neuBericht) {
      ablehnen('dokument-unlesbar');
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, 'Dokument vom Sanitizer abgelehnt', { bestaetigung });
      return;
    }
    const neuKanonisch = JSON.stringify(neuBericht.layout);

    // Karte Z3 N1: Der Sanitizer macht aus einem falsch GETYPTEN `placements` (Text, `null`, ein Array
    // ohne einen einzigen gültigen Eintrag) ein leeres Array — genau wie aus einem ABSICHTLICH leeren
    // Dokument. `d.anwenden()` unterscheidet das unten selbst und lehnt den erstgenannten Fall VOLLSTÄNDIG
    // ab (`abgelehnt`, nichts geschieht, s. `WovServer.spawnLayoutPlacements`); die Löschregel darf diesen
    // Unterschied nicht verwischen, sonst sperrt ein Tippfehler in der Datei (der ohnehin nichts löscht)
    // trotzdem jedes zu diesem Zeitpunkt stehende Objekt dauerhaft. `rohPlacements === undefined` oder ein
    // Array (auch ein leeres) heißt „bewusst leer“.
    const rohPlacements = (roh as { placements?: unknown } | null)?.placements;
    const rohWohlgeformt = rohPlacements === undefined || Array.isArray(rohPlacements);
    const rohAnzahl = Array.isArray(rohPlacements) ? rohPlacements.length : 0;
    const dokumentWohlgeformt = rohWohlgeformt && !(rohAnzahl > 0 && (neuBericht.layout.placements?.length ?? 0) === 0);

    // Karte Z3 N1: Schnappschuss der AKTUELL (vor diesem Takt) aktiv gesperrten ids — EINMAL gelesen und
    // unverändert an `anwenden()` weitergegeben (`vorgabe.geschuetzteIds`). Würde `anwenden()` stattdessen
    // die Sperrdatei selbst neu einlesen, sähe es die ids, die `pruefeLoeschregel` gleich im selben Takt
    // NEU anlegt, schon als „längst gesperrt" — und stufte eine echte Massenlöschung fälschlich als
    // folgenlose Nicht-Änderung ein.
    //
    // UNBEDINGT aufgerufen (nicht erst, wenn `neuKanonisch !== this.kanonisch`): Er räumt dabei auch per
    // id ab (Rücknahme, `sperreAbgleichen`), was im Dokument wieder auftaucht — und DAS muss auch dann
    // laufen, wenn dieser Tick sonst als „unverändert" gilt. Eine Rücknahme gilt aber nur aus einem
    // verlässlichen Dokument: Weder ein Höhenfehler noch verworfene/falsch getypte Platzierungen heben eine
    // Sperre auf.
    let sperre: SperrAuswertung | undefined = this.d.geschuetzteIdsJetzt?.(neuBericht.layout, dokumentWohlgeformt && !neuBericht.heightProblem);
    if (sperre?.aktive === 'kaputt') {
      // GESCHLOSSEN: nichts anwenden, nichts sperren, nichts freigeben. Die Datei wird weder umgangen noch überschrieben.
      const text = 'Löschsperre-Datei unlesbar (GESCHLOSSEN): nichts angewendet, bis sie von Hand geprüft ist; danach die Weltdatei erneut speichern oder neu starten';
      console.error(`[WoV] Layout-Wache: ${text}`);
      ablehnen('sperre-unlesbar');
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, text, { bestaetigung });
      return;
    }
    if (dokumentWohlgeformt && neuKanonisch !== this.kanonisch && this.angewendet && this.d.pruefeLoeschregel && this.d.loeschsperrePfad && sperre) {
      // Läuft VOR dem Höhenfehler, VOR der Geo-Änderung und VOR der Obergrenze (E-b): Auch ein Schreibvorgang, den
      // die Quittung anschließend mit `verworfen`, `geo` oder `zu-viele-aenderungen` beantwortet, sperrt seine Löschungen.
      const pruefung = this.d.pruefeLoeschregel(this.angewendet, neuBericht.layout, this.grabsteine, sperre.aktive);
      if (pruefung && pruefung.ids.length > 0) {
        const gezeigt = pruefung.ids.slice(0, 40).join(', ') + (pruefung.ids.length > 40 ? ` … (+${pruefung.ids.length - 40})` : '');
        console.warn(
          `[WoV] Löschsperre: ${pruefung.ids.length} Objekt(e) dauerhaft gesperrt (${gezeigt}) — ` +
            `„POST /api/welt/bestaetigen" hebt sie ausdrücklich auf, sonst überlebt die Sperre jeden Neustart.`
        );
        const erweitert = sperreErweitern(this.d.loeschsperrePfad, pruefung.ids, hash, pruefung.grund);
        if (erweitert && erweitert.art !== 'ok') {
          const text =
            erweitert.art === 'kaputt'
              ? 'Löschsperre-Datei unlesbar (GESCHLOSSEN): neue Sperre nicht gespeichert, nichts angewendet'
              : `Löschsperre nicht schreibbar (${erweitert.text}): nichts angewendet`;
          console.error(`[WoV] Layout-Wache: ${text}`);
          ablehnen('sperre-nicht-schreibbar');
          this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, text, { bestaetigung });
          return;
        }
      }
    }

    // Ausdrückliche Bestätigung (E-d): löscht GENAU die gesperrten, im Dokument fehlenden ids, sonst nichts —
    // kein Abgleich, keine Geo, kein Spawn, kein `uebernehmen`. Was das Dokument sonst noch will (Geo, Höhe,
    // andere Objekte), läuft danach unverändert durch die Entscheidungen unten und wird ehrlich quittiert.
    if (bestaetigt && bestaetigung) {
      if (!dokumentWohlgeformt) {
        ablehnen('dokument-unzuverlaessig');
      } else {
        const ergebnis = this.d.anwenden(roh, { neu: neuBericht, alt: this.angewendet, grabsteine: this.grabsteine, bestaetigt: true, geschuetzteIds: sperre?.aktive });
        if (ergebnis.art === 'bestaetigt') {
          bestaetigung.entfernt = ergebnis.entfernt;
          if (this.angewendet && ergebnis.ids.length > 0) {
            const weg = new Set(ergebnis.ids);
            const rest = (this.angewendet.placements ?? []).filter((p) => !p.id || !weg.has(p.id));
            const { placements: _alt, ...ohne } = this.angewendet;
            this.angewendet = rest.length > 0 ? { ...ohne, placements: rest } : (ohne as WorldLayout);
            this.kanonisch = JSON.stringify(this.angewendet);
          }
          sperre = this.d.geschuetzteIdsJetzt?.(neuBericht.layout, dokumentWohlgeformt && !neuBericht.heightProblem);
        } else {
          const grund = ergebnis.art === 'abgelehnt' ? ergebnis.grund : ergebnis.art === 'verworfen' ? ergebnis.detail : ergebnis.art;
          ablehnen(grund);
          if (ergebnis.art === 'verworfen') {
            this.quittiere(hash, 'nicht-angewendet', 'verworfen', null, ergebnis.detail, { bestaetigung });
            return;
          }
          this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, grund, { bestaetigung });
          return;
        }
      }
    }

    // Reject before geo comparison or any placement mutation (T1): the pending deletions are recorded above.
    if (neuBericht.heightProblem) {
      const problem = neuBericht.heightProblem;
      const detail = heightResponseMessage({ heightProblem: problem }, process.env.WOV_LANGUAGE)!;
      console.warn(`[Welt] ${detail}`);
      this.quittiere(hash, 'nicht-angewendet', 'verworfen', null, detail, { heightProblem: problem, bestaetigung });
      return;
    }

    // Beschädigte oder zu viele Kreise: nichts anwenden (wie `heightProblem`); der Boot startet davon unberührt weiter.
    if (neuBericht.vegetationProblem) {
      const p = neuBericht.vegetationProblem;
      const gezeigt = p.fehlerhaft.slice(0, 5).map((f) => `${f.eintrag}.${f.feld}`).join(', ');
      const detail =
        p.reason === 'limit'
          ? `vegetationEntfernt: ${p.anzahl} Kreise, Grenze ${p.grenze}`
          : `vegetationEntfernt: ${p.fehlerhaft.length} fehlerhafte Angabe(n) (${gezeigt})`;
      console.warn(`[WoV] Layout-Wache: ${detail} — nichts angewendet, nach der Korrektur greift der Abgleich`);
      ablehnen('vegetation-ungueltig');
      this.quittiere(hash, 'nicht-angewendet', 'verworfen', null, detail, { bestaetigung });
      return;
    }

    if (neuKanonisch === this.kanonisch) {
      // Wirklich nichts zu tun (etwa neu formatiert): nichts anwenden. Eine offene Sperre lebt allein in
      // der Sperrdatei; die Quittung nennt sie trotzdem (`quittiere` liest sie).
      this.quittiere(hash, 'angewendet', null, null, undefined, { bestaetigung });
      return;
    }
    if (this.angewendet) {
      const teile = geoAenderung(this.angewendet, neuBericht.layout);
      if (teile.length > 0) {
        console.warn(`[WoV] Layout-Wache: Geo-Änderung (${teile.join(', ')}) — geschrieben, aber erst nach dem Neustart wirksam, nichts angewendet`);
        this.quittiere(hash, 'nicht-angewendet', 'geo', null, teile.join(', '), { bestaetigung });
        return;
      }
    }
    // Vegetation, Vorprobe: Der Vorgang gilt ganz oder gar nicht. Würden die neuen Kreise mehr als die Obergrenze
    // löschen, wird abgelehnt, bevor irgendetwas angewendet ist (nichts teilweise).
    if (this.angewendet && this.d.vegetationLive) {
      const probe = this.d.vegetationLive(this.angewendet, neuBericht.layout, true);
      if (probe.art === 'zuViele') {
        const detail = `Vegetation: ${probe.anzahl} Objekte würden gelöscht (Grenze ${VEGETATION_LIVE_MAX})`;
        console.warn(`[WoV] Layout-Wache: ${detail}, nichts angewendet — die Datei gilt ab dem nächsten Neustart`);
        this.quittiere(hash, 'nicht-angewendet', 'zu-viele-aenderungen', null, detail, { bestaetigung });
        return;
      }
    }
    const ergebnis = this.d.anwenden(roh, { neu: neuBericht, alt: this.angewendet, grabsteine: this.grabsteine, bestaetigt: false, geschuetzteIds: sperre?.aktive });
    if (ergebnis.art === 'abgelehnt') {
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, ergebnis.grund, { bestaetigung });
      return;
    }
    if (ergebnis.art === 'verworfen') {
      console.warn(`[WoV] Layout-Wache: Einträge verworfen, nichts angewendet (${ergebnis.detail}) — nach der Korrektur greift der Abgleich`);
      this.quittiere(hash, 'nicht-angewendet', 'verworfen', null, ergebnis.detail, { bestaetigung });
      return;
    }
    if (ergebnis.art === 'zuViele') {
      const detail = `${ergebnis.anzahl} Änderungen (Grenze ${AENDERUNGEN_MAX})`;
      console.warn(`[WoV] Layout-Wache: ${detail}, nichts angewendet — die Datei gilt ab dem nächsten Neustart`);
      this.quittiere(hash, 'nicht-angewendet', 'zu-viele-aenderungen', null, detail, { bestaetigung });
      return;
    }
    if (ergebnis.art === 'bestaetigung') {
      console.warn(
        `[WoV] Layout-Wache: Bestätigung nötig, nichts angewendet (${ergebnis.detail}) — die Datei bleibt; ` +
          `„POST /api/welt/bestaetigen" löscht genau die gesperrten Objekte, sonst überlebt die Sperre jeden Neustart`
      );
      this.quittiere(hash, 'nicht-angewendet', 'bestaetigung-noetig', null, ergebnis.detail, { bestaetigung });
      return;
    }
    if (ergebnis.art === 'bestaetigt') {
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, 'unerwartetes Ergebnis', { bestaetigung });
      return;
    }
    // Vegetation, Ausführung (nach den Objekten, vor dem Übernehmen): löscht die gespeicherten Streu-Objekte in den
    // hinzugekommenen Kreisen und tauscht den Prüfer neuer Zonen aus. Gleicher Takt: kein Spielzustand dazwischen.
    let zaehler = ergebnis.zaehler;
    let detail = ergebnis.detail;
    if (this.angewendet && this.d.vegetationLive) {
      const v = this.d.vegetationLive(this.angewendet, neuBericht.layout, false);
      if (v.art === 'ok') {
        const e = v.ergebnis;
        console.log(bereinigungsZeile('live', e));
        zaehler = { ...zaehler, vegetationGeloescht: e.geloescht, vegetationUngemarkt: e.ungemarkt };
        if (e.ungemarkt > 0) {
          const hinweis = `Vegetation: ${e.ungemarkt} Kandidaten in ${e.zonenOhneMarke} Zone(n) ohne Marke nicht gelöscht`;
          detail = detail ? `${detail}; ${hinweis}` : hinweis;
        }
      } else if (v.art === 'zuViele') {
        // Nach der Vorprobe nicht zu erwarten (gleicher Takt); nichts gelöscht, laut melden.
        console.error(`[WoV] Layout-Wache: Vegetation: ${v.anzahl} Objekte, Grenze ${VEGETATION_LIVE_MAX} — nach der Vorprobe nicht gelöscht`);
      }
    }
    this.d.uebernehmen(roh);
    this.kanonisch = neuKanonisch;
    this.angewendet = neuBericht.layout;
    console.log(`[WoV] Layout-Wache: angewendet in ${(performance.now() - t0).toFixed(1)} ms (ganzer Takt)`);
    this.quittiere(hash, 'angewendet', null, zaehler, detail, { bestaetigung });
  }

  private quittiere(
    hash: string,
    ergebnis: Quittung['ergebnis'],
    grund: Quittung['grund'],
    zaehler: Record<string, number> | null,
    detail?: string,
    zusatz: { heightProblem?: HeightProblem; bestaetigung?: Quittung['bestaetigung'] } = {}
  ): void {
    // Die offene Sperre steht in JEDER Quittung, die die Wache schreibt (auch nach einem Boot mit Sperre oder bei
    // gleichem Inhalt), nicht nur in der, die sie erweitert hat.
    const loeschsperre = this.d.loeschsperrePfad ? sperrInfo(this.d.loeschsperrePfad) : null;
    const q: Quittung = {
      hash,
      ergebnis,
      grund,
      ...(detail ? { detail } : {}),
      ...(zusatz.heightProblem ? { heightProblem: zusatz.heightProblem } : {}),
      ...(loeschsperre ? { loeschsperre } : {}),
      ...(zusatz.bestaetigung ? { bestaetigung: zusatz.bestaetigung } : {}),
      zaehler,
      zeit: new Date().toISOString(),
    };
    try {
      quittungSchreiben(this.d.quittungsPfad, q);
    } catch (fehler) {
      console.error(`[WoV] Layout-Wache: Quittung nicht geschrieben: ${(fehler as Error).message}`);
    }
  }
}
