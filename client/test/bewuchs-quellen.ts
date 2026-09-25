/**
 * K5.5a N2 F2 — the test flight loads the sources the server has: manifest and
 * upload registry; a missing one is announced visibly.
 * Der Testflug lädt Manifest und Upload-Registry nach; Fehlendes wird gemeldet.
 *
 * Lauf:  npx tsx test/bewuchs-quellen.ts   (aus client/)
 */
import { abweichungsText, ladeBewuchsQuellen, ohneManifestEintrag, OHNE_MANIFEST_ERLAUBT, QuellenAnzeige } from "../src/editor/testflug/BewuchsQuellen";
import { Fehlersammler, StehendeMeldungen, FEHLER_TTL_MS } from "../src/ui/Fehlermeldungen";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
    failures++;
  }
}

const MANIFEST = JSON.stringify({ modelle: { Grabhuegel: { breite: 42.6, hoehe: 12, tiefe: 30.8, huelle: { min: [-22.7, 0, -15.4], max: [19.8, 12, 15.3] } } } });
const draft = ["Grabhuegel", "U_Steg", "U_Steg", "Kuh"];

console.log("=== K5.5a N2 Quellen ===");
{
  // Probe MIT Registry: das Laden macht das Upload-Modell bekannt.
  const bekannt = new Set(["Grabhuegel", "Kuh"]);
  let geladen = 0;
  const b = await ladeBewuchsQuellen(draft, {
    holeManifest: async () => MANIFEST,
    ladeRegistry: async () => { geladen++; bekannt.add("U_Steg"); return { geladen: 1, meldungen: [] }; },
    bekannt: (n) => bekannt.has(n),
  });
  check("mit Registry: unbekanntes Upload wird gemeldet und nachgeladen", b.unbekannteUploads.join() === "U_Steg" && geladen === 1);
  check("mit Registry: danach bekannt, keine Warnung", b.weiterUnbekannt.length === 0 && abweichungsText(b) === null, String(abweichungsText(b)));
  check("Manifest gelesen", b.manifest?.has("Grabhuegel") === true && b.manifestFehler === null);
}
{
  // Probe OHNE Registry: das Laden scheitert.
  const bekannt = new Set(["Grabhuegel", "Kuh"]);
  const b = await ladeBewuchsQuellen(draft, {
    holeManifest: async () => MANIFEST,
    ladeRegistry: async () => ({ geladen: 0, meldungen: ["/assets/hochgeladen/registry.json: Failed to fetch"] }),
    bekannt: (n) => bekannt.has(n),
  });
  const text = abweichungsText(b);
  check("ohne Registry: Upload bleibt unbekannt", b.weiterUnbekannt.join() === "U_Steg");
  check("ohne Registry: sichtbare Meldung", text !== null && text.includes("abweichen") && text.includes("U_Steg"), String(text));
}
{
  // Kein Upload im Entwurf: die Registry wird gar nicht angefasst.
  let geladen = 0;
  const b = await ladeBewuchsQuellen(["Grabhuegel"], {
    holeManifest: async () => MANIFEST,
    ladeRegistry: async () => { geladen++; return { geladen: 0, meldungen: [] }; },
    bekannt: () => true,
  });
  check("ohne Upload im Entwurf: kein Nachladen, keine Meldung", geladen === 0 && abweichungsText(b) === null);
}
{
  // Manifest scheitert: sichtbare Meldung, kein Absturz.
  const b = await ladeBewuchsQuellen(["Grabhuegel"], {
    holeManifest: async () => { throw new Error("HTTP 404"); },
    ladeRegistry: async () => ({ geladen: 0, meldungen: [] }),
    bekannt: () => true,
  });
  const text = abweichungsText(b);
  check("Manifest fehlt: Meldung, manifest null", b.manifest === null && text !== null && text.includes("Manifest"), String(text));
}
{
  // Manifest kaputt (kein JSON): wie fehlend.
  const b = await ladeBewuchsQuellen([], {
    holeManifest: async () => "<html>",
    ladeRegistry: async () => ({ geladen: 0, meldungen: [] }),
    bekannt: () => true,
  });
  check("Manifest kaputt: Meldung", b.manifest === null && abweichungsText(b) !== null);
}

{
  // N3 B4: Manifest ohne Eintrag für die platzierten Prefabs (gekürzt/falsche Datei) löst die Meldung aus.
  const io = (brauch?: (n: string) => boolean) => ({
    holeManifest: async () => MANIFEST,
    ladeRegistry: async () => ({ geladen: 0, meldungen: [] as string[] }),
    bekannt: () => true,
    ...(brauch ? { brauchtManifest: brauch } : {}),
  });
  const b1 = await ladeBewuchsQuellen(["KiPine3", "Surtr"], io(() => true));
  const t1 = abweichungsText(b1);
  check("Manifest ohne Einträge der platzierten Prefabs: Meldung mit Namen", b1.manifest !== null && b1.manifestFehler === null && t1 !== null && t1.includes("KiPine3") && t1.includes("abweichen"), String(t1));
  const b2 = await ladeBewuchsQuellen(["Grabhuegel", "Surtr"], io(() => true));
  const t2 = abweichungsText(b2);
  check("ein Eintrag vorhanden, einer fehlt (Surtr): Meldung (some, nicht every)", t2 !== null && t2.includes("Surtr") && !t2.includes("Grabhuegel"), String(t2));
  const b3 = await ladeBewuchsQuellen(["KiPine3"], io((n) => n !== "KiPine3"));
  check("Prefab braucht das Manifest nicht (Store/Upload-Hülle): keine Meldung", abweichungsText(b3) === null);
  const b4 = await ladeBewuchsQuellen(["KiPine3"], io());
  check("ohne brauchtManifest: nichts geprüft, keine Meldung", abweichungsText(b4) === null);
}
{
  // N4 F1: nur eigene Modelle ohne Hülle brauchen einen Eintrag; Vanilla und feste Ausnahmen nicht.
  const eigenExtern = (n: string): boolean => ["KiPine3", "Surtr", "Grabhuegel", "NPC_1", "Player", "GrabhuegelGras", "SteingrabGangDurch", "StoneVaultEntry", "RockVaultEntry"].includes(n);
  const io = (holen: () => Promise<string>) => ({
    holeManifest: holen,
    ladeRegistry: async () => ({ geladen: 0, meldungen: [] as string[] }),
    bekannt: () => true,
    brauchtManifest: eigenExtern,
  });
  const VOLL = JSON.stringify({ modelle: { KiPine3: { breite: 1, hoehe: 1, tiefe: 1, huelle: { min: [0, 0, 0], max: [1, 1, 1] } }, Surtr: { breite: 1, hoehe: 1, tiefe: 1, huelle: { min: [0, 0, 0], max: [1, 1, 1] } }, Grabhuegel: { breite: 1, hoehe: 1, tiefe: 1, huelle: { min: [0, 0, 0], max: [1, 1, 1] } } } });
  const GEKUERZT = MANIFEST; // nur Grabhuegel

  // Fall 1: Entwurf nur aus Vanilla-Prefabs, volles Manifest: keine Meldung.
  const f1 = await ladeBewuchsQuellen(["Rock_4", "RockDolmen_1", "_ZoneCtrl"], io(async () => VOLL));
  check("N4 Vanilla-Entwurf, volles Manifest: keine Meldung", abweichungsText(f1) === null, String(abweichungsText(f1)));
  // Fall 2: gekürztes Manifest mit einem passenden Eintrag (Grabhuegel), Startdorf-Art: Meldung.
  const f2 = await ladeBewuchsQuellen(["Grabhuegel", "KiPine3", "Surtr", "Rock_4"], io(async () => GEKUERZT));
  const t2 = abweichungsText(f2);
  check("N4 gekürztes Manifest mit einem passenden Eintrag: Meldung", t2 !== null && t2.includes("KiPine3") && t2.includes("Surtr") && !t2.includes("Rock_4"), String(t2));
  // Fall 4: volles Manifest, Startdorf (inkl. fester Ausnahmen): keine Meldung.
  const f4 = await ladeBewuchsQuellen(["Grabhuegel", "KiPine3", "Surtr", "NPC_1", "Player", "GrabhuegelGras", "SteingrabGangDurch", "StoneVaultEntry", "RockVaultEntry", "Rock_4"], io(async () => VOLL));
  check("N4 volles Manifest, Startdorf mit festen Ausnahmen: keine Meldung", abweichungsText(f4) === null, String(abweichungsText(f4)));
  check("N4 die sechs Ausnahmen stehen in der Liste", OHNE_MANIFEST_ERLAUBT.size === 6);
  check("N4 ohneManifestEintrag: Ausnahme wird nie gemeldet", ohneManifestEintrag(["NPC_1"], new Map(), () => true).length === 0);

  // Fall 3: KiPine3 nach dem Start gesetzt, Manifest ohne KiPine3: Meldung beim nächsten Takt.
  const meldungen: Array<string | null> = [];
  const fs = await ladeBewuchsQuellen(["Grabhuegel"], io(async () => GEKUERZT));
  const anz = new QuellenAnzeige(fs, eigenExtern, (t) => meldungen.push(t));
  anz.neuerBericht(fs);
  check("N4 beim Start nur Grabhuegel: keine Meldung", meldungen.at(-1) === null);
  anz.pruefe(["Grabhuegel", "KiPine3"], "marke-2");
  check("N4 KiPine3 nachträglich gesetzt: Meldung", (meldungen.at(-1) ?? "").includes("KiPine3"), String(meldungen.at(-1)));
  const n = meldungen.length;
  anz.pruefe(["Grabhuegel", "KiPine3"], "marke-2");
  check("N4 gleiche Marke: nicht neu geprüft", meldungen.length === n);
  anz.pruefe(["Grabhuegel"], "marke-3");
  check("N4 KiPine3 wieder entfernt: Meldung weg", meldungen.at(-1) === null);

  // Fall 5: Manifest kommt verspätet: Meldung erst an, dann aus.
  const ms: Array<string | null> = [];
  const spaet = await ladeBewuchsQuellen(["KiPine3"], io(async () => { throw new Error("HTTP 503"); }));
  const anz2 = new QuellenAnzeige(spaet, eigenExtern, (t) => ms.push(t));
  anz2.neuerBericht(spaet);
  check("N4 Manifest fehlt zuerst: Meldung an", (ms.at(-1) ?? "").includes("Manifest fehlt"), String(ms.at(-1)));
  const da = await ladeBewuchsQuellen(["KiPine3"], io(async () => VOLL));
  anz2.neuerBericht(da);
  check("N4 Manifest kommt: Meldung aus", ms.at(-1) === null && ms.length === 2);
}
{
  // N3 B4: die stehende Meldung läuft nicht ab und wird nicht verdrängt.
  const st = new StehendeMeldungen();
  const fs = new Fehlersammler();
  st.setzen("bewuchs-quellen", "Bewuchs-Vorschau kann vom Spiel abweichen: Manifest fehlt");
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) fs.melden(`Fehler ${i}`, "warnung", t0 + i);
  fs.tick(t0 + 10 * FEHLER_TTL_MS);
  st.setzen("anderer-schluessel", "zweite");
  check("stehende Meldung nach TTL und 20 Fehlermeldungen noch da", st.alle()[0]?.includes("kann vom Spiel abweichen") === true && st.alle().length === 2, `${st.alle().length}`);
  st.setzen("bewuchs-quellen", "neuer Text");
  check("derselbe Schlüssel ersetzt statt zu stapeln", st.alle().length === 2 && st.alle()[0] === "neuer Text");
  st.setzen("bewuchs-quellen", null);
  check("null nimmt sie weg", st.alle().length === 1 && st.alle()[0] === "zweite");
}

if (failures > 0) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
