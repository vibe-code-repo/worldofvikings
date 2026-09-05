/**
 * Putting loaded assets where they belong in a scene.
 *
 * {@link AssetManager} gets a GLB into memory; this module is the small step
 * after it — instantiate a copy and move it to a spot. It is deliberately the
 * thinnest possible layer, because *deciding* where something goes is world
 * data (`content/`, from Phase 4 on) and never this package's business.
 *
 * Like the rest of `@wov/asset-system` this module imports no Babylon.js at
 * runtime. It talks to the node properties it needs through structural types a
 * Babylon `Node` and `TransformNode` satisfy, which is also what makes it
 * testable without a renderer.
 */

/**
 * A root node exactly as instantiation hands it back.
 *
 * A name is all Babylon guarantees: `InstantiatedEntries.rootNodes` is typed
 * `Node[]`, and a `Node` need not have a transform — a light or a camera can be
 * a root too. So placement narrows to {@link PlaceableNode} rather than assume.
 */
export interface InstantiatedNode {
  name: string;
}

/**
 * A root that carries a transform, i.e. a Babylon `TransformNode`.
 *
 * Only `position.set` and `scaling.scaleInPlace` are needed — both mutate the
 * vector the node already owns instead of assigning a new one, so nothing here
 * has to construct a `Vector3` and therefore nothing has to import Babylon.js.
 */
export interface PlaceableNode extends InstantiatedNode {
  readonly position: { set(x: number, y: number, z: number): unknown };
  readonly scaling: { scaleInPlace(factor: number): unknown };
}

/** What instantiating an asset hands back; Babylon's `InstantiatedEntries` fits. */
export interface InstantiatedNodes {
  readonly rootNodes: readonly InstantiatedNode[];
}

/**
 * The one capability placement needs. {@link AssetManager} satisfies it, and so
 * does a fake in a test — which is the point.
 */
export interface AssetInstantiator {
  instantiate(assetPath: string): Promise<InstantiatedNodes>;
}

/** One copy of an asset, at one spot in the scene. */
export interface AssetPlacement {
  /** Repository-relative asset path, e.g. `environment/barrel.glb`. */
  readonly asset: string;
  /** Name for the instantiated root node, so it can be found in a scene dump. */
  readonly name: string;
  /** World position in metres, `[x, y, z]`. */
  readonly position: readonly [x: number, y: number, z: number];
  /**
   * Uniform scale factor applied on top of the model's own scale. Optional
   * because the honest default is "use the model at its authored size".
   */
  readonly scale?: number;
}

/** A placement that could not be instantiated, and why. */
export interface PlacementFailure {
  readonly placement: AssetPlacement;
  readonly error: Error;
}

/** What {@link placeAssets} reports back. Both lists keep the input order. */
export interface PlacementResult {
  readonly placed: readonly AssetPlacement[];
  readonly failures: readonly PlacementFailure[];
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Instantiates each placement and moves the resulting root nodes into position.
 *
 * All placements are started at once: they usually share a handful of models,
 * and {@link AssetManager} collapses concurrent requests for the same URL into
 * one download.
 *
 * One asset failing does not cancel the rest. A missing or broken model should
 * cost the player that one prop and a log line, not the whole scene — so the
 * result reports both halves and the caller decides how loud to be.
 */
export async function placeAssets(
  instantiator: AssetInstantiator,
  placements: readonly AssetPlacement[],
): Promise<PlacementResult> {
  const results = await Promise.allSettled(
    placements.map(async (placement) => {
      const entries = await instantiator.instantiate(placement.asset);
      applyPlacement(entries.rootNodes, placement);
    }),
  );

  const placed: AssetPlacement[] = [];
  const failures: PlacementFailure[] = [];
  results.forEach((result, index) => {
    const placement = placements[index];
    if (placement === undefined) {
      return;
    }
    if (result.status === 'fulfilled') {
      placed.push(placement);
    } else {
      failures.push({ placement, error: toError(result.reason) });
    }
  });

  return { placed, failures };
}

/**
 * One line describing a {@link PlacementResult}, for a status marker or a log.
 *
 * It lives here rather than in the game app because the smoke test asserts this
 * exact wording: one spelling, not two that drift apart (the same reason
 * `formatManifestReport` lives next to the manifest schema).
 *
 * The count comes first and is always printed, including `0 loaded`. The
 * failure mode this is meant to catch is a model that quietly 404s, and a
 * status line that says nothing when nothing loaded catches nothing.
 */
export function summarizePlacement(result: PlacementResult): string {
  const loaded = `assets: ${result.placed.length} loaded`;
  if (result.failures.length === 0) {
    return loaded;
  }
  const names = result.failures.map((failure) => failure.placement.asset).join(', ');
  return `${loaded}, ${result.failures.length} failed (${names})`;
}

/**
 * Whether a root node can be moved.
 *
 * Duck-typed rather than `instanceof TransformNode`, because an `instanceof`
 * would mean importing Babylon.js at runtime and this package must not.
 */
function isPlaceable(node: InstantiatedNode): node is PlaceableNode {
  const candidate = node as Partial<PlaceableNode>;
  return (
    typeof candidate.position?.set === 'function' &&
    typeof candidate.scaling?.scaleInPlace === 'function'
  );
}

function applyPlacement(roots: readonly InstantiatedNode[], placement: AssetPlacement): void {
  const [x, y, z] = placement.position;
  let moved = 0;
  roots.forEach((root, index) => {
    root.name = roots.length === 1 ? placement.name : `${placement.name}.${index}`;
    if (!isPlaceable(root)) {
      return;
    }
    moved += 1;
    root.position.set(x, y, z);
    if (placement.scale !== undefined) {
      // Multiply, never assign. Babylon's glTF loader mirrors the imported root
      // on x to convert glTF's right-handed space into a left-handed scene;
      // assigning a positive scale would silently turn the model inside out.
      root.scaling.scaleInPlace(placement.scale);
    }
  });

  if (moved === 0) {
    // A model that loads but cannot be moved would sit at the origin and look
    // like a placement bug forever. Say so instead.
    throw new Error(
      `instantiating "${placement.asset}" produced no root node that can be positioned ` +
        `(${roots.length} root node(s))`,
    );
  }
}
