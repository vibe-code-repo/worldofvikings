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
 * Live ist nur, was ein ZDO ist (Platzierungen samt NPC-Daten). Jede
 * Änderung, die die Geo berührt (Regionen, Kontinente, Wasser, `detailSeed`,
 * Spawn, Routen, `einebnen`), wird NICHT angewendet und mit `geo` quittiert:
 * ein Vorgang gilt ganz oder gar nicht (kein halber Stand aus neuen Objekten
 * auf altem Boden). `einebnen` live folgt in K5.9.
 *
 * ── Schutz ───────────────────────────────────────────────────────────
 * Die Schutzrückgaben des Boots gelten unverändert (`placements` unlesbar,
 * alle Einträge verworfen): Ein Tippfehler in der Datei löscht nichts, die
 * Quittung meldet `abgelehnt`. Solange ein Speichern läuft, wird nichts
 * angewendet; die Wache probiert es eine Sekunde später erneut.
 *
 * ── Quittung ─────────────────────────────────────────────────────────
 * Nach jedem gesehenen Stand schreibt die Wache die Quittung
 * (`shared/worldlayout/quittung.ts`). Der Spielserver schreibt nie ins
 * Weltdokument.
 */
import { statSync, readFileSync } from 'node:fs';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { sanitizeWorldLayoutMitBericht } from '@wov/shared/src/worldlayout/sanitize.js';
import { quittungSchreiben, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';

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
  | { art: 'angewendet'; zaehler: Record<string, number> }
  | { art: 'abgelehnt'; grund: string };

export interface LayoutWacheAbhaengigkeiten {
  /** Die Weltdatei dieser Instanz. */
  readonly pfad: string;
  readonly quittungsPfad: string;
  /** Das Dokument, das der Server gerade in Gebrauch hat (roh). */
  readonly aktuell: () => unknown;
  /** Läuft ein Speichern? Dann nicht anwenden. */
  readonly speichertGerade: () => boolean;
  /** Den Objektteil des neuen Dokuments anwenden (mit den Schutzrückgaben des Boots). */
  readonly anwenden: (roh: unknown) => Anwendung;
  /** Das Dokument des Servers tauschen und den Clients der Hauptwelt schicken. */
  readonly uebernehmen: (roh: unknown) => void;
}

export class LayoutWache {
  private letzterStand = '';
  /** Kanonische Darstellung des Standes, den der Server hat: gleicher Inhalt ⇒ nichts zu tun. */
  private kanonisch: string | null = null;

  constructor(private readonly d: LayoutWacheAbhaengigkeiten) {}

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

    const bytes = readFileSync(this.d.pfad);
    const hash = layoutHash(bytes);
    this.letzterStand = stand;
    if (this.kanonisch === null) this.kanonisch = this.kanonischVon(this.d.aktuell());

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
    if (neuKanonisch === this.kanonisch) {
      // Derselbe Inhalt (etwa neu formatiert oder der Stand des Boots): nichts anwenden.
      this.quittiere(hash, 'angewendet', null, null);
      return;
    }
    const altBericht = sanitizeWorldLayoutMitBericht(this.d.aktuell());
    if (altBericht) {
      const teile = geoAenderung(altBericht.layout, neuBericht.layout);
      if (teile.length > 0) {
        console.warn(`[WoV] Layout-Wache: Geo-Änderung (${teile.join(', ')}) — geschrieben, aber erst nach dem Neustart wirksam, nichts angewendet`);
        this.quittiere(hash, 'nicht-angewendet', 'geo', null, teile.join(', '));
        return;
      }
    }
    const t0 = performance.now();
    const ergebnis = this.d.anwenden(roh);
    if (ergebnis.art === 'abgelehnt') {
      this.quittiere(hash, 'nicht-angewendet', 'abgelehnt', null, ergebnis.grund);
      return;
    }
    this.d.uebernehmen(roh);
    this.kanonisch = neuKanonisch;
    console.log(`[WoV] Layout-Wache: angewendet in ${(performance.now() - t0).toFixed(1)} ms`);
    this.quittiere(hash, 'angewendet', null, ergebnis.zaehler);
  }

  private kanonischVon(roh: unknown): string | null {
    const b = sanitizeWorldLayoutMitBericht(roh);
    return b ? JSON.stringify(b.layout) : null;
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
