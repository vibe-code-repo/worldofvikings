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
import { spawnSync } from "node:child_process";
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
function pruefe(bedingung, text) {
  console.log(`${bedingung ? "OK   " : "FEHLT"} ${text}`);
  if (!bedingung) fehler++;
}
const lies = (p) => JSON.parse(readFileSync(p, "utf-8"));

function lauf() {
  const e = spawnSync(process.execPath, [join(WURZEL, "tools/weltkarte-veroeffentlichen.mjs")], {
    env: { ...process.env, WOV_KARTEN_ARBEIT: ARBEIT, WOV_KARTEN_AUSGABE: AUSGABE },
    encoding: "utf-8",
    timeout: 600_000,
  });
  if (e.stdout) process.stdout.write(e.stdout);
  if (e.stderr) process.stderr.write(e.stderr);
  return e.status;
}

function aufraeumen() {
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

  // 4. Ohne live.json: übersprungen, kein Fehler
  console.log("\n— Lauf 4 (ohne live.json) —");
  rmSync(join(welten, "live.json"));
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
pruefe(!existsSync(TEMP), `${TEMP} aufgeräumt`);
console.log(fehler === 0 ? "\nProbe grün" : `\nProbe ROT (${fehler} Fehler)`);
process.exit(fehler === 0 ? 0 : 1);
