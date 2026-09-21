/**
 * G12 / Block 0.12 — die Tick-Aufteilung im ECHTEN Server.
 *
 * g12-metriken.ts prueft die Zaehler und den Schreiber fuer sich. Dieser Test
 * prueft die Verdrahtung: Stempelt WovServer.update() die beiden Phasen
 * wirklich, zaehlt ZoneManager.update() die Budget-Abbrueche wirklich, und
 * kommt beides als Zeile im Tageslog an? Ein Regler, der nichts verstellt,
 * faellt sonst nicht auf — die Zahlen stuenden auf 0 und niemand wuerde
 * es merken.
 *
 * Ein echter WovServer, ein echter WebSocket-Client (Handshake wie
 * g3-mehrspieler-e2e.ts), der in grossen Spruengen wandert und damit
 * Zonenaufbau erzwingt.
 *
 *  A) Normalbetrieb: Welten + Sync + Rest ergeben je Zeile die Gesamtdauer
 *     (Toleranz 0,015 ms: drei Rundungen auf 0,01), jede Phase ist im Lauf
 *     einmal messbar, Budget-Abbrueche kommen an, die Schnappschussdatei
 *     ist die letzte Zeile des Logs.
 *  B) Das Tageslog laesst sich nicht schreiben (an seinem Namen steht ein
 *     Ordner): der Server laeuft weiter (Ticks, Schnappschuss), und die
 *     Warnung kommt genau einmal.
 *
 * Wartet nie eine feste Zeit, sondern auf Zeugen (Zeilen im Log).
 *
 * Ephemerer Port: `port: 0`, gelesen mit `portVon(server)` (scripts/testport.mjs).
 *
 * Lauf: npx tsx test/g12-tick-aufteilung.ts   (aus server/)
 */
import WebSocket from "ws";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { antwortBerechnen } from "../src/net/Identitaet.js";
import { createWovServer } from "../src/WovServer.js";
import { portVon } from "../../scripts/testport.mjs";
import { Reader } from "../src/io/Reader.js";
import { Writer } from "../src/io/Writer.js";
import type { MetrikSchnappschuss } from "@wov/shared/src/metrik.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, "tmp-g12-tick-aufteilung");
let PORT = 0; // the OS picks it; read back after start() (scripts/testport.mjs)
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function warteAuf(bedingung: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (!bedingung()) {
    if (Date.now() - start >= timeoutMs) return false;
    await warte(50);
  }
  return true;
}

function verbinde(name: string): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = "nodebuffer";
    let authSent = false;
    const to = setTimeout(() => rej(new Error("Timeout beim Handshake")), 8000);
    ws.on("message", (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === 1) {
        ws.send(Buffer.concat([Buffer.from([1]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === 68) {
        if (authSent) return;
        authSent = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(reader.readString(), ""));
        w.writeString(name);
        w.writeString("");
        ws.send(Buffer.concat([Buffer.from([2]), w.toBuffer()]));
      } else if (type === 3) {
        clearTimeout(to);
        res(ws);
      }
    });
    ws.on("error", rej);
  });
}

const teleport = (ws: WebSocket, x: number, z: number): void => {
  const w = new Writer();
  w.writeString(`teleport ${Math.round(x)} ${Math.round(z)}`);
  ws.send(Buffer.concat([Buffer.from([53]), w.toBuffer()]));
};

const zeilenVon = (datei: string): MetrikSchnappschuss[] =>
  existsSync(datei)
    ? readFileSync(datei, "utf-8")
        .split("\n")
        .filter((z) => z.length > 0)
        .map((z) => JSON.parse(z) as MetrikSchnappschuss)
    : [];

/**
 * Busy-wait, so the delay shows up as CPU time of exactly the phase it sits in.
 * Returns how long it REALLY took: on a loaded machine the spin is preempted
 * and runs longer than `ms`, and that real duration is what the phase stamp
 * has to give back.
 */
function warteBusy(ms: number): number {
  const start = performance.now();
  const bis = start + ms;
  while (performance.now() < bis) {
    /* spin */
  }
  return performance.now() - start;
}

/** Aufrufzeit (Date.now) jedes update() des Servers — die tatsaechlichen Ticks. */
const updateZeiten: number[] = [];

/** Jeder eingespeiste Busy-wait: Aufrufzeit (Date.now) und tatsaechlich verbrauchte ms. */
const gewartetSync: Array<[number, number]> = [];
const gewartetWelt: Array<[number, number]> = [];
const summeImFenster = (liste: ReadonlyArray<[number, number]>, vonMs: number, bisMs: number): number =>
  liste.reduce((s, [t, dauer]) => (t >= vonMs && t <= bisMs ? s + dauer : s), 0);

/** Injected delays (ms) of scenario A: known sizes the split has to give back. */
const SYNC_VERZOEGERUNG = 3;
const WELT_VERZOEGERUNG = 2;
/** Zeugen des Patches: Er muss wirklich eine Welt erreicht haben und gelaufen sein. */
let weltenGepatcht = 0;
let weltTickAufrufe = 0;

/**
 * Startet Server + wandernden Client, ruft `lauf` auf und raeumt danach auf.
 *
 * `nachStart` laeuft NACH `server.start()`: Die Welten entstehen erst in
 * `init()`, das `start()` aufruft — vorher ist `welten` leer, und ein Patch
 * ueber die Welten laeuft ins Leere. `init()` ist synchron und der Tick-Takt
 * ein Timer, also ist zwischen `start()` und dem Patch noch kein Tick gelaufen.
 */
async function mitServer(
  ordner: string,
  lauf: (wandern: () => void) => Promise<void>,
  nachStart: (server: ReturnType<typeof createWovServer>) => void = () => undefined,
): Promise<void> {
  const welt = resolve(TMP, ordner, "welt");
  const metriken = resolve(TMP, ordner, "metriken");
  mkdirSync(metriken, { recursive: true });
  const server = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldsDir: welt,
    kontenDir: resolve(welt, "konten"),
    worldName: "g12-" + ordner,
    saveIntervalMs: 3600_000,
    metrikenDatei: resolve(metriken, "metriken.json"),
  });
  server.start();
  PORT = portVon(server);
  nachStart(server);
  let ws: WebSocket | undefined;
  let schritt = 0;
  try {
    ws = await verbinde("Wanderer");
    // Grosse Spruenge auf einer wachsenden Spirale: jeder Sprung landet in
    // Zonen, die es noch nicht gibt, der Aufbau ueberschreitet das Tick-Budget.
    const wandern = (): void => {
      const r = 1500 + 100 * schritt;
      teleport(ws!, r * Math.cos((schritt * 1000) / r), r * Math.sin((schritt * 1000) / r));
      schritt++;
    };
    await lauf(wandern);
  } finally {
    ws?.close();
    server.stop();
  }
}

// ── A) Normalbetrieb ────────────────────────────────────────────────
console.log("\n[A] Aufteilung im Tageslog:");
{
  const metriken = resolve(TMP, "a", "metriken");
  await mitServer(
    "a",
    async (wandern) => {
      const log = (): MetrikSchnappschuss[] => {
        const heute = new Date().toISOString().slice(0, 10);
        return zeilenVon(resolve(metriken, `metriken-${heute}.jsonl`)).filter((z) => z.peers === 1);
      };
      const wanderer = setInterval(wandern, 200);
      const genug = await warteAuf(() => {
        const z = log();
        return z.length >= 4 && z.some((l) => l.zonenBudgetAbbrueche > 0);
      }, 30_000);
      clearInterval(wanderer);
      check("Zeugen: mindestens vier Sekundenzeilen mit Client und ein Budget-Abbruch", genug);

      // Ruhe: Ohne neue Spruenge baut sich der Rueckstand der Zonen ab, danach
      // kostet ein Welt-Tick nichts ausser der eingespeisten Verzoegerung. NUR
      // dann laesst sich die Groesse der Welten-Phase gegen die 2 ms halten:
      // waehrend des Wanderns steht dort die echte Zonenerzeugung (rund 18 ms
      // je Tick), neben der ein Stempel, der die Haelfte oder nichts misst,
      // die Schwelle von 2 ms trotzdem uebersteht. Ruhe heisst hier: drei
      // Zeilen in Folge ohne Budget-Abbruch — ueber den Zaehler, nicht ueber
      // die Welten-Zeit, die geprueft werden soll.
      const ruhig = await warteAuf(() => {
        const z = log();
        return z.length >= 3 && z.slice(-3).every((l) => l.zonenBudgetAbbrueche === 0 && l.tickAnzahl >= 10);
      }, 30_000);
      check("Zeugen: der Zonenrueckstand ist abgebaut (drei Zeilen ohne Budget-Abbruch)", ruhig);
      const ruhe = log().slice(-3);
      const ruheMittel = (f: (z: MetrikSchnappschuss) => number): number =>
        ruhe.reduce((s, z) => s + f(z), 0) / Math.max(1, ruhe.length);
      const ruheWelten = ruheMittel((z) => z.tickWeltenMsDurchschnitt);
      const ruheSync = ruheMittel((z) => z.tickSyncMsDurchschnitt);
      // Der Rest ist ein RESTWERT (Gesamt minus zwei Phasen): jede Unterbrechung
      // des Prozesses ausserhalb der Phasen — ein Zeitscheibenwechsel, der
      // Dateischreiber der Metrik, eine Speicherbereinigung — landet dort und
      // laesst sich nicht gegen eine Messung halten. Die Aussage „die
      // Verzoegerungen landen NICHT im Rest“ hat aber eine Unterschrift, die
      // Unterbrechungen nicht haben: Sie steht in JEDER Sekunde (2 ms je Tick,
      // wenn ein Stempel fehlt), eine Unterbrechung nur in einzelnen. Deshalb
      // gilt die ruhigste Zeile des Fensters, nicht das Mittel.
      const ruheRest = Math.min(...ruhe.map((z) => z.tickRestMsDurchschnitt));

      /*
        Die Erwartung ist die GEMESSENE Wartezeit, nicht die Sollzahl. Ein fester
        Wert (2,0 bis 2,4 ms) hing an der Wanduhr: Unter Last wird der
        Busy-wait unterbrochen und dauert laenger als 2 oder 3 ms, die Phase
        misst das richtig, und der Test wurde rot (gemessen 2,49 / 2,61 / 3,49
        ms bei sechs Brennern, 2,01 ms ruhig). Jetzt schreibt der Patch je
        Aufruf auf, wie lange er WIRKLICH gewartet hat; die Phase muss diese
        Summe je Tick wiedergeben — nicht weniger (dann misst der Stempel nur
        einen Teil), nicht mehr (dann steckt eine fremde Phase darin: die
        andere Verzoegerung waere +2 bis +3 ms). Beides haelt bei jeder Last;
        die Toleranz deckt das Fensterende (eine Sekunde beginnt nicht auf
        den Tick genau) und die Zeit, die ein Unterbrechen AUSSERHALB der
        Verzoegerung in der Phase kostet.
      */
      const fensterVon = ruhe[0] ? ruhe[0].zeitMs - 1000 : 0;
      const fensterBis = ruhe[ruhe.length - 1]?.zeitMs ?? 0;
      const ticksImFenster = ruhe.reduce((s, z) => s + z.tickAnzahl, 0);
      const erwartetWelten = summeImFenster(gewartetWelt, fensterVon, fensterBis) / Math.max(1, ticksImFenster);
      const erwartetSync = summeImFenster(gewartetSync, fensterVon, fensterBis) / Math.max(1, ticksImFenster);
      const UNTEN = 0.15; // ms unter der Erwartung: Fensterrand
      const OBEN = 0.5; // ms ueber der Erwartung: Unterbrechung ausserhalb der Wartezeit
      check(
        "Ruhe: die Welten-Phase gibt die gewartete Zeit je Tick wieder (Erwartung -0,15 / +0,5 ms)",
        ruhe.length === 3 &&
          erwartetWelten >= WELT_VERZOEGERUNG &&
          ruheWelten >= erwartetWelten - UNTEN &&
          ruheWelten <= erwartetWelten + OBEN,
        `Phase ${ruheWelten.toFixed(2)} ms, gewartet ${erwartetWelten.toFixed(2)} ms je Tick`,
      );
      check(
        "Ruhe: die Sync-Phase gibt die gewartete Zeit je Tick wieder, an zwei von drei Ticks (Erwartung -0,15 / +0,5 ms)",
        ruhe.length === 3 &&
          erwartetSync >= 1.7 &&
          ruheSync >= erwartetSync - UNTEN &&
          ruheSync <= erwartetSync + OBEN,
        `Phase ${ruheSync.toFixed(2)} ms, gewartet ${erwartetSync.toFixed(2)} ms je Tick`,
      );
      check(
        "Ruhe: der Rest bleibt klein (ruhigste der drei Zeilen unter 0,5 ms)",
        ruhe.length === 3 && ruheRest < 0.5,
        `${ruheRest.toFixed(2)} ms (Zeilen ${ruhe.map((z) => z.tickRestMsDurchschnitt.toFixed(2)).join(" / ")})`,
      );

      const zeilen = log();
      const abweichung = Math.max(
        ...zeilen.map((z) =>
          Math.abs(
            z.tickWeltenMsDurchschnitt +
              z.tickSyncMsDurchschnitt +
              z.tickRestMsDurchschnitt -
              z.tickDauerMsDurchschnitt,
          ),
        ),
      );
      check(
        "Welten + Sync + Rest = Gesamt je Zeile (Toleranz 0,015 ms)",
        abweichung <= 0.0151,
        `groesste Abweichung ${abweichung.toFixed(4)} ms`,
      );
      const weltenGesamt = zeilen.reduce(
        (s, z) => s + z.tickWeltenMsDurchschnitt * z.tickAnzahl,
        0,
      );
      check(
        "Welten-Phase wurde gemessen (Summe > 1 ms)",
        weltenGesamt > 1,
        `${weltenGesamt.toFixed(1)} ms`,
      );
      check(
        "Sync-Phase wurde gemessen (ein Maximum > 0)",
        zeilen.some((z) => z.tickSyncMsMax > 0),
        `max ${Math.max(...zeilen.map((z) => z.tickSyncMsMax))} ms`,
      );

      // The injected delays: 3 ms in every sync (it runs every 50 ms, i.e. on
      // two of three ticks), 2 ms in every world tick while a player is in.
      // Skip the first line: it belongs to the second the client connected in.
      const voll = zeilen.slice(1);
      const mittel = (f: (z: MetrikSchnappschuss) => number): number =>
        voll.reduce((s, z) => s + f(z), 0) / voll.length;
      const syncMittel = mittel((z) => z.tickSyncMsDurchschnitt);
      // Wie in der Ruhe: Was der Busy-wait unter Last MEHR gekostet hat als seine
      // 3 ms (mal zwei von drei Ticks = 2 ms je Tick), gehoert nicht in die Schranke.
      const vollTicks = voll.reduce((s, z) => s + z.tickAnzahl, 0);
      const vollGewartet =
        summeImFenster(gewartetSync, (voll[0]?.zeitMs ?? 0) - 1000, voll[voll.length - 1]?.zeitMs ?? 0) /
        Math.max(1, vollTicks);
      // Die Sync-Phase enthaelt die gewartete Zeit und dazu die echte Arbeit von
      // syncZDOs (waehrend des Wanderns einige Zehntel bis 1,5 ms). Gedeckelt wird
      // die FREMDZEIT (Phase minus gewartet), nicht die Phase: So bleibt die
      // Schranke bei jeder Last dieselbe 1,5 ms und hebt sich nicht mit einer
      // gedehnten Wartezeit. Dass die Aufzeichnung ueberhaupt gelaufen ist, verlangt
      // die Untergrenze der gewarteten Zeit (Sollwert 2 ms je Tick): ein leeres
      // Fenster wuerde sonst die Fremdzeit mit der ganzen Phase gleichsetzen.
      const syncFremd = syncMittel - vollGewartet;
      const weltenMittel = mittel((z) => z.tickWeltenMsDurchschnitt);
      // Wie in der Ruhe: die ruhigste Zeile, aus demselben Grund (s. dort).
      const restMittel = Math.min(...voll.map((z) => z.tickRestMsDurchschnitt));
      check(
        "Sync-Verzoegerung von 3 ms kommt in der Sync-Phase an (Mittel je Tick mindestens 1,5 ms, hoechstens 1,5 ms Fremdzeit ueber der gewarteten)",
        vollGewartet >= 1.7 && syncMittel >= 1.5 && syncFremd <= 1.5,
        `${syncMittel.toFixed(2)} ms, gewartet ${vollGewartet.toFixed(2)} ms je Tick, Fremdzeit ${syncFremd.toFixed(2)} ms`,
      );
      check(
        "Sync-Maximum mindestens die Verzoegerung",
        Math.max(...voll.map((z) => z.tickSyncMsMax)) >= SYNC_VERZOEGERUNG,
      );
      check(
        "Zeugen: der Welten-Patch hat mindestens eine Welt erreicht und ist gelaufen",
        weltenGepatcht >= 1 && weltTickAufrufe > 0,
        `${weltenGepatcht} Welt(en), ${weltTickAufrufe} Aufrufe`,
      );
      check(
        "Welt-Verzoegerung von 2 ms kommt in der Welten-Phase an (Mittel je Tick mindestens 2 ms)",
        weltenMittel >= WELT_VERZOEGERUNG,
        `${weltenMittel.toFixed(2)} ms`,
      );
      check(
        "die Verzoegerungen landen NICHT im Rest (ruhigste Zeile unter 1 ms)",
        restMittel < 1,
        `${restMittel.toFixed(2)} ms`,
      );
      check(
        "keine Phase ist laenger als der laengste Tick (Rundung 0,01)",
        zeilen.every(
          (z) =>
            z.tickWeltenMsMax <= z.tickDauerMsMax + 0.011 &&
            z.tickSyncMsMax <= z.tickDauerMsMax + 0.011,
        ),
      );
      check(
        "Budget-Abbrueche sind angekommen",
        zeilen.reduce((s, z) => s + z.zonenBudgetAbbrueche, 0) > 0,
        `${zeilen.reduce((s, z) => s + z.zonenBudgetAbbrueche, 0)}`,
      );
      /*
        Die Tickzahl je Zeile gegen die TATSAECHLICHEN Ticks, nicht gegen den
        Sollwert 30: Ein Prozess, der unter Last nur 13 bis 21 Ticks je Sekunde
        bekommt, zaehlt sie richtig — 20 bis 40 waere dort rot, obwohl die
        Metrik stimmt. Gemessen wird deshalb, wie oft update() in der Sekunde
        wirklich lief (der Patch schreibt jeden Aufruf auf). Die Zeile, in der die
        Sekunde schliesst, zaehlt den schliessenden Tick erst in der naechsten:
        daher zwei Ticks Toleranz.
      */
      const echteTicks = (z: MetrikSchnappschuss): number =>
        updateZeiten.filter((t) => t > z.zeitMs - 1000 && t <= z.zeitMs).length;
      const abweichungTicks = zeilen.slice(1).map((z) => z.tickAnzahl - echteTicks(z));
      check(
        "jede Zeile zaehlt genau die Ticks, die in der Sekunde wirklich liefen (Toleranz 2), und nie mehr als 40",
        updateZeiten.length > 0 &&
          abweichungTicks.every((d) => Math.abs(d) <= 2) &&
          zeilen.every((z) => z.tickAnzahl <= 40),
        `Zeilen ${zeilen.map((z) => z.tickAnzahl).join(",")}, Abweichung ${abweichungTicks.join(",")}`,
      );

      const snapshot = JSON.parse(
        readFileSync(resolve(metriken, "metriken.json"), "utf-8"),
      ) as MetrikSchnappschuss;
      const alle = zeilenVon(
        resolve(metriken, `metriken-${new Date().toISOString().slice(0, 10)}.jsonl`),
      );
      check(
        "Schnappschussdatei ist eine Zeile des Logs",
        alle.some((z) => JSON.stringify(z) === JSON.stringify(snapshot)),
      );
    },
    (server) => {
      // Known delays inside the two phases. What the split reports has to
      // match them, or it measures something else than it claims.
      const innen = server as unknown as {
        update: () => void;
        syncZDOs: () => void;
        welten: Map<string, { tick: (...args: unknown[]) => unknown }>;
      };
      const updateOriginal = innen.update.bind(server);
      innen.update = (): void => {
        updateZeiten.push(Date.now());
        updateOriginal();
      };
      const syncOriginal = innen.syncZDOs.bind(server);
      innen.syncZDOs = (): void => {
        const t = Date.now();
        gewartetSync.push([t, warteBusy(SYNC_VERZOEGERUNG)]);
        syncOriginal();
      };
      for (const welt of innen.welten.values()) {
        const tickOriginal = welt.tick.bind(welt);
        welt.tick = (...args: unknown[]): unknown => {
          weltTickAufrufe++;
          const t = Date.now();
          gewartetWelt.push([t, warteBusy(WELT_VERZOEGERUNG)]);
          return tickOriginal(...args);
        };
        weltenGepatcht++;
      }
    },
  );
}

// ── B) Tageslog nicht schreibbar ────────────────────────────────────
console.log("\n[B] Tageslog nicht schreibbar:");
{
  const metriken = resolve(TMP, "b", "metriken");
  mkdirSync(metriken, { recursive: true });
  // Der Name des heutigen Logs ist ein Ordner: appendFile scheitert mit EISDIR.
  mkdirSync(resolve(metriken, `metriken-${new Date().toISOString().slice(0, 10)}.jsonl`));
  const warnungen: string[] = [];
  const echteWarnung = console.warn;
  console.warn = (...args: unknown[]): void => {
    const text = args.map(String).join(" ");
    if (text.includes("Metrics")) warnungen.push(text);
    else echteWarnung(...args);
  };
  try {
    await mitServer("b", async () => {
      const snapshotDatei = resolve(metriken, "metriken.json");
      const stand = (): MetrikSchnappschuss | undefined =>
        existsSync(snapshotDatei)
          ? (JSON.parse(readFileSync(snapshotDatei, "utf-8")) as MetrikSchnappschuss)
          : undefined;
      // Zeuge: der Schnappschuss wird ueber mehrere Sekunden weitergeschrieben,
      // obwohl das Log jedes Mal scheitert.
      await warteAuf(() => stand() !== undefined, 10_000);
      const erster = stand()?.zeitMs ?? 0;
      const weiter = await warteAuf(() => (stand()?.zeitMs ?? 0) >= erster + 3000, 15_000);
      check("Server laeuft weiter: Schnappschuss wird ueber 3 s fortgeschrieben", weiter);
      check(
        "Server tickt weiter (Sollwert 30 je Sekunde)",
        (stand()?.tickAnzahl ?? 0) >= 20,
        `${stand()?.tickAnzahl}`,
      );
    });
  } finally {
    console.warn = echteWarnung;
  }
  check(
    "Warnung kam genau einmal in 3+ s (Drossel 1/min)",
    warnungen.length === 1,
    `${warnungen.length}`,
  );
  check(
    "Warnung nennt das Ziel und den Pfad",
    warnungen[0]?.includes("jsonl") === true && warnungen[0]?.includes(".jsonl") === true,
    warnungen[0] ?? "",
  );
}

rmSync(TMP, { recursive: true, force: true });
console.log(
  failures === 0
    ? "\n=== G12 Tick-Aufteilung: ALL PASSED ==="
    : `\n=== G12 Tick-Aufteilung: ${failures} FAILED ===`,
);
process.exit(failures === 0 ? 0 : 1);
