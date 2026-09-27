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
 */
import type { SicherbareGruppe } from './gruppenSicherung';

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
 * - `animieren === true` und etwas war pausiert: `play(true)` setzt GENAU
 *   diese Gruppe fort (kein Sprung), Rueckgabe `undefined`.
 * - `animieren === true` und nichts war pausiert: nichts zu tun.
 */
export function wendeAnimationsLodAn(
  gruppen: readonly SicherbareGruppe[],
  gepaust: SicherbareGruppe | undefined,
  animieren: boolean
): SicherbareGruppe | undefined {
  if (!animieren) {
    const laufend = gruppen.find((g) => g.isPlaying);
    if (!laufend) return gepaust;
    laufend.pause();
    return laufend;
  }
  if (gepaust) gepaust.play(true);
  return undefined;
}
