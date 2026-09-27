/**
 * Instanz — welche der beiden Umgebungen dieser Prozess bedient.
 *
 * Vier Prozesse müssen dieselbe Welt meinen: der Spielserver (server/), der
 * Betriebsdienst (admin/), das Speicher-Plugin des Editors (client/vite.config.ts)
 * und der MCP-Server (tools/worldlayout-mcp/). Vorher stand der Weltname in
 * `server/data/server.yml` — und genau deshalb durfte diese Datei nie mitdeployed
 * werden, weil sie auf dev `world: bau` und auf live `world: vikings` trug. Eine
 * Datei, die auf zwei Containern verschieden sein MUSS, sorgt zuverlässig dafür,
 * dass die Bäume nach jedem Abgleich erneut auseinanderlaufen.
 *
 * Die Umgebung gehört deshalb in den Startbefehl, nicht in den Quellbaum:
 *
 *     /etc/wov.env  →  WOV_INSTANZ=dev   bzw.   WOV_INSTANZ=live
 *
 * Daraus folgt ALLES andere: die Weltdatei und der Spielstand
 * `server/data/worlds/<instanz>.db.zst`. Die Welt hat zwei Gesichter:
 *   - `server/data/welten/<instanz>.json` im Repo ist der ABGENOMMENE Stand (`weltRepoDatei`);
 *   - `<Arbeitsordner>/<instanz>.json` ist die ARBEITSKOPIE (`weltDatei`), die zur Laufzeit gelesen und
 *     beschrieben wird. Speichern im Editor macht den Git-Baum so nicht schmutzig. Der Ordner ist
 *     `WOV_WELT_VERZEICHNIS` (nur ausdrücklich gesetzt, absolut; die Units auf DEV und live setzen
 *     `/var/lib/wov/welten`), sonst `<wurzel>/server/data/welten-arbeit/` (von Git ignoriert), siehe
 *     `weltArbeitsOrdner`. Anlegen, Nachziehen und Abnehmen: shared/src/worldlayout/weltArbeitskopie.ts,
 *     tools/welt-abnehmen.sh.
 *
 * ── Warum ein harter Abbruch statt eines Rückfallwerts ──────────────────
 * Ein Tippfehler in der Unit (`WOV_INSTANZ=liv`) darf NICHT dazu führen, dass
 * der Prozess still die andere Welt öffnet: Der Live-Server würde den Dev-Save
 * laden und ihn bei der ersten 30-Minuten-Sicherung überschreiben. Ein
 * Serverstart, der mit klarer Meldung endet, kostet Minuten; ein stiller
 * Fehlgriff kostet die Welt.
 *
 * Der Rückfall auf 'dev' bei FEHLENDER Variable ist dagegen sicher — er trifft
 * Werkzeuge und Tests, die ohne Unit laufen, und zeigt im Zweifel auf die
 * Umgebung, in der ein Fehler nichts kostet.
 *
 * ── Warum nicht über shared/src/index.ts exportiert ─────────────────────
 * Der Barrel geht ins Client-Bundle; `process.env` hat dort nichts zu suchen.
 * Verwender importieren direkt, so wie es DungeonManager.ts mit
 * `@wov/shared/src/dungeonFlatten.js` bereits vormacht.
 */

import { isAbsolute, resolve } from 'node:path';

/** Die beiden Umgebungen. Mehr gibt es nicht, und das ist Absicht. */
export type Instanz = 'dev' | 'live';

export const INSTANZEN: readonly Instanz[] = ['dev', 'live'];

/**
 * Liest WOV_INSTANZ. Fehlt sie, gilt 'dev'. Steht etwas anderes darin als
 * 'dev' oder 'live', bricht der Aufruf ab — siehe Kopfkommentar.
 */
export function instanzName(roh: string | undefined = process.env.WOV_INSTANZ): Instanz {
  if (roh === undefined || roh.trim() === '') return 'dev';
  const wert = roh.trim().toLowerCase();
  if (wert === 'dev' || wert === 'live') return wert;
  throw new Error(
    `WOV_INSTANZ="${roh}" ist weder "dev" noch "live". ` +
      `Der Wert bestimmt Weltdatei und Spielstand — ein Rückfallwert würde hier ` +
      `die falsche Welt öffnen und beim nächsten Speichern überschreiben.`
  );
}

/** Ordner mit den abgenommenen Weltdokumenten (in Git). `wurzel` ist die Projektwurzel. */
export function weltenOrdner(wurzel: string): string {
  return resolve(wurzel, 'server/data/welten');
}

/** Das abgenommene Weltdokument dieser Instanz (in Git). Lesen und Vergleichen, nie zur Laufzeit beschreiben. */
export function weltRepoDatei(wurzel: string, instanz: Instanz = instanzName()): string {
  return resolve(weltenOrdner(wurzel), `${instanz}.json`);
}

/** Der Ordner der Arbeitskopien im Betrieb; nur über `WOV_WELT_VERZEICHNIS` (Units), nie als Vorgabe. */
export const WELT_VERZEICHNIS_BETRIEB = '/var/lib/wov/welten';

/** `WOV_WELT_VERZEICHNIS` ist gesetzt, aber kein absoluter Pfad. */
export class WeltVerzeichnisUngueltig extends Error {
  constructor(readonly wert: string) {
    super(
      `WOV_WELT_VERZEICHNIS="${wert}" ist kein absoluter Pfad. Ein relativer Wert loest sich je Prozess ` +
        `(Spielserver, Betriebsdienst, Werkzeuge) gegen ein anderes Arbeitsverzeichnis auf und meinte drei ` +
        `verschiedene Ordner. Absoluten Pfad setzen oder die Variable weglassen.`
    );
    this.name = 'WeltVerzeichnisUngueltig';
  }
}

/**
 * Der Ordner der Arbeitskopien, aus dem Datenordner des Servers (`<wurzel>/server/data`):
 *
 *   - `WOV_WELT_VERZEICHNIS` ist gesetzt (nicht leer)  → dieser Wert; er MUSS absolut sein, sonst wirft der
 *     Aufruf `WeltVerzeichnisUngueltig`;
 *   - sonst                                            → `<datenOrdner>/welten-arbeit` (von Git ignoriert).
 *
 * Es gibt bewusst KEINEN Vorgabeordner ausserhalb des Checkouts: `/var/lib/wov/welten` ist die DEV-/Live-Welt.
 * Jeder Prozess ohne Variable (ein Test, ein Slot-Serverstart, `npm run dev`, ein MCP aus einer Kopie)
 * haette sie sonst ueberschrieben, auch der Volltest, den `wov-update.sh` in `/opt/worldofvikings` faehrt.
 */
export function weltArbeitsOrdnerImDatenOrdner(
  datenOrdner: string,
  roh: string | undefined = process.env.WOV_WELT_VERZEICHNIS
): string {
  if (roh !== undefined && roh.trim() !== '') {
    const wert = roh.trim();
    if (!isAbsolute(wert)) throw new WeltVerzeichnisUngueltig(wert);
    return resolve(wert);
  }
  return resolve(datenOrdner, 'welten-arbeit');
}

/**
 * Der Ordner der Arbeitskopien: die Welt, die Spielserver, Betriebsdienst, MCP, Sicherung und Werkzeuge zur
 * Laufzeit lesen und schreiben. `wurzel` ist `WOV_WURZEL` oder die Repo-Wurzel. Die einzige Stelle mit dieser
 * Regel; `weltDatei`, `weltBasisDatei` und der Spielserver gehen alle hierueber.
 */
export function weltArbeitsOrdner(wurzel: string, roh: string | undefined = process.env.WOV_WELT_VERZEICHNIS): string {
  return weltArbeitsOrdnerImDatenOrdner(resolve(wurzel, 'server/data'), roh);
}

/** Die Arbeitskopie der Welt dieser Instanz: `<Arbeitsordner>/<instanz>.json`. Alle Laufzeit-Leser und -Schreiber gehen hierüber. */
export function weltDatei(wurzel: string, instanz: Instanz = instanzName()): string {
  return resolve(weltArbeitsOrdner(wurzel), `${instanz}.json`);
}

/** Die Basis-Datei neben der Arbeitskopie: Hash des Repo-Stands, aus dem sie zuletzt angelegt oder nachgezogen wurde. */
export function weltBasisDatei(wurzel: string, instanz: Instanz = instanzName()): string {
  return resolve(weltArbeitsOrdner(wurzel), `${instanz}.basis`);
}

/** Ordner mit den Spielständen (gitignored — die gehören dem Server). */
export function spielstandOrdner(wurzel: string): string {
  return resolve(wurzel, 'server/data/worlds');
}
