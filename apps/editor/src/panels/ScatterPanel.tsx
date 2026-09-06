import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  SCATTER_DENSITY_AREA,
  usableArea,
  type Rect,
  type ScatterOptions,
  type ScatterRegion,
  type WeightedPrefab,
} from '@wov/editor-core';

/** Which corner of the region the next viewport click sets, or none. */
export type CornerPick = 0 | 1 | null;

export interface ScatterPanelProps {
  /** `null` when the world has no active zone; the panel then refuses to run. */
  readonly zoneId: string | null;
  /** The prefab highlighted in the asset browser, offered as "add to the mix". */
  readonly selectedPrefabId: string | null;
  /** Set by two clicks in the viewport, or typed in. */
  readonly region: Rect;
  readonly onRegion: (region: Rect) => void;
  readonly cornerPick: CornerPick;
  readonly onCornerPick: (corner: CornerPick) => void;
  readonly onScatter: (options: Omit<ScatterOptions, 'heightAt'>) => void;
}

/** Where the panel starts: a modest patch, a plausible density, seed 1. */
const DEFAULTS = {
  density: 20,
  seed: 1,
  minimumDistance: 0.5,
  scaleLow: 0.9,
  scaleHigh: 1.3,
  yawLow: 0,
  yawHigh: 360,
};

/**
 * The scatter panel (spec §12).
 *
 * **What it is not.** It is not a brush and it does not paint into the scene:
 * pressing Scatter builds one `addEntities` command out of
 * `@wov/editor-core`'s `planScatter`, and everything after that is an ordinary
 * edit — the entities are in the document, one Ctrl+Z takes the whole field
 * back, and saving writes them into the world file like any other prop
 * (ADR-0025). The seed is how the same field is produced twice, not how it is
 * stored.
 *
 * **Why the count is previewed before anything happens.** A density is a number
 * per 100 m², and the region is the part of a rectangle that is left after the
 * keep-outs — so the instance count is not something a person can do in their
 * head, and a scatter that turns out to be forty thousand plants is a mistake
 * best made visible before it is made. The preview runs the same
 * {@link usableArea} the command does.
 */
export function ScatterPanel(props: ScatterPanelProps): JSX.Element {
  const [prefabs, setPrefabs] = useState<readonly WeightedPrefab[]>([]);
  const [density, setDensity] = useState(DEFAULTS.density);
  const [seed, setSeed] = useState(DEFAULTS.seed);
  const [minimumDistance, setMinimumDistance] = useState(DEFAULTS.minimumDistance);
  const [scaleLow, setScaleLow] = useState(DEFAULTS.scaleLow);
  const [scaleHigh, setScaleHigh] = useState(DEFAULTS.scaleHigh);
  const [yawLow, setYawLow] = useState(DEFAULTS.yawLow);
  const [yawHigh, setYawHigh] = useState(DEFAULTS.yawHigh);

  const region: ScatterRegion = useMemo(() => ({ rect: props.region }), [props.region]);
  const area = useMemo(() => usableArea(region), [region]);
  const preview = Math.round((density * area) / SCATTER_DENSITY_AREA);
  const ready = prefabs.length > 0 && area > 0 && density > 0 && props.zoneId !== null;

  const corner = (index: 0 | 1): string =>
    index === 0
      ? `${props.region[0].toFixed(1)}, ${props.region[1].toFixed(1)}`
      : `${props.region[2].toFixed(1)}, ${props.region[3].toFixed(1)}`;

  const setSide = (index: 0 | 1 | 2 | 3, value: number): void => {
    const next: [number, number, number, number] = [...props.region];
    next[index] = value;
    props.onRegion(next);
  };

  return (
    <section className="scatter" data-testid="editor-scatter">
      <h2>Scatter</h2>

      <div className="scatter-region">
        <span className="menu-hint">Region (x/z, metres)</span>
        {(['x0', 'z0', 'x1', 'z1'] as const).map((label, index) => (
          <label key={label}>
            {label}
            <input
              type="number"
              step="0.5"
              data-testid={`scatter-${label}`}
              value={props.region[index as 0 | 1 | 2 | 3]}
              onChange={(event) => setSide(index as 0 | 1 | 2 | 3, Number(event.target.value))}
            />
          </label>
        ))}
        {([0, 1] as const).map((index) => (
          <button
            key={index}
            type="button"
            data-testid={`scatter-pick-${String(index)}`}
            aria-pressed={props.cornerPick === index}
            className={props.cornerPick === index ? 'tab active' : 'tab'}
            onClick={() => props.onCornerPick(props.cornerPick === index ? null : index)}
          >
            {props.cornerPick === index
              ? 'click the ground…'
              : `pick corner ${String(index + 1)} (${corner(index)})`}
          </button>
        ))}
      </div>

      <div className="scatter-prefabs">
        <button
          type="button"
          data-testid="scatter-add-prefab"
          disabled={props.selectedPrefabId === null}
          onClick={() => {
            const prefabId = props.selectedPrefabId;
            if (prefabId === null || prefabs.some((entry) => entry.prefab === prefabId)) {
              return;
            }
            setPrefabs([...prefabs, { prefab: prefabId, weight: 1 }]);
          }}
        >
          {props.selectedPrefabId === null
            ? 'select a prefab in the browser'
            : `add ${props.selectedPrefabId}`}
        </button>
        <ul data-testid="scatter-prefab-list">
          {prefabs.map((entry) => (
            <li key={entry.prefab}>
              <span className="asset-name">{entry.prefab}</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                aria-label={`weight of ${entry.prefab}`}
                data-testid={`scatter-weight-${entry.prefab}`}
                value={entry.weight}
                onChange={(event) =>
                  setPrefabs(
                    prefabs.map((candidate) =>
                      candidate.prefab === entry.prefab
                        ? { ...candidate, weight: Number(event.target.value) }
                        : candidate,
                    ),
                  )
                }
              />
              <button
                type="button"
                data-testid={`scatter-remove-${entry.prefab}`}
                onClick={() =>
                  setPrefabs(prefabs.filter((candidate) => candidate.prefab !== entry.prefab))
                }
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="scatter-numbers">
        <label>
          density /100 m²
          <input
            type="number"
            min="0.1"
            step="0.1"
            data-testid="scatter-density"
            value={density}
            onChange={(event) => setDensity(Number(event.target.value))}
          />
        </label>
        <label>
          seed
          <input
            type="number"
            min="0"
            step="1"
            data-testid="scatter-seed"
            value={seed}
            onChange={(event) => setSeed(Math.max(0, Math.trunc(Number(event.target.value))))}
          />
        </label>
        <label>
          min distance
          <input
            type="number"
            min="0"
            step="0.1"
            data-testid="scatter-min-distance"
            value={minimumDistance}
            onChange={(event) => setMinimumDistance(Number(event.target.value))}
          />
        </label>
        <label>
          scale from
          <input
            type="number"
            min="0.01"
            step="0.05"
            data-testid="scatter-scale-low"
            value={scaleLow}
            onChange={(event) => setScaleLow(Number(event.target.value))}
          />
        </label>
        <label>
          to
          <input
            type="number"
            min="0.01"
            step="0.05"
            data-testid="scatter-scale-high"
            value={scaleHigh}
            onChange={(event) => setScaleHigh(Number(event.target.value))}
          />
        </label>
        <label>
          yaw from°
          <input
            type="number"
            step="15"
            data-testid="scatter-yaw-low"
            value={yawLow}
            onChange={(event) => setYawLow(Number(event.target.value))}
          />
        </label>
        <label>
          to°
          <input
            type="number"
            step="15"
            data-testid="scatter-yaw-high"
            value={yawHigh}
            onChange={(event) => setYawHigh(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="scatter-run">
        <span className="menu-hint" data-testid="scatter-preview">
          {area.toFixed(0)} m² usable · {preview} instances
        </span>
        <button
          type="button"
          data-testid="scatter-run"
          disabled={!ready}
          onClick={() =>
            props.onScatter({
              region,
              prefabs,
              density,
              seed,
              minimumDistance,
              scale: [scaleLow, scaleHigh],
              yawDegrees: [yawLow, yawHigh],
            })
          }
        >
          Scatter
        </button>
      </div>
    </section>
  );
}
