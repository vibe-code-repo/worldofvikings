/** Augen-UVs: nur die Iris-Vertices duerfen auf den Palettenfleck wechseln. */
import { strict as assert } from 'node:assert';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { augenfarbeZu } from '@wov/shared';
import { faerbeAugen } from '../src/player/augenfarbe.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const kopf = new Mesh('Chr_Head_Male_00', scene);
const original = [0.0117, 0.9901, 0.25, 0.75, 0.0117, 0.9901];
kopf.setVerticesData(VertexBuffer.PositionKind, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
kopf.setVerticesData(VertexBuffer.UVKind, original, true);

faerbeAugen([kopf], 'waldgruen');
const gruen = kopf.getVerticesData(VertexBuffer.UVKind)!;
assert.deepEqual(Array.from(gruen.slice(0, 2)), [...augenfarbeZu('waldgruen').uv]);
assert.deepEqual(Array.from(gruen.slice(2, 4)), original.slice(2, 4), 'Haut-UV bleibt unangetastet');
assert.deepEqual(Array.from(gruen.slice(4, 6)), [...augenfarbeZu('waldgruen').uv]);

faerbeAugen([kopf], 'fjordblau');
assert.deepEqual(Array.from(kopf.getVerticesData(VertexBuffer.UVKind)!), Array.from(new Float32Array(original)), 'Vorgabe stellt Original-UV wieder her');

const rumpf = new Mesh('Chr_Torso_Male_00', scene);
rumpf.setVerticesData(VertexBuffer.PositionKind, [0, 0, 0]);
rumpf.setVerticesData(VertexBuffer.UVKind, [0.0117, 0.9901], true);
faerbeAugen([rumpf], 'bernstein');
assert.deepEqual(Array.from(rumpf.getVerticesData(VertexBuffer.UVKind)!), Array.from(new Float32Array([0.0117, 0.9901])), 'Nur Kopfnetze werden geaendert');

scene.dispose();
engine.dispose();
console.log('Augenfarbe: alle Pruefungen bestanden');
