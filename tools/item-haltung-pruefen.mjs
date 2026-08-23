// Gegenprobe zur Haltung aus itemDefs.ts — rechnet nach, statt zu zeigen.
//
//     node tools/item-haltung-pruefen.mjs [Gegenstandsname]
//
// Laeuft LOKAL gegen den Tunnel :5274; auf wov-dev startet kein Chromium.
// Der Gegenstand muss im Offline-Startkit liegen (client/src/main.ts).
//
// Erwartet wird die in Blender bestimmte Lage:
//   Klinge zeigt zu den Fingern              → Winkel zu +Y_hand ≈ 0°
//   Schneide zeigt nach vorn                 → Winkel zu +X_hand ≈ 0°
//   Spitze etwa 0,135 + 0,179 m von der Hand → ≈ 0,31 m
import { chromium } from 'playwright';

const NAME = process.argv[2] ?? 'Messer';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('pageerror', e => console.log('SEITENFEHLER', e.message));
await p.goto('http://localhost:5274/?offline', { waitUntil: 'load' });
await p.waitForFunction(() => {
  const h = window.__dbg?.player?.avatar?.handR;
  return h && h.scaling.x < 0.9;
}, null, { timeout: 180000 });

console.log(JSON.stringify(await p.evaluate(async (NAME) => {
  const d = window.__dbg;
  d.equipment.equip(d.inventory.all.find(s => s?.shared?.name === NAME));
  for (let i = 0; i < 60 && d.player.avatar.handR.getChildren().length === 0; i++)
    await new Promise(r => setTimeout(r, 250));

  const hand = d.player.avatar.handR;
  const netze = d.scene.meshes.filter(m => m.name.toLowerCase().startsWith(NAME.toLowerCase()));
  hand.computeWorldMatrix(true);
  for (const m of netze) m.computeWorldMatrix(true);

  const BV = hand.getAbsolutePosition().constructor;
  const hp = hand.getAbsolutePosition();
  const HW = hand.getWorldMatrix();
  const O = BV.TransformCoordinates(new BV(0, 0, 0), HW);
  const achse = a => BV.TransformCoordinates(new BV(...a), HW).subtract(O).normalize();
  const winkel = (u, v) => +(Math.acos(Math.max(-1, Math.min(1, BV.Dot(u, v))))
    * 180 / Math.PI).toFixed(1);

  const M = netze[1].getWorldMatrix();            // Klinge (Stahl)
  const spitze = BV.TransformCoordinates(new BV(0, 0, -0.179), M);
  const knauf = BV.TransformCoordinates(new BV(0, 0, 0.101), netze[0].getWorldMatrix());
  const klinge = spitze.subtract(knauf).normalize();
  // Schneide zeigt im Modell nach -Y (Blenders -Z wird beim Export zu -Y).
  const schneide = BV.TransformCoordinates(new BV(0, -1, 0), M)
    .subtract(BV.TransformCoordinates(new BV(0, 0, 0), M)).normalize();

  return {
    klingeZuFingern_grad: winkel(klinge, achse([0, 1, 0])),
    schneideNachVorn_grad: winkel(schneide, achse([1, 0, 0])),
    spitzeAbstand_m: +spitze.subtract(hp).length().toFixed(3),
    knaufAbstand_m: +knauf.subtract(hp).length().toFixed(3),
    versatzQuer_m: +BV.Dot(knauf.subtract(hp), achse([1, 0, 0])).toFixed(3),
  };
}, NAME), null, 1));
await b.close();
