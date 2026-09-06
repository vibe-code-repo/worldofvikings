import type { JSX } from 'react';
import type { TerrainDefinition } from '@wov/world-schema';
import type { TerrainSurfacePatch } from '@wov/editor-core';

export interface GroundPanelProps {
  /** The active zone's ground, or `undefined` when it has none. */
  readonly terrain: TerrainDefinition | undefined;
  readonly onLayer: (index: number, patch: TerrainSurfacePatch) => void;
  readonly onFlatNormals: (facetted: boolean) => void;
}

/** The three dials a layer has, and what each one is called on screen. */
const DIALS = [
  { field: 'metallic', label: 'metal', high: 1, step: 0.05 },
  { field: 'smoothness', label: 'smooth', high: 1, step: 0.05 },
  { field: 'normalScale', label: 'bump', high: 8, step: 0.1 },
] as const;

/**
 * The ground panel: how the active zone's terrain layers behave (ADR-0032).
 *
 * **Why the editor has this at all.** The rule is parity: anything a script
 * writes into a world file has to be reachable here, or the world file grows
 * fields only a script can set and the editor stops being where a world is
 * made. `pnpm terrain-surface` and every input below dispatch the same
 * `updateTerrainSurface` command, so a number typed here and a number passed on
 * a command line travel one path and are refused in one place.
 *
 * **What it deliberately does not offer.** Adding a layer, changing a texture,
 * moving the tile. Each of those has an asset and an import behind it
 * (ADR-0020, ADR-0021); these five controls are a *look*, which is the thing
 * worth turning while watching the viewport.
 *
 * **Why the bump strength is disabled without a normal map.** A strength for a
 * map that is not there is a number that does nothing, and a number that does
 * nothing is a number someone will trust. The schema refuses it; the input says
 * so first.
 */
export function GroundPanel(props: GroundPanelProps): JSX.Element {
  const terrain = props.terrain;
  const layers = terrain?.layers ?? [];

  return (
    <section className="scatter" data-testid="editor-ground">
      <h2>Ground</h2>

      {terrain === undefined ? (
        <p className="empty" data-testid="ground-empty">
          This zone has no terrain.
        </p>
      ) : (
        <>
          <label className="ground-facets">
            <input
              type="checkbox"
              data-testid="ground-flat-normals"
              checked={terrain.flatNormals === true}
              onChange={(event) => props.onFlatNormals(event.target.checked)}
            />
            Facetted (flat normals)
          </label>

          <ul className="asset-list" data-testid="ground-layers">
            {layers.map((layer, index) => (
              <li key={layer.texture} data-testid={`ground-layer-${String(index)}`}>
                <span className="menu-hint">
                  {String(index)} · {layer.texture.replace(/^.*\//, '')}
                </span>
                {DIALS.map((dial) => (
                  <label key={dial.field}>
                    {dial.label}
                    <input
                      type="number"
                      min={0}
                      max={dial.high}
                      step={dial.step}
                      disabled={dial.field === 'normalScale' && layer.normalMap === undefined}
                      data-testid={`ground-${dial.field}-${String(index)}`}
                      value={layer[dial.field] ?? 0}
                      onChange={(event) =>
                        props.onLayer(index, { [dial.field]: Number(event.target.value) })
                      }
                    />
                  </label>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
