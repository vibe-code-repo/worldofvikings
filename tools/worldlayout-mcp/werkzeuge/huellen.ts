/**
 * Hüllenauflösung für die MCP-Werkzeuge: Store und Uploads wie bisher, dazu
 * die Maße aus `assets/manifest.json` über den Einhängepunkt `zusatz`
 * (eigene Modelle wie Felsblock1..3). Das Manifest wird nur neu gelesen, wenn
 * sich die Datei ändert.
 *
 * Hull resolver for the tools: store + uploads + manifest sizes.
 */
import { statSync } from 'node:fs';
import { huellenAufloeser, type HuellenAufloeser } from '@wov/shared/src/weltbau/huelle.js';
import { manifestHuellen } from '@wov/shared/src/weltbau/manifest.js';
import { MANIFEST_PFAD, leseManifestDatei } from './uploads.js';

let zwischen: { mtime: number; zusatz: HuellenAufloeser } | undefined;

/** Ein frischer Auflöser (eigener Zwischenspeicher je Aufruf), das Manifest ist zwischengespeichert. */
export function huellenFuerAufruf(): HuellenAufloeser {
  let mtime = -1;
  try {
    mtime = statSync(MANIFEST_PFAD).mtimeMs;
  } catch {
    /* fehlt: leeres Manifest */
  }
  if (zwischen?.mtime !== mtime) zwischen = { mtime, zusatz: manifestHuellen(leseManifestDatei().manifest) };
  return huellenAufloeser(zwischen.zusatz);
}
