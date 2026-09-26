/**
 * Probe für tools/weltkarte-veroeffentlichen.mjs: rendert die echten
 * Weltdokumente in ein Temp-Verzeichnis und prüft die lokale Ablage.
 *
 * Lauf:  node tools/test/weltkarte-probe.mjs
 *
 * Aufbau: Das Skript leitet seine Wurzel aus dem eigenen Ort ab. Deshalb
 * entsteht unter /tmp/web-karte-<pid>/wurzel ein kleiner Baum (Kopie der
 * beiden Werkzeuge und der Weltdokumente, Verknüpfungen auf node_modules und
 * shared), das Skript läuft dort mit WOV_KARTEN_ARBEIT/WOV_KARTEN_AUSGABE auf
 * Temp-Pfade. Das echte /var/lib/wov-karten und wov-web/build bleiben
 * unberührt. Es rendert dreimal in voller Breite (je ~20–60 s).
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
  WOV_KARTEN_ARBEIT: ARBEIT,
  WOV_KARTEN_AUSGABE: AUSGABE,
  WOV_KARTEN_SPERRE: SPERRE,
});

function lauf(...argumente) {
  const e = spawnSync(process.execPath, [SKRIPT(), ...argumente], {
    env: UMGEBUNG(),
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
      meta.format === "webp" && meta.width === 4096 && roh.length > 0,
      `${w.bild}: webp, ${meta.width} px breit, dekodierbar`,
    );
    pruefe(existsSync(join(AUSGABE, w.beschreibung)), `${w.beschreibung} liegt in der Ausgabe`);
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
  writeFileSync(devBild, ganz.subarray(0, 50_000));
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
  writeFileSync(devBild, ganz.subarray(0, 50_000));
  writeFileSync(join(ARBEIT, "dev.webp.1.tmp"), "rest");
  writeFileSync(join(AUSGABE, "dev.webp.1.tmp"), "rest");
  writeFileSync(SPERRE, String(fremd.pid));
  pruefe(lauf() === 0, "F1: Lauf mit abgeschnittenem Bild endet mit Exit 0");
  const meta3b = await sharp(join(AUSGABE, "dev.webp")).metadata();
  const roh3b = await sharp(join(AUSGABE, "dev.webp")).raw().toBuffer();
  pruefe(
    meta3b.width === 4096 && roh3b.length > 0,
    "F1: veröffentlichtes dev.webp ist ganz (4096 px, dekodierbar)",
  );
  pruefe(
    readFileSync(join(ARBEIT, "dev.webp")).length > 50_000,
    "F1: Arbeitskopie wurde neu gerendert",
  );
  pruefe(!existsSync(join(AUSGABE, "dev.webp.1.tmp")), "F4: .tmp in der Ausgabe gelöscht");
  pruefe(!existsSync(join(ARBEIT, "dev.webp.1.tmp")), "F4: .tmp in der Arbeit gelöscht");
  pruefe(!existsSync(SPERRE), "F2: Sperre nach dem Lauf gelöst");

  // N1-1 (c): Ein echter, gleichnamiger Lauf hält die Sperre: der zweite endet
  // mit Status 75 und ändert nichts.
  console.log("\n— Lauf 3c (zweiter Lauf gegen laufenden) —");
  const erster = spawn(process.execPath, [SKRIPT(), "--neu"], { env: UMGEBUNG(), stdio: "ignore" });
  const ersterEnde = new Promise((ok) => erster.on("close", (code) => ok(code)));
  for (let i = 0; i < 150 && !existsSync(SPERRE); i++) await new Promise((r) => setTimeout(r, 100));
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

  // 4. Ohne live.json: übersprungen, kein Fehler
  console.log("\n— Lauf 4 (ohne live.json) —");
  rmSync(join(welten, "live.json"));
  pruefe(lauf("--nur-rendern") === 0, "N1-4: --nur-rendern endet mit Exit 0");
  pruefe(
    existsSync(join(AUSGABE, "live.webp")) && existsSync(join(AUSGABE, "live.json")),
    "N1-4: --nur-rendern löscht nichts in der Ausgabe",
  );
  pruefe(lauf() === 0, "Lauf 4 endet mit Exit 0");
  const ue4 = lies(join(AUSGABE, "karten.json"));
  pruefe(!ue4.welten.some((w) => w.instanz === "live"), 'karten.json hat keinen Eintrag "live"');
  pruefe(
    ue4.welten.some((w) => w.instanz === "dev"),
    'karten.json hat weiter "dev"',
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
