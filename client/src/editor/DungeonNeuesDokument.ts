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
 * `generateDungeonLayout` mit `maxRooms: 0` liefert stattdessen genau den
 * Startzustand, den der Server auch bauen würde.
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
  generateDungeonLayout,
  isInstanceableDungeon,
  isValidDungeonId,
  removeRoom,
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
}

export type NeuesDokumentErgebnis =
  | { ok: true; doc: DungeonDocument }
  | { ok: false; grund: string };

/**
 * Ein neues Dokument bauen — oder sagen, warum nicht.
 *
 * Wirft nicht: `generateDungeonLayout` wirft bei einem Kit mit falschem
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

  let layout;
  try {
    // `maxRooms: 0` heisst hier NULL Wachstumsversuche — der Eingangsraum
    // steht trotzdem, er kommt nicht aus der Schleife.
    layout = generateDungeonLayout({ ...def, maxRooms: 0, minRequiredRooms: 0 }, seed);
  } catch (err) {
    return { ok: false, grund: `Generator: ${String(err)}` };
  }

  // Von hinten nach vorn, damit die Indizes der noch nicht besuchten
  // Räume beim Nachrücken stimmen. `removeRoom` räumt Türen und Deko des
  // Raums gleich mit weg — hier gibt es beides noch nicht, aber ein
  // eigener Löschweg wäre die zweite Bau-Logik, die dieses Vorhaben
  // ausschliesst.
  const istAbschluss = new Map(def.rooms.map((r) => [r.name, !!r.endCap]));
  for (let i = layout.rooms.length - 1; i >= 0; i--) {
    if (istAbschluss.get(layout.rooms[i]!.room)) removeRoom(layout, def.name, i);
  }

  return {
    ok: true,
    doc: {
      version: DUNGEON_DOCUMENT_VERSION,
      id,
      name: wunsch.id.trim(),
      base: def.name,
      mode: 'custom',
      seed,
      // Derselbe Wachstumsraum, in dem der Generator das Layout gebaut
      // hat — sonst stünde im Kopf eine Zahl, gegen die nie geprüft wurde.
      zoneSize:
        def.generatorEinstellungen?.zoneSize ?? DEFAULT_GENERATOR_SETTINGS.zoneSize,
      layout,
    },
  };
}
