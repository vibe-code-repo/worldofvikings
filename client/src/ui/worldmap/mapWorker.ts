/**
 * Worker, der die komplette Weltkarte vorberechnet.
 *
 * Warum ein Worker: die Karte deckt 21 × 21 km ab, und jede Probe ruft die
 * echte Weltgenerierung (`GeoManager`) auf — dieselbe, die der Server fährt.
 * Das sind einige hunderttausend fBm-Auswertungen; im Hauptthread würde das
 * das Spiel für zig Sekunden einfrieren. Hier läuft es nebenher, sobald die
 * Welt steht, und meldet Zwischenstände, damit sich die Karte sichtbar
 * aufbaut statt einfach lange zu fehlen.
 *
 * Der Worker baut seine EIGENE GeoManager-Instanz (der Konstruktor kostet
 * ~2 s für Seen/Flüsse/Bäche) — Instanzen lassen sich nicht über
 * postMessage teilen. Seed und Worldgen-Flags kommen vom Aufrufer, also aus
 * demselben ServerConfig-Handshake wie die Spielwelt.
 */
import {
  createGeo,
  type IGeo,
  getStableHash,
  Biome,
  BiomeArea,
  WATER_LEVEL,
} from '@wov/shared';
import {
  BIOME_COLOR,
  DEEP_WATER,
  SHORE_WATER,
  RIVER_COLOR,
  BIOME_TREE_DENSITY,
  forestDensity,
  treeKindAt,
  TREE_STYLE,
  type RGB,
} from './MapPalette';
import {
  GRID_N,
  HEIGHT_EXAG,
  MAP_RADIUS,
  MAP_SPAN,
  MAP_UNIT,
  SAMPLE_N,
  TEX_N,
  TREE_STEP,
  setzeKartenMasse,
  type MapBuildRequest,
  type MapWorkerMessage,
} from './mapTypes';

// Der Worker läuft ohne DOM-lib-Typen für DedicatedWorkerGlobalScope; der
// Cast hält die Signatur von postMessage sauber, ohne die tsconfig des
// Clients um "WebWorker" zu erweitern (das kollidiert mit der DOM-lib).
const ctx = self as unknown as {
  postMessage(m: MapWorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((e: { data: MapBuildRequest }) => void) | null;
};

const post = (m: MapWorkerMessage, transfer?: Transferable[]): void => ctx.postMessage(m, transfer);
const fortschritt = (anteil: number, text: string): void => post({ t: 'fortschritt', anteil, text });

/** Deterministischer Kleinzufall für Streuung und Drehung der Baumsignaturen. */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Einfärbung einer Weltprobe — dieselbe Logik wie im Offline-Werkzeug
 * `shared/test/geo-map.ts:86`, ergänzt um die Wald-Abdunklung, damit man auf
 * der Karte sieht, wo tatsächlich Wald steht und nicht nur, welches Biome.
 */
function farbe(biome: Biome, hoehe: number, wald: number, out: Uint8Array, o: number): void {
  if (biome === Biome.Ocean || hoehe < WATER_LEVEL) {
    // Wassertiefe: 5 m unter dem Pegel ist Ufer, ab 30 m offene See.
    const tiefe = Math.min(Math.max((WATER_LEVEL - hoehe) / 25, 0), 1);
    out[o] = SHORE_WATER[0] + (DEEP_WATER[0] - SHORE_WATER[0]) * tiefe;
    out[o + 1] = SHORE_WATER[1] + (DEEP_WATER[1] - SHORE_WATER[1]) * tiefe;
    out[o + 2] = SHORE_WATER[2] + (DEEP_WATER[2] - SHORE_WATER[2]) * tiefe;
    return;
  }
  const basis: RGB = BIOME_COLOR[biome] ?? BIOME_COLOR[Biome.None];
  // Höhenschattierung: flaches Land dunkler, Gipfel heller.
  const f = 0.74 + 0.26 * Math.min(Math.max((hoehe - WATER_LEVEL) / 110, -0.5), 1);
  // Wald verdunkelt und entsättigt leicht — je dichter, desto kräftiger.
  const w = 1 - 0.28 * wald;
  out[o] = Math.min(255, basis[0] * f * w);
  out[o + 1] = Math.min(255, basis[1] * f * (1 - 0.18 * wald));
  out[o + 2] = Math.min(255, basis[2] * f * w);
}

function bauen(req: MapBuildRequest): void {
  const start = Date.now();
  fortschritt(0.02, 'Welt wird erzeugt …');

  // Layout-Modus: Maße des Panels übernehmen — dieser Worker ist ein
  // eigener Modulkontext, setzeKartenMasse() im Panel erreicht ihn nicht.
  if (req.span && req.radius) setzeKartenMasse(req.span, req.radius);

  const geo = createGeo({
    mode: req.layout ? 'layout' : 'valheim',
    worldSeed: getStableHash(req.seed),
    layout: req.layout,
    settings: {
      worldGenVersion: req.settings.worldGenVersion ?? 2,
      disableDistantRivers: req.settings.disableDistantRivers ?? false,
      riverAffectsOcean: req.settings.riverAffectsOcean ?? false,
      ashlandsModernNoise: req.settings.ashlandsModernNoise ?? true,
    },
  });

  // ---- 1. Reliefgitter -----------------------------------------------------
  fortschritt(0.12, 'Relief wird vermessen …');
  const gN = GRID_N;
  const schritt = MAP_SPAN / (gN - 1);
  const hoehen = new Float32Array(gN * gN);
  for (let r = 0; r < gN; r++) {
    const wz = -MAP_SPAN / 2 + r * schritt;
    for (let c = 0; c < gN; c++) {
      const wx = -MAP_SPAN / 2 + c * schritt;
      hoehen[r * gN + c] = geo.getHeight(wx, wz);
    }
    if ((r & 63) === 0) fortschritt(0.12 + 0.18 * (r / gN), 'Relief wird vermessen …');
  }

  const positions = new Float32Array(gN * gN * 3);
  const normals = new Float32Array(gN * gN * 3);
  const uvs = new Float32Array(gN * gN * 2);
  const dEinheit = schritt / MAP_UNIT;
  for (let r = 0; r < gN; r++) {
    for (let c = 0; c < gN; c++) {
      const i = r * gN + c;
      const wx = -MAP_SPAN / 2 + c * schritt;
      const wz = -MAP_SPAN / 2 + r * schritt;
      // Der Meeresboden wird bei 12 m unter dem Pegel gekappt: die Karte
      // zeigt die Küste, nicht die Tiefsee, und die Wasserscheibe liegt
      // dadurch nirgends auf dem Grund auf.
      const h = Math.max(hoehen[i], WATER_LEVEL - 12);
      positions[i * 3] = wx / MAP_UNIT;
      positions[i * 3 + 1] = (h / MAP_UNIT) * HEIGHT_EXAG;
      positions[i * 3 + 2] = wz / MAP_UNIT;
      uvs[i * 2] = (wx + MAP_SPAN / 2) / MAP_SPAN;
      uvs[i * 2 + 1] = (wz + MAP_SPAN / 2) / MAP_SPAN;
    }
  }
  // Normalen aus zentralen Differenzen des Höhenfeldes.
  for (let r = 0; r < gN; r++) {
    for (let c = 0; c < gN; c++) {
      const i = r * gN + c;
      const l = positions[(r * gN + Math.max(c - 1, 0)) * 3 + 1];
      const rr = positions[(r * gN + Math.min(c + 1, gN - 1)) * 3 + 1];
      const u = positions[(Math.max(r - 1, 0) * gN + c) * 3 + 1];
      const d = positions[(Math.min(r + 1, gN - 1) * gN + c) * 3 + 1];
      const nx = -(rr - l) / (2 * dEinheit);
      const nz = -(d - u) / (2 * dEinheit);
      const len = Math.hypot(nx, 1, nz);
      normals[i * 3] = nx / len;
      normals[i * 3 + 1] = 1 / len;
      normals[i * 3 + 2] = nz / len;
    }
  }
  // Dreiecke nur innerhalb der Kartenscheibe — so bleibt der Rand rund und
  // die Wasserscheibe darunter schaut nirgends über die Karte hinaus.
  const idx: number[] = [];
  const r2 = MAP_RADIUS * MAP_RADIUS;
  for (let r = 0; r < gN - 1; r++) {
    for (let c = 0; c < gN - 1; c++) {
      const mx = -MAP_SPAN / 2 + (c + 0.5) * schritt;
      const mz = -MAP_SPAN / 2 + (r + 0.5) * schritt;
      if (mx * mx + mz * mz > r2) continue;
      const a = r * gN + c;
      const b = a + 1;
      const cc = a + gN;
      const d = cc + 1;
      // Wicklung im Uhrzeigersinn von oben gesehen — Babylons Standard-Culling
      // wirft die andere Richtung weg, das Relief wäre unsichtbar.
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const indices = new Uint32Array(idx);
  post({ t: 'relief', positions, normals, uvs, indices }, [
    positions.buffer, normals.buffer, uvs.buffer, indices.buffer,
  ]);

  // ---- 2. Kartenbild -------------------------------------------------------
  fortschritt(0.32, 'Biome werden kartiert …');
  const sN = SAMPLE_N;
  const sSchritt = MAP_SPAN / sN;
  const sBiome = new Uint16Array(sN * sN);
  const sHoehe = new Float32Array(sN * sN);
  const sWald = new Float32Array(sN * sN);
  const sFarbe = new Uint8Array(sN * sN * 3);
  const tex = new Uint8Array(TEX_N * TEX_N * 4);
  const BLOCK = 16;
  for (let r0 = 0; r0 < sN; r0 += BLOCK) {
    const r1 = Math.min(r0 + BLOCK, sN);
    for (let r = r0; r < r1; r++) {
      const wz = -MAP_SPAN / 2 + (r + 0.5) * sSchritt;
      for (let c = 0; c < sN; c++) {
        const wx = -MAP_SPAN / 2 + (c + 0.5) * sSchritt;
        const i = r * sN + c;
        const biome = geo.getBiome(wx, wz);
        const h = geo.getBiomeHeight(biome, wx, wz).height;
        const wald = forestDensity(geo.getForestFactor(wx, wz));
        sBiome[i] = biome;
        sHoehe[i] = h;
        sWald[i] = wald;
        farbe(biome, h, h >= WATER_LEVEL ? wald : 0, sFarbe, i * 3);
      }
    }
    // Grobe Vorschau des gerade fertigen Streifens (ohne Glättung) — die
    // endgültige Textur kommt am Stück, sobald Flüsse und Kanten sitzen.
    const skala = TEX_N / sN;
    const ty0 = Math.floor(r0 * skala);
    const ty1 = Math.floor(r1 * skala);
    const teil = new Uint8Array((ty1 - ty0) * TEX_N * 4);
    for (let ty = ty0; ty < ty1; ty++) {
      const sr = Math.min(sN - 1, Math.floor(ty / skala));
      for (let tx = 0; tx < TEX_N; tx++) {
        const sc = Math.min(sN - 1, Math.floor(tx / skala));
        const si = (sr * sN + sc) * 3;
        const o = ((ty - ty0) * TEX_N + tx) * 4;
        teil[o] = sFarbe[si];
        teil[o + 1] = sFarbe[si + 1];
        teil[o + 2] = sFarbe[si + 2];
        teil[o + 3] = 255;
      }
    }
    post({ t: 'texturteil', y: ty0, hoehe: ty1 - ty0, data: teil }, [teil.buffer]);
    fortschritt(0.32 + 0.42 * (r1 / sN), 'Biome werden kartiert …');
  }

  post({ t: 'raster', biome: sBiome, hoehe: sHoehe, wald: sWald, n: sN });

  // Endgültiges Bild: bilinear hochskaliert, damit die Biome-Grenzen weich
  // auslaufen statt in 41-m-Stufen zu treppen.
  fortschritt(0.76, 'Kartenbild wird gezeichnet …');
  const skala = TEX_N / sN;
  for (let ty = 0; ty < TEX_N; ty++) {
    const fy = (ty + 0.5) / skala - 0.5;
    const y0 = Math.min(sN - 1, Math.max(0, Math.floor(fy)));
    const y1 = Math.min(sN - 1, y0 + 1);
    const wy = Math.min(Math.max(fy - y0, 0), 1);
    for (let tx = 0; tx < TEX_N; tx++) {
      const fx = (tx + 0.5) / skala - 0.5;
      const x0 = Math.min(sN - 1, Math.max(0, Math.floor(fx)));
      const x1 = Math.min(sN - 1, x0 + 1);
      const wx = Math.min(Math.max(fx - x0, 0), 1);
      const i00 = (y0 * sN + x0) * 3;
      const i10 = (y0 * sN + x1) * 3;
      const i01 = (y1 * sN + x0) * 3;
      const i11 = (y1 * sN + x1) * 3;
      const o = (ty * TEX_N + tx) * 4;
      for (let k = 0; k < 3; k++) {
        const a = sFarbe[i00 + k] + (sFarbe[i10 + k] - sFarbe[i00 + k]) * wx;
        const b = sFarbe[i01 + k] + (sFarbe[i11 + k] - sFarbe[i01 + k]) * wx;
        tex[o + k] = a + (b - a) * wy;
      }
      tex[o + 3] = 255;
    }
  }

  // Flüsse und Bäche liegen mit 60–100 m Breite unter der Abtastweite des
  // Rasters — ohne sie einzuzeichnen verschwinden sie stellenweise ganz.
  const mProTexel = MAP_SPAN / TEX_N;
  const zeichnePunkt = (px: number, py: number, radiusM: number, f: RGB, alpha: number): void => {
    const cx = (px + MAP_SPAN / 2) / mProTexel;
    const cy = (py + MAP_SPAN / 2) / mProTexel;
    const rad = Math.max(radiusM / mProTexel, 0.7);
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(TEX_N - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(TEX_N - 1, Math.ceil(cy + rad));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d > rad) continue;
        // Im offenen Meer wären die Flussscheiben nur hellblaue Flecken —
        // dort, wo der Fluss ins Meer mündet, hört er also auf. Die
        // Flussbetten selbst liegen unter dem Wasserspiegel, eine Höhenprobe
        // taugt als Kriterium daher nicht.
        const si = Math.min(sN - 1, Math.floor((y / TEX_N) * sN)) * sN
          + Math.min(sN - 1, Math.floor((x / TEX_N) * sN));
        if (sBiome[si] === Biome.Ocean) continue;
        const kante = Math.min(1, (rad - d) / 1.2);
        const a = alpha * kante;
        const o = (y * TEX_N + x) * 4;
        tex[o] += (f[0] - tex[o]) * a;
        tex[o + 1] += (f[1] - tex[o + 1]) * a;
        tex[o + 2] += (f[2] - tex[o + 2]) * a;
      }
    }
  };
  for (const punkte of geo.riverPointMap.values()) {
    for (const p of punkte) zeichnePunkt(p.px, p.py, p.w * 0.55, RIVER_COLOR, 0.6);
  }

  const texKopie = tex.slice();
  post({ t: 'textur', data: texKopie }, [texKopie.buffer]);

  // ---- 3. Baumsignaturen ---------------------------------------------------
  fortschritt(0.88, 'Wälder werden eingetragen …');
  const rnd = mulberry32(getStableHash(req.seed) ^ 0x5f3a91);
  const listen = new Map<number, number[]>();
  for (let wz = -MAP_RADIUS; wz <= MAP_RADIUS; wz += TREE_STEP) {
    for (let wx = -MAP_RADIUS; wx <= MAP_RADIUS; wx += TREE_STEP) {
      if (wx * wx + wz * wz > r2) continue;
      const jx = wx + (rnd() - 0.5) * TREE_STEP * 0.9;
      const jz = wz + (rnd() - 0.5) * TREE_STEP * 0.9;
      const biome = geo.getBiome(jx, jz);
      const dichte = BIOME_TREE_DENSITY[biome] ?? 0;
      if (dichte <= 0) continue;
      const h = geo.getBiomeHeight(biome, jx, jz).height;
      if (h < WATER_LEVEL + 1) continue;
      const ff = geo.getForestFactor(jx, jz);
      // BiomeArea kostet neun Biome-Proben und entscheidet nur im
      // Schwarzwald zwischen Kiefern (Kern) und Fichten (Rand).
      const area = biome === Biome.BlackForest ? geo.getBiomeArea(jx, jz) : BiomeArea.Everything;
      const art = treeKindAt(biome, area, ff, h - WATER_LEVEL);
      if (art === null) continue;
      const w = forestDensity(ff);
      // Fels/Eis stehen unabhängig vom Waldfaktor, Bäume werden mit der
      // Walddichte ausgedünnt.
      const stil = TREE_STYLE[art];
      const chance = stil.form === 'zacke' ? dichte * 0.5 : dichte * (0.25 + 0.75 * w);
      if (rnd() > chance) continue;
      let liste = listen.get(art);
      if (!liste) listen.set(art, (liste = []));
      liste.push(
        jx / MAP_UNIT,
        (h / MAP_UNIT) * HEIGHT_EXAG,
        jz / MAP_UNIT,
        0.75 + rnd() * 0.5,
        rnd() * Math.PI * 2,
      );
    }
  }
  for (const [art, werte] of listen) {
    const data = new Float32Array(werte);
    post({ t: 'baeume', art, data }, [data.buffer]);
  }

  post({ t: 'fertig', dauerMs: Date.now() - start });
}

ctx.onmessage = (e) => {
  try {
    bauen(e.data);
  } catch (err) {
    post({ t: 'fehler', text: err instanceof Error ? err.message : String(err) });
  }
};
