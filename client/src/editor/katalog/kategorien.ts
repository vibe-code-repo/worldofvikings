/**
 * Categories of the editor's object catalogue (`../GegenstandsKatalog.ts`),
 * moved here unchanged (refactoring step G1).
 *
 * WARNING: `ITEMS_NACH_NAME`, `MIT_MODELL` and `KATEGORIEN` are derived from
 * the registries when this module LOADS. It must therefore only be reached
 * through `GegenstandsKatalog.ts`, which `editorMain.ts` loads dynamically
 * after the registrations. A static import from anywhere else would build
 * the lists too early. `client/test/katalog-module-grenze.ts` guards this.
 */
import {
  BAU_PREFABS,
  EIGENE_MODELLE,
  FOLIAGE,
  ITEM_DEFS,
  NPC_VORGABEN,
  PREFABS_BY_NAME,
  PREFAB_DEFS,
  isRenderable,
  uploadedModelRegistry,
} from '@wov/shared';
import { STORE_ARTEN, type StoreArt } from '../StoreKatalogDaten';

/** Schnellzugriff auf Item-Angaben (Icon, Gewicht, Stapel) je Prefabname. */
const ITEMS_NACH_NAME = new Map(ITEM_DEFS.map((i) => [i.name, i]));

/**
 * Anzeigetexte der ItemType-Werte.
 *
 * Bewusst eine Zahlentabelle statt `import { ItemType }`: Der Typ ist ein
 * `const enum`, und die werden von esbuild/Vite über Modulgrenzen hinweg
 * nicht zuverlässig aufgelöst. Für eine reine Beschriftung ist das die
 * Mühe nicht wert.
 */
const ITEM_TYP_TEXT: Readonly<Record<number, string>> = {
  1: 'Material',
  14: 'Zweihandwaffe',
  19: 'Werkzeug',
};

/** Nur Prefabs, die im Spiel überhaupt ein Bild bekommen (s. isRenderable). */
const MIT_MODELL = PREFAB_DEFS.filter((d) => d.model !== null && isRenderable(d));

interface Kategorie {
  name: string;
  /** Erklärung unter der Auswahl — was steckt in dieser Liste? */
  hinweis: string;
  namen: () => string[];
  /**
   * Gesetzt = diese Kategorie kommt aus dem SPEICHER, nicht aus der
   * Prefab-Registry. Die Liste heisst dann nicht „Prefabnamen", sondern
   * „Store-Ids", und Vorschau, Infoblock und Verfügbarkeitsprüfung nehmen
   * jeweils den anderen Zweig (s. `istSpeicher`).
   */
  speicher?: StoreArt;
  /**
   * Gesetzt = die Liste wächst/schrumpft zur LAUFZEIT (Uploads, Karte U1)
   * — anders als Registry, Vegetation oder PieceTable, die für die
   * Sitzung feststehen. `katAnzahl` darf ihre Zahl deshalb NICHT im
   * `katAnzahlen`-Cache mitschleppen (s. dort), sonst zeigte die Marke
   * nach dem ersten Öffnen dauerhaft die Zahl von damals.
   */
  dynamisch?: boolean;
}

/** Erklärungen der sechs Speicher-Arten — eine Zeile je Bereich. */
const SPEICHER_HINWEIS: Readonly<Record<StoreArt, string>> = {
  Modelle: 'Alle GLBs des Speichers — Gebäude, Requisiten, Gegenstände, Umgebung, Fahrzeuge, Vegetation.',
  Texturen: 'Bilder des Speichers: Boden-Texturen der Landschaft und die Atlanten der Modelle.',
  Ton: 'Klänge des Speichers (Opus in .ogg) — anhören mit dem Abspieler, „Weiter" geht die Untergruppe durch.',
  Höhenfelder: 'Gelände-GLBs (terrain/) — dieselbe 3D-Vorschau wie bei Modellen, nur größer.',
  Kulisse: 'Horizontschalen und Wolken. Bis 600 m Spannweite — die Kamera rückt dafür weiter weg.',
  Symbole: 'UI-Bilder des Speichers: HUD-Rahmen und Gegenstandssymbole (PNG) — keine 3D-Vorschau, kein Setzen in die Welt.',
};

/**
 * Die Kategorien des Katalogs.
 *
 * Reihenfolge ist Absicht: „Eigene Modelle" steht vorn und ist die
 * Vorgabe, weil das die Liste ist, deren GLBs überall wirklich liegen.
 * Alles Weitere ist nach Nutzen sortiert (was man beim Weltbau sucht),
 * die vollständige Registry steht als letzter Ausweg am Ende.
 *
 * Gefiltert wird überall gegen PREFABS_BY_NAME: Ein Name ohne
 * Registry-Eintrag hätte weder Modell noch Maße — eine tote Zeile.
 *
 * Gegen EIGENE_MODELLE wird hier NICHT gefiltert — anders als im
 * SpawnPanel, und mit Absicht: Der Katalog setzt nichts in die Welt, er
 * zeigt. „Wie sah das aus, was da entfällt?" ist genau die Frage, die
 * man beim Nachbauen stellt, und ihre Antwort wegzunehmen hiesse, sich
 * die Vorlage zu verbauen. Gleichrangig bleibt es deshalb trotzdem
 * nicht: Ohne eigenes Modell steht die Zeile ausgegraut mit ⊘ da, der
 * Metadatenblock sagt es in Worten, und über der Liste steht die Quote
 * der Kategorie.
 */
const KATEGORIEN: readonly Kategorie[] = [
  {
    name: '★ Eigene Modelle',
    hinweis: 'Selbst gebaut (Blender/Tripo/Baumgenerator) — diese GLBs liegen immer vor.',
    namen: () => EIGENE_MODELLE.filter((n) => PREFABS_BY_NAME.has(n)),
  },
  /*
    Hochgeladene Modelle (Karte U1) bekommen eine EIGENE Gruppe statt in
    „★ Eigene Modelle" mitzulaufen — sie stehen zwar in derselben
    EIGENE_MODELLE-Liste (dieselbe Whitelist, s. `uploadedModelRegistry.
    registerUploadedPrefab`), aber „woher kam das?" ist hier trotzdem eine
    andere Antwort als bei den handgebauten Modellen, und der Uploadknopf
    braucht eine Stelle, an der auch die Liste der bereits hochgeladenen
    Dinge steht (Entfernen sitzt am Infoblock, s. `infoSchreiben`).
  */
  {
    name: '⇧ Hochgeladen',
    hinweis: 'Per Editor hochgeladene Modelle — eigene Registry (assets/hochgeladen/), nicht in shared/src/prefabs.ts.',
    dynamisch: true,
    namen: () =>
      uploadedModelRegistry
        .uploadedModelEntries()
        .map((m) => m.name)
        .filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Vegetation',
    hinweis: 'Alles, was die Weltgenerierung streut (shared/vegetation.ts).',
    namen: () => [...new Set(FOLIAGE.map((f) => f.prefabName))].filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Bauteile',
    hinweis: 'Was der Hammer setzen kann (PieceTable).',
    namen: () => [...BAU_PREFABS].filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Figuren (NPC)',
    hinweis: 'Prefabs mit NPC-Vorgaben — Rolle, Fraktion, Stufe (shared/npc.ts).',
    namen: () => [...NPC_VORGABEN.keys()].filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Gegenstände (Items)',
    hinweis: 'Inventarfähige Dinge mit Icon und Gewicht (shared/items/itemDefs.ts).',
    namen: () => ITEM_DEFS.map((i) => i.name).filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Alle mit Modell',
    hinweis: `Die volle Registry, ${MIT_MODELL.length} Einträge — die meisten GLBs fehlen auf diesem Server.`,
    namen: () => MIT_MODELL.map((d) => d.name),
  },
  /*
    Der Speicher als eigener Bereich — eine Kategorie je Art in {@link STORE_ARTEN}.

    Sie stehen HINTEN und nicht vorn: Die Vorgabe-Kategorie bleibt
    „★ Eigene Modelle", wie sie es war. Wer den Katalog öffnet, um ein
    Prefab nachzuschlagen, soll nicht plötzlich in einem Dateibrowser
    landen. Der Speicher ist die zweite Frage („was liegt überhaupt da?"),
    nicht die erste.

    `namen()` liefert hier eine LEERE Liste und wird nie gerufen: Der
    Bestand kommt aus zwei JSON-Dateien, die erst geladen werden müssen
    (s. `speicherTreffer`). Ein Rückgabewert, der so tut, als wäre er die
    Liste, wäre die schlechtere Lüge als eine leere.
  */
  ...STORE_ARTEN.map((art) => ({
    name: `Speicher · ${art}`,
    hinweis: SPEICHER_HINWEIS[art],
    namen: () => [],
    speicher: art,
  })),
];

export { ITEMS_NACH_NAME, ITEM_TYP_TEXT, KATEGORIEN };
