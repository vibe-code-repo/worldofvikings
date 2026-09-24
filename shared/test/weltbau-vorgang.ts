/**
 * ops_apply / undo_last, reiner Teil: Vorgang bauen, lokal vorausrechnen,
 * Gegenvorgang, Undo-Stapel. (Den Weg über den Betriebsdienst prüft
 * tools/worldlayout-mcp/probe-kontext.ts.)
 *
 * Lauf: npx tsx shared/test/weltbau-vorgang.ts   (aus shared/)
 */
import { PREFABS_BY_NAME } from '../src/prefabs.js';
import { sanitizeWorldLayout } from '../src/worldlayout/sanitize.js';
import { invertiere, wende } from '../src/worldlayout/ops.js';
import type { WorldLayout } from '../src/worldlayout/types.js';
import { baueVorgang, VorgangFehler, OPS_MAX_JE_AUFRUF, type OpEingabe } from '../src/weltbau/vorgangBauen.js';
import { VorgangsStapel, STAPEL_MAX } from '../src/weltbau/stapel.js';
import { diffLayouts } from '../src/weltbau/diff.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const KISTE = 'environment-chestbottom';
const FASS = 'environment-barrel-destructible';
pruefe('Testprefabs sind im Katalog', PREFABS_BY_NAME.has(KISTE) && PREFABS_BY_NAME.has(FASS));
const bekannt = (n: string): boolean => PREFABS_BY_NAME.has(n);

const roh = {
  version: 1,
  name: 'Vorgang-Test',
  detailSeed: 's',
  continents: [],
  regions: [
    { id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 500 }, edgeFalloff: 100 },
    { id: 'wald', biome: 'blackforest', shape: { kind: 'circle', x: 900, z: 0, radius: 200 }, edgeFalloff: 100 },
  ],
  placements: [
    { id: 'a1', prefab: KISTE, x: 1, z: 1 },
    { id: 'b2', prefab: FASS, x: 2, z: 2 },
  ],
};
const BASIS = sanitizeWorldLayout(roh) as WorldLayout;
pruefe('Basisdokument gültig', BASIS !== null && (BASIS.placements?.length ?? 0) === 2);
const bytes = (l: WorldLayout): string => JSON.stringify(sanitizeWorldLayout(l));
const vorher = bytes(BASIS);

const bau = (ops: OpEingabe[], id = 'v1'): ReturnType<typeof baueVorgang> => baueVorgang(BASIS, ops, { vorgangId: id, pruefePrefab: bekannt, zufall: () => 0.5 });
const meldung = (ops: OpEingabe[]): string => {
  try {
    bau(ops);
    return '';
  } catch (f) {
    return f instanceof VorgangFehler ? f.message : `FALSCHER FEHLERTYP ${String(f)}`;
  }
};

// ── Nachweis: 3 Platzierungen neu + 1 Region geändert → wende → Gegenvorgang = bytegleich ──
const vier: OpEingabe[] = [
  { art: 'setze', sammlung: 'placements', nachher: { prefab: KISTE, x: 10, z: 10 } },
  { art: 'setze', sammlung: 'placements', nachher: { prefab: KISTE, x: 10, z: 12 } },
  { art: 'setze', sammlung: 'placements', nachher: { prefab: FASS, x: 12, z: 10 } },
  { art: 'aendere', sammlung: 'regions', id: 'kern', nachher: { id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 600 }, edgeFalloff: 100 } },
];
const v4 = bau(vier);
const w4 = wende(BASIS, v4);
pruefe('3 neue Platzierungen + 1 Region: Vorgang wird angewendet', w4.ok === true);
if (w4.ok) {
  const d = diffLayouts(BASIS, w4.layout);
  pruefe('Zähler: 3 neu, 1 geändert, 0 entfernt, Geo betroffen', d.zaehler.neu === 3 && d.zaehler.geaendert === 1 && d.zaehler.entfernt === 0 && d.geo === true, d.text);
  const ids = (w4.layout.placements ?? []).map((p) => p.id);
  pruefe('Frische ids sind eindeutig und tragen das Prefab', new Set(ids).size === 5 && ids.filter((i) => i.startsWith('environment-chestbottom')).length === 2 && ids.filter((i) => i.startsWith('environment-barrel')).length === 1, ids.join(','));
  pruefe('Trockenfahrt verändert das Eingabedokument nicht', bytes(BASIS) === vorher);
  const zurueck = wende(w4.layout, invertiere(v4));
  pruefe('Gegenvorgang: Dokument bytegleich mit dem Stand vorher', zurueck.ok && bytes(zurueck.layout) === vorher);
  pruefe('Gegenvorgang trägt die Undo-Marke ~', invertiere(v4).vorgangId === '~v1' && invertiere(invertiere(v4)).vorgangId === 'v1');
}

// ── entferne + aendere mit automatischem vorher, Undo bytegleich ──
const v2 = bau([
  { art: 'entferne', sammlung: 'placements', id: 'a1' },
  { art: 'aendere', sammlung: 'placements', id: 'b2', nachher: { prefab: FASS, x: 5, z: 5, yaw: 1 } },
  { art: 'entferne', sammlung: 'regions', id: 'wald' },
]);
pruefe('aendere/entferne: vorher wird aus dem Dokument eingesetzt', v2.ops.every((o) => o.art === 'setze' || o.vorher !== undefined) && v2.ops.length === 3);
const w2 = wende(BASIS, v2);
pruefe('entferne/aendere angewendet: 1 Platzierung, 1 Region weg', w2.ok && w2.layout.placements?.length === 1 && w2.layout.regions.length === 1);
if (w2.ok) {
  const zurueck = wende(w2.layout, invertiere(v2));
  pruefe('Undo entfernen+ändern: bytegleich (Region an alter Stelle)', zurueck.ok && bytes(zurueck.layout) === vorher);
}

// ── Konflikt bei fremder Änderung am selben Objekt ──
const streng = bau([{ art: 'aendere', sammlung: 'placements', id: 'a1', nachher: { prefab: KISTE, x: 9, z: 9 }, vorher: { prefab: KISTE, x: 99, z: 99 } }]);
const wk = wende(BASIS, streng);
pruefe('vorher stimmt nicht: Konflikt an a1, nichts angewendet', !wk.ok && wk.art === 'konflikt' && wk.ids.join() === 'a1');
const wSchon = wende(BASIS, bau([{ art: 'setze', sammlung: 'placements', id: 'a1', nachher: { prefab: KISTE, x: 3, z: 3 } }]));
pruefe('setze auf vorhandene id: Konflikt', !wSchon.ok && wSchon.art === 'konflikt');

// ── Eingabefehler ──
pruefe('Unbekanntes Prefab: Fehler mit Namen und Hinweis auf catalog_search', /Halluzinierbaum/.test(meldung([{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'Halluzinierbaum', x: 1, z: 1 } }])) && /catalog_search/.test(meldung([{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'Halluzinierbaum', x: 1, z: 1 } }])));
try {
  bau([{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'Unsinn1', x: 1, z: 1 } }, { art: 'setze', sammlung: 'placements', nachher: { prefab: 'Unsinn2', x: 2, z: 2 } }]);
} catch (f) {
  pruefe('Alle unbekannten Namen werden gemeldet', f instanceof VorgangFehler && f.unbekannteNamen.join() === 'Unsinn1,Unsinn2');
}
pruefe('Region ohne id: Fehler', /braucht eine `id`/.test(meldung([{ art: 'setze', sammlung: 'regions', nachher: { biome: 'grassland' } }])));
pruefe('Doppelte (Sammlung, id): Fehler', /mehrfach/.test(meldung([{ art: 'entferne', sammlung: 'placements', id: 'a1' }, { art: 'entferne', sammlung: 'placements', id: 'a1' }])));
pruefe('id und nachher.id widersprechen sich: Fehler', /widersprechen/.test(meldung([{ art: 'setze', sammlung: 'placements', id: 'x1', nachher: { id: 'x2', prefab: KISTE, x: 1, z: 1 } }])));
pruefe('aendere ohne nachher: Fehler', /braucht `nachher`/.test(meldung([{ art: 'aendere', sammlung: 'placements', id: 'a1' }])));
pruefe('entferne eines unbekannten Objekts: Fehler', /gibt es im Dokument nicht/.test(meldung([{ art: 'entferne', sammlung: 'placements', id: 'gibtsnicht' }])));
pruefe('Platzierung ohne prefab: Fehler', /kein prefab/.test(meldung([{ art: 'setze', sammlung: 'placements', id: 'p9', nachher: { x: 1, z: 1 } }])));
pruefe('Platzierung ohne id, ohne x: Fehler', /prefab, x und z/.test(meldung([{ art: 'setze', sammlung: 'placements', nachher: { prefab: KISTE, z: 1 } }])));
pruefe(`Mehr als ${OPS_MAX_JE_AUFRUF} ops: Fehler`, /höchstens 500/.test(meldung(Array.from({ length: 501 }, (_, i) => ({ art: 'setze' as const, sammlung: 'placements' as const, id: `n${i}`, nachher: { prefab: KISTE, x: i, z: 0 } })))));
pruefe('Leere ops: Fehler', /leer/.test(meldung([])));
const grenze = wende(BASIS, bau(Array.from({ length: 500 }, (_, i) => ({ art: 'setze' as const, sammlung: 'placements' as const, id: `n${i}`, nachher: { prefab: KISTE, x: i, z: 0 } }))));
pruefe('500 ops laufen durch', grenze.ok && grenze.layout.placements?.length === 502);

// ── Undo-Stapel ──
const s = new VorgangsStapel();
const eintrag = (i: number) => ({ vorgang: { vorgangId: `v${i}`, ops: [] }, stand: BASIS, hashVor: `h${i}`, hashNach: `h${i + 1}`, zeit: i });
for (let i = 0; i < 60; i++) s.push(eintrag(i));
pruefe(`Stapel hält höchstens ${STAPEL_MAX}, der älteste fällt heraus`, s.laenge === STAPEL_MAX && s.eintraege()[0]!.vorgang.vorgangId === 'v10');
pruefe('oberster/finde/pop', s.oberster()?.vorgang.vorgangId === 'v59' && s.finde('v30')?.hashVor === 'h30' && s.finde('v3') === undefined && s.pop()?.vorgang.vorgangId === 'v59' && s.laenge === 49);
const leer = new VorgangsStapel();
pruefe('Leerer Stapel: oberster/pop undefined', leer.oberster() === undefined && leer.pop() === undefined);

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
