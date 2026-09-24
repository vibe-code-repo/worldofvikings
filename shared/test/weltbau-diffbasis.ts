/**
 * world_diff gegen "vorgang": Wahl der Vergleichsbasis (reine Funktion) und
 * der Weg durch den echten VorgangsStapel.
 *
 * Lauf: npx tsx shared/test/weltbau-diffbasis.ts   (aus shared/)
 */
import type { WorldLayout } from '../src/worldlayout/types.js';
import { waehleDiffBasis, type DiffQuellen } from '../src/weltbau/diffBasis.js';
import { VorgangsStapel } from '../src/weltbau/stapel.js';
import { diffLayouts } from '../src/weltbau/diff.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const dok = (n: number): WorldLayout =>
  ({
    version: 1, name: 'd', detailSeed: 's', continents: [], regions: [], routes: [], lakes: [],
    placements: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, prefab: 'Kiste', x: i, z: i })),
  }) as unknown as WorldLayout;

const stapel = new VorgangsStapel(5);
const ersteBasis = dok(1);
const q = (sitzung?: WorldLayout): DiffQuellen => ({
  sitzung: () => sitzung,
  oberster: () => stapel.oberster(),
  finde: (id) => stapel.finde(id),
  bereinige: (roh) => (typeof roh === 'object' && roh !== null ? (roh as WorldLayout) : null),
});
const eintrag = (id: string, stand: WorldLayout) =>
  ({ vorgang: { vorgangId: id } as never, stand, hashVor: 'a', hashNach: 'b', zeit: 0 });

// leerer Stapel: Fehler, kein Absturz
let w = waehleDiffBasis('vorgang', q(ersteBasis));
pruefe('leerer Stapel -> Fehlertext', 'fehler' in w && w.fehler.includes('kein Vorgang'));
w = waehleDiffBasis({ vorgang: 'x' }, q(ersteBasis));
pruefe('unbekannte Vorgangs-ID -> Fehlertext', 'fehler' in w && w.fehler.includes('x'));
w = waehleDiffBasis(undefined, q(undefined));
pruefe('ohne Sitzungsbasis -> Fehlertext', 'fehler' in w);

stapel.push(eintrag('v1', dok(2)));
stapel.push(eintrag('v2', dok(3)));
const aktuell = dok(4);

w = waehleDiffBasis('vorgang', q(ersteBasis));
pruefe('"vorgang" = Stand vor dem letzten Vorgang (3 Platzierungen)', 'basis' in w && (w.basis.placements ?? []).length === 3);
w = waehleDiffBasis({ vorgang: 'v1' }, q(ersteBasis));
pruefe('{vorgang:v1} = Stand vor v1 (2 Platzierungen)', 'basis' in w && (w.basis.placements ?? []).length === 2);
w = waehleDiffBasis('sitzung', q(ersteBasis));
pruefe('"sitzung" = erste Basis (1)', 'basis' in w && w.basis === ersteBasis);
w = waehleDiffBasis({ layout: dok(7) }, q());
pruefe('{layout} = übergebenes Dokument', 'basis' in w && (w.basis.placements ?? []).length === 7);
w = waehleDiffBasis({ layout: 5 }, q());
pruefe('{layout} ungültig -> Fehlertext', 'fehler' in w);

// Zahl: letzter Vorgang hat 1 Platzierung hinzugefügt (3 -> 4)
w = waehleDiffBasis('vorgang', q(ersteBasis));
const d = 'basis' in w ? diffLayouts(w.basis, aktuell) : undefined;
pruefe('Diff gegen "vorgang": +1 Objekt', d?.text === '+1 Objekt', String(d?.text));

// herausgefallener Vorgang (Stapel max 5)
for (let i = 0; i < 6; i++) stapel.push(eintrag(`n${i}`, dok(10 + i)));
w = waehleDiffBasis({ vorgang: 'v1' }, q(ersteBasis));
pruefe('herausgefallener Vorgang -> Fehlertext', 'fehler' in w);

console.log(fehler === 0 ? '\nALLES OK' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
