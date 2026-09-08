/**
 * Prüft: dass der eingecheckte `STORE_KATALOG` und die Einsortierregel des
 * Gegenstands-Katalogs für JEDEN Eintrag dieselbe Schublade nennen.
 *
 * ── Warum es diesen Test gibt ────────────────────────────────────────
 * Die Regel („welche Art, welche Gruppe, welche Untergruppe?") stand bei
 * der Zusammenführung von Schritt 1 ZWEIMAL da: einmal im Generator
 * `tools/store-prefabs.mjs`, einmal in `einsortieren()` des Katalogs.
 * Beide waren für sich schlüssig und beide waren vollständig — und sie
 * widersprachen sich bei 477 der 670 Einträge („Fels" gegen „Felsen",
 * „Fass" gegen „Fässer", der Ton als eine Schublade gegen den Ton in
 * vieren). Nichts davon war zu sehen: Wer den Katalog aufschlug, sah
 * eine geschlossene Ordnung; wer die erzeugte Datei las, ebenfalls.
 *
 * Seither gibt es nur noch EINE Regel — der Generator holt sie aus dem
 * Katalogmodul. Dieser Test ist die Sicherung dagegen, dass sie wieder
 * zwei werden, und zugleich die Sicherung dagegen, dass jemand die Regel
 * ändert, ohne den Generator neu laufen zu lassen: Beides sähe man dem
 * Quelltext nicht an, denn beide Seiten blieben in sich stimmig.
 *
 * ── Warum nicht `art` wörtlich verglichen wird ───────────────────────
 * Der Katalog beschriftet Knöpfe („Modelle", „Texturen") — die erzeugte
 * Datei führt eine Kennung (`modell`, `textur`) und kennt eine Stufe
 * mehr: `kollision`. Ein Kollisionsnetz ist im Katalog ein Modell mit
 * eigenem Fach, für den Server aber etwas, das man NIE setzt. Die
 * Tabelle unten ist genau diese Übersetzung — und dass sie hier steht
 * und nicht im Kopf des Lesers, ist der Punkt.
 *
 * WEICHE `brauchtModelle('assets/store')`: `einsortieren()` braucht
 * Sorte (`kind`) und Kategorie, und die stehen im Store-Manifest, nicht
 * im Katalog. Ohne Store wird übersprungen.
 *
 *   npx tsx tools/test/store-einsortierung.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/*
  Tiefer Import statt Barrel: `storeKatalogDaten.ts` haengt mit Absicht
  NICHT an `shared/src/index.ts` — sonst laege der Katalog wieder im
  Spiel-Bundle (Begruendung dort im Kopf). Ein Test darf ihn holen, das
  Spiel nicht.
*/
import { STORE_KATALOG } from '@wov/shared/src/storeKatalogDaten.js';
import {
  einsortieren,
  type PrefabKategorie,
  type StoreArt as KatalogArt,
  type StoreSorte,
} from '../../client/src/editor/StoreKatalogDaten.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE = join(WURZEL, 'assets/store');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

check('assets/store liegt vor', existsSync(STORE), STORE);
if (fehler > 0) {
  console.error('\nOhne den Asset-Speicher fehlen Sorte und Kategorie — nichts zu vergleichen.');
  process.exit(1);
}

/** Katalogbeschriftung → Kennung der erzeugten Datei. */
const ART_KENNUNG: Record<KatalogArt, string> = {
  Modelle: 'modell',
  Texturen: 'textur',
  Ton: 'ton',
  Höhenfelder: 'terrain',
  Kulisse: 'kulisse',
};

type ManifestEintrag = { id: string; path: string; kind: StoreSorte };
type PrefabEintrag = { asset: string; category?: PrefabKategorie };

const manifest = JSON.parse(readFileSync(join(STORE, 'manifest.json'), 'utf8')) as {
  assets: ManifestEintrag[];
};
const prefabs = JSON.parse(readFileSync(join(STORE, 'prefabs.json'), 'utf8')) as {
  prefabs: PrefabEintrag[];
};
const manifestNachPfad = new Map(manifest.assets.map((a) => [a.path, a]));
const kategorieNachPfad = new Map(prefabs.prefabs.map((p) => [p.asset, p.category ?? null]));

const ohneManifest: string[] = [];
const abweichend: string[] = [];
for (const eintrag of STORE_KATALOG) {
  const a = manifestNachPfad.get(eintrag.pfad);
  if (!a) {
    ohneManifest.push(eintrag.pfad);
    continue;
  }
  const ordnung = einsortieren({
    id: a.id,
    path: a.path,
    kind: a.kind,
    category: kategorieNachPfad.get(a.path) ?? null,
  });
  /*
    `kollision` hat im Katalog keine eigene Art — dort ist ein
    Kollisionsnetz ein Modell mit dem Fach „Kollisionsnetze". Genau das
    wird hier verlangt, statt die Zeile zu überspringen: Fiele das Fach
    weg, stünden die zwölf Netze zwischen den Häusern und sähen aus wie
    welche, nur ohne Textur und ohne Dach.
  */
  const sollArt = eintrag.art === 'kollision' ? 'modell' : eintrag.art;
  const istArt = ART_KENNUNG[ordnung.art];
  const netzOk = eintrag.art !== 'kollision' || ordnung.untergruppe === 'Kollisionsnetze';
  if (
    istArt !== sollArt ||
    ordnung.gruppe !== eintrag.gruppe ||
    ordnung.untergruppe !== eintrag.untergruppe ||
    !netzOk
  ) {
    abweichend.push(
      `${eintrag.pfad}\n       Katalogdatei: ${eintrag.art} / ${eintrag.gruppe} / ${eintrag.untergruppe}` +
        `\n       Regel:        ${istArt} / ${ordnung.gruppe} / ${ordnung.untergruppe}`
    );
  }
}

check(
  `jeder der ${STORE_KATALOG.length} Katalogeinträge steht im Manifest`,
  ohneManifest.length === 0,
  ohneManifest.slice(0, 5).join(', ')
);
check(
  'Art, Gruppe und Untergruppe stimmen mit einsortieren() überein',
  abweichend.length === 0,
  abweichend.length === 0
    ? ''
    : `${abweichend.length} Abweichungen\n     ${abweichend.slice(0, 8).join('\n     ')}` +
      '\n     → npx tsx tools/store-prefabs.mjs erneut laufen lassen'
);

/*
  Und die Gegenrichtung, damit der Test nicht bei leerer Menge grün wird:
  Eine Regel, die alles nach „Sonstige" kippt, wäre oben unauffällig.
*/
const schubladen = new Map<string, number>();
for (const e of STORE_KATALOG) schubladen.set(`${e.gruppe}/${e.untergruppe}`, (schubladen.get(`${e.gruppe}/${e.untergruppe}`) ?? 0) + 1);
const sammelfach = [...schubladen].filter(([k]) => /\/(Sonstige|Sonstiges)$/.test(k));
check(
  'kein Sammelfach „Sonstige"',
  sammelfach.length === 0,
  sammelfach.map(([k, n]) => `${k} (${n})`).join(', ')
);
console.log(`\n${schubladen.size} Schubladen über ${STORE_KATALOG.length} Einträge.`);

if (fehler > 0) {
  console.error(`\n${fehler} Fehlschläge`);
  process.exit(1);
}
console.log('\nalles grün');
