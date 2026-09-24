/**
 * Lesen der Upload-Registry und des Asset-Manifests dieses Checkouts — für
 * catalog_search, uploads_list und ops_apply. Nur lesen, nie schreiben.
 *
 * Der Betriebsdienst hat keinen GET-Weg für die Liste (und `admin/src/main.ts`
 * ist nicht Sache dieser Werkzeuge), also die Datei selbst:
 * `<Checkout>/assets/hochgeladen/registry.json`, dieselbe, die der
 * Betriebsdienst pflegt. Die Einträge werden in `PREFABS_BY_NAME` eingetragen
 * (`applyUploadedModelRegistry`), sonst kennt der MCP-Prozess die `U_*`-Namen
 * nicht.
 *
 * Reads the upload registry and the asset manifest of this checkout (read-only).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyUploadedModelRegistry,
  leereRegistry,
  leseRegistryAusText,
  REGISTRY_DATEI,
  UPLOAD_DIR_NAME,
  type RegistryDatei,
  type UploadedModelEntry,
} from '@wov/shared/src/uploadedModelRegistry.js';
import { leseManifest, type ManifestModell } from '@wov/shared/src/weltbau/manifest.js';
import { CHECKOUT_WURZEL } from '../kern.js';

export const REGISTRY_PFAD = resolve(CHECKOUT_WURZEL, 'assets', UPLOAD_DIR_NAME, REGISTRY_DATEI);
export const MANIFEST_PFAD = resolve(CHECKOUT_WURZEL, 'assets', 'manifest.json');

export interface UploadStand {
  eintraege: readonly UploadedModelEntry[];
  /** Ein Satz, wenn die Datei fehlt (kein Fehler). */
  hinweis?: string;
}

/**
 * Liest die Registry und trägt sie in die Nachschlagewerke ein (Diff aus
 * Austragen und Eintragen, wie im Betriebsdienst). Fehlt die Datei: keine
 * Uploads, mit Hinweis. Kaputtes JSON wirft — kein stilles „keine Uploads“.
 */
export function leseUploads(): UploadStand {
  let text: string;
  try {
    text = readFileSync(REGISTRY_PFAD, 'utf-8');
  } catch (f) {
    if ((f as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Upload-Registry nicht lesbar (${REGISTRY_PFAD}): ${(f as Error).message}`);
    applyUploadedModelRegistry(leereRegistry());
    return { eintraege: [], hinweis: 'kein Upload-Ordner in diesem Checkout (assets per rsync?)' };
  }
  try {
    JSON.parse(text);
  } catch (f) {
    throw new Error(`Upload-Registry ist kein gültiges JSON (${REGISTRY_PFAD}): ${(f as Error).message}`);
  }
  const registry: RegistryDatei = leseRegistryAusText(text);
  const ergebnis = applyUploadedModelRegistry(registry);
  const registriert = new Set(registry.modelle.map((m) => m.name));
  for (const meldung of ergebnis.meldungen) console.error(`[worldlayout-mcp] Upload-Registry: ${meldung}`);
  return { eintraege: registry.modelle.filter((m) => registriert.has(m.name)) };
}

/** Das Manifest dieses Checkouts; fehlt es, eine leere Abbildung und ein Hinweis. */
export function leseManifestDatei(): { manifest: Map<string, ManifestModell>; hinweis?: string } {
  if (!existsSync(MANIFEST_PFAD)) return { manifest: new Map(), hinweis: 'assets/manifest.json fehlt: eigene Modelle ohne Maße' };
  try {
    return { manifest: leseManifest(readFileSync(MANIFEST_PFAD, 'utf-8')) };
  } catch (f) {
    return { manifest: new Map(), hinweis: `assets/manifest.json nicht lesbar: ${(f as Error).message}` };
  }
}
