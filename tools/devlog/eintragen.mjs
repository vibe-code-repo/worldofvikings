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
 * Vor jedem Vergleich wird der Text normalisiert (NFKC, Zeichen der
 * Kategorien Cf und Mn entfernt, klein geschrieben); die Sperrliste genauso.
 * Steuer- und Formatzeichen (Cc, Cf: Bidi, Null-Breite) im Rohtext lehnt das
 * Werkzeug ganz ab. Wörter über 40 Zeichen werden beim Eintragen abgelehnt.
 *
 * Schreiben: temporäre Datei im selben Ordner, dann `rename` — ein Abbruch
 * hinterlässt die alte Datei ganz. Ein zweiter Lauf mit demselben Eintrag
 * ergibt byte-gleiche Ausgabe.
 *
 * Gleichzeitige Läufe schließt die Sperrdatei `<datei>.lock` aus (PID darin,
 * über 10 Minuten alt gilt sie als verwaist). Entfernt ein Lauf ungültige
 * Alteinträge, legt er vorher `<datei>.bak-<UTC>` ab (höchstens 5 bleiben).
 *
 * Exit: 0 eingetragen, 1 Eintrag abgelehnt (Schema oder interne Spur),
 * 2 Aufruf-, Datei- oder Sperrfehler.
 *
 * Inserts one day's entry into devlog.json: schema from the shared module,
 * rejects internal traces, atomic write, idempotent.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
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
  pruefeWortLaenge,
  SPRACHEN,
} from "../../wov-web/src/lib/devlog.ts";

/**
 * Text glätten: NFKC (Vollbreite, Ligaturen, „ſ“ werden normal), Zeichen der
 * Kategorien Cf (Null-Breite, Bidi, weiche Trennung) und Mn (kombinierende
 * Zeichen) entfernen, Leerraum zusammenfassen. Die Groß-/Kleinschreibung bleibt
 * (die Endungsregel braucht sie); `normalisiert` schreibt klein.
 */
export function glaette(text) {
  return text
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Mn}]/gu, "")
    .replace(/\s+/gu, " ");
}

export function normalisiert(text) {
  return glaette(text).toLowerCase();
}

/** Endungen, die nach Quelltext oder Betriebsdatei riechen. */
const ENDUNG = "(?:ts|tsx|mjs|js|json|svelte|yml|yaml|md|py|sh|css|html|glb|blend|conf)";
const ENDUNGEN = new RegExp(`([\\p{L}\\p{N}_./-]+)\\.(${ENDUNG})(?![\\p{L}\\p{N}_])`, "giu");

/**
 * Erste Dateiendung im Text. Der Teil vor dem Punkt muss kleingeschrieben sein
 * oder einen Schrägstrich enthalten; ausgenommen ist nur `.js` hinter einem
 * Namen mit Großbuchstaben und ohne Schrägstrich („Node.js“, „Vue.js“). Für
 * alle anderen Endungen bleibt auch „Welt.ts“ gesperrt: Klassendateien heißen
 * oft groß („WovServer.ts“), und ihr Name wäre genau die Spur, die wegsoll.
 */
function endungTreffer(glatt) {
  for (const m of glatt.replace(/\\/g, "/").matchAll(ENDUNGEN)) {
    const [ganz, vor, endung] = m;
    const markenname =
      endung === "js" && /\p{Lu}/u.test(vor) && !vor.includes("/");
    if (!markenname) return ganz;
  }
  return undefined;
}

const WURZELORDNER =
  /(?:^|[^\w/])(?:server|client|shared|tools|scripts|deploy|wov-web|src|admin|packages)\/[\w.-]/;

/**
 * Die Regeln, je mit Namen für die Meldung. `n` ist der normalisierte Text
 * (klein), `g` der geglättete mit Großschreibung. Ein Hash ist 7–40
 * Hexzeichen (auch mit einzelnen Bindestrichen dazwischen), die mindestens
 * eine Ziffer UND einen Buchstaben enthalten: reine Buchstabenwörter
 * („defaced“) und reine Zahlen („1000000 Gold“) sind keine Hashes.
 */
const REGELN = [
  {
    name: "PR- oder Issue-Nummer",
    treffer: (n) =>
      /#\d+/.exec(n)?.[0] ??
      /\b(?:pull[\s_-]*request|pr|pull|issue|gh|commit)s?\b[\s#/_-]*\d+/.exec(n)?.[0],
  },
  {
    name: "Commit-Hash",
    treffer: (n) => {
      for (const m of n.matchAll(
        /(?<![\p{L}\p{N}_])[0-9a-f](?:-?[0-9a-f]){6,39}(?![\p{L}\p{N}_])/gu,
      )) {
        if (/\d/.test(m[0]) && /[a-f]/.test(m[0])) return m[0];
      }
      return undefined;
    },
  },
  { name: "Adresse (URL)", treffer: (n) => /https?:\/\/|www\.|github\.com/.exec(n)?.[0] },
  {
    name: "Serveradresse oder Heimpfad",
    treffer: (n) =>
      /localhost:\d+|wov-(?:dev|host|lab|live)|(?<![\w.-])~\//.exec(n)?.[0],
  },
  {
    // Ein Pfad zählt nur mit Wurzelordner, führendem / ./ ../ ~/ oder Laufwerk
    // (oder über die Endungsregel); „Feuer/Wasser/Erde“ und „3/4“ sind keiner.
    name: "Dateipfad",
    treffer: (n) => {
      const p = n.replace(/\\/g, "/");
      return (
        WURZELORDNER.exec(p)?.[0].trim() ??
        /(?:^|[\s("'])(?:\.{1,2}\/|~\/|\/)[\w.-]+/.exec(p)?.[0].trim() ??
        /(?<![\w])[a-z]:\/[\w.-]+/.exec(p)?.[0]
      );
    },
  },
  { name: "Dateiendung", treffer: (_n, g) => endungTreffer(g) },
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

/** Erstes Zeichen der Kategorien Cc oder Cf im Rohtext, als `U+XXXX`. */
function steuerzeichen(text) {
  const m = /[\p{Cc}\p{Cf}]/u.exec(text);
  return m ? `U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}` : undefined;
}

/** Findet interne Spuren; leere Liste heißt sauber. */
export function findeSpuren(eintrag, sperrliste = []) {
  const gelesen = sperrliste.map((m) => [normalisiert(m).trim(), m]).filter(([m]) => m !== "");
  const muster = gelesen.map(([m]) => m);
  const roh = new Map(gelesen);
  const funde = [];
  for (const [ort, text] of texteVon(eintrag)) {
    const zeichen = steuerzeichen(text);
    if (zeichen) funde.push(`${ort}: Steuer- oder Formatzeichen ${zeichen}`);
    const g = glaette(text);
    const n = g.toLowerCase();
    for (const regel of REGELN) {
      const t = regel.treffer(n, g);
      if (t) funde.push(`${ort}: ${regel.name} „${t}“`);
    }
    for (const m of muster) {
      if (n.includes(m)) funde.push(`${ort}: Sperrwort „${roh.get(m)}“`);
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

/** Ab diesem Alter gilt eine Sperrdatei als verwaist (abgestürzter Lauf). */
export const SPERRE_VERALTET_MS = 10 * 60 * 1000;
/** So viele Sicherungen `<datei>.bak-<UTC>` bleiben liegen. */
export const SICHERUNGEN_MAX = 5;

/**
 * Nimmt die Sperre `<datei>.lock` (`open` mit `wx`, die PID steht darin).
 * Gibt die Freigabefunktion zurück; wirft bei belegter Sperre einen Fehler mit
 * `code: "BELEGT"`. Eine Sperre über `SPERRE_VERALTET_MS` alt wird übernommen:
 * per `rename` auf einen eigenen Namen, das gelingt nur einem von mehreren
 * gleichzeitigen Übernehmern.
 */
export function nimmSperre(datei, jetzt = Date.now()) {
  const sperre = `${datei}.lock`;
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      const fd = openSync(sperre, "wx", 0o644);
      try {
        writeSync(fd, `${process.pid}\n`);
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (readFileSync(sperre, "utf8").trim() === String(process.pid)) unlinkSync(sperre);
        } catch {
          // Schon weg oder übernommen: nichts mehr freizugeben.
        }
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let alter;
      let pid = "?";
      try {
        alter = jetzt - statSync(sperre).mtimeMs;
        pid = readFileSync(sperre, "utf8").trim() || "?";
      } catch {
        continue; // zwischen open und stat verschwunden: noch einmal versuchen
      }
      if (alter > SPERRE_VERALTET_MS && versuch === 0) {
        try {
          renameSync(sperre, `${sperre}.verwaist-${process.pid}`);
          unlinkSync(`${sperre}.verwaist-${process.pid}`);
        } catch {
          // Ein anderer Lauf war schneller; der zweite Versuch entscheidet.
        }
        continue;
      }
      const fehler = new Error(
        `Sperre ${sperre} belegt (PID ${pid}, ${Math.round(alter / 1000)} s alt): ein anderer Lauf schreibt gerade`,
      );
      fehler.code = "BELEGT";
      throw fehler;
    }
  }
  const fehler = new Error(`Sperre ${sperre} nicht zu bekommen: ein anderer Lauf war schneller`);
  fehler.code = "BELEGT";
  throw fehler;
}

/**
 * Legt `<datei>.bak-<UTC-Zeitstempel>` an und löscht die ältesten, sodass
 * höchstens `SICHERUNGEN_MAX` bleiben. Der Zeitstempel trägt Millisekunden
 * (`20260930T164229123Z`), damit er sich sortieren lässt und zwei Läufe in
 * einer Sekunde sich nicht überschreiben.
 */
export function sichere(datei, jetzt = new Date()) {
  const stempel = jetzt.toISOString().replace(/[-:]/g, "").replace(".", "");
  const ziel = `${datei}.bak-${stempel}`;
  copyFileSync(datei, ziel);
  const praefix = `${basename(datei)}.bak-`;
  const alle = readdirSync(dirname(datei))
    .filter((n) => n.startsWith(praefix))
    .sort();
  for (const n of alle.slice(0, Math.max(0, alle.length - SICHERUNGEN_MAX))) {
    unlinkSync(join(dirname(datei), n));
  }
  return ziel;
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
  let freigeben;
  try {
    freigeben = nimmSperre(a.datei);
  } catch (e) {
    console.error(e.code === "BELEGT" ? e.message : `Sperre nicht anlegbar: ${e.message}`);
    return 2;
  }
  try {
    return eintragen(a);
  } finally {
    freigeben();
  }
}

function eintragen(a) {
  let eintrag;
  let vorhanden = [];
  let entfernt = 0;
  let sperrliste = [];
  try {
    eintrag = leseJson(a.eintrag, "Eintrag");
    if (a.sperrliste) sperrliste = leseSperrliste(readFileSync(a.sperrliste, "utf8"));
    if (existsSync(a.datei)) {
      const gelesen = leseDevlog(leseJson(a.datei, "Datei"));
      vorhanden = gelesen.eintraege;
      entfernt = gelesen.uebersprungen;
    }
  } catch (e) {
    console.error(e.message);
    return 2;
  }

  const schemaFehler = pruefeEintrag(eintrag, true);
  // Die Wortgrenze setzt einen schemagültigen Eintrag voraus und gilt nur hier.
  if (schemaFehler.length === 0) schemaFehler.push(...pruefeWortLaenge(eintrag));
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
    if (entfernt > 0) {
      const kopie = sichere(a.datei);
      console.error(
        `Hinweis: ${entfernt} ungültige oder doppelte Einträge in der Datei entfernt; Sicherung: ${kopie}`,
      );
    }
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
