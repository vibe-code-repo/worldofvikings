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
 */
export type StoreArt = 'modell' | 'textur' | 'ton' | 'terrain' | 'kulisse';

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
 * (Namensregel `…-collision.glb`; im Client entspricht das der
 * `_col`-Konvention aus `AssetManager`).
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
  kollision?: StoreKollision;
  lizenzstatus: StoreLizenzstatus;
  /** Name des zugehörigen `PrefabDef`, falls es eines gibt. */
  prefabName?: string;
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
 * ── Warum es diesen Schalter überhaupt gibt ──────────────────────────
 * Babylon dreht beim glTF-Import die Händigkeit, indem es dem Modell
 * einen `__root__`-Knoten mit `scaling.x = -1` voransetzt. Für die
 * EIGENEN Modelle dieses Projekts ist das bekannt und eingerechnet: Sie
 * werden beim Export vorgespiegelt, sonst stünde jede Schrift
 * seitenverkehrt und jede Treppe drehte falsch herum.
 *
 * Ob der fremde Store-Bestand dieselbe Behandlung braucht, ist eine
 * MESSFRAGE und keine Meinung — Bauer D misst sie an einem Modell mit
 * eindeutiger Händigkeit. Bis sein Befund vorliegt, steht hier `false`:
 * unverändert laden, also genau das, was Babylon von sich aus tut. Das
 * ist die einzige Vorgabe, die man später nicht rückwirkend erklären
 * muss.
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
 * Erwartet wird, dass diese Menge leer bleibt: Der Bestand kommt aus
 * einem Werkzeug, und ein Werkzeug exportiert alles gleich. Sie steht
 * trotzdem hier, weil „alles gleich" eine Annahme ist — und eine
 * Annahme, die sich als falsch herausstellt, soll eine Zeile kosten und
 * nicht einen Umbau.
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
