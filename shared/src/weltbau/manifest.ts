/**
 * manifest.ts — die Maße eigener Modelle aus `assets/manifest.json`, als
 * reine Funktion über den Dateitext (kein Dateizugriff: das Lesen macht das
 * MCP-Werkzeug).
 *
 * Nur die Felder, die der Katalog braucht: Hüllbox (Dateiraum, wie im
 * Manifest), Breite/Höhe/Tiefe und die Dreieckszahl. Ein kaputter oder
 * fehlender Eintrag ist kein Fehler, sondern „keine Angabe“: es wird nichts
 * erfunden.
 *
 * Sizes of own models from `assets/manifest.json` as a pure function over the
 * file text. Missing or broken entries yield no size, never a guessed one.
 */

import { PREFABS_BY_NAME } from '../prefabs.js';
import { istFesterKoerper } from '../kollision/festeKoerper.js';
import type { Huelle, HuellenAufloeser } from './huelle.js';

export interface ManifestModell {
  breite: number;
  hoehe: number;
  tiefe: number;
  dreiecke?: number;
  /** Hüllbox im Dateiraum (x noch nicht gespiegelt). */
  huelle?: { min: readonly [number, number, number]; max: readonly [number, number, number] };
}

const istZahl = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const istDreier = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(istZahl);

/** Liest den Manifest-Text; bei kaputtem JSON eine leere Abbildung. */
export function leseManifest(text: string): Map<string, ManifestModell> {
  const aus = new Map<string, ManifestModell>();
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return aus;
  }
  const modelle = (roh as { modelle?: unknown } | null)?.modelle;
  if (typeof modelle !== 'object' || modelle === null) return aus;
  for (const [name, e] of Object.entries(modelle as Record<string, unknown>)) {
    if (typeof e !== 'object' || e === null) continue;
    const m = e as Record<string, unknown>;
    const h = m.huelle as { min?: unknown; max?: unknown } | undefined;
    const huelle = h && istDreier(h.min) && istDreier(h.max) ? { min: h.min, max: h.max } : undefined;
    let breite = m.breite;
    let hoehe = m.hoehe;
    let tiefe = m.tiefe;
    // Fehlen die Maße, aber die Hüllbox ist da, ergeben sie sich aus ihr.
    if (huelle) {
      if (!istZahl(breite)) breite = huelle.max[0] - huelle.min[0];
      if (!istZahl(hoehe)) hoehe = huelle.max[1] - huelle.min[1];
      if (!istZahl(tiefe)) tiefe = huelle.max[2] - huelle.min[2];
    }
    if (!istZahl(breite) || !istZahl(hoehe) || !istZahl(tiefe)) continue;
    aus.set(name, {
      breite,
      hoehe,
      tiefe,
      ...(istZahl(m.dreiecke) ? { dreiecke: m.dreiecke } : {}),
      ...(huelle ? { huelle } : {}),
    });
  }
  return aus;
}

/**
 * Hülle aus den Maßen des Manifests (Einhängepunkt `zusatz` des
 * Hüllenauflösers): Hüllbox aus dem Dateiraum (x gespiegelt), fehlt sie, eine
 * um den Ursprung zentrierte Box aus Breite/Tiefe/Höhe. Festigkeit wie im
 * Store über `istFesterKoerper`. Kein Eintrag → `null`, nichts wird erfunden.
 * Zählt nie als Haus (Quelle `manifest`).
 *
 * Hull from manifest sizes, for the resolver's `zusatz` hook.
 */
export function manifestHuellen(manifest: ReadonlyMap<string, ManifestModell>): HuellenAufloeser {
  return (prefab) => {
    const m = manifest.get(prefab);
    if (!m) return null;
    const box = m.huelle ?? { min: [-m.breite / 2, 0, -m.tiefe / 2] as const, max: [m.breite / 2, m.hoehe, m.tiefe / 2] as const };
    const h: Huelle = {
      fest: istFesterKoerper(PREFABS_BY_NAME.get(prefab), prefab),
      mitteX: m.huelle ? -(box.min[0] + box.max[0]) / 2 : 0,
      mitteZ: (box.min[2] + box.max[2]) / 2,
      halbX: (box.max[0] - box.min[0]) / 2,
      halbZ: (box.max[2] - box.min[2]) / 2,
      minY: box.min[1],
      maxY: box.max[1],
      gebaeude: false,
      quelle: 'manifest',
    };
    return h.halbX > 0 && h.halbZ > 0 ? h : null;
  };
}
