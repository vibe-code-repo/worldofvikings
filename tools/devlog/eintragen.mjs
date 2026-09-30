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
 * Gleichzeitige Läufe schließt eine Kernel-Sperre aus: Der Lauf startet sich
 * unter `flock -n -E 75 <datei>.lock` selbst neu. Die Sperre ist atomar, fällt
 * mit dem Tod des Prozesses (auch SIGKILL) und braucht keine Wartezeit; die
 * leere Datei `<datei>.lock` bleibt liegen und ist kein Zustand. Entfernt ein
 * Lauf ungültige Alteinträge, legt er vorher `<datei>.bak-<UTC>` ab (höchstens
 * 5 bleiben, nur Dateien genau dieses Namensmusters).
 *
 * `--pruefen --eintrag <tag.json> [--sperrliste <datei>]` prüft nur (Schema,
 * Wortlänge, Zeichen, Spuren): schreibt nichts, nimmt keine Sperre.
 *
 * Exit: 0 eingetragen (bzw. Prüfung bestanden), 1 Eintrag abgelehnt (Schema
 * oder interne Spur), 2 Aufruf- oder Dateifehler, 3 Ziel gesperrt (ein anderer
 * Lauf schreibt gerade).
 *
 * Inserts one day's entry into devlog.json: schema from the shared module,
 * rejects internal traces, atomic write, idempotent.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

/** Endungen, die nach Quelltext, Betriebs- oder Mediendatei riechen. */
const ENDUNG =
  "(?:ts|tsx|mjs|js|jsx|json|svelte|yml|yaml|md|py|sh|css|html|glb|blend|conf|png|jpg|jpeg|webp|svg|gif|txt|log|exe|dll|so|cpp|c|h|hpp|rs|go|rb|lua|sql|csv|xml|ini|toml|zip|gz|tar|gltf|fbx|wav|ogg|mp3|ktx2|bin|java)";
const ENDUNGEN = new RegExp(`([\\p{L}\\p{N}_./-]+)\\.(${ENDUNG})(?![\\p{L}\\p{N}_])`, "giu");
/** Namen von Bibliotheken, die auf `.js` enden und im Spielertext vorkommen dürfen. */
const JS_MARKEN = new Set([
  "node", "vue", "next", "nuxt", "react", "d3", "three", "babylon", "express", "ember",
  "alpine", "p5", "chart", "socket", "backbone", "angular",
]);

/**
 * Erste Dateiendung im Text. Eine Endung zählt nur ganz klein oder ganz groß
 * geschrieben („Welt.ts“, „Welt.TS“); „Heute.Html“ oder „Ja.Md“ (fehlendes
 * Leerzeichen nach dem Satzpunkt, Wortanfang groß) sind keine Dateinamen.
 * Ausgenommen sind Einbuchstaben-Endungen hinter einem Ein-Zeichen-Stamm
 * („d.h.“) und `.js` hinter einem Bibliotheksnamen („node.js“) oder einem
 * Namen mit Großbuchstaben ohne Schrägstrich („Vue.js“). Für alle anderen
 * Endungen bleibt auch „WovServer.ts“ gesperrt: Klassendateien heißen oft
 * groß, und ihr Name wäre genau die Spur, die wegsoll.
 */
function endungTreffer(glatt) {
  for (const m of glatt.replace(/\\/g, "/").matchAll(ENDUNGEN)) {
    const [ganz, vor, endung] = m;
    if (endung !== endung.toLowerCase() && endung !== endung.toUpperCase()) continue;
    if (endung.length === 1 && [...vor].length < 2) continue;
    const klein = endung.toLowerCase();
    const marke =
      klein === "js" &&
      !vor.includes("/") &&
      (/\p{Lu}/u.test(vor) || JS_MARKEN.has(vor.toLowerCase()));
    if (!marke) return ganz;
  }
  return undefined;
}

const WURZELORDNER =
  /(?:^|[^\w/])(?:server|client|shared|tools|scripts|deploy|wov-web|src|admin|packages)\/[\w.-]/;

/**
 * Hash-Kandidat: Hexzeichen, auch mit Bindestrichen dazwischen. Ohne
 * Bindestrich gilt er ab 7 Zeichen mit Ziffer UND Buchstabe a–f, oder ab 10
 * Zeichen nur aus Buchstaben a–f („deadbeefcafe“; „defaced“ bleibt frei). Mit
 * Bindestrich müssen alle Teile eine Ziffer tragen und zusammen Ziffer und
 * Buchstabe haben: „a1b2-c3d4e5“ ist ein Hash, „Feb-2026“ und „Cafe-2026“
 * nicht. Reine Zahlen („1000000 Gold“) sind nie einer.
 */
function hashTreffer(n) {
  for (const m of n.matchAll(
    /(?<![\p{L}\p{N}_])[0-9a-f]+(?:-[0-9a-f]+)*(?![\p{L}\p{N}_])/gu,
  )) {
    const teile = m[0].split("-");
    const hex = teile.join("");
    if (hex.length < 7 || hex.length > 40) continue;
    const ziffer = /\d/.test(hex);
    const buchstabe = /[a-f]/.test(hex);
    if (teile.length === 1) {
      if ((ziffer && buchstabe) || (!ziffer && hex.length >= 10)) return m[0];
    } else if (ziffer && buchstabe && teile.every((t) => /\d/.test(t))) {
      return m[0];
    }
  }
  return undefined;
}

/**
 * Die Regeln, je mit Namen für die Meldung. `n` ist der normalisierte Text
 * (klein), `g` der geglättete mit Großschreibung.
 */
const REGELN = [
  {
    name: "fremde Schrift",
    // Nur Latin, Common (Ziffern, Satzzeichen, Emoji) und Inherited: ein
    // kyrillisches „о“ in einem Sperrwort wäre sonst unsichtbar.
    treffer: (_n, g) =>
      /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.exec(g)?.[0],
  },
  {
    // `#` mit einer Ziffer („Platz #1“) ist erlaubt, ab zwei Ziffern gesperrt;
    // Schlagwörter sperren mit `#` oder `/` oder ab zwei Ziffern.
    name: "PR- oder Issue-Nummer",
    treffer: (n) =>
      /#\s*\d{2,}/.exec(n)?.[0] ??
      /\b(?:pull[\s_-]*requests?|prs?|pulls?|issues?|gh|commits?)(?:[\s_-]*[#/][\s_-]*\d+|[\s_-]*\d{2,})/.exec(
        n,
      )?.[0],
  },
  { name: "Commit-Hash", treffer: (n) => hashTreffer(n) },
  {
    name: "Adresse (URL)",
    treffer: (n) =>
      /(?<![\p{L}\p{N}_])[a-z][a-z0-9+.-]*\s*[:∶꞉]\s*\/\//u.exec(n)?.[0] ??
      /mailto\s*:|www\./.exec(n)?.[0] ??
      /(?<![\p{L}\p{N}])g[\s._·-]*i[\s._·-]*t[\s._·-]*h[\s._·-]*u[\s._·-]*b/u.exec(n)?.[0],
  },
  {
    name: "Serveradresse oder Heimpfad",
    treffer: (n) =>
      /localhost\s*:\s*\d+|(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?!\d)|(?<![\p{L}\p{N}_])wov[\s_-]*(?:dev|host|lab|live)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])ports?\s*:?\s*\d+|(?<![\w.-])~\//u.exec(
        n,
      )?.[0],
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
        /(?<![\w])[a-z]\s?:\/[\w.-]+/.exec(p)?.[0]
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
  fs = { openSync, fchmodSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync },
) {
  const tmp = join(dirname(ziel), `.${basename(ziel)}.${process.pid}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "w", 0o644);
    // Modus ausdrücklich setzen: `open` beachtet die umask, nginx (www-data) muss lesen können.
    fs.fchmodSync(fd, 0o644);
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
  const aus = { pruefen: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--pruefen") {
      aus.pruefen = true;
    } else if (["--datei", "--eintrag", "--sperrliste"].includes(k) && argv[i + 1] !== undefined) {
      aus[k.slice(2)] = argv[++i];
    } else {
      throw new Error(`Unbekanntes oder unvollständiges Argument: ${k}`);
    }
  }
  if (!aus.eintrag) throw new Error("--eintrag ist Pflicht");
  if (!aus.pruefen && !aus.datei) throw new Error("--datei ist Pflicht (außer mit --pruefen)");
  return aus;
}

function leseJson(pfad, was) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch (e) {
    throw new Error(`${was} (${pfad}) nicht lesbar: ${e.message}`);
  }
}

/** So viele Sicherungen `<datei>.bak-<UTC>` bleiben liegen. */
export const SICHERUNGEN_MAX = 5;
/** Exit-Code von `flock -E`, wenn die Sperre belegt ist; wird zu Exit 3. */
const FLOCK_BELEGT = 75;
/** Gesetzt im Kindprozess, der die Sperre schon hält. */
const GEHALTEN = "DEVLOG_EINTRAGEN_SPERRE_GEHALTEN";

/**
 * Führt den Lauf unter der Kernel-Sperre `<datei>.lock` aus: startet dasselbe
 * Skript unter `flock -n -E 75`. Die Sperre hängt an der offenen Datei, nicht
 * an einem Dateinamen oder einer PID; sie fällt mit dem Prozess, auch bei
 * SIGKILL, und niemand wartet. Gibt den Exit-Code zurück (3 = belegt).
 */
function unterSperre(a, argv) {
  const sperre = `${a.datei}.lock`;
  try {
    closeSync(openSync(sperre, "a", 0o644)); // nicht anlegbar: Dateifehler (2), nicht „belegt“
  } catch (e) {
    console.error(`Sperrdatei ${sperre} nicht anlegbar: ${e.message}`);
    return 2;
  }
  const r = spawnSync(
    "flock",
    ["-n", "-E", String(FLOCK_BELEGT), sperre, process.execPath, fileURLToPath(import.meta.url), ...argv],
    { stdio: "inherit", env: { ...process.env, [GEHALTEN]: "1" } },
  );
  if (r.error) {
    console.error(`flock nicht startbar: ${r.error.message}`);
    return 2;
  }
  if (r.status === FLOCK_BELEGT) {
    console.error(`Ziel gesperrt: ${sperre} ist belegt, ein anderer Lauf schreibt gerade`);
    return 3;
  }
  if (r.status === null) {
    console.error(`Lauf abgebrochen (Signal ${r.signal})`);
    return 2;
  }
  return r.status;
}

/**
 * Legt `<datei>.bak-<UTC-Zeitstempel>` an und löscht die ältesten, sodass
 * höchstens `SICHERUNGEN_MAX` bleiben. Der Zeitstempel trägt Millisekunden
 * (`20260930T164229123Z`), damit er sich sortieren lässt und zwei Läufe in
 * einer Sekunde sich nicht überschreiben. Gezählt und gelöscht werden nur
 * Dateien, die genau diesem Namensmuster entsprechen; fremde Namen bleiben.
 */
export function sichere(datei, jetzt = new Date()) {
  const stempel = jetzt.toISOString().replace(/[-:]/g, "").replace(".", "");
  const ziel = `${datei}.bak-${stempel}`;
  copyFileSync(datei, ziel);
  const praefix = `${basename(datei)}.bak-`;
  const alle = readdirSync(dirname(datei))
    .filter((n) => n.startsWith(praefix) && /^\d{8}T\d{9}Z$/.test(n.slice(praefix.length)))
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
      `${e.message}\nAufruf: eintragen.mjs --datei <devlog.json> --eintrag <tag.json> [--sperrliste <datei>]\n` +
        `       eintragen.mjs --pruefen --eintrag <tag.json> [--sperrliste <datei>]`,
    );
    return 2;
  }
  if (a.pruefen) return pruefenNur(a);
  if (process.env[GEHALTEN] !== "1") return unterSperre(a, argv);
  return eintragen(a);
}

/** Liest Eintrag und Sperrliste; wirft bei Lesefehlern. */
function ladeEintrag(a) {
  const eintrag = leseJson(a.eintrag, "Eintrag");
  const sperrliste = a.sperrliste ? leseSperrliste(readFileSync(a.sperrliste, "utf8")) : [];
  return { eintrag, sperrliste };
}

/** Schema, Wortlänge, Zeichen, Spuren. Gibt `{ code, meldung }` zurück (0 = sauber). */
function pruefeGanz(eintrag, sperrliste) {
  const schemaFehler = pruefeEintrag(eintrag, true);
  // Die Wortgrenze setzt einen schemagültigen Eintrag voraus und gilt nur hier.
  if (schemaFehler.length === 0) schemaFehler.push(...pruefeWortLaenge(eintrag));
  if (schemaFehler.length > 0) {
    return { code: 1, meldung: `Eintrag abgelehnt (Schema):\n  ${schemaFehler.join("\n  ")}` };
  }
  const spuren = findeSpuren(eintrag, sperrliste);
  if (spuren.length > 0) {
    return { code: 1, meldung: `Eintrag abgelehnt (interne Spur):\n  ${spuren.join("\n  ")}` };
  }
  return { code: 0, meldung: "" };
}

/** `--pruefen`: nur prüfen, nichts schreiben, keine Sperre. */
function pruefenNur(a) {
  let geladen;
  try {
    geladen = ladeEintrag(a);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const r = pruefeGanz(geladen.eintrag, geladen.sperrliste);
  if (r.code !== 0) {
    console.error(r.meldung);
    return r.code;
  }
  console.log(`Prüfung bestanden: ${geladen.eintrag.datum}`);
  return 0;
}

/** Nur für den Nebenläufigkeitstest: hält den Lauf kurz in der Sperre und protokolliert Ein- und Austritt. */
function sperrHook() {
  const datei = process.env.DEVLOG_EINTRAGEN_TEST_HOOK;
  if (!datei) return;
  appendFileSync(datei, `ein ${process.pid} ${process.hrtime.bigint()}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
  appendFileSync(datei, `aus ${process.pid} ${process.hrtime.bigint()}\n`);
}

function eintragen(a) {
  let eintrag;
  let vorhanden = [];
  let entfernt = 0;
  let sperrliste = [];
  try {
    ({ eintrag, sperrliste } = ladeEintrag(a));
    if (existsSync(a.datei)) {
      const gelesen = leseDevlog(leseJson(a.datei, "Datei"));
      vorhanden = gelesen.eintraege;
      entfernt = gelesen.uebersprungen;
    }
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  sperrHook();

  const geprueft = pruefeGanz(eintrag, sperrliste);
  if (geprueft.code !== 0) {
    console.error(geprueft.meldung);
    return geprueft.code;
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
