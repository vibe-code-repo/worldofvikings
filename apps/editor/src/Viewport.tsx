import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createViewportScene } from './viewport-scene.js';

/**
 * Babylon.js viewport placeholder.
 *
 * The editor owns its own scene bootstrap in Phase 0; the reusable parts move
 * into `@wov/engine` in Phase 1 so game and editor share one renderer setup.
 */
export function Viewport(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('starting…');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    try {
      const { engine, scene } = createViewportScene(canvas);
      engine.runRenderLoop(() => scene.render());
      const onResize = (): void => engine.resize();
      window.addEventListener('resize', onResize);
      setStatus('viewport ready');
      return () => {
        window.removeEventListener('resize', onResize);
        engine.dispose();
      };
    } catch (error) {
      setStatus(`viewport unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
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
