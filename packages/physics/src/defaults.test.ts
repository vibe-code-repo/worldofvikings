import { describe, expect, it } from 'vitest';
import { characterPhysics, defaultGravity, physicsLayers, simulationStep } from './index.js';

describe('characterPhysics', () => {
  it('describes the player capsule from the spec (§29): radius 0.4 m, height 1.8 m', () => {
    expect(characterPhysics.capsule).toEqual({ radius: 0.4, height: 1.8 });
  });

  it('keeps the ground probe shorter than the capsule so it cannot reach through a floor', () => {
    expect(characterPhysics.groundProbeDistance).toBeGreaterThan(0);
    expect(characterPhysics.groundProbeDistance).toBeLessThan(characterPhysics.capsule.radius);
  });

  it('is frozen so a system cannot retune the defaults for everyone', () => {
    expect(Object.isFrozen(characterPhysics)).toBe(true);
    expect(Object.isFrozen(characterPhysics.capsule)).toBe(true);
    expect(Object.isFrozen(defaultGravity)).toBe(true);
    expect(Object.isFrozen(physicsLayers)).toBe(true);
  });
});

describe('defaultGravity', () => {
  it('pulls straight down at earth gravity', () => {
    expect(defaultGravity).toEqual({ x: 0, y: -9.81, z: 0 });
  });
});

describe('simulationStep', () => {
  it('steps at 60 Hz at most, so a fast body cannot skip through a wall', () => {
    expect(simulationStep.maxSubStepSeconds).toBeCloseTo(1 / 60, 6);
  });

  it('lets a frame catch up by at most about half a second', () => {
    const catchUpSeconds = simulationStep.maxSubSteps * simulationStep.maxSubStepSeconds;
    expect(catchUpSeconds).toBeGreaterThan(0.25);
    expect(catchUpSeconds).toBeLessThan(1);
  });

  it('is frozen so a system cannot retune the step for everyone', () => {
    expect(Object.isFrozen(simulationStep)).toBe(true);
  });
});
