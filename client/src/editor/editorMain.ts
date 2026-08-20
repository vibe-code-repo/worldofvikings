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
  FOLIAGE,
  GRASLAND_FLORA_NAMEN,
  NADELWALD_FLORA_NAMEN,
  SUMPF_FLORA_NAMEN,
  HOCHNORD_FLORA_NAMEN,
  ASCHE_FLORA_NAMEN,
  type BiomeName,
  type RegionDef,
  type WorldLayout,
} from '@wov/shared';
import { setzeKartenMasse, type MapWorkerMessage } from '../ui/worldmap/mapTypes';
import { EditorShell } from './Shell';
import { befundSchwere } from './befundSchwere';
import {
  alter,
  entwurfLesen,
  entwurfSchreiben,
  entwurfStandLesen,
  gleich,
  holeWeltdokument,
  leeresLayout,
  vergleiche,
  type EntwurfsQuelle,
} from './weltdokument';
import { frage, unterschiedsTafel, vorhang } from './AbgleichDialog';
// NUR der Typ: Der Katalog selbst kommt per dynamischem import() erst beim
// ersten Öffnen (s. Werkzeugleiste). Statisch eingebunden zöge er Babylon
// samt GLB-Ladern in den Erststart des Karteneditors — gut zwei Megabyte
// für eine Ansicht, die man vielleicht nie aufschlägt.
import type { GegenstandsKatalog } from './GegenstandsKatalog';
// Die schwebenden Bedienflächen über der Karte (Werkzeuganzeige, Zoom,
// Ebenen, Übersicht, Eigenschaftskarte). Statisch eingebunden, weil sie
// nichts nachladen — sie zeichnen nur DOM über den beiden Leinwänden.
import { KartenHud, type Werkzeugname } from './KartenHud';
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
let gewaehlt: string | null = null;
let werkzeug: 'auswahl' | 'form' | 'polygon' | 'platzieren' | 'fluss' | 'see' = 'auswahl';
/** Offener Flusslauf (Weltbau B) + Breite/Tiefe des Werkzeugs. */
let flussPunkte: [number, number][] = [];
let flussBreite = 40;
let flussTiefe = 8;
/**
 * Radius/Tiefe des See-Werkzeugs (Aufgabe B5). Ein See ist Mittelpunkt +
 * Radius (LakeDef), kein Punktzug wie der Fluss — ein Klick setzt ihn
 * fertig, es gibt kein "Abschließen". Vorgaben wie `sanitizeWorldLayout`
 * sie einem See ohne Angabe zuweist (radius 200, depth 8), damit ein per
 * Feld unverändert gesetzter See exakt das ergibt, was die Sanitisierung
 * ohnehin annähme.
 */
let seeRadius = 200;
let seeTiefe = 8;
/** Gewählte vordefinierte Form + Basisgröße (m) des Form-Werkzeugs. */
let gewaehlteForm = 'kreis';
let formGroesse = 1500;
let polygonPunkte: [number, number][] = [];
/** Prefab des Platzieren-Werkzeugs (frei wählbar, Vorschläge aus FOLIAGE). */
let spawnPrefab = 'Beech1';
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

function ladeEntwurf(): WorldLayout {
  return entwurfLesen() ?? leeresLayout();
}

/**
 * Entwurf in den localStorage. `quelle` ist kein Schmuck: Sie hält fest,
 * ob der Entwurf gerade 1:1 der Serverstand ist ('server') oder daneben
 * steht ('bearbeitet' / 'import') — daraus baut der Abgleichdialog beim
 * nächsten Start seinen Satz „dein Entwurf ist 12 Minuten alt und stammt
 * aus einem Import".
 */
function speichereEntwurf(quelle: EntwurfsQuelle = 'bearbeitet'): void {
  if (!entwurfSchreiben(layout, quelle, welt.instanz)) {
    shell.meldung('Entwurf zu groß für localStorage — bitte als JSON exportieren!', true);
  }
}

// ── Undo/Redo (Review-Punkt 18) ──────────────────────────────────────
// `layout` wird überall immutabel ersetzt — ein Snapshot je Änderung
// genügt. Strg+Z / Strg+Y (bzw. Strg+Shift+Z).
const vergangenheit: WorldLayout[] = [];
const zukunft: WorldLayout[] = [];
function merkeSchritt(): void {
  vergangenheit.push(layout);
  if (vergangenheit.length > 50) vergangenheit.shift();
  zukunft.length = 0;
}
/**
 * Wirkung unverändert, nur aus dem Tastatur-Zweig herausgezogen: Seit die
 * Symbolspalte einen Fuß hat (Entwurf), gibt es für beide Schritte auch
 * einen Knopf — und zwei Wege zu einer Handlung müssen dieselbe
 * Handlung sein und nicht deren Zwilling.
 */
function rueckgaengig(): void {
  const vorher = vergangenheit.pop();
  if (!vorher) {
    shell.meldung('Nichts mehr rückgängig zu machen.');
    return;
  }
  zukunft.push(layout);
  layout = vorher;
  gewaehlt = null;
  alles();
  vorschauAnstossen();
  shell.meldung(`Rückgängig (${vergangenheit.length} weitere Schritte)`);
}
function wiederherstellen(): void {
  const wieder = zukunft.pop();
  if (!wieder) {
    shell.meldung('Nichts wiederherzustellen.');
    return;
  }
  vergangenheit.push(layout);
  layout = wieder;
  gewaehlt = null;
  alles();
  vorschauAnstossen();
  shell.meldung('Wiederhergestellt');
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

const vorschau = document.createElement('canvas');
vorschau.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
flaeche.appendChild(vorschau);

const overlay = document.createElement('canvas');
overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;';
flaeche.appendChild(overlay);

// ── Schwebende Bedienflächen über der Karte (KartenHud.ts) ────────────
// NACH den beiden Zeichenflächen eingehängt: Die Reihenfolge im DOM
// entscheidet, was oben liegt. Der Hud gehört über das Overlay, sonst
// fingen die Zeichenflächen seine Klicks ab.
const WERKZEUG_TEXT: Record<Werkzeugname, string> = {
  auswahl: 'Auswahl',
  form: 'Insel-Form setzen',
  polygon: 'Polygon zeichnen',
  platzieren: 'Objekt platzieren',
  fluss: 'Fluss zeichnen',
  see: 'See setzen',
};
/** Die Mono-Plakette der Werkzeuganzeige — je Werkzeug die Zahl, die es führt. */
function hudZusatz(): string {
  switch (werkzeug) {
    case 'form':
      return `${FORMEN.find((f) => f.id === gewaehlteForm)?.name ?? ''} ${formGroesse} m`;
    case 'polygon':
      return `${polygonPunkte.length} Punkte`;
    case 'fluss':
      return `${flussPunkte.length} Punkte · ${flussBreite} m`;
    case 'see':
      return `Radius ${seeRadius} m`;
    case 'platzieren':
      return spawnPrefab;
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
      werkzeugText: WERKZEUG_TEXT[werkzeug],
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
  // Offener Flusslauf des Werkzeugs
  if (flussPunkte.length > 0) {
    ctx.strokeStyle = F.wasser;
    ctx.lineWidth = Math.max(2, flussBreite / massstab);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    flussPunkte.forEach(([x, z], i) => {
      const [px, py] = zuBild(x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
  }

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
  if (werkzeug === 'platzieren') {
    const placements = [
      ...(layout.placements ?? []),
      { prefab: spawnPrefab, x: Math.round(wx), z: Math.round(wz), yaw: Math.random() * Math.PI * 2 },
    ];
    layout = { ...layout, placements };
    speichereEntwurf();
    seiteBauen();
    zeichneOverlay();
    return;
  }
  if (werkzeug === 'fluss') {
    flussPunkte.push([Math.round(wx), Math.round(wz)]);
    seiteBauen();
    zeichneOverlay();
    return;
  }
  if (werkzeug === 'see') {
    // Mittelpunkt + Radius statt Punktzug (LakeDef) — ein Klick reicht,
    // anders als beim Fluss gibt es kein offenes Werkzeugobjekt, das erst
    // noch abgeschlossen werden müsste.
    let n = 1;
    while ((layout.lakes ?? []).some((l) => l.id === `see-${n}`)) n++;
    merkeSchritt();
    layout = {
      ...layout,
      lakes: [
        ...(layout.lakes ?? []),
        { id: `see-${n}`, x: Math.round(wx), z: Math.round(wz), radius: seeRadius, depth: seeTiefe },
      ],
    };
    // Wie das Form-Werkzeug: ein Klick = EIN See, Shift hält das
    // Werkzeug für Serien aktiv.
    if (!e.shiftKey) werkzeug = 'auswahl';
    alles();
    vorschauAnstossen();
    shell.meldung(
      e.shiftKey
        ? `see-${n} angelegt (Radius ${seeRadius} m) — Werkzeug bleibt aktiv (Shift)`
        : `see-${n} angelegt (Radius ${seeRadius} m)`
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
overlay.addEventListener('pointerup', () => {
  zieht = null;
  if (griff) {
    griff = null;
    alles();
    vorschauAnstossen();
  }
});
overlay.addEventListener('dblclick', () => {
  polygonSchliessen();
  flussSchliessen();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && (werkzeug === 'polygon' || werkzeug === 'fluss')) {
    polygonPunkte = [];
    flussPunkte = [];
    werkzeug = 'auswahl';
    seiteBauen();
    zeichneOverlay();
  }
});

/** Offenen Flusslauf ins Layout übernehmen (mind. 2 Punkte). */
function flussSchliessen(): void {
  if (werkzeug !== 'fluss') return;
  const punkte = flussPunkte.filter(
    (p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1]![0], p[1] - a[i - 1]![1]) > 1
  );
  if (punkte.length < 2) {
    shell.meldung(`Ein Fluss braucht mindestens 2 Punkte (aktuell ${punkte.length}).`, true);
    return;
  }
  let n = 1;
  while ((layout.rivers ?? []).some((r) => r.id === `fluss-${n}`)) n++;
  merkeSchritt();
  layout = {
    ...layout,
    rivers: [...(layout.rivers ?? []), { id: `fluss-${n}`, points: punkte, width: flussBreite, depth: flussTiefe }],
  };
  flussPunkte = [];
  werkzeug = 'auswahl';
  alles();
  vorschauAnstossen();
  shell.meldung(`fluss-${n} angelegt (${punkte.length} Punkte, ${flussBreite} m breit)`);
}

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
type WerkzeugId = 'auswahl' | 'form' | 'polygon' | 'platzieren' | 'fluss' | 'see';
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
type SeitenBetriebsart = 'terrain' | 'gewaesser' | 'objekte' | 'biome' | 'routen';
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
    'Klick platziert das gewählte Prefab. Die Liste bündelt die Platzierungen je Insel nach Namen.',
  ],
  biome: [
    'Biome',
    'Das Biom hängt an der Region: Insel in der Liste wählen, Biom in ihren Eigenschaften setzen.',
  ],
  routen: [
    'Routen',
    'NPC-Routen liegen im Weltdokument. Der Karteneditor hat für sie noch keinen eigenen Bereich.',
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
    if (id === 'fluss') flussPunkte = [];
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
    kachel(
      'fluss',
      'Fluss',
      PFAD.fluss,
      'Verlauf klicken; abschließen: ✓-Knopf oder Doppelklick. Esc bricht ab.',
      flussPunkte.length ? `${flussPunkte.length} P.` : ''
    ),
    kachel(
      'see',
      'See',
      PFAD.see,
      'Klick setzt den Mittelpunkt und legt den See sofort an. Shift für Serien.',
      `${seeRadius} m`
    ),
    // Fünfte Kachel über beide Spalten: Das Mockup zeigt vier
    // Zeichenwerkzeuge, der Editor hat fünf. „Objekt platzieren" ist
    // keins zum Wegkürzen — es ist der einzige Weg, einen Baum von Hand
    // zu setzen.
    kachel(
      'platzieren',
      'Objekt platzieren',
      PFAD.platzieren,
      'Klick platziert das gewählte Prefab (zufällige Drehung). Die Höhe folgt dem Boden.',
      spawnPrefab,
      true
    )
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
  if (werkzeug === 'fluss') {
    const block = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));
    const zeile = el('div', stil({ display: 'flex', gap: '8px' }));
    zeile.append(
      feld(
        String(flussBreite),
        (v) => {
          flussBreite = Math.min(400, Math.max(4, Number(v) || flussBreite));
          seiteBauen();
          zeichneOverlay();
        },
        { mono: true, einheit: 'm', titel: 'Breite in Metern' }
      ),
      feld(
        String(flussTiefe),
        (v) => {
          flussTiefe = Math.min(60, Math.max(1, Number(v) || flussTiefe));
          seiteBauen();
          zeichneOverlay();
        },
        { mono: true, einheit: 'm', titel: 'Tiefe unter der Wasserlinie (m)' }
      )
    );
    block.appendChild(beschriftet('Breite / Tiefe', zeile));
    if (flussPunkte.length >= 2) {
      block.appendChild(breiterKnopf(`Fluss abschließen (${flussPunkte.length} Punkte)`, flussSchliessen, PFAD.haken));
    }
    block.appendChild(hinweisZeile('Verlauf klicken; abschließen: ✓-Knopf oder Doppelklick. Esc bricht ab.'));
    seite.appendChild(block);
  }
  if (werkzeug === 'see') {
    const block = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));
    const zeile = el('div', stil({ display: 'flex', gap: '8px' }));
    zeile.append(
      feld(
        String(seeRadius),
        (v) => {
          seeRadius = Math.min(5000, Math.max(8, Number(v) || seeRadius));
          seiteBauen();
        },
        { mono: true, einheit: 'm', titel: 'Radius in Metern' }
      ),
      feld(
        String(seeTiefe),
        (v) => {
          seeTiefe = Math.min(60, Math.max(1, Number(v) || seeTiefe));
          seiteBauen();
        },
        { mono: true, einheit: 'm', titel: 'Tiefe unter der Wasserlinie (m)' }
      )
    );
    block.appendChild(beschriftet('Radius / Tiefe', zeile));
    block.appendChild(hinweisZeile('Klick setzt den Mittelpunkt und legt den See sofort an. Shift für Serien.'));
    seite.appendChild(block);
  }
  if (werkzeug === 'platzieren') {
    const block = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));
    const prefabFeld = feld(
      spawnPrefab,
      (v) => {
        spawnPrefab = v.trim() || 'Beech1';
        // Der 3D-Testflug (Taste B im Spiel) platziert dasselbe Prefab.
        localStorage.setItem('wov-editor-spawn-prefab', spawnPrefab);
        seiteBauen();
      },
      { titel: 'Prefab-Name — Vorschläge aus der Vegetationstabelle' }
    );
    const eingabe = prefabFeld.querySelector('input');
    if (eingabe) eingabe.setAttribute('list', 'prefab-liste');
    if (!document.getElementById('prefab-liste')) {
      const dl = document.createElement('datalist');
      dl.id = 'prefab-liste';
      for (const n of [...new Set(FOLIAGE.map((f) => f.prefabName))]) {
        const o = document.createElement('option');
        o.value = n;
        dl.appendChild(o);
      }
      document.body.appendChild(dl);
    }
    block.append(
      beschriftet('Prefab', prefabFeld),
      hinweisZeile('Klick auf die Karte platziert das Prefab (zufällige Drehung). Höhe folgt dem Boden.')
    );
    seite.appendChild(block);
  }

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
    spawnPrefab = prefab;
    // Derselbe Schlüssel, aus dem der 3D-Testflug (Taste B) sein Prefab
    // liest — beide Wege sollen dasselbe Objekt meinen.
    localStorage.setItem('wov-editor-spawn-prefab', prefab);
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
              layout = s;
              gewaehlt = null;
              alles('import');
              vorschauAnstossen();
              // Ein Import ist ausdrücklich NUR ein Entwurf. Wer eine
              // live.json in einen dev-Editor zieht, hat damit noch nichts
              // umgestellt — deshalb steht hier, welche Welt der
              // Speicherknopf danach treffen würde.
              shell.meldung(
                `Import übernommen — ${s.regions.length} Region(en). Erst „In die Welt speichern" ` +
                `schreibt ihn nach ${weltName()}.`
              );
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
  const stelleEin = (id: SeitenBetriebsart, filter: FilterId, w?: WerkzeugId): void => {
    betriebsart = id;
    filterMarke = filter;
    if (w) werkzeug = w;
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
  shell.betriebsart('flug', 'Testflug', PFAD.flug, () => {
    testflug();
    shell.setzeBetriebsart(betriebsart);
  });
  shell.setzeBetriebsart(betriebsart);
  seitenkopfSetzen();

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
  }

  shell.meldung(`Speichere nach ${weltName()} …`);
  try {
    const r = await fetch('/api/worldlayout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sauber),
    });
    const a = (await r.json()) as { ok: boolean; message: string };
    shell.meldung(
      a.ok ? `${a.message} — Server neu starten, damit die Welt sie lädt.` : a.message,
      !a.ok
    );
    if (a.ok) {
      // Ab jetzt sind Entwurf und Serverstand deckungsgleich. Ohne diese
      // zwei Zeilen fragte der Abgleich beim nächsten Öffnen nach einem
      // Unterschied, den es nicht mehr gibt — und man lernt, den Dialog
      // wegzuklicken. Genau das darf er nie werden.
      serverKanon = JSON.stringify(sauber);
      speichereEntwurf('server');
      faerbeSpeicherKnopf();
    }
    return a.ok;
  } catch (err) {
    shell.meldung(`Speichern fehlgeschlagen: ${String(err)}`, true);
    return false;
  }
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
 * Baut den Prüfbericht neu — dieselbe Prüfung, die `WovServer.ts:604`
 * beim Serverstart ins journalctl schreibt, hier gegen den GERADE
 * BEARBEITETEN Entwurf statt gegen die zuletzt gestartete Weltdatei.
 * Läuft synchron über `layout` (klein, < 200 KB) und braucht keinen
 * Worker, anders als die Terrain-Vorschau.
 */
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

  // Anklickbar nur, wenn `wo` tatsächlich eine Region DIESES Entwurfs
  // ist — bei 'placements', 'welt' und Routen-IDs gibt es im 2D-Editor
  // (anders als bei Regionen) keine Auswahl, zu der man springen könnte.
  //
  // Die Schwere steht nicht mehr als farbiger Balken links, sondern als
  // Punkt vor dem Text: Ein Balken auf der Kante ist bei drei Stufen
  // nicht mehr auseinanderzuhalten, ein Punkt schon — und er lässt den
  // Text an derselben Kante beginnen wie in der Regionsliste daneben.
  const regionIds = new Set(layout.regions.map((r) => r.id));
  const punktFarbe = (schwere: 'fehler' | 'hinweis'): string =>
    schwere === 'fehler' ? F.fehler : F.warnText;
  for (const b of befunde) {
    const anklickbar = regionIds.has(b.wo);
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
      zeile.title = `Zu Region ${b.wo} springen`;
      beiUeberfahren(zeile, { background: F.erhoben });
      zeile.onclick = () => springeZuRegion(b.wo);
    }
    pruefSeite.appendChild(zeile);
  }
}

function alles(quelle: EntwurfsQuelle = 'bearbeitet'): void {
  speichereEntwurf(quelle);
  seiteBauen();
  pruefberichtBauen();
  zeichneOverlay();
  // Jede Änderung kann den Entwurf vom Serverstand wegbewegen ODER ihn
  // (per Rückgängig) wieder darauf zurückführen — der Punkt am
  // Speicherknopf muss beides mitmachen.
  faerbeSpeicherKnopf();
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

  const entwurf = entwurfLesen();
  const uebernehmen = (grund: string): void => {
    layout = stand.layout;
    gewaehlt = null;
    alles('server');
    vorschauAnstossen();
    shell.meldung(`${stand.message} — ${grund}`);
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
        hinweis: 'Der Serverstand bleibt vorerst unangetastet — bis du speicherst.',
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
  speichereEntwurf(zettel?.quelle ?? 'bearbeitet');
  shell.meldung(
    `Entwurf behalten — ${weltName()} auf dem Server ist unverändert, bis du speicherst.`,
    true
  );
}

// ── Start ────────────────────────────────────────────────────────────
groesseAnpassen();
seiteBauen();
pruefberichtBauen();
vorschauRechnen();
// Kein `await` auf oberster Ebene: Der Aufbau oben ist synchron und
// fertig, der Vorhang in `weltAbgleich` deckt das Fenster ab, bis der
// Serverstand feststeht.
void weltAbgleich();
