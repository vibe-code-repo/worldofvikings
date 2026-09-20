/**
 * K2.1 — Bewuchs-Vorschau räumt auf, hat drei Stufen; der Client hält 1024 Zonen.
 *
 * Ohne Browser: die echte Weltdatei (`dev.json`), die echte Streufunktion,
 * eine Attrappe für den EntityManager, die jede Instanz mitzählt. Geprüft wird,
 *
 *  1. dass nach einem Flug quer über die Insel genau die Zonen des Rings
 *     stehen (Zonen, Pflanzen, Zähler vorher/nachher) und jede abgebaute Zone
 *     ihre Instanzen freigibt,
 *  2. dass je Bild höchstens eine Zone abgebaut wird (auch beim Stufenwechsel),
 *  3. dass die Frist das Flackern an der Zonengrenze verhindert (Gegenprobe:
 *     ohne Frist wird ununterbrochen neu gebaut),
 *  4. dass die Stufe „voll" dieselben Pflanzen zeigt wie die Streufunktion
 *     selbst (also wie vor K2.1), „klein" 3 × 3 und „aus" nichts,
 *  5. den Schalter (Taste L, localStorage, Messhaken nur mit Abfrageparameter),
 *  6. den Zwischenspeicher: Client 1024, Server-Vorgabe 512, Server-Aufruf
 *     unverändert.
 *
 * Lauf:  npx tsx test/bewuchs-vorschau.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { HeightmapProvider, RegionGeo, streueZone, type StreuFund } from "@wov/shared";
import * as weltModul from "../src/world/World";
import * as vorschauModul from "../src/editor/BewuchsVorschau";

// Optional access: a stand without these exports fails by assertion, not by aborting the run.
const { createWorld } = weltModul;
const { BewuchsVorschau } = vorschauModul;
const CLIENT_ZONE_CACHE = (weltModul as { CLIENT_ZONE_CACHE?: number }).CLIENT_ZONE_CACHE;
const NACHLAUF_MS = (vorschauModul as { NACHLAUF_MS?: number }).NACHLAUF_MS ?? 0;
type BewuchsStufeModul = typeof import("../src/editor/testflug/BewuchsStufe");
const stufeModul = (await import("../src/editor/testflug/BewuchsStufe").catch(
  () => null,
)) as BewuchsStufeModul | null;

async function abschnitt(f: () => Promise<void> | void): Promise<void> {
  try {
    await f();
  } catch (e) {
    check("Abschnitt läuft ohne Ausnahme", false, String((e as Error)?.message ?? e));
  }
}

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let fehler = 0;
function check(name: string, ok: boolean, zusatz = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${zusatz ? ` (${zusatz})` : ""}`);
  if (!ok) fehler++;
}

// ── Welt und Attrappe ────────────────────────────────────────────────
const layout = JSON.parse(readFileSync(resolve(WURZEL, "server/data/welten/dev.json"), "utf-8"));
const welt = createWorld("x", {}, layout);
if (!(welt.regionGeo instanceof RegionGeo)) throw new Error("dev.json ergibt keine Region-Welt");
const weltLike = {
  seed: welt.seed,
  geo: welt.geo,
  heightmaps: welt.heightmaps,
  regionGeo: welt.regionGeo,
};

/** EntityManager-Attrappe: zählt jede Instanz, die entsteht und verschwindet. */
class Attrappe {
  readonly live = new Map<string, { prefabHash: number; position: unknown; scaleScalar: number }>();
  angelegt = 0;
  freigegeben = 0;
  doppelt = 0;
  fremd = 0;
  applyUpdate(u: {
    key: string;
    prefabHash: number;
    position: unknown;
    scaleScalar: number;
  }): void {
    if (this.live.has(u.key)) this.doppelt++;
    this.live.set(u.key, u);
    this.angelegt++;
  }
  removeZDO(key: string): void {
    if (!this.live.delete(key)) this.fremd++;
    this.freigegeben++;
  }
  flush(): void {}
}

type Innen = {
  fertig: Map<string, string[]>;
  zoneAbbauen(k: string): void;
  zoneStreuen(x: number, y: number): void;
};

/** Vorschau plus Zähler: gebaute und abgebaute Zonen je Bild. */
function baue(nachlauf?: number, hz = 60) {
  const ent = new Attrappe();
  const v = new BewuchsVorschau(weltLike, ent as never, nachlauf as never);
  const innen = v as unknown as Innen;
  const z = {
    gebaut: 0,
    abgebaut: 0,
    proBildAbgebaut: 0,
    maxAbbauJeBild: 0,
    maxZonen: 0,
    maxPflanzen: 0,
  };
  const streuen = innen.zoneStreuen.bind(v);
  innen.zoneStreuen = (x, y) => {
    const vorher = innen.fertig.size;
    streuen(x, y);
    if (innen.fertig.size > vorher) z.gebaut++;
  };
  if (typeof innen.zoneAbbauen === "function") {
    const abbauen = innen.zoneAbbauen.bind(v);
    innen.zoneAbbauen = (k) => {
      z.abgebaut++;
      z.proBildAbgebaut++;
      abbauen(k);
    };
  }
  /** Die Uhr der Frist: je Bild vergehen 1000 / hz Millisekunden (Bildrate nachgebildet). */
  const uhr = { ms: 100000, hz };
  /** Ein Bild: `schritt` an dieser Stelle. */
  const bild = (x: number, zz: number): void => {
    z.proBildAbgebaut = 0;
    uhr.ms += 1000 / uhr.hz;
    v.schritt(x, zz, uhr.ms);
    z.maxAbbauJeBild = Math.max(z.maxAbbauJeBild, z.proBildAbgebaut);
    z.maxZonen = Math.max(z.maxZonen, innen.fertig.size);
    z.maxPflanzen = Math.max(z.maxPflanzen, ent.live.size);
  };
  return { v, ent, innen, z, bild, uhr };
}

const zone = (w: number): number => Math.floor(w / 64 + 0.5);
/** Schlüssel der Zonen im Quadrat mit Radius r um die Zone der Stelle. */
function ring(x: number, zz: number, r: number): Set<string> {
  const s = new Set<string>();
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) s.add(`${zone(x) + dx},${zone(zz) + dy}`);
  return s;
}
const gleich = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((k) => b.has(k));
/** Zone eines Entity-Schlüssels `bewuchs-<zx>,<zy>-<n>` (die Koordinaten dürfen negativ sein). */
const zoneVonKey = (key: string): string => /^bewuchs-(.+)-\d+$/.exec(key)?.[1] ?? "";

/** Was `streueZone` allein für diese Zonen liefert — die Wahrheit vor K2.1. */
function referenz(schluessel: Set<string>): Map<string, number> {
  const zaehl = new Map<string, number>();
  for (const k of schluessel) {
    const [zx, zy] = k.split(",").map(Number);
    try {
      streueZone(
        { seed: welt.seed, geo: welt.geo, heightmaps: welt.heightmaps, regionGeo: welt.regionGeo },
        welt.heightmaps.getZone(zx, zy),
        [],
        (f: StreuFund) => {
          const id = `${f.prefabHash}|${JSON.stringify(f.position)}|${f.scale}`;
          zaehl.set(id, (zaehl.get(id) ?? 0) + 1);
        },
      );
    } catch {
      /* Rand der Welt: leer, wie in der Vorschau */
    }
  }
  return zaehl;
}
function tatsaechlich(ent: Attrappe): Map<string, number> {
  const zaehl = new Map<string, number>();
  for (const u of ent.live.values()) {
    const id = `${u.prefabHash}|${JSON.stringify(u.position)}|${u.scaleScalar}`;
    zaehl.set(id, (zaehl.get(id) ?? 0) + 1);
  }
  return zaehl;
}
const gleicheZaehlung = (a: Map<string, number>, b: Map<string, number>): boolean =>
  a.size === b.size && [...a].every(([k, n]) => b.get(k) === n);

/** Ruhig stehen, bis die Warteschlange leer und die Frist um ist. */
function beruhigen(t: ReturnType<typeof baue>, x: number, zz: number, bilder = 400): void {
  for (let i = 0; i < bilder; i++) t.bild(x, zz);
}

const SEHNE_X = 8200; // Insel 18, West -> Ost, 2940 m Land am Stück (Messbericht M2.0)
const SEHNE_Z = -18500;

console.log("1. 200 Kameraschritte quer über Insel 18");
await abschnitt(async () => {
  const t = baue();
  for (let i = 0; i < 200; i++) t.bild(SEHNE_X + i * 14.7, SEHNE_Z);
  const endeX = SEHNE_X + 199 * 14.7;
  beruhigen(t, endeX, SEHNE_Z);
  const soll = ring(endeX, SEHNE_Z, 2);
  const stehend = new Set(t.innen.fertig.keys());
  check(
    `nach dem Flug stehen genau die 25 Zonen des Rings (gezählt: ${stehend.size})`,
    stehend.size === 25 && gleich(stehend, soll),
  );
  const inZonen = [...t.innen.fertig.values()].reduce((n, k) => n + k.length, 0);
  check(
    `Pflanzen der Vorschau = Instanzen in der Szene (${t.v.anzahl()} = ${t.ent.live.size})`,
    t.v.anzahl() === t.ent.live.size && inZonen === t.ent.live.size,
  );
  check(
    "jede Instanz gehört zu einer Ringzone",
    [...t.ent.live.keys()].every((k) => soll.has(zoneVonKey(k))),
  );
  check(
    `Zähler: angelegt ${t.ent.angelegt} − freigegeben ${t.ent.freigegeben} = stehend ${t.ent.live.size}`,
    t.ent.angelegt - t.ent.freigegeben === t.ent.live.size,
  );
  check(
    "keine Instanz doppelt angelegt, keine fremde freigegeben",
    t.ent.doppelt === 0 && t.ent.fremd === 0,
  );
  check(
    `Zonen gebaut ${t.z.gebaut}, abgebaut ${t.z.abgebaut}: gebaut − abgebaut = 25`,
    t.z.gebaut - t.z.abgebaut === 25,
  );
  check(
    `höchstens eine Zone Abbau je Bild (Höchstwert ${t.z.maxAbbauJeBild})`,
    t.z.maxAbbauJeBild <= 1 && t.z.abgebaut > 0,
  );
});

console.log("2. 60 s bei 45 m/s (3600 Bilder, 2700 m)");
await abschnitt(async () => {
  const t = baue();
  const proBild = 45 / 60;
  let zonenMitte = 0;
  let pflanzenMitte = 0;
  for (let i = 0; i < 3600; i++) {
    t.bild(SEHNE_X + i * proBild, SEHNE_Z);
    if (i === 1800) {
      zonenMitte = t.innen.fertig.size;
      pflanzenMitte = t.ent.live.size;
    }
  }
  const ende = t.innen.fertig.size;
  check(
    `Zonen: Mitte ${zonenMitte}, Ende ${ende}, Höchstwert ${t.z.maxZonen} (Ring 25 + höchstens eine Reihe Nachlauf)`,
    t.z.maxZonen <= 35 && ende <= 35,
  );
  check(
    `Pflanzen bleiben in der Größenordnung: Mitte ${pflanzenMitte}, Ende ${t.ent.live.size}, Höchstwert ${t.z.maxPflanzen}`,
    t.ent.live.size < 2 * Math.max(pflanzenMitte, 1) &&
      t.z.maxPflanzen < 3 * Math.max(pflanzenMitte, 1),
  );
  check(
    `Zonen gebaut ${t.z.gebaut} (2700 m ≈ 42 Reihen à 5), abgebaut ${t.z.abgebaut}`,
    t.z.gebaut - t.z.abgebaut === ende,
  );
  check(
    `höchstens eine Zone Abbau je Bild (Höchstwert ${t.z.maxAbbauJeBild})`,
    t.z.maxAbbauJeBild === 1,
  );
  check(
    "Zähler vorher/nachher: angelegt − freigegeben = stehend",
    t.ent.angelegt - t.ent.freigegeben === t.ent.live.size,
  );
});

console.log("3. Hin und her über eine Zonengrenze (alle 10 Bilder, 600 Bilder)");
await abschnitt(async () => {
  const grenzeX = 64 * 140 - 32; // Grenze zwischen Zone 139 und 140 (Zonenmitten liegen bei Vielfachen von 64)
  const lauf = (nachlauf?: number) => {
    const t = baue(nachlauf);
    beruhigen(t, grenzeX - 5, SEHNE_Z);
    const vorher = t.z.gebaut;
    for (let i = 0; i < 600; i++)
      t.bild(grenzeX + (Math.floor(i / 10) % 2 === 0 ? 5 : -5), SEHNE_Z);
    return { gebaut: t.z.gebaut - vorher, zonen: t.innen.fertig.size, max: t.z.maxZonen };
  };
  const mit = lauf();
  const ohne = lauf(0);
  check(
    `mit Frist (${NACHLAUF_MS} ms): höchstens die erste Randreihe wird gebaut (${mit.gebaut} Zonen)`,
    mit.gebaut <= 5,
  );
  check(`ohne Frist: laufend Neubau (${ohne.gebaut} Zonen in 60 Wechseln)`, ohne.gebaut > 100);
  check(`mit Frist bleiben höchstens 30 Zonen stehen (Höchstwert ${mit.max})`, mit.max <= 30);
});

console.log(
  "3b. Pendeln mit 0,75 s je Seite bei 30, 60 und 144 Hz (die Frist zählt Zeit, nicht Bilder)",
);
await abschnitt(async () => {
  const grenzeX = 64 * 140 - 32;
  const lauf = (hz: number, nachlauf?: number) => {
    const t = baue(nachlauf, hz);
    beruhigen(t, grenzeX - 5, SEHNE_Z, hz * 6);
    const vorher = t.z.gebaut;
    const halbe = Math.round(0.75 * hz);
    for (let i = 0; i < hz * 20; i++)
      t.bild(grenzeX + (Math.floor(i / halbe) % 2 === 0 ? 5 : -5), SEHNE_Z);
    return { gebaut: t.z.gebaut - vorher, abgebaut: t.z.abgebaut, max: t.z.maxZonen };
  };
  const mit: Record<number, { gebaut: number; abgebaut: number; max: number }> = {};
  for (const hz of [30, 60, 144]) mit[hz] = lauf(hz);
  check(
    `mit der Standardfrist (${NACHLAUF_MS} ms) bleibt es bei 30 / 60 / 144 Hz bei den Zonenbauten der ersten Randreihe (${mit[30].gebaut} / ${mit[60].gebaut} / ${mit[144].gebaut}; abgebaut ${mit[30].abgebaut} / ${mit[60].abgebaut} / ${mit[144].abgebaut})`,
    [30, 60, 144].every((hz) => mit[hz].gebaut <= 5 && mit[hz].abgebaut === 0),
  );
  const ohne = [30, 60, 144].map((hz) => lauf(hz, 0).gebaut);
  check(
    `ohne Frist wird bei jeder Bildrate laufend neu gebaut (${ohne.join(" / ")} Zonen in 20 s)`,
    ohne.every((n) => n > 60),
  );
  // Beweis, dass die Uhr zählt: eine Frist von 500 ms (kürzer als die Halbperiode) flackert bei jeder
  // Bildrate gleich oft je Sekunde; eine Frist in Bildern täte es bei 144 Hz nicht.
  const kurz = [60, 144].map((hz) => lauf(hz, 500).gebaut);
  check(
    `eine Frist von 500 ms baut bei 60 und 144 Hz gleich viele Zonen (${kurz[0]} gegen ${kurz[1]}, Abweichung höchstens 15 %)`,
    kurz[0] > 60 && Math.abs(kurz[0] - kurz[1]) <= 0.15 * kurz[0],
  );
});

console.log("4. Stufen voll / klein / aus");
await abschnitt(async () => {
  const t = baue();
  const x = SEHNE_X + 1000;
  beruhigen(t, x, SEHNE_Z);
  const voll = new Set(t.innen.fertig.keys());
  const pflanzenVoll = t.ent.live.size;
  check(
    `voll = 5 × 5 Zonen (${voll.size}), ${pflanzenVoll} Pflanzen`,
    voll.size === 25 && t.v.stufe === "voll",
  );
  check(
    "voll zeigt genau, was die Streufunktion allein liefert (Zählnachweis wie vor K2.1)",
    gleicheZaehlung(tatsaechlich(t.ent), referenz(ring(x, SEHNE_Z, 2))),
  );

  t.z.maxAbbauJeBild = 0;
  t.v.setzeStufe("klein");
  let bilderBisKlein = 0;
  while (t.innen.fertig.size > 9 && bilderBisKlein < 100) {
    t.bild(x, SEHNE_Z);
    bilderBisKlein++;
  }
  check(
    `klein = 3 × 3 Zonen, ohne Frist nach ${bilderBisKlein} Bildern (16 Zonen weg)`,
    t.innen.fertig.size === 9 &&
      bilderBisKlein <= 16 &&
      gleich(new Set(t.innen.fertig.keys()), ring(x, SEHNE_Z, 1)),
  );
  const pflanzenKlein = t.ent.live.size;
  check(
    `klein zeigt ${pflanzenKlein} statt ${pflanzenVoll} Pflanzen, alle in der Ringzone`,
    pflanzenKlein < pflanzenVoll &&
      [...t.ent.live.keys()].every((k) => ring(x, SEHNE_Z, 1).has(zoneVonKey(k))),
  );
  check(
    `Abbau beim Wechsel: höchstens eine Zone je Bild (Höchstwert ${t.z.maxAbbauJeBild})`,
    t.z.maxAbbauJeBild === 1,
  );

  t.v.setzeStufe("aus");
  const angelegtVorAus = t.ent.angelegt;
  beruhigen(t, x, SEHNE_Z, 50);
  check(
    `aus = keine Zone, keine Instanz (${t.innen.fertig.size} Zonen, ${t.ent.live.size} Instanzen)`,
    t.innen.fertig.size === 0 && t.ent.live.size === 0 && t.v.anzahl() === 0,
  );
  check(
    "aus baut auch beim Weiterfliegen nichts",
    (() => {
      for (let i = 0; i < 300; i++) t.bild(x + i * 20, SEHNE_Z);
      return t.ent.angelegt === angelegtVorAus && t.innen.fertig.size === 0;
    })(),
  );

  t.v.setzeStufe("voll");
  beruhigen(t, x, SEHNE_Z);
  check(
    `zurück auf voll: wieder dieselben ${t.innen.fertig.size} Zonen und ${t.ent.live.size} Pflanzen`,
    t.innen.fertig.size === 25 &&
      t.ent.live.size === pflanzenVoll &&
      gleicheZaehlung(tatsaechlich(t.ent), referenz(ring(x, SEHNE_Z, 2))),
  );
  check(
    "Zähler vorher/nachher stimmen über alle Wechsel",
    t.ent.angelegt - t.ent.freigegeben === t.ent.live.size &&
      t.ent.doppelt === 0 &&
      t.ent.fremd === 0,
  );
});

console.log("5. Wegfliegen und zurückkehren");
await abschnitt(async () => {
  const t = baue();
  beruhigen(t, SEHNE_X, SEHNE_Z);
  const erst = tatsaechlich(t.ent);
  for (let i = 0; i < 1500; i++) t.bild(SEHNE_X + i * 1.2, SEHNE_Z);
  for (let i = 0; i < 1500; i++) t.bild(SEHNE_X + 1800 - i * 1.2, SEHNE_Z);
  beruhigen(t, SEHNE_X, SEHNE_Z);
  check(
    `Rückkehr: wieder genau der Ring (${t.innen.fertig.size} Zonen), gleiche Pflanzen wie beim ersten Besuch`,
    t.innen.fertig.size === 25 && gleicheZaehlung(tatsaechlich(t.ent), erst),
  );
});

console.log("6. Schalter");
await abschnitt(async () => {
  if (!stufeModul) throw new Error("testflug/BewuchsStufe.ts fehlt");
  const {
    BEWUCHS_MESSUNG_PARAM,
    BEWUCHS_STUFE_KEY,
    BEWUCHS_STUFE_TASTE,
    bewuchsStufeText,
    istBewuchsStufe,
    leseBewuchsStufe,
    naechsteBewuchsStufe,
    schreibeBewuchsStufe,
    verdrahteBewuchsStufe,
  } = stufeModul;
  check(
    "Voreinstellung voll (kein Speicher, leerer Speicher)",
    leseBewuchsStufe(null) === "voll" &&
      leseBewuchsStufe({ getItem: () => null, setItem: () => {} }) === "voll",
  );
  check(
    "gespeicherte Stufen werden gelesen",
    (["voll", "klein", "aus"] as const).every(
      (s) => leseBewuchsStufe({ getItem: () => s, setItem: () => {} }) === s,
    ),
  );
  check(
    "Unbrauchbares und ein werfender Speicher ergeben voll",
    leseBewuchsStufe({ getItem: () => "riesig", setItem: () => {} }) === "voll" &&
      leseBewuchsStufe({
        getItem: () => {
          throw new Error("gesperrt");
        },
        setItem: () => {},
      }) === "voll",
  );
  check(
    "Schreiben meldet Erfolg und Fehlschlag",
    schreibeBewuchsStufe({ getItem: () => null, setItem: () => {} }, "aus") === true &&
      schreibeBewuchsStufe(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("voll");
          },
        },
        "aus",
      ) === false &&
      schreibeBewuchsStufe(null, "aus") === false,
  );
  check(
    "Reihenfolge voll → klein → aus → voll",
    naechsteBewuchsStufe("voll") === "klein" &&
      naechsteBewuchsStufe("klein") === "aus" &&
      naechsteBewuchsStufe("aus") === "voll",
  );
  check(
    "istBewuchsStufe lehnt Fremdes ab",
    istBewuchsStufe("klein") &&
      !istBewuchsStufe("KLEIN") &&
      !istBewuchsStufe(null) &&
      !istBewuchsStufe(3),
  );
  check(
    "Anzeige nennt Stufe und Fläche",
    bewuchsStufeText("voll").includes("5 × 5") &&
      bewuchsStufeText("klein").includes("3 × 3") &&
      bewuchsStufeText("aus").includes("aus"),
  );

  // Minimale Browserattrappe: nur was `verdrahteBewuchsStufe` anfasst.
  const griff = (suche: string) => {
    const speicher = new Map<string, string>();
    const handler: Array<(e: Record<string, unknown>) => void> = [];
    const chips: Array<{ style: { cssText: string }; textContent: string }> = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = {
      localStorage: {
        getItem: (k: string) => speicher.get(k) ?? null,
        setItem: (k: string, v: string) => void speicher.set(k, v),
      },
      location: { search: suche },
      addEventListener: (_: string, h: (e: Record<string, unknown>) => void) => handler.push(h),
    };
    g.document = {
      createElement: () => {
        const el = { style: { cssText: "" }, textContent: "" };
        chips.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };
    return { speicher, handler, chips, fenster: g.window as Record<string, unknown> };
  };
  const taste = (
    h: Array<(e: Record<string, unknown>) => void>,
    code: string,
    extra: Record<string, unknown> = {},
  ): void =>
    h.forEach((f) =>
      f({
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...extra,
      }),
    );

  const ohneParam = griff("?offline=1");
  const meldungen: string[] = [];
  const t = baue();
  ohneParam.speicher.set(BEWUCHS_STUFE_KEY, "klein");
  verdrahteBewuchsStufe(t.v, {
    hud: { meldung: (m: string) => void meldungen.push(m) },
    tipptImFeld: (e) => e.code === "Tippt",
  });
  check(
    'gespeicherte Stufe „klein" gilt nach dem Start',
    t.v.stufe === "klein" && ohneParam.chips[0].textContent.includes("klein"),
  );
  check(
    "ohne Abfrageparameter wird nichts als __bewuchs bereitgestellt",
    ohneParam.fenster.__bewuchs === undefined,
  );
  taste(ohneParam.handler, BEWUCHS_STUFE_TASTE);
  check(
    "L schaltet klein → aus, speichert und zeigt",
    t.v.stufe === "aus" &&
      ohneParam.speicher.get(BEWUCHS_STUFE_KEY) === "aus" &&
      ohneParam.chips[0].textContent.includes("aus") &&
      meldungen.length === 1,
  );
  taste(ohneParam.handler, BEWUCHS_STUFE_TASTE, { repeat: true });
  taste(ohneParam.handler, BEWUCHS_STUFE_TASTE, { ctrlKey: true });
  taste(ohneParam.handler, BEWUCHS_STUFE_TASTE, { shiftKey: true });
  taste(ohneParam.handler, BEWUCHS_STUFE_TASTE, { altKey: true });
  taste(ohneParam.handler, BEWUCHS_STUFE_TASTE, { metaKey: true });
  taste(ohneParam.handler, "Tippt");
  taste(ohneParam.handler, "KeyV");
  check(
    "Wiederholung, Strg+L, Umschalt+L (Turbotaste), Alt+L, Meta+L, Eingabefeld und andere Tasten ändern nichts",
    t.v.stufe === "aus" && meldungen.length === 1,
  );
  taste(ohneParam.handler, BEWUCHS_STUFE_TASTE);
  check(
    "L schaltet aus → voll",
    t.v.stufe === "voll" && ohneParam.speicher.get(BEWUCHS_STUFE_KEY) === "voll",
  );

  const mitParam = griff(`?offline=1&${BEWUCHS_MESSUNG_PARAM}=1`);
  const t2 = baue();
  verdrahteBewuchsStufe(t2.v, { hud: { meldung: () => {} }, tipptImFeld: () => false });
  check(
    `mit ?${BEWUCHS_MESSUNG_PARAM}=1 liegt die Vorschau als window.__bewuchs bereit`,
    mitParam.fenster.__bewuchs === t2.v,
  );

  // Der Haken öffnet nur bei genau `=1`, nicht schon bei der Anwesenheit des Parameters.
  const zu: string[] = [];
  for (const suche of [
    `?${BEWUCHS_MESSUNG_PARAM}=0`,
    `?${BEWUCHS_MESSUNG_PARAM}`,
    `?${BEWUCHS_MESSUNG_PARAM}=`,
    `?${BEWUCHS_MESSUNG_PARAM}=nein`,
    `?${BEWUCHS_MESSUNG_PARAM}=11`,
    `?${BEWUCHS_MESSUNG_PARAM.toUpperCase()}=1`,
    "?andere=1",
    "",
  ]) {
    const g = griff(suche);
    verdrahteBewuchsStufe(baue().v, { hud: { meldung: () => {} }, tipptImFeld: () => false });
    if (g.fenster.__bewuchs !== undefined) zu.push(suche);
  }
  check(
    `window.__bewuchs bleibt bei =0, ohne Wert, =nein, =11, Großschreibung und fremdem Parameter zu (offen bei: ${zu.join(" ") || "keinem"})`,
    zu.length === 0,
  );
  const gemischt = griff(`?offline=1&${BEWUCHS_MESSUNG_PARAM}=1&t=0.5`);
  const t4 = baue();
  verdrahteBewuchsStufe(t4.v, { hud: { meldung: () => {} }, tipptImFeld: () => false });
  check("=1 zwischen anderen Parametern öffnet ihn", gemischt.fenster.__bewuchs === t4.v);

  const gesperrt = griff("");
  gesperrt.fenster.localStorage = {
    getItem: () => {
      throw new Error("gesperrt");
    },
    setItem: () => {
      throw new Error("gesperrt");
    },
  };
  const meld3: string[] = [];
  const t3 = baue();
  verdrahteBewuchsStufe(t3.v, {
    hud: { meldung: (m: string) => void meld3.push(m) },
    tipptImFeld: () => false,
  });
  taste(gesperrt.handler, BEWUCHS_STUFE_TASTE);
  check(
    "gesperrter Browserspeicher: Start voll, L wirkt trotzdem und sagt, dass es nicht gespeichert ist",
    t3.v.stufe === "klein" && meld3[0].includes("nicht gespeichert"),
  );
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

console.log("7. Höhenfeld-Zwischenspeicher");
await abschnitt(async () => {
  check(
    `Client: ${welt.heightmaps.maxCachedZones} Zonen (Konstante ${CLIENT_ZONE_CACHE})`,
    welt.heightmaps.maxCachedZones === 1024 && CLIENT_ZONE_CACHE === 1024,
  );
  check(
    "Vorgabe des Anbieters bleibt 512 (Server)",
    new HeightmapProvider(welt.geo).maxCachedZones === 512,
  );
  const laden = (rel: string) =>
    ts.createSourceFile(
      rel,
      readFileSync(resolve(WURZEL, rel), "utf-8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
  const aufrufe = (wurzel: string, name: string, pruefe: (n: ts.NewExpression) => void): void => {
    const gehe = (d: string): void => {
      for (const e of readdirSync(d)) {
        const p = resolve(d, e);
        if (statSync(p).isDirectory()) {
          if (e !== "node_modules") gehe(p);
        } else if (p.endsWith(".ts")) {
          const q = ts.createSourceFile(
            p,
            readFileSync(p, "utf-8"),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
          );
          const besuche = (n: ts.Node): void => {
            if (
              ts.isNewExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === name
            )
              pruefe(n);
            ts.forEachChild(n, besuche);
          };
          besuche(q);
        }
      }
    };
    gehe(resolve(WURZEL, wurzel));
  };
  const serverArgs: number[] = [];
  aufrufe("server/src", "HeightmapProvider", (n) => serverArgs.push(n.arguments?.length ?? 0));
  check(
    `Server baut den Anbieter ohne Größenangabe (Aufrufe: ${serverArgs.length}, Argumente: ${serverArgs.join(",")})`,
    serverArgs.length >= 1 && serverArgs.every((a) => a <= 2),
  );
  const clientArgs: number[] = [];
  aufrufe("client/src", "HeightmapProvider", (n) => clientArgs.push(n.arguments?.length ?? 0));
  check(
    `Client hat genau eine Stelle, die den Anbieter baut, mit Größenangabe (Argumente: ${clientArgs.join(",")})`,
    clientArgs.length === 1 && clientArgs[0] === 3,
  );
  laden("client/src/world/World.ts");
});

console.log("8. Einbindung im Testflug");
await abschnitt(async () => {
  const q = ts.createSourceFile(
    "Testflug.ts",
    readFileSync(resolve(WURZEL, "client/src/editor/testflug/Testflug.ts"), "utf-8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let importiert = false;
  let aufrufe = 0;
  const besuche = (n: ts.Node): void => {
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text === "./BewuchsStufe"
    )
      importiert = true;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "verdrahteBewuchsStufe"
    )
      aufrufe++;
    ts.forEachChild(n, besuche);
  };
  besuche(q);
  check("Testflug.ts bindet den Schalter ein (Import + ein Aufruf)", importiert && aufrufe === 1);
  // Die Taste L darf nirgends sonst im Client vergeben sein.
  let treffer = 0;
  const gehe = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = resolve(d, e);
      if (statSync(p).isDirectory()) gehe(p);
      else if (p.endsWith(".ts")) {
        const qq = ts.createSourceFile(
          p,
          readFileSync(p, "utf-8"),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );
        const b = (n: ts.Node): void => {
          if (ts.isStringLiteral(n) && n.text === "KeyL") treffer++;
          ts.forEachChild(n, b);
        };
        b(qq);
      }
    }
  };
  gehe(resolve(WURZEL, "client/src"));
  check(
    `„KeyL" kommt im ganzen Client genau einmal vor (${treffer}: die Konstante des Schalters)`,
    treffer === 1 && stufeModul?.BEWUCHS_STUFE_TASTE === "KeyL",
  );
});

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log("\nBewuchs-Vorschau: alle Prüfungen bestanden");
