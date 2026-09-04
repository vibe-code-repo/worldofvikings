// Hilfsmittel: sagt den Browser-Aufnahmen, wohin ihre PNG gehören — ein Ort, einmal festgelegt.
/*
  S2 (04.09.2026): Die fünf Aufnahme-Skripte hatten
  `${process.env.HOME}/wov-ai/pipeline-1.0/preview/…` je einzeln im Aufruf
  stehen. Fünfmal derselbe fremde Ort heisst: Wer ihn ändert, ändert ihn
  viermal und übersieht das fünfte — und auf einem Rechner ohne ~/wov-ai
  stirbt jedes der fünf an derselben Stelle mit derselben Meldung.

  Deshalb steht die Regel hier, einmal:
    * Ziel ist $WOV_ELEMENTE_AUS/aufnahmen (Vorgabe ~/wov-elemente/aufnahmen).
    * Der Ordner liegt AUSSERHALB des Repos — Bilder sind Ergebnis, nicht
      Rezept (tools/README.md). Deshalb auch kein Vorgabewert im Repo.
*/
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Legt den Aufnahmeordner an und gibt den Pfad für `datei` zurück. */
export function aufnahme(datei) {
  const ordner = join(process.env.WOV_ELEMENTE_AUS ?? join(homedir(), 'wov-elemente'), 'aufnahmen');
  mkdirSync(ordner, { recursive: true });
  return join(ordner, datei);
}
