/**
 * Die Kollisions-TABELLEN — ohne eine einzige Modelldatei.
 *
 * Alles, was hier geprüft wird, ist reine Rechnung über eingecheckte
 * Tabellen; der Test läuft deshalb auch im CI-Checkout, in dem
 * `assets/store` fehlt. Die Fragen, und warum jede eine ist:
 *
 *  (a) DIE MENGE „FEST" HAT SICH NICHT VERSCHOBEN. `istFesterStoreKoerper`
 *      fragt seit dem 10.09.2026 die schmale Kollisionstabelle
 *      (`art: 'none'`) statt nur `STORE_NICHT_STREUEN`. Beide Mengen sind
 *      NICHT dieselbe — der Unterschied sind 15 Höhenfelder —, und genau
 *      deshalb muss hier stehen, dass das Ergebnis trotzdem dasselbe ist.
 *      Ohne diesen Zeugen wäre der Wechsel eine lautlose Änderung an der
 *      Frage, wo der Spieler stehenbleibt.
 *
 *  (b) `storeKollision()` ANTWORTET NUR FÜR DEN SPEICHER. Die Tabelle
 *      führt AUSNAHMEN; ohne Namensgrenze bekäme jeder Altbestands-Name
 *      die Vorgabe `box` untergeschoben.
 *
 *  (c) `art: 'none'` HEISST WIRKLICH KEIN KÖRPER — auch dann, wenn die
 *      Geometrie danach aussieht, als wäre sie eins. Geprüft an einer
 *      erfundenen Punktwolke, damit keine Datei nötig ist.
 *
 *  (d) FELSEN BEKOMMEN DAS NETZ, obwohl der Katalog bei allen 22
 *      `art: 'box'` sagt. Das ist die Entscheidung aus der Vermessung des
 *      Vorbilds (dort tragen Felsen ausnahmslos konvexe Netze), und sie
 *      steht gegen die Quelle — also gehört sie unter einen Zeugen.
 *
 *  (e) KEIN `Math.hypot`/`pow`/`atan2` in der geteilten Ableitung.
 *      Gedächtnisnotiz „Portierung: Float-Vergleiche": Diese drei liefern
 *      in verschiedenen Laufzeiten verschiedene Bits, und hier rechnen
 *      zwei Prozesse dasselbe und vergleichen die Ergebnisse. Ein Textkauf
 *      über die Quelle ist die einzige Prüfung, die das FESTHÄLT — an den
 *      Zahlen selbst sähe man den Unterschied erst auf einer anderen
 *      Maschine.
 *
 *   npx tsx shared/test/kollision-mengen.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORE_FELSEN_NAMEN,
  STORE_NICHT_STREUEN,
  STORE_OHNE_KOERPER,
  STORE_PREFAB_DEFS,
  istFesterStoreKoerper,
  istStoreModell,
  kollisionsForm,
  kollisionsModellPfad,
  storeKollision,
} from '@wov/shared';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');

let fehler = 0;
function pruefe(bedingung: boolean, was: string, detail = ''): void {
  if (bedingung) console.log(`  OK   ${was}`);
  else {
    fehler++;
    console.error(`  ROT  ${was}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── (a) Die Menge „fest" ──────────────────────────────────────────────
const VEGETATION = 'vegetation/';
const altFest = STORE_PREFAB_DEFS.filter(
  (d) =>
    !!d.model &&
    istStoreModell(d.model) &&
    !d.model.includes(VEGETATION) &&
    !STORE_NICHT_STREUEN.has(d.name)
).map((d) => d.name);
const neuFest = STORE_PREFAB_DEFS.filter(istFesterStoreKoerper).map((d) => d.name);
const altMenge = new Set(altFest);
const neuMenge = new Set(neuFest);
const nurAlt = altFest.filter((n) => !neuMenge.has(n));
const nurNeu = neuFest.filter((n) => !altMenge.has(n));
pruefe(altFest.length > 400, `(a) die Menge ist nicht leer (${altFest.length})`);
pruefe(
  nurAlt.length === 0 && nurNeu.length === 0,
  `(a) neue Regel liefert dieselben ${altFest.length} festen Speicher-Prefabs`,
  `nur alt: ${nurAlt.slice(0, 3).join(', ')} | nur neu: ${nurNeu.slice(0, 3).join(', ')}`
);
/*
  Und der Grund, warum (a) nicht selbstverständlich ist — als eigene
  Zeile, damit man ihn beim Lesen des Protokolls sieht statt ihn im
  Kommentar suchen zu müssen.
*/
const hoehenfelder = [...STORE_NICHT_STREUEN].filter((n) => !STORE_OHNE_KOERPER.has(n));
pruefe(
  hoehenfelder.length > 0 && hoehenfelder.every((n) => n.startsWith('terrain-')),
  `(a) die beiden Mengen unterscheiden sich um ${hoehenfelder.length} Höhenfelder`,
  hoehenfelder.slice(0, 3).join(', ')
);

// ── (b) Die Namensgrenze ──────────────────────────────────────────────
pruefe(storeKollision('Beech_small1') === null, '(b) Altbestands-Name bekommt keine Angabe');
pruefe(
  storeKollision('environment-barrel-destructible')?.art === 'box',
  '(b) ein Speicher-Prefab ohne Eintrag bekommt die Vorgabe box'
);
pruefe(
  storeKollision('environment-backdrop-mountains-clear')?.art === 'none',
  '(b) die Bergkulisse steht auf none'
);
pruefe(
  storeKollision('environment-sm-bld-house-stairs-03')?.netz ===
    'environment/sm-bld-house-stairs-03-collision.glb',
  '(b) die Treppe nennt ihre eigene Kollisions-GLB'
);
pruefe(
  kollisionsModellPfad('environment/sm-bld-house-stairs-03-collision.glb') ===
    'store/environment/sm-bld-house-stairs-03-collision',
  '(b) der Netzpfad wird zum Modellnamen (Präfix dran, Endung weg)'
);

// ── (c) `none` heisst kein Körper ─────────────────────────────────────
/*
  Ein Quader von 2 m Kantenlänge — hoch genug, breit genug, mit
  Dreiecken. Jede Geometrieprobe der Welt gäbe ihm einen Körper; die
  Quellenangabe muss ihn trotzdem verhindern.
*/
const wuerfelP = new Float32Array([
  -1, 0, -1, 1, 0, -1, 1, 2, -1, -1, 2, -1, -1, 0, 1, 1, 0, 1, 1, 2, 1, -1, 2, 1,
]);
const wuerfelI = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
pruefe(
  kollisionsForm(wuerfelP, wuerfelI, 'environment-sm-prop-cloud-01', { art: 'none' }, {}) === null,
  '(c) art none ergibt keine Form, auch bei tragfähiger Geometrie'
);
pruefe(
  kollisionsForm(wuerfelP, wuerfelI, 'environment-sm-prop-crate-wood-01', { art: 'box' }, {})
    ?.art === 'kiste',
  '(c) derselbe Würfel als box ergibt eine Kiste'
);

// ── (d) Felsen bekommen das Netz, nicht die Katalog-Kiste ─────────────
const felsenMitBox = [...STORE_FELSEN_NAMEN].filter((n) => storeKollision(n)?.art === 'box');
pruefe(
  felsenMitBox.length === STORE_FELSEN_NAMEN.size,
  `(d) der Katalog führt alle ${STORE_FELSEN_NAMEN.size} Felsen als box`,
  `${felsenMitBox.length}`
);
const einFels = [...STORE_FELSEN_NAMEN][0]!;
pruefe(
  kollisionsForm(wuerfelP, wuerfelI, einFels, storeKollision(einFels), {})?.art === 'netz',
  `(d) ${einFels} bekommt trotzdem das Netz`
);

// ── (e) Keine laufzeitabhängige Gleitkommafunktion ────────────────────
const VERBOTEN = /Math\.(hypot|pow|atan2|cbrt|expm1|log1p|fround)\s*\(/;
for (const datei of ['shared/src/kollision/formen.ts', 'shared/src/kollision/glb.ts']) {
  const text = readFileSync(join(WURZEL, datei), 'utf8');
  pruefe(!VERBOTEN.test(text), `(e) ${datei} rechnet ohne hypot/pow/atan2`);
}

console.log(
  fehler === 0 ? '\nOK — die Kollisionstabellen sagen, was sie sagen sollen' : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
