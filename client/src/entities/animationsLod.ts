/**
 * Animations-LOD (fps-analyse #9): eine Figur ausserhalb des Sichtkegels
 * ODER weiter als `ANIMATIONS_LOD_GRENZE_M` entfernt wird nicht mehr
 * animiert, sondern pausiert — Skinning-Auswertung und Animatable-Update
 * kosten dann nichts mehr. Kehrt sie zurueck, spielt die GEMERKTE Gruppe
 * mit `play()` weiter (fortgeschriebene Zeit, kein Sprung zu Bild 0) statt
 * mit `start()` neu zu beginnen.
 *
 * Reine Regel, ohne Szene testbar (client/test/animations-lod.ts) — wie
 * `gruppenSicherung.ts`, dessen `SicherbareGruppe`-Typ hier wiederverwendet
 * wird: eine echte `AnimationGroup` erfuellt ihn ohnehin.
 *
 * Nachbesserung (Angriff, 27.09.2026, Befunde B1–B3): Die erste Fassung
 * setzte die gemerkte Gruppe blind mit `play(true)` fort. Zwei Fehler
 * folgten daraus. Erstens wird `loopAnimation` dabei IMMER auf `true`
 * gesetzt — ein Einmal-Clip (`hit`/`attack`/`die`, gestartet mit
 * `start(false, …)`) wird beim Fortsetzen zur Schleife: sein Ende-Ereignis
 * feuert nie mehr, ein toter Wolf stirbt endlos. Zweitens macht Babylons
 * `play()` auf einer GESTOPPTEN Gruppe (`stop(); start()`) — pausiert eine
 * echte Zustandsaenderung (`wechsleAnimation`/`spieleEinmalKreatur`)
 * waehrend der Pause NICHT den alten Zustand, sondern stoppt ihn und
 * startet einen neuen, laeuft die alte, gemerkte Gruppe daneben wieder an.
 * Die Regel jetzt: nur fortsetzen, wenn die gemerkte Gruppe noch
 * (`isStarted && !isPlaying`) ist UND keine andere Gruppe der Instanz
 * bereits laeuft — sonst wurde sie unterdessen gestoppt oder ersetzt, und
 * wird vergessen. Fortgesetzt wird mit ihrem EIGENEN `loopAnimation`.
 */
import type { SicherbareGruppe } from './gruppenSicherung';

/**
 * `SicherbareGruppe` plus die zwei Felder, die diese Regel zusaetzlich
 * braucht, um eine gestoppte/ersetzte Gruppe von einer noch echten Pause
 * zu unterscheiden und deren eigenen Schleifenmodus zu lesen. Eine echte
 * Babylon-`AnimationGroup` erfuellt das ohnehin (`isStarted`,
 * `loopAnimation` sind beides vorhandene Getter) — `gruppenSicherung.ts`
 * bleibt unveraendert, seine Diagnose braucht die beiden Felder nicht.
 */
export interface SicherbareGruppeMitZustand extends SicherbareGruppe {
  readonly isStarted: boolean;
  readonly loopAnimation: boolean;
}

/** Vorschlag der Karte fps-analyse (#9): jenseits dieser Distanz pausiert die Animation. */
export const ANIMATIONS_LOD_GRENZE_M = 60;

/**
 * Ob eine Figur an dieser Stelle animiert werden soll: im Sichtkegel UND
 * nicht weiter als `grenzeM` entfernt. Beides ist eine Vermutung ueber die
 * Sichtbarkeit (ein Punkt statt der echten Huelle) — fuer eine
 * Leistungsmassnahme genuegt das; ein falsches "sichtbar" kostet nur ein
 * paar Bilder Animation zu viel, ein falsches "unsichtbar" waere zwar ein
 * sichtbarer Stillstand, tritt aber nur auf, wenn der Punkt selbst schon
 * ausserhalb liegt.
 */
export function sollAnimieren(distanzM: number, imSichtkegel: boolean, grenzeM: number): boolean {
  return imSichtkegel && distanzM <= grenzeM;
}

/**
 * Wendet die Entscheidung `animieren` auf die Gruppen einer Instanz an.
 *
 * `gepaust` ist der Zustand von zuvor (die Gruppe, die diese Funktion beim
 * letzten Mal pausiert hat, oder `undefined`). Der Aufrufer haelt genau
 * diesen Rueckgabewert und gibt ihn beim naechsten Aufruf wieder herein —
 * so merkt sich NICHT diese Funktion, sondern der Aufrufer (ein Feld an der
 * dynamischen Instanz), welche Gruppe wieder anlaufen soll.
 *
 * - `animieren === false`: die gerade laufende Gruppe (falls es eine gibt)
 *   wird pausiert und zurueckgegeben — AUCH wenn schon etwas gemerkt war.
 *   Das faengt den Fall ab, dass ein echter Zustandswechsel (Server schickt
 *   `idle` statt `walk`) `wechsleAnimation` waehrend der Pause eine FRISCHE
 *   Gruppe hat starten lassen: die laeuft sonst unbemerkt unsichtbar weiter,
 *   weil `gepaust` noch auf die alte, längst gestoppte Gruppe zeigt. Läuft
 *   nichts, bleibt der gemerkte Stand unveraendert (kein Fund heisst nicht
 *   "nichts mehr zu merken").
 * - `animieren === true` und `gepaust` ist NOCH echt pausiert
 *   (`isStarted && !isPlaying`) UND keine andere Gruppe der Instanz laeuft:
 *   `play(gepaust.loopAnimation)` setzt GENAU diese Gruppe mit ihrem
 *   eigenen Schleifenmodus fort (kein Sprung, ein Einmal-Clip bleibt
 *   einmal). Rueckgabe `undefined`.
 * - `animieren === true` und `gepaust` wurde inzwischen gestoppt (eine
 *   echte Zustandsaenderung hat sie laengst durch eine andere Gruppe
 *   ersetzt) oder es laeuft bereits etwas anderes: `gepaust` wird
 *   VERGESSEN, OHNE sie anzufassen — die neue Gruppe laeuft schon richtig.
 * - `animieren === true` und nichts war pausiert: nichts zu tun.
 */
export function wendeAnimationsLodAn(
  gruppen: readonly SicherbareGruppeMitZustand[],
  gepaust: SicherbareGruppeMitZustand | undefined,
  animieren: boolean
): SicherbareGruppeMitZustand | undefined {
  if (!animieren) {
    const laufend = gruppen.find((g) => g.isPlaying);
    if (!laufend) return gepaust;
    laufend.pause();
    return laufend;
  }
  if (gepaust && gepaust.isStarted && !gepaust.isPlaying && !gruppen.some((g) => g.isPlaying)) {
    gepaust.play(gepaust.loopAnimation);
  }
  return undefined;
}
