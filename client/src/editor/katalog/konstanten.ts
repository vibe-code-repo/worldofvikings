/**
 * Constants and small types of the editor's object catalogue
 * (`../GegenstandsKatalog.ts`): page size, load timeout, check parallelism,
 * column width, the measured figures of a model, the states of the status
 * badge and the sizes of the two reference bodies of the upload preview.
 *
 * Moved here unchanged from `GegenstandsKatalog.ts` (refactoring step G1).
 * No runtime import, nothing is derived at module load.
 */
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Zeilen je Listenseite — s. Kopf („Warum Seiten"). */
const SEITE_GROESSE = 60;

/**
 * Geduld für EIN Modell (ms). Großzügig, weil einzelne GLBs des Exports
 * zweistellige Megabyte haben (Grabhügel: 17 MB) — aber endlich, damit
 * eine hängende Anfrage nicht als Dauerzustand erscheint.
 */
const LADE_TIMEOUT = 30_000;

/** Gleichzeitige HEAD-Anfragen der Verfügbarkeitsprüfung. */
const PRUEF_PARALLEL = 6;

/** Breite der Listenspalte (Entwurf). */
const SPALTE_BREITE = 322;

/** Gemessene Kennzahlen des geladenen Modells. */
interface Kennzahlen {
  breite: number;
  hoehe: number;
  tiefe: number;
  dreiecke: number;
  meshes: number;
  materialien: number;
  mitte: Vector3;
}

/** Zustand der Statusplakette über der Bühne. */
type StatusArt = 'laedt' | 'da' | 'fehlt' | 'neutral';

/**
 * Maße der beiden Referenzkörper neben der Upload-Vorschau (Auftrag Punkt 4)
 * — eine 1,8-m-Figur (Breite/Tiefe grob wie ein Mensch) und eine 1-m-Kiste,
 * mit derselben Lücke auf beiden Seiten des Modells.
 */
const REFERENZ_FIGUR_BREITE = 0.5;
const REFERENZ_FIGUR_HOEHE = 1.8;
const REFERENZ_FIGUR_TIEFE = 0.3;
const REFERENZ_KISTE_KANTE = 1;
const REFERENZ_LUECKE = 0.4;

export {
  LADE_TIMEOUT,
  PRUEF_PARALLEL,
  REFERENZ_FIGUR_BREITE,
  REFERENZ_FIGUR_HOEHE,
  REFERENZ_FIGUR_TIEFE,
  REFERENZ_KISTE_KANTE,
  REFERENZ_LUECKE,
  SEITE_GROESSE,
  SPALTE_BREITE,
};
export type { Kennzahlen, StatusArt };
