/**
 * The asset manifest, read by the editor so a path field can offer the files
 * that actually exist (ADR-0033).
 *
 * A terrain's height field and its ground textures are asset paths, and the
 * honest control for one is the list of assets in the store, not a text box a
 * typo goes unnoticed in. The list is the manifest — the same file
 * `pnpm validate:assets` checks and the same one the importers write.
 *
 * **Fetched, not bundled, and only when it is needed.** The manifest is 874 kB
 * and describes 1192 assets; it is not something to put in front of a session
 * that only wants to move a barrel. `EditorShell` asks for it the first time
 * the zone inspector is opened, and the panel works without it — a field with
 * no list is still a field.
 *
 * The answer is validated, like every answer from outside (agent rule 10): a
 * manifest an older asset server serves must fail with the version message,
 * not with an undefined path halfway down a dropdown.
 */
import { assetUrl, type AssetSourceConfig } from '@wov/asset-system';
import { ASSET_MANIFEST_FILE_NAME, parseAssetManifest } from '@wov/asset-system/manifest';

/** Which asset paths exist, grouped the way a picker asks for them. */
export interface AssetIndex {
  /**
   * Every path of one manifest kind — `terrain`, `texture`, `mesh`, `prefab` —
   * sorted, so the same store always produces the same dropdown.
   */
  ofKind(kind: string): readonly string[];
  /** How many assets the manifest listed, for the panel's own hint. */
  readonly total: number;
}

/** The index of a manifest that could not be read: empty, never `null` checks. */
export function emptyAssetIndex(): AssetIndex {
  return { ofKind: () => [], total: 0 };
}

export function createAssetIndex(
  entries: readonly { readonly path: string; readonly kind: string }[],
): AssetIndex {
  const byKind = new Map<string, string[]>();
  for (const entry of entries) {
    const paths = byKind.get(entry.kind);
    if (paths === undefined) {
      byKind.set(entry.kind, [entry.path]);
    } else {
      paths.push(entry.path);
    }
  }
  for (const paths of byKind.values()) {
    paths.sort((left, right) => left.localeCompare(right, 'en'));
  }
  return {
    ofKind: (kind) => byKind.get(kind) ?? [],
    total: entries.length,
  };
}

/**
 * Loads `manifest.json` from the asset server.
 *
 * Rejects with a readable message rather than a bare `TypeError`, because the
 * two ways this fails — no asset server, or a manifest this build cannot read —
 * are two different things for whoever has to fix it.
 */
export async function loadAssetIndex(
  config: AssetSourceConfig,
  fetcher: typeof fetch = fetch,
): Promise<AssetIndex> {
  const url = assetUrl(config, ASSET_MANIFEST_FILE_NAME);
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  const parsed = parseAssetManifest(await response.json());
  if (!parsed.ok) {
    throw new Error(`${url} is not a manifest this editor understands: ${parsed.errors[0] ?? ''}`);
  }
  return createAssetIndex(parsed.manifest.assets);
}
