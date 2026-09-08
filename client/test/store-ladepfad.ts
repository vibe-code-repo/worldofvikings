/**
 * Prüft: `modelBaseUrl()` — die Rechnung, aus der die URL einer GLB
 * entsteht.
 *
 * ── Warum das ein Test wert ist ──────────────────────────────────────
 * Die Funktion ist drei Zeilen lang und hat vier Fälle, die alle
 * dasselbe Symptom teilen: Ein falscher Zweig liefert eine URL, die
 * niemand für falsch hält. `/assets/models/store/vegetation/tree-1e1.glb`
 * sieht aus wie ein Pfad, der stimmen könnte — der Browser antwortet mit
 * 404, der Client meldet „load failed" und zeigt einen Platzhalterkasten,
 * und das liest sich wie ein fehlendes Modell und nicht wie ein
 * fehlgeleiteter Lader.
 *
 * Geprüft wird deshalb die ganze Zeichenkette und nicht nur die Basis:
 * Zusammengesetzt wird überall als `modelBaseUrl(d) + d + '.glb'`, und
 * genau dieses Ergebnis muss stimmen.
 *
 * Der Test braucht KEINE Dateien und keinen Browser — er rechnet nur.
 * Damit läuft er auch im CI-Checkout ohne `assets/`.
 *
 *   npx tsx client/test/store-ladepfad.ts
 */
import {
  GENERATED_BASE_URL,
  GENERATED_PREFIX,
  MODEL_BASE_URL,
  STORE_BASE_URL,
  modelBaseUrl,
  modelDateiName,
  modelUrl,
} from '../src/engine/assetUrls';
import { STORE_PREFAB_DEFS } from '@wov/shared';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** So bildet der Client die URL — EINE Funktion, kein Zusammenkleben. */
const url = modelUrl;

const FAELLE: ReadonlyArray<[datei: string, erwartet: string]> = [
  // Der Altbestand: flacher Name unter assets/models/.
  ['Grabhuegel', `${MODEL_BASE_URL}Grabhuegel.glb`],
  // Unterordner im Altbestand (die Wikingerin liegt in Einzelteilen vor).
  ['wikingerin/H_01', `${MODEL_BASE_URL}wikingerin/H_01.glb`],
  // Zur Laufzeit gebaute Module — am Präfix erkannt, s. GENERATED_PREFIX.
  [`${GENERATED_PREFIX}Saal7`, `${GENERATED_BASE_URL}${GENERATED_PREFIX}Saal7.glb`],
  // Der Asset-Speicher: der Ordner steckt im Namen.
  ['store/vegetation/tree-1e1', `${STORE_BASE_URL}store/vegetation/tree-1e1.glb`],
  ['store/environment/sm-prop-barrel-01', `${STORE_BASE_URL}store/environment/sm-prop-barrel-01.glb`],
  ['store/terrain/terrainl1', `${STORE_BASE_URL}store/terrain/terrainl1.glb`],
  // Bauer Bs abgeleitete Fassungen.
  ['store-lab/vegetation/tree-1e1', `${STORE_BASE_URL}store-lab/vegetation/tree-1e1.glb`],
];

for (const [datei, erwartet] of FAELLE) {
  const ist = url(datei);
  check(`${datei} → ${erwartet}`, ist === erwartet, ist);
}

/*
  Die Gegenprobe zur Namensähnlichkeit: `storefront` beginnt mit
  „store", ist aber kein Store-Pfad. Ohne den Schrägstrich im Präfix
  landete jedes Modell, das zufällig so anfängt, unter `/assets/` — der
  Fehler, den `assetHandler` in `vite.config.ts` schon einmal hatte
  („…/assets-neben" beginnt mit „…/assets").
*/
check(
  'ein Name, der nur mit "store" ANFÄNGT, ist kein Store-Pfad',
  modelBaseUrl('storefront_wall') === MODEL_BASE_URL,
  modelBaseUrl('storefront_wall')
);
check(
  'ein Name, der nur mit "Gen" anfängt, ist kein erzeugtes Modul',
  modelBaseUrl('Generator_haus') === MODEL_BASE_URL,
  modelBaseUrl('Generator_haus')
);

/*
  Der Kern der Korrektur vom 08.09.2026 — im Browser gefunden, nicht im
  Test: Die Store-GLBs tragen ihre Texturen als relative URI NEBEN der
  Datei (`textures/…png`). Babylon löst die gegen die BASIS auf. Ist die
  Basis nur die Wurzel `/assets/`, sucht der Lader unter
  `/assets/textures/…` — 404, und das Modell entsteht gar nicht erst.
  Also: Die Basis MUSS der Ordner der Datei sein, und der Dateiname darf
  keinen Ordner mehr enthalten.
*/
const ORDNER_FAELLE: ReadonlyArray<[datei: string, basis: string, name: string]> = [
  ['store/environment/sm-prop-barrel-01', '/assets/store/environment/', 'sm-prop-barrel-01'],
  ['store-lab/vegetation/tree-1e1', '/assets/store-lab/vegetation/', 'tree-1e1'],
  ['wikingerin/H_01', `${MODEL_BASE_URL}wikingerin/`, 'H_01'],
  ['Grabhuegel', MODEL_BASE_URL, 'Grabhuegel'],
];
for (const [datei, basis, name] of ORDNER_FAELLE) {
  check(
    `${datei}: Basis ist der ORDNER (${basis}), Dateiname ohne Ordner (${name})`,
    modelBaseUrl(datei) === basis && modelDateiName(datei) === name,
    `${modelBaseUrl(datei)} + ${modelDateiName(datei)}`
  );
  check(
    `${datei}: relative Textur landet im richtigen Ordner`,
    new URL(`textures/x.png`, `http://x${modelBaseUrl(datei)}`).pathname === `${basis}textures/x.png`,
    new URL(`textures/x.png`, `http://x${modelBaseUrl(datei)}`).pathname
  );
}

/*
  Und der Durchgang über den ECHTEN Bestand: Jeder der 569 erzeugten
  `model`-Werte muss unter `/assets/store…` landen. Eine Tabelle von
  sieben Fällen prüft, was ich mir vorgestellt habe; diese Schleife
  prüft, was der Generator wirklich geschrieben hat.
*/
const daneben = STORE_PREFAB_DEFS.filter((d) => !url(d.model ?? '').startsWith(`${STORE_BASE_URL}store`));
check(
  `alle ${STORE_PREFAB_DEFS.length} Store-Prefabs laden unter ${STORE_BASE_URL}store…`,
  daneben.length === 0,
  daneben.slice(0, 5).map((d) => `${d.name} → ${url(d.model ?? '')}`).join(', ')
);

console.log(fehler === 0 ? '\nalle Prüfungen grün' : `\n${fehler} Prüfung(en) fehlgeschlagen`);
process.exit(fehler > 0 ? 1 : 0);
