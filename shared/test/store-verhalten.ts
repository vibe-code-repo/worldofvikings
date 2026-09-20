/**
 * Prüft: dass die Store-Prefabs, die etwas TUN sollen (Findling, Bett,
 * Truhe), ihre Flags aus der erzeugten Tabelle `storeVerhalten.ts`
 * bekommen — und dass sonst keines etwas bekommt.
 *
 * ── Wogegen dieser Test steht ────────────────────────────────────────
 * Ein Flag, das fehlt, fällt nirgends auf: Der Findling steht da, die
 * Spitzhacke schlägt ins Leere, und der Server antwortet gar nicht. Die
 * Prüfung hat deshalb drei Richtungen:
 *
 *  (a) DIE MENGEN STIMMEN — je Gruppe eine Zahl, nicht „alle". Steigt sie
 *      ohne Absicht (eine zu weite Regel im Generator nimmt
 *      `stone-throne` oder `chest-01-lid` mit), wird der Test rot.
 *  (b) NICHTS ZUSÄTZLICH — jedes Store-Prefab mit mehr als PERSISTENT steht
 *      in der Tabelle. Damit ist die Registry nicht heimlich anderswo
 *      erweitert worden (etwa durch eine Namensregex in `prefabs.ts`).
 *  (c) DIE STREUTABELLE IST GEDECKT — jeder Findling, den die Weltgenerierung
 *      streut (`STORE_FELSEN_NAMEN`), ist abbaubar. Sonst erzeugt der
 *      Generator Felsen, die der Spieler nicht angreifen kann.
 *  (d) KLIPPEN SIND AUSGENOMMEN (Mikes Entscheidung 20.09.2026) — kein
 *      `rock-cliff-*` trägt ein Flag über PERSISTENT hinaus: Klippen sind
 *      Gelände, keine Findlinge.
 *
 *   npx tsx shared/test/store-verhalten.ts
 */
import {
  BAU_PREFABS,
  PIECE_TABLES,
  PIECES,
  PREFABS_BY_NAME,
  PrefabFlag,
  STORE_FELSEN_NAMEN,
  STORE_PREFAB_DEFS,
} from '@wov/shared';
import { STORE_VERHALTEN } from '@wov/shared/src/storeVerhalten.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const F = PrefabFlag;
const flagsVon = (name: string): bigint => PREFABS_BY_NAME.get(name)?.flags ?? 0n;
const hat = (name: string, flag: bigint): boolean => (flagsVon(name) & flag) === flag;

const namen = STORE_PREFAB_DEFS.map((d) => d.name);
const mitFlag = (flag: bigint): string[] => namen.filter((n) => hat(n, flag));

// ── (a) Die Mengen ─────────────────────────────────────────────────────
const felsen = mitFlag(F.MINE_ROCK_5);
const betten = mitFlag(F.BED);
const truhen = mitFlag(F.CONTAINER);
console.log(`Felsen ${felsen.length}, Betten ${betten.length}, Truhen ${truhen.length}`);
check('26 Store-Prefabs tragen MINE_ROCK_5 (33 minus 7 Klippen)', felsen.length === 26, `${felsen.length}`);
check('4 Store-Prefabs tragen BED', betten.length === 4, `${betten.length}`);
check('4 Store-Prefabs tragen CONTAINER', truhen.length === 4, `${truhen.length}`);
check(
  'die Betten sind sm-prop-bed-03…06 und tragen PIECE|BED|PERSISTENT',
  ['03', '04', '05', '06'].every((n) => {
    const name = `environment-sm-prop-bed-${n}`;
    return hat(name, F.PIECE | F.BED | F.PERSISTENT);
  }) && betten.every((n) => /^environment-sm-prop-bed-0[3-6]$/.test(n)),
  betten.join(', ')
);
check(
  'die Truhen sind die vier Truhenkörper, keine Deckel und Riegel',
  truhen.slice().sort().join(',') ===
    [
      'environment-chestbottom',
      'environment-sm-prop-chest-01',
      'environment-sm-prop-chest-01-0',
      'environment-sm-prop-chest-04',
    ].join(','),
  truhen.join(', ')
);
const KLIPPEN = namen.filter((n) => /^environment-sm-env-rock-cliff-/.test(n));
check('der Store führt 7 Klippen-Prefabs', KLIPPEN.length === 7, `${KLIPPEN.length}`);
check(
  'KEINE Klippe trägt ein Flag über PERSISTENT hinaus (nicht abbaubar)',
  KLIPPEN.every((n) => flagsVon(n) === F.PERSISTENT && !STORE_VERHALTEN.has(n)),
  KLIPPEN.filter((n) => flagsVon(n) !== F.PERSISTENT || STORE_VERHALTEN.has(n)).join(', ')
);
check('kein abbaubarer Fels der Tabelle heisst cliff', felsen.every((n) => !/cliff/.test(n)));
const nichtFels = ['environment-sm-env-stone-throne-01', 'environment-sm-env-stonewall-01',
  'environment-sm-env-house-rocks-large-01', 'environment-sm-prop-path-rock-01',
  'environment-sm-item-rock-01', 'environment-sm-prop-chest-01-lid',
  'environment-sm-prop-chest-01-latch', 'environment-chesttop', 'environment-sm-prop-chest-lid-01'];
check(
  'Bauwerk, Pflaster, Gegenstandsmodell und Truhenteile bleiben ohne Verhalten',
  nichtFels.every((n) => PREFABS_BY_NAME.has(n) && flagsVon(n) === F.PERSISTENT),
  nichtFels.filter((n) => flagsVon(n) !== F.PERSISTENT).join(', ')
);

// ── (b) Nichts zusätzlich ──────────────────────────────────────────────
const abweichend = namen.filter((n) => flagsVon(n) !== F.PERSISTENT);
check(
  `genau die ${STORE_VERHALTEN.size} Tabelleneinträge tragen mehr als PERSISTENT`,
  abweichend.length === STORE_VERHALTEN.size && abweichend.every((n) => STORE_VERHALTEN.has(n)),
  abweichend.filter((n) => !STORE_VERHALTEN.has(n)).join(', ')
);
check(
  'jeder Tabelleneintrag nennt ein Store-Prefab',
  [...STORE_VERHALTEN.keys()].every((n) => namen.includes(n))
);
check(
  'die Registry trägt genau die Flags der Tabelle (keine Extraflags, keine fehlenden)',
  [...STORE_VERHALTEN].every(([n, f]) => flagsVon(n) === f)
);

// ── (c) Die Streutabelle ist gedeckt, (d) Klippen bleiben stehen ──────
const gestreuteKlippen = [...STORE_FELSEN_NAMEN].filter((n) => /cliff/.test(n));
const gestreuteFindlinge = [...STORE_FELSEN_NAMEN].filter((n) => !/cliff/.test(n));
const ungedeckt = gestreuteFindlinge.filter((n) => !hat(n, F.MINE_ROCK_5));
check(
  `${gestreuteFindlinge.length} von ${STORE_FELSEN_NAMEN.size} gestreuten Felsen sind abbaubar (18 von 22)`,
  STORE_FELSEN_NAMEN.size === 22 && gestreuteFindlinge.length === 18 && ungedeckt.length === 0,
  ungedeckt.join(', ')
);
check(
  'die 4 gestreuten Klippen sind NICHT abbaubar',
  gestreuteKlippen.length === 4 && gestreuteKlippen.every((n) => !hat(n, F.MINE_ROCK_5)),
  gestreuteKlippen.filter((n) => hat(n, F.MINE_ROCK_5)).join(', ')
);

// ── Bett und Truhe im Spiel ────────────────────────────────────────────
const bettPrefab = PIECES.bau_bett?.bauPrefab ?? '';
check('bau_bett zeigt auf ein Store-Bett', /^environment-sm-prop-bed-0[3-6]$/.test(bettPrefab), bettPrefab);
check('bau_bett steht im Hammer-Menü', (PIECE_TABLES.Hammer ?? []).includes('bau_bett'));
check('das Bett steht in der Server-Whitelist BAU_PREFABS', BAU_PREFABS.has(bettPrefab));
check('das Bett trägt BED (Benutzen setzt den Wiedereinstieg)', hat(bettPrefab, F.BED));
check('GrabTruhe trägt CONTAINER', hat('GrabTruhe', F.CONTAINER));
check('GrabTruhe bleibt PERSISTENT', hat('GrabTruhe', F.PERSISTENT));

if (fehler > 0) {
  console.error(`\n${fehler} FEHLER`);
  process.exit(1);
}
console.log('\nOK — Store-Verhalten stimmt');
