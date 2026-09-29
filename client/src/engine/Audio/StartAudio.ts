/**
 * Starts the audio engine without ever failing the caller. A rejection from
 * `create` (no audio device, too many AudioContexts, …) is warned about
 * exactly once and the game keeps running without sound (B2 N1, Befund B2).
 * Lives here so client/src/main.ts keeps a one-line call site.
 */
export function startAudioEngine<E>(
  create: () => Promise<E>,
  onReady: (engine: E) => void,
): void {
  void create()
    .then(onReady)
    .catch((err: unknown) => {
      console.warn('[audio] AudioEngine.create failed, playing without sound:', err);
    });
}
