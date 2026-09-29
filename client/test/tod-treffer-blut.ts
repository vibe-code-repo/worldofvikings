/**
 * Blood on every blow (KampfEffekte): why it showed only once, and that it shows every time now.
 *
 * Cause of "blood only at the first wolf bite" (Mike, 29.09.2026): every burst built a NEW particle system with
 * `disposeOnStop = true`. Babylon disposes a system's TEXTURE together with it (`dispose(disposeTexture = true)`),
 * but the textures sit in the cache of KampfEffekte and belong to every burst. After the first burst had died, the
 * shared `punkt_hart.png` / `blut_spritzer.png` were disposed — every later blood (and spark, and splinter) drew nothing.
 *
 *  [1] After the first blood has died away the shared textures are still alive (red on origin/main: disposed).
 *  [2] Blood 2, 3, 4 ... each puts real particles into the world (not only the first).
 *  [3] A pack: 20 blows within a second never make more than POOL_MAX systems per burst kind, all bursts are visible together.
 *  [4] Spaced blows reuse ONE system per kind (the pool works), each one still emits.
 *  [5] Hard hits (sparks, splinters) and the parry flash use the same pool and survive their first burst too.
 *  [6] dispose() removes every system and every texture.
 *
 * Run: npx tsx client/test/tod-treffer-blut.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { KampfEffekte, TREFFER_FLEISCH, TREFFER_HART, TREFFER_PARADE } from '../src/engine/KampfEffekte.js';

// The NullEngine never finishes an effect compile: Babylon would not animate a system (`isReady()` stays false) and
// crashes when it draws one. The path under test (textures, pool, emission, disposal) does not depend on the shader:
// let the systems animate and skip only the draw call.
(ParticleSystem.prototype as unknown as { isReady: () => boolean }).isReady = () => true;
(ParticleSystem.prototype as unknown as { render: () => number }).render = () => 0;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const engine = new NullEngine();
engine.getDeltaTime = () => 16;
const POOL_MAX = 6;

/** A scene with a camera; `render(n)` = n frames of 16 ms; the counters look at the scene, so they also run on the old code. */
function neueSzene() {
  const scene = new Scene(engine);
  scene.useConstantAnimationDeltaTime = true;
  new FreeCamera('kamera', new Vector3(0, 1, -5), scene);
  const render = (n: number): void => { for (let i = 0; i < n; i++) scene.render(); };
  const systeme = (name: string): ParticleSystem[] => scene.particleSystems.filter((p) => p.name === name) as ParticleSystem[];
  const aktiv = (name: string): number => systeme(name).reduce((s, p) => s + p.getActiveCount(), 0);
  return { scene, render, systeme, aktiv };
}
const texturen = (ke: KampfEffekte): Map<string, { getInternalTexture(): unknown }> => (ke as unknown as { texturen: Map<string, { getInternalTexture(): unknown }> }).texturen;
const ort = (x: number) => new Vector3(x, 1.2, 0);

const { scene, render, systeme, aktiv } = neueSzene();
const ke = new KampfEffekte(scene);

console.log('\n[1] The first blood must not take the shared textures with it');
ke.treffer(ort(0), TREFFER_FLEISCH);
render(3);
check('blood 1: particles are alive right after the blow', aktiv('blut_tropfen') > 50 && aktiv('blut_spritzer') >= 1, `${aktiv('blut_tropfen')} drops, ${aktiv('blut_spritzer')} splashes`);
render(80); // ~1.3 s: every particle (life 0.3 - 0.5 s) is dead, the systems have stopped
check('blood 1 has died away completely', aktiv('blut_tropfen') === 0 && aktiv('blut_spritzer') === 0);
const tex = texturen(ke);
check('the shared blood textures are alive (punkt_hart, blut_spritzer)', tex.get('punkt_hart.png')?.getInternalTexture() != null && tex.get('blut_spritzer.png')?.getInternalTexture() != null,
  `punkt_hart ${tex.get('punkt_hart.png')?.getInternalTexture() != null ? 'alive' : 'DISPOSED'}, blut_spritzer ${tex.get('blut_spritzer.png')?.getInternalTexture() != null ? 'alive' : 'DISPOSED'}`);
check('every cached texture is still alive', [...tex.values()].every((t) => t.getInternalTexture() != null), `${tex.size} textures`);

console.log('\n[2] Blood 2, 3, 4 ... are as visible as blood 1');
for (let i = 2; i <= 5; i++) {
  ke.treffer(ort(i), TREFFER_FLEISCH);
  render(3);
  const n = aktiv('blut_tropfen');
  const texOk = systeme('blut_tropfen').length > 0 && systeme('blut_tropfen').every((p) => p.particleTexture?.getInternalTexture() != null);
  check(`blood ${i}: ${n} drops alive, the textures of its systems are alive`, n > 50 && texOk);
  render(80);
}

console.log('\n[3] A pack: 20 blows in a second');
for (let i = 0; i < 20; i++) { ke.treffer(ort(i * 0.1), TREFFER_FLEISCH); render(3); }
const laufend = systeme('blut_tropfen').filter((p) => p.isStarted()).length;
console.log(`      blood systems in the scene: ${systeme('blut_tropfen').length} drops + ${systeme('blut_spritzer').length} splashes, ${laufend} running; all systems: ${scene.particleSystems.length}`);
check(`never more than ${POOL_MAX} systems per burst kind`, systeme('blut_tropfen').length <= POOL_MAX && systeme('blut_spritzer').length <= POOL_MAX, `${systeme('blut_tropfen').length}`);
check('the blows overlap: several blood systems are alive at once (each blow is seen)', laufend >= 3, `${laufend} running`);
check('the pool size is what the class reports', KampfEffekte.POOL_MAX === POOL_MAX && ke.poolGroessen.blut_tropfen === systeme('blut_tropfen').length);
render(120);

console.log('\n[4] Spaced blows reuse one system (a fresh scene)');
{
  const s2 = neueSzene();
  const ke2 = new KampfEffekte(s2.scene);
  let sichtbar = 0;
  for (let i = 0; i < 6; i++) {
    ke2.treffer(ort(10 + i), TREFFER_FLEISCH);
    s2.render(3);
    if (s2.aktiv('blut_tropfen') > 50) sichtbar++;
    s2.render(80);
  }
  check('6 spaced blows: all 6 emit', sichtbar === 6, `${sichtbar}`);
  check('and they used ONE system per kind (kept, not built and thrown away)', s2.systeme('blut_tropfen').length === 1 && s2.systeme('blut_spritzer').length === 1, `${s2.systeme('blut_tropfen').length} + ${s2.systeme('blut_spritzer').length}`);
  check('the emitter sits at the newest blow (x = 15)', Math.abs((s2.systeme('blut_tropfen')[0]!.emitter as Vector3).x - 15) < 1e-9);
  ke2.dispose();
}

console.log('\n[5] Hard hits and the parry flash');
for (let i = 0; i < 3; i++) {
  ke.treffer(ort(20 + i), TREFFER_HART);
  render(3);
  check(`hard hit ${i + 1}: sparks and splinters alive`, aktiv('treffer_funken') >= 3 && aktiv('treffer_splitter') >= 5, `${aktiv('treffer_funken')} sparks, ${aktiv('treffer_splitter')} splinters`);
  render(80);
}
for (let i = 0; i < 2; i++) {
  ke.treffer(ort(30 + i), TREFFER_PARADE);
  render(3);
  check(`parry ${i + 1}: flash alive`, aktiv('parade_funke') >= 1, `${aktiv('parade_funke')}`);
  render(40);
}

console.log('\n[6] dispose');
ke.dispose();
check('no particle system is left in the scene', scene.particleSystems.length === 0, `${scene.particleSystems.length}`);
check('every texture was released', [...texturen(ke).values()].length === 0);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
