/**
 * Diagnostic hooks (`dynMasse`, `dynSprung`) must leave the animation as they
 * found it.
 *
 * They pause whatever plays, park the clip they want to measure on a frame,
 * read the mesh — and used to `play` that clip again at the end, whether it
 * had been playing before or not. Every call on a clip that was not the
 * playing one left one more group running: after n calls, n groups at once
 * (10 calls → the animal blends 10 clips). Not a game bug (only reachable
 * through `__vb`), but every measurement taken afterwards was wrong.
 *
 * Structural type instead of Babylon's AnimationGroup, so the rule is tested
 * without a scene.
 */

export interface SicherbareGruppe {
  readonly isPlaying: boolean;
  readonly from: number;
  pause(): void;
  play(loop?: boolean): void;
  start(loop?: boolean): unknown;
  stop(): void;
  goToFrame(frame: number): void;
}

/**
 * Pause the playing groups and park the measured group on its first frame.
 * Returns the function that puts everything back: the groups that played, play
 * again; the measured clip plays only if it played before, else it is stopped.
 */
export function pausiereFuerMessung(
  gruppen: readonly SicherbareGruppe[],
  messGruppe: SicherbareGruppe | undefined
): () => void {
  const gemessen = messGruppe ? [messGruppe] : [];
  const spielte = gruppen.filter((x) => x.isPlaying);
  const warSchon = gemessen.filter((x) => spielte.includes(x));
  for (const x of spielte) x.pause();
  for (const g of gemessen) {
    g.start(true);
    g.pause();
    g.goToFrame(g.from);
  }
  return () => {
    for (const g of gemessen) {
      g.goToFrame(g.from);
      if (!warSchon.includes(g)) g.stop();
    }
    for (const x of spielte) x.play(true);
  };
}
