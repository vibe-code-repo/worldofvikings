/**
 * Biome names and biome tones of the map editor: the list of the biomes and
 * the colours the region list and the map overlay draw them in.
 *
 * Load order: `editorMain.ts` imports this module, so it is evaluated BEFORE the two
 * registry awaits at the top of `editorMain.ts`. Nothing here may read a registry
 * while the module loads; values are imported from `./design` only.
 */
import type { BiomeName } from '@wov/shared';
import { BIOM_TON, F } from './design';

const BIOME_NAMEN: BiomeName[] = [
  'grassland', 'blackforest', 'swamp', 'mountain', 'plains', 'mistlands', 'ashlands', 'deepnorth',
  'greyglen',
];
/**
 * Biomtöne — früher standen die acht Farbwerte hier als Literale und
 * wichen von denen der Kartenvorschau ab (dieselbe Insel war in der
 * Liste anders grün als auf der Karte). Jetzt sind es die Töne aus
 * `BIOM_TON`: `[0]` ist die FÜLLUNG (das Farbquadrat der Regionsliste),
 * `[1]` die KONTUR (der Strich im Karten-Overlay).
 *
 * `BIOME_FARBE` behält seinen Namen, weil `zeichneOverlay()` ihn
 * benutzt — dort ändert sich nur der Ton, nicht die Zeile.
 */
const biomTon = (b: BiomeName): readonly [string, string] => BIOM_TON[b] ?? [F.gedimmt3, F.gedimmt];
const BIOME_FARBE: Record<BiomeName, string> = Object.fromEntries(
  BIOME_NAMEN.map((b) => [b, biomTon(b)[1]])
) as Record<BiomeName, string>;

export { biomTon, BIOME_FARBE };
