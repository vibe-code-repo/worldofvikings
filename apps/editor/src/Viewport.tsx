import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createViewportRenderer } from './viewport-scene.js';

/**
 * Babylon.js viewport placeholder.
 *
 * Engine, scene, render loop and resize handling come from `@wov/engine`
 * (ADR-0006), the same bootstrap the game uses. Selection, gizmos and the
 * asset browser follow in Phase 3.
 */
export function Viewport(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('starting…');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    // `createViewportRenderer` is async (WebGPU initialises asynchronously),
    // so the effect can be cleaned up before it resolves — StrictMode mounts
    // twice in development on purpose. Without this flag the first renderer
    // would keep a render loop and a GPU context alive forever.
    let cancelled = false;
    let renderer: { dispose(): void } | undefined;

    void (async () => {
      try {
        const handle = await createViewportRenderer(canvas);
        if (cancelled) {
          handle.dispose();
          return;
        }
        renderer = handle;
        setStatus(`viewport ready — ${handle.backend}`);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            `viewport unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      renderer?.dispose();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} />
      <span className="hint" data-testid="editor-viewport-status">
        {status}
      </span>
    </>
  );
}
