/**
 * Prüft: dass die 569 Prefabs des Asset-Speichers wirklich in der
 * Registry stehen — und zwar so, dass Server und Client auf jede Frage
 * dieselbe Antwort geben.
 *
 * ── Wogegen dieser Test steht ────────────────────────────────────────
 * Die Anbindung des Speichers besteht aus vier Zeilen an vier Stellen
 * (`buildRegistry`, `EIGENE_MODELLE`, der Import, `shared/src/index.ts`).
 * Fällt EINE davon weg, ist nichts kaputt und alles halb da:
 *
 *   • Ohne die Schleife in `buildRegistry` kennt `PREFABS_BY_NAME` die
 *     Namen nicht — der Server spawnt sie, der Client zeigt nichts und
 *     meldet auch nichts, weil er den Hash gar nicht erst auflöst.
 *   • Ohne `...STORE_MODELL_NAMEN` in `EIGENE_MODELLE` sagt
 *     `istEigenesModell` nein — und `pruefeLayout` weist jede Welt
 *     zurück, die ein Store-Modell platziert. Der Fehler erscheint dann
 *     bei der WELT und nicht bei der Liste.
 *
 * Der Test braucht KEINE Dateien: `storePrefabs.ts` ist erzeugt, aber
 * eingecheckt. Er läuft deshalb auch im CI-Checkout ohne `assets/` und
 * steht ohne Weiche in der Kernliste. Ob die Datei zum Plattenbestand
 * passt, ist eine andere Frage — die stellt `tools/test/store-erzeugung.ts`.
 *
 *   npx tsx shared/test/store-registry.ts
 */
import {
  EIGENE_MODELLE,
  PREFABS_BY_HASH,
  PREFABS_BY_NAME,
  PREFAB_DEFS,
  STORE_BASIS,
  STORE_LAB_BASIS,
  STORE_MODELL_NAMEN,
  STORE_NICHT_STREUEN,
  STORE_PREFAB_DEFS,
  STORE_BOUNDS_RAUM,
  STORE_SPIEGELN_VORGABE,
  boundsNachWeltraum,
  getStableHash,
  istEigenesModell,
  istStoreModell,
  storeSpiegelung,
} from '@wov/shared';
/*
  Der Katalog kommt über seinen PFAD und nicht über das Barrel.

  `shared/src/index.ts` exportiert `storeKatalogDaten.ts` mit Absicht
  nicht: Die 670 Einträge lägen sonst in jedem Spiel-Bundle, für eine
  Tabelle, die nur der Editor aufschlägt (Begründung im Barrel, Wächter
  in `tools/test/store-erzeugung.ts`). Ein Test darf sie holen — er wird
  nicht ausgeliefert.
*/
import {
  STORE_KATALOG,
  STORE_KATALOG_NACH_ID,
  STORE_KATALOG_NACH_PREFAB,
} from '@wov/shared/src/storeKatalogDaten.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── 1. Der Bestand ist überhaupt da ───────────────────────────────────
/*
  Die Untergrenze ist kein Selbstzweck: Ein Generator, der aus einem
  leeren Ordner eine leere Liste schreibt, macht JEDE folgende Prüfung
  grün — "jeder von null Namen steht in EIGENE_MODELLE" stimmt. Ein
  Test ohne Prüflinge ist die teuerste Art, nichts zu wissen.
*/
check('STORE_PREFAB_DEFS ist nicht leer', STORE_PREFAB_DEFS.length > 500, `${STORE_PREFAB_DEFS.length}`);
check('STORE_KATALOG ist nicht leer', STORE_KATALOG.length > 600, `${STORE_KATALOG.length}`);
check(
  'STORE_MODELL_NAMEN deckt sich mit STORE_PREFAB_DEFS',
  STORE_MODELL_NAMEN.length === STORE_PREFAB_DEFS.length
);

// ── 2. Jeder Store-Name ist ein vollwertiges Prefab ───────────────────
const ohneRegistry = STORE_MODELL_NAMEN.filter((n) => !PREFABS_BY_NAME.has(n));
check('jeder Store-Name steht in PREFABS_BY_NAME', ohneRegistry.length === 0, ohneRegistry.slice(0, 5).join(', '));

const ohneWhitelist = STORE_MODELL_NAMEN.filter((n) => !istEigenesModell(n));
check('istEigenesModell() sagt für jeden Store-Namen ja', ohneWhitelist.length === 0, ohneWhitelist.slice(0, 5).join(', '));

const eigeneMenge = new Set(EIGENE_MODELLE);
check(
  'EIGENE_MODELLE enthält keinen Namen doppelt',
  eigeneMenge.size === EIGENE_MODELLE.length,
  `${EIGENE_MODELLE.length} Einträge, ${eigeneMenge.size} verschieden`
);

/*
  Der Hash ist die Kennung, mit der ein ZDO über die Leitung geht. Zwei
  VERSCHIEDENE Namen mit demselben `getStableHash` sind auf dem Server
  zwei Dinge und beim Client eines — die zweite Kiste erschiene als Fass,
  und niemand könnte sagen, warum. `PREFABS_BY_HASH` ist eine Map: Ein
  Zusammenstoss fällt dort lautlos unter den Tisch.
*/
const namenJeHash = new Map<string, Set<string>>();
for (const d of PREFAB_DEFS) {
  const h = String(getStableHash(d.name));
  const s = namenJeHash.get(h) ?? new Set<string>();
  s.add(d.name);
  namenJeHash.set(h, s);
}
const zusammenstoesse = [...namenJeHash.values()].filter((s) => s.size > 1);
check(
  'kein Hash-Zusammenstoss zwischen verschiedenen Prefabnamen',
  zusammenstoesse.length === 0,
  zusammenstoesse.map((s) => [...s].join('/')).join(', ')
);

/*
  Dass `PREFABS_BY_HASH` KLEINER ist als `PREFAB_DEFS`, ist dagegen ein
  Altbefund und hier nur festgehalten, damit er nicht wächst: In
  `prefabData.json` stehen drei Namen doppelt (`sfx_bear_claw_attack`,
  `sfx_trainingdummy_heavy_attack`, `sfx_trainingdummy_light_attack`) —
  jeweils zwei Einträge mit demselben Namen, also auch demselben Hash.
  Das ist harmlos (die zweite Zeile überschreibt die erste mit
  identischem Inhalt) und liegt vor diesem Umbau; der Asset-Speicher
  bringt keinen einzigen weiteren dazu. Wächst die Zahl, hat jemand
  Namen doppelt eingetragen, und DAS ist dann ein Befund.
*/
const DOPPELTE_ALTNAMEN = 3;
check(
  `nicht mehr als ${DOPPELTE_ALTNAMEN} doppelte Prefabnamen (Altbestand)`,
  PREFAB_DEFS.length - PREFABS_BY_HASH.size <= DOPPELTE_ALTNAMEN,
  `${PREFAB_DEFS.length} Prefabs, ${PREFABS_BY_HASH.size} Hashes`
);

const altNamen = new Set(PREFAB_DEFS.map((d) => d.name).filter((n) => !STORE_MODELL_NAMEN.includes(n)));
const kollidiert = STORE_MODELL_NAMEN.filter((n) => altNamen.has(n));
check('kein Store-Name überschreibt einen Namen des Altbestands', kollidiert.length === 0, kollidiert.join(', '));

// ── 3. Die Modellpfade folgen der Konvention ──────────────────────────
const falscherPfad = STORE_PREFAB_DEFS.filter((d) => !d.model || !istStoreModell(d.model));
check(
  `jedes model zeigt nach ${STORE_BASIS}/ oder ${STORE_LAB_BASIS}/`,
  falscherPfad.length === 0,
  falscherPfad.slice(0, 5).map((d) => `${d.name} → ${d.model}`).join(', ')
);

const mitEndung = STORE_PREFAB_DEFS.filter((d) => d.model?.endsWith('.glb'));
check(
  'kein model trägt die Endung .glb (die hängt der AssetManager an)',
  mitEndung.length === 0,
  mitEndung.slice(0, 3).map((d) => d.model).join(', ')
);

/*
  `store-lab/` darf NUR für Vegetation stehen. Bauer B legt dort seine
  abgeleiteten Fassungen ab; ein Requisitenmodell, das plötzlich von
  dort käme, hiesse, dass der Generator den Ordner falsch abfragt — und
  das sähe man erst an einem Fass, das anders aussieht als vorher.
*/
const labAusserhalb = STORE_PREFAB_DEFS.filter(
  (d) => d.model?.startsWith(`${STORE_LAB_BASIS}/`) && !d.model.startsWith(`${STORE_LAB_BASIS}/vegetation/`)
);
check(
  `${STORE_LAB_BASIS}/ steht nur bei Vegetation`,
  labAusserhalb.length === 0,
  labAusserhalb.slice(0, 5).map((d) => d.model).join(', ')
);

// ── 4. Der Katalog ist vollständig und widerspruchsfrei ───────────────
check('STORE_KATALOG_NACH_ID kennt jeden Eintrag', STORE_KATALOG_NACH_ID.size === STORE_KATALOG.length);

const katalogOhneGruppe = STORE_KATALOG.filter((e) => e.gruppe.length === 0 || e.untergruppe.length === 0);
check(
  'jeder Katalogeintrag ist einsortiert (Gruppe UND Untergruppe gesetzt)',
  katalogOhneGruppe.length === 0,
  katalogOhneGruppe.slice(0, 5).map((e) => e.id).join(', ')
);

const totePrefabNamen = STORE_KATALOG.filter((e) => e.prefabName && !PREFABS_BY_NAME.has(e.prefabName));
check(
  'jeder prefabName im Katalog löst in der Registry auf',
  totePrefabNamen.length === 0,
  totePrefabNamen.slice(0, 5).map((e) => e.id).join(', ')
);

check(
  'jedes Store-Prefab hat eine Katalogzeile',
  STORE_KATALOG_NACH_PREFAB.size === STORE_PREFAB_DEFS.length,
  `${STORE_KATALOG_NACH_PREFAB.size} von ${STORE_PREFAB_DEFS.length}`
);

/*
  Die Kulissen sind der Grund, warum es `STORE_NICHT_STREUEN` gibt:
  `backdrop-mountains-clear` ist 594 m breit. Streute eine Flora-Funktion
  sie zwischen die Büsche, stünde ein halber Kilometer Berg im Dorf —
  und zwar EINMAL, an einer Stelle, die man beim Testen nicht ansieht.
*/
const grosseAusserhalb = STORE_KATALOG.filter((e) => {
  if (!e.prefabName || !e.bounds) return false;
  const breite = Math.max(e.bounds.max[0] - e.bounds.min[0], e.bounds.max[2] - e.bounds.min[2]);
  return breite > 80 && !STORE_NICHT_STREUEN.has(e.prefabName);
});
check(
  'kein Prefab über 80 m Grundfläche fehlt in STORE_NICHT_STREUEN',
  grosseAusserhalb.length === 0,
  grosseAusserhalb.map((e) => e.id).join(', ')
);

const streuFehler = [...STORE_NICHT_STREUEN].filter((n) => !PREFABS_BY_NAME.has(n));
check('STORE_NICHT_STREUEN nennt nur bekannte Prefabs', streuFehler.length === 0, streuFehler.join(', '));

/*
  `platzierbar: false` und `STORE_NICHT_STREUEN` sagen dasselbe an zwei
  Orten — die Zeile für den, der einen Katalogeintrag in der Hand hat,
  die Menge für den, der nur einen Namen hat. Zwei Quellen für eine
  Aussage laufen auseinander, sobald es niemand nachhält. Hier wird es
  nachgehalten.
*/
const gesperrteZeilen = STORE_KATALOG.filter((e) => e.platzierbar === false && e.prefabName);
check(
  'platzierbar:false und STORE_NICHT_STREUEN decken sich',
  gesperrteZeilen.length === STORE_NICHT_STREUEN.size &&
    gesperrteZeilen.every((e) => STORE_NICHT_STREUEN.has(e.prefabName!)),
  `${gesperrteZeilen.length} Zeilen gegen ${STORE_NICHT_STREUEN.size} Namen`
);

// ── 4b. Bauer Ds Messbefunde, im Katalog festgehalten ─────────────────
/*
  Der Dateiraum. Babylon klappt beim Import die x-Achse um; eine Hüllbox
  aus der Quelle beschreibt das Modell VORHER. Wer sie ungeprüft als
  Weltkiste benutzt, spiegelt jede Treppe. Das Feld sagt es an jeder
  Zeile, die eine Kiste trägt — und diese Prüfung sorgt dafür, dass es
  wirklich an jeder steht.
*/
const ohneRaum = STORE_KATALOG.filter((e) => e.bounds && e.boundsRaum !== STORE_BOUNDS_RAUM);
check(
  `jede Zeile mit bounds nennt ihr Bezugssystem ('${STORE_BOUNDS_RAUM}')`,
  ohneRaum.length === 0,
  ohneRaum.slice(0, 5).map((e) => e.id).join(', ')
);

const probe = STORE_KATALOG.find((e) => e.bounds && e.bounds.min[0] !== -e.bounds.max[0]);
check(
  'boundsNachWeltraum() klappt x um und lässt y/z in Ruhe',
  probe !== undefined &&
    boundsNachWeltraum(probe.bounds!).min[0] === -probe.bounds!.max[0] &&
    boundsNachWeltraum(probe.bounds!).max[0] === -probe.bounds!.min[0] &&
    boundsNachWeltraum(probe.bounds!).min[1] === probe.bounds!.min[1] &&
    boundsNachWeltraum(probe.bounds!).max[2] === probe.bounds!.max[2],
  probe?.id ?? 'kein unsymmetrisches Modell gefunden'
);

/*
  Die zwölf `…-collision.glb`: unsichtbare Hüllgeometrie. Sie dürfen
  NIE ein Prefab sein — ein gesetztes Kollisionsnetz wäre ein Objekt,
  das man nicht sieht und trotzdem nicht durchqueren kann.
*/
const kollisionsZeilen = STORE_KATALOG.filter((e) => e.art === 'kollision');
check('die Kollisionsdateien sind erfasst', kollisionsZeilen.length === 12, `${kollisionsZeilen.length}`);
check(
  'keine Kollisionsdatei hat ein Prefab',
  kollisionsZeilen.every((e) => e.prefabName === undefined),
  kollisionsZeilen.filter((e) => e.prefabName).map((e) => e.id).join(', ')
);

/*
  Und die Verknüpfung in der Gegenrichtung. Nur DREI der zwölf gehören
  zu einem Modell, das im Speicher liegt — die anderen neun beschreiben
  Modelle, die es hier gar nicht gibt. Diese Zahl steht als Erwartung
  da, damit ein vierter Fund auffällt statt unterzugehen.
*/
const mitKollisionsdatei = STORE_KATALOG.filter((e) => e.kollisionsDatei);
check(
  'drei Modelle sind mit ihrer Kollisions-GLB verknüpft',
  mitKollisionsdatei.length === 3,
  mitKollisionsdatei.map((e) => e.id).join(', ')
);
check(
  'jede verknüpfte Kollisions-GLB steht selbst im Katalog',
  mitKollisionsdatei.every((e) => {
    const ziel = STORE_KATALOG.find((k) => k.pfad === e.kollisionsDatei);
    return ziel?.art === 'kollision';
  })
);

/*
  Ursprung: NICHT auf min y = 0 geschoben (Bauer Ds Punkt 6) — 335 der
  569 Prefabs reichen unter null, das sind Pfosten und Wurzeln, und ein
  Verschieben stellte sie auf den Rasen statt hinein. Gekennzeichnet
  werden nur die Ausreisser, bei denen der Setzpunkt nichts mit dem
  Modell zu tun hat.
*/
const ausreisser = STORE_KATALOG.filter((e) => e.kennzeichen?.includes('ursprung-versetzt'));
check(
  'Ursprungs-Ausreisser sind gekennzeichnet (kein Modell wurde verschoben)',
  ausreisser.length > 0 && ausreisser.every((e) => (e.bounds?.min[1] ?? 0) < -1),
  `${ausreisser.length} Zeilen`
);
for (const name of ['environment/sm-item-horn', 'environment/sm-item-bag-large', 'environment/sm-item-shrooms']) {
  const e = STORE_KATALOG_NACH_ID.get(name);
  check(`${name} trägt das Ursprungs-Kennzeichen`, e?.kennzeichen?.includes('ursprung-versetzt') === true);
}

// ── 5. Der Spiegelungs-Schalter ───────────────────────────────────────
/*
  Ein Schalter, den niemand abfragt, ist kein Schalter. Geprüft wird
  deshalb nicht sein WERT (den setzt der Integrator nach Bauer Ds
  Messung), sondern dass er überhaupt durchschlägt — und dass er den
  Altbestand in Ruhe lässt: `assets/models/` regelt seine Händigkeit
  beim Export, eine zweite Spiegelung dort wäre ein Rückschritt.
*/
const beispiel = STORE_PREFAB_DEFS[0]?.model ?? '';
check(
  'storeSpiegelung() folgt STORE_SPIEGELN_VORGABE',
  storeSpiegelung(beispiel) === STORE_SPIEGELN_VORGABE,
  `${beispiel} → ${storeSpiegelung(beispiel)}, Vorgabe ${STORE_SPIEGELN_VORGABE}`
);
check('storeSpiegelung() lässt den Altbestand unberührt', storeSpiegelung('Grabhuegel') === false);
check('istStoreModell() unterscheidet beide Bestände', istStoreModell('store/environment/x') && !istStoreModell('Grabhuegel'));

// ── 6. Der Altbestand ist unversehrt ──────────────────────────────────
/*
  Die Gegenprobe zu allem oben: Der Speicher wurde ANGEHÄNGT, nicht
  eingemischt. Ginge dabei ein Name des Altbestands verloren, wäre die
  Registry grösser als vorher und trotzdem ärmer — und `PREFAB_DEFS
  .length` allein verriete das nie.
*/
for (const name of ['Player', 'Steinkreis', 'BirkeHoch1', 'CryptWallTorch']) {
  check(`Altbestand unverändert: ${name}`, PREFABS_BY_NAME.has(name) && getStableHash(name) !== 0);
}

console.log(fehler === 0 ? '\nalle Prüfungen grün' : `\n${fehler} Prüfung(en) fehlgeschlagen`);
process.exit(fehler > 0 ? 1 : 0);
