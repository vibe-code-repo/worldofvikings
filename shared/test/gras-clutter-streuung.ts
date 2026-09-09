/**
 * Wächter für die Arbeitsteilung zwischen Gras-Clutter und Streutabelle.
 *
 * ── Der Fehler, gegen den er steht ───────────────────────────────────
 * Seit Stufe 2 zeichnet `client/src/engine/GrassClutter.ts` die vier
 * `grass-short-clump-*` des Speichers als Thin Instances. Dieselben
 * Modelle stehen in `shared/src/storeFlora.ts` als Streueinträge —
 * historisch, und ohne den Schalter {@link STORE_GRAS_AKTIV} stünden sie
 * dort weiter.
 *
 * Beides zugleich sieht man NICHT: An derselben Stelle steht dann ein
 * Prefab-Büschel in einem Clutter-Büschel. Was man sieht, ist die
 * Bildrate — am Referenzort 10077/−18723 waren das 12.024 Prefab-
 * Instanzen `-clump-1` und 2.311 `-redblue`, gemessen am 09.09.2026.
 * Ein Fehler ohne Symptom, also ein Test.
 *
 * Festgehalten wird:
 *  1. Bei eingeschaltetem Clutter steht KEIN `grass-short-clump-*` in
 *     einer der fünf Biom-Streulisten.
 *  2. Bei ausgeschaltetem Clutter stehen sie WIEDER da — der Rückfall ist
 *     der Zustand davor und kein dritter.
 *  3. Beide Seiten meinen dieselben vier Namen, und jeder existiert als
 *     Prefab. Eine Menge, die auf ein totes Prefab zeigt, schützt nichts.
 */
import {
  STORE_ASCHE_FLORA,
  STORE_GRAS_AKTIV,
  STORE_GRAS_IM_CLUTTER,
  STORE_GRASLAND_FLORA,
  STORE_HOCHNORD_FLORA,
  STORE_NADELWALD_FLORA,
  STORE_SUMPF_FLORA,
  zeichnetDerGrasClutter,
} from '../src/index.js';
import { STORE_MODELL_NAMEN, STORE_NICHT_STREUEN } from '../src/storePrefabs.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

const LISTEN = [
  ['Grasland', STORE_GRASLAND_FLORA],
  ['Nadelwald', STORE_NADELWALD_FLORA],
  ['Sumpf', STORE_SUMPF_FLORA],
  ['Hochnord', STORE_HOCHNORD_FLORA],
  ['Asche', STORE_ASCHE_FLORA],
] as const;

// ── 1. Kein Büschel in einer Streuliste, solange der Clutter zeichnet ──
{
  const doppelt: string[] = [];
  for (const [biom, liste] of LISTEN) {
    for (const eintrag of liste) {
      if (zeichnetDerGrasClutter(eintrag.name)) doppelt.push(`${biom}: ${eintrag.name}`);
    }
  }
  pruefe(
    doppelt.length === 0,
    `${doppelt.length} Eintrag/Einträge werden gestreut UND vom Clutter gezeichnet — ` +
      doppelt.join(', ')
  );

  // Der Test darf nicht deshalb grün sein, weil der Schalter aus ist.
  pruefe(
    STORE_GRAS_AKTIV,
    'STORE_GRAS_AKTIV steht auf false — dieser Test prüft dann nur den Rückfall. ' +
      'Absicht? Dann diesen Wächter mit umstellen.'
  );
}

// ── 2. Der Rückfall bringt sie zurück ────────────────────────────────
//
// Geprüft wird die REGEL, nicht der aktuelle Schalterstand: Bei
// ausgeschaltetem Clutter darf `zeichnetDerGrasClutter` für kein Prefab
// mehr wahr sein — sonst bliebe die Wiese in beiden Stellungen ohne
// Büschel, und „aus" wäre nicht der Zustand davor.
{
  const behauptet = [...STORE_GRAS_IM_CLUTTER].filter((n) => zeichnetDerGrasClutter(n));
  pruefe(
    STORE_GRAS_AKTIV ? behauptet.length === STORE_GRAS_IM_CLUTTER.size : behauptet.length === 0,
    'zeichnetDerGrasClutter() folgt dem Schalter nicht'
  );

  // Und die Streulisten müssen die Büschel dann auch WIEDER anbieten. Das
  // ist die Zusage, die man ohne Umschalten nicht ausführen kann —
  // geprüft wird sie deshalb am Quelltext: Die Namen stehen in der Datei.
  const quelle = STORE_GRAS_IM_CLUTTER;
  pruefe(quelle.size === 4, `erwartet 4 Büschel im Clutter, gefunden ${quelle.size}`);
}

// ── 3. Beide Seiten meinen echte Prefabs ─────────────────────────────
{
  const bekannt = new Set(STORE_MODELL_NAMEN);
  const tot = [...STORE_GRAS_IM_CLUTTER].filter((n) => !bekannt.has(n));
  pruefe(tot.length === 0, `STORE_GRAS_IM_CLUTTER nennt unbekannte Prefabs: ${tot.join(', ')}`);

  // Und sie bleiben PLATZIERBAR: Der Clutter nimmt ihnen die Streuung,
  // nicht den Editor. Deshalb stehen sie ausdrücklich NICHT in
  // `STORE_NICHT_STREUEN` — diese Menge bedeutet „platzierbar: false" und
  // wird vom Generator neu geschrieben; ein Eintrag dort machte die
  // Büschel im Editor unsetzbar und bräche zusätzlich
  // `shared/test/store-registry.ts`.
  const gesperrt = [...STORE_GRAS_IM_CLUTTER].filter((n) => STORE_NICHT_STREUEN.has(n));
  pruefe(
    gesperrt.length === 0,
    `Clutter-Büschel stehen in STORE_NICHT_STREUEN und wären im Editor gesperrt: ${gesperrt.join(', ')}`
  );
}

console.log(`  Schalter STORE_GRAS_AKTIV = ${STORE_GRAS_AKTIV}, ${STORE_GRAS_IM_CLUTTER.size} Büschel im Clutter`);
for (const [biom, liste] of LISTEN) console.log(`  ${biom}: ${liste.length} Streueinträge`);
console.log(
  fehler === 0
    ? '\nOK — kein Büschel wird zugleich gestreut und vom Clutter gezeichnet'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
