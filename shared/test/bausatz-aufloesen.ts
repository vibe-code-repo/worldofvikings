/**
 * Auflöser `loeseBausaetzeAuf` (C2): Rundung, Drehung, kennungen, disjunkte ids, unbekannter Bausatz,
 * Grenze 10 000, Reihenfolge-Unabhängigkeit.
 *
 * Lauf: npx tsx shared/test/bausatz-aufloesen.ts   (aus shared/)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loeseBausaetzeAuf } from '../src/bausatz/aufloesen.js';
import { sanitizeWorldLayout } from '../src/worldlayout/sanitize.js';
import { sanitizeBausatz } from '../src/bausatz/sanitize.js';
import { BAUSATZ_AUFGELOEST_MAX, BAUSATZ_TEILE_MAX, type Bausatz } from '../src/bausatz/types.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const teil = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, prefab: 'kiste', dx: 0, dz: 0, yaw: 0, scale: 1, ...extra });
const kit = (id: string, teile: Record<string, unknown>[], extra: Record<string, unknown> = {}): Bausatz =>
  sanitizeBausatz({ bausatzVersion: 1, id, name: id, grundflaeche: { halbX: 10, halbZ: 10 }, teile, ...extra })!;
const katalog = (...k: Bausatz[]): Map<string, Bausatz> => new Map(k.map((b) => [b.id, b]));

// Pflichtfall Rundung
{
  const k = kit('r', [teil('t', { dx: 12.345 })]);
  const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'r', x: -22600, z: 0 }] }, katalog(k));
  pruefe('Rundung: −22600 + 12.345 = exakt −22587.655', r.teile[0]!.x === -22587.655, String(r.teile[0]?.x));
  // Zeuge, dass wirklich gerundet wird: 0.1 + 0.2 ist in Gleitkomma 0.30000000000000004
  const w = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'r2', x: 0.1, z: 0 }] }, katalog(kit('r2', [teil('t', { dx: 0.2 })])));
  pruefe('Rundung greift: 0.1 + 0.2 → exakt 0.3 (roh 0.30000000000000004)', 0.1 + 0.2 !== 0.3 && w.teile[0]!.x === 0.3, String(w.teile[0]?.x));
  pruefe('kein Fehler, nichts unbekannt', r.fehler.length === 0 && r.unbekannt.length === 0);
}
// Drehung um 90°
{
  const k = kit('d', [teil('t', { dx: 3, dz: 0, yaw: 0.25 }), teil('u', { dx: 0, dz: 2 })]);
  const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'd', x: 100, z: 200, yaw: Math.PI / 2 }] }, katalog(k));
  const t = r.teile.find((p) => p.teilId === 't')!;
  const u = r.teile.find((p) => p.teilId === 'u')!;
  // rechtshändig um +Y: (dx,dz)=(3,0) → (x',z') = (0,−3); (0,2) → (2,0)
  pruefe('90°: (3,0) → (100, 197)', t.x === 100 && t.z === 197, `${t.x},${t.z}`);
  pruefe('90°: (0,2) → (102, 200)', u.x === 102 && u.z === 200, `${u.x},${u.z}`);
  pruefe('Winkel = yaw_instanz + yaw_teil, ungerundet', t.yaw === Math.PI / 2 + 0.25 && u.yaw === Math.PI / 2, `${t.yaw} ${u.yaw}`);
  const r0 = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'd', x: 100, z: 200 }] }, katalog(k));
  pruefe('yaw 0: reine Verschiebung', r0.teile.find((p) => p.teilId === 't')!.x === 103 && r0.teile.find((p) => p.teilId === 'u')!.z === 202);
  const r180 = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'd', x: 0, z: 0, yaw: Math.PI }] }, katalog(k));
  pruefe('180°: (3,0) → (−3, 0) ohne −0', r180.teile.find((p) => p.teilId === 't')!.x === -3 && !Object.is(r180.teile.find((p) => p.teilId === 't')!.z, -0));
}
// kennungen und ids
{
  const k = kit('k', [teil('a'), teil('b', { dx: 1 })]);
  const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'dorf', bausatz: 'k', x: 0, z: 0, kennungen: { a: 'alte-id-a' } }] }, katalog(k));
  pruefe('kennungen übernimmt die id', r.teile.some((t) => t.id === 'alte-id-a' && t.teilId === 'a') && r.teile.some((t) => t.id === 'dorf#b'), r.teile.map((t) => t.id).join());
  const zwei = loeseBausaetzeAuf({ bausaetze: [{ id: 'i1', bausatz: 'k', x: 0, z: 0 }, { id: 'i2', bausatz: 'k', x: 50, z: 0 }] }, katalog(k));
  const ids = zwei.teile.map((t) => t.id);
  pruefe('zwei Instanzen desselben Bausatzes ohne kennungen: disjunkte ids', ids.length === 4 && new Set(ids).size === 4 && ids.every((i) => i.includes('#')), ids.join());
  const kollision = loeseBausaetzeAuf(
    { bausaetze: [{ id: 'i1', bausatz: 'k', x: 0, z: 0, kennungen: { a: 'x' } }, { id: 'i2', bausatz: 'k', x: 0, z: 0, kennungen: { a: 'x' } }] },
    katalog(k)
  );
  pruefe('doppelte aufgelöste id: benannter Fehler, Teil ausgelassen', kollision.fehler.length === 1 && /id "x" ist schon vergeben/.test(kollision.fehler[0]!) && kollision.teile.filter((t) => t.id === 'x').length === 1, kollision.fehler.join('|'));
  const mitPlatz = loeseBausaetzeAuf({ bausaetze: [{ id: 'i1', bausatz: 'k', x: 0, z: 0, kennungen: { a: 'da' } }], placements: [{ id: 'da' }] }, katalog(k));
  pruefe('id gleich einer Platzierungs-id: Fehler', mitPlatz.fehler.length === 1 && mitPlatz.teile.length === 1);
}
// unbekannt
{
  const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'gibtsnicht', x: 0, z: 0 }] }, katalog());
  pruefe('unbekannter Bausatz: in unbekannt, kein Fehler, kein Wurf', r.teile.length === 0 && r.fehler.length === 0 && r.unbekannt.length === 1 && r.unbekannt[0]!.instanz === 'i' && r.unbekannt[0]!.bausatz === 'gibtsnicht');
  pruefe('ohne bausaetze-Feld: alles leer', (() => { const e = loeseBausaetzeAuf({}, katalog()); return e.teile.length + e.unbekannt.length + e.fehler.length === 0; })());
  const feld = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'k2', x: 0, z: 0 }] }, [kit('k2', [teil('a')])]);
  pruefe('Katalog als Liste geht auch', feld.teile.length === 1);
}
// Reihenfolge der Teile
{
  const teile = ['c', 'a', 'b'].map((id, i) => teil(id, { dx: i }));
  const k1 = { ...kit('o', teile), teile: kit('o', teile).teile } as Bausatz;
  const k2: Bausatz = { ...k1, teile: [...k1.teile].reverse() }; // ohne den Sanitizer vertauscht
  const l = { bausaetze: [{ id: 'i', bausatz: 'o', x: 1, z: 2, yaw: 0.7 }] };
  pruefe('vertauschte Teil-Reihenfolge: identische Liste', JSON.stringify(loeseBausaetzeAuf(l, katalog(k1)).teile) === JSON.stringify(loeseBausaetzeAuf(l, katalog(k2)).teile));
}
// Felder
{
  const k = kit('f', [teil('t', { dy: 1.5, pitch: 0.1, roll: 0.2, scale: [1, -2, 3], einebnen: 6, gruppe: 'g', yaw: 0.1234567891 })], { gruppen: [{ id: 'g', name: 'G' }] });
  const t = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'f', x: 0, z: 0 }] }, katalog(k)).teile[0]!;
  pruefe('dy/pitch/roll/scale-Tripel/einebnen/gruppe werden durchgereicht', t.dy === 1.5 && t.pitch === 0.1 && t.roll === 0.2 && JSON.stringify(t.scale) === '[1,-2,3]' && t.einebnen === 6 && t.gruppe === 'g');
  const ohne = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'f2', x: 0, z: 0 }] }, katalog(kit('f2', [teil('t')]))).teile[0]!;
  pruefe('fehlendes dy bleibt fehlend (bodenfolgend)', !('dy' in ohne) && !('pitch' in ohne));
  pruefe('Winkel wird nicht gerundet (Regel der Platzierungen)', t.yaw === 0.1234567891, String(t.yaw));
}
// Grenze 10 000
{
  const gross = kit('g', Array.from({ length: BAUSATZ_TEILE_MAX }, (_, i) => teil(`t-${i}`)));
  const instanzen = [0, 1, 2].map((n) => ({ id: `i${n}`, bausatz: 'g', x: n, z: 0 }));
  const r = loeseBausaetzeAuf({ bausaetze: instanzen }, katalog(gross));
  pruefe(`${3 * BAUSATZ_TEILE_MAX} Teile > ${BAUSATZ_AUFGELOEST_MAX}: Fehler, nichts gekappt`, r.teile.length === 0 && r.fehler.length === 1 && /12000 aufgelöste Bausatz-Teile — mehr als 10000/.test(r.fehler[0]!), r.fehler.join());
  const genau = loeseBausaetzeAuf({ bausaetze: instanzen.slice(0, 2) }, katalog(gross));
  pruefe('8 000 Teile: aufgelöst', genau.teile.length === 8000 && genau.fehler.length === 0);
  const zehn = kit('z', Array.from({ length: 2500 }, (_, i) => teil(`t-${i}`)));
  const exakt = loeseBausaetzeAuf({ bausaetze: [0, 1, 2, 3].map((n) => ({ id: `i${n}`, bausatz: 'z', x: n, z: 0 })) }, katalog(zehn));
  pruefe('genau 10 000: erlaubt', exakt.teile.length === 10000 && exakt.fehler.length === 0);
  const elf = loeseBausaetzeAuf({ bausaetze: [0, 1, 2, 3].map((n) => ({ id: `i${n}`, bausatz: 'z', x: n, z: 0 })).concat([{ id: 'i4', bausatz: 'k-fehlt', x: 0, z: 0 }, { id: 'i5', bausatz: 'z', x: 9, z: 0 }]) }, katalog(zehn));
  pruefe('10 002+ Teile: Fehler; unbekannter Bausatz wird trotzdem gemeldet', elf.teile.length === 0 && elf.fehler.length === 1 && elf.unbekannt.length === 1);
}

// M1: kennungen nur über eigene Eigenschaften (Teil-id constructor & Co. ist eine String-id, nie eine Funktion)
{
  const namen = ['constructor', 'tostring', 'hasownproperty', 'valueof'];
  const k = kit('p', namen.map((n) => teil(n)));
  pruefe('Teil-id constructor besteht den Sanitizer', k.teile.some((t) => t.id === 'constructor'));
  for (const [titel, kennungen] of [['ohne kennungen', undefined], ['mit kennungen', { a: 'alt-a' }], ['mit leerem kennungen', {}]] as const) {
    const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'p', x: 0, z: 0, ...(kennungen ? { kennungen } : {}) }] }, katalog(k));
    pruefe(`M1 ${titel}: alle ids sind Strings i#<teil>`, r.fehler.length === 0 && r.teile.length === 4 && r.teile.every((t) => typeof t.id === 'string' && t.id === `i#${t.teilId}`), r.teile.map((t) => typeof t.id).join());
  }
  // am Sanitizer vorbei: Namen mit Großbuchstaben und __proto__
  const roh: Bausatz = { ...k, teile: ['toString', '__proto__', 'constructor'].map((n) => ({ id: n, prefab: 'kiste', dx: 0, dz: 0, yaw: 0, scale: 1 })) };
  const r2 = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'p', x: 0, z: 0, kennungen: { a: 'alt-a' } }] }, katalog(roh));
  pruefe('M1 toString/__proto__/constructor am Sanitizer vorbei: String-ids', r2.teile.length === 3 && r2.teile.every((t) => typeof t.id === 'string' && t.id === `i#${t.teilId}`), r2.teile.map((t) => String(t.id)).join('|'));
  // zwei Instanzen: keine falsche Doppelvergabe
  const r3 = loeseBausaetzeAuf({ bausaetze: [{ id: 'i1', bausatz: 'p', x: 0, z: 0, kennungen: { a: 'x1' } }, { id: 'i2', bausatz: 'p', x: 9, z: 0, kennungen: { a: 'x2' } }] }, katalog(k));
  pruefe('M1 zwei Instanzen mit kennungen: 8 Teile, kein Fehler', r3.teile.length === 8 && r3.fehler.length === 0);
}
// N3: nicht endliche Eingaben am Sanitizer vorbei
{
  const basis = kit('n', [teil('a'), teil('b')]);
  const schlecht = (extra: Record<string, unknown>): Bausatz => ({ ...basis, teile: [{ ...basis.teile[0]!, ...extra } as never, basis.teile[1]!] });
  for (const [titel, extra] of [['dx NaN', { dx: NaN }], ['dz Infinity', { dz: Infinity }], ['yaw 1e999', { yaw: 1e999 }], ['scale NaN', { scale: NaN }], ['scale-Tripel mit Infinity', { scale: [1, Infinity, 1] }]] as const) {
    const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'n', x: 0, z: 0 }] }, katalog(schlecht(extra)));
    const sauber = JSON.stringify(r.teile).includes('null') || r.teile.some((t) => [t.x, t.z, t.yaw].some((v) => !Number.isFinite(v)));
    pruefe(`N3 ${titel}: fehler, Teil ausgelassen, nie NaN/null`, r.fehler.length === 1 && /keine endliche Zahl/.test(r.fehler[0]!) && r.teile.length === 1 && r.teile[0]!.teilId === 'b' && !sauber, r.fehler.join());
  }
  const ri = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'n', x: NaN, z: 0 }, { id: 'j', bausatz: 'n', x: 0, z: 0, yaw: Infinity }, { id: 'k', bausatz: 'n', x: 1, z: 1 }] }, katalog(basis));
  pruefe('N3 Instanz mit NaN-x / Infinity-yaw: ausgelassen mit Fehler, Rest bleibt', ri.fehler.length === 2 && ri.teile.length === 2 && ri.teile.every((t) => t.instanz === 'k'), ri.fehler.join());
}
// N2 A1: jedes Eingabefeld wird genau einmal gelesen (Getter, der beim zweiten Zugriff NaN/Infinity liefert)
{
  const basis = kit('g', [teil('a'), teil('b')]);
  const einmalEndlich = (o: Record<string, unknown>, feld: string, erst: number, danach: number): Record<string, unknown> => {
    let n = 0;
    Object.defineProperty(o, feld, { enumerable: true, get: () => (n++ === 0 ? erst : danach) });
    return o;
  };
  const alleEndlich = (r: ReturnType<typeof loeseBausaetzeAuf>): boolean =>
    r.teile.every((t) => [t.x, t.z, t.yaw, t.dy, t.pitch, t.roll].every((v) => v === undefined || Number.isFinite(v)) && (typeof t.scale === 'number' ? Number.isFinite(t.scale) : t.scale.every(Number.isFinite)));
  for (const feld of ['dx', 'dz', 'dy', 'yaw', 'pitch', 'roll', 'scale']) for (const danach of [NaN, Infinity]) {
    const schlecht = einmalEndlich({ ...basis.teile[0]! }, feld, 1, danach);
    const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'g', x: 0, z: 0 }] }, katalog({ ...basis, teile: [schlecht as never, basis.teile[1]!] }));
    pruefe(`A1 Teil-Getter ${feld} (1, dann ${danach}): nie NaN/Infinity im Ergebnis`, alleEndlich(r) && r.teile.length >= 1, JSON.stringify(r.teile.map((t) => [t.x, t.z, t.yaw])));
  }
  for (const feld of ['x', 'z', 'yaw']) for (const danach of [NaN, Infinity]) {
    const schlecht = einmalEndlich({ id: 'i', bausatz: 'g', x: 0, z: 0 }, feld, 2, danach);
    const r = loeseBausaetzeAuf({ bausaetze: [schlecht as never, { id: 'j', bausatz: 'g', x: 1, z: 1 }] }, katalog(basis));
    pruefe(`A1 Instanz-Getter ${feld} (2, dann ${danach}): nie NaN/Infinity im Ergebnis`, alleEndlich(r) && r.fehler.length === 0 && r.teile.length === 4, JSON.stringify(r.teile.map((t) => [t.x, t.z, t.yaw])));
  }
  // erster Zugriff schlecht: benannter Fehler, Teil bzw. Instanz ausgelassen
  const erstSchlecht = einmalEndlich({ ...basis.teile[0]! }, 'dx', NaN, 1);
  const r1 = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'g', x: 0, z: 0 }] }, katalog({ ...basis, teile: [erstSchlecht as never, basis.teile[1]!] }));
  pruefe('A1 Teil-Getter dx (NaN, dann 1): fehler, Teil ausgelassen', r1.fehler.length === 1 && r1.teile.length === 1 && r1.teile[0]!.teilId === 'b');
  const erstInst = einmalEndlich({ id: 'i', bausatz: 'g', x: 0, z: 0 }, 'x', Infinity, 1);
  const r2 = loeseBausaetzeAuf({ bausaetze: [erstInst as never] }, katalog(basis));
  pruefe('A1 Instanz-Getter x (Infinity, dann 1): fehler, Instanz ausgelassen', r2.fehler.length === 1 && r2.teile.length === 0);
}
// N4 B2/Y1: the scale triple is ALWAYS copied before it is checked; only the copy is used
{
  const basis = kit('sk', [teil('a', { scale: [1, 2, 3] })]);
  const r0 = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'sk', x: 0, z: 0 }] }, katalog(basis));
  const s0 = r0.teile[0]!.scale;
  pruefe('B2 Skala: Ergebnis-Tripel ist nicht dasselbe Array wie im Katalog, aber gleich', Array.isArray(s0) && s0 !== basis.teile[0]!.scale && s0.join() === '1,2,3');
  // proxy array: length 2 at the first read, 3 afterwards; element 0 is 1 at the first read, NaN afterwards
  const proxyArray = (lengths: number[]): unknown => {
    let l = 0;
    const z = [0, 0];
    return new Proxy([1, 2, 3], {
      get: (t, k) => (k === 'length' ? lengths[Math.min(l++, lengths.length - 1)] : k === '0' ? (z[0]!++ === 0 ? 1 : NaN) : Reflect.get(t, k)),
    });
  };
  const kaputt = { ...basis, teile: [{ ...basis.teile[0]!, scale: proxyArray([2, 3]) } as never] };
  const r1 = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'sk', x: 0, z: 0 }] }, katalog(kaputt));
  pruefe('B2 Skala-Proxy (length 2, dann 3): benannter Fehler, Teil ausgelassen, nichts Rohes im Ergebnis', r1.teile.length === 0 && r1.fehler.length === 1, JSON.stringify(r1.fehler));
  const flackernd = { ...basis, teile: [{ ...basis.teile[0]!, scale: proxyArray([3, 2]) } as never] };
  const r2 = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'sk', x: 0, z: 0 }] }, katalog(flackernd));
  const s2 = r2.teile[0]?.scale;
  pruefe('B2 Skala-Proxy (length 3, dann 2, [0] 1, dann NaN): echte Kopie [1,2,3], nie NaN', r2.teile.length === 1 && Array.isArray(s2) && s2.join() === '1,2,3', JSON.stringify(s2));
}
// N2 A2/X8: dy, pitch und roll werden im Auflöser geprüft
{
  const basis = kit('w', [teil('a'), teil('b')]);
  for (const feld of ['dy', 'pitch', 'roll']) for (const wert of [NaN, Infinity]) {
    const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'w', x: 0, z: 0 }] }, katalog({ ...basis, teile: [{ ...basis.teile[0]!, [feld]: wert } as never, basis.teile[1]!] }));
    pruefe(`X8 ${feld} ${wert}: fehler, Teil ausgelassen`, r.fehler.length === 1 && /keine endliche Zahl/.test(r.fehler[0]!) && r.teile.length === 1 && r.teile[0]!.teilId === 'b', r.fehler.join());
  }
}
// N2 A2/X9: ein geerbter String in kennungen (Object.create, am Sanitizer vorbei) ist keine Adresse
{
  const k = kit('e', [teil('a'), teil('b')]);
  const geerbt = Object.create({ a: 'geerbt-a' }) as Record<string, string>;
  const r = loeseBausaetzeAuf({ bausaetze: [{ id: 'i', bausatz: 'e', x: 0, z: 0, kennungen: geerbt }] }, katalog(k));
  pruefe('X9 geerbter String in kennungen: id i#a, nicht geerbt-a', r.teile.some((t) => t.id === 'i#a') && !r.teile.some((t) => t.id === 'geerbt-a'), r.teile.map((t) => t.id).join());
}
// N5 C2: raw kennungen that is no plain object (string, array, null, number, true) is "no kennungen": no address, no throw
{
  const k = kit('r', [teil('0'), teil('weg')]);
  for (const roh of ['ab', ['q'], null, 5, true] as unknown[]) {
    let ids = '';
    let geworfen = '';
    try {
      ids = loeseBausaetzeAuf({ bausaetze: [{ id: 's', bausatz: 'r', x: 0, z: 0, kennungen: roh } as never] }, katalog(k)).teile.map((t) => t.id).join();
    } catch (e) {
      geworfen = String(e);
    }
    pruefe(`C2 rohe kennungen ${JSON.stringify(roh)}: keine Adresse, kein Wurf (s#0,s#weg)`, geworfen === '' && ids === 's#0,s#weg', geworfen || ids);
  }
}
// N6 D1: kennungen is read exactly once (getter: first an object, then "ab"; never the address "a")
{
  const k = kit('r', [teil('0'), teil('weg')]);
  let n = 0;
  const i = { id: 's', bausatz: 'r', x: 0, z: 0 };
  Object.defineProperty(i, 'kennungen', { enumerable: true, get: () => (n++ === 0 ? { weg: 'gut' } : 'ab') });
  const ids = loeseBausaetzeAuf({ bausaetze: [i as never] }, katalog(k)).teile.map((t) => t.id).join();
  pruefe('D1 kennungen wird genau einmal gelesen (gut,s#0, kein "a")', n === 1 && ids === 'gut,s#0', `${n} Lesezugriffe, ${ids}`);
}
// N6 D2: kennungen with a null prototype or frozen are valid kennungen
{
  const k = kit('r', [teil('0'), teil('weg')]);
  const nullProto = Object.assign(Object.create(null) as Record<string, string>, { weg: 'nw' });
  for (const [titel, roh] of [['null-Prototyp', nullProto], ['eingefroren', Object.freeze({ weg: 'fw' })]] as const) {
    const ids = loeseBausaetzeAuf({ bausaetze: [{ id: 's', bausatz: 'r', x: 0, z: 0, kennungen: roh } as never] }, katalog(k)).teile.map((t) => t.id).join();
    pruefe(`D2 kennungen ${titel}: Adresse angewendet`, ids === `${roh.weg},s#0`, ids);
  }
}
// N6 D3: boxed String/Number/Boolean objects are no kennungen (no address from the characters of 'ab')
{
  const k = kit('r', [teil('0'), teil('weg')]);
  for (const roh of [new String('ab'), new Number(5), new Boolean(true)] as unknown[]) {
    const ids = loeseBausaetzeAuf({ bausaetze: [{ id: 's', bausatz: 'r', x: 0, z: 0, kennungen: roh } as never] }, katalog(k)).teile.map((t) => t.id).join();
    pruefe(`D3 kennungen ${Object.prototype.toString.call(roh)}: keine Adresse (s#0,s#weg)`, ids === 's#0,s#weg', ids);
  }
}
// M3: jede Platzierung des echten dev.json als Teil, Anker mm-Koordinate mit yaw 0 — byte-gleich zum Vergleichsschlüssel
{
  const dev = sanitizeWorldLayout(JSON.parse(readFileSync(fileURLToPath(new URL('../../server/data/welten/dev.json', import.meta.url)), 'utf8')))!;
  const pl = dev.placements ?? [];
  // Vergleichsschlüssel wie `eintrag()` in server/src/world/layoutLiveAbgleich.ts (dort gelesen, nicht importiert)
  const eintrag = (p: { id?: string; prefab: string; x: number; z: number; yaw?: number; scale?: unknown; route?: string; einebnen?: number; npc?: unknown }): string =>
    JSON.stringify([p.id ?? null, p.prefab, p.x, p.z, p.yaw ?? 0, p.scale ?? 1, p.route ?? null, p.einebnen ?? 0, p.npc ?? null]);
  const kits = pl.map((p, n) => kit(`k${n}`, [teil('t', { prefab: p.prefab, dx: Math.round((p.x - (Math.round(p.x / 100) * 100 + 0.5)) * 1000) / 1000, dz: Math.round((p.z - (Math.round(p.z / 100) * 100 + 0.25)) * 1000) / 1000, yaw: p.yaw ?? 0, scale: p.scale ?? 1, ...(p.einebnen !== undefined ? { einebnen: p.einebnen } : {}) })]));
  const inst = pl.map((p, n) => ({ id: `i${n}`, bausatz: `k${n}`, x: Math.round(p.x / 100) * 100 + 0.5, z: Math.round(p.z / 100) * 100 + 0.25, kennungen: { t: p.id! } }));
  const r = loeseBausaetzeAuf({ bausaetze: inst }, katalog(...kits));
  const nachId = new Map(r.teile.map((t) => [t.id, t]));
  let pos = 0, winkel = 0, skala = 0, voll = 0, vollMoeglich = 0;
  for (const p of pl) {
    const t = nachId.get(p.id!);
    if (!t) continue;
    if (t.x === p.x && t.z === p.z) pos++;
    if (t.yaw === (p.yaw ?? 0)) winkel++;
    if (t.scale === (p.scale ?? 1)) skala++;
    if (p.route === undefined && p.npc === undefined) {
      vollMoeglich++;
      const gleich = eintrag({ id: t.id, prefab: t.prefab, x: t.x, z: t.z, yaw: t.yaw, scale: t.scale, einebnen: t.einebnen }) === eintrag(p);
      if (gleich) voll++;
    }
  }
  console.log(`M3 Zahlen: ${pl.length} Platzierungen; Position ${pos}/${pl.length}, yaw ${winkel}/${pl.length}, scale ${skala}/${pl.length}; Vergleichsschlüssel byte-gleich ${voll}/${vollMoeglich} (ohne route/npc)`);
  pruefe('M3 echtes dev.json: Position, yaw und scale aller Platzierungen byte-gleich', pl.length > 200 && pos === pl.length && winkel === pl.length && skala === pl.length && r.fehler.length === 0, r.fehler.slice(0, 2).join());
  pruefe('M3 Vergleichsschlüssel eintrag() byte-gleich (Platzierungen ohne route/npc)', vollMoeglich > 0 && voll === vollMoeglich, `${voll}/${vollMoeglich}`);
  pruefe('M3 mindestens ein yaw abseits des 1e-6-Rasters (der Test ist nicht leer)', pl.some((p) => p.yaw !== undefined && Math.round(p.yaw * 1e6) / 1e6 !== p.yaw));
}

console.log(fehler === 0 ? 'ALLES OK' : `${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
