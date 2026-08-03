#!/usr/bin/env node
/**
 * Holt echte Texturen aus dem Client-Export zurück.
 *
 * ── Das Problem ─────────────────────────────────────────────────────
 * 2.639 von 2.763 PNGs in `assets/textures/` sind **0 Byte** (95 %) —
 * der Export hat zwar die Dateinamen, aber nicht die Bilddaten
 * geschrieben. Ein Shader, der so eine Datei sampelt, bekommt Schwarz
 * oder Müll. Genau das war die Ursache dafür, dass der Wasser-Schaum
 * "absolut nicht realistisch" aussah: `foam.png`, `foam_highres.png`,
 * `random_foam.png`, `water_foam.png` — alle leer.
 *
 * ── Die Rettung ─────────────────────────────────────────────────────
 * Die Bilddaten sind NICHT verloren. Unter
 *   /root/Valheim_Client/extracted_assets/Texture2D/
 * liegen 1.605 echte PNGs — nur nach Unity-PathID benannt
 * (`unnamed_<PathID>.png`) statt nach Klarnamen. Die Zuordnung liefern
 * die Material-Assets unter
 *   /root/Valheim_Client/extracted_assets/Material/
 * die BEIDES enthalten: einen Klarnamen (`m_Name`, z. B. "water") und
 * die Textur-Slots mit ihren PathIDs (`m_SavedProperties.m_TexEnvs`,
 * z. B. `_FoamTex` → PathID -305452523777261620).
 *
 * Damit lässt sich jede Textur, die von einem benannten Material
 * benutzt wird, gezielt zurückholen — das ist der Weg für alle weiteren
 * fehlenden Texturen (NPCs, Props, Gebäude).
 *
 * ── Aufruf ──────────────────────────────────────────────────────────
 *   node tools/recover-textures.mjs --list water        Slots anzeigen
 *   node tools/recover-textures.mjs water               alle Slots kopieren
 *   node tools/recover-textures.mjs water _FoamTex=water_foam_real.png
 *
 * Ohne explizites Ziel landet ein Slot als
 * `<material>__<slot>.png` in assets/textures/.
 */
import { readdirSync, readFileSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = process.env.VALHEIM_CLIENT ?? '/root/Valheim_Client';
const MAT_DIR = join(CLIENT, 'extracted_assets', 'Material');
const TEX_DIR = join(CLIENT, 'extracted_assets', 'Texture2D');
const OUT_DIR = join(ROOT, 'assets', 'textures');

const args = process.argv.slice(2);
const listOnly = args[0] === '--list';
if (listOnly) args.shift();
const materialName = args.shift();

if (!materialName) {
  console.error('Aufruf: node tools/recover-textures.mjs [--list] <MaterialName> [_Slot=datei.png ...]');
  process.exit(2);
}
if (!existsSync(MAT_DIR) || !existsSync(TEX_DIR)) {
  console.error(`Client-Export nicht gefunden unter ${CLIENT} (per VALHEIM_CLIENT überschreibbar)`);
  process.exit(2);
}

/** Explizite Slot→Dateiname-Zuordnungen aus der Kommandozeile. */
const explicit = new Map();
for (const a of args) {
  const eq = a.indexOf('=');
  if (eq > 0) explicit.set(a.slice(0, eq), a.slice(eq + 1));
}

// WICHTIG: NICHT JSON.parse für die PathIDs benutzen. Unity-PathIDs sind
// vorzeichenbehaftete 64-Bit-Ganzzahlen; JSON.parse macht daraus IEEE-754-
// Doubles und verliert oberhalb von 2^53 Stellen. Konkret wurde aus
//   -305452523777261620  →  -305452523777261630
// und die Datei `unnamed_-305452523777261620.png` galt fälschlich als
// "nicht im Export". Deshalb werden Name und Slots direkt aus dem
// Rohtext gelesen, die ID bleibt eine Zeichenkette.
const NAME_RE = /"m_Name"\s*:\s*"([^"]*)"/;
const TEXENV_RE =
  /"(_\w+)"\s*,\s*\{\s*"m_Texture"\s*:\s*\{\s*"m_FileID"\s*:\s*-?\d+\s*,\s*"m_PathID"\s*:\s*(-?\d+)/g;

let matText = null;
for (const f of readdirSync(MAT_DIR)) {
  if (!f.endsWith('.json')) continue;
  let text;
  try {
    text = readFileSync(join(MAT_DIR, f), 'utf8');
  } catch {
    continue; // beschädigte/leere Einträge überspringen
  }
  if (NAME_RE.exec(text)?.[1] === materialName) {
    matText = text;
    break;
  }
}
if (!matText) {
  console.error(`Kein Material mit m_Name "${materialName}" gefunden.`);
  process.exit(1);
}

const texEnvs = [...matText.matchAll(TEXENV_RE)].map((m) => [m[1], m[2]]);
let copied = 0;
let missing = 0;
for (const [slot, pathId] of texEnvs) {
  if (pathId === '0') continue; // Slot im Material nicht belegt
  const src = join(TEX_DIR, `unnamed_${pathId}.png`);
  if (!existsSync(src)) {
    console.log(`  ${slot.padEnd(16)} PathID ${pathId}  → nicht im Export`);
    missing++;
    continue;
  }
  const size = statSync(src).size;
  if (listOnly) {
    console.log(`  ${slot.padEnd(16)} PathID ${pathId}  ${size} Byte`);
    continue;
  }
  const target = join(OUT_DIR, explicit.get(slot) ?? `${materialName}__${slot}.png`);
  copyFileSync(src, target);
  console.log(`  ${slot.padEnd(16)} → ${target.replace(ROOT + '/', '')}  (${size} Byte)`);
  copied++;
}

if (listOnly) {
  console.log(`\nMaterial "${materialName}": ${texEnvs.length} Slots, ${missing} davon nicht im Export.`);
} else {
  console.log(`\n${copied} Textur(en) kopiert, ${missing} im Export nicht vorhanden.`);
}
