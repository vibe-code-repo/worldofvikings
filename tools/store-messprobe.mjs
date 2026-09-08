#!/usr/bin/env node
/**
 * store-messprobe — liest GLB-Rohdaten des Asset-Stores (und der alten
 * eigenen Modelle) und beantwortet die Fragen, die man SONST ANNIMMT:
 * Wo liegt der Ursprung, in welcher Einheit ist gebaut, ist irgendwo im
 * Knotenbaum gespiegelt (negative Determinante), wo sitzt das
 * asymmetrische Merkmal, welche Knoten sind Kollisionsnetze.
 *
 * Der Anlass: die Store-Modelle (570 Prefabs unter ~/wov-assets/store)
 * sollen in den alten Client. Bevor irgendjemand einen Spiegel- oder
 * Drehschalter setzt, muss gemessen sein, was in den Dateien STEHT —
 * die Vault-Notiz „Modellmasse nicht annehmen" ist genau dafür da.
 *
 * Gemessen wird ohne Babylon und ohne three: nur GLB-JSON + BIN, die
 * Knotenmatrix-Kette wortgleich nach `tools/glb-size-check.mjs` (dieselbe
 * Rechnung, die die Manifest-Werte erzeugt hat — eine zweite, nur
 * ähnliche Matrixmathematik wäre die Sorte Fehlerquelle, die eine
 * Messprobe ausschliessen soll).
 *
 *   node tools/store-messprobe.mjs <datei-oder-id> [...]   Einzelbericht (JSON)
 *   node tools/store-messprobe.mjs --uebersicht            Zensus über den GANZEN Store
 *
 * Argumente sind entweder Prefab-Ids aus `prefabs.json`
 * (`environment-sm-veh-cart-01`), Store-Pfade (`environment/sm-veh-cart-01`)
 * oder Namen aus `assets/models/` (`BirkeHoch1`).
 *
 * Der Store liegt ausserhalb des Repos; sein Ort kommt aus
 * `$WOV_STORE` (Vorgabe `assets/store`, dort als Symlink).
 *
 * Reads raw GLB data from the asset store: origin, units, mirrored nodes,
 * asymmetric feature position, collision nodes. No engine involved.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const STORE = resolve(process.env.WOV_STORE ?? join(WURZEL, 'assets', 'store'));
const MODELLE = resolve(process.env.WOV_MODELLE ?? join(WURZEL, 'assets', 'models'));

/** Namensmuster, an denen ein reines Kollisionsnetz zu erkennen ist. */
const KOLLISIONS_MUSTER = /(^|[-_])col(lision)?([-_.]|$)/i;

// ── GLB lesen ────────────────────────────────────────────────────────────
function parseGlb(path) {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('kein GLB');
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
  // Der BIN-Chunk folgt auf den JSON-Chunk; sein Kopf ist 8 Byte.
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart);
  return { json, bin, bytes: b.length };
}

function nodeLocalMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    s[0] * (1 - (yy + zz)), s[0] * (xy - wz), s[0] * (xz + wy), 0,
    s[1] * (xy + wz), s[1] * (1 - (xx + zz)), s[1] * (yz - wx), 0,
    s[2] * (xz - wy), s[2] * (yz + wx), s[2] * (1 - (xx + yy)), 0,
    t[0], t[1], t[2], 1,
  ];
}

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
  return o;
}

function xform(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

/** Determinante des 3x3-Anteils — negativ heisst: dieser Zweig ist gespiegelt. */
function det3(m) {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5])
  );
}

const KOMPONENTEN = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/**
 * Positionen eines Accessors lesen — mit STRIDE.
 *
 * Der Interleave-Fall ist kein Sonderfall: die Store-GLBs kommen aus
 * einem Unity-Export, und `byteStride` steht dort an den BufferViews.
 * `glb-size-check.mjs` liest dicht gepackt und läge hier daneben.
 */
function readPositions(json, bin, ai) {
  const a = json.accessors[ai];
  const v = json.bufferViews[a.bufferView];
  const komp = KOMPONENTEN[a.type];
  const gross = BYTES[a.componentType];
  const stride = v.byteStride ?? komp * gross;
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < 3; k++) out[i * 3 + k] = bin.readFloatLE(off + i * stride + k * 4);
  return out;
}

function dreiecke(json, prim) {
  if (prim.indices !== undefined) return Math.floor(json.accessors[prim.indices].count / 3);
  return Math.floor(json.accessors[prim.attributes.POSITION].count / 3);
}

// ── Messung ──────────────────────────────────────────────────────────────
function messe(path) {
  const { json, bin, bytes } = parseGlb(path);
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];

  const huelle = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  const kollisionHuelle = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  const gespiegelteKnoten = [];
  const skalierteKnoten = [];
  const kollisionsKnoten = [];
  const hierarchie = [];
  let tris = 0;
  let kollisionTris = 0;
  let meshKnoten = 0;
  let leereMeshes = 0;
  // Das asymmetrische Merkmal: der Vertex mit dem groessten |x| und der
  // mit dem groessten |z|. Er ist der Zeuge fuer „gespiegelt oder nicht" —
  // eine Huellbox allein sagt darueber nichts, weil sie bei einer
  // Spiegelung an x=0 gleich BLEIBT, wenn das Modell zufaellig symmetrisch
  // steht. Diese beiden Punkte tun das nicht.
  let extremX = null;
  let extremZ = null;

  function walk(i, pm, tiefe, kollisionErbe) {
    const n = nodes[i] ?? {};
    const lokal = nodeLocalMatrix(n);
    const m = mul(pm, lokal);
    const name = n.name ?? `node${i}`;
    const istKollision = kollisionErbe || KOLLISIONS_MUSTER.test(name);
    if (istKollision && !kollisionErbe) kollisionsKnoten.push(name);
    const d = det3(lokal);
    if (d < 0) gespiegelteKnoten.push({ name, scale: n.scale ?? null, det: +d.toFixed(4) });
    if (n.scale && n.scale.some((s) => Math.abs(Math.abs(s) - 1) > 0.001))
      skalierteKnoten.push({ name, scale: n.scale });
    // Der WELTORT des Knotenursprungs. Er ist der beste Zeuge, den ein
    // Export hergibt: `SM_Veh_Cart_01_Wheel_fl` sagt selbst, wo links
    // vorne ist. Steht dasselbe Rad in Babylon auf der anderen Seite,
    // ist gespiegelt worden — ohne dass eine Huellbox das verraten haette.
    const ort = xform(m, [0, 0, 0]).map((v) => +v.toFixed(4));
    hierarchie.push({ tiefe, name, mesh: n.mesh !== undefined, kollision: istKollision, ort });

    if (n.mesh !== undefined) {
      meshKnoten++;
      let hatVertices = false;
      const eigen = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
      for (const prim of meshes[n.mesh].primitives ?? []) {
        if (prim.attributes?.POSITION === undefined) continue;
        hatVertices = true;
        const t = dreiecke(json, prim);
        if (istKollision) kollisionTris += t;
        else tris += t;
        const pos = readPositions(json, bin, prim.attributes.POSITION);
        const ziel = istKollision ? kollisionHuelle : huelle;
        for (let k = 0; k < pos.length; k += 3) {
          const w = xform(m, [pos[k], pos[k + 1], pos[k + 2]]);
          for (let a = 0; a < 3; a++) {
            if (w[a] < ziel.min[a]) ziel.min[a] = w[a];
            if (w[a] > ziel.max[a]) ziel.max[a] = w[a];
            if (w[a] < eigen.min[a]) eigen.min[a] = w[a];
            if (w[a] > eigen.max[a]) eigen.max[a] = w[a];
          }
          if (istKollision) continue;
          if (!extremX || Math.abs(w[0]) > Math.abs(extremX[0])) extremX = w;
          if (!extremZ || Math.abs(w[2]) > Math.abs(extremZ[2])) extremZ = w;
        }
      }
      if (!hatVertices) leereMeshes++;
      else {
        const eintrag = hierarchie[hierarchie.length - 1];
        eintrag.mitte = eigen.min.map((v, a) => +((v + eigen.max[a]) / 2).toFixed(4));
      }
    }
    for (const c of n.children ?? []) walk(c, m, tiefe + 1, istKollision);
  }

  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of json.scenes[json.scene ?? 0].nodes) walk(r, I, 0, false);

  const rund = (v) => v.map((x) => +x.toFixed(4));
  const leer = huelle.min[0] > 1e8;
  return {
    datei: relative(WURZEL, path),
    bytes,
    knoten: nodes.length,
    meshKnoten,
    leereMeshes,
    dreiecke: tris,
    materialien: (json.materials ?? []).length,
    bilder: (json.images ?? []).length,
    animationen: (json.animations ?? []).map((a) => a.name ?? '?'),
    skins: (json.skins ?? []).length,
    generator: json.asset?.generator ?? null,
    huelle: leer ? null : { min: rund(huelle.min), max: rund(huelle.max) },
    groesse: leer ? null : rund(huelle.max.map((v, i) => v - huelle.min[i])),
    minY: leer ? null : +huelle.min[1].toFixed(4),
    extremX: extremX ? rund(extremX) : null,
    extremZ: extremZ ? rund(extremZ) : null,
    gespiegelteKnoten,
    skalierteKnoten: skalierteKnoten.slice(0, 8),
    kollisionsKnoten,
    kollisionDreiecke: kollisionTris,
    kollisionHuelle:
      kollisionHuelle.min[0] > 1e8
        ? null
        : { min: rund(kollisionHuelle.min), max: rund(kollisionHuelle.max) },
    hierarchie: hierarchie.slice(0, 40),
    hierarchieGekuerzt: hierarchie.length > 40 ? hierarchie.length : 0,
  };
}

// ── Auflösung eines Arguments auf eine Datei ─────────────────────────────
function ladePrefabs() {
  const p = join(STORE, 'prefabs.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')).prefabs : [];
}

function aufloesen(arg, prefabs) {
  const treffer = prefabs.find((x) => x.id === arg);
  if (treffer) return { pfad: join(STORE, treffer.asset), prefab: treffer };
  for (const kandidat of [
    join(STORE, arg),
    join(STORE, `${arg}.glb`),
    join(MODELLE, arg),
    join(MODELLE, `${arg}.glb`),
    resolve(arg),
  ]) {
    if (existsSync(kandidat) && statSync(kandidat).isFile()) return { pfad: kandidat, prefab: null };
  }
  throw new Error(`nicht gefunden: ${arg}`);
}

// ── Zensus über den ganzen Store ─────────────────────────────────────────
function alleGlb(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) alleGlb(p, out);
    else if (e.name.endsWith('.glb')) out.push(p);
  }
  return out;
}

function uebersicht() {
  const dateien = alleGlb(STORE);
  const prefabs = ladePrefabs();
  const nachAsset = new Map(prefabs.map((p) => [p.asset, p]));
  const bericht = {
    dateien: dateien.length,
    prefabs: prefabs.length,
    gespiegelt: [],
    unterBoden: [],
    riesen: [],
    leer: [],
    kollisionsdateien: [],
    kollisionsknotenIn: [],
    ursprungAufBoden: 0,
    fehler: [],
  };
  for (const d of dateien) {
    const rel = relative(STORE, d);
    let m;
    try {
      m = messe(d);
    } catch (e) {
      bericht.fehler.push({ datei: rel, fehler: String(e.message) });
      continue;
    }
    if (KOLLISIONS_MUSTER.test(rel)) bericht.kollisionsdateien.push(rel);
    if (m.kollisionsKnoten.length) bericht.kollisionsknotenIn.push({ datei: rel, knoten: m.kollisionsKnoten });
    if (m.gespiegelteKnoten.length)
      bericht.gespiegelt.push({ datei: rel, knoten: m.gespiegelteKnoten.slice(0, 3) });
    if (!m.huelle) {
      bericht.leer.push(rel);
      continue;
    }
    if (Math.abs(m.minY) < 0.001) bericht.ursprungAufBoden++;
    else if (m.minY < -0.05)
      bericht.unterBoden.push({ datei: rel, minY: m.minY, prefabMinY: nachAsset.get(rel)?.bounds?.min?.[1] ?? null });
    const groesste = Math.max(...m.groesse);
    if (groesste > 80) bericht.riesen.push({ datei: rel, groesse: m.groesse });
  }
  return bericht;
}

// ── Aufruf ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args[0] === '--uebersicht') {
  console.log(JSON.stringify(uebersicht(), null, 1));
} else if (args.length === 0) {
  console.error('Aufruf: node tools/store-messprobe.mjs <id|pfad|modellname> ... | --uebersicht');
  process.exit(2);
} else {
  const prefabs = ladePrefabs();
  const out = [];
  for (const a of args) {
    try {
      const { pfad, prefab } = aufloesen(a, prefabs);
      const m = messe(pfad);
      // Der Abgleich gegen das Manifest ist der Grund, warum hier ueberhaupt
      // gemessen wird: stimmt die eigene Rechnung nicht mit dem ueberein,
      // was der Store BEHAUPTET, ist eine der beiden Zahlen falsch — und
      // das muss man wissen, bevor man auf ihnen aufbaut.
      let abgleich = null;
      if (prefab?.bounds && m.huelle) {
        const d = (p, i) => +(m.huelle[p][i] - prefab.bounds[p][i]).toFixed(4);
        abgleich = {
          prefabBounds: prefab.bounds,
          abweichungMin: [d('min', 0), d('min', 1), d('min', 2)],
          abweichungMax: [d('max', 0), d('max', 1), d('max', 2)],
          kollision: prefab.collision,
        };
      }
      out.push({ argument: a, prefabId: prefab?.id ?? null, ...m, abgleich });
    } catch (e) {
      out.push({ argument: a, fehler: String(e.message) });
    }
  }
  console.log(JSON.stringify(out, null, 1));
}
