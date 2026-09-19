/**
 * Persistence seam of the offline flight ("Testflug", `?offline=1&layout=editor`).
 *
 * The flight edits ONE working document — the draft that `editor.html` also
 * edits. Everything the flight does to it (place, drag, delete, NPC fields)
 * goes through this interface, so a later online mode can swap the storage
 * without touching the flight itself. The only implementation today is
 * `LocalStoragePersistenz` (working copy in the browser, publish via POST).
 *
 * Trennstelle des Offline-Testflugs: Alles, was er am Entwurf ändert, läuft
 * durch diese Schnittstelle. Heute gibt es nur die localStorage-Umsetzung.
 */
import type { NpcDef } from '@wov/shared';

/**
 * Ein Eintrag des Entwurfs — dieselben Felder wie PlacementDef, aber
 * beschreibbar: Der Entwurf im localStorage IST das Arbeitsdokument.
 */
export type EntwurfEintrag = {
  /** The id of the placement (`frischePlatzierungsId`); the test flight gives every new one its own. */
  id?: string;
  prefab: string;
  x: number;
  z: number;
  yaw?: number;
  scale?: number;
  einebnen?: number;
  npc?: NpcDef;
};

/** The draft as stored: `placements` may be missing in a fresh document. */
export type EntwurfDokument = {
  placements?: EntwurfEintrag[];
  [weiteresFeld: string]: unknown;
};

/** Answer of the publish endpoint (`POST /api/worldlayout`). */
export type SpeicherAntwort = { ok: boolean; message: string };

export interface TestflugPersistenz {
  /**
   * Reads the working draft. `null` when there is none; throws when the
   * stored text cannot be parsed (callers decide whether that is fatal).
   */
  laden(): EntwurfDokument | null;
  /**
   * Writes the CHANGED working draft back. The caller mutates the document
   * it got from `laden()` and hands it in whole — a later online mode
   * replaces this by operations.
   */
  aendern(dokument: EntwurfDokument): void;
  /** Publishes a sanitised draft to the server file. */
  speichern(dokument: object): Promise<SpeicherAntwort>;
}
