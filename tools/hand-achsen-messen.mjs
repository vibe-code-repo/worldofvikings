// Misst, wie die Knochenachsen der Hand im Spiel liegen — als Brücke
// zwischen der in Blender gefundenen Haltung und `holdRotation`.
//
// Offene Frage: Blenders Knochen-+Y läuft vom Handgelenk zu den Knöcheln.
// Gilt das im Babylon-Knoten auch? Der glTF-Export kann Knochenachsen
// mitdrehen — hergeleitet wäre das eine Vermutung, gemessen ist es keine.
import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('pageerror', e => console.log('SEITENFEHLER', e.message));
await p.goto('http://localhost:5274/?offline', { waitUntil: 'load' });
await p.waitForFunction(() => {
  const h = window.__dbg?.player?.avatar?.handR;
  return h && h.scaling.x < 0.9;
}, null, { timeout: 180000 });

console.log(JSON.stringify(await p.evaluate(async () => {
  const d = window.__dbg;
  const stapel = d.inventory.all.find(s => s?.shared?.name === 'Messer');
  d.equipment.equip(stapel);
  for (let i = 0; i < 60 && d.player.avatar.handR.getChildren().length === 0; i++)
    await new Promise(r => setTimeout(r, 250));

  const hand = d.player.avatar.handR;
  const halter = hand.getChildren()[0];
  halter.position.setAll(0);
  halter.rotation.setAll(0);
  hand.computeWorldMatrix(true);
  halter.computeWorldMatrix(true);
  const netze = d.scene.meshes.filter(m => /messer/i.test(m.name));
  for (const m of netze) m.computeWorldMatrix(true);

  const BV = hand.getAbsolutePosition().constructor;
  const r = v => [v.x, v.y, v.z].map(z => +z.toFixed(3));
  const norm = v => { const l = Math.hypot(v.x, v.y, v.z) || 1;
    return [+(v.x / l).toFixed(3), +(v.y / l).toFixed(3), +(v.z / l).toFixed(3)]; };

  const hp = hand.getAbsolutePosition();
  // Richtung "zu den Fingern": der naechste Knoten unter R_Hand im Skelett.
  const handKnochen = hand.parent;
  const finger = handKnochen.getChildren().filter(c => c !== hand);
  const fingerRichtung = finger.length
    ? norm(finger[0].getAbsolutePosition().subtract(hp)) : null;

  // Wohin zeigt die Klinge bei Drehung NULL? Spitze liegt im Modell
  // bei -Z (Blender +Y wird beim Export zu -Z), Knauf bei +Z.
  const M = netze[1].getWorldMatrix();
  const spitze = BV.TransformCoordinates(new BV(0, 0, -0.179), M);
  const knauf = BV.TransformCoordinates(new BV(0, 0, 0.101), M);

  // Die drei lokalen Achsen des Handknotens in Weltrichtungen
  const O = BV.TransformCoordinates(new BV(0, 0, 0), hand.getWorldMatrix());
  const achse = a => norm(BV.TransformCoordinates(new BV(...a), hand.getWorldMatrix()).subtract(O));

  return {
    handWelt: r(hp),
    fingerknoten: finger.map(f => f.name),
    zuDenFingern: fingerRichtung,
    klingeRichtung: norm(spitze.subtract(knauf)),
    handAchseX: achse([1, 0, 0]),
    handAchseY: achse([0, 1, 0]),
    handAchseZ: achse([0, 0, 1]),
  };
}), null, 1));
await b.close();
