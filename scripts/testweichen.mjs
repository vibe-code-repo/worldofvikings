#!/usr/bin/env node
/**
 * Die Weichen des Sammellaufs (S3, Elemente-Umzug): Was setzt ein Test
 * voraus, und was geschieht, wenn die Voraussetzung fehlt?
 *
 * Grundregel, unverändert aus `brauchtModelle`: Die SONDE entscheidet nie,
 * ob sie laufen darf — sie wird rot, wenn sie nichts zu messen findet
 * (sonst geht ein leerer Lauf als Bestehen durch). Übersprungen wird HIER,
 * eine Ebene höher, wo bekannt ist, auf welcher Maschine gerade gefahren
 * wird.
 *
 * Warum eine eigene Datei und nicht weiter unten in `run-tests.mjs`: Eine
 * Weiche, die IMMER „überspringen" sagt, ist von einer richtigen nicht zu
 * unterscheiden — der Lauf ist in beiden Fällen grün, nur misst er nichts
 * mehr. Nachweisen lässt sich das nur, indem man die Weichen aufruft, ohne
 * die Testliste zu fahren; `run-tests.mjs` startet die aber schon beim
 * Import. Der Zeuge steht deshalb in `scripts/pruefe-weichen.mjs`.
 *
 * Skip switches for the collective test run: missing models, missing Blender.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Flatpak-Kennung des lokalen Blender (Gedächtnis: Blender läuft über Flatpak). */
export const BLENDER_REF = 'org.blender.Blender';

/*
  Weiche fuer Tests, die echte Modell-Dateien brauchen.

  `assets/` liegt bewusst AUSSERHALB des Repos (Mike sichert die Modelle
  selbst). Im CI-Checkout gibt es sie also nicht — ein Test, der sie
  misst, waere dort dauerhaft rot und wuerde in kurzer Zeit ignoriert.
  Deshalb: fehlt die Datei, wird der Test als UEBERSPRUNGEN gemeldet und
  zaehlt nicht als Fehler.

  `WOV_OHNE_MODELLE=1` täuscht das Fehlen vor. Das ist kein Komfort,
  sondern die einzige gefahrlose Art, den CI-Fall auf einer Maschine zu
  proben, die die Modelle hat: `assets/models` ist hier ein Symlink auf
  einen GEMEINSAMEN Ordner, den parallele Arbeitsbäume mitbenutzen — ihn
  zum Proben wegzuschieben griffe in fremde Läufe ein.

  Skips when the model files are absent (assets/ lives outside the repo).
*/
export function brauchtModelle(...dateien) {
  return () => {
    if (process.env.WOV_OHNE_MODELLE === '1') {
      return 'WOV_OHNE_MODELLE=1 gesetzt — Modelle von Hand abgeschaltet (Probe des CI-Falls)';
    }
    const missing = dateien.filter((d) => !existsSync(resolve(WURZEL, d)));
    return missing.length === 0
      ? null
      : `Modell-Dateien fehlen (${missing.join(', ')}) — assets/ liegt ausserhalb des Repos`;
  };
}

/*
  Weiche fuer Tests, die den ASSET-SPEICHER brauchen (`assets/store`).

  Er liegt wie `assets/models` ausserhalb des Repos — ein Symlink auf
  `~/wov-assets/store`, 672 Dateien, die nie in Git landen. Im
  CI-Checkout gibt es ihn nicht.

  ── Warum eine EIGENE Weiche und nicht `brauchtModelle` ──────────────
  Die Unterscheidung ist die ganze Absicht: Fehlt der Ordner GANZ, ist
  das der bekannte Zustand einer Maschine ohne Assets — uebersprungen.
  Fehlen EINZELNE Dateien darin, ist der Speicher unvollstaendig oder
  `shared/src/storePrefabs.ts` veraltet, und das ist ein Befund, kein
  Umstand. Deshalb prueft die Weiche NUR den Ordner; die Dateien prueft
  der Test selbst und wird dabei rot.

  `brauchtModelle('assets/store')` taete dasselbe, sagte im Grund aber
  "Modell-Dateien fehlen" — und wer das liest, sucht unter
  `assets/models` und findet dort alles an seinem Platz.

  Skips when the asset store (a symlink outside the repo) is absent;
  missing files INSIDE it are a finding, not a reason to skip.
*/
export function brauchtStore() {
  return () => {
    if (process.env.WOV_OHNE_STORE === '1') {
      return 'WOV_OHNE_STORE=1 gesetzt — Asset-Speicher von Hand abgeschaltet (Probe des CI-Falls)';
    }
    return existsSync(resolve(WURZEL, 'assets/store'))
      ? null
      : 'assets/store fehlt — der Asset-Speicher liegt ausserhalb des Repos (ln -s ~/wov-assets/store assets/store)';
  };
}

/**
 * Grund, warum hier kein Blender läuft — oder `null`, wenn einer läuft.
 *
 * Gefragt wird `flatpak info`, nicht `flatpak run`: Die Auskunft kostet
 * ~0,05 s, ein echter Start je nach Maschine Sekunden, und die Weiche wird
 * vor jedem gefilterten Test ausgewertet. Dass die billige Auskunft mit dem
 * echten Start übereinstimmt, ist nicht angenommen, sondern gemessen —
 * `pruefe-weichen.mjs` startet Blender wirklich und hält beide gegeneinander.
 *
 * Bewusst OHNE Zwischenspeicher: `pruefe-weichen.mjs` verstellt für seine
 * Fälle `PATH` im laufenden Prozess, und ein gemerktes Ergebnis machte aus
 * dem zweiten Fall eine Wiederholung des ersten — die Probe wäre grün, ohne
 * je etwas anderes gefragt zu haben.
 */
export function missingBlenderReason() {
  if (process.env.WOV_OHNE_BLENDER === '1') {
    return 'WOV_OHNE_BLENDER=1 gesetzt — Blender von Hand abgeschaltet (Probe des wov-dev-Falls)';
  }
  const auskunft = spawnSync('flatpak', ['info', '--show-ref', BLENDER_REF], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (auskunft.error) {
    const kennung = auskunft.error.code ?? auskunft.error.message;
    return `flatpak nicht aufrufbar (${kennung}) — Blender läuft hier nur als Flatpak`;
  }
  if (auskunft.status !== 0) {
    return `Flatpak-Blender nicht installiert (flatpak info ${BLENDER_REF} → Code ${auskunft.status})`;
  }
  return null;
}

/*
  Weiche fuer Tests, die BLENDER brauchen — und damit fast immer auch die
  Modelle, denn ein Neubau ist erst dann ein Nachweis, wenn er gegen die
  Auslieferung gehalten wird.

  `wov-dev` hat kein Blender (Konzeptnotiz, Vorhaben 1: 4 GB RAM, zwei
  Kerne), der CI-Checkout auch nicht. Ohne diese Weiche wäre `kit-neubau.mjs`
  dort dauerhaft rot — und ein dauerhaft roter Lauf wird nicht gelesen,
  sondern übergangen; danach fällt auch der ECHTE Fehler nicht mehr auf.

  Skips when neither Flatpak-Blender nor the shipped models are available.
*/
export function brauchtBlender(...dateien) {
  const modelle = brauchtModelle(...dateien);
  return () => missingBlenderReason() ?? modelle();
}
