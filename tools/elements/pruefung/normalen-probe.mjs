#!/usr/bin/env node
/**
 * Zeigt die Normale eines Kit-Moduls IM SPIEL zur Seite, in die sie zeigen
 * soll? — und was der übersetzte Shader daraus macht.
 * Does a kit module's normal point where it should — and what does the
 * compiled shader make of it?
 *
 * ── Warum es diese Sonde gibt ──────────────────────────────────────────
 * Am 05.09.2026 sahen die Fels-Wände „glatt" aus, das Fackellicht verteilte
 * sich unsinnig, und eine Fackel leuchtete durch die Wand hinter ihr. Drei
 * Befunde, EINE Ursache — und sie steht nicht im Bild, sondern im
 * Normalenattribut: Die raumseitige Fläche der Korridorwand bei x = +0,74
 * trug die mittlere Normale (+0,666, 0,002, 0,006). Sie zeigt IN die Wand.
 *
 * Das ist kein Modellfehler: `make-stonevault.py` spiegelt die Module in x
 * vor, damit Babylons `__root__` sie zurückdreht — von innen sieht man
 * danach die RÜCKSEITEN. Babylon dreht `normalW` dafür aber nur um, wenn
 * das Material `twoSidedLighting` trägt; ohne das Define rechnet die ganze
 * Beleuchtung mit einer Normalen, die vom Betrachter wegzeigt.
 *
 * Die Sonde misst deshalb BEIDES: das rohe Attribut (das sich nicht ändert)
 * und die `#define`-Zeile im übersetzten Shader (die sich ändert). Ohne die
 * zweite Zahl misst man womöglich zweimal denselben Shader und nennt den
 * Unterschied Rauschen — dasselbe Muster wie in `relief-kontrast.mjs`.
 *
 * Aufruf:
 *   node tools/elements/pruefung/normalen-probe.mjs <dungeonId> [modul]
 *
 * LÄUFT LOKAL gegen den Tunnel (Gedächtnis „Messungen laufen lokal").
 */
import { chromium } from 'playwright';

const HOST = process.env.WOV_HOST ?? 'https://play.dev.world-of-vikings.com';
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const [dungeonId, modul = 'RockVaultCorridor'] = process.argv.slice(2);
if (!dungeonId) {
  console.error('Aufruf: node tools/elements/pruefung/normalen-probe.mjs <dungeonId> [modul]');
  process.exit(2);
}

function testToken() {
  const n = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${n}.testlauf`;
}

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const kontext = await browser.newContext({
  viewport: { width: 800, height: 600 },
  httpCredentials: {
    username: process.env.WOV_DEV_USER ?? 'Admin',
    password: process.env.WOV_DEV_PASS ?? '!T3mp12345',
  },
});
const seite = await kontext.newPage();
await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
await seite.goto(
  `${HOST}/?name=Norm${Date.now().toString(36).slice(-5)}&dungeon=${dungeonId}`,
  { waitUntil: 'domcontentloaded', timeout: 120_000 }
);
await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
await seite.waitForTimeout(12_000);

const messung = await seite.evaluate((name) => {
  const s = window.__dbg.scene;
  const m = s.meshes.find((x) => x.name === name);
  if (!m) return { fehler: `Mesh ${name} steht nicht in der Szene` };
  const pos = m.getVerticesData('position');
  const nor = m.getVerticesData('normal');
  if (!pos || !nor) return { fehler: `Mesh ${name} hat keine Normalen` };

  /** Mittlere Normale aller Ecken in einem Kasten des LOKALEN Modellraums. */
  const mittel = (px0, px1, py0, py1) => {
    let n = 0, x = 0, y = 0, z = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < px0 || pos[i] > px1) continue;
      if (pos[i + 1] < py0 || pos[i + 1] > py1) continue;
      n++; x += nor[i]; y += nor[i + 1]; z += nor[i + 2];
    }
    return n ? { n, mittel: [+(x / n).toFixed(3), +(y / n).toFixed(3), +(z / n).toFixed(3)] } : { n: 0 };
  };

  const defines = (m.subMeshes?.[0]?.effect?.defines ?? '')
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => /^#define (STEIN|TWOSIDED|VERTEXCOLOR|FACKELLICHT)/.test(z));

  return {
    modul: name,
    // Die Reliefschicht der Wand bei +x. Ihre raumseitige Flaeche MUSS nach
    // -x zeigen; +x heisst „die Normale zeigt in die Wand".
    wandPlusX: mittel(0.60, 0.80, 1.0, 2.5),
    wandMinusX: mittel(-0.80, -0.60, 1.0, 2.5),
    // Die Deckenunterseite bei y = 3,5. Sie MUSS nach -y zeigen.
    decke: mittel(-0.4, 0.4, 3.4, 3.55),
    material: m.material?.name ?? null,
    backFaceCulling: m.material?.backFaceCulling ?? null,
    twoSidedLighting: m.material?.twoSidedLighting ?? null,
    defines,
  };
}, modul);

console.log(JSON.stringify(messung, null, 1));
await kontext.close();
await browser.close();
