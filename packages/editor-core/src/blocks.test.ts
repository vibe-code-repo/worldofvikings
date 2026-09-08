import { describe, expect, it } from 'vitest';
import type { LightingProfile, SoundProfile, TerrainDefinition } from '@wov/world-schema';
import {
  applyCommand,
  setLighting,
  setLightingField,
  setSound,
  setSoundField,
  setTerrain,
  setTerrainField,
  type EditorCommand,
} from './commands.js';
import { createDocument, type EditorDocument } from './document.js';
import { LIGHTING_PRESETS } from './lighting-presets.js';
import {
  lightingAt,
  soundAt,
  worldLighting,
  worldSound,
  zoneLighting,
  zoneSound,
} from './blocks.js';
import { villageWorld } from './test-support.js';

const ground: TerrainDefinition = {
  heightField: 'terrain/village-257.glb',
  position: [0, 0, 0],
  size: [300, 300],
  layers: [
    { texture: 'textures/grass.png', tileSize: 2 },
    { texture: 'textures/rock.png', tileSize: 3 },
  ],
  splat: ['textures/splat-a.png'],
};

const evening: LightingProfile = {
  sun: { direction: [0.58, -0.45, 0.68], color: '#ffd2a1', intensity: 2.3 },
  fog: { enabled: true, start: 80, end: 420 },
};

function lit(): EditorDocument {
  const world = villageWorld();
  return createDocument({
    ...world,
    lighting: evening,
    zones: world.zones.map((zone) => ({ ...zone, terrain: ground })),
  });
}

function apply(source: EditorDocument, command: EditorCommand): EditorDocument {
  const result = applyCommand(source, command);
  if (!result.ok) {
    throw new Error(`command failed: ${result.error}`);
  }
  return result.value.document;
}

/** Applying a command and then its inverse must restore the world exactly. */
function expectRoundtrip(source: EditorDocument, command: EditorCommand): void {
  const result = applyCommand(source, command);
  if (!result.ok) {
    throw new Error(`command failed: ${result.error}`);
  }
  const back = apply(result.value.document, result.value.inverse);
  expect(back.world).toEqual(source.world);
}

describe('setLighting', () => {
  it('changes one field and leaves the rest of the profile alone', () => {
    const next = apply(lit(), setLightingField(worldLighting(), ['sun', 'intensity'], 4));
    expect(next.world.lighting?.sun).toEqual({
      direction: [0.58, -0.45, 0.68],
      color: '#ffd2a1',
      intensity: 4,
    });
    expect(next.world.lighting?.fog).toEqual(evening.fog);
    expect(next.dirty).toBe(true);
  });

  it('writes a profile onto a world that had none', () => {
    const document = createDocument(villageWorld());
    const next = apply(document, setLightingField(worldLighting(), ['fog', 'end'], 200));
    expect(next.world.lighting).toEqual({ fog: { end: 200 } });
  });

  it('keeps `lighting` in front of `zones`, which is where a reader finds it', () => {
    const document = createDocument(villageWorld());
    const next = apply(document, setLightingField(worldLighting(), ['fog', 'end'], 200));
    expect(Object.keys(next.world)).toEqual(['schemaVersion', 'id', 'name', 'lighting', 'zones']);
  });

  it('overrides a world profile per zone', () => {
    const next = apply(lit(), setLightingField(zoneLighting('village'), ['fog', 'end'], 60));
    expect(lightingAt(next.world, zoneLighting('village'))).toEqual({ fog: { end: 60 } });
    // The world's own profile is untouched: a zone overrides, it does not move.
    expect(next.world.lighting).toEqual(evening);
  });

  it('refuses a value the schema does not accept, and changes nothing', () => {
    const document = lit();
    const result = applyCommand(
      document,
      setLightingField(worldLighting(), ['sun', 'color'], 'red'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('sun.color');
    }
  });

  it('refuses a zone that does not exist', () => {
    const result = applyCommand(
      lit(),
      setLightingField(zoneLighting('nowhere'), ['fog', 'end'], 10),
    );
    expect(result).toEqual({ ok: false, error: 'unknown zone "nowhere"' });
  });

  it('undoes back to the exact profile, including having had none', () => {
    expectRoundtrip(lit(), setLightingField(worldLighting(), ['sun', 'intensity'], 4));
    expectRoundtrip(
      createDocument(villageWorld()),
      setLightingField(worldLighting(), ['fog', 'end'], 200),
    );
    expectRoundtrip(lit(), setLighting(worldLighting(), [{ path: [], value: null }]));
  });

  it('applies a preset as one command over the whole profile', () => {
    const preset = LIGHTING_PRESETS[0];
    if (preset === undefined) {
      throw new Error('there should be presets');
    }
    const document = createDocument(villageWorld());
    const next = apply(
      document,
      setLighting(worldLighting(), [{ path: [], value: preset.profile }]),
    );
    expect(next.world.lighting).toEqual(preset.profile);
    expectRoundtrip(document, setLighting(worldLighting(), [{ path: [], value: preset.profile }]));
  });

  it('accepts every shipped preset, which is what makes them presets', () => {
    for (const preset of LIGHTING_PRESETS) {
      const result = applyCommand(
        createDocument(villageWorld()),
        setLighting(worldLighting(), [{ path: [], value: preset.profile }]),
      );
      expect(result.ok, `${preset.id}: ${result.ok ? '' : result.error}`).toBe(true);
    }
  });
});

describe('setTerrain', () => {
  it('changes one layer without touching the others', () => {
    const next = apply(lit(), setTerrainField('village', ['layers', '1', 'tileSize'], 5));
    expect(next.world.zones[0]?.terrain?.layers).toEqual([
      { texture: 'textures/grass.png', tileSize: 2 },
      { texture: 'textures/rock.png', tileSize: 5 },
    ]);
  });

  it('reorders the layer list as one command', () => {
    const reordered = [ground.layers?.[1], ground.layers?.[0]];
    const next = apply(lit(), setTerrainField('village', ['layers'], reordered));
    expect(next.world.zones[0]?.terrain?.layers?.map((layer) => layer.texture)).toEqual([
      'textures/rock.png',
      'textures/grass.png',
    ]);
  });

  it('undoes a reorder back to the original order', () => {
    const reordered = [ground.layers?.[1], ground.layers?.[0]];
    expectRoundtrip(lit(), setTerrainField('village', ['layers'], reordered));
  });

  it('takes the ground away and puts it back', () => {
    const document = lit();
    const next = apply(document, setTerrain('village', [{ path: [], value: null }]));
    expect(next.world.zones[0]?.terrain).toBeUndefined();
    expect('terrain' in (next.world.zones[0] ?? {})).toBe(false);
    expectRoundtrip(document, setTerrain('village', [{ path: [], value: null }]));
  });

  /**
   * The rule the schema states and the panel must not be able to break: a
   * second layer with no splat map would be drawn at full strength over
   * everything under it.
   */
  it('refuses a layer list the splat maps cannot weight', () => {
    const many = [
      ...(ground.layers ?? []),
      { texture: 'textures/moss.png', tileSize: 2 },
      { texture: 'textures/sand.png', tileSize: 2 },
      { texture: 'textures/gravel.png', tileSize: 2 },
    ];
    const result = applyCommand(lit(), setTerrainField('village', ['layers'], many));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('splat map');
    }
  });

  it('refuses a zone that does not exist', () => {
    const result = applyCommand(lit(), setTerrainField('nowhere', ['size'], [10, 10]));
    expect(result).toEqual({ ok: false, error: 'unknown zone "nowhere"' });
  });
});

const village: SoundProfile = {
  master: { volume: 0.8 },
  ambience: { enabled: true, clip: 'audio/ambience/wind.ogg', volume: 0.35 },
  emitters: [
    { id: 'fires', prefab: 'camp-brazier-01', clip: 'audio/emitters/fire.ogg', loop: true },
  ],
};

function audible(): EditorDocument {
  return createDocument({ ...villageWorld(), sound: village });
}

describe('setSound', () => {
  it('changes one field and leaves the rest of the profile alone', () => {
    const next = apply(audible(), setSoundField(worldSound(), ['ambience', 'volume'], 0.5));
    const profile = soundAt(next.world, worldSound());
    expect(profile?.ambience?.volume).toBe(0.5);
    expect(profile?.ambience?.clip).toBe('audio/ambience/wind.ogg');
    expect(profile?.master?.volume).toBe(0.8);
  });

  it('creates a zone profile on a zone that had none, and undo removes the block', () => {
    const document = audible();
    const scope = zoneSound('village');
    expect(soundAt(document.world, scope)).toBeUndefined();
    const next = apply(document, setSoundField(scope, ['ambience', 'clip'], 'audio/a/cave.ogg'));
    expect(soundAt(next.world, scope)?.ambience?.clip).toBe('audio/a/cave.ogg');
    expectRoundtrip(document, setSoundField(scope, ['ambience', 'clip'], 'audio/a/cave.ogg'));
  });

  it('writes the sound block in front of the zones, where a person will find it', () => {
    const next = apply(
      createDocument(villageWorld()),
      setSoundField(worldSound(), ['cullDistance'], 40),
    );
    const keys = Object.keys(next.world);
    expect(keys.indexOf('sound')).toBeLessThan(keys.indexOf('zones'));
  });

  it('refuses a value the schema refuses, and leaves the document untouched', () => {
    const document = audible();
    // Two anchors: the emitter schema demands exactly one.
    const broken = applyCommand(
      document,
      setSound(worldSound(), [{ path: ['emitters', '0', 'entity'], value: 'barrel_001' }]),
    );
    expect(broken.ok).toBe(false);
    if (broken.ok) {
      return;
    }
    expect(broken.error).toContain('exactly one');
  });

  it('refuses a duplicate emitter id', () => {
    const document = audible();
    const broken = applyCommand(
      document,
      setSound(worldSound(), [
        {
          path: ['emitters'],
          value: [
            { id: 'fires', prefab: 'camp-brazier-01', clip: 'audio/emitters/fire.ogg' },
            { id: 'fires', prefab: 'well-01', clip: 'audio/emitters/fire.ogg' },
          ],
        },
      ]),
    );
    expect(broken.ok).toBe(false);
  });

  it('is undoable field by field and block by block', () => {
    const document = audible();
    expectRoundtrip(document, setSoundField(worldSound(), ['master', 'volume'], 0.2));
    expectRoundtrip(document, setSound(worldSound(), [{ path: [], value: null }]));
  });
});
