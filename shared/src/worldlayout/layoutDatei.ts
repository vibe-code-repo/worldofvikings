/**
 * Das Weltdokument auf der Platte: lesen, prüfen, sichern, schreiben.
 *
 * ── Warum diese Datei existiert ──────────────────────────────────────
 * Derselbe Dreisatz — Sicherung mit Rotation, atomares Schreiben über
 * `.tmp` + `rename`, Prüfung durch `sanitizeWorldLayout` — stand bis
 * Block A/16 an ZWEI Stellen: im MCP-Server (tools/worldlayout-mcp) und
 * im Speicher-Plugin des Vite-Servers (client/vite.config.ts). Beide
 * schrieben in dieselbe Datei, aber nur eine der beiden Kopien prüfte
 * streng; die andere kam an `@wov/shared` nicht heran und begnügte sich
 * mit einem Struktur-Check. Zwei Schreibwege auf eine Datei, mit
 * unterschiedlich scharfer Prüfung, sind eine Frage der Zeit.
 *
 * Jetzt gibt es genau EINE Stelle, die das Weltdokument schreibt, und
 * jeder Verwender (Betriebsdienst, MCP-Server) bekommt automatisch
 * dieselbe Prüfung, dieselbe Sicherung und dieselbe Byte-Darstellung.
 *
 * ── Warum NICHT über shared/src/index.ts exportiert ──────────────────
 * Der Barrel geht in den Client-Bundle; `node:fs` hat dort nichts zu
 * suchen (Rollup würde es als externes Modul stehen lassen und der
 * Browser bräche beim Laden ab). Verwender importieren direkt:
 *
 *     import { layoutSchreiben } from '@wov/shared/src/worldlayout/layoutDatei.js';
 *
 * Vorbild ist shared/src/instanz.ts, das aus demselben Grund (dort
 * `process.env`) am Barrel vorbeigeht.
 *
 * ── Die Byte-Darstellung ist Teil des Vertrags ───────────────────────
 * `JSON.stringify(layout, null, 2)` OHNE abschliessenden Zeilenumbruch.
 * shared/test/worldlayout.ts hält für BEIDE Weltdateien fest, dass sie
 * bytegleich durch den Sanitizer gehen. Wer hier das Format ändert —
 * andere Einrückung, Zeilenumbruch am Ende, sortierte Schlüssel —
 * bricht diesen Test und damit die Zusicherung, dass ein Speichervorgang
 * des Editors die Welt nicht stillschweigend umformatiert. Ein Diff mit
 * 3000 geänderten Zeilen versteckt die eine Änderung, auf die es ankam.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { sanitizeWorldLayout } from './sanitize.js';
import type { WorldLayout } from './types.js';

/**
 * So viele Sicherungen bleiben liegen. Zehn ist kein magischer Wert,
 * sondern die Zahl, mit der beide Vorgänger-Kopien gearbeitet haben —
 * genug, um einen verunglückten Editor-Nachmittag zurückzudrehen, wenig
 * genug, dass der Ordner überschaubar bleibt (10 × ~56 KB).
 */
export const SICHERUNGEN_BEHALTEN = 10;

/**
 * Das Dokument ist unbrauchbar — vom Aufrufer als 400 zu behandeln, nicht
 * als 500. Eine eigene Klasse statt eines Fehlertexts, damit der
 * Betriebsdienst „der Nutzer hat Müll geschickt" von „bei mir ist etwas
 * kaputt" unterscheiden kann, ohne in Meldungen zu greppen.
 */
export class LayoutUngueltig extends Error {
  constructor(meldung: string) {
    super(meldung);
    this.name = 'LayoutUngueltig';
  }
}

/** Die verbindliche Byte-Darstellung des Weltdokuments. Siehe Kopf. */
export function layoutText(layout: WorldLayout): string {
  return JSON.stringify(layout, null, 2);
}

/**
 * Weltdokument laden und streng prüfen. Wirft `LayoutUngueltig`, wenn die
 * Datei fehlt, kein JSON ist oder den Sanitizer nicht übersteht.
 *
 * Bewusst wird das GEPRÜFTE Dokument zurückgegeben, nicht der Rohtext:
 * Wer liest, soll dasselbe sehen wie der Spielserver beim Start — sonst
 * zeigt der Editor Felder an, die der Server anschliessend wegwirft.
 */
export function layoutLesen(pfad: string): WorldLayout {
  let roh: unknown;
  try {
    roh = JSON.parse(readFileSync(pfad, 'utf-8'));
  } catch (fehler) {
    throw new LayoutUngueltig(`${basename(pfad)} nicht lesbar: ${(fehler as Error).message}`);
  }
  const sauber = sanitizeWorldLayout(roh);
  if (!sauber) throw new LayoutUngueltig(`${basename(pfad)} ist kein gültiges WorldLayout`);
  return sauber;
}

/**
 * Zeitgestempelte Sicherung anlegen und die ältesten wegräumen; gibt den
 * Pfad der neuen Sicherung zurück (oder null, wenn es noch nichts zu
 * sichern gab).
 *
 * Die Namen tragen den ISO-Zeitstempel, deshalb sortiert ein einfaches
 * `.sort()` sie chronologisch — kein `statSync` pro Datei nötig, und das
 * Ergebnis hängt nicht an mtime-Werten, die ein `cp -a` verschieben kann.
 */
export function layoutSichern(pfad: string, behalten = SICHERUNGEN_BEHALTEN): string | null {
  if (!existsSync(pfad)) return null;
  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  const ziel = `${pfad}.${stempel}.bak`;
  copyFileSync(pfad, ziel);
  const ordner = dirname(pfad);
  const name = basename(pfad);
  const alte = readdirSync(ordner)
    .filter((f) => f.startsWith(`${name}.`) && f.endsWith('.bak'))
    .sort();
  while (alte.length > behalten) unlinkSync(resolve(ordner, alte.shift()!));
  return ziel;
}

/**
 * Weltdokument prüfen, sichern und atomar schreiben — der EINZIGE
 * Schreibweg auf die Weltdatei.
 *
 * `eingabe` ist absichtlich `unknown`: Der Aufrufer soll nicht in die
 * Lage kommen, mit einem `as WorldLayout` an der Prüfung vorbeizukommen.
 * Was hier hineingeht, geht durch `sanitizeWorldLayout` — auch das, was
 * der Aufrufer schon selbst sanitisiert hat (der Sanitizer ist
 * idempotent, genau das hält der Bytegleich-Test in
 * shared/test/worldlayout.ts fest).
 *
 * ── Reihenfolge: erst sichern, dann schreiben ────────────────────────
 * Und zwar UNGESCHÜTZT: Schlägt die Sicherung fehl (Platte voll, Ordner
 * nur lesbar), bricht der Vorgang ab, bevor irgendetwas überschrieben
 * ist. Die MCP-Kopie fing den Fehler hier bisher ab und schrieb trotzdem
 * — das ist genau der Fall, in dem man die Sicherung gebraucht hätte.
 *
 * ── Warum .tmp + rename ──────────────────────────────────────────────
 * `rename` innerhalb desselben Dateisystems ist atomar: Ein Stromausfall
 * mitten im Schreiben hinterlässt die alte Datei vollständig, nie eine
 * halbe. Direkt in die Zieldatei zu schreiben hiesse, dass der
 * Spielserver beim Start eine abgeschnittene Welt lesen könnte.
 */
export function layoutSchreiben(
  pfad: string,
  eingabe: unknown,
  behalten = SICHERUNGEN_BEHALTEN
): { layout: WorldLayout; sicherung: string | null; text: string } {
  const layout = sanitizeWorldLayout(eingabe);
  if (!layout) throw new LayoutUngueltig('Kein gültiges WorldLayout — verworfen');
  // ── Warum diese zusätzliche Hürde ──────────────────────────────────
  // Der Sanitizer klemmt und verwirft, aber er WIRFT nicht: Ein Dokument
  //     { version: 1, name: "x", regions: "kein Array" }
  // kommt als vollständig gültiges Layout mit NULL Regionen heraus —
  // offene See. Genau das fällt aus einem halb übertragenen Upload, einem
  // vertauschten Feld oder einem Editor-Zustand heraus, der noch nichts
  // geladen hatte. Ohne diese Zeile ersetzte so ein Fehlgriff eine Welt
  // mit 158 Platzierungen durch 102 Bytes Wasser, und zwar mit 200 OK.
  //
  // Der alte Struktur-Check im Vite-Plugin hat das nebenbei mit erledigt
  // (`Array.isArray(sauber.regions)`); beim Umstieg auf die STRENGE
  // Prüfung wäre diese Zusicherung sonst verlorengegangen — die strengere
  // Prüfung ist an dieser einen Stelle die nachsichtigere.
  //
  // Nur beim SCHREIBEN, nicht beim Lesen: Wer eine leere Datei von Hand
  // hinlegt, soll sie noch öffnen und reparieren können.
  if (layout.regions.length === 0) {
    throw new LayoutUngueltig(
      'Weltdokument ohne eine einzige Region — verworfen. Das wäre eine Welt aus offener See; ' +
        'wahrscheinlich ist das Dokument unvollständig übertragen worden.'
    );
  }
  const text = layoutText(layout);
  const sicherung = layoutSichern(pfad, behalten);
  mkdirSync(dirname(pfad), { recursive: true });
  const tmp = `${pfad}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, pfad);
  return { layout, sicherung, text };
}
