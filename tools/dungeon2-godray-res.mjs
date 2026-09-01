// Gegenprobe für die Godray-Auflösung: rendert Stufe Hoch mit Godrays AN und AUS
// und misst die Schärfe (mittlerer Betrag der Nachbarpixel-Differenz). Ein
// VolumetricLightScattering-Pass mit postProcessRatio < 1 rendert das ganze Bild
// in Bruchteil-Auflösung — dann bricht die Schärfe bei „an" gegenüber „aus" ein,
// und viele Nachbarpaare werden identisch (Blöcke aus dem Hochskalieren).
//
// Counter-check for the godray resolution: renders tier High with godrays ON and
// OFF and measures sharpness (mean absolute neighbour-pixel difference). A
// VolumetricLightScattering pass with postProcessRatio < 1 renders the whole
// frame at fractional resolution — sharpness collapses vs OFF and many neighbour
// pairs become identical (upscaled blocks).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = Number(process.env.DG2_PORT || 5901);
const SEED = Number(process.env.DG2_SEED || 2);
const ORDNER = `${process.env.HOME}/.cache/wov-tripo-test`;
// ANGLE/Vulkan statt SwiftShader (Vault). / ANGLE/Vulkan, not SwiftShader.
const GPU = [
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

const HOLE = () => {
  const c = document.querySelector('canvas');
  const t = document.createElement('canvas');
  t.width = c.width;
  t.height = c.height;
  const ctx = t.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(c, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const licht = new Array(c.width * c.height);
  for (let i = 0; i < licht.length; i++) {
    const p = i * 4;
    licht[i] = Math.round(d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114);
  }
  return { breite: c.width, hoehe: c.height, licht, png: t.toDataURL('image/png') };
};

function schaerfe(licht, w, h) {
  // Mittiger Streifen, horizontale Nachbarn. / Central band, horizontal neighbours.
  let summe = 0,
    gleich = 0,
    paare = 0;
  for (let y = Math.floor(h * 0.25); y < Math.floor(h * 0.75); y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = licht[y * w + x];
      const b = licht[y * w + x + 1];
      const diff = Math.abs(a - b);
      summe += diff;
      if (diff < 1) gleich++;
      paare++;
    }
  }
  return { kantenMittel: +(summe / paare).toFixed(3), anteilGleich: +(gleich / paare).toFixed(4) };
}

async function bild(seite, query) {
  const url = `http://localhost:${PORT}/dungeon2.html?seed=${SEED}&stufe=2&ambient=0.35&${query}`;
  await seite.goto(url, { waitUntil: 'domcontentloaded' });
  await seite.waitForFunction(() => window.__dg2 !== undefined, null, { timeout: 120000 });
  await seite.waitForTimeout(4500); // Shader-Übersetzung + einige Bilder / shader compile + frames
  return seite.evaluate(HOLE);
}

function speichere(name, datenUrl) {
  mkdirSync(ORDNER, { recursive: true });
  writeFileSync(`${ORDNER}/dungeon2-godray-${name}.png`, Buffer.from(datenUrl.split(',')[1], 'base64'));
}

const browser = await chromium.launch({ headless: true, args: GPU });
const seite = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const an = await bild(seite, 'godrays=1');
const aus = await bild(seite, 'godrays=0');
await browser.close();

const sAn = schaerfe(an.licht, an.breite, an.hoehe);
const sAus = schaerfe(aus.licht, aus.breite, aus.hoehe);
speichere('an', an.png);
speichere('aus', aus.png);

const verhaeltnis = +(sAn.kantenMittel / sAus.kantenMittel).toFixed(3);
console.log(JSON.stringify({ godraysAn: sAn, godraysAus: sAus, schaerfeVerhaeltnis: verhaeltnis }, null, 2));
// Urteil: Godrays dürfen die Schärfe nicht nennenswert senken. Unter 0,8 =
// das Bild ist bei „an" spürbar unschärfer → Auflösungsfehler (ROT).
// Verdict: godrays must not noticeably lower sharpness. Below 0.8 = the ON
// image is markedly softer → resolution bug (RED).
const ok = verhaeltnis >= 0.8;
console.log(ok ? 'GRUEN: Godrays senken die Auflösung nicht' : 'ROT: Godrays senken die Auflösung');
process.exit(ok ? 0 : 1);
