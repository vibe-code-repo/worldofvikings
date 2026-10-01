/**
 * Move proof, rule B11: nothing unexplained.
 *
 * What the tool cannot prove is a finding. The user releases it explicitly in the manifest, with a
 * reason, and the release is printed. A release holds for exactly one place or one name. A release
 * that releases nothing is a finding itself: it would stay in the manifest and cover the next
 * change at that place.
 */
import type { Befund, FreigegebenerBefund, Manifest, Protokoll } from './typen';

export interface Aufteilung {
  offen: Befund[];
  freigegeben: FreigegebenerBefund[];
}

export function wendeFreigabenAn(manifest: Manifest, p: Protokoll): Aufteilung {
  const nach = new Map(manifest.freigaben.map((f) => [f.schluessel, f]));
  const benutzt = new Set<string>();
  const offen: Befund[] = [];
  const freigegeben: FreigegebenerBefund[] = [];
  for (const b of p.befunde) {
    const f = b.freigabe === undefined ? undefined : nach.get(b.freigabe);
    if (f) {
      benutzt.add(f.schluessel);
      freigegeben.push({ freigabe: f, befund: b });
    } else {
      offen.push(b);
    }
  }
  for (const f of manifest.freigaben) {
    p.zaehle('B11');
    if (!benutzt.has(f.schluessel)) {
      offen.push({
        regel: 'B11',
        teil: 'freigabe-ungenutzt',
        ort: { seite: 'neu', datei: '(manifest)', zeile: 1, spalte: 1 },
        text: `release "${f.schluessel}" releases nothing: no finding carries this key`,
      });
    }
  }
  return { offen, freigegeben };
}
