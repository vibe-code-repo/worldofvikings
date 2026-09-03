/**
 * LEGACY — wird nach Erfolg von Dungeon Generator 2.0 geloescht / will be
 * deleted once Dungeon Generator 2.0 succeeds. Prueft GLB-Bauteile, die es
 * im zellbasierten Bauer nicht mehr gibt. Konstanten und Herleitung (Raster
 * 4 m, Figurenmasse, Z-Fighting-Rechnung) wandern nach
 * `shared/src/dungeon2/layout.ts` (`ZELLE_M`, `EBENE_M`, `MIN_LICHTE_STUFEN`).
 * Siehe `LEGACY.md`.
 * Checks GLB parts that no longer exist under the cell-based builder. The
 * constants and their derivation (4 m grid, character measurements, the
 * z-fighting math) move to `shared/src/dungeon2/layout.ts`. See `LEGACY.md`.
 *
 * Rasterprüfung für eigene Dungeon-Bauteile.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Der Dungeon-Algorithmus setzt Räume über KOPPLUNG VON CONNECTORS, nicht
 * über Rasterschnappen. Das Feld `DungeonDef.gridSize` existiert zwar,
 * wird aber nirgends im Projekt ausgewertet (geprüft am 20.08.2026 per
 * grep über shared/ und server/ — der einzige Treffer ist die
 * Typdefinition selbst); es gehört zu den Camp-Algorithmen, die für
 * Dungeons nicht benutzt werden.
 *
 * Daraus folgt die unangenehme Eigenschaft, gegen die dieses Modul
 * gebaut ist: **Ein Bauteil, das sich nicht ans Raster hält, erzeugt
 * keinen Fehler.** Es passt einfach irgendwann nicht mehr zusammen, und
 * zwar erst dann, wenn genug Teile da sind, dass man die Ursache in der
 * falschen Ecke sucht. Beim ersten Bauteil sieht man so etwas von Hand,
 * beim zwanzigsten nicht mehr.
 *
 * ── Woher die Zahlen kommen ──────────────────────────────────────────
 * Aus drei unabhängigen Belegen, zusammengetragen am 20.08.2026
 * (Herleitung im Vault: „Konzept Dungeons und Instanzen“, Ebene 1):
 *
 *  1. Alle DREIZEHN geparsten Original-Kits deklarieren `gridSize 4` —
 *     SunkenCrypt, ForestCrypt, DvergrTown, Cave, GoblinCamp, ausnahmslos.
 *  2. Die Spielfigur passt dazu: BODY_RADIUS 0,4 m (0,8 m Schulterbreite),
 *     BODY_HEIGHT 1,8 m. Ein 4-m-Gang ist fünfmal Schulterbreite — zwei
 *     Spieler nebeneinander, Platz zum Ausholen. Bei 2 m wäre es ein Rohr.
 *  3. Die echten Raumgrößen im ForestCrypt-Kit sind durchweg gerade
 *     (Grundflächen 2/4/6/8/10/12/16/20 m, Höhen 4/5/6/8/10/12 m), die
 *     kleinste Höhe ist 4 m — gut das Doppelte der Figur.
 *
 * Bewusst GRÖBER als die Vorlage: Die Originale arbeiten in 2-m-Schritten,
 * hier gilt 4 m. Weniger Kombinationen heißt weniger Stellen, an denen
 * Connectors knapp nicht zusammenpassen. Auf 2 m verfeinern kann man
 * jederzeit, ohne bestehende Teile anzufassen; von 2 auf 4 vergröbern
 * hieße alles neu bauen.
 *
 * ── Wogegen die Prüfung NICHT läuft ──────────────────────────────────
 * Gegen die 374 geparsten Fremdräume. Die halten dieses Raster nicht
 * ein (2-m-Schritte, Connectors auf verschiedenen Höhen) und sollen es
 * auch nicht — sie sind Fremddaten ohne Modelle. Geprüft wird
 * ausschließlich, was `istEigenesModell()` als eigenes Modell führt.
 * Solange es kein einziges eigenes Bauteil gibt, läuft die Prüfung leer
 * durch. Das ist Absicht: Der Wächter steht, bevor das erste Modell
 * entsteht, statt hinterher nachgerüstet zu werden.
 */
import type { Quaternion, Vector3 } from './types.js';
import type { RoomConnectionDef, RoomDef } from './dungeons.js';

/** Rastereinheit in Metern. Herleitung siehe Kopfkommentar. */
export const DUNGEON_RASTER_M = 4;

/**
 * Kleinste lichte Höhe in Metern. Die Figur ist 1,8 m hoch; darunter
 * wirkt ein Raum geduckt statt gewölbt, und die kleinste Höhe der
 * Vorlage ist ebenfalls 4 m.
 */
export const DUNGEON_MIN_HOEHE_M = 4;

/**
 * Höhenunterschied zwischen zwei Ebenen in Metern.
 *
 * ── Warum 8 und nicht 4 ──────────────────────────────────────────────
 * 4 wäre das naheliegende Maß — eine Rastereinheit, und die Regelhöhe
 * eines Gangs ist ebenfalls 4. Es geht trotzdem nicht, und zwar aus
 * Zahlen, die in `tools/steingrab-erzeugen.py` stehen:
 *
 *   HOEHE         4,00  Bodenfläche bis Decken*ober*kante
 *   DECKENSTAERKE 0,40  → Decke liegt auf 3,60 … 4,00
 *   Bodenplatte   0,36  → hängt UNTER y = 0, also −0,36 … 0
 *
 * Bei 4 m Stufenhöhe läge die Bodenplatte des oberen Gangs auf
 * 3,64 … 4,00 und die Decke des unteren auf 3,60 … 4,00: 0,36 m
 * Durchdringung — und schlimmer, zwei deckungsgleiche, nach oben
 * zeigende Flächen bei genau 4,00. Das ist Z-Fighting auf einer
 * BEGEHBAREN Fläche, also genau dort, wo man hinsieht.
 *
 * 8 m sind zwei Rastereinheiten, lassen 3,64 m Fels zwischen den Ebenen
 * und lesen sich als zwei Stockwerke statt als Empore.
 */
export const DUNGEON_EBENE_M = 8;

/**
 * Toleranz für Fließkommavergleiche in Metern.
 *
 * Ein Blender-Export trifft die 0 nicht exakt — 1e-7 ist normal, 1 mm
 * ist es nicht. Die Grenze liegt bewusst bei einem halben Millimeter:
 * eng genug, dass ein versehentlich verschobener Connector auffällt,
 * weit genug, dass Exportrauschen nicht meldet.
 */
export const RASTER_TOLERANZ_M = 0.0005;

export type RasterSchwere = 'fehler' | 'hinweis';

export interface RasterBefund {
  readonly raum: string;
  readonly schwere: RasterSchwere;
  /** Kurzname der verletzten Regel — stabil, für Tests und Filter. */
  readonly regel:
    | 'connector-hoehe'
    | 'connector-drehung'
    | 'connector-auf-huellflaeche'
    | 'grundflaeche-raster'
    | 'lichte-hoehe'
    | 'ebenensprung-hoehe';
  readonly text: string;
}

const nahe = (a: number, b: number): boolean => Math.abs(a - b) <= RASTER_TOLERANZ_M;

const istVielfaches = (wert: number, schritt: number): boolean => {
  if (schritt <= 0) return false;
  const rest = Math.abs(wert) % schritt;
  return rest <= RASTER_TOLERANZ_M || Math.abs(rest - schritt) <= RASTER_TOLERANZ_M;
};

/**
 * Ist die Drehung achsparallel, also ein Vielfaches von 90° um die
 * Hochachse?
 *
 * Geprüft wird am Quaternion statt an Eulerwinkeln: Für eine reine
 * Y-Drehung müssen x und z null sein, und (w, y) müssen einem der vier
 * Viertelschritte entsprechen. Der Umweg über Euler würde bei 180°
 * mehrdeutig (±180° sind dasselbe) und bei Exportrauschen unnötig
 * empfindlich.
 */
export function istAchsparallel(rot: Quaternion): boolean {
  if (!nahe(rot.x, 0) || !nahe(rot.z, 0)) return false;
  // cos(θ/2), sin(θ/2) für θ ∈ {0°, 90°, 180°, 270°}; Vorzeichen egal,
  // weil q und −q dieselbe Drehung sind.
  const viertel = [
    [1, 0],
    [Math.SQRT1_2, Math.SQRT1_2],
    [0, 1],
    [-Math.SQRT1_2, Math.SQRT1_2],
  ];
  return viertel.some(
    ([w, y]) =>
      (nahe(rot.w, w!) && nahe(rot.y, y!)) || (nahe(rot.w, -w!) && nahe(rot.y, -y!))
  );
}

/**
 * Liegt der Connector auf einer der vier senkrechten Hüllflächen?
 *
 * `size` ist die volle Kantenlänge der Hüllbox, der lokale Ursprung
 * liegt in ihrer Mitte — die Flächen liegen also bei ±size/2. Geprüft
 * wird nur x und z: Boden- und Deckenflächen kommen als Verbindung
 * nicht in Frage, dafür gibt es keine waagerechten Durchgänge.
 */
export function liegtAufHuellflaeche(localPos: Vector3, size: Vector3): boolean {
  const halbX = size.x / 2;
  const halbZ = size.z / 2;
  const aufX = nahe(Math.abs(localPos.x), halbX) && Math.abs(localPos.z) <= halbZ + RASTER_TOLERANZ_M;
  const aufZ = nahe(Math.abs(localPos.z), halbZ) && Math.abs(localPos.x) <= halbX + RASTER_TOLERANZ_M;
  return aufX || aufZ;
}

/** Prüft EINEN Connector. Ausgelagert, damit der Test ihn einzeln treffen kann. */
export function pruefeConnector(
  raumName: string,
  index: number,
  c: RoomConnectionDef,
  size: Vector3
): RasterBefund[] {
  const befunde: RasterBefund[] = [];
  const wo = `Connector ${index + 1}`;

  // ── Höhe: 0 oder ein ganzes Stockwerk ───────────────────────────
  //
  // Die Regel hiess bis zum 28.08.2026 schlicht „muss 0 sein", mit der
  // Begründung, Räume würden sonst gegeneinander treppen. Das stimmte,
  // solange es nur eine Ebene gab. Eine Treppe tut genau das absichtlich.
  //
  // Gelockert wird trotzdem nicht auf „beliebig": Ein versehentlich
  // verschobener Connector ist unsichtbar, bis genug Teile da sind, dass
  // man die Ursache in der falschen Ecke sucht — davor steht dieses
  // Modul. Erlaubt sind deshalb nur ganze Vielfache von
  // `DUNGEON_EBENE_M`, und die Zweitprüfung unten bindet den Sprung an
  // etwas Nachprüfbares: Das Teil muss hoch genug sein, ihn zu
  // enthalten. Ein `y: 8` an einem 4 m hohen Gang faellt damit weiter
  // auf, obwohl 8 ein gueltiges Vielfaches ist.
  const ebenen = c.localPos.y / DUNGEON_EBENE_M;
  if (!nahe(ebenen, Math.round(ebenen))) {
    befunde.push({
      raum: raumName,
      schwere: 'fehler',
      regel: 'connector-hoehe',
      text:
        `${wo} liegt auf y = ${c.localPos.y.toFixed(3)} — erlaubt sind 0 oder ganze ` +
        `Stockwerke (Vielfache von ${DUNGEON_EBENE_M} m). Dazwischen treppen Räume gegeneinander.`,
    });
  }

  if (!istAchsparallel(c.localRot)) {
    befunde.push({
      raum: raumName,
      schwere: 'fehler',
      regel: 'connector-drehung',
      text: `${wo} ist nicht achsparallel gedreht (nur Vielfache von 90° um die Hochachse) — es passt dann nur, was zufällig passt.`,
    });
  }

  if (!liegtAufHuellflaeche(c.localPos, size)) {
    befunde.push({
      raum: raumName,
      schwere: 'fehler',
      regel: 'connector-auf-huellflaeche',
      text:
        `${wo} liegt nicht auf einer senkrechten Hüllfläche ` +
        `(x = ${c.localPos.x.toFixed(2)}, z = ${c.localPos.z.toFixed(2)} bei Hülle ${size.x}×${size.z}).`,
    });
  }

  return befunde;
}

/**
 * Die eine Achse, auf der dieses Bauteil dünner als das Raster sein DARF —
 * oder null, wenn es keine gibt.
 *
 * ── Warum es diese Ausnahme gibt ─────────────────────────────────────
 * Ein Verschlussteil kachelt nicht, es stopft ein Loch. Der Generator
 * nimmt Abschlüsse ausdrücklich vom Überschneidungstest aus und setzt sie
 * notfalls ganz ohne Prüfung (`dungeonGenerator.ts`, `placeEndCaps`) —
 * ein überlappender Abschluss ist ihm lieber als ein offenes Loch. Ein
 * Abschluss, der ein volles Rasterfeld beansprucht, steckt deshalb
 * regelmäßig im Stein seines Nachbarn. Gemessen an `DG_Steingrab` über
 * 40 Seeds: 268 von 553 Abschlüssen, also fast die Hälfte.
 *
 * ── Warum sie so eng gefasst ist ─────────────────────────────────────
 * Die Ausnahme gilt nur, wenn ALLES davon zutrifft: `endCap`, genau EIN
 * Connector, genau EINE dünne Achse, und dieser Connector liegt auf einer
 * Hüllfläche, die senkrecht auf eben dieser Achse steht. Damit beschreibt
 * sie ein Brett quer im Durchgang und sonst nichts. Ohne die
 * Einschränkungen wäre `endCap: true` ein Freibrief, mit dem jeder zu
 * klein geratene Raum durchrutscht — und die Prüfung stünde für nichts.
 */
export function verschlussAchse(
  raum: RoomDef,
  raster: number = DUNGEON_RASTER_M
): 'x' | 'z' | null {
  if (!raum.endCap) return null;
  if (raum.connections.length !== 1) return null;

  const duenne = (['x', 'z'] as const).filter(
    (a) => raum.size[a] + RASTER_TOLERANZ_M < raster
  );
  if (duenne.length !== 1) return null;

  const achse = duenne[0]!;
  const c = raum.connections[0]!;
  // Die Hüllfläche, auf der der Connector sitzt, muss senkrecht auf der
  // dünnen Achse stehen — sonst liegt das Brett längs statt quer, und
  // dann ist es kein Verschluss, sondern eine zu schmale Wand.
  if (!nahe(Math.abs(c.localPos[achse]), raum.size[achse] / 2)) return null;

  return achse;
}

/**
 * Dicke eines Wandmoduls im Modul-Format (Wand: 2 × 3,5 × 0,3 m,
 * `/home/mike/wov-ai/elements/modulFormat.md`). Steht hier, weil die
 * Ausnahme darunter mit genau diesem Mass rechnet — und mit keinem
 * anderen.
 */
export const MODUL_WANDDICKE_M = 0.3;

/**
 * Die Achsen, auf denen dieses Bauteil sein INNENMASS angibt statt des
 * Rastermasses — leer, wenn es keine gibt.
 *
 * ── Warum es diese Ausnahme gibt ─────────────────────────────────────
 * Ein Modulkit kann seine Wände auf zwei Arten bekommen: als eigenes
 * Wandmodul auf der Zellkante (`StoneVaultWall`, der endCap) oder in die
 * Zelle EINGEBAUT (`StoneVaultCorridor` und Geschwister). Im zweiten Fall
 * liegt die Wand innerhalb der 2-m-Zelle, im Streifen 0,7 … 1,0 von der
 * Zellmitte aus. Die Kollisionshülle muss dann VOR der Wand enden, also
 * bei 1,4 statt 2 — sonst stösst der Abschluss der offenen Nachbarzelle,
 * der von der Kante aus 0,3 m hereinragt, gegen diese Hülle und der
 * Generator setzt ihn über den Notfallzweig von `placeEndCaps`.
 *
 * Der Raum ist also nicht zu klein geraten, er nennt ein anderes Mass:
 * Rastermass minus zwei Wanddicken. Auf dem Raster steht er trotzdem —
 * seine Connectors liegen auf der Rasterkante, nicht auf der Hülle, und
 * deshalb korrigiert `pruefeRaumRaster` mit dieser Auskunft AUCH die
 * Hüllflächenprüfung.
 *
 * ── Warum sie so eng gefasst ist ─────────────────────────────────────
 * Sie gilt nur, wenn ALLES davon zutrifft: der Raum ist kein Abschluss
 * (dafür gibt es `verschlussAchse`), das Mass ist um GENAU zwei
 * Wanddicken kleiner als ein Rastervielfaches — nicht irgendwie kleiner
 * —, es ist nicht schon selbst ein Vielfaches, und kein Connector sitzt
 * auf der Fläche dieses kleineren Masses. Der letzte Punkt ist der
 * wichtigste: Er unterscheidet „Hülle endet vor der eingebauten Wand"
 * von „Raum ist wirklich nur 1,4 m breit". Ohne ihn wäre jede krumme
 * Grundfläche, die zufällig 0,6 m unter einem Vielfachen liegt, plötzlich
 * erlaubt.
 */
export function innenmassAchsen(
  raum: RoomDef,
  raster: number = DUNGEON_RASTER_M
): readonly ('x' | 'z')[] {
  if (raum.endCap) return [];
  if (raster <= 2 * MODUL_WANDDICKE_M) return [];

  return (['x', 'z'] as const).filter((achse) => {
    const innen = raum.size[achse];
    if (istVielfaches(innen, raster)) return false;
    if (!istVielfaches(innen + 2 * MODUL_WANDDICKE_M, raster)) return false;
    return !raum.connections.some((c) => nahe(Math.abs(c.localPos[achse]), innen / 2));
  });
}

/**
 * Prüft ein Bauteil gegen das Raster. Leeres Ergebnis heißt: passt.
 *
 * `raster` ist überschreibbar, damit ein späteres Kit mit feinerem Raster
 * (2 m) dieselbe Funktion benutzen kann, statt eine zweite zu bekommen.
 */
export function pruefeRaumRaster(raum: RoomDef, raster: number = DUNGEON_RASTER_M): RasterBefund[] {
  const befunde: RasterBefund[] = [];
  const duenn = verschlussAchse(raum, raster);
  const innen = innenmassAchsen(raum, raster);

  // Das Mass, gegen das geprüft wird: bei eingebauten Wänden das
  // Rastermass, das der Raum belegt, sonst die Hülle selbst. Beide
  // Prüfungen darunter — Grundfläche und Connector-Hüllfläche — müssen
  // dieselbe Zahl benutzen, sonst widerspricht sich die Ausnahme selbst.
  const huelle: Vector3 = {
    x: innen.includes('x') ? raum.size.x + 2 * MODUL_WANDDICKE_M : raum.size.x,
    y: raum.size.y,
    z: innen.includes('z') ? raum.size.z + 2 * MODUL_WANDDICKE_M : raum.size.z,
  };

  for (const achse of ['x', 'z'] as const) {
    const wert = huelle[achse];
    if (achse === duenn) continue;
    if (!istVielfaches(wert, raster)) {
      befunde.push({
        raum: raum.name,
        schwere: 'fehler',
        regel: 'grundflaeche-raster',
        text: `Grundfläche ${achse} = ${raum.size[achse]} m ist kein Vielfaches von ${raster} m.`,
      });
    }
  }

  if (raum.size.y + RASTER_TOLERANZ_M < DUNGEON_MIN_HOEHE_M) {
    befunde.push({
      raum: raum.name,
      schwere: 'hinweis',
      regel: 'lichte-hoehe',
      text:
        `Lichte Höhe ${raum.size.y} m liegt unter ${DUNGEON_MIN_HOEHE_M} m. ` +
        `Die Figur ist 1,8 m hoch — darunter wirkt der Raum geduckt statt gewölbt.`,
    });
  }

  // ── Ein Ebenensprung muss ins Teil passen ───────────────────────
  //
  // Die Zweitprüfung zur gelockerten Höhenregel in `pruefeConnector`.
  // Dort ist jedes ganze Vielfache von DUNGEON_EBENE_M erlaubt — hier
  // muss das Teil den Sprung auch enthalten können.
  //
  // Ohne sie wäre die Lockerung ein Freibrief: Ein vertipptes `y: 8` an
  // einem 4 m hohen Gang wäre ein gültiges Vielfaches und käme durch,
  // und der Fehler zeigte sich erst als Loch in der Decke — an einem
  // Bauteil, das nie eine Treppe sein wollte.
  //
  // Verlangt wird die HÜLLHÖHE über dem höchsten Connector plus der
  // Mindesthöhe: Wer 8 m überwindet, braucht oben noch Kopfraum.
  const hoechster = Math.max(0, ...raum.connections.map((c) => Math.abs(c.localPos.y)));
  if (hoechster > 0) {
    const noetig = hoechster + DUNGEON_MIN_HOEHE_M;
    if (raum.size.y + RASTER_TOLERANZ_M < noetig) {
      befunde.push({
        raum: raum.name,
        schwere: 'fehler',
        regel: 'ebenensprung-hoehe',
        text:
          `Ein Connector liegt ${hoechster} m hoch, das Teil ist aber nur ${raum.size.y} m. ` +
          `Nötig sind ${noetig} m (Sprung plus ${DUNGEON_MIN_HOEHE_M} m Kopfraum oben) — ` +
          `so steht der Ausgang im Fels.`,
      });
    }
  }

  raum.connections.forEach((c, i) => {
    befunde.push(...pruefeConnector(raum.name, i, c, huelle));
  });

  return befunde;
}

/**
 * Prüft eine ganze Menge Bauteile. Der Aufrufer entscheidet, WELCHE —
 * dieses Modul kennt bewusst weder die Registry noch `istEigenesModell`,
 * damit es ohne Datenlast testbar bleibt und der Editor es später für
 * einen Entwurf im Speicher benutzen kann.
 */
export function pruefeRaeumeRaster(
  raeume: readonly RoomDef[],
  raster: number = DUNGEON_RASTER_M
): RasterBefund[] {
  return raeume.flatMap((r) => pruefeRaumRaster(r, raster));
}
