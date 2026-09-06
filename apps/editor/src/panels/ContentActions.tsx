/**
 * The **World** menu's two actions, as one dialog (ADR-0033).
 *
 * *Import scene bundle…* and *Regenerate prefab catalogue* run
 * `pnpm import:scene` and `pnpm generate:prefabs` — not something like them,
 * the same functions, through `POST /actions/*`. The dialog's job is therefore
 * small and entirely about honesty: take the arguments, show that it is
 * running, and print the command's own report rather than "done".
 *
 * The report matters more than it looks. A scene import that placed 1 200 of
 * 1 580 instances *succeeded*, and the 380 it did not recognise are the next
 * piece of work — they are in the report by name and by weight. A dialog that
 * said "imported" would hide exactly the number somebody needs.
 *
 * The bundle is named relative to the service's `WOV_IMPORT_DIR`, which is the
 * only place it may read from; a deployment that sets nothing answers 501 and
 * the dialog says so.
 */
import { useState } from 'react';
import type { JSX } from 'react';
import type { ActionReport, SceneImportRequest } from '../api/client.js';

/** Which action the dialog is showing, or none. */
export type ContentAction = 'import-scene' | 'generate-prefabs' | null;

export interface ContentActionsProps {
  readonly action: ContentAction;
  readonly onClose: () => void;
  readonly onImportScene: (request: SceneImportRequest) => void;
  readonly onGeneratePrefabs: () => void;
  /** True while the API is working. */
  readonly running: boolean;
  /** The report of the last run, or `null`. */
  readonly report: ActionReport | null;
  /** What went wrong, or `null`. */
  readonly error: string | null;
}

export function ContentActions(props: ContentActionsProps): JSX.Element | null {
  const [scene, setScene] = useState('');
  const [worldId, setWorldId] = useState('');
  const [worldName, setWorldName] = useState('');
  const [zoneRoot, setZoneRoot] = useState('');
  const [dryRun, setDryRun] = useState(false);

  if (props.action === null) {
    return null;
  }

  const importing = props.action === 'import-scene';
  const ready = scene.trim() !== '' && worldId.trim() !== '' && worldName.trim() !== '';

  return (
    <div className="dialog-backdrop" data-testid="content-action-dialog">
      <section className="dialog">
        <header>
          <h2>{importing ? 'Import scene bundle' : 'Regenerate prefab catalogue'}</h2>
          <button type="button" data-testid="content-action-close" onClick={props.onClose}>
            close
          </button>
        </header>

        {importing ? (
          <div className="dialog-body">
            <p className="hint">
              The bundle is named relative to the service&rsquo;s <code>WOV_IMPORT_DIR</code>. The
              ground and the light of the world being replaced are carried over, not regenerated.
            </p>
            <label className="field">
              <span className="field-label">bundle</span>
              <input
                data-testid="import-scene-file"
                placeholder="Village1.glb"
                value={scene}
                onChange={(event) => setScene(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">world id</span>
              <input
                data-testid="import-scene-world"
                placeholder="village1"
                value={worldId}
                onChange={(event) => setWorldId(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">world name</span>
              <input
                data-testid="import-scene-name"
                placeholder="Village One"
                value={worldName}
                onChange={(event) => setWorldName(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">zone root</span>
              <input
                data-testid="import-scene-zone-root"
                placeholder="(the default zones)"
                value={zoneRoot}
                onChange={(event) => setZoneRoot(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">dry run</span>
              <input
                type="checkbox"
                data-testid="import-scene-dry-run"
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
              />
            </label>
          </div>
        ) : (
          <div className="dialog-body">
            <p className="hint">
              Rebuilds <code>prefabs/imported.json</code> from the asset manifest. Corrections in{' '}
              <code>overrides.json</code> are not touched — that is what the overlay is for. A
              tree&rsquo;s collision box is measured on the model, so the service needs its asset
              store.
            </p>
          </div>
        )}

        {props.error !== null && (
          <p className="error" data-testid="content-action-error">
            {props.error}
          </p>
        )}
        {props.report !== null && (
          <pre className="dialog-report" data-testid="content-action-report">
            {JSON.stringify(props.report, null, 2)}
          </pre>
        )}

        <footer>
          <button
            type="button"
            data-testid="content-action-run"
            disabled={props.running || (importing && !ready)}
            onClick={() => {
              if (importing) {
                props.onImportScene({
                  scene: scene.trim(),
                  world: worldId.trim(),
                  name: worldName.trim(),
                  ...(zoneRoot.trim() === '' ? {} : { zoneRoot: zoneRoot.trim() }),
                  ...(dryRun ? { dryRun: true } : {}),
                });
              } else {
                props.onGeneratePrefabs();
              }
            }}
          >
            {props.running ? 'Running…' : importing ? 'Import' : 'Regenerate'}
          </button>
        </footer>
      </section>
    </div>
  );
}
