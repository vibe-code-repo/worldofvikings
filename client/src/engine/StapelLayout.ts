/**
 * Der Texturstapel des Bodens: wie er gelesen wird, ob er zum Code passt, wie seine URL aussieht.
 * Herausgeloest aus `TerrainSplat.ts` (engine-frei, testbar); `TerrainSplat.ts` reicht alles unveraendert weiter.
 *
 * The ground texture stack: layout detection, fit check, URL with content hash. Engine-free.
 */
import { STAPEL_ZEILEN, STAPEL_VERSION, TILE_ANZAHL, TILE_ZEILE, KACHEL_RUECKFALL } from '@wov/shared/src/worldgen/bodenKacheln.js';

/**
 * Wie ein geladener Stapel gelesen wird (N2): aus Breite und Hoehe.
 *
 *  - Modus 0: `STAPEL_ZEILEN` (16) Zeilen, die Kachel zeigt auf Zeile `TILE_ZEILE[kachel]` (das Layout dieses Codes).
 *  - Modus 1: `TILE_ANZAHL` (20) Zeilen, Zeile = Kachel (das Layout des ersten K3-Entwurfs; solche Stapel
 *    liegen noch in alten Arbeitsbaeumen). Jede Kachel hat dort ihre eigene Zeile, auch Greyglen.
 *  - Modus 2: jede andere Zeilenzahl: der Stapel gehoert nicht zu diesem Code. Die Greyglen-Kacheln lesen
 *    ihre Grasland-Entsprechung (`KACHEL_RUECKFALL`), jede Zeile wird auf die letzte vorhandene geklemmt.
 *    Der Boden ist dann nicht richtig, aber definiert, und es gibt eine laute Meldung.
 *
 * Die Werte gehen als Uniforms in den Shader: sie gelten fuer jeden Chunk sofort, auch fuer die vor dem
 * Ladeergebnis gebauten (kein Neubau noetig).
 */
export interface StapelLayout {
  readonly modus: 0 | 1 | 2;
  readonly zeilen: number;
}

export function stapelLayout(breite: number, hoehe: number): StapelLayout {
  if (!(breite > 0) || !(hoehe > 0)) return { modus: 2, zeilen: STAPEL_ZEILEN };
  const zeilen = Math.max(1, Math.round(hoehe / breite));
  if (hoehe === breite * STAPEL_ZEILEN) return { modus: 0, zeilen: STAPEL_ZEILEN };
  if (hoehe === breite * TILE_ANZAHL) return { modus: 1, zeilen: TILE_ANZAHL };
  return { modus: 2, zeilen };
}

/** Der Befund zu einem geladenen Stapel: Layout, ob die Greyglen-Kacheln gelten, und eine Meldung (oder null). */
export interface StapelBefundErgebnis {
  readonly layout: StapelLayout;
  readonly ok: boolean;
  readonly meldung: string | null;
}

export function stapelBefundAusGroesse(breite: number, hoehe: number, maxTextur: number, was: string): StapelBefundErgebnis {
  const layout = stapelLayout(breite, hoehe);
  if (layout.modus === 0) {
    const gross = maxTextur > 0 && hoehe > maxTextur;
    return { layout, ok: true, meldung: gross ? `[terrain] ${was}: ${hoehe} px hoch, die Grafikkarte laedt hoechstens ${maxTextur} px; die Textur wird verkleinert (die ${STAPEL_ZEILEN} Zeilen bleiben, nur die Aufloesung sinkt).` : null };
  }
  if (layout.modus === 1) {
    return { layout, ok: true, meldung: `[terrain] ${was}: ${breite}x${hoehe} ist ein Stapel mit ${TILE_ANZAHL} Zeilen (altes Layout, Zeile = Kachel); er wird so gelesen. \`npm run store:boden\` baut ihn neu.` };
  }
  return {
    layout,
    ok: false,
    meldung:
      `[terrain] ${was}: ${breite}x${hoehe} (${layout.zeilen} Zeilen) gehoert nicht zu diesem Code (Layout ${STAPEL_VERSION}, ${STAPEL_ZEILEN} Zeilen); ` +
      'Greyglen-Kacheln lesen Grasland, der Boden kann falsch sein. `npm run store:boden` baut den Stapel neu.',
  };
}

/**
 * Der Befund zu einer geladenen Textur. Gelesen wird die BILDGROESSE des Bildes (`getBaseSize()`), nicht
 * `getSize()`: Babylon klemmt die Groesse der Textur auf `MAX_TEXTURE_SIZE` der Grafikkarte (ein Stapel von
 * 512 × 8192 waere auf einer Karte mit 4096 px nur 512 × 4096 hoch und sähe wie ein Stapel mit 8 Zeilen aus).
 * Das Verhaeltnis der Zeilen bleibt beim Verkleinern erhalten, der Shader rechnet in Zeilen und nicht in Pixeln.
 */
export function stapelBefundAusTextur(
  tex: { getBaseSize(): { width: number; height: number } },
  maxTextur: number,
  was: string,
): StapelBefundErgebnis {
  const gr = tex.getBaseSize();
  return stapelBefundAusGroesse(gr.width, gr.height, maxTextur, was);
}

/** Das Mass fuer die alte Pruefung (Tests): Hoehe = Breite mal `STAPEL_ZEILEN`. */
export function stapelPasst(breite: number, hoehe: number): boolean {
  return stapelLayout(breite, hoehe).modus === 0;
}

let stapelBrauchbarFlag = true;
/** Falsch, sobald ein Stapel geladen wurde, der nicht zum Code passt (oder gar nicht lud). */
export function stapelBrauchbar(): boolean {
  return stapelBrauchbarFlag;
}
const stapelHoerer = new Set<(ok: boolean) => void>();
/** Meldet `f` jede Aenderung des Pruefergebnisses (das Material stellt damit das Greyglen-Gewicht im Shader ein). */
export function stapelBeobachten(f: (ok: boolean) => void): () => void {
  stapelHoerer.add(f);
  return () => stapelHoerer.delete(f);
}
/** Setzt das Ergebnis der Stapelpruefung (fuer die Lade-Rueckrufe; Tests setzen es zurueck). */
export function stapelMelden(ok: boolean): void {
  stapelBrauchbarFlag = ok;
  for (const f of stapelHoerer) f(ok);
}
/** Ladefehler eines Stapels: laute Meldung und Rueckfall auf die Grasland-Kacheln. */
export function stapelFehlgeschlagen(was: string, grund?: string): void {
  stapelMelden(false);
  console.error(`[terrain] ${was} konnte nicht geladen werden (${grund ?? '?'}); Greyglen-Kacheln fallen auf Grasland zurueck.`);
}

/**
 * Die URL eines Stapels, mit dem INHALTS-Hash aus `store-schichten.json` als Abfrageparameter. Ohne Hash
 * (alte JSON, JSON nicht lesbar) die nackte URL. Der Hash aendert sich genau dann, wenn sich die Bytes der
 * Datei aendern (zum Beispiel, wenn die echte Normale kopiert wird) und bleibt gleich bei einem Stapel, der
 * Byte fuer Byte derselbe ist (kein unnoetiges Neuladen).
 */
export function stapelUrl(basis: string, hash: string | undefined): string {
  return hash ? `${basis}?h=${hash}` : basis;
}

const HASH_FORM = /^[0-9a-f]{8,64}$/;

/** Liest die Stapel-Hashes aus der JSON-Antwort. Liefert leere Felder bei jedem Fehler (kein Ausnahmefall nach aussen). */
export async function stapelHashesHolen(
  holen: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
  url: string,
): Promise<{ farbe?: string; normale?: string }> {
  try {
    const antwort = await holen(url);
    if (!antwort.ok) return {};
    const roh = (await antwort.json()) as { stapelHash?: { farbe?: unknown; normale?: unknown } } | null;
    const h = roh?.stapelHash;
    const nimm = (v: unknown): string | undefined => (typeof v === 'string' && HASH_FORM.test(v) ? v : undefined);
    return { farbe: nimm(h?.farbe), normale: nimm(h?.normale) };
  } catch {
    return {};
  }
}

/** Die Stapelzeile einer Kachel nach Modus, wie der Shader sie rechnet (Vergleichsrechnung des Tests). */
export function stapelZeile(kachel: number, layout: StapelLayout): number {
  const t = Math.min(TILE_ANZAHL - 1, Math.max(0, Math.round(kachel)));
  if (layout.modus === 0) return TILE_ZEILE[t]!;
  if (layout.modus === 1) return t;
  return Math.min(TILE_ZEILE[KACHEL_RUECKFALL[t]!]!, layout.zeilen - 1);
}

