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
 * Zeichen: Titel und Punkte dürfen nur Zeichen der Positivliste enthalten
 * (`unerlaubteZeichen` in `wov-web/src/lib/devlog.ts`, dort als Block „Allowed
 * text“ beschrieben). Jedes andere Zeichen lehnt das Werkzeug ab und nennt es
 * als `U+XXXX`. Darüber hinaus gibt es wenige Muster auf dem normalisierten
 * Text (NFKC, Akzente ab, Buchstaben ohne Zerlegung gefaltet (`FALTUNG`, Liste
 * im Block „Allowed text“), klein geschrieben,
 * – und — als -): Hash, PR-/Issue-Nummer, Domain, IPv4, IPv6, Serverkürzel, Port,
 * Dateiendung. Wörter über 40 Zeichen werden beim Eintragen abgelehnt.
 *
 * Schreiben: temporäre Datei im selben Ordner, dann `rename` — ein Abbruch
 * hinterlässt die alte Datei ganz. Ein zweiter Lauf mit demselben Eintrag
 * ergibt byte-gleiche Ausgabe.
 *
 * Gleichzeitige Läufe schließt eine Kernel-Sperre aus: Das Werkzeug öffnet
 * `<datei>.lock` selbst (Modus 0600, `O_NOFOLLOW`; ein Symlink ergibt Exit 2)
 * und sperrt den offenen Deskriptor mit `flock -n -E 75 3`. Die Sperre hängt
 * an der offenen Datei und damit an diesem Prozess: Sie fällt mit seinem Tod
 * (auch SIGKILL), niemand wartet, und es gibt keinen Neustart und keine
 * Umgebungsvariable, die sie vortäuschen könnte. Die leere Datei `<datei>.lock`
 * bleibt liegen und ist kein Zustand. Pfade werden vorher absolut aufgelöst
 * (`--datei -x.json` ist ein Dateiname, kein Schalter). Entfernt ein Lauf
 * ungültige Alteinträge, legt er vorher `<datei>.bak-<UTC>` ab (höchstens 5
 * bleiben, nur Dateien genau dieses Namensmusters).
 *
 * `--pruefen --eintrag <tag.json> [--sperrliste <datei>]` prüft nur (Schema,
 * Wortlänge, Zeichen, Spuren): schreibt nichts, nimmt keine Sperre.
 *
 * Exit: 0 eingetragen (bzw. Prüfung bestanden), 1 Eintrag abgelehnt (Schema
 * oder interne Spur), 2 Aufruf- oder Dateifehler (auch: flock fehlt oder
 * scheitert, Sperrdatei ist ein Symlink), 3 Ziel gesperrt (ein anderer Lauf
 * schreibt gerade).
 *
 * Inserts one day's entry into devlog.json: schema from the shared module,
 * rejects internal traces, atomic write, idempotent.
 */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DATEI_MAX_BYTES,
  fuegeEin,
  leseDevlog,
  pruefeEintrag,
  pruefeWortLaenge,
  SPRACHEN,
  FALTUNG,
  unerlaubteZeichen,
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

/** Die Buchstaben der Faltungstabelle (`FALTUNG` in devlog.ts) als Zeichenklasse. */
const FALTUNG_KLASSE = new RegExp(`[${Object.keys(FALTUNG).join("")}]`, "gu");

/**
 * Normalisierte Fassung für alle Muster und die Sperrliste: geglättet, Akzente
 * abgelöst (NFD ohne Mn: „ä“ wird „a“), klein, Buchstaben ohne Zerlegung
 * gefaltet (`FALTUNG`: „ø“ wird „o“, „ŋ“ wird „n“, „ı“ wird „i“, „ß“ wird
 * „ss“), und Halbgeviert- und Geviertstrich werden zu „-“.
 */
export function normalisiert(text) {
  return glaette(text)
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(FALTUNG_KLASSE, (z) => FALTUNG[z])
    .replace(/[\u2013\u2014]/g, "-");
}

/** Endungen, die nach Quelltext, Betriebs- oder Mediendatei riechen. */
export const ENDUNG_LISTE = ["ts", "tsx", "mjs", "js", "jsx", "json", "svelte", "yml", "yaml", "md", "py", "sh", "css", "html", "glb", "blend", "conf", "png", "jpg", "jpeg", "webp", "svg", "gif", "txt", "log", "exe", "dll", "so", "cpp", "c", "h", "hpp", "rs", "go", "rb", "lua", "sql", "csv", "xml", "ini", "toml", "zip", "gz", "tar", "gltf", "fbx", "wav", "ogg", "mp3", "ktx2", "bin", "java"];
const ENDUNG = `(?:${ENDUNG_LISTE.join("|")})`;
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

/**
 * Hash-Kandidat auf dem normalisierten Text: jede maximale Folge von 7 oder
 * mehr Hexzeichen (0-9, a-f), auch mitten in einem Wort („Fix1a2b3c4d“) und
 * ohne obere Länge. Sie gilt als Hash, wenn sie Ziffern UND Buchstaben enthält
 * („abc1234“, „a1c7232d“), oder wenn sie ab 10 Zeichen nur aus a-f besteht
 * („deadbeefcafe“). Ausnahmen: Wort plus Jahr („Facade2026“), Tag plus Wort
 * (plus Jahr: „30Dec2026“, „1Feb2026“) und Jahr plus Wort („2026Dec“).
 * „defaced“ (7 Buchstaben) und reine Zahlen bleiben frei; „Bad1234“ wird
 * bewusst abgelehnt (Kürzel wie „abc1234“ lassen sich davon nicht trennen).
 */
const DATUMSFORMEN = [/^\d{1,2}[a-f]+(?:(?:19|20)\d\d)?$/, /^[a-f]+(?:19|20)\d\d$/, /^(?:19|20)\d\d[a-f]+$/];
function hashTreffer(n) {
  for (const m of n.matchAll(/[0-9a-f]{7,}/g)) {
    const hex = m[0];
    const ziffer = /\d/.test(hex);
    const buchstabe = /[a-f]/.test(hex);
    if (!ziffer && !buchstabe) continue;
    if (!ziffer) {
      if (hex.length >= 10) return hex;
      continue;
    }
    if (!buchstabe) continue;
    if (DATUMSFORMEN.some((f) => f.test(hex))) continue;
    return hex;
  }
  return undefined;
}

/** Häufige Endungen von Domainnamen; „wort.de“ oder „wort . de“ ist eine Adresse. */
export const TLD_LISTE = ["com", "de", "org", "net", "io", "dev", "app", "gg", "eu", "info", "xyz", "me", "co", "uk", "us", "ru", "cn", "tv"];
const TLD = `(?:${TLD_LISTE.join("|")})`;
/** Ein IPv4-Teil: 1-3 Ziffern, Wert 0-255, führende Nullen erlaubt („001“). */
const OKTETT = "(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)";
const IPV4 = new RegExp(`(?<!\\d)(?:${OKTETT}\\s*\\.\\s*){3}${OKTETT}(?!\\d)`);
const DOMAIN = new RegExp(
  `(?<![a-z0-9])www\\s*\\.|` +
    `(?<![a-z0-9-])[a-z0-9][a-z0-9-]*\\.${TLD}(?![a-z0-9])|` +
    `(?<![a-z0-9-])[a-z0-9][a-z0-9-]* \\. ${TLD}(?![a-z0-9])|` +
    `(?<![a-z0-9-])[a-z0-9][a-z0-9-]*\\s+dot\\s+${TLD}(?![a-z0-9])|` +
    `(?<![a-z0-9])localhost|` +
    `(?<![\\p{L}\\p{N}])g[\\s.-]*i[\\s.-]*t[\\s.-]*h[\\s.-]*u[\\s.-]*b`,
  "u",
);

/**
 * IPv6 auf dem normalisierten Text: Kandidat ist eine Folge von Hexgruppen mit
 * mindestens zwei Doppelpunkten. Gesperrt wird sie nur, wenn sie `::` enthält
 * und mindestens eine Gruppe eine Ziffer hat („fe80::1“, „::1“, „2001:db8::1“),
 * oder wenn sie aus 6 bis 8 Gruppen mit je 1-4 Zeichen besteht
 * („2001:db8:0:0:0:0:0:1“); ein Doppelpunkt davor („IP:fe80::1“) zählt nicht als
 * Wortgrenze. „20:00:30“, „Bad::“ und „Face:Dead:Fed“ bleiben frei.
 */
function ipv6Treffer(n) {
  for (const m of n.matchAll(/(?<![a-z0-9])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,}(?![a-z0-9:])/g)) {
    const t = m[0];
    const gruppen = t.split(":");
    if (t.includes("::") && gruppen.some((g) => /\d/.test(g))) return t;
    if (gruppen.length >= 6 && gruppen.length <= 8 && gruppen.every((g) => g.length >= 1)) return t;
  }
  return undefined;
}

/**
 * Die Muster, je mit Namen für die Meldung. `n` ist der normalisierte Text
 * (klein), `g` der geglättete mit Großschreibung.
 */
const REGELN = [
  {
    // Schlagwort plus Zahl ab 3 Ziffern; „Pull 10 enemies“ und „PR 12“ bleiben frei, `#` ist ohnehin gesperrt.
    name: "PR- oder Issue-Nummer",
    treffer: (n) =>
      /(?<![a-z0-9])(?:prs?|pull[\s-]*requests?|issues?|commits?|gh)[\s-]*\d{3,}/.exec(n)?.[0],
  },
  { name: "Commit-Hash", treffer: (n) => hashTreffer(n) },
  { name: "Adresse (Domain)", treffer: (n) => DOMAIN.exec(n)?.[0] },
  { name: "Serveradresse (IPv4)", treffer: (n) => IPV4.exec(n)?.[0] },
  { name: "Serveradresse (IPv6)", treffer: (n) => ipv6Treffer(n) },
  {
    name: "Serveradresse (Hexzahl)",
    treffer: (n) => /(?<![a-z0-9])0x[0-9a-f]{6,}/.exec(n)?.[0],
  },
  {
    name: "Serveradresse (Kürzel)",
    treffer: (n) => /(?<![a-z0-9])wov[\W_]*(?:dev|host|lab|live)(?![a-z0-9])/.exec(n)?.[0],
  },
  {
    name: "Serveradresse (Port)",
    treffer: (n) => /(?<![a-z0-9])ports?\s*:?\s*\d+/.exec(n)?.[0],
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

/** Findet interne Spuren; leere Liste heißt sauber. */
export function findeSpuren(eintrag, sperrliste = []) {
  const gelesen = sperrliste.map((m) => [normalisiert(m).trim(), m]).filter(([m]) => m !== "");
  const muster = gelesen.map(([m]) => m);
  const roh = new Map(gelesen);
  const funde = [];
  for (const [ort, text] of texteVon(eintrag)) {
    const falsch = unerlaubteZeichen(text);
    if (falsch.length > 0) funde.push(`${ort}: Zeichen nicht erlaubt ${falsch.slice(0, 8).join(" ")}`);
    const g = glaette(text);
    const n = normalisiert(text);
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
  // Absolut auflösen: ein führendes „-“ im Namen ist dann nie ein Schalter.
  for (const k of ["datei", "eintrag", "sperrliste"]) if (aus[k] !== undefined) aus[k] = resolve(aus[k]);
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

/**
 * Nimmt die Kernel-Sperre `<datei>.lock`: öffnet sie mit Modus 0600 und
 * `O_NOFOLLOW` (ein Symlink ergibt Exit 2) und lässt `flock -n -E 75 3` den
 * offenen Deskriptor sperren. Die Sperre hängt an der offenen Datei dieses
 * Prozesses, nicht an einem Namen oder einer PID; sie fällt mit dem Prozess,
 * auch bei SIGKILL, und niemand wartet. Der Deskriptor bleibt bis zum Ende offen.
 * Gibt `0` zurück, wenn die Sperre gehalten wird, sonst den Exit-Code (3 = belegt).
 */
function nimmSperre(datei) {
  const sperre = `${datei}.lock`;
  let fd;
  try {
    fd = openSync(sperre, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    if (!fstatSync(fd).isFile()) throw new Error("keine gewöhnliche Datei");
  } catch (e) {
    if (fd !== undefined) closeSync(fd);
    console.error(`Sperrdatei ${sperre} nicht anlegbar (Symlink, Verzeichnis oder Rechte): ${e.message}`);
    return 2;
  }
  const r = spawnSync("flock", ["-n", "-E", String(FLOCK_BELEGT), "3"], {
    stdio: ["ignore", "inherit", "inherit", fd],
  });
  if (r.error) {
    console.error(`flock nicht startbar: ${r.error.message}`);
    closeSync(fd);
    return 2;
  }
  if (r.status === FLOCK_BELEGT) {
    console.error(`Ziel gesperrt: ${sperre} ist belegt, ein anderer Lauf schreibt gerade`);
    closeSync(fd);
    return 3;
  }
  if (r.status !== 0) {
    console.error(
      r.status === null
        ? `flock abgebrochen (Signal ${r.signal})`
        : `flock unerwartet beendet (Exit ${r.status})`,
    );
    closeSync(fd);
    return 2;
  }
  return 0;
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
  const sperre = nimmSperre(a.datei);
  if (sperre !== 0) return sperre;
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
