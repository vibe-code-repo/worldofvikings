#!/usr/bin/env node
/**
 * Prüft: wie sich Fackellicht im Grab verteilt — Helligkeitsprofil einer Wand,
 * dazu die Wache gegen „die Fackel leuchtet durch die Wand".
 *
 * How torchlight spreads through the barrow — as a profile, not an impression.
 *
 * Die Sonde stellt sich an den Einstiegspunkt (die Figur laesst sich im Grab
 * nicht versetzen — der Havok-Koerper schreibt `position` im naechsten Bild
 * zurueck, s. relief-kontrast.mjs), blickt in die vier Himmelsrichtungen und
 * gibt zu jedem Bild aus:
 *
 *   · MITTEL, MAX und das 99. Perzentil der Helligkeit im Messfeld,
 *   · den Anteil ueberstrahlter Bildpunkte (>= 250) — das ist die Zahl zu
 *     „die Fackel brennt ein Loch in die Wand",
 *   · den Anteil dunkler Bildpunkte (< 8) — die Zahl zu „zwei Meter weiter
 *     ist nichts mehr",
 *   · ein Profil aus 16 senkrechten Streifen. Es sagt, ob das Licht als
 *     Verlauf ueber die Wand laeuft oder als harter Fleck darauf sitzt.
 *
 * ── Wozu ───────────────────────────────────────────────────────────────
 * Drei Befunde von Mike (05.09.2026) hangen an denselben Zahlen: das Licht
 * verteilt sich „nicht realistisch", es „leuchtet durch eine Wand durch", und
 * die Wand sieht ohne Fackel glatt aus. Alle drei sind Aussagen ueber die
 * VERTEILUNG der Helligkeit auf einer Flaeche — und genau die steht hier.
 *
 * ── Das Grab `licht-probe` ─────────────────────────────────────────────
 * Es ist eine Kopie von `rock-probe` mit ZWEI von Hand gesetzten Fackeln.
 * Die Stellen sind so gewaehlt, dass alles vom EINSTIEGSPUNKT aus im Bild
 * ist — die Figur laesst sich im Grab nicht versetzen. In
 * `server/data/dungeons/dev/licht-probe.json` steht dafuer unter
 * `layout.props`:
 *
 *   { "prefabName": "CryptWallTorch", "prefabHash": 620891044,
 *     "pos": { "x": 0,    "y": 1.7, "z":  1.15 }, ... }   1 m HINTER dem
 *       Abschlusspaneel (0; 0,15), das die Nordkante des Eingangsraums
 *       versiegelt — dahinter ist nichts. Was von dieser Wand her leuchtet,
 *       ist durch 30 cm Stein gekommen.
 *   { "prefabName": "CryptWallTorch", "prefabHash": 620891044,
 *     "pos": { "x": 0.55, "y": 1.7, "z": -3.0  }, ... }   an der Wand der
 *       Kreuzung (0; −3), 1 m von der Figur — der Verteilungstest.
 *
 * Der Server liest die Dokumente EINMAL beim Start (`DungeonManager.load`);
 * nach dem Ablegen der Datei gehoert also ein `systemctl restart
 * wov-server` dazu, sonst misst man ein Grab, das es noch nicht gibt.
 *
 * Aufruf:
 *   node tools/elements/pruefung/fackel-profil.mjs <dungeonId> <marke> [&query]
 *
 * Umgebung:
 *   WOV_FELD    Messrechteck x0,y0,x1,y1 (Vorgabe 200,120,1400,700 — HUD raus)
 *   WOV_HELL    Belichtung (Vorgabe 1 = wie im Spiel)
 *   WOV_DURCH   Obergrenze der mittleren Helligkeit in den beiden Blicken
 *               OHNE Fackel im Raum (Vorgabe 15). Ueberschreitet sie einer,
 *               endet der Lauf ROT: dann leuchtet wieder eine Fackel durch
 *               eine Wand. Nur mit `--pruefe` und nur fuer `licht-probe`.
 *
 * Bilder: ~/.cache/wov-fackel-profil/<dungeonId>-<marke>-<richtung>.png
 * LÄUFT LOKAL gegen den Tunnel (Gedächtnis „Messungen laufen lokal").
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { decode } from '../../lib/png.mjs';

const HOST = process.env.WOV_HOST ?? 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-fackel-profil`;
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const FELD = (process.env.WOV_FELD ?? '200,120,1400,700').split(',').map(Number);
const HELL = Number(process.env.WOV_HELL ?? '1');
const STREIFEN = 16;

const argv = process.argv.slice(2);
const pruefen = argv.includes('--pruefe');
const [dungeonId, marke = 'ist', extraQuery = ''] = argv.filter((a) => a !== '--pruefe');
const DURCH = Number(process.env.WOV_DURCH ?? '15');
if (!dungeonId) {
  console.error('Aufruf: node tools/elements/pruefung/fackel-profil.mjs <dungeonId> <marke> [&query] [--pruefe]');
  process.exit(2);
}

function testToken() {
  const n = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${n}.testlauf`;
}

/** Helligkeitsstatistik und Streifenprofil eines Bildausschnitts. */
function statistik(pfad) {
  const { w, h, ch, data } = decode(pfad);
  const [x0, y0, x1, y1] = FELD;
  const werte = [];
  const streifen = Array.from({ length: STREIFEN }, () => ({ s: 0, n: 0 }));
  const breite = Math.max(1, Math.min(w, x1) - Math.max(0, x0));
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      const o = (y * w + x) * ch;
      const l = ch >= 3 ? 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2] : data[o];
      werte.push(l);
      const k = Math.min(STREIFEN - 1, Math.floor(((x - Math.max(0, x0)) / breite) * STREIFEN));
      streifen[k].s += l;
      streifen[k].n++;
    }
  }
  werte.sort((a, b) => a - b);
  const n = werte.length;
  const mittel = werte.reduce((a, b) => a + b, 0) / n;
  const sigma = Math.sqrt(werte.reduce((a, b) => a + (b - mittel) ** 2, 0) / n);
  return {
    n,
    mittel,
    sigma,
    relativ: sigma / Math.max(mittel, 1e-6),
    p99: werte[Math.floor(n * 0.99)],
    max: werte[n - 1],
    ueberstrahlt: werte.filter((v) => v >= 250).length / n,
    dunkel: werte.filter((v) => v < 8).length / n,
    profil: streifen.map((s) => (s.n ? s.s / s.n : 0)),
  };
}

mkdirSync(ORDNER, { recursive: true });
const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const kontext = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  httpCredentials: {
    username: process.env.WOV_DEV_USER ?? 'Admin',
    password: process.env.WOV_DEV_PASS ?? '!T3mp12345',
  },
});
const seite = await kontext.newPage();
const fehler = [];
seite.on('pageerror', (f) => fehler.push(String(f)));
await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
await seite.goto(
  `${HOST}/?name=Fackel${Date.now().toString(36).slice(-5)}&dungeon=${dungeonId}${extraQuery}`,
  { waitUntil: 'domcontentloaded', timeout: 120_000 }
);
await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
await seite.waitForTimeout(12_000);
await seite.mouse.click(800, 450);
await seite.waitForTimeout(400);
if (HELL !== 1) {
  await seite.evaluate((e) => { window.__dbg.scene.imageProcessingConfiguration.exposure = e; }, HELL);
}

const kopf = await seite.evaluate(() => {
  const p = window.__dbg.player.position;
  return {
    spieler: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
    fackeln: window.__dbg.fackeln.zustand,
  };
});
console.log(`${dungeonId} / ${marke}  Stelle ${JSON.stringify(kopf.spieler)}  ${kopf.fackeln}  Feld ${FELD.join(',')}`);

// Die Marken heissen nach dem GIERWINKEL, nicht nach einer Himmelsrichtung:
// `_yaw = 0` blickt gemessen nach −z, nicht nach +z. Ein Name, der das
// Gegenteil behauptet, waere die Sorte Fehler, die man in einem Bericht nie
// mehr findet — deshalb steht die Blickrichtung in JEDER Zeile.
//
// Ohne HUD messen: Die Konsolenzeilen unten rechts sind konstante helle
// Pixel und wuerden jede Zahl mitverschieben. Das Messfeld schliesst sie aus.
const werte = {};
for (const [tag, yaw] of [['gier0', 0], ['gier90', Math.PI / 2], ['gier180', Math.PI], ['gier270', -Math.PI / 2]]) {
  await seite.evaluate((y) => {
    const p = window.__dbg.player;
    p._yaw = y; p._figurYaw = y; p._pitch = -0.02;
  }, yaw);
  await seite.waitForTimeout(900);
  const pfad = `${ORDNER}/${dungeonId}-${marke}-${tag}.png`;
  await seite.screenshot({ path: pfad });
  const blick = await seite.evaluate(() => {
    const f = window.__dbg.scene.activeCamera.getForwardRay(1).direction;
    return [+f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2)];
  });
  const s = statistik(pfad);
  werte[tag] = s.mittel;
  console.log(
    `${tag.padEnd(7)} Blick [${blick.join(' ')}]  ø${s.mittel.toFixed(2)}  σ${s.sigma.toFixed(2)}  ` +
    `σ/µ ${s.relativ.toFixed(3)}  p99 ${s.p99.toFixed(1)}  ueberstrahlt ${(s.ueberstrahlt * 100).toFixed(2)}%  ` +
    `dunkel ${(s.dunkel * 100).toFixed(1)}%`
  );
  console.log(`        Profil ${s.profil.map((v) => v.toFixed(0).padStart(4)).join('')}`);
}
console.log(`Bilder ${ORDNER}/${dungeonId}-${marke}-*.png`);
if (fehler.length) console.log(`Seitenfehler ${fehler.length}: ${fehler[0].slice(0, 200)}`);

// ── Die Pruefung: leuchtet eine Fackel wieder durch eine Wand? ──────────
// `gier90` und `gier270` zeigen im Grab `licht-probe` auf Waende, hinter
// denen eine Fackel steht — im Raum davor brennt keine. Sie MUESSEN dunkel
// sein. Am 05.09.2026 waren sie es nicht: ø61,7 und ø39,0, weil das
// Steinmaterial die abgewandte Seite beleuchtete (s. DungeonSteinMaterial,
// `twoSidedLighting`). Nach der Behebung ø8,3 und ø7,3.
//
// Die Schwelle liegt bei 15 und damit deutlich ueber dem gemessenen
// Grundlicht (~7) und deutlich unter dem Befund (~39). Sie ist eine
// Grenze, keine Nachbildung des Messwerts — ein Test, der auf 8,3 klemmt,
// faellt beim naechsten Nebelwert um.
if (pruefen) {
  const gruende = [];
  for (const tag of ['gier90', 'gier270']) {
    if (werte[tag] > DURCH) {
      gruende.push(`${tag}: ø${werte[tag].toFixed(2)} ueber der Schwelle ${DURCH} — Licht kommt durch die Wand`);
    }
  }
  if (gruende.length) {
    console.log('\nROT:');
    for (const g of gruende) console.log(`  - ${g}`);
    await kontext.close();
    await browser.close();
    process.exit(1);
  }
  console.log('\nGRUEN: keine Wand wird von hinten beleuchtet.');
}
await kontext.close();
await browser.close();
