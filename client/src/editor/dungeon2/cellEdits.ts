/**
 * AP15.4/15.5 — die REINEN Mutationen der Zellwerkzeuge: Boden heben/senken,
 * Wandflag umschalten, Materialtag-Pinsel, Raum-Stempel setzen/entfernen. Kein
 * DOM: Jede Funktion nimmt ein `DungeonDokument2` und gibt ein NEUES zurück,
 * damit der Wächter die Mutation prüft, nicht das Zeichnen.
 * AP15.4/15.5 — the PURE mutations of the cell tools: raise/lower floor, toggle
 * wall flag, material-tag brush, place/remove room stamp. No DOM: every
 * function takes a `DungeonDokument2` and returns a NEW one, so the guard
 * checks the mutation, not the drawing.
 *
 * ── DAS "GEBAUT-KIPPEN" (die zentrale Regel dieses Moduls) ──────────────────
 * Ein Dokument mit `modus: 'erzeugt'` trägt KEIN Layout — nur Thema und Seeds
 * reisen, und beide Seiten leiten das Layout aus `layoutVonDokument2()` ab
 * (Beleg: `shared/src/dungeon2/document.ts`, `sanitizeDungeonDokument2` Zweig
 * "'erzeugt'" rechnet das Layout aus den Seeds NEU und ignoriert `o.layout`;
 * `layoutVonDokument2` Z.359-362 gibt bei 'erzeugt' das erzeugte, bei 'gebaut'
 * das mitgelieferte Layout). Schriebe ein Werkzeug eine Handkorrektur in ein
 * 'erzeugt'-Dokument, hätte das Dokument nirgends ein Feld dafür — der nächste
 * Aufbau aus den Seeds verschluckte sie spurlos. Auch der Server verwirft sie:
 * Der Sanitizer nimmt bei 'erzeugt' kein Layout entgegen.
 *
 * DIE KUNDSCHAFTUNG ("kippt nur bei Änderung des architektur-Seeds") IST FALSCH:
 * Es gibt im Code KEINEN seed-getriggerten Moduswechsel. `sanitizeDungeonDokument2`
 * entscheidet den Modus allein an `o.modus`; der einzige seedbezogene Vergleich
 * ist `pruefsummeOhneAnker()` im Server (`DungeonManager.upsertDokument2` Z.406-409),
 * und der entscheidet nur, ob eine LAUFENDE INSTANZ stehen bleiben darf — nicht
 * über den Modus. Deshalb implementiert dieses Modul das SICHERE Verhalten:
 * JEDER Handeingriff ruft `sicherstellenGebaut()`, das ein 'erzeugt'-Dokument
 * einmalig auf 'gebaut' mit vollem Layout kippt, bevor irgendetwas geschrieben
 * wird.
 *
 * THE "FLIP TO BUILT": a `modus: 'erzeugt'` document carries NO layout — only
 * theme and seeds travel. Writing a hand fix into such a document would have
 * nowhere to store it and the next rebuild from seeds would swallow it; the
 * server discards it too. The intel report ("flips only when the architecture
 * seed changes") is WRONG: there is NO seed-triggered mode switch in the code.
 * So this module implements the SAFE behaviour: every hand edit calls
 * `sicherstellenGebaut()`, which flips an 'erzeugt' document to 'gebaut' with a
 * full layout once, before anything is written.
 *
 * Handkorrekturen werden als `ZellenKorrektur` abgelegt (data-model.md §1.4:
 * "Wird NACH allen Stempeln aufgetragen"). Mehrere Eingriffe an derselben Zelle
 * werden zu EINER Korrektur verschmolzen (`korrekturMischen`), damit die
 * Korrekturliste nicht mit jedem Pinselstrich wächst und die Reihenfolge zweier
 * Korrekturen an derselben Zelle nie mehrdeutig wird.
 * Hand fixes are stored as `ZellenKorrektur`. Several edits on the same cell are
 * merged into ONE fix, so the fix list does not grow with every brush stroke.
 */

import { dungeon2 } from '@wov/shared';

type DungeonDokument2 = dungeon2.DungeonDokument2;
type DungeonLayout2 = dungeon2.DungeonLayout2;
type ZellenKorrektur = dungeon2.ZellenKorrektur;
type ZellenAenderung = dungeon2.ZellenAenderung;
type RaumStempel = dungeon2.RaumStempel;
type RaumTyp = dungeon2.RaumTyp;
type Kante = dungeon2.Kante;

const ZELLEN_ART = dungeon2.ZELLEN_ART;
const MAX_MATERIAL_TAG = dungeon2.MAX_MATERIAL_TAG;
const EBENE_M = dungeon2.EBENE_M;
const HOEHEN_SCHRITT_M = dungeon2.HOEHEN_SCHRITT_M;

/**
 * Höchste Bodenhöhe in Hoehenstufen, die ein Handeingriff setzen darf: eine
 * volle Ebene hoch. `EBENE_M / HOEHEN_SCHRITT_M` = 16 (mit den eingefrorenen
 * Konstanten), eine Ganzzahl — der Boden bleibt damit im Ebenenband.
 * Highest floor height in height steps a hand edit may set: one full storey.
 */
export const BODEN_MAX_STUFEN = Math.round(EBENE_M / HOEHEN_SCHRITT_M);
export const BODEN_MIN_STUFEN = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis-Typ / result type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ergebnis eines Eingriffs. `geaendert` speist das `schmutzig`-Flag des Editors
 * (Muster aus `DungeonKatalog`): Nur wo sich wirklich etwas geändert hat, wird
 * die Speichern-Marke gesetzt.
 * Result of an edit. `geaendert` feeds the editor's `schmutzig` flag: only a
 * real change sets the save marker.
 */
export interface EingriffErgebnis {
  readonly dokument: DungeonDokument2;
  readonly geaendert: boolean;
  /** true, wenn dieser Eingriff das Dokument von 'erzeugt' auf 'gebaut' kippte. */
  /** true if this edit flipped the document from 'erzeugt' to 'built'. */
  readonly gekippt: boolean;
}

interface GebautStand {
  readonly doc: DungeonDokument2;
  readonly layout: DungeonLayout2;
  readonly gekippt: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Das Gebaut-Kippen / the flip to built
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sorgt dafür, dass das Dokument ein vollständiges Layout trägt und
 * `modus: 'gebaut'` ist. Ein bereits gebautes Dokument kommt unverändert
 * zurück (`gekippt: false`); ein 'erzeugt'-Dokument wird einmalig materialisiert.
 * `null`, wenn sich kein Layout ableiten lässt (unbekanntes Thema) — dann darf
 * kein Werkzeug schreiben.
 * Ensures the document carries a full layout and `modus: 'gebaut'`. An already
 * built document returns unchanged (`gekippt: false`); an 'erzeugt' document is
 * materialised once. `null` when no layout can be derived (unknown theme).
 */
export function sicherstellenGebaut(doc: DungeonDokument2): GebautStand | null {
  if (doc.modus === 'gebaut' && doc.layout !== undefined) {
    return { doc, layout: doc.layout, gekippt: false };
  }
  const layout = dungeon2.layoutVonDokument2(doc);
  if (layout === null) return null;
  return { doc: mitLayout(doc, layout), layout, gekippt: true };
}

/**
 * Dokument mit neuem Layout, frischer Prüfsumme und `modus: 'gebaut'`. Die EINE
 * Stelle, an der ein bearbeitetes Layout ins Dokument zurückgeschrieben wird —
 * `mitPruefsumme` ist laut `layout.ts` der einzige Ort, an dem `pruefsumme`
 * gesetzt werden soll.
 * Document with a new layout, fresh checksum and `modus: 'built'`. The ONE place
 * an edited layout is written back.
 */
function mitLayout(doc: DungeonDokument2, layout: DungeonLayout2): DungeonDokument2 {
  const l = dungeon2.mitPruefsumme(layout);
  return {
    ...doc,
    modus: 'gebaut',
    layout: l,
    pruefsumme: l.pruefsumme,
    layoutVersion: l.version,
  };
}

/** Kein-Eingriff-Ergebnis (nichts geändert). / No-op result. */
function unveraendert(doc: DungeonDokument2): EingriffErgebnis {
  return { dokument: doc, geaendert: false, gekippt: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Korrekturen verschmelzen / merging fixes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ersetzt oder ergänzt die Korrektur an (x,z,ebene). Vorhandene Feldwerte einer
 * Korrektur an derselben Zelle bleiben erhalten und werden von den neuen
 * Feldern überschrieben — so trägt eine Zelle nach zehn Pinselstrichen genau
 * EINE Korrektur mit dem letzten Stand jedes Feldes, statt zehn Einträge.
 * Replaces or extends the fix at (x,z,ebene). Existing field values of a fix on
 * the same cell survive and are overwritten by the new fields — one cell carries
 * exactly ONE fix with the latest value per field, not ten entries.
 */
function korrekturMischen(
  korrekturen: readonly ZellenKorrektur[],
  x: number,
  z: number,
  ebene: number,
  aendere: ZellenAenderung
): ZellenKorrektur[] {
  const rest: ZellenKorrektur[] = [];
  let vorhanden: ZellenKorrektur | undefined;
  for (const k of korrekturen) {
    if (k.x === x && k.z === z && k.ebene === ebene) vorhanden = k;
    else rest.push(k);
  }
  const gemischt: ZellenKorrektur = {
    x,
    z,
    ebene,
    aendere: { ...(vorhanden?.aendere ?? {}), ...aendere },
  };
  return [...rest, gemischt];
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Boden heben/senken / raise & lower floor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rastet eine Hoehenstufe: aktuellen Wert + Delta, geklemmt auf [min,max].
 * Rein und einzeln getestet, weil hier der Unterschied zwischen "eine Stufe"
 * und "0,5 Meter" sitzt — der Editor rechnet in STUFEN (Ganzzahlen), Meter
 * entstehen erst im Bauer (Grundsatz §3.1 aus `layout.ts`).
 * Snaps a height step: current + delta, clamped to [min,max]. Pure and tested
 * on its own, because this is where "one step" vs "0.5 metres" lives — the
 * editor counts in STEPS (integers).
 */
export function rasteStufe(aktuell: number, delta: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(aktuell) + Math.round(delta)));
}

/**
 * Hebt (delta>0) oder senkt (delta<0) den Boden EINER begehbaren Zelle um
 * `delta` Stufen. Auf Fels (Leer) oder einer nicht vorhandenen Zelle passiert
 * nichts — man kann keinen Boden anheben, wo keiner ist. Kein Effekt (Wert am
 * Anschlag) liefert `geaendert: false` und kippt das Dokument NICHT.
 * Raises (delta>0) or lowers (delta<0) the floor of ONE walkable cell by `delta`
 * steps. Nothing happens on rock or an absent cell. No effect (value at the
 * limit) returns `geaendert: false` and does NOT flip the document.
 */
export function bodenSetzen(
  doc: DungeonDokument2,
  x: number,
  z: number,
  ebene: number,
  delta: number
): EingriffErgebnis {
  const stand = sicherstellenGebaut(doc);
  if (stand === null) return unveraendert(doc);
  const gitter = dungeon2.zellenAufbauen(stand.layout);
  const zelle = dungeon2.zelleImGitter(gitter, x, z, ebene);
  if (zelle === undefined || !dungeon2.offen(zelle.art)) return unveraendert(doc);

  const neuBoden = rasteStufe(zelle.boden, delta, BODEN_MIN_STUFEN, BODEN_MAX_STUFEN);
  if (neuBoden === zelle.boden) return unveraendert(doc);

  const korrekturen = korrekturMischen(stand.layout.korrekturen, x, z, ebene, { boden: neuBoden });
  return schreibe(stand, { ...stand.layout, korrekturen });
}

// ─────────────────────────────────────────────────────────────────────────────
// (b) Wandflag umschalten / toggle wall flag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schaltet die ERZWUNGENE Wand an einer Zellkante um. Der Kern der Symmetrie:
 * Jede Wand wird an EINER kanonischen Stelle gespeichert — der Nord- bzw.
 * Ost-Kante einer Zelle (`kanonisiereKante` aus `layout.ts`). Die Westkante von
 * (x,z) und die Ostkante von (x-1,z) meinen dieselbe Wand und landen deshalb im
 * selben Bit derselben Zelle. Dadurch ist das Umschalten von beiden Seiten
 * derselbe Schalter (zweimal = zurück), und `wandZwischen()` — das die Flags
 * beider Nachbarn ODER-verknüpft — zeigt die Wand konsistent aus jeder
 * Richtung.
 * Toggles the FORCED wall on a cell edge. The core of symmetry: every wall is
 * stored at ONE canonical place — the north/east edge of a cell. The west edge
 * of (x,z) and the east edge of (x-1,z) mean the same wall and land in the same
 * bit of the same cell. Toggling from either side is therefore the same switch
 * (twice = back), and `wandZwischen()` shows the wall consistently from any
 * direction.
 */
export function wandUmschalten(
  doc: DungeonDokument2,
  x: number,
  z: number,
  ebene: number,
  kante: Kante
): EingriffErgebnis {
  const stand = sicherstellenGebaut(doc);
  if (stand === null) return unveraendert(doc);

  const k = dungeon2.kanonisiereKante(x, z, ebene, kante);
  const gitter = dungeon2.zellenAufbauen(stand.layout);
  const basis = dungeon2.zelleOderLeer(gitter, k.x, k.z, k.ebene);
  const neuFlag = basis.wandErzwungen ^ k.kante;

  const korrekturen = korrekturMischen(stand.layout.korrekturen, k.x, k.z, k.ebene, {
    wandErzwungen: neuFlag,
  });
  return schreibe(stand, { ...stand.layout, korrekturen });
}

// ─────────────────────────────────────────────────────────────────────────────
// (c) Materialtag-Pinsel / material-tag brush
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ist ein Zellversatz (dx,dz) innerhalb eines Kreispinsels mit Radius `radius`
 * (in Zellen)? Euklidisch gemessen wie beim Terrain-Biom-Pinsel — ein
 * quadratischer Pinsel würde die Ecken mitnehmen und sähe „eckig" aus.
 * Is a cell offset (dx,dz) within a circular brush of radius `radius` (in
 * cells)? Euclidean like the terrain biome brush.
 */
export function imPinsel(dx: number, dz: number, radius: number): boolean {
  return dx * dx + dz * dz <= radius * radius;
}

/**
 * Setzt den Materialtag aller begehbaren Zellen im Kreispinsel um (mittelX,
 * mittelZ) auf `tag` (geklemmt 0..MAX_MATERIAL_TAG). Fels wird nicht bemalt
 * (Material auf Fels wäre unsichtbar und ARCHITECTURE-widrig). Ändert der
 * Pinsel keine einzige Zelle, kippt er das Dokument nicht.
 * Sets the material tag of all walkable cells in the circular brush around
 * (mittelX, mittelZ) to `tag` (clamped 0..MAX_MATERIAL_TAG). Rock is not
 * painted. If the brush changes no cell, it does not flip the document.
 */
export function materialPinsel(
  doc: DungeonDokument2,
  mittelX: number,
  mittelZ: number,
  ebene: number,
  tag: number,
  radius: number
): EingriffErgebnis {
  const stand = sicherstellenGebaut(doc);
  if (stand === null) return unveraendert(doc);

  const sauberTag = Math.max(0, Math.min(MAX_MATERIAL_TAG, Math.round(tag)));
  const gitter = dungeon2.zellenAufbauen(stand.layout);
  let korrekturen = stand.layout.korrekturen;
  let etwas = false;
  const r = Math.max(0, Math.floor(radius));

  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (!imPinsel(dx, dz, radius)) continue;
      const x = mittelX + dx;
      const z = mittelZ + dz;
      const zelle = dungeon2.zelleImGitter(gitter, x, z, ebene);
      if (zelle === undefined || !dungeon2.offen(zelle.art)) continue;
      if (zelle.materialTag === sauberTag) continue;
      korrekturen = korrekturMischen(korrekturen, x, z, ebene, { materialTag: sauberTag });
      etwas = true;
    }
  }
  if (!etwas) return unveraendert(doc);
  return schreibe(stand, { ...stand.layout, korrekturen });
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemeinsamer Rückschreibpfad / shared write-back path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schreibt ein bearbeitetes Layout ins (ggf. gekippte) Dokument zurück und
 * meldet das Ergebnis. `gekippt` wird durchgereicht, damit der Aufrufer eine
 * Meldung "als eigenständiges Grab übernommen" zeigen kann.
 * Writes an edited layout back into the (possibly flipped) document.
 */
function schreibe(stand: GebautStand, layout: DungeonLayout2): EingriffErgebnis {
  return { dokument: mitLayout(stand.doc, layout), geaendert: true, gekippt: stand.gekippt };
}

// ─────────────────────────────────────────────────────────────────────────────
// (d) Raum-Stempel setzen/entfernen / place & remove room stamps (AP15.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eine Palettenvorlage: die Felder, die der Mensch wählt. Id, Ordnung und Seed
 * vergibt `stempelSetzen` erst beim Setzen — sie hängen am Dokument, nicht an
 * der Vorlage.
 * A palette template: the fields a human chooses. Id, order and seed are
 * assigned by `stempelSetzen` at placement time.
 */
export interface StempelVorlage {
  readonly typ: RaumTyp;
  readonly breite: number;
  readonly tiefe: number;
  /** Deckenhöhe über dem Raumboden, in Hoehenstufen. / Ceiling height in steps. */
  readonly hoehe: number;
  /** Anhebung des Raumbodens gegen die Ebene, in Hoehenstufen. / Floor offset. */
  readonly bodenVersatz: number;
}

/** Nächste freie Stempel-Id (stabil, wird nie neu vergeben). / Next free stamp id. */
function naechsteId(layout: DungeonLayout2): number {
  let max = 0;
  for (const s of layout.stempel) if (s.id > max) max = s.id;
  return max + 1;
}

/** Nächste Auftragsreihenfolge (später = überschreibt früher). / Next stamp order. */
function naechsteOrdnung(layout: DungeonLayout2): number {
  let max = -1;
  for (const s of layout.stempel) if (s.ordnung > max) max = s.ordnung;
  return max + 1;
}

/**
 * Setzt einen Stempel aus einer Vorlage an die Ankerzelle (x,z,ebene) mit
 * `drehung` Vierteldrehungen. Der Stempel wird an `layout.stempel` angehängt;
 * das Zellergebnis entsteht anschließend rein aus `zellenAufbauen()` — "nach
 * Setzen bleibt reines Zellenergebnis" (AP15.5). Der Seed wird deterministisch
 * aus dem Architektur-Seed und der Id abgeleitet, damit zwei gleiche Vorlagen
 * an derselben Stelle NICHT dieselbe Variation zeigen und der Wert reproduzier-
 * bar ist (kein `Math.random`).
 * Places a stamp from a template at the anchor cell with `drehung` quarter turns.
 * The stamp is appended to `layout.stempel`; the cell result then comes purely
 * from `zellenAufbauen()`. The seed is derived deterministically.
 */
export function stempelSetzen(
  doc: DungeonDokument2,
  vorlage: StempelVorlage,
  x: number,
  z: number,
  ebene: number,
  drehung: 0 | 1 | 2 | 3
): { ergebnis: EingriffErgebnis; id: number } {
  const stand = sicherstellenGebaut(doc);
  if (stand === null) return { ergebnis: unveraendert(doc), id: -1 };

  const id = naechsteId(stand.layout);
  const neu: RaumStempel = {
    id,
    typ: vorlage.typ,
    x,
    z,
    ebene,
    breite: vorlage.breite,
    tiefe: vorlage.tiefe,
    hoehe: vorlage.hoehe,
    bodenVersatz: vorlage.bodenVersatz,
    drehung,
    seed: (stand.layout.seeds.architektur ^ (id * 0x9e3779b1)) >>> 0,
    variante: 0,
    ordnung: naechsteOrdnung(stand.layout),
    // Handgesetzt: keine Tiefe im Wachstumsbaum. / Hand-placed: no tree depth.
    tiefeImBaum: 0,
  };
  const layout = { ...stand.layout, stempel: [...stand.layout.stempel, neu] };
  return { ergebnis: schreibe(stand, layout), id };
}

/**
 * Entfernt einen Stempel (und die an ihm hängenden Deko-Anker) aus dem Layout.
 *
 * ANDERS als das billige `cells.stempelEntfernen` (das nur das ausgerollte
 * Gitter anfasst und überlappte Vorgänger-Stempel NICHT zurückholt, siehe
 * dessen Kommentar / decisions-log AP2-2) arbeitet diese Funktion auf dem
 * DOKUMENT: Nach dem Streichen baut `zellenAufbauen()` das Gitter vollständig
 * neu, und ein Raum, der unter dem entfernten lag, kommt korrekt zurück.
 * Removes a stamp (and its decor anchors) from the layout. UNLIKE the cheap
 * `cells.stempelEntfernen` (grid only, does not restore overlapped predecessors)
 * this works on the DOCUMENT, so a full rebuild restores what lay underneath.
 */
export function stempelEntfernen(doc: DungeonDokument2, id: number): EingriffErgebnis {
  const stand = sicherstellenGebaut(doc);
  if (stand === null) return unveraendert(doc);
  if (!stand.layout.stempel.some((s) => s.id === id)) return unveraendert(doc);

  const stempel = stand.layout.stempel.filter((s) => s.id !== id);
  const anker = stand.layout.anker.filter((a) => a.stempelId !== id);
  return schreibe(stand, { ...stand.layout, stempel, anker });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vorlagen der Palette / palette templates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vordefinierte Raum-Stempel für die Palette. Maße in ZELLEN (Fußabdruck) und
 * HOEHENSTUFEN (Höhe/Versatz). Die Auswahl deckt die Raumtypen aus `layout.ts`
 * (`RAUM_TYPEN`) ab; die Größen sind bewusst rund (gerade Zellzahlen), damit
 * ein Gang mittig an eine Kammer stößt.
 * Predefined room stamps for the palette. Footprint in CELLS, height/offset in
 * HEIGHT STEPS. Covers the room types from `layout.ts`.
 */
export const STEMPEL_VORLAGEN: readonly (StempelVorlage & { readonly name: string })[] = [
  { name: 'Eingang 4×4', typ: 'eingang', breite: 4, tiefe: 4, hoehe: 12, bodenVersatz: 0 },
  { name: 'Gang 2×6', typ: 'gang', breite: 2, tiefe: 6, hoehe: 8, bodenVersatz: 0 },
  { name: 'Nische 2×2', typ: 'nische', breite: 2, tiefe: 2, hoehe: 8, bodenVersatz: 0 },
  { name: 'Kammer 4×4', typ: 'kammer', breite: 4, tiefe: 4, hoehe: 12, bodenVersatz: 0 },
  { name: 'Saal 8×8', typ: 'saal', breite: 8, tiefe: 8, hoehe: 16, bodenVersatz: 0 },
  { name: 'Schatzkammer 6×6', typ: 'schatzkammer', breite: 6, tiefe: 6, hoehe: 12, bodenVersatz: 0 },
  { name: 'Grabkammer 6×8', typ: 'grabkammer', breite: 6, tiefe: 8, hoehe: 14, bodenVersatz: 0 },
  { name: 'Treppe 2×4', typ: 'treppe', breite: 2, tiefe: 4, hoehe: 16, bodenVersatz: 0 },
  { name: 'Abschluss 6×6', typ: 'abschluss', breite: 6, tiefe: 6, hoehe: 12, bodenVersatz: 0 },
];

/**
 * Alle Zellarten als (id,name)-Paare für eine Auswahl — heute nur informativ
 * (die Palette setzt Boden-Stempel); ausgelagert, damit ein späteres
 * Zellart-Werkzeug (Wasser, Schacht) dieselbe Liste nutzt statt einer zweiten.
 * All cell types as (id,name) pairs for a picker.
 */
export const ZELLART_NAMEN: ReadonlyArray<{ id: string; name: string; art: number }> = [
  { id: 'boden', name: 'Boden', art: ZELLEN_ART.Boden },
  { id: 'treppe', name: 'Treppe', art: ZELLEN_ART.Treppe },
  { id: 'schacht', name: 'Schacht', art: ZELLEN_ART.Schacht },
  { id: 'wasser', name: 'Wasser', art: ZELLEN_ART.Wasser },
  { id: 'leer', name: 'Fels (leer)', art: ZELLEN_ART.Leer },
];
