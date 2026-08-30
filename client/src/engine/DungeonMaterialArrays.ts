/**
 * DungeonMaterialArrays — laedt die drei Textur-Arrays des Dungeon-Generators
 * 2.0 (Albedo / Normale / ORH) plus die beiden Moos-Detailtexturen und macht
 * daraus Babylon-Texturen fuer `DungeonMaterial.ts`.
 * DungeonMaterialArrays — loads the three texture arrays of dungeon generator
 * 2.0 (albedo / normal / ORH) plus the two moss detail textures and turns them
 * into Babylon textures for `DungeonMaterial.ts`.
 *
 * ── Warum ein eigener Lader und nicht `new Texture(url)` ──────────────────
 * `tools/dungeon2/pack-material-arrays.py` (AP12) schreibt jede Ebene als
 * SENKRECHTEN STREIFEN in EINE PNG-Datei: Breite 1024, Hoehe 1024 x 6, Ebene 0
 * oben. Genau die Form, die `tools/extract-texture-arrays.py` fuers Gelaende
 * schon schreibt. Babylon hat keinen Loader, der aus einem solchen Streifen ein
 * `Texture2DArray` macht — `RawTexture2DArray` will einen fertigen Puffer, in
 * dem die Ebenen HINTEREINANDER liegen. Dieser Lader schneidet den Streifen
 * genau einmal auf.
 * Why a dedicated loader and not `new Texture(url)`:
 * `tools/dungeon2/pack-material-arrays.py` (AP12) writes every layer as a
 * VERTICAL STRIP into ONE PNG: width 1024, height 1024 x 6, layer 0 on top —
 * the same shape `tools/extract-texture-arrays.py` already writes for the
 * terrain. Babylon has no loader that turns such a strip into a
 * `Texture2DArray`; `RawTexture2DArray` wants a finished buffer with the layers
 * laid out BACK TO BACK. This loader cuts the strip apart exactly once.
 *
 * ── sRGB ─────────────────────────────────────────────────────────────────
 * `RawTexture2DArray` kennt kein `useSRGBBuffer`. Das Albedo-Array wird
 * deshalb ROH (sRGB-kodiert) hochgeladen und im Shader mit Babylons eigenem
 * `toLinearSpace()` linearisiert — dieselbe Funktion, die der PBR-Shader fuer
 * `GAMMAALBEDO` benutzt. Normale und ORH sind linear und bleiben es.
 * `RawTexture2DArray` has no `useSRGBBuffer`. The albedo array is therefore
 * uploaded RAW (sRGB encoded) and linearised in the shader with Babylon's own
 * `toLinearSpace()` — the very function the PBR shader uses for `GAMMAALBEDO`.
 * Normal and ORH are linear and stay that way.
 */
import { Constants } from '@babylonjs/core/Engines/constants';
import { RawTexture2DArray } from '@babylonjs/core/Materials/Textures/rawTexture2DArray';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Ein Eintrag aus `materialArrayIndex.json`. `layer` IST der `materialTag` der
 * Zelle (ARCHITECTURE W5, `layerIndexIsMaterialTag: true`), `metallic` ist die
 * Konstante je Ebene — Metallic ist bewusst KEIN Texturkanal, weil er auf
 * fuenf von sechs Ebenen konstant 0 ist.
 * One entry from `materialArrayIndex.json`. `layer` IS the cell's `materialTag`
 * (ARCHITECTURE W5, `layerIndexIsMaterialTag: true`), `metallic` is the
 * per-layer constant — metallic is deliberately NOT a texture channel because
 * it is constantly 0 on five of six layers.
 */
export interface DungeonSchichtInfo {
  readonly layer: number;
  readonly name: string;
  readonly metallic: number;
  /** Kantenlaenge einer Texturkachel in Metern. / Tile edge length in metres. */
  readonly tileMetres: number;
}

/** Die geladenen Texturen, gebuendelt. / The loaded textures, bundled. */
export interface DungeonMaterialArrays {
  readonly albedo: RawTexture2DArray;
  readonly normal: RawTexture2DArray;
  readonly orh: RawTexture2DArray;
  readonly moosAlbedo: Texture;
  readonly moosNormal: Texture;
  /** Nach `layer` aufsteigend, luecklos. / Ascending by `layer`, gapless. */
  readonly schichten: readonly DungeonSchichtInfo[];
  /** Kachelmass des Moos-Overlays (Tag 6). / Tile size of the moss overlay. */
  readonly moosKachelM: number;
  dispose(): void;
}

/**
 * Der Standard-Fundort im ausgelieferten Client. `assets/dungeon2/` liegt
 * AUSSERHALB des Repos (Mike sichert `assets/` selbst) — der Ausrollschritt
 * kopiert `arrays/` und `materials/moss-overlay/` nach `client/public/dungeon2/`.
 * The default location in the shipped client. `assets/dungeon2/` lives OUTSIDE
 * the repo (Mike backs up `assets/` himself) — the deploy step copies `arrays/`
 * and `materials/moss-overlay/` to `client/public/dungeon2/`.
 */
export const DUNGEON2_BASIS_URL = '/dungeon2/';

/** Rohform von `materialArrayIndex.json`. / Raw shape of the index file. */
interface IndexDatei {
  readonly format?: string;
  readonly version?: number;
  readonly layerIndexIsMaterialTag?: boolean;
  readonly arrays?: Record<string, { readonly file?: string; readonly width?: number; readonly height?: number; readonly layers?: number }>;
  readonly layers?: readonly { readonly layer: number; readonly name: string; readonly metallic: number; readonly tileMetres: number }[];
  readonly overlays?: readonly { readonly tag: number; readonly name: string; readonly tileMetres: number }[];
}

/**
 * Schneidet einen senkrechten Streifen in einen Ebenenpuffer und legt ein
 * `RawTexture2DArray` an.
 * Cuts a vertical strip into a layer buffer and creates a `RawTexture2DArray`.
 *
 * `invertY = false` ist Absicht und nicht Bequemlichkeit: Die Ebenen liegen im
 * Puffer bereits in der Reihenfolge, in der die GPU sie erwartet, und ein
 * Kippen wuerde die Streifengrenzen zwischen zwei Ebenen verschieben statt nur
 * das Bild zu drehen — daher wird stattdessen die Y-Achse beim Abtasten
 * gedreht (`1.0 - v` im Shader ist NICHT noetig, weil Weltraum-Triplanar
 * ohnehin keine Bildlaufrichtung kennt).
 * `invertY = false` is deliberate, not convenience: in the buffer the layers
 * already sit in the order the GPU expects, and flipping would move the strip
 * boundaries between two layers instead of only turning the image — world space
 * triplanar has no notion of image orientation anyway.
 */
function baueArray(
  scene: Scene,
  pixel: Uint8Array,
  breite: number,
  hoehe: number,
  ebenen: number
): RawTexture2DArray {
  const tex = new RawTexture2DArray(
    pixel,
    breite,
    hoehe,
    ebenen,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true, // Mipmaps: Pflicht, sonst flimmert jede Wand ab drei Metern.
    // Mipmaps: mandatory, otherwise every wall aliases from three metres on.
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE
  );
  // REPEAT ist der ganze Grund fuer Array statt Atlas (render-tech §1.5):
  // Triplanar wickelt die Weltkoordinate staendig um, und ein Atlas wuerde
  // dabei ueber die Kachelgrenze in den Nachbarn hinein filtern.
  // REPEAT is the entire reason for array instead of atlas (render-tech §1.5):
  // triplanar wraps world coordinates constantly, and an atlas would filter
  // across the tile boundary into its neighbour while doing so.
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/**
 * Holt eine PNG-Datei und gibt ihre Bildpunkte als RGBA-Puffer zurueck.
 * Fetches a PNG file and returns its pixels as an RGBA buffer.
 */
async function lesePixel(url: string): Promise<{ daten: Uint8ClampedArray; breite: number; hoehe: number }> {
  const antwort = await fetch(url);
  if (!antwort.ok) throw new Error(`${url}: HTTP ${antwort.status}`);
  const bild = await createImageBitmap(await antwort.blob());
  const leinwand = new OffscreenCanvas(bild.width, bild.height);
  const ctx = leinwand.getContext('2d');
  if (!ctx) throw new Error(`${url}: kein 2d-Kontext / no 2d context`);
  ctx.drawImage(bild, 0, 0);
  const bilddaten = ctx.getImageData(0, 0, bild.width, bild.height);
  bild.close();
  return { daten: bilddaten.data, breite: bild.width, hoehe: bild.height };
}

/**
 * Laedt Streifen-PNG -> `RawTexture2DArray`, mit HARTER Formatpruefung.
 * Loads strip PNG -> `RawTexture2DArray`, with a HARD format check.
 *
 * Die Pruefung ist kein Luxus: AP12 haelt fest, dass eine einzelne, versehent-
 * lich verkleinerte Ebene sonst still den ganzen Streifen verschiebt — jede
 * Ebene ab der falschen waere dann um einen Bruchteil verrutscht, und das
 * sieht man erst auf dem Bild, nicht in der Konsole.
 * The check is not a luxury: AP12 records that a single accidentally shrunk
 * layer silently shifts the whole strip — every layer after the wrong one would
 * be offset, and that shows up in the picture, not in the console.
 */
async function ladeStreifen(
  scene: Scene,
  url: string,
  ebenen: number
): Promise<RawTexture2DArray> {
  const { daten, breite, hoehe } = await lesePixel(url);
  if (hoehe % ebenen !== 0) {
    throw new Error(
      `${url}: Streifenhoehe ${hoehe} ist kein Vielfaches von ${ebenen} Ebenen / ` +
        `strip height ${hoehe} is not a multiple of ${ebenen} layers`
    );
  }
  const ebeneHoehe = hoehe / ebenen;
  if (ebeneHoehe !== breite) {
    // Quadratische Ebenen sind keine Formatvorschrift, aber jede Abweichung
    // hier ist bisher ein Verpackungsfehler gewesen — lieber laut als schief.
    // Square layers are not a format rule, but so far every deviation here has
    // been a packing mistake — better loud than skewed.
    console.warn(`[dungeon2] ${url}: Ebene ${breite}x${ebeneHoehe} ist nicht quadratisch.`);
  }
  // Der Streifen liegt zeilenweise; Ebene n beginnt bei Zeile n*ebeneHoehe.
  // Weil beide Anordnungen zeilenweise sind, ist das EINE Kopie ohne Umsortieren.
  // The strip is row major; layer n starts at row n*ebeneHoehe. Because both
  // layouts are row major this is ONE copy without reordering.
  const pixel = new Uint8Array(daten.buffer.slice(0));
  return baueArray(scene, pixel, breite, ebeneHoehe, ebenen);
}

/** Eine gewoehnliche 2D-Detailtextur (Moos). / A plain 2D detail texture (moss). */
function ladeDetail(scene: Scene, url: string, sRgb: boolean): Texture {
  const tex = new Texture(url, scene, false, !sRgb, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/**
 * Laedt alles, was `DungeonMaterial.ts` an Texturen braucht.
 * Loads everything `DungeonMaterial.ts` needs in the way of textures.
 *
 * Wirft bei jedem Fehler — der Aufrufer faengt und faellt auf ein graues
 * Material zurueck (AP6-Zustand). Ein halb geladener Satz waere schlimmer als
 * gar keiner: fehlende Normalen sehen aus wie ein Beleuchtungsfehler und
 * schicken die Fehlersuche in die falsche Richtung.
 * Throws on any error — the caller catches and falls back to a grey material
 * (the AP6 state). A half loaded set would be worse than none: missing normals
 * look like a lighting bug and send the search in the wrong direction.
 */
export async function ladeDungeonMaterialArrays(
  scene: Scene,
  basisUrl: string = DUNGEON2_BASIS_URL
): Promise<DungeonMaterialArrays> {
  const indexUrl = `${basisUrl}arrays/materialArrayIndex.json`;
  const antwort = await fetch(indexUrl);
  if (!antwort.ok) throw new Error(`${indexUrl}: HTTP ${antwort.status}`);
  const index = (await antwort.json()) as IndexDatei;

  if (index.format !== 'wov-dungeon-material-arrays') {
    throw new Error(`${indexUrl}: unbekanntes Format / unknown format: ${String(index.format)}`);
  }
  const rohSchichten = index.layers ?? [];
  if (rohSchichten.length === 0) throw new Error(`${indexUrl}: keine Ebenen / no layers`);

  // Aufsteigend und luecklos — der Shader indiziert mit dem materialTag direkt
  // in das Array, eine Luecke waere ein falsches Material statt eines Fehlers.
  // Ascending and gapless — the shader indexes the array with the materialTag
  // directly, so a gap would be a wrong material instead of an error.
  const schichten = [...rohSchichten].sort((a, b) => a.layer - b.layer);
  schichten.forEach((s, i) => {
    if (s.layer !== i) {
      throw new Error(`${indexUrl}: Ebene ${i} fehlt oder ist doppelt / layer ${i} missing or duplicated`);
    }
  });

  const ebenen = schichten.length;
  const [albedo, normal, orh] = await Promise.all([
    ladeStreifen(scene, `${basisUrl}arrays/albedo-array.png`, ebenen),
    ladeStreifen(scene, `${basisUrl}arrays/normal-array.png`, ebenen),
    ladeStreifen(scene, `${basisUrl}arrays/orh-array.png`, ebenen),
  ]);

  const moos = index.overlays?.find((o) => o.name === 'moss-overlay');
  const moosAlbedo = ladeDetail(scene, `${basisUrl}materials/moss-overlay/albedo.png`, true);
  const moosNormal = ladeDetail(scene, `${basisUrl}materials/moss-overlay/normal.png`, false);

  return {
    albedo,
    normal,
    orh,
    moosAlbedo,
    moosNormal,
    moosKachelM: moos?.tileMetres ?? 2,
    schichten: schichten.map((s) => ({
      layer: s.layer,
      name: s.name,
      metallic: s.metallic,
      tileMetres: s.tileMetres,
    })),
    dispose(): void {
      albedo.dispose();
      normal.dispose();
      orh.dispose();
      moosAlbedo.dispose();
      moosNormal.dispose();
    },
  };
}
