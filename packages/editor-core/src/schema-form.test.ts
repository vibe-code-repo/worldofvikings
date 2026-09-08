import { describe, expect, it } from 'vitest';
import {
  LightingProfileSchema,
  TerrainDefinitionSchema,
  TerrainLayerSchema,
} from '@wov/world-schema';
import {
  describeFields,
  fieldPaths,
  fieldsCommandedBy,
  humanizeKey,
  type FormField,
} from './schema-form.js';
import { SOUND_EMITTER_FIELDS, SOUND_FIELDS } from './world-forms.js';

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

  /**
   * The fog controls, which ADR-0041 added. `mode` has to come out a choice or
   * the panel draws a text box for it, and `density` has to come out with a step
   * inside its own range: a 0…0.005 field on a step of 0.01 is a control with
   * two positions, off and past the end.
   */
  it('draws the fog curve as a choice and its density with a step it can reach', () => {
    const fog = find(fields, 'fog');
    if (fog.kind !== 'group') {
      throw new Error('fog should be a group');
    }
    expect(find(fog.fields, 'mode')).toMatchObject({
      kind: 'choice',
      options: ['linear', 'exp'],
    });
    expect(find(fog.fields, 'density')).toMatchObject({
      kind: 'number',
      minimum: 0,
      maximum: 0.005,
      step: 0.0001,
    });
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
    expect(paths).toContain('sky.groundReflection');
    expect(paths).toContain('postProcessing.saturation');
    expect(paths).toContain('fog.mode');
    expect(paths).toContain('fog.density');
    expect(paths).toContain('postProcessing.sunShafts.enabled');
    expect(paths).toContain('postProcessing.sunShafts.maxAngleDegrees');
    expect(paths).toContain('postProcessing.sunShafts.anchorDistance');
    expect(paths).toHaveLength(56);
  });
});

describe('describeFields on the terrain block', () => {
  const fields = describeFields(TerrainDefinitionSchema);

  it('describes the block a zone stores', () => {
    expect(fields.map((field) => field.key)).toEqual([
      'heightField',
      'heightSamples',
      'position',
      'size',
      'layers',
      'splat',
      'flatNormals',
    ]);
    expect(find(fields, 'heightField')).toMatchObject({
      kind: 'asset',
      asset: 'terrain',
      required: true,
    });
    expect(find(fields, 'position')).toMatchObject({ kind: 'vector', length: 3 });
    expect(find(fields, 'size')).toMatchObject({ kind: 'vector', length: 2, minimum: 0 });
  });

  /**
   * The annotation is what lets the panel offer the asset store's own images
   * for a ground texture instead of a bare text box — and it comes from the
   * schema, so `apps/editor` holds no list of which fields are paths.
   */
  it('says which kind of asset a path field names', () => {
    const layers = find(fields, 'layers');
    if (layers.kind !== 'list' || layers.item.kind !== 'group') {
      throw new Error('layers should be a list of groups');
    }
    expect(find(layers.item.fields, 'texture')).toMatchObject({
      kind: 'asset',
      asset: 'texture',
    });
    const splat = find(fields, 'splat');
    if (splat.kind !== 'list') {
      throw new Error('splat should be a list');
    }
    expect(splat.item).toMatchObject({ kind: 'asset', asset: 'texture' });
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
    expect(layers.item.fields.map((field) => field.key)).toEqual([
      'texture',
      'tileSize',
      'normalMap',
      'normalScale',
      'metallic',
      'smoothness',
    ]);
  });

  it('describes the splat maps as a list of paths', () => {
    const splat = find(fields, 'splat');
    expect(splat).toMatchObject({ kind: 'list', minItems: 1, maxItems: 2 });
  });
});

/**
 * The reason this module exists (ADR-0033): a field added to the schema must
 * reach the panel without anybody editing `apps/editor`.
 *
 * This was written against a stand-in schema, because the fields it names did
 * not exist yet. They do now — ADR-0032 added the surface block to every
 * terrain layer — so the test asks the real schema instead. That is the
 * stronger claim: nobody edited a panel to make the four controls below
 * appear, and if `describeFields` ever stops recognising one of them, the
 * ground panel loses a control rather than a mock losing one.
 */
describe('a field added to a schema', () => {
  it('appears with its own type and range, with no change to the renderer', () => {
    const fields = describeFields(TerrainLayerSchema);
    expect(fields.map((field) => field.key)).toEqual([
      'texture',
      'tileSize',
      'normalMap',
      'normalScale',
      'metallic',
      'smoothness',
    ]);
    expect(find(fields, 'normalScale')).toMatchObject({
      kind: 'number',
      label: 'normal scale',
      minimum: 0,
      maximum: 8,
      required: false,
    });
    expect(find(fields, 'metallic')).toMatchObject({ kind: 'number', step: 0.01 });
    // And a new *path* field arrives with the picker, not a bare text box.
    expect(find(fields, 'normalMap')).toMatchObject({
      kind: 'asset',
      asset: 'texture',
      required: false,
    });
  });
});

/**
 * The sound panel is drawn from the schema like every other one (ADR-0033), so
 * these assertions are about the *contract between the schema and the panel*
 * and not about the panel: an audio path has to arrive as a picker of audio
 * rows, and the three anchor fields have to arrive marked, or the entity
 * inspector would have to keep a list of their names.
 */
describe('the sound profile as a form', () => {
  it('offers every clip field as an audio picker, however deep it sits', () => {
    const ambience = find(SOUND_FIELDS, 'ambience');
    if (ambience.kind !== 'group') {
      throw new Error('ambience is not a group');
    }
    expect(find(ambience.fields, 'clip')).toMatchObject({ kind: 'asset', asset: 'audio' });

    // …including the ones inside two lists: a bank's clips are a list of asset
    // paths inside a list of groups, which is the shape a hand-written panel
    // gets wrong first.
    const footsteps = find(SOUND_FIELDS, 'footsteps');
    if (footsteps.kind !== 'group') {
      throw new Error('footsteps is not a group');
    }
    const banks = find(footsteps.fields, 'banks');
    if (banks.kind !== 'list' || banks.item.kind !== 'group') {
      throw new Error('banks is not a list of groups');
    }
    const clips = find(banks.item.fields, 'clips');
    if (clips.kind !== 'list') {
      throw new Error('clips is not a list');
    }
    expect(clips.item).toMatchObject({ kind: 'asset', asset: 'audio' });
  });

  it('draws the footstep surface mapping as a list the panel can reorder', () => {
    const footsteps = find(SOUND_FIELDS, 'footsteps');
    if (footsteps.kind !== 'group') {
      throw new Error('footsteps is not a group');
    }
    // Order is the whole meaning: entry n answers terrain layer n (ADR-0063).
    expect(find(footsteps.fields, 'layerSurfaces')).toMatchObject({ kind: 'list' });
    expect(find(footsteps.fields, 'defaultSurface')).toMatchObject({ kind: 'text' });
  });

  it('marks the three emitter anchors, so the entity inspector can leave them out', () => {
    expect(
      fieldsCommandedBy(SOUND_EMITTER_FIELDS, 'emitterAnchor').map((each) => each.path),
    ).toEqual([['prefab'], ['entity'], ['position']]);
  });
});
