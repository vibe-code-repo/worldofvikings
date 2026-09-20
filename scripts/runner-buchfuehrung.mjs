/**
 * Buchführung des Sammellaufs (Laufzeitzeuge): Was der Runner WIRKLICH
 * gestartet hat, wird gegen die Liste KERN gehalten.
 *
 * Warum: Ein Zeuge, der den Quelltext von run-tests.mjs mustert, kann nur
 * prüfen, wie die Schleife aussieht. Ob die Tests laufen, sagt er nicht — mit
 * einem Lockvogel-Aufruf und dem echten Start an anderer Stelle (oder mit
 * falschen Argumenten) meldete der Runner „250/250 grün in 0 s". Hier zählt
 * dagegen, was beim Start herausgekommen ist: `fahre` schreibt die Datei auf,
 * die es tatsächlich an den Kindprozess gibt (aus den Argumenten, nicht aus
 * der Schleifenvariablen), und `abschluss` vergleicht am Ende mit der Liste.
 * Der Runner darf beliebig umgebaut werden (Helfer, Teillisten, Filter,
 * `async main`, Parallelisierung) — er muss nur jeden Eintrag von KERN
 * entweder fahren, überspringen (Weiche) oder mit Grund auslassen.
 *
 *   festhalten(KERN, WURZEL)   Momentaufnahme der Soll-Liste, gleich nach der Liste
 *   neueBuchfuehrung()         leeres Buch
 *   fahre(buch, spawn, …)      startet einen Test und bucht die wirklich übergebene Datei
 *   ueberspringe(buch, …)      bucht einen durch eine Weiche übersprungenen Eintrag
 *   auslassen(buch, …)         bucht einen absichtlich ausgelassenen Eintrag (Filter, Teillauf)
 *   abschluss(buch, soll)      Befunde: nie gestartet / nicht in KERN / mehrfach; Teillauf?
 *
 * Wo er nichts sagt: Ein abgebrochener Lauf (Signal, `process.exit`) kommt nie
 * bis `abschluss` und wird deshalb nicht zusätzlich rot. Ein Lauf mit
 * Filter bucht jeden ausgelassenen Eintrag mit `auslassen`; er ist dann
 * vollständig verbucht und wird als TEILLAUF gemeldet, nicht als Fehler.
 *
 * Bookkeeping for the collective run: what the runner REALLY started is held
 * against KERN, instead of reading the source for the shape of the loop.
 */
import { relative, resolve } from 'node:path';

/** Frozen absolute paths of the list, taken right after it is declared. */
export function festhalten(kern, wurzel) {
  return Object.freeze(kern.map(([paket, datei]) => resolve(wurzel, paket, datei)));
}

export function neueBuchfuehrung() {
  return { gefahren: [], uebersprungen: [], ausgelassen: [] };
}

/**
 * Starts one test through `spawn(befehl, argumente, optionen)` and books the
 * file that goes to the child: `argumente[0]` relative to `optionen.cwd`. If
 * no file goes over, the entry is booked as "(keine Datei …)" and the end check
 * reports it.
 */
export function fahre(buch, spawn, befehl, argumente, optionen) {
  const datei = typeof argumente?.[0] === 'string' ? resolve(optionen.cwd, argumente[0]) : `(keine Datei: ${JSON.stringify(argumente)})`;
  buch.gefahren.push(datei);
  return spawn(befehl, argumente, optionen);
}

export function ueberspringe(buch, wurzel, paket, datei) {
  buch.uebersprungen.push(resolve(wurzel, paket, datei));
}

export function auslassen(buch, wurzel, paket, datei, grund) {
  if (typeof grund !== 'string' || grund.trim().length === 0) throw new Error(`auslassen ohne Grund: ${paket}/${datei}`);
  buch.ausgelassen.push(resolve(wurzel, paket, datei));
}

/**
 * The end check. `soll` is what `festhalten` returned. Returns
 * `{ befunde, gefahren, uebersprungen, ausgelassen }`; an empty `befunde` is a pass.
 */
export function abschluss(buch, soll, wurzel = '') {
  const zeigen = (pfad) => (wurzel && pfad.startsWith(wurzel) ? relative(wurzel, pfad) : pfad);
  const gebucht = [...buch.gefahren, ...buch.uebersprungen, ...buch.ausgelassen];
  const zaehler = new Map();
  for (const pfad of gebucht) zaehler.set(pfad, (zaehler.get(pfad) ?? 0) + 1);
  const erwartet = new Map();
  for (const pfad of soll) erwartet.set(pfad, (erwartet.get(pfad) ?? 0) + 1);
  const befunde = [];
  const nie = [...erwartet.keys()].filter((p) => !zaehler.has(p));
  const fremd = [...zaehler.keys()].filter((p) => !erwartet.has(p));
  const mehrfach = [...zaehler].filter(([p, n]) => erwartet.has(p) && n !== erwartet.get(p)).map(([p]) => p);
  const nenne = (liste) => `${liste.slice(0, 5).map(zeigen).join(', ')}${liste.length > 5 ? `, … (${liste.length} insgesamt)` : ''}`;
  if (nie.length > 0) befunde.push(`${nie.length} Test(s) aus KERN nie gestartet, übersprungen oder ausgelassen: ${nenne(nie)}`);
  if (fremd.length > 0) befunde.push(`${fremd.length} gestartete(r) Test(s) stehen nicht in KERN: ${nenne(fremd)}`);
  if (mehrfach.length > 0) befunde.push(`${mehrfach.length} Test(s) öfter oder seltener gebucht als in KERN eingetragen: ${nenne(mehrfach)}`);
  return {
    befunde,
    gefahren: buch.gefahren.length,
    uebersprungen: buch.uebersprungen.length,
    ausgelassen: buch.ausgelassen.length,
  };
}
