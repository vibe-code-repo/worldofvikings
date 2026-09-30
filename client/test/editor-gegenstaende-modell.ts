/**
 * Editor card EG2: the DOM-free model of the item mask (`client/src/editor/gegenstaende/modell.ts`).
 * Editor-Karte EG2: das DOM-freie Modell der Gegenstands-Maske.
 *
 *  [1] round trip form -> entry -> form for every field, byte-identical through `schreibeGegenstandsDatei`
 *  [2] required fields: without a name in German OR English saving is blocked, per field
 *  [3] the id is fixed after the first save (`setzeId`), free while the entry is new
 *  [4] copy: a new id (also near the 32 character limit, also against a case-only clash), keys derived again
 *  [5] the check gives the SAME reason codes as the server's reader (`leseGegenstandsDatei` on the same entry)
 *  [6] the ranges of the mask are the reader's ranges: at the limit the reader keeps the value, beyond it clamps
 *  [7] what only the mask sees: half a vector, a bad number, a recipe without ingredients, the 500 limit
 *  [8] list operations and the document text
 *  [9] N1 finding 1: a text error stands at the field that causes it (name / description, de / en), with its own
 *      cause (line break, control character, too long, no letter); the reader is the judge
 *  [10] N1 finding 6: which entries a removal would take with it (direct and through intermediate products)
 *
 * Run: npx tsx test/editor-gegenstaende-modell.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import {
  ID_MUSTER,
  MAX_TEXT_ZEICHEN,
  VERWERF_GRUENDE,
  leseGegenstandsDatei,
  schreibeGegenstandsDatei,
  type GegenstandsEintrag,
} from '@wov/shared/src/items/gegenstandsDaten.js';
import { istCodeItem } from '@wov/shared/src/items/itemDefs.js';
import {
  BEREICHE,
  TEXT_MAX,
  abhaengige,
  andereOhne,
  dokumentText,
  eintragZuFormular,
  formularZuEintrag,
  freieId,
  idAenderbar,
  kannSpeichern,
  kopie,
  leeresFormular,
  lokaleFehler,
  mitEintrag,
  ohneEintrag,
  pruefeFormular,
  setzeId,
  textGrund,
  verwender,
  type Formular,
} from '../src/editor/gegenstaende/modell';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}
const gleich = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A sanitised entry from a plain object, exactly as the reader makes it. */
function eintragAus(roh: Record<string, unknown>): GegenstandsEintrag {
  const l = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: [roh] }));
  if (l.eintraege.length !== 1) throw new Error(`fixture refused: ${JSON.stringify(l.verworfen)}`);
  return l.eintraege[0];
}
const texte = (id: string, de: string, en: string, bd?: string, be?: string): Record<string, unknown> => ({
  [`inhalt.gegenstand.${id}.name`]: { de, en },
  ...(bd !== undefined || be !== undefined ? { [`inhalt.gegenstand.${id}.beschreibung`]: { ...(bd !== undefined ? { de: bd } : {}), ...(be !== undefined ? { en: be } : {}) } } : {}),
});

check('fixture ingredient "Wood" is a code item', istCodeItem('Wood'));
const VOLL = eintragAus({
  id: 'Holzaxt',
  nameSchluessel: 'inhalt.gegenstand.Holzaxt.name',
  beschreibungSchluessel: 'inhalt.gegenstand.Holzaxt.beschreibung',
  typ: 'werkzeug',
  slot: 'hand',
  modell: { upload: 'hochgeladen/U_Holzaxt', skala: 0.6, haltePosition: [0, -0.05, 0.12], halteRotation: [-1.9, 0, 0], hiebVersatz: 0.3, animationsSatz: 'sword' },
  symbol: 'axt_holz',
  stapel: 1,
  gewicht: 2.5,
  werte: { damage: 10, armor: 1, strength: 2, vitality: 3, agility: 4 },
  ernte: { baum: 1, fels: 2 },
  haltbarkeit: { max: 150, verbrauch: 1, ausdauer: 8 },
  itemLevel: 7,
  rarity: 'rare',
  rezept: { menge: 2, zutaten: [{ item: 'Wood', menge: 8 }, { item: 'Flint', menge: 2 }] },
  texte: texte('Holzaxt', 'Holzaxt', 'Wooden axe', 'Eine schlichte Axt.', 'A plain axe.'),
});
const SCHLICHT = eintragAus({ id: 'Feder', nameSchluessel: 'inhalt.gegenstand.Feder.name', typ: 'material', texte: texte('Feder', 'Feder', 'Feather') });
const NUR_DE_BESCHREIBUNG = eintragAus({
  id: 'Zweig', nameSchluessel: 'inhalt.gegenstand.Zweig.name', beschreibungSchluessel: 'inhalt.gegenstand.Zweig.beschreibung', typ: 'material',
  texte: texte('Zweig', 'Zweig', 'Twig', 'Nur deutsch.'),
});
const EIGENER_SCHLUESSEL = eintragAus({
  id: 'Stein', nameSchluessel: 'inhalt.gegenstand.Stein.titel', typ: 'material',
  texte: { 'inhalt.gegenstand.Stein.titel': { de: 'Stein', en: 'Stone' } },
});
const FIXTURES = [VOLL, SCHLICHT, NUR_DE_BESCHREIBUNG, EIGENER_SCHLUESSEL];

// ── [1] round trip ─────────────────────────────────────────────────────
console.log('\n[1] Rundreise Formular -> Eintrag -> Formular:');
for (const e of FIXTURES) {
  const f = eintragZuFormular(e);
  const e2 = formularZuEintrag(f);
  check(`${e.id}: bytegleich ueber schreibeGegenstandsDatei`, schreibeGegenstandsDatei([e]) === schreibeGegenstandsDatei([e2]));
  check(`${e.id}: Formular nach der Rundreise unveraendert`, gleich(eintragZuFormular(e2), f));
  check(`${e.id}: das gespeicherte Formular ist nicht mehr neu`, f.neu === false && f.id === e.id);
  check(`${e.id}: das Formular ist gueltig`, pruefeFormular(f, []).length === 0);
  check(`${e.id}: Eintrag deepEqual nach Lesen des geschriebenen Textes`, gleich(leseGegenstandsDatei(schreibeGegenstandsDatei([e2])).eintraege[0], e));
}
{
  const f = eintragZuFormular(VOLL);
  check('voller Eintrag: alle Felder im Formular (Stichproben)', f.nameEn === 'Wooden axe' && f.upload === 'hochgeladen/U_Holzaxt' && f.skala === '0.6' && f.haltePosition[2] === '0.12' && f.ernteFels === '2' && f.zutaten.length === 2 && f.werte.agility === '4' && f.animationsSatz === 'sword' && f.rarity === 'rare' && f.symbol === 'axt_holz');
  const e = formularZuEintrag(f);
  check('eigener Textschluessel bleibt erhalten', formularZuEintrag(eintragZuFormular(EIGENER_SCHLUESSEL)).nameSchluessel === 'inhalt.gegenstand.Stein.titel' && e.nameSchluessel === VOLL.nameSchluessel);
  const ohne = eintragZuFormular(VOLL);
  ohne.beschreibungDe = '';
  ohne.beschreibungEn = '';
  const e3 = formularZuEintrag(ohne);
  check('leere Beschreibung: kein Beschreibungsschluessel, kein Beschreibungstext', e3.beschreibungSchluessel === null && Object.keys(e3.texte).length === 1);
  check('Beschreibung nur deutsch: nur `de` im Text', gleich(formularZuEintrag(eintragZuFormular(NUR_DE_BESCHREIBUNG)).texte['inhalt.gegenstand.Zweig.beschreibung'], { de: 'Nur deutsch.' }));
}
{
  const f = leeresFormular();
  f.id = 'Neu';
  f.nameDe = 'Neu';
  f.nameEn = 'New';
  const e = formularZuEintrag(f);
  check('neues Formular: Schluessel aus der Kennung abgeleitet', e.nameSchluessel === 'inhalt.gegenstand.Neu.name' && e.beschreibungSchluessel === null);
  check('neues Formular: Vorgaben wie beim Leser (Skala 1, Stapel 1, Stufe 1, common)', e.modell.skala === 1 && e.stapel === 1 && e.itemLevel === 1 && e.rarity === 'common' && e.rezept === null);
  check('neues Formular mit Name und Kennung ist gueltig', pruefeFormular(f, []).length === 0);
}

// ── [2] required fields ────────────────────────────────────────────────
console.log('\n[2] Pflichtfelder:');
{
  const basis = (): Formular => eintragZuFormular(SCHLICHT);
  check('mit Name de+en: Speichern moeglich', kannSpeichern(basis(), []));
  const ohneDe = basis();
  ohneDe.nameDe = '';
  const feDe = pruefeFormular(ohneDe, []);
  check('ohne Name de: gesperrt, Fehler am Feld nameDe', !kannSpeichern(ohneDe, []) && feDe.length === 1 && feDe[0].feld === 'nameDe' && feDe[0].code === 'name-fehlt', JSON.stringify(feDe));
  const ohneEn = basis();
  ohneEn.nameEn = '';
  const feEn = pruefeFormular(ohneEn, []);
  check('ohne Name en: gesperrt, Fehler am Feld nameEn', !kannSpeichern(ohneEn, []) && feEn.length === 1 && feEn[0].feld === 'nameEn' && feEn[0].code === 'name-fehlt', JSON.stringify(feEn));
  const nurLeerzeichen = basis();
  nurLeerzeichen.nameEn = '   ';
  check('Name nur aus Leerzeichen: gesperrt', !kannSpeichern(nurLeerzeichen, []));
  const beide = basis();
  beide.nameDe = '';
  beide.nameEn = '';
  check('ohne beide Namen: zwei Fehler', pruefeFormular(beide, []).filter((x) => x.code === 'name-fehlt').length === 2);
  check('der Leser lehnt denselben Eintrag ab (texte-name-fehlt)', gleich(leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: [formularZuEintrag(ohneDe)] })).verworfen.map((v) => v.grund), ['texte-name-fehlt']));
  const ohneBeschreibung = basis();
  ohneBeschreibung.beschreibungDe = '';
  ohneBeschreibung.beschreibungEn = '';
  check('Beschreibung ist optional', kannSpeichern(ohneBeschreibung, []));
  const ohneId = leeresFormular();
  ohneId.nameDe = 'A';
  ohneId.nameEn = 'A';
  check('ohne Kennung: gesperrt (id-ungueltig am Feld id)', pruefeFormular(ohneId, []).some((x) => x.feld === 'id' && x.code === 'id-ungueltig'));
}

// ── [3] id fixed after the first save ──────────────────────────────────
console.log('\n[3] Kennung nach dem Speichern fest:');
{
  const gespeichert = eintragZuFormular(VOLL);
  check('gespeicherter Eintrag: id nicht aenderbar', idAenderbar(gespeichert) === false);
  const versuch = setzeId(gespeichert, 'Andere');
  check('setzeId gibt das Formular unveraendert zurueck', versuch.id === 'Holzaxt' && versuch === gespeichert);
  const neu = leeresFormular();
  check('neuer Eintrag: id aenderbar', idAenderbar(neu) === true);
  check('setzeId setzt die Kennung eines neuen Eintrags', setzeId(neu, 'Holzaxt2').id === 'Holzaxt2');
  const umbenannt = eintragZuFormular(VOLL);
  umbenannt.nameDe = 'Neue Axt';
  umbenannt.nameEn = 'New axe';
  const e = formularZuEintrag(umbenannt);
  check('Umbenennen aendert nur die Texte: id und Schluessel bleiben', e.id === 'Holzaxt' && e.nameSchluessel === 'inhalt.gegenstand.Holzaxt.name' && e.texte['inhalt.gegenstand.Holzaxt.name'].de === 'Neue Axt');
}

// ── [4] copy ───────────────────────────────────────────────────────────
console.log('\n[4] Kopieren:');
{
  const f = eintragZuFormular(VOLL);
  const k = kopie(f, [VOLL]);
  check('neue id, passt zum Muster, ist frei', k.id !== VOLL.id && ID_MUSTER.test(k.id) && k.id === 'HolzaxtKopie', k.id);
  check('Kopie ist ein neuer Eintrag (id frei tippbar), Schluessel neu abgeleitet', k.neu && idAenderbar(k) && k.nameSchluessel === null && k.beschreibungSchluessel === null);
  const ek = formularZuEintrag(k);
  check('Kopie traegt die neuen Schluessel und die alten Texte/Werte', ek.nameSchluessel === 'inhalt.gegenstand.HolzaxtKopie.name' && ek.beschreibungSchluessel === 'inhalt.gegenstand.HolzaxtKopie.beschreibung' && ek.texte[ek.nameSchluessel].en === 'Wooden axe' && ek.werte.damage === 10 && ek.rezept?.zutaten.length === 2);
  check('Kopie ist zusammen mit dem Original gueltig', pruefeFormular(k, [VOLL]).length === 0);
  k.zutaten[0].menge = '99';
  k.haltePosition[0] = '1';
  check('Kopie teilt keine Felder mit dem Original', f.zutaten[0].menge === '8' && f.haltePosition[0] === '0');
  const zweite = kopie(k, [VOLL, formularZuEintrag(k)]);
  check('Kopie einer Kopie: wieder eine freie id', zweite.id === 'HolzaxtKopie2', zweite.id);
  check('lange id: hoechstens 32 Zeichen, Muster', ID_MUSTER.test(freieId('A'.repeat(32), new Set())) && freieId('A'.repeat(32), new Set()).length <= 32);
  check('Kopie gegen eine nur in der Schreibung abweichende id', freieId('Holzaxt', new Set(['holzaxtkopie'])) === 'HolzaxtKopie2');
  check('id ohne Muster: Ersatzname', ID_MUSTER.test(freieId('', new Set())));
}

// ── [5] same reasons as the server ─────────────────────────────────────
console.log('\n[5] Gleiche Grund-Codes wie der Server:');
{
  const andere = [SCHLICHT, VOLL];
  const gut = (id: string): Formular => {
    const f = leeresFormular();
    f.id = id;
    f.nameDe = 'Name';
    f.nameEn = 'Name';
    return f;
  };
  const serverGruende = (f: Formular, ander: readonly GegenstandsEintrag[]): string[] => {
    const l = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: [...ander, formularZuEintrag(f)] }));
    return l.verworfen.filter((v) => v.index === ander.length).map((v) => v.grund);
  };
  const faelle: Array<[string, Formular, GegenstandsEintrag[], string]> = [];
  faelle.push(['id-ungueltig', gut('klein'), andere, 'id-ungueltig']);
  faelle.push(['id-ungueltig (zu kurz)', gut('A'), andere, 'id-ungueltig']);
  faelle.push(['id-doppelt', gut('Feder'), andere, 'id-doppelt']);
  faelle.push(['id-code-kollision', gut('Club'), andere, 'id-code-kollision']);
  faelle.push(['id-schreibung-code', gut('CLUB'), andere, 'id-schreibung-code']);
  faelle.push(['id-schreibung-doppelt', gut('FEDER'), andere, 'id-schreibung-doppelt']);
  {
    const f = gut('Selbst');
    f.hatRezept = true;
    f.zutaten = [{ item: 'Selbst', menge: '1' }];
    faelle.push(['rezept-selbstbezug', f, andere, 'rezept-selbstbezug']);
  }
  {
    const f = gut('Neuling');
    f.hatRezept = true;
    f.zutaten = [{ item: 'GibtEsNicht', menge: '1' }];
    faelle.push(['rezept-zutat-unbekannt', f, andere, 'rezept-zutat-unbekannt']);
  }
  {
    const a = eintragAus({ id: 'Aaa', nameSchluessel: 'inhalt.gegenstand.Aaa.name', typ: 'material', rezept: { menge: 1, zutaten: [{ item: 'Wood', menge: 1 }] }, texte: texte('Aaa', 'A', 'A') });
    const f = gut('Bbb');
    f.hatRezept = true;
    f.zutaten = [{ item: 'Aaa', menge: '1' }];
    // Aaa is fine alone; Bbb needs Aaa: no cycle yet
    faelle.push(['kein Zyklus: Bbb braucht Aaa', f, [a], '']);
  }
  {
    // A cycle through the entry being edited: Ccc needs Ddd, Ddd (already there) needs Ccc. Ddd can only exist
    // in the list if it was valid, so it is built by hand with its ingredient a code item and the form adds the loop.
    const ddd = eintragAus({ id: 'Ddd', nameSchluessel: 'inhalt.gegenstand.Ddd.name', typ: 'material', rezept: { menge: 1, zutaten: [{ item: 'Wood', menge: 1 }] }, texte: texte('Ddd', 'D', 'D') });
    const f = gut('Ccc');
    f.hatRezept = true;
    f.zutaten = [{ item: 'Ddd', menge: '1' }];
    const dddZyklus: GegenstandsEintrag = { ...ddd, rezept: { menge: 1, zutaten: [{ item: 'Ccc', menge: 1 }] } };
    faelle.push(['rezept-zyklus (Ddd braucht Ccc)', f, [dddZyklus], 'rezept-zyklus']);
  }
  {
    const f = gut('Sym');
    f.symbol = 'bad symbol!';
    faelle.push(['symbol-ungueltig', f, andere, 'symbol-ungueltig']);
  }
  {
    const f = gut('Mod');
    f.upload = 'fremd/U_x';
    faelle.push(['modell-ungueltig (Praefix)', f, andere, 'modell-ungueltig']);
  }
  {
    const f = gut('Mod2');
    f.upload = 'hochgeladen/../x';
    faelle.push(['modell-ungueltig (Pfadtrick)', f, andere, 'modell-ungueltig']);
  }
  {
    const f = gut('Typ');
    (f as { typ: string }).typ = 'schwert';
    faelle.push(['typ-unbekannt', f, andere, 'typ-unbekannt']);
  }
  {
    const f = gut('Sel');
    (f as { rarity: string }).rarity = 'mythisch';
    faelle.push(['feld-ungueltig (Seltenheit)', f, andere, 'feld-ungueltig']);
  }
  {
    const f = gut('Satz');
    (f as { animationsSatz: string }).animationsSatz = 'axt';
    faelle.push(['modell-ungueltig (Animationssatz)', f, andere, 'modell-ungueltig']);
  }
  faelle.push(['gueltig', gut('Gueltig'), andere, '']);
  for (const [name, f, ander, erwartet] of faelle) {
    const maske = pruefeFormular(f, ander).map((x) => x.code as string);
    const server = serverGruende(f, ander);
    const soll = erwartet === '' ? [] : [erwartet];
    check(`${name}: Maske = Server = ${erwartet || 'nichts'}`, gleich(maske, server) && gleich(maske, soll), `Maske ${JSON.stringify(maske)}, Server ${JSON.stringify(server)}`);
  }
  // every code the mask reports for a form is a reader reason or a mask reason
  const bekannt = new Set<string>([...VERWERF_GRUENDE, 'name-fehlt', 'text-zeilenumbruch', 'text-steuerzeichen', 'text-zu-lang', 'text-ohne-zeichen', 'zahl-ungueltig', 'bereich', 'ganzzahl', 'vektor-unvollstaendig', 'zutaten-fehlen', 'zutat-fehlt']);
  check('alle gemeldeten Codes sind bekannt', faelle.every(([, f, a]) => pruefeFormular(f, a).every((x) => bekannt.has(x.code))));
  // Texts: the server says `texte-ungueltig` for all of these; the mask says the same thing but at the RIGHT field, with the cause.
  for (const [name, f, feld, code] of [
    ['Name de mit unsichtbarem Zeichen', Object.assign(gut('Zeichen'), { nameDe: 'Na\u200Bme' }), 'nameDe', 'text-steuerzeichen'],
    ['Name en mit 201 Zeichen', Object.assign(gut('Lang'), { nameEn: 'x'.repeat(201) }), 'nameEn', 'text-zu-lang'],
  ] as const) {
    const maske = pruefeFormular(f, andere);
    check(`${name}: Server = texte-ungueltig, Maske = ${code} am Feld ${feld}`, gleich(serverGruende(f, andere), ['texte-ungueltig']) && gleich(maske.map((x) => [x.feld, x.code]), [[feld, code]]), JSON.stringify(maske));
  }
  check('VERWERF_GRUENDE hat 23 Codes (Aenderung bricht die Tabellen in texte.ts am Typ)', VERWERF_GRUENDE.length === 23, String(VERWERF_GRUENDE.length));
}

// ── [6] ranges = the reader's ranges ───────────────────────────────────
console.log('\n[6] Bereiche der Maske = Bereiche des Lesers:');
{
  type Setter = (f: Formular, v: string) => void;
  const SETTER: Record<string, Setter> = {
    skala: (f, v) => (f.skala = v),
    haltePosition: (f, v) => (f.haltePosition = [v, v, v]),
    halteRotation: (f, v) => (f.halteRotation = [v, v, v]),
    hiebVersatz: (f, v) => (f.hiebVersatz = v),
    stapel: (f, v) => (f.stapel = v),
    gewicht: (f, v) => (f.gewicht = v),
    'wert.damage': (f, v) => (f.werte.damage = v),
    'wert.armor': (f, v) => (f.werte.armor = v),
    'wert.strength': (f, v) => (f.werte.strength = v),
    'wert.vitality': (f, v) => (f.werte.vitality = v),
    'wert.agility': (f, v) => (f.werte.agility = v),
    ernteBaum: (f, v) => (f.ernteBaum = v),
    ernteFels: (f, v) => (f.ernteFels = v),
    haltbarkeitMax: (f, v) => (f.haltbarkeitMax = v),
    haltbarkeitVerbrauch: (f, v) => (f.haltbarkeitVerbrauch = v),
    haltbarkeitAusdauer: (f, v) => (f.haltbarkeitAusdauer = v),
    itemLevel: (f, v) => (f.itemLevel = v),
    rezeptMenge: (f, v) => {
      f.hatRezept = true;
      f.rezeptMenge = v;
      f.zutaten = [{ item: 'Wood', menge: '1' }];
    },
    zutatMenge: (f, v) => {
      f.hatRezept = true;
      f.zutaten = [{ item: 'Wood', menge: v }];
    },
  };
  check('jeder Bereich hat einen Setter und umgekehrt', gleich(Object.keys(BEREICHE).sort(), Object.keys(SETTER).sort()));
  const grund = (): Formular => {
    const f = leeresFormular();
    f.id = 'Probe';
    f.nameDe = 'P';
    f.nameEn = 'P';
    return f;
  };
  /** The reader's value after write -> read -> write: equal bytes mean it kept the entry as it was. */
  const leserBehaelt = (f: Formular): boolean => {
    const e = formularZuEintrag(f);
    const text = schreibeGegenstandsDatei([e]);
    const l = leseGegenstandsDatei(text);
    return l.verworfen.length === 0 && schreibeGegenstandsDatei(l.eintraege) === text;
  };
  for (const [id, b] of Object.entries(BEREICHE)) {
    const setze = SETTER[id];
    for (const [ort, wert] of [['Untergrenze', b.min], ['Obergrenze', b.max]] as const) {
      const f = grund();
      setze(f, String(wert));
      check(`${id} ${ort} ${wert}: Maske erlaubt, Leser behaelt`, lokaleFehler(f).length === 0 && leserBehaelt(f), JSON.stringify(lokaleFehler(f)));
    }
    for (const [ort, wert] of [['unter der Untergrenze', b.min - (b.ganz ? 1 : 0.001)], ['ueber der Obergrenze', b.max + (b.ganz ? 1 : 0.001)]] as const) {
      const f = grund();
      setze(f, String(wert));
      const lokal = lokaleFehler(f);
      check(`${id} ${ort}: Maske meldet Bereich, Leser wuerde klemmen`, lokal.some((x) => x.code === 'bereich' && x.min === b.min && x.max === b.max) && !leserBehaelt(f), JSON.stringify(lokal));
    }
  }
}

// ── [7] what only the mask sees ────────────────────────────────────────
console.log('\n[7] Was nur die Maske sieht:');
{
  const f0 = (): Formular => eintragZuFormular(SCHLICHT);
  const halb = f0();
  halb.haltePosition = ['1', '', '2'];
  check('halber Vektor: vektor-unvollstaendig am Feld', gleich(lokaleFehler(halb).map((x) => [x.feld, x.code]), [['haltePosition', 'vektor-unvollstaendig']]));
  const schlecht = f0();
  schlecht.gewicht = 'abc';
  check('Text statt Zahl: zahl-ungueltig am Feld', gleich(lokaleFehler(schlecht).map((x) => [x.feld, x.code]), [['gewicht', 'zahl-ungueltig']]));
  const unendlich = f0();
  unendlich.skala = '1e999';
  check('1e999 ist keine gueltige Zahl', lokaleFehler(unendlich).some((x) => x.feld === 'skala' && x.code === 'zahl-ungueltig'));
  const bruch = f0();
  bruch.stapel = '2.5';
  check('Bruch bei ganzer Zahl: ganzzahl', lokaleFehler(bruch).some((x) => x.feld === 'stapel' && x.code === 'ganzzahl'));
  const vektorMitText = f0();
  vektorMitText.halteRotation = ['1', 'x', '2'];
  check('Vektor mit Text: genau eine Meldung', lokaleFehler(vektorMitText).filter((x) => x.feld === 'halteRotation').length === 1);
  const leereRezept = f0();
  leereRezept.hatRezept = true;
  check('Rezept ohne Zutat: zutaten-fehlen', lokaleFehler(leereRezept).some((x) => x.code === 'zutaten-fehlen'));
  const leereZutat = f0();
  leereZutat.hatRezept = true;
  leereZutat.zutaten = [{ item: '', menge: '' }];
  check('leere Zutat: zutat-fehlt und Menge ungueltig', gleich(lokaleFehler(leereZutat).map((x) => x.code), ['zutat-fehlt', 'zahl-ungueltig']));
  check('mit einem lokalen Fehler ist Speichern gesperrt', !kannSpeichern(schlecht, []) && !kannSpeichern(halb, []));
  const viele: GegenstandsEintrag[] = [];
  for (let i = 0; i < 500; i++) viele.push({ ...SCHLICHT, id: `Gg${i}`, nameSchluessel: `inhalt.gegenstand.Gg${i}.name`, texte: { [`inhalt.gegenstand.Gg${i}.name`]: { de: 'a', en: 'a' } } });
  const neu = leeresFormular();
  neu.id = 'Letzter';
  neu.nameDe = 'L';
  neu.nameEn = 'L';
  check('501. Eintrag: zu-viele-eintraege', gleich(pruefeFormular(neu, viele).map((x) => x.code), ['zu-viele-eintraege']));
  check('500. Eintrag geht noch', pruefeFormular(neu, viele.slice(1)).length === 0);
}

// ── [8] list and document ──────────────────────────────────────────────
console.log('\n[8] Liste und Dokument:');
{
  const liste = [VOLL, SCHLICHT];
  const geaendert = { ...SCHLICHT, gewicht: 9 };
  check('mitEintrag ersetzt an derselben Stelle', gleich(mitEintrag(liste, 'Feder', geaendert).map((e) => e.id), ['Holzaxt', 'Feder']) && mitEintrag(liste, 'Feder', geaendert)[1].gewicht === 9);
  check('mitEintrag haengt einen neuen an', gleich(mitEintrag(liste, null, EIGENER_SCHLUESSEL).map((e) => e.id), ['Holzaxt', 'Feder', 'Stein']));
  check('mitEintrag mit unbekannter alter id haengt an', mitEintrag(liste, 'Weg', EIGENER_SCHLUESSEL).length === 3);
  check('ohneEintrag entfernt genau einen', gleich(ohneEintrag(liste, 'Holzaxt').map((e) => e.id), ['Feder']) && liste.length === 2);
  check('andereOhne laesst den bearbeiteten weg', gleich(andereOhne(liste, 'Feder').map((e) => e.id), ['Holzaxt']) && andereOhne(liste, null).length === 2);
  check('Bearbeiten: derselbe Eintrag gegen die anderen ist gueltig, gegen alle nicht (id-doppelt)', pruefeFormular(eintragZuFormular(SCHLICHT), andereOhne(liste, 'Feder')).length === 0 && pruefeFormular(eintragZuFormular(SCHLICHT), liste).some((x) => x.code === 'id-doppelt'));
  check('dokumentText = schreibeGegenstandsDatei', dokumentText(liste) === schreibeGegenstandsDatei(liste));
  check('Dokument liest sich zurueck', gleich(leseGegenstandsDatei(dokumentText(FIXTURES)).eintraege, FIXTURES));
}

// ── [9] text errors at the field that causes them ──────────────────────
console.log('\n[9] Textfehler am richtigen Feld (N1, Befund 1):');
{
  check('die Grenze kommt aus dem Leser (MAX_TEXT_ZEICHEN), nicht aus einer Kopie', TEXT_MAX === MAX_TEXT_ZEICHEN && TEXT_MAX === 200);
  const gut = (): Formular => {
    const f = leeresFormular();
    f.id = 'Textprobe';
    f.nameDe = 'Name';
    f.nameEn = 'Name';
    return f;
  };
  const serverNimmt = (f: Formular): boolean => leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: [formularZuEintrag(f)] })).eintraege.length === 1;
  const je = (f: Formular): Array<[string, string]> => pruefeFormular(f, []).map((x) => [x.feld, x.code]);
  const felder = ['nameDe', 'nameEn', 'beschreibungDe', 'beschreibungEn'] as const;
  const faelle: Array<[string, string, string]> = [
    ['Zeilenumbruch \\n', 'zeile eins\nzeile zwei', 'text-zeilenumbruch'],
    ['Zeilenumbruch \\r\\n', 'a\r\nb', 'text-zeilenumbruch'],
    ['Zeilentrenner U+2028', 'a b', 'text-zeilenumbruch'],
    ['Absatztrenner U+2029', 'a b', 'text-zeilenumbruch'],
    ['201 Zeichen', 'x'.repeat(201), 'text-zu-lang'],
    ['Nullbreitenzeichen', 'Na​me', 'text-steuerzeichen'],
    ['Umkehrzeichen U+202E', 'ab‮cd', 'text-steuerzeichen'],
    ['Tabulator', 'a\tb', 'text-steuerzeichen'],
    ['NUL', 'a\u0000b', 'text-steuerzeichen'],
  ];
  for (const feld of felder) {
    for (const [name, wert, code] of faelle) {
      const f = gut();
      (f as unknown as Record<string, string>)[feld] = wert;
      check(`${feld}, ${name}: Fehler ${code} NUR an ${feld}, Speichern gesperrt, Server lehnt ab`, gleich(je(f), [[feld, code]]) && !kannSpeichern(f, []) && !serverNimmt(f), JSON.stringify(je(f)));
    }
  }
  // exactly at the limit
  for (const feld of felder) {
    const f = gut();
    (f as unknown as Record<string, string>)[feld] = 'x'.repeat(200);
    check(`${feld}: genau 200 Zeichen sind erlaubt (Maske und Server)`, je(f).length === 0 && serverNimmt(f));
  }
  {
    const f = gut();
    f.nameDe = '😀'.repeat(101);
    check('202 UTF-16-Einheiten (101 Emoji) = zu lang, so wie der Leser zaehlt', gleich(je(f), [['nameDe', 'text-zu-lang']]) && !serverNimmt(f));
    f.nameDe = '😀'.repeat(100);
    check('200 UTF-16-Einheiten (100 Emoji) sind erlaubt', je(f).length === 0 && serverNimmt(f));
  }
  {
    const f = gut();
    f.nameEn = '!!!';
    check('Name en nur aus Satzzeichen: text-ohne-zeichen an nameEn, der Server lehnt ab', gleich(je(f), [['nameEn', 'text-ohne-zeichen']]) && !serverNimmt(f), JSON.stringify(je(f)));
    f.nameEn = '';
    check('Name en leer bleibt name-fehlt (kein zweiter Fehler)', gleich(je(f), [['nameEn', 'name-fehlt']]));
    f.nameEn = ' \n ';
    check('Name aus Leerraum + Zeilenumbruch: nur name-fehlt', gleich(je(f), [['nameEn', 'name-fehlt']]));
    const b = gut();
    b.beschreibungDe = '!!!';
    check('eine Beschreibung nur aus Satzzeichen ist erlaubt (der Leser verlangt Buchstaben nur beim Namen)', je(b).length === 0 && serverNimmt(b));
  }
  {
    const f = gut();
    f.nameDe = 'a\nb';
    f.beschreibungEn = 'x'.repeat(300);
    check('zwei Fehler an zwei Feldern: beide stehen an ihrem Feld', gleich(je(f), [['nameDe', 'text-zeilenumbruch'], ['beschreibungEn', 'text-zu-lang']]), JSON.stringify(je(f)));
    check('zu-lang nennt die Grenze 200 (fuer den Zaehler)', pruefeFormular(f, []).find((x) => x.code === 'text-zu-lang')?.max === 200);
  }
  check('textGrund: alles Erlaubte gibt null (Umlaute, CJK, Emoji-Folge, HTML-Zeichen)', ['Äpfel & Öl', '斧', '👨‍🌾', '<b>fett</b>', 'a b'].every((w) => textGrund('name', w) === null));
  check('Rundreise: ein Text mit Umlauten und Emoji ist weiter frei von Fehlern', (() => {
    const f = gut();
    f.beschreibungDe = 'Scharfe Klinge — nur für Krieger 🗡️';
    return je(f).length === 0 && serverNimmt(f);
  })());
}

// ── [10] dependents ────────────────────────────────────────────────────
console.log('\n[10] Wer haengt an einem Gegenstand (N1, Befund 6):');
{
  const mk = (id: string, zutaten: string[]): GegenstandsEintrag =>
    eintragAus({ id, nameSchluessel: `inhalt.gegenstand.${id}.name`, typ: 'material', ...(zutaten.length > 0 ? { rezept: { menge: 1, zutaten: zutaten.map((item) => ({ item, menge: 1 })) } } : {}), texte: texte(id, id, id) });
  const A = mk('Aaa', []);
  const B = mk('Bbb', ['Aaa']);
  const C = mk('Ccc', ['Bbb']);
  const D = mk('Ddd', ['Wood']);
  const E = mk('Eee', ['Aaa', 'Ccc']);
  const liste = [A, B, C, D, E];
  check('verwender(Aaa) = direkte Nutzer: Bbb, Eee', gleich(verwender(liste, 'Aaa'), ['Bbb', 'Eee']), JSON.stringify(verwender(liste, 'Aaa')));
  check('abhaengige(Aaa) = Bbb, Eee direkt, dann Ccc ueber Bbb', gleich(abhaengige(liste, 'Aaa'), ['Bbb', 'Eee', 'Ccc']), JSON.stringify(abhaengige(liste, 'Aaa')));
  check('abhaengige(Ddd) = leer (Wood ist kein Eintrag; niemand braucht Ddd)', abhaengige(liste, 'Ddd').length === 0);
  check('abhaengige(Ccc) = Eee', gleich(abhaengige(liste, 'Ccc'), ['Eee']));
  check('abhaengige enthaelt den Gegenstand selbst nie, keine Doppelten', abhaengige(liste, 'Aaa').every((x) => x !== 'Aaa') && new Set(abhaengige(liste, 'Aaa')).size === 3);
  check('ein Gegenstand, den niemand braucht, hat nichts', abhaengige(liste, 'Eee').length === 0);
  // The server agrees: removing Aaa without them is refused / drops them; with all abhaengige the file is clean.
  const ohneNurA = leseGegenstandsDatei(dokumentText(ohneEintrag(liste, 'Aaa')));
  check('Referenz: nur Aaa entfernen laesst den Leser Bbb, Ccc, Eee verwerfen (Rezept-Zutat unbekannt)', ohneNurA.verworfen.length === 3 && ohneNurA.verworfen.every((v) => v.grund === 'rezept-zutat-unbekannt'), JSON.stringify(ohneNurA.verworfen));
  const rest = liste.filter((e) => e.id !== 'Aaa' && !abhaengige(liste, 'Aaa').includes(e.id));
  const sauber = leseGegenstandsDatei(dokumentText(rest));
  check('Aaa + abhaengige entfernen: der Leser verwirft nichts mehr', sauber.verworfen.length === 0 && sauber.eintraege.length === 1 && sauber.eintraege[0].id === 'Ddd');
}

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
