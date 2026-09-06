/**
 * Where `pnpm scatter` reads its models from and which world files it writes.
 *
 * Two decisions, both of which have already gone wrong once, which is why they
 * are here with a test rather than inline in the script:
 *
 * - **The store.** It is a private directory outside the checkout (ADR-0015),
 *   so there is no path this repository can name that is right on anybody
 *   else's machine. The old default named one anyway — a directory on the
 *   author's laptop, under a name that has no business in an open repository —
 *   and a run without `WOV_ASSET_STORE` then failed with "no such file"
 *   pointing at a stranger's home directory. Asking is honest; guessing is not.
 * - **The content directory.** The API takes `CONTENT_DIR` and writes the
 *   worlds it finds there, which is how `pnpm smoke` edits real world files
 *   without touching the repository. This script wrote `content/` in the
 *   checkout no matter what, so a reviewer who set `CONTENT_DIR` to a throwaway
 *   copy and then ran a scatter changed the committed village instead.
 *   `CONTENT_DIR` now means the same thing to both.
 */
import { resolve } from 'node:path';

/**
 * The asset store a run reads its height field and its models from.
 *
 * @param explicit `--store <path>`, when the command line carried one.
 * @param env `WOV_ASSET_STORE`, when the environment carries one.
 * @param fallback the neutral, checkout-relative default — `<repo>/../asset-store`.
 * @returns the store root. The fallback is a sibling of the checkout and names
 * nobody's machine; a run that lands there and finds no height field says so
 * and stops, rather than planting a field of grass at y = 0.
 */
export function resolveStoreRoot(
  explicit: string | undefined,
  env: string | undefined,
  fallback: string,
): string {
  const given = (explicit ?? '').trim();
  if (given !== '') {
    return resolve(given);
  }
  const fromEnvironment = (env ?? '').trim();
  if (fromEnvironment !== '') {
    return resolve(fromEnvironment);
  }
  return fallback;
}

/**
 * The directory holding `worlds/` and `prefabs/`, resolved as the API does.
 *
 * @param env `CONTENT_DIR`, when the environment carries one.
 * @param repositoryContentDir the checkout's own `content/`, used when it does
 * not.
 */
export function resolveContentDir(env: string | undefined, repositoryContentDir: string): string {
  const configured = (env ?? '').trim();
  return configured === '' ? repositoryContentDir : resolve(configured);
}
