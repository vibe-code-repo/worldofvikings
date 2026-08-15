/**
 * ── NPC-Einordnung: Fraktion, Rolle, Quest-Zustand ───────────────────
 *
 * Diese Datei ist bewusst NUR Datenmodell — keine Logik, die Schaden
 * rechnet, keine UI. Server (Verhalten), Client (Namensschild) und
 * Editor (Einstellen) lesen dieselben Begriffe von hier.
 *
 * ENTWURFSENTSCHEIDUNG: Ob ein NPC angreift, wird NICHT je NPC gesetzt.
 * Es ergibt sich aus dem Verhältnis seiner Fraktion zur Fraktion des
 * Gegenübers (`haltungZwischen`). Ein Feld „feindlich: ja/nein" am
 * einzelnen NPC wäre der naheliegende, aber falsche Weg: Sobald es
 * Fraktionen gibt, müsste man bei jeder Änderung des Weltzustands jeden
 * einzelnen NPC nachpflegen, und Sachse gegen Wikinger wäre nicht
 * dasselbe wie Sachse gegen Wolf. Die Beziehung gehört zwischen die
 * Fraktionen, nicht an das Exemplar.
 *
 * Die ROLLE sagt dagegen, wofür ein NPC überhaupt da ist — sie steuert,
 * was das Namensschild zeigt und was ein Klick anbietet. Ein Monster
 * kann keiner Quest-Geber sein, auch wenn seine Fraktion neutral wird.
 */

/**
 * Fraktionen der Welt. `wild` sind Tiere und Untiere ohne Volk,
 * `muspel` die Feuerwesen um Surtr. Die Liste wächst — deshalb wird
 * überall gegen diesen Typ geprüft und nirgends gegen Zeichenketten.
 */
export const FRAKTIONEN = [
  'neutral',
  'wikinger',
  'sachsen',
  'wild',
  'muspel',
  'furlocs',
] as const;
export type Fraktion = (typeof FRAKTIONEN)[number];

/** Wofür ein NPC da ist. Steuert Namensschild und Interaktion. */
export const NPC_ROLLEN = ['zivil', 'quest', 'haendler', 'monster'] as const;
export type NpcRolle = (typeof NPC_ROLLEN)[number];

/**
 * Quest-Zustand aus SICHT DES BETRACHTERS.
 *
 * Es gibt noch kein Quest-System. Bis es eines gibt, kommt der Wert aus
 * dem Editor und gilt für alle Spieler gleich. Der Rest des Codes fragt
 * ausschliesslich über `questZeichen()` — wenn echte Quests kommen,
 * wird dort der Spielerfortschritt eingesetzt und sonst nichts
 * angefasst. Das ist die Naht, an der das später aufgeht.
 */
export const QUEST_ZUSTAENDE = ['keine', 'verfuegbar', 'laeuft', 'fertig'] as const;
export type QuestZustand = (typeof QUEST_ZUSTAENDE)[number];

/** Haltung eines NPC gegenüber einem Betrachter. */
export type Haltung = 'freundlich' | 'neutral' | 'feindlich';

/**
 * Beziehungen zwischen den Fraktionen. Nur die feindlichen und
 * freundlichen Paare stehen hier; alles Ungenannte ist neutral.
 * Symmetrisch gelesen — `haltungZwischen` prüft beide Richtungen.
 */
const FEINDLICH: ReadonlyArray<readonly [Fraktion, Fraktion]> = [
  ['wikinger', 'sachsen'],
  ['wikinger', 'muspel'],
  ['sachsen', 'muspel'],
  ['wikinger', 'wild'],
  ['sachsen', 'wild'],
  // Die Furlocs sind ein Sumpf- und Küstenvolk. Gegen Muspel standen sie
  // von Anfang an; das Verhältnis zu den Wikingern war lange offen und ist
  // jetzt entschieden: FEINDLICH. Das Fischervolk duldet keine Fremden an
  // seinen Küsten.
  //
  // Diese beiden Zeilen sind alles, was dafür nötig war — an den sieben
  // Furloc-NPCs musste nichts nachgepflegt werden. Genau darum hängt die
  // Haltung zwischen den FRAKTIONEN und nicht am Exemplar.
  //
  // Zu den Sachsen bleiben sie neutral: Die beiden Völker sind sich in der
  // Welt noch nie begegnet, und neutral ist weiterhin die ehrliche Antwort
  // auf „wissen wir noch nicht".
  ['furlocs', 'muspel'],
  ['furlocs', 'wikinger'],
];

/**
 * Haltung von `wer` gegenüber `zu`.
 *
 * `neutral` als Fraktion heisst „mischt sich nicht ein" — neutrale
 * Wesen sind zu niemandem feindlich, auch nicht zu ihren Feinden.
 * Gleiche Fraktion ist immer freundlich, auch `wild` zu `wild`:
 * Wölfe fallen nicht übereinander her.
 */
export function haltungZwischen(wer: Fraktion, zu: Fraktion): Haltung {
  if (wer === zu) return 'freundlich';
  if (wer === 'neutral' || zu === 'neutral') return 'neutral';
  const feind = FEINDLICH.some(
    ([a, b]) => (a === wer && b === zu) || (a === zu && b === wer),
  );
  return feind ? 'feindlich' : 'neutral';
}

/** Einstellungen, die ein einzelner NPC mitbringt. Alles optional — */
/** was fehlt, kommt aus den Vorgaben des Prefabs. */
export interface NpcDef {
  /** Anzeigename im Namensschild. Leer = Prefab-Name. */
  readonly name?: string;
  readonly rolle?: NpcRolle;
  readonly fraktion?: Fraktion;
  /** Stufe, wie in der Klammer hinter dem Namen. 1–99. */
  readonly stufe?: number;
  /** Nur sinnvoll bei Rolle `quest`. */
  readonly quest?: QuestZustand;
}

/** Grenzen des Anzeigenamens — geteilt von Sanitizer und Editor-Feld. */
export const NPC_NAME_MAX = 32;
/** Stufenbereich, wie in `NpcDef.stufe` beschrieben. */
export const NPC_STUFE_MIN = 1;
export const NPC_STUFE_MAX = 99;

/** Gehört der Wert zur jeweiligen Liste? Für Sanitizer und Editor. */
export function istFraktion(v: unknown): v is Fraktion {
  return typeof v === 'string' && (FRAKTIONEN as readonly string[]).includes(v);
}
export function istNpcRolle(v: unknown): v is NpcRolle {
  return typeof v === 'string' && (NPC_ROLLEN as readonly string[]).includes(v);
}
export function istQuestZustand(v: unknown): v is QuestZustand {
  return typeof v === 'string' && (QUEST_ZUSTAENDE as readonly string[]).includes(v);
}

/** Vollständig aufgelöste Einordnung — nichts mehr optional. */
export interface NpcEinordnung {
  readonly name: string;
  readonly rolle: NpcRolle;
  readonly fraktion: Fraktion;
  readonly stufe: number;
  readonly quest: QuestZustand;
}

/**
 * Das Zeichen über dem Kopf, oder null.
 *
 * `?` = hier gibt es etwas zu holen, `!` = hier ist etwas abzugeben.
 * Das ist bewusst HERUM WIE IN WOW und nicht andersherum: Spieler
 * bringen diese Zuordnung mit, und eine eigene Konvention kostet nur
 * Verwirrung.
 *
 * Eine laufende Quest zeigt nichts — sonst stünde über dem halben Dorf
 * ein Zeichen, und die beiden, die zählen, gingen darin unter.
 */
export function questZeichen(e: NpcEinordnung): '?' | '!' | null {
  if (e.rolle !== 'quest') return null;
  if (e.quest === 'verfuegbar') return '?';
  if (e.quest === 'fertig') return '!';
  return null;
}

/**
 * ── Vorgaben je Prefab ───────────────────────────────────────────────
 *
 * Was ein Surtr IST, hängt am Prefab und nicht an der einzelnen
 * Platzierung: Niemand stellt einen freundlichen Feuerriesen auf, und
 * hätte jede Platzierung ihre eigene Angabe, müsste man bei einer
 * Weltänderung alle 158 Einträge nachpflegen — dieselbe Überlegung wie
 * oben bei „feindlich: ja/nein".
 *
 * WARUM HIER und nicht in `prefabs.ts`: Dort stehen RENDER-Hinweise
 * (Sprite, GLB, Platzhaltergröße, Licht) — das Datenmodell des NPC ist
 * etwas anderes und würde zwischen 3.700 aus prefabData.json erzeugten
 * Einträgen verschwinden. Diese Datei ist ausserdem abhängigkeitsfrei:
 * Sanitizer, Editor und Namensschild lesen sie, ohne die ganze Registry
 * (samt prefabData.json, ~2 MB) mitzuziehen. Der Schlüssel ist der
 * Prefab-NAME, also genau das, was `PlacementDef.prefab` trägt.
 *
 * Ein Eintrag hier ist zugleich die Antwort auf „ist das ein NPC?" —
 * `istNpcPrefab` prüft nichts anderes. Neue Figuren gehören hier
 * ergänzt, sonst zeigt der Editor ihre Felder nicht an.
 */
export const NPC_VORGABEN: ReadonlyMap<string, NpcDef> = new Map<string, NpcDef>([
  // Der Feuerriese aus Muspelheim — Rolle und Fraktion sind sein Wesen.
  ['Surtr', { name: 'Surtr', rolle: 'monster', fraktion: 'muspel' }],
  // Seherin der Sagen, als Auftraggeberin gedacht. Der Quest-Zustand
  // bleibt bewusst `keine`: Das Zeichen über dem Kopf setzt der Designer
  // je Platzierung, sonst stünde über JEDER Völva ein „?".
  ['Voelva', { name: 'Völva', rolle: 'quest', fraktion: 'wikinger' }],
  // Das allgemeine Dorfvolk (assets/models/npc_1_walk.glb).
  ['NPC_1', { name: 'Dorfbewohner', rolle: 'zivil', fraktion: 'wikinger' }],
  // Krötenartiges Fischervolk mit Dreizack, Reusenkorb und Strohhut
  // (Meshy-Modell, assets/models/FurlocFischer.glb). Rolle `zivil`, weil er
  // ein Fischer ist — die Stech-Animation macht ihn nicht zum Monster,
  // sondern wehrhaft. Wer einen feindlichen Furloc will, stellt die Rolle
  // je Platzierung im Editor um.
  ['FurlocFischer', { name: 'Furloc-Fischer', rolle: 'zivil', fraktion: 'furlocs' }],
  // Das übrige Furloc-Volk (dieselbe Meshy-Reihe, geriggt mit
  // tools/furloc-volk-rig.py). Die Rollen sind nicht Geschmack, sondern
  // folgen aus dem, WOFÜR die Figur da ist:
  //
  // Der Häuptling führt — also `quest`: Wer im Dorf einen Auftrag vergibt,
  // ist er. Der Quest-Zustand bleibt wie bei der Völva bewusst `keine`,
  // sonst stünde über JEDEM Häuptling ein „?".
  ['FurlocHaeuptling', { name: 'Furloc-Häuptling', rolle: 'quest', fraktion: 'furlocs' }],
  // Der Schamane trägt Kräuterbeutel und Trankfläschchen am Gürtel — als
  // Händler ist er dort richtig, wo es später Tränke zu kaufen gibt.
  ['FurlocSchamane', { name: 'Furloc-Schamane', rolle: 'haendler', fraktion: 'furlocs' }],
  // Ältester und Kind sind `zivil`. Beide haben zwar eine Angriffs-
  // animation (der Älteste stösst mit dem Stab, das Kind fuchtelt mit
  // seinem Holzschwert), aber eine Animation macht noch keine Rolle: Was
  // sie IM SPIEL sind, ist Dorfvolk.
  ['FurlocAeltester', { name: 'Furloc-Ältester', rolle: 'zivil', fraktion: 'furlocs' }],
  ['FurlocKind', { name: 'Furloc-Kind', rolle: 'zivil', fraktion: 'furlocs' }],
  // Der Krieger ist das einzige `monster` der Reihe. Das heisst nicht,
  // dass er jeden angreift — ob er das tut, entscheidet allein
  // `haltungZwischen` über die Fraktion `furlocs`, und die steht bislang
  // nur gegen Muspel. Es heisst, dass ein Klick auf ihn kein Gespräch
  // anbietet: Er bewacht, er handelt nicht und er vergibt keine Aufträge.
  ['FurlocKrieger', { name: 'Furloc-Krieger', rolle: 'monster', fraktion: 'furlocs' }],
  // Der nackte Basis-Wikinger (assets/models/WikingerBasis.glb) — der
  // Körper, auf dem Charaktererstellung und Rüstung aufsetzen. Als NPC
  // gespawnt vor allem zum Ansehen und Prüfen: An ihm lässt sich im Spiel
  // messen, ob Grösse, Sohlenlage und Gang stimmen, ohne den
  // Spielercharakter anzufassen.
  ['WikingerBasis', { name: 'Wikinger', rolle: 'zivil', fraktion: 'wikinger' }],
]);

/** Vorgabe des Prefabs, oder undefined für alles, was kein NPC ist. */
export function npcVorgabe(prefab: string): NpcDef | undefined {
  return NPC_VORGABEN.get(prefab);
}

/**
 * ── Reichweiten für Aggro und Angriff ────────────────────────────────
 *
 * Auch das ist NUR Datenmodell: Ab welcher Entfernung ein NPC den Spieler
 * bemerkt und ab welcher er zuschlägt. OB er das tut, steht hier
 * ausdrücklich nicht — das ergibt sich aus `haltungZwischen`, genau wie
 * oben beim „feindlich: ja/nein".
 *
 * Die Zahlen hängen an der GRÖSSE der Figur, nicht am Geschmack: Surtr
 * ist neun Meter hoch, sein Schwert allein misst gut drei. Gäbe man ihm
 * die Reichweite eines Menschen, müsste der Spieler ihm zwischen die Füße
 * laufen, bevor er ausholt; und ein Riese, der einen erst auf zwei Meter
 * bemerkt, wirkt blind. Als Faustregel: Angriffsreichweite ≈ Körperhöhe,
 * Aggroradius ≈ das Dreifache davon.
 */
export interface NpcKampf {
  /** Ab hier dreht der NPC sich zum Spieler (Meter). */
  readonly aggro: number;
  /** Ab hier schlägt er zu (Meter). */
  readonly angriff: number;
  /**
   * Tempo beim NACHSETZEN in m/s (s. `aggroSchritt`).
   *
   * Die Zahl ist keine Geschmacksfrage, sondern die Geschwindigkeit, für
   * die der Gehzyklus der Figur GEBAUT wurde: `furloc-volk-rig.py` und
   * `surtr-rig.py` leiten ihre Schrittweite aus `TEMPO` = 1,5 m/s ab
   * (ROUTE_DEFAULT_SPEED). Wer hier eine andere Zahl einträgt, bekommt
   * genau die Differenz als schleifenden Fuss.
   */
  readonly tempo: number;
}

/**
 * Für alles ohne eigenen Eintrag — bewusst klein. Ein NPC, dessen Maße
 * niemand nachgemessen hat, soll niemanden aus dem Nichts angreifen.
 */
export const NPC_KAMPF_VORGABE: NpcKampf = { aggro: 12, angriff: 2.5, tempo: 1.5 };

export const NPC_KAMPF: ReadonlyMap<string, NpcKampf> = new Map<string, NpcKampf>([
  // Neun Meter hoch, Klinge gut drei Meter lang: Er trifft weit und
  // sieht weit. 30 m sind knapp die Sichtweite, auf die man ihn im Gelände
  // überhaupt zuerst bemerkt — er soll nicht erst reagieren, wenn man ihm
  // schon vor den Zehen steht.
  ['Surtr', { aggro: 30, angriff: 9, tempo: 1.5 }],
  // Kleiner Fischer mit Dreizack: Der Stich reicht gut zwei Körperlängen,
  // aber er lauert niemandem auf.
  ['FurlocFischer', { aggro: 14, angriff: 3.5, tempo: 1.5 }],
  // Das übrige Furloc-Volk. Die Faustregel von oben (Angriff ≈ Körperhöhe,
  // Aggro ≈ das Dreifache) wird hier um die WAFFE ergänzt: Ein Speer
  // verlängert den Arm um mehr als eine Körperlänge, ein Holzschwert um
  // nichts.
  //
  // Krieger, 1,79 m, Speer von 1,9 m Länge: Er trifft aus gut zwei
  // Körperlängen und hält als Wache Ausschau, bevor jemand heran ist.
  ['FurlocKrieger', { aggro: 18, angriff: 4.0, tempo: 1.5 }],
  // Häuptling, 1,75 m, Stab: Er schlägt auf Stablänge zu, lauert aber
  // niemandem auf.
  ['FurlocHaeuptling', { aggro: 14, angriff: 3.0, tempo: 1.5 }],
  // Schamane, 1,63 m: Der Stab reicht kaum weiter als sein Arm, dafür
  // bemerkt er mehr als die anderen — das ist sein Beruf.
  ['FurlocSchamane', { aggro: 16, angriff: 2.6, tempo: 1.5 }],
  // Ältester, 1,60 m, gebeugt: Er sieht schlecht und trifft kurz.
  ['FurlocAeltester', { aggro: 9, angriff: 2.4, tempo: 1.5 }],
  // Kind, 1,05 m, Holzschwert. Beide Zahlen liegen bewusst UNTER der
  // Vorgabe (12 / 2,5): Ein Kind, das aus zwölf Metern auf einen zuläuft,
  // wäre kein Kind mehr, sondern ein Wachhund.
  ['FurlocKind', { aggro: 5, angriff: 1.2, tempo: 1.2 }],
]);

/** Kampfreichweiten eines Prefabs; nie undefined. */
export function npcKampf(prefab: string): NpcKampf {
  return NPC_KAMPF.get(prefab) ?? NPC_KAMPF_VORGABE;
}

/**
 * Fraktion, mit der ein SPIELER in der Welt steht.
 *
 * Es gibt noch keine Volkswahl bei der Charaktererstellung; bis es eine
 * gibt, ist jeder Spieler ein Wikinger. Diese eine Konstante ist die
 * Naht, an der das später aufgeht — der Server fragt nirgends sonst
 * danach.
 */
export const SPIELER_FRAKTION: Fraktion = 'wikinger';

/**
 * Ist dieses Prefab überhaupt eine Figur? Der Editor zeigt seine
 * NPC-Felder nur dann — bei Bäumen und Steinen verstopfen sie das Panel.
 */
export function istNpcPrefab(prefab: string): boolean {
  return NPC_VORGABEN.has(prefab);
}

/**
 * Prefab-Vorgabe + Platzierung → vollständige Einordnung.
 *
 * DIE EINZIGE Stelle, an der beides zusammenkommt — Server, Editor und
 * Namensschild rufen sie, statt selbst „def.rolle ?? vorgabe.rolle ??
 * 'zivil'" zu schreiben. Was an der Platzierung steht, schlägt die
 * Vorgabe; was nirgends steht, fällt auf den harmlosesten Wert zurück
 * (ziviler Neutraler auf Stufe 1, keine Quest).
 *
 * Rückgabe null heisst „das ist kein NPC": kein Vorgabe-Eintrag UND
 * keine Angabe an der Platzierung. Ein `npc`-Block an einem Baum
 * (Handarbeit im JSON) macht ihn dagegen bewusst zu einem — den Fall
 * still zu verschlucken wäre schwerer zu erklären als ihn zu erlauben.
 */
export function loeseNpcAuf(prefab: string, def?: NpcDef | null): NpcEinordnung | null {
  const vorgabe = NPC_VORGABEN.get(prefab);
  if (!vorgabe && !def) return null;
  return {
    name: def?.name ?? vorgabe?.name ?? prefab,
    rolle: def?.rolle ?? vorgabe?.rolle ?? 'zivil',
    fraktion: def?.fraktion ?? vorgabe?.fraktion ?? 'neutral',
    stufe: def?.stufe ?? vorgabe?.stufe ?? 1,
    quest: def?.quest ?? vorgabe?.quest ?? 'keine',
  };
}
