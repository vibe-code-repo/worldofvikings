/**
 * 3D-Map-Generator (Phase 5 des Kartengenerierungs-Umbaus).
 *
 * Leitidee (Nutzerwunsch): Basis ist der Ozean; Inseln/Biome werden hier
 * gezeichnet, LIVE als Karte gesehen und dann in die Live-Umgebung
 * portiert. Drei Wege nach draußen:
 *   1. Testflug — öffnet das echte Spiel offline mit dem Entwurf
 *      (?offline=1&layout=editor, Übergabe via localStorage).
 *   2. JSON-Export/-Import — die Datei ist das Weltdokument
 *      (server/data/worldlayout.json).
 *   3. MCP/Deployment — der WorldLayout-MCP-Server (tools/worldlayout-mcp)
 *      schreibt dieselbe Datei direkt auf den Server und startet ihn neu.
 *
 * Die Vorschau ist DERSELBE Karten-Worker wie im Spiel (mapWorker mit
 * RegionGeo): Was hier erscheint, ist exakt die Welt, die der Server baut —
 * kein eigener Vorschau-Renderer, keine Drift.
 */
import {
  sanitizeWorldLayout,
  layoutBounds,
  DEFAULT_BASE_LEVEL,
  FOLIAGE,
  type BiomeName,
  type RegionDef,
  type WorldLayout,
} from '@wov/shared';
import { setzeKartenMasse, type MapWorkerMessage } from '../ui/worldmap/mapTypes';

const BIOME_NAMEN: BiomeName[] = [
  'meadows', 'blackforest', 'swamp', 'mountain', 'plains', 'mistlands', 'ashlands', 'deepnorth',
];
const BIOME_FARBE: Record<BiomeName, string> = {
  meadows: '#7aa860', blackforest: '#2f5136', swamp: '#5d5a43', mountain: '#cfd6dd',
  plains: '#c9b463', mistlands: '#6d6a7a', ashlands: '#8a4a3a', deepnorth: '#b9c8d4',
};

const STORAGE_KEY = 'wov-editor-layout';

// ── Zustand ──────────────────────────────────────────────────────────
let layout: WorldLayout = ladeEntwurf();
let gewaehlt: string | null = null;
let werkzeug: 'auswahl' | 'kreis' | 'polygon' | 'platzieren' = 'auswahl';
let polygonPunkte: [number, number][] = [];
/** Prefab des Platzieren-Werkzeugs (frei wählbar, Vorschläge aus FOLIAGE). */
let spawnPrefab = 'Beech1';
/** Weltmeter je Bildschirmpixel der Zeichenfläche. */
let massstab = 40;
let mitteX = 0;
let mitteZ = 0;

function ladeEntwurf(): WorldLayout {
  try {
    const roh = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const s = sanitizeWorldLayout(roh);
    if (s) return s;
  } catch { /* frisch starten */ }
  return {
    version: 1,
    name: 'World of Vikings',
    detailSeed: 'wov-alpha',
    continents: [],
    regions: [],
  };
}

function speichereEntwurf(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

function neueId(basis: string): string {
  let n = 1;
  while (layout.regions.some((r) => r.id === `${basis}-${n}`)) n++;
  return `${basis}-${n}`;
}

// ── DOM-Gerüst ───────────────────────────────────────────────────────
const wurzel = document.createElement('div');
wurzel.style.cssText = 'display:flex;height:100vh;';
document.body.appendChild(wurzel);

const seite = document.createElement('div');
seite.style.cssText =
  'width:300px;min-width:300px;padding:12px;overflow-y:auto;background:#12161f;' +
  'border-right:1px solid #3a3325;font-size:13px;line-height:1.5;';
wurzel.appendChild(seite);

const flaeche = document.createElement('div');
flaeche.style.cssText = 'flex:1;position:relative;';
wurzel.appendChild(flaeche);

const vorschau = document.createElement('canvas');
vorschau.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
flaeche.appendChild(vorschau);

const overlay = document.createElement('canvas');
overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;';
flaeche.appendChild(overlay);

const statuszeile = document.createElement('div');
statuszeile.style.cssText =
  'position:absolute;left:10px;bottom:8px;font-size:12px;color:#9a8f6a;pointer-events:none;';
flaeche.appendChild(statuszeile);

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
  if (werkzeug === 'kreis') {
    const region: RegionDef = {
      id: neueId('insel'),
      biome: 'meadows',
      shape: { kind: 'circle', x: Math.round(wx), z: Math.round(wz), radius: 1500 },
      edgeFalloff: 300,
    };
    layout = { ...layout, regions: [...layout.regions, region] };
    gewaehlt = region.id;
    werkzeug = 'auswahl';
    alles();
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
  if (zieht) {
    mitteX -= (e.offsetX - zieht.x) * massstab;
    mitteZ -= (e.offsetY - zieht.y) * massstab;
    zieht = { x: e.offsetX, y: e.offsetY };
    zeichneOverlay();
    zeichneVorschauBild();
  }
  statuszeile.textContent = `x ${wx.toFixed(0)}  z ${wz.toFixed(0)}`;
});
overlay.addEventListener('pointerup', () => { zieht = null; });
overlay.addEventListener('dblclick', polygonSchliessen);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && werkzeug === 'polygon') {
    polygonPunkte = [];
    werkzeug = 'auswahl';
    seiteBauen();
    zeichneOverlay();
  }
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
    biome: 'meadows',
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

  seite.appendChild(knopf(werkzeug === 'kreis' ? '● Kreis (aktiv)' : '● Kreis-Insel setzen', () => {
    werkzeug = werkzeug === 'kreis' ? 'auswahl' : 'kreis';
    seiteBauen();
  }));
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
    inp.onchange = () => { spawnPrefab = inp.value.trim() || 'Beech1'; seiteBauen(); };
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
      layout = { ...layout, regions: layout.regions.filter((r) => r.id !== region.id) };
      gewaehlt = null;
      alles(); vorschauAnstossen();
    }));
    seite.appendChild(box);
  }

  seite.appendChild(knopf('🔁 Vorschau neu rechnen', vorschauRechnen));
  seite.appendChild(knopf('✈ Testflug (Spiel offline)', () => {
    speichereEntwurf();
    window.open('/?offline=1&layout=editor', '_blank');
  }));
  seite.appendChild(knopf('⬇ JSON exportieren', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }));
    a.download = 'worldlayout.json';
    a.click();
  }));
  seite.appendChild(knopf('⬆ JSON importieren', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      void f.text().then((t) => {
        const s = sanitizeWorldLayout(JSON.parse(t));
        if (s) {
          layout = s;
          gewaehlt = null;
          alles();
          vorschauAnstossen();
        } else {
          statuszeile.textContent = 'Import verworfen — kein gültiges WorldLayout.';
        }
      });
    };
    inp.click();
  }));
  const deploy = document.createElement('div');
  deploy.style.cssText = 'font-size:11px;color:#9a8f6a;margin-top:10px;';
  deploy.textContent =
    'Portieren in die Live-Umgebung: Export nach server/data/worldlayout.json ' +
    'und Server-Neustart — oder per MCP-Server (tools/worldlayout-mcp) direkt aus dem Chat.';
  seite.appendChild(deploy);
}

function alles(): void {
  speichereEntwurf();
  seiteBauen();
  zeichneOverlay();
}

// ── Start ────────────────────────────────────────────────────────────
groesseAnpassen();
seiteBauen();
vorschauRechnen();
