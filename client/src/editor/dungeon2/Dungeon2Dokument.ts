/**
 * AP15.2 — 2.0-Dungeon-Dokumente fuer den Karteneditor LADEN.
 * AP15.2 — LOADING 2.0 dungeon documents for the map editor.
 *
 * Analog zum LEGACY-`DungeonDokument.ts`, aber gegen `/api/dungeons2` bzw.
 * `/api/dungeons2/:id` (AP15.0, `admin/src/main.ts`). Dieselbe Begruendung
 * gilt unveraendert: GELESEN wird ueber den Betriebsdienst, weil der ohne
 * laufenden Spielserver auskommt; GESCHRIEBEN wird ueber den Spielserver-
 * Socket (`Dungeon2Speichern.ts`, AP15.1), weil nur der die laufende Instanz
 * mitnimmt.
 * Same as the LEGACY `DungeonDokument.ts`, but against `/api/dungeons2` resp.
 * `/api/dungeons2/:id`. Same reasoning: READING goes through the ops service
 * (no game server required); WRITING goes through the game server socket
 * (`Dungeon2Speichern.ts`), the only path that updates a live instance.
 *
 * Die Antwort-Parser (`parseDungeon2ListenAntwort`, `parseDungeon2DokumentAntwort`)
 * sind ABSICHTLICH von `fetch` getrennt: Sie pruefen nur das JSON, das der
 * Betriebsdienst schickt, und sind damit ohne DOM/Netz testbar — siehe
 * `client/test/dungeon2-katalog.ts`.
 * The response parsers are DELIBERATELY split off from `fetch`: they check only
 * the JSON the ops service sends and are therefore testable without DOM/network.
 */
import { dungeon2 } from '@wov/shared';

/**
 * Kopf-Eintrag der Liste — genau die Felder, die `/api/dungeons2` liefert
 * (AP15.0-Kopfkommentar `admin/src/main.ts`). `raeume`/`tueren` fehlen bei
 * `modus: 'erzeugt'` — der Dienst baut dafuer keinen Generatorlauf.
 * List entry — exactly the fields `/api/dungeons2` returns. `raeume`/`tueren`
 * are absent for `modus: 'erzeugt'` — the service does not run the generator
 * just to count them.
 */
export interface Dungeon2Kopf {
  readonly id: string;
  readonly name: string;
  readonly thema: string;
  readonly modus: dungeon2.DungeonModus2;
  readonly version: number;
  readonly ambientLicht: number;
  readonly pruefsumme: string;
  readonly raeume?: number;
  readonly tueren?: number;
}

/**
 * Fehler mit der Meldung des Dienstes — dieselbe Rolle wie `DungeonLadeFehler`
 * im LEGACY-Vorbild, eigener Name, damit ein `catch` nie ein Altformat-Dokument
 * mit einem 2.0-Dokument verwechseln kann.
 * Same role as the LEGACY `DungeonLadeFehler`, own name so a `catch` can never
 * mix up a legacy-format error with a 2.0 one.
 */
export class Dungeon2LadeFehler extends Error {}

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

interface DienstAntwort {
  ok?: unknown;
  fehler?: unknown;
  message?: unknown;
  instanz?: unknown;
  dungeons?: unknown;
  dungeon?: unknown;
}

/**
 * Meldung aus einer (moeglicherweise kaputten) Dienstantwort ziehen — fuer den
 * Fehlerfall UND fuer den Erfolgsfall gleich (`message` ist die
 * Vorschau-Zeile im LEGACY-Muster).
 * Pull a message out of a (possibly broken) service reply — used for both the
 * error and the success case.
 */
function meldungAus(d: DienstAntwort, ersatz: string): string {
  if (typeof d.fehler === 'string' && d.fehler) return d.fehler;
  if (typeof d.message === 'string' && d.message) return d.message;
  return ersatz;
}

/**
 * Einen rohen Kopf-Eintrag pruefen. Kein Sanitizer im engeren Sinn — die
 * Zahlen/Zeichenketten kommen vom EIGENEN Betriebsdienst, nicht von aussen —
 * aber `fetch` liefert `unknown`, und ein kaputtes Feld soll den Eintrag
 * NICHT in die Liste durchreichen, sondern verworfen werden.
 * Check one raw head entry. Not a sanitizer in the strict sense — the data
 * comes from OUR OWN ops service — but `fetch` yields `unknown`, and a broken
 * field must drop the entry rather than pass it through.
 */
function leseDungeon2Kopf(roh: unknown): Dungeon2Kopf | null {
  if (!istObjekt(roh)) return null;
  const { id, name, thema, modus, version, ambientLicht, pruefsumme, raeume, tueren } = roh;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof thema !== 'string') return null;
  if (modus !== 'erzeugt' && modus !== 'gebaut') return null;
  if (typeof version !== 'number' || typeof ambientLicht !== 'number') return null;
  if (typeof pruefsumme !== 'string') return null;
  const kopf: Dungeon2Kopf = {
    id,
    name,
    thema,
    modus,
    version,
    ambientLicht,
    pruefsumme,
    ...(typeof raeume === 'number' ? { raeume } : {}),
    ...(typeof tueren === 'number' ? { tueren } : {}),
  };
  return kopf;
}

/**
 * Antwort von `GET /api/dungeons2` pruefen und in Koepfe umsetzen. Wirft
 * `Dungeon2LadeFehler`, wenn der Dienst `ok:false` meldet oder die Antwort
 * keine Liste ist; einzelne kaputte EINTRAEGE werden dagegen still
 * uebersprungen (der Dienst zaehlt sie selbst schon in seiner `message`
 * unter "unlesbar").
 * Check the `GET /api/dungeons2` reply and turn it into heads. Throws when the
 * service itself reports failure or the reply is not a list; single BROKEN
 * entries are skipped quietly instead (the service already counts them in its
 * own `message` as "unlesbar").
 */
export function parseDungeon2ListenAntwort(json: unknown): { instanz: string; dungeons: Dungeon2Kopf[] } {
  if (!istObjekt(json)) throw new Dungeon2LadeFehler('Antwort war kein Objekt');
  const d = json as DienstAntwort;
  if (d.ok !== true) throw new Dungeon2LadeFehler(meldungAus(d, 'Betriebsdienst meldet Fehler'));
  if (!Array.isArray(d.dungeons)) throw new Dungeon2LadeFehler('Antwort ohne Dungeon-Liste');
  const instanz = typeof d.instanz === 'string' ? d.instanz : '?';
  const dungeons: Dungeon2Kopf[] = [];
  for (const roh of d.dungeons) {
    const kopf = leseDungeon2Kopf(roh);
    if (kopf) dungeons.push(kopf);
  }
  return { instanz, dungeons };
}

/**
 * Antwort von `GET /api/dungeons2/:id` pruefen. Anders als bei der Liste wird
 * das Dokument hier noch einmal durch `sanitizeDungeonDokument2` geschickt —
 * nicht weil der EIGENE Dienst es schon getan hat (er hat), sondern weil
 * `fetch` `unknown` liefert und dieselbe Funktion auch den Testfall ohne
 * Netzwerk pruefen soll (`client/test/dungeon2-katalog.ts`).
 * Check the `GET /api/dungeons2/:id` reply. Unlike the list, the document is
 * run through `sanitizeDungeonDokument2` once more here — not because our OWN
 * service has not already done so, but because `fetch` yields `unknown` and
 * the same function must also serve the network-free test case.
 */
export function parseDungeon2DokumentAntwort(json: unknown): dungeon2.DungeonDokument2 {
  if (!istObjekt(json)) throw new Dungeon2LadeFehler('Antwort war kein Objekt');
  const d = json as DienstAntwort;
  if (d.ok !== true) throw new Dungeon2LadeFehler(meldungAus(d, 'Betriebsdienst meldet Fehler'));
  const doc = dungeon2.sanitizeDungeonDokument2(d.dungeon);
  if (!doc) throw new Dungeon2LadeFehler('Antwort ohne brauchbares 2.0-Dokument');
  return doc;
}

async function hole<T>(pfad: string, parse: (json: unknown) => T): Promise<T> {
  let antwort: Response;
  try {
    antwort = await fetch(pfad);
  } catch (err) {
    throw new Dungeon2LadeFehler(`Betriebsdienst nicht erreichbar (${String(err)})`);
  }
  let json: unknown;
  try {
    json = await antwort.json();
  } catch {
    throw new Dungeon2LadeFehler(`Antwort unlesbar (HTTP ${antwort.status})`);
  }
  try {
    return parse(json);
  } catch (err) {
    // HTTP-Status als Zusatz, falls die Antwort selbst keine Meldung trug
    // (z. B. ein blanker 404 ohne JSON-Rumpf).
    // HTTP status as a fallback when the reply itself carried no message.
    if (err instanceof Dungeon2LadeFehler && !antwort.ok) {
      throw new Dungeon2LadeFehler(`${err.message} (HTTP ${antwort.status})`);
    }
    throw err;
  }
}

/** Alle 2.0-Dungeons der Instanz — nur die Koepfe. */
export async function holeDungeon2Liste(): Promise<{ instanz: string; dungeons: Dungeon2Kopf[] }> {
  return hole('/api/dungeons2', parseDungeon2ListenAntwort);
}

/** Ein einzelnes 2.0-Dokument, geprueft wie der Betriebsdienst es prueft. */
export async function holeDungeon2(id: string): Promise<dungeon2.DungeonDokument2> {
  return hole(`/api/dungeons2/${encodeURIComponent(id)}`, parseDungeon2DokumentAntwort);
}
