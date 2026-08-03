/**
 * Etappe-4-Verifikation: Bau-Modus, Modus-Menü und die Terrain-Operationen
 * über das echte Werkzeug.
 *
 * Jeder Abschnitt läuft an einer eigenen, unberührten Weltstelle — sonst
 * verschieben frühere Eingriffe das Ziel des nächsten Tests.
 *
 * Aufruf: node tools/pw-placement-check.mjs [url] [outdir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const url = process.argv[2] ?? 'http://localhost:5274/?offline=1&t=0.35';
const outDir = process.argv[3] ?? '/tmp/claude-0/-root-valheim-babylon/c908a284-e68f-40e4-9cf1-4e2877d70dbe/scratchpad';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
let page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!cond) failures++;
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__dbg?.placement != null, { timeout: 120000 });
await page.waitForTimeout(4000);

// Pointer-Lock gibt es headless nicht; der InputManager wertet Maustasten nur
// bei aktivem Lock aus. Das Flag muss VOR JEDEM Klick neu gesetzt werden: ein
// Linksklick aufs Canvas ruft requestPointerLock() auf, das hier fehlschlägt
// und per pointerlockchange das Flag wieder auf false zieht. Im echten Browser
// tritt das nicht auf, dort ist der Lock danach aktiv.
// Das Flag wird festgenagelt statt nur gesetzt: requestPointerLock() schlägt
// headless ASYNCHRON fehl, das nachlaufende pointerlockchange würde es sonst
// mitten in der Klickfolge wieder auf false ziehen.
await page.evaluate(() => {
  Object.defineProperty(window.__dbg.input, 'pointerLocked', {
    get: () => true,
    set: () => {},
    configurable: true,
  });
});
const click = async (button = 'left') => {
  await page.mouse.down({ button });
  await page.mouse.up({ button });
};

/**
 * Wartet, bis die Render-Schleife das Event verarbeitet hat. Unter SwiftShader
 * läuft sie mit ~0 fps — ein fester Timeout von einer halben Sekunde reicht
 * dort nicht einmal für einen einzigen Frame.
 */
const waitFor = (fn, what, arg) =>
  page.waitForFunction(fn, arg, { timeout: 15000, polling: 100 })
    .catch(() => console.log(`   TIMEOUT beim Warten auf ${what}`));
/** Klick, der auf eine zusätzliche Terrain-Operation wartet. */
const clickAndWait = async () => {
  const n = await ops();
  await click();
  await waitFor(
    (prev) => [...window.__dbg.world.heightmaps.listTerrainComps()]
      .reduce((a, c) => a + c.ops, 0) > prev,
    'Operation', n);
};

// Nach unten schauen — im Standardblickwinkel liegt der Bodentreffer weiter
// als die 5 m Reichweite, dann gibt es korrekterweise kein gültiges Ziel.
await page.evaluate(() => { window.__dbg.player._pitch = 1.1; });

/** Setzt den Spieler an eine frische Stelle und wartet auf ein Ziel. */
const WATER_LEVEL = 30;
/**
 * Setzt den Spieler an eine frische Stelle. Gibt die Bodenhöhe zurück —
 * liegt sie unter dem Wasserspiegel, sind die Messungen dort wertlos.
 */
const moveTo = async (x, z) => {
  const h = await page.evaluate(([px, pz]) => {
    const d = window.__dbg;
    const y = d.world.getGroundHeight(px, pz);
    d.player.position.set(px, y, pz);
    return y;
  }, [x, z]);
  await page.waitForTimeout(900);
  if (h < WATER_LEVEL) console.log(`   HINWEIS: (${x},${z}) liegt bei ${h.toFixed(1)} m unter Wasser`);
  return h;
};
const aim = () => page.evaluate(() => window.__dbg.placement.lastHitDebug);
const probe = (x, z) => page.evaluate(([px, pz]) => window.__dbg.world.getGroundHeight(px, pz), [x, z]);
const ops = () => page.evaluate(() =>
  [...window.__dbg.world.heightmaps.listTerrainComps()].reduce((n, c) => n + c.ops, 0));

// ── 1. Werkzeug mit PieceTable geht in den Bau-Modus ──────────────
console.log('── Bau-Modus ──');
await page.keyboard.press('Digit1'); // Hoe
await page.waitForTimeout(2500);
const s1 = await page.evaluate(() => ({
  tool: window.__dbg.equipment.rightItem?.shared.name ?? null,
  inPlaceMode: window.__dbg.equipment.inPlaceMode,
  modes: window.__dbg.placement.pieces.map((p) => p.name),
  piece: window.__dbg.placement.selectedPiece?.name ?? null,
}));
check('Hoe ausgerüstet', s1.tool === 'Hoe', s1.tool);
check('Bau-Modus aktiv', s1.inPlaceMode);
check('fünf Modi verfügbar', s1.modes.length === 5, s1.modes.join(','));
check('Vorauswahl ist levelground', s1.piece === 'levelground', s1.piece);
check('Ziel erfasst', (await aim()) != null);

// ── 2. Aufschütten ────────────────────────────────────────────────
console.log('── Aufschütten ──');
await moveTo(20, 0);
await page.evaluate(() => window.__dbg.placement.selectPiece('raise'));
await page.waitForTimeout(400);
const a3 = await aim();
const before3 = await probe(a3.x, a3.z);
for (let i = 0; i < 3; i++) await clickAndWait();
const after3 = await probe(a3.x, a3.z);
check('Boden steigt', after3 - before3 > 1.0, `${(after3 - before3).toFixed(3)} m nach 3 Schlägen`);

// ── Cooldown ──
// Bewusst NICHT gemessen: ein Klick über Playwright kostet hier mehrere
// hundert Millisekunden (evaluate-Roundtrip + SwiftShader bei ~0 fps), also
// mehr als die 0,4 s PLACE_DELAY. Ein Test dafür würde die Umgebung messen,
// nicht den Code. Der Wert steht als Konstante in PlacementController.

// ── 3. Einebnen auf Fußhöhe (m_allowAltGroundPlacement) ───────────
console.log('── Einebnen ──');
await moveTo(0, 20);
await page.evaluate(() => window.__dbg.placement.selectPiece('levelground'));
await page.waitForTimeout(600);
const a5 = await aim();
const playerY = await page.evaluate(() => window.__dbg.player.position.y);
await clickAndWait();
const after5 = await probe(a5.x, a5.z);
// levelground plättet auf die Fußhöhe und glättet danach (smoothRadius 3),
// der Zielpunkt liegt also nahe der Fußhöhe, nicht exakt darauf.
check('Boden wird auf die Fußhöhe des Spielers gezogen',
  Math.abs(after5 - playerY) < 0.25,
  `Boden ${after5.toFixed(3)} vs Fuß ${playerY.toFixed(3)}`);


// ══ Zweite Sitzung ══════════════════════════════════════════════════
//
// Bewusst eine frische Seite: unter SwiftShader (~0 fps) bricht die
// Render-Schleife nach wenigen Terrain-Operationen ein, weil jede davon
// grass.dropZones() auslöst und ganze Clutter-Zellen neu aufgebaut werden
// müssen. Ohne Frame gibt es keine Eingabeverarbeitung, und alle folgenden
// Klicks laufen ins Leere. Das ist eine Grenze der Testumgebung — im Browser
// mit echter GPU tritt es nicht auf. (Der eigentliche Fix ist der feinere
// resetGrass(x, z, radius) aus Etappe 6.)
await page.close();
page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__dbg?.placement != null, { timeout: 120000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  Object.defineProperty(window.__dbg.input, 'pointerLocked', { get: () => true, set: () => {}, configurable: true });
  window.__dbg.player._pitch = 1.1;
});
await page.keyboard.press('Digit1');
await page.waitForTimeout(2500);

// ── 1. Pickaxe: kein Bau-Modus, gräbt über den Angriffspfad ───────
console.log('── Pickaxe ──');
await moveTo(-20, 0);
await page.keyboard.press('Digit2');
await page.waitForTimeout(2500);
const s6 = await page.evaluate(() => ({
  tool: window.__dbg.equipment.rightItem?.shared.name ?? null,
  inPlaceMode: window.__dbg.equipment.inPlaceMode,
  piece: window.__dbg.placement.selectedPiece?.name ?? null,
}));
check('Pickaxe ausgerüstet', s6.tool === 'PickaxeAntler', s6.tool);
check('kein Bau-Modus', !s6.inPlaceMode);
check('kein Piece', s6.piece === null);

const a6 = await aim();
const before6 = await probe(a6.x, a6.z);
const ops6 = await ops();
for (let i = 0; i < 2; i++) await clickAndWait();
const after6 = await probe(a6.x, a6.z);
const opsDelta = (await ops()) - ops6;
check('Operationen kommen an', opsDelta === 2, `+${opsDelta}`);
check('Boden sinkt', before6 - after6 > 0.3, `${(before6 - after6).toFixed(3)} m nach 2 Schlägen`);

await page.keyboard.press('Digit1'); // zurück zur Hoe
await page.waitForTimeout(2500);

// ── 2. RMB öffnet und schließt das Modus-Menü ─────────────────────
console.log('── Modus-Menü ──');
await click('right');
await waitFor(() => window.__dbg.placement.menuOpen === true, 'geöffnetes Menü');
check('RMB öffnet', await page.evaluate(() => window.__dbg.placement.menuOpen));
const cells = await page.evaluate(() => document.querySelectorAll('[title]').length);
check('Menü zeigt Einträge', cells >= 5, `${cells}`);

await click('right');
await waitFor(() => window.__dbg.placement.menuOpen === false, 'geschlossenes Menü');
check('RMB schließt', !(await page.evaluate(() => window.__dbg.placement.menuOpen)));

// KEIN Screenshot mitten im Ablauf: page.screenshot() löst unter SwiftShader
// einen GPU-Stall aus (ReadPixels), von dem sich die Render-Schleife nicht
// mehr erholt — danach wird kein Klick mehr verarbeitet. Bilder entstehen
// deshalb erst ganz am Ende.

// Bilder ganz zum Schluss, wenn keine Eingabe mehr verarbeitet werden muss.
await page
  .waitForFunction(() => !document.body.textContent.includes('Die Welt erwacht'), { timeout: 240000 })
  .catch(() => console.log('WARN: Ladeblende blieb'));
await page.screenshot({ path: `${outDir}/place-result.png`, timeout: 120000 });
await page.evaluate(() => { window.__dbg.placement.menuOpen = true; });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/place-menu.png`, timeout: 120000 });

console.log('');
console.log(errors.length ? `Konsolenfehler: ${errors.slice(0, 8).join(' | ')}` : 'keine Konsolenfehler');
console.log(failures === 0 ? '=== ALLE PLATZIERUNGS-TESTS BESTANDEN ===' : `=== ${failures} FEHLGESCHLAGEN ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
