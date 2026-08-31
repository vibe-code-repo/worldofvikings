/**
 * Waechter des 2.0-Instanz-Dokuments und seiner Weiche (AP13).
 * Guard for the 2.0 instance document and its switch (AP13).
 *
 *   npx tsx test/dungeon2-dokument.ts
 *
 * Geprueft wird das Abnahmekriterium (a) aus `design/ARCHITECTURE.md` AP13 —
 * „ein 2.0-Dokument laeuft nachweislich NIE durch den Alt-Sanitizer und
 * umgekehrt (beide Richtungen getestet)" — und was daran haengt:
 * Checked is acceptance criterion (a) from AP13 — "a 2.0 document provably
 * NEVER runs through the legacy sanitizer and vice versa (both directions
 * tested)" — and what depends on it:
 *
 *   (a) Beide Richtungen der Weiche, mit ECHTEN Dokumenten beider Formate.
 *       Both directions of the switch, with REAL documents of both formats.
 *   (b) Das Kennungsmuster von `document.ts` und `isValidDungeonId()` aus dem
 *       Altbestand stimmen ueberein. `document.ts` darf `dungeons.ts` nicht
 *       importieren (es zoege `dungeonsData.json` in jedes Bundle), also
 *       steht die Zeile zweimal — und dieser Test ist der Grund, warum das
 *       nicht schlimm ist.
 *       The id pattern of `document.ts` and legacy `isValidDungeonId()` agree.
 *   (c) Die Pruefsumme ist ein ZEUGE, kein Inhalt: Ein Dokument mit
 *       hineingeschriebener falscher Pruefsumme bekommt beim Sanitisieren die
 *       richtige, statt seine eigene Abweichung zu beglaubigen.
 *       The checksum is a WITNESS, not content.
 *   (d) Deskriptor hin, Layout zurueck: `layoutAusDeskriptor()` erzeugt
 *       dasselbe Layout wie der Server und meldet Abweichung, wenn die
 *       Pruefsumme nicht passt.
 *       Descriptor out, layout back.
 *   (e) `pruefsummeOhneAnker()` unterscheidet eine Anker-Aenderung von einer
 *       Architektur-Aenderung — die Grundlage dafuer, dass eine gesetzte
 *       Fackel die Instanz NICHT abreisst.
 *       `pruefsummeOhneAnker()` tells an anchor change from an architecture
 *       change — the basis for a torch not tearing the instance down.
 *   (f) Ein 2.0-Dokument ueberlebt JSON hin und zurueck unveraendert (es geht
 *       genau so auf die Platte und ueber die Leitung).
 *       A 2.0 document survives a JSON round trip unchanged.
 */

import {
  DUNGEON_DOCUMENT_VERSION,
  isValidDungeonId,
  sanitizeDungeonDocument,
} from '../src/dungeons.js';
import {
  DUNGEON_DOKUMENT_VERSION_2,
  deskriptorVon,
  erzeugeDokument2,
  istDokument2,
  layoutAusDeskriptor,
  layoutPruefsumme,
  layoutVonDokument2,
  pruefsummeOhneAnker,
  sanitizeDungeonDokument2,
  type DekoAnker,
  type DungeonDokument2,
  type LayoutSeeds,
} from '../src/dungeon2/index.js';

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

function pruefeGleich(name: string, ist: unknown, soll: unknown): void {
  pruefe(name, Object.is(ist, soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

const SEEDS: LayoutSeeds = { architektur: 1234, material: 77, deko: 4242 };

// ─────────────────────────────────────────────────────────────────────────────
// (a) Die Weiche, BEIDE Richtungen / the switch, BOTH directions
// ─────────────────────────────────────────────────────────────────────────────

const doc2 = erzeugeDokument2('steingrab-e2e', 'Steingrab (Test)', 'steingrab', SEEDS);
pruefe('erzeugeDokument2 liefert ein Dokument', doc2 !== null);
if (doc2 === null) {
  console.log('dungeon2-dokument: ABBRUCH — kein Dokument erzeugbar');
  process.exit(1);
}

/**
 * Ein ECHTES Altdokument. Bewusst nicht von Hand zusammengesteckt: Was der
 * Alt-Sanitizer annimmt, entscheidet er selbst, und ein handgeschriebenes
 * Beispiel wuerde nur beweisen, dass ich sein Format richtig geraten habe.
 * A REAL legacy document, deliberately produced by the legacy sanitizer itself.
 */
const altRoh = {
  version: DUNGEON_DOCUMENT_VERSION,
  id: 'steingrab-alt',
  name: 'Steingrab (alt)',
  base: 'DG_Steingrab',
  mode: 'custom',
  seed: 10,
  zoneSize: 64,
  layout: {
    // Ein echter Raum aus dem Kit — ohne ihn liefert der Alt-Sanitizer
    // `null` („0 Raeume ueberlebt"), und der Positivfall unten pruefte dann
    // nur, dass beide Sanitizer immer `null` sagen.
    // A real room from the kit — without it the legacy sanitizer returns
    // `null` and the positive case below would prove nothing.
    rooms: [
      {
        room: 'SteingrabGang',
        pos: { x: 0, y: 0, z: 0 },
        rot: { x: 0, y: 0, z: 0, w: 1 },
        placeOrder: 0,
        seed: 1,
      },
    ],
    doors: [],
    props: [],
  },
};

pruefe('istDokument2 erkennt das 2.0-Dokument', istDokument2(doc2));
pruefe('istDokument2 verneint das Altdokument', !istDokument2(altRoh));
pruefe(
  'istDokument2 verneint Dinge ohne Version',
  !istDokument2({ id: 'x' }) && !istDokument2(null) && !istDokument2([1, 2, 3])
);
pruefe(
  'istDokument2 verneint eine Bruchzahl als Version',
  !istDokument2({ version: 10.5, id: 'x' })
);

// Richtung 1: Das 2.0-Dokument darf im Alt-Sanitizer NICHTS werden.
// Direction 1: the 2.0 document must become NOTHING in the legacy sanitizer.
pruefeGleich(
  '2.0-Dokument durch den Alt-Sanitizer -> null',
  sanitizeDungeonDocument(doc2),
  null
);

// Richtung 2: Das Altdokument darf im 2.0-Sanitizer NICHTS werden.
// Direction 2: the legacy document must become NOTHING in the 2.0 sanitizer.
pruefeGleich(
  'Altdokument durch den 2.0-Sanitizer -> null',
  sanitizeDungeonDokument2(altRoh),
  null
);

// Und der Positivfall zu beidem — sonst prueft man nur, dass beide immer
// `null` sagen. / And the positive case for both.
pruefe(
  'Altdokument durch den Alt-Sanitizer -> Dokument',
  sanitizeDungeonDocument(altRoh) !== null
);
pruefe('2.0-Dokument durch den 2.0-Sanitizer -> Dokument', sanitizeDungeonDokument2(doc2) !== null);

pruefe(
  'Ein Dokument mit version 9 gilt NICHT als 2.0',
  !istDokument2({ ...doc2, version: 9 }) && sanitizeDungeonDokument2({ ...doc2, version: 9 }) === null
);
pruefeGleich('Versionsnummer der Weiche', DUNGEON_DOKUMENT_VERSION_2, 10);

// ─────────────────────────────────────────────────────────────────────────────
// (b) Das doppelt stehende Kennungsmuster / the duplicated id pattern
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nur KLEINGESCHRIEBENE Kennungen — beide Seiten schreiben vorher klein
 * (`sanitizeDungeonDocument` und `sanitizeDungeonDokument2` beide via
 * `toLowerCase()`), die Grossschreibung ist also keine Eigenschaft des
 * Musters. Genau diese Vorbehandlung wird unten eigens geprueft.
 * Lowercase ids only — both sides lowercase first, so capitalisation is not a
 * property of the pattern. The lowercasing itself is checked separately below.
 */
const KENNUNGEN: readonly [string, boolean][] = [
  ['steingrab-7', true],
  ['a', true],
  ['a_b-c9', true],
  ['', false],
  ['-vorn', false],
  ['mit punkt.json', false],
  ['../flucht', false],
  ['/absolut', false],
  ['x'.repeat(64), true],
  ['x'.repeat(65), false],
];
for (const [kennung, gueltig] of KENNUNGEN) {
  const zweiNull = erzeugeDokument2(kennung, 'n', 'steingrab', SEEDS) !== null;
  pruefeGleich(`Kennung '${kennung}' — 2.0`, zweiNull, gueltig);
  pruefeGleich(`Kennung '${kennung}' — Altbestand`, isValidDungeonId(kennung), gueltig);
}
// Beide schreiben klein, statt gross abzulehnen — sonst waere eine im Editor
// getippte Kennung mal ein Dungeon und mal ein Fehler.
// Both lowercase rather than reject uppercase.
pruefeGleich(
  'GROSS wird kleingeschrieben, nicht abgelehnt (2.0)',
  erzeugeDokument2('GROSS', 'n', 'steingrab', SEEDS)?.id,
  'gross'
);
pruefeGleich(
  'GROSS wird kleingeschrieben, nicht abgelehnt (Altbestand)',
  sanitizeDungeonDocument({ ...altRoh, id: 'GROSS' })?.id,
  'gross'
);

// ─────────────────────────────────────────────────────────────────────────────
// (c) Die Pruefsumme ist ein Zeuge / the checksum is a witness
// ─────────────────────────────────────────────────────────────────────────────

const gefaelscht = { ...doc2, pruefsumme: 'deadbeef' };
const geheilt = sanitizeDungeonDokument2(gefaelscht);
pruefe('Sanitizer nimmt eine falsche Pruefsumme nicht an', geheilt !== null);
pruefeGleich('… sondern rechnet sie neu', geheilt?.pruefsumme, doc2.pruefsumme);

const layout = layoutVonDokument2(doc2);
pruefe('layoutVonDokument2 liefert ein Layout', layout !== null);
pruefeGleich('Dokument-Pruefsumme == Layout-Pruefsumme', doc2.pruefsumme, layout && layoutPruefsumme(layout));
pruefeGleich('Layout-Kennung == Dokument-Kennung', layout?.id, doc2.id);

pruefe(
  'Unbekanntes Thema wird abgelehnt',
  sanitizeDungeonDokument2({ ...doc2, thema: 'gibtsnicht' }) === null &&
    erzeugeDokument2('x', 'x', 'gibtsnicht', SEEDS) === null
);
pruefe(
  'Kaputte Seeds werden abgelehnt',
  sanitizeDungeonDokument2({ ...doc2, seeds: { architektur: 1.5, material: 0, deko: 0 } }) === null &&
    sanitizeDungeonDokument2({ ...doc2, seeds: null }) === null
);
pruefe(
  'Eine Layout-Formatversion aus der Zukunft wird abgelehnt',
  sanitizeDungeonDokument2({ ...doc2, layoutVersion: 99 }) === null
);

// ─────────────────────────────────────────────────────────────────────────────
// (d) Deskriptor hin, Layout zurueck / descriptor out, layout back
// ─────────────────────────────────────────────────────────────────────────────

const d = deskriptorVon(doc2);
const zurueck = layoutAusDeskriptor(d);
pruefe('Deskriptor -> Layout', zurueck.layout !== null);
pruefe('… ohne Abweichung', !zurueck.abweichung, `${zurueck.erwartet} vs ${zurueck.gerechnet}`);
pruefeGleich('… ohne Layout-Fehler', zurueck.befunde.length, 0);
pruefeGleich(
  '… und es ist dasselbe Layout',
  zurueck.layout && layoutPruefsumme(zurueck.layout),
  doc2.pruefsumme
);

const verbogen = layoutAusDeskriptor({ ...d, pruefsumme: '00000000' });
pruefe('Eine falsche Pruefsumme im Deskriptor MELDET Abweichung', verbogen.abweichung);
pruefe('… und liefert trotzdem ein Layout', verbogen.layout !== null);

// Ein anderer Architektur-Seed muss ein anderes Grab ergeben — sonst waere die
// ganze Deskriptor-Idee ohne Wirkung.
// A different architecture seed must yield a different barrow.
const anders = erzeugeDokument2('steingrab-x', 'x', 'steingrab', { ...SEEDS, architektur: 999 });
pruefe('Anderer Architektur-Seed -> andere Pruefsumme', anders !== null && anders.pruefsumme !== doc2.pruefsumme);

// ─────────────────────────────────────────────────────────────────────────────
// (e) Anker-Aenderung vs. Architektur-Aenderung
// ─────────────────────────────────────────────────────────────────────────────

if (layout !== null) {
  const zusatzAnker: DekoAnker = {
    ...layout.anker[0]!,
    // Eine Id, die es sicher noch nicht gibt — der Anker soll DAZUKOMMEN,
    // nicht einen bestehenden ersetzen.
    // An id that certainly does not exist yet.
    id: 0x7fffffff,
  };
  const mitAnker: DungeonDokument2 = {
    ...doc2,
    modus: 'gebaut',
    layout: { ...layout, anker: [...layout.anker, zusatzAnker] },
  };
  const ohneAnker: DungeonDokument2 = { ...doc2, modus: 'gebaut', layout };

  pruefeGleich(
    'Ein zusaetzlicher Anker aendert die Pruefsumme OHNE Anker NICHT',
    pruefsummeOhneAnker(mitAnker),
    pruefsummeOhneAnker(ohneAnker)
  );
  pruefe(
    '… waehrend die volle Pruefsumme sich sehr wohl aendert',
    layoutPruefsumme(mitAnker.layout!) !== layoutPruefsumme(ohneAnker.layout!)
  );

  // Und der Gegenfall: Eine Architektur-Aenderung MUSS auch ohne Anker
  // auffallen, sonst bliebe eine Instanz stehen, deren Waende sich bewegt
  // haben. / And the counter-case: an architecture change MUST show up.
  const verschoben: DungeonDokument2 = {
    ...ohneAnker,
    layout: { ...layout, stempel: layout.stempel.slice(0, -1) },
  };
  pruefe(
    'Ein entfernter Stempel aendert die Pruefsumme OHNE Anker',
    pruefsummeOhneAnker(verschoben) !== pruefsummeOhneAnker(ohneAnker)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (f) JSON hin und zurueck / JSON round trip
// ─────────────────────────────────────────────────────────────────────────────

const durchJson = sanitizeDungeonDokument2(JSON.parse(JSON.stringify(doc2)));
pruefeGleich('JSON-Rundreise aendert nichts', JSON.stringify(durchJson), JSON.stringify(doc2));
pruefe(
  'Ein erzeugtes Dokument traegt KEIN Layout (der Seed reist, nicht die Daten)',
  doc2.layout === undefined && !('layout' in JSON.parse(JSON.stringify(doc2)))
);

// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-dokument: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
