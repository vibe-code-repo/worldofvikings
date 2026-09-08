/**
 * Speicher-Katalog (Bauer C): die Einsortierungsregel gegen den echten
 * Bestand — DOM-frei, s. client/src/editor/StoreKatalogDaten.ts.
 *
 * Lauf:  npx tsx test/store-katalog.ts
 *
 * ── Warum die ZAEHLUNG der Test ist ──────────────────────────────────
 * Eine Einsortierung kann auf zwei Arten kaputtgehen, und nur eine davon
 * sieht man: Sie kann werfen (faellt auf), oder sie kann still alles in
 * einen Sammeltopf kippen (sieht im Katalog aus wie Ordnung — nur eben
 * mit einer Gruppe „Sonstige", in der 300 Dinge liegen). Der Test faehrt
 * deshalb ALLE Manifest-Eintraege durch und haelt die Verteilung fest:
 * jede Sorte kommt vor, keine Gruppe ist leer, keine Gruppe verschlingt
 * den Rest.
 *
 * ── Warum die Zahlen aus dem MODUL kommen ────────────────────────────
 * Die Schranken hier sind Untergrenzen und ein paar exakte Zahlen, die
 * am Bestand gemessen wurden (Ton 45, Boden-Texturen 12) — nicht
 * geraten. Wo der Bestand waechst, ist eine Untergrenze richtig; wo eine
 * Regel eine feste Menge beschreibt (die zwoelf `terrain-*`-Kacheln),
 * ist die exakte Zahl der schaerfere Zeuge.
 *
 * ── Weiche ───────────────────────────────────────────────────────────
 * Fehlt `assets/store` GANZ (CI-Checkout — der Speicher liegt ausserhalb
 * des Repos), ueberspringt ihn `scripts/run-tests.mjs`. Fehlt nur EINE
 * Datei darin, wird dieser Test rot: Dann ist der Speicher kaputt, nicht
 * abwesend, und das darf nicht als „nicht zustaendig" durchgehen.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORT_PAARE,
  WORT_TEXT,
  TON_PAARE,
  TON_TEXT,
  STORE_ARTEN,
  baueStoreKatalog,
  einsortieren,
  gruppenDerArt,
  istKollisionsnetz,
  lizenzstatus,
  sucheSpeicher,
  untergruppenDerGruppe,
  type ManifestDatei,
  type PrefabDatei,
  type StoreArt,
} from '../src/editor/StoreKatalogDaten';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEICHER = resolve(WURZEL, 'assets/store');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

/*
  Bewusst OHNE try/catch: Fehlt eine der beiden Dateien, soll dieser Test
  mit dem Dateinamen sterben. Die Weiche „gar kein Speicher" sitzt eine
  Ebene hoeher (run-tests.mjs) — hier unten waere sie nicht von einem
  kaputten Speicher zu unterscheiden.
*/
const manifest = JSON.parse(readFileSync(resolve(SPEICHER, 'manifest.json'), 'utf-8')) as ManifestDatei;
const prefabs = JSON.parse(readFileSync(resolve(SPEICHER, 'prefabs.json'), 'utf-8')) as PrefabDatei;
const kategorieNachPfad = new Map(prefabs.prefabs.map((p) => [p.asset, p.category]));

// ── (a) Einsortierung ueber JEDEN Manifest-Eintrag ────────────────────

const artZahl = new Map<StoreArt, number>();
const gruppeZahl = new Map<string, number>();
let ohneArt = 0;
let ohneGruppe = 0;
let ohneUntergruppe = 0;
for (const a of manifest.assets) {
  // Die Kategorie wird am ECHTEN Pfad nachgeschlagen: Platzhalter tragen
  // `placeholders/` davor und stehen unter diesem Namen in keinem
  // Prefab-Katalog — ihre Einordnung soll trotzdem die ihres Originals
  // sein (s. Kopfkommentar von `einsortieren`).
  const echt = a.path.startsWith('placeholders/') ? a.path.slice('placeholders/'.length) : a.path;
  const o = einsortieren({ id: a.id, path: a.path, kind: a.kind, category: kategorieNachPfad.get(echt) ?? null });
  if (!o.art) ohneArt++;
  if (!o.gruppe.trim()) ohneGruppe++;
  if (!o.untergruppe.trim()) ohneUntergruppe++;
  artZahl.set(o.art, (artZahl.get(o.art) ?? 0) + 1);
  gruppeZahl.set(`${o.art}/${o.gruppe}`, (gruppeZahl.get(`${o.art}/${o.gruppe}`) ?? 0) + 1);
}

check('Manifest ist nicht leer', manifest.assets.length > 1000, `${manifest.assets.length} Einträge`);
check('jeder Eintrag bekommt eine Art', ohneArt === 0, `${ohneArt} ohne Art`);
check('jeder Eintrag bekommt eine Gruppe', ohneGruppe === 0, `${ohneGruppe} ohne Gruppe`);
check('jeder Eintrag bekommt eine Untergruppe', ohneUntergruppe === 0, `${ohneUntergruppe} ohne Untergruppe`);
check(
  'die Summe der Arten ist die Zahl der Einträge',
  [...artZahl.values()].reduce((s, n) => s + n, 0) === manifest.assets.length
);
for (const art of STORE_ARTEN) {
  check(`Art „${art}" ist besetzt`, (artZahl.get(art) ?? 0) > 0, `${artZahl.get(art) ?? 0}`);
}
check(
  'keine Gruppe heißt „Sonstige" — das wäre der stille Sammeltopf',
  ![...gruppeZahl.keys()].some((k) => k.endsWith('/Sonstige')),
  [...gruppeZahl.keys()].filter((k) => k.endsWith('/Sonstige')).join(', ')
);

// Der Katalog selbst — ohne Platzhalter, das ist der Bestand.
const katalog = baueStoreKatalog(manifest, prefabs);
check('Katalog lässt die Platzhalter draußen', katalog.every((e) => !e.pfad.startsWith('placeholders/')));
check(
  'Katalog zählt so viele Einträge wie das Manifest echte Pfade führt',
  katalog.length === manifest.assets.filter((a) => !a.path.startsWith('placeholders/')).length,
  `${katalog.length}`
);
check('keine doppelte Id im Katalog', new Set(katalog.map((e) => e.id)).size === katalog.length);

function zahl(art: StoreArt, gruppe: string): number {
  return katalog.filter((e) => e.art === art && e.gruppe === gruppe).length;
}

// Untergrenzen dort, wo der Bestand wachsen darf; exakte Zahlen dort, wo
// die Regel eine feste Menge beschreibt.
check('Gebäude ≥ 10', zahl('Modelle', 'Gebäude') >= 10, `${zahl('Modelle', 'Gebäude')}`);
check('Vegetation ≥ 90', zahl('Modelle', 'Vegetation') >= 90, `${zahl('Modelle', 'Vegetation')}`);
check('Requisiten ≥ 200', zahl('Modelle', 'Requisiten') >= 200, `${zahl('Modelle', 'Requisiten')}`);
check('Gegenstände ≥ 60', zahl('Modelle', 'Gegenstände') >= 60, `${zahl('Modelle', 'Gegenstände')}`);
check('Umgebung ≥ 100', zahl('Modelle', 'Umgebung') >= 100, `${zahl('Modelle', 'Umgebung')}`);
check('Fahrzeuge ≥ 3', zahl('Modelle', 'Fahrzeuge') >= 3, `${zahl('Modelle', 'Fahrzeuge')}`);
check(
  'Ton zählt genau 44 Klänge im Speicher (45 im Manifest, einer davon Platzhalter)',
  katalog.filter((e) => e.art === 'Ton').length === 44,
  `${katalog.filter((e) => e.art === 'Ton').length}`
);
check(
  'Ton zählt 45 Einträge über das ganze Manifest',
  (artZahl.get('Ton') ?? 0) === 45,
  `${artZahl.get('Ton') ?? 0}`
);
check('Boden-Texturen = 12', zahl('Texturen', 'Boden-Texturen') === 12, `${zahl('Texturen', 'Boden-Texturen')}`);
check('Höhenfelder = 15', zahl('Höhenfelder', 'Höhenfelder') === 15, `${zahl('Höhenfelder', 'Höhenfelder')}`);
check('Kulisse = 6', zahl('Kulisse', 'Kulisse') === 6, `${zahl('Kulisse', 'Kulisse')}`);

// Die vier Ton-Gruppen der Vorgabe müssen wirklich alle vorkommen — ohne
// das wäre „Ton = 45" auch dann grün, wenn alles in einem Topf läge.
for (const g of ['Schritte', 'Tiere', 'Umgebungston', 'Quellen']) {
  check(`Ton-Gruppe „${g}" ist besetzt`, zahl('Ton', g) > 0, `${zahl('Ton', g)}`);
}

// Vegetation: die Untergruppen der Vorgabe, an echten Dateien geprüft.
function untergruppeVon(id: string): string | undefined {
  return katalog.find((e) => e.id === id)?.untergruppe;
}
check('pine-1b1 steht unter Nadelbäume', untergruppeVon('vegetation/pine-1b1') === 'Nadelbäume', String(untergruppeVon('vegetation/pine-1b1')));
check('massive-tree-1a1 steht unter Bäume', untergruppeVon('vegetation/massive-tree-1a1') === 'Bäume', String(untergruppeVon('vegetation/massive-tree-1a1')));
check(
  'large-bush-1a1 steht unter Büsche, nicht unter Bäume',
  untergruppeVon('vegetation/large-bush-1a1') === 'Büsche',
  String(untergruppeVon('vegetation/large-bush-1a1'))
);
check('branch-1a1 steht unter Äste', untergruppeVon('vegetation/branch-1a1') === 'Äste', String(untergruppeVon('vegetation/branch-1a1')));
check(
  'grass-short-clump-snow trägt das Kennzeichen Schnee',
  katalog.find((e) => e.id === 'vegetation/grass-short-clump-snow')?.kennzeichen.includes('Schnee') === true
);
check(
  'die Wolken stehen in der Kulisse, nicht bei den Requisiten',
  katalog.find((e) => e.id === 'environment/sm-prop-cloud-01')?.art === 'Kulisse'
);
check(
  'sm-bld-house-chimney-stone-01 steht unter Gebäude/Haus',
  katalog.find((e) => e.id === 'environment/sm-bld-house-chimney-stone-01')?.gruppe === 'Gebäude' &&
    katalog.find((e) => e.id === 'environment/sm-bld-house-chimney-stone-01')?.untergruppe === 'Haus'
);

// Die Regel darf ohne `prefabs.json` nicht umkippen — der Katalog baut
// sich auch aus dem blossen Manifest (s. `ladeStoreKatalog`).
const ohnePrefabs = baueStoreKatalog(manifest, null);
check('Katalog ohne prefabs.json hat dieselbe Länge', ohnePrefabs.length === katalog.length);
check(
  'Katalog ohne prefabs.json sortiert die Kulisse genauso ein',
  ohnePrefabs.filter((e) => e.art === 'Kulisse').length === katalog.filter((e) => e.art === 'Kulisse').length
);
check('ohne prefabs.json gibt es keine Kollisionsangabe', ohnePrefabs.every((e) => e.kollision === undefined));
check('mit prefabs.json gibt es Kollisionsangaben', katalog.filter((e) => e.kollision !== undefined).length > 400);

// ── Befunde der Messprobe (design/store-konventionen.md) ──────────────

const netze = katalog.filter((e) => e.kennzeichen.includes('Kollisionsnetz'));
check('zwölf Kollisionsnetze im Speicher erkannt', netze.length === 12, `${netze.length}`);
check(
  'jedes Kollisionsnetz steht in der Untergruppe „Kollisionsnetze"',
  netze.every((e) => e.untergruppe === 'Kollisionsnetze')
);
check(
  'die Netze bleiben in IHRER Gruppe (Gebäude bzw. Requisiten), nicht in einem Sammeltopf',
  new Set(netze.map((e) => e.gruppe)).size >= 2,
  [...new Set(netze.map((e) => e.gruppe))].join(', ')
);
check('istKollisionsnetz erkennt auch die Kurzform `_col`', istKollisionsnetz('sm-bld-haus-01_col.glb'));
check('istKollisionsnetz schlägt nicht auf harmlose Namen an', !istKollisionsnetz('sm-env-grass-short-clump-01.glb'));
const mitNetz = katalog.filter((e) => e.kollisionsdatei);
check(
  'genau drei Hauptmodelle haben eine eigene Kollisionsdatei — neun Netze sind verwaist',
  mitNetz.length === 3,
  `${mitNetz.length}`
);
check(
  'die zugeordnete Datei ist wirklich ein Netz des Katalogs',
  mitNetz.every((e) => netze.some((n) => n.pfad === e.kollisionsdatei))
);
check(
  'Höhenfelder und Kulissen tragen „nicht platzierbar"',
  katalog.filter((e) => e.kennzeichen.includes('nicht platzierbar')).length ===
    zahl('Höhenfelder', 'Höhenfelder') + zahl('Kulisse', 'Kulisse')
);
check(
  'kein Modell der Art „Modelle" trägt „nicht platzierbar"',
  !katalog.some((e) => e.art === 'Modelle' && e.kennzeichen.includes('nicht platzierbar'))
);
// Die drei gemessenen Ausreisser mit tief liegender Unterkante — der
// Infoblock weist sie aus, und dieser Test haelt fest, dass die Zahl
// ueberhaupt in den Daten steht.
for (const id of ['environment/sm-item-horn', 'environment/sm-item-bag-large', 'environment/sm-item-shrooms']) {
  const e = katalog.find((x) => x.id === id);
  check(`${id} führt eine Unterkante unter −8 m`, (e?.bounds?.min[1] ?? 0) < -8, `${e?.bounds?.min[1]}`);
}

// ── (b) Uebersetzungstabelle ohne Dubletten ───────────────────────────

check(
  'WORT_PAARE enthält keinen doppelten Schlüssel',
  WORT_PAARE.length === WORT_TEXT.size,
  `${WORT_PAARE.length} Paare, ${WORT_TEXT.size} Schlüssel`
);
check(
  'TON_PAARE enthält keinen doppelten Schlüssel',
  TON_PAARE.length === TON_TEXT.size,
  `${TON_PAARE.length} Paare, ${TON_TEXT.size} Schlüssel`
);
check('Übersetzungstabelle deckt mindestens 60 Wörter ab', WORT_PAARE.length >= 60, `${WORT_PAARE.length}`);
check(
  'kein Schlüssel übersetzt sich auf sich selbst (das wäre eine tote Zeile)',
  WORT_PAARE.every(([k, v]) => k !== v)
);
check(
  'kein leerer Schlüssel und kein leerer Text',
  [...WORT_PAARE, ...TON_PAARE].every(([k, v]) => k.trim().length > 0 && v.trim().length > 0)
);
check(
  'die Ton-Tabelle widerspricht der allgemeinen wirklich — sonst wäre sie überflüssig',
  TON_PAARE.some(([k, v]) => WORT_TEXT.has(k) && WORT_TEXT.get(k) !== v)
);

// ── (c) Suche findet nach Untergruppe ─────────────────────────────────

const nachUntergruppe = sucheSpeicher(katalog, 'Nadelbäume');
check(
  'Suche nach „Nadelbäume" findet die Kiefern',
  nachUntergruppe.length > 0 && nachUntergruppe.every((e) => e.untergruppe === 'Nadelbäume'),
  `${nachUntergruppe.length} Treffer`
);
check(
  'Suche nach „Nadelbäume" findet ALLE Kiefern',
  nachUntergruppe.length === katalog.filter((e) => e.untergruppe === 'Nadelbäume').length
);
const nachGruppe = sucheSpeicher(katalog, 'boden-texturen');
check(
  'Suche nach der Gruppe funktioniert und achtet nicht auf Grossschreibung',
  nachGruppe.length === 12,
  `${nachGruppe.length} Treffer`
);
const nachId = sucheSpeicher(katalog, 'sm-veh-cart');
check('Suche nach einem Id-Bruchstück findet die Karren', nachId.length === 3, `${nachId.length} Treffer`);
const nachKennzeichen = sucheSpeicher(katalog, 'schnee');
check('Suche nach dem Kennzeichen „Schnee" findet etwas', nachKennzeichen.length > 0, `${nachKennzeichen.length}`);
check('leere Suche liefert alles', sucheSpeicher(katalog, '   ').length === katalog.length);
check('Suche ohne Treffer liefert wirklich nichts', sucheSpeicher(katalog, 'zzz-gibt-es-nicht').length === 0);

// ── Bedienhilfen: Gruppen- und Untergruppenzahlen ─────────────────────

const modellGruppen = gruppenDerArt(katalog, 'Modelle');
check('Modelle haben mehrere Gruppen', modellGruppen.length >= 5, `${modellGruppen.length}`);
check(
  'Gruppen sind absteigend gezählt',
  modellGruppen.every((g, i) => i === 0 || modellGruppen[i - 1]!.anzahl >= g.anzahl)
);
check(
  'die Gruppenzahlen summieren sich auf die Zahl der Modelle',
  modellGruppen.reduce((s, g) => s + g.anzahl, 0) === katalog.filter((e) => e.art === 'Modelle').length
);
const vegUnter = untergruppenDerGruppe(katalog, 'Modelle', 'Vegetation');
check('Vegetation hat mehrere Untergruppen', vegUnter.length >= 4, vegUnter.map((u) => u.name).join(', '));
check(
  'die Untergruppenzahlen summieren sich auf die Gruppengröße',
  vegUnter.reduce((s, g) => s + g.anzahl, 0) === zahl('Modelle', 'Vegetation')
);

// ── Lizenzstatus sagt in beide Richtungen etwas ───────────────────────

check(
  'privater Bestand wird als solcher benannt',
  lizenzstatus({ license: 'NOASSERTION', redistributable: false, visibility: 'private' }).includes('privat')
);
check(
  'freier Bestand nennt die Lizenz',
  lizenzstatus({ license: 'CC0-1.0', redistributable: true, visibility: 'public' }).includes('CC0-1.0')
);
check('jeder Katalogeintrag trägt einen Lizenzsatz', katalog.every((e) => e.lizenzstatus.length > 0));

console.log(fehler === 0 ? '\nOK — Speicher-Katalog sortiert den ganzen Bestand ein' : `\n${fehler} ABWEICHUNGEN`);
process.exit(fehler > 0 ? 1 : 0);
