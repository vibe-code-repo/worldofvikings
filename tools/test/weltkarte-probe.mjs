/**
 * Probe für tools/weltkarte-veroeffentlichen.mjs: rendert die echten
 * Weltdokumente in ein Temp-Verzeichnis und prüft die lokale Ablage.
 *
 * Lauf:  node tools/test/weltkarte-probe.mjs           kleine Probe (256 px, ~15 s, ohne den
 *                                                       Parallel-Lauf; so läuft sie im Sammellauf)
 *         node tools/test/weltkarte-probe.mjs --gross   große Probe (4096 px, ~1 min,
 *                                                       bis ~650 MB; von Hand vor
 *                                                       Änderungen an der Kartenveröffentlichung)
 *
 * Aufbau: Das Skript leitet seine Wurzel aus dem eigenen Ort ab. Deshalb
 * entsteht unter /tmp/web-karte-<pid>/wurzel ein kleiner Baum (Kopie der
 * beiden Werkzeuge und der Weltdokumente, Verknüpfungen auf node_modules und
 * shared), das Skript läuft dort mit WOV_KARTEN_ARBEIT/WOV_KARTEN_AUSGABE auf
 * Temp-Pfade. Das echte /var/lib/wov-karten und wov-web/build bleiben
 * unberührt. Die Breite kommt über WOV_KARTEN_BREITE (klein 256, groß 4096).
 */
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sharp = createRequire(join(REPO, "package.json"))("sharp");
sharp.cache(false); // die Probe liest dieselben Pfade mit wechselnden Bildern

const GROSS = process.argv.includes("--gross");
const BREITE = GROSS ? 4096 : 256;

const TEMP = `/tmp/web-karte-${process.pid}`;
const WURZEL = join(TEMP, "wurzel");
const ARBEIT = join(TEMP, "arbeit");
const AUSGABE = join(TEMP, "ausgabe");

let fehler = 0;
const sleepPids = [];
function pruefe(bedingung, text) {
  console.log(`${bedingung ? "OK   " : "FEHLT"} ${text}`);
  if (!bedingung) fehler++;
}
const lies = (p) => JSON.parse(readFileSync(p, "utf-8"));

const SPERRE = join(TEMP, "run", "sperre");
const SKRIPT = () => join(WURZEL, "tools/weltkarte-veroeffentlichen.mjs");
const UMGEBUNG = () => ({
  ...process.env,
  WOV_KARTEN_BREITE: String(BREITE),
  WOV_KARTEN_ARBEIT: ARBEIT,
  WOV_KARTEN_AUSGABE: AUSGABE,
  WOV_KARTEN_SPERRE: SPERRE,
});

function lauf(...argumente) {
  return laufMit({}, ...argumente);
}

function laufMit(umgebung, ...argumente) {
  const e = spawnSync(process.execPath, [SKRIPT(), ...argumente], {
    env: { ...UMGEBUNG(), ...umgebung },
    encoding: "utf-8",
    timeout: 600_000,
  });
  if (e.stdout) process.stdout.write(e.stdout);
  if (e.stderr) process.stderr.write(e.stderr);
  return e.status;
}

function aufraeumen() {
  for (const pid of sleepPids) {
    try {
      process.kill(pid);
    } catch {
      /* schon weg */
    }
  }
  rmSync(TEMP, { recursive: true, force: true });
}

// N1-A6: Auch bei einem Abbruch (Zeitlimit des Runners, Strg-C) das Temp-Verzeichnis
// entfernen. Der Handler läuft, sobald ein gerade laufender spawnSync zurückkehrt.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    aufraeumen();
    process.exit(1);
  });
}

try {
  mkdirSync(join(WURZEL, "tools"), { recursive: true });
  mkdirSync(join(WURZEL, "server/data/welten"), { recursive: true });
  for (const f of ["weltkarte-veroeffentlichen.mjs", "weltkarte-rendern.ts"]) {
    cpSync(join(REPO, "tools", f), join(WURZEL, "tools", f));
  }
  cpSync(join(REPO, "package.json"), join(WURZEL, "package.json"));
  symlinkSync(join(REPO, "node_modules"), join(WURZEL, "node_modules"));
  symlinkSync(join(REPO, "shared"), join(WURZEL, "shared"));
  const welten = join(WURZEL, "server/data/welten");
  const gefunden = ["dev", "live"].filter((i) =>
    existsSync(join(REPO, "server/data/welten", `${i}.json`)),
  );
  pruefe(
    gefunden.includes("dev") && gefunden.includes("live"),
    `Weltdokumente im Repo: ${gefunden.join(", ")}`,
  );
  for (const i of gefunden)
    cpSync(join(REPO, "server/data/welten", `${i}.json`), join(welten, `${i}.json`));

  // 1. Erster Lauf: alles neu
  console.log("\n— Lauf 1 (leer) —");
  pruefe(lauf() === 0, "Lauf 1 endet mit Exit 0");
  const ue1 = lies(join(AUSGABE, "karten.json"));
  const alter = Date.now() - Date.parse(ue1.erzeugt);
  pruefe(
    alter >= 0 && alter < 5 * 60_000,
    `karten.json.erzeugt höchstens 5 min alt (${Math.round(alter / 1000)} s)`,
  );
  pruefe(
    ue1.welten.map((w) => w.instanz).join() === gefunden.join(),
    "karten.json nennt alle vorhandenen Welten",
  );
  for (const w of ue1.welten) {
    const meta = await sharp(join(AUSGABE, w.bild)).metadata();
    const roh = await sharp(join(AUSGABE, w.bild)).raw().toBuffer(); // erzwingt vollständiges Dekodieren
    pruefe(
      meta.format === "webp" && meta.width === BREITE && roh.length > 0,
      `${w.bild}: webp, ${meta.width} px breit (Soll ${BREITE}), dekodierbar`,
    );
    pruefe(existsSync(join(AUSGABE, w.beschreibung)), `${w.beschreibung} liegt in der Ausgabe`);
    pruefe(
      lies(join(AUSGABE, w.beschreibung)).breite === BREITE,
      `${w.beschreibung}: breite = ${BREITE}`,
    );
  }
  const dev1 = lies(join(AUSGABE, "dev.json")).gerendert;
  const live1 = lies(join(AUSGABE, "live.json")).gerendert;

  // 2. Zweiter Lauf ohne Änderung: kein Rendern
  console.log("\n— Lauf 2 (unverändert) —");
  pruefe(lauf() === 0, "Lauf 2 endet mit Exit 0");
  pruefe(
    lies(join(AUSGABE, "dev.json")).gerendert === dev1,
    "dev: Zeitstempel unverändert (nicht neu gerendert)",
  );
  pruefe(
    lies(join(AUSGABE, "live.json")).gerendert === live1,
    "live: Zeitstempel unverändert (nicht neu gerendert)",
  );
  pruefe(
    lies(join(AUSGABE, "karten.json")).erzeugt !== ue1.erzeugt,
    "karten.json wurde aufgefrischt",
  );

  // 3. Änderung am Weltdokument (Kopie): dev rendert neu, live nicht
  console.log("\n— Lauf 3 (dev-Weltdokument geändert) —");
  const devDoku = lies(join(welten, "dev.json"));
  devDoku.name = `${devDoku.name} (Probe)`;
  writeFileSync(join(welten, "dev.json"), JSON.stringify(devDoku));
  pruefe(lauf() === 0, "Lauf 3 endet mit Exit 0");
  const dev3 = lies(join(AUSGABE, "dev.json"));
  pruefe(dev3.gerendert !== dev1, "dev: neu gerendert");
  pruefe(dev3.name.endsWith("(Probe)"), "dev: Ausgabe zeigt die geänderte Welt");
  pruefe(
    lies(join(AUSGABE, "live.json")).gerendert === live1,
    "live: weiterhin nicht neu gerendert",
  );

  // 3b. F1: Beschreibung trägt den Fingerabdruck, das Bild ist abgeschnitten
  console.log("\n— Lauf 3b (abgeschnittenes Bild, Reste, Sperre) —");
  const devBild = join(ARBEIT, "dev.webp");
  const ganz = readFileSync(devBild);
  const halb = Math.floor(ganz.length / 2); // abgeschnitten, in jeder Breite
  writeFileSync(devBild, ganz.subarray(0, halb));
  writeFileSync(join(ARBEIT, "dev.webp.1.tmp"), "rest");
  writeFileSync(join(AUSGABE, "dev.webp.1.tmp"), "rest");
  // N1-1 (b): Sperre mit der PID eines FREMDEN lebenden Prozesses (ein sleep)
  // gilt nicht als gehalten: Der Lauf übernimmt sie.
  mkdirSync(dirname(SPERRE), { recursive: true });
  const fremd = spawn("sleep", ["120"], { stdio: "ignore" });
  sleepPids.push(fremd.pid);
  writeFileSync(SPERRE, String(fremd.pid));
  pruefe(lauf() === 0, "N1-1b: Sperre einer fremden lebenden PID wird übernommen (Exit 0)");
  pruefe(!existsSync(SPERRE), "Sperre nach dem Lauf gelöst");
  writeFileSync(SPERRE, "999999999"); // toter Prozess: wird übernommen
  pruefe(lauf() === 0, "Sperre einer toten PID wird übernommen (Exit 0)");
  writeFileSync(devBild, ganz.subarray(0, halb));
  writeFileSync(join(ARBEIT, "dev.webp.1.tmp"), "rest");
  writeFileSync(join(AUSGABE, "dev.webp.1.tmp"), "rest");
  writeFileSync(SPERRE, String(fremd.pid));
  pruefe(lauf() === 0, "F1: Lauf mit abgeschnittenem Bild endet mit Exit 0");
  const meta3b = await sharp(join(AUSGABE, "dev.webp")).metadata();
  const roh3b = await sharp(join(AUSGABE, "dev.webp")).raw().toBuffer();
  pruefe(
    meta3b.width === BREITE && roh3b.length > 0,
    `F1: veröffentlichtes dev.webp ist ganz (${BREITE} px, dekodierbar)`,
  );
  pruefe(
    readFileSync(join(ARBEIT, "dev.webp")).length > halb,
    "F1: Arbeitskopie wurde neu gerendert",
  );
  pruefe(!existsSync(join(AUSGABE, "dev.webp.1.tmp")), "F4: .tmp in der Ausgabe gelöscht");
  pruefe(!existsSync(join(ARBEIT, "dev.webp.1.tmp")), "F4: .tmp in der Arbeit gelöscht");
  pruefe(!existsSync(SPERRE), "F2: Sperre nach dem Lauf gelöst");

  // Lastfall (nur mit --gross): zwei echte Läufe gleichzeitig. Zwei volle Renderläufe
  // kosten in der kleinen Probe rund 6 s; die Sperre selbst prüfen 3b und diese Probe in groß.
  if (GROSS) {
    // N1-1 (c): Ein echter, gleichnamiger Lauf hält die Sperre: der zweite endet
    // mit Status 75 und ändert nichts.
    console.log("\n— Lauf 3c (zweiter Lauf gegen laufenden) —");
    const erster = spawn(process.execPath, [SKRIPT(), "--neu"], {
      env: UMGEBUNG(),
      stdio: "ignore",
    });
    const ersterEnde = new Promise((ok) => erster.on("close", (code) => ok(code)));
    for (let i = 0; i < 150 && !existsSync(SPERRE); i++)
      await new Promise((r) => setTimeout(r, 100));
    pruefe(
      existsSync(SPERRE) && readFileSync(SPERRE, "utf-8") === String(erster.pid),
      "erster Lauf hält die Sperre mit seiner PID",
    );
    const vorZweitem = readFileSync(join(AUSGABE, "karten.json"), "utf-8");
    pruefe(lauf() === 75, "N1-1c: zweiter Lauf endet mit Status 75");
    pruefe(
      readFileSync(join(AUSGABE, "karten.json"), "utf-8") === vorZweitem,
      "N1-1c: zweiter Lauf ändert nichts",
    );
    pruefe(existsSync(SPERRE), "N1-1c: Sperre des ersten Laufs bleibt stehen");
    pruefe((await ersterEnde) === 0, "erster Lauf endet mit Exit 0");
    pruefe(!existsSync(SPERRE), "Sperre nach dem ersten Lauf gelöst");
  }

  // 3d. F2 (d): ungültige Breite → Fehler, bevor etwas angefasst wird
  console.log("\n— Lauf 3d (ungültige Breite) —");
  const vorBreite = readFileSync(join(AUSGABE, "karten.json"), "utf-8");
  for (const schlecht of ["255", "8193", "abc", "0", "-4096", "4096.5", "1e3"]) {
    pruefe(
      laufMit({ WOV_KARTEN_BREITE: schlecht }) === 1,
      `F2d: WOV_KARTEN_BREITE=${schlecht} endet mit Exit 1`,
    );
  }
  pruefe(
    readFileSync(join(AUSGABE, "karten.json"), "utf-8") === vorBreite,
    "F2d: ungültige Breite ändert nichts",
  );
  pruefe(!existsSync(SPERRE), "F2d: keine Sperre zurückgelassen");
  const rbreit = spawnSync(
    join(WURZEL, "node_modules/.bin/tsx"),
    [join(WURZEL, "tools/weltkarte-rendern.ts"), "dev", join(TEMP, "rbreit"), "100"],
    { encoding: "utf-8" },
  );
  pruefe(rbreit.status !== 0, "F2d: der Renderer lehnt Breite 100 ab");

  // 3e. F2 (b): Fällt dev aus, bleibt dev stehen und live wird trotzdem veröffentlicht
  console.log("\n— Lauf 3e (dev-Weltdatei kaputt, live geändert) —");
  const devText = readFileSync(join(welten, "dev.json"), "utf-8");
  const devVorher = readFileSync(join(AUSGABE, "dev.webp"));
  const devJsonVorher = readFileSync(join(AUSGABE, "dev.json"));
  const liveDoku = lies(join(welten, "live.json"));
  liveDoku.name = `${liveDoku.name} (F2)`;
  writeFileSync(join(welten, "live.json"), JSON.stringify(liveDoku));
  writeFileSync(join(welten, "dev.json"), "{kaputt");
  const status3e = lauf();
  pruefe(
    status3e === 1,
    `F2b: Lauf mit ausgefallener dev-Welt endet mit Exit 1 (Status ${status3e})`,
  );
  pruefe(!existsSync(SPERRE), "F2b: Sperre nach dem Ausfall gelöst");
  const ue3e = lies(join(AUSGABE, "karten.json"));
  pruefe(
    ue3e.welten.map((w) => w.instanz).join() === "dev,live",
    "F2b: karten.json führt beide Welten (dev mit der alten Karte)",
  );
  pruefe(
    lies(join(AUSGABE, "live.json")).name.endsWith("(F2)"),
    "F2b: live wurde trotz dev-Ausfall veröffentlicht (neuer Name)",
  );
  pruefe(
    readFileSync(join(AUSGABE, "dev.webp")).equals(devVorher) &&
      readFileSync(join(AUSGABE, "dev.json")).equals(devJsonVorher),
    "F2b: dev behält seine bisherigen öffentlichen Dateien (byte-gleich)",
  );
  writeFileSync(join(welten, "dev.json"), devText);
  pruefe(lauf() === 0, "F2b: nach Wiederherstellung endet der Lauf mit Exit 0");
  pruefe(!existsSync(SPERRE), "Sperre nach dem Lauf gelöst");

  // 4. F2 (c): Ohne live.json — Karenz: erster Lauf behält live, zweiter entfernt es
  console.log("\n— Lauf 4 (ohne live.json, Karenz) —");
  const liveText = readFileSync(join(welten, "live.json"), "utf-8");
  rmSync(join(welten, "live.json"));
  pruefe(lauf("--nur-rendern") === 0, "N1-4: --nur-rendern endet mit Exit 0");
  pruefe(
    existsSync(join(AUSGABE, "live.webp")) && existsSync(join(AUSGABE, "live.json")),
    "N1-4: --nur-rendern löscht nichts in der Ausgabe",
  );
  pruefe(!existsSync(join(ARBEIT, "live.fehlt")), "F2c: --nur-rendern zählt nicht");
  pruefe(lauf() === 0, "F2c: erster Lauf ohne live.json endet mit Exit 0");
  pruefe(
    existsSync(join(AUSGABE, "live.webp")) && existsSync(join(AUSGABE, "live.json")),
    "F2c: erster Lauf: live-Dateien bleiben in der Ausgabe",
  );
  const ue4a = lies(join(AUSGABE, "karten.json"));
  pruefe(
    ue4a.welten.some((w) => w.instanz === "live"),
    'F2c: erster Lauf: karten.json führt "live" weiter',
  );
  // N1-A4: Weltdatei wieder da, nur ein --nur-rendern-Lauf: der Zähler wird trotzdem zurückgesetzt
  writeFileSync(join(welten, "live.json"), liveText);
  pruefe(existsSync(join(ARBEIT, "live.fehlt")), "N1-A4: Zähler steht nach dem ersten Fehllauf");
  pruefe(lauf("--nur-rendern") === 0, "N1-A4: --nur-rendern mit vorhandener Welt, Exit 0");
  pruefe(!existsSync(join(ARBEIT, "live.fehlt")), "N1-A4: --nur-rendern setzt den Zähler zurück");
  // Weltdatei kommt zurück: der Zähler beginnt von vorn
  writeFileSync(join(welten, "live.json"), liveText);
  pruefe(lauf() === 0, "F2c: Weltdatei wieder da, Exit 0");
  pruefe(!existsSync(join(ARBEIT, "live.fehlt")), "F2c: Zähler zurückgesetzt");
  rmSync(join(welten, "live.json"));
  pruefe(lauf() === 0, "F2c: erneut fehlend, erster Lauf Exit 0");
  pruefe(
    existsSync(join(AUSGABE, "live.webp")),
    "F2c: nach Zurücksetzen bleibt live wieder einen Lauf",
  );
  pruefe(lauf() === 0, "F2c: zweiter Lauf in Folge endet mit Exit 0");
  pruefe(
    !existsSync(join(AUSGABE, "live.webp")) && !existsSync(join(AUSGABE, "live.json")),
    "F2c: zweiter Lauf: live-Dateien aus der Ausgabe entfernt",
  );
  const ue4 = lies(join(AUSGABE, "karten.json"));
  pruefe(!ue4.welten.some((w) => w.instanz === "live"), 'karten.json hat keinen Eintrag "live"');
  pruefe(
    ue4.welten.some((w) => w.instanz === "dev"),
    'karten.json hat weiter "dev"',
  );

  // N1-A1/A3: Breitenwechsel, Welt unverändert: ein einziger Lauf rendert neu und legt die neue Breite ab
  console.log("\n— Lauf 5 (Breite wechselt, Welt gleich) —");
  const NEU = GROSS ? 2048 : BREITE * 2; // groß: verkleinern, 8192 wäre zu schwer
  const status5 = laufMit({ WOV_KARTEN_BREITE: String(NEU) });
  pruefe(
    status5 === 0,
    `N1-A1: Breitenwechsel ${BREITE}→${NEU} in einem Lauf, Exit 0 (Status ${status5})`,
  );
  const meta5 = await sharp(join(AUSGABE, "dev.webp")).metadata();
  pruefe(
    meta5.width === NEU,
    `N1-A1: veröffentlichtes dev.webp ist ${NEU} px breit (${meta5.width})`,
  );
  pruefe(lies(join(AUSGABE, "dev.json")).breite === NEU, `N1-A1: dev.json: breite = ${NEU}`);
  pruefe(!existsSync(SPERRE), "Sperre nach dem Lauf gelöst");

  // N1-A2/A3: Ablegefehler mitten im Paar (erzwungen: Bild liegt, Beschreibung scheitert)
  console.log("\n— Lauf 6 (Ablegefehler mitten im Paar) —");
  const bild6 = readFileSync(join(AUSGABE, "dev.webp"));
  const json6 = readFileSync(join(AUSGABE, "dev.json"));
  const dokuA2 = lies(join(welten, "dev.json"));
  dokuA2.regions[0].shape.radius = dokuA2.regions[0].shape.radius * 3; // das Bild ändert sich
  writeFileSync(join(welten, "dev.json"), JSON.stringify(dokuA2));
  const status6 = laufMit({
    WOV_KARTEN_BREITE: String(NEU),
    WOV_KARTEN_PROBE_ABLEGEFEHLER: "dev.json",
  });
  pruefe(status6 === 1, `N1-A2: Ablegefehler endet mit Exit 1 (Status ${status6})`);
  pruefe(
    readFileSync(join(AUSGABE, "dev.webp")).equals(bild6) &&
      readFileSync(join(AUSGABE, "dev.json")).equals(json6),
    "N1-A2: kein Mischzustand, Bild und Beschreibung wie zuletzt veröffentlicht",
  );
  const ue6 = lies(join(AUSGABE, "karten.json"));
  pruefe(
    ue6.welten.length === 1 &&
      ue6.welten[0].instanz === "dev" &&
      ue6.welten[0].fingerabdruck === lies(join(AUSGABE, "dev.json")).fingerabdruck,
    "N1-A2: karten.json zeigt auf die zuletzt vollständig veröffentlichte Fassung",
  );
  pruefe(!existsSync(SPERRE), "Sperre nach dem Ablegefehler gelöst");
  pruefe(
    laufMit({ WOV_KARTEN_BREITE: String(NEU) }) === 0,
    "N1-A2: Lauf ohne Fehler heilt, Exit 0",
  );
  pruefe(
    !readFileSync(join(AUSGABE, "dev.webp")).equals(bild6) &&
      lies(join(AUSGABE, "dev.json")).fingerabdruck ===
        lies(join(AUSGABE, "karten.json")).welten[0].fingerabdruck,
    "N1-A2: danach liegt das neue Paar stimmig da",
  );

  const reste = readdirSync(AUSGABE).filter((n) => n.endsWith(".tmp"));
  pruefe(reste.length === 0, `keine Temp-Dateien in der Ausgabe (${reste.length})`);
} finally {
  aufraeumen();
}
await new Promise((r) => setTimeout(r, 300));
for (const pid of sleepPids) pruefe(!existsSync(`/proc/${pid}`), `sleep ${pid} beendet`);
pruefe(!existsSync(TEMP), `${TEMP} aufgeräumt`);
console.log(fehler === 0 ? "\nProbe grün" : `\nProbe ROT (${fehler} Fehler)`);
process.exit(fehler === 0 ? 0 : 1);
