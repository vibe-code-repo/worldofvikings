import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LightingProfileSchema,
  TerrainDefinitionSchema,
  TerrainLayerSchema,
} from '@wov/world-schema';
import { describeFields, fieldPaths, humanizeKey, type FormField } from './schema-form.js';

function find(fields: readonly FormField[], key: string): FormField {
  const found = fields.find((field) => field.key === key);
  if (found === undefined) {
    throw new Error(`no field "${key}" in ${fields.map((field) => field.key).join(', ')}`);
  }
  return found;
}

describe('humanizeKey', () => {
  it('turns a schema key into a label', () => {
    expect(humanizeKey('sunSpread')).toBe('sun spread');
    expect(humanizeKey('normalScale')).toBe('normal scale');
    expect(humanizeKey('tileSize')).toBe('tile size');
    expect(humanizeKey('fog')).toBe('fog');
  });
});

describe('describeFields on the lighting profile', () => {
  const fields = describeFields(LightingProfileSchema);

  it('keeps the declaration order of the schema, which is the file order', () => {
    expect(fields.map((field) => field.key)).toEqual([
      'sun',
      'ambient',
      'sky',
      'fog',
      'shadows',
      'postProcessing',
    ]);
  });

  it('recognises a colour by the #rrggbb rule instead of by its name', () => {
    const sun = find(fields, 'sun');
    if (sun.kind !== 'group') {
      throw new Error('sun should be a group');
    }
    expect(find(sun.fields, 'color').kind).toBe('color');
  });

  it('carries the range a number is bounded by', () => {
    const shadows = find(fields, 'shadows');
    if (shadows.kind !== 'group') {
      throw new Error('shadows should be a group');
    }
    const darkness = find(shadows.fields, 'darkness');
    expect(darkness).toMatchObject({ kind: 'number', minimum: 0, maximum: 1, step: 0.01 });
    const mapSize = find(shadows.fields, 'mapSize');
    expect(mapSize).toMatchObject({ kind: 'number', integer: true, minimum: 256, maximum: 4096 });
  });

  it('offers the enum values as a choice', () => {
    const shadows = find(fields, 'shadows');
    if (shadows.kind !== 'group') {
      throw new Error('shadows should be a group');
    }
    expect(find(shadows.fields, 'filter')).toMatchObject({
      kind: 'choice',
      options: ['none', 'poisson', 'pcf'],
    });
  });

  it('sees a direction as one vector, not three numbers', () => {
    const sun = find(fields, 'sun');
    if (sun.kind !== 'group') {
      throw new Error('sun should be a group');
    }
    expect(find(sun.fields, 'direction')).toMatchObject({ kind: 'vector', length: 3 });
  });

  it('descends into a nested group', () => {
    const post = find(fields, 'postProcessing');
    if (post.kind !== 'group') {
      throw new Error('postProcessing should be a group');
    }
    const bloom = find(post.fields, 'bloom');
    if (bloom.kind !== 'group') {
      throw new Error('bloom should be a group');
    }
    expect(bloom.fields.map((field) => field.key)).toContain('threshold');
  });

  /**
   * The claim the whole panel rests on: every field the schema accepts has a
   * control. If this drifts, a value can be written into a world file that the
   * editor cannot show.
   */
  it('covers every leaf the schema declares', () => {
    const paths = fieldPaths(fields).map((path) => path.join('.'));
    expect(paths).toContain('sun.intensity');
    expect(paths).toContain('ambient.groundColor');
    expect(paths).toContain('sky.sunSpread');
    expect(paths).toContain('fog.start');
    expect(paths).toContain('shadows.normalBias');
    expect(paths).toContain('postProcessing.vignette.weight');
    expect(paths).toContain('postProcessing.ssao.samples');
    expect(paths).toHaveLength(40);
  });
});

describe('describeFields on the terrain block', () => {
  const fields = describeFields(TerrainDefinitionSchema);

  it('describes the block a zone stores', () => {
    expect(fields.map((field) => field.key)).toEqual([
      'heightField',
      'position',
      'size',
      'layers',
      'splat',
    ]);
    expect(find(fields, 'heightField')).toMatchObject({ kind: 'text', required: true });
    expect(find(fields, 'position')).toMatchObject({ kind: 'vector', length: 3 });
    expect(find(fields, 'size')).toMatchObject({ kind: 'vector', length: 2, minimum: 0 });
  });

  it('describes the layer list, including how many layers may exist', () => {
    const layers = find(fields, 'layers');
    if (layers.kind !== 'list') {
      throw new Error('layers should be a list');
    }
    expect(layers.maxItems).toBe(8);
    if (layers.item.kind !== 'group') {
      throw new Error('a layer should be a group');
    }
    expect(layers.item.fields.map((field) => field.key)).toEqual(['texture', 'tileSize']);
  });

  it('describes the splat maps as a list of paths', () => {
    const splat = find(fields, 'splat');
    expect(splat).toMatchObject({ kind: 'list', minItems: 1, maxItems: 2 });
  });
});

/**
 * The reason this module exists (ADR-0033): a field added to the schema must
 * reach the panel without anybody editing `apps/editor`. A stand-in for the
 * `normalScale`/`metallic`/`smoothness` fields the terrain work adds.
 */
describe('a field added to a schema', () => {
  it('appears with its own type and range, with no change to the renderer', () => {
    const grown = TerrainLayerSchema.extend({
      normalScale: z.number().min(0).max(5),
      metallic: z.number().min(0).max(1),
      smoothness: z.number().min(0).max(1),
      normalMap: z.string().min(1).optional(),
    });
    const fields = describeFields(grown);
    expect(fields.map((field) => field.key)).toEqual([
      'texture',
      'tileSize',
      'normalScale',
      'metallic',
      'smoothness',
      'normalMap',
    ]);
    expect(find(fields, 'normalScale')).toMatchObject({
      kind: 'number',
      label: 'normal scale',
      minimum: 0,
      maximum: 5,
      required: true,
    });
    expect(find(fields, 'metallic')).toMatchObject({ kind: 'number', step: 0.01 });
    expect(find(fields, 'normalMap')).toMatchObject({ kind: 'text', required: false });
  });
});
