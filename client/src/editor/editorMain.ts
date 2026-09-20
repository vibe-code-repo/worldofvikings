/**
 * 3D-Map-Generator (Phase 5 des Kartengenerierungs-Umbaus).
 *
 * Leitidee (Nutzerwunsch): Basis ist der Ozean; Inseln/Biome werden hier
 * gezeichnet, LIVE als Karte gesehen und dann in die Live-Umgebung
 * portiert. Drei Wege nach draußen:
 *   1. Testflug — öffnet das echte Spiel offline mit dem Entwurf
 *      (?offline=1&layout=editor, Übergabe via localStorage).
 *   2. JSON-Export/-Import — die Datei ist das Weltdokument
 *      (server/data/welten/<instanz>.json).
 *   3. MCP/Deployment — der WorldLayout-MCP-Server (tools/worldlayout-mcp)
 *      schreibt dieselbe Datei direkt auf den Server und startet ihn neu.
 *
 * Die Vorschau ist DERSELBE Karten-Worker wie im Spiel (mapWorker mit
 * RegionGeo): Was hier erscheint, ist exakt die Welt, die der Server baut —
 * kein eigener Vorschau-Renderer, keine Drift.
 *
 * ── Und ein Weg HEREIN (Block A/16, Phase 2) ─────────────────────────
 * Bis dahin gab es keinen: `ladeEntwurf()` las das Layout nur aus dem
 * localStorage, der Speicherknopf schrieb es auf den Server. Wer den
 * Editor öffnete, sah also nie die Welt, die dort tatsächlich liegt,
 * sondern das, was sein Browser zuletzt gemerkt hatte — und konnte
 * damit die andere Instanz überschreiben. Seit `WOV_INSTANZ` zwischen
 * `welten/dev.json` und `welten/live.json` wählt, ist das kein
 * Schönheitsfehler mehr.
 *
 * Jetzt holt der Editor beim Start `GET /api/worldlayout` (Betriebsdienst
 * wov-admin, auf BEIDEN Containern erreichbar). Weichen Serverstand und
 * Browser-Entwurf voneinander ab, entscheidet der Nutzer — mit der
 * Gegenüberstellung vor Augen (weltdokument.ts, AbgleichDialog.ts). Und
 * das Farbband über der Werkzeugleiste sagt jederzeit, WELCHE Welt hier
 * offen ist (Shell.instanzZeigen).
 */
import {
  sanitizeWorldLayout,
  layoutBounds,
  pruefeLayout,
  DEFAULT_BASE_LEVEL,
  GRASLAND_FLORA_NAMEN,
  NADELWALD_FLORA_NAMEN,
  SUMPF_FLORA_NAMEN,
  HOCHNORD_FLORA_NAMEN,
  ASCHE_FLORA_NAMEN,
  dungeon2,
  type BiomeName,
  type ContinentDef,
  type RegionDef,
  type WorldLayout,
} from '@wov/shared';
import { setzeKartenMasse, type MapWorkerMessage } from '../ui/worldmap/mapTypes';
import { EditorShell } from './Shell';
import { DungeonGrundriss } from './DungeonGrundriss';
import { DungeonSeite } from './DungeonKatalog';
import { fetchModuleBuildPermission } from './DungeonNeuerSaal';
// Dungeon Generator 2.0 (AP15.7): der leichte 2D-Teil wird statisch geladen,
// die Babylon-schwere 3D-Vorschau erst beim ersten Umschalten auf „3D"
// (dynamischer import, wie bei GegenstandsKatalog).
// Dungeon Generator 2.0: the light 2D part is static, the Babylon-heavy 3D
// preview is loaded on first switch to "3D" (dynamic import).
import { CellCanvas } from './dungeon2/CellCanvas';
import { CellTools, type WerkzeugHost } from './dungeon2/CellTools';
import { RoomStampPalette } from './dungeon2/RoomStampPalette';
import { Dungeon2Seite, type Dungeon2Zeichenflaeche } from './dungeon2/Dungeon2Katalog';
import type { Dungeon2Vorschau } from './dungeon2/Dungeon2Vorschau';
// Dieselbe Trennung fuer den 1.0-Reiter: nur der TYP steht hier, das Modul
// selbst kommt beim ersten Umschalten auf „3D" ueber `import()` herein.
import type { DungeonVorschau3d } from './DungeonVorschau3d';
import { befundSchwere } from './befundSchwere';
import {
  BASIS_FEHLT,
  alter,
  basisNachBestaetigung,
  brauchtSchrittVorErsetzen,
  enthaelt,
  entwurfStandLesen,
  gleich,
  holeWeltdokument,
  leeresLayout,
  schreibeWeltdokument,
  vergleiche,
  type EntwurfsQuelle,
} from './weltdokument';
import {
  EntwurfsSpeicher,
  VerdraengtRing,
  alterRingSchluesselEntfernen,
  browserUmgebung,
  entwurfImSpeicher,
  neueTabId,
  serverstandFolge,
  sollInRing,
  speicherGrund,
  type AbgangsGrund,
  type FremdInfo,
  type SpeicherGrund,
} from './entwurfsSpeicher';
import { frage, unterschiedsTafel, vorhang } from './AbgleichDialog';
// NUR der Typ: Der Katalog selbst kommt per dynamischem import() erst beim
// ersten Öffnen (s. Werkzeugleiste). Statisch eingebunden zöge er Babylon
// samt GLB-Ladern in den Erststart des Karteneditors — gut zwei Megabyte
// für eine Ansicht, die man vielleicht nie aufschlägt.
import type { GegenstandsKatalog } from './GegenstandsKatalog';
// Die schwebenden Bedienflächen über der Karte (Werkzeuganzeige, Zoom,
// Ebenen, Übersicht, Eigenschaftskarte). Statisch eingebunden, weil sie
// nichts nachladen — sie zeichnen nur DOM über den beiden Leinwänden.
import { KartenHud, type AltesWerkzeugname, type Werkzeugname } from './KartenHud';
// Werkzeug-Registry: Fluss, See und Objekt platzieren leben in `werkzeuge/`, hier nur der Zugriff.
import { WERKZEUGE, platzierenWerkzeug, werkzeugMitId } from './werkzeuge';
import { platzierungZuBefund } from './werkzeuge/platzieren';
import { erzeugeEditorKern } from './werkzeuge/kontext';
import type { SeitenHost, WerkzeugKontext } from './werkzeuge/typ';
// Das Gestaltungssystem des Editors. Literale Farbwerte in dieser Datei
// waren bis hierher der Normalfall ('#1d2431', '#3a3325', '#e8d48a' …) —
// sechs Dateien mit je eigener Palette, und jede vergessene Zeile blieb
// als Fleck stehen. Ab jetzt kommt jede Farbe, jedes Maß und jedes
// Bedienelement aus design.ts.
import {
  BIOM_TON,
  F,
  M,
  PFAD,
  SCHRIFT,
  auswahl,
  beiUeberfahren,
  beschriftungStil,
  el,
  feld,
  knopf,
  luecke,
  lupenBild,
  marke,
  sinnbild,
  stil,
} from './design';
// Regions-Vorlagen, Feldvalidierung, Kontinente und Startpunkt-Logik
// (Aufgaben B2/B10) — eigene, DOM-freie Datei (Begruendung dort und in
// befundSchwere.ts).
import {
  REGION_VORLAGEN,
  kontinentEntfernen,
  kontinentHinzufuegen,
  setzeStartpunkt,
  wendeVorlageAn,
  type StartpunktZiel,
} from './regionsWerkzeuge';
// Eigene Spur (Roadmap B6/B7): Landflaechen-/Ueberlappungsanzeige.
// Eigene Datei, siehe deren Kopfkommentar fuer die Begruendung.
import { baueKartenMassAnzeige, aktualisiereKartenMassAnzeige } from './KartenMassAnzeige';
// E6: die Laufzeit-Modulregistry. Bewusst NICHT über den AssetManager —
// der zöge Babylon in den Erststart des Karteneditors (s. Kopf von
// assetUrls.ts).
import { ladeModulRegistrierung } from '../net/ModuleRegistryLoad';

// ── E6: die Modulregistry, BEVOR der erste Katalog gebaut wird ────────
//
// `new DungeonSeite(...)` weiter unten baut seine Modulliste IM
// KONSTRUKTOR, und `GegenstandsKatalog` leitet sein `MIT_MODELL` beim
// Import ab. Beide KOPIEREN die Registry, statt sie zu befragen — eine
// Registrierung danach trägt in alle sechs Karten ein und bleibt trotzdem
// unsichtbar, ohne Meldung, weil nichts fehlschlägt.
//
// Warum ein `await` auf oberster Ebene und nicht in einer Startfunktion:
// Der Aufbau dieses Moduls IST die Startfunktion — die Seite entsteht in
// Anweisungen auf Modulebene. Ein `await` hier hält genau sie an, bis die
// Registry steht (Bauziel `esnext`, s. client/vite.config.ts). Ein
// `void ladeModulRegistrierung()` liefe daneben her, und ob der Katalog
// den gebauten Saal sähe, entschiede die Netzlaufzeit — der übelste
// aller Fehler: einer, der auf einer schnellen Verbindung nie auftritt.
//
// Ein `import` mit Nebenwirkung wäre KEINE Alternative: Ein Modul mit
// oberster `await`-Ebene hält seine Geschwister nicht auf, die
// Reihenfolge wäre also nur scheinbar gesichert.
await ladeModulRegistrierung();

const BIOME_NAMEN: BiomeName[] = [
  'grassland', 'blackforest', 'swamp', 'mountain', 'plains', 'mistlands', 'ashlands', 'deepnorth',
];
/**
 * Biomtöne — früher standen die acht Farbwerte hier als Literale und
 * wichen von denen der Kartenvorschau ab (dieselbe Insel war in der
 * Liste anders grün als auf der Karte). Jetzt sind es die Töne aus
 * `BIOM_TON`: `[0]` ist die FÜLLUNG (das Farbquadrat der Regionsliste),
 * `[1]` die KONTUR (der Strich im Karten-Overlay).
 *
 * `BIOME_FARBE` behält seinen Namen, weil `zeichneOverlay()` ihn
 * benutzt — dort ändert sich nur der Ton, nicht die Zeile.
 */
const biomTon = (b: BiomeName): readonly [string, string] => BIOM_TON[b] ?? [F.gedimmt3, F.gedimmt];
const BIOME_FARBE: Record<BiomeName, string> = Object.fromEntries(
  BIOME_NAMEN.map((b) => [b, biomTon(b)[1]])
) as Record<BiomeName, string>;

/**
 * Vordefinierte Inselformen — jede erzeugt eine Region-Form um den
 * Klickpunkt. Polygon-Generatoren streuen die Radien leicht, damit Küsten
 * organisch wirken (das Layout speichert die fertigen Punkte, nicht das
 * Rezept). Erweiterbar: neuer Eintrag hier genügt, das Menü baut sich
 * daraus auf.
 */
interface FormDef {
  id: string;
  name: string;
  erzeuge: (x: number, z: number, groesse: number) => RegionDef['shape'];
}
const rundPoly = (
  x: number,
  z: number,
  n: number,
  radius: (winkel: number, i: number) => number,
  drehung = Math.random() * Math.PI * 2
): RegionDef['shape'] => ({
  kind: 'polygon',
  points: Array.from({ length: n }, (_, i) => {
    const w = drehung + (i / n) * Math.PI * 2;
    const r = radius(w, i);
    return [Math.round(x + Math.cos(w) * r), Math.round(z + Math.sin(w) * r)] as [number, number];
  }),
});
const zufall = (basis: number, streuung: number): number => basis * (1 - streuung + Math.random() * streuung * 2);
const FORMEN: readonly FormDef[] = [
  { id: 'kreis', name: '● Kreis', erzeuge: (x, z, g) => ({ kind: 'circle', x: Math.round(x), z: Math.round(z), radius: Math.round(g) }) },
  {
    id: 'oval',
    name: '⬭ Oval',
    erzeuge: (x, z, g) => {
      const dreh = Math.random() * Math.PI;
      return rundPoly(x, z, 24, (w) => {
        const rx = g;
        const rz = g * 0.62;
        const c = Math.cos(w - dreh);
        const s2 = Math.sin(w - dreh);
        return zufall((rx * rz) / Math.hypot(rz * c, rx * s2), 0.05);
      }, 0);
    },
  },
  {
    id: 'langinsel',
    name: '⟟ Langinsel',
    erzeuge: (x, z, g) => {
      const dreh = Math.random() * Math.PI;
      return rundPoly(x, z, 28, (w) => {
        const rx = g * 1.7;
        const rz = g * 0.45;
        const c = Math.cos(w - dreh);
        const s2 = Math.sin(w - dreh);
        return zufall((rx * rz) / Math.hypot(rz * c, rx * s2), 0.09);
      }, 0);
    },
  },
  {
    id: 'halbmond',
    name: '☾ Halbmond',
    erzeuge: (x, z, g) => {
      // Außenbogen + eingerückter Innenbogen — eine Bucht-Insel.
      const dreh = Math.random() * Math.PI * 2;
      const punkte: [number, number][] = [];
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const w = dreh + (i / n) * Math.PI * 1.35 - Math.PI * 0.675;
        const r = zufall(g, 0.06);
        punkte.push([Math.round(x + Math.cos(w) * r), Math.round(z + Math.sin(w) * r)]);
      }
      for (let i = n; i >= 0; i--) {
        const w = dreh + (i / n) * Math.PI * 1.35 - Math.PI * 0.675;
        const r = zufall(g * 0.55, 0.08);
        const vx = x + Math.cos(dreh) * g * 0.28;
        const vz = z + Math.sin(dreh) * g * 0.28;
        punkte.push([Math.round(vx + Math.cos(w) * r), Math.round(vz + Math.sin(w) * r)]);
      }
      return { kind: 'polygon', points: punkte };
    },
  },
  {
    id: 'zacken',
    name: '✶ Zackenküste',
    erzeuge: (x, z, g) => rundPoly(x, z, 26, () => zufall(g, 0.32)),
  },
  {
    id: 'plateau',
    name: '▭ Plateau',
    erzeuge: (x, z, g) =>
      rundPoly(x, z, 20, (w) => {
        const c = Math.abs(Math.cos(w));
        const s2 = Math.abs(Math.sin(w));
        return zufall(Math.min(g / Math.max(c, 0.0001), (g * 0.7) / Math.max(s2, 0.0001)), 0.04);
      }),
  },
];

// ── Zustand ──────────────────────────────────────────────────────────
/**
 * Der Entwurf im localStorage, gegen fremde Schreiber abgesichert
 * (entwurfsSpeicher.ts). Der Offline-Testflug öffnet sich in einem zweiten
 * Tab und schreibt in DENSELBEN Schlüssel; ohne diesen Speicher überschrieb
 * die nächste Editor-Änderung seine Arbeit still.
 *
 * `beiFremdem` läuft, wenn dort ein abweichender Stand steht — per
 * `storage`-Ereignis, per BroadcastChannel oder beim Schreibversuch. Der
 * eigene Stand wandert vorher in den Rückgängig-Stapel (`merkeSchritt`),
 * der fremde wird der Entwurf. Zurückgeschrieben wird nicht (`alles(…,
 * false)`): Sonst sähe der andere Tab unsere Übernahme als fremde Änderung.
 * Steht hier oben, weil `ladeEntwurf()` ihn sofort braucht; die Funktionen,
 * die der Rückruf nutzt, laufen erst, wenn das Modul fertig ist.
 */
/**
 * Der Ring der verdrängten Entwürfe (entwurfsSpeicher.ts): Kein Stand geht
 * still verloren. Was aus Rückgängig/Wiederherstellen fällt oder von der
 * Anzeige verdrängt wird, ohne dass sein Inhalt anderswo steht, liegt hier,
 * und die Sektion „Verdrängte Entwürfe" (Welt-Reiter) setzt es wieder ein.
 * Zwei Schreiber auf einen Schlüssel ohne Zusammenführen bleiben ein
 * Grundproblem — das löst erst der Umbau auf IDs/Operationen; bis dahin
 * ist jeder Stand wiederherstellbar.
 */
const umgebung = browserUmgebung();
/** Eine Kennung für Speicher UND Ring: Die Einträge des Rings tragen sie im Schlüssel. */
const tabId = neueTabId();
const ring = new VerdraengtRing(umgebung.speicher, { tabId });
// Ein Sammelschlüssel der Vorgängerfassung würde als unsichtbarer Ballast in der Quote liegen bleiben: einmal entfernen.
if (alterRingSchluesselEntfernen(umgebung.speicher)) {
  console.info(
    '[editor] Alter Sammelschlüssel der verdrängten Entwürfe (wov-editor-verdraengt) entfernt — der Ring nutzt jetzt einen Schlüssel je Eintrag.'
  );
}
/** Herkunft der von anderen Tabs übernommenen Stände (Layouts werden nur ersetzt, nie verändert). */
const fremdeStaende = new WeakMap<WorldLayout, FremdInfo>();
/**
 * Eigene Stände, die auf einem fremden aufbauen und dessen Inhalt mittragen.
 * Ein solcher Stand ist beim Hinausfallen so wenig verzichtbar wie der fremde
 * selbst: `speichereEntwurf` markiert jeden Stand, der nach einem
 * `merkeSchritt` auf einem fremden oder fremdhaltigen entsteht.
 */
const fremdHaltig = new WeakSet<WorldLayout>();
/** Der nächste geschriebene Stand baut auf einem fremden/fremdhaltigen auf (gesetzt in `merkeSchritt`). */
let baueAufFremdem = false;
function istFremdHaltig(stand: WorldLayout): boolean {
  return fremdeStaende.has(stand) || fremdHaltig.has(stand);
}
/**
 * Zähler seit dem Start: wie viele Stände in den Ring gingen, nicht gesichert
 * werden konnten, wegen der Grenzen den ältesten Eintrag kosteten, oder als
 * Ring-Einträge zugunsten des Entwurfs geopfert wurden (Quote).
 */
let ringNeu = 0;
let ringVoll = 0;
let ringVerworfen = 0;
let ringGeopfert = 0;
interface RingStand {
  neu: number;
  voll: number;
  verworfen: number;
}
function ringStand(): RingStand {
  return { neu: ringNeu, voll: ringVoll, verworfen: ringVerworfen };
}
function ringen(stand: WorldLayout, herkunft: 'fremd' | 'eigen', grund: string, herkunftTab: string | null): void {
  const verworfenVor = ring.verworfen;
  const r = ring.ablegen(stand, herkunft, grund, herkunftTab);
  ringVerworfen += ring.verworfen - verworfenVor;
  if (r === 'ok') ringNeu++;
  else if (r === 'voll') {
    ringVoll++;
    // Auch im eigenen Änderungspfad (Grenze, eigene Änderung): gleich melden, nicht erst über eine spätere Meldung.
    shell.meldung('ACHTUNG: Ein verdrängter Stand konnte NICHT gesichert werden (Speicher voll)!', true);
  }
}
/** Der Verlauf meldet einen Stand, der ihn verlässt: nach `sollInRing` sichern. */
function beiAbgang(stand: WorldLayout, grund: AbgangsGrund, bezug: WorldLayout): void {
  const info = fremdeStaende.get(stand);
  const herkunft = istFremdHaltig(stand) ? 'fremd' : 'eigen';
  if (!sollInRing(grund, herkunft, enthaelt(bezug, stand))) return;
  ringen(stand, herkunft, grund, info ? info.tabId : herkunft === 'eigen' ? entwurfsSpeicher.tabId : null);
}
/** Satz für die Meldungen: nennt, was in den Ring ging (seit dem Stand `vorher`/`vorherVoll`). */
function ringHinweis(vor: RingStand): string {
  let t = '';
  if (ringNeu > vor.neu) {
    t += ` ${ringNeu - vor.neu} Stand/Stände gesichert — Welt-Reiter, „Verdrängte Entwürfe".`;
  }
  if (ringVerworfen > vor.verworfen) {
    t += ` Ältester verdrängter Entwurf verworfen (der Ring fasst höchstens 5: ${ringVerworfen - vor.verworfen} weniger).`;
  }
  if (ringVoll > vor.voll) t += ' ACHTUNG: Ein verdrängter Stand konnte NICHT gesichert werden (Speicher voll)!';
  return t;
}
const entwurfsSpeicher = new EntwurfsSpeicher({
  ...umgebung,
  tabId,
  aktuell: () => layout,
  // Der Entwurf hat Vorrang vor dem Ring: Passt er nicht, wird der älteste Ring-Eintrag entfernt und neu
  // versucht. Passt er auch ohne Ring nicht, bekommt der Ring zurück, was er umsonst hergab.
  platzSchaffen: () => ring.aeltestenEntfernen(),
  platzErgebnis: (entwurfPasst) => {
    ringGeopfert += ring.opferAbschliessen(entwurfPasst);
  },
  beiVerdraengt: (alt) => {
    // Sicherheitsnetz: ein fremder Stand wurde im Speicher ersetzt. Liegt er
    // in einem Stapel oder wird er angezeigt, ist nichts verloren.
    if (gleich(layout, alt) || verlauf.enthaelt((x) => gleich(x, alt))) return;
    ringen(alt, 'fremd', 'ersetzt', null);
  },
  beiFremdem: (fremd, info) => {
    fremdeStaende.set(fremd, info);
    const ringVor = ringStand();
    // Übernahmen sind EINE Schrittklasse (s. SchrittVerlauf): Nur die
    // erste nach einer eigenen Änderung legt einen Schritt an, sonst füllte
    // eine Flut fremder Schreibvorgänge den Stapel und verdrängte den
    // eigenen Stand, obwohl die Meldung unten ihn verspricht.
    const { verworfen } = verlauf.uebernahme(layout, fremd);
    layout = fremd;
    gewaehlt = null;
    // Halbfertiges Werkzeug gehört zum verdrängten Stand: ein angefangener
    // Fluss, Polygonzug, Startpunkt-Klick oder Form-Griff würde sonst in den
    // fremden Entwurf hineingeschrieben.
    griff = null;
    for (const w of WERKZEUGE) w.abbrechen(werkzeugKontext);
    polygonPunkte = [];
    startpunktModus = null;
    alles('bearbeitet', false);
    vorschauAnstossen();
    shell.meldung(
      'Entwurf aus einem anderen Tab übernommen — dein bisheriger Stand liegt unter Rückgängig (Strg+Z).' +
        (verworfen > 0 ? ' Wiederherstellen ist nach der Übernahme nicht mehr möglich.' : '') +
        ringHinweis(ringVor),
      true
    );
  },
});
/**
 * Der Startwert ist BEWUSST weiter der Browser-Entwurf und nicht der
 * Serverstand: Der Editor baut sein Fenster synchron auf, der Server
 * antwortet asynchron. Auf die Antwort zu warten hiesse, eine Sekunde
 * lang eine leere Seite zu zeigen und danach jede Zeile hier unten in
 * einen Rückruf zu verschieben.
 *
 * Der Entwurf ist in dieser Sekunde aber NICHT bedienbar: `weltAbgleich`
 * (ganz unten) legt sofort einen Vorhang über das Fenster und nimmt ihn
 * erst weg, wenn feststeht, welcher Stand gilt. Damit ist der frühe
 * Entwurf ein Vorschaubild und keine Arbeitsgrundlage — der Unterschied,
 * an dem der ganze Schritt hängt.
 */
let layout: WorldLayout = ladeEntwurf();
/**
 * Welche Welt bearbeiten wir? Kommt AUSSCHLIESSLICH aus der Antwort des
 * Betriebsdienstes (s. weltdokument.holeWeltdokument) — nicht aus dem
 * Hostnamen, nicht aus der URL, denn beide können lügen. `null` heisst
 * „noch nicht bzw. nicht zu ermitteln" und wird überall als Warnung
 * behandelt, nicht als „vermutlich dev".
 */
let welt: { instanz: string | null; datei: string | null } = { instanz: null, datei: null };
/**
 * Kanonischer Text des zuletzt gesehenen Serverstands (`null` = keiner
 * gesehen). Daran hängt die Frage „steht das, was ich sehe, auch auf dem
 * Server?" — der Speicherknopf beantwortet sie (s. faerbeSpeicherKnopf).
 */
let serverKanon: string | null = null;
/**
 * Die BASIS des Entwurfs — der Serverstand (Hash), auf dem er beruht — ist die
 * im Begleitzettel (`entwurfsSpeicher.basisLesen`). Sie ist NICHT „der zuletzt
 * gelesene Serverstand": Ein Editor, der einen Serverstand nur holt und dem
 * Nutzer zeigt, ändert sie nicht. Erst `setzeEntwurfBasis` setzt sie, und nur
 *   (1) nachdem Serverinhalt in den Entwurf geschrieben wurde (Start ohne
 *       Entwurf, Serverstand laden/übernehmen),
 *   (2) nach einem gelungenen Speichern in die Welt,
 *   (3) wenn der Nutzer im Dialog ausdrücklich „Entwurf behalten" wählt.
 * Der Testflug speichert mit genau dieser Basis (`LocalStoragePersistenz`), der
 * Editor ebenso (`inDieWeltSpeichern`); der Betriebsdienst lehnt jeden anderen
 * Stand mit 409 ab. `null`: keine bekannt, dann geht nichts auf den Server.
 */
function setzeEntwurfBasis(hash: string | null): void {
  entwurfsSpeicher.basisMerken(hash);
}
/**
 * Muss hier oben stehen und nicht bei den übrigen Speicher-Funktionen:
 * Der Werkzeugleisten-Block weiter unten läuft beim Laden des Moduls und
 * weist das Feld zu — eine `let`-Deklaration NACH ihm läge zu diesem
 * Zeitpunkt noch in der temporalen Todeszone.
 */
let speicherKnopf: HTMLButtonElement | null = null;
/**
 * Zwei Zeiger IN den Speicherknopf. Er trägt seit der Umstellung auf
 * `knopf()` ein Sinnbild als erstes Kind — ein `textContent = …` wie
 * früher würde es mit überschreiben. Deshalb hält `faerbeSpeicherKnopf`
 * den Zustandspunkt und den Textknoten einzeln fest und fasst den Rest
 * des Knopfes nicht an.
 */
let speicherPunkt: HTMLSpanElement | null = null;
let speicherText: HTMLElement | null = null;
let liveKnopf: HTMLButtonElement | null = null;
let zurueckKnopf: HTMLButtonElement | null = null;
/**
 * Öffnet den Gegenstands-Katalog. Aus demselben Grund hier oben wie
 * `speicherKnopf`: Der Werkzeugleisten-Block weist zu, und die
 * Eigenschaftskarte auf der Karte ruft es — beide entstehen später.
 */
let katalogOeffnen: (() => void) | null = null;
/** Steht der Katalog über der Karte? (Entf darf dann kein Kartenobjekt löschen.) */
let katalogIstOffen: () => boolean = () => false;
let gewaehlt: string | null = null;
let werkzeug: Werkzeugname = 'auswahl';
/**
 * Startpunkt-Klickmodus (Aufgabe B2): 'welt' -> naechster Kartenklick
 * setzt `layout.defaultSpawn`; { continentId } -> setzt `continent.spawn`
 * dieses Kontinents. Eigenstaendig statt eines neuen `werkzeug`-Werts,
 * s. Kommentar bei weltSektionBauen().
 */
let startpunktModus: StartpunktZiel | null = null;
/** Gewählte vordefinierte Form + Basisgröße (m) des Form-Werkzeugs. */
let gewaehlteForm = 'kreis';
let formGroesse = 1500;
let polygonPunkte: [number, number][] = [];
/** Weltmeter je Bildschirmpixel der Zeichenfläche. */
let massstab = 40;
let mitteX = 0;
let mitteZ = 0;
/**
 * Aktiver Form-Griff (Review-Punkt 19): Regionen ließen sich nach dem
 * Zeichnen nur löschen und neu setzen. 'mitte' verschiebt die ganze Form,
 * 'radius' skaliert den Kreis, ein Zahlwert ist der Polygon-Punktindex.
 */
let griff: { regionId: string; art: 'mitte' | 'radius' | number } | null = null;
const GRIFF_PX = 7;

/**
 * Der Kern des Editors (`werkzeuge/kontext.ts`): der Rückgängig-Stapel `verlauf`, `merkeSchritt`, `alles` und DER
 * eine Werkzeug-Kontext, den jedes registrierte Werkzeug bekommt. Alles davon wird in `entwurfs-speicher.ts`
 * ausgeführt und am Verhalten geprüft; hier stehen nur die Handgriffe auf dem Modulzustand. Es gibt genau EINEN
 * Aufruf von `erzeugeEditorKern` (und darin genau einen Kontext), und jeder Werkzeug-Haken unten bekommt
 * `werkzeugKontext` — auch das prüft dieser Test, am Syntaxbaum (Umbrüche, Anführungszeichen, Kommentare und
 * Hilfsvariablen ändern nichts). Nur Funktionen und Lesezugriffe zur Laufzeit: der Aufruf darf hier oben stehen,
 * obwohl `zuBild` und `massstab` weiter unten entstehen.
 */
const kern = erzeugeEditorKern({
  layout: () => layout,
  // Nur die Zuweisung; den Rückgängig-Schritt davor und das Speichern danach legt der Kern fest.
  setzeLayout: (neu) => {
    layout = neu;
  },
  beiAbgang,
  // Ein Ersetzen (Import, Serverstand) baut nicht auf dem alten Stand auf.
  nachSchritt: (ersetzt) => {
    baueAufFremdem = !ersetzt && istFremdHaltig(layout);
  },
  speichereEntwurf,
  seiteBauen,
  pruefberichtBauen,
  weltSektionBauen,
  kartenMassBauen,
  zeichneOverlay,
  faerbeSpeicherKnopf,
  vorschauAnstossen,
  werkzeugId: () => werkzeug,
  zurAuswahl: () => {
    werkzeug = 'auswahl';
  },
  meldung: (text, fehler) => shell.meldung(text, fehler),
  zuBild: (wx, wz) => zuBild(wx, wz),
  massstab: () => massstab,
  bestaetige: (frage) => window.confirm(frage),
});
export const werkzeugKontext: WerkzeugKontext = kern.werkzeugKontext;
/** Der Rückgängig-Stapel: Stapel und die Regel „wann legt eine Übernahme einen Schritt an“ stecken in `SchrittVerlauf` (entwurfsSpeicher.ts). */
const verlauf = kern.verlauf;
/** `ersetzt`: der Entwurf wird durch einen ANDEREN ersetzt (Import, Serverstand, wieder eingesetzter Stand), nicht weitergebaut. */
const merkeSchritt = kern.merkeSchritt;
/**
 * Liefert den Grund einer Meldung, die kein Aufrufer überschreiben darf, oder
 * 'ok': 'fremd' (ein anderer Tab hatte den Entwurf geändert und wurde
 * übernommen — in der Anzeige steht dieser, nicht der, den der Aufrufer eben
 * setzen wollte), 'voll' („Entwurf zu groß") oder 'knapp' („Speicher knapp"
 * mit den geopferten Ring-Einträgen).
 */
const alles = kern.alles;

function ladeEntwurf(): WorldLayout {
  return entwurfsSpeicher.lesen() ?? leeresLayout();
}

/**
 * Entwurf in den localStorage. `quelle` ist kein Schmuck: Sie hält fest,
 * ob der Entwurf gerade 1:1 der Serverstand ist ('server') oder daneben
 * steht ('bearbeitet' / 'import') — daraus baut der Abgleichdialog beim
 * nächsten Start seinen Satz „dein Entwurf ist 12 Minuten alt und stammt
 * aus einem Import".
 */
function speichereEntwurf(quelle: EntwurfsQuelle = 'bearbeitet'): SpeicherGrund {
  // 'fremd': ein anderer Tab (Testflug, zweiter Editor) hat den Entwurf
  // inzwischen geändert. Der Speicher hat NICHT geschrieben, sondern
  // `beiFremdem` (oben) den fremden Stand übernommen — dessen Meldung gilt.
  // 'voll': der Entwurf passt nicht in den Speicher (auch nicht, nachdem der
  // Ring alles freigegeben hat, was er hatte). Beide Meldungen sind wichtiger
  // als jede Erfolgsmeldung des Aufrufers; darum liefert diese Funktion den
  // GRUND ('fremd' | 'voll' | 'knapp') statt nur „gemeldet": Der Aufrufer
  // überschreibt sie nicht, und wer wie der Start-Abgleich eine eigene
  // Meldung zum Grund hat, kann ihn unterscheiden.
  if (baueAufFremdem && !fremdeStaende.has(layout)) fremdHaltig.add(layout);
  const geopfertVor = ringGeopfert;
  const ergebnis = entwurfsSpeicher.schreiben(layout, quelle, welt.instanz);
  const geopfert = ringGeopfert - geopfertVor;
  const opferText = geopfert > 0 ? ` Dafür wurden ${geopfert} verdrängte Stände aus dem Ring verworfen (ältester zuerst).` : '';
  const grund = speicherGrund(ergebnis, geopfert);
  if (grund === 'voll') {
    shell.meldung('Entwurf zu groß für localStorage — bitte als JSON exportieren!' + opferText, true);
  } else if (grund === 'knapp') {
    // Der Entwurf hat Vorrang vor dem Ring: Er passte nur, weil der Ring Platz gemacht hat.
    shell.meldung(`Speicher knapp — der Entwurf ist gespeichert.${opferText}`, true);
  } else if (ergebnis === 'ohne-zettel') {
    // Der Entwurf ist gespeichert, nur der Begleitzettel nicht. Einmal
    // sagen, nicht bei jeder Bewegung eines Griffs.
    if (!zettelHinweisGezeigt) {
      zettelHinweisGezeigt = true;
      shell.meldung('Entwurf gespeichert — der Speicher ist fast voll (Begleitzettel fehlt).');
    }
  } else {
    zettelHinweisGezeigt = false;
  }
  return grund;
}
let zettelHinweisGezeigt = false;

// Beim Verlassen der Seite Ereignis und Kanal aushängen. `persisted`: Die
// Seite kommt aus dem Vor-/Zurück-Zwischenspeicher wieder und behielte
// nichts von dem, was hier ausgehängt würde — dann bleibt alles stehen.
window.addEventListener('pagehide', (e) => {
  if (!e.persisted) entwurfsSpeicher.schliessen();
});
// Eine Seite im Zwischenspeicher bekommt keine `storage`-Ereignisse. Bei der
// Rückkehr (`persisted`) nachsehen, was inzwischen im Entwurf steht — sonst
// zeigte der Editor bis zur nächsten eigenen Änderung einen veralteten Stand.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) entwurfsSpeicher.abgleichen();
});

// ── Undo/Redo (Review-Punkt 18) ──────────────────────────────────────
// `layout` wird überall immutabel ersetzt — ein Snapshot je Änderung
// genügt. Strg+Z / Strg+Y (bzw. Strg+Shift+Z).
// Stapel und Regel „wann legt eine Übernahme einen Schritt an" stecken in
// `SchrittVerlauf` (entwurfsSpeicher.ts), damit beides ohne Editorfenster
// prüfbar ist; hier steht nur die Verdrahtung mit `layout` (`kern.verlauf`, oben).
/**
 * Wirkung unverändert, nur aus dem Tastatur-Zweig herausgezogen: Seit die
 * Symbolspalte einen Fuß hat (Entwurf), gibt es für beide Schritte auch
 * einen Knopf — und zwei Wege zu einer Handlung müssen dieselbe
 * Handlung sein und nicht deren Zwilling.
 */
function rueckgaengig(): void {
  const vorher = verlauf.zurueck(layout);
  if (vorher === undefined) {
    shell.meldung('Nichts mehr rückgängig zu machen.');
    return;
  }
  layout = vorher;
  gewaehlt = null;
  const ringVor = ringStand();
  // Hat der Schreibversuch einen fremden Stand gefunden und übernommen, hat
  // `beiFremdem` schon gemeldet, was wirklich geschah — dann nicht mit
  // „Rückgängig" darüberschreiben.
  const grund = alles();
  vorschauAnstossen();
  if (grund === 'ok') {
    shell.meldung(`Rückgängig (${verlauf.vergangenheit.length} weitere Schritte)` + ringHinweis(ringVor));
  }
}
function wiederherstellen(): void {
  const wieder = verlauf.vor(layout);
  if (wieder === undefined) {
    shell.meldung('Nichts wiederherzustellen.');
    return;
  }
  layout = wieder;
  gewaehlt = null;
  const ringVor = ringStand();
  const grund = alles();
  vorschauAnstossen();
  if (grund === 'ok') shell.meldung('Wiederhergestellt' + ringHinweis(ringVor));
}
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (e.code === 'KeyZ' && !e.shiftKey) {
    rueckgaengig();
  } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
    wiederherstellen();
  }
});

function neueId(basis: string): string {
  let n = 1;
  while (layout.regions.some((r) => r.id === `${basis}-${n}`)) n++;
  return `${basis}-${n}`;
}

// ── Editor-Shell (Werkzeugleiste, Seitenleiste, Viewport, Konsole) ───
const shell = new EditorShell('⚔ World of Vikings — Map-Generator');
const flaeche = shell.viewport;
/**
 * Dynamischer Seitenleisten-Inhalt (Werkzeuge, Regionen, Bewuchs).
 *
 * OHNE Überschrift: `shell.seitenkopf()` sagt bereits, was hier steht,
 * und eine zweite Zeile „Werkzeuge & Regionen" darunter wäre nur eine
 * Wiederholung, die dem Kachelraster Platz wegnimmt. Der leere Titel
 * lässt die Sektion zur reinen Trennlinie zusammenfallen.
 */
const seite = shell.sektion('');
/**
 * Prüfbericht (Aufgabe B1): eigene, IMMER sichtbare Sektion statt eines
 * Reiters in `seite` — `seiteBauen()` leert `seite` bei jeder Änderung
 * komplett, ein eigener Andockplatz überlebt das unabhängig und bleibt
 * an fester Stelle auffindbar, egal welches Werkzeug gerade offen ist.
 */
const pruefSeite = shell.sektion('Prüfbericht');
/**
 * Weltweite Angaben ohne einzelne Region: Kontinente und Startpunkt
 * (Aufgabe B2). Eigene, IMMER sichtbare Sektion aus demselben Grund wie
 * `pruefSeite` -- `seiteBauen()` leert nur `seite`, nicht diese hier.
 */
const weltSeite = shell.sektion('Welt');

/**
 * Seitenleiste der Dungeon-Betriebsart. Eigene Sektion aus demselben Grund
 * wie `weltSeite`: `seiteBauen()` leert nur `seite`, nicht diese hier —
 * und der Dungeon-Bereich hat mit den Weltwerkzeugen keine Zeile gemeinsam.
 */
const dungeonSeiteBehaelter = shell.sektion('Dungeons');

const vorschau = document.createElement('canvas');
vorschau.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
flaeche.appendChild(vorschau);

const overlay = document.createElement('canvas');
overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;';
flaeche.appendChild(overlay);

/**
 * Grundriss-Ansicht der Betriebsart „Dungeons".
 *
 * Eigene Zeichenfläche NEBEN den beiden Karten-Canvas, nicht statt ihnen:
 * Ein Dungeon-Grundriss hat mit der Weltkarte keine Koordinaten gemeinsam,
 * und ein gemeinsamer Canvas hiesse, in jedem Zeichenschritt zu fragen,
 * welche Welt gerade gemeint ist. Umgeschaltet wird über `display`.
 */
const dungeonGrundriss = new DungeonGrundriss(flaeche, {
  meldung: (text, fehler) => shell.meldung(text, fehler),
  // Die Seite zeichnet sich neu, wenn der Grundriss die Auswahl aendert.
  // Der Umweg ueber die Funktion ist noetig, weil `dungeonSeite` erst eine
  // Zeile spaeter entsteht — sie braucht den Grundriss.
  //
  // Derselbe Rueckruf zieht die 3D-Ansicht nach: Er feuert bei JEDER
  // Aenderung am Dokument (`setzeDokument`, `fuegeAn`, `entferne`,
  // `schliesseKanten`) und nicht nur bei der Auswahl — ein eigener
  // „dokumentGeaendert"-Haken waere eine zweite Liste derselben Stellen,
  // und die eine wuerde beim naechsten Bauwerkzeug vergessen.
  auswahlGeaendert: () => {
    dungeonSeite.baue();
    zieheDungeon3dNach();
  },
  // Klick auf eine Kantenmarke (2D wie 3D): die Seitenleiste waehlt genau
  // diese Kante im Feld „Anfuegen an" — angefuegt wird weiterhin dort.
  connectorAngeklickt: (idx) => dungeonSeite.waehleKante(idx),
  // Der Ebenenfilter der Seitenleiste gilt fuer BEIDE Ansichten. Eigener
  // Rueckruf und nicht `auswahlGeaendert`: Der baut die Leiste neu und
  // stellte damit das Auswahlfeld selbst auf „alle Ebenen" zurueck.
  ansichtGeaendert: () => zieheDungeon3dNach(),
});

/** Seitenleiste dieser Betriebsart — s. `DungeonKatalog.ts`. */
const dungeonSeite = new DungeonSeite(dungeonSeiteBehaelter, dungeonGrundriss, {
  meldung: (text, fehler) => shell.meldung(text, fehler),
});
dungeonSeite.baue();

// ── E8: Darf hier ein Saal gebaut werden? ─────────────────────────────
//
// `dungeons.modulbau` steht in der `server.yml` und erreicht einen Client
// genau einmal — beim Anmelden, im Flagbyte der `ServerConfig`. Gefragt
// wird über eine kurze Verbindung, die sich sofort wieder trennt (s.
// `DungeonNeuerSaal.ts`).
//
// Bewusst OHNE `await`, anders als bei der Modulregistry ein paar hundert
// Zeilen weiter oben: Jene muss vor dem ersten Katalogaufbau stehen, weil
// zwei Stellen die Registry KOPIEREN statt sie zu befragen — eine späte
// Registrierung bliebe unsichtbar. Diese Antwort dagegen fügt nur einen
// Abschnitt hinzu, und `baue()` legt die Leiste ohnehin ständig neu an.
// Ein `await` hier hielte den ganzen Editor bis zu zehn Sekunden an, wenn
// kein Spielserver läuft — und der Editor soll ohne einen benutzbar sein.
void fetchModuleBuildPermission().then((erlaubt) => {
  dungeonSeite.setModuleBuild(erlaubt);
  if (erlaubt) dungeonSeite.baue();
});

// ── 2D/3D-Umschalter der Betriebsart „Dungeons" ───────────────────────
//
// Dieselbe Bauweise wie beim Dungeon-2.0-Reiter (`dungeon2AnsichtSektion`
// weiter unten): eigene Sektion, Babylon erst beim ersten Umschalten
// geladen, beide Ansichten leben im SELBEN Viewport und werden ueber
// `display` getauscht. Die 3D-Ansicht ist dabei kein zweiter Editor,
// sondern eine zweite Sicht auf denselben Grundriss-Zustand — sie meldet
// Klicks als Indizes zurueck (s. `DungeonVorschau3d.ts`).
const dungeonAnsichtSektion = shell.sektion('Ansicht');
/** Der Block der Sektion — die 3-Wege-Sichtbarkeit blendet ihn mit. */
const dungeonAnsichtBlock = dungeonAnsichtSektion.parentElement;
let dungeonVorschau3d: DungeonVorschau3d | null = null;
let dungeonAnsicht: '2d' | '3d' = '2d';
/**
 * Decke der Module zeigen? Vorgabe AUS.
 *
 * Der Zustand steht HIER und nicht im Haekchen: `baueDungeonAnsichtSchalter`
 * wirft die Reihe bei jedem Umschalten weg — ein Wert, der nur im Element
 * steht, waere danach wieder auf der Vorgabe (dieselbe Lehre wie bei den
 * Schaltern in `DungeonKatalog.ts`).
 */
let dungeonDecke = false;

/**
 * Die 3D-Ansicht auf den Stand des Grundrisses bringen.
 *
 * Immer BEIDES: das Dokument (es kann sich strukturell geaendert haben)
 * und die Auswahl. Der Neubau dahinter ist entprellt und verwirft nur
 * Instanzen, keine Master — bei einem Dokument mit ein paar Dutzend
 * Modulen ist das billiger als jede Buchfuehrung, die ein Diff braeuchte.
 */
function zieheDungeon3dNach(): void {
  if (dungeonVorschau3d === null) return;
  dungeonVorschau3d.setzeDokument(dungeonGrundriss.dokument);
  dungeonVorschau3d.waehle(dungeonGrundriss.gewaehlterRaum);
  // Ebene aus dem GRUNDRISS, Decke von hier: Der Ebenenfilter gehoert
  // beiden Ansichten (ein Auswahlfeld), die Decke gibt es nur in 3D.
  dungeonVorschau3d.setzeEbene(dungeonGrundriss.aktiveEbene);
  dungeonVorschau3d.setzeDecke(dungeonDecke);
}

const setzeDungeonAnsicht = async (a: '2d' | '3d'): Promise<void> => {
  dungeonAnsicht = a;
  if (a === '3d' && dungeonVorschau3d === null) {
    shell.meldung('3D-Ansicht wird geladen …');
    const mod = await import('./DungeonVorschau3d');
    dungeonVorschau3d = new mod.DungeonVorschau3d(flaeche, {
      meldung: (t, f) => shell.meldung(t, f),
      // Ein Klick in 3D waehlt im GRUNDRISS — der ist die eine Wahrheit
      // ueber die Auswahl, und sein `auswahlGeaendert` zieht Seitenleiste
      // und 3D-Hervorhebung gemeinsam nach.
      raumAngeklickt: (i) => dungeonGrundriss.waehle(i),
      connectorAngeklickt: (idx) => dungeonSeite.waehleKante(idx),
    });
    zieheDungeon3dNach();
  }
  const imDungeon = betriebsart === 'dungeons';
  dungeonGrundriss.zeige(imDungeon && a === '2d');
  dungeonVorschau3d?.zeige(imDungeon && a === '3d');
  baueDungeonAnsichtSchalter();
};

function baueDungeonAnsichtSchalter(): void {
  const reihe = el('div', stil({ display: 'flex', gap: '8px' }));
  reihe.append(
    knopf('2D-Grundriss', () => void setzeDungeonAnsicht('2d'), {
      art: dungeonAnsicht === '2d' ? 'bronze' : 'flaeche',
    }),
    knopf('3D-Ansicht', () => void setzeDungeonAnsicht('3d'), {
      art: dungeonAnsicht === '3d' ? 'bronze' : 'flaeche',
    })
  );
  dungeonAnsichtSektion.replaceChildren(reihe);
  // Decke und Fokus betreffen NUR die 3D-Ansicht — im Grundriss waeren es
  // zwei Bedienelemente ohne Wirkung.
  if (dungeonAnsicht !== '3d') return;

  const deckeFeld = el('label', stil({ display: 'flex', gap: '6px', 'align-items': 'center', 'font-size': '12px', color: F.gedimmt2, cursor: 'pointer' }));
  const kasten = document.createElement('input');
  kasten.type = 'checkbox';
  kasten.checked = dungeonDecke;
  kasten.onchange = () => {
    dungeonDecke = kasten.checked;
    dungeonVorschau3d?.setzeDecke(dungeonDecke);
  };
  deckeFeld.append(kasten, el('span', '', 'Decke zeigen'));

  const zweite = el('div', stil({ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-top': '6px' }));
  zweite.append(
    deckeFeld,
    // Ohne Auswahl passt „Fokus" das ganze Dungeon ein — derselbe Knopf,
    // damit man nicht raten muss, welcher gerade gilt.
    knopf('Fokus', () => dungeonVorschau3d?.fokussiere(), { art: 'flaeche' })
  );
  dungeonAnsichtSektion.append(zweite);
}
baueDungeonAnsichtSchalter();

// ── Betriebsart „Dungeon 2.0" (AP15.7) ────────────────────────────────
// Eigener Container in der Seitenmitte: Die 3-Wege-Sichtbarkeit
// (Welt / dungeons / dungeon2) blendet EINEN Block ein/aus, statt einzelne
// Sektionen aufzuzaehlen — dieselbe Lehre wie beim LEGACY-Dungeon-Block.
// Own container in the sidebar middle so the 3-way visibility toggles ONE
// block instead of enumerating sections.
const seitenmitteEl = dungeonSeiteBehaelter.parentElement!.parentElement!;
const dungeon2Behaelter = document.createElement('div');
seitenmitteEl.appendChild(dungeon2Behaelter);

// Shell-Adapter: `sektion()` baut den Block ueber die echte Shell und
// verschiebt ihn in unseren Container — identische Sektions-Optik, ohne sie
// nachzubauen. `seitenkopf` bleibt leer, weil `seitenkopfSetzen()` den Kopf
// aus KOPF_JE_BETRIEBSART fuehrt.
// Shell adapter: build sections via the real shell, then relocate them.
const dungeon2Shell = {
  seitenkopf: (_titel: string, _text: string): void => {},
  sektion: (titel: string, offen = true): HTMLDivElement => {
    const inhalt = shell.sektion(titel, offen);
    const block = inhalt.parentElement;
    if (block) dungeon2Behaelter.appendChild(block);
    return inhalt;
  },
  meldung: (text: string, fehler?: boolean): void => shell.meldung(text, fehler),
};

// Die 2D-Zeichenflaeche (Zellen) ist leichtgewichtig — sofort angelegt.
// The 2D cell canvas is lightweight — created immediately.
const cellCanvas = new CellCanvas(flaeche, { meldung: (t, f) => shell.meldung(t, f) });

// Die 3D-Vorschau zieht Babylon (~2 MB); wie GegenstandsKatalog erst beim
// ersten Umschalten auf „3D" geladen. / Loaded on first switch to "3D".
let dungeon2Vorschau: Dungeon2Vorschau | null = null;
let dungeon2Ansicht: '2d' | '3d' = '2d';

// Adapter, der beide Ansichten speist: `setzeLayout` rollt nur neu aus
// (Bearbeiten — kein Kamera-Sprung), `zeige(true)` rahmt ein frisch
// geoeffnetes Dokument ein. Der Katalog ruft `zeige(true)` NUR beim
// Oeffnen/Speichern/Anlegen, nie beim Pinseln (Dungeon2Katalog.ts Z.323
// gegen Z.504) — genau der Diskriminator, den wir brauchen.
// Adapter feeding both views: setzeLayout re-rolls only (edit, no jump),
// zeige(true) frames a freshly opened document.
const dungeon2Zeichenflaeche: Dungeon2Zeichenflaeche = {
  setzeLayout: (layout) => {
    cellCanvas.aktualisiere(layout);
    dungeon2Vorschau?.setzeLayout(layout);
  },
  zeige: (an) => {
    if (an && dungeon2Ansicht === '2d') cellCanvas.passeEin();
  },
};

// Der Katalog liest ueber den Betriebsdienst und speichert ueber den
// Spielserver. Werkzeugandockung: Ein Dokumentwechsel waehlt laufende
// Pinsel ab. / Catalogue reads via ops service, saves via game server.
const dungeon2Seite = new Dungeon2Seite(dungeon2Shell, {
  zeichenflaeche: dungeon2Zeichenflaeche,
  werkzeuge: {
    aufDokumentGewechselt: () => {
      cellTools.abwaehlen();
      roomStampPalette.abwaehlen();
    },
  },
});

// Gemeinsamer Werkzeug-Wirt: liest das aktuelle Dokument aus dem Katalog,
// schreibt Handarbeit ueber `uebernehmeBearbeitung` zurueck (markiert
// schmutzig, aktualisiert Zeichenflaeche + Seitenleiste).
// Shared tool host: reads the current document, writes edits back.
const dungeon2Wirt: WerkzeugHost = {
  hole: () => dungeon2Seite.dokument(),
  setze: (neu) => dungeon2Seite.uebernehmeBearbeitung(neu),
  meldung: (t, f) => shell.meldung(t, f),
};
const cellTools = new CellTools(cellCanvas, dungeon2Wirt);
const roomStampPalette = new RoomStampPalette(cellCanvas, dungeon2Wirt);

// Ansichts-Umschalter 2D/3D. Der 3D-Zweig laedt die Vorschau bei Bedarf
// nach und uebergibt ihr das aktuell geoeffnete Layout.
// 2D/3D view switch. The 3D branch lazy-loads the preview on demand.
const dungeon2AnsichtSektion = dungeon2Shell.sektion('Ansicht');
const dungeon2WerkzeugSektion = dungeon2Shell.sektion('Zellen-Werkzeuge');
dungeon2WerkzeugSektion.appendChild(cellTools.element());
const dungeon2StempelSektion = dungeon2Shell.sektion('Raum-Stempel', false);
dungeon2StempelSektion.appendChild(roomStampPalette.element());

const setzeDungeon2Ansicht = async (a: '2d' | '3d'): Promise<void> => {
  dungeon2Ansicht = a;
  if (a === '3d' && dungeon2Vorschau === null) {
    shell.meldung('3D-Vorschau wird geladen …');
    const mod = await import('./dungeon2/Dungeon2Vorschau');
    dungeon2Vorschau = new mod.Dungeon2Vorschau(flaeche, {
      meldung: (t, f) => shell.meldung(t, f),
    });
    const doc = dungeon2Seite.dokument();
    if (doc) dungeon2Vorschau.setzeLayout(dungeon2.layoutVonDokument2(doc));
  }
  const imDungeon2 = betriebsart === 'dungeon2';
  cellCanvas.zeige(imDungeon2 && a === '2d');
  dungeon2Vorschau?.zeige(imDungeon2 && a === '3d');
  baueDungeon2AnsichtSchalter();
};

function baueDungeon2AnsichtSchalter(): void {
  const reihe = el('div', stil({ display: 'flex', gap: '8px' }));
  reihe.append(
    knopf('2D-Grundriss', () => void setzeDungeon2Ansicht('2d'), {
      art: dungeon2Ansicht === '2d' ? 'bronze' : 'flaeche',
    }),
    knopf('3D-Vorschau', () => void setzeDungeon2Ansicht('3d'), {
      art: dungeon2Ansicht === '3d' ? 'bronze' : 'flaeche',
    })
  );
  dungeon2AnsichtSektion.replaceChildren(reihe);
}
baueDungeon2AnsichtSchalter();

// Katalog-Sektionen fuellen (Liste, Dokument, „Neu anlegen"). Wie beim
// LEGACY-`dungeonSeite.baue()`: Der Konstruktor legt nur leere Container an,
// erst `baue()` zeichnet ihren Inhalt.
// Populate the catalogue sections; the constructor only makes empty
// containers, baue() draws their content (like LEGACY dungeonSeite.baue()).
dungeon2Seite.baue();

/**
 * 3-Wege-Sichtbarkeit: Welt-Bearbeitung, LEGACY-Dungeon, Dungeon 2.0.
 *
 * Ersetzt das fruehere `zeigeDungeonBetrieb(an)`: Mit zwei Dungeon-Arten
 * reicht ein Bool nicht mehr. Bloecke werden nach Zugehoerigkeit ein-
 * geblendet (Welt-Bloecke, der LEGACY-Block, unser dungeon2-Container),
 * nicht aufgezaehlt — die naechste Weltsektion taucht so von selbst richtig
 * auf. `sektion()` gibt den INHALT zurueck; der Block samt Kopf ist dessen
 * Elternteil.
 * 3-way visibility: world editing, LEGACY dungeon, Dungeon 2.0.
 */
const zeigeFuerBetrieb = (m: SeitenBetriebsart): void => {
  const welt = m !== 'dungeons' && m !== 'dungeon2';
  vorschau.style.display = welt ? 'block' : 'none';
  overlay.style.display = welt ? 'block' : 'none';
  const imDungeon = m === 'dungeons';
  dungeonGrundriss.zeige(imDungeon && dungeonAnsicht === '2d');
  dungeonVorschau3d?.zeige(imDungeon && dungeonAnsicht === '3d');
  const imDungeon2 = m === 'dungeon2';
  cellCanvas.zeige(imDungeon2 && dungeon2Ansicht === '2d');
  dungeon2Vorschau?.zeige(imDungeon2 && dungeon2Ansicht === '3d');
  const legacyBlock = dungeonSeiteBehaelter.parentElement;
  for (const kind of [...seitenmitteEl.children]) {
    let sichtbar: boolean;
    if (kind === legacyBlock || kind === dungeonAnsichtBlock) sichtbar = imDungeon;
    else if (kind === dungeon2Behaelter) sichtbar = imDungeon2;
    else sichtbar = welt;
    (kind as HTMLElement).style.display = sichtbar ? '' : 'none';
  }
  // Der Leisten-Fuss („Region hinzufuegen" + Papierkorb) handelt von
  // Weltinseln — im Dungeon zielte er auf eine nicht sichtbare Karte.
  shell.seitenfuss.style.display = welt ? '' : 'none';
};

// ── Schwebende Bedienflächen über der Karte (KartenHud.ts) ────────────
// NACH den beiden Zeichenflächen eingehängt: Die Reihenfolge im DOM
// entscheidet, was oben liegt. Der Hud gehört über das Overlay, sonst
// fingen die Zeichenflächen seine Klicks ab.
const WERKZEUG_TEXT: Record<AltesWerkzeugname, string> = {
  auswahl: 'Auswahl',
  form: 'Insel-Form setzen',
  polygon: 'Polygon zeichnen',
};
/** Die Mono-Plakette der Werkzeuganzeige — je Werkzeug die Zahl, die es führt. */
function hudZusatz(): string {
  const registriert = werkzeugMitId(werkzeug);
  if (registriert) return registriert.hudZusatz();
  switch (werkzeug) {
    case 'form':
      return `${FORMEN.find((f) => f.id === gewaehlteForm)?.name ?? ''} ${formGroesse} m`;
    case 'polygon':
      return `${polygonPunkte.length} Punkte`;
    default:
      return `${Math.round(massstab)} m/px`;
  }
}

const hud = new KartenHud(flaeche, {
  aufZoom: (richtung) => {
    massstab = Math.min(200, Math.max(4, massstab * (richtung > 0 ? 1 / 1.2 : 1.2)));
    zeichneOverlay();
    zeichneVorschauBild();
  },
  aufEinpassen: () => {
    const b = layoutBounds(layout);
    mitteX = (b.minX + b.maxX) / 2;
    mitteZ = (b.minZ + b.maxZ) / 2;
    massstab = Math.min(
      200,
      Math.max(
        4,
        Math.max(
          ((b.maxX - b.minX) * 1.1) / Math.max(1, overlay.width),
          ((b.maxZ - b.minZ) * 1.1) / Math.max(1, overlay.height)
        )
      )
    );
    zeichneOverlay();
    zeichneVorschauBild();
  },
  // Der Umschalter ist keine Attrappe: `zeichneOverlay()` liest
  // `hud.ebene` und färbt die Regionen danach ein.
  aufEbene: () => zeichneOverlay(),
  aufRegionAendern: (id, aenderung) => {
    merkeSchritt();
    layout = {
      ...layout,
      regions: layout.regions.map((r) => (r.id === id ? { ...r, ...aenderung } : r)),
    };
    // Eine geänderte Kennung muss die Auswahl mitnehmen, sonst zeigt
    // `gewaehlt` auf eine Region, die es unter dem Namen nicht mehr gibt.
    if (aenderung.id) gewaehlt = aenderung.id;
    alles();
    vorschauAnstossen();
  },
  aufRegionWaehlen: (id) => {
    gewaehlt = id;
    alles();
  },
  aufObjektPlatzieren: () => katalogOeffnen?.(),
  aufMitteSetzen: (wx, wz) => {
    mitteX = wx;
    mitteZ = wz;
    zeichneOverlay();
    zeichneVorschauBild();
  },
});

/**
 * Auf einen Bildlauf je Einzelbild zusammengefasst: `zeichneOverlay()`
 * läuft beim Ziehen der Karte bei JEDER Mausbewegung, und ein voller
 * Hud-Aufbau je Bewegung wäre Verschwendung.
 */
let hudGeplant = false;
function hudAktualisieren(): void {
  if (hudGeplant) return;
  hudGeplant = true;
  requestAnimationFrame(() => {
    hudGeplant = false;
    hud.aktualisiere({
      layout,
      gewaehlt,
      werkzeug,
      werkzeugText: werkzeugMitId(werkzeug)?.titel ?? WERKZEUG_TEXT[werkzeug as AltesWerkzeugname],
      zusatzText: hudZusatz(),
      massstab,
      mitteX,
      mitteZ,
      zuBild,
    });
  });
}

/** Meldungs-Shim: bestehende Aufrufer schreiben weiter .textContent,
 *  die Shell trennt Meldung und Koordinaten (Statusleiste). */
const statuszeile = {
  set textContent(t: string) {
    shell.meldung(t);
  },
};

// ── Koordinaten ──────────────────────────────────────────────────────
function groesseAnpassen(): void {
  for (const c of [vorschau, overlay]) {
    c.width = flaeche.clientWidth;
    c.height = flaeche.clientHeight;
  }
  zeichneOverlay();
  zeichneVorschauBild();
}
window.addEventListener('resize', groesseAnpassen);
shell.aufResize = groesseAnpassen;

const zuWelt = (px: number, py: number): [number, number] => [
  (px - overlay.width / 2) * massstab + mitteX,
  (py - overlay.height / 2) * massstab + mitteZ,
];
const zuBild = (wx: number, wz: number): [number, number] => [
  (wx - mitteX) / massstab + overlay.width / 2,
  (wz - mitteZ) / massstab + overlay.height / 2,
];

// ── Overlay: Formen + Werkzeug-Zustand ───────────────────────────────
/**
 * Farbe der Regionskontur in der gewählten Ansichtsebene.
 *
 * Der Umschalter oben rechts (KartenHud) ist damit kein Zierrat: Er
 * beantwortet drei verschiedene Fragen an dieselbe Karte.
 *   - `biome`  — welches Biom liegt wo? Die Kontur trägt die Biomfarbe.
 *   - `hoehe`  — wie hoch liegt was? Ein Verlauf von Wasserkante nach
 *                Gipfelweiss über `baseLevel × heightScale`. Der Wert ist
 *                normiert (RegionGeo rechnet ihn gegen `DEFAULT_BASE_LEVEL`
 *                des Bioms), 1,0 ist damit das Höchste, was ein Layout
 *                sinnvoll setzt.
 *   - `routen` — wo laufen NPCs und Gewässer? Die Regionen treten zurück,
 *                damit die Linien darüber lesbar werden.
 */
function konturFarbe(r: RegionDef): string {
  if (hud.ebene === 'routen') return F.randKnopf;
  if (hud.ebene === 'hoehe') {
    const h = (r.baseLevel ?? DEFAULT_BASE_LEVEL.get(r.biome) ?? 0.22) * (r.heightScale ?? 1);
    const t = Math.max(0, Math.min(1, h));
    // Wasserkante (gedecktes Blaugrün) → Bronze → Gipfelweiss. Bewusst
    // dieselben drei Töne wie in der Palette, damit die Höhenansicht
    // nicht wie ein fremdes Programm aussieht.
    const von = t < 0.5 ? [30, 90, 110] : [200, 133, 58];
    const nach = t < 0.5 ? [200, 133, 58] : [235, 244, 248];
    const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const m = von.map((v, i) => Math.round(v + (nach[i] - v) * k));
    return `rgb(${m[0]},${m[1]},${m[2]})`;
  }
  return BIOME_FARBE[r.biome];
}

function zeichneOverlay(): void {
  const ctx = overlay.getContext('2d')!;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  for (const r of layout.regions) {
    ctx.strokeStyle = konturFarbe(r);
    ctx.lineWidth = r.id === gewaehlt ? 3 : 1.5;
    ctx.setLineDash(r.id === gewaehlt ? [] : [6, 4]);
    ctx.beginPath();
    if (r.shape.kind === 'circle') {
      const [cx, cy] = zuBild(r.shape.x, r.shape.z);
      ctx.arc(cx, cy, r.shape.radius / massstab, 0, Math.PI * 2);
    } else {
      r.shape.points.forEach(([x, z], i) => {
        const [px, py] = zuBild(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Die Namen der Regionen zeichnet NICHT mehr diese Leinwand, sondern
    // die Beschriftungsebene des Huds: Dort sind sie abschaltbar, tragen
    // den Textschatten des Entwurfs und werden nicht bei jedem
    // Mausschritt neu gesetzt.
  }
  // Griffe der gewählten Region: Mittelpunkt (verschieben), Radius-Handle
  // beim Kreis, jeder Eckpunkt beim Polygon.
  const aktiv = layout.regions.find((r) => r.id === gewaehlt);
  if (aktiv) {
    const punkt = (px: number, py: number, gefuellt: boolean): void => {
      ctx.beginPath();
      ctx.arc(px, py, GRIFF_PX, 0, Math.PI * 2);
      ctx.fillStyle = gefuellt ? F.akzentLicht : 'rgba(240,182,98,0.25)';
      ctx.fill();
      ctx.strokeStyle = F.akzentLicht;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    if (aktiv.shape.kind === 'circle') {
      const [cx, cy] = zuBild(aktiv.shape.x, aktiv.shape.z);
      punkt(cx, cy, true);
      const [rx, ry] = zuBild(aktiv.shape.x + aktiv.shape.radius, aktiv.shape.z);
      punkt(rx, ry, false);
    } else {
      const mx = aktiv.shape.points.reduce((a, p) => a + p[0], 0) / aktiv.shape.points.length;
      const mz = aktiv.shape.points.reduce((a, p) => a + p[1], 0) / aktiv.shape.points.length;
      const [cx, cy] = zuBild(mx, mz);
      punkt(cx, cy, true); // Schwerpunkt = ganze Form verschieben
      for (const [x, z] of aktiv.shape.points) {
        const [px, py] = zuBild(x, z);
        punkt(px, py, false);
      }
    }
  }

  // Flüsse und Seen (Weltbau B) — blau, Breite maßstabsgetreu.
  for (const f of layout.rivers ?? []) {
    ctx.strokeStyle = F.wasserLinie;
    ctx.lineWidth = Math.max(2, f.width / massstab);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    f.points.forEach(([x, z], i) => {
      const [px, py] = zuBild(x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.lineWidth = 1.5;
  }
  for (const l of layout.lakes ?? []) {
    const [cx, cy] = zuBild(l.x, l.z);
    ctx.beginPath();
    ctx.arc(cx, cy, l.radius / massstab, 0, Math.PI * 2);
    ctx.fillStyle = F.wasserFlaeche;
    ctx.fill();
  }
  // Halbfertige Züge der registrierten Werkzeuge (offener Flusslauf): an
  // derselben Stelle der Zeichenreihenfolge wie vorher, und für JEDES
  // Werkzeug, nicht nur das aktive — ein angefangener Fluss bleibt beim
  // Wechsel des Werkzeugs stehen, wie er es immer getan hat.
  for (const w of WERKZEUGE) w.zeichneOverlay?.(werkzeugKontext, ctx);

  // Handplatzierte Objekte als grüne Punkte
  for (const p of layout.placements ?? []) {
    const [px, py] = zuBild(p.x, p.z);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = F.ok;
    ctx.fill();
    if (massstab < 12) {
      ctx.fillStyle = F.ok;
      ctx.font = `10px ${SCHRIFT.text}`;
      ctx.fillText(p.prefab, px + 5, py + 3);
    }
  }
  // Offenes Polygon des Zeichenwerkzeugs
  if (polygonPunkte.length > 0) {
    ctx.strokeStyle = F.akzentLicht;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    polygonPunkte.forEach(([x, z], i) => {
      const [px, py] = zuBild(x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    // Jeder Punkt als kleiner Kreis; der STARTPUNKT größer — ihn
    // anzuklicken schließt das Polygon.
    polygonPunkte.forEach(([x, z], i) => {
      const [px, py] = zuBild(x, z);
      ctx.beginPath();
      ctx.arc(px, py, i === 0 ? 8 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? 'rgba(240,182,98,0.35)' : F.akzentLicht;
      ctx.fill();
      if (i === 0) {
        ctx.strokeStyle = F.akzentLicht;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }
  // Der einzige Aufrufpunkt des Huds: `alles()`, `groesseAnpassen()`,
  // `springeZuRegion()`, Rad-Zoom und Ziehen laufen sämtlich hier durch.
  // Ein zweiter Aufruf in `alles()` wäre doppelt.
  hudAktualisieren();
}

// ── Vorschau über den Karten-Worker ──────────────────────────────────
let worker: Worker | null = null;
let vorschauBild: ImageBitmap | null = null;
let vorschauSpan = 21000;
let neuZeichnenTimer: number | null = null;

function vorschauAnstossen(): void {
  if (neuZeichnenTimer !== null) window.clearTimeout(neuZeichnenTimer);
  neuZeichnenTimer = window.setTimeout(() => {
    neuZeichnenTimer = null;
    vorschauRechnen();
  }, 600);
}

function vorschauRechnen(): void {
  const sauber = sanitizeWorldLayout(layout);
  if (!sauber || sauber.regions.length === 0) {
    vorschauBild = null;
    zeichneVorschauBild();
    statuszeile.textContent = 'Ozean — zeichne eine Region (Werkzeug links).';
    return;
  }
  worker?.terminate();
  worker = new Worker(new URL('../ui/worldmap/mapWorker.ts', import.meta.url), { type: 'module' });
  const b = layoutBounds(sauber);
  const halb = Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minZ), Math.abs(b.maxZ)) + 2000;
  vorschauSpan = halb * 2;
  setzeKartenMasse(vorschauSpan, halb * 0.995);
  worker.onmessage = (e: MessageEvent<MapWorkerMessage>) => {
    const m = e.data;
    if (m.t === 'fortschritt') statuszeile.textContent = m.text;
    if (m.t === 'textur') {
      // slice() liefert garantiert einen (nicht-shared) ArrayBuffer — die
      // ImageData-Signatur verlangt das.
      const px = new Uint8ClampedArray(m.data.buffer.slice(0) as ArrayBuffer);
      const n = Math.sqrt(px.length / 4) | 0;
      void createImageBitmap(new ImageData(px, n, n)).then((bmp) => {
        vorschauBild = bmp;
        zeichneVorschauBild();
        // Fertig — Worker samt RegionGeo-Instanz freigeben (WorldMap-Muster).
        worker?.terminate();
        worker = null;
        statuszeile.textContent = `Vorschau aktuell — ${sauber.regions.length} Region(en), Karte ${(vorschauSpan / 1000).toFixed(1)} km.`;
      });
    }
  };
  worker.postMessage({
    seed: sauber.detailSeed,
    settings: {},
    layout: sauber,
    span: vorschauSpan,
    radius: halb * 0.995,
  });
}

function zeichneVorschauBild(): void {
  const ctx = vorschau.getContext('2d')!;
  // Derselbe Ozeanton, den auch der Viewport der Shell trägt: Die
  // Vorschauleinwand liegt vollflächig darüber, ein abweichender Ton
  // ergäbe eine sichtbare Kante genau dort, wo die Karte anfängt.
  ctx.fillStyle = F.ozean;
  ctx.fillRect(0, 0, vorschau.width, vorschau.height);
  if (!vorschauBild) return;
  // Bild deckt [−span/2, +span/2] der Welt ab → in die aktuelle Ansicht legen.
  const [x0, y0] = zuBild(-vorschauSpan / 2, -vorschauSpan / 2);
  const seite = vorschauSpan / massstab;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(vorschauBild, x0, y0, seite, seite);
}

// ── Maus: Zeichnen, Auswahl, Verschieben, Zoom ───────────────────────
let zieht: { x: number; y: number } | null = null;

overlay.addEventListener('wheel', (e) => {
  e.preventDefault();
  massstab = Math.min(200, Math.max(4, massstab * (e.deltaY > 0 ? 1.2 : 1 / 1.2)));
  zeichneOverlay();
  zeichneVorschauBild();
});

overlay.addEventListener('pointerdown', (e) => {
  const [wx, wz] = zuWelt(e.offsetX, e.offsetY);

  if (startpunktModus) {
    merkeSchritt();
    layout = setzeStartpunkt(layout, startpunktModus, wx, wz);
    const ziel = startpunktModus === 'welt' ? 'Welt-Startpunkt' : 'Kontinent-Spawn';
    startpunktModus = null;
    alles();
    vorschauAnstossen();
    shell.meldung(`${ziel} gesetzt (${Math.round(wx)}, ${Math.round(wz)}).`);
    return;
  }

  // Griff der GEWÄHLTEN Region gepackt? Dann verformen statt neu auswählen.
  const gew = layout.regions.find((r) => r.id === gewaehlt);
  if (gew) {
    const nah = (hx: number, hz: number): boolean => {
      const [px, py] = zuBild(hx, hz);
      return Math.hypot(e.offsetX - px, e.offsetY - py) <= GRIFF_PX + 3;
    };
    if (gew.shape.kind === 'circle') {
      if (nah(gew.shape.x, gew.shape.z)) {
        griff = { regionId: gew.id, art: 'mitte' };
        merkeSchritt();
        return;
      }
      if (nah(gew.shape.x + gew.shape.radius, gew.shape.z)) {
        griff = { regionId: gew.id, art: 'radius' };
        merkeSchritt();
        return;
      }
    } else {
      const mx = gew.shape.points.reduce((a, p) => a + p[0], 0) / gew.shape.points.length;
      const mz = gew.shape.points.reduce((a, p) => a + p[1], 0) / gew.shape.points.length;
      if (nah(mx, mz)) {
        griff = { regionId: gew.id, art: 'mitte' };
        merkeSchritt();
        return;
      }
      for (let i = 0; i < gew.shape.points.length; i++) {
        const [x, z] = gew.shape.points[i]!;
        if (!nah(x, z)) continue;
        // Alt+Klick löscht den Punkt (mindestens 3 müssen bleiben).
        if (e.altKey && gew.shape.points.length > 3) {
          merkeSchritt();
          const punkte = gew.shape.points.filter((_, k) => k !== i);
          layout = {
            ...layout,
            regions: layout.regions.map((r) =>
              r.id === gew.id ? { ...r, shape: { kind: 'polygon', points: punkte } } : r
            ),
          };
          alles();
          vorschauAnstossen();
          shell.meldung('Polygonpunkt entfernt');
          return;
        }
        griff = { regionId: gew.id, art: i };
        merkeSchritt();
        return;
      }
    }
  }

  // Registrierte Werkzeuge zuerst; was sie nicht beanspruchen, fällt auf die
  // alten Zweige und zuletzt auf die Auswahl.
  const ereignis = { weltX: wx, weltZ: wz, shiftKey: e.shiftKey, zeigerId: e.pointerId };
  const registriert = werkzeugMitId(werkzeug);
  if (registriert?.beiZeigerRunter(werkzeugKontext, ereignis)) {
    // Ein Werkzeug mit Zieh-Haken bekommt das Loslassen auch dann, wenn der
    // Zeiger dabei die Karte verlassen hat (über dem Hud, außerhalb des Fensters).
    if (registriert.beiZeigerHoch) {
      try {
        overlay.setPointerCapture(e.pointerId);
      } catch {
        // kein aktiver Zeiger (synthetisches Ereignis): dann eben ohne
      }
    }
    return;
  }

  if (werkzeug === 'form') {
    const form = FORMEN.find((f) => f.id === gewaehlteForm) ?? FORMEN[0]!;
    const region: RegionDef = {
      id: neueId('insel'),
      biome: 'grassland',
      shape: form.erzeuge(wx, wz, formGroesse),
      edgeFalloff: 300,
    };
    merkeSchritt();
    layout = { ...layout, regions: [...layout.regions, region] };
    gewaehlt = region.id;
    // Ein Klick = EINE Insel: danach zurück zur Auswahl, damit der
    // nächste Klick die frische Region bearbeitet statt eine weitere zu
    // setzen (vom Nutzer als störend gemeldet). Shift hält das Werkzeug
    // für Serien aktiv.
    if (!e.shiftKey) werkzeug = 'auswahl';
    alles();
    vorschauAnstossen();
    shell.meldung(
      e.shiftKey
        ? `${region.id} gesetzt — Werkzeug bleibt aktiv (Shift)`
        : `${region.id} gesetzt — Griffe zum Verformen, Shift+Klick für Serien`
    );
    return;
  }
  if (werkzeug === 'polygon') {
    // Klick nahe dem STARTPUNKT schließt das Polygon (klassisches
    // Polygon-Werkzeug) — der Doppelklick ist nur noch eine Abkürzung.
    if (polygonPunkte.length >= 3) {
      const [sx, sz] = polygonPunkte[0]!;
      const [px, py] = zuBild(sx, sz);
      if (Math.hypot(e.offsetX - px, e.offsetY - py) < 12) {
        polygonSchliessen();
        return;
      }
    }
    polygonPunkte.push([Math.round(wx), Math.round(wz)]);
    seiteBauen(); // Punktzähler + Schließen-Knopf aktualisieren
    zeichneOverlay();
    return;
  }
  // Auswahl: oberste Region unter dem Zeiger (Z-Ordnung = Arrayende zuerst)
  for (let i = layout.regions.length - 1; i >= 0; i--) {
    const r = layout.regions[i]!;
    const drin = r.shape.kind === 'circle'
      ? Math.hypot(wx - r.shape.x, wz - r.shape.z) <= r.shape.radius
      : imPolygon(r.shape.points, wx, wz);
    if (drin) {
      gewaehlt = r.id;
      alles();
      return;
    }
  }
  gewaehlt = null;
  zieht = { x: e.offsetX, y: e.offsetY };
  alles();
});
overlay.addEventListener('pointermove', (e) => {
  const [wx, wz] = zuWelt(e.offsetX, e.offsetY);
  werkzeugMitId(werkzeug)?.beiZeigerBewegt?.(werkzeugKontext, { weltX: wx, weltZ: wz, shiftKey: e.shiftKey, zeigerId: e.pointerId });
  if (griff) {
    const region = layout.regions.find((r) => r.id === griff!.regionId);
    if (region) {
      const neueForm = ((): RegionDef['shape'] => {
        if (region.shape.kind === 'circle') {
          if (griff!.art === 'radius') {
            const r = Math.max(8, Math.round(Math.hypot(wx - region.shape.x, wz - region.shape.z)));
            return { ...region.shape, radius: r };
          }
          return { ...region.shape, x: Math.round(wx), z: Math.round(wz) };
        }
        if (griff!.art === 'mitte') {
          // Polygon als Ganzes verschieben: Delta auf alle Punkte.
          const mx = region.shape.points.reduce((a, p) => a + p[0], 0) / region.shape.points.length;
          const mz = region.shape.points.reduce((a, p) => a + p[1], 0) / region.shape.points.length;
          const dx = Math.round(wx - mx);
          const dz = Math.round(wz - mz);
          return {
            kind: 'polygon',
            points: region.shape.points.map(([x, z]) => [x + dx, z + dz] as [number, number]),
          };
        }
        const idx = griff!.art as number;
        return {
          kind: 'polygon',
          points: region.shape.points.map((p, k) =>
            k === idx ? ([Math.round(wx), Math.round(wz)] as [number, number]) : p
          ),
        };
      })();
      layout = {
        ...layout,
        regions: layout.regions.map((r) => (r.id === region.id ? { ...r, shape: neueForm } : r)),
      };
      speichereEntwurf();
      zeichneOverlay();
    }
    return;
  }
  if (zieht) {
    mitteX -= (e.offsetX - zieht.x) * massstab;
    mitteZ -= (e.offsetY - zieht.y) * massstab;
    zieht = { x: e.offsetX, y: e.offsetY };
    zeichneOverlay();
    zeichneVorschauBild();
  }
  shell.koordinaten(`x ${wx.toFixed(0)}   z ${wz.toFixed(0)}   ${massstab.toFixed(0)} m/px`);
});
overlay.addEventListener('pointerup', (e) => {
  zieht = null;
  if (griff) {
    griff = null;
    alles();
    vorschauAnstossen();
  }
  const registriert = werkzeugMitId(werkzeug);
  if (!registriert) return;
  // Losgelassen NICHT über der Karte selbst (Seitenleiste, außerhalb des Fensters, eine schwebende Bedienfläche
  // wie Werkzeuganzeige oder Zoom-Knöpfe): Der Zug endet ohne Wirkung. Dank Pointer-Capture kommt das Loslassen
  // hier an; was der Zeiger wirklich trifft, sagt `elementFromPoint`.
  const drin = document.elementFromPoint(e.clientX, e.clientY) === overlay;
  if (!drin) {
    registriert.beiZeigerAbbruch?.(werkzeugKontext);
    return;
  }
  const [wx, wz] = zuWelt(e.offsetX, e.offsetY);
  registriert.beiZeigerHoch?.(werkzeugKontext, { weltX: wx, weltZ: wz, shiftKey: e.shiftKey, zeigerId: e.pointerId });
});
// Der Browser bricht die Geste ab (Touch/Stift unterbrochen) oder das Capture geht verloren: Zug ohne
// Wirkung beenden. Nach einem normalen Loslassen ist der Zug schon weg, dann tut das nichts.
const zeigerAbbruch = (): void => werkzeugMitId(werkzeug)?.beiZeigerAbbruch?.(werkzeugKontext);
overlay.addEventListener('pointercancel', zeigerAbbruch);
overlay.addEventListener('lostpointercapture', zeigerAbbruch);
// Ein Klick auf eine schwebende Bedienfläche über der Karte (Übersicht, Zoom-Knöpfe, Werkzeuganzeige) erreicht die
// Karte nicht; für das Werkzeug ist es ein Klick „woanders“. Capture-Phase: die Flächen fangen ihre Klicks selbst ab.
flaeche.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target === overlay || overlay.style.display === 'none') return;
    werkzeugMitId(werkzeug)?.beiFlaechenKlick?.(werkzeugKontext);
  },
  true
);
overlay.addEventListener('dblclick', () => {
  polygonSchliessen();
  werkzeugMitId(werkzeug)?.beiDoppelklick?.(werkzeugKontext);
});
// Tasten, die ein Werkzeug außer Escape bekommt: Entf und Rücktaste löschen im Objekt-Werkzeug die
// Auswahl, P und V schalten dort zwischen Setzen und Anwählen. Nie, solange ein Eingabefeld den Fokus
// hat (dort löschen Entf und Rücktaste Text, P und V sind Buchstaben), nicht mit Umschalttasten, nicht
// unter dem Katalog. Was ein Werkzeug mit den Tasten tut, entscheidet es selbst.
const WERKZEUG_TASTEN_CODES: ReadonlySet<string> = new Set(['Delete', 'Backspace', 'KeyP', 'KeyV']);
window.addEventListener('keydown', (e) => {
  if (!WERKZEUG_TASTEN_CODES.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const ziel = e.target;
  if (ziel instanceof HTMLElement && (ziel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName))) return;
  if (katalogIstOffen()) return;
  werkzeugMitId(werkzeug)?.beiTaste?.(werkzeugKontext, e);
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  // Escape beendet Polygon und die registrierten Werkzeuge, die es
  // beanspruchen (Fluss). Dabei fällt JEDER halbfertige Zug weg, nicht nur
  // der des aktiven Werkzeugs — unverändert.
  const beansprucht = werkzeugMitId(werkzeug)?.beiTaste?.(werkzeugKontext, e) === true;
  if (werkzeug !== 'polygon' && !beansprucht) return;
  polygonPunkte = [];
  for (const w of WERKZEUGE) w.abbrechen(werkzeugKontext);
  werkzeug = 'auswahl';
  seiteBauen();
  zeichneOverlay();
});

/**
 * Offenes Polygon in eine Region verwandeln. Drei Wege führen hierher —
 * Klick auf den Startpunkt, Seitenleisten-Knopf, Doppelklick — damit das
 * Schließen nie am Ereignisverhalten eines Browsers scheitert (gemeldet:
 * "wird nicht erkannt, wenn es vollständig ist").
 */
function polygonSchliessen(): void {
  if (werkzeug !== 'polygon') return;
  // Die zwei Einzelklicks eines Doppelklicks legen doppelte Punkte an —
  // aufeinanderfolgende Beinahe-Duplikate (< 1 m) entfernen.
  const punkte = polygonPunkte.filter(
    (p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1]![0], p[1] - a[i - 1]![1]) > 1
  );
  if (punkte.length < 3) {
    statuszeile.textContent = `Polygon braucht mindestens 3 Punkte (aktuell ${punkte.length}).`;
    return;
  }
  const region: RegionDef = {
    id: neueId('land'),
    biome: 'grassland',
    shape: { kind: 'polygon', points: punkte },
    edgeFalloff: 400,
  };
  merkeSchritt(); // das Schliessen war bisher nicht rückgängig zu machen
  layout = { ...layout, regions: [...layout.regions, region] };
  polygonPunkte = [];
  gewaehlt = region.id;
  werkzeug = 'auswahl';
  alles();
  vorschauAnstossen();
}

function imPolygon(pts: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean {
  let innen = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]!;
    const [xj, zj] = pts[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) innen = !innen;
  }
  return innen;
}

// ── Seitenleiste ─────────────────────────────────────────────────────
/**
 * Vollbreiter Knopf der Seitenleiste.
 *
 * Früher trug er seine Farben selbst ('#1d2431' auf '#3a3325'), jetzt
 * ist er der `knopf()` aus design.ts — nur auf Blockbreite gezogen. Die
 * Leiste ist 332 px schmal, und die Bewuchs-Bündel tragen lange
 * Beschriftungen („Mischwald (dichte und lichte Zonen)"); nebeneinander
 * wären sie nicht lesbar.
 */
function breiterKnopf(text: string, cb: () => void, pfad?: string): HTMLButtonElement {
  const b = knopf(text, cb, { hoehe: M.knopfHoeheKlein, pfad });
  b.style.width = '100%';
  b.style.fontSize = '12px';
  // Kein eigener `margin`: Die Behälter setzen ihren Abstand per `gap`
  // (die Shell-Sektion tut es auch). Beides zusammen addierte sich sonst
  // sichtbar auf.
  return b;
}

/** Hinweiszeile unter einem Werkzeug — was der nächste Klick bewirkt. */
const hinweisZeile = (text: string): HTMLDivElement =>
  el('div', stil({ 'font-size': '11px', 'line-height': '1.5', color: F.gedimmt }), text);

/** Die Bausteine, die ein registriertes Werkzeug für seinen Seitenleisten-Block bekommt. */
const seitenHost: SeitenHost = {
  hinweis: hinweisZeile,
  beschriftet: (text, inhalt) => beschriftet(text, inhalt),
  breiterKnopf: (text, cb, pfad) => breiterKnopf(text, cb, pfad),
};

/** Beschriftung im Entwurfsstil über einem Bedienelement. */
function beschriftet(text: string, inhalt: HTMLElement): HTMLDivElement {
  const s = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '5px' }));
  s.append(el('span', beschriftungStil(), text), inhalt);
  return s;
}

// ── Zustand der Seitenleiste ─────────────────────────────────────────
/**
 * `seiteBauen()` baut die Leiste bei jeder Änderung komplett neu — das
 * ist die bestehende Architektur und bleibt so. Alles, was diesen
 * Neuaufbau ÜBERLEBEN muss, liegt deshalb hier im Modul und nicht im
 * DOM: Suchtext, gewählte Filtermarke, aufgeklappte Baumknoten. Genau
 * wie `werkzeug` es seit jeher tut.
 */
type WerkzeugId = Werkzeugname;
type FilterId = 'alle' | 'inseln' | 'gewaesser' | 'objekte' | 'fehler';
type Platzierung = NonNullable<WorldLayout['placements']>[number];
let suchtext = '';
let filterMarke: FilterId = 'alle';
const offeneKnoten = new Set<string>();
/**
 * Nur für die Dauer EINES Neuaufbaus wahr: Wer im Suchfeld tippt, löst
 * `seiteBauen()` aus und verlöre dabei Fokus und Schreibmarke. Die Fahne
 * wird unmittelbar vor dem Neuaufbau gesetzt und danach gelöscht — so
 * holt sich das Suchfeld den Fokus zurück, aber kein anderer Neuaufbau
 * (Kartenklick, Rückgängig, Serverantwort) reisst ihn an sich.
 */
let suchFokus = false;

/**
 * Betriebsart der Symbolspalte (Mockup: Terrain, Gewässer, Objekte,
 * Biome, Routen). Sie ist KEIN eigener Editor-Modus — der Editor hat nur
 * einen: zeichnen. Sie stellt die Seitenleiste auf das ein, worum es
 * gerade geht: Kopftext, Filtermarke und, wo es eindeutig ist, das
 * Werkzeug. „Testflug" ist deshalb auch keine Betriebsart, die stehen
 * bleibt, sondern eine Handlung (s. `testflug()`).
 */
type SeitenBetriebsart =
  | 'terrain'
  | 'gewaesser'
  | 'objekte'
  | 'biome'
  | 'routen'
  | 'dungeons'
  | 'dungeon2';
let betriebsart: SeitenBetriebsart = 'terrain';
const KOPF_JE_BETRIEBSART: Record<SeitenBetriebsart, readonly [string, string]> = {
  terrain: [
    'Terrain & Inseln',
    'Basis ist der Ozean. Formen auf freier See setzen — Rad zoomt, Ziehen verschiebt.',
  ],
  gewaesser: [
    'Gewässer',
    'Fluss als Punktzug, See als Mittelpunkt mit Radius — beide schneiden sich ins Gelände.',
  ],
  objekte: [
    'Objekte',
    'Klick platziert das gewählte Prefab, Klick auf ein Objekt wählt es. Die Liste bündelt die Platzierungen je Insel nach Namen.',
  ],
  biome: [
    'Biome',
    'Das Biom hängt an der Region: Insel in der Liste wählen, Biom in ihren Eigenschaften setzen.',
  ],
  routen: [
    'Routen',
    'NPC-Routen liegen im Weltdokument. Der Karteneditor hat für sie noch keinen eigenen Bereich.',
  ],
  dungeons: [
    'Dungeons',
    'Grundriss von oben. Klick wählt einen Raum, Rad zoomt, Ziehen verschiebt.',
  ],
  dungeon2: [
    'Dungeons 2.0',
    'Gelesen über den Betriebsdienst, gespeichert über den Spielserver. ' +
      'Zellen pinseln oder Räume stempeln — 2D-Grundriss oder 3D-Vorschau.',
  ],
};

/** Kopf der Seitenleiste setzen — Titel und der Satz darunter. */
function seitenkopfSetzen(): void {
  const [titel, text] = KOPF_JE_BETRIEBSART[betriebsart];
  shell.seitenkopf(titel, text);
}

/** Liegt der Punkt in dieser Region? Dieselbe Prüfung wie die Auswahl
 *  auf der Karte — sie ordnet die Platzierungen den Baumknoten zu. */
function inRegion(r: RegionDef, x: number, z: number): boolean {
  return r.shape.kind === 'circle'
    ? Math.hypot(x - r.shape.x, z - r.shape.z) <= r.shape.radius
    : imPolygon(r.shape.points, x, z);
}

/**
 * Platzierungen nach Region und darin nach Prefab bündeln — die Vorlage
 * für die Kinderzeilen des Baums („Birke 8×").
 *
 * 159 Einzelzeilen sind keine Liste, sondern eine Wand; gebündelt sind
 * es vier Zeilen je Insel. Die Zuordnung ist geometrisch, denn das
 * Layout hält an einer Platzierung keine Region-ID — Z-Ordnung wie bei
 * der Auswahl auf der Karte: die zuletzt gezeichnete Region gewinnt.
 * Was in keiner Region liegt, sammelt der Schlüssel '' ein; sonst wäre
 * ein Baum auf freier See unsichtbar und unlöschbar.
 */
function platzierungenBuendeln(): Map<string, Map<string, Platzierung[]>> {
  const gruppen = new Map<string, Map<string, Platzierung[]>>();
  const obenZuerst = [...layout.regions].reverse();
  for (const p of layout.placements ?? []) {
    const schluessel = obenZuerst.find((r) => inRegion(r, p.x, p.z))?.id ?? '';
    let nachPrefab = gruppen.get(schluessel);
    if (!nachPrefab) {
      nachPrefab = new Map<string, Platzierung[]>();
      gruppen.set(schluessel, nachPrefab);
    }
    const liste = nachPrefab.get(p.prefab);
    if (liste) liste.push(p);
    else nachPrefab.set(p.prefab, [p]);
  }
  return gruppen;
}

/** Ansicht auf einen Weltpunkt zentrieren, ohne etwas zu verändern. */
function springeZuPunkt(x: number, z: number): void {
  mitteX = x;
  mitteZ = z;
  zeichneOverlay();
  zeichneVorschauBild();
}

function seiteBauen(): void {
  // Kein eigener Wurzelbehälter: `shell.sektion()` liefert bereits eine
  // Flex-Spalte mit festem Zwischenraum — eine zweite darin wäre eine
  // Ebene ohne Aufgabe (und ihre Abstände addierten sich).
  seite.innerHTML = '';

  const platzierungen = layout.placements ?? [];
  const gewaesser = [...(layout.rivers ?? []), ...(layout.lakes ?? [])];
  // Dieselbe Prüfung wie im Prüfbericht, hier nur zum Zählen und
  // Filtern. Zweimal je Neuaufbau zu rechnen ist billiger als ein
  // Zwischenspeicher, der zwischen `seiteBauen()` und
  // `pruefberichtBauen()` veralten kann — sie läuft synchron über ein
  // Layout unter 200 KB.
  const befunde = pruefeLayout(layout);
  const befundRegionen = new Set(befunde.map((b) => b.wo));
  const buendel = platzierungenBuendeln();

  // ── 1. Zeichenwerkzeuge als Kachelraster ──────────────────────────
  // Vorher vier vollbreite Knöpfe untereinander: vier Zeilen für eine
  // Entscheidung, die man mit einem Blick trifft, und der aktive
  // Zustand stand als Klammersatz IM Knopftext („(aktiv, 3 Punkte)").
  // Als Kachel steht das Sinnbild über der Beschriftung, der aktive
  // Zustand ist eine Fläche mit bronzenem Rand, und der Klammersatz
  // wird zu Zahl und Hinweiszeile darunter.
  const werkzeugWaehlen = (id: WerkzeugId): void => {
    werkzeug = werkzeug === id ? 'auswahl' : id;
    // Unverändert: Das Werkzeug beginnt mit leerem Zug — ein halbes
    // Polygon aus dem letzten Anlauf gehört niemandem.
    if (id === 'polygon') polygonPunkte = [];
    // Ein registriertes Werkzeug beginnt ebenfalls mit leerem Zug (Fluss).
    werkzeugMitId(id)?.abbrechen(werkzeugKontext);
    seiteBauen();
    zeichneOverlay();
  };
  const kachel = (
    id: WerkzeugId,
    label: string,
    pfad: string,
    titel: string,
    zusatz = '',
    breit = false
  ): HTMLDivElement => {
    const an = werkzeug === id;
    const k = el(
      'div',
      stil({
        display: 'flex',
        'flex-direction': 'column',
        gap: '7px',
        padding: '11px 10px',
        'border-radius': `${M.radius}px`,
        cursor: 'pointer',
        'grid-column': breit ? '1 / -1' : null,
        background: an ? F.wahlFlaeche : F.erhoben,
        border: `1px solid ${an ? F.akzent : F.randFeld}`,
        color: an ? F.textHell : F.textRuhig,
      })
    );
    // Sinnbild oben, Beschriftung darunter (Entwurf). Die Zusatzzahl —
    // was früher „(aktiv, 3 Punkte)" im Knopftext war — steht rechts
    // neben der Beschriftung und nur, solange das Werkzeug aktiv ist.
    const unten = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '7px' }));
    unten.appendChild(el('span', stil({ 'font-size': '11.5px', 'font-weight': '500' }), label));
    if (an && zusatz) {
      unten.append(
        luecke(),
        el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.akzentHell }), zusatz)
      );
    }
    k.append(sinnbild(pfad, 17, 1.8), unten);
    k.title = titel;
    if (!an) beiUeberfahren(k, { 'border-color': F.randAktiv, color: F.text });
    k.onclick = () => werkzeugWaehlen(id);
    return k;
  };
  const raster = el('div', stil({ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '8px' }));
  raster.append(
    kachel(
      'form',
      'Insel-Form',
      PFAD.inselForm,
      'Klick setzt eine Insel in der gewählten Form. Shift hält das Werkzeug für Serien aktiv.'
    ),
    kachel(
      'polygon',
      'Polygon',
      PFAD.polygon,
      'Punkte klicken; schließen: Klick auf den Startpunkt, den ✓-Knopf oder Doppelklick. Esc bricht ab.',
      polygonPunkte.length ? `${polygonPunkte.length} P.` : ''
    ),
    // Die letzte Kachel („Objekt platzieren") geht über beide Spalten: Das
    // Mockup zeigt vier Zeichenwerkzeuge, der Editor hat fünf — und es ist
    // der einzige Weg, einen Baum von Hand zu setzen.
    ...WERKZEUGE.map((w) => kachel(w.id, w.kachelName, w.bild, w.kachelTipp, w.kachelZusatz(), w.kachelBreit))
  );
  seite.appendChild(raster);

  // ── 2. Form und Basisgröße ────────────────────────────────────────
  const formZeile = el('div', stil({ display: 'flex', gap: '8px', 'align-items': 'center' }));
  formZeile.append(
    auswahl(
      // Die Glyphe am Namensanfang ('● Kreis') stammt aus der Zeit ohne
      // Sinnbilder; der Punkt links im Feld sagt dasselbe ruhiger. Sie
      // bleibt in `FORMEN` stehen — dort ist sie Daten, hier nur Anzeige.
      FORMEN.map((f) => ({ id: f.id, name: f.name.replace(/^\S+\s+/, '') })),
      gewaehlteForm,
      (id) => {
        gewaehlteForm = id;
        werkzeug = 'form';
        seiteBauen();
      },
      { punkt: F.akzent }
    ),
    feld(
      String(formGroesse),
      (v) => {
        formGroesse = Math.min(20000, Math.max(100, Number(v) || 1500));
        seiteBauen(); // zeigt den geklemmten Wert zurück
      },
      { breite: '104px', mono: true, einheit: 'm', titel: 'Basisgröße in Metern' }
    )
  );
  seite.appendChild(formZeile);

  // ── 2b. Werkzeugabhängige Zusatzfelder ────────────────────────────
  // Inhaltlich unverändert (Grenzen, Vorgaben, Abschluss-Knöpfe), nur
  // in `feld()` gegossen. Sie erscheinen weiterhin NUR beim aktiven
  // Werkzeug: Ein Feld ohne Wirkung ist schlimmer als keins.
  if (werkzeug === 'polygon') {
    const block = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));
    if (polygonPunkte.length >= 3) {
      block.appendChild(
        breiterKnopf(`Polygon schließen (${polygonPunkte.length} Punkte)`, polygonSchliessen, PFAD.haken)
      );
    }
    block.appendChild(
      hinweisZeile(
        'Punkte klicken; schließen: Klick auf den Startpunkt, den ✓-Knopf oder Doppelklick. Esc bricht ab.'
      )
    );
    seite.appendChild(block);
  }
  // Seitenleisten-Block des aktiven registrierten Werkzeugs (Fluss, See).
  const werkzeugBlock = werkzeugMitId(werkzeug)?.seitenleiste?.(werkzeugKontext, seitenHost);
  if (werkzeugBlock) seite.appendChild(werkzeugBlock);

  // ── 3. Suche und Filtermarken ─────────────────────────────────────
  // Neu und ausdrücklich nur ANZEIGE: Die Suche wirft nichts weg, sie
  // blendet aus. Bei 19 Regionen und 159 Platzierungen ist das der
  // Unterschied zwischen Nachschlagen und Suchen.
  const suchFeld = feld(suchtext, (v) => {
    suchtext = v;
    seiteBauen();
  }, { titel: 'Filtert die Liste nach Name und Biom' });
  suchFeld.style.height = '32px';
  const lupe = lupenBild(13);
  lupe.style.color = F.gedimmt2;
  suchFeld.insertBefore(lupe, suchFeld.firstChild);
  const suchEingabe = suchFeld.querySelector('input');
  if (suchEingabe) {
    suchEingabe.placeholder = 'Regionen & Objekte suchen';
    // `onchange` käme erst beim Verlassen des Feldes — eine Suche, die
    // erst auf Enter sucht, fühlt sich kaputt an. Deshalb `oninput`,
    // eingerahmt von der Fokus-Fahne (s. `suchFokus`).
    suchEingabe.oninput = () => {
      suchtext = suchEingabe.value;
      suchFokus = true;
      seiteBauen();
      suchFokus = false;
    };
  }
  seite.appendChild(suchFeld);
  if (suchFokus && suchEingabe) {
    suchEingabe.focus();
    suchEingabe.setSelectionRange(suchEingabe.value.length, suchEingabe.value.length);
  }

  const markenZeile = el('div', stil({ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }));
  const filterSetzen = (f: FilterId): void => {
    filterMarke = f;
    seiteBauen();
  };
  markenZeile.append(
    marke('Alle', filterMarke === 'alle', () => filterSetzen('alle')),
    marke(`Inseln ${layout.regions.length}`, filterMarke === 'inseln', () => filterSetzen('inseln')),
    marke(`Gewässer ${gewaesser.length}`, filterMarke === 'gewaesser', () => filterSetzen('gewaesser')),
    marke(`Objekte ${platzierungen.length}`, filterMarke === 'objekte', () => filterSetzen('objekte')),
    // Dieselbe Zahl wie der Prüfbericht weiter unten — sie steht hier
    // oben, weil man sie sehen soll, ohne die Sektion aufzuklappen.
    marke(`Fehler ${befunde.length}`, filterMarke === 'fehler', () => filterSetzen('fehler'))
  );
  seite.appendChild(markenZeile);

  // ── 4. Regionen und Gewässer als Baum ─────────────────────────────
  const suche = suchtext.trim().toLowerCase();
  const passt = (...felder: string[]): boolean =>
    suche === '' || felder.some((f) => f.toLowerCase().includes(suche));
  const liste = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '1px' }));
  const zeilenStil = (gewaehltJetzt: boolean): string =>
    stil({
      display: 'flex',
      'align-items': 'center',
      gap: '9px',
      height: '32px',
      padding: '0 9px',
      'border-radius': `${M.radiusKlein}px`,
      cursor: 'pointer',
      background: gewaehltJetzt ? F.wahlFlaeche : 'transparent',
      'box-shadow': gewaehltJetzt ? `inset 0 0 0 1px ${F.wahlRand}` : 'none',
    });
  /** Kleines Sinnbild am rechten Rand einer Zeile (Auge, Kreuz). */
  const zeilenKnopf = (pfad: string, titel: string, hoverFarbe: string, bei: () => void): HTMLSpanElement => {
    const s = el(
      'span',
      stil({ display: 'grid', 'place-items': 'center', flex: 'none', color: F.gedimmt3, cursor: 'pointer' })
    );
    s.appendChild(sinnbild(pfad, 13, 2));
    s.title = titel;
    beiUeberfahren(s, { color: hoverFarbe });
    s.onclick = (e) => {
      e.stopPropagation();
      bei();
    };
    return s;
  };
  /**
   * Kinderzeile: ein Prefab-Bündel unter seiner Region. Das Kreuz
   * entfernt das ganze Bündel — vorher gab es je Platzierung ein Kreuz,
   * aber nur für die letzten 30, und schon eine mittlere Insel hat mehr.
   * `merkeSchritt()` davor macht auch den Griff daneben rückgängig.
   */
  const kindZeile = (prefab: string, gruppe: Platzierung[]): HTMLDivElement => {
    const z = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '9px',
        height: '29px',
        'margin-left': '22px',
        padding: '0 9px 0 12px',
        'border-left': `1px solid ${F.rand}`,
        'border-radius': `0 ${M.radiusFeld}px ${M.radiusFeld}px 0`,
        cursor: 'pointer',
      })
    );
    beiUeberfahren(z, { background: F.erhoben });
    z.append(
      el(
        'span',
        stil({
          width: '16px',
          height: '16px',
          flex: 'none',
          'border-radius': '4px',
          background: F.karte,
          border: `1px solid ${F.randKnopf}`,
        })
      ),
      el('span', stil({ 'font-size': '12px', color: F.textRuhig }), prefab),
      luecke(),
      el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.gedimmt3 }), `${gruppe.length}×`),
      zeilenKnopf(PFAD.kreuz, `Alle ${gruppe.length} × ${prefab} hier entfernen (Strg+Z holt sie zurück)`, F.fehler, () => {
        merkeSchritt();
        const raus = new Set<Platzierung>(gruppe);
        layout = { ...layout, placements: (layout.placements ?? []).filter((p) => !raus.has(p)) };
        alles();
        shell.meldung(`${gruppe.length} × ${prefab} entfernt — Strg+Z holt sie zurück.`);
      })
    );
    z.title = 'Ansicht auf die erste Platzierung dieses Bündels zentrieren';
    z.onclick = () => {
      const p = gruppe[0];
      if (p) springeZuPunkt(p.x, p.z);
    };
    return z;
  };

  const zeigeRegionen = filterMarke !== 'gewaesser';
  const zeigeGewaesser = filterMarke === 'alle' || filterMarke === 'gewaesser';
  if (zeigeRegionen) {
    for (const r of layout.regions) {
      const kinder = [...(buendel.get(r.id)?.entries() ?? [])].sort((a, b) => b[1].length - a[1].length);
      if (filterMarke === 'objekte' && kinder.length === 0) continue;
      if (filterMarke === 'fehler' && !befundRegionen.has(r.id)) continue;
      if (!passt(r.id, r.biome)) continue;
      const offen = offeneKnoten.has(r.id);
      const anzahl = kinder.reduce((s, [, g]) => s + g.length, 0);
      const zeile = el('div', zeilenStil(r.id === gewaehlt));
      const pfeil = sinnbild(PFAD.pfeilRechts, 11, 2.6);
      pfeil.style.color = F.gedimmt2;
      pfeil.style.transform = offen ? 'rotate(90deg)' : 'rotate(0deg)';
      pfeil.style.transition = 'transform .15s';
      // Ohne Kinder unsichtbar, aber nicht weg: Sonst rutschten die
      // Namen der leeren Inseln aus der Flucht.
      pfeil.style.opacity = kinder.length ? '1' : '0';
      zeile.append(
        pfeil,
        el(
          'span',
          stil({ width: '9px', height: '9px', 'border-radius': '2px', flex: 'none', background: biomTon(r.biome)[0] })
        ),
        el('span', stil({ 'font-size': '12.5px', color: F.text, 'font-weight': '500' }), r.id),
        el('span', stil({ 'font-size': '11px', color: F.gedimmt2 }), r.biome),
        luecke(),
        el(
          'span',
          stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.gedimmt3 }),
          anzahl ? String(anzahl) : ''
        ),
        zeilenKnopf(PFAD.auge, `Ansicht auf ${r.id} zentrieren`, F.akzentHell, () => springeZuRegion(r.id))
      );
      zeile.onclick = () => {
        // Wie im Entwurf: Ein Klick wählt UND klappt um. Die Auswahl ist
        // dieselbe wie auf der Karte, deshalb `alles()` und nicht nur
        // `seiteBauen()` — das Overlay zeichnet die Griffe mit.
        if (offen) offeneKnoten.delete(r.id);
        else offeneKnoten.add(r.id);
        gewaehlt = r.id;
        alles();
      };
      beiUeberfahren(zeile, { background: r.id === gewaehlt ? F.wahlFlaeche : F.erhoben });
      liste.appendChild(zeile);
      if (offen) for (const [prefab, gruppe] of kinder) liste.appendChild(kindZeile(prefab, gruppe));
    }
  }

  // Platzierungen auf freier See — nur unter „Objekte", denn dort sucht
  // man sie. Ohne diesen Knoten wären sie in keiner Liste enthalten.
  const frei = [...(buendel.get('')?.entries() ?? [])].sort((a, b) => b[1].length - a[1].length);
  if (filterMarke === 'objekte' && frei.length > 0) {
    const offen = offeneKnoten.has('');
    const zeile = el('div', zeilenStil(false));
    const pfeil = sinnbild(PFAD.pfeilRechts, 11, 2.6);
    pfeil.style.color = F.gedimmt2;
    pfeil.style.transform = offen ? 'rotate(90deg)' : 'rotate(0deg)';
    zeile.append(
      pfeil,
      el(
        'span',
        stil({
          width: '9px',
          height: '9px',
          'border-radius': '2px',
          flex: 'none',
          background: F.ozean,
          'box-shadow': `inset 0 0 0 1px ${F.randAktiv}`,
        })
      ),
      el('span', stil({ 'font-size': '12.5px', color: F.text, 'font-weight': '500' }), 'ohne Region'),
      el('span', stil({ 'font-size': '11px', color: F.gedimmt2 }), 'freie See'),
      luecke(),
      el(
        'span',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.gedimmt3 }),
        String(frei.reduce((s, [, g]) => s + g.length, 0))
      )
    );
    zeile.onclick = () => {
      if (offen) offeneKnoten.delete('');
      else offeneKnoten.add('');
      seiteBauen();
    };
    beiUeberfahren(zeile, { background: F.erhoben });
    liste.appendChild(zeile);
    if (offen) for (const [prefab, gruppe] of frei) liste.appendChild(kindZeile(prefab, gruppe));
  }

  if (zeigeGewaesser) {
    for (const w of gewaesser) {
      const istFluss = 'points' in w;
      const art = istFluss ? 'Fluss' : 'See';
      if (!passt(w.id, art)) continue;
      const zeile = el('div', zeilenStil(false));
      zeile.append(
        // Kein Aufklapp-Pfeil, aber sein Platz: Gewässer haben keine
        // Kinder, sollen aber in derselben Flucht stehen wie die Inseln.
        el('span', stil({ width: '11px', flex: 'none' })),
        el(
          'span',
          stil({
            width: '9px',
            height: '9px',
            'border-radius': '2px',
            flex: 'none',
            background: F.ozean,
            'box-shadow': `inset 0 0 0 1px ${F.randAktiv}`,
          })
        ),
        el('span', stil({ 'font-size': '12.5px', color: F.text, 'font-weight': '500' }), w.id),
        el('span', stil({ 'font-size': '11px', color: F.gedimmt2 }), art),
        luecke(),
        el(
          'span',
          stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.gedimmt3 }),
          istFluss ? `${w.points.length} P.` : `${w.radius} m`
        ),
        zeilenKnopf(PFAD.auge, `Ansicht auf ${w.id} zentrieren`, F.akzentHell, () => {
          if ('points' in w) {
            const p = w.points[0];
            if (p) springeZuPunkt(p[0], p[1]);
          } else {
            springeZuPunkt(w.x, w.z);
          }
        }),
        zeilenKnopf(PFAD.kreuz, `${w.id} löschen`, F.fehler, () => {
          merkeSchritt();
          layout = istFluss
            ? { ...layout, rivers: (layout.rivers ?? []).filter((r) => r.id !== w.id) }
            : { ...layout, lakes: (layout.lakes ?? []).filter((l) => l.id !== w.id) };
          alles();
          vorschauAnstossen();
        })
      );
      beiUeberfahren(zeile, { background: F.erhoben });
      liste.appendChild(zeile);
    }
  }

  if (liste.childElementCount === 0) {
    liste.appendChild(
      el(
        'div',
        stil({ 'font-size': '11.5px', color: F.gedimmt2, padding: '10px 9px' }),
        suche ? `Nichts gefunden zu „${suchtext}".` : 'Noch nichts gezeichnet — Werkzeug oben wählen, dann auf die Karte klicken.'
      )
    );
  }
  seite.appendChild(liste);

  // ── 5. Bewuchs der gewählten Region ───────────────────────────────
  //
  // ── Warum hier NICHT mehr alles steht ────────────────────────────
  // Kennung, Biom, Küstensaum, Grundhöhe, Höhenwucht und die drei
  // Kuratierungslisten trägt seit dem Entwurf die schwebende
  // Eigenschaftskarte auf der Karte (KartenHud) — dort, wo man die
  // Region gerade anschaut, statt am anderen Ende des Fensters. Sie
  // doppelt hier stehen zu lassen, hiesse zwei Bedienelemente für
  // denselben Wert: Wer eines benutzt, sähe das andere veralten.
  //
  // Was BLEIBT, ist der Bewuchs: neun Bündel und fünf Regler, die in
  // 296 Pixel Kartenbreite nicht lesbar unterzubringen sind und deren
  // Messwerte in den Kommentaren unten hängen. Die Kuratierungslisten
  // sind in der Karte sogar besser aufgehoben — sie unterscheidet dort
  // „Biom-Standard" von „ausdrücklich keine", was ein leeres Textfeld
  // hier nie konnte.
  const region = layout.regions.find((r) => r.id === gewaehlt);
  if (region) {
    const box = el(
      'div',
      stil({
        display: 'flex',
        'flex-direction': 'column',
        gap: '10px',
        padding: '12px',
        background: F.karte,
        border: `1px solid ${F.randHell}`,
        'border-radius': `${M.radius}px`,
      })
    );
    const kopf = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '9px' }));
    kopf.append(
      el(
        'span',
        stil({ width: '10px', height: '10px', 'border-radius': '3px', flex: 'none', background: biomTon(region.biome)[0] })
      ),
      el('span', stil({ 'font-size': '13.5px', 'font-weight': '600', color: F.textHell }), region.id),
      luecke(),
      marke(region.biome, false)
    );
    box.appendChild(kopf);

    const ersetze = (patch: Partial<RegionDef>): void => {
      merkeSchritt();
      layout = {
        ...layout,
        regions: layout.regions.map((r) => (r.id === region.id ? { ...r, ...patch } : r)),
      };
    };

    // ── Vorlagen (Aufgabe B10) ───────────────────────────────────────
    // Setzt Biom, Progressionsstufe, edgeFalloff und alle Bewuchs-Regler
    // auf einmal (Herleitung der Werte: regionsWerkzeuge.ts) -- und
    // ERSETZT sie vollstaendig statt sie nur zu ergaenzen, sonst
    // mischten sich zwei Vorlagen zu einer dritten, die es so nirgends
    // gibt (dieselbe Ueberlegung wie bei den Bewuchs-Knoepfen unten).
    const vorlagenBlock = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '6px' }));
    vorlagenBlock.appendChild(el('div', stil({ 'font-size': '11px', color: F.gedimmt }), 'Vorlage anwenden'));
    for (const v of REGION_VORLAGEN) {
      const vorlagenKnopf = breiterKnopf(`${v.sinnbild} ${v.name}`, () => {
        merkeSchritt();
        layout = {
          ...layout,
          regions: layout.regions.map((r) => (r.id === region.id ? wendeVorlageAn(r, v) : r)),
        };
        alles();
        vorschauAnstossen();
        shell.meldung(`Vorlage "${v.name}" angewendet — Regler darunter bleiben justierbar.`);
      });
      vorlagenKnopf.title = v.hinweis;
      vorlagenBlock.appendChild(vorlagenKnopf);
    }
    box.appendChild(vorlagenBlock);

    // ── Kontinent (Aufgabe B2) ────────────────────────────────────────
    // Anlegen/Löschen von Kontinenten UND deren eigener Spawn sitzen im
    // Abschnitt „Welt" (unten in der Leiste) -- hier nur die Zuordnung
    // DIESER Region zu einem BESTEHENDEN Kontinenten. Marken statt eines
    // Dropdowns, wie bei der Progressionsstufe in der Eigenschaftskarte
    // (KartenHud): „ohne" ist ein echter dritter Zustand, kein Fehlwert.
    const kontinentBlock = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '6px' }));
    kontinentBlock.appendChild(el('div', stil({ 'font-size': '11px', color: F.gedimmt }), 'Kontinent'));
    if (layout.continents.length === 0) {
      kontinentBlock.appendChild(
        el(
          'div',
          stil({ 'font-size': '10.5px', color: F.gedimmt2 }),
          'Noch keine Kontinente — im Abschnitt „Welt" weiter unten anlegen.'
        )
      );
    } else {
      const marken = el('div', stil({ display: 'flex', gap: '5px', 'flex-wrap': 'wrap' }));
      marken.appendChild(
        marke('ohne', region.continentId === undefined, () => {
          ersetze({ continentId: undefined });
          alles();
          vorschauAnstossen();
        })
      );
      for (const k of layout.continents) {
        marken.appendChild(
          marke(k.name, region.continentId === k.id, () => {
            ersetze({ continentId: k.id });
            alles();
            vorschauAnstossen();
          })
        );
      }
      kontinentBlock.appendChild(marken);
    }
    box.appendChild(kontinentBlock);

    // ── Bewuchs der Insel ────────────────────────────────────────────
    // Drei Zustände, die im Datenmodell schon angelegt sind
    // (RegionDef.vegetation) und sich nur darin unterscheiden, WAS in der
    // Liste steht:
    //
    //   Feld fehlt   → Biom-Standardtabelle (die Originaleinträge)
    //   Liste gefüllt→ exakt diese Einträge, sonst nichts
    //   Liste LEER   → gar keine Vegetation
    //
    // Der letzte Fall ist der unauffälligste und der wichtigste: Ein
    // leeres Array ist truthy, der Filter im ZoneManager wirft damit
    // jeden Eintrag weg (ZoneManager.ts:601). "Ohne Vegetation" braucht
    // deshalb keine Sonderbehandlung — nur einen Knopf, der `[]` setzt.
    //
    // Das Gras bleibt in allen drei Fällen stehen: Es kommt aus dem
    // Clutter-System des Clients (GrassClutter) und hängt am Biom, nicht
    // an dieser Liste.
    //
    // Drei Fragen, in der Reihenfolge, in der man sie beim Gestalten
    // stellt — und jede hat genau ein Bedienelement:
    //
    //   1. WAS waechst hier?     Bündel-Knöpfe (Grasland / Nadelwald / …)
    //   2. WIE VIEL Fläche?      Regler „Waldanteil" (forestDensity)
    //   3. WIE DICHT darauf?     Regler „Bewuchsdichte" (bewuchsDichte)
    //
    // Die Trennung von 2 und 3 ist der Kern: `forestDensity` verschiebt
    // den Waldfaktor und entscheidet, WO Wald ist; `bewuchsDichte`
    // skaliert die Stückzahlen und entscheidet, WIE VIELE Bäume dort
    // stehen. Eine kleine dichte Waldinsel und ein flächiger lichter
    // Hain sind zwei verschiedene Dinge, und mit einer Zahl liessen sie
    // sich nicht auseinanderhalten.
    //
    // Das Freitextfeld darunter bleibt: Es ist die Feinjustierung für
    // alles, was kein Knopf abdeckt.
    const veg = region.vegetation;
    const artenText =
      veg === undefined
        ? 'Biom-Standard'
        : veg.length === 0
          ? 'KEINER (nur Terrain und Gras)'
          : `${veg.length} Arten`;
    const bewuchsBlock = el(
      'div',
      stil({
        display: 'flex',
        'flex-direction': 'column',
        gap: '6px',
        'border-top': `1px solid ${F.randLeise}`,
        'padding-top': '10px',
      })
    );
    bewuchsBlock.appendChild(
      el('div', stil({ 'font-size': '11px', color: F.gedimmt }), `Bewuchs: ${artenText}`)
    );

    // Die Bündel-Knöpfe setzen ein PRESET, nicht nur eine Artenliste:
    // Artenwahl, Waldanteil, Dichte und Körnung ergeben zusammen erst ein
    // Landschaftsbild. Ein Nadelwald mit der Körnung einer Wiese wäre ein
    // Flickenteppich aus Fichteninseln — und genau das soll er nicht sein.
    // Die drei Regler darunter bleiben danach frei justierbar.
    const preset = (
      arten: readonly string[],
      forestDensity: number,
      bewuchsDichte: number,
      waldKoernung: number,
      abstandFaktor: number,
      nester = 0
    ) => () => {
      ersetze({
        vegetation: [...arten],
        forestDensity,
        bewuchsDichte,
        waldKoernung,
        abstandFaktor,
        nester,
      });
      alles();
      vorschauAnstossen();
    };

    // Die vier Werte je Preset sind GEMESSEN, nicht geschätzt — die Zahl
    // dahinter ist die Überschirmung (Kronenfläche je Bodenfläche):
    //
    //   lichter Hain  0.3     man sieht überall Himmel
    //   Wald          0.8     Kronenschluss, Boden bedeckt
    //   Schwarzwald   1.5+    mehrschichtig, dunkel
    bewuchsBlock.appendChild(breiterKnopf(
      '🌾 Grasland (Wiese mit Laubwaldinseln)',
      // Offene Wiese: wenig Waldfläche, feine Körnung, voller Abstand —
      // die Haine sollen als einzelne Gruppen lesbar bleiben.
      preset(GRASLAND_FLORA_NAMEN, 0.9, 1.0, 1.0, 1.0)
    ));
    bewuchsBlock.appendChild(breiterKnopf(
      '🌳🌲 Mischwald (dichte und lichte Zonen)',
      // Der Übergangstyp. Mittlere Körnung und mittlerer Abstand: Es gibt
      // geschlossene Partien UND offene — genau das, was die Staffelung
      // der Waldfenster je Schicht von selbst erzeugt (flora.ts).
      // `nester` 0.8 ist hier das Entscheidende: Es streut auf rund einem
      // Sechstel der Fläche geschlossenen dunklen Nadelwald ein — und hebt
      // dort zugleich die Geländeamplitude (gemessen 4.7 m statt 2.9 m
      // Höhenunterschied auf 20 m). Der dunkle Wald liegt im kupierten
      // Gelände, die offenen Partien bleiben flach.
      preset([...new Set([...GRASLAND_FLORA_NAMEN, ...NADELWALD_FLORA_NAMEN])], 1.1, 1.2, 0.6, 0.75, 0.8)
    ));
    bewuchsBlock.appendChild(breiterKnopf(
      '🌲 Nadelwald (dicht, Überschirmung 1.3)',
      preset(NADELWALD_FLORA_NAMEN, 1.4, 1.5, 0.4, 0.55, 0.5)
    ));
    bewuchsBlock.appendChild(breiterKnopf(
      '🌲🌲 Schwarzwald (sehr dicht und dunkel, 1.9)',
      // Dieselben Arten wie der Nadelwald — was ihn ausmacht, ist allein
      // die Enge: 276 Stämme je Zone statt 192, davon 26 über 18 m.
      preset(NADELWALD_FLORA_NAMEN, 1.7, 2.0, 0.35, 0.45, 0.35)
    ));
    // ── Die drei Biome jenseits von Wiese und Wald ──────────────────
    // Sie kamen am 16.08.2026 dazu, zusammen mit der Umstellung auf
    // ausschliesslich eigene Modelle. Vorher gab es sie nicht als Knopf,
    // und ihre Regionen waren deshalb unkuratiert — was seit der
    // Umstellung heisst: kahl. Ein Bündel ohne Knopf ist ein Bündel, das
    // niemand benutzt.
    bewuchsBlock.appendChild(breiterKnopf(
      '🌿 Sumpf (Weiden, Seggen, nasser Grund)',
      // Nass und schattig, aber nicht geschlossen: Moorbirken und Weiden
      // stehen einzeln, dazwischen steht das Wasser. Deshalb mittlerer
      // Waldanteil bei hoher Bewuchsdichte — der Boden ist voll, die
      // Krone nicht. Feine Körnung, weil ein Bruchwald keine Haine bildet.
      preset(SUMPF_FLORA_NAMEN, 1.0, 1.6, 0.8, 0.7)
    ));
    bewuchsBlock.appendChild(breiterKnopf(
      '🏔 Hoher Norden (karg, weite Abstände)',
      // Kältesteppe, keine Heide. Wenig Wald, wenig Bewuchs, und vor
      // allem WEITE Abstände: Was den Hohen Norden ausmacht, ist der
      // Blick zwischen den Bäumen hindurch. Grosse Körnung, damit die
      // wenigen Kiefern in Gruppen stehen statt gleichmässig verteilt.
      preset(HOCHNORD_FLORA_NAMEN, 0.5, 0.45, 1.4, 1.6)
    ));
    bewuchsBlock.appendChild(breiterKnopf(
      '🌋 Aschewüste (nichts wächst)',
      // Eine leere Liste ist hier eine AUSSAGE, kein vergessenes Feld:
      // Der gesamte eigene Modellbestand ist nordisch-grün, ein
      // Wacholderpolster auf Schlacke wäre die Verlegenheitslösung.
      // Sobald es verkohlte Stümpfe oder Basaltsäulen gibt, gehören sie
      // in ASCHE_FLORA — dieser Knopf trägt sie dann von selbst ein.
      preset(ASCHE_FLORA_NAMEN, 0, 0, 1.0, 1.0)
    ));
    bewuchsBlock.appendChild(breiterKnopf('🌾 Nur Terrain und Gras (kein Bewuchs)', () => {
      ersetze({ vegetation: [] });
      alles();
      vorschauAnstossen();
    }));
    bewuchsBlock.appendChild(breiterKnopf('↩ Biom-Standard', () => {
      ersetze({ vegetation: undefined });
      alles();
      vorschauAnstossen();
    }));
    box.appendChild(bewuchsBlock);

    /**
     * Ein Regler mit Zahl daneben.
     *
     * Bewusst ein Schieber und kein Zahlenfeld: Beide Werte wirken
     * nichtlinear auf das Bild, und man findet sie durch Probieren.
     * `oninput` schreibt beim Ziehen nur die Zahl fort — die
     * Neuberechnung kommt erst beim Loslassen (`onchange`), denn die
     * Vorschau kostet Zeit und beim Ziehen entstünden Dutzende Läufe.
     *
     * Hier steht ausdrücklich NICHT `regler()` aus design.ts: Der meldet
     * jeden Zeigerschritt zurück, und jede Meldung wäre hier ein
     * `merkeSchritt()` plus ein Neuaufbau der Seitenleiste — der Regler
     * würde sich also unter dem Finger wegbauen und die Rückgängig-Kette
     * mit fünfzig Zwischenständen fluten. Das native `<input type=range>`
     * trägt seine Bronze über `accent-color`; das ist die eine
     * CSS-Eigenschaft, die dafür ohne Stilblatt genügt.
     */
    const regler = (
      titel: string,
      wert: number,
      min: number,
      max: number,
      schritt: number,
      hinweis: string,
      cb: (v: number) => void
    ): void => {
      const gruppe = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '5px' }));
      const kopfZeile = el('div', stil({ display: 'flex', 'justify-content': 'space-between' }));
      const zahl = el(
        'span',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '11px', color: F.akzent }),
        wert.toFixed(2)
      );
      kopfZeile.append(el('span', beschriftungStil(), titel), zahl);
      const schieber = el('input', stil({ width: '100%', 'accent-color': F.akzent, cursor: 'pointer' }));
      schieber.type = 'range';
      schieber.min = String(min);
      schieber.max = String(max);
      schieber.step = String(schritt);
      schieber.value = String(wert);
      schieber.title = hinweis;
      schieber.oninput = () => {
        zahl.textContent = Number(schieber.value).toFixed(2);
      };
      schieber.onchange = () => {
        cb(Number(schieber.value));
        alles();
        vorschauAnstossen();
      };
      gruppe.append(kopfZeile, schieber);
      box.appendChild(gruppe);
    };

    regler(
      'Waldanteil (Fläche)',
      region.forestDensity ?? 1,
      0,
      2,
      0.05,
      '0 = fast kahl, 1 = globales Muster, 2 = fast alles Wald. Verschiebt den Waldfaktor.',
      (v) => ersetze({ forestDensity: v === 1 ? undefined : v })
    );
    regler(
      'Bewuchsdichte (Stückzahl)',
      region.bewuchsDichte ?? 1,
      0.1,
      4,
      0.1,
      'Faktor auf die Stückzahl je Art. Der Mindestabstand der Arten bleibt die Grenze.',
      (v) => ersetze({ bewuchsDichte: v === 1 ? undefined : v })
    );
    regler(
      'Baumabstand (Enge)',
      region.abstandFaktor ?? 1,
      0.3,
      2,
      0.05,
      'Faktor auf den Mindestabstand. Kleiner = enger = dichter. Gemessen: 1.0 → 75 Stämme/Zone, 0.55 → 192, 0.45 → 276.',
      (v) => ersetze({ abstandFaktor: v === 1 ? undefined : v })
    );
    regler(
      'Nadelwald-Nester (Binnenvariation)',
      region.nester ?? 0,
      0,
      1,
      0.05,
      'Streut geschlossene dunkle Partien ein UND hebt dort die Geländeamplitude. 0 = gleichmässig, 0.8 ≈ ein Sechstel der Fläche.',
      (v) => ersetze({ nester: v === 0 ? undefined : v })
    );
    regler(
      'Waldkörnung (Flächengröße)',
      region.waldKoernung ?? 1,
      0.2,
      3,
      0.05,
      'Kleiner = grössere zusammenhängende Wälder UND Lichtungen. 1.0 = 217 m am Stück, 0.35 = 613 m, 0.2 = 1098 m (gemessen).',
      (v) => ersetze({ waldKoernung: v === 1 ? undefined : v })
    );

    // Vegetation, Locations und Spawns stehen in der Eigenschaftskarte
    // auf der Karte (Reiter „Biome"). Dort tragen sie zusätzlich die
    // beiden Marken „Standard" und „keine" — der Unterschied, den ein
    // leeres Textfeld an dieser Stelle nie ausdrücken konnte.
    box.appendChild(breiterKnopf('↑ nach oben (überdeckt)', () => {
      const i = layout.regions.findIndex((r) => r.id === region.id);
      if (i < layout.regions.length - 1) {
        const arr = [...layout.regions];
        [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
        merkeSchritt(); // wie jede andere Änderung: rückgängig zu machen
        layout = { ...layout, regions: arr };
        alles(); vorschauAnstossen();
      }
    }));
    // Das Löschen sitzt nicht mehr hier, sondern als Papierkorb im Fuß
    // der Leiste (Mockup): Es ist die einzige Handlung dieser Karte, die
    // etwas wegnimmt, und sie gehört an die Stelle, an der man sie sucht
    // — nicht ans Ende einer Liste aus fünfzehn Knöpfen.
    seite.appendChild(box);
  }

  // ── 6. Fuß der Leiste ─────────────────────────────────────────────
  // Zwei Handlungen an fester Stelle: eine neue Region beginnen und die
  // gewählte wegnehmen. Beide sind unabhängig davon, wie weit die Liste
  // darüber gescrollt ist — genau dafür hat die Shell einen Fuß.
  const neuKnopf = knopf(
    'Region hinzufügen',
    () => {
      // Es gibt keinen Weg, eine Region ohne Ort anzulegen — sie IST
      // ihre Form. Der Knopf legt deshalb keine an, er rüstet den
      // nächsten Kartenklick dafür aus.
      werkzeug = 'form';
      seiteBauen();
      shell.meldung('Insel-Form-Werkzeug aktiv — der nächste Klick auf die Karte setzt die Region.');
    },
    { hoehe: M.knopfHoeheKlein, titel: 'Aktiviert das Insel-Form-Werkzeug; der nächste Klick auf die Karte setzt die Region.' }
  );
  neuKnopf.style.flex = '1';
  neuKnopf.style.justifyContent = 'center';
  neuKnopf.style.fontSize = '12px';
  const loeschKnopf = knopf(
    '',
    () => {
      if (!region) return;
      merkeSchritt();
      layout = { ...layout, regions: layout.regions.filter((r) => r.id !== region.id) };
      gewaehlt = null;
      alles();
      vorschauAnstossen();
    },
    {
      hoehe: M.knopfHoeheKlein,
      pfad: PFAD.muelleimer,
      titel: region ? `${region.id} löschen (Strg+Z macht es rückgängig)` : 'Erst eine Region wählen',
      randHover: F.akzent,
    }
  );
  // Quadratisch und nur das Sinnbild: kein Text, also auch kein
  // Zwischenraum, der ihn von der Mitte wegschöbe.
  loeschKnopf.style.width = `${M.knopfHoeheKlein}px`;
  loeschKnopf.style.gap = '0';
  loeschKnopf.style.padding = '0';
  loeschKnopf.style.justifyContent = 'center';
  loeschKnopf.style.flex = 'none';
  if (!region) {
    loeschKnopf.disabled = true;
    loeschKnopf.style.opacity = '.4';
    loeschKnopf.style.cursor = 'default';
  }
  shell.seitenfuss.replaceChildren(neuKnopf, loeschKnopf);

  // ── 7. Zahlen in die Fußleiste ────────────────────────────────────
  // Dieselbe Kantenlänge, die `vorschauRechnen()` an den Karten-Worker
  // gibt (Hülle plus 2 km Rand) — stünde hier eine andere Zahl, wären es
  // zwei Karten.
  const grenzen = layoutBounds(layout);
  const halb =
    Math.max(
      Math.abs(grenzen.minX),
      Math.abs(grenzen.maxX),
      Math.abs(grenzen.minZ),
      Math.abs(grenzen.maxZ)
    ) + 2000;
  shell.fussZahlen(
    `${layout.regions.length} Regionen · ${platzierungen.length} Platzierungen · ` +
      `Karte ${((halb * 2) / 1000).toFixed(1)} km`
  );
}

// ── Testflug ─────────────────────────────────────────────────────────
/**
 * Öffnet das echte Spiel offline mit dem ENTWURF (localStorage), nicht
 * mit der Serverdatei — er fliegt durch das, was hier gerade gezeichnet
 * ist. Das war schon immer so; seit es zwei Welten gibt, muss man es nur
 * dazusagen, sonst hält man den Flug für eine Ansicht der Live-Welt.
 *
 * Eigene Funktion, weil ihn jetzt zwei Bedienelemente rufen: der Knopf
 * in der Kopfzeile und die Betriebsart „Testflug" der Symbolspalte.
 */
function testflug(): void {
  speichereEntwurf();
  shell.meldung(`Testflug mit dem Entwurf — ${weltName()} bleibt unberührt, bis du speicherst.`);
  window.open('/?offline=1&layout=editor', '_blank');
}

// ── Welt-Wähler in der Kopfzeile ─────────────────────────────────────
/**
 * Links oben: WELCHE Welt ist hier offen? Statuspunkt, Instanzname und
 * der Detail-Seed in Mono — mehr steht nicht drin, weil mehr nicht
 * bekannt ist. Fehlt die Instanz (Betriebsdienst nicht erreichbar),
 * sagt das Feld genau das und trägt die Warnfarbe; es rät nicht „dev".
 *
 * Das Aufklapp-Zeichen des Entwurfs bleibt weg: Es gibt nichts
 * aufzuklappen. Die Instanz ist die des Containers, auf dem der Editor
 * läuft, und kein Menüpunkt. Was der Klick statt dessen tut, ist das
 * Einzige, was hier ehrlich hingehört — den Serverstand neu holen.
 */
let weltHolenLaeuft = false;
function weltFeldBauen(): void {
  const bekannt = welt.instanz !== null;
  const b = knopf(
    welt.instanz ?? 'Instanz unbekannt',
    () => {
      // Zweimal gleichzeitig fragen hiesse zwei Abgleichdialoge
      // übereinander — der zweite beantwortete eine Frage, die der erste
      // schon anders entschieden hat.
      if (weltHolenLaeuft) return;
      weltHolenLaeuft = true;
      void weltAbgleich().finally(() => (weltHolenLaeuft = false));
    },
    { titel: `${weltName()} — anklicken, um den Serverstand neu zu holen.` }
  );
  b.style.fontWeight = '600';
  b.insertBefore(
    el(
      'span',
      stil({
        width: '7px',
        height: '7px',
        'border-radius': '50%',
        flex: 'none',
        background: bekannt ? F.ok : F.warnText,
        'box-shadow': `0 0 8px ${bekannt ? F.ok : F.warnText}`,
      })
    ),
    b.firstChild
  );
  // Der Seed steht nur da, wenn es einen gibt. Ein Platzhalter wäre eine
  // Behauptung über eine Welt, die wir gerade nicht kennen.
  if (layout.detailSeed) {
    b.appendChild(
      el(
        'span',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '11px', color: F.gedimmt, 'font-weight': '400' }),
        layout.detailSeed
      )
    );
  }
  // Die Beschriftung „WELT" gehört dem Rahmen und steht bereits neben
  // diesem Platz — sie hier noch einmal zu setzen, ergäbe „WELT WELT".
  shell.weltFeld.replaceChildren(b);
}

// ── Werkzeugleiste: Welt- und Datei-Aktionen (einmalig) ──────────────
// Reihenfolge und Gruppen wie im Entwurf: erst, was ANSIEHT (Katalog,
// Vorschau, Testflug), dann, was SCHREIBT, dann, was die Weltdatei
// bewegt. „In die Welt speichern" ist der einzige bronzene Knopf der
// ganzen Oberfläche — Bronze heisst hier: Das ändert die Welt auf dem
// Server. Ein zweiter bronzener Knopf daneben wäre keiner mehr.
{
  // Der Katalog legt sich als eigene ANSICHT über den Viewport (er baut
  // seine eigene Babylon-Szene, s. GegenstandsKatalog). Die Karte darunter
  // bleibt unangetastet — Schließen zeigt sie unverändert wieder.
  const HINWEIS = 'Gegenstands-Katalog — Eintrag anklicken, Ziehen dreht, Rad zoomt. Esc schließt.';
  let katalog: GegenstandsKatalog | null = null;
  let katalogLaedt = false;
  const ansicht = shell.toolbarGruppe();
  /**
   * Der Weg vom Katalog zurück auf die Karte. Der Katalog kennt das
   * Weltdokument bewusst nicht (sonst hinge die schwerste Ansicht des
   * Editors am Kartenzustand, und der dynamische `import()` wäre nur
   * noch eine Verzögerung) — er meldet ein Prefab, und hier wird das
   * Platzieren-Werkzeug damit scharf geschaltet.
   */
  const prefabUebernehmen = (prefab: string): void => {
    // Das Werkzeug merkt sich das Prefab auch unter dem Schlüssel, aus dem der
    // 3D-Testflug (Taste B) seines liest — beide Wege sollen dasselbe Objekt meinen.
    platzierenWerkzeug.setzePrefab(prefab);
    platzierenWerkzeug.setzeModus('setzen'); // „Klick auf die Karte setzt es“
    werkzeug = 'platzieren';
    seiteBauen();
    zeichneOverlay();
    shell.meldung(`${prefab} gewählt — Klick auf die Karte setzt es.`);
  };
  const katalogKnopf = knopf(
    'Katalog',
    () => {
      if (katalog) {
        shell.meldung(katalog.umschalten() ? HINWEIS : 'Katalog geschlossen.');
        return;
      }
      // Doppelklick auf den Knopf darf nicht zwei Kataloge anlegen — der
      // Nachladevorgang dauert einen Moment und hat noch kein Fenster, an
      // dem man den Zustand ablesen könnte.
      if (katalogLaedt) return;
      katalogLaedt = true;
      shell.meldung('Katalog wird geladen …');
      void import('./GegenstandsKatalog')
        .then((m) => {
          katalog = new m.GegenstandsKatalog(shell.viewport, prefabUebernehmen);
          katalog.oeffne();
          shell.meldung(HINWEIS);
        })
        .catch((err) => shell.meldung(`Katalog konnte nicht geladen werden: ${String(err)}`, true))
        .finally(() => (katalogLaedt = false));
    },
    { pfad: PFAD.raster, titel: HINWEIS }
  );
  // Der Katalog ist auch von der Eigenschaftskarte auf der Karte aus
  // erreichbar („Objekt platzieren") — dieselbe Handlung, ein Öffner.
  katalogOeffnen = () => katalogKnopf.click();
  katalogIstOffen = () => katalog?.istOffen === true;
  // Das einzige bronzene SINNBILD auf einem Flächenknopf (so der
  // Entwurf): Der Katalog ist die einzige eigene Ansicht, die sich über
  // die Karte legt — der bronzene Strich sagt „hier geht ein Fenster auf".
  (katalogKnopf.firstElementChild as SVGElement | null)?.style.setProperty('color', F.akzent);
  ansicht.appendChild(katalogKnopf);
  ansicht.appendChild(
    knopf('Vorschau neu bauen', vorschauRechnen, {
      pfad: PFAD.neuBauen,
      titel: 'Rechnet die Kartenvorschau sofort neu, statt 0,6 s nach der letzten Änderung.',
    })
  );
  ansicht.appendChild(
    knopf('Testflug', testflug, {
      pfad: PFAD.flug,
      titel: 'Öffnet das Spiel offline mit dem Entwurf. Die Welt auf dem Server bleibt unberührt.',
    })
  );

  const speicherGruppe = shell.toolbarGruppe();
  const sichern = knopf('In die Welt speichern', () => void inDieWeltSpeichern(), {
    art: 'bronze',
    pfad: PFAD.speichern,
  });
  // Der Zustandspunkt sitzt VOR dem Sinnbild und ist meistens gar nicht
  // da: Er erscheint nur, wenn Entwurf und Serverstand auseinanderliegen
  // (gefüllt) oder der Serverstand unbekannt ist (hohl). Geschaltet wird
  // er in `faerbeSpeicherKnopf()`.
  const zustandsPunkt = el('span', stil({ width: '7px', height: '7px', 'border-radius': '50%', flex: 'none' }));
  sichern.insertBefore(zustandsPunkt, sichern.firstChild);
  speicherKnopf = sichern;
  speicherPunkt = zustandsPunkt;
  // Der Textknoten, den `knopf()` als letztes Kind anhängt — nur ihn
  // schreibt `faerbeSpeicherKnopf()` um, damit Punkt und Sinnbild
  // stehen bleiben.
  speicherText = sichern.lastChild as HTMLElement;
  speicherGruppe.appendChild(sichern);
  faerbeSpeicherKnopf();

  // Bewusst eine EIGENE Gruppe neben dem Speicherknopf und nicht daneben
  // in derselben: Speichern schreibt eine Datei, das hier startet einen
  // Dienst neu. Zwei Knoepfe mit sehr verschiedenen Folgen gehoeren nicht
  // nebeneinander, wo man den falschen greift. (Der Entwurf zeigt beide
  // in einer Gruppe; diese Trennung ist älter als er und wiegt schwerer.)
  const testweltGruppe = shell.toolbarGruppe();
  liveKnopf = knopf('Karte live testen', () => void karteLiveTesten(), {
    pfad: PFAD.helm,
    titel: 'Speichert, legt die Weltdatei beiseite und startet den Spielserver mit der frischen Karte neu.',
  });
  zurueckKnopf = knopf('dev-Welt zurückholen', () => void devWeltZurueckholen(), {
    art: 'leise',
    pfad: PFAD.zurueckholen,
    titel: 'Holt die beiseitegelegte Weltdatei zurück und startet den Spielserver neu.',
  });
  testweltGruppe.appendChild(liveKnopf);
  testweltGruppe.appendChild(zurueckKnopf);
  void testweltKnoepfeAktualisieren();

  const datei = shell.toolbarGruppe();
  datei.appendChild(
    knopf(
      'Export',
      () => {
        entwurfExportieren();
        shell.meldung(
          `${exportName()} exportiert — Zielort ist server/data/welten/ auf dem gewünschten Container.`
        );
      },
      { art: 'leise', pfad: PFAD.export, titel: 'Schreibt den Entwurf als JSON in den Download-Ordner.' }
    )
  );
  datei.appendChild(
    knopf(
      'Import',
      () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json';
        inp.onchange = () => {
          const f = inp.files?.[0];
          if (!f) return;
          void f.text().then((t) => {
            let s: WorldLayout | null = null;
            try {
              s = sanitizeWorldLayout(JSON.parse(t));
            } catch { /* kein JSON — fällt in den Fehlerzweig unten */ }
            if (s) {
              // Ohne Schritt wäre der vorige Entwurf nach dem Import nirgends
              // mehr — und die Übernahme-Regel des Verlaufs ginge von einem
              // Stapel aus, der zum angezeigten Stand nicht mehr passt.
              const ringVor = ringStand();
              merkeSchritt(true);
              layout = s;
              gewaehlt = null;
              const grund = alles('import');
              // Ein Import beruht auf KEINEM Serverstand: Die Basis, die der
              // vorige Entwurf hatte, gilt nicht für ihn. Ohne sie geht kein
              // Speichern hinaus (Editor und Testflug), bis der Nutzer im
              // Abgleich-Dialog entschieden hat („Entwurf behalten" = bewusst
              // ersetzen). Steht der Import nicht im Speicher ('fremd', 'voll'),
              // beschreibt die Basis weiter den Entwurf, der dort steht.
              if (entwurfImSpeicher(grund)) setzeEntwurfBasis(null);
              vorschauAnstossen();
              // Ein Import ist ausdrücklich NUR ein Entwurf. Wer eine
              // live.json in einen dev-Editor zieht, hat damit noch nichts
              // umgestellt — deshalb steht hier, welche Welt der
              // Speicherknopf danach treffen würde. Hat der Schreibversuch
              // einen fremden Stand gefunden und übernommen, gilt dessen
              // Meldung (der Import steht dann unter Rückgängig).
              if (grund === 'ok') {
                shell.meldung(
                  `Import übernommen — ${s.regions.length} Region(en), noch nicht gespeichert. Der Import beruht auf keinem ` +
                    `bekannten Serverstand: Zum Speichern nach ${weltName()} zuerst das Feld „WELT" links oben anklicken ` +
                    `(holt den Serverstand, zeigt die Gegenüberstellung), dort „Entwurf behalten" wählen, dann „In die Welt speichern".` +
                    ringHinweis(ringVor)
                );
              }
            } else {
              shell.meldung('Import verworfen — kein gültiges WorldLayout.', true);
            }
          });
        };
        inp.click();
      },
      { art: 'leise', pfad: PFAD.import, titel: 'Liest ein WorldLayout aus einer JSON-Datei als Entwurf ein.' }
    )
  );
}

// ── Eigene Spur (Roadmap B6/B7): Landflaechen-/Ueberlappungsanzeige ──
// Eigener Toolbar-Platz (Kopfzeile) und eigene Seitenleisten-Sektion;
// Rechnung + Darstellung leben komplett in KartenMassAnzeige.ts, hier
// nur die Verdrahtung mit dem laufenden Entwurf.
const kartenMass = baueKartenMassAnzeige(shell);
/** Zentriert die Karte auf einen Weltpunkt, ohne eine Region auszuwaehlen (Klick in der Ueberlappungsliste). */
function kartenMassZentrieren(x: number, z: number): void {
  mitteX = x;
  mitteZ = z;
  zeichneOverlay();
  zeichneVorschauBild();
}
function kartenMassBauen(): void {
  aktualisiereKartenMassAnzeige(kartenMass, layout, kartenMassZentrieren);
}

// ── Betriebsarten der Symbolspalte ───────────────────────────────────
/**
 * Die sechs Einträge des Entwurfs. Fünf davon stellen die SEITENLEISTE
 * ein — Kopftext, Filtermarke und, wo es eindeutig ist, das Werkzeug.
 * Sie sind keine eigenen Editoren, und sie sollen auch nicht so
 * aussehen: Was der Editor nicht kann, bekommt hier keinen Vorbau,
 * sondern einen Satz, der es sagt (s. „Routen").
 *
 * „Testflug" ist die Ausnahme: eine Handlung, kein Zustand. Sie fällt
 * sofort auf die vorige Betriebsart zurück, denn der Flug findet in
 * einem anderen Fenster statt — hier ändert sich nichts.
 */
{
  // Karte, LEGACY-Grundriss und Dungeon-2.0-Ansichten schliessen einander
  // aus; umgeschaltet wird ueber `display` (Massstab/Mitte bleiben erhalten).
  // Die 3-Wege-Sichtbarkeit steht weiter oben als `zeigeFuerBetrieb` — sie
  // muss die dungeon2-Bausteine kennen, die dort entstehen.
  // Map, LEGACY floor plan and Dungeon 2.0 views are mutually exclusive; see
  // `zeigeFuerBetrieb` above.

  const stelleEin = (id: SeitenBetriebsart, filter: FilterId, w?: WerkzeugId): void => {
    betriebsart = id;
    filterMarke = filter;
    if (w) werkzeug = w;
    zeigeFuerBetrieb(id);
    // Die Spalte faerbt sich NICHT von selbst um: `shell.betriebsart()`
    // meldet den Klick nur, damit ein abgelehnter Wechsel die Leiste nicht
    // schon umgestellt hat, bevor er scheitert (Kommentar dort). Hier wird
    // nie abgelehnt -- ohne diese Zeile wechselte der Seitenkopf, waehrend
    // die Spalte fuer immer auf "Terrain" stehen blieb, und die Leiste sah
    // aus, als taete sie nichts.
    shell.setzeBetriebsart(id);
    seitenkopfSetzen();
    seiteBauen();
    zeichneOverlay();
  };
  shell.betriebsart('terrain', 'Terrain', PFAD.terrain, () => stelleEin('terrain', 'inseln', 'auswahl'));
  shell.betriebsart('gewaesser', 'Gewässer', PFAD.gewaesser, () => stelleEin('gewaesser', 'gewaesser'));
  shell.betriebsart('objekte', 'Objekte', PFAD.objekte, () => stelleEin('objekte', 'objekte', 'platzieren'));
  shell.betriebsart('biome', 'Biome', PFAD.biome, () => stelleEin('biome', 'inseln'));
  shell.betriebsart('routen', 'Routen', PFAD.routen, () => {
    stelleEin('routen', 'alle');
    shell.meldung(
      `${layout.routes?.length ?? 0} NPC-Route(n) im Weltdokument — der Karteneditor hat für sie ` +
        'noch keinen eigenen Bereich.'
    );
  });
  shell.betriebsart('dungeons', 'Dungeons', PFAD.dungeons, () => {
    stelleEin('dungeons', 'alle');
    // Beim ERSTEN Oeffnen die Liste holen. Danach nicht mehr von selbst:
    // Wer zwischen Welt und Dungeon hin und her schaltet, will nicht bei
    // jedem Wechsel auf den Betriebsdienst warten — „Liste neu" steht als
    // Knopf daneben.
    void dungeonSeite.laden();
  });
  shell.betriebsart('dungeon2', 'Dungeon 2.0', PFAD.dungeon2, () => {
    stelleEin('dungeon2', 'alle');
    // Wie bei „Dungeons": beim ersten Oeffnen die 2.0-Liste vom
    // Betriebsdienst holen, danach nur auf Knopfdruck.
    // Like "Dungeons": fetch the 2.0 list on first open, then on demand.
    void dungeon2Seite.laden();
  });
  shell.betriebsart('flug', 'Testflug', PFAD.flug, () => {
    testflug();
    shell.setzeBetriebsart(betriebsart);
  });
  shell.setzeBetriebsart(betriebsart);
  seitenkopfSetzen();
  // Startzustand: Welt sichtbar, beide Dungeon-Bereiche verborgen.
  zeigeFuerBetrieb(betriebsart);

  // Fuß der Symbolspalte. Der Entwurf zeigt hier zwei Sinnbilder; das
  // zweite (Zahnrad) hat im Editor kein Gegenstück und bleibt weg.
  // Rückgängig/Wiederherstellen dagegen gibt es wirklich — bisher aber
  // NUR auf der Tastatur, und wer Strg+Z nicht von sich aus probiert,
  // wusste nichts von den fünfzig gemerkten Schritten.
  const spaltenKnopf = (pfad: string, titel: string, bei: () => void): HTMLSpanElement => {
    const s = el(
      'span',
      stil({
        display: 'grid',
        'place-items': 'center',
        width: '28px',
        height: '28px',
        'border-radius': `${M.radiusFeld}px`,
        color: F.gedimmt3,
        cursor: 'pointer',
      })
    );
    s.appendChild(sinnbild(pfad, 17, 1.8));
    s.title = titel;
    beiUeberfahren(s, { color: F.textRuhig, background: F.erhoben });
    s.onclick = bei;
    return s;
  };
  // Zwei vorhandene Pfeilbilder, kein neues: der Doppelbogen für zurück,
  // der einfache für vor. design.ts wird dafür nicht erweitert.
  shell.spaltenFuss.append(
    spaltenKnopf(PFAD.rueckgaengig, 'Rückgängig (Strg+Z)', rueckgaengig),
    spaltenKnopf(PFAD.wuerfeln, 'Wiederherstellen (Strg+Y)', wiederherstellen)
  );
}

// ── Weltdokument: Ziel benennen, Export, Speicherweg ─────────────────

/** „welten/dev.json (Instanz dev)" — für jede Meldung, die ein Ziel nennt. */
function weltName(): string {
  if (!welt.datei && !welt.instanz) return 'die Weltdatei (Instanz unbekannt)';
  return `welten/${welt.datei ?? '?'} (Instanz ${welt.instanz ?? 'unbekannt'})`;
}

/**
 * Dateiname des Exports. Früher hiess das Ergebnis IMMER
 * `worldlayout.json` — der Name der Datei, die es seit dem
 * Instanz-Umbau nicht mehr gibt. Wer beide Welten exportierte, hatte
 * danach zweimal denselben Dateinamen im Download-Ordner und keine
 * Möglichkeit mehr, sie auseinanderzuhalten.
 *
 * Der RÜCKFALL trug den toten Namen bis 17.08.2026 weiter: Schickt der
 * Server keinen Dateinamen mit, hiess der Export wieder
 * `worldlayout.json` — und schickt damit jeden, der ihn später anfasst,
 * eine Datei suchen, die es nicht gibt (sie heisst `welten/dev.json`
 * bzw. `welten/live.json`). Der Rückfall wird jetzt aus der Instanz
 * gebildet; fehlt auch die, sagt der Name das, statt eine Herkunft zu
 * behaupten.
 */
function exportName(): string {
  if (welt.datei) return welt.datei;
  return welt.instanz ? `${welt.instanz}.json` : 'welt-unbekannt.json';
}

function entwurfExportieren(): void {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }));
  a.href = url;
  a.download = exportName();
  a.click();
  // Der Blob hinge sonst bis zum Neuladen im Speicher. Bei einer 56-KB-
  // Welt wäre das egal, aber der Sicherungsknopf im Abgleichdialog kann
  // in einer Sitzung mehrfach gedrückt werden.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Der Speicherknopf trägt die Farbe der Instanz — er ist das
 * Bedienelement, bei dem die Verwechslung wehtut. Auf dev bleibt er, was
 * er war; auf allem anderen nennt er sein Ziel im Text und trägt den
 * Rahmen des Warnbandes.
 *
 * Der Punkt davor beantwortet die zweite Frage, die der Editor bisher
 * offenliess: Steht das, was ich hier sehe, schon auf dem Server? Solange
 * `serverKanon` fehlt, steht dort ein `?` — dann weiss es niemand.
 */
function faerbeSpeicherKnopf(): void {
  // Der Welt-Wähler oben links beantwortet dieselben zwei Fragen
  // (welche Instanz? Serverstand bekannt?) und wird an genau denselben
  // Stellen fällig — deshalb hängt er hier mit dran, statt sich einen
  // zweiten Satz Aufrufer zu suchen.
  weltFeldBauen();
  if (!speicherKnopf) return;
  const farben = shell.instanzFarben;
  const kanonJetzt = JSON.stringify(sanitizeWorldLayout(layout));
  const gleichStand = serverKanon === kanonJetzt;
  const unbekannt = serverKanon === null;
  speicherKnopf.style.borderColor = farben.band;
  if (speicherText) {
    speicherText.textContent = welt.instanz === 'dev' ? 'In die Welt speichern' : `Speichern → ${farben.name}`;
  }
  // Die drei Zustände unverändert, nur nicht mehr als '?' und '●' im
  // Knopftext: Ein Sonderzeichen VOR der Beschriftung schob den ganzen
  // Knopf hin und her, sobald sich der Stand änderte. Jetzt ist es ein
  // Punkt an fester Stelle — gefüllt heisst „weicht ab", hohl heisst
  // „Serverstand unbekannt", weg heisst „deckungsgleich".
  if (speicherPunkt) {
    speicherPunkt.style.display = gleichStand ? 'none' : 'block';
    speicherPunkt.style.background = unbekannt ? 'transparent' : F.aufAkzent;
    speicherPunkt.style.border = unbekannt ? `1.5px solid ${F.aufAkzent}` : 'none';
  }
  speicherKnopf.title =
    `Schreibt ${weltName()} auf dem Server.` +
    (unbekannt
      ? ' — Serverstand unbekannt (hohler Punkt), der Editor kann nicht sagen, was du überschreiben würdest.'
      : gleichStand
        ? ' — Entwurf und Serverstand sind zurzeit identisch.'
        : ' — der Punkt sagt: der Entwurf weicht vom Serverstand ab.');
}

/**
 * „In die Welt speichern".
 *
 * Neu gegenüber Block A/15 sind zwei Riegel VOR dem POST:
 *
 *   1. Ein Dokument ohne Region wird gar nicht erst abgeschickt.
 *      `layoutSchreiben` im Betriebsdienst lehnt es ohnehin ab (Fund aus
 *      Phase 1: `sanitizeWorldLayout` wirft nicht, es klemmt und
 *      verwirft — `regions: 'kein Array'` kam als vollkommen gültiges
 *      Layout mit NULL Regionen heraus und hätte die 56-KB-Welt durch
 *      102 Bytes offene See ersetzt). Hier abzufangen spart nicht den
 *      Fehler, sondern erklärt ihn an der Stelle, an der man ihn noch
 *      versteht.
 *
 *   2. Auf allem ausser `dev` wird nachgefragt, und zwar mit dem FRISCH
 *      geholten Serverstand daneben. Das ist genau der Unfall vom
 *      16.08.2026 (17 Regionen und 164 Platzierungen durch ein
 *      4-Regionen-Testlayout ersetzt) — er wäre an dieser
 *      Gegenüberstellung gescheitert.
 */
async function inDieWeltSpeichern(): Promise<boolean> {
  // Ein anderer Tab (zweiter Editor, Testflug) kann den Entwurf geändert haben,
  // ohne dass das Ereignis schon angekommen ist. Die Basis kommt aus dem
  // Begleitzettel und gehört zum Entwurf im Speicher: Ginge `layout` (ein
  // älterer Stand) mit der Basis eines neueren Entwurfs hinaus, ersetzte er
  // still, was der Nutzer nie gesehen hat. Erst übernehmen, dann speichern.
  if (fremderEntwurfUebernommen()) return false;
  const sauber = sanitizeWorldLayout(layout);
  if (!sauber) {
    shell.meldung('Entwurf ist unbrauchbar — nicht gespeichert.', true);
    return false;
  }
  if (sauber.regions.length === 0) {
    shell.meldung(
      'Der Entwurf enthält keine einzige Region — das wäre offene See. Nicht gespeichert.',
      true
    );
    return false;
  }

  // Basis für den POST: der Serverstand, auf dem der Entwurf beruht. Nach einer
  // bestätigten Frischprüfung ist es der Stand, den der Nutzer eben gesehen hat.
  let basis = entwurfsSpeicher.basisLesen();
  if (welt.instanz !== 'dev') {
    // Frisch holen statt `serverKanon` zu benutzen: Zwischen dem Start
    // des Editors und diesem Klick können Stunden liegen, und in denen
    // kann jemand anders gespeichert haben. Die Nachfrage ist nur so
    // viel wert wie die Zahlen, die sie zeigt.
    const schirm = vorhang(`Serverstand von ${weltName()} wird geprüft …`);
    const stand = await holeWeltdokument();
    schirm.schliessen();
    const koerper = stand.erreichbar
      ? unterschiedsTafel(
          `Du bist im Begriff, ${weltName()} zu überschreiben.\n` +
            'Links steht, was jetzt auf dem Server liegt, rechts dein Entwurf.',
          'Server (wird ersetzt)',
          'dein Entwurf',
          vergleiche(stand.layout, sauber)
        )
      : `Du bist im Begriff, ${weltName()} zu überschreiben — der aktuelle ` +
        `Serverstand liess sich dafür aber nicht lesen:\n${stand.grund}`;
    const wahl = await frage('Wirklich überschreiben?', koerper, [
      { id: 'ab', text: 'Abbrechen', hinweis: 'Es wird nichts geschrieben.', betont: true },
      {
        id: 'ja',
        text: `Ja, ${welt.instanz ?? 'diese Welt'} überschreiben`,
        hinweis: 'Der Betriebsdienst legt vorher eine .bak-Sicherung an.',
        warnung: true,
      },
    ]);
    if (wahl !== 'ja') {
      shell.meldung('Speichern abgebrochen — auf dem Server hat sich nichts geändert.');
      return false;
    }
    // Der Nutzer hat GENAU diesen Stand gesehen und zu ersetzen zugestimmt;
    // mit der alten Basis liefe seine Bestätigung in einen 409 und einen
    // zweiten Dialog.
    // Die Frage dauerte, so lange sie dauerte: Hat ein anderer Tab den Entwurf
    // inzwischen geändert, gilt die Bestätigung nicht für diesen Stand.
    if (fremderEntwurfUebernommen()) return false;
    basis = basisNachBestaetigung(basis, stand);
  }
  // Ohne Basis geht nichts hinaus (der Betriebsdienst lehnt es ohnehin mit 428
  // ab): Der Entwurf beruht auf keinem bekannten Serverstand — erst laden/abgleichen.
  if (basis === null) {
    shell.meldung(BASIS_FEHLT, true);
    return false;
  }

  shell.meldung(`Speichere nach ${weltName()} …`);
  // Mit der Basis des Entwurfs: Hat inzwischen jemand anders gespeichert,
  // antwortet der Server 409, und es wird NICHTS geschrieben.
  const antwort = await schreibeWeltdokument(sauber, basis);
  if (antwort.art === 'ok') {
    shell.meldung(`${antwort.message} — Server neu starten, damit die Welt sie lädt.`);
    // Ab jetzt sind Entwurf und Serverstand deckungsgleich. Ohne diese
    // Zeilen fragte der Abgleich beim nächsten Öffnen nach einem
    // Unterschied, den es nicht mehr gibt — und man lernt, den Dialog
    // wegzuklicken. Genau das darf er nie werden. Der neue Hash ist die
    // Basis des nächsten Speicherns.
    serverKanon = JSON.stringify(sauber);
    // Erst den Entwurf schreiben, dann die Basis weiterschieben — und nur,
    // wenn er wirklich im Speicher steht ('fremd': ein anderer Tab hat ihn
    // inzwischen ersetzt, dessen Basis bleibt).
    if (entwurfImSpeicher(speichereEntwurf('server'))) setzeEntwurfBasis(antwort.hash);
    faerbeSpeicherKnopf();
    return true;
  }
  if (antwort.art === 'veraltet') {
    await veraltetAbgleichen(sauber);
    return false;
  }
  shell.meldung(antwort.message, true);
  return false;
}

/**
 * Nimmt einen Entwurf, den ein anderer Tab seit dem letzten Abgleich
 * geschrieben hat, sofort über (`beiFremdem` zeigt die Meldung). Liefert `true`,
 * wenn das geschah: Dann ist `layout` nicht mehr der Stand, den der Aufrufer
 * gerade speichern wollte, und er bricht ab — mit einem Satz, der sagt warum.
 */
function fremderEntwurfUebernommen(): boolean {
  if (!entwurfsSpeicher.abgleichen()) return false;
  shell.meldung(
    'Nicht gespeichert: Ein anderer Tab hat den Entwurf inzwischen geändert und wurde übernommen — ' +
      'bitte prüfen und dann erneut speichern.',
    true
  );
  return true;
}

/**
 * Der Server hat die Basis des Editors abgelehnt (409): Jemand anders hat
 * die Welt seit dem Laden gespeichert. Statt zu überschreiben, holt der
 * Editor den aktuellen Stand und zeigt dieselbe Gegenüberstellung wie beim
 * Start (weltdokument.vergleiche, AbgleichDialog). Beide Antworten sind
 * bewusst: den Serverstand laden (der eigene Entwurf bleibt per Strg+Z
 * erreichbar; dann beruht der Entwurf auf ihm) oder den Entwurf behalten —
 * dann ist der gezeigte Serverstand die Basis, und das nächste Speichern
 * (auch aus dem Testflug) ersetzt ihn. Bis zur Antwort im Dialog bleibt die
 * Basis des Entwurfs, wie sie war. Kein Aufruf hier schreibt auf den Server.
 */
async function veraltetAbgleichen(sauber: WorldLayout): Promise<void> {
  const schirm = vorhang(`Aktueller Serverstand von ${weltName()} wird geholt …`);
  const stand = await holeWeltdokument();
  schirm.schliessen();
  if (!stand.erreichbar) {
    shell.meldung(
      `Nicht gespeichert: ${weltName()} hat sich auf dem Server geändert, der aktuelle Stand ` +
        `liess sich aber nicht lesen (${stand.grund}).`,
      true
    );
    return;
  }
  const wahl = await frage(
    'Der Server hat sich geändert',
    unterschiedsTafel(
      `Seit du ${weltName()} geladen hast, wurde die Welt auf dem Server von jemand anderem ` +
        'gespeichert. Es wurde NICHTS geschrieben.\nLinks steht der aktuelle Serverstand, rechts dein Entwurf.',
      `Server (${stand.datei ?? '?'}, aktuell)`,
      'dein Entwurf',
      vergleiche(stand.layout, sauber)
    ),
    [
      {
        id: 'server',
        text: '⬇ Serverstand laden',
        hinweis: 'Dein Entwurf bleibt unter Rückgängig (Strg+Z) erreichbar.',
        betont: true,
      },
      {
        id: 'entwurf',
        text: '✎ Entwurf behalten',
        hinweis: 'Dein Entwurf gilt: Der Serverstand wird beim nächsten Speichern ersetzt — auch aus dem Testflug.',
        warnung: true,
      },
    ],
    { text: '⬇ Entwurf vorher als JSON sichern', tun: entwurfExportieren }
  );
  // Beide Wege haben den aktuellen Serverstand gesehen; die Basis des Entwurfs
  // ändert sich aber erst mit der Entscheidung, und nur so: Serverstand laden
  // → der Entwurf IST er; Entwurf behalten → ausdrücklich der gezeigte Stand.
  serverKanon = JSON.stringify(stand.layout);
  if (wahl === 'server') {
    const ringVor = ringStand();
    merkeSchritt(true);
    layout = stand.layout;
    gewaehlt = null;
    // „Serverstand geladen" nur, wenn er wirklich geladen wurde und nichts
    // Wichtigeres zu melden ist (serverstandFolge, dieselbe Regel wie im
    // Start-Abgleich): Bei einem übernommenen fremden Stand, 'voll' oder
    // 'knapp' steht deren Meldung.
    const grund = alles('server');
    const folge = serverstandFolge(grund);
    if (entwurfImSpeicher(grund)) setzeEntwurfBasis(stand.hash);
    vorschauAnstossen();
    if (folge === 'geladen') {
      shell.meldung(
        `${stand.message} — Serverstand geladen, dein Entwurf liegt unter Rückgängig.` + ringHinweis(ringVor)
      );
    }
    return;
  }
  faerbeSpeicherKnopf();
  // Den behaltenen Entwurf (wie im Start-Abgleich) in den Speicher schreiben: Die
  // Basis beschreibt den Entwurf IM SPEICHER. Steht er dort nicht ('voll') oder hat
  // ein anderer Tab ihn ersetzt ('fremd': über DEN wurde nicht entschieden), gibt es
  // keine Basis, und deren Meldung gilt.
  const behalten = speichereEntwurf(entwurfStandLesen()?.quelle ?? 'bearbeitet');
  if (!entwurfImSpeicher(behalten)) return;
  setzeEntwurfBasis(stand.hash);
  if (behalten === 'ok') shell.meldung(behaltenMeldung(weltName()), true);
}

// ── Karte live testen ────────────────────────────────────────────────
//
// Warum das mehr ist als "Server neu starten": Das Terrain entsteht beim
// Start neu aus dem Layout, aber `ZoneManager` laedt die bereits
// besiedelten Zonen aus dem Weltspeicher. Auf dev sind das 811 Zonen und
// ueber 94.000 ZDOs — man saehe neues Gelaende mit alter Vegetation und
// Haeusern in der Luft, und die geaenderte Insel nur dort richtig, wo man
// nie war. Der Betriebsdienst legt die Weltdatei deshalb beiseite
// (POST /api/testwelt), damit der Server ohne Spielstand startet und
// alles frisch aus dem Layout erzeugt.
//
// Der Editor orchestriert das NICHT selbst: Stoppen, Tauschen und Starten
// muessen zusammenhaengen, und /dienst ist vom Browser aus ohnehin nicht
// erreichbar (der Vorschalter reicht nur /api/ weiter).

type TestweltStand = {
  aktiv: boolean;
  welt: string;
  weltVorhanden: boolean;
  instanz: string;
  zustand?: { aktiv: boolean; seit: string | null };
};

/**
 * Der Rueckhol-Knopf ist nur sichtbar, wenn es etwas zurueckzuholen gibt.
 * Ein dauerhaft sichtbarer Knopf, der meistens "nichts zu tun" sagt, wird
 * genauso schnell ignoriert wie ein Dialog, den man immer wegklickt.
 */
async function testweltKnoepfeAktualisieren(): Promise<void> {
  const stand = await testweltStand();
  const aktiv = Boolean(stand?.aktiv);
  if (zurueckKnopf) zurueckKnopf.style.display = aktiv ? '' : 'none';
  if (liveKnopf) {
    // Der Knopf behält seine Beschriftung. Dass die Testwelt LÄUFT,
    // sagt seit dem Entwurf die pulsierende Marke rechts in der
    // Kopfzeile — beides zu beschriften ergäbe zweimal dieselbe
    // Auskunft nebeneinander, und die auf einem Knopf, der in diesem
    // Zustand gar nichts mehr tut. Sein Zustand steht im Tooltip.
    liveKnopf.title = aktiv
      ? 'Die Testwelt läuft bereits — Zustand siehe Marke rechts in der Kopfzeile.'
      : 'Startet den Spielserver mit dem gespeicherten Kartenstand neu.';
    liveKnopf.disabled = aktiv;
    liveKnopf.style.opacity = aktiv ? '.5' : '1';
    liveKnopf.style.cursor = aktiv ? 'default' : 'pointer';
  }
  testweltMarkeZeigen(stand);
}

/**
 * Die Zustandsmarke rechts in der Kopfzeile (Entwurf: grüner Puls,
 * „Testwelt läuft"). Sie steht dort NUR, wenn wirklich eine Testwelt
 * läuft — eine Marke, die immer da ist, sagt nichts mehr. Die Mono-Zeile
 * daneben nennt die Weltdatei, die dafür beiseitegelegt wurde; die
 * Spieler- und Tageszahlen des Entwurfs bleiben weg, denn die kennt der
 * Editor nicht.
 */
function testweltMarkeZeigen(stand: TestweltStand | null): void {
  if (!stand?.aktiv) {
    shell.kopfRechts.replaceChildren();
    return;
  }
  const plakette = el(
    'div',
    stil({
      display: 'flex',
      'align-items': 'center',
      gap: '7px',
      height: '30px',
      padding: '0 11px',
      background: F.okFlaeche,
      border: `1px solid ${F.okRand}`,
      'border-radius': '999px',
    })
  );
  const punkt = el(
    'span',
    stil({ width: '7px', height: '7px', 'border-radius': '50%', flex: 'none', background: F.ok })
  );
  punkt.className = 'wov-puls';
  plakette.append(
    punkt,
    el('span', stil({ 'font-size': '11.5px', color: F.okText }), 'Testwelt läuft'),
    el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.gedimmt }), stand.welt)
  );
  plakette.title = `Die Weltdatei ${stand.welt} (Instanz ${stand.instanz}) liegt beiseite — „dev-Welt zurückholen" holt sie zurück.`;
  shell.kopfRechts.replaceChildren(plakette);
}

async function testweltStand(): Promise<TestweltStand | null> {
  try {
    const r = await fetch('/api/testwelt');
    if (!r.ok) return null;
    return (await r.json()) as TestweltStand;
  } catch {
    return null;
  }
}

async function testweltSchalten(aktion: 'starten' | 'zurueck'): Promise<void> {
  // Die Server-Konsole ist hier die eigentliche Rueckmeldung: Sie folgt
  // `journalctl -fu wov-server`, also laufen Stop, Start und der komplette
  // Weltaufbau dort ohnehin durch. Ein Wartebalken davor waere nicht nur
  // unnoetig, er wuerde das Einzige verdecken, was zeigt, dass etwas
  // passiert. Deshalb: Konsole aufklappen, eigene Marken hineinschreiben,
  // und der Vorhang meldet nur den Fortschritt.
  shell.konsoleZeigen();
  const marke = aktion === 'starten' ? 'Karte live testen' : 'dev-Welt zurückholen';
  shell.konsoleZeile(`── ${marke}: Weltdatei wird getauscht, wov-server startet neu ──`);
  const basis =
    aktion === 'starten'
      ? 'Welt wird beiseitegelegt, Server startet neu'
      : 'dev-Welt wird zurückgeholt, Server startet neu';
  const schirm = vorhang(`${basis} …`);
  try {
    const r = await fetch('/api/testwelt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aktion }),
    });
    const a = (await r.json()) as { ok?: boolean; message?: string; fehler?: string };
    if (!r.ok || a.fehler) {
      schirm.schliessen();
      shell.konsoleZeile(`── ${marke}: FEHLGESCHLAGEN — ${a.fehler ?? 'unbekannt'} ──`);
      shell.meldung(a.fehler ?? 'Umschalten fehlgeschlagen.', true);
      return;
    }
    // Nicht blind warten, sondern den Dienstzustand fragen. Eine frisch
    // erzeugte Welt braucht laenger als ein normaler Start (Geo,
    // Heightmaps und die ersten Zonen entstehen komplett neu), und wie
    // lange genau haengt an der Karte — eine feste Zahl waere entweder zu
    // kurz oder verschenkte Zeit.
    const start = Date.now();
    let laeuftSeit = 0;
    for (;;) {
      const stand = await testweltStand();
      const laeuft = stand?.zustand?.aktiv ?? false;
      const sek = Math.round((Date.now() - start) / 1000);
      schirm.text(`${basis} … ${sek} s — Dienst ${laeuft ? 'läuft' : 'startet'}`);
      if (laeuft) {
        if (!laeuftSeit) laeuftSeit = Date.now();
        // Kurz nachhalten: `systemctl start` kehrt zurueck, bevor die Welt
        // steht, und ein Restart=always faengt einen Fehlstart wieder ein.
        if (Date.now() - laeuftSeit > 6_000) break;
      } else {
        laeuftSeit = 0;
      }
      if (Date.now() - start > 60_000) break;
      await new Promise((f) => window.setTimeout(f, 1_500));
    }
    schirm.schliessen();
    shell.konsoleZeile(`── ${marke}: fertig nach ${Math.round((Date.now() - start) / 1000)} s ──`);
    shell.meldung(a.message ?? 'Fertig.');
    await testweltKnoepfeAktualisieren();
    if (aktion === 'starten') window.open('/', '_blank');
  } catch (err) {
    schirm.schliessen();
    shell.konsoleZeile(`── ${marke}: FEHLGESCHLAGEN — ${String(err)} ──`);
    shell.meldung(`Umschalten fehlgeschlagen: ${String(err)}`, true);
  }
}

async function karteLiveTesten(): Promise<void> {
  const stand = await testweltStand();
  if (stand?.aktiv) {
    shell.meldung('Es läuft bereits eine Testwelt — erst „dev-Welt zurückholen".', true);
    return;
  }
  const wahl = await frage(
    'Karte live testen?',
    'Das passiert der Reihe nach:\n\n' +
      `1. Dein Entwurf wird nach ${weltName()} gespeichert.\n` +
      `2. Die Weltdatei ${stand?.welt ?? 'der Instanz'} wird gesichert und beiseitegelegt.\n` +
      '3. Der Spielserver startet neu und erzeugt die Karte VOLLSTÄNDIG neu aus dem Layout.\n\n' +
      'Alle Spieler fliegen dabei raus. Gebaute Häuser, Vegetation und Fortschritt der ' +
      'bisherigen Welt sind in der Testwelt nicht vorhanden — sie sind nicht weg, sie ' +
      'liegen daneben und kommen mit „dev-Welt zurückholen" zurück.',
    [
      { id: 'ab', text: 'Abbrechen', hinweis: 'Es wird nichts geschrieben.', betont: true },
      {
        id: 'ja',
        text: 'Speichern, umschalten, neu starten',
        hinweis: 'Der Betriebsdienst sichert die Weltdatei vorher (20 Generationen).',
        warnung: true,
      },
    ]
  );
  if (wahl !== 'ja') {
    shell.meldung('Abgebrochen — es wurde nichts geändert.');
    return;
  }
  const gespeichert = await inDieWeltSpeichern();
  if (!gespeichert) {
    shell.meldung('Layout wurde nicht gespeichert — Testwelt nicht gestartet.', true);
    return;
  }
  await testweltSchalten('starten');
}

async function devWeltZurueckholen(): Promise<void> {
  const stand = await testweltStand();
  if (!stand?.aktiv) {
    shell.meldung('Keine Testwelt aktiv — nichts zurückzuholen.');
    return;
  }
  const wahl = await frage(
    'Zurück zur echten Welt?',
    `Die Testwelt wird als testwelt.db.zst abgelegt und ${stand.welt} wieder aktiviert. ` +
      'Der Spielserver startet dabei neu, alle Spieler fliegen raus.',
    [
      { id: 'ab', text: 'Abbrechen', hinweis: 'Die Testwelt bleibt aktiv.', betont: true },
      { id: 'ja', text: 'Zurückholen und neu starten', hinweis: 'Die Testwelt bleibt als Datei erhalten.' },
    ]
  );
  if (wahl !== 'ja') return;
  await testweltSchalten('zurueck');
}

// ── Prüfbericht (Aufgabe B1) ──────────────────────────────────────────
/**
 * Ansicht auf eine Region zentrieren und sie auswählen — dieselbe
 * Auswahl wie ein Klick in der Regionsliste (`gewaehlt = r.id`), nur
 * dass hier zusätzlich die Karte dorthin schwenkt: Ein Befund kann auf
 * eine Region weit ausserhalb des sichtbaren Ausschnitts zeigen, und
 * reine Auswahl ohne Schwenk liesse den Nutzer raten, wo er suchen muss.
 */
function springeZuRegion(id: string): void {
  const r = layout.regions.find((x) => x.id === id);
  if (!r) return;
  gewaehlt = id;
  const mitte =
    r.shape.kind === 'circle'
      ? { x: r.shape.x, z: r.shape.z }
      : {
          x: r.shape.points.reduce((s, p) => s + p[0], 0) / r.shape.points.length,
          z: r.shape.points.reduce((s, p) => s + p[1], 0) / r.shape.points.length,
        };
  mitteX = mitte.x;
  mitteZ = mitte.z;
  alles();
  zeichneVorschauBild();
}

/**
 * Sprung zu einer einzelnen Platzierung (Befund der Prüfung): Karte auf das
 * Objekt zentrieren, Objekt-Werkzeug aktivieren und das Objekt darin
 * anwählen — Felder, Ziehen und Entf sind dann sofort dran.
 */
function springeZuPlatzierung(id: string): void {
  const p = (layout.placements ?? []).find((q) => q.id === id);
  if (!p) return;
  platzierenWerkzeug.waehle(id);
  werkzeug = 'platzieren';
  mitteX = p.x;
  mitteZ = p.z;
  alles();
  zeichneVorschauBild();
}

/**
 * Baut den Prüfbericht neu — dieselbe Prüfung, die `WovServer.ts:604`
 * beim Serverstart ins journalctl schreibt, hier gegen den GERADE
 * BEARBEITETEN Entwurf statt gegen die zuletzt gestartete Weltdatei.
 * Läuft synchron über `layout` (klein, < 200 KB) und braucht keinen
 * Worker, anders als die Terrain-Vorschau.
 */
/**
 * Baut die Welt-Sektion neu (Aufgabe B2): Startpunkt (defaultSpawn) und
 * Kontinente mit ihrem je eigenen Spawn. `startpunktModus` faengt hier
 * KEINEN eigenen Kartenklick ab -- das tut der `pointerdown`-Handler
 * weiter oben; diese Funktion zeichnet nur den Knopfzustand.
 */
function weltSektionBauen(): void {
  weltSeite.innerHTML = '';

  // ── Startpunkt ─────────────────────────────────────────────────────
  const startBlock = el(
    'div',
    stil({ display: 'flex', 'flex-direction': 'column', gap: '6px', 'margin-bottom': '14px' })
  );
  const spawnText = layout.defaultSpawn
    ? `${Math.round(layout.defaultSpawn[0])}, ${Math.round(layout.defaultSpawn[1])}`
    : 'nicht gesetzt — Spawn liegt am Ursprung';
  startBlock.appendChild(
    el('div', stil({ 'font-size': '11px', color: F.gedimmt }), `Welt-Startpunkt: ${spawnText}`)
  );
  startBlock.appendChild(
    breiterKnopf(
      startpunktModus === 'welt' ? '… nächster Klick auf die Karte' : '🚩 Welt-Startpunkt hier setzen',
      () => {
        startpunktModus = startpunktModus === 'welt' ? null : 'welt';
        weltSektionBauen();
        if (startpunktModus === 'welt') {
          shell.meldung('Startpunkt-Werkzeug aktiv — der nächste Klick auf die Karte setzt den Welt-Startpunkt.');
        }
      }
    )
  );
  if (layout.defaultSpawn) {
    startBlock.appendChild(
      breiterKnopf('Welt-Startpunkt entfernen', () => {
        merkeSchritt();
        layout = { ...layout, defaultSpawn: undefined };
        alles();
        shell.meldung('Welt-Startpunkt entfernt — Spawn liegt wieder am Ursprung, sofern kein Kontinent einen eigenen hat.');
      })
    );
  }
  weltSeite.appendChild(startBlock);

  // ── Kontinente ─────────────────────────────────────────────────────
  weltSeite.appendChild(
    el(
      'div',
      stil({ 'font-size': '11px', color: F.gedimmt, 'margin-bottom': '6px' }),
      `Kontinente (${layout.continents.length})`
    )
  );
  for (const k of layout.continents) {
    const zeile = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '7px 9px',
        background: F.feld,
        border: `1px solid ${F.randFeld}`,
        'border-radius': '7px',
        'margin-bottom': '6px',
      })
    );
    const text = el(
      'div',
      stil({ display: 'flex', 'flex-direction': 'column', gap: '2px', flex: '1', 'min-width': '0' })
    );
    const amKlicken = startpunktModus !== null && startpunktModus !== 'welt' && startpunktModus.continentId === k.id;
    text.append(
      el('span', stil({ 'font-size': '12px', color: F.text }), k.name),
      el(
        'span',
        stil({ 'font-size': '10.5px', color: F.gedimmt2 }),
        `${k.faction ?? 'ohne Fraktion'} · Spawn: ${k.spawn ? `${Math.round(k.spawn[0])}, ${Math.round(k.spawn[1])}` : 'keiner'}`
      )
    );
    zeile.appendChild(text);
    zeile.appendChild(
      knopf(
        amKlicken ? '…' : '🚩',
        () => {
          startpunktModus = amKlicken ? null : { continentId: k.id };
          weltSektionBauen();
          if (startpunktModus !== null) {
            shell.meldung(`Startpunkt-Werkzeug aktiv — der nächste Klick auf die Karte setzt den Spawn von "${k.name}".`);
          }
        },
        { hoehe: M.knopfHoeheKlein, titel: `Spawn von "${k.name}" auf der Karte setzen` }
      )
    );
    zeile.appendChild(
      knopf(
        '',
        () => {
          merkeSchritt();
          layout = kontinentEntfernen(layout, k.id);
          alles();
          shell.meldung(`Kontinent "${k.name}" entfernt.`);
        },
        { hoehe: M.knopfHoeheKlein, pfad: PFAD.muelleimer, titel: `"${k.name}" löschen`, randHover: F.akzent }
      )
    );
    weltSeite.appendChild(zeile);
  }

  // ── Neuer Kontinent ────────────────────────────────────────────────
  const neuBlock = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '6px' }));
  const nameFeld = feld('', () => {}, { breite: '100%', titel: 'Name des neuen Kontinents' });
  const nameEingabe = nameFeld.querySelector('input')!;
  nameEingabe.placeholder = 'Name des neuen Kontinents';
  let neueFraktion: ContinentDef['faction'] | undefined;
  const fraktionAuswahl = auswahl(
    [
      { id: '', name: 'ohne Fraktion' },
      { id: 'saxon', name: 'Angelsachsen' },
      { id: 'viking', name: 'Wikinger' },
      { id: 'neutral', name: 'neutral' },
    ],
    '',
    (v) => {
      neueFraktion = v === '' ? undefined : (v as ContinentDef['faction']);
    }
  );
  neuBlock.append(nameFeld, fraktionAuswahl);
  neuBlock.appendChild(
    breiterKnopf('+ Kontinent anlegen', () => {
      const name = nameEingabe.value;
      if (name.trim().length === 0) {
        shell.meldung('Name fehlt.', true);
        return;
      }
      merkeSchritt();
      layout = kontinentHinzufuegen(layout, { name, faction: neueFraktion });
      alles();
      shell.meldung(`Kontinent "${name.trim()}" angelegt.`);
    })
  );
  weltSeite.appendChild(neuBlock);
  ringSektionBauen();
}

/**
 * „Verdrängte Entwürfe": die letzten Stände, die ein Import, eine Übernahme
 * oder das Verwerfen aus Rückgängig/Wiederherstellen aus dem Verlauf
 * gedrängt hat (höchstens 5, s. `VerdraengtRing`). „Wieder einsetzen" ist
 * eine eigene Änderung mit Undo-Schritt.
 */
function ringSektionBauen(): void {
  const eintraege = ring.liste();
  if (ringVoll > 0) {
    // Bleibt stehen, bis die Seite neu geladen wird: eine gescheiterte Sicherung darf keine später gesetzte Meldung verdecken.
    weltSeite.appendChild(
      el(
        'div',
        stil({ 'font-size': '11px', color: F.warnText, 'margin-top': '16px', 'line-height': '1.5' }),
        `Achtung: ${ringVoll}× konnte ein verdrängter Stand nicht gesichert werden (Speicher voll). Einträge unten zu löschen schafft Platz.`
      )
    );
  }
  if (eintraege.length === 0) return;
  weltSeite.appendChild(
    el(
      'div',
      stil({ 'font-size': '11px', color: F.gedimmt, 'margin-top': '16px', 'margin-bottom': '4px' }),
      `Verdrängte Entwürfe (${eintraege.length})`
    )
  );
  weltSeite.appendChild(
    el(
      'div',
      stil({ 'font-size': '10.5px', color: F.gedimmt2, 'margin-bottom': '8px', 'line-height': '1.5' }),
      'Stände, die eine Übernahme aus einem anderen Tab, ein Import oder das Laden eines Serverstands aus Rückgängig/Wiederherstellen ' +
        'oder von der Anzeige verdrängt hat. Verwirft dagegen eine spätere eigene Änderung den Wiederherstellen-Ast, ist das ' +
        'Standard-Undo und wird nicht gesichert (fremde Stände ausgenommen). Höchstens 5 Einträge; darüber fällt der älteste ' +
        'mit Meldung heraus. „Wieder einsetzen" ist eine eigene Änderung und lässt sich mit Strg+Z zurücknehmen.'
    )
  );
  for (const e of [...eintraege].reverse()) {
    const zeile = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '7px 9px',
        background: F.feld,
        border: `1px solid ${F.randFeld}`,
        'border-radius': '7px',
        'margin-bottom': '6px',
      })
    );
    const text = el(
      'div',
      stil({ display: 'flex', 'flex-direction': 'column', gap: '2px', flex: '1', 'min-width': '0' })
    );
    text.append(
      el(
        'span',
        stil({ 'font-size': '12px', color: F.text }),
        `${e.herkunft === 'fremd' ? 'Aus einem anderen Tab' : 'Eigener Stand'} · ${alter(new Date(e.zeit).toISOString())}`
      ),
      el(
        'span',
        stil({ 'font-size': '10.5px', color: F.gedimmt2 }),
        `${e.regionen} Region(en), ${e.platzierungen} Platzierung(en)`
      )
    );
    zeile.appendChild(text);
    zeile.appendChild(
      knopf(
        'wieder einsetzen',
        () => {
          const ringVor = ringStand();
          merkeSchritt(true);
          layout = e.layout;
          gewaehlt = null;
          const grund = alles();
          vorschauAnstossen();
          if (grund === 'ok') {
            shell.meldung(
              `Verdrängten Entwurf wieder eingesetzt (${e.regionen} Region(en), ${e.platzierungen} Platzierung(en)) — Strg+Z macht es rückgängig.` +
                ringHinweis(ringVor)
            );
          }
        },
        { hoehe: M.knopfHoeheKlein, titel: 'Setzt diesen Stand als Entwurf ein; der jetzige bleibt unter Rückgängig erreichbar.' }
      )
    );
    zeile.appendChild(
      knopf(
        '',
        () => {
          ring.entfernen(e.id);
          weltSektionBauen();
        },
        { hoehe: M.knopfHoeheKlein, pfad: PFAD.muelleimer, titel: 'Aus der Liste entfernen (endgültig)', randHover: F.akzent }
      )
    );
    weltSeite.appendChild(zeile);
  }
}

function pruefberichtBauen(): void {
  pruefSeite.innerHTML = '';
  const befunde = pruefeLayout(layout);
  if (befunde.length === 0) {
    const ok = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '12px', color: F.okText }));
    const haken = sinnbild(PFAD.haken, 12, 2.6);
    ok.append(haken, document.createTextNode('Keine Beanstandungen.'));
    pruefSeite.appendChild(ok);
    return;
  }
  pruefSeite.appendChild(
    el(
      'div',
      beschriftungStil(),
      `${befunde.length} Befund${befunde.length === 1 ? '' : 'e'}`
    )
  );

  // Anklickbar nur, wenn `wo` eine Region DIESES Entwurfs ist oder der Befund
  // eine Platzierung meint (dann wählt der Sprung sie im Objekt-Werkzeug an).
  // Bei 'welt' und Routen-IDs gibt es im 2D-Editor keine Auswahl, zu der man
  // springen könnte.
  //
  // Die Schwere steht nicht mehr als farbiger Balken links, sondern als
  // Punkt vor dem Text: Ein Balken auf der Kante ist bei drei Stufen
  // nicht mehr auseinanderzuhalten, ein Punkt schon — und er lässt den
  // Text an derselben Kante beginnen wie in der Regionsliste daneben.
  const regionIds = new Set(layout.regions.map((r) => r.id));
  const punktFarbe = (schwere: 'fehler' | 'hinweis'): string =>
    schwere === 'fehler' ? F.fehler : F.warnText;
  for (const b of befunde) {
    const platzierung = platzierungZuBefund(layout, b); // nur über `b.ref`, nie aus dem Text
    const anklickbar = regionIds.has(b.wo) || platzierung !== null;
    const zeile = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'flex-start',
        gap: '8px',
        padding: '5px 6px',
        'border-radius': `${M.radiusFeld}px`,
        'font-size': '11px',
        'line-height': '1.45',
        cursor: anklickbar ? 'pointer' : 'default',
      })
    );
    zeile.append(
      el(
        'span',
        stil({
          width: '7px',
          height: '7px',
          'margin-top': '4px',
          'border-radius': '50%',
          flex: 'none',
          background: punktFarbe(befundSchwere(b)),
        })
      ),
      el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.gedimmt3, flex: 'none' }), b.wo),
      el('span', stil({ color: F.textRuhig }), b.text)
    );
    if (anklickbar) {
      zeile.title = platzierung !== null ? `Zu Objekt ${platzierung} springen` : `Zu Region ${b.wo} springen`;
      beiUeberfahren(zeile, { background: F.erhoben });
      zeile.onclick = () => (platzierung !== null ? springeZuPlatzierung(platzierung) : springeZuRegion(b.wo));
    }
    pruefSeite.appendChild(zeile);
  }
}

// ── Server-Konsole (Shell-Dock, journalctl via /api/serverlog) ───────
try {
  const quelle = new EventSource('/api/serverlog');
  quelle.onmessage = (e) => shell.konsoleZeile(JSON.parse(e.data) as string);
  // „Dev-Server prüfen" stimmte, solange der Strom aus einem
  // Vite-Middleware-Plugin kam. Seit Block A/16 liefert ihn der
  // Betriebsdienst (wov-admin) auf BEIDEN Containern — auf live gibt es
  // gar keinen Dev-Server, den man prüfen könnte.
  quelle.onerror = () =>
    shell.konsoleStatus('Verbindung unterbrochen — Betriebsdienst wov-admin prüfen');
} catch {
  shell.konsoleStatus('nicht verfügbar');
}

// ── Abgleich mit dem Server (der Leseweg) ────────────────────────────
/**
 * Holt den Serverstand, benennt die Instanz und löst den Konflikt mit
 * dem Browser-Entwurf — die einzige Stelle, an der `layout` ohne
 * Zutun des Nutzers ersetzt wird.
 *
 * Der Ablauf in Worten, weil die Fallunterscheidung der eigentliche
 * Inhalt dieses Schritts ist:
 *
 *   Server nicht erreichbar  → Instanz bleibt UNBEKANNT (Warnband), der
 *                              Entwurf bleibt stehen, und der Nutzer
 *                              erfährt in einem Dialog, dass er
 *                              blindfliegt. Kein stilles Weiterarbeiten.
 *   kein Entwurf im Browser  → Serverstand, kommentarlos. Es gibt nichts
 *                              zu entscheiden.
 *   Entwurf == Serverstand   → Serverstand, kommentarlos. Ebenso.
 *   Entwurf != Serverstand   → FRAGEN, mit der Gegenüberstellung vor
 *                              Augen. Beide Antworten werfen etwas weg,
 *                              also darf keine von beiden voreingestellt
 *                              sein.
 */
async function weltAbgleich(): Promise<void> {
  const schirm = vorhang('Weltdokument wird vom Server geholt …');
  const stand = await holeWeltdokument();
  schirm.schliessen();

  if (!stand.erreichbar) {
    shell.instanzZeigen(null, null, stand.grund);
    faerbeSpeicherKnopf();
    await frage(
      'Kein Serverstand',
      `Der Editor konnte das Weltdokument nicht laden:\n\n${stand.grund}\n\n` +
        'Du siehst deshalb nur den Entwurf aus diesem Browser, und der Editor kann dir ' +
        'nicht sagen, welche Welt (dev oder live) hinter „In die Welt speichern" steckt. ' +
        'Zeichnen geht; vor dem Speichern sollte der Betriebsdienst wieder laufen.',
      [{ id: 'ok', text: 'Verstanden — nur mit dem Entwurf weiterarbeiten', betont: true }]
    );
    shell.meldung(`Kein Serverstand: ${stand.grund}`, true);
    return;
  }

  welt = { instanz: stand.instanz, datei: stand.datei };
  shell.instanzZeigen(stand.instanz, stand.datei, stand.message);
  faerbeSpeicherKnopf();
  serverKanon = JSON.stringify(stand.layout);
  // Hier wird die Basis des Entwurfs NICHT angefasst: Der Serverstand ist nur
  // geholt und noch nicht entschieden. Bis zur Antwort im Dialog (die auch
  // Stunden dauern kann) beruht der Entwurf weiter auf dem Stand, auf dem er
  // beruhte — der Testflug läuft in dieser Zeit in 409, statt still zu ersetzen.

  // Hat ein anderer Tab seit dem Start den Entwurf geändert, ist das jetzt
  // der Entwurf — sonst behielte „Entwurf behalten" den älteren Stand und
  // schriebe ihn später über den neueren.
  // EIN Zugriff auf den Speicher: nachsehen, übernehmen und lesen — sonst
  // könnte ein fremder Schreibvorgang dazwischenfallen, der danach als
  // „bekannt" gälte, aber nie übernommen wäre.
  const entwurf = entwurfsSpeicher.entwurfNachAbgleich();
  const uebernehmen = (grund: string): void => {
    // Was hier verworfen wird, soll nicht spurlos weg sein: ein Entwurf mit
    // Inhalt (auch ein eben von einem anderen Tab übernommener) bleibt per
    // Strg+Z erreichbar. Der leere Startzustand bekommt keinen Schritt —
    // sonst löschte das erste Strg+Z die frisch geladene Welt.
    const ringVor = ringStand();
    if (brauchtSchrittVorErsetzen(layout, stand.layout)) {
      merkeSchritt(true);
    } else {
      verlauf.ohneSchritt(); // ersetzt ohne Schritt: die Übernahme-Regel beginnt neu
    }
    layout = stand.layout;
    gewaehlt = null;
    // „Serverstand geladen" nur, wenn er wirklich geladen wurde (serverstandFolge):
    //  - 'nicht-geladen': ein anderer Tab hatte den Entwurf geändert und wurde
    //    übernommen; der Serverstand ist NICHT geladen.
    //  - 'stehen-lassen': 'voll' oder 'knapp' — deren Meldung steht schon und
    //    darf weder überschrieben noch mit einer falschen Aussage über einen
    //    anderen Tab überdeckt werden.
    const geschrieben = alles('server');
    const folge = serverstandFolge(geschrieben);
    // Erst JETZT ist Serverinhalt der Entwurf — und beruht auf diesem Stand.
    if (entwurfImSpeicher(geschrieben)) setzeEntwurfBasis(stand.hash);
    vorschauAnstossen();
    if (folge === 'nicht-geladen') {
      shell.meldung(
        'Serverstand NICHT geladen — ein anderer Tab hat den Entwurf zwischenzeitlich geändert; dessen Stand ist übernommen. ' +
          `${weltName()} lässt sich über die Welt-Anzeige erneut holen.` + ringHinweis(ringVor),
        true
      );
      return;
    }
    if (folge === 'stehen-lassen') return;
    shell.meldung(`${stand.message} — ${grund}` + ringHinweis(ringVor));
  };
  if (!entwurf) {
    uebernehmen('vom Server geladen');
    return;
  }
  if (gleich(entwurf, stand.layout)) {
    // Deckungsgleich: trotzdem den Serverstand übernehmen, damit der
    // Begleitzettel auf 'server' steht und die Instanz mitgeschrieben
    // wird. Sonst fragte der nächste Start wieder nach der Herkunft
    // eines Entwurfs, der längst identisch ist.
    uebernehmen('Entwurf im Browser war identisch');
    return;
  }

  const zettel = entwurfStandLesen();
  const fremd = zettel?.instanz && stand.instanz && zettel.instanz !== stand.instanz;
  const einleitung =
    `Der Entwurf in diesem Browser weicht von ${weltName()} ab.\n` +
    (zettel
      ? `Entwurf zuletzt geändert ${alter(zettel.zeit)}` +
        (zettel.quelle === 'import' ? ' (aus einem JSON-Import)' : '') +
        (zettel.instanz ? `, damals offen: Instanz ${zettel.instanz}.` : '.')
      : 'Zum Entwurf gibt es keinen Zeitstempel — er ist älter als diese Editorfassung.') +
    (fremd
      ? `\n\nACHTUNG: Der Entwurf wurde für Instanz ${zettel?.instanz ?? '?'} gezeichnet, ` +
        `offen ist ${stand.instanz}. Ihn zu behalten und zu speichern hiesse, die eine Welt ` +
        'mit der anderen zu überschreiben.'
      : '');

  const wahl = await frage(
    'Serverstand oder dein Entwurf?',
    unterschiedsTafel(einleitung, `Server (${stand.datei ?? '?'})`, 'Entwurf im Browser', vergleiche(stand.layout, entwurf)),
    [
      {
        id: 'server',
        text: '⬇ Serverstand laden',
        hinweis: 'Der Entwurf im Browser wird dabei verworfen.',
        betont: !fremd,
      },
      {
        id: 'entwurf',
        text: '✎ Entwurf behalten',
        hinweis: 'Dein Entwurf gilt: Der Serverstand wird beim nächsten Speichern ersetzt — auch aus dem Testflug.',
        warnung: Boolean(fremd),
      },
    ],
    // Vor der Entscheidung noch einmal alles sichern können. Beide
    // Antworten werfen etwas weg; dieser Knopf ist der einzige Ausgang,
    // der das nicht tut.
    { text: '⬇ Entwurf vorher als JSON sichern', tun: entwurfExportieren }
  );

  if (wahl === 'server') {
    uebernehmen('Entwurf im Browser verworfen');
    return;
  }
  // Entwurf behalten: nichts an `layout` ändern, aber den Begleitzettel
  // auf die JETZT offene Instanz umschreiben — sonst warnte der nächste
  // Start weiter vor einer Instanz-Verwechslung, die der Nutzer bereits
  // gesehen und bewusst in Kauf genommen hat.
  const behalten = speichereEntwurf(zettel?.quelle ?? 'bearbeitet');
  // Ausdrückliche Entscheidung des Nutzers: Ab jetzt ist der gezeigte Serverstand
  // die Basis des Entwurfs, und das nächste Speichern (auch aus dem Testflug)
  // ersetzt ihn. NUR der Stand, den der Dialog gezeigt hat (`stand.hash`) — hat
  // inzwischen jemand noch etwas gespeichert, bleibt das ein 409. Steht der
  // Entwurf nicht im Speicher ('voll') oder hat ein anderer Tab ihn ersetzt
  // ('fremd': darüber wurde hier nicht entschieden): keine Basis, deren
  // Meldung gilt.
  if (!entwurfImSpeicher(behalten)) return;
  setzeEntwurfBasis(stand.hash);
  if (behalten === 'ok') {
    shell.meldung(behaltenMeldung(weltName()), true);
  }
}
/** Was nach „Entwurf behalten" gesagt wird: der Serverstand wird beim nächsten Speichern ersetzt. */
function behaltenMeldung(welt: string): string {
  return (
    `Entwurf behalten — ${welt} auf dem Server bleibt vorerst unverändert, wird aber beim nächsten ` +
    'Speichern (auch aus dem Testflug) durch deinen Entwurf ersetzt.'
  );
}

// ── Start ────────────────────────────────────────────────────────────
groesseAnpassen();
seiteBauen();
pruefberichtBauen();
weltSektionBauen(); // B2 -- ohne diesen Aufruf bleibt die "Welt"-Sektion leer,
// bis alles() das erste Mal laeuft (z.B. wenn der Nutzer im
// Abgleich-Dialog "Entwurf behalten" waehlt oder der Server nicht
// erreichbar ist -- dort wird alles() nie aufgerufen).
kartenMassBauen(); // B6/B7 -- eigene Spur, siehe KartenMassAnzeige.ts
vorschauRechnen();
// Kein `await` auf oberster Ebene: Der Aufbau oben ist synchron und
// fertig, der Vorhang in `weltAbgleich` deckt das Fenster ab, bis der
// Serverstand feststeht.
void weltAbgleich();
