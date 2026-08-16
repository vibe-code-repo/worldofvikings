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
 * Daraus folgt ALLES andere: die Weltdatei `server/data/welten/<instanz>.json`
 * und der Spielstand `server/data/worlds/<instanz>.db.zst`. Beide Weltdateien
 * liegen auf beiden Containern — live ignoriert `dev.json` nur. Genau deshalb
 * kann der Dev-Editor die Live-Welt bearbeiten, ohne sich mit live zu verbinden.
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

import { resolve } from 'node:path';

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

/** Ordner mit den Weltdokumenten (in Git). `wurzel` ist die Projektwurzel. */
export function weltenOrdner(wurzel: string): string {
  return resolve(wurzel, 'server/data/welten');
}

/** Das Weltdokument dieser Instanz (in Git). */
export function weltDatei(wurzel: string, instanz: Instanz = instanzName()): string {
  return resolve(weltenOrdner(wurzel), `${instanz}.json`);
}

/** Ordner mit den Spielständen (gitignored — die gehören dem Server). */
export function spielstandOrdner(wurzel: string): string {
  return resolve(wurzel, 'server/data/worlds');
}
