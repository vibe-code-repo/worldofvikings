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
/**
 * Die WEICHE: ab dieser Zahl ist ein Dokument ein 2.0-Dokument. Sie ist
 * eingefroren und darf nie steigen — sie trennt die beiden FORMATE, nicht die
 * Fassungen innerhalb von 2.0.
 * The SWITCH: from this number on a document is a 2.0 document. Frozen; it
 * separates the two FORMATS, not the revisions within 2.0.
 */
export const DOKUMENT_2_AB_VERSION = 10;

/**
 * Die Fassung, die dieser Build SCHREIBT.
 *
 *   10 — Grundform (AP13): Thema, Seeds, Pruefsumme, Layout-Formatversion.
 *   11 — `ambientLicht` (31.08.2026): Grundhelligkeit je Dokument, 0..1.
 *
 * Ein Dokument der Fassung 10 wird beim Lesen auf 11 gehoben, indem
 * `ambientLicht` WEGGELASSEN wird — Weglassen heisst „nimm die Vorgabe des
 * Themas", und die ist der heutige Wert. Die Migration ist damit
 * wertneutral: Kein bestehendes Grab aendert sein Bild, weil dieses Feld
 * dazugekommen ist. Genau deshalb ist das Feld OPTIONAL und nicht mit einer
 * Vorgabe belegt — ein hineingeschriebener Wert waere eine Behauptung ueber
 * einen Dungeon, die niemand aufgestellt hat, und beim naechsten Wechsel der
 * Themen-Vorgabe wuerde er sie stumm ueberstimmen.
 *
 * The revision this build WRITES. A revision-10 document is lifted to 11 by
 * OMITTING `ambientLicht` — omission means "take the theme's default", which
 * is today's value, so the migration is value-neutral. That is why the field
 * is optional rather than defaulted: a written-in value would be a claim
 * nobody made, and it would silently outvote a later change to the theme.
 */
export const DUNGEON_DOKUMENT_VERSION_2 = 11;

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
  /**
   * Grundhelligkeit dieser EINEN Instanz, 0..1 — ueberschreibt
   * `ThemenProfil.ambientLicht`. Ab Dokumentfassung 11.
   *
   * FEHLT das Feld, gilt das Thema. Das ist nicht dasselbe wie `1`: Wer
   * spaeter die Vorgabe des Themas senkt, will, dass die Graeber ohne eigene
   * Angabe mitgehen — und genau die erkennt man daran, dass hier nichts
   * steht.
   * Base brightness of this ONE instance, 0..1 — overrides the theme's value.
   * ABSENT means "use the theme", which is not the same as `1`.
   */
  readonly ambientLicht?: number;
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
  // Gegen `DOKUMENT_2_AB_VERSION`, NICHT gegen die geschriebene Fassung:
  // Sonst faellt jedes bereits gespeicherte 2.0-Dokument aus dem Format
  // heraus, sobald hier eine Fassung dazukommt — und zwar still, weil
  // `istDokument2() === false` „Altformat" bedeutet und der Alt-Sanitizer
  // dann „ungueltig" meldet, wo „aeltere Fassung" gemeint ist.
  // Against the FORMAT threshold, NOT the written revision: otherwise every
  // stored 2.0 document would silently drop out of the format the moment a
  // revision is added here.
  return istGanz(roh.version) && roh.version >= DOKUMENT_2_AB_VERSION;
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
 * `ambientLicht` aus einem rohen Dokument lesen — oder `undefined`, wenn es
 * fehlt bzw. unbrauchbar ist.
 *
 * Ein KAPUTTER Wert (Text, NaN, -3, 17) macht das Dokument NICHT ungueltig,
 * er faellt auf „nicht gesetzt" zurueck. Der Grund ist die Asymmetrie der
 * Folgen: Ein Grab, das wegen einer verrutschten Helligkeitszahl gar nicht
 * mehr laedt, ist ein verlorener Spielstand; eines, das die Vorgabe des
 * Themas nimmt, ist ein Grab mit der Helligkeit von gestern. Ausserhalb von
 * 0..1 wird deshalb geklemmt und nicht abgelehnt — 1,2 heisst „so hell wie
 * moeglich", nicht „Datei kaputt".
 *
 * Read `ambientLicht` from a raw document, or `undefined` when absent or
 * unusable. A BROKEN value does not invalidate the document, it falls back to
 * "not set": a barrow that no longer loads because of a slipped brightness
 * number is a lost save; one that takes the theme's default is a barrow with
 * yesterday's brightness. Out-of-range values are clamped, not rejected.
 */
function leseAmbientLicht(roh: unknown): number | undefined {
  if (typeof roh !== 'number' || !Number.isFinite(roh)) return undefined;
  return Math.min(1, Math.max(0, roh));
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

  // Die Anhebung von Fassung 10 auf 11 IST diese eine Zeile: Ein altes
  // Dokument hat `ambientLicht` nicht, `leseAmbientLicht` liefert `undefined`,
  // und `undefined` heisst „nimm das Thema". Die Fassung wird unten auf
  // `DUNGEON_DOKUMENT_VERSION_2` gehoben — das Dokument ist danach eines von
  // heute, ohne dass sich an ihm irgendetwas geaendert haette.
  // The lift from revision 10 to 11 IS this one line.
  const ambientLicht = leseAmbientLicht(o.ambientLicht);
  const ambientFeld = ambientLicht === undefined ? {} : { ambientLicht };

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
      ...ambientFeld,
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
    ...ambientFeld,
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
  seeds: LayoutSeeds,
  /**
   * Grundhelligkeit dieser Instanz (0..1). Weggelassen = Vorgabe des Themas
   * — und Weglassen ist der Normalfall, nicht ein Versaeumnis.
   * Base brightness (0..1). Omitted = the theme's default, which is the
   * normal case, not an oversight.
   */
  ambientLicht?: number
): DungeonDokument2 | null {
  const kleinId = id.toLowerCase();
  if (!ID_MUSTER.test(kleinId)) return null;
  const layout = layoutErzeugen({ id: kleinId, name, thema, seeds });
  if (layout === null) return null;
  const ambient = leseAmbientLicht(ambientLicht);
  return {
    version: DUNGEON_DOKUMENT_VERSION_2,
    id: kleinId,
    name,
    modus: 'erzeugt',
    thema,
    seeds,
    pruefsumme: layoutPruefsumme(layout),
    layoutVersion: layout.version,
    ...(ambient === undefined ? {} : { ambientLicht: ambient }),
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
  /**
   * Die AUFGELOESTE Grundhelligkeit (0..1) — Dokument schlaegt Thema.
   *
   * Aufgeloest und nicht optional: Der Client haette sonst zwei Faelle zu
   * unterscheiden ("Feld fehlt" vs. "Wert 0"), und der eine davon ist genau
   * der neue Feature-Fall (stockdunkel). Die Aufloesung gehoert dorthin, wo
   * beide Quellen bekannt sind — auf den Server.
   * The RESOLVED base brightness (0..1) — document beats theme. Resolved and
   * not optional: the client would otherwise have to tell "field missing"
   * from "value 0", and the latter is exactly the new feature case.
   */
  readonly ambientLicht: number;
}

/**
 * Die Aufloesung selbst — EINE Stelle, damit "Dokument schlaegt Thema" nicht
 * an drei Orten unabhaengig hingeschrieben steht.
 * The resolution itself — ONE place, so "document beats theme" is not written
 * down independently in three.
 */
export function ambientLichtVon(doc: DungeonDokument2): number {
  if (doc.ambientLicht !== undefined) return doc.ambientLicht;
  return themaFinden(doc.thema)?.ambientLicht ?? 1;
}

export function deskriptorVon(doc: DungeonDokument2): LayoutDeskriptor {
  return {
    thema: doc.thema,
    seeds: doc.seeds,
    pruefsumme: doc.pruefsumme,
    layoutVersion: doc.layoutVersion,
    id: doc.id,
    name: doc.name,
    ambientLicht: ambientLichtVon(doc),
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
  return zeugePruefen(layout, d.pruefsumme);
}

/**
 * Wie `layoutAusDeskriptor`, aber aus einem MITGELIEFERTEN Layout (rohes,
 * ueber die Leitung gereistes Objekt) statt aus den Seeds erzeugt.
 *
 * Warum es das gibt: Ein handgebautes Grab (`modus === 'gebaut'`) laesst sich
 * aus seinen Seeds NICHT wiederherstellen — die Stempel, Korrekturen, Tueren
 * und Anker der Handarbeit stehen nur im Dokument, nicht im Generator. Fuer
 * diese Graeber MUSS die Geometrie mitreisen; `layoutAusDeskriptor` (Seeds ->
 * Layout) baut zwangslaeufig das URSPRUENGLICHE Grab und wirft jede Handarbeit
 * weg. Das war der Fehler „nachtraeglich gesetzte Raeume fehlen im Spiel"
 * (Befund 01.09.2026).
 *
 * `roh` geht durch `migriere()` — denselben EINEN Weg in ein Layout hinein wie
 * der Sanitizer (Format, Version, Felder). Ist es unbrauchbar, wird `null`
 * gemeldet: Der Aufrufer bricht dann LAUT ab, statt still auf das falsche
 * Seed-Grab zurueckzufallen.
 *
 * Like `layoutAusDeskriptor`, but from a SHIPPED layout (raw object that
 * travelled the wire) instead of generated from the seeds. A hand-built grave
 * cannot be reconstructed from its seeds — the hand-made stamps, fixes, doors
 * and anchors live only in the document. For those graves the geometry MUST
 * travel; regenerating from seeds throws every edit away. `roh` goes through
 * `migriere()`, the same one way into a layout as the sanitizer.
 */
export function layoutAusMitgeliefert(roh: unknown, pruefsumme: string): DeskriptorErgebnis {
  const layout = migriere(roh);
  if (layout === null) {
    return { layout: null, abweichung: true, erwartet: pruefsumme, gerechnet: '', befunde: [] };
  }
  return zeugePruefen(layout, pruefsumme);
}

function zeugePruefen(layout: DungeonLayout2, pruefsumme: string): DeskriptorErgebnis {
  const gerechnet = layoutPruefsumme(layout);
  return {
    layout,
    abweichung: gerechnet !== pruefsumme,
    erwartet: pruefsumme,
    gerechnet,
    befunde: nurFehler(validateLayout(layout)),
  };
}
