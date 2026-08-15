/**
 * TerrainComp ↔ Bytes (D9).
 *
 * Bis hierher lebte das Spieler-Terraforming als unbegrenzt wachsende
 * Liste von Einzeloperationen: Sie ging komplett in jeden Save UND wurde
 * jedem neu verbindenden Peer vollständig zugeschickt. Save-Größe und
 * Join-Dauer wuchsen damit linear mit der Spielzeit — nach einem Jahr
 * Bauen schickt der Server jedem Neuling jeden Hackenschlag von damals.
 *
 * Verdichtet wird nicht die Liste, sondern ihr ERGEBNIS. Der `TerrainComp`
 * einer Zone IST der Endzustand aller Operationen darin (Höhen-Deltas und
 * Farbmaske über der generierten Landschaft); ihn zu übertragen ist damit
 * per Konstruktion verlustfrei — es gibt keine Zusammenfassungsregel, die
 * etwas falsch machen könnte. Und die Größe ist gedeckelt: 65×65 Vertices
 * je Zone, egal wie lange gespielt wurde.
 *
 * Warum das Format hier und nicht je einmal in Server und Client: Es ist
 * dasselbe Format für den Save (base64) und fürs Netz, und zwei Kopien
 * einer Byteschieberei driften auseinander, sobald jemand ein Feld
 * ergänzt.
 *
 * Aufbau (little-endian, wie alles andere im Projekt):
 *
 *   int32   zoneX
 *   int32   zoneY
 *   uint8   teile      Bit0 = Höhenteil folgt, Bit1 = Farbteil folgt
 *   [Höhe]  uint32 nMod,    nMod    × uint16 index
 *           uint32 nLevel,  nLevel  × { uint16 index, f32 wert }
 *           uint32 nSmooth, nSmooth × { uint16 index, f32 wert }
 *   [Farbe] uint32 nFarbe,  nFarbe  × { uint16 index, u8 r, g, b, a }
 *
 * `index` ist der Vertex-/Texel-Index im 65×65-Raster und passt deshalb in
 * 16 Bit (max. 4224).
 *
 * Die BERÜHRT-Markierung steht getrennt von den Werten, weil beide nicht
 * deckungsgleich sind: Planieren setzt den Glättungs-Delta auf null und
 * lässt die Markierung stehen. Beides in einem Satz zu führen kostete
 * 8 Byte je Vertex für Werte, die meist null sind; so kostet ein nur
 * markierter Vertex 2 Byte. Und weil die Markierungen mitgeschrieben
 * werden statt aus „Wert ungleich null" erraten, ist der dekodierte Comp
 * Feld für Feld derselbe wie der kodierte.
 */

import { TerrainComp } from './TerrainComp.js';

const TEIL_HOEHE = 1;
const TEIL_FARBE = 2;

/** Vertices je Zonenraster (65×65) — s. TerrainComp. */
const GRID = 65 * 65;

/**
 * Werte, die weggelassen werden dürfen, weil das frische Float32Array sie
 * ohnehin führt. Negative Null gehört NICHT dazu: `-0 === 0` ist wahr, das
 * Bitmuster aber ein anderes — und „identischer Endzustand" heisst hier
 * wirklich Bit für Bit.
 */
function nichtNull(v: number): boolean {
  return v !== 0 || Object.is(v, -0);
}

export function kodiereTerrainComp(comp: TerrainComp): Uint8Array {
  const levelDelta = comp.levelDelta;
  const smoothDelta = comp.smoothDelta;
  const modHoehe = comp.modifiedHeight;
  const maske = comp.paintMask;
  const modFarbe = comp.modifiedPaint;

  let modAnzahl = 0;
  let levelAnzahl = 0;
  let smoothAnzahl = 0;
  if (modHoehe) {
    for (let i = 0; i < GRID; i++) {
      if (modHoehe[i]) modAnzahl++;
      if (nichtNull(levelDelta![i]!)) levelAnzahl++;
      if (nichtNull(smoothDelta![i]!)) smoothAnzahl++;
    }
  }
  let farbAnzahl = 0;
  if (modFarbe) for (let i = 0; i < GRID; i++) if (modFarbe[i]) farbAnzahl++;

  const hatHoehe = modAnzahl > 0 || levelAnzahl > 0 || smoothAnzahl > 0;
  const teile = (hatHoehe ? TEIL_HOEHE : 0) | (farbAnzahl > 0 ? TEIL_FARBE : 0);
  const laenge =
    9 +
    (hatHoehe ? 12 + modAnzahl * 2 + levelAnzahl * 6 + smoothAnzahl * 6 : 0) +
    (farbAnzahl > 0 ? 4 + farbAnzahl * 6 : 0);

  const bytes = new Uint8Array(laenge);
  const sicht = new DataView(bytes.buffer);
  let p = 0;
  sicht.setInt32(p, comp.zoneX, true); p += 4;
  sicht.setInt32(p, comp.zoneY, true); p += 4;
  sicht.setUint8(p, teile); p += 1;

  if (hatHoehe) {
    sicht.setUint32(p, modAnzahl, true); p += 4;
    for (let i = 0; i < GRID; i++) {
      if (!modHoehe![i]) continue;
      sicht.setUint16(p, i, true); p += 2;
    }
    sicht.setUint32(p, levelAnzahl, true); p += 4;
    for (let i = 0; i < GRID; i++) {
      if (!nichtNull(levelDelta![i]!)) continue;
      sicht.setUint16(p, i, true); p += 2;
      sicht.setFloat32(p, levelDelta![i]!, true); p += 4;
    }
    sicht.setUint32(p, smoothAnzahl, true); p += 4;
    for (let i = 0; i < GRID; i++) {
      if (!nichtNull(smoothDelta![i]!)) continue;
      sicht.setUint16(p, i, true); p += 2;
      sicht.setFloat32(p, smoothDelta![i]!, true); p += 4;
    }
  }
  if (farbAnzahl > 0) {
    sicht.setUint32(p, farbAnzahl, true); p += 4;
    for (let i = 0; i < GRID; i++) {
      if (!modFarbe![i]) continue;
      sicht.setUint16(p, i, true); p += 2;
      const o = i * 4;
      bytes[p++] = maske![o]!;
      bytes[p++] = maske![o + 1]!;
      bytes[p++] = maske![o + 2]!;
      bytes[p++] = maske![o + 3]!;
    }
  }
  return bytes;
}

export function dekodiereTerrainComp(bytes: Uint8Array): TerrainComp {
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const zoneX = sicht.getInt32(p, true); p += 4;
  const zoneY = sicht.getInt32(p, true); p += 4;
  const teile = sicht.getUint8(p); p += 1;

  const comp = new TerrainComp(zoneX, zoneY);
  if (teile & TEIL_HOEHE) {
    comp.ensureHeight();
    const levelDelta = comp.levelDelta!;
    const smoothDelta = comp.smoothDelta!;
    const modHoehe = comp.modifiedHeight!;
    let anzahl = sicht.getUint32(p, true); p += 4;
    for (let n = 0; n < anzahl; n++) {
      modHoehe[sicht.getUint16(p, true)] = 1; p += 2;
    }
    anzahl = sicht.getUint32(p, true); p += 4;
    for (let n = 0; n < anzahl; n++) {
      const i = sicht.getUint16(p, true); p += 2;
      levelDelta[i] = sicht.getFloat32(p, true); p += 4;
    }
    anzahl = sicht.getUint32(p, true); p += 4;
    for (let n = 0; n < anzahl; n++) {
      const i = sicht.getUint16(p, true); p += 2;
      smoothDelta[i] = sicht.getFloat32(p, true); p += 4;
    }
  }
  if (teile & TEIL_FARBE) {
    const anzahl = sicht.getUint32(p, true); p += 4;
    // ensurePaint setzt Alpha flächendeckend auf 255 — genau der Zustand,
    // von dem auch der Kodierer ausging (PaintCleared fasst Alpha nie an).
    comp.ensurePaint();
    const maske = comp.paintMask!;
    const modFarbe = comp.modifiedPaint!;
    for (let n = 0; n < anzahl; n++) {
      const i = sicht.getUint16(p, true); p += 2;
      const o = i * 4;
      maske[o] = bytes[p++]!;
      maske[o + 1] = bytes[p++]!;
      maske[o + 2] = bytes[p++]!;
      maske[o + 3] = bytes[p++]!;
      modFarbe[i] = 1;
    }
  }
  return comp;
}

/** Save-Weg: derselbe Inhalt als base64-Text im JSON-Umschlag. */
export function terrainCompNachBase64(comp: TerrainComp): string {
  const bytes = kodiereTerrainComp(comp);
  // Buffer gibt es nur auf dem Server; btoa nur im Browser. Der Save-Weg
  // laeuft ausschliesslich serverseitig, deshalb reicht der Buffer-Zweig —
  // der Fallback haelt die Funktion trotzdem im Client-Bundle lauffaehig.
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function terrainCompAusBase64(text: string): TerrainComp {
  if (typeof Buffer !== 'undefined') {
    return dekodiereTerrainComp(new Uint8Array(Buffer.from(text, 'base64')));
  }
  const roh = atob(text);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return dekodiereTerrainComp(bytes);
}
