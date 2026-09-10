/**
 * storeKatalog.ts — die HANDGESCHRIEBENE Hälfte der Asset-Brücke.
 *
 * Hier stehen nur Typen und Stellschrauben. Die Daten selbst — 569
 * Prefab-Definitionen und 670 Katalogzeilen — erzeugt
 * `tools/store-prefabs.mjs` nach `shared/src/storePrefabs.ts`. Die
 * Trennung ist Absicht und kein Ordnungssinn:
 *
 *   • Eine erzeugte Datei darf man jederzeit wegwerfen und neu bauen.
 *     Stünde der Spiegelungs-Schalter dort im Kopf, überschriebe ihn
 *     der nächste Generatorlauf — und zwar lautlos, denn ein
 *     zurückgedrehter Schalter sieht aus wie ein nie gesetzter.
 *   • Ein `interface`, das Bauer C für den Gegenstandskatalog
 *     importiert, gehört nicht in eine Datei, deren erste Zeile
 *     „NICHT VON HAND ÄNDERN" lautet.
 *
 * Types and knobs for the generated store registry; the data itself is
 * written by tools/store-prefabs.mjs.
 */

/**
 * Was ein Store-Eintrag IST — nicht, wozu er gut ist.
 *
 * `modell` ist alles, was der Client als GLB laden und in die Szene
 * stellen kann. `kulisse` und `terrain` sind ebenfalls GLB, bekommen
 * aber eigene Arten, weil beide NICHT gestreut werden dürfen: Eine
 * Kulisse ist ~600 m breit (`environment/backdrop-mountains-clear.glb`),
 * ein Höhenfeld bringt sein eigenes Gelände mit. Wer sie zwischen die
 * Requisiten mischte, setzte einen halben Kilometer Berg neben ein Fass.
 *
 * `kollision` sind die zwölf `…-collision.glb` — unsichtbare
 * Hüllgeometrie, die NIE ins Bild gehört. Sie tragen bewusst eine eigene
 * Art und kein blosses Kennzeichen: Ein Kennzeichen übersieht man beim
 * Filtern, eine Art nicht. Bauer Ds Messprobe hat sie gezählt und
 * festgestellt, dass es KEINE `_col`-Knoten in den Dateien gibt — die
 * Trennung läuft ausschliesslich über den Dateinamen.
 */
export type StoreArt = 'modell' | 'textur' | 'ton' | 'terrain' | 'kulisse' | 'kollision';

/**
 * Darf die Datei das Repo verlassen?
 *
 * Abgeleitet aus `visibility`/`redistributable` des Store-Manifests, und
 * bewusst als eigenes Feld statt als zwei Kopien der Manifest-Felder:
 * Die Frage, die man an einen Katalogeintrag stellt, ist immer dieselbe
 * — „darf das nach draussen?". `intern` heisst nein.
 */
export type StoreLizenzstatus = 'frei' | 'intern';

/** Achsparallele Hüllbox in Metern, Ursprung = Bodenkontakt des Modells. */
export interface StoreBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * Die Kollisionsangabe aus `prefabs.json`, unverändert übernommen.
 *
 * ANGEBUNDEN ist sie noch nicht — das ist ein späterer Schritt (siehe
 * Bericht). Sie wandert trotzdem schon mit: Sie steht in der Quelle, sie
 * kostet nichts, und sie später nachzuziehen hiesse, den Generator ein
 * zweites Mal zu schreiben.
 *
 * `box` ist die Hüllbox des Kollisionskörpers in Modellkoordinaten —
 * sie FEHLT bei 451 der 524 Kastenkörper, und das ist kein Datenverlust:
 * Die Quelle trägt sie nur ein, wo der Körper von der Modell-Hüllbox
 * abweicht. Fehlt sie, gilt `bounds` des Eintrags.
 *
 * `netz` ist der Pfad einer eigenen Kollisions-GLB relativ zum Store
 * (Namensregel `…-collision.glb`). ACHTUNG, anders als beim Altbestand:
 * Die `_col`-Konvention aus `AssetManager` greift hier NICHT — Bauer Ds
 * Messprobe hat in keiner Store-GLB einen `_col`-Knoten gefunden. Die
 * Kollisionsgeometrie ist immer eine eigene DATEI, nie ein Netz in der
 * Modelldatei.
 */
export interface StoreKollision {
  art: 'box' | 'none' | 'mesh';
  box?: StoreBounds;
  netz?: string;
}

/**
 * EIN Eintrag des Store-Katalogs — Modell, Textur, Ton oder Höhenfeld.
 *
 * Der Katalog ist vollständig: Er führt JEDE Datei, die unter
 * `assets/store/` wirklich liegt, auch die, zu der es kein Prefab gibt
 * (Kollisionsnetze, Texturen, Töne). Das ist der Unterschied zu
 * {@link StorePrefabName}: Ein Prefab ist etwas, das man SETZT; ein
 * Katalogeintrag ist etwas, das es GIBT.
 */
export interface StoreEintrag {
  /** Kennung aus `prefabs.json` bzw. `manifest.json` — im Katalog eindeutig. */
  id: string;
  /** Pfad relativ zum Store, mit Endung (z. B. `vegetation/tree-1e1.glb`). */
  pfad: string;
  art: StoreArt;
  /** Oberste Schublade, deutsch (z. B. „Gebäude", „Vegetation", „Ton"). */
  gruppe: string;
  /** Fach darin (z. B. „Haus", „Nadelbäume", „Schritte"). */
  untergruppe: string;
  /**
   * Merkmale der Variante, sortiert: `snow`, `dark`, `lod`, `kollision`.
   * Leer, wenn es die Grundfassung ist.
   */
  kennzeichen?: readonly string[];
  bytes: number;
  /** `sha256-…` aus dem Store-Manifest. */
  hash: string;
  bounds?: StoreBounds;
  /**
   * Bezugssystem von {@link bounds} und `kollision.box` — immer
   * {@link STORE_BOUNDS_RAUM}, also DATEIRAUM.
   *
   * Steht als Feld da und nicht nur im Kommentar, weil der Unterschied
   * teuer ist und man ihn einer Zahl nicht ansieht: Babylon klappt beim
   * glTF-Import die x-Achse um (`__root__`, s.
   * {@link STORE_SPIEGELN_VORGABE}). Im WELTRAUM gilt deshalb
   * `min.x' = −max.x` und `max.x' = −min.x` — wer die Kiste
   * unverändert als Weltkiste benutzt, spiegelt jedes unsymmetrische
   * Hindernis. Umrechnung: {@link boundsNachWeltraum}.
   *
   * Gemessen von Bauer D über alle 581 Store-GLBs (Messprobe
   * 08.09.2026): Die Werte aus `prefabs.json`/`manifest.json` treffen
   * die Nachmessung exakt, `localScale` ist 1, die Einheit ist der
   * Meter. Verlässlich ist also der WERT — nur eben im Dateiraum.
   */
  boundsRaum?: typeof STORE_BOUNDS_RAUM;
  kollision?: StoreKollision;
  /**
   * Pfad der eigenen Kollisions-GLB dieses Modells, relativ zum Store.
   *
   * Aus dem DATEINAMEN abgeleitet (`<modell>-collision.glb`) und nicht
   * aus `prefabs.json`: Von den zwölf Kollisionsdateien im Speicher
   * nennt die Quelle nur drei. Neun weitere beschreiben ein Modell, das
   * gar nicht im Store liegt — die bleiben unverknüpft, und das steht
   * hier so, damit niemand sie später für einen Fehler hält.
   */
  kollisionsDatei?: string;
  /**
   * Darf das in die Welt gesetzt oder gestreut werden?
   *
   * `false` bei Kulissen (bis 594 m breit) und Höhenfeldern (bis 300 m,
   * mit eigenem Gelände). Beide bleiben im Katalog — man will sie sehen
   * und einzeln benutzen können —, aber keine Streufunktion darf sie
   * greifen. Fehlt das Feld, gilt `true`.
   */
  platzierbar?: boolean;
  lizenzstatus: StoreLizenzstatus;
  /** Name des zugehörigen `PrefabDef`, falls es eines gibt. */
  prefabName?: string;
}

/**
 * Das Bezugssystem, in dem ALLE Hüllboxen des Katalogs stehen.
 *
 * Eine Konstante statt einer Zeichenkette an 670 Stellen zu prüfen: Wer
 * `e.boundsRaum === STORE_BOUNDS_RAUM` schreibt, kann sich nicht
 * vertippen, und wenn eines Tages ein zweiter Raum dazukommt, findet
 * der Compiler jede Stelle.
 */
export const STORE_BOUNDS_RAUM = 'datei';

/**
 * Dateiraum → Weltraum: die x-Achse umklappen.
 *
 * Babylons glTF-Import stellt jedem Modell einen `__root__` mit
 * gespiegelter x-Achse voran (Bauer Ds Messprobe: `rotQuat (0,1,0,0)`,
 * `scaling (1,1,−1)` — zusammen die Händigkeitsumrechnung). Eine
 * Hüllbox aus der Datei beschreibt das Modell VOR dieser Umrechnung.
 *
 * Für einen Zylinder ist der Unterschied null, für eine Treppe ist er
 * die ganze Treppe. Deshalb eine Funktion und keine Fussnote.
 */
export function boundsNachWeltraum(b: StoreBounds): StoreBounds {
  return {
    min: [-b.max[0], b.min[1], b.min[2]],
    max: [-b.min[0], b.max[1], b.max[2]],
  };
}

/**
 * Name eines Store-Prefabs — dasselbe wie seine `id` in `prefabs.json`.
 *
 * Nur ein Alias auf `string`, aber ein sprechender: An jeder Stelle, an
 * der ein Prefabname erwartet wird, steht sonst dreimal dasselbe
 * `string` für drei verschiedene Dinge (Prefabname, Modellpfad,
 * Dateiname).
 */
export type StorePrefabName = string;

/**
 * Der Ordner der abgeleiteten Modelle von Bauer B (zusammengelegte
 * Materialien, getöntes Laub) — relativ zu `assets/`.
 *
 * Der Generator bevorzugt ihn für Vegetation, WENN die Datei dort liegt.
 * Steht hier, damit Generator, Test und Ladepfad dieselbe Zeichenkette
 * benutzen: Drei Kopien von `store-lab/vegetation` liefen beim ersten
 * Umbenennen auseinander, und der Fehler wäre ein 404 im Browser — nichts,
 * was ein Test sieht.
 */
export const STORE_LAB_BASIS = 'store-lab';

/** Der Ordner des unveränderten Bestands — relativ zu `assets/`. */
export const STORE_BASIS = 'store';

/**
 * Müssen Store-Modelle in x gespiegelt werden?
 *
 * ── Der Befund: `false`, und zwar gemessen ───────────────────────────
 * Babylon dreht beim glTF-Import die Händigkeit, indem es dem Modell
 * einen `__root__`-Knoten voransetzt — Bauer Ds Messprobe vom
 * 08.09.2026 hat ihn ausgelesen: `rotQuat (0,1,0,0)` und
 * `scaling (1,1,−1)`. Die negative Determinante, die dabei entsteht,
 * rechnet der Client BEREITS heraus: `zuMaster()` in `AssetManager.ts`
 * dreht dafür die `sideOrientation` um. Eine zweite Spiegelung an
 * dieser Stelle stülpte die Modelle um — sie sähen von aussen aus wie
 * von innen.
 *
 * Deshalb steht hier `false`, und das ist kein Platzhalter mehr,
 * sondern das Messergebnis. Zusätzliche y-Drehung: 0°; vorne ist nach
 * dem Laden `+z`.
 *
 * Wer den Schalter je auf `true` dreht, MUSS `__root__.scaling`
 * multiplizieren statt zuweisen (so macht es `spiegeleWennNoetig`):
 * Eine Zuweisung wirft die Händigkeitsumrechnung weg, statt sie
 * umzukehren, und das Modell steht danach in einer Achse, die niemand
 * gemeint hat.
 *
 * ── Wo er wirkt ──────────────────────────────────────────────────────
 * `AssetManager.loadContainer()` — die EINE Stelle, an der ein
 * Store-Container entsteht. Beide Wege (statische Master über
 * `getMasters`, dynamische Instanzen über `instantiate`) hängen daran,
 * also gibt es keinen zweiten Ort, an dem man es vergessen könnte.
 *
 * Der Integrator setzt hier `true`, wenn Ds Messung das sagt. Einzelne
 * Ausnahmen trägt er in {@link STORE_SPIEGELN_AUSNAHMEN} ein.
 */
export const STORE_SPIEGELN_VORGABE = false;

/**
 * Store-Prefabs, die es ANDERS halten als {@link STORE_SPIEGELN_VORGABE}.
 *
 * Erwartet wird, dass diese Menge leer bleibt — Bauer Ds Messprobe hat
 * alle 581 Dateien angesehen und keinen Sonderfall gefunden. Sie steht
 * trotzdem hier, weil „alle gleich" eine Aussage über den heutigen
 * Bestand ist; ein Modell, das morgen dazukommt, soll eine Zeile kosten
 * und nicht einen Umbau.
 */
export const STORE_SPIEGELN_AUSNAHMEN: ReadonlySet<StorePrefabName> = new Set<StorePrefabName>();

/**
 * Soll dieses Modell gespiegelt werden? — die Frage, die
 * `AssetManager` stellt.
 *
 * Gefragt wird mit dem MODELLPFAD (`store/vegetation/tree-1e1`), nicht
 * mit dem Prefabnamen: An der Stelle, an der der Container entsteht, ist
 * der Prefabname längst zum Dateipfad geworden. Alles, was nicht aus dem
 * Store kommt, beantwortet die Funktion mit `false` — der Bestand unter
 * `assets/models/` regelt seine Händigkeit beim Export.
 */
export function storeSpiegelung(modell: string): boolean {
  if (!istStoreModell(modell)) return false;
  return STORE_SPIEGELN_AUSNAHMEN.has(modell) ? !STORE_SPIEGELN_VORGABE : STORE_SPIEGELN_VORGABE;
}

/** Zeigt `modell` in den Store (oder in Bauer Bs abgeleiteten Ordner)? */
export function istStoreModell(modell: string): boolean {
  return modell.startsWith(`${STORE_BASIS}/`) || modell.startsWith(`${STORE_LAB_BASIS}/`);
}

/**
 * Der Pfad einer Kollisions-GLB als MODELLNAME — so, wie ihn der Ladeweg
 * erwartet: mit Speicherpräfix und ohne Endung.
 *
 * `STORE_KOLLISIONSNETZ` führt ihn relativ zum Speicher und MIT `.glb`
 * (`environment/sm-bld-house-stairs-03-collision.glb`), weil er so in
 * `prefabs.json` steht. Geladen wird über `PrefabDef.model`, und das ist
 * `store/environment/sm-bld-house-stairs-03` — zwei Schreibweisen
 * derselben Datei. Wer sie von Hand ineinander umrechnet, vergisst beim
 * zweiten Mal die Endung, und das Ergebnis ist ein 404 statt eines
 * Fehlers.
 *
 * Der ABGELEITETE Ordner (`store-lab/`) kommt hier nicht vor: Dort liegt
 * nur aufbereitete Vegetation, und die trägt keine Kollisionsnetze.
 */
export function kollisionsModellPfad(netzPfad: string): string {
  return `${STORE_BASIS}/${netzPfad.replace(/\.[^./]+$/, '')}`;
}

/**
 * Zeichnet der GRAS-CLUTTER die Grasbüschel des Speichers — statt sie als
 * Prefabs zu streuen?
 *
 * ── Warum der Schalter hier steht und nicht im Client ────────────────
 * Er hat zwei Seiten, und beide müssen dieselbe Wahrheit lesen:
 * `client/src/engine/GrassClutter.ts` entscheidet daran, ob die
 * Wiesen-Einträge die Store-Geometrie bekommen, und
 * `shared/src/storeFlora.ts` entscheidet daran, ob die vier
 * `grass-short-clump-*` überhaupt noch in einer Biom-Streuliste stehen.
 * Zwei Schalter liefen beim ersten Umlegen auseinander — und zwar
 * lautlos: Bei „Clutter an, Streuung an" stünde jedes Büschel zweimal da,
 * bei „beides aus" wäre die Wiese kahl. `shared` ist der einzige Ort, den
 * beide Seiten importieren dürfen.
 *
 * ── Was `true` bedeutet (Vorgabe) ────────────────────────────────────
 * Die Büschel sind Thin Instances des Clutters: dieselbe Keulung,
 * derselbe Wind, dieselbe Sichtweite wie das übrige Bodengrün — und ein
 * Master statt tausender Prefab-Einträge. Am Referenzort 10077/−18723
 * gemessen (09.09.2026, drei Läufe): 12.024 Prefab-Instanzen
 * `vegetation-grass-short-clump-1` und 2.311 `-redblue` fallen damit aus
 * der Streuung heraus.
 *
 * ── Was `false` bedeutet ─────────────────────────────────────────────
 * Der Rückfall auf Stufe 1: Der Clutter zeichnet wieder die
 * Altbestands-Karten (`MESH_FILES` dort), und die vier Büschel stehen
 * wieder in den Streulisten. Kein halber Zustand, keine Zeile, die
 * zurückgenommen werden müsste.
 *
 * Draws the store's grass clumps as clutter thin instances (true) or
 * scatters them as prefabs like stage 1 did (false).
 */
export const STORE_GRAS_AKTIV = true;

/**
 * Die Store-Prefabs, die der Gras-Clutter zeichnet.
 *
 * Vier Dateien, ein Modell in vier Farben: `grass-short-clump-1` (grün,
 * `baseColorFactor` [0.85, 1, 0.6]), `-redblue` (Blüten), `-yellow`
 * (Trockengras) und `-snow`. Jede trägt zwei Netze — LOD0 mit sechs und
 * LOD1 mit vier Dreiecken — unter EINEM Material.
 *
 * ── Warum nicht in `STORE_NICHT_STREUEN` ─────────────────────────────
 * Diese Menge steht in der ERZEUGTEN `storePrefabs.ts` und bedeutet dort
 * etwas anderes: „`platzierbar: false`", also Kulissen und Höhenfelder,
 * die überhaupt nicht in die Welt dürfen. `shared/test/store-registry.ts`
 * prüft, dass sich beide Angaben exakt decken — ein Eintrag hier drin
 * bräche diesen Test, und der nächste Generatorlauf überschriebe ihn
 * ohnehin. Vor allem aber sollen die Büschel im Editor weiter von Hand
 * setzbar bleiben: Sie sind nicht unplatzierbar, sie werden nur nicht
 * mehr GESTREUT.
 */
export const STORE_GRAS_IM_CLUTTER: ReadonlySet<StorePrefabName> = new Set<StorePrefabName>([
  'vegetation-grass-short-clump-1',
  'vegetation-grass-short-clump-redblue',
  'vegetation-grass-short-clump-snow',
  'vegetation-grass-short-clump-yellow',
]);

/**
 * Zeichnet der Clutter dieses Prefab — darf es also nicht gestreut
 * werden?
 *
 * Eine Funktion statt zweier Abfragen an der Aufrufstelle: Wer nur
 * {@link STORE_GRAS_IM_CLUTTER} fragt und den Schalter vergisst, streut
 * bei `STORE_GRAS_AKTIV = false` nichts mehr — die Wiese wäre kahl, und
 * niemand sähe warum.
 */
export function zeichnetDerGrasClutter(name: StorePrefabName): boolean {
  return STORE_GRAS_AKTIV && STORE_GRAS_IM_CLUTTER.has(name);
}
