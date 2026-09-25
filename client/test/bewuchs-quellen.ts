/**
 * K5.5a N2 F2 — the test flight loads the sources the server has: manifest and
 * upload registry; a missing one is announced visibly.
 * Der Testflug lädt Manifest und Upload-Registry nach; Fehlendes wird gemeldet.
 *
 * Lauf:  npx tsx test/bewuchs-quellen.ts   (aus client/)
 */
import { abweichungsText, ladeBewuchsQuellen } from "../src/editor/testflug/BewuchsQuellen";
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
  check("ein Eintrag vorhanden (Grabhügel): keine Meldung", abweichungsText(b2) === null, String(abweichungsText(b2)));
  const b3 = await ladeBewuchsQuellen(["KiPine3"], io((n) => n !== "KiPine3"));
  check("Prefab braucht das Manifest nicht (Store/Upload-Hülle): keine Meldung", abweichungsText(b3) === null);
  const b4 = await ladeBewuchsQuellen(["KiPine3"], io());
  check("ohne brauchtManifest: nichts geprüft, keine Meldung", abweichungsText(b4) === null);
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
