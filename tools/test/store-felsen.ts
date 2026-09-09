/**
 * Hält `shared/src/storeFelsen.ts` gegen den Store fest — und gegen das,
 * was der Auftrag versprochen hat.
 *
 * Alle Fragen werden aus dem STORE beantwortet, nicht aus einer zweiten
 * Tabelle im Testcode. Das ist dieselbe Regel, unter der
 * `tools/test/store-flora.ts` steht, und sie trägt hier noch mehr: Beim
 * Fels entscheiden Zahlen, die man dem Namen nicht ansieht — die Höhe,
 * der Ursprung, die Textur.
 *
 *  (a) NAME UND DATEI. Jeder Name steht in `assets/store/prefabs.json`,
 *      die GLB liegt wirklich da, und keiner steht in
 *      `STORE_NICHT_STREUEN`. Ein Tippfehler bricht nichts — er erzeugt
 *      einen Streueintrag, den `findPrefabByHash()` nie findet, und die
 *      Region bleibt an dieser Art kahl. Lautlos.
 *
 *  (b) NEIGUNGSFENSTER. `minTilt < maxTilt`, beide zwischen 0 und 90.
 *      Ein verdrehtes Paar ist der teuerste stille Fehler dieser Datei:
 *      `streuung.ts` prüft `normal.y >= cos(maxTilt) && normal.y <=
 *      cos(minTilt)`, und bei min > max ist die Bedingung für JEDE
 *      Neigung falsch. Die Art verschwindet vollständig aus der Welt,
 *      ohne Fehlermeldung.
 *
 *  (c) LANDSCHAFT. Jede Biomliste trägt mindestens einen kleinen und
 *      einen grossen Fels. Klein und gross werden nicht am Namen
 *      erkannt (`rock-chunk-01` ist 1,9 m, `rock-01` 0,35 m), sondern an
 *      der GEMESSENEN Hüllbox aus `prefabs.json`:
 *
 *          klein   < 1 m grösste Ausdehnung
 *          mittel  1 … 3 m
 *          gross   > 3 m
 *
 *      Eine Liste nur aus Kies ist ein Strand, eine nur aus Klippen ein
 *      Steinbruch. Beides kann gewollt sein, aber nicht versehentlich.
 *
 *  (d) HANGVORZUG — die eigentliche Zusage des Auftrags („an Hängen
 *      öfter"). Der grosse Fels muss ein Neigungsfenster haben, das
 *      HÖHER liegt als das des kleinen: `minTilt` der grössten Klasse
 *      über dem der kleinsten. Ohne diese Prüfung wäre der Auftrag durch
 *      Streichen aller `minTilt`-Werte zu erfüllen, und niemand sähe es
 *      ausser im Bild.
 *
 *  (e) EINGEARBEITET. Der Fels darf weder schweben noch verschwinden.
 *      Gerechnet aus dem Ursprung der Hüllbox und dem `versatz`:
 *
 *          Einbau = (−min.y − versatz) / Höhe
 *
 *      verlangt wird 20 … 60 %. Das ist die STATISCHE Rechnung auf
 *      ebenem Boden; im Hang misst `~/wov-lab-mess/felsen-eingrabung.mts`
 *      am gestreuten Stand nach. Beide braucht es: Der Prüfer hier fängt
 *      eine verstellte Zahl in Millisekunden, die Messung fängt, was
 *      erst das Gelände macht.
 *
 *  (f) TEXTUR. Kein gestreutes Modell ohne Textur. Sechs Felsen des
 *      Stores tragen `DefaultMaterial` ohne Bild und ohne Farbe — sie
 *      wären weisse Steine in der Landschaft, und „weiss" sieht nicht
 *      nach Fehler aus, sondern nach Kalk. Zu jedem gibt es ein
 *      texturiertes Geschwister; gestreut gehört das.
 *
 *  (g) DIE ANNAHME DER KOLLISION. `client/src/entities/EntityManager.ts`
 *      entscheidet über die Kollision eines Speicher-Modells OHNE den
 *      Katalog (der ist absichtlich nicht im Spiel-Bündel) und benutzt
 *      dafür `STORE_NICHT_STREUEN` als Ersatz für „Kollisionsart
 *      `none`". Diese Annahme wird HIER geprüft, wo der Katalog nichts
 *      kostet: Ausserhalb von `vegetation/` müssen sich beide Mengen
 *      exakt decken. Läuft das auseinander, bekommt eine Wolke einen
 *      Körper — und niemand sucht den Fehler in einer Felstabelle.
 *
 * WEICHE: Fehlt `assets/store` GANZ, überspringt `scripts/run-tests.mjs`
 * diesen Test (`brauchtModelle('assets/store')`). Fehlt eine EINZELNE
 * Datei, wird er rot — die Sonde entscheidet nie selbst, ob sie laufen
 * darf (siehe scripts/testweichen.mjs).
 *
 *   npx tsx tools/test/store-felsen.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STORE_FELSEN_BUENDEL, STORE_FELSEN_NAMEN } from '../../shared/src/storeFelsen.js';
import { STORE_NICHT_STREUEN } from '../../shared/src/storePrefabs.js';
import { STORE_KATALOG } from '../../shared/src/storeKatalogDaten.js';
import type { FloraKurz } from '../../shared/src/flora.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE = join(WURZEL, 'assets/store');
const PREFABS = join(STORE, 'prefabs.json');

/** Ab hier ist es ein grosser Fels: über Kopfhöhe hinaus. */
const GROSS = 3;
/** Darunter ist es ein Brocken, den man übersieht, wenn man nicht hinsieht. */
const KLEIN = 1;
/** Erlaubtes Einbaufenster auf ebenem Boden, Anteil der Modellhöhe. */
const EINBAU_MIN = 0.2;
const EINBAU_MAX = 0.6;

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

check('assets/store/prefabs.json existiert', existsSync(PREFABS));
if (fehler > 0) {
  console.error('\nOhne den Store lässt sich nichts prüfen — Weiche in run-tests.mjs.');
  process.exit(1);
}

type StorePrefab = { id: string; asset: string; bounds: { min: number[]; max: number[] } };
const prefabs: StorePrefab[] = JSON.parse(readFileSync(PREFABS, 'utf8')).prefabs;
const jeId = new Map(prefabs.map((p) => [p.id, p]));

// ── (a) Name, Datei, Streuverbot ─────────────────────────────────────
const fehlendeNamen: string[] = [];
const fehlendeDateien: string[] = [];
const verboten: string[] = [];
let arten = 0;
for (const [biom, liste] of STORE_FELSEN_BUENDEL) {
  for (const eintrag of liste) {
    arten++;
    const prefab = jeId.get(eintrag.name);
    if (!prefab) {
      fehlendeNamen.push(`${eintrag.name} (${biom})`);
      continue;
    }
    if (!existsSync(join(STORE, prefab.asset))) fehlendeDateien.push(prefab.asset);
    if (STORE_NICHT_STREUEN.has(eintrag.name)) verboten.push(`${eintrag.name} (${biom})`);
  }
}
check(`alle ${arten} Fels-Streueinträge stehen in prefabs.json`, fehlendeNamen.length === 0, fehlendeNamen.join(', '));
check('zu jedem Eintrag liegt die GLB im Store', fehlendeDateien.length === 0, fehlendeDateien.join(', '));
check('kein Eintrag steht in STORE_NICHT_STREUEN', verboten.length === 0, verboten.join(', '));

if (fehler > 0) {
  console.error('\nOhne auflösbare Namen ist der Rest nicht messbar.');
  process.exit(1);
}

/** Grösste Ausdehnung des Modells in Metern — die „Grösse" des Felses. */
const groesse = (name: string): number => {
  const b = jeId.get(name)!.bounds;
  return Math.max(b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!);
};
const klasse = (name: string): 'klein' | 'mittel' | 'gross' => {
  const g = groesse(name);
  return g < KLEIN ? 'klein' : g <= GROSS ? 'mittel' : 'gross';
};

// ── (b) Neigungsfenster ──────────────────────────────────────────────
const kaputt: string[] = [];
for (const [biom, liste] of STORE_FELSEN_BUENDEL) {
  for (const e of liste) {
    const min = e.minTilt ?? 0;
    if (!(min >= 0 && min < e.maxTilt && e.maxTilt <= 90)) {
      kaputt.push(`${e.name} (${biom}): ${min}…${e.maxTilt}°`);
    }
  }
}
check('jedes Neigungsfenster ist 0 ≤ min < max ≤ 90°', kaputt.length === 0, kaputt.join('; '));

// ── (c) Landschaft ───────────────────────────────────────────────────
for (const [biom, liste] of STORE_FELSEN_BUENDEL) {
  const nach = { klein: 0, mittel: 0, gross: 0 };
  for (const e of liste) nach[klasse(e.name)]++;
  console.log(
    `     ${biom.padEnd(10)} ${String(liste.length).padStart(2)} Arten: ` +
      `${nach.klein} klein, ${nach.mittel} mittel, ${nach.gross} gross`
  );
  check(`${biom}: mindestens ein kleiner Fels (< ${KLEIN} m)`, nach.klein > 0);
  check(`${biom}: mindestens ein grosser Fels (> ${GROSS} m)`, nach.gross > 0);
}

// ── (d) Hangvorzug ───────────────────────────────────────────────────
/*
  Die Zusage des Auftrags in einer Zahl: Das Neigungsfenster der GROSSEN
  Felsen muss höher liegen als das der kleinen. Verglichen wird der
  Median der `minTilt` je Klasse und nicht der einzelne Eintrag — eine
  Ausnahme (ein Findling im flachen Sumpf) soll erlaubt bleiben, ein
  ganzes Bündel ohne Hangvorzug nicht.
*/
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.floor(s.length / 2)]!;
};
const minTiltJe = (liste: readonly FloraKurz[], k: 'klein' | 'mittel' | 'gross'): number[] =>
  liste.filter((e) => klasse(e.name) === k).map((e) => e.minTilt ?? 0);

for (const [biom, liste] of STORE_FELSEN_BUENDEL) {
  const kleinM = median(minTiltJe(liste, 'klein'));
  const grossM = median(minTiltJe(liste, 'gross'));
  console.log(`     ${biom.padEnd(10)} minTilt-Median: klein ${kleinM}°, gross ${grossM}°`);
  /*
    Der Sumpf ist die begründete Ausnahme, und sie steht in
    `storeFelsen.ts`: Dort ist der grosse Fels ein FINDLING im Flachen,
    kein Steilhangbewohner — ein 20-m-Steilfels im Moor wäre keine
    Landschaft, sondern ein Fehler. Verlangt wird deshalb nur, dass er
    nicht STEILER kuratiert ist als der kleine.
  */
  if (biom === 'sumpf') {
    check(`${biom}: der Findling ist nicht steiler kuratiert als der Kies`, grossM <= kleinM);
    continue;
  }
  check(`${biom}: grosser Fels bevorzugt den Hang (minTilt-Median > klein)`, grossM > kleinM);
}

/**
 * Die WIRKSAME Tabelle: jeder Name einmal, das erste Bündel gewinnt.
 *
 * Das ist keine Bequemlichkeit, sondern die Regel, unter der die Welt
 * gestreut wird — `EIGENE_FLORA` in `shared/src/flora.ts` entdoppelt
 * nach Namen, und alle späteren Nennungen derselben Art sind
 * WIRKUNGSLOS. Ein Prüfer, der sie trotzdem bewertete, verlangte
 * gepflegte Zahlen an Stellen, die niemand liest — und der nächste
 * Bauer trüge sie dort ein und wunderte sich, dass sich nichts ändert.
 *
 * Geprüft werden deshalb nur die Zahlen, die WIRKEN. Dass die späteren
 * Bündel reine Kuratierung sind, steht im Kopf von `storeFelsen.ts`;
 * hier wird es angewandt.
 */
const WIRKSAM: FloraKurz[] = (() => {
  const gesehen = new Set<string>();
  const raus: FloraKurz[] = [];
  for (const [, liste] of STORE_FELSEN_BUENDEL) {
    for (const e of liste) {
      if (gesehen.has(e.name)) continue;
      gesehen.add(e.name);
      raus.push(e);
    }
  }
  return raus;
})();
check(
  `jede der ${STORE_FELSEN_NAMEN.size} Arten kommt im ersten Bündel (Grasland) vor`,
  STORE_FELSEN_BUENDEL[0]![1].length === STORE_FELSEN_NAMEN.size,
  `Grasland führt ${STORE_FELSEN_BUENDEL[0]![1].length}`
);

// ── (e) Eingearbeitet ────────────────────────────────────────────────
/*
  Die Rechnung steht im Kopf von `storeFelsen.ts`: Der Ursprung dieser
  Modelle liegt MITTIG, ein Fels steckt bei versatz 0 also schon von
  sich aus etwa zur Hälfte im Boden. Geprüft wird der Anteil der
  Modellhöhe unter der Bodenlinie.

  Gerechnet wird im DATEIRAUM und das ist hier richtig: Die y-Achse
  bleibt von `boundsNachWeltraum()` unberührt (gespiegelt wird x), und
  nur y geht in diese Rechnung ein.
*/
const einbauFehler: string[] = [];
for (const e of WIRKSAM) {
  const b = jeId.get(e.name)!.bounds;
  const hoehe = b.max[1]! - b.min[1]!;
  const anteil = (-b.min[1]! - (e.versatz ?? 0)) / hoehe;
  if (anteil < EINBAU_MIN || anteil > EINBAU_MAX) {
    einbauFehler.push(`${e.name}: ${(100 * anteil).toFixed(0)} %`);
  }
}
check(
  `jeder Fels steckt ${100 * EINBAU_MIN}–${100 * EINBAU_MAX} % seiner Höhe im ebenen Boden`,
  einbauFehler.length === 0,
  einbauFehler.join('; ')
);

/*
  Und die Gegenrichtung, sonst wäre (e) durch `versatz: 0` überall zu
  bestehen: Wo das Modell die Einarbeitung NICHT mitbringt — Ursprung
  am Fuss oder fast (unter 20 %) —, MUSS ein negativer Versatz stehen.
  Das ist genau der Fall, den der Auftrag mit „ein wenig eingearbeitet"
  meint, und der einzige, in dem ein vergessener Wert im Bild auffällt
  (der Stein liegt obenauf).
*/
const ohneVersatz: string[] = [];
for (const e of WIRKSAM) {
  const b = jeId.get(e.name)!.bounds;
  const eigen = -b.min[1]! / (b.max[1]! - b.min[1]!);
  if (eigen < EINBAU_MIN && (e.versatz ?? 0) >= 0) ohneVersatz.push(e.name);
}
check(
  'jeder Fels mit Ursprung am Fuss bekommt einen negativen Versatz',
  ohneVersatz.length === 0,
  [...new Set(ohneVersatz)].join(', ')
);

// ── (f) Textur ───────────────────────────────────────────────────────
/*
  Gelesen wird die GLB selbst, nicht der Katalog: Ob ein Material ein
  Bild trägt, steht in keiner Tabelle. Ein Modell ohne `images` UND ohne
  `baseColorFactor` rendert als weisse Fläche.
*/
function hatFarbe(asset: string): boolean {
  const buf = readFileSync(join(STORE, asset));
  const jsonLen = buf.readUInt32LE(12);
  const g = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    images?: unknown[];
    materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  };
  if ((g.images?.length ?? 0) > 0) return true;
  return (g.materials ?? []).some((m) => m.pbrMetallicRoughness?.baseColorFactor !== undefined);
}
const farblos = [...STORE_FELSEN_NAMEN].filter((n) => !hatFarbe(jeId.get(n)!.asset));
check('kein gestreuter Fels ohne Textur oder Grundfarbe', farblos.length === 0, farblos.join(', '));

// ── (g) Die Annahme der Kollision ────────────────────────────────────
/*
  `istFesterStoreKoerper()` im EntityManager sagt: „Speicher-Modell,
  nicht unter vegetation/, nicht in STORE_NICHT_STREUEN → fester
  Körper." Der Katalog selbst führt dafür `kollision.art`; er steht dem
  Client aber nicht zur Verfügung (nicht im Spiel-Bündel, s.
  shared/src/index.ts). Hier ist er umsonst — also wird hier
  nachgesehen, ob der Ersatz deckungsgleich ist.
*/
const ausserhalbVegetation = STORE_KATALOG.filter(
  (e) => e.prefabName !== undefined && !e.pfad.startsWith('vegetation/')
);
const kollNone = ausserhalbVegetation
  .filter((e) => e.kollision?.art === 'none')
  .map((e) => e.prefabName!);
const nichtStreuen = ausserhalbVegetation
  .filter((e) => STORE_NICHT_STREUEN.has(e.prefabName!))
  .map((e) => e.prefabName!);
const nurNone = kollNone.filter((n) => !nichtStreuen.includes(n));
const nurNichtStreuen = nichtStreuen.filter((n) => !kollNone.includes(n));
check(
  `ausserhalb vegetation/: jedes "kollision: none" steht in STORE_NICHT_STREUEN (${kollNone.length} Stück)`,
  nurNone.length === 0,
  nurNone.join(', ')
);
/*
  Die Gegenrichtung darf ABWEICHEN, und das ist kein Mangel: Die
  Höhenfelder (`terrain-*`) tragen `kollision: mesh` und stehen trotzdem
  in STORE_NICHT_STREUEN — sie bringen ihr eigenes Gelände mit und
  gehören nie in die Welt gestreut. Der EntityManager gibt ihnen deshalb
  keinen Körper, und das ist richtig. Gemeldet wird die Liste trotzdem:
  Sie ist der Preis der Vereinfachung und soll sichtbar bleiben.
*/
console.log(
  `     in STORE_NICHT_STREUEN, aber mit Kollisionsform (bleiben ohne Körper): ` +
    `${nurNichtStreuen.length} — ${nurNichtStreuen.slice(0, 3).join(', ')}${nurNichtStreuen.length > 3 ? ' …' : ''}`
);

if (fehler > 0) {
  console.error(`\n${fehler} Fehlschläge`);
  process.exit(1);
}
console.log('\nalles grün');
