/**
 * Per-instance tint of the store vegetation: the noise from the world position,
 * the colour of one instance and the colour buffer of a master. The buffers are
 * reused and kept in one WeakMap, which exists exactly once.
 * Moved verbatim out of EntityManager.ts.
 */

import type { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
// Nur für `VertexBuffer.ColorKind`: Ob ein Netz schon Vertexfarben trägt,
// entscheidet, ob es eine Instanzfarbe bekommen darf (darfGetoentWerden).
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

// ── Instanz-Tönung der Store-Vegetation ─────────────────────────────
//
// ── Das Problem ─────────────────────────────────────────────────────
// Ein Store-Wald sieht GESTEMPELT aus. Der Grund steht in der
// Look-Analyse (§2 „Vegetation"): Der Shader des Vorbilds färbt jedes
// Blatt aus einem WELTRAUM-Rauschen (`LeafNoiseColour`,
// `ColourNoiseLargeScale`) — zwei Bäume derselben Art tragen dort nie
// exakt dieselbe Farbe. Unsere Bäume dagegen teilen sich ein Material
// und damit einen einzigen `baseColorFactor`; 400 Fichten sind 400 mal
// dieselbe Fichte, und das sieht das Auge sofort, auch wenn es nicht
// benennen kann, woran es liegt.
//
// ── Der billige Ersatz ──────────────────────────────────────────────
// Kein Shader-Rauschen, sondern eine Farbe JE INSTANZ über den
// Thin-Instance-Puffer `color`. Babylon multipliziert sie im
// Fragmentshader auf die Albedo (VERTEXCOLOR/INSTANCESCOLOR); sie kostet
// vier Floats je Instanz und keinen einzigen Zeichenaufruf.
// `GrassClutter` geht diesen Weg seit jeher (dort `terrainTint`) — der
// Zeuge dafür, dass er in dieser Pipeline trägt.
//
// ── Woher der Zufall kommt ──────────────────────────────────────────
// Aus der WELTPOSITION, nicht aus dem Instanzindex. Der Index ändert
// sich bei jedem Neuaufbau des Buckets (Swap-Remove in removeZDO,
// Streaming, Sprite-Umverteilung); ein Baum wechselte dann beim
// Vorbeilaufen die Farbe. Die Position ist die einzige Grösse, die ein
// gestreuter Baum über seine ganze Lebensdauer behält.

/** Ist die Tönungsstreuung an? `false` stellt den Zustand davor her. */
export const INSTANZ_TOENUNG_AN = true;

/**
 * Halbe Bandbreite der Helligkeitsstreuung (Anteil der Luma).
 *
 * 0,07 heisst: die dunkelste Instanz trägt 93 %, die hellste 107 % der
 * Materialfarbe. Die Look-Analyse nennt 5–8 % als das Fenster, in dem
 * ein Wald aufhört, gestempelt zu wirken, ohne dass einzelne Bäume als
 * „falsch gefärbt" auffallen.
 */
export const TOENUNG_LUMA = 0.07;

/**
 * Halbe Bandbreite der Farbtondrift (warm/kühl), gegenläufig auf R und B.
 *
 * Bewusst kleiner als die Helligkeit: Ein Grünton, der um 5 % nach Rot
 * kippt, liest sich als anderer Baum; einer, der um 15 % kippt, liest
 * sich als kranker Baum. R hoch UND B runter zugleich, damit die Luma
 * dabei nahezu erhalten bleibt und sich die beiden Achsen nicht
 * gegenseitig verrechnen.
 */
export const TOENUNG_TON = 0.05;

/**
 * Zwei unabhängige Zufallszahlen in [0,1) aus einer Weltposition.
 *
 * Ganzzahliges Mischen, damit dasselbe Paar (x, z) IMMER dieselben zwei
 * Zahlen ergibt — auf jeder Maschine, in jeder Sitzung, in jeder
 * Reihenfolge. Das ist die Zusage, die `client/test/instanz-toenung.ts`
 * festhält.
 *
 * Gerastert wird auf 10 cm. Ohne Rasterung entschiede das letzte Bit
 * einer f32-Position über die Farbe, und die ist zwischen Serverwert und
 * zurückgerechneter Weltmatrix nicht bitgleich — derselbe Baum bekäme
 * nach einem Neuaufbau eine andere Farbe.
 */
export function toenungsRauschen(x: number, z: number): { a: number; b: number } {
  let h = Math.imul(Math.round(x * 10) | 0, 0x27d4eb2d);
  h ^= h >>> 15;
  h = (h + Math.imul(Math.round(z * 10) | 0, 0x165667b1)) | 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  let g = Math.imul(h ^ 0x9e3779b9, 0xc2b2ae35);
  g ^= g >>> 15;
  g = Math.imul(g, 0x27d4eb2d);
  g ^= g >>> 13;
  return { a: (h >>> 0) / 4294967296, b: (g >>> 0) / 4294967296 };
}

/**
 * Die Instanzfarbe eines gestreuten Objekts an (x, z), in `aus` ab `o`.
 *
 * Multiplikativ auf die Albedo: 1,0 ist „unverändert". Nach OBEN wird
 * nicht gedeckelt — ein Faktor über 1 hellt auf, und das ist die halbe
 * Streuung. Nach unten gegen Null schon, damit eine künftig grössere
 * Amplitude keine negativen Farben erzeugt.
 */
export function instanzToenung(x: number, z: number, aus: Float32Array, o: number): void {
  const { a, b } = toenungsRauschen(x, z);
  const luma = 1 + TOENUNG_LUMA * (2 * a - 1);
  const ton = TOENUNG_TON * (2 * b - 1);
  aus[o] = Math.max(0, luma * (1 + ton));
  aus[o + 1] = Math.max(0, luma);
  aus[o + 2] = Math.max(0, luma * (1 - ton));
  aus[o + 3] = 1;
}

/**
 * Darf dieser Master eine Instanzfarbe bekommen?
 *
 * Zwei Bedingungen, beide gemessen statt behauptet:
 *
 *  1. Das Modell kommt aus dem Store (`store/` oder `store-lab/`). Die
 *     eigenen Altmodelle bleiben, wie sie sind — sie gehören nicht zu
 *     dieser Stufe, und eine Farbänderung an ihnen wäre eine
 *     Look-Entscheidung, die niemand getroffen hat.
 *  2. Das Netz bringt KEINE eigene Vertexfarbe mit. Im Store tun das
 *     genau vier Modelle, und es sind die vier Grasbüschel
 *     (`grass-short-clump-*`; gemessen R 0,01…0,13, G 0,00…1,00 — eine
 *     Halmmaske, keine Farbe). Getönt würde dort eine fremde Maske
 *     multipliziert, und Gras gehört ohnehin Bauer „Gras und Wasser".
 *     Erkannt wird das nicht über eine Namensliste, sondern weil das Netz
 *     selbst es sagt.
 *
 * ── Warum `ColorKind` und nicht `ColorInstanceKind` ──────────────────
 * Weil die Frage „bringt dieses Netz eine eigene Farbe mit" lautet und
 * nicht „habe ich hier schon getönt". Die beiden liegen in Babylon
 * NEBENEINANDER, nicht übereinander: `thinInstanceSetBuffer('color', …)`
 * schaltet den `kind` intern auf `instanceColor` um (8.56.2,
 * `thinInstanceMesh.js` Zeile 138, Kommentar „hot switching kind here to
 * preserve backward compatibility"), und der Shader multipliziert dann
 * beide (`vertexColorMixing`: `vColor *= instanceColor`,
 * `pbrBlockAlbedoOpacity`: `surfaceAlbedo *= vColor.rgb`).
 *
 * Das ist nachgesehen worden, weil die erste Fassung genau hier daneben
 * lag: Sie fragte `getVertexBuffer('color')` ab, um den eigenen Puffer
 * wiederzuerkennen — und fand ihn nie, weil er unter dem anderen Namen
 * liegt. Der Fehler war nicht sichtbar (die Tönung wirkte trotzdem), nur
 * die Begründung war falsch.
 */
function darfGetoentWerden(mesh: Mesh, modell: string | null, an: boolean): boolean {
  if (!an) return false;
  if (!modell || !/^store(-lab)?\//.test(modell)) return false;
  return !mesh.isVerticesDataPresent(VertexBuffer.ColorKind);
}

/**
 * Die Farbpuffer, die dieses Modul je Master schon angelegt hat.
 *
 * Sie werden WIEDERVERWENDET, und das ist keine Sparsamkeit um ihrer
 * selbst willen: `thinInstanceSetBuffer` legt jedes Mal einen neuen
 * `VertexBuffer` an und hängt ihn über `setVerticesBuffer` in die
 * Geometry — das ist eine GPU-Pufferanlage und ein
 * `_markSubMeshesAsAttributesDirty` je Aufruf. Die Buckets werden beim
 * Laufen dauernd neu gebaut (Streaming, Vegetationsgrenze), also fiele
 * das in jeden zweiten Sprintabschnitt.
 *
 * Bleibt die Instanzzahl gleich, wird deshalb nur der Inhalt neu
 * geschrieben und Babylon über `thinInstanceBufferUpdated` gesagt, dass
 * es den vorhandenen Puffer hochladen soll.
 *
 * Eine WeakMap, damit der Puffer mit seinem Master stirbt — Zell-Master
 * kommen aus einem Pool und werden entsorgt.
 */
const TOENUNGS_PUFFER = new WeakMap<Mesh, Float32Array>();

/**
 * Den Farbpuffer eines Masters schreiben — oder ihn ausdrücklich
 * abräumen.
 *
 * Das Abräumen ist kein Beiwerk: Zell-Master kommen aus einem POOL und
 * werden zwischen Prefabs wiederverwendet. Ein liegengebliebener
 * Farbpuffer träfe dann ein anderes Modell mit einer Instanzzahl, die
 * nicht mehr passt. Deshalb wird bei JEDEM Aufbau entschieden, auch für
 * `anzahl = 0`.
 */
function schreibeToenung(
  mesh: Mesh,
  mats: readonly Matrix[] | null,
  indizes: readonly number[] | null,
  anzahl: number
): void {
  if (!mats || anzahl === 0) {
    if (TOENUNGS_PUFFER.has(mesh)) {
      TOENUNGS_PUFFER.delete(mesh);
      mesh.thinInstanceSetBuffer('color', null, 4, false);
    }
    return;
  }
  const vorhanden = TOENUNGS_PUFFER.get(mesh);
  const puffer = vorhanden && vorhanden.length === anzahl * 4 ? vorhanden : new Float32Array(anzahl * 4);
  for (let k = 0; k < anzahl; k++) {
    const m = mats[indizes ? indizes[k]! : k]!.m;
    instanzToenung(m[12]!, m[14]!, puffer, k * 4);
  }
  if (puffer === vorhanden) {
    // Derselbe Puffer, neuer Inhalt: nur hochladen, keinen VertexBuffer
    // neu anlegen und keine Defines anfassen.
    mesh.thinInstanceBufferUpdated('color');
  } else {
    TOENUNGS_PUFFER.set(mesh, puffer);
    mesh.thinInstanceSetBuffer('color', puffer, 4, false);
  }
}

export { darfGetoentWerden, schreibeToenung };
