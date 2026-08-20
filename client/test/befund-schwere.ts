/**
 * Schweregrad-Klassifikation des Editor-Prüfberichts (Aufgabe B1).
 *
 * Zwei Ebenen: handgebaute LayoutBefund-Literale decken jeden Zweig von
 * `befundSchwere` einzeln ab (schnell, unabhängig von den Wortlauten in
 * pruefung.ts). Der zweite Block prüft dieselbe Funktion gegen ECHTE
 * `pruefeLayout`-Ausgaben — die Absicherung gegen genau die Art von
 * Drift, die der erste Block nicht sieht: Ändert sich der Text in
 * pruefung.ts (z. B. "Route hat nur einen Wegpunkt"), auf den
 * `befundSchwere` mit `startsWith` prüft, fällt das hier auf statt erst
 * im Editor als falsch gefärbte Zeile.
 *
 * Lauf:  npx tsx test/befund-schwere.ts
 */
import { pruefeLayout, sanitizeWorldLayout, type LayoutBefund } from '@wov/shared';
import { befundSchwere } from '../src/editor/befundSchwere';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Jeder Zweig einzeln, mit Literalen ────────────────────────────────
const b = (art: LayoutBefund['art'], text: string, wo = 'x'): LayoutBefund => ({ wo, art, text });

check('unbekannte Vegetation ist Fehler', befundSchwere(b('vegetation', 'unbekannte Vegetation: Foo')) === 'fehler');
check('unbekannte Location ist Fehler', befundSchwere(b('location', 'unbekannte Location: Foo')) === 'fehler');
check('unbekannter Spawn ist Fehler', befundSchwere(b('spawn', 'unbekannter Spawn: Foo')) === 'fehler');
check(
  'unbekanntes Prefab ist Fehler',
  befundSchwere(b('placement', 'unbekanntes Prefab: Foo @(1, 2)')) === 'fehler'
);
check(
  'NPC-Angaben ohne Vorgabe ist Hinweis',
  befundSchwere(b('placement', 'NPC-Angaben an einem Prefab ohne Vorgabe: Foo @(1, 2)')) === 'hinweis'
);
check(
  'unbekannte Route (Referenz) ist Fehler',
  befundSchwere(b('route', 'unbekannte Route: bar (Foo @(1, 2))')) === 'fehler'
);
check(
  'Ein-Punkt-Route (Standposten) ist Hinweis',
  befundSchwere(b('route', 'Route hat nur einen Wegpunkt — der NPC bleibt dort stehen')) === 'hinweis'
);
check(
  'kein eigenes Modell an einer Region ist Hinweis',
  befundSchwere(b('modell', 'kein eigenes Modell: Foo', 'insel-1')) === 'hinweis'
);
check(
  'kein eigenes Modell an Platzierungen ist Hinweis',
  befundSchwere(b('modell', 'kein eigenes Modell: Foo (3 Platzierungen)')) === 'hinweis'
);
check('fehlender Startpunkt ist Hinweis', befundSchwere(b('welt', 'Kein Startpunkt gesetzt')) === 'hinweis');

// ── Gegen echte pruefeLayout-Ausgaben (Drift-Absicherung) ─────────────
const layout = sanitizeWorldLayout({
  version: 1,
  name: 'Prüfbericht-Testwelt',
  detailSeed: 'x',
  continents: [],
  regions: [
    {
      id: 'insel-1',
      biome: 'grassland',
      shape: { kind: 'circle', x: 0, z: 0, radius: 500 },
      edgeFalloff: 100,
      vegetation: ['GibtEsNichtAlsPflanze'],
    },
  ],
  routes: [{ id: 'standposten', points: [[0, 0]], mode: 'loop' }],
  // Voelva ist ein echtes NPC-Prefab (shared/src/npc.ts) — Beech1 nicht:
  // genau der Fall, den "NPC-Angaben an einem Prefab ohne Vorgabe" meldet.
  placements: [{ prefab: 'Beech1', x: 0, z: 0, npc: { name: 'Falscher Ort' } }],
})!;
const echt = pruefeLayout(layout);

const findeArt = (art: LayoutBefund['art'], teil: string): LayoutBefund | undefined =>
  echt.find((x) => x.art === art && x.text.includes(teil));

const echteVegetation = findeArt('vegetation', 'GibtEsNichtAlsPflanze');
check('echte Ausgabe enthält unbekannte Vegetation', echteVegetation !== undefined);
check('… und wird als Fehler eingestuft', echteVegetation !== undefined && befundSchwere(echteVegetation) === 'fehler');

const echteRoute = findeArt('route', 'nur einen Wegpunkt');
check('echte Ausgabe enthält die Ein-Punkt-Route', echteRoute !== undefined);
check('… und wird als Hinweis eingestuft', echteRoute !== undefined && befundSchwere(echteRoute) === 'hinweis');

const echtesNpc = findeArt('placement', 'NPC-Angaben');
check('echte Ausgabe enthält die NPC-Angabe ohne Vorgabe', echtesNpc !== undefined);
check('… und wird als Hinweis eingestuft', echtesNpc !== undefined && befundSchwere(echtesNpc) === 'hinweis');

console.log(fehler === 0 ? '\nOK — Schweregrad stimmt in jedem Fall' : `\n${fehler} ABWEICHUNGEN`);
process.exit(fehler > 0 ? 1 : 0);
