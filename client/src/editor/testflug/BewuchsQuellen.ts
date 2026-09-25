/**
 * BewuchsQuellen.ts — what the test-flight scatter preview needs to size its
 * clear areas like the server: the manifest hulls of own models and the
 * upload registry.
 * Quellen der Bewuchs-Vorschau im Testflug: Manifest und Upload-Registry.
 *
 * The server reads `assets/manifest.json` from disk and registers uploads
 * before it starts; the client fetches both. If a source is missing the
 * preview clears other radii than the server — that must be VISIBLE to the
 * user (`abweichungsText`), not only a `console.warn`.
 */
import { NAME_PRAEFIX } from '@wov/shared/src/uploadedModelRegistry.js';
import { leseManifest, type ManifestModell } from '@wov/shared/src/weltbau/manifest.js';

/** Where the client finds the manifest (the whole `assets/` folder is served). */
export const MANIFEST_URL = '/assets/manifest.json';

/** The manifest text from the served `assets/` folder (throws on network or HTTP failure). */
export async function holeManifestText(): Promise<string> {
  const antwort = await fetch(MANIFEST_URL, { cache: 'no-cache' });
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  return antwort.text();
}

export interface QuellenEingang {
  /** Manifest text (rejects on network or HTTP failure). */
  holeManifest: () => Promise<string>;
  /** Reload the upload registry; failures come back as `meldungen`, it never throws. */
  ladeRegistry: () => Promise<{ geladen: number; meldungen: string[] }>;
  /** Does the client know this prefab (`findPrefabByName`)? */
  bekannt: (prefab: string) => boolean;
}

export interface QuellenBericht {
  manifest: Map<string, ManifestModell> | null;
  manifestFehler: string | null;
  /** Upload prefabs of the draft that were unknown at start. */
  unbekannteUploads: string[];
  /** Of those, the ones still unknown after the reload. */
  weiterUnbekannt: string[];
  registryFehler: string[];
  registryNachgeladen: boolean;
}

/**
 * Loads the manifest and, if a placement points to an upload model the client
 * does not know, reloads the upload registry. Never throws.
 */
export async function ladeBewuchsQuellen(
  prefabs: Iterable<string>,
  io: QuellenEingang
): Promise<QuellenBericht> {
  const unbekannt = [
    ...new Set([...prefabs].filter((n) => typeof n === 'string' && n.startsWith(NAME_PRAEFIX) && !io.bekannt(n))),
  ];
  const bericht: QuellenBericht = {
    manifest: null,
    manifestFehler: null,
    unbekannteUploads: unbekannt,
    weiterUnbekannt: [],
    registryFehler: [],
    registryNachgeladen: false,
  };
  try {
    const text = await io.holeManifest();
    const m = leseManifest(text);
    if (m.size === 0) bericht.manifestFehler = 'Manifest leer oder nicht lesbar';
    else bericht.manifest = m;
  } catch (e) {
    bericht.manifestFehler = (e as Error).message;
  }
  if (unbekannt.length > 0) {
    try {
      const r = await io.ladeRegistry();
      bericht.registryNachgeladen = true;
      bericht.registryFehler = r.meldungen;
    } catch (e) {
      bericht.registryFehler = [(e as Error).message];
    }
    bericht.weiterUnbekannt = unbekannt.filter((n) => !io.bekannt(n));
  }
  return bericht;
}

/** Visible warning when preview and server may clear different areas; `null` when all sources are there. */
export function abweichungsText(b: QuellenBericht): string | null {
  const teile: string[] = [];
  if (b.manifestFehler !== null) teile.push(`Manifest fehlt (${b.manifestFehler})`);
  if (b.weiterUnbekannt.length > 0) {
    teile.push(`Upload-Modell(e) unbekannt: ${b.weiterUnbekannt.slice(0, 3).join(', ')}${b.weiterUnbekannt.length > 3 ? ' …' : ''}`);
  } else if (b.registryFehler.length > 0) {
    teile.push(`Upload-Registry nicht sauber geladen (${b.registryFehler[0]})`);
  }
  return teile.length === 0
    ? null
    : `Bewuchs-Vorschau kann vom Spiel abweichen: ${teile.join('; ')}`;
}
