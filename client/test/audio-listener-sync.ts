/**
 * ListenerSync (client/src/engine/Audio/ListenerSync.ts): the spatial
 * audio listener must follow the camera every frame. NullEngine, real
 * UniversalCamera (same class client/src/player/PlayerController.ts
 * uses), plain stub for the listener — no AudioContext needed.
 *
 * Lauf: npx tsx client/test/audio-listener-sync.ts   (aus dem Repo-Wurzel)
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { syncListenerPosition } from '../src/engine/Audio/ListenerSync';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

console.log('=== ListenerSync ===');

const engine = new NullEngine();
const scene = new Scene(engine);
const camera = new UniversalCamera('cam', new Vector3(1, 2, 3), scene);

console.log('\n[1] Listener übernimmt die Kameraposition:');
{
  const listener = { position: Vector3.Zero() };
  syncListenerPosition(camera, listener);
  pruefe('Position gleich', listener.position.equals(camera.position), `${listener.position} vs ${camera.position}`);
}

console.log('\n[2] Folgt einer Bewegung (jeden Frame neu aufgerufen):');
{
  const listener = { position: Vector3.Zero() };
  syncListenerPosition(camera, listener);
  camera.position.set(10, 20, 30);
  syncListenerPosition(camera, listener);
  pruefe('Position zieht nach', listener.position.equals(camera.position), `${listener.position}`);
}

console.log('\n[3] Kopiert den Wert, hält keine Referenz auf camera.position:');
{
  const listener = { position: Vector3.Zero() };
  syncListenerPosition(camera, listener);
  camera.position.set(-5, -5, -5);
  pruefe('Listener bleibt beim alten Wert, bis erneut synchronisiert wird', !listener.position.equals(camera.position));
}

if (fehler > 0) {
  console.error(`\n=== ListenerSync: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== ListenerSync: ALLE GRÜN ===');
