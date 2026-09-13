/**
 * Augenfarbe ohne zusaetzliche Koerpermodelle oder Materialien.
 *
 * Beide Figuren haben die Iris-/Augenflaechen als eigene, duplizierte
 * Vertices im Kopfnetz. Im Original zeigen genau diese Vertices auf einen
 * blauen Farbfleck des vorhandenen Synty-Atlas. Fuer eine andere Farbe
 * werden nur ihre UV-Koordinaten auf einen anderen einfarbigen Fleck
 * desselben Atlas gelegt. So bleiben Haut, Augenweiss, Beleuchtung und
 * Ruestung unveraendert.
 */
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { augenfarbeZu } from '@wov/shared';

const QUELLE_U = 0.0117;
const QUELLE_V = 0.9901;
const TOLERANZ = 0.002;

interface AugenUv {
  indizes: number[];
  original: number[];
}

const augenJeNetz = new WeakMap<Mesh, AugenUv>();

function augenUv(mesh: Mesh): AugenUv | null {
  const bekannt = augenJeNetz.get(mesh);
  if (bekannt) return bekannt;
  if (!/Chr_Head_(?:Male|Female)_00/i.test(mesh.name)) return null;
  const uv = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!uv) return null;
  const indizes: number[] = [];
  const original: number[] = [];
  for (let i = 0; i < uv.length; i += 2) {
    if (Math.abs(uv[i]! - QUELLE_U) > TOLERANZ || Math.abs(uv[i + 1]! - QUELLE_V) > TOLERANZ) continue;
    indizes.push(i);
    original.push(uv[i]!, uv[i + 1]!);
  }
  if (!indizes.length) return null;
  // Klone aus AssetManager teilen ihre Geometry. Ohne diese Trennung
  // bekaeme der zuletzt gefaerbte Mitspieler die Augen aller anderen.
  mesh.makeGeometryUnique();
  const eintrag = { indizes, original };
  augenJeNetz.set(mesh, eintrag);
  return eintrag;
}

/** Legt eine Augenfarben-Kennung auf den Kopf; Unbekanntes wird Vorgabe. */
export function faerbeAugen(netze: readonly AbstractMesh[], id: string | null | undefined): void {
  const farbe = augenfarbeZu(id);
  for (const abstrakt of netze) {
    if (!(abstrakt instanceof Mesh)) continue;
    const augen = augenUv(abstrakt);
    if (!augen) continue;
    const uv = abstrakt.getVerticesData(VertexBuffer.UVKind);
    if (!uv) continue;
    for (let n = 0; n < augen.indizes.length; n++) {
      const i = augen.indizes[n]!;
      if (farbe.id === 'fjordblau') {
        uv[i] = augen.original[n * 2]!;
        uv[i + 1] = augen.original[n * 2 + 1]!;
      } else {
        uv[i] = farbe.uv[0];
        uv[i + 1] = farbe.uv[1];
      }
    }
    abstrakt.setVerticesData(VertexBuffer.UVKind, uv, true);
  }
}
