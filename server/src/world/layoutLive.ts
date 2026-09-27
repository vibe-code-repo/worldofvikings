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
 *    Anfrage-Datei (per `stat`, s. u.) und löscht GENAU die gesperrten ids, die im aktuellen Dokument
 *    fehlen — kein Abgleich im Boot-Stil (`vorgabe.bestaetigt`, ausgewertet in `WovServer`);
 *  - Rücknahme je id: Steht sie wieder im Dokument, fällt sie beim nächsten Abgleich aus der Sperrdatei
 *    (`sperreAbgleichen`), ohne dass diese Wache das ausdrücklich anstößt;
 *  - „Welt zurücksetzen": schreibt ein neues Dokument mit anderem Hash; die alte Sperrdatei bleibt zwar
 *    zunächst liegen, ihre ids haben aber nach dem harten Reset (neuer Spielstand) kein ZDO mehr und
 *    gelten damit nicht mehr als aktiv — der nächste Abgleich räumt die (dann leere) Sperrdatei mit auf.
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
import { sanitizeWorldLayoutMitBericht, type SanitizeBericht } from '@wov/shared/src/worldlayout/sanitize.js';
import { quittungLoeschenSicher, quittungSchreiben, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { bestaetigenAnfrageLesen, bestaetigenAnfrageLoeschen } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import type { LoeschsperreGrund } from '@wov/shared/src/worldlayout/loeschsperre.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';
import { AENDERUNGEN_MAX, type Grabsteine } from './layoutLiveAbgleich.js';
import { sperreErweitern } from './layoutBootSchutz.js';

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
  | { art: 'zuViele'; anzahl: number };

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
  readonly geschuetzteIdsJetzt?: (neu: WorldLayout) => ReadonlySet<string> | 'kaputt';
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
    this.letzterAnfrageStand = anfrageStand;

    if (stand === this.letzterStand && !neueAnfrage) return;
    // Speichern hat Vorrang: den Stand NICHT merken, damit der nächste Takt es erneut versucht.
    if (this.d.speichertGerade()) return;

    const t0 = performance.now();

    const bytes = readFileSync(this.d.pfad);
    const hash = layoutHash(bytes);
    this.letzterStand = stand;

    // Karte Z3 N1: die Bestätigungsanfrage wird IMMER verbraucht (gelöscht), sobald ihr `stat` sich
    // geändert hat — gleich ob ihr Hash zu DIESEM Tick passt: Eine Anfrage für einen überholten Stand
    // soll nicht liegen bleiben und einen SPÄTEREN, andersartigen Stand treffen.
    let bestaetigt = false;
    if (neueAnfrage && this.d.bestaetigenPfad) {
      try {
        const anfrage = bestaetigenAnfrageLesen(this.d.bestaetigenPfad);
        if (anfrage) {
          bestaetigenAnfrageLoeschen(this.d.bestaetigenPfad);
          bestaetigt = anfrage.hash === hash;
        }
      } catch (fehler) {
        console.error(`[WoV] Layout-Wache: Bestätigungsanfrage: ${(fehler as Error).message}`);
      }
    }

    if (this.d.boot && this.d.boot.art !== 'angewendet') {
      // Der Boot hat das Dokument nicht angewendet: Es gibt keinen Stand, gegen den ein Abgleich sinnvoll wäre
      // (alles gälte als neu und belebte gefällte Bäume). Bis zum nächsten sauberen Boot wirkt nichts live.
      const grund = this.d.boot.art === 'abgelehnt' ? this.d.boot.grund : 'Start hat das Dokument nicht angewendet';
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, `Start ohne Vergleichsstand (${grund}); die Datei gilt ab dem nächsten Neustart`);
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
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, `Datei kein JSON: ${(fehler as Error).message}`);
      return;
    }
    const neuBericht = sanitizeWorldLayoutMitBericht(roh);
    if (!neuBericht) {
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, 'Dokument vom Sanitizer abgelehnt');
      return;
    }
    const neuKanonisch = JSON.stringify(neuBericht.layout);

    // Karte Z3 N1: Schnappschuss der AKTUELL (vor diesem Takt) aktiv gesperrten ids — EINMAL gelesen und
    // unverändert an `anwenden()` weitergegeben (`vorgabe.geschuetzteIds`). Würde `anwenden()` stattdessen
    // die Sperrdatei selbst neu einlesen, sähe es die ids, die `pruefeLoeschregel` gleich im selben Takt
    // NEU anlegt, schon als „längst gesperrt" — und stufte eine echte Massenlöschung fälschlich als
    // folgenlose Nicht-Änderung ein, statt sie (wie vor dieser Nachbesserung) mit `bestaetigung-noetig`
    // bzw. `zu-viele-aenderungen` zu quittieren.
    //
    // UNBEDINGT aufgerufen (nicht erst, wenn `neuKanonisch !== this.kanonisch`): Er räumt dabei auch per
    // id ab (Rücknahme, `sperreAbgleichen`), was im Dokument wieder auftaucht — und DAS muss auch dann
    // laufen, wenn dieser Tick sonst als „unverändert" gilt. Ein Dokument, das nach einem abgelehnten
    // Schreibvorgang exakt auf den zuletzt ERFOLGREICH angewendeten Stand zurückgeschrieben wird (Karte
    // Z3 N1, Fall „Rücknahme statt Bestätigen"), ist genau so ein Fall: `this.kanonisch` blieb dort
    // stehen (ein abgelehnter Schreibvorgang aktualisiert ihn nie), die Rücknahme wäre also unsichtbar,
    // liefe dieser Aufruf nur innerhalb des `neuKanonisch !== this.kanonisch`-Zweigs.
    const geschuetzteIdsJetzt = this.d.geschuetzteIdsJetzt?.(neuBericht.layout);
    let sperrDetail: { anzahl: number; hash: string } | undefined;
    if (geschuetzteIdsJetzt !== undefined && neuKanonisch !== this.kanonisch && this.angewendet && this.d.pruefeLoeschregel && this.d.loeschsperrePfad) {
      const bereitsGesperrt = geschuetzteIdsJetzt === 'kaputt' ? new Set<string>() : geschuetzteIdsJetzt;
      const pruefung = this.d.pruefeLoeschregel(this.angewendet, neuBericht.layout, this.grabsteine, bereitsGesperrt);
      if (pruefung && pruefung.ids.length > 0) {
        const gezeigt = pruefung.ids.slice(0, 40).join(', ') + (pruefung.ids.length > 40 ? ` … (+${pruefung.ids.length - 40})` : '');
        console.warn(
          `[WoV] Löschsperre: ${pruefung.ids.length} Objekt(e) dauerhaft gesperrt (${gezeigt}) — ` +
            `„POST /api/welt/bestaetigen" hebt sie ausdrücklich auf, sonst überlebt die Sperre jeden Neustart.`
        );
        const sperre = sperreErweitern(this.d.loeschsperrePfad, pruefung.ids, hash, pruefung.grund);
        if (sperre) sperrDetail = { anzahl: sperre.ids.length, hash: sperre.hash };
      }
    }

    if (neuKanonisch === this.kanonisch && !bestaetigt) {
      // Wirklich nichts zu tun (etwa neu formatiert): nichts anwenden. Eine offene Sperre lebt allein in
      // der Sperrdatei und braucht dafür keine eigene Quittung mehr.
      this.quittiere(hash, 'angewendet', null, null, undefined, sperrDetail);
      return;
    }
    if (neuKanonisch !== this.kanonisch && this.angewendet && !bestaetigt) {
      const teile = geoAenderung(this.angewendet, neuBericht.layout);
      if (teile.length > 0) {
        console.warn(`[WoV] Layout-Wache: Geo-Änderung (${teile.join(', ')}) — geschrieben, aber erst nach dem Neustart wirksam, nichts angewendet`);
        this.quittiere(hash, 'nicht-angewendet', 'geo', null, teile.join(', '), sperrDetail);
        return;
      }
    }
    const ergebnis = this.d.anwenden(roh, { neu: neuBericht, alt: this.angewendet, grabsteine: this.grabsteine, bestaetigt, geschuetzteIds: geschuetzteIdsJetzt });
    if (ergebnis.art === 'abgelehnt') {
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, ergebnis.grund, sperrDetail);
      return;
    }
    if (ergebnis.art === 'verworfen') {
      console.warn(`[WoV] Layout-Wache: Einträge verworfen, nichts angewendet (${ergebnis.detail}) — nach der Korrektur greift der Abgleich`);
      this.quittiere(hash, 'nicht-angewendet', 'verworfen', null, ergebnis.detail, sperrDetail);
      return;
    }
    if (ergebnis.art === 'zuViele') {
      const detail = `${ergebnis.anzahl} Änderungen (Grenze ${AENDERUNGEN_MAX})`;
      console.warn(`[WoV] Layout-Wache: ${detail}, nichts angewendet — die Datei gilt ab dem nächsten Neustart`);
      this.quittiere(hash, 'nicht-angewendet', 'zu-viele-aenderungen', null, detail, sperrDetail);
      return;
    }
    if (ergebnis.art === 'bestaetigung') {
      console.warn(
        `[WoV] Layout-Wache: Bestätigung nötig, nichts angewendet (${ergebnis.detail}) — die Datei bleibt; ` +
          `„POST /api/welt/bestaetigen" wendet sie trotzdem an, sonst übernimmt der nächste Neustart dieselbe Sperre`
      );
      this.quittiere(hash, 'nicht-angewendet', 'bestaetigung-noetig', null, ergebnis.detail, sperrDetail);
      return;
    }
    this.d.uebernehmen(roh);
    this.kanonisch = neuKanonisch;
    this.angewendet = neuBericht.layout;
    console.log(`[WoV] Layout-Wache: angewendet in ${(performance.now() - t0).toFixed(1)} ms (ganzer Takt)`);
    this.quittiere(hash, 'angewendet', null, ergebnis.zaehler, ergebnis.detail, sperrDetail);
  }

  private quittiere(
    hash: string,
    ergebnis: Quittung['ergebnis'],
    grund: Quittung['grund'],
    zaehler: Record<string, number> | null,
    detail?: string,
    loeschsperre?: { anzahl: number; hash: string }
  ): void {
    const q: Quittung = {
      hash,
      ergebnis,
      grund,
      ...(detail ? { detail } : {}),
      zaehler,
      zeit: new Date().toISOString(),
      ...(loeschsperre ? { loeschsperre } : {}),
    };
    try {
      quittungSchreiben(this.d.quittungsPfad, q);
    } catch (fehler) {
      console.error(`[WoV] Layout-Wache: Quittung nicht geschrieben: ${(fehler as Error).message}`);
    }
  }
}
