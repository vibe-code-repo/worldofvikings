/**
 * Auflöser `loeseBausaetzeAuf` (C2): Rundung, Drehung, kennungen, disjunkte ids, unbekannter Bausatz,
 * Grenze 10 000, Reihenfolge-Unabhängigkeit.
 *
 * Lauf: npx tsx shared/test/bausatz-aufloesen.ts   (aus shared/)
 */
import { loeseBausaetzeAuf } from '../src/bausatz/aufloesen.js';
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

console.log(fehler === 0 ? 'ALLES OK' : `${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
