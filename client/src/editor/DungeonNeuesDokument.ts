/**
 * Ein neues, LEERES Dungeon-Dokument aus einer Kit-Basis bauen.
 *
 * Reine Funktion, kein DOM und kein Netz — deshalb eine eigene Datei und
 * nicht ein Stück Klick-Handler in `DungeonKatalog.ts`. Genau dieselbe
 * Trennung hat `spielHost()` dort bekommen, und aus demselben Grund: Als
 * Ausdruck im Handler war die Rechnung nicht prüfbar, und ihr Fehler fiel
 * erst auf, als jemand darauf klickte.
 *
 * ── Warum der Generator und nicht ein handgeschriebener Raum ─────────
 * Ein `PlacedRoom` besteht nicht nur aus Name und Position: `seed` ist ein
 * aus der Position abgeleiteter Wert (`roomSeed` in
 * `dungeonGenerator.ts`, nicht exportiert), und die Startposition des
 * Eingangsraums ist die des Generators. Von Hand nachgebaut wäre beides
 * eine zweite Wahrheit, die beim nächsten `dungeon regen` auffiele.
 * Der Verteiler (`erzeugeLayoutFuerKit`) mit `maxRooms: 0` liefert
 * stattdessen genau den Startzustand, den der Server auch bauen würde —
 * und zwar auf beiden Pfaden: Der Rasterpfad klemmt 0 auf eine Zelle und
 * baut die Eingangszelle mit ihren Platten, der 1.0-Pfad den Eingangsraum
 * mit seinen Abschlüssen. Beide Male fallen die Abschlüsse gleich darauf
 * wieder weg (nächster Absatz).
 *
 * ── Warum die Abschlüsse wieder abgerissen werden ────────────────────
 * Gemessen am 03.09.2026 (`DG_StoneVault`, Seed 7): `maxRooms: 0` ergibt
 * NICHT nur den Eingangsraum, sondern vier — der Eingang plus drei
 * `StoneVaultWall`-Abschlüsse, die `placeEndCaps` über jede unbeschaltete
 * Kante zieht. Übrig bleibt EIN offener Connector. Zum Bauen ist das die
 * schlechtere Ausgangslage: Wer eine andere Richtung will, muss erst eine
 * Wand suchen und entfernen, und im Grundriss sieht das leere Grab aus
 * wie ein fertiges.
 *
 * Mit `removeRoom` — derselben Funktion, die der Editor beim „Raum
 * entfernen" ruft — fallen die Abschlüsse wieder weg, und der Eingangsraum
 * steht mit ALLEN vier offenen Kanten da (gemessen: 4). Das ist der
 * Zustand, in dem man in jede Richtung weiterbauen kann, ohne vorher
 * etwas abreissen zu müssen.
 *
 * `mode: 'custom'` von Anfang an: Ein `generated`-Dokument würde beim
 * nächsten Materialisieren aus Seed und Regeln neu erzeugt — und wäre
 * dann eben nicht mehr leer, sondern ein voller Zufallsdungeon. Dieselbe
 * Begründung steht an `fuegeAn` in `DungeonGrundriss.ts`.
 */
import {
  DUNGEONS_BY_NAME,
  DUNGEON_DOCUMENT_VERSION,
  DEFAULT_GENERATOR_SETTINGS,
  erzeugeLayoutFuerKit,
  isInstanceableDungeon,
  isValidDungeonId,
  removeRoom,
  sanitizeGeneratorEinstellungen,
  type DungeonDef,
  type DungeonDocument,
} from '@wov/shared';

/**
 * Die Kits, aus denen sich ein neues Dokument anlegen lässt.
 *
 * Vorne stehen die EIGENEN Kits — sie sind das, was Mike baut; die
 * dreizehn geparsten Vorlagen-Kits sind Beiwerk und stünden sonst
 * alphabetisch davor. Der Rest behält seine Reihenfolge aus `DUNGEONS`,
 * damit die Liste zwischen zwei Sitzungen nicht springt.
 */
export const EIGENE_KITS_ZUERST = ['DG_StoneVault', 'DG_Steingrab'] as const;

/** Alle instanzierbaren Basen, eigene Kits zuerst. */
export function waehlbareBasen(): DungeonDef[] {
  const alle = [...DUNGEONS_BY_NAME.values()].filter(isInstanceableDungeon);
  const rang = (d: DungeonDef): number => {
    const i = EIGENE_KITS_ZUERST.indexOf(d.name as (typeof EIGENE_KITS_ZUERST)[number]);
    return i < 0 ? EIGENE_KITS_ZUERST.length : i;
  };
  return alle.sort((a, b) => rang(a) - rang(b));
}

export interface NeuesDokumentWunsch {
  id: string;
  base: string;
  /** Fehlt er, wird einer gewürfelt — er steckt in den Deko-Varianten. */
  seed?: number;
  /**
   * VOLL generieren statt nur den Eingangsraum (Vorgabe: aus).
   *
   * Der Unterschied ist nicht nur die Raumzahl, sondern auch der `mode`:
   * Ein voll gewürfeltes Grab ist aus Basis und Seed reproduzierbar und
   * darf deshalb `generated` heissen — solange niemand von Hand daran
   * baut. Das leere Ein-Raum-Dokument ist von der ersten Sekunde an
   * Handarbeit und bleibt `custom`, sonst würfelte der Server es beim
   * nächsten Materialisieren voll (dieselbe Begründung wie an `fuegeAn`).
   */
  voll?: boolean;
  /**
   * Wachstumsversuche statt der Kit-Vorgabe. Wirkt NUR bei `voll` — im
   * leeren Fall stehen sie ohnehin auf 0.
   *
   * Bei einem RASTERKIT (`def.gridGeneration`, heute nur `DG_StoneVault`)
   * ist dieselbe Zahl die ZELLZAHL — s. {@link istRasterkit} und die
   * Beschriftung im Formular.
   */
  maxRooms?: number;
  /** Wachstumsraum statt der Kit-Vorgabe. Ebenfalls nur bei `voll`. */
  zoneSize?: number;
  /**
   * „Schleifen": Anteil der Rasternachbarschaften, die zum Durchgang
   * werden (0…1). Wirkt NUR auf einem Rasterkit — der 1.0-Pfad liest ihn
   * nie. Fehlt er, gilt die Vorgabe des Generators.
   */
  loopFraction?: number;
  /** „Torbögen": Anteil der Verbindungen mit Rahmen (0…1). Ebenfalls nur Rasterkit. */
  archwayFraction?: number;
}

/**
 * Baut dieses Kit über den Rasterpfad?
 *
 * Die EINE Stelle, an der der Editor das fragt — und er fragt dasselbe
 * Feld, das auch der Verteiler fragt (`erzeugeLayoutFuerKit`). Eine
 * zweite Liste („welche Kits sind Rasterkits") wäre genau die zweite
 * Wahrheit, an der `roomOverlapsLayout` gegen `testCollision` schon
 * einmal auseinandergelaufen ist.
 *
 * Sie steht hier und nicht in `DungeonKatalog.ts`, weil das Formular sie
 * für die BESCHRIFTUNG braucht („Zellen" statt „Räume (Versuche)") und
 * die Bau-Funktion für die Regler — zwei Aufrufer, eine Antwort.
 */
export function istRasterkit(base: string): boolean {
  return DUNGEONS_BY_NAME.get(base)?.gridGeneration !== undefined;
}

export type NeuesDokumentErgebnis =
  | { ok: true; doc: DungeonDocument }
  | { ok: false; grund: string };

/**
 * Ein neues Dokument bauen — oder sagen, warum nicht.
 *
 * Wirft nicht: Der 1.0-Pfad wirft bei einem Kit mit falschem
 * Algorithmus, und ein Formular soll dafür eine Meldung zeigen und keinen
 * Absturz. Die Prüfungen davor sind dieselben, an denen der Sanitizer des
 * Servers das Dokument sonst ablehnen würde — nur eben hier, wo man es
 * noch korrigieren kann.
 */
export function neuesDungeonDokument(wunsch: NeuesDokumentWunsch): NeuesDokumentErgebnis {
  const id = wunsch.id.trim().toLowerCase();
  if (!isValidDungeonId(id)) {
    return {
      ok: false,
      grund: 'ID ungültig — Kleinbuchstaben, Ziffern, „-" und „_", höchstens 64 Zeichen.',
    };
  }
  const def = DUNGEONS_BY_NAME.get(wunsch.base);
  if (!def) return { ok: false, grund: `Unbekannte Basis ${wunsch.base}` };
  if (!isInstanceableDungeon(def)) {
    return { ok: false, grund: `${def.name} lässt sich nicht als Instanz bauen` };
  }

  // `| 0` wie im Sanitizer: Ein Seed mit Nachkommastellen käme beim
  // Speichern abgeschnitten zurück, und das Dokument im Editor wäre ein
  // anderes als das auf der Platte.
  const seed = (wunsch.seed ?? Math.floor(Math.random() * 0x7fffffff)) | 0;

  // Durch DENSELBEN Sanitizer wie das gespeicherte Dokument. Ein Wert, den
  // das Formular durchlässt, der Server aber klemmt, ergäbe sonst im
  // Editor ein anderes Grab als auf der Platte — und zwar erst nach dem
  // Speichern, wo es niemand mehr mit der Eingabe vergleicht.
  const einstellungen = wunsch.voll
    ? sanitizeGeneratorEinstellungen({
        maxRooms: wunsch.maxRooms,
        zoneSize: wunsch.zoneSize,
        // Die beiden Rasterregler gehen durch DENSELBEN Sanitizer wie
        // alles andere. Ein Anteil über 1 oder unter 0 käme sonst erst
        // beim Speichern geklemmt zurück — und das Grab im Editor wäre
        // ein anderes als das auf der Platte.
        loopFraction: wunsch.loopFraction,
        archwayFraction: wunsch.archwayFraction,
      })
    : undefined;

  // Der Wachstumsraum, in dem WIRKLICH gebaut wird: Override vor
  // Kit-Vorgabe vor Generator-Vorgabe — dieselbe Reihenfolge, die
  // beide Pfade intern anwenden.
  const zoneSize =
    einstellungen?.zoneSize ??
    def.generatorEinstellungen?.zoneSize ??
    DEFAULT_GENERATOR_SETTINGS.zoneSize;

  let layout;
  try {
    // `maxRooms` ist ein KIT-Wert und keine Generator-Einstellung — er
    // reist deshalb über eine `def`-Kopie, `zoneSize` über `settingsIn`.
    // Ohne `voll` steht er auf 0: NULL Wachstumsversuche, der Eingangsraum
    // steht trotzdem, er kommt nicht aus der Schleife.
    const bauDef = wunsch.voll
      ? einstellungen?.maxRooms !== undefined
        ? { ...def, maxRooms: einstellungen.maxRooms }
        : def
      : { ...def, maxRooms: 0, minRequiredRooms: 0 };
    layout = erzeugeLayoutFuerKit(bauDef, seed, {
      zoneSize,
      ...(einstellungen?.loopFraction !== undefined ? { loopFraction: einstellungen.loopFraction } : {}),
      ...(einstellungen?.archwayFraction !== undefined
        ? { archwayFraction: einstellungen.archwayFraction }
        : {}),
    });
  } catch (err) {
    return { ok: false, grund: `Generator: ${String(err)}` };
  }

  // Die Abschlüsse fallen NUR im leeren Fall wieder weg (Begründung im
  // Dateikopf). Ein voll gewürfeltes Grab ohne seine Wände hätte Löcher —
  // dort sind die Abschlüsse das Ergebnis, nicht der Ballast.
  if (!wunsch.voll) {
    // Von hinten nach vorn, damit die Indizes der noch nicht besuchten
    // Räume beim Nachrücken stimmen. `removeRoom` räumt Türen und Deko des
    // Raums gleich mit weg — hier gibt es beides noch nicht, aber ein
    // eigener Löschweg wäre die zweite Bau-Logik, die dieses Vorhaben
    // ausschliesst.
    const istAbschluss = new Map(def.rooms.map((r) => [r.name, !!r.endCap]));
    for (let i = layout.rooms.length - 1; i >= 0; i--) {
      if (istAbschluss.get(layout.rooms[i]!.room)) removeRoom(layout, def.name, i);
    }
  }

  return {
    ok: true,
    doc: {
      version: DUNGEON_DOCUMENT_VERSION,
      id,
      name: wunsch.id.trim(),
      base: def.name,
      // `generated` nur beim vollen Wurf — und auch dort nur, solange das
      // Dokument unberührt ist. Sobald jemand anbaut, setzt der Grundriss
      // es auf `custom` (s. `fuegeAn`), sonst würfelte der Server die
      // Handarbeit beim nächsten Materialisieren weg.
      mode: wunsch.voll ? 'generated' : 'custom',
      seed,
      // Derselbe Wachstumsraum, in dem der Generator das Layout gebaut
      // hat — sonst stünde im Kopf eine Zahl, gegen die nie geprüft wurde.
      zoneSize,
      ...(einstellungen ? { generatorEinstellungen: einstellungen } : {}),
      layout,
    },
  };
}
