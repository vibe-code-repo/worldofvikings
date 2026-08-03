/**
 * PNG-Dekoder für die Diagnose-Werkzeuge.
 *
 * Herausgelöst aus `tools/png-stats.mjs`, damit `shot-stats.mjs` denselben
 * Decoder benutzt statt einer zweiten Kopie. Wichtig ist vor allem die
 * Rückrechnung der Zeilenfilter: Statistiken über die ROHEN IDAT-Bytes sind
 * wertlos, sobald ein Bild andere Filter als 0 (None) benutzt — genau das ist
 * bei den Unity-Exporten der Fall. Ohne Rückrechnung entscheidet man auf Basis
 * von Zufallszahlen.
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

/**
 * Dekodiert ein 8-Bit-PNG vollständig.
 * @returns {{w:number,h:number,ch:number,ct:number,data:Buffer}} ch = Kanäle je Pixel
 */
export function decode(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: kein PNG`);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const depth = b[24];
  const ct = b[25];
  if (depth !== 8) throw new Error(`${file}: nur 8 Bit unterstützt (ist ${depth})`);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;

  let off = 8;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') idat.push(b.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));

  // Zeilenfilter rückrechnen (PNG-Spec 9.2)
  const out = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const rawV = raw[p++];
      const a = x >= ch ? row[x - ch] : 0;
      const bb = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v;
      switch (filter) {
        case 0: v = rawV; break;
        case 1: v = rawV + a; break;
        case 2: v = rawV + bb; break;
        case 3: v = rawV + ((a + bb) >> 1); break;
        case 4: {
          const pp = a + bb - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
          v = rawV + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c);
          break;
        }
        default: throw new Error(`${file}: unbekannter Filter ${filter}`);
      }
      row[x] = v & 0xff;
    }
  }
  return { w, h, ch, ct, data: out };
}
