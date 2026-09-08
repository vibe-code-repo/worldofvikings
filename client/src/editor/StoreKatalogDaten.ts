/**
 * Speicher-Katalog: die Einsortierung des Asset-Speichers
 * (`assets/store/`) — Art, Gruppe, Untergruppe, Kennzeichen.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Der Gegenstands-Katalog kannte bis hierher genau EINE Quelle: die
 * Prefab-Registry aus `@wov/shared`, und dort ausschliesslich GLBs. Der
 * Speicher enthaelt aber 672 Dateien in fuenf Sorten — Modelle,
 * Texturen, Toene, Hoehenfelder, Kulissen —, und wer eine Bodentextur
 * oder einen Schrittklang suchte, musste den Ordner im Dateimanager
 * oeffnen. Dieses Modul beantwortet die Frage „was liegt da, und wo
 * gehoert es hin?" aus den zwei Dateien, die der Speicher selbst
 * mitbringt: `manifest.json` (die Wahrheit ueber den Bestand) und
 * `prefabs.json` (Kategorie und Kollisionsart).
 *
 * ── Warum die Einsortierung eine REINE Funktion ist ──────────────────
 * `einsortieren()` bekommt einen Eintrag und liefert seine Einordnung —
 * ohne Netz, ohne DOM, ohne Zwischenspeicher. Nur so laesst sie sich
 * ueber alle 1255 Manifest-Eintraege fahren und zaehlen
 * (`client/test/store-katalog.ts`); eine Regel, die nur im Browser
 * lebt, kann man nur ansehen, nicht pruefen. Die Zaehlung IST der Test:
 * Eine Regel, die 300 Eintraege still in „Sonstige" kippt, sieht im
 * Katalog aus wie eine, die funktioniert.
 *
 * ── Warum die Feldnamen so heissen ───────────────────────────────────
 * `id`, `pfad`, `art`, `gruppe`, `untergruppe`, `bytes`, `hash`,
 * `bounds`, `kollision`, `lizenzstatus`, `prefabName` sind mit der
 * shared-Fassung (`STORE_KATALOG`) abgestimmt, die parallel entsteht.
 * Ist sie da, wird aus diesem Modul ein Import — nicht ein Umbau.
 *
 * ── Was NICHT hier steht ─────────────────────────────────────────────
 * Kein Babylon, kein DOM, keine Vorschau. Das Modul liest zwei
 * JSON-Dateien und sortiert Zeichenketten; es laeuft deshalb auch unter
 * `tsx` in einem Node-Test.
 *
 * The store catalogue's sorting rule — pure, DOM-free, testable.
 */

/** Erste Ebene der Bedienung: wonach sieht man ueberhaupt? */
export type StoreArt = 'Modelle' | 'Texturen' | 'Ton' | 'Höhenfelder' | 'Kulisse';

/** Reihenfolge der Arten in der Bedienung (Modelle zuerst — die groesste Sorte). */
export const STORE_ARTEN: readonly StoreArt[] = ['Modelle', 'Texturen', 'Ton', 'Höhenfelder', 'Kulisse'];

/** Sorten, die das Manifest kennt. */
export type StoreSorte = 'mesh' | 'prefab' | 'texture' | 'audio' | 'terrain';

/** Kategorien, die `prefabs.json` kennt. */
export type PrefabKategorie = 'prop' | 'environment' | 'vegetation' | 'terrain' | 'backdrop';

/** Kollisionsarten aus `prefabs.json`. */
export type Kollisionsart = 'box' | 'none' | 'mesh';

/** Huellbox, wie sie Manifest und Prefab-Katalog schreiben. */
export interface StoreHuelle {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/** Ein Manifest-Eintrag, so viel davon wie `einsortieren` braucht. */
export interface StoreRoheintrag {
  id: string;
  path: string;
  kind: StoreSorte;
  /** Aus `prefabs.json`, wenn es dort einen Eintrag zu diesem Pfad gibt. */
  category?: PrefabKategorie | null;
}

/** Das Ergebnis der Einsortierung. */
export interface Einordnung {
  art: StoreArt;
  gruppe: string;
  untergruppe: string;
  /** Quer zur Hierarchie: Schnee, Dunkel, LOD, Kollisionsnetz, Platzhalter … */
  kennzeichen: string[];
}

/**
 * Ein fertiger Katalogeintrag.
 *
 * Die Feldnamen sind mit der shared-Fassung abgestimmt (s. Kopf) — wer
 * hier etwas umbenennt, macht den spaeteren Import zu einem Umbau.
 */
export interface StoreEintrag {
  id: string;
  pfad: string;
  art: StoreArt;
  gruppe: string;
  untergruppe: string;
  kennzeichen: string[];
  /** Lesbarer Name — aus `prefabs.json`, sonst aus dem Dateinamen gebildet. */
  name: string;
  bytes: number;
  hash: string;
  bounds?: StoreHuelle;
  kollision?: Kollisionsart;
  /** Klartext statt Rohfeldern — s. `lizenzstatus()`. */
  lizenzstatus: string;
  /** Die Id aus `prefabs.json` (z. B. `environment-sm-bld-house-…`). */
  prefabName?: string;
  /** `origin` aus dem Manifest — bei Ton stehen dort Dauer/Kanaele/Abtastrate. */
  herkunft?: string;
  /**
   * Pfad der zugehoerigen `<modell>-collision.glb`, wenn es eine gibt.
   * Aus dem DATEINAMEN abgeleitet, nicht aus `prefabs.json` — dort stehen
   * nur drei der zwoelf (Messprobe).
   */
  kollisionsdatei?: string;
  /** true, wenn der Pfad unter `placeholders/` liegt (nicht im Speicher). */
  platzhalter: boolean;
}

/**
 * Uebersetzung der Namensbestandteile in Untergruppen-Beschriftungen.
 *
 * Bewusst eine LISTE von Paaren und keine Objektliteral-Tabelle: Ein
 * doppelter Schluessel verschwindet in einem Objektliteral spurlos (der
 * zweite gewinnt, niemand merkt es). Als Liste laesst er sich zaehlen —
 * `WORT_PAARE.length === WORT_TEXT.size` ist genau dieser Zeuge und
 * steht im Test.
 *
 * Was NICHT drinsteht, bleibt unveraendert stehen. Das ist Absicht: Eine
 * Untergruppe „torchstick" ist haesslich, aber sie ist wahr — eine
 * erratene Uebersetzung waere es nicht.
 */
export const WORT_PAARE: ReadonlyArray<readonly [string, string]> = [
  // ── Gebaeude (sm-bld-…) ──────────────────────────────────────────
  ['house', 'Haus'],
  ['boathouse', 'Bootshaus'],
  ['outhouse', 'Abort'],
  ['wooden', 'Holzbau'],
  ['preset', 'Vorlage'],
  ['roof', 'Dach'],
  // ── Umgebung (sm-env-…) ──────────────────────────────────────────
  ['rock', 'Felsen'],
  ['stone', 'Steine'],
  ['stonewall', 'Steinmauer'],
  ['wall', 'Mauern'],
  ['pillar', 'Säulen'],
  ['railing', 'Geländer'],
  ['stairs', 'Treppen'],
  ['path', 'Wege'],
  ['rubble', 'Schutt'],
  ['wood', 'Holzwerk'],
  ['icechunk', 'Eisbrocken'],
  ['iceberg', 'Eisberge'],
  ['glacier', 'Gletscher'],
  ['bone', 'Knochen'],
  ['gem', 'Edelsteine'],
  ['rune', 'Runen'],
  ['door', 'Türen'],
  ['minetrack', 'Grubenbahn'],
  ['statue', 'Statuen'],
  ['obelisk', 'Obelisken'],
  ['structure', 'Bauwerke'],
  ['grate', 'Gitter'],
  ['groundmound', 'Bodenwelle'],
  ['grasspatch', 'Grasflecken'],
  ['tiles', 'Fliesen'],
  ['water', 'Wasser'],
  ['astroid', 'Meteorit'],
  ['planter', 'Pflanzkübel'],
  ['big', 'Großbewuchs'],
  // ── Requisiten (sm-prop-…) ───────────────────────────────────────
  ['barrel', 'Fässer'],
  ['crate', 'Kisten'],
  ['chest', 'Truhen'],
  ['sack', 'Säcke'],
  ['table', 'Tische'],
  ['chair', 'Stühle'],
  ['stool', 'Hocker'],
  ['bench', 'Bänke'],
  ['bed', 'Betten'],
  ['sign', 'Schilder'],
  ['poster', 'Aushänge'],
  ['candle', 'Kerzen'],
  ['chandelier', 'Kronleuchter'],
  ['brazier', 'Feuerschalen'],
  ['bonfire', 'Lagerfeuer'],
  ['fence', 'Zäune'],
  ['hay', 'Heu'],
  ['log', 'Stämme'],
  ['logs', 'Stämme'],
  ['dock', 'Stege'],
  ['goblin', 'Goblinwerk'],
  ['destroyed', 'Ruinen'],
  ['animal', 'Tiertrophäen'],
  ['books', 'Bücherstapel'],
  ['bookcase', 'Bücherregale'],
  ['shelf', 'Bretter'],
  ['shelves', 'Regale'],
  ['brick', 'Ziegel'],
  ['bricks', 'Ziegel'],
  ['rug', 'Teppiche'],
  ['pot', 'Töpfe'],
  ['clay', 'Tonwaren'],
  ['jar', 'Krüge'],
  ['vase', 'Vasen'],
  ['basket', 'Körbe'],
  ['ladder', 'Leitern'],
  ['plank', 'Bohlen'],
  ['planterbox', 'Pflanzkästen'],
  ['well', 'Brunnen'],
  ['workbench', 'Werkbänke'],
  ['forge', 'Schmiede'],
  ['anvil', 'Ambosse'],
  ['ore', 'Erze'],
  ['grinding', 'Schleifstein'],
  ['spike', 'Spieße'],
  ['cloud', 'Wolken'],
  ['fireworks', 'Feuerwerk'],
  ['fabric', 'Stoffe'],
  ['wardrobe', 'Schränke'],
  ['cabinet', 'Kommoden'],
  ['dresser', 'Kommoden'],
  ['ground', 'Bodenbretter'],
  ['village', 'Dorfeinfahrt'],
  ['wagon', 'Wagen'],
  ['alchemy', 'Alchemie'],
  ['archway', 'Torbogen'],
  ['arrow', 'Pfeile'],
  ['quiver', 'Köcher'],
  ['bathtub', 'Badewanne'],
  ['bell', 'Glocken'],
  ['bellows', 'Blasebalg'],
  ['bracket', 'Halterungen'],
  ['bucket', 'Eimer'],
  ['camp', 'Lager'],
  ['chain', 'Ketten'],
  ['chopping', 'Hackblock'],
  ['dummy', 'Übungspuppe'],
  ['fish', 'Fisch'],
  ['gallows', 'Galgen'],
  ['garlic', 'Knoblauch'],
  ['onion', 'Zwiebeln'],
  ['hook', 'Haken'],
  ['horse', 'Pferd'],
  ['ink', 'Tinte'],
  ['leather', 'Leder'],
  ['map', 'Karten'],
  ['metal', 'Metall'],
  ['pillow', 'Kissen'],
  ['pole', 'Pfähle'],
  ['pumpkin', 'Kürbis'],
  ['quest', 'Anschlagbrett'],
  ['rope', 'Seile'],
  ['torchstick', 'Fackeln'],
  ['trashbag', 'Abfallsäcke'],
  ['weight', 'Gewichte'],
  ['wheat', 'Weizen'],
  ['cow', 'Tiertrophäen'],
  // ── Altbestand ohne `sm-<typ>-`-Vorsilbe ─────────────────────────
  ['chestbottom', 'Truhen'],
  ['chesttop', 'Truhen'],
  ['floor', 'Boden'],
  ['start', 'Startpunkt'],
  ['detail', 'Zierrat'],
  // ── Gegenstaende (sm-item-…) ─────────────────────────────────────
  ['crystal', 'Kristalle'],
  ['book', 'Bücher'],
  ['billy', 'Kochgeschirr'],
  ['cauldron', 'Kessel'],
  ['kettle', 'Kessel'],
  ['bracelet', 'Armreife'],
  ['ring', 'Ringe'],
  ['candlestick', 'Leuchter'],
  ['hammer', 'Hämmer'],
  ['tongs', 'Zangen'],
  ['parchment', 'Pergamente'],
  ['potion', 'Tränke'],
  ['bottle', 'Flaschen'],
  ['bread', 'Brot'],
  ['cheese', 'Käse'],
  ['coins', 'Münzen'],
  ['cup', 'Becher'],
  ['mug', 'Krüge'],
  ['goblet', 'Kelche'],
  ['bowl', 'Schalen'],
  ['dish', 'Teller'],
  ['jug', 'Kannen'],
  ['horn', 'Hörner'],
  ['horseshoe', 'Hufeisen'],
  ['ingot', 'Barren'],
  ['lock', 'Schlösser'],
  ['lockpick', 'Dietriche'],
  ['mortar', 'Mörser'],
  ['bag', 'Beutel'],
  ['mushroom', 'Pilze'],
  ['mushrooms', 'Pilze'],
  ['shrooms', 'Pilze'],
  ['plant', 'Pflanzen'],
  ['stirring', 'Rührstäbe'],
  // ── Fahrzeuge (sm-veh-…) ─────────────────────────────────────────
  ['cart', 'Karren'],
  ['boat', 'Boote'],
  ['wheelbarrow', 'Schubkarren'],
  // ── Bewuchs und Boden (Modelle wie Boden-Texturen) ───────────────
  ['grass', 'Gras'],
  ['gravel', 'Kies'],
  ['moss', 'Moos'],
] as const;

/** Dieselbe Tabelle als Nachschlagewerk. */
export const WORT_TEXT: ReadonlyMap<string, string> = new Map(WORT_PAARE);

/**
 * Der Ton hat seine EIGENE Tabelle — und zwar nicht aus Ordnungsliebe.
 *
 * Zwei Woerter bedeuten hier etwas anderes als bei den Modellen:
 * `footsteps/wood-…` ist „Holz" (der Untergrund), `sm-env-wood-…` ist
 * „Holzwerk" (gezimmertes Zeug); `animals/cow-…` ist „Kuh",
 * `sm-prop-cow-skull-01` gehoert zu den Tiertrophaeen. In EINER Tabelle
 * gaebe es dafuer nur einen Schluessel — der zweite Eintrag fiele
 * lautlos unter den Tisch, und eine der beiden Untergruppen hiesse
 * dauerhaft falsch.
 */
export const TON_PAARE: ReadonlyArray<readonly [string, string]> = [
  ['grass', 'Gras'],
  ['gravel', 'Kies'],
  ['water', 'Wasser'],
  ['wood', 'Holz'],
  ['fire', 'Feuer'],
  ['forge', 'Schmiede'],
  ['wind', 'Wind'],
  ['forest', 'Wald'],
  ['cat', 'Katze'],
  ['chicken', 'Huhn'],
  ['rooster', 'Hahn'],
  ['cow', 'Kuh'],
  ['crow', 'Krähe'],
  ['silence', 'Stille'],
] as const;

/** Dieselbe Tontabelle als Nachschlagewerk. */
export const TON_TEXT: ReadonlyMap<string, string> = new Map(TON_PAARE);

/** Ein Wort uebersetzen — unbekannte bleiben stehen (s. WORT_PAARE). */
export function uebersetzeWort(wort: string): string {
  return WORT_TEXT.get(wort) ?? wort;
}

/** Ein Wort im Ton-Zusammenhang uebersetzen (s. TON_PAARE). */
export function uebersetzeTonWort(wort: string): string {
  return TON_TEXT.get(wort) ?? WORT_TEXT.get(wort) ?? wort;
}

/**
 * Kennzeichen aus dem Dateinamen — quer zur Hierarchie.
 *
 * Sie sind kein Ersatz fuer die Untergruppe, sondern die Antwort auf
 * „welche VARIANTE ist das?". `bush-1a2-small-1-snow` steht unter
 * Vegetation/Buesche und traegt „Schnee"; ohne das Kennzeichen faende
 * man die Schneefassungen nur, indem man alle Buesche durchklickt.
 */
/**
 * Erkennt eine Kollisionsdatei am Namen.
 *
 * Gemessen von der Messprobe (design/store-konventionen.md): Zwoelf GLBs
 * im Speicher sind reine Kollisionsnetze `<modell>-collision.glb`, und
 * `prefabs.json` verweist auf ganze DREI davon — neun sind verwaist. Wer
 * sie fuer Modelle haelt, sieht im Katalog neun graue Kaesten und weiss
 * nicht, warum. Das Muster ist bewusst weiter als `-collision`: die
 * Kurzform `_col` kommt in denselben Exporten vor.
 */
export const KOLLISIONS_MUSTER = /(^|[-_])col(lision)?([-_.]|$)/i;

/** Ist diese Datei ein reines Kollisionsnetz? */
export function istKollisionsnetz(basisOderPfad: string): boolean {
  return KOLLISIONS_MUSTER.test(basisOderPfad);
}

function kennzeichenAus(basis: string): string[] {
  const k: string[] = [];
  if (/-snow(-|$)/.test(basis)) k.push('Schnee');
  if (/-dark(-|$)/.test(basis)) k.push('Dunkel');
  if (istKollisionsnetz(basis)) k.push('Kollisionsnetz');
  if (/-lod\d*(-|$)/.test(basis)) k.push('LOD');
  if (/-dest(-|$)|destructible/.test(basis)) k.push('Zerstörbar');
  if (/broken/.test(basis)) k.push('Kaputt');
  if (/preset/.test(basis)) k.push('Vorlage');
  if (/optimized/.test(basis)) k.push('Optimiert');
  return k;
}

/** Dateiendung abschneiden. */
function ohneEndung(datei: string): string {
  const p = datei.lastIndexOf('.');
  return p > 0 ? datei.slice(0, p) : datei;
}

/** Erstes Wort eines Bindestrich-Namens (`grass-01` → `grass`). */
function erstesWort(basis: string): string {
  return basis.split('-')[0] ?? basis;
}

/**
 * Untergruppe der Vegetation.
 *
 * Reihenfolge ist hier die ganze Regel: `large-bush-1a1` traegt sowohl
 * „large" (laut Vorgabe ein Baum-Wort) als auch „bush". Buesche werden
 * deshalb ZUERST gefragt, Baeume danach — sonst landete jeder grosse
 * Busch unter den Baeumen, und zwar lautlos.
 */
function vegetationsUntergruppe(basis: string): string {
  if (/bush/.test(basis)) return 'Büsche';
  if (/^pine/.test(basis)) return 'Nadelbäume';
  if (/tree/.test(basis)) return 'Bäume';
  if (/grass/.test(basis)) return 'Gras';
  if (/mushroom/.test(basis)) return 'Pilze';
  if (/^branch/.test(basis)) return 'Äste';
  if (/^small/.test(basis)) return 'Büsche';
  if (/^large/.test(basis)) return 'Bäume';
  return 'Sonstige';
}

/** Gruppenname zum Typkuerzel des Namens (`sm-<typ>-…`). */
const TYP_GRUPPE: Readonly<Record<string, string>> = {
  bld: 'Gebäude',
  prop: 'Requisiten',
  item: 'Gegenstände',
  env: 'Umgebung',
  veh: 'Fahrzeuge',
};

/** Gruppenname zur Prefab-Kategorie, wenn der Name nichts hergibt. */
const KATEGORIE_GRUPPE: Readonly<Record<string, string>> = {
  prop: 'Requisiten',
  environment: 'Umgebung',
  vegetation: 'Vegetation',
};

/**
 * Die Einsortierungsregel.
 *
 * Sie liest NUR den Pfad, die Sorte und (wo vorhanden) die
 * Prefab-Kategorie. Kein Netz, kein Zustand — dieselbe Eingabe liefert
 * immer dieselbe Ausgabe, und genau das macht sie zaehlbar.
 *
 * Die Reihenfolge der Zweige ist die Regel: Ton und Texturen haengen an
 * der Sorte, Hoehenfelder und Kulisse an Ordner bzw. Namen, alles
 * Uebrige ist ein Modell. Waere „Modelle" der erste Zweig, verschwaenden
 * Kulissen darin — sie sind Meshes wie jedes andere.
 */
export function einsortieren(eintrag: StoreRoheintrag): Einordnung {
  const platzhalter = eintrag.path.startsWith('placeholders/');
  /*
    Platzhalter werden auf ihren ECHTEN Pfad zurueckgerechnet und danach
    ganz normal einsortiert. Sonst braeuchte die Regel einen zweiten,
    parallelen Satz Zweige fuer `placeholders/…`, und der waere von Hand
    synchron zu halten — die zuverlaessigste Art, eine Regel auseinander
    laufen zu lassen. Dass es ein Platzhalter ist, sagt das Kennzeichen.
  */
  const pfad = platzhalter ? eintrag.path.slice('placeholders/'.length) : eintrag.path;
  const teile = pfad.split('/');
  const datei = teile[teile.length - 1] ?? pfad;
  const basis = ohneEndung(datei).toLowerCase();
  const ordner = teile.slice(0, -1).map((t) => t.toLowerCase());
  const kennzeichen = kennzeichenAus(basis);
  if (platzhalter) kennzeichen.push('Platzhalter');

  // ── Ton ────────────────────────────────────────────────────────────
  if (eintrag.kind === 'audio' || ordner[0] === 'audio') {
    const fach = ordner[1] ?? '';
    const gruppe =
      fach === 'footsteps'
        ? 'Schritte'
        : fach === 'animals'
          ? 'Tiere'
          : fach === 'ambience'
            ? 'Umgebungston'
            : 'Quellen';
    return { art: 'Ton', gruppe, untergruppe: uebersetzeTonWort(erstesWort(basis)), kennzeichen };
  }

  // ── Texturen ───────────────────────────────────────────────────────
  if (eintrag.kind === 'texture') {
    if (pfad.startsWith('textures/terrain-')) {
      // `terrain-rock-a-normal` → Untergruppe „Felsen", Kennzeichen „Normalkarte".
      const rest = basis.slice('terrain-'.length);
      if (/-normal(-|$)/.test(rest)) kennzeichen.push('Normalkarte');
      return {
        art: 'Texturen',
        gruppe: 'Boden-Texturen',
        untergruppe: uebersetzeWort(erstesWort(rest)),
        kennzeichen,
      };
    }
    /*
      Alles uebrige Bild ist eine MODELL-Textur: die Atlanten neben den
      GLBs (`environment/textures/`, `vegetation/textures/`, das
      Kenney-Kit) und die zwei Mischkarten des Dorfes. Die Vorgabe nennt
      als Boden-Texturen ausdruecklich nur `textures/terrain-*`; die
      Mischkarten bekommen deshalb ihre eigene Untergruppe statt einer
      eigenen Gruppe — sonst waere diese Regel eine andere als die des
      shared-Katalogs, und der Zusammenbau spaeter eine Handarbeit.
    */
    if (basis.startsWith('village-splat')) {
      return { art: 'Texturen', gruppe: 'Modell-Texturen', untergruppe: 'Mischkarten', kennzeichen };
    }
    /*
      Untergruppe ist der Ordner UEBER `textures/` — bei den beiden
      Hausatlanten also „Umgebung" bzw. „Vegetation", beim eingelagerten
      Fremdkit dessen Name. Das ist genau die Sortierung, nach der man
      hier sucht: „welche Texturen gehoeren zu den Baeumen?", nicht
      „welche Dateien liegen in einem Ordner namens textures".
    */
    const vorTextures = ordner.lastIndexOf('textures');
    const fach = vorTextures > 0 ? (ordner[vorTextures - 1] ?? '') : (ordner[0] ?? '');
    const untergruppe =
      fach === 'vegetation'
        ? 'Vegetation'
        : fach === 'environment'
          ? 'Umgebung'
          : fach
            ? namenAusDatei(fach)
            : 'Sonstige';
    return { art: 'Texturen', gruppe: 'Modell-Texturen', untergruppe, kennzeichen };
  }

  // ── Hoehenfelder ───────────────────────────────────────────────────
  if (eintrag.kind === 'terrain' || ordner[0] === 'terrain' || eintrag.category === 'terrain') {
    const untergruppe = /^terrainl\d+$/.test(basis)
      ? 'Stufen'
      : basis.startsWith('terrain-village')
        ? 'Dorf'
        : 'Prüfstände';
    // Gelaendekacheln sind bis 200 m gross und gehoeren dem Generator, nicht
    // dem Weltbau-Werkzeug — sie stehen im Katalog zum ANSEHEN.
    kennzeichen.push('nicht platzierbar');
    return { art: 'Höhenfelder', gruppe: 'Höhenfelder', untergruppe, kennzeichen };
  }

  // ── Kulisse ────────────────────────────────────────────────────────
  /*
    Die Wolken heissen `sm-prop-cloud-…` und waeren nach dem Namen
    Requisiten. `prefabs.json` fuehrt sie als `backdrop`, und das ist die
    richtige Auskunft: Sie stehen am Horizont, nicht im Dorf. Der
    Namenszweig steht trotzdem daneben, damit die Regel ohne
    `prefabs.json` dasselbe Ergebnis liefert — der Test faehrt sie ueber
    das blosse Manifest.
  */
  if (eintrag.category === 'backdrop' || basis.startsWith('backdrop') || /^sm-prop-cloud-/.test(basis)) {
    const untergruppe = /cloud/.test(basis)
      ? 'Wolken'
      : /sky/.test(basis)
        ? 'Himmel'
        : /mountain/.test(basis)
          ? 'Berge'
          : 'Sonstige';
    // Bis 594 m Spannweite (Messprobe): Kulissen haengen am Horizont der
    // Szene, sie werden nicht auf die Karte gesetzt.
    kennzeichen.push('nicht platzierbar');
    return { art: 'Kulisse', gruppe: 'Kulisse', untergruppe, kennzeichen };
  }

  // ── Modelle ────────────────────────────────────────────────────────
  if (ordner[0] === 'vegetation' || eintrag.category === 'vegetation') {
    return { art: 'Modelle', gruppe: 'Vegetation', untergruppe: vegetationsUntergruppe(basis), kennzeichen };
  }

  /*
    Kollisionsnetze bleiben in IHRER Gruppe (ein Bootshaus-Netz ist ein
    Gebaeude), bekommen aber eine eigene Untergruppe. Sonst stehen sie
    zwischen den Haeusern und sehen aus wie welche — nur ohne Textur und
    ohne Dach. Neun der zwoelf sind ausserdem verwaist: Kein Prefab zeigt
    auf sie (Messprobe), sie waeren also im Katalog nicht einmal ueber ihr
    Hauptmodell erklaerbar.
  */
  const netz = istKollisionsnetz(basis);
  const namensteile = /^sm-([a-z]+)-([a-z0-9]+)/.exec(basis);
  const typ = namensteile?.[1] ?? '';
  const gruppeAusTyp = TYP_GRUPPE[typ];
  if (gruppeAusTyp && namensteile) {
    return {
      art: 'Modelle',
      gruppe: gruppeAusTyp,
      untergruppe: netz ? 'Kollisionsnetze' : uebersetzeWort(namensteile[2]!),
      kennzeichen,
    };
  }

  /*
    Ohne `sm-<typ>-`-Vorsilbe bleibt der Rest: die Handvoll Altnamen
    (`floor`, `chestbottom`, `barrel-destructible`), das eingelagerte
    Kenney-Kit und `roof-sm-bld-preset-shelter-02` — bei dem die Vorsilbe
    MITTEN im Namen steht. Fuer den letzten Fall wird sie dort gesucht;
    fuer alle anderen entscheidet die Kategorie aus `prefabs.json`, und
    erst wenn auch die fehlt, „Umgebung".
  */
  const mitten = /-sm-(bld|prop|item|env|veh)-/.exec(basis);
  if (mitten) {
    return { art: 'Modelle', gruppe: TYP_GRUPPE[mitten[1]!]!, untergruppe: uebersetzeWort(erstesWort(basis)), kennzeichen };
  }
  if (/tree/.test(basis)) {
    return { art: 'Modelle', gruppe: 'Vegetation', untergruppe: vegetationsUntergruppe(basis), kennzeichen };
  }
  const gruppe = (eintrag.category && KATEGORIE_GRUPPE[eintrag.category]) || 'Umgebung';
  return { art: 'Modelle', gruppe, untergruppe: uebersetzeWort(erstesWort(basis)), kennzeichen };
}

// ── Aus den zwei JSON-Dateien einen Katalog bauen ─────────────────────

/** Manifest-Datei, so weit dieses Modul sie liest. */
export interface ManifestDatei {
  assets: ReadonlyArray<{
    id: string;
    path: string;
    kind: StoreSorte;
    bytes: number;
    hash: string;
    bounds?: StoreHuelle;
    origin?: string;
    license?: string;
    redistributable?: boolean;
    visibility?: string;
  }>;
}

/** Prefab-Katalog, so weit dieses Modul ihn liest. */
export interface PrefabDatei {
  prefabs: ReadonlyArray<{
    id: string;
    name: string;
    asset: string;
    category: PrefabKategorie;
    bounds?: StoreHuelle;
    collision?: { kind: Kollisionsart };
  }>;
}

/**
 * Lizenzlage in einem Satz.
 *
 * Die drei Rohfelder (`license`, `redistributable`, `visibility`) sagen
 * einzeln wenig und stehen im Manifest als Fliesstext neben Herkunft und
 * Autor. Im Katalog braucht man EINE Auskunft: Darf das hier raus oder
 * nicht? Alles andere steht weiterhin im Manifest.
 */
export function lizenzstatus(a: { license?: string; redistributable?: boolean; visibility?: string }): string {
  if (a.redistributable === true && a.visibility === 'public') {
    return `frei weitergebbar (${a.license ?? 'ohne Angabe'})`;
  }
  return 'privat — Lizenzprüfung offen';
}

/** Aus `sm-prop-barrel-01` wird „Sm Prop Barrel 01" — nur, wenn nichts Besseres da ist. */
function namenAusDatei(pfad: string): string {
  const datei = pfad.split('/').pop() ?? pfad;
  return ohneEndung(datei)
    .split(/[-_]/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Katalog aus Manifest und Prefab-Datei — rein, ohne Netz.
 *
 * Platzhalter-Eintraege (`placeholders/…`) fliegen hier RAUS: Sie
 * beschreiben keine Datei des Speichers, sondern den Ersatz, den der
 * Import fuer eine fehlende einsetzt. Der Katalog zeigt den Bestand.
 * `einsortieren` kennt sie trotzdem — der Test faehrt alle 1255
 * Manifest-Eintraege, und eine Regel, die bei einem Sechstel ihrer
 * moeglichen Eingaben wirft, ist keine.
 */
export function baueStoreKatalog(manifest: ManifestDatei, prefabs: PrefabDatei | null): StoreEintrag[] {
  const nachPfad = new Map<string, PrefabDatei['prefabs'][number]>();
  for (const p of prefabs?.prefabs ?? []) nachPfad.set(p.asset, p);

  const eintraege: StoreEintrag[] = [];
  for (const a of manifest.assets) {
    if (a.path.startsWith('placeholders/')) continue;
    const prefab = nachPfad.get(a.path) ?? null;
    const ord = einsortieren({ id: a.id, path: a.path, kind: a.kind, category: prefab?.category ?? null });
    eintraege.push({
      id: a.id,
      pfad: a.path,
      art: ord.art,
      gruppe: ord.gruppe,
      untergruppe: ord.untergruppe,
      kennzeichen: ord.kennzeichen,
      name: prefab?.name ?? namenAusDatei(a.path),
      bytes: a.bytes,
      hash: a.hash,
      bounds: a.bounds ?? prefab?.bounds,
      kollision: prefab?.collision?.kind,
      lizenzstatus: lizenzstatus(a),
      prefabName: prefab?.id,
      herkunft: a.origin,
      platzhalter: false,
    });
  }
  /*
    Jedem Hauptmodell seine Kollisionsdatei zuordnen.

    `prefabs.json` taete das nur fuer drei von zwoelf (Messprobe) — die
    Zuordnung ueber den DATEINAMEN erwischt alle. Sie steht danach im
    Infoblock des Hauptmodells: „dieses Haus bringt ein eigenes
    Kollisionsnetz mit" ist beim Weltbau eine andere Auskunft als „dieses
    Haus hat einen Quader".
  */
  const netze = new Map<string, string>();
  for (const e of eintraege) {
    if (!e.kennzeichen.includes('Kollisionsnetz')) continue;
    const stamm = e.pfad.replace(/[-_]col(lision)?\.glb$/i, '.glb');
    if (stamm !== e.pfad) netze.set(stamm, e.pfad);
  }
  for (const e of eintraege) {
    const netz = netze.get(e.pfad);
    if (netz) e.kollisionsdatei = netz;
  }

  eintraege.sort((x, y) => x.id.localeCompare(y.id, 'de'));
  return eintraege;
}

// ── Bedienung: Gruppen, Untergruppen, Suche ───────────────────────────

/** Eine Gruppe mit ihrer Zahl — die Marken der zweiten Ebene tragen sie. */
export interface Gruppenzahl {
  name: string;
  anzahl: number;
}

/** Gruppen einer Art, nach Haeufigkeit sortiert (die grosse Kiste zuerst). */
export function gruppenDerArt(eintraege: readonly StoreEintrag[], art: StoreArt): Gruppenzahl[] {
  const zahl = new Map<string, number>();
  for (const e of eintraege) {
    if (e.art !== art) continue;
    zahl.set(e.gruppe, (zahl.get(e.gruppe) ?? 0) + 1);
  }
  return [...zahl.entries()]
    .map(([name, anzahl]) => ({ name, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de'));
}

/** Untergruppen einer Gruppe, alphabetisch — sie sind die Filtermarken. */
export function untergruppenDerGruppe(
  eintraege: readonly StoreEintrag[],
  art: StoreArt,
  gruppe: string
): Gruppenzahl[] {
  const zahl = new Map<string, number>();
  for (const e of eintraege) {
    if (e.art !== art || e.gruppe !== gruppe) continue;
    zahl.set(e.untergruppe, (zahl.get(e.untergruppe) ?? 0) + 1);
  }
  return [...zahl.entries()]
    .map(([name, anzahl]) => ({ name, anzahl }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Suche ueber Id, Name, Gruppe, Untergruppe und Kennzeichen.
 *
 * Gruppe und Untergruppe stehen bewusst MIT im Heuhaufen: „felsen"
 * findet damit alle 30 Felsen, ohne dass man weiss, dass sie im Speicher
 * `sm-env-rock-…` heissen. Genau diese Uebersetzung ist der Zweck der
 * Einsortierung — sie nur zum Anzeigen zu benutzen, waere die halbe
 * Miete.
 */
export function sucheSpeicher(eintraege: readonly StoreEintrag[], text: string): StoreEintrag[] {
  const n = text.trim().toLowerCase();
  if (!n) return [...eintraege];
  return eintraege.filter(
    (e) =>
      e.id.toLowerCase().includes(n) ||
      e.name.toLowerCase().includes(n) ||
      e.gruppe.toLowerCase().includes(n) ||
      e.untergruppe.toLowerCase().includes(n) ||
      e.kennzeichen.some((k) => k.toLowerCase().includes(n))
  );
}

// ── Laden (Browser) ───────────────────────────────────────────────────

/** Wurzel des Speichers im Dev-Server (vite liefert `assets/` unter `/assets/`). */
export const SPEICHER_WURZEL = '/assets/store/';

/**
 * Der Katalog, EINMAL geladen.
 *
 * Gemerkt wird das Versprechen, nicht das Ergebnis: Zwei Klicks kurz
 * hintereinander (Art wechseln, tippen) fragen sonst zweimal ein 92-kB-
 * Manifest an, und der zweite Ruf saehe den Zwischenspeicher des ersten
 * noch leer.
 */
let geladen: Promise<StoreEintrag[]> | null = null;

export async function ladeStoreKatalog(wurzel = SPEICHER_WURZEL): Promise<StoreEintrag[]> {
  if (!geladen) {
    geladen = (async () => {
      const [manifestAntwort, prefabAntwort] = await Promise.all([
        fetch(`${wurzel}manifest.json`),
        fetch(`${wurzel}prefabs.json`),
      ]);
      if (!manifestAntwort.ok) {
        throw new Error(`manifest.json nicht erreichbar (${manifestAntwort.status})`);
      }
      const manifest = (await manifestAntwort.json()) as ManifestDatei;
      /*
        `prefabs.json` ist ERGAENZUNG, nicht Voraussetzung: Es liefert
        Kategorie, Kollisionsart und den lesbaren Namen. Fehlt es, steht
        der Katalog trotzdem — mit Namen aus dem Dateinamen und ohne
        Kollisionsangabe. Ein Katalog, der an der Nebendatei stirbt,
        waere die schlechtere Antwort auf „was liegt im Speicher?".
      */
      const prefabs = prefabAntwort.ok ? ((await prefabAntwort.json()) as PrefabDatei) : null;
      return baueStoreKatalog(manifest, prefabs);
    })();
    geladen.catch(() => {
      // Ein Fehlschlag darf nicht dauerhaft werden — sonst bliebe der
      // Katalog fuer den Rest der Sitzung leer, auch wenn der Server
      // eine Sekunde spaeter wieder antwortet.
      geladen = null;
    });
  }
  return geladen;
}

/** Nur fuer Tests: den Zwischenspeicher vergessen. */
export function speicherVergessen(): void {
  geladen = null;
}
