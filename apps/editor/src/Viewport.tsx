import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { publishEditorDebug } from './dev-debug.js';
import { createViewport, type ViewportHandle } from './scene/viewport.js';

export interface ViewportProps {
  /** Called once the viewport is live, and again with `null` when it is torn down. */
  readonly onReady?: (viewport: ViewportHandle | null) => void;
}

/**
 * The Babylon.js viewport, mounted into React.
 *
 * The lifecycle here is the interesting part. React 19's StrictMode mounts
 * every effect twice on purpose — run, clean up, run again — and
 * `createViewport` is asynchronous because WebGPU can only initialise
 * asynchronously. Cancel the first attempt naively and the two attempts
 * overlap: two Babylon engines end up bound to the same canvas, and the loser's
 * `dispose()` calls `WEBGL_lose_context` on the context the winner draws into.
 * The symptom is a viewport that renders once and then never again, which looks
 * exactly like a camera or a lighting mistake.
 *
 * So the effect chains onto the previous lifecycle instead of racing it: the
 * second attempt starts only after the first has been created *and* disposed.
 * The chain lives in a ref, which React preserves across the StrictMode
 * remount of the same component instance.
 */
export function Viewport({ onReady }: ViewportProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [status, setStatus] = useState('starting…');
  const [frameId, setFrameId] = useState(-1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    let viewport: ViewportHandle | undefined;
    let unsubscribe: (() => void) | undefined;

    const started = lifecycle.current.then(async () => {
      if (cancelled) {
        return;
      }
      try {
        const handle = await createViewport(canvas);
        if (cancelled) {
          handle.dispose();
          return;
        }
        viewport = handle;
        setStatus(`viewport ready — ${handle.backend}`);
        publishEditorDebug({ backend: handle.backend });
        // The counter is what proves the loop is alive. It is pushed into React
        // state every frame on purpose: a number that only sometimes reaches
        // the DOM would make a stalled loop look like a slow one.
        unsubscribe = handle.onFrame((index) => {
          setFrameId(index);
          publishEditorDebug({ frameId: index });
        });
        readyRef.current?.(handle);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            `viewport unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    });

    lifecycle.current = started.catch(() => undefined);

    return () => {
      cancelled = true;
      lifecycle.current = started.then(
        () => {
          unsubscribe?.();
          readyRef.current?.(null);
          viewport?.dispose();
          viewport = undefined;
        },
        () => undefined,
      );
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} data-testid="editor-canvas" tabIndex={0} />
      <div className="viewport-status">
        <span data-testid="editor-viewport-status">{status}</span>
        <span data-testid="editor-frame">
          {frameId < 0 ? 'frame …' : `frame ${String(frameId)}`}
        </span>
      </div>
    </>
  );
}
