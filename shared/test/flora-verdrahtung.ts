/**
 * Die Verdrahtung zwischen Kuratierung und Streutabelle — das Muster aus
 * `server/test/h4-graslandflora.ts`, aber ohne Weltgenerierung.
 *
 * H4 fährt dafür elf mal elf Zonen und zählt, was aus dem Boden kommt;
 * das dauert Minuten und braucht den halben Server. Die Regel dahinter
 * ist dagegen eine reine Aussage über zwei Listen, und die lässt sich in
 * Millisekunden prüfen:
 *
 *     Eine Art wird nur gestreut, wenn sie BEIDES hat — einen
 *     Streueintrag in FOLIAGE und einen Platz in der Kuratierungsliste
 *     der Region. Fehlt eines von beidem, bleibt die Insel kahl, und
 *     zwar lautlos.
 *
 * Dieser Test ist deshalb kein Ersatz für H4, sondern sein Vorposten: Er
 * fällt SCHNELLER und mit einer Zeile, die den Namen nennt. Er braucht
 * weder `assets/` noch eine GPU und steht ohne Weiche in der Kernliste.
 *
 * ── Was seit der Store-Vegetation dazukommt ──────────────────────────
 * `shared/src/storeFlora.ts` schaltet die Kuratierungslisten zwischen dem
 * alten eigenen Bestand und dem Store um (`STORE_FLORA_AKTIV`), und beide
 * Bestände bleiben dabei in `EIGENE_FLORA` registriert. Beides wird hier
 * festgehalten:
 *
 *   • In BEIDEN Stellungen des Schalters muss jeder Name einer
 *     `*_FLORA_NAMEN`-Liste einen Streueintrag haben. Sonst hängt die
 *     Richtigkeit der Welt daran, wie der Schalter gerade steht.
 *   • Der alte Bestand bleibt registriert. Ohne ihn verlöre jede
 *     bestehende Welt ihre von Hand gesetzten Bäume — und zwar
 *     wortlos, weil ein ZDO ohne PrefabDef einfach nicht erscheint.
 *
 *   npx tsx shared/test/flora-verdrahtung.ts
 */
import {
  ASCHE_FLORA,
  ASCHE_FLORA_NAMEN,
  EIGENE_FLORA,
  GRASLAND_FLORA,
  GRASLAND_FLORA_NAMEN,
  HOCHNORD_FLORA,
  HOCHNORD_FLORA_NAMEN,
  NADELWALD_FLORA,
  NADELWALD_FLORA_NAMEN,
  STORE_FLORA_AKTIV,
  STORE_FLORA_BEREIT,
  STORE_FLORA_BUENDEL,
  SUMPF_FLORA,
  SUMPF_FLORA_NAMEN,
} from '../src/index.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const gestreut = new Set(EIGENE_FLORA.map((f) => f.prefabName));

// ── Jeder kuratierte Name hat einen Streueintrag ─────────────────────
const LISTEN: readonly (readonly [string, readonly string[]])[] = [
  ['GRASLAND_FLORA_NAMEN', GRASLAND_FLORA_NAMEN],
  ['NADELWALD_FLORA_NAMEN', NADELWALD_FLORA_NAMEN],
  ['SUMPF_FLORA_NAMEN', SUMPF_FLORA_NAMEN],
  ['HOCHNORD_FLORA_NAMEN', HOCHNORD_FLORA_NAMEN],
  ['ASCHE_FLORA_NAMEN', ASCHE_FLORA_NAMEN],
];
for (const [name, liste] of LISTEN) {
  const ohne = liste.filter((n) => !gestreut.has(n));
  check(`${name}: alle ${liste.length} Namen haben einen Streueintrag`, ohne.length === 0, ohne.join(', '));
}

/*
  Und dieselbe Frage für die NICHT aktive Stellung des Schalters. Die
  `*_FLORA_NAMEN` zeigen immer nur eine der beiden Seiten; die andere
  wäre ungeprüft, und ein Umlegen des Schalters brächte sie ungeprüft in
  die Welt.
*/
for (const [biom, liste] of STORE_FLORA_BUENDEL) {
  const ohne = liste.filter((f) => !gestreut.has(f.name));
  check(
    `Store-Bündel ${biom}: alle ${liste.length} Arten stehen in EIGENE_FLORA`,
    ohne.length === 0,
    ohne.map((f) => f.name).join(', ')
  );
}
for (const [name, liste] of [
  ['GRASLAND_FLORA', GRASLAND_FLORA],
  ['NADELWALD_FLORA', NADELWALD_FLORA],
  ['SUMPF_FLORA', SUMPF_FLORA],
  ['HOCHNORD_FLORA', HOCHNORD_FLORA],
  ['ASCHE_FLORA', ASCHE_FLORA],
] as const) {
  const ohne = liste.filter((f) => !gestreut.has(f.prefabName));
  check(
    `alter Bestand ${name}: alle ${liste.length} Arten bleiben registriert`,
    ohne.length === 0,
    ohne.map((f) => f.prefabName).join(', ')
  );
}

// ── Ein Prefab, ein Streueintrag ─────────────────────────────────────
/*
  `EIGENE_FLORA` entdoppelt nach Namen (siehe flora.ts). Bricht das, wird
  jede doppelt genannte Art doppelt gestreut — und das sieht man im Bild
  nicht, weil zwei Bäume an derselben Stelle wie einer aussehen. Man
  sieht es an der Framezeit, drei Wochen später.
*/
check(
  'kein Prefab hat zwei Streueinträge',
  gestreut.size === EIGENE_FLORA.length,
  `${EIGENE_FLORA.length} Einträge, ${gestreut.size} Namen`
);

// ── Der Schalter tut, was er sagt ────────────────────────────────────
const storeNamen = new Set(STORE_FLORA_BUENDEL.flatMap(([, l]) => l.map((f) => f.name)));
const kuratiert = new Set(LISTEN.flatMap(([, l]) => l));
const ausStore = [...kuratiert].filter((n) => storeNamen.has(n)).length;
if (STORE_FLORA_AKTIV && STORE_FLORA_BEREIT) {
  check(
    'Schalter an: die Kuratierungslisten führen ausschliesslich Store-Arten',
    ausStore === kuratiert.size,
    `${ausStore} von ${kuratiert.size}`
  );
} else {
  check(
    'Schalter aus (oder Store nicht registriert): die Kuratierungslisten führen den alten Bestand',
    ausStore === 0,
    `${ausStore} Store-Arten in den Listen`
  );
  console.log(
    `     STORE_FLORA_AKTIV=${STORE_FLORA_AKTIV}, STORE_FLORA_BEREIT=${STORE_FLORA_BEREIT}` +
      ' — der Store-Bestand wartet auf seine PrefabDefs (tools/store-prefabs.mjs → EIGENE_MODELLE).'
  );
}

console.log(
  `\nEIGENE_FLORA: ${EIGENE_FLORA.length} Streueinträge, davon ${
    EIGENE_FLORA.filter((f) => storeNamen.has(f.prefabName)).length
  } aus dem Store`
);

if (fehler > 0) {
  console.error(`\n${fehler} Fehlschläge`);
  process.exit(1);
}
console.log('alles grün');
