/** Curated starting-village palette; compatible with existing grassland world bits. */
export const VILLAGE_VEGETATION = [
  'vegetation-tree-1e2', 'vegetation-tree-1c3', 'vegetation-tree-1b1',
  'vegetation-tree-1d1', 'vegetation-tree-1c1',
  'vegetation-small-thin-tree-1a3', 'vegetation-small-thin-tree-1a2',
  'vegetation-small-thin-tree-1a5',
  'vegetation-large-bush-1a5', 'vegetation-large-bush-1a1',
  'vegetation-large-bush-1a2', 'vegetation-large-bush-1a3',
  'vegetation-bush-1a1-small', 'vegetation-bush-1a1',
  'vegetation-bush-1a2', 'vegetation-bush-1a3',
  'environment-sm-env-rock-cliff-02-1', 'environment-sm-env-rock-cliff-03-1',
  'environment-sm-env-rock-cliff-01', 'environment-sm-env-rock-cliff-05',
  'environment-sm-env-rock-chunk-01', 'environment-sm-env-rock-chunk-02',
  'environment-sm-env-rock-chunk-03-1', 'environment-sm-env-rock-round-01',
  'environment-sm-env-rock-round-03', 'environment-sm-env-rock-round-04',
] as const;
export const VILLAGE_REGION = {
  biome: 'grassland' as const, tier: 0, edgeFalloff: 300,
  vegetation: VILLAGE_VEGETATION,
  forestDensity: 0.9, bewuchsDichte: 1.0, waldKoernung: 0.8,
  abstandFaktor: 1.0, nester: 0,
};
