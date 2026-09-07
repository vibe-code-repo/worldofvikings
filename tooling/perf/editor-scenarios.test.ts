import { describe, expect, it } from 'vitest';
import {
  DIAL_VALUES,
  EDITOR_SCENARIOS,
  dialValueAt,
  parseScenarios,
  type EditorPerfReport,
} from './editor-scenarios.js';

describe('parseScenarios', () => {
  it('runs everything when nothing was asked for', () => {
    expect(parseScenarios(undefined)).toEqual(EDITOR_SCENARIOS);
    expect(parseScenarios('all')).toEqual(EDITOR_SCENARIOS);
  });

  it('takes one name', () => {
    expect(parseScenarios('load')).toEqual(['load']);
  });

  it('takes a comma-separated list, in the rig order rather than the typed one', () => {
    expect(parseScenarios('edit,dial')).toEqual(['load', 'dial', 'edit']);
  });

  it('always includes the load, because the other two are gestures on an open village', () => {
    expect(parseScenarios('dial')).toEqual(['load', 'dial']);
    expect(parseScenarios('edit')).toEqual(['load', 'edit']);
  });

  it('tolerates spacing and case', () => {
    expect(parseScenarios(' Dial , EDIT ')).toEqual(['load', 'dial', 'edit']);
  });

  it('refuses a name it does not know instead of measuring nothing', () => {
    expect(() => parseScenarios('lode')).toThrow(/unknown scenario "lode"/);
    expect(() => parseScenarios('load,drag')).toThrow(/unknown scenario "drag"/);
  });
});

describe('dialValueAt', () => {
  it('alternates, so every change is a real change', () => {
    const values = Array.from({ length: 6 }, (_, index) => dialValueAt(index));
    expect(values).toEqual([0.2, 0.8, 0.2, 0.8, 0.2, 0.8]);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).not.toBe(values[index - 1]);
    }
  });

  it('stays inside the declared value list', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(DIAL_VALUES).toContain(dialValueAt(index));
    }
  });
});

describe('the report shape', () => {
  /**
   * The report is the interface between this rig and three builders who will
   * diff their runs against the baseline. A field that quietly changes name
   * makes every earlier report unreadable, so the keys are asserted here rather
   * than only described in a type — a type is erased before anyone can compare
   * two files with it.
   */
  it('keeps the keys a run is diffed on', () => {
    const report: EditorPerfReport = {
      label: 'baseline',
      rig: 'editor',
      takenAt: '2026-09-07T00:00:00.000Z',
      url: 'http://localhost:5302/?debug=1',
      worldId: 'village1',
      zoneId: 'village',
      backend: 'webgl2',
      scenarios: ['load'],
      viewport: { width: 1280, height: 720 },
      assetStore: '/home/example/store',
      load: {
        documentMs: 120,
        modelsMs: 60_000,
        texturesMs: 61_000,
        entityCount: 5273,
        loadedCount: 5273,
        loadedTextureCount: 90,
        longTasks: { supported: true, count: 3, totalMs: 45_000, longestMs: 9_000 },
        profile: { samples: 100, totalMs: 70_000, samplingIntervalUs: 1_000, top: [], topSelf: [] },
        settled: {
          seconds: 3,
          elapsedSeconds: 3.2,
          frames: 30,
          framesPerSecond: 10,
          sceneRenderMs: 90,
          counters: {
            drawCalls: 6_000,
            activeMeshes: 6_000,
            triangles: 4_000_000,
            shadowCasters: 6_000,
            sceneTextures: 200,
          },
          camera: [0, 0, 0],
          cameraTarget: [0, 0, 0],
          profile: { samples: 10, totalMs: 3_000, samplingIntervalUs: 200, top: [], topSelf: [] },
        },
      },
      dial: null,
      edit: null,
    };

    expect(Object.keys(report)).toEqual([
      'label',
      'rig',
      'takenAt',
      'url',
      'worldId',
      'zoneId',
      'backend',
      'scenarios',
      'viewport',
      'assetStore',
      'load',
      'dial',
      'edit',
    ]);
    expect(Object.keys(report.load)).toEqual([
      'documentMs',
      'modelsMs',
      'texturesMs',
      'entityCount',
      'loadedCount',
      'loadedTextureCount',
      'longTasks',
      'profile',
      'settled',
    ]);
    expect(Object.keys(report.load.settled)).toEqual([
      'seconds',
      'elapsedSeconds',
      'frames',
      'framesPerSecond',
      'sceneRenderMs',
      'counters',
      'camera',
      'cameraTarget',
      'profile',
    ]);
    // Round-trips through JSON: the file on disk is what gets diffed, and a
    // number that arrives as `undefined` disappears from it without a word.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
