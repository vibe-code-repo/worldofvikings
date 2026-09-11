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
  FORM_UEBERSTEUERUNG,
  STORE_FELSEN_NAMEN,
  STORE_NICHT_STREUEN,
  STORE_OHNE_KOERPER,
  STORE_PREFAB_DEFS,
  istFesterKoerper,
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
  nurAlt.length === 0,
  `(a) die neue Regel verliert keines der ${altFest.length} alten festen Speicher-Prefabs`,
  `nur alt: ${nurAlt.slice(0, 3).join(', ')}`
);
/*
  Seit dem 11.09.2026 ist der Unterschied NICHT mehr leer, und das ist
  der Punkt: Genau die Handtabelle darf hinzukommen und sonst nichts.
  Stünde hier weiter „beide Mengen sind gleich", müsste man den Zeugen
  bei jeder Übersteuerung abschalten — dann bewacht er nichts mehr.
*/
pruefe(
  nurNeu.length === FORM_UEBERSTEUERUNG.size &&
    nurNeu.every((n) => FORM_UEBERSTEUERUNG.has(n)),
  `(a) dazu kommen genau die ${FORM_UEBERSTEUERUNG.size} übersteuerten Prefabs`,
  `nur neu: ${nurNeu.join(', ')}`
);
pruefe(
  neuFest.length === altFest.length + FORM_UEBERSTEUERUNG.size,
  `(a) die feste Menge wächst von ${altFest.length} auf ${neuFest.length}`
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

// ── (f) Die grossen Büsche sind fest, die kleinen nicht ───────────────
/*
  Die Entscheidung vom 11.09.2026, als Zeuge statt als Kommentar. Im
  Vorbild tragen die grossen Büsche eine Kapsel von r 0,65 m und 3,5 bis
  4,6 m Höhe; Gras, Äste, Pilze und die kleinen Büsche bleiben
  durchlässig. Der Fehler, gegen den das steht, hat zwei Richtungen:
  läuft man durch einen 4,4 m hohen Strauch hindurch, sieht die Welt
  unfertig aus — bleibt man an einem Grasbüschel hängen, ist sie
  unspielbar.

  Geprüft wird ohne eine einzige Modelldatei: Die Form steht in der
  Tabelle, nicht in der Geometrie. Genau das ist ihr Zweck.
*/
const GROSSE_BUESCHE = [
  'vegetation-large-bush-1a1',
  'vegetation-large-bush-1a2',
  'vegetation-large-bush-1a3',
  'vegetation-large-bush-1a4',
  'vegetation-large-bush-1a5',
];
pruefe(
  FORM_UEBERSTEUERUNG.size === GROSSE_BUESCHE.length &&
    GROSSE_BUESCHE.every((n) => FORM_UEBERSTEUERUNG.has(n)),
  `(f) die Handtabelle führt genau die ${GROSSE_BUESCHE.length} grossen Büsche`,
  [...FORM_UEBERSTEUERUNG.keys()].join(', ')
);
for (const name of GROSSE_BUESCHE) {
  const def = STORE_PREFAB_DEFS.find((d) => d.name === name);
  /*
    `istFesterKoerper` und nicht nur `istFesterStoreKoerper`: Der
    Namensfilter WEICHE_VEGETATION fängt jedes `bush` ab, auch das
    4,4 m hohe. Ohne die Übersteuerung ganz vorn wäre die Menge aus (a)
    richtig und der Bucket im Client trotzdem körperlos.
  */
  pruefe(istFesterStoreKoerper(def), `(f) ${name} zählt zu den festen Speicher-Prefabs`);
  pruefe(
    istFesterKoerper(def, name, {}),
    `(f) ${name} kommt auch am Namensfilter WEICHE_VEGETATION vorbei`
  );
  /*
    Der Katalog sagt weiter `none` — das gehört so. Die Übersteuerung
    ÄNDERT die Quelle nicht, sie steht davor; ginge diese Zeile eines
    Tages auf `box`, wäre jemand doch im Generator gewesen.
  */
  pruefe(storeKollision(name)?.art === 'none', `(f) ${name} steht in der Quelle weiter auf none`);
  const form = kollisionsForm(wuerfelP, wuerfelI, name, storeKollision(name), {});
  const hoehe = form?.art === 'kapsel' ? form.yMax - form.yMin : 0;
  pruefe(
    form?.art === 'kapsel' && form.radius === 0.65 && form.x === 0 && form.z === 0,
    `(f) ${name} ist eine stehende Kapsel mit r 0,65 m`,
    JSON.stringify(form)
  );
  pruefe(
    hoehe > 2.5 && hoehe < 5,
    `(f) ${name} ist ${hoehe.toFixed(3)} m hoch (Vorbild 3,5–4,6 m, der kleinste 2,5 m)`
  );
  /*
    Und der Zeuge dafür, dass die Zahl wirklich aus der Tabelle kommt:
    Die übergebene Punktwolke ist der 2-m-Würfel von oben. Käme die
    Höhe aus der Geometrie, stünde hier 2,0.
  */
  pruefe(
    Math.abs(hoehe - 2) > 0.4,
    `(f) ${name}: die Höhe kommt aus der Tabelle, nicht aus der Punktwolke`
  );
}
/*
  Die Gegenprobe. `bush-1a1` ist 1,9 m hoch und `bush-1a3` sogar 2,8 m —
  nach jeder Geometrieprobe wären sie Hindernisse; im Vorbild läuft man
  hindurch. Die Äste und Grasbüschel stehen dazu, weil sie die Menge
  sind, an der man einen zu weit gefassten Namensvergleich merkt
  (`large-bush` gegen `bush`).
*/
const DURCHLAESSIG = [
  'vegetation-bush-1a1',
  'vegetation-bush-1a1-small',
  'vegetation-bush-1a2',
  'vegetation-bush-1a2-small',
  'vegetation-bush-1a2-small-1-dark',
  'vegetation-bush-1a2-small-1-snow',
  'vegetation-bush-1a3',
  'vegetation-branch-1a1',
  'vegetation-branch-1a5',
  'vegetation-branch-1a7',
  'vegetation-branch-1a9',
  'vegetation-grass-short-clump-1',
  'vegetation-grass-short-clump-redblue',
  'vegetation-grass-short-clump-snow',
  'vegetation-grass-short-clump-yellow',
  'vegetation-sm-plant-mushrooms-02',
];
for (const name of DURCHLAESSIG) {
  const def = STORE_PREFAB_DEFS.find((d) => d.name === name);
  pruefe(
    def !== undefined && !istFesterKoerper(def, name, {}),
    `(f) ${name} bleibt durchlässig`
  );
  pruefe(
    kollisionsForm(wuerfelP, wuerfelI, name, storeKollision(name), {}) === null,
    `(f) ${name} bekommt auch bei tragfähiger Geometrie keine Form`
  );
}
/*
  Und die ganze übrige Vegetation ebenfalls: 132 Store-Modelle unter
  `…/vegetation/`, von denen genau fünf einen Körper bekommen sollen.
  Diese Zeile ist der Zeuge gegen die Übersteuerung als Dammbruch — wer
  eine sechste Zeile einträgt, muss hier vorbei.
*/
const vegetationFest = STORE_PREFAB_DEFS.filter(
  (d) => !!d.model && d.model.includes('vegetation/') && istFesterKoerper(d, d.name, {})
).map((d) => d.name);
pruefe(
  vegetationFest.length === GROSSE_BUESCHE.length,
  `(f) von der gesamten Speicher-Vegetation sind genau ${GROSSE_BUESCHE.length} fest`,
  vegetationFest.join(', ')
);

console.log(
  fehler === 0 ? '\nOK — die Kollisionstabellen sagen, was sie sagen sollen' : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
