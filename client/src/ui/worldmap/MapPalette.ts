/**
 * Farb- und Signaturtabellen der Weltkarte.
 *
 * Wird von BEIDEN Seiten importiert: vom Worker (mapWorker.ts), der das Bild
 * rastert, und vom Panel (WorldMap.ts), das Legende und Tooltip daraus baut.
 * Deshalb hier keine Babylon-Imports — das Modul muss im Worker laufen.
 *
 * Die Biome-Farben sind dieselben wie im Offline-Werkzeug
 * `shared/test/geo-map.ts`, damit die Ingame-Karte und das Referenzbild
 * dieselbe Welt gleich einfärben.
 */
import { Biome, BiomeArea } from '@wov/shared';

export type RGB = readonly [number, number, number];

/** Grundfarbe je Biome (0..255), Valheim-Kartenlook. */
export const BIOME_COLOR: Record<number, RGB> = {
  [Biome.Meadows]: [104, 148, 76],
  [Biome.Swamp]: [62, 72, 58],
  [Biome.Mountain]: [214, 221, 228],
  [Biome.BlackForest]: [38, 66, 32],
  [Biome.Plains]: [170, 164, 92],
  [Biome.AshLands]: [58, 50, 52],
  [Biome.DeepNorth]: [196, 214, 228],
  [Biome.Ocean]: [44, 84, 130],
  [Biome.Mistlands]: [112, 128, 122],
  [Biome.None]: [255, 0, 255],
};

/** Deutsche Biome-Namen für Legende und Tooltip. */
export const BIOME_LABEL: Record<number, string> = {
  [Biome.Meadows]: 'Wiesen',
  [Biome.BlackForest]: 'Schwarzwald',
  [Biome.Swamp]: 'Sumpf',
  [Biome.Mountain]: 'Berge',
  [Biome.Plains]: 'Ebenen',
  [Biome.Mistlands]: 'Nebelland',
  [Biome.AshLands]: 'Aschelande',
  [Biome.DeepNorth]: 'Tiefer Norden',
  [Biome.Ocean]: 'Ozean',
  [Biome.None]: 'Unbekannt',
};

/** Reihenfolge der Legende (Fortschritt der Weltstufen). */
export const BIOME_ORDER: readonly Biome[] = [
  Biome.Meadows,
  Biome.BlackForest,
  Biome.Swamp,
  Biome.Mountain,
  Biome.Plains,
  Biome.Mistlands,
  Biome.AshLands,
  Biome.DeepNorth,
  Biome.Ocean,
];

/** Wasser: Tiefen-Lerp von `deep` (offene See) nach `shore` (Uferkante). */
export const DEEP_WATER: RGB = [28, 58, 96];
export const SHORE_WATER: RGB = [86, 148, 190];
export const RIVER_COLOR: RGB = [140, 205, 235];

/**
 * Baum-/Geländesignaturen, die als kleine 3D-Symbole auf die Karte gestreut
 * werden — das ist die Antwort auf "ist da Wald, und welcher".
 *
 * Die Zuordnung folgt der echten Vegetationstabelle (shared/src/vegetation.ts,
 * gefiltert nach `Foliage.biome`): welche Bäume in einem Biome tatsächlich
 * wachsen, bestimmt das Symbol.
 */
export enum TreeKind {
  /** Buche/Birke/Eiche — Wiesen (Beech1, Birch1, Oak1). */
  Laubwald = 0,
  /** Fichte — Schwarzwald-Rand und Berge (FirTree, FirTree_small). */
  Fichtenwald = 1,
  /** Kiefer — Schwarzwald-Kern (Pinetree_01, biomeArea Median). */
  Kiefernwald = 2,
  /** Abgestorbene Sumpfbäume (SwampTree1/2, FirTree_small_dead). */
  Sumpfwald = 3,
  /** Herbstbirke der Ebenen (Birch1_aut, Birch2_aut). */
  Herbstwald = 4,
  /** Yggdrasil-Triebe im Nebelland (YggaShoot1-3). */
  Nebelwald = 5,
  /** Aschebäume (AshlandsTree1/3/6). */
  Aschewald = 6,
  /** Eisformationen des tiefen Nordens (ice1, ice_rock1). */
  Eis = 7,
  /** Felszacken über der Baumgrenze. */
  Fels = 8,
}

export interface TreeStyle {
  /** Anzeigename in Legende/Tooltip. */
  readonly label: string;
  /** Kronen-/Symbolfarbe (0..255). */
  readonly color: RGB;
  /** Stamm-/Sockelfarbe. */
  readonly trunk: RGB;
  /** Grundhöhe des Symbols in Weltmetern (Kartenmaßstab skaliert das). */
  readonly height: number;
  /** Kronenradius in Weltmetern. */
  readonly radius: number;
  /** `kegel` = Nadelbaum, `kugel` = Laubkrone, `zacke` = Fels/Eis, `kahl` = toter Baum. */
  readonly form: 'kegel' | 'kugel' | 'zacke' | 'kahl';
}

export const TREE_STYLE: Record<TreeKind, TreeStyle> = {
  [TreeKind.Laubwald]: {
    label: 'Laubwald (Buche, Birke, Eiche)',
    color: [126, 168, 86], trunk: [92, 74, 48], height: 190, radius: 95, form: 'kugel',
  },
  [TreeKind.Fichtenwald]: {
    label: 'Fichtenwald (dichter Nadelwald)',
    color: [34, 74, 44], trunk: [58, 44, 30], height: 260, radius: 82, form: 'kegel',
  },
  [TreeKind.Kiefernwald]: {
    label: 'Kiefernwald (lichter Nadelwald)',
    color: [52, 92, 56], trunk: [78, 56, 34], height: 300, radius: 70, form: 'kegel',
  },
  [TreeKind.Sumpfwald]: {
    label: 'Sumpfwald (abgestorben)',
    color: [78, 78, 62], trunk: [54, 50, 40], height: 200, radius: 60, form: 'kahl',
  },
  [TreeKind.Herbstwald]: {
    label: 'Herbstbirken der Ebenen',
    color: [206, 178, 84], trunk: [188, 178, 160], height: 180, radius: 88, form: 'kugel',
  },
  [TreeKind.Nebelwald]: {
    label: 'Yggdrasil-Triebe im Nebel',
    color: [96, 138, 128], trunk: [70, 84, 82], height: 330, radius: 74, form: 'kegel',
  },
  [TreeKind.Aschewald]: {
    label: 'Verkohlte Aschebäume',
    color: [96, 44, 36], trunk: [42, 34, 32], height: 230, radius: 72, form: 'kahl',
  },
  [TreeKind.Eis]: {
    label: 'Eiszacken des tiefen Nordens',
    color: [222, 238, 250], trunk: [186, 206, 224], height: 220, radius: 78, form: 'zacke',
  },
  [TreeKind.Fels]: {
    label: 'Felsen und Gipfel',
    color: [176, 182, 190], trunk: [120, 124, 132], height: 260, radius: 96, form: 'zacke',
  },
};

/** Was in einem Biome wächst — pro Biome die möglichen Signaturen. */
export const BIOME_TREES: Record<number, readonly TreeKind[]> = {
  [Biome.Meadows]: [TreeKind.Laubwald],
  [Biome.BlackForest]: [TreeKind.Fichtenwald, TreeKind.Kiefernwald],
  [Biome.Swamp]: [TreeKind.Sumpfwald],
  [Biome.Mountain]: [TreeKind.Fichtenwald, TreeKind.Fels],
  [Biome.Plains]: [TreeKind.Herbstwald],
  [Biome.Mistlands]: [TreeKind.Nebelwald],
  [Biome.AshLands]: [TreeKind.Aschewald],
  [Biome.DeepNorth]: [TreeKind.Eis],
  [Biome.Ocean]: [],
  [Biome.None]: [],
};

/**
 * `GeoManager.inForest()` ist `getForestFactor(x,z) < 1.15`. Kleiner Faktor
 * heisst dichterer Wald — daraus wird sowohl die Symboldichte als auch die
 * Wald-Abdunklung des Kartenbildes abgeleitet.
 */
export const FOREST_THRESHOLD = 1.15;

/** 0 = keine Bäume, 1 = dichter Kernwald. */
export function forestDensity(forestFactor: number): number {
  const d = (FOREST_THRESHOLD - forestFactor) / 0.45;
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/** Beschreibung der Walddichte für den Tooltip. */
export function forestLabel(forestFactor: number): string {
  const d = forestDensity(forestFactor);
  if (d <= 0) return 'offenes Land';
  if (d < 0.25) return 'Waldrand';
  if (d < 0.6) return 'lichter Wald';
  return 'dichter Wald';
}

/**
 * Welche Signatur an dieser Stelle steht.
 *
 * Der Schwarzwald ist der einzige Fall, in dem die Bäume von `BiomeArea`
 * abhängen: `Pinetree_01` steht mit `biomeArea = Median` im Kern, der dichte
 * `FirTree`-Eintrag (40 pro Zone) hat `biomeArea = Edge` — Kiefern innen,
 * Fichten am Rand (siehe shared/src/vegetationData.json).
 */
export function treeKindAt(biome: Biome, area: BiomeArea, forestFactor: number, height: number): TreeKind | null {
  switch (biome) {
    case Biome.Meadows:
      return forestFactor < FOREST_THRESHOLD ? TreeKind.Laubwald : null;
    case Biome.BlackForest:
      return (area & BiomeArea.Median) !== 0 ? TreeKind.Kiefernwald : TreeKind.Fichtenwald;
    case Biome.Swamp:
      return TreeKind.Sumpfwald;
    case Biome.Plains:
      // Birch*_aut sind selten (30/10 pro Zone gegenüber 40 Buchen in den
      // Wiesen) und stehen nur im Wald — sonst bleibt die Heide offen.
      return forestFactor < FOREST_THRESHOLD ? TreeKind.Herbstwald : null;
    case Biome.Mountain:
      // Über ~150 m endet der Baumbewuchs; darüber nur noch Fels/Gipfel.
      if (height > 150) return TreeKind.Fels;
      return forestFactor < FOREST_THRESHOLD ? TreeKind.Fichtenwald : TreeKind.Fels;
    case Biome.Mistlands:
      return TreeKind.Nebelwald;
    case Biome.AshLands:
      return TreeKind.Aschewald;
    case Biome.DeepNorth:
      return TreeKind.Eis;
    default:
      return null;
  }
}

/**
 * Was in einem Biome zu finden ist — für die Auskunftszeile der Karte.
 *
 * Abgeleitet aus der echten Vegetationstabelle (`shared/src/vegetationData.json`,
 * gefiltert nach der Biome-Maske jedes `Foliage`-Eintrags), also aus denselben
 * Daten, mit denen der Server die Zonen bepflanzt — keine erfundene Liste.
 */
export const BIOME_INHALT: Record<number, string> = {
  [Biome.Meadows]: 'Buchen, Birken, Eichen, Himbeeren, Pilze, Feuerstein',
  [Biome.BlackForest]: 'Fichten, Kiefern, Kupfer- und Zinnadern, Blaubeeren, Disteln',
  [Biome.Swamp]: 'Sumpfbäume, Schlammhaufen, Disteln, Rüben, böse Statuen',
  [Biome.Mountain]: 'Silberadern, Obsidian, einzelne Fichten, Felsklippen',
  [Biome.Plains]: 'Herbstbirken, Heidebüsche, Wolkenbeeren, Steinsäulen',
  [Biome.Mistlands]: 'Yggdrasil-Triebe, Riesengebeine, Magecap und Jötunpuffs, Nebel',
  [Biome.AshLands]: 'Aschebäume, Lavagestein, Aschesteine, verfallene Ruinen',
  [Biome.DeepNorth]: 'Eisformationen und Eisfelsen',
  [Biome.Ocean]: 'offene See, Leviathane, Küstenfelsen',
  [Biome.None]: '—',
};

/** Wie dicht die Symbole eines Biomes stehen (0..1, multipliziert die Walddichte). */
export const BIOME_TREE_DENSITY: Record<number, number> = {
  [Biome.Meadows]: 0.75,
  [Biome.BlackForest]: 1.0,
  [Biome.Swamp]: 0.85,
  [Biome.Mountain]: 0.5,
  [Biome.Plains]: 0.45,
  [Biome.Mistlands]: 0.9,
  [Biome.AshLands]: 0.7,
  [Biome.DeepNorth]: 0.55,
  [Biome.Ocean]: 0,
  [Biome.None]: 0,
};
