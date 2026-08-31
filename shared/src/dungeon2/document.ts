/**
 * Das Instanz-Dokument des Dungeon-Generators 2.0 — der Deskriptor, der ueber
 * die Leitung reist, damit die GEOMETRIE es nie muss.
 * The instance document of dungeon generator 2.0 — the descriptor that travels
 * the wire so the GEOMETRY never has to.
 *
 * Ein 2.0-Dokument traegt Typ-Kennung (`version >= 10`), Thema, Seeds,
 * Layout-Formatversion und die Pruefsumme des erwarteten Layouts. Bei
 * `modus: 'erzeugt'` fehlt das Layout — es entsteht auf beiden Seiten aus
 * `erzeugeLayout(thema, seeds)`, und die Pruefsumme ist der Zeuge dafuer, dass
 * beide Seiten dasselbe erzeugt haben. Bei `modus: 'gebaut'` steht das Layout
 * vollstaendig im Dokument (Handarbeit aus dem Editor).
 * A 2.0 document carries a type marker (`version >= 10`), theme, seeds, the
 * layout format version and the checksum of the expected layout. With
 * `modus: 'erzeugt'` the layout is absent — both sides derive it from
 * `erzeugeLayout(thema, seeds)`, and the checksum witnesses that both derived
 * the same thing. With `modus: 'gebaut'` the layout sits in the document.
 *
 * WARUM DER VERSIONSSPRUNG VON 2 AUF 10 (design/data-model.md §4.1): Damit
 * unterscheidet eine einzige Zahl beide Formate ohne Zusatzfeld, und ein
 * 2.0-Dokument kann nie versehentlich durch den Alt-Sanitizer laufen. Die
 * Weiche ist `istDokument2()` — sie sieht NUR auf `version`, nicht auf das
 * Vorhandensein irgendeines Feldes: Ein Altdokument mit einem zufaellig
 * gleichnamigen Feld darf nicht auf den neuen Weg rutschen.
 * WHY THE VERSION JUMP FROM 2 TO 10: one number tells the two formats apart
 * without an extra field, and a 2.0 document can never accidentally run through
 * the legacy sanitizer. The switch is `istDokument2()` — it looks ONLY at
 * `version`, never at the presence of some field.
 *
 * DIESE DATEI IMPORTIERT `dungeons.ts` NICHT. Der Altbestand zieht
 * `dungeonsData.json` und `eigeneDungeons.ts` hinter sich her (374 fremde
 * Raeume), und jeder Verwender des 2.0-Deskriptors — auch der Client-Bundle —
 * haette sie dann im Paket. Die eine Zeile, die dadurch doppelt steht, ist das
 * Kennungsmuster; `shared/test/dungeon2-dokument.ts` haelt beide Fassungen
 * zusammen, damit die Doppelung nicht auseinanderlaufen kann.
 * THIS FILE DOES NOT IMPORT `dungeons.ts`. The legacy module drags
 * `dungeonsData.json` and `eigeneDungeons.ts` along (374 foreign rooms), and
 * every consumer of the 2.0 descriptor — the client bundle included — would
 * carry them. The one line duplicated by that is the id pattern;
 * `shared/test/dungeon2-dokument.ts` holds both copies together.
 */

import { erzeugeLayout } from './generator.js';
import {
  LAYOUT_VERSION,
  layoutPruefsumme,
  migriere,
  nurFehler,
  validateLayout,
  type Befund,
  type DungeonLayout2,
  type LayoutSeeds,
} from './layout.js';
import { themaFinden } from './themen.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Konstanten / constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ab dieser Dokumentversion gilt das Format 2.0. Der Sprung von 2 auf 10 laesst
 * dem Altformat Luft fuer weitere Versionen, ohne je an die Weiche zu stossen.
 * From this document version on, format 2.0 applies. The jump from 2 to 10
 * leaves the legacy format room for further versions without ever reaching the
 * switch.
 */
export const DUNGEON_DOKUMENT_VERSION_2 = 10;

/**
 * Dasselbe Muster wie `isValidDungeonId()` in `shared/src/dungeons.ts` — die
 * Kennung wird zum Dateinamen, also darf sie keinen Pfad enthalten.
 * The same pattern as `isValidDungeonId()` in `shared/src/dungeons.ts` — the id
 * becomes a file name, so it must not contain a path.
 */
const ID_MUSTER = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/**
 * Obergrenze fuer den Namen. Der Name kommt aus dem Editor und damit vom
 * Client; ohne Grenze waere ein Megabyte-Name eine gueltige Datei.
 * Cap on the name. The name comes from the editor and therefore from the
 * client; without a cap a megabyte name would be a valid file.
 */
const MAX_NAME_LAENGE = 120;

export type DungeonModus2 = 'erzeugt' | 'gebaut';

// ─────────────────────────────────────────────────────────────────────────────
// 2. Der Typ / the type
// ─────────────────────────────────────────────────────────────────────────────

export interface DungeonDokument2 {
  /** `>= DUNGEON_DOKUMENT_VERSION_2`. Die Weiche. / The switch. */
  readonly version: number;
  readonly id: string;
  readonly name: string;
  /** 'erzeugt' = aus Thema+Seeds reproduzierbar, 'gebaut' = Handarbeit. */
  /** 'erzeugt' = reproducible from theme+seeds, 'gebaut' = hand work. */
  readonly modus: DungeonModus2;
  readonly thema: string;
  readonly seeds: LayoutSeeds;
  /**
   * Fehlt bei 'erzeugt' — dort reist der Seed statt der Daten.
   * Absent for 'erzeugt' — there the seed travels instead of the data.
   */
  readonly layout?: DungeonLayout2;
  /** Pruefsumme des erwarteten Layouts, auch bei 'erzeugt'. Der Zeuge. */
  /** Checksum of the expected layout, also for 'erzeugt'. The witness. */
  readonly pruefsumme: string;
  /**
   * Formatversion des Layouts, mit der dieses Dokument zuletzt stimmte.
   *
   * Unsere Instanzen sind PERSISTENT (WoC-Laeufe sind es nicht). Ohne dieses
   * Feld waere jeder Generator-Commit eine stille Datenmigration: Der Server
   * erzeugte aus denselben Seeds ein anderes Grab, die gespeicherten
   * Truhen-ZDOs saessen in Waenden, und niemand koennte hinterher sagen, ab
   * wann. Mit dem Feld ist die Abweichung eine Zahl, die man vergleichen kann.
   *
   * Format version of the layout this document last matched. Our instances are
   * PERSISTENT; without this field every generator commit would be a silent
   * data migration.
   */
  readonly layoutVersion: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Die Weiche / the switch
// ─────────────────────────────────────────────────────────────────────────────

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function istGanz(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && Number.isFinite(x);
}

/**
 * Gehoert dieses rohe Ding zum Format 2.0? Ausschliesslich an `version`
 * entschieden — s. Kopfkommentar.
 * Does this raw thing belong to format 2.0? Decided solely on `version`.
 */
export function istDokument2(roh: unknown): boolean {
  if (!istObjekt(roh)) return false;
  return istGanz(roh.version) && roh.version >= DUNGEON_DOKUMENT_VERSION_2;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Sanitizer
// ─────────────────────────────────────────────────────────────────────────────

function leseSeeds(roh: unknown): LayoutSeeds | null {
  if (!istObjekt(roh)) return null;
  if (!istGanz(roh.architektur) || !istGanz(roh.material) || !istGanz(roh.deko)) return null;
  return {
    architektur: roh.architektur >>> 0,
    material: roh.material >>> 0,
    deko: roh.deko >>> 0,
  };
}

/**
 * Ein untrautes 2.0-Dokument pruefen. Wirft nie; gibt `null` zurueck, wenn es
 * nicht zu retten ist (unbekanntes Thema, unbrauchbare Kennung, kaputte Seeds,
 * bei 'gebaut' ein Layout mit Fehlern).
 *
 * ANDERS ALS DER ALT-SANITIZER wird hier NICHTS stillschweigend verworfen: Der
 * Alt-Sanitizer liess unbekannte Raeume fallen und lieferte ein kleineres
 * Dokument zurueck. Ein Deskriptor hat nichts, was man einzeln fallen lassen
 * koennte — er stimmt oder er stimmt nicht.
 *
 * Validate an untrusted 2.0 document. Never throws; returns `null` when it is
 * beyond repair. UNLIKE THE LEGACY SANITIZER nothing is silently dropped: a
 * descriptor has no parts to drop — it is either right or it is not.
 */
export function sanitizeDungeonDokument2(roh: unknown): DungeonDokument2 | null {
  if (!istDokument2(roh)) return null;
  const o = roh as Record<string, unknown>;

  const id = typeof o.id === 'string' ? o.id.toLowerCase() : '';
  if (!ID_MUSTER.test(id)) return null;

  const thema = typeof o.thema === 'string' ? o.thema : '';
  if (themaFinden(thema) === undefined) return null;

  const seeds = leseSeeds(o.seeds);
  if (seeds === null) return null;

  const modus: DungeonModus2 = o.modus === 'gebaut' ? 'gebaut' : 'erzeugt';
  const name =
    typeof o.name === 'string' && o.name.trim().length > 0
      ? o.name.trim().slice(0, MAX_NAME_LAENGE)
      : id;

  // Die Layout-Formatversion darf NICHT aus der Datei uebernommen werden, wenn
  // sie in der Zukunft liegt: Ein Dokument, das ein neueres Format behauptet,
  // als dieser Build kennt, ist kein Dokument fuer diesen Build.
  // The layout format version must NOT be taken from the file when it lies in
  // the future: a document claiming a newer format than this build knows is not
  // a document for this build.
  const layoutVersion = istGanz(o.layoutVersion) ? o.layoutVersion : LAYOUT_VERSION;
  if (layoutVersion < 1 || layoutVersion > LAYOUT_VERSION) return null;

  if (modus === 'gebaut') {
    // `migriere()` ist der EINE Weg in ein Layout hinein — es prueft Format,
    // Version und Felder und zieht aeltere Fassungen nach.
    // `migriere()` is the ONE way into a layout — it checks format, version and
    // fields and pulls older versions forward.
    const layout = migriere(o.layout);
    if (layout === null) return null;
    if (nurFehler(validateLayout(layout)).length > 0) return null;
    return {
      version: DUNGEON_DOKUMENT_VERSION_2,
      id,
      name,
      modus,
      thema,
      seeds,
      layout,
      pruefsumme: layoutPruefsumme(layout),
      layoutVersion: layout.version,
    };
  }

  // 'erzeugt': Die Pruefsumme wird NICHT aus der Datei uebernommen, sondern
  // neu gerechnet. Sie ist ein Zeuge, kein Inhalt — stuende die Zahl aus der
  // Datei drin, koennte ein Dokument seine eigene Abweichung beglaubigen.
  // 'erzeugt': the checksum is NOT taken from the file but recomputed. It is a
  // witness, not content — taken from the file, a document could certify its
  // own drift.
  const layout = layoutErzeugen({ id, name, thema, seeds });
  if (layout === null) return null;

  return {
    version: DUNGEON_DOKUMENT_VERSION_2,
    id,
    name,
    modus,
    thema,
    seeds,
    pruefsumme: layoutPruefsumme(layout),
    layoutVersion: layout.version,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Vom Dokument zum Layout / from document to layout
// ─────────────────────────────────────────────────────────────────────────────

interface ErzeugungsSchluessel {
  readonly id: string;
  readonly name: string;
  readonly thema: string;
  readonly seeds: LayoutSeeds;
}

function layoutErzeugen(s: ErzeugungsSchluessel): DungeonLayout2 | null {
  const profil = themaFinden(s.thema);
  if (profil === undefined) return null;
  // `id` und `name` werden vorgegeben, damit die Layout-Kennung der
  // Dokumentkennung entspricht — sonst truege das Layout die aus dem Seed
  // hergeleitete Voreinstellung, und die Pruefsumme haenge an einem Namen,
  // den niemand gesetzt hat.
  // `id` and `name` are pinned so the layout id equals the document id —
  // otherwise the layout would carry the seed-derived default and the checksum
  // would hang on a name nobody set.
  return erzeugeLayout(profil, s.seeds, { id: s.id, name: s.name });
}

/**
 * Das Layout eines Dokuments — erzeugt oder mitgeliefert. DIE Stelle, an der
 * Server, Client und Editor dasselbe Layout bekommen.
 * The layout of a document — generated or shipped. THE place where server,
 * client and editor get the same layout.
 */
export function layoutVonDokument2(doc: DungeonDokument2): DungeonLayout2 | null {
  if (doc.modus === 'gebaut') return doc.layout ?? null;
  return layoutErzeugen(doc);
}

/**
 * Ein frisches erzeugtes Dokument. `null` bei unbekanntem Thema oder
 * unbrauchbarer Kennung — dieselben beiden Gruende wie im Sanitizer.
 * A fresh generated document. `null` on unknown theme or unusable id.
 */
export function erzeugeDokument2(
  id: string,
  name: string,
  thema: string,
  seeds: LayoutSeeds
): DungeonDokument2 | null {
  const kleinId = id.toLowerCase();
  if (!ID_MUSTER.test(kleinId)) return null;
  const layout = layoutErzeugen({ id: kleinId, name, thema, seeds });
  if (layout === null) return null;
  return {
    version: DUNGEON_DOKUMENT_VERSION_2,
    id: kleinId,
    name,
    modus: 'erzeugt',
    thema,
    seeds,
    pruefsumme: layoutPruefsumme(layout),
    layoutVersion: layout.version,
  };
}

/**
 * Pruefsumme des Dokuments OHNE seine Deko-Anker.
 *
 * Der Vergleich, an dem `upsertDokument2()` entscheidet, ob eine laufende
 * Instanz stehen bleiben darf. Anker sind das EINZIGE, was sich aendern darf,
 * ohne dass gebaute Geometrie betroffen ist — deshalb werden genau sie
 * herausgenommen und alles andere eingerechnet. Faellt spaeter ein neues Feld
 * ins Layout, ist es automatisch Teil dieses Vergleichs; ein von Hand
 * geschriebener Feldvergleich waere die Stelle, an der es still durchfaellt.
 *
 * Checksum of the document WITHOUT its decor anchors — the comparison
 * `upsertDokument2()` uses to decide whether a live instance may stay. Anchors
 * are the ONLY thing that may change without affecting built geometry.
 */
export function pruefsummeOhneAnker(doc: DungeonDokument2): string {
  const layout = layoutVonDokument2(doc);
  if (layout === null) return '';
  return layoutPruefsumme({ ...layout, anker: [] });
}

/**
 * Der Deskriptor, wie er ueber die Leitung reist: genau die Felder, aus denen
 * der Client sein Layout erzeugt, plus den Zeugen.
 * The descriptor as it travels the wire: exactly the fields the client derives
 * its layout from, plus the witness.
 */
export interface LayoutDeskriptor {
  readonly thema: string;
  readonly seeds: LayoutSeeds;
  readonly pruefsumme: string;
  readonly layoutVersion: number;
  readonly id: string;
  readonly name: string;
}

export function deskriptorVon(doc: DungeonDokument2): LayoutDeskriptor {
  return {
    thema: doc.thema,
    seeds: doc.seeds,
    pruefsumme: doc.pruefsumme,
    layoutVersion: doc.layoutVersion,
    id: doc.id,
    name: doc.name,
  };
}

/**
 * Aus dem empfangenen Deskriptor das Layout bauen und den Zeugen pruefen.
 *
 * Der Rueckgabewert nennt die Abweichung ausdruecklich, statt sie zu
 * verschlucken: Ein stiller Rueckfall waere die Bauform, bei der man ein Jahr
 * spaeter merkt, dass der Determinismus seit Monaten kaputt ist
 * (ARCHITECTURE.md §1.3).
 *
 * Build the layout from the received descriptor and check the witness. The
 * return value names the drift explicitly instead of swallowing it.
 */
export interface DeskriptorErgebnis {
  readonly layout: DungeonLayout2 | null;
  /** true = eigene Pruefsumme weicht von der des Servers ab. / checksum drift. */
  readonly abweichung: boolean;
  readonly erwartet: string;
  readonly gerechnet: string;
  readonly befunde: readonly Befund[];
}

export function layoutAusDeskriptor(d: LayoutDeskriptor): DeskriptorErgebnis {
  const layout = layoutErzeugen(d);
  if (layout === null) {
    return { layout: null, abweichung: true, erwartet: d.pruefsumme, gerechnet: '', befunde: [] };
  }
  const gerechnet = layoutPruefsumme(layout);
  return {
    layout,
    abweichung: gerechnet !== d.pruefsumme,
    erwartet: d.pruefsumme,
    gerechnet,
    befunde: nurFehler(validateLayout(layout)),
  };
}
