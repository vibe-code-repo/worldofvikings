#!/usr/bin/env node
/**
 * Fügt einen Tageseintrag in die Dev-Log-Datei ein (`devlog.json`).
 *
 *   node tools/devlog/eintragen.mjs --datei <devlog.json> --eintrag <tag.json> [--sperrliste <datei>]
 *
 * Das Schema kommt aus `wov-web/src/lib/devlog.ts`, derselben Datei, die die
 * Seite liest (eine Quelle, kein Nachbau). Darüber hinaus lehnt das Werkzeug
 * interne Spuren ab, die auf einer öffentlichen Seite nichts verloren haben:
 * PR- und Issue-Nummern, Commit-Hashes, Dateipfade und Dateiendungen sowie
 * jedes Muster der Sperrliste. Die Sperrliste liegt nicht im Repo; eine Zeile
 * je Muster, Teiltreffer ohne Beachtung der Groß- und Kleinschreibung (kein
 * regulärer Ausdruck, damit ein Tippfehler in der Liste nichts sprengt).
 *
 * Schreiben: temporäre Datei im selben Ordner, dann `rename` — ein Abbruch
 * hinterlässt die alte Datei ganz. Ein zweiter Lauf mit demselben Eintrag
 * ergibt byte-gleiche Ausgabe.
 *
 * Exit: 0 eingetragen, 1 Eintrag abgelehnt (Schema oder interne Spur),
 * 2 Aufruf- oder Dateifehler.
 *
 * Inserts one day's entry into devlog.json: schema from the shared module,
 * rejects internal traces, atomic write, idempotent.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DATEI_MAX_BYTES,
  fuegeEin,
  leseDevlog,
  pruefeEintrag,
  SPRACHEN,
} from "../../wov-web/src/lib/devlog.ts";

/** Ein Wort, das nach Quelltext riecht; die Liste ist bewusst nicht kürzer als die Karte. */
const ENDUNGEN = /\b[\w-]+\.(?:ts|tsx|mjs|js|json|svelte|yml|yaml|md)\b/i;
const WURZELORDNER =
  /(?:^|[^\w/])(?:server|client|shared|tools|scripts|deploy|wov-web|src|admin|packages)\/[\w.-]/i;

/**
 * Die Regeln, je mit Namen für die Meldung. Ein Hash ist 7–40 Hexzeichen, die
 * mindestens eine Ziffer UND einen Buchstaben enthalten: reine Buchstabenwörter
 * („defaced“) und reine Zahlen („1000000 Gold“) sind keine Hashes.
 */
const REGELN = [
  { name: "PR- oder Issue-Nummer", treffer: (t) => /#\d+/.exec(t)?.[0] },
  {
    name: "Commit-Hash",
    treffer: (t) => {
      for (const m of t.matchAll(/(?<![\w])[0-9a-f]{7,40}(?![\w])/gi)) {
        if (/\d/.test(m[0]) && /[a-f]/i.test(m[0])) return m[0];
      }
      return undefined;
    },
  },
  {
    name: "Dateipfad",
    treffer: (t) =>
      WURZELORDNER.exec(t)?.[0].trim() ??
      /(?:^|[\s("'])(?:\.{1,2}\/|\/)?[\w.-]+(?:\/[\w.-]+){2,}/.exec(t)?.[0].trim() ??
      /(?:^|[\s("'])(?:\.{1,2}\/|\/)[\w.-]+/.exec(t)?.[0].trim(),
  },
  { name: "Dateiendung", treffer: (t) => ENDUNGEN.exec(t)?.[0] },
];

/** Alle Texte eines Eintrags mit ihrem Ort (`de.punkte[1]`). */
export function texteVon(eintrag) {
  const aus = [];
  for (const s of SPRACHEN) {
    const block = eintrag[s];
    if (!block) continue;
    aus.push([`${s}.titel`, block.titel]);
    block.punkte.forEach((p, i) => aus.push([`${s}.punkte[${i}]`, p]));
  }
  return aus;
}

/** Liest die Sperrliste: eine Zeile je Muster, leere Zeilen und `#`-Zeilen zählen nicht. */
export function leseSperrliste(text) {
  return text
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter((z) => z !== "" && !z.startsWith("#"));
}

/** Findet interne Spuren; leere Liste heißt sauber. */
export function findeSpuren(eintrag, sperrliste = []) {
  const funde = [];
  for (const [ort, text] of texteVon(eintrag)) {
    for (const regel of REGELN) {
      const t = regel.treffer(text);
      if (t) funde.push(`${ort}: ${regel.name} „${t}“`);
    }
    const klein = text.toLowerCase();
    for (const muster of sperrliste) {
      if (klein.includes(muster.toLowerCase())) funde.push(`${ort}: Sperrwort „${muster}“`);
    }
  }
  return funde;
}

/**
 * Schreibt atomar: temporäre Datei im Zielordner (gleiches Dateisystem, sonst
 * wäre `rename` kein Umhängen), Inhalt auf die Platte, dann `rename`. Scheitert
 * ein Schritt, wird die temporäre Datei entfernt und die Zieldatei bleibt, wie sie war.
 * `fs` ist austauschbar, damit der Test den Abbruch nachstellen kann.
 */
export function schreibeAtomar(
  ziel,
  text,
  fs = { openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync },
) {
  const tmp = join(dirname(ziel), `.${basename(ziel)}.${process.pid}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "w", 0o644);
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, ziel);
  } catch (e) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Aufräumen nach einem Fehler: der erste Fehler wird geworfen, nicht dieser.
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Die temporäre Datei gibt es womöglich nie (open scheiterte); kein zweiter Fehler.
    }
    throw e;
  }
}

function argumente(argv) {
  const aus = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!["--datei", "--eintrag", "--sperrliste"].includes(k) || argv[i + 1] === undefined) {
      throw new Error(`Unbekanntes oder unvollständiges Argument: ${k}`);
    }
    aus[k.slice(2)] = argv[i + 1];
  }
  if (!aus.datei || !aus.eintrag) throw new Error("--datei und --eintrag sind Pflicht");
  return aus;
}

function leseJson(pfad, was) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch (e) {
    throw new Error(`${was} (${pfad}) nicht lesbar: ${e.message}`);
  }
}

export function main(argv) {
  let a;
  try {
    a = argumente(argv);
  } catch (e) {
    console.error(
      `${e.message}\nAufruf: eintragen.mjs --datei <devlog.json> --eintrag <tag.json> [--sperrliste <datei>]`,
    );
    return 2;
  }
  let eintrag;
  let vorhanden = [];
  let sperrliste = [];
  try {
    eintrag = leseJson(a.eintrag, "Eintrag");
    if (a.sperrliste) sperrliste = leseSperrliste(readFileSync(a.sperrliste, "utf8"));
    if (existsSync(a.datei)) {
      const gelesen = leseDevlog(leseJson(a.datei, "Datei"));
      vorhanden = gelesen.eintraege;
      if (gelesen.uebersprungen > 0) {
        console.error(
          `Hinweis: ${gelesen.uebersprungen} ungültige oder doppelte Einträge in der Datei entfernt.`,
        );
      }
    }
  } catch (e) {
    console.error(e.message);
    return 2;
  }

  const schemaFehler = pruefeEintrag(eintrag, true);
  if (schemaFehler.length > 0) {
    console.error(`Eintrag abgelehnt (Schema):\n  ${schemaFehler.join("\n  ")}`);
    return 1;
  }
  const spuren = findeSpuren(eintrag, sperrliste);
  if (spuren.length > 0) {
    console.error(`Eintrag abgelehnt (interne Spur):\n  ${spuren.join("\n  ")}`);
    return 1;
  }

  const ergebnis = fuegeEin(vorhanden, eintrag, DATEI_MAX_BYTES);
  try {
    schreibeAtomar(a.datei, ergebnis.text);
  } catch (e) {
    console.error(`Schreiben fehlgeschlagen: ${e.message}`);
    return 2;
  }
  console.log(
    `${ergebnis.ersetzt ? "ersetzt" : "eingefügt"}: ${eintrag.datum}, ${ergebnis.eintraege.length} Einträge, ` +
      `${Buffer.byteLength(ergebnis.text)} Byte` +
      (ergebnis.abgeschnitten > 0 ? `, ${ergebnis.abgeschnitten} älteste gekürzt` : ""),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
