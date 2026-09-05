import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { describe, expect, it, vi } from 'vitest';
import { createRenderer, selectBackend } from './renderer.js';
import type { FrameInfo, ResizeHost } from './renderer.js';
import { resolveRenderConfig } from './render-config.js';

/** A NullEngine keeps the bootstrap testable without a GPU or a DOM. */
function headlessEngine(): NullEngine {
  return new NullEngine({
    renderWidth: 64,
    renderHeight: 64,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
}

/** Minimal stand-in for `window` so the resize wiring is observable in Node. */
function fakeResizeHost(): ResizeHost & { readonly listeners: Set<() => void> } {
  const listeners = new Set<() => void>();
  return {
    listeners,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
}

describe('selectBackend', () => {
  it('falls back to WebGL2 when WebGPU is preferred but unsupported', () => {
    const config = resolveRenderConfig({ preferWebGPU: true });
    expect(selectBackend(config, { webgpu: false })).toBe('webgl2');
  });

  it('uses WebGPU only when it is both preferred and supported', () => {
    expect(selectBackend(resolveRenderConfig({ preferWebGPU: true }), { webgpu: true })).toBe(
      'webgpu',
    );
    expect(selectBackend(resolveRenderConfig({ preferWebGPU: false }), { webgpu: true })).toBe(
      'webgl2',
    );
  });
});

describe('createRenderer', () => {
  it('creates a scene on the engine it was given', async () => {
    const renderer = await createRenderer(null, {
      createEngine: headlessEngine,
      autoStart: false,
      resizeHost: null,
    });

    expect(renderer.scene.getEngine()).toBe(renderer.engine);
    expect(renderer.backend).toBe('headless');
    expect(renderer.disposed).toBe(false);

    renderer.dispose();
  });

  it('applies the resolution scale as the hardware scaling level', async () => {
    const engine = headlessEngine();
    // NullEngine.getHardwareScalingLevel() is hard-wired to 1, so the call
    // itself is the only honest witness here.
    const setScaling = vi.spyOn(engine, 'setHardwareScalingLevel');
    const renderer = await createRenderer(null, {
      createEngine: () => engine,
      autoStart: false,
      resizeHost: null,
      resolutionScale: 0.5,
    });

    expect(renderer.config.resolutionScale).toBe(0.5);
    expect(setScaling).toHaveBeenCalledWith(2);

    renderer.dispose();
  });

  it('notifies frame listeners once per rendered frame', async () => {
    const renderer = await createRenderer(null, {
      createEngine: headlessEngine,
      autoStart: false,
      resizeHost: null,
    });
    const frames: FrameInfo[] = [];
    renderer.onFrame((frame) => void frames.push(frame));

    renderer.renderFrame();
    renderer.renderFrame();

    expect(frames.map((frame) => frame.index)).toEqual([0, 1]);
    expect(frames.every((frame) => frame.deltaSeconds >= 0)).toBe(true);

    renderer.dispose();
  });

  it('stops notifying a listener that unsubscribed', async () => {
    const renderer = await createRenderer(null, {
      createEngine: headlessEngine,
      autoStart: false,
      resizeHost: null,
    });
    let calls = 0;
    const unsubscribe = renderer.onFrame(() => void (calls += 1));

    renderer.renderFrame();
    unsubscribe();
    renderer.renderFrame();

    expect(calls).toBe(1);

    renderer.dispose();
  });

  it('drives frame listeners from the engine render loop when started', async () => {
    const renderer = await createRenderer(null, {
      createEngine: headlessEngine,
      resizeHost: null,
    });

    const firstFrame = await new Promise<FrameInfo>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('render loop produced no frame')), 2000);
      renderer.onFrame((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });

    expect(firstFrame.index).toBeGreaterThanOrEqual(0);

    renderer.dispose();
  });

  it('opens and closes the engine frame when an external loop drives it', async () => {
    // The bug this pins: without `beginFrame`, Babylon never measures a frame
    // time, `engine.getDeltaTime()` answers 0 for ever, and every effect that
    // eases over time — the third-person camera's follow lag and its zoom above
    // all — freezes while the picture keeps rendering. Nothing throws, nothing
    // logs; the camera simply stops following the player.
    const engine = headlessEngine();
    const begin = vi.spyOn(engine, 'beginFrame');
    const end = vi.spyOn(engine, 'endFrame');
    const renderer = await createRenderer(null, {
      createEngine: () => engine,
      autoStart: false,
      resizeHost: null,
    });
    // A camera, because renderFrame skips the render without one.
    new FreeCamera('probe', Vector3.Zero(), renderer.scene);

    renderer.renderFrame();
    renderer.renderFrame();

    expect(begin).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(2);

    renderer.dispose();
  });

  it('leaves the frame bracket to the engine loop when it owns the frames', async () => {
    // The mirror image: Babylon's own render loop already brackets each frame,
    // so doing it again here would measure two frames per frame and present
    // twice.
    const engine = headlessEngine();
    const renderer = await createRenderer(null, {
      createEngine: () => engine,
      resizeHost: null,
    });
    new FreeCamera('probe', Vector3.Zero(), renderer.scene);
    const begin = vi.spyOn(engine, 'beginFrame');

    renderer.renderFrame();

    expect(begin).not.toHaveBeenCalled();

    renderer.dispose();
  });

  it('resizes the engine when the resize host fires', async () => {
    const host = fakeResizeHost();
    const engine = headlessEngine();
    const resize = vi.spyOn(engine, 'resize').mockImplementation(() => {});
    const renderer = await createRenderer(null, {
      createEngine: () => engine,
      autoStart: false,
      resizeHost: host,
    });

    // `setHardwareScalingLevel` resizes once during setup; only the host-driven
    // resize is under test here.
    resize.mockClear();
    expect(host.listeners.size).toBe(1);
    for (const listener of host.listeners) {
      listener();
    }
    expect(resize).toHaveBeenCalledTimes(1);

    renderer.dispose();
    expect(host.listeners.size).toBe(0);
  });

  it('is inert after dispose', async () => {
    const renderer = await createRenderer(null, {
      createEngine: headlessEngine,
      autoStart: false,
      resizeHost: null,
    });
    let calls = 0;
    renderer.onFrame(() => void (calls += 1));

    renderer.dispose();
    renderer.dispose();
    renderer.renderFrame();

    expect(calls).toBe(0);
    expect(renderer.disposed).toBe(true);
    expect(renderer.engine.isDisposed).toBe(true);
  });

  it('refuses to build a default engine without a canvas', async () => {
    await expect(createRenderer(null, { resizeHost: null })).rejects.toThrow(/canvas/i);
  });
});
