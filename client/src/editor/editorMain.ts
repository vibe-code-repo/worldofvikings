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

const BIOME_NAMEN: BiomeName[] = [
  'grassland', 'blackforest', 'swamp', 'mountain', 'plains', 'mistlands', 'ashlands', 'deepnorth',
];
const BIOME_FARBE: Record<BiomeName, string> = {
  grassland: '#7aa860', blackforest: '#2f5136', swamp: '#5d5a43', mountain: '#cfd6dd',
  plains: '#c9b463', mistlands: '#6d6a7a', ashlands: '#8a4a3a', deepnorth: '#b9c8d4',
};

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
let gewaehlt: string | null = null;
let werkzeug: 'auswahl' | 'form' | 'polygon' | 'platzieren' | 'fluss' = 'auswahl';
/** Offener Flusslauf (Weltbau B) + Breite/Tiefe des Werkzeugs. */
let flussPunkte: [number, number][] = [];
let flussBreite = 40;
let flussTiefe = 8;
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
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (e.code === 'KeyZ' && !e.shiftKey) {
    const vorher = vergangenheit.pop();
    if (!vorher) return;
    zukunft.push(layout);
    layout = vorher;
    gewaehlt = null;
    alles();
    vorschauAnstossen();
    shell.meldung(`Rückgängig (${vergangenheit.length} weitere Schritte)`);
  } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
    const wieder = zukunft.pop();
    if (!wieder) return;
    vergangenheit.push(layout);
    layout = wieder;
    gewaehlt = null;
    alles();
    vorschauAnstossen();
    shell.meldung('Wiederhergestellt');
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
/** Dynamischer Seitenleisten-Inhalt (Werkzeuge, Regionen, Eigenschaften). */
const seite = shell.sektion('Werkzeuge & Regionen');

const vorschau = document.createElement('canvas');
vorschau.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
flaeche.appendChild(vorschau);

const overlay = document.createElement('canvas');
overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;';
flaeche.appendChild(overlay);

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
function zeichneOverlay(): void {
  const ctx = overlay.getContext('2d')!;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  for (const r of layout.regions) {
    ctx.strokeStyle = BIOME_FARBE[r.biome];
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
    // Beschriftung am Schwerpunkt
    const b = r.shape.kind === 'circle'
      ? { x: r.shape.x, z: r.shape.z }
      : {
          x: r.shape.points.reduce((s, p) => s + p[0], 0) / r.shape.points.length,
          z: r.shape.points.reduce((s, p) => s + p[1], 0) / r.shape.points.length,
        };
    const [tx, ty] = zuBild(b.x, b.z);
    ctx.setLineDash([]);
    ctx.fillStyle = BIOME_FARBE[r.biome];
    ctx.font = '12px Georgia';
    ctx.fillText(r.id, tx - 20, ty);
  }
  // Griffe der gewählten Region: Mittelpunkt (verschieben), Radius-Handle
  // beim Kreis, jeder Eckpunkt beim Polygon.
  const aktiv = layout.regions.find((r) => r.id === gewaehlt);
  if (aktiv) {
    const punkt = (px: number, py: number, gefuellt: boolean): void => {
      ctx.beginPath();
      ctx.arc(px, py, GRIFF_PX, 0, Math.PI * 2);
      ctx.fillStyle = gefuellt ? '#e8d48a' : 'rgba(232,212,138,0.25)';
      ctx.fill();
      ctx.strokeStyle = '#e8d48a';
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
    ctx.strokeStyle = 'rgba(90,150,210,0.75)';
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
    ctx.fillStyle = 'rgba(90,150,210,0.45)';
    ctx.fill();
  }
  // Offener Flusslauf des Werkzeugs
  if (flussPunkte.length > 0) {
    ctx.strokeStyle = '#6ab0e0';
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
    ctx.fillStyle = '#8fd07a';
    ctx.fill();
    if (massstab < 12) {
      ctx.fillStyle = '#8fd07a';
      ctx.font = '10px Georgia';
      ctx.fillText(p.prefab, px + 5, py + 3);
    }
  }
  // Offenes Polygon des Zeichenwerkzeugs
  if (polygonPunkte.length > 0) {
    ctx.strokeStyle = '#e8d48a';
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
      ctx.fillStyle = i === 0 ? 'rgba(232,212,138,0.35)' : '#e8d48a';
      ctx.fill();
      if (i === 0) {
        ctx.strokeStyle = '#e8d48a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }
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
  ctx.fillStyle = '#0d1420';
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
function knopf(text: string, cb: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText =
    'display:block;width:100%;margin:4px 0;padding:6px;background:#1d2431;color:#d8cfa8;' +
    'border:1px solid #3a3325;border-radius:4px;cursor:pointer;font-family:inherit;';
  b.onclick = cb;
  return b;
}

function seiteBauen(): void {
  seite.innerHTML = '';
  const titel = document.createElement('h2');
  titel.textContent = 'Map-Generator';
  titel.style.cssText = 'margin:0 0 4px;font-size:17px;color:#e8d48a;';
  seite.appendChild(titel);
  const hinweis = document.createElement('div');
  hinweis.style.cssText = 'font-size:11px;color:#9a8f6a;margin-bottom:10px;';
  hinweis.textContent =
    'Basis ist der Ozean. Kreis: 1 Klick. Polygon: Punkte klicken, Doppelklick schließt. ' +
    'Rad = Zoom, Ziehen auf freier See = Verschieben.';
  seite.appendChild(hinweis);

  // Formen-Menü: vordefinierte Inselformen + Basisgröße, dann Klick setzt.
  const formZeile = document.createElement('div');
  formZeile.style.cssText = 'display:flex;gap:4px;margin:2px 0;';
  const formWahl = document.createElement('select');
  formWahl.style.cssText = 'flex:1;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:3px;';
  for (const f of FORMEN) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.name;
    o.selected = f.id === gewaehlteForm;
    formWahl.appendChild(o);
  }
  formWahl.onchange = () => {
    gewaehlteForm = formWahl.value;
    werkzeug = 'form';
    seiteBauen();
  };
  formZeile.appendChild(formWahl);
  const groesseFeld = document.createElement('input');
  groesseFeld.value = String(formGroesse);
  groesseFeld.title = 'Basisgröße in Metern';
  groesseFeld.style.cssText = 'width:64px;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:3px;';
  groesseFeld.onchange = () => {
    formGroesse = Math.min(20000, Math.max(100, Number(groesseFeld.value) || 1500));
    groesseFeld.value = String(formGroesse);
  };
  formZeile.appendChild(groesseFeld);
  seite.appendChild(formZeile);
  seite.appendChild(knopf(
    werkzeug === 'form'
      ? `✚ ${FORMEN.find((f) => f.id === gewaehlteForm)?.name ?? ''} setzen (aktiv — Klick setzt, Shift für Serien)`
      : '✚ Insel-Form setzen',
    () => {
      werkzeug = werkzeug === 'form' ? 'auswahl' : 'form';
      seiteBauen();
    }
  ));
  seite.appendChild(knopf(
    werkzeug === 'polygon' ? `▱ Polygon (aktiv, ${polygonPunkte.length} Punkte)` : '▱ Polygon-Kontinent zeichnen',
    () => {
      werkzeug = werkzeug === 'polygon' ? 'auswahl' : 'polygon';
      polygonPunkte = [];
      seiteBauen();
      zeichneOverlay();
    }
  ));
  if (werkzeug === 'polygon' && polygonPunkte.length >= 3) {
    seite.appendChild(knopf(`✓ Polygon schließen (${polygonPunkte.length} Punkte)`, polygonSchliessen));
  }
  seite.appendChild(knopf(
    werkzeug === 'fluss' ? `≈ Fluss zeichnen (aktiv, ${flussPunkte.length} Punkte)` : '≈ Fluss zeichnen',
    () => {
      werkzeug = werkzeug === 'fluss' ? 'auswahl' : 'fluss';
      flussPunkte = [];
      seiteBauen();
      zeichneOverlay();
    }
  ));
  if (werkzeug === 'fluss') {
    const zeile = document.createElement('div');
    zeile.style.cssText = 'display:flex;gap:4px;margin:2px 0;';
    const feld = (wert: number, titel: string, setz: (v: number) => void): HTMLInputElement => {
      const i = document.createElement('input');
      i.value = String(wert);
      i.title = titel;
      i.style.cssText = 'width:50%;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:3px;';
      i.onchange = () => { setz(Number(i.value) || wert); seiteBauen(); zeichneOverlay(); };
      return i;
    };
    zeile.appendChild(feld(flussBreite, 'Breite in Metern', (v) => (flussBreite = Math.min(400, Math.max(4, v)))));
    zeile.appendChild(feld(flussTiefe, 'Tiefe unter der Wasserlinie (m)', (v) => (flussTiefe = Math.min(60, Math.max(1, v)))));
    seite.appendChild(zeile);
    if (flussPunkte.length >= 2) {
      seite.appendChild(knopf(`✓ Fluss abschließen (${flussPunkte.length} Punkte)`, flussSchliessen));
    }
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:11px;color:#e8d48a;margin-bottom:6px;';
    tip.textContent = 'Verlauf klicken; abschließen: ✓-Knopf oder Doppelklick. Esc bricht ab.';
    seite.appendChild(tip);
  }
  const wasser = [...(layout.rivers ?? []), ...(layout.lakes ?? [])];
  if (wasser.length > 0) {
    const kopf = document.createElement('div');
    kopf.style.cssText = 'font-size:12px;color:#9a8f6a;margin-top:8px;';
    kopf.textContent = `Gewässer (${wasser.length})`;
    seite.appendChild(kopf);
    for (const w of wasser) {
      const zeile = document.createElement('div');
      zeile.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;padding:1px 2px;';
      const istFluss = 'points' in w;
      zeile.innerHTML = `<span style="color:#6ab0e0">${istFluss ? '≈' : '◍'} ${w.id}</span>`;
      const x = document.createElement('span');
      x.textContent = '✕';
      x.style.cssText = 'cursor:pointer;color:#c96;';
      x.onclick = () => {
        merkeSchritt();
        layout = istFluss
          ? { ...layout, rivers: (layout.rivers ?? []).filter((r) => r.id !== w.id) }
          : { ...layout, lakes: (layout.lakes ?? []).filter((l) => l.id !== w.id) };
        alles();
        vorschauAnstossen();
      };
      zeile.appendChild(x);
      seite.appendChild(zeile);
    }
  }
  seite.appendChild(knopf(
    werkzeug === 'platzieren' ? `✦ Platzieren (aktiv: ${spawnPrefab})` : '✦ Objekt platzieren (Baum, Fels …)',
    () => {
      werkzeug = werkzeug === 'platzieren' ? 'auswahl' : 'platzieren';
      seiteBauen();
    }
  ));
  if (werkzeug === 'platzieren') {
    const inp = document.createElement('input');
    inp.value = spawnPrefab;
    inp.setAttribute('list', 'prefab-liste');
    inp.style.cssText = 'width:100%;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:4px;margin:2px 0 6px;';
    inp.onchange = () => {
      spawnPrefab = inp.value.trim() || 'Beech1';
      // Der 3D-Testflug (Taste B im Spiel) platziert dasselbe Prefab.
      localStorage.setItem('wov-editor-spawn-prefab', spawnPrefab);
      seiteBauen();
    };
    seite.appendChild(inp);
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
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:11px;color:#e8d48a;margin-bottom:6px;';
    tip.textContent = 'Klick auf die Karte platziert das Prefab (zufällige Drehung). Höhe folgt dem Boden.';
    seite.appendChild(tip);
  }
  const platzierungen = layout.placements ?? [];
  if (platzierungen.length > 0) {
    const kopf = document.createElement('div');
    kopf.style.cssText = 'font-size:12px;color:#9a8f6a;margin-top:8px;';
    kopf.textContent = `Platzierungen (${platzierungen.length})`;
    seite.appendChild(kopf);
    const box = document.createElement('div');
    box.style.cssText = 'max-height:120px;overflow-y:auto;font-size:11px;';
    platzierungen.slice(-30).forEach((p) => {
      const zeile = document.createElement('div');
      zeile.style.cssText = 'display:flex;justify-content:space-between;padding:1px 2px;';
      zeile.innerHTML = `<span>${p.prefab} @(${p.x}, ${p.z})</span>`;
      const x = document.createElement('span');
      x.textContent = '✕';
      x.style.cssText = 'cursor:pointer;color:#c96;';
      x.onclick = () => {
        merkeSchritt();
        layout = { ...layout, placements: platzierungen.filter((q) => q !== p) };
        alles();
      };
      zeile.appendChild(x);
      box.appendChild(zeile);
    });
    seite.appendChild(box);
  }
  if (werkzeug === 'polygon') {
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:11px;color:#e8d48a;margin:2px 0 6px;';
    tip.textContent = 'Punkte klicken; schließen: Klick auf den Startpunkt, den ✓-Knopf oder Doppelklick. Esc bricht ab.';
    seite.appendChild(tip);
  }

  // Regionsliste
  const liste = document.createElement('div');
  liste.style.cssText = 'margin:10px 0;';
  for (const r of layout.regions) {
    const zeile = document.createElement('div');
    zeile.style.cssText =
      `padding:3px 6px;margin:2px 0;border-left:3px solid ${BIOME_FARBE[r.biome]};cursor:pointer;` +
      (r.id === gewaehlt ? 'background:#243044;' : '');
    zeile.textContent = `${r.id} — ${r.biome}`;
    zeile.onclick = () => { gewaehlt = r.id; alles(); };
    liste.appendChild(zeile);
  }
  seite.appendChild(liste);

  // Parameter der gewählten Region
  const region = layout.regions.find((r) => r.id === gewaehlt);
  if (region) {
    const box = document.createElement('div');
    box.style.cssText = 'border:1px solid #3a3325;border-radius:4px;padding:8px;margin-bottom:10px;';
    const feld = (label: string, wert: string, cb: (v: string) => void): void => {
      const l = document.createElement('label');
      l.style.cssText = 'display:block;font-size:11px;color:#9a8f6a;margin-top:6px;';
      l.textContent = label;
      const inp = document.createElement('input');
      inp.value = wert;
      inp.style.cssText = 'width:100%;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:3px;';
      inp.onchange = () => { cb(inp.value); alles(); vorschauAnstossen(); };
      box.appendChild(l);
      box.appendChild(inp);
    };
    const ersetze = (patch: Partial<RegionDef>): void => {
      merkeSchritt();
      layout = {
        ...layout,
        regions: layout.regions.map((r) => (r.id === region.id ? { ...r, ...patch } : r)),
      };
    };
    const biomWahl = document.createElement('select');
    biomWahl.style.cssText = 'width:100%;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:3px;';
    for (const b of BIOME_NAMEN) {
      const o = document.createElement('option');
      o.value = b;
      o.textContent = b;
      o.selected = b === region.biome;
      biomWahl.appendChild(o);
    }
    biomWahl.onchange = () => { ersetze({ biome: biomWahl.value as BiomeName }); alles(); vorschauAnstossen(); };
    box.appendChild(biomWahl);
    feld('edgeFalloff (m)', String(region.edgeFalloff), (v) => ersetze({ edgeFalloff: Number(v) || 300 }));
    feld('baseLevel (leer = Biom-Default)', region.baseLevel?.toString() ?? '', (v) =>
      ersetze({ baseLevel: v === '' ? undefined : Number(v) })
    );
    feld('heightScale', region.heightScale?.toString() ?? '1', (v) => ersetze({ heightScale: Number(v) || 1 }));
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
    // ── Bewuchs der Insel ────────────────────────────────────────────
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
    const bewuchsText = document.createElement('div');
    bewuchsText.style.cssText =
      'font-size:11px;color:#9a8f6a;margin-top:12px;padding-top:8px;border-top:1px solid #2a2b22;';
    const veg = region.vegetation;
    const artenText =
      veg === undefined
        ? 'Biom-Standard'
        : veg.length === 0
          ? 'KEINER (nur Terrain und Gras)'
          : `${veg.length} Arten`;
    bewuchsText.textContent = `Bewuchs: ${artenText}`;
    box.appendChild(bewuchsText);

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
    box.appendChild(knopf(
      '🌾 Grasland (Wiese mit Laubwaldinseln)',
      // Offene Wiese: wenig Waldfläche, feine Körnung, voller Abstand —
      // die Haine sollen als einzelne Gruppen lesbar bleiben.
      preset(GRASLAND_FLORA_NAMEN, 0.9, 1.0, 1.0, 1.0)
    ));
    box.appendChild(knopf(
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
    box.appendChild(knopf(
      '🌲 Nadelwald (dicht, Überschirmung 1.3)',
      preset(NADELWALD_FLORA_NAMEN, 1.4, 1.5, 0.4, 0.55, 0.5)
    ));
    box.appendChild(knopf(
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
    box.appendChild(knopf(
      '🌿 Sumpf (Weiden, Seggen, nasser Grund)',
      // Nass und schattig, aber nicht geschlossen: Moorbirken und Weiden
      // stehen einzeln, dazwischen steht das Wasser. Deshalb mittlerer
      // Waldanteil bei hoher Bewuchsdichte — der Boden ist voll, die
      // Krone nicht. Feine Körnung, weil ein Bruchwald keine Haine bildet.
      preset(SUMPF_FLORA_NAMEN, 1.0, 1.6, 0.8, 0.7)
    ));
    box.appendChild(knopf(
      '🏔 Hoher Norden (karg, weite Abstände)',
      // Kältesteppe, keine Heide. Wenig Wald, wenig Bewuchs, und vor
      // allem WEITE Abstände: Was den Hohen Norden ausmacht, ist der
      // Blick zwischen den Bäumen hindurch. Grosse Körnung, damit die
      // wenigen Kiefern in Gruppen stehen statt gleichmässig verteilt.
      preset(HOCHNORD_FLORA_NAMEN, 0.5, 0.45, 1.4, 1.6)
    ));
    box.appendChild(knopf(
      '🌋 Aschewüste (nichts wächst)',
      // Eine leere Liste ist hier eine AUSSAGE, kein vergessenes Feld:
      // Der gesamte eigene Modellbestand ist nordisch-grün, ein
      // Wacholderpolster auf Schlacke wäre die Verlegenheitslösung.
      // Sobald es verkohlte Stümpfe oder Basaltsäulen gibt, gehören sie
      // in ASCHE_FLORA — dieser Knopf trägt sie dann von selbst ein.
      preset(ASCHE_FLORA_NAMEN, 0, 0, 1.0, 1.0)
    ));
    box.appendChild(knopf('🌾 Nur Terrain und Gras (kein Bewuchs)', () => {
      ersetze({ vegetation: [] });
      alles();
      vorschauAnstossen();
    }));
    box.appendChild(knopf('↩ Biom-Standard', () => {
      ersetze({ vegetation: undefined });
      alles();
      vorschauAnstossen();
    }));

    /**
     * Ein Regler mit Zahl daneben.
     *
     * Bewusst ein Schieber und kein Zahlenfeld: Beide Werte wirken
     * nichtlinear auf das Bild, und man findet sie durch Probieren.
     * `oninput` schreibt beim Ziehen — die Vorschau folgt sofort.
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
      const l = document.createElement('label');
      l.style.cssText = 'display:block;font-size:11px;color:#9a8f6a;margin-top:8px;';
      l.textContent = `${titel}: ${wert.toFixed(2)}`;
      const s2 = document.createElement('input');
      s2.type = 'range';
      s2.min = String(min);
      s2.max = String(max);
      s2.step = String(schritt);
      s2.value = String(wert);
      s2.style.cssText = 'width:100%;';
      s2.title = hinweis;
      s2.oninput = () => {
        l.textContent = `${titel}: ${Number(s2.value).toFixed(2)}`;
      };
      // Erst beim Loslassen neu rechnen: Die Vorschau kostet Zeit, und
      // beim Ziehen entstünden Dutzende Neuberechnungen.
      s2.onchange = () => {
        cb(Number(s2.value));
        alles();
        vorschauAnstossen();
      };
      box.appendChild(l);
      box.appendChild(s2);
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

    feld('Vegetation (Namen, Komma; leer = Biom-Standard)', region.vegetation?.join(', ') ?? '', (v) =>
      ersetze({ vegetation: v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined })
    );
    feld('Locations (Namen, Komma)', region.locations?.join(', ') ?? '', (v) =>
      ersetze({ locations: v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined })
    );
    feld('Spawns (Prefabs, Komma)', region.spawns?.join(', ') ?? '', (v) =>
      ersetze({ spawns: v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined })
    );
    box.appendChild(knopf('↑ nach oben (überdeckt)', () => {
      const i = layout.regions.findIndex((r) => r.id === region.id);
      if (i < layout.regions.length - 1) {
        const arr = [...layout.regions];
        [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
        layout = { ...layout, regions: arr };
        alles(); vorschauAnstossen();
      }
    }));
    box.appendChild(knopf('✕ Region löschen', () => {
      merkeSchritt();
      layout = { ...layout, regions: layout.regions.filter((r) => r.id !== region.id) };
      gewaehlt = null;
      alles(); vorschauAnstossen();
    }));
    seite.appendChild(box);
  }

}

// ── Werkzeugleiste: Welt- und Datei-Aktionen (einmalig) ──────────────
{
  // Der Katalog legt sich als eigene ANSICHT über den Viewport (er baut
  // seine eigene Babylon-Szene, s. GegenstandsKatalog). Die Karte darunter
  // bleibt unangetastet — Schließen zeigt sie unverändert wieder.
  const HINWEIS = 'Gegenstands-Katalog — Eintrag anklicken, Ziehen dreht, Rad zoomt. Esc schließt.';
  let katalog: GegenstandsKatalog | null = null;
  let katalogLaedt = false;
  const ansicht = shell.toolbarGruppe();
  ansicht.appendChild(knopf('📦 Katalog', () => {
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
        katalog = new m.GegenstandsKatalog(shell.viewport);
        katalog.oeffne();
        shell.meldung(HINWEIS);
      })
      .catch((err) => shell.meldung(`Katalog konnte nicht geladen werden: ${String(err)}`, true))
      .finally(() => (katalogLaedt = false));
  }));

  const weltGruppe = shell.toolbarGruppe();
  weltGruppe.appendChild(knopf('🔁 Vorschau', vorschauRechnen));
  weltGruppe.appendChild(knopf('✈ Testflug', () => {
    // Der Testflug übernimmt den ENTWURF (localStorage), nicht die
    // Serverdatei — er fliegt durch das, was hier gerade gezeichnet ist.
    // Das war schon immer so; seit es zwei Welten gibt, muss man es nur
    // dazusagen, sonst hält man den Flug für eine Ansicht der Live-Welt.
    speichereEntwurf();
    shell.meldung(`Testflug mit dem Entwurf — ${weltName()} bleibt unberührt, bis du speicherst.`);
    window.open('/?offline=1&layout=editor', '_blank');
  }));
  const speicherGruppe = shell.toolbarGruppe();
  speicherKnopf = knopf('💾 In die Welt speichern', () => void inDieWeltSpeichern());
  speicherGruppe.appendChild(speicherKnopf);
  faerbeSpeicherKnopf();
  const datei = shell.toolbarGruppe();
  datei.appendChild(knopf('⬇ Export', () => {
    entwurfExportieren();
    shell.meldung(
      `${exportName()} exportiert — Zielort ist server/data/welten/ auf dem gewünschten Container.`
    );
  }));
  datei.appendChild(knopf('⬆ Import', () => {
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
  }));
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
 */
function exportName(): string {
  return welt.datei ?? 'worldlayout.json';
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
  if (!speicherKnopf) return;
  const stil = shell.instanzFarben;
  const kanonJetzt = JSON.stringify(sanitizeWorldLayout(layout));
  const zeichen = serverKanon === null ? '? ' : serverKanon === kanonJetzt ? '' : '● ';
  speicherKnopf.style.borderColor = stil.band;
  speicherKnopf.textContent =
    zeichen + (welt.instanz === 'dev' ? '💾 In die Welt speichern' : `💾 Speichern → ${stil.name}`);
  speicherKnopf.title =
    `Schreibt ${weltName()} auf dem Server.` +
    (serverKanon === null
      ? ' — Serverstand unbekannt, der Editor kann nicht sagen, was du überschreiben würdest.'
      : serverKanon === kanonJetzt
        ? ' — Entwurf und Serverstand sind zurzeit identisch.'
        : ' — ● der Entwurf weicht vom Serverstand ab.');
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
async function inDieWeltSpeichern(): Promise<void> {
  const sauber = sanitizeWorldLayout(layout);
  if (!sauber) {
    shell.meldung('Entwurf ist unbrauchbar — nicht gespeichert.', true);
    return;
  }
  if (sauber.regions.length === 0) {
    shell.meldung(
      'Der Entwurf enthält keine einzige Region — das wäre offene See. Nicht gespeichert.',
      true
    );
    return;
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
      return;
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
  } catch (err) {
    shell.meldung(`Speichern fehlgeschlagen: ${String(err)}`, true);
  }
}

function alles(quelle: EntwurfsQuelle = 'bearbeitet'): void {
  speichereEntwurf(quelle);
  seiteBauen();
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
    shell.konsoleStatus('Server-Konsole — Verbindung unterbrochen (Betriebsdienst wov-admin prüfen)');
} catch {
  shell.konsoleStatus('Server-Konsole nicht verfügbar');
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
vorschauRechnen();
// Kein `await` auf oberster Ebene: Der Aufbau oben ist synchron und
// fertig, der Vorhang in `weltAbgleich` deckt das Fenster ab, bis der
// Serverstand feststeht.
void weltAbgleich();
