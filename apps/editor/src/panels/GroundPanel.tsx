/**
 * The ground dials: how the active zone's terrain layers behave (ADR-0032).
 *
 * **Why this is not a panel of its own.** It used to be, and so did the zone
 * inspector next to it, and both of them edited the same `terrain` block —
 * which is one block, so it gets one panel. What made them two was that they
 * write it with two different commands: everything structural (the height
 * field, the tile, which texture paints a layer, the splat maps) is an ordinary
 * field patch, while metalness, smoothness, bump strength and the facetted
 * switch go through `updateTerrainSurface`, because that is the command
 * `pnpm terrain-surface` calls (ADR-0032, editor parity). So this is the
 * *second half of one panel* — same block, same undo history, other command —
 * and the zone inspector draws it under its own heading.
 *
 * **Where the dials come from.** From the schema, not from a list here. A field
 * annotated `turnedBy('terrainSurface', …)` in `@wov/world-schema` is found by
 * `fieldsCommandedBy`, arrives with its own minimum, maximum and step, and is
 * at the same time skipped by the schema-driven half of the panel — so a fifth
 * surface field appears here, once, and nothing in `apps/editor` changes
 * (ADR-0033).
 *
 * **What it deliberately does not offer.** Adding a layer, changing a texture,
 * moving the tile. Those are the other half's, and each has an asset and an
 * import behind it (ADR-0020, ADR-0021).
 *
 * **Why bump strength is disabled without a normal map.** A strength for a map
 * that is not there is a number that does nothing, and a number that does
 * nothing is a number someone will trust. The schema refuses it; the input says
 * so first.
 */
import type { JSX } from 'react';
import type { TerrainDefinition } from '@wov/world-schema';
import { fieldsCommandedBy, type FormField, type TerrainSurfacePatch } from '@wov/editor-core';

/** The command whose fields this half of the panel owns. */
export const GROUND_COMMAND = 'terrainSurface';

export interface GroundPanelProps {
  /** Every field of the terrain block, from `describeFields`. */
  readonly fields: readonly FormField[];
  /** The active zone's ground, or `undefined` when it has none. */
  readonly terrain: TerrainDefinition | undefined;
  readonly onLayer: (index: number, patch: TerrainSurfacePatch) => void;
  readonly onFlatNormals: (facetted: boolean) => void;
}

/** A number field of a layer, with the range the schema declared for it. */
interface Dial {
  readonly key: string;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
}

/**
 * The surface fields, split by where they sit: one per layer, or one for the
 * whole tile.
 *
 * `fieldsCommandedBy` answers `['layers', '*', 'metallic']` for the first and
 * `['flatNormals']` for the second, so the `*` is the whole rule and this file
 * still names no field.
 */
function dialsOf(fields: readonly FormField[]): {
  readonly layer: readonly Dial[];
  readonly tile: readonly FormField[];
} {
  const layer: Dial[] = [];
  const tile: FormField[] = [];
  for (const { path, field } of fieldsCommandedBy(fields, GROUND_COMMAND)) {
    if (path.includes('*')) {
      if (field.kind === 'number') {
        layer.push({
          key: field.key,
          label: field.label,
          minimum: field.minimum ?? 0,
          maximum: field.maximum ?? 1,
          step: field.step,
        });
      }
    } else {
      tile.push(field);
    }
  }
  return { layer, tile };
}

export function GroundPanel(props: GroundPanelProps): JSX.Element {
  const terrain = props.terrain;
  const layers = terrain?.layers ?? [];
  const { layer: dials, tile } = dialsOf(props.fields);

  return (
    <section className="ground" data-testid="editor-ground">
      <h3 className="panel-subhead">Surface</h3>

      {terrain === undefined ? (
        <p className="empty" data-testid="ground-empty">
          This zone has no terrain.
        </p>
      ) : (
        <>
          {tile.map((field) => (
            <label className="ground-facets" key={field.key}>
              <input
                type="checkbox"
                data-testid={`ground-${field.key}`}
                checked={terrain.flatNormals === true}
                onChange={(event) => props.onFlatNormals(event.target.checked)}
              />
              {field.label} (facetted)
            </label>
          ))}

          <ul className="asset-list" data-testid="ground-layers">
            {layers.map((layer, index) => (
              <li key={layer.texture} data-testid={`ground-layer-${String(index)}`}>
                <span className="menu-hint">
                  {String(index)} · {layer.texture.replace(/^.*\//, '')}
                </span>
                {dials.map((dial) => (
                  <label key={dial.key}>
                    {dial.label}
                    <input
                      type="number"
                      min={dial.minimum}
                      max={dial.maximum}
                      step={dial.step}
                      disabled={dial.key === 'normalScale' && layer.normalMap === undefined}
                      data-testid={`ground-${dial.key}-${String(index)}`}
                      value={layer[dial.key as keyof typeof layer] ?? 0}
                      onChange={(event) =>
                        props.onLayer(index, { [dial.key]: Number(event.target.value) })
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
