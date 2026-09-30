/**
 * PRÜFT tools/devlog/eintragen.mjs: Schema, jede Sperrregel, Einfügen,
 * Ersetzen, Kürzen auf 512 KB, Byte-Gleichheit beim zweiten Lauf und
 * atomares Schreiben, die Kernel-Sperre (Exit 3, Sperrdatei 0600 ohne
 * Symlink, flock fehlt oder scheitert), den Prüfmodus und die Rechte der
 * Zieldatei. Die Regeln sind die Zeichen-Positivliste plus wenige Muster;
 * die Tabellen unten nennen je Fall die erwartete Regel.
 *
 * Die Sperrliste der echten Läufe liegt nicht im Repo; hier steht nur eine
 * Fixture-Sperrliste mit harmlosen Wörtern (`foobar`).
 *
 * Lauf: npx tsx tools/test/devlog-eintragen.ts
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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
  abgelehnt("`#` ist kein erlaubtes Zeichen", mit("Behoben in #123."), /Zeichen nicht erlaubt U\+0023/);
  abgelehnt("Hash-Zeichen im Titel", mit("Fix für #77", "titel"), /de\.titel.*Zeichen nicht erlaubt U\+0023/);
  abgelehnt("PR-Nummer mit Wort", mit("Behoben in PR 123."), /PR- oder Issue-Nummer.*pr 123/);
  abgelehnt("Commit-Hash (7 Zeichen)", mit("Stand a1b2c3d erreicht"), /Commit-Hash.*a1b2c3d/);
  abgelehnt(
    "Commit-Hash (40 Zeichen)",
    mit(`Stand ${"0123456789abcdef".repeat(2)}01234567 erreicht`),
    /Commit-Hash/,
  );
  abgelehnt("Schrägstrich (Pfad)", mit("Geändert in server/src/Welt"), /Zeichen nicht erlaubt U\+002F/);
  abgelehnt("Schrägstrich (absoluter Pfad)", mit("Liegt in /opt/wov"), /Zeichen nicht erlaubt U\+002F/);
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
      "Tag und Nacht",
      "Er war defaced und entfaced",
      "Angriff - Verteidigung",
      "Version 1.2 ist da",
    ];
    const r = lauf(d, tag("2026-09-02", "T", { de: { titel: "T", punkte: harmlos } }));
    pruefe("Harmlose Texte werden nicht abgelehnt", r.rc === 0, r.err);
  }

  // ── N3: Zeichen-Positivliste plus Muster ──────────────────────────────
  // Je Zeile: Text, erwartete Regel. Geprüft wird findeSpuren direkt, damit jede
  // Zeile einzeln rot oder grün wird. Die Tabellen stehen auch im Bericht N3/N4.
  {
    const sperr = ["foobar", "kaiser"];
    const zeichen = "Zeichen nicht erlaubt";
    const nummer = "PR- oder Issue-Nummer";
    const hash = "Commit-Hash";
    const domain = "Adresse (Domain)";
    const v4 = "Serveradresse (IPv4)";
    const v6 = "Serveradresse (IPv6)";
    const hex = "Serveradresse (Hexzahl)";
    const kuerzel = "Serveradresse (Kürzel)";
    const port = "Serveradresse (Port)";
    const endung = "Dateiendung";
    const gesperrt: [string, string][] = [
      // PR- und Issue-Nummern (N1, N1+N2, N2)
      ["Fix #１２３", zeichen],
      ["＃123", zeichen],
      ["Fix # 123", zeichen],
      ["Fix #  45", zeichen],
      ["pull #5", zeichen],
      ["issue/7", zeichen],
      ["pull/123", zeichen],
      ["#１２", zeichen],
      ["PR 123", nummer],
      ["PR 181", nummer],
      ["Pull Request 123", nummer],
      ["GH-123", nummer],
      ["issue 450", nummer],
      ["Commit 777", nummer],
      ["pr-1234", nummer],
      // Adressen
      ["https://github.com/o/r/pull/5", zeichen],
      ["siehe www.example.org", domain],
      ["github.com/o/r", zeichen],
      ["http://x", zeichen],
      ["hxxp://example.org", zeichen],
      ["https\u2236//x", zeichen],
      ["ssh://host", zeichen],
      ["ftp://x", zeichen],
      ["file:///etc", zeichen],
      ["mailto:a@b.c", zeichen],
      ["ｈｔｔｐ：／／", zeichen],
      ["h t t p : / / x", zeichen],
      ["github . com/x", zeichen],
      ["github\u00a0.\u00a0com", zeichen],
      ["github dot com", domain],
      ["g i t h u b", domain],
      ["GitHub", domain],
      ["𝐠𝐢𝐭𝐡𝐮𝐛", zeichen],
      ["ɢɪᴛʜᴜʙ", zeichen], // Kleinkapitälchen: kein Latin-Buchstabe der erlaubten Blöcke
      ["gıthub", domain], // punktloses i wird gefaltet
      ["wov‐dev", zeichen], // U+2010
      ["git‑hub", zeichen], // U+2011
      ["git ‑ hub", zeichen],
      ["ＷＯＶ−ＤＥＶ", zeichen], // U+2212 und Vollbreite
      ["example.com", domain],
      ["foo.de", domain],
      ["wov.de", domain],
      ["wov.dev", domain],
      ["foo dot com", domain],
      ["foo . org", domain],
      ["Wow.gg", domain],
      ["localhost", domain],
      ["localhost:2713", domain],
      ["localhost : 2713", domain],
      // IP-Adressen und Server
      ["127.0.0.1", v4],
      ["127.0.0.1:2713", v4],
      ["10.0.0.1:8080", v4],
      ["192.168.0.1", v4],
      ["192.168.001.001", v4], // N4: führende Nullen
      ["010.000.000.001", v4],
      ["255.255.255.255", v4], // Oktett an der Grenze 255
      ["1.2.3.255", v4],
      ["255.1.2.3", v4],
      ["10.000.000.000 Gold", v4], // N4: bewusste Ablehnung, große Zahlen mit vier Gruppen in Worten schreiben
      ["127 . 0 . 0 . 1", v4],
      ["127．0．0．1", zeichen],
      ["Update 1.2.3.4", v4], // dokumentiert: Versionen haben höchstens drei Teile
      ["[::1]", zeichen],
      ["::1", v6],
      ["fe80::1", v6],
      ["2001:db8::1", v6],
      ["2001:db8:0:0:0:0:0:1", v6],
      ["1:2:3:4:5:6", v6], // 6 Gruppen
      ["a:b:c:d:e:f:1:2", v6], // 8 Gruppen
      ["::ffff:127.0.0.1", v6],
      ["0x7f000001", hex],
      ["wov-dev", kuerzel],
      ["wov dev", kuerzel],
      ["wovdev", kuerzel],
      ["WOV_LIVE", zeichen],
      ["wov_live", kuerzel],
      ["Wov Host", kuerzel],
      ["WOV-Host", kuerzel],
      ["wov-lab", kuerzel],
      ["wov-live", kuerzel],
      ["wov . dev", kuerzel],
      ["Port 2467", port],
      ["Ports 2467", port],
      ["port:8080", port],
      ["liegt in ~/foo", zeichen],
      // Hashes
      ["a1b2c3d", hash],
      ["A1B2C3D4", hash],
      ["a1c7232d", hash],
      ["deadbeefcafe", hash],
      ["deadbeefcafe123", hash],
      ["abc1234", hash], // N4: bewusste Ablehnung (Kürzel nicht von Wort plus Zahl zu trennen)
      ["Bad1234", hash], // N4: bewusste Ablehnung
      ["1facade2026", hash], // Jahres-Ausnahme gilt nur ab Wortanfang
      ["Facade202", hash], // Jahres-Ausnahme: nur vier Ziffern (3 Ziffern: gesperrt)
      ["Facade20266", hash], // 5 Ziffern: gesperrt
      ["Facade1899", hash], // Jahr nur 19xx oder 20xx
      ["a1b2c3d", hash], // genau 7 Zeichen: gesperrt
      ["de09eeb", hash], // echtes Kürzel mit einem Wechsel
      [`Stand ${"0123456789abcdef".repeat(2)}01234567 erreicht`, hash],
      // Pfade
      ["server\\src", zeichen],
      ["C:\\Users\\x", zeichen],
      ["C:/Users/x", zeichen],
      ["/opt/wov", zeichen],
      ["./lauf", zeichen],
      ["c :/x", zeichen],
      ["wov-web/static", zeichen],
      ["dir/foo.js", zeichen],
      // Endungen
      ["bild.png", endung],
      ["notiz.txt", endung],
      ["setup.exe", endung],
      ["lib.so", endung],
      ["main.cpp", endung],
      ["main.c", endung],
      ["kopf.h", endung],
      ["kopf.hpp", endung],
      ["lib.rs", endung],
      ["main.go", endung],
      ["x.rb", endung],
      ["x.lua", endung],
      ["x.sql", endung],
      ["x.csv", endung],
      ["x.xml", endung],
      ["x.ini", endung],
      ["x.toml", endung],
      ["x.zip", endung],
      ["x.gz", endung],
      ["x.tar", endung],
      ["x.gltf", endung],
      ["x.fbx", endung],
      ["x.wav", endung],
      ["x.ogg", endung],
      ["x.mp3", endung],
      ["x.ktx2", endung],
      ["x.bin", endung],
      ["x.jpg", endung],
      ["x.jpeg", endung],
      ["x.webp", endung],
      ["x.svg", endung],
      ["x.gif", endung],
      ["x.log", endung],
      ["x.dll", endung],
      ["tool.py", endung],
      ["run.sh", endung],
      ["style.css", endung],
      ["index.html", endung],
      ["modell.glb", endung],
      ["szene.blend", endung],
      ["nginx.conf", endung],
      ["WovServer.ts", endung],
      ["Welt.TS", endung],
      ["server.js", endung],
      // andere Schriften und Zeichen
      ["f\u043e\u043ebar", zeichen], // kyrillisches „о“ statt „o“
      ["f\u03bf\u03bfbar", zeichen], // griechisches „ο“
      ["g\u0456thub.com", zeichen], // kyrillisches „і“
      ["Привет", zeichen],
      ["こんにちは", zeichen],
      ["a\u0308", zeichen], // zerlegtes „ä“ (kombinierendes Zeichen)
      ["x\u200dy", zeichen], // ZWJ
      ["x\u00a0y", zeichen], // geschütztes Leerzeichen
      ["x\ty", zeichen],
      ["x\ny", zeichen],
      ["Wolf_Rudel", zeichen],
      ["a=b", zeichen],
      ["a<b", zeichen],
      ["{x}", zeichen],
      ["a|b", zeichen],
      ["a*b", zeichen],
      ["a$b", zeichen],
      ["a^b", zeichen],
      ["a`b", zeichen],
      ["a@b", zeichen],
      ["a~b", zeichen],
      ["a[0]", zeichen],
      // Sperrliste auf dem normalisierten Text
      ["foo\u200bbar", "Sperrwort"], // Null-Breite im Sperrwort
      ["foo\u00adbar", "Sperrwort"], // weiche Trennung
      ["foo\u0336bar", "Sperrwort"], // kombinierendes Zeichen (Mn)
      ["ｆｏｏｂａｒ", "Sperrwort"], // Vollbreite
      ["Kaiſer", "Sperrwort"], // langes s
      ["Fóöbar", "Sperrwort"], // Akzente werden gefaltet
    ];
    for (const [text, regel] of gesperrt) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, sperr).join("|");
      pruefe(
        `Gesperrt: ${JSON.stringify(text)} (${regel})`,
        funde.includes(regel),
        `Funde: ${funde || "keine"}`,
      );
    }
    // Freigabe-Fälle aus F7 und B8: die Positivliste und die Muster lassen sie durch.
    const erlaubt = [
      "Node.js",
      "Vue.js",
      "Node.JS",
      "Wir nutzen node.js nicht",
      "Version 1.2",
      "Version 1.2.3",
      "v1.2.3",
      "v1.2.3-beta",
      "2026-09-30",
      "deadbeef",
      "Level 3",
      "Die Regierung spricht 3 Sätze",
      "Der Commit-Ablauf ist kürzer",
      "Der Prüfer kommt um 3 Uhr",
      "Feb-2026",
      "Cafe-2026",
      "Fade-2026",
      "Bade-2026",
      "Ade-1234",
      "ABC-DEF-12345",
      "Facade2026",
      "Decade2026",
      "Decade1999",
      "Feb2026",
      "Fade2026",
      "Bad123",
      "a1b2c3", // 6 Zeichen: frei
      "Facade2026 und Fade1999",
      "256.256.256.256 Gold", // Oktett 256: kein IPv4
      "1.2.3.256",
      "1.2.3",
      "20:00:30",
      "12:30:45",
      "um 5:30:00",
      "Bad::",
      "Face:Dead:Fed",
      "1:2:3:4:5", // 5 Gruppen
      "Pull 3 Gegner",
      "Pull 10 enemies",
      "issue 2 wichtig",
      "Stufe 3 pr 1",
      "PR 12",
      "Commit 77",
      "Heute.Html ist nett",
      "Dienstag.Sh",
      "Ja.Md",
      "Das heißt d.h. dies",
      "Sieg über Wölfe 🐺 und Bären 🐻",
      "⚔ 🛡 🐺 ❤️ 👍🏽 🇩🇪",
      "Ärger über Straße und Öl",
      "Es gibt 25 Ziegen",
      "Der Wolf hat Hunger",
      "um 20:00 Uhr",
      "am 30.09.2026",
      "am 10.5.2026",
      "10.000 Gold",
      "1.000.000 Gold",
      "999.999.999.999 Gold",
      "Preis 9.99",
      "Mo, Di; Mi: frei!",
      "„Zitat“ – Text — noch mehr, ‚so‘ und ’s",
      "Rabatt 20% + Bonus & Zubehör (5 €)",
      'Sie sagt "Hallo" zu Ihm',
      "Gold. Me und du", // Satzpunkt mit Leerzeichen danach ist keine Domain
      "Hinweis:: Text",
    ];
    for (const text of erlaubt) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, sperr);
      pruefe(`Erlaubt: ${JSON.stringify(text)}`, funde.length === 0, funde.join("|"));
    }
    // Überfilterung, die aus der Positivliste folgt: dokumentiert (Allowed text in devlog.ts), kein Befund.
    const dokumentiertAbgelehnt: [string, string][] = [
      ["Client/Server", zeichen],
      ["Server/Src", zeichen],
      ["Nutzt /heim", zeichen],
      ["/gruppe", zeichen],
      ["/w Name Text", zeichen],
      ["Platz #1 der Rangliste", zeichen],
      ["Rang #9", zeichen],
      ["Feuer/Wasser/Erde", zeichen],
      ["3/4 der Karte", zeichen],
      ["und/oder", zeichen],
      ["10 km/h", zeichen],
      ["Schwert/Axt/Bogen", zeichen],
      ["α-Test", zeichen],
      ["Ω-Waffe", zeichen],
      ["🧑‍🌾", zeichen],
      ["zwei\nZeilen", zeichen],
      ["Soft\u00adhyphen", zeichen],
      ["Patch 2.0.1.3", v4],
      ["Sektor 12.34.56.78", v4],
      ["Commit 100 Gold", nummer],
      ["Fertig.go", endung],
      ["Kap.h", endung],
    ];
    for (const [text, regel] of dokumentiertAbgelehnt) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, sperr).join("|");
      pruefe(
        `Dokumentiert abgelehnt: ${JSON.stringify(text)} (${regel})`,
        funde.includes(regel),
        `Funde: ${funde || "keine"}`,
      );
    }
    // Bekannte Restlücken (Karte N3: Bindestrich-Hash entfällt, Kurz-, Dezimal- und Oktal-IP nicht erfasst).
    // Die Tabelle hält den Ist-Zustand fest; wer eine Lücke schließt, ändert hier bewusst.
    const restluecken = [
      "deadbeef-1234567",
      "a1b2-c3d4e5",
      "127.1",
      "2130706433",
      "0177.0.0.1",
      "cafebabe",
    ];
    for (const text of restluecken) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, sperr);
      pruefe(`Restlücke bleibt frei (dokumentiert): ${JSON.stringify(text)}`, funde.length === 0, funde.join("|"));
    }
    // N4/F4: Faltung der Strichbuchstaben und Ligaturen für die Sperrlisten-Prüfung (Liste mit dem Wort „foobar“ usw.).
    const faltung: [string, string, string][] = [
      ["føøbar", "foobar", "ø"],
      ["FØØBAR", "foobar", "Ø"],
      ["Łoewe", "loewe", "ł"],
      ["Đrache", "drache", "đ"],
      ["Ħalle", "halle", "ħ"],
      ["Ŧeufel", "teufel", "ŧ"],
      ["ƀaum", "baum", "ƀ"],
      ["ðrache", "drache", "ð"],
      ["ĸaiser", "kaiser", "ĸ"],
      ["Æther", "aether", "æ"],
      ["Lœwe", "loewe", "œ"],
      ["Þorn", "thorn", "þ"],
      ["Straße", "strasse", "ß"],
    ];
    for (const [text, wort, z] of faltung) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, [wort]).join("|");
      pruefe(`Faltung ${z}: ${JSON.stringify(text)} trifft Sperrwort`, funde.includes("Sperrwort"), funde || "keine");
    }
    // Gegenprobe: ohne Sperrwort lässt die Faltung harmlose Wörter durch.
    for (const text of ["Łódź ist weit", "Þorn und Æther", "Straße und Öl", "Größe ß"]) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, []);
      pruefe(`Faltung: ${JSON.stringify(text)} ohne Sperrwort frei`, funde.length === 0, funde.join("|"));
    }
    // N4/F1: Grenzen der Hash-Regel (Länge 6/7, Jahres-Ausnahme mit 3/4 Ziffern) und F6: Oktett 255/256, je einzeln.
    const grenzen: [string, boolean][] = [
      ["a1b2c3", false],
      ["a1b2c3d", true],
      ["abcdef1", true],
      ["abcdef", false],
      ["abcdefabcd", true], // 10 Buchstaben a-f
      ["abcdefabc", false], // 9 Buchstaben a-f
      ["Facade2026", false],
      ["Facade1999", false],
      ["Facade2999", true],
      ["Facade202", true],
      ["Facade20", true],
      ["Facade20261", true],
      ["Decade2026x", false], // kein Hexzeichen x: die Folge ist kein Kandidat
      ["255.255.255.255", true],
      ["256.255.255.255", false],
      ["255.256.255.255", false],
      ["255.255.255.256", false],
      ["1.2.3.255", true],
      ["1.2.3.256", false],
      ["199.199.199.199", true],
      ["200.249.250.251", true],
      ["200.260.250.251", false],
      ["1.2.3.4", true],
      ["001.002.003.004", true],
      ["0000.1.1.1", false],
      ["6:5:4:3:2:1", true],
      ["5:4:3:2:1", false],
      ["1:2:3:4:5:6:7:8", true],
      ["1:2:3:4:5:6:7:8:9", false], // 9 Gruppen: kein IPv6
      ["fe80::1", true],
      ["bad::", false],
      ["::1", true],
      ["::", false],
      ["dead::beef", false],
      ["dead::be1f", true],
    ];
    for (const [text, gesperrtSoll] of grenzen) {
      const funde = findeSpuren({ de: { titel: "T", punkte: [text] } }, []).filter((f) => !/Zeichen nicht erlaubt/.test(f));
      pruefe(`Grenze ${JSON.stringify(text)}: ${gesperrtSoll ? "gesperrt" : "frei"}`, (funde.length > 0) === gesperrtSoll, funde.join("|"));
    }
    const leer = findeSpuren({ de: { titel: "T", punkte: ["Ein ganz normaler Satz"] } }, ["", "  ", "\u200b"]);
    pruefe("Sperrliste: Zeile, die nach dem Glätten leer ist, sperrt nichts", leer.length === 0, leer.join());
    const benannt = findeSpuren({ de: { titel: "T", punkte: ["a/b"] } }, sperr).join("|");
    pruefe("Meldung nennt das Zeichen als U+XXXX", /U\+002F/.test(benannt), benannt);
  }

  // ── Steuer- und Formatzeichen im Rohtext ─────────────────────────────
  abgelehnt("Bidi-Zeichen U+202E", mit("abc\u202Edef"), /Zeichen nicht erlaubt U\+202E/);
  abgelehnt("Null-Breite im Titel", mit("ab\u200Bc", "titel"), /de\.titel.*U\+200B/);
  abgelehnt("Steuerzeichen Zeilenumbruch", mit("eins\nzwei"), /Zeichen nicht erlaubt U\+000A/);
  abgelehnt("Steuerzeichen NUL", mit("a\u0000b"), /Zeichen nicht erlaubt U\+0000/);

  // ── Überlange Wörter (nur beim Eintragen) ────────────────────────────
  abgelehnt("Wort mit 41 Zeichen im Punkt", mit(`Das ${"x".repeat(41)} geht nicht`), /Wort mit mehr als 40/);
  abgelehnt("Wort mit 41 Zeichen im Titel", mit("x".repeat(41), "titel"), /de\.titel.*Wort mit mehr als 40/);
  {
    const d = ordner();
    const r = lauf(d, mit(`${"x".repeat(40)} ${"ö".repeat(40)}`));
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
    // Gemessen wird von außen: `NODE_OPTIONS=--import <Modul>` hängt sich an renameSync (das
    // Schreiben in der Sperre), hält dort 30 ms und protokolliert Ein- und Austritt. Im Werkzeug
    // selbst gibt es keinen Testhaken.
    const d = ordner();
    const eintragDatei = join(d, "tag.json");
    writeFileSync(eintragDatei, JSON.stringify(tag("2026-09-05")));
    const hookDatei = join(d, "hook.log");
    const modul = join(ARBEIT, "messhaken.mjs");
    writeFileSync(
      modul,
      [
        'import fs from "node:fs";',
        'import { syncBuiltinESMExports } from "node:module";',
        "const log = process.env.DEVLOG_MESS_LOG;",
        "const echt = fs.renameSync;",
        "fs.renameSync = (...a) => {",
        "  fs.appendFileSync(log, `ein ${process.pid} ${process.hrtime.bigint()}\\n`);",
        "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);",
        "  const r = echt(...a);",
        "  fs.appendFileSync(log, `aus ${process.pid} ${process.hrtime.bigint()}\\n`);",
        "  return r;",
        "};",
        "syncBuiltinESMExports();",
        "",
      ].join("\n"),
    );
    const start = (): Promise<number | null> =>
      new Promise((fertig) => {
        const c = spawn(
          process.execPath,
          [WERKZEUG, "--datei", join(d, "devlog.json"), "--eintrag", eintragDatei],
          {
            stdio: "ignore",
            env: { ...process.env, NODE_OPTIONS: `--import ${modul}`, DEVLOG_MESS_LOG: hookDatei },
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
      "4 Prozesse × 40 Runden: 0 Überschneidungen in der Sperre (Messung von außen)",
      ueberschneidungen === 0 && eintritte >= 40,
      `Überschneidungen=${ueberschneidungen} Eintritte=${eintritte}`,
    );
    pruefe(
      "Jede Runde hat einen Sieger, alle anderen enden mit Exit 3 (kein anderer Code)",
      rundenOhneSieger === 0 && fremdeCodes === 0,
      `ohne Sieger=${rundenOhneSieger} fremde Codes=${fremdeCodes}`,
    );
    const quelle = readFileSync(WERKZEUG, "utf8");
    pruefe(
      "Kein Testhaken und keine Sperr-Umgebungsvariable im Werkzeug (B3, B4)",
      !/TEST_HOOK|SPERRE_GEHALTEN|sperrHook/.test(quelle),
    );
  }
  {
    // B4: Eine Umgebungsvariable von außen schaltet die Sperre nicht ab.
    const d = ordner();
    const sperre = join(d, "devlog.json.lock");
    const halter = spawn("flock", [sperre, "sleep", "60"], { stdio: "ignore", detached: true });
    const halterPid = halter.pid as number;
    await new Promise((r) => setTimeout(r, 300));
    const vortaeuschung = {
      DEVLOG_EINTRAGEN_SPERRE_GEHALTEN: "1",
      DEVLOG_EINTRAGEN_SPERRFD: "3",
      DEVLOG_EINTRAGEN_SPERRE: "gehalten",
    };
    const r = lauf(d, tag("2026-09-01"), [], vortaeuschung);
    pruefe(
      "B4: Sperr-Markierung von außen bei belegter Sperre: weiter Exit 3, nichts geschrieben",
      r.rc === 3 && !existsSync(join(d, "devlog.json")),
      `rc=${r.rc} ${r.err}`,
    );
    process.kill(-halterPid, "SIGKILL");
  }
  {
    // B5: führendes „-“ im Dateinamen ist ein Name, kein Schalter.
    const d = ordner();
    const eintragDatei = join(d, "tag.json");
    writeFileSync(eintragDatei, JSON.stringify(tag("2026-09-09")));
    const r = spawnSync(process.execPath, [WERKZEUG, "--datei", "-x.json", "--eintrag", eintragDatei], {
      cwd: d,
      encoding: "utf8",
    });
    pruefe(
      "B5: --datei -x.json (führendes Minus): Exit 0, Datei und Sperrdatei mit diesem Namen",
      r.status === 0 && existsSync(join(d, "-x.json")) && existsSync(join(d, "-x.json.lock")),
      `rc=${r.status} ${r.stderr}`,
    );
  }
  {
    // B6: flock fehlt, stirbt durch ein Signal oder endet unerwartet: nie Exit 0, nichts geschrieben.
    const d = ordner();
    const leerBin = join(d, "leerbin");
    mkdirSync(leerBin);
    const fehlt = lauf(d, tag("2026-09-01"), [], { PATH: leerBin });
    pruefe(
      "B6: flock fehlt (PATH ohne flock): Exit 2 mit Meldung, nichts geschrieben",
      fehlt.rc === 2 && /flock nicht startbar/.test(fehlt.err) && !existsSync(join(d, "devlog.json")),
      `rc=${fehlt.rc} ${fehlt.err}`,
    );
    const attrappe = (name: string, koerper: string): string => {
      const bin = join(d, name);
      mkdirSync(bin);
      writeFileSync(join(bin, "flock"), `#!/bin/sh\n${koerper}\n`);
      chmodSync(join(bin, "flock"), 0o755);
      return bin;
    };
    const signal = lauf(d, tag("2026-09-01"), [], { PATH: attrappe("signalbin", "kill -9 $$") });
    pruefe(
      "B6: flock stirbt durch Signal: Exit 2 (nicht 0), nichts geschrieben",
      signal.rc === 2 && /Signal/.test(signal.err) && !existsSync(join(d, "devlog.json")),
      `rc=${signal.rc} ${signal.err}`,
    );
    const seltsam = lauf(d, tag("2026-09-01"), [], { PATH: attrappe("seltsambin", "exit 64") });
    pruefe(
      "B5: flock endet mit unbekanntem Exit 64: Exit 2 (nicht 64), nichts geschrieben",
      seltsam.rc === 2 && !existsSync(join(d, "devlog.json")),
      `rc=${seltsam.rc} ${seltsam.err}`,
    );
    const belegt = lauf(d, tag("2026-09-01"), [], { PATH: attrappe("belegtbin", "exit 75") });
    pruefe(
      "flock meldet belegt (75): Exit 3",
      belegt.rc === 3 && !existsSync(join(d, "devlog.json")),
      `rc=${belegt.rc} ${belegt.err}`,
    );
  }
  {
    // B9: Sperrdatei mit 0600 und ohne Symlink.
    const d = ordner();
    const ok = lauf(d, tag("2026-09-01"));
    const modus = statSync(join(d, "devlog.json.lock")).mode & 0o777;
    pruefe("B9: Sperrdatei entsteht mit Modus 0600", ok.rc === 0 && modus === 0o600, `rc=${ok.rc} modus=${modus.toString(8)}`);
    const d2 = ordner();
    const opfer = join(d2, "opfer.txt");
    symlinkSync(opfer, join(d2, "devlog.json.lock"));
    const r = lauf(d2, tag("2026-09-01"));
    pruefe(
      "B9: Sperrdatei ist ein Symlink ins Leere: Exit 2, Ziel nicht angelegt, nichts geschrieben",
      r.rc === 2 && !existsSync(opfer) && !existsSync(join(d2, "devlog.json")),
      `rc=${r.rc} ${r.err}`,
    );
    const d3 = ordner();
    const vorhanden = join(d3, "vorhanden.txt");
    writeFileSync(vorhanden, "fremd");
    symlinkSync(vorhanden, join(d3, "devlog.json.lock"));
    const r3 = lauf(d3, tag("2026-09-01"));
    pruefe(
      "B9: Sperrdatei ist ein Symlink auf eine Datei: Exit 2, Inhalt unberührt",
      r3.rc === 2 && readFileSync(vorhanden, "utf8") === "fremd",
      `rc=${r3.rc} ${r3.err}`,
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
    const spur = pruefen(tag("2026-09-08", "Fix PR 123"));
    pruefe("--pruefen: Spur Exit 1 mit Meldung", spur.rc === 1 && /PR- oder Issue-Nummer/.test(spur.err), spur.err);
    const wort = pruefen(tag("2026-09-08", "x".repeat(41)));
    pruefe("--pruefen: überlanges Wort Exit 1", wort.rc === 1 && /Wort mit mehr als 40/.test(wort.err), wort.err);
    const schema = pruefen({ datum: "2026-09-08", de: tag("x").de });
    pruefe("--pruefen: Schemafehler Exit 1", schema.rc === 1 && /en: fehlt/.test(schema.err), schema.err);
    const fremdSchrift = pruefen(tag("2026-09-08", "fооbar"));
    pruefe("--pruefen: fremde Schrift Exit 1", fremdSchrift.rc === 1 && /Zeichen nicht erlaubt U\+043E/.test(fremdSchrift.err), fremdSchrift.err);
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
