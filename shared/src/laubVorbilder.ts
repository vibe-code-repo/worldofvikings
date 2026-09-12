/**
 * Welches Originalmaterial hinter welchem Laubmaterial steht.
 *
 * ERZEUGT von `tools/store-vegetation-aufbereiten.mjs` — nicht von Hand
 * bearbeiten. Der Schlüssel ist der Dateiname des Speichermodells ohne
 * Endung, darunter der Materialname, wie ihn die aufbereitete GLB führt.
 *
 * Gebraucht wird das, weil glTF nur EINEN `baseColorFactor` kennt: In
 * der Datei steht das Mittel aus Ober- und Unterfarbe, den Verlauf
 * dazwischen trägt der Client auf (`client/src/engine/LaubSpitzen.ts`),
 * und dafür braucht er den Namen des Vorbilds. Die Farben selbst stehen
 * in `shared/src/laubSpitzen.ts`.
 *
 * Generated: which original material each prepared foliage material
 * came from.
 */
export const LAUB_VORBILD_JE_MODELL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "branch-1a1": { "laub": "Leaves 1" },
  "branch-1a5": { "laub": "Leaves 1" },
  "branch-1a7": { "laub": "Leaves 1" },
  "branch-1a9": { "laub": "Leaves 1" },
  "branched-tree-2a1": { "laub": "Leaves 1" },
  "branched-tree-2a3": { "laub": "Leaves 1" },
  "bush-1a1": { "laub": "Leaves 2" },
  "bush-1a1-small": { "laub": "Leaves 2" },
  "bush-1a2": { "laub": "Leaves Birch 1" },
  "bush-1a2-small": { "laub": "Leaves Birch 1" },
  "bush-1a2-small-1-dark": { "laubDunkel": "Leaves Birch 3 Dark" },
  "bush-1a2-small-1-snow": { "laubSchnee": "Leaves Birch 3 Dark Snow" },
  "bush-1a3": { "laub": "Leaves 1" },
  "large-bush-1a1": { "laub": "Leaves 1" },
  "large-bush-1a2": { "laub": "Leaves 2" },
  "large-bush-1a3": { "laub": "Leaves Birch 2" },
  "large-bush-1a4": { "laub": "Leaves 2" },
  "large-bush-1a5": { "laub": "Leaves Birch 1" },
  "massive-tree-1a1": { "laub": "Leaves 1" },
  "massive-tree-1a1-1-dark": { "laubDunkel": "Leaves Birch 3 Dark" },
  "massive-tree-1a1-lod-1": { "laub": "Leaves 1" },
  "massive-tree-1a2": { "laub": "Leaves 1" },
  "massive-tree-1a2-1-dark": { "laubDunkel": "Leaves Birch 3 Dark" },
  "massive-tree-1a2-lod-1": { "laub": "Leaves 1" },
  "massive-tree-1a3": { "laub": "Leaves 1" },
  "massive-tree-1a3-1-dark": { "laubDunkel": "Leaves Birch 3 Dark" },
  "massive-tree-1a3-lod-1": { "laub": "Leaves 1" },
  "pine-1b1": { "nadeln": "Pine 2" },
  "pine-1b1-0": { "nadeln": "Pine 1" },
  "pine-1b2": { "nadeln": "Pine 1" },
  "pine-1b3": { "nadeln": "Pine 1" },
  "pine-1b4": { "nadeln": "Pine 2" },
  "pine-1b4-0": { "nadeln": "Pine 1" },
  "pine-1b5": { "nadeln": "Pine 2" },
  "pine-1b5-0": { "nadeln": "Pine 1" },
  "small-thin-tree-1a2": { "laub": "Leaves 2" },
  "small-thin-tree-1a3": { "laub": "Leaves 2" },
  "small-thin-tree-1a5": { "laub": "Leaves Birch 1" },
  "split-tree-1a1": { "laub": "Leaves 1" },
  "split-tree-1a1-1-dark": { "laubDunkel": "Leaves Birch 3 Dark" },
  "split-tree-1a1-lod-1": { "laub": "Leaves 1" },
  "split-tree-1a2": { "laub": "Leaves 1" },
  "split-tree-1a2-1-dark": { "laubDunkel": "Leaves Birch 3 Dark" },
  "split-tree-1a2-lod-1": { "laub": "Leaves 1" },
  "split-tree-1a3": { "laub": "Leaves 1" },
  "split-tree-1a3-1-dark": { "laubDunkel": "Leaves Birch 3 Dark" },
  "split-tree-1a3-lod-1": { "laub": "Leaves 1" },
  "tree-1a3": { "laub": "Leaves Birch 1" },
  "tree-1b1": { "laub": "Leaves 3" },
  "tree-1b2": { "laub": "Leaves 2" },
  "tree-1b3": { "laub": "Leaves 1" },
  "tree-1c1": { "laub": "Leaves 1" },
  "tree-1c2": { "laub": "Leaves 1" },
  "tree-1c3": { "laub": "Leaves 1" },
  "tree-1d1": { "laub": "Leaves 2" },
  "tree-1d2": { "laub": "Leaves 2" },
  "tree-1e1": { "ahorn": "Maple Leaves 1" },
  "tree-1e2": { "ahorn": "Maple Leaves 1" },
};
