/**
 * PRÜFT tools/devlog/eintragen.mjs: Schema, jede Sperrregel, Einfügen,
 * Ersetzen, Kürzen auf 512 KB, Byte-Gleichheit beim zweiten Lauf und
 * atomares Schreiben.
 *
 * Die Sperrliste der echten Läufe liegt nicht im Repo; hier steht nur eine
 * Fixture-Sperrliste mit harmlosen Wörtern (`foobar`).
 *
 * Lauf: npx tsx tools/test/devlog-eintragen.ts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as echt from "node:fs";
import { schreibeAtomar } from "../devlog/eintragen.mjs";

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

function lauf(dir: string, eintrag: unknown, args: string[] = []) {
  const eintragDatei = join(dir, "tag.json");
  writeFileSync(eintragDatei, typeof eintrag === "string" ? eintrag : JSON.stringify(eintrag));
  const r = spawnSync(
    process.execPath,
    [WERKZEUG, "--datei", join(dir, "devlog.json"), "--eintrag", eintragDatei, ...args],
    { encoding: "utf8" },
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
      tag("2026-09-02", "T", { de: { titel: "T".repeat(80), punkte: ["y".repeat(280)] } }),
    );
    pruefe("Grenzwerte 80 und 280 Zeichen sind erlaubt", r.rc === 0, r.err);
  }

  // ── Sperrregeln ──────────────────────────────────────────────────────
  const mit = (text: string, ort: "titel" | "punkt" = "punkt"): Tag =>
    ort === "titel"
      ? tag("2026-09-02", text)
      : tag("2026-09-02", "T", { de: { titel: "T", punkte: [text] } });
  abgelehnt("PR-Nummer", mit("Behoben in #123."), /PR- oder Issue-Nummer.*#123/);
  abgelehnt("Issue-Nummer im Titel", mit("Fix für #7", "titel"), /PR- oder Issue-Nummer/);
  abgelehnt("Commit-Hash (7 Zeichen)", mit("Stand a1b2c3d erreicht"), /Commit-Hash.*a1b2c3d/);
  abgelehnt(
    "Commit-Hash (40 Zeichen)",
    mit(`Stand ${"0123456789abcdef".repeat(2)}01234567 erreicht`),
    /Commit-Hash/,
  );
  abgelehnt("Dateipfad mit Wurzelordner", mit("Geändert in server/src/Welt"), /Dateipfad/);
  abgelehnt("Dateipfad mit drei Teilen", mit("Siehe a/b/c dazu"), /Dateipfad/);
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

  // ── Datei defekt, Aufruf ─────────────────────────────────────────────
  {
    const d = ordner();
    writeFileSync(join(d, "devlog.json"), "{kaputt");
    const vor = datei(d);
    const r = lauf(d, tag("2026-09-02"));
    pruefe(
      "Defekte Datei: Exit 2, Datei unverändert",
      r.rc === 2 && vor.equals(datei(d)),
      `rc=${r.rc} ${r.err}`,
    );
    const ohne = spawnSync(process.execPath, [WERKZEUG], { encoding: "utf8" });
    pruefe("Ohne Argumente: Exit 2", ohne.status === 2);
  }

  // ── Kürzen auf 512 KB ────────────────────────────────────────────────
  {
    const d = ordner();
    const grenze = 512 * 1024;
    const gross = (n: number): Tag => {
      const t = new Date(Date.UTC(2020, 0, 1) + n * 86400000).toISOString().slice(0, 10);
      return tag(t, `Eintrag ${n}`, {
        de: { titel: `Eintrag ${n}`, punkte: Array.from({ length: 8 }, () => "ä".repeat(280)) },
        en: { titel: `Entry ${n}`, punkte: Array.from({ length: 8 }, () => "e".repeat(280)) },
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
      "Atomar: Reihenfolge öffnen, schreiben, sichern, schließen, umhängen",
      aufrufe.join() === "open,write,fsync,close,rename",
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

console.log(
  fehler === 0
    ? `\ndevlog-eintragen: alle ${zaehler} Prüfungen grün.\n`
    : `\ndevlog-eintragen: ${fehler} von ${zaehler} FEHLGESCHLAGEN.\n`,
);
process.exit(fehler > 0 ? 1 : 0);
