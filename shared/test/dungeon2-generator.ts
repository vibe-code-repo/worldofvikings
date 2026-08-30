/**
 * Messender Nachweis fuer den Auto-Generator des Dungeon-Generators 2.0 (AP4).
 * Measuring proof for the auto generator of dungeon generator 2.0 (AP4).
 *
 *   npx tsx test/dungeon2-generator.ts
 *
 * Geprueft werden die fuenf Abnahmekriterien aus `design/ARCHITECTURE.md`, AP4,
 * ueber 200 Seeds, plus der Determinismus aus dem Arbeitsauftrag ueber
 * 100 Seeds:
 * Checked are the five acceptance criteria from `design/ARCHITECTURE.md`, AP4,
 * over 200 seeds, plus the determinism from the work order over 100 seeds:
 *
 *   (a) `validateLayoutVoll` liefert NULL Befunde der Schwere `fehler` — und
 *       kein Seed faellt auf die einfache Form zurueck (ein Rueckfall wuerde
 *       (a) sonst still erfuellen, ohne dass der Generator etwas kann).
 *       `validateLayoutVoll` yields ZERO findings of severity `fehler` — and no
 *       seed falls back to the simple form (a fallback would otherwise satisfy
 *       (a) silently, without the generator having achieved anything).
 *   (b) Die Zellenzahl liegt in `zielZellen`.
 *       The cell count lies within `zielZellen`.
 *   (c) Schleifenanteil > 0 (mindestens ein Zyklus im RAUMGRAPHEN) bei >= 90 %
 *       der Seeds. Gezaehlt werden VERSCHIEDENE Stempelpaare, nicht Kanten —
 *       zwei Verbindungen zwischen denselben zwei Raeumen sind kein Zyklus.
 *       Loop share > 0 (at least one cycle in the ROOM GRAPH) for >= 90 % of
 *       seeds. Counted are DISTINCT stamp pairs, not edges — two connections
 *       between the same two rooms are not a cycle.
 *   (d) Kein Seed erzeugt einen unerreichbaren Raum.
 *       No seed produces an unreachable room.
 *   (e) Reihenfolge-Stabilitaet: das Einfuegen einer zusaetzlichen Ziehung in
 *       P9 (Deko) veraendert KEIN einziges Stempel-Feld. Gegenprobe: die Anker
 *       muessen sich sehr wohl aendern, sonst misst der Test nichts.
 *       Order stability: inserting an extra draw in P9 (decor) changes NOT ONE
 *       stamp field. Counter-check: the anchors must very much change,
 *       otherwise the test measures nothing.
 *   (f) Determinismus: gleicher Seed -> identische Pruefsumme, ueber 100 Seeds,
 *       plus eine eingefrorene Wertetabelle.
 *       Determinism: same seed -> identical checksum, over 100 seeds, plus a
 *       frozen value table.
 *   (g) Jede `Schacht`-Muendung eines Treppenhauses schliesst an einen ECHTEN
 *       Raum derselben Ebene an (kein Treppenstempel, kein 1x1-Verschlag).
 *       Gegenprobe gegen billiges Gruen: die Zahl der Seeds MIT Treppe darf
 *       dabei nicht einbrechen.
 *       Every `Schacht` mouth of a stairwell attaches to a REAL room on the same
 *       storey (no stair stamp, no 1x1 closet). Counter-check against cheap
 *       green: the number of seeds WITH a staircase must not collapse.
 *
 * Dazu die Stromtrennung aus `ARCHITECTURE.md` W7/W8 und ein paar
 * Profil-Invarianten, die sonst niemand prueft.
 * Plus the stream separation from `ARCHITECTURE.md` W7/W8 and a few profile
 * invariants that nobody else checks.
 */

import {
  KANTEN,
  MIN_LICHTE_STUFEN,
  MAX_MATERIAL_TAG,
  ZELLEN_ART,
  layoutPruefsumme,
  nachbarZelle,
  nurFehler,
  type DungeonLayout2,
  type LayoutSeeds,
} from '../src/dungeon2/layout.js';
import {
  erreichbareZellen,
  offen,
  schluesselZelle,
  wandZwischen,
  zelleImGitter,
  zellenAufbauen,
  zellenSortiert,
} from '../src/dungeon2/cells.js';
import { validateLayoutVoll } from '../src/dungeon2/validation.js';
import {
  einfacheForm,
  erzeugeLayout,
  erzeugeLayoutMitBericht,
} from '../src/dungeon2/generator.js';
import { STEINGRAB, materialTagFuerStempel, profilFuer, themaFinden } from '../src/dungeon2/themen.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pruefgeruest / test harness (Muster aus dungeon2-layout.ts)
// ─────────────────────────────────────────────────────────────────────────────

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

const thema = STEINGRAB;
const materialOptionen = {
  materialTagFuerStempel: (s: Parameters<typeof materialTagFuerStempel>[1]) =>
    materialTagFuerStempel(thema, s),
};

/**
 * Seeds aus einer Zaehlung, nicht aus einer Uhr — der Testlauf von morgen soll
 * denselben Befund liefern wie der von heute.
 * Seeds from a counter, not from a clock — tomorrow's run must produce the same
 * finding as today's.
 */
function seedsFuer(i: number): LayoutSeeds {
  return {
    architektur: (i * 2654435761) >>> 0,
    material: (i * 40503 + 7) >>> 0,
    deko: (i * 2246822519 + 13) >>> 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profil-Invarianten / profile invariants
// ─────────────────────────────────────────────────────────────────────────────

{
  pruefe('themaFinden findet steingrab', themaFinden('steingrab') === STEINGRAB);
  pruefe('themaFinden liefert undefined fuer Unbekanntes', themaFinden('gibtsnicht') === undefined);

  const gang = profilFuer(thema, 'gang');
  pruefe(
    'gangLaenge und das Gang-Profil sind derselbe Wert',
    gang !== undefined && gang.tiefe === thema.gangLaenge,
    'zwei getrennte Zahlen waeren zwei Zahlen, von denen eine vergessen wird'
  );

  let profileGut = true;
  for (const p of thema.raumTypen) {
    if (p.materialTag < 0 || p.materialTag > MAX_MATERIAL_TAG) profileGut = false;
    if (p.hoehe[0] < MIN_LICHTE_STUFEN) profileGut = false;
    // Obergrenze 15: `ebenen-abstand` verlangt Deckenoberkante < Bodenunterkante
    // der Ebene darueber, und eine Ebene ist 16 Hoehenstufen hoch.
    // Upper bound 15: `ebenen-abstand` requires the ceiling top below the floor
    // bottom of the storey above, and a storey is 16 height steps tall.
    if (p.hoehe[1] > 15) profileGut = false;
    if (p.breite[0] < 1 || p.tiefe[0] < 1) profileGut = false;
    if (p.breite[0] > p.breite[1] || p.tiefe[0] > p.tiefe[1] || p.hoehe[0] > p.hoehe[1]) profileGut = false;
    if (p.ausgaenge[0] > p.ausgaenge[1]) profileGut = false;
  }
  pruefe('alle Raumtyp-Profile sind in sich stimmig (Material 0..5, Hoehe 8..15, Bereiche aufsteigend)', profileGut);

  const einfach = einfacheForm(thema, seedsFuer(1), 'probe', 'Probe');
  pruefe(
    'die deterministische einfache Form (P10-Rueckfall) ist selbst gueltig',
    nurFehler(validateLayoutVoll(einfach, materialOptionen)).length === 0,
    JSON.stringify(nurFehler(validateLayoutVoll(einfach, materialOptionen))[0] ?? {})
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (a)-(d): der Sweep ueber 200 Seeds / the sweep over 200 seeds
// ─────────────────────────────────────────────────────────────────────────────

const SEEDS = 200;

let fehlerhafteSeeds = 0;
let rueckfallSeeds = 0;
let ausserhalbZiel = 0;
let mitZyklus = 0;
let unerreichbareRaeume = 0;
let mehrEbenenSeeds = 0;
let tuerenGesamt = 0;
let ankerGesamt = 0;
let auffuellungenGesamt = 0;
let ersterFehler = '';
let ersteZielAbweichung = '';
let muendungenGesamt = 0;
let muendungenAngebunden = 0;
let treppenSeeds = 0;
let ersteSackgasse = '';

for (let i = 0; i < SEEDS; i++) {
  const seeds = seedsFuer(i);
  const bericht = erzeugeLayoutMitBericht(thema, seeds);
  const layout = bericht.layout;

  // (a)
  const fehler = nurFehler(bericht.befunde);
  if (fehler.length > 0) {
    fehlerhafteSeeds++;
    if (ersterFehler === '') ersterFehler = `Seed ${i}: ${fehler[0]!.regel} @ ${fehler[0]!.wo} — ${fehler[0]!.text}`;
  }
  if (bericht.rueckfall) rueckfallSeeds++;
  auffuellungenGesamt += bericht.auffuellungen;

  // (b)
  if (bericht.zellenZahl < thema.zielZellen[0] || bericht.zellenZahl > thema.zielZellen[1]) {
    ausserhalbZiel++;
    if (ersteZielAbweichung === '') {
      ersteZielAbweichung = `Seed ${i}: ${bericht.zellenZahl} Zellen, erlaubt ${thema.zielZellen[0]}..${thema.zielZellen[1]}`;
    }
  }

  const gitter = zellenAufbauen(layout, materialOptionen);

  // (c) Zyklus im Raumgraphen: verschiedene Stempelpaare zaehlen, nicht Kanten.
  // (c) Cycle in the room graph: count distinct stamp pairs, not edges.
  const paare = new Set<string>();
  for (const zelle of zellenSortiert(gitter)) {
    for (const [dx, dz] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const n = gitter.zellen.get(schluesselZelle(zelle.x + dx, zelle.z + dz, zelle.ebene));
      if (n === undefined || n.stempelId === zelle.stempelId) continue;
      // Nur Kanten ohne Wand sind Verbindungen im Raumgraphen.
      // Only edges without a wall are connections in the room graph.
      const kante = dz === 1 ? 1 : 2;
      const wandA = (zelle.wandErzwungen & kante) !== 0;
      const kanteZurueck = dz === 1 ? 4 : 8;
      const wandB = (n.wandErzwungen & kanteZurueck) !== 0;
      if (wandA || wandB) continue;
      const a = Math.min(zelle.stempelId, n.stempelId);
      const b = Math.max(zelle.stempelId, n.stempelId);
      paare.add(`${a}-${b}`);
    }
  }
  // Senkrechte Schachtverbindungen zaehlen ebenfalls als Raumgraph-Kante.
  // Vertical shaft connections also count as a room graph edge.
  for (const zelle of zellenSortiert(gitter)) {
    if (zelle.art !== 3) continue;
    const oben = gitter.zellen.get(schluesselZelle(zelle.x, zelle.z, zelle.ebene + 1));
    if (oben === undefined || oben.stempelId === zelle.stempelId) continue;
    const a = Math.min(zelle.stempelId, oben.stempelId);
    const b = Math.max(zelle.stempelId, oben.stempelId);
    paare.add(`${a}-${b}`);
  }
  if (paare.size >= layout.stempel.length) mitZyklus++;

  // (d) jeder Stempel hat mindestens eine vom Eingang erreichbare Zelle
  // (d) every stamp has at least one cell reachable from the entrance
  const erreichbar = erreichbareZellen(gitter, layout.eingang);
  const erreichbareStempel = new Set<number>();
  for (const s of erreichbar) {
    const zelle = gitter.zellen.get(s);
    if (zelle !== undefined) erreichbareStempel.add(zelle.stempelId);
  }
  for (const s of layout.stempel) {
    if (!erreichbareStempel.has(s.id)) unerreichbareRaeume++;
  }

  // (g) Jede Schachtmuendung fuehrt in einen ECHTEN Raum derselben Ebene.
  // Regelkonform war eine Muendung schon vorher: `erreichbar` ist erfuellt,
  // sobald der Schacht vom Eingang aus erreicht wird. Begehbar war sie deshalb
  // nicht — bei Seed 2 endeten vier von sechs Muendungen in einer 1x1-Kammer
  // ohne Ausgang. Ein Treppenhaus, das nirgendwohin fuehrt, hat kein Symptom in
  // (a)-(d); es braucht diesen eigenen Zeugen.
  // (g) Every shaft mouth leads into a REAL room on the same storey. A mouth was
  // rule-conformant before: `reachable` holds as soon as the shaft is reached
  // from the entrance. Walkable it was not — at seed 2 four of six mouths ended
  // in a 1x1 chamber without an exit. A stairwell leading nowhere has no symptom
  // in (a)-(d); it needs this witness of its own.
  {
    const stempelNachId = new Map(layout.stempel.map((s) => [s.id, s]));
    let hatTreppe = false;
    for (const zelle of zellenSortiert(gitter)) {
      if (zelle.art !== ZELLEN_ART.Schacht) continue;
      hatTreppe = true;
      muendungenGesamt++;
      let angebunden = false;
      for (const kante of KANTEN) {
        const p = nachbarZelle(zelle.x, zelle.z, kante);
        const n = zelleImGitter(gitter, p.x, p.z, zelle.ebene);
        if (n === undefined || !offen(n.art)) continue;
        if (wandZwischen(zelle, n)) continue;
        const s = stempelNachId.get(n.stempelId);
        if (s === undefined || s.typ === 'treppe') continue;
        // Ein 1x1-Stempel ist eine Fuellkammer, kein Raum — er verschoebe die
        // Sackgasse nur um einen Schritt.
        // A 1x1 stamp is a filler chamber, not a room — it would move the dead
        // end by one step only.
        if (s.breite * s.tiefe < 2) continue;
        angebunden = true;
        break;
      }
      if (angebunden) muendungenAngebunden++;
      else if (ersteSackgasse === '') {
        ersteSackgasse = `Seed ${i}: Muendung (${zelle.x},${zelle.z}) auf Ebene ${zelle.ebene}`;
      }
    }
    if (hatTreppe) treppenSeeds++;
  }

  if (bericht.ebenenZahl > 1) mehrEbenenSeeds++;
  tuerenGesamt += layout.tueren.length;
  ankerGesamt += layout.anker.length;
}

pruefe(
  `(a) 200 Seeds ohne Befund der Schwere fehler`,
  fehlerhafteSeeds === 0,
  `${fehlerhafteSeeds} Seeds mit Fehler; erster: ${ersterFehler}`
);
pruefe(
  `(a) kein Seed faellt auf die einfache Form zurueck`,
  rueckfallSeeds === 0,
  `${rueckfallSeeds} Rueckfaelle`
);
pruefe(
  `(b) Zellenzahl aller 200 Seeds liegt in zielZellen ${thema.zielZellen[0]}..${thema.zielZellen[1]}`,
  ausserhalbZiel === 0,
  `${ausserhalbZiel} Abweichungen; erste: ${ersteZielAbweichung}`
);
pruefe(
  `(c) mindestens ein Zyklus im Raumgraphen bei >= 90 % der Seeds`,
  mitZyklus >= Math.ceil(SEEDS * 0.9),
  `nur ${mitZyklus}/${SEEDS}`
);
pruefe(`(d) kein unerreichbarer Raum`, unerreichbareRaeume === 0, `${unerreichbareRaeume} Raeume`);
pruefe(
  'ueber 200 Seeds entstehen ueberhaupt Tueren und Anker',
  tuerenGesamt > 0 && ankerGesamt > 0,
  `${tuerenGesamt} Tueren, ${ankerGesamt} Anker`
);
pruefe(
  'ueber 200 Seeds entsteht mindestens ein mehrstoeckiges Grab',
  mehrEbenenSeeds > 0,
  `${mehrEbenenSeeds} Seeds`
);
pruefe(
  `(g) jede Schachtmuendung schliesst an einen echten Raum derselben Ebene an`,
  muendungenGesamt > 0 && muendungenAngebunden === muendungenGesamt,
  `${muendungenAngebunden}/${muendungenGesamt} angebunden; erste Sackgasse: ${ersteSackgasse}`
);
// Gegenprobe zum Wegwerfen ganzer Treppenhaeuser: Wenn die Anbindungspflicht
// die Treppen aus dem Generator draengt, ist (g) trivial gruen. Vor dem Fix
// hatten 98 von 200 Seeds eine Treppe; die Schranke liegt bewusst knapp
// darunter, damit ein echter Einbruch auffaellt.
// Counter-check to discarding whole stairwells: if the attachment duty pushes
// stairs out of the generator, (g) is trivially green. Before the fix 98 of 200
// seeds had a staircase; the bound sits deliberately just below, so a real
// collapse shows up.
pruefe(
  `(g) die Anbindungspflicht kostet keine nennenswerte Zahl an Treppen-Seeds`,
  treppenSeeds >= 90,
  `nur ${treppenSeeds}/${SEEDS} Seeds mit Treppe (vor dem Fix: 98)`
);

// ─────────────────────────────────────────────────────────────────────────────
// (e) Reihenfolge-Stabilitaet des Deko-Stroms / order stability of the decor stream
// ─────────────────────────────────────────────────────────────────────────────

{
  let stempelVerschoben = 0;
  let ankerGleich = 0;
  let korrekturenVerschoben = 0;
  let tuerenVerschoben = 0;
  const PROBEN = 40;
  for (let i = 0; i < PROBEN; i++) {
    const seeds = seedsFuer(1000 + i);
    const ohne = erzeugeLayout(thema, seeds);
    const mit = erzeugeLayout(thema, seeds, { zusatzZiehungInP9: true });
    if (JSON.stringify(ohne.stempel) !== JSON.stringify(mit.stempel)) stempelVerschoben++;
    if (JSON.stringify(ohne.korrekturen) !== JSON.stringify(mit.korrekturen)) korrekturenVerschoben++;
    if (JSON.stringify(ohne.tueren) !== JSON.stringify(mit.tueren)) tuerenVerschoben++;
    if (JSON.stringify(ohne.anker) === JSON.stringify(mit.anker)) ankerGleich++;
  }
  pruefe(
    '(e) eine zusaetzliche Ziehung in P9 veraendert kein Stempel-Feld',
    stempelVerschoben === 0,
    `${stempelVerschoben}/${PROBEN} Seeds mit verschobenen Stempeln`
  );
  pruefe(
    '(e) sie veraendert auch Korrekturen und Tueren nicht',
    korrekturenVerschoben === 0 && tuerenVerschoben === 0,
    `${korrekturenVerschoben} Korrekturen, ${tuerenVerschoben} Tueren`
  );
  pruefe(
    '(e) Gegenprobe: die ANKER aendern sich sehr wohl (sonst misst der Test nichts)',
    ankerGleich === 0,
    `${ankerGleich}/${PROBEN} Seeds mit unveraenderten Ankern`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stromtrennung / stream separation (ARCHITECTURE W7/W8)
// ─────────────────────────────────────────────────────────────────────────────

{
  const grund = seedsFuer(4242);
  const basis = erzeugeLayout(thema, grund);

  const andereDeko = erzeugeLayout(thema, { ...grund, deko: (grund.deko + 1) >>> 0 });
  pruefe(
    'ein anderer Deko-Seed laesst die Fussabdruecke unberuehrt',
    JSON.stringify(basis.stempel.map((s) => [s.id, s.typ, s.x, s.z, s.ebene, s.breite, s.tiefe, s.hoehe])) ===
      JSON.stringify(andereDeko.stempel.map((s) => [s.id, s.typ, s.x, s.z, s.ebene, s.breite, s.tiefe, s.hoehe]))
  );
  pruefe(
    'ein anderer Deko-Seed aendert die Anker',
    JSON.stringify(basis.anker) !== JSON.stringify(andereDeko.anker)
  );

  const anderesMaterial = erzeugeLayout(thema, { ...grund, material: (grund.material + 1) >>> 0 });
  pruefe(
    'ein anderer Material-Seed laesst die Fussabdruecke unberuehrt (W2: jederzeit neu wuerfelbar)',
    JSON.stringify(basis.stempel.map((s) => [s.id, s.typ, s.x, s.z, s.breite, s.tiefe])) ===
      JSON.stringify(anderesMaterial.stempel.map((s) => [s.id, s.typ, s.x, s.z, s.breite, s.tiefe]))
  );
  pruefe(
    'ein anderer Material-Seed aendert die Varianten',
    JSON.stringify(basis.stempel.map((s) => s.variante)) !==
      JSON.stringify(anderesMaterial.stempel.map((s) => s.variante))
  );

  const andereArchitektur = erzeugeLayout(thema, { ...grund, architektur: (grund.architektur + 1) >>> 0 });
  pruefe(
    'ein anderer Architektur-Seed aendert den Grundriss',
    JSON.stringify(basis.stempel) !== JSON.stringify(andereArchitektur.stempel)
  );

  // Materialtag haengt am Raumtyp, nicht am Zufall — die Zelle traegt genau
  // den Tag ihres Stempel-Profils.
  // The material tag depends on the room type, not on chance — the cell carries
  // exactly the tag of its stamp's profile.
  const gitter = zellenAufbauen(basis, materialOptionen);
  let tagsGut = true;
  const nachId = new Map(basis.stempel.map((s) => [s.id, s]));
  for (const zelle of zellenSortiert(gitter)) {
    const s = nachId.get(zelle.stempelId);
    if (s === undefined) continue;
    if (zelle.materialTag !== materialTagFuerStempel(thema, s)) tagsGut = false;
    if (zelle.materialTag < 0 || zelle.materialTag > MAX_MATERIAL_TAG) tagsGut = false;
  }
  pruefe('jede Zelle traegt den Materialtag ihres Raumtyps (0..5)', tagsGut);
}

// ─────────────────────────────────────────────────────────────────────────────
// (f) Determinismus / determinism
// ─────────────────────────────────────────────────────────────────────────────

{
  const DET = 100;
  let ungleich = 0;
  let ersteAbweichung = '';
  const gesehen = new Set<string>();
  let kollisionen = 0;
  for (let i = 0; i < DET; i++) {
    const seeds = seedsFuer(i);
    const a = erzeugeLayout(thema, seeds);
    const b = erzeugeLayout(thema, seeds);
    if (a.pruefsumme !== b.pruefsumme || JSON.stringify(a) !== JSON.stringify(b)) {
      ungleich++;
      if (ersteAbweichung === '') ersteAbweichung = `Seed ${i}: ${a.pruefsumme} vs ${b.pruefsumme}`;
    }
    if (a.pruefsumme !== layoutPruefsumme(a)) {
      ungleich++;
      if (ersteAbweichung === '') ersteAbweichung = `Seed ${i}: pruefsumme passt nicht zu kanonisch()`;
    }
    if (gesehen.has(a.pruefsumme)) kollisionen++;
    gesehen.add(a.pruefsumme);
  }
  pruefe(
    '(f) 100 Seeds: gleicher Seed liefert zweimal dasselbe Layout und dieselbe Pruefsumme',
    ungleich === 0,
    ersteAbweichung
  );
  pruefe(
    '(f) 100 verschiedene Seeds liefern 100 verschiedene Pruefsummen',
    kollisionen === 0,
    `${kollisionen} Kollisionen`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Eingefrorene Wertetabelle / frozen value table
// ─────────────────────────────────────────────────────────────────────────────
//
// Zeugen gegen stilles Auseinanderlaufen: Wer den Generator anfasst und diese
// Zeilen nicht bewusst neu einfriert, sieht es sofort. AP5 friert die volle
// 100er-Reihe ein und vergleicht sie zusaetzlich im Browser-Buendel.
// Witnesses against silent divergence: whoever touches the generator without
// deliberately re-freezing these lines sees it immediately. AP5 freezes the full
// run of 100 and additionally compares it inside the browser bundle.

const EINGEFROREN: readonly (readonly [number, string, number, number, number, number])[] = [
  // [Seed-Index, pruefsumme, Stempel, Zellen, Tueren, Anker]
  // Neu eingefroren am 2026-08-30 (siehe `design/decisions-log.md`): P8b
  // beschneidet die Decke unter einem belegten Stockwerk, und die Zelle ueber
  // dem unteren Treppenlauf ist gesperrt.
  // Re-frozen on 2026-08-30 — deliberate layout change, see the decisions log.
  [0, '77f521e6', 35, 303, 16, 91],
  [1, 'c214a245', 45, 336, 14, 90],
  [7, '75f8553f', 49, 317, 16, 84],
  [42, 'c3c5d958', 32, 309, 10, 95],
  [199, '375464b0', 32, 286, 6, 75],
];

{
  let abweichungen = 0;
  const zeilen: string[] = [];
  for (const [i, summe, stempelZahl, zellenZahl, tuerZahl, ankerZahl] of EINGEFROREN) {
    const bericht = erzeugeLayoutMitBericht(thema, seedsFuer(i));
    const l: DungeonLayout2 = bericht.layout;
    const ist: [number, string, number, number, number, number] = [
      i,
      l.pruefsumme,
      l.stempel.length,
      bericht.zellenZahl,
      l.tueren.length,
      l.anker.length,
    ];
    zeilen.push(`  [${i}, '${l.pruefsumme}', ${l.stempel.length}, ${bericht.zellenZahl}, ${l.tueren.length}, ${l.anker.length}],`);
    if (
      ist[1] !== summe ||
      ist[2] !== stempelZahl ||
      ist[3] !== zellenZahl ||
      ist[4] !== tuerZahl ||
      ist[5] !== ankerZahl
    ) {
      abweichungen++;
    }
  }
  if (process.env['DUNGEON2_EINFRIEREN'] === '1') {
    console.log('Eingefrorene Tabelle (zum Einsetzen):');
    for (const z of zeilen) console.log(z);
  }
  pruefe(
    'eingefrorene Wertetabelle stimmt',
    abweichungen === 0,
    `${abweichungen} Zeilen abweichend — mit DUNGEON2_EINFRIEREN=1 neu ausgeben`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(
  `dungeon2-generator: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot ` +
    `(Sweep: ${SEEDS} Seeds, ${mitZyklus} mit Zyklus, ${mehrEbenenSeeds} mehrstoeckig, ` +
    `${treppenSeeds} mit Treppe, ${muendungenAngebunden}/${muendungenGesamt} Muendungen angebunden, ` +
    `${tuerenGesamt} Tueren, ${ankerGesamt} Anker, ${auffuellungenGesamt} Auffuellungen)`
);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
