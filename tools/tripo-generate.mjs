#!/usr/bin/env node
/**
 * Erzeugt ein Modell über die Tripo-API und legt es spielfertig ab.
 *
 *     TRIPO_API_SECRET=tsk_... node tools/tripo-generate.mjs \
 *       --name KiPine --hoehe 9 --faces 5000 --prompt "A stylized low-poly ..."
 *
 * Danach steht die GLB unter `assets/models/<name>.glb`, und das Skript
 * druckt den fertigen `HINT_DEFS`-Eintrag für `shared/src/prefabs.ts`.
 *
 * ── Warum ein eigenes Skript und nicht der Tripo-MCP-Server ──────────
 * Der offizielle MCP (VAST-AI-Research/tripo-mcp) importiert ausschliesslich
 * in eine laufende Blender-Instanz — ohne Blender kommt keine Datei heraus.
 * Der Community-Server (pasie15) liefert nur Download-URLs und lässt offen,
 * welche Generierungsparameter er durchreicht. Genau die brauchen wir aber:
 *
 * ── face_limit ist der wichtigste Parameter ──────────────────────────
 * Ohne ihn liefert Tripo die Rohausgabe. Gemessen am ersten Baum, der so
 * entstand: 1.907.396 Dreiecke und 70 MB für EIN Modell. Zum Vergleich hat
 * das Original `Pinetree_01` aus Valheim 2.532 Dreiecke — Faktor 753. Für
 * einen einzelnen Blickfang geht das noch, ein Wald daraus ist unmöglich.
 *
 * ── Tripo normiert auf 1×1×1 ─────────────────────────────────────────
 * Die Modelle kommen unabhängig vom Motiv mit Kantenlänge ~1 (gemessen:
 * Bounding-Box 0.98 hoch). Ohne Skalierung steht ein kniehoher Baum in der
 * Welt. Das Skript misst die Box und rechnet die `localScale` aus, die das
 * Modell auf `--hoehe` bringt.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELLE = join(ROOT, 'assets/models');
const API = 'https://api.tripo3d.ai/v2/openapi';

const SCHLUESSEL = process.env.TRIPO_API_SECRET ?? process.env.TRIPO_KEY;
if (!SCHLUESSEL) {
  console.error('TRIPO_API_SECRET fehlt. Key auf platform.tripo3d.ai holen und setzen:\n' +
    '  TRIPO_API_SECRET=tsk_... node tools/tripo-generate.mjs --name … --prompt …');
  process.exit(1);
}

/**
 * --schlüssel wert → { schlüssel: wert }, --flag → { flag: true }
 *
 * Der Sonderfall ist das Flag als LETZTES Argument: dort gibt es kein
 * argv[i+1], und eine Kurzschreibweise über `?.` liefert dann undefined
 * statt true — das Flag wäre stillschweigend wirkungslos.
 */
function argumente(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const naechstes = argv[i + 1];
    a[argv[i].slice(2)] = naechstes === undefined || naechstes.startsWith('--') ? true : argv[++i];
  }
  return a;
}

const arg = argumente(process.argv.slice(2));
if (!arg.name || (!arg.prompt && !arg.task)) {
  console.error('Aufruf: --name <Prefab> --prompt "<Beschreibung>" [--hoehe 9] [--faces 5000]\n' +
    '        --name <Prefab> --task <id>   (bereits laufende Generierung übernehmen)');
  process.exit(1);
}
const NAME = arg.name;
const ZIELHOEHE = Number(arg.hoehe ?? 0);
const FACES = Number(arg.faces ?? 5000);
/**
 * Ohne Angabe nimmt die API v2.5-20250123 (Januar 2025) — deren Texturen
 * sind bei Naturmotiven ein diffuses Farbrauschen ohne Materialstruktur
 * (nachgesehen an einer 4096²-Baumtextur: keine Rinde, keine Nadeln, nur
 * Flecken). v3.1 ist der aktuelle Stand und deshalb hier der Vorgabewert.
 */
const VERSION = arg.version ?? 'v3.1-20260211';

async function api(pfad, init = {}) {
  const antwort = await fetch(`${API}${pfad}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SCHLUESSEL}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const daten = await antwort.json();
  if (daten.code !== 0) throw new Error(`Tripo ${daten.code}: ${daten.message ?? JSON.stringify(daten)}`);
  return daten.data;
}

async function starte(prompt) {
  // quad:false — Vierecke sind für Rigging und Subdivision gedacht; eine
  // Echtzeit-Engine trianguliert sie ohnehin, und Tripos Triangle-Pfad hält
  // das face_limit genauer ein.
  const { task_id } = await api('/task', {
    method: 'POST',
    body: JSON.stringify({
      type: 'text_to_model',
      prompt,
      model_version: VERSION,
      face_limit: FACES,
      quad: false,
      pbr: true,
      texture: true,
      texture_quality: 'detailed',
    }),
  });
  return task_id;
}

async function warte(id) {
  let zuletzt = -1;
  for (let i = 0; i < 120; i++) {
    const d = await api(`/task/${id}`);
    if (d.progress !== zuletzt) {
      process.stdout.write(`\r  ${d.status} ${d.progress ?? 0} %   `);
      zuletzt = d.progress;
    }
    if (d.status === 'success') { console.log(); return d; }
    if (['failed', 'banned', 'expired', 'cancelled'].includes(d.status)) {
      throw new Error(`Generierung ${d.status}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Zeitüberschreitung nach 10 Minuten');
}

/** Zerlegt eine GLB in JSON-Chunk und unveränderten Rest (BIN-Chunk). */
function zerlege(datei) {
  const b = readFileSync(datei);
  if (b.readUInt32BE(0) !== 0x676c5446) throw new Error('keine GLB-Datei');
  const laenge = b.readUInt32LE(12);
  return { json: JSON.parse(b.slice(20, 20 + laenge).toString()), bin: b.slice(20 + laenge) };
}

/**
 * Legt die Unterkante des Modells auf y = 0.
 *
 * Tripo liefert nicht einheitlich: Das erste Modell kam mit der Unterkante
 * exakt bei 0, das zweite um den Mittelpunkt zentriert (y = -0.501). Weil
 * Objekte in der Welt an ihrer ZDO-Position AUFSITZEN, steckt ein zentriert
 * exportierter Baum zur Hälfte im Boden — bei localScale 9 sind das 4,5 m.
 *
 * Korrigiert wird über eine Translation auf der Wurzel-Node statt über die
 * Vertexdaten: Das ist der glTF-konforme Weg, lässt den BIN-Chunk
 * unangetastet und wird von Babylon in die localMatrix der Master gebacken.
 */
function setzePivotAufUnterkante(datei) {
  const { json, bin } = zerlege(datei);
  const versatz = -untenY(json);
  if (Math.abs(versatz) < 1e-4) return 0;

  for (const i of json.scenes?.[json.scene ?? 0]?.nodes ?? []) {
    const n = json.nodes[i];
    if (n.matrix) throw new Error('Wurzel-Node trägt eine Matrix — Pivot nicht automatisch korrigierbar');
    n.translation = [
      (n.translation?.[0] ?? 0),
      (n.translation?.[1] ?? 0) + versatz,
      (n.translation?.[2] ?? 0),
    ];
  }

  // JSON-Chunk auf 4 Byte mit Leerzeichen padden (glTF-Spec 4.4.2).
  let roh = Buffer.from(JSON.stringify(json), 'utf8');
  if (roh.length % 4) roh = Buffer.concat([roh, Buffer.alloc(4 - (roh.length % 4), 0x20)]);
  const kopf = Buffer.alloc(20);
  kopf.writeUInt32BE(0x676c5446, 0);
  kopf.writeUInt32LE(2, 4);
  kopf.writeUInt32LE(20 + roh.length + bin.length, 8);
  kopf.writeUInt32LE(roh.length, 12);
  kopf.write('JSON', 16, 'ascii');
  writeFileSync(datei, Buffer.concat([kopf, roh, bin]));
  return versatz;
}

/** Tiefster Punkt aller Meshes, inklusive Translation der Wurzel-Nodes. */
function untenY(json) {
  let unten = Infinity;
  const proMesh = (json.meshes ?? []).map((m) =>
    Math.min(...m.primitives.map((p) => json.accessors[p.attributes.POSITION].min?.[1] ?? Infinity))
  );
  for (const i of json.scenes?.[json.scene ?? 0]?.nodes ?? []) {
    const n = json.nodes[i];
    const dy = n.translation?.[1] ?? 0;
    if (n.mesh != null) unten = Math.min(unten, proMesh[n.mesh] + dy);
    for (const k of n.children ?? []) {
      const kind = json.nodes[k];
      if (kind.mesh != null) unten = Math.min(unten, proMesh[kind.mesh] + dy + (kind.translation?.[1] ?? 0));
    }
  }
  return Number.isFinite(unten) ? unten : 0;
}

/**
 * Liest Geometriekennzahlen direkt aus dem JSON-Chunk der GLB.
 *
 * Ein voller glTF-Parser wäre hier Überbau: Kopfdaten und Accessor-Angaben
 * reichen für Dreiecke und Bounding-Box, und die Datei kann hundert MB
 * gross sein.
 */
function vermesse(datei) {
  const { json: j } = zerlege(datei);
  let vertices = 0, dreiecke = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of j.meshes ?? []) {
    for (const p of m.primitives) {
      const acc = j.accessors[p.attributes.POSITION];
      vertices += acc.count;
      if (p.indices != null) dreiecke += j.accessors[p.indices].count / 3;
      for (let i = 0; i < 3; i++) {
        if (acc.min) min[i] = Math.min(min[i], acc.min[i]);
        if (acc.max) max[i] = Math.max(max[i], acc.max[i]);
      }
    }
  }
  const bilder = (j.images ?? []).map((im) => ({
    name: im.name ?? '',
    mb: j.bufferViews[im.bufferView].byteLength / 1e6,
  }));
  return {
    vertices, dreiecke: Math.round(dreiecke),
    groesse: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    // Unterkante MIT Node-Translation — nur die zählt für das Aufsitzen.
    unten: untenY(j),
    bilder,
    materialien: (j.materials ?? []).length,
  };
}

const id = arg.task ?? (await starte(arg.prompt));
if (!arg.task) console.log(`Task ${id} gestartet (${VERSION}, face_limit ${FACES})`);
const ergebnis = await warte(id);

const url = ergebnis.output?.pbr_model ?? ergebnis.output?.model;
if (!url) throw new Error(`keine Modell-URL in der Antwort: ${JSON.stringify(ergebnis.output)}`);

mkdirSync(MODELLE, { recursive: true });
const ziel = join(MODELLE, `${NAME}.glb`);
if (existsSync(ziel) && !arg.force) {
  console.error(`${ziel} existiert bereits — mit --force überschreiben.`);
  process.exit(1);
}
const roh = Buffer.from(await (await fetch(url)).arrayBuffer());
writeFileSync(ziel, roh);

const versatz = arg['kein-pivot'] ? 0 : setzePivotAufUnterkante(ziel);

const m = vermesse(ziel);
console.log(`\n${ziel}  (${(roh.length / 1e6).toFixed(1)} MB)`);
console.log(`  ${m.dreiecke.toLocaleString('de')} Dreiecke, ${m.vertices.toLocaleString('de')} Vertices, ${m.materialien} Material(ien)`);
console.log(`  Bounding-Box ${m.groesse.map((v) => v.toFixed(2)).join(' × ')}  (Unterkante y=${m.unten.toFixed(3)})`);
if (versatz) console.log(`  Pivot um ${versatz > 0 ? '+' : ''}${versatz.toFixed(3)} verschoben — Unterkante sitzt jetzt auf 0`);
for (const b of m.bilder) console.log(`  Textur ${b.name || '(unbenannt)'}: ${b.mb.toFixed(1)} MB`);

// Zum Vergleich der Originalbaum, an dem sich das Budget bemisst.
const ORIGINAL_PINETREE = 2532;
if (m.dreiecke > ORIGINAL_PINETREE * 4) {
  console.log(`\n  ⚠ ${(m.dreiecke / ORIGINAL_PINETREE).toFixed(0)}× so viele Dreiecke wie Pinetree_01 (${ORIGINAL_PINETREE}).`);
  console.log('    Für einen Einzelbaum tragbar, für Vegetation zu schwer — face_limit senken.');
}

if (ZIELHOEHE > 0 && m.groesse[1] > 0) {
  const skala = ZIELHOEHE / m.groesse[1];
  console.log(`\nEintrag für shared/src/prefabs.ts (HINT_DEFS):\n`);
  console.log(`  { ...def('${NAME}', F.TREE_BASE | F.PERSISTENT, null, ${(m.groesse[0] * skala).toFixed(1)}, ${ZIELHOEHE.toFixed(1)}, '${NAME}'),`);
  console.log(`    localScale: { x: ${skala.toFixed(2)}, y: ${skala.toFixed(2)}, z: ${skala.toFixed(2)} } },`);
  if (Math.abs(m.unten) > 0.01) {
    const tief = (m.unten * skala).toFixed(1);
    console.log(`\n  ⚠ Unterkante liegt bei y=${m.unten.toFixed(3)} statt 0 — das Modell ` +
      `${m.unten < 0 ? `steckt ${Math.abs(tief)} m im Boden` : `schwebt ${tief} m über dem Boden`}.`);
  }
}
