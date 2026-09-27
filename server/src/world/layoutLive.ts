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
 * geschieht (der Neustart räumt dann ab wie bisher). Solange ein Speichern läuft, wird nichts
 * angewendet; die Wache probiert es eine Sekunde später erneut.
 *
 * ── Quittung ─────────────────────────────────────────────────────────
 * Nach jedem gesehenen Stand schreibt die Wache die Quittung
 * (`shared/worldlayout/quittung.ts`). Der Spielserver schreibt nie ins
 * Weltdokument.
 */
import { statSync, readFileSync } from 'node:fs';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import {
  hoehenkorrekturFehler,
  hoehenkorrekturFehlerText,
  sanitizeWorldLayoutMitBericht,
  type SanitizeBericht,
} from '@wov/shared/src/worldlayout/sanitize.js';
import { quittungLoeschenSicher, quittungSchreiben, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import type { WorldLayout, ZoneHeightDelta } from '@wov/shared/src/worldlayout/types.js';
import { AENDERUNGEN_MAX, type Grabsteine } from './layoutLiveAbgleich.js';

/**
 * Kanonische Form von `heightDeltas` für den Geo-Vergleich: Punkte mit
 * `delta = 0` (gültig, aber ohne Wirkung, s. `sanitizeHeightDeltas`) fallen
 * heraus, eine dadurch leere Zone ganz. Zwei Dokumente, die sich nur in
 * solchen wirkungslosen Einträgen unterscheiden, gelten hier als GLEICH —
 * kein Geo-Neustart für eine Änderung ohne Höhenwirkung.
 */
function hoehenkorrekturKanon(liste: readonly ZoneHeightDelta[] | undefined): string {
  const zonen = (liste ?? [])
    .map((z) => {
      const is = z.i.length > 0 ? z.i.split(',') : [];
      const ds = z.d.length > 0 ? z.d.split(',') : [];
      const n = Math.min(is.length, ds.length);
      const behalten: [string, string][] = [];
      for (let k = 0; k < n; k++) if (ds[k] !== '0') behalten.push([is[k]!, ds[k]!]);
      return { zx: z.zx, zz: z.zz, i: behalten.map((p) => p[0]).join(','), d: behalten.map((p) => p[1]).join(',') };
    })
    .filter((z) => z.i.length > 0);
  return JSON.stringify(zonen);
}

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
  // N1 (Info-Punkt): NORMALISIEREN vor dem Vergleich — ein `delta: 0`
  // (gültig, aber wirkungslos, s. `sanitizeHeightDeltas`) darf allein keinen
  // Neustart ausloesen, sonst zaehlt ein Schreibvorgang als Geo-Aenderung,
  // obwohl sich am Gelaende nichts aendert.
  if (hoehenkorrekturKanon(alt.heightDeltas) !== hoehenkorrekturKanon(neu.heightDeltas)) teile.push('gelaende');
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
}

export interface LayoutWacheAbhaengigkeiten {
  /** Die Weltdatei dieser Instanz. */
  readonly pfad: string;
  readonly quittungsPfad: string;
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
  /** Kanonische Darstellung des Standes, den der Server hat: gleicher Inhalt ⇒ nichts zu tun. */
  private kanonisch: string | null = null;
  /** Das Dokument, das zuletzt angewendet wurde (sanitisiert): Vergleichsstand für die id-Auswahl. */
  private angewendet: WorldLayout | null = null;
  private readonly grabsteine: Grabsteine = new Map();

  constructor(private readonly d: LayoutWacheAbhaengigkeiten) {
    // Eine Quittung des vorigen Serverlaufs gilt für diesen nicht: Sie würde im Boot-Fenster
    // dem Betriebsdienst ein 200 für einen Stand liefern, den dieser Lauf nie angewendet hat.
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
    if (stand === this.letzterStand) return;
    // Speichern hat Vorrang: den Stand NICHT merken, damit der nächste Takt es erneut versucht.
    if (this.d.speichertGerade()) return;

    const t0 = performance.now();

    const bytes = readFileSync(this.d.pfad);
    const hash = layoutHash(bytes);
    this.letzterStand = stand;
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
    // B8 (T1 N1): Ein Sanitizer, der Punkte in `heightDeltas` still verwirft
    // (Tippfehler), darf hier nicht unbemerkt bleiben — sonst koennte ein
    // Schreibvorgang mit `heightDeltas`-Tippfehlern UND einer echten
    // Platzierungsaenderung als "angewendet" durchgehen, waehrend die
    // Korrektur lautlos verschwindet (der sanitisierte Stand saehe dann
    // zufaellig gleich aus wie zuvor, also KEINE Geo-Aenderung, und
    // `anwenden` liefe fuer den Objektteil normal durch). Dieselbe Regel wie
    // bei geklemmten Platzierungsfeldern: ein Vorgang gilt ganz oder gar
    // nicht.
    const hoehenFehler = hoehenkorrekturFehler((roh as { heightDeltas?: unknown } | null)?.heightDeltas);
    if (hoehenFehler.length > 0) {
      const detail = hoehenkorrekturFehlerText(hoehenFehler);
      console.warn(`[WoV] Layout-Wache: heightDeltas verworfen, nichts angewendet (${detail}) — nach der Korrektur greift der Abgleich`);
      this.quittiere(hash, 'nicht-angewendet', 'verworfen', null, detail);
      return;
    }
    const neuKanonisch = JSON.stringify(neuBericht.layout);
    if (neuKanonisch === this.kanonisch) {
      // Derselbe Inhalt (etwa neu formatiert oder der Stand des Boots): nichts anwenden.
      this.quittiere(hash, 'angewendet', null, null);
      return;
    }
    if (this.angewendet) {
      const teile = geoAenderung(this.angewendet, neuBericht.layout);
      if (teile.length > 0) {
        console.warn(`[WoV] Layout-Wache: Geo-Änderung (${teile.join(', ')}) — geschrieben, aber erst nach dem Neustart wirksam, nichts angewendet`);
        this.quittiere(hash, 'nicht-angewendet', 'geo', null, teile.join(', '));
        return;
      }
    }
    const ergebnis = this.d.anwenden(roh, { neu: neuBericht, alt: this.angewendet, grabsteine: this.grabsteine });
    if (ergebnis.art === 'abgelehnt') {
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, ergebnis.grund);
      return;
    }
    if (ergebnis.art === 'verworfen') {
      console.warn(`[WoV] Layout-Wache: Einträge verworfen, nichts angewendet (${ergebnis.detail}) — nach der Korrektur greift der Abgleich`);
      this.quittiere(hash, 'nicht-angewendet', 'verworfen', null, ergebnis.detail);
      return;
    }
    if (ergebnis.art === 'zuViele') {
      const detail = `${ergebnis.anzahl} Änderungen (Grenze ${AENDERUNGEN_MAX})`;
      console.warn(`[WoV] Layout-Wache: ${detail}, nichts angewendet — die Datei gilt ab dem nächsten Neustart`);
      this.quittiere(hash, 'nicht-angewendet', 'zu-viele-aenderungen', null, detail);
      return;
    }
    if (ergebnis.art === 'bestaetigung') {
      console.warn(`[WoV] Layout-Wache: Bestätigung nötig, nichts angewendet (${ergebnis.detail}) — die Datei bleibt; der nächste Neustart übernimmt sie`);
      this.quittiere(hash, 'nicht-angewendet', 'bestaetigung-noetig', null, ergebnis.detail);
      return;
    }
    this.d.uebernehmen(roh);
    this.kanonisch = neuKanonisch;
    this.angewendet = neuBericht.layout;
    console.log(`[WoV] Layout-Wache: angewendet in ${(performance.now() - t0).toFixed(1)} ms (ganzer Takt)`);
    this.quittiere(hash, 'angewendet', null, ergebnis.zaehler, ergebnis.detail);
  }

  private quittiere(
    hash: string,
    ergebnis: Quittung['ergebnis'],
    grund: Quittung['grund'],
    zaehler: Record<string, number> | null,
    detail?: string
  ): void {
    const q: Quittung = { hash, ergebnis, grund, ...(detail ? { detail } : {}), zaehler, zeit: new Date().toISOString() };
    try {
      quittungSchreiben(this.d.quittungsPfad, q);
    } catch (fehler) {
      console.error(`[WoV] Layout-Wache: Quittung nicht geschrieben: ${(fehler as Error).message}`);
    }
  }
}
