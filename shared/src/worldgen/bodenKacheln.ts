/**
 * Die Bodenkacheln: Tile-Indizes, Biom → Grundkachel und die drei Hangtabellen.
 *
 * Bis zum 29.09.2026 standen sie in `client/src/engine/TerrainSplat.ts` (das
 * Babylon mitzieht). Hier stehen sie engine-frei, damit die Bodenmischung
 * (`./bodenMischung`) dieselben Tabellen liest wie der Shader — `TerrainSplat.ts`
 * reicht sie unverändert weiter.
 *
 * Tile tables of the terrain splat, engine-free so the CPU ground mix can
 * read the very same numbers the shader is built from.
 */
/** Tile-Indizes im 256×4096-Stack (G-TEX, 16/16 gegen Slices verifiziert). */
export const TILE = {
  Grass: 0, Forest: 1, Dirt: 2, Cleared: 3, Rock: 4, Cliff: 5, LavaEmber: 6,
  Ash: 7, Heath: 8, Sand: 9, SwampMud: 10, Moss: 11, Paved: 12,
  SwampDark: 13, Basalt: 14, LavaCrust: 15,
  // Greyglen (Bit 128): eigene Kacheln, damit Grund, Hang und Fels des
  // Bioms ihre eigene Rampe tragen koennen (`RAMPEN_JE_KACHEL`).
  GreyGrass: 16, GreyMoss: 17, GreyRock: 18, GreyRockMoss: 19,
} as const;

/** Anzahl der Kacheln (Tile-Indizes 0 … 19). */
export const TILE_ANZAHL = 20;

/**
 * Zeilen des Texturstapels (`store_d_array.png`, `store_n_array.png`).
 *
 * Bleibt bei 16, obwohl es 20 Kacheln gibt: Der Stapel ist 512 px breit und
 * 8192 px hoch, und 20 Zeilen waeren 10240 px, mehr als jede GPU mit
 * `MAX_TEXTURE_SIZE` 8192 laedt. Die vier Greyglen-Kacheln zeigen deshalb auf
 * Zeilen, die es schon gibt (`TILE_ZEILE`). Damit bleibt die Datei Zeile fuer
 * Zeile die alte: ein alter Client liest einen neuen Stapel richtig und ein
 * neuer Client einen alten.
 */
export const STAPEL_ZEILEN = 16;

/**
 * Welche Stapelzeile eine Kachel zeigt.
 *
 *  - Kachel 6 (`LavaEmber`) teilt sich Zeile 5 mit `Cliff`: beide tragen
 *    dieselbe Farbkarte, dieselbe Normale und dieselben Oberflaechenwerte.
 *  - Greyglen: Gras → Zeile 0, Moos → Zeile 11, Fels → Zeile 4. Dieselben
 *    Quellkarten, sie brauchen keine eigene Zeile. Der raue Fels (19) nimmt die
 *    dadurch frei gewordene Zeile 6: dieselbe Farbkarte wie Zeile 5, aber mit
 *    der eigenen Normalkarte.
 *
 * Aenderst du diese Tabelle oder die Zeilenquellen im Werkzeug, erhoehe
 * `STAPEL_VERSION`.
 */
export const TILE_ZEILE: readonly number[] = [
  0, 1, 2, 3, 4, 5, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, // 0-15
  0, 11, 4, 6, // 16-19 Greyglen
];

/**
 * Version des Stapel-Layouts. Haengt als Abfrageparameter an der Stapel-URL
 * (bricht den Browser-Cache) und steht in `store-schichten.json`; die Test-
 * Datei haelt Werkzeug und Code auf derselben Zahl.
 */
export const STAPEL_VERSION = 2;

/**
 * Rueckfall, wenn der Stapel nicht zum Code passt: jede Greyglen-Kachel auf
 * ihre Entsprechung im Grasland, alle anderen unveraendert.
 */
export const KACHEL_RUECKFALL: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  TILE.Grass, TILE.Moss, TILE.Rock, TILE.Cliff,
];

/** Die Kachel, die ein Chunk wirklich bekommt: unveraendert, oder bei unbrauchbarem Stapel der Rueckfall. */
export function kachelFuerStapel(kachel: number, stapelBrauchbar: boolean): number {
  return stapelBrauchbar ? kachel : (KACHEL_RUECKFALL[kachel] ?? kachel);
}

/** Biome-Enum-Wert → Tile (Biome aus shared/types.ts). */
export const BIOME_TILE: Record<number, number> = {
  1: TILE.Grass, // Meadows
  2: TILE.SwampMud, // Swamp
  4: TILE.Rock, // Mountain
  8: TILE.Forest, // BlackForest
  16: TILE.Heath, // Plains
  32: TILE.Ash, // AshLands
  64: TILE.Rock, // DeepNorth (+ Schnee)
  128: TILE.GreyGrass, // Greyglen: eigene Grundkachel
  256: TILE.Sand, // Ocean
  512: TILE.Moss, // Mistlands
};

/**
 * Die Steigungsrampe des Vorbilds, übersetzt auf unsere Tiles.
 *
 * Im Dorf ist die Kanalzuordnung eine reine Steigungsrampe (Analyse §2):
 * Gras unter 15°, Moos/Kies zwischen 15° und 30°, Fels ab ~35°, rauer
 * Fels ab ~65°; Kies nur auf Wegen. Welche GRADZAHLEN bei uns gelten,
 * steht in `RAMPEN`; welche KACHEL welche Stufe zeigt, in dieser Tabelle
 * und in `FELS_TILE`/`RAU_TILE`.
 *
 * Sie hängen am BIOM, nicht an einer neuen Vertexgrösse: Welche Kachel
 * ein Hang trägt, sagt bereits das dominante Eck-Tile des Pixels. Ein
 * weiteres Vertex-Attribut hätte eine weitere Varying-Location gekostet,
 * und davon sind unter WebGPU nur 16 erlaubt — der Kommentar bei
 * `terrainMarker` erzählt, was das letzte Mal passiert ist.
 *
 * Gelesen als „Biom-Grundkachel → Kachel des mittleren Hangs":
 *  Grasland → Moos, Schwarzwald → Fels A, Sumpf → Kies dunkel,
 *  Heide/Sand → Erde, Asche → Basalt. Fels bleibt Fels.
 */
export const HANG_TILE: readonly number[] = [
  /*  0 Grass     */ TILE.Moss,
  /*  1 Forest    */ TILE.Rock,
  /*  2 Dirt      */ TILE.Dirt,
  /*  3 Cleared   */ TILE.Cleared,
  /*  4 Rock      */ TILE.Rock,
  /*  5 Cliff     */ TILE.Cliff,
  /*  6 LavaEmber */ TILE.Basalt,
  /*  7 Ash       */ TILE.Basalt,
  /*  8 Heath     */ TILE.Dirt,
  /*  9 Sand      */ TILE.Dirt,
  /* 10 SwampMud  */ TILE.SwampDark,
  /* 11 Moss      */ TILE.Rock,
  /* 12 Paved     */ TILE.Paved,
  /* 13 SwampDark */ TILE.SwampDark,
  /* 14 Basalt    */ TILE.Basalt,
  /* 15 LavaCrust */ TILE.Basalt,
  /* 16 GreyGrass    */ TILE.GreyMoss,
  /* 17 GreyMoss     */ TILE.GreyMoss,
  /* 18 GreyRock     */ TILE.GreyRock,
  /* 19 GreyRockMoss */ TILE.GreyRockMoss,
];

/**
 * Kachel des MITTLEREN Fels — die Stufe zwischen Hangkachel und Klippe.
 *
 * Sie stand bis zum 09.09.2026 als eine Zeile in `Terrain.ts`
 * (`biome === AshLands ? Basalt : Rock`) und war damit die einzige der
 * drei Stufen ohne Tabelle. Das war kein Schönheitsfehler: Tile 4
 * (`Rock`) ist im Speicher `terrain-rock-a`, und das ist im Original die
 * Schicht **„Ani Dark Rockwall"** — nachgelesen in
 * `~/wov-assets/Assets/TerrainLayer/Ani Dark Rockwall.json`: Metallic
 * 0,85, Glätte 0,1, Kachel 2 m. Ihre Farbtextur liegt zwischen sRGB 23
 * und 49 (p50 38, Maximum 49); sie ist die DUNKLE Wand, kein heller
 * Fels. Mit Metallic 0,85 ist ihr F₀ die eigene, dunkle Albedo — eine
 * Schicht, die 2 % des Himmels spiegelt und 15 % ihrer eigenen, dunklen
 * Farbe diffus zeigt. Gemessen am 48°-Hang um 17 Uhr: Luma 25, während
 * die Wiese daneben bei 55 steht. Genau das ist Mikes Befund „ich lese
 * sie als Erde".
 *
 * Der helle Fels des Zielbildes ist die ANDERE Schicht:
 * `Terrain_Meadow_Rock_Rough_01` (Metallic **0**, Glätte 0, Normale 5,
 * Kachel 3 m) = `terrain-rock-rough`, Farbtextur sRGB 115–152. Sie
 * hängt bei uns an Tile 5 (`Cliff`) und ist die Kachel von `RAU_TILE`.
 *
 * Daraus die Zuordnung: Wo das Vorbild helle Steilhänge zeigt
 * (Grasland, Heide, Sand, Mistlands), trägt schon die MITTLERE Stufe die
 * helle raue Schicht — der dunkle Zwischenring wäre sonst ein Band aus
 * Erde quer über jeden Hügel. Wo dunkler Fels gewollt ist
 * (Schwarzwald, Sumpf, Berg/Tiefer Norden), bleibt es bei `Rock`; in der
 * Asche bei `Basalt`.
 */
export const FELS_TILE: readonly number[] = [
  /*  0 Grass     */ TILE.Rock,
  /*  1 Forest    */ TILE.Rock,
  /*  2 Dirt      */ TILE.Rock,
  /*  3 Cleared   */ TILE.Rock,
  /*  4 Rock      */ TILE.Rock,
  /*  5 Cliff     */ TILE.Cliff,
  /*  6 LavaEmber */ TILE.Basalt,
  /*  7 Ash       */ TILE.Basalt,
  /*  8 Heath     */ TILE.Cliff,
  /*  9 Sand      */ TILE.Cliff,
  /* 10 SwampMud  */ TILE.Rock,
  /* 11 Moss      */ TILE.Cliff,
  /* 12 Paved     */ TILE.Rock,
  /* 13 SwampDark */ TILE.Rock,
  /* 14 Basalt    */ TILE.Basalt,
  /* 15 LavaCrust */ TILE.Basalt,
  /* 16 GreyGrass    */ TILE.GreyRock,
  /* 17 GreyMoss     */ TILE.GreyRock,
  /* 18 GreyRock     */ TILE.GreyRock,
  /* 19 GreyRockMoss */ TILE.GreyRockMoss,
];

/**
 * Kachel des STEILSTEN Hangs — die Wand, die eine Geländebearbeitung
 * stehen lässt.
 *
 * Bis zum 09.09.2026 stand hier „überall Klippe, in der Asche Basalt".
 * Das war die Zeile, die im Schwarzwald sandsteinfarbene Steilhänge
 * gemacht hat: Tile 5 (`Cliff` = `terrain-rock-rough`) ist der HELLE
 * Fels des Bergpanoramas (Farbtextur sRGB 115–152, `design/look-referenz.md`
 * Bild 3, Luma 104), und der stand ab 40° quer über jeder dunklen
 * Waldflanke. Die Look-Referenz sagt es selbst, unter „die Falle, an
 * der der erste Anlauf hängengeblieben ist": Wer `rock-a` am steilsten
 * Hang misst, misst in Wahrheit die Cliff-Zeile.
 *
 * Jetzt folgt die Tabelle derselben Entscheidung wie `FELS_TILE`: Wo
 * DUNKLER Fels gewollt ist, bleibt es auch auf der Wand dunkel.
 *
 *   Schwarzwald (Tile 1)          Cliff → Rock — der gemeldete Sandstein
 *   Sumpf (Tile 10, 13)           Cliff → Rock — dieselbe Begründung
 *   Berg/Tiefer Norden (Tile 4)   bleibt Cliff, siehe unten
 *   Grasland/Heide/Sand/Mistlands bleibt Cliff (hell; Bild 3:
 *     (Tile 0, 8, 9, 11)          Hangfels/Moos = 1,60)
 *
 * ── Warum Berg und Tiefer Norden NICHT mitziehen ────────────────────
 * Ihre GRUNDkachel ist bereits `Rock` (`BIOME_TILE[4]` und `[64]`).
 * Stünde hier ebenfalls `Rock`, zeigte das Biom auf flachem Grund, am
 * mittleren und am steilsten Hang dieselbe Kachel — es gäbe dort gar
 * keinen rauen Fels mehr. `tools/test/terrain-schichten.ts` prüft genau
 * das („steiler Hang zeigt dieselbe Kachel wie flacher Grund"), und die
 * Look-Referenz stützt es: Das Bergpanorama ist der Beleg FÜR den
 * hellen Fels, nicht gegen ihn.
 *
 * Damit unterscheidet sich diese Tabelle von `FELS_TILE` nur noch in
 * den Zeilen 2, 3, 4 und 12 (Dirt, Cleared, Rock, Paved). Drei davon
 * sind Mal-Kacheln und können nie Grundkachel eines Bioms sein
 * (`BIOME_TILE` zeigt auf keine von ihnen), die vierte ist der Berg.
 * Für alle übrigen Biome liegt der Unterschied zwischen den beiden
 * Felsstufen jetzt nicht mehr in der KACHEL, sondern in der DECKUNG:
 * `fels` kommt über `RAMPEN.fels.anteil` nur auf 0,85, `rau` deckt voll.
 */
export const RAU_TILE: readonly number[] = [
  /*  0 Grass     */ TILE.Cliff,
  /*  1 Forest    */ TILE.Rock,
  /*  2 Dirt      */ TILE.Cliff,
  /*  3 Cleared   */ TILE.Cliff,
  /*  4 Rock      */ TILE.Cliff,
  /*  5 Cliff     */ TILE.Cliff,
  /*  6 LavaEmber */ TILE.Basalt,
  /*  7 Ash       */ TILE.Basalt,
  /*  8 Heath     */ TILE.Cliff,
  /*  9 Sand      */ TILE.Cliff,
  /* 10 SwampMud  */ TILE.Rock,
  /* 11 Moss      */ TILE.Cliff,
  /* 12 Paved     */ TILE.Cliff,
  /* 13 SwampDark */ TILE.Rock,
  /* 14 Basalt    */ TILE.Basalt,
  /* 15 LavaCrust */ TILE.Basalt,
  /* 16 GreyGrass    */ TILE.GreyRockMoss,
  /* 17 GreyMoss     */ TILE.GreyRockMoss,
  /* 18 GreyRock     */ TILE.GreyRockMoss,
  /* 19 GreyRockMoss */ TILE.GreyRockMoss,
];

/**
 * Die übrigen Regelwerte der Bodenschichtung, die Shader UND CPU brauchen
 * (Sandband, Schnee, Lava). Vorher standen sie als Literale im Shaderbau
 * (`TerrainSplat.ts`) und in `Terrain.ts`.
 *
 * Numbers of the ground layering shared by shader and CPU mix.
 */
export const BODEN_REGELN = {
  /** Sand: keine Deckung ab dieser Höhe über dem Wasserspiegel … */
  sandUeberWasser: 2.5,
  /** … und voll (mal `sandAnteil`) `sandSpanne` m darunter. */
  sandSpanne: 3,
  sandAnteil: 0.8,
  /** Schnee im Gebirge ab dieser Höhe, in `schneeAnstieg` m auf voll. */
  schneeLinie: 80,
  schneeAnstieg: 20,
  /** Tiefer Norden: fester Schneeanteil. */
  schneeTiefNord: 0.9,
  /** Schnee nur auf flachen Stellen: Smoothstep über `ny` zwischen diesen Kanten. */
  schneeNyKante0: 0.4,
  schneeNyKante1: 0.65,
  /** Höchste Deckung der Lavakruste. */
  lavaAnteil: 0.9,
} as const;
