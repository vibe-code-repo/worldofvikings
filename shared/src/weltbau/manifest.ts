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
