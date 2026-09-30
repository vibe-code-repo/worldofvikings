/**
 * PRÜFT tools/devlog/eintragen.mjs: Schema, jede Sperrregel, Einfügen,
 * Ersetzen, Kürzen auf 512 KB, Byte-Gleichheit beim zweiten Lauf und
 * atomares Schreiben, die Kernel-Sperre (Exit 3), den Prüfmodus und die
 * Rechte der Zieldatei.
 *
 * Die Sperrliste der echten Läufe liegt nicht im Repo; hier steht nur eine
 * Fixture-Sperrliste mit harmlosen Wörtern (`foobar`).
 *
 * Lauf: npx tsx tools/test/devlog-eintragen.ts
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as echt from "node:fs";
import { findeSpuren, schreibeAtomar } from "../devlog/eintragen.mjs";

const WERKZEUG = resolve(import.meta.dirname, "../devlog/eintragen.mjs");
const ARBEIT = mkdtempSync(join(tmpdir(), "devlog-eintragen-"));
let fehler = 0;
let zaehler = 0;

function pruefe(name: string, ok: boolean, detail = ""): void {
  zaehler++;
  console.log(`${ok ? "OK  " : "FEHL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) fehler++;
}

interface Text {
  titel: string;
  punkte: string[];
}
interface Tag {
  datum: string;
  de?: Text;
  en?: Text;
}

function tag(datum: string, titel = "Wölfe jagen jetzt im Rudel", extra: Partial<Tag> = {}): Tag {
  return {
    datum,
    de: { titel, punkte: ["Wölfe greifen zu zweit an.", "Die Kuh läuft langsamer."] },
    en: {
      titel: "Wolves now hunt in packs",
      punkte: ["Wolves attack in pairs.", "The cow walks slower."],
    },
    ...extra,
  };
}

let nummer = 0;
function ordner(): string {
  const d = join(ARBEIT, String(++nummer));
  mkdirSync(d);
  return d;
}

function lauf(dir: string, eintrag: unknown, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const eintragDatei = join(dir, "tag.json");
  writeFileSync(eintragDatei, typeof eintrag === "string" ? eintrag : JSON.stringify(eintrag));
  const r = spawnSync(
    process.execPath,
    [WERKZEUG, "--datei", join(dir, "devlog.json"), "--eintrag", eintragDatei, ...args],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  return { rc: r.status, aus: r.stdout, err: r.stderr };
}

function datei(dir: string): Buffer {
  return readFileSync(join(dir, "devlog.json"));
}
function dok(dir: string): { devlogVersion: number; eintraege: Tag[] } {
  return JSON.parse(datei(dir).toString("utf8"));
}

function abgelehnt(name: string, eintrag: unknown, erwartet: RegExp, args: string[] = []): void {
  const d = ordner();
  const davor = lauf(d, tag("2026-09-01"));
  const vorher = datei(d);
  const r = lauf(d, eintrag, args);
  pruefe(
    `${name}: Exit 1 mit benannter Meldung`,
    davor.rc === 0 && r.rc === 1 && erwartet.test(r.err),
    `rc=${r.rc} stderr=${r.err.trim()}`,
  );
  pruefe(`${name}: Datei unverändert`, vorher.equals(datei(d)));
}

async function haupt(): Promise<void> {
try {
  // ── Einfügen, Sortieren, Ersetzen, Byte-Gleichheit ──────────────────
  {
    const d = ordner();
    const r1 = lauf(d, tag("2026-09-29"));
    pruefe(
      "Einfügen in neue Datei: Exit 0, ein Eintrag",
      r1.rc === 0 && dok(d).eintraege.length === 1,
      r1.err,
    );
    pruefe("Datei trägt devlogVersion 1", dok(d).devlogVersion === 1);
    lauf(d, tag("2026-09-30", "Neuer"));
    lauf(d, tag("2026-09-27", "Älter"));
    pruefe(
      "Einträge absteigend sortiert",
      dok(d)
        .eintraege.map((e) => e.datum)
        .join() === "2026-09-30,2026-09-29,2026-09-27",
    );
    const vor = datei(d);
    const r2 = lauf(d, tag("2026-09-29"));
    pruefe("Zweiter Lauf mit demselben Eintrag: Exit 0", r2.rc === 0, r2.err);
    pruefe("Zweiter Lauf: byte-gleiche Datei", vor.equals(datei(d)));
    const r3 = lauf(d, tag("2026-09-29", "Geändert"));
    pruefe(
      "Derselbe Tag ersetzt, nicht doppelt",
      r3.rc === 0 && dok(d).eintraege.length === 3 && dok(d).eintraege[1].de?.titel === "Geändert",
      r3.err,
    );
    pruefe("Meldung sagt „ersetzt“", /ersetzt/.test(r3.aus));
    pruefe(
      "Keine temporäre Datei bleibt liegen",
      readdirSync(d).every((n) => !n.endsWith(".tmp")),
      readdirSync(d).join(),
    );
  }

  // ── Schema ───────────────────────────────────────────────────────────
  abgelehnt("Datum kein Kalendertag", tag("2026-02-31"), /datum/);
  abgelehnt("Datum falsches Format", tag("30.09.2026"), /datum/);
  abgelehnt("Englisch fehlt", { datum: "2026-09-02", de: tag("x").de }, /en: fehlt/);
  abgelehnt("Titel 81 Zeichen", tag("2026-09-02", "x".repeat(81)), /titel/);
  abgelehnt(
    "9 Punkte",
    tag("2026-09-02", "T", { de: { titel: "T", punkte: Array.from({ length: 9 }, () => "p") } }),
    /punkte/,
  );
  abgelehnt(
    "Leerer Punkt",
    tag("2026-09-02", "T", { de: { titel: "T", punkte: ["  "] } }),
    /punkte\[0\]/,
  );
  abgelehnt(
    "Punkt 281 Zeichen",
    tag("2026-09-02", "T", { de: { titel: "T", punkte: ["y".repeat(281)] } }),
    /punkte\[0\]/,
  );
  abgelehnt("Kein Objekt", "[1,2]", /Objekt erwartet/);
  {
    const d = ordner();
    const r = lauf(
      d,
      tag("2026-09-02", "T", {
        de: { titel: "T ".repeat(40), punkte: ["y ".repeat(140)] },
      }),
    );
    pruefe("Grenzwerte 80 und 280 Zeichen sind erlaubt", r.rc === 0, r.err);
  }

  // ── Sperrregeln ──────────────────────────────────────────────────────
  const mit = (text: string, ort: "titel" | "punkt" = "punkt"): Tag =>
    ort === "titel"
      ? tag("2026-09-02", text)
      : tag("2026-09-02", "T", { de: { titel: "T", punkte: [text] } });
  abgelehnt("PR-Nummer", mit("Behoben in #123."), /PR- oder Issue-Nummer.*#123/);
  abgelehnt("Issue-Nummer im Titel", mit("Fix für #77", "titel"), /PR- oder Issue-Nummer/);
  abgelehnt("Commit-Hash (7 Zeichen)", mit("Stand a1b2c3d erreicht"), /Commit-Hash.*a1b2c3d/);
  abgelehnt(
    "Commit-Hash (40 Zeichen)",
    mit(`Stand ${"0123456789abcdef".repeat(2)}01234567 erreicht`),
    /Commit-Hash/,
  );
  abgelehnt("Dateipfad mit Wurzelordner", mit("Geändert in server/src/Welt"), /Dateipfad/);
  abgelehnt("Dateipfad absolut", mit("Liegt in /opt/wov"), /Dateipfad/);
  abgelehnt("Endung .ts", mit("In Welt.ts geändert"), /Dateiendung.*Welt\.ts/);
  abgelehnt("Endung .mjs", mit("Läuft über tag.mjs"), /Dateiendung/);
  abgelehnt("Endung .json", mit("Steht in server.json"), /Dateiendung/);
  {
    const d = ordner();
    const sperr = join(d, "sperr.txt");
    writeFileSync(sperr, "# Kommentar\n\nFooBar\r\nzweites wort\n");
    const treffer = lauf(d, mit("Das foobar ist weg"), ["--sperrliste", sperr]);
    pruefe(
      "Sperrliste: Wort ohne Beachtung der Schreibweise",
      treffer.rc === 1 && /Sperrwort „FooBar“/.test(treffer.err),
      `rc=${treffer.rc} ${treffer.err}`,
    );
    const zweites = lauf(d, mit("Ein ZWEITES Wort im Satz", "titel"), ["--sperrliste", sperr]);
    pruefe("Sperrliste: Muster mit Leerzeichen, im Titel", zweites.rc === 1, zweites.err);
    const kommentar = lauf(d, mit("Kommentar der Liste ist kein Muster"), ["--sperrliste", sperr]);
    pruefe("Sperrliste: Kommentarzeile sperrt nichts", kommentar.rc === 0, kommentar.err);
    const fehlt = lauf(d, tag("2026-09-03"), ["--sperrliste", join(d, "gibt-es-nicht.txt")]);
    pruefe("Sperrliste nicht lesbar: Exit 2", fehlt.rc === 2, `rc=${fehlt.rc}`);
  }
  {
    const d = ordner();
    const harmlos = [
      "Die Wölfe jagen schneller.",
      "1000000 Gold im Schatz",
      "Tag und/oder Nacht",
      "Er war defaced und entfaced",
      "Angriff / Verteidigung",
      "Version 1.2 ist da",
    ];
    const r = lauf(d, tag("2026-09-02", "T", { de: { titel: "T", punkte: harmlos } }));
    pruefe("Harmlose Texte werden nicht abgelehnt", r.rc === 0, r.err);
  }

  // ── Nachbesserung N1: Tabelle aus dem Prüfbericht (Kopf b35b9756) ────
  // Je Zeile: Text, erwartete Regel (oder null = darf durch). Geprüft wird
  // findeSpuren direkt, damit jede Zeile einzeln rot oder grün wird.
  {
    const sperr = ["foobar", "kaiser"];
    const nummer = "PR- oder Issue-Nummer";
    const gesperrt: [string, string][] = [
      ["Fix #１２３", nummer],
      ["＃123", nummer],
      ["Fix # 123", nummer], // Leerzeichen nach dem Zeichen (F6)
      ["Fix #  45", nummer],
      ["PR 12", nummer],
      ["pull #5", nummer],
      ["issue/7", nummer],
      ["PR 123", nummer],
      ["Pull Request 12", nummer],
      ["pull/123", nummer],
      ["GH-123", nummer],
      ["issue 45", nummer],
      ["Commit 77", nummer],
      ["https://github.com/o/r/pull/5", "Adresse"],
      ["siehe www.example.org", "Adresse"],
      ["github.com/o/r", "Adresse"],
      ["http://x", "Adresse"],
      ["a1b2-c3d4e5", "Commit-Hash"],
      ["A1B2C3D4", "Commit-Hash"],
      ["server\\src", "Dateipfad"],
      ["C:\\Users\\x", "Dateipfad"],
      ["C:/Users/x", "Dateipfad"],
      ["/opt/wov", "Dateipfad"],
      ["./lauf", "Dateipfad"],
      ["liegt in ~/foo", "Serveradresse"],
      ["localhost:2713", "Serveradresse"],
      ["wov-dev", "Serveradresse"],
      ["wov dev", "Serveradresse"], // F6: Leerzeichen statt Bindestrich
      ["wov_live", "Serveradresse"],
      ["Wov Host", "Serveradresse"],
      ["127.0.0.1", "Serveradresse"],
      ["127.0.0.1:2713", "Serveradresse"],
      ["Port 2467", "Serveradresse"],
      ["port:8080", "Serveradresse"],
      ["localhost : 2713", "Serveradresse"],
      ["github . com/x", "Adresse"], // F6: Trennzeichen
      ["github\u00a0.\u00a0com", "Adresse"],
      ["github dot com", "Adresse"],
      ["g i t h u b", "Adresse"],
      ["GitHub", "Adresse"],
      ["hxxp://example.org", "Adresse"],
      ["https\u2236//x", "Adresse"], // Doppelpunkt U+2236
      ["ssh://host", "Adresse"],
      ["ftp://x", "Adresse"],
      ["file:///etc", "Adresse"],
      ["mailto:a@b.c", "Adresse"],
      ["deadbeefcafe", "Commit-Hash"], // F6: nur Buchstaben a-f, ab 10 Zeichen
      ["Hash deadbeefcafe123", "Commit-Hash"],
      ["c :/x", "Dateipfad"],
      ["wov-web/static", "Dateipfad"], // Wurzelordner wov-web
      ["bild.png", "Dateiendung"],
      ["notiz.txt", "Dateiendung"],
      ["setup.exe", "Dateiendung"],
      ["lib.so", "Dateiendung"],
      ["main.cpp", "Dateiendung"],
      ["main.c", "Dateiendung"],
      ["kopf.h", "Dateiendung"],
      ["kopf.hpp", "Dateiendung"],
      ["lib.rs", "Dateiendung"],
      ["main.go", "Dateiendung"],
      ["x.rb", "Dateiendung"],
      ["x.lua", "Dateiendung"],
      ["x.sql", "Dateiendung"],
      ["x.csv", "Dateiendung"],
      ["x.xml", "Dateiendung"],
      ["x.ini", "Dateiendung"],
      ["x.toml", "Dateiendung"],
      ["x.zip", "Dateiendung"],
      ["x.gz", "Dateiendung"],
      ["x.tar", "Dateiendung"],
      ["x.gltf", "Dateiendung"],
      ["x.fbx", "Dateiendung"],
      ["x.wav", "Dateiendung"],
      ["x.ogg", "Dateiendung"],
      ["x.mp3", "Dateiendung"],
      ["x.ktx2", "Dateiendung"],
      ["x.bin", "Dateiendung"],
      ["x.jpg", "Dateiendung"],
      ["x.jpeg", "Dateiendung"],
      ["x.webp", "Dateiendung"],
      ["x.svg", "Dateiendung"],
      ["x.gif", "Dateiendung"],
      ["x.log", "Dateiendung"],
      ["x.dll", "Dateiendung"],
      ["a1b2-c3d4e5", "Commit-Hash"],
      ["f\u043e\u043ebar", "fremde Schrift"], // F5: kyrillisches „о“ statt „o“
      ["f\u03bf\u03bfbar", "fremde Schrift"], // griechisches „ο“
      ["g\u0456thub.com", "fremde Schrift"], // kyrillisches „і“
      ["Привет", "fremde Schrift"],
      ["こんにちは", "fremde Schrift"],
      ["WOV-Host", "Serveradresse"],
      ["wov-lab", "Serveradresse"],
      ["wov-live", "Serveradresse"],
      ["tool.py", "Dateiendung"],
      ["run.sh", "Dateiendung"],
      ["style.css", "Dateiendung"],
      ["index.html", "Dateiendung"],
      ["modell.glb", "Dateiendung"],
      ["szene.blend", "Dateiendung"],
      ["nginx.conf", "Dateiendung"],
      ["WovServer.ts", "Dateiendung"],
      ["Welt.TS", "Dateiendung"],
      ["dir/foo.js", "Dateiendung"],
      ["server.js", "Dateiendung"],
      ["foo\u200bbar", "Sperrwort"], // Null-Breite im Sperrwort
      ["foo\u00adbar", "Sperrwort"], // weiche Trennung
      ["foo\u0336bar", "Sperrwort"], // kombinierendes Zeichen (Mn)
      ["ｆｏｏｂａｒ", "Sperrwort"], // Vollbreite
      ["Kaiſer", "Sperrwort"], // langes s
    ];
    for (const [text, regel] of gesperrt) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, sperr).join("|");
      pruefe(
        `Gesperrt: ${JSON.stringify(text)} (${regel})`,
        funde.includes(regel),
        `Funde: ${funde || "keine"}`,
      );
    }
    const erlaubt = [
      "Feuer/Wasser/Erde",
      "Siehe a/b/c dazu", // die Regel „zwei Schrägstriche“ entfiel (N1)
      "Schwert/Axt/Bogen",
      "Mo/Di/Mi",
      "1/2/3",
      "30/09/2026",
      "10 km/h",
      "3/4 der Karte",
      "Node.js",
      "Vue.js",
      "und/oder",
      "Angriff / Verteidigung",
      "Version 1.2",
      "Level 3",
      "v1.2.3",
      "2026-09-30",
      "deadbeef",
      "Die Regierung spricht 3 Sätze",
      "Der Commit-Ablauf ist kürzer",
      "Der Prüfer kommt um 3 Uhr",
      // F7: Überfilterung an echten Spielertexten
      "Platz #1 der Rangliste",
      "Rang #9",
      "Feb-2026",
      "Cafe-2026",
      "Fade-2026",
      "Bade-2026",
      "Ade-1234",
      "ABC-DEF-12345",
      "Pull 3 Gegner",
      "issue 2 wichtig",
      "Stufe 3 pr 1",
      "Wir nutzen node.js nicht",
      "Node.JS",
      "Heute.Html ist nett",
      "Dienstag.Sh",
      "Ja.Md",
      "Das heißt d.h. dies",
      "Sieg über Wölfe 🐺 und Bären 🐻",
      "Ärger über Straße und Öl",
      "Version 1.2.3",
      "Es gibt 25 Ziegen",
      "Der Wolf hat Hunger",
    ];
    for (const text of erlaubt) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, sperr);
      pruefe(`Erlaubt: ${JSON.stringify(text)}`, funde.length === 0, funde.join("|"));
    }
    const leer = findeSpuren({ de: { titel: "T", punkte: ["Ein ganz normaler Satz"] } }, ["", "  ", "\u200b"]);
    pruefe("Sperrliste: Zeile, die nach dem Glätten leer ist, sperrt nichts", leer.length === 0, leer.join());
  }

  // ── Steuer- und Formatzeichen im Rohtext ─────────────────────────────
  abgelehnt("Bidi-Zeichen U+202E", mit("abc\u202Edef"), /Steuer- oder Formatzeichen U\+202E/);
  abgelehnt("Null-Breite im Titel", mit("ab\u200Bc", "titel"), /de\.titel.*U\+200B/);
  abgelehnt("Steuerzeichen Zeilenumbruch", mit("eins\nzwei"), /Steuer- oder Formatzeichen U\+000A/);
  abgelehnt("Steuerzeichen NUL", mit("a\u0000b"), /Steuer- oder Formatzeichen U\+0000/);

  // ── Überlange Wörter (nur beim Eintragen) ────────────────────────────
  abgelehnt("Wort mit 41 Zeichen im Punkt", mit(`Das ${"x".repeat(41)} geht nicht`), /Wort mit mehr als 40/);
  abgelehnt("Wort mit 41 Zeichen im Titel", mit("x".repeat(41), "titel"), /de\.titel.*Wort mit mehr als 40/);
  {
    const d = ordner();
    const r = lauf(d, mit(`${"x".repeat(40)} ${"ä".repeat(40)}`));
    pruefe("Wörter mit genau 40 Zeichen sind erlaubt", r.rc === 0, r.err);
  }

  // ── Sicherung beim Entfernen von Alteinträgen ────────────────────────
  {
    const d = ordner();
    const ziel = join(d, "devlog.json");
    const kaputt = { datum: "kaputt", de: { titel: "T", punkte: ["p"] } };
    const gut = tag("2026-08-01");
    const schreibeAlt = () =>
      writeFileSync(ziel, JSON.stringify({ devlogVersion: 1, eintraege: [gut, kaputt] }));
    const baks = () => readdirSync(d).filter((n) => n.startsWith("devlog.json.bak-")).sort();

    const ohne = lauf(d, tag("2026-09-01"));
    pruefe(
      "Ohne ungültige Alteinträge keine Sicherung",
      ohne.rc === 0 && baks().length === 0,
      baks().join(),
    );
    schreibeAlt();
    const alt = readFileSync(ziel);
    const r = lauf(d, tag("2026-09-02"));
    pruefe(
      "Entfernte Alteinträge: genau eine Sicherung",
      r.rc === 0 && baks().length === 1 && /Sicherung/.test(r.err),
      `rc=${r.rc} ${baks().join()} ${r.err}`,
    );
    pruefe(
      "Sicherung enthält die Datei von vorher, Name mit UTC-Stempel",
      baks().length === 1 &&
        readFileSync(join(d, baks()[0])).equals(alt) &&
        /^devlog\.json\.bak-\d{8}T\d{9}Z$/.test(baks()[0]),
      baks().join(),
    );
    pruefe("Der ungültige Eintrag ist aus der Datei weg", dok(d).eintraege.length === 2);
    for (let i = 0; i < 7; i++) {
      schreibeAlt();
      lauf(d, tag("2026-09-03"));
    }
    pruefe("Höchstens 5 Sicherungen bleiben", baks().length === 5, `${baks().length}`);
    const neueste = baks().at(-1) ?? "";
    const aeltester = baks()[0];
    schreibeAlt();
    lauf(d, tag("2026-09-03"));
    pruefe(
      "Die ältesten fallen weg, die neuesten bleiben",
      baks().length === 5 && (baks().at(-1) ?? "") > neueste && !baks().includes(aeltester),
      baks().join(),
    );
    schreibeAlt();
    const vorher = readdirSync(d).join();
    const abgelehntLauf = lauf(d, mit("Behoben in #55"));
    pruefe(
      "Abgelehnter Eintrag: keine Sicherung, Datei unverändert",
      abgelehntLauf.rc === 1 && readdirSync(d).join() === vorher,
    );
  }
  {
    // F4/M20: ein Lauf OHNE ungültige Alteinträge legt auch bei vorhandener Datei keine Sicherung an.
    const d = ordner();
    lauf(d, tag("2026-09-01"));
    const r = lauf(d, tag("2026-09-02"));
    const baks = readdirSync(d).filter((n) => n.includes(".bak-"));
    pruefe("Bestehende, gültige Datei: keine Sicherung bei jedem Lauf", r.rc === 0 && baks.length === 0, baks.join());
  }
  {
    // F11: fremde Dateien mit dem Präfix zählen nicht mit und werden nie gelöscht.
    const d = ordner();
    const ziel = join(d, "devlog.json");
    const kaputt = { datum: "kaputt", de: { titel: "T", punkte: ["p"] } };
    const fremd = [
      "devlog.json.bak-zzz-fremd",
      "devlog.json.bak-20260930T123456Z", // ohne Millisekunden: nicht unser Muster
      "devlog.json.bak-20260930T123456789Zx",
      "devlog.json.bak-",
    ];
    for (const n of fremd) writeFileSync(join(d, n), "fremd");
    for (let i = 0; i < 9; i++) {
      writeFileSync(ziel, JSON.stringify({ devlogVersion: 1, eintraege: [tag("2026-08-01"), kaputt] }));
      lauf(d, tag("2026-09-03"));
    }
    const eigene = readdirSync(d).filter((n) => /^devlog\.json\.bak-\d{8}T\d{9}Z$/.test(n));
    pruefe("Fremde Dateien bleiben alle liegen", fremd.every((n) => existsSync(join(d, n))), readdirSync(d).join());
    pruefe("Von den eigenen bleiben genau 5 (fremde zählen nicht mit)", eigene.length === 5, String(eigene.length));
  }

  // ── Kernel-Sperre gegen gleichzeitige Läufe (flock, Exit 3) ───────────
  {
    const d = ordner();
    const sperre = join(d, "devlog.json.lock");
    // Fremder Halter: hält dieselbe Sperrdatei, wie es ein anderer Lauf täte.
    const halter = spawn("flock", [sperre, "sleep", "60"], { stdio: "ignore", detached: true });
    const halterPid = halter.pid as number;
    const halterLebt = (): boolean => {
      try {
        process.kill(halterPid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await new Promise((r) => setTimeout(r, 300));
    const r = lauf(d, tag("2026-09-01"));
    pruefe(
      "Belegte Sperre: Exit 3 (nicht 2) mit benannter Meldung",
      r.rc === 3 && /Ziel gesperrt.*devlog\.json\.lock/.test(r.err),
      `rc=${r.rc} ${r.err}`,
    );
    pruefe(
      "Belegte Sperre: keine Datei geschrieben, Halter läuft weiter, Sperre bleibt belegt",
      !existsSync(join(d, "devlog.json")) && halterLebt() && lauf(d, tag("2026-09-01")).rc === 3,
    );
    pruefe(
      "Belegte Sperre ist auch für den Prüfmodus kein Hindernis (nimmt keine Sperre)",
      lauf(d, tag("2026-09-01"), ["--pruefen"]).rc === 0,
    );
    // SIGKILL des Halters: die Sperre ist sofort frei, ohne Wartezeit.
    // flock startet den Halter als Kind: die ganze Prozessgruppe (flock und sleep) fällt.
    process.kill(-halterPid, "SIGKILL");
    for (let i = 0; i < 50 && halterLebt(); i++) await new Promise((r2) => setTimeout(r2, 20));
    const nachKill = lauf(d, tag("2026-09-01"));
    pruefe(
      "Nach SIGKILL des Halters ist die Sperre sofort frei (Exit 0)",
      nachKill.rc === 0 && existsSync(join(d, "devlog.json")),
      `rc=${nachKill.rc} ${nachKill.err}`,
    );
    const rest = readdirSync(d).filter((n) => n !== "devlog.json" && n !== "devlog.json.lock" && n !== "tag.json");
    pruefe("Keine Reste neben Datei und leerer Sperrdatei", rest.length === 0, rest.join());
    pruefe(
      "Abgelehnter Eintrag gibt die Sperre frei",
      lauf(d, mit("Fix #99")).rc === 1 && lauf(d, tag("2026-09-02")).rc === 0,
    );
    // Sperrdatei nicht anlegbar (Zielordner fehlt): Dateifehler 2, nicht „gesperrt“.
    const ohneOrdner = spawnSync(
      process.execPath,
      [WERKZEUG, "--datei", join(d, "gibt-es-nicht", "devlog.json"), "--eintrag", join(d, "tag.json")],
      { encoding: "utf8" },
    );
    pruefe("Zielordner fehlt: Exit 2, nicht 3", ohneOrdner.status === 2, `rc=${ohneOrdner.status}`);
  }
  {
    // 4 Prozesse × 40 Runden um dieselbe Datei: nie zwei zugleich in der Sperre.
    const d = ordner();
    const eintragDatei = join(d, "tag.json");
    writeFileSync(eintragDatei, JSON.stringify(tag("2026-09-05")));
    const hookDatei = join(d, "hook.log");
    const start = (): Promise<number | null> =>
      new Promise((fertig) => {
        const c = spawn(
          process.execPath,
          [WERKZEUG, "--datei", join(d, "devlog.json"), "--eintrag", eintragDatei],
          {
            stdio: "ignore",
            env: { ...process.env, DEVLOG_EINTRAGEN_TEST_HOOK: hookDatei },
          },
        );
        c.on("close", (rc) => fertig(rc));
      });
    let ueberschneidungen = 0;
    let rundenOhneSieger = 0;
    let fremdeCodes = 0;
    let eintritte = 0;
    for (let runde = 0; runde < 40; runde++) {
      rmSync(hookDatei, { force: true });
      const codes = await Promise.all([start(), start(), start(), start()]);
      fremdeCodes += codes.filter((c) => c !== 0 && c !== 3).length;
      if (!codes.includes(0)) rundenOhneSieger++;
      const zeilen = existsSync(hookDatei)
        ? readFileSync(hookDatei, "utf8").trim().split("\n").filter(Boolean)
        : [];
      let drin = 0;
      for (const z of zeilen) {
        if (z.startsWith("ein ")) {
          eintritte++;
          if (++drin > 1) ueberschneidungen++;
        } else drin--;
      }
    }
    pruefe(
      "4 Prozesse × 40 Runden: 0 Überschneidungen in der Sperre",
      ueberschneidungen === 0 && eintritte >= 40,
      `Überschneidungen=${ueberschneidungen} Eintritte=${eintritte}`,
    );
    pruefe(
      "Jede Runde hat einen Sieger, alle anderen enden mit Exit 3 (kein anderer Code)",
      rundenOhneSieger === 0 && fremdeCodes === 0,
      `ohne Sieger=${rundenOhneSieger} fremde Codes=${fremdeCodes}`,
    );
  }

  // ── Datei defekt, Aufruf ─────────────────────────────────────────────
  {
    const d = ordner();
    writeFileSync(join(d, "devlog.json"), "{kaputt");
    const vor = datei(d);
    const r = lauf(d, tag("2026-09-02"));
    pruefe(
      "Defekte Zieldatei: Exit 2 (nicht 3), Datei unverändert",
      r.rc === 2 && vor.equals(datei(d)),
      `rc=${r.rc} ${r.err}`,
    );
    const ohne = spawnSync(process.execPath, [WERKZEUG], { encoding: "utf8" });
    pruefe("Ohne Argumente: Exit 2", ohne.status === 2);
  }

  // ── Rechte der Zieldatei (F8) ────────────────────────────────────────
  {
    const d = ordner();
    const eintragDatei = join(d, "tag.json");
    writeFileSync(eintragDatei, JSON.stringify(tag("2026-09-07")));
    for (const maske of ["077", "0277"]) {
      const ziel = join(d, `devlog-${maske}.json`);
      const r = spawnSync(
        "sh",
        ["-c", `umask ${maske}; exec "$0" "$@"`, process.execPath, WERKZEUG, "--datei", ziel, "--eintrag", eintragDatei],
        { encoding: "utf8" },
      );
      const modus = existsSync(ziel) ? statSync(ziel).mode & 0o777 : -1;
      pruefe(
        `Zieldatei hat unter umask ${maske} Modus 0644`,
        r.status === 0 && modus === 0o644,
        `rc=${r.status} modus=${modus.toString(8)} ${r.stderr}`,
      );
    }
  }

  // ── Prüfmodus --pruefen (F10) ────────────────────────────────────────
  {
    const d = ordner();
    const pruefen = (eintrag: unknown, args: string[] = []) => {
      const f = join(d, "pruef.json");
      writeFileSync(f, typeof eintrag === "string" ? eintrag : JSON.stringify(eintrag));
      const r = spawnSync(process.execPath, [WERKZEUG, "--pruefen", "--eintrag", f, ...args], {
        encoding: "utf8",
      });
      return { rc: r.status, aus: r.stdout, err: r.stderr };
    };
    const sauber = pruefen(tag("2026-09-08"));
    pruefe("--pruefen: sauberer Eintrag Exit 0, ohne --datei", sauber.rc === 0 && /bestanden/.test(sauber.aus), sauber.err);
    pruefe("--pruefen: schreibt nichts (Ordner unverändert)", readdirSync(d).join() === "pruef.json", readdirSync(d).join());
    const spur = pruefen(tag("2026-09-08", "Fix # 123"));
    pruefe("--pruefen: Spur Exit 1 mit Meldung", spur.rc === 1 && /PR- oder Issue-Nummer/.test(spur.err), spur.err);
    const wort = pruefen(tag("2026-09-08", "x".repeat(41)));
    pruefe("--pruefen: überlanges Wort Exit 1", wort.rc === 1 && /Wort mit mehr als 40/.test(wort.err), wort.err);
    const schema = pruefen({ datum: "2026-09-08", de: tag("x").de });
    pruefe("--pruefen: Schemafehler Exit 1", schema.rc === 1 && /en: fehlt/.test(schema.err), schema.err);
    const fremdSchrift = pruefen(tag("2026-09-08", "fооbar"));
    pruefe("--pruefen: fremde Schrift Exit 1", fremdSchrift.rc === 1 && /fremde Schrift/.test(fremdSchrift.err), fremdSchrift.err);
    const sl = join(d, "sl.txt");
    writeFileSync(sl, "foobar\n");
    const liste = pruefen(tag("2026-09-08", "Das Foobar"), ["--sperrliste", sl]);
    pruefe("--pruefen: Sperrliste wirkt", liste.rc === 1 && /Sperrwort/.test(liste.err), liste.err);
    const kaputt = pruefen("{kaputt");
    pruefe("--pruefen: nicht lesbarer Eintrag Exit 2", kaputt.rc === 2, `rc=${kaputt.rc}`);
    const ohne = spawnSync(process.execPath, [WERKZEUG, "--pruefen"], { encoding: "utf8" });
    pruefe("--pruefen ohne --eintrag: Exit 2", ohne.status === 2);
  }

  // ── Sperrliste wird genauso geglättet wie der Text (F4/M19) ──────────
  {
    const vollbreit = findeSpuren({ de: { titel: "T", punkte: ["Das foobar"] } }, ["ＦＯＯＢＡＲ"]);
    const lang = findeSpuren({ de: { titel: "T", punkte: ["Das Kaiser"] } }, ["Kaiſer"]);
    const weich = findeSpuren({ de: { titel: "T", punkte: ["Das kaiser"] } }, ["kai­ser"]);
    pruefe("Sperrliste in Vollbreite sperrt das normale Wort", vollbreit.length === 1, vollbreit.join());
    pruefe("Sperrliste mit langem s sperrt das normale Wort", lang.length === 1, lang.join());
    pruefe("Sperrliste mit weicher Trennung sperrt das normale Wort", weich.length === 1, weich.join());
  }

  // ── Kürzen auf 512 KB ────────────────────────────────────────────────
  {
    const d = ordner();
    const grenze = 512 * 1024;
    const gross = (n: number): Tag => {
      const t = new Date(Date.UTC(2020, 0, 1) + n * 86400000).toISOString().slice(0, 10);
      return tag(t, `Eintrag ${n}`, {
        de: { titel: `Eintrag ${n}`, punkte: Array.from({ length: 8 }, () => "ä ".repeat(140)) },
        en: { titel: `Entry ${n}`, punkte: Array.from({ length: 8 }, () => "e ".repeat(140)) },
      });
    };
    const alle = Array.from({ length: 300 }, (_, i) => gross(300 - i)).sort((a, b) =>
      a.datum < b.datum ? 1 : -1,
    );
    writeFileSync(
      join(d, "devlog.json"),
      `${JSON.stringify({ devlogVersion: 1, eintraege: alle }, null, 2)}\n`,
    );
    const vorGroesse = datei(d).length;
    const neu = gross(400);
    const r = lauf(d, neu);
    const nach = dok(d);
    pruefe("Ausgangsdatei war über 512 KB", vorGroesse > grenze, String(vorGroesse));
    pruefe(
      "Nach dem Einfügen höchstens 512 KB",
      r.rc === 0 && datei(d).length <= grenze,
      `rc=${r.rc} ${datei(d).length} ${r.err}`,
    );
    pruefe("Der neueste Eintrag steht vorn", nach.eintraege[0].datum === neu.datum);
    pruefe(
      "Älteste fielen weg",
      nach.eintraege.length < 300 && /gekürzt/.test(r.aus),
      `${nach.eintraege.length} ${r.aus}`,
    );
    pruefe(
      "Es blieb die neueste Teilfolge (ohne Lücke)",
      nach.eintraege.every((e, i) => e.datum === [neu, ...alle][i].datum),
    );
    const naechster =
      Buffer.byteLength(JSON.stringify([neu, ...alle][nach.eintraege.length], null, 2)) + 4;
    pruefe(
      "Nicht mehr gekürzt als nötig",
      datei(d).length + naechster > grenze,
      `${datei(d).length} + ${naechster}`,
    );
    const vor = datei(d);
    const r2 = lauf(d, neu);
    pruefe("Gekürzte Datei: zweiter Lauf byte-gleich", r2.rc === 0 && vor.equals(datei(d)), r2.err);
  }

  // ── Atomar schreiben ─────────────────────────────────────────────────
  {
    const d = ordner();
    const ziel = join(d, "devlog.json");
    writeFileSync(ziel, "alt");
    const aufrufe: string[] = [];
    const fs = {
      fchmodSync: (...a: Parameters<typeof echt.fchmodSync>) => (
        aufrufe.push("chmod"),
        echt.fchmodSync(...a)
      ),
      openSync: (...a: Parameters<typeof echt.openSync>) => (
        aufrufe.push("open"),
        echt.openSync(...a)
      ),
      writeSync: (...a: Parameters<typeof echt.writeSync>) => (
        aufrufe.push("write"),
        echt.writeSync(...a)
      ),
      fsyncSync: (...a: Parameters<typeof echt.fsyncSync>) => (
        aufrufe.push("fsync"),
        echt.fsyncSync(...a)
      ),
      closeSync: (...a: Parameters<typeof echt.closeSync>) => (
        aufrufe.push("close"),
        echt.closeSync(...a)
      ),
      renameSync: (...a: Parameters<typeof echt.renameSync>) => (
        aufrufe.push("rename"),
        echt.renameSync(...a)
      ),
      unlinkSync: (...a: Parameters<typeof echt.unlinkSync>) => (
        aufrufe.push("unlink"),
        echt.unlinkSync(...a)
      ),
    };
    schreibeAtomar(ziel, "neu", fs);
    pruefe(
      "Atomar: Reihenfolge öffnen, Modus, schreiben, sichern, schließen, umhängen",
      aufrufe.join() === "open,chmod,write,fsync,close,rename",
      aufrufe.join(),
    );
    pruefe(
      "Atomar: Inhalt neu, kein Rest im Ordner",
      readFileSync(ziel, "utf8") === "neu" && readdirSync(d).length === 1,
      readdirSync(d).join(),
    );

    for (const bruch of ["writeSync", "renameSync"] as const) {
      writeFileSync(ziel, "alt");
      const kaputt = {
        ...fs,
        [bruch]: () => {
          throw new Error("Platte voll");
        },
      };
      let geworfen = false;
      try {
        schreibeAtomar(ziel, "neu-und-lang", kaputt);
      } catch {
        geworfen = true;
      }
      pruefe(
        `Atomar: Abbruch bei ${bruch} lässt die alte Datei ganz und räumt auf`,
        geworfen && readFileSync(ziel, "utf8") === "alt" && readdirSync(d).length === 1,
        `${geworfen} ${readdirSync(d).join()}`,
      );
    }
  }
} finally {
  rmSync(ARBEIT, { recursive: true, force: true });
}
}

haupt().then(
  () => {
    console.log(
      fehler === 0
        ? `\ndevlog-eintragen: alle ${zaehler} Prüfungen grün.\n`
        : `\ndevlog-eintragen: ${fehler} von ${zaehler} FEHLGESCHLAGEN.\n`,
    );
    process.exit(fehler > 0 ? 1 : 0);
  },
  (e) => {
    console.log(`FEHL  Testlauf abgebrochen: ${e instanceof Error ? e.stack : String(e)}`);
    process.exit(1);
  },
);
