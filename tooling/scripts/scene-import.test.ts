import { describe, expect, it } from 'vitest';
import type { Gltf, Matrix4 } from '../asset-pipeline/glb.js';
import { multiply, nodeMatrix } from '../asset-pipeline/glb.js';
import {
  DEFAULT_ZONES,
  MIRROR_X,
  compose,
  decompose,
  matchName,
  matchesRoot,
  mirrorX,
  nameCandidates,
  round,
  scanScene,
  toEntities,
  toKebab,
} from './scene-import.js';

describe('toKebab', () => {
  it('folds a bundle node name onto a store file stem', () => {
    expect(toKebab('SM_Env_StoneWall_01')).toBe('sm-env-stonewall-01');
    expect(toKebab('Small_Thin_Tree_1A3 (2)')).toBe('small-thin-tree-1a3-2');
    expect(toKebab('Tree_1B1.001')).toBe('tree-1b1');
  });

  it('never produces a leading or trailing separator', () => {
    expect(toKebab('  --Foo--  ')).toBe('foo');
  });
});

describe('nameCandidates', () => {
  it('tries the exact name before any shortened form', () => {
    const candidates = nameCandidates('SM_Prop_Log_02 1');
    expect(candidates[0]).toBe('sm-prop-log-02-1');
    expect(candidates).toContain('sm-prop-log-02');
    expect(candidates.indexOf('sm-prop-log-02-1')).toBeLessThan(
      candidates.indexOf('sm-prop-log-02'),
    );
  });

  it('drops a duplicate suffix in either spelling', () => {
    expect(nameCandidates('Bush_1A1 (12)')).toContain('bush-1a1');
    expect(nameCandidates('Bush_1A1 12')).toContain('bush-1a1');
  });

  it('finds the model name inside an authored prefix', () => {
    expect(nameCandidates('Roof_SM_Bld_Preset_Shelter_02')).toContain('sm-bld-preset-shelter-02');
  });

  it('drops a level-of-detail suffix', () => {
    expect(nameCandidates('Tree_1B1_LOD0')).toContain('tree-1b1');
  });

  it('lists every candidate once', () => {
    const candidates = nameCandidates('Cube');
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe('matchName', () => {
  const known = new Map([
    ['sm-prop-log-02', 'environment-sm-prop-log-02'],
    ['bush-1a1', 'vegetation-bush-1a1'],
  ]);

  it('maps a duplicated instance back onto its model', () => {
    expect(matchName('Bush_1A1 (7)', known)).toBe('vegetation-bush-1a1');
  });

  it('answers null instead of guessing', () => {
    expect(matchName('Floor', known)).toBeNull();
  });
});

describe('mirrorX', () => {
  it('is the documented rule: x negates, the quaternion turns (x,-y,-z,w)', () => {
    // A quaternion with all four components non-zero, so every sign is tested,
    // and a translation and a non-uniform scale on top of it.
    const quaternion = [0.2, 0.3, 0.4, Math.sqrt(1 - 0.04 - 0.09 - 0.16)];
    const source = nodeMatrix({
      translation: [3, 5, 7],
      rotation: quaternion,
      scale: [1, 2, 3],
    });

    const expected = nodeMatrix({
      translation: [-3, 5, 7],
      rotation: [
        quaternion[0] ?? 0,
        -(quaternion[1] ?? 0),
        -(quaternion[2] ?? 0),
        quaternion[3] ?? 1,
      ],
      scale: [1, 2, 3],
    });

    for (const [index, value] of mirrorX(source).entries()) {
      expect(value).toBeCloseTo(expected[index] ?? 0, 10);
    }
  });

  it('is its own inverse', () => {
    const source = nodeMatrix({
      translation: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3, 0.927],
      scale: [2, 2, 2],
    });
    for (const [index, value] of mirrorX(mirrorX(source)).entries()) {
      expect(value).toBeCloseTo(source[index] ?? 0, 10);
    }
  });

  it('leaves the determinant sign alone, so a mirrored prop stays mirrored', () => {
    const mirrored = multiply(MIRROR_X, nodeMatrix({ scale: [1, 1, 1] }));
    expect(decompose(mirrorX(mirrored)).scale[0]).toBeLessThan(0);
  });
});

describe('decompose', () => {
  /** Every rotation below must survive `compose(decompose(m)) === m`. */
  const angles: [number, number, number][] = [
    [0, 0, 0],
    [0, Math.PI / 2, 0],
    [0.3, -1.2, 2.4],
    [-0.9, 3.0, -0.4],
    [Math.PI / 2, 0.7, 0], // straight up: the gimbal case
    [-Math.PI / 2, -2.1, 0],
  ];

  it.each(angles)('round-trips the Babylon YXZ order (%s, %s, %s)', (x, y, z) => {
    const source = compose({ position: [1.5, -2.5, 3.5], rotation: [x, y, z], scale: [2, 3, 4] });
    const back = compose(decompose(source));
    for (const [index, value] of back.entries()) {
      expect(value).toBeCloseTo(source[index] ?? 0, 8);
    }
  });

  it('round-trips a mirrored transform, negative scale and all', () => {
    const source = compose({
      position: [10, 0, -4],
      rotation: [0.2, 1.1, -0.6],
      scale: [-1.5, 2, 0.5],
    });
    const result = decompose(source);
    expect(result.scale[0]).toBeLessThan(0);
    for (const [index, value] of compose(result).entries()) {
      expect(value).toBeCloseTo(source[index] ?? 0, 8);
    }
  });

  it('reads a pure yaw as a y rotation and nothing else', () => {
    const source = compose({ position: [0, 0, 0], rotation: [0, 1.0, 0], scale: [1, 1, 1] });
    const result = decompose(source);
    expect(result.rotation[0]).toBeCloseTo(0, 10);
    expect(result.rotation[1]).toBeCloseTo(1.0, 10);
    expect(result.rotation[2]).toBeCloseTo(0, 10);
  });

  it('keeps a non-uniform scale as three separate numbers', () => {
    const source = compose({ position: [0, 0, 0], rotation: [0, 0.5, 0], scale: [1, 4, 9] });
    const result = decompose(source);
    expect(result.scale[0]).toBeCloseTo(1, 8);
    expect(result.scale[1]).toBeCloseTo(4, 8);
    expect(result.scale[2]).toBeCloseTo(9, 8);
  });
});

describe('round', () => {
  it('writes zero as zero, never as minus zero', () => {
    expect(Object.is(round(-0.0001, 3), 0)).toBe(true);
  });

  it('keeps the requested number of digits', () => {
    expect(round(1.23456789, 3)).toBe(1.235);
  });
});

describe('matchesRoot', () => {
  it('matches a nested path exactly', () => {
    expect(matchesRoot(['Village', 'Village1'], 'Village/Village1')).toBe(true);
    expect(matchesRoot(['Village'], 'Village/Village1')).toBe(false);
    expect(matchesRoot(['Village', 'Village1', 'House'], 'Village/Village1')).toBe(false);
  });

  it('matches a trailing star as a name prefix', () => {
    expect(matchesRoot(['Chest for Player'], 'Chest*')).toBe(true);
    expect(matchesRoot(['Chair'], 'Chest*')).toBe(false);
  });
});

// --------------------------------------------------------------- scanning

/**
 * A miniature bundle in the shape the real one has: a world-building root with
 * a container, a recognised model with children, an unrecognised mesh, a
 * collision box, and a root that is not world data at all.
 */
function bundle(): Gltf {
  const box = { attributes: { POSITION: 0 }, indices: 1 };
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 7, 9] }],
    nodes: [
      { name: 'Village', children: [1] }, // 0
      { name: 'Village1', children: [2, 4, 5, 6] }, // 1
      { name: 'SM_Env_StoneWall_01 (3)', translation: [4, 0, 0], children: [3] }, // 2
      { name: 'SubMesh_0', mesh: 0 }, // 3
      { name: 'Floor', mesh: 0 }, // 4  — unrecognised, but it draws
      { name: 'Cube', mesh: 1 }, // 5  — a collision box
      { name: 'Waypoint' }, // 6  — no mesh anywhere below
      { name: 'GameUI', children: [8] }, // 7  — not world data
      { name: 'Button', mesh: 0 }, // 8
      { name: 'Chest for Player', mesh: 0 }, // 9
    ],
    meshes: [{ primitives: [{ ...box, material: 0 }] }, { primitives: [{ ...box, material: 1 }] }],
    materials: [
      { name: 'Village_Material', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: 'Cube', pbrMetallicRoughness: {} },
    ],
    // 36 indices = 12 triangles, which is what makes mesh 1 a helper box.
    accessors: [
      { componentType: 5126, count: 24, type: 'VEC3' },
      { componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
}

const prefabsByStem = new Map([
  ['sm-env-stonewall-01', 'environment-sm-env-stonewall-01'],
  ['chest-for-player', 'environment-chest-for-player'],
]);

describe('scanScene', () => {
  const scan = scanScene(bundle(), { zones: DEFAULT_ZONES, prefabsByStem });

  it('takes the highest recognised node as one instance and stops there', () => {
    expect(scan.instances).toHaveLength(2);
    const wall = scan.instances.find((instance) => instance.node === 2);
    expect(wall?.prefab).toBe('environment-sm-env-stonewall-01');
    expect(wall?.zone).toBe('village');
    expect(wall?.path).toBe('Village/Village1/SM_Env_StoneWall_01 (3)');
    // The child mesh belongs to the wall, not to a second entity.
    expect(scan.instances.some((instance) => instance.node === 3)).toBe(false);
  });

  it('claims a starred root for its zone', () => {
    expect(scan.instances.find((instance) => instance.node === 9)?.zone).toBe('surroundings');
  });

  it('reports an unrecognised mesh instead of dropping it', () => {
    expect(scan.misses.map((miss) => miss.name)).toEqual(['Floor']);
    expect(scan.misses[0]?.materials).toEqual(['Village_Material']);
    expect(scan.misses[0]?.triangles).toBe(12);
  });

  it('counts a textureless twelve-triangle box as a helper, not as scenery', () => {
    expect(scan.helpers).toBe(1);
  });

  it('names the roots it left out, with their weight', () => {
    expect(scan.ignoredRoots).toEqual([{ name: 'GameUI', meshNodes: 1 }]);
  });

  it('carries the world matrix, parent transforms included', () => {
    const wall = scan.instances.find((instance) => instance.node === 2);
    expect(wall?.matrix[12]).toBe(4);
  });
});

describe('toEntities', () => {
  it('numbers deterministically per prefab and mirrors x', () => {
    const scan = scanScene(bundle(), { zones: DEFAULT_ZONES, prefabsByStem });
    const counters = new Map<string, number>();
    const entities = toEntities(
      scan.instances.filter((instance) => instance.zone === 'village'),
      counters,
    );
    expect(entities).toEqual([
      {
        id: 'environment-sm-env-stonewall-01_0001',
        prefab: 'environment-sm-env-stonewall-01',
        position: [-4, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]);
  });

  it('keeps counting across zones so an id is unique in the world', () => {
    const counters = new Map<string, number>();
    const one: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const make = (node: number, zone: string) => ({
      node,
      name: 'x',
      path: 'x',
      zone,
      prefab: 'p',
      triangles: 0,
      matrix: one,
    });
    const first = toEntities([make(1, 'a')], counters);
    const second = toEntities([make(2, 'b')], counters);
    expect(first[0]?.id).toBe('p_0001');
    expect(second[0]?.id).toBe('p_0002');
  });
});
